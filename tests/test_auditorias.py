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

from datetime import datetime as _DT, timezone as _TZ  # noqa: E402


def _dt(a, m, d, h, mi):
    return _DT(a, m, d, h, mi, tzinfo=_TZ.utc)


def _d(a, m, d):
    from datetime import date as _DATE
    return _DATE(a, m, d)

SRC = open(os.path.join(ROOT, "armahub", "auditorias.py"), encoding="utf-8").read()


def _leer_rec():
    return open(os.path.join(ROOT, "armahub", "reclamos.py"), encoding="utf-8").read()
MAIN = open(os.path.join(ROOT, "armahub", "main.py"), encoding="utf-8").read()
APP = open(os.path.join(ROOT, "armahub", "templates", "app.html"), encoding="utf-8").read()
HTM = open(os.path.join(ROOT, "armahub", "templates", "tabs", "auditorias.html"), encoding="utf-8").read()
JS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "auditorias", "index.js"), encoding="utf-8").read()
SHELL = open(os.path.join(ROOT, "armahub", "static", "js", "app", "shell.js"), encoding="utf-8").read()
DEJS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "reclamos", "detail-edit.js"), encoding="utf-8").read()
REVJS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "auditorias", "revision.js"),
             encoding="utf-8").read()
# LA HOJA DE BARRAS (6-nov): la tabla común de la planilla del auditor, el Resumen
# Hallazgos y la revisión de barras.
HOJA = open(os.path.join(ROOT, "armahub", "static", "js", "features", "auditorias", "hoja_barras.js"),
            encoding="utf-8").read()
APPH = open(os.path.join(ROOT, "armahub", "templates", "app.html"), encoding="utf-8").read()
SCHED = open(os.path.join(ROOT, "armahub", "asa_scheduler.py"), encoding="utf-8").read()
MIG138 = open(os.path.join(ROOT, "armahub", "migrations", "138_auditoria_envio_cierre.sql"),
              encoding="utf-8").read()
MIG139 = open(os.path.join(ROOT, "armahub", "migrations", "139_auditoria_aviso_fabrica.sql"),
              encoding="utf-8").read()
MIG142 = open(os.path.join(ROOT, "armahub", "migrations", "142_feriados.sql"),
              encoding="utf-8").read()
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
import re as _re
_ls = _re.findall(r"localStorage\.\w+\('([^']+)'", JS)
check("el front ya NO guarda DATOS en el navegador: todo pasa por la API",
      [k for k in _ls if k != "armahub_fig_tam"] == []
      and "req('POST', '/auditorias'" in JS and "req('GET', '/auditorias/'" in JS)
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
# El orden natural de pisos y ciclos (P1, P2, …, P12) era del alcance de ArmaHub, que vivía
# en /auditorias/universo. Se fue con el origen ArmaHub (15-oct): en aSa el alcance son
# códigos de control y no hay pisos que ordenar.
check("el alcance por pisos y ciclos se fue con el origen ArmaHub",
      "regexp_replace(COALESCE(" not in SRC and 'get("/auditorias/universo")' not in SRC)

print("\n4. El vocabulario es el de la ISO 19011 / 9001")
# CUATRO ESTADOS desde el 9-oct: entre terminar de mirar y resolver estaba el ENVÍO, el
# acto que le pasa el trabajo al auditado, y no existía. Ver 8a.
check("estados: planificada · en curso · enviada · cerrada",
      A.ESTADOS == ("planificada", "en_curso", "enviada", "cerrada"))
# LA GRAVEDAD NO SE OPINA (7-oct). Eran cuatro niveles y dos pedían GRADUAR: «NC menor»
# y «NC mayor». Dos auditores gradúan distinto el mismo defecto, así que el indicador
# quedaba a merced de quién miró. Ahora el auditor declara un hecho y la gravedad la
# calcula el sistema con el estado del código.
check("hallazgos: conforme · observación · hallazgo",
      A.HALLAZGOS == ("conforme", "observacion", "hallazgo"))
check("...y la pantalla usa esas palabras", all(w in HTM for w in ("conforme", "observación", "hallazgo", "acción", "verifica")))
check("ya no se le pide graduar al auditor", "NC menor" not in HTM and "nc_mayor" not in JS)
check("la gravedad se calcula del estado del código, no se pregunta",
      A.gravedad_de("hallazgo", "Shipped") == "despachado"
      and A.gravedad_de("hallazgo", "Open") == "antes"
      and A.gravedad_de("hallazgo", None) == "sin_dato"
      and A.gravedad_de("conforme", "Shipped") is None
      and A.gravedad_de("observacion", "Shipped") is None)
check("...y se dice en palabras", A.GRAVEDAD["despachado"] == "Detectado después del despacho"
      and A.GRAVEDAD["antes"] == "Detectado antes del despacho")
check("...y viaja en cada elemento", '"gravedad": gravedad_de(e[10], e[28])' in SRC)
# «desestimada» entró el 15-oct, y sólo para el comentario del elemento: el descarte de
# una barra vive en la barra (`desestimado`) y el elemento lo deriva, pero un comentario
# que no tiene barra dónde apoyarse necesita poder quedar sin efecto en el elemento mismo.
check("acciones: pendiente · corregida · verificada · desestimada",
      A.ACCIONES == ("pendiente", "corregida", "verificada", "desestimada"))
check("las fechas las pone el SISTEMA: creación hoy, plazo automático",
      "(automáticas)" in HTM and "HORAS_AUDITORIA = 24" in SRC
      and "vence_en(datetime.now(timezone.utc), HORAS_AUDITORIA," in SRC)
# EL ESTADO SE SIGUE DERIVANDO, pero de más cosas: revisar todo ya no cierra —sólo
# habilita el envío— y cerrar pasó a significar RESUELTA. Lo que se congela acá es que
# nadie lo elige a mano; el detalle de los cuatro estados está en 8a.
check("...y el estado se DERIVA, en la base y no en el navegador",
      "def estado_de(revisados: int, total: int" in SRC and "def _recalcular(cur" in SRC
      and A.estado_de(0, 5) == "planificada" and A.estado_de(1, 5) == "en_curso"
      and A.estado_de(5, 5) == "en_curso" and A.estado_de(6, 5) == "en_curso")
# LOS DOS PLAZOS SON DE 24 HORAS y son DOS, lo fijó el usuario: «el plazo de corrección
# son 24 hrs» y «la auditoría tiene 24 hrs para hacerse también». Uno corre desde que se
# CREA (el del auditor) y el otro desde que se ENVÍA (el del auditado), que es cuando
# recién puede hacer algo. Antes el panel del auditado mostraba el del auditor.
check("dos plazos de 24 horas, de dos personas y con dos arranques",
      A.HORAS_AUDITORIA == 24 and A.HORAS_CORRECCION == 24
      and "correccion_vence = %s WHERE id = %s" in SRC
      and "a.correccion_vence, a.auditor" in SRC)
check("...y el fin de semana no cuenta: un viernes a las 16:30 vence el lunes a las 16:30",
      A.vence_en(_dt(2026, 10, 9, 16, 30), 24) == _dt(2026, 10, 12, 16, 30)
      and A.vence_en(_dt(2026, 10, 6, 9, 0), 24) == _dt(2026, 10, 7, 9, 0))
# «Son días hábiles. Si hay un feriado no debería correr» (usuario, 9-oct). El lunes
# 12-10-2026 es feriado: lo enviado el viernes vence el martes, no el lunes.
check("...ni los feriados, que viven en una tabla y no en el código",
      A.vence_en(_dt(2026, 10, 9, 16, 30), 24, frozenset([_d(2026, 10, 12)]))
      == _dt(2026, 10, 13, 16, 30)
      and "def feriados_de(" in SRC and "CREATE TABLE IF NOT EXISTS feriados" in MIG142)
check("...y si la tabla no estuviera, el plazo igual se calcula en vez de caerse",
      "Un feriado de más no puede tumbar" in SRC)
check("la Semana Santa va calculada, no escrita de memoria",
      "Pascua 2026 = 5 de abril" in MIG142 and "2026-04-03" in MIG142)
check("...el del auditado no corre si la auditoría se reabre: él deja de verla",
      "correccion_vence = NULL" in SRC)
check("...y se mide con la HORA, no con el día",
      "datetime.fromisoformat(f[\"vence\"]) < ahora" in SRC)
# La lista de obras de ArmaHub —con sus reclamos abiertos— se fue con el origen ArmaHub
# (15-oct). Los reclamos siguen asociados al job de aSa, que es toda la homologacion.
check("los reclamos cuelgan del job de aSa, que es por donde se correlacionan",
      "asa_job_id" in _leer_rec() and "trg_reclamo_job_desde_obra" in
      open(os.path.join(ROOT, "armahub", "migrations", "144_reclamo_job_desde_obra.sql"), encoding="utf-8").read())

print("\n5. La revisión elemento a elemento")
check("el elemento se trae ENTERO: marca, Ø, figura, dimensiones, largo, cantidad, peso, plano",
      '@router.get("/auditorias/elemento")' in SRC
      and all(c in SRC for c in ("marca, diam, figura, dim_a", "largo_total, cant, mult, cant_total", "nombre_plano"))
      and 'id="audRevBarras"' in HTM)
check("el TEXTO LO EXIGE EL BACKEND si no es conforme",
       'detail="Di qué encontraste: un hallazgo sin texto no es evidencia."' in SRC
      and 'body.hallazgo != "conforme" and not texto' in SRC)
check("la causa sale del Ishikawa de Cubicaciones que Calidad ya tiene",
      'AREA_CUBICACIONES = "Cubicaciones"' in SRC and "FROM area_rca_subcausas s" in SRC
      and "BASE.causas" in JS)
check("el resultado se cuenta en la BASE y el front sólo lo pinta",
      "COUNT(e.id) FILTER (WHERE e.hallazgo = 'hallazgo')" in SRC
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
      and A.severidad_derivada([{"conforme": True}, {"conforme": False}], None) == "hallazgo"
      and A.severidad_derivada([{"conforme": False}], "observacion") == "observacion"
      and A.severidad_derivada([], "conforme") == "conforme")
check("...y nunca se suaviza sola a «observación»: por omisión es hallazgo",
      "nunca se suaviza a" in SRC and A.severidad_derivada([{"conforme": False}], None) == "hallazgo")
# CADA COSA EN SU CAMPO (8-oct). Antes, si el auditor no escribía una observación general,
# acá se le metía la concatenación de lo dicho barra por barra, y en el informe no se podía
# distinguir un comentario del elemento de uno de una barra. Lo cazó el usuario leyéndolo.
check("el texto del elemento es SOLO lo que escribió el auditor, sin las barras pegadas",
      'texto = (body.texto or "").strip()\n' in SRC
      and 'texto = (body.texto or "").strip() or " · ".join(' not in SRC)
check("...lo de cada barra viaja aparte, con el nombre de SU barra",
      '"barras_malas"' in SRC and "WHERE e.auditoria_id = %s AND i.conforme IS FALSE" in SRC)
check("...y se juntan al ESCRIBIR el informe, no al guardar",
      "def que_se_encontro(" in SRC and "Esto se arma AL ESCRIBIR y no al guardar" in SRC)
check("la evidencia no se pierde: toda barra no conforme sigue obligada a decir qué tiene",
      "está marcada no conforme: di qué tiene." in SRC
      and 'if hallazgo != "conforme" and not texto and not malas:' in SRC)
check("...y el correo y el informe muestran las dos cosas, no sólo el campo general",
      "que_se_encontro(e, 200)" in SRC and "que_se_encontro(e)), new_x" in SRC)
# En pantalla lo que se encontró se lee en la tabla de acciones, barra por barra (filaAccion)
# y el comentario del elemento en su fila (filaComentario). La celda que lo juntaba en un
# párrafo con lista (celdaQueSeEncontro) quedó sin llamadores y se fue (4-nov).
check("la pantalla lo muestra barra por barra en la tabla de acciones; la celda vieja ya no existe",
      "function celdaQueSeEncontro(" not in JS and "audobsgen" not in JS and "audobsb" not in HTM
      and "function filaComentario(" in JS and "function filaAccion(" in JS)
check("...y en la hoja de la auditoría el texto del auditor tiene su ancho: ahí es donde se trabaja",
      "{ titulo: 'Qué encontró el auditor', ancho: 220, clase: 'audqse' }" in JS
      and ".audt.hojab td.audqse" in HTM and "revcc2 audhoja" in JS)

# LA TABLA DE LA MUESTRA SE SALÍA DEL ANCHO y la última columna quedaba cortada contra el
# borde. Lo que la empujaba era el texto del hallazgo arrastrado dentro de su celda.
print("\n7c4. La tabla de la muestra cabe en la pantalla")
check("el veredicto va solo, sin arrastrar el texto al lado",
      "EL VEREDICTO, SIN EL TEXTO AL LADO" in JS
      and "esc(e.texto.slice(0, 36))" not in JS)
check("...y el texto completo sigue a mano, en el title de la celda",
      'esc(queSeEncontro(e)) + \'">\'' in JS and "function queSeEncontro(" in JS)
check("las dos columnas de texto largo tienen techo y se cortan con puntos suspensivos",
      ".audt td.audnom{max-width:150px" in HTM and 'class="audnom"' in JS
      and ".audt td.auddcc{max-width:190px" in HTM)
check("el front marca barra por barra y el campo de texto aparece al marcar NC",
      "function pintarBarras()" in JS and "var BARRAS = [], VERED = {};" in JS
      and "class=\"audobs\"" in JS)
# 9-nov: «Elimina esa severidad del elemento… Cada barra con su propio tratamiento».
check("...sin severidad del elemento: una barra con Hallazgo abre acción, siempre (lo deriva el backend)",
      'id="audRevSev"' not in HTM and "audRevChips" not in HTM and "audRevChips" not in JS
      and "items: items, texto: $('audRevTexto').value" in JS
      and A.severidad_derivada([{"conforme": True}, {"conforme": False}], None) == "hallazgo")
check("...y la caja «observaciones» sale sólo en las auditorías viejas que las tienen",
      "(obsN ? caj(obsN, 'observaciones') : '')" in JS)
# 9-nov: «quedaría mejor que la tabla de la auditoría se vea en un modal y no más abajo».
check("la revisión del elemento va en un modal, como la revisión de barras, y se cierra con ✕ o afuera",
      '<div id="audRevModal" style="display:none; position:fixed;' in HTM
      and '<div id="audRev" class="revhoja audrev">' in HTM
      and HTM.index('</div><!-- fin .audcols -->') < HTM.index('id="audRevModal"')
      and "$('audRevModal').style.display = visible ? '' : 'none';" in JS
      and "if (e.target === $('audRevModal')) cerrarRevision();" in JS
      and ".audrev .audbd{max-height:calc(100vh - 230px);}" in HTM)
check("...cerrar con barras marcadas sin guardar pregunta, y guardar cierra",
      "if (SUCIO && !global.confirm(" in JS
      and "REV_ABIERTA = false; SUCIO = false;" in JS.split("async function guardarHallazgo(")[1][:2500]
      and "mostrarRevision(!!ELEM && REV_ABIERTA);" in JS)
