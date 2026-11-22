"""ARMASCANNER EN ARMAHUB: las reglas puras y las rutas de los planos contra una base simulada.

Sin Postgres: las reglas se prueban solas (funciones puras) y las rutas corren con FastAPI sobre
SQLite en memoria, armada con las migraciones reales de los planos (169, 171–174), con R2 y las
fichas simulados. Correr con: python tests/test_armascanner.py
"""
import contextlib
import functools
import inspect
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

from armahub import armascanner as A  # noqa: E402

fallos = 0


def check(nombre, cond, detalle=""):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -- " + str(detalle)[:300]) if not cond else ""))
    if not cond:
        fallos += 1


print("TEST: pedido: qué combinaciones quedan sin exportar")
b = lambda c, r: {"sector": "LCIELO", "piso": "P5", "ciclo": c, "revision": r}  # noqa: E731
check("todo aprobado: nada bloqueado", A.pendientes_por_combinacion([b("C1", "aprobada")] * 3) == {})
p = A.pendientes_por_combinacion([b("C1", "aprobada"), b("C1", "duda"), b("C2", "pendiente"), b("C2", "pendiente")])
check("cuenta por SECTOR|PISO|CICLO", p == {"LCIELO|P5|C1": 1, "LCIELO|P5|C2": 2}, p)
check("las que no subieron cuentan como duda",
      A.pendientes_por_combinacion([dict(b("C3", None), revision="duda")]) == {"LCIELO|P5|C3": 1})
check("la clave va en mayúsculas, como la exportación",
      A.pendientes_por_combinacion([{"sector": "lcielo", "piso": "p5", "ciclo": "c1", "revision": "duda"}])
      == {"LCIELO|P5|C1": 1})

print("\nTEST: reglas (22-nov): una entrega por plano; el segundo pide el reemplazo")
yo, otro = "eugenio@x.cl", "emilio@x.cl"
check("plano sin entrega: entra", A.accion_al_terminar(None, yo, None) == "nueva")
check("la entrega es mía: la reemplazo (versión siguiente)", A.accion_al_terminar(yo, yo, None) == "mia")
check("la entrega es de otro y aceptó mi reemplazo: la reemplazo", A.accion_al_terminar(otro, yo, "aceptado") == "reemplaza")
check("la entrega es de otro sin reemplazo aceptado: ocupado (sin pedir, pendiente o rechazado)",
      all(A.accion_al_terminar(otro, yo, x) == "ocupado" for x in (None, "pendiente", "rechazado")))
cargado = {"etapa": "cargado", "tamano": 100}
check("cargar: el plano no existe, se crea", A.accion_al_cargar(None, False, 100) == "crear")
check("cargar: el mismo paquete, ya estaba", A.accion_al_cargar(cargado, False, 100) == "ya_estaba")
check("cargar: otro paquete sobre uno sólo cargado, versión nueva", A.accion_al_cargar(cargado, False, 101) == "version_nueva")
check("cargar: con entrega o con trabajo no se toca",
      A.accion_al_cargar(cargado, True, 101) == "ya_estaba"
      and A.accion_al_cargar({"etapa": "terminado", "tamano": 100}, False, 101) == "ya_estaba"
      and A.accion_al_cargar({"etapa": "en_trabajo", "tamano": 100}, False, 101) == "ya_estaba")
check("relación: sin la clave no se toca; con la clave manda el cliente, también para quitarla",
      A.relacion_enviada({}) is None and A.relacion_enviada({"relacion": ""}) == (None, None)
      and A.relacion_enviada({"relacion": "reemplaza", "relacion_de": "215-A"}) == ("reemplaza", "215-A")
      and A.relacion_enviada({"relacion": "otra", "relacion_de": "x"}) == (None, None))
k1, k2 = A.clave_paquete("PROY-1", "2024-005-215-2 ARMADURA (5° PISO)"), A.clave_paquete("PROY-1", "2024-005-215-2 ARMADURA (5° PISO)")
check("archivo: una carpeta por plano y una key única por subida (dos subidas nunca comparten key)",
      k1.rsplit("/", 1)[0] == k2.rsplit("/", 1)[0] and k1 != k2 and k1.endswith(".zip"), (k1, k2))
check("archivo: la key no lleva el nombre del plano (letras raras)", "°" not in k1 and " " not in k1, k1)
check("archivo: planos distintos, carpetas distintas",
      A.clave_paquete("PROY-1", "215").rsplit("/", 1)[0] != A.clave_paquete("PROY-1", "216").rsplit("/", 1)[0])

print("\nTEST: barras a la vista, resumen y pedido")
B = A.barras_a_la_vista([{"id": "B-1", "rev": "aprobada", "kg": 10.5, "otro": "x"}, {"id": "B-2", "rev": "duda", "kg": 2},
                         {"id": "B-3", "kg": 1, "rev": "rara"}, "basura"])
