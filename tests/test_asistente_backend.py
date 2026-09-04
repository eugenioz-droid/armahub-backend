# -*- coding: utf-8 -*-
"""Tests del Asistente IA (SPECS §12) — SOLO lo que se puede medir de verdad
sin llamar a la API: el constructor determinístico ficha→receta (los números
salen del patrón canónico de tests/test_muro_orientaciones.js), el armado de
mensajes y el cableado (router montado, script cargado). Sin mocks del modelo:
la conversación real se prueba en la web (feedback del usuario 30-ago)."""
import os, sys, io

# La consola de Windows arranca en cp1252 y los checks usan φ/±: forzar UTF-8.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

# STUBS: este test corre en la maquina del usuario, donde no estan instaladas
# las dependencias del server (fastapi/psycopg viven en Render). Lo probado aqui
# es PURO (constructor de receta, mensajes, schema): las dependencias solo se
# necesitan para importar el modulo, asi que se stubbean ANTES del import.
import types


def _stub(nombre, **attrs):
    m = types.ModuleType(nombre)
    for k, v in attrs.items():
        setattr(m, k, v)
    sys.modules[nombre] = m
    return m


class _HTTPException(Exception):
    def __init__(self, status_code=500, detail=""):
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


class _Router:
    def post(self, *a, **k):
        return lambda f: f


class _BaseModel:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


if "fastapi" not in sys.modules:
    try:
        import fastapi  # noqa: F401 — si existe de verdad, se usa la real
    except ImportError:
        _stub("fastapi", APIRouter=_Router, Depends=lambda x: x,
              HTTPException=_HTTPException)
        _stub("pydantic", BaseModel=_BaseModel)
        _stub("armahub.db", get_conn=lambda: None, audit=lambda *a, **k: None)
        _stub("armahub.auth", get_current_user=lambda: None)
        import armahub
        sys.modules["armahub.db"].__package__ = "armahub"

FALLAS = []


def _de_falta(spec):
    """El motivo textual con que se rechaza una ficha incompleta."""
    from armahub.asistente import _normalizar_ficha as _nf
    try:
        _nf(spec)
        return ""
    except ValueError as exc:
        return str(exc)


def _falla_critico(spec):
    """True si la ficha se rechaza por falta de datos criticos (lo correcto)."""
    from armahub.asistente import _normalizar_ficha as _nf
    try:
        _nf(spec)
        return False
    except ValueError:
        return True


def check(nombre, cond):
    print(("OK  " if cond else "FALLA ") + nombre)
    if not cond:
        FALLAS.append(nombre)


from armahub.asistente import _construir_receta_muro, _resumen_de_spec, TOOL_MURO

# --- ficha completa (muro real del usuario 31-ago: DM + trabas + bordes) ---
SPEC = {
    "geometria": {"largo": 514, "alto": 315, "espesor": 20, "recubrimiento": 2},
    "malla_vertical": {"diam": 8, "sep": 20},
    "malla_horizontal": {"diam": 8, "sep": 20},
    "doble_malla": True,
    "trabas": {"diam": 8, "sx": 40, "sy": 40, "figura": "", "jerarquia": 0,
               "tramos": [], "anidar": -1},
    "bordes": {"barras": {"diam": 18, "barras_capa": 2, "n_capas": 2},
               "estribo": {"diam": 8, "sep": 10}, "largo": 40},
    "origenes": {"geometria": "leido", "recubrimiento": "leido",
                 "malla_vertical": "leido", "malla_horizontal": "leido",
                 # `trabas` pasa de "config" a "leido": desde el 1-sep el origen dice QUIEN
                 # DECIDIO que la armadura exista, no de donde salieron sus numeros,
                 # y solo "leido" (la pidio el usuario) la construye. Este muro SI
                 # llevaba trabas pedidas, asi que corresponde "leido".
                 "doble_malla": "asumido", "trabas": "leido", "bordes": "leido"},
}

r = _construir_receta_muro(SPEC)
tips = [c["tipologia"] for c in r["componentes"]]
check("tipologias REALES del muro (MV/MH x2 cortinas + TC + CB/EC x2 puntas)",
      tips == ["MV", "MH", "MV", "MH", "TR", "CB", "EC", "CB", "EC"])
mvs = [c for c in r["componentes"] if c["tipologia"] == "MV"]
check("cada cortina es UN componente con lado +-1 (no capas)",
      [c["lado"] for c in mvs] == [1, -1]
      and all(c["modo"] == "lineal" and c["distribucion"]["modo"] == "linear"
              and c["distribucion"]["activa"] for c in mvs))
check("MV de pie reparte en x; MH acostada reparte en y",
      mvs[0]["plano_pieza"]["orientacion"] == "de_pie"
      and mvs[0]["distribucion"]["rango"]["eje"] == "x"
      and r["componentes"][1]["distribucion"]["rango"]["eje"] == "y")
tc = [c for c in r["componentes"] if c["tipologia"] == "TR"][0]
check("traba de muro TR: figura con ganchos 103B, pose sup/z, arreglo x*y y jer.3 por regla",
      tc["figura"] == "103B" and tc["pose"] == {"cara": "sup", "lado": 1,
                                                "rumbo": "z", "espejo": False}
      and tc["jerarquia"] == 3 and tc["distribucion"]["rango2"]["eje"] == "y")
cbs = [c for c in r["componentes"] if c["tipologia"] == "CB"]
check("cabezales en las DOS puntas (cara extremo, lado +-1, layered 2x2)",
      [c["lado"] for c in cbs] == [1, -1]
      and all(c["cara"] == "extremo" and c["distribucion"]["modo"] == "layered"
              and c["distribucion"]["n_capas"] == 2
              and c["distribucion"]["barras_capa"] == 2 for c in cbs))
ecs = [c for c in r["componentes"] if c["tipologia"] == "EC"]
check("estribo de borde acotado: dims.B fija 40 extremo centro + pos_hint.x en la punta",
      all(c["dims"]["B"] == {"modo": "fija", "valor": 40.0, "extremo": "centro"}
          for c in ecs)
      and ecs[0]["pos_hint"]["x"] == 235.0 and ecs[1]["pos_hint"]["x"] == -235.0)
# La MH no la recorta ninguna regla, asi que es la que mide «de recub a recub».
_mh0 = [c for c in r["componentes"] if c["tipologia"] == "MH"][0]
check("rangos sin ancla (la deriva normalizarReceta) y de recub a recub",
      "ancla" not in mvs[0]["distribucion"]["rango"]
      and _mh0["distribucion"]["rango"]["from"] == -(315 / 2 - 2))

# --- FIGURA Y JERARQUIA LAS DICTA EL USUARIO (feedback 31-ago: el asistente decia
#     que no eran suyas y mandaba a reportar un bug inexistente) ---
SPEC_FIG = dict(SPEC,
                malla_horizontal=dict(SPEC["malla_horizontal"], figura="104B", jerarquia=1),
                trabas=dict(SPEC["trabas"], figura="103E", jerarquia=3))
rf = _construir_receta_muro(SPEC_FIG)
mh_f = [c for c in rf["componentes"] if c["tipologia"] == "MH"]
tc_f = [c for c in rf["componentes"] if c["tipologia"] == "TR"][0]
check("la figura pedida para la malla horizontal llega a la receta",
      all(c["figura"] == "104B" and c["jerarquia"] == 1 for c in mh_f))
check("y la jerarquia DICTADA gana sobre la regla de jerarquias",
      all(c["jerarquia"] == 1 for c in mh_f))
check("la figura y jerarquia pedidas para la traba de muro llegan a la receta",
      tc_f["figura"] == "103E" and tc_f["jerarquia"] == 3)
check("sin figura pedida la MH sale 104B, que es el default de la casa (NO la recta)",
      [c["figura"] for c in r["componentes"] if c["tipologia"] == "MH"] == ["104B", "104B"])
check("el resumen muestra la figura solo cuando el usuario la dicto",
      any("104B" in f.get("valor", "") for f in _resumen_de_spec(SPEC_FIG))
      and not any("101A" in f.get("valor", "") for f in _resumen_de_spec(SPEC)))

# --- EL PEDIDO QUE SALIO DEFORME (31-ago): cabezales 102A con pata 25, empalme
#     6phi, phi22, 2 capas x 2 barras, capas cada 15. La pata en AUTO media 508 cm
#     (el largo del muro) y la barra salia como una peineta cruzando el muro.
CAT = {"101A": {"parciales": ["A"], "angulos": []},
       "102A": {"parciales": ["A", "B"], "angulos": []},
       "103B": {"parciales": ["A", "B", "C"], "angulos": [45, 45]},
       "104D": {"parciales": ["A", "B", "C", "D"], "angulos": [135, 135]},
       "106A": {"parciales": ["A", "B", "C", "D", "E", "F"], "angulos": [45, 45]}}
SPEC_CB = dict(SPEC, bordes={
    "barras": {"diam": 22, "barras_capa": 2, "n_capas": 2, "figura": "102A",
               "empalme": 13.2, "pata": 25, "sep_capas": 15},
    "estribo": {"diam": 8, "sep": 10, "figura": "104D",
                "tramos": [{"long": 80, "sep": 10}, {"long": 150, "sep": 20}],
                "anidar": True},
    "largo": 40})
