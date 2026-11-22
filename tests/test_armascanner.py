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
check("Mis obras: todos ven todas las obras (los planos sin filtro por usuario)",
      'FROM planos_obra""")' in inspect.getsource(A.obras_linea))
check("cargar y terminar no cargan barras como despiece (eso es el pedido)",
      "_cargar_barras" not in inspect.getsource(A.guardar_plano) + inspect.getsource(A.terminar_plano))
check("versiones por número: .10 es más nueva que .9, y sin punto es la más vieja",
      A.clave_version("2026-11-20.10") > A.clave_version("2026-11-20.9") > A.clave_version("2026-11-20")
      and A.clave_version("2026-11-21") > A.clave_version("2026-11-20.99"))
check("la vigente y «hay versión nueva» no comparan texto",
      "ORDER BY version" not in inspect.getsource(A._vigente)
      and "clave_version(fila[1]) <= clave_version(version)" in inspect.getsource(A.actualizacion))

print("\nTEST: KPIs de Mis obras (22-nov): PPI, Ø prom, m² y kg/m²")
check("Ø prom ponderado por peso, sólo barras con diámetro y kg",
      A.diam_prom([{"diam": 12, "kg": 10}, {"diam": 8, "kg": 30}, {"diam": "x", "kg": 5}, {"kg": 3}]) == 9.0
      and A.diam_prom([{"kg": 3}]) is None and A.diam_prom([]) is None)
check("m² de losa: el total y los de cada ciclo, sólo números",
      A.m2_enviados({"m2": 250.04, "m2_ciclos": {"C1": 120, "C2": "x", "": 3}}) == (250.0, {"C1": 120.0})
      and A.m2_enviados({"m2": 80, "m2_ciclos": "basura"}) == (80.0, {}))
check("sin m² (elevaciones) o con algo que no es un área: nada",
      all(A.m2_enviados(d) is None for d in ({}, None, {"m2": True}, {"m2": float("nan")}, {"m2": float("inf")},
                                               {"m2": -1}, {"m2": 0}, {"m2": "abc"})))
r = A.resumen_de([{"id": "B-1", "rev": "aprobada", "kg": 10.0, "diam": 12}], {"m2": 40, "m2_ciclos": {"C1": 40}})
check("el resumen de la entrega lleva el Ø y los m² que manda ArmaScanner",
      (r["diam_prom"], r["m2"], r["m2_ciclos"]) == (12.0, 40.0, {"C1": 40.0}), r)
check("…y sin diámetro ni m², no los inventa", "diam_prom" not in A.resumen_de(B) and "m2" not in A.resumen_de(B, {}))
k = A.kpis_de([{"items": 10, "kg": 100, "diam_prom": 12, "m2": 50}, {"items": 30, "kg": 300, "diam_prom": 8, "m2": None}])
check("KPIs: PPI = kg / ítems, Ø ponderado por kg, kg/m² = kg / m² de losa",
      k == {"items": 40, "kg": 400.0, "ppi": 10.0, "diam_prom": 9.0, "m2": 50.0, "kg_m2": 8.0, "kg_fund": None}, k)
check("KPIs sin dato: None (la pantalla muestra «—», nunca 0)",
      A.kpis_de([]) == {"items": 0, "kg": 0.0, "ppi": None, "diam_prom": None, "m2": None, "kg_m2": None,
                        "kg_fund": None})
k = A.kpis_de([{"items": 1, "kg": 500, "m2": 50, "kg_fund": 0}, {"items": 1, "kg": 300, "kg_fund": 300}])
check("KPIs: las fundaciones aparte; no entran al kg/m² (kg sin fundaciones / m² de losa)",
      (k["kg"], k["kg_fund"], k["kg_m2"]) == (800.0, 300.0, 10.0), k)
check("los m² cuentan sólo en los planos de losa",
      A.es_losa("LCIELO") and A.es_losa("VCIELO, LCIELO") and not A.es_losa("VCIELO") and not A.es_losa(None)
      and A.plano_para_kpis({"barras": 3, "kg": 10, "m2": 40}, "ELEV")["m2"] is None
      and A.plano_para_kpis({"barras": 3, "kg": 10, "m2": 40}, "LCIELO")["m2"] == 40)
