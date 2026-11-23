"""
armascanner_chat.py
-------------------
El chat del cubicador de ArmaScanner (programa 6.19, etapa 1): la IA vive acá, en ArmaHub; la clave
de la API nunca va al equipo. ArmaScanner se autentica con la ficha de su licencia, como el resto de
sus rutas (armascanner.py).

    POST /armascanner/chat            un mensaje del cubicador → texto y, si corresponde, UNA propuesta
    POST /armascanner/chat/resultado  qué pasó con la propuesta en ArmaScanner (aplicada, cancelada o
                                      rechazada porque las barras cambiaron), con cuántas barras

EL CHAT PROPONE Y EL CUBICADOR CONFIRMA. La IA no elige barras ni las cambia: arma un CRITERIO (ids,
rango, losa, ciclo, marca, diámetro, estado, nivel, variable) y la acción, con la herramienta
proponer_accion. Las barras las elige ArmaScanner (revision.seleccionar), siempre igual, con las
mismas funciones y reglas que los botones de la ventana de revisión: nunca aprueba una barra con
duda, un estribo sin figura ni una barra excluida. Al «Aplicar» ArmaScanner recalcula la propuesta
y, si algo cambió, no aplica nada. [Usuario 22-nov: «Lo importante es que el chat tenga
implementadas las funciones que le permitan trabajar bajo nuestro estándar y no hacer cosas
corruptas»]

Acciones: aprobar · quitar_aprobacion · observar (con nota) · quitar_observacion · excluir · incluir
· fabricacion (barras de largo variable: paquetes, cierre, ajuste) · consultar (contar, kilos o
listar: lo calcula ArmaScanner, sin otra llamada a la IA) · crear_barras (una ficha de barra nueva:
lo que el cubicador no dijo lo completan las reglas de la casa en ArmaScanner, crear_barras.py).

ArmaScanner manda un RESUMEN compacto del plano (losas, ciclos, marcas, diámetros, cantidades por
estado) y sólo las barras que el cubicador nombra; nunca todas las barras crudas.

Modelo: el que elige el cubicador en el chat, de MODELOS (ArmaHub valida contra la lista); sin
elegir, el de env ARMASCANNER_CHAT_MODELO (claude-sonnet-5-5). [Usuario 22-nov: selector de modelo]

REGISTRO de cada pedido y su resultado (tabla armascanner_chat, mig 175), para mejora continua e
informes: usuario, obra, plano, modelo, mensaje, respuesta, propuesta, resultado, barras, tokens.
El tope diario por usuario se cuenta en esa tabla (sobrevive a los deploys).

Lecciones del asistente de muros (asistente.py) que se respetan acá: el schema de la herramienta
va SIN `strict` y con `required` mínimo; ningún opcional es anulable (un vacío vale «sin fijar»: ""
en textos, 0 en números, -1 donde el 0 vale); `max_retries` para los errores pasajeros; y el error
de la API se explica en castellano, con el detalle técnico detrás.
"""
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from .armascanner import acceso
from .db import get_conn
from .licencias import _bearer

router = APIRouter()
logger = logging.getLogger("armahub.armascanner_chat")

# Los modelos que el cubicador puede elegir en el chat; el primero es el de siempre.
MODELOS = ("claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5")
MODELO = os.getenv("ARMASCANNER_CHAT_MODELO", MODELOS[0])
# Esfuerzo: «low» — armar un criterio es extracción simple y el chat tiene que contestar rápido.
# Si las propuestas salen mal armadas, subir a «medium».
ESFUERZO = os.getenv("ARMASCANNER_CHAT_ESFUERZO", "low")
# Mensajes por usuario y día (cuenta lo registrado hoy).
TOPE_DIA = int(os.getenv("ARMASCANNER_CHAT_TOPE", "150"))
# Si el modelo rechaza un pedido por sus filtros de seguridad, la API lo reintenta en el modelo que
# corresponda («fallbacks», beta). Haiku no lo tiene. Con «0» se apaga.
FALLBACK = os.getenv("ARMASCANNER_CHAT_FALLBACK", "1") != "0"
SIN_FALLBACK = ("claude-haiku-5-5",)
BETA_FALLBACK = "server-side-fallback-2026-07-01"

ACCIONES = ("aprobar", "quitar_aprobacion", "observar", "quitar_observacion", "excluir", "incluir",
            "fabricacion", "consultar", "crear_barras")