check("al reabrir el elemento vuelve lo ya marcado",
      "def _hallazgos_de_items(" in SRC and '"revisados": revisados' in SRC
      and "Object.keys(d.revisados || {})" in JS)

print("\n5b. La acción que nace de la no conformidad")
check("sólo el hallazgo abre acción, y arranca pendiente",
      'es_nc = body.hallazgo in ("hallazgo",)' in SRC and 'accion = "pendiente"' in SRC.replace(
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
# «MIS CORRECCIONES» SE FUE (6-nov): «al cubicador le aparece un resumen super desordenado
# que de hecho le desordena la forma de trabajar… al presionar en la auditoría, ahí entra».
check("...y el cubicador trabaja dentro de cada auditoría: la caja suelta «Mis correcciones» ya no está",
      'id="audMias"' not in HTM and "cargarMisAcciones" not in JS and "function filaMia(" not in JS
      and ".audmias" not in HTM)
check("una auditoría con hallazgos NO se borra (es un registro de calidad)",
      "una auditoría con hallazgos no se borra" in SRC and "status_code=409" in SRC)

print("\n5c. Se puede auditar una obra de aSa, no sólo las de ArmaHub")
MIG118 = open(os.path.join(ROOT, "armahub", "migrations", "118_auditorias_asa.sql"), encoding="utf-8").read()
check("los dos orígenes están declarados", A.ORIGENES == ("armahub", "asa")
      and 'origen          TEXT NOT NULL DEFAULT \'armahub\'' in MIG
      and "ADD COLUMN cc TEXT" in MIG118)
# LA AUDITORIA ES SIEMPRE SOBRE aSa (15-oct). El usuario: «debe ser siempre aSa, de hecho
# eliminemos la opcion de ArmaHub para evitar enredos». Una fuente, una lista, un job por
# obra: los frentes que ArmaHub tenga de esa obra son cosa de la cubicacion.
check("el selector trae UNA fuente, los jobs de aSa, en el combobox estándar",
      '"obras_asa": asa_obras' in SRC and '"obras": lista' not in SRC
      and "function obrasParaElegir()" in JS and "global.Combobox.crear($('audObra')" in JS
      and "origen: 'asa'" in JS and "origen: 'armahub'" not in JS)
check("...el origen no se elige: es aSa", "var ORIGEN = 'asa'" in JS
      and "LOS_ORIGENES" not in JS and "function pintarOrigen" not in JS)
check("...y una obra con barras en ArmaHub TAMBIEN se ofrece: si no, no se podria auditar",
      "NOT EXISTS (SELECT 1 FROM proyectos pr" not in SRC
      and "excluirlas las dejaba sin" in SRC)
check("crear con origen ArmaHub se rechaza en el backend, no solo en la pantalla",
      'if body.origen != "asa":' in SRC and "status_code=410" in
      SRC.split('if body.origen != "asa":')[1][:300])
check("el elemento de aSa es CtrlCode + ElementID, guardado en las mismas columnas",
      "def _elementos_de_items(" in SRC and '"eje": clave' in SRC
      and "CtrlCode eq '%s'" in SRC and 'ADD COLUMN cc TEXT' in MIG118)
check("el alcance de aSa son los CÓDIGOS DE CONTROL que se eligen a mano",
      '@router.get("/auditorias/cc")' in SRC and "def _sortear_asa(cur, job: str, n, ccs, semilla" in SRC
      and all(('id="%s"' % x) in HTM for x in ("audCcLista", "audCcBusca", "audCcTodos")))
check("...y NO se adivinan piso ni ciclo del texto: eso se sacó",
      "def piso_de(" not in SRC and "def ciclo_de(" not in SRC and "universo-asa" not in SRC)
check("los despachados se ofrecen, marcados: la decisión es del usuario",
      "NOT IN (%s, %s)" in SRC and "ESTADO_NUNCA, ESTADO_DESPACHADO" in SRC
      and "No aparecen los despachados" not in HTM
      and "van al final y vienen sin marcar" in HTM)
check("...sin códigos marcados no se puede crear",
      "Elige al menos un código de control." in SRC and "listo = listo && CCS.length > 0;" in JS)
check("una obra necesita varias auditorías: el sorteo NO repite elementos ya auditados",
      "def _ya_auditados(cur, id_proyecto: str)" in SRC and SRC.count("_ya_auditados(cur,") == 3
      and "ya fueron auditados" in SRC and "def _clave_elemento(e)" in SRC)
check("...y la caja de códigos muestra cuáles ya tienen elementos auditados",
      '"auditados"' in SRC and '"con_auditoria"' in SRC and "auditado(s)" in JS)
check("la caja de códigos: estado y fecha pegados al código, y un solo check general",
      JS.index("'<span class=\"cod\">'") < JS.index("'<span class=\"f\">'") < JS.index("'<span class=\"d\">'")
      and 'id="audCcTodos"' in HTM and "todos.indeterminate = marcados > 0" in JS)
check("el alcance elegido se guarda, para poder decir de qué códigos salió la muestra",
      "ADD COLUMN ccs TEXT[]" in open(os.path.join(ROOT, "armahub", "migrations",
                                                   "119_auditorias_ccs.sql"), encoding="utf-8").read()
      and '"ccs": r[17] or []' in SRC and "a.ccs.slice(0, 6)" in JS)
check("el selector de origen se fue del formulario",
      'id="audOrigen"' not in HTM and "audOrigen" not in JS)
check("...y el alcance es solo los codigos de control: la caja de tipo/piso/ciclo ya no existe",
      "$('audAlcance')" not in JS and 'id="audAlcance"' not in HTM
      and "/auditorias/universo" not in JS)
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
check("...los hallazgos van primero en el informe", 'orden = {"hallazgo": 0' in SRC)
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
# LA COBERTURA SE FUE DE LA PANTALLA (20-oct). El usuario: «están un poco raros los
# indicadores y no se entiende sobre qué se están tomando los porcentajes… mejor mostrar
# cantidad de elementos auditados, cantidad de ítems auditados, cantidad de hallazgos».
# El endpoint queda (lo usa el informe); el detalle ya no lo llama, que además era la
# parte lenta de abrir una auditoría.
check("el detalle ya no pide la cobertura ni la pinta",
      'aud["cobertura"] = cobertura(' not in SRC and "function pintarCobertura()" not in JS
      and 'id="audCobertura"' not in HTM and ".audgrid" not in HTM)
check("...y trae tres cuentas en su lugar: elementos, ítems, hallazgos",
      'aud["resumen"] = {' in SRC and '"elementos_auditados"' in SRC
      and '"items_auditados"' in SRC and '"hallazgos": sum(int(e.get("items_malos")' in SRC
      and "'ítems auditados'" in JS and "'elementos auditados'" in JS)
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
      "def _avisar_auditoria_nueva(" in SRC and "asignada · %s" in SRC
      and "Cubicación incluida en una auditoría" in SRC
      and 'aud["correo"] = _avisar_auditoria_nueva(aud, request)' in SRC)
check("...los dos ven quién audita, quién es auditado y el plazo",
      '"Audita: <b>%s</b>" % audita' in SRC and "Auditado: <b>%s</b>" in SRC
      and "Fecha de asignación: <b>%s</b> · Plazo de cierre: <b>%s</b>" in SRC)
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
# Los chips de tipo/piso/ciclo eran el alcance de ArmaHub y se fueron con el (15-oct).
# `marcar` sigue siendo la forma de sumar con clic simple donde haya chips.
check("el clic simple suma (no exige Ctrl): la regla sigue escrita una vez",
      "function marcar(lista, valor)" in JS and "alternar" not in JS)
check("los chips de ESTADO de los codigos de aSa eligen, no filtran",
      "EL CHIP ELIGE, NO FILTRA" in JS and "function estadosDisponibles()" in JS)
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

print("\n7b2. Lo que se lee del nombre del código (y el auditor completa sólo los raros)")
# «Si puedes derivarlo del nombre y es fácil, mucho mejor: así completas los raros
# solamente» (6-oct). Los ejemplos son los de su pantalla y de las 12.000 descripciones.
U = A._ubicacion_desde_nombre
check("«LC S1 C5 Lourdes» + ElementDesc «LCIELO» → losa de cielo, piso S1, ciclo C5",
      U("LC S1 C5 Lourdes", "LCIELO") == {"sector": "LCIELO", "piso": "S1", "ciclo": "C5"})
check("«Elev P3 C3 Basilica» + «ELEV» → elevación, P3, C3",
      U("Elev P3 C3 Basilica", "ELEV") == {"sector": "ELEV", "piso": "P3", "ciclo": "C3"})
check("«L Fund C5» + «L Fund» → fundación, sin piso, C5",
      U("L Fund C5", "L Fund") == {"sector": "FUND", "piso": "", "ciclo": "C5"})
check("«ELEV. 10°P (CICLO 1)» → elevación, P10, C1 (las formas con grado y la palabra CICLO)",
      U("ELEV. 10°P (CICLO 1)", "") == {"sector": "ELEV", "piso": "P10", "ciclo": "C1"})
check("«ELEV 1°SUBT. (CICLO B4)» → S1 y el ciclo tal cual lo escribieron",
      U("ELEV 1°SUBT. (CICLO B4)", "") == {"sector": "ELEV", "piso": "S1", "ciclo": "B4"})
check("«VC - P4 C3» → viga de cielo, P4, C3", U("VC - P4 C3", "") == {"sector": "VCIELO", "piso": "P4", "ciclo": "C3"})
check("lo ambiguo NO se adivina: «VIGAS+LOSAS P2» deja el tipo vacío (y lee el piso)",
      U("VIGAS+LOSAS P2", "") == {"sector": "", "piso": "P2", "ciclo": ""})
check("«BARRAS STOCK» o «Solicitud Fierro»: nada que leer", U("BARRAS STOCK", "") == {"sector": "", "piso": "", "ciclo": ""}
      and U("Solicitud Fierro", "") == {"sector": "", "piso": "", "ciclo": ""})
check("«LOSAS C2°P (CICLO 2)»: el C2°P es el piso 2, no el ciclo; el ciclo es el 2 de CICLO",
      U("LOSAS C2°P (CICLO 2)", "") == {"sector": "LCIELO", "piso": "P2", "ciclo": "C2"})
check("se aplica al armar la muestra de aSa, y en pantalla lo leído se ve como lectura, no como dato",
      'e.update(_ubicacion_desde_nombre(descr, e["estructura"]))' in SRC
      and "function celdasUbicacionTexto(" in JS and 'class="audderiv"' in JS and ".audt td.audderiv{" in HTM)

print("\n7b3. La línea del elemento no es una barra")
# aSa manda dentro del CC una línea por elemento (sin marca, sin φ, cantidad 1, el peso del
# conjunto). Contaba doble los kilos y salía como fila vacía en la grilla (6-oct).
LINEA = {"CtrlCode": "SUP8", "ElementID": "Eje K2 P1", "ElementDesc": "PIEZA 1 EJE K2", "TotalQty": 1.0, "LineWeight": 581.0,
         "LegAngle": "<la><st>LN</st><bc>1</bc><mbr><x>null</x><y>0</y><z>0</z></mbr><cp><t>STD</t><l>null</l><n>1</n></cp></la>"}
BARRA = {"CtrlCode": "SUP8", "ElementID": "Eje K2 P1", "ElementDesc": "PIEZA 1 EJE K2", "BarMark": "12mmA1",
         "BarSizeDescr": "12mm", "TotalQty": 4.0, "LineWeight": 290.5}
check("se reconoce: sin marca y sin diámetro", not A._es_barra(LINEA) and A._es_barra(BARRA))
els = A._elementos_de_items([LINEA, BARRA, dict(BARRA, BarMark="12mmA2")], "SUP8", "PR - EJE K2", None)
check("...no cuenta como barra ni suma sus kilos al elemento (2 barras, 581 kg y no 1162)",
      len(els) == 1 and els[0]["barras"] == 2 and round(els[0]["kg"]) == 581)
check("...y al pedir las barras del elemento tampoco viaja", "if _es_barra(it)" in SRC)

print("\n7c. La ubicación se escribe en la fila del elemento abierto")
# 6-oct: la barra «Dónde está» sobre la grilla de barras estaba fuera de lugar («son para
# completar, debieran ir en el listado de elementos y no en la grilla»). Los cuatro campos
# van en la fila del elemento que se está revisando, y se guardan al salir del campo.
check("los cuatro campos van en la fila, no en una barra aparte",
      "function celdasUbicacion(" in JS and "data-campo=\"sector\"" in JS
      and "campo('piso', e.piso) + campo('ciclo', e.ciclo) + campo('eje', e.eje)" in JS
      and 'id="audUbic"' not in HTM and 'id="audUbGuardar"' not in HTM)
check("...sólo en las auditorías de aSa y sólo en la fila abierta",
      "(esAsa && abierto ? celdasUbicacion(e)" in JS)
check("...se guardan al salir del campo, sin repintar la lista (el foco se quedaría sin dueño)",
      "inp.addEventListener('change', guardarUbicacion);" in JS and "No se repinta la lista" in JS)
check("...y el clic en un campo no vuelve a abrir el elemento",
      "ev.stopPropagation()" in JS and "campos de ubicación no llega acá (stopPropagation)" in JS)
check("...diciendo por qué están vacíos", "aSa no trae tipo, piso ni ciclo" in JS)
check("el tipo se ofrece de la lista del backend, no de una copia en el navegador",
      "BASE.sectores" in JS)
# EL DETALLE VA DEBAJO, A LO ANCHO (28-oct). Las dos columnas comprimian la muestra con los
# ejes cortados; el usuario: «el detalle segun lo que seleccione, en el mismo cuadro pero
# abajo».
check("con un elemento abierto, el detalle va DEBAJO de la muestra, a lo ancho: nada de dos columnas",
      'id="audCols"' in HTM and ".audcols.abierta{display:grid;" not in HTM
      and "function mostrarRevision(" in JS and "classList.toggle('abierta'" not in JS)

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
print("\n7c1. Cuando la reconstrucción no cuadra, se usa EL TRAZO QUE EXPORTÓ aSa")
# El export RDX del catálogo de aSa trae la polilínea de cada figura con sus lados
# nombrados; las medidas de la barra llegan con las mismas letras, así que el trazo se
# estira a la medida real. La topología la declara aSa, que es la parte que la
# reconstrucción tiene que deducir de los vectores. De respaldo y no al revés porque,
# medido sobre las 83 figuras del muestreo que están en el RDX, la reconstrucción cuadra en
# 58 y el trazo en 36: el trazo endereza los lados curvos y no trae los arcos del gancho.
check("el elemento pide a la base el trazo de las figuras que trae, no el catálogo entero",
      "SELECT codigo, puntos, lados FROM asa_figuras_catalogo WHERE codigo = ANY(%s)" in SRC)
check("...y la elección la hace el backend, en un solo lugar",
      "def mejor_eje(" in SRC and '"eje": mejor_eje(it, lados["dims"])' in SRC
      and "from .figura_asa import figura_de, trazo_de_catalogo" in SRC)
check("...primero la reconstrucción; el trazo sólo si aquélla no cuadra",
      'if eje.get("ok") or eje.get("tridimensional"):' in SRC
      and 'return alterna if (alterna and alterna.get("ok")) else eje' in SRC)
check("una figura TRIDIMENSIONAL se deja como está: el trazo plano taparía ese aviso",
      "taparía justamente el aviso" in SRC)
check("la pantalla dice de dónde salió el dibujo, sin repetir la decisión",
      "f.eje.fuente === 'catalogo_asa'" in JS and "audfigfte" in JS and "audfigfte" in HTM
      and "svgTrazoAsa" not in JS)

print("\n7c0. El flujo: el auditado corrige, el sistema comprueba")
# EL AUDITOR YA NO VERIFICA (8-oct). Lo sacó el usuario: «el auditor no debe verificar la
# corrección, es responsabilidad del auditado». Y lo que comprueba que se hizo no es una
# persona: es el sistema, volviendo a pedirle la barra a aSa.
check("la corrección es por ITEM, igual que el hallazgo",
      '@router.put("/auditorias/{auditoria_id}/items/{item_id}/correccion")' in SRC
      and '@router.get("/auditorias/mias/items")' in SRC)
check("...la declara cualquier cubicador; si no es el dueño, al dueño le llega aviso (21-oct)",
      "Esta corrección es de quien cubicó el elemento." not in SRC
      and "_avisar_si_ajeno(user, cubico," in SRC)
check("...con el texto de la línea, obligatorio al resolver (6-nov)",
      "MIN_NOTA = 10" in SRC and "raise HTTPException(status_code=400, detail=FALTA_NOTA)" in SRC
      and "nota_correccion" in SRC)
check("decir «hice uno nuevo» obliga a decir CUÁL",
      "Si se hizo un código nuevo, hay que decir cuál" in SRC)
check("...porque ése es el único caso que el sistema NO puede comprobar solo",
      "la barra vieja va" in SRC and "NO puede" in SRC)
check("el estado del elemento se DERIVA de sus barras, no se elige",
      "def _accion_de_items(" in SRC
      and 'return "corregida" if corregidas >= malas else "pendiente"' in SRC)
check("y «verificada» la pone la comprobación, no una persona",
      "verificadas >= malas" in SRC and "comprobar es del sistema" in SRC)

print("\n7c0b. Quien cubicó en aSa no se llama como su correo")
# Las 47 barras por corregir que hay hoy están todas a nombre de «Nlopez»: con el correo
# no le llegaban a nadie. El login de aSa es la inicial del nombre pegada al apellido.
check("se deriva el login de aSa desde el nombre y el apellido",
      "def alias_de(" in SRC and "def alias_cubicador(" in SRC)
check("...y está medido: calza con los 7 cubicadores y no se equivoca con ninguno",
      "calza con los 7 cubicadores que están en la plataforma" in SRC)
check("...lo usan las dos listas, no sólo la nueva",
      SRC.count("alias_cubicador(cur, email)") >= 3)
check("el valor esperado viaja con la revisión, estructurado y no como texto",
      "esperado: Optional[dict] = None" in SRC and "esperado = EXCLUDED.esperado" in SRC)
check("...y vuelve al reabrir el elemento, junto con en qué va la corrección",
      '"esperado": r[5] or {}' in SRC and '"corregido": bool(r[6])' in SRC)

print("\n7c0c. El panel del auditado")
check("una fila por BARRA, no un botón por elemento",
      "function filaAccion(" in JS and "var lin = 'i' + b.item_id" in JS)
check("...dice qué encontró el auditor y qué DEBERÍA decir",
      "function _esperadoTxt(" in JS and "Debería decir" in JS)
check("...y el plazo vencido se ve en la lista de auditorías, aunque todavía no dispare nada",
      "class=\"venc\" title=\"Pasó el plazo\"" in JS)
check("lo que aSa dijo se muestra aparte de lo que declaró la persona, pero todo resuelto dice «Resuelto»",
      "Editada en aSa" in JS and "Idéntica en aSa" in JS and "Sin comprobar" in JS
      and "Comprobada" not in JS and "corregida: 'Resuelto', verificada: 'Resuelto'" in JS)

print("\n7c0d. El POR QUÉ es del auditado, por ITEM, y se elige en la matriz")
# LO PIDIÓ EL USUARIO (8-oct): «lo del ishikawa sería bueno sacarlo de la auditoría y
# dejarlo para que el cubicador que responde clasifique... como es por ITEM creo debiera ser
# un ishikawa por item y NO DEBIERA MEZCLARSE con el ishikawa de los reclamos».
check("el auditor ya no elige la causa en su formulario",
      "LA CAUSA YA NO VIENE ACÁ" in SRC
      and "SET hallazgo = %s, texto = %s, causa = %s" not in SRC
      and "audRevCausa" not in JS and "audRevCausa" not in HTM)
check("la clasifica el auditado, por barra, por su propio verbo",
      '@router.put("/auditorias/{auditoria_id}/items/{item_id}/causa")' in SRC
      and "def clasificar_item(" in SRC)
check("...y clasificar no es declarar que se corrigió: son dos momentos distintos",
      "se puede clasificar antes de corregir" in SRC)
check("quién puede tocar una barra se decide en UN solo lugar",
      "def _barra_del_auditado(" in SRC
      and SRC.count("_barra_del_auditado(cur, auditoria_id, item_id, user)") >= 2)
check("no se mezcla con el Ishikawa de los reclamos, y está dicho por qué",
      "ningún reporte de reclamos lee esta tabla" in SRC)
check("el Pareto cuenta BARRAS, que es donde vive la causa",
      "EL PARETO SE CUENTA SOBRE BARRAS" in SRC and "FROM auditoria_items i" in SRC)
check("...y lo que falta clasificar se ve en vez de esconderse",
      "(sin clasificar)" in SRC and '"sin_causa"' in SRC)

print("\n7c0e. La matriz bonita, no un desplegable")
# El usuario: «volviste al desplegable y no al modal con la matriz bonita». Son 35
# sub-causas en seis M: en un <select> no se leen, y por eso nadie clasificaba.
check("se abre el MISMO modal de los reclamos, no otro",
      "abrirIshikawaModal('auditoria')" in JS
      and "_desdeLaPantalla" in DEJS and "_haciaLaPantalla" in DEJS)
check("...hablándole por las dos funciones de siempre",
      "global.audIshikawa" in JS and "global.audCausaElegida" in JS)
check("el id del área de la matriz viaja con el catálogo (si no, sale vacía)",
      '"causas_area": causas_area' in SRC and "BASE.causas_area" in JS)
check("la causa se ve en la fila de la barra, y se puede cambiar; el botón dice RCA, no «Clasificar»",
      "td.audrca" in HTM and "'data-causa', b.item_id" in JS and ">Clasificar<" not in JS)

print("\n7c0f. El botón dice Hallazgo, no «NC»")
check("en el veredicto de cada barra",
      ">Hallazgo</button>' +" in JS and 'title="No conforme">NC<' not in JS)
check("el auditor ya no tiene botones de corregir ni de verificar",
      'data-acc="corregida"' not in JS and 'data-acc="verificada"' not in JS
      and "Resumen Hallazgos" in JS)

print("\n8a. El flujo: ENVIAR es lo que le pasa el trabajo al auditado")
# Hasta el 8-oct «cerrada» significaba «se revisó el último elemento», y el auditado veía
# sus barras en cuanto el auditor guardaba CADA elemento. El usuario lo fijó: «al enviar,
# recién ahí el cubicador auditado puede accionar sobre la auditoría».
check("cuatro estados, y revisar todo YA NO cierra",
      A.ESTADOS == ("planificada", "en_curso", "enviada", "cerrada")
      and A.estado_de(5, 5) == "en_curso"
      and A.estado_de(5, 5, True, 0, 3) == "enviada"
      # RESOLVER TODO TAMPOCO CIERRA (20-oct): el cierre lo aprieta quien respondió.
      and A.estado_de(5, 5, True, 3, 0) == "enviada"
      and A.estado_de(5, 5, True, 3, 0, True) == "cerrada"
      # La que no dejó nada que resolver sí se cierra sola al enviar.
      and A.estado_de(5, 5, True, 0, 0) == "cerrada")
check("...y el cierre a mano manda sobre todo lo demás",
      A.estado_de(2, 5, False, 0, 0, True) == "cerrada")
check("no se envía a medio revisar, y lo decidió el usuario",
      "una auditoría se envía " in SRC and "Faltan %d de %d elementos" in SRC)
check("...ni dos veces", "Esta auditoría ya fue enviada." in SRC)
check("enviar, reabrir y cerrar son del auditor, en un solo lugar",
      "def _solo_el_auditor(" in SRC
      and SRC.count("_solo_el_auditor(cur, auditoria_id, user)") >= 3)
# El plazo de corrección NO se negocia auditoría por auditoría: es una regla de 24 horas
# que arranca al enviar. El panel lo informa —quien envía tiene que saber a qué está
# comprometiendo a la otra persona— pero no lo pregunta.
check("el plazo del auditado arranca AL ENVIAR y no se negocia",
      "class EnvioBody" in SRC and "audEnvioPlazo" not in JS
      and "Tendrá 24 horas para corregir" in JS)
# ENVIAR PIDE UNA CONFIRMACIÓN Y LISTO (28-oct). El panel verde repetía lo que la franja de
# arriba ya dice y salía DEBAJO del botón, así que había que bajar a buscarlo. El usuario:
# «debiera pedir confirmación y listo, no mostrar ese menú verde».
check("...y se confirma en una línea: a quién le llega y que lo marcado queda firme",
      "global.confirm('Enviar '" in JS and "Le llega a: " in JS
      and "queda firme" in JS and 'id="audEnvio"' not in HTM and "audEnvioOk" not in JS)
check("...y la cuenta regresiva de «Mis correcciones» se fue con ella; el plazo vive en la lista",
      "function _cuantoFalta(" not in JS and "a.plazo < new Date().toISOString()" in JS)
check("un aviso por persona al enviar, no uno por elemento mientras se revisa",
      "A QUIÉN LE TOCA QUÉ, para avisar UNA vez" in SRC)
check("antes del envío el auditado no puede accionar, y se valida en el BACKEND",
      "def _solo_si_enviada(" in SRC and SRC.count("_solo_si_enviada(cur, auditoria_id)") >= 3)
check("...y su lista sólo trae auditorías enviadas", "AND a.enviada_el IS NOT NULL" in SRC)
check("reabrir deshace el envío, con motivo, y queda registrado",
      '@router.post("/auditorias/{auditoria_id}/reabrir")' in SRC
      and "auditoria_reabierta" in SRC)
check("el plazo no vence antes del envío: nadie podía corregir todavía",
      "a.estado !== 'cerrada' && a.enviada && a.plazo" in JS)

print("\n8b. La comprobación: el sistema va a mirar la barra a aSa")
# «Debería generar una actualización o una búsqueda de esas barras (para no lanzar
# actualización total), cosa de que traiga la data al día» — y no hizo falta construirla:
# `_items_de` ya pide UN código en vivo, que es como el auditor abre un elemento.
check("se pide UN código, en vivo, no una sincronización entera",
      "def _barra_hoy(" in SRC and "_items_de(cc)" in SRC)
check("la comparación es PURA y se prueba sin base ni red", "def comparar(" in SRC)
check("ESPECÍFICA cuando el auditor corrigió los números",
      A.comparar({"cant": 103}, {"cant": 100}, {"cant": 103})[0] == "ok"
      and A.comparar({"cant": 103}, {}, {"cant": 100})[0] == "sigue_igual")
check("...campo por campo, y un lado que la barra ya no tiene NO calza",
      A.comparar({"lados": {"A": 1200}}, {}, {"lados": {"A": 1200.4}})[0] == "ok"
      and A.comparar({"lados": {"B": 50}}, {}, {"lados": {"A": 1200}})[0] == "sigue_igual")
check("DÉBIL cuando sólo hay un comentario: dice si la barra cambió",
      A.comparar({}, {"cant": 100}, {"cant": 103})[0] == "ok"
      and A.comparar({}, {"cant": 100}, {"cant": 100})[0] == "sigue_igual")
check("TRES resultados: una caída de aSa no es una corrección no hecha",
      A.comparar({}, {}, {"cant": 1})[0] == "no_aplica"
      and A.comparar({"cant": 1}, {}, None, "nuevo")[0] == "no_aplica"
      and "reintentable" in SRC)
# LA BARRA QUE YA NO ESTÁ EN SU CÓDIGO SE EDITÓ (6-nov), como en la revisión de barras; en un
# código NUEVO es otra cosa: la marca la escribió quien resolvió.
check("una barra que ya no está en su código cuenta como editada en aSa; en un código nuevo, no",
      A.comparar({}, {"cant": 1}, None)[0] == "ok"
      and A.comparar({}, {"cant": 1}, None, "nuevo")[0] == "no_aplica")
check("ÁNGULOS Y MANDRIL también cuentan: un ángulo cambiado ya no sale «idéntica» (6-nov)",
      A.comparar({}, {"cant": 5, "angulos": [90, 90]}, {"cant": 5, "angulos": [90, 135]})[0] == "ok"
      and A.comparar({}, {"cant": 5, "angulos": [90, 90]}, {"cant": 5, "angulos": [90.4, 90]})[0] == "sigue_igual"
      and A.comparar({}, {"cant": 5, "radio": 40}, {"cant": 5, "radio": 60})[0] == "ok"
      and A.comparar({}, {"cant": 5}, {"cant": 5, "angulos": [90], "radio": 40})[0] == "sigue_igual")
check("el ANTES se guarda al auditar y NO se pisa al volver a guardar",
      "dato_original = COALESCE(auditoria_items.dato_original" in SRC)
check("decir «lo rehice en otro código» obliga a decir cuál, y con qué marca",
      "item_nuevo" in SRC and "data-accnuevo=" in JS and "data-amarca=" in JS
      and "Falta el código nuevo" in JS)
check("el reloj comprueba después del sync y con tope de llamadas",
      "_auditorias_al_dia()" in SCHED and "TOPE_COMPROBAR" in SCHED)
# LA COMPROBACIÓN CORRE AL CERRAR (20-oct), no a pedido ni de noche: «vamos a reemplazar
# la revisión automática por un botón que el usuario marque como resuelto».
check("la comprobación corre al cerrar y ya no hay botón para pedirla",
      "def _chequear_lo_resuelto(" in SRC and "function comprobarEnAsa(" not in JS
      and "audBtnComprobar" not in JS)

print("\n8c. El cierre se deriva, con una válvula a mano")
check("lo resuelto es lo que dijo quien lo hizo, no lo que comprobó un barrido",
      "COUNT(*) FILTER (WHERE i.desestimado OR i.corregido)" in SRC
      and "COUNT(*) FILTER (WHERE i.desestimado OR i.verificado = 'ok')" not in SRC)
check("...y los comentarios de elemento sin responder cuentan como abiertos",
      "abiertas = (abiertas or 0) + (cur.fetchone()[0] or 0)" in SRC)
check("hay cierre a mano con motivo, para lo que el sistema no puede comprobar",
      '@router.post("/auditorias/{auditoria_id}/cerrar")' in SRC
      and "Di por qué se cierra sin resolver" in SRC)
check("las auditorías ya cerradas con la regla vieja no se reabren",
      "se revisaron todos los " in MIG138)

print("\n8d. El auditado puede DESCARTAR un hallazgo, y el auditor replicar")
# «El cubicador auditado podría resolver que la observación del auditor no es la correcta,
# pero debe tener un botón que le permita marcar como lista la barra donde desestime la
# corrección». Con motivo obligatorio: es todo el valor de la trazabilidad que se busca.
check("se puede descartar, con motivo obligatorio",
      '/desestimar")' in SRC and "Di por qué no corresponde" in SRC)
check("...y entonces la barra deja de estar abierta, pero NO desaparece",
      '"desestimadas"' in SRC and "barras_desestimadas" in SRC)
check("...porque si saliera del conteo, el auditado mejoraría su propio indicador",
      "mejorar su propio indicador" in SRC)
check("el «no aplica» se justifica en la línea, y se dice que lo lee quien auditó",
      "¿por qué no aplica?" in JS and "Di por qué no aplica: lo va a leer quien auditó." in JS)
check("el auditor NO valida los descartes: tiene derecho a réplica",
      '/objecion")' in SRC and "derecho a réplica, no deber de validar" in SRC)
check("...y las dos posturas quedan escritas", "El motivo del descarte no se borra" in SRC)
check("si el auditor objeta, la barra vuelve a contar como abierta",
      "SET desestimado = FALSE, objecion = %s" in SRC)

print("\n8e. Lo que ya se está fabricando no espera el flujo")
check("hay un aviso por CÓDIGO que entró a fabricación",
      "def avisar_fabricacion(" in SRC and 'ESTADO_FABRICANDO = "Processed"' in SRC)
check("...le llega al auditor Y a quien cubicó, sin esperar el envío",
      "para que apure la auditoría" in SRC or "para que apure" in SRC)
check("...una vez por código, no todos los días",
      "aviso_fabrica_el" in SRC and "ix_aud_elem_cc_aviso" in MIG139)
check("...y va por elemento, porque una auditoría tiene diez códigos",
      "DROP COLUMN IF EXISTS aviso_fabrica_el" in MIG139)
check("se ve en la fila de la barra del auditado", '"fabricando"' in SRC and "EN FÁBRICA" in JS)

print("\n8f. El auditor corrige los números donde los ve")
check("las celdas de una barra con hallazgo son editables",
      "function celdaEd(" in JS and "td.audedc" in HTM)
check("...sólo las marcadas con hallazgo", "v.conforme !== false" in JS)
check("lo pedido viaja estructurado, no como texto",
      "function _esperadoDe(" in JS and "esperado: Optional[dict]" in SRC)
check("...y en las unidades de aSa, no en las de la pantalla",
      "function _aMm(" in JS and "function _espAcm(" in JS)
check("el ANTES de la barra viaja con la revisión",
      "function _originalDe(" in JS and "original: Optional[dict]" in SRC)
check("en ArmaHub la comprobación contra aSa no aplica, y se dice",
      "hoy sólo " in SRC and 'origen != "asa"' in SRC)

print("\n7c2. El largo que se audita es la SUMA DE LOS PARCIALES")
# Lo cazó el cubicador que hizo la primera auditoría: el formulario mostraba 2.576 donde su
# cubicación dice 2.640. aSa manda dos largos y no son lo mismo — el teórico es la suma de
# los lados (medidos al vértice, como cubica ArmaHub) y el de corte descuenta el doblez.
# Medido sobre 318 barras: LengthTheor == suma de lados en las 318.
check("se piden los dos largos a aSa", '"LengthCut", "LengthTheor"' in SRC)
check("...y el que se audita es el teórico, que es la suma de los parciales",
      '"largo": it.get("LengthTheor"), "largo_corte": it.get("LengthCut")' in SRC)
check("...el de corte viaja igual, para poder explicar la diferencia",
      "la diferencia es lo que se come el doblez" in JS and "f.corte" in JS)
check("...y queda escrito por qué no son lo mismo", "descuenta lo que se come cada doblez" in SRC)

print("\n7c3. El formulario se puede leer")
check("las barras se ordenan como en el resto de la plataforma (MH, MV, TR, …)",
      "sql_tipologia_order(\"marca\")" in SRC and "from .orden import sql_tipologia_order" in SRC)
check("el encabezado queda anclado de verdad (sin z-index las celdas lo tapaban)",
      "z-index:3" in HTM and "position:sticky; top:0" in HTM)
check("la grilla separa las columnas", "border-right:1px solid #f2f4f7" in HTM
      and "nth-child(even)" in HTM)
check("un lado chico no desaparece del dibujo", "MIN_LADO_REL = 0.18" in JS
      and "function _conMinimo(" in JS and "no para medirla" in JS)

print("\n7d0. La lista de códigos se ordena por UNA sola fecha: la del pedido")
# Lo cazó el usuario mirando la pantalla (8-oct): el SUBM se pidió el 26 de agosto y
# despachó el 2 de octubre, y aparecía tercero en la lista, sobre códigos pedidos un mes
# después. Un código despachado se cubicó ANTES que uno que sigue abierto —tuvo tiempo de
# fabricarse y salir—, así que va más abajo, no más arriba.
check("ordena por la fecha del pedido, sin mezclarla con la de despacho",
      "order_date DESC NULLS LAST" in SRC
      and "CASE WHEN COALESCE(estado,'') = %s THEN proj_ship_date END" not in SRC)
# Y DESPUÉS DE ARREGLAR LA FECHA SEGUÍA MAL (8-oct). Con una sola fecha la columna ya bajaba
# derecho, pero los despachados quedaban intercalados entre los vivos y en la práctica no se
# eligen juntos: lo que se revisa es lo que todavía se puede atajar. Van en bloque al final.
check("y los despachados van en bloque AL FINAL, no intercalados",
      "ORDER BY (COALESCE(estado,'') = %s), order_date DESC NULLS LAST" in SRC
      and "PRIMERO LO QUE NO SALIÓ, DESPUÉS LO DESPACHADO" in SRC)
# ELEGIR POR ESTADO Y NO CÓDIGO POR CÓDIGO. Con cuarenta y cinco códigos, marcar a mano lo
# que casi siempre es lo mismo es trabajo que la pantalla puede hacer sola.
# EL CHIP ELIGE, NO FILTRA (corregido el 8-oct). Primero lo puse a filtrar y el usuario lo
# probo: en una barra de seleccion, apretar «Open 40» tiene que MARCAR esos cuarenta, no
# esconder los demas. Filtrar lo hace el buscador de al lado. Peor: el filtro solo se
# aplicaba si ademas habia texto en el buscador, asi que los chips parecian no hacer nada.
check("el chip de estado MARCA los codigos de ese estado, no los filtra",
      'id="audCcEstados"' in HTM and "function pintarCcEstados(" in JS
      and "function deEstado(" in JS and "CC_EST" not in JS)
check("...y su color dice la verdad: ninguno, algunos o todos marcados",
      "marcados === ccs.length ? ' on' : ' algunos'" in JS
      and ".audcce.algunos{" in HTM and ".audcce.on{" in HTM)
check("...y queda escrito por qué, que es lo que se vuelve a equivocar",
      "ORDENADOS POR LA FECHA DEL PEDIDO, UNA SOLA PARA TODOS" in SRC
      and "tuvo tiempo de fabricarse y despacharse" in SRC)
check("la fecha de despacho no se pierde: viaja aparte con sus propios días",
      '"dias_despacho": dias_desp' in SRC and "dias_desp = (hoy - despacho).days" in SRC)
check("...y es ESA la que decide si el código se pinta por viejo, no la del pedido",
      "bool(dias_desp is not None" in SRC)
check("la pantalla muestra la fecha que ordena, no otra",
      "ddmm(c.fecha)" in JS and "fecha_ref" not in JS)

print("\n7d1. Elegir el alcance: los despachados también se ofrecen")
# «Debiéramos considerar también los despachados, pero que el cubicador elija; el sistema
# debiera ordenar por fechas, del CC más nuevo al más antiguo, así queda a criterio del
# usuario hasta dónde revisamos» (7-oct).
check("ya no se esconden los despachados: sólo quedan fuera los anulados",
      "AND COALESCE(estado,'') <> %s" in SRC and "LOS DESPACHADOS TAMBIÉN SE OFRECEN" in SRC)
check("la lista va del más nuevo al más antiguo (el orden, en el bloque 7d0)",
      "ORDER BY order_date DESC NULLS LAST" in SRC)
check("cada código dice cuántos días lleva desde que se pidió",
      '"dias": dias' in SRC and "dias = (hoy - pedido).days" in SRC)
check("...y los despachados, cuántos desde que salieron, que es lo que los pinta",
      '"dias_despacho": dias_desp' in SRC and "DIAS_DESPACHO_ANTIGUO = 30" in SRC
      and "bool(dias_desp is not None" in SRC)
check("...y la pantalla lo pinta, sin prohibirlo", "c.antiguo ? ' viejo' : ''" in JS
      and ".audcc.viejo{" in HTM and "se pueden elegir igual" in JS)
check("el total ya cuenta a los despachados, que ahora se pueden elegir",
      "vivos = (vivos or 0) + (despachados or 0)" in SRC)

print("\n7d2. El estado del código de control, en la muestra")
# «En el resumen de elementos a auditar sería ideal que aparezca el estado del CC» (7-oct).
# La muestra se sortea entre los NO despachados, pero el estado cambia después: un código
# Open el lunes sale el jueves y la auditoría ya estaba creada.
check("el detalle trae el estado del código y su fecha de despacho",
      "p.estado, p.proj_ship_date" in SRC and "LEFT JOIN asa_pedidos p ON p.control_code = e.cc" in SRC
      and '"estado_cc": e[28]' in SRC and '"despachado": (e[28] or "") == ESTADO_DESPACHADO' in SRC)
check("...la lista lo muestra como columna, sólo en las auditorías de aSa",
      "function celdaEstadoCc(" in JS and "celdaEstadoCc(e) : ''" in JS)
check("...y el despachado va en rojo, con la fecha y el porqué",
      "Ya se despachó" in JS and "auditarlo llega tarde" in JS and ".audt td.audesc.desp" in HTM)
check("queda dicho por qué una auditoría de ArmaHub NO muestra código",
      "EN ArmaHub NO HAY CÓDIGO DE CONTROL" in JS)

check("la tabla tiene encabezado para el código y para su descripción, con el elemento entre medio",
      "'<th>Elemento</th>' + (esAsa ? '<th>Descripción del código</th>' : '')" in JS
      and "(esAsa ? '<th>Código</th><th title=" in JS)
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

print("\n12b. Cómo están escritos los correos (7-oct)")
# «No me sirve el código: debe ser código más elemento más la descripción del código, que
# dice piso, ciclo y si es elevación o qué. Lenguaje formal, tercera persona. Debe decir
# quién audita. Y al auditado, que entregue los planos y verifique versiones en BShark.»
E = {"cc": "SUQC", "nombre": "L101", "descr_cc": "LC S1 C5 Lourdes", "eje": "L101"}
check("el elemento se identifica entero: código · elemento · descripción del código",
      A._elemento_txt(E) == "SUQC · L101 · LC S1 C5 Lourdes")
check("...y si falta algo, no deja basura ni un separador suelto",
      A._elemento_txt({"cc": "SUQC", "eje": "L101"}) == "SUQC · L101"
      and A._elemento_txt({}) == "(sin identificar)")
check("las fechas van en dd/mm/aaaa, no en formato de base de datos",
      A._fecha_larga("2026-10-21") == "21/10/2026" and A._fecha_larga(None) == "sin plazo")
check("las personas van por su nombre, no por su correo",
      "def _nombres(" in SRC and "def _quien(" in SRC
      and "TRIM(COALESCE(nombre,\'\') || \' \' || COALESCE(apellido,\'\'))" in SRC)
check("al auditado se le pide entregar los planos y verificar versiones en BShark",
      "Debe entregar al auditor los planos" in SRC and "plataforma <b>BShark</b>" in SRC
      and "versiones vigentes" in SRC)
check("...y recibe UN correo por persona, con sólo SUS elementos",
      "for cub in auditados:" in SRC and "mios = [e for e in elementos" in SRC
      and "Elementos de su cubicación incluidos en la muestra" in SRC)
check("no quedan tratos informales ni segunda persona en los correos",
      "Te asignaron" not in SRC and "La lanzó" not in SRC and "hazlos llegar" not in SRC
      and "Entra a ArmaHub" not in SRC)

print("\n12c. El correo del resultado, al cerrar la auditoría")
# «Al terminar la auditoría debe enviarse también un correo a los 3 con un resumen del
# resultado.»
check("existe y va a los tres de una vez",
      "def _avisar_auditoria_cerrada(" in SRC
      and "destinatarios = sorted({x for x in ya if x} | {c for c in _correo_administracion() if c})" in SRC)
check("...lleva el resultado contado: revisados, conformidad y los cuatro niveles",
      "de conformidad." in SRC and "Conformes: <b>%d</b> · Observaciones:" in SRC
      and "Hallazgos: <b>%d</b>." in SRC)
check("el PDF y el correo no repiten la llave «hallazgo» ni lo suman dos veces (residuo de la migración 156)",
      '"hallazgo": (239, 154, 154), "hallazgo"' not in SRC and '"No conformidad menor"' not in SRC
      and 'nc = r.get("hallazgo") or 0' in SRC and '("observacion", "hallazgo", "hallazgo")' not in SRC
      and 'for k in ("conforme", "observacion", "hallazgo"):' in SRC)
check("la alerta de independencia compara el login de aSa con los alias del auditor, no el correo con el login",
      'auditor_alias = set(alias_cubicador(cur, aud.get("auditor") or ""))' in SRC
      and '"conflicto": (e[9] or "").strip() in auditor_alias,' in SRC)
check("...y el detalle de lo que salió mal, con su hallazgo",
      "Elementos con hallazgo:" in SRC and "_NOMBRE.get(e.get(\"hallazgo\")" in SRC)
check("...o dice que no hubo nada, en vez de dejar un hueco",
      "No se detectaron no conformidades." in SRC)
# Lo dispara el CIERRE y una sola vez. Los sitios donde puede cerrarse son tres desde el
# 9-oct: las dos puertas de revisión de siempre y el cierre a mano, que es la válvula para
# lo que el sistema no puede comprobar.
check("lo dispara el cierre, una sola vez: revisar de nuevo algo ya cerrado no reenvía",
      "return estado == \"cerrada\" and antes != \"cerrada\"" in SRC
      # Cada camino que puede cerrar manda el aviso, y los dos conteos van juntos: si
      # alguien agrega un cierre nuevo y se olvida del correo, esto se cae.
      and SRC.count("cerro = _recalcular(cur, auditoria_id)") ==
          SRC.count('aud["correo_cierre"] = _avisar_auditoria_cerrada(aud, request)') >= 4)

print("\n12. El correo de la auditoría nueva: a quién y con qué enlace")
# «Quiero que se envíe un correo a los cubicadores cuando se asigne una auditoría. Debe
# ser a los involucrados. A mí también. Ideal un link para que acceda directo.» (7-oct)
check("el botón del correo lleva a ESA auditoría, no a la pantalla",
      'return "%s/#mod=reclamos&tab=auditorias&aud=%s"' in SRC and "def _enlace_auditoria(" in SRC)
check("...la base sale de APP_URL y, si no está, de la propia petición",
      'os.getenv("APP_URL", "")' in SRC and "str(request.base_url)" in SRC
      and "def crear(body: CrearBody, request: Request" in SRC)
check("...y si no hay ninguna de las dos, el correo va sin botón en vez de con un enlace roto",
      'return "%s/#mod=reclamos&tab=auditorias&aud=%s" % (base, aud_id) if base else ""' in SRC
      and 'if enlace else ""' in SRC)
check("administración va en copia, que es lo que pidió el usuario",
      "def _correo_administracion()" in SRC and "role = ANY(%s)" in SRC
      and '"administracion": r3' in SRC)
# «Por ahora que no copie a Constanza» (7-oct): ella es admin_calidad, así que la copia
# por defecto va sólo a los admin. Y se cambia por variable, sin desplegar.
check("...sólo a los admin, no a todo el que administra calidad",
      'ROLES_COPIA_AUDITORIA = ("admin",)' in SRC
      and "ROLES_COPIA_AUDITORIA" in SRC.split("def _correo_administracion")[1])
check("...y se puede cambiar por variable, sin tocar código",
      'os.getenv("AUDITORIA_COPIA", "")' in SRC and "if fijos:" in SRC)
check("...sin repetirle el correo a quien ya recibió el suyo",
      "ya = set([aud[\"auditor\"]] + auditados)" in SRC and "if c not in ya" in SRC)
check("el correo sigue sin poder tumbar la auditoría", "aud[\"correo\"] = _avisar_auditoria_nueva(aud, request)" in SRC
      and "except Exception as e:\n        return {\"enviado\": False" in SRC)
check("el front abre la auditoría del enlace, una sola vez y limpiando el hash",
      "function auditoriaDelEnlace()" in JS and "aud=(\\d+)" in JS
      and "if (delEnlace) await abrir(delEnlace);" in JS and "replaceState(null, '', limpio" in JS)

print("\nLO DEL AUDITOR QUEDA FIRME, Y EL AUDITADO ACCIONA EN LA BARRA")
# El usuario, 13-oct: «el auditado no tiene acciones. Primero debiera bloquearse lo que
# marcó el auditor, hoy puede mover y editar todo. Segundo debe poder generar la acción
# sobre cada observación: aplica, no aplica. Si aplica debe poder elegir el ISHIKAWA
# desde la matriz, pero debe ser por ITEM, hoy está agrupado».
def _cuerpo(ruta):
    """El cuerpo de un endpoint: desde su decorador hasta el siguiente."""
    tr = SRC.split('@router.put("/auditorias/%s")' % ruta)
    assert len(tr) == 2, ruta
    return tr[1].split("@router.")[0]


def _cuerpo_post(ruta):
    tr = SRC.split('@router.post("/auditorias/%s")' % ruta)
    assert len(tr) == 2, ruta
    return tr[1].split("@router.")[0]


check("escribir lo del auditor pide ser SU auditor y que no esté enviada",
      "def _solo_antes_de_enviar(" in SRC
      and "_solo_el_auditor(cur, auditoria_id, user)" in
          SRC.split("def _solo_antes_de_enviar(")[1][:1200]
      and 'if fila[4]:' in SRC.split("def _solo_antes_de_enviar(")[1][:1200])
check("...en los TRES endpoints que lo escriben, no en uno",
      all("_solo_antes_de_enviar(cur, auditoria_id, user)" in _cuerpo(r)
          for r in ("{auditoria_id}/elementos/{elemento_id}",
                    "{auditoria_id}/elementos/{elemento_id}/revision",
                    "{auditoria_id}/elementos/{elemento_id}/ubicacion")))
# LA PUERTA DE ADMINISTRACIÓN TAMBIÉN TIENE LLAVE (15-oct). `mover_accion` no lo llama
# ninguna pantalla, pero es un PUT abierto: sin esto, cualquiera con sesión dejaba sus
# propias no conformidades en «corregida» por la API, sin RCA.
check("mover la acción a mano es del auditor, del cubicado o de administración",
      "email != auditor and not es_admin and email != cubico" in
      _cuerpo("{auditoria_id}/elementos/{elemento_id}/accion"))
check("objetar un descarte también es del auditor de esa auditoría",
      "_solo_el_auditor(cur, auditoria_id, user)" in
      _cuerpo("{auditoria_id}/items/{item_id}/objecion"))
# QUIÉN PUEDE QUÉ LO DICE EL BACKEND. El front no puede deducir si una barra es «mía»:
# exige comparar el login de aSa de quien cubicó con mi correo, y eso es alias_cubicador.
check("el detalle dice soy_auditor, puedo_editar y, por elemento, mio",
      '"soy_auditor"' in SRC and '"puedo_editar"' in SRC and 'e["mio"]' in SRC
      and "alias_cubicador(cur, user" in SRC.split('aud["soy_auditor"]')[0][-600:])
# EL BUG QUE TUVO ESTO: la fecha de envío viaja como `enviada`, no como `enviada_el`, y
# con el nombre equivocado puedo_editar daba True sobre una enviada.
check("...y puedo_editar mira la clave que existe, no una parecida",
      'not aud.get("enviada")' in SRC and 'not aud.get("enviada_el")' not in SRC)
check("el formulario del auditor se bloquea entero y DICE por qué",
      "function _puedoEditar(" in JS and "function _porQueNoEdito(" in JS
      and 'id="audRevCandado"' in HTM and ".audsololeer" in HTM
      and "if (!_puedoEditar()) { aviso(_porQueNoEdito()); return; }" in JS)
check("la tabla de lo que salió es POR BARRA, no por elemento",
      "function filaAccion(" in JS
      and "malas.length ? malas.map(function (b) { return filaAccion(e, b); }) : [filaComentario(e)]" in JS)
# 9-nov: «el auditado debiera tener algo similar: resumen de los elementos revisados; los que
# tienen hallazgos les hace click y se abre el modal con el detalle. Ese botón de abrir
# resumen me sobra». Y: el RCA va en la acción; sin columnas Elemento ni «Debería decir».
check("después del envío la lista de elementos la ven todos y el clic abre los hallazgos de ESE elemento",
      "$('audDetElems').innerHTML = (AUD.soy_auditor || enviadaYa)" in JS
      and "if (e.accion_estado && _cuentaLineas(e).total) abrirHallazgos(e);" in JS
      and "cols.style.display = (AUD.soy_auditor || enviadaYa) ? '' : 'none';" in JS
      and "audAccTarjeta" not in HTM and "audAccTarjeta" not in JS
      and "MUESTRA_ABIERTA" not in JS and "audVerMuestra" not in JS)
check("...el modal es de un elemento: su nombre arriba y sólo sus barras, sin columna Elemento",
      "var e = (enviada && ACC_EL != null) ? acc.filter(function (x) { return x.id === ACC_EL; })[0] : null;" in JS
      and "_hojaElemento(e, g, c.total > 0 && c.listas >= c.total)" in JS
      and "elemento:" not in JS.split("function filaAccion(")[1].split("function _autoFiguras(")[0])
# 9-nov: «El RCA aparece después, ponlo después de estado. Aparece sólo cuando se marca
# como Resuelto con alguna de las 2 opciones; de lo contrario no se considera».
check("...el RCA va después de Estado y aparece sólo al elegir «Resuelto»; sin «Debería decir»",
      "{ titulo: 'Estado', ancho: 120, clase: 'hojaest' },\n          // EL RCA VIENE DESPUÉS" in JS
      and "{ titulo: 'RCA', ancho: 76, clase: 'audrca'" in JS
      and "tr.classList.toggle('resabierto', modo === 'cc' || modo === 'nuevo');" in JS
      and ".audhoja td.audrca .rcaabierta{display:none;}" in HTM
      and ".audhoja tr.resabierto td.audrca .rcaabierta{display:inline;}" in HTM
      and "data-causa" not in JS.split("function _accionesAud(")[1][:1800]
      and "{ titulo: 'Debería decir'" not in JS and "'<div class=\"revesp\">Debería decir: '" in JS)
check("...y lo de toda la auditoría queda en la página: lo idéntico en aSa, el cierre y por qué no cerró",
      '<div id="audAccAvisos"></div>' in HTM and "var caja = $('audAccAvisos');" in JS
      and "if (AUD.puedo_cerrar) {" in JS.split("function _flujoBotones()")[1][:2500]
      and "var cz = $('audBtnCerrarOk');" in JS.split("function _flujoBind()")[1][:600])
# TRES SALIDAS POR LÍNEA (6-nov): «Resuelto en CC / Resuelto en nuevo CC / No aplica», y
# al final el campo de texto, obligatorio en las tres.
check("cada línea lleva Resuelto en CC | Resuelto en nuevo CC | No aplica, y el texto al final, obligatorio",
      'data-amodo="cc"' in JS and 'data-amodo="nuevo"' in JS and 'data-amodo="nap"' in JS
      and 'class="revnapin" data-anota=' in JS and "texto.length < 10" in JS
      and "data-aplica=" not in JS)
check("el Ishikawa es POR BARRA y abre la MISMA matriz de los reclamos",
      "function clasificarItem(" in JS and "global.abrirIshikawaModal('auditoria')" in JS
      and "item_id: b.item_id" in JS and "window.audIshikawa" in DEJS)
# UN CLIC, SIN PREGUNTAS (20-oct): el «¿se rehizo en otro código?» se fue; si se rehizo, el
# chequeo del cierre lo dice y quien cierra lo confirma.
check("resolver dice dónde: en el mismo código o en uno nuevo, sin diálogos del navegador",
      "async function guardarLinea(" in JS and "cuerpo.cc_nuevo = cc" in JS
      and "global.confirm(" not in JS.split("async function guardarLinea(")[1][:4000]
      and "/correccion'" in JS)
check("los botones salen para cualquier cubicador, sólo si está enviada y no cerrada",
      "function _actuo() { return !!(AUD && AUD.puedo_actuar && _enCurso()); }" in JS
      and "AUD.estado !== 'cerrada'" in JS.split("function _enCurso()")[1][:200])
check("el auditor conserva su derecho a réplica sobre un descarte",
      "data-objetar=" in JS and "AUD.soy_auditor" in JS)

print("\nRESUMEN HALLAZGOS: el auditado cierra su trabajo")
check("la caja se llama Resumen Hallazgos",
      "Resumen Hallazgos" in JS and "Qué salió de esta auditoría" not in JS)
# SIN RCA NO SE DA POR CORREGIDA. Una correccion sin causa arregla la barra y deja el
# problema vivo: el Pareto de causas es lo unico que dice si el error se repite.
check("sin RCA no se puede dar una barra por corregida, y lo rechaza el BACKEND",
      "clasifica por qué pasó (RCA)" in SRC
      and "SELECT causa FROM auditoria_items WHERE id = %s" in SRC)
check("...y la pantalla, al guardar un «Resuelto» sin RCA, abre la matriz y al elegir la causa sigue sola",
      "Primero el RCA: por qué pasó." not in JS and "TRAS_RCA = lin;" in JS
      and "if (sigue && _causaDe(sigue)) await guardarLinea(sigue);" in JS)
check("...pero «no aplica» NO lo pide: ahí no hubo error que explicar",
      "Dejar sin efecto NO la pide" in SRC
      and "if body.corregido:" in SRC.split("clasifica por qué pasó")[0][-700:])
check("«Clasificar» pasa a llamarse RCA", ">RCA</button>" in JS and "sin RCA" in JS)
# EL BOTÓN «RESUELTO» (20-oct). El check «Corregido en aSa» pasó a ser un botón verde que
# se aprieta cuando el cambio ya está hecho en aSa; el hover lo dice.
check("los dos «Resuelto» son botones verdes que quedan encendidos mientras se escribe",
      ">Resuelto en CC</button>" in JS and ">Resuelto en nuevo CC</button>" in JS
      and "> Corregido en aSa</label>" not in JS and ".audbres.eligiendo{" in HTM
      and ".audbres.on{background:#2e7d32" in HTM)
# El usuario: «al presionar los botones no funciona la animacion, quedan pegados».
check("los botones dan señal mientras el servidor responde",
      "function _ocupado(" in JS and ".audwait" in HTM and "@keyframes audwait" in HTM
      and ":active:not(:disabled)" in HTM)
check("...y si el servidor rechaza, el botón se suelta y la pantalla no miente",
      "_ocupado(boton, false);" in JS.split("async function guardarLinea(")[1][:4000])
# EL CIERRE ES DEL AUDITADO, y sólo con todo resuelto. Verificado contra A-2026-018:
# con 15 pendientes da 400; marcadas las 15, la condición se cumple.
check("hay un cierre del auditado, aparte del «cerrar a mano» del auditor",
      '@router.post("/auditorias/{auditoria_id}/cerrar-resueltas")' in SRC
      and "def cerrar_resueltas(" in SRC)
check("...que exige que no quede NINGUNA barra pendiente",
      "Todavía quedan %s sin resolver" in SRC
      and "COUNT(*) FILTER (WHERE NOT i.corregido AND NOT i.desestimado)" in SRC)
check("...y que lo cierre quien tuvo barras acá o quien las resolvió, no cualquiera",
      "Cierra quien tuvo barras que corregir en esta auditoría, o quien las resolvió." in SRC)
check("la condición la dice el backend, para no ofrecer un botón que iba a dar 400",
      '"puedo_cerrar"' in SRC and '"barras_pendientes"' in SRC and "AUD.puedo_cerrar" in JS)
# EL INFORME ES DE UNA AUDITORIA TERMINADA: a medio camino dice una cosa hoy y otra
# mañana, y los informes se guardan y se mandan.
check("el informe PDF sólo se emite con la auditoría cerrada",
      "AUD.estado === 'cerrada'" in JS.split("var pdf = $('audPdf');")[1][:400]
      and "pdf.disabled = !lista" in JS)
check("la figura de la barra se puede ver en el resumen, pedida por código (todas o una)",
      "function _celdaFig(" in JS and "async function cargarFigurasAud(" in JS
      and "data-afigs=" in JS and "'/auditorias/elemento-asa?cc='" in JS)
# LA FORMA DE LA REVISIÓN DE BARRAS (6-nov): lados y ángulos en sus columnas, no en una
# tablita bajo el dibujo («hiciste un invento medio raro»).
check("...con sus lados y ángulos en columnas, como en la revisión de barras, sin tablita bajo el dibujo",
      "audGrillaLados(f, null, esc)" not in JS and "'α' + (k + 1)" in HOJA
      and "c.letras.forEach(function (L)" in HOJA
      and "lados: v.lados" in JS.split("function filaAccion(")[1][:2500])
# EL NOMBRE DE LA FIGURA Y EL DE LA MARCA SE VEN SIEMPRE (6-nov): salen de la foto de la
# auditoría; las que no los tienen piden sus códigos solas al abrirse.
check("el nombre de la figura y el que le puso el cubicador a la marca (Notes) se ven siempre",
      "notas: b.notas || null" in JS and '"notas": (it.get("Notes") or "").strip() or None' in SRC
      and 'class="audnotas"' in HOJA and "notas: b.notas || ''" in JS and "function _autoFiguras(" in JS
      # La Notes en su columna, no pegada a la marca: ahí se cortaba (9-nov).
      and "if (c.notas) h += '<td class=\"hojanotas\">'" in HOJA
      and "'</span></td>';" in HOJA.split("'<td class=\"hojamarca\"")[1][:300]
      and "!o.figura || !('notas' in o)" in JS)

print("\nEL ESTRIBO NO SE ESTIRA, Y LOS LADOS SE LEEN EN GRILLA")
# El usuario: «el renderizado sigue desencuadrando la esquina con algun tipo de
# resguardo». El resguardo es `_conMinimo`, que estira los tramos rectos cortos para que
# un gancho no desaparezca al lado de una barra de doce metros. Su guarda de «figura
# cerrada» comparaba el PRIMER punto con el ULTIMO, y en un estribo esos son las puntas
# de los dos ganchos, que no se tocan: el estribo entraba a estirarse y la esquina salia
# descuadrada.
check("una figura cuyo CONTORNO cierra no se estira, aunque sus puntas no se toquen",
      "function _cierraRecortando(" in JS and "for (var k = 0; k <= 2; k++)" in JS
      and "if (_cierraRecortando(pts)) return pts;" in JS)
# MEDIDO sobre barras de aSa: una T1 (SUSW 10mmA26) y una 106A (SUSH 8mmA37) llegan con
# ocho tramos —pata, arco, cuatro lados, arco, pata— y su marco cierra recortando DOS de
# cada punta. Una 102A (barra abierta) no cierra con ningun recorte y sigue recibiendo el
# minimo, que es para lo que esta.
check("...y se prueban DOS tramos por punta, porque un gancho son dos: arco y pata",
      "SE PRUEBAN DOS TRAMOS POR PUNTA porque un gancho son DOS" in JS
      and "Una barra abierta (102A) no cierra con ning" in JS)
check("el minimo sigue existiendo para las figuras abiertas",
      "MIN_LADO_REL" in JS and "var minimo = (mayor" in JS)
# «Por que no los pones claros, A = 15, B = XX... preferiria que pongas encabezados».
check("los lados se muestran en una grilla con encabezados, una columna por lado",
      "global.audGrillaLados = function" in JS
      and "'Lado'" in JS and "'cm'" in JS and "'Áng'" in JS
      and ".audgl th" in HTM)
check("...en orden alfabetico, que ahora se puede porque cada angulo va en SU columna",
      "var ks = orden.slice().sort();" in JS and "deLado[L] = ang[i - 1]" in JS)
check("...sin el signo, que es el sentido de giro y no una medida",
      "Math.abs(Math.round(deLado[L]))" in JS)
check("el lado que no cumple se marca en la grilla, no en medio del texto",
      "mal[L] ? ' class=\"mal\"' : ''" in JS and ".audgl td.mal" in HTM)
# UNA SOLA GRILLA PARA LAS DOS PANTALLAS: la revision de barras y el resumen de la
# auditoria muestran la misma barra y no tienen por que pintarla distinto.
check("la grilla por fila es de la auditoría; la revisión pasó a un encabezado por código (21-oct)",
      "audGrillaLados" not in REVJS and "function _tablaGrupo(" in REVJS)
# EL BUG DE LAS UNIDADES, que no se ve hasta que alguien lo mira: `normalizarBarra` trae
# lo de aSa en CENTIMETROS (k=0,1) y el render rotula cm, pero la REGLA guarda su valor y
# su esperado en MILIMETROS. La grilla mostraba los dos juntos —«55» al lado de «min
# 160»— y encima rotulaba «mm» sobre valores que ya eran cm.
check("la grilla va en CENTIMETROS, que es lo que ya rotula el dibujo",
      "fila('v', 'cm'," in JS and "fila('v', 'mm'," not in JS
      and "global.audNumCm" in JS)
check("...y el esperado de la regla se convierte: lo guarda en milimetros",
      "cm(det.esperado / 10)" in REVJS and "porL[l[0]] = Number(l[1]) / 10;" in REVJS
      and "porL[L] = Number(det.valor) / 10" in REVJS)
check("...con un decimal solo cuando hace falta: 1,5 se lee, 55,0 es ruido",
      "Math.abs(r - Math.round(r)) < 0.05" in JS and "replace('.', ',')" in JS)
# «La grilla se desordena, dejala fija»: sin ancho fijo cada columna se estira con su
# contenido y el «Lado» de una barra no queda sobre su medida.
check("la grilla tiene ancho fijo, para que no se desordene fila a fila",
      "table-layout:fixed" in HTM and ".audgl td{" in HTM and "width:34px" in HTM)
check("el dibujo lleva el nombre de la figura, que es con lo que se habla de una barra",
      "function _conNombre(" in JS and "audfign" in JS and ".audfign" in HTM)
# LA PLANILLA DEL AUDITOR (6-nov): «no tiene cómo controlar el tamaño de las figuras», el
# nombre salía dos veces y al marcar Hallazgo «se mueve toda la planilla… se achican las
# barras». Anchos fijos por columna; el dibujo, a su S/M/L y sin encogerse.
check("la planilla del auditor tiene S/M/L, el nombre sólo en Figura y anchos que no se mueven",
      'id="audRevTam"' in HTM and "global.audChipsTam('audRevTam', pintarBarras)" in JS
      and "render: celdaFigura(f, true)" in JS and 'class="audt hojab" id="audRevBarras"' in HTM
      and ".audt.hojab{table-layout:fixed;}" in HTM
      and ".audt.hojab td.audfigcel svg{max-width:none !important;}" in HTM
      and "'<col style=\"width:' + w + 'px\">'" in HOJA)
# LA HOJA DE BARRAS (6-nov): «has implementado cada cosa en forma diferente en vez de tener
# un tipo de formulario estándar que sirva para todo». El modelo es la planilla del
# auditor; las tres pantallas la arman con la misma función y sólo ponen lo suyo.
check("una sola tabla para las tres pantallas: la planilla del auditor, el Resumen y la revisión",
      "global.HojaBarras.partes({" in JS.split("function pintarBarras()")[1][:600]
      and "global.HojaBarras.tabla({" in JS.split("function _hojaElemento(")[1][:3000]
      and "global.HojaBarras.tabla({" in REVJS.split("function _tablaGrupo(")[1][:300]
      and APPH.index("auditorias/hoja_barras.js") < APPH.index("auditorias/index.js"))
check("...con el orden de la planilla del auditor: acción · Marca · φ · Figura · Render · lados · α · R · Largo · Cant · Peso · Elemento · lo propio · texto",
      HOJA.index("col(cfg.accion.ancho") < HOJA.index("col(ANCHO.marca, 'Marca')")
      < HOJA.index("col(anchoNotas(c.notas), 'Notes'")
      < HOJA.index("col(ANCHO.diam, 'φ'") < HOJA.index("col(ANCHO.figura, 'Figura'")
      < HOJA.index("col(anchoRender(), 'Render'") < HOJA.index("col(ANCHO.lado")
      < HOJA.index("col(ANCHO.peso, 'Peso'") < HOJA.index("col(ANCHO.elemento, 'Elemento')")
      < HOJA.index("(cfg.propias || []).forEach(function (p) { col(")
      < HOJA.index("'<th class=\"hojatxt\"'"))
check("...una columna sin ningún dato en la tabla no sale (la R en aSa; largo, cant y peso en la revisión)",
      "if (hay(b[k])) c[k] = true;" in HOJA and "if (c.radio) col(" in HOJA
      and "radio: AUD.origen === 'asa' ? null" in JS)
check("...el comentario del elemento cruza a lo ancho las columnas de la barra",
      "'<td class=\"hojasin\" colspan=\"' + nBarra + '\">'" in HOJA and "sinBarra:" in JS)
check("...y el estado de la fila gana sobre el cebrado (una fila par resuelta ya no se ve blanca)",
      ".audt.hojab tbody tr.hecho td, .audt.hojab tbody tr.nap td{background:#f1f8e9;}" in HTM
      and ".audt.hojab tbody tr.malo td{" in HTM)
check("«Ver figuras» trae el dibujo y nada más: la foto manda en las medidas",
      "diam: o.diam || null, cant: o.cant || null" in JS
      and "lados: porL, malos: malos, angulos: angs" in REVJS)
# 9-nov: «elimina la columna del elemento… tienes el nombre del elemento arriba».
check("la planilla del auditor no lleva columna Elemento: es un solo elemento y lo dice la cabecera",
      "elemento:" not in JS.split("function pintarBarras()")[1].split("function celdaEd(")[0]
      and "marcaTitle: [b.ref, b.plano, taller].filter(Boolean).join(' · ')" in JS
      and "elemento:" not in JS.split("function filaAccion(")[1].split("function _autoFiguras(")[0])
check("φ y Figura centrados, el encabezado con el dato; la casilla de marcar cabe en su columna",
      "col(ANCHO.diam, 'φ', 'hojac')" in HOJA and "col(ANCHO.figura, 'Figura', 'hojac')" in HOJA
      and ".audt.hojab th.hojac, .audt.hojab td.hojac{text-align:center;}" in HTM
      and ".audt.hojab td.hojachk, .audt.hojab th.hojachk{padding:0; text-align:center;}" in HTM
      and "check: 26," in HOJA and ".audt.hojab.conchk td.hojaacc, .audt.hojab.conchk th.hojaacc{left:26px;}" in HTM)
check("el valor que corrige el auditor se puede escribir con coma, como lo muestra la tabla",
      "function _nro(x) { return Number(String(x).replace(',', '.')); }" in JS
      and "_aMm(_nro(esp.lados[L]))" in JS)
check("hay tres tamanos de dibujo y se recuerdan por navegador",
      "global.audFigTam = function" in JS and "global.audChipsTam = function" in JS
      and "armahub_fig_tam" in JS and "[['s', 'S'], ['m', 'M'], ['l', 'L']]" in JS)
check("...y estan en las dos pantallas, repintando lo que el tamano cambia",
      "audChipsTam('revTam', pintarItems)" in REVJS
      and "audChipsTam('audTam', pintarAcciones)" in JS
      and 'id="revTam"' in HTM)

print("\nEL SELECTOR DE OBRA: UNA POR JOB, Y SIN LO DE LA VEZ ANTERIOR")
# «Ahora me aparece 3 veces euro san pablo». Eran los tres frentes de ArmaHub de un solo
# job, en un selector que ya no debia existir: la auditoria es sobre aSa, y ahi San Pablo
# es UNA obra. Correlacionar las obras de ArmaHub con los jobs no era fundir nada.
check("en el selector cada job de aSa aparece una sola vez",
      '"job": r[1]' in SRC and "GROUP BY p.asa_job_id" in SRC)
# «Me dejaste un filtro pegado, llegué de los dashboards y no me encontraba la obra». El
# estado del formulario de crear vive en variables del módulo y se quedaba de una visita
# a la otra: el origen seguía en «aSa» con la obra de la vez pasada.
check("al volver al tab con el formulario cerrado, el estado de crear se limpia",
      "function _formEnBlanco(" in JS
      and "if ($('audForm').style.display === 'none') _formEnBlanco();" in JS
      and "OBRA = ''; UNIV = null;" in JS)
check("...y se conserva sólo si el formulario está ABIERTO, que es la señal de que alguien lo llenaba",
      "Sólo se conserva si el formulario\n  // está ABIERTO" in JS)

print("\nEL AUDITADO NO ESCRIBE EL VEREDICTO DEL AUDITOR, Y SI LO HIZO SE VE")
# 11-oct: el auditado de Zañartu guardó cuatro elementos como «conforme» desde el
# formulario del auditor; José la envió el 13 con «10 de 10 conforme» sin saberlo y se
# cerró «sin hallazgos». El usuario: «eso tenía como 10 hallazgos, ahora no tiene ninguno
# porque el cubicador no entendió cómo responder, y modificó los hallazgos a conforme».
MIG153 = open(os.path.join(ROOT, "armahub", "migrations", "153_veredictos_del_auditado_fuera.sql"),
              encoding="utf-8").read()
check("lo que el auditado escribió se ANULÓ con una regla general, no con una lista de ids",
      "e.revisado_por <> a.auditor" in MIG153 and "DELETE FROM auditoria_items WHERE elemento_id IN (SELECT elemento_id FROM _ajenos)" in MIG153
      and "SET hallazgo = NULL, texto = NULL, revisado_por = NULL" in MIG153)
check("...y la auditoría enviada sobre eso se reabrió con el mismo reset que «Reabrir»",
      "enviada_el = NULL, enviada_por = NULL, cerrada_a_mano = FALSE" in MIG153
      and "correccion_vence = NULL" in MIG153 and "estado = 'en_curso'" in MIG153)
check("...sin inventar lo que marcó el auditor: se le manda el conteo y vuelve a pendiente",
      "No se\n-- inventa lo que marcó José" in MIG153 and "perdieron tu veredicto" in MIG153)
# LA PUERTA que lo permitió ya está cerrada (b3f108a): escribir la revisión exige ser el
# auditor de ESA auditoría. Acá se congela que ES esa guarda la que cubre este caso.
check("la guarda que lo impide está en el endpoint que guarda la revisión barra por barra",
      "_solo_antes_de_enviar(cur, auditoria_id, user)" in
      SRC.split('@router.put("/auditorias/{auditoria_id}/elementos/{elemento_id}/revision")')[1][:2500])
# Y SI VUELVE A PASAR POR DONDE SEA, SE VE: el detalle marca el veredicto ajeno y la
# pantalla lo pinta en rojo. Un cierre «sin hallazgos» sobre eso ya no pasa en silencio.
check("el detalle marca los veredictos que no son del auditor",
      'e["revisado_por_ajeno"] = bool(rp and rp != aud.get("auditor") and rp not in admins)' in SRC)
check("...y la pantalla los pinta en rojo, diciendo de quién son",
      "e.revisado_por_ajeno" in JS and 'class="audajeno"' in JS and ".audajeno{" in HTM
      and "no es del auditor" in JS)
# EL AUDITADO VE SOLO SU PARTE. «Debiera ver sólo su parte para actuar… tal vez debe
# desaparecer el menú donde se hace la auditoría». El formulario del auditor no se le
# abre ni en sólo lectura —abierto invitaba a escribir—; su parte es el Resumen Hallazgos.
check("el auditado no abre el formulario del auditor, ni a mirar: lo lleva al Resumen Hallazgos",
      "if (!AUD || !AUD.soy_auditor) {" in JS.split("async function abrirElemento(e) {")[1][:900]
      and "mostrarRevision(false);" in JS.split("async function abrirElemento(e) {")[1][:900])
check("...y la fila de la muestra se lo dice en vez de prometerle revisar",
      "conHall ? 'Clic para ver sus hallazgos y resolverlos' : 'Sin hallazgos que resolver'" in JS)

print("\nEL COMENTARIO QUE NO ES DE NINGUNA BARRA")
# NO TODO HALLAZGO ES DE UNA BARRA (15-oct). «Falta trabas de muro» no se puede colgar de
# ninguna: la barra que falta no está. El auditor lo escribe en el comentario del elemento
# y hasta hoy ese comentario no tenía dónde resolverse —el auditado lo leía y el elemento
# quedaba pendiente para siempre—. El usuario: «el comentario general queda para que lo
# trate el auditado, pero falta algún check para resolver el comentario que quede».
check("el backend dice cuál elemento tiene comentario y ninguna barra marcada",
      '"comentario_suelto"' in SRC and "and not e[\"barras_malas\"]" in SRC)
check("el auditado lo resuelve con las mismas tres cosas que una barra",
      "/elementos/{elemento_id}/resolucion" in SRC and "class ResolucionBody" in SRC
      and all(c in SRC.split("class ResolucionBody")[1][:700]
              for c in ("aplica", "causa", "corregido", "nota")))
_res = _cuerpo("{auditoria_id}/elementos/{elemento_id}/resolucion")
check("...pide ser quien cubicó y que la auditoría esté enviada",
      "_elemento_del_auditado(cur, auditoria_id, elemento_id, user)" in _res
      and "_solo_si_enviada(cur, auditoria_id)" in _res)
check("...no se da por corregido sin RCA, igual que la barra",
      "Antes de darlo por corregido, clasifica por qué pasó (RCA)" in _res)
check("...y «no aplica» sin motivo es borrar el hallazgo: se rechaza",
      "es borrar el hallazgo" in _res and 'if not nota:' in _res)
check("si el elemento SÍ tiene barras marcadas, se resuelven una por una",
      "se resuelven una por una" in SRC.split("def _elemento_del_auditado(")[1][:2200])
check("el estado del elemento sin barras sale de lo que dejó el auditado, no de NULL",
      'return fila[2] or "pendiente"' in SRC.split("def _accion_de_items(")[1][:2200])
check("cerrar cuenta los comentarios pendientes, no sólo las barras",
      "comentario(s) de elemento" in SRC and "sueltos_pend" in SRC)
check("...y el detalle los suma a lo que falta por resolver",
      'aud["barras_pendientes"] = len(pendientes) + len(sueltos_pend)' in SRC)
check("la pantalla le pone al comentario las mismas tres salidas que a una barra",
      "function filaComentario(" in JS and "var lin = 'e' + e.id" in JS
      and "'data-ecausa'" in JS and "function _celdaCausa(" in JS
      and "accion: _accionesAud(lin, abierta, puede, false, null)," in JS
      and "accion_cc_nuevo = %s" in SRC)
check("...y la matriz Ishikawa es LA MISMA, sólo cambia a dónde guarda",
      "a.elemento_id" in JS.split("global.audCausaElegida")[1][:800]
      and "/resolucion" in JS.split("global.audCausaElegida")[1][:800])
# UN SOLO VOCABULARIO. Quedaban cuatro elementos diciendo «nc_menor», del vocabulario que
# el usuario sacó el 9-oct, y el código compara contra «hallazgo» para saber si hay una no
# conformidad: eran no conformidades que el sistema no contaba como tales.
MIG157 = open(os.path.join(ROOT, "armahub", "migrations",
                           "157_cierre_con_firma_y_chequeo.sql"), encoding="utf-8").read()
MIG156 = open(os.path.join(ROOT, "armahub", "migrations",
                           "156_un_solo_vocabulario_de_hallazgo.sql"), encoding="utf-8").read()
check("los hallazgos viejos («nc_menor») pasan al vocabulario de hoy",
      "UPDATE auditoria_elementos SET hallazgo = 'hallazgo'" in MIG156
      and "'nc_menor'" in MIG156)


print("\nRESUELTO, CIERRE CON CHEQUEO, RCA FUERA EN «NO APLICA», CUENTAS EN VEZ DE PORCENTAJES (20-oct)")
# El usuario, de una vez: botón Resuelto en vez de la comprobación automática; cerrar sólo
# cuando todo está resuelto, y que al cerrar se compruebe contra aSa avisando sin bloquear;
# «no aplica» sin RCA; fuera la cobertura y el % de conformidad; cuentas en su lugar.
_cr = _cuerpo_post("{auditoria_id}/cerrar-resueltas")
_des = _cuerpo("{auditoria_id}/items/{item_id}/desestimar")
_res = _cuerpo("{auditoria_id}/elementos/{elemento_id}/resolucion")
check("cerrar le pregunta a aSa por cada barra resuelta, en vivo, una lectura por código",
      "chequeo = _chequear_lo_resuelto(cur, auditoria_id)" in _cr
      and "real = _barra_hoy(donde, cual, cache)" in SRC and "cache[cc] = _items_de(cc) or []" in SRC)
check("...y si alguna sigue igual, contesta 409 con la lista y NO cierra",
      "status_code=409" in _cr and '"motivo": "sigue_igual"' in _cr
      and '"barras": chequeo["siguen_igual"]' in _cr
      and 'if chequeo["siguen_igual"]:' in _cr)
# SIN «CERRAR IGUAL» (6-nov): «el cerrar igual no me gusta, porque rompe el flujo». Lo
# idéntico se corrige en aSa o se marca «No aplica»; lo raro lo cierra el auditor a mano.
check("...y no hay forma de cerrar igual: ni el parámetro, ni el texto del registro",
      "confirmar: bool = False" not in SRC.split("def cerrar_resueltas(")[1][:200]
      and "Confirmó el cierre con" not in _cr and "?confirmar=true" not in JS
      and "Cerrar igual" not in JS)
check("...y lo que no se pudo comprobar se dice, no se cuenta como incumplido",
      '"sin_leer"' in SRC and "no se pudieron comprobar" in _cr)
check("el cierre del auditado se distingue del cierre forzado del auditor",
      "cierre_tipo = 'auditado'" in _cr and "cierre_tipo" in MIG157 and "cierre_chequeo" in MIG157)
check("la pantalla muestra por qué no cerró, con la lista, y repinta con lo que dijo aSa",
      "function _avisoCierre(" in JS and "e.status === 409" in JS and "err.detalle = det;" in JS
      and "AUD = await req('GET', '/auditorias/' + AUD.id);" in JS.split("async function cerrarResueltas(")[1][:1200])
# SE COMPRUEBA AL MARCAR (6-nov): la fila dice en el acto si la barra se editó en aSa.
check("al resolver, el backend compara con aSa en el acto (de a una y en lote)",
      "if body.corregido:\n                _comprobar_al_marcar(cur, [item_id])" in SRC
      and "_comprobar_al_marcar(cur, sel)" in SRC.split("def lote_items(")[1]
      and "comprobar_item(cur, item_id, cache)" in SRC.split("def _comprobar_al_marcar(")[1][:900])
check("...y si la comparación revienta, lo declarado se guarda igual y el error queda en el log",
      '.exception("comparar con aSa la barra %s al marcarla", item_id)' in SRC)
check("«no aplica» se lleva el RCA de la barra, y deja escrito cuál era",
      "causa = NULL, causa_categoria = NULL, causa_texto = NULL" in _des
      and "se quitó el RCA %s" in _des)
check("...y del comentario de elemento también",
      "causa = None" in _res and "se quitó el RCA %s" in _res)
check("...y la pantalla apaga el RCA en una barra sin efecto",
      "if (nap) return '';" in JS.split("function _celdaCausa(")[1][:200])
check("los indicadores del área son cuentas: auditorías, hallazgos, obras, cubicadores, sin corregir",
      '"obras_auditadas"' in SRC and '"cubicadores_auditados"' in SRC
      and "'obras auditadas'" in JS and "'cubicadores auditados'" in JS
      and "'acciones sin corregir'" in JS and "conformidad sobre" not in JS)
check("...más el único porcentaje que quedó: hallazgos sobre elementos auditados",
      'total["pct_hallazgos"]' in SRC and "de hallazgos sobre" in JS)
check("...y las tablas por cubicador y por obra ya no gradúan conformidad",
      'Conformidad</th>' not in JS and 'Hallazgos</th>' in JS)


print("\nCUALQUIER CUBICADOR RESUELVE, EL DUEÑO SE ENTERA, Y LOS AVISOS LLEGAN (21-oct)")
# El usuario eligió la opción A: «cualquier cubicador puede resolver pero debe dar aviso».
# Y de paso salió que 37 de 48 avisos de auditoría iban al LOGIN de aSa («HMONDACA») en
# vez del correo, y la campana busca por correo: nunca le llegaron a nadie.
MIG159 = open(os.path.join(ROOT, "armahub", "migrations", "159_avisos_al_correo.sql"),
              encoding="utf-8").read()
check("las puertas del auditado ya no dan 403 por no ser el dueño",
      'detail="Esta corrección es de quien cubicó el elemento."' not in SRC
      and 'detail="Este comentario es de quien cubicó el elemento."' not in SRC
      and "def _avisar_si_ajeno(" in SRC)
check("...y en los cuatro verbos al dueño le llega aviso si lo hizo otro",
      SRC.count("_avisar_si_ajeno(user,") >= 4 and "en tu lugar" in SRC)
check("los avisos van al correo: si llega un login de aSa, se resuelve",
      "def correo_de_login(" in SRC and "correo_de_login(cur, destinatario)" in SRC)
check("...y los 37 que ya salieron al login se re-dirigen al correo",
      "UPDATE notificaciones" in MIG159 and "NOT LIKE '%@%'" in MIG159)
check("el detalle dice quién resolvió en lugar del dueño, y que cualquiera puede actuar",
      '"resuelto_por_otro"' in SRC and 'aud["puedo_actuar"]' in SRC
      and "function _porOtro(" in JS and "AUD.puedo_actuar && _enCurso()" in JS
      and ".audporotro{" in HTM)
check("cierra también quien resolvió algo acá en lugar del dueño",
      "o quien las resolvió." in SRC and "resolvi = cur.fetchone()[0]" in SRC)
check("los indicadores del RCA se dicen internos: no es el Pareto de los reclamos",
      "NO es el Pareto de los reclamos" in SRC and "NO es el Pareto de los reclamos" in JS)


print("\nEL MISMO FORMATO QUE LA REVISIÓN: AGRUPADO, DE A MUCHAS, MOTIVO DE LISTA (21-oct)")
# El usuario: «compares las auditorías y las revisiones de barras y armonices, debieran ser
# flujos y formatos muy similares». Lo que a la auditoría le faltaba de la revisión.
MIG160 = open(os.path.join(ROOT, "armahub", "migrations", "160_no_aplica_con_motivo_de_lista.sql"),
              encoding="utf-8").read()
check("el Resumen Hallazgos agrupa por código de control, con la cabecera y la cuenta de la revisión de barras",
      "'<div class=\"revcc2 audhoja'" in JS and "data-aselgrp=" in JS and 'class="revcuenta"' in JS
      and "global.HojaBarras.tabla({" in JS.split("function _hojaElemento(")[1][:3000])
check("hay checks por barra y, con marcas, los botones de la fila actúan sobre todas (sin verbos en la barra)",
      "data-asel=" in JS and "function _lineasDe(" in JS and "data-alote" not in JS
      and "RCA, Resuelto o No aplica en cualquiera de sus filas actúa sobre todas." in JS
      and "accion: modo === 'nap' ? 'no_aplica' : 'resuelto'" in JS)
check("...lo escrito en una se escribe en todas (el código nuevo también, la marca no)",
      "input[data-anota][data-espejo=\"1\"]" in JS and "input[data-accnuevo][data-espejo=\"1\"]" in JS
      and "data-amarca" in JS and "cuerpo.marcas = marcas" in JS and "marcas: Optional[dict] = None" in SRC)
check("...y el RCA también va para todas las marcadas",
      "accion: 'causa'" in JS and 'elif body.accion == "causa":' in SRC)
check("...contra un lote del backend con las mismas reglas que de a una",
      '@router.put("/auditorias/{auditoria_id}/items/lote")' in SRC and "class LoteBody" in SRC
      and "Antes de darlas por resueltas, clasifica por qué pasó (RCA)" in SRC
      and SRC.count("causa = NULL, causa_categoria = NULL, causa_texto = NULL") >= 2)
check("...que avisa al auditor y al dueño de cada barra ajena, una vez por persona",
      "duenos.setdefault(" in SRC and "en tu lugar (%s)" in SRC)
check("«no aplica» se justifica con un campo al final de la linea, sin lista de motivos (5-nov)",
      "MOTIVOS_NO_APLICA_AUD = {" in SRC and "motivo_tipo: Optional[str] = None" in SRC
      and "desestimado_tipo" in MIG160
      and "<select data-mot=" not in JS and "_opcionesMotivoAud" not in JS and "audLoteMot" not in JS
      and "Elige por qué no aplica." not in SRC and SRC.count("body.motivo_tipo and body.motivo_tipo not in MOTIVOS_NO_APLICA_AUD") == 2
      and "audnapform" not in JS and "_filaFormNap" not in JS and "data-napok" not in JS)
check("...Enter guarda, Esc lo deja, y un «no aplica» no muestra el RCA (sólo «Resuelto» lo pide)",
      "if (ev.key === 'Escape') cerrarLinea(lin);" in JS and "if (ev.key === 'Enter') guardarLinea(lin);" in JS
      and "tr.classList.toggle('napabierto', modo === 'nap');" in JS
      and "if (modo !== 'nap') {\n      var sinRca" in JS)
check("lo que no aplica no se clasifica: ni en pantalla ni por el backend",
      "if (nap) return '';" in JS.split("function _celdaCausa(")[1][:200]
      and "Esa barra no aplica: no lleva RCA." in SRC)
check("...y el motivo viaja en cada barra del detalle",
      '"desestimado_tipo": des_tipo' in SRC)
# EL BUG DEL CIERRE: `addEventListener('click', cerrarResueltas)` le pasaba el MouseEvent
# como `confirmar`, y «confirmar» verdadero cierra SIN el chequeo en aSa.
check("cerrar no recibe el evento del clic como argumento",
      "cz.addEventListener('click', function () { cerrarResueltas(); });" in JS
      and "cz.addEventListener('click', cerrarResueltas);" not in JS)


print("\nLA MUESTRA ES DEL AUDITOR; AL AUDITADO LE LLEGA CUANDO SE ENVÍA (21-oct)")
# El usuario, viendo el formulario del auditor abierto en una auditoría sin enviar: «esto
# confunde al auditado… el auditado debe ver sólo lo de abajo una vez enviada».
check("la lista es para todo el equipo; antes del envío, quien no audita no recibe los hallazgos",
      "(a.enviada_el IS NOT NULL OR a.auditor = %s OR a.creada_por = %s)" not in SRC
      and 'por_elemento.get(e["id"], []) if ve_hallazgos else []' in SRC)
check("la muestra del auditor no se le pinta a quien no audita",
      "La muestra la revisa el auditor. Cuando la envíe" in JS)
check("el check de grupo sale sólo cuando hay algo que marcar",
      "var marcables = _actuo() &&" in JS and "check: { titulo: marcables" in JS)
check("el nombre de la figura va al lado del dibujo, y el tamaño por defecto es S",
      'class="audfigw"' in JS and "var FIG_TAM = 's';" in JS and ".audfigw{" in HTM)


print("\nLA PANTALLA DEL AUDITOR, DESPEJADA (28-oct)")
# «Depuremos esto, todavia esta enredado»: la muestra son diez filas con quince columnas y
# es la herramienta del AUDITOR; el auditado trabaja abajo, en Resumen Hallazgos.
# UNA PANTALLA POR ETAPA, NO POR ROL (28-oct). El usuario corrigio lo de ocultar la
# muestra: «yo como admin deberia poder ver todas las etapas... es un error ocultar la
# muestra aca». Antes del envio la muestra esta siempre (es la herramienta del auditor);
# despues queda plegada, porque lo que se trabaja es el Resumen Hallazgos.
check("la franja va a lo ancho: elementos, items, hallazgos, observaciones y a quien le toca cuanto",
      'id="audResBarra"' in JS and "'observaciones'" in JS
      and "'barras por corregir, por cubicador'" in JS)
check("antes del envio la muestra es del auditor; despues la ven todos (9-nov)",
      "(AUD.soy_auditor || enviadaYa) ? '' : 'none'" in JS and "Ver la muestra del auditor (" not in JS)
check("el Resumen Hallazgos deja el cartel amarillo y usa la caja estandar",
      ".audacc{margin-top:10px; padding:10px 12px; background:#fffdf5" not in HTM
      and ".audacc{margin-top:10px; padding:12px 14px; background:#fff;" in HTM
      # 9-nov: «Además debiera estar en un modal».
      and '<div id="audAccModal" style="display:none; position:fixed;' in HTM
      and '<div id="audAcciones" class="revhoja audacc"></div>' in HTM
      and "function cerrarHallazgos()" in JS
      and "'<button class=\"audmini\" id=\"audAccCerrar\"" in JS
      and "border-top:3px solid #ffb300" in HTM)
check("...y ninguna columna queda cortada contra el borde: la tabla de cada código scrollea sola",
      '<div class="hojatbl">' in HOJA and ".hojatbl{overflow-x:auto;}" in HTM)


print("\nEL DISEÑO APROBADO (28-oct): el auditor audita y envia; el auditado resuelve")
check("la observacion es POR BARRA y va a la derecha de la barra, siempre",
      "texto: { titulo: 'Observación de la barra'" in JS and "Elemento / nota" not in JS
      and "'<td class=\"hojatxt\">'" in HOJA and ".audt.hojab td.hojatxt .audobs{width:100%;}" in HTM)
check("...y la nota del elemento se llama por lo que es: lo que no es de ninguna barra",
      'for="audRevTexto"' in HTM and "Nota del elemento" in HTM and "falta trabas" in HTM)
check("el Resumen Hallazgos existe desde el envio, no mientras se revisa",
      "(enviada && ACC_EL != null)" in JS and "avisos.innerHTML = (!enviada || !acc.length)" in JS
      and "Todavía no se envía" not in JS)
check("...sin la columna Cubico por fila: esta en la cabecera del elemento",
      "'<th>Elemento</th><th>Cubicó</th>'" not in JS and "'<span class=\"revquien\">' + esc(quien(e.cubicado_por))" in JS)
check("el auditor no resuelve lo que el mismo marco: juez y parte",
      'user.get("email", "?") != aud.get("auditor")' in SRC.split('aud["puedo_actuar"]')[1][:200]
      and "No lo acepto" in JS)
# EL ORIGEN DEL TEXTO PEGADO (28-oct), vivo hasta hoy: el textarea de la nota solo se
# rellenaba si estaba vacio y nunca se limpiaba al cambiar de elemento, asi que lo escrito
# en uno se guardaba con el siguiente. Asi quedo la misma nota en cuatro elementos de
# A-2026-012 y las doce observaciones de 406 REV 1 en tres conformes.
check("la nota del elemento se vuelve a llenar al CAMBIAR de elemento, no en cada repintado",
      "ta.dataset.de !== String(ELEM.id)" in JS and "ta.value = ELEM.texto || '';" in JS
      and "if ($('audRevTexto').value === '' && ELEM.texto)" not in JS)
check("la auditoria cerrada dice lo que aSa confirmo al cerrar",
      'aud["cierre_chequeo"] = r[34]' in SRC and "a.cierre_chequeo, a.cierre_tipo" in SRC
      and 'class="audnota audcerrada"' in JS and "aSa confirmó <b>" in JS)


print("\nEL NOMBRE DEL CUBICADOR, UNO SOLO EN TODA LA PLATAFORMA (2-nov)")
# «Los usuarios los tienes como vienen en aSa; me gustaria estandarizar para que a todos los
# filtros les pongas el nombre real: jrodriguez → J Rodriguez, HMONDACA → H Mondaca.»
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "x" * 40)
os.environ.setdefault("DATABASE_URL", "postgresql://x/x")
from armahub.auditorias import nombre_visible, alias_de        # noqa: E402
check("el nombre se escribe inicial + apellido, y un apellido en MAYUSCULAS se arregla",
      nombre_visible("Jose", "Rodriguez") == "J Rodriguez"
      and nombre_visible("Hans", "MONDACA") == "H Mondaca"
      and nombre_visible("Matías", "Díaz") == "M Díaz")