rcb = _construir_receta_muro(SPEC_CB, CAT)
cb1 = [c for c in rcb["componentes"] if c["tipologia"] == "CB"][0]
ec1 = [c for c in rcb["componentes"] if c["tipologia"] == "EC"][0]
check("la PATA del cabezal se fija con lo pedido (nunca auto: auto media 508 cm)",
      cb1["dims"]["A"] == {"modo": "fija", "valor": 25.0})
check("el cuerpo del cabezal es B y ahi va el empalme (no en la pata)",
      cb1["dims"]["B"].get("delta") == 13.2 and cb1["dims"]["B"]["modo"] == "auto")
check("la separacion entre capas del cabezal es la pedida",
      cb1["distribucion"]["gap"] == 15.0)
check("sin pata pedida el cabezal igual la fija (gancho normativo, no auto)",
      _construir_receta_muro(
          dict(SPEC, bordes={"barras": {"diam": 22, "barras_capa": 2, "n_capas": 2,
                                        "figura": "102A", "empalme": None,
                                        "pata": None, "sep_capas": None},
                             "estribo": None, "largo": 40}), CAT
      )["componentes"][-1]["dims"]["A"]["modo"] == "fija")
check("los TRAMOS multi-@ llegan al rango del estribo",
      ec1["distribucion"]["rango"]["tramos"] == [{"long": 80.0, "sep": 10.0},
                                                 {"long": 150.0, "sep": 20.0}])
check("el anidado pedido se escribe", ec1["distribucion"]["anidar"] is True)
check("el estribo por defecto es la figura de la casa (106A), no la 104D",
      [c for c in _construir_receta_muro(
          dict(SPEC, bordes={"barras": SPEC["bordes"]["barras"],
                             "estribo": {"diam": 8, "sep": 10, "figura": None,
                                         "tramos": None, "anidar": None},
                             "largo": 40}), CAT)["componentes"]
       if c["tipologia"] == "EC"][0]["figura"] == "106A")

from armahub.asistente import _inventario, _system_prompt as _sp, _normalizar_ficha

# --- SE PUEDE PEDIR SOLO UNA PARTE (31-ago, del chat real: el usuario pidio "SOLO
#     CABEZALES" y la ficha, que exigia mallas, obligo al asistente a pedirlas una y
#     otra vez; nunca llego a dibujar una barra)
SOLO_CB = {"geometria": {"largo": 514, "alto": 315, "espesor": 20, "recubrimiento": 2},
           "malla_vertical": {"diam": 0, "sep": 0},
           "malla_horizontal": {"diam": 0, "sep": 0},
           "doble_malla": True, "trabas": None,
           "bordes": {"barras": {"diam": 18, "barras_capa": 2, "n_capas": 2,
                                 "figura": "102A", "empalme": 118, "pata": 25,
                                 "sep_capas": 0},
                      "estribo": None, "largo": 0},
           # Desde el 1-sep una armadura solo se construye si su origen es
           # "leido" (= la pidio el usuario). Este caso ES "solo cabezales", asi
           # que bordes va leido y lo demas ni se nombra.
           "origenes": {"bordes": "leido"}}
r_cb = _construir_receta_muro(SOLO_CB, CAT)
check("«solo cabezales» produce SOLO los dos cabezales, sin mallas ni estribo",
      [c["tipologia"] for c in r_cb["componentes"]] == ["CB", "CB"])
check("el inventario lo dice tal cual", _inventario(_normalizar_ficha(SOLO_CB)) == "2 cabezales")
# El resumen se pinta desde la ficha NORMALIZADA: sobre la cruda decia «2 mallas
# verticales» y «phi0 @ 0» en la misma pantalla (usuario 31-ago).
_fil_cb = _resumen_de_spec(_normalizar_ficha(SOLO_CB))
check("una malla que no lleva se muestra «no lleva», nunca phi0 @ 0",
      any(f.get("label") == "Malla vertical" and f["valor"] == "no lleva" for f in _fil_cb)
      and not any("φ0" in str(f.get("valor", "")) for f in _fil_cb))
check("y el inventario del resumen no cuenta mallas que no existen",
      any(f.get("label") == "Armaduras" and "malla" not in f["valor"] for f in _fil_cb))
check("una malla con diametro 0 se lee como «no lleva», no como dato faltante",
      _normalizar_ficha(SOLO_CB)["malla_vertical"] is None)
check("pero una ficha sin NINGUNA armadura si se rechaza",
      _falla_critico({"geometria": {"largo": 514, "alto": 315, "espesor": 20},
                      "malla_vertical": {"diam": 0}, "malla_horizontal": {"diam": 0},
                      "trabas": None, "bordes": None}))
check("el prompt prohibe pedir armaduras que el usuario no menciono",
      "SE PUEDE PEDIR SOLO UNA PARTE" in _sp("muro"))

# --- NO INVENTAR ARMADURAS + inventario visible (31-ago: pidio cabezales y el
#     asistente agrego un estribo phi8@10 de 32 barras que nadie pidio)

SPEC_SOLO_CB = dict(SPEC, bordes={"barras": {"diam": 22, "barras_capa": 2, "n_capas": 2,
                                             "figura": None, "empalme": None,
                                             "pata": None, "sep_capas": None},
                                  "estribo": None, "largo": 40})
r_solo = _construir_receta_muro(SPEC_SOLO_CB, CAT)
check("sin estribo pedido NO se crea ningun estribo",
      not [c for c in r_solo["componentes"] if c["tipologia"] == "EC"]
      and len([c for c in r_solo["componentes"] if c["tipologia"] == "CB"]) == 2)
check("el inventario dice exactamente que se va a crear",
      _inventario(SPEC_SOLO_CB).endswith("2 cabezales")
      and "2 estribos de borde" in _inventario(SPEC_CB))
check("el inventario encabeza el formulario",
      _resumen_de_spec(SPEC_CB)[0].get("seccion") == "Se van a crear")
check("el prompt prohibe inventar armaduras y separa cabezal de estribo",
      "NO INVENTES ARMADURAS" in _sp("muro")
      and "NUNCA se escribe en `estribo`" in _sp("muro"))

# --- COLOR: default = el de la tipologia (no se escribe); override por nombre
SPEC_COL = dict(SPEC, trabas=dict(SPEC["trabas"], color="rojo"),
                malla_vertical=dict(SPEC["malla_vertical"], color="#123456"))
rc = _construir_receta_muro(SPEC_COL, CAT)
check("el color pedido por nombre se traduce a hex",
      [c for c in rc["componentes"] if c["tipologia"] == "TR"][0]["color"] == "#c62828")
check("un hex se respeta tal cual",
      [c for c in rc["componentes"] if c["tipologia"] == "MV"][0]["color"] == "#123456")
check("sin color pedido NO se escribe (manda el de la tipologia)",
      all("color" not in c for c in r["componentes"]))
check("un color que no se entiende no se inventa",
      all("color" not in c for c in _construir_receta_muro(
          dict(SPEC, trabas=dict(SPEC["trabas"], color="fucsia neon")), CAT)["componentes"]))

# --- lado dominante y giro de patas
SPEC_EXTRA = dict(SPEC, malla_vertical=dict(SPEC["malla_vertical"],
                                            lado_dominante="B", giro_patas=180))
mv_x = [c for c in _construir_receta_muro(SPEC_EXTRA, CAT)["componentes"]
        if c["tipologia"] == "MV"][0]
check("lado dominante y giro de patas llegan al componente",
      mv_x.get("lado_dominante") == "B" and mv_x.get("orient") == {"spin": 180})
check("si no se piden, no se inventan",
      "lado_dominante" not in [c for c in r["componentes"]
                               if c["tipologia"] == "MV"][0]
      and "orient" not in [c for c in r["componentes"]
                           if c["tipologia"] == "MV"][0])

# --- EMPALME: el traslapo que el usuario pide en el chat tiene que llegar al
#     Delta del lado que corre (control real del editor, template_editor.js:8722) ---
SPEC_EMP = dict(SPEC,
                malla_vertical=dict(SPEC["malla_vertical"], empalme=60),
                bordes={"barras": dict(SPEC["bordes"]["barras"], empalme=60),
                        "estribo": SPEC["bordes"]["estribo"], "largo": 40})
re_ = _construir_receta_muro(SPEC_EMP)
mv_e = [c for c in re_["componentes"] if c["tipologia"] == "MV"]
cb_e = [c for c in re_["componentes"] if c["tipologia"] == "CB"]
mh_e = [c for c in re_["componentes"] if c["tipologia"] == "MH"]
check("el empalme se escribe como Delta del lado que corre, creciendo por la punta",
      all(c["dims"]["A"].get("delta") == 60.0
          and c["dims"]["A"].get("extremo") == "fin" for c in mv_e + cb_e))
check("sin empalme pedido no se inventa Delta",
      all("delta" not in c["dims"]["A"] for c in mh_e))
check("el resumen muestra el empalme",
      any(f.get("label") == "Empalme" for f in _resumen_de_spec(SPEC_EMP)))

# --- LOS ERRORES SE EXPLICAN SOLOS (pedido del usuario 31-ago: que no tenga que
#     traer el texto tecnico para saber que paso)
from armahub.asistente import _detalle_error as _de
check("un error de campos opcionales se explica como problema del programa",
      "del programa" in _de(400, "Schemas contains too many parameters with union types"))
