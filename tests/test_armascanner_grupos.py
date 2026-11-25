"""ARMASCANNER EN ARMAHUB, EL PEDIDO POR GRUPO (mig 183, 25-nov): el avance sin terminar, el pedido de un ciclo
completo, lo enviado de cada grupo y lo que cambió después.

Sin Postgres, como test_armascanner.py: las reglas se prueban solas (funciones puras) y las rutas corren con
FastAPI sobre SQLite en memoria, armada con las migraciones reales de los planos (169, 171–174, 177, 183), con R2,
las fichas y la importación simulados. Si están los archivos de un plano real escaneado por ArmaScanner
(%LOCALAPPDATA%\\ArmaScanner\\proyectos\\…\\trabajo\\*_subida.csv), también de punta a punta con ellos.
Correr con: python tests/test_armascanner_grupos.py
"""
import contextlib
import glob
import io
import json
import os
import sqlite3
import sys
import zipfile
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

from armahub import armascanner  # noqa: E402
from paquete_entero import Entero  # noqa: E402

A = Entero(armascanner)
fallos = 0


def check(nombre, cond, detalle=""):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -- " + str(detalle)[:400]) if not cond else ""))
    if not cond:
        fallos += 1


# ══════ Las reglas (funciones puras) ══════
print("TEST: el estado que manda ArmaScanner de cada grupo, acotado")
g = A.grupos_enviados({"ciclos_estado": {"C1": {"barras": 3, "kg": 12.345, "completo": True, "huella": "a" * 80},
                                         "C2": {"barras": "x", "completo": "si"}, "": {}, "C3": "no"}})
check("nombres, números y huella acotados; completo sólo con true",
      g == {"C1": {"barras": 3, "kg": 12.3, "completo": True, "huella": "a" * 64},
            "C2": {"barras": None, "kg": None, "completo": False, "huella": ""}}, g)
check("sin ciclos_estado (ArmaScanner anteriores): nada", A.grupos_enviados({}) == {} and
      A.grupos_enviados({"ciclos_estado": [1]}) == {})

print("\nTEST: el estado de un grupo")
completo, otro = {"completo": True, "huella": "h1"}, {"completo": True, "huella": "h2"}
check("completo y sin enviar", A.estado_grupo(completo, None) == "completo")
check("enviado: la última versión trae lo que se envió", A.estado_grupo(completo, {"huella": "h1"}) == "enviado")
check("cambios después del pedido: completo y con otra huella", A.estado_grupo(otro, {"huella": "h1"}) == "cambios")
check("en revisión: incompleto (aunque se haya enviado antes)",
      A.estado_grupo({"completo": False, "huella": "h3"}, None) == "en_revision"
      and A.estado_grupo({"completo": False, "huella": "h3"}, {"huella": "h1"}) == "en_revision")
check("un grupo que ya no viene: en revisión", A.estado_grupo(None, {"huella": "h1"}) == "en_revision")
check("C2 antes que C10", [x["grupo"] for x in A.grupos_del_plano({"C10": completo, "C2": completo, "C1": otro}, {})]
      == ["C1", "C2", "C10"])

CAB = ("FORMATO: ArmaDetailer Export v1.0\nPROYECTO: N/A|N/A\nPLANO: PC-1|P1.dwg\nEJE: LOSAS\nFECHA: 25/11/2026 10:00\n"
       + "=" * 42 + "\nID|MARCA|FIGURA|DIAM|CANT|A|B|LARGO_TOTAL|CICLO|PISO|EJE|PLANO_CODE|ID_UNICO\n")


def fila_csv(i, ciclo, figura="101A", a="300", b="0"):
    return f"B-{i}|Fi|{figura}|10|5|{a}|{b}|{int(a) + int(b)}|{ciclo}|P3|101|PC-1|PC-1-B-{i}\n"


CSV1 = (CAB + fila_csv(1, "C1") + fila_csv(2, "C1") + fila_csv(3, "C2")).encode("utf-8")
csv_c1, filas_c1 = A.csv_del_grupo(CSV1, "C1")
check("el CSV de un grupo: su encabezado y sólo sus filas",
      [f["ID"] for f in filas_c1] == ["B-1", "B-2"] and csv_c1.decode().startswith("FORMATO") and "B-3|" not in csv_c1.decode()
      and csv_c1.decode().count("\n") == 9, csv_c1)
