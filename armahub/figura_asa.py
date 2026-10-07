"""
RECONSTRUIR LA FIGURA DE UNA BARRA DE aSa (2-oct; policurva 6-oct).

QUÉ RESUELVE. En la auditoría hay que mirar barras de obras que no están en ArmaHub, y
muchas de sus figuras no tienen homóloga en el catálogo de la plataforma (T1, T12, 104E1,
26, J4…). aSa no manda un dibujo: manda la DEFINICIÓN de la figura, lado por lado, y con
eso se construye.

LO QUE TRAE aSa POR BARRA (`getOrderItemView`):

  · `LegAngle` — un XML con la envolvente (`mbr`), el largo total y un `<cp>` por lado, EN
    ORDEN: tipo (`STD` recto, `H3` gancho de 135°, `H9` gancho de 90°, `RB` tramo curvo),
    largo, ángulo con el lado anterior y nombre (la letra).
  · `ShapeDims` — el mismo eje en JSON y con más detalle: `SlopingVector`, la dirección
    ABSOLUTA de cada lado; en los curvos, el radio (`WR`) y el ángulo barrido.
  · `PinDiam` — el diámetro del mandril con que se dobla. Con el φ da el radio del codo.

CÓMO SE CONSTRUYE (medido sobre 888 barras reales de 28 códigos de control, 6-oct):

  · La DIRECCIÓN de cada lado sale de su vector. Es lo que cuadra: 779 de 780 lados
    rectos del medio y 102 de 102 ganchos de 90° coinciden con la dirección que dan los
    ángulos. La excepción es el GANCHO SÍSMICO (135°, `H3`) AL FINAL: su vector apunta de
    la punta libre hacia el cuerpo, al revés del recorrido, en 91 de 91; se da vuelta.
  · Si un lado no trae vector (las trabas `TP`: formas 26, 305A), su dirección sale del
    ÁNGULO con el anterior (`<a>`, positivo = antihorario, verificado contra los vectores
    donde los hay); y si es el primero, del primer lado con vector girado hacia atrás.
  · Un doblez de HASTA 90° es un vértice: el motor que dibuja le pone el codo tangente él
    mismo (disenador.js). Un doblez de MÁS de 90° —los ganchos de 135° y 180°— es un ARCO
    explícito de radio mandril/2 + φ/2 entre sus dos puntos de tangencia: el lado que entra
    llega entero al inicio del arco y el que sale arranca entero al final. Así el gancho de
    180° queda paralelo a la barra, a dos radios, y no plegado encima de ella. Es la misma
    receta con que el Modelador 3D arregló el estribo (figura_puntos.js::_ganchoArco) y lo
    que dice el estándar BVBS: la curva >90° es un segmento propio, no un vértice.
  · Un lado curvo (`RB`) es un arco con su radio y su barrido. Comprobado contra un caso
    real: radio 12.200, arco 10.000 → 46,96°, cuerda 9.722 y flecha 1.010, que es la
    envolvente que manda aSa (9.708 × 1.007).
  · La figura se ORIENTA con su lado recto más largo horizontal y el resto hacia arriba,
    que es como la dibujan aSa y el catálogo.

CÓMO SE SABE SI SALIÓ BIEN. aSa manda la envolvente (`mbr`). Se mide la de lo construido
y se comparan, sin importar cuál eje es cuál (aSa gira algunas figuras) y tolerando lo que
el doblez puede mover (dos mandriles: aSa modela los codos con detalle y acá sólo con el
arco de norma). Si no cuadran, `ok` viene en False y la pantalla dibuja igual pero con un
aviso y el porqué al lado: el auditor decide, no se le esconde nada. Con esta regla cuadran
862 de las 870 barras del muestreo que traen envolvente; las 8 que no son dos formas (103G,
S55) cuyos propios vectores y ángulos describen otra cosa que su envolvente.

SALIDA: una POLICURVA —`puntos` (mm, Y hacia arriba) y `tramos` {tipo recto|arco, radio,
sweep, lado, largo, desde, hasta}—, que es lo que el motor 2D dibuja con el comando A de
SVG, redondeando él los vértices de ≤90° y rotulando cada tramo recto con su lado.
"""
import json
import math
import re
from typing import Optional

