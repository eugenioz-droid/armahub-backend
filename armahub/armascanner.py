"""
armascanner.py
--------------
Lo que ArmaScanner hace en ArmaHub con la ficha de su licencia (licencias.py): elegir la obra,
cargar los planos del calculista, subir cada plano cuando lo terminó y enviar su pedido.
[Usuario 19-nov, programa §8.13 paso 1; modelo sin bloqueo, 21-nov, mig 174]

    GET  /armascanner/obras                   las obras de aSa, para el filtro de texto de ArmaScanner
    GET  /armascanner/planos                  los planos de las obras, cada uno con sus entregas
    POST /armascanner/planos/guardar          carga el plano del calculista como antecedente («cargado»)
    POST /armascanner/planos/terminar         el plano terminado: la entrega de su autor (paquete y PDF)
    POST /armascanner/planos/descargar        enlace para bajar una entrega o el antecedente
    POST /armascanner/planos/entrega/eliminar elimina mi entrega
    POST /armascanner/planos/pedido           «Enviar pedido» (también …/enviar-pedido): las barras de la
                                              entrega vigente pasan a los despieces de la obra
    POST /armascanner/planos/tomar · soltar   ya no hay bloqueo: quedan para un ArmaScanner anterior
    GET/POST /armascanner/planos-linea…       la pestaña Planos del portal (avance, barras, PDF, elegir
                                              la versión que vale, pedido, eliminar)

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

ENVIAR EL PEDIDO de un plano es la importación de A Detailer de siempre
(importer.import_armadetailer), con tres reglas propias:
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
import logging
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from .auth import get_current_user, require_admin_or_admin_calidad
from .db import audit, get_conn
from .licencias import _bearer, estado_licencia, leer_ficha

router = APIRouter()
logger = logging.getLogger("armahub.armascanner")

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


async def _cargar_barras(user, obra, plano_code, reemplaza, revision, sin_subir, contenido: bytes, nombre,
                         version, equipo):
    """Las barras de un plano de ArmaScanner (el CSV de A Detailer) entran a los despieces de la
    obra como la carga de ese plano, con su estado de revisión. Devuelve (respuesta de la
    importación, barras sin aprobar)."""
    from .importer import import_armadetailer
    # Códigos anteriores del mismo plano (se limpió y se escaneó de nuevo): sus barras se
    # reemplazan también. Sólo códigos de cargas de ArmaScanner de esta obra: por aquí no
    # se pueden borrar barras de A Detailer ni de otra obra.
    anteriores = [c.strip() for c in (reemplaza or []) if isinstance(c, str) and c.strip() and ";" not in c]
    if anteriores:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT DISTINCT plano_code FROM imports
                     WHERE id_proyecto = %s AND herramienta = 'ArmaScanner' AND plano_code = ANY(%s)
                """, (obra, anteriores))
                anteriores = [r[0] for r in cur.fetchall()]
    reemplazar = ";".join(dict.fromkeys([plano_code] + anteriores))
    res = await import_armadetailer(
        file=UploadFile(BytesIO(contenido), filename=nombre or f"{plano_code}.csv"),
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
            pend = pendientes_por_combinacion(estado + [dict(b, revision="duda") for b in (sin_subir or [])])
            cur.execute("""
                UPDATE imports SET herramienta = 'ArmaScanner', herramienta_version = %s, equipo = %s,
                                   pendientes = %s::jsonb
                 WHERE id = %s
            """, ((version or "")[:40] or None, (equipo or "")[:120] or None, json.dumps(pend), import_id))
    return res, sum(pend.values())


# ══════ Planos de las obras: antecedentes y entregas, sin bloqueo (mig 169 y 174; SPECS §5.4) ══════
# [Usuario 21-nov] Nadie «toma» un plano. El cubicador carga el plano del calculista (queda como
# antecedente, etapa «cargado») y lo sube cuando lo terminó. Si dos cubicadores terminan el mismo
# plano no se reescribe nada: cada uno tiene su entrega, el plano queda «por decidir» y un
# administrador indica cuál vale; al autor de la otra se le avisa que debe eliminarla.
# `planos_obra` tiene una fila por plano: el antecedente (archivo) y el resumen de la entrega
# vigente, que es lo que leen las listas, los indicadores y el pedido. Todos los usuarios con
# licencia ven los planos de todas las obras.

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


def clave_paquete(obra: str, plano: str, ext: str = "zip") -> str:
    """La key de un archivo del plano en R2: una carpeta por plano (va la huella del nombre: el
    nombre trae cualquier letra) y un nombre único por subida. Dos subidas nunca comparten key:
    ninguna pisa a otra, y borrar la que no entró no toca la de nadie más. (Antes la key dependía
    sólo del número de versión: al cruzarse dos guardados, el que perdía borraba el archivo del
    que ganó.)"""
    import hashlib
    import uuid
    return f"obras/{obra}/planos/{hashlib.md5(plano.encode('utf-8')).hexdigest()[:16]}/{uuid.uuid4().hex}.{ext}"


def _borrar(*claves):
    """Borra de R2 archivos que ya nadie usa. Va siempre después de que la base confirmó; si R2
    falla, el archivo queda suelto y se anota, pero la operación ya hecha no se cae por eso."""
    from . import storage
    for clave in claves:
        if clave:
            try:
                storage.delete_file(clave)
            except Exception as e:
                logger.warning("R2: no se pudo borrar %s (%s)", clave, e)


# ── Las reglas de las entregas (funciones puras) ──
def vigente_de(entregas: list):
    """La entrega vigente de un plano: la que vale; si ninguna vale, la más antigua sin decidir (y
    si todas quedaron como no vigentes, la más antigua). `entregas` viene en orden de llegada.
    None si no hay ninguna."""
    for criterio in (lambda e: e["vale"] is True, lambda e: e["vale"] is None, lambda e: True):
        for e in entregas:
            if criterio(e):
                return e
    return None


def por_decidir(entregas: list) -> bool:
    """Hay más de una versión del plano y falta indicar cuál vale."""
    return len(entregas) > 1 and (any(e["vale"] is None for e in entregas)
                                  or not any(e["vale"] is True for e in entregas))


def vale_al_entrar(vale_antes, otras: int):
    """Cómo queda la entrega que entra: vale (True) si es la única del plano; con entregas de otros
    autores queda sin decidir (None), salvo que su autor ya tuviera la vigente y la esté
    reemplazando. `vale_antes`: el `vale` de la entrega anterior del mismo autor (None si no tenía)."""
    return True if (not otras or vale_antes is True) else None


def accion_al_cargar(fila, entregas: int, tamano: int) -> str:
    """Qué hace «cargar» (el plano del calculista, como antecedente) según lo que ArmaHub ya tiene
    del plano: 'crear' si no existe; 'ya_estaba' (no se toca nada) si tiene entregas o trabajo, o si
    es el mismo paquete; 'version_nueva' si sólo estaba cargado y el paquete es otro.
    `fila`: {etapa, tamano} de planos_obra, o None."""
    if not fila:
        return "crear"
    if entregas or fila["etapa"] != "cargado" or fila["tamano"] == tamano:
        return "ya_estaba"
    return "version_nueva"


def relacion_enviada(d: dict):
    """(relacion, relacion_de) que manda ArmaScanner, o None si no manda la clave (la relación del
    plano no se toca). Con la clave, aunque venga vacía, manda lo que diga: así se corrige o se
    quita una relación mal puesta."""
    if "relacion" not in d:
        return None
    relacion = str(d.get("relacion") or "").strip()
    if relacion not in ("reemplaza", "complementa"):
        return (None, None)
    return (relacion, str(d.get("relacion_de") or "").strip()[:300] or None)


# ── Las entregas y la fila del plano en la base ──
def _entregas(cur, obras=None, plano=None) -> dict:
    """{(obra, plano): [entrega…]} en orden de llegada, sin sus barras. `obras`: lista de ids
    (None: las de todas las obras)."""
    if obras is not None and not obras:
        return {}
    cond, params = [], []
    if obras is not None:
        cond.append("id_proyecto = ANY(%s)")
        params.append(list(obras))
    if plano is not None:
        cond.append("plano = %s")
        params.append(plano)
    cur.execute("""SELECT id, id_proyecto, plano, autor, version, archivo, tamano, resumen, pdf, vale, subido_el
                     FROM planos_obra_entregas""" + (" WHERE " + " AND ".join(cond) if cond else "") + " ORDER BY id",
                params)
    out = {}
    for f in cur.fetchall():
        out.setdefault((f[1], f[2]), []).append(
            {"id": f[0], "autor": f[3], "version": f[4], "archivo": f[5], "tamano": f[6], "resumen": f[7] or {},
             "pdf": f[8], "vale": f[9], "subido_el": f[10]})
    return out


def _entregas_de(cur, obra: str, plano: str) -> list:
    return _entregas(cur, [obra], plano).get((obra, plano), [])


def _fila_base(cur, obra: str, plano: str, exclusiva: bool = False):
    """La fila del plano en `planos_obra` (o None). Con `exclusiva` queda reservada hasta el fin de
    la transacción: lo que cambia las entregas de un plano pasa de a uno."""
    cur.execute("""SELECT version, archivo, tamano, etapa, subido_por, subido_el, base
                     FROM planos_obra WHERE id_proyecto = %s AND plano = %s""" + (" FOR UPDATE" if exclusiva else ""),
                (obra, plano))
    f = cur.fetchone()
    return f and {"version": f[0], "archivo": f[1], "tamano": f[2], "etapa": f[3] or "", "subido_por": f[4],
                  "subido_el": f[5], "base": f[6]}


def _recalcular(cur, obra: str, plano: str) -> dict:
    """Pone `planos_obra` al día después de un cambio en las entregas del plano (con su fila
    reservada: _fila_base(exclusiva)). La única entrega que queda, vale. La fila toma el resumen de
    la vigente, y su versión sube sólo si la vigente cambió (así el pedido sabe si quedó atrás). Sin
    entregas vuelve a lo que era antes de la primera (el antecedente cargado, o el trabajo anterior
    al cambio); si no tenía archivo propio, se elimina. Devuelve {entregas, por_decidir, vigente}."""
    from datetime import datetime
    lista = _entregas_de(cur, obra, plano)
    if len(lista) == 1 and lista[0]["vale"] is not True:
        cur.execute("UPDATE planos_obra_entregas SET vale = TRUE WHERE id = %s", (lista[0]["id"],))
        lista[0]["vale"] = True
    vigente = vigente_de(lista)
    fila = _fila_base(cur, obra, plano)
    if vigente and fila:
        if fila["etapa"] != "terminado" and fila["archivo"]:  # entra la primera entrega: se guarda lo que la fila era
            cur.execute("""SELECT barras, aprobadas, kg, resumen, barras_json FROM planos_obra
                            WHERE id_proyecto = %s AND plano = %s""", (obra, plano))
            f = cur.fetchone()
            base = {"etapa": fila["etapa"] or "en_trabajo", "subido_por": fila["subido_por"],
                    "subido_el": fila["subido_el"].isoformat() if fila["subido_el"] else None,
                    "barras": f[0], "aprobadas": f[1], "kg": float(f[2]) if f[2] is not None else None,
                    "resumen": f[3], "barras_json": f[4]}
            cur.execute("UPDATE planos_obra SET base = %s::jsonb WHERE id_proyecto = %s AND plano = %s",
                        (json.dumps(base), obra, plano))
        cur.execute("""
            UPDATE planos_obra AS p
               SET numero = COALESCE(e.numero, p.numero), titulo = COALESCE(e.titulo, p.titulo),
                   revision = COALESCE(e.revision, p.revision), elemento = COALESCE(e.elemento, p.elemento),
                   barras = CAST(e.resumen->>'barras' AS INTEGER), aprobadas = CAST(e.resumen->>'aprobadas' AS INTEGER),
                   kg = CAST(e.resumen->>'kg' AS NUMERIC), resumen = e.resumen, barras_json = e.barras_json,
                   pdf = e.pdf, etapa = 'terminado',
                   version = p.version + CASE WHEN p.etapa IS DISTINCT FROM 'terminado'
                                                   OR p.subido_por IS DISTINCT FROM e.autor
                                                   OR p.subido_el IS DISTINCT FROM e.subido_el THEN 1 ELSE 0 END,
                   subido_por = e.autor, subido_el = e.subido_el
              FROM planos_obra_entregas AS e
             WHERE e.id = %s AND p.id_proyecto = e.id_proyecto AND p.plano = e.plano
        """, (vigente["id"],))
    elif fila:
        antes = fila["base"] or ({"etapa": "cargado"} if fila["archivo"] else None)
        if antes is None:
            cur.execute("DELETE FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (obra, plano))
        else:
            el = datetime.fromisoformat(antes["subido_el"]) if antes.get("subido_el") else fila["subido_el"]
            cur.execute("""
                UPDATE planos_obra
                   SET etapa = %s, subido_por = %s, subido_el = %s, barras = %s, aprobadas = %s, kg = %s,
                       resumen = %s::jsonb, barras_json = %s::jsonb, pdf = NULL, base = NULL, version = version + 1
                 WHERE id_proyecto = %s AND plano = %s
            """, (antes["etapa"], antes.get("subido_por", fila["subido_por"]), el, antes.get("barras") or 0,
                  antes.get("aprobadas") or 0, antes.get("kg") or 0, json.dumps(antes.get("resumen") or resumen_de([])),
                  json.dumps(antes.get("barras_json") or []), obra, plano))
    return {"entregas": len(lista), "por_decidir": por_decidir(lista), "vigente": vigente}


@router.get("/armascanner/planos")
def planos_en_linea(obra: str = "", credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Los planos de todas las obras; con `obra` (id de ArmaHub o código de aSa), los de esa obra.
    Cada uno con su etapa (cargado · terminado · en_trabajo), el resumen de su entrega vigente, si
    está por decidir y sus entregas. `tomado_*` va vacío: lo lee un ArmaScanner anterior al cambio."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            filtro, params = "", []
            if obra.strip():
                filtro, params = "WHERE p.id_proyecto = %s OR pr.asa_job_id = %s", [obra.strip(), obra.strip()]
            cur.execute(f"""
                SELECT p.id_proyecto, COALESCE(pr.nombre_proyecto, p.id_proyecto), COALESCE(pr.asa_job_id, ''),
                       p.plano, p.numero, p.titulo, p.revision, p.elemento, p.version, p.barras, p.aprobadas,
                       p.kg, p.tamano, p.subido_por, p.subido_el, p.pedido_version, p.etapa, p.relacion,
                       p.relacion_de, p.pdf
                  FROM planos_obra p
                  LEFT JOIN proyectos pr ON pr.id_proyecto = p.id_proyecto
                  {filtro}
                 ORDER BY 2, p.numero, p.plano
            """, params)
            filas = cur.fetchall()
            entregas = _entregas(cur, sorted({f[0] for f in filas}) if obra.strip() else None)
            nombres = _nombres(cur, [f[13] for f in filas] + [e["autor"] for lista in entregas.values() for e in lista])
            # la obra pedida existe: un plano que ArmaScanner tenía en línea y ya no está en la lista
            # fue eliminado en ArmaHub (sin obra confirmada, ArmaScanner no saca conclusiones)
            obra_id = None
            if obra.strip():
                cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s OR asa_job_id = %s LIMIT 1",
                            (obra.strip(), obra.strip()))
                fila = cur.fetchone()
                obra_id = fila[0] if fila else None
    yo = user["email"]
    planos = []
    for f in filas:
        lista = entregas.get((f[0], f[3]), [])
        vigente = vigente_de(lista)
        planos.append({
            "obra": f[0], "obra_nombre": f[1], "asa": f[2], "plano": f[3], "numero": f[4] or "", "titulo": f[5] or "",
            "etapa": f[16] or "", "revision": f[6] or "", "elemento": f[7] or "", "version": f[8], "barras": f[9],
            "aprobadas": f[10], "kg": round(float(f[11]), 1) if f[11] is not None else None,
            "tamano": vigente["tamano"] if vigente else f[12],
            "subido_por": nombres.get(f[13], f[13] or ""), "subido_el": _cuando(f[14]),
            "tomado_por": "", "tomado_el": "", "tomado_por_mi": False, "pedido": estado_pedido(f[8], f[15]),
            "relacion": f[17] or "", "relacion_de": f[18] or "", "pdf": bool(f[19]), "por_decidir": por_decidir(lista),
            "entregas": [{"autor": nombres.get(e["autor"], e["autor"]), "mia": e["autor"] == yo, "version": e["version"],
                          "subido_el": _cuando(e["subido_el"]), "vale": e["vale"],
                          "barras": e["resumen"].get("barras") or 0, "kg": e["resumen"].get("kg") or 0} for e in lista]})
    return {"yo": yo, "admin": _es_admin(user), "obra_id": obra_id, "planos": planos}


class PlanoEnLinea(BaseModel):
    obra: str
    plano: str


@router.post("/armascanner/planos/tomar")
def tomar_plano(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Ya no se toma un plano. Un ArmaScanner anterior al cambio, con este 404, lo abre en local."""
    raise HTTPException(status_code=404, detail="Actualiza ArmaScanner.")


@router.post("/armascanner/planos/soltar")
def soltar_plano(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Ya no hay nada que soltar: responde bien para que un ArmaScanner anterior al cambio siga."""
    return {"ok": True}


# ══════ Cargar, terminar y el pedido aparte (mig 171 y 174; SPECS §5.4) ══════
# Cargar deja el plano del calculista como antecedente. Terminar sube el plano con todas sus barras
# revisadas: es la entrega de su autor, con sus barras a la vista y su PDF. Ninguno de los dos carga
# barras en los despieces: eso es «Enviar pedido», que pasa las barras de la entrega vigente a la
# obra, con su procedencia (ArmaScanner). Lo envía quien terminó el plano o un administrador.
# [Usuario 20-nov: «al enviar el pedido lo estamos pasando a los despieces asociados a la obra»]
CAMPOS_BARRA = ("id", "marca", "figura", "diam", "cant", "largo", "kg", "ciclo", "eje", "rev", "motivo")


def barras_a_la_vista(lista) -> list:
    """Lo que ArmaScanner manda de cada barra, acotado: sólo los campos conocidos, texto corto."""
    out = []
    for b in (lista or [])[:5000]:
        if isinstance(b, dict):
            fila = {k: (v[:200] if isinstance(v, str) else v) for k, v in b.items()
                    if k in CAMPOS_BARRA and isinstance(v, (str, int, float)) and not isinstance(v, bool)}
            fila["rev"] = fila.get("rev") if fila.get("rev") in REVISIONES else "pendiente"
            out.append(fila)
    return out


def resumen_de(barras, extra=None) -> dict:
    """{barras, aprobadas, consultas, pendientes, kg} de las barras a la vista (+ ciclos, etapa y la
    versión de ArmaScanner que lo manda: `version_app`, que el pedido deja registrada).
    «consultas» = con duda. Función pura."""
    r = {"barras": len(barras), "aprobadas": sum(1 for b in barras if b.get("rev") == "aprobada"),
         "consultas": sum(1 for b in barras if b.get("rev") == "duda"),
         "kg": round(sum(float(b.get("kg") or 0) for b in barras), 1)}
    r["pendientes"] = r["barras"] - r["aprobadas"] - r["consultas"]
    extra = extra or {}
    if isinstance(extra.get("ciclos"), int):
        r["ciclos"] = extra["ciclos"]
    for k in ("etapa", "version_app"):
        if isinstance(extra.get(k), str) and extra[k].strip():
            r[k] = extra[k].strip()[:40]
    return r


def puede_enviar(autor, email: str, admin: bool) -> bool:
    """Envía el pedido de un plano quien lo terminó (el autor de la entrega vigente; en un plano
    anterior al cambio, quien lo guardó por última vez) o un administrador. Función pura."""
    return bool(admin or (email and email == autor))


def estado_pedido(version, pedido_version) -> str:
    if not pedido_version:
        return "sin_enviar"
    return "enviado" if pedido_version >= (version or 0) else "cambios"


def _datos_plano(datos: str) -> dict:
    """El JSON `datos` de cargar y terminar, con la obra (id de ArmaHub o código de aSa) y el plano."""
    try:
        d = json.loads(datos)
    except ValueError:
        d = None
    if not isinstance(d, dict):
        raise HTTPException(status_code=400, detail="Datos del plano ilegibles.")
    d["obra"], d["asa"] = str(d.get("obra") or "").strip(), str(d.get("asa") or "").strip()
    d["plano"] = str(d.get("plano") or "").strip()[:300]
    if not (d["obra"] or d["asa"]) or not d["plano"]:
        raise HTTPException(status_code=400, detail="Falta la obra o el plano.")
    return d


def _obra_de(cur, d: dict, email: str) -> str:
    """El id de la obra: con el código de aSa, la que ya existe en ArmaHub o la que se adopta
    (programacion.adoptar_obra)."""
    if d["asa"]:
        from .programacion import adoptar_obra
        return adoptar_obra(cur, d["asa"], email, en_cubicacion=True)
    return d["obra"]


def _texto(d: dict, k: str, largo: int):
    return str(d.get(k) or "").strip()[:largo] or None


@router.post("/armascanner/planos/guardar")
async def guardar_plano(datos: str = Form(...), paquete: UploadFile = File(...),
                        credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Carga el plano del calculista como antecedente (etapa «cargado»): queda en ArmaHub a la vista
    de todos. `datos` (JSON): obra | asa, plano, etapa = "cargado", numero, titulo, rev, elemento,
    relacion, relacion_de. Si el plano no existe, se crea (v1). Si ya tiene entregas o trabajo, o es
    el mismo paquete (mismo tamaño), no se toca nada y responde `ya_estaba`: dos cubicadores cargan
    el mismo DWG sin estorbarse, y cargar nunca rebaja un plano trabajado. Si sólo estaba cargado y
    el paquete es otro, queda como la versión siguiente del antecedente. Ya no guarda trabajo
    intermedio: con otra etapa responde 409 (un ArmaScanner anterior al cambio).
    [Usuario 20-nov: «el cubicador cargue TODOS los planos, para tener un registro de TODOS los
    antecedentes técnicos»]"""
    from . import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            d = _datos_plano(datos)
            if (d.get("etapa") or "") != "cargado":
                raise HTTPException(status_code=409, detail="Actualiza ArmaScanner: esta versión ya no guarda el "
                                                            "trabajo intermedio en ArmaHub.")
            obra, plano, email = _obra_de(cur, d, user["email"]), d["plano"], user["email"]
            fila = _fila_base(cur, obra, plano)
            n_entregas = len(_entregas_de(cur, obra, plano))
    contenido = await paquete.read()
    accion = accion_al_cargar(fila, n_entregas, len(contenido))
    if accion == "ya_estaba":
        return {"ok": True, "version": fila["version"], "id_proyecto": obra, "ya_estaba": True}
    clave = clave_paquete(obra, plano)
    try:
        storage.upload_file(clave, contenido, "application/zip")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"El plano no se pudo guardar en ArmaHub ({str(e)[:80]}).")
    relacion = relacion_enviada(d)
    resumen = resumen_de([], d)
    comunes = (_texto(d, "numero", 40), _texto(d, "titulo", 300), _texto(d, "rev", 20), _texto(d, "elemento", 20),
               clave, len(contenido), email)
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                if accion == "crear":
                    cur.execute("""
                        INSERT INTO planos_obra (id_proyecto, plano, numero, titulo, revision, elemento, archivo, tamano,
                                                 subido_por, subido_el, version, barras, aprobadas, kg, resumen,
                                                 barras_json, etapa, relacion, relacion_de)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), 1, 0, 0, 0, %s::jsonb, '[]'::jsonb, 'cargado',
                                %s, %s)
                        ON CONFLICT (id_proyecto, plano) DO NOTHING
                        RETURNING version
                    """, (obra, plano) + comunes + (json.dumps(resumen),) + (relacion or (None, None)))
                else:  # sólo si sigue como estaba al mirarlo: cargado, en esa versión y sin entregas
                    cur.execute("""
                        UPDATE planos_obra
                           SET numero = %s, titulo = %s, revision = %s, elemento = %s, archivo = %s, tamano = %s,
                               subido_por = %s, subido_el = NOW(), version = version + 1"""
                                + (", relacion = %s, relacion_de = %s" if relacion else "") + """
                         WHERE id_proyecto = %s AND plano = %s AND version = %s AND etapa = 'cargado'
                           AND NOT EXISTS (SELECT 1 FROM planos_obra_entregas e
                                            WHERE e.id_proyecto = planos_obra.id_proyecto AND e.plano = planos_obra.plano)
                        RETURNING version
                    """, comunes + (relacion or ()) + (obra, plano, fila["version"]))
                entro = cur.fetchone()
                actual = None if entro else _fila_base(cur, obra, plano)
    except Exception:
        _borrar(clave)  # la base no confirmó: lo subido en este intento no queda suelto
        raise
    if not entro:  # mientras subía, otro lo cargó o lo terminó: vale lo que ya está, y sobra lo subido aquí
        _borrar(clave)
        if not actual:
            raise HTTPException(status_code=409, detail="El plano cambió en ArmaHub mientras se cargaba: vuelve a cargarlo.")
        return {"ok": True, "version": actual["version"], "id_proyecto": obra, "ya_estaba": True}
    if accion == "version_nueva":
        _borrar(fila["archivo"])  # el antecedente anterior: una sola copia, y ya nada lo nombra
    return {"ok": True, "version": entro[0], "id_proyecto": obra, "resumen": resumen, "ya_estaba": False}


@router.post("/armascanner/planos/terminar")
async def terminar_plano(datos: str = Form(...), paquete: UploadFile = File(...),
                         pdf: Optional[UploadFile] = File(None),
                         credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """El plano terminado (todas sus barras revisadas): queda como la entrega de su autor, con sus
    barras a la vista y su PDF. `datos` (JSON): obra | asa, plano, numero, titulo, rev, elemento,
    ciclos, relacion, relacion_de, barras [{id, marca, figura, diam, cant, largo, kg, ciclo, eje,
    rev, motivo}], version_app.
    Una entrega por obra, plano y autor: si el mismo autor termina de nuevo, reemplaza la suya
    (versión siguiente). Nunca toca la de otro: si ya hay entregas de otros autores, ésta queda sin
    decidir y el plano «por decidir», hasta que un administrador indique cuál vale. `planos_obra`
    toma su resumen sólo si es la vigente. Cada subida va a una key propia de R2, y el archivo
    anterior del mismo autor se borra recién cuando la base confirmó."""
    from . import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            d = _datos_plano(datos)
            obra, plano, email = _obra_de(cur, d, user["email"]), d["plano"], user["email"]
    contenido = await paquete.read()
    if not contenido:
        raise HTTPException(status_code=400, detail="El paquete del plano llegó vacío.")
    hoja = await pdf.read() if pdf is not None else b""
    barras = barras_a_la_vista(d.get("barras"))
    resumen = resumen_de(barras, d)
    relacion = relacion_enviada(d)
    clave = clave_paquete(obra, plano)
    clave_pdf = clave[:-len("zip")] + "pdf" if hoja else None  # junto al paquete
    try:
        storage.upload_file(clave, contenido, "application/zip")
        if hoja:
            storage.upload_file(clave_pdf, hoja, "application/pdf")
    except Exception as e:
        _borrar(clave, clave_pdf)
        raise HTTPException(status_code=502, detail=f"El plano no se pudo guardar en ArmaHub ({str(e)[:80]}).")
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                # la fila del plano existe (si no, se crea vacía) y queda reservada: dos que terminan a
                # la vez el mismo plano entran de a uno, y el segundo ya ve la entrega del primero
                cur.execute("""INSERT INTO planos_obra (id_proyecto, plano, version) VALUES (%s, %s, 0)
                               ON CONFLICT (id_proyecto, plano) DO NOTHING""", (obra, plano))
                if not _fila_base(cur, obra, plano, exclusiva=True):  # lo eliminaron en este mismo instante
                    raise HTTPException(status_code=409, detail="El plano cambió en ArmaHub mientras subía: vuelve a "
                                                                "terminarlo.")
                cur.execute("""SELECT autor, archivo, pdf, vale FROM planos_obra_entregas
                                WHERE id_proyecto = %s AND plano = %s""", (obra, plano))
                todas = cur.fetchall()
                mia = next((f for f in todas if f[0] == email), None)
                vale = vale_al_entrar(mia[3] if mia else None, len(todas) - (1 if mia else 0))
                cur.execute("""
                    INSERT INTO planos_obra_entregas (id_proyecto, plano, autor, version, archivo, tamano, numero, titulo,
                                                      revision, elemento, resumen, barras_json, pdf, vale, subido_el)
                    VALUES (%s, %s, %s, 1, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, NOW())
                    ON CONFLICT (id_proyecto, plano, autor) DO UPDATE SET
                        version = planos_obra_entregas.version + 1, archivo = EXCLUDED.archivo,
                        tamano = EXCLUDED.tamano, numero = EXCLUDED.numero, titulo = EXCLUDED.titulo,
                        revision = EXCLUDED.revision, elemento = EXCLUDED.elemento, resumen = EXCLUDED.resumen,
                        barras_json = EXCLUDED.barras_json, pdf = EXCLUDED.pdf, vale = EXCLUDED.vale,
                        decidido_por = CASE WHEN EXCLUDED.vale IS NULL THEN NULL
                                            ELSE planos_obra_entregas.decidido_por END,
                        decidido_el = CASE WHEN EXCLUDED.vale IS NULL THEN NULL
                                           ELSE planos_obra_entregas.decidido_el END,
                        subido_el = EXCLUDED.subido_el
                    RETURNING id, version
                """, (obra, plano, email, clave, len(contenido), _texto(d, "numero", 40), _texto(d, "titulo", 300),
                      _texto(d, "rev", 20), _texto(d, "elemento", 20), json.dumps(resumen), json.dumps(barras),
                      clave_pdf, vale))
                entrega_id, version = cur.fetchone()
                estado = _recalcular(cur, obra, plano)
                if relacion is not None and estado["vigente"]["id"] == entrega_id:
                    cur.execute("UPDATE planos_obra SET relacion = %s, relacion_de = %s WHERE id_proyecto = %s AND plano = %s",
                                relacion + (obra, plano))
    except Exception:
        _borrar(clave, clave_pdf)  # la base no confirmó: lo subido en este intento no queda suelto
        raise
    if mia:
        _borrar(mia[1], mia[2])  # mi entrega anterior, recién ahora; la de otro autor no se toca nunca
    audit(email, "armascanner_terminar_plano",
          f"{plano} v{version}: {resumen['barras']} barras, {resumen['kg']} kg"
          + (f", {estado['entregas']} versiones por decidir" if estado["por_decidir"] else ""), "proyecto", obra)
    return {"ok": True, "version": version, "id_proyecto": obra, "resumen": resumen, "entregas": estado["entregas"],
            "por_decidir": estado["por_decidir"], "vale": vale}


class DescargaPlano(BaseModel):
    obra: str
    plano: str
    autor: str = ""


@router.post("/armascanner/planos/descargar")
def descargar_plano(datos: DescargaPlano, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """El enlace para bajar el paquete de un plano (dura minutos). No reserva nada. `autor`: "mia" =
    mi entrega; vacío = la vigente o, si el plano no tiene entregas, el paquete de `planos_obra` (el
    antecedente, o el trabajo anterior al cambio); también el nombre o el correo de otro autor."""
    from . import storage
    quien = datos.autor.strip()
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            lista = _entregas_de(cur, datos.obra, datos.plano)
            fila = _fila_base(cur, datos.obra, datos.plano)
            nombres = _nombres(cur, [e["autor"] for e in lista] + [fila["subido_por"] if fila else None])
    if quien == "mia":
        entrega = next((e for e in lista if e["autor"] == user["email"]), None)
        if not entrega:
            raise HTTPException(status_code=404, detail="No tienes una versión de este plano en ArmaHub.")
    elif quien:
        entrega = next((e for e in lista if quien in (e["autor"], nombres.get(e["autor"]))), None)
        if not entrega:
            raise HTTPException(status_code=404, detail="Esa versión del plano no está en ArmaHub.")
    else:
        entrega = vigente_de(lista)
    if entrega:
        r = {"version": entrega["version"], "tamano": entrega["tamano"], "etapa": "terminado",
             "autor": nombres.get(entrega["autor"], entrega["autor"]), "mia": entrega["autor"] == user["email"]}
        archivo = entrega["archivo"]
    elif fila and fila["archivo"]:
        r = {"version": fila["version"], "tamano": fila["tamano"], "etapa": fila["etapa"],
             "autor": nombres.get(fila["subido_por"], fila["subido_por"] or ""), "mia": fila["subido_por"] == user["email"]}
        archivo = fila["archivo"]
    else:
        raise HTTPException(status_code=404, detail="Ese plano no está en ArmaHub.")
    audit(user["email"], "armascanner_descargar_plano", f"{datos.plano} ({r['etapa']} v{r['version']}, {r['autor']})",
          "proyecto", datos.obra)
    return dict(r, url=storage.generate_presigned_url(archivo, expires=DESCARGA_SEGUNDOS))


@router.post("/armascanner/planos/entrega/eliminar")
def eliminar_mi_entrega(datos: PlanoEnLinea, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Elimina mi entrega del plano (su registro, su paquete y su PDF). Si queda una sola, ésa vale y
    `planos_obra` toma su resumen; si no queda ninguna, el plano vuelve a «cargado» (o se va, si no
    tenía antecedente). No toca la entrega de nadie más."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            _fila_base(cur, datos.obra, datos.plano, exclusiva=True)
            cur.execute("""DELETE FROM planos_obra_entregas WHERE id_proyecto = %s AND plano = %s AND autor = %s
                           RETURNING archivo, pdf, version""", (datos.obra, datos.plano, user["email"]))
            mia = cur.fetchone()
            if not mia:
                raise HTTPException(status_code=404, detail="No tienes una versión de este plano en ArmaHub.")
            estado = _recalcular(cur, datos.obra, datos.plano)
    _borrar(mia[0], mia[1])
    audit(user["email"], "armascanner_eliminar_entrega",
          f"{datos.plano} (v{mia[2]}); quedan {estado['entregas']}", "proyecto", datos.obra)
    return {"ok": True, "entregas": estado["entregas"], "por_decidir": estado["por_decidir"]}


async def _enviar_pedido(user: dict, obra: str, plano: str) -> dict:
    """Las barras de la entrega vigente del plano pasan a los despieces de la obra (reemplazan las de
    ese plano, también las de sus códigos anteriores). Con más de una versión sin decidir no se
    envía. Un plano «en_trabajo» (anterior al cambio) envía lo último que guardó."""
    import zipfile
    from . import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT version, archivo, etapa, subido_por, codigos, resumen FROM planos_obra
                            WHERE id_proyecto = %s AND plano = %s""", (obra, plano))
            fila = cur.fetchone()
            lista = _entregas_de(cur, obra, plano)
    if not fila:
        raise HTTPException(status_code=404, detail="Ese plano no está en ArmaHub.")
    version, archivo, etapa, autor, codigos, resumen = fila
    if lista:
        if por_decidir(lista):
            raise HTTPException(status_code=409, detail="Hay más de una versión de este plano: ArmaHub debe indicar "
                                                        "cuál vale.")
        vigente = vigente_de(lista)
        archivo, autor, resumen = vigente["archivo"], vigente["autor"], vigente["resumen"]
    elif etapa == "cargado" or not archivo:
        raise HTTPException(status_code=422, detail="El plano no tiene barras para enviar.")
    if not puede_enviar(autor, user.get("email", ""), _es_admin(user)):
        raise HTTPException(status_code=403, detail="Envía el pedido quien terminó el plano o un administrador.")
    try:
        z = zipfile.ZipFile(BytesIO(storage.download_file(archivo)))
        nombres = z.namelist()
        csv_ = next((n for n in nombres if n.startswith("trabajo/") and n.endswith("_subida.csv")), None)
        js = next((n for n in nombres if n.startswith("trabajo/") and n.endswith("_subida.json")), None)
        if not csv_ or not js:
            raise HTTPException(status_code=422, detail="El plano no tiene barras para enviar.")
        s = json.loads(z.read(js).decode("utf-8"))
        contenido = z.read(csv_)
        registro = json.loads(z.read("paquete.json").decode("utf-8")).get("registro") or {}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"No se pudo leer el plano guardado ({str(e)[:80]}).")
    plano_code = (s.get("plano_code") or "").strip()
    if not plano_code:
        raise HTTPException(status_code=422, detail="El plano guardado no trae su código.")
    anteriores = list(codigos or []) + list((registro.get("subida") or {}).get("codigos") or [])
    revision = {k: v for k, v in (s.get("revision") or {}).items() if v in REVISIONES}
    nombre = "".join(c for c in plano if c.isascii() and (c.isalnum() or c in "._- ")).strip() or "plano"
    # la versión de ArmaScanner viaja en `datos.version_app` al terminar (queda en el resumen de la entrega)
    version_app = (resumen or {}).get("version_app") or registro.get("version_app")
    res, n_pend = await _cargar_barras(user, obra, plano_code, anteriores, revision, s.get("sin_subir"), contenido,
                                       f"{nombre}_armascanner.csv", version_app, None)
    todos = list(dict.fromkeys([c for c in anteriores if isinstance(c, str)] + [plano_code]))
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""UPDATE planos_obra SET pedido_version = %s, pedido_el = NOW(), pedido_por = %s,
                                                  codigos = %s::jsonb
                            WHERE id_proyecto = %s AND plano = %s""",
                        (version, user.get("email"), json.dumps(todos), obra, plano))
    audit(user.get("email", "?"), "armascanner_enviar_pedido",
          f"{plano} v{version} → {res.get('proyecto')}: {res.get('barras')} barras, {res.get('kilos')} kg, "
          f"{n_pend} sin aprobar", "proyecto", obra)
    return {"ok": True, "version": version, "import_id": res["import_id"], "obra": res.get("proyecto"),
            "barras": res.get("barras"), "kilos": res.get("kilos"),
            "reemplazadas": res.get("barras_eliminadas_previo"), "pendientes": n_pend, "plano_code": plano_code}


@router.post("/armascanner/planos/pedido")
@router.post("/armascanner/planos/enviar-pedido", include_in_schema=False)
async def enviar_pedido(datos: PlanoEnLinea, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """«Enviar pedido» desde ArmaScanner (ficha de licencia)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
    return await _enviar_pedido(user, datos.obra, datos.plano)


