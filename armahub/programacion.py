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


# ---------------------------------------------------------------------------
# OBRAS: el espejo de aSa y la asignación de USC
# ---------------------------------------------------------------------------
# Las obras NO se crean a mano acá: se traen de aSa. Pero no se consulta aSa en vivo —el
# usuario reporta que se atora con consultas grandes—, sino que se sincroniza a un espejo
# en Postgres y el buscador lee de ahí. Ver docs/integracion_asa.md.

# Nombres posibles de cada dato en aSa. Todavía no conocemos el esquema de getJobData, así
# que en vez de adivinar UNO y fallar, se acepta cualquiera de los que aparecen en los
# endpoints ya documentados. Cuando se confirme, esto sigue funcionando igual.
_CAMPOS_ASA = {
    "asa_job_id": ("JobID", "JobId", "Job", "ID", "Id"),
    "job_key":    ("JobKey", "JobKeyID"),
    "nombre":     ("JobName", "Name", "Descr", "Description"),
    "cliente":    ("CustomerName", "Customer", "BusPartnerName"),
    "descripcion": ("DetailingLocName", "Descr", "Description", "JobDescr"),
    "estado":     ("JobStatusDescr", "JobStatusID", "Status", "JobStatus", "StatusID"),
}

# Los ÚNICOS campos que se le piden a aSa para las obras. Esto no es una optimización:
# getJobData devuelve 131 columnas, y entre ellas van PrimaryContactFirstName,
# PrimaryPhoneDetail, PrimaryEmailDetail y nueve líneas de dirección. Con el $select
# esos datos NUNCA SALEN DE aSa — no es que los protejamos después, es que no los
# pedimos. De paso, la respuesta pesa una fracción. Ver docs/asa_campos.md.
_SELECT_OBRAS = ["JobID", "JobKey", "JobName", "CustomerName",
                 "JobStatusID", "JobStatusDescr", "DetailingLocName", "LastModified"]

# Sólo las obras ABIERTAS. aSa tiene entre 600 y 1.400 jobs, la mayoría cerrados o
# inactivos, y una obra cerrada no se programa: traerla sería ensuciar el buscador con
# ruido histórico y hacer esperar al usuario por datos que no va a usar. El filtro lo
# aplica aSa (OData `$filter`), no nosotros: así viaja menos y el servidor trabaja menos.
_FILTRO_OBRAS = "JobStatusID eq 'O'"


def _primer(fila: dict, nombres) -> Optional[str]:
    """El primer campo presente y no vacío. aSa no siempre nombra igual el mismo dato."""
    for n in nombres:
        v = fila.get(n)
        if v not in (None, ""):
            return v
    return None


def _exigir_admin(user):
    if user.get("role") not in ("admin", "admin_calidad"):
        raise HTTPException(status_code=403, detail="Solo administración puede hacer esto.")


@router.get("/programacion/asa/estado")
def asa_estado(user=Depends(get_current_user)):
    """Si aSa está configurado y contesta. Existe para que el tab diga QUÉ falta en vez de
    mostrar una lista vacía sin explicación."""
    from . import asa
    _exigir_admin(user)
    info = asa.estado()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), MAX(visto_el) FROM asa_obras")
            n, ultimo = cur.fetchone()
            cur.execute(
                """SELECT endpoint, fin, filas, ok, detalle FROM asa_sync
                    ORDER BY id DESC LIMIT 1"""
            )
            ult = cur.fetchone()
    info["espejo"] = {
        "obras": n or 0,
        "ultima_sync": ultimo.isoformat() if ultimo else None,
        "ultimo_intento": ({"endpoint": ult[0],
                            "fin": ult[1].isoformat() if ult[1] else None,
                            "filas": ult[2], "ok": ult[3], "detalle": ult[4]} if ult else None),
    }
    return info


