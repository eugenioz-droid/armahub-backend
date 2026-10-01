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
# RLS (migracion 116 + db._cerrar_rls al arrancar): ninguna tabla de public abierta a la
# API REST de Supabase, y el rol de la app la salta. Se mide DESPUES de arrancar la app,
# que es cuando corre el cierre.
with get_conn() as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity")
        abiertas = cur.fetchone()[0]
        cur.execute("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user")
        salta = cur.fetchone()[0]
check("ninguna tabla de public sin RLS (hay %d)" % abiertas, abiertas == 0)
check("el rol de la app salta RLS (si no, la app dejaria de ver sus tablas)", salta is True)

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
# El reporte manda UNA lista con todas las filas del periodo; separarlas en las dos cajas
# y filtrar por estado lo hace el front, que es el que sabe que obra y que cubicador tiene
# marcados el usuario. Antes el estado se filtraba aca y los conteos de los botones salian
# del ano entero, o sea mentian.
check("...con las filas del periodo y lo que necesitan los botones",
      isinstance(d, dict) and all(k in d for k in
                                  ("filas", "anulados", "nombres_estado",
                                   "estado_apagado_por_defecto", "anios", "personas")))
if isinstance(d, dict) and d.get("filas"):
    f0 = d["filas"][0]
    check("...y cada fila trae lo que las tablas dibujan",
          all(k in f0 for k in ("cc", "obra", "descr", "persona", "promesa", "estado", "kg")))
    # Los anulados SI viajan (para la barra por estado de Obras aSa), marcados con
    # `estado_nunca` para que el front los separe; su cantidad cuadra con `anulados`.
    n_canc = sum(1 for x in d["filas"] if x.get("estado") == d.get("estado_nunca"))
    check("...los anulados viajan marcados y cuadran con el conteo (%d)" % n_canc,
          d.get("estado_nunca") == "Cancelled" and n_canc == d.get("anulados"))

print("\n5. Tab del cubicador: la foto de hoy")
s, d = get("/programacion/asa/cubicador", meses=3)
check("GET /programacion/asa/cubicador -> 200", s == 200, str(d)[:160])
if s == 200 and d.get("filas"):
    filas = d["filas"]
    print("      %d obras activas · %d sin trabajo · %d sin stock"
          % (len(filas), sum(1 for f in filas if f["sin_nada"]),
             sum(1 for f in filas if f["sin_stock"])))
    # LO QUE HACE CREIBLE LA TABLA: los tres estados son excluyentes y suman el total.
    # Si un codigo pudiera contarse dos veces, ningun total cuadraria con los otros
    # reportes y no habria forma de saber cual miente.
    check("...una fila por OBRA, sin repetir",
          len({f["obra"] for f in filas}) == len(filas))
    check("...cada obra dice quien la lleva hoy",
          all(f.get("lleva") for f in filas if f["de"] or f["st"] or f["pr"]))
    check("...las dos alarmas son excluyentes entre si",
          not any(f["sin_nada"] and f["sin_stock"] for f in filas))
    check("...«sin trabajo» es de verdad cero y cero",
          all(f["st"] == 0 and f["pr"] == 0 for f in filas if f["sin_nada"]))
    check("...«sin stock» tiene cola pero nada detras",
          all(f["st"] == 0 and f["pr"] > 0 for f in filas if f["sin_stock"]))
    # La ventana es lo que define que obra esta activa; ampliarla no puede achicar la lista.
    s6, d6 = get("/programacion/asa/cubicador", meses=12)
    check("ampliar la ventana no deja FUERA obras que ya estaban",
          s6 == 200 and len(d6["filas"]) >= len(filas))
    # «Todo» (meses=0) es la historia completa. El backend lo convertia en 3 meses
    # (`int(0 or 3)`) y el chip mentia en silencio: tiene que traer AL MENOS lo de 12.
    s0, d0 = get("/programacion/asa/cubicador", meses=0)
    check("«Todo» trae al menos tantas obras como 12 meses (%d vs %d)"
          % (len(d0.get("filas", [])), len(d6["filas"])),
          s0 == 200 and d0.get("meses") == 0 and len(d0["filas"]) >= len(d6["filas"]))

print("\n6. Tab de atributos de obra (tipo y segmento)")
s, d = get("/programacion/asa/atributos", meses=12)
check("GET /programacion/asa/atributos -> 200", s == 200, str(d)[:160])
if s == 200:
    filas = d.get("filas", [])
    print("      %d obras · %d con tipo · %d con segmento · tipos %s · segmentos %s"
          % (len(filas), sum(1 for f in filas if f.get("tipo")),
             sum(1 for f in filas if f.get("segmento")), d.get("tipos"), d.get("segmentos")))
    check("...una fila por obra, cada una con su job", len(filas) > 0
          and len({f["obra"] for f in filas}) == len(filas)
          and all(f.get("job") for f in filas))
    check("...lo guardado es siempre un valor permitido",
          all((f["tipo"] in d["tipos"] or f["tipo"] is None) and
              (f["segmento"] in d["segmentos"] or f["segmento"] is None) for f in filas))
    # Las escrituras se prueban SIN escribir: un valor invalido y un job inexistente
    # tienen que rebotar antes de tocar la base. Esto corre contra la base real.
    job = filas[0]["job"]
    r = cli.put("/api/v1/programacion/asa/atributos/" + job, headers=H, json={"tipo": "Cualquier cosa"})
    check("PUT con un tipo que no existe -> 422", r.status_code == 422, r.text[:120])
    r = cli.put("/api/v1/programacion/asa/atributos/" + job, headers=H, json={})
    check("PUT sin campos -> 400", r.status_code == 400, r.text[:120])
    r = cli.put("/api/v1/programacion/asa/atributos/NO-EXISTE-999", headers=H, json={"tipo": d["tipos"][0]})
    check("PUT a un job que no esta en el espejo -> 404", r.status_code == 404, r.text[:120])

