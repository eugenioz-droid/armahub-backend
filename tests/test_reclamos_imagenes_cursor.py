"""Test de NO-REGRESIÓN — subir imágenes al análisis de un reclamo.

EL BUG (25-sep, reportado por un cubicador): al arrastrar una imagen a "Imágenes de
respuesta" salía «Error al guardar imagen: 'tuple' object has no attribute 'get'».

CAUSA: `_get_table_columns` (reclamos.py) leía cada fila con `row.get("column_name")`,
o sea EXIGÍA un cursor `dict_row`. Pero `get_conn()` no fija row_factory, así que en ese
módulo la mayoría de los cursores devuelven TUPLAS — y `subir_imagen` es uno de ellos.
Un ayudante de ESQUEMA no puede tener como requisito oculto cómo configuró su cursor
quien lo llama: hay 30+ cursores en ese archivo.

POR QUÉ FALLABA SOLO A VECES: `_schema_columns_cache`. Si otra petición ya había cacheado
la tabla (el GET del reclamo la pide con cursor dict_row), la consulta ni se ejecutaba.
Reventaba cuando la subida de imagen era lo PRIMERO que tocaba `reclamo_imagenes` después
de reiniciar el servidor — de ahí que pareciera intermitente.

Se EJECUTA la función real (extraída con ast, sin importar el módulo, que arrastraría
fastapi/psycopg) contra cursores falsos de los DOS tipos.

Correr con: python tests/test_reclamos_imagenes_cursor.py
"""
import ast
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RECLAMOS = os.path.join(ROOT, "armahub", "reclamos.py")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


def _funcion_real(src_path, nombre, entorno):
    """Extrae UNA función por ast y la compila sola, en el entorno dado."""
    with open(src_path, encoding="utf-8") as fh:
        arbol = ast.parse(fh.read())
    for nodo in arbol.body:
        if isinstance(nodo, (ast.FunctionDef, ast.AsyncFunctionDef)) and nodo.name == nombre:
            mod = ast.Module(body=[nodo], type_ignores=[])
            exec(compile(mod, src_path, "exec"), entorno)
            return entorno[nombre]
    raise AssertionError("No se encontró la función %s en %s" % (nombre, src_path))


class CursorTuplas:
    """Como el de subir_imagen: get_conn() sin row_factory → filas = tuplas."""

    def __init__(self, columnas):
        self._columnas = columnas
        self.consultas = 0

    def execute(self, sql, params=None):
        self.consultas += 1

    def fetchall(self):
        return [(c,) for c in self._columnas]


class CursorDicts:
    """Como el del GET del reclamo: conn.cursor(row_factory=dict_row)."""

    def __init__(self, columnas):
        self._columnas = columnas
        self.consultas = 0

    def execute(self, sql, params=None):
        self.consultas += 1

    def fetchall(self):
        return [{"column_name": c} for c in self._columnas]


COLS = ["id", "reclamo_id", "filename", "content_type", "storage_key",
        "descripcion", "subido_por", "fecha", "tipo"]

print("TEST: _get_table_columns no depende del row_factory del llamador")

# Entorno con la caché VACÍA en cada caso: es lo que hace que el bug sea intermitente,
# así que cada escenario parte como un servidor recién reiniciado.
entorno = {"_schema_columns_cache": {}}
get_cols = _funcion_real(RECLAMOS, "_get_table_columns", entorno)

# 1) EL CASO DEL BUG: cursor de TUPLAS, caché fría.
entorno["_schema_columns_cache"].clear()
cur_t = CursorTuplas(COLS)
try:
    cols_t = get_cols(cur_t, "reclamo_imagenes")
    ok_t, err_t = True, ""
except Exception as exc:                                  # noqa: BLE001
    cols_t, ok_t, err_t = set(), False, "%s: %s" % (type(exc).__name__, exc)
check("con cursor de TUPLAS y cache fria NO revienta" + (" -> " + err_t if err_t else ""), ok_t)
check("y devuelve las columnas reales de reclamo_imagenes", cols_t == set(COLS))
check("incluye 'fecha' (la columna que subir_imagen necesita elegir)", "fecha" in cols_t)

# 2) El camino que YA funcionaba: cursor dict_row. No se puede romper al arreglar el otro.
entorno["_schema_columns_cache"].clear()
cur_d = CursorDicts(COLS)
cols_d = get_cols(cur_d, "reclamo_imagenes")
check("con cursor dict_row sigue funcionando igual", cols_d == set(COLS))
check("los dos tipos de cursor dan EXACTAMENTE lo mismo", cols_t == cols_d)

# 3) La caché sigue viva (es lo que hacía intermitente el bug: no se toca su comportamiento).
antes = cur_d.consultas
get_cols(cur_d, "reclamo_imagenes")
check("la segunda llamada sale de la cache, sin volver a consultar", cur_d.consultas == antes)

# 4) Fila vacía / columna nula no ensucia el conjunto.
entorno["_schema_columns_cache"].clear()
check("filas vacias o nulas se descartan",
      get_cols(CursorTuplas(["a", None, "b"]), "otra_tabla") == {"a", "b"})

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