@router.post("/programacion/asa/sincronizar")
def asa_sincronizar(endpoint: str = "getJobData", todas: bool = False,
                    user=Depends(get_current_user)):
    """Trae las obras de aSa al espejo. Es el «Refrescar ahora» — la misma función que
    después va a correr sola una vez al día.

    Se usa `getJobData` (una fila por obra) y NUNCA `getOrderSummary`, que viene al grano de
    CC × diámetro × producto: serían decenas de miles de filas para sacar un listado de
    obras, y es justo el tipo de consulta con la que aSa se atora."""
    from . import asa
    _exigir_admin(user)
    if not asa.configurado():
        raise HTTPException(status_code=503,
                            detail="aSa no está configurado. Faltan las variables ASA_API_URL / ASA_API_KEY.")
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO asa_sync (endpoint, lanzado_por) VALUES (%s, %s) RETURNING id",
                (endpoint, email),
            )
            sync_id = cur.fetchone()[0]
        conn.commit()

    try:
        # El $select y el filtro sólo aplican al endpoint de obras, que es el que
        # conocemos. Para cualquier otro se pide completo, porque no sabemos qué columnas
        # tiene. `todas=true` trae también las cerradas, por si alguna vez hace falta
        # programar sobre una obra que aSa ya dio por terminada.
        es_obras = (endpoint == "getJobData")
        filas = asa.consultar_todo(
            endpoint,
            select=_SELECT_OBRAS if es_obras else None,
            filtro=(None if (todas or not es_obras) else _FILTRO_OBRAS),
        )
    except asa.AsaError as e:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE asa_sync SET fin=now(), ok=FALSE, detalle=%s WHERE id=%s",
                            (str(e)[:400], sync_id))
            conn.commit()
        raise HTTPException(status_code=502, detail=str(e))

    # Un solo viaje a la base en vez de uno por obra (ver la nota en asa_sincronizar_pedidos).
    valores = []
    for fila in filas:
        if not isinstance(fila, dict):
            continue
        job_id = _primer(fila, _CAMPOS_ASA["asa_job_id"])
        if not job_id:
            continue
        key = _primer(fila, _CAMPOS_ASA["job_key"])
        try:
            key = int(key) if key is not None else None
        except (TypeError, ValueError):
            key = None
        valores.append((
            str(job_id)[:120], key,
            str(_primer(fila, _CAMPOS_ASA["nombre"]) or "")[:250],
            (str(_primer(fila, _CAMPOS_ASA["cliente"]) or "") or None),
            (str(_primer(fila, _CAMPOS_ASA["descripcion"]) or "") or None),
            (str(_primer(fila, _CAMPOS_ASA["estado"]) or "") or None),
            sync_id))

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM asa_obras")
            antes = cur.fetchone()[0]
            cur.executemany(
                """
                INSERT INTO asa_obras (asa_job_id, job_key, nombre, cliente, descripcion,
                                       estado, visto_el, sync_id)
                VALUES (%s, %s, %s, %s, %s, %s, now(), %s)
                ON CONFLICT (asa_job_id) DO UPDATE
                   SET job_key = EXCLUDED.job_key, nombre = EXCLUDED.nombre,
                       cliente = EXCLUDED.cliente, descripcion = EXCLUDED.descripcion,
                       estado = EXCLUDED.estado, visto_el = now(),
                       sync_id = EXCLUDED.sync_id
                """,
                valores,
            )
            cur.execute("SELECT COUNT(*) FROM asa_obras")
            nuevas = cur.fetchone()[0] - antes
            cur.execute(
                "UPDATE asa_sync SET fin=now(), ok=TRUE, filas=%s, nuevas=%s WHERE id=%s",
                (len(valores), nuevas, sync_id),
            )
        conn.commit()
    audit(email, "asa_sync", f"{endpoint}: {len(filas)} filas, {nuevas} nuevas")
    return {"ok": True, "filas": len(filas), "nuevas": nuevas, "endpoint": endpoint}


