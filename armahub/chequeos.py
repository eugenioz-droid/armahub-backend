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

from .figura_asa import (GANCHO_MAXIMO_PHI, _direcciones, _giro, _legs, envolvente_declarada,
                         figura_de_lados, figura_espacial_de_lados)
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
# corto de verdad. 15φ deja pasar cualquier gancho real y ningún tramo de barra. El número
# vive en figura_asa (GANCHO_MAXIMO_PHI), que lo usa para DIBUJAR esos mismos ganchos que
# aSa no marca: se escribe una vez.


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
    # El vector de cada lado viaja con él: hay barras que aSa manda sin el ángulo en el XML
    # y sólo con vectores, y una regla que necesite el giro lo saca de ahí (ver
    # altura_en_camion).
    lados = [{"nombre": l["nombre"], "largo": _num(l["largo"]), "tipo": l["tipo"],
              "angulo": l["angulo"], "arco": bool(l["arco"]),
              "declarado_gancho": bool(l["gancho"]),
              "vx": l.get("vx", 0.0), "vy": l.get("vy", 0.0),
              # El radio y el barrido de un lado curvo: con ellos se mide la altura del
              # arco (regla del camión para los radios).
              "radio": l.get("radio"), "barrido": l.get("barrido")}
             for l in legs]
    _clasificar_lados(lados, diam)
    return {
        "origen": "asa", "ref": ref,
        "cc": (item.get("CtrlCode") or "").strip() or None,
        "elemento": (item.get("ElementID") or "").strip() or None,
        "marca": item.get("BarMark"), "figura": (item.get("ShpNameID") or "").strip() or None,
        # LA TIPOLOGÍA, que en aSa va en `Notes`: MH, MV, TR, CB… La escribe el cubicador
        # a mano y NO está normalizada —para lo mismo conviven MH/HORIZ/HOR— así que se
        # guarda cruda y se interpreta en `tipologia_de`, que es donde vive el diccionario.
        "tipologia": (item.get("Notes") or "").strip() or None,
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

# ─────────────────────────────────────────────────────────────────────────────
# LA TIPOLOGÍA DE UNA BARRA
# ─────────────────────────────────────────────────────────────────────────────
# Vive en `Notes` y la escribe una persona, así que para lo mismo conviven varias formas.
# Medido sobre barras reales: MH / HORIZ / HOR, MV / VERT / VRT, TR / TRABA, CB / CAB,
# ESTR / ESTRIBO. El usuario lo confirmó: «tipologías en cubicaciones manuales están
# normalizadas de palabra, o sea el usuario si se acuerda lo hace bien, entonces tendríamos
# que buscar matches».
#
# Se busca la palabra COMPLETA, no el trozo: sin eso «TRABA MURO» entra por TR (bien) pero
# también cualquier texto que contenga esas dos letras pegadas a otra cosa.
TIPOLOGIAS = {
    "horizontal": ("MH", "HORIZ", "HOR"),
    "vertical":   ("MV", "VERT", "VRT"),
    "traba":      ("TR", "TRABA"),
    "cabezal":    ("CB", "CAB"),
    "estribo":    ("ESTR", "ESTRIBO"),
    "confinam":   ("CONF",),
}


def tipologia_de(texto) -> Optional[str]:
    """Qué es la barra, según lo que escribió quien cubicó. None si no se reconoce: eso
    NO es un error —hay tipologías que no son de muro— y por eso no se marca nada."""
    u = (texto or "").upper()
    if not u.strip():
        return None
    for clave, alias in TIPOLOGIAS.items():
        for a in alias:
            if re.search(r"\b" + a + r"\b", u):
                return clave
    return None


def _y(xs) -> str:
    """«A», «A y B», «A, B y C». Para que un hallazgo de tres lados se lea como una frase
    y no como «A y B y C»."""
    xs = [str(x) for x in xs]
    if len(xs) <= 1:
        return xs[0] if xs else ""
    return ", ".join(xs[:-1]) + " y " + xs[-1]


def _minimo_fabricacion(diam_mm: float) -> float:
    """El lado más corto que la planta sabe fabricar, en mm. Sale de la configuración del
    gancho —10 veces el diámetro, con piso de 7,5 cm— y NO de una constante propia: si
    mañana ese factor cambia, la regla se mueve con él en vez de quedarse mintiendo."""
    return max(GANCHO_FABRICACION["factor"] * diam_mm, GANCHO_FABRICACION["min"] * 10.0)


# LAS ALTURAS DE LOS SOPORTES DE LOSA TIENEN SU PROPIA REGLA (11-nov). Las «patas de losa»
# —figuras 26 y 305A, las sillas tridimensionales— se doblan en un SEGUNDO PROCESO, con bulón
# no normado, y por eso sus alturas pueden bajar del mínimo de 10φ. Producción lo dejó escrito (correo del
# 25-ago-2025): «8mm → altura mínima 6cm, 10mm → 8cm, 12mm → 10cm… como la pata losa no es un
# elemento estructural no debería haber problemas». El usuario: «las patas de losa en general
# tienen un segundo proceso y sí permiten mínimos de doblado menores a 10 veces el diámetro».
#
# SÓLO LAS ALTURAS, Y SÓLO ESOS TRES φ. Los demás lados de la silla siguen con 10φ, y un φ16
# también. Las alturas son lados FIJOS de cada figura —en aSa van por el eje Y—: C y E en la
# 26 (B, D y F son el apoyo y el travesaño), B y D en la 305A. Medido al crearla: las 63
# señales de lado corto que hubo en esas dos figuras eran todas esas alturas, todas dentro
# de la tabla, y todas se aceptaron a mano con «corresponde a soportes de losa».
#
# UNA REGLA POR FIGURA, NO UNA EXCEPCIÓN DENTRO DEL LADO CORTO. Nació como excepción, y el
# usuario, viéndola en el menú: «que quedará entonces en el listado de reglas? una excepción
# indicada? o una regla de que aplica respecto de esa figura? me suena lo segundo». Como la
# del suple 105A: tiene su dibujo, y cuando salta la señal dice qué regla es en vez de un
# «lado corto» con asterisco. El lado corto deja esas alturas a esta regla y nada más.
#
# En los textos visibles se dice «soporte de losa» (la tipología SP del catálogo) y no «pata
# de losa»: el usuario pidió no usar «pata» (ver test_chequeos §12).
ALTURA_MINIMA_SOPORTE_LOSA = {8.0: 60.0, 10.0: 80.0, 12.0: 100.0}     # φ mm → altura mínima mm
ALTURAS_SOPORTE_LOSA = {"26": ("C", "E"), "305A": ("B", "D")}       # figura → lados que son altura


def _alturas_soporte_losa(barra) -> tuple:
    """Los lados que son altura de soporte de losa en ESTA barra, o () si no le toca la
    regla: otra figura, u otro diámetro (un φ16 sigue con 10φ)."""
    if barra["diam"] not in ALTURA_MINIMA_SOPORTE_LOSA:
        return ()
    return ALTURAS_SOPORTE_LOSA.get((barra.get("figura") or "").strip().upper(), ())


def r_altura_soporte_losa(barra, hermanas) -> list:
    """UNA ALTURA DE SOPORTE DE LOSA BAJO EL MÍNIMO DE PRODUCCIÓN: 6 cm en φ8, 8 en φ10, 10 en
    φ12. Medido al crearla, sobre las 152 sillas de los 44 códigos que tuvieron señales en
    estas figuras: no salta ninguna. Las que saltaban eran del lado corto, a 10φ."""
    alturas = _alturas_soporte_losa(barra)
    if not alturas:
        return []
    minimo = ALTURA_MINIMA_SOPORTE_LOSA[barra["diam"]]
    cortos = [l for l in barra["lados"]
              if l["nombre"] in alturas and not l["arco"] and 0 < l["largo"] < minimo - 0.01]
    if not cortos:
        return []
    partes = ["%s (%d)" % (l["nombre"], round(l["largo"])) for l in cortos]
    nombres = [l["nombre"] for l in cortos]
    peor = min(l["largo"] for l in cortos)
    return [{
        "texto": ("%s %s menos que el mínimo de un soporte de losa en φ%g, %d mm"
                  % (("la altura " + partes[0]) if len(partes) == 1 else ("las alturas " + _y(partes)),
                     "mide" if len(partes) == 1 else "miden", barra["diam"], round(minimo))),
        "lados": nombres,
        "valor": round(peor), "esperado": round(minimo),
        "clave": tuple(sorted(nombres)) + (round(peor),),
    }]


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
    # Las alturas de un soporte de losa en φ8, φ10 y φ12 las revisa su propia regla, con el
    # mínimo de Producción (r_altura_soporte_losa). Todos los demás lados, acá.
    alturas = _alturas_soporte_losa(barra)
    cortos = [l for l in barra["lados"]
              if not l["arco"] and l["largo"] > 0 and l["largo"] < minimo - 0.01
              and l["nombre"] not in alturas]
    if not cortos:
        return []
    # UNA BARRA ES UN HALLAZGO, aunque le fallen tres lados. Lo pidió el usuario (14-oct)
    # viendo la misma barra dos veces en la lista, una por cada lado: «aunque sean 2 cosas
    # para una barra, creo que es mejor dejarlo como un único hallazgo».
    #
    # Y no es sólo contar: quien corrige abre el código UNA vez y arregla la barra entera.
    # Dos filas para la misma barra son dos veces el mismo trabajo, y la fila sólo sabía
    # pintar SU lado, así que un lado igual de malo quedaba sin marcar al lado del otro.
    # Medido sobre las 482 señales que había: son 324 barras, y 157 tenían más de una.
    nombres = [l["nombre"] for l in cortos]
    if len(cortos) == 1:
        l = cortos[0]
        texto = ("el %s %s mide %d mm y el mínimo de fabricación es %d (%g × φ%g)"
                 % ("gancho" if l["gancho"] else "lado", l["nombre"],
                    round(l["largo"]), round(minimo), GANCHO_FABRICACION["factor"], diam))
    else:
        # Cada lado con SU medida al lado: «A (90) y E (90)» se lee; «A y E miden 90 y 90»
        # obliga a emparejar dos listas de memoria, y con tres lados ya no se puede.
        texto = ("los lados %s miden menos que el mínimo de fabricación, %d mm (%g × φ%g)"
                 % (_y(["%s (%d)" % (l["nombre"], round(l["largo"])) for l in cortos]),
                    round(minimo), GANCHO_FABRICACION["factor"], diam))
    return [{
        "texto": texto,
        "lados": nombres,
        # El valor que se muestra es el PEOR: es el que decide cuán lejos está la barra.
        "valor": round(min(l["largo"] for l in cortos)), "esperado": round(minimo),
        # La firma lleva los lados ORDENADOS, para que no dependa del orden en que aSa
        # los mande: si no, la misma barra generaría señales distintas entre corridas.
        "clave": tuple(sorted(nombres)) + (round(min(l["largo"] for l in cortos)),),
    }]


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
    pares = []
    for i in (0, 1):
        a, b = m[i], m[i + 2]
        dif = abs(a["largo"] - b["largo"])
        if dif > TOLERANCIA_OPUESTOS + 0.01:    # +0.01: el redondeo de los flotantes
            pares.append((a, b, dif))
    if not pares:
        return []
    # UN ESTRIBO ES UN HALLAZGO, aunque le fallen los dos pares. Mismo criterio que el
    # lado corto: quien corrige abre el código una vez y arregla la barra entera.
    texto = " · ".join(
        "%s y %s se miran de frente y miden distinto: %d y %d mm (%d de diferencia)"
        % (a["nombre"], b["nombre"], round(a["largo"]), round(b["largo"]), round(d))
        for a, b, d in pares)
    lados = [x["nombre"] for a, b, _ in pares for x in (a, b)]
    a0, b0, _ = pares[0]
    return [{
        "texto": ("los lados " if len(pares) == 1 else "") + texto,
        "lados": lados,
        "valor": round(a0["largo"]), "esperado": round(b0["largo"]),
        "clave": ("opuestos",) + tuple(sorted(lados)) +
                 tuple(round(x["largo"]) for a, b, _ in pares for x in (a, b)),
    }]


# El diámetro desde el que un cabezal es lo habitual. Por debajo NO es necesariamente un
# error —el usuario: «12 es legítimo en algunos casos, pero es más inusual»— y por eso la
# señal se levanta para que alguien lo mire, no para afirmar que está mal.
# φ12 YA NO SE MARCA (28-oct). Arrancó en 16 y la revisión marcó 163 cabezales de φ12
# contra 21 de φ8 y φ10: el usuario, «los cabezales de 12 son súper comunes, mejor que el
# hallazgo se enfoque en los de 10 y 8». Un cabezal de φ12 es lo habitual; el aviso es para
# φ10 y φ8, que sí llaman la atención. Los φ12 que YA saltaron se quedan como están —el
# usuario: «no migres los que ya saltaron, que aplique de aquí para adelante»—: cada uno
# lo resuelve quien lo tiene, con «No aplica» si corresponde.
CABEZAL_DIAM_MINIMO = 12.0


def r_cabezal_delgado(barra, hermanas) -> list:
    """UN CABEZAL CON φ12 O MENOS. Es inusual y conviene mirarlo.

    Lo pidió el usuario: «revisar si tenemos cabezales con diámetros 8, 10 o 12… podría
    aplicar a vigas, muros y elementos en general que tengan el texto CB en la tipología».

    LA TIPOLOGÍA LA ESCRIBE UNA PERSONA y no está normalizada: `CB`, `Cb`, `CAB`, `CAB
    SUP`. El diccionario vive en `tipologia_de` y no acá, para que la regla que venga
    mañana no tenga que repetirlo.

    MEDIDO sobre 475 cabezales reales: 124 están en φ12 o menos, y 117 de ésos son φ12. Es
    demasiado para ser todo error, y por eso esto no afirma que esté mal: dice que hay que
    mirarlo. Lo que hace que no sea ruido es poder dejarlo sin efecto DE A MUCHOS, con una
    sola explicación, que es como el usuario pidió resolverlo."""
    if tipologia_de(barra.get("tipologia")) != "cabezal":
        return []
    diam = barra.get("diam") or 0
    if diam <= 0 or diam >= CABEZAL_DIAM_MINIMO:
        return []
    return [{
        "texto": "es un cabezal de φ%g, y lo habitual es φ%g o más" % (diam, CABEZAL_DIAM_MINIMO),
        "lados": [],
        "valor": diam, "esperado": CABEZAL_DIAM_MINIMO,
        "clave": ("cabezal", diam),
    }]


# ─────────────────────────────────────────────────────────────────────────────
# LAS PATAS DEL SUPLE (10-nov)
# ─────────────────────────────────────────────────────────────────────────────
# UN CENTÍMETRO, QUE ES COMO SE CUBICA. El usuario: «para la tolerancia estamos hablando
# de 1 cm, que es como se cubica (no al milímetro)». Las patas se tipean en centímetros,
# así que hasta 1 cm de diferencia no es una pata distinta; desde 2 cm, sí.
TOLERANCIA_PATAS_SUPLE = 10.0
# REGLA POR FIGURA, y es a propósito. El usuario: «esa regla es para esa figura, es
# inevitable que vamos a tener que ir definiendo reglas para figuras específicas». Las
# reglas de arriba miran la FORMA (gancho en las dos puntas, cuatro lados en medio); ésta
# mira el CÓDIGO de la figura, porque lo que la justifica no es la geometría sino para qué
# se usa la barra. Si mañana otra figura es un suple, se agrega acá.
FIGURAS_SUPLE = ("105A",)


def r_patas_suple(barra, hermanas) -> list:
    """LAS DOS PATAS DEL SUPLE TIENEN QUE MEDIR LO MISMO. El suple (105A: pie A, pata B,
    lomo C, pata D, pie E) va dentro de una losa, y la losa tiene un solo espesor: B y D,
    las patas perpendiculares al lomo, miden lo mismo. Los pies A y E sí pueden ser
    distintos, por eso no se comparan.

    EL CASO: SVN7 (EMM La Quebrada, «31.5 Corona suples»), 8mmA34, 8mmA36 y 12mmA8 con
    D = 130 contra B de 200, 230 y 170. La revisión los miró la noche anterior y no dijo
    nada: la regla de los lados opuestos deja fuera la 105A a propósito —sus pies son
    desiguales— y con los pies se iban también las patas. Y las mismas diez barras
    estaban en SU5D, el piso anterior, ya despachado: SVN7 era su copia."""
    if (barra.get("figura") or "").strip().upper() not in FIGURAS_SUPLE:
        return []
    por_nombre = {l["nombre"]: l for l in barra["lados"]}
    b, d = por_nombre.get("B"), por_nombre.get("D")
    if not b or not d or b["largo"] <= 0 or d["largo"] <= 0:
        return []
    dif = abs(b["largo"] - d["largo"])
    if dif <= TOLERANCIA_PATAS_SUPLE + 0.01:
        return []
    return [{
        "texto": ("B y D miden distinto: %d y %d mm (%d de diferencia), y la losa en que va el "
                  "suple tiene un solo espesor"
                  % (round(b["largo"]), round(d["largo"]), round(dif))),
        "lados": ["B", "D"],
        "valor": round(b["largo"]), "esperado": round(d["largo"]),
        "clave": ("patas", round(b["largo"]), round(d["largo"])),
    }]


# ─────────────────────────────────────────────────────────────────────────────
# NO CABE EN EL CAMIÓN (10-nov)
# ─────────────────────────────────────────────────────────────────────────────
# El camión lleva 250 cm de ancho. Una barra de dos lados se carga acostada y en diagonal: la
# línea entre sus dos puntas va a lo largo del camión, y lo que ocupa a lo ancho es la ALTURA
# DEL TRIÁNGULO que forman sus dos lados sobre esa línea. Es la forma más angosta de cargarla
# (la altura sobre el lado más largo es la menor de las tres), así que si eso no cabe, no
# cabe de ninguna manera. Lo fijó el usuario: «si lo vemos como un triángulo, la altura no
# sobrepase esa medida».
#
# POR GEOMETRÍA Y NO POR CÓDIGO. Entran la 102A, la 102B y la 102C —las del catálogo propio
# siempre traen sus dos lados— y las figuras de aSa que quedan con dos lados cuando sus lados
# opcionales van vacíos: el corchete «2» sin el gancho G (la figura más usada de aSa), J71,
# AA1, 17, 4, 6, 14, 29, 30… Una lista de códigos dejaría pasar la próxima forma de armar la
# misma L. Los lados vacíos ya no llegan: `_legs` descarta los de largo cero.
#
# SÓLO DOS LADOS, a pedido del usuario: «las reglas para figuras de más lados las iremos
# implementando de a poco». La otra lectura —el lado corto atravesado en el camión, con el
# largo a lo largo— es OTRA regla, para la 103A y otras, y no es ésta.
#
# MEDIDO al crearla, sobre los 160 códigos revisados en 30 días: de 1.558 barras de dos lados
# no salta ninguna (la más ancha, SVOA 8mmA159, una L de 160 × 402, ocupa 149 cm). Es una
# barrera: la altura siempre es menor que el lado corto, así que sólo puede saltar una barra
# con sus dos lados sobre 250 cm. Se mide con las medidas cubicadas, hasta el vértice: el
# doblez real redondea la esquina y ocupa unos centímetros menos, o sea que erra hacia el
# lado seguro.
ANCHO_CAMION = 2500.0


def altura_en_camion(lados) -> Optional[float]:
    """Lo que ocupa a lo ancho una barra de DOS lados rectos acostada en diagonal, en mm: la
    altura del triángulo sobre la línea entre sus puntas. None si no es de dos lados rectos
    o si falta el ángulo. El ángulo de aSa es el GIRO contra el lado anterior (90 en la
    102A, 135 en la 102C, 45 en la 102B), así que la diagonal es √(a² + b² + 2ab·cos giro)
    y el doble del área, a·b·sen giro."""
    ls = [l for l in (lados or []) if l["largo"] > 0]
    if len(ls) != 2 or any(l["arco"] for l in ls):
        return None
    giros = _giros_de(ls)
    if giros is None:
        return None
    giro = giros[0]
    a, b = ls[0]["largo"], ls[1]["largo"]
    g = math.radians(abs(float(giro)))
    c = math.sqrt(max(0.0, a * a + b * b + 2 * a * b * math.cos(g)))
    return (a * b * abs(math.sin(g)) / c) if c > 1e-9 else 0.0


def _giros_de(ls) -> Optional[list]:
    """El giro de cada doblez (lado i contra el i-1), en grados con signo. Del ángulo que
    trae el XML; si falta alguno (3 de 1.558 barras reales: SU25 12mmA129, SU4K 8mmA56,
    SVKZ 16mmA11), de los vectores de ShapeDims con la misma función que los dibuja. None
    si no hay cómo saberlo."""
    if all(l["angulo"] is not None for l in ls[1:]):
        return [float(l["angulo"]) for l in ls[1:]]
    if not all(l.get("vx") or l.get("vy") for l in ls):
        return None
    d = _direcciones([dict(l, vz=0.0) for l in ls])
    if any(x is None for x in d):
        return None
    return [_giro(d[i - 1], d[i]) for i in range(1, len(ls))]


def _vertices(ls, giros) -> list:
    """Los vértices de una figura de lados rectos, sin codos: parte horizontal y gira lo que
    dice cada doblez. Basta para medir anchos (el doblez real redondea las esquinas y ocupa
    unos centímetros menos: erra hacia el lado seguro)."""
    d, p = (1.0, 0.0), [(0.0, 0.0)]
    for i, l in enumerate(ls):
        if i > 0:
            g = math.radians(giros[i - 1])
            d = (d[0] * math.cos(g) - d[1] * math.sin(g), d[0] * math.sin(g) + d[1] * math.cos(g))
        p.append((p[-1][0] + d[0] * l["largo"], p[-1][1] + d[1] * l["largo"]))
    return p


def r_no_cabe_camion(barra, hermanas) -> list:
    """UNA BARRA DE DOS LADOS QUE NO CABE EN EL CAMIÓN. Ver arriba: la altura del triángulo
    sobre la diagonal pasa de 250 cm."""
    h = altura_en_camion(barra["lados"])
    if h is None or h <= ANCHO_CAMION + 0.01:
        return []
    a, b = [l for l in barra["lados"] if l["largo"] > 0]
    return [{
        "texto": ("acostada en diagonal ocupa %d cm de ancho y el camión lleva %d: con %s = %d y "
                  "%s = %d cm no cabe" % (round(h / 10.0), round(ANCHO_CAMION / 10.0), a["nombre"],
                                          round(a["largo"] / 10.0), b["nombre"], round(b["largo"] / 10.0))),
        "lados": [a["nombre"], b["nombre"]],
        "valor": round(h), "esperado": round(ANCHO_CAMION),
        "clave": ("camion", round(a["largo"]), round(b["largo"])),
    }]


# ─────────────────────────────────────────────────────────────────────────────
# NO CABE EN EL CAMIÓN: TRES LADOS A 90° (11-nov)
# ─────────────────────────────────────────────────────────────────────────────
# El usuario: «para todas las figuras de 3 lados con ángulos de 90, la pata no puede ser
# mayor a 250 (esa es otra de no cabe en el camión)». Es otra regla, no la de dos lados.
#
# LA PATA ES LA QUE VA ATRAVESADA. La figura se carga con su lado más largo a lo largo del
# camión, y lo que ocupa a lo ancho es lo que sobresale perpendicular a ese lado. En la U de
# siempre (103A con el cuerpo B largo) eso es la pata más larga: la regla del usuario tal
# cual. Pero medida al pie de la letra —A y C por su posición— saltaba en 227 barras de 160
# códigos, TODAS horquillas: U de patas largas y cuerpo corto, como SVNT 8mmA1 (103A, 84 ×
# 14 × 922 cm), que van con las patas a lo largo y ocupan los 14 cm del cuerpo. Midiendo
# perpendicular al lado más largo, las 1.528 barras de tres lados a 90° de la muestra caben
# (la más ancha, 120 cm). En una Z las dos patas salen a lados opuestos y el ancho es la
# suma: dos patas de 200 ocupan 400.
#
# A 90° quiere decir los dos dobleces a 90° ± 2°: aSa manda 89,998.
GIRO_RECTO_TOL = 2.0


def ancho_tres_lados(lados) -> Optional[dict]:
    """Lo que ocupa a lo ancho una barra de TRES lados rectos con los dos dobleces a 90°,
    cargada con su lado más largo a lo largo del camión. None si no es de esa familia.
    Devuelve {ancho (mm), largo (el lado a lo largo), atraviesan (los lados perpendiculares
    a él, que son los que ocupan el ancho)}."""
    ls = [l for l in (lados or []) if l["largo"] > 0]
    if len(ls) != 3 or any(l["arco"] for l in ls):
        return None
    giros = _giros_de(ls)
    if giros is None or any(abs(abs(g) - 90.0) > GIRO_RECTO_TOL for g in giros):
        return None
    p = _vertices(ls, giros)
    k = max(range(3), key=lambda i: ls[i]["largo"])
    ux, uy = (p[k + 1][0] - p[k][0]) / ls[k]["largo"], (p[k + 1][1] - p[k][1]) / ls[k]["largo"]
    s = [-uy * (q[0] - p[k][0]) + ux * (q[1] - p[k][1]) for q in p]
    atraviesan = [ls[0]["nombre"], ls[2]["nombre"]] if k == 1 else [ls[1]["nombre"]]
    return {"ancho": max(s) - min(s), "largo": ls[k]["nombre"], "atraviesan": atraviesan}


def r_no_cabe_camion_3(barra, hermanas) -> list:
    """UNA BARRA DE TRES LADOS A 90° QUE NO CABE EN EL CAMIÓN. Ver arriba."""
    m = ancho_tres_lados(barra["lados"])
    if m is None or m["ancho"] <= ANCHO_CAMION + 0.01:
        return []
    por = {l["nombre"]: l for l in barra["lados"]}
    # Se marcan las patas que pasan de 250 por sí solas; si ninguna (una Z, donde se suman),
    # las dos.
    marcar = [n for n in m["atraviesan"] if por[n]["largo"] > ANCHO_CAMION + 0.01] or m["atraviesan"]
    return [{
        "texto": ("con %s (%d cm) a lo largo del camión, %s ocupa%s %d cm de ancho y el camión lleva %d: no cabe"
                  % (m["largo"], round(por[m["largo"]]["largo"] / 10.0), _y(marcar),
                     "n" if len(marcar) > 1 else "", round(m["ancho"] / 10.0), round(ANCHO_CAMION / 10.0))),
        "lados": marcar,
        "valor": round(m["ancho"]), "esperado": round(ANCHO_CAMION),
        "clave": ("camion3",) + tuple(round(l["largo"]) for l in barra["lados"] if l["largo"] > 0),
    }]


# ─────────────────────────────────────────────────────────────────────────────
# NO CABE EN EL CAMIÓN: LOS RADIOS (11-nov)
# ─────────────────────────────────────────────────────────────────────────────
# El usuario: «cuando los radios tienen una altura o cuerda de más de 250 ocurre lo mismo.
# Debieran ser reglas diferentes». Regla aparte, por cada lado curvo.
#
# SE MIDE LA ALTURA DEL ARCO, NO LA CUERDA. La barra curva va acostada con la cuerda a lo
# largo del camión; lo que ocupa a lo ancho es la altura (la flecha): R·(1 − cos(θ/2)), que
# vale también pasado el medio círculo (ahí la altura supera al radio). Comparar la cuerda
# con 250 hacía saltar 42 de los 66 arcos medidos, todos radios 9 de 5 a 12 m de cuerda que
# viajan a lo largo, como el ARC de SLPB 16mmA41: medio círculo de 474 cm de cuerda y 237 de
# altura, que cabe. Ninguno de los 66 pasa de 250 de altura (el más alto, ese mismo).


def altura_arco(lado) -> Optional[float]:
    """La altura (flecha) del arco de un lado curvo, en mm. None si no es curvo o no trae
    radio."""
    if not lado.get("arco") or not lado.get("radio") or lado["largo"] <= 0:
        return None
    R = float(lado["radio"])
    th = abs(math.radians(float(lado["barrido"]))) if lado.get("barrido") else lado["largo"] / R
    th = min(th, 2 * math.pi)
    return R * (1 - math.cos(th / 2.0))


def r_no_cabe_camion_radio(barra, hermanas) -> list:
    """UN LADO CURVO CUYA ALTURA NO CABE EN EL CAMIÓN. Ver arriba. Una barra es un hallazgo
    aunque le fallen dos arcos: el texto los dice todos."""
    malos = [(l, altura_arco(l)) for l in barra["lados"]]
    malos = [(l, h) for l, h in malos if h is not None and h > ANCHO_CAMION + 0.01]
    if not malos:
        return []
    texto = " · ".join("el arco %s (radio %d cm) tiene %d cm de altura y el camión lleva %d: no cabe"
                       % (l["nombre"], round(float(l["radio"]) / 10.0), round(h / 10.0), round(ANCHO_CAMION / 10.0))
                       for l, h in malos)
    peor = max(h for _, h in malos)
    return [{
        "texto": texto,
        "lados": [l["nombre"] for l, _ in malos],
        "valor": round(peor), "esperado": round(ANCHO_CAMION),
        "clave": ("camion_radio",) + tuple((l["nombre"], round(l["largo"]), round(float(l["radio"]))) for l, _ in malos),
    }]


# CADA REGLA DICE DÓNDE APLICA Y, SI MIRA LA FIGURA, SE DIBUJA (10-nov). El usuario quiso
# ver «gráficamente las reglas que tenemos implementadas»: el menú de la pantalla muestra
# por regla un ejemplo trazado —con el mismo motor que las barras reales— con los lados
# que compara marcados, la explicación al lado y, en una tercera columna, el alcance:
# a qué figuras aplica y qué deja fuera. La leyenda va BAJO el dibujo (el usuario, 10-nov).
# `ejemplo` puede ser None si de verdad no hay nada que dibujar; la pantalla lo dice en vez
# de dejar el hueco. El cabezal, que mira la tipología y no la figura, se dibuja igual como
# una 101A recta: lo que salta lo dice su leyenda.
#   ejemplo = {"lados": [(nombre, mm, giro, gancho?), ...], "diam": φ, "pin": mandril,
#              "marcar": [lados que compara], "leyenda": "lo que se lee bajo el dibujo",
#              "espacial": True (opcional: lados (nombre, mm, (dx, dy, dz)), una figura doblada
#                          en dos planos, que se dibuja en isométrica como en el catálogo),
#   LA LEYENDA NOMBRA LA DIMENSIÓN Y EL LÍMITE, SIN CIFRAS DEL EJEMPLO (11-nov). El usuario:
#   «pones medidas arbitrarias mayores a 250, eso confunde, mejor poner el nombre de la
#   dimensión». El ejemplo se dibuja con medidas inventadas; la leyenda dice la REGLA.
#              "guias": "altura_diagonal" (opcional: líneas de apoyo, ver _guias)}
REGLAS = [
    {"codigo": "lado_corto",
     # El nombre corto es para los encabezados de tabla. Lo declara la regla y no lo recorta
     # la pantalla: cortar «Lado más corto que 10 diámetros» por las dos primeras palabras
     # daba «Lado más», que no quiere decir nada.
     "corto": "Lado corto",
     "nombre": "Lado más corto que 10 diámetros",
     "porque": "La planta dobla a 10 veces el diámetro. Menos que eso no se puede fabricar "
               "ni anclar. Ningún lado se excluye, tampoco los ganchos.",
     "necesita": ("lados", "diam"),
     "alcance": "Todas las figuras y todos los lados, ganchos incluidos. El mínimo es 10 veces "
                "el diámetro, con piso de 7,5 cm. Las alturas de los soportes de losa 26 y 305A en "
                "φ8, φ10 y φ12 tienen su excepción (ver Excepciones).",
     "ejemplo": {"lados": [("A", 100), ("B", 900, -90), ("C", 60, -90)], "diam": 10, "pin": 60,
                 "marcar": ["C"], "leyenda": "C < 10 φ"},
     "fn": r_lado_corto},
    {"codigo": "lados_opuestos",
     "corto": "Lados opuestos",
     "nombre": "Lados opuestos del estribo con medidas distintas",
     "porque": "En un estribo rectangular los dos lados que se miran de frente tienen que "
               "medir lo mismo. Si no, hay una medida tipeada mal.",
     "necesita": ("lados",),
     "alcance": "Sólo estribos cerrados: gancho en las dos puntas y cuatro lados en medio "
                "(T1, 106A…). Compara B con D y C con E. Una C o un suple 105A no entran: "
                "sus extremos A y E son distintos a propósito.",
     # El ejemplo va BIEN tipeado y cerrado, con el par que se compara marcado: dibujado
     # con E ≠ C el marco no cierra y los dos ganchos se amontonan con las letras en una
     # esquina; así se entiende qué se compara, y la leyenda dice cuándo salta.
     "ejemplo": {"lados": [("A", 100, None, True), ("B", 300, -135), ("C", 500, -90), ("D", 300, -90),
                           ("E", 500, -90), ("G", 100, -135, True)], "diam": 10, "pin": 40,
                 "marcar": ["C", "E"], "leyenda": "C ≠ E o B ≠ D"},
     "fn": r_lados_opuestos},
    {"codigo": "cabezal_delgado",
     "corto": "Cabezal φ chico",
     "nombre": "Cabezal con diámetro menor al habitual",
     "porque": "Un cabezal de φ12 o menos es inusual. Puede ser correcto —y entonces se "
               "deja sin efecto, de a muchos si hace falta— pero conviene mirarlo.",
     "necesita": ("diam",),
     "alcance": "Sólo barras cuya tipología (Notes en aSa) dice CB o CAB. No mira la figura: "
                "mira el diámetro.",
     # Se dibuja igual (el usuario, 10-nov): una 101A recta, y lo que salta va en el texto
     # de abajo. Así el menú no tiene un hueco donde las demás tienen dibujo.
     "ejemplo": {"lados": [("A", 1200)], "diam": 10, "pin": 60,
                 "marcar": ["A"], "leyenda": "CB con φ8 o φ10"},
     "fn": r_cabezal_delgado},
    {"codigo": "patas_suple",
     "corto": "105A: B ≠ D",
     "nombre": "Suple 105A con B distinto de D",
     "porque": "El suple va dentro de una losa y la losa tiene un solo espesor: B y D tienen que "
               "medir lo mismo. Más de 1 cm de diferencia es una medida tipeada mal.",
     "necesita": ("lados",),
     "alcance": "Sólo la figura 105A. Compara B con D; A y E pueden ser distintos y no se miran. "
                "Tolerancia: 1 cm, que es como se cubica.",
     "ejemplo": {"lados": [("A", 130), ("B", 170, -90), ("C", 600, -90), ("D", 130, -90), ("E", 300, -90)],
                 "diam": 12, "pin": 72, "marcar": ["B", "D"], "leyenda": "B ≠ D por más de 1 cm"},
     "fn": r_patas_suple},
    # UNA EXCEPCIÓN DE «lado_corto» (12-nov): `excepcion_de` dice a qué regla le cambia el
    # límite, y el menú la muestra aparte, en el grupo de Excepciones, con su dibujo. El
    # usuario: «a continuación de las reglas pongas las excepciones, así también pones el
    # render de la figura». Revisa y señala igual que cualquier regla.
    {"codigo": "altura_soporte_losa",
     "excepcion_de": "lado_corto",
     "corto": "Soporte losa: altura",
     "nombre": "Soporte de losa con una altura bajo el mínimo",
     "porque": "Las alturas del soporte de losa se doblan en un segundo proceso, con bulón, y pueden "
               "bajar de 10 φ, pero no del mínimo de Producción: 6 cm en φ8, 8 cm en φ10 y 10 cm "
               "en φ12.",
     "necesita": ("lados", "diam"),
     "alcance": "Sólo las figuras 26 (alturas C y E) y 305A (alturas B y D), en φ8, φ10 y φ12. Sus "
                "otros lados, y estas figuras en otros diámetros, siguen con la regla de 10 φ. "
                "Mínimos de Producción, correo del 25-ago-2025.",
     # Se dibuja EN EL ESPACIO, en isométrica como el catálogo: es una silla doblada en dos
     # planos, y de frente B y D quedan de canto. Es una 305A real (SURV 10mmA15): A por X,
     # B sube, C por Y, D baja, E por X.
     "ejemplo": {"espacial": True,
                 "lados": [("A", 300, (1, 0, 0)), ("B", 250, (0, 0, 1)), ("C", 300, (0, 1, 0)),
                           ("D", 250, (0, 0, -1)), ("E", 300, (1, 0, 0))],
                 "diam": 8, "pin": 48, "marcar": ["B", "D"], "leyenda": "B y D ≥ altura mínima del φ"},
     "fn": r_altura_soporte_losa},
    {"codigo": "no_cabe_camion",
     # «Camión: …» en las tres: son tres reglas del mismo motivo, y en los encabezados del
     # reporte tienen que distinguirse.
     "corto": "Camión: 2 lados",
     "nombre": "Figura de dos lados que no cabe en el camión",
     "porque": "El camión lleva 250 cm de ancho. Una barra de dos lados se carga acostada, con d "
               "a lo largo del camión: lo que ocupa a lo ancho es h. Si h pasa de 250 cm, no se "
               "puede despachar.",
     "necesita": ("lados",),
     "alcance": "Toda barra de dos lados con un doblez, con cualquier ángulo: 102A, 102B y 102C, y las "
                "figuras de aSa que quedan así con sus lados opcionales vacíos (el corchete 2 sin G, "
                "J71, AA1, 17…). Las figuras de más lados tendrán sus propias reglas.",
     "ejemplo": {"lados": [("A", 3500), ("B", 4000, -90)], "diam": 12, "pin": 72,
                 "marcar": [], "guias": "altura", "base": "d", "leyenda": "h > 250 cm"},
     "fn": r_no_cabe_camion},
    {"codigo": "no_cabe_camion_3",
     "corto": "Camión: 3 lados",
     "nombre": "Figura de tres lados a 90° que no cabe en el camión",
     "porque": "El camión lleva 250 cm de ancho. La figura se carga con su lado más largo a lo largo "
               "del camión: los lados que quedan atravesados no pueden pasar de 250 cm.",
     "necesita": ("lados",),
     "alcance": "Toda barra de tres lados con los dos dobleces a 90°: 103A, el corchete 2 con sus dos "
                "ganchos, 103D1, 103G… Si el lado más largo es B, se miden A y C; si es A o C, se mide "
                "B. En una Z, A y C se suman.",
     "ejemplo": {"lados": [("A", 3000), ("B", 6000, -90), ("C", 1200, -90)], "diam": 12, "pin": 72,
                 "marcar": ["A"], "leyenda": "A > 250 cm"},
     "fn": r_no_cabe_camion_3},
    {"codigo": "no_cabe_camion_radio",
     "corto": "Camión: radio",
     "nombre": "Radio que no cabe en el camión",
     "porque": "El camión lleva 250 cm de ancho. Una barra curva se carga acostada con c a lo largo "
               "del camión: lo que ocupa a lo ancho es h. Si h pasa de 250 cm, no se puede despachar.",
     "necesita": ("lados",),
     "alcance": "Todo lado curvo, de cualquier figura (9, ARC, DOBLE, 10W1…), cada arco por separado. "
                "En aSa, h es la cota H y c la cota O. c no se compara con 250: va a lo largo del "
                "camión, y en los radios reales llega a 12 m.",
     "ejemplo": {"lados": [("B", 8796, None, False, 2800)], "diam": 16, "pin": 96,
                 "marcar": [], "guias": "altura", "base": "c", "leyenda": "h > 250 cm"},
     "fn": r_no_cabe_camion_radio},
]


def _guias(tipo, puntos, base=None) -> list:
    """Líneas de apoyo del dibujo de una regla, en las coordenadas del eje ya orientado (mm).
    `altura`: la línea entre las puntas (cota gris: la diagonal de la L, la cuerda del arco),
    la altura desde el punto más lejano hasta ella (flecha azul de doble punta) y su letra
    «h» (el usuario, 11-nov: «puedes dibujarle una h»). Es lo que miden las reglas del
    camión. `puntos` es la MUESTRA: la altura de un arco no está en sus nodos.
    `base`: la letra de la línea entre puntas (d la diagonal, c la cuerda). El usuario, 11-nov:
    todo lo que se dibuja lleva su letra («pusiste una cuerda sin letras en el render»); va
    del lado de afuera de la figura, para no pisar el trazo."""
    if tipo != "altura" or len(puntos) < 3:
        return []
    p0, p1 = puntos[0], puntos[-1]
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L2 = dx * dx + dy * dy
    if L2 < 1e-9:
        return []
    v = max(puntos[1:-1], key=lambda q: abs(dx * (q[1] - p0[1]) - dy * (q[0] - p0[0])))
    t = ((v[0] - p0[0]) * dx + (v[1] - p0[1]) * dy) / L2
    pie = [p0[0] + t * dx, p0[1] + t * dy]
    # La «h» al costado de la flecha, corrida a lo largo de la línea entre puntas (la flecha
    # es perpendicular a ella): un 6 por ciento de esa línea, hacia la punta final.
    L = math.sqrt(L2)
    off = 0.06 * L
    hx = (v[0] + pie[0]) / 2.0 + dx / L * off
    hy = (v[1] + pie[1]) / 2.0 + dy / L * off
    guias = [{"tipo": "cota", "x1": p0[0], "y1": p0[1], "x2": p1[0], "y2": p1[1]},
             {"tipo": "diametro", "x1": v[0], "y1": v[1], "x2": round(pie[0], 1), "y2": round(pie[1], 1)},
             {"tipo": "letra", "texto": "h", "x": round(hx, 1), "y": round(hy, 1)}]
    if base:
        # A un 30 por ciento de la línea (al medio la pisaba la punta de la flecha de h),
        # corrida hacia el lado contrario al punto más lejano.
        ux, uy = (pie[0] - v[0]), (pie[1] - v[1])
        n = math.hypot(ux, uy) or 1.0
        bx = p0[0] + 0.3 * dx + ux / n * 0.07 * L
        by = p0[1] + 0.3 * dy + uy / n * 0.07 * L
        guias.append({"tipo": "letra", "texto": base, "x": round(bx, 1), "y": round(by, 1)})
    return guias


def _letras_afuera(eje) -> list:
    """Las letras de los lados puestas a mano: al medio de cada lado, del lado contrario al
    centro de la figura. Es para la figura en el espacio. El motor pone cada letra a la
    izquierda del sentido del trazo, y en la silla proyectada en isométrica dos letras caen
    siempre adentro, una encima de la otra (C y D recorriéndola desde A; A y B desde E)."""
    pts = eje.get("puntos") or []
    if len(pts) < 2:
        return []
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    off = 0.07 * max(eje.get("ancho") or 0, eje.get("alto") or 0, 1)
    letras = []
    for t in eje.get("tramos") or []:
        a, b = pts[t["desde"]], pts[t["hasta"]]
        mx, my = (a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0
        n = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
        nx, ny = -(b[1] - a[1]) / n, (b[0] - a[0]) / n
        if (mx - cx) * nx + (my - cy) * ny < 0:
            nx, ny = -nx, -ny
        letras.append({"tipo": "letra", "texto": t["lado"], "x": round(mx + nx * off, 1), "y": round(my + ny * off, 1)})
    return letras


def ejemplo_dibujado(regla) -> Optional[dict]:
    """El ejemplo de una regla, trazado con el mismo motor que las barras reales, listo
    para que la pantalla lo dibuje y marque los lados. None si la regla no mira la figura.
    `letras_a_mano`: la figura en el espacio trae sus letras en `guias` (ver _letras_afuera)
    y la pantalla apaga las automáticas."""
    ej = regla.get("ejemplo")
    if not ej:
        return None
    espacial = bool(ej.get("espacial"))
    eje = (figura_espacial_de_lados(ej["lados"]) if espacial
           else figura_de_lados(ej["lados"], pin_diam=ej.get("pin", 0), diam_mm=ej.get("diam", 0)))
    guias = _guias(ej.get("guias"), eje.get("muestra") or eje.get("puntos") or [], ej.get("base"))
    if espacial:
        guias += _letras_afuera(eje)
    return {"eje": eje, "marcar": list(ej.get("marcar") or []), "leyenda": ej.get("leyenda") or "",
            "diam": ej.get("diam"), "lados": [[l[0], l[1]] for l in ej["lados"]],
            "guias": guias, "letras_a_mano": espacial}

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
            # UNA BARRA, UNA REGLA, UN HALLAZGO. Las reglas ya devuelven uno solo por
            # barra, pero esto lo garantiza para la que venga: una regla que devuelva
            # varios se funde acá en vez de llenar la lista con la misma barra repetida.
            # Lo pidió el usuario y es la unidad con la que se trabaja: quien corrige abre
            # el código una vez y arregla la barra entera.
            _hs = r["fn"](b, hermanas) or []
            if len(_hs) > 1:
                _hs = [{
                    "texto": " · ".join(x.get("texto") or "" for x in _hs),
                    "lados": [L for x in _hs for L in (x.get("lados") or [])],
                    "valor": _hs[0].get("valor"), "esperado": _hs[0].get("esperado"),
                    "clave": tuple(sorted(str(c) for x in _hs for c in (x.get("clave") or ()))),
                }]
            for h in _hs:
                clave = h.get("clave") or ()
                salida.append({
                    "regla": r["codigo"], "ref": b["ref"], "cc": b.get("cc"),
                    "elemento": b.get("elemento"), "marca": b.get("marca"),
                    "figura": b.get("figura"), "diam": b.get("diam"),
                    "detalle": {"texto": h.get("texto"), "lados": h.get("lados") or [],
                                "valor": h.get("valor"), "esperado": h.get("esperado"),
                                # TODOS LOS LADOS, EN SU ORDEN (21-oct): [nombre, mm, ángulo
                                # con el anterior]. Con esto la hoja arma un solo encabezado
                                # por código —A B C… α1 α2…— sin tener que leer aSa; la
                                # figura queda sólo para el dibujo. Va como lista y no como
                                # dict porque jsonb no respeta el orden de las llaves.
                                "lados_all": [[l["nombre"], l["largo"], l.get("angulo")]
                                              for l in (b.get("lados") or [])]},
                    # Esta barra de este código. Con ella, revisar dos veces no duplica.
                    "firma": _firma(r["codigo"], b.get("cc"), b.get("elemento"), b["ref"], *clave),
                    # La FORMA del problema, sin la barra ni el código: aceptar una apaga
                    # todas las iguales de la obra.
                    "firma_patron": _firma(r["codigo"], b.get("figura"), b.get("diam"), *clave),
                })
    return salida