check("barras a la vista: sólo campos conocidos y revisión válida",
      len(B) == 3 and "otro" not in B[0] and B[2]["rev"] == "pendiente", B)
r = A.resumen_de(B, {"ciclos": 3, "etapa": "En revisión", "version_app": "2026-11-21"})
check("resumen: aprobadas, con consulta, por aprobar, kg",
      (r["barras"], r["aprobadas"], r["consultas"], r["pendientes"], r["kg"], r["ciclos"]) == (3, 1, 1, 1, 13.5, 3), r)
check("resumen: lleva la versión de ArmaScanner (para el pedido)", r["version_app"] == "2026-11-21", r)
check("resumen de un plano sin barras", A.resumen_de([])["barras"] == 0 and A.resumen_de([])["pendientes"] == 0)
check("envía el pedido quien terminó el plano", A.puede_enviar(yo, yo, False))
check("no lo envía otro cubicador", not A.puede_enviar(otro, yo, False) and not A.puede_enviar(None, yo, False))
check("lo envía el administrador", A.puede_enviar(otro, yo, True))
check("estado del pedido", (A.estado_pedido(3, None), A.estado_pedido(3, 3), A.estado_pedido(4, 3))
      == ("sin_enviar", "enviado", "cambios"))
check("Mis obras: todos ven todas las obras (sin filtro por usuario)", "usuario = %s" not in inspect.getsource(A.cargas))
check("cargar y terminar no cargan barras como despiece (eso es el pedido)",
      "_cargar_barras" not in inspect.getsource(A.guardar_plano) + inspect.getsource(A.terminar_plano))
check("versiones por número: .10 es más nueva que .9, y sin punto es la más vieja",
      A.clave_version("2026-11-20.10") > A.clave_version("2026-11-20.9") > A.clave_version("2026-11-20")
      and A.clave_version("2026-11-21") > A.clave_version("2026-11-20.99"))
check("la vigente y «hay versión nueva» no comparan texto",
      "ORDER BY version" not in inspect.getsource(A._vigente)
      and "clave_version(fila[1]) <= clave_version(version)" in inspect.getsource(A.actualizacion))
from armahub import export as E  # noqa: E402
check("la exportación consulta las combinaciones bloqueadas", hasattr(E, "combinaciones_bloqueadas"))

rutas = {r.path for r in A.router.routes}
check("rutas del contrato",
      {"/armascanner/obras", "/armascanner/planos", "/armascanner/planos/guardar", "/armascanner/planos/terminar",
       "/armascanner/planos/descargar", "/armascanner/planos/entrega/eliminar", "/armascanner/planos/pedido",
       "/armascanner/planos/enviar-pedido", "/armascanner/planos/tomar", "/armascanner/planos/soltar",
       "/armascanner/planos/reemplazo/pedir", "/armascanner/planos/reemplazos", "/armascanner/planos/reemplazo/responder",
       "/armascanner/planos/reemplazo/anular", "/armascanner/planos-linea", "/armascanner/planos-linea/pdf",
       "/armascanner/planos-linea/barras", "/armascanner/planos-linea/liberar", "/armascanner/planos-linea/pedido",
       "/armascanner/planos-linea/reemplazo/responder"} <= rutas, rutas)
check("ya no existen subir-plano ni elegir la versión que vale",
      not {"/armascanner/subir-plano", "/armascanner/planos-linea/vale"} & rutas and not hasattr(A, "_guardar_paquete"))


# ══════ Las rutas, contra una base simulada ══════
# SQLite en memoria con las migraciones reales (partidas como las parte db.py). Lo propio de Postgres
# que usan las consultas se traduce aquí: %s, ::jsonb, = ANY(lista), FOR UPDATE, NOW().
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import armahub.notifications as N  # noqa: E402
from armahub import storage  # noqa: E402
from armahub.auth import get_current_user, require_admin_or_admin_calidad  # noqa: E402
from armahub.db import _split_sql_statements  # noqa: E402

sqlite3.register_converter("JSONB", json.loads)
sqlite3.register_converter("TIMESTAMPTZ", lambda v: datetime.fromisoformat(v.decode()))
sqlite3.register_converter("BOOLEAN", lambda v: bool(int(v)))
sqlite3.register_adapter(datetime, lambda d: d.isoformat())
BASE = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES, check_same_thread=False)
BASE.create_function("NOW", 0, lambda: datetime.now(timezone.utc).isoformat())


