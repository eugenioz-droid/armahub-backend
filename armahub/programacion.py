"""
PROGRAMACIÓN DE CUBICACIONES — backend (28-sep).

Reemplaza la planilla semanal: cinco USC armaban cinco Excel, un cubicador los consolidaba a
mano cada semana y copiaba de aSa lo cubicado. Aquí los cinco escriben en el mismo lugar, así
que no hay nada que consolidar.

VOCABULARIO. Una TAREA es un sector constructivo de una obra — obra · sector · piso · ciclo —,
la misma clave que ya usa `sector_estado`. Por eso las tareas no se teclean: se DERIVAN de los
frentes que ArmaHub ya conoce (`_sincronizar`). Las obras de infraestructura, que no tienen
estos sectores, llevan frentes de nombre propio (sector='LIBRE', el nombre en `ciclo`).

LAS REGLAS DE FECHA VIVEN AQUÍ, no en el front. El USC escribe la fecha de DESPACHO; la de
CUBICACIÓN se calcula 10 días hábiles antes. Si al programar quedan menos de 7 hábiles hasta
la cubicación, la tarea entra igual pero queda marcada (`plazo_corto`): el área atiende, y lo
que se registra es cómo se está planificando. El front sólo muestra lo que el backend decide —
si la regla cambiara, cambia en un solo sitio.
"""
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from psycopg.rows import dict_row

from .auth import get_current_user
from .db import get_conn, audit

router = APIRouter()

# Días hábiles entre que una tarea debe estar cubicada y su despacho en obra.
DIAS_CUBICACION_A_DESPACHO = 10
# Mínimo de días hábiles que el área necesita para tomar una tarea. Por debajo no se bloquea:
# se marca. Un USC que programa el mes sólo lo ve en la primera; al que se queda sin programa
# le aparece en todas, que es justo lo que se quiere poder ver.
DIAS_MINIMOS = 7

_ESTADOS = ("disponible", "programada", "cubicada")
# Roles que pueden programar. Los USC todavía no existen como usuarios (se crearán); mientras
# tanto programa quien administra. El rol 'usc' ya está contemplado para cuando existan.
_ROLES_PROGRAMAN = ("admin", "admin_calidad", "usc")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _es_habil(d: date) -> bool:
    return d.weekday() < 5          # lunes..viernes; sin feriados por ahora


def _suma_habiles(desde: date, n: int) -> date:
    """Corre `n` días hábiles desde `desde` (n negativo va hacia atrás)."""
    paso = 1 if n >= 0 else -1
    quedan, d = abs(n), desde
    while quedan > 0:
        d += timedelta(days=paso)
        if _es_habil(d):
            quedan -= 1
    return d


def _habiles_entre(a: date, b: date) -> int:
    """Días hábiles de `a` a `b`. Negativo si `b` quedó atrás."""
    if a == b:
        return 0
    paso = 1 if b > a else -1
    n, d = 0, a
    while (paso > 0 and d < b) or (paso < 0 and d > b):
        d += timedelta(days=paso)
        if _es_habil(d):
            n += paso
    return n


def _derivar_fechas(despacho: date):
    """Del despacho salen las otras dos cosas: cuándo debe estar cubicada y si se pidió con
    menos margen del que el área necesita. `plazo_corto` se congela al programar — mide con
    cuánta anticipación se PIDIÓ, no cuánto falta hoy."""
    cubicacion = _suma_habiles(despacho, -DIAS_CUBICACION_A_DESPACHO)
    corto = _habiles_entre(date.today(), cubicacion) < DIAS_MINIMOS
    return cubicacion, corto


def _puede_programar(user) -> bool:
    return user.get("role") in _ROLES_PROGRAMAN


def _exigir_programar(user):
    if not _puede_programar(user):
        raise HTTPException(status_code=403, detail="Solo USC o administración pueden programar.")


# ---------------------------------------------------------------------------
# SINCRONIZACIÓN: las tareas se derivan de los frentes que ArmaHub ya conoce
# ---------------------------------------------------------------------------
def _sincronizar(cur, id_proyecto: str, email: str) -> int:
    """Crea como 'disponible' toda clave de `sector_estado` que todavía no sea tarea. No borra
    ni toca las que ya existen: una tarea programada no puede perder su fecha porque el frente
    cambió de estado. Devuelve cuántas creó."""
    cur.execute(
        """
        INSERT INTO tareas_programacion
              (id_proyecto, sector, piso, ciclo, estado, creado_por, creado_fecha)
        SELECT se.id_proyecto, se.sector, COALESCE(se.piso,''), COALESCE(se.ciclo,''),
               'disponible', %s, %s
          FROM sector_estado se
         WHERE se.id_proyecto = %s
        ON CONFLICT (id_proyecto, sector, piso, ciclo) DO NOTHING
        """,
        (email, _now_iso(), id_proyecto),
    )
    return cur.rowcount or 0


