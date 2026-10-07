# -*- coding: utf-8 -*-
"""
EL CATÁLOGO DE FIGURAS DE aSa, DESDE SU PROPIO EXPORT (7-oct).

    python scripts/importar_rdx_figuras.py <archivo.rdx>            -> PRUEBA
    python scripts/importar_rdx_figuras.py <archivo.rdx> --cargar   -> escribe

QUÉ RESUELVE. aSa no entrega las figuras por la API: se probaron getShapes,
getShapeLibrary, getBarShapes, getShapeView, getShapeMaster, getPatterns, getLegAngles y
getShape, y los ocho devuelven 401. Pero el programa SÍ exporta su catálogo, y el archivo
RDX («5G RDX Shape Export») trae lo que hacía falta: por cada figura, las COORDENADAS CON
QUE aSa LA DIBUJA. Deja de ser nuestra reconstrucción contra nada y pasa a ser el trazo de
aSa, que es con lo que hay que comparar.

QUÉ TRAE CADA FIGURA EN EL RDX:
  · `SHAPE_COMPONENTS` — un componente por lado, con su `ElementType`: los que son FIERRO
    (`B` recto, `SB` recto inclinado, `RB` curvo, `H3`/`H8`/`H9` ganchos) y los que NO lo
    son (`WS` cotas, `AN` ángulos, `WR` radios, `WD`/`WN` auxiliares de dibujo). Sólo los
    primeros se dibujan: los otros son anotaciones sobre el dibujo, no barra.
  · `SHAPE_COORDINATES` — por lado, varios puntos con su `CoordinateType`: `Stt` (dónde
    empieza) y `End` (dónde termina) son el trazo; `Dim`, `St2`, `En2` y `Cen` son dónde
    van las cotas y los ángulos, y se ignoran acá.
  · `SHAPE_EQUATIONS` — las reglas que ligan unos lados con otros. No se usan para dibujar.

CÓMO SE ARMA LA POLILÍNEA. Los lados NO vienen en el orden del trazo: vienen en el orden
del XML, que es otra cosa. En la 103A, por ejemplo, primero va el tramo largo `B` y
después los dos ganchos `A` y `C`, y leerlos así da una figura que salta de un lado a otro.
Lo que sí es cierto es que ENCADENAN: el `End` de un lado es el `Stt` del siguiente. Así
que se arma la cadena siguiendo las coordenadas —se arranca por el lado cuyo `Stt` no es el
`End` de nadie, que es la punta de la barra— y recién ahí se recorre. En las figuras
cerradas (estribos) toda punta es final de otro lado, y entonces se parte por el primero.
"""
import io
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRACIONES = [os.path.join(RAIZ, "armahub", "migrations", n) for n in
               ("131_asa_figuras_catalogo.sql", "132_asa_figuras_cotas.sql")]

# Los componentes que SON fierro. El resto (`WS`, `AN`, `WR`, `WD`, `WN`, `FS`) son cotas,
# ángulos y auxiliares de dibujo: anotaciones sobre la figura, no parte de la barra.
TIPOS_FIERRO = ("B", "SB", "RB", "H3", "H8", "H9", "H13", "H18", "STD")
# Dos puntos más cerca que esto se consideran el mismo (las coordenadas son enteras).
MINIMO = 0.5


def _txt(bloque: str, etiqueta: str) -> str:
    m = re.search(r"<%s>(.*?)</%s>" % (etiqueta, etiqueta), bloque, re.S)
    return (m.group(1) or "").strip() if m else ""


