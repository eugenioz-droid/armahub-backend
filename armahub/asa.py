"""
CLIENTE DE LA API DE aSa STUDIO (28-sep).

QUÉ ES. aSa expone una API OData en `/api/public/`. El usuario ya la consume desde Power BI
—de ahí salen sus dashboards—; esto es la misma consulta, hecha desde el backend.

DOS DECISIONES QUE EXPLICAN EL CÓDIGO:

1. **Sin dependencias nuevas.** Se usa `urllib` de la biblioteca estándar. Es un GET con una
   cabecera: no justifica sumar `requests` al build de Render.

2. **La forma de autenticarse es CONFIGURABLE, no está escrita en el código.** Todavía no
   sabemos si la clave viaja en una cabecera, en la query o como Basic — el usuario la tiene
   en el almacén de credenciales de Power BI. En vez de adivinar y tener que recompilar, el
   modo es una variable de entorno: cuando se confirme, se cambia la variable y listo.

LA CLAVE NUNCA SE LOGUEA NI SE DEVUELVE. `estado()` dice si está configurada, no cuál es.
Y ArmaHub SÓLO LEE: este módulo hace GET y nada más. Los endpoints `create*`/`update*` de
aSa existen pero no se llaman nunca.

Catálogo de endpoints y campos: docs/asa_campos.md
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

log = logging.getLogger("armahub.asa")

# ── No ahogar a aSa ────────────────────────────────────────────────────────────
# El usuario reporta (28-sep) que traer un OrderSummary COMPLETO desde Power BI a veces
# "se queda pegado" y hay que repetir hasta que salga. O sea: aSa aguanta consultas
# chicas y se atora con las grandes. Eso fija tres reglas, y no son negociables:
#
#   1. Páginas chicas (200), no 500 ni 5000.
#   2. Una pausa entre páginas: la sincronización no tiene apuro, nadie la está mirando.
#   3. Un solo reintento, y sólo cuando se atoró (timeout / 5xx). Un 4xx jamás se
#      reintenta: eso es culpa nuestra y repetirlo sólo molesta.
#
# Y una regla de diseño que vale más que las tres: NUNCA se trae getOrderSummary completo.
# Para las obras se usa getJobData, que es una fila por obra.
TOP_POR_PAGINA = 200
MAX_TOP = 2000
PAUSA_ENTRE_PAGINAS = 0.6      # segundos
REINTENTOS = 1
ESPERA_REINTENTO = 3.0         # segundos


class AsaError(Exception):
    """Falla al hablar con aSa. El mensaje es apto para mostrarle al usuario: nunca lleva
    la clave ni el detalle interno."""


def _cfg(nombre: str, por_defecto: str = "", vacio_vale: bool = False) -> str:
    """Lee una variable de entorno.

    `vacio_vale` distingue "no definida" de "definida y vacía", que para el prefijo de la
    cabecera son cosas OPUESTAS: no definirla significa "usa Bearer", y definirla vacía
    significa "la clave va sola" (el caso de `x-api-key: <clave>`, que es de los más
    comunes). Sin esta distinción, quien escriba `ASA_AUTH_PREFIX=` recibiría igual un
    "Bearer " pegado adelante y un 401 que no se explica mirando la configuración.
    """
    crudo = os.getenv(nombre)
    if crudo is None or (not crudo.strip() and not vacio_vale):
        return por_defecto.strip()
    return crudo.strip()


def configurado() -> bool:
    return bool(_cfg("ASA_API_URL") and _cfg("ASA_API_KEY"))


def _base() -> str:
    url = _cfg("ASA_API_URL")
    if not url:
        raise AsaError("aSa no está configurado: falta la variable ASA_API_URL.")
    return url.rstrip("/")


def _timeout() -> float:
    try:
        return float(_cfg("ASA_TIMEOUT", "20"))
    except ValueError:
        return 20.0


def _armar_url(endpoint: str, opciones: Dict[str, Any]) -> str:
    """Construye la URL OData. Los valores se codifican con quote_plus salvo el $filter,
    donde los espacios y comillas son parte de la sintaxis y basta con quote."""
    partes = []
    for clave, valor in opciones.items():
        if valor in (None, "", []):
            continue
        if isinstance(valor, (list, tuple)):
            valor = ",".join(str(v) for v in valor)
        partes.append("%s=%s" % (clave, urllib.parse.quote(str(valor), safe="',()=/*")))
    qs = "&".join(partes)
    return "%s/%s%s" % (_base(), endpoint.lstrip("/"), ("?" + qs) if qs else "")


def _aplicar_auth(url: str, headers: Dict[str, str]) -> str:
    """Mete la credencial donde corresponda según ASA_AUTH_MODE. Devuelve la URL (que puede
    cambiar si el modo es 'query') y muta `headers`."""
    key = _cfg("ASA_API_KEY")
    if not key:
        raise AsaError("aSa no está configurado: falta la variable ASA_API_KEY.")
    modo = _cfg("ASA_AUTH_MODE", "header").lower()

    if modo == "query":
        sep = "&" if "?" in url else "?"
        param = _cfg("ASA_AUTH_PARAM", "apikey")
        return url + sep + urllib.parse.urlencode({param: key})

    if modo == "basic":
        usuario = _cfg("ASA_API_USER")
        cruda = ("%s:%s" % (usuario, key)).encode("utf-8")
        headers["Authorization"] = "Basic " + base64.b64encode(cruda).decode("ascii")
        return url

    # modo 'header' (por defecto): nombre y prefijo configurables.
    #   Authorization: Bearer xxx   → ASA_AUTH_HEADER=Authorization  ASA_AUTH_PREFIX=Bearer
    #   x-api-key: xxx              → ASA_AUTH_HEADER=x-api-key      ASA_AUTH_PREFIX=
    #
    # El espacio que separa el prefijo de la clave lo pone el código, NO la variable. Si
    # dependiera de que alguien escriba "Bearer " con el espacio al final, se perdería:
    # todo lector de variables de entorno recorta los extremos (el .env local y Render
    # también). Sería un 401 imposible de diagnosticar mirando la configuración.
    prefijo = _cfg("ASA_AUTH_PREFIX", "Bearer", vacio_vale=True)
    if prefijo and not prefijo.endswith(" "):
        prefijo += " "
    headers[_cfg("ASA_AUTH_HEADER", "Authorization") or "Authorization"] = prefijo + key
    return url


def _pedir(url: str, intento: int = 0) -> Any:
    headers = {"Accept": "application/json", "User-Agent": "ArmaHub/1.0 (+programacion)"}
    url_con_auth = _aplicar_auth(url, headers)
    req = urllib.request.Request(url_con_auth, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=_timeout()) as resp:
            crudo = resp.read()
    except urllib.error.HTTPError as e:
        cuerpo = ""
        try:
            cuerpo = e.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        log.error("aSa HTTP %s en %s — %s", e.code, _sin_clave(url), cuerpo)
        # Un 4xx NO se reintenta: es problema nuestro (clave, permiso, endpoint mal escrito).
        # Repetirlo sólo molesta a aSa y nunca va a funcionar.
        if e.code in (401, 403):
            raise AsaError("aSa rechazó la credencial (HTTP %s). Revisa ASA_API_KEY y "
                           "ASA_AUTH_MODE." % e.code)
        if e.code == 404:
            raise AsaError("aSa no conoce ese endpoint (HTTP 404). Revisa el nombre.")
        if e.code == 429:
            raise AsaError("aSa pidió que bajemos el ritmo (HTTP 429). Se corta acá.")
        if 500 <= e.code < 600 and intento < REINTENTOS:
            return _reintentar(url, intento, "HTTP %s" % e.code)
        raise AsaError("aSa respondió HTTP %s." % e.code)
    except urllib.error.URLError as e:
        # Aquí cae el timeout — el "se quedó pegado" que el usuario ve en BI. Éste SÍ se
        # reintenta una vez, porque en su experiencia repetir funciona.
        if intento < REINTENTOS:
            return _reintentar(url, intento, str(e.reason))
        log.error("aSa inalcanzable en %s — %s", _sin_clave(url), e.reason)
        raise AsaError("No se pudo alcanzar aSa (%s). Puede ser que se haya atorado con "
                       "la consulta, o que no acepte conexiones desde este servidor." % e.reason)
    except Exception as e:
        log.error("aSa error inesperado: %s", e)
        raise AsaError("Error inesperado hablando con aSa.")

    try:
        return json.loads(crudo.decode("utf-8", "replace"))
    except Exception:
        raise AsaError("aSa respondió algo que no es JSON.")


def _reintentar(url: str, intento: int, motivo: str) -> Any:
    log.warning("aSa se atoró (%s) en %s — reintento %d de %d en %.0fs",
                motivo, _sin_clave(url), intento + 1, REINTENTOS, ESPERA_REINTENTO)
    time.sleep(ESPERA_REINTENTO)
    return _pedir(url, intento + 1)


_RE_CREDENCIAL = re.compile(r"(?i)\b(apikey|api_key|key|token|password)=[^&]*")


def _sin_clave(url: str) -> str:
    """Para el log: borra cualquier parámetro que huela a credencial. El log se lee en
    Render y en cualquier soporte — la clave no puede aparecer ahí."""
    return _RE_CREDENCIAL.sub(lambda m: m.group(1) + "=***", url)


def _filas(payload: Any) -> List[dict]:
    """OData devuelve {"value": [...]}. Algunos endpoints devuelven la lista pelada."""
    if isinstance(payload, dict):
        for clave in ("value", "Value", "data", "items"):
            if isinstance(payload.get(clave), list):
                return payload[clave]
        return [payload]
    return payload if isinstance(payload, list) else []


def consultar(endpoint: str, select: Optional[List[str]] = None,
              filtro: Optional[str] = None, top: int = TOP_POR_PAGINA,
              skip: int = 0, orderby: Optional[str] = None) -> List[dict]:
    """Una página de un endpoint. `top` queda acotado a MAX_TOP pase lo que pase."""
    top = max(1, min(int(top or TOP_POR_PAGINA), MAX_TOP))
    url = _armar_url(endpoint, {
        "$select": select, "$filter": filtro, "$top": top,
        "$skip": skip or None, "$orderby": orderby,
    })
    return _filas(_pedir(url))


def consultar_todo(endpoint: str, select: Optional[List[str]] = None,
                   filtro: Optional[str] = None, orderby: Optional[str] = None,
                   maximo: int = MAX_TOP) -> List[dict]:
    """Pagina hasta agotar el endpoint o llegar a `maximo`. El tope no es decorativo: sin él,
    un endpoint grande llenaría la memoria del worker."""
    acumulado: List[dict] = []
    skip = 0
    while len(acumulado) < maximo:
        if skip:
            time.sleep(PAUSA_ENTRE_PAGINAS)   # la sincronización no tiene apuro
        pagina = consultar(endpoint, select=select, filtro=filtro,
                           top=min(TOP_POR_PAGINA, maximo - len(acumulado)),
                           skip=skip, orderby=orderby)
        if not pagina:
            break
        acumulado.extend(pagina)
        if len(pagina) < TOP_POR_PAGINA:
            break
        skip += len(pagina)
    if len(acumulado) >= maximo:
        log.warning("aSa: %s llegó al tope de %d filas; se corta ahí a propósito.",
                    endpoint, maximo)
    return acumulado


# ---------------------------------------------------------------------------
# Diagnóstico y descubrimiento
# ---------------------------------------------------------------------------
# Campos que NO se muestran ni se guardan nunca: son datos de una persona. El descubridor
# enmascara sus VALORES (el nombre del campo sí se ve, para saber que existe).
_PERSONALES = ("contact", "phone", "email", "fax", "firstname", "lastname", "middlename",
               "addr", "address", "shipto", "postal", "postcode")


def es_personal(campo: str) -> bool:
    c = campo.lower()
    return any(p in c for p in _PERSONALES)


def estado() -> dict:
    """Si aSa está configurado y alcanzable. NO devuelve la clave, sólo si existe."""
    if not configurado():
        faltan = [v for v in ("ASA_API_URL", "ASA_API_KEY") if not _cfg(v)]
        return {"configurado": False, "ok": False, "faltan": faltan,
                "detalle": "Falta configurar: " + ", ".join(faltan)}
    info = {
        "configurado": True,
        "url": _base(),
        "modo_auth": _cfg("ASA_AUTH_MODE", "header"),
        "timeout": _timeout(),
    }
    endpoint = _cfg("ASA_PING_ENDPOINT", "getScheduling")
    try:
        filas = consultar(endpoint, select=["CtrlCode"], top=1)
        info.update({"ok": True, "detalle": "Conexión OK (%s devolvió %d fila)."
                                            % (endpoint, len(filas))})
    except AsaError as e:
        info.update({"ok": False, "detalle": str(e)})
    return info


def explorar(endpoint: str, top: int = 3) -> dict:
    """Devuelve los CAMPOS de un endpoint (nombre, tipo y un valor de muestra) para poder
    documentarlo sin tener que pedirle a nadie que copie la documentación a mano.

    Los valores de campos personales van enmascarados: para saber que el campo existe no
    hace falta ver el teléfono de nadie.
    """
    filas = consultar(endpoint, top=max(1, min(int(top or 3), 5)))
    campos: Dict[str, dict] = {}
    for fila in filas:
        if not isinstance(fila, dict):
            continue
        for nombre, valor in fila.items():
            if nombre in campos and campos[nombre]["muestra"] not in (None, ""):
                continue
            oculto = es_personal(nombre)
            muestra = "···" if (oculto and valor not in (None, "")) else valor
            if isinstance(muestra, str) and len(muestra) > 60:
                muestra = muestra[:60] + "…"
            campos[nombre] = {"tipo": type(valor).__name__, "muestra": muestra,
                              "personal": oculto}
    return {"endpoint": endpoint, "filas": len(filas), "campos": campos}
