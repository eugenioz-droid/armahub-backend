"""
SMOKE TEST DEL MODULO DE PROGRAMACION  --  ejecuta los endpoints COMO LOS EJECUTA EL
NAVEGADOR: misma app FastAPI, misma base, mismas rutas bajo /api/v1, mismo token.

    python scripts/smoke_programacion.py            -> solo lecturas
    python scripts/smoke_programacion.py --sync     -> ademas sincroniza obras y pedidos desde aSa

POR QUE EXISTE. Tres bugs seguidos llegaron a produccion sin que ningun test los viera:
el router no estaba montado bajo /api/v1 (404 en todo el modulo), el front mandaba
'anio=' vacio (422), y una consulta leia users.rol en vez de users.role (500). Los tests
de strings miran el codigo; esto lo EJECUTA. Si esto pasa, la pantalla carga.

Necesita el .env (DATABASE_URL, ASA_*). Firma un token local con un JWT_SECRET propio:
ese token no sirve contra produccion, y el de produccion no sirve aca.
"""
import os
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, "scripts"))
from asa_ping import cargar_env  # noqa: E402

cargar_env()
os.environ.setdefault("JWT_SECRET", "smoke-local-secret-que-no-vale-en-produccion-" + str(int(time.time())))
os.environ.setdefault("ASA_TIMEOUT", "120")
os.environ.setdefault("CORS_ORIGINS", "http://localhost")

from fastapi.testclient import TestClient  # noqa: E402

from armahub.main import app  # noqa: E402
from armahub.auth import create_token  # noqa: E402
from armahub.db import get_conn  # noqa: E402

SYNC = "--sync" in sys.argv
fallos = 0


def check(nombre, cond, detalle=""):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -- " + detalle) if detalle and not cond else ""))
    if not cond:
        fallos += 1


with get_conn() as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT email FROM users WHERE role='admin' AND COALESCE(activo,TRUE) LIMIT 1")
        ADMIN = cur.fetchone()[0]
        cur.execute("SELECT to_regclass('public.asa_obras'), to_regclass('public.asa_pedidos'), "
                    "to_regclass('public.tareas_programacion')")
        tablas = cur.fetchone()

cli = TestClient(app)
H = {"Authorization": "Bearer " + create_token(ADMIN, "admin")}


def get(ruta, **params):
    r = cli.get("/api/v1" + ruta, headers=H, params=params or None)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, r.text


def post(ruta, cuerpo=None, **params):
    r = cli.post("/api/v1" + ruta, headers=H, json=cuerpo, params=params or None)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, r.text


print("SMOKE: modulo de Programacion, como admin %s" % ADMIN)

print("\n1. Las tablas existen en la base")
check("asa_obras", tablas[0] is not None)
check("asa_pedidos (migracion 113)", tablas[1] is not None)
check("tareas_programacion (migracion 111)", tablas[2] is not None)

print("\n2. Tab USC")
s, d = get("/programacion/obras")
check("GET /programacion/obras -> 200", s == 200, str(d)[:120])
obras = d.get("obras", []) if isinstance(d, dict) else []
check("...devuelve obras (%d)" % len(obras), len(obras) > 0)
if obras:
    s, d = get("/programacion/obras/%s/tareas" % obras[0]["id_proyecto"])
    check("GET /programacion/obras/{id}/tareas -> 200", s == 200, str(d)[:120])
    check("...con las tres listas", isinstance(d, dict) and all(k in d for k in ("disponibles", "programadas", "cubicadas")))
s, d = get("/programacion/semana")
check("GET /programacion/semana -> 200", s == 200, str(d)[:120])

print("\n3. Tab Obras")
s, d = get("/programacion/asa/estado")
check("GET /programacion/asa/estado -> 200", s == 200, str(d)[:120])
check("...aSa configurado y responde", isinstance(d, dict) and d.get("ok") is True, str(d)[:160])
s, d = get("/programacion/usc")
check("GET /programacion/usc -> 200 (era el users.rol)", s == 200, str(d)[:120])
check("...hay USC (%d)" % len(d.get("usc", []) if isinstance(d, dict) else []),
      isinstance(d, dict) and len(d.get("usc", [])) >= 4)
s, d = get("/programacion/obras-asignacion")
check("GET /programacion/obras-asignacion -> 200", s == 200, str(d)[:120])
s, d = get("/programacion/asa/buscar", q="inarco")
check("GET /programacion/asa/buscar?q=inarco -> 200", s == 200, str(d)[:120])

print("\n4. Tab Dashboards")
s, d = get("/programacion/asa/reporte")
check("GET /programacion/asa/reporte SIN parametros -> 200 (era el 422)", s == 200, str(d)[:160])
s, d = get("/programacion/asa/reporte", anio=2026, meses="8,9")
check("GET /programacion/asa/reporte?anio=2026&meses=8,9 -> 200", s == 200, str(d)[:160])
check("...con las dos listas y sus totales",
      isinstance(d, dict) and all(k in d for k in ("por_programar", "programados", "kg_por_programar", "kg_programados")))

if SYNC:
    print("\n5. Sincronizacion desde aSa (escribe en el espejo)")
    t0 = time.time()
    s, d = post("/programacion/asa/sincronizar")
    check("POST /programacion/asa/sincronizar (obras) -> 200 en %.1fs" % (time.time() - t0), s == 200, str(d)[:160])
    if s == 200:
        print("      %d obras leidas, %d nuevas" % (d.get("filas", 0), d.get("nuevas", 0)))
    t0 = time.time()
    s, d = post("/programacion/asa/sincronizar-pedidos", anio=2026)
    check("POST /programacion/asa/sincronizar-pedidos?anio=2026 -> 200 en %.1fs" % (time.time() - t0), s == 200, str(d)[:160])
    if s == 200:
        print("      %d codigos de control, %d nuevos" % (d.get("filas", 0), d.get("nuevas", 0)))

    print("\n6. El reporte con data real (2026, Ago+Sep)")
    s, d = get("/programacion/asa/reporte", anio=2026, meses="8,9")
    check("reporte -> 200", s == 200)
    if s == 200:
        pp, pg = d["por_programar"], d["programados"]
        print("      POR PROGRAMAR: %4d CC  %14s kg" % (len(pp), "{:,.2f}".format(d["kg_por_programar"])))
        print("      PROGRAMADOS  : %4d CC  %14s kg" % (len(pg), "{:,.2f}".format(d["kg_programados"])))
        print("      anios: %s   cubicadores: %d   obras: %d" % (d["anios"], len(d["personas"]), len(d["obras"])))
        check("hay filas en las dos tablas", len(pp) > 0 and len(pg) > 0)
        check("los programados traen fecha comprometida", all(f["promesa"] for f in pg))
        check("los por programar no", not any(f["promesa"] for f in pp))
    s, d = get("/programacion/asa/buscar", q="inarco")
    check("buscar obras 'inarco' -> %d resultado(s)" % len(d.get("resultados", [])), s == 200 and len(d.get("resultados", [])) > 0)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
