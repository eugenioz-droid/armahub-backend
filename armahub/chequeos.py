# -*- coding: utf-8 -*-
"""REVISIÓN AUTOMÁTICA DE BARRAS (8-oct).

La máquina lee todas las barras de un código de control y levanta la mano donde algo no
calza. No es una auditoría: una auditoría es una muestra al azar que revisa una persona y
deja hallazgos con su nombre. Acá la señal SUGIERE y la persona DECIDE (ver la migración
133 para el ciclo completo de una señal).

CÓMO SE AGREGA UNA REGLA. Se escribe una función pura y se agrega una línea a `REGLAS`.
Nada más: ni el motor, ni el barrido, ni las tablas, ni la pantalla se tocan.

    def r_lo_que_sea(barra, hermanas) -> list[dict]:
        return [{"texto": "...", "lados": ["C"], "clave": ("C", 90)}]

    REGLAS = [... {"codigo": "lo_que_sea", "nombre": "...", "porque": "...",
                   "necesita": ("lados", "diam"), "fn": r_lo_que_sea} ...]

La regla recibe UNA barra normalizada y sus HERMANAS (las otras barras del mismo elemento),
y devuelve una lista de hallazgos —vacía si está conforme—. No toca la base, no sabe de
dónde salió la barra y no calcula su propia firma: de eso se encarga el motor. `necesita`
dice qué campos usa; el motor la salta si la barra no los trae, para que una barra recta no
genere «no se pudo evaluar el estribo».

`clave` es lo que distingue un problema de otro DENTRO de la misma barra, y es también lo
que define el PATRÓN: dos barras distintas con la misma figura, el mismo diámetro y la
misma clave son el mismo problema repetido, y aceptar una acepta todas.
"""
import hashlib
import math
import re
from typing import Optional

from .figura_asa import _legs, envolvente_declarada
from .modelador_config import GANCHO_FABRICACION

# ─────────────────────────────────────────────────────────────────────────────
# LA BARRA NORMALIZADA
# ─────────────────────────────────────────────────────────────────────────────
# Todo en MILÍMETROS. aSa manda mm; ArmaHub guarda los lados en cm y el diámetro en mm, así
# que el día que entre ArmaHub la conversión va acá y no dentro de cada regla: si no, la
# regla «lado < 10φ» hay que escribirla mal una vez por origen.

# Desde qué giro con el lado vecino un tramo terminal es un gancho aunque aSa no lo declare.
# Las familias 105A, 106A y 103B mandan los ganchos de 90° como `STD`, sin marcarlos: medido
# sobre 2.250 barras reales, esas dos barras se colaban en la regla del lado corto.
GIRO_GANCHO = 89.5
# Y HASTA QUÉ LARGO. Un gancho es corto por definición: la planta lo hace a 10φ. Sin este
# tope, la traba 305A —que es un zigzag A·B·C·D·E con los tres lados largos de 300 mm en
# las puntas— daba sus lados de 300 como «ganchos» sólo por ser terminales y doblar 90°.
# No molestaba ahí (300 mm no dispara ninguna regla), pero habría tapado un lado terminal
# corto de verdad. 15φ deja pasar cualquier gancho real y ningún tramo de barra.
GANCHO_MAXIMO_PHI = 15.0


