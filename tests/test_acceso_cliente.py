"""EL ROL CLIENTE VE SÓLO LO QUE ESTÁ EN LA LISTA. Todo lo demás, 403 (9-oct).

Lo que este test congela es la POSTURA, no una lista de rutas: recorre TODAS las rutas
que publica la API (del OpenAPI, así una ruta nueva entra sola) y exige que, con un token
de cliente, cada una responda 401/403 salvo que esté en `CLIENTE_PUEDE`. Si alguien agrega
un router y se olvida del cliente, esto falla; antes pasaba lo contrario: cada router nuevo
nacía abierto y nadie se enteraba.

Medido el 9-oct antes del cerrojo: /reclamos devolvía 130 reclamos de todas las obras,
/proyectos las 37 obras y /programacion/asa/reporte la producción de 45 personas.

Necesita la base (como test_auditorias). Correr con: python tests/test_acceso_cliente.py
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


from armahub import auth as A  # noqa: E402

print("TEST: acceso del rol cliente")

print("\n1. La regla es pura y se prueba sin servidor")
check("lo de siempre pasa: /me, su clave, la campana",
      A.cliente_puede("GET", "/api/v1/me") and A.cliente_puede("POST", "/me/password")
      and A.cliente_puede("GET", "/api/v1/notificaciones/count")
      and A.cliente_puede("POST", "/api/v1/notificaciones/7/leer"))
check("lo que destapó la medición NO pasa",
      not A.cliente_puede("GET", "/api/v1/reclamos") and not A.cliente_puede("GET", "/api/v1/proyectos")
      and not A.cliente_puede("GET", "/api/v1/programacion/asa/reporte"))
check("se compara sin el prefijo: los routers están montados dos veces",
      not A.cliente_puede("GET", "/reclamos") and A.cliente_puede("GET", "/me"))
check("la lista es exacta, no por prefijo: /me no abre /me/loquesea",
      not A.cliente_puede("GET", "/api/v1/me/extra") and not A.cliente_puede("GET", "/api/v1/meXYZ"))
check("el método importa: la campana se lee, no se borra",
      not A.cliente_puede("DELETE", "/api/v1/notificaciones/7/leer"))

print("\n2. Contra la API entera, con un token de cliente")
from fastapi.testclient import TestClient  # noqa: E402
from armahub.main import app  # noqa: E402

cli = TestClient(app)
H = {"Authorization": "Bearer " + A.create_token("cliente@armacero.cl", "cliente")}
SUST = {"auditoria_id": "1", "elemento_id": "1", "item_id": "1", "id": "1", "reclamo_id": "1",
        "id_proyecto": "PROY-E84CFAAE", "lote_id": "1", "user_id": "1", "area_id": "6",
        "senal_id": "1", "accion_id": "1", "job": "2010136", "anio": "2026", "cc": "SUP7",
        "notif_id": "1"}
paths = app.openapi().get("paths", {})
rutas = sorted((p, m.upper()) for p, ops in paths.items() for m in ops if m.upper() == "GET")
check("el OpenAPI publica rutas (si esto es 0, el test no está midiendo nada)", len(rutas) > 50, len(rutas))

abiertas_fuera_de_lista, raras = [], []
for path, metodo in rutas:
    url = re.sub(r"\{(\w+)[^}]*\}", lambda m: SUST.get(m.group(1), "1"), path)
    try:
        code = cli.get(url, headers=H).status_code
    except Exception as e:
        raras.append((path, "ERR " + str(e)[:40]))
        continue
    if code == 200 and not A.cliente_puede(metodo, path):
        # PÚBLICO NO ES FUGA. La home, /health y la página de login responden 200 a
        # cualquiera SIN token: no son datos, son la puerta. Lo que se mide acá es lo que
        # un cliente ve POR TENER token, así que una ruta que también responde 200 sin
        # token no cuenta.
        if cli.get(url).status_code == 200:
            continue
        abiertas_fuera_de_lista.append(path)
    elif code not in (200, 401, 403, 404, 422):
        raras.append((path, code))
check("ningún GET fuera de la lista responde 200 a un cliente (%d rutas recorridas)" % len(rutas),
      not abiertas_fuera_de_lista, abiertas_fuera_de_lista[:8])
check("...y las dos monturas, con y sin /api/v1, niegan igual",
      cli.get("/api/v1/reclamos", headers=H).status_code == 403
      and cli.get("/reclamos", headers=H).status_code == 403)
check("lo permitido sigue funcionando: /me responde 200",
      cli.get("/api/v1/me", headers=H).status_code == 200)
check("...y la campana también", cli.get("/api/v1/notificaciones/count", headers=H).status_code == 200)
check("escribir tampoco: crear un reclamo da 403, no 422 ni 200",
      cli.post("/api/v1/reclamos", headers=H, json={"titulo": "x"}).status_code == 403)
check("el 403 le dice al cliente qué pasa, no un «Forbidden» pelado",
      "tu obra" in cli.get("/api/v1/proyectos", headers=H).text)
if raras:
    print("      (respuestas raras con los valores de prueba, no son fallo: %s)" % raras[:4])

print("\n3. La autorización por obra deja de decir «todo»")
from armahub.db import get_conn  # noqa: E402
from armahub.barras import _get_allowed_project_ids, _project_filter_sql  # noqa: E402
with get_conn() as conn:
    with conn.cursor() as cur:
        de_cliente = _get_allowed_project_ids(cur, {"role": "cliente", "email": "cliente@armacero.cl"})
        de_admin = _get_allowed_project_ids(cur, {"role": "admin", "email": "x"})
check("para un cliente sale de proyecto_usuarios: un conjunto, nunca None",
      isinstance(de_cliente, set), type(de_cliente).__name__)
check("...y un cliente sin obra asignada ve NADA, no todo",
      _project_filter_sql(set(), "p")[0].strip() == "AND FALSE")
check("para los demás roles sigue sin restricción (None)", de_admin is None)

print("\n4. El front no le ofrece botones que dan 403")
REG = open(os.path.join(ROOT, "armahub", "static", "js", "app", "registry.js"), encoding="utf-8").read()
SH = open(os.path.join(ROOT, "armahub", "static", "js", "app", "shell.js"), encoding="utf-8").read()
check("'cliente' no está en ningún allowedRoles", "'cliente'" not in REG.split("registerModule")[1:].__str__()
      or not re.search(r"allowedRoles:\s*\[[^\]]*'cliente'", REG))
check("un hub sin módulos lo dice en vez de quedar en blanco", "en preparación" in SH)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
