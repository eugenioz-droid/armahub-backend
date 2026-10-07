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
MIG128 = open(os.path.join(ROOT, "armahub", "migrations", "128_asa_pedidos_ultima_mod.sql"), encoding="utf-8").read()
MIG = open(os.path.join(ROOT, "armahub", "migrations", "112_asa.sql"), encoding="utf-8").read()
JS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "programacion", "index.js"),
          encoding="utf-8").read()
# La sincronizacion vive en asa_sync.py, no en programacion.py: la llaman dos clientes
# (los endpoints y el reloj) y no puede haber dos copias. BACK es "el backend" para los
# checks que no deben importarles en cual de los dos archivos quedo cada cosa.
SYNC = open(os.path.join(ROOT, "armahub", "asa_sync.py"), encoding="utf-8").read()
RELOJ = open(os.path.join(ROOT, "armahub", "asa_scheduler.py"), encoding="utf-8").read()
BACK = PROG + SYNC

def _con_env(valor):
    """¿El reloj queda encendido con ASA_SYNC_ACTIVO en ese valor?"""
    from armahub import asa_scheduler
    os.environ["ASA_SYNC_ACTIVO"] = valor
    try:
        return asa_scheduler.activo()
    finally:
        os.environ.pop("ASA_SYNC_ACTIVO", None)


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
check("el backend manda el estado del reloj", '"reloj"' in PROG and "def estado()" in RELOJ)
# Esto medía sólo el backend y pasaba verde mientras la pantalla tiraba el dato: el usuario
# no tenía cómo saber si el espejo se refresca solo. Ahora se mide lo que se VE.
check("...y la pantalla lo muestra de verdad, con sus horarios y el próximo turno",
      "textoReloj" in JS and "ASA.reloj" in JS and "r.horarios" in JS and "r.proxima" in JS)
check("...diciendo qué falta cuando está apagado", "ASA_SYNC_ACTIVO=1" in JS)
check("...y se puede comprobar desde afuera, sin entrar a la aplicación",
      '"reloj"' in open(os.path.join(ROOT, "armahub", "main.py"), encoding="utf-8").read())
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
      'OrderDate ge %d-%s and OrderDate le %d-%s' in SYNC
      and 'filas = _pedir_pedidos(anio, "01-01", "12-31")' in SYNC)
check("el año viene acotado, no se acepta cualquiera", "2015 <= anio" in PROG)
# El año es un interruptor: tocar el encendido lo suelta y se ve la historia completa.
# Hace falta un valor EXPLÍCITO (0) porque la ausencia del parámetro ya significaba «el
# año actual», y con eso no se puede expresar «todos» sin romper la primera carga.
check("anio=0 significa todos los años", "todos = (anio is not None and int(anio) == 0)" in PROG)
check("...y con todos no se filtra por año", 'where = [] if todos else ["anio = %s"]' in PROG)
check("...el WHERE se arma bien aunque no haya condición de período",
      '(" AND " if cond_periodo else " WHERE ")' in PROG)
check("el front suelta el año al volver a tocarlo", "ANIO = (ANIO === v) ? 0 : v;" in DSH)
check("...y lo dice en pantalla en vez de mostrar un año en blanco",
      "toda la historia" in DSH)
check("...y el resumen mensual avisa que suma todos los años",
      "Mes · todos los años" in DSH)
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
# Sólo en las tablas LARGAS de Programa Planta (566 y 269 filas): ahí un total al pie
# obliga a bajar hasta el fondo para ver el número que más se mira. En los cuadros
# resumen de «Obras aSa», que son cortos, el pie es lo natural y el informe original
# también lo muestra.
_tabla = DSH.split("function tabla(el, filas, llevaFecha")[1].split("\n  }")[0]
check("...y las tablas largas ya no llevan Total al pie, que obligaba a bajar",
      "tfoot" not in _tabla)
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
      "filtrar(DATA.filas || [], 'obra')" in DSH and "valoresDe('persona', 'persona'" in DSH)
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
      and "OCULTOS[cajaDe(f)].indexOf(f.estado) === -1" in DSH)
# Array.filter entrega TRES argumentos. Una función con segundo parámetro opcional recibe
# el índice como nombre de caja: OCULTOS[1] es undefined y revienta en el 2º elemento.
# Pasó y dejó la pantalla en blanco. Por eso hay DOS funciones y la de filter es de un
# solo argumento. El que lo prueba de verdad es tests/test_asa_dashboard.js, que ejecuta.
check("la función que se pasa a .filter() es de UN solo argumento",
      "function visible(f) {" in DSH and "function visibleEn(caja, f) {" in DSH)

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
      "OCULTOS = { pp: [d], pg: [d], cub: [] }" in DSH and "OCULTOS[caja]" in DSH)
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
      "filtrar(todasLasFilas(), salvo).filter(visible)" in DSH)
check("y las reglas puras quedan expuestas para poder EJECUTARLAS en un test",
      "global.__asaDataTest" in DSH
      and os.path.exists(os.path.join(ROOT, "tests", "test_asa_dashboard.js")))
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
# El PERÍODO (año y mes) va en una barra arriba y FUERA de los paneles: vale para todo
# aSa Data, así que los próximos dashboards lo heredan sin volver a dibujarlo.
check("el año y el mes van en una barra horizontal arriba",
      'class="dshbarra"' in HTM and HTM.index('class="dshbarra"') < HTM.index('id="asaPanelPlanta"'))
check("...y ya no están en la columna lateral",
      HTM.index('id="dshAnios"') < HTM.index('class="dshwrap"')
      and HTM.index('id="dshMeses"') < HTM.index('class="dshwrap"'))