@router.get("/programacion/asa/buscar")
def asa_buscar(q: str = "", limite: int = 30, user=Depends(get_current_user)):
    """Busca en el ESPEJO, no en aSa. Por eso es instantáneo y funciona aunque aSa esté
    caído. Marca cuáles ya están adoptadas para no traer dos veces la misma."""
    _exigir_admin(user)
    termino = "%" + (q or "").strip().lower() + "%"
    limite = max(1, min(int(limite or 30), 100))
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.asa_job_id, a.nombre, a.cliente, a.estado, a.descripcion,
                       p.id_proyecto, COALESCE(p.nombre_proyecto, '')
                  FROM asa_obras a
                  LEFT JOIN proyectos p ON p.asa_job_id = a.asa_job_id
                 WHERE lower(a.nombre) LIKE %s
                    OR lower(a.asa_job_id) LIKE %s
                    OR lower(COALESCE(a.cliente,'')) LIKE %s
                 ORDER BY (p.id_proyecto IS NOT NULL), a.nombre
                 LIMIT %s
                """,
                (termino, termino, termino, limite),
            )
            filas = [
                {"asa_job_id": r[0], "nombre": r[1], "cliente": r[2], "estado": r[3],
                 "descripcion": r[4], "adoptada": r[5] is not None,
                 "id_proyecto": r[5], "nombre_armahub": r[6] or None}
                for r in cur.fetchall()
            ]
    return {"resultados": filas}


class AdoptarBody(BaseModel):
    asa_job_id: str
    id_proyecto: Optional[str] = None     # si viene, ENLAZA a una obra que ya existe
    nombre: Optional[str] = None


@router.post("/programacion/asa/adoptar")
def asa_adoptar(body: AdoptarBody, user=Depends(get_current_user)):
    """Trae una obra del espejo a ArmaHub. Dos caminos, y la diferencia importa:

      - Sin `id_proyecto`: la obra no existe en ArmaHub → se CREA con origen='asa'.
      - Con `id_proyecto`: la obra ya existe con otro nombre → se ENLAZA escribiéndole el
        asa_job_id. Nunca se duplica.
    """
    _exigir_admin(user)
    email = user.get("email", "?")
    job = (body.asa_job_id or "").strip()
    if not job:
        raise HTTPException(status_code=400, detail="Falta el identificador de la obra en aSa.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT nombre, cliente FROM asa_obras WHERE asa_job_id = %s", (job,))
            fila = cur.fetchone()
            if not fila:
                raise HTTPException(status_code=404, detail="Esa obra no está en el espejo de aSa.")
            cur.execute("SELECT id_proyecto FROM proyectos WHERE asa_job_id = %s", (job,))
            ya = cur.fetchone()
            if ya:
                raise HTTPException(status_code=409,
                                    detail="Esa obra de aSa ya está enlazada a «%s»." % ya[0])

            if body.id_proyecto:
                cur.execute("SELECT 1 FROM proyectos WHERE id_proyecto = %s", (body.id_proyecto,))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="La obra de ArmaHub no existe.")
                cur.execute("UPDATE proyectos SET asa_job_id = %s WHERE id_proyecto = %s",
                            (job, body.id_proyecto))
                audit(email, "asa_enlazar", f"{job} -> {body.id_proyecto}")
                return {"ok": True, "id_proyecto": body.id_proyecto, "creada": False}

            nombre = (body.nombre or fila[0] or job).strip()[:250]
            # El id del proyecto en ArmaHub lo manda aSa: así el enlace es evidente al
            # mirar la tabla, sin tener que cruzar por otra columna.
            id_proyecto = job[:60]
            cur.execute("SELECT 1 FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if cur.fetchone():
                raise HTTPException(
                    status_code=409,
                    detail="Ya existe una obra con el código «%s» en ArmaHub. Enlázala en vez "
                           "de crearla." % id_proyecto)
            cur.execute(
                """INSERT INTO proyectos (id_proyecto, nombre_proyecto, asa_job_id, origen)
                   VALUES (%s, %s, %s, 'asa')""",
                (id_proyecto, nombre, job),
            )
            audit(email, "asa_adoptar", f"{job} -> creada {id_proyecto} «{nombre}»")
    return {"ok": True, "id_proyecto": id_proyecto, "creada": True}


# ---------------------------------------------------------------------------
# DASHBOARD: el reporte de aSa que hoy vive en Power BI
# ---------------------------------------------------------------------------
# Las dimensiones por las que aSa agrupa. Todo lo que el reporte muestra o filtra tiene
# que estar acá, porque `$apply` sólo devuelve lo que se le pide agrupar.
_DIMS_PEDIDOS = ["ControlCode", "JobID", "JobName", "Descr", "DetailPerson",
                 "OrderDate", "PromisedDeliveryDate", "Status"]


def _fecha(valor):
    """aSa manda fechas ISO con hora y zona. Aquí sólo importa el día."""
    if not valor:
        return None
    try:
        return date.fromisoformat(str(valor)[:10])
    except ValueError:
        return None


@router.post("/programacion/asa/sincronizar-pedidos")
def asa_sincronizar_pedidos(anio: Optional[int] = None, user=Depends(get_current_user)):
    """Trae los pedidos de aSa de UN año, agregados por código de control.

    Un año por llamada, a propósito: `$apply` no pagina —devuelve todo el resultado en una
    respuesta— así que el año es lo que acota el tamaño. Pedir cinco años de una sería
    justo la consulta que atora a aSa."""
    from . import asa
    _exigir_admin(user)
    if not asa.configurado():
        raise HTTPException(status_code=503, detail="aSa no está configurado.")
    anio = int(anio or date.today().year)
    if not (2015 <= anio <= date.today().year + 1):
        raise HTTPException(status_code=400, detail="Año fuera de rango.")
    email = user.get("email", "?")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO asa_sync (endpoint, lanzado_por) VALUES (%s,%s) RETURNING id",
                        ("getOrderSummary/%d" % anio, email))
            sync_id = cur.fetchone()[0]
        conn.commit()

    filtro = "OrderDate ge %d-01-01 and OrderDate le %d-12-31" % (anio, anio)
    try:
        filas = asa.consultar_agregado("getOrderSummary", _DIMS_PEDIDOS,
                                       "TotalKgs", alias="Kgs", filtro=filtro)
    except asa.AsaError as e:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE asa_sync SET fin=now(), ok=FALSE, detalle=%s WHERE id=%s",
                            (str(e)[:400], sync_id))
            conn.commit()
        raise HTTPException(status_code=502, detail=str(e))

    # Los 5.000 INSERT van en UNA llamada, no en 5.000. Con `execute` en bucle serían
    # 5.000 viajes de ida y vuelta a Supabase: el endpoint tardaría minutos y el usuario
    # creería que se colgó. `executemany` de psycopg >=3.1 los manda en modo pipeline —es
    # la misma razón por la que la carga de barras lo usa (ver requirements.txt).
    valores = []
    for f in filas:
        cc = (f.get("ControlCode") or "").strip()
        if not cc:
            continue     # hay pedidos sin código de control; no son del reporte
        orden = _fecha(f.get("OrderDate"))
        valores.append((
            cc[:60], (f.get("JobID") or None), str(f.get("JobName") or "")[:250],
            (f.get("Descr") or None), (f.get("DetailPerson") or None),
            orden, _fecha(f.get("PromisedDeliveryDate")),
            (f.get("Status") or None), round(float(f.get("Kgs") or 0), 2),
            orden.year if orden else anio, sync_id))

    with get_conn() as conn:
        with conn.cursor() as cur:
            # «Nuevas» se mide por diferencia de conteo en vez de con RETURNING (xmax=0):
            # con executemany habría que recolectar 5.000 resultados para un número que
            # es informativo. El conteo cuesta una consulta.
            cur.execute("SELECT COUNT(*) FROM asa_pedidos")
            antes = cur.fetchone()[0]
            cur.executemany(
                """
                INSERT INTO asa_pedidos (control_code, asa_job_id, job_name, descr,
                                         detail_person, order_date, promised_date,
                                         estado, kg, anio, visto_el, sync_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now(), %s)
                ON CONFLICT (control_code) DO UPDATE
                   SET asa_job_id=EXCLUDED.asa_job_id, job_name=EXCLUDED.job_name,
                       descr=EXCLUDED.descr, detail_person=EXCLUDED.detail_person,
                       order_date=EXCLUDED.order_date, promised_date=EXCLUDED.promised_date,
                       estado=EXCLUDED.estado, kg=EXCLUDED.kg, anio=EXCLUDED.anio,
                       visto_el=now(), sync_id=EXCLUDED.sync_id
                """,
                valores,
            )
            cur.execute("SELECT COUNT(*) FROM asa_pedidos")
            nuevas = cur.fetchone()[0] - antes
            cur.execute("UPDATE asa_sync SET fin=now(), ok=TRUE, filas=%s, nuevas=%s WHERE id=%s",
                        (len(valores), nuevas, sync_id))
        conn.commit()
    audit(email, "asa_sync_pedidos", f"{anio}: {len(filas)} CC, {nuevas} nuevos")
    return {"ok": True, "anio": anio, "filas": len(filas), "nuevas": nuevas}


@router.get("/programacion/asa/reporte")
def asa_reporte(anio: Optional[int] = None, meses: str = "",
                user=Depends(get_current_user)):
    """Las dos tablas del reporte y las listas para los filtros.

    La división NO es un campo de aSa: PROGRAMADOS son los que tienen fecha comprometida
    (`promised_date`) y POR PROGRAMAR los que no. El año y el mes filtran por `order_date`,
    que es la única fecha que tienen las dos tablas.

    El front recibe las filas ya separadas y los totales ya sumados: si sumara él, el total
    de la pantalla podría no cuadrar con el de un export, y ese tipo de diferencia destruye
    la confianza en un reporte."""
    _exigir_admin(user)
    anio = int(anio or date.today().year)
    lista_meses = [int(m) for m in meses.split(",") if m.strip().isdigit() and 1 <= int(m) <= 12]

    where = ["anio = %s"]
    params: list = [anio]
    if lista_meses:
        where.append("EXTRACT(MONTH FROM order_date) = ANY(%s)")
        params.append(lista_meses)
    cond = " WHERE " + " AND ".join(where)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT control_code, asa_job_id, job_name, descr, detail_person, "
                "       order_date, promised_date, estado, kg "
                "  FROM asa_pedidos" + cond +
                " ORDER BY job_name, descr, control_code", params)
            filas = [
                {"cc": r[0], "asa_job_id": r[1], "obra": r[2], "descr": r[3] or "",
                 "persona": r[4], "orden": r[5].isoformat() if r[5] else None,
                 "promesa": r[6].isoformat() if r[6] else None,
                 "estado": r[7], "kg": float(r[8] or 0)}
                for r in cur.fetchall()
            ]
            # Los años y las personas salen de TODO el espejo, no del filtro: si salieran
            # del filtro, al elegir un mes desaparecerían los botones de los otros.
            cur.execute("SELECT DISTINCT anio FROM asa_pedidos WHERE anio IS NOT NULL ORDER BY anio")
            anios = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT detail_person FROM asa_pedidos "
                        " WHERE detail_person IS NOT NULL AND detail_person <> '' ORDER BY 1")
            personas = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT COUNT(*), MAX(visto_el) FROM asa_pedidos WHERE anio = %s", (anio,))
            n_anio, ultimo = cur.fetchone()

    por_programar = [f for f in filas if not f["promesa"]]
    programados = [f for f in filas if f["promesa"]]
    return {
        "anio": anio, "meses": lista_meses,
        "anios": anios, "personas": personas,
        "obras": sorted({f["obra"] for f in filas}),
        "por_programar": por_programar,
        "programados": programados,
        "kg_por_programar": round(sum(f["kg"] for f in por_programar), 2),
        "kg_programados": round(sum(f["kg"] for f in programados), 2),
        "espejo": {"filas_anio": n_anio or 0,
                   "ultima_sync": ultimo.isoformat() if ultimo else None},
    }


@router.get("/programacion/usc")
def listar_usc(user=Depends(get_current_user)):
    """Los usuarios que pueden ser USC, y las obras asignadas a cada uno.

    Devuelve también `hay_usc`: hoy todavía no existen usuarios con rol 'usc' (el usuario
    los va a crear). Sin ese dato el tab se vería vacío y parecería roto."""
    _exigir_admin(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                # OJO con los dos nombres de la misma idea: en `users` la columna es `role`
                # (inglés) y en `proyecto_usuarios` es `rol` (español). Escribir `u.rol` no
                # da un resultado vacío: revienta la consulta entera, y el tab se ve en
                # blanco sin decir por qué. Ya pasó una vez.
                """SELECT u.id, u.email, u.nombre || ' ' || COALESCE(u.apellido,'') AS nombre, u.role,
                          (SELECT COUNT(*) FROM proyecto_usuarios pu
                            WHERE pu.user_id = u.id AND pu.rol = 'usc') AS obras
                     FROM users u
                    WHERE u.role = 'usc' AND COALESCE(u.activo, TRUE)
                    ORDER BY 3"""
            )
            usc = [{"id": r[0], "email": r[1], "nombre": (r[2] or "").strip() or r[1],
                    "rol": r[3], "obras": r[4]} for r in cur.fetchall()]
    return {"usc": usc, "hay_usc": bool(usc)}


@router.get("/programacion/obras-asignacion")
def obras_asignacion(user=Depends(get_current_user)):
    """Todas las obras de ArmaHub con su USC. Es la lista de la derecha del tab: se ve de
    una qué obras no tienen dueño, que es el dato que hoy no existe en ninguna parte."""
    _exigir_admin(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.id_proyecto, COALESCE(p.nombre_proyecto, p.id_proyecto),
                       p.asa_job_id, COALESCE(p.origen, 'armahub'),
                       u.id, u.email, COALESCE(u.nombre || ' ' || COALESCE(u.apellido,''), u.email),
                       (SELECT COUNT(*) FROM tareas_programacion t WHERE t.id_proyecto = p.id_proyecto),
                       (SELECT COUNT(*) FROM sector_estado se WHERE se.id_proyecto = p.id_proyecto)
                  FROM proyectos p
                  LEFT JOIN proyecto_usuarios pu ON pu.id_proyecto = p.id_proyecto AND pu.rol = 'usc'
                  LEFT JOIN users u ON u.id = pu.user_id
                 ORDER BY (u.id IS NOT NULL), COALESCE(p.nombre_proyecto, p.id_proyecto)
                """
            )
            obras = [
                {"id_proyecto": r[0], "obra": r[1], "asa_job_id": r[2], "origen": r[3],
                 "usc_id": r[4], "usc_email": r[5],
                 "usc": (r[6] or "").strip() if r[4] else None,
                 "tareas": r[7], "frentes": r[8]}
                for r in cur.fetchall()
            ]
    return {"obras": obras}