def _num(x, por_defecto=0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return por_defecto


def normalizar_asa(item: dict, ref: str) -> Optional[dict]:
    """Una barra de aSa, lista para las reglas. `ref` es la misma referencia estable que usa
    la auditoría (`refs_de_barras`), para poder cruzar una señal con un hallazgo."""
    legangle = item.get("LegAngle")
    legs, _radio = _legs(legangle, item.get("ShapeDims"))
    if not legs:
        return None
    diam = _diam_mm(item.get("BarSizeDescr"))
    lados = [{"nombre": l["nombre"], "largo": _num(l["largo"]), "tipo": l["tipo"],
              "angulo": l["angulo"], "arco": bool(l["arco"]),
              "declarado_gancho": bool(l["gancho"])}
             for l in legs]
    _clasificar_lados(lados, diam)
    return {
        "origen": "asa", "ref": ref,
        "cc": (item.get("CtrlCode") or "").strip() or None,
        "elemento": (item.get("ElementID") or "").strip() or None,
        "marca": item.get("BarMark"), "figura": (item.get("ShpNameID") or "").strip() or None,
        "diam": diam, "pin": _num(item.get("PinDiam")),
        "largo": _num(item.get("LengthTheor")), "cant": _num(item.get("TotalQty")),
        "lados": lados, "mbr": envolvente_declarada(legangle),
    }


def _diam_mm(texto) -> float:
    """El φ en mm desde el texto de aSa («10mm», «12 mm»)."""
    m = re.search(r"([\d.]+)", str(texto or ""))
    return float(m.group(1)) if m else 0.0


def _clasificar_lados(lados, diam_mm: float) -> None:
    """Marca cada lado como gancho o no. ESTO DECIDE LA REGLA DEL LADO CORTO, así que va
    acá y no dentro de ella.

    Un lado es gancho si aSa lo declara (`H3`, `H9`, …), o si es un tramo TERMINAL, que da
    la vuelta con su vecino y es CORTO. Las tres condiciones hacen falta: sin la segunda,
    los ganchos de 90° de la familia 105A —que aSa manda como `STD`, sin marcar— entran
    como lados cortos siendo correctos; sin la tercera, los tres lados de 300 mm de la
    traba 305A salen de «ganchos» por doblar 90° en la punta."""
    n = len(lados)
    tope = GANCHO_MAXIMO_PHI * diam_mm if diam_mm > 0 else 0.0
    for i, l in enumerate(lados):
        terminal = (i == 0 or i == n - 1)
        # El ángulo que trae un lado es el giro CONTRA EL ANTERIOR; para el primero, el que
        # cuenta es el del segundo.
        giro = lados[1]["angulo"] if (i == 0 and n > 1) else l["angulo"]
        l["gancho"] = bool(l["declarado_gancho"] or
                           (terminal and giro is not None and abs(giro) >= GIRO_GANCHO
                            and tope > 0 and l["largo"] <= tope))


# ─────────────────────────────────────────────────────────────────────────────
# LAS REGLAS
# ─────────────────────────────────────────────────────────────────────────────

def _minimo_fabricacion(diam_mm: float) -> float:
    """El lado más corto que la planta sabe fabricar, en mm. Sale de la configuración del
    gancho —10 veces el diámetro, con piso de 7,5 cm— y NO de una constante propia: si
    mañana ese factor cambia, la regla se mueve con él en vez de quedarse mintiendo."""
    return max(GANCHO_FABRICACION["factor"] * diam_mm, GANCHO_FABRICACION["min"] * 10.0)


def r_lado_corto(barra, hermanas) -> list:
    """UN LADO MÁS CORTO QUE 10 DIÁMETROS. Menos que eso no se dobla ni ancla.

    NINGÚN LADO SE EXCLUYE, TAMPOCO LOS GANCHOS. Lo corrigió el usuario (13-oct): «de qué
    hablas, ningún lado se excluye, el cubicador siempre puede condorearse y digitar algo
    mal». Antes los ganchos quedaban fuera por una precaución mal leída: lo que disparaba
    de más NO era incluirlos, era comparar con «menor o igual». Medido sobre las mismas
    barras: con «menor» estricto, incluir los ganchos pasa de 140 a 161 barras marcadas
    (21 más, el 1,6 por ciento); con «menor o igual» salta a 319. Son dos cosas distintas
    y sólo una era el problema.

    LA COMPARACIÓN SIGUE SIENDO ESTRICTA, y eso no se toca: Armacero fabrica el gancho a
    10φ EXACTOS, o sea justo en el límite. 78 ganchos miden exactamente 10 diámetros y
    están bien."""
    diam = barra["diam"]
    if diam <= 0:
        return []
    minimo = _minimo_fabricacion(diam)
    salida = []
    for l in barra["lados"]:
        if l["arco"] or l["largo"] <= 0:
            continue
        if l["largo"] < minimo - 0.01:          # estricto: 10φ justo NO es un error
            salida.append({
                "texto": "el %s %s mide %d mm y el mínimo de fabricación es %d (10 × φ%g)"
                         % ("gancho" if l["gancho"] else "lado", l["nombre"],
                            round(l["largo"]), round(minimo), diam),
                "lados": [l["nombre"]],
                "valor": round(l["largo"]), "esperado": round(minimo),
                "clave": (l["nombre"], round(l["largo"])),
            })
    return salida


def _es_estribo(barra) -> bool:
    """Un estribo: lleva gancho sísmico de 135° o cierra sobre sí mismo."""
    if any(l["tipo"] == "H3" for l in barra["lados"]):
        return True
    giros = [abs(l["angulo"] or 0) for l in barra["lados"][1:]]
    return len(barra["lados"]) >= 4 and 340 <= sum(giros) <= 380


# CERO. Los lados opuestos de un estribo tienen que medir lo MISMO, y lo fijó el usuario
# así: «de dónde sacas los 5 mm, deben ser idénticos». Medido: no cambia nada respecto de
# una tolerancia de 5 mm —no existe ninguna barra con los opuestos a menos de 5 mm de
# diferencia— con lo que tolerar algo sólo servía para dejar pasar un error de verdad.
TOLERANCIA_OPUESTOS = 0.0


def _marco(barra) -> list:
    """Los cuatro lados del estribo rectangular, en orden, o lista vacía si la figura no
    es un estribo cerrado.

    QUÉ SEPARA UN ESTRIBO DE UNA C, que es todo el problema de esta regla. Una 105A o una
    J71 —un tramo largo con dos patas— gira noventa grados tres veces igual que un
    estribo, y sus patas SON paralelas al tramo largo. Compararlas marca la barra entera
    siendo correcta: eran 25 de 146 casos, y después 27 de 29.

    Lo que lo separa es EL GANCHO EN LOS DOS EXTREMOS. Un estribo cierra sobre sí mismo y
    por eso lleva gancho al principio y al final, con sus cuatro lados en medio; una C
    tiene gancho en una punta y la otra termina en un tramo recto. Medido sobre 1.392
    barras reales: pasan 87, y todas son T1, que es el estribo. Sin lista de figuras.

    SE PROBÓ ANTES con «el contorno cierra» y no alcanzaba: una C de 950 y 700 cierra con
    un hueco del 26 por ciento del lado mayor, y cualquier umbral que la deje fuera deja
    fuera también al estribo con un lado muy mal tipeado, que es lo que se busca."""
    ls = barra["lados"]
    if len(ls) < 6 or not ls[0]["gancho"] or not ls[-1]["gancho"]:
        return []
    medio = [l for l in ls[1:-1]
             if not l["gancho"] and not l["arco"] and l["largo"] > 0]
    if len(medio) != 4:
        return []
    giros = [_num(l["angulo"]) for l in medio[1:]]
    if any(abs(abs(g) - 90.0) > 15.0 for g in giros):
        return []
    # Una Z gira para los dos lados y no es un marco, aunque sus tramos sean paralelos.
    if not (all(g > 0 for g in giros) or all(g < 0 for g in giros)):
        return []
    return medio


def r_lados_opuestos(barra, hermanas) -> list:
    """LOS LADOS OPUESTOS DE UN ESTRIBO TIENEN QUE MEDIR LO MISMO. Si no, hay una medida
    tipeada mal.

    Lo fijó el usuario (13-oct): «la revisión consiste en comparar los lados que son
    paralelos para esa figura; si un lado paralelo al otro es distinto, debiera mostrar
    hallazgo».

    QUÉ REEMPLAZA Y POR QUÉ. Antes acá se marcaba el estribo CUADRADO, con la idea de que
    un cuadrado suele ser la misma medida tipeada dos veces. Era falso: un estribo de
    56 × 56 es un pilar cuadrado y está bien. En la primera revisión de verdad levantó 43
    barras y el usuario trajo tres —SUSW 10mmA26, SUSW 10mmA29 y SUQ8 8mmA51, de 560, 710
    y 160 por lado— que estaban correctas. Lo que importa no es que sea cuadrado: es que
    los dos lados que se miran de frente midan igual.

    MEDIDO SOBRE BARRAS REALES: de 1.392 barras hay 87 estribos cerrados y esto marca UNO,
    la 12mmA14 de SUR8, con 240 contra 270. La definición anterior marcaba 43, casi todas
    correctas. Los tres estribos que el usuario trajo quedan limpios."""
    m = _marco(barra)
    if not m:
        return []
    salida = []
    for i in (0, 1):
        a, b = m[i], m[i + 2]
        dif = abs(a["largo"] - b["largo"])
        if dif <= TOLERANCIA_OPUESTOS + 0.01:   # +0.01: el redondeo de los flotantes
            continue
        salida.append({
            "texto": "los lados %s y %s se miran de frente y miden distinto: %d y %d mm "
                     "(%d de diferencia)" % (a["nombre"], b["nombre"], round(a["largo"]),
                                             round(b["largo"]), round(dif)),
            "lados": [a["nombre"], b["nombre"]],
            "valor": round(a["largo"]), "esperado": round(b["largo"]),
            "clave": ("opuestos", a["nombre"], b["nombre"],
                      round(a["largo"]), round(b["largo"])),
        })
    return salida


REGLAS = [
    {"codigo": "lado_corto",
     # El nombre corto es para los encabezados de tabla. Lo declara la regla y no lo recorta
     # la pantalla: cortar «Lado más corto que 10 diámetros» por las dos primeras palabras
     # daba «Lado más», que no quiere decir nada.
     "corto": "Lado corto",
     "nombre": "Lado más corto que 10 diámetros",
     "porque": "La planta dobla a 10 veces el diámetro. Menos que eso no se puede fabricar "
               "ni anclar. Los ganchos no cuentan: son cortos por norma.",
     "necesita": ("lados", "diam"),
     "fn": r_lado_corto},
    {"codigo": "lados_opuestos",
     "corto": "Lados opuestos",
     "nombre": "Lados opuestos del estribo con medidas distintas",
     "porque": "En un estribo rectangular los dos lados que se miran de frente tienen que "
               "medir lo mismo. Si no, hay una medida tipeada mal.",
     "necesita": ("lados",),
     "fn": r_lados_opuestos},
]

REGLAS_POR_CODIGO = {r["codigo"]: r for r in REGLAS}


def _tiene(barra, campos) -> bool:
    for c in campos:
        if c == "lados" and not barra.get("lados"):
            return False
        if c == "diam" and not barra.get("diam"):
            return False
        if c == "mbr" and not barra.get("mbr"):
            return False
    return True


def _firma(*partes) -> str:
    return hashlib.sha1("|".join(str(p) for p in partes).encode("utf-8")).hexdigest()


def correr(barras, reglas=None) -> list:
    """El motor. Corre cada regla sobre cada barra y devuelve las señales con sus dos firmas.

    No sabe nada de ninguna regla en particular, no toca la base y es una función pura: con
    las mismas barras devuelve siempre lo mismo, que es lo que deja probarlo sin red."""
    reglas = reglas or REGLAS
    # Las hermanas son las otras barras del MISMO elemento: es la comparación que distingue
    # un estribo cuadrado de diseño de uno tipeado mal.
    por_elemento = {}
    for b in barras:
        por_elemento.setdefault(b.get("elemento") or "", []).append(b)
    salida = []
    for b in barras:
        hermanas = por_elemento.get(b.get("elemento") or "", [])
        for r in reglas:
            if not _tiene(b, r["necesita"]):
                continue
            for h in (r["fn"](b, hermanas) or []):
                clave = h.get("clave") or ()
                salida.append({
                    "regla": r["codigo"], "ref": b["ref"], "cc": b.get("cc"),
                    "elemento": b.get("elemento"), "marca": b.get("marca"),
                    "figura": b.get("figura"), "diam": b.get("diam"),
                    "detalle": {"texto": h.get("texto"), "lados": h.get("lados") or [],
                                "valor": h.get("valor"), "esperado": h.get("esperado")},
                    # Esta barra de este código. Con ella, revisar dos veces no duplica.
                    "firma": _firma(r["codigo"], b.get("cc"), b.get("elemento"), b["ref"], *clave),
                    # La FORMA del problema, sin la barra ni el código: aceptar una apaga
                    # todas las iguales de la obra.
                    "firma_patron": _firma(r["codigo"], b.get("figura"), b.get("diam"), *clave),
                })
    return salida
