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


def _nodos_reales(src_path, nombres):
    """Como _funcion_real pero para VARIOS nodos de nivel superior (clases, funciones y
    constantes) que dependen entre sí: se compilan JUNTOS, en el orden del archivo, y se
    devuelve el namespace. Así se ejercita el código REAL de catalogo.py sin importar el
    módulo (que arrastraría fastapi/psycopg)."""
    with open(src_path, "r", encoding="utf-8") as f:
        arbol = ast.parse(f.read())
    quiero, cuerpo = set(nombres), []
    for nodo in arbol.body:
        if isinstance(nodo, (ast.FunctionDef, ast.ClassDef)) and nodo.name in quiero:
            cuerpo.append(nodo)
        elif isinstance(nodo, ast.Assign):
            if any(isinstance(t, ast.Name) and t.id in quiero for t in nodo.targets):
                cuerpo.append(nodo)
    ns = {}
    exec(compile(ast.Module(body=cuerpo, type_ignores=[]), src_path, "exec"), ns)
    return ns


class CursorQueCuenta(object):
    """Cursor de mentira que CUENTA sus consultas. Sin base de datos, contar es la
    única forma de medir un N+1: si el catálogo se lee por barra, el contador sube
    con las barras; si se lee una vez, se queda en 1."""

    def __init__(self, figuras):
        self.figuras = figuras     # codigo -> (parciales, angulos, radio)
        self.n = 0
        self._filas = []

    def execute(self, sql, params=()):
        self.n += 1
        s = " ".join(str(sql).split())
        p = list(params or ())
        if "= ANY(" in s:          # cargar_figuras: el catálogo de una
            self._filas = [(c,) + tuple(self.figuras[c]) for c in (p[0] or [])
                           if c in self.figuras]
        else:                      # get_figura: una figura suelta
            f = self.figuras.get(p[0])
            self._filas = [tuple(f)] if f else []

    def fetchone(self):
        return self._filas[0] if self._filas else None

    def fetchall(self):
        return list(self._filas)


def _usos_del_cursor(nodo):
    """Nombres de las llamadas que, DENTRO de `nodo`, usan el cursor: o son métodos de
    `cur` (cur.execute/…) o le pasan `cur` como argumento. Es lo que no puede aparecer
    dentro de un bucle por barra."""
    usos = []
    for n in ast.walk(nodo):
        if not isinstance(n, ast.Call):
            continue
        f = n.func
        if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and f.value.id == "cur":
            usos.append("cur." + f.attr)
        elif any(isinstance(a, ast.Name) and a.id == "cur" for a in n.args):
            usos.append(getattr(f, "id", getattr(f, "attr", "?")) + "(cur, …)")
    return usos


def _funcion_ast(src_path, nombre):
    with open(src_path, "r", encoding="utf-8") as f:
        arbol = ast.parse(f.read())
    for nodo in ast.walk(arbol):
        if isinstance(nodo, ast.FunctionDef) and nodo.name == nombre:
            return nodo
    return None


def _bucle_sobre(fn, texto_iter):
    """El `for` de `fn` que recorre `texto_iter` (p.ej. 'body.barras')."""
    for nodo in ast.walk(fn):
        if isinstance(nodo, ast.For) and texto_iter in ast.unparse(nodo.iter):
            return nodo
    return None