ESTADOS = ("pendiente", "observada", "aprobada", "fuera")
NIVELES = ("duda", "aviso", "ok")
CONSULTAS = ("contar", "kilos", "listar")
LETRAS = "ABCDEF"
RESULTADOS = ("aplicado", "cancelado", "cambio", "error")

# Tiempos: ArmaScanner corta el pedido a los 150 s; el servidor contesta antes, siempre. Un intento a la
# API dura a lo más INTENTO s y hay un reintento (_cliente). La segunda llamada (corregir una propuesta mal
# armada) va sin reintento y sólo si todavía cabe entera en PLAZO; si no, sale el texto con el motivo.
# Peor caso: ~2 × INTENTO (+ la espera del reintento).
INTENTO = 55.0
PLAZO = 110.0

HISTORIAL_MAX = 12       # turnos que viajan a la API (los últimos)
TEXTO_MAX = 2000         # caracteres por turno del historial y del mensaje
RESUMEN_MAX = 12000      # caracteres del resumen del plano
NOMBRADAS_MAX = 40       # barras nombradas por el cubicador que viajan con su detalle


SISTEMA = """Eres el asistente de revisión de ArmaScanner. Ayudas a un cubicador a revisar las barras de refuerzo escaneadas de un plano.

Estándar de trabajo:
- Propones y el cubicador confirma. Nada queda hecho hasta que el cubicador presiona «Aplicar»: nunca digas que algo ya se hizo.
- No eliges barras una por una: armas un criterio (ids, rango desde/hasta, losa, ciclo, marca, diámetro, estado, nivel, variable) y el programa elige las barras.
- No inventas barras, IDs, losas ni datos. Usas sólo el resumen del plano, las barras nombradas y lo que dice el cubicador.
- Una barra con duda, un estribo sin figura o una barra excluida no se aprueban: el programa las deja fuera y lo informa. No intentes forzarlo.
- Aprobar en grupo toma sólo barras pendientes. Una barra observada se aprueba desde su ficha o se le quita la observación.
- Observar deja la barra sin aprobar, con una nota de lo que se consulta al cliente.
- Para contar, sumar kilos o listar barras, usa la acción consultar: la calcula el programa.
- Para crear una barra nueva, llena la ficha sólo con lo que dijo el cubicador y deja vacío lo demás: las reglas de la casa lo completan y lo avisan. El cubicador la ubica en el plano con 2 clics.
- Pregunta sólo lo imprescindible, en una línea. Si el pedido es claro, propone de inmediato con proponer_accion.
- Una propuesta por mensaje.
- Responde en castellano, breve, con lenguaje de software. Unidades: cm; diámetros en mm."""


_CRITERIO = {
    "type": "object",
    "description": "Qué barras. Cada clave filtra y una barra entra si cumple todas. Sin claves: todas las barras.",
    "properties": {
        "ids": {"type": "array", "items": {"type": "string"},
                "description": "IDs de barra como los ve el cubicador: «B-0012» o «12»."},
        "desde": {"type": "integer", "description": "Rango de números de barra, con sus extremos. 0: sin rango."},
        "hasta": {"type": "integer", "description": "Fin del rango. 0: sin rango."},
        "losa": {"type": "array", "items": {"type": "string"}},
        "ciclo": {"type": "array", "items": {"type": "integer"}},
        "marca": {"type": "array", "items": {"type": "string"}, "description": "Fi, Fs, F', ESL…"},
        "diametro": {"type": "array", "items": {"type": "integer"}, "description": "Ø en mm."},
        "estado": {"type": "array", "items": {"type": "string", "enum": list(ESTADOS)},
                   "description": "pendiente = por decidir (ni aprobada, ni observada, ni excluida)."},
        "nivel": {"type": "array", "items": {"type": "string", "enum": list(NIVELES)},
                  "description": "ok = sin duda ni aviso."},
        "variable": {"type": "string", "enum": ["", "si", "no"],
                     "description": "si: sólo las de largo variable; no: sólo las de largo fijo; vacío: todas."},
    },
}

