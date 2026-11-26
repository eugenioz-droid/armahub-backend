# -*- coding: utf-8 -*-
"""
MATERIAL DISPONIBLE › ASIGNAR (25-nov, SPECS §15.4-15.5) — fase 3.

Desde la ventana de una barra disponible (usuario, 25-nov):
  · «Buscar coincidencias» le pregunta a aSa en el momento qué ítems se hacen con ella;
  · se reparten sus barras entre los ítems que se quiera (600 disponibles y cuatro ítems que
    suman 500: quedan 100 de saldo para asignar después). El saldo baja al asignar y vuelve
    al quitar;
  · producción confirma con un check, en la misma ventana, que ya produjo cada ítem (queda
    quién y cuándo). Sin saldo y con todo confirmado, la barra queda CONSUMIDA y pasa al
    Resumen.

LA ÚLTIMA BÚSQUEDA QUEDA GUARDADA (usuario, 26-nov: «no me lo dejó guardado; tengo que volver
a buscar»): cada búsqueda reemplaza las filas de esa barra en material_coincidencias y la
ventana las muestra con su hora; lo que falta y el tope se rehacen con el saldo de hoy.

Antes de guardar se vuelve a mirar cada ítem en aSa: que siga por fabricar y que siga
calzando (25-nov: dos ítems se borraron de su CC después de la búsqueda). Las cantidades se
rebajan sólo acá; en aSa lo maneja producción.

Sin rutas ni fastapi: las rutas están en material_api.py.
"""
import json
import math
from datetime import datetime, timezone

from . import material
from . import material_busqueda as B
from .asa_barras import diam_mm
from .material import ErrorMaterial

# Lo que se guarda de cada asignación (además de la barra, las cantidades y quién).
_CAMPOS = ("item_key", "cc", "marca", "obra", "cliente", "descr_cc", "elemento", "ubicacion", "estado_asa",
           "figura", "lados", "tipo", "cortes", "piezas", "cant_barras", "cant_piezas", "kg")


def _ahora():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Cuánto se le puede dar a cada ítem (puro)
# ---------------------------------------------------------------------------
def tope_barras(falta: float, piezas: int, saldo: int) -> int:
    """Cuántas barras como máximo: las que alcanzan para lo que le falta al ítem, sin pasar
    el saldo. De una recta larga salen varias piezas: con 5 por barra, 12 piezas son 3 barras."""
    if falta <= 0 or saldo <= 0:
        return 0
    return min(saldo, math.ceil(falta / max(piezas, 1)))


def con_saldo(c: dict, ya: float, saldo: int) -> dict:
    """Una coincidencia con lo ya asignado al ítem (desde cualquier barra), lo que le falta y
    el tope de barras que se le pueden dar."""
    falta = max(float(c["cant_item"]) - ya, 0.0)
    return dict(c, ya_asignado=ya, falta=falta, tope_barras=tope_barras(falta, c["piezas"], saldo),
                dims={l["nombre"]: l["largo"] for l in c["lados"]})


def pedidos_validos(pedidos) -> list:
    """[(item_key, barras, nombre para los avisos)]; cada ítem una vez y con 1 barra o más."""
    out, vistos = [], set()
    for p in pedidos or []:
        k, n = int(p.get("item_key") or 0), material.cantidad_valida(p.get("cantidad"))
        if not k or k in vistos:
            raise ErrorMaterial("Cada ítem se asigna una vez.")
        vistos.add(k)
        out.append((k, n, " ".join(str(p.get(c) or "") for c in ("marca", "cc")).strip() or str(k)))
    if not out:
        raise ErrorMaterial("Elige al menos un ítem.")
    return out


def _item_vivo(it: dict, nombre: str) -> dict:
    """El ítem como lo usa la búsqueda, si sigue por fabricar en aSa."""
    if not it or str(it.get("OrderStatusDescr") or "") not in B.ESTADOS:
        raise ErrorMaterial("%s ya no está por fabricar en aSa (se borró o cambió de estado). Busca de nuevo."
                            % nombre)
    item = B.item_de_fila(dict(it, Cant=it.get("TotalQty"), Kg=it.get("LineWeight")))
    if not item:
        raise ErrorMaterial("%s no tiene figura en aSa." % nombre)
    return item


