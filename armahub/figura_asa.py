"""
RECONSTRUIR LA FIGURA DE UNA BARRA DE aSa (2-oct).

QUÉ RESUELVE. En la auditoría hay que mirar barras de obras que no están en ArmaHub, así
que no sirve el catálogo de figuras: hay que dibujarlas con lo que manda aSa. Y manda
todo, aunque hay que saber dónde mirar.

LO QUE TRAE aSa POR BARRA (`getOrderItemView`):

  · `LegAngle` — un XML con la envolvente (`mbr`), el largo total y un `<cp>` por lado:
    tipo (`STD` recto, `H3`/`H9` gancho, `RB` tramo curvo), largo, ángulo y nombre.
  · `ShapeDims` — el mismo eje en JSON y con MÁS detalle. Acá está lo que de verdad
    permite dibujar sin adivinar: **`SlopingVector`, la dirección ABSOLUTA de cada lado**.

POR QUÉ NO SE USA EL ÁNGULO. El `<a>` del XML parecía el giro entre lados, pero
reconstruyendo con él la envolvente no cuadra: hay un convenio de signo y de
vértice-vs-tangencia que depende del tipo de doblez. Con `SlopingVector` no hay convenio
que adivinar — es un vector — y el resultado cuadra con `mbr` dentro del 1%.

CÓMO SE SABE SI SALIÓ BIEN. aSa manda la envolvente (`mbr`) de la barra. Se dibuja, se
mide la envolvente de lo dibujado y se comparan: si no cuadran, `ok` viene en False y la
pantalla muestra las medidas en texto en vez de un dibujo equivocado. Un dibujo mal hecho
en una auditoría es peor que ningún dibujo: el auditor daría por buena una barra mala.

LOS CURVOS. Un lado `RB` es un arco: `ShapeDims` trae su radio en una entrada aparte
(`ElemType` `WR`, `LegName` `R`) y el ángulo barrido en `XAngleInRads`. Comprobado contra
un caso real: radio 12.200, arco 10.000 → 46,96°, cuerda 9.722 y flecha 1.010, que es
exactamente el `mbr` que manda aSa (9.708 × 1.007).
"""
import json
import math
import re
from typing import Optional

# Cuánto puede diferir la envolvente dibujada de la que declara aSa para darla por buena.
# El 3% cubre el acortamiento por radio de doblado, que no se modela lado a lado.
TOLERANCIA = 0.03
# Lados que son geometría. El resto de las entradas de ShapeDims son cotas y ángulos
# auxiliares (`WS`, `AN`, `WR`): números para el taller, no tramos del eje.
TIPOS_LADO = ("B", "SB", "RB", "H3", "H9", "H18", "H13", "STD")


