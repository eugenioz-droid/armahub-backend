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

    LOS GANCHOS QUEDAN FUERA, y no por prolijidad: Armacero los fabrica a 10φ EXACTOS, o sea
    justo en el límite de la regla. Medido sobre 2.250 barras reales: 78 ganchos miden
    exactamente 10 diámetros. Comparar con «menor o igual» en vez de «menor» llevaría la
    regla de 40 a 184 lados señalados, casi todos correctos."""
    diam = barra["diam"]
    if diam <= 0:
        return []
    minimo = _minimo_fabricacion(diam)
    salida = []
    for l in barra["lados"]:
        if l["gancho"] or l["arco"] or l["largo"] <= 0:
            continue
        if l["largo"] < minimo - 0.01:          # estricto: 10φ justo NO es un error
            salida.append({
                "texto": "el lado %s mide %d mm y el mínimo de fabricación es %d (10 × φ%g)"
                         % (l["nombre"], round(l["largo"]), round(minimo), diam),
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


def r_estribo_cuadrado(barra, hermanas) -> list:
    """UN ESTRIBO CUADRADO ENTRE HERMANOS QUE NO LO SON. Suele ser una medida tipeada dos
    veces.

    POR QUÉ ASÍ Y NO «DOS LADOS IGUALES». Medido sobre 2.250 barras: «dos lados opuestos
    iguales» dispara en el 53 al 98 por ciento de los estribos, porque eso es la definición
    de un rectángulo. Lo que sí separa es el RECUADRO EXTERIOR que declara aSa: cuadrado
    exacto en 10 de 279 estribos. Y como un pilar de 20 × 20 existe y es correcto, lo que
    de verdad baja el falso positivo es compararlo con los OTROS estribos del mismo
    elemento: si los demás son 160 × 400 y éste es 160 × 160, no es un pilar cuadrado, es
    una digitación. Si no hay con quién comparar, la señal se levanta igual pero lo dice."""
    mbr = barra.get("mbr")
    if not mbr or not _es_estribo(barra):
        return []
    x, y = _num(mbr[0]), _num(mbr[1])
    if x <= 0 or y <= 0 or abs(x - y) > 0.5:
        return []
    otros = [h for h in hermanas
             if h["ref"] != barra["ref"] and _es_estribo(h) and h.get("mbr")
             and _num(h["mbr"][0]) > 0 and _num(h["mbr"][1]) > 0]
    cuadrados = [h for h in otros if abs(_num(h["mbr"][0]) - _num(h["mbr"][1])) <= 0.5]
    if otros and len(cuadrados) == len(otros):
        return []            # todos los estribos del elemento son cuadrados: es el diseño
    detalle = "el estribo mide %d × %d: cuadrado" % (round(x), round(y))
    if otros:
        ej = otros[0]
        detalle += ", y los otros %d estribos del elemento no lo son (%s es %d × %d)" % (
            len(otros), ej["ref"], round(_num(ej["mbr"][0])), round(_num(ej["mbr"][1])))
    else:
        detalle += "; es el único estribo del elemento, así que no hay con qué compararlo"
    return [{"texto": detalle, "lados": [], "valor": round(x), "esperado": None,
             "clave": ("mbr", round(x), round(y))}]


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
    {"codigo": "estribo_cuadrado",
     "corto": "Estribo cuadrado",
     "nombre": "Estribo cuadrado entre hermanos que no lo son",
     "porque": "Un estribo cuadrado suele ser la misma medida tipeada dos veces. A veces es "
               "correcto —un pilar cuadrado existe—, por eso se compara con los otros "
               "estribos del mismo elemento.",
     "necesita": ("lados", "mbr"),
     "fn": r_estribo_cuadrado},
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