def a_sqlite(sql, params):
    sql = sql.replace("::jsonb", "").replace(" FOR UPDATE", "")
    partes, valores = sql.split("%s"), []
    out = [partes[0]]
    for valor, resto in zip(list(params or ()), partes[1:]):
        if isinstance(valor, (list, tuple)):  # = ANY(%s)
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


print("\nTEST: migración 174")
BASE.executescript("""CREATE TABLE proyectos (id_proyecto TEXT, nombre_proyecto TEXT, asa_job_id TEXT);
                      CREATE TABLE users (email TEXT, nombre TEXT, apellido TEXT);
                      INSERT INTO proyectos VALUES ('PROY-1', 'INGEVEC - EDIFICIO LOS LILENES', 'A-100');
                      INSERT INTO users VALUES ('emilio@x.cl', 'Emilio', 'Zalazar'), ('eugenio@x.cl', 'Eugenio', 'Zalazar'),
                                               ('jefa@x.cl', 'Ana', 'Jefa');""")
for n in (169, 171, 172, 173):
    migrar(n)
# un plano de antes del cambio: guardado a medias (etapa NULL) y tomado por alguien
BARRAS_ANTES = [{"id": "L-1", "rev": "aprobada", "kg": 5.0}, {"id": "L-2", "rev": "pendiente", "kg": 7.0}]
BASE.execute("""INSERT INTO planos_obra (id_proyecto, plano, numero, version, archivo, tamano, barras, aprobadas, kg, subido_por,
                                         subido_el, tomado_por, tomado_el, resumen, barras_json)
                VALUES ('PROY-1', 'ANTES', '90', 4, 'obras/PROY-1/planos/x/v4.zip', 500, 2, 1, 12, 'eugenio@x.cl', NOW(),
                        'eugenio@x.cl', NOW(), ?, ?)""",
             (json.dumps(A.resumen_de(BARRAS_ANTES)), json.dumps(BARRAS_ANTES)))
s174 = migrar(174)
check("sólo sentencias que se pueden repetir (CREATE … IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, UPDATE)",
      all(s.startswith(("CREATE TABLE IF NOT EXISTS", "CREATE UNIQUE INDEX IF NOT EXISTS", "UPDATE planos_obra SET"))
          or (s.startswith("ALTER TABLE") and "ADD COLUMN IF NOT EXISTS" in s) for s in s174), s174)
check("una entrega por plano y un pedido que corre por solicitante",
      "UNIQUE (id_proyecto, plano)\n" in s174[0] and "vale" not in s174[0]
      and "WHERE estado IN ('pendiente', 'aceptado')" in next(s for s in s174 if "UNIQUE INDEX" in s))
check("transición: nadie queda con un plano tomado y lo guardado a medias pasa a «en_trabajo»",
      una("SELECT etapa, tomado_por, tomado_el FROM planos_obra WHERE plano = 'ANTES'") == ("en_trabajo", None, None))

# ── ArmaHub simulado: R2, fichas (la ficha es el correo), sesión del portal, auditoría y campana ──
R2 = {}
al_subir = []  # lo que pasa «mientras sube» (para cruzar dos subidas)


def _subir(clave, contenido, tipo="application/octet-stream"):
    R2[clave] = contenido
    while al_subir:
        al_subir.pop()()


storage.upload_file = _subir
storage.delete_file = lambda clave: R2.pop(clave, None)
storage.download_file = lambda clave: R2[clave]
storage.generate_presigned_url = lambda clave, expires=3600, content_type=None, descargar_como=None: (
    f"https://r2/{clave}?tipo={content_type or ''}")
AUDITORIA, AVISOS, PEDIDOS = [], [], []
sesion = {"email": "jefa@x.cl", "role": "admin"}
A.get_conn = get_conn
A._usuario = lambda cur, ficha: {"email": ficha, "role": "admin" if ficha == "jefa@x.cl" else "cubicador"}
A._con_licencia_o_admin = lambda cur, user: None
A.audit = lambda *a: AUDITORIA.append(a)
N.crear_notificacion = lambda tipo, reclamo, mensaje, destinatarios_extra=None: AVISOS.append((mensaje, destinatarios_extra))


async def _cargar_barras(user, obra, plano_code, reemplaza, revision, sin_subir, contenido, nombre, version, equipo):
    PEDIDOS.append({"plano_code": plano_code, "version_app": version, "csv": contenido})
    return {"ok": True, "import_id": 7, "proyecto": obra, "barras": 2, "kilos": 12.0}, 0


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


@functools.lru_cache(maxsize=None)
def paquete(relleno=0, csv=b"ID;KG\nB-1;10\n"):
    """Un paquete como el de ArmaScanner: la copia de trabajo y lo que el pedido lee de ella."""
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("trabajo/P1_subida.csv", csv)
        f.writestr("trabajo/P1_subida.json", json.dumps({"plano_code": "PC-1", "revision": {"B-1": "aprobada"}}))
        f.writestr("paquete.json", json.dumps({"registro": {}}))
        f.writestr("relleno.bin", b"r" * relleno)
    return z.getvalue()


