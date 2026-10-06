"""RECONSTRUIR LA FIGURA DE UNA BARRA DE aSa como POLICURVA (2-oct; policurva 6-oct).

Lo que se congela acá es la geometría, con casos REALES copiados de aSa. Importa porque el
dibujo va dentro de una auditoría: una figura mal construida haría que el auditor diera
por buena una barra mala. Por eso la función se COMPRUEBA sola contra la envolvente que
declara aSa, y lo que no cuadra se dibuja con aviso.

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


def tipos(r):
    return [t["tipo"] for t in r["tramos"]]


def lados(r):
    return [t["lado"] for t in r["tramos"] if t["tipo"] == "recto"]


print("TEST: reconstruir la figura de una barra de aSa")

# ── Caso 1: barra RECTA. aSa no manda ShapeDims; la geometría está en el XML ──
RECTA = ("<la><st>LN</st><bc>1</bc><mbr><X>3500</X><Y>0</Y><Z>0</Z></mbr><lt>0</lt>"
         "<v>4.0</v><cp><t>STD</t><l>3500</l><n>1</n></cp></la>")
print("\n1. Barra recta (sin ShapeDims)")
r = figura_de(None, RECTA)
check("se construye desde el XML: un tramo recto", r["ok"] and len(r["puntos"]) == 2 and tipos(r) == ["recto"])
check("...mide lo que dice aSa y su único lado se llama A", r["ancho"] == 3500 and r["alto"] == 0 and lados(r) == ["A"])

# ── Caso 2: barra doblada de 3 lados (gancho de 90° · recto · gancho de 90°) ──
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
print("\n2. Barra de tres lados con ganchos de 90°")
r = figura_de(DIMS3, TRES, pin_diam=48.0, diam_mm=12.0)
check("la dirección de cada lado sale del vector; los dobleces de 90° son vértices (el motor les pone el codo)",
      tipos(r) == ["recto", "recto", "recto"] and r["ancho"] == 11400 and r["alto"] == 300)
check("...cuadra con la envolvente que declara aSa", r["ok"])
check("...los lados conservan su nombre, su largo y si son gancho",
      lados(r) == ["A", "B", "C"] and r["tramos"][0]["gancho"] and not r["tramos"][1]["gancho"]
      and r["tramos"][1]["largo"] == 11400)
check("...y la figura queda con el lado largo horizontal y los ganchos hacia arriba",
      r["puntos"][1][1] == r["puntos"][2][1] and r["puntos"][0][1] > r["puntos"][1][1] and r["puntos"][3][1] > r["puntos"][2][1])

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
check("es UN tramo en arco, con su radio, entre dos puntos (el motor lo dibuja con el comando A)",
      tipos(r) == ["arco"] and r["tramos"][0]["radio"] == 12200 and len(r["puntos"]) == 2 and r["radio"] == 12200)
check("...la cuerda da 9.722 contra los 9.708 que declara aSa", abs(r["ancho"] - 9708) < 9708 * TOLERANCIA)
check("...y la flecha 1.011 contra 1.007", abs(r["alto"] - 1007) < 1007 * TOLERANCIA)
check("...así que cuadra", r["ok"])

# ── Caso 4: lo que no cuadra se avisa; lo que no se puede construir, no se inventa ──
print("\n4. Lo que no cuadra con aSa se avisa")
MENTIRA = TRES.replace("<X>11400</X>", "<X>5000</X>")
r = figura_de(DIMS3, MENTIRA, pin_diam=48.0, diam_mm=12.0)
check("si lo construido no mide lo que dice aSa, viene ok=False con el porqué (la pantalla dibuja y avisa)",
      not r["ok"] and "no cuadra" in r["motivo"] and len(r["puntos"]) == 4)
r = figura_de(None, None)
check("sin datos no se inventa nada", not r["ok"] and r["puntos"] == [])
GIRADA = TRES.replace("<X>11400</X><Y>300</Y>", "<X>300</X><Y>11400</Y>")
check("la envolvente se compara sin importar cuál eje es cuál: aSa gira algunas figuras",
      figura_de(DIMS3, GIRADA, pin_diam=48.0, diam_mm=12.0)["ok"])

print("\n5. Lo auxiliar no es geometría")
DIMS_MIX = json.dumps([
    {"MMLength": 120.0, "LegNum": 1, "LegName": "A", "ElemType": "SB", "SlopingVector": "-133,133,0"},
    {"MMLength": 45.0, "LegNum": 9, "LegName": "V", "ElemType": "AN", "SlopingVector": "0,0,0"},
    {"MMLength": 1080.0, "LegNum": 2, "LegName": "B", "ElemType": "B", "SlopingVector": "501,0,0"},
    {"MMLength": 124.8, "LegName": "H", "ElemType": "WS", "SlopingVector": "0,0,0"},
])
r = figura_de(DIMS_MIX, None)
check("los ángulos (AN) y las cotas (WS) no son lados: se ignoran (y sin XML manda el orden de ShapeDims)",
      lados(r) == ["A", "B"])

print("\n6. La envolvente declarada se lee del XML")
check("se saca el mbr", envolvente_declarada(TRES) == (11400.0, 300.0))
check("...y si no viene, no se inventa", envolvente_declarada("<la></la>") is None)

# ── Caso 7: la traba T12 REAL de aSa (SUP4 · 12mmA27): ganchos de 135° en los dos extremos ──
T12 = ("<la><st>T</st><bc>6</bc><mbr><X>898</X><Y>114</Y><Z>0</Z></mbr><lt>1160</lt><v>4.0</v>"
       "<cp><t>H3</t><l>130</l><n>1</n><ln>A</ln></cp><cp><t>STD</t><a>135</a><l>900</l><n>2</n><ln>B</ln></cp>"
       "<cp><t>H3</t><a>135</a><l>130</l><n>3</n><ln>G</ln></cp></la>")
DIMS_T12 = json.dumps([
    {"MMLength": 130.0, "LegNum": 1, "LegName": "A", "ElemType": "H3", "IsHook": True, "SlopingVector": "-16,-17,0"},
    {"MMLength": 900.0, "LegNum": 2, "LegName": "B", "ElemType": "B", "SlopingVector": "132,0,0"},
    {"MMLength": 130.0, "LegNum": 3, "LegName": "G", "ElemType": "H3", "IsHook": True, "SlopingVector": "16,-17,0"},
])
print("\n7. El gancho sísmico (135°): el vector final viene al revés, y el doblez es un ARCO propio")
r = figura_de(DIMS_T12, T12, pin_diam=48.0, diam_mm=12.0)
check("gancho · arco · barra · arco · gancho", tipos(r) == ["recto", "arco", "recto", "arco", "recto"])
check("...el arco es el de norma: mandril/2 + φ/2 = 30 mm, en los dos ganchos",
      r["tramos"][1]["radio"] == 30 and r["tramos"][3]["radio"] == 30)
p = r["puntos"]
check("...las dos puntas quedan al MISMO lado de la barra y por encima de ella (una traba, no una Z)",
      abs(p[0][1] - p[-1][1]) < 1 and p[0][1] > p[2][1] and p[2][1] == p[3][1])
check("...y cuadra con aSa dentro de lo que mueve el doblez", r["ok"])
r90 = figura_de(DIMS3, TRES, pin_diam=48.0, diam_mm=12.0)
check("el gancho de 90° (H9) NO se da vuelta ni se vuelve arco: sigue midiendo 11400 × 300",
      r90["ok"] and r90["alto"] == 300 and tipos(r90) == ["recto"] * 3)

# ── Caso 8: gancho de 180° — el arco deja la pata paralela a dos radios, no plegada encima ──
U180 = ("<la><st>B</st><bc>3</bc><mbr><X>900</X><Y>70</Y><Z>0</Z></mbr><lt>1060</lt>"
        "<cp><t>H18</t><l>100</l><n>1</n><ln>A</ln></cp>"
        "<cp><t>STD</t><a>180</a><l>860</l><n>2</n><ln>B</ln></cp>"
        "<cp><t>H18</t><a>180</a><l>100</l><n>3</n><ln>G</ln></cp></la>")
DIMS180 = json.dumps([
    {"MMLength": 100.0, "LegNum": 1, "LegName": "A", "ElemType": "H18", "IsHook": True, "SlopingVector": "-50,0,0"},
    {"MMLength": 860.0, "LegNum": 2, "LegName": "B", "ElemType": "B", "SlopingVector": "500,0,0"},
    {"MMLength": 100.0, "LegNum": 3, "LegName": "G", "ElemType": "H18", "IsHook": True, "SlopingVector": "-50,0,0"},
])
print("\n8. El gancho de 180°")
r = figura_de(DIMS180, U180, pin_diam=60.0, diam_mm=10.0)
check("gancho · arco · barra · arco · gancho, con el arco de radio 35", tipos(r) == ["recto", "arco", "recto", "arco", "recto"]
      and r["tramos"][1]["radio"] == 35)
p = r["puntos"]
check("la pata vuelve PARALELA a la barra, a dos radios (70 mm), no plegada encima",
      abs(abs(p[0][1] - p[2][1]) - 70) < 0.5 and abs(abs(p[-1][1] - p[3][1]) - 70) < 0.5 and p[2][1] == p[3][1])
check("...y la figura mide lo que una barra con ganchos de 180° mide", r["ok"] and r["alto"] == 70)

# ── Caso 9: la traba TP (forma 26): dos lados SIN vector; la dirección sale del ángulo ──
TP = ("<la><st>TP</st><bc>10</bc><mbr><X>0</X><Y>0</Y><Z>0</Z></mbr><lt>1190</lt><v>3.0</v>"
      "<cp><t>STD</t><l>300</l><n>1</n><ln>B</ln></cp><cp><t>STD</t><a>90</a><l>170</l><n>2</n><ln>C</ln></cp>"
      "<cp><t>STD</t><a>-90</a><l>250</l><n>3</n><ln>D</ln></cp><cp><t>STD</t><a>-90</a><l>170</l><n>4</n><ln>E</ln></cp>"
      "<cp><t>STD</t><a>90</a><l>300</l><n>5</n><ln>F</ln></cp></la>")
DIMS_TP = json.dumps([
    {"MMLength": 300.0, "LegNum": 1, "LegName": "B", "ElemType": "B", "SlopingVector": "0,0,0"},
    {"MMLength": 170.0, "LegNum": 2, "LegName": "C", "ElemType": "B", "SlopingVector": "0,66,0"},
    {"MMLength": 250.0, "LegNum": 3, "LegName": "D", "ElemType": "B", "SlopingVector": "96,0,0"},
    {"MMLength": 170.0, "LegNum": 4, "LegName": "E", "ElemType": "B", "SlopingVector": "0,-66,0"},
    {"MMLength": 300.0, "LegNum": 5, "LegName": "F", "ElemType": "B", "SlopingVector": "0,0,0"},
])
print("\n9. La traba TP sin vectores en los extremos (forma 26)")
r = figura_de(DIMS_TP, TP, pin_diam=60.0, diam_mm=10.0)
check("se construye igual: la dirección de B y F sale del ángulo con el vecino (+ = antihorario)",
      len(r["puntos"]) == 6 and lados(r) == ["B", "C", "D", "E", "F"])
p = r["puntos"]
check("...B y F son colineales con D (una «Ω» achatada: sube, cruza, baja), ancho 850 y alto 170",
      r["ancho"] == 850 and r["alto"] == 170 and abs(p[0][1] - p[-1][1]) < 0.5)
check("...y como aSa no declara envolvente para las TP, se dibuja sin comprobar y lo dice",
      r["ok"] and r["motivo"] == "sin envolvente para comprobar")

# ── Caso 10: una figura en 3D (vector con componente Z) se avisa ──
print("\n10. La figura tridimensional se dibuja en planta, pero se dice")
DIMS_3D = json.dumps([
    {"MMLength": 300.0, "LegNum": 1, "LegName": "A", "ElemType": "B", "SlopingVector": "100,0,0"},
    {"MMLength": 200.0, "LegNum": 2, "LegName": "B", "ElemType": "B", "SlopingVector": "0,0,80"},
    {"MMLength": 300.0, "LegNum": 3, "LegName": "C", "ElemType": "B", "SlopingVector": "-100,0,0"},
])
XML_3D = ("<la><st>TP</st><bc>3</bc><mbr><X>0</X><Y>0</Y><Z>0</Z></mbr><lt>800</lt>"
          "<cp><t>STD</t><l>300</l><n>1</n><ln>A</ln></cp><cp><t>STD</t><a>90</a><l>200</l><n>2</n><ln>B</ln></cp>"
          "<cp><t>STD</t><a>90</a><l>300</l><n>3</n><ln>C</ln></cp></la>")
r = figura_de(DIMS_3D, XML_3D, pin_diam=48.0, diam_mm=12.0)
check("se reconoce por la componente Z del vector", r["tridimensional"])
check("...se dibuja igual (su proyección) pero con aviso, no como si fuera plana",
      len(r["puntos"]) == 4 and not r["ok"] and "tridimensional" in r["motivo"])
check("y una figura plana no lleva ese aviso", not figura_de(DIMS_T12, T12, 48.0, 12.0)["tridimensional"])

# ── Caso 11: un arco de más de 180° (estribo circular) se parte para el motor ──
print("\n11. El estribo circular: un arco de 300° son dos pedazos de 150°")
CIRC = ("<la><st>R</st><bc>5</bc><mbr><X>0</X><Y>0</Y><Z>0</Z></mbr><lt>2618</lt>"
        "<cp><t>RB</t><l>2618</l><n>1</n><s>300</s><r>500</r><ln>A</ln></cp></la>")
DIMS_CIRC = json.dumps([
    {"MMLength": 2618.0, "XAngleInRads": 5.235987755982989, "LegNum": 1, "LegName": "A",
     "ElemType": "RB", "SlopingVector": "0,0,0", "IsRadial": True},
    {"MMLength": 500.0, "LegName": "R", "ElemType": "WR", "SlopingVector": "0,0,0"},
])
r = figura_de(DIMS_CIRC, CIRC)
check("dos tramos en arco del mismo radio, cada uno de a lo más 180°",
      tipos(r) == ["arco", "arco"] and all(t["radio"] == 500 for t in r["tramos"]) and len(r["puntos"]) == 3)
check("...el lado se rotula una sola vez", [t["lado"] for t in r["tramos"]] == ["A", ""])
check("...y la figura mide lo que un arco de 300° de radio 500 mide: 1.000 de ancho",
      abs(r["ancho"] - 1000) < 2)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
