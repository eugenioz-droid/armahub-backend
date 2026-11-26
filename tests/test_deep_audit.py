# -*- coding: utf-8 -*-
"""DEEP AUDIT (26-nov, SPECS §16) — el motor y su Excel, con casos reales de PL - EDIFICIO OPERA.

Lo que se congela:
  · el nombre: el estándar «SECTOR PISO CICLO» (export.py) y lo que se reporta de lo demás; la
    letra de ciclo la define el cliente (Z en OPERA) y se reporta usar dos letras en la obra;
  · las marcas: el modelo de A Detailer y su orden dentro de cada elemento (MH … CB en muros);
  · duplicados y doble pedido; Open estancado; peso fuera de rango; reprocesos;
  · el Excel: el mapa con un CC por celda, su color y el enlace a sus hallazgos.

Correr con: python tests/test_deep_audit.py
"""
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


from armahub import deep_audit as D  # noqa: E402
from armahub import deep_audit_excel as X  # noqa: E402

print("El nombre del CC")
n = D.leer_nombre("ELEV P1 C1")
check("el estándar no tiene problemas", (n["sector"], n["piso"], n["ciclo"], n["problemas"]) == ("ELEV", "P1", "C1", []))
check("LC → LCIELO, y se reporta", D.leer_nombre("LC S1 Z1")["sector"] == "LCIELO"
      and "sector «LC» (debe ser LCIELO)" in D.leer_nombre("LC S1 Z1")["problemas"])
n = D.leer_nombre("ELEV Z1 P2")
check("la P es el piso aunque vaya después (usuario, 26-nov), y el orden se reporta",
      (n["piso"], n["ciclo"]) == ("P2", "Z1") and "el ciclo va antes que el piso" in n["problemas"])
n = D.leer_nombre("ELEV Z1 S1 P4")
check("con dos pisos manda el de la torre, y se reporta", n["piso"] == "P4" and "dos pisos: S1 y P4" in n["problemas"])
check("«PISO 1» se lee como P1", D.leer_nombre("ELEVACIONES PISO 1 Z1")["piso"] == "P1")
check("minúsculas", "minúsculas" in D.leer_nombre("Elev p1 c1")["problemas"])
check("agregados y punto final", D.leer_nombre("ELEV Z2 P1.")["problemas"][-1] == "termina en punto"
      and "agregados: (1°)" in D.leer_nombre("ELEV S1 C1 (1°)")["problemas"])
check("una fundación no necesita piso", "sin piso" not in D.leer_nombre("FUND Z3")["problemas"])


def cc(codigo, descr, estado="Open", kg=1000.0, fecha="2026-11-01", cub="nlopez", envio=None):
    return D.ficha_cc({"cc": codigo, "descr": descr, "estado": estado, "kg": kg, "fecha": fecha, "cubicador": cub,
                       "envio": envio, "job": "2013218"}, date(2026, 11, 26))


ccs = [cc("SUQC", "FUND C1"), cc("SVAM", "FUND Z3"), cc("SVX2", "FUND Z4"), cc("SU49", "FUND Z2")]
n1 = D.regla_n1(ccs)
check("la letra del cliente (Z) vale; C1 en una obra de Z se reporta con la recomendación",
      len(n1) == 1 and n1[0]["cc"] == "SUQC" and "mantener una sola nomenclatura" in n1[0]["titulo"])

print("Las marcas")
check("el modelo de A Detailer", [D.clasificar_marca(m) for m in ("MH", "cb", "CB A", "FI", "", "F'", "TM")]
      == ["ok", "mayusculas", "fuera", "mayusculas", "vacia", "ok", "fuera"])
its = [{"LineNum": 1, "ElementID": "13-B", "Notes": "TC"}, {"LineNum": 2, "ElementID": "13-B", "Notes": "EC"},
       {"LineNum": 1, "ElementID": "13-O", "Notes": "MH"}, {"LineNum": 2, "ElementID": "13-O", "Notes": "MV"}]
check("el orden dentro de cada elemento: MH, MV, TR, EC, TC, CB (usuario, 26-nov)",
      D.desordenes(its, "ELEV") == [("13-B", "TC antes que EC")])
n2 = D.regla_n2([cc("SVIP", "ELEV P1 Z1")], {"SVIP": its + [{"LineNum": 3, "ElementID": "13-O", "Notes": "cb"}]})
check("un hallazgo por CC, con lo fuera de modelo, lo mal escrito y el orden",
      len(n2) == 1 and "mal escritas: cb (es CB)" in n2[0]["titulo"] and "orden: 1 elemento(s)" in n2[0]["titulo"])

print("Duplicados y doble pedido")
b1 = {"BarSizeDescr": "12mm", "ShpNameID": None, "LegAngle": "<la>1</la>", "TotalQty": 10, "ElementID": "E1",
      "Notes": "MH", "LineWeight": 50.0, "BarMark": "12mmA1"}