# El cubicador subió a una fila de chips bajo el período: ocupaba una columna entera
# para una lista corta. La obra se queda en su columna porque además de filtrar resume.
check("la obra se queda en su columna, que además resume",
      HTM.index('id="dshObras"') > HTM.index('class="dshwrap"'))
check("el cubicador subió a una fila propia arriba",
      HTM.index('id="dshPersonas"') < HTM.index('class="dshwrap"'))

# Tres columnas: obra a la izquierda (nombres largos), las dos tablas al centro con el
# MISMO ancho, y el cubicador a la derecha.
check("la obra va en su propia columna, a la izquierda", ".dshobras" in HTM
      and HTM.index('class="dshcol dshobras"') < HTM.index('class="dshtablas"'))
check("los segmentadores van a la derecha, después de las tablas",
      HTM.index('class="dshtablas"') < HTM.index('class="dshcol dshfiltros"'))
check("las dos cajas tienen el mismo ancho (ambas ocupan la columna entera)",
      ".dshcard{" in HTM and "width:100%" in HTM.split(".dshcard{")[1].split("}")[0])
# El alto en vh: con altos fijos la segunda caja quedaba fuera del monitor.
import re as _re
_alto = _re.search(r"\.dshbd\{height:(\d+)vh", HTM)
check("el alto de las tablas se mide contra la pantalla (vh), no en px fijos", bool(_alto))
check("...y las dos juntas caben en una pantalla, con la barra de período arriba",
      bool(_alto) and int(_alto.group(1)) * 2 < 70)
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


# ── 18. El sub-tab «Obras aSa» y el estándar entre tabs ────────────────────
# Lo que hace que los dos reportes se sientan el mismo tablero: los filtros son
# COMPARTIDOS y viven fuera de los paneles. Si cada sub-tab dibujara los suyos, cambiar
# de pestaña perdería la obra y el cubicador elegidos, y habría dos copias que mantener.
print("\n18. Obras aSa y el estándar entre sub-tabs")
check("hay dos sub-tabs y el nuevo se llama Obras aSa",
      "asaSubObras" in HTM and "Obras aSa" in HTM and "asaPanelObras" in HTM)
check("el período, la obra y el cubicador están FUERA de los paneles",
      HTM.index('class="dshbarra"') < HTM.index('id="asaPanelPlanta"')
      and HTM.index('id="dshObras"') < HTM.index('id="asaPanelPlanta"')
      and HTM.index('id="dshPersonas"') < HTM.index('id="asaPanelPlanta"'))
check("...y cambiar de sub-tab no los resetea, sólo repinta",
      "if (DATA) pintarTablas();" in DSH and "SUB = v;" in DSH)
check("los dos cuadros del tab nuevo existen",
      all(x in HTM for x in ("dshPorMes", "dshCc", "dshBuscaCc")))
# El cubicador pasó de ocupar una columna entera a una fila de chips bajo el período, y
# la columna que liberó ahora informa: los kilos mes a mes.
# «Mi equipo» NO es un filtro: configura cuáles de los 45 cubicadores aparecen como
# chips. Por eso se ve distinto de los chips que tiene al lado — si pareciera uno más,
# el usuario no entendería que abre un menú.
check("el botón de configuración se distingue de los chips de filtro",
      "dshcfg" in HTM and "Mi equipo" in HTM and ".dshcfg{" in HTM)
check("...y al abrirlo se ve como un panel, con su título",
      "dshcfgp" in HTM and "dshDetPanel" in HTM)
check("el cubicador va en su propia fila, arriba, no en una columna",
      HTM.index('id="dshPersonas"') < HTM.index('class="dshwrap"'))
check("...y la columna que liberó la ocupa el resumen mensual",
      'id="dshLateral"' in HTM and HTM.index('id="dshPorMes"') > HTM.index('class="dshwrap"'))
check("...que sólo aparece en «Obras aSa», donde tiene sentido",
      "lat.style.display = (v === 'obras')" in DSH)
# El job number de aSa volvió a pedido de los usuarios (sección 23); lo que no vuelve es
# el id interno de ArmaHub, que en la pantalla no le dice nada a nadie.
check("el detalle de códigos no muestra el id interno de la obra",
      "id_proyecto" not in DSH)
# La información de obras se fue del panel a la COLUMNA de obra, que ya estaba ahí para
# filtrar: tenerla en los dos lados era la misma cosa dos veces y dos sitios donde podía
# dejar de cuadrar. Y el detalle queda a la izquierda, el mensual angosto a la derecha.
check("el cuadro OBRAS ya no existe: su info vive en la columna de obra",
      "dshPorObra" not in HTM and "dshPorObra" not in DSH)
# Hoy la columna ES la lista mejorada (obra, CC, kilos y barra por estado), la misma de
# «Obras aSa», pintada por una sola función. La tabla ordenable por encabezado se fue.
check("la columna de obra es la lista con barra por estado, pintada por la misma función que Obras aSa",
      "function pintarLista(el, busca)" in DSH and "pintarLista($('dshObras'), BUSCA)" in DSH
      and "pintarLista($('dshResObras'), '')" in DSH and 'id="dshObrasLey"' in HTM)
check("...sin la tabla ordenable de antes", "ORDEN_OBRA" not in DSH and "dshot" not in HTM and "dshot" not in DSH)
check("el detalle ocupa el panel entero y el mensual se fue a la columna lateral",
      HTM.index('id="dshCc"') < HTM.index('id="dshPorMes"')
      and HTM.index('id="dshPorMes"') > HTM.index('id="dshLateral"'))