# Cuánto puede diferir la envolvente construida de la que declara aSa para darla por buena:
# el 3% o lo que mueven dos codos (un mandril por lado), lo que sea mayor.
TOLERANCIA = 0.03
# Ganchos de 135°: su vector final viene de la punta al cuerpo (ver arriba).
GANCHO_135 = "H3"
# Desde qué giro un doblez deja de ser un vértice y pasa a ser un arco propio.
GIRO_ARCO = 90.5
# El motor 2D dibuja cada arco con el comando A de SVG en su versión CORTA (large-arc 0): un
# arco de más de 180° hay que partirlo. Un estribo circular o una espiral son varios pedazos.
ARCO_MAXIMO = 180.0
# Un vector con componente Z mayor que esto (sobre el largo del vector) es una figura en 3D.
Z_MINIMA = 0.02
# Lados que son geometría. El resto de las entradas de ShapeDims son cotas y ángulos
# auxiliares (`WS`, `AN`, `WR`): números para el taller, no tramos del eje.
TIPOS_LADO = ("B", "SB", "RB", "H3", "H9", "H18", "H13", "STD")
LETRAS = "ABCDEFGHI"


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


def _vectores(shapedims):
    """Lo que ShapeDims dice de cada lado, por letra: vector, si es gancho, el barrido de
    los curvos; y el radio del tramo curvo, que viene en una entrada aparte (`WR` / `R`)."""
    if not shapedims:
        return {}, None, []
    try:
        datos = json.loads(shapedims) if isinstance(shapedims, str) else shapedims
    except (ValueError, TypeError):
        return {}, None, []
    if not isinstance(datos, list):
        return {}, None, []
    radio = None
    por_letra = {}
    orden = []
    for d in datos:
        if (d.get("ElemType") or "") == "WR" or (d.get("LegName") or "") == "R":
            radio = _num(d.get("MMLength")) or radio
        if d.get("LegNum") is None or (d.get("ElemType") or "") not in TIPOS_LADO:
            continue
        v = str(d.get("SlopingVector") or "").split(",")
        vx, vy = (_num(v[0]), _num(v[1])) if len(v) >= 2 else (0.0, 0.0)
        vz = _num(v[2]) if len(v) >= 3 else 0.0
        letra = d.get("LegName") or ""
        por_letra[letra] = {"vx": vx, "vy": vy, "vz": vz, "gancho": bool(d.get("IsHook")),
                            "tipo": d.get("ElemType") or "", "largo": _num(d.get("MMLength")),
                            "barrido": _num(d.get("XAngleInRads"), -1.0), "n": int(_num(d.get("LegNum")))}
        orden.append(letra)
    return por_letra, radio, orden


