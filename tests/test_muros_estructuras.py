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
  4. …y los MISMOS KPIs que el repositorio de despieces (items, barras físicas,
     Ø ponderado por peso), en UNA sola consulta.
  5. FIN DE LAS ESTRUCTURAS HUÉRFANAS: la estructura y sus barras se escriben en la
     MISMA transacción (POST /lotes/{id}/barras con `instancia`). Antes eran dos
     llamadas y una carga que fallaba dejaba la estructura vacía en el despiece.
  6. Las huérfanas que ya existen las borra el USUARIO desde el listado
     (DELETE /elementos/instancia/{id}, sólo con cero barras). Sin migración que
     borre filas a su espalda.

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

    # --- 4. LOS MISMOS KPIs QUE EL REPOSITORIO DE DESPIECES, EN UNA SOLA CONSULTA ---
    # El bloque "Estructuras de este despiece" muestra Items · Barras · Kg · Ø prom ·
    # PPB · PPI, igual que la tabla de despieces. PPB/PPI los deriva el front (kg/barras
    # y kg/items, una sola función para las dos tablas); los cuatro números de base
    # salen de AQUÍ y de una sola pasada: pedirlos por estructura serían N consultas.
    check("n_barras = BARRAS FISICAS (suma de cant_total), como en listar_lotes",
          "SUM(b.cant_total), 0) AS n_barras" in bloque2)
    check("n_items = ENTRADAS (COUNT), como en listar_lotes",
          "COUNT(b.id) AS n_items" in bloque2)
    check("diam_prom ponderado POR PESO, misma formula que el KPI del despiece",
          "AS diam_prom" in bloque2 and "SUM(b.diam * b.peso_total)" in bloque2
          and "NULLIF(SUM(b.peso_total), 0)" in bloque2)
    check("los cuatro en UNA pasada (LEFT JOIN + GROUP BY), no N subconsultas",
          "LEFT JOIN barras b ON b.template_instancia_id = e.id" in bloque2
          and "GROUP BY" in bloque2
          and "(SELECT COUNT(*) FROM barras" not in bloque2)
    check("ciclo/eje caen al dato del LOTE cuando la instancia no los trae",
          "COALESCE(e.ciclo, l.ciclo)" in bloque2 and "COALESCE(e.eje,   l.eje)" in bloque2)

    # --- 5. ESTRUCTURA Y BARRAS EN LA MISMA TRANSACCIÓN (fin de las huérfanas) ---
    # El bug: el editor creaba la estructura por POST /elementos/instancia y DESPUÉS
    # mandaba las barras. Dos transacciones ⇒ cuando las barras fallaban (400 por
    # ubicación faltante, figura inválida, red) la estructura ya estaba escrita y
    # quedaba en el despiece con 0 barras y 0 kg. Ahora viaja DENTRO del POST de barras
    # y se escribe con el mismo cursor: o entran las dos cosas o no entra ninguna.
    with open(LOTES, "r", encoding="utf-8") as f:
        lot = f.read()
    check("BarrasBatch acepta la estructura (`instancia`) además de las barras",
          "class InstanciaConBarras" in lot and "instancia: Optional[InstanciaConBarras]" in lot)
    alta = lot.split('@router.post("/lotes/{lote_id}/barras")')[-1].split("@router.")[0]
    check("el alta la escribe con el MISMO cursor de las barras",
          "insertar_instancia(" in alta and "cur, email, lote_id" in alta)
    check("y las barras salen estampadas con esa instancia, no con lo que traiga el front",
          "inst_barra = instancia_id if instancia_id is not None" in alta
          and "origen_barra, inst_barra," in alta)
    check("el POST devuelve el id de la estructura creada (el front lo necesita para reabrirla)",
          '"instancia_id": instancia_id' in alta)
    # El alta NO escribe su propio INSERT: llama a la función de modelador.py, que es
    # el dueño de la tabla. (duplicar_lote tiene un INSERT propio desde antes: copia
    # filas que YA existen, no crea una desde un request — otra cosa y otro sitio.)
    check("el alta no escribe SQL de elementos_template por su cuenta",
          "INSERT INTO elementos_template" not in alta
          and "def insertar_instancia(" in mod)
    check("y el endpoint suelto reusa esa misma función (un solo INSERT en modelador.py)",
          mod.count("INSERT INTO elementos_template") == 1)

    # --- 6. LIMPIEZA DE LAS HUÉRFANAS QUE YA EXISTEN: la borra el usuario ---
    # No hay migración que borre filas a espaldas del usuario: el listado las muestra
    # como lo que son y ofrece el botón. La guarda del backend es el CERO de barras.
    check("existe DELETE /elementos/instancia/{id}",
          '@router.delete("/elementos/instancia/{instancia_id}")' in mod)
    borra = mod.split('@router.delete("/elementos/instancia/{instancia_id}")')[-1].split("@router.")[0]
    check("sólo borra si tiene CERO barras (409 si tiene)",
          "if n_barras:" in borra and "status_code=409" in borra
          and "DELETE FROM elementos_template" in borra)
    check("no toca el contenido de un despiece eliminado (lápida)",
          'estado_lote == "eliminado"' in borra)
    check("permiso: el mismo de cargar barras al lote",
          "_check_permiso_instancia(cur, user)" in borra)
    check("y queda auditado (quién borró qué)", 'audit(email, "eliminar_instancia_vacia"' in borra)

    print()
    if fallos:
        print(f"FALLARON {fallos} chequeos")
        sys.exit(1)
    print("TODO OK")


if __name__ == "__main__":
    main()