def ficha(email):
    return {"Authorization": "Bearer " + email}


def cargar(email, plano, contenido, **datos):
    d = dict({"obra": "PROY-1", "plano": plano, "numero": "215", "titulo": "LOSA", "rev": "0", "elemento": "LCIELO",
              "barras": [], "etapa": "cargado"}, **datos)
    return web.post("/armascanner/planos/guardar", headers=ficha(email), data={"datos": json.dumps(d)},
                    files={"paquete": ("paquete.zip", contenido, "application/zip")})


def terminar(email, plano, contenido, barras, pdf=None, **datos):
    d = dict({"obra": "PROY-1", "plano": plano, "numero": "215", "titulo": "LOSA", "rev": "0", "elemento": "LCIELO",
              "ciclos": 2, "barras": barras, "version_app": "2026-11-21.3"}, **datos)
    archivos = {"paquete": ("paquete.zip", contenido, "application/zip")}
    if pdf:
        archivos["pdf"] = ("plano.pdf", pdf, "application/pdf")
    return web.post("/armascanner/planos/terminar", headers=ficha(email), data={"datos": json.dumps(d)}, files=archivos)


def con_ficha(email, ruta, **cuerpo):
    return web.post("/armascanner/planos/" + ruta, headers=ficha(email), json=dict({"obra": "PROY-1"}, **cuerpo))


def fila(plano, columnas):
    return una(f"SELECT {columnas} FROM planos_obra WHERE id_proyecto = 'PROY-1' AND plano = ?", plano)


def entrega(plano):
    return una("SELECT autor, version, archivo, pdf FROM planos_obra_entregas WHERE plano = ?", plano)


def pedidos(plano):
    return [tuple(f) for f in BASE.execute("""SELECT solicitante, autor, estado, respondido_por FROM planos_obra_reemplazos
                                               WHERE plano = ? ORDER BY id""", (plano,)).fetchall()]


def lista_ficha(email, plano):
    r = web.get("/armascanner/planos", headers=ficha(email), params={"obra": "A-100"}).json()
    return next(x for x in r["planos"] if x["plano"] == plano)


def lista_portal(plano):
    return next(x for x in web.get("/armascanner/planos-linea").json()["planos"] if x["plano"] == plano)


EMI, EUG = "emilio@x.cl", "eugenio@x.cl"
R2["obras/PROY-1/planos/x/v4.zip"] = paquete(3)  # el paquete del plano anterior al cambio
B3 = [{"id": "B-1", "rev": "aprobada", "kg": 10.0}, {"id": "B-2", "rev": "aprobada", "kg": 5.0}, {"id": "B-3", "rev": "duda", "kg": 1.5}]
B2 = [{"id": "B-1", "rev": "aprobada", "kg": 10.0}, {"id": "B-9", "rev": "aprobada", "kg": 2.0}]

print("\nTEST: cargar el plano del calculista (antecedente)")
r = cargar(EMI, "P1", b"a" * 100, relacion="reemplaza", relacion_de="P0").json()
check("plano nuevo: se crea cargado, v1", (r["ok"], r["version"], r["ya_estaba"]) == (True, 1, False)
      and fila("P1", "etapa, version, subido_por, relacion, relacion_de") == ("cargado", 1, EMI, "reemplaza", "P0"), r)
antecedente = fila("P1", "archivo")[0]
r = cargar(EUG, "P1", b"b" * 100, relacion="").json()
check("otro cubicador carga el mismo DWG: no es un error y no se toca nada",
      (r["ok"], r["version"], r["ya_estaba"]) == (True, 1, True) and list(R2).count(antecedente) == 1 and len(R2) == 2
      and fila("P1", "subido_por, relacion, archivo") == (EMI, "reemplaza", antecedente), (r, list(R2)))
r = cargar(EUG, "P1", b"c" * 120, relacion="").json()
check("otro paquete sobre uno sólo cargado: versión nueva del antecedente, y la relación la manda el cliente",
      (r["version"], r["ya_estaba"]) == (2, False) and fila("P1", "version, subido_por, relacion, relacion_de") == (2, EUG, None, None)
      and antecedente not in R2 and fila("P1", "archivo")[0] in R2 and len(R2) == 2, (r, list(R2)))
r = cargar(EMI, "P1", b"d" * 130, etapa="")
check("un ArmaScanner anterior guardando trabajo intermedio: 409 y pide actualizar",
      r.status_code == 409 and r.json()["detail"] == "Actualiza ArmaScanner: esta versión ya no guarda el trabajo "
      "intermedio en ArmaHub." and len(R2) == 2 and fila("P1", "version")[0] == 2, r.text)