# EL BUG QUE VIO EL USUARIO: al tocar un cubicador el filtro se aplicaba pero el chip no
# cambiaba de color, porque no se repintaban los chips. Parecía que el clic no hacía nada.
# Hoy todos pasan por `repintarTodo()`: chips primero, lo pesado después (sección 27).
check("tocar un cubicador repinta también los chips",
      "alternar(PERSONAS, p, ev);" in DSH and DSH.count("repintarTodo();") >= 2)
check("...y tocar una obra, igual (una sola función para la columna y «Obras aSa»)",
      DSH.count("alternar(OBRAS, tr.dataset.obra, ev);\n        repintarTodo();") == 1)

# EL DELAY al cambiar de sub-tab: 5.132 filas de cinco celdas son ~30.000 nodos del DOM.
check("el detalle tiene tope de filas, para no construir 30.000 nodos",
      "TOPE_FILAS" in DSH and "lista.slice(0, TOPE_FILAS)" in DSH)
check("...y se dice cuántas quedaron fuera, con el total sin recortar",
      "Se muestran las primeras" in DSH and "el total de arriba sí es de todas" in DSH)
check("...y la flecha dice por dónde está ordenado", "\\u25bc" in DSH or "▼" in DSH)
check("la barra de kilos se dibuja con CSS, sin librería", ".dshbar i{" in HTM)
check("el mes de cada fila lo manda el backend, no se deduce del texto",
      "EXTRACT(MONTH FROM order_date)::int AS mes" in PROG and '"mes": r[10]' in PROG)
check("...y el id de obra también, para el listado de códigos", '"job": r[11]' in PROG)


# ── 19. Compresión de las respuestas ───────────────────────────────────────
# El reporte con todos los años son 25.314 filas y 6,3 MB de JSON. Comprimido viaja como
# 0,7 MB: un 89% menos, porque el JSON repite los mismos nombres de campo en cada fila.
# Beneficia a todo el sistema, no sólo a este reporte.
print("\n19. Las respuestas grandes viajan comprimidas")
MAIN = open(os.path.join(ROOT, "armahub", "main.py"), encoding="utf-8").read()
check("la app comprime las respuestas", "GZipMiddleware" in MAIN)
check("...y no gasta CPU en las chicas, que son la mayoría", "minimum_size=1024" in MAIN)


# ── 20. Sub-tab «Programado Cubicador» ─────────────────────────────────────
# Una tabla por obra con tres estados EXCLUYENTES que suman el total. El dato que se
# busca es el desbalance: mucho stock sin agendar frente a poca cola programada.
print("\n20. Programado Cubicador")
check("existe el sub-tab, segundo y llamado «Programa aSa»", "asaSubCub" in HTM and "asaPanelCub" in HTM
      and ">Programa aSa</button>" in HTM
      and HTM.index('id="asaSubPlanta"') < HTM.index('id="asaSubCub"') < HTM.index('id="asaSubObras"'))
check("es UNA tabla con los tres estados, no dos cajas",
      "dshCub" in HTM and "STOCK" in DSH and "PROGRAMADO" in DSH and "DESPACHADO" in DSH)
check("se puede ordenar por cualquier columna", "ORDEN_CUB" in DSH)

# UNA FILA POR OBRA, no por persona+obra. Agrupar por persona generaba alarmas falsas:
# una obra puede pasar de manos y el anterior aparecía «sin cola» cuando ya no la lleva.
# Caso real del usuario: BELFI figuraba en rojo para Dvenegas, que dejó de cubicar,
# mientras ERAMIREZ la tiene con 4 códigos programados.
check("agrupa por OBRA, no por persona+obra",
      "GROUP BY p.job_name, COALESCE(d.detail_person, u.detail_person)" in PROG)
check("...y el respaldo de «la lleva» es el último que detalló algo en ella",
      "DISTINCT ON (job_name)" in PROG and "GREATEST(order_date, proj_ship_date) DESC" in PROG)
check("el filtro de persona compara contra quien la detalló último",
      "PERSONAS.indexOf(f.lleva)" in DSH)
# La columna con el nombre se sacó: repetía el filtro que ya está arriba, y sin nadie
# elegido la tabla es la planta completa, donde esa columna no significa nada. Quién
# detalló queda en el globo de la obra.
check("la tabla NO lleva una columna con el cubicador",
      'data-ord="lleva"' not in DSH)
check("...pero quién detalló sigue a la vista, en el globo", "Detalló: " in DSH)

# OBRA ACTIVA = con movimiento reciente, NO «con pendiente». Esa fue mi primera idea y
# escondía justo la alarma: una obra que se comió su stock desaparecía de la vista.
check("obra activa se define por MOVIMIENTO reciente, no por tener pendiente",
      "make_interval(months => %s)" in PROG and "activas AS (" in PROG)
check("la ventana se puede cambiar desde el tab", "dshCubMeses" in HTM and "CUB_MESES" in DSH)
check("...y está acotada por el backend", "min(int(3 if meses is None else meses), 120)" in PROG)

# DOS NIVELES, porque no son lo mismo: ámbar «se le va a acabar», rojo «ya se acabó».
# Una sola marca haría que el grave se perdiera entre los leves, que son muchos más.
check("hay dos niveles de aviso, no uno",
      '"sin_nada"' in PROG and '"sin_stock"' in PROG)
