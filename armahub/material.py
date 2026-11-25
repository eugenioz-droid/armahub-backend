# -*- coding: utf-8 -*-
"""
MATERIAL DISPONIBLE (25-nov) — la caluga para reciclar barras (SPECS §15). Fase 1: ingresar
y listar.

Una barra disponible entra de dos formas:
  · DESDE aSa: un ítem de cualquier código de control (una devolución, una barra mal
    fabricada, un sobrante). Se trae entero de aSa, aunque ya esté fabricado o despachado, y
    se ajusta la cantidad: una devolución puede no traer el ítem completo.
  · A MANO: una barra suelta medida en inventario, sin tarjeta. Se elige la figura entre las
    que de verdad se usan en aSa y se escriben sus lados.

Las dos quedan con la MISMA forma —los lados en orden con su tipo, su giro y si son gancho—,
que es lo que la búsqueda de la fase 2 va a comparar contra los ítems por fabricar.

Sin rutas ni fastapi: las rutas están en material_api.py.
"""
import json
import re
import time
from datetime import datetime, timezone
from typing import Optional

from .asa_barras import diam_mm, es_barra, lados_de_legangle, mejor_eje, trazos_de
from .chequeos import _clasificar_lados, normalizar_asa
from .figura_asa import LETRAS, _legs, figura_de
from .peso import peso_unitario_kg

# Quién entra, además de administración. Es la misma lista que registry.js (`areas`).
AREAS = ("Cubicaciones", "Calidad", "Logística", "USC C&D", "Producción C&D")
ROLES_SIEMPRE = ("admin", "admin_calidad")
MOTIVOS = {"devolucion": "Devolución", "mal_fabricada": "Mal fabricada", "sobrante": "Sobrante",
           "inventario": "Inventario"}
MOTIVOS_ASA = ("devolucion", "mal_fabricada", "sobrante")
# El grado se guarda con el código de aSa, tal cual, porque es lo que se compara. Medido
# (25-nov, ítems Open y Processed): A630-420H casi todo, A630-420HS el soldable, y un poco de
# A440-280H. A mano se elige entre los dos que se usan (usuario, 24-nov).
GRADOS = {"A630-420H": "A630", "A630-420HS": "Soldable"}
GRADO_POR_DEFECTO = "A630-420H"
DIAMETROS = (8, 10, 12, 16, 18, 22, 25, 28, 32, 36)
ESTADOS = ("disponible", "agotada", "descartada")
CAMPOS_ITEM = ["OrderItemKey", "LineNum", "SeqNo", "CtrlCode", "JobName", "CustomerName", "OrderDescr",
               "OrderStatusDescr", "ElementID", "ElementDesc", "BarMark", "Notes", "ShopMessage",
               "BarSizeDescr", "GradeID", "ShpNameID", "ShapeDims", "LegAngle", "LengthCut",
               "LengthTheor", "TotalQty", "LineWeight", "PinDiam"]
# El catálogo de figuras para el ingreso a mano se arma con las barras de ejemplo de aSa
# (asa_figuras): son más de cien figuras y cambia poco, así que se guarda un rato.
FIGURAS_SEGUNDOS = 3600
_figuras = {"t": 0.0, "lista": None}


class ErrorMaterial(Exception):
    """Lo que el usuario puede corregir (dato que falta o fuera de rango): las rutas lo
    devuelven como 400 con este mensaje."""


# ---------------------------------------------------------------------------
# Quién entra
# ---------------------------------------------------------------------------
def puede(cur, user: dict) -> bool:
    if user.get("role") in ROLES_SIEMPRE:
        return True
    cur.execute("""SELECT 1 FROM area_usuarios au
                     JOIN areas a ON a.id = au.area_id
                     JOIN users u ON u.id = au.user_id
                    WHERE a.nombre = ANY(%s) AND COALESCE(a.activo, TRUE) AND u.email = %s
                    LIMIT 1""", (list(AREAS), user.get("email", "")))
    return cur.fetchone() is not None