check("una gramatica muy grande tambien",
      "del programa" in _de(400, "The compiled grammar is too large"))
check("un 500 se explica como pasajero y dice reenviar",
      "pasajero" in _de(500, "Unable to complete this request right now")
      and "eenvia" in _de(500, "x"))
check("sin credito manda al administrador",
      "administrador" in _de(402, "Your credit balance is too low"))
check("la clave invalida tambien",
      "administrador" in _de(401, "authentication_error: invalid x-api-key"))
check("una conversacion muy larga dice como salir del paso",
      "larga" in _de(400, "prompt is too long for the context window"))
check("y el detalle tecnico se conserva detras de la explicacion",
      "Detalle tecnico" in _de(500, "Unable to complete this request"))

# --- EL SCHEMA DE LA HERRAMIENTA TIENE QUE SER VALIDO PARA strict (31-ago: el
#     asistente empezo a fallar con "tuvo un problema al responder" y hubo que
#     descartar el schema a mano). strict exige: additionalProperties false, y
#     TODA property listada en required, en cada nivel.
def _revisar_schema(nodo, ruta="raiz", fallas=None):
    fallas = [] if fallas is None else fallas
    if not isinstance(nodo, dict):
        return fallas
    if nodo.get("type") == "object":
        props = set((nodo.get("properties") or {}).keys())
        req = set(nodo.get("required") or [])
        if req - props:
            fallas.append("%s: required sin property %s" % (ruta, req - props))
        # Sin `strict` (F1.12) una property fuera de required es LEGITIMA: asi se
        # declaran los opcionales de verdad (p.ej. `rehacer`). Ya no se marca.
        if nodo.get("additionalProperties") is not False:
            fallas.append("%s: falta additionalProperties:false" % ruta)
        for k, v in (nodo.get("properties") or {}).items():
            _revisar_schema(v, ruta + "." + k, fallas)
    for clave in ("anyOf", "oneOf", "allOf"):
        for i, v in enumerate(nodo.get(clave) or []):
            _revisar_schema(v, "%s.%s[%d]" % (ruta, clave, i), fallas)
    if "items" in nodo:
        _revisar_schema(nodo["items"], ruta + "[]", fallas)
    return fallas

def _uniones(nodo, ruta="raiz", out=None):
    """Parametros con union (anyOf / type lista). La API topa en 16 por herramienta:
    pasarse devuelve 400 y el asistente deja de responder (paso el 31-ago con 33)."""
    out = [] if out is None else out
    if not isinstance(nodo, dict):
        return out
    if isinstance(nodo.get("type"), list) or "anyOf" in nodo or "oneOf" in nodo:
        out.append(ruta)
    for k, v in (nodo.get("properties") or {}).items():
        _uniones(v, ruta + "." + k, out)
    for clave in ("anyOf", "oneOf", "allOf"):
        for i, v in enumerate(nodo.get(clave) or []):
            _uniones(v, "%s.%s[%d]" % (ruta, clave, i), out)
    if "items" in nodo:
        _uniones(nodo["items"], ruta + "[]", out)
    return out

from armahub.asistente import TOOL_OPERAR
_u = _uniones(TOOL_MURO["input_schema"]) + _uniones(TOOL_OPERAR["input_schema"])
check("las DOS herramientas juntas no pasan el tope de 16 uniones (hay %d)" % len(_u),
      len(_u) <= 16)
check("operar_barras no tiene NINGUNA union (schema plano con centinelas)",
      len(_uniones(TOOL_OPERAR["input_schema"])) == 0)

_fallas_schema = _revisar_schema(TOOL_MURO["input_schema"])
check("el schema de proponer_muro es valido para strict en TODOS los niveles",
      not _fallas_schema)
if _fallas_schema:
    print("   ", _fallas_schema)

# --- EL CATALOGO VA COMPLETO Y DESDE LA BD (31-ago: el asistente dijo que 104B no
#     existia porque solo tenia la lista a mano del documento) ---
from armahub.asistente import (_catalogo_texto, _system_prompt,
                               _conocimiento as _con)
_cat = _catalogo_texto([("101A", ["A"], []), ("104B", ["A", "B", "C", "D"], [45, 45]),
                        ("104D", ["A", "B", "C", "D"], [135, 135])])
check("el catalogo se formatea codigo:lados:angulos y se declara COMPLETO",
      "101A:1" in _cat and "104B:4:45/45" in _cat and "104D:4:135/135" in _cat
      and "LISTA COMPLETA" in _cat)
check("el catalogo entra al system prompt y el documento ya no lleva lista a mano",
      _cat in _system_prompt("muro", _cat)
      and "104A" not in _con("muro"))

# --- resumen para el formulario del chat ---
filas = _resumen_de_spec(SPEC)
check("resumen: 4 secciones (inventario + hormigon + barras + borde) y cabezales",
      sum(1 for f in filas if "seccion" in f) == 4
      and any(f.get("label") == "Cabezales" and f["origen"] == "leido" for f in filas))

# --- schema estricto ---
check("la herramienta NO usa strict (la gramatica compilada topaba en tamano)",
      "strict" not in TOOL_MURO)
check("el schema igual cierra a campos desconocidos y exige la geometria",
      TOOL_MURO["input_schema"]["additionalProperties"] is False
      and TOOL_MURO["input_schema"]["required"] == ["geometria"]
      and "bordes" in TOOL_MURO["input_schema"]["properties"])
# Sin strict el schema deja de ser garantia: la ficha que llega se NORMALIZA.
from armahub.asistente import _normalizar_ficha
_min = {"geometria": {"largo": "514", "alto": 315, "espesor": 20},
        "malla_vertical": {"diam": 8, "sep": "20"},
        "malla_horizontal": {"diam": 8, "sep": 20}}
_n = _normalizar_ficha(_min)
check("la ficha minima se normaliza: numeros en texto, opcionales ausentes, recub default",
      _n["geometria"]["largo"] == 514.0 and _n["malla_vertical"]["sep"] == 20.0
      and _n["geometria"]["recubrimiento"] == 2.5
      and _n["trabas"] is None and _n["bordes"] is None
      and _n["malla_vertical"]["figura"] == "")
check("una ficha sin datos criticos NO se construye a medias: avisa",
      _falla_critico({"geometria": {"largo": 0, "alto": 0, "espesor": 0},
                      "malla_vertical": {}, "malla_horizontal": {}}))
check("y el constructor sobrevive a una ficha minima",
      len(_construir_receta_muro(_min)["componentes"]) == 4)

# --- EL TEST QUE MIDE LO PUBLICADO: la receta contra el MOTOR REAL (node) ---
import json, subprocess, shutil
_receta_json = os.path.join(BASE, "tests", "_receta_asistente_tmp.json")
io.open(_receta_json, "w", encoding="utf-8").write(json.dumps(r))
_node = shutil.which("node") or "C:/Users/ezalazar/Tools/node/node-v24.16.0-win-x64/node.exe"
if os.path.exists(_node):
    _p = subprocess.run([_node, os.path.join(BASE, "tests", "test_asistente_receta_motor.js"),
                         _receta_json], capture_output=True, text=True)
    check("MOTOR REAL: la receta genera un muro fisicamente valido (node)",
          _p.returncode == 0)
    if _p.returncode != 0:
        print(_p.stdout[-2000:], _p.stderr[-500:])
else:
    print("AVISO: node no encontrado - test de motor no corrido")
try:
    os.remove(_receta_json)
except OSError:
    pass

# --- armado de mensajes (alternancia + receta actual pegada al último turno)
from armahub.asistente import _mensajes_api, ChatBody
_RECETA_EJ = {"tipo": "muro",
              "geometria": {"largo": 514, "alto": 315, "ancho": 20,
                            "recub_sup": 2, "recub_inf": 2, "recub_lat": 2},
              "componentes": [
                  {"tipologia": "MV", "figura": "101A", "diam": 8, "lado": 1,
                   "jerarquia": 1, "dims": {"A": {"modo": "auto"}},
                   "distribucion": {"modo": "linear", "sep": 20,
                                    "rango": {"eje": "x", "from": -255, "to": 255,
                                              "sep": 20}}},
                  {"tipologia": "CB", "figura": "102A", "diam": 18, "lado": 1,
                   "jerarquia": 1,
                   "dims": {"A": {"modo": "fija", "valor": 25},
                            "B": {"modo": "auto", "delta": 118, "extremo": "fin"}},
                   "distribucion": {"modo": "layered", "barras_capa": 2,
                                    "n_capas": 2, "gap": 4}},
              ]}
b = ChatBody(historial=[
    {"rol": "asistente", "texto": "hola"},
    {"rol": "user", "texto": "muro de 6m"},
    {"rol": "user", "texto": "espesor 20"},
], receta_actual=_RECETA_EJ)
msgs = _mensajes_api(b)
check("mensajes: turnos user consecutivos se funden (alternancia de la API)",
      len(msgs) == 2 and msgs[-1]["role"] == "user")
check("mensajes: el editor viaja como INVENTARIO NUMERADO, no como JSON crudo",
      "Barras HOY en el editor" in msgs[-1]["content"]
      and "1. MV" in msgs[-1]["content"] and "2. CB" in msgs[-1]["content"]
      and '"tipo"' not in msgs[-1]["content"])

