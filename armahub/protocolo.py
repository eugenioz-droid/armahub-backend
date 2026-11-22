"""
protocolo.py
------------
Protocolo de cubicación (programa §8.13 filas 8.1 y 8.2; SPECS §5.3): el acuerdo de criterios
entre Armacero y la obra, que hasta hoy se llenaba en el Excel «Protocolo 2025».

DOS COSAS:

  La PLANTILLA de la empresa (`protocolo_plantillas`): secciones → criterios → opciones con su
  croquis. Cada fila es una versión y su `contenido` es el documento entero. Nada del contenido
  vive en el código: se edita en la pestaña Plantilla (administrador) y el Excel entró una vez,
  como datos (armahub/data/protocolo_2025.json, botón «Cargar plantilla inicial»).
      borrador  lo que el administrador está editando; no lo ve nadie más
      vigente   con la que nacen los protocolos (una sola)
      anterior  lo fue; la conservan los protocolos que nacieron de ella
  Publicar el borrador lo deja vigente. Una plantilla publicada no se vuelve a tocar: por eso un
  protocolo cerrado no cambia aunque la plantilla siga cambiando.

  El PROTOCOLO de cada obra (`protocolos`): una fila por versión, atada a la plantilla de la que
  salió, con sus respuestas {clave del criterio: {valor, obs}}.
      borrador → revisado (con el cliente) → cerrado
  Sólo el borrador se edita. Cerrado, se abre una versión nueva que hereda las respuestas.

Rutas (sesión del portal):
    GET  /protocolo/plantilla                    la plantilla en edición (borrador o vigente)   [admin]
    POST /protocolo/plantilla                    guarda el borrador                            [admin]
    POST /protocolo/plantilla/publicar           el borrador pasa a vigente                    [admin]
    POST /protocolo/plantilla/descartar          borra el borrador                             [admin]
    POST /protocolo/plantilla/inicial            carga inicial desde el Excel (si no hay nada) [admin]
    POST /protocolo/plantilla/croquis            sube un croquis a R2                          [admin]
    GET  /protocolo/obras                        las obras con el estado de su protocolo
    GET  /protocolo/obra/{id}                    el protocolo de la obra (?version=n)
    POST /protocolo/obra/{id}/crear              versión 1, desde la plantilla vigente
    POST /protocolo/obra/{id}/guardar            respuestas (sólo toca los criterios enviados)
    POST /protocolo/obra/{id}/estado             borrador ⇄ revisado → cerrado
    POST /protocolo/obra/{id}/nueva-version      desde la última, si está cerrada
    POST /protocolo/obra/{id}/actualizar-plantilla   pasa el borrador a la plantilla vigente
    GET  /protocolo/obra/{id}/vigente            los criterios acordados, planos (para ArmaScanner)

Quién: ven todos los usuarios internos (el externo, sólo sus obras; el cliente, nada todavía);
edita el protocolo el cubicador de la obra (`proyecto_usuarios`) y el administrador; la
plantilla, sólo el administrador (SPECS §5.5).
"""

import copy
import json
import math
import os
import re
import secrets
import unicodedata
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from . import storage
from .auth import get_current_user, require_admin_or_admin_calidad
from .db import audit, get_conn

router = APIRouter()

TIPOS = ("opcion", "opciones", "si_no", "numero", "texto", "tabla")
TIPOS_CON_OPCIONES = ("opcion", "opciones")
ESTADOS = ("borrador", "revisado", "cerrado")
# (de, a): el camino es borrador → revisado → cerrado; de revisado se puede volver a editar.
TRANSICIONES = {("borrador", "revisado"), ("revisado", "borrador"), ("revisado", "cerrado")}
ROLES_ADMIN = ("admin", "admin_calidad")
ROLES_INTERNOS = ("admin", "admin_calidad", "jefe_servicio", "miembro", "usc", "cubicador")
ROLES_OBRA_EDITAN = ("cubicador", "admin")   # proyecto_usuarios.rol
MAX_FILAS = 40                                # filas de una respuesta de tipo tabla
CARPETA_CROQUIS = "protocolo/croquis"
CROQUIS_MAX = 3 * 1024 * 1024
CROQUIS_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
URL_CROQUIS_SEGUNDOS = 12 * 3600              # una reunión larga con la pantalla abierta

_DATOS = os.path.join(os.path.dirname(__file__), "data")
INICIAL = os.path.join(_DATOS, "protocolo_2025.json")


# ══════ Reglas (funciones puras: tests/test_protocolo.py) ══════

def slug(texto, usados: Optional[set] = None, largo: int = 48) -> str:
    """Identificador estable a partir de un texto: minúsculas, sin tildes, con guion bajo. Con
    `usados`, no repite (agrega _2, _3…) y lo anota."""
    t = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode("ascii").lower()
    t = re.sub(r"[^a-z0-9]+", "_", t).strip("_")[:largo].strip("_") or "item"
    if usados is None:
        return t
    base, n = t, 2
    while t in usados:
        t, n = f"{base}_{n}", n + 1
    usados.add(t)
    return t


def _txt(v, largo: int) -> str:
    """Texto de una línea, sin espacios de sobra."""
    return re.sub(r"\s+", " ", str(v or "")).strip()[:largo]


def clave_croquis(v) -> str:
    """Una clave de croquis sólo vale dentro de su carpeta de R2: la plantilla no puede apuntar
    a otro archivo del almacenamiento."""
    v = str(v or "").strip()
    return v if re.fullmatch(CARPETA_CROQUIS + r"/[A-Za-z0-9_.\-/]{1,200}", v) and ".." not in v else ""


