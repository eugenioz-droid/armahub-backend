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

print("\n2. Las auditorías viven en la BASE, no en el navegador")
MIG = open(os.path.join(ROOT, "armahub", "migrations", "117_auditorias.sql"), encoding="utf-8").read()
check("hay dos tablas: la auditoría y su muestra",
      "CREATE TABLE IF NOT EXISTS auditorias" in MIG
      and "CREATE TABLE IF NOT EXISTS auditoria_elementos" in MIG
      and "REFERENCES auditorias(id) ON DELETE CASCADE" in MIG)
check("...la muestra se guarda (no se resortea) y la semilla queda para explicarla",
      "semilla         TEXT NOT NULL" in MIG and "INSERT INTO auditoria_elementos" in SRC
      and "cur.executemany(" in SRC)
check("...el mismo elemento no puede estar dos veces en una auditoría",
      "ux_aud_elem" in MIG and "(auditoria_id, sector, piso, ciclo, eje)" in MIG)
check("el front ya NO guarda en el navegador: todo pasa por la API",
      "localStorage" not in JS and "req('POST', '/auditorias'" in JS
      and "req('GET', '/auditorias/'" in JS)
check("un solo sorteo para la vista previa y para la creación",
      "def _sortear(cur" in SRC and SRC.count("_sortear(") == 3)

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
check("acciones: pendiente · corregida · verificada", A.ACCIONES == ("pendiente", "corregida", "verificada"))
check("las fechas las pone el SISTEMA: creación hoy, plazo en días hábiles",
      "(automáticas)" in HTM and "DIAS_PLAZO = 10" in SRC and "def _habiles(" in SRC
      and "_habiles(hoy, DIAS_PLAZO)" in SRC)
check("...y el estado se DERIVA de los hallazgos, en la base",
      "def estado_de(revisados: int, total: int)" in SRC and "def _recalcular(cur" in SRC
      and A.estado_de(0, 5) == "planificada" and A.estado_de(1, 5) == "en_curso"
      and A.estado_de(5, 5) == "cerrada" and A.estado_de(6, 5) == "cerrada")
check("...el plazo cuenta hábiles: 10 desde un viernes caen dos viernes después",
      A._habiles(__import__("datetime").date(2026, 10, 2), 10) == __import__("datetime").date(2026, 10, 16))
check("las obras traen sus reclamos abiertos (para el programa rotativo por riesgo)",
      "AS reclamos" in SRC and "reclamo(s) abierto(s)" in JS)

print("\n5. La revisión elemento a elemento")
check("el elemento se trae ENTERO: marca, Ø, figura, dimensiones, largo, cantidad, peso, plano",
      '@router.get("/auditorias/elemento")' in SRC
      and all(c in SRC for c in ("marca, diam, figura, dim_a", "largo_total, cant, mult, cant_total", "nombre_plano"))
      and 'id="audRevBarras"' in HTM)
check("el hallazgo tiene los cuatro niveles y el TEXTO LO EXIGE EL BACKEND si no es conforme",
      'id="audRevChips"' in HTM
      and 'detail="Di qué encontraste: un hallazgo sin texto no es evidencia."' in SRC
      and 'body.hallazgo != "conforme" and not texto' in SRC)
check("la causa sale del Ishikawa de Cubicaciones que Calidad ya tiene",
      'AREA_CUBICACIONES = "Cubicaciones"' in SRC and "FROM area_rca_subcausas s" in SRC
      and "BASE.causas" in JS)
check("el resultado se cuenta en la BASE y el front sólo lo pinta",
      "COUNT(e.id) FILTER (WHERE e.hallazgo = 'nc_mayor')" in SRC
      and "resultadoDe" not in JS and "var r = a.resultado || {};" in JS)