# --- OPERAR BARRAS: el asistente OPERA los controles del editor (31-ago) ---
from armahub.asistente import _aplicar_cambios, _inventario_receta

_r2, _av = _aplicar_cambios(_RECETA_EJ, [
    {"accion": "editar", "barra": 1, "diam": 10, "sep": 15, "jerarquia": 2},
], CAT)
check("editar: phi, @ y jerarquia cambian en la barra pedida y el rango acompana",
      _r2["componentes"][0]["diam"] == 10.0
      and _r2["componentes"][0]["distribucion"]["sep"] == 15.0
      and _r2["componentes"][0]["distribucion"]["rango"]["sep"] == 15.0
      and _r2["componentes"][0]["jerarquia"] == 2)
check("editar NO toca las otras barras ni la receta original",
      _r2["componentes"][1]["diam"] == 18
      and _RECETA_EJ["componentes"][0]["diam"] == 8)

_r3, _ = _aplicar_cambios(_RECETA_EJ, [
    {"accion": "agregar", "barra": 0, "armadura": "malla_horizontal",
     "figura": "104B", "diam": 8, "sep": 20, "lados": "ambas"},
], {"101A": {"parciales": ["A"], "angulos": []},
    "104B": {"parciales": ["A", "B", "C", "D"], "angulos": [45, 45]}})
check("agregar malla horizontal 104B en ambas cortinas = 2 componentes nuevos",
      len(_r3["componentes"]) == 4
      and [c["tipologia"] for c in _r3["componentes"][2:]] == ["MH", "MH"]
      and all(c["figura"] == "104B" and set(c["dims"]) == {"A", "B", "C", "D"}
              for c in _r3["componentes"][2:])
      and {c["lado"] for c in _r3["componentes"][2:]} == {1, -1})

_r4, _ = _aplicar_cambios(_RECETA_EJ, [{"accion": "quitar", "barra": 2}], CAT)
check("quitar saca exactamente esa barra", len(_r4["componentes"]) == 1
      and _r4["componentes"][0]["tipologia"] == "MV")

_r5, _av5 = _aplicar_cambios(_RECETA_EJ, [{"accion": "quitar", "barra": 9}], CAT)
check("un indice invalido AVISA sin reventar ni tocar nada",
      len(_r5["componentes"]) == 2 and _av5)

_r6, _ = _aplicar_cambios(_RECETA_EJ, [
    {"accion": "editar", "barra": 2, "empalme": -1}], CAT)
check("empalme -1 QUITA el delta del cabezal",
      "delta" not in _r6["componentes"][1]["dims"]["B"])

check("el inventario numera las barras para que el modelo diga «la barra 2»",
      "2. CB" in _inventario_receta(_RECETA_EJ))
check("el prompt manda a PROPONER con lo tipico en vez de interrogar",
      "PROPONE, NO INTERROGUES" in _sp("muro") and "asumido" in _sp("muro"))
check("el prompt manda a operar_barras para cambios puntuales",
      "operar_barras" in _sp("muro") and "NUNCA reconstruyas" in _sp("muro"))

# --- REGLAS DE ARMADO: inteligencia con override (31-ago, del chat real) ---
SPEC_R = {"geometria": {"largo": 500, "alto": 300, "espesor": 20, "recubrimiento": 2.5},
          "malla_vertical": {"diam": 10, "sep": 20, "figura": "101A"},
          "malla_horizontal": {"diam": 8, "sep": 20, "figura": "101A"},
          "doble_malla": True,
          "trabas": {"diam": 8, "sx": 40, "sy": 40, "figura": "103B"},
          "bordes": {"barras": {"diam": 16, "barras_capa": 2, "n_capas": 2,
                                "figura": "101A", "empalme": 96, "sep_capas": 15},
                     "estribo": None, "largo": 0},
          "origenes": {"malla_vertical": "leido", "malla_horizontal": "leido",
                       "trabas": "asumido", "bordes": "leido"}}
_rr = _construir_receta_muro(SPEC_R, CAT)
_tips = [c["tipologia"] for c in _rr["componentes"]]
check("una armadura ENTERA marcada 'asumido' NO se crea (las trabas que nadie pidio)",
      "TC" not in _tips and _tips == ["MV", "MH", "MV", "MH", "CB", "CB"])
# LA JERARQUIA ESTABA AL REVES (corregido 1-sep). Este check exigia MV=1 y MH=2, y
# la regla lo hacia asi -- pero el default de la casa es el contrario: la MH va contra
# la cara y la MV se repliega DENTRO de ella («la MH contiene a la MV»). El documento
# de conocimiento tambien lo decia mal, y el usuario venia notando muro tras muro que
# el asistente le ponia la MH en jerarquia 2. Se invierte solo en muro PERIMETRAL, y
# eso lo dicta el usuario.
check("regla: MH contra la cara (jer.1) y MV replegada dentro (jer.2)",
      all(c["jerarquia"] == 1 for c in _rr["componentes"] if c["tipologia"] == "MH")
      and all(c["jerarquia"] == 2 for c in _rr["componentes"] if c["tipologia"] == "MV"))
_rx = 500 / 2 - 2.5
_rango_mv = [c["distribucion"]["rango"] for c in _rr["componentes"] if c["tipologia"] == "MV"][0]
check("regla: la MV se recorta para no repetirse sobre los cabezales",
      _rango_mv["to"] < _rx and _rango_mv["to"] == 212.5)
check("las reglas avisan lo que hicieron (para poder contradecirlas)",
      len(_rr.get("_avisos_reglas") or []) >= 2)

# override: si el usuario diferencia las jerarquias, la regla se abstiene
SPEC_OV = json.loads(json.dumps(SPEC_R))
SPEC_OV["malla_vertical"]["jerarquia"] = 2
SPEC_OV["malla_horizontal"]["jerarquia"] = 1
_ro = _construir_receta_muro(SPEC_OV, CAT)
check("override: jerarquias dictadas por el usuario se respetan",
      all(c["jerarquia"] == 2 for c in _ro["componentes"] if c["tipologia"] == "MV")
      and all(c["jerarquia"] == 1 for c in _ro["componentes"] if c["tipologia"] == "MH"))

# trabas pedidas de verdad: se alinean con los cruces de la malla
SPEC_TR = json.loads(json.dumps(SPEC_R))
SPEC_TR["origenes"]["trabas"] = "leido"
SPEC_TR["trabas"]["sx"] = 45          # no es multiplo de @20
_rt = _construir_receta_muro(SPEC_TR, CAT)
_tc = [c for c in _rt["componentes"] if c["tipologia"] == "TR"][0]
check("regla: la grilla de trabas cae en los cruces de la malla (45 -> 40)",
      _tc["distribucion"]["rango"]["sep"] == 40.0)
check("regla: la traba de muro se apoya sobre las dos mallas (jer.3)", _tc["jerarquia"] == 3)
# TR (traba de muro) y TC (confinamiento) son barras distintas y se pintan distinto
_rtc, _ = _aplicar_cambios(_RECETA_EJ, [
    {"accion": "agregar", "barra": 0, "armadura": "trabas_confinamiento",
     "diam": 8, "sep": 10}], CAT)
check("la traba de confinamiento entra como TC, no como TR",
      [c["tipologia"] for c in _rtc["componentes"]][-1] == "TC")
_jt_col = io.open(os.path.join(BASE, "armahub", "static", "js", "features",
                               "modelador", "template_editor.js"), encoding="utf-8").read()
check("la paleta del muro distingue cabezal, traba de muro y confinamiento",
      "CB: '#c62828'" in _jt_col and "TR: '#d81b60'" in _jt_col
      and "EC: '#f9a825'" in _jt_col and "MH: '#1565c0'" in _jt_col)
_sin_ajuste = json.loads(json.dumps(SPEC_TR))
_sin_ajuste["trabas"]["sx"] = 40      # ya cuadra
_rt2 = _construir_receta_muro(_sin_ajuste, CAT)
check("override: una grilla que ya cuadra no se toca",
      [c for c in _rt2["componentes"] if c["tipologia"] == "TR"][0]
      ["distribucion"]["rango"]["sep"] == 40.0)

# --- LA FICHA NO OBLIGA A ESCRIBIRLO TODO (31-ago: 74 campos obligatorios por
#     llamada; el modelo se quedaba sin aire y llegaba un tool_use a medias) ---
def _req(nodo, ruta="raiz", out=None):
    out = [] if out is None else out
    if not isinstance(nodo, dict):
        return out
    for r in (nodo.get("required") or []):
        out.append(ruta + "." + r)
    for k, v in (nodo.get("properties") or {}).items():
        _req(v, ruta + "." + k, out)
    for alt in (nodo.get("anyOf") or []):
        _req(alt, ruta, out)
    if "items" in nodo:
        _req(nodo["items"], ruta + "[]", out)
    return out

check("la ficha pide pocos campos obligatorios (%d), no todos" % len(_req(TOOL_MURO["input_schema"])),
      len(_req(TOOL_MURO["input_schema"])) <= 25)
_MIN_F = {"geometria": {"largo": 500, "alto": 300, "espesor": 20, "recubrimiento": 2},
          "malla_vertical": {"diam": 10, "sep": 20},
          "malla_horizontal": {"diam": 8, "sep": 20}}
check("y una ficha minima (sin opcionales) se arma igual",
      len(_construir_receta_muro(_MIN_F, CAT)["componentes"]) == 4)