check("...y sin apellido no inventa nada",
      nombre_visible("cubicador", "") == "cubicador" and nombre_visible("", "") == "")
check("el mapa sale de los logins REALES cruzados con los usuarios, con las dos formas de login",
      "def nombres_asa(" in SRC and "alias_de(nombre, apellido, login) or l == n + a[:1]" in SRC
      and 'UNION SELECT detail_person FROM asa_pedidos' in SRC.split("def nombres_asa(")[1][:2400])
check("...y lo entrega un endpoint que el front pide una vez",
      '@router.get("/cubicadores/nombres")' in SRC and '"nombres": nombres_asa(cur)' in SRC
      and "shared/cubicadores.js" in APP)
check("a quien NO es usuario no se le inventa nombre: se muestra su login",
      "NO SE LE INVENTA NOMBRE" in open(os.path.join(
          ROOT, "armahub", "static", "js", "shared", "cubicadores.js"), encoding="utf-8").read())
check("en las auditorias, quien cubico se escribe igual: login traducido, correo cortado en el @",
      "function quien(x) {" in JS and "esc(quien(e.cubicado_por))" in JS
      and "esc(quien(x.cubicador))" in JS and "global.cargarNomCub();" in JS)


print("\nEL LOGIN DE QUIEN NO ES USUARIO, TAMBIEN SE ESCRIBE BIEN (2-nov)")
from armahub.auditorias import nombre_de_login        # noqa: E402
check("el login se separa como se lee, sin inventar nada",
      nombre_de_login("Jsanchez") == "J Sanchez" and nombre_de_login("Turtubia") == "T Urtubia"
      and nombre_de_login("CManriquez") == "C Manriquez" and nombre_de_login("FiorellaB") == "Fiorella B")
