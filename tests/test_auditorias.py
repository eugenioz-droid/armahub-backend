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
MIG122 = open(os.path.join(ROOT, "armahub", "migrations", "122_auditoria_descr_cc.sql"),
              encoding="utf-8").read()
MIG123 = open(os.path.join(ROOT, "armahub", "migrations", "123_auditoria_correlativo.sql"),
              encoding="utf-8").read()

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

print("\n5a. El veredicto se registra POR BARRA, no por elemento entero")
MIG120 = open(os.path.join(ROOT, "armahub", "migrations", "120_auditoria_items.sql"), encoding="utf-8").read()
check("hay una tabla de ítems, colgada del elemento",
      "CREATE TABLE IF NOT EXISTS auditoria_items" in MIG120
      and "REFERENCES auditoria_elementos(id) ON DELETE CASCADE" in MIG120
      and "ux_aud_items" in MIG120)
check("la referencia de una barra es su marca, con ordinal si se repite",
      "def refs_de_barras(" in SRC
      and A.refs_de_barras([{"marca": "10mmA1"}, {"marca": "10mmA2"}, {"marca": "10mmA1"}])
          == ["10mmA1", "10mmA2", "10mmA1#2"]
      and A.refs_de_barras([{}]) == ["?"])
check("una barra no conforme EXIGE decir qué tiene",
      "está marcada no conforme: di qué tiene." in SRC)
check("la severidad es del ELEMENTO y se deriva de sus barras",
      "def severidad_derivada(" in SRC
      and A.severidad_derivada([{"conforme": True}, {"conforme": True}], None) == "conforme"
      and A.severidad_derivada([{"conforme": True}, {"conforme": False}], None) == "nc_menor"
      and A.severidad_derivada([{"conforme": False}], "nc_mayor") == "nc_mayor"
      and A.severidad_derivada([], "conforme") == "conforme")
check("...y nunca se suaviza sola a «observación»: por omisión es NC menor",
      "nunca se suaviza a" in SRC and A.severidad_derivada([{"conforme": False}], None) == "nc_menor")
check("el texto del elemento se arma de las observaciones de las barras",
      'texto = (body.texto or "").strip() or " · ".join(' in SRC)
check("el front marca barra por barra y el campo de texto aparece al marcar NC",
      "function pintarBarras()" in JS and "var BARRAS = [], VERED = {};" in JS
      and "class=\"audobs\"" in JS and 'id="audRevSev"' in HTM)
check("...y la severidad sólo se pregunta si hay alguna barra no conforme",
      "$('audRevSev').style.display = c.malas ? 'flex' : 'none';" in JS)
check("al reabrir el elemento vuelve lo ya marcado",
      "def _hallazgos_de_items(" in SRC and '"revisados": revisados' in SRC
      and "Object.keys(d.revisados || {})" in JS)

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
check("el selector trae las dos fuentes en una sola lista buscable (combobox estándar)",
      '"obras_asa": asa_obras' in SRC and "function obrasParaElegir()" in JS
      and "global.Combobox.crear($('audObra')" in JS
      and "origen: 'armahub'" in JS and "origen: 'asa'" in JS)
check("...y el origen viaja en el item, no se adivina del texto",
      "ORIGEN = item ? item.origen : 'armahub';" in JS and "OBRA = item ? item.clave : '';" in JS)
check("...y una obra que ya está en ArmaHub no se repite como obra de aSa",
      "NOT EXISTS (SELECT 1 FROM proyectos pr" in SRC and "FROM barras b WHERE b.id_proyecto" in SRC)
check("el elemento de aSa es CtrlCode + ElementID, guardado en las mismas columnas",
      "def _elementos_de_items(" in SRC and '"eje": clave' in SRC
      and "CtrlCode eq '%s'" in SRC and 'ADD COLUMN cc TEXT' in MIG118)
check("el alcance de aSa son los CÓDIGOS DE CONTROL que se eligen a mano",
      '@router.get("/auditorias/cc")' in SRC and "def _sortear_asa(cur, job: str, n, ccs, semilla" in SRC
      and all(('id="%s"' % x) in HTM for x in ("audCcLista", "audCcBusca", "audCcTodos")))
