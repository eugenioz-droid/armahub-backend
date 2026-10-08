# -*- coding: utf-8 -*-
"""RESUMEN MENSUAL DE aSa DATA (8-oct).

Lo que se congela acá es la HONESTIDAD DE LA COMPARACIÓN, que es lo único que un cuadro
así puede hacer mal sin que se note. Comparar un año en curso contra uno cerrado dice que
vamos peor cuando lo único que pasa es que el año no terminó; y meter el mes en curso es
el mismo error en chico: el 8 de octubre, octubre lleva 762.883 kg contra los 3.724.953
de octubre del año pasado, y eso no es una caída del 80 por ciento.

Correr con: python tests/test_mensual.py
"""
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


SRC = open(os.path.join(ROOT, "armahub", "programacion.py"), encoding="utf-8").read()
JS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "programacion", "mensual.js"),
          encoding="utf-8").read()
DSH = open(os.path.join(ROOT, "armahub", "static", "js", "features", "programacion", "dashboards.js"),
           encoding="utf-8").read()
HTM = open(os.path.join(ROOT, "armahub", "templates", "tabs", "asa_data.html"), encoding="utf-8").read()
APP = open(os.path.join(ROOT, "armahub", "templates", "app.html"), encoding="utf-8").read()

print("TEST: resumen mensual")

print("\n1. El cuadro existe y es un sub-tab más de aSa Data")
check("el botón y el panel están, al lado de los otros reportes",
      "asaSubTab('mens')" in HTM and 'id="asaPanelMens"' in HTM
      and "['mens',   'asaSubMens',   'asaPanelMens']" in DSH)
check("...el script se carga y el sub-tab lo llama",
      "programacion/mensual.js" in APP and "global.loadResumenMensual" in JS
      and "if (v === 'mens')" in DSH)
check("trae su propia data y su propio año: comparar años es mirar los doce meses",
      '@router.get("/programacion/asa/mensual")' in SRC and 'id="mensAnios"' in HTM
      and "no usa el período compartido" in DSH)

print("\n2. La comparación es honesta (lo único que esto puede hacer mal en silencio)")
check("se compara hasta el último mes CERRADO, no hasta hoy",
      "hasta = (hoy.month - 1) if anio == hoy.year else 12" in SRC)
check("...y queda escrito el porqué, con el número que lo muestra",
      "762.883 kg contra los 3.724.953" in SRC)
check("el mes en curso se dibuja igual, marcado, pero fuera del acumulado",
      '"en_curso": en_curso' in SRC and "mes en curso" in JS
      and "'#b3d4f0' : '#1565C0'" in JS)
check("el año anterior se corta en el mismo mes que el actual",
      "def suma(a, campo, tope)" in SRC and "suma(anio - 1," in SRC)

print("\n3. Las cuatro preguntas, y que ninguna repita a los otros cuadros")
check("kilos del año contra el anterior, en el MISMO gráfico",
      "function dosAnios(" in JS and "año anterior" in JS)
check("cuántas OBRAS hubo cubicándose: el tonelaje no lo dice",
      "COUNT(DISTINCT p.asa_job_id)" in SRC and "mensObrasChart" in JS)
check("...y las obras NO se suman entre meses: una obra de marzo y abril es una obra",
      "Las obras del mes NO se suman" in JS and "obrasProm" in JS
      and '"obras": 0, "obras_previo": 0' in SRC)
check("el tamaño del código, que es lo que no se ve en ningún otro cuadro",
      "mensTamChart" in JS and "m.actual.kg / m.actual.codigos" in JS)
check("la mezcla por segmento va en POR CIENTO, no en kilos",
      "min: 0, max: 100" in JS and "stacked: true" in JS
      and "un mes flojo baja todas las barras" in JS)
check("...pero el globo igual dice el tonelaje: un porcentaje solo no deja decidir",
      "t.raw.toFixed(1)" in JS and "ton(kg)" in JS
      and "El por ciento solo no sirve para nada" in JS)

print("\n4. Lo que no se esconde")
check("lo que no tiene segmento cargado se muestra: si no, los porcentajes no suman cien",
      'SIN_SEGMENTO = "(sin segmento)"' in SRC and "no sumarian cien" in SRC)
check("los colores del segmento son los MISMOS que en el cuadro por segmento",
      "'1 y 2': '#42a5f5'" in JS and "'4 y 5': '#8bc34a'" in JS and "'YPS': '#ffa726'" in JS)
check("se agrega en la base, no se manda el detalle para que el navegador sume",
      "GROUP BY 1, 2" in SRC and "SE AGREGA EN LA BASE" in SRC)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