check("...lo que no es el nombre de una persona se deja igual: siglas, cuentas, correos",
      nombre_de_login("RMC") == "RMC" and nombre_de_login("admin") == "admin"
      and nombre_de_login("aSaAdmin") == "aSaAdmin" and nombre_de_login("x@y.cl") == "x@y.cl")
check("...y un apellido que no esta en el login se escribe a mano, con su porque",
      nombre_de_login("MarioP") == "M Puyo" and "NOMBRES_A_MANO = {" in SRC
      and "externo que ya no trabaja" in SRC)


print("\nLAS BARRAS POR CORREGIR SON LAS DE LOS HALLAZGOS (3-nov)")
# La A-2026-012 decia «quedan 36» y el panel listaba 27: las otras 9 eran de elementos
# marcados OBSERVACION, que no abren accion y no salen en el panel, pero el contador las
# sumaba. Nunca se llegaba a cero. «Me meto y no puedo hacer nada.»
check("el contador de barras pendientes mira solo los elementos que son hallazgo, como el panel",
      "WHERE e.auditoria_id = %s AND i.conforme IS FALSE AND e.hallazgo = %s" in SRC
      and "(auditoria_id, HALLAZGO_ABRE_ACCION))\n    resueltas, abiertas = cur.fetchone()" in SRC)

