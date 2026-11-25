# -*- coding: utf-8 -*-
"""CC CONFIRMADOS MODIFICADOS (24-nov) — Auditorías › «CC Confirmados Modificados».

Lo que se congela acá es la REGLA, con horas y barras como las que manda aSa:

  · la confirmación deja su misma hora en el pedido (medido: ±1 min). Eso NO es un cambio;
    si se cuenta, la lista se llena con cada código que la planta confirma;
  · lo modificado se compara SIEMPRE contra la foto de su confirmación, aunque se edite dos
    veces (el primer borrador perdía la foto en la segunda edición);
  · un código re-guardado sin barras ni kilos distintos (una fecha, un comentario) no sale;
  · si la planta vuelve a confirmar, lo detectado queda «reprogramado» y la foto se rehace.

La pasada se prueba con aSa y la base de mentira (en memoria): lo que se mira es qué decide,
no el SQL, que se prueba contra Postgres al publicar.

Correr con: python tests/test_cc_confirmados.py
"""
import os
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


from armahub import cc_confirmados as C  # noqa: E402

UTC = timezone.utc


def t(h, m=0, s=0, dia=24):
    return datetime(2026, 11, dia, h, m, s, tzinfo=UTC)


# ── Las horas de aSa ─────────────────────────────────────────────────────────────
print("Horas de aSa")
check("siete decimales y zona (LastModifiedTime real)",
      C.instante("2026-11-14T18:19:37.7556496+00:00") == datetime(2026, 11, 14, 18, 19, 37, tzinfo=UTC))
check("con Z", C.instante("2026-11-24T16:44:53Z") == t(16, 44, 53))
check("sin zona se toma UTC", C.instante("2026-11-24T16:44:53") == t(16, 44, 53))
check("otra zona se respeta", C.instante("2026-11-24T13:44:53-03:00") == t(16, 44, 53))
check("vacío o basura → None", C.instante(None) is None and C.instante("") is None and C.instante("ayer") is None)

# ── La regla de la hora ─────────────────────────────────────────────────────────
print("Modificado después de confirmar")
conf = t(16, 59, 0)
check("la confirmación misma (40 s después) NO es un cambio", not C.modificado_tras(conf, t(16, 59, 40)))
check("un segundo antes tampoco", not C.modificado_tras(conf, t(16, 58, 59)))
check("4 minutos: todavía dentro de la tolerancia", not C.modificado_tras(conf, t(17, 3)))
check("1 hora y media después SÍ (SVOD: 13:44 → 15:18)", C.modificado_tras(t(16, 44, 53), t(18, 18, 25)))
check("sin hora de modificación no hay cambio", not C.modificado_tras(conf, None))
check("sin confirmación no hay cambio", not C.modificado_tras(None, t(18)))

# ── La foto y la comparación ────────────────────────────────────────────────────
print("Foto de barras")
item = {"ElementDesc": " VC PL-300 R-0+ ", "BarMark": "10mmA12", "BarSizeDescr": "10mm",
        "ShpNameID": "T1", "LengthCut": 2475.61945, "TotalQty": 12.0, "LineWeight": 20.8191}
check("fila de foto: texto limpio, largo entero, cant y kg a 2 decimales",
      C.fila_foto(item) == ["VC PL-300 R-0+", "10mmA12", "10mm", "T1", 2476.0, 12.0, 20.82])
check("lo que aSa manda en null queda vacío o cero",
      C.fila_foto({}) == ["", "", "", "", 0.0, 0.0, 0.0])

A = ["E1", "10mmA1", "10mm", "T1", 2500, 10, 15.4]
B = ["E1", "10mmA2", "10mm", "101", 6000, 4, 14.8]
B_mas = ["E1", "10mmA2", "10mm", "101", 6000, 6, 22.2]
D = ["E2", "12mmA9", "12mm", "102", 3000, 2, 5.3]
d = C.diferencias([A, B], [A, B_mas, D])
check("agregada: la que no estaba", [x["marca"] for x in d["agregadas"]] == ["12mmA9"])
check("quitadas: ninguna", d["quitadas"] == [] and d["n"]["quitadas"] == 0)
check("cambiada: misma marca con otra cantidad, antes y después",
      len(d["cambiadas"]) == 1 and d["cambiadas"][0]["marca"] == "10mmA2"
      and d["cambiadas"][0]["antes"]["cant"] == 4 and d["cambiadas"][0]["despues"]["cant"] == 6)