check("un resumen anterior sin Ø toma el calculado aparte",
      A.plano_para_kpis({"barras": 1, "kg": 5}, "LCIELO", 10.0)["diam_prom"] == 10.0
      and A.plano_para_kpis({"barras": 1, "kg": 5, "diam_prom": 8}, "LCIELO", 10.0)["diam_prom"] == 8)
check("el plano reemplazado por otro no suma a la obra (el que lo complementa, sí)",
      A.reemplazados([("O", "A", None, None), ("O", "B", "reemplaza", "A"), ("O", "C", "complementa", "B")]) == {("O", "A")})

print("\nTEST: kg por piso (22-nov): el piso de la etiqueta de cada barra; las fundaciones, aparte")
check("el piso como se agrupa: «5» y «P05» son «P5»; «P?», «P» y vacío, sin piso",
      [A.piso_normal(x) for x in ("P5", "5", "p05", " s1 ", "FUND", "P?", "P", "", None)]
      == ["P5", "P5", "P5", "S1", "FUND", "", "", "", ""])
check("la clase de una barra: fundación (sector o piso FUND), elevación, vigas (VCIELO) y el resto losa",
      [A.clase_de(s, p) for s, p in (("FUND", "S1"), ("LCIELO", "FUND"), ("ELEV", "P1"), ("LCIELO", "P1"),
                                     ("VCIELO", "P1"), ("", ""))] == ["fund", "fund", "elev", "losa", "viga", "losa"])
B = A.barras_a_la_vista([{"id": "B-1", "kg": 10, "piso": "P5", "sector": "LCIELO"}])
check("las barras a la vista guardan su piso y su sector", (B[0]["piso"], B[0]["sector"]) == ("P5", "LCIELO"), B)
check("el resumen lleva el kg por piso y sector si las barras traen su piso (si no, no lo inventa)",
      A.resumen_de([{"id": "B-1", "kg": 10.04, "piso": "P5", "sector": "LCIELO"}, {"id": "B-2", "kg": 5, "piso": "5",
                                                                                  "sector": "lcielo"},
                     {"id": "B-3", "kg": 2, "piso": "P5", "sector": "ELEV"}])["por_piso"]
      == [{"piso": "P5", "sector": "ELEV", "kg": 2.0}, {"piso": "P5", "sector": "LCIELO", "kg": 15.0}]
      and "por_piso" not in A.resumen_de([{"id": "B-1", "kg": 10}]))
PED = A.pedido_por_barra([("PC1", "PROY-PC1-B-0001", "P5", "LCIELO", 30), ("PC1", "PROY-PC1-B-0002", "P6", "ELEV", 10),
                          ("PC1", "raro", "P5", "LCIELO", 1)])
check("el pedido enviado: el piso y el sector de cada barra por su id, y los que más pesan",
      PED == {"B-0001": ("P5", "LCIELO"), "B-0002": ("P6", "ELEV"), None: ("P5", "LCIELO")}, PED)
check("una barra sin piso (plano anterior al 22-nov): el de su pedido, o el que más pesa en él; sin pedido, sin piso",
      A.kg_por_piso([{"id": "B-0001", "kg": 4}, {"id": "B-0002", "kg": 3}, {"id": "B-0009", "kg": 2}], PED)
      == [{"piso": "P5", "sector": "LCIELO", "kg": 6.0}, {"piso": "P6", "sector": "ELEV", "kg": 3.0}]
      and A.kg_por_piso([{"id": "B-1", "kg": 4}], None, "ELEV, LCIELO") == [{"piso": "", "sector": "ELEV", "kg": 4.0}])
check("el piso de un plano (sus m² de losa): el de más kg sin las fundaciones, mejor uno conocido",
      A.piso_del_plano([{"piso": "S1", "sector": "FUND", "kg": 900}, {"piso": "P1", "sector": "LCIELO", "kg": 10},
                        {"piso": "P2", "sector": "LCIELO", "kg": 20}, {"piso": "", "sector": "LCIELO", "kg": 99}]) == "P2"
      and A.piso_del_plano([]) == "")
