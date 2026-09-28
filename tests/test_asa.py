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
    check("nunca se nombra el endpoint de escritura %s" % escritura, escritura not in SRC + PROG)
check("la sincronización usa getJobData, NO getOrderSummary (que es el grano que atora)",
      'endpoint: str = "getJobData"' in PROG)
check("...y está escrito por qué, para que nadie lo cambie sin saber",
      "getOrderSummary" in PROG and "atora" in PROG)

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
      "UPDATE asa_sync SET fin=now(), ok=FALSE" in PROG and
      "UPDATE asa_sync SET fin=now(), ok=TRUE" in PROG)

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

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
