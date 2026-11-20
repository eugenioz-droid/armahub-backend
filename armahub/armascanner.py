"""
armascanner.py
--------------
Lo que ArmaScanner hace en ArmaHub con la ficha de su licencia (licencias.py): elegir la obra
y subir el plano. [Usuario 19-nov, programa §8.13 paso 1]

    GET  /armascanner/obras          las obras de ArmaHub, para el filtro de texto de ArmaScanner
    POST /armascanner/subir-plano    el plano entra como una carga de despiece más (y su copia de
                                     trabajo queda como la versión en línea del plano)
    GET  /armascanner/planos         los planos en línea, con quién tiene tomado cada uno
    POST /armascanner/planos/tomar   tomar un plano: queda a su nombre y se baja su copia de trabajo
    POST /armascanner/planos/soltar  soltarlo sin subir (quien lo tomó, o un administrador)

Y lo que muestra la caluga ArmaScanner del portal (sesión del portal; SPECS §13) [Usuario 19-nov:
«Más que pedidos enviados debiera ver sus obras y ojalá una línea por cada carga de elemento
constructivo… Con su cantidad de Items, kilos y lo típico que usamos. La licencia capaz la
dejamos acá, aquí buscamos un usuario existente y lo agregamos»]:

    GET  /armascanner/cargas         Mis obras: una línea por carga (plano = un elemento)
    GET  /armascanner/mi-licencia    Instalar: mi licencia y mis equipos
    GET  /armascanner/licencias      Licencias (administración): quién la tiene
    GET  /armascanner/uso            Uso (administración): KPIs y uso por usuario
    GET  /armascanner/descarga       Instalar: la versión vigente y su enlace de descarga
    GET  /armascanner/actualizacion  (ficha) ¿hay una versión más nueva? → «Actualizar» en ArmaScanner
    GET/POST/PATCH /armascanner/versiones   Versiones (administración): publicar, retirar, obligatoria

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
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

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
    paquete: Optional[UploadFile] = File(None),
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
):
    """El plano entra como carga de despiece. `datos` (JSON): obra, plano_code, reemplaza
    (códigos anteriores del plano), version, equipo, revision {ID_UNICO: estado}, sin_subir
    [{sector, piso, ciclo}] (barras que no pudieron ir en el archivo). Con `paquete` (la copia de
    trabajo y su estado) y en `datos` plano, version_base (la versión en línea de la que sale la
    copia), numero, titulo, rev, elemento y aprobadas: queda como la versión en línea siguiente
    del plano, libre. No sube encima de un plano tomado por otro ni de una versión más nueva."""
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
    plano = (d.get("plano") or "").strip()[:300] if paquete is not None else ""
    en_linea = None
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            if job:  # la obra de aSa: la que ya existe en ArmaHub, o se adopta (programacion.adoptar_obra)
                from .programacion import adoptar_obra
                obra = adoptar_obra(cur, job, user["email"], en_cubicacion=True)
            if plano:  # antes de tocar las barras: un DWG no se junta con otro
                en_linea = _plano_en_linea(cur, obra, plano)
                motivo = motivo_para_subir(en_linea, user["email"], d.get("version_base"))
                if motivo:
                    raise HTTPException(status_code=409, detail=motivo)
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
    version = _guardar_paquete(obra, plano, await paquete.read(), en_linea, user["email"], d, res) if plano else None
    audit(user["email"], "armascanner_subir_plano",
          f"{plano_code} → {res.get('proyecto')}: {res.get('barras')} barras, {res.get('kilos')} kg, "
          f"{n_pend} sin aprobar" + (f", en línea v{version}" if version else ""), "proyecto", obra)
    return {"ok": True, "import_id": import_id, "obra": res.get("proyecto"), "id_proyecto": obra,
            "barras": res.get("barras"),
            "kilos": res.get("kilos"), "reemplazadas": res.get("barras_eliminadas_previo"),
            "pendientes": n_pend, "rechazadas": res.get("rejected") or [], "version": version}


# ══════ Planos en línea: subir, tomar, soltar (mig 169; SPECS §5.4) ══════
# [Usuario 20-nov: «mi usuario Emilio podrá descargar el plano que tengo de martín de solier? el
# que ya avanzamos? sería clave que pudiera tomarlo y terminar la tarea él… pensaba que todos los
# usuarios tengan acceso a todo, eso sí con los bloqueos respectivos»]
# Una copia vigente por plano en R2: el paquete que arma ArmaScanner al subir (copia de trabajo,
# su lectura y su estado). Un DWG no se junta con otro: mientras alguien lo tiene tomado nadie
# más sube encima, y tampoco sube quien trabaja sobre una versión vieja. Al subir, el plano queda
# libre con la versión siguiente. Lo suelta quien lo tomó o un administrador. Todos los usuarios
# con licencia ven y toman los planos de todas las obras.

def _cuando(ts) -> str:
    """«20-11 10:30», en la hora de Chile."""
    if not ts:
        return ""
    try:
        from zoneinfo import ZoneInfo
        ts = ts.astimezone(ZoneInfo("America/Santiago"))
    except Exception:
        pass
    return ts.strftime("%d-%m %H:%M")


def _nombres(cur, emails) -> dict:
    """{correo: «Nombre Apellido»} (el correo, si el usuario no tiene nombre)."""
    emails = sorted({e for e in emails if e})
    if not emails:
        return {}
    cur.execute("SELECT email, nombre, apellido FROM users WHERE email = ANY(%s)", (emails,))
    return {e: ((n or "") + " " + (a or "")).strip() or e for e, n, a in cur.fetchall()}


def _plano_en_linea(cur, obra: str, plano: str):
    cur.execute("""SELECT version, archivo, tomado_por, tomado_el, subido_por, subido_el
                     FROM planos_obra WHERE id_proyecto = %s AND plano = %s""", (obra, plano))
    f = cur.fetchone()
    if not f:
        return None
    nombres = _nombres(cur, (f[2], f[4]))
    return {"version": f[0], "archivo": f[1], "tomado_por": f[2], "tomado_nombre": nombres.get(f[2], f[2]),
            "tomado_el": _cuando(f[3]), "subido_nombre": nombres.get(f[4], f[4]), "subido_el": _cuando(f[5])}


def motivo_para_subir(en_linea, email: str, version_base) -> str:
    """"" si la copia se puede subir encima del plano en línea; si no, el motivo. Función pura.
    en_linea = {version, tomado_por, tomado_nombre, tomado_el, subido_nombre, subido_el} o None
    (el plano todavía no está en línea); version_base = la versión de la que salió la copia."""
    if not en_linea:
        return ""
    if en_linea["tomado_por"] and en_linea["tomado_por"] != email:
        return (f"Lo tiene tomado {en_linea['tomado_nombre']} desde el {en_linea['tomado_el']}: no se puede subir "
                "encima hasta que lo suba o lo suelte.")
    try:
        base = int(version_base or 0)
    except (TypeError, ValueError):
        base = 0
    if base < en_linea["version"]:
        return (f"En ArmaHub hay una versión más nueva del plano (v{en_linea['version']}, de "
                f"{en_linea['subido_nombre']}, {en_linea['subido_el']}): tómalo para traerla antes de subir.")
    return ""


def clave_paquete(obra: str, plano: str, version: int) -> str:
    """La key del paquete en R2: una carpeta por plano (va la huella del nombre: el nombre trae
    cualquier letra) y un archivo por versión, para no pisar la vigente mientras sube la nueva."""
    import hashlib
    return f"obras/{obra}/planos/{hashlib.md5(plano.encode('utf-8')).hexdigest()[:16]}/v{version}.zip"


def _guardar_paquete(obra, plano, contenido: bytes, antes, email, d, res) -> int:
    """El paquete queda como la versión en línea siguiente y el plano, libre; la anterior se
    borra (una sola copia). Devuelve la versión."""
    from . import storage
    previa = (antes or {}).get("version") or 0
    nueva = previa + 1
    clave = clave_paquete(obra, plano, nueva)
    try:
        storage.upload_file(clave, contenido, "application/zip")
    except Exception as e:
        raise HTTPException(status_code=502, detail="Las barras entraron, pero la copia del plano no se pudo guardar "
                                                    f"({str(e)[:80]}): vuelve a subirlo.")

    def txt(k, largo):
        return str(d.get(k) or "").strip()[:largo] or None

    aprobadas = d.get("aprobadas") if isinstance(d.get("aprobadas"), int) else None
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO planos_obra (id_proyecto, plano, numero, titulo, revision, elemento, version, archivo,
                                         tamano, barras, aprobadas, kg, subido_por, subido_el)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (id_proyecto, plano) DO UPDATE SET
                    numero = EXCLUDED.numero, titulo = EXCLUDED.titulo, revision = EXCLUDED.revision,
                    elemento = EXCLUDED.elemento, version = EXCLUDED.version, archivo = EXCLUDED.archivo,
                    tamano = EXCLUDED.tamano, barras = EXCLUDED.barras, aprobadas = EXCLUDED.aprobadas,
                    kg = EXCLUDED.kg, subido_por = EXCLUDED.subido_por, subido_el = NOW(),
                    tomado_por = NULL, tomado_el = NULL
                 WHERE planos_obra.version = %s
                   AND (planos_obra.tomado_por IS NULL OR planos_obra.tomado_por = %s)
                RETURNING version
            """, (obra, plano, txt("numero", 40), txt("titulo", 300), txt("rev", 20), txt("elemento", 20), nueva,
                  clave, len(contenido), res.get("barras"), aprobadas, res.get("kilos"), email, previa, email))
            ok = cur.fetchone()
    if not ok:  # mientras subía, otro lo tomó o subió otra versión
        storage.delete_file(clave)
        raise HTTPException(status_code=409, detail="El plano cambió en ArmaHub mientras subía (otro usuario lo tomó o "
                                                    "lo subió): las barras entraron, la copia del plano no.")
    if antes and antes.get("archivo") and antes["archivo"] != clave:
        storage.delete_file(antes["archivo"])
    return nueva


