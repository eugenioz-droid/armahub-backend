"""
asistente.py — ASISTENTE IA DE ENFIERRADO (SPECS_ARMAHUB.md §12) · Fase F1.

Chat del Template Editor que arma la RECETA de un muro conversando. El modelo
NUNCA genera geometría (§12.2.1): llena una ficha simple de muro (tool use
forzado por schema) y ESTE módulo construye la receta determinísticamente con
el patrón canónico verificado por tests/test_muro_orientaciones.js (d).

  POST /asistente/chat
    body:  { historial: [{rol:'user'|'asistente', texto}],   ← incluye el último
             receta_actual: dict|null,                          mensaje del usuario
             elemento: 'muro', obra: str|null }
    resp:  { texto, receta|null, resumen: [{seccion,label,valor,origen}]|null }

Decisiones §12 que este archivo implementa:
  · Respuesta EN BLOQUE (opción A, decisión 14) — sin streaming.
  · Historial completo viaja del cliente en cada POST (sin tabla en BD).
  · La salida pasa por modelador._validar_receta; si falla, UN reintento con el
    error como feedback; si vuelve a fallar, texto sin receta.
  · Unidades: cm / φ mm — fijadas en el system prompt.
  · Permiso: el MISMO del Template Editor (_check_permiso_templates).
  · Sin crédito → mensaje claro «avisa al administrador» (decisión 9).
  · Modelo: Sonnet (decisión 12) — override con env ASISTENTE_MODEL.
  · Conocimiento (§12.8 capa 1): armahub/data/conocimiento_asistente.md,
    catalogado por elemento; se inyecta GENERAL + la sección del elemento.

La API key vive en env ANTHROPIC_API_KEY (Render); el navegador nunca habla
directo con Anthropic. `import anthropic` es LAZY: si la librería falta, la app
arranca igual y el endpoint contesta 503 con el motivo.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import date
import os, json, logging

from .db import get_conn
from .auth import get_current_user

log = logging.getLogger("armahub")
router = APIRouter()

ASISTENTE_MODEL = os.getenv("ASISTENTE_MODEL", "claude-sonnet-5")

# Freno de loops (auditoría 30-ago): tope simple de llamadas por usuario y día.
# En memoria a propósito — el daño real lo acota el tope de crédito de la cuenta;
# esto solo corta un frontend con un bucle pegado. Se reinicia con cada deploy.
_MAX_LLAMADAS_DIA = 200
_llamadas: dict = {}


# ---------------------------------------------------------------------------
# CONOCIMIENTO (§12.8 capa 1) — data editable, catalogada por elemento
# ---------------------------------------------------------------------------
_CONOCIMIENTO_PATH = os.path.join(os.path.dirname(__file__), "data",
                                  "conocimiento_asistente.md")


def _conocimiento(elemento: str) -> str:
    """Sección GENERAL + la del elemento. Si el archivo falta, string vacío
    (el asistente funciona igual, solo menos afinado)."""
    try:
        with open(_CONOCIMIENTO_PATH, encoding="utf-8") as f:
            texto = f.read()
    except OSError:
        return ""
    partes, quedarse = [], False
    for linea in texto.splitlines():
        if linea.startswith("## "):
            quedarse = linea[3:].strip().upper() in ("GENERAL", elemento.upper())
        if quedarse:
            partes.append(linea)
    return "\n".join(partes)


# ---------------------------------------------------------------------------
# FICHA DE MURO — lo ÚNICO que el modelo llena (tool use con schema estricto).
# Campos simples de dominio; la receta la arma _construir_receta_muro abajo.
# ---------------------------------------------------------------------------
_ORIGENES = ["leido", "config", "asumido"]

TOOL_MURO = {
    "name": "proponer_muro",
    "description": (
        "Propone la ficha completa de un muro cuando ya tienes TODOS los datos "
        "críticos (dimensiones, mallas). No la llames si falta un dato crítico: "
        "pregunta primero. Los campos no críticos que asumas, márcalos 'asumido' "
        "en origenes y dilo en tu respuesta."),
    "strict": True,
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["geometria", "malla_vertical", "malla_horizontal",
                     "doble_malla", "trabas", "origenes"],
        "properties": {
            "geometria": {
                "type": "object", "additionalProperties": False,
                "required": ["largo", "alto", "espesor", "recubrimiento"],
                "properties": {
                    "largo": {"type": "number", "description": "cm"},
                    "alto": {"type": "number", "description": "cm"},
                    "espesor": {"type": "number", "description": "cm"},
                    "recubrimiento": {"type": "number", "description": "cm"},
                },
            },
            "malla_vertical": {
                "type": "object", "additionalProperties": False,
                "required": ["diam", "sep"],
                "properties": {
                    "diam": {"type": "number", "description": "φ en mm"},
                    "sep": {"type": "number", "description": "@ en cm"},
                },
            },
            "malla_horizontal": {
                "type": "object", "additionalProperties": False,
                "required": ["diam", "sep"],
                "properties": {
                    "diam": {"type": "number", "description": "φ en mm"},
                    "sep": {"type": "number", "description": "@ en cm"},
                },
            },
            "doble_malla": {"type": "boolean"},
            "trabas": {
                "anyOf": [
                    {"type": "null"},
                    {"type": "object", "additionalProperties": False,
                     "required": ["diam", "sx", "sy"],
                     "properties": {
                         "diam": {"type": "number", "description": "φ en mm"},
                         "sx": {"type": "number", "description": "grilla horizontal cm"},
                         "sy": {"type": "number", "description": "grilla vertical cm"},
                     }},
                ],
            },
            "origenes": {
                "type": "object", "additionalProperties": False,
                "required": ["geometria", "recubrimiento", "malla_vertical",
                             "malla_horizontal", "doble_malla", "trabas"],
                "properties": {k: {"type": "string", "enum": _ORIGENES}
                               for k in ("geometria", "recubrimiento",
                                         "malla_vertical", "malla_horizontal",
                                         "doble_malla", "trabas")},
            },
        },
    },
}


# ---------------------------------------------------------------------------
# CONSTRUCTOR DETERMINÍSTICO ficha → receta (patrón del test canónico de muro)
# ---------------------------------------------------------------------------
def _r1(v):
    return round(float(v), 1)


def _construir_receta_muro(spec: dict) -> dict:
    """Ficha simple → receta {tipo,geometria,componentes[]} con el MISMO patrón
    que tests/test_muro_orientaciones.js (d): mallas MA en modo arreglo (rango +
    cortinas en z) y trabas TM volteadas. Nada del modelo toca geometría."""
    g = spec["geometria"]
    largo, alto = float(g["largo"]), float(g["alto"])
    esp, rec = float(g["espesor"]), float(g["recubrimiento"])
    mv, mh = spec["malla_vertical"], spec["malla_horizontal"]
    doble = bool(spec.get("doble_malla", True))
    n_cort = 2 if doble else 1

    def _malla(m, de_pie):
        phi_cm = float(m["diam"]) / 10.0          # φ mm → cm
        z = esp / 2.0 - rec - phi_cm / 2.0        # eje de la cortina
        medio = (largo if de_pie else alto) / 2.0 - rec - phi_cm / 2.0
        comp = {
            "comp_id": "MV" if de_pie else "MH",
            "tipologia": "MA", "figura": "101A",
            "diam": float(m["diam"]), "cara": "lateral", "jerarquia": 1,
            "dims": {"A": {"modo": "auto"}},
            "distribucion": {
                "modo": "arreglo",
                "n_capas": n_cort,
                "sep_capas": _r1(2 * z) if doble else 0,
                "eje_capas": "z",
                "rango": {"eje": "x" if de_pie else "y",
                          "from": _r1(-medio), "to": _r1(medio),
                          "sep": _r1(m["sep"])},
            },
        }
        if de_pie:
            comp["plano_pieza"] = {"orientacion": "de_pie"}
        return comp

    componentes = [_malla(mh, False), _malla(mv, True)]

    tr = spec.get("trabas")
    if doble and tr:
        sy = float(tr["sy"])
        filas = max(1, int((alto - 2 * rec) // sy) + 1) if sy > 0 else 1
        tx = largo / 2.0 - rec
        componentes.append({
            "comp_id": "TM", "tipologia": "TM", "figura": "101A",
            "diam": float(tr["diam"]), "cara": "lateral", "jerarquia": 2,
            "plano_pieza": {"volteado": True},
            "dims": {"A": {"modo": "auto"}},
            "distribucion": {
                "modo": "arreglo",
                "n_capas": filas, "sep_capas": _r1(sy), "eje_capas": "y",
                "rango": {"eje": "x", "from": _r1(-tx), "to": _r1(tx),
                          "sep": _r1(tr["sx"])},
            },
        })

    return {
        "tipo": "muro",
        "geometria": {"largo": _r1(largo), "alto": _r1(alto), "ancho": _r1(esp),
                      "recub_sup": _r1(rec), "recub_inf": _r1(rec),
                      "recub_lat": _r1(rec)},
        "componentes": componentes,
    }


_ORIGEN_LBL = {"leido": "leído", "config": "config", "asumido": "asumido"}


def _resumen_de_spec(spec: dict) -> list:
    """Filas del formulario del chat (§12.3), con su chip de origen."""
    g, o = spec["geometria"], spec.get("origenes", {})

    def org(k):
        return o.get(k) if o.get(k) in _ORIGENES else "asumido"

    filas = [
        {"seccion": "Hormigón (muro)"},
        {"label": "Largo × Alto",
         "valor": f"{g['largo']:g} × {g['alto']:g} cm", "origen": org("geometria")},
        {"label": "Espesor", "valor": f"{g['espesor']:g} cm", "origen": org("geometria")},
        {"label": "Recubrimiento", "valor": f"{g['recubrimiento']:g} cm",
         "origen": org("recubrimiento")},
        {"seccion": "Barras"},
        {"label": "Malla vertical",
         "valor": f"φ{spec['malla_vertical']['diam']:g} @ {spec['malla_vertical']['sep']:g}",
         "origen": org("malla_vertical")},
        {"label": "Malla horizontal",
         "valor": f"φ{spec['malla_horizontal']['diam']:g} @ {spec['malla_horizontal']['sep']:g}",
         "origen": org("malla_horizontal")},
        {"label": "Mallas", "valor": "doble" if spec.get("doble_malla", True) else "simple",
         "origen": org("doble_malla")},
    ]
    tr = spec.get("trabas")
    filas.append({"label": "Trabas",
                  "valor": (f"φ{tr['diam']:g} · {tr['sx']:g} × {tr['sy']:g}" if tr
                            else "sin trabas"),
                  "origen": org("trabas")})
    return filas


# ---------------------------------------------------------------------------
# PROMPT
# ---------------------------------------------------------------------------
def _system_prompt(elemento: str) -> str:
    return (
        "Eres el Asistente de Enfierrado de ArmaHub: un copiloto para cubicadores "
        "chilenos que arma MUROS de hormigón armado conversando. Tu único trabajo "
        "es completar la ficha del muro (herramienta proponer_muro); un motor "
        "geométrico de la plataforma convierte esa ficha en barras — tú NUNCA "
        "calculas geometría ni largos.\n\n"
        "REGLAS:\n"
        "· Unidades: dimensiones y separaciones en CENTÍMETROS, diámetros (φ) en "
        "MILÍMETROS. Convierte si el usuario habla en metros o mm.\n"
        "· JAMÁS inventes un diámetro, separación o dimensión. Si falta un dato "
        "crítico (dimensiones del muro o alguna malla), PREGUNTA — corto y de a "
        "una o dos preguntas. Lo secundario (recubrimiento, trabas) puedes "
        "asumirlo con el valor típico, marcándolo 'asumido' y diciéndolo.\n"
        "· Cuando tengas los datos críticos, llama proponer_muro. En origenes "
        "marca cada campo: 'leido' (lo dijo el usuario), 'config' (default de la "
        "plataforma), 'asumido' (lo pusiste tú).\n"
        "· Si el usuario pide cambiar algo sobre una receta ya propuesta, vuelve "
        "a llamar proponer_muro con la ficha completa corregida.\n"
        "· Por ahora SOLO muros. Si piden otro elemento, dilo amable: viga y "
        "columna vienen después.\n"
        "· ALCANCE ACTUAL DE LA FICHA: mallas + trabas. El confinamiento de "
        "borde (cabezales y estribos de punta) TODAVÍA no entra en la ficha: si "
        "el muro trae, dilo claro y simple («los bordes por ahora agrégalos a "
        "mano en el editor; pronto los voy a poder armar yo») y propone IGUAL la "
        "receta con las mallas y trabas — que el usuario avance. No te enredes "
        "explicando limitaciones técnicas internas de la plataforma.\n"
        "· Responde en español chileno neutro, breve, sin jerga técnica de la "
        "plataforma. Nada de muros de texto.\n\n"
        "DEFAULTS DE LA PLATAFORMA (origen 'config'):\n"
        "· Recubrimiento de muro: 2.5 cm (un solo valor, caras y bordes).\n"
        "· Trabas por defecto: φ8 en grilla 40×40 cm (solo con doble malla).\n"
        "· Doble malla salvo indicación contraria.\n\n"
        + _conocimiento(elemento)
    )


# ---------------------------------------------------------------------------
# ENDPOINT
# ---------------------------------------------------------------------------
class ChatBody(BaseModel):
    historial: List[dict]
    receta_actual: Optional[dict] = None
    elemento: Optional[str] = "muro"
    obra: Optional[str] = None


def _mensajes_api(body: ChatBody) -> list:
    """historial [{rol,texto}] → messages de la API. El último debe ser del
    usuario; la receta actual del editor viaja pegada a ese último turno
    (§12.2.6: el asistente siempre ve lo que hay en pantalla AHORA)."""
    msgs = []
    for h in body.historial:
        rol = "user" if (h.get("rol") == "user") else "assistant"
        texto = str(h.get("texto") or "").strip()
        if not texto:
            continue
        if msgs and msgs[-1]["role"] == rol:          # la API exige alternancia
            msgs[-1]["content"] += "\n" + texto
        else:
            msgs.append({"role": rol, "content": texto})
    if not msgs or msgs[-1]["role"] != "user":
        raise HTTPException(status_code=400,
                            detail="El historial debe terminar con un mensaje del usuario.")
    if body.receta_actual:
        msgs[-1]["content"] += (
            "\n\n[Estado actual del editor — receta que el usuario tiene en "
            "pantalla; si pide modificar, parte de esto]\n"
            + json.dumps(body.receta_actual, ensure_ascii=False))
    return msgs


def _tope_diario(email: str):
    clave = (email, date.today().isoformat())
    n = _llamadas.get(clave, 0) + 1
    _llamadas[clave] = n
    if n > _MAX_LLAMADAS_DIA:
        raise HTTPException(status_code=429,
                            detail="Llegaste al tope diario del asistente. Vuelve mañana o avisa al administrador.")


def _extraer(respuesta):
    """(texto, spec|None) de una respuesta de la API."""
    texto, spec = [], None
    for b in respuesta.content:
        if b.type == "text" and b.text:
            texto.append(b.text)
        elif b.type == "tool_use" and b.name == "proponer_muro":
            spec = b.input
    return "\n".join(texto).strip(), spec


@router.post("/asistente/chat")
def asistente_chat(body: ChatBody, user=Depends(get_current_user)):
    from .modelador import _check_permiso_templates, _validar_receta

    email = user.get("email", "?")
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503,
                            detail="El asistente no está configurado (falta la API key). Avisa al administrador.")
    try:
        import anthropic
    except ImportError:
        raise HTTPException(status_code=503,
                            detail="El asistente no está instalado en el servidor (falta la librería). Avisa al administrador.")

    _tope_diario(email)
    mensajes = _mensajes_api(body)
    elemento = (body.elemento or "muro").strip().lower() or "muro"

    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso_templates(cur, user)

            client = anthropic.Anthropic(timeout=90.0, max_retries=1)

            def _llamar(msgs):
                return client.messages.create(
                    model=ASISTENTE_MODEL,
                    max_tokens=2048,
                    system=_system_prompt(elemento),
                    tools=[TOOL_MURO],
                    tool_choice={"type": "auto"},
                    messages=msgs,
                )

            try:
                resp = _llamar(mensajes)
                texto, spec = _extraer(resp)

                receta = resumen = None
                spec_ok = spec
                if spec is not None:
                    receta = _construir_receta_muro(spec)
                    errores = _validar_receta(cur, receta)
                    if errores:
                        # UN reintento con el error como feedback (§12 decisión 13)
                        tu_id = next(b.id for b in resp.content if b.type == "tool_use")
                        resp2 = _llamar(mensajes + [
                            {"role": "assistant", "content": resp.content},
                            {"role": "user", "content": [{
                                "type": "tool_result", "tool_use_id": tu_id,
                                "is_error": True,
                                "content": "La receta no pasó la validación: "
                                           + " · ".join(errores)
                                           + " Corrige la ficha y llama proponer_muro de nuevo.",
                            }]},
                        ])
                        texto2, spec2 = _extraer(resp2)
                        texto = texto2 or texto
                        if spec2 is not None:
                            spec_ok = spec2
                            receta = _construir_receta_muro(spec2)
                            errores = _validar_receta(cur, receta)
                        if errores:
                            log.warning("asistente: receta inválida tras reintento (%s): %s",
                                        email, errores)
                            receta = None
                            texto = (texto + "\n\n(No pude dejar la receta válida: "
                                     + " · ".join(errores) + ")").strip()
                    if receta is not None:
                        resumen = _resumen_de_spec(spec_ok)

                return {"texto": texto or "…", "receta": receta, "resumen": resumen}

            except anthropic.AuthenticationError:
                raise HTTPException(status_code=503,
                                    detail="El asistente no puede conectarse (API key inválida). Avisa al administrador.")
            except anthropic.RateLimitError:
                raise HTTPException(status_code=503,
                                    detail="El asistente está saturado. Intenta de nuevo en unos segundos.")
            except anthropic.APIStatusError as e:
                if "credit" in str(e).lower() or "billing" in str(e).lower():
                    raise HTTPException(status_code=402,
                                        detail="Asistente sin crédito. Avisa al administrador para recargar.")
                log.error("asistente: error de API (%s): %s", email, e)
                raise HTTPException(status_code=502,
                                    detail="El asistente tuvo un problema al responder. Intenta de nuevo.")
            except anthropic.APIConnectionError:
                raise HTTPException(status_code=502,
                                    detail="Sin conexión con el asistente. Intenta de nuevo.")