check("el grupo se busca sin importar mayúsculas", len(A.csv_del_grupo(CSV1, "c2")[1]) == 1)
check("un grupo que no está: sin filas", A.csv_del_grupo(CSV1, "C9")[1] == [])
CSV2 = (CAB + fila_csv(2, "C1", "102A", "280", "20") + fila_csv(4, "C1") + fila_csv(3, "C2")).encode("utf-8")
dif = A.diferencias(A.filas_para_traza(filas_c1), A.csv_del_grupo(CSV2, "C1")[1])
check("diferencias barra por barra: nuevas, corregidas con su campo y eliminadas",
      dif["nuevas"] == ["B-4"] and dif["eliminadas"] == ["B-1"]
      and dif["corregidas"] == [{"id": "B-2", "campos": [["FIGURA", "101A", "102A"], ["A", "300", "280"], ["B", "0", "20"],
                                                          ["LARGO_TOTAL", "300", "300"]][:3]}], dif)
check("lo mismo enviado y actual: sin diferencias",
      A.diferencias(A.filas_para_traza(filas_c1), filas_c1) == {"nuevas": [], "corregidas": [], "eliminadas": []})

# ══════ Las rutas, contra una base simulada (como test_armascanner.py) ══════
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import armahub.notifications as N  # noqa: E402
from armahub import storage  # noqa: E402
from armahub.auth import get_current_user, require_admin_or_admin_calidad  # noqa: E402
from armahub.db import _split_sql_statements  # noqa: E402

sqlite3.register_converter("JSONB", json.loads)
sqlite3.register_converter("TIMESTAMPTZ", lambda v: (lambda m: m if m.tzinfo else m.replace(tzinfo=timezone.utc))(
    datetime.fromisoformat(v.decode())))
sqlite3.register_adapter(datetime, lambda d: d.isoformat())
BASE = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES, check_same_thread=False)
BASE.create_function("NOW", 0, lambda: datetime.now(timezone.utc).isoformat())


def a_sqlite(sql, params):
    sql = sql.replace("::jsonb", "").replace(" FOR UPDATE", "").replace(" FOR SHARE", "")
    partes, valores = sql.split("%s"), []
    out = [partes[0]]
    for valor, resto in zip(list(params or ()), partes[1:]):
        if isinstance(valor, (list, tuple)):
            out[-1] = out[-1][:out[-1].rindex("= ANY(")] + "IN ("
            out.append(",".join("?" * len(valor)) or "NULL")
            valores += list(valor)
        else:
            out.append("?")
            valores.append(valor)
        out.append(resto)
    return "".join(out), valores


class Cursor:
    def __init__(self):
        self.c = BASE.cursor()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.c.close()

    def execute(self, sql, params=()):
        self.c.execute(*a_sqlite(sql, params))

    def executemany(self, sql, filas):
        for f in filas:
            self.execute(sql, f)

    def fetchone(self):
        return self.c.fetchone()

    def fetchall(self):
        return self.c.fetchall()

    @property
    def rowcount(self):
        return self.c.rowcount


class Conexion:
    def cursor(self):
        return Cursor()


@contextlib.contextmanager
def get_conn():
    try:
        yield Conexion()
        BASE.commit()
    except Exception:
        BASE.rollback()
        raise


def migrar(numero):
    nombre = next(f for f in os.listdir(os.path.join(ROOT, "armahub", "migrations")) if f.startswith(f"{numero}_"))
    sentencias = _split_sql_statements(open(os.path.join(ROOT, "armahub", "migrations", nombre), encoding="utf-8").read())
    for s in sentencias:
        BASE.execute(s.replace("SERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT")
                     .replace("ADD COLUMN IF NOT EXISTS", "ADD COLUMN").replace("DEFAULT NOW()", "DEFAULT CURRENT_TIMESTAMP"))
    BASE.commit()
    return sentencias


def una(sql, *params):
    return BASE.execute(sql, params).fetchone()