check("...y NO se adivinan piso ni ciclo del texto: eso se sacó",
      "def piso_de(" not in SRC and "def ciclo_de(" not in SRC and "universo-asa" not in SRC)
check("...no entran los códigos ya despachados: auditarlos llega tarde",
      "NOT IN (%s, %s)" in SRC and "ESTADO_NUNCA, ESTADO_DESPACHADO" in SRC
      and "No aparecen los despachados" in HTM)
check("...sin códigos marcados no se puede crear",
      "Elige al menos un código de control." in SRC and "listo = listo && CCS.length > 0;" in JS)
check("una obra necesita varias auditorías: el sorteo NO repite elementos ya auditados",
      "def _ya_auditados(cur, id_proyecto: str)" in SRC and SRC.count("_ya_auditados(cur,") == 3
      and "ya fueron auditados" in SRC and "def _clave_elemento(e)" in SRC)
check("...y la caja de códigos muestra cuáles ya tienen elementos auditados",
      '"auditados"' in SRC and '"con_auditoria"' in SRC and "auditado(s)" in JS)
check("la caja de códigos: estado pegado al código y un solo check general",
      JS.index("'<span class=\"cod\">'") < JS.index("'<span class=\"e\">'") < JS.index("'<span class=\"d\">'")
      and 'id="audCcTodos"' in HTM and "todos.indeterminate = marcados > 0" in JS)
check("el alcance elegido se guarda, para poder decir de qué códigos salió la muestra",
      "ADD COLUMN ccs TEXT[]" in open(os.path.join(ROOT, "armahub", "migrations",
                                                   "119_auditorias_ccs.sql"), encoding="utf-8").read()
      and '"ccs": r[17] or []' in SRC and "a.ccs.slice(0, 6)" in JS)
check("el origen se elige primero y cambia el formulario",
      'id="audOrigen"' in HTM and "function pintarOrigen()" in JS
      and "var LOS_ORIGENES = [" in JS and "if (ORIGEN === 'asa') {" in JS)
check("...y el combobox sólo ofrece obras de ese origen",
      "no mezcla dos mundos" in JS and "if (ORIGEN === 'asa') {\n      return (BASE.obras_asa" in JS)
check("...acotado, porque cada elemento cuesta una consulta a aSa",
      "MUESTRA_MAXIMA_ASA = 20" in SRC and "tope de este endpoint es 500" in SRC)
check("la muestra son ELEMENTOS al azar dentro de los códigos elegidos",
      "bolsa.sort(key=lambda e: _orden_azar(" in SRC and "return len(candidatos), bolsa[:n]" in SRC
      and "Son ELEMENTOS, no códigos" in SRC)
check("...con el mismo azar reproducible que el sorteo en SQL",
      "def _orden_azar(" in SRC and "hashlib.md5" in SRC)
check("el selector lista una fila por JOB de aSa, no por nombre (hay obras con dos)",
      "GROUP BY p.asa_job_id" in SRC and "se sorteaba dentro de 63" in SRC)
check("los lados de la barra van en columnas y en cm, como en el Bar Manager",
      "def _lados(" in SRC and "<cp>(.*?)</cp>" in SRC and "function letrasUsadas(" in JS
      and "function normalizarBarra(" in JS and "ang1, ang2, ang3, ang4, radio" in SRC)
check("y la lista dice de qué origen salió cada auditoría",
      '"origen": r[16]' in SRC and 'class="audori ' in JS and ".audori.asa{" in HTM)

print("\n5e. El informe y los indicadores")
check("hay informe PDF, con el mismo motor que el de reclamos",
      '@router.get("/auditorias/{auditoria_id}/pdf")' in SRC and "class _InformePDF" in SRC
      and "from fpdf import FPDF" in SRC)
check("...y sigue el orden de la ISO: alcance · resultado · hallazgos · acciones · conclusión",
      all(s in SRC for s in ('"1. Alcance y muestra"', '"2. Resultado"', '"3. Hallazgos"',
                             '"4. Acciones"', '"5. Cobertura de la obra"', '"6. Conclusion"')))
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