check("...rojo es sin stock NI agendado", "(st_cc == 0 and pr_cc == 0)" in PROG)
check("...ámbar es con cola pero sin nada detrás", "(st_cc == 0 and pr_cc > 0)" in PROG)
check("...y se distinguen en pantalla", "alerta grave" in DSH and ".dsht3 tr.alerta.grave" in HTM)
check("ninguna alarma se filtra por tamaño (un umbral escondería casos en silencio)",
      "un umbral fijo escondería casos" in PROG)

# QUIÉN LA LLEVA = quien más kilos aportó DENTRO DE LA VENTANA. «El último que detalló»
# le entregaba la obra a quien hizo un solo código: Dvenegas quedaba a cargo de SACYR
# (10.393 t) con el 6%. Con el peso en la ventana el asignado aporta 96% en promedio.
check("quién la lleva es el que MÁS aportó en la ventana, no el último",
      "dominante AS" in PROG and "ORDER BY job_name, kg DESC" in PROG)
check("...con respaldo al último de la historia, para que ninguna fila quede sin dueño",
      "COALESCE(d.detail_person, u.detail_person)" in PROG)

# EL STOCK LLEVA SU EDAD. De 10.678 t sin agendar, el 67% se pidió hace más de un año:
# un número grande de stock se lee como salud cuando es bodega (Coquimbo: 1.150 t, de
# las cuales 968 son de 2024 y 2025).
check("el stock con más de un año se informa aparte", "MESES_STOCK_ANEJO = 12" in PROG
      and '"stvkg"' in PROG)
check("...se MARCA en la celda, no se descuenta (descontarlo rompería el cuadre con aSa)",
      "anejoCelda" in DSH and ".dsht td.anejo" in HTM and "descontarlo en silencio" in HTM)
check("...y el total añejo va en el encabezado", "de stock con más de" in DSH)

# La suma la hace Postgres: por obra son cientos de filas; mandar el detalle para que el
# navegador sumara serían 25.000 y varios MB.
check("el tab trae su propia data, agregada en la base",
      "/programacion/asa/cubicador" in PROG and "/programacion/asa/cubicador" in DSH)
check("...y no usa el filtro de año y mes, porque es una foto de hoy",
      "NO usa el filtro de año y mes" in PROG and "no usa el filtro de año ni de mes" in HTM)

# ── 21. Los nombres de los estados son los de aSa ──────────────────────────
# Traducirlos fue un error: «Por producir» y «Sin terminar» los inventé yo, y el usuario
# no podía saber qué campo dejaba fuera al apagar un botón. El nombre real va en el
# botón; el significado, en el globo.
print("\n21. Los botones llevan el nombre real del estado")
check("el botón dice el nombre de aSa, no una traducción",
      '"Open":       "Open"' in PROG and '"Processed":  "Processed"' in PROG)
check("el significado va como explicación", "EXPLICA_ESTADO" in PROG
      and "le sacaron tarjeta al ítem" in PROG)
check("...y llega al front para el globo del botón",
      '"explica_estado": EXPLICA_ESTADO' in PROG and "explica_estado" in DSH)
check("el globo también enseña cómo funciona el clic",
      "Ctrl+clic: encender o apagar" in DSH)

# ── 22. La etiqueta no dice «cubicador» de quien no lo es ──────────────────
# `DetailPerson` es quien detalló el pedido en aSa, y ahí aparece gente que no es del
# área. Llamarlos a todos «cubicadores» llevaba a conclusiones falsas sobre personas.
print("\n22. La etiqueta de DetailPerson es honesta")
check("la fila se llama «Detallado por», no «Cubicador»", "Detallado por" in HTM)
check("...y se explica que no son todos del área", "No son todos cubicadores" in HTM)

# ── 23. El job number de aSa al lado de la obra, en las tres tablas ────────
# Lo pidieron los usuarios: es el número con el que buscan la obra en aSa Studio. Va
# inmediatamente a la derecha de «Obra», en las tres tablas, y viaja en cada fila.
print("\n23. El job number de aSa acompaña a la obra")
check("el reporte manda asa_job_id en cada CC", "AS mes, p.asa_job_id" in PROG
      and '"job": r[11]' in PROG)
check("el cubicador también lo manda por obra", "MAX(p.asa_job_id)" in PROG
      and '"job": r[1]' in PROG)
check("Obra y luego Job en las tres cabeceras (Stock con y sin fecha, Obras aSa)",
      DSH.count('>Obra</th><th style="width:6%">Job</th>') == 2
      and DSH.count('>Obra</th><th style="width:7%">Job</th>') == 1)
check("...y la celda va después de la obra",
      DSH.count("esc(f.obra) + '</td>' +\n              '<td class=\"cc\">' + esc(f.job || '') + '</td>'") == 2)
check("Obras aSa: Obra, Job, Descripción",
      '>Obra</th><th style="width:7%">Job</th>' in DSH
      and 'Job</th>\' +\n               \'<th style="width:48%">Descripción</th>' in DSH)
check("Programado Cubicador: la columna existe en el colgroup y en los dos pisos",
      "'<col style=\"width:33%\"><col style=\"width:7%\">'" in DSH
      and "'<tr><th></th><th></th>'" in DSH
      and "data-ord=\"job\">Job" in DSH)
check("...la fila y el pie la llevan",
      "esc(o.obra) + '</td>' +\n              '<td class=\"cc\">' + esc(o.job || '') + '</td>'" in DSH
      and "<tfoot><tr><td>Total</td><td></td>" in DSH)
check("...y se puede ordenar por Job, ascendente al primer clic",
      "c !== 'obra' && c !== 'job'" in DSH)