_FICHA = {
    "type": "object",
    "description": "crear_barras: la barra nueva. Lo que el cubicador no dijo va vacío (\"\" o 0).",
    "properties": {
        "marca": {"type": "string", "description": "Tipología: Fi, Fs, F', ESL, TRL…"},
        "figura": {"type": "string", "description": "Código del catálogo (101A, 106A…). Vacío: la de la regla."},
        "diametro": {"type": "integer", "description": "Ø en mm. 0: sin fijar."},
        "lados": {"type": "object", "description": "Lados en cm, por su letra. Sólo los que dijo el cubicador.",
                  "properties": {k: {"type": "number"} for k in LETRAS}},
        "cantidad": {"type": "integer", "description": "Barras puntuales. 0: repartida por espaciamiento."},
        "espaciamiento": {"type": "integer", "description": "cm entre barras de una distribución. 0: sin fijar."},
        "distribucion": {"type": "number", "description": "Largo de la distribución en cm. 0: se marca en el plano."},
        "losa": {"type": "string"},
        "elemento": {"type": "string", "description": "Elemento constructivo, si no es una losa."},
        "ciclo": {"type": "integer", "description": "0: el del lugar donde se marque."},
        "piso": {"type": "string"},
        "sector": {"type": "string"},
        "nota": {"type": "string", "description": "Lo que el cubicador quiera dejar anotado en la barra."},
    },
}

# SIN `strict` y con `required` mínimo (lección del asistente de muros, 31-ago: con strict la API
# compila una gramática con el schema y topa; sin strict, `required` sólo declara lo imprescindible).
TOOL_PROPONER = {
    "name": "proponer_accion",
    "description": ("Propone UNA acción sobre las barras del plano. El programa elige las barras con el criterio, "
                    "aplica las reglas de la ventana de revisión y el cubicador confirma antes de aplicar."),
    "input_schema": {
        "type": "object",
        "properties": {
            "accion": {"type": "string", "enum": list(ACCIONES)},
            "resumen": {"type": "string", "description": "Qué hará, en una línea."},
            "criterio": _CRITERIO,
            "nota": {"type": "string", "description": "observar: lo que se consulta al cliente."},
            "paquete": {"type": "integer",
                        "description": "fabricacion: barras por paquete (2 o más). 0: un largo por barra."},
            "cierre": {"type": "string", "enum": ["", "final", "inicio"],
                       "description": "fabricacion: dónde va la barra de cierre. Vacío: al final."},
            "holgura": {"type": "number",
                        "description": "fabricacion: cm de ajuste además del traslapo. -1: el de la casa."},
            "consulta": {"type": "string", "enum": list(CONSULTAS), "description": "consultar: qué calcular."},
            "ficha": _FICHA,
        },
        "required": ["accion"],
    },
}


# ── la propuesta, revisada ──
def _textos(v, largo=60, maximo=500):
    v = v if isinstance(v, list) else [v] if v not in (None, "") else []
    return [str(x).strip()[:largo] for x in v if str(x).strip()][:maximo]


def _enteros(v, minimo=1, maximo=500):
    v = v if isinstance(v, list) else [v] if v not in (None, "") else []
    out = []
    for x in v:
        try:
            n = int(float(str(x).strip()))
        except ValueError:
            continue
        if n >= minimo:
            out.append(n)
    return out[:maximo]


