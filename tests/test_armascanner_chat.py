"""CHAT DEL CUBICADOR DE ARMASCANNER EN ARMAHUB (armahub/armascanner_chat.py).

Sin la API real ni Postgres: un cliente de Anthropic FALSO devuelve respuestas armadas a mano y anota
lo que se le pidió; la base es SQLite en memoria con la migración real 175. Las fichas de licencia
se simulan (la ficha es el correo). Correr con: python tests/test_armascanner_chat.py
"""
import contextlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")
os.environ["ANTHROPIC_API_KEY"] = "clave-falsa-de-prueba"

from armahub import armascanner_chat as CH  # noqa: E402

fallos = 0


def check(nombre, cond, detalle=""):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -- " + str(detalle)[:300]) if not cond else ""))
    if not cond:
        fallos += 1


def error(f):
    try:
        f()
    except ValueError as e:
        return str(e)
    return None


# ══════ Las reglas puras ══════
print("TEST: la herramienta respeta las lecciones del asistente de muros")
esquema = json.dumps(CH.TOOL_PROPONER)
check("sin strict, sin anyOf, sin tipos anulables", "strict" not in CH.TOOL_PROPONER and "anyOf" not in esquema
      and '"null"' not in esquema)
check("required mínimo: sólo la acción", CH.TOOL_PROPONER["input_schema"]["required"] == ["accion"])
check("las acciones de la etapa 1", set(CH.TOOL_PROPONER["input_schema"]["properties"]["accion"]["enum"]) == {
    "aprobar", "quitar_aprobacion", "observar", "quitar_observacion", "excluir", "incluir", "fabricacion",
    "consultar", "crear_barras"})
check("los modelos del selector, Sonnet 5.5 por defecto",
      CH.MODELOS == ("claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5")
      and CH.MODELO == "claude-sonnet-5-5")
check("el prompt de sistema es corto y dice el estándar",
      len(CH.SISTEMA) < 2500 and "Propones y el cubicador confirma" in CH.SISTEMA and "No inventas" in CH.SISTEMA
      and "con duda" in CH.SISTEMA)

print("\nTEST: criterio, ficha y propuesta revisados")
c = CH.criterio_de({"ids": ["B-0012", " 13 ", ""], "desde": 0, "hasta": 0, "losa": ["507"], "ciclo": [2, 0, "x"],
                    "marca": [], "diametro": [10], "estado": ["pendiente"], "nivel": [], "variable": ""})
check("criterio: sin lo vacío, con los valores revisados",
      c == {"ids": ["B-0012", "13"], "losa": ["507"], "ciclo": [2], "diametro": [10], "estado": ["pendiente"]}, c)
check("criterio: variable si/no → True/False",
      CH.criterio_de({"variable": "si"}) == {"variable": True} and CH.criterio_de({"variable": "no"}) == {"variable": False})
check("criterio: un estado que no existe es un error", error(lambda: CH.criterio_de({"estado": ["con consulta"]})))
check("criterio: sin criterio, todas las barras ({})", CH.criterio_de(None) == {} and CH.criterio_de({}) == {})
f = CH.ficha_de({"marca": "ESL", "figura": "", "diametro": 8, "lados": {"A": 0, "B": 20, "C": 30, "Z": 5},
                 "cantidad": 10, "espaciamiento": 0, "distribucion": 0, "losa": "507", "ciclo": 0, "nota": "  "})
check("ficha: sólo lo que el cubicador fijó", f == {"marca": "ESL", "diametro": 8, "lados": {"B": 20.0, "C": 30.0},
                                                    "cantidad": 10, "losa": "507"}, f)
check("ficha: sin marca es un error", error(lambda: CH.ficha_de({"diametro": 8})))
p = CH.propuesta_de({"accion": "aprobar", "resumen": "Aprobar la losa 507", "criterio": {"losa": ["507"]}})
check("propuesta aprobar", p == {"accion": "aprobar", "resumen": "Aprobar la losa 507", "criterio": {"losa": ["507"]},
                                 "parametros": {}}, p)
check("propuesta observar: con nota", CH.propuesta_de({"accion": "observar", "nota": " largo? ", "criterio": {"ids": ["3"]}})
      ["parametros"] == {"nota": "largo?"})