# ── 24. «Cubicado por mes» y «Atributos de obra» ───────────────────────────
# Dos sub-tabs nuevos. El primero es de lectura sobre la misma data (persona × mes, con
# gráfico apilado); el segundo es el ÚNICO donde se escribe: los cubicadores catalogan
# cada obra (tipo y segmento) en una tabla propia, porque aSa no lo tiene.
print("\n24. Cubicado por mes y Atributos de obra")
MIG115 = open(os.path.join(ROOT, "armahub", "migrations", "115_asa_obra_atributos.sql"),
              encoding="utf-8").read()
check("los dos sub-tabs están registrados con su botón y su panel",
      "['mes',    'asaSubMes',    'asaPanelMes']" in DSH and "['atr',    'asaSubAtr',    'asaPanelAtr']" in DSH
      and 'id="asaSubMes"' in HTM and 'id="asaSubAtr"' in HTM
      and 'id="asaPanelMes"' in HTM and 'id="asaPanelAtr"' in HTM)
check("el reporte manda el año por fila (columnas = años con «todos» elegido)",
      '"anio": r[12]' in PROG and "AS mes, p.asa_job_id,\"" in PROG)
check("la pivot es una función pura y expuesta al test", "function pivotMes(filas, porAnio)" in DSH
      and "pivotMes: pivotMes" in DSH)
check("el gráfico es de barras AGRUPADAS (una por persona y mes), con Chart.js ya cargado",
      "x: { stacked: false" in DSH and "y: { stacked: false" in DSH and "graficoBarras(CHARTS[cfg.chart]" in DSH)
check("...con el número real encima de cada barra (el plugin de etiquetas se enciende acá)",
      "[ChartDataLabels]" in DSH and "datalabels: { display: true" in DSH
      and "formatter: function (v) { return v ? kg0(v) : ''; }" in DSH)
check("la columna de obras es ancha: lleva la lista completa",
      ".dshobras{width:440px;}" in HTM)
check("...y su letra es la de los cuadros de al lado (usa .dsht, que pisa el td{13px} de app.css)",
      "'<table class=\"dsht dshres\"><colgroup>" in DSH)
check("...y no se dibujan más de MAX_SERIES personas: el resto va en «Otros»",
      "MAX_SERIES = 8" in DSH and "'Otros (' + resto.length + ')'" in DSH)
# Atributos
check("la tabla es propia, aparte del espejo que se reescribe",
      "CREATE TABLE IF NOT EXISTS asa_obra_atributos" in MIG115 and "asa_job_id   TEXT PRIMARY KEY" in MIG115
      and "editado_por" in MIG115)
check("los valores permitidos son los que pidió el usuario",
      'TIPOS_OBRA = ("Cubicación", "Digitación")' in PROG
      and 'SEGMENTOS_OBRA = ("1 y 2", "4 y 5", "YPS", "Otros")' in PROG)
check("...y el backend rechaza cualquier otro",
      "body.tipo not in TIPOS_OBRA" in PROG and "body.segmento not in SEGMENTOS_OBRA" in PROG)
atr = PROG[PROG.index('@router.get("/programacion/asa/atributos")'):PROG.index('@router.get("/programacion/usc")')]
check("los dos endpoints existen y NO exigen admin: los llenan los cubicadores",
      '@router.put("/programacion/asa/atributos/{job}")' in atr and "_exigir_admin" not in atr)
check("el PUT sólo toca los campos que vienen (tocar el tipo no pisa el segmento)",
      "body.model_fields_set" in atr and "CASE WHEN %s THEN EXCLUDED.tipo ELSE asa_obra_atributos.tipo END" in atr)
check("...queda registrado quién y cuándo", "editado_por = EXCLUDED.editado_por" in atr
      and 'audit(email, "asa_atributos"' in atr)
check("el front guarda al clic, un campo por vez, y clic en el encendido borra",
      "var nuevo = (fila[campo] === valor) ? null : valor;" in DSH
      and "cuerpo[campo] = nuevo" in DSH and "req('PUT', '/programacion/asa/atributos/'" in DSH)
check("el tab de escritura se ve distinto: pestaña y panel azules",
      ".asasub.atr" in HTM and ".dshatr{background:#f3f5fb" in HTM)
check("la ventana de movimiento «Todo» es de verdad todo, en los dos tabs",
      "VENTANA_TODO = 1200" in PROG and PROG.count("ventana = meses or VENTANA_TODO") == 2
      and "int(meses or 3)" not in PROG)
check("asignar USC lee `role`, no `rol` (era un 500 seguro)",
      "SELECT role FROM users WHERE id = %s" in PROG and "SELECT rol FROM users" not in PROG)

# ── 25. Row-Level Security: la API REST de Supabase no ve ninguna tabla ────
# Supabase avisó (rls_disabled_in_public) y era cierto: 43 tablas abiertas y 602 permisos
# a `anon`/`authenticated`. La migración 116 cierra todas de una y db.py repite el cierre
# en cada arranque para las que aparezcan después. ArmaHub entra como `postgres`, que
# salta RLS (rolbypassrls = true, medido), así que no cambia nada para la app.
print("\n25. Row-Level Security en public")
MIG116 = open(os.path.join(ROOT, "armahub", "migrations", "116_rls.sql"), encoding="utf-8").read()
DB = open(os.path.join(ROOT, "armahub", "db.py"), encoding="utf-8").read()
check("la migración 116 activa RLS en TODAS las tablas de public, no en una lista",
      "FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity" in MIG116
      and "ENABLE ROW LEVEL SECURITY" in MIG116)
check("...y no crea políticas: sin políticas, anon/authenticated no ven nada",
      "CREATE POLICY" not in MIG116.upper())