def _legs(legangle: Optional[str], shapedims):
    """Los lados en orden, con todo lo que hace falta para trazarlos. Manda el XML (es el
    que trae el orden y los ángulos); ShapeDims aporta el vector. Si no hay XML pero sí
    ShapeDims, se sigue el orden de ShapeDims. Devuelve (lados, radio_curvo)."""
    vec, radio, orden_sd = _vectores(shapedims)
    cps = re.findall(r"<cp>(.*?)</cp>", str(legangle or ""))
    legs = []
    for i, cp in enumerate(cps):
        l = re.search(r"<l>([-\d.]+)</l>", cp)
        if not l or _num(l.group(1)) <= 0:
            continue
        nombre = (re.search(r"<ln>(.*?)</ln>", cp) or [None, ""])[1] or LETRAS[i:i + 1] or str(i + 1)
        tipo = (re.search(r"<t>(.*?)</t>", cp) or [None, "STD"])[1]
        a = re.search(r"<a>([-\d.]+)</a>", cp)
        s = re.search(r"<s>([-\d.]+)</s>", cp)
        r = re.search(r"<r>([-\d.]+)</r>", cp)
        v = vec.get(nombre, {})
        barrido = _num(s.group(1)) if s else (math.degrees(v["barrido"]) if v.get("barrido", -1.0) > 0 else None)
        legs.append({"nombre": nombre, "largo": _num(l.group(1)), "tipo": tipo,
                     "angulo": _num(a.group(1)) if a else None,
                     "arco": tipo == "RB" or v.get("tipo") == "RB",
                     "radio": _num(r.group(1)) if r else radio, "barrido": barrido,
                     "gancho": tipo.startswith("H") or bool(v.get("gancho")),
                     "vx": v.get("vx", 0.0), "vy": v.get("vy", 0.0), "vz": v.get("vz", 0.0)})
    if not legs and orden_sd:
        for letra in sorted(orden_sd, key=lambda k: vec[k]["n"]):
            v = vec[letra]
            if v["largo"] <= 0:
                continue
            legs.append({"nombre": letra, "largo": v["largo"], "tipo": v["tipo"], "angulo": None,
                         "arco": v["tipo"] == "RB", "radio": radio,
                         "barrido": math.degrees(v["barrido"]) if v["barrido"] > 0 else None,
                         "gancho": v["gancho"], "vx": v["vx"], "vy": v["vy"], "vz": v["vz"]})
    return legs, radio


def _es_tridimensional(legs) -> bool:
    """¿Algún lado sale del plano? Las trabas TP (26, 305A) doblan en dos planos: aSa lo
    dice con la componente Z del vector. Acá se dibuja su proyección en planta, y se avisa."""
    for leg in legs:
        n = math.hypot(leg["vx"], leg["vy"], leg.get("vz", 0.0))
        if n and abs(leg.get("vz", 0.0)) / n > Z_MINIMA:
            return True
    return False


def _unit(vx, vy):
    h = math.hypot(vx, vy)
    return (vx / h, vy / h) if h else None


def _rot(d, grados):
    a = math.radians(grados)
    return (d[0] * math.cos(a) - d[1] * math.sin(a), d[0] * math.sin(a) + d[1] * math.cos(a))


def _direcciones(legs):
    """La dirección unitaria de cada lado (ver la cabecera: vector; gancho H3 final al
    revés; sin vector, el ángulo). None donde no hay cómo saberla."""
    n = len(legs)

    def vector(i):
        d = _unit(legs[i]["vx"], legs[i]["vy"]) if not legs[i]["arco"] else None
        if d and legs[i]["tipo"] == GANCHO_135 and i == n - 1:
            d = (-d[0], -d[1])
        return d

    dirs = []
    for i, leg in enumerate(legs):
        d = vector(i)
        if d is None and i == 0:
            # Sin vector propio: el del primer lado que tenga, girado hacia atrás por los
            # ángulos de por medio (si están todos).
            for k in range(1, n):
                dk = vector(k)
                if dk and all(legs[j]["angulo"] is not None for j in range(1, k + 1)):
                    for j in range(k, 0, -1):
                        dk = _rot(dk, -legs[j]["angulo"])
                    d = dk
                    break
            d = d or (1.0, 0.0)
        elif d is None:
            d = _rot(dirs[-1], leg["angulo"]) if (leg["angulo"] is not None and dirs[-1]) else dirs[-1]
        dirs.append(d)
    return dirs


def _giro(d1, d2):
    """Cuánto gira el recorrido entre dos direcciones, en grados con signo (+ antihorario)."""
    cruz = d1[0] * d2[1] - d1[1] * d2[0]
    punto = max(-1.0, min(1.0, d1[0] * d2[0] + d1[1] * d2[1]))
    return math.degrees(math.copysign(math.acos(punto), cruz if abs(cruz) > 1e-12 else 1.0))