r = cargar(EMI, "ANTES", b"e" * 90).json()
check("cargar sobre un plano con trabajo no lo rebaja ni borra sus barras",
      r["ya_estaba"] and fila("ANTES", "etapa, barras, version, archivo") == ("en_trabajo", 2, 4, "obras/PROY-1/planos/x/v4.zip"), r)

# dos cargas del mismo plano que se cruzan: mientras ésta sube, otra entra primero
antecedente = fila("P1", "archivo")[0]


def _gana_otro():
    R2["ganador.zip"] = b"g" * 140
    BASE.execute("UPDATE planos_obra SET version = version + 1, archivo = 'ganador.zip', tamano = 140 WHERE plano = 'P1'")


al_subir.append(_gana_otro)
r = cargar(EMI, "P1", b"f" * 150).json()
check("dos subidas cruzadas: el archivo del que ganó sigue en R2 y sólo se borra el propio",
      r["ya_estaba"] and r["version"] == 3 and "ganador.zip" in R2 and fila("P1", "archivo, tamano") == ("ganador.zip", 140)
      and len(R2) == 3 and 150 not in [len(v) for v in R2.values()], (r, {k: len(v) for k, v in R2.items()}))
R2.pop(antecedente)  # (el que ganó habría borrado el antecedente anterior)

print("\nTEST: terminar: una entrega por plano")
r = terminar(EMI, "P1", paquete(10), B3, pdf=b"%PDF-emilio").json()
check("primera entrega: entra, y el plano queda terminado con su resumen",
      (r["ok"], r["version"], r["reemplazo_de"]) == (True, 1, "") and r["resumen"]["barras"] == 3
      and fila("P1", "etapa, version, subido_por, barras, aprobadas, kg") == ("terminado", 4, EMI, 3, 2, 16.5)
      and fila("P1", "archivo")[0] == "ganador.zip", (r, fila("P1", "etapa, version, subido_por, barras, aprobadas, kg")))
check("lo que la fila era antes queda guardado (quién cargó el antecedente)",
      fila("P1", "base")[0]["etapa"] == "cargado" and fila("P1", "base")[0]["subido_por"] == EUG, fila("P1", "base"))
e1 = entrega("P1")
check("el paquete y el PDF quedan en R2, juntos y con key propia",
      R2[e1[2]] == paquete(10) and R2[e1[3]] == b"%PDF-emilio" and e1[3] == e1[2][:-3] + "pdf" and fila("P1", "pdf")[0] == e1[3])
x = lista_ficha(EMI, "P1")
check("lista de ArmaScanner: etapa, pdf, la entrega y las claves de antes vacías",
      (x["etapa"], x["pdf"], x["tomado_por"], x["tomado_el"], x["tomado_por_mi"], x["reemplazos"]) == ("terminado", True, "", "", False, [])
      and x["entrega"] == {"autor": "Emilio Zalazar", "autor_email": EMI, "mia": True, "version": 1,
                           "subido_el": x["entrega"]["subido_el"], "pdf": True}, x)
antes_r2 = dict(R2)
r = terminar(EUG, "P1", paquete(20), B2, pdf=b"%PDF-eugenio")
d = r.json()["detail"]
check("otro cubicador termina el mismo plano: 409 «ocupado» y no se guarda nada",
      r.status_code == 409 and d["codigo"] == "ocupado" and d["autor"] == "Emilio Zalazar" and d["reemplazo"] is None
      and d["mensaje"] == f"Emilio Zalazar ya subió este plano ({d['subido_el']}). Pídele que acepte el reemplazo."
      and R2 == antes_r2 and entrega("P1") == e1, r.text)
r = terminar(EMI, "P1", paquete(30), B3 + [{"id": "B-4", "rev": "aprobada", "kg": 3.5}]).json()
e1b = entrega("P1")
check("el autor termina de nuevo: reemplaza la suya (v2) con key nueva, y sus archivos anteriores se borran",
      (r["version"], e1b[0], e1b[1]) == (2, EMI, 2) and e1b[2] != e1[2] and R2[e1b[2]] == paquete(30) and e1b[3] is None
      and e1[2] not in R2 and e1[3] not in R2 and fila("P1", "version, barras, pdf") == (5, 4, None), (r, e1b, list(R2)))