# ---------------------------------------------------------------------------
# Reglas puras (se prueban sin base ni aSa)
# ---------------------------------------------------------------------------
def _txt(v) -> str:
    return str(v or "").strip()


def lado_guardado(l: dict) -> dict:
    """Lo que se guarda de cada lado: lo que hace falta para dibujarlo y para compararlo."""
    return {"nombre": l["nombre"], "largo": round(float(l["largo"]), 1), "tipo": l.get("tipo") or "STD",
            "angulo": l.get("angulo"), "arco": bool(l.get("arco")), "radio": l.get("radio"),
            "gancho": bool(l.get("gancho"))}


def dims_de(lados: list) -> dict:
    """{letra: mm} para la grilla."""
    return {l["nombre"]: l["largo"] for l in lados}


def angulos_de(lados: list) -> list:
    """El giro de cada lado contra el anterior, desde el segundo (como el `<a>` de aSa)."""
    return [l["angulo"] for l in lados[1:] if l.get("angulo") is not None]


def cantidad_valida(valor, tope: Optional[float] = None) -> int:
    """Un entero de 1 en adelante y, si hay tope (la cantidad del ítem), no más que eso."""
    try:
        n = int(valor)
    except (TypeError, ValueError):
        raise ErrorMaterial("La cantidad tiene que ser un número entero.")
    if n < 1:
        raise ErrorMaterial("La cantidad tiene que ser 1 o más.")
    if tope is not None and n > tope:
        raise ErrorMaterial("La cantidad no puede ser mayor que la del ítem (%d)." % int(tope))
    return n


def lados_a_mano(definicion: dict, largos_cm: dict, radios_cm: dict, diam: float) -> list:
    """Los lados de una barra medida a mano: la figura pone el orden, el tipo y el giro de
    cada lado; el usuario, los largos (y el radio de un lado curvo), en cm."""
    lados = []
    for d in definicion["lados"]:
        largo = _cm_a_mm(largos_cm.get(d["nombre"]), d["nombre"])
        radio = _cm_a_mm(radios_cm.get(d["nombre"]), "R de " + d["nombre"]) if d.get("arco") else None
        lados.append({"nombre": d["nombre"], "largo": largo, "tipo": d.get("tipo") or "STD",
                      "angulo": d.get("angulo"), "arco": bool(d.get("arco")), "radio": radio,
                      "declarado_gancho": bool(d.get("gancho"))})
    # Gancho o no lo decide la misma regla que usa la revisión de barras (un extremo corto
    # que da la vuelta, o el que aSa declara).
    _clasificar_lados(lados, diam)
    return [lado_guardado(l) for l in lados]


def _cm_a_mm(valor, letra: str) -> float:
    try:
        mm = float(str(valor).replace(",", ".")) * 10
    except (TypeError, ValueError):
        raise ErrorMaterial("Falta la medida del lado %s." % letra)
    if mm <= 0:
        raise ErrorMaterial("La medida del lado %s tiene que ser mayor que cero." % letra)
    return round(mm, 1)


# ---------------------------------------------------------------------------
# Las figuras para el ingreso a mano
# ---------------------------------------------------------------------------
# UNA BARRA A MANO ES LA BARRA DE EJEMPLO DE aSa CON LOS LARGOS DEL USUARIO (25-nov). Así se
# dibuja con el mismo trazador que las barras reales, también las que aSa dobla en dos
# planos —los soportes 26 y 305A, que son justo lo que más se recicla— y los arcos. La caja
# que declara aSa (`<mbr>`) se saca: es la del ejemplo, no la de esta barra.
RECTA_XML = "<la><st>LN</st><cp><t>STD</t><l>3000</l><n>1</n><ln>A</ln></cp></la>"
_CP = re.compile(r"<cp>(.*?)</cp>", re.S)