d = C.diferencias([A, B], [A])
check("quitada: la que ya no está", [x["marca"] for x in d["quitadas"]] == ["10mmA2"]
      and d["n"] == {"agregadas": 0, "quitadas": 1, "cambiadas": 0})
check("igual a la foto → nada", C.diferencias([A, B], [B, A])["n"] == {"agregadas": 0, "quitadas": 0, "cambiadas": 0})
# Una marca en varias líneas del mismo elemento (SVOD trae 10mmA57 tres veces): se suma.
m1, m2 = ["", "10mmA57", "10mm", "T1", 500, 88, 27.4], ["", "10mmA57", "10mm", "T1", 500, 176, 54.8]
check("la misma marca en dos líneas se suma: repartirla distinto no es un cambio",
      C.diferencias([m1, m2], [["", "10mmA57", "10mm", "T1", 500, 264, 82.2]])["n"]["cambiadas"] == 0)
# Sin marca (hay códigos enteros así): la reconoce φ, figura y largo.
s1, s2 = ["EJE 1", "", "12mm", "T3", 2000, 1, 84.0], ["EJE 1", "", "12mm", "T3", 2100, 1, 88.0]
d = C.diferencias([s1], [s2])
check("sin marca: otro largo es otra barra (una quitada y una agregada)",
      d["n"] == {"agregadas": 1, "quitadas": 1, "cambiadas": 0})
mucho = [["E", "m%d" % i, "8mm", "T1", 100, 1, 1.0] for i in range(C.TOPE_LISTA + 5)]
d = C.diferencias([], mucho)
check("la lista guardada tiene tope, el total no", len(d["agregadas"]) == C.TOPE_LISTA
      and d["n"]["agregadas"] == C.TOPE_LISTA + 5)

print("Por diámetro")
pdm = C.diferencias([A, B], [A, B_mas, D])["por_diametro"]
check("kilos por φ, sólo los que cambiaron, del más delgado al más grueso",
      pdm == [["10mm", 30.2, 37.6], ["12mm", 0.0, 5.3]])
check("si no cambió nada, la lista queda vacía", C.diferencias([A, B], [B, A])["por_diametro"] == [])

print("¿Toca lo que se fabrica?")
nada = {"n": {"agregadas": 0, "quitadas": 0, "cambiadas": 0}}
check("sin foto no se puede saber: cuenta", C.hay_cambio(None, None, 100))
check("re-guardado sin barras ni kilos distintos: NO", not C.hay_cambio(nada, 100.0, 100.2))
check("mismas barras pero otros kilos: SÍ", C.hay_cambio(nada, 100.0, 101.0))
check("una barra cambiada: SÍ", C.hay_cambio({"n": {"agregadas": 0, "quitadas": 0, "cambiadas": 1}}, 100.0, 100.0))

print("Foto vigente")
check("foto sin cambios encima: vale", C.foto_vigente({"foto_el": t(10), "mod_visto": None}))
check("cambio anterior a la foto: vale", C.foto_vigente({"foto_el": t(10), "mod_visto": t(9)}))
check("cambio después de la foto: ya no es el estado de hoy", not C.foto_vigente({"foto_el": t(10), "mod_visto": t(11)}))
check("sin foto: no", not C.foto_vigente({"foto_el": None}))

