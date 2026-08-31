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
                 "tramos", "lado_dominante", "giro_patas", "color"],
    "properties": {
        "diam": {"type": "number", "description": "φ en mm"},
        "sep": {"type": "number", "description": "@ en cm"},
        "figura": _FIGURA_PROP,
        "jerarquia": _JERARQUIA_PROP,
        "empalme": _EMPALME_PROP,
        "pata": _PATA_PROP,
        "tramos": _TRAMOS_PROP,
        "lado_dominante": _DOMINANTE_PROP,
        "giro_patas": _GIRO_PATAS_PROP,
        "color": _COLOR_PROP,
    },
}

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
                     "doble_malla", "trabas", "bordes", "origenes"],
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
                                          "empalme", "pata", "sep_capas", "color"],
                             "properties": {
                                 "diam": {"type": "number", "description": "φ cabezal en mm"},
                                 "barras_capa": {"type": "integer", "description": "barras por capa (a lo ancho)"},
                                 "n_capas": {"type": "integer", "description": "capas hacia el interior del muro"},
                                 "figura": _FIGURA_PROP,
                                 "empalme": _EMPALME_PROP,
                                 "pata": _PATA_PROP,
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
                                   "description": "largo confinado por punta, cm (usual ≥ 40)"},
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


def _construir_receta_muro(spec: dict, figuras=None) -> dict:
    """Ficha simple -> receta {tipo,geometria,componentes[]} EXACTAMENTE como los
    crea el Template Editor a mano (mapa del 31-ago sobre reglas.js /
    template_editor.js / tests):
      - mallas = tipologias MV/MH reales, modo LINEAL, UNA CORTINA POR COMPONENTE
        (lado +-1: "dos cortinas son DOS componentes, no 2 capas de uno",
        test_muro_orientaciones.js:357);
      - trabas = TC pose {sup,1,z} (cruzan el espesor), figura con ganchos 104B,
        modo arreglo con rango (x) + rango2 (y), jerarquia 2;
      - bordes = CB en el testero (cara 'extremo', puntual layered) + EC acotado
        a la punta (dims.B fija con extremo + pos_hint.x; sin posicion el motor
        centra - template_editor.js:7318);
      - rangos con from/to de linea de recub a linea de recub, SIN ancla: la
        deriva normalizarReceta al abrir (migracion sin movimiento, reglas.js:1698).
    Nada del modelo toca geometria. Verificado contra el MOTOR REAL por
    tests/test_asistente_receta_motor.js (node)."""
    g = spec["geometria"]
    largo, alto = float(g["largo"]), float(g["alto"])
    esp, rec = float(g["espesor"]), float(g["recubrimiento"])
    doble = bool(spec.get("doble_malla", True))
    rx, ry = largo / 2.0 - rec, alto / 2.0 - rec   # lineas de recubrimiento

    def _lin(sep, eje, lo, hi, tramos=None):
        """Distribucion lineal. Con `tramos` el rango se subdivide (@10 los primeros
        80, @20 el resto): el motor reparte por tramos y el @ simple deja de mandar
        (template_editor.js:9106). Los tramos van en el ORDEN dado, desde `from`."""
        d = {"modo": "linear", "activa": True, "sep": _r1(sep),
             "zonas": [{"long": 0, "sep": _r1(sep)}], "start_offset": 4,
             "rango": {"eje": eje, "from": _r1(lo), "to": _r1(hi), "sep": _r1(sep)}}
        if tramos:
            d["rango"]["tramos"] = [{"long": _r1(t["long"]), "sep": _r1(t["sep"])}
                                    for t in tramos if t.get("long") and t.get("sep")]
        return d

    def _extras(comp, d):
        """Campos sueltos que el usuario puede dictar y que no cambian la forma de
        armar: lado dominante (que lado manda en la figura), giro de las patas y
        anidado de capas. Se escriben SOLO si vinieron: el default de la plataforma
        es el que sabe, y un valor puesto porque si cambia dims."""
        dom = (d or {}).get("lado_dominante")
        if dom:
            comp["lado_dominante"] = str(dom).strip().upper()
        giro = (d or {}).get("giro_patas")
        if giro in (0, 90, 180, 270):
            comp["orient"] = {"spin": int(giro)}
        anid = (d or {}).get("anidar")
        if anid in (0, 1, True, False):        # -1 (o ausente) = default de la casa
            comp["distribucion"]["anidar"] = bool(anid)
        col = _hex_color((d or {}).get("color"))
        if col:
            comp["color"] = col
        return comp

    def _base(tip, figura, diam, angulos, modo, cara, lado, rumbo,
              orientacion, volteado, dims, jer, dist):
        return {"tipologia": tip, "figura": figura, "diam": float(diam),
                "suf_tipo": "", "recub_override": None, "angulos": list(angulos),
                "comp_id": None, "modo": modo,
                "pose": {"cara": cara, "lado": lado, "rumbo": rumbo, "espejo": False},
                "cara": cara, "lado": lado,
                "plano_pieza": {"orientacion": orientacion, "volteado": volteado},
                "arreglo": {"n_capas": 1, "sep_capas": 20, "rango": None},
                "dims": dims, "jerarquia": jer, "distribucion": dist, "pos_hint": {}}

    def _autoA():
        return {"A": {"modo": "auto"}}

    def _autoABCD():
        return {L: {"modo": "auto"} for L in ("A", "B", "C", "D")}

    def _dimsDe(parciales, empalme=None, pata=None, phi=None, patas_fijas=False):
        """Dims del componente: cuerpo en auto, patas segun lo pedido, y el
        EMPALME como Delta del lado que CORRE.

        EL LADO QUE CORRE ES **B** siempre que la figura lo tenga; A (y C, D)
        son las patas. Medido con el motor el 31-ago sobre un cabezal 102A: con
        el empalme puesto en A la barra se iba 266 cm fuera del muro; con B como
        cuerpo queda correcta (A = pata horizontal, B = alto completo).

        PATAS EN AUTO NO SIRVEN PARA UN CABEZAL: en su pose (cara extremo) el
        motor le resuelve la pata contra el LARGO del muro. MEDIDO: 102A todo en
        auto dio A = 508 cm en un muro de 514 — la barra en forma de peineta que
        el usuario vio y que el editor marca como fierro fuera del hormigon. Por
        eso el cabezal escribe sus patas FIJAS: lo que el usuario pidio, o el
        gancho normativo si no dijo nada. En trabas y estribos el auto SI resuelve
        bien (medido tambien), y ahi se deja.

        El traslapo va como Delta en cm sobre el lado que corre, con la flecha en
        fin: crece hacia arriba y el arranque se queda quieto."""
        dims = {L: {"modo": "auto"} for L in parciales}
        corre = "B" if "B" in dims else (parciales[0] if parciales else None)
        if pata or patas_fijas:
            largo_pata = _r1(pata) if pata else _r1(max(7.5, float(phi or 8)))
            for L in parciales:
                if L != corre:
                    dims[L] = {"modo": "fija", "valor": largo_pata}
        if empalme and corre:
            dims[corre]["delta"] = _r1(empalme)
            dims[corre]["extremo"] = "fin"
        return dims

    def _pedido(d, clave, porDefecto):
        v = (d or {}).get(clave)
        return v if v not in (None, "", 0) else porDefecto

    comps = []
    mv, mh = spec["malla_vertical"], spec["malla_horizontal"]
    fmv = _pedido(mv, "figura", "101A")
    fmh = _pedido(mh, "figura", "101A")
    pmv, amv = _spec_figura(figuras, fmv, ["A"], [])
    pmh, amh = _spec_figura(figuras, fmh, ["A"], [])
    jmv = int(_pedido(mv, "jerarquia", 1))
    jmh = int(_pedido(mh, "jerarquia", 1))
    for lado in ([1, -1] if doble else [1]):
        comps.append(_extras(_base("MV", fmv, mv["diam"], amv, "lineal",
                           "lateral", lado, "y", "de_pie", False,
                           _dimsDe(pmv, mv.get("empalme"), mv.get("pata"),
                                   mv["diam"]), jmv,
                           _lin(mv["sep"], "x", -rx, rx, mv.get("tramos"))), mv))
        comps.append(_extras(_base("MH", fmh, mh["diam"], amh, "lineal",
                           "lateral", lado, "x", "acostada", False,
                           _dimsDe(pmh, mh.get("empalme"), mh.get("pata"),
                                   mh["diam"]), jmh,
                           _lin(mh["sep"], "y", -ry, ry, mh.get("tramos"))), mh))

    tr = spec.get("trabas")
    if doble and tr:
        dist = _lin(tr["sx"], "x", -rx, rx, tr.get("tramos"))
        dist["modo"] = "arreglo"
        # La 103B cuelga su gancho HACIA ABAJO de la fila (~6phi + curva): si la
        # primera fila nace en la linea de recub, el gancho se sale del hormigon
        # (medido 31-ago: fila -155.5 -> gancho -165). Se le da ese margen abajo.
        m_gancho = 6.0 * float(tr["diam"]) / 10.0 + 5.0
        dist["rango2"] = {"eje": "y", "from": _r1(-(ry - m_gancho)), "to": _r1(ry),
                          "sep": _r1(tr["sy"])}
        # 103B por defecto = cuerpo + 2 ganchos: "eso es una traba" (reglas.js:1284,
        # medido). Con 104D/104B el lado C en auto resolvia contra el ALTO (pieza de
        # 311 cm fuera del hormigon — medido 31-ago). El usuario puede pedir otra.
        ftr = _pedido(tr, "figura", "103B")
        ptr, atr = _spec_figura(figuras, ftr, ["A", "B", "C"], [45, 45])
        comps.append(_extras(_base("TC", ftr, tr["diam"], atr, "arreglo",
                                   "sup", 1, "z", "volteada", True,
                                   _dimsDe(ptr), int(_pedido(tr, "jerarquia", 2)),
                                   dist), tr))

    bo = spec.get("bordes")
    if bo:
        bb, est = bo["barras"], bo.get("estribo")
        lconf = float(bo.get("largo") or 40)
        fcb = _pedido(bb, "figura", "101A")
        pcb, acb = _spec_figura(figuras, fcb, ["A"], [])
        for lado in (1, -1):
            comps.append(_base("CB", fcb, bb["diam"], acb, "puntual",
                               "extremo", lado, "y", "de_pie", False,
                               _dimsDe(pcb, bb.get("empalme"), bb.get("pata"),
                                       bb["diam"], patas_fijas=True), 1,
                               {"modo": "layered",
                                "n_capas": max(1, int(bb["n_capas"])),
                                "barras_capa": max(1, int(bb["barras_capa"])),
                                "gap": _r1(bb.get("sep_capas") or 4),
                                "sentido": "nucleo",
                                "justify": "repartir"}))
            if est:
                # extremo 'centro' + pos_hint.x = la UNICA combinacion que el
                # motor respeta tal cual (medido 31-ago: 'fin' ignora el hint y
                # cae al testero opuesto; hint+pos_ancla se pasa del hormigon).
                # 106A = el estribo de la casa (correccion del usuario 31-ago).
                # Medido contra el motor: 6 lados, cierra, ganchos de 45 grados —
                # tramos [8.6, 37.2, 15.2, 39.2, 13.2, 8.6] con B fija en 40.
                fec = _pedido(est, "figura", "106A")
                pec, aec = _spec_figura(figuras, fec,
                                        ["A", "B", "C", "D", "E", "F"], [45, 45])
                dec = _dimsDe(pec)
                # El largo confinado se escribe en el lado B (el que corre a lo largo
                # del muro en un marco de 4 lados). Si la figura pedida no tiene B, no
                # hay donde acotarla: queda en auto y el estribo abraza lo que da.
                if "B" in dec:
                    dec["B"] = {"modo": "fija", "valor": _r1(lconf), "extremo": "centro"}
                ec = _base("EC", fec, est["diam"], aec, "lineal",
                           "lateral", 1, "y", "de_pie", False, dec,
                           int(_pedido(est, "jerarquia", 1)),
                           _lin(est["sep"], "y", -ry, ry, est.get("tramos")))
                _extras(ec, est)
                ec["pos_hint"] = {"x": _r1(lado * (largo / 2.0 - rec - lconf / 2.0))}
                comps.append(ec)

    return {
        "tipo": "muro",
        "geometria": {"largo": _r1(largo), "alto": _r1(alto), "ancho": _r1(esp),
                      "recub_sup": _r1(rec), "recub_inf": _r1(rec),
                      "recub_lat": _r1(rec)},
        "componentes": comps,
    }


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
    partes = ["%d malla%s vertical%s" % (n, "s" if n > 1 else "", "es" if n > 1 else ""),
              "%d horizontal%s" % (n, "es" if n > 1 else "")]
    if spec.get("doble_malla", True) and spec.get("trabas"):
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
         "valor": f"φ{spec['malla_vertical']['diam']:g} @ {spec['malla_vertical']['sep']:g}"
                  + _detalle_fig(spec["malla_vertical"]),
         "origen": org("malla_vertical")},
        {"label": "Malla horizontal",
         "valor": f"φ{spec['malla_horizontal']['diam']:g} @ {spec['malla_horizontal']['sep']:g}"
                  + _detalle_fig(spec["malla_horizontal"]),
         "origen": org("malla_horizontal")},
        {"label": "Mallas", "valor": "doble" if spec.get("doble_malla", True) else "simple",
         "origen": org("doble_malla")},
    ]
    tr = spec.get("trabas")
    filas.append({"label": "Trabas",
                  "valor": ((f"φ{tr['diam']:g} · {tr['sx']:g} × {tr['sy']:g}"
                             + _detalle_fig(tr)) if tr else "sin trabas"),
                  "origen": org("trabas")})
    emp = (spec["malla_vertical"].get("empalme")
           or spec["malla_horizontal"].get("empalme"))
    if emp:
        filas.append({"label": "Empalme",
                      "valor": ("MV +%g cm" % spec["malla_vertical"]["empalme"]
                                if spec["malla_vertical"].get("empalme")
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
        msgs[-1]["content"] += (
            "\n\n[Estado actual del editor — receta que el usuario tiene en "
            "pantalla; si pide modificar, parte de esto]\n"
            + json.dumps(body.receta_actual, ensure_ascii=False))
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

            catalogo = _catalogo_de_figuras(cur)
            client = anthropic.Anthropic(timeout=90.0, max_retries=1)

            def _llamar(msgs):
                return client.messages.create(
                    model=ASISTENTE_MODEL,
                    max_tokens=2048,
                    # Velocidad (feedback usuario 31-ago: "muy lento"): esfuerzo
                    # medio — la ficha es extraccion simple, no necesita pensar
                    # largo. Si la calidad baja, subir a "high".
                    output_config={"effort": "medium"},
                    system=_system_prompt(elemento, catalogo),
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
                    receta = _construir_receta_muro(spec, _figuras_de(cur, spec))
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
                            receta = _construir_receta_muro(spec2, _figuras_de(cur, spec2))
                            errores = _validar_receta(cur, receta)
                        if errores:
                            log.warning("asistente: receta inválida tras reintento (%s): %s",
                                        email, errores)
                            receta = None
                            texto = (texto + "\n\n(No pude dejar la receta válida: "
                                     + " · ".join(errores) + ")").strip()
                    if receta is not None:
                        resumen = _resumen_de_spec(spec_ok)

                # El modelo a veces llama la herramienta SIN texto (visto en la
                # primera prueba real): la respuesta "…" parecia un cuelgue. Si
                # hay receta y no hay palabras, se pone la frase de cierre.
                if receta is not None and not texto:
                    texto = ("Listo — armé la receta y la cargué al editor como "
                             "borrador. Revísala en el 3D; si quieres ajustar "
                             "algo, dime.")
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
                # EL MOTIVO SE DICE, NO SE ESCONDE (31-ago). Un «tuvo un problema,
                # intenta de nuevo» mandó al usuario a reintentar algo que no iba a
                # funcionar: el error real era de la petición (schema, parámetro),
                # no un tropiezo pasajero. Se muestra el mensaje de la API recortado
                # — esta pantalla es interna y quien la usa necesita el dato.
                log.error("asistente: error de API (%s): %s", email, e)
                motivo = str(getattr(e, "message", None) or e)[:400]
                raise HTTPException(
                    status_code=502,
                    detail="El asistente no pudo responder. Motivo técnico: " + motivo)
            except anthropic.APIConnectionError:
                raise HTTPException(status_code=502,
                                    detail="Sin conexión con el asistente. Intenta de nuevo.")
