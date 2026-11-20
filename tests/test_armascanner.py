"""SUBIR PLANO DESDE ARMASCANNER (19-nov): qué combinaciones quedan sin exportar.

Sin base: se prueba la regla pura (armascanner.pendientes_por_combinacion) y que la ruta y la
exportación la usen. Correr con: python tests/test_armascanner.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

from armahub import armascanner as A  # noqa: E402

fallos = 0


def check(nombre, cond, detalle=""):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -- " + str(detalle)[:160]) if not cond else ""))
    if not cond:
        fallos += 1


print("TEST: subir plano desde ArmaScanner")
b = lambda c, r: {"sector": "LCIELO", "piso": "P5", "ciclo": c, "revision": r}  # noqa: E731
check("todo aprobado: nada bloqueado", A.pendientes_por_combinacion([b("C1", "aprobada")] * 3) == {})
p = A.pendientes_por_combinacion([b("C1", "aprobada"), b("C1", "duda"), b("C2", "pendiente"), b("C2", "pendiente")])
check("cuenta por SECTOR|PISO|CICLO", p == {"LCIELO|P5|C1": 1, "LCIELO|P5|C2": 2}, p)
check("las que no subieron cuentan como duda",
      A.pendientes_por_combinacion([dict(b("C3", None), revision="duda")]) == {"LCIELO|P5|C3": 1})
check("la clave va en mayúsculas, como la exportación",
      A.pendientes_por_combinacion([{"sector": "lcielo", "piso": "p5", "ciclo": "c1", "revision": "duda"}])
      == {"LCIELO|P5|C1": 1})

rutas = {r.path for r in A.router.routes}
check("rutas: obras y subir-plano", {"/armascanner/obras", "/armascanner/subir-plano"} <= rutas, rutas)

print("\nTEST: planos en línea (20-nov): tomar, bloqueo y versión")
yo, otro = "eugenio@x.cl", "emilio@x.cl"
fila = lambda v, t=None: {"version": v, "archivo": "k", "tomado_por": t, "tomado_nombre": "Emilio Z",  # noqa: E731
                          "tomado_el": "20-11 10:30", "subido_nombre": "Eugenio Z", "subido_el": "20-11 09:00"}
check("plano que no está en línea: se sube", A.motivo_para_subir(None, yo, 0) == "")
check("libre y con la versión al día: se sube", A.motivo_para_subir(fila(2), yo, 2) == "")
check("tomado por mí: se sube", A.motivo_para_subir(fila(2, yo), yo, 2) == "")
m = A.motivo_para_subir(fila(2, otro), yo, 2)
check("tomado por otro: no se sube encima, y dice quién", "Emilio Z" in m and "20-11 10:30" in m, m)
m = A.motivo_para_subir(fila(3), yo, 2)
check("copia de una versión vieja: no se sube, y dice cuál hay", "v3" in m and "tómalo" in m, m)
check("copia sin versión (nunca tomada) sobre un plano en línea: no se sube", A.motivo_para_subir(fila(1), yo, None) != "")
check("tomado por otro pesa más que la versión", "Lo tiene tomado" in A.motivo_para_subir(fila(3, otro), yo, 1))
k1, k2 = A.clave_paquete("PROY-1", "2024-005-215-2 ARMADURA (5° PISO)", 1), A.clave_paquete("PROY-1", "2024-005-215-2 ARMADURA (5° PISO)", 2)
check("paquete: una carpeta por plano, un archivo por versión",
      k1.rsplit("/", 1)[0] == k2.rsplit("/", 1)[0] and k1.endswith("/v1.zip") and k2.endswith("/v2.zip"), (k1, k2))
check("paquete: la key no lleva el nombre del plano (letras raras)", "°" not in k1 and " " not in k1, k1)
check("paquete: planos distintos, carpetas distintas",
      A.clave_paquete("PROY-1", "215", 1).rsplit("/", 1)[0] != A.clave_paquete("PROY-1", "216", 1).rsplit("/", 1)[0])
check("rutas: planos, tomar y soltar",
      {"/armascanner/planos", "/armascanner/planos/tomar", "/armascanner/planos/soltar"} <= rutas, rutas)
import inspect  # noqa: E402
fuente = inspect.getsource(A.subir_plano)
check("subir: el bloqueo se revisa antes de tocar las barras",
      fuente.index("motivo_para_subir") < fuente.index("import_armadetailer(") if "import_armadetailer(" in fuente else False)
check("Mis obras: todos ven todas las obras (sin filtro por usuario)", "usuario = %s" not in inspect.getsource(A.cargas))
from armahub import export as E  # noqa: E402
check("la exportación consulta las combinaciones bloqueadas", hasattr(E, "combinaciones_bloqueadas"))

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