def _seccion_catalogo_una_vez():
    catalogo = os.path.join(ROOT, "armahub", "catalogo.py")

    # 7.1 — El catálogo entero en UNA consulta, y consultarlo después no vuelve a la BD.
    ns = _nodos_reales(catalogo, [
        "_SLOT_A_DIM", "_ANG_COLS", "_tiene_valor_real", "CatalogoFiguras",
        "cargar_figuras", "get_figura", "largo_desde_lados", "validar_geometria"])
    figs = {
        "101A": (["A"], [], False),
        "102B": (["A", "B"], [135], False),
        "201A": (["B", "G", "H"], [], True),
    }
    cur = CursorQueCuenta(figs)
    cat = ns["cargar_figuras"](cur, {"101A", "102B", "201A"})
    check("cargar_figuras lee las 3 figuras en UNA sola consulta", cur.n == 1)
    check("…y las trae todas", len(cat) == 3)
    n_tras_cargar = cur.n
    for _ in range(50):
        ns["get_figura"](cat, "102B")
    check("consultar el catálogo ya leído NO vuelve a la BD (50 lecturas, 0 consultas)",
          cur.n == n_tras_cargar)
    check("una figura que no está sigue devolviendo None",
          ns["get_figura"](cat, "999Z") is None)

    # 7.2 — MISMO RESULTADO por cursor que por catálogo leído. Esto es lo que hace
    # legítimo el atajo: la validación no se relajó, sólo cambió de dónde sale la figura.
    casos = [
        ("101A", {"dim_a": 100}),                                          # correcta
        ("101A", {"dim_a": 100, "dim_b": 50}),                             # sobra un lado
        ("102B", {"dim_a": 100, "dim_b": 50}),                             # falta el ángulo
        ("102B", {"dim_a": 100, "dim_b": 50, "ang1": 135}),                # correcta
        ("102B", {"dim_a": -1, "dim_b": 50, "ang1": 135}),                 # lado negativo
        ("102B", {"dim_a": 0, "dim_b": 50, "ang1": 135}),                  # 0 = lado faltante
        ("201A", {"dim_b": 10, "dim_g": 5, "dim_h": 5}),                   # falta el radio
        ("201A", {"dim_b": 10, "dim_g": 5, "dim_h": 5, "radio": 2}),       # correcta
        ("999Z", {"dim_a": 1}),                                            # figura inexistente
    ]
    iguales_val = iguales_largo = True
    for cod, vals in casos:
        if ns["validar_geometria"](cur, cod, vals) != ns["validar_geometria"](cat, cod, vals):
            iguales_val = False
        if ns["largo_desde_lados"](cur, cod, vals) != ns["largo_desde_lados"](cat, cod, vals):
            iguales_largo = False
    check("validar_geometria da lo MISMO con cursor que con catálogo leído (9 casos)",
          iguales_val)
    check("largo_desde_lados da lo MISMO con cursor que con catálogo leído (9 casos)",
          iguales_largo)

    # 7.3 — Los bucles por barra NO pueden tocar la base. Es el candado del N+1: si
    # alguien vuelve a meter un validar_geometria(cur, …) o un cur.execute() dentro del
    # recorrido de barras, esto falla.
    for fn_nombre, iter_txt in (("agregar_barras", "body.barras"),
                                ("sincronizar_barras_estructura", "body.barras"),
                                ("duplicar_lote", "origen")):
        fn = _funcion_ast(LOTES, fn_nombre)
        bucle = _bucle_sobre(fn, iter_txt) if fn else None
        check(f"{fn_nombre}: se encuentra el bucle por barra", bucle is not None)
        if bucle is not None:
            usos = _usos_del_cursor(bucle)
            check(f"{fn_nombre}: el bucle por barra NO consulta la BD ({', '.join(sorted(set(usos))) or 'ninguna'})",
                  not usos)
    val = _funcion_ast(MODELADOR, "_validar_receta")
    bucle_comp = _bucle_sobre(val, "comps") if val else None
    check("_validar_receta: se encuentra el bucle por componente", bucle_comp is not None)
    if bucle_comp is not None:
        check("_validar_receta: el bucle por componente NO consulta la BD",
              not _usos_del_cursor(bucle_comp))

    # 7.4 — La escritura de barras es UNA ida a la BD por tanda (executemany), y la
    # idempotencia que impide duplicar barras al reintentar sigue siendo la MISMA:
    # el índice único (id_unico, id_proyecto), acotado al mismo lote.
    with open(LOTES, "r", encoding="utf-8") as f:
        src = f.read()
    alta = src.split('@router.post("/lotes/{lote_id}/barras")')[1].split("@router.")[0]
    check("el alta escribe las barras en bloque (executemany), no una por una",
          "cur.executemany(sql_ins" in alta and "cur.execute(\n                        sql_ins" not in alta)
    check("…conservando el UPSERT por (id_unico, id_proyecto)",
          "ON CONFLICT (id_unico, id_proyecto) DO UPDATE" in alta)
    check("…acotado al MISMO lote (un choque con otro lote no se pisa)",
          "WHERE barras.lote_id = EXCLUDED.lote_id" in alta)
    check("…y devolviendo id + id_unico (el front asocia por posición)",
          "RETURNING id, id_unico" in alta)
    check("el reintento por colisión sigue siendo como mucho 2, con id nuevo del servidor",
          "for _rein in range(2):" in alta and "_id_unico_manual()" in alta
          and "status_code=409" in alta)
    sync = src.split('@router.post("/lotes/{lote_id}/barras/sync")')[1].split("@router.")[0]
    check("la regeneración también escribe en bloque (UPDATE e INSERT por executemany)",
          sync.count("cur.executemany(") == 2)
    check("y el rechazo por barra conserva su forma ({msg, barra_idx, …}) para el front",
          '"barra_idx": i' in src)

    # 7.5 — El INSERT de barras cuadra: columnas == placeholders == valores. (El
    # chequeo equivalente de test_modelador_backend.py quedó obsoleto con su propio
    # regex; éste lee la sentencia por ast, así que no depende de dónde caiga el
    # RETURNING.)
    fn = _funcion_ast(LOTES, "agregar_barras")
    sql = None
    for nodo in ast.walk(fn):
        if (isinstance(nodo, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "sql_ins" for t in nodo.targets)
                and isinstance(nodo.value, ast.Constant)):
            sql = nodo.value.value
    check("se encuentra el INSERT INTO barras del alta", bool(sql))
    if sql:
        cols_txt = sql[sql.index("(") + 1:sql.index(")")]
        n_cols = len([c for c in cols_txt.split(",") if c.strip()])
        vals_txt = sql[sql.index("VALUES"):sql.index("ON CONFLICT")]
        n_ph = vals_txt.count("%s")
        n_null = vals_txt.count("NULL")
        n_lit = vals_txt.count("'borrador'")
        valores = None
        for nodo in ast.walk(fn):
            if (isinstance(nodo, ast.Call) and isinstance(nodo.func, ast.Attribute)
                    and nodo.func.attr == "append"
                    and isinstance(nodo.func.value, ast.Name) and nodo.func.value.id == "filas"):
                valores = nodo.args[0].elts[1].elts
        check(f"columnas ({n_cols}) == placeholders+literales ({n_ph + n_null + n_lit})",
              n_cols == n_ph + n_null + n_lit)
        check(f"placeholders ({n_ph}) == valores que se le pasan ({len(valores or [])})",
              valores is not None and n_ph == len(valores))


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

    # --- 7. EL CATÁLOGO SE LEE UNA VEZ POR CARGA, Y EL BUCLE DE BARRAS NO TOCA LA BD ---
    # Medido el 25-ago con un doble de cursor que cuenta consultas: cargar el muro de
    # 825 barras del usuario hacía 2.483 consultas, de las cuales 1.650 (66%) eran
    # SELECT a figuras_catalogo — 2 por barra, una desde validar_geometria y otra desde
    # largo_desde_lados, sobre un catálogo de 63 figuras que no cambia durante la carga.
    # Cada una es una ida y vuelta Render→Supabase por la red. Después del arreglo: 10
    # idas a la BD para las mismas 825 barras. Esta sección congela las dos mitades:
    # que el catálogo se lea de una, y que el bucle no pueda volver a consultar por barra.
    _seccion_catalogo_una_vez()

    print()
    if fallos:
        print(f"FALLARON {fallos} chequeos")
        sys.exit(1)
    print("TODO OK")


if __name__ == "__main__":
    main()