# ── La pestaña Planos del portal (sesión del portal): avance, barras, PDF, la versión que vale, pedido ──
def _fila_plano(f, nombres, yo: str, admin: bool, lista: list) -> dict:
    (obra, obra_nombre, plano, numero, titulo, revision, elemento, version, tamano, subido_por, subido_el,
     resumen, pedido_version, pedido_el, pedido_por, pdf, barras, aprobadas, kg, etapa, relacion, relacion_de) = f
    r = resumen or {"barras": barras or 0, "aprobadas": aprobadas or 0, "consultas": 0,
                    "pendientes": (barras or 0) - (aprobadas or 0), "kg": float(kg or 0)}
    decidir = por_decidir(lista)
    return {"obra": obra, "obra_nombre": obra_nombre, "plano": plano, "numero": numero or "", "titulo": titulo or "",
            "revision": revision or "", "elemento": elemento or "", "version": version, "tamano": tamano,
            "guardado_por": nombres.get(subido_por, subido_por or ""), "guardado_el": _cuando(subido_el),
            "en_edicion_por": "", "en_edicion_desde": "", "en_edicion_por_mi": False,
            "resumen": r, "pedido": estado_pedido(version, pedido_version), "pedido_version": pedido_version,
            "pedido_el": _cuando(pedido_el), "pedido_por": nombres.get(pedido_por, pedido_por or ""),
            "puede_enviar": etapa != "cargado" and not decidir and puede_enviar(subido_por, yo, admin),
            "puede_liberar": False, "pdf": bool(pdf), "etapa": etapa or "", "puede_eliminar": admin,
            "relacion": relacion or "", "relacion_de": relacion_de or "", "por_decidir": decidir,
            "entregas": [{"autor": e["autor"], "autor_nombre": nombres.get(e["autor"], e["autor"]),
                          "version": e["version"], "subido_el": _cuando(e["subido_el"]), "vale": e["vale"],
                          "barras": e["resumen"].get("barras") or 0, "aprobadas": e["resumen"].get("aprobadas") or 0,
                          "kg": e["resumen"].get("kg") or 0, "pdf": bool(e["pdf"])} for e in lista]}


