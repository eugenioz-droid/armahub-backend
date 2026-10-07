# -*- coding: utf-8 -*-
"""LAS COTAS DE aSa, LEÍDAS DE SU PROPIO EXPORT (7-oct).

El RDX trae, por figura, no sólo el trazo del fierro sino las COTAS con que aSa la dibuja:
la altura, el ancho, el ángulo entre dos lados. Son la mitad de lo que se lee en una
figura, y el importador las descartaba por venir marcadas como «no fierro».

QUÉ SE CONGELA ACÁ. El modelo de una cota, que no es una interpretación nuestra sino lo
que dicen las 1.713 cotas del catálogo: la LÍNEA DE COTA va de `Stt` a `St2`, y los dos
vértices que mide son `End` y `En2`. Medido: `End` y `En2` caen sobre un vértice del trazo
en el 94 por ciento, y el largo de la línea coincide con lo que separa a esos vértices en
el 98. Si alguien invierte esos puntos, la cota pasa a medir cualquier cosa y nadie lo
nota mirando una miniatura — por eso hay un test.

Correr con: python tests/test_rdx_cotas.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


from importar_rdx_figuras import cotas_de, componentes_de, coordenadas_de  # noqa: E402

# LA 104E1 ENTERA, copiada del RDX. Cuatro lados de fierro (A, B, C, G) y tres anotaciones:
# la altura H y el ancho K —que miden la proyección del lado inclinado B— y el ángulo V en
# el vértice donde B se junta con C.
RDX_104E1 = """
<SHAPE_COMPONENTS>
  <SHAPE_COMPONENT><ElementType>SB</ElementType><LegName>B</LegName>
    <DrawingArcAngle>0</DrawingArcAngle><DrawingArcRadius>25</DrawingArcRadius></SHAPE_COMPONENT>
  <SHAPE_COMPONENT><ElementType>WS</ElementType><LegName>H</LegName>
    <DrawingArcAngle>0</DrawingArcAngle><DrawingArcRadius>25</DrawingArcRadius></SHAPE_COMPONENT>
  <SHAPE_COMPONENT><ElementType>WS</ElementType><LegName>K</LegName>
    <DrawingArcAngle>0</DrawingArcAngle><DrawingArcRadius>25</DrawingArcRadius></SHAPE_COMPONENT>
  <SHAPE_COMPONENT><ElementType>B</ElementType><LegName>C</LegName>
    <DrawingArcAngle>0</DrawingArcAngle><DrawingArcRadius>25</DrawingArcRadius></SHAPE_COMPONENT>
  <SHAPE_COMPONENT><ElementType>AN</ElementType><LegName>V</LegName>
    <DrawingArcAngle>0</DrawingArcAngle><DrawingArcRadius>25</DrawingArcRadius></SHAPE_COMPONENT>
  <SHAPE_COMPONENT><ElementType>H3</ElementType><LegName>A</LegName>
    <DrawingArcAngle>135</DrawingArcAngle><DrawingArcRadius>12</DrawingArcRadius></SHAPE_COMPONENT>
  <SHAPE_COMPONENT><ElementType>H3</ElementType><LegName>G</LegName>
    <DrawingArcAngle>135</DrawingArcAngle><DrawingArcRadius>12</DrawingArcRadius></SHAPE_COMPONENT>
</SHAPE_COMPONENTS>
<SHAPE_COORDINATES>
  <SHAPE_COORDINATE><LegName>B</LegName><CoordinateType>Dim</CoordinateType><X>-293</X><Y>-47</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>B</LegName><CoordinateType>Stt</CoordinateType><X>-217</X><Y>47</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>B</LegName><CoordinateType>End</CoordinateType><X>-150</X><Y>-64</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>H</LegName><CoordinateType>Dim</CoordinateType><X>-178</X><Y>265</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>H</LegName><CoordinateType>Stt</CoordinateType><X>-120</X><Y>-64</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>H</LegName><CoordinateType>End</CoordinateType><X>-150</X><Y>-64</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>H</LegName><CoordinateType>St2</CoordinateType><X>-120</X><Y>47</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>H</LegName><CoordinateType>En2</CoordinateType><X>-217</X><Y>47</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>K</LegName><CoordinateType>Dim</CoordinateType><X>-205</X><Y>246</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>K</LegName><CoordinateType>Stt</CoordinateType><X>-217</X><Y>17</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>K</LegName><CoordinateType>End</CoordinateType><X>-217</X><Y>47</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>K</LegName><CoordinateType>St2</CoordinateType><X>-150</X><Y>17</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>K</LegName><CoordinateType>En2</CoordinateType><X>-150</X><Y>-64</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>C</LegName><CoordinateType>Stt</CoordinateType><X>-150</X><Y>-64</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>C</LegName><CoordinateType>End</CoordinateType><X>209</X><Y>-64</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>V</LegName><CoordinateType>Cen</CoordinateType><X>-150</X><Y>-64</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>V</LegName><CoordinateType>Dim</CoordinateType><X>-146</X><Y>-52</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>A</LegName><CoordinateType>Stt</CoordinateType><X>-217</X><Y>47</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>A</LegName><CoordinateType>End</CoordinateType><X>-204</X><Y>64</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>G</LegName><CoordinateType>Stt</CoordinateType><X>209</X><Y>-64</Y><Z>0</Z></SHAPE_COORDINATE>
  <SHAPE_COORDINATE><LegName>G</LegName><CoordinateType>End</CoordinateType><X>217</X><Y>-44</Y><Z>0</Z></SHAPE_COORDINATE>