class AsignarBody(BaseModel):
    user_id: Optional[int] = None          # None = quitar la asignación


@router.post("/programacion/obras/{id_proyecto}/usc")
def asignar_usc(id_proyecto: str, body: AsignarBody, user=Depends(get_current_user)):
    """Asigna (o quita) el USC de una obra. Una obra tiene UN USC: por eso se borra la
    asignación anterior antes de poner la nueva, en vez de acumular filas."""
    _exigir_admin(user)
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Obra no encontrada.")
            cur.execute("DELETE FROM proyecto_usuarios WHERE id_proyecto = %s AND rol = 'usc'",
                        (id_proyecto,))
            if body.user_id is None:
                audit(email, "usc_quitar", id_proyecto)
                return {"ok": True, "usc_id": None}
            cur.execute("SELECT rol FROM users WHERE id = %s", (body.user_id,))
            fila = cur.fetchone()
            if not fila:
                raise HTTPException(status_code=404, detail="Usuario no encontrado.")
            cur.execute(
                """INSERT INTO proyecto_usuarios (id_proyecto, user_id, rol)
                   VALUES (%s, %s, 'usc')
                   ON CONFLICT (id_proyecto, user_id) DO UPDATE SET rol = 'usc'""",
                (id_proyecto, body.user_id),
            )
            audit(email, "usc_asignar", f"{id_proyecto} -> user {body.user_id}")
    return {"ok": True, "usc_id": body.user_id}
