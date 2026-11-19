"""
armascanner.py
--------------
Lo que ArmaScanner hace en ArmaHub con la ficha de su licencia (licencias.py): elegir la obra
y subir el plano. [Usuario 19-nov, programa §8.13 paso 1]

    GET  /armascanner/obras          las obras de ArmaHub, para el filtro de texto de ArmaScanner
    POST /armascanner/subir-plano    el plano entra como una carga de despiece más

Y lo que muestra la caluga ArmaScanner del portal (sesión del portal; SPECS §13) [Usuario 19-nov:
«Más que pedidos enviados debiera ver sus obras y ojalá una línea por cada carga de elemento
constructivo… Con su cantidad de Items, kilos y lo típico que usamos. La licencia capaz la
dejamos acá, aquí buscamos un usuario existente y lo agregamos»]:

    GET  /armascanner/cargas         Mis obras: una línea por carga (plano = un elemento)
    GET  /armascanner/mi-licencia    Instalar: mi licencia y mis equipos
    GET  /armascanner/licencias      Licencias (administración): quién la tiene
    GET  /armascanner/uso            Uso (administración): KPIs y uso por usuario

SUBIR UN PLANO es la importación de A Detailer de siempre (importer.import_armadetailer), con
tres reglas propias:
  - Reemplaza sólo las barras de ESE plano (por su PLANO_CODE, estable por plano). Nunca toca
    otro plano, ni A Detailer, ni lo ingresado a mano (la importación sólo tiene autoridad
    sobre origen 'csv').
  - Suben todas las barras con su estado de revisión (aprobada · duda · pendiente) en
    `barras.revision`; lo que no está aprobado queda contado por SECTOR|PISO|CICLO en
    `imports.pendientes`, incluidas las barras que no pudieron subir por datos incompletos.
  - Mientras una carga vigente tenga pendientes en una combinación, esa combinación no se
    exporta (export.py, `combinaciones_bloqueadas`).

Quién puede: el mismo que puede importar en el portal (cualquier usuario interno; el cliente
no), con licencia vigente.
"""

import json
from io import BytesIO

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials

from .auth import get_current_user, require_admin_or_admin_calidad
from .db import audit, get_conn
from .licencias import _bearer, estado_licencia, leer_ficha

router = APIRouter()

PRODUCTO = "armascanner"
REVISIONES = ("aprobada", "duda", "pendiente")


def _usuario(cur, ficha: str) -> dict:
    """El usuario de la ficha, si su licencia vale hoy. 401 si la ficha no sirve, 403 si la
    licencia no vale o es un cliente."""
    from datetime import datetime, timezone
    email = leer_ficha(ficha, PRODUCTO)
    cur.execute("""
        SELECT u.role, COALESCE(u.activo, TRUE), l.activa, l.vence
          FROM users u
          LEFT JOIN licencias l ON l.user_id = u.id AND l.producto = %s
         WHERE u.email = %s
    """, (PRODUCTO, email))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="El usuario ya no existe en ArmaHub.")
    role, activo, activa, vence = row
    vale, motivo = estado_licencia(None if activa is None else (activa, vence, activo),
                                   datetime.now(timezone.utc).date())
    if not vale:
        raise HTTPException(status_code=403, detail=motivo)
    if role == "cliente":
        raise HTTPException(status_code=403, detail="Tu usuario no puede cargar despieces.")
    return {"email": email, "role": role}


def pendientes_por_combinacion(barras: list) -> dict:
    """{"SECTOR|PISO|CICLO": n} de las barras no aprobadas. `barras`: [{sector, piso, ciclo,
    revision}]; las que no subieron vienen con revision 'duda'."""
    out = {}
    for b in barras:
        if b.get("revision") != "aprobada":
            k = "|".join(str(b.get(c) or "").strip().upper() for c in ("sector", "piso", "ciclo"))
            out[k] = out.get(k, 0) + 1
    return out