check("propuesta observar: sin nota es un error", "sin nota" in (error(lambda: CH.propuesta_de({"accion": "observar"})) or ""))
fab = CH.propuesta_de({"accion": "fabricacion", "paquete": 5, "cierre": "inicio", "holgura": -1, "criterio": {"variable": "si"}})
check("propuesta fabricación: paquetes, cierre al inicio, ajuste de la casa",
      fab["parametros"] == {"paquete": 5, "lado": "inicio", "holgura": None} and fab["criterio"] == {"variable": True}, fab)
check("propuesta fabricación: 0 = un largo por barra (sin cierre ni ajuste)",
      CH.propuesta_de({"accion": "fabricacion", "paquete": 0, "holgura": 40})["parametros"]
      == {"paquete": None, "lado": None, "holgura": None})
check("propuesta fabricación: 1 por paquete es un error", error(lambda: CH.propuesta_de({"accion": "fabricacion", "paquete": 1})))
check("propuesta consultar: lo que se calcula (contar por defecto)",
      CH.propuesta_de({"accion": "consultar"})["parametros"] == {"consulta": "contar"}
      and CH.propuesta_de({"accion": "consultar", "consulta": "kilos"})["parametros"] == {"consulta": "kilos"})
cb = CH.propuesta_de({"accion": "crear_barras", "ficha": {"marca": "ESL", "cantidad": 10}, "criterio": {"losa": ["1"]}})
check("propuesta crear_barras: la ficha, sin criterio", cb["parametros"] == {"ficha": {"marca": "ESL", "cantidad": 10}}
      and cb["criterio"] == {}, cb)
check("propuesta: acción que no existe es un error", error(lambda: CH.propuesta_de({"accion": "borrar_todo"})))

print("\nTEST: lo que viaja a la API")
cuerpo = CH.ChatBody(mensaje="aprueba la losa 507", obra="PROY-1", plano="215", resumen={"barras": 3},
                     historial=[{"rol": "asistente", "texto": "hola"}, {"rol": "user", "texto": "a"},
                                {"rol": "asistente", "texto": "b"}, {"rol": "user", "texto": "c"}],
                     barras=[{"id": "B-0001"}])
m = CH.mensajes_api(cuerpo)
check("historial: empieza por el cubicador, alterna y el contexto va sólo en el último",
      [x["role"] for x in m] == ["user", "assistant", "user"] and m[0]["content"] == "a"
      and m[-1]["content"].startswith("c\n\nPlano: 215 · Obra: PROY-1") and "Resumen del plano" not in m[0]["content"]
      and m[-1]["content"].endswith("Pedido del cubicador: aprueba la losa 507") and '"B-0001"' in m[-1]["content"], m)
largo = CH.ChatBody(mensaje="x", historial=[{"rol": "user" if k % 2 == 0 else "asistente", "texto": str(k)} for k in range(40)])
check("historial: sólo los últimos turnos", len(CH.mensajes_api(largo)) <= CH.HISTORIAL_MAX + 1)
check("resumen enorme: se recorta", len(CH.mensajes_api(CH.ChatBody(mensaje="x", resumen={"a": "z" * 50000}))[-1]["content"])
      < CH.RESUMEN_MAX + 500)

print("\nTEST: errores en castellano, con el detalle detrás")
check("sin crédito", CH.explicar_error(400, "Your credit balance is too low").startswith("La cuenta de la API se quedó sin crédito"))
check("saturada", CH.explicar_error(529, "Overloaded").startswith("La API está saturada"))
check("modelo inexistente", "Elige otro modelo" in CH.explicar_error(404, "not_found_error: model"))
check("500 genérico: pasajero, con el detalle", CH.explicar_error(500, "boom").startswith("La API tuvo un problema pasajero")
      and "Detalle técnico: boom" in CH.explicar_error(500, "boom"))


# ══════ Las rutas, contra SQLite y un cliente falso ══════
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from armahub.armascanner import acceso as A  # noqa: E402
from armahub.db import _split_sql_statements  # noqa: E402

sqlite3.register_converter("JSONB", json.loads)
sqlite3.register_converter("TIMESTAMPTZ", lambda v: datetime.fromisoformat(v.decode()))
sqlite3.register_adapter(datetime, lambda d: d.isoformat())
BASE = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES, check_same_thread=False)
BASE.create_function("NOW", 0, lambda: datetime.now(timezone.utc).isoformat())


class Cursor:
    def __init__(self):
        self.c = BASE.cursor()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.c.close()

    def execute(self, sql, params=()):
        self.c.execute(sql.replace("::jsonb", "").replace("%s", "?"), list(params or ()))

    def fetchone(self):
        return self.c.fetchone()


class Conexion:
    def cursor(self):
        return Cursor()