def _arco(centro, radio, a0, barrido, pasos):
    """Puntos de un arco desde el ángulo a0 barriendo `barrido` (rad, con signo)."""
    return [(centro[0] + radio * math.cos(a0 + barrido * k / pasos),
             centro[1] + radio * math.sin(a0 + barrido * k / pasos)) for k in range(1, pasos + 1)]


def _emitir_arco(puntos, muestra, tramos, pts_arco, radio, signo, lado, largo):
    """Agrega un arco a la policurva, partido en pedazos de a lo más ARCO_MAXIMO grados (el
    motor dibuja la versión corta de cada arco). Devuelve el punto final."""
    muestra.extend(pts_arco)
    n = len(pts_arco)
    # Cuántos pedazos: el barrido total sale de los pasos muestreados (cada paso = barrido/n).
    pedazos = max(1, int(math.ceil(abs(_barrido_de(pts_arco, puntos[-1], radio)) / math.radians(ARCO_MAXIMO) - 1e-9)))
    for k in range(1, pedazos + 1):
        corte = pts_arco[min(n - 1, int(round(n * k / pedazos)) - 1)]
        desde = len(puntos) - 1
        puntos.append(corte)
        tramos.append({"tipo": "arco", "radio": radio, "sweep": 1 if signo > 0 else 0,
                       "lado": lado if k == 1 else "", "largo": largo if k == 1 else None,
                       "desde": desde, "hasta": len(puntos) - 1})
    return puntos[-1]


def _barrido_de(pts_arco, inicio, radio):
    """El ángulo barrido por un arco muestreado, sumando los pasos (cada cuerda chica)."""
    total = 0.0
    prev = inicio
    for p in pts_arco:
        c = math.hypot(p[0] - prev[0], p[1] - prev[1])
        total += 2.0 * math.asin(max(-1.0, min(1.0, c / (2.0 * radio)))) if radio > 0 else 0.0
        prev = p
    return total


def _trazar(legs, dirs, radio_codo, pasos):
    """Recorre los lados y arma la policurva. Devuelve (puntos, tramos, muestra): los
    puntos son los nodos (los arcos van como cuerda, el motor los dibuja con su radio); la
    muestra tiene los arcos desplegados, para medir la envolvente."""
    puntos = [(0.0, 0.0)]
    muestra = [(0.0, 0.0)]
    tramos = []
    x = y = 0.0
    for i, leg in enumerate(legs):
        d = dirs[i]
        if d is None:
            return None, None, None
        # El doblez con el lado anterior: si pasa de 90°, un arco propio antes del lado.
        if i > 0 and radio_codo > 0 and not leg["arco"] and not legs[i - 1]["arco"]:
            giro = _giro(dirs[i - 1], d)
            if abs(giro) > GIRO_ARCO:
                signo = 1.0 if giro > 0 else -1.0
                dp = dirs[i - 1]
                centro = (x - dp[1] * signo * radio_codo, y + dp[0] * signo * radio_codo)
                a0 = math.atan2(y - centro[1], x - centro[0])
                pts_arco = _arco(centro, radio_codo, a0, math.radians(giro), pasos)
                x, y = _emitir_arco(puntos, muestra, tramos, pts_arco, radio_codo, signo, "", None)
        desde = len(puntos) - 1
        if leg["arco"] and leg["radio"] and leg["radio"] > 0:
            r = leg["radio"]
            barrido = math.radians(leg["barrido"]) if leg["barrido"] else (leg["largo"] / r)
            signo = 1.0 if barrido >= 0 else -1.0
            barrido = abs(barrido)
            # La tangente inicial: la dirección del lado anterior si lo hay. Si el arco es
            # TODA la barra, se arranca girado medio barrido para que la cuerda quede
            # horizontal, que es como aSa mide su envolvente — comprobado: con la tangente
            # en el eje X la flecha daba 3.874 y aSa declara 1.007, que es R(1−cos(θ/2)).
            ang = math.atan2(d[1], d[0]) if i > 0 else (-signo * barrido / 2.0)
            centro = (x - math.sin(ang) * signo * r, y + math.cos(ang) * signo * r)
            a0 = math.atan2(y - centro[1], x - centro[0])
            pasos_rb = max(pasos * 2, int(math.ceil(math.degrees(barrido) / 10.0)))
            pts_arco = _arco(centro, r, a0, signo * barrido, pasos_rb)
            x, y = _emitir_arco(puntos, muestra, tramos, pts_arco, r, signo, leg["nombre"], round(leg["largo"]))
        else:
            x += d[0] * leg["largo"]
            y += d[1] * leg["largo"]
            puntos.append((x, y))
            muestra.append((x, y))
            tramos.append({"tipo": "recto", "radio": 0, "sweep": None, "lado": leg["nombre"],
                           "largo": round(leg["largo"]), "gancho": leg["gancho"],
                           "desde": desde, "hasta": len(puntos) - 1})
    return puntos, tramos, muestra


