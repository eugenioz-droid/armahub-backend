"""
Los planos: lo que ArmaScanner carga, termina y descarga con su ficha, y los planos de una obra en el
portal (avance, barras, PDF, DWG, eliminar).

Cargar, terminar y el pedido aparte (mig 171 y 174; SPECS §5.4)
Cargar deja el plano del calculista como antecedente. Terminar sube el plano con todas sus barras
revisadas: es la entrega del plano, con sus barras a la vista y su PDF. Ninguno de los dos carga
barras en los despieces: eso es «Enviar pedido», que pasa las barras de la entrega a la obra, con su
procedencia (ArmaScanner). Lo envía quien terminó el plano o un administrador.
[Usuario 20-nov: «al enviar el pedido lo estamos pasando a los despieces asociados a la obra»]
"""

import json
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from ..auth import get_current_user, require_admin_or_admin_calidad
from ..db import audit, get_conn
from ..licencias import _bearer
from .acceso import _con_licencia_o_admin, _es_admin, _usuario
from .comun import DESCARGA_SEGUNDOS, _avisar, _borrar, _cuando, _nombres
from .datos import (NO_ESTA, _eliminar_plano, _entrega, _entrega_dict, _entregas, _fila_base, _recalcular,
                    _reemplazos, _reemplazos_dict, _rotulo)
from .kpis import kpis_de, plano_para_kpis, resumen_de
from .reglas import (accion_al_cargar, accion_al_terminar, barras_a_la_vista, clave_paquete, dwg_del_paquete,
                     estado_pedido, puede_enviar, relacion_enviada)

router = APIRouter()


