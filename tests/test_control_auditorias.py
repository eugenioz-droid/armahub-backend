# -*- coding: utf-8 -*-
"""CONTROL AUDITORÍAS (4-nov): el endpoint de las tres fuentes, ejecutado contra un cursor
falso que cuenta marcadores contra parámetros (el 500 de revisiones del 4-nov fue
exactamente eso), y el cableado del sub-tab en Dashboards de Reclamos.

Correr con: python tests/test_control_auditorias.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/x")
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


from armahub import control_auditorias as CA  # noqa: E402

print("\nEL ENDPOINT CORRE ENTERO CONTRA UN CURSOR FALSO")


class _Cursor:
    consultas = []

    def __init__(self, filas_por_consulta=None):
        self._filas = []
        self.filas_por_consulta = filas_por_consulta or {}

    def execute(self, sql, params=()):
        n_marc = len(re.findall(r"(?<!%)%s", sql))
        assert n_marc == len(params), "marcadores %d vs parámetros %d en: %s" % (n_marc, len(params), sql[:90])
        _Cursor.consultas.append(sql)
        self._filas = []
        for clave, filas in self.filas_por_consulta.items():
            if clave in sql:
                self._filas = filas
        self._filas = list(self._filas)

    def fetchall(self):
        return self._filas

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Conn:
    def __init__(self, cur):
        self.cur = cur

    def cursor(self):
        return self.cur

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _con(filas=None):
    cur = _Cursor(filas)
    CA.get_conn = lambda: _Conn(cur)
    return cur


cur = _con()
r = CA.control_auditorias(desde="", user={"email": "x@y"})
check("el endpoint responde con las tres fuentes y la misma forma en cada una",
      set(r["fuentes"]) == {"barras", "elementos", "auditorias"}
      and all({"semanas", "calor", "cierre", "cierre_total", "columnas", "titulo", "unidad", "columna", "series"}
              <= set(f) for f in r["fuentes"].values()))
check("...y son 12 consultas (4 por fuente), todas con sus marcadores cuadrados", len(_Cursor.consultas) == 12)
check("por defecto arranca el 1 de enero del año en curso", r["desde"].endswith("-01-01"))
check("una fecha mal escrita no tumba el tablero: vuelve al 1 de enero",
      CA.control_auditorias(desde="ayer", user={})["desde"].endswith("-01-01"))
check("las columnas del mapa de calor de barras y de elementos son las reglas, con su nombre corto",
      r["fuentes"]["barras"]["columnas"].get("lado_corto") == "Lado corto"
      and r["fuentes"]["elementos"]["columnas"].get("mismo_pedido") == "Mismo pedido")

print("\nLAS CUENTAS")
cur = _con({"date_trunc('week', s.visto_primero)": [("2026-10-26", 10, 2, 5), ("2026-11-02", 4, 0, 0)],
            "percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (CASE": [("Jvel", 7, 1.5)],
            "s.regla, COUNT(*)": [("Jvel", "lado_corto", 9), ("Nlop", "lado_corto", 1)]})
r = CA.control_auditorias(desde="2026-10-01", user={})
b = r["fuentes"]["barras"]
check("«sin resolver» es lo detectado menos lo que no aplica y lo resuelto",
      b["semanas"][0] == {"semana": "2026-10-26", "detectadas": 10, "no_aplica": 2, "resueltas": 5, "abiertas": 3}
      and b["semanas"][1]["abiertas"] == 4)
check("el cierre trae la mediana en días con un decimal y cuántas cerró",
      b["cierre"] and b["cierre"][0] == {"cub": "Jvel", "n": 7, "mediana": 1.5} or b["cierre_total"]["mediana"] == 1.5)
check("el mapa de calor es una celda por cubicador × regla",
      {"cub": "Jvel", "col": "lado_corto", "n": 9} in b["calor"])
check("la fecha pedida se respeta", r["desde"] == "2026-10-01")

print("\nQUÉ ES RESUELTA EN CADA FUENTE (la misma definición que la hoja)")
check("señal cerrada = no aplica, aSa la confirmó, o se cerró igual bajo firma",
      "s.estado IN ('aceptada', 'corregida')" in CA.SQL_SENAL_CERRADA
      and "s.cierre_confirmado_el IS NOT NULL" in CA.SQL_SENAL_CERRADA)
check("señal resuelta = cerrada y no «no aplica»", "aceptada" not in CA.SQL_SENAL_RESUELTA)
SRC = open(os.path.join(ROOT, "armahub", "control_auditorias.py"), encoding="utf-8").read()
check("en auditorías: detectada = observación u hallazgo, «no aplica» = observación, resuelta = hallazgo corregido o verificado",
      "e.hallazgo IN ('observacion', 'hallazgo')" in SRC
      and "e.hallazgo = 'hallazgo'\n                                     AND e.accion_estado IN ('corregida', 'verificada')" in SRC)
check("la causa del mapa de auditorías vive en la barra (i.causa), como el Pareto de indicadores",
      "COALESCE(NULLIF(TRIM(i.causa), ''), '(sin clasificar)')" in SRC and "i.conforme IS FALSE" in SRC)
check("mediana, no promedio", SRC.count("percentile_cont(0.5)") == 4)

print("\nEL CABLEADO")
MAIN = open(os.path.join(ROOT, "armahub", "main.py"), encoding="utf-8").read()
HTM = open(os.path.join(ROOT, "armahub", "templates", "tabs", "rec_dashboards.html"), encoding="utf-8").read()
JS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "reclamos", "dashboards.js"), encoding="utf-8").read()
check("el router se monta por /api/v1, que es por donde habla el front",
      "from .control_auditorias import router as control_auditorias_router" in MAIN
      and "        control_auditorias_router,\n    ]" in MAIN)
check("lo ven los mismos roles que el resto de Dashboards de Reclamos",
      "user=Depends(require_admin_or_admin_calidad)" in SRC)
check("el sub-tab se llama Control Auditorías y vive en Dashboards de Reclamos, con su panel",
      ">Control Auditorías</button>" in HTM and 'id="dashSubCtrl"' in HTM
      and "control:     { panel: 'dashSubCtrl',   btn: 'dashSubBtnCtrl'" in JS
      and "if (sub === 'control') loadDashControl();" in JS)
check("los tres dibujos: embudo por semana, mapa cubicador × regla, días hasta cerrar",
      'id="caEmbudo"' in HTM and 'id="caCalor"' in HTM and 'id="caCierre"' in HTM
      and "function caEmbudo(f)" in JS and "function caCalor(f)" in JS and "function caCierre(f)" in JS)
check("el mapa de calor lo ven todos los que ven el tablero (sin filtro de rol en el dibujo)",
      "currentRole" not in JS.split("function caCalor(f)")[1].split("function caCierre(f)")[0])
check("sin ranking: la lectura lleva denominador y el embudo no muestra porcentajes sueltos",
      "detectadas · '" in JS and "pct(t.resueltas)" in JS)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