BASE.executescript("""CREATE TABLE proyectos (id_proyecto TEXT, nombre_proyecto TEXT, asa_job_id TEXT, constructora_id INTEGER);
                      CREATE TABLE users (email TEXT, nombre TEXT, apellido TEXT);
                      CREATE TABLE barras (id_proyecto TEXT, plano_code TEXT, ciclo TEXT, id_unico TEXT, import_id INTEGER,
                                           origen TEXT, sector TEXT, piso TEXT, revision TEXT);
                      CREATE TABLE imports (id INTEGER PRIMARY KEY, id_proyecto TEXT, plano_code TEXT, herramienta TEXT,
                                            modo_reemplazo TEXT, scope_reemplazo TEXT, barras_eliminadas_previo INTEGER,
                                            herramienta_version TEXT, equipo TEXT, pendientes TEXT);
                      INSERT INTO proyectos VALUES ('PROY-1', 'INGEVEC - EDIFICIO LOS LILENES', 'A-100', NULL);
                      INSERT INTO users VALUES ('emilio@x.cl', 'Emilio', 'Ramírez'), ('eugenio@x.cl', 'Eugenio', 'Zalazar'),
                                               ('jefa@x.cl', 'Ana', 'Jefa');""")
for n in (169, 171, 172, 173, 174, 177):
    migrar(n)
s183 = migrar(183)
print("\nTEST: migración 183")
check("sólo sentencias que se pueden repetir",
      all(s.startswith(("CREATE TABLE IF NOT EXISTS", "CREATE INDEX IF NOT EXISTS"))
          or (s.startswith("ALTER TABLE") and "ADD COLUMN IF NOT EXISTS" in s) for s in s183), s183)
check("la entrega trae su etapa (terminado por omisión) y sus grupos; la traza es por grupo (genérico)",
      "etapa TEXT NOT NULL DEFAULT 'terminado'" in s183[0] and "grupos JSONB" in s183[1]
      and "grupo        TEXT NOT NULL" in s183[2])
BASE.execute("INSERT INTO armascanner_obras (id_proyecto, agregada_por) VALUES ('PROY-1', 'emilio@x.cl')")
BASE.commit()

R2 = {}
storage.upload_file = lambda clave, contenido, tipo="application/octet-stream": R2.__setitem__(clave, contenido)
storage.delete_file = lambda clave: R2.pop(clave, None)
storage.download_file = lambda clave: R2[clave]
storage.generate_presigned_url = lambda clave, expires=3600, content_type=None, descargar_como=None: f"https://r2/{clave}"
AUDITORIA, IMPORTADO = [], []
sesion = {"email": "jefa@x.cl", "role": "admin"}
A.get_conn = get_conn
A._usuario = lambda cur, ficha: {"email": ficha, "role": "admin" if ficha == "jefa@x.cl" else "cubicador"}
A._con_licencia_o_admin = lambda cur, user: None
A.audit = lambda *a: AUDITORIA.append(a)
N.crear_notificacion = lambda *a, **k: None
siguiente = {"id": 100}


async def _cargar_barras(user, obra, plano_code, reemplaza, revision, sin_subir, contenido, nombre, version, equipo,
                         grupo=None):
    """La importación simulada: deja las barras del CSV en `barras` con la carga nueva (como el UPSERT real, que
    pone su import_id a las que ya estaban)."""
    siguiente["id"] += 1
    imp = siguiente["id"]
    filas = [dict(zip(contenido.decode().splitlines()[6].split("|"), x.split("|")))
             for x in contenido.decode().splitlines()[7:] if x.strip()]
    BASE.execute("INSERT INTO imports (id, id_proyecto, plano_code, herramienta) VALUES (?, ?, ?, 'ArmaScanner')",
                 (imp, obra, plano_code))
    for f in filas:
        BASE.execute("DELETE FROM barras WHERE id_proyecto = ? AND id_unico = ?", (obra, f["ID_UNICO"]))
        BASE.execute("INSERT INTO barras (id_proyecto, plano_code, ciclo, id_unico, import_id, origen) VALUES (?, ?, ?, ?, ?, 'csv')",
                     (obra, plano_code, f["CICLO"], f["ID_UNICO"], imp))
    BASE.commit()
    IMPORTADO.append({"grupo": grupo, "reemplaza": reemplaza, "ids": [f["ID"] for f in filas], "nombre": nombre})
    return {"ok": True, "import_id": imp, "proyecto": obra, "barras": len(filas), "kilos": 10.0}, 0


A._cargar_barras = _cargar_barras


def _solo_admin():
    if sesion["role"] not in ("admin", "admin_calidad"):
        raise HTTPException(status_code=403, detail="Sólo administrador.")
    return dict(sesion)


