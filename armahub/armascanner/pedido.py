"""
«Enviar pedido», desde ArmaScanner o desde el portal: las barras de la entrega del plano pasan a los
despieces de la obra con la importación de A Detailer de siempre (ver las reglas en __init__.py). Desde la
mig 183 (25-nov) también por grupo (el ciclo en losas): sólo las barras de un ciclo completo, que reemplazan
las de ese ciclo del plano; lo enviado de cada grupo queda anotado (versión, huella, barras) para saber si
cambió después.
"""

import json
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials

from ..auth import get_current_user
from ..db import audit, get_conn
from ..licencias import _bearer
from .acceso import _con_licencia_o_admin, _es_admin, _usuario
from .comun import PlanoEnLinea, _cuando, _nombres
from .datos import NO_ESTA, _anotar_grupo, _entrega, _ultimo_envio
from .reglas import (REVISIONES, csv_del_grupo, diferencias, estado_grupo, filas_para_traza, pendientes_por_combinacion,
                     puede_enviar)

router = APIRouter()


async def _cargar_barras(user, obra, plano_code, reemplaza, revision, sin_subir, contenido: bytes, nombre,
                         version, equipo, grupo=None):
    """Las barras de un plano de ArmaScanner (el CSV de A Detailer) entran a los despieces de la
    obra como la carga de ese plano, con su estado de revisión. Con `grupo` (el pedido de un ciclo) no se
    reemplaza el plano entero: quien llama quita después lo de ese ciclo que no vino
    (_quitar_las_que_salieron). Devuelve (respuesta de la importación, barras sin aprobar)."""
    from ..importer import import_armadetailer
    reemplazar = None if grupo else ";".join(dict.fromkeys([plano_code] + _codigos_de_armascanner(obra, reemplaza)))
    res = await import_armadetailer(
        file=UploadFile(BytesIO(contenido), filename=nombre or f"{plano_code}.csv"),
        user=user, obra_destino=obra, reasignar_a=None, forzar=True, calculista=None,
        confirmar_nuevo=False, constructora_id=None, asignar_a=None, owner_id=None,
        proyecto_nombre_manual=None, proyecto_nombre_override=None,
        replace_keys=None, replace_full_planos=reemplazar,
    )
    if not res.get("ok"):
        raise HTTPException(status_code=422, detail=res.get("error") or res.get("mensaje") or "La carga no entró.")
    pend = _marcar_revision(res["import_id"], revision, sin_subir, version, equipo)
    return res, sum(pend.values())


