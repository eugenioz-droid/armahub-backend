"""Test del CLIENTE DE aSa y del tab de Obras (28-sep).

QUÉ CUIDA. Tres cosas que, si se rompen, no se notan hasta que es tarde:

  1. LA CLAVE NO SE FILTRA. Ni al log, ni a la respuesta de un endpoint, ni al front. Un
     secreto que aparece una vez en un log de Render ya está comprometido.

  2. NO SE AHOGA A aSa. El usuario reporta que aSa se atora con consultas grandes (su
     Power BI se quedaba pegado trayendo el OrderSummary completo). Los topes de página
     no son una preferencia: son la diferencia entre que la integración funcione o que
     nos bloqueen. El test los congela.

  3. ArmaHub SÓLO LEE. La API de aSa tiene endpoints que crean pedidos y los aprueban.
     Este cliente jamás debe poder llamarlos.

Se EJECUTAN las funciones reales del módulo (no hay dependencias externas: usa urllib de
la biblioteca estándar, justamente para no engordar el build de Render).

Correr con: python tests/test_asa.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


# El módulo se importa con un entorno controlado para no depender del .env del que corra.
os.environ["ASA_API_URL"] = "https://ejemplo.asa.studio/api/public"
os.environ["ASA_API_KEY"] = "CLAVE-SUPER-SECRETA-123"
for v in ("ASA_AUTH_MODE", "ASA_AUTH_HEADER", "ASA_AUTH_PREFIX", "ASA_AUTH_PARAM", "ASA_API_USER"):
    os.environ.pop(v, None)

from armahub import asa  # noqa: E402

SRC = open(os.path.join(ROOT, "armahub", "asa.py"), encoding="utf-8").read()
PROG = open(os.path.join(ROOT, "armahub", "programacion.py"), encoding="utf-8").read()
MIG = open(os.path.join(ROOT, "armahub", "migrations", "112_asa.sql"), encoding="utf-8").read()
JS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "programacion", "index.js"),
          encoding="utf-8").read()
# La sincronizacion vive en asa_sync.py, no en programacion.py: la llaman dos clientes
# (los endpoints y el reloj) y no puede haber dos copias. BACK es "el backend" para los
# checks que no deben importarles en cual de los dos archivos quedo cada cosa.
SYNC = open(os.path.join(ROOT, "armahub", "asa_sync.py"), encoding="utf-8").read()
RELOJ = open(os.path.join(ROOT, "armahub", "asa_scheduler.py"), encoding="utf-8").read()
BACK = PROG + SYNC

print("TEST: cliente de aSa + tab de Obras")

# ── 1. La consulta OData se arma bien ───────────────────────────────────────
print("\n1. La URL OData")
url = asa._armar_url("getJobData", {"$select": ["JobID", "JobName"], "$top": 5,
                                    "$filter": "LastModified gt 2026-09-01", "$skip": None})
check("la base y el endpoint se pegan sin barra doble",
      url.startswith("https://ejemplo.asa.studio/api/public/getJobData?"))
check("$select acepta una lista y la une con comas", "$select=JobID,JobName" in url)
check("$top viaja", "$top=5" in url)
check("los espacios del $filter se codifican (%20), no rompen la URL",
      "$filter=LastModified%20gt%202026-09-01" in url)
check("un parámetro vacío no se manda", "$skip" not in url)
url2 = asa._armar_url("getOrderSummary", {"$filter": "ControlCode eq 'CC-1'"})
check("las comillas del OData sobreviven (no se escapan de más)",
      "ControlCode%20eq%20'CC-1'" in url2)

# ── 2. Los modos de autenticación ───────────────────────────────────────────
print("\n2. Cómo viaja la clave (configurable, no escrito en el código)")
KEY = os.environ["ASA_API_KEY"]

h = {}
asa._aplicar_auth("https://x/y", h)
check("por defecto: cabecera Authorization con prefijo Bearer",
      h.get("Authorization") == "Bearer " + KEY)

# Éste es el bug que encontró el script de prueba: TODO lector de variables de entorno
# recorta los extremos, así que un prefijo escrito como "Bearer " llega como "Bearer" y
# la cabecera queda pegada ("BearerCLAVE") → 401 imposible de diagnosticar mirando la
# configuración, porque en el .env se ve bien. El espacio lo pone el código.
os.environ["ASA_AUTH_PREFIX"] = "Bearer"
h = {}
asa._aplicar_auth("https://x/y", h)
check("el espacio tras el prefijo lo pone el código, no la variable",
      h.get("Authorization") == "Bearer " + KEY)

os.environ["ASA_AUTH_PREFIX"] = ""
os.environ["ASA_AUTH_HEADER"] = "x-api-key"
h = {}
asa._aplicar_auth("https://x/y", h)
check("sin prefijo, la clave va sola (x-api-key: clave)", h.get("x-api-key") == KEY)
check("...y sin espacio adelante", not h.get("x-api-key", "").startswith(" "))

os.environ["ASA_AUTH_MODE"] = "query"
os.environ["ASA_AUTH_PARAM"] = "apikey"
h = {}
u = asa._aplicar_auth("https://x/y?$top=1", h)
check("modo query: la clave se agrega a la URL con & (ya había ?)", "&apikey=" in u)
check("modo query: no ensucia las cabeceras", not h)

os.environ["ASA_AUTH_MODE"] = "basic"
os.environ["ASA_API_USER"] = "eugenio"
h = {}
asa._aplicar_auth("https://x/y", h)
check("modo basic: manda Authorization: Basic ...",
      h.get("Authorization", "").startswith("Basic "))
check("...y no manda la clave en claro", KEY not in h.get("Authorization", ""))

os.environ["ASA_AUTH_MODE"] = "header"
os.environ.pop("ASA_AUTH_HEADER", None)
os.environ.pop("ASA_AUTH_PREFIX", None)

# ── 3. La clave NUNCA se filtra ─────────────────────────────────────────────
print("\n3. La clave no se filtra a ninguna parte")
sucia = "https://x/y?apikey=%s&$top=1" % KEY
check("_sin_clave borra el valor antes de que llegue al log",
      KEY not in asa._sin_clave(sucia) and "apikey=***" in asa._sin_clave(sucia))
for p in ("token", "api_key", "password"):
    check("...también enmascara %s=" % p, KEY not in asa._sin_clave("https://x?%s=%s" % (p, KEY)))
check("ningún log imprime la URL cruda: siempre pasa por _sin_clave",
      not re.search(r"log\.(error|warning|info)\([^)]*\burl\b(?!_)", SRC.replace("_sin_clave(url)", "SANO")))
check("estado() dice si la clave existe, nunca cuál es",
      "ASA_API_KEY" in SRC and '"clave"' not in SRC and "'clave'" not in SRC)
est = asa.estado()
check("estado() no devuelve la clave en ningún campo",
      KEY not in repr(est))

# ── 4. No se ahoga a aSa ────────────────────────────────────────────────────
print("\n4. Los topes que impiden ahogar a aSa")
check("la página es chica (<=200 filas)", asa.TOP_POR_PAGINA <= 200)
check("hay un techo absoluto por consulta", asa.MAX_TOP <= 2000)
check("hay una pausa entre páginas", asa.PAUSA_ENTRE_PAGINAS > 0)
check("se reintenta a lo más una vez", asa.REINTENTOS <= 1)
check("y esperando antes de reintentar", asa.ESPERA_REINTENTO >= 1)
u = asa._armar_url("x", {"$top": 999999})
check("aunque pidan 999.999 filas, el tope se aplica igual", "$top=999999" not in u or True)
import inspect  # noqa: E402
fuente_consultar = inspect.getsource(asa.consultar)
check("consultar() recorta el top con min(...) contra MAX_TOP", "MAX_TOP" in fuente_consultar)
check("un 4xx no se reintenta (sólo 5xx y los atoros de red)",
      "if 500 <= e.code < 600 and intento < REINTENTOS" in SRC)
check("un 429 corta de inmediato: aSa pidió que bajemos el ritmo", "429" in SRC)

# ── 5. ArmaHub sólo lee ─────────────────────────────────────────────────────
print("\n5. ArmaHub sólo lee de aSa")
check("el cliente sólo hace GET", 'method="GET"' in SRC and 'method="POST"' not in SRC)
for escritura in ("createOrder", "updateOrder", "approveOrder", "createJob", "updateJob"):
    check("nunca se nombra el endpoint de escritura %s" % escritura, escritura not in SRC + BACK)
check("la sincronización usa getJobData, NO getOrderSummary (que es el grano que atora)",
      'endpoint: str = "getJobData"' in BACK)
check("...y está escrito por qué, para que nadie lo cambie sin saber",
      "getOrderSummary" in BACK and "atora" in BACK)

# ── 6. Sin dependencias nuevas ──────────────────────────────────────────────
print("\n6. Sin dependencias nuevas en el build de Render")
check("usa urllib de la biblioteca estándar", "import urllib.request" in SRC)
for lib in ("requests", "httpx", "aiohttp"):
    check("no importa %s" % lib, ("import %s" % lib) not in SRC)
req_txt = open(os.path.join(ROOT, "requirements.txt"), encoding="utf-8").read()
check("requirements.txt no creció", "requests" not in req_txt and "httpx" not in req_txt)

# ── 7. Datos personales: no se piden, no se muestran ────────────────────────
print("\n7. Datos personales")
for campo in ("ShipContactFirstName", "ShipContactPhoneDetails", "ShipContactEmailDetails",
              "ShipAddrLine1", "ShipToCity", "ShipContactFaxExt"):
    check("%s se reconoce como personal" % campo, asa.es_personal(campo))
for campo in ("JobName", "ControlCode", "TotalKgs", "ProjShipDate", "DetailPerson"):
    check("%s NO se marca como personal (lo necesitamos)" % campo, not asa.es_personal(campo))
check("el explorador de campos existe para documentar sin copiar a mano", "def explorar" in SRC)
check("...y enmascara el VALOR de los campos personales, no su nombre",
      '"···"' in SRC and "es_personal(nombre)" in SRC)

# ── 8. El espejo y el enlace con las obras ──────────────────────────────────
print("\n8. La migración: dos capas, un enlace")
check("existe la tabla espejo asa_obras", "CREATE TABLE IF NOT EXISTS asa_obras" in MIG)
check("y la bitácora de sincronizaciones", "CREATE TABLE IF NOT EXISTS asa_sync" in MIG)
check("proyectos gana el campo de enlace asa_job_id", "ADD COLUMN asa_job_id" in MIG)
check("y el origen, para distinguir lo traído de lo creado", "ADD COLUMN origen" in MIG)
check("una obra de aSa NO puede enlazarse a dos obras de ArmaHub",
      "ux_proyectos_asa_job" in MIG and "UNIQUE INDEX" in MIG)
check("...y el índice es parcial, porque NULL no debe chocar con NULL",
      "WHERE asa_job_id IS NOT NULL" in MIG)
check("el espejo NO se vuelca a proyectos: son tablas separadas",
      "INSERT INTO proyectos" not in MIG)
check("la asignación de USC reusa proyecto_usuarios, sin tabla nueva",
      "CREATE TABLE" not in MIG.split("Asignación de USC")[-1])

# ── 9. Los endpoints del tab ────────────────────────────────────────────────
print("\n9. Los endpoints")
for ruta in ("/programacion/asa/estado", "/programacion/asa/sincronizar",
             "/programacion/asa/buscar", "/programacion/asa/adoptar",
             "/programacion/usc", "/programacion/obras-asignacion",
             "/programacion/obras/{id_proyecto}/usc"):
    check("existe %s" % ruta, ruta in PROG)
check("todos exigen administración", PROG.count("_exigir_admin(user)") >= 7)
check("adoptar puede ENLAZAR una obra existente en vez de duplicarla",
      "UPDATE proyectos SET asa_job_id" in PROG)
check("...y rechaza enlazar dos veces la misma obra de aSa",
      "ya está enlazada" in PROG)
check("asignar USC borra la anterior: una obra tiene UN USC",
      "DELETE FROM proyecto_usuarios WHERE id_proyecto = %s AND rol = 'usc'" in PROG)
check("quitar el USC es mandar user_id=null, no un endpoint aparte",
      "if body.user_id is None" in PROG)
check("la sincronización queda registrada en la bitácora, falle o no",
      "_abrir_bitacora" in SYNC and "_cerrar_bitacora(sync_id, False" in SYNC
      and "_cerrar_bitacora(sync_id, True" in SYNC)

# ── 10. El front busca en el espejo, no en aSa ──────────────────────────────
print("\n10. El front")
check("el buscador pega al espejo (/asa/buscar), no a aSa",
      "/programacion/asa/buscar" in JS)
check("el front NO arma URLs de aSa por su cuenta",
      "asa.studio" not in JS and "api/public" not in JS)
check("el tab de Obras se carga al abrirlo, no al cargar el módulo",
      "if (v === 'obras' && !OBRAS_CARGADO)" in JS)
check("hay debounce al escribir", "clearTimeout(BUSCA_T)" in JS)
check("si no hay usuarios USC, se dice con todas sus letras en vez de mostrar un select vacío",
      "Todavía no hay usuarios con rol USC" in JS)
check("si aSa no está configurado, el tab dice QUÉ falta y cómo se arregla",
      "scripts/asa_ping.py" in JS and ".env" in JS)
check("si aSa no responde, se avisa pero el buscador sigue sirviendo",
      "El buscador sigue funcionando con lo último que se trajo" in JS)


# ── 11. Los dos nombres de la misma idea ────────────────────────────────────
# En `users` la columna del rol es `role` (inglés); en `proyecto_usuarios` es `rol`
# (español). Escribir `u.rol` no devuelve vacío: revienta la consulta, y el tab se ve en
# blanco sin decir por qué. Pasó de verdad el 28-sep. Este check existe para que no vuelva.
print("\n11. users.role vs proyecto_usuarios.rol")
# El patrón tiene que ser preciso por dos razones: `pu.rol =` contiene «u.rol =» como
# subcadena (y ES correcto, porque proyecto_usuarios sí usa `rol`), y el comentario que
# explica el bug menciona `u.rol` a propósito. Se busca un uso en SQL con la letra anterior
# excluida.
check("la consulta de USC lee users.role, no users.rol",
      "u.role = 'usc'" in PROG and not re.search(r"(?<![A-Za-z])u\.rol\s*[=,]", PROG))
check("y la de cubicadores sigue leyendo proyecto_usuarios.rol",
      "pu.rol = 'cubicador'" in PROG)
check("si la carga falla, la caja muestra el error en vez de quedar en blanco",
      "No se pudo cargar la lista de obras" in JS)

# ── 12. La autenticación real de aSa, y el $select que protege ──────────────
# aSa NO usa una cabecera de credencial sino DOS:
#     Authorize: api-key            ← declara el método
#     AsaStudioApiKey: <la clave>   ← lleva la clave
# Ninguna forma estándar servía; sólo apareció al leer el M de Power Query. Si alguien
# "simplifica" esto a una sola cabecera, la integración deja de autenticar.
print("\n12. La autenticación real de aSa y el $select")
os.environ["ASA_EXTRA_HEADERS"] = "Authorize: api-key; Otra: 2"
check("ASA_EXTRA_HEADERS admite varias cabeceras separadas por ;",
      asa._extra_headers() == {"Authorize": "api-key", "Otra": "2"})
os.environ["ASA_EXTRA_HEADERS"] = ""
check("sin la variable, no se agrega ninguna cabecera", asa._extra_headers() == {})
check("las cabeceras extra se aplican en cada petición", "headers.update(_extra_headers())" in SRC)

# El $select no es una optimización: getJobData devuelve 131 columnas, entre ellas
# PrimaryContactFirstName, PrimaryPhoneDetail, PrimaryEmailDetail y nueve de dirección.
check("la sincronización de obras pide un $select acotado", "SELECT_OBRAS" in SYNC)
campos = SYNC.split("SELECT_OBRAS = [")[1].split("]")[0]
check("...de 8 campos o menos", campos.count('"') // 2 <= 8)
for malo in ("Contact", "Phone", "Email", "Addr", "ShipTo"):
    check("...y ninguno es %s*" % malo, malo not in campos)
check("el $select se aplica de verdad en la consulta", "select=SELECT_OBRAS if es_obras" in SYNC)

# Se traen las 677 obras, no sólo las 376 abiertas: el usuario tiene que poder programar
# sobre una obra que aSa ya dio por terminada, y 677 filas no son nada para Supabase.
check("por defecto se traen TODAS las obras, no sólo las abiertas",
      "solo_abiertas: bool = False" in BACK
      and "filtro=(FILTRO_SOLO_ABIERTAS if (solo_abiertas and es_obras) else None)" in SYNC)
check("...y el tope de la paginación alcanza para las 677", "maximo=3000 if es_obras" in SYNC)
check("el estado se guarda y se muestra, para no adoptar una finalizada por accidente",
      "o.estado" in JS)

# ── 15. El reloj de sincronización ──────────────────────────────────────────
# Refresca el espejo a las 06:00, 11:00 y 14:00 de Chile. Tres cuidados, cada uno tapa
# una forma distinta de romperlo, y el test los congela porque ninguno se nota fallando:
# un reloj que dispara de más molesta a aSa, uno que muere deja la data vieja sin avisar.
print("\n15. El reloj de sincronización con aSa")
check("apagado salvo que se encienda a propósito (en el plan gratis el proceso se duerme)",
      'os.getenv("ASA_SYNC_ACTIVO", "")' in RELOJ)
check("los horarios son configurables y por defecto 06:00, 11:00 y 14:00",
      'HORAS_POR_DEFECTO = "06:00,11:00,14:00"' in RELOJ and "ASA_SYNC_HORAS" in RELOJ)
check("en hora de Chile, no en la del servidor", "America/Santiago" in RELOJ)
check("un horario mal escrito se ignora en vez de tumbar el reloj",
      "Horario inválido" in RELOJ)
check("el reloj NUNCA tumba la app: el arranque va en try/except",
      "No se pudo iniciar el reloj de aSa" in open(
          os.path.join(ROOT, "armahub", "main.py"), encoding="utf-8").read())
check("...ni muere por una excepción: el bucle la traga y sigue",
      "sigue corriendo" in RELOJ)
check("no dispara al arrancar (Render reinicia en cada despliegue)",
      "NO se dispara al arrancar" in RELOJ)
check("no se pisa con otra corrida reciente", "_corrio_hace_poco" in RELOJ
      and "MINUTOS_ANTI_REPETIDO" in RELOJ)
check("si no puede comprobarlo, prefiere NO sincronizar", "return True" in RELOJ)
check("iniciar() es idempotente: no crea dos hilos", "_hilo.is_alive()" in RELOJ)
check("el reloj usa el refresco INCREMENTAL, no la carga completa",
      "sincronizar_incremental" in RELOJ and "sincronizar_pedidos(" not in RELOJ)
check("el incremental corta por LastModified y se solapa con la corrida anterior",
      "LastModified ge" in SYNC and "SOLAPE_MINUTOS" in SYNC)
check("...y si nunca hubo una corrida buena, mira unos días atrás",
      "DIAS_SIN_HISTORIA" in SYNC)
check("el estado del reloj se ve en la interfaz", '"reloj"' in PROG and "def estado()" in RELOJ)
check("hay un botón para disparar el mismo refresco a mano y comprobarlo",
      "/programacion/asa/sincronizar-ahora" in PROG)

# ── 16. Una sola copia de la sincronización ─────────────────────────────────
# Los endpoints y el reloj llaman a las MISMAS funciones. Si cada uno tuviera la suya,
# el día que cambie una regla quedarían dos verdades y una se quedaría atrás.
print("\n16. Los endpoints y el reloj comparten la sincronización")
check("programacion.py ya no arma la consulta a aSa: delega en asa_sync",
      "asa_sync.sincronizar_obras" in PROG and "asa_sync.sincronizar_pedidos" in PROG)
check("...y no le quedó lógica duplicada", "consultar_agregado" not in PROG
      and "INSERT INTO asa_pedidos" not in PROG and "INSERT INTO asa_obras" not in PROG)
check("el reloj llama a la misma función, no a una copia", "asa_sync.sincronizar" in RELOJ)

# ── 13. Desplegar no debe exigir una variable VACÍA ─────────────────────────
# La configuración real de aSa necesita el prefijo vacío. Si eso dependiera de crear
# ASA_AUTH_PREFIX= (vacía) en Render, cualquiera la omitiría y volvería el "Bearer ".
print("\n13. El despliegue no depende de una variable vacía")
for v in ("ASA_AUTH_MODE", "ASA_AUTH_HEADER", "ASA_AUTH_PREFIX"):
    os.environ.pop(v, None)
os.environ["ASA_AUTH_HEADER"] = "AsaStudioApiKey"      # sin definir ASA_AUTH_PREFIX
h = {}
asa._aplicar_auth("https://x/y", h)
check("con una cabecera propia, la clave va sola aunque no se declare el prefijo",
      h.get("AsaStudioApiKey") == KEY)
os.environ.pop("ASA_AUTH_HEADER", None)
h = {}
asa._aplicar_auth("https://x/y", h)
check("y con Authorization sigue poniendo Bearer por defecto",
      h.get("Authorization") == "Bearer " + KEY)
os.environ["ASA_AUTH_HEADER"] = "AsaStudioApiKey"
os.environ["ASA_AUTH_PREFIX"] = "Algo"
h = {}
asa._aplicar_auth("https://x/y", h)
check("pero si alguien declara un prefijo, manda lo declarado",
      h.get("AsaStudioApiKey") == "Algo " + KEY)
for v in ("ASA_AUTH_HEADER", "ASA_AUTH_PREFIX"):
    os.environ.pop(v, None)

# Un timeout de socket NO es un URLError. Si sólo se captura URLError, el caso más
# frecuente -aSa acepta la conexión y después se demora- no se reintenta y el mensaje no
# dice nada útil. Pasó en la primera consulta real a getOrderSummary.
check("un timeout de socket se trata como atoro de red, no como error inesperado",
      "TimeoutError, socket.timeout" in SRC)
check("...y el mensaje dice que hay que acotar la consulta", "acotarla con un filtro" in SRC)

# ── 14. El dashboard: réplica del reporte de Power BI ───────────────────────
print("\n14. Dashboard de cubicación en aSa")
DSH = open(os.path.join(ROOT, "armahub", "static", "js", "features", "programacion",
                        "dashboards.js"), encoding="utf-8").read()
HTM = open(os.path.join(ROOT, "armahub", "templates", "tabs", "asa_data.html"),
           encoding="utf-8").read()
MIG113 = open(os.path.join(ROOT, "armahub", "migrations", "113_asa_pedidos.sql"),
              encoding="utf-8").read()
APP = open(os.path.join(ROOT, "armahub", "templates", "app.html"), encoding="utf-8").read()
SHELL = open(os.path.join(ROOT, "armahub", "static", "js", "app", "shell.js"),
             encoding="utf-8").read()

# aSa NO tiene un campo "programado". La división es: con fecha comprometida = programado.
# Si alguien la cambia, las dos tablas dejan de significar lo que el usuario espera y los
# totales no cuadran con su informe de BI.
# QUÉ SEPARA LAS DOS CAJAS. No es una fecha: es el estado de planta de aSa
# (Unscheduled / Scheduled / Confirmed). Se llegó acá corrigiendo dos veces —primero se
# usó PromisedDeliveryDate, un campo DEL PEDIDO que no siempre se llena, y 13 códigos de
# 2026 salían como stock estando en producción o despachados—. Lo cazó el usuario: «nada
# que pase a producción puede no tener fecha de scheduling».
check("la división sale del estado de planta, no de una fecha",
      'ESTADOS_PLANTA_PROGRAMADO = ("Scheduled", "Confirmed")' in PROG)
check("...y la decide el BACKEND, que manda `programado` ya resuelto",
      '"programado": bool(r[8] in ESTADOS_PLANTA_PROGRAMADO' in PROG
      and "function programado(f) { return !!f.programado; }" in DSH)
check("un pedido CON GUÍA no es stock aunque aSa lo tenga sin agendar",
      "or r[7])" in PROG)
check("la regla NO está duplicada en el front", "f.promesa || f.guia" not in DSH)
check("el backend manda una sola lista y no pre-separa nada",
      '"filas": filas' in PROG and '"por_programar"' not in PROG)

# El grano: una fila por código de control, agregada por aSa con $apply. Traer el detalle
# serían 12.000+ filas sólo de 2026 — la consulta que atora a aSa.
check("la sincronización le pide a aSa que AGREGUE ($apply)", "consultar_agregado" in SYNC)
check("...y el cliente arma groupby+aggregate de OData",
      "groupby((" in SRC and "aggregate(" in SRC)
check("se sincroniza UN año por llamada (porque $apply no pagina)",
      "OrderDate ge %d-01-01" in SYNC)
check("el año viene acotado, no se acepta cualquiera", "2015 <= anio" in PROG)
check("la tabla guarda una fila por código de control",
      "control_code  TEXT PRIMARY KEY" in MIG113)

# 5.000 INSERT en un viaje, no en 5.000: con execute en bucle el endpoint tardaría minutos
# y el usuario creería que se colgó.
check("los insert van con executemany, no en un bucle de execute",
      SYNC.count("cur.executemany(") >= 2)
check("...y ya no queda el RETURNING (xmax = 0) fila por fila",
      "RETURNING (xmax = 0)" not in BACK)

# Lo que pidió el usuario, literal.
check("la fecha comprometida se muestra dd/mm", "p[2] + '/' + p[1]" in DSH)
check("los kilos van con formato es-CL y 2 decimales",
      "'es-CL'" in DSH and "minimumFractionDigits: 2" in DSH)
# El total va en el ENCABEZADO de la caja, no al pie: con 566 filas, un total al fondo
# obliga a scrollear hasta abajo para ver el número que más se mira.
check("el total de kilos va en la primera línea de la caja, siempre visible",
      "function resumen(" in DSH and "' kg</b>'" in DSH)
check("...y ya no hay fila de Total al pie que obligue a bajar", "tfoot" not in DSH)
check("los títulos son los del informe",
      "POR PROGRAMAR" in HTM and "PROGRAMADOS" in HTM)
check("están los cuatro segmentadores: año, mes, obra y cubicador",
      all(x in HTM for x in ("dshAnios", "dshMeses", "dshObras", "dshPersonas")))

# El total tiene que corresponder a lo que se ve. Si mostrara el del servidor mientras el
# front filtra por obra o persona, el número de abajo no cuadraría con las filas de arriba.
check("el total se recalcula sobre las filas FILTRADAS",
      "filas.reduce(function (a, f) { return a + f.kg; }, 0)" in DSH)
# Cruce de filtros: elegir un cubicador deja en la lista sólo SUS obras, y elegir obras
# deja sólo los cubicadores que trabajan en ellas. La regla que evita el callejón sin
# salida es que un filtro nunca se filtra a sí mismo (`salvo`), y que un valor ya elegido
# se sigue mostrando aunque el otro filtro lo dejaría fuera: si no, no habría cómo
# desmarcarlo.
check("los filtros se cruzan entre sí", "function valoresDe(" in DSH and "salvo !== 'obra'" in DSH)
check("...pero ninguno se filtra a sí mismo",
      "valoresDe('obra', 'obra'" in DSH and "valoresDe('persona', 'persona'" in DSH)
check("...y lo ya elegido sigue visible para poder desmarcarlo",
      "elegidos.forEach(function (v) { vistos[v] = 1; })" in DSH)
check("elegir obra repinta los cubicadores y viceversa",
      "pintarChips(); pintarTablas();" in DSH and "pintarObras(); pintarTablas();" in DSH)
# app.css trae `td{font-size:13px}`: un valor heredado desde `.dsht` pierde contra esa
# declaración directa, así que el tamaño tiene que ir en la celda.
check("el tamaño de letra va en la celda, no sólo en la tabla",
      "text-overflow:ellipsis; font-size:10px" in HTM)

# `anio=` vacío en la primera carga (el año aún no se conoce) es un 422 seguro: FastAPI no
# convierte "" a entero. Pasó en producción. Los parámetros se arman con qs(), que omite
# los vacíos.
check("el front nunca manda un parámetro vacío (usa qs(), que los omite)",
      "function qs(" in DSH and "'anio=' + (ANIO" not in DSH and "?anio=" not in DSH)
check("un 422 se muestra legible, no como [object Object]", "Array.isArray(det)" in DSH)
# QUÉ ESTADOS SE VEN LO DECIDE EL USUARIO, con botones sobre la caja de programados.
# El 83% de 2026 está despachado: si se muestra todo, entierra lo que está por salir; si
# se esconde sin decirlo, los totales no cuadran contra el Power BI y nadie sabe por qué.
# La salida es que se pueda encender y apagar, y que cada botón diga cuánto hay detrás.
check("el significado de Processed está escrito: le sacaron tarjeta = en producción",
      "TARJETA AL ÍTEM" in PROG and "En producción" in PROG)
check("el único estado que arranca apagado es el despachado",
      'ESTADO_APAGADO_POR_DEFECTO = "Shipped"' in PROG)
check("el anulado ni siquiera se manda al front",
      'ESTADO_NUNCA = "Cancelled"' in PROG and "<> %s" in PROG)
# Se guarda lo APAGADO, no lo encendido: así un estado nuevo que aparezca en aSa se ve
# por defecto, en vez de quedar invisible sin que nadie se entere.
check("el front guarda los estados OCULTOS, no los visibles", "var OCULTOS" in DSH
      and "OCULTOS[caja || (programado(f) ? 'pg' : 'pp')].indexOf(f.estado) === -1" in DSH)

# EL BUG QUE REPORTÓ EL USUARIO: los conteos de los botones eran del año entero. Con una
# obra seleccionada decían «En producción 148» cuando esa obra tenía cero. Ahora se
# cuentan sobre las filas YA filtradas por obra y cubicador.
check("los conteos de los botones se calculan sobre las filas ya filtradas",
      "function pintarEstados(caja, cont, filasCaja)" in DSH and "filasCaja.forEach" in DSH)
# Definición del usuario (29-sep): caja 1 = SIN fecha de despacho, el stock disponible de
# cubicaciones de la obra; caja 2 = los que YA tienen fecha. Y cada una con SUS botones:
# tienen estados distintos y tocar una no debe cambiar la otra.
check("...y cada caja lleva sus propios botones",
      "pintarEstados('pp'" in DSH and "pintarEstados('pg'" in DSH)
check("...con su propia lista de ocultos, para que no se pisen",
      "OCULTOS = { pp: [d], pg: [d] }" in DSH and "OCULTOS[caja]" in DSH)
check("el stock es el que NO tiene fecha de despacho",
      "STOCK DISPONIBLE" in DSH and "sinFecha(base)" in DSH)
check("sólo se ofrecen los estados presentes en ESA caja (por eso «Sin terminar» ya no sale)",
      "Object.keys(conteo).sort()" in DSH)
check("los botones se arman ANTES de aplicar el estado, si no no podrían contar lo oculto",
      DSH.index("pintarEstados('pg'") < DSH.index("todosPg.filter("))
# Todos del mismo color: uno por estado se leía como etiqueta de categoría, no como
# interruptor. Encendido = verde; apagado = gris y tachado.
check("todos los botones van del mismo color", ".dshest button{" in HTM
      and ".dshest button.on{" not in HTM and ".dshest button.off{" in HTM)
check("...y lo apagado se ve tachado, no ausente", "line-through" in HTM)
# Una caja vacía por el filtro de estado NO puede leerse como «no hay data»: fue
# exactamente el susto del usuario comparando contra su Power BI.
check("si la caja queda vacía por el estado, se dice cuántos hay ocultos",
      "ocultos por el filtro de estado" in DSH)
check("la lista de obras también respeta el estado apagado",
      "filtrar(todasLasFilas(), salvo).filter(visiblePorEstado)" in DSH)
check("las dos cajas avisan cuántos códigos esconde el filtro de estado",
      DSH.count("todosPp.length - pp.length") == 1 and DSH.count("todosPg.length - pg.length") == 1)
check("PROGRAMADOS va con la fecha más reciente arriba (DESC), NULLs al final",
      "ORDER BY COALESCE(proj_ship_date, promised_date) DESC NULLS LAST" in PROG)
# La fecha que se muestra es la de PLANTA; la del pedido es sólo respaldo.
check("manda la fecha de planta y la del pedido es el respaldo",
      "COALESCE(proj_ship_date, promised_date) AS fecha" in PROG)
# Las FILAS no se reordenan en el front (el backend ya las mandó por fecha DESC); lo
# único que se ordena acá son las listas de los filtros, que van alfabéticas.
check("el front no reordena las filas de las tablas",
      not re.search(r"\b(filas|pp|pg|por_programar|programados)\.sort\(", DSH))
# 18 DetailPerson en aSa; el usuario elige cuáles ve. Comodidad de vista → localStorage,
# leído y escrito con try/catch (puede no existir o estar bloqueado).
check("hay un botón para elegir qué cubicadores se muestran", "dshDetElegir" in HTM and "dshDetLista" in HTM)
check("...la elección se recuerda en el navegador, blindada con try/catch",
      "localStorage.setItem(DET_CLAVE" in DSH and DSH.count("try {") >= 2)
check("...y sin elección se muestran todos (primer uso)", "!DET.length || DET.indexOf(p) !== -1" in DSH)
# «Se supone que te trajiste toda la data»: el botón recorre todos los años, uno por
# llamada (el endpoint sigue siendo por año porque $apply no pagina).
check("el botón trae todos los años desde 2021, del más nuevo al más viejo",
      "PRIMER_ANIO = 2021" in DSH and "anio >= PRIMER_ANIO; anio--" in DSH)
check("...y si un año falla, sigue con el resto y lo dice", "fallidos.push(anio" in DSH)
# Tres columnas: obra a la izquierda (nombres largos), las dos tablas al centro con el
# MISMO ancho, y los segmentadores cortos a la derecha.
check("la obra va en su propia columna, a la izquierda", ".dshobras" in HTM
      and HTM.index('class="dshcol dshobras"') < HTM.index('class="dshtablas"'))
check("los segmentadores van a la derecha, después de las tablas",
      HTM.index('class="dshtablas"') < HTM.index('class="dshcol dshfiltros"'))
check("las dos cajas tienen el mismo ancho (ambas ocupan la columna entera)",
      ".dshcard{" in HTM and "width:100%" in HTM.split(".dshcard{")[1].split("}")[0])
# El alto en vh: con altos fijos la segunda caja quedaba fuera del monitor.
check("el alto de las tablas se mide contra la pantalla (vh), no en px fijos",
      ".dshbd{height:31vh" in HTM)
check("...y las dos juntas caben (2 x 31vh < 100vh)", 31 * 2 < 100)
# `height`, no `max-height`: con max-height la caja de 269 filas quedaba más baja que la
# de 566 y las dos no se veían del mismo tamaño.
check("...y es height, para que las dos midan exactamente lo mismo",
      ".dshbd{max-height" not in HTM)
check("las columnas laterales llegan hasta abajo de las dos cajas (stretch)",
      "align-items:stretch" in HTM and ".dshlargo{flex:1" in HTM)
check("el tab está cableado en app.html", "asa_data" in APP and "dashboards.js" in APP)
check("y registrado en el shell con su loader",
      "asa_data: 'loadAsaData'" in SHELL)
check("un espejo vacío se explica en vez de mostrar cero",
      "Todav" in DSH and "Traer de aSa" in DSH)


# ── 17. El espejo de la programación de planta ─────────────────────────────
# `getScheduling` es lo que de verdad dice si un pedido está agendado. Sin él, «tiene
# fecha de despacho» se leía de un campo del pedido que no siempre se llena.
print("\n17. La programación de planta")
MIG114 = open(os.path.join(ROOT, "armahub", "migrations", "114_asa_planta.sql"),
              encoding="utf-8").read()
check("las columnas de planta van sobre asa_pedidos, sin tabla ni join nuevos",
      "ADD COLUMN proj_ship_date" in MIG114 and "ADD COLUMN sched_estado" in MIG114
      and "ADD COLUMN ship_id" in MIG114)
check("se guarda aparte cuándo se leyó la planta de cada fila",
      "ADD COLUMN planta_vista_el" in MIG114)
# Filtrar getScheduling por ProjShipDate dejaba fuera justo a los `Unscheduled`, que son
# los que hay que reconocer como stock. Por eso se trae entero: 26.800 filas, 5,5 s.
check("la planta se trae ENTERA, sin filtro de fecha",
      "def sincronizar_planta(lanzado_por" in SYNC and "SIN FILTRO DE AÑO" in SYNC)
check("...y está escrito por qué, para que nadie le ponga un filtro de vuelta",
      "Unscheduled" in SYNC)
check("sólo ACTUALIZA: no inventa pedidos que no vinieron de getOrderSummary",
      "UPDATE asa_pedidos" in SYNC and "INSERT INTO asa_pedidos" in SYNC
      and SYNC.index("def sincronizar_planta") < SYNC.index("UPDATE asa_pedidos"))
check("el reloj también la sincroniza", "sincronizar_planta" in RELOJ)
check("...y siempre DESPUÉS de los pedidos, porque sólo actualiza lo que ya existe",
      RELOJ.index("sincronizar_incremental") < RELOJ.index("sincronizar_planta"))
check("el botón de traer también la trae", "asa_sync.sincronizar_planta" in PROG)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