print("\nTEST: pedir el reemplazo; el autor acepta o rechaza")
r = con_ficha(EUG, "reemplazo/pedir", plano="P1").json()
check("pedir: queda pendiente y se avisa al autor",
      r == {"ok": True, "estado": "pendiente"} and pedidos("P1") == [(EUG, EMI, "pendiente", None)]
      and AVISOS[-1] == ("Eugenio Zalazar pide reemplazar tu versión de 215 (INGEVEC - EDIFICIO LOS LILENES).", [EMI]),
      (r, pedidos("P1"), AVISOS[-1:]))
n_avisos = len(AVISOS)
check("pedir de nuevo no pide dos veces ni avisa otra vez",
      con_ficha(EUG, "reemplazo/pedir", plano="P1").json() == {"ok": True, "estado": "pendiente"}
      and len(pedidos("P1")) == 1 and len(AVISOS) == n_avisos)
check("el autor no se pide a sí mismo", con_ficha(EMI, "reemplazo/pedir", plano="P1").status_code == 409)
d = terminar(EUG, "P1", paquete(20), B2).json()["detail"]
check("con el pedido pendiente sigue ocupado, y dice en qué va", d["codigo"] == "ocupado" and d["reemplazo"] == "pendiente", d)
x = lista_ficha(EUG, "P1")
check("lista de ArmaScanner: la entrega es de otro y mi pedido corre",
      x["entrega"]["mia"] is False and [(y["solicitante"], y["solicitante_email"], y["estado"], y["mio"]) for y in x["reemplazos"]]
      == [("Eugenio Zalazar", EUG, "pendiente", True)], x)
rm, ru = (web.get("/armascanner/planos/reemplazos", headers=ficha(c)).json() for c in (EMI, EUG))
check("reemplazos: el autor lo ve para responder; el solicitante, el suyo",
      [(y["plano"], y["numero"], y["obra_nombre"], y["solicitante"], y["solicitante_email"]) for y in rm["para_mi"]]
      == [("P1", "215", "INGEVEC - EDIFICIO LOS LILENES", "Eugenio Zalazar", EUG)] and rm["mios"] == []
      and ru["para_mi"] == [] and [(y["plano"], y["autor"], y["estado"]) for y in ru["mios"]] == [("P1", "Emilio Zalazar", "pendiente")],
      (rm, ru))
check("con el pedido pendiente, el pedido de despiece sale igual", con_ficha(EMI, "pedido", plano="P1").status_code == 200)
check("responde sólo el autor (ArmaScanner)",
      con_ficha(EUG, "reemplazo/responder", plano="P1", solicitante=EUG, acepta=True).status_code == 403)
r = con_ficha(EMI, "reemplazo/responder", plano="P1", solicitante="Eugenio Zalazar", acepta=False).json()
check("el autor rechaza (por nombre): rechazado, y se avisa al solicitante",
      r == {"ok": True, "estado": "rechazado"} and pedidos("P1") == [(EUG, EMI, "rechazado", EMI)]
      and AVISOS[-1] == ("Emilio Zalazar rechazó que reemplaces 215 (INGEVEC - EDIFICIO LOS LILENES).", [EUG]), (r, AVISOS[-1:]))
d = terminar(EUG, "P1", paquete(20), B2).json()["detail"]
check("rechazado: sigue ocupado, y lo dice", d["reemplazo"] == "rechazado", d)
con_ficha(EUG, "reemplazo/pedir", plano="P1")
r = con_ficha(EUG, "reemplazo/anular", plano="P1").json()
ru = web.get("/armascanner/planos/reemplazos", headers=ficha(EUG)).json()
check("pide otra vez y lo anula: queda anulado y ya no aparece entre los suyos",
      r == {"ok": True} and [p[2] for p in pedidos("P1")] == ["rechazado", "anulado"] and ru["mios"] == [], (r, pedidos("P1"), ru))
check("anular sin pedido: 404", con_ficha(EUG, "reemplazo/anular", plano="P1").status_code == 404)

print("\nTEST: portal: el administrador responde por el autor; el reemplazo se cumple al terminar")
con_ficha(EUG, "reemplazo/pedir", plano="P1")
x = lista_portal("P1")
check("lista del portal: la entrega, el pedido y quién puede responder",
      x["entrega"]["autor"] == "Emilio Zalazar" and x["entrega"]["autor_email"] == EMI and x["puede_responder"]
      and [(y["solicitante"], y["estado"]) for y in x["reemplazos"]] == [("Eugenio Zalazar", "pendiente")]
      and not x["puede_liberar"] and x["en_edicion_por"] == "" and "por_decidir" not in x and "entregas" not in x, x)
sesion.update(email=EUG, role="cubicador")
r = web.post("/armascanner/planos-linea/reemplazo/responder",
             json={"obra": "PROY-1", "plano": "P1", "solicitante": EUG, "acepta": True})
