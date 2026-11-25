# -*- coding: utf-8 -*-
"""
MATERIAL DISPONIBLE › LA BÚSQUEDA (25-nov, SPECS §15.3) — fase 2.

Para cada barra disponible busca en aSa los ítems por fabricar (códigos Open y Processed de
obras con movimiento) que se pueden hacer con ella, para que producción no los vuelva a
procesar.

CUÁNDO CALZA (decisión del usuario, 24-nov: «por defecto busca siempre barras iguales o con
corte de extremos»):
  · mismo φ y mismo grado;
  · la MISMA FIGURA POR SUS LADOS, no por su código: misma cantidad de lados, mismo tipo de
    lado (recto, gancho, curvo) y mismos giros, leída desde cualquiera de sus dos puntas y
    también dada vuelta (una barra plana se puede voltear);
  · IGUAL: todos los lados iguales (± TOLERANCIA_MM);
  · CON CORTE: los lados del medio iguales y los extremos iguales o más largos, y sólo se
    corta un extremo RECTO: el que termina en gancho o en curva tiene que ser igual (por eso
    un estribo, que cierra con ganchos, sólo calza igual);
  · RECTAS: de una barra larga salen varias cortas (de 12 m, dos de 5,8 m).
Los dobleces (fase 4) quedan para el botón «Buscar con doblez».

POR QUÉ AGUANTA EL CRECIMIENTO (medido 25-nov). aSa entrega sumados, en una consulta, los
ítems de un φ y unas figuras con su definición de lados: 51 soportes 26 de φ16 en 14 s, 4.902
rectas φ16 de hasta 6 m en 11 s. Se hace una consulta por cada grupo (φ, grado, forma) que hay
en stock, no una por código.

SE BUSCA POR BARRA Y EN EL MOMENTO (usuario, 25-nov): quien abre la ventana de una barra
aprieta «Buscar coincidencias» y ve lo que hay hoy en aSa; ahí mismo asigna
(material_asignar.py). Ya no hay pasada de las 06:00 ni lista guardada: una lista vieja
mostraba ítems que ya se habían borrado de su CC.

Sin rutas ni fastapi: las rutas están en material_api.py.
"""
from typing import Optional

from .figura_asa import _legs

ESTADOS = ("Open", "Processed")
TOLERANCIA_MM = 5.0
TOLERANCIA_GIRO = 2.0
# OBRA ACTIVA = CON MOVIMIENTO EN LOS ÚLTIMOS N MESES: el mismo criterio de la revisión de
# barras (chequeos_api.MESES_MOVIMIENTO). Sin él aparecen códigos de 2021 que nadie cerró en
# aSa (medido: un soporte 26 «Open» de un CC de 2021).
MESES_ACTIVA = 3
# Cuántas coincidencias se muestran por barra: las que más kilos ahorran.
TOPE_POR_BARRA = 40
DIMS = ["OrderItemKey", "CtrlCode", "BarMark", "BarSizeDescr", "GradeID", "ShpNameID", "LegAngle",
        "LengthTheor", "OrderStatusDescr", "JobName", "CustomerName", "OrderDescr", "ElementDesc", "ElementID"]

# Lo que se lleva del ítem a la pantalla y a la asignación.
CAMPOS_ITEM = ("item_key", "cc", "marca", "obra", "cliente", "descr_cc", "elemento", "ubicacion", "estado_asa",
               "figura", "lados")


# ---------------------------------------------------------------------------
# La forma de una barra (puro)
# ---------------------------------------------------------------------------
def _clase(l: dict) -> str:
    """GANCHO ES EL QUE aSa DECLARA (H3, H9…), no una pata corta. La revisión de barras llama
    gancho también a un extremo corto que dobla 90°, para su regla del lado corto; para
    reciclar eso no sirve: la pata de 16 cm de un soporte 26 se corta igual que cualquier
    lado recto (medido 25-nov: con esa regla, un 26 con una pata 5 cm más larga no calzaba)."""
    if str(l.get("tipo") or "").upper().startswith("H"):
        return "gancho"
    return "curvo" if l.get("arco") else "recto"