# ── La programación de aSa ──────────────────────────────────────────────────────
print("Programación")
out = {}
for f in ({"CtrlCode": "SV1", "OrderStatus": "Open", "SchedStatusDescr": "Confirmed",
           "SchedLastModified": "2026-11-24T10:00:00+00:00", "Kgs": 1000},
          {"CtrlCode": "SV1", "OrderStatus": "Open", "SchedStatusDescr": "Confirmed",
           "SchedLastModified": "2026-11-24T12:00:00+00:00", "Kgs": 500},
          {"CtrlCode": "SV1", "OrderStatus": "Open", "SchedStatusDescr": "Scheduled",
           "SchedLastModified": "2026-11-24T15:00:00+00:00", "Kgs": 250},
          {"CtrlCode": "SV2", "OrderStatus": "Open", "SchedStatusDescr": "Unscheduled",
           "SchedLastModified": None, "Kgs": 70},
          {"CtrlCode": "", "Kgs": 9}):
    C._sumar_programacion(out, f)
check("los kilos son del código entero, también de la carga no confirmada", out["SV1"]["kg"] == 1750)
check("la confirmación es la más reciente de las filas CONFIRMADAS", out["SV1"]["conf"] == t(12))
check("un código sin filas confirmadas queda sin confirmación", out["SV2"]["conf"] is None)
check("una fila sin código se ignora", "" not in out)


print("La última pasada")
check("sin pasadas todavía", C.ultima(None) is None)
check("terminada bien", C.ultima((t(16, 58), True, None, False)) == {
      "fin": t(16, 58).isoformat(), "ok": True, "detalle": None, "en_curso": False})
check("sin fin y reciente: está corriendo, NO fallida (24-nov)",
      C.ultima((None, False, None, True))["en_curso"] is True)
check("sin fin y vieja: se cortó a la mitad, eso sí es falla",
      C.ultima((None, False, None, False)) == {"fin": None, "ok": False, "detalle": None, "en_curso": False})


# ── La pasada, con aSa y la base de mentira ─────────────────────────────────────
class Mundo:
    """Lo que hay en la base (cc_confirmados y cc_modificados) y lo que aSa entrega."""

    def __init__(self):
        self.confirmados, self.eventos, self.barras_asa, self.llamadas = {}, {}, {}, []
        self.escrituras = []


class Cursor:
    def __init__(self, mundo):
        self.m, self._fila = mundo, None

    def execute(self, sql, params=()):
        if "SELECT barras FROM cc_confirmados" in sql:
            r = self.m.confirmados.get(params[0])
            self._fila = (r.get("barras"),) if r else None

    def fetchone(self):
        return self._fila


class Conn:
    def __init__(self, mundo):
        self.m = mundo

    @contextmanager
    def cursor(self):
        yield Cursor(self.m)

    def commit(self):
        pass


def instalar(mundo):
    """Reemplaza lo que toca la base y aSa por el mundo en memoria."""
    def guardar(cur, cc, c, p):
        fila = mundo.confirmados.setdefault(cc, {})
        fila.update(estado=c["estado"], confirmado_el=c["conf"], foto_el=p.get("foto_el"),
                    kg_foto=p.get("kg_foto"), mod_visto=p.get("mod_visto"))
        mundo.escrituras.append(cc)
        if not p.get("foto_el"):
            fila["barras"] = None

    def guardar_foto(cur, cc, c, p, barras):
        p.update(foto_el=AHORA[0], kg_foto=c["kg"])
        guardar(cur, cc, c, p)
        mundo.confirmados[cc]["barras"] = barras

    def registrar(cur, cc, c, mod, dato, kg_conf, cambios):
        ev = mundo.eventos.setdefault((cc, c["conf"]), {"kg_confirmado": kg_conf, "reprogramado_el": None})
        ev.update(modificado_el=mod, kg_actual=c["kg"], cambios=cambios, resuelto_el=None)

    def reprogramado(cur, cc, conf):
        for (k, _), ev in mundo.eventos.items():
            if k == cc and ev["reprogramado_el"] is None and ev["modificado_el"] < conf:
                ev["reprogramado_el"] = conf

    def leer(cc):
        mundo.llamadas.append(cc)
        return [list(b) for b in mundo.barras_asa.get(cc, [])]

    C._previos = lambda cur: {cc: {k: f.get(k) for k in ("estado", "confirmado_el", "foto_el", "kg_foto",
                                                         "mod_visto")}
                              for cc, f in mundo.confirmados.items()}
    C._datos_pedidos = lambda cur, ccs: {cc: {"obra": "OBRA", "descr": "D", "cubicador": "Nlopez"} for cc in ccs}
    C._guardar_confirmado = guardar
    C._guardar_foto = guardar_foto
    C._registrar = registrar
    C._marcar_reprogramado = reprogramado
    C.leer_barras = leer