T = A.tabla_por_piso([
    {"m2": 100, "por_piso": [{"piso": "S1", "sector": "LCIELO", "kg": 500}, {"piso": "S1", "sector": "VCIELO", "kg": 100}]},
    {"m2": None, "por_piso": [{"piso": "S1", "sector": "ELEV", "kg": 300}, {"piso": "P1", "sector": "ELEV", "kg": 200},
                              {"piso": "", "sector": "ELEV", "kg": 50}, {"piso": "S3", "sector": "ELEV", "kg": 10}]},
    {"m2": None, "por_piso": [{"piso": "S2", "sector": "FUND", "kg": 400}]},
    {"m2": 80, "por_piso": [{"piso": "P1", "sector": "LCIELO", "kg": 200}]}])
check("la tabla por piso: losa, vigas y elevación del piso, sus m² y kg/m²; en orden (S3, S1, P1, sin piso); fundaciones aparte",
      T == {"pisos": [{"piso": "S3", "kg_losa": None, "kg_viga": None, "kg_elev": 10.0, "kg": 10.0, "m2": None, "kg_m2": None},
                      {"piso": "S1", "kg_losa": 500.0, "kg_viga": 100.0, "kg_elev": 300.0, "kg": 900.0, "m2": 100.0, "kg_m2": 9.0},
                      {"piso": "P1", "kg_losa": 200.0, "kg_viga": None, "kg_elev": 200.0, "kg": 400.0, "m2": 80.0, "kg_m2": 5.0},
                      {"piso": "", "kg_losa": None, "kg_viga": None, "kg_elev": 50.0, "kg": 50.0, "m2": None, "kg_m2": None}],
            "fund": 400.0}, T)
check("…sin planos, vacía", A.tabla_por_piso([]) == {"pisos": [], "fund": None})
P = A.plano_para_kpis({"barras": 1, "kg": 400}, "FUND")
check("un plano sin kg por piso: todo sin piso, con el sector del plano (un plano de fundación cuenta como fundación)",
      (P["por_piso"], P["kg_fund"]) == ([{"piso": "", "sector": "FUND", "kg": 400.0}], 400.0)
      and A.plano_para_kpis({"barras": 1, "kg": 4, "por_piso": [{"piso": "P1", "sector": "ELEV", "kg": 4}]},
                             "ELEV")["por_piso"] == [{"piso": "P1", "sector": "ELEV", "kg": 4}], P)

print("\nTEST: aSa: el cruce de un plano con los códigos (CC) de su obra")
check("la ubicación del plano como se compara: el piso de ArmaScanner va sólo con su número",
      A.clave_ubicacion("LCIELO", "5", "C1") == ("LCIELO", "P5", "C1")
      and A.clave_ubicacion("LCIELO", "P05", "C01") == ("LCIELO", "P5", "C1"))
check("la del código, leída de su descripción (las formas que se repiten en aSa)",
      A.ubicacion_de_codigo("LC P5 C1") == ("LCIELO", "P5", "C1")
      and A.ubicacion_de_codigo("Losa 5°P (CICLO 2)") == ("LCIELO", "P5", "C2")
      and A.ubicacion_de_codigo("ELEV- P2 C2") == ("ELEV", "P2", "C2"))
check("…y no se adivina: sin sector, piso o ciclo, no calza",
      A.ubicacion_de_codigo("VIGAS+LOSAS P5 C1") is None and A.ubicacion_de_codigo("LCIELO P5") is None
      and A.ubicacion_de_codigo("") is None)
CCS = [{"cc": "SUQ1", "descr": "LCIELO P5 C1", "kg": 610.0}, {"cc": "SUQ2", "descr": "ELEV P5 C1", "kg": 900.0},
       {"cc": "SUQ4", "descr": "LC 5°P C1 complemento", "kg": 20.0}]