def _cp_con_largo(cp: str, i: int, largos: dict, radios: dict) -> str:
    nombre = (re.search(r"<ln>(.*?)</ln>", cp) or [None, ""])[1] or LETRAS[i:i + 1]
    if nombre in largos:
        cp = re.sub(r"<l>[-\d.]+</l>", "<l>%s</l>" % largos[nombre], cp)
    if nombre in radios:
        cp = re.sub(r"<r>[-\d.]+</r>", "<r>%s</r>" % radios[nombre], cp)
    return cp


def xml_con_largos(legangle: str, largos: dict, radios: dict) -> str:
    """El `LegAngle` del ejemplo con los largos (y radios) en mm de esta barra, sin la caja
    ni el largo total del ejemplo."""
    xml = re.sub(r"<mbr>.*?</mbr>|<lt>.*?</lt>", "", str(legangle or ""), flags=re.S)
    cps = iter(range(10 ** 6))
    return _CP.sub(lambda m: "<cp>%s</cp>" % _cp_con_largo(m.group(1), next(cps), largos, radios), xml)


def shapedims_con_largos(shapedims, largos: dict, radios: dict):
    """El ShapeDims del ejemplo con los largos y el radio de esta barra: de ahí salen las
    direcciones (y los dos planos), y el radio del tramo curvo."""
    datos = json.loads(shapedims) if isinstance(shapedims, str) else (shapedims or [])
    radio = next(iter(radios.values()), None)
    for d in datos if isinstance(datos, list) else []:
        if d.get("LegName") in largos and d.get("ElemType") != "WS":
            d["MMLength"] = largos[d["LegName"]]
        elif radio and (d.get("ElemType") == "WR" or d.get("LegName") == "R"):
            d["MMLength"] = radio
    return json.dumps(datos)


def eje_a_mano(fig: dict, lados: list, diam: float) -> dict:
    """El dibujo de una barra medida a mano, con el trazador de las barras reales."""
    largos = {l["nombre"]: l["largo"] for l in lados}
    radios = {l["nombre"]: l["radio"] for l in lados if l.get("radio")}
    return figura_de(shapedims_con_largos(fig["_shapedims"], largos, radios),
                     xml_con_largos(fig["_legangle"], largos, radios), fig["pin_phi"] * diam, diam)


def _definicion(codigo, usos, legangle, shapedims, pin, diam) -> Optional[dict]:
    """Una figura de aSa, desde su barra de ejemplo: el orden, el tipo y el giro de cada lado,
    y el ejemplo mismo (`_legangle`, `_shapedims`), que es de donde sale el dibujo."""
    legs, _r = _legs(legangle, shapedims)
    if not legs:
        return None
    eje = figura_de(shapedims, legangle, pin, diam)
    return {"codigo": codigo, "nombre": codigo or "Recta", "usos": usos, "eje": eje,
            "tridimensional": bool(eje.get("tridimensional")),
            "pin_phi": round(float(pin or 0) / float(diam), 2) if diam else 0.0,
            "lados": [{"nombre": l["nombre"], "tipo": l["tipo"], "angulo": l["angulo"],
                       "arco": bool(l["arco"]), "gancho": bool(l["gancho"])} for l in legs],
            "_legangle": legangle, "_shapedims": shapedims}


def figuras(cur) -> list:
    """Las figuras que de verdad se usan en aSa, de la más usada a la menos, con la recta
    primero. Cada una con su dibujo de ejemplo y la definición de sus lados."""
    if _figuras["lista"] is not None and time.time() - _figuras["t"] < FIGURAS_SEGUNDOS:
        return _figuras["lista"]
    cur.execute("""SELECT codigo, barras, legangle, shapedims, pin_diam, diam_mm FROM asa_figuras
                    WHERE barras > 0 ORDER BY barras DESC, codigo""")
    lista = [_definicion(None, 0, RECTA_XML, None, 0, 10.0)]
    for r in cur.fetchall():
        d = _definicion(r[0], r[1], r[2], r[3], r[4], float(r[5] or 0))
        if d:
            lista.append(d)
    _figuras.update(t=time.time(), lista=lista)
    return lista