def normalizar_plantilla(contenido) -> tuple:
    """(contenido limpio, [errores]) de lo que manda la pestaña Plantilla. Deja sólo los campos
    conocidos, da clave a los criterios nuevos (y un id a opciones y columnas) sin cambiar las
    que ya existen, y dice qué falta para poder guardar."""
    errores, secciones, claves = [], [], set()
    crudas = contenido.get("secciones") if isinstance(contenido, dict) else None
    if not isinstance(crudas, list):
        return {"nombre": "", "secciones": []}, ["La plantilla no tiene secciones."]
    for i, s in enumerate(crudas, 1):
        if not isinstance(s, dict):
            continue
        titulo = _txt(s.get("titulo"), 120)
        if not titulo:
            errores.append(f"Sección {i}: falta el título.")
        criterios = []
        for j, c in enumerate(s.get("criterios") or [], 1):
            if not isinstance(c, dict):
                continue
            donde = f"{titulo or 'Sección ' + str(i)}, criterio {j}"
            texto, tipo = _txt(c.get("texto"), 600), c.get("tipo")
            if not texto:
                errores.append(f"{donde}: falta el texto.")
            if tipo not in TIPOS:
                errores.append(f"{donde}: tipo de respuesta desconocido.")
                tipo = "texto"
            crit = {"clave": slug(c.get("clave") or texto, claves), "texto": texto, "tipo": tipo,
                    "unidad": _txt(c.get("unidad"), 20) if tipo == "numero" else "",
                    "ayuda": _txt(c.get("ayuda"), 300), "croquis": clave_croquis(c.get("croquis")),
                    "opciones": [], "columnas": [], "filas": []}
            if tipo in TIPOS_CON_OPCIONES:
                ids = set()
                for o in c.get("opciones") or []:
                    if not isinstance(o, dict):
                        continue
                    t = _txt(o.get("texto"), 200)
                    if not t:
                        errores.append(f"{donde}: hay una opción sin texto.")
                        continue
                    crit["opciones"].append({"id": slug(o.get("id") or t, ids), "texto": t,
                                             "croquis": clave_croquis(o.get("croquis"))})
                if len(crit["opciones"]) < 2:
                    errores.append(f"{donde}: requiere al menos dos opciones.")
            if tipo == "tabla":
                ids = set()
                for col in c.get("columnas") or []:
                    if not isinstance(col, dict):
                        continue
                    t = _txt(col.get("titulo"), 60)
                    if not t:
                        errores.append(f"{donde}: hay una columna sin título.")
                        continue
                    crit["columnas"].append({"id": slug(col.get("id") or t, ids), "titulo": t,
                                             "unidad": _txt(col.get("unidad"), 20)})
                if not crit["columnas"]:
                    errores.append(f"{donde}: requiere al menos una columna.")
                for f in c.get("filas") or []:
                    f = _txt(f, 80)
                    if f and f not in crit["filas"]:
                        crit["filas"].append(f)
            criterios.append(crit)
        secciones.append({"titulo": titulo, "criterios": criterios})
    if not any(s["criterios"] for s in secciones):
        errores.append("La plantilla no tiene criterios.")
    return {"nombre": _txt(contenido.get("nombre"), 80), "secciones": secciones}, errores


def criterios_de(contenido) -> dict:
    """{clave: criterio}, en el orden de la plantilla."""
    return {c["clave"]: c for s in (contenido or {}).get("secciones", []) for c in s.get("criterios", [])}


def leer_numero(v) -> Optional[float]:
    """El número que escribió el usuario, a la chilena: «1.250,5» = 1250.5 y «15.000» = 15000;
    «12.5» y «0.125» siguen siendo decimales. None si viene vacío; ValueError si no es un número."""
    if isinstance(v, bool):
        raise ValueError(v)
    if isinstance(v, (int, float)):
        n = float(v)
    else:
        t = str(v).strip().replace(" ", "")
        if not t:
            return None
        if "," in t:
            t = t.replace(".", "").replace(",", ".")
        elif re.fullmatch(r"-?[1-9]\d{0,2}(\.\d{3})+", t):
            t = t.replace(".", "")
        n = float(t)
    if not math.isfinite(n) or abs(n) > 1e12:
        raise ValueError(v)
    return int(n) if n == int(n) else round(n, 6)


def limpiar_valor(criterio: dict, valor) -> tuple:
    """(valor limpio, error). El valor limpio es None cuando el criterio queda sin responder."""
    tipo = criterio["tipo"]
    if valor is None or valor == "":
        return None, None
    if tipo == "opcion":
        return (valor, None) if valor in [o["id"] for o in criterio["opciones"]] else (None, "opción desconocida")
    if tipo == "opciones":
        ids = [o["id"] for o in criterio["opciones"]]
        if not isinstance(valor, list) or any(v not in ids for v in valor):
            return None, "opción desconocida"
        return [i for i in ids if i in valor] or None, None
    if tipo == "si_no":
        return (valor, None) if valor in ("si", "no") else (None, "se responde sí o no")
    if tipo == "numero":
        try:
            return leer_numero(valor), None
        except (TypeError, ValueError):
            return None, "no es un número"
    if tipo == "texto":
        return str(valor).strip()[:4000] or None, None
    # tabla: filas {id de columna: texto}; con filas fijas, cada una lleva su nombre en «_fila».
    if not isinstance(valor, list):
        return None, "se esperaba una tabla"
    columnas, fijas, filas = [c["id"] for c in criterio["columnas"]], criterio.get("filas") or [], []
    for f in valor:
        if not isinstance(f, dict):
            continue
        fila = {c: _txt(f.get(c), 80) for c in columnas if _txt(f.get(c), 80)}
        if not fila or (fijas and f.get("_fila") not in fijas):
            continue
        if fijas:
            fila["_fila"] = f["_fila"]
        filas.append(fila)
    if fijas:   # una por nombre, en el orden de la plantilla
        filas = [next(f for f in filas if f["_fila"] == n) for n in fijas if any(f["_fila"] == n for f in filas)]
    return filas[:MAX_FILAS] or None, None


