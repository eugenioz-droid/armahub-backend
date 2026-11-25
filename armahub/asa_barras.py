# -*- coding: utf-8 -*-
"""
UNA BARRA DE aSa, LISTA PARA MOSTRAR (25-nov).

Lo que antes armaba sólo la auditoría (`auditorias.elemento_asa`) y ahora usa también la
caluga Material disponible: los lados con su letra (mm), los ángulos, qué lados son gancho,
el dibujo (`eje`) y lo demás que muestra la tabla. Una sola forma de leer una barra de aSa
para toda la plataforma. Sin rutas: lo importan los módulos de rutas.
"""
import re
from typing import Optional

from .figura_asa import figura_de, trazo_de_catalogo


def es_barra(it: dict) -> bool:
    """aSa manda, dentro del código, una LÍNEA POR ELEMENTO además de sus barras: sin marca,
    sin φ, sin figura, cantidad 1 y de peso el del conjunto (medido: 581 kg = la suma de sus
    barras). No es una barra: contaba doble el kilaje de la muestra y salía en la grilla como
    una fila vacía (el usuario la vio, 6-oct). Barra es lo que tiene marca o diámetro."""
    return bool((it.get("BarMark") or "").strip() or (it.get("BarSizeDescr") or "").strip())


def diam_mm(descr) -> float:
    """El φ en mm desde el texto de aSa («10mm», «12 mm»)."""
    m = re.search(r"([\d.]+)", str(descr or ""))
    return float(m.group(1)) if m else 0.0


def lados_de_legangle(xml: Optional[str]) -> dict:
    """Los lados de la barra, del XML de `LegAngle`, para la grilla: `dims` {letra: mm},
    `angulos` [grados entre cada lado y el anterior] y `ganchos` [letras]. Si aSa no le
    puso letra a un lado (las rectas), se nombra por posición: A, B, C… que es como las
    nombra ella misma cuando sí lo hace."""
    salida = {"dims": {}, "angulos": [], "ganchos": []}
    if not xml:
        return salida
    for i, cp in enumerate(re.findall(r"<cp>(.*?)</cp>", str(xml))):
        largo = re.search(r"<l>([-\d.]+)</l>", cp)
        if not largo:
            continue
        nombre = (re.search(r"<ln>(.*?)</ln>", cp) or [None, ""])[1] or "ABCDEFGHI"[i:i + 1] or str(i + 1)
        salida["dims"][nombre] = float(largo.group(1))
        ang = re.search(r"<a>([-\d.]+)</a>", cp)
        if ang:
            salida["angulos"].append(float(ang.group(1)))
        tipo = re.search(r"<t>(.*?)</t>", cp)
        if tipo and tipo.group(1).upper().startswith("H"):
            salida["ganchos"].append(nombre)
    return salida


def trazos_de(cur, codigos) -> dict:
    """EL TRAZO QUE EXPORTÓ aSa, para las figuras que estén en su catálogo (el RDX). Se usa de
    RESPALDO cuando nuestra reconstrucción no cuadra con la envolvente que aSa declara: ahí
    la topología que trae el trazo —declarada por aSa, no deducida por nosotros— es la
    mejor fuente que queda. El porqué de no usarlo siempre, con los números medidos, está
    en trazo_de_catalogo(). Se piden sólo las figuras que se van a dibujar."""
    cur.execute("SELECT codigo, puntos, lados FROM asa_figuras_catalogo WHERE codigo = ANY(%s)",
                (list(codigos),))
    return {r[0]: {"puntos": r[1] or [], "lados": r[2] or []} for r in cur.fetchall()}


def mejor_eje(it: dict, dims: dict, trazos: dict) -> dict:
    """La figura que se dibuja: la reconstrucción si cuadra, y si no el trazo de aSa.
    Una figura TRIDIMENSIONAL se deja como está aunque no cuadre: el trazo del RDX es
    plano y taparía justamente el aviso de que la barra se dobla en dos planos."""
    eje = figura_de(it.get("ShapeDims"), it.get("LegAngle"), it.get("PinDiam"),
                    diam_mm(it.get("BarSizeDescr")))
    if eje.get("ok") or eje.get("tridimensional"):
        return eje
    alterna = trazo_de_catalogo(trazos.get((it.get("ShpNameID") or "").strip()), dims,
                                it.get("LegAngle"), it.get("PinDiam") or 0)
    return alterna if (alterna and alterna.get("ok")) else eje


def barra_de_item(it: dict, trazos: dict) -> dict:
    """Un ítem de aSa como barra para la tabla y el dibujo."""
    lados = lados_de_legangle(it.get("LegAngle"))
    return {
        "marca": it.get("BarMark"), "diam": it.get("BarSizeDescr"), "figura": it.get("ShpNameID"),
        # Los lados en mm con su letra, los ángulos entre lados y qué lados son gancho:
        # la grilla los pone en columnas, en cm, igual que el Bar Manager.
        "dims": lados["dims"], "angulos": lados["angulos"], "ganchos": lados["ganchos"],
        # El largo que se audita es la SUMA DE LOS PARCIALES (ver CAMPOS_ITEM); el de
        # corte viaja al lado porque es el que aSa manda a fabricar, y que los dos no
        # coincidan es normal: la diferencia es el doblez.
        "largo": it.get("LengthTheor"), "largo_corte": it.get("LengthCut"),
        # EL DIBUJO. La figura se construye con lo que manda aSa (lados, ángulos,
        # mandril, φ) como una policurva —ver figura_asa.py— y se comprueba contra la
        # envolvente que ella misma declara: si no cuadra se intenta con el trazo que
        # exportó aSa, y si tampoco, se dibuja igual con el aviso y el porqué al lado.
        # `eje.fuente` dice de dónde salió, porque el auditor merece saberlo.
        "eje": mejor_eje(it, lados["dims"], trazos),
        "cant_total": it.get("TotalQty"), "peso_total": it.get("LineWeight"),
        "plano": it.get("ElementDesc"), "radio": it.get("PinDiam"),
        # EL NOMBRE QUE LE PUSO EL CUBICADOR A LA MARCA (MH, MV, TR…), solo: va al lado
        # de la marca en la tabla de la auditoría y en la foto de la barra (6-nov).
        "notas": (it.get("Notes") or "").strip() or None,
        "nota": " · ".join(x for x in ((it.get("Notes") or "").strip(),
                                       (it.get("ShopMessage") or "").strip()) if x) or None,
    }
