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
    # GENERAL y FIGURAS valen para todos los elementos; el resto de las secciones
    # son del elemento que se esta armando (catalogado por elemento, SPECS 12.8).
    partes, quedarse = [], False
    for linea in texto.splitlines():
        if linea.startswith("## "):
            # Se compara la PRIMERA PALABRA del titulo: los encabezados llevan
            # aclaraciones entre parentesis ("## FIGURAS (codigos del catalogo)")
            # y comparar la linea entera dejaba la seccion fuera del prompt en
            # silencio — que es peor que no tenerla, porque parece cargada.
            titulo = linea[3:].strip().split("(")[0].strip().upper()
            quedarse = titulo in ("GENERAL", "FIGURAS", elemento.upper())
        if quedarse:
            partes.append(linea)
    return "\n".join(partes)


# ---------------------------------------------------------------------------
# FICHA DE MURO — lo ÚNICO que el modelo llena (tool use con schema estricto).
# Campos simples de dominio; la receta la arma _construir_receta_muro abajo.
# ---------------------------------------------------------------------------
_ORIGENES = ["leido", "config", "asumido"]

# Figura y jerarquia SON PARTE DE LA FICHA (feedback del usuario 31-ago: le pidio
# al asistente "malla horizontal 104B, jerarquia 1" y este contesto que no estaban
# en su ficha, mandandolo a reportar un bug que no existia). El cubicador conoce
# los codigos del catalogo y tiene que poder dictarlos; van OPCIONALES (null = el
# default de la plataforma). Los parciales y angulos de la figura NO se inventan
# aca: salen del catalogo real (ver _construir_receta_muro).
# LOS OPCIONALES NO SON ANULABLES (31-ago). La API topa en 16 parametros con
# union (anyOf/nullable) por herramienta —"exponential compilation cost"— y esta
# ficha llego a 33: el asistente dejo de responder con un 400. Cada escalar
# opcional usa ahora un VALOR VACIO en vez de null: "" en textos, 0 en numeros
# (ningun diametro, separacion ni largo real vale 0), -1 donde el 0 es un valor
# legitimo. Solo quedan anulables los OBJETOS que pueden no existir (trabas,
# bordes, estribo), que son 3.
_FIGURA_PROP = {
    "type": "string",
    "description": "codigo de figura del catalogo (101A recta, 103B traba con "
                   "ganchos, 106A estribo de la casa...). \"\" = default de la "
                   "plataforma",
}
_JERARQUIA_PROP = {
    "type": "integer",
    "description": "orden de apilado: 1 = pegada a la cara, 2 = se apoya sobre la "
                   "de nivel 1. 0 = default",
}
_EMPALME_PROP = {
    "type": "number",
    "description": "traslapo en CM que se SUMA al largo de corte del lado que corre "
                   "(el Δ del editor). «60 de empalme» = 60. 0 = sin empalme",
}
_PATA_PROP = {
    "type": "number",
    "description": "largo en CM de la pata/gancho (los lados que NO corren). Solo "
                   "aplica a figuras de 2 o mas tramos. 0 = gancho normativo",
}
# COLORES POR NOMBRE. El editor guarda `c.color` como #rrggbb y, SIN ese campo,
# pinta con el color de la TIPOLOGIA (template_editor.js:3543 `_colorComp` ->
# COL2D). O sea el default ya es el sugerido por tipologia y no hay que escribirlo:
# esto es solo para cuando el usuario pide otro ("pinta las trabas de rojo").
_COLORES = {
    "rojo": "#c62828", "azul": "#1565c0", "verde": "#2e7d32", "naranjo": "#e65100",
    "naranja": "#e65100", "morado": "#7b1fa2", "violeta": "#7b1fa2",
    "amarillo": "#f9a825", "celeste": "#42a5f5", "gris": "#607d8b",
    "negro": "#212121", "blanco": "#fafafa", "rosado": "#ad1457",
    "cafe": "#5d4037", "café": "#5d4037", "turquesa": "#00897b",
}
_COLOR_PROP = {
    "type": "string",
    "description": "color de esa barra: nombre en castellano (rojo, azul, verde, "
                   "naranjo, morado, amarillo, celeste, gris...) o hex #rrggbb. "
                   "\"\" = el color de su tipologia, que es el default",
}
_TRAMOS_PROP = {
    "type": "array",
    "items": {"type": "object", "additionalProperties": False,
              "required": ["long", "sep"],
              "properties": {
                  "long": {"type": "number", "description": "largo del tramo en cm"},
                  "sep": {"type": "number", "description": "@ de ESE tramo en cm"},
              }},
    "description": "reparto por TRAMOS a lo largo del rango, en orden ('@10 los "
                   "primeros 80, @20 el resto'). Lista vacia = un solo @ parejo",
}
_DOMINANTE_PROP = {
    "type": "string",
    "description": "letra del lado que manda en la figura (A, B, C...). \"\" = lo "
                   "decide el motor",
}
_GIRO_PATAS_PROP = {
    "type": "integer",
    "description": "hacia donde apuntan las patas: 0, 90, 180 o 270 grados. -1 = "
                   "como nace (el 0 es un giro valido, por eso el vacio es -1)",
}
_MALLA_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["diam", "sep", "figura", "jerarquia", "empalme", "pata",
                 "holgura", "tramos", "lado_dominante", "giro_patas", "color"],
    "properties": {
        "diam": {"type": "number",
                 "description": "φ en mm. 0 = el muro NO lleva esta malla "
                                "(el usuario pidió solo otras armaduras)"},
        "sep": {"type": "number", "description": "@ en cm"},
        "figura": _FIGURA_PROP,
        "jerarquia": _JERARQUIA_PROP,
        "empalme": _EMPALME_PROP,
        "pata": _PATA_PROP,
        "holgura": {
            "type": "number",
            "description": "cm libres entre el cabezal y la PRIMERA barra de esta "
                           "malla («el primer vertical a 10 cm del cabezal»). 0 = "
                           "lo decide la plataforma",
        },
        "tramos": _TRAMOS_PROP,
        "lado_dominante": _DOMINANTE_PROP,
        "giro_patas": _GIRO_PATAS_PROP,
        "color": _COLOR_PROP,
    },
}

TOOL_MURO = {
    "name": "proponer_muro",
    "description": (
        "Propone la ficha del muro. El usuario puede pedir el muro COMPLETO o SOLO "
        "UNA PARTE (por ejemplo solo los cabezales): las armaduras que no pida van "
        "vacías —diámetro 0 en las mallas, null en trabas y bordes— y NO se le "
        "preguntan. Lo único imprescindible son las dimensiones del muro y que haya "
        "al menos UNA armadura. Los campos que asumas, márcalos 'asumido' en "
        "origenes y dilo en tu respuesta."),
    # SIN `strict` (31-ago). Con strict la API COMPILA una gramatica con el schema
    # y esta ficha la hizo reventar: "The compiled grammar is too large, which would
    # cause performance issues". El schema se sigue mandando entero —el modelo lo
    # respeta— pero deja de ser una garantia dura, asi que la ficha que llega se
    # NORMALIZA antes de construir (ver _normalizar_ficha): tipos coercionados,
    # opcionales con su vacio, y los datos criticos que falten cortan la receta en
    # vez de inventarse.
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["geometria", "malla_vertical", "malla_horizontal",
                     "doble_malla", "trabas", "bordes", "origenes"],
        "properties": {
            "rehacer": {
                "type": "integer",
                "description": "1 SOLO si el usuario pidio expresamente rehacer el "
                               "muro completo. Con barras en el editor, proponer_muro "
                               "sin rehacer=1 se rechaza: para cambios puntuales usa "
                               "operar_barras.",
            },
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
            "malla_vertical": _MALLA_SCHEMA,
            "malla_horizontal": _MALLA_SCHEMA,
            "doble_malla": {"type": "boolean"},
            "bordes": {
                "anyOf": [
                    {"type": "null"},
                    {"type": "object", "additionalProperties": False,
                     "required": ["barras", "estribo", "largo"],
                     "properties": {
                         "barras": {
                             "type": "object", "additionalProperties": False,
                             "required": ["diam", "barras_capa", "n_capas", "figura",
                                          "empalme", "pata", "sep_capas", "color",
                                          "jerarquia"],
                             "properties": {
                                 "diam": {"type": "number", "description": "φ cabezal en mm"},
                                 "barras_capa": {"type": "integer", "description": "barras por capa (a lo ancho)"},
                                 "n_capas": {"type": "integer", "description": "capas hacia el interior del muro"},
                                 "figura": _FIGURA_PROP,
                                 "empalme": _EMPALME_PROP,
                                 "pata": _PATA_PROP,
                                 "jerarquia": _JERARQUIA_PROP,
                                 "sep_capas": {
                                     "type": "number",
                                     "description": "separacion entre capas de "
                                                    "cabezales, eje a eje, en cm. "
                                                    "0 = default",
                                 },
                                 "color": _COLOR_PROP,
                             }},
                         "estribo": {
                             "anyOf": [
                                 {"type": "null"},
                                 {"type": "object", "additionalProperties": False,
                                  "required": ["diam", "sep", "figura", "tramos",
                                               "anidar", "color"],
                                  "properties": {
                                      "diam": {"type": "number", "description": "φ estribo en mm"},
                                      "sep": {"type": "number", "description": "@ en cm (usual ≤6φ y ≤½ espesor)"},
                                      "figura": _FIGURA_PROP,
                                      "tramos": _TRAMOS_PROP,
                                      "anidar": {
                                          "type": "integer",
                                          "description": "ajustar capas anidadas: "
                                                         "1 si, 0 no, -1 default",
                                      },
                                      "color": _COLOR_PROP,
                                  }},
                             ]},
                         "largo": {"type": "number",
                                   "description": "largo del ESTRIBO por punta, cm. "
                                                  "Solo importa si hay estribo; sin "
                                                  "estribo no se pregunta (0 = 40)"},
                     }},
                ],
            },
            "trabas": {
                "anyOf": [
                    {"type": "null"},
                    {"type": "object", "additionalProperties": False,
                     "required": ["diam", "sx", "sy", "figura", "jerarquia",
                                  "tramos", "anidar", "color"],
                     "properties": {
                         "diam": {"type": "number", "description": "φ en mm"},
                         "sx": {"type": "number", "description": "grilla horizontal cm"},
                         "sy": {"type": "number", "description": "grilla vertical cm"},
                         "figura": _FIGURA_PROP,
                         "jerarquia": _JERARQUIA_PROP,
                         "tramos": _TRAMOS_PROP,
                         "anidar": {
                             "type": "integer",
                             "description": "ajustar capas anidadas (cada capa "
                                            "interior se acorta un phi): 1 si, 0 no, "
                                            "-1 el default de la plataforma",
                         },
                         "color": _COLOR_PROP,
                     }},
                ],
            },
            "origenes": {
                "type": "object", "additionalProperties": False,
                "required": ["geometria", "recubrimiento", "malla_vertical",
                             "malla_horizontal", "doble_malla", "trabas", "bordes"],
                "properties": {k: {"type": "string", "enum": _ORIGENES}
                               for k in ("geometria", "recubrimiento",
                                         "malla_vertical", "malla_horizontal",
                                         "doble_malla", "trabas", "bordes")},
            },
        },
    },
}


