# -*- coding: utf-8 -*-
"""
EL CATÁLOGO DE FIGURAS DE aSa, DERIVADO DE LAS BARRAS (7-oct).

    python scripts/escanear_figuras_asa.py              -> muestreo amplio (por defecto)
    python scripts/escanear_figuras_asa.py --todo       -> TODOS los códigos de control
    python scripts/escanear_figuras_asa.py --ccs 300    -> cuántos códigos recorrer

POR QUÉ UN BARRIDO Y NO UNA CONSULTA. aSa no expone un catálogo de formas: se probaron
getShapes, getShapeLibrary, getBarShapes, getShapeView, getShapeMaster, getPatterns,
getLegAngles y getShape, y los ocho devuelven 401 —no existen para esta credencial—. Lo
único que hay son las barras de `getOrderItemView`, que ADEMÁS obliga a filtrar por código
de control (sin filtro aSa se atora) y tope de 500 filas. Así que el catálogo se junta
recorriendo códigos y quedándose con una barra de ejemplo por cada `ShpNameID` distinto.

CÓMO SE ELIGEN LOS CÓDIGOS. Repartidos entre años, obras y cubicadores, y los más gordos
primero: una figura rara aparece en una obra rara, no en el código de al lado. En los
primeros 28 códigos aparecieron 35 figuras distintas y la curva se aplana rápido, así que
el muestreo amplio alcanza para ver con cuáles hay problemas, que es para lo que es.

SE PUEDE CORRER DOS VECES: la llave es el código de la figura. Cada corrida sube el
contador de barras vistas y deja el ejemplo más reciente.
"""
import io
import os
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRACION = os.path.join(RAIZ, "armahub", "migrations", "129_asa_figuras.sql")
CCS_POR_DEFECTO = 500


def _mm(descr) -> float:
    import re
    m = re.search(r"([\d.]+)", str(descr or ""))
    return float(m.group(1)) if m else 0.0


def codigos_a_recorrer(cur, cuantos, todo):
    """Los códigos de control a mirar: repartidos entre años, obras y cubicadores, y
    dentro de cada reparto los más gordos primero (más barras = más variedad de figuras)."""
    if todo:
        cur.execute("""SELECT control_code FROM asa_pedidos
                        WHERE COALESCE(estado,'') <> 'Cancelled' ORDER BY kg DESC NULLS LAST""")
        return [r[0] for r in cur.fetchall()]
    cur.execute(
        """WITH ordenados AS (
               SELECT control_code, anio, asa_job_id, detail_person, kg,
                      ROW_NUMBER() OVER (PARTITION BY anio, detail_person ORDER BY kg DESC NULLS LAST) AS n
                 FROM asa_pedidos
                WHERE COALESCE(estado,'') <> 'Cancelled' AND kg > 0
           )
           SELECT control_code FROM ordenados ORDER BY n, kg DESC NULLS LAST LIMIT %s""",
        (cuantos,))
    return [r[0] for r in cur.fetchall()]


def main():
    todo = "--todo" in sys.argv
    cuantos = CCS_POR_DEFECTO
    if "--ccs" in sys.argv:
        try:
            cuantos = int(sys.argv[sys.argv.index("--ccs") + 1])
        except (IndexError, ValueError):
            pass
    sys.path.insert(0, os.path.join(RAIZ, "scripts"))
    sys.path.insert(0, RAIZ)
    from asa_ping import cargar_env
    cargar_env()
    os.environ.setdefault("ASA_TIMEOUT", "60")
    os.environ.setdefault("JWT_SECRET", "escaneo-local-no-vale-en-produccion-123456")
    import psycopg
    from armahub import asa
    from armahub.auditorias import _items_de, _es_barra

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            cur.execute(io.open(MIGRACION, encoding="utf-8").read())
            ccs = codigos_a_recorrer(cur, cuantos, todo)
        conn.commit()
    print("%d códigos de control a recorrer%s" % (len(ccs), " (TODOS)" if todo else ""))

    vistas, nuevas_total, t0, fallos = {}, 0, time.time(), 0
    for i, cc in enumerate(ccs, start=1):
        try:
            items = _items_de(cc)
        except Exception as e:
            fallos += 1
            if fallos <= 3:
                print("   %s: %s" % (cc, str(e)[:70]))
            continue
        for it in items:
            if not _es_barra(it):
                continue
            shp = (it.get("ShpNameID") or "").strip()
            if not shp:
                continue
            f = vistas.setdefault(shp, {"codigo": shp, "barras": 0})
            f["barras"] += 1
            # El ejemplo: se queda con el que traiga MÁS datos para dibujar. Una barra sin
            # ShapeDims se dibuja peor que una que lo trae, y el tab existe para ver la
            # figura, no para ver que faltan datos.
            puntaje = (1 if it.get("LegAngle") else 0) + (1 if it.get("ShapeDims") else 0)
            if puntaje >= f.get("_puntaje", -1):
                f.update({"_puntaje": puntaje, "ejemplo_cc": cc,
                          "ejemplo_marca": it.get("BarMark"), "ejemplo_obra": it.get("JobName"),
                          "diam_mm": _mm(it.get("BarSizeDescr")),
                          "pin_diam": float(it.get("PinDiam") or 0),
                          "largo_mm": float(it.get("LengthCut") or 0),
                          "legangle": it.get("LegAngle"), "shapedims": it.get("ShapeDims")})
        if i % 25 == 0 or i == len(ccs):
            print("   %4d/%d · %3d figuras distintas · %.0f min"
                  % (i, len(ccs), len(vistas), (time.time() - t0) / 60))

    filas = [{k: v for k, v in f.items() if not k.startswith("_")} for f in vistas.values()]
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM asa_figuras")
            antes = cur.fetchone()[0]
            cur.executemany(
                """INSERT INTO asa_figuras (codigo, barras, ejemplo_cc, ejemplo_marca, ejemplo_obra,
                                            diam_mm, pin_diam, largo_mm, legangle, shapedims, visto_el)
                   VALUES (%(codigo)s, %(barras)s, %(ejemplo_cc)s, %(ejemplo_marca)s, %(ejemplo_obra)s,
                           %(diam_mm)s, %(pin_diam)s, %(largo_mm)s, %(legangle)s, %(shapedims)s, now())
                   ON CONFLICT (codigo) DO UPDATE
                      SET barras = asa_figuras.barras + EXCLUDED.barras,
                          ejemplo_cc = EXCLUDED.ejemplo_cc, ejemplo_marca = EXCLUDED.ejemplo_marca,
                          ejemplo_obra = EXCLUDED.ejemplo_obra, diam_mm = EXCLUDED.diam_mm,
                          pin_diam = EXCLUDED.pin_diam, largo_mm = EXCLUDED.largo_mm,
                          legangle = EXCLUDED.legangle, shapedims = EXCLUDED.shapedims,
                          visto_el = now()""",
                filas)
            cur.execute("SELECT COUNT(*) FROM asa_figuras")
            despues = cur.fetchone()[0]
        conn.commit()
    print("\n%d figuras distintas (%d nuevas) · %d códigos con error · %.0f min"
          % (len(filas), despues - antes, fallos, (time.time() - t0) / 60))


if __name__ == "__main__":
    main()
