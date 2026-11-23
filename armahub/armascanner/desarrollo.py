"""
Desarrollo: los planos que el lector no reconoce y los reportes de errores que llegan de
ArmaScanner, con su estado; y las oficinas de cálculo, con el lector que lee sus planos.
"""

import json
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from ..auth import require_admin_or_admin_calidad
from ..db import audit, get_conn
from ..licencias import _bearer
from .acceso import _es_admin, _usuario
from .comun import AVISO_DESARROLLO, DESCARGA_SEGUNDOS, _avisar, _borrar, _cuando, _nombres, _texto

router = APIRouter()


# ── Desarrollo: lo que llega de ArmaScanner en un ZIP, con su estado (nuevo → en_estudio → resuelto |
# descartado). Dos tipos: «reporte» («Enviar reporte»: diagnóstico del equipo, registro del último escaneo
# y bitácora del plano) y «plano» (un plano que el lector no reconoce: el DWG y lo que el lector
# encontró; lo manda el cubicador con un clic). Al llegar, aviso al administrador; al resolverse, al
# cubicador. Y las oficinas de cálculo: qué lector lee sus planos. [Usuario 20-nov: «un sistema que le
# permita al cubicador enviar el reporte, así puedo trabajar contigo sin enviarnos archivos»; 23-nov:
# «que se guarde el plano… el usuario obtenga un mensaje y un botón de confirmar… a mí me llega un
# aviso también… un flujo que no dependa de estar enviando planos manualmente sin control ni
# trazabilidad»; «un pequeño apartado donde listemos las oficinas de cálculo… así se va estableciendo
# una base de conocimiento»]
# Desarrollo es de LECTURAS: el caso es el plano que no se lee (tipo «plano»); sus envíos, de uno o
# varios cubicadores, son su historial, y resolverlo resuelve todo lo que estaba abierto. Los estados los
# cambia el agente con la ficha (empaquetar/traer_desarrollo.py), no el usuario. Los reportes de errores
# (tipo «reporte») no son Desarrollo: se listan en Uso. [Usuario 23-nov: «más que cada prueba que se
# hizo… es saber que ese plano ya se resolvió»; «esos botones son más para ti… tú vas a resolver el caso
# y luego actualizarlo y marcarlo como resuelto… Esto apunta a resolver lecturas, no a resolver bugs»]
REPORTE_MAX = 25 * 1024 * 1024
ESTADOS_CASO = ("nuevo", "en_estudio", "resuelto", "descartado")
CASOS_ABIERTOS = ["nuevo", "en_estudio"]
# El caso es el plano DE UNA OBRA: la llave es (COALESCE(obra_id, obra), plano), porque dos obras pueden
# tener un plano «E-01». Un envío sin plano es un caso solo. Lo mismo en SQL (CASOS_NUEVOS, que cuenta
# planos, no envíos; CAST para que valga en Postgres y en SQLite), en recibir_reporte, en _cambiar_caso y
# en _caso.
OBRA_CASO = "COALESCE(obra_id, obra, '')"
CASOS_NUEVOS = f"""SELECT COUNT(DISTINCT CASE WHEN COALESCE(plano, '') = '' THEN 'id:' || CAST(id AS TEXT)
                                             ELSE 'p:' || {OBRA_CASO} || '|' || plano END)
                     FROM armascanner_reportes WHERE estado = 'nuevo' AND tipo = 'plano'"""


def _admins(cur) -> list:
    cur.execute("SELECT email FROM users WHERE role = 'admin' AND activo = TRUE")
    return [r[0] for r in cur.fetchall()]


