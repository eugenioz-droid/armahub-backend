# -*- coding: utf-8 -*-
"""MATERIAL DISPONIBLE › LA BÚSQUEDA (25-nov, SPECS §15.3) — fase 2.

Lo que se congela acá es CUÁNDO CALZA una barra disponible con un ítem por fabricar:
  · igual, o con corte de una punta RECTA; nunca se corta un gancho declarado (H3, H9…);
  · una pata corta que dobla 90° NO es gancho para reciclar (la pata del soporte 26 se corta):
    con la regla de la revisión, un 26 con una pata 5 cm más larga no calzaba (medido 25-nov);
  · la forma se compara por los lados, de cualquier punta y dada vuelta; plano o en dos
    planos cuenta (el 26 y la S4 tienen los mismos giros y no son lo mismo);
  · de una recta larga salen varias cortas.

Figuras REALES: el soporte 26 y el estribo T1 de asa_figuras (25-nov).

Correr con: python tests/test_material_busqueda.py
"""
import json
import os
import re
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


from armahub import material_busqueda as B  # noqa: E402

EJ = json.load(open(os.path.join(ROOT, "tests", "material_figuras_ejemplo.json"), encoding="utf-8"))


def con_largos(xml, largos):
    """El XML de aSa con otros largos, para armar ítems de prueba."""
    def cp(m):
        n = re.search(r"<ln>(.*?)</ln>", m.group(1)).group(1)
        return "<cp>" + (re.sub(r"<l>[-\d.]+</l>", "<l>%s</l>" % largos[n], m.group(1)) if n in largos else m.group(1)) + "</cp>"
    return re.sub(r"<cp>(.*?)</cp>", cp, xml, flags=re.S)


def recta(mm):
    return [{"nombre": "A", "largo": float(mm), "tipo": "STD", "angulo": None, "arco": False, "radio": None, "gancho": False}]


s26 = B.lados_de_item(EJ["26"]["legangle"])
t1 = B.lados_de_item(EJ["T1"]["legangle"])

print("Soporte 26")
check("igual a sí mismo", B.comparar(s26, s26) == {"tipo": "igual", "cortes": [], "piezas": 1})
check("una pata 5 cm más larga: calza con corte de esa pata",
      B.comparar(B.lados_de_item(con_largos(EJ["26"]["legangle"], {"B": 350})), s26)
      == {"tipo": "corte", "cortes": [["B", 50.0]], "piezas": 1})
check("una pata más CORTA que la pedida: no", B.comparar(B.lados_de_item(con_largos(EJ["26"]["legangle"], {"B": 250})), s26) is None)
check("un lado del medio distinto: no", B.comparar(B.lados_de_item(con_largos(EJ["26"]["legangle"], {"C": 800})), s26) is None)
check("el ítem leído desde la otra punta: igual", B.comparar(s26, B.orientaciones(s26)[1])["tipo"] == "igual")
volteado = [dict(l, angulo=(-l["angulo"] if l["angulo"] is not None else None)) for l in s26]
check("y dado vuelta (todos los giros al revés): igual", B.comparar(s26, volteado)["tipo"] == "igual")
check("la pata corta del 26 no es gancho para reciclar (sólo los que aSa declara)",
      all(B._clase(l) == "recto" for l in s26))

print("Estribo T1")
check("los ganchos del estribo son ganchos (H3)", [B._clase(l) for l in t1][0] == "gancho" and B._clase(t1[-1]) == "gancho")
t1_largo = B.lados_de_item(con_largos(EJ["T1"]["legangle"], {"G": 200}))
check("un gancho más largo que el pedido: no (un gancho no se corta)", B.comparar(t1_largo, t1) is None)
check("igual a sí mismo", B.comparar(t1, t1)["tipo"] == "igual")

print("Rectas")
check("6 m para 2,8 m: dos piezas y sobran 40 cm", B.comparar(recta(6000), recta(2800))
      == {"tipo": "corte", "piezas": 2, "cortes": [["A", 400.0]]})
check("6 m para 6 m: igual", B.comparar(recta(6000), recta(6003)) == {"tipo": "igual", "piezas": 1, "cortes": []})
check("6 m para 5,5 m: una pieza, se cortan 50 cm", B.comparar(recta(6000), recta(5500))
      == {"tipo": "corte", "piezas": 1, "cortes": [["A", 500.0]]})
check("2,8 m no da para 6 m", B.comparar(recta(2800), recta(6000)) is None)
check("una recta no calza con un soporte", B.comparar(recta(3000), s26) is None)