@router.get("/armascanner/obras")
def obras(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Las obras COMO ESTÁN EN aSa (el espejo `asa_obras`), para elegir con filtro de texto en
    ArmaScanner: la misma lista que los selectores de obra del portal (programacion.asa_espejo).
    [Usuario 19-nov: «hay que traer las obras de aSa, no las que creamos en la plataforma»;
    decisión del 13-oct, mig 143] La que ya existe en ArmaHub trae su `id_proyecto` (una obra
    antigua enlazada a su job de aSa); las demás se adoptan solas al subir el primer plano."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _usuario(cur, credentials.credentials)
            cur.execute("""
                SELECT a.asa_job_id, a.nombre, a.cliente, a.estado,
                       (SELECT MIN(p.id_proyecto) FROM proyectos p WHERE p.asa_job_id = a.asa_job_id)
                  FROM asa_obras a
                 WHERE NOT a.excluida
                   AND a.asa_job_id !~ 'B$'                 -- el gemelo «- BARRAS» no es otra obra
                 ORDER BY (COALESCE(a.estado, '') = 'Open') DESC, a.ultima_actividad DESC NULLS LAST, a.nombre
            """)
            return {"obras": [{"asa": r[0], "nombre": r[1], "cliente": r[2] or "", "estado": r[3] or "",
                               "id": r[4] or ""} for r in cur.fetchall()]}


@router.post("/armascanner/subir-plano")
async def subir_plano(
    archivo: UploadFile = File(...),
    datos: str = Form(...),
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
):
    """El plano entra como carga de despiece. `datos` (JSON): obra, plano_code, reemplaza
    (códigos anteriores del plano), version, equipo, revision {ID_UNICO: estado}, sin_subir
    [{sector, piso, ciclo}] (barras que no pudieron ir en el archivo)."""
    from .importer import import_armadetailer
    try:
        d = json.loads(datos)
    except ValueError:
        raise HTTPException(status_code=400, detail="Datos del plano ilegibles.")
    obra, plano_code = (d.get("obra") or "").strip(), (d.get("plano_code") or "").strip()
    job = (d.get("asa") or "").strip()
    if not (obra or job) or not plano_code:
        raise HTTPException(status_code=400, detail="Falta la obra o el código del plano.")
    revision = {k: v for k, v in (d.get("revision") or {}).items() if v in REVISIONES}
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            if job:  # la obra de aSa: la que ya existe en ArmaHub, o se adopta (programacion.adoptar_obra)
                from .programacion import adoptar_obra
                obra = adoptar_obra(cur, job, user["email"], en_cubicacion=True)
            # Códigos anteriores del mismo plano (se limpió y se escaneó de nuevo): sus barras se
            # reemplazan también. Sólo códigos de cargas de ArmaScanner de esta obra: por aquí no
            # se pueden borrar barras de A Detailer ni de otra obra.
            anteriores = [c.strip() for c in (d.get("reemplaza") or []) if isinstance(c, str) and c.strip()
                          and ";" not in c]
            if anteriores:
                cur.execute("""
                    SELECT DISTINCT plano_code FROM imports
                     WHERE id_proyecto = %s AND herramienta = 'ArmaScanner' AND plano_code = ANY(%s)
                """, (obra, anteriores))
                anteriores = [r[0] for r in cur.fetchall()]
    reemplazar = ";".join(dict.fromkeys([plano_code] + anteriores))

    contenido = await archivo.read()
    res = await import_armadetailer(
        file=UploadFile(BytesIO(contenido), filename=archivo.filename or f"{plano_code}.csv"),
        user=user, obra_destino=obra, reasignar_a=None, forzar=True, calculista=None,
        confirmar_nuevo=False, constructora_id=None, asignar_a=None, owner_id=None,
        proyecto_nombre_manual=None, proyecto_nombre_override=None,
        replace_keys=None, replace_full_planos=reemplazar,
    )
    if not res.get("ok"):
        raise HTTPException(status_code=422, detail=res.get("error") or res.get("mensaje") or "La carga no entró.")

    with get_conn() as conn:
        with conn.cursor() as cur:
            import_id = res["import_id"]
            cur.execute("SELECT id_unico, sector, piso, ciclo FROM barras WHERE import_id = %s", (import_id,))
            filas = cur.fetchall()
            estado = [{"sector": s, "piso": p, "ciclo": c, "revision": revision.get(u, "pendiente")}
                      for u, s, p, c in filas]
            cur.executemany("UPDATE barras SET revision = %s WHERE import_id = %s AND id_unico = %s",
                            [(revision.get(u, "pendiente"), import_id, u) for u, *_ in filas])
            sin_subir = [dict(b, revision="duda") for b in (d.get("sin_subir") or [])]
            pend = pendientes_por_combinacion(estado + sin_subir)
            cur.execute("""
                UPDATE imports SET herramienta = 'ArmaScanner', herramienta_version = %s, equipo = %s,
                                   pendientes = %s::jsonb
                 WHERE id = %s
            """, ((d.get("version") or "")[:40] or None, (d.get("equipo") or "")[:120] or None,
                  json.dumps(pend), import_id))
    n_pend = sum(pend.values())
    audit(user["email"], "armascanner_subir_plano",
          f"{plano_code} → {res.get('proyecto')}: {res.get('barras')} barras, {res.get('kilos')} kg, "
          f"{n_pend} sin aprobar", "proyecto", obra)
    return {"ok": True, "import_id": import_id, "obra": res.get("proyecto"), "id_proyecto": obra,
            "barras": res.get("barras"),
            "kilos": res.get("kilos"), "reemplazadas": res.get("barras_eliminadas_previo"),
            "pendientes": n_pend, "rechazadas": res.get("rejected") or []}


# ══════ La caluga ArmaScanner del portal ══════

def licencias_vigentes(cur, email: str) -> list:
    """Los productos con licencia vigente hoy para ese correo (GET /me: la caluga ArmaScanner
    sólo se muestra a quien la tiene, y al administrador)."""
    from datetime import datetime, timezone
    cur.execute("""
        SELECT l.producto, l.activa, l.vence, COALESCE(u.activo, TRUE)
          FROM licencias l JOIN users u ON u.id = l.user_id
         WHERE u.email = %s
    """, (email,))
    hoy = datetime.now(timezone.utc).date()
    return [p for p, activa, vence, activo in cur.fetchall() if estado_licencia((activa, vence, activo), hoy)[0]]


def _es_admin(user) -> bool:
    return user.get("role") in ("admin", "admin_calidad")


def _con_licencia_o_admin(cur, user):
    if not _es_admin(user) and PRODUCTO not in licencias_vigentes(cur, user.get("email", "")):
        raise HTTPException(status_code=403, detail="Requiere licencia de ArmaScanner.")


def pendientes_de(pend) -> int:
    return sum(int(n or 0) for n in (pend or {}).values())


@router.get("/armascanner/cargas")
def cargas(user=Depends(get_current_user)):
    """Mis obras: una línea por carga vigente de ArmaScanner (cada plano es la carga de un
    elemento constructivo). El cubicador ve las obras donde subió planos —con lo que subieron
    todos en ellas: el trabajo es colaborativo—; el administrador, todas."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            filtro, params = "", []
            if not _es_admin(user):
                filtro = """AND i.id_proyecto IN (SELECT id_proyecto FROM imports
                                                    WHERE herramienta = 'ArmaScanner' AND usuario = %s)"""
                params.append(user.get("email", ""))
            # Las barras se resumen aparte, por carga, y se cruzan después: la consulta no depende
            # de que `imports` tenga llave primaria para agrupar (el 19-nov la pantalla quedó
            # vacía con el plano ya subido). La obra con LEFT JOIN: una carga no se pierde de la
            # lista si su obra cambió de id.
            cur.execute(f"""
                SELECT i.id, i.id_proyecto, COALESCE(p.nombre_proyecto, i.nombre_proyecto, i.id_proyecto),
                       b.plano, i.usuario, i.fecha, i.herramienta_version, i.pendientes,
                       b.items, b.kg, b.sectores, b.pisos, b.ciclos
                  FROM imports i
                  LEFT JOIN proyectos p ON p.id_proyecto = i.id_proyecto
                  JOIN (SELECT import_id, MAX(nombre_plano) AS plano, COUNT(*) AS items,
                               COALESCE(SUM(peso_total), 0) AS kg,
                               string_agg(DISTINCT sector, ', ') AS sectores,
                               string_agg(DISTINCT piso, ', ') AS pisos,
                               string_agg(DISTINCT ciclo, ', ' ORDER BY ciclo) AS ciclos
                          FROM barras
                         WHERE import_id IN (SELECT id FROM imports WHERE herramienta = 'ArmaScanner')
                         GROUP BY import_id) b ON b.import_id = i.id
                 WHERE i.herramienta = 'ArmaScanner' {filtro}
                 ORDER BY i.id DESC
                 LIMIT 1000
            """, params)
            filas = cur.fetchall()
    out = []
    for (iid, obra, nombre_obra, plano, usuario, fecha, version, pend, items, kg,
         sector, piso, ciclos) in filas:
        plano = (plano or "").rsplit(".dwg", 1)[0]
        out.append({"id": iid, "obra": obra, "obra_nombre": nombre_obra, "plano": plano,
                    "elemento": sector or "", "piso": piso or "", "ciclos": ciclos or "",
                    "items": items, "kg": round(float(kg), 1), "pendientes": pendientes_de(pend),
                    "usuario": usuario, "fecha": fecha, "version": version})
    return {"cargas": out}


@router.get("/armascanner/mi-licencia")
def mi_licencia(user=Depends(get_current_user)):
    """Instalar: mi licencia (vencimiento) y mis equipos."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            cur.execute("""
                SELECT l.id, l.activa, l.vence, COALESCE(l.max_equipos, 2)
                  FROM licencias l JOIN users u ON u.id = l.user_id
                 WHERE u.email = %s AND l.producto = %s
            """, (user.get("email", ""), PRODUCTO))
            row = cur.fetchone()
            equipos = []
            if row:
                cur.execute("""SELECT equipo, ultimo_uso, version FROM licencia_equipos
                                WHERE licencia_id = %s ORDER BY primer_uso""", (row[0],))
                equipos = [{"equipo": e, "ultimo_uso": u.isoformat() if u else None, "version": v}
                           for e, u, v in cur.fetchall()]
    return {"activa": bool(row and row[1]), "vence": row[2].isoformat() if row and row[2] else None,
            "max_equipos": row[3] if row else 2, "equipos": equipos}


@router.get("/armascanner/licencias")
def licencias(admin=Depends(require_admin_or_admin_calidad)):
    """Licencias: quién la tiene (también las retiradas, para volver a darlas)."""
    from .licencias import licencias_por_usuario
    with get_conn() as conn:
        with conn.cursor() as cur:
            por_usuario = licencias_por_usuario(cur)
            ids = [uid for uid, prods in por_usuario.items() if PRODUCTO in prods]
            usuarios = {}
            if ids:
                cur.execute("""SELECT id, email, nombre, apellido, role, COALESCE(activo, TRUE)
                                 FROM users WHERE id = ANY(%s)""", (ids,))
                usuarios = {r[0]: r for r in cur.fetchall()}
    out = []
    for uid in ids:
        u = usuarios.get(uid)
        if not u:
            continue
        lic = por_usuario[uid][PRODUCTO]
        out.append({"user_id": uid, "email": u[1], "nombre": ((u[2] or "") + " " + (u[3] or "")).strip() or u[1],
                    "role": u[4], "usuario_activo": u[5], **lic})
    out.sort(key=lambda x: (not x["activa"], x["nombre"].lower()))
    return {"licencias": out}


@router.get("/armascanner/uso")
def uso(admin=Depends(require_admin_or_admin_calidad)):
    """Uso: KPIs de los últimos 30 días y el uso por usuario (cargas vigentes de ArmaScanner)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT COUNT(*) FROM licencias
                            WHERE producto = %s AND activa AND (vence IS NULL OR vence >= CURRENT_DATE)""",
                        (PRODUCTO,))
            activas = cur.fetchone()[0]
            cur.execute("""
                SELECT i.usuario, COUNT(DISTINCT i.id), COUNT(b.*), COALESCE(SUM(b.peso_total), 0),
                       COUNT(b.*) FILTER (WHERE b.revision = 'aprobada'), MAX(i.fecha)
                  FROM imports i JOIN barras b ON b.import_id = i.id
                 WHERE i.herramienta = 'ArmaScanner'
                   AND i.fecha >= to_char(NOW() - INTERVAL '30 days', 'YYYY-MM-DD')
                 GROUP BY i.usuario
                 ORDER BY 4 DESC
            """)
            filas = cur.fetchall()
    por_usuario = [{"usuario": u, "planos": pl, "items": it, "kg": round(float(kg), 1),
                    "aprobadas_pct": round(100.0 * ap / it, 1) if it else 0.0, "ultima": ul}
                   for u, pl, it, kg, ap, ul in filas]
    items, aprobadas = sum(f[2] for f in filas), sum(f[4] for f in filas)
    return {"licencias_activas": activas, "planos": sum(f[1] for f in filas),
            "kg": round(sum(float(f[3]) for f in filas), 1),
            "aprobadas_pct": round(100.0 * aprobadas / items, 1) if items else 0.0,
            "por_usuario": por_usuario}
