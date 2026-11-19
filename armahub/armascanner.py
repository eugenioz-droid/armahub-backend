"""
armascanner.py
--------------
Lo que ArmaScanner hace en ArmaHub con la ficha de su licencia (licencias.py): elegir la obra
y subir el plano. [Usuario 19-nov, programa §8.13 paso 1]

    GET  /armascanner/obras          las obras de ArmaHub, para el filtro de texto de ArmaScanner
    POST /armascanner/subir-plano    el plano entra como una carga de despiece más

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
    """Las obras de ArmaHub (id y nombre), para elegir con filtro de texto en ArmaScanner."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _usuario(cur, credentials.credentials)
            cur.execute("SELECT id_proyecto, nombre_proyecto FROM proyectos ORDER BY nombre_proyecto")
            return {"obras": [{"id": r[0], "nombre": r[1]} for r in cur.fetchall()]}


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
    if not obra or not plano_code:
        raise HTTPException(status_code=400, detail="Falta la obra o el código del plano.")
    revision = {k: v for k, v in (d.get("revision") or {}).items() if v in REVISIONES}
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
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
    return {"ok": True, "import_id": import_id, "obra": res.get("proyecto"), "barras": res.get("barras"),
            "kilos": res.get("kilos"), "reemplazadas": res.get("barras_eliminadas_previo"),
            "pendientes": n_pend, "rechazadas": res.get("rejected") or []}