@router.post("/armascanner/reportes")
async def recibir_reporte(datos: str = Form("{}"), archivo: UploadFile = File(...),
                          credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Un caso de Desarrollo. `datos` (JSON): tipo ("plano" | "reporte"), equipo, version, obra, obra_id,
    plano, comentario, lector (lo que el lector encontró). Un plano que ya tiene un caso abierto en la
    misma obra no se repite: responde `ya_estaba` sin guardar nada. El ZIP va a R2 antes que la fila; si
    la base no confirma, se borra."""
    d = _datos_reporte(datos)
    tipo = "plano" if d.get("tipo") == "plano" else "reporte"
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            ya = _caso_abierto(cur, d) if tipo == "plano" else None
    if ya:
        return {"ok": True, "id": ya, "ya_estaba": True}
    contenido = await archivo.read()
    if len(contenido) > REPORTE_MAX:
        raise HTTPException(status_code=413, detail="El reporte pesa más de 25 MB.")
    clave = _subir_reporte(contenido)
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                rid = _guardar_reporte(cur, user["email"], d, tipo, clave, len(contenido))
                admins = _admins(cur)
                quien = _nombres(cur, [user["email"]]).get(user["email"], user["email"])
    except Exception:
        _borrar(clave)  # la base no confirmó: el ZIP no queda suelto en R2
        raise
    audit(user["email"], "armascanner_reporte",
          f"#{rid} {tipo} {_texto(d, 'plano', 80) or ''} {_texto(d, 'comentario', 80) or ''}".strip(),
          "armascanner", str(rid))
    _avisar([a for a in admins if a != user["email"]], _aviso_de_envio(quien, tipo, d), AVISO_DESARROLLO)
    return {"ok": True, "id": rid, "ya_estaba": False}


def _datos_reporte(datos: str) -> dict:
    """El JSON `datos` de un envío ({} si no se lee)."""
    try:
        return json.loads(datos or "{}")
    except ValueError:
        return {}


def _caso_abierto(cur, d: dict):
    """El id del caso abierto del mismo plano en la misma obra, o None (un plano no se repite)."""
    if not _texto(d, "plano", 300):
        return None
    cur.execute(f"""SELECT id FROM armascanner_reportes
                     WHERE tipo = 'plano' AND estado = ANY(%s) AND plano = %s AND {OBRA_CASO} = %s
                     ORDER BY id DESC LIMIT 1""",
                (CASOS_ABIERTOS, _texto(d, "plano", 300), _texto(d, "obra_id", 80) or _texto(d, "obra", 300) or ""))
    ya = cur.fetchone()
    return ya[0] if ya else None


def _subir_reporte(contenido: bytes) -> str:
    """Sube el ZIP del envío a R2 con una key propia y la devuelve; si R2 falla, 502."""
    import secrets
    import time
    from .. import storage
    clave = f"armascanner/reportes/{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}.zip"
    try:
        storage.upload_file(clave, contenido, "application/zip")
    except Exception as e:
        _borrar(clave)
        raise HTTPException(status_code=502, detail=f"El reporte no se pudo guardar en ArmaHub ({str(e)[:80]}).")
    return clave


def _guardar_reporte(cur, email: str, d: dict, tipo: str, clave: str, tamano: int) -> int:
    """La fila del envío; devuelve su id."""
    cur.execute("""INSERT INTO armascanner_reportes (email, equipo, version, obra, plano, comentario, archivo,
                                                     tamano, tipo, obra_id, lector)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (email, _texto(d, "equipo", 80), _texto(d, "version", 40), _texto(d, "obra", 300), _texto(d, "plano", 300),
                 _texto(d, "comentario", 2000), clave, tamano, tipo, _texto(d, "obra_id", 80), _texto(d, "lector", 1000)))
    return cur.fetchone()[0]


def _aviso_de_envio(quien: str, tipo: str, d: dict) -> str:
    """El aviso a los administradores de un envío que llegó."""
    return f"ArmaScanner · Desarrollo: {quien} envió " + (f"el plano {_texto(d, 'plano', 80)} (no se lee)"
                                                         if tipo == "plano" else "un reporte") + "."