check("en el portal responde el autor o un administrador", r.status_code == 403 and not lista_portal("P1")["puede_responder"], r.text)
sesion.update(email="jefa@x.cl", role="admin")
r = web.post("/armascanner/planos-linea/reemplazo/responder",
             json={"obra": "PROY-1", "plano": "P1", "solicitante": EUG, "acepta": True}).json()
check("el administrador acepta en lugar del autor: aceptado, en la auditoría y con aviso al solicitante",
      r == {"ok": True, "estado": "aceptado"} and pedidos("P1")[-1] == (EUG, EMI, "aceptado", "jefa@x.cl")
      and AUDITORIA[-1][1] == "armascanner_reemplazo" and "en lugar de " + EMI in AUDITORIA[-1][2]
      and AVISOS[-1] == ("Ana Jefa aceptó que reemplaces 215 (INGEVEC - EDIFICIO LOS LILENES).", [EUG]),
      (r, AUDITORIA[-1:], AVISOS[-1:]))
check("aceptar no borra nada: la entrega sigue", entrega("P1") == e1b and e1b[2] in R2)
r = con_ficha(EMI, "pedido", plano="P1")
check("aceptado: el pedido de despiece no sale hasta la versión nueva",
      r.status_code == 409 and r.json()["detail"] == "Se aceptó reemplazar este plano: envía el pedido cuando se suba la "
      "nueva versión." and not lista_portal("P1")["puede_enviar"], r.text)
check("…y la lista lo muestra aceptado", [y["estado"] for y in lista_portal("P1")["reemplazos"]] == ["aceptado"])
recalcular = A._recalcular


def _base_caida(*a):
    raise RuntimeError("la base no confirmó")


A._recalcular, antes_r2 = _base_caida, dict(R2)
try:
    terminar(EUG, "P1", paquete(50), B2)
except RuntimeError:
    pass
A._recalcular = recalcular
check("si la base no confirma: la entrega anterior y su archivo siguen, y lo subido se borra",
      R2 == antes_r2 and entrega("P1") == e1b and pedidos("P1")[-1][2] == "aceptado", list(R2))
r = terminar(EUG, "P1", paquete(20), B2, pdf=b"%PDF-eugenio").json()
e2 = entrega("P1")
check("con el reemplazo aceptado, termina: su versión reemplaza la del autor (v3)",
      (r["ok"], r["version"], r["reemplazo_de"]) == (True, 3, EMI) and e2[:2] == (EUG, 3)
      and fila("P1", "subido_por, barras, kg, etapa") == (EUG, 2, 12, "terminado"), (r, e2))
check("…los archivos del autor anterior se borran (después de confirmar) y quedan los nuevos",
      e1b[2] not in R2 and R2[e2[2]] == paquete(20) and R2[e2[3]] == b"%PDF-eugenio", list(R2))
check("…el pedido queda cumplido y se avisa al autor anterior",
      pedidos("P1")[-1][2] == "cumplido"
      and AVISOS[-1] == ("Eugenio Zalazar reemplazó tu versión de 215 (INGEVEC - EDIFICIO LOS LILENES).", [EMI]),
      (pedidos("P1"), AVISOS[-1:]))
r = web.get("/armascanner/planos-linea/pdf", params={"obra": "PROY-1", "plano": "P1"}).json()
check("PDF: el de la entrega, para mostrarlo en la página", r == {"url": f"https://r2/{e2[3]}?tipo=application/pdf"}, r)
check("barras: las de la entrega", [y["id"] for y in web.get("/armascanner/planos-linea/barras",
                                                              params={"obra": "PROY-1", "plano": "P1"}).json()["barras"]] == ["B-1", "B-9"])
r = con_ficha(EUG, "enviar-pedido", plano="P1")
check("el pedido sale de la nueva entrega, con la versión de ArmaScanner",
      r.status_code == 200 and PEDIDOS[-1]["version_app"] == "2026-11-21.3" and PEDIDOS[-1]["plano_code"] == "PC-1"
      and lista_portal("P1")["pedido"] == "enviado", r.text)
check("descargar: la entrega, sin reservar nada; «mia» sólo si es mía",
      con_ficha(EMI, "descargar", plano="P1").json()["url"].startswith("https://r2/" + e2[2])
      and con_ficha(EMI, "descargar", plano="P1", autor="mia").status_code == 404
      and con_ficha(EUG, "descargar", plano="P1", autor="mia").json()["mia"])