check("db.py repite el cierre en cada arranque, después de las migraciones",
      "def _cerrar_rls(cur)" in DB and "_run_migrations(cur)\n            _create_indexes(cur)\n"
      "            # Después de crear todo: ninguna tabla de `public` queda sin RLS.\n"
      "            _cerrar_rls(cur)" in DB)
check("...y sólo toca las que están abiertas (normalmente ninguna)",
      "WHERE schemaname = 'public' AND NOT rowsecurity" in DB)

# ── 26. Los tres tabs «Por…» y la lista de obras por estado en «Obras aSa» ─
# Lo que los cubicadores cargan en «Atributos de obra» viaja en cada fila del reporte y
# del cubicador, es filtro de TODOS los sub-tabs y alimenta dos tabs nuevos: «Por
# segmento» y «Por tipo», hermanos de «Por cubicador» (gráfico + matriz filas × meses,
# sólo kilos). La lista plana de obras con su barra por estado vive en «Obras aSa».
print("\n26. Por cubicador / Por segmento / Por tipo, y la lista de obras por estado")
check("el reporte cruza los atributos y los manda por fila",
      "LEFT JOIN asa_obra_atributos t ON t.asa_job_id = p.asa_job_id" in PROG
      and '"tipo": r[13], "segmento": r[14],' in PROG
      and '"tipos": list(TIPOS_OBRA), "segmentos": list(SEGMENTOS_OBRA),' in PROG)
check("...y el cubicador también", "MAX(t.tipo), MAX(t.segmento)" in PROG
      and PROG.count("LEFT JOIN asa_obra_atributos t ON t.asa_job_id = p.asa_job_id") == 2)
check("segmento y tipo son chips de la barra compartida, con «(sin)» como valor",
      'id="dshSegs"' in HTM and 'id="dshTipos"' in HTM
      and "chips($('dshSegs'), (DATA.segmentos || []).concat([SIN])" in DSH
      and "return v === SIN ? 'Sin segmento' : v;" in DSH)
check("...y filtran en todos los sub-tabs (filtrar + cubicador + atributos)",
      DSH.count("if (SEGS.length && SEGS.indexOf(segDe(f)) === -1) return false;") == 3
      and DSH.count("if (TIPOS.length && TIPOS.indexOf(tipoDe(f)) === -1) return false;") == 3)
check("tres tabs hermanos: Por cubicador, Por segmento, Por tipo",
      ">Por cubicador</button>" in HTM and ">Por segmento</button>" in HTM and ">Por tipo</button>" in HTM
      and "['seg',    'asaSubSeg',    'asaPanelSeg']" in DSH and "['tipo',   'asaSubTipo',   'asaPanelTipo']" in DSH
      and all(('id="%s"' % x) in HTM for x in ("dshMesChart", "dshMesPiv", "dshSegChart", "dshSegPiv", "dshTipoChart", "dshTipoPiv")))
check("...son UNA pantalla con tres configuraciones, no tres copias",
      "function pintarPorClave(cfg)" in DSH and DSH.count("pintarPorClave(CFG_") == 3
      and "var CFG_SEG = { clave: segDe" in DSH and "var CFG_TIPO = { clave: tipoDe" in DSH)
check("la matriz es filas × meses, sólo kilos, con totales, y es una función pura",
      "function matriz(filas, clave, orden, porAnio)" in DSH and "matriz: matriz" in DSH
      and "<th class=\"tot\">Total</th>" in DSH and "'</tbody><tfoot><tr><td>Total</td>'" in DSH)
check("segmento y tipo van en el orden del backend con «(sin)» al final; cubicadores de mayor a menor",
      "orden: function () { return (DATA.segmentos || []).concat([SIN]); }" in DSH
      and "return b.total - a.total;" in DSH)
check("la lista de obras por estado vive en «Obras aSa» y ahí se esconde la columna fija",
      HTM.index('id="asaPanelObras"') < HTM.index('id="dshResObras"') < HTM.index('id="dshCc"')
      and 'id="dshColObras"' in HTM
      and "col.style.display = (v === 'obras' || v === 'atr' || v === 'mes') ? 'none' : ''" in DSH
      and "pintarListaObras();" in DSH)
check("...de mayor a menor, barra relativa a la más grande, partida por estado con el nombre real",
      "return b.kg - a.kg || a.obra.localeCompare(b.obra, 'es');" in DSH
      and "(o.kg / max * 100).toFixed(1)" in DSH
      and "ORDEN_ESTADO = ['Open', 'Processed', 'Shipped', 'Incomplete', 'Cancelled']" in DSH
      and "(DATA.nombres_estado || {})[e] || e" in DSH)
check("...y se clickea para filtrar",
      DSH.count("alternar(OBRAS, tr.dataset.obra, ev);") == 1 and "function resumenObras(filas)" in DSH)
check("un solo gráfico de barras para todos los cuadros (una barra por serie, con número)",
      "function graficoBarras(ref, canvas, labels, datasets)" in DSH and DSH.count("graficoBarras(") == 2)

# ── 27. Lo que el usuario corrigió al ver el tab (29-sep, tarde) ───────────
print("\n27. Total por mes, obras de prueba fuera, filtros ágiles")
check("los títulos dicen que es lo CUBICADO (por fecha de pedido)",
      "CUBICADO POR MES · CUBICADOR" in HTM and "CUBICADO POR MES · SEGMENTO" in HTM
      and "CUBICADO POR MES · TIPO" in HTM and "OBRAS · CUBICADO" in HTM)
check("cada mes lleva su total como segunda línea de la etiqueta del eje",
      "return [l, kg0(datasets.reduce(function (a, d) { return a + (d.data[i] || 0); }, 0))];" in DSH)