b2 = dict(b1, LegAngle="<la>2</la>", Notes="MV", BarMark="12mmA2")
a, b, c = cc("SUQC", "FUND C1", fecha="2026-09-23"), cc("SUXD", "FUND C1 1", fecha="2026-10-06"), cc("SVAM", "FUND Z3")
d1 = D.regla_d1([a, b, c], {"SUQC": [b1, b2], "SUXD": [dict(b2, BarMark="x"), dict(b1, BarMark="y")], "SVAM": [b1]})
check("mismo contenido barra a barra (aunque cambie la marca de aSa): el más nuevo", len(d1) == 1 and d1[0]["cc"] == "SUXD"
      and d1[0]["detalle"]["igual_a"] == "SUQC")
x, y = cc("SU3T", "ELEV Z2 P1", fecha="2026-10-13"), cc("SU5L", "ELEV Z2 P1.", fecha="2026-10-15")
d2 = D.regla_d2([x, y], {"SU3T": [b1, b2], "SU5L": [b1]}, set())
check("la misma barra del mismo elemento en otro CC del mismo sector: doble pedido (el caso real SU3T/SU5L)",
      len(d2) == 1 and d2[0]["cc"] == "SU5L" and d2[0]["detalle"]["ya_en"] == "SU3T" and d2[0]["kg"] == 50.0)
check("...y si ya se reportó como duplicado, no se repite", D.regla_d2([x, y], {"SU3T": [b1], "SU5L": [b1]}, {"SU5L"}) == [])

print("Estancados, peso, reprocesos")
e1 = D.regla_e1([cc("SUWP", "ELEV S1 C1", fecha="2026-10-04"), cc("SVXV", "ELEV P2 Z1", fecha="2026-11-20")],
                date(2026, 11, 26))
check("Open hace más de 30 días", len(e1) == 1 and e1[0]["detalle"]["dias"] == 53)
k = D.regla_k1([cc("A", "ELEV S1 Z1", kg=8000), cc("B", "ELEV S1 Z2", kg=7900), cc("C", "ELEV S1 Z3", kg=7500),
                cc("E", "ELEV S1 Z4", kg=700)])
check("un ciclo muy chico contra la mediana del piso", len(k) == 1 and k[0]["detalle"]["ciclo"] == "Z4")
check("con menos de 3 ciclos no se compara", D.regla_k1([cc("A", "ELEV S1 Z1", kg=8000), cc("E", "ELEV S1 Z4", kg=7)]) == [])
r = cc("SVN9", "REP CB", kg=90)
check("reprocesos y adicionales aparte, y no cuentan como nombre fuera de norma",
      r["tipo"] == "reproceso" and len(D.regla_r1([r])) == 1 and D.regla_n1([r]) == [])
check("Shipped en las últimas 3 semanas", cc("Z", "ELEV P1 Z1", "Shipped", envio="2026-11-10")["reciente"]
      and not cc("Z", "ELEV P1 Z1", "Shipped", envio="2026-10-10")["reciente"])

print("Indicadores")
hs = n1 + [D._h("N2", "media", "SUQC", "x")]
kp = D.kpis(ccs + [r], hs)
check("kilos, reprocesos y prolijidad por cubicador",
      kp["kg_total"] == 4090 and kp["kg_reprocesos"] == 90 and kp["cubicadores"]["nlopez"]["nombre"] == 1
      and kp["cubicadores"]["nlopez"]["marcas"] == 1 and kp["ccs_con_hallazgos"] == 1)

print("El Excel")
check("la torre arriba, la fundación al fondo", sorted(["S1", "P1", "Fundación", "P2"], key=X.orden_piso)
      == ["P2", "P1", "S1", "Fundación"])
check("C1 antes que Z1", sorted(["Z2", "C1", "Z1"], key=X.orden_ciclo) == ["C1", "Z1", "Z2"])
corrida = {"id": 1, "obra": "PL - EDIFICIO OPERA", "ccs": ccs + [r], "hallazgos": hs, "kpis": kp,
           "items": {"SUQC": [b1]}}
wb = X.libro(corrida)
check("las cinco hojas, en orden", wb.sheetnames == ["Mapa", "Hallazgos", "CC", "Barras", "Cubicadores"])
celdas = [c for fila in wb["Mapa"].iter_rows() for c in fila if isinstance(c.value, str) and c.value.startswith("SUQC")]
check("un CC por celda, con su color de estado y el enlace a sus hallazgos",
      len(celdas) == 1 and celdas[0].hyperlink is not None and "Hallazgos" in celdas[0].hyperlink.location
      and celdas[0].fill.start_color.rgb.endswith(X.COLOR_ESTADO["Open"]) and "⚠2" in celdas[0].value)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