def aplicar_respuestas(contenido, actuales, cambios) -> tuple:
    """(respuestas nuevas, [errores]). Sólo toca los criterios que vienen en `cambios`
    ({clave: {valor?, obs?}}) y, de cada uno, sólo lo enviado. Un criterio sin valor ni
    observación deja de estar en las respuestas."""
    criterios = criterios_de(contenido)
    nuevas = {k: v for k, v in (actuales or {}).items() if k in criterios and isinstance(v, dict)}
    errores = []
    for clave, r in (cambios or {}).items():
        c = criterios.get(clave)
        if not c or not isinstance(r, dict):
            errores.append(f"Criterio desconocido: {clave}.")
            continue
        valor, obs = (nuevas.get(clave) or {}).get("valor"), (nuevas.get(clave) or {}).get("obs") or ""
        if "valor" in r:
            valor, error = limpiar_valor(c, r["valor"])
            if error:
                errores.append(f"{c['texto'][:60]}: {error}.")
                continue
        if "obs" in r:
            obs = str(r["obs"] or "").strip()[:1000]
        if valor is None and not obs:
            nuevas.pop(clave, None)
        else:
            nuevas[clave] = {"valor": valor, "obs": obs}
    return nuevas, errores


def heredar_respuestas(contenido_nuevo, respuestas) -> tuple:
    """(respuestas que valen en la plantilla nueva, cuántas se pierden). Vale la que conserva su
    clave y cuyo valor sigue siendo posible (la opción existe, el tipo no cambió)."""
    criterios, nuevas, perdidas = criterios_de(contenido_nuevo), {}, 0
    for clave, r in (respuestas or {}).items():
        c = criterios.get(clave)
        if not c or not isinstance(r, dict):
            perdidas += 1
            continue
        valor, error = limpiar_valor(c, r.get("valor"))
        obs = str(r.get("obs") or "").strip()[:1000]
        if error or (valor is None and r.get("valor") is not None):
            perdidas += 1
        if valor is not None or obs:
            nuevas[clave] = {"valor": valor, "obs": obs}
    return nuevas, perdidas


def avance(contenido, respuestas) -> dict:
    """Cuántos criterios tienen respuesta, cuántos faltan y cuántos llevan observación."""
    respuestas = respuestas or {}
    claves = list(criterios_de(contenido))
    respondidos = sum(1 for k in claves if (respuestas.get(k) or {}).get("valor") is not None)
    return {"total": len(claves), "respondidos": respondidos, "pendientes": len(claves) - respondidos,
            "observaciones": sum(1 for k in claves if (respuestas.get(k) or {}).get("obs"))}


def puede_editar(rol: str, roles_en_obra) -> bool:
    """Edita el protocolo el administrador y el cubicador de la obra (SPECS §5.5)."""
    return rol in ROLES_ADMIN or any(r in ROLES_OBRA_EDITAN for r in (roles_en_obra or []))


def puede_ver(rol: str, roles_en_obra) -> bool:
    """Ven todos los usuarios internos; el externo, sólo las obras donde está asignado."""
    return rol in ROLES_INTERNOS or (rol == "externo" and bool(roles_en_obra))


def valor_en_texto(criterio: dict, valor) -> str:
    """El valor como se lee: el texto de la opción, «Sí», el número con su unidad."""
    if valor is None:
        return ""
    tipo = criterio["tipo"]
    if tipo in TIPOS_CON_OPCIONES:
        elegidas = valor if isinstance(valor, list) else [valor]
        return ", ".join(o["texto"] for o in criterio["opciones"] if o["id"] in elegidas)
    if tipo == "si_no":
        return "Sí" if valor == "si" else "No"
    if tipo == "numero":
        return (str(valor).replace(".", ",") + " " + criterio.get("unidad", "")).strip()
    if tipo == "tabla":
        titulos = {c["id"]: c["titulo"] for c in criterio["columnas"]}
        return " · ".join(((f.get("_fila") + ": ") if f.get("_fila") else "") +
                          ", ".join(f"{titulos[k]} {v}" for k, v in f.items() if k in titulos) for f in valor)
    return str(valor)


def criterios_vigentes(contenido, respuestas) -> list:
    """Los criterios de un protocolo en una lista plana, cada uno con su clave estable, su valor
    y el valor en texto: lo que lee ArmaScanner (programa §8.13 fila 8.5)."""
    respuestas, out = respuestas or {}, []
    for s in (contenido or {}).get("secciones", []):
        for c in s.get("criterios", []):
            r = respuestas.get(c["clave"]) or {}
            out.append({"clave": c["clave"], "seccion": s["titulo"], "texto": c["texto"], "tipo": c["tipo"],
                        "unidad": c.get("unidad", ""), "valor": r.get("valor"),
                        "valor_texto": valor_en_texto(c, r.get("valor")), "observacion": r.get("obs") or ""})
    return out