check("cuando falta un dato critico se DICE cual",
      "alto" in _de_falta({"geometria": {"largo": 500}})
      and "espesor" in _de_falta({"geometria": {"largo": 500}}))

# --- EL PROMPT COMPLETO DEL USUARIO (31-ago) de punta a punta ---
CAT_P = {"101A": {"parciales": ["A"], "angulos": []},
         "103B": {"parciales": ["A", "B", "C"], "angulos": [45, 45]},
         "104B": {"parciales": ["A", "B", "C", "D"], "angulos": [45, 45]}}
SPEC_P = {"geometria": {"largo": 500, "alto": 300, "espesor": 20, "recubrimiento": 2},
          "malla_vertical": {"diam": 10, "sep": 20, "figura": "101A", "jerarquia": 2,
                             "empalme": 70, "holgura": 10},
          "malla_horizontal": {"diam": 8, "sep": 20, "figura": "104B", "jerarquia": 1},
          "doble_malla": True,
          "trabas": {"diam": 8, "sx": 40, "sy": 40, "figura": "103B"},
          "bordes": {"barras": {"diam": 16, "barras_capa": 2, "n_capas": 2,
                                "empalme": 96, "sep_capas": 15, "jerarquia": 2},
                     "estribo": None, "largo": 0},
          "origenes": {"trabas": "leido", "bordes": "leido"}}
_rp = _construir_receta_muro(SPEC_P, CAT_P)
_mvp = [c for c in _rp["componentes"] if c["tipologia"] == "MV"]
_mhp = [c for c in _rp["componentes"] if c["tipologia"] == "MH"]
_trp = [c for c in _rp["componentes"] if c["tipologia"] == "TR"][0]
_cbp = [c for c in _rp["componentes"] if c["tipologia"] == "CB"]
check("las 3 jerarquias dictadas se respetan (MH=1, MV=2, CB=2)",
      all(c["jerarquia"] == 2 for c in _mvp) and all(c["jerarquia"] == 1 for c in _mhp)
      and all(c["jerarquia"] == 2 for c in _cbp))
check("la traba deriva su jerarquia SOBRE las mallas aunque se dicten las otras",
      _trp["jerarquia"] == 3)
check("la HOLGURA pedida manda: la MV arranca a 10 cm del cabezal (15+10=25)",
      _mvp[0]["distribucion"]["rango"]["to"] == 500 / 2 - 2 - 15 - 10)
check("la segunda MH va espejada y la primera no",
      [c["pose"]["espejo"] for c in _mhp] == [False, True])
check("la traba de muro queda ENTRE los cabezales, no sobre ellos",
      _trp["distribucion"]["rango"]["to"] == _mvp[0]["distribucion"]["rango"]["to"])
check("la traba lleva +2 cm en su cuerpo para enganchar las dos barras",
      _trp["dims"]["B"].get("delta") == 2.0
      and _trp["dims"]["B"].get("extremo") == "centro")
check("el empalme de la MV va en su lado que corre y el del cabezal en el suyo",
      _mvp[0]["dims"]["A"].get("delta") == 70.0
      and _cbp[0]["dims"]["A"].get("delta") == 96.0)
check("la separacion entre capas de cabezales es la pedida",
      _cbp[0]["distribucion"]["gap"] == 15.0)

# --- COMPUERTA, ESPEJO Y RASTRO (31-ago: el modelo rehizo el muro para "agregar
#     una malla" y piso cabezales; y confundio espejo con giro de patas) ---
check("proponer_muro declara el candado rehacer",
      "rehacer" in TOOL_MURO["input_schema"]["properties"])
check("operar_barras tiene el campo espejo",
      "espejo" in TOOL_OPERAR["input_schema"]["properties"]["cambios"]["items"]["properties"])
_r7, _ = _aplicar_cambios(_RECETA_EJ, [{"accion": "editar", "barra": 1, "espejo": 1}], CAT)
check("editar espejo=1 refleja la barra (pose.espejo y campo viejo)",
      _r7["componentes"][0]["pose"]["espejo"] is True
      and _r7["componentes"][0]["espejo"] is True)
_r8, _ = _aplicar_cambios(_r7, [{"accion": "editar", "barra": 1, "espejo": 0}], CAT)
check("espejo=0 lo quita", _r8["componentes"][0]["pose"]["espejo"] is False)
CAT104 = {"101A": {"parciales": ["A"], "angulos": []},
          "104B": {"parciales": ["A", "B", "C", "D"], "angulos": [45, 45]}}
_rmh, _ = _aplicar_cambios(_RECETA_EJ, [
    {"accion": "agregar", "barra": 0, "armadura": "malla_horizontal",
     "figura": "104B", "diam": 8, "sep": 20, "lados": "ambas"}], CAT104)
_mhs = [c for c in _rmh["componentes"] if c["tipologia"] == "MH"]
check("regla de la casa: la cortina opuesta de una malla con ganchos nace en ESPEJO",
      [c["pose"]["espejo"] for c in _mhs] == [False, True])
_rmr, _ = _aplicar_cambios(_RECETA_EJ, [
    {"accion": "agregar", "barra": 0, "armadura": "malla_horizontal",
     "figura": "101A", "diam": 8, "sep": 20, "lados": "ambas"}], CAT104)
check("con barra recta no se escribe espejo (no cambia nada)",
      all(not c["pose"]["espejo"] for c in _rmr["componentes"]
          if c["tipologia"] == "MH"))
from armahub.asistente import _estado_corto
check("el rastro de estado lista lo que quedo, numerado",
      _estado_corto(_RECETA_EJ).startswith("1. MV")
      and "2. CB" in _estado_corto(_RECETA_EJ))
check("el prompt distingue espejo de giro de patas y fija el listado como memoria",
      "ESPEJO vs GIRO" in _sp("muro") and "TU MEMORIA ES EL LISTADO" in _sp("muro"))

# --- cableado
main_src = io.open(os.path.join(BASE, "armahub", "main.py"), encoding="utf-8").read()
check("main.py monta asistente_router (root y api_v1)",
      "app.include_router(asistente_router)" in main_src
      and "asistente_router,\n" in main_src)
boot = io.open(os.path.join(BASE, "armahub", "static", "js", "app", "bootstrap.js"),
               encoding="utf-8").read()
check("bootstrap.js carga modelador/asistente.js", "modelador/asistente.js" in boot)

# --- CABLEADO DEL FRONT (dos fallos reales del 31-ago que esto habria cazado):
#     (a) la auto-carga quedo anunciada en el HTML pero el JS nunca se guardo;
#     (b) el reinicio "muro nuevo = chat nuevo" dependia del ORDEN DE CARGA.
_ja = io.open(os.path.join(BASE, "armahub", "static", "js", "features",
                           "modelador", "asistente.js"), encoding="utf-8").read()
_jt = io.open(os.path.join(BASE, "armahub", "static", "js", "features",
                           "modelador", "template_editor.js"), encoding="utf-8").read()
_html = io.open(os.path.join(BASE, "armahub", "templates", "tabs",
                             "template_editor_modal.html"), encoding="utf-8").read()
check("la receta se INSTALA EN VIVO al llegar (no de golpe, no a mano)",
      "_instalarEnVivo()" in _ja
      and "templateEditorAgregarComponente" in _ja
      and "templateEditorAgregarComponente" in _jt)
check("el componente externo entra por las puertas del editor, no se empuja crudo",
      "_setPose(c, c.pose)" in _jt and "_setModoComp(c, _modoDe(c))" in _jt
      and "_dimsDefault(c.figura)" in _jt)
check("el campo de escritura crece con el texto",
      "_autoAltoInput" in _ja and "addEventListener('input'" in _ja
      and "max-height:260px" in _html)
check("hay como copiar el CHAT completo (para revisar por que entendio mal)",
      "_copiarChat" in _ja and "te_iaCopiarChat" in _ja and "te_iaCopiarChat" in _html)
check("hay como copiar la receta (evidencia para diagnosticar sin mirar pixeles)",
      "_copiarReceta" in _ja and "te_iaCopiar" in _ja and "te_iaCopiar" in _html)
check("el boton del panel es RE-carga y no pasa el evento como flag",
      "_cargarBorrador(false)" in _ja
      and "Cargar la propuesta completa" in _html)
check("template_editor.js estampa el contador de aperturas",
      "__teAperturas" in _jt)
check("el chat lee ese contador y NO envuelve templateEditorAbrir (orden de carga)",
      "__teAperturas" in _ja and "_envolverAbrir" not in _ja)
check("templateEditorEstado expuesto para que el chat vea la receta actual",
      "global.templateEditorEstado" in _jt)
# El filtro de secciones del conocimiento: lo que NO llega al prompt es peor que
# no escribirlo (parece cargado y no lo esta). Se mide el texto que se inyecta.
check("el prompt de MURO recibe GENERAL + MURO + FIGURAS (titulos con parentesis)",
      "## GENERAL" in _con("muro") and "## MURO" in _con("muro")
      and "103B" in _con("muro"))
check("otro elemento NO arrastra la seccion del muro",
      "## MURO" not in _con("viga") and "103B" in _con("viga"))
check("conocimiento_asistente.md existe con seccion MURO",
      "## MURO" in io.open(os.path.join(BASE, "armahub", "data",
                                        "conocimiento_asistente.md"), encoding="utf-8").read())

