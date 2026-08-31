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

# --- ficha del muro del test canónico: 400×250×20, recub 2.5, φ10@55/@90, TM φ8
SPEC = {
    "geometria": {"largo": 400, "alto": 250, "espesor": 20, "recubrimiento": 2.5},
    "malla_vertical": {"diam": 10, "sep": 90},
    "malla_horizontal": {"diam": 10, "sep": 55},
    "doble_malla": True,
    "trabas": {"diam": 8, "sx": 100, "sy": 60},
    "origenes": {"geometria": "leido", "recubrimiento": "config",
                 "malla_vertical": "leido", "malla_horizontal": "leido",
                 "doble_malla": "asumido", "trabas": "asumido"},
}

r = _construir_receta_muro(SPEC)
geo = r["geometria"]
check("tipo muro", r["tipo"] == "muro")
check("geometria canonica (ancho=espesor, recub triple)",
      geo == {"largo": 400.0, "alto": 250.0, "ancho": 20.0,
              "recub_sup": 2.5, "recub_inf": 2.5, "recub_lat": 2.5})

mh, mv, tm = r["componentes"]
Z = 20 / 2 - 2.5 - 0.5   # 7 — eje de cortina del test canónico
check("MH: arreglo 2 cortinas en z ±7 (sep_capas 14)",
      mh["comp_id"] == "MH" and mh["tipologia"] == "MA"
      and mh["distribucion"]["n_capas"] == 2
      and mh["distribucion"]["sep_capas"] == 2 * Z
      and mh["distribucion"]["eje_capas"] == "z")
check("MH: rango en y de borde a borde con su recub+φ/2",
      mh["distribucion"]["rango"] == {"eje": "y", "from": -122.0, "to": 122.0, "sep": 55.0})
check("MV: de pie, rango en x",
      mv["comp_id"] == "MV" and mv["plano_pieza"]["orientacion"] == "de_pie"
      and mv["distribucion"]["rango"]["eje"] == "x"
      and mv["distribucion"]["rango"]["from"] == -197.0)
check("TM: volteada, filas en y cada 60 (int((250-5)//60)+1 = 5)",
      tm["comp_id"] == "TM" and tm["plano_pieza"]["volteado"] is True
      and tm["distribucion"]["n_capas"] == 5
      and tm["distribucion"]["rango"] == {"eje": "x", "from": -197.5, "to": 197.5, "sep": 100.0})
check("dims todas en auto (el motor calcula largos, no el modelo)",
      all(c["dims"] == {"A": {"modo": "auto"}} for c in r["componentes"]))

# --- malla simple: 1 cortina, sin trabas aunque la ficha las traiga
simple = dict(SPEC, doble_malla=False)
r2 = _construir_receta_muro(simple)
check("malla simple: 1 cortina y sin trabas",
      len(r2["componentes"]) == 2
      and all(c["distribucion"]["n_capas"] == 1 for c in r2["componentes"]))

# --- resumen para el formulario del chat
filas = _resumen_de_spec(SPEC)
check("resumen: 2 secciones + 6 campos con origen",
      sum(1 for f in filas if "seccion" in f) == 2
      and sum(1 for f in filas if f.get("origen")) == 6 + 1)  # 7 filas con chip
check("resumen: recubrimiento sale de config",
      any(f.get("label") == "Recubrimiento" and f["origen"] == "config" for f in filas))

# --- schema estricto: la API rechaza campos de más (strict=True exige esto)
check("tool proponer_muro es strict con additionalProperties false",
      TOOL_MURO["strict"] is True
      and TOOL_MURO["input_schema"]["additionalProperties"] is False)

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
check("conocimiento_asistente.md existe con seccion MURO",
      "## MURO" in io.open(os.path.join(BASE, "armahub", "data",
                                        "conocimiento_asistente.md"), encoding="utf-8").read())

print()
if FALLAS:
    print("FALLARON %d:" % len(FALLAS), FALLAS)
    sys.exit(1)
print("TODO OK (%s)" % os.path.basename(__file__))