# ---------------------------------------------------------------------------
# CONSTRUCTOR DETERMINÍSTICO ficha → receta (patrón del test canónico de muro)
# ---------------------------------------------------------------------------
def _r1(v):
    return round(float(v), 1)


def _hex_color(v):
    """Nombre en castellano o hex -> #rrggbb. Devuelve None si no se entiende: sin
    color escrito, el editor pinta con el color de la TIPOLOGIA, que es el default
    correcto (template_editor.js:3543). Un color mal puesto seria peor que ninguno."""
    if not v:
        return None
    t = str(v).strip().lower()
    if t in _COLORES:
        return _COLORES[t]
    if t.startswith("#") and len(t) == 7:
        try:
            int(t[1:], 16)
            return t
        except ValueError:
            return None
    return None


def _spec_figura(figuras, codigo, parciales_def, angulos_def):
    """(parciales, angulos) de una figura. Salen del CATALOGO cuando se pudo leer
    (`figuras` = CatalogoFiguras del endpoint); si no, de la tabla de respaldo del
    llamador. Nunca se inventan: una figura pedida por el usuario puede tener 2, 3
    o 4 lados y de eso dependen las dims que hay que escribir."""
    if figuras is not None:
        # Un dict plano {codigo: {parciales, angulos}} sirve igual que el snapshot
        # del catalogo: asi los tests pueden medir el constructor sin BD.
        if isinstance(figuras, dict):
            f = figuras.get(codigo)
        else:
            from .catalogo import get_figura
            f = get_figura(figuras, codigo)
        if f:
            return (list(f.get("parciales") or parciales_def),
                    list(f.get("angulos") or []))
    return list(parciales_def), list(angulos_def)


_CRITICOS_FALTAN = "faltan datos criticos del muro"


def _num(v, porDefecto=0.0):
    """Numero tolerante: el modelo puede mandar '20', 20.0 o nada."""
    try:
        n = float(str(v).replace(",", ".").strip())
    except (TypeError, ValueError):
        return porDefecto
    return n


def _normalizar_ficha(spec: dict) -> dict:
    """La ficha que llega del modelo, con los tipos y vacios en su lugar.

    Existe porque el schema dejo de ser `strict` (la gramatica compilada topaba en
    tamano): sin esa garantia el modelo puede omitir un opcional o mandar un numero
    como texto, y el constructor no puede caerse por eso. Lo que NO se inventa son
    los datos criticos —dimensiones y mallas—: si faltan, se levanta ValueError y el
    asistente contesta preguntando, que es exactamente lo que debe hacer."""
    if not isinstance(spec, dict):
        raise ValueError(_CRITICOS_FALTAN)
    g = spec.get("geometria")
    if not isinstance(g, dict):
        raise ValueError(_CRITICOS_FALTAN)
    geo = {k: _num(g.get(k)) for k in ("largo", "alto", "espesor", "recubrimiento")}
    if geo["largo"] <= 0 or geo["alto"] <= 0 or geo["espesor"] <= 0:
        raise ValueError(_CRITICOS_FALTAN)
    if geo["recubrimiento"] <= 0:
        geo["recubrimiento"] = 2.5          # default declarado de la plataforma

    def _armadura(d, con_sep=True):
        d = d if isinstance(d, dict) else {}
        out = {
            "diam": _num(d.get("diam")),
            "figura": str(d.get("figura") or "").strip().upper(),
            "jerarquia": int(_num(d.get("jerarquia"))),
            "empalme": _num(d.get("empalme")),
            "pata": _num(d.get("pata")),
            "holgura": _num(d.get("holgura")),
            "color": str(d.get("color") or "").strip(),
            "lado_dominante": str(d.get("lado_dominante") or "").strip(),
            "giro_patas": int(_num(d.get("giro_patas"), -1)),
            "tramos": [{"long": _num(t.get("long")), "sep": _num(t.get("sep"))}
                       for t in (d.get("tramos") or []) if isinstance(t, dict)],
            # El booleano tambien vale: el schema lo pide como entero (-1/0/1) pero
            # un true/false del modelo significa lo mismo y no se va a descartar.
            "anidar": (1 if d.get("anidar") is True
                       else 0 if d.get("anidar") is False
                       else int(_num(d.get("anidar"), -1))),
        }
        if con_sep:
            out["sep"] = _num(d.get("sep"))
        return out

    # LAS MALLAS SON OPCIONALES (31-ago). Antes eran obligatorias, asi que un
    # «hazme SOLO los cabezales» no cabia en la ficha: el asistente se veia forzado a
    # pedir diametro y separacion de unas mallas que el usuario no queria, y la
    # conversacion se trababa ahi. Un elemento con solo cabezales es perfectamente
    # valido — el cubicador arma su template por partes.
    def _malla(clave):
        m = _armadura(spec.get(clave))
        return m if (m["diam"] > 0 and m["sep"] > 0) else None

    mv, mh = _malla("malla_vertical"), _malla("malla_horizontal")

    out = {"geometria": geo, "malla_vertical": mv, "malla_horizontal": mh,
           "doble_malla": bool(spec.get("doble_malla", True)),
           "trabas": None, "bordes": None,
           "origenes": spec.get("origenes") if isinstance(spec.get("origenes"), dict) else {}}

    # UNA ARMADURA COMPLETA QUE EL MODELO MARCA 'asumido' NO SE CREA (31-ago: el
    # usuario pidio mallas y cabezales, y aparecieron trabas que nadie pidio). El
    # origen lo declara el propio modelo: 'asumido' sobre la armadura ENTERA
    # significa «la agregue yo», y agregar barras no pedidas es justamente lo
    # prohibido. Asumir VALORES sigue permitido; inventar barras, no.
    orig = out["origenes"]

    def _la_invento(clave):
        return str((orig or {}).get(clave) or "").strip().lower() == "asumido"

    tr = spec.get("trabas")
    if _la_invento("trabas"):
        tr = None
    if isinstance(tr, dict) and _num(tr.get("diam")) > 0:
        t = _armadura(tr, con_sep=False)
        t["sx"] = _num(tr.get("sx"), 40)
        t["sy"] = _num(tr.get("sy"), 40)
        out["trabas"] = t

    bo = spec.get("bordes")
    if _la_invento("bordes"):
        bo = None
    if isinstance(bo, dict) and isinstance(bo.get("barras"), dict):
        bb = bo["barras"]
        if _num(bb.get("diam")) > 0:
            barras = _armadura(bb, con_sep=False)
            barras["barras_capa"] = max(1, int(_num(bb.get("barras_capa"), 2)))
            barras["n_capas"] = max(1, int(_num(bb.get("n_capas"), 1)))
            barras["sep_capas"] = _num(bb.get("sep_capas"))
            est = bo.get("estribo")
            estribo = None
            if isinstance(est, dict) and _num(est.get("diam")) > 0:
                estribo = _armadura(est)
                if estribo["sep"] <= 0:
                    estribo["sep"] = 10.0
            out["bordes"] = {"barras": barras, "estribo": estribo,
                             "largo": _num(bo.get("largo"), 40) or 40}

    # Una ficha sin NINGUNA armadura no es un muro a medias: es un muro vacio, y de
    # eso no sale ninguna barra. Ahi si corresponde volver a preguntar.
    if not (out["malla_vertical"] or out["malla_horizontal"]
            or out["trabas"] or out["bordes"]):
        raise ValueError(_CRITICOS_FALTAN)
    return out



# ---------------------------------------------------------------------------
# FABRICAS POR ARMADURA — un solo lugar que sabe armar cada tipologia.
# Las usan _construir_receta_muro (muro de cero) y _aplicar_cambios (operar
# barras sueltas): dos puertas, UNA fabrica, para que no diverjan.
# ---------------------------------------------------------------------------
def _mk_lin(sep, eje, lo, hi, tramos=None):
    d = {"modo": "linear", "activa": True, "sep": _r1(sep),
         "zonas": [{"long": 0, "sep": _r1(sep)}], "start_offset": 4,
         "rango": {"eje": eje, "from": _r1(lo), "to": _r1(hi), "sep": _r1(sep)}}
    if tramos:
        d["rango"]["tramos"] = [{"long": _r1(t["long"]), "sep": _r1(t["sep"])}
                                for t in tramos if t.get("long") and t.get("sep")]
    return d


def _mk_base(tip, figura, diam, angulos, modo, cara, lado, rumbo,
             orientacion, volteado, dims, jer, dist):
    return {"tipologia": tip, "figura": figura, "diam": float(diam),
            "suf_tipo": "", "recub_override": None, "angulos": list(angulos),
            "comp_id": None, "modo": modo,
            "pose": {"cara": cara, "lado": lado, "rumbo": rumbo, "espejo": False},
            "cara": cara, "lado": lado,
            "plano_pieza": {"orientacion": orientacion, "volteado": volteado},
            "arreglo": {"n_capas": 1, "sep_capas": 20, "rango": None},
            "dims": dims, "jerarquia": jer, "distribucion": dist, "pos_hint": {}}


def _lado_que_corre(parciales):
    return "B" if "B" in parciales else (parciales[0] if parciales else None)