app = FastAPI()
app.include_router(A.router)
app.dependency_overrides[get_current_user] = lambda: dict(sesion)
app.dependency_overrides[require_admin_or_admin_calidad] = _solo_admin
web = TestClient(app)
EMI, EUG = "emilio@x.cl", "eugenio@x.cl"


def paquete(csv, ciclos=None):
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("trabajo/P1_subida.csv", csv)
        f.writestr("trabajo/P1_subida.json", json.dumps({"plano_code": "PC-1", "revision": {}, "ciclos": ciclos or {},
                                                         "sin_subir": [{"ciclo": "C2", "barra": "B-9"}]}))
        f.writestr("paquete.json", json.dumps({"registro": {}}))
    return z.getvalue()


def subir(ruta, email, csv, ciclos, plano="P1"):
    d = {"obra": "PROY-1", "plano": plano, "numero": "301", "titulo": "LOSA", "rev": "0", "elemento": "LCIELO",
         "ciclos": len(ciclos or {}), "barras": [{"id": "B-1", "rev": "aprobada", "kg": 5.0}], "version_app": "2026-11-25.3"}
    if ciclos is not None:
        d.update(etapa="en_revision" if ruta == "avance" else None, ciclos_estado=ciclos)
    return web.post(f"/armascanner/planos/{ruta}", headers={"Authorization": "Bearer " + email},
                    data={"datos": json.dumps({k: v for k, v in d.items() if v is not None})},
                    files={"paquete": ("paquete.zip", paquete(csv, ciclos), "application/zip")})


def pedir(email, grupo=None, plano="P1"):
    cuerpo = {"obra": "PROY-1", "plano": plano}
    if grupo:
        cuerpo["grupo"] = grupo
    return web.post("/armascanner/planos/pedido", headers={"Authorization": "Bearer " + email}, json=cuerpo)


def lista_portal(plano="P1"):
    return next(x for x in web.get("/armascanner/planos-linea", params={"obra": "PROY-1"}).json()["planos"] if x["plano"] == plano)


def estados(plano="P1"):
    return {x["grupo"]: x["estado"] for x in lista_portal(plano)["grupos"]}


C_V1 = {"C1": {"barras": 2, "kg": 7.5, "completo": True, "huella": "h1"},
        "C2": {"barras": 1, "kg": 2.0, "completo": False, "huella": "x1"}}

print("\nTEST: el avance (sin terminar)")
r = subir("avance", EMI, CSV1, C_V1)
check("entra en revisión, v1, con el estado de cada ciclo",
      r.status_code == 200 and r.json()["version"] == 1 and r.json()["etapa"] == "en_revision"
      and r.json()["ciclos"] == {"C1": "completo", "C2": "en_revision"} and r.json()["id_proyecto"] == "PROY-1", r.json())
check("la entrega y el plano quedan «en_revision», sin PDF; los grupos con la entrega",
      una("SELECT etapa, pdf FROM planos_obra_entregas WHERE plano = 'P1'") == ("en_revision", None)
      and una("SELECT etapa FROM planos_obra WHERE plano = 'P1'") == ("en_revision",)
      and json.loads(una("SELECT grupos FROM planos_obra_entregas WHERE plano = 'P1'")[0]) == A.grupos_enviados({"ciclos_estado": C_V1})
      if isinstance(una("SELECT grupos FROM planos_obra_entregas WHERE plano = 'P1'")[0], str)
      else una("SELECT grupos FROM planos_obra_entregas WHERE plano = 'P1'")[0] == A.grupos_enviados({"ciclos_estado": C_V1}))
p = lista_portal()
check("en el portal: en revisión, sin pedido del plano entero, con pedido por ciclo y el estado de cada uno",
      p["etapa"] == "en_revision" and p["puede_enviar"] is False and p["puede_enviar_grupos"] is True
      and [(x["grupo"], x["estado"], x["barras"]) for x in p["grupos"]] == [("C1", "completo", 2), ("C2", "en_revision", 1)], p)
check("otro cubicador no sube su avance sobre la entrega de Emilio: 409 ocupado",
      subir("avance", EUG, CSV1, C_V1).status_code == 409)