@contextlib.contextmanager
def get_conn():
    try:
        yield Conexion()
        BASE.commit()
    except Exception:
        BASE.rollback()
        raise


print("\nTEST: migración 175")
nombre = next(f for f in os.listdir(os.path.join(ROOT, "armahub", "migrations")) if f.startswith("175_"))
sentencias = _split_sql_statements(open(os.path.join(ROOT, "armahub", "migrations", nombre), encoding="utf-8").read())
check("sólo sentencias que se pueden repetir", all(s.startswith(("CREATE TABLE IF NOT EXISTS", "CREATE INDEX IF NOT EXISTS"))
                                                    for s in sentencias), sentencias)
for s in sentencias:
    BASE.execute(s.replace("SERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT")
                 .replace("DEFAULT NOW()", "DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))"))  # ISO, como NOW()
columnas = {f[1] for f in BASE.execute("PRAGMA table_info(armascanner_chat)").fetchall()}
check("la tabla trae lo que se registra", {"usuario", "obra", "plano", "modelo", "mensaje", "respuesta", "propuesta",
                                           "resultado", "barras", "tokens_entrada", "tokens_salida", "creado_el",
                                           "resultado_el", "eventos"} <= columnas, columnas)


def texto(t):
    return NS(type="text", text=t)


def herramienta(entrada, tid="tu_1"):
    return NS(type="tool_use", id=tid, name="proponer_accion", input=entrada)


def respuesta(*bloques, stop="end_turn", entrada=100, salida=20):
    return NS(content=list(bloques), stop_reason=stop,
              usage=NS(input_tokens=entrada, output_tokens=salida, cache_read_input_tokens=5,
                       cache_creation_input_tokens=0))


class Falso:
    """El cliente de Anthropic, falso: devuelve las respuestas de la cola y anota cada pedido."""

    def __init__(self):
        self.cola, self.pedidos, self.opciones = [], [], []
        self.messages = NS(create=lambda **kw: self._crear("messages", kw))
        self.beta = NS(messages=NS(create=lambda **kw: self._crear("beta", kw)))

    def with_options(self, **kw):  # como el SDK: el mismo cliente con otras opciones (se anotan)
        self.opciones.append(kw)
        return self

    def _crear(self, via, kw):
        self.pedidos.append((via, kw))
        r = self.cola.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


FALSO = Falso()
CH._cliente = lambda: FALSO
CH.get_conn = get_conn
A._usuario = lambda cur, ficha: {"email": ficha, "role": "cubicador"}

app = FastAPI()
app.include_router(CH.router)
web = TestClient(app)
EMI, EUG = "emilio@x.cl", "eugenio@x.cl"


def chatear(email, mensaje, **mas):
    cuerpo = dict({"mensaje": mensaje, "obra": "PROY-1", "plano": "215-LOSA", "resumen": {"barras": 25},
                   "version_app": "2026-11-23.1"}, **mas)
    return web.post("/armascanner/chat", headers={"Authorization": "Bearer " + email}, json=cuerpo)


def fila(rid):
    BASE.row_factory = sqlite3.Row
    try:
        return dict(BASE.execute("SELECT * FROM armascanner_chat WHERE id = ?", (rid,)).fetchone())
    finally:
        BASE.row_factory = None


print("\nTEST: POST /armascanner/chat")
FALSO.cola = [respuesta(texto("¿De qué losa?"))]
r = chatear(EMI, "aprueba las limpias")
d = r.json()
check("sólo texto: sin propuesta, registrado", r.status_code == 200 and d["texto"] == "¿De qué losa?"
      and d["propuesta"] is None and d["modelo"] == "claude-sonnet-5-5", d)
via, kw = FALSO.pedidos[-1]
check("el pedido a la API: modelo, sistema con caché, la herramienta, tool_choice auto, sin thinking",
      kw["model"] == "claude-sonnet-5-5" and kw["system"][0]["text"] == CH.SISTEMA
      and kw["system"][0]["cache_control"] == {"type": "ephemeral"} and kw["tools"] == [CH.TOOL_PROPONER]
      and kw["tool_choice"] == {"type": "auto"} and "thinking" not in kw and kw["output_config"] == {"effort": "low"}, kw)
check("Sonnet: con fallbacks (beta)", via == "beta" and kw["betas"] == [CH.BETA_FALLBACK]
      and kw["extra_body"] == {"fallbacks": "default"})