def _mk_dims(parciales, empalme=None, pata=None, phi=None, patas_fijas=False):
    """Cuerpo en auto, patas fijas si corresponde, empalme como Delta del lado que
    CORRE (B cuando existe). Las patas de un CABEZAL siempre van fijas: en su pose
    el auto las resuelve contra el largo del muro (medido: 508 cm)."""
    dims = {L: {"modo": "auto"} for L in parciales}
    corre = _lado_que_corre(parciales)
    if pata or patas_fijas:
        largo_pata = _r1(pata) if pata else _r1(max(7.5, float(phi or 8)))
        for L in parciales:
            if L != corre:
                dims[L] = {"modo": "fija", "valor": largo_pata}
    if empalme and corre:
        dims[corre]["delta"] = _r1(empalme)
        dims[corre]["extremo"] = "fin"
    return dims


def _mk_extras(comp, d):
    dom = (d or {}).get("lado_dominante")
    if dom:
        comp["lado_dominante"] = str(dom).strip().upper()
    giro = (d or {}).get("giro_patas")
    if giro in (0, 90, 180, 270):
        comp["orient"] = {"spin": int(giro)}
    anid = (d or {}).get("anidar")
    if anid in (0, 1, True, False):
        comp["distribucion"]["anidar"] = bool(anid)
    col = _hex_color((d or {}).get("color"))
    if col:
        comp["color"] = col
    return comp


def _pedido(d, clave, porDefecto):
    v = (d or {}).get(clave)
    return v if v not in (None, "", 0) else porDefecto


def _dictado(d, clave):
    """True si el usuario puso ESE campo (el vacio de la ficha es 0 / '')."""
    return (d or {}).get(clave) not in (None, "", 0)


def _marcar_jer(comp, p):
    """Deja constancia de que la jerarquia vino DICTADA, para que la regla de
    jerarquias se abstenga. Sin esto no habia como distinguir «el usuario pidio
    jer.1» de «nadie dijo nada y el default es 1» — y la regla pisaba al usuario."""
    if _dictado(p, "jerarquia"):
        comp["_jer_dictada"] = True
    return comp


def _geo_de(receta_o_ficha):
    g = receta_o_ficha.get("geometria") or {}
    esp = g.get("ancho", g.get("espesor"))
    rec = g.get("recub_lat", g.get("recubrimiento"))
    return {"largo": _num(g.get("largo")), "alto": _num(g.get("alto")),
            "esp": _num(esp), "rec": _num(rec, 2.5) or 2.5}


def _fabricar(clase, p, geo, figuras, lados):
    """Los componentes de UNA armadura: clase en malla_vertical / malla_horizontal /
    trabas / cabezales / estribo. `p` ya viene normalizado; `lados` dice en que
    cortina(s) o punta(s)."""
    rx = geo["largo"] / 2.0 - geo["rec"]
    ry = geo["alto"] / 2.0 - geo["rec"]
    comps = []

    if clase == "malla_vertical":
        fig = _pedido(p, "figura", "101A")
        par, ang = _spec_figura(figuras, fig, ["A"], [])
        for lado in lados:
            c = _mk_extras(_mk_base(
                "MV", fig, p["diam"], ang, "lineal", "lateral", lado, "y",
                "de_pie", False,
                _mk_dims(par, p.get("empalme"), p.get("pata"), p["diam"]),
                int(_pedido(p, "jerarquia", 1)),
                _mk_lin(p["sep"], "x", -rx, rx, p.get("tramos"))), p)
            _marcar_jer(c, p)
            if _num(p.get("holgura")) > 0:
                c["_holgura"] = _num(p.get("holgura"))   # lo lee la regla del borde
            if lado == -1 and len(par) > 1:
                # regla de la casa: la cortina opuesta va en ESPEJO (los ganchos
                # se cruzan en el testero, captura del usuario 31-ago)
                c["pose"]["espejo"] = True
                c["espejo"] = True
            comps.append(c)

    elif clase == "malla_horizontal":
        fig = _pedido(p, "figura", "101A")
        par, ang = _spec_figura(figuras, fig, ["A"], [])
        for lado in lados:
            c = _mk_extras(_mk_base(
                "MH", fig, p["diam"], ang, "lineal", "lateral", lado, "x",
                "acostada", False,
                _mk_dims(par, p.get("empalme"), p.get("pata"), p["diam"]),
                int(_pedido(p, "jerarquia", 1)),
                _mk_lin(p["sep"], "y", -ry, ry, p.get("tramos"))), p)
            _marcar_jer(c, p)
            if lado == -1 and len(par) > 1:
                c["pose"]["espejo"] = True
                c["espejo"] = True
            comps.append(c)

    elif clase in ("trabas", "trabas_confinamiento"):
        # TR = traba de MURO (cose las dos cortinas de la malla corriente).
        # TC = traba de CONFINAMIENTO (va dentro del borde, con la separacion
        # apretada del estribo). Son barras distintas y la plataforma las pinta
        # distinto: confundirlas fue un error del generador (usuario 31-ago).
        tip = "TR" if clase == "trabas" else "TC"
        fig = _pedido(p, "figura", "103B")
        par, ang = _spec_figura(figuras, fig, ["A", "B", "C"], [45, 45])
        dist = _mk_lin(p.get("sx", 40), "x", -rx, rx, p.get("tramos"))
        dist["modo"] = "arreglo"
        m_gancho = 6.0 * float(p["diam"]) / 10.0 + 5.0
        dist["rango2"] = {"eje": "y", "from": _r1(-(ry - m_gancho)), "to": _r1(ry),
                          "sep": _r1(p.get("sy", 40))}
        # LA TRABA ENGANCHA LAS DOS BARRAS: su cuerpo mide el espesor util MAS un
        # sobrelargo, porque tiene que pasar por fuera del eje de cada cortina para
        # agarrarlas (regla de la casa, usuario 31-ago: «2 cm mas en su lado B»).
        dims_tr = {L: {"modo": "auto"} for L in par}
        cuerpo = _lado_que_corre(par)
        sobre = _num(p.get("sobrelargo"), 2) if p.get("sobrelargo") is not None else 2
        if cuerpo and sobre:
            dims_tr[cuerpo]["delta"] = _r1(sobre)
            dims_tr[cuerpo]["extremo"] = "centro"   # crece por las dos puntas
        comps.append(_marcar_jer(_mk_extras(_mk_base(
            tip, fig, p["diam"], ang, "arreglo", "sup", 1, "z", "volteada",
            True, dims_tr,
            int(_pedido(p, "jerarquia", 2)), dist), p), p))

    elif clase == "cabezales":
        fig = _pedido(p, "figura", "101A")
        par, ang = _spec_figura(figuras, fig, ["A"], [])
        for lado in lados:
            comps.append(_mk_extras(_mk_base(
                "CB", fig, p["diam"], ang, "puntual", "extremo", lado, "y",
                "de_pie", False,
                _mk_dims(par, p.get("empalme"), p.get("pata"), p["diam"],
                         patas_fijas=True), int(_pedido(p, "jerarquia", 1)),
                {"modo": "layered",
                 "n_capas": max(1, int(_num(p.get("n_capas"), 1))),
                 "barras_capa": max(1, int(_num(p.get("barras_capa"), 2))),
                 "gap": _r1(p.get("sep_capas") or 4),
                 "sentido": "nucleo", "justify": "repartir"}), p))

    elif clase == "estribo":
        fig = _pedido(p, "figura", "106A")
        par, ang = _spec_figura(figuras, fig,
                                ["A", "B", "C", "D", "E", "F"], [45, 45])
        lconf = _num(p.get("largo"), 40) or 40
        for lado in lados:
            dims = {L: {"modo": "auto"} for L in par}
            if "B" in dims:
                dims["B"] = {"modo": "fija", "valor": _r1(lconf),
                             "extremo": "centro"}
            ec = _mk_base("EC", fig, p["diam"], ang, "lineal", "lateral", 1,
                          "y", "de_pie", False, dims,
                          int(_pedido(p, "jerarquia", 1)),
                          _mk_lin(p.get("sep", 10), "y", -ry, ry,
                                  p.get("tramos")))
            ec["pos_hint"] = {"x": _r1(lado * (geo["largo"] / 2.0 - geo["rec"]
                                               - lconf / 2.0))}
            comps.append(_mk_extras(ec, p))
    return comps


# ---------------------------------------------------------------------------
# REGLAS DE ARMADO — la inteligencia del sistema, con override (31-ago)
# ---------------------------------------------------------------------------
# Son relaciones ENTRE armaduras que ninguna ficha puede expresar por separado:
# la malla vertical depende de si hay cabezales, la grilla de trabas depende de
# las separaciones de las mallas, la jerarquia depende de que cortina va primero.
#
# CONTRATO DE CADA REGLA: mira la receta entera, y toca SOLO lo que el usuario no
# fijo. Cada una lleva escrita su condicion de «no lo toco el usuario»; si el dato
# vino dictado, la regla se abstiene. Asi el sistema es inteligente por defecto y
# obediente cuando se le manda.
def _por_tip(comps, *tips):
    return [c for c in comps if c.get("tipologia") in tips]


def _regla_jerarquias(comps):
    """MV contra la cara, MH encima, trabas sobre las dos.

    NO TOCA si las mallas ya vienen con jerarquias DISTINTAS entre si: eso es
    senal de que alguien las diferencio a proposito (el usuario dicta cual cortina
    va contra la cara — es decision de proyecto, no nuestra)."""
    mv, mh = _por_tip(comps, "MV"), _por_tip(comps, "MH")
    if not (mv and mh):
        return None
    jers = {c.get("jerarquia", 1) for c in mv} | {c.get("jerarquia", 1) for c in mh}
    dictadas = any(c.get("_jer_dictada") for c in mv + mh) or len(jers) > 1
    if not dictadas:
        for c in mv:
            c["jerarquia"] = 1
        for c in mh:
            c["jerarquia"] = 2
        jers = {1, 2}
    # LA TRABA VA SOBRE LAS DOS MALLAS SIEMPRE, tambien cuando el usuario dicto
    # las jerarquias de las cortinas: su nivel se DERIVA del de ellas (una traba
    # que se apoye por debajo de una malla no amarra nada). Se abstiene solo si el
    # usuario dicto la jerarquia de la traba misma.
    for c in _por_tip(comps, "TR"):
        if not c.get("_jer_dictada"):
            c["jerarquia"] = max(jers) + 1
    if dictadas:
        return None
    return "malla vertical contra la cara (jer.1), horizontal encima (jer.2)"