print("\n5f. Cobertura: cuánto de la obra se ha mirado")
check("hay un endpoint que lista TODO y marca lo auditado",
      '@router.get("/auditorias/cobertura")' in SRC
      and '"pct": round(con / len(auditables) * 100)' in SRC and '"pct_kg"' in SRC)
check("...y va antes de /auditorias/{id}, o la tomaría como id",
      SRC.index('@router.get("/auditorias/cobertura")') < SRC.index('@router.get("/auditorias/{auditoria_id}")'))
check("...con DOS denominadores: lo auditable y el total de la obra",
      '"auditable": len(auditables)' in SRC and '"pct_total"' in SRC
      and '"auditable": r[3] != ESTADO_DESPACHADO' in SRC
      and "castiga por algo que nadie puede hacer" in SRC
      and "de lo auditable" in JS and "del total de la obra" in JS)
check("...y tres estados en la grilla: sin mirar, auditado y no auditable",
      ".audgrid span.fuera{" in HTM and "'fuera'" in JS and "despachado, ya no se audita" in JS)
check("la unidad se dice, porque las dos fuentes no se miden igual",
      'unidad = "código de control"' in SRC and 'unidad = "elemento"' in SRC
      and "auditar un elemento no agota el código" in JS)
check("la pantalla la pinta como grilla, un cuadrito por elemento",
      'id="audCobertura"' in HTM and ".audgrid span.nc_mayor" in HTM and "function pintarCobertura()" in JS
      and "sin auditar</span>" in JS)
check("...y entra al informe como su propia sección",
      "def _cobertura(self)" in SRC and '"5. Cobertura de la obra"' in SRC
      and '"6. Conclusion"' in SRC and "self._cobertura()" in SRC)

print("\n5g. Permisos y correo")
check("sólo administración y cubicadores entran al módulo",
      A.ROLES_AUDITAN == ("admin", "admin_calidad", "miembro", "externo")
      and A.AREA_AUDITA == "Cubicaciones" and "def _es_del_area(" in SRC
      and "def _puede_ver(user)" in SRC and SRC.count("_puede_ver(user)") >= 9)
check("...y el tab se esconde para el resto (el backend igual valida)",
      "switchTab('auditorias')" in SHELL and "puedeAuditar" in SHELL)
check("al crear se avisa por correo al auditor y al auditado",
      "def _avisar_auditoria_nueva(" in SRC and "Auditoría asignada" in SRC
      and "Se está auditando tu cubicación" in SRC
      and 'aud["correo"] = _avisar_auditoria_nueva(aud)' in SRC)
check("...el auditor recibe su plazo y el auditado sabe a quién mandarle los antecedentes",
      "Plazo para cerrarla" in SRC and "hazlos llegar al auditor" in SRC)
check("...y si el correo falla, la auditoría igual queda creada",
      "el correo avisa, no decide" in SRC and "def _avisar_correo(" in SRC
      and 'return {"enviado": False, "motivo": str(e)[:120]}' in SRC)
check("...usando el mailer único de la plataforma, no uno nuevo",
      "from . import mailer" in SRC and "mailer.is_configured()" in SRC and "mailer.send_email(" in SRC)

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
      "un eje completo con TODAS sus barras" in HTM)
check("los tres campos van alineados y las aclaraciones en su propia fila",
      'class="audfila audtres"' in HTM and 'class="audpies"' in HTM
      and ".audtres input, .audtres select, .audtres .audfechas{height:28px" in HTM)

print("\n7. Dónde está el elemento, cuando el sistema no lo puede saber")
# El pedido: «el tipo piso ciclo y eje al final salía del texto del nombre del CC; si se
# puede obtener bien, sino que lo llene el usuario». En aSa el piso y el ciclo NO existen
# en ningún campo, así que los escribe el auditor; en ArmaHub salen de la cubicación y son
# la clave del elemento, por eso allá no se tocan.
check("hay un endpoint para escribir la ubicación",
      '@router.put("/auditorias/{auditoria_id}/elementos/{elemento_id}/ubicacion")' in SRC)