def _calce(barra: dict, it: dict, item: dict, nombre: str) -> dict:
    mismo = (diam_mm(it.get("BarSizeDescr")) == float(barra["diam_mm"])
             and str(it.get("GradeID") or "") == str(barra["grado"]))
    cmp = B.comparar(barra["lados"], item["lados"]) if mismo else None
    if not cmp:
        raise ErrorMaterial("%s ya no calza con esta barra (cambió en aSa). Busca de nuevo." % nombre)
    return cmp


def fila_asignacion(barra: dict, it: dict, n: int, ya: float, nombre: str) -> dict:
    """Lo que se guarda al asignar n barras a un ítem: valida que siga vivo, que calce y que
    no se le dé más de lo que le falta."""
    item = _item_vivo(it, nombre)
    cmp = _calce(barra, it, item, nombre)
    falta = max(item["cant"] - ya, 0.0)
    if falta <= 0:
        raise ErrorMaterial("%s ya está cubierto con material disponible." % nombre)
    if tope_barras(falta, cmp["piezas"], n) < n:
        raise ErrorMaterial("A %s le faltan %s piezas: alcanzan %d barras."
                            % (nombre, _num(falta), math.ceil(falta / cmp["piezas"])))
    piezas = min(n * cmp["piezas"], falta)
    kg_unit = item["kg"] / item["cant"] if item["cant"] else 0.0
    return dict(cmp, **{k: item[k] for k in B.CAMPOS_ITEM}, cant_barras=n, cant_piezas=piezas,
                kg=round(piezas * kg_unit, 2))


def _num(v) -> str:
    return ("%.0f" % v) if float(v).is_integer() else ("%.1f" % v)


# ---------------------------------------------------------------------------
# Lo que pide la ventana de la barra
# ---------------------------------------------------------------------------
def _barra(cur, barra_id: int) -> dict:
    b = material.barra(cur, barra_id)
    if not b:
        raise ErrorMaterial("Esa barra no existe.")
    return b


def _ya_asignado(cur, item_keys) -> dict:
    """Las piezas ya asignadas a cada ítem, desde cualquier barra."""
    if not item_keys:
        return {}
    cur.execute("""SELECT item_key, SUM(cant_piezas) FROM material_asignaciones
                    WHERE item_key = ANY(%s) GROUP BY item_key""", (list(item_keys),))
    return {int(r[0]): float(r[1]) for r in cur.fetchall()}


_COLS = ("a.id, a.item_key, a.cc, a.marca, a.obra, a.cliente, a.descr_cc, a.elemento, a.ubicacion, a.estado_asa, "
         "a.figura, a.lados, a.tipo, a.cortes, a.piezas, a.cant_barras, a.cant_piezas, a.kg, a.asignado_el, "
         "a.producido_el")
_NOMBRES = [c.strip()[2:] for c in _COLS.split(",")] + ["asignado_nombre", "producido_nombre"]


def _asignacion(r) -> dict:
    d = dict(zip(_NOMBRES, r))
    for k in ("cant_piezas", "kg"):
        d[k] = float(d[k]) if d[k] is not None else None
    for k in ("asignado_el", "producido_el"):
        d[k] = d[k].isoformat() if d[k] else None
    d["dims"] = {l["nombre"]: l["largo"] for l in d["lados"] or []}
    return d


def asignaciones(cur, barra_id: int) -> list:
    cur.execute("SELECT %s, %s, %s FROM material_asignaciones a WHERE a.barra_id = %%s ORDER BY a.id"
                % (_COLS, material.nombre_de("a.asignado_por"), material.nombre_de("a.producido_por")), (barra_id,))
    return [_asignacion(r) for r in cur.fetchall()]


# Lo que se guarda de cada coincidencia (y se lee igual).
_COIN = ("item_key", "cc", "marca", "obra", "cliente", "descr_cc", "elemento", "ubicacion", "estado_asa", "figura",
         "lados", "tipo", "cortes", "piezas", "cant_item", "cubre", "kg_item", "kg_ahorro")