def _recortar_por_doblado(puntos, radio_doblado: float):
    """Para MEDIR la envolvente: en los vértices de ≤90° el largo se mide al vértice, pero
    la barra real dobla con radio, así que la esquina queda más adentro (setback
    t = R·tan(w/2)). Sin esto un estribo medía 340 donde aSa dice 304."""
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
        coseno = max(-1.0, min(1.0, u1[0] * u2[0] + u1[1] * u2[1]))
        w = math.acos(coseno)
        if w < 1e-6 or math.degrees(w) > GIRO_ARCO:
            salida.append(puntos[i])
            continue
        t = radio_doblado * math.tan(w / 2)
        t = min(t, n1 * 0.49, n2 * 0.49)
        salida.append((bx - u1[0] * t, by - u1[1] * t))
        salida.append((bx + u2[0] * t, by + u2[1] * t))
    salida.append(puntos[-1])
    return salida


def _orientar(puntos, tramos, muestra):
    """Gira la figura para que su lado recto más largo quede horizontal, y la espeja si
    hace falta para que el resto quede hacia arriba. Un espejo invierte el sentido de
    los arcos (sweep)."""
    largo = None
    for t in tramos:
        if t["tipo"] == "recto" and (largo is None or t["largo"] > largo["largo"]):
            largo = t
    if largo is None:
        return puntos, tramos, muestra
    a, b = puntos[largo["desde"]], puntos[largo["hasta"]]
    ang = -math.atan2(b[1] - a[1], b[0] - a[0])
    if abs(ang) > 1e-9:
        c, s = math.cos(ang), math.sin(ang)
        puntos = [(p[0] * c - p[1] * s, p[0] * s + p[1] * c) for p in puntos]
        muestra = [(p[0] * c - p[1] * s, p[0] * s + p[1] * c) for p in muestra]
    base = puntos[largo["desde"]][1]
    arriba = sum(1 for p in puntos if p[1] > base + 1e-6)
    abajo = sum(1 for p in puntos if p[1] < base - 1e-6)
    if abajo > arriba:
        puntos = [(p[0], -p[1]) for p in puntos]
        muestra = [(p[0], -p[1]) for p in muestra]
        tramos = [dict(t, sweep=(None if t["sweep"] is None else 1 - t["sweep"])) for t in tramos]
    return puntos, tramos, muestra