print("La forma")
check("igual de cualquier punta que se la lea", B.firma(s26) == B.firma(B.orientaciones(s26)[1]))
check("y dada vuelta", B.firma(s26) == B.firma(volteado))
check("distinta de la del estribo", B.firma(s26) != B.firma(t1))
figs = [{"codigo": "26", "lados": s26, "tridimensional": True}, {"codigo": "S4", "lados": s26, "tridimensional": False},
        {"codigo": None, "lados": recta(1000), "tridimensional": False},
        {"codigo": "101A", "lados": recta(1000), "tridimensional": False}]
check("los códigos con la misma forma, plana o en dos planos aparte (el 26 no trae la S4)",
      B.codigos_con_forma(figs, B.firma(s26), True) == {"26"} and B.codigos_con_forma(figs, B.firma(s26), False) == {"S4"})
check("la recta es None, junto con las figuras rectas de aSa", B.codigos_con_forma(figs, B.firma(recta(5)), False) == {None, "101A"})

print("Grupos y filtro de aSa")
barras = [{"id": 1, "item_key": None, "figura": None, "diam_mm": 16, "grado": "A630-420H", "lados": recta(6000),
           "largo_mm": 6000, "cant_disponible": 12, "tridimensional": False},
          {"id": 2, "item_key": None, "figura": "101A", "diam_mm": 16, "grado": "A630-420H", "lados": recta(12000),
           "largo_mm": 12000, "cant_disponible": 3, "tridimensional": False},
          {"id": 3, "item_key": None, "figura": "26", "diam_mm": 16, "grado": "A630-420H", "lados": s26,
           "largo_mm": 2600, "cant_disponible": 50, "tridimensional": True}]
g = B.grupos(barras, figs)
check("una consulta por φ, grado y forma: las dos rectas juntas, el soporte aparte", len(g) == 2
      and sorted(len(x["barras"]) for x in g.values()) == [1, 2])
grupo_rectas = [x for x in g.values() if len(x["barras"]) == 2][0]
check("el grupo pide hasta el largo de la barra más larga", grupo_rectas["largo"] == 12000)
f = B.filtro_de(16.0, "A630-420H", {None, "101A"}, 12000)
check("el filtro: vivos, φ16, grado, figuras (la recta como null) y largo",
      "OrderStatusDescr eq 'Open' or OrderStatusDescr eq 'Processed'" in f and "BarSizeDescr eq '16mm'" in f
      and "GradeID eq 'A630-420H'" in f and "ShpNameID eq null or ShpNameID eq '101A'" in f and "LengthTheor le 12005" in f)

print("Ítems de aSa")
fila = {"OrderItemKey": "1437118", "CtrlCode": "SSHY", "BarMark": "16mmA73", "BarSizeDescr": "16mm",
        "GradeID": "A630-420H", "ShpNameID": "None", "LengthTheor": "2000.0", "OrderStatusDescr": "Open",
        "JobName": "DLP - EDIFICIO TALCA 2 SUR", "CustomerName": "None", "OrderDescr": "LOSAS C-3° PISO",
        "ElementDesc": "LOSAS 307/310", "Cant": "3.0", "Kg": "9.5748",
        "LegAngle": "<la><st>LN</st><bc>1</bc><v>4.0</v><cp><t>STD</t><l>2000</l><n>1</n></cp></la>"}
it = B.item_de_fila(fila)
check("los nulos de aSa («None») quedan vacíos o None", it["figura"] is None and it["cliente"] == "")
check("números y lados", it["item_key"] == 1437118 and it["cant"] == 3.0 and it["lados"][0]["largo"] == 2000.0)

print("Coincidencias")
items = [dict(it, item_key=10, cant=3.0, kg=9.0), dict(it, item_key=11, cant=40.0, kg=120.0,
         lados=recta(6000)), dict(it, item_key=12, cant=5.0, kg=15.0, lados=recta(7000))]
c = B.coincidencias_de(barras[0], items)
check("primero las iguales, y la más larga (7 m) no calza", [x["item_key"] for x in c] == [11, 10])
check("cubre lo que alcanza: 12 barras para 40 pedidas", c[0]["cubre"] == 12 and c[0]["kg_ahorro"] == 36.0)
check("una barra de 6 m da 3 piezas de 2 m: cubre las 3 pedidas", c[1]["piezas"] == 3 and c[1]["cubre"] == 3.0)
check("la coincidencia lleva el ítem (CC, marca, obra, lados) para no volver a aSa",
      c[0]["cc"] == "SSHY" and c[0]["marca"] == "16mmA73" and c[0]["lados"] == recta(6000))
check("una barra no calza con su propio ítem de origen",
      B.coincidencias_de(dict(barras[0], item_key=11), items)[0]["item_key"] == 10)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