def tipo_de_imagen(contenido: bytes) -> Optional[str]:
    """El tipo real del archivo por sus primeros bytes (no por su nombre): PNG, JPG o WEBP."""
    if contenido[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if contenido[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if contenido[:4] == b"RIFF" and contenido[8:12] == b"WEBP":
        return "image/webp"
    return None


def claves_de_croquis(contenido) -> list:
    """Todas las claves de croquis de una plantilla (criterios y opciones)."""
    out = []
    for c in criterios_de(contenido).values():
        out += [c.get("croquis")] + [o.get("croquis") for o in c.get("opciones", [])]
    return [k for k in out if k]


def con_urls(contenido, url_de) -> dict:
    """Copia de la plantilla con `croquis_url` junto a cada `croquis` (enlace de lectura)."""
    copia = copy.deepcopy(contenido or {"secciones": []})
    for c in criterios_de(copia).values():
        for item in [c] + c.get("opciones", []):
            item["croquis_url"] = url_de(item.get("croquis")) if item.get("croquis") else ""
    return copia


def plantilla_inicial(subir) -> dict:
    """El contenido de la carga inicial (el Excel «Protocolo 2025» pasado a datos por
    scripts/generar_protocolo_inicial.py), con cada croquis subido por `subir(clave, bytes,
    tipo)` y su clave de R2 en el lugar del nombre de archivo."""
    with open(INICIAL, encoding="utf-8") as f:
        datos = json.load(f)
    carpeta = os.path.join(_DATOS, *str(datos.get("croquis") or "").split("/"))

    def subido(archivo):
        if not archivo:
            return ""
        nombre = os.path.basename(archivo)
        with open(os.path.join(carpeta, nombre), "rb") as f:
            contenido = f.read()
        clave = f"{CARPETA_CROQUIS}/inicial/{nombre}"
        subir(clave, contenido, tipo_de_imagen(contenido) or "application/octet-stream")
        return clave

    for s in datos["secciones"]:
        for c in s["criterios"]:
            c["croquis"] = subido(c.get("croquis"))
            for o in c.get("opciones", []):
                o["croquis"] = subido(o.get("croquis"))
    return datos


# ══════ Base y almacenamiento ══════

def _cuando(ts) -> str:
    """«21-11-2026 10:30», en la hora de Chile."""
    if not ts:
        return ""
    try:
        from zoneinfo import ZoneInfo
        ts = ts.astimezone(ZoneInfo("America/Santiago"))
    except Exception:
        pass
    return ts.strftime("%d-%m-%Y %H:%M")


def _nombres(cur, emails) -> dict:
    """{correo: «Nombre Apellido»} (el correo, si el usuario no tiene nombre)."""
    emails = sorted({e for e in emails if e})
    if not emails:
        return {}
    cur.execute("SELECT email, nombre, apellido FROM users WHERE email = ANY(%s)", (emails,))
    return {e: ((n or "") + " " + (a or "")).strip() or e for e, n, a in cur.fetchall()}


def _url_croquis(clave: str) -> str:
    if not clave or not storage.is_configured():
        return ""
    try:
        return storage.public_url(clave) or storage.generate_presigned_url(clave, expires=URL_CROQUIS_SEGUNDOS)
    except Exception:
        return ""


_COLS_PLANTILLA = "id, version, estado, contenido, revision, guardada_por, guardada_el, publicada_por, publicada_el"


def _plantilla_dict(f) -> Optional[dict]:
    if not f:
        return None
    return {"id": f[0], "version": f[1], "estado": f[2], "contenido": f[3] or {"secciones": []}, "revision": f[4],
            "guardada_por": f[5], "guardada_el": f[6], "publicada_por": f[7], "publicada_el": f[8]}


def _plantilla(cur, estado: str) -> Optional[dict]:
    """La plantilla en ese estado (hay a lo más una vigente y un borrador)."""
    cur.execute(f"SELECT {_COLS_PLANTILLA} FROM protocolo_plantillas WHERE estado = %s ORDER BY version DESC LIMIT 1",
                (estado,))
    return _plantilla_dict(cur.fetchone())


def _plantilla_por_id(cur, plantilla_id: int) -> dict:
    cur.execute(f"SELECT {_COLS_PLANTILLA} FROM protocolo_plantillas WHERE id = %s", (plantilla_id,))
    p = _plantilla_dict(cur.fetchone())
    if not p:
        raise HTTPException(status_code=500, detail="El protocolo apunta a una plantilla que ya no existe.")
    return p


def _plantilla_a_la_vista(p: Optional[dict], nombres: dict) -> Optional[dict]:
    if not p:
        return None
    return {"version": p["version"], "estado": p["estado"], "revision": p["revision"],
            "contenido": con_urls(p["contenido"], _url_croquis),
            "guardada": " · ".join(x for x in (_cuando(p["guardada_el"]), nombres.get(p["guardada_por"], "")) if x),
            "publicada": " · ".join(x for x in (_cuando(p["publicada_el"]), nombres.get(p["publicada_por"], "")) if x)}


_SQL_OBRAS = """
    SELECT p.id_proyecto, p.nombre_proyecto, p.asa_job_id, ao.nombre, ao.cliente, co.nombre, p.empresa
      FROM proyectos p
      LEFT JOIN asa_obras ao ON ao.asa_job_id = p.asa_job_id
      LEFT JOIN constructoras co ON co.id = p.constructora_id
"""


def _obra_dict(f) -> dict:
    """La obra como la conoce el sistema: nombre y cliente de aSa cuando está enlazada."""
    return {"id": f[0], "nombre": f[3] or f[1] or f[0], "codigo": f[2] or f[0], "cliente": f[4] or f[5] or f[6] or ""}


def _obra(cur, id_proyecto: str) -> dict:
    cur.execute(_SQL_OBRAS + " WHERE p.id_proyecto = %s", (id_proyecto,))
    f = cur.fetchone()
    if not f:
        raise HTTPException(status_code=404, detail="La obra no existe.")
    return _obra_dict(f)


def _roles_en_obra(cur, id_proyecto: str, email: str) -> list:
    cur.execute("""SELECT pu.rol FROM proyecto_usuarios pu JOIN users u ON u.id = pu.user_id
                    WHERE pu.id_proyecto = %s AND u.email = %s""", (id_proyecto, email or ""))
    return [r[0] for r in cur.fetchall()]


def _acceso(cur, id_proyecto: str, user: dict, editar: bool = False) -> bool:
    """403 si el usuario no ve la obra (o, con `editar`, si no edita su protocolo). Devuelve si edita."""
    rol = user.get("role") or ""
    en_obra = [] if rol in ROLES_ADMIN else _roles_en_obra(cur, id_proyecto, user.get("email", ""))
    if not puede_ver(rol, en_obra):
        raise HTTPException(status_code=403, detail="No tienes acceso a esta obra.")
    edita = puede_editar(rol, en_obra)
    if editar and not edita:
        raise HTTPException(status_code=403, detail="El protocolo lo edita el cubicador de la obra o un administrador.")
    return edita


_COLS_PROTOCOLO = ("id, version, estado, plantilla_id, respuestas, creado_por, creado_el, guardado_por, guardado_el, "
                   "revisado_por, revisado_el, cerrado_por, cerrado_el")


def _protocolo_dict(f) -> Optional[dict]:
    if not f:
        return None
    claves = [c.strip() for c in _COLS_PROTOCOLO.split(",")]
    d = dict(zip(claves, f))
    d["respuestas"] = d["respuestas"] or {}
    return d


def _protocolo(cur, id_proyecto: str, version: int = 0, bloquear: bool = False) -> Optional[dict]:
    """La versión pedida del protocolo de la obra, o la última. `bloquear`: la fila queda tomada
    hasta el fin de la transacción (dos guardados a la vez no se pisan)."""
    sql = f"SELECT {_COLS_PROTOCOLO} FROM protocolos WHERE id_proyecto = %s"
    params = [id_proyecto]
    if version:
        sql += " AND version = %s"
        params.append(version)
    sql += " ORDER BY version DESC LIMIT 1" + (" FOR UPDATE" if bloquear else "")
    cur.execute(sql, params)
    return _protocolo_dict(cur.fetchone())


# ══════ Plantilla de la empresa (administrador) ══════

def _leer_plantilla(cur) -> dict:
    borrador, vigente = _plantilla(cur, "borrador"), _plantilla(cur, "vigente")
    actual = borrador or vigente
    nombres = _nombres(cur, [actual["guardada_por"], actual["publicada_por"]]) if actual else {}
    return {"plantilla": _plantilla_a_la_vista(actual, nombres),
            "vigente": vigente["version"] if vigente else None,
            "hay_inicial": os.path.exists(INICIAL)}


@router.get("/protocolo/plantilla")
def leer_plantilla(admin=Depends(require_admin_or_admin_calidad)):
    """La plantilla que edita el administrador: el borrador si hay uno; si no, la vigente."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            return _leer_plantilla(cur)


class GuardarPlantilla(BaseModel):
    contenido: dict
    revision: Optional[int] = None


@router.post("/protocolo/plantilla")
def guardar_plantilla(datos: GuardarPlantilla, admin=Depends(require_admin_or_admin_calidad)):
    """Guarda el borrador (lo crea, como versión siguiente, si se estaba mirando la vigente).
    No cambia nada para las obras hasta «Publicar»."""
    limpio, errores = normalizar_plantilla(datos.contenido)
    if errores:
        raise HTTPException(status_code=400, detail=errores[0] + (f" (y {len(errores) - 1} más)" if len(errores) > 1 else ""))
    email = admin.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            borrador = _plantilla(cur, "borrador")
            if borrador:
                if datos.revision is not None and datos.revision != borrador["revision"]:
                    raise HTTPException(status_code=409, detail="Otro usuario guardó la plantilla. Recarga la página.")
                cur.execute("""UPDATE protocolo_plantillas
                                  SET contenido = %s::jsonb, revision = revision + 1, guardada_por = %s, guardada_el = NOW()
                                WHERE id = %s""", (json.dumps(limpio), email, borrador["id"]))
            else:
                cur.execute("SELECT COALESCE(MAX(version), 0) FROM protocolo_plantillas")
                version = cur.fetchone()[0] + 1
                cur.execute("""INSERT INTO protocolo_plantillas (version, estado, contenido, creada_por, guardada_por, guardada_el)
                               VALUES (%s, 'borrador', %s::jsonb, %s, %s, NOW())""",
                            (version, json.dumps(limpio), email, email))
            respuesta = _leer_plantilla(cur)
    return dict(respuesta, ok=True)


@router.post("/protocolo/plantilla/publicar")
def publicar_plantilla(admin=Depends(require_admin_or_admin_calidad)):
    """El borrador pasa a ser la plantilla vigente; la que lo era queda como anterior (la siguen
    usando los protocolos que nacieron de ella)."""
    email = admin.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            borrador = _plantilla(cur, "borrador")
            if not borrador:
                raise HTTPException(status_code=409, detail="No hay cambios que publicar.")
            _, errores = normalizar_plantilla(borrador["contenido"])
            if errores:
                raise HTTPException(status_code=400, detail=errores[0])
            cur.execute("UPDATE protocolo_plantillas SET estado = 'anterior' WHERE estado = 'vigente'")
            cur.execute("""UPDATE protocolo_plantillas SET estado = 'vigente', publicada_por = %s, publicada_el = NOW()
                            WHERE id = %s""", (email, borrador["id"]))
            respuesta = _leer_plantilla(cur)
    audit(email, "protocolo_plantilla_publicar", f"v{borrador['version']}", "protocolo_plantilla", str(borrador["id"]))
    return dict(respuesta, ok=True)


@router.post("/protocolo/plantilla/descartar")
def descartar_plantilla(admin=Depends(require_admin_or_admin_calidad)):
    """Borra el borrador: la pestaña vuelve a mostrar la plantilla vigente."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM protocolo_plantillas WHERE estado = 'borrador'")
            respuesta = _leer_plantilla(cur)
    return dict(respuesta, ok=True)


@router.post("/protocolo/plantilla/inicial")
def cargar_plantilla_inicial(admin=Depends(require_admin_or_admin_calidad)):
    """Carga inicial: el contenido del Excel «Protocolo 2025» entra como versión 1, vigente, con
    sus croquis en R2. Sólo si todavía no hay ninguna plantilla."""
    email = admin.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM protocolo_plantillas")
            if cur.fetchone()[0]:
                raise HTTPException(status_code=409, detail="Ya hay una plantilla: se edita en pantalla.")
    if not os.path.exists(INICIAL):
        raise HTTPException(status_code=404, detail="Falta el archivo de la carga inicial.")
    if not storage.is_configured():
        raise HTTPException(status_code=503, detail="El almacenamiento de archivos no está configurado.")
    try:
        inicial = plantilla_inicial(storage.upload_file)
    except Exception:
        raise HTTPException(status_code=502, detail="No se pudieron subir los croquis. Vuelve a intentar.")
    limpio, errores = normalizar_plantilla(inicial)
    if errores:
        raise HTTPException(status_code=500, detail="La carga inicial no es válida: " + errores[0])
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM protocolo_plantillas")
            if cur.fetchone()[0]:
                raise HTTPException(status_code=409, detail="Ya hay una plantilla: se edita en pantalla.")
            cur.execute("""INSERT INTO protocolo_plantillas
                                  (version, estado, contenido, creada_por, guardada_por, guardada_el, publicada_por, publicada_el)
                           VALUES (1, 'vigente', %s::jsonb, %s, %s, NOW(), %s, NOW())""",
                        (json.dumps(limpio), email, email, email))
            respuesta = _leer_plantilla(cur)
    audit(email, "protocolo_plantilla_inicial", f"{len(criterios_de(limpio))} criterios", "protocolo_plantilla", "1")
    return dict(respuesta, ok=True)


@router.post("/protocolo/plantilla/croquis")
async def subir_croquis(archivo: UploadFile = File(...), admin=Depends(require_admin_or_admin_calidad)):
    """Sube el croquis de una opción (o de un criterio) y devuelve su clave. Queda en la
    plantilla al guardarla. Nunca se borra un croquis: lo pueden estar usando versiones anteriores."""
    contenido = await archivo.read()
    if len(contenido) > CROQUIS_MAX:
        raise HTTPException(status_code=413, detail="El croquis pesa más de 3 MB.")
    tipo = tipo_de_imagen(contenido)
    if not tipo:
        raise HTTPException(status_code=400, detail="El croquis debe ser una imagen PNG, JPG o WEBP.")
    if not storage.is_configured():
        raise HTTPException(status_code=503, detail="El almacenamiento de archivos no está configurado.")
    clave = f"{CARPETA_CROQUIS}/{secrets.token_hex(8)}{CROQUIS_EXT[tipo]}"
    storage.upload_file(clave, contenido, tipo)
    return {"ok": True, "croquis": clave, "croquis_url": _url_croquis(clave)}


# ══════ Protocolo de la obra ══════

@router.get("/protocolo/obras")
def obras(user=Depends(get_current_user)):
    """Las obras (tabla `proyectos`, con nombre y cliente de aSa) y el estado de su protocolo:
    versión, estado y avance de la última versión."""
    rol, email = user.get("role") or "", user.get("email", "")
    if rol not in ROLES_INTERNOS and rol != "externo":
        raise HTTPException(status_code=403, detail="No tienes acceso a las obras.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(_SQL_OBRAS)
            filas = cur.fetchall()
            if rol == "externo":   # sólo las obras donde está asignado
                cur.execute("""SELECT pu.id_proyecto FROM proyecto_usuarios pu JOIN users u ON u.id = pu.user_id
                                WHERE u.email = %s""", (email,))
                mias = {r[0] for r in cur.fetchall()}
                filas = [f for f in filas if f[0] in mias]
            cur.execute("""SELECT DISTINCT ON (id_proyecto) id_proyecto, version, estado, plantilla_id, respuestas
                             FROM protocolos ORDER BY id_proyecto, version DESC""")
            ultimos = {r[0]: r for r in cur.fetchall()}
            contenidos = {}
            if ultimos:
                cur.execute("SELECT id, contenido FROM protocolo_plantillas WHERE id = ANY(%s)",
                            (sorted({r[3] for r in ultimos.values()}),))
                contenidos = dict(cur.fetchall())
            hay_plantilla = _plantilla(cur, "vigente") is not None
    out = []
    for f in filas:
        o, u = _obra_dict(f), ultimos.get(f[0])
        if u:
            a = avance(contenidos.get(u[3]), u[4])
            o["protocolo"] = {"version": u[1], "estado": u[2], "respondidos": a["respondidos"], "total": a["total"]}
        else:
            o["protocolo"] = None
        out.append(o)
    out.sort(key=lambda o: str(o["nombre"]).lower())
    return {"obras": out, "hay_plantilla": hay_plantilla, "admin": rol in ROLES_ADMIN}


def _protocolo_a_la_vista(cur, p: dict, ultima: int, vigente: Optional[dict]) -> dict:
    plantilla = _plantilla_por_id(cur, p["plantilla_id"])
    nombres = _nombres(cur, [p["creado_por"], p["guardado_por"], p["revisado_por"], p["cerrado_por"]])

    def sello(por, el):
        return " · ".join(x for x in (_cuando(p[el]), nombres.get(p[por], "")) if x)

    return {"version": p["version"], "estado": p["estado"], "ultima": p["version"] == ultima,
            "plantilla_version": plantilla["version"],
            "plantilla_al_dia": not vigente or vigente["id"] == plantilla["id"],
            "contenido": con_urls(plantilla["contenido"], _url_croquis),
            "respuestas": p["respuestas"], "avance": avance(plantilla["contenido"], p["respuestas"]),
            "creado": sello("creado_por", "creado_el"), "guardado": sello("guardado_por", "guardado_el"),
            "revisado": sello("revisado_por", "revisado_el"), "cerrado": sello("cerrado_por", "cerrado_el")}


def _vista_obra(cur, id_proyecto: str, user: dict, version: int = 0) -> dict:
    obra = _obra(cur, id_proyecto)
    edita = _acceso(cur, id_proyecto, user)
    cur.execute("SELECT version, estado FROM protocolos WHERE id_proyecto = %s ORDER BY version", (id_proyecto,))
    versiones = [{"version": v, "estado": e} for v, e in cur.fetchall()]
    vigente = _plantilla(cur, "vigente")
    p = _protocolo(cur, id_proyecto, version) if versiones else None
    if version and not p:
        raise HTTPException(status_code=404, detail="Esa versión del protocolo no existe.")
    return {"obra": obra, "puede_editar": edita, "versiones": versiones,
            "plantilla_vigente": vigente["version"] if vigente else None,
            "protocolo": _protocolo_a_la_vista(cur, p, versiones[-1]["version"], vigente) if p else None}


@router.get("/protocolo/obra/{id_proyecto}")
def protocolo_de_obra(id_proyecto: str, version: int = 0, user=Depends(get_current_user)):
    """El protocolo de la obra: lo que el sistema ya sabe de ella, sus versiones y la versión
    pedida (la última, si no se pide) con su plantilla, sus respuestas y su avance."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            return _vista_obra(cur, id_proyecto, user, version)


@router.post("/protocolo/obra/{id_proyecto}/crear")
def crear_protocolo(id_proyecto: str, user=Depends(get_current_user)):
    """Abre el protocolo de la obra: versión 1, en borrador, con la plantilla vigente."""
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _obra(cur, id_proyecto)
            _acceso(cur, id_proyecto, user, editar=True)
            vigente = _plantilla(cur, "vigente")
            if not vigente:
                raise HTTPException(status_code=409, detail="No hay plantilla publicada.")
            if _protocolo(cur, id_proyecto):
                raise HTTPException(status_code=409, detail="La obra ya tiene protocolo.")
            cur.execute("""INSERT INTO protocolos (id_proyecto, version, estado, plantilla_id, respuestas, creado_por)
                           VALUES (%s, 1, 'borrador', %s, '{}'::jsonb, %s)
                           ON CONFLICT (id_proyecto, version) DO NOTHING""", (id_proyecto, vigente["id"], email))
            vista = _vista_obra(cur, id_proyecto, user)
    audit(email, "protocolo_crear", "v1", "proyecto", id_proyecto)
    return dict(vista, ok=True)


class GuardarRespuestas(BaseModel):
    version: int
    respuestas: dict


@router.post("/protocolo/obra/{id_proyecto}/guardar")
def guardar_respuestas(id_proyecto: str, datos: GuardarRespuestas, user=Depends(get_current_user)):
    """Guarda respuestas del borrador. Sólo toca los criterios enviados: lo que otro usuario
    respondió en otros criterios se conserva."""
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _obra(cur, id_proyecto)
            _acceso(cur, id_proyecto, user, editar=True)
            p = _protocolo(cur, id_proyecto, datos.version, bloquear=True)
            if not p:
                raise HTTPException(status_code=404, detail="Esa versión del protocolo no existe.")
            if p["estado"] != "borrador":
                raise HTTPException(status_code=409, detail="El protocolo no está en borrador: no se edita.")
            plantilla = _plantilla_por_id(cur, p["plantilla_id"])
            nuevas, errores = aplicar_respuestas(plantilla["contenido"], p["respuestas"], datos.respuestas)
            if errores:
                raise HTTPException(status_code=400, detail=errores[0])
            cur.execute("UPDATE protocolos SET respuestas = %s::jsonb, guardado_por = %s, guardado_el = NOW() WHERE id = %s",
                        (json.dumps(nuevas), email, p["id"]))
            vista = _vista_obra(cur, id_proyecto, user, datos.version)
    audit(email, "protocolo_guardar", f"v{datos.version}: {len(datos.respuestas)} criterios", "proyecto", id_proyecto)
    return dict(vista, ok=True)


class CambioEstado(BaseModel):
    version: int
    estado: str


@router.post("/protocolo/obra/{id_proyecto}/estado")
def cambiar_estado(id_proyecto: str, datos: CambioEstado, user=Depends(get_current_user)):
    """borrador → revisado (con el cliente) → cerrado; de revisado se puede volver a borrador.
    Queda quién y cuándo. Cerrado no vuelve atrás: se abre una versión nueva."""
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _obra(cur, id_proyecto)
            _acceso(cur, id_proyecto, user, editar=True)
            p = _protocolo(cur, id_proyecto, datos.version, bloquear=True)
            if not p:
                raise HTTPException(status_code=404, detail="Esa versión del protocolo no existe.")
            if (p["estado"], datos.estado) not in TRANSICIONES:
                raise HTTPException(status_code=409, detail="Ese cambio de estado no corresponde: el protocolo está "
                                                            + ("revisado con el cliente." if p["estado"] == "revisado"
                                                               else f"{p['estado']}."))
            if datos.estado == "revisado":
                cur.execute("UPDATE protocolos SET estado = 'revisado', revisado_por = %s, revisado_el = NOW() WHERE id = %s",
                            (email, p["id"]))
            elif datos.estado == "cerrado":
                cur.execute("UPDATE protocolos SET estado = 'cerrado', cerrado_por = %s, cerrado_el = NOW() WHERE id = %s",
                            (email, p["id"]))
            else:
                cur.execute("UPDATE protocolos SET estado = 'borrador', revisado_por = NULL, revisado_el = NULL WHERE id = %s",
                            (p["id"],))
            vista = _vista_obra(cur, id_proyecto, user, datos.version)
    audit(email, "protocolo_estado", f"v{datos.version}: {p['estado']} → {datos.estado}", "proyecto", id_proyecto)
    return dict(vista, ok=True)


@router.post("/protocolo/obra/{id_proyecto}/nueva-version")
def nueva_version(id_proyecto: str, user=Depends(get_current_user)):
    """Desde un protocolo cerrado: versión siguiente, en borrador, con la plantilla vigente y
    las respuestas de la anterior que sigan valiendo."""
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _obra(cur, id_proyecto)
            _acceso(cur, id_proyecto, user, editar=True)
            ultima = _protocolo(cur, id_proyecto, bloquear=True)
            if not ultima:
                raise HTTPException(status_code=404, detail="La obra no tiene protocolo.")
            if ultima["estado"] != "cerrado":
                raise HTTPException(status_code=409, detail="La última versión no está cerrada.")
            plantilla = _plantilla(cur, "vigente") or _plantilla_por_id(cur, ultima["plantilla_id"])
            respuestas, perdidas = heredar_respuestas(plantilla["contenido"], ultima["respuestas"])
            version = ultima["version"] + 1
            cur.execute("""INSERT INTO protocolos (id_proyecto, version, estado, plantilla_id, respuestas, creado_por)
                           VALUES (%s, %s, 'borrador', %s, %s::jsonb, %s)
                           ON CONFLICT (id_proyecto, version) DO NOTHING""",
                        (id_proyecto, version, plantilla["id"], json.dumps(respuestas), email))
            vista = _vista_obra(cur, id_proyecto, user)
    audit(email, "protocolo_nueva_version", f"v{version} desde v{ultima['version']}", "proyecto", id_proyecto)
    return dict(vista, ok=True, perdidas=perdidas)


@router.post("/protocolo/obra/{id_proyecto}/actualizar-plantilla")
def actualizar_plantilla(id_proyecto: str, user=Depends(get_current_user)):
    """Pasa el borrador a la plantilla vigente (se publicó una después de abrirlo). Conserva
    las respuestas que sigan valiendo y dice cuántas se pierden."""
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _obra(cur, id_proyecto)
            _acceso(cur, id_proyecto, user, editar=True)
            p = _protocolo(cur, id_proyecto, bloquear=True)
            vigente = _plantilla(cur, "vigente")
            if not p or not vigente:
                raise HTTPException(status_code=404, detail="La obra no tiene protocolo.")
            if p["estado"] != "borrador":
                raise HTTPException(status_code=409, detail="El protocolo no está en borrador: no se edita.")
            respuestas, perdidas = heredar_respuestas(vigente["contenido"], p["respuestas"])
            cur.execute("""UPDATE protocolos SET plantilla_id = %s, respuestas = %s::jsonb, guardado_por = %s, guardado_el = NOW()
                            WHERE id = %s""", (vigente["id"], json.dumps(respuestas), email, p["id"]))
            vista = _vista_obra(cur, id_proyecto, user)
    audit(email, "protocolo_actualizar_plantilla", f"v{p['version']} a plantilla v{vigente['version']}", "proyecto", id_proyecto)
    return dict(vista, ok=True, perdidas=perdidas)


@router.get("/protocolo/obra/{id_proyecto}/vigente")
def criterios_de_la_obra(id_proyecto: str, en_curso: int = 0, user=Depends(get_current_user)):
    """Los criterios ACORDADOS de la obra, en una lista plana: la última versión cerrada del
    protocolo. Con `en_curso=1`, la última versión en el estado que esté (para probar antes de
    cerrar). Es la lectura que usará ArmaScanner (programa §8.13 fila 8.5)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            obra = _obra(cur, id_proyecto)
            _acceso(cur, id_proyecto, user)
            cur.execute("SELECT version, estado, plantilla_id, respuestas, cerrado_el FROM protocolos "
                        "WHERE id_proyecto = %s ORDER BY version DESC", (id_proyecto,))
            filas = cur.fetchall()
            elegida = next((f for f in filas if en_curso or f[1] == "cerrado"), None)
            contenido = _plantilla_por_id(cur, elegida[2])["contenido"] if elegida else None
    if not elegida:
        return {"obra": obra, "protocolo": None, "criterios": [],
                "en_curso": {"version": filas[0][0], "estado": filas[0][1]} if filas else None}
    return {"obra": obra,
            "protocolo": {"version": elegida[0], "estado": elegida[1], "cerrado_el": _cuando(elegida[4])},
            "criterios": criterios_vigentes(contenido, elegida[3] or {}), "en_curso": None}