@router.get("/armascanner/desarrollo")
def desarrollo(admin=Depends(require_admin_or_admin_calidad)):
    """La pestaña Desarrollo (administrador, sólo lectura): un caso por plano que no se lee (los abiertos
    primero, el más nuevo arriba) con la oficina de cálculo de su obra y sus envíos, y las oficinas. El
    caso está abierto mientras tenga un envío abierto; si no, queda como quedó el último."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            # (los textos que faltan, vacíos)
            cur.execute("""SELECT r.id, r.tipo, r.estado, COALESCE(r.email, ''), COALESCE(r.equipo, ''),
                                  COALESCE(r.version, ''), COALESCE(r.obra, ''), COALESCE(r.obra_id, ''),
                                  COALESCE(r.plano, ''), COALESCE(r.comentario, ''), COALESCE(r.lector, ''),
                                  COALESCE(r.nota, ''), COALESCE(r.version_resuelto, ''), r.tamano, r.creado_el,
                                  p.calculista_id
                             FROM armascanner_reportes r LEFT JOIN proyectos p ON p.id_proyecto = r.obra_id
                            WHERE r.tipo = 'plano' ORDER BY r.id DESC LIMIT 500""")
            filas = cur.fetchall()
            nombres = _nombres(cur, [f[3] for f in filas])
            oficinas, calculistas = _oficinas(cur, filas)
    planos = {}
    for f in filas:  # el más nuevo primero
        planos.setdefault(_caso(f), []).append(f)
    casos = [_caso_de(envios, nombres, calculistas) for envios in planos.values()]
    casos.sort(key=lambda c: (c["estado"] not in CASOS_ABIERTOS, -c["id"]))
    return {"casos": casos, "oficinas": oficinas,
            "otras": sorted(({"id": k, "nombre": v} for k, v in calculistas.items()
                             if k not in {o["id"] for o in oficinas}), key=lambda x: x["nombre"].lower())}


def _caso_de(envios, nombres, calculistas) -> dict:
    """El caso de un plano con sus envíos (filas de desarrollo(), el más nuevo primero): está abierto mientras
    tenga un envío abierto; si no, queda como quedó el último (y lleva su nota y la versión que lo resolvió)."""
    u = envios[0]
    estados = {e[2] for e in envios}
    estado = next((e for e in CASOS_ABIERTOS if e in estados), u[2])
    cierre = u if estado not in CASOS_ABIERTOS else None
    oficina = next((calculistas.get(e[15], "") for e in envios if e[15] is not None), "")
    return {"id": u[0], "estado": estado, "obra": u[6], "obra_id": u[7], "plano": u[8], "oficina": oficina,
            "usuario": nombres.get(u[3], u[3]), "version": u[5], "el": _cuando(u[14]), "comentario": u[9], "lector": u[10],
            "nota": cierre[11] if cierre else "", "version_resuelto": cierre[12] if cierre else "",
            "envios": [_envio(e, nombres) for e in envios]}


def _envio(e, nombres) -> dict:
    """Un envío del caso."""
    return {"id": e[0], "estado": e[2], "usuario": nombres.get(e[3], e[3]), "equipo": e[4], "version": e[5],
            "comentario": e[9], "lector": e[10], "nota": e[11], "version_resuelto": e[12], "el": _cuando(e[14])}


def _caso(f) -> str:
    """La llave del caso de un envío (fila de desarrollo()): su obra y su plano, como CASOS_NUEVOS."""
    rid, obra, obra_id, plano = f[0], f[6], f[7], f[8]
    return f"p:{obra_id or obra or ''}|{plano}" if plano else f"id:{rid}"


def _oficinas(cur, casos) -> tuple:
    """Las oficinas de cálculo que importan a ArmaScanner (agregadas a la lista, o con obras o casos en
    ArmaScanner), con sus obras y sus planos en estudio; y {id: nombre} de todas las oficinas."""
    cur.execute("""SELECT c.id, c.nombre, o.lector, o.notas, o.calculista_id IS NOT NULL FROM calculistas c
                     LEFT JOIN armascanner_oficinas o ON o.calculista_id = c.id""")
    todas = cur.fetchall()
    cur.execute("""SELECT p.calculista_id, COALESCE(ao.nombre, p.nombre_proyecto, x.id_proyecto)
                     FROM armascanner_obras x JOIN proyectos p ON p.id_proyecto = x.id_proyecto
                     LEFT JOIN asa_obras ao ON ao.asa_job_id = p.asa_job_id
                    WHERE p.calculista_id IS NOT NULL""")
    obras = {}
    for cid, nombre in cur.fetchall():
        obras.setdefault(cid, []).append(nombre)
    abiertos = {}
    for f in casos:
        if f[2] in CASOS_ABIERTOS and f[15] is not None:
            abiertos.setdefault(f[15], set()).add(_caso(f))
    oficinas = [{"id": cid, "nombre": nombre, "lector": lector or "", "notas": notas or "",
                 "obras": sorted(obras.get(cid, [])), "abiertos": len(abiertos.get(cid, ()))}
                for cid, nombre, lector, notas, agregada in todas if agregada or cid in obras or cid in abiertos]
    return sorted(oficinas, key=lambda o: o["nombre"].lower()), {f[0]: f[1] for f in todas}


class CasoDesarrollo(BaseModel):
    id: int = 0
    estado: str
    version: str = ""
    nota: Optional[str] = None


@router.post("/armascanner/desarrollo-ficha")
def cambiar_caso_ficha(datos: CasoDesarrollo, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """En estudio, resuelto (con la versión que lo resolvió) o descartado, con la ficha de ArmaScanner de
    un administrador: lo hace el agente desde el equipo de desarrollo (empaquetar/traer_desarrollo.py)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
    if not _es_admin(user):
        raise HTTPException(status_code=403, detail="Sólo un administrador.")
    return _cambiar_caso(user["email"], datos.id, datos)


