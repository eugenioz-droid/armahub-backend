"""
armascanner.py
--------------
Lo que ArmaScanner hace en ArmaHub con la ficha de su licencia (licencias.py): elegir la obra,
cargar los planos del calculista, subir cada plano cuando lo terminó y enviar su pedido.
[Usuario 19-nov, programa §8.13 paso 1; modelo sin bloqueo, 21-nov, mig 174]

    GET  /armascanner/obras                   las obras agregadas en ArmaHub › Mis obras (sólo ésas)
    GET  /armascanner/planos                  los planos de las obras, con su entrega y sus pedidos de reemplazo
    POST /armascanner/planos/terminar         el plano terminado: la entrega del plano (paquete y PDF), sólo
                                              en una obra de Mis obras (si no, 409); si la entrega es de otro,
                                              sólo con su reemplazo aceptado (si no, 409 «ocupado»)
    POST /armascanner/planos/descargar        enlace para bajar la entrega o el antecedente
    POST /armascanner/planos/reemplazo/pedir · responder   pedir al autor que acepte el reemplazo
    GET  /armascanner/planos/reemplazos       los pedidos para mí y los míos
    POST /armascanner/planos/pedido           «Enviar pedido»: las barras de la entrega pasan a los despieces
                                              de la obra
    POST /armascanner/reportes                un caso de Desarrollo («plano», que no se lee) o un reporte
    POST /armascanner/planos/guardar          cargar el antecedente: EN PAUSA (CARGA_ANTECEDENTES), responde 410
    POST /armascanner/planos/tomar · soltar   ya no hay bloqueo: sólo para un ArmaScanner hasta la 2026-11-20.10
                                              (tomar responde 404 y ése abre el plano en local; soltar, ok)
    GET/POST /armascanner/planos-linea…       los planos de una obra en el portal (avance, barras, PDF, DWG,
                                              responder un reemplazo, pedido, eliminar)

Y lo que muestra la caluga ArmaScanner del portal (sesión del portal; SPECS §13) [Usuario 19-nov:
«Más que pedidos enviados debiera ver sus obras y ojalá una línea por cada carga de elemento
constructivo… Con su cantidad de Items, kilos y lo típico que usamos. La licencia capaz la
dejamos acá, aquí buscamos un usuario existente y lo agregamos»]:

    GET  /armascanner/obras-linea      Mis obras: las obras con planos, con sus KPIs (kg, m², kg/m², PPI, Ø,
                                       fundaciones) y su tabla por piso
    GET  /armascanner/obras-linea/asa  la ventana de la obra, sección aSa: qué parte de cada plano está en aSa
                                       y con qué códigos (CC)
    GET  /armascanner/planos-linea/dwg el DWG del plano (la copia de trabajo o el del calculista)
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


def hoy_chile():
    """La fecha de hoy en Chile. El servidor corre en UTC y de noche allá ya es mañana: con la fecha
    UTC, una licencia que vence hoy dejaría de valer a las 21:00."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/Santiago")).date()


def _usuario(cur, ficha: str) -> dict:
    """El usuario de la ficha, si su licencia vale hoy (en Chile). 401 si la ficha no sirve, 403 si la
    licencia no vale o es un cliente."""
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
    vale, motivo = estado_licencia(None if activa is None else (activa, vence, activo), hoy_chile())
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
    """Las obras de ArmaScanner: las agregadas en ArmaHub › Mis obras (`armascanner_obras`), con su
    nombre de aSa. ArmaScanner ofrece sólo éstas: la obra se agrega primero en ArmaHub y las ven todos
    los cubicadores. [Usuario 23-nov: «debemos agregar la obra en ArmaHub primero… al agregar que
    ArmaScanner reconozca la obra automáticamente»]"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _usuario(cur, credentials.credentials)
            cur.execute("""
                SELECT COALESCE(pr.asa_job_id, ''), COALESCE(ao.nombre, pr.nombre_proyecto, o.id_proyecto) AS nombre,
                       COALESCE(ao.cliente, ''), COALESCE(ao.estado, ''), o.id_proyecto
                  FROM armascanner_obras o
                  JOIN proyectos pr ON pr.id_proyecto = o.id_proyecto
                  LEFT JOIN asa_obras ao ON ao.asa_job_id = pr.asa_job_id
                 ORDER BY nombre
            """)
            return {"obras": [{"asa": r[0], "nombre": r[1], "cliente": r[2], "estado": r[3], "id": r[4]}
                              for r in cur.fetchall()]}


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


# ══════ Planos de las obras: antecedentes y una entrega por plano, sin bloqueo (mig 169 y 174; SPECS §5.4) ══════
# [Usuario 21-nov] Nadie «toma» un plano. El cubicador carga el plano del calculista (queda como
# antecedente, etapa «cargado») y lo sube cuando lo terminó: su entrega. Hay UNA entrega por plano. Otro
# cubicador que termina el mismo plano no puede subirlo mientras el autor de la entrega no acepte el
# reemplazo (o un administrador responda por él): su plano no se carga hasta entonces. [Usuario 22-nov: «la misma herramienta
# le da un aviso al cubicador inicial para que, aceptando, acepte que se reemplace la versión de su
# plano. El plano nuevo no se carga hasta que ocurra esto. Así se coordinan y evitamos duplicar data»]
# `planos_obra` tiene una fila por plano: el antecedente (archivo) y el resumen de la entrega, que es lo
# que leen las listas, los indicadores y el pedido. Todos los usuarios con licencia ven los planos de
# todas las obras.
ABIERTOS = ("pendiente", "aceptado")   # pedidos de reemplazo que siguen corriendo
AVISO = "armascanner_reemplazo"         # tipo de aviso en la campana (notifications.TIPO_EVENTO_LABELS)
AVISO_DESARROLLO = "armascanner_desarrollo"


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


def _avisar(destinatarios, mensaje: str, tipo: str = AVISO):
    """Aviso en la campana de ArmaHub, después de confirmada la operación. Si falla queda en el log:
    lo ya hecho no se cae por un aviso."""
    destinatarios = [d for d in dict.fromkeys(destinatarios or []) if d]
    if not destinatarios:
        return
    try:
        from .notifications import crear_notificacion
        crear_notificacion(tipo, None, mensaje, destinatarios_extra=destinatarios)
    except Exception as e:
        logger.warning("Aviso de ArmaScanner no enviado a %s: %s", destinatarios, e)


# ── Las reglas (funciones puras) ──
def accion_al_terminar(autor_actual, email: str, mi_reemplazo) -> str:
    """Qué pasa cuando `email` termina un plano cuya entrega es de `autor_actual` (None: sin entrega):
    'nueva' (no tenía), 'mia' (reemplaza la suya: versión siguiente), 'reemplaza' (la de otro, que
    aceptó el reemplazo) u 'ocupado' (la de otro sin reemplazo aceptado: no se guarda nada).
    `mi_reemplazo`: el estado de mi pedido de reemplazo sobre esa entrega, o None."""
    if not autor_actual:
        return "nueva"
    if autor_actual == email:
        return "mia"
    return "reemplaza" if mi_reemplazo == "aceptado" else "ocupado"


def accion_al_cargar(fila, hay_entrega: bool, tamano: int) -> str:
    """Qué hace «cargar» (el plano del calculista, como antecedente) según lo que ArmaHub ya tiene
    del plano: 'crear' si no existe; 'ya_estaba' (no se toca nada) si tiene entrega o trabajo, o si
    es el mismo paquete; 'version_nueva' si sólo estaba cargado y el paquete es otro.
    `fila`: {etapa, tamano} de planos_obra, o None."""
    if not fila:
        return "crear"
    if hay_entrega or fila["etapa"] != "cargado" or fila["tamano"] == tamano:
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


# ── La entrega, los pedidos de reemplazo y la fila del plano en la base ──
def _entregas(cur, obras=None, plano=None) -> dict:
    """{(obra, plano): entrega}, sin sus barras. `obras`: lista de ids (None: todas las obras)."""
    if obras is not None and not obras:
        return {}
    cond, params = [], []
    if obras is not None:
        cond.append("id_proyecto = ANY(%s)")
        params.append(list(obras))
    if plano is not None:
        cond.append("plano = %s")
        params.append(plano)
    cur.execute("""SELECT id, id_proyecto, plano, autor, version, archivo, tamano, resumen, pdf, subido_el
                     FROM planos_obra_entregas""" + (" WHERE " + " AND ".join(cond) if cond else ""), params)
    return {(f[1], f[2]): {"id": f[0], "autor": f[3], "version": f[4], "archivo": f[5], "tamano": f[6],
                           "resumen": f[7] or {}, "pdf": f[8], "subido_el": f[9]} for f in cur.fetchall()}


def _entrega(cur, obra: str, plano: str):
    return _entregas(cur, [obra], plano).get((obra, plano))


def _reemplazos(cur, obras=None) -> dict:
    """{(obra, plano): [pedido…]} los pedidos de reemplazo que siguen corriendo (pendientes y
    aceptados), del más antiguo al más nuevo. `obras`: lista de ids (None: todas las obras)."""
    if obras is not None and not obras:
        return {}
    cur.execute("""SELECT id_proyecto, plano, solicitante, autor, estado, creado_el FROM planos_obra_reemplazos
                    WHERE estado = ANY(%s)""" + (" AND id_proyecto = ANY(%s)" if obras is not None else "") + " ORDER BY id",
                [list(ABIERTOS)] + ([list(obras)] if obras is not None else []))
    out = {}
    for f in cur.fetchall():
        out.setdefault((f[0], f[1]), []).append({"solicitante": f[2], "autor": f[3], "estado": f[4], "creado_el": f[5]})
    return out


def _entrega_dict(e, nombres, yo: str):
    """La entrega del plano como la ven las listas (o None)."""
    return e and {"autor": nombres.get(e["autor"], e["autor"]), "autor_email": e["autor"], "mia": e["autor"] == yo,
                  "version": e["version"], "subido_el": _cuando(e["subido_el"]), "pdf": bool(e["pdf"])}


def _reemplazos_dict(e, pedidos, nombres, yo: str) -> list:
    """Los pedidos de reemplazo que corren sobre la entrega del plano, como los ven las listas."""
    return [{"solicitante": nombres.get(r["solicitante"], r["solicitante"]), "solicitante_email": r["solicitante"],
             "estado": r["estado"], "creado_el": _cuando(r["creado_el"]), "mio": r["solicitante"] == yo}
            for r in pedidos if e and r["autor"] == e["autor"]]


def _fila_base(cur, obra: str, plano: str, exclusiva: bool = False):
    """La fila del plano en `planos_obra` (o None). Con `exclusiva` queda reservada hasta el fin de
    la transacción: lo que cambia la entrega de un plano o sus pedidos pasa de a uno."""
    cur.execute("""SELECT version, archivo, tamano, etapa, subido_por, subido_el, base
                     FROM planos_obra WHERE id_proyecto = %s AND plano = %s""" + (" FOR UPDATE" if exclusiva else ""),
                (obra, plano))
    f = cur.fetchone()
    return f and {"version": f[0], "archivo": f[1], "tamano": f[2], "etapa": f[3] or "", "subido_por": f[4],
                  "subido_el": f[5], "base": f[6]}


def _rotulo(cur, obra: str, plano: str) -> str:
    """«215 (INGEVEC - EDIFICIO LOS LILENES)»: el plano por su número y su obra, para los avisos."""
    cur.execute("SELECT numero FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (obra, plano))
    f = cur.fetchone()
    cur.execute("SELECT nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (obra,))
    g = cur.fetchone()
    return f"{(f and f[0]) or plano} ({(g and g[0]) or obra})"


def _recalcular(cur, obra: str, plano: str):
    """Pone `planos_obra` al día después de un cambio en la entrega del plano (con su fila reservada:
    _fila_base(exclusiva)): toma el resumen de la entrega, y su versión sube cuando la entrega cambia
    (así el pedido sabe si quedó atrás). Sin entrega vuelve a lo que era antes de la primera (el
    antecedente cargado, o el trabajo anterior al cambio); si no tenía archivo propio, se elimina.
    Devuelve la entrega (o None)."""
    from datetime import datetime
    entrega = _entrega(cur, obra, plano)
    fila = _fila_base(cur, obra, plano)
    if entrega and fila:
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
        """, (entrega["id"],))
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
    return entrega