def _num(x, por_defecto=0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return por_defecto


def componentes_de(cuerpo: str):
    """Los lados declarados, en orden, con lo que hace falta para dibujarlos."""
    salida = []
    for sc in re.findall(r"<SHAPE_COMPONENT>(.*?)</SHAPE_COMPONENT>", cuerpo, re.S):
        salida.append({
            "nombre": _txt(sc, "LegName"),
            "tipo": _txt(sc, "ElementType"),
            "arco": _num(_txt(sc, "DrawingArcAngle")),
            "radio": _num(_txt(sc, "DrawingArcRadius")),
        })
    return salida


def coordenadas_de(cuerpo: str):
    """{lado: {tipo_de_punto: (x, y, z)}}. Interesan `Stt` y `End`."""
    salida = {}
    for sc in re.findall(r"<SHAPE_COORDINATE>(.*?)</SHAPE_COORDINATE>", cuerpo, re.S):
        lado = _txt(sc, "LegName")
        salida.setdefault(lado, {})[_txt(sc, "CoordinateType")] = (
            _num(_txt(sc, "X")), _num(_txt(sc, "Y")), _num(_txt(sc, "Z")))
    return salida


def _cerca(a, b) -> bool:
    return abs(a[0] - b[0]) <= MINIMO and abs(a[1] - b[1]) <= MINIMO


def _voltear(t):
    return dict(t, ini=t["fin"], fin=t["ini"], invertido=True)


def encadenar(tramos):
    """Los lados en el orden del TRAZO, siguiendo las coordenadas (ver la cabecera).

    La cadena CRECE POR LOS DOS EXTREMOS, y eso no es un refinamiento: los ganchos vienen
    después de la barra en el XML y muchos cuelgan del PRINCIPIO. En la 104E1, por ejemplo,
    el gancho `A` nace en el mismo punto donde arranca `B`; creciendo sólo hacia adelante,
    `A` nunca encuentra dónde engancharse y la figura sale partida. Un lado puede venir al
    revés —se da vuelta si calza por el otro punto—, y lo que no se pueda encadenar se
    agrega al final en el orden en que venía: es mejor dibujar una figura rara que
    descartarla en silencio."""
    quedan = list(tramos)
    if not quedan:
        return []
    cadena = [quedan.pop(0)]
    while quedan:
        cabeza, cola = cadena[0]["ini"], cadena[-1]["fin"]
        for i, t in enumerate(quedan):
            if _cerca(t["ini"], cola):
                cadena.append(quedan.pop(i)); break
            if _cerca(t["fin"], cola):
                quedan.pop(i); cadena.append(_voltear(t)); break
            if _cerca(t["fin"], cabeza):
                quedan.pop(i); cadena.insert(0, t); break
            if _cerca(t["ini"], cabeza):
                quedan.pop(i); cadena.insert(0, _voltear(t)); break
        else:
            break
    return cadena + quedan


# Las anotaciones que SÍ se dibujan, y qué es cada una:
#   WS  cota entre dos vértices (la altura, el ancho, el largo proyectado)
#   WD  auxiliar de dibujo, misma forma que la WS
#   AN  ángulo entre dos lados: sólo marca el vértice
#   WR  radio de un lado curvo: una línea desde el centro
# Quedan fuera WN, FS, FT y compañía: traen `Stt` igual a `End`, no dibujan nada.
COTAS_LINEA = ("WS", "WD", "WA", "T3")
COTAS_ANGULO = ("AN",)
COTAS_RADIO = ("WR",)


def cotas_de(comps, coords):
    """Las cotas con que aSa dibuja la figura (ver la migración 132).

    LA LÍNEA DE COTA VA DE `Stt` A `St2`, y los dos vértices que mide son `End` y `En2`.
    No es una interpretación: medido sobre las 1.713 cotas del catálogo, `End` y `En2`
    caen sobre un vértice del trazo en el 94 por ciento, y el largo de `Stt`→`St2` coincide
    con lo que separa a esos vértices en el 98. Las `patitas` (del vértice a la línea) son
    `End`→`Stt` y `En2`→`St2`.

    El punto `Dim` NO se usa para las cotas: en varias figuras aSa lo manda muy fuera del
    dibujo (en la 104E1, a y=265 cuando la figura llega a y=64), porque allá las apila en
    una lista aparte. El texto va al medio de su propia línea, que siempre está bien.
    """
    salida = []
    for c in comps:
        tipo = c["tipo"]
        if tipo in TIPOS_FIERRO:
            continue
        p = coords.get(c["nombre"], {})

        def xy(k):
            v = p.get(k)
            return [round(v[0], 1), round(v[1], 1)] if v else None

        if tipo in COTAS_ANGULO:
            cen, dim = xy("Cen"), xy("Dim")
            if cen:
                salida.append({"nombre": c["nombre"], "tipo": tipo,
                               "centro": cen, "texto": dim or cen})
            continue
        ini, fin = xy("Stt"), xy("St2") if tipo in COTAS_LINEA else xy("End")
        if not ini or not fin or _cerca(ini + [0], fin + [0]):
            continue
        cota = {"nombre": c["nombre"], "tipo": tipo, "linea": [ini, fin],
                "texto": [round((ini[0] + fin[0]) / 2.0, 1), round((ini[1] + fin[1]) / 2.0, 1)]}
        if tipo in COTAS_LINEA:
            # Las patitas, sólo si aSa mandó los dos vértices que la cota mide.
            a, b = xy("End"), xy("En2")
            if a and b:
                cota["ref"] = [[a, ini], [b, fin]]
        salida.append(cota)
    return salida


def polilinea(comps, coords):
    """La polilínea de la figura y los tramos que la componen. Devuelve (puntos, lados, 3d)."""
    tramos, tridimensional = [], False
    for c in comps:
        if c["tipo"] not in TIPOS_FIERRO:
            continue
        pts = coords.get(c["nombre"], {})
        if "Stt" not in pts or "End" not in pts:
            continue
        ini, fin = pts["Stt"], pts["End"]
        if _cerca(ini, fin):
            continue              # el lado no mueve nada: no es un tramo del trazo
        if abs(ini[2]) > MINIMO or abs(fin[2]) > MINIMO:
            tridimensional = True
        tramos.append({"nombre": c["nombre"], "tipo": c["tipo"],
                       "arco": c["arco"], "radio": c["radio"], "ini": ini, "fin": fin})

    puntos, lados = [], []
    for t in encadenar(tramos):
        if not puntos or not _cerca(t["ini"], puntos[-1]):
            puntos.append([round(t["ini"][0], 1), round(t["ini"][1], 1)])
        desde = len(puntos) - 1
        puntos.append([round(t["fin"][0], 1), round(t["fin"][1], 1)])
        lados.append({"nombre": t["nombre"], "tipo": t["tipo"],
                      "arco": t["arco"], "radio": t["radio"],
                      "desde": desde, "hasta": len(puntos) - 1})
    return puntos, lados, tridimensional


def figuras_del_rdx(ruta: str):
    t = io.open(ruta, encoding="utf-8", errors="replace").read()
    salida = []
    for m in re.finditer(r"<SHAPE>(.*?)</SHAPE>", t, re.S):
        cuerpo = m.group(1)
        codigo = _txt(cuerpo, "ShapeName")
        if not codigo:
            continue
        comps = componentes_de(cuerpo)
        coords = coordenadas_de(cuerpo)
        puntos, lados, td = polilinea(comps, coords)
        salida.append({
            "codigo": codigo, "tipo": _txt(cuerpo, "ShapeTypeID"),
            "generica": _txt(cuerpo, "Generic") != "0",
            "descripcion": _txt(cuerpo, "ShapeDesc") or None,
            "puntos": puntos, "lados": lados, "tridimensional": td,
            "cotas": cotas_de(comps, coords),
        })
    return salida


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    cargar = "--cargar" in sys.argv
    ruta = args[0] if args else None
    if not ruta:
        entrada = os.path.join(RAIZ, "entrada")
        rdx = sorted(f for f in os.listdir(entrada) if f.lower().endswith(".rdx"))
        if not rdx:
            print("Falta el archivo .rdx (va en entrada/)."); return
        ruta = os.path.join(entrada, rdx[-1])
    print("Leyendo %s" % os.path.basename(ruta))
    figuras = figuras_del_rdx(ruta)
    dibujables = [f for f in figuras if len(f["puntos"]) >= 2]
    print("%d figuras · %d con trazo dibujable · %d en 3D"
          % (len(figuras), len(dibujables), sum(1 for f in figuras if f["tridimensional"])))
    import collections
    print("por tipo:", dict(collections.Counter(f["tipo"] for f in figuras)))
    sin = [f["codigo"] for f in figuras if len(f["puntos"]) < 2]
    if sin:
        print("sin trazo (%d): %s" % (len(sin), sin[:10]))
    if not cargar:
        print("\nPRUEBA: no se escribió nada. Con --cargar se carga.")
        return
    sys.path.insert(0, os.path.join(RAIZ, "scripts"))
    from asa_ping import cargar_env
    cargar_env()
    import psycopg
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            for mig in MIGRACIONES:
                cur.execute(io.open(mig, encoding="utf-8").read())
            cur.executemany(
                """INSERT INTO asa_figuras_catalogo
                       (codigo, tipo, generica, descripcion, puntos, lados, cotas,
                        tridimensional, fuente, importado_el)
                   VALUES (%(codigo)s, %(tipo)s, %(generica)s, %(descripcion)s, %(puntos)s, %(lados)s,
                           %(cotas)s, %(tridimensional)s, %(fuente)s, now())
                   ON CONFLICT (codigo) DO UPDATE
                      SET tipo = EXCLUDED.tipo, generica = EXCLUDED.generica,
                          descripcion = EXCLUDED.descripcion, puntos = EXCLUDED.puntos,
                          lados = EXCLUDED.lados, cotas = EXCLUDED.cotas,
                          tridimensional = EXCLUDED.tridimensional,
                          fuente = EXCLUDED.fuente, importado_el = now()""",
                [dict(f, puntos=json.dumps(f["puntos"]), lados=json.dumps(f["lados"]),
                      cotas=json.dumps(f["cotas"]),
                      fuente=os.path.basename(ruta)) for f in figuras])
            cur.execute("SELECT COUNT(*) FROM asa_figuras_catalogo")
            total = cur.fetchone()[0]
        conn.commit()
    print("\nCARGADO: %d figuras en asa_figuras_catalogo" % total)


if __name__ == "__main__":
    main()