check("...y el detalle, la lista, los indicadores y el desglose por cubicador cuentan lo mismo que el panel",
      'todas = [b for e in aud["elementos"] if e.get("accion_estado") for b in e["barras_malas"]]' in SRC
      and SRC.count("AND i.conforme IS FALSE AND e2.hallazgo = 'hallazgo'") == 6
      and JS.count("if (!el.accion_estado) return;") == 2)

print("\nUNA SOLA DEFINICION DE «BARRA CON ACCION», EN TODAS LAS CUENTAS (4-nov)")
import re as _re  # noqa: E402
SCHED = open(os.path.join(ROOT, "armahub", "asa_scheduler.py"), encoding="utf-8").read()
# Las cuentas de barras por corregir que NO llevan el filtro de hallazgo: cualquier
# «i.conforme IS FALSE» seguido de corregido/desestimado/cubicado_por sin el fragmento.
_sueltas = [m.group(0) for m in _re.finditer(
    r"(?<!FILTER \(WHERE )i\.conforme IS FALSE(?!\s+AND e(2)?\.hallazgo)[^;]{0,80}(corregido|desestimado|cubicado_por)", SRC + SCHED)]
check("el cierre, el envio, el panel del auditado, la comprobacion, el aviso a fabrica y el reloj cuentan con SQL_BARRA_CON_ACCION",
      SRC.count("SQL_BARRA_CON_ACCION") >= 6 and SRC.count("SQL_ELEMENTO_CON_ACCION") >= 2
      and SCHED.count("SQL_BARRA_CON_ACCION") == 2)