x = A.cruce_asa([("LCIELO", "5", "C1", 600), ("LCIELO", "5", "C2", 400)], CCS)
check("cruce: qué parte de los kilos del plano tiene código, cuáles y qué falta",
      (x["kg"], x["kg_en_asa"], x["pct"], [c["cc"] for c in x["codigos"]], x["faltan"])
      == (1000.0, 600.0, 60, ["SUQ1", "SUQ4"], ["LCIELO P5 C2"]), x)
check("cruce sin barras: sin porcentaje", A.cruce_asa([], CCS)["pct"] is None)
check("DWG: la copia de trabajo y, si no viene, el del calculista",
      A.dwg_del_paquete(["paquete.json", "planos/A.dwg", "trabajo/A_IA.dwg"]) == "trabajo/A_IA.dwg"
      and A.dwg_del_paquete(["paquete.json", "planos/A.dwg"]) == "planos/A.dwg"
      and A.dwg_del_paquete(["paquete.json", "trabajo/A_subida.csv"]) is None)

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
       "/armascanner/planos-linea/reemplazo/responder", "/armascanner/obras-linea", "/armascanner/obras-linea/asa",
       "/armascanner/planos-linea/dwg"} <= rutas, rutas)
check("Mis obras ya no lista las cargas sueltas", "/armascanner/cargas" not in rutas and not hasattr(A, "cargas"))
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
BASE.executescript("""CREATE TABLE proyectos (id_proyecto TEXT, nombre_proyecto TEXT, asa_job_id TEXT, constructora_id INTEGER);
                      CREATE TABLE users (email TEXT, nombre TEXT, apellido TEXT);
                      INSERT INTO proyectos VALUES ('PROY-1', 'INGEVEC - EDIFICIO LOS LILENES', 'A-100', NULL);
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

print("\nTEST: Mis obras (22-nov): la lista de obras con sus KPIs, aSa y el DWG")
BASE.executescript("""CREATE TABLE constructoras (id INTEGER, nombre TEXT);
                      CREATE TABLE asa_obras (asa_job_id TEXT, cliente TEXT);
                      CREATE TABLE asa_pedidos (control_code TEXT, asa_job_id TEXT, descr TEXT, kg NUMERIC, estado TEXT,
                                                order_date DATE);
                      CREATE TABLE asa_sync (fin TIMESTAMPTZ, ok BOOLEAN);
                      CREATE TABLE barras (id_proyecto TEXT, plano_code TEXT, sector TEXT, piso TEXT, ciclo TEXT,
                                           peso_total NUMERIC, origen TEXT, id_unico TEXT);
                      INSERT INTO constructoras VALUES (1, 'EBCO S.A.');
                      INSERT INTO asa_obras VALUES ('A-200', 'EBCO');
                      INSERT INTO proyectos VALUES ('PROY-2', 'EBCO - TORRE NORTE', 'A-200', 1);""")
L5 = [{"id": "L-1", "rev": "aprobada", "kg": 300.0, "diam": 12}, {"id": "L-2", "rev": "aprobada", "kg": 100.0, "diam": 8}]
E5 = [{"id": "E-1", "rev": "aprobada", "kg": 600.0, "diam": 16}]
L4 = [{"id": "V-1", "rev": "aprobada", "kg": 50.0, "diam": 10}]
r = terminar(EMI, "L5", paquete(70), L5, obra="PROY-2", elemento="LCIELO", m2=200.0, m2_ciclos={"C1": 120.0, "C2": 80.0}).json()
check("terminar con los m² de losa: quedan en el resumen de la entrega y del plano",
      (r["resumen"]["m2"], r["resumen"]["m2_ciclos"], r["resumen"]["diam_prom"]) == (200.0, {"C1": 120.0, "C2": 80.0}, 11.0)
      and una("SELECT resumen FROM planos_obra WHERE plano = 'L5'")[0]["m2"] == 200.0
      and una("SELECT resumen FROM planos_obra_entregas WHERE plano = 'L5'")[0]["m2_ciclos"] == {"C1": 120.0, "C2": 80.0}, r)
terminar(EMI, "E5", paquete(71), E5, obra="PROY-2", elemento="ELEV", m2=999.0)
terminar(EUG, "L4", paquete(72), L4, obra="PROY-2", elemento="LCIELO", m2=150.0)
terminar(EUG, "L4R", paquete(73), L4, obra="PROY-2", elemento="LCIELO", m2=150.0, relacion="reemplaza", relacion_de="L4")
cargar(EMI, "L6", b"h" * 80, obra="PROY-2", numero="216")
# un plano terminado antes del 22-nov: su resumen no trae el Ø (se calcula de sus barras)
BASE.execute("UPDATE planos_obra SET resumen = ? WHERE plano = 'E5'",
             (json.dumps({k: v for k, v in A.resumen_de(E5).items() if k != "diam_prom"}),))
BASE.commit()
obras_ = web.get("/armascanner/obras-linea").json()["obras"]
o = next(x for x in obras_ if x["id"] == "PROY-2")
check("la lista: la obra con su cliente, su constructora y su código de aSa; la de actividad más reciente, primero",
      obras_[0]["id"] == "PROY-2" and (o["nombre"], o["cliente"], o["constructora"], o["asa"])
      == ("EBCO - TORRE NORTE", "EBCO", "EBCO S.A.", "A-200") and o["ultima"], o)
check("…cuántos planos en cada etapa", (o["planos"], o["terminados"], o["cargados"], o["en_trabajo"]) == (5, 4, 1, 0), o)
check("…y sus KPIs: suman los planos con barras no reemplazados; los m², sólo los de losa",
      o["kpis"] == {"items": 4, "kg": 1050.0, "ppi": 262.5,
                    "diam_prom": round((12 * 300 + 8 * 100 + 16 * 600 + 10 * 50) / 1050, 1), "m2": 350.0, "kg_m2": 3.0,
                    "kg_fund": None},
      o["kpis"])
check("…y su tabla por piso: barras sin piso y sin pedido enviado van «sin piso» (losa y elevación por el plano)",
      o["por_piso"] == {"pisos": [{"piso": "", "kg_losa": 450.0, "kg_viga": None, "kg_elev": 600.0, "kg": 1050.0, "m2": 350.0,
                                   "kg_m2": 3.0}], "fund": None}, o["por_piso"])
check("…con lo que espera a alguien: los pedidos sin enviar", (o["reemplazos"], o["consultas"], o["sin_enviar"]) == (0, 0, 3), o)
pl = {x["plano"]: x for x in web.get("/armascanner/planos-linea", params={"obra": "PROY-2"}).json()["planos"]}
check("los planos de la obra, cada uno con sus KPIs (m² sólo si es de losa; el cargado, sin KPIs)",
      pl["L5"]["kpis"] == {"items": 2, "kg": 400.0, "ppi": 200.0, "diam_prom": 11.0, "m2": 200.0, "kg_m2": 2.0,
                           "kg_fund": None}
      and pl["E5"]["kpis"]["m2"] is None and pl["E5"]["kpis"]["diam_prom"] == 16.0 and pl["L6"]["kpis"] is None
      and set(pl) == {"L4", "L4R", "L5", "E5", "L6"}, pl)

# aSa: el pedido de L5 dejó sus barras en los despieces (aquí, a mano) y la obra tiene sus códigos en aSa
con_ficha(EMI, "pedido", obra="PROY-2", plano="L5")
BASE.executescript("""INSERT INTO barras VALUES ('PROY-2', 'PC-1', 'LCIELO', '5', 'C1', 300, 'csv', 'PROY-2-PC-1-L-1'),
                                               ('PROY-2', 'PC-1', 'LCIELO', '5', 'C1', 100, 'csv', 'PROY-2-PC-1-L-2'),
                                               ('PROY-2', 'PC-1', 'LCIELO', '5', 'C2', 400, 'csv', 'PROY-2-PC-1-L-3'),
                                               ('PROY-1', 'PC-1', 'LCIELO', '5', 'C2', 999, 'csv', 'PROY-1-PC-1-L-1');
                      INSERT INTO asa_pedidos VALUES ('SUQ1', 'A-200', 'LCIELO P5 C1', 410, 'Open', '2026-11-20'),
                                                     ('SUQ2', 'A-200', 'ELEV P5 C1', 900, 'Processed', '2026-11-18'),
                                                     ('SUQ3', 'A-200', 'LCIELO P5 C2', 400, 'Cancelled', '2026-11-19'),
                                                     ('SUQ9', 'A-100', 'LCIELO P5 C2', 400, 'Open', '2026-11-19');
                      INSERT INTO asa_sync VALUES ('2026-11-22T06:00:00+00:00', 1);""")
a = web.get("/armascanner/obras-linea/asa", params={"obra": "PROY-2"}).json()
x = {p["plano"]: p for p in a["planos"]}
check("aSa: los códigos vivos de la obra (sin los anulados ni los de otra obra)",
      (a["asa"], a["codigos"], a["kg"]) == ("A-200", 2, 1310.0) and isinstance(a["al"], str), a)
check("…por plano con pedido: qué parte de sus kilos tiene código, cuáles y qué ciclo falta",
      (x["L5"]["pedido"], x["L5"]["kg"], x["L5"]["kg_en_asa"], x["L5"]["pct"], [c["cc"] for c in x["L5"]["codigos"]],
       x["L5"]["faltan"]) == ("enviado", 800.0, 400.0, 50, ["SUQ1"], ["LCIELO P5 C2"])
      and x["L5"]["codigos"][0] == {"cc": "SUQ1", "descr": "LCIELO P5 C1", "kg": 410.0, "estado": "Open", "fecha": "2026-11-20"},
      x.get("L5"))
check("…sin pedido no hay cruce, y el cargado no aparece",
      x["E5"]["pedido"] == "sin_enviar" and x["E5"]["pct"] is None and x["E5"]["codigos"] == [] and "L6" not in x, x)
a1 = web.get("/armascanner/obras-linea/asa", params={"obra": "PROY-1"}).json()
x1 = {p["plano"]: p for p in a1["planos"]}
check("…cada obra con lo suyo: el plano anterior al cambio, con pedido (y cambios), calza con el código de su obra",
      (a1["asa"], a1["codigos"], x1["ANTES"]["pedido"], x1["ANTES"]["pct"], [c["cc"] for c in x1["ANTES"]["codigos"]])
      == ("A-100", 1, "cambios", 100, ["SUQ9"]), a1)
check("…una obra sin código de aSa: sin códigos",
      web.get("/armascanner/obras-linea/asa", params={"obra": "PROY-X"}).json() == {"asa": "", "al": "", "codigos": 0,
                                                                                  "kg": 0, "planos": []})

print("\nTEST: Mis obras: el kg por piso de una obra (el piso de la etiqueta de cada barra; fundaciones aparte)")
BASE.execute("INSERT INTO proyectos VALUES ('PROY-3', 'EBCO - TORRE SUR', NULL, NULL)")
BASE.commit()
r = terminar(EMI, "LS1", paquete(80), [{"id": "B-1", "kg": 500.0, "piso": "S1", "sector": "LCIELO"},
                                        {"id": "B-2", "kg": 100.0, "piso": "S1", "sector": "VCIELO"}],
             obra="PROY-3", elemento="LCIELO", m2=100.0).json()
check("terminar con el piso y el sector de cada barra: el resumen de la entrega lleva el kg por piso",
      r["resumen"]["por_piso"] == [{"piso": "S1", "sector": "LCIELO", "kg": 500.0},
                                   {"piso": "S1", "sector": "VCIELO", "kg": 100.0}], r)
terminar(EMI, "EL", paquete(81), [{"id": "B-1", "kg": 300.0, "piso": "S1", "sector": "ELEV"},
                                   {"id": "B-2", "kg": 200.0, "piso": "P1", "sector": "ELEV"},
                                   {"id": "B-3", "kg": 50.0, "piso": "P", "sector": "ELEV"}], obra="PROY-3", elemento="ELEV")
terminar(EMI, "FU", paquete(82), [{"id": "B-1", "kg": 400.0, "piso": "S2", "sector": "FUND"}], obra="PROY-3", elemento="FUND")
# un plano terminado antes del 22-nov (sus barras sin piso) con su pedido enviado: el piso, el de sus despieces
terminar(EMI, "LP1", paquete(83), [{"id": "B-1", "kg": 160.0}, {"id": "B-9", "kg": 40.0}], obra="PROY-3",
         elemento="LCIELO", m2=80.0)
con_ficha(EMI, "pedido", obra="PROY-3", plano="LP1")
BASE.execute("INSERT INTO barras VALUES ('PROY-3', 'PC-1', 'LCIELO', 'P1', 'C1', 160, 'csv', 'PROY-3-PC-1-B-1')")
BASE.commit()
o = next(x for x in web.get("/armascanner/obras-linea").json()["obras"] if x["id"] == "PROY-3")
check("por piso: losa (y vigas) + elevación de cada piso, sus m² de losa y kg/m²; el plano sin piso toma el de su "
      "pedido; la barra sin piso, aparte; las fundaciones, en su fila",
      o["por_piso"] == {"pisos": [{"piso": "S1", "kg_losa": 500.0, "kg_viga": 100.0, "kg_elev": 300.0, "kg": 900.0, "m2": 100.0, "kg_m2": 9.0},
                                  {"piso": "P1", "kg_losa": 200.0, "kg_viga": None, "kg_elev": 200.0, "kg": 400.0, "m2": 80.0, "kg_m2": 5.0},
                                  {"piso": "", "kg_losa": None, "kg_viga": None, "kg_elev": 50.0, "kg": 50.0, "m2": None, "kg_m2": None}],
                        "fund": 400.0}, o["por_piso"])
check("…y los KPIs de la obra: kg con todo, fundaciones aparte, kg/m² sólo de los pisos con m² (900 + 400 / 180)",
      (o["kpis"]["kg"], o["kpis"]["kg_fund"], o["kpis"]["m2"], o["kpis"]["kg_m2"]) == (1750.0, 400.0, 180.0, 7.2), o["kpis"])
pl = {x["plano"]: x for x in web.get("/armascanner/planos-linea", params={"obra": "PROY-3"}).json()["planos"]}
check("el plano de fundaciones: todo su kg es de fundación", (pl["FU"]["kpis"]["kg_fund"], pl["FU"]["kpis"]["kg_m2"])
      == (400.0, None), pl["FU"]["kpis"])


def zip_con(archivos):
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as f:
        for nombre, contenido in archivos.items():
            f.writestr(nombre, contenido)
    return z.getvalue()


ORIGINAL = {"paquete.json": "{}", "planos/D1.dwg": b"DWG-calculista"}
cargar(EMI, "D1° piso", zip_con(ORIGINAL), obra="PROY-2")
r = web.get("/armascanner/planos-linea/dwg", params={"obra": "PROY-2", "plano": "D1° piso"})
check("Descargar DWG de un plano cargado: el del calculista, con su nombre",
      r.status_code == 200 and r.content == b"DWG-calculista"
      and r.headers["content-disposition"] == "attachment; filename=\"D1.dwg\"; filename*=UTF-8''D1.dwg",
      (r.status_code, dict(r.headers)))
terminar(EMI, "D1° piso", zip_con(dict(ORIGINAL, **{"trabajo/D1°_IA.dwg": b"DWG-trabajo"})), [], obra="PROY-2")
r = web.get("/armascanner/planos-linea/dwg", params={"obra": "PROY-2", "plano": "D1° piso"})
check("…terminado: la copia de trabajo (con la cubicación), y el nombre con su letra rara",
      r.status_code == 200 and r.content == b"DWG-trabajo"
      and "filename*=UTF-8''D1%C2%B0_IA.dwg" in r.headers["content-disposition"]
      and 'filename="D1__IA.dwg"' in r.headers["content-disposition"] and AUDITORIA[-1][1] == "armascanner_descargar_dwg",
      r.headers.get("content-disposition"))
check("…un paquete sin DWG o un plano que no está: 404",
      web.get("/armascanner/planos-linea/dwg", params={"obra": "PROY-2", "plano": "L5"}).status_code == 404
      and web.get("/armascanner/planos-linea/dwg", params={"obra": "PROY-2", "plano": "NO"}).status_code == 404)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
