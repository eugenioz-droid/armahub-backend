"""Test de NO-REGRESIÓN — Trazabilidad de Muros (backend).

Como fastapi/psycopg NO están instalados localmente (mismo criterio que
test_modelador_backend.py), se valida sin levantar la app:
  1. _origen_valido (lotes.py) acepta 'enfierrador' y mantiene el fallback a
     'manual' (invariante de canales). Se EJECUTA la función real (extraída por
     ast), no un grep: si alguien cambia la lógica, esto falla.
  2. GET /elementos/estructuras existe y su SQL exige la bandera del ciclo de
     vida (lotes.estado='terminada'), instancias vivas con COALESCE (filas
     pre-107 con estado NULL) y resuelve la obra por el LOTE.
  3. GET /lotes/{id}/elementos ahora devuelve kg (aditivo: n_barras sigue).

Correr con: python tests/test_muros_estructuras.py
"""
import ast
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOTES = os.path.join(ROOT, "armahub", "lotes.py")
MODELADOR = os.path.join(ROOT, "armahub", "modelador.py")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


def _funcion_real(src_path, nombre):
    """Extrae UNA función del módulo por ast y la compila sola: así se prueba el
    comportamiento real sin importar el módulo (que arrastraría fastapi/psycopg)."""
    with open(src_path, "r", encoding="utf-8") as f:
        arbol = ast.parse(f.read())
    for nodo in arbol.body:
        if isinstance(nodo, ast.FunctionDef) and nodo.name == nombre:
            mod = ast.Module(body=[nodo], type_ignores=[])
            ns = {}
            exec(compile(mod, src_path, "exec"), ns)
            return ns[nombre]
    return None


def main():
    # --- 1. _origen_valido: comportamiento real ---
    ov = _funcion_real(LOTES, "_origen_valido")
    check("lotes.py define _origen_valido", ov is not None)
    if ov:
        check("acepta 'enfierrador'", ov("enfierrador") == "enfierrador")
        check("acepta 'ENFIERRADOR ' (normaliza)", ov(" ENFIERRADOR ") == "enfierrador")
        check("sigue aceptando 'template' (histórico, no se migra)", ov("template") == "template")
        check("sigue aceptando 'manual'", ov("manual") == "manual")
        # El invariante de canales: nada ajeno entra por aquí.
        check("'csv' cae a 'manual'", ov("csv") == "manual")
        check("'pedido' cae a 'manual'", ov("pedido") == "manual")
        check("None cae a 'manual'", ov(None) == "manual")

    with open(MODELADOR, "r", encoding="utf-8") as f:
        mod = f.read()

    # --- 2. GET /elementos/estructuras (solo banderadas) ---
    check("router define GET /elementos/estructuras",
          '@router.get("/elementos/estructuras")' in mod)
    bloque = mod.split('@router.get("/elementos/estructuras")')[-1]
    bloque = bloque.split("@router.")[0]  # solo el cuerpo de ESTE endpoint
    check("exige la bandera: l.estado = 'terminada'",
          "l.estado = 'terminada'" in bloque)
    check("solo vivas, con COALESCE por las filas pre-107 (estado NULL)",
          "COALESCE(e.estado" in bloque)
    check("la obra se resuelve por el LOTE (l.id_proyecto), no por e.id_proyecto",
          "l.id_proyecto = %s" in bloque and "e.id_proyecto = %s" not in bloque)
    check("kg = suma de peso_total por instancia",
          "SUM(b.peso_total)" in bloque and "template_instancia_id = e.id" in bloque)
    check("filtro por elemento es case-insensitive y OPCIONAL (solo de listado)",
          "LOWER(e.elemento) = LOWER(%s)" in bloque and "if elemento:" in bloque)
    check("permiso: mismo criterio de lectura que los otros GET de instancias",
          "_check_permiso_lectura(user)" in bloque)

    # --- 3. GET /lotes/{id}/elementos gana kg (aditivo) ---
    bloque2 = mod.split('@router.get("/lotes/{lote_id}/elementos")')[-1]
    bloque2 = bloque2.split("@router.")[0]
    check("listado por lote conserva n_barras", "AS n_barras" in bloque2)
    check("listado por lote suma kg", "AS kg" in bloque2 and "SUM(b.peso_total)" in bloque2)
    check("kg sale como float redondeado (NUMERIC no viaja al JSON)",
          'round(float(d["kg"] or 0), 1)' in bloque2)

    print()
    if fallos:
        print(f"FALLARON {fallos} chequeos")
        sys.exit(1)
    print("TODO OK")


if __name__ == "__main__":
    main()