check("...y no queda ninguna cuenta de barras por corregir sin el filtro de hallazgo", not _sueltas)
for m in _sueltas:
    print("      " + m[:100].replace("\n", " "))

print("\nLA FIGURA DOBLADA EN DOS PLANOS SE DIBUJA EN EL ESPACIO (4-nov)")
FIG = open(os.path.join(ROOT, "armahub", "figura_asa.py"), encoding="utf-8").read()
check("el backend manda el eje 3D vertice a vertice (puntos3d, lados3d) para la figura tridimensional",
      "def _puntos_3d(legs, dirs):" in FIG and '"puntos3d": puntos3d, "lados3d": lados3d,' in FIG
      and "se muestra su proyección en planta" not in FIG)
check("la pantalla lo proyecta en isometrica, antes que cualquier trazo plano del catalogo, y lo dice con «3D»",
      "function svgIso(f) {" in JS and "if (f.eje && f.eje.tridimensional && (f.eje.puntos3d || []).length > 1) {" in JS
      and JS.index("var iso = svgIso(f);") < JS.index("var svg = global._bmFiguraSvg ? global._bmFiguraSvg(f, FIG_TAM) : '';")
      and '>3D</span>' in JS)
check("...con la misma camara del editor 3D del catalogo (azimut 45, elevacion 30), no una isometrica propia",
      "var el = Math.PI / 6, az = Math.PI / 4;" in JS and "var ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;" in JS
      and "def _orientar_3d(pts):" in FIG)