AHORA = [t(14)]


def pasada(mundo, confirmados, mods):
    return C._Pasada(Conn(mundo), confirmados, mods).correr()


print("La pasada")
M = Mundo()
instalar(M)
M.barras_asa["SVOD"] = [A, B]
# 14:00 — confirmado a las 13:44, sin cambios: se saca la foto con los kilos de ese momento.
r = pasada(M, {"SVOD": {"estado": "Open", "conf": t(13, 44), "kg": 11000.0}}, {"SVOD": t(13, 44, 20)})
check("confirmado y sin cambios: foto, ningún detectado", r["fotos"] == 1 and r["detectados"] == 0
      and M.confirmados["SVOD"]["kg_foto"] == 11000.0 and M.confirmados["SVOD"]["barras"] == [A, B])
# 20:00 — editado a las 15:18: se compara contra la foto.
AHORA[0] = t(20)
M.barras_asa["SVOD"] = [A, B_mas, D]
r = pasada(M, {"SVOD": {"estado": "Open", "conf": t(13, 44), "kg": 10523.0}}, {"SVOD": t(15, 18)})
ev = M.eventos[("SVOD", t(13, 44))]
check("editado después: detectado, con kilos al confirmar y barras", r["detectados"] == 1
      and ev["kg_confirmado"] == 11000.0 and ev["kg_actual"] == 10523.0
      and ev["cambios"]["n"] == {"agregadas": 1, "quitadas": 0, "cambiadas": 1})
# Misma hora de modificación en el turno siguiente: no se vuelve a pedir a aSa.
n_llamadas = len(M.llamadas)
r = pasada(M, {"SVOD": {"estado": "Open", "conf": t(13, 44), "kg": 10523.0}}, {"SVOD": t(15, 18)})
check("lo ya revisado no se vuelve a pedir", len(M.llamadas) == n_llamadas and r["detectados"] == 0)
M.escrituras = []
pasada(M, {"SVOD": {"estado": "Open", "conf": t(13, 44), "kg": 10523.0}}, {"SVOD": t(15, 18)})
check("y sin novedad no se escribe nada en la base", M.escrituras == [])
pasada(M, {"SVOD": {"estado": "Processed", "conf": t(13, 44), "kg": 10523.0}}, {"SVOD": t(15, 18)})
check("pero si cambió el estado (pasó a Processed) sí", M.escrituras == ["SVOD"]
      and M.confirmados["SVOD"]["estado"] == "Processed")
# Lo dan por resuelto, y alguien lo vuelve a editar: se reabre y se compara CONTRA LA FOTO.
ev["resuelto_el"] = t(21)
M.barras_asa["SVOD"] = [B_mas, D]
r = pasada(M, {"SVOD": {"estado": "Open", "conf": t(13, 44), "kg": 9000.0}}, {"SVOD": t(22)})
ev = M.eventos[("SVOD", t(13, 44))]
check("segunda edición: se compara contra la foto de la confirmación, no se pierde",
      ev["kg_confirmado"] == 11000.0 and ev["cambios"] is not None
      and ev["cambios"]["n"] == {"agregadas": 1, "quitadas": 1, "cambiadas": 1})