lf = web.get("/armascanner/planos", headers={"Authorization": "Bearer " + EMI}, params={"obra": "A-100"}).json()
check("ArmaScanner también ve los grupos del plano", [x["grupo"] for x in lf["planos"][0]["grupos"]] == ["C1", "C2"])

print("\nTEST: el pedido de un ciclo")
r = pedir(EMI)
check("el plano entero en revisión: 409 (se pide cada ciclo)", r.status_code == 409 and "ciclo" in r.json()["detail"], r.json())
r = pedir(EMI, "C2")
check("un ciclo incompleto: 409", r.status_code == 409 and "C2 no está completo" in r.json()["detail"], r.json())
check("otro que no es el autor (ni administrador): 403", pedir(EUG, "C1").status_code == 403)
# en los despieces había barras de C1 de antes (una que ya no viene), una de C2 y una ingresada a mano en C1
BASE.executescript("""INSERT INTO barras (id_proyecto, plano_code, ciclo, id_unico, import_id, origen) VALUES
                      ('PROY-1', 'PC-1', 'C1', 'PC-1-B-7', 3, 'csv'), ('PROY-1', 'PC-1', 'C2', 'PC-1-B-3', 3, 'csv'),
                      ('PROY-1', 'PC-1', 'C1', 'MAN-1', NULL, 'manual');""")
r = pedir(EMI, "C1")
check("C1 completo: entra sólo C1", r.status_code == 200 and IMPORTADO[-1]["grupo"] == "C1"
      and IMPORTADO[-1]["ids"] == ["B-1", "B-2"] and "_C1_" in IMPORTADO[-1]["nombre"], (r.json(), IMPORTADO[-1:]))
ids = {f[0] for f in BASE.execute("SELECT id_unico FROM barras WHERE id_proyecto = 'PROY-1'").fetchall()}
check("C1 reemplazado: sale la de C1 que no vino; quedan la de C2 y la ingresada a mano",
      ids == {"PC-1-B-1", "PC-1-B-2", "PC-1-B-3", "MAN-1"} and r.json()["reemplazadas"] == 1, (ids, r.json()))
check("la carga queda con su alcance (plano y ciclo)",
      una("SELECT modo_reemplazo, scope_reemplazo, barras_eliminadas_previo FROM imports WHERE id = ?", r.json()["import_id"])
      == ("por_plano_ciclo", "PC-1|C1", 1))
check("lo enviado queda anotado: versión, huella, barras y lo enviado barra por barra",
      una("SELECT grupo, version, huella, barras, enviado_por FROM planos_obra_grupos") == ("C1", 1, "h1", 2, EMI)
      and estados() == {"C1": "enviado", "C2": "en_revision"}, estados())
check("el envío queda en la auditoría", AUDITORIA[-1][1] == "armascanner_enviar_pedido_grupo")

print("\nTEST: cambios después del pedido, y reenviar")
C_V2 = {"C1": {"barras": 2, "kg": 7.0, "completo": True, "huella": "h2"},
        "C2": {"barras": 1, "kg": 2.0, "completo": True, "huella": "x2"}}
r = subir("avance", EMI, CSV2, C_V2)
check("v2: C1 cambió después del pedido; C2 completo", r.json()["version"] == 2
      and r.json()["ciclos"] == {"C1": "cambios", "C2": "completo"}, r.json())
d = web.get("/armascanner/planos-linea/grupo", params={"obra": "PROY-1", "plano": "P1", "grupo": "C1"}).json()
check("qué cambió en C1 desde lo enviado (v1): nuevas, corregidas con su campo, eliminadas",
      d["estado"] == "cambios" and d["enviado"]["version"] == 1 and d["enviado"]["enviado_por"] == "Emilio Ramírez"
      and d["diferencias"]["nuevas"] == ["B-4"] and d["diferencias"]["eliminadas"] == ["B-1"]
      and d["diferencias"]["corregidas"][0]["id"] == "B-2"
      and ["FIGURA", "101A", "102A"] in d["diferencias"]["corregidas"][0]["campos"], d)
r = web.post("/armascanner/planos-linea/pedido", json={"obra": "PROY-1", "plano": "P1", "grupo": "C1"})
check("reenviar C1 desde el portal (administrador): v2", r.status_code == 200 and r.json()["version"] == 2
      and estados() == {"C1": "enviado", "C2": "completo"}, (r.json(), estados()))