# ---------------------------------------------------------------------------
# EL HORMIGON SALE DEL FORMULARIO, NO DEL CHAT (usuario 1-sep)
# ---------------------------------------------------------------------------
# «que el muro y rec lo tome siempre del formulario inicial, ya esta en la
# plataforma creado eso». El modelo YA VE las medidas -el inventario que recibe
# empieza con «Muro 600x250x20 rec 2.5»- y aun asi la ficha se las exigia de
# vuelta: el usuario escribia dos veces el mismo dato, y si el modelo no las
# repetia la ficha se rechazaba con «me falta largo y alto» sobre un muro que
# estaba a la vista. Lo que se congela:
#   . sin geometria en la ficha, se hereda del editor;
#   . si la ficha la trae, MANDA (el usuario puede cambiarla conversando);
#   . sin editor y sin ficha, se PREGUNTA (ahi si nadie sabe cuanto mide).
_RECETA_EDITOR = {"geometria": {"largo": 600, "alto": 250, "ancho": 20, "recub_lat": 2.5}}
_FICHA_SIN_GEO = {"malla_vertical": {"diam": 8, "sep": 20},
                  "malla_horizontal": {"diam": 8, "sep": 20}}

_g = _normalizar_ficha(_FICHA_SIN_GEO, _RECETA_EDITOR)["geometria"]
check("ficha SIN dimensiones: las hereda del formulario del editor",
      (_g["largo"], _g["alto"], _g["espesor"]) == (600.0, 250.0, 20.0))
check("y el recubrimiento tambien sale del editor (recub_lat -> recubrimiento)",
      _g["recubrimiento"] == 2.5)
check("la ficha PISA al editor cuando el usuario dicta otra medida en el chat",
      _normalizar_ficha(dict(_FICHA_SIN_GEO, geometria={"largo": 800}),
                        _RECETA_EDITOR)["geometria"]["largo"] == 800.0)
try:
    _normalizar_ficha(_FICHA_SIN_GEO, None)
    check("sin editor y sin ficha, PREGUNTA en vez de inventar", False)
except ValueError as _e:
    check("sin editor y sin ficha, PREGUNTA en vez de inventar", "falta" in str(_e))
check("el schema ya NO exige las dimensiones en la ficha",
      "largo" not in ((TOOL_MURO.get("input_schema", {}).get("properties", {})
                       .get("geometria", {}) or {}).get("required", [])))
check("y el prompt le dice al modelo que el hormigon sale del formulario",
      "FORMULARIO del editor" in _sp("muro", {}))

# ---------------------------------------------------------------------------
# LOS DEFAULTS DEL MURO TIPO (dictados por el usuario, 1-sep)
# ---------------------------------------------------------------------------
# El documento ya describia cada tipologia por separado; lo que faltaba era QUE
# LLEVA UN MURO DE LA CASA CUANDO NADIE DICE NADA. Sin eso, el usuario tenia que
# dictar cada cosa en cada conversacion, que es exactamente lo que el asistente
# viene a evitar («esto lo usaran usuarios no tan precisos en el lenguaje»).
# Estos checks no miden prosa: miden que los DATOS que el modelo necesita para no
# preguntar sigan en el documento. Si alguien lo reescribe y se lleva uno por
# delante, el asistente vuelve a interrogar y nadie se entera hasta la demo.
_CON_MURO = _con("muro")
# Los saltos de linea del markdown parten las frases, asi que las aserciones se
# hacen sobre el texto con los espacios NORMALIZADOS. Sin esto, reacomodar un
# parrafo -sin cambiar una palabra- tumbaba el test: seria el test midiendo el
# formato en vez del contenido.
_CM = " ".join(_CON_MURO.split())

check("MH: la figura por defecto es la 104B", "104B" in _CM)
check("MH: la cortina opuesta es la MISMA barra ROTADA 180 (no solo espejada)",
      "180" in _CM and "espejo solo" in _CM.lower())
check("MH: la distribucion arranca a la MITAD del espaciamiento del borde",
      "MITAD del espaciamiento" in _CM)
check("MH: la 105C esta como alternativa, no como default",
      "105C" in _CM and "no es default" in _CM)
check("jerarquia de la casa: MH 1 y MV 2 (la MH contiene a la MV)",
      "MH jerarqu" in _CM and "contiene a la MV" in _CM)
check("perimetral: si el usuario no lo dice, se asume que NO lo es",
      "PERIMETRAL" in _CM and "se asume que NO" in _CM)
check("MV: 103C si es naciente, 101A si es continuacion",
      "103C" in _CM and "101A" in _CM and "naciente" in _CM)
check("MV: empalme 60 phi + 10 hacia arriba", "60·φ + 10" in _CM)
check("MV: el recubrimiento de abajo depende de la figura (101A al borde, 103C con rec)",
      "borde inferior del hormig" in _CM and "5 cm" in _CM)
check("MV: la variante 102C del naciente se conoce pero NO es default",
      "102C" in _CM and "nunca se asume" in _CM)

# EL DOCUMENTO Y EL CODIGO TIENEN QUE DECIR LO MISMO. Dos veces ya paso lo mismo:
# se corrigio la regla en el conocimiento y el codigo siguio haciendo lo de antes
# -- y manda el codigo. Paso con la jerarquia (doc MH=1, codigo MV=1) y volvio a
# pasar con la figura de la MH (doc 104B desde el 1-sep, codigo 101A hasta que el
# usuario pidio «crea malla horizontal fi8@20» y le salio una recta).
# Esto ata las dos puntas: lo que el documento declara como default de la casa es
# lo que sale de `_fabricar` cuando el usuario no dicta figura.
_DEF = {"geometria": {"largo": 400, "alto": 250, "espesor": 20, "recubrimiento": 2},
        "malla_vertical": {"diam": 8, "sep": 20},
        "malla_horizontal": {"diam": 8, "sep": 20},
        "doble_malla": True,
        "origenes": {"malla_vertical": "leido", "malla_horizontal": "leido"}}
_rd = _construir_receta_muro(_normalizar_ficha(_DEF), None)
_figs = {t: sorted({c["figura"] for c in _rd["componentes"] if c["tipologia"] == t})
         for t in ("MH", "MV")}
check("el default de MH que sale del codigo es el que declara el documento",
      _figs["MH"] == ["104B"] and "MH 104B" in _CM)
check("el default de MV que sale del codigo es el que declara el documento",
      _figs["MV"] == ["101A"] and "MV 101A" in _CM)

# ---------------------------------------------------------------------------
# CABEZALES (usuario 2-sep)
# ---------------------------------------------------------------------------
from armahub.asistente import (_gancho_90, _componentes_cabezal, _figura_cabezal,
                               _lleva_empalme, _empalme_auto, _inventario)

# LA PATA DEL ARRANQUE es el gancho normal de 90: 12*phi subido al multiplo de 5.
# El usuario creia recordar 40*phi -- eso es anclaje/traslapo, otra medida.
check("gancho de 90 = 12 phi",
      all(abs(_gancho_90(d) - 12.0 * d / 10.0) < 5 for d in (8, 10, 12, 16, 22, 25)))
check("...y siempre SUBIDO al multiplo de 5 (19 -> 20, 27 -> 30)",
      [_gancho_90(d) for d in (8, 10, 12, 16, 18, 22, 25)]
      == [10, 15, 15, 20, 25, 30, 30])
check("nunca acorta por debajo de la norma",
      all(_gancho_90(d) >= 12.0 * d / 10.0 for d in (8, 10, 12, 16, 18, 22, 25, 28, 32)))

# LA FIGURA SALE DE DONDE VIVE EL MURO, no de un default suelto.
check("cabezal: arranca y corona -> 103A y las capas ANIDAN (muro de un piso)",
      _figura_cabezal(True, True) == ("103A", None, True))
check("cabezal: solo arranca -> 102A con la pata ABAJO",
      _figura_cabezal(True, False) == ("102A", "abajo", False))
check("cabezal: solo corona -> 102A con la pata ARRIBA",
      _figura_cabezal(False, True) == ("102A", "arriba", False))
check("cabezal: muro intermedio -> 101A recta",
      _figura_cabezal(False, False) == ("101A", None, False))

# EL EMPALME DEPENDE DE SI EL MURO SIGUE SUBIENDO, no de si nace aca.
check("empalme: arranca si, corona no, arranca y corona no, intermedio si",
      [_lleva_empalme(a, b) for a, b in
       ((True, False), (False, True), (True, True), (False, False))]
      == [True, False, False, True])
check("el empalme de la casa es 60 phi + 10", _empalme_auto(16) == 106
      and _empalme_auto(8) == 58)

_CATCB = {"101A": {"parciales": ["A"], "angulos": []},
          "102A": {"parciales": ["A", "B"], "angulos": []},
          "103A": {"parciales": ["A", "B", "C"], "angulos": []},
          "103C": {"parciales": ["A", "B", "C"], "angulos": [45]},
          "104B": {"parciales": ["A", "B", "C", "D"], "angulos": [45, 45]}}