check("en una obra de ArmaHub NO se toca: son la clave con que se buscan las barras",
      'if origen != "asa":' in SRC and "Se corrigen en la " in SRC)
check("el tipo se valida contra los sectores reales, no es texto libre",
      "if s and s not in SECTORES" in SRC)
check("piso, ciclo y eje son etiquetas de plano, con tope de largo",
      "LARGO_UBICACION = 40" in SRC and "etiqueta de plano" in SRC)
check("el eje no puede quedar vacío: es cómo se nombra el elemento",
      "El eje no puede quedar vacío" in SRC)
check("dos elementos de la misma auditoría no pueden quedar con la misma ubicación",
      "except UniqueViolation" in SRC and "ya la tiene otro elemento" in SRC)
check("queda registrado quién la escribió y cuándo",
      ", ubicado_por = %s, ubicado_el = now() WHERE id = %s" in SRC and '"auditoria_ubicar"' in SRC)
check("...y la lista de columnas que se pueden escribir es cerrada, no la manda el navegador",
      'for nombre, valor in (("piso", body.piso), ("ciclo", body.ciclo), ("eje", body.eje)):' in SRC)

# LO QUE HACE QUE ESTO NO SE ROMPA: el `eje` pasa a ser una etiqueta editable, así que la
# referencia con la que se le piden las barras a aSa tiene que vivir aparte.
check("la referencia en aSa (ElementID) se guarda aparte del eje",
      "ref_origen" in SRC and '"ref_origen": eid' in SRC)
check("...y es ESA la que se usa para pedir las barras, no el eje editable",
      "e.ref_origen != null && e.ref_origen !== ''" in JS)
check("...y en ArmaHub queda en NULL, porque allá la clave son las cuatro columnas",
      'e.get("ref_origen") if es_asa else None' in SRC)
check("el elemento sin ElementID ya no da 404 al pedir sus barras",
      'SIN_ELEMENTO = "(sin elemento)"' in SRC
      and '("" if element == SIN_ELEMENTO else element)' in SRC)

print("\n7b. Y llenarlo tiene que servir de algo: sale en el informe")
check("la ubicación va al PDF, debajo del hallazgo",
      "def _ubicacion_txt(" in SRC and "pie.append(_ubicacion_txt(e))" in SRC)
check("...sin repetir la etiqueta si el auditor ya la escribió",
      A._ubicacion_txt({"sector": "ELEV", "piso": "3", "ciclo": "2", "eje": "Eje K2"})
      == "Elevación · Piso 3 · Ciclo 2 · Eje K2")
check("...y mostrando sólo lo que está lleno",
      A._ubicacion_txt({"sector": "", "piso": "", "ciclo": "", "eje": "K(12-18)"}) == "Eje K(12-18)")
check("...sin ensuciar el informe con la etiqueta de «sin elemento»",
      A._ubicacion_txt({"sector": "FUND", "eje": A.SIN_ELEMENTO}) == "Fundación")

print("\n7c. El formulario aparece sólo donde hace falta")
check("los cuatro campos están en la pantalla de revisión",
      'id="audUbTipo"' in HTM and 'id="audUbPiso"' in HTM and 'id="audUbCiclo"' in HTM
      and 'id="audUbEje"' in HTM and 'id="audUbGuardar"' in HTM)
check("...y sólo se muestran en las auditorías de aSa",
      "AUD.origen !== 'asa'" in JS and "function pintarUbicacion()" in JS)
check("...diciendo por qué están vacíos", "aSa no trae piso ni ciclo" in JS)
check("el tipo se ofrece de la lista del backend, no de una copia en el navegador",
      "BASE.sectores" in JS)

print("\n7d. El código de control es una columna, no parte del nombre")
# «Es mejor poner encabezado para el CC, para Descr del CC y separarlo del nombre del
# elemento porque queda enredado y confuso». Antes el nombre era «SUP4 · INF · FUN C17»:
# tres cosas pegadas, y el «INF» ya estaba en la columna Eje.
check("el nombre del elemento es sólo del elemento, sin el código pegado",
      "EL NOMBRE ES SÓLO DEL ELEMENTO" in SRC
      and 'e["nombre"] = (e["estructura"]' in SRC)