def _cambiar_caso(email: str, rid: int, datos: CasoDesarrollo) -> dict:
    """Cambia el estado del caso del plano del envío `rid` (los envíos del mismo plano, de la misma obra y
    del mismo tipo): resolverlo o descartarlo cierra todos sus envíos abiertos; «en estudio» toma los
    nuevos (y reabre `rid` si estaba cerrado). Al cerrarse, se les avisa a quienes lo mandaron."""
    if datos.estado not in ESTADOS_CASO:
        raise HTTPException(status_code=400, detail="Estado no válido.")
    cierra = datos.estado in ("resuelto", "descartado")
    version = (datos.version or "").strip()[:40] or None
    with get_conn() as conn:
        with conn.cursor() as cur:
            plano, filas = _cambiar_envios(cur, rid, datos, cierra, version, email)
    audit(email, "armascanner_desarrollo", f"#{rid} {datos.estado} ({len(filas)})" + (f" {version}" if version else ""),
          "armascanner", str(rid))
    autores = sorted({f[0] for f in filas if f[0] and f[0] != email})
    if cierra and autores:
        _avisar(autores, _aviso_de_cierre(datos.estado, plano, filas, version), AVISO_DESARROLLO)
    return {"ok": True}


def _cambiar_envios(cur, rid: int, datos: CasoDesarrollo, cierra: bool, version, email: str) -> tuple:
    """Cambia el estado de los envíos del caso de `rid` (ver _cambiar_caso). Devuelve (el plano, [(correo,
    tipo, nota)] de los envíos que cambiaron). 404 si el envío no está."""
    cur.execute(f"SELECT plano, tipo, {OBRA_CASO} FROM armascanner_reportes WHERE id = %s", (rid,))
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(status_code=404, detail="Caso no encontrado.")
    plano, tipo, obra = fila[0] or "", fila[1], fila[2]
    cur.execute(f"""UPDATE armascanner_reportes
                       SET estado = %s, nota = COALESCE(%s, nota),
                           version_resuelto = CASE WHEN %s = 'resuelto' THEN %s ELSE NULL END,
                           resuelto_por = CASE WHEN %s THEN %s ELSE NULL END,
                           resuelto_el = CASE WHEN %s THEN NOW() ELSE NULL END
                     WHERE id = %s OR (%s <> '' AND plano = %s AND {OBRA_CASO} = %s AND tipo = %s
                                       AND estado = ANY(%s))
                 RETURNING email, tipo, nota""",
                (datos.estado, (datos.nota or "").strip()[:2000] if datos.nota is not None else None,
                 datos.estado, version, cierra, email, cierra, rid, plano, plano, obra, tipo,
                 CASOS_ABIERTOS if cierra else ["nuevo"]))
    return plano, cur.fetchall()


def _aviso_de_cierre(estado: str, plano: str, filas, version) -> str:
    """El aviso a quienes mandaron el caso cuando se resuelve o se descarta."""
    no_lee = any(f[1] == "plano" for f in filas)
    nota = next((f[2] for f in filas if f[2]), "")
    que = f"lo que reportaste del plano {plano}" if plano else "tu reporte"
    if estado == "resuelto":
        return ((f"ArmaScanner ya lee el plano {plano}" if no_lee and plano else f"Se resolvió {que}")
                + (f" desde la versión {version}" if version else "") + ": actualiza y vuelve a escanear.")
    return ((f"El plano {plano} no se podrá leer con ArmaScanner" if no_lee and plano else f"Se cerró {que}")
            + (f": {nota}" if nota else "."))


class Oficina(BaseModel):
    calculista_id: int
    lector: str = ""
    notas: str = ""


