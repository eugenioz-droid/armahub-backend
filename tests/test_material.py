# -*- coding: utf-8 -*-
"""MATERIAL DISPONIBLE (25-nov) — la caluga para reciclar barras (SPECS §15), fase 1.

Lo que se congela acá:
  · una barra que viene de aSa y una medida a mano quedan con la MISMA forma (lados en orden
    con su tipo, su giro y si son gancho): es lo que la búsqueda de la fase 2 compara;
  · la cantidad de una devolución se ajusta, pero nunca pasa la del ítem;
  · a mano, la figura es la barra de ejemplo de aSa con los largos del usuario: así se dibujan
    también los soportes 26 (en dos planos) y los arcos, que eran los que se caían;
  · entra administración y quien integra una de las áreas de la caluga.

Las figuras de ejemplo son REALES (asa_figuras, 25-nov): el soporte 26, el arco 9 y el estribo T1.

Correr con: python tests/test_material.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


from armahub import material as M  # noqa: E402

EJ = json.load(open(os.path.join(ROOT, "tests", "material_figuras_ejemplo.json"), encoding="utf-8"))


class Cursor:
    """Devuelve las filas que se le den, y guarda lo último que se ejecutó."""

    def __init__(self, filas=None, una=None):
        self.filas, self.una, self.sql, self.params = filas or [], una, None, None

    def execute(self, sql, params=None):
        self.sql, self.params = sql, params

    def fetchall(self):
        return self.filas

    def fetchone(self):
        return self.una


print("Quién entra")
check("administración siempre, sin mirar áreas", M.puede(Cursor(), {"role": "admin"})
      and M.puede(Cursor(), {"role": "admin_calidad"}))
c = Cursor(una=(1,))
check("un miembro de una de las áreas, sí", M.puede(c, {"role": "miembro", "email": "x@y"})
      and c.params[0] == list(M.AREAS) and c.params[1] == "x@y")
check("uno que no es de ninguna, no", not M.puede(Cursor(una=None), {"role": "miembro", "email": "x@y"}))
check("las áreas son las acordadas con el usuario (24-nov)",
      set(M.AREAS) == {"Cubicaciones", "Calidad", "Logística", "USC C&D", "Producción C&D"})

print("Cantidad")
check("un entero de 1 en adelante", M.cantidad_valida("3") == 3)
for malo in ("0", "-2", "dos", None):
    try:
        M.cantidad_valida(malo)
        check("rechaza %r" % malo, False)
    except M.ErrorMaterial:
        check("rechaza %r" % malo, True)
try:
    M.cantidad_valida(25, 22)
    check("más que la del ítem: no", False)
except M.ErrorMaterial as e:
    check("más que la del ítem: no, y lo dice con la cantidad del ítem", "22" in str(e))
check("menos que la del ítem (una devolución incompleta): sí", M.cantidad_valida(10, 22) == 10)

print("Las figuras para el ingreso a mano")
filas = [(k, v["barras"], v["legangle"], v["shapedims"], v["pin"], v["diam"]) for k, v in EJ.items()]
M._figuras.update(t=0, lista=None)
figs = M.figuras(Cursor(filas=filas))
por = {f["codigo"]: f for f in figs}
check("la recta va primero", figs[0]["codigo"] is None and figs[0]["nombre"] == "Recta"
      and [l["nombre"] for l in figs[0]["lados"]] == ["A"])
check("el soporte 26 está, aunque aSa lo doble en dos planos", "26" in por and por["26"]["tridimensional"]
      and len(por["26"]["lados"]) == 5)
check("el arco 9: un lado curvo", [(l["nombre"], l["arco"]) for l in por["9"]["lados"]] == [("B", True)])
check("el estribo T1: los ganchos de las puntas vienen marcados",
      [l["gancho"] for l in por["T1"]["lados"]] == [True, False, False, False, False, True])
pantalla = M.figuras_para_pantalla(Cursor(filas=filas))
check("a la pantalla no viaja la barra de ejemplo de aSa (es sólo del servidor)",
      all(not any(k.startswith("_") for k in f) for f in pantalla))
check("...pero sí el dibujo y los lados", all(f.get("eje") and f.get("lados") for f in pantalla))

print("A mano: la barra de ejemplo con los largos del usuario")
fig26 = por["26"]
largos = {l["nombre"]: 20 for l in fig26["lados"]}
lados = M.lados_a_mano(fig26, largos, {}, 12)
check("los lados en mm, en el orden de la figura", [(l["nombre"], l["largo"]) for l in lados]
      == [(l["nombre"], 200.0) for l in fig26["lados"]])
check("...con su giro", [l["angulo"] for l in lados] == [l["angulo"] for l in fig26["lados"]])
eje = M.eje_a_mano(fig26, lados, 12)
check("el soporte se dibuja en dos planos, sin aviso", eje["ok"] and eje["tridimensional"])
xml = M.xml_con_largos(EJ["26"]["legangle"], {"B": 200, "C": 200}, {})
check("el XML lleva los largos nuevos y no la caja ni el largo total del ejemplo",
      "<l>200</l>" in xml and "<mbr>" not in xml and "<lt>" not in xml)
sd = json.loads(M.shapedims_con_largos(EJ["9"]["shapedims"], {"B": 5000}, {"B": 3000}))
check("el arco toma el largo y el radio del usuario",
      any(d.get("LegName") == "B" and d["MMLength"] == 5000 for d in sd)
      and any((d.get("ElemType") == "WR" or d.get("LegName") == "R") and d["MMLength"] == 3000 for d in sd))
lados9 = M.lados_a_mano(por["9"], {"B": 500}, {"B": 300}, 25)
check("arco a mano: el radio queda en el lado", lados9[0]["radio"] == 3000.0 and lados9[0]["arco"])
try:
    M.lados_a_mano(por["9"], {"B": 500}, {}, 25)
    check("arco sin radio: no", False)
except M.ErrorMaterial as e:
    check("arco sin radio: no, y dice cuál falta", "R de B" in str(e))
try:
    M.lados_a_mano(fig26, {"B": 20}, {}, 12)
    check("falta un lado: no", False)
except M.ErrorMaterial as e:
    check("falta un lado: no, y dice cuál", "Falta la medida del lado" in str(e))
check("la coma decimal se entiende", M.lados_a_mano(figs[0], {"A": "12,5"}, {}, 12)[0]["largo"] == 125.0)
lt1 = M.lados_a_mano(por["T1"], {l["nombre"]: 10 for l in por["T1"]["lados"]}, {}, 12)
check("los ganchos del estribo los decide la misma regla de la revisión", [l["gancho"] for l in lt1][0] and lt1[-1]["gancho"])

print("Previa")
p = M.previa(Cursor(filas=filas), {"figura": None, "lados": {"A": 600}, "diam": 16})
check("recta de 6 m φ16: 6.000 mm y su peso", p["largo_mm"] == 6000.0 and abs(p["kg_unit"] - 9.47) < 0.01)

print("Desde aSa")
item = {"OrderItemKey": 1625307, "CtrlCode": "ST47", "JobName": "DLP - EDIFICIO TALCA 2 SUR",
        "CustomerName": "EMPRESA CONSTRUCTORA DLP SA", "OrderDescr": "ELEV. 13° PISO",
        "ElementDesc": "EJE 12/N1 al J PL-305 Rev-0", "BarMark": "10mmA1433", "Notes": "SECCION 12-K",
        "BarSizeDescr": "10mm", "GradeID": "A630-420H", "ShpNameID": "T1",
        "LegAngle": EJ["T1"]["legangle"], "ShapeDims": EJ["T1"]["shapedims"], "PinDiam": 40.0,
        "LengthTheor": 2540.0, "TotalQty": 52.0, "LineWeight": 82.3082936}
f = M.fila_desde_asa(item, "devolucion", 20, {"ok": True})
check("trae la identidad del ítem", (f["cc"], f["item_key"], f["marca"], f["obra"]) ==
      ("ST47", 1625307, "10mmA1433", "DLP - EDIFICIO TALCA 2 SUR"))
check("el grado queda con el código de aSa, tal cual", f["grado"] == "A630-420H")
check("el peso de UNA barra", abs(f["kg_unit"] - 82.3082936 / 52) < 0.001)
check("los lados con la MISMA forma que los de a mano",
      set(f["lados"][0]) == set(lados[0]) == {"nombre", "largo", "tipo", "angulo", "arco", "radio", "gancho"})
try:
    M.fila_desde_asa(item, "", 20, {})
    check("sin motivo: no", False)
except M.ErrorMaterial:
    check("sin motivo: no", True)
try:
    M.fila_desde_asa(item, "inventario", 20, {})
    check("«inventario» es sólo de lo ingresado a mano", False)
except M.ErrorMaterial:
    check("«inventario» es sólo de lo ingresado a mano", True)
try:
    M.fila_desde_asa(item, "devolucion", 53, {})
    check("más que las 52 del ítem: no", False)
except M.ErrorMaterial:
    check("más que las 52 del ítem: no", True)

print("Pantalla")
fila = {"id": 1, "lados": f["lados"], "kg_unit": 1.583, "cant_disponible": 20, "diam_mm": 10, "largo_mm": 2540,
        "motivo": "devolucion", "grado": "A630-420HS", "creado_el": None, "editado_el": None}
fp = M.fila_para_pantalla(fila)
check("los lados como letra → mm para la grilla, y los giros", fp["dims"]["A"] > 0 and len(fp["angulos"]) == 5)
check("kilos disponibles = peso de una por las disponibles", fp["kg_disponible"] == round(1.583 * 20, 1))
check("motivo y grado con su nombre", fp["motivo_txt"] == "Devolución" and fp["grado_txt"] == "Soldable")

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