def figura_de(shapedims, legangle: Optional[str] = None, pin_diam: float = 0.0,
              diam_mm: float = 0.0, pasos_arco: int = 12) -> dict:
    """La figura de la barra como POLICURVA (ver la cabecera del módulo).

    Devuelve `{ok, motivo, puntos, tramos, ancho, alto, mbr, radio}`. `puntos` en mm con
    la Y hacia arriba; `tramos` paralelos a los segmentos entre puntos. `ok` es False
    cuando no se pudo construir o cuando la envolvente no cuadra con la que declara aSa;
    la pantalla dibuja igual (si hay puntos) y pone el aviso al lado.
    """
    legs, radio_curvo = _legs(legangle, shapedims)
    mbr = envolvente_declarada(legangle)
    if not legs:
        return {"ok": False, "motivo": "aSa no mandó los lados de esta barra",
                "puntos": [], "tramos": [], "mbr": mbr}
    dirs = _direcciones(legs)
    pin = _num(pin_diam)
    radio_codo = pin / 2.0 + _num(diam_mm) / 2.0
    puntos, tramos, muestra = _trazar(legs, dirs, radio_codo, pasos_arco)
    if puntos is None:
        return {"ok": False, "motivo": "un lado viene sin dirección",
                "puntos": [], "tramos": [], "mbr": mbr}
    puntos, tramos, muestra = _orientar(puntos, tramos, muestra)
    tridimensional = _es_tridimensional(legs)

    medido = _recortar_por_doblado(muestra, pin / 2.0)
    xs = [p[0] for p in medido]
    ys = [p[1] for p in medido]
    ancho, alto = max(xs) - min(xs), max(ys) - min(ys)

    ok, motivo = True, ""
    if mbr and (mbr[0] or mbr[1]):
        # Lo construido tiene que medir lo que aSa dice que mide —en el eje que sea: aSa
        # gira algunas figuras—, salvo lo que un codo por lado puede mover.
        def cuadra(a, b):
            for dibujado, declarado in ((a, mbr[0]), (b, mbr[1])):
                if abs(dibujado - declarado) > max(max(declarado, 1.0) * TOLERANCIA, 2 * pin):
                    return False
            return True
        if not (cuadra(ancho, alto) or cuadra(alto, ancho)):
            motivo = ("la envolvente no cuadra: construida %d × %d, aSa dice %d × %d"
                      % (round(ancho), round(alto), round(mbr[0]), round(mbr[1])))
            ok = False
    else:
        ok, motivo = (ancho > 0 or alto > 0), "sin envolvente para comprobar"
    if tridimensional:
        # Se dibuja la proyección en planta y se dice: una traba doblada en dos planos no
        # es lo que se ve, y el auditor tiene que saberlo.
        ok, motivo = False, "figura tridimensional (aSa la dobla en dos planos): se muestra su proyección en planta"

    return {"ok": ok, "motivo": motivo, "tridimensional": tridimensional, "fuente": "reconstruida",
            "puntos": [[round(p[0], 1), round(p[1], 1)] for p in puntos],
            "tramos": tramos, "ancho": round(ancho), "alto": round(alto), "mbr": mbr,
            "radio": round(radio_curvo) if radio_curvo else None}