def figuras_para_pantalla(cur) -> list:
    """Las figuras sin el ejemplo de aSa, que es sólo para el servidor."""
    return [{k: v for k, v in f.items() if not k.startswith("_")} for f in figuras(cur)]


def definicion_de(cur, codigo) -> dict:
    for f in figuras(cur):
        if f["codigo"] == (codigo or None):
            return f
    raise ErrorMaterial("Esa figura no está entre las que se usan en aSa.")


def previa(cur, datos: dict) -> dict:
    """El dibujo, el largo y el peso de una barra a mano mientras se escribe."""
    diam = float(datos.get("diam") or 0)
    fig = definicion_de(cur, datos.get("figura"))
    lados = lados_a_mano(fig, datos.get("lados") or {}, datos.get("radios") or {}, diam)
    largo = sum(l["largo"] for l in lados)
    return {"eje": eje_a_mano(fig, lados, diam), "lados": lados, "largo_mm": largo,
            "kg_unit": round(peso_unitario_kg(diam, largo / 10) or 0, 3)}


# ---------------------------------------------------------------------------
# Lo que se lee de aSa
# ---------------------------------------------------------------------------
def _pedir_items(filtro: str) -> list:
    from . import asa
    return asa.consultar("getOrderItemView", select=CAMPOS_ITEM, filtro=filtro, top=500)


def _item_para_elegir(it: dict, trazos: dict) -> dict:
    """Un ítem de aSa como fila para elegir: la barra para la hoja y su identidad."""
    dims = lados_de_legangle(it.get("LegAngle"))
    return {"item_key": it.get("OrderItemKey"), "linea": it.get("LineNum"), "seq": it.get("SeqNo"),
            "cc": _txt(it.get("CtrlCode")), "obra": it.get("JobName"), "cliente": it.get("CustomerName"),
            "descr_cc": it.get("OrderDescr"), "estado_asa": it.get("OrderStatusDescr"),
            "elemento": it.get("ElementDesc"), "marca": it.get("BarMark"), "notas": _txt(it.get("Notes")) or None,
            "figura": _txt(it.get("ShpNameID")) or None, "diam": it.get("BarSizeDescr"),
            "grado": it.get("GradeID"), "dims": dims["dims"], "angulos": dims["angulos"],
            "cant": it.get("TotalQty"), "kg": it.get("LineWeight"), "largo": it.get("LengthTheor"),
            "eje": mejor_eje(it, dims["dims"], trazos)}


def items_de_cc(cur, cc: str) -> list:
    """Las barras de un código de control, para elegir cuál se deja disponible."""
    cc = _txt(cc).upper()
    if not cc:
        raise ErrorMaterial("Escribe el código de control.")
    items = [it for it in _pedir_items("CtrlCode eq '%s'" % cc.replace("'", "''")) if es_barra(it)]
    trazos = trazos_de(cur, {_txt(it.get("ShpNameID")) for it in items})
    return [_item_para_elegir(it, trazos) for it in items]


def _item_por_clave(item_key: int) -> Optional[dict]:
    items = _pedir_items("OrderItemKey eq %d" % int(item_key))
    return items[0] if items else None


# ---------------------------------------------------------------------------
# Ingresar
# ---------------------------------------------------------------------------
def _comunes(datos: dict) -> dict:
    return {"ubicacion": _txt(datos.get("ubicacion"))[:120] or None,
            "nota": _txt(datos.get("nota"))[:400] or None}