def _num(x, por_defecto=0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return por_defecto


def envolvente_declarada(legangle: Optional[str]):
    """La envolvente que declara aSa en `LegAngle` (`mbr`), para comprobar el dibujo."""
    if not legangle:
        return None
    m = re.search(r"<mbr>\s*<X>([-\d.]+)</X>\s*<Y>([-\d.]+)</Y>", str(legangle))
    if not m:
        return None
    return (abs(_num(m.group(1))), abs(_num(m.group(2))))


def _lados(shapedims):
    """Los lados reales, en orden, con su largo y su dirección. Devuelve también el radio
    si la barra trae un tramo curvo."""
    if not shapedims:
        return [], None
    try:
        datos = json.loads(shapedims) if isinstance(shapedims, str) else shapedims
    except (ValueError, TypeError):
        return [], None
    if not isinstance(datos, list):
        return [], None
    radio = None
    for d in datos:
        if (d.get("ElemType") or "") == "WR" or (d.get("LegName") or "") == "R":
            radio = _num(d.get("MMLength")) or radio
    lados = []
    for d in datos:
        if d.get("LegNum") is None:
            continue
        if (d.get("ElemType") or "") not in TIPOS_LADO:
            continue
        v = str(d.get("SlopingVector") or "").split(",")
        vx, vy = (_num(v[0]), _num(v[1])) if len(v) >= 2 else (0.0, 0.0)
        lados.append({
            "n": int(_num(d.get("LegNum"))),
            "nombre": d.get("LegName") or "",
            "largo": _num(d.get("MMLength")),
            "vx": vx, "vy": vy,
            "gancho": bool(d.get("IsHook")),
            "arco": bool(d.get("IsRadial")) or (d.get("ElemType") or "") == "RB",
            "barrido": _num(d.get("XAngleInRads"), -1.0),
        })
    lados.sort(key=lambda x: x["n"])
    return lados, radio


def _lados_de_xml(legangle: Optional[str]):
    """Los lados sacados del XML, para las barras que no traen `ShapeDims`: las RECTAS.
    Una barra recta no tiene nada que modelar —es un segmento— y aSa no le manda dims."""
    if not legangle:
        return []
    cps = re.findall(r"<cp>(.*?)</cp>", str(legangle))
    if len(cps) != 1:
        return []
    m = re.search(r"<l>([-\d.]+)</l>", cps[0])
    if not m:
        return []
    return [{"n": 1, "nombre": "", "largo": _num(m.group(1)), "vx": 1.0, "vy": 0.0,
             "gancho": False, "arco": False, "barrido": -1.0}]


def _recortar_por_doblado(puntos, radio_doblado: float):
    """EL LARGO DE UN LADO SE MIDE AL VÉRTICE, no a donde empieza la curva del doblez.

    Por eso la figura dibujada con los largos crudos sale MÁS GRANDE que la barra real:
    en cada esquina sobra el tramo que en la barra se convierte en curva. Lo que sobra por
    lado es el *setback*: t = R · tan(w/2), con w el ángulo girado en esa esquina.

    Acá se recorta ese pedazo en los dos lados de cada vértice interior y se reemplaza la
    esquina por el arco de doblado. Sin esto la envolvente dibujada no cuadra con la que
    declara aSa —medido: un estribo daba 340 donde aSa dice 304, justo tres radios— y la
    figura, aunque parecida, mentiría en las medidas.
    """
    if radio_doblado <= 0 or len(puntos) < 3:
        return puntos
    salida = [puntos[0]]
    for i in range(1, len(puntos) - 1):
        ax, ay = puntos[i - 1]
        bx, by = puntos[i]
        cx, cy = puntos[i + 1]
        v1x, v1y = bx - ax, by - ay
        v2x, v2y = cx - bx, cy - by
        n1, n2 = math.hypot(v1x, v1y), math.hypot(v2x, v2y)
        if n1 == 0 or n2 == 0:
            salida.append(puntos[i])
            continue
        u1 = (v1x / n1, v1y / n1)
        u2 = (v2x / n2, v2y / n2)
        # w = cuánto gira la barra en este vértice (0 = sigue derecho).
        coseno = max(-1.0, min(1.0, u1[0] * u2[0] + u1[1] * u2[1]))
        w = math.acos(coseno)
        if w < 1e-6:
            salida.append(puntos[i])
            continue
        t = radio_doblado * math.tan(min(w, math.pi * 0.98) / 2)
        t = min(t, n1 * 0.49, n2 * 0.49)      # nunca se come el lado entero
        # Los dos puntos donde el lado recto termina y empieza la curva. Entre ellos va
        # el codo: se deja como un segmento recto porque la curva real queda DENTRO de
        # esa cuerda, y lo que no puede pasar es que el dibujo mida de más.
        salida.append((bx - u1[0] * t, by - u1[1] * t))
        salida.append((bx + u2[0] * t, by + u2[1] * t))
    salida.append(puntos[-1])
    return salida


def figura_de(shapedims, legangle: Optional[str] = None, pin_diam: float = 0.0,
              pasos_arco: int = 24) -> dict:
    """El EJE de la barra como una polilínea de puntos en milímetros.

    Devuelve `{ok, puntos, lados, ancho, alto, mbr, motivo}`. `ok` es False cuando no se
    pudo reconstruir o cuando lo dibujado no cuadra con la envolvente que declara aSa:
    en ese caso la pantalla muestra las medidas en texto y no un dibujo inventado.
    """
    lados, radio = _lados(shapedims)
    mbr = envolvente_declarada(legangle)
    if not lados:
        # Las barras rectas no traen `ShapeDims`: su geometría está entera en el XML.
        lados = _lados_de_xml(legangle)
    if not lados:
        return {"ok": False, "motivo": "aSa no mandó los lados de esta barra",
                "puntos": [], "lados": [], "mbr": mbr}

    x = y = 0.0
    puntos = [(0.0, 0.0)]
    tramos = []
    for lado in lados:
        largo = lado["largo"]
        if largo <= 0:
            continue
        desde = len(puntos) - 1
        if lado["arco"] and radio and radio > 0:
            # Arco: se recorre el ángulo barrido en pasos cortos. El sentido sale del
            # signo del barrido; si aSa no lo manda, se asume antihorario.
            barrido = lado["barrido"] if lado["barrido"] > 0 else (largo / radio)
            signo = 1.0 if barrido >= 0 else -1.0
            barrido = abs(barrido)
            # La tangente inicial: la dirección del lado anterior si lo hay. Si el arco es
            # TODA la barra, se arranca girado medio barrido para que la cuerda quede
            # horizontal, que es como aSa mide su envolvente — comprobado: con la tangente
            # en el eje X la flecha daba 3.874 y aSa declara 1.007, que es R(1−cos(θ/2)).
            ang = math.atan2(puntos[-1][1] - puntos[-2][1], puntos[-1][0] - puntos[-2][0]) \
                if len(puntos) > 1 else (-signo * barrido / 2.0)
            for i in range(1, pasos_arco + 1):
                paso = barrido * i / pasos_arco
                # Posición sobre el arco respecto del punto de partida.
                dx = radio * math.sin(paso)
                dy = signo * radio * (1 - math.cos(paso))
                x = puntos[desde][0] + dx * math.cos(ang) - dy * math.sin(ang)
                y = puntos[desde][1] + dx * math.sin(ang) + dy * math.cos(ang)
                puntos.append((x, y))
        else:
            norma = math.hypot(lado["vx"], lado["vy"])
            if norma == 0:
                return {"ok": False, "motivo": "un lado viene sin dirección",
                        "puntos": [], "lados": lados, "mbr": mbr}
            x += lado["vx"] / norma * largo
            y += lado["vy"] / norma * largo
            puntos.append((x, y))
        tramos.append({"nombre": lado["nombre"], "largo": round(largo),
                       "gancho": lado["gancho"], "arco": lado["arco"],
                       "desde": desde, "hasta": len(puntos) - 1})

    # Los largos vienen medidos AL VÉRTICE: hay que descontar lo que se come el doblez.
    puntos = _recortar_por_doblado(puntos, _num(pin_diam) / 2.0)

    xs = [p[0] for p in puntos]
    ys = [p[1] for p in puntos]
    ancho, alto = max(xs) - min(xs), max(ys) - min(ys)

    ok, motivo = True, ""
    if mbr:
        # La comprobación: lo dibujado tiene que medir lo que aSa dice que mide.
        for dibujado, declarado, cual in ((ancho, mbr[0], "ancho"), (alto, mbr[1], "alto")):
            ref = max(declarado, 1.0)
            if abs(dibujado - declarado) / ref > TOLERANCIA:
                ok, motivo = False, ("la envolvente no cuadra: %s dibujado %d, aSa dice %d"
                                     % (cual, round(dibujado), round(declarado)))
                break
    else:
        ok, motivo = (ancho > 0 or alto > 0), "sin envolvente para comprobar"

    return {"ok": ok, "motivo": motivo, "puntos": [[round(p[0], 1), round(p[1], 1)] for p in puntos],
            "lados": tramos, "ancho": round(ancho), "alto": round(alto), "mbr": mbr,
            "radio": round(radio) if radio else None}