ids = {f[0] for f in BASE.execute("SELECT id_unico FROM barras WHERE id_proyecto = 'PROY-1'").fetchall()}
check("los despieces de C1 quedan como v2 (sale B-1, entra B-4)", ids == {"PC-1-B-2", "PC-1-B-4", "PC-1-B-3", "MAN-1"}, ids)
check("el historial de C1: dos envíos", [f[0] for f in BASE.execute(
      "SELECT version FROM planos_obra_grupos WHERE grupo = 'C1' ORDER BY id").fetchall()] == [1, 2])

print("\nTEST: terminar, y el pedido del plano entero")
r = subir("terminar", EMI, CSV2, C_V2)
check("terminado (v3), con sus grupos", r.json()["version"] == 3 and r.json()["etapa"] == "terminado"
      and una("SELECT etapa FROM planos_obra_entregas WHERE plano = 'P1'") == ("terminado",)
      and lista_portal()["puede_enviar"] is True, r.json())
r = pedir(EMI)
check("el pedido del plano entero deja enviado cada ciclo que trae", r.status_code == 200
      and IMPORTADO[-1]["grupo"] is None and estados() == {"C1": "enviado", "C2": "enviado"}, (r.json(), estados()))
r = subir("terminar", EMI, CSV2, None, plano="P2")
check("ArmaScanner anteriores (terminar sin ciclos_estado): como siempre, sin grupos",
      r.status_code == 200 and una("SELECT grupos FROM planos_obra_entregas WHERE plano = 'P2'") == (None,)
      and lista_portal("P2")["grupos"] == [] and lista_portal("P2")["puede_enviar"] is True and pedir(EMI, plano="P2").status_code == 200)

print("\nTEST: eliminar el plano se lleva su traza")
r = web.post("/armascanner/planos-linea/eliminar", json={"obra": "PROY-1", "plano": "P1", "con_barras": False})
check("sin filas de grupos del plano eliminado", r.status_code == 200
      and una("SELECT COUNT(*) FROM planos_obra_grupos WHERE plano = 'P1'") == (0,), r.json())

# ══════ De punta a punta con un plano real, si está en este equipo ══════
reales = glob.glob(os.path.join(os.environ.get("LOCALAPPDATA", ""), "ArmaScanner", "proyectos", "*", "trabajo", "*_subida.csv"))
if reales:
    ruta = max(reales, key=lambda r: os.path.getsize(r))
    csv_real = open(ruta, "rb").read()
    print(f"\nTEST: de punta a punta con un plano real ({os.path.basename(ruta)})")
    grupos_real = sorted({f.get("CICLO") for f in A.csv_del_grupo(csv_real, "")[1]} | {
        ln.split("|")[A.csv_del_grupo(csv_real, "C1")[0].decode().splitlines()[6].split("|").index("CICLO")]
        for ln in csv_real.decode("utf-8", "replace").splitlines()[7:] if ln.count("|") > 20}, key=A.orden_grupo)
    grupos_real = [x for x in grupos_real if x]
    ciclos_real = {c: {"barras": len(A.csv_del_grupo(csv_real, c)[1]), "kg": 1.0, "completo": True, "huella": "r-" + c}
                   for c in grupos_real}
    r = subir("avance", EMI, csv_real, ciclos_real, plano="REAL")
    check("el avance con el CSV real entra", r.status_code == 200 and set(r.json()["ciclos"].values()) == {"completo"}, r.json())
    r = pedir(EMI, grupos_real[0], plano="REAL")
    check(f"el pedido de {grupos_real[0]} importa sus {ciclos_real[grupos_real[0]]['barras']} barras",
          r.status_code == 200 and len(IMPORTADO[-1]["ids"]) == ciclos_real[grupos_real[0]]["barras"] > 0, r.json())
    d = web.get("/armascanner/planos-linea/grupo", params={"obra": "PROY-1", "plano": "REAL", "grupo": grupos_real[0]}).json()
    check("lo enviado y lo actual son lo mismo: sin diferencias", d["estado"] == "enviado"
          and d["diferencias"] == {"nuevas": [], "corregidas": [], "eliminadas": []}, d)
else:
    print("\n(sin planos reales de ArmaScanner en este equipo: la prueba de punta a punta no corre)")

print("\n" + ("TODO OK" if not fallos else f"FALLOS: {fallos}"))
sys.exit(1 if fallos else 0)