def _muro_cb(cond, bordes):
    return _construir_receta_muro({
        "geometria": {"largo": 500, "alto": 250, "espesor": 20, "recubrimiento": 2.5},
        "malla_vertical": {"diam": 8, "sep": 20},
        "malla_horizontal": {"diam": 8, "sep": 20},
        "doble_malla": True, "condicion": cond, "bordes": bordes,
        "origenes": {"malla_vertical": "leido", "malla_horizontal": "leido",
                     "bordes": "leido"}}, _CATCB)


_BB = {"barras": {"diam": 16, "barras_capa": 2, "n_capas": 2}}
_ini = [c for c in _muro_cb("inicia", _BB)["componentes"] if c["tipologia"] == "CB"]
_fin = [c for c in _muro_cb("termina", _BB)["componentes"] if c["tipologia"] == "CB"]
_uno = [c for c in _muro_cb("inicia_y_termina", _BB)["componentes"] if c["tipologia"] == "CB"]
_med = [c for c in _muro_cb("", _BB)["componentes"] if c["tipologia"] == "CB"]

check("la condicion del muro llega hasta la figura del cabezal construido",
      [c[0]["figura"] for c in (_ini, _fin, _uno, _med)]
      == ["102A", "102A", "103A", "101A"])
check("la pata mira ABAJO si arranca y ARRIBA si corona",
      _ini[0]["orient"]["spin"] != _fin[0]["orient"]["spin"])
check("el muro de un piso trae las capas anidadas; los demas no",
      _uno[0]["distribucion"].get("anidar") is True
      and not _med[0]["distribucion"].get("anidar"))
check("la pata sin dictar sale del gancho de 90 (phi16 -> 20)",
      any(v.get("valor") == 20 for v in _ini[0]["dims"].values()))
check("jerarquia 2 por defecto (la MH siempre esta)",
      all(c["jerarquia"] == 2 for c in _ini + _med))
check("separacion entre capas por defecto = 15, no 4",
      _med[0]["distribucion"]["gap"] == 15)
check("empalme automatico salvo que el muro corone",
      _ini[0]["dims"]["B"].get("delta") == 106
      and not _fin[0]["dims"]["B"].get("delta"))
_mvi = [c for c in _muro_cb("inicia", _BB)["componentes"] if c["tipologia"] == "MV"]
check("la MV naciente sale 103C sola, sin que nadie dicte la figura",
      _mvi[0]["figura"] == "103C")

# ESCALONADO: el usuario dice «2 capas con longitudes distintas» y NUNCA habla de
# componentes. Un componente es una definicion de barra y una barra no puede tener
# dos largos, asi que cada largo distinto es un componente -- y hay que intercalarlos
# para que la pila se vea pareja a la separacion que el usuario nombro.
_esc = _componentes_cabezal({"diam": 22, "n_capas": 4, "sep_capas": 15,
                             "empalmes": [132, 90]})
check("4 capas con 2 largos -> 2 componentes de 2 capas @30",
      [(p["n_capas"], p["sep_capas"]) for p in _esc] == [(2, 30), (2, 30)])
check("...el segundo arranca a 15, para que la pila quede en 0/15/30/45",
      [p["arranque"] for p in _esc] == [0, 15])
check("...y cada componente se lleva SU largo",
      [p["empalme"] for p in _esc] == [132, 90])
_esc3 = _componentes_cabezal({"diam": 22, "n_capas": 6, "sep_capas": 15,
                              "empalmes": [132, 100, 70]})
check("con 3 largos y 6 capas: gap 45 y arranques 0/15/30",
      [(p["n_capas"], p["sep_capas"], p["arranque"]) for p in _esc3]
      == [(2, 45, 0), (2, 45, 15), (2, 45, 30)])
_esc_imp = _componentes_cabezal({"diam": 22, "n_capas": 3, "sep_capas": 15,
                                 "empalmes": [132, 90]})
check("y si las capas no se reparten parejas, no se pierde ninguna",
      sum(p["n_capas"] for p in _esc_imp) == 3)
check("un solo largo sigue siendo UN componente",
      len(_componentes_cabezal({"diam": 16, "n_capas": 2})) == 1)

_e2 = [c for c in _muro_cb("inicia", {"barras": dict(_BB["barras"], empalmes=[132, 90])})
       ["componentes"] if c["tipologia"] == "CB"]
check("el escalonado llega a la receta como 2 componentes POR PUNTA", len(_e2) == 4)
check("...y el que arranca mas adentro lo hace con off_caras, NO con pos_hint",
      _e2[1]["off_caras"] == {"x": {"max": 15.0}} and not _e2[1]["pos_hint"]
      and _e2[3]["off_caras"] == {"x": {"min": 15.0}})

# INFERIOR / CORONACION: la misma pieza girada 90 dentro del plano del muro.
_4c = [c for c in _muro_cb("inicia_y_termina",
                           dict(_BB, donde=["laterales", "inferior", "superior"]))
       ["componentes"] if c["tipologia"] == "CB"]
check("un muro de un piso puede llevar cabezales en los CUATRO costados",
      len(_4c) == 4 and all(c["figura"] == "103A" for c in _4c))
check("los laterales corren en la altura y los de borde a lo largo del muro",
      [c["pose"]["rumbo"] for c in _4c] == ["y", "y", "x", "x"]
      and [c["pose"]["cara"] for c in _4c] == ["extremo", "extremo", "inf", "sup"])
check("el inventario cuenta las barras que van a aparecer DE VERDAD",
      _inventario(_normalizar_ficha({
          "geometria": {"largo": 500, "alto": 250, "espesor": 20, "recubrimiento": 2.5},
          "malla_horizontal": {"diam": 8, "sep": 20},
          "bordes": dict(_BB, donde=["laterales", "inferior"]),
          "origenes": {"malla_horizontal": "leido", "bordes": "leido"}}))
      .endswith("3 cabezales"))

check("el conocimiento explica el escalonado en capas, no en componentes",
      "longitudes distintas" in _CM and "gap = N" in _CM)
check("...y que el que empalma es el que SIGUE SUBIENDO",
      "SIGUE SUBIENDO" in _CM and "pata, no arranque" in _CM)
check("el conocimiento trae la figura del cabezal por condicion del muro",
      "103A" in _CM and "pata ABAJO" in _CM and "pata ARRIBA" in _CM)
check("...y los cuatro costados del muro de un piso",
      "cuatro costados" in _CM)

# ---------------------------------------------------------------------------
# LA MALLA VERTICAL, CASO POR CASO (usuario 3-sep)
# ---------------------------------------------------------------------------
from armahub.asistente import _figura_mv, _MV_LADO_CORRE

_CATMV = {"101A": {"parciales": ["A"], "angulos": []},
          "102C": {"parciales": ["A", "B"], "angulos": [45]},
          "103C": {"parciales": ["A", "B", "C"], "angulos": [45]},
          "104B": {"parciales": ["A", "B", "C", "D"], "angulos": [45, 45]}}


def _muro_mv(cond, asim=False):
    return _construir_receta_muro({
        "geometria": {"largo": 500, "alto": 310, "espesor": 20, "recubrimiento": 2},
        "malla_vertical": {"diam": 10, "sep": 20},
        "malla_horizontal": {"diam": 8, "sep": 20},
        "doble_malla": True, "condicion": cond, "mv_asimetrica": asim,
        "origenes": {"malla_vertical": "leido", "malla_horizontal": "leido"}}, _CATMV)


def _mvs(cond, asim=False):
    return [c for c in _muro_mv(cond, asim)["componentes"] if c["tipologia"] == "MV"]


def _figs(cond, asim=False):
    return [c["figura"] for c in _mvs(cond, asim)]


def _delta(c):
    for L, v in (c.get("dims") or {}).items():
        if v.get("delta"):
            return L, v["delta"]
    return None, 0


check("MV intermedia: recta y punto (solo tiene mas tramos si inicia o termina)",
      _figs("") == ["101A", "101A"] and _figs("", True) == ["101A", "101A"])
check("MV naciente: 103C en las dos cortinas",
      _figs("inicia") == ["103C", "103C"])
check("MV naciente ASIMETRICA: 103C y 102C -- y la asimetria se INFIERE",
      _figs("inicia", True) == ["103C", "102C"])
check("MV de muro que corona: la misma figura, no otra",
      _figs("termina") == ["103C", "103C"])
check("MV de muro de UN PISO: 104B por default (la 105C se pide)",
      _figs("inicia_y_termina") == ["104B", "104B"])

# EL LADO QUE CORRE de la 103C es el C, no el del medio. La cadena es
# gancho -> pata -> cuerpo, asi que el cuerpo queda TERMINAL. Sin decirselo, el
# motor estira B y la barra sale con un quiebre en cada punta -- el de arriba
# montado sobre el empalme, 66 cm por encima del hormigon (medido 2-sep).
check("la 103C declara que su lado que corre es el C",
      _MV_LADO_CORRE["103C"] == "C"
      and all(c.get("lado_dominante") == "C" for c in _mvs("inicia")))
check("...y el empalme cae AHI, no en el lado del medio",
      _delta(_mvs("inicia")[0]) == ("C", 70.0))
check("la 102C no lleva override: el motor ya sabe cual es su cuerpo",
      _mvs("inicia", True)[1].get("lado_dominante") in (None, ""))

# EL EMPALME LO LLEVA EL QUE SIGUE SUBIENDO -- la singularidad que marco el usuario.
check("el muro que corona NO empalma (nace del piso terminado)",
      all(not _delta(c)[1] for c in _mvs("termina")))