def trazo_de_catalogo(trazo, dims, legangle: Optional[str] = None,
                      pin_diam: float = 0.0) -> Optional[dict]:
    """EL TRAZO QUE EXPORTÓ aSa, estirado a las medidas de ESTA barra (7-oct).

    El export RDX del catálogo de aSa trae, por figura, la polilínea con que ella la dibuja
    y la letra de cada lado. Eso es un ESQUEMA: las proporciones son de dibujo, no las
    medidas de ninguna barra. Pero la topología —qué lado va dónde, en qué orden y con qué
    ángulo— la declara aSa, y ésa es justamente la parte que `figura_de` tiene que deducir
    de los vectores. Así que donde la reconstrucción no cuadra, el trazo es la mejor fuente
    que queda: se le ponen las medidas de la barra (los lados se llaman igual) y listo.

    POR QUÉ NO SE USA SIEMPRE. Medido sobre las 83 figuras del muestreo que están en el
    RDX: el trazo cuadra con la envolvente en 36 y la reconstrucción en 58. El trazo pierde
    en las figuras con lados curvos, porque la polilínea del RDX guarda el arco como una
    cuerda y estirarla a su largo de arco endereza la curva —`ARC` daba 7.450 × 30 donde
    aSa declara 4.743 × 2.362—; y además no trae los arcos de los ganchos, que la
    reconstrucción sí emite con su radio. Por eso el llamador lo usa de RESPALDO.

    Devuelve `None` si no se puede estirar (falta la medida de algún lado, o el trazo tiene
    más tramos que lados nombrados), y si no, lo mismo que `figura_de` — incluido `ok`
    contra la envolvente declarada, con la misma vara.
    """
    puntos_esquema = (trazo or {}).get("puntos") or []
    lados = (trazo or {}).get("lados") or []
    if len(puntos_esquema) < 2 or len(lados) != len(puntos_esquema) - 1:
        return None
    reales = []
    for lado in lados:
        nombre = str((lado or {}).get("nombre") or "").upper()
        medida = _num((dims or {}).get(nombre))
        # MEDIA FIGURA A ESCALA Y MEDIA EN PROPORCIÓN DE ESQUEMA NO ES NINGUNA DE LAS DOS.
        if medida <= 0:
            return None
        reales.append((nombre, medida, str((lado or {}).get("tipo") or "")))
    puntos = [(0.0, 0.0)]
    tramos = []
    for i, (nombre, medida, _tipo) in enumerate(reales):
        dx = _num(puntos_esquema[i + 1][0]) - _num(puntos_esquema[i][0])
        dy = _num(puntos_esquema[i + 1][1]) - _num(puntos_esquema[i][1])
        d = math.hypot(dx, dy)
        if d <= 0:
            return None
        x, y = puntos[i]
        puntos.append((x + dx / d * medida, y + dy / d * medida))
        tramos.append({"tipo": "recto", "radio": 0, "sweep": None, "lado": nombre,
                       "largo": round(medida), "gancho": False,
                       "desde": i, "hasta": i + 1})

    # LA ENVOLVENTE SE MIDE ANTES DE GIRAR. aSa declara su `mbr` en la orientación en que
    # ella tiene la figura; `_orientar` la gira para que se vea derecha en la pantalla, y si
    # el lado más largo es uno inclinado ese giro es de un ángulo cualquiera, que cambia la
    # caja. Medido en 104X: sin girar da 745 × 370 contra los 783 × 348 que declara aSa
    # —cuadra—, y girada da 695 × 592, que no cuadra con nada.
    pin = _num(pin_diam)
    mbr = envolvente_declarada(legangle)
    medido = _recortar_por_doblado(puntos, pin / 2.0)
    xs = [p[0] for p in medido]
    ys = [p[1] for p in medido]
    ancho, alto = max(xs) - min(xs), max(ys) - min(ys)
    ok, motivo = True, ""
    if mbr and (mbr[0] or mbr[1]):
        def cuadra(a, b):
            for dibujado, declarado in ((a, mbr[0]), (b, mbr[1])):
                if abs(dibujado - declarado) > max(max(declarado, 1.0) * TOLERANCIA, 2 * pin):
                    return False
            return True
        if not (cuadra(ancho, alto) or cuadra(alto, ancho)):
            ok = False
            motivo = ("el trazo de aSa estirado no cuadra: %d × %d, aSa dice %d × %d"
                      % (round(ancho), round(alto), round(mbr[0]), round(mbr[1])))
    else:
        ok, motivo = (ancho > 0 or alto > 0), "sin envolvente para comprobar"
    puntos, tramos, _ = _orientar(puntos, tramos, list(puntos))
    return {"ok": ok, "motivo": motivo, "tridimensional": False, "fuente": "catalogo_asa",
            "puntos": [[round(p[0], 1), round(p[1], 1)] for p in puntos],
            "tramos": tramos, "ancho": round(ancho), "alto": round(alto), "mbr": mbr,
            "radio": None}