@router.get("/armascanner/planos")
def planos_en_linea(obra: str = "", credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Los planos de todas las obras; con `obra` (id de ArmaHub o código de aSa), los de esa obra.
    Cada uno con su etapa (cargado · terminado · en_trabajo), el resumen de su entrega, la entrega
    (de quién es) y los pedidos de reemplazo que corren sobre ella. `tomado_*` va vacío y NO se quita:
    las versiones publicadas hasta la 2026-11-22 lo leen como x["tomado_por"] y, sin la clave, se caen."""
    buscada = obra.strip()
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            filas = _leer_planos(cur, buscada)
            obras = sorted({f[0] for f in filas}) if buscada else None
            entregas, pedidos = _entregas(cur, obras), _reemplazos(cur, obras)
            nombres = _nombres(cur, [f[13] for f in filas] + [e["autor"] for e in entregas.values()]
                               + [r["solicitante"] for lista in pedidos.values() for r in lista])
            # la obra pedida existe: un plano que ArmaScanner tenía en línea y ya no está en la lista
            # fue eliminado en ArmaHub (sin obra confirmada, ArmaScanner no saca conclusiones)
            obra_id = _obra_confirmada(cur, buscada) if buscada else None
    yo = user["email"]
    planos = [_plano_en_linea(f, entregas.get((f[0], f[3])), pedidos.get((f[0], f[3]), []), nombres, yo) for f in filas]
    return {"yo": yo, "admin": _es_admin(user), "obra_id": obra_id, "planos": planos}


def _leer_planos(cur, buscada: str) -> list:
    """Los planos de todas las obras, o los de la obra `buscada` (id de ArmaHub o código de aSa). Los
    textos que faltan vienen vacíos."""
    filtro, params = "", []
    if buscada:
        filtro, params = "WHERE p.id_proyecto = %s OR pr.asa_job_id = %s", [buscada, buscada]
    cur.execute(f"""
        SELECT p.id_proyecto, COALESCE(pr.nombre_proyecto, p.id_proyecto), COALESCE(pr.asa_job_id, ''),
               p.plano, COALESCE(p.numero, ''), COALESCE(p.titulo, ''), COALESCE(p.revision, ''),
               COALESCE(p.elemento, ''), p.version, p.barras, p.aprobadas, p.kg, p.tamano, COALESCE(p.subido_por, ''),
               p.subido_el, p.pedido_version, COALESCE(p.etapa, ''), COALESCE(p.relacion, ''),
               COALESCE(p.relacion_de, ''), p.pdf
          FROM planos_obra p
          LEFT JOIN proyectos pr ON pr.id_proyecto = p.id_proyecto
          {filtro}
         ORDER BY 2, p.numero, p.plano
    """, params)
    return cur.fetchall()


def _obra_confirmada(cur, buscada: str):
    """El id de la obra `buscada` (id de ArmaHub o código de aSa) si existe; si no, None."""
    cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s OR asa_job_id = %s LIMIT 1", (buscada, buscada))
    fila = cur.fetchone()
    return fila[0] if fila else None


def _plano_en_linea(f, e, pedidos, nombres, yo: str) -> dict:
    """Un plano como lo lee ArmaScanner (fila de _leer_planos, su entrega `e` y sus pedidos de reemplazo)."""
    return {
        "obra": f[0], "obra_nombre": f[1], "asa": f[2], "plano": f[3], "numero": f[4], "titulo": f[5],
        "etapa": f[16], "revision": f[6], "elemento": f[7], "version": f[8], "barras": f[9],
        "aprobadas": f[10], "kg": round(float(f[11]), 1) if f[11] is not None else None,
        "tamano": e["tamano"] if e else f[12],
        "subido_por": nombres.get(f[13], f[13]), "subido_el": _cuando(f[14]),
        "tomado_por": "", "tomado_el": "", "tomado_por_mi": False, "pedido": estado_pedido(f[8], f[15]),
        "relacion": f[17], "relacion_de": f[18], "pdf": bool(f[19]),
        "entrega": _entrega_dict(e, nombres, yo),
        "reemplazos": _reemplazos_dict(e, pedidos, nombres, yo)}


@router.post("/armascanner/planos/tomar")
def tomar_plano(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Ya no se toma un plano. Un ArmaScanner anterior al cambio, con este 404, lo abre en local."""
    raise HTTPException(status_code=404, detail="Actualiza ArmaScanner.")


@router.post("/armascanner/planos/soltar")
def soltar_plano(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Ya no hay nada que soltar: responde bien para que un ArmaScanner anterior al cambio siga."""
    return {"ok": True}


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
    from .. import storage
    if not CARGA_ANTECEDENTES:
        raise HTTPException(status_code=410, detail="Actualiza ArmaScanner: ArmaHub recibe el plano recién al «Terminar».")
    with get_conn() as conn:
        with conn.cursor() as cur:
            d, obra, email, fila, hay_entrega = _para_cargar(cur, credentials.credentials, datos)
    plano = d["plano"]
    contenido = await paquete.read()
    accion = accion_al_cargar(fila, hay_entrega, len(contenido))
    if accion == "ya_estaba":
        return {"ok": True, "version": fila["version"], "id_proyecto": obra, "ya_estaba": True}
    clave = clave_paquete(obra, plano)
    try:
        storage.upload_file(clave, contenido, "application/zip")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"El plano no se pudo guardar en ArmaHub ({str(e)[:80]}).")
    resumen = resumen_de([], d)
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                entro = _escribir_antecedente(cur, accion, d, obra, (clave, len(contenido), email), resumen, fila)
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


def _para_cargar(cur, ficha: str, datos: str) -> tuple:
    """(datos, obra, correo, fila del plano, si tiene entrega) para cargar el antecedente; 409 si ArmaScanner
    manda otra etapa (un ArmaScanner anterior al cambio, que guardaba el trabajo intermedio)."""
    user = _usuario(cur, ficha)
    d = _datos_plano(datos)
    if (d.get("etapa") or "") != "cargado":
        raise HTTPException(status_code=409, detail="Actualiza ArmaScanner: esta versión ya no guarda el "
                                                    "trabajo intermedio en ArmaHub.")
    obra = _obra_de(cur, d)
    return d, obra, user["email"], _fila_base(cur, obra, d["plano"]), _entrega(cur, obra, d["plano"]) is not None


def _escribir_antecedente(cur, accion: str, d: dict, obra: str, subida: tuple, resumen: dict, fila):
    """Crea el plano como antecedente o lo pasa a la versión siguiente (`accion`: accion_al_cargar). `subida`:
    (key en R2, tamaño, correo). Devuelve (versión,) o None si no entró: otro lo creó, lo cargó o lo terminó
    mientras tanto (el UPDATE sólo vale si el plano sigue cargado, en esa versión y sin entrega)."""
    relacion = relacion_enviada(d)
    comunes = (_texto(d, "numero", 40), _texto(d, "titulo", 300), _texto(d, "rev", 20), _texto(d, "elemento", 20)) + subida
    if accion == "crear":
        cur.execute("""
            INSERT INTO planos_obra (id_proyecto, plano, numero, titulo, revision, elemento, archivo, tamano,
                                     subido_por, subido_el, version, barras, aprobadas, kg, resumen,
                                     barras_json, etapa, relacion, relacion_de)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), 1, 0, 0, 0, %s::jsonb, '[]'::jsonb, 'cargado',
                    %s, %s)
            ON CONFLICT (id_proyecto, plano) DO NOTHING
            RETURNING version
        """, (obra, d["plano"]) + comunes + (json.dumps(resumen),) + (relacion or (None, None)))
    else:
        cur.execute("""
            UPDATE planos_obra
               SET numero = %s, titulo = %s, revision = %s, elemento = %s, archivo = %s, tamano = %s,
                   subido_por = %s, subido_el = NOW(), version = version + 1"""
                    + (", relacion = %s, relacion_de = %s" if relacion else "") + """
             WHERE id_proyecto = %s AND plano = %s AND version = %s AND etapa = 'cargado'
               AND NOT EXISTS (SELECT 1 FROM planos_obra_entregas e
                                WHERE e.id_proyecto = planos_obra.id_proyecto AND e.plano = planos_obra.plano)
            RETURNING version
        """, comunes + (relacion or ()) + (obra, d["plano"], fila["version"]))
    return cur.fetchone()


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
    clave = clave_paquete(obra, plano)
    clave_pdf = clave[:-len("zip")] + "pdf" if hoja else None  # junto al paquete
    _subir_entrega(clave, contenido, clave_pdf, hoja)
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                antes, accion, version = _guardar_entrega(cur, d, obra, email, (clave, len(contenido), clave_pdf),
                                                          resumen, barras)
                aviso = _aviso_de_reemplazo(cur, accion, email, obra, plano)
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


def _subir_entrega(clave: str, contenido: bytes, clave_pdf, hoja: bytes):
    """Sube a R2 el paquete y, si viene, el PDF. Si R2 falla, borra lo subido y responde 502."""
    from .. import storage
    try:
        storage.upload_file(clave, contenido, "application/zip")
        if hoja:
            storage.upload_file(clave_pdf, hoja, "application/pdf")
    except Exception as e:
        _borrar(clave, clave_pdf)
        raise HTTPException(status_code=502, detail=f"El plano no se pudo guardar en ArmaHub ({str(e)[:80]}).")


def _guardar_entrega(cur, d: dict, obra: str, email: str, archivos: tuple, resumen: dict, barras: list) -> tuple:
    """La entrega del plano en la base, en la transacción de `cur` (`archivos`: key del paquete, su tamaño, key
    del PDF). Devuelve (la entrega anterior o None, accion_al_terminar, la versión de la entrega)."""
    plano = d["plano"]
    clave, tamano, clave_pdf = archivos
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
    """, (obra, plano, email, clave, tamano, _texto(d, "numero", 40), _texto(d, "titulo", 300),
          _texto(d, "rev", 20), _texto(d, "elemento", 20), json.dumps(resumen), json.dumps(barras), clave_pdf))
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
    relacion = relacion_enviada(d)
    if relacion is not None:
        cur.execute("UPDATE planos_obra SET relacion = %s, relacion_de = %s WHERE id_proyecto = %s AND plano = %s",
                    relacion + (obra, plano))
    return antes, accion, version