check("el muro de un piso tampoco",
      all(not _delta(c)[1] for c in _mvs("inicia_y_termina")))
check("el naciente y el intermedio si",
      _delta(_mvs("inicia")[0])[1] == 70 and _delta(_mvs("")[0])[1] == 70)

# EL ESPEJO DE LA MV NO ES POR CORTINA. Medido: en una MV el espejo la voltea de
# CABEZA. Aplicarlo a la cortina opuesta -- que es la regla de la MH -- dejaba una
# con la pata abajo y la otra con la pata arriba en el mismo muro.
check("las dos cortinas de un naciente miran igual (la pata abajo las dos)",
      [c.get("espejo") for c in _mvs("inicia")] == [None, None])
check("y las dos de un muro que corona tambien (la pata arriba las dos)",
      all(c.get("espejo") for c in _mvs("termina")))
check("el marco de 4 SI conserva la regla de la MH: la opuesta va rotada",
      [bool(c.get("espejo")) for c in _mvs("inicia_y_termina")] == [False, True])
check("_figura_mv devuelve la misma figura salvo que sea asimetrica",
      _figura_mv(True, False) == ("103C", "103C")
      and _figura_mv(True, False, True) == ("103C", "102C"))

# CABEZAL DE BORDE: dentro de la MV, sin empalme y 103A.
_BORDES = {"barras": {"diam": 16, "barras_capa": 2, "n_capas": 1},
           "donde": ["laterales", "inferior", "superior"]}
_rb = _construir_receta_muro({
    "geometria": {"largo": 500, "alto": 310, "espesor": 20, "recubrimiento": 2},
    "malla_vertical": {"diam": 10, "sep": 20},
    "malla_horizontal": {"diam": 8, "sep": 20},
    "doble_malla": True, "condicion": "inicia", "bordes": _BORDES,
    "origenes": {"malla_vertical": "leido", "malla_horizontal": "leido",
                 "bordes": "leido"}}, dict(_CATMV, **{
    "102A": {"parciales": ["A", "B"], "angulos": []},
    "103A": {"parciales": ["A", "B", "C"], "angulos": []}}))
_cbs = [c for c in _rb["componentes"] if c["tipologia"] == "CB"]
_lat = [c for c in _cbs if not c.get("_cb_borde")]
_bor = [c for c in _cbs if c.get("_cb_borde")]
_mvj = max(c["jerarquia"] for c in _rb["componentes"] if c["tipologia"] == "MV")

check("el cabezal de coronacion y el inferior quedan DENTRO de la MV",
      _bor and all(c["jerarquia"] == _mvj + 1 for c in _bor))
check("...o sea 3 en un muro usual (MH=1, MV=2), que es lo que dicto el usuario",
      _mvj == 2 and all(c["jerarquia"] == 3 for c in _bor))
check("los LATERALES no se mueven de 2", all(c["jerarquia"] == 2 for c in _lat))
check("el cabezal de borde corre acostado y NO lleva empalme (no sube a ninguna parte)",
      all(not any(v.get("delta") for v in c["dims"].values()) for c in _bor)
      and all(c["pose"]["rumbo"] == "x" for c in _bor))
check("...y su figura por default es la 103A, que cierra el muro por ese borde",
      all(c["figura"] == "103A" for c in _bor))
check("el lateral SI empalma, que para eso es el arranque",
      all(any(v.get("delta") for v in c["dims"].values()) for c in _lat))

check("el conocimiento trae la tabla de casos de la MV",
      "Un piso** (inicia y termina)" in _CM and "los dos quiebres ABAJO" in _CM.replace("Los dos quiebres ABAJO", "los dos quiebres ABAJO"))
check("...y dice que en la 103C el lado que corre es el C",
      "el lado que corre a lo alto es el C" in _CM)
check("...y deja anotado el antecedente de la 103A (gancho abierto, se dobla en obra)",
      "103A" in _CM and "en obra lo terminan de doblar" in _CM)

# ---------------------------------------------------------------------------
# SI NO LA PEDISTE, NO SE CONSTRUYE (usuario 1-sep, segunda vuelta)
# ---------------------------------------------------------------------------
# «me creó igual las trabas aunque no las pedí; si especifico solo malla
# horizontal y vertical, sería bueno haga solo eso y no improvise».
# El gate del 31-ago descartaba las armaduras marcadas 'asumido', pero el modelo
# las colaba marcandolas 'config' -- y 'config' pasaba. La raiz: `origenes`
# mezclaba DOS preguntas, de donde salieron los NUMEROS y quien decidio que la
# armadura EXISTA. Para lo segundo solo vale una respuesta: la pidio el usuario.
# Ahora se construye solo con origen 'leido', y esto lo congela con los tres.
_PEDI_SOLO_MALLAS = {
    "geometria": {"largo": 500, "alto": 250, "espesor": 20, "recubrimiento": 2},
    "malla_vertical": {"diam": 8, "sep": 20},
    "malla_horizontal": {"diam": 8, "sep": 20},
    "doble_malla": True,
    "trabas": {"diam": 8, "sx": 40, "sy": 40},
    "origenes": {"malla_vertical": "leido", "malla_horizontal": "leido"},
}
_tips = lambda o: [c["tipologia"] for c in
                   _construir_receta_muro(dict(_PEDI_SOLO_MALLAS,
                                               origenes=dict(_PEDI_SOLO_MALLAS["origenes"],
                                                             **({"trabas": o} if o else {}))),
                                          CAT)["componentes"]]
check("pedi solo mallas: NO aparecen trabas (sin origen para ellas)",
      "TR" not in _tips(None))
check("…ni marcandolas 'asumido' (el gate viejo)", "TR" not in _tips("asumido"))
check("…NI marcandolas 'config', que era el hueco por el que se colaban",
      "TR" not in _tips("config"))
check("y si las PIDO de verdad ('leido'), si se construyen", "TR" in _tips("leido"))
check("el prompt explica que `origenes` dice QUIEN decidio que la armadura exista",
      "QUIÉN DECIDIÓ QUE ESA ARMADURA EXISTA" in _sp("muro", {}))

# ---------------------------------------------------------------------------
# LA TRABA DE MURO: diametro, grilla y gancho SE DERIVAN (usuario 1-sep)
# ---------------------------------------------------------------------------
# Antes habia que dictarle todo. Ahora: el phi sale de la malla (el MENOR si
# difieren), la grilla se modula contra los cruces de MV y MH buscando 6 por m2
# SIN QUEDARSE CORTO, y los ganchos salen de la NCh 211 tabla 7.
from armahub.asistente import _gancho_sismico, _modular_trabas

check("gancho: NCh 211 tabla 7 para los phi tabulados (phi8 -> 10,8 cm)",
      _gancho_sismico(8) == 10.8 and _gancho_sismico(10) == 12.1
      and _gancho_sismico(12) == 13.5)
check("gancho: 10·phi cuando el diametro no esta en la tabla", _gancho_sismico(20) == 20.0)

_m2 = lambda sx, sy: 10000.0 / (sx * sy)
_g20 = _modular_trabas(20, 20)
check("grilla con malla @20: 40x40 (el caso tipico de la casa)", _g20 == (40.0, 40.0))
_g15 = _modular_trabas(15, 15)
check("grilla con malla @15: los dos pasos DISTINTOS (45 y 30), como dijo el usuario",
      sorted(_g15) == [30.0, 45.0])
check("nunca por debajo de 6/m2: quedarse corto de trabas es defecto de obra",
      all(_m2(*_modular_trabas(a, b)) >= 6.0
          for a, b in ((20, 20), (15, 15), (20, 15), (25, 25), (10, 10))))
check("y el modulo nunca es una tira (razon <= 2): con @15 ganaba 15x105",
      all(max(g) <= 2.0 * min(g)
          for g in (_modular_trabas(a, b)
                    for a, b in ((20, 20), (15, 15), (20, 15), (25, 25)))))

# El phi de la traba sale de la malla, y el MENOR si difieren.
_SOLO_TR = {"geometria": {"largo": 500, "alto": 250, "espesor": 20, "recubrimiento": 2},
            "malla_vertical": {"diam": 10, "sep": 20},
            "malla_horizontal": {"diam": 8, "sep": 20},
            "doble_malla": True, "trabas": {"diam": 0},
            "origenes": {"malla_vertical": "leido", "malla_horizontal": "leido",
                         "trabas": "leido"}}
_ntr = _normalizar_ficha(_SOLO_TR)["trabas"]
check("traba sin phi dictado: toma el MENOR de las mallas (10 y 8 -> 8)",
      _ntr and _ntr["diam"] == 8)
check("…y su gancho sale de la tabla para ESE phi (10,8)", _ntr["pata"] == 10.8)
check("…y su grilla se modulo contra la malla (40x40 con @20)",
      (_ntr["sx"], _ntr["sy"]) == (40.0, 40.0))

check("el conocimiento dice que el phi6 no existe", "φ6 no existe" in _CM)
check("y trae el orden de armado como SUGERENCIA, no como interrogatorio",
      "MH → cabezales" in _CM and "sin interrogar" in _CM)

print()
if FALLAS:
    print("FALLARON %d:" % len(FALLAS), FALLAS)
    sys.exit(1)
print("TODO OK (%s)" % os.path.basename(__file__))