@router.get("/armascanner/planos")
def planos_en_linea(obra: str = "", credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Los planos de todas las obras; con `obra` (id de ArmaHub o código de aSa), los de esa obra.
    Cada uno con su etapa (cargado · terminado · en_trabajo), el resumen de su entrega, la entrega
    (de quién es) y los pedidos de reemplazo que corren sobre ella. `tomado_*` va vacío y NO se quita:
    las versiones publicadas hasta la 2026-11-22 lo leen como x["tomado_por"] y, sin la clave, se caen."""
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
            obras = sorted({f[0] for f in filas}) if obra.strip() else None
            entregas, pedidos = _entregas(cur, obras), _reemplazos(cur, obras)
            nombres = _nombres(cur, [f[13] for f in filas] + [e["autor"] for e in entregas.values()]
                               + [r["solicitante"] for lista in pedidos.values() for r in lista])
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
        e = entregas.get((f[0], f[3]))
        planos.append({
            "obra": f[0], "obra_nombre": f[1], "asa": f[2], "plano": f[3], "numero": f[4] or "", "titulo": f[5] or "",
            "etapa": f[16] or "", "revision": f[6] or "", "elemento": f[7] or "", "version": f[8], "barras": f[9],
            "aprobadas": f[10], "kg": round(float(f[11]), 1) if f[11] is not None else None,
            "tamano": e["tamano"] if e else f[12],
            "subido_por": nombres.get(f[13], f[13] or ""), "subido_el": _cuando(f[14]),
            "tomado_por": "", "tomado_el": "", "tomado_por_mi": False, "pedido": estado_pedido(f[8], f[15]),
            "relacion": f[17] or "", "relacion_de": f[18] or "", "pdf": bool(f[19]),
            "entrega": _entrega_dict(e, nombres, yo),
            "reemplazos": _reemplazos_dict(e, pedidos.get((f[0], f[3]), []), nombres, yo)})
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
# revisadas: es la entrega del plano, con sus barras a la vista y su PDF. Ninguno de los dos carga
# barras en los despieces: eso es «Enviar pedido», que pasa las barras de la entrega a la obra, con su
# procedencia (ArmaScanner). Lo envía quien terminó el plano o un administrador.
# [Usuario 20-nov: «al enviar el pedido lo estamos pasando a los despieces asociados a la obra»]
# (piso y sector, los de la etiqueta de cada barra, desde el 22-nov: el kg por piso de Mis obras)
CAMPOS_BARRA = ("id", "marca", "figura", "diam", "cant", "largo", "kg", "ciclo", "eje", "rev", "motivo", "piso", "sector")


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
    """{barras, aprobadas, consultas, pendientes, kg} de las barras a la vista (+ ciclos, etapa, la
    versión de ArmaScanner que lo manda: `version_app`, que el pedido deja registrada; el Ø promedio
    `diam_prom`; los m² de losa `m2` y `m2_ciclos` si ArmaScanner los manda, y los kg por piso y
    sector `por_piso` si las barras traen su piso). «consultas» = con duda. Función pura."""
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
    d = diam_prom(barras)
    if d is not None:
        r["diam_prom"] = d
    losa = m2_enviados(extra)
    if losa:
        r["m2"], r["m2_ciclos"] = losa
    if any("piso" in b for b in barras):  # un ArmaScanner anterior al 22-nov no los manda
        r["por_piso"] = kg_por_piso(barras, elemento=extra.get("elemento"))
    return r


# ── Los KPIs de un plano y de una obra (Mis obras, 22-nov) ──
# Los mismos de toda la página de ArmaHub (Obras, barras.py; despieces, lotes.py):
#   PPI = Peso Promedio por Ítem = kg / ítems (entradas de la lista, no barras físicas)
#   Ø prom = ponderado por peso, Σ(φ·kg) / Σkg
# y los de la losa: m² = el área de losa que lee ArmaScanner en los planos de losa (LCIELO; las
# elevaciones no traen contornos de losa) y kg/m² = kg sin fundaciones / m² (el kg por piso, abajo).
def _numero(v):
    """El número de `v` si es uno finito (no un booleano), o None."""
    import math
    if isinstance(v, bool):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def diam_prom(barras):
    """Ø promedio ponderado por peso, Σ(φ·kg)/Σkg, de las barras a la vista que traen φ y kg (1
    decimal); None si ninguna los trae. Función pura."""
    suma = peso = 0.0
    for b in barras or []:
        d, kg = _numero(b.get("diam")), _numero(b.get("kg"))
        if d and kg and d > 0 and kg > 0:
            suma += d * kg
            peso += kg
    return round(suma / peso, 1) if peso else None


def m2_enviados(d):
    """(m², {ciclo: m²}) de losa que manda ArmaScanner al terminar un plano de losa; None si no los
    manda (las elevaciones no traen contornos de losa) o no son un área. Función pura."""
    m2 = _numero((d or {}).get("m2"))
    if not m2 or m2 <= 0:
        return None
    ciclos = d.get("m2_ciclos") if isinstance(d.get("m2_ciclos"), dict) else {}
    por = {}
    for k, v in list(ciclos.items())[:200]:
        n = _numero(v)
        if n is not None and n >= 0 and str(k).strip():
            por[str(k).strip()[:12]] = round(n, 1)
    return round(m2, 1), por


def es_losa(elemento) -> bool:
    """¿El plano es de losa (sus m² cuentan para la obra)? `elemento` como lo guarda ArmaHub
    («LCIELO», «LCIELO, VCIELO»). Función pura."""
    return "LCIELO" in [t.strip().upper() for t in str(elemento or "").split(",")]


# ── El kg por piso (Mis obras, 22-nov) ──
# [Usuario 22-nov: «Se debe sumar todo lo de un piso. Las fundaciones las separamos eso sí… se considera
# desde donde nace ese fierro, así que es básicamente todo lo de la etiqueta… toca respetar el piso que
# se señala en cada barra para tener el peso total por piso»]
#   kg del piso  = Σ kg de las barras con ese piso en su etiqueta, de todos los planos (losa, elevación,
#                  vigas), salvo las de fundación (sector FUND), que van aparte
#   m² del piso  = los m² de losa de los planos de losa de ese piso (el piso del plano: el de más kg
#                  entre sus barras)
#   kg/m²        = kg del piso / m² del piso; el de la obra, Σ kg sin fundaciones / Σ m² de losa
# Por piso, además, los kg de losa (losas y vigas de cielo) y los de elevación, por el sector de cada barra.
def piso_normal(piso) -> str:
    """El piso como se agrupa: «P5», «S1», «FUND». ArmaScanner lo anota «P5» y, si no lo leyó, «P»;
    «5» → «P5», «P05» → «P5». "" si no se sabe. Función pura."""
    import re
    p = re.sub(r"\s+", "", str(piso or "")).upper().replace("?", "")
    if p.isdigit():
        p = "P" + p
    p = re.sub(r"^([A-Z]+)0+(\d)", r"\1\2", p)
    return "" if p in ("P", "S") else p[:20]


def clase_de(sector, piso="") -> str:
    """'fund' (fundación: sector o piso FUND), 'elev' (sector ELEV), 'viga' (vigas de cielo: VCIELO)
    o 'losa' (el resto). [Usuario 22-nov: «no, son kilos de vigas»] Función pura."""
    s = str(sector or "").strip().upper()
    if s.startswith("FUND") or piso_normal(piso).startswith("FUND"):
        return "fund"
    return "elev" if s.startswith("ELEV") else "viga" if s.startswith(("VCIELO", "VIGA")) else "losa"


def pedido_por_barra(filas) -> dict:
    """{id de barra: (piso, sector)} de las barras de un plano en los despieces (su pedido enviado), y
    en la clave None el (piso, sector) con más kg. `filas`: [(plano_code, id_unico, piso, sector, kg)];
    el id de la barra va al final de su id_unico («PROY-PC1-B-0001» → «B-0001»). Función pura."""
    out, kg = {}, {}
    for code, unico, piso, sector, k in filas:
        par, code, unico = (piso or "", sector or ""), str(code or ""), str(unico or "")
        if code and code + "-" in unico:
            out[unico.split(code + "-", 1)[1]] = par
        kg[par] = kg.get(par, 0.0) + (_numero(k) or 0.0)
    if kg:
        out[None] = max(sorted(kg), key=lambda x: kg[x])
    return out


def kg_por_piso(barras, pedido=None, elemento="") -> list:
    """[{piso, sector, kg}] de las barras a la vista de un plano, sumadas por su piso y su sector (los
    de su etiqueta). La barra que no los trae (plano terminado antes del 22-nov) toma los suyos del
    pedido enviado (`pedido`: pedido_por_barra) o, si no está en él, los que más pesan en el pedido;
    sin pedido, va sin piso ("") y con el sector del plano (`elemento`, el primero). Función pura."""
    pedido = pedido or {}
    propio = str(elemento or "").split(",")[0].strip().upper()
    suma = {}
    for b in barras or []:
        if "piso" in b:
            piso, sector = b.get("piso"), b.get("sector") or propio
        else:
            piso, sector = pedido.get(str(b.get("id") or "")) or pedido.get(None) or ("", propio)
        k = (piso_normal(piso), str(sector or "").strip().upper()[:20])
        suma[k] = suma.get(k, 0.0) + (_numero(b.get("kg")) or 0.0)
    return [{"piso": p, "sector": s, "kg": round(kg, 1)} for (p, s), kg in sorted(suma.items())]


def piso_del_plano(por_piso) -> str:
    """El piso de un plano (el de sus m² de losa): el de más kg entre sus barras que no son de
    fundación, prefiriendo uno conocido; "" si no hay. Función pura."""
    kg = {}
    for f in por_piso or []:
        if clase_de(f.get("sector"), f.get("piso")) != "fund":
            p = piso_normal(f.get("piso"))
            kg[p] = kg.get(p, 0.0) + float(f.get("kg") or 0)
    conocidos = sorted(p for p in kg if p) or sorted(kg)
    return max(conocidos, key=lambda p: kg[p]) if conocidos else ""


def tabla_por_piso(planos) -> dict:
    """La tabla «Por piso» de una obra: {"pisos": [{piso, kg_losa, kg_viga, kg_elev, kg, m2, kg_m2}], "fund": kg
    de fundaciones}. `planos`: los de plano_para_kpis (su `por_piso` y sus m² de losa). Los pisos en
    orden constructivo (orden.piso_order: S3, S2, S1, P1…) y el sin piso ("") al final. Sin dato va
    None (la pantalla muestra «—»). Función pura."""
    from .orden import piso_order
    pisos, fund = {}, 0.0

    def fila(p):
        return pisos.setdefault(p, {"kg_losa": 0.0, "kg_viga": 0.0, "kg_elev": 0.0, "m2": 0.0})

    for pl in planos:
        for f in pl.get("por_piso") or []:
            kg, clase = float(f.get("kg") or 0), clase_de(f.get("sector"), f.get("piso"))
            if clase == "fund":
                fund += kg
            else:
                fila(piso_normal(f.get("piso")))["kg_" + clase] += kg
        m2 = _numero(pl.get("m2"))
        if m2 and m2 > 0:
            fila(piso_del_plano(pl.get("por_piso")))["m2"] += m2
    out = []
    for p in sorted(pisos, key=lambda p: (p == "", piso_order(p), p)):
        x = pisos[p]
        kg, m2 = round(x["kg_losa"] + x["kg_viga"] + x["kg_elev"], 1), round(x["m2"], 1) or None
        out.append({"piso": p, "kg_losa": round(x["kg_losa"], 1) or None, "kg_viga": round(x["kg_viga"], 1) or None,
                    "kg_elev": round(x["kg_elev"], 1) or None, "kg": kg or None, "m2": m2,
                    "kg_m2": round(kg / m2, 1) if m2 and kg else None})
    return {"pisos": out, "fund": round(fund, 1) or None}


def plano_para_kpis(resumen, elemento, diam=None, por_piso=None) -> dict:
    """Lo que un plano aporta a los KPIs: {items, kg, diam_prom, m2, por_piso, kg_fund}. Los m² sólo
    si es de losa. `diam` y `por_piso`: el Ø promedio y los kg por piso calculados aparte (resumen
    anterior al 22-nov, que no los trae: _diam_faltante, _por_piso_faltante). Sin kg por piso, todo el
    plano va sin piso y con su sector."""
    r = resumen or {}
    kg = float(r.get("kg") or 0)
    if por_piso is None:
        por_piso = r["por_piso"] if isinstance(r.get("por_piso"), list) else \
            kg_por_piso([{"kg": kg}] if kg else [], elemento=elemento)
    return {"items": int(r.get("barras") or 0), "kg": kg,
            "diam_prom": r.get("diam_prom") if r.get("diam_prom") is not None else diam,
            "m2": r.get("m2") if es_losa(elemento) else None, "por_piso": por_piso,
            "kg_fund": round(sum(float(f.get("kg") or 0) for f in por_piso
                                 if clase_de(f.get("sector"), f.get("piso")) == "fund"), 1)}


def kpis_de(planos) -> dict:
    """{items, kg, ppi, diam_prom, m2, kg_m2, kg_fund} de uno o varios planos (plano_para_kpis). `kg`
    es todo; `kg_fund`, lo de fundaciones. kg/m² = Σ kg de los pisos que tienen m² de losa / Σ esos m²
    (tabla_por_piso): un piso sin su losa escaneada no entra, y las fundaciones nunca. [Usuario 22-nov:
    «tenemos totales por piso que se dividen por el área del piso… se muestra cuando haya m²»] Sin
    dato va None (la pantalla muestra «—», nunca 0). Función pura."""
    items = sum(int(p.get("items") or 0) for p in planos)
    kg = round(sum(float(p.get("kg") or 0) for p in planos), 1)
    fund = round(sum(float(p.get("kg_fund") or 0) for p in planos), 1)
    con_d = [(float(p["diam_prom"]), float(p.get("kg") or 0)) for p in planos if _numero(p.get("diam_prom"))]
    peso_d = sum(k for _, k in con_d)
    m2s = [float(p["m2"]) for p in planos if _numero(p.get("m2"))]
    m2 = round(sum(m2s), 1) if m2s else None
    if any(p.get("por_piso") for p in planos):
        con_m2 = [f for f in tabla_por_piso(planos)["pisos"] if f["m2"] and f["kg"]]
        m2_pisos = sum(f["m2"] for f in con_m2)
        kg_m2 = round(sum(f["kg"] for f in con_m2) / m2_pisos, 1) if m2_pisos else None
    else:  # sin el kg por piso (planos sin datos de piso): kg sin fundaciones / m² de losa
        kg_m2 = round((kg - fund) / m2, 1) if m2 and kg - fund > 0 else None
    return {"items": items, "kg": kg, "ppi": round(kg / items, 2) if items else None,
            "diam_prom": round(sum(d * k for d, k in con_d) / peso_d, 1) if peso_d else None,
            "m2": m2, "kg_m2": kg_m2, "kg_fund": fund or None}


def reemplazados(filas) -> set:
    """{(obra, plano)} de los planos que otro de la misma obra reemplaza (relacion «reemplaza»,
    relacion_de = ese plano): quedan como antecedente y no suman a la obra. `filas`: [(obra, plano,
    relacion, relacion_de)]. Función pura."""
    return {(o, de) for o, _p, rel, de in filas if rel == "reemplaza" and de}


def _diam_faltante(cur, claves) -> dict:
    """{(obra, plano): Ø promedio} de los planos cuyo resumen no lo trae (terminados antes del
    22-nov): se calcula de sus barras a la vista."""
    claves = set(claves)
    if not claves:
        return {}
    cur.execute("SELECT id_proyecto, plano, barras_json FROM planos_obra WHERE id_proyecto = ANY(%s) AND plano = ANY(%s)",
                (sorted({c[0] for c in claves}), sorted({c[1] for c in claves})))
    return {(o, p): diam_prom(b if isinstance(b, list) else []) for o, p, b in cur.fetchall() if (o, p) in claves}


def _por_piso_faltante(cur, claves) -> dict:
    """{(obra, plano): kg por piso} de los planos cuyo resumen no lo trae (terminados antes del 22-nov
    o con un ArmaScanner anterior): de sus barras a la vista, con el piso y el sector que cada una
    tiene en su pedido enviado (los despieces: tabla barras, por los códigos del plano, como la
    sección aSa) y, sin pedido, sin piso (kg_por_piso)."""
    claves = set(claves)
    if not claves:
        return {}
    cur.execute("""SELECT id_proyecto, plano, barras_json, codigos, elemento FROM planos_obra
                    WHERE id_proyecto = ANY(%s) AND plano = ANY(%s)""",
                (sorted({c[0] for c in claves}), sorted({c[1] for c in claves})))
    filas = [f for f in cur.fetchall() if (f[0], f[1]) in claves]
    de_codigo = {(o, c): (o, p) for o, p, _b, codigos, _e in filas
                 for c in (codigos if isinstance(codigos, list) else []) if isinstance(c, str) and c.strip()}
    del_pedido = {}
    if de_codigo:
        cur.execute("""SELECT id_proyecto, plano_code, id_unico, COALESCE(piso, ''), COALESCE(sector, ''),
                              COALESCE(peso_total, 0)
                         FROM barras WHERE id_proyecto = ANY(%s) AND plano_code = ANY(%s)""",
                    (sorted({k[0] for k in de_codigo}), sorted({k[1] for k in de_codigo})))
        for o, code, unico, piso, sector, kg in cur.fetchall():
            if (o, code) in de_codigo:
                del_pedido.setdefault(de_codigo[(o, code)], []).append((code, unico, piso, sector, kg))
    return {(o, p): kg_por_piso(b if isinstance(b, list) else [], pedido_por_barra(del_pedido.get((o, p), [])), e)
            for o, p, b, _c, e in filas}


def puede_enviar(autor, email: str, admin: bool) -> bool:
    """Envía el pedido de un plano quien lo terminó (el autor de su entrega) o un administrador. Función
    pura."""
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


SIN_OBRA = "La obra no está en ArmaHub › Mis obras: agrégala ahí."


def _obra_de(cur, d: dict) -> str:
    """El id de la obra de ArmaScanner: el que manda (`obra`) o, con el código de aSa, la obra enlazada a
    ese código. Sólo resuelve: la obra se agrega en ArmaHub › Mis obras (`armascanner_obras`), nunca por
    aquí. Así un «Terminar» no vuelve a meter una obra que el administrador eliminó, ni sube a una obra
    que nadie agregó. Si no está, 409."""
    cur.execute("""SELECT o.id_proyecto FROM armascanner_obras o JOIN proyectos p ON p.id_proyecto = o.id_proyecto
                    WHERE o.id_proyecto = %s OR p.asa_job_id = %s ORDER BY 1""", (d["obra"] or None, d["asa"] or None))
    ids = [f[0] for f in cur.fetchall()]
    if not ids:
        raise HTTPException(status_code=409, detail=SIN_OBRA)
    return d["obra"] if d["obra"] in ids else ids[0]


def _obra_vigente(cur, obra: str):
    """La comprobación que vale, dentro de la transacción que guarda: la obra sigue en ArmaScanner, y su
    fila queda tomada para leer hasta el fin (limpiarla o eliminarla espera, y viceversa). Si no, 409."""
    cur.execute("SELECT 1 FROM armascanner_obras WHERE id_proyecto = %s FOR SHARE", (obra,))
    if not cur.fetchone():
        raise HTTPException(status_code=409, detail=SIN_OBRA)


def _registrar_obra(cur, obra: str, email: str) -> bool:
    """La obra queda en ArmaScanner (`armascanner_obras`). True si no estaba."""
    cur.execute("""INSERT INTO armascanner_obras (id_proyecto, agregada_por) VALUES (%s, %s)
                   ON CONFLICT (id_proyecto) DO NOTHING""", (obra, email))
    return cur.rowcount == 1


def _texto(d: dict, k: str, largo: int):
    return str(d.get(k) or "").strip()[:largo] or None


# La carga de antecedentes (el plano del calculista, etapa «cargado») queda en pausa: abrir o tener un
# plano en el equipo no sube nada; ArmaHub recibe el plano recién al «Terminar». Vuelve cuando el flujo
# esté probado y se defina la aprobación del cliente. [Usuario 23-nov: «que tenga abierto un plano en mi
# computador no tiene nada que ver con que se cargue en ArmaHub»; «Hoy no, cuando esté implementado,
# probado y estemos conformes, incorporaremos esa regla»]
CARGA_ANTECEDENTES = False


@router.post("/armascanner/planos/guardar")
async def guardar_plano(datos: str = Form(...), paquete: UploadFile = File(...),
                        credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Carga el plano del calculista como antecedente (etapa «cargado»): queda en ArmaHub a la vista
    de todos. `datos` (JSON): obra | asa, plano, etapa = "cargado", numero, titulo, rev, elemento,
    relacion, relacion_de. Si el plano no existe, se crea (v1). Si ya tiene entrega o trabajo, o es
    el mismo paquete (mismo tamaño), no se toca nada y responde `ya_estaba`: dos cubicadores cargan
    el mismo DWG sin estorbarse, y cargar nunca rebaja un plano trabajado. Si sólo estaba cargado y
    el paquete es otro, queda como la versión siguiente del antecedente. Ya no guarda trabajo
    intermedio: con otra etapa responde 409 (un ArmaScanner anterior al cambio).
    [Usuario 20-nov: «el cubicador cargue TODOS los planos, para tener un registro de TODOS los
    antecedentes técnicos»] En pausa (CARGA_ANTECEDENTES): responde 410."""
    from . import storage
    if not CARGA_ANTECEDENTES:
        raise HTTPException(status_code=410, detail="Actualiza ArmaScanner: ArmaHub recibe el plano recién al «Terminar».")
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            d = _datos_plano(datos)
            if (d.get("etapa") or "") != "cargado":
                raise HTTPException(status_code=409, detail="Actualiza ArmaScanner: esta versión ya no guarda el "
                                                            "trabajo intermedio en ArmaHub.")
            obra, plano, email = _obra_de(cur, d), d["plano"], user["email"]
            fila = _fila_base(cur, obra, plano)
            hay_entrega = _entrega(cur, obra, plano) is not None
    contenido = await paquete.read()
    accion = accion_al_cargar(fila, hay_entrega, len(contenido))
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
                else:  # sólo si sigue como estaba al mirarlo: cargado, en esa versión y sin entrega
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


def _accion_o_409(cur, obra: str, plano: str, email: str, entrega) -> str:
    """accion_al_terminar con lo que hay en la base; si el plano es de otro y no tengo su reemplazo
    aceptado, 409 «ocupado» con quién lo subió y en qué va mi pedido de reemplazo."""
    mio = None
    if entrega and entrega["autor"] != email:
        cur.execute("""SELECT estado FROM planos_obra_reemplazos
                        WHERE id_proyecto = %s AND plano = %s AND solicitante = %s AND autor = %s
                          AND estado IN ('pendiente', 'aceptado', 'rechazado')
                        ORDER BY id DESC LIMIT 1""", (obra, plano, email, entrega["autor"]))
        f = cur.fetchone()
        mio = f[0] if f else None
    accion = accion_al_terminar(entrega and entrega["autor"], email, mio)
    if accion == "ocupado":
        nombre = _nombres(cur, [entrega["autor"]]).get(entrega["autor"], entrega["autor"])
        raise HTTPException(status_code=409, detail={
            "codigo": "ocupado", "autor": nombre, "subido_el": _cuando(entrega["subido_el"]), "reemplazo": mio,
            "mensaje": f"{nombre} ya subió este plano ({_cuando(entrega['subido_el'])}). Pídele que acepte el reemplazo."})
    return accion


@router.post("/armascanner/planos/terminar")
async def terminar_plano(datos: str = Form(...), paquete: UploadFile = File(...),
                         pdf: Optional[UploadFile] = File(None),
                         credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """El plano terminado (todas sus barras revisadas): queda como la entrega del plano, con sus barras
    a la vista y su PDF. `datos` (JSON): obra | asa, plano, numero, titulo, rev, elemento, ciclos,
    relacion, relacion_de, barras [{id, marca, figura, diam, cant, largo, kg, ciclo, eje, rev,
    motivo, piso, sector}], version_app, m2, m2_ciclos. La obra tiene que estar en Mis obras (si no,
    409 y no se sube nada: _obra_de).
    Una entrega por plano. Sin entrega, o si es la mía, entra (la mía pasa a la versión siguiente). Si
    es de otro, entra sólo si su autor aceptó mi pedido de reemplazo: reemplaza la suya, el pedido queda
    cumplido y a él se le avisa. Si no lo aceptó, 409 «ocupado» y no se guarda nada. Cada subida va a
    una key propia de R2; el archivo anterior se borra recién cuando la base confirmó."""
    from . import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            d = _datos_plano(datos)
            obra, plano, email = _obra_de(cur, d), d["plano"], user["email"]
            _accion_o_409(cur, obra, plano, email, _entrega(cur, obra, plano))  # antes de subir nada a R2
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
                _obra_vigente(cur, obra)  # mientras subía, el administrador pudo eliminar la obra
                # la fila del plano existe (si no, se crea vacía) y queda reservada: dos que terminan a la
                # vez el mismo plano entran de a uno, y el segundo ya ve la entrega del primero
                cur.execute("""INSERT INTO planos_obra (id_proyecto, plano, version) VALUES (%s, %s, 0)
                               ON CONFLICT (id_proyecto, plano) DO NOTHING""", (obra, plano))
                if not _fila_base(cur, obra, plano, exclusiva=True):  # lo eliminaron en este mismo instante
                    raise HTTPException(status_code=409, detail="El plano cambió en ArmaHub mientras subía: vuelve a "
                                                                "terminarlo.")
                antes = _entrega(cur, obra, plano)
                accion = _accion_o_409(cur, obra, plano, email, antes)  # la comprobación que vale
                cur.execute("""
                    INSERT INTO planos_obra_entregas (id_proyecto, plano, autor, version, archivo, tamano, numero, titulo,
                                                      revision, elemento, resumen, barras_json, pdf, subido_el)
                    VALUES (%s, %s, %s, 1, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, NOW())
                    ON CONFLICT (id_proyecto, plano) DO UPDATE SET
                        autor = EXCLUDED.autor, version = planos_obra_entregas.version + 1,
                        archivo = EXCLUDED.archivo, tamano = EXCLUDED.tamano, numero = EXCLUDED.numero,
                        titulo = EXCLUDED.titulo, revision = EXCLUDED.revision, elemento = EXCLUDED.elemento,
                        resumen = EXCLUDED.resumen, barras_json = EXCLUDED.barras_json, pdf = EXCLUDED.pdf,
                        subido_el = EXCLUDED.subido_el
                    RETURNING version
                """, (obra, plano, email, clave, len(contenido), _texto(d, "numero", 40), _texto(d, "titulo", 300),
                      _texto(d, "rev", 20), _texto(d, "elemento", 20), json.dumps(resumen), json.dumps(barras),
                      clave_pdf))
                version = cur.fetchone()[0]
                # mis pedidos de reemplazo sobre este plano se cumplieron; los de otros sobre la entrega
                # que ya no está (la de su autor anterior) dejan de correr
                cur.execute("""UPDATE planos_obra_reemplazos SET estado = 'cumplido'
                                WHERE id_proyecto = %s AND plano = %s AND solicitante = %s
                                  AND estado IN ('pendiente', 'aceptado')""", (obra, plano, email))
                cur.execute("""UPDATE planos_obra_reemplazos SET estado = 'anulado', respondido_el = NOW()
                                WHERE id_proyecto = %s AND plano = %s AND autor <> %s
                                  AND estado IN ('pendiente', 'aceptado')""", (obra, plano, email))
                _recalcular(cur, obra, plano)
                if relacion is not None:
                    cur.execute("UPDATE planos_obra SET relacion = %s, relacion_de = %s WHERE id_proyecto = %s AND plano = %s",
                                relacion + (obra, plano))
                aviso = None
                if accion == "reemplaza":
                    nombre = _nombres(cur, [email]).get(email, email)
                    aviso = f"{nombre} reemplazó tu versión de {_rotulo(cur, obra, plano)}."
    except Exception:
        _borrar(clave, clave_pdf)  # la base no confirmó: lo subido en este intento no queda suelto
        raise
    if antes:
        _borrar(antes["archivo"], antes["pdf"])  # la entrega anterior (mía o la reemplazada), recién ahora
    if aviso:
        _avisar([antes["autor"]], aviso)
    audit(email, "armascanner_terminar_plano",
          f"{plano} v{version}: {resumen['barras']} barras, {resumen['kg']} kg"
          + (f"; reemplaza la de {antes['autor']}" if accion == "reemplaza" else ""), "proyecto", obra)
    return {"ok": True, "version": version, "id_proyecto": obra, "resumen": resumen,
            "reemplazo_de": antes["autor"] if accion == "reemplaza" else ""}


class DescargaPlano(BaseModel):
    obra: str
    plano: str
    autor: str = ""


@router.post("/armascanner/planos/descargar")
def descargar_plano(datos: DescargaPlano, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """El enlace para bajar el paquete de un plano (dura minutos). No reserva nada. `autor`: "mia" =
    la entrega, sólo si es mía; vacío = la entrega o, si el plano no tiene, el paquete de
    `planos_obra` (el antecedente, o el trabajo anterior al cambio)."""
    from . import storage
    quien = datos.autor.strip()
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            entrega = _entrega(cur, datos.obra, datos.plano)
            fila = _fila_base(cur, datos.obra, datos.plano)
            nombres = _nombres(cur, [entrega and entrega["autor"], fila and fila["subido_por"]])
    if quien == "mia" and not (entrega and entrega["autor"] == user["email"]):
        raise HTTPException(status_code=404, detail="No tienes una versión de este plano en ArmaHub.")
    if quien and quien != "mia" and not (entrega and quien in (entrega["autor"], nombres.get(entrega["autor"]))):
        raise HTTPException(status_code=404, detail="Esa versión del plano no está en ArmaHub.")
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


# ── Pedidos de reemplazo: el plano lo tiene otro cubicador y yo también lo terminé ──
# Lo pido; su autor acepta (o rechaza) desde ArmaScanner, o un administrador responde por él en el
# portal. Aceptar no borra nada: su entrega sigue vigente hasta que yo termine el plano, y entonces la
# mía la reemplaza. Estados: pendiente · aceptado · rechazado · cumplido · anulado.
@router.post("/armascanner/planos/reemplazo/pedir")
def pedir_reemplazo(datos: PlanoEnLinea, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Pide al autor de la entrega del plano que acepte el reemplazo y le avisa en la campana. Si ya
    hay un pedido mío pendiente o aceptado, responde su estado (no pide dos veces)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            email = user["email"]
            _fila_base(cur, datos.obra, datos.plano, exclusiva=True)
            entrega = _entrega(cur, datos.obra, datos.plano)
            if not entrega or entrega["autor"] == email:
                raise HTTPException(status_code=409, detail="Este plano no tiene la versión de otro cubicador: "
                                                            "puedes terminarlo.")
            # un pedido mío sobre la entrega de otro autor (ya no está) deja de correr
            cur.execute("""UPDATE planos_obra_reemplazos SET estado = 'anulado', respondido_el = NOW()
                            WHERE id_proyecto = %s AND plano = %s AND solicitante = %s AND autor <> %s
                              AND estado IN ('pendiente', 'aceptado')""", (datos.obra, datos.plano, email, entrega["autor"]))
            cur.execute("""SELECT estado FROM planos_obra_reemplazos
                            WHERE id_proyecto = %s AND plano = %s AND solicitante = %s
                              AND estado IN ('pendiente', 'aceptado')""", (datos.obra, datos.plano, email))
            ya = cur.fetchone()
            if ya:
                return {"ok": True, "estado": ya[0]}
            cur.execute("""INSERT INTO planos_obra_reemplazos (id_proyecto, plano, solicitante, autor, estado)
                           VALUES (%s, %s, %s, %s, 'pendiente')""", (datos.obra, datos.plano, email, entrega["autor"]))
            aviso = f"{_nombres(cur, [email]).get(email, email)} pide reemplazar tu versión de " \
                    f"{_rotulo(cur, datos.obra, datos.plano)}."
    _avisar([entrega["autor"]], aviso)
    audit(email, "armascanner_reemplazo", f"{datos.plano}: pide reemplazar la de {entrega['autor']}", "proyecto", datos.obra)
    return {"ok": True, "estado": "pendiente"}


@router.get("/armascanner/planos/reemplazos")
def mis_reemplazos(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """`para_mi`: los pedidos pendientes sobre mis entregas (para aceptar o rechazar). `mios`: mis
    pedidos que siguen corriendo o que me rechazaron (el último por plano)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            yo = user["email"]
            # sólo los pedidos sobre la entrega que está (la de su autor de hoy)
            cur.execute("""SELECT r.id_proyecto, r.plano, r.solicitante, r.autor, r.estado, r.creado_el, r.respondido_el
                             FROM planos_obra_reemplazos r
                             JOIN planos_obra_entregas e
                               ON e.id_proyecto = r.id_proyecto AND e.plano = r.plano AND e.autor = r.autor
                            WHERE (r.autor = %s AND r.estado = 'pendiente') OR r.solicitante = %s
                            ORDER BY r.id""", (yo, yo))
            filas = cur.fetchall()
            claves = sorted({f[0] for f in filas})
            rotulos = {}
            if claves:
                cur.execute("""SELECT p.id_proyecto, p.plano, p.numero, COALESCE(pr.nombre_proyecto, p.id_proyecto)
                                 FROM planos_obra p LEFT JOIN proyectos pr ON pr.id_proyecto = p.id_proyecto
                                WHERE p.id_proyecto = ANY(%s)""", (claves,))
                rotulos = {(f[0], f[1]): (f[2] or "", f[3]) for f in cur.fetchall()}
            nombres = _nombres(cur, [f[2] for f in filas] + [f[3] for f in filas])
    para_mi, mios = [], {}
    for obra, plano, solicitante, autor, estado, creado, respondido in filas:
        numero, obra_nombre = rotulos.get((obra, plano), ("", obra))
        base = {"obra": obra, "obra_nombre": obra_nombre, "plano": plano, "numero": numero, "creado_el": _cuando(creado)}
        if autor == yo and estado == "pendiente":
            para_mi.append(dict(base, solicitante=nombres.get(solicitante, solicitante), solicitante_email=solicitante))
        if solicitante == yo:  # el último por plano (uno anulado no deja ver un rechazo anterior)
            mios[(obra, plano)] = dict(base, autor=nombres.get(autor, autor), autor_email=autor, estado=estado,
                                       respondido_el=_cuando(respondido))
    return {"para_mi": para_mi,
            "mios": [x for x in mios.values() if x["estado"] in ("pendiente", "aceptado", "rechazado")]}


class RespuestaReemplazo(BaseModel):
    obra: str
    plano: str
    solicitante: str      # su correo o su nombre
    acepta: bool


def _responder(email: str, admin: bool, datos: RespuestaReemplazo) -> dict:
    """Acepta o rechaza un pedido de reemplazo: el autor de la entrega o, en su lugar, un
    administrador. Aceptar no borra nada. Avisa al solicitante."""
    nuevo = "aceptado" if datos.acepta else "rechazado"
    with get_conn() as conn:
        with conn.cursor() as cur:
            _fila_base(cur, datos.obra, datos.plano, exclusiva=True)
            entrega = _entrega(cur, datos.obra, datos.plano)
            if not entrega:
                raise HTTPException(status_code=404, detail="Este plano no tiene una versión que reemplazar.")
            if entrega["autor"] != email and not admin:
                raise HTTPException(status_code=403, detail="Responde el pedido quien subió el plano o un administrador.")
            cur.execute("""SELECT id, solicitante, estado FROM planos_obra_reemplazos
                            WHERE id_proyecto = %s AND plano = %s AND autor = %s
                              AND estado IN ('pendiente', 'aceptado', 'rechazado')
                            ORDER BY id DESC""", (datos.obra, datos.plano, entrega["autor"]))
            pedidos = cur.fetchall()
            nombres = _nombres(cur, [f[1] for f in pedidos] + [email])
            quien = datos.solicitante.strip()
            pedido = next((f for f in pedidos if quien and quien in (f[1], nombres.get(f[1]))), None)
            if not pedido:
                raise HTTPException(status_code=404, detail="Ese pedido de reemplazo no está en ArmaHub.")
            if pedido[2] == nuevo:  # ya estaba así (la respuesta llegó dos veces)
                return {"ok": True, "estado": nuevo}
            if pedido[2] != "pendiente":
                raise HTTPException(status_code=409, detail="Ese pedido de reemplazo ya fue respondido.")
            cur.execute("""UPDATE planos_obra_reemplazos SET estado = %s, respondido_por = %s, respondido_el = NOW()
                            WHERE id = %s""", (nuevo, email, pedido[0]))
            aviso = f"{nombres.get(email, email)} {'aceptó' if datos.acepta else 'rechazó'} que reemplaces " \
                    f"{_rotulo(cur, datos.obra, datos.plano)}."
    _avisar([pedido[1]], aviso)
    audit(email, "armascanner_reemplazo", f"{datos.plano}: {nuevo} el pedido de {pedido[1]}"
          + (f" (en lugar de {entrega['autor']})" if email != entrega["autor"] else ""), "proyecto", datos.obra)
    return {"ok": True, "estado": nuevo}


@router.post("/armascanner/planos/reemplazo/responder")
def responder_reemplazo(datos: RespuestaReemplazo, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Desde ArmaScanner: el autor de la entrega acepta o rechaza el pedido."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
    return _responder(user["email"], False, datos)


async def _enviar_pedido(user: dict, obra: str, plano: str) -> dict:
    """Las barras de la entrega del plano pasan a los despieces de la obra (reemplazan las de ese
    plano, también las de sus códigos anteriores). Si se aceptó reemplazar la entrega, no se envía:
    el plano está por cambiar. Sin entrega no hay barras que enviar. El pedido queda anotado sólo si
    el plano sigue en la versión revisada y sin reemplazo aceptado (si cambió mientras se importaba,
    409: las barras de la versión revisada ya entraron y el pedido queda por reenviar)."""
    import zipfile
    from . import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT version, codigos FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (obra, plano))
            fila = cur.fetchone()
            entrega = _entrega(cur, obra, plano)
            aceptado = None
            if entrega:
                cur.execute("""SELECT 1 FROM planos_obra_reemplazos WHERE id_proyecto = %s AND plano = %s AND autor = %s
                                  AND estado = 'aceptado' LIMIT 1""", (obra, plano, entrega["autor"]))
                aceptado = cur.fetchone()
    if not fila:
        raise HTTPException(status_code=404, detail="Ese plano no está en ArmaHub.")
    version, codigos = fila
    if not entrega:
        raise HTTPException(status_code=422, detail="El plano no tiene barras para enviar.")
    if aceptado:
        raise HTTPException(status_code=409, detail="Se aceptó reemplazar este plano: envía el pedido cuando se "
                                                    "suba la nueva versión.")
    archivo, autor, resumen = entrega["archivo"], entrega["autor"], entrega["resumen"]
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
            # sólo si el plano sigue como se revisó: la misma versión (la misma entrega) y sin reemplazo aceptado
            cur.execute("""UPDATE planos_obra SET pedido_version = %s, pedido_el = NOW(), pedido_por = %s,
                                                  codigos = %s::jsonb
                            WHERE id_proyecto = %s AND plano = %s AND version = %s
                              AND NOT EXISTS (SELECT 1 FROM planos_obra_reemplazos r
                                               WHERE r.id_proyecto = planos_obra.id_proyecto AND r.plano = planos_obra.plano
                                                 AND r.autor = %s AND r.estado = 'aceptado')""",
                        (version, user.get("email"), json.dumps(todos), obra, plano, version, autor))
            anotado = cur.rowcount == 1
    audit(user.get("email", "?"), "armascanner_enviar_pedido",
          f"{plano} v{version} → {res.get('proyecto')}: {res.get('barras')} barras, {res.get('kilos')} kg, "
          f"{n_pend} sin aprobar" + ("" if anotado else "; el plano cambió mientras se enviaba: queda por reenviar"),
          "proyecto", obra)
    if not anotado:
        raise HTTPException(status_code=409, detail="El plano cambió en ArmaHub mientras se enviaba el pedido (otra "
                                                    "versión o un reemplazo aceptado): revísalo y vuelve a enviarlo.")
    return {"ok": True, "version": version, "import_id": res["import_id"], "obra": res.get("proyecto"),
            "barras": res.get("barras"), "kilos": res.get("kilos"),
            "reemplazadas": res.get("barras_eliminadas_previo"), "pendientes": n_pend, "plano_code": plano_code}


@router.post("/armascanner/planos/pedido")
async def enviar_pedido(datos: PlanoEnLinea, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """«Enviar pedido» desde ArmaScanner (ficha de licencia)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
    return await _enviar_pedido(user, datos.obra, datos.plano)


# ── La pestaña Planos del portal (sesión del portal): avance, barras, PDF, reemplazos, pedido ──
def _fila_plano(f, nombres, yo: str, admin: bool, entrega, pedidos: list, diam=None) -> dict:
    (obra, obra_nombre, plano, numero, titulo, revision, elemento, version, tamano, subido_por, subido_el,
     resumen, pedido_version, pedido_el, pedido_por, pdf, barras, aprobadas, kg, etapa, relacion, relacion_de) = f
    r = resumen or {"barras": barras or 0, "aprobadas": aprobadas or 0, "consultas": 0,
                    "pendientes": (barras or 0) - (aprobadas or 0), "kg": float(kg or 0)}
    kpis = kpis_de([plano_para_kpis(r, elemento, diam)]) if etapa != "cargado" else None
    reemplazos = _reemplazos_dict(entrega, pedidos, nombres, yo)
    por_cambiar = any(x["estado"] == "aceptado" for x in reemplazos)
    return {"obra": obra, "obra_nombre": obra_nombre, "plano": plano, "numero": numero or "", "titulo": titulo or "",
            "revision": revision or "", "elemento": elemento or "", "version": version, "tamano": tamano,
            "guardado_por": nombres.get(subido_por, subido_por or ""), "guardado_el": _cuando(subido_el),
            "resumen": r, "pedido": estado_pedido(version, pedido_version), "pedido_version": pedido_version,
            "pedido_el": _cuando(pedido_el), "pedido_por": nombres.get(pedido_por, pedido_por or ""),
            "puede_enviar": etapa != "cargado" and not por_cambiar and puede_enviar(subido_por, yo, admin),
            "pdf": bool(pdf), "etapa": etapa or "", "puede_eliminar": admin,
            "relacion": relacion or "", "relacion_de": relacion_de or "",
            "entrega": _entrega_dict(entrega, nombres, yo), "reemplazos": reemplazos,
            "puede_responder": bool(entrega) and (admin or entrega["autor"] == yo), "kpis": kpis}


@router.get("/armascanner/planos-linea")
def planos_linea(obra: str = "", user=Depends(get_current_user)):
    """Los planos (portal; con `obra`, los de esa obra: la ventana de la obra en Mis obras): cada uno
    con su etapa, el avance de su entrega (barras, aprobadas, con consulta, por aprobar, kg), sus KPIs
    (ítems, kg, PPI, Ø, m² si es de losa), de quién es, los pedidos de reemplazo y el estado de su
    pedido."""
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
            obras = [obra.strip()] if obra.strip() else None
            entregas, pedidos = _entregas(cur, obras), _reemplazos(cur, obras)
            nombres = _nombres(cur, [f[9] for f in filas] + [f[14] for f in filas]
                               + [e["autor"] for e in entregas.values()]
                               + [r["solicitante"] for lista in pedidos.values() for r in lista])
            diam = _diam_faltante(cur, [(f[0], f[2]) for f in filas
                                        if f[19] != "cargado" and f[16] and "diam_prom" not in (f[11] or {})])
    yo, admin = user.get("email", ""), _es_admin(user)
    return {"admin": admin, "planos": [_fila_plano(f, nombres, yo, admin, entregas.get((f[0], f[2])),
                                                   pedidos.get((f[0], f[2]), []), diam.get((f[0], f[2])))
                                       for f in filas]}


@router.get("/armascanner/planos-linea/barras")
def barras_del_plano(obra: str, plano: str, user=Depends(get_current_user)):
    """Las barras de la entrega del plano como las mandó ArmaScanner (no son despieces de la obra
    hasta «Enviar pedido»)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            cur.execute("SELECT version, barras_json FROM planos_obra WHERE id_proyecto = %s AND plano = %s",
                        (obra, plano))
            fila = cur.fetchone()
    if not fila:
        raise HTTPException(status_code=404, detail="Ese plano no está en ArmaHub.")
    return {"version": fila[0], "barras": fila[1] or []}


@router.get("/armascanner/planos-linea/pdf")
def pdf_del_plano(obra: str, plano: str, user=Depends(get_current_user)):
    """El enlace al PDF del plano en R2 (dura minutos; el navegador lo muestra en la página, no lo
    descarga). Sin PDF, `url` va null (visor.js dice «Este plano no tiene PDF»; un 404 lo haría fallar)."""
    from . import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            cur.execute("SELECT pdf FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (obra, plano))
            fila = cur.fetchone()
    if not fila or not fila[0]:
        return {"url": None}
    return {"url": storage.generate_presigned_url(fila[0], expires=DESCARGA_SEGUNDOS, content_type="application/pdf")}


def dwg_del_paquete(nombres):
    """El DWG que se descarga del paquete del plano: la copia de trabajo (trabajo/<plano>_IA.dwg, con
    la cubicación dibujada) o, si no la trae (un antecedente), el plano del calculista (planos/…).
    None si el paquete no trae un DWG. Función pura."""
    dwg = [n for n in nombres if n.lower().endswith(".dwg")]
    return (next((n for n in dwg if n.startswith("trabajo/")), None)
            or next((n for n in dwg if n.startswith("planos/")), None) or (dwg[0] if dwg else None))


@router.get("/armascanner/planos-linea/dwg")
def dwg_del_plano(obra: str, plano: str, user=Depends(get_current_user)):
    """«Descargar DWG»: el DWG del plano, sacado de su paquete en R2: el de la entrega (la copia de
    trabajo) o, sin entrega, el del antecedente. [Usuario 22-nov: «Descargar DWG (ver el DWG en la
    web, más adelante)»]"""
    import zipfile
    from urllib.parse import quote
    from fastapi.responses import Response
    from . import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            entrega = _entrega(cur, obra, plano)
            fila = _fila_base(cur, obra, plano)
    archivo = (entrega and entrega["archivo"]) or (fila and fila["archivo"])
    if not archivo:
        raise HTTPException(status_code=404, detail="Este plano no tiene DWG en ArmaHub.")
    try:
        z = zipfile.ZipFile(BytesIO(storage.download_file(archivo)))
        miembro = dwg_del_paquete(z.namelist())
        contenido = z.read(miembro) if miembro else None
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"No se pudo leer el plano guardado ({str(e)[:80]}).")
    if not contenido:
        raise HTTPException(status_code=404, detail="Este plano no tiene DWG en ArmaHub.")
    nombre = miembro.rsplit("/", 1)[-1]
    simple = "".join(c if c.isascii() and (c.isalnum() or c in "._-() ") else "_" for c in nombre)
    audit(user.get("email", "?"), "armascanner_descargar_dwg", f"{plano} ({nombre})", "proyecto", obra)
    return Response(contenido, media_type="application/octet-stream", headers={
        "Content-Disposition": f"attachment; filename=\"{simple}\"; filename*=UTF-8''{quote(nombre)}"})


@router.post("/armascanner/planos-linea/reemplazo/responder")
def responder_reemplazo_portal(datos: RespuestaReemplazo, user=Depends(get_current_user)):
    """Desde el portal: el autor de la entrega o, en su lugar, un administrador (si el primer
    cubicador no está) acepta o rechaza el pedido. Queda en la auditoría."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
    return _responder(user.get("email", ""), _es_admin(user), datos)


class EliminarPlano(BaseModel):
    obra: str
    plano: str
    con_barras: bool = False


@router.post("/armascanner/planos-linea/eliminar")
def eliminar_plano_portal(datos: EliminarPlano, admin=Depends(require_admin_or_admin_calidad)):
    """Eliminar un plano de ArmaHub (administrador): su registro, su entrega y sus archivos en R2;
    con `con_barras`, también las barras que mandó a los despieces de la obra (las de sus códigos de
    carga). [Usuario 20-nov: limpiar el sistema para partir con obras de aSa]"""
    email = admin.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            x = _eliminar_plano(cur, email, datos.obra, datos.plano, datos.con_barras)
    _borrar(*x["claves"])  # recién confirmada la base
    audit(email, "armascanner_eliminar_plano",
          f"{datos.plano} (v{x['version']}" + (", con su entrega" if x["entrega"] else "")
          + (f", {x['barras']} barras" if x["barras"] else "") + ")", "proyecto", datos.obra)
    return {"ok": True, "barras_eliminadas": x["barras"]}


def _eliminar_plano(cur, email: str, obra: str, plano: str, con_barras: bool) -> dict:
    """Elimina el plano en la transacción de `cur` (no confirma ni toca R2): su fila, su entrega, sus
    pedidos de reemplazo que corren (quedan anulados) y, con `con_barras`, las barras que mandó a los
    despieces (las de sus códigos de carga; nunca lo ingresado a mano). Devuelve {version, entrega (si
    tenía), barras (borradas), claves (las keys de R2 que quedan sin uso)}: quien llama las borra de R2
    recién confirmada la base."""
    borradas = 0
    fila = _fila_base(cur, obra, plano, exclusiva=True)
    if not fila:
        raise HTTPException(status_code=404, detail="Ese plano no está en ArmaHub.")
    cur.execute("SELECT codigos FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (obra, plano))
    codigos = cur.fetchone()[0]
    codigos = [c for c in (codigos if isinstance(codigos, list) else []) if isinstance(c, str) and c.strip()]
    if con_barras and codigos:
        cur.execute("""DELETE FROM barras WHERE id_proyecto = %s AND plano_code = ANY(%s)
                        AND (origen IS NULL OR origen = 'csv')""", (obra, codigos))
        borradas = cur.rowcount
    cur.execute("""DELETE FROM planos_obra_entregas WHERE id_proyecto = %s AND plano = %s
                   RETURNING archivo, pdf""", (obra, plano))
    entregas = cur.fetchall()
    cur.execute("""UPDATE planos_obra_reemplazos SET estado = 'anulado', respondido_por = %s, respondido_el = NOW()
                    WHERE id_proyecto = %s AND plano = %s AND estado IN ('pendiente', 'aceptado')""",
                (email, obra, plano))
    cur.execute("DELETE FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (obra, plano))
    return {"version": fila["version"], "entrega": bool(entregas), "barras": borradas,
            "claves": [c for c in [fila["archivo"]] + [k for f in entregas for k in f] if c]}


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
    import secrets
    import time
    try:
        d = json.loads(datos or "{}")
    except ValueError:
        d = {}

    def txt(k, largo):
        return str(d.get(k) or "").strip()[:largo] or None

    tipo = "plano" if d.get("tipo") == "plano" else "reporte"
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            if tipo == "plano" and txt("plano", 300):
                cur.execute(f"""SELECT id FROM armascanner_reportes
                                 WHERE tipo = 'plano' AND estado = ANY(%s) AND plano = %s AND {OBRA_CASO} = %s
                                 ORDER BY id DESC LIMIT 1""",
                            (CASOS_ABIERTOS, txt("plano", 300), txt("obra_id", 80) or txt("obra", 300) or ""))
                ya = cur.fetchone()
                if ya:
                    return {"ok": True, "id": ya[0], "ya_estaba": True}
    contenido = await archivo.read()
    if len(contenido) > REPORTE_MAX:
        raise HTTPException(status_code=413, detail="El reporte pesa más de 25 MB.")
    from . import storage
    clave = f"armascanner/reportes/{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}.zip"
    try:
        storage.upload_file(clave, contenido, "application/zip")
    except Exception as e:
        _borrar(clave)
        raise HTTPException(status_code=502, detail=f"El reporte no se pudo guardar en ArmaHub ({str(e)[:80]}).")
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""INSERT INTO armascanner_reportes (email, equipo, version, obra, plano, comentario, archivo,
                                                                 tamano, tipo, obra_id, lector)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                            (user["email"], txt("equipo", 80), txt("version", 40), txt("obra", 300), txt("plano", 300),
                             txt("comentario", 2000), clave, len(contenido), tipo, txt("obra_id", 80), txt("lector", 1000)))
                rid = cur.fetchone()[0]
                admins = _admins(cur)
                quien = _nombres(cur, [user["email"]]).get(user["email"], user["email"])
    except Exception:
        _borrar(clave)  # la base no confirmó: el ZIP no queda suelto en R2
        raise
    audit(user["email"], "armascanner_reporte", f"#{rid} {tipo} {txt('plano', 80) or ''} {txt('comentario', 80) or ''}".strip(),
          "armascanner", str(rid))
    _avisar([a for a in admins if a != user["email"]],
            f"ArmaScanner · Desarrollo: {quien} envió " + (f"el plano {txt('plano', 80)} (no se lee)" if tipo == "plano"
                                                           else "un reporte") + ".", AVISO_DESARROLLO)
    return {"ok": True, "id": rid, "ya_estaba": False}


@router.get("/armascanner/desarrollo")
def desarrollo(admin=Depends(require_admin_or_admin_calidad)):
    """La pestaña Desarrollo (administrador, sólo lectura): un caso por plano que no se lee (los abiertos
    primero, el más nuevo arriba) con la oficina de cálculo de su obra y sus envíos, y las oficinas. El
    caso está abierto mientras tenga un envío abierto; si no, queda como quedó el último."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT r.id, r.tipo, r.estado, r.email, r.equipo, r.version, r.obra, r.obra_id, r.plano,
                                  r.comentario, r.lector, r.nota, r.version_resuelto, r.tamano, r.creado_el, p.calculista_id
                             FROM armascanner_reportes r LEFT JOIN proyectos p ON p.id_proyecto = r.obra_id
                            WHERE r.tipo = 'plano' ORDER BY r.id DESC LIMIT 500""")
            filas = cur.fetchall()
            nombres = _nombres(cur, [f[3] for f in filas])
            oficinas, calculistas = _oficinas(cur, filas)
    planos = {}
    for f in filas:  # el más nuevo primero
        planos.setdefault(_caso(f), []).append(f)
    casos = []
    for envios in planos.values():
        u = envios[0]
        estados = {e[2] for e in envios}
        estado = next((e for e in CASOS_ABIERTOS if e in estados), u[2])
        cierre = u if estado not in CASOS_ABIERTOS else None
        oficina = next((calculistas.get(e[15], "") for e in envios if e[15] is not None), "")
        casos.append({"id": u[0], "estado": estado, "obra": u[6] or "", "obra_id": u[7] or "", "plano": u[8] or "", "oficina": oficina,
                      "usuario": nombres.get(u[3], u[3] or ""), "version": u[5] or "", "el": _cuando(u[14]),
                      "comentario": u[9] or "", "lector": u[10] or "",
                      "nota": (cierre[11] or "") if cierre else "", "version_resuelto": (cierre[12] or "") if cierre else "",
                      "envios": [{"id": e[0], "estado": e[2], "usuario": nombres.get(e[3], e[3] or ""),
                                  "equipo": e[4] or "", "version": e[5] or "", "comentario": e[9] or "",
                                  "lector": e[10] or "", "nota": e[11] or "", "version_resuelto": e[12] or "",
                                  "el": _cuando(e[14])} for e in envios]})
    casos.sort(key=lambda c: (c["estado"] not in CASOS_ABIERTOS, -c["id"]))
    return {"casos": casos, "oficinas": oficinas,
            "otras": sorted(({"id": k, "nombre": v} for k, v in calculistas.items()
                             if k not in {o["id"] for o in oficinas}), key=lambda x: x["nombre"].lower())}


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
            filas = cur.fetchall()
    audit(email, "armascanner_desarrollo", f"#{rid} {datos.estado} ({len(filas)})" + (f" {version}" if version else ""),
          "armascanner", str(rid))
    autores = sorted({f[0] for f in filas if f[0] and f[0] != email})
    if cierra and autores:
        no_lee = any(f[1] == "plano" for f in filas)
        nota = next((f[2] for f in filas if f[2]), "")
        que = f"lo que reportaste del plano {plano}" if plano else "tu reporte"
        if datos.estado == "resuelto":
            _avisar(autores, (f"ArmaScanner ya lee el plano {plano}" if no_lee and plano else f"Se resolvió {que}")
                    + (f" desde la versión {version}" if version else "") + ": actualiza y vuelve a escanear.", AVISO_DESARROLLO)
        else:
            _avisar(autores, (f"El plano {plano} no se podrá leer con ArmaScanner" if no_lee and plano else f"Se cerró {que}")
                    + (f": {nota}" if nota else "."), AVISO_DESARROLLO)
    return {"ok": True}


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
    from . import storage
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
    sólo se muestra a quien la tiene, y al administrador). Hoy, en Chile."""
    cur.execute("""
        SELECT l.producto, l.activa, l.vence, COALESCE(u.activo, TRUE)
          FROM licencias l JOIN users u ON u.id = l.user_id
         WHERE u.email = %s
    """, (email,))
    hoy = hoy_chile()
    return [p for p, activa, vence, activo in cur.fetchall() if estado_licencia((activa, vence, activo), hoy)[0]]


def _es_admin(user) -> bool:
    return user.get("role") in ("admin", "admin_calidad")


def _con_licencia_o_admin(cur, user):
    if not _es_admin(user) and PRODUCTO not in licencias_vigentes(cur, user.get("email", "")):
        raise HTTPException(status_code=403, detail="Requiere licencia de ArmaScanner.")


# ── Mis obras: la obra se agrega aquí primero (cualquier cubicador, desde la lista de aSa) y recién ahí
# ArmaScanner la muestra; el administrador la limpia o la elimina, con aviso. [Usuario 23-nov: «en el
# menú mis obras debiéramos tener un botón de Agregar Obra, ahí buscar de las de aSa Studio»; «lo
# importante es que yo pueda eliminarlas y/o limpiarlas con algún warning»] ──
@router.get("/armascanner/obras-asa")
def obras_asa(user=Depends(get_current_user)):
    """«Agregar obra»: las obras COMO ESTÁN EN aSa (el espejo `asa_obras`, la misma lista que los
    selectores de obra del portal), para elegir con filtro de texto; `agregada` si ya está en
    ArmaScanner. [Usuario 19-nov: «hay que traer las obras de aSa, no las que creamos en la plataforma»]"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            cur.execute("""
                SELECT a.asa_job_id, a.nombre, a.cliente, a.estado,
                       EXISTS (SELECT 1 FROM armascanner_obras o JOIN proyectos p ON p.id_proyecto = o.id_proyecto
                                WHERE p.asa_job_id = a.asa_job_id OR p.id_proyecto = a.asa_job_id)
                  FROM asa_obras a
                 WHERE NOT a.excluida
                   AND a.asa_job_id !~ 'B$'                 -- el gemelo «- BARRAS» no es otra obra
                 ORDER BY (COALESCE(a.estado, '') = 'Open') DESC, a.ultima_actividad DESC NULLS LAST, a.nombre
            """)
            return {"obras": [{"asa": r[0], "nombre": r[1], "cliente": r[2] or "", "estado": r[3] or "",
                               "agregada": bool(r[4])} for r in cur.fetchall()]}


class AgregarObra(BaseModel):
    asa: str


@router.post("/armascanner/obras-linea/agregar")
def agregar_obra(datos: AgregarObra, user=Depends(get_current_user)):
    """La obra de aSa entra a ArmaHub (programacion.adoptar_obra, la única puerta) y a ArmaScanner."""
    from .programacion import adoptar_obra
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            obra = adoptar_obra(cur, datos.asa, email, en_cubicacion=True)
            nueva = _registrar_obra(cur, obra, email)
    if nueva:
        audit(email, "armascanner_agregar_obra", f"aSa {datos.asa}", "proyecto", obra)
    return {"ok": True, "id": obra, "ya_estaba": not nueva}


class QuitarObra(BaseModel):
    obra: str
    eliminar: bool = False


@router.post("/armascanner/obras-linea/quitar")
def quitar_obra(datos: QuitarObra, admin=Depends(require_admin_or_admin_calidad)):
    """Limpiar (administrador): se eliminan los planos de la obra en ArmaHub, con sus entregas, sus
    archivos y las barras que mandaron a los despieces (_eliminar_plano). Con `eliminar`, además la obra
    sale de Mis obras y de ArmaScanner. La obra sigue en ArmaHub para lo demás y en aSa no se toca.
    Todo o nada: una sola transacción en la base (la fila de la obra queda tomada: un «Terminar» que
    llega mientras tanto espera, _obra_vigente); los archivos de R2 se borran recién confirmada."""
    email = admin.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM armascanner_obras WHERE id_proyecto = %s FOR UPDATE", (datos.obra,))
            cur.execute("SELECT plano FROM planos_obra WHERE id_proyecto = %s ORDER BY plano", (datos.obra,))
            planos = [r[0] for r in cur.fetchall()]
            hechos = [_eliminar_plano(cur, email, datos.obra, p, True) for p in planos]
            if datos.eliminar:
                cur.execute("DELETE FROM armascanner_obras WHERE id_proyecto = %s", (datos.obra,))
    _borrar(*[c for x in hechos for c in x["claves"]])
    barras = sum(x["barras"] for x in hechos)
    audit(email, "armascanner_eliminar_obra" if datos.eliminar else "armascanner_limpiar_obra",
          f"{len(planos)} planos" + (f" ({', '.join(planos)[:500]})" if planos else "") + f", {barras} barras",
          "proyecto", datos.obra)
    return {"ok": True, "planos": len(planos), "barras_eliminadas": barras}


@router.get("/armascanner/obras-linea")
def obras_linea(user=Depends(get_current_user)):
    """Mis obras: las obras agregadas a ArmaScanner (un plano sólo sube a una de ellas: _obra_de; el
    trabajo es colaborativo: todos los usuarios con licencia ven todo [Usuario 20-nov]), con sus datos
    (cliente, constructora, código de aSa), cuántos planos tiene en cada etapa, lo que espera a alguien
    (reemplazos pedidos, barras con consulta, pedidos sin enviar), sus KPIs (kpis_de) y su tabla por piso
    (tabla_por_piso).
    Suman los planos con barras que no están reemplazados por otro; los m², sólo los de losa. La de
    actividad más reciente, primero. [Usuario 22-nov: «un listado de obras con datos mínimos y KPIs»]"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            cur.execute("""SELECT id_proyecto, plano, etapa, elemento, resumen, barras, aprobadas, kg, relacion,
                                  relacion_de, version, pedido_version, subido_el
                             FROM planos_obra WHERE id_proyecto IN (SELECT id_proyecto FROM armascanner_obras)""")
            filas = cur.fetchall()
            cur.execute("SELECT id_proyecto, agregada_el FROM armascanner_obras")
            agregadas = dict(cur.fetchall())
            ids = sorted(agregadas)
            info = {}
            if ids:
                cur.execute("""SELECT pr.id_proyecto, pr.nombre_proyecto, COALESCE(pr.asa_job_id, ''),
                                      COALESCE(ao.cliente, ''), COALESCE(co.nombre, '')
                                 FROM proyectos pr
                                 LEFT JOIN asa_obras ao ON ao.asa_job_id = pr.asa_job_id
                                 LEFT JOIN constructoras co ON co.id = pr.constructora_id
                                WHERE pr.id_proyecto = ANY(%s)""", (ids,))
                info = {f[0]: f[1:] for f in cur.fetchall()}
            entregas, pedidos = _entregas(cur), _reemplazos(cur)
            fuera = reemplazados([(f[0], f[1], f[8], f[9]) for f in filas])
            diam = _diam_faltante(cur, [(f[0], f[1]) for f in filas
                                        if f[2] != "cargado" and f[5] and "diam_prom" not in (f[4] or {})])
            por_piso = _por_piso_faltante(cur, [(f[0], f[1]) for f in filas if f[2] != "cargado" and f[5]
                                                and (f[0], f[1]) not in fuera and "por_piso" not in (f[4] or {})])
    obras = {}

    def de(obra):  # la obra en la lista; sin planos, su actividad es la fecha en que se agregó
        nombre, asa, cliente, constructora = info.get(obra) or (obra, "", "", "")
        return obras.setdefault(obra, {"id": obra, "nombre": nombre or obra, "asa": asa, "cliente": cliente,
                                       "constructora": constructora, "planos": 0, "terminados": 0, "cargados": 0,
                                       "en_trabajo": 0, "reemplazos": 0, "consultas": 0, "sin_enviar": 0,
                                       "_ultima": agregadas.get(obra), "_kpis": []})

    for obra in agregadas:
        de(obra)
    for (obra, plano, etapa, elemento, resumen, barras, aprobadas, kg, _rel, _de, version, pedido_version,
         subido_el) in filas:
        o = de(obra)
        o["planos"] += 1
        etapa = etapa or ""
        o["terminados" if etapa == "terminado" else "cargados" if etapa == "cargado" else "en_trabajo"] += 1
        e = entregas.get((obra, plano))
        o["reemplazos"] += sum(1 for r in pedidos.get((obra, plano), [])
                               if r["estado"] == "pendiente" and e and r["autor"] == e["autor"])
        if subido_el and (o["_ultima"] is None or subido_el > o["_ultima"]):
            o["_ultima"] = subido_el
        if etapa == "cargado" or (obra, plano) in fuera:
            continue
        r = resumen or {"barras": barras or 0, "aprobadas": aprobadas or 0, "kg": float(kg or 0)}
        o["consultas"] += int(r.get("consultas") or 0)
        o["sin_enviar"] += estado_pedido(version, pedido_version) != "enviado"
        o["_kpis"].append(plano_para_kpis(r, elemento, diam.get((obra, plano)), por_piso.get((obra, plano))))
    lista = sorted(obras.values(), key=lambda o: (o["_ultima"] is None, -(o["_ultima"].timestamp() if o["_ultima"]
                                                                         else 0), str(o["nombre"])))
    return {"admin": _es_admin(user),
            "obras": [dict({k: v for k, v in o.items() if not k.startswith("_")}, ultima=_cuando(o["_ultima"]),
                           kpis=kpis_de(o["_kpis"]), por_piso=tabla_por_piso(o["_kpis"])) for o in lista]}


# ── La sección aSa de la ventana de la obra: qué parte de cada plano está en aSa y con qué códigos ──
# En aSa la cubicación es un pedido con su código de control (CC: `control_code` del espejo
# `asa_pedidos`, refrescado cada día; integracion_asa.md). aSa no tiene sector, piso ni ciclo: el
# cubicador los escribe en la descripción del código («LCIELO P5 C1»). El plano llega a aSa así: su
# pedido (Enviar pedido) deja sus barras en los despieces de la obra con su sector, piso y ciclo; la
# exportación arma un Excel por sector + piso + ciclo (export.py), y ése se carga en aSa como un CC.
# El cruce, entonces, es por obra (su job de aSa) y por sector + piso + ciclo, leídos de la
# descripción con las reglas de la auditoría (auditorias._ubicacion_desde_nombre). Es por nombre: un
# código con otra descripción no se reconoce. El cruce exacto (la columna PLANO de la exportación queda
# en el ElementDesc de cada barra en aSa) pide consultar aSa barra a barra y no está en el espejo.
ESTADO_ANULADO = "Cancelled"  # (programacion.ESTADO_NUNCA) un código anulado en aSa no cuenta


def clave_ubicacion(sector, piso, ciclo) -> tuple:
    """(SECTOR, PISO, CICLO) como se comparan con lo leído de un código de aSa: «LCIELO», «P5», «C1».
    ArmaScanner anota el piso sólo con su número («5»). Función pura."""
    import re
    from .auditorias import _ubicacion_desde_nombre
    u = _ubicacion_desde_nombre(" ".join(str(x or "") for x in (sector, piso, ciclo)), None)
    p = str(piso or "").strip().upper()
    s = (u["sector"] or str(sector or "").strip().upper(),
         ("P" + p) if p.isdigit() else (u["piso"] or p), u["ciclo"] or str(ciclo or "").strip().upper())
    return tuple(re.sub(r"^([A-Z]+)0+(\d)", r"\1\2", x) for x in s)


def ubicacion_de_codigo(descr):
    """(SECTOR, PISO, CICLO) leídos de la descripción de un código de aSa, o None si falta alguno
    (no se adivina). Función pura."""
    import re
    from .auditorias import _ubicacion_desde_nombre
    u = _ubicacion_desde_nombre(descr, None)
    if not (u["sector"] and u["piso"] and u["ciclo"]):
        return None
    return tuple(re.sub(r"^([A-Z]+)0+(\d)", r"\1\2", u[k]) for k in ("sector", "piso", "ciclo"))


def cruce_asa(combos, codigos) -> dict:
    """Qué parte de un plano está en aSa. `combos`: [(sector, piso, ciclo, kg)] de las barras que el
    plano mandó a los despieces; `codigos`: [{cc, descr, kg, estado, fecha}] de la obra en aSa.
    → {kg, kg_en_asa, pct, codigos (los que calzan), faltan (lo que no tiene código: «LCIELO P5 C3»)}.
    Un código calza si su descripción dice el mismo sector, piso y ciclo. Función pura."""
    por = {}
    for c in codigos:
        k = ubicacion_de_codigo(c.get("descr"))
        if k:
            por.setdefault(k, []).append(c)
    kg = en = 0.0
    calzan, faltan = [], []
    for sector, piso, ciclo, k_kg in combos:
        k, k_kg = clave_ubicacion(sector, piso, ciclo), float(k_kg or 0)
        kg += k_kg
        if k in por:
            en += k_kg
            calzan += [c for c in por[k] if c not in calzan]
        elif " ".join(x for x in k if x) not in faltan:
            faltan.append(" ".join(x for x in k if x))
    return {"kg": round(kg, 1), "kg_en_asa": round(en, 1), "pct": round(100 * en / kg) if kg else None,
            "codigos": calzan, "faltan": faltan}


@router.get("/armascanner/obras-linea/asa")
def asa_de_obra(obra: str, user=Depends(get_current_user)):
    """La sección aSa de la ventana de la obra: los códigos de la obra en aSa y, por plano con pedido
    enviado, qué parte de sus kilos tiene código en aSa y cuáles son (cruce_asa). Un plano sin pedido
    no puede estar en aSa por esta vía: va con `pct` null."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            cur.execute("SELECT COALESCE(asa_job_id, '') FROM proyectos WHERE id_proyecto = %s", (obra,))
            f = cur.fetchone()
            job = f[0] if f else ""
            cur.execute("""SELECT plano, etapa, codigos, version, pedido_version
                             FROM planos_obra WHERE id_proyecto = %s""", (obra,))
            planos = cur.fetchall()
            de_codigo = {c: p[0] for p in planos for c in (p[2] if isinstance(p[2], list) else [])
                         if isinstance(c, str) and c.strip()}
            combos = {}
            if de_codigo:
                cur.execute("""SELECT plano_code, COALESCE(sector, ''), COALESCE(piso, ''), COALESCE(ciclo, ''),
                                      COALESCE(SUM(peso_total), 0)
                                 FROM barras WHERE id_proyecto = %s AND plano_code = ANY(%s)
                                GROUP BY plano_code, sector, piso, ciclo""", (obra, sorted(de_codigo)))
                for code, s, p, c, kg in cur.fetchall():
                    combos.setdefault(de_codigo[code], []).append((s, p, c, float(kg or 0)))
            codigos, al = [], None
            if job:
                cur.execute("""SELECT control_code, COALESCE(descr, ''), COALESCE(kg, 0), COALESCE(estado, ''), order_date
                                 FROM asa_pedidos WHERE asa_job_id = %s AND (estado IS NULL OR estado <> %s)
                                ORDER BY order_date, control_code""", (job, ESTADO_ANULADO))
                codigos = [{"cc": r[0], "descr": r[1], "kg": round(float(r[2]), 1), "estado": r[3],
                            "fecha": r[4].isoformat() if hasattr(r[4], "isoformat") else (r[4] or "")}
                           for r in cur.fetchall()]
                cur.execute("SELECT MAX(fin) FROM asa_sync WHERE ok")
                al = cur.fetchone()[0]
    out = []
    for plano, etapa, _c, version, pedido_version in planos:
        if etapa == "cargado":
            continue
        pedido = estado_pedido(version, pedido_version)
        x = cruce_asa(combos.get(plano, []), codigos) if pedido != "sin_enviar" \
            else {"kg": None, "kg_en_asa": None, "pct": None, "codigos": [], "faltan": []}
        out.append(dict(x, plano=plano, pedido=pedido))
    return {"asa": job, "al": _cuando(al) if hasattr(al, "astimezone") else "", "codigos": len(codigos),
            "kg": round(sum(c["kg"] for c in codigos), 1), "planos": out}


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


# Hasta la 2026-11-20.10 (empaquetada con Nuitka), «Actualizar» abre la versión nueva como «ArmaScanner.exe
# --instalar --esperar <pid>». Desde la .11, ArmaScanner.exe es el Python oficial (firmado), que rechaza esas
# opciones: la nueva no arranca, la vieja se cierra y, al abrirla, vuelve a pedir la misma actualización. Ese
# código está en el equipo del cubicador y no se puede cambiar desde aquí: a esas versiones se les dice, en
# las notas que su ventana de actualización muestra, cómo instalarla a mano (una sola vez; desde ahí se
# actualiza sola). [Usuario 23-nov: «siempre le pide actualizar la misma versión, es un bug»]
SIN_PUENTE = "2026-11-20.11"
INSTALAR_A_MANO = ("Tu versión no puede instalar ésta sola. Una sola vez: cierra ArmaScanner, entra a ArmaHub › "
                   "ArmaScanner › Instalar › «Descargar», extrae el ZIP y abre ArmaScanner.exe › «Instalar». "
                   "Desde ahí se actualiza solo.")


def notas_para(version: str, notas: str) -> str:
    """Las notas de la actualización que ve quien tiene `version`. Función pura."""
    return INSTALAR_A_MANO if clave_version(version) < clave_version(SIN_PUENTE) else notas


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
    v = _version_dict(fila, con_enlace=True)
    return dict(v, hay=True, notas=notas_para(version, v["notas"]))


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
    # una key por subida (como clave_paquete): si la base no confirma, se borra sólo lo subido aquí, nunca
    # el archivo de otra publicación de la misma versión que se haya cruzado
    import uuid
    clave = f"armascanner/versiones/{version}/{uuid.uuid4().hex[:12]}/{_nombre_instalador(version)}"
    archivo.file.seek(0, 2)
    tamano = archivo.file.tell()
    archivo.file.seek(0)
    try:
        storage.upload_fileobj(clave, archivo.file, "application/zip")
    except Exception as e:
        _borrar(clave)
        raise HTTPException(status_code=502, detail=f"La versión no se pudo guardar en ArmaHub ({str(e)[:80]}).")
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""INSERT INTO armascanner_versiones (version, archivo, tamano, notas, obligatoria, publicada_por)
                               VALUES (%s, %s, %s, %s, %s, %s)""",
                            (version, clave, tamano, (notas or "").strip()[:2000] or None, obligatoria, email))
    except Exception:
        _borrar(clave)  # la base no confirmó (otra publicación de la misma versión ganó): lo subido no queda suelto
        raise
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