print("\n5b. La acción que nace de la no conformidad")
check("sólo las NC abren acción, y arranca pendiente",
      'es_nc = body.hallazgo in ("nc_menor", "nc_mayor")' in SRC and 'accion = "pendiente"' in SRC.replace(
          'accion = accion_previa if accion_previa in ("corregida", "verificada") else "pendiente"',
          'accion = "pendiente"'))
check("...y lo ya verificado no se pisa al reeditar el hallazgo",
      'accion_previa if accion_previa in ("corregida", "verificada")' in SRC)
check("VERIFICAR es del auditor: el que corrigió no puede darse el visto bueno",
      'body.estado == "verificada" and email != auditor and not es_admin' in SRC
      and "Verificar es del auditor de esta auditoría." in SRC)
check("a quien cubicó le llega aviso en la campana, sin romper el hallazgo si falla",
      "def _avisar(" in SRC and "'auditoria_accion'" in SRC and "except Exception:" in SRC
      and "reclamo_id` va NULL" in SRC)
check("...y además tiene su propia caja «mis correcciones pendientes»",
      '@router.get("/auditorias/mias/acciones")' in SRC and 'id="audMias"' in HTM
      and "cargarMisAcciones" in JS)
check("una auditoría con hallazgos NO se borra (es un registro de calidad)",
      "una auditoría con hallazgos no se borra" in SRC and "status_code=409" in SRC)

print("\n5c. Se puede auditar una obra de aSa, no sólo las de ArmaHub")
MIG118 = open(os.path.join(ROOT, "armahub", "migrations", "118_auditorias_asa.sql"), encoding="utf-8").read()
check("los dos orígenes están declarados", A.ORIGENES == ("armahub", "asa")
      and 'origen          TEXT NOT NULL DEFAULT \'armahub\'' in MIG
      and "ADD COLUMN cc TEXT" in MIG118)
check("el selector trae las dos fuentes, en dos grupos",
      '"obras_asa": asa_obras' in SRC and 'optgroup label="En ArmaHub' in JS
      and 'optgroup label="Sólo en aSa' in JS and "value=\"asa|" in JS)
check("...y una obra que ya está en ArmaHub no se repite como obra de aSa",
      "NOT EXISTS (SELECT 1 FROM proyectos pr" in SRC and "FROM barras b WHERE b.id_proyecto" in SRC)
check("el elemento de aSa es CtrlCode + ElementID, guardado en las mismas columnas",
      "def _elementos_de_items(" in SRC and '"eje": clave' in SRC
      and "CtrlCode eq '%s'" in SRC and 'ADD COLUMN cc TEXT' in MIG118)
check("el alcance de aSa es otro: año, estado, quién cubicó, piso, ciclo y buscador",
      '@router.get("/auditorias/universo-asa")' in SRC and "def _sortear_asa(" in SRC
      and all(('id="%s"' % x) in HTM for x in ("audAnios", "audEstados", "audPersonas",
                                               "audAsaPisos", "audAsaCiclos", "audBusca")))
check("...el piso y el ciclo se reconocen del TEXTO del código, con reglas conservadoras",
      "def piso_de(" in SRC and "def ciclo_de(" in SRC
      and A.ciclo_de("LOSAS C-4 SUBT.") == "C4" and A.ciclo_de("ELEV- P2 C2") == "C2"
      and A.piso_de("ELEV- P2 C2") == "P2" and A.piso_de("LC P13 C5") == "P13"
      and A.ciclo_de("Adicional cliente") is None and A.piso_de("COLUMNAS ET-D") is None)
check("...y lo no reconocido se agrupa en «(sin dato)», no se inventa",
      'SIN_DATO = "(sin dato)"' in SRC and "piso_de(descr) or SIN_DATO" in SRC)
check("...acotado, porque cada elemento cuesta una consulta a aSa",
      "MUESTRA_MAXIMA_ASA = 20" in SRC and "tope de este endpoint es 500" in SRC)
check("la muestra son ELEMENTOS al azar, no un elemento por código",
      "bolsa.sort(key=lambda e: _orden_azar(" in SRC and "return total, bolsa[:n]" in SRC
      and "es una muestra de pedidos" in SRC)