def _guardar(cur, barra_id: int, filas: list, cuando):
    """Reemplaza la búsqueda guardada de esa barra."""
    cur.execute("DELETE FROM material_coincidencias WHERE barra_id = %s", (barra_id,))
    for c in filas:
        valores = [json.dumps(c[k], ensure_ascii=False) if k in ("lados", "cortes") else c[k] for k in _COIN]
        cur.execute("INSERT INTO material_coincidencias (barra_id, %s, buscado_el) VALUES (%%s, %s, %%s)"
                    % (", ".join(_COIN), ", ".join(["%s"] * len(_COIN))), [barra_id] + valores + [cuando])
    cur.execute("UPDATE material_barras SET coin_buscado_el = %s WHERE id = %s", (cuando, barra_id))


def coincidencia_guardada(r) -> dict:
    """Una fila guardada como la entrega la búsqueda."""
    c = dict(zip(_COIN, r))
    for k in ("cant_item", "cubre", "kg_item", "kg_ahorro"):
        c[k] = float(c[k]) if c[k] is not None else 0.0
    return c


def _con_saldos(cur, filas: list, saldo: int) -> list:
    ya = _ya_asignado(cur, {c["item_key"] for c in filas})
    return [con_saldo(c, ya.get(int(c["item_key"]), 0.0), saldo) for c in filas]


def guardadas(cur, barra_id: int, saldo: int) -> dict:
    """La última búsqueda de la barra, con lo que le falta hoy a cada ítem. Sin búsqueda,
    coincidencias = None (no es lo mismo que buscar y no encontrar nada)."""
    cur.execute("SELECT coin_buscado_el FROM material_barras WHERE id = %s", (barra_id,))
    cuando = (cur.fetchone() or [None])[0]
    if not cuando:
        return {"coincidencias": None, "buscado_el": None}
    cur.execute("SELECT %s FROM material_coincidencias WHERE barra_id = %%s ORDER BY (tipo <> 'igual'), kg_ahorro DESC, id"
                % ", ".join(_COIN), (barra_id,))
    filas = [coincidencia_guardada(r) for r in cur.fetchall()]
    return {"coincidencias": _con_saldos(cur, filas, saldo), "buscado_el": cuando.isoformat()}


def detalle(cur, barra_id: int) -> dict:
    """La barra, lo que ya se le asignó y su última búsqueda."""
    b = _barra(cur, barra_id)
    return dict(guardadas(cur, barra_id, b["cant_disponible"]), barra=b, asignaciones=asignaciones(cur, barra_id))


def coincidencias(cur, barra_id: int) -> dict:
    """La búsqueda en el momento, guardada, con lo que le falta a cada ítem y el tope de barras."""
    saldo = _barra(cur, barra_id)["cant_disponible"]
    filas, cuando = B.buscar_barra(cur, barra_id), _ahora()
    _guardar(cur, barra_id, filas, cuando)
    return {"coincidencias": _con_saldos(cur, filas, saldo), "buscado_el": cuando.isoformat()}


def _items_en_asa(keys: list) -> dict:
    """Los ítems elegidos, como están ahora en aSa (una consulta)."""
    filtro = " or ".join("OrderItemKey eq %d" % k for k in keys)
    return {int(it.get("OrderItemKey")): it for it in material._pedir_items(filtro)}


def _descontar(cur, barra_id: int, total: int):
    cur.execute("""UPDATE material_barras SET cant_disponible = cant_disponible - %s
                    WHERE id = %s AND estado = 'disponible' AND cant_disponible >= %s RETURNING id""",
                (total, barra_id, total))
    if cur.fetchone() is None:
        raise ErrorMaterial("El saldo de la barra cambió mientras asignabas. Vuelve a abrirla.")


def _insertar(cur, barra_id: int, f: dict, email: str):
    valores = [json.dumps(f[c], ensure_ascii=False) if c in ("lados", "cortes") else f[c] for c in _CAMPOS]
    cur.execute("INSERT INTO material_asignaciones (barra_id, %s, asignado_por) VALUES (%%s, %s, %%s)"
                % (", ".join(_CAMPOS), ", ".join(["%s"] * len(_CAMPOS))), [barra_id] + valores + [email])