def _sql_tareas(where: str) -> str:
    """Las tareas con su peso REAL. El peso real no se teclea: son los kilos de las barras de
    ese frente en ArmaHub. Es lo que después permite contrastar la tonelada que estimó el USC
    contra la que de verdad pesó."""
    return f"""
        SELECT t.id, t.id_proyecto, t.sector, t.piso, t.ciclo, t.estado,
               t.fecha_despacho, t.fecha_cubicacion, t.ton_estimadas, t.cubicador_email,
               t.plazo_corto, t.programado_por, t.cubicada_fecha,
               COALESCE(p.nombre_proyecto, t.id_proyecto) AS obra,
               COALESCE(se.estado, 'pendiente') AS estado_armahub,
               COALESCE(k.kg, 0) AS kg_reales,
               u.nombre || ' ' || COALESCE(u.apellido,'') AS cubicador_nombre
          FROM tareas_programacion t
          LEFT JOIN proyectos p ON p.id_proyecto = t.id_proyecto
          LEFT JOIN users u ON u.email = t.cubicador_email
          LEFT JOIN sector_estado se ON se.id_proyecto = t.id_proyecto AND se.sector = t.sector
               AND COALESCE(se.piso,'') = t.piso AND COALESCE(se.ciclo,'') = t.ciclo
          LEFT JOIN (
                SELECT id_proyecto, sector, COALESCE(piso,'') AS piso, COALESCE(ciclo,'') AS ciclo,
                       SUM(peso_total) AS kg
                  FROM barras GROUP BY 1,2,3,4
          ) k ON k.id_proyecto = t.id_proyecto AND k.sector = t.sector
               AND k.piso = t.piso AND k.ciclo = t.ciclo
         {where}
    """


def _fila(r) -> dict:
    libre = (r["sector"] == "LIBRE")
    return {
        "id": r["id"], "id_proyecto": r["id_proyecto"], "obra": r["obra"],
        "sector": r["sector"], "piso": r["piso"], "ciclo": r["ciclo"], "libre": libre,
        "nombre": r["ciclo"] if libre else f'{r["sector"]} {r["piso"] or "—"} {r["ciclo"] or "—"}',
        "estado": r["estado"],
        "fecha_despacho": r["fecha_despacho"].isoformat() if r["fecha_despacho"] else None,
        "fecha_cubicacion": r["fecha_cubicacion"].isoformat() if r["fecha_cubicacion"] else None,
        "ton_estimadas": float(r["ton_estimadas"]) if r["ton_estimadas"] is not None else None,
        "ton_reales": round(float(r["kg_reales"] or 0) / 1000.0, 2),
        "cubicador_email": r["cubicador_email"],
        "cubicador": (r["cubicador_nombre"] or "").strip() or None,
        "plazo_corto": bool(r["plazo_corto"]),
        "programado_por": r["programado_por"],
        "estado_armahub": r["estado_armahub"],
    }


def _auto_cubicadas(cur) -> int:
    """Una tarea programada cuyo frente YA se exportó a aSa y tiene kilos está cubicada: nadie
    tiene que ir a marcarla. Es el «se marca solo» que hoy obliga a un cubicador a copiar
    datos de aSa a mano cada semana. Las obras que no se cubican en ArmaHub se marcan a mano
    (POST .../cubicada), porque de ellas ArmaHub no sabe nada."""
    cur.execute(
        """
        UPDATE tareas_programacion t
           SET estado = 'cubicada', cubicada_fecha = %s, editado_fecha = %s, editado_por = 'sistema'
          FROM sector_estado se
         WHERE t.estado = 'programada'
           AND se.id_proyecto = t.id_proyecto AND se.sector = t.sector
           AND COALESCE(se.piso,'') = t.piso AND COALESCE(se.ciclo,'') = t.ciclo
           AND se.estado IN ('exportado','modificado')
           AND EXISTS (SELECT 1 FROM barras b
                        WHERE b.id_proyecto = t.id_proyecto AND b.sector = t.sector
                          AND COALESCE(b.piso,'') = t.piso AND COALESCE(b.ciclo,'') = t.ciclo)
        """,
        (_now_iso(), _now_iso()),
    )
    return cur.rowcount or 0