def _codigos_de_armascanner(obra: str, reemplaza) -> list:
    """Los códigos anteriores del mismo plano (se limpió y se escaneó de nuevo), cuyas barras se reemplazan
    también: sólo los de cargas de ArmaScanner de esta obra (por aquí no se pueden borrar barras de A
    Detailer ni de otra obra)."""
    anteriores = [c.strip() for c in (reemplaza or []) if isinstance(c, str) and c.strip() and ";" not in c]
    if anteriores:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT DISTINCT plano_code FROM imports
                     WHERE id_proyecto = %s AND herramienta = 'ArmaScanner' AND plano_code = ANY(%s)
                """, (obra, anteriores))
                anteriores = [r[0] for r in cur.fetchall()]
    return anteriores


def _marcar_revision(import_id, revision: dict, sin_subir, version, equipo) -> dict:
    """Cada barra de la carga queda con su estado de revisión, y la carga, con su herramienta y lo que quedó
    sin aprobar por SECTOR|PISO|CICLO (pendientes_por_combinacion; las que no subieron cuentan como duda).
    Devuelve esos pendientes."""
    with get_conn() as conn:
        with conn.cursor() as cur:
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
    return pend


async def _enviar_pedido(user: dict, obra: str, plano: str, grupo=None) -> dict:
    """Las barras de la entrega del plano pasan a los despieces de la obra (reemplazan las de ese
    plano, también las de sus códigos anteriores). Si se aceptó reemplazar la entrega, no se envía:
    el plano está por cambiar. Sin entrega no hay barras que enviar. El pedido queda anotado sólo si
    el plano sigue en la versión revisada y sin reemplazo aceptado (si cambió mientras se importaba,
    409: las barras de la versión revisada ya entraron y el pedido queda por reenviar)."""
    if grupo:
        return await _enviar_grupo(user, obra, plano, grupo)
    fila, entrega, aceptado = _estado_del_plano(obra, plano)
    _se_puede_enviar(fila, entrega, aceptado, user)
    if entrega["etapa"] == "en_revision":
        raise HTTPException(status_code=409, detail="El plano está en revisión: envía el pedido de cada ciclo completo.")
    version, codigos = fila
    autor = entrega["autor"]
    s, contenido, registro = _leer_paquete(entrega["archivo"])
    plano_code, revision, version_app = _lo_que_se_importa(s, registro, entrega["resumen"])
    anteriores = _codigos_anteriores(codigos, registro)
    res, n_pend = await _cargar_barras(user, obra, plano_code, anteriores, revision, s.get("sin_subir"), contenido,
                                       f"{_nombre_csv(plano)}_armascanner.csv", version_app, None)
    todos = list(dict.fromkeys([c for c in anteriores if isinstance(c, str)] + [plano_code]))
    anotado = _anotar_pedido(obra, plano, version, user.get("email"), todos, autor)
    if anotado:  # cada ciclo que trae la entrega queda enviado con ella
        _anotar_grupos_del_plano(obra, plano, entrega, contenido, res.get("import_id"), user.get("email"))
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


async def _enviar_grupo(user: dict, obra: str, plano: str, grupo: str) -> dict:
    """El pedido de un grupo (el ciclo en losas): sólo sus barras pasan a los despieces y reemplazan las de ese
    grupo del plano (también las de sus códigos anteriores). Se puede si en la última versión del plano el grupo
    viene completo. Lo enviado (versión, huella y barras) queda anotado sólo si el plano sigue en esa versión; si
    cambió mientras se importaba, 409 y hay que reenviarlo. [Usuario 25-nov: «podemos permitir subir barras
    validadas siempre y cuando todas las asignadas a ese ciclo estén ok»]"""
    fila, entrega, aceptado = _estado_del_plano(obra, plano)
    _se_puede_enviar(fila, entrega, aceptado, user)
    g = (entrega["grupos"] or {}).get(grupo)
    if not g or not g.get("completo"):
        raise HTTPException(status_code=409, detail=f"{grupo} no está completo en la última versión del plano: "
                                                    "súbelo completo desde ArmaScanner.")
    s, contenido, registro = _leer_paquete(entrega["archivo"])
    plano_code, revision, version_app = _lo_que_se_importa(s, registro, entrega["resumen"])
    csv_g, filas = csv_del_grupo(contenido, grupo)
    if not filas:
        raise HTTPException(status_code=422, detail=f"{grupo} no tiene barras para enviar.")
    codigos = list(dict.fromkeys(_codigos_anteriores(fila[1], registro) + [plano_code]))
    sin = [b for b in s.get("sin_subir") or [] if str(b.get("ciclo") or "").upper() == grupo.upper()]
    res, n_pend = await _cargar_barras(user, obra, plano_code, codigos, revision, sin, csv_g,
                                       f"{_nombre_csv(plano)}_{grupo}_armascanner.csv", version_app, None, grupo)
    salieron = _quitar_las_que_salieron(obra, list(dict.fromkeys([plano_code] + _codigos_de_armascanner(obra, codigos))),
                                        grupo, res["import_id"])
    envio = {"grupo": grupo, "version": entrega["version"], "huella": g.get("huella"), "barras": len(filas),
             "kg": g.get("kg"), "filas": filas_para_traza(filas), "import_id": res["import_id"],
             "enviado_por": user.get("email")}
    anotado = _anotar_envio(obra, plano, envio, codigos)
    audit(user.get("email", "?"), "armascanner_enviar_pedido_grupo",
          f"{plano} {grupo} v{entrega['version']} → {res.get('proyecto')}: {res.get('barras')} barras, "
          f"{res.get('kilos')} kg, {salieron} salieron, {n_pend} sin aprobar"
          + ("" if anotado else "; el plano cambió mientras se enviaba: queda por reenviar"), "proyecto", obra)
    if not anotado:
        raise HTTPException(status_code=409, detail="El plano cambió en ArmaHub mientras se enviaba el pedido: "
                                                    "revísalo y vuelve a enviarlo.")
    return {"ok": True, "grupo": grupo, "version": entrega["version"], "import_id": res["import_id"],
            "obra": res.get("proyecto"), "barras": res.get("barras"), "kilos": res.get("kilos"),
            "reemplazadas": salieron, "pendientes": n_pend, "plano_code": plano_code}


def _quitar_las_que_salieron(obra: str, codigos: list, grupo: str, import_id) -> int:
    """Después de importar un grupo: las barras de ese grupo del plano (sus códigos) que la importación no trajo
    salieron del ciclo (se borraron o cambiaron de ciclo en ArmaScanner) y se borran, sólo las de la carga CSV
    (nunca lo ingresado a mano). Así se reemplaza el grupo sin borrar nada antes de que lo nuevo esté adentro.
    La carga queda con su alcance. Devuelve cuántas salieron."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""DELETE FROM barras WHERE id_proyecto = %s AND plano_code = ANY(%s) AND COALESCE(ciclo, '') = %s
                              AND (import_id IS NULL OR import_id <> %s) AND (origen IS NULL OR origen = 'csv')""",
                        (obra, list(codigos), grupo, import_id))
            n = max(cur.rowcount, 0)
            cur.execute("""UPDATE imports SET modo_reemplazo = 'por_plano_ciclo', scope_reemplazo = %s,
                                              barras_eliminadas_previo = %s WHERE id = %s""",
                        (";".join(f"{c}|{grupo}" for c in codigos)[:500], n, import_id))
    return n


def _anotar_envio(obra: str, plano: str, envio: dict, codigos: list) -> bool:
    """Anota lo enviado de un grupo (si el plano sigue en esa versión) y los códigos de carga del plano, para que
    el próximo pedido reemplace también lo de los anteriores. True si quedó anotado."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not _anotar_grupo(cur, obra, plano, envio):
                return False
            cur.execute("SELECT codigos FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (obra, plano))
            f = cur.fetchone()
            antes = [c for c in ((f and f[0]) or []) if isinstance(c, str)]
            cur.execute("UPDATE planos_obra SET codigos = %s::jsonb WHERE id_proyecto = %s AND plano = %s",
                        (json.dumps(list(dict.fromkeys(antes + list(codigos)))), obra, plano))
    return True


def _anotar_grupos_del_plano(obra: str, plano: str, entrega: dict, contenido: bytes, import_id, email):
    """El pedido del plano entero deja enviado cada grupo que trae su entrega (con su huella y sus barras)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            for g, x in (entrega.get("grupos") or {}).items():
                filas = csv_del_grupo(contenido, g)[1]
                _anotar_grupo(cur, obra, plano, {"grupo": g, "version": entrega["version"], "huella": x.get("huella"),
                                                 "barras": len(filas), "kg": x.get("kg"),
                                                 "filas": filas_para_traza(filas), "import_id": import_id,
                                                 "enviado_por": email})


def _estado_del_plano(obra: str, plano: str) -> tuple:
    """((versión, códigos) de la fila del plano o None, su entrega o None, si hay un reemplazo aceptado)."""
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
    return fila, entrega, aceptado


def _se_puede_enviar(fila, entrega, aceptado, user: dict):
    """404 sin el plano, 422 sin entrega, 409 con un reemplazo aceptado (el plano está por cambiar), 403 si no
    lo envía quien lo terminó o un administrador."""
    if not fila:
        raise HTTPException(status_code=404, detail="Ese plano no está en ArmaHub.")
    if not entrega:
        raise HTTPException(status_code=422, detail="El plano no tiene barras para enviar.")
    if aceptado:
        raise HTTPException(status_code=409, detail="Se aceptó reemplazar este plano: envía el pedido cuando se "
                                                    "suba la nueva versión.")
    if not puede_enviar(entrega["autor"], user.get("email", ""), _es_admin(user)):
        raise HTTPException(status_code=403, detail="Envía el pedido quien terminó el plano o un administrador.")


def _leer_paquete(archivo: str) -> tuple:
    """(lo que ArmaScanner dejó de la subida: trabajo/*_subida.json, el CSV de las barras: trabajo/*_subida.csv,
    el registro de paquete.json) del paquete de la entrega en R2. 422 si no trae barras, 502 si no se lee."""
    import zipfile
    from .. import storage
    try:
        z = zipfile.ZipFile(BytesIO(storage.download_file(archivo)))
        csv_, js = _miembros_de_la_subida(z.namelist())
        if not csv_ or not js:
            raise HTTPException(status_code=422, detail="El plano no tiene barras para enviar.")
        s = json.loads(z.read(js).decode("utf-8"))
        contenido = z.read(csv_)
        registro = json.loads(z.read("paquete.json").decode("utf-8")).get("registro") or {}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"No se pudo leer el plano guardado ({str(e)[:80]}).")
    return s, contenido, registro


def _miembros_de_la_subida(nombres) -> tuple:
    """(el CSV, el JSON) de la subida en el paquete, o None el que no esté."""
    csv_ = next((n for n in nombres if n.startswith("trabajo/") and n.endswith("_subida.csv")), None)
    js = next((n for n in nombres if n.startswith("trabajo/") and n.endswith("_subida.json")), None)
    return csv_, js


def _lo_que_se_importa(s: dict, registro: dict, resumen) -> tuple:
    """(el código del plano, {id: revisión válida}, la versión de ArmaScanner) para la importación. La versión
    viaja en `datos.version_app` al terminar (queda en el resumen de la entrega). 422 sin el código."""
    plano_code = (s.get("plano_code") or "").strip()
    if not plano_code:
        raise HTTPException(status_code=422, detail="El plano guardado no trae su código.")
    revision = {k: v for k, v in (s.get("revision") or {}).items() if v in REVISIONES}
    return plano_code, revision, (resumen or {}).get("version_app") or registro.get("version_app")


def _codigos_anteriores(codigos, registro: dict) -> list:
    """Los códigos de carga anteriores del plano: los de su último pedido y los que trae la subida."""
    return list(codigos or []) + list((registro.get("subida") or {}).get("codigos") or [])


def _nombre_csv(plano: str) -> str:
    """El nombre del plano en letras simples, para el nombre del CSV que se importa."""
    return "".join(c for c in plano if c.isascii() and (c.isalnum() or c in "._- ")).strip() or "plano"


def _anotar_pedido(obra: str, plano: str, version, email, todos: list, autor: str) -> bool:
    """Anota el pedido, sólo si el plano sigue como se revisó: la misma versión (la misma entrega) y sin
    reemplazo aceptado. True si quedó anotado."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""UPDATE planos_obra SET pedido_version = %s, pedido_el = NOW(), pedido_por = %s,
                                                  codigos = %s::jsonb
                            WHERE id_proyecto = %s AND plano = %s AND version = %s
                              AND NOT EXISTS (SELECT 1 FROM planos_obra_reemplazos r
                                               WHERE r.id_proyecto = planos_obra.id_proyecto AND r.plano = planos_obra.plano
                                                 AND r.autor = %s AND r.estado = 'aceptado')""",
                        (version, email, json.dumps(todos), obra, plano, version, autor))
            return cur.rowcount == 1


@router.post("/armascanner/planos/pedido")
async def enviar_pedido(datos: PlanoEnLinea, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """«Enviar pedido» desde ArmaScanner (ficha de licencia)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
    return await _enviar_pedido(user, datos.obra, datos.plano, datos.grupo)


@router.post("/armascanner/planos-linea/pedido")
async def enviar_pedido_portal(datos: PlanoEnLinea, user=Depends(get_current_user)):
    """«Enviar pedido» desde el portal."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
    return await _enviar_pedido({"email": user.get("email", ""), "role": user.get("role")}, datos.obra, datos.plano,
                                datos.grupo)


@router.get("/armascanner/planos-linea/grupo")
def grupo_del_plano(obra: str, plano: str, grupo: str, user=Depends(get_current_user)):
    """Un grupo del plano (el ciclo en losas) antes de enviarlo o reenviarlo: su estado, lo enviado (versión,
    quién y cuándo) y qué cambió desde entonces en la última versión, barra por barra (nuevas, corregidas con
    su campo, eliminadas). Lee el paquete de la última versión del plano."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            e = _entrega(cur, obra, plano)
            envio = _ultimo_envio(cur, obra, plano, grupo)
            nombres = _nombres(cur, [envio["enviado_por"]] if envio else [])
    if not e:
        raise HTTPException(status_code=404, detail=NO_ESTA)
    _filas_csv = csv_del_grupo(_leer_paquete(e["archivo"])[1], grupo)[1]
    return {"grupo": grupo, "estado": estado_grupo((e["grupos"] or {}).get(grupo), envio), "version": e["version"],
            "enviado": envio and {"version": envio["version"], "enviado_el": _cuando(envio["enviado_el"]),
                                  "enviado_por": nombres.get(envio["enviado_por"], envio["enviado_por"])},
            "diferencias": diferencias(envio["filas"] if envio else [], _filas_csv)}