f = fila(d["id"])
check("registro: usuario, obra, plano, modelo, mensaje, respuesta, tokens (con la caché)",
      (f["usuario"], f["obra"], f["plano"], f["modelo"], f["mensaje"], f["respuesta"], f["tokens_entrada"],
       f["tokens_salida"], f["propuesta"], f["version_app"])
      == (EMI, "PROY-1", "215-LOSA", "claude-sonnet-5-5", "aprueba las limpias", "¿De qué losa?", 105, 20, None,
          "2026-11-23.1"), f)

FALSO.cola = [respuesta(texto("Propongo aprobar."), herramienta({"accion": "aprobar", "resumen": "Aprobar 507",
                                                                 "criterio": {"losa": ["507"], "nivel": ["ok"]}}),
                        stop="tool_use")]
r = chatear(EMI, "aprueba las limpias de la 507", modelo="claude-haiku-5-5")
d = r.json()
check("con propuesta: la acción y el criterio, nunca barras",
      d["propuesta"] == {"accion": "aprobar", "resumen": "Aprobar 507", "criterio": {"losa": ["507"], "nivel": ["ok"]},
                         "parametros": {}} and d["texto"] == "Propongo aprobar.", d)
check("Haiku: sin fallbacks (no lo tiene)", FALSO.pedidos[-1][0] == "messages" and "betas" not in FALSO.pedidos[-1][1]
      and FALSO.pedidos[-1][1]["model"] == "claude-haiku-5-5")
f = fila(d["id"])
check("registro: la propuesta en JSON y su acción", f["propuesta"]["criterio"] == {"losa": ["507"], "nivel": ["ok"]}
      and f["accion"] == "aprobar" and f["modelo"] == "claude-haiku-5-5", f)

n = len(FALSO.pedidos)
r = chatear(EMI, "hola", modelo="gpt-5")
check("modelo fuera de la lista: 400, sin llamar a la API", r.status_code == 400 and "no disponible" in r.json()["detail"]
      and len(FALSO.pedidos) == n)
check("mensaje vacío: 400", chatear(EMI, "   ").status_code == 400)

FALSO.cola = [respuesta(herramienta({"accion": "observar", "criterio": {"ids": ["3"]}}), stop="tool_use"),
              respuesta(texto("Corregido."), herramienta({"accion": "observar", "nota": "largo del lado B",
                                                          "criterio": {"ids": ["3"]}}, "tu_2"), stop="tool_use")]
r = chatear(EUG, "observa la 3")
d = r.json()
via, kw = FALSO.pedidos[-1]
devuelto = kw["messages"][-1]["content"][0]
check("propuesta incompleta: vuelve UNA vez a la IA con el motivo, como tool_result con error",
      devuelto["type"] == "tool_result" and devuelto["tool_use_id"] == "tu_1" and devuelto["is_error"]
      and "sin nota" in devuelto["content"] and kw["messages"][-2]["role"] == "assistant", kw["messages"][-2:])
check("la segunda vale: queda la propuesta corregida",
      d["propuesta"]["parametros"] == {"nota": "largo del lado B"} and d["texto"] == "Corregido.", d)
check("registro: los tokens de las dos llamadas", fila(d["id"])["tokens_entrada"] == 210 and fila(d["id"])["tokens_salida"] == 40)
check("la corrección va sin reintento (el peor caso queda bajo el corte de ArmaScanner)",
      FALSO.opciones[-1] == {"max_retries": 0} and CH.INTENTO * 2 <= CH.PLAZO < 150, FALSO.opciones)

CH.PLAZO, n = 0.0, len(FALSO.pedidos)
FALSO.cola = [respuesta(texto("Listo."), herramienta({"accion": "observar", "criterio": {"ids": ["3"]}}), stop="tool_use")]
d = chatear(EUG, "observa la 3").json()
check("sin plazo para corregirla: no hay segunda llamada; sale el texto con el motivo",
      len(FALSO.pedidos) == n + 1 and d["propuesta"] is None and "La propuesta venía incompleta: observar sin nota" in d["texto"],
      d)
CH.PLAZO = 110.0

FALSO.cola = [respuesta(herramienta({"accion": "observar"}), stop="tool_use"),
              respuesta(herramienta({"accion": "observar"}, "tu_2"), stop="tool_use")]
d = chatear(EUG, "observa la 3").json()
check("dos veces incompleta: sólo texto, con el motivo, y el error en el registro",
      d["propuesta"] is None and "La propuesta venía incompleta: observar sin nota" in d["texto"]
      and "sin nota" in (fila(d["id"])["error"] or ""), d)