def fila_desde_asa(it: dict, motivo: str, cantidad, eje: dict) -> dict:
    """La fila de una barra que viene de un ítem de aSa. Pura: el ítem ya viene leído."""
    if motivo not in MOTIVOS_ASA:
        raise ErrorMaterial("Elige el motivo: Devolución, Mal fabricada o Sobrante.")
    b = normalizar_asa(it, _txt(it.get("BarMark")))
    if not b:
        raise ErrorMaterial("Ese ítem no trae los lados de la barra.")
    cant_item = float(it.get("TotalQty") or 0)
    n = cantidad_valida(cantidad, cant_item or None)
    return dict(_identidad(it), origen="asa", motivo=motivo, eje=eje, cant=n,
                lados=[lado_guardado(l) for l in b["lados"]], referencias=b["referencias"],
                kg_unit=round(float(it.get("LineWeight") or 0) / cant_item, 3) if cant_item else None)


def _identidad(it: dict) -> dict:
    """De dónde salió la barra y qué es, tal como lo dice aSa."""
    return {"cc": _txt(it.get("CtrlCode")), "item_key": it.get("OrderItemKey"), "obra": it.get("JobName"),
            "cliente": it.get("CustomerName"), "descr_cc": it.get("OrderDescr"), "elemento": it.get("ElementDesc"),
            "marca": it.get("BarMark"), "notas": _txt(it.get("Notes")) or None,
            "figura": _txt(it.get("ShpNameID")) or None, "diam_mm": diam_mm(it.get("BarSizeDescr")),
            "grado": _txt(it.get("GradeID")) or GRADO_POR_DEFECTO, "largo_mm": float(it.get("LengthTheor") or 0)}


def fila_a_mano(cur, datos: dict) -> dict:
    diam = float(datos.get("diam") or 0)
    if diam not in DIAMETROS:
        raise ErrorMaterial("Elige el diámetro.")
    grado = datos.get("grado") or GRADO_POR_DEFECTO
    if grado not in GRADOS:
        raise ErrorMaterial("Elige el grado: A630 o Soldable.")
    p = previa(cur, datos)
    return {"origen": "mano", "motivo": "inventario", "figura": datos.get("figura") or None,
            "diam_mm": diam, "grado": grado, "lados": p["lados"], "eje": p["eje"],
            # El radio de un arco, como lo muestra aSa: aparte de los lados.
            "referencias": [["R", l["radio"]] for l in p["lados"] if l["arco"]][:1],
            "largo_mm": p["largo_mm"], "kg_unit": p["kg_unit"], "cant": cantidad_valida(datos.get("cantidad"))}


def _insertar(cur, fila: dict, email: str) -> int:
    cols = ["origen", "motivo", "cc", "item_key", "obra", "cliente", "descr_cc", "elemento", "marca", "notas",
            "figura", "diam_mm", "grado", "lados", "referencias", "eje", "largo_mm", "kg_unit", "ubicacion", "nota"]
    valores = [json.dumps(fila.get(c), ensure_ascii=False) if c in ("lados", "referencias", "eje") else fila.get(c)
               for c in cols]
    cur.execute("INSERT INTO material_barras (%s, cant_inicial, cant_disponible, creado_por) "
                "VALUES (%s, %%s, %%s, %%s) RETURNING id" % (", ".join(cols), ", ".join(["%s"] * len(cols))),
                valores + [fila["cant"], fila["cant"], email])
    return cur.fetchone()[0]


def crear(cur, email: str, datos: dict) -> int:
    """Deja una barra disponible. Devuelve su id."""
    if datos.get("origen") == "asa":
        it = _item_por_clave(datos.get("item_key") or 0)
        if not it:
            raise ErrorMaterial("Ese ítem no está en aSa.")
        trazos = trazos_de(cur, [_txt(it.get("ShpNameID"))])
        eje = mejor_eje(it, lados_de_legangle(it.get("LegAngle"))["dims"], trazos)
        fila = fila_desde_asa(it, datos.get("motivo"), datos.get("cantidad"), eje)
    elif datos.get("origen") == "mano":
        fila = fila_a_mano(cur, datos)
    else:
        raise ErrorMaterial("Elige si la barra viene de aSa o se ingresa a mano.")
    fila.update(_comunes(datos))
    return _insertar(cur, fila, email)