def _giros(lados: list) -> list:
    return [float(l.get("angulo") or 0) for l in lados[1:]]


def orientaciones(lados: list) -> list:
    """La barra leída desde una punta y desde la otra. Al dar vuelta el recorrido, cada giro
    cambia de signo; el volteo (espejo) se compara aparte, con todos los giros al revés."""
    atras = [dict(l) for l in reversed(lados)]
    giros = [-g for g in reversed(_giros(lados))]
    for k, l in enumerate(atras):
        l["angulo"] = giros[k - 1] if k > 0 else None
    return [lados, atras]


def _mismos_giros(a: list, b: list) -> bool:
    if len(a) != len(b):
        return False
    directo = all(abs(x - y) <= TOLERANCIA_GIRO for x, y in zip(a, b))
    espejo = all(abs(x + y) <= TOLERANCIA_GIRO for x, y in zip(a, b))
    return directo or espejo


def firma(lados: list) -> tuple:
    """La forma sin las medidas, igual de cualquier lado que se la lea: sirve para saber qué
    códigos de figura de aSa tienen la misma forma (y pedírselos a aSa juntos)."""
    formas = []
    for o in orientaciones(lados):
        for signo in (1, -1):
            formas.append(tuple((bool(l.get("arco")), round(signo * float(l.get("angulo") or 0)))
                                for l in o))
    return min(formas)


def _medio_igual(s: list, i: list) -> bool:
    """Los lados del medio iguales, y en los curvos también el radio."""
    for a, b in zip(s[1:-1], i[1:-1]):
        if abs(a["largo"] - b["largo"]) > TOLERANCIA_MM:
            return False
    for a, b in zip(s, i):
        if a.get("arco") and abs(float(a.get("radio") or 0) - float(b.get("radio") or 0)) > TOLERANCIA_MM:
            return False
    return True


def _cortes(s: list, i: list) -> Optional[list]:
    """Qué hay que cortar en las puntas: [[letra del ítem, mm], …]. None si una punta es más
    corta que lo pedido, o es más larga pero no es recta (no se corta un gancho)."""
    cortes = []
    for k in sorted({0, len(i) - 1}):
        sobra = s[k]["largo"] - i[k]["largo"]
        if abs(sobra) <= TOLERANCIA_MM:
            continue
        if sobra < 0 or _clase(s[k]) != "recto":
            return None
        cortes.append([i[k]["nombre"], round(sobra, 1)])
    return cortes


def _calza_orientada(s: list, i: list) -> Optional[list]:
    if len(s) != len(i) or [_clase(l) for l in s] != [_clase(l) for l in i]:
        return None
    if not _mismos_giros(_giros(s), _giros(i)) or not _medio_igual(s, i):
        return None
    return _cortes(s, i)