@router.get("/armascanner/planos")
def planos_en_linea(obra: str = "", credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Los planos en línea de todas las obras; con `obra` (id de ArmaHub o código de aSa), los de
    esa obra. Cada uno con su versión, quién lo subió y quién lo tiene tomado."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            filtro, params = "", []
            if obra.strip():
                filtro, params = "WHERE p.id_proyecto = %s OR pr.asa_job_id = %s", [obra.strip(), obra.strip()]
            cur.execute(f"""
                SELECT p.id_proyecto, COALESCE(pr.nombre_proyecto, p.id_proyecto), COALESCE(pr.asa_job_id, ''),
                       p.plano, p.numero, p.titulo, p.revision, p.elemento, p.version, p.barras, p.aprobadas,
                       p.kg, p.tamano, p.subido_por, p.subido_el, p.tomado_por, p.tomado_el
                  FROM planos_obra p
                  LEFT JOIN proyectos pr ON pr.id_proyecto = p.id_proyecto
                  {filtro}
                 ORDER BY 2, p.numero, p.plano
            """, params)
            filas = cur.fetchall()
            nombres = _nombres(cur, [f[13] for f in filas] + [f[15] for f in filas])
    yo = user["email"]
    return {"yo": yo, "admin": user["role"] in ("admin", "admin_calidad"), "planos": [
        {"obra": f[0], "obra_nombre": f[1], "asa": f[2], "plano": f[3], "numero": f[4] or "", "titulo": f[5] or "",
         "revision": f[6] or "", "elemento": f[7] or "", "version": f[8], "barras": f[9], "aprobadas": f[10],
         "kg": round(float(f[11]), 1) if f[11] is not None else None, "tamano": f[12],
         "subido_por": nombres.get(f[13], f[13] or ""), "subido_el": _cuando(f[14]),
         "tomado_por": nombres.get(f[15], f[15]) if f[15] else "", "tomado_el": _cuando(f[16]),
         "tomado_por_mi": f[15] == yo} for f in filas]}


class PlanoEnLinea(BaseModel):
    obra: str
    plano: str


@router.post("/armascanner/planos/tomar")
def tomar_plano(datos: PlanoEnLinea, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Tomar un plano: queda a su nombre (nadie más sube encima) y va el enlace para bajar su
    copia de trabajo. Tomar uno propio otra vez no cambia nada."""
    from . import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            cur.execute("""
                UPDATE planos_obra SET tomado_por = %s, tomado_el = COALESCE(tomado_el, NOW())
                 WHERE id_proyecto = %s AND plano = %s AND (tomado_por IS NULL OR tomado_por = %s)
             RETURNING version, archivo, tamano
            """, (user["email"], datos.obra, datos.plano, user["email"]))
            fila = cur.fetchone()
            if not fila:
                otro = _plano_en_linea(cur, datos.obra, datos.plano)
                if not otro:
                    raise HTTPException(status_code=404, detail="Ese plano no está en ArmaHub.")
                raise HTTPException(status_code=409, detail=f"Lo tiene tomado {otro['tomado_nombre']} desde el "
                                                            f"{otro['tomado_el']}.")
    audit(user["email"], "armascanner_tomar_plano", f"{datos.plano} (v{fila[0]})", "proyecto", datos.obra)
    url = storage.generate_presigned_url(fila[1], expires=DESCARGA_SEGUNDOS) if fila[1] else None
    return {"ok": True, "version": fila[0], "url": url, "tamano": fila[2]}


@router.post("/armascanner/planos/soltar")
def soltar_plano(datos: PlanoEnLinea, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Soltar un plano sin subirlo: queda libre con la versión que tenía. Lo suelta quien lo
    tomó; el de otro, sólo un administrador (lo que esa persona no subió queda en su equipo)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            antes = _plano_en_linea(cur, datos.obra, datos.plano)
            if not antes:
                raise HTTPException(status_code=404, detail="Ese plano no está en ArmaHub.")
            otro = antes["tomado_por"] and antes["tomado_por"] != user["email"]
            if otro and user["role"] not in ("admin", "admin_calidad"):
                raise HTTPException(status_code=403, detail=f"Lo tiene tomado {antes['tomado_nombre']}: sólo esa "
                                                            "persona o un administrador lo puede soltar.")
            cur.execute("""UPDATE planos_obra SET tomado_por = NULL, tomado_el = NULL
                            WHERE id_proyecto = %s AND plano = %s""", (datos.obra, datos.plano))
    if antes["tomado_por"]:
        audit(user["email"], "armascanner_soltar_plano",
              datos.plano + (f" (lo tenía {antes['tomado_por']})" if otro else ""), "proyecto", datos.obra)
    return {"ok": True}


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
    elemento constructivo), de todas las obras: el trabajo es colaborativo y todos los usuarios
    con licencia ven todo [Usuario 20-nov: «pensaba que todos los usuarios tengan acceso a
    todo»]."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            # Las barras se resumen aparte, por carga, y se cruzan después: la consulta no depende
            # de que `imports` tenga llave primaria para agrupar (el 19-nov la pantalla quedó
            # vacía con el plano ya subido). La obra con LEFT JOIN: una carga no se pierde de la
            # lista si su obra cambió de id.
            cur.execute("""
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
                 WHERE i.herramienta = 'ArmaScanner'
                 ORDER BY i.id DESC
                 LIMIT 1000
            """)
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


# ══════ Versiones: descargar, publicar y actualizar (mig 168) ══════
# La vigente es la activa más nueva. Las versiones se comparan como texto: AAAA-MM-DD (y
# AAAA-MM-DD.N si sale más de una el mismo día), que es licencia.VERSION en ArmaScanner.
DESCARGA_SEGUNDOS = 600


def _vigente(cur):
    cur.execute("""SELECT id, version, archivo, tamano, notas, obligatoria, publicada_el
                     FROM armascanner_versiones WHERE activa ORDER BY version DESC LIMIT 1""")
    return cur.fetchone()


def _nombre_instalador(version: str) -> str:
    """El ZIP que se publica: la aplicación en su carpeta; se instala sola al abrirla. No un
    instalador de un solo .exe: ése lo borra el antivirus de la empresa (Trend Micro, 19-nov)."""
    return f"ArmaScanner-{version}.zip"


def _enlace(fila) -> str:
    from . import storage
    return storage.generate_presigned_url(fila[2], expires=DESCARGA_SEGUNDOS,
                                          descargar_como=_nombre_instalador(fila[1]))


def _version_dict(fila, con_enlace=False) -> dict:
    d = {"id": fila[0], "version": fila[1], "tamano": fila[3], "notas": fila[4] or "",
         "obligatoria": bool(fila[5]), "publicada_el": fila[6].isoformat() if fila[6] else None}
    if con_enlace:
        d["url"] = _enlace(fila)
    return d


@router.get("/armascanner/descarga")
def descarga(user=Depends(get_current_user)):
    """Instalar: la versión vigente y su enlace de descarga (vale DESCARGA_SEGUNDOS)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            fila = _vigente(cur)
    if not fila:
        return {"version": None}
    audit(user.get("email", "?"), "armascanner_descarga", fila[1], "armascanner", fila[1])
    return _version_dict(fila, con_enlace=True)


@router.get("/armascanner/actualizacion")
def actualizacion(version: str = "", credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """ArmaScanner pregunta, con su ficha, si hay una versión más nueva que la suya. Si la hay,
    va con su enlace de descarga: el botón «Actualizar» la baja e instala."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _usuario(cur, credentials.credentials)
            fila = _vigente(cur)
    if not fila or not version or fila[1] <= version.strip():
        return {"hay": False, "version": fila[1] if fila else None}
    return dict(_version_dict(fila, con_enlace=True), hay=True)


@router.get("/armascanner/versiones")
def versiones(admin=Depends(require_admin_or_admin_calidad)):
    """Versiones: todas, la más nueva primero."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT id, version, archivo, tamano, notas, obligatoria, publicada_el, activa, publicada_por
                             FROM armascanner_versiones ORDER BY version DESC""")
            filas = cur.fetchall()
            vig = _vigente(cur)
    return {"vigente": vig[1] if vig else None,
            "versiones": [dict(_version_dict(f), activa=f[7], publicada_por=f[8]) for f in filas]}


@router.post("/armascanner/versiones")
def publicar(archivo: UploadFile = File(...), version: str = Form(...), notas: str = Form(""),
                   obligatoria: bool = Form(False), admin=Depends(require_admin_or_admin_calidad)):
    """Publicar una versión: el ZIP (ArmaScanner/empaquetar/construir.py) va a R2 y queda vigente."""
    import re
    from . import storage
    version = (version or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}(\.\d+)?", version):
        raise HTTPException(status_code=400, detail="La versión va como AAAA-MM-DD (o AAAA-MM-DD.2).")
    if not (archivo.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="El archivo debe ser el ZIP de ArmaScanner (.zip).")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM armascanner_versiones WHERE version = %s", (version,))
            if cur.fetchone():
                raise HTTPException(status_code=409, detail=f"La versión {version} ya está publicada.")
    clave = f"armascanner/versiones/{version}/{_nombre_instalador(version)}"
    archivo.file.seek(0, 2)
    tamano = archivo.file.tell()
    archivo.file.seek(0)
    storage.upload_fileobj(clave, archivo.file, "application/zip")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO armascanner_versiones (version, archivo, tamano, notas, obligatoria, publicada_por)
                           VALUES (%s, %s, %s, %s, %s, %s)""",
                        (version, clave, tamano, (notas or "").strip()[:2000] or None, obligatoria, admin.get("email")))
    audit(admin.get("email", "?"), "armascanner_publicar", f"{version} ({tamano / 1e6:.1f} MB)"
          + (" obligatoria" if obligatoria else ""), "armascanner", version)
    return {"ok": True, "version": version, "tamano": tamano}


class CambioVersion(BaseModel):
    activa: Optional[bool] = None
    obligatoria: Optional[bool] = None


@router.patch("/armascanner/versiones/{vid}")
def cambiar_version(vid: int, datos: CambioVersion, admin=Depends(require_admin_or_admin_calidad)):
    """Retirar (activa=false) o volver a poner una versión; marcarla obligatoria o no."""
    sets, valores = [], []
    for campo in ("activa", "obligatoria"):
        v = getattr(datos, campo)
        if v is not None:
            sets.append(f"{campo} = %s")
            valores.append(v)
    if not sets:
        return {"ok": True}
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE armascanner_versiones SET {', '.join(sets)} WHERE id = %s RETURNING version",
                        valores + [vid])
            fila = cur.fetchone()
    if not fila:
        raise HTTPException(status_code=404, detail="Versión no encontrada.")
    audit(admin.get("email", "?"), "armascanner_version", f"{fila[0]}: {datos.model_dump(exclude_none=True)}",
          "armascanner", fila[0])
    return {"ok": True}