# ---------------------------------------------------------------------------
# ENDPOINTS
# ---------------------------------------------------------------------------
@router.get("/programacion/obras")
def listar_obras(user=Depends(get_current_user)):
    """Las obras con su conteo: cuántas tareas quedan por programar, cuántas programadas y
    cuántas cubicadas. Es la caja 1 — se elige la obra y todo lo demás la sigue."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _auto_cubicadas(cur)
            cur.execute(
                """
                SELECT p.id_proyecto, p.nombre_proyecto,
                       COUNT(t.id) FILTER (WHERE t.estado = 'disponible') AS disponibles,
                       COUNT(t.id) FILTER (WHERE t.estado = 'programada') AS programadas,
                       COUNT(t.id) FILTER (WHERE t.estado = 'cubicada')   AS cubicadas,
                       COUNT(se.id) AS frentes,
                       (SELECT u.nombre || ' ' || COALESCE(u.apellido,'')
                          FROM proyecto_usuarios pu JOIN users u ON u.id = pu.user_id
                         WHERE pu.id_proyecto = p.id_proyecto AND pu.rol = 'cubicador'
                         LIMIT 1) AS cubicador,
                       (SELECT u.email
                          FROM proyecto_usuarios pu JOIN users u ON u.id = pu.user_id
                         WHERE pu.id_proyecto = p.id_proyecto AND pu.rol = 'cubicador'
                         LIMIT 1) AS cubicador_email
                  FROM proyectos p
                  LEFT JOIN tareas_programacion t ON t.id_proyecto = p.id_proyecto
                  LEFT JOIN sector_estado se ON se.id_proyecto = p.id_proyecto
                 GROUP BY p.id_proyecto, p.nombre_proyecto
                HAVING COUNT(se.id) > 0 OR COUNT(t.id) > 0
                 ORDER BY p.nombre_proyecto
                """
            )
            obras = [
                {"id_proyecto": r[0], "obra": r[1] or r[0], "disponibles": r[2],
                 "programadas": r[3], "cubicadas": r[4], "frentes": r[5],
                 "cubicador": (r[6] or "").strip() or None, "cubicador_email": r[7]}
                for r in cur.fetchall()
            ]
    return {"obras": obras, "puede_programar": _puede_programar(user)}


@router.get("/programacion/obras/{id_proyecto}/tareas")
def tareas_de_obra(id_proyecto: str, user=Depends(get_current_user)):
    """Las tareas de una obra, sincronizadas con los frentes que ArmaHub ya conoce. Devuelve
    las tres listas ya separadas: el front no tiene que saber la regla de estados."""
    with get_conn() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT 1 FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Obra no encontrada.")
            nuevas = _sincronizar(cur, id_proyecto, user.get("email", "?"))
            _auto_cubicadas(cur)
            cur.execute(_sql_tareas("WHERE t.id_proyecto = %s") +
                        " ORDER BY t.fecha_cubicacion NULLS LAST, t.sector, t.piso, t.ciclo",
                        (id_proyecto,))
            filas = [_fila(r) for r in cur.fetchall()]
    return {
        "nuevas": nuevas,
        "disponibles": [f for f in filas if f["estado"] == "disponible"],
        "programadas": [f for f in filas if f["estado"] == "programada"],
        "cubicadas": [f for f in filas if f["estado"] == "cubicada"],
    }


class ProgramarBody(BaseModel):
    ids: List[int]
    fecha_despacho: str
    ton_estimadas: Optional[float] = None
    cubicador_email: Optional[str] = None


@router.post("/programacion/programar")
def programar(body: ProgramarBody, user=Depends(get_current_user)):
    """Pone fecha a una o varias tareas de una vez. El USC escribe el DESPACHO; la cubicación y
    la marca de plazo corto las decide el backend."""
    _exigir_programar(user)
    if not body.ids:
        raise HTTPException(status_code=400, detail="No hay tareas que programar.")
    try:
        despacho = date.fromisoformat(body.fecha_despacho)
    except ValueError:
        raise HTTPException(status_code=400, detail="Fecha de despacho inválida.")
    cubicacion, corto = _derivar_fechas(despacho)
    email, ahora = user.get("email", "?"), _now_iso()
    with get_conn() as conn:
        with conn.cursor() as cur:
            # El cubicador por defecto es el responsable de la obra (proyecto_usuarios). El USC
            # no elige persona: elige fecha. Reasignar es decisión de la jefatura.
            cur.execute(
                """
                UPDATE tareas_programacion t
                   SET estado = 'programada', fecha_despacho = %s, fecha_cubicacion = %s,
                       plazo_corto = %s,
                       ton_estimadas = COALESCE(%s, t.ton_estimadas),
                       cubicador_email = COALESCE(%s, t.cubicador_email, (
                            SELECT u.email FROM proyecto_usuarios pu JOIN users u ON u.id = pu.user_id
                             WHERE pu.id_proyecto = t.id_proyecto AND pu.rol = 'cubicador' LIMIT 1)),
                       programado_por = %s, programado_fecha = %s,
                       editado_por = %s, editado_fecha = %s
                 WHERE t.id = ANY(%s) AND t.estado <> 'cubicada'
             RETURNING t.id
                """,
                (despacho, cubicacion, corto, body.ton_estimadas, body.cubicador_email,
                 email, ahora, email, ahora, body.ids),
            )
            n = len(cur.fetchall())
    audit(email, "programar_tareas", f"{n} tarea(s) · despacho {despacho}" + (" · plazo corto" if corto else ""),
          "programacion", "")
    return {"ok": True, "programadas": n, "fecha_cubicacion": cubicacion.isoformat(), "plazo_corto": corto}


class EditarBody(BaseModel):
    fecha_despacho: Optional[str] = None
    ton_estimadas: Optional[float] = None
    cubicador_email: Optional[str] = None


@router.patch("/programacion/tareas/{tarea_id}")
def editar(tarea_id: int, body: EditarBody, user=Depends(get_current_user)):
    """Corrige una tarea ya programada. Sólo toca lo que viene en el cuerpo (mismo criterio que
    el PATCH de reclamos: no borrar lo que el usuario no mandó)."""
    _exigir_programar(user)
    sets, params = [], []
    if body.fecha_despacho is not None:
        try:
            despacho = date.fromisoformat(body.fecha_despacho)
        except ValueError:
            raise HTTPException(status_code=400, detail="Fecha de despacho inválida.")
        cubicacion, corto = _derivar_fechas(despacho)
        sets += ["fecha_despacho = %s", "fecha_cubicacion = %s", "plazo_corto = %s"]
        params += [despacho, cubicacion, corto]
    if "ton_estimadas" in body.__fields_set__:
        sets.append("ton_estimadas = %s"); params.append(body.ton_estimadas)
    if body.cubicador_email is not None:
        sets.append("cubicador_email = %s"); params.append(body.cubicador_email)
    if not sets:
        return {"ok": True, "sin_cambios": True}
    email = user.get("email", "?")
    sets += ["editado_por = %s", "editado_fecha = %s"]
    params += [email, _now_iso(), tarea_id]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE tareas_programacion SET " + ", ".join(sets) + " WHERE id = %s RETURNING id", params)
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Tarea no encontrada.")
    return {"ok": True}


@router.delete("/programacion/tareas/{tarea_id}/programacion")
def desprogramar(tarea_id: int, user=Depends(get_current_user)):
    """Saca una tarea del programa: vuelve a 'disponible' y pierde sus fechas. No borra la
    tarea — el frente sigue existiendo."""
    _exigir_programar(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE tareas_programacion
                      SET estado='disponible', fecha_despacho=NULL, fecha_cubicacion=NULL,
                          plazo_corto=FALSE, programado_por=NULL, programado_fecha=NULL,
                          editado_por=%s, editado_fecha=%s
                    WHERE id=%s AND estado='programada' RETURNING id""",
                (user.get("email", "?"), _now_iso(), tarea_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=409, detail="Sólo se puede desprogramar una tarea programada.")
    return {"ok": True}