def _aviso_de_reemplazo(cur, accion: str, email: str, obra: str, plano: str):
    """El aviso para el autor de la entrega reemplazada (o None si no se reemplazó la de otro)."""
    if accion != "reemplaza":
        return None
    nombre = _nombres(cur, [email]).get(email, email)
    return f"{nombre} reemplazó tu versión de {_rotulo(cur, obra, plano)}."


class DescargaPlano(BaseModel):
    obra: str
    plano: str
    autor: str = ""


@router.post("/armascanner/planos/descargar")
def descargar_plano(datos: DescargaPlano, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """El enlace para bajar el paquete de un plano (dura minutos). No reserva nada. `autor`: "mia" =
    la entrega, sólo si es mía; vacío = la entrega o, si el plano no tiene, el paquete de
    `planos_obra` (el antecedente, o el trabajo anterior al cambio)."""
    from .. import storage
    quien = datos.autor.strip()
    with get_conn() as conn:
        with conn.cursor() as cur:
            user = _usuario(cur, credentials.credentials)
            entrega = _entrega(cur, datos.obra, datos.plano)
            fila = _fila_base(cur, datos.obra, datos.plano)
            nombres = _nombres(cur, [entrega and entrega["autor"], fila and fila["subido_por"]])
    _version_pedida(quien, entrega, nombres, user["email"])
    r, archivo = _a_descargar(entrega, fila, nombres, user["email"])
    audit(user["email"], "armascanner_descargar_plano", f"{datos.plano} ({r['etapa']} v{r['version']}, {r['autor']})",
          "proyecto", datos.obra)
    return dict(r, url=storage.generate_presigned_url(archivo, expires=DESCARGA_SEGUNDOS))


def _version_pedida(quien: str, entrega, nombres, email: str):
    """404 si la versión pedida (`quien`: "mia", el autor de la entrega, o vacío) no es la que está."""
    if quien == "mia" and not (entrega and entrega["autor"] == email):
        raise HTTPException(status_code=404, detail="No tienes una versión de este plano en ArmaHub.")
    if quien and quien != "mia" and not (entrega and quien in (entrega["autor"], nombres.get(entrega["autor"]))):
        raise HTTPException(status_code=404, detail="Esa versión del plano no está en ArmaHub.")


def _a_descargar(entrega, fila, nombres, email: str) -> tuple:
    """({version, tamano, etapa, autor, mia}, key en R2) de lo que se baja: la entrega o, sin entrega, el
    paquete de la fila del plano. 404 si no hay ninguno."""
    if entrega:
        return ({"version": entrega["version"], "tamano": entrega["tamano"], "etapa": "terminado",
                 "autor": nombres.get(entrega["autor"], entrega["autor"]), "mia": entrega["autor"] == email},
                entrega["archivo"])
    if fila and fila["archivo"]:
        return ({"version": fila["version"], "tamano": fila["tamano"], "etapa": fila["etapa"],
                 "autor": nombres.get(fila["subido_por"], fila["subido_por"] or ""), "mia": fila["subido_por"] == email},
                fila["archivo"])
    raise HTTPException(status_code=404, detail="Ese plano no está en ArmaHub.")


# ── La pestaña Planos del portal (sesión del portal): avance, barras, PDF, reemplazos, pedido ──
def _fila_plano(f, nombres, yo: str, admin: bool, entrega, pedidos: list) -> dict:
    """Un plano de la obra en el portal (fila de planos_linea, con los textos que faltan vacíos y los números
    en 0), con su entrega y sus pedidos de reemplazo."""
    (obra, obra_nombre, plano, numero, titulo, revision, elemento, version, tamano, subido_por, subido_el,
     resumen, pedido_version, pedido_el, pedido_por, pdf, barras, aprobadas, kg, etapa, relacion, relacion_de) = f
    r = resumen or {"barras": barras, "aprobadas": aprobadas, "consultas": 0, "pendientes": barras - aprobadas,
                    "kg": float(kg)}
    kpis = kpis_de([plano_para_kpis(r, elemento)]) if etapa != "cargado" else None
    reemplazos = _reemplazos_dict(entrega, pedidos, nombres, yo)
    por_cambiar = any(x["estado"] == "aceptado" for x in reemplazos)
    return {"obra": obra, "obra_nombre": obra_nombre, "plano": plano, "numero": numero, "titulo": titulo,
            "revision": revision, "elemento": elemento, "version": version, "tamano": tamano,
            "guardado_por": nombres.get(subido_por, subido_por), "guardado_el": _cuando(subido_el),
            "resumen": r, "pedido": estado_pedido(version, pedido_version), "pedido_version": pedido_version,
            "pedido_el": _cuando(pedido_el), "pedido_por": nombres.get(pedido_por, pedido_por),
            "puede_enviar": etapa != "cargado" and not por_cambiar and puede_enviar(subido_por, yo, admin),
            "pdf": bool(pdf), "etapa": etapa, "puede_eliminar": admin, "relacion": relacion, "relacion_de": relacion_de,
            "entrega": _entrega_dict(entrega, nombres, yo), "reemplazos": reemplazos,
            "puede_responder": bool(entrega) and (admin or entrega["autor"] == yo), "kpis": kpis}


@router.get("/armascanner/planos-linea")
def planos_linea(obra: str, user=Depends(get_current_user)):
    """Los planos de una obra (portal: la ventana de la obra en Mis obras): cada uno con su etapa, el
    avance de su entrega (barras, aprobadas, con consulta, por aprobar, kg), sus KPIs (ítems, kg, PPI,
    Ø, m² si es de losa), de quién es, los pedidos de reemplazo y el estado de su pedido. La obra es
    obligatoria: sin ella devolvía los planos de todas las obras (programa 6.18)."""
    if not obra.strip():
        raise HTTPException(status_code=422, detail="Falta la obra.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            cur.execute("""
                SELECT p.id_proyecto, COALESCE(pr.nombre_proyecto, p.id_proyecto), p.plano, COALESCE(p.numero, ''),
                       COALESCE(p.titulo, ''), COALESCE(p.revision, ''), COALESCE(p.elemento, ''), p.version, p.tamano,
                       COALESCE(p.subido_por, ''), p.subido_el, p.resumen, p.pedido_version, p.pedido_el,
                       COALESCE(p.pedido_por, ''), p.pdf, COALESCE(p.barras, 0), COALESCE(p.aprobadas, 0),
                       COALESCE(p.kg, 0), COALESCE(p.etapa, ''), COALESCE(p.relacion, ''), COALESCE(p.relacion_de, '')
                  FROM planos_obra p
                  LEFT JOIN proyectos pr ON pr.id_proyecto = p.id_proyecto
                 WHERE p.id_proyecto = %s
                 ORDER BY 2, p.numero, p.plano
            """, (obra.strip(),))
            filas = cur.fetchall()
            obras = [obra.strip()]
            entregas, pedidos = _entregas(cur, obras), _reemplazos(cur, obras)
            nombres = _nombres(cur, [f[9] for f in filas] + [f[14] for f in filas]
                               + [e["autor"] for e in entregas.values()]
                               + [r["solicitante"] for lista in pedidos.values() for r in lista])
    yo, admin = user.get("email", ""), _es_admin(user)
    return {"admin": admin, "planos": [_fila_plano(f, nombres, yo, admin, entregas.get((f[0], f[2])),
                                                   pedidos.get((f[0], f[2]), []))
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
    from .. import storage
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            cur.execute("SELECT pdf FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (obra, plano))
            fila = cur.fetchone()
    if not fila or not fila[0]:
        return {"url": None}
    return {"url": storage.generate_presigned_url(fila[0], expires=DESCARGA_SEGUNDOS, content_type="application/pdf")}


@router.get("/armascanner/planos-linea/dwg")
def dwg_del_plano(obra: str, plano: str, user=Depends(get_current_user)):
    """«Descargar DWG»: el DWG del plano, sacado de su paquete en R2: el de la entrega (la copia de
    trabajo) o, sin entrega, el del antecedente. [Usuario 22-nov: «Descargar DWG (ver el DWG en la
    web, más adelante)»]"""
    from urllib.parse import quote
    from fastapi.responses import Response
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            entrega = _entrega(cur, obra, plano)
            fila = _fila_base(cur, obra, plano)
    archivo = (entrega and entrega["archivo"]) or (fila and fila["archivo"])
    if not archivo:
        raise HTTPException(status_code=404, detail="Este plano no tiene DWG en ArmaHub.")
    miembro, contenido = _dwg_de(archivo)
    if not contenido:
        raise HTTPException(status_code=404, detail="Este plano no tiene DWG en ArmaHub.")
    nombre = miembro.rsplit("/", 1)[-1]
    simple = "".join(c if c.isascii() and (c.isalnum() or c in "._-() ") else "_" for c in nombre)
    audit(user.get("email", "?"), "armascanner_descargar_dwg", f"{plano} ({nombre})", "proyecto", obra)
    return Response(contenido, media_type="application/octet-stream", headers={
        "Content-Disposition": f"attachment; filename=\"{simple}\"; filename*=UTF-8''{quote(nombre)}"})


def _dwg_de(archivo: str) -> tuple:
    """(su nombre en el paquete, su contenido) del DWG del paquete `archivo` en R2 (dwg_del_paquete); el
    contenido va None si el paquete no trae un DWG. 502 si el paquete no se puede leer."""
    import zipfile
    from .. import storage
    try:
        z = zipfile.ZipFile(BytesIO(storage.download_file(archivo)))
        miembro = dwg_del_paquete(z.namelist())
        return miembro, z.read(miembro) if miembro else None
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"No se pudo leer el plano guardado ({str(e)[:80]}).")


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
            if x is None:
                raise HTTPException(status_code=404, detail=NO_ESTA)
    _borrar(*x["claves"])  # recién confirmada la base
    audit(email, "armascanner_eliminar_plano",
          f"{datos.plano} (v{x['version']}" + (", con su entrega" if x["entrega"] else "")
          + (f", {x['barras']} barras" if x["barras"] else "") + ")", "proyecto", datos.obra)
    return {"ok": True, "barras_eliminadas": x["barras"]}