print("\nTEST: eliminar mi entrega libera el plano")
con_ficha(EMI, "reemplazo/pedir", plano="P1")
r = con_ficha(EUG, "entrega/eliminar", plano="P1").json()
check("el autor la elimina: el plano vuelve a «cargado», se borran sus archivos y se avisa a quien la pidió",
      r == {"ok": True, "avisados": 1} and entrega("P1") is None and e2[2] not in R2 and e2[3] not in R2
      and fila("P1", "etapa, subido_por, barras, pdf, base, archivo") == ("cargado", EUG, 0, None, None, "ganador.zip")
      and pedidos("P1")[-1][2] == "anulado"
      and AVISOS[-1] == ("Eugenio Zalazar eliminó su versión de 215 (INGEVEC - EDIFICIO LOS LILENES): ya puedes terminarlo.", [EMI]),
      (r, fila("P1", "etapa, subido_por, barras, pdf, base, archivo"), AVISOS[-1:]))
check("…el pedido que ya había salido queda con cambios sin enviar, y sin PDF", lista_portal("P1")["pedido"] == "cambios"
      and web.get("/armascanner/planos-linea/pdf", params={"obra": "PROY-1", "plano": "P1"}).json() == {"url": None})
check("sin entrega propia: 404", con_ficha(EUG, "entrega/eliminar", plano="P1").status_code == 404)
r = terminar(EMI, "P1", paquete(60), B3).json()
check("libre: el que lo pidió termina sin más", r["ok"] and entrega("P1")[0] == EMI and r["reemplazo_de"] == "", r)
r = terminar(EMI, "P2", paquete(5), B2).json()
check("terminar un plano que no estaba en ArmaHub: se crea su fila",
      fila("P2", "etapa, version, archivo, subido_por") == ("terminado", 1, None, EMI), r)
con_ficha(EMI, "entrega/eliminar", plano="P2")
check("…y sin entrega ni antecedente, la fila se va", fila("P2", "etapa") is None)

print("\nTEST: planos anteriores al cambio (en_trabajo)")
check("el pedido de un plano anterior al cambio sale como antes (quien lo guardó)",
      con_ficha(EMI, "pedido", plano="ANTES").status_code == 403 and con_ficha(EUG, "pedido", plano="ANTES").json().get("version") == 4
      and PEDIDOS[-1]["version_app"] is None and fila("ANTES", "pedido_version, pedido_por") == (4, EUG))
r = con_ficha(EMI, "descargar", plano="ANTES").json()
check("descargar sin entrega: el paquete de la fila", (r["etapa"], r["version"], r["autor"]) == ("en_trabajo", 4, "Eugenio Zalazar")
      and r["url"].startswith("https://r2/obras/PROY-1/planos/x/v4.zip"), r)
terminar(EMI, "ANTES", paquete(7), B3)
check("alguien lo termina: queda terminado y su paquete anterior no se toca",
      fila("ANTES", "etapa, subido_por, version, archivo") == ("terminado", EMI, 5, "obras/PROY-1/planos/x/v4.zip")
      and "obras/PROY-1/planos/x/v4.zip" in R2)
con_ficha(EMI, "entrega/eliminar", plano="ANTES")
check("…y si elimina su entrega, vuelve a como estaba (en trabajo, con su avance y sus barras)",
      fila("ANTES", "etapa, subido_por, barras, aprobadas, kg, version") == ("en_trabajo", EUG, 2, 1, 12, 6)
      and fila("ANTES", "barras_json")[0] == BARRAS_ANTES and fila("ANTES", "resumen")[0]["pendientes"] == 1,
      fila("ANTES", "etapa, subido_por, barras, aprobadas, kg, version"))

print("\nTEST: lo que queda para un ArmaScanner anterior, y eliminar el plano")
r = con_ficha(EMI, "tomar", plano="P1")
check("tomar: 404 «Actualiza ArmaScanner.» (el cliente anterior abre en local)",
      r.status_code == 404 and r.json()["detail"] == "Actualiza ArmaScanner.", r.text)
check("soltar y liberar: responden bien sin hacer nada",
      con_ficha(EMI, "soltar", plano="P1").json() == {"ok": True}
      and web.post("/armascanner/planos-linea/liberar", json={"obra": "PROY-1", "plano": "P1"}).json() == {"ok": True})
con_ficha(EUG, "reemplazo/pedir", plano="P1")
check("eliminar un plano no es de cubicador", con_ficha(EMI, "eliminar", plano="P1").status_code == 403)
r = web.post("/armascanner/planos-linea/eliminar", json={"obra": "PROY-1", "plano": "P1", "con_barras": False}).json()
check("eliminar el plano (administrador): se van su fila, su entrega y sus archivos, y sus pedidos dejan de correr",
      r["ok"] and fila("P1", "etapa") is None and entrega("P1") is None and list(R2) == ["obras/PROY-1/planos/x/v4.zip"]
      and not [p for p in pedidos("P1") if p[2] in ("pendiente", "aceptado")], (r, list(R2), pedidos("P1")))

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