@router.get("/armascanner/planos-linea")
def planos_linea(obra: str = "", user=Depends(get_current_user)):
    """Planos (portal): cada plano con su etapa, el avance de su entrega vigente (barras, aprobadas,
    con consulta, por aprobar, kg), sus entregas, si está por decidir y el estado de su pedido."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            filtro, params = "", []
            if obra.strip():
                filtro, params = "WHERE p.id_proyecto = %s", [obra.strip()]
            cur.execute(f"""
                SELECT p.id_proyecto, COALESCE(pr.nombre_proyecto, p.id_proyecto), p.plano, p.numero, p.titulo,
                       p.revision, p.elemento, p.version, p.tamano, p.subido_por, p.subido_el, p.resumen,
                       p.pedido_version, p.pedido_el, p.pedido_por, p.pdf, p.barras, p.aprobadas, p.kg, p.etapa,
                       p.relacion, p.relacion_de
                  FROM planos_obra p
                  LEFT JOIN proyectos pr ON pr.id_proyecto = p.id_proyecto
                  {filtro}
                 ORDER BY 2, p.numero, p.plano
            """, params)
            filas = cur.fetchall()
            entregas = _entregas(cur, [obra.strip()] if obra.strip() else None)
            nombres = _nombres(cur, [f[9] for f in filas] + [f[14] for f in filas]
                               + [e["autor"] for lista in entregas.values() for e in lista])
    yo, admin = user.get("email", ""), _es_admin(user)
    return {"admin": admin, "planos": [_fila_plano(f, nombres, yo, admin, entregas.get((f[0], f[2]), []))
                                       for f in filas]}


@router.get("/armascanner/planos-linea/barras")
def barras_del_plano(obra: str, plano: str, autor: str = "", user=Depends(get_current_user)):
    """Las barras del plano como las mandó ArmaScanner (no son despieces de la obra hasta «Enviar
    pedido»): las de la entrega vigente o, con `autor` (correo), las de la entrega de ese autor."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            if autor.strip():
                cur.execute("""SELECT version, barras_json FROM planos_obra_entregas
                                WHERE id_proyecto = %s AND plano = %s AND autor = %s""", (obra, plano, autor.strip()))
            else:
                cur.execute("SELECT version, barras_json FROM planos_obra WHERE id_proyecto = %s AND plano = %s",
                            (obra, plano))
            fila = cur.fetchone()
    if not fila:
        raise HTTPException(status_code=404, detail="Esa versión del plano no está en ArmaHub." if autor.strip()
                            else "Ese plano no está en ArmaHub.")
    return {"version": fila[0], "barras": fila[1] or []}


