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


def _notifs_auditoria() -> int:
    """Cuantos avisos de auditoria hay en la campana. La notificacion se escribe fuera de
    la transaccion del hallazgo, asi que se consulta la base directo."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM notificaciones WHERE tipo_evento = 'auditoria_accion'")
            return cur.fetchone()[0]


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
            # El elemento ENTERO, para revisarlo: sus barras cuadran con lo que dijo la muestra.
            e0 = m["elementos"][0]
            s6, el = get("/auditorias/elemento", id_proyecto=ob["id_proyecto"], sector=e0["sector"] or "",
                         piso=e0["piso"] or "", ciclo=e0["ciclo"] or "", eje=e0["eje"] or "")
            check("GET /auditorias/elemento -> 200 (%s)" % e0["nombre"][:40], s6 == 200, str(el)[:160])
            if s6 == 200:
                check("...trae las mismas barras y kilos que anuncio la muestra",
                      el["n"] == e0["barras"] and abs(el["kg"] - e0["kg"]) < 1)
                check("...cada barra con marca, diametro, figura, largo y peso",
                      all(set(("marca", "diam", "figura", "dims", "largo", "peso_total", "plano")) <= set(b) for b in el["barras"]))
    check("las causas de NC salen del Ishikawa de Cubicaciones (%d)" % len(d.get("causas", [])),
          len(d.get("causas", [])) > 0 and all(c["codigo"] and c["categoria_nombre"] for c in d["causas"]))

    # EL CICLO COMPLETO contra la base real: crear -> hallazgos -> accion -> verificar ->
    # borrar. Es lo unico que prueba que la auditoria se guarda y que el estado se deriva.
    # Al final se borra: el smoke no deja basura.
    print("\n6d. Auditorias: el ciclo completo (escribe y borra)")
    causa = d["causas"][0]["codigo"]
    r = cli.post("/api/v1/auditorias", headers=H, json={
        "id_proyecto": ob["id_proyecto"], "auditor": ADMIN, "n": 3, "pisos": [piso]})
    check("POST /auditorias -> 200", r.status_code == 200, r.text[:200])
    if r.status_code == 200:
        a = r.json()
        aid = a["id"]
        print("      %s · %d elementos de %d · semilla %s · plazo %s"
              % (a["codigo"], len(a["elementos"]), a["total_rango"], a["semilla"], a["plazo"]))
        check("...nace planificada, sin revisar, con fechas puestas por el sistema",
              a["estado"] == "planificada" and a["revisados"] == 0 and a["creada"] and a["plazo"] > a["creada"])
        check("...y la muestra quedo GUARDADA (3 elementos con su id)",
              len(a["elementos"]) == 3 and all(e["id"] and e["nombre"] for e in a["elementos"]))
        e1, e2, e3 = a["elementos"]

        def hallazgo(eid, cuerpo):
            return cli.put("/api/v1/auditorias/%d/elementos/%d" % (aid, eid), headers=H, json=cuerpo)

        rr = hallazgo(e1["id"], {"hallazgo": "conforme"})
        check("un hallazgo conforme no exige texto -> 200", rr.status_code == 200, rr.text[:160])
        if rr.status_code == 200:
            check("...y la auditoria pasa a EN CURSO con fecha de inicio",
                  rr.json()["estado"] == "en_curso" and rr.json()["inicio"])
        rr = hallazgo(e2["id"], {"hallazgo": "nc_mayor", "texto": "   "})
        check("una NC sin texto rebota con 400 (no es evidencia)", rr.status_code == 400, rr.text[:160])
        rr = hallazgo(e2["id"], {"hallazgo": "nc_mayor", "texto": "largo 4.25 debia ser 4.85", "causa": causa})
        check("una NC con texto -> 200 y abre la accion pendiente", rr.status_code == 200, rr.text[:160])
        if rr.status_code == 200:
            el2 = [x for x in rr.json()["elementos"] if x["id"] == e2["id"]][0]
            check("...la accion queda para quien cubico, en pendiente",
                  el2["accion_estado"] == "pendiente" and el2["causa"] == causa)
            check("...y se le dejo el aviso en la campana",
                  _notifs_auditoria() > 0)
        rr = hallazgo(e2["id"], {"hallazgo": "zzz", "texto": "x"})
        check("un nivel de hallazgo inventado rebota con 422", rr.status_code == 422)

        rr = cli.put("/api/v1/auditorias/%d/elementos/%d/accion" % (aid, e1["id"]), headers=H,
                     json={"estado": "corregida"})
        check("mover la accion de un elemento SIN no conformidad -> 400", rr.status_code == 400, rr.text[:160])
        rr = cli.put("/api/v1/auditorias/%d/elementos/%d/accion" % (aid, e2["id"]), headers=H,
                     json={"estado": "corregida"})
        check("el cubicador marca corregida -> 200", rr.status_code == 200, rr.text[:160])
        rr = cli.put("/api/v1/auditorias/%d/elementos/%d/accion" % (aid, e2["id"]), headers=H,
                     json={"estado": "verificada"})
        check("el auditor verifica -> 200", rr.status_code == 200, rr.text[:160])

        rr = hallazgo(e3["id"], {"hallazgo": "observacion", "texto": "marca repetida"})
        check("al revisar el ultimo, la auditoria se CIERRA sola con su fecha",
              rr.status_code == 200 and rr.json()["estado"] == "cerrada" and rr.json()["cierre"], rr.text[:160])
        if rr.status_code == 200:
            res = rr.json()["resultado"]
            check("...y el resultado cuadra con la muestra (1 conforme, 1 observacion, 1 NC mayor)",
                  res["conforme"] == 1 and res["observacion"] == 1 and res["nc_mayor"] == 1
                  and sum(res.values()) == 3)
        s9, lst = get("/auditorias", id_proyecto=ob["id_proyecto"])
        check("aparece en la lista de su obra", s9 == 200 and any(x["id"] == aid for x in lst["auditorias"]))
        s9, mias = get("/auditorias/mias/acciones")
        check("GET /auditorias/mias/acciones -> 200", s9 == 200, str(mias)[:160])

        # EL INFORME: se genera de verdad y sale un PDF, no un error 500 con el primer
        # caracter raro. Es lo que se manda, asi que tiene que existir.
        r = cli.get("/api/v1/auditorias/%d/pdf" % aid, headers=H)
        check("GET /auditorias/{id}/pdf -> 200 y es un PDF de verdad (%d KB)" % (len(r.content) // 1024),
              r.status_code == 200 and r.content[:4] == b"%PDF" and len(r.content) > 1500, r.text[:160])

        # INDICADORES: cuentan sobre lo revisado y cuadran con la auditoria recien cerrada.
        s9, k = get("/auditorias/indicadores")
        check("GET /auditorias/indicadores -> 200", s9 == 200, str(k)[:160])
        if s9 == 200:
            print("      %d auditorias · %d elementos revisados · conformidad %s%% · %d NC"
                  % (k["auditorias"], k["total"]["revisados"], k["total"]["conformidad"],
                     k["total"]["nc_menor"] + k["total"]["nc_mayor"]))
            check("...la conformidad es conformes sobre REVISADOS",
                  k["total"]["revisados"] > 0 and k["total"]["conformidad"] ==
                  round(k["total"]["conforme"] / k["total"]["revisados"] * 100))
            check("...y se abre por cubicador, obra, mes y causa",
                  all(k.get(x) is not None for x in ("por_cubicador", "por_obra", "por_mes", "causas"))
                  and sum(x["revisados"] for x in k["por_cubicador"]) == k["total"]["revisados"])

        r = cli.delete("/api/v1/auditorias/%d" % aid, headers=H)
        check("admin puede borrar la auditoria de prueba -> 200", r.status_code == 200, r.text[:160])
        s9, _ = get("/auditorias/%d" % aid)
        check("...y ya no existe (404), con sus elementos borrados en cascada", s9 == 404)
        # El aviso de la campana NO cuelga de la auditoria (no tiene FK), asi que la
        # cascada no se lo lleva: lo borra el smoke para no dejar basura.
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM notificaciones WHERE tipo_evento = 'auditoria_accion' "
                            "AND mensaje LIKE %s", ("Auditoría " + a["codigo"] + "%",))
                borradas = cur.rowcount
        check("el smoke limpia los avisos que genero (%d)" % borradas, borradas >= 0)

    # AUDITAR UNA OBRA DE aSa: la que no esta en ArmaHub. Es lenta (pide los items a aSa
    # codigo a codigo), asi que se sortean DOS elementos y se borra al final.
    print("\n6e. Auditorias sobre una obra de aSa (consulta aSa en vivo)")
    asas = d.get("obras_asa", [])
    check("el selector trae tambien las obras de aSa (%d)" % len(asas),
          len(asas) > 0 and all(o["job"] and o["cc"] for o in asas))
    if asas:
        oa = max(asas, key=lambda o: o["cc"])
        s9, u = get("/auditorias/cc", job=oa["job"])
        check("GET /auditorias/cc -> 200 (%s: %d codigos sin despachar)"
              % (oa["obra"][:28], len(u.get("ccs", [])) if s9 == 200 else 0), s9 == 200, str(u)[:160])
        if s9 == 200:
            print("      %d codigos elegibles · %d despachados fuera" % (len(u["ccs"]), u["despachados"]))
            check("...el alcance de aSa son los codigos, con su nombre, kilos y quien cubico",
                  len(u["ccs"]) > 0 and all(set(("cc", "descr", "kg", "estado", "persona")) <= set(c) for c in u["ccs"]))
            check("...y NINGUNO esta despachado (auditarlo llegaria tarde)",
                  all(c["estado"] != "Shipped" for c in u["ccs"]))
            # Sin codigos elegidos no hay muestra posible.
            r = cli.post("/api/v1/auditorias", headers=H, json={
                "id_proyecto": oa["job"], "auditor": ADMIN, "origen": "asa", "n": 2, "ccs": []})
            check("crear sin marcar codigos -> 400", r.status_code == 400, r.text[:160])
            elegidos = [c["cc"] for c in sorted(u["ccs"], key=lambda c: -c["kg"])[:3]]
            t0 = time.time()
            r = cli.post("/api/v1/auditorias", headers=H, json={
                "id_proyecto": oa["job"], "auditor": ADMIN, "origen": "asa", "n": 2, "ccs": elegidos})
            check("POST /auditorias origen=asa -> 200 en %.0fs" % (time.time() - t0), r.status_code == 200, r.text[:220])
            if r.status_code == 200:
                a = r.json()
                print("      %s · %d elementos de %d codigos · %s"
                      % (a["codigo"], len(a["elementos"]), a["total_rango"],
                         " | ".join(e["nombre"][:40] for e in a["elementos"])))
                check("...guarda el codigo de control y el elemento de aSa",
                      a["origen"] == "asa" and all(e["cc"] and e["eje"] for e in a["elementos"]))
                check("...los elementos salen SOLO de los codigos que se eligieron",
                      all(e["cc"] in elegidos for e in a["elementos"]))
                check("...y el alcance queda guardado (de que codigos salio la muestra)",
                      sorted(a.get("ccs") or []) == sorted(elegidos))
                e0 = a["elementos"][0]
                t0 = time.time()
                s9, el = get("/auditorias/elemento-asa", cc=e0["cc"], element=e0["eje"])
                check("GET /auditorias/elemento-asa -> 200 en %.0fs" % (time.time() - t0), s9 == 200, str(el)[:200])
                if s9 == 200:
                    check("...trae las barras con marca, diametro, figura y LADOS",
                          el["n"] > 0 and all("marca" in b and "dims" in b for b in el["barras"]))
                    conlados = [b for b in el["barras"] if b["dims"]]
                    # La consola de Windows es cp1252 y el simbolo del gancho la revienta.
                    ejemplo = str(conlados[0]["dims"] if conlados else {}).encode("ascii", "replace").decode()
                    print("      %d barras · %d con lados · ejemplo %s" % (el["n"], len(conlados), ejemplo))
                rr = cli.put("/api/v1/auditorias/%d/elementos/%d" % (a["id"], e0["id"]), headers=H,
                             json={"hallazgo": "nc_menor", "texto": "gancho corto", "causa": causa})
                check("se le puede registrar un hallazgo igual que a una de ArmaHub",
                      rr.status_code == 200, rr.text[:160])
                r = cli.delete("/api/v1/auditorias/%d" % a["id"], headers=H)
                check("...y se borra al terminar la prueba", r.status_code == 200, r.text[:160])
                with get_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute("DELETE FROM notificaciones WHERE tipo_evento = 'auditoria_accion' "
                                    "AND mensaje LIKE %s", ("Auditoría " + a["codigo"] + "%",))

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