@router.post("/armascanner/oficinas")
def guardar_oficina(datos: Oficina, admin=Depends(require_admin_or_admin_calidad)):
    """Lo que se sabe de una oficina de cálculo: qué lector lee sus planos y notas (administrador)."""
    email = admin.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM calculistas WHERE id = %s", (datos.calculista_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Oficina no encontrada.")
            cur.execute("""INSERT INTO armascanner_oficinas (calculista_id, lector, notas, actualizado_por, actualizado_el)
                           VALUES (%s, %s, %s, %s, NOW())
                           ON CONFLICT (calculista_id) DO UPDATE SET lector = EXCLUDED.lector, notas = EXCLUDED.notas,
                               actualizado_por = EXCLUDED.actualizado_por, actualizado_el = NOW()""",
                        (datos.calculista_id, datos.lector.strip()[:40] or None, datos.notas.strip()[:2000] or None, email))
    audit(email, "armascanner_oficina", f"{datos.lector.strip()[:40]}", "calculista", str(datos.calculista_id))
    return {"ok": True}


@router.get("/armascanner/avisos")
def avisos(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Al abrir ArmaScanner: si quien lo abre es administrador, cuántos casos nuevos hay en Desarrollo y el
    enlace a la pestaña. [Usuario 23-nov: «cuando yo abra ArmaScanner, reconozca que soy el administrador
    y así me tire un aviso»]"""
    import os
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            if not _es_admin(user):
                return {"admin": False, "desarrollo": 0, "url": ""}
            cur.execute(CASOS_NUEVOS)
            n = cur.fetchone()[0]
    base = (os.getenv("APP_URL", "") or "").strip().rstrip("/")
    return {"admin": True, "desarrollo": n, "url": f"{base}/#mod=armascanner&tab=asc_desarrollo" if base else ""}


@router.get("/armascanner/reportes")
def reportes(admin=Depends(require_admin_or_admin_calidad)):
    """Los reportes de errores que mandan los cubicadores con «Enviar reporte», el más nuevo primero
    (administrador; pestaña Uso)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT id, email, equipo, version, obra, plano, comentario, tamano, creado_el
                             FROM armascanner_reportes WHERE tipo = 'reporte' ORDER BY id DESC LIMIT 300""")
            filas = cur.fetchall()
            nombres = _nombres(cur, [f[1] for f in filas])
    return {"reportes": [{"id": f[0], "usuario": nombres.get(f[1], f[1] or ""), "equipo": f[2] or "", "version": f[3] or "",
                          "obra": f[4] or "", "plano": f[5] or "", "comentario": f[6] or "", "tamano": f[7] or 0,
                          "el": _cuando(f[8])} for f in filas]}


@router.get("/armascanner/reportes-ficha")
def reportes_ficha(estado: str = "", credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Los casos de Desarrollo, con la ficha de ArmaScanner de un administrador (para leerlos desde el
    equipo de desarrollo sin la clave del portal; empaquetar/traer_desarrollo.py): la lista, con o sin
    filtro de estado, y el enlace de descarga de cada uno."""
    from .. import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            if not _es_admin(user):
                raise HTTPException(status_code=403, detail="Sólo un administrador.")
            cur.execute("""SELECT id, email, equipo, version, obra, plano, comentario, tamano, creado_el, archivo,
                                  tipo, estado, lector, obra_id
                             FROM armascanner_reportes WHERE %s = '' OR estado = %s ORDER BY id DESC LIMIT 50""",
                        (estado, estado))
            filas = cur.fetchall()
    return {"reportes": [{"id": f[0], "usuario": f[1], "equipo": f[2] or "", "version": f[3] or "", "obra": f[4] or "",
                          "plano": f[5] or "", "comentario": f[6] or "", "tamano": f[7] or 0, "el": _cuando(f[8]),
                          "url": storage.generate_presigned_url(f[9], expires=DESCARGA_SEGUNDOS),
                          "tipo": f[10], "estado": f[11], "lector": f[12] or "", "obra_id": f[13] or ""} for f in filas]}


@router.get("/armascanner/reportes/{rid}/descarga")
def descargar_reporte(rid: int, admin=Depends(require_admin_or_admin_calidad)):
    from .. import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT archivo FROM armascanner_reportes WHERE id = %s", (rid,))
            fila = cur.fetchone()
    if not fila:
        raise HTTPException(status_code=404, detail="Reporte no encontrado.")
    return {"url": storage.generate_presigned_url(fila[0], expires=DESCARGA_SEGUNDOS)}