@router.post("/programacion/tareas/{tarea_id}/cubicada")
def marcar_cubicada(tarea_id: int, user=Depends(get_current_user)):
    """Marca a mano. Para las obras que SÍ se cubican en ArmaHub esto no hace falta: el sistema
    lo detecta solo (_auto_cubicadas). Existe para las que se cubican fuera."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE tareas_programacion SET estado='cubicada', cubicada_fecha=%s,
                          editado_por=%s, editado_fecha=%s
                    WHERE id=%s RETURNING id""",
                (_now_iso(), user.get("email", "?"), _now_iso(), tarea_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Tarea no encontrada.")
    return {"ok": True}


class LibreBody(BaseModel):
    nombre: str


@router.post("/programacion/obras/{id_proyecto}/tarea-libre")
def crear_libre(id_proyecto: str, body: LibreBody, user=Depends(get_current_user)):
    """Frente con nombre propio, para las obras de infraestructura que no tienen sector · piso ·
    ciclo. Se guarda con sector='LIBRE' y el nombre en `ciclo` para no romper la clave única."""
    _exigir_programar(user)
    nombre = (body.nombre or "").strip()[:80]
    if not nombre:
        raise HTTPException(status_code=400, detail="El frente necesita un nombre.")
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Obra no encontrada.")
            cur.execute(
                """INSERT INTO tareas_programacion
                          (id_proyecto, sector, piso, ciclo, estado, creado_por, creado_fecha)
                   VALUES (%s, 'LIBRE', '', %s, 'disponible', %s, %s)
                   ON CONFLICT (id_proyecto, sector, piso, ciclo) DO NOTHING
                   RETURNING id""",
                (id_proyecto, nombre, email, _now_iso()),
            )
            fila = cur.fetchone()
            if not fila:
                raise HTTPException(status_code=409, detail="Ya existe un frente con ese nombre en la obra.")
    return {"ok": True, "id": fila[0]}


@router.get("/programacion/semana")
def semana(desde: Optional[str] = None, user=Depends(get_current_user)):
    """Carga por cubicador y día de una semana: cuántas tareas y cuántas toneladas estimadas.
    Es el calendario de números — sirve para ver el choque (varios USC pidiéndole lo mismo al
    mismo cubicador el mismo día) y con cuánto queda cada uno."""
    try:
        base = date.fromisoformat(desde) if desde else date.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="Fecha inválida.")
    lunes = base - timedelta(days=base.weekday())
    viernes = lunes + timedelta(days=4)
    with get_conn() as conn:
        with conn.cursor() as cur:
            _auto_cubicadas(cur)
            cur.execute(
                """
                SELECT COALESCE(u.nombre || ' ' || COALESCE(u.apellido,''), t.cubicador_email, '(sin asignar)') AS cubicador,
                       t.cubicador_email, t.fecha_cubicacion,
                       COUNT(*) AS n, COALESCE(SUM(t.ton_estimadas),0) AS ton,
                       COUNT(*) FILTER (WHERE t.plazo_corto) AS cortas,
                       STRING_AGG(DISTINCT COALESCE(p.nombre_proyecto, t.id_proyecto), ' · ') AS obras,
                       COUNT(DISTINCT t.programado_por) AS n_usc
                  FROM tareas_programacion t
                  LEFT JOIN users u ON u.email = t.cubicador_email
                  LEFT JOIN proyectos p ON p.id_proyecto = t.id_proyecto
                 WHERE t.estado = 'programada'
                   AND t.fecha_cubicacion BETWEEN %s AND %s
                 GROUP BY 1, 2, 3 ORDER BY 1, 3
                """,
                (lunes, viernes),
            )
            celdas = [
                {"cubicador": r[0], "cubicador_email": r[1], "dia": r[2].isoformat(),
                 "n": r[3], "ton": float(r[4] or 0), "cortas": r[5], "obras": r[6], "n_usc": r[7]}
                for r in cur.fetchall()
            ]
            # Los cubicadores que el tablero debe mostrar SIEMPRE, tengan carga o no: sin ellos
            # una semana vacía se vería como si el área no existiera.
            cur.execute(
                """SELECT DISTINCT u.email, u.nombre || ' ' || COALESCE(u.apellido,'') AS nombre
                     FROM proyecto_usuarios pu JOIN users u ON u.id = pu.user_id
                    WHERE pu.rol = 'cubicador' AND COALESCE(u.activo, TRUE) ORDER BY 2"""
            )
            cubicadores = [{"email": r[0], "nombre": (r[1] or "").strip()} for r in cur.fetchall()]
    return {"lunes": lunes.isoformat(), "viernes": viernes.isoformat(),
            "celdas": celdas, "cubicadores": cubicadores}
