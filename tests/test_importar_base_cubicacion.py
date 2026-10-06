"""LA BASE DEL 2022 SALE DE LA PLANILLA DE CALIDAD (6-oct).

aSa partió en 2022 y de ese año tiene 3.092 ton contra 29.931 reales: una tasa sobre ese
denominador sería diez veces la real. La planilla «Analisis Errores Acumulado al 2025»
trae lo cubicado por cubicador y obra, y es la base de ese año. Acá se congela lo que se
normaliza al leerla y que el tablero la usa para 2022 y sólo para 2022.

Correr con: python tests/test_importar_base_cubicacion.py
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
os.environ.setdefault("JWT_SECRET", "x-tests-no-vale-en-produccion-1234567890")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


import importar_base_cubicacion as I  # noqa: E402
from armahub import reclamos as R  # noqa: E402

print("TEST: la base de cubicación desde la planilla")

print("\n1. El cubicador queda con el nombre que usa el tablero")
check("«José Rodriguez» y «Jose Rodriguez» son el de aSa", I.normalizar_cubicador("José Rodriguez") == "Jose Rodriguez"
      and I.normalizar_cubicador("Jose Rodriguez") == "Jose Rodriguez")
check("«Rmc» es RMC", I.normalizar_cubicador("Rmc") == "RMC")
check("«Jose Pantoja» es como está en los reclamos (José Pantoja)", I.normalizar_cubicador("Jose Pantoja") == "José Pantoja")
check("los demás, mayúscula inicial", I.normalizar_cubicador("GERARDO MENDOZA") == "Gerardo Mendoza"
      and I.normalizar_cubicador("  carlos   santos ") == "Carlos Santos")

print("\n2. El segmento: de aSa si la obra calzó; si no, sólo Edificación se traduce")
check("con obra en aSa manda aSa", I.segmento_de("Otros", "1 y 2") == "1 y 2")
check("Edificación sin obra en aSa es 4 y 5", I.segmento_de("Edificación", None) == "4 y 5")
check("«Otros» sin obra en aSa queda vacío: allá significa «no edificación», no el segmento Otros",
      I.segmento_de("Otros", None) is None)
check("la obra se busca sin acentos ni puntuación", I.clave_obra("DESCO - Edif. Los Quillayes") == "DESCO EDIF LOS QUILLAYES")

print("\n3. Una fila de la hoja")
f = I.fila_de((2022.0, "Carlos Santos", "Externo", "DRAGADOS - EDIFICIO ARICA CITY CENTER", 1234567.0, "Edificación", "CUBICACION", 3, 500))
check("año, cubicador, servicio, obra y kilos", f["anio"] == 2022 and f["cubicador"] == "Carlos Santos" and f["servicio"] == "Externo"
      and f["obra"] == "DRAGADOS - EDIFICIO ARICA CITY CENTER" and f["kg"] == 1234567.0 and f["seg_planilla"] == "Edificación")
check("las filas de totales o vacías no son datos", I.fila_de(("Total general", None, None, None, 1, None)) is None
      and I.fila_de((2023, "Mario Puyo", "Externo", None, 10, "Otros")) is None)
filas, rep = I.consolidar([dict(f), dict(f, kg=999.0)])
check("una obra repetida se cuenta una vez, con el mayor kilaje (la fila es la obra, no un error)",
      len(filas) == 1 and filas[0]["kg"] == 1234567.0 and rep == 1)

print("\n4. El tablero usa la planilla para 2022 y sólo para 2022")
check("2022 es año de planilla y ya no está entre los sin base", R.ANIOS_BASE_PLANILLA == (2022,) and 2022 not in R.ANIOS_SIN_BASE_ASA
      and 2021 in R.ANIOS_SIN_BASE_ASA)
SRC = io.open(os.path.join(ROOT, "armahub", "reclamos.py"), encoding="utf-8").read()
check("...el endpoint saca esos años de aSa y los trae de la tabla, marcando la fuente",
      "FROM base_cubicacion_planilla" in SRC and '"fuente": "planilla"' in SRC and '"fuente": "asa"' in SRC)
check("la migración crea la tabla", os.path.exists(I.MIGRACION) and "CREATE TABLE IF NOT EXISTS base_cubicacion_planilla" in io.open(I.MIGRACION, encoding="utf-8").read())
JS = io.open(os.path.join(ROOT, "armahub", "static", "js", "features", "reclamos", "dashboards.js"), encoding="utf-8").read()
check("y en pantalla el año dice que su base es la planilla", "base: planilla" in JS)
check("...y hay una línea de trazabilidad con la fuente de cada año (aSa Studio / planilla / sin base)",
      "function inFuentes()" in JS and "Base de toneladas:" in JS
      and 'id="inFuentes"' in io.open(os.path.join(ROOT, "armahub", "templates", "tabs", "rec_dashboards.html"), encoding="utf-8").read())

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
