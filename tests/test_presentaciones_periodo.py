"""PRESENTACIONES: SÓLO DESDE 2026, Y FILTROS DE AÑO Y MES (16-nov).

La pestaña sumaba los reclamos de años anteriores —los históricos cargados de planilla,
que todavía no están estandarizados— y el usuario los dejó fuera hasta que la BD esté al
día. Además pidió los filtros de año y mes del diseño de los dashboards, que los
contadores y gráficos sigan a los filtros, y que al cubicador no le aparezca la fila de
botones de cubicador (a Emilio le salía la suya y la de Daniel Venegas).

Correr con: python tests/test_presentaciones_periodo.py
"""
import os
import sys
from contextlib import contextmanager

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

import armahub.reclamos as R  # noqa: E402

fallos = 0


def check(nombre, cond, detalle=""):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -- " + str(detalle)[:160]) if not cond else ""))
    if not cond:
        fallos += 1


class Cursor:
    """Anota cada consulta con sus parámetros; responde vacío."""

    def __init__(self, log):
        self.log = log

    def execute(self, sql, params=None):
        self.log.append((sql, list(params or [])))

    def fetchall(self):
        return []

    def fetchone(self):
        return (0, 0)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Conn:
    def __init__(self, log):
        self.log = log

    def cursor(self, **kw):
        return Cursor(self.log)


def correr(fn, user):
    log = []

    @contextmanager
    def falsa():
        yield Conn(log)

    original = R.get_conn
    R.get_conn = falsa
    try:
        fn(user=user)
    finally:
        R.get_conn = original
    return [(sql, p) for sql, p in log if "FROM reclamos r" in sql]


print("TEST: Presentaciones sólo desde 2026, con año y mes")
check("el piso es 2026", R.PRESENTACIONES_DESDE_ANIO == 2026)

USUARIOS = {
    "admin": {"role": "admin", "email": "a@x.cl"},
    "miembro": {"role": "miembro", "email": "m@x.cl"},
    "externo": {"role": "externo", "email": "e@x.cl"},
}
for fn in (R.reclamos_para_presentar, R.presentaciones_stats):
    for rol, u in USUARIOS.items():
        consultas = correr(fn, u)
        check(f"{fn.__name__} · {rol}: consulta los reclamos", bool(consultas))
        for sql, p in consultas:
            check(f"{fn.__name__} · {rol}: filtra por año con el piso",
                  ">= %s" in sql and p and p[0] == 2026, p)
            check(f"{fn.__name__} · {rol}: tantos parámetros como marcadores",
                  sql.count("%s") == len(p), f"{sql.count('%s')} marcadores, {len(p)} parámetros")

sql, _ = correr(R.reclamos_para_presentar, USUARIOS["admin"])[0]
check("la lista trae año, mes y el código visible",
      "AS anio" in sql and "AS mes" in sql and "r.numero_calidad" in sql)

JS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "reclamos", "presentaciones.js"),
          encoding="utf-8").read()
HTML = open(os.path.join(ROOT, "armahub", "templates", "tabs", "reclamos.html"), encoding="utf-8").read()
check("hay chips de año y de mes", 'id="presAnios"' in HTML and 'id="presMeses"' in HTML)
check("los meses se eligen como en los dashboards", "rhMarcar(_presMeses, m, ev)" in JS)
check("la lista, los chips y los gráficos pasan por el período",
      JS.count("_presPasaPeriodo(r") >= 5, JS.count("_presPasaPeriodo(r"))
check("los contadores ya no los trae la consulta que no filtraba",
      "presentaciones-stats" not in JS)
check("la fila de cubicadores es sólo para quien ve a todos",
      "veTodos && keys.length > 1" in JS)
check("cada cubicador tiene su color fijo, no el de su posición",
      "backgroundColor: keys.map(_presColorCub)" in JS)
check("el reclamo se muestra con su código visible (2026-067)",
      "_formatCorrelativoCalidad(r) || r.correlativo" in JS)

print(f"\n{'TODO OK' if not fallos else str(fallos) + ' FALLOS'}")
sys.exit(1 if fallos else 0)