def _zona_de_borde(comps):
    """Cuanto ocupa el paquete de cabezales medido desde el testero hacia adentro:
    las capas se apilan hacia el nucleo separadas por su gap."""
    cbs = _por_tip(comps, "CB")
    if not cbs:
        return 0.0
    z = 0.0
    for c in cbs:
        d = c.get("distribucion") or {}
        z = max(z, (max(1, int(_num(d.get("n_capas"), 1))) - 1) * _num(d.get("gap"), 4))
    return z


def _margen_borde(comps, geo, holgura=0.0):
    """Desde donde puede empezar la malla: la punta util menos el paquete de
    cabezales, menos la holgura pedida (o una separacion si no se pidio)."""
    zona = _zona_de_borde(comps)
    if not zona:
        return None
    rx = geo["largo"] / 2.0 - geo["rec"]
    return rx - zona - holgura


def _regla_mv_esquiva_cabezales(comps, geo):
    """La malla vertical no reparte barras sobre los cabezales.

    El abanico de la MV corre a lo largo del muro; donde hay cabezales esa zona ya
    esta armada, y repetir malla ahi es fierro de mas (reportado por el usuario).
    Se recorta el rango por ambas puntas la profundidad del paquete + una
    separacion, para que la primera barra de malla caiga limpia al lado.

    NO TOCA si no hay cabezales."""
    zona = _zona_de_borde(comps)
    mvs = _por_tip(comps, "MV")
    if not (zona and mvs):
        return None
    rx = geo["largo"] / 2.0 - geo["rec"]
    recorte = None
    for c in mvs:
        d = (c.get("distribucion") or {}).get("rango")
        if not isinstance(d, dict) or d.get("eje") != "x":
            continue
        # La HOLGURA la manda el usuario cuando la dicta («el primer vertical a 10
        # cm del cabezal»); si no dice nada, se usa una separacion de malla.
        holgura = _num(c.get("_holgura")) or _num(d.get("sep"), 20)
        lim = _r1(max(rx * 0.25, rx - zona - holgura))   # nunca colapsar el abanico
        d["from"], d["to"] = -lim, lim
        recorte = _r1(rx - lim)
    return ("la malla vertical arranca a %g cm de cada punta para no repetirse "
            "sobre los cabezales" % recorte) if recorte else None


def _regla_traba_entre_cabezales(comps, geo):
    """La traba de MURO solo cose la malla corriente: el borde tiene su propio
    confinamiento, asi que la traba no se mete sobre los cabezales (usuario
    31-ago). Su abanico se acota al mismo tramo libre que la malla vertical.

    NO TOCA si no hay cabezales."""
    trs = _por_tip(comps, "TR")
    mvs = _por_tip(comps, "MV")
    if not (trs and _zona_de_borde(comps)):
        return None
    # el tramo libre ya calculado para la MV manda; si no hay MV, se calcula igual
    lim = None
    for c in mvs:
        r = (c.get("distribucion") or {}).get("rango")
        if isinstance(r, dict) and r.get("eje") == "x":
            lim = _num(r.get("to"))
            break
    if lim is None:
        m = _margen_borde(comps, geo, 0.0)
        lim = _r1(m) if m else None
    if not lim:
        return None
    tocada = False
    for c in trs:
        r = (c.get("distribucion") or {}).get("rango")
        if isinstance(r, dict) and r.get("eje") == "x" and _num(r.get("to")) > lim:
            r["from"], r["to"] = -lim, lim
            tocada = True
    return "las trabas de muro quedaron entre los cabezales" if tocada else None


def _multiplo_cercano(valor, base, mini):
    """El multiplo de `base` mas cercano a `valor`, nunca bajo `mini`."""
    if base <= 0:
        return valor
    n = max(1, int(round(valor / base)))
    while n * base < mini:
        n += 1
    return _r1(n * base)


def _regla_trabas_en_los_cruces(comps):
    """La traba amarra donde la malla se cruza: su grilla cae en multiplos de las
    separaciones de MV (horizontal) y MH (vertical), y arranca donde arrancan las
    mallas.

    NO TOCA si la grilla pedida YA es multiplo de esas separaciones (es decir, si
    el usuario dio numeros que cuadran, se respetan tal cual)."""
    # SOLO la traba de MURO: la de confinamiento sigue la separacion apretada del
    # estribo del borde, no la trama de la malla (correccion del usuario 31-ago).
    tcs = _por_tip(comps, "TR")
    mv, mh = _por_tip(comps, "MV"), _por_tip(comps, "MH")
    if not tcs or not (mv or mh):
        return None
    sep_mv = _num(((mv[0].get("distribucion") or {}).get("rango") or {}).get("sep")) if mv else 0
    sep_mh = _num(((mh[0].get("distribucion") or {}).get("rango") or {}).get("sep")) if mh else 0
    r_mv = ((mv[0].get("distribucion") or {}).get("rango") or {}) if mv else {}
    r_mh = ((mh[0].get("distribucion") or {}).get("rango") or {}) if mh else {}
    ajustada = False
    for c in tcs:
        d = c.get("distribucion") or {}
        r1, r2 = d.get("rango"), d.get("rango2")
        if isinstance(r1, dict) and sep_mv:
            nuevo = _multiplo_cercano(_num(r1.get("sep"), 40), sep_mv, sep_mv)
            if nuevo != _num(r1.get("sep")):
                r1["sep"] = nuevo
                ajustada = True
            if r_mv.get("from") is not None:      # arrancar donde arranca la MV
                r1["from"], r1["to"] = r_mv["from"], r_mv["to"]
        if isinstance(r2, dict) and sep_mh:
            nuevo = _multiplo_cercano(_num(r2.get("sep"), 40), sep_mh, sep_mh)
            if nuevo != _num(r2.get("sep")):
                r2["sep"] = nuevo
                ajustada = True
    return "las trabas se alinearon con los cruces de la malla" if ajustada else None


def _aplicar_reglas(receta):
    """Todas las reglas sobre la receta ya armada. Devuelve los avisos de las que
    hicieron algo, para que el asistente lo cuente y el usuario pueda mandar lo
    contrario."""
    comps = receta.get("componentes") or []
    if not comps:
        return []
    geo = _geo_de(receta)
    avisos = []
    for regla in (lambda: _regla_jerarquias(comps),
                  lambda: _regla_mv_esquiva_cabezales(comps, geo),
                  lambda: _regla_traba_entre_cabezales(comps, geo),
                  lambda: _regla_trabas_en_los_cruces(comps)):
        try:
            msg = regla()
        except Exception as exc:          # una regla nunca puede romper el muro
            log.warning("asistente: regla de armado fallo: %s", exc)
            msg = None
        if msg:
            avisos.append(msg)
    for c in comps:
        c.pop("_jer_dictada", None)      # marcadores internos: no viajan
        c.pop("_holgura", None)
    return avisos


def _construir_receta_muro(spec: dict, figuras=None) -> dict:
    """Ficha normalizada -> receta, delegando cada armadura a _fabricar."""
    spec = _normalizar_ficha(spec)
    geo = _geo_de({"geometria": spec["geometria"]})
    doble = bool(spec.get("doble_malla", True))
    comps = []
    mv, mh = spec["malla_vertical"], spec["malla_horizontal"]
    for lado in ([1, -1] if doble else [1]):
        if mv:
            comps += _fabricar("malla_vertical", mv, geo, figuras, [lado])
        if mh:
            comps += _fabricar("malla_horizontal", mh, geo, figuras, [lado])
    tr = spec.get("trabas")
    if doble and tr and (mv or mh):
        comps += _fabricar("trabas", tr, geo, figuras, [1])
    bo = spec.get("bordes")
    if bo:
        bb, est = dict(bo["barras"]), bo.get("estribo")
        for lado in (1, -1):
            comps += _fabricar("cabezales", bb, geo, figuras, [lado])
            if est:
                e = dict(est)
                e["largo"] = bo.get("largo") or 40
                comps += _fabricar("estribo", e, geo, figuras, [lado])
    receta = {
        "tipo": "muro",
        "geometria": {"largo": _r1(geo["largo"]), "alto": _r1(geo["alto"]),
                      "ancho": _r1(geo["esp"]),
                      "recub_sup": _r1(geo["rec"]), "recub_inf": _r1(geo["rec"]),
                      "recub_lat": _r1(geo["rec"])},
        "componentes": comps,
    }
    receta["_avisos_reglas"] = _aplicar_reglas(receta)
    return receta