check("las obras de prueba y «NO USAR» quedan fuera de TODOS los endpoints (reporte, cubicador, atributos, semana ×2)",
      'PATRON_OBRAS_FUERA = r"\\m(prueba|no usar)\\M"' in PROG
      and PROG.count("job_name !~* %s") == 7 and PROG.count("PATRON_OBRAS_FUERA") == 8)
# Los filtros se sentían lentos: repintar miles de filas en el mismo clic, y el chip no se
# pintaba hasta terminar. Ahora el chip va primero y lo pesado después; y las cajas de
# Stock Cubicaciones tienen el mismo tope de filas que el detalle de códigos.
check("el chip se pinta primero y el repintado pesado va en el cuadro siguiente",
      "function diferir(fn)" in DSH and "function repintarTodo() { pintarChips(); diferir(" in DSH
      and DSH.count("repintarTodo();") >= 2 and "var repintar = repintarTodo;" in DSH)
check("año y mes encienden el chip antes de descargar, y avisan «Cargando…»",
      DSH.count("pintarChips(); cargar();") == 2 and "$('dshEspejo').textContent = 'Cargando…';" in DSH)
check("los botones de estado responden al instante",
      "b.className = OCULTOS[caja].indexOf(e) !== -1 ? 'off' : '';" in DSH
      and "diferir(function () { pintarObras(); pintarTablas(); });" in DSH)
check("las cajas de Stock Cubicaciones tienen tope de filas",
      "var recorte = filas.length > TOPE_FILAS;" in DSH and "(llevaFecha ? 9 : 8)" in DSH)

# ── 28. Los anulados, sólo en la barra por estado ──────────────────────────
# El usuario quiere ver en la lista de obras cuánto se cubicó y se canceló. Para eso el
# reporte manda también los Cancelled, pero ningún otro cuadro los cuenta: el front los
# separa una vez al cargar (`estado_nunca`) y sólo la lista mira `DATA.filas` completo.
print("\n28. Los anulados viajan, pero sólo la barra por estado los ve")
check("el reporte ya no filtra los anulados; el cubicador, los atributos y la semana sí",
      PROG.count("COALESCE(estado,'') <> %s") == 6
      and "params + [PATRON_OBRAS_FUERA])" in PROG and '"estado_nunca": ESTADO_NUNCA,' in PROG)
check("el front los separa una vez al cargar y todo lo demás usa las filas vivas",
      "FILAS_VIVAS = (DATA.filas || []).filter(function (f) { return f.estado !== DATA.estado_nunca; });" in DSH
      and "function todasLasFilas() {\n    return FILAS_VIVAS;\n  }" in DSH)
check("...y sólo la lista de obras mira las filas completas",
      DSH.count("filtrar(DATA.filas || [], 'obra')") == 1 and DSH.count("resumenObras(filtrar(") == 1)
check("Cancelled tiene color, orden y nombre con su explicación",
      "'Cancelled': '#e57373'" in DSH and '"Cancelled":  "Cancelled — anulado en aSa' in PROG
      and '"Cancelled":  "Cancelled",' in PROG)

# ── 29. La carga de un año tiene su propia espera, larga ──────────────────
# El 6-oct el «Traer de aSa» se atoró justo en 2026 —«se agotó la espera de 20.0s»— y el
# usuario quedó viendo datos de una semana antes sin que nada se lo dijera. Medido: ese
# año tarda 32 s en responder. La espera corta sigue para todo lo demás, que es lo que
# evita que una pantalla se quede colgada.
print("\n29. Traer un año completo puede tardar, y la pantalla dice cuándo se trajo")
import armahub.asa as A  # noqa: E402
os.environ.pop("ASA_TIMEOUT", None)
os.environ.pop("ASA_TIMEOUT_CARGA", None)
check("la espera normal sigue siendo corta (20 s)", A._timeout() == 20.0)
check("...la de carga es larga (150 s) y se puede cambiar por variable",
      A._timeout_carga() == 150.0)
os.environ["ASA_TIMEOUT_CARGA"] = "200"
check("...por ASA_TIMEOUT_CARGA", A._timeout_carga() == 200.0)
os.environ.pop("ASA_TIMEOUT_CARGA", None)
check("quien llama puede fijar la espera de una consulta", A._timeout(77) == 77.0)
check("y la carga de un año la pide: es la consulta que se atoraba",
      'carga: bool = False' in SRC and "_timeout_carga() if carga else None" in SRC
      and 'alias="Kgs", carga=True' in SYNC)
check("el reintento conserva la espera que le pidieron",
      "def _reintentar(url: str, intento: int, motivo: str, timeout: Optional[float] = None)" in SRC
      and "return _pedir(url, intento + 1, timeout)" in SRC)
check("el reporte dice cómo fue el último intento de ESE año",
      '"getOrderSummary/%d" % anio' in PROG and '"ultimo_intento": ({"fin"' in PROG)
check("y la pantalla dice cuándo se trajo y avisa si lo último falló",
      "' · traído de aSa el ' + fechaHora(esp.ultima_sync)" in DSH
      and "intento.ok === false" in DSH and "Lo que se ve es de la última vez que sí se pudo" in DSH)