def asignar(cur, barra_id: int, email: str, pedidos) -> dict:
    """Reparte barras entre varios ítems de una vez: todos o ninguno."""
    pedidos = pedidos_validos(pedidos)
    barra = _barra(cur, barra_id)
    total = sum(n for _k, n, _t in pedidos)
    if barra["estado"] != "disponible" or total > barra["cant_disponible"]:
        raise ErrorMaterial("Quedan %d barras y se están asignando %d." % (barra["cant_disponible"], total))
    vivos = _items_en_asa([k for k, _n, _t in pedidos])
    ya = _ya_asignado(cur, {k for k, _n, _t in pedidos})
    filas = [fila_asignacion(barra, vivos.get(k), n, ya.get(k, 0.0), t) for k, n, t in pedidos]
    _descontar(cur, barra_id, total)
    for f in filas:
        _insertar(cur, barra_id, f, email)
    material.estado_de_barra(cur, barra_id)
    return detalle(cur, barra_id)


def quitar(cur, asignacion_id: int) -> dict:
    """Deshace una asignación que producción todavía no confirmó: las barras vuelven al saldo."""
    cur.execute("""DELETE FROM material_asignaciones WHERE id = %s AND producido_el IS NULL
                   RETURNING barra_id, cant_barras""", (asignacion_id,))
    r = cur.fetchone()
    if not r:
        raise ErrorMaterial("Esa asignación ya está producida o ya no existe.")
    cur.execute("UPDATE material_barras SET cant_disponible = cant_disponible + %s WHERE id = %s", (r[1], r[0]))
    material.estado_de_barra(cur, r[0])
    return detalle(cur, r[0])


def producida(cur, asignacion_id: int, email: str, si: bool) -> dict:
    """El check de producción: queda quién y cuándo. Desmarcarlo lo deja por confirmar."""
    cur.execute("""UPDATE material_asignaciones SET producido_por = %s, producido_el = %s
                    WHERE id = %s RETURNING barra_id""",
                (email if si else None, _ahora() if si else None, asignacion_id))
    r = cur.fetchone()
    if not r:
        raise ErrorMaterial("Esa asignación ya no existe.")
    material.estado_de_barra(cur, r[0])
    return detalle(cur, r[0])


# ---------------------------------------------------------------------------
# El Resumen: lo reutilizado
# ---------------------------------------------------------------------------
def resumen(cur) -> dict:
    """Lo que producción confirmó, lo más reciente arriba, con la barra de la que salió."""
    cur.execute("""SELECT %s, %s, %s, a.barra_id, b.marca, b.cc, b.obra, b.diam_mm, b.figura, b.lados,
                          b.referencias, b.eje, b.largo_mm, b.motivo, b.origen
                     FROM material_asignaciones a JOIN material_barras b ON b.id = a.barra_id
                    WHERE a.producido_el IS NOT NULL ORDER BY a.producido_el DESC, a.id DESC"""
                % (_COLS, material.nombre_de("a.asignado_por"), material.nombre_de("a.producido_por")))
    nombres = ("barra_id", "barra_marca", "barra_cc", "barra_obra", "diam_mm", "barra_figura", "barra_lados",
               "referencias", "eje", "largo_mm", "motivo", "origen")
    filas = []
    for r in cur.fetchall():
        d = _asignacion(r[:len(_NOMBRES)])
        d.update(zip(nombres, r[len(_NOMBRES):]))
        d.update(diam_mm=float(d["diam_mm"]), largo_mm=float(d["largo_mm"] or 0),
                 motivo_txt=material.MOTIVOS.get(d["motivo"]) or material.MOTIVOS_ANTIGUOS.get(d["motivo"], d["motivo"]),
                 barra_dims=material.dims_de(d["barra_lados"] or []))
        filas.append(d)
    return {"filas": filas, "kg": round(sum(f["kg"] or 0 for f in filas), 1),
            "barras": sum(f["cant_barras"] for f in filas), "items": len({f["item_key"] for f in filas})}
