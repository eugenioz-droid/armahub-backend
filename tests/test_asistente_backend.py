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
                 "doble_malla": "asumido", "trabas": "config", "bordes": "leido"},
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
check("sin figura pedida se mantiene el default de la plataforma",
      [c["figura"] for c in r["componentes"] if c["tipologia"] == "MH"] == ["101A", "101A"])
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
           "origenes": {}}
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
check("regla: MV contra la cara (jer.1) y MH encima (jer.2)",
      all(c["jerarquia"] == 1 for c in _rr["componentes"] if c["tipologia"] == "MV")
      and all(c["jerarquia"] == 2 for c in _rr["componentes"] if c["tipologia"] == "MH"))
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

print()
if FALLAS:
    print("FALLARON %d:" % len(FALLAS), FALLAS)
    sys.exit(1)
print("TODO OK (%s)" % os.path.basename(__file__))
