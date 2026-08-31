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
    "trabas": {"diam": 8, "sx": 40, "sy": 40, "figura": None, "jerarquia": None,
               "tramos": None, "anidar": None},
    "bordes": {"barras": {"diam": 18, "barras_capa": 2, "n_capas": 2},
               "estribo": {"diam": 8, "sep": 10}, "largo": 40},
    "origenes": {"geometria": "leido", "recubrimiento": "leido",
                 "malla_vertical": "leido", "malla_horizontal": "leido",
                 "doble_malla": "asumido", "trabas": "config", "bordes": "leido"},
}

r = _construir_receta_muro(SPEC)
tips = [c["tipologia"] for c in r["componentes"]]
check("tipologias REALES del muro (MV/MH x2 cortinas + TC + CB/EC x2 puntas)",
      tips == ["MV", "MH", "MV", "MH", "TC", "CB", "EC", "CB", "EC"])
mvs = [c for c in r["componentes"] if c["tipologia"] == "MV"]
check("cada cortina es UN componente con lado +-1 (no capas)",
      [c["lado"] for c in mvs] == [1, -1]
      and all(c["modo"] == "lineal" and c["distribucion"]["modo"] == "linear"
              and c["distribucion"]["activa"] for c in mvs))
check("MV de pie reparte en x; MH acostada reparte en y",
      mvs[0]["plano_pieza"]["orientacion"] == "de_pie"
      and mvs[0]["distribucion"]["rango"]["eje"] == "x"
      and r["componentes"][1]["distribucion"]["rango"]["eje"] == "y")
tc = [c for c in r["componentes"] if c["tipologia"] == "TC"][0]
check("traba TC: figura con ganchos 103B, pose sup/z, jerarquia 2, arreglo x*y",
      tc["figura"] == "103B" and tc["pose"] == {"cara": "sup", "lado": 1,
                                                "rumbo": "z", "espejo": False}
      and tc["jerarquia"] == 2 and tc["distribucion"]["rango2"]["eje"] == "y")
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
check("rangos sin ancla (la deriva normalizarReceta) y de recub a recub",
      "ancla" not in mvs[0]["distribucion"]["rango"]
      and mvs[0]["distribucion"]["rango"]["from"] == -255.0)

# --- FIGURA Y JERARQUIA LAS DICTA EL USUARIO (feedback 31-ago: el asistente decia
#     que no eran suyas y mandaba a reportar un bug inexistente) ---
SPEC_FIG = dict(SPEC,
                malla_horizontal=dict(SPEC["malla_horizontal"], figura="104B", jerarquia=1),
                trabas=dict(SPEC["trabas"], figura="103E", jerarquia=3))
rf = _construir_receta_muro(SPEC_FIG)
mh_f = [c for c in rf["componentes"] if c["tipologia"] == "MH"]
tc_f = [c for c in rf["componentes"] if c["tipologia"] == "TC"][0]
check("la figura pedida para la malla horizontal llega a la receta",
      all(c["figura"] == "104B" and c["jerarquia"] == 1 for c in mh_f))
check("la figura y jerarquia pedidas para la traba llegan a la receta",
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

# --- NO INVENTAR ARMADURAS + inventario visible (31-ago: pidio cabezales y el
#     asistente agrego un estribo phi8@10 de 32 barras que nadie pidio)
from armahub.asistente import _inventario, _system_prompt as _sp
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
      [c for c in rc["componentes"] if c["tipologia"] == "TC"][0]["color"] == "#c62828")
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
check("tool proponer_muro es strict con additionalProperties false y pide bordes",
      TOOL_MURO["strict"] is True
      and TOOL_MURO["input_schema"]["additionalProperties"] is False
      and "bordes" in TOOL_MURO["input_schema"]["required"])

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
b = ChatBody(historial=[
    {"rol": "asistente", "texto": "hola"},
    {"rol": "user", "texto": "muro de 6m"},
    {"rol": "user", "texto": "espesor 20"},
], receta_actual={"tipo": "muro"})
msgs = _mensajes_api(b)
check("mensajes: turnos user consecutivos se funden (alternancia de la API)",
      len(msgs) == 2 and msgs[-1]["role"] == "user")
check("mensajes: la receta actual viaja en el ultimo turno",
      '"tipo": "muro"' in msgs[-1]["content"])

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

print()
if FALLAS:
    print("FALLARON %d:" % len(FALLAS), FALLAS)
    sys.exit(1)
print("TODO OK (%s)" % os.path.basename(__file__))