print("\nNINGUNA VARIABLE LOCAL TAPA UNA FUNCION DEL MODULO (4-nov)")
import re as _re2  # noqa: E402
IDX = open(os.path.join(ROOT, "armahub", "static", "js", "features", "auditorias", "index.js"), encoding="utf-8").read()
# `var quien = '...'` dentro de pintarDetalle tapaba a `function quien(x)`, y la tabla de
# elementos llamaba a un string. Dos dias sin que ninguna auditoria pintara su detalle entero.
_funcs = set(_re2.findall(r"^  (?:async )?function (\w+)\s*\(", IDX, _re2.M))
_tapadas = sorted(f for f in _funcs if _re2.search(r"\bvar " + f + r"\s*=", IDX))
check("ninguna funcion del modulo tiene una `var` con su mismo nombre (quien is not a function)", not _tapadas)
for f in _tapadas:
    print("      tapada: " + f)
check("...y las barras por corregir por cubicador salen con el nombre, no con el login",
      "var porCubTxt = Object.keys(porcub)" in IDX and "return esc(quien(q)) + ': ' + porcub[q]; }).join(' · ');" in IDX)

print("\nLOS BOTONES DEL AUDITOR TIENEN SU FUNCION (4-nov)")
IDX = open(os.path.join(ROOT, "armahub", "static", "js", "features", "auditorias", "index.js"), encoding="utf-8").read()
import re as _re2  # noqa: E402
_enganchados = set(_re2.findall(r"addEventListener\('click', (\w+)\)", IDX))
_definidas = set(_re2.findall(r"(?:async )?function (\w+)\s*\(", IDX)) | set(_re2.findall(r"var (\w+) = (?:async )?function", IDX))
check("toda funcion enganchada por nombre a un click existe (el 28-oct se borraron cerrarAMano y reabrir y quedaron los botones)",
      _enganchados <= _definidas and {"cerrarAMano", "reabrir"} <= _definidas)