check("un cambio nuevo reabre lo resuelto", ev["resuelto_el"] is None and r["detectados"] == 1)
# La planta vuelve a confirmar a las 23:00: lo detectado queda reprogramado y hay foto nueva.
AHORA[0] = t(23, 30)
r = pasada(M, {"SVOD": {"estado": "Open", "conf": t(23), "kg": 9000.0}}, {"SVOD": t(23, 0, 30)})
check("reconfirmado: lo detectado queda marcado", M.eventos[("SVOD", t(13, 44))]["reprogramado_el"] == t(23))
check("reconfirmado con cambios encima de la foto: foto nueva con los kilos de hoy",
      r["fotos"] == 1 and M.confirmados["SVOD"]["kg_foto"] == 9000.0
      and M.confirmados["SVOD"]["confirmado_el"] == t(23))

print("Casos borde")
M = Mundo()
instalar(M)
M.barras_asa["SVAD"] = [A]
# Confirmado y editado entre dos turnos: no hubo foto. Sale igual, sin kilos ni barras.
r = pasada(M, {"SVAD": {"estado": "Processed", "conf": t(9), "kg": 1755.0}}, {"SVAD": t(11)})
ev = M.eventos[("SVAD", t(9))]
check("editado antes de la primera foto: sale, sin kilos al confirmar ni barras",
      r["detectados"] == 1 and r["sin_foto"] == 1 and ev["kg_confirmado"] is None and ev["cambios"] is None)
check("y no se le saca foto (sería la de después del cambio)", M.llamadas == [] and r["fotos"] == 0)
# Re-guardado sin cambios de barras ni kilos: no sale.
M = Mundo()
instalar(M)
M.barras_asa["SVX"] = [A, B]
pasada(M, {"SVX": {"estado": "Open", "conf": t(9), "kg": 30.2}}, {})
r = pasada(M, {"SVX": {"estado": "Open", "conf": t(9), "kg": 30.2}}, {"SVX": t(12)})
check("re-guardado igual (una fecha, un comentario): no sale", r["detectados"] == 0 and M.eventos == {})
check("pero queda visto: no se vuelve a comparar", M.confirmados["SVX"]["mod_visto"] == t(12))
# El tope de fotos: lo que no alcanza queda registrado y se fotografía en otro turno.
M = Mundo()
instalar(M)
tope = C.TOPE_FOTOS
C.TOPE_FOTOS = 2
confs = {"O1": {"estado": "Open", "conf": t(8), "kg": 1.0},
         "O2": {"estado": "Open", "conf": t(9), "kg": 1.0},
         "P1": {"estado": "Processed", "conf": t(10), "kg": 1.0}}
r = pasada(M, confs, {})
check("con tope: primero los Open, los más recientes", r["fotos"] == 2 and M.llamadas == ["O2", "O1"])
check("lo que no alcanzó queda registrado sin foto", M.confirmados["P1"]["foto_el"] is None)
r = pasada(M, confs, {})
check("y se fotografía en el turno siguiente", M.llamadas[-1] == "P1" and r["fotos"] == 1)
C.TOPE_FOTOS = tope
# El tope de comparaciones: lo que no alcanza se compara en el turno siguiente, no se pierde.
M = Mundo()
instalar(M)
tope = C.TOPE_COMPARAR
C.TOPE_COMPARAR = 1
M.barras_asa = {"A1": [A], "A2": [A]}
confs = {"A1": {"estado": "Open", "conf": t(8), "kg": 15.4}, "A2": {"estado": "Open", "conf": t(9), "kg": 15.4}}
pasada(M, confs, {})
M.barras_asa = {"A1": [A, D], "A2": [A, D]}
confs = {"A1": {"estado": "Open", "conf": t(8), "kg": 20.7}, "A2": {"estado": "Open", "conf": t(9), "kg": 20.7}}
r = pasada(M, confs, {"A1": t(12), "A2": t(12)})
check("con tope de comparaciones: compara uno", r["comparados"] == 1 and r["detectados"] == 1)
r = pasada(M, confs, {"A1": t(12), "A2": t(12)})
check("y el otro en el turno siguiente, con su foto", r["comparados"] == 1 and len(M.eventos) == 2
      and all(e["cambios"] is not None for e in M.eventos.values()))
C.TOPE_COMPARAR = tope

print()
print("FALLOS: %d" % fallos if fallos else "Todo OK")
sys.exit(1 if fallos else 0)