# ---------------------------------------------------------------------------
# La lista, y lo que se le hace a una barra
# ---------------------------------------------------------------------------
_COLUMNAS = ("id, origen, motivo, cc, item_key, obra, cliente, descr_cc, elemento, marca, notas, figura, "
             "diam_mm, grado, lados, referencias, eje, largo_mm, kg_unit, cant_inicial, cant_disponible, "
             "ubicacion, nota, estado, descarte_motivo, creado_por, creado_el, editado_por, editado_el")


def _iso(v):
    return v.isoformat() if v else None


def fila_para_pantalla(r: dict) -> dict:
    """Una fila de la base como la usa la pantalla: la barra para la hoja y sus datos."""
    lados = r["lados"] or []
    kg_unit = float(r["kg_unit"]) if r["kg_unit"] is not None else None
    return dict(r, diam_mm=float(r["diam_mm"]), largo_mm=float(r["largo_mm"] or 0), kg_unit=kg_unit,
                dims=dims_de(lados), angulos=angulos_de(lados),
                kg_disponible=round(kg_unit * r["cant_disponible"], 1) if kg_unit is not None else None,
                motivo_txt=MOTIVOS.get(r["motivo"], r["motivo"]), grado_txt=GRADOS.get(r["grado"], r["grado"]),
                creado_el=_iso(r["creado_el"]), editado_el=_iso(r["editado_el"]))


def listar(cur) -> list:
    """Todas las barras, lo más nuevo arriba; la pantalla filtra por estado. Con el nombre de
    quien la ingresó, no su correo."""
    cur.execute("""SELECT %s, (SELECT NULLIF(TRIM(CONCAT(u.nombre, ' ', u.apellido)), '') FROM users u
                                WHERE LOWER(u.email) = LOWER(m.creado_por) LIMIT 1)
                     FROM material_barras m ORDER BY creado_el DESC, id DESC""" % _COLUMNAS)
    nombres = [c.strip() for c in _COLUMNAS.split(",")] + ["creado_nombre"]
    return [fila_para_pantalla(dict(zip(nombres, r))) for r in cur.fetchall()]


def ajustar(cur, barra_id: int, email: str, datos: dict) -> bool:
    """Cambia la cantidad disponible, la ubicación o la nota. Con 0 disponibles queda agotada."""
    n = datos.get("cantidad")
    disp = None if n is None else (0 if str(n).strip() == "0" else cantidad_valida(n))
    cur.execute("""UPDATE material_barras
                      SET cant_disponible = COALESCE(%s, cant_disponible),
                          estado = CASE WHEN COALESCE(%s, cant_disponible) = 0 THEN 'agotada'
                                        WHEN estado = 'agotada' THEN 'disponible' ELSE estado END,
                          ubicacion = %s, nota = %s, editado_por = %s, editado_el = %s
                    WHERE id = %s AND estado <> 'descartada' RETURNING id""",
                (disp, disp, _comunes(datos)["ubicacion"], _comunes(datos)["nota"], email,
                 datetime.now(timezone.utc), barra_id))
    return cur.fetchone() is not None


def descartar(cur, barra_id: int, email: str, motivo: str) -> bool:
    motivo = _txt(motivo)[:200]
    if not motivo:
        raise ErrorMaterial("Escribe por qué se descarta.")
    cur.execute("""UPDATE material_barras SET estado = 'descartada', descarte_motivo = %s,
                          editado_por = %s, editado_el = %s
                    WHERE id = %s AND estado <> 'descartada' RETURNING id""",
                (motivo, email, datetime.now(timezone.utc), barra_id))
    return cur.fetchone() is not None