# ---------------------------------------------------------------------------
# OPERAR BARRAS — la 2a herramienta: el asistente deja de ser solo un generador
# de muros y pasa a OPERAR los controles del editor (exigencia del usuario
# 31-ago: acceso a todos los controles, modificarlos segun se le pida).
# Schema PLANO y sin uniones: los dos topes de la API ya mordieron una vez
# (16 uniones · gramatica compilada) y el test los vigila.
# ---------------------------------------------------------------------------
TOOL_OPERAR = {
    "name": "operar_barras",
    "description": (
        "Opera sobre el muro que YA esta en el editor: agrega, edita o quita "
        "barras puntuales. Usala cuando el usuario pida cambios sobre lo "
        "existente (cambia, agrega, quita, sube, esa barra...). El listado "
        "numerado de barras viene al final del mensaje del usuario: `barra` es "
        "ese numero. En los campos, 0 o \"\" = no tocar; -1 = quitar el valor. "
        "Para armar un muro completo desde cero usa proponer_muro."),
    "input_schema": {
        "type": "object", "additionalProperties": False,
        "required": ["cambios"],
        "properties": {
            "cambios": {
                "type": "array",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["accion", "barra"],
                    "properties": {
                        "accion": {"type": "string",
                                   "enum": ["agregar", "editar", "quitar"]},
                        "barra": {"type": "integer",
                                  "description": "numero del listado (editar/"
                                                 "quitar); 0 al agregar"},
                        "armadura": {"type": "string",
                                     "description": "solo al agregar: "
                                                    "malla_vertical, malla_horizontal, "
                                                    "trabas (de muro), "
                                                    "trabas_confinamiento (del borde), "
                                                    "cabezales o estribo"},
                        "lados": {"type": "string",
                                  "description": "al agregar: 'ambas' (las dos "
                                                 "cortinas/puntas), '1' o '-1'. "
                                                 "\"\" = ambas"},
                        "diam": {"type": "number", "description": "phi mm; 0 = no tocar"},
                        "sep": {"type": "number", "description": "@ cm (sx en trabas); 0 = no tocar"},
                        "sep2": {"type": "number", "description": "sy de trabas; 0 = no tocar"},
                        "figura": {"type": "string", "description": "codigo del catalogo; \"\" = no tocar"},
                        "jerarquia": {"type": "integer", "description": "0 = no tocar"},
                        "empalme": {"type": "number", "description": "cm al lado que corre; 0 = no tocar, -1 = quitar"},
                        "pata": {"type": "number", "description": "cm; 0 = no tocar, -1 = volver a auto"},
                        "color": {"type": "string", "description": "nombre o hex; \"\" = no tocar"},
                        "suf": {"type": "string", "description": "sufijo de marca; \"\" = no tocar"},
                        "recub": {"type": "number", "description": "recubrimiento propio cm; 0 = no tocar, -1 = quitar"},
                        "giro_patas": {"type": "integer", "description": "0/90/180/270; -1 = no tocar"},
                        "espejo": {"type": "integer",
                                   "description": "1 = reflejar la barra (media "
                                                  "vuelta: los ganchos quedan en "
                                                  "espejo, p.ej. «rotala en torno a "
                                                  "Z»); 0 = quitar el espejo; -1 = "
                                                  "no tocar"},
                        "lado_dominante": {"type": "string", "description": "letra; \"\" = no tocar"},
                        "anidar": {"type": "integer", "description": "1 si, 0 no, -1 no tocar"},
                        "barras_capa": {"type": "integer", "description": "0 = no tocar"},
                        "n_capas": {"type": "integer", "description": "0 = no tocar"},
                        "sep_capas": {"type": "number", "description": "cm entre capas (gap); 0 = no tocar"},
                        "largo": {"type": "number", "description": "largo del estribo de borde cm; 0 = no tocar"},
                        "tramos": {"type": "array",
                                   "items": {"type": "object",
                                             "additionalProperties": False,
                                             "required": ["long", "sep"],
                                             "properties": {
                                                 "long": {"type": "number"},
                                                 "sep": {"type": "number"}}},
                                   "description": "reparto multi-@; [] = no tocar"},
                    },
                },
            },
        },
    },
}

_CLASE_DE_TIP = {"MV": "malla_vertical", "MH": "malla_horizontal",
                 "TR": "trabas", "TC": "trabas_confinamiento",
                 "CB": "cabezales", "EC": "estribo"}


def _editar_comp(c, cb, geo, figuras):
    """Aplica al componente los campos no-vacios del cambio, escribiendo lo MISMO
    que escribiria el panel (dims/distribucion/orient), no campos inventados."""
    d = c.setdefault("distribucion", {})
    dims = c.setdefault("dims", {})
    corre = _lado_que_corre(list(dims.keys()))

    fig = str(cb.get("figura") or "").strip().upper()
    if fig:
        par, ang = _spec_figura(figuras, fig, list(dims.keys()) or ["A"], [])
        c["figura"], c["angulos"] = fig, ang
        viejo = dims.get(corre, {}) if corre else {}
        dims = c["dims"] = {L: {"modo": "auto"} for L in par}
        corre = _lado_que_corre(par)
        if corre and viejo.get("delta"):
            dims[corre]["delta"] = viejo["delta"]
            dims[corre]["extremo"] = viejo.get("extremo", "fin")

    if _num(cb.get("diam")) > 0:
        c["diam"] = _num(cb.get("diam"))
    if _num(cb.get("sep")) > 0:
        sep = _r1(cb.get("sep"))
        d["sep"] = sep
        if isinstance(d.get("rango"), dict):
            d["rango"]["sep"] = sep
        if d.get("zonas"):
            d["zonas"][0]["sep"] = sep
    if _num(cb.get("sep2")) > 0 and isinstance(d.get("rango2"), dict):
        d["rango2"]["sep"] = _r1(cb.get("sep2"))
    if int(_num(cb.get("jerarquia"))) > 0:
        c["jerarquia"] = int(_num(cb.get("jerarquia")))
        c["_jer_dictada"] = True

    emp = _num(cb.get("empalme"))
    if emp > 0 and corre:
        dims.setdefault(corre, {"modo": "auto"})
        dims[corre]["delta"] = _r1(emp)
        dims[corre]["extremo"] = "fin"
    elif emp == -1 and corre and isinstance(dims.get(corre), dict):
        dims[corre].pop("delta", None)
        dims[corre].pop("extremo", None)

    pata = _num(cb.get("pata"))
    if pata > 0:
        for L in dims:
            if L != corre:
                dims[L] = {"modo": "fija", "valor": _r1(pata)}
    elif pata == -1:
        for L in dims:
            if L != corre:
                dims[L] = {"modo": "auto"}

    esp = int(_num(cb.get("espejo"), -1))
    if esp in (0, 1):
        # «Rotar en torno a Z» / «ganchos en espejo» = el bit espejo de la POSE,
        # no el giro de patas (el modelo confundio los dos el 31-ago y roto las
        # mallas sobre su propio eje).
        c.setdefault("pose", {})["espejo"] = bool(esp)
        c["espejo"] = bool(esp)
    col = _hex_color(cb.get("color"))
    if col:
        c["color"] = col
    if str(cb.get("suf") or "").strip():
        c["suf_tipo"] = str(cb["suf"]).strip()
    rec = _num(cb.get("recub"))
    if rec > 0:
        c["recub_override"] = _r1(rec)
    elif rec == -1:
        c["recub_override"] = None

    _mk_extras(c, {"lado_dominante": cb.get("lado_dominante"),
                   "giro_patas": int(_num(cb.get("giro_patas"), -1)),
                   "anidar": (int(_num(cb.get("anidar"), -1))
                              if int(_num(cb.get("anidar"), -1)) in (0, 1) else None),
                   "color": ""})

    if int(_num(cb.get("barras_capa"))) > 0:
        d["barras_capa"] = int(_num(cb.get("barras_capa")))
    if int(_num(cb.get("n_capas"))) > 0:
        d["n_capas"] = int(_num(cb.get("n_capas")))
    if _num(cb.get("sep_capas")) > 0:
        d["gap"] = _r1(cb.get("sep_capas"))
    if _num(cb.get("largo")) > 0 and c.get("tipologia") == "EC":
        lconf = _num(cb.get("largo"))
        if "B" in dims:
            dims["B"] = {"modo": "fija", "valor": _r1(lconf), "extremo": "centro"}
        signo = 1 if _num((c.get("pos_hint") or {}).get("x"), c.get("lado", 1)) >= 0 else -1
        c["pos_hint"] = {"x": _r1(signo * (geo["largo"] / 2.0 - geo["rec"] - lconf / 2.0))}
    tramos = [t for t in (cb.get("tramos") or []) if isinstance(t, dict)]
    if tramos and isinstance(d.get("rango"), dict):
        d["rango"]["tramos"] = [{"long": _r1(t.get("long")), "sep": _r1(t.get("sep"))}
                                for t in tramos if _num(t.get("long")) and _num(t.get("sep"))]
    return c


def _aplicar_cambios(receta_actual, cambios, figuras):
    """Los cambios de operar_barras sobre la receta del editor. Devuelve
    (receta_nueva, avisos). Un indice invalido AVISA en vez de reventar: el resto
    de los cambios igual se aplica."""
    receta = json.loads(json.dumps(receta_actual))
    comps = receta.setdefault("componentes", [])
    geo = _geo_de(receta)
    avisos = []
    for cb in cambios or []:
        if not isinstance(cb, dict):
            continue
        accion = str(cb.get("accion") or "").strip().lower()
        idx = int(_num(cb.get("barra")))
        if accion == "quitar":
            if 1 <= idx <= len(comps):
                comps.pop(idx - 1)
            else:
                avisos.append("No existe la barra %s del listado." % idx)
        elif accion == "editar":
            if 1 <= idx <= len(comps):
                _editar_comp(comps[idx - 1], cb, geo, figuras)
            else:
                avisos.append("No existe la barra %s del listado." % idx)
        elif accion == "agregar":
            clase = str(cb.get("armadura") or "").strip().lower()
            if clase not in ("malla_vertical", "malla_horizontal", "trabas",
                             "trabas_confinamiento", "cabezales", "estribo"):
                avisos.append("No entendi que armadura agregar (%r)." % clase)
                continue
            defaults = {"malla_vertical": (8, 20), "malla_horizontal": (8, 20),
                        "trabas": (8, 40), "trabas_confinamiento": (8, 10),
                        "cabezales": (16, 0), "estribo": (8, 10)}
            ddiam, dsep = defaults[clase]
            p = {"diam": _num(cb.get("diam")) or ddiam,
                 "sep": _num(cb.get("sep")) or dsep,
                 "sx": _num(cb.get("sep")) or 40, "sy": _num(cb.get("sep2")) or 40,
                 "figura": str(cb.get("figura") or "").strip().upper(),
                 "jerarquia": int(_num(cb.get("jerarquia"))),
                 "empalme": _num(cb.get("empalme")),
                 "pata": _num(cb.get("pata")),
                 "color": cb.get("color"), "tramos": cb.get("tramos") or [],
                 "lado_dominante": cb.get("lado_dominante"),
                 "giro_patas": int(_num(cb.get("giro_patas"), -1)),
                 "anidar": (int(_num(cb.get("anidar"), -1))
                            if int(_num(cb.get("anidar"), -1)) in (0, 1) else None),
                 "barras_capa": int(_num(cb.get("barras_capa"))),
                 "n_capas": int(_num(cb.get("n_capas"))),
                 "sep_capas": _num(cb.get("sep_capas")),
                 "largo": _num(cb.get("largo"))}
            lados_txt = str(cb.get("lados") or "").strip()
            if clase in ("trabas", "trabas_confinamiento"):
                lados = [1]
            elif lados_txt == "1":
                lados = [1]
            elif lados_txt == "-1":
                lados = [-1]
            else:
                lados = [1, -1]
            comps.extend(_fabricar(clase, p, geo, figuras, lados))
    if not comps:
        raise ValueError("El muro quedaria sin ninguna barra; no aplique los cambios.")
    avisos.extend(_aplicar_reglas(receta))
    return receta, avisos