</SHAPE_COORDINATES>
"""

print("TEST: las cotas del RDX de aSa")

comps = componentes_de(RDX_104E1)
coords = coordenadas_de(RDX_104E1)
cotas = cotas_de(comps, coords)
por_nombre = {c["nombre"]: c for c in cotas}

print("\n1. Sólo las anotaciones; el fierro no es cota")
check("salen las tres anotaciones y ningún lado de fierro",
      sorted(por_nombre) == ["H", "K", "V"])

print("\n2. La cota mide entre dos vértices, y lo dice")
h = por_nombre.get("H") or {}
# La altura: una línea VERTICAL a la izquierda de la figura, de 111 de alto, que es
# exactamente lo que sube el lado inclinado B (de y=-64 a y=47).
check("la línea de cota va de Stt a St2, no de Stt a End",
      h.get("linea") == [[-120.0, -64.0], [-120.0, 47.0]])
check("...y mide lo que separa a los dos vértices (111, lo que sube el lado B)",
      abs(h["linea"][1][1] - h["linea"][0][1]) == 111.0)
check("las patitas van del vértice a la línea, una por punta",
      h.get("ref") == [[[-150.0, -64.0], [-120.0, -64.0]],
                       [[-217.0, 47.0], [-120.0, 47.0]]])
k = por_nombre.get("K") or {}
check("el ancho es la otra, horizontal, de 67",
      k.get("linea") == [[-217.0, 17.0], [-150.0, 17.0]]
      and abs(k["linea"][1][0] - k["linea"][0][0]) == 67.0)

# EL PUNTO `Dim` DE aSa NO SIRVE PARA LA COTA. Acá lo manda a y=265 y y=246, cuando la
# figura entera llega a y=64: allá las apila en una lista aparte del dibujo. Usarlo haría
# que el texto saliera volando y, peor, que el encuadre se achicara para darle lugar.
print("\n3. El texto va al medio de su línea, no donde aSa lo apila")
check("la altura se rotula en el medio de su propia línea",
      h.get("texto") == [-120.0, -8.5])
check("...y no en el Dim que manda aSa, que está fuera del dibujo",
      h["texto"][1] != 265.0 and k["texto"][1] != 246.0)

print("\n4. El ángulo sólo trae el vértice")
v = por_nombre.get("V") or {}
check("el ángulo marca el vértice donde se juntan los dos lados",
      v.get("centro") == [-150.0, -64.0] and v.get("tipo") == "AN")
check("...y su texto sí va donde aSa lo puso, que ahí está bien",
      v.get("texto") == [-146.0, -52.0])
check("...sin línea: aSa no da el arco, así que no se inventa", "linea" not in v)

print("\n5. Una figura sin anotaciones no inventa cotas")
RECTA = ("<SHAPE_COMPONENTS><SHAPE_COMPONENT><ElementType>B</ElementType><LegName>A</LegName>"
         "<DrawingArcAngle>0</DrawingArcAngle><DrawingArcRadius>25</DrawingArcRadius>"
         "</SHAPE_COMPONENT></SHAPE_COMPONENTS><SHAPE_COORDINATES>"
         "<SHAPE_COORDINATE><LegName>A</LegName><CoordinateType>Stt</CoordinateType>"
         "<X>-250</X><Y>0</Y><Z>0</Z></SHAPE_COORDINATE>"
         "<SHAPE_COORDINATE><LegName>A</LegName><CoordinateType>End</CoordinateType>"
         "<X>250</X><Y>0</Y><Z>0</Z></SHAPE_COORDINATE></SHAPE_COORDINATES>")
check("la 101A es una barra recta y punto",
      cotas_de(componentes_de(RECTA), coordenadas_de(RECTA)) == [])

# LAS QUE NO DIBUJAN NADA SE DESCARTAN. `WN` trae Stt igual a End: una cota de largo cero
# saldría como un punto suelto con una letra al lado, que se lee como un error de la figura.
print("\n6. Lo que no dibuja nada no se dibuja")
NULA = ("<SHAPE_COMPONENTS><SHAPE_COMPONENT><ElementType>WN</ElementType><LegName>H2</LegName>"
        "<DrawingArcAngle>0</DrawingArcAngle><DrawingArcRadius>0</DrawingArcRadius>"
        "</SHAPE_COMPONENT></SHAPE_COMPONENTS><SHAPE_COORDINATES>"
        "<SHAPE_COORDINATE><LegName>H2</LegName><CoordinateType>Stt</CoordinateType>"
        "<X>233</X><Y>-41</Y><Z>0</Z></SHAPE_COORDINATE>"
        "<SHAPE_COORDINATE><LegName>H2</LegName><CoordinateType>End</CoordinateType>"
        "<X>233</X><Y>-41</Y><Z>0</Z></SHAPE_COORDINATE>"
        "<SHAPE_COORDINATE><LegName>H2</LegName><CoordinateType>Dim</CoordinateType>"
        "<X>233</X><Y>-41</Y><Z>0</Z></SHAPE_COORDINATE></SHAPE_COORDINATES>")
check("una cota de largo cero no entra",
      cotas_de(componentes_de(NULA), coordenadas_de(NULA)) == [])

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