print("\n6b. Semana (maqueta): el lado real desde aSa")
s, d = get("/programacion/semana-real")
check("GET /programacion/semana-real -> 200", s == 200, str(d)[:160])
if s == 200:
    print("      %s -> %s · %d filas reales · %d obras programables · %d personas"
          % (d["lunes"], d["viernes"], len(d["real"]), len(d["obras"]), len(d["personas"])))
    check("...la semana va de lunes a viernes",
          d["lunes"] <= d["viernes"] and all(d["lunes"] <= r["dia"] <= d["viernes"] for r in d["real"]))
    check("...cada fila real trae persona, obra, dia y kg",
          all(k in r for r in d["real"] for k in ("persona", "obra", "job", "dia", "kg", "cc")))
    check("...las obras programables son SOLO de aSa, con su job",
          len(d["obras"]) > 0 and all(o.get("job") for o in d["obras"]))
    # El selector de cubicador: quien esta ACTIVO lo dice aSa, no una lista a mano.
    act = [p for p in d["personas"] if p["activo"]]
    print("      %d personas, %d activas (ultimos %d meses) · obras propias de %d personas"
          % (len(d["personas"]), len(act), d["meses_activo"], len(d["obras_persona"])))
    check("...cada persona dice si esta activa y cuanto lleva",
          all(set(("persona", "activo", "kg", "ultimo")) <= set(p) for p in d["personas"]))
    check("...activo = cubico algo en la ventana", all(p["kg"] > 0 for p in act)
          and all(p["kg"] == 0 for p in d["personas"] if not p["activo"]))
    check("...hay menos activos que personas historicas (si no, el filtro no sirve)",
          0 < len(act) < len(d["personas"]))
    check("...«sus obras» son de gente que existe y traen job y kilos",
          all(p in {x["persona"] for x in d["personas"]} for p in d["obras_persona"])
          and all(o.get("job") and o.get("kg") is not None
                  for lista in d["obras_persona"].values() for o in lista))
    s2, d2 = get("/programacion/semana-real", desde="2026-09-16")
    check("...y se puede pedir otra semana (16-sep cae en la del 14 al 18)",
          s2 == 200 and d2["lunes"] == "2026-09-14" and d2["viernes"] == "2026-09-18")

print("\n6c. Auditorias de cubicacion (maqueta): obra, alcance y muestra reales")
s, d = get("/auditorias/obras")
check("GET /auditorias/obras -> 200", s == 200, str(d)[:160])
if s == 200 and d.get("obras"):
    print("      %d obras con barras · %d auditores posibles" % (len(d["obras"]), len(d["auditores"])))
    ob = max(d["obras"], key=lambda o: o["elementos"])
    s2, u = get("/auditorias/universo", id_proyecto=ob["id_proyecto"])
    check("GET /auditorias/universo -> 200 (%s: %d elementos)" % (ob["obra"][:30], u.get("elementos", 0) if s2 == 200 else 0), s2 == 200, str(u)[:160])
    if s2 == 200:
        print("      tipos %s · %d pisos · %d ciclos · cubicaron %d"
              % ([x["nombre"] for x in u["sectores"]], len(u["pisos"]), len(u["ciclos"]), len(u["cubicadores"])))
        check("...los elementos del universo cuadran con la lista de obras", u["elementos"] == ob["elementos"])
        piso = u["pisos"][0]["piso"] if u["pisos"] else ""
        s3, m = get("/auditorias/muestra", id_proyecto=ob["id_proyecto"], n=5, pisos=piso)
        check("GET /auditorias/muestra (5 elementos del piso %s) -> 200" % piso, s3 == 200, str(m)[:160])
        if s3 == 200:
            check("...trae 5 elementos enteros, con barras, kilos y quien cubico",
                  len(m["elementos"]) == 5 and all(e["barras"] > 0 and e["kg"] > 0 and e["cubicado_por"] for e in m["elementos"]))
            check("...todos del piso pedido", all(e["piso"] == piso for e in m["elementos"]))
            s4, m2 = get("/auditorias/muestra", id_proyecto=ob["id_proyecto"], n=5, pisos=piso, semilla=m["semilla"])
            check("...y con la misma semilla sale la MISMA muestra",
                  s4 == 200 and [e["nombre"] for e in m2["elementos"]] == [e["nombre"] for e in m["elementos"]])
            s5, _ = get("/auditorias/muestra", id_proyecto=ob["id_proyecto"], n=5, pisos="NO-EXISTE")
            check("un alcance vacio rebota con 400", s5 == 400)

if SYNC:
    print("\n7. Sincronizacion desde aSa (escribe en el espejo)")
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

    print("\n8. El reporte con data real (2026, Ago+Sep)")
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