FALSO.cola = [respuesta(stop="refusal")]
d = chatear(EUG, "algo").json()
check("rechazo del modelo: lo dice, sin propuesta", d["propuesta"] is None and "filtros de seguridad" in d["texto"], d)

FALSO.cola = [respuesta(herramienta({"accion": "crear_barras", "resumen": "10 estribos", "ficha": {
    "marca": "ESL", "diametro": 8, "cantidad": 10, "lados": {"B": 20, "C": 30}, "losa": "507"}}), stop="tool_use")]
d = chatear(EUG, "agrega 10 estribos Ø8 de 20x30 en la losa 507").json()
check("crear barras: la ficha con lo que dijo el cubicador; el texto, del resumen",
      d["propuesta"]["parametros"]["ficha"] == {"marca": "ESL", "diametro": 8, "cantidad": 10,
                                                "lados": {"B": 20.0, "C": 30.0}, "losa": "507"}
      and d["texto"] == "10 estribos", d)

print("\nTEST: tope diario por usuario (contado en el registro)")
from zoneinfo import ZoneInfo  # noqa: E402
cero = CH._hoy().astimezone(ZoneInfo("America/Santiago"))
check("el día del tope es el de Chile: cuenta desde las 00:00 de allá",
      (cero.hour, cero.minute, cero.date()) == (0, 0, datetime.now(ZoneInfo("America/Santiago")).date()), cero)
CH.TOPE_DIA = 2
ayer = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
BASE.execute("INSERT INTO armascanner_chat (usuario, creado_el) VALUES (?, ?)", ("nuevo@x.cl", ayer))
BASE.commit()
FALSO.cola = [respuesta(texto("1")), respuesta(texto("2"))]
codigos = [chatear("nuevo@x.cl", "a").status_code, chatear("nuevo@x.cl", "b").status_code]
n = len(FALSO.pedidos)
r = chatear("nuevo@x.cl", "c")
check("los de ayer no cuentan; al tope, 429 sin llamar a la API",
      codigos == [200, 200] and r.status_code == 429 and "tope diario" in r.json()["detail"] and len(FALSO.pedidos) == n,
      (codigos, r.status_code))
check("el tope es por usuario", (FALSO.cola.append(respuesta(texto("ok"))) or chatear("otro@x.cl", "a")).status_code == 200)
CH.TOPE_DIA = 150

print("\nTEST: sin clave de la API")
os.environ.pop("ANTHROPIC_API_KEY")
r = chatear(EUG, "hola")
check("503 con el motivo", r.status_code == 503 and "falta la clave" in r.json()["detail"])
os.environ["ANTHROPIC_API_KEY"] = "clave-falsa-de-prueba"

print("\nTEST: POST /armascanner/chat/resultado")
FALSO.cola = [respuesta(herramienta({"accion": "excluir", "criterio": {"ids": ["7"]}}), stop="tool_use")]
rid = chatear(EMI, "excluye la 7").json()["id"]


def resultado(email, **cuerpo):
    return web.post("/armascanner/chat/resultado", headers={"Authorization": "Bearer " + email}, json=cuerpo)


r1 = resultado(EMI, id=rid, resultado="cambio", barras=1, kg=3.21, detalle="otra barra aprobada")
r2 = resultado(EMI, id=rid, resultado="aplicado", barras=1, kg=3.21)
f = fila(rid)
check("aplicada después de un cambio: manda el último, quedan los dos en eventos",
      r1.status_code == r2.status_code == 200 and f["resultado"] == "aplicado" and f["barras"] == 1 and f["kg"] == 3.2
      and [e["resultado"] for e in f["eventos"]] == ["cambio", "aplicado"] and f["resultado_el"] is not None, f)
check("de otro usuario: 404", resultado(EUG, id=rid, resultado="cancelado").status_code == 404)
check("resultado desconocido: 400", resultado(EMI, id=rid, resultado="borrado").status_code == 400)
check("pedido que no existe: 404", resultado(EMI, id=99999, resultado="cancelado").status_code == 404)

print("\nTEST: la ruta está montada en la app (también bajo /api/v1)")
main = open(os.path.join(ROOT, "armahub", "main.py"), encoding="utf-8").read()
check("main.py la incluye sin prefijo y en /api/v1", main.count("armascanner_chat_router") == 3)

print(f"\n{'TODO OK' if not fallos else f'FALLOS: {fallos}'}")
sys.exit(1 if fallos else 0)