def _resumen_de_receta(receta) -> list:
    """El formulario despues de operar: el listado numerado de lo que quedo."""
    filas = [{"seccion": "Barras en el editor"}]
    for i, c in enumerate(receta.get("componentes") or [], start=1):
        filas.append({"label": "%d · %s" % (i, c.get("tipologia") or "?"),
                      "valor": _linea_comp(c), "origen": "leido"})
    return filas


def _linea_comp(c) -> str:
    d = c.get("distribucion") or {}
    partes = ["%s \u03c6%g" % (c.get("figura") or "?", _num(c.get("diam")))]
    if d.get("modo") == "layered":
        partes.append("%dx%d capas" % (int(_num(d.get("barras_capa"), 1)),
                                       int(_num(d.get("n_capas"), 1))))
    elif _num(d.get("sep")):
        partes.append("@%g" % _num(d.get("sep")))
    if c.get("jerarquia") not in (None, "", 1):
        partes.append("jer.%s" % c["jerarquia"])
    lado = c.get("lado")
    if lado in (1, -1):
        partes.append("lado%+d" % lado)
    dims = c.get("dims") or {}
    for L, v in dims.items():
        if isinstance(v, dict) and v.get("delta"):
            partes.append("emp+%g" % _num(v["delta"]))
            break
    return " ".join(partes)


def _estado_corto(receta) -> str:
    """Una linea con lo que quedo en el editor. Se anexa a CADA respuesta con
    receta: el historial del chat pasa a llevar el estado real turno a turno, y el
    modelo (que solo ve texto) deja de 'olvidar' lo que el mismo armo — el 31-ago
    piso los cabezales y despues no recordaba que existian."""
    comps = receta.get("componentes") or []
    partes = ["%d. %s %s \u03c6%g" % (i, c.get("tipologia") or "?",
                                      c.get("figura") or "?", _num(c.get("diam")))
              for i, c in enumerate(comps, start=1)]
    return " \u00b7 ".join(partes[:14]) + (" (+%d mas)" % (len(partes) - 14)
                                           if len(partes) > 14 else "")


def _inventario_receta(receta) -> str:
    """El listado numerado que ve el MODELO para poder decir «la barra 3»."""
    g = receta.get("geometria") or {}
    l = ["Muro %gx%gx%g rec %g" % (_num(g.get("largo")), _num(g.get("alto")),
                                   _num(g.get("ancho")), _num(g.get("recub_lat")))]
    for i, c in enumerate(receta.get("componentes") or [], start=1):
        l.append("%d. %s %s" % (i, c.get("tipologia") or "?", _linea_comp(c)))
    if len(l) == 1:
        l.append("(sin barras todavia)")
    return chr(10).join(l)



_ORIGEN_LBL = {"leido": "leído", "config": "config", "asumido": "asumido"}


def _detalle_fig(d):
    """Sufijo con la figura/jerarquia SOLO cuando el usuario las dicto (si no, el
    formulario no tiene por que hablar de codigos de catalogo)."""
    if not isinstance(d, dict):
        return ""
    partes = []
    if d.get("figura"):
        partes.append(str(d["figura"]))
    if d.get("jerarquia") not in (None, ""):
        partes.append("jer." + str(d["jerarquia"]))
    return (" · " + " ".join(partes)) if partes else ""


def _inventario(spec: dict) -> str:
    """Qué armaduras va a crear esta ficha, en una línea.

    EXISTE PORQUE (usuario 31-ago): pidió cabezales y el asistente además inventó un
    estribo de confinamiento φ8@10 — 32 barras que nadie pidió, la «espina de
    pescado» que vio en el 3D. El formulario mostraba el dato, pero perdido entre las
    filas. Una línea que diga «2 cabezales + 2 estribos» hace evidente lo que sobra
    ANTES de que se instale."""
    n = 2 if spec.get("doble_malla", True) else 1
    partes = []
    if spec.get("malla_vertical"):
        partes.append("%d malla%s vertical%s" % (n, "s" if n > 1 else "",
                                                 "es" if n > 1 else ""))
    if spec.get("malla_horizontal"):
        partes.append("%d horizontal%s" % (n, "es" if n > 1 else ""))
    if spec.get("doble_malla", True) and spec.get("trabas") \
            and (spec.get("malla_vertical") or spec.get("malla_horizontal")):
        partes.append("1 traba")
    bo = spec.get("bordes")
    if bo:
        partes.append("2 cabezales")
        if bo.get("estribo"):
            partes.append("2 estribos de borde")
    return " + ".join(partes)


def _resumen_de_spec(spec: dict) -> list:
    """Filas del formulario del chat (§12.3), con su chip de origen."""
    g, o = spec["geometria"], spec.get("origenes", {})

    def org(k):
        return o.get(k) if o.get(k) in _ORIGENES else "asumido"

    filas = [
        {"seccion": "Se van a crear"},
        {"label": "Armaduras", "valor": _inventario(spec), "origen": "config"},
        {"seccion": "Hormigón (muro)"},
        {"label": "Largo × Alto",
         "valor": f"{g['largo']:g} × {g['alto']:g} cm", "origen": org("geometria")},
        {"label": "Espesor", "valor": f"{g['espesor']:g} cm", "origen": org("geometria")},
        {"label": "Recubrimiento", "valor": f"{g['recubrimiento']:g} cm",
         "origen": org("recubrimiento")},
        {"seccion": "Barras"},
        {"label": "Malla vertical",
         "valor": (f"φ{spec['malla_vertical']['diam']:g} @ {spec['malla_vertical']['sep']:g}"
                   + _detalle_fig(spec["malla_vertical"])) if spec.get("malla_vertical")
                  else "no lleva",
         "origen": org("malla_vertical")},
        {"label": "Malla horizontal",
         "valor": (f"φ{spec['malla_horizontal']['diam']:g} @ {spec['malla_horizontal']['sep']:g}"
                   + _detalle_fig(spec["malla_horizontal"])) if spec.get("malla_horizontal")
                  else "no lleva",
         "origen": org("malla_horizontal")},
        {"label": "Mallas", "valor": "doble" if spec.get("doble_malla", True) else "simple",
         "origen": org("doble_malla")},
    ]
    tr = spec.get("trabas")
    filas.append({"label": "Trabas",
                  "valor": ((f"φ{tr['diam']:g} · {tr['sx']:g} × {tr['sy']:g}"
                             + _detalle_fig(tr)) if tr else "sin trabas"),
                  "origen": org("trabas")})
    emp = ((spec.get("malla_vertical") or {}).get("empalme")
           or (spec.get("malla_horizontal") or {}).get("empalme"))
    if emp:
        filas.append({"label": "Empalme",
                      "valor": ("MV +%g cm" % spec["malla_vertical"]["empalme"]
                                if (spec.get("malla_vertical") or {}).get("empalme")
                                else "MH +%g cm" % spec["malla_horizontal"]["empalme"]),
                      "origen": org("malla_vertical")})
    bo = spec.get("bordes")
    filas.append({"seccion": "Confinamiento de borde"})
    if bo:
        bb, est = bo["barras"], bo.get("estribo")
        det = ""
        if bb.get("sep_capas"):
            det += " @%g" % bb["sep_capas"]
        if bb.get("pata"):
            det += " · pata %g" % bb["pata"]
        if bb.get("empalme"):
            det += " · emp %g" % bb["empalme"]
        filas.append({"label": "Cabezales",
                      "valor": f"{bb['barras_capa']}φ{bb['diam']:g} × {bb['n_capas']} capas por punta"
                               + det + _detalle_fig(bb),
                      "origen": org("bordes")})
        filas.append({"label": "Estribo borde",
                      "valor": (f"φ{est['diam']:g} @ {est['sep']:g} · largo {bo['largo']:g}" if est
                                else "sin estribo"),
                      "origen": org("bordes")})
    else:
        filas.append({"label": "Bordes", "valor": "sin confinamiento",
                      "origen": org("bordes")})
    return filas


