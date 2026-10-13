"""CLIENTES DESDE aSa, y NINGÚN «PROY-» A LA VISTA (13-oct).

Lo que se congela: la caluga de Clientes es un visualizador de lo que aSa sabe de cada
cliente más el complemento de ArmaHub; no se crean clientes a mano; una constructora de
ArmaHub puede tener varias grafías en aSa; y en ninguna respuesta de la API el código
visible de una obra enlazada es un id interno de ArmaHub.

Necesita la base. Correr con: python tests/test_clientes_asa.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
try:
    from asa_ping import cargar_env
    cargar_env()
except Exception:
    pass
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")
os.environ.setdefault("CORS_ORIGINS", "http://localhost")

fallos = 0


def check(nombre, cond, detalle=""):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -- " + str(detalle)[:160]) if not cond else ""))
    if not cond:
        fallos += 1


def _leer(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


CO = _leer("armahub", "constructoras.py")
M145 = _leer("armahub", "migrations", "145_clientes_desde_asa.sql")
HT = _leer("armahub", "templates", "tabs", "clientes.html")
JS = _leer("armahub", "static", "js", "features", "clientes", "index.js")
OBJS = _leer("armahub", "static", "js", "features", "cubicacion", "obras.js")

print("TEST: clientes desde aSa")

print("\n1. El cliente viene de aSa; ArmaHub lo complementa")
check("hay una vista de clientes según aSa, con sus obras y su complemento",
      '@router.get("/clientes/asa")' in CO and '"cliente_asa"' in CO and '"armahub": comp.get(n)' in CO)
check("varias grafías de aSa pueden ser una constructora (tabla de alias)",
      "CREATE TABLE IF NOT EXISTS constructora_alias" in M145)
check("...y la semilla sale de la evidencia, no de parecidos de nombre",
      "JOIN asa_obras o ON o.asa_job_id = p.asa_job_id" in M145 and "'migracion-145'" in M145)
check("la constructora de una obra se deriva de su job (sólo rellena vacíos)",
      "AND p.constructora_id IS NULL" in M145 and "AND p.constructora_id IS NULL" in CO)

print("\n2. No se crean clientes a mano")
check("POST /constructoras responde 410 con la razón", "status_code=410" in CO and "vienen de aSa" in CO)
check("la única puerta es «complementar» desde un cliente de aSa",
      '@router.post("/clientes/asa/complementar")' in CO and "LA ÚNICA FORMA DE QUE NAZCA UNA CONSTRUCTORA" in CO)
check("...que exige que el nombre exista en el espejo", "Ese cliente no está en el espejo de aSa." in CO)
check("el front no ofrece «Nueva empresa» ni «Crear obra»",
      "btnNuevaEmpresa" not in HT and "btnNuevaObra" not in HT and 'id="nuevaObraModal"' not in HT)
# Se mira SÓLO guardarEmpresa: los calculistas sí se crean a mano, y usan el mismo patrón.
_ge = JS[JS.find("async function guardarEmpresa("):JS.find("async function eliminarEmpresa(")]
check("...y guardar sólo edita", "method: 'PATCH'," in _ge and "'POST'" not in _ge)
check("la lista es la vista de aSa, con «Agregar datos» y «Es el mismo que…»",
      "/clientes/asa" in JS and "Agregar datos" in JS and "Es el mismo que" in JS
      and "function complementarCliente(" in JS)

print("\n3. Contra la API")
from fastapi.testclient import TestClient  # noqa: E402
from armahub.main import app  # noqa: E402
from armahub.auth import create_token  # noqa: E402

cli = TestClient(app)
HA = {"Authorization": "Bearer " + create_token("eugenio.zalazar@armacero.cl", "admin")}
r = cli.get("/api/v1/clientes/asa", headers=HA)
d = r.json() if r.status_code == 200 else {}
con = [c for c in d.get("clientes", []) if c.get("armahub")]
check("la vista responde con los clientes de aSa (más de 100)", r.status_code == 200 and d.get("n", 0) > 100, (r.status_code, d.get("n")))
check("...cada uno con sus obras", all(isinstance(c.get("obras"), list) for c in d.get("clientes", [])))
check("...y los que tienen constructora traen su complemento (semilla por evidencia)",
      len(con) >= 5, [c["cliente_asa"] for c in con][:6])
check("crear una constructora a mano -> 410",
      cli.post("/api/v1/constructoras", headers=HA, json={"nombre": "x"}).status_code == 410)
check("complementar un nombre que no está en aSa -> 404",
      cli.post("/api/v1/clientes/asa/complementar", headers=HA,
               json={"nombre_asa": "NO EXISTE ESTE CLIENTE 123"}).status_code == 404)

print("\n4. Ningún «PROY-» a la vista: el código visible de una obra enlazada es el job de aSa")
PROY = re.compile(r"^PROY-")
p = cli.get("/api/v1/proyectos", headers=HA).json().get("proyectos", [])
enl = [x for x in p if x.get("asa_job_id")]
check("/proyectos: `codigo` nunca es un PROY- cuando la obra está enlazada (%d obras)" % len(enl),
      enl and not any(PROY.match(str(x.get("codigo") or "")) for x in enl),
      [x["codigo"] for x in enl if PROY.match(str(x.get("codigo") or ""))][:5])
check("...y el nombre que se muestra es el del espejo",
      all(x.get("nombre_proyecto") and x.get("nombre_proyecto") == x.get("nombre_proyecto").upper()
          or x.get("nombre_armahub") != x.get("nombre_proyecto") for x in enl[:10]))
# «Obra de Prueba» no tiene job a propósito (decisión del usuario): se exime lo que no
# está enlazado, que es lo que la regla dice.
sin_enlace = {x["id_proyecto"] for x in p if not x.get("asa_job_id")}
a = [x for x in cli.get("/api/v1/auditorias/obras", headers=HA).json().get("obras", [])
     if x.get("id_proyecto") not in sin_enlace]
check("/auditorias/obras: `codigo` es el job en toda obra enlazada (%d)" % len(a),
      a and not any(PROY.match(str(x.get("codigo") or "")) for x in a),
      [x.get("codigo") for x in a if PROY.match(str(x.get("codigo") or ""))][:5])
rl = cli.get("/api/v1/reclamos?limite=300", headers=HA).json().get("data", [])
con_job = [x for x in rl if x.get("asa_job_id") and x.get("id_proyecto")]
check("/reclamos: la obra se nombra como aSa en los reclamos con obra enlazada (%d)" % len(con_job),
      con_job and not any(PROY.match(str(x.get("nombre_proyecto") or "")) for x in con_job))
check("Cubicaciones: el detalle de obra titula el código de aSa, y el id interno va chico",
      "Código aSa:" in OBJS and "Id interno de ArmaHub (legacy)" in OBJS)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