@router.get("/armascanner/planos-linea/pdf")
def pdf_del_plano(obra: str, plano: str, autor: str = "", user=Depends(get_current_user)):
    """El enlace al PDF del plano (dura minutos; el navegador lo muestra, no lo descarga): el de la
    entrega vigente o, con `autor` (correo), el de la entrega de ese autor. 404 si no tiene."""
    from . import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            if autor.strip():
                cur.execute("""SELECT pdf FROM planos_obra_entregas
                                WHERE id_proyecto = %s AND plano = %s AND autor = %s""", (obra, plano, autor.strip()))
            else:
                cur.execute("SELECT pdf FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (obra, plano))
            fila = cur.fetchone()
    if not fila or not fila[0]:
        raise HTTPException(status_code=404, detail="Este plano no tiene PDF.")
    return {"url": storage.generate_presigned_url(fila[0], expires=DESCARGA_SEGUNDOS, content_type="application/pdf")}


class ValeEntrega(BaseModel):
    obra: str
    plano: str
    autor: str


@router.post("/armascanner/planos-linea/vale")
def elegir_version(datos: ValeEntrega, admin=Depends(require_admin_or_admin_calidad)):
    """Un administrador indica cuál de las entregas del plano vale (`autor`: su correo): ésa queda
    vigente y las demás, no vigentes; `planos_obra` toma el resumen de la elegida. A los autores de
    las que dejan de valer se les avisa (campana) que deben eliminar la suya."""
    decide = admin.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _fila_base(cur, datos.obra, datos.plano, exclusiva=True)
            lista = _entregas_de(cur, datos.obra, datos.plano)
            if not any(e["autor"] == datos.autor for e in lista):
                raise HTTPException(status_code=404, detail="Esa versión del plano no está en ArmaHub.")
            cur.execute("""UPDATE planos_obra_entregas SET vale = (autor = %s), decidido_por = %s, decidido_el = NOW()
                            WHERE id_proyecto = %s AND plano = %s""", (datos.autor, decide, datos.obra, datos.plano))
            _recalcular(cur, datos.obra, datos.plano)
            cur.execute("""SELECT COALESCE(pr.nombre_proyecto, p.id_proyecto), COALESCE(p.numero, p.plano)
                             FROM planos_obra p LEFT JOIN proyectos pr ON pr.id_proyecto = p.id_proyecto
                            WHERE p.id_proyecto = %s AND p.plano = %s""", (datos.obra, datos.plano))
            obra_nombre, numero = cur.fetchone() or (datos.obra, datos.plano)
            nombres = _nombres(cur, [e["autor"] for e in lista])
    otros = [e["autor"] for e in lista if e["autor"] != datos.autor]
    audit(decide, "armascanner_elegir_version",
          f"{datos.plano}: vale la de {datos.autor}" + (f"; no valen: {', '.join(otros)}" if otros else ""),
          "proyecto", datos.obra)
    # se avisa a quien su entrega deja de valer ahora (no a quien ya lo sabía, ni a quien decide)
    avisar = [e["autor"] for e in lista if e["autor"] not in (datos.autor, decide) and e["vale"] is not False]
    if avisar:
        try:
            from .notifications import crear_notificacion
            crear_notificacion(
                "armascanner_version", None,
                f"Plano {numero} ({obra_nombre}): tu versión no es la vigente; vale la de "
                f"{nombres.get(datos.autor, datos.autor)}. Elimínala en ArmaScanner.", destinatarios_extra=avisar)
        except Exception as e:
            logger.warning("Aviso de versión no vigente no enviado (%s / %s): %s", datos.obra, datos.plano, e)
    return {"ok": True, "avisados": len(avisar)}


@router.post("/armascanner/planos-linea/liberar")
def liberar_plano_portal(user=Depends(get_current_user)):
    """Ya no hay planos tomados que liberar: responde bien a una página abierta desde antes del cambio."""
    return {"ok": True}


class EliminarPlano(BaseModel):
    obra: str
    plano: str
    con_barras: bool = False


@router.post("/armascanner/planos-linea/eliminar")
def eliminar_plano_portal(datos: EliminarPlano, admin=Depends(require_admin_or_admin_calidad)):
    """Eliminar un plano de ArmaHub (administrador): su registro, sus entregas y sus archivos en R2;
    con `con_barras`, también las barras que mandó a los despieces de la obra (las de sus códigos de
    carga). [Usuario 20-nov: limpiar el sistema para partir con obras de aSa]"""
    return _eliminar_plano(admin.get("email", "?"), datos)


@router.post("/armascanner/planos/eliminar")
def eliminar_plano_ficha(datos: EliminarPlano, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Lo mismo, con la ficha de ArmaScanner de un administrador (desde su equipo)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
    if not _es_admin(user):
        raise HTTPException(status_code=403, detail="Eliminar un plano es de administrador.")
    return _eliminar_plano(user["email"], datos)


def _eliminar_plano(email: str, datos: "EliminarPlano") -> dict:
    borradas = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            fila = _fila_base(cur, datos.obra, datos.plano, exclusiva=True)
            if not fila:
                raise HTTPException(status_code=404, detail="Ese plano no está en ArmaHub.")
            cur.execute("SELECT codigos FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (datos.obra, datos.plano))
            codigos = cur.fetchone()[0]
            codigos = [c for c in (codigos if isinstance(codigos, list) else []) if isinstance(c, str) and c.strip()]
            if datos.con_barras and codigos:
                cur.execute("""DELETE FROM barras WHERE id_proyecto = %s AND plano_code = ANY(%s)
                                AND (origen IS NULL OR origen = 'csv')""", (datos.obra, codigos))
                borradas = cur.rowcount
            cur.execute("""DELETE FROM planos_obra_entregas WHERE id_proyecto = %s AND plano = %s
                           RETURNING archivo, pdf""", (datos.obra, datos.plano))
            archivos = [clave for f in cur.fetchall() for clave in f]
            cur.execute("DELETE FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (datos.obra, datos.plano))
    _borrar(fila["archivo"], *archivos)
    audit(email, "armascanner_eliminar_plano",
          f"{datos.plano} (v{fila['version']}" + (f", {len(archivos) // 2} entregas" if archivos else "")
          + (f", {borradas} barras" if borradas else "") + ")", "proyecto", datos.obra)
    return {"ok": True, "barras_eliminadas": borradas}


# ── Reportes: el cubicador los manda desde ArmaScanner («Enviar reporte»): diagnóstico del equipo,
# registro del último escaneo y bitácora del plano, en un ZIP. [Usuario 20-nov: «un sistema que le
# permita al cubicador enviar el reporte, así puedo trabajar contigo sin enviarnos archivos»]
REPORTE_MAX = 25 * 1024 * 1024


@router.post("/armascanner/reportes")
async def recibir_reporte(datos: str = Form("{}"), archivo: UploadFile = File(...),
                          credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    import secrets
    import time
    try:
        d = json.loads(datos or "{}")
    except ValueError:
        d = {}
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
    contenido = await archivo.read()
    if len(contenido) > REPORTE_MAX:
        raise HTTPException(status_code=413, detail="El reporte pesa más de 25 MB.")
    from . import storage
    clave = f"armascanner/reportes/{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}.zip"
    storage.upload_file(clave, contenido, "application/zip")

    def txt(k, largo):
        return str(d.get(k) or "").strip()[:largo] or None

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO armascanner_reportes (email, equipo, version, obra, plano, comentario, archivo, tamano)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                        (user["email"], txt("equipo", 80), txt("version", 40), txt("obra", 300), txt("plano", 300),
                         txt("comentario", 2000), clave, len(contenido)))
            rid = cur.fetchone()[0]
    audit(user["email"], "armascanner_reporte", f"#{rid} {txt('plano', 80) or ''} {txt('comentario', 80) or ''}".strip(),
          "armascanner", str(rid))
    return {"ok": True, "id": rid}


@router.get("/armascanner/reportes")
def reportes(admin=Depends(require_admin_or_admin_calidad)):
    """Los reportes recibidos, el más nuevo primero (administrador)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT id, email, equipo, version, obra, plano, comentario, tamano, creado_el
                             FROM armascanner_reportes ORDER BY id DESC LIMIT 300""")
            filas = cur.fetchall()
            nombres = _nombres(cur, [f[1] for f in filas])
    return {"reportes": [{"id": f[0], "usuario": nombres.get(f[1], f[1] or ""), "equipo": f[2] or "", "version": f[3] or "",
                          "obra": f[4] or "", "plano": f[5] or "", "comentario": f[6] or "", "tamano": f[7] or 0,
                          "el": _cuando(f[8])} for f in filas]}


@router.get("/armascanner/reportes-ficha")
def reportes_ficha(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Los reportes, con la ficha de ArmaScanner de un administrador (para leerlos desde el equipo de
    desarrollo sin la clave del portal): la lista y el enlace de descarga de cada uno."""
    from . import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            if not _es_admin(user):
                raise HTTPException(status_code=403, detail="Sólo un administrador.")
            cur.execute("""SELECT id, email, equipo, version, obra, plano, comentario, tamano, creado_el, archivo
                             FROM armascanner_reportes ORDER BY id DESC LIMIT 50""")
            filas = cur.fetchall()
    return {"reportes": [{"id": f[0], "usuario": f[1], "equipo": f[2] or "", "version": f[3] or "", "obra": f[4] or "",
                          "plano": f[5] or "", "comentario": f[6] or "", "tamano": f[7] or 0, "el": _cuando(f[8]),
                          "url": storage.generate_presigned_url(f[9], expires=DESCARGA_SEGUNDOS)} for f in filas]}


@router.get("/armascanner/reportes/{rid}/descarga")
def descargar_reporte(rid: int, admin=Depends(require_admin_or_admin_calidad)):
    from . import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT archivo FROM armascanner_reportes WHERE id = %s", (rid,))
            fila = cur.fetchone()
    if not fila:
        raise HTTPException(status_code=404, detail="Reporte no encontrado.")
    return {"url": storage.generate_presigned_url(fila[0], expires=DESCARGA_SEGUNDOS)}


@router.post("/armascanner/planos-linea/pedido")
async def enviar_pedido_portal(datos: PlanoEnLinea, user=Depends(get_current_user)):
    """«Enviar pedido» desde el portal."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
    return await _enviar_pedido({"email": user.get("email", ""), "role": user.get("role")}, datos.obra, datos.plano)


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


def clave_version(version: str) -> tuple:
    """«2026-11-20.10» → (2026, 11, 20, 10). Las versiones se comparan por sus números: como texto,
    «.10» queda antes que «.9» y la versión nueva no se ofrecería nunca."""
    import re
    return tuple(int(x) for x in re.findall(r"\d+", version or ""))


def _vigente(cur):
    """La versión activa más nueva (por número, no por texto)."""
    cur.execute("""SELECT id, version, archivo, tamano, notas, obligatoria, publicada_el
                     FROM armascanner_versiones WHERE activa""")
    filas = cur.fetchall()
    return max(filas, key=lambda f: clave_version(f[1])) if filas else None


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
    if not fila or not version or clave_version(fila[1]) <= clave_version(version):
        return {"hay": False, "version": fila[1] if fila else None}
    return dict(_version_dict(fila, con_enlace=True), hay=True)


@router.get("/armascanner/versiones")
def versiones(admin=Depends(require_admin_or_admin_calidad)):
    """Versiones: todas, la más nueva primero."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT id, version, archivo, tamano, notas, obligatoria, publicada_el, activa, publicada_por
                             FROM armascanner_versiones""")
            filas = sorted(cur.fetchall(), key=lambda f: clave_version(f[1]), reverse=True)
            vig = _vigente(cur)
    return {"vigente": vig[1] if vig else None,
            "versiones": [dict(_version_dict(f), activa=f[7], publicada_por=f[8]) for f in filas]}


@router.post("/armascanner/versiones")
def publicar(archivo: UploadFile = File(...), version: str = Form(...), notas: str = Form(""),
                   obligatoria: bool = Form(False), admin=Depends(require_admin_or_admin_calidad)):
    """Publicar una versión: el ZIP (ArmaScanner/empaquetar/construir.py) va a R2 y queda vigente."""
    return _publicar(admin.get("email", ""), archivo, version, notas, obligatoria)


@router.post("/armascanner/versiones-ficha")
def publicar_con_ficha(archivo: UploadFile = File(...), version: str = Form(...), notas: str = Form(""),
                       obligatoria: bool = Form(False), retirar: str = Form(""),
                       credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Publicar con la ficha de ArmaScanner de un administrador (desde su equipo, sin la clave del
    portal), y retirar en el mismo paso las versiones de `retirar` (separadas por coma). Queda en la
    auditoría como cualquier publicación. [Usuario 20-nov: «no puedes publicar sin mí?» → «sí, dale»]"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
    if not _es_admin(user):
        raise HTTPException(status_code=403, detail="Publicar una versión es de administrador.")
    r = _publicar(user["email"], archivo, version, notas, obligatoria)
    viejas = [v.strip() for v in (retirar or "").split(",") if v.strip() and v.strip() != r["version"]]
    if viejas:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE armascanner_versiones SET activa = FALSE WHERE version = ANY(%s) RETURNING version",
                            (viejas,))
                r["retiradas"] = [f[0] for f in cur.fetchall()]
        if r["retiradas"]:
            audit(user["email"], "armascanner_version", f"retiradas: {', '.join(r['retiradas'])}", "armascanner",
                  r["version"])
    return r


def _publicar(email: str, archivo: UploadFile, version: str, notas: str, obligatoria: bool) -> dict:
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
                        (version, clave, tamano, (notas or "").strip()[:2000] or None, obligatoria, email))
    audit(email or "?", "armascanner_publicar", f"{version} ({tamano / 1e6:.1f} MB)"
          + (" obligatoria" if obligatoria else ""), "armascanner", version)
    return {"ok": True, "version": version, "tamano": tamano}


class CambioVersion(BaseModel):
    activa: Optional[bool] = None
    obligatoria: Optional[bool] = None
    notas: Optional[str] = None


@router.patch("/armascanner/versiones/{vid}")
def cambiar_version(vid: int, datos: CambioVersion, admin=Depends(require_admin_or_admin_calidad)):
    """Retirar (activa=false) o volver a poner una versión; marcarla obligatoria o no; corregir sus novedades."""
    sets, valores = [], []
    for campo in ("activa", "obligatoria", "notas"):
        v = getattr(datos, campo)
        if campo == "notas" and v is not None:
            v = v.strip()[:2000] or None
            sets.append("notas = %s")
            valores.append(v)
            continue
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
