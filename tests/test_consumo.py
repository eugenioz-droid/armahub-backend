"""CONSUMO EN aSa DATA: C&D CONTRA BARRAS EN PUNTA (20-nov).

El usuario pidió ver lo que consume cada obra en cortado y doblado contra las barras en
punta, juntando la obra «X - BARRAS» de aSa con su gemela, y al hacer clic los diámetros.
Lo que se congela acá:
  · la clase sale del PRODUCTO de aSa (no del nombre de la obra), con el largo comercial;
  · la obra de barras se junta con su gemela por número sin «B» o por nombre;
  · el endpoint suma por obra emparejada, por diámetro y por largo, sin anulados.

Correr con: python tests/test_consumo.py
"""
import os
import sys
from contextlib import contextmanager

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

import armahub.asa_sync as S  # noqa: E402
import armahub.programacion as P  # noqa: E402

fallos = 0


def check(nombre, cond, detalle=""):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -- " + str(detalle)[:200]) if not cond else ""))
    if not cond:
        fallos += 1


print("TEST: Consumo")
c = S.clase_producto
check("barra en punta con su largo", c("B HORMIGON 12MM 12M A630-420H") == ("barra", 12.0))
check("barra de 6 m", c("B HORMIGON 8MM 6M A630-420H") == ("barra", 6.0))
check("barra con calidad (N)", c("B HORMIGON 32MM 12M A630-420HS (N)") == ("barra", 12.0))
check("cortado y doblado", c("FIERRO A630-420H CYD 12MM") == ("cyd", None))
check("C&D con la marca al final", c("FIERRO A440-280H (N) 8MM CYD") == ("cyd", None))
check("malla y elementos = otro", c("MALLA C-188 260CM 5M")[0] == "otro" and c("ELEVACION MURO")[0] == "otro")

OBRAS = {
    "2012005": {"nombre": "ABSALON - EDIFICIO ALTAMURA", "barras": False},
    "2012005B": {"nombre": "ABSALON - EDIFICIO ALTAMURA - BARRAS", "barras": True},
    "77": {"nombre": "PL - EDIFICIO OPERA", "barras": False},
    "99B": {"nombre": "PL - EDIFICIO OPERA - BARRAS", "barras": True},
    "24-00087": {"nombre": "ECHEVERRIA - BARRAS", "barras": True},
}
par = P._pareja_de_obras(OBRAS)
check("se junta por el número sin la B", par["2012005B"] == "2012005")
check("se junta por el nombre sin «- BARRAS»", par["99B"] == "77")
check("sin gemela queda sola", par["24-00087"] == "24-00087")
check("la obra normal es su propia pareja", par["2012005"] == "2012005")


class Cur:
    def __init__(self, log):
        self.log, self.r = log, []

    def execute(self, sql, params=None):
        self.log.append((sql, list(params or [])))
        if "FROM asa_obras" in sql:
            self.r = [("2012005", "ABSALON - EDIFICIO ALTAMURA", "ABSALON", False),
                      ("2012005B", "ABSALON - EDIFICIO ALTAMURA - BARRAS", "ABSALON", False),
                      ("5", "Obra de Prueba", "", False)]
        elif "FROM asa_obra_atributos" in sql:
            self.r = [("2012005", "Cubicación", "1 y 2")]
        elif "SUM(c.kg)" in sql:
            self.r = [("2012005", 12, "cyd", None, 1000, 300),
                      ("2012005B", 12, "barra", 12, 532.8, 50),
                      ("2012005B", 8, "barra", 6, 100, 40),
                      ("5", 10, "cyd", None, 999, 9)]
        elif "DISTINCT p.anio" in sql:
            self.r = [(2026,)]
        else:
            self.r = [(None,)]

    def fetchall(self):
        return self.r

    def fetchone(self):
        return self.r[0] if self.r else None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Conn:
    def __init__(self, log):
        self.log = log

    def cursor(self, **kw):
        return Cur(self.log)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


log = []


@contextmanager
def falsa():
    yield Conn(log)


orig = P.get_conn
P.get_conn = falsa
try:
    r = P.asa_consumo(anio=2026, meses="10,11", segmentos="", tipos="", user={"role": "admin"})
    r2 = P.asa_consumo(anio=2026, meses="", segmentos="4 y 5", tipos="", user={"role": "admin"})
finally:
    P.get_conn = orig

sql, params = [(s, p) for s, p in log if "SUM(c.kg)" in s][0]
check("sin anulados", "p.estado IS DISTINCT FROM %s" in sql and params[0] == "Cancelled")
check("filtra año y meses", params[1] == 2026 and params[2] == [10, 11], params)
check("tantos parámetros como marcadores", sql.count("%s") == len(params))
check("la obra de prueba no entra", [o["key"] for o in r["obras"]] == ["2012005"], r["obras"])
o = r["obras"][0]
check("una sola fila con las dos obras", sorted(o["jobs"]) == ["2012005", "2012005B"] and o["pareada"])
check("nombre sin «- BARRAS»", o["nombre"] == "ABSALON - EDIFICIO ALTAMURA")
check("kilos por clase", o["cyd"] == 1000 and o["barra"] == 633 and o["otro"] == 0, o)
check("barras en unidades", o["barra_pzs"] == 90)
check("barras por largo", o["largos"] == {"12": 50, "6": 40}, o["largos"])
check("diámetros ordenados con sus kilos",
      [(d["d"], d["cyd"], d["barra"], d["pzs"]) for d in o["diam"]] == [(8, 0, 100, 40), (12, 1000, 533, 50)], o["diam"])
check("el segmento de la obra madre filtra", r2["obras"] == [])
check("dice qué años están cargados", r["anios_cargados"] == [2026])

JS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "programacion", "consumo.js"), encoding="utf-8").read()
DJS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "programacion", "dashboards.js"), encoding="utf-8").read()
HTM = open(os.path.join(ROOT, "armahub", "templates", "tabs", "asa_data.html"), encoding="utf-8").read()
check("pestaña Consumo en aSa Data", "asaSubTab('cons')" in HTM and ">Consumo</button>" in HTM)
check("un color fijo por clase", "cyd: '#7EBA27', barra: '#104F9E', otro: '#687582'" in JS)
check("el período de arriba viaja al consumo", "anio: ANIO, meses: MESES.slice()" in DJS)
check("en Consumo se esconde el filtro de cubicador", "filaDet.style.display = (v === 'cons')" in DJS)

print(f"\n{'TODO OK' if not fallos else str(fallos) + ' FALLOS'}")
sys.exit(1 if fallos else 0)
