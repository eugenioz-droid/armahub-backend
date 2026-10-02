"""RECONSTRUIR LA FIGURA DE UNA BARRA DE aSa (2-oct).

Lo que se congela acá es la geometría, con casos REALES copiados de aSa. Importa porque
el dibujo va dentro de una auditoría: una figura mal reconstruida haría que el auditor
diera por buena una barra mala. Por eso la función se COMPRUEBA sola contra la envolvente
que declara aSa, y lo que no cuadra no se dibuja.

Correr con: python tests/test_figura_asa.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


from armahub.figura_asa import figura_de, envolvente_declarada, TOLERANCIA  # noqa: E402

print("TEST: reconstruir la figura de una barra de aSa")

# ── Caso 1: barra RECTA. aSa no manda ShapeDims; la geometría está en el XML ──
RECTA = ("<la><st>LN</st><bc>1</bc><mbr><X>3500</X><Y>0</Y><Z>0</Z></mbr><lt>0</lt>"
         "<v>4.0</v><cp><t>STD</t><l>3500</l><n>1</n></cp></la>")
print("\n1. Barra recta (sin ShapeDims)")
r = figura_de(None, RECTA)
check("se reconstruye igual, desde el XML", r["ok"] and len(r["puntos"]) == 2)
check("...y mide lo que dice aSa", r["ancho"] == 3500 and r["alto"] == 0)

# ── Caso 2: barra doblada de 3 lados (gancho · recto · gancho) ──
TRES = ("<la><st>B</st><bc>3</bc><mbr><X>11400</X><Y>300</Y><Z>0</Z></mbr><lt>12000</lt>"
        "<cp><t>H9</t><l>300</l><n>1</n><ln>A</ln></cp>"
        "<cp><t>STD</t><a>90</a><l>11400</l><n>2</n><ln>B</ln></cp>"
        "<cp><t>H9</t><a>90</a><l>300</l><n>3</n><ln>C</ln></cp></la>")
DIMS3 = json.dumps([
    {"MMLength": 300.0, "LegNum": 1, "LegName": "A", "ElemType": "H9", "IsHook": True,
     "SlopingVector": "0,-50,0"},
    {"MMLength": 11400.0, "LegNum": 2, "LegName": "B", "ElemType": "B", "SlopingVector": "510,0,0"},
    {"MMLength": 300.0, "LegNum": 3, "LegName": "C", "ElemType": "H9", "IsHook": True,
     "SlopingVector": "0,50,0"},
])
print("\n2. Barra de tres lados")
r = figura_de(DIMS3, TRES)
check("la dirección de cada lado sale del vector, no de adivinar el ángulo",
      r["ancho"] == 11400 and r["alto"] == 300)
check("...cuadra con la envolvente que declara aSa y se puede dibujar", r["ok"])
check("...y se devuelven los lados con su nombre y si son gancho",
      [l["nombre"] for l in r["lados"]] == ["A", "B", "C"]
      and r["lados"][0]["gancho"] and not r["lados"][1]["gancho"])

# ── Caso 3: barra CURVA. Radio 12.200, arco 10.000 → 46,96° ──
CURVA = ("<la><st>R</st><bc>5</bc><mbr><X>9708</X><Y>1007</Y><Z>0</Z></mbr><lt>10000</lt>"
         "<cp><t>RB</t><l>10000</l><n>1</n><s>46.964</s><r>12200</r><ln>B</ln></cp></la>")
DIMSC = json.dumps([
    {"MMLength": 10000.0, "XAngleInRads": 0.819672131147541, "LegNum": 1, "LegName": "B",
     "ElemType": "RB", "SlopingVector": "0,0,0", "IsRadial": True},
    {"MMLength": 12200.0, "LegName": "R", "ElemType": "WR", "SlopingVector": "0,0,0"},
])
print("\n3. Barra curva (un arco)")
r = figura_de(DIMSC, CURVA)
check("se reconoce el arco y su radio", r["radio"] == 12200 and len(r["puntos"]) > 10)
check("...la cuerda da 9.722 contra los 9.708 que declara aSa", abs(r["ancho"] - 9708) < 9708 * TOLERANCIA)
check("...y la flecha 1.011 contra 1.007", abs(r["alto"] - 1007) < 1007 * TOLERANCIA)
check("...así que se puede dibujar", r["ok"])

# ── Caso 4: la comprobación tiene que RECHAZAR lo que no cuadra ──
print("\n4. Lo que no se puede comprobar NO se dibuja")
MENTIRA = TRES.replace("<X>11400</X>", "<X>5000</X>")
r = figura_de(DIMS3, MENTIRA)
check("si lo dibujado no mide lo que dice aSa, no se dibuja", not r["ok"] and "no cuadra" in r["motivo"])
r = figura_de(None, None)
check("sin datos tampoco se inventa nada", not r["ok"] and r["puntos"] == [])
r = figura_de(json.dumps([{"MMLength": 100.0, "LegNum": 1, "ElemType": "B", "SlopingVector": "0,0,0"}]), None)
check("un lado sin dirección se rechaza, no se asume horizontal", not r["ok"])

print("\n5. Lo auxiliar no es geometría")
DIMS_MIX = json.dumps([
    {"MMLength": 120.0, "LegNum": 1, "LegName": "A", "ElemType": "SB", "SlopingVector": "-133,133,0"},
    {"MMLength": 45.0, "LegNum": 9, "LegName": "V", "ElemType": "AN", "SlopingVector": "0,0,0"},
    {"MMLength": 1080.0, "LegNum": 2, "LegName": "B", "ElemType": "B", "SlopingVector": "501,0,0"},
    {"MMLength": 124.8, "LegName": "H", "ElemType": "WS", "SlopingVector": "0,0,0"},
])
r = figura_de(DIMS_MIX, None)
check("los ángulos (AN) y las cotas (WS) no son lados: se ignoran",
      [l["nombre"] for l in r["lados"]] == ["A", "B"])

print("\n6. La envolvente declarada se lee del XML")
check("se saca el mbr", envolvente_declarada(TRES) == (11400.0, 300.0))
check("...y si no viene, no se inventa", envolvente_declarada("<la></la>") is None)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