def _entero(v, defecto=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return defecto


def _numero(v, defecto=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return defecto


def criterio_de(c) -> dict:
    """El criterio de la herramienta como lo usa ArmaScanner (revision.CLAVES): sin las claves vacías
    («sin fijar»), con los valores revisados. Un estado o nivel que no existe es un ValueError."""
    c = c if isinstance(c, dict) else {}
    out = {}
    if _textos(c.get("ids")):
        out["ids"] = _textos(c.get("ids"))
    for k in ("desde", "hasta"):
        if _entero(c.get(k)) > 0:
            out[k] = _entero(c.get(k))
    for k in ("losa", "marca"):
        if _textos(c.get(k)):
            out[k] = _textos(c.get(k))
    for k in ("ciclo", "diametro"):
        if _enteros(c.get(k)):
            out[k] = _enteros(c.get(k))
    for k, validos in (("estado", ESTADOS), ("nivel", NIVELES)):
        v = [x.lower() for x in _textos(c.get(k))]
        malos = [x for x in v if x not in validos]
        if malos:
            raise ValueError(f"criterio «{k}» no admite {', '.join(malos)}")
        if v:
            out[k] = v
    var = str(c.get("variable") or "").strip().lower()
    if var in ("si", "sí", "true"):
        out["variable"] = True
    elif var in ("no", "false"):
        out["variable"] = False
    return out


def ficha_de(f) -> dict:
    """La ficha de una barra nueva, sin lo vacío: lo que el cubicador fijó. Sin marca es un ValueError
    (sin ella no hay regla que sepa qué barra es)."""
    f = f if isinstance(f, dict) else {}
    out = {}
    marca = str(f.get("marca") or "").strip()
    if not marca:
        raise ValueError("la ficha de la barra nueva no trae la marca")
    out["marca"] = marca[:12]
    figura = str(f.get("figura") or "").strip().upper()
    if figura:
        out["figura"] = figura[:8]
    for k in ("diametro", "cantidad", "espaciamiento", "ciclo"):
        if _entero(f.get(k)) > 0:
            out[k] = _entero(f.get(k))
    if _numero(f.get("distribucion")) > 0:
        out["distribucion"] = round(_numero(f.get("distribucion")), 1)
    lados = f.get("lados") if isinstance(f.get("lados"), dict) else {}
    lados = {k.upper(): round(_numero(v), 1) for k, v in lados.items()
             if str(k).upper() in LETRAS and _numero(v) > 0}
    if lados:
        out["lados"] = lados
    for k, largo in (("losa", 30), ("elemento", 40), ("piso", 20), ("sector", 30), ("nota", 300)):
        v = str(f.get(k) or "").strip()
        if v:
            out[k] = v[:largo]
    return out


def propuesta_de(inp) -> dict:
    """La propuesta que la IA armó con proponer_accion, revisada: {accion, resumen, criterio,
    parametros}. Lo que no corresponde (una acción que no existe, observar sin nota, crear sin
    ficha) es un ValueError con el motivo, que vuelve a la IA para que lo corrija."""
    inp = inp if isinstance(inp, dict) else {}
    accion = str(inp.get("accion") or "").strip()
    if accion not in ACCIONES:
        raise ValueError(f"acción «{accion}» desconocida; valen: {', '.join(ACCIONES)}")
    p = {"accion": accion, "resumen": str(inp.get("resumen") or "").strip()[:200], "criterio": {}, "parametros": {}}
    if accion == "crear_barras":
        p["parametros"]["ficha"] = ficha_de(inp.get("ficha"))
        return p
    p["criterio"] = criterio_de(inp.get("criterio"))
    if accion == "observar":
        nota = str(inp.get("nota") or "").strip()
        if not nota:
            raise ValueError("observar sin nota: falta lo que se consulta al cliente")
        p["parametros"]["nota"] = nota[:500]
    elif accion == "fabricacion":
        n = _entero(inp.get("paquete"))
        if n == 1 or n < 0:
            raise ValueError("fabricacion: barras por paquete, 2 o más (0 = un largo por barra)")
        p["parametros"]["paquete"] = n or None
        p["parametros"]["lado"] = "inicio" if str(inp.get("cierre") or "") == "inicio" else None
        h = _numero(inp.get("holgura"), -1.0)
        p["parametros"]["holgura"] = None if h < 0 or not n else h
    elif accion == "consultar":
        q = str(inp.get("consulta") or "contar").strip()
        p["parametros"]["consulta"] = q if q in CONSULTAS else "contar"
    return p


# ── lo que viaja a la API ──
def _compacto(x, maximo):
    t = json.dumps(x, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return t if len(t) <= maximo else t[:maximo] + "…(recortado)"


def mensajes_api(cuerpo) -> list:
    """El historial corto (los últimos turnos, texto plano) y el mensaje del cubicador con el contexto
    del plano: el resumen y las barras nombradas. El contexto va sólo en el último mensaje: cambia en
    cada turno."""
    msgs = []
    for t in (cuerpo.historial or [])[-HISTORIAL_MAX:]:
        if not isinstance(t, dict):
            continue
        texto = str(t.get("texto") or "").strip()[:TEXTO_MAX]
        rol = "assistant" if t.get("rol") == "asistente" else "user"
        if not texto or (not msgs and rol == "assistant"):  # el primero es del cubicador
            continue
        if msgs and msgs[-1]["role"] == rol:
            msgs[-1]["content"] += "\n\n" + texto
        else:
            msgs.append({"role": rol, "content": texto})
    contexto = [f"Plano: {cuerpo.plano or '?'} · Obra: {cuerpo.obra or '?'}",
                "Resumen del plano: " + _compacto(cuerpo.resumen or {}, RESUMEN_MAX)]
    if cuerpo.barras:
        contexto.append("Barras nombradas: " + _compacto(list(cuerpo.barras)[:NOMBRADAS_MAX], RESUMEN_MAX))
    pedido = "\n".join(contexto) + "\n\nPedido del cubicador: " + (cuerpo.mensaje or "").strip()[:TEXTO_MAX]
    if msgs and msgs[-1]["role"] == "user":
        msgs[-1]["content"] += "\n\n" + pedido
    else:
        msgs.append({"role": "user", "content": pedido})
    return msgs


def extraer(resp):
    """(texto, entrada de proponer_accion o None, ids de los tool_use) de una respuesta."""
    textos, entrada, ids = [], None, []
    for b in getattr(resp, "content", None) or []:
        tipo = getattr(b, "type", "")
        if tipo == "text" and getattr(b, "text", ""):
            textos.append(b.text)
        elif tipo == "tool_use":
            ids.append(b.id)
            if b.name == TOOL_PROPONER["name"] and entrada is None:  # una propuesta por mensaje
                entrada = b.input
    return "\n".join(textos).strip(), entrada, ids


def tokens(resp) -> tuple:
    """(entrada, salida) de una respuesta: la entrada incluye lo leído y lo escrito en caché."""
    u = getattr(resp, "usage", None)
    if u is None:
        return 0, 0
    entrada = sum(int(getattr(u, k, 0) or 0) for k in ("input_tokens", "cache_read_input_tokens",
                                                        "cache_creation_input_tokens"))
    return entrada, int(getattr(u, "output_tokens", 0) or 0)


# ── errores en castellano: qué pasó y qué hacer; el detalle técnico, detrás ──
_EXPLICACIONES = [
    ("credit", "La cuenta de la API se quedó sin crédito. Avisa al administrador."),
    ("billing", "Hay un problema de facturación en la cuenta de la API. Avisa al administrador."),
    ("fallback", "El servidor pidió a la API una opción que no aceptó (fallbacks). Avisa al administrador."),
    ("rate limit", "Se hicieron muchas consultas seguidas. Espera unos segundos y reenvía."),
    ("overloaded", "La API está saturada en este momento. Espera unos segundos y reenvía."),
    ("authentication", "La clave de la API no es válida o falta. Avisa al administrador."),
    ("permission", "La clave de la API no tiene permiso para este modelo. Elige otro modelo o avisa al administrador."),
    ("not_found", "El modelo elegido no existe o cambió de nombre. Elige otro modelo."),
    ("context", "La conversación quedó demasiado larga. Usa «Nueva conversación»."),
]


def explicar_error(status: int, texto: str) -> str:
    """Una línea en castellano que dice qué pasó y qué hacer, y el detalle técnico detrás."""
    t = (texto or "").lower()
    simple = next((e for clave, e in _EXPLICACIONES if clave in t), None)
    if simple is None:
        simple = ("La API tuvo un problema pasajero y los reintentos no pasaron. Reenvía en unos segundos."
                  if status >= 500 else "El pedido a la API no fue válido. Es un problema del programa."
                  if status == 400 else "El chat no pudo responder por un problema técnico.")
    tec = (texto or "").strip().replace("\n", " ")[:300]
    return simple + ("  ·  Detalle técnico: " + tec if tec else "")


# ── el registro ──
def _hoy():
    """Las 00:00 de hoy en Chile (dicho en UTC): desde ahí cuenta el tope del día. Con el día UTC, el tope
    se reiniciaba a las 21:00 de Chile."""
    from zoneinfo import ZoneInfo
    return (datetime.now(ZoneInfo("America/Santiago")).replace(hour=0, minute=0, second=0, microsecond=0)
            .astimezone(timezone.utc))


def _tope(cur, email):
    cur.execute("SELECT COUNT(*) FROM armascanner_chat WHERE usuario = %s AND creado_el >= %s", (email, _hoy()))
    if (cur.fetchone() or (0,))[0] >= TOPE_DIA:
        raise HTTPException(status_code=429, detail=f"Se alcanzó el tope diario del chat ({TOPE_DIA} mensajes). "
                                                    "Vuelve mañana o avisa al administrador.")


def _registrar(email, cuerpo, modelo, respuesta, propuesta, te, ts, error=None):
    """Una fila por pedido. Devuelve su id (el que ArmaScanner manda con el resultado)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO armascanner_chat (usuario, obra, plano, modelo, mensaje, respuesta, propuesta,
                                                         accion, tokens_entrada, tokens_salida, error, version_app)
                           VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s) RETURNING id""",
                        (email, cuerpo.obra[:120], cuerpo.plano[:200], modelo, (cuerpo.mensaje or "")[:4000],
                         (respuesta or "")[:8000], json.dumps(propuesta, ensure_ascii=False) if propuesta else None,
                         propuesta["accion"] if propuesta else None, te, ts, (error or "")[:1000] or None,
                         (cuerpo.version_app or "")[:40]))
            return cur.fetchone()[0]


def _cliente():
    """El cliente de la API: INTENTO segundos por intento y un reintento (max_retries=1): los 429/500/529
    son pasajeros y el SDK los reintenta con espera (lección del 31-ago en el asistente de muros). Una
    llamada tarda a lo más ~2 × INTENTO. Las pruebas lo reemplazan por uno falso: nunca llaman a la API
    real."""
    import anthropic
    return anthropic.Anthropic(timeout=INTENTO, max_retries=1)


def llamar(cliente, modelo, msgs):
    """Un pedido a la API con el sistema y la herramienta. Sin `thinking` (los tres modelos piensan
    solos, adaptativo) y con tool_choice auto: los modelos actuales no aceptan forzar la herramienta.
    Con fallbacks (beta) en los que lo tienen."""
    kw = dict(model=modelo, max_tokens=4000, output_config={"effort": ESFUERZO},
              system=[{"type": "text", "text": SISTEMA, "cache_control": {"type": "ephemeral"}}],
              tools=[TOOL_PROPONER], tool_choice={"type": "auto"}, messages=msgs)
    if FALLBACK and modelo not in SIN_FALLBACK:
        return cliente.beta.messages.create(betas=[BETA_FALLBACK], extra_body={"fallbacks": "default"}, **kw)
    return cliente.messages.create(**kw)


class ChatBody(BaseModel):
    modelo: str = ""
    mensaje: str
    historial: List[dict] = []
    obra: str = ""
    plano: str = ""
    resumen: dict = {}
    barras: List[dict] = []
    version_app: str = ""


@router.post("/armascanner/chat")
def chat(cuerpo: ChatBody, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Un mensaje del cubicador. Devuelve {id, texto, propuesta (o null), modelo}. La propuesta que
    llega mal armada vuelve UNA vez a la IA con el motivo, si cabe en el plazo (PLAZO); si vuelve a
    fallar, o no cabe, sólo texto con el motivo."""
    if not (cuerpo.mensaje or "").strip():
        raise HTTPException(status_code=400, detail="Escribe un mensaje.")
    modelo = (cuerpo.modelo or MODELO).strip()
    if modelo not in MODELOS:
        raise HTTPException(status_code=400, detail=f"Modelo «{modelo}» no disponible. Valen: {', '.join(MODELOS)}.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            email = acceso._usuario(cur, credentials.credentials)["email"]
            _tope(cur, email)
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503, detail="El chat no está configurado en el servidor (falta la clave de la "
                                                    "API). Avisa al administrador.")
    try:
        import anthropic
    except ImportError:
        raise HTTPException(status_code=503, detail="El chat no está instalado en el servidor (falta la librería). "
                                                    "Avisa al administrador.")

    msgs = mensajes_api(cuerpo)
    te = ts = 0
    inicio = time.monotonic()
    try:
        cliente = _cliente()
        resp = llamar(cliente, modelo, msgs)
        e1, s1 = tokens(resp)
        te, ts = te + e1, ts + s1
        texto, entrada, ids = extraer(resp)
        propuesta, motivo = None, None
        if getattr(resp, "stop_reason", None) == "refusal":
            texto = "El modelo no respondió este pedido (lo frenaron sus filtros de seguridad). Reformúlalo o elige " \
                    "otro modelo."
        elif entrada is not None:
            try:
                propuesta = propuesta_de(entrada)
            except ValueError as e:
                motivo = str(e)
            # UNA corrección con el motivo, si cabe en el plazo; la API pide respuesta a cada tool_use
            if motivo and ids and time.monotonic() - inicio + INTENTO <= PLAZO:
                resp = llamar(cliente.with_options(max_retries=0), modelo, msgs + [
                    {"role": "assistant", "content": resp.content},
                    {"role": "user", "content": [{"type": "tool_result", "tool_use_id": t, "is_error": True,
                                                  "content": f"Propuesta no válida: {motivo}. Corrígela y llama "
                                                             "proponer_accion de nuevo."} for t in ids]}])
                e2, s2 = tokens(resp)
                te, ts = te + e2, ts + s2
                texto2, entrada, _ = extraer(resp)
                texto = texto2 or texto
                propuesta = None
                if entrada is not None:
                    try:
                        propuesta, motivo = propuesta_de(entrada), None
                    except ValueError as e:
                        motivo = str(e)
        if getattr(resp, "stop_reason", None) == "max_tokens":
            texto = (texto + "\n\n(La respuesta se cortó por largo.)").strip()
        if motivo:
            texto = (texto + f"\n\n(La propuesta venía incompleta: {motivo}.)").strip()
        if not texto and propuesta:
            texto = propuesta["resumen"] or "Propuesta lista para revisar."
        if not texto:
            texto = "Sin respuesta. Reformula el pedido."
    except anthropic.APITimeoutError as e:  # antes que APIConnectionError: es una subclase
        detalle = "La API tardó demasiado en responder. Reenvía el mensaje.  ·  Detalle técnico: " + str(e)[:200]
        _registrar(email, cuerpo, modelo, None, None, te, ts, detalle)
        raise HTTPException(status_code=504, detail=detalle)
    except anthropic.APIConnectionError as e:
        detalle = ("No se pudo conectar con la API (red del servidor). Reenvía en unos segundos.  ·  Detalle técnico: "
                   + str(e)[:200])
        _registrar(email, cuerpo, modelo, None, None, te, ts, detalle)
        raise HTTPException(status_code=502, detail=detalle)
    except anthropic.APIStatusError as e:
        status = getattr(e, "status_code", 0) or 0
        detalle = explicar_error(status, str(getattr(e, "message", None) or e))
        logger.error("chat: error de la API (%s, %s): %s", email, modelo, e)
        _registrar(email, cuerpo, modelo, None, None, te, ts, detalle)
        raise HTTPException(status_code=402 if "crédito" in detalle or "facturación" in detalle else 502, detail=detalle)

    rid = _registrar(email, cuerpo, modelo, texto, propuesta, te, ts, motivo)
    return {"id": rid, "texto": texto, "propuesta": propuesta, "modelo": modelo}


class ResultadoBody(BaseModel):
    id: int
    resultado: str
    barras: int = 0
    kg: float = 0.0
    detalle: str = ""


@router.post("/armascanner/chat/resultado")
def chat_resultado(cuerpo: ResultadoBody, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Qué pasó con la propuesta en ArmaScanner: «aplicado», «cancelado», «cambio» (no se aplicó
    porque las barras cambiaron desde que se mostró; se mostró la nueva) o «error». Puede llegar más
    de uno por pedido (cambió, se mostró la nueva y se aplicó): manda el último y quedan todos en
    `eventos`. Sólo el autor del pedido."""
    if cuerpo.resultado not in RESULTADOS:
        raise HTTPException(status_code=400, detail=f"Resultado «{cuerpo.resultado}» desconocido.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            email = acceso._usuario(cur, credentials.credentials)["email"]
            cur.execute("SELECT eventos FROM armascanner_chat WHERE id = %s AND usuario = %s", (cuerpo.id, email))
            fila = cur.fetchone()
            if not fila:
                raise HTTPException(status_code=404, detail="Ese pedido del chat no existe.")
            eventos = fila[0] if isinstance(fila[0], list) else json.loads(fila[0]) if fila[0] else []
            eventos.append({"resultado": cuerpo.resultado, "barras": max(0, cuerpo.barras),
                            "kg": round(max(0.0, cuerpo.kg), 1), "detalle": cuerpo.detalle[:300],
                            "el": datetime.now(timezone.utc).isoformat(timespec="seconds")})
            cur.execute("""UPDATE armascanner_chat SET resultado = %s, barras = %s, kg = %s, resultado_detalle = %s,
                                  eventos = %s::jsonb, resultado_el = NOW()
                            WHERE id = %s""",
                        (cuerpo.resultado, max(0, cuerpo.barras), round(max(0.0, cuerpo.kg), 1),
                         cuerpo.detalle[:300] or None, json.dumps(eventos, ensure_ascii=False), cuerpo.id))
    return {"ok": True}