def _recta(s: list, i: list) -> Optional[dict]:
    """De una recta salen tantas piezas como quepan; lo que sobra se corta."""
    largo_s, largo_i = s[0]["largo"], i[0]["largo"]
    piezas = int((largo_s + TOLERANCIA_MM) // largo_i) if largo_i > 0 else 0
    if piezas < 1:
        return None
    sobra = round(largo_s - piezas * largo_i, 1)
    igual = piezas == 1 and abs(sobra) <= TOLERANCIA_MM
    return {"tipo": "igual" if igual else "corte", "piezas": piezas,
            "cortes": [] if igual else [[i[0]["nombre"], max(sobra, 0.0)]]}


def comparar(stock: list, item: list) -> Optional[dict]:
    """¿Se hace el ítem con la barra disponible? {tipo: igual|corte, cortes, piezas} o None."""
    if len(stock) == 1 and len(item) == 1 and _clase(stock[0]) == _clase(item[0]) == "recto":
        return _recta(stock, item)
    for s in orientaciones(stock):
        cortes = _calza_orientada(s, item)
        if cortes is not None:
            return {"tipo": "corte" if cortes else "igual", "cortes": cortes, "piezas": 1}
    return None


def lados_de_item(legangle: str) -> list:
    """Los lados de un ítem de aSa con la misma forma que los de una barra disponible."""
    legs, _r = _legs(legangle, None)
    return [{"nombre": l["nombre"], "largo": float(l["largo"]), "tipo": l["tipo"], "angulo": l["angulo"],
             "arco": bool(l["arco"]), "radio": l["radio"], "gancho": bool(l["gancho"])} for l in legs]


def resultado(barra: dict, item: dict, cmp: dict) -> dict:
    """Una coincidencia: el ítem, cuánto de él cubre la barra y cuántos kilos se ahorran."""
    cubre = min(item["cant"], barra["cant_disponible"] * cmp["piezas"])
    kg_unit = item["kg"] / item["cant"] if item["cant"] else 0.0
    return dict(cmp, **{k: item[k] for k in CAMPOS_ITEM}, barra_id=barra["id"], cubre=cubre,
                cant_item=item["cant"], kg_item=round(item["kg"], 2), kg_ahorro=round(cubre * kg_unit, 2))


def coincidencias_de(barra: dict, items: list) -> list:
    """Las coincidencias de una barra: primero las iguales, y dentro, las que más ahorran."""
    out = []
    for it in items:
        if it["item_key"] == barra.get("item_key"):
            continue
        cmp = comparar(barra["lados"], it["lados"])
        if cmp:
            out.append(resultado(barra, it, cmp))
    out.sort(key=lambda r: (r["tipo"] != "igual", -r["kg_ahorro"]))
    return out[:TOPE_POR_BARRA]


# ---------------------------------------------------------------------------
# Lo que se pide a aSa y a la base
# ---------------------------------------------------------------------------
def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _txt(v) -> str:
    """aSa devuelve los nulos de una consulta sumada como el texto «None»."""
    t = str(v or "").strip()
    return "" if t == "None" else t


def item_de_fila(f: dict) -> Optional[dict]:
    """Una fila de la consulta sumada de aSa como ítem por fabricar."""
    lados = lados_de_item(_txt(f.get("LegAngle")))
    if not lados:
        return None
    return {"item_key": int(_num(f.get("OrderItemKey"))), "cc": _txt(f.get("CtrlCode")),
            "marca": _txt(f.get("BarMark")), "obra": _txt(f.get("JobName")), "cliente": _txt(f.get("CustomerName")),
            "descr_cc": _txt(f.get("OrderDescr")), "elemento": _txt(f.get("ElementDesc")),
            # Dónde va: la descripción del CC y el elemento de la tarjeta (como material.ubicacion_de).
            "ubicacion": " - ".join(t for t in (_txt(f.get("OrderDescr")), _txt(f.get("ElementID"))) if t),
            "estado_asa": _txt(f.get("OrderStatusDescr")), "figura": _txt(f.get("ShpNameID")) or None,
            "lados": lados, "cant": _num(f.get("Cant")), "kg": _num(f.get("Kg"))}


def codigos_con_forma(figuras: list, forma: tuple, tridimensional: bool) -> set:
    """Los códigos de figura de aSa que tienen esa forma (la recta es None). Plana o en dos
    planos cuenta: el soporte 26 y la S4 tienen los mismos giros, pero el 26 se dobla en dos
    planos y la S4 no (medido 25-nov: sin esto, el 26 traía ítems 105D y S4)."""
    return {f["codigo"] for f in figuras
            if firma(f["lados"]) == forma and bool(f.get("tridimensional")) == tridimensional}


def grupos(barras: list, figuras: list) -> dict:
    """Las barras disponibles juntadas por lo que se le pide a aSa de una vez: φ, grado y
    forma. Cada grupo con los códigos de figura que tienen esa forma y el largo mayor."""
    out = {}
    for b in barras:
        forma, tridim = firma(b["lados"]), bool(b["tridimensional"])
        g = out.setdefault((float(b["diam_mm"]), b["grado"], forma, tridim),
                           {"barras": [], "codigos": codigos_con_forma(figuras, forma, tridim), "largo": 0.0})
        g["barras"].append(b)
        g["codigos"].add(b["figura"])
        g["largo"] = max(g["largo"], float(b["largo_mm"] or 0))
    return out


def _filtro_figura(c) -> str:
    return "ShpNameID eq null" if c is None else "ShpNameID eq '%s'" % str(c).replace("'", "''")


def filtro_de(diam: float, grado: str, codigos, largo_max: float) -> str:
    """El filtro de aSa para un grupo: ítems vivos de ese φ, grado y figuras, que no sean más
    largos que la barra disponible más larga del grupo."""
    estados = " or ".join("OrderStatusDescr eq '%s'" % e for e in ESTADOS)
    figs = " or ".join(_filtro_figura(c) for c in sorted(codigos, key=lambda c: (c is not None, str(c))))
    return "(%s) and BarSizeDescr eq '%dmm' and GradeID eq '%s' and (%s) and LengthTheor le %d" % (
        estados, int(diam), grado.replace("'", "''"), figs, int(largo_max + TOLERANCIA_MM))


def _pedir(grupo_clave, g) -> list:
    from . import asa
    diam, grado = grupo_clave[0], grupo_clave[1]
    filas = asa.consultar_agregado("getOrderItemView", DIMS, "TotalQty", alias="Cant",
                                   filtro=filtro_de(diam, grado, g["codigos"], g["largo"]), carga=True,
                                   extra=[("LineWeight", "Kg")])
    return [it for it in (item_de_fila(f) for f in filas) if it]


def ccs_activos(cur) -> set:
    """Los códigos vivos de obras con movimiento (y no excluidas)."""
    cur.execute("""SELECT p.control_code FROM asa_pedidos p
                     LEFT JOIN asa_obras o ON o.asa_job_id = p.asa_job_id
                    WHERE p.estado = ANY(%s) AND NOT COALESCE(o.excluida, FALSE)
                      AND GREATEST(p.order_date, p.proj_ship_date) >= CURRENT_DATE - make_interval(months => %s)""",
                (list(ESTADOS), MESES_ACTIVA))
    return {r[0] for r in cur.fetchall()}


def _barras(cur, barra_ids: list) -> list:
    """Las barras con saldo, con lo que hace falta para compararlas."""
    cur.execute("""SELECT id, item_key, figura, diam_mm, grado, lados, largo_mm, cant_disponible,
                          COALESCE((eje->>'tridimensional')::boolean, FALSE) FROM material_barras
                    WHERE estado = 'disponible' AND cant_disponible > 0 AND id = ANY(%s)""", (list(barra_ids),))
    nombres = ("id", "item_key", "figura", "diam_mm", "grado", "lados", "largo_mm", "cant_disponible",
               "tridimensional")
    return [dict(zip(nombres, r)) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# La búsqueda de UNA barra, en el momento
# ---------------------------------------------------------------------------
def _encontrar(barras: list, activos: set, figuras: list) -> list:
    filas = []
    for clave, g in grupos(barras, figuras).items():
        items = [it for it in _pedir(clave, g) if it["cc"] in activos]
        for b in g["barras"]:
            filas += coincidencias_de(b, items)
    return filas


def buscar_barra(cur, barra_id: int) -> list:
    """Lo que se puede hacer HOY con una barra disponible: se le pregunta a aSa en el momento
    (una consulta: su φ, su grado y su forma). No se guarda: lo que se muestra es lo vivo
    (25-nov: dos ítems borrados de su CC después de la búsqueda seguían en la lista)."""
    from . import material
    barras = _barras(cur, [barra_id])
    if not barras:
        return []
    return _encontrar(barras, ccs_activos(cur), material.figuras(cur))