for f in sorted(_enganchados - _definidas):
    print("      sin definir: " + f)

print("\nLA CAUSA DE UNA BARRA VA A LA BARRA (5-nov)")
_JSC = open(os.path.join(ROOT, "armahub", "static", "js", "features", "auditorias", "index.js"), encoding="utf-8").read()
_ce = _JSC.split("global.audCausaElegida = async function")[1].split("ok('Causa registrada')")[0]
check("en Mis correcciones la fila trae barra y elemento: manda la barra, no el comentario del elemento",
      "var ruta = a.item_id" in _ce and _ce.index("/items/") < _ce.index("/resolucion"))

print("\nLA BARRA DE HOY EN aSa TRAE ÁNGULOS Y MANDRIL, Y CADA CÓDIGO SE LEE UNA VEZ (6-nov)")
_xml = "<cp><l>1200</l><ln>A</ln><t>STD</t></cp><cp><l>300</l><a>90</a><ln>B</ln><t>STD</t></cp>"
_item = {"BarMark": "A12", "BarSizeDescr": "12mm", "ShpNameID": "102A", "LegAngle": _xml, "ShapeDims": "",
         "LengthTheor": 1500, "TotalQty": 10, "PinDiam": 48, "CtrlCode": "SUTQ", "Notes": "MV"}
_lecturas = []
_items_de_real = A._items_de
A._items_de = lambda cc: (_lecturas.append(cc), [_item])[1]
try:
    _cache = {}
    _hoy = A._barra_hoy("SUTQ", "A12", _cache)
    A._barra_hoy("SUTQ", "A12#2", _cache)
finally:
    A._items_de = _items_de_real
_foto = {"diam": 12, "cant": 10, "largo": 1500, "figura": "102A", "lados": {"A": 1200, "B": 300},
         "angulos": [90], "radio": 48}
check("la barra de hoy trae ángulos y mandril con la misma forma que la foto",
      _hoy["angulos"] == [90.0] and _hoy["radio"] == 48)
check("...dos barras del mismo código, una sola lectura a aSa", len(_lecturas) == 1)
check("...igual a la foto sale idéntica; con un ángulo distinto, editada y dicho en palabras de planta",
      A.comparar({}, _foto, _hoy)[0] == "sigue_igual"
      and A.comparar({}, dict(_foto, angulos=[135], radio=60), _hoy) == ("ok", "La barra cambió en: ángulos, mandril"))

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
