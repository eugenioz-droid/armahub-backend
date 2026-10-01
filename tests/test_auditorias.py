"""AUDITORÍAS DE CUBICACIÓN — maqueta (1-oct).

Lo que se congela: el tab existe en Calidad al lado de Reclamos; el backend sólo LEE
(maqueta); la muestra es reproducible por semilla y sale de la clave del elemento
constructivo (sector · piso · ciclo · eje); el vocabulario es el de la ISO.

Correr con: python tests/test_auditorias.py
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


from armahub import auditorias as A  # noqa: E402

SRC = open(os.path.join(ROOT, "armahub", "auditorias.py"), encoding="utf-8").read()
MAIN = open(os.path.join(ROOT, "armahub", "main.py"), encoding="utf-8").read()
APP = open(os.path.join(ROOT, "armahub", "templates", "app.html"), encoding="utf-8").read()
HTM = open(os.path.join(ROOT, "armahub", "templates", "tabs", "auditorias.html"), encoding="utf-8").read()
JS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "auditorias", "index.js"), encoding="utf-8").read()
SHELL = open(os.path.join(ROOT, "armahub", "static", "js", "app", "shell.js"), encoding="utf-8").read()

print("TEST: auditorías de cubicación (maqueta)")

print("\n1. El tab vive en Calidad, al lado de Reclamos")
check("el botón va justo después de Reclamos y con la misma clase de módulo",
      APP.index("switchTab('reclamos')") < APP.index("switchTab('auditorias')") < APP.index("switchTab('rec_dashboards')")
      and 'class="tab-btn mod-reclamos" onclick="switchTab(\'auditorias\')"' in APP)
check("la plantilla y el script están incluidos",
      "{% include 'tabs/auditorias.html' %}" in APP and "features/auditorias/index.js" in APP
      and 'id="tab-auditorias"' in HTM)
check("shell.js conoce el tab y su cargador",
      "auditorias: 'Auditorías'," in SHELL and "auditorias: 'loadAuditorias'," in SHELL
      and "global.loadAuditorias = async function" in JS)
check("el router está montado bajo /api/v1 (el front habla sólo por ahí)",
      "auditorias_router," in MAIN[MAIN.index("_api_routers = ["):MAIN.index("for r in _api_routers")]
      and "app.include_router(auditorias_router)" in MAIN)

print("\n2. Es MAQUETA: el backend sólo lee")
check("sólo GET, ningún INSERT/UPDATE/DELETE",
      SRC.count("@router.get(") == 4 and "@router.post" not in SRC and "@router.put" not in SRC
      and "INSERT" not in SRC.upper().replace("INSERTAR", "") and "UPDATE " not in SRC and "DELETE " not in SRC)
check("...y el front guarda las auditorías en el navegador, no en la base",
      "localStorage.setItem(CLAVE" in JS and "'audMaqueta'" in JS)

print("\n3. El elemento constructivo y la muestra")
check("el elemento es la clave sector · piso · ciclo · eje", A._CLAVE == "(sector, piso, ciclo, eje)")
check("el tipo sale de `sector`: elevación, losa, viga de cielo, fundación",
      A.SECTORES == {"ELEV": "Elevación", "LCIELO": "Losa", "VCIELO": "Viga de cielo", "FUND": "Fundación"})
check("la muestra es reproducible: orden por hash de la clave más la semilla",
      "ORDER BY md5(" in SRC and "|| %s)" in SRC and "secrets.token_hex" in SRC)
check("...acotada, y cada elemento dice quién lo cubicó (para la independencia)",
      "MUESTRA_MAXIMA = 200" in SRC and "STRING_AGG(DISTINCT COALESCE(creado_por, editado_por" in SRC
      and 'indep' in JS and "cubicados por quien audita" in JS)
check("el alcance filtra por sector, piso y ciclo, y sin nada marcado es todo",
      SRC.count("COALESCE({col},'') = ANY(%s)") == 1 and "_lista(valor)" in SRC)
check("los pisos y ciclos salen en orden natural (P1, P2, …, P12)",
      SRC.count("regexp_replace(COALESCE(") == 2)

print("\n4. El vocabulario es el de la ISO 19011 / 9001")
check("estados: planificada · en curso · cerrada", A.ESTADOS == ("planificada", "en_curso", "cerrada"))
check("hallazgos: conforme · observación · NC menor · NC mayor",
      A.HALLAZGOS == ("conforme", "observacion", "nc_menor", "nc_mayor"))
check("...y la pantalla usa esas palabras", all(w in HTM for w in ("conforme", "observación", "NC menor", "NC mayor", "acción", "verifica")))
check("las fechas se llenan solas: creación hoy, plazo en días hábiles",
      "(automáticas)" in HTM and "DIAS_PLAZO = 10" in JS and "function sumaHabiles" in JS)
check("las obras traen sus reclamos abiertos (para el programa rotativo por riesgo)",
      "AS reclamos" in SRC and "reclamo(s) abierto(s)" in JS)

print("\n5. La revisión elemento a elemento")
check("el elemento se trae ENTERO: marca, Ø, figura, dimensiones, largo, cantidad, peso, plano",
      '@router.get("/auditorias/elemento")' in SRC
      and all(c in SRC for c in ("marca, diam, figura, dim_a", "largo_total, cant, mult, cant_total", "nombre_plano"))
      and 'id="audRevBarras"' in HTM)
check("el hallazgo tiene los cuatro niveles y texto obligatorio si no es conforme",
      'id="audRevChips"' in HTM and "Di qué encontraste: sin texto no hay hallazgo." in JS
      and "on.dataset.h !== 'conforme' && !texto" in JS)
check("la causa sale del Ishikawa de Cubicaciones que Calidad ya tiene",
      'AREA_CUBICACIONES = "Cubicaciones"' in SRC and "FROM area_rca_subcausas s" in SRC
      and "BASE.causas" in JS)
check("estado y fechas se derivan solos: en curso al primer hallazgo, cerrada al último",
      "function estadoDe(aud)" in JS and "if (!a.inicio) a.inicio = iso(new Date());" in JS
      and "a.cierre = a.estado === 'cerrada' ? iso(new Date()) : null;" in JS)
check("cada NC es una acción para quien cubicó; la corrección no la hace el auditor",
      "function accionesDe(aud)" in JS and "h.hallazgo !== 'nc_menor' && h.hallazgo !== 'nc_mayor'" in JS
      and "La corrección no se hace aquí" in HTM)
check("el resultado de la lista es la cuenta por hallazgo", "function resultadoDe(aud)" in JS
      and "a.resultado = resultadoDe(a);" in JS)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
