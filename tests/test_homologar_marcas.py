"""Test de la HOMOLOGACIÓN DE MARCAS (25-sep).

QUÉ PROBLEMA CUBRE. El CSV de ArmaDetailer traía la tipología en MAYÚSCULAS (F'S, F'I,
FI, FS, CBSN, CBIN, RP) y el catálogo la escribe como se usa en obra (F's, F'i, Fi, Fs,
CBSn, CBIn, Rp). Convivían dos escrituras del MISMO código en `barras` — 2.990 filas, todas
de losa, fundación y viga — y cualquier filtro que compare texto exacto las trataba como
tipologías distintas (por eso no salían en su subtab del editor de despieces).

EL RIESGO QUE VIGILA ESTE TEST no es el UPDATE en sí, que ya se ensayó contra la base con
rollback. Es que la regla se BIFURQUE: vive en dos sitios que tienen que decir lo mismo —
la migración 110 (limpia el histórico una vez) y `catalogo.homologar_marcas` (la aplica en
cada importación, que es lo que impide que se vuelva a ensuciar). Si alguien afina una y no
la otra, el histórico y las cargas nuevas quedan con criterios distintos y nadie se entera.

Correr con: python tests/test_homologar_marcas.py
"""
import ast
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOGO = os.path.join(ROOT, "armahub", "catalogo.py")
IMPORTER = os.path.join(ROOT, "armahub", "importer.py")
MIGRACION = os.path.join(ROOT, "armahub", "migrations", "110_homologar_marcas.sql")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


def _normalizar(sql):
    """Compara SQL por su CONTENIDO, no por su formato: fuera comentarios, espacios
    repetidos y mayúsculas del propio SQL (los identificadores del esquema son minúsculas)."""
    sql = re.sub(r"(?m)^\s*--.*$", " ", sql)
    return re.sub(r"\s+", " ", sql).strip().rstrip(";").lower()


def _del_modulo(path, nombre):
    """Lee una asignación o función del módulo por ast, sin importarlo (arrastra fastapi)."""
    with open(path, encoding="utf-8") as fh:
        arbol = ast.parse(fh.read())
    for nodo in arbol.body:
        if isinstance(nodo, ast.Assign):
            for t in nodo.targets:
                if isinstance(t, ast.Name) and t.id == nombre:
                    return ast.literal_eval(nodo.value)
        if isinstance(nodo, ast.FunctionDef) and nodo.name == nombre:
            return nodo
    raise AssertionError("No se encontró %s en %s" % (nombre, path))


print("TEST: la homologación de marcas dice lo mismo en los dos sitios donde vive")

sql_py = _del_modulo(CATALOGO, "SQL_HOMOLOGAR_MARCAS")
with open(MIGRACION, encoding="utf-8") as fh:
    sql_mig = fh.read()

# 1) La migración aplica la regla a las dos tablas que guardan marcas.
sentencias = [s.strip() for s in _normalizar(sql_mig).split(";") if s.strip()]
check("la migración 110 trae 2 sentencias (barras y barras_eliminadas)", len(sentencias) == 2)
check("...una para barras", any(s.startswith("update barras b") for s in sentencias))
check("...y otra para las lápidas de despieces eliminados",
      any(s.startswith("update barras_eliminadas b") for s in sentencias))

# 2) EL PUNTO DEL TEST: es literalmente la misma regla que usa la importación.
esperado_barras = _normalizar(sql_py.replace("{tabla}", "barras"))
esperado_lapidas = _normalizar(sql_py.replace("{tabla}", "barras_eliminadas"))
check("la sentencia de barras es IDÉNTICA a la que aplica cada importación",
      esperado_barras in sentencias)
check("y la de las lápidas también", esperado_lapidas in sentencias)

# 3) Invariantes de la regla, para que no se relaje sin darse cuenta.
check("sólo corrige códigos que YA existen en el catálogo (no inventa marcas)",
      "from tipologias_catalogo" in esperado_barras)
check("empareja ignorando mayúsculas y espacios sobrantes",
      "upper(trim(b.marca))" in esperado_barras)
check("no escribe si ya está bien (idempotente)",
      "is distinct from m.codigo" in esperado_barras)
check("EL CANDADO: una clave ambigua (dos códigos que sólo difieren en mayúsculas) "
      "se queda fuera en vez de elegir al azar",
      "having count(distinct codigo) = 1" in esperado_barras)
check("no toca ninguna columna que no sea la marca",
      esperado_barras.count("set ") == 1 and "set marca = m.codigo" in esperado_barras)

# 4) La función acota bien cuando la importación le pasa su propio ámbito.
entorno = {"SQL_HOMOLOGAR_MARCAS": sql_py}
nodo = _del_modulo(CATALOGO, "homologar_marcas")
exec(compile(ast.Module(body=[nodo], type_ignores=[]), CATALOGO, "exec"), entorno)
homologar = entorno["homologar_marcas"]


class CursorFalso:
    def __init__(self):
        self.sql = None
        self.params = None
        self.rowcount = 7

    def execute(self, sql, params=()):
        self.sql, self.params = sql, params


cur = CursorFalso()
n = homologar(cur, "barras", "b.import_id = %s", (42,))
check("la importación acota la corrección a lo que acaba de cargar",
      "b.import_id = %s" in cur.sql and cur.params == (42,))
check("...y ese filtro va sumado con AND, sin pisar el emparejamiento del código",
      _normalizar(cur.sql).startswith(esperado_barras))
check("devuelve cuántas corrigió", n == 7)

cur2 = CursorFalso()
homologar(cur2)
check("sin ámbito, por defecto trabaja sobre `barras` y sin filtros extra",
      _normalizar(cur2.sql) == esperado_barras)

# 5) La importación de verdad la llama (si no, el origen sigue ensuciando).
with open(IMPORTER, encoding="utf-8") as fh:
    src_imp = fh.read()
check("importer.py llama a homologar_marcas tras cargar el CSV",
      "homologar_marcas(cur" in src_imp)
check("...acotada por import_id (no reescribe barras de otras cargas)",
      re.search(r"homologar_marcas\(cur,\s*\"barras\",\s*\"b\.import_id = %s\"", src_imp) is not None)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