# ---------------------------------------------------------------------------
# PROMPT
# ---------------------------------------------------------------------------
def _system_prompt(elemento: str, catalogo: str = "") -> str:
    return (
        "Eres el Asistente de Enfierrado de ArmaHub: un copiloto para cubicadores "
        "chilenos que arma MUROS de hormigón armado conversando. Tu único trabajo "
        "es completar la ficha del muro (herramienta proponer_muro); un motor "
        "geométrico de la plataforma convierte esa ficha en barras — tú NUNCA "
        "calculas geometría ni largos.\n\n"
        "REGLAS:\n"
        "· Unidades: dimensiones y separaciones en CENTÍMETROS, diámetros (φ) en "
        "MILÍMETROS. Convierte si el usuario habla en metros o mm.\n"
        "· PROPONE, NO INTERROGUES (política del usuario). Lo ÚNICO que siempre "
        "necesitas son las dimensiones del hormigón: si no hay muro abierto y no "
        "te las dan, pregunta SOLO eso. Todo lo demás de las armaduras que el "
        "usuario SÍ pidió es asumible con lo típico (malla φ8@20, traba φ8 "
        "40×40, cabezal φ16 2×2, estribo φ8@10, empalme 60φ): asume, marca "
        "'asumido', y cierra tu respuesta con una línea que diga qué asumiste y "
        "que te lo corrijan si no calza. Es mejor mostrar un muro corregible que "
        "hacer una pregunta. OJO: esto NO te deja agregar armaduras que no "
        "pidió — asumir valores sí, inventar barras no.\n"
        "· Cuando tengas los datos críticos, llama proponer_muro. En origenes "
        "marca cada campo: 'leido' (lo dijo el usuario), 'config' (default de la "
        "plataforma), 'asumido' (lo pusiste tú).\n"
        "· Si YA hay barras en el editor (viene el listado numerado al final del "
        "mensaje) y el usuario pide cambiar, agregar o quitar algo, usa "
        "operar_barras con esos números — NUNCA reconstruyas el muro entero con "
        "proponer_muro para un cambio puntual, porque pisarías lo que el usuario "
        "editó a mano.\n"
        "· LA PLATAFORMA APLICA REGLAS DE ARMADO SOLA (jerarquías de las "
        "cortinas, la malla vertical esquivando los cabezales, las trabas "
        "cayendo en los cruces de la malla). No las expliques ni las pidas: se "
        "aplican al armar y te llegan como aviso para que las cuentes. Si el "
        "usuario quiere otra cosa, dicta el valor y la regla se abstiene.\n"
        "· TU MEMORIA ES EL LISTADO: el inventario numerado del mensaje es el "
        "estado REAL del editor, turno a turno. Confía en él por sobre tu "
        "recuerdo de la conversación; si el usuario dice que algo existía y no "
        "está en el listado, dilo en vez de improvisar.\n"
        "· ESPEJO vs GIRO DE PATAS: «rótala en torno a Z», «que quede en "
        "espejo», «los ganchos al otro lado» = campo `espejo` de operar_barras "
        "(refleja la barra). `giro_patas` solo gira los GANCHOS sobre el eje de "
        "la propia barra — no es una rotación del cuerpo.\n"
        "· Por ahora SOLO muros. Si piden otro elemento, dilo amable: viga y "
        "columna vienen después.\n"
        "· SE PUEDE PEDIR SOLO UNA PARTE. «Hazme solo los cabezales» es un "
        "pedido completo y valido: se llena esa armadura y las demas van vacias "
        "(diametro 0 en las mallas, null en trabas y bordes). NO le pidas las "
        "mallas, ni el estribo, ni el largo del estribo si no los menciono — lo "
        "unico imprescindible son las dimensiones del muro. Preguntar por "
        "armaduras que no pidio es lo mismo que agregarlas.\n"
        "· NO INVENTES ARMADURAS QUE NADIE PIDIÓ. Cada armadura de la ficha es "
        "una barra distinta que se va a fabricar: si el usuario pide SOLO "
        "cabezales, el estribo va en null; si pide solo mallas, trabas y bordes "
        "van en null. Agregar una armadura de más es un error grave, no una "
        "ayuda.\n"
        "· CABEZAL y ESTRIBO son DOS COSAS DISTINTAS del borde, no las mezcles:\n"
        "    · `bordes.barras` = CABEZALES: las barras verticales gruesas de la "
        "punta. Llevan diámetro, cuántas por capa, cuántas capas, separación "
        "entre capas, figura, pata y empalme. Van por CAPAS, nunca con un @.\n"
        "    · `bordes.estribo` = el marco cerrado que las abraza, repartido en "
        "altura con un @. Si el usuario no lo menciona va en null Y SE LO "
        "PREGUNTAS: «¿solo los cabezales, o le pongo estribo de confinamiento?».\n"
        "    Un pedido de cabezales NUNCA se escribe en `estribo`.\n"
        "· FIGURA y JERARQUÍA SÍ son tuyas: la ficha las lleva por elemento. Si el "
        "usuario dice «la malla horizontal es 104B» o «esa traba con jerarquía 2», "
        "ponlo en la ficha y vuelve a proponer — NUNCA le digas que eso lo decide "
        "el motor o que lo reporte como bug. Si no las menciona, déjalas en null y "
        "manda el default de la plataforma.\n"
        "· El ÚNICO catálogo de figuras es la lista completa que va al final "
        "de estas instrucciones. NO decidas por el nombre ni por familias: si el "
        "código está en esa lista, EXISTE y puedes usarlo. Solo di que un código "
        "no existe si de verdad NO aparece ahí, y ahí ofrece los que sí están.\n"
        "· EMPALME: cuando el usuario pide empalme/traslapo («ponle 60 de "
        "empalme», «traslapo 40 phi»), va en el campo `empalme` de esa armadura, "
        "en CENTÍMETROS — se suma al largo de corte. Si lo dicta en diámetros "
        "(60·φ), conviértelo tú: φ10 y 60φ = 60 cm. Lo pide casi siempre para la "
        "malla vertical y los cabezales.\n"
        "· PATA: si el usuario pide una figura con pata o gancho («cabezales "
        "102A con pata de 25»), ese largo va en el campo `pata`, en CM. Si elige "
        "una figura con patas y NO dice cuanto miden, PREGUNTASELO: dejarlas "
        "libres produce barras deformes.\n"
        "· CABEZALES: `sep_capas` = separacion entre capas en cm («capas cada "
        "15») y `barras_capa` = cuantas van por capa a lo ancho del espesor.\n"
        "· COLOR: cada tipología ya trae su color (malla horizontal azul, "
        "vertical verde, trabas morado, estribo naranjo, cabezal azul) y ese es "
        "el default — no lo escribas. Solo llena `color` si el usuario pide otro "
        "(«las trabas píntalas de rojo»); acepta nombre en castellano o hex.\n"
        "· Responde en español chileno neutro, breve, sin jerga técnica de la "
        "plataforma. Nada de muros de texto.\n\n"
        "DEFAULTS DE LA PLATAFORMA (origen 'config'):\n"
        "· Recubrimiento de muro: 2.5 cm (un solo valor, caras y bordes).\n"
        "· Trabas por defecto: φ8 en grilla 40×40 cm (solo con doble malla).\n"
        "· Doble malla salvo indicación contraria.\n\n"
        + _conocimiento(elemento)
        + (catalogo or "")
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
        # INVENTARIO NUMERADO, no el JSON crudo: el modelo necesita poder decir
        # «la barra 3» para operar_barras, y el JSON entero solo gastaba tokens.
        msgs[-1]["content"] += (
            "\n\n[Barras HOY en el editor — para operar_barras usa estos numeros]\n"
            + _inventario_receta(body.receta_actual))
    return msgs


def _catalogo_texto(filas) -> str:
    """Lista compacta del catalogo para el prompt: `codigo:lados[:angulos]`.

    POR QUE VA COMPLETO Y DESDE LA BD (usuario 31-ago): el asistente tenia solo el
    resumen escrito a mano del documento de conocimiento y lo trato como si fuera
    todo el catalogo — le pidieron la figura 104B (que EXISTE) y contesto que no,
    ofreciendo "las familias 104 son 104A y 104D". Una lista parcial dentro de un
    prompt no se lee como parcial. El catalogo es DATO y vive en figuras_catalogo:
    se manda entero y no queda nada que sincronizar a mano."""
    if not filas:
        return ""
    partes = []
    for fila in filas:
        codigo, parciales, angulos = fila[0], fila[1], fila[2]
        if not codigo:
            continue
        lados = len(parciales or [])
        ang = "/".join(str(int(a)) for a in (angulos or []))
        partes.append("%s:%d%s" % (codigo, lados, (":" + ang) if ang else ""))
    if not partes:
        return ""
    cab = ("\n\nCATALOGO COMPLETO DE FIGURAS (codigo:lados:angulos de los dobleces). "
           "ES LA LISTA COMPLETA: si un codigo esta aca, EXISTE y puedes usarlo; si "
           "no esta, no existe. No supongas familias ni inventes codigos.\n")
    return cab + " \u00b7 ".join(partes)


def _catalogo_de_figuras(cur) -> str:
    """Lee el catalogo activo (1 consulta) y lo deja listo para el prompt."""
    try:
        cur.execute("SELECT codigo, parciales, angulos FROM figuras_catalogo "
                    "WHERE activo IS NOT FALSE ORDER BY codigo")
        return _catalogo_texto(cur.fetchall())
    except Exception as _e:      # sin catalogo el asistente sigue, solo mas ciego
        log.warning("asistente: no se pudo leer el catalogo de figuras: %s", _e)
        return ""


def _figuras_de(cur, spec: dict):
    """Catalogo (1 consulta) de las figuras que la ficha nombra + los defaults, para
    que el constructor escriba las dims y angulos REALES de cada una."""
    codigos = {"101A", "103B", "106A"}
    for k in ("malla_vertical", "malla_horizontal", "trabas"):
        d = spec.get(k)
        if isinstance(d, dict) and d.get("figura"):
            codigos.add(str(d["figura"]).strip().upper())
    bo = spec.get("bordes")
    if isinstance(bo, dict):
        for k in ("barras", "estribo"):
            d = bo.get(k)
            if isinstance(d, dict) and d.get("figura"):
                codigos.add(str(d["figura"]).strip().upper())
    try:
        from .catalogo import cargar_figuras
        return cargar_figuras(cur, codigos)
    except Exception:      # el constructor cae a su tabla de respaldo
        return None


# ---------------------------------------------------------------------------
# ERRORES EN CASTELLANO — que paso, de quien es y que hacer
# ---------------------------------------------------------------------------
# El usuario no tiene por que traducir un 400 de la API ni traerle el texto a
# nadie (pedido 31-ago). Cada error conocido se explica en una linea, dice si es
# problema del PROGRAMA o pasajero, y que hacer. El detalle tecnico se conserva
# al final, para quien lo necesite.
_EXPLICACIONES = [
    ("union types",
     "El formulario interno del asistente tiene demasiados campos opcionales para "
     "lo que la API acepta. Es un problema del programa, no de lo que pediste."),
    ("compiled grammar",
     "El formulario interno del asistente quedo demasiado grande para la API. Es un "
     "problema del programa, no de lo que pediste."),
    ("max_tokens",
     "La respuesta pedida excede el maximo permitido. Es un problema del programa."),
    ("context",
     "La conversacion se hizo demasiado larga para un solo pedido. Cierra el chat y "
     "abrelo de nuevo para empezar limpio; el muro que ya cargaste no se pierde."),
    ("credit",
     "La cuenta de la API se quedo sin credito. Avisale al administrador para que "
     "recargue."),
    ("billing",
     "Hay un problema de facturacion en la cuenta de la API. Avisale al administrador."),
    ("rate limit",
     "Se hicieron muchas consultas seguidas. Espera unos segundos y reenvia."),
    ("overloaded",
     "La API esta saturada en este momento. Espera unos segundos y reenvia."),
    ("authentication",
     "La clave de la API no es valida o falta. Avisale al administrador."),
    ("permission",
     "La clave de la API no tiene permiso para este modelo. Avisale al administrador."),
    ("not_found",
     "El modelo configurado no existe o cambio de nombre. Es un problema del programa."),
]


def _explicacion_api(status: int, texto: str) -> str:
    """Una linea en castellano que diga QUE paso y QUE hacer."""
    t = (texto or "").lower()
    for clave, explicacion in _EXPLICACIONES:
        if clave in t:
            return explicacion
    if status >= 500:
        return ("La API tuvo un problema pasajero y los reintentos tampoco pasaron. "
                "Reenvia el mensaje en unos segundos.")
    if status == 400:
        return ("La peticion que arma el asistente no fue valida. Es un problema del "
                "programa, no de lo que pediste.")
    return "El asistente no pudo responder por un problema tecnico."


def _detalle_error(status: int, texto: str) -> str:
    """Explicacion simple + el texto tecnico detras, recortado."""
    simple = _explicacion_api(status, texto)
    tec = (texto or "").strip().replace(chr(10), " ")[:300]
    return simple + ("  ·  Detalle tecnico: " + tec if tec else "")


def _tope_diario(email: str):
    clave = (email, date.today().isoformat())
    n = _llamadas.get(clave, 0) + 1
    _llamadas[clave] = n
    if n > _MAX_LLAMADAS_DIA:
        raise HTTPException(status_code=429,
                            detail="Llegaste al tope diario del asistente. Vuelve mañana o avisa al administrador.")


def _extraer(respuesta):
    """(texto, spec, cambios, ids_de_tool_use) de una respuesta de la API."""
    texto, spec, cambios, tus = [], None, None, []
    for b in respuesta.content:
        if b.type == "text" and b.text:
            texto.append(b.text)
        elif b.type == "tool_use":
            tus.append(b.id)
            if b.name == "proponer_muro":
                spec = b.input
            elif b.name == "operar_barras":
                cambios = (b.input or {}).get("cambios")
    return "\n".join(texto).strip(), spec, cambios, tus


def _figuras_para(cur, spec, cambios):
    """Catalogo de TODAS las figuras nombradas (ficha + cambios) + defaults."""
    base = spec if isinstance(spec, dict) else {}
    figs = _figuras_de(cur, base)
    extras = {str(cb.get("figura") or "").strip().upper()
              for cb in (cambios or []) if isinstance(cb, dict)}
    extras = {f for f in extras if f}
    if not extras:
        return figs
    try:
        from .catalogo import cargar_figuras
        codigos = {"101A", "103B", "106A"} | extras
        for k in ("malla_vertical", "malla_horizontal", "trabas"):
            d = base.get(k)
            if isinstance(d, dict) and d.get("figura"):
                codigos.add(str(d["figura"]).strip().upper())
        return cargar_figuras(cur, codigos)
    except Exception:
        return figs


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

            catalogo = _catalogo_de_figuras(cur)
            # max_retries=3: los 429/500/529 de la API son PASAJEROS y el SDK los
            # reintenta con espera creciente. Con 1 solo intento extra, un 500
            # («Unable to complete this request right now») llegaba a la pantalla del
            # usuario como si fuera un error suyo — le paso el 31-ago.
            client = anthropic.Anthropic(timeout=90.0, max_retries=3)

            def _llamar(msgs):
                return client.messages.create(
                    model=ASISTENTE_MODEL,
                    max_tokens=2048,
                    # Velocidad (feedback usuario 31-ago: "muy lento"): esfuerzo
                    # medio — la ficha es extraccion simple, no necesita pensar
                    # largo. Si la calidad baja, subir a "high".
                    output_config={"effort": "medium"},
                    system=_system_prompt(elemento, catalogo),
                    tools=[TOOL_MURO, TOOL_OPERAR],
                    tool_choice={"type": "auto"},
                    messages=msgs,
                )

            try:
                resp = _llamar(mensajes)
                texto, spec, cambios, tu_ids = _extraer(resp)

                receta = resumen = None
                avisos = []
                spec_ok = None
                figuras = _figuras_para(cur, spec, cambios)

                def _armar(spec_x, cambios_x):
                    """(receta|None, spec_ok|None) a partir de lo que llamo el
                    modelo: la ficha arma de cero, los cambios operan sobre lo
                    construido o sobre lo que hay en el editor."""
                    r, sp = None, None
                    if spec_x is not None:
                        try:
                            nf = _normalizar_ficha(spec_x)
                            r, sp = _construir_receta_muro(nf, figuras), nf
                        except ValueError:
                            log.info("asistente: ficha incompleta (%s)", email)
                    if cambios_x:
                        base = r if r is not None else body.receta_actual
                        if not base:
                            avisos.append("No hay un muro abierto sobre el cual operar.")
                        else:
                            try:
                                r, avs = _aplicar_cambios(base, cambios_x, figuras)
                                avisos.extend(avs)
                                sp = None      # el resumen sale de la receta operada
                            except ValueError as exc:
                                avisos.append(str(exc))
                                r = None
                    return r, sp

                # COMPUERTA ANTI-BORRADO (31-ago): el modelo uso proponer_muro para
                # «agrega una malla vertical» y la auto-carga PISO los cabezales y
                # las mallas ya armadas. Que no vuelva a depender del criterio del
                # modelo: con barras en el editor, rehacer el muro exige rehacer=1
                # (que solo debe poner si el usuario lo pidio expresamente); si no,
                # se le devuelve el tool_result con la instruccion de operar.
                def _bloqueado(sp):
                    return (sp is not None
                            and (body.receta_actual or {}).get("componentes")
                            and int(_num(sp.get("rehacer"))) != 1)

                if _bloqueado(spec) and tu_ids:
                    n_barras = len(body.receta_actual["componentes"])
                    contenido = [{"type": "tool_result", "tool_use_id": t,
                                  "is_error": True,
                                  "content": "Hay %d barras en el editor. Reconstruir "
                                             "con proponer_muro las BORRARIA. Para "
                                             "cambios puntuales llama operar_barras "
                                             "con los numeros del listado; solo si el "
                                             "usuario pidio rehacer el muro completo, "
                                             "repite proponer_muro con rehacer=1."
                                             % n_barras} for t in tu_ids]
                    resp = _llamar(mensajes + [
                        {"role": "assistant", "content": resp.content},
                        {"role": "user", "content": contenido},
                    ])
                    texto2, spec, cambios, tu_ids = _extraer(resp)
                    texto = texto2 or texto
                    figuras = _figuras_para(cur, spec, cambios)
                if receta is None and isinstance(spec, dict):
                    pass
                if _bloqueado(spec):
                    avisos.append("Descarté rehacer el muro entero: hay barras en "
                                  "el editor y no pediste rehacerlo.")
                    spec = None

                receta, spec_ok = _armar(spec, cambios)

                if receta is not None:
                    errores = _validar_receta(cur, receta)
                    if errores and tu_ids:
                        # UN reintento con el error como feedback (decision 13).
                        # tool_result para CADA tool_use del turno: la API exige
                        # respuesta a todos.
                        contenido = [{"type": "tool_result", "tool_use_id": t,
                                      "is_error": True,
                                      "content": "La receta no pasó la validación: "
                                                 + " · ".join(errores)
                                                 + " Corrige y llama la herramienta de nuevo."}
                                     for t in tu_ids]
                        resp2 = _llamar(mensajes + [
                            {"role": "assistant", "content": resp.content},
                            {"role": "user", "content": contenido},
                        ])
                        texto2, spec2, cambios2, _tu2 = _extraer(resp2)
                        texto = texto2 or texto
                        figuras = _figuras_para(cur, spec2, cambios2)
                        receta, spec_ok = _armar(spec2, cambios2)
                        errores = _validar_receta(cur, receta) if receta is not None else errores
                    if errores:
                        log.warning("asistente: receta invalida tras reintento (%s): %s",
                                    email, errores)
                        receta = None
                        texto = (texto + "\n\n(No pude dejar la receta válida: "
                                 + " · ".join(errores) + ")").strip()

                if receta is not None:
                    avisos.extend(receta.pop("_avisos_reglas", []) or [])
                    resumen = (_resumen_de_spec(spec_ok) if spec_ok
                               else _resumen_de_receta(receta))
                if avisos:
                    texto = (texto + "\n\n" + " ".join(avisos)).strip()
                if receta is None and not texto:
                    texto = ("Me falta algo para armarlo. Dime al menos las "
                             "dimensiones del muro y qué armadura quieres.")
                if receta is not None and not texto:
                    texto = ("Listo — apliqué los cambios y cargué el resultado "
                             "al editor. Revísalo en el 3D; si algo no calza, dime.")
                if receta is not None:
                    # RASTRO DE ESTADO: el historial (que es lo unico que el modelo
                    # recuerda) lleva turno a turno lo que quedo en el editor.
                    texto = (texto + "\n\nQuedó en el editor: "
                             + _estado_corto(receta)).strip()
                return {"texto": texto, "receta": receta, "resumen": resumen}

            except anthropic.AuthenticationError as e:
                raise HTTPException(status_code=503,
                                    detail=_detalle_error(401, str(e)))
            except anthropic.RateLimitError as e:
                raise HTTPException(status_code=503,
                                    detail=_detalle_error(429, str(e)))
            except anthropic.APIStatusError as e:
                if "credit" in str(e).lower() or "billing" in str(e).lower():
                    raise HTTPException(status_code=402,
                                        detail=_detalle_error(402, str(e)))
                # EL MOTIVO SE DICE, NO SE ESCONDE (31-ago). Un «tuvo un problema,
                # intenta de nuevo» mandó al usuario a reintentar algo que no iba a
                # funcionar: el error real era de la petición (schema, parámetro),
                # no un tropiezo pasajero. Se muestra el mensaje de la API recortado
                # — esta pantalla es interna y quien la usa necesita el dato.
                log.error("asistente: error de API (%s): %s", email, e)
                raise HTTPException(
                    status_code=502,
                    detail=_detalle_error(getattr(e, "status_code", 0) or 0,
                                          str(getattr(e, "message", None) or e)))
            except anthropic.APIConnectionError as e:
                raise HTTPException(
                    status_code=502,
                    detail="No se pudo conectar con la API (problema de red del "
                           "servidor). Reenvia en unos segundos.  ·  Detalle "
                           "tecnico: " + str(e)[:200])
            except anthropic.APITimeoutError as e:
                raise HTTPException(
                    status_code=504,
                    detail="La API tardo demasiado en responder. Reenvia el mensaje; "
                           "si se repite, acorta el pedido.  ·  Detalle tecnico: "
                           + str(e)[:200])