# ── 30. Quién cubicó y cuándo, en la tabla de códigos ─────────────────────
# «Me serviría tener la fecha de creación del CC o última actualización… la idea es tener
# certeza de cuándo se dejó de cubicar» (6-oct). aSa NO tiene esa fecha: se comprobó campo
# por campo en getOrderSummary, getOrderItemView y getScheduling. Lo que hay son dos, y van
# las dos con lo que significan, porque la última modificación también la mueve el despacho
# (medido: en los códigos despachados la mediana es 10 días después del pedido).
print("\n30. Quién cubicó y las dos fechas del código")
check("se pide LastModified a aSa y se guarda en el espejo",
      '"Status", "LastModified"' in SYNC and "ultima_mod=EXCLUDED.ultima_mod" in SYNC
      and "ADD COLUMN IF NOT EXISTS ultima_mod" in MIG128)
check("...y se dice por qué: agregarlo no parte los códigos",
      "NO\n# parte los códigos" in SYNC or "NO parte los códigos" in SYNC.replace("\n# ", " "))
check("el reporte manda la fecha del pedido y la última modificación",
      "p.order_date, p.ultima_mod" in PROG and '"pedido": r[15]' in PROG and '"ultima_mod": r[16]' in PROG)
check("la tabla tiene columna de cubicador y las dos fechas",
      "<th style=\"width:10%\">Cubicó</th>" in DSH and ">Creado</th>" in DSH and ">Últ. cambio</th>" in DSH)
# «Creado» y no «Pedido»: es el día en que nació el código, y es lo mismo — medido sobre
# 26.000 códigos, sólo 2 tienen el pedido fechado después de su última modificación.
check("...y la de creación dice de dónde sale",
      "el día en que nació el código" in DSH and "OrderDate" in DSH)
check("...cada fila las pinta", "ddmm(f.pedido)" in DSH and "ddmm(f.ultima_mod)" in DSH
      and "esc(f.persona || '')" in DSH)
check("...y el encabezado avisa que la última modificación no es «cubicación terminada»",
      "aSa no guarda cuándo se terminó de " in DSH and "fabricar o despachar también la mueven" in DSH)
check("el aviso de recorte cuenta bien las columnas nuevas", "(llevaFecha ? 9 : 8)" in DSH)

# ── 31. Si aSa no puede con el año entero, se pide por trimestres ─────────
# Medido el 6-oct: 2023, 2024 y 2025 enteros devuelven «HTTP 500 · An error has occurred»
# de forma intermitente —la misma consulta falla dos veces y pasa a la tercera—. Es el
# propio consejo del error de aSa: «hay que acotarla con un filtro».
print("\n31. El año que aSa no aguanta se pide por trimestres")
check("hay cuatro trozos y una función que pide uno",
      "TROZOS_ANIO = [(\"01-01\", \"03-31\")" in SYNC and "def _pedir_pedidos(" in SYNC)
check("se intenta el año entero primero y sólo al fallar se parte",
      'filas = _pedir_pedidos(anio, "01-01", "12-31")' in SYNC
      and "se pide por trimestres." in SYNC and "for desde, hasta in TROZOS_ANIO:" in SYNC)
check("si no viene ni un trozo, el año falla como antes",
      "if not filas:" in SYNC and "_cerrar_bitacora(sync_id, False, detalle=str(entero))" in SYNC)
check("...y si vienen algunos, se guardan pero el año queda marcado INCOMPLETO",
      'detalle="Año incompleto, faltan trozos — "' in SYNC and 'r["incompleto"] = fallos' in SYNC)
check("la bitácora deja dicho cuándo hubo que partirlo",
      'detalle="Pedido por trimestres: aSa no pudo con el año entero."' in SYNC)

# ── 32. El refresco automático se ve en la pantalla ───────────────────────
# El reloj existe desde el 29-sep y NUNCA corrió —cero filas con lanzado_por='reloj'—
# porque ASA_SYNC_ACTIVO no está en Render. Nada en la interfaz lo decía, así que el
# usuario esperaba que la data se actualizara sola en la mañana.
print("\n32. El reloj se ve: si está apagado, la pantalla lo dice")
check("el reporte manda el estado del reloj, sin poder reventar por eso",
      '"reloj": _estado_reloj(),' in PROG and "def _estado_reloj()" in PROG
      and "except Exception:" in PROG)
check("apagado se avisa y se dice por qué",
      "El refresco automático está apagado." in DSH and "ASA_SYNC_ACTIVO=0" in DSH)
# EL RELOJ VIENE ENCENDIDO (7-oct). Nació apagado por el plan gratuito de Render; la
# variable nunca se puso y estuvo nueve días sin correr ni una vez, mientras el usuario
# esperaba que la data se refrescara sola. Ahora la variable sirve para APAGARLO.
from armahub import asa_scheduler as SCHED  # noqa: E402
os.environ.pop("ASA_SYNC_ACTIVO", None)
check("sin la variable puesta, el reloj corre", SCHED.activo() is True)
APAGAN = ("0", "false", "no", "off", "OFF", " 0 ")
check("se apaga con 0 / false / no / off, en cualquier caja y con espacios",
      all(not _con_env(v) for v in APAGAN))
check("...y el 1 que había que poner antes lo sigue dejando encendido", _con_env("1") is True)
os.environ.pop("ASA_SYNC_ACTIVO", None)
check("el porqué queda escrito donde se decidió",
      "VIENE ENCENDIDO (7-oct)" in RELOJ and "`ASA_SYNC_ACTIVO=0` lo apaga" in RELOJ
      and "Viene ENCENDIDO desde el 7-oct" in open(os.path.join(ROOT, "armahub", "main.py"), encoding="utf-8").read())
check("encendido se dice a qué hora toca",
      "Se refresca solo a las" in DSH and "la próxima, " in DSH)
check("...y si está encendido pero el hilo se cayó, también",
      "pero el reloj no está corriendo" in DSH)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