check("la descripción del código se guarda en su propia columna",
      "descr_cc" in SRC and "ADD COLUMN descr_cc" in MIG122)
check("...en foto, porque en aSa la pueden renombrar",
      "puede cambiar, y el informe tiene que seguir diciendo" in SRC)
check("la tabla tiene encabezado para el código y para su descripción",
      "<th>Código</th><th>Descripción del código</th>" in JS)
check("...y sólo en las auditorías de aSa, que es donde existe el código",
      "var esAsa = AUD.origen === 'asa';" in JS and "(esAsa ? '<th>Código</th>" in JS)
check("la descripción larga se corta y queda entera en el title",
      ".audt td.auddcc{max-width" in HTM and 'class="auddcc" title=' in JS)
# Fuera de la tabla no hay columna al lado que lo diga, así que el código tiene que viajar
# junto al nombre: el informe, los avisos y la lista de acciones se leen sueltos.
check("fuera de la tabla el elemento se nombra con su código",
      "function nombreCompleto(e)" in JS and "nombreCompleto(e)" in JS.split("function nombreCompleto")[1])
check("...y el informe también lo dice",
      'partes.append("CC %s" % e["cc"])' in SRC
      and 'titulo = " · ".join(x for x in (e.get("cc"), e["nombre"]) if x)' in SRC)
check("...igual que el aviso al cubicador y la lista de «mis acciones»",
      "o el cubicador no sabe en cuál de sus veinte códigos mirar" in SRC
      and "CONCAT_WS(' · ', NULLIF(e.cc, ''), e.nombre)" in SRC)
check("las auditorías viejas se arreglan solas en la migración",
      "SET nombre = COALESCE(NULLIF(btrim(e.estructura), '')" in MIG122
      and "SET descr_cc = (SELECT NULLIF(p.descr, '')" in MIG122)

print("\n7e. El número de la auditoría no se repite después de borrar una")
# BUG REAL, visto en el smoke: `_codigo` contaba las auditorías del año, asi que al borrar
# una quedaba un hueco y la siguiente volvía a pedir un código ya usado. El INSERT chocaba
# con el índice único de `codigo` y el usuario veía «Error interno del servidor», que no
# dice nada. Y pasa justo cuando alguien levanta una auditoría por error y la borra.
check("el número sale de un correlativo aparte, no de contar las auditorías",
      "INSERT INTO auditoria_correlativo (anio, ultimo) VALUES (%s, 1)" in SRC
      and "COUNT(*) FROM auditorias WHERE EXTRACT" not in SRC)
check("...así que borrar una NO devuelve su número a la fila",
      "REUSAR el número es peor" in SRC and "CREATE TABLE IF NOT EXISTS auditoria_correlativo" in MIG123)
check("...lo que importa porque al crear se manda un correo con ese código",
      "dos correos distintos hablarían de la misma" in SRC)
check("dos personas creando a la vez se ordenan con el candado de la fila, sin reintentos",
      "ON CONFLICT (anio) DO UPDATE SET ultimo = auditoria_correlativo.ultimo + 1" in SRC
      and "SAVEPOINT" not in SRC)
check("el correlativo arranca donde iba la serie ya escrita",
      "ON CONFLICT (anio) DO NOTHING" in MIG123 and "MAX(substring(codigo from" in MIG123)


class _CurFalso:
    """Un cursor de mentira para probar el generador de códigos sin base."""

    def __init__(self, siguiente):
        self.siguiente, self.sql, self.params = siguiente, None, None

    def execute(self, sql, params=None):
        self.sql, self.params = sql, params

    def fetchone(self):
        return (self.siguiente,)


c = _CurFalso(1)
check("el primero del año es el 001", A._codigo(c) == "A-%d-001" % A._hoy().year)
check("...y el correlativo se pide para ESTE año", c.params == (A._hoy().year,))
check("el octavo es el 008", A._codigo(_CurFalso(8)) == "A-%d-008" % A._hoy().year)
check("...y pasado el 999 no se trunca", A._codigo(_CurFalso(1004)) == "A-%d-1004" % A._hoy().year)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