check("...con el mismo azar reproducible que el sorteo en SQL",
      "def _orden_azar(" in SRC and "hashlib.md5" in SRC)
check("el selector lista una fila por JOB de aSa, no por nombre (hay obras con dos)",
      "GROUP BY p.asa_job_id" in SRC and "se sorteaba dentro de 63" in SRC)
check("los lados de la barra se muestran como texto, sin dibujar",
      "def _lados(" in SRC and "<cp>(.*?)</cp>" in SRC and "Lados / dimensiones" in JS)
check("y la lista dice de qué origen salió cada auditoría",
      '"origen": r[16]' in SRC and 'class="audori ' in JS and ".audori.asa{" in HTM)

print("\n5e. El informe y los indicadores")
check("hay informe PDF, con el mismo motor que el de reclamos",
      '@router.get("/auditorias/{auditoria_id}/pdf")' in SRC and "class _InformePDF" in SRC
      and "from fpdf import FPDF" in SRC)
check("...y sigue el orden de la ISO: alcance · resultado · hallazgos · acciones · conclusión",
      all(s in SRC for s in ('"1. Alcance y muestra"', '"2. Resultado"', '"3. Hallazgos"',
                             '"4. Acciones"', '"5. Conclusion"')))
check("...las no conformidades van primero en el informe",
      'orden = {"nc_mayor": 0, "nc_menor": 1' in SRC)
check("...y se baja con fetch, no con un <a href> (el token va en la cabecera)",
      "'/auditorias/' + AUD.id + '/pdf'" in JS and "URL.createObjectURL(await res.blob())" in JS)
check("los indicadores se cuentan en la base, sólo sobre lo REVISADO",
      '@router.get("/auditorias/indicadores")' in SRC and "e.hallazgo IS NOT NULL" in SRC
      and "conformes sobre revisados" in SRC)
check("...por cubicador, obra, mes y el Pareto de causas",
      all(k in SRC for k in ('"por_cubicador"', '"por_obra"', '"por_mes"', '"causas"'))
      and 'id="audKpiCub"' in HTM and 'id="audKpiCausa"' in HTM)
check("...y la ruta va ANTES de /auditorias/{id}, o la tomaría como id",
      SRC.index('@router.get("/auditorias/indicadores")') < SRC.index('@router.get("/auditorias/{auditoria_id}")'))

print("\n5d. El formulario de creación está plegado tras un botón")
check("hay un botón grande que abre el formulario, y arranca cerrado",
      'id="audNueva" class="audnueva"' in HTM and 'id="audForm" style="display:none;' in HTM
      and "function abrirForm(abrir)" in JS and ".audnueva{" in HTM)
check("...y al crear se cierra solo", "abrirForm(false);" in JS)
check("la lista y la auditoría abierta son DOS vistas, nunca las dos a la vez",
      'id="audVistaLista"' in HTM and "if (lista) lista.style.display = 'none';" in JS
      and "if (lista) lista.style.display = '';" in JS and 'id="audVolver"' in HTM)
check("...y al crear se entra directo a la auditoría recién creada",
      "ABIERTA = a.id; AUD = a; ELEM = null;" in JS)

print("\n6. El alcance se arma: multi-selección y contadores que se entienden")
check("el clic simple suma (no exige Ctrl) y hay un botón «Todos» que suelta",
      "function marcar(lista, valor)" in JS and "if (b.dataset.todos) activos.length = 0; else marcar(activos" in JS
      and "data-todos=\"1\"" in JS and "alternar" not in JS)
check("el contador va en su propia pastilla y dice qué es",
      "elementos disponibles" in JS and ".audchips button i{" in HTM
      and "<b>elementos disponibles</b>" in HTM)
check("se dice que la muestra son elementos completos, no barras",
      "elementos completos" in HTM and "un eje completo con TODAS sus barras" in HTM)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
