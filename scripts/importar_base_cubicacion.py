# -*- coding: utf-8 -*-
"""
LA BASE DE CUBICACIÓN DESDE LA PLANILLA DE CALIDAD (6-oct).

    python scripts/importar_base_cubicacion.py             -> PRUEBA, no escribe nada
    python scripts/importar_base_cubicacion.py --cargar    -> escribe en la base

QUÉ RESUELVE. El tablero de indicadores divide reclamos por toneladas cubicadas, y las
toneladas salen de aSa. Pero aSa partió en marzo de 2022 y recién en agosto tomó volumen:
del 2022 tiene 3.092 toneladas contra las 29.931 que el área registró en su planilla
(«Analisis Errores Acumulado al 2025.xlsx», hoja «Consolidado al 2025»: una fila por año,
cubicador y obra, con los kilos cubicados). Esa planilla es la base del 2022 —y de paso
deja ver, por ejemplo, que Carlos Santos cubicó 7.374 toneladas ese año, no las 574 que
aSa le atribuye en 2023—. De 2023 en adelante planilla y aSa coinciden dentro del 10%, y
ahí sigue mandando aSa (está viva; la planilla es una foto).

SE PUEDE CORRER DOS VECES: la llave es (año, cubicador, obra) y se actualiza.

LO QUE SE NORMALIZA. El nombre del cubicador queda como lo usa el tablero (el valor de
ASA_PERSONA, o el de los reclamos para los que ya no están en aSa: «José Pantoja»). La obra
se busca en aSa por nombre, tal cual: si calza, se guarda su job y se toma el SEGMENTO de
allá; si no, el segmento es «4 y 5» cuando la planilla dice Edificación y queda vacío cuando
dice «Otros» (que allá significa «no edificación», no el segmento Otros de la plataforma).
Para 2022 calzan 38 de 206 obras: la mayoría son anteriores a aSa.
"""
import io
import os
import re
import sys
import unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVO = os.path.join(RAIZ, "entrada", "Reclamos", "Analisis Errores Acumulado al 2025.xlsx")
HOJA = "Consolidado al 2025"
MIGRACION = os.path.join(RAIZ, "armahub", "migrations", "127_base_cubicacion_planilla.sql")

# Cómo escribe la planilla a cada cubicador → cómo lo llama el tablero.
NOMBRES = {
    "jose rodriguez": "Jose Rodriguez", "josé rodriguez": "Jose Rodriguez",
    "rmc": "RMC",
    "jose pantoja": "José Pantoja", "josé pantoja": "José Pantoja",
}


def normalizar_cubicador(nombre) -> str:
    """El nombre con que el tablero conoce al cubicador: el de aSa (ASA_PERSONA) o el de
    los reclamos. Lo demás, en mayúscula inicial."""
    limpio = re.sub(r"\s+", " ", str(nombre or "")).strip()
    return NOMBRES.get(limpio.lower(), limpio.title())


def _sin_acento(s) -> str:
    return unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()


def clave_obra(nombre) -> str:
    """Para buscar la obra en aSa por nombre: sin acentos, sin puntuación, en mayúscula."""
    return re.sub(r"[^A-Z0-9]+", " ", _sin_acento(nombre).upper()).strip()


def segmento_de(seg_planilla, seg_asa):
    """El segmento de aSa si la obra calzó; si no, «4 y 5» para Edificación y nada para el
    resto: el «Otros» de la planilla quiere decir «no edificación», no el segmento Otros."""
    if seg_asa:
        return seg_asa
    if str(seg_planilla or "").strip().lower().startswith("edificaci"):
        return "4 y 5"
    return None


def _num(x) -> float:
    try:
        return float(str(x).replace(",", ".").strip() or 0)
    except (TypeError, ValueError):
        return 0.0


def fila_de(valores):
    """Una fila de la hoja (AÑO, CUBICADOR, SERVICIO, OBRA, CUBICADO, SEGMENTO, …) → dict, o
    None si no es una fila de datos."""
    if not valores or len(valores) < 6:
        return None
    anio, cub, serv, obra, kg, seg = valores[:6]
    if not cub or not str(cub).strip() or not obra or not str(obra).strip():
        return None
    try:
        anio = int(_num(anio))
    except (TypeError, ValueError):
        return None
    if anio < 2000:
        return None
    return {"anio": anio, "cubicador": normalizar_cubicador(cub),
            "servicio": (str(serv).strip().title() if serv else None),
            "obra": re.sub(r"\s+", " ", str(obra)).strip(), "kg": _num(kg),
            "seg_planilla": (str(seg).strip() if seg else None)}


def leer_planilla(ruta=ARCHIVO, hoja=HOJA):
    import openpyxl
    wb = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    ws = wb[hoja]
    filas = []
    for valores in ws.iter_rows(min_row=7, max_row=ws.max_row, min_col=2, max_col=10, values_only=True):
        f = fila_de(valores)
        if f:
            filas.append(f)
    return filas


def consolidar(filas):
    """Una fila por (año, cubicador, obra). Si la planilla repite la obra, se toma el MAYOR
    kilaje, no la suma: la fila es la obra, no un error."""
    por = {}
    repetidas = 0
    for f in filas:
        k = (f["anio"], f["cubicador"], f["obra"])
        if k in por:
            repetidas += 1
            por[k]["kg"] = max(por[k]["kg"], f["kg"])
        else:
            por[k] = dict(f)
    return list(por.values()), repetidas


def main():
    cargar = "--cargar" in sys.argv
    sys.path.insert(0, os.path.join(RAIZ, "scripts"))
    from asa_ping import cargar_env
    cargar_env()
    import psycopg
    filas, repetidas = consolidar(leer_planilla())
    print("%d filas en la hoja «%s» (%d repetidas, se tomó el mayor kilaje)" % (len(filas), HOJA, repetidas))
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            cur.execute(io.open(MIGRACION, encoding="utf-8").read())
            cur.execute("SELECT asa_job_id, nombre FROM asa_obras")
            obras = {clave_obra(n): j for j, n in cur.fetchall()}
            cur.execute("SELECT asa_job_id, job_name FROM asa_pedidos WHERE job_name IS NOT NULL GROUP BY 1, 2")
            for j, n in cur.fetchall():
                obras.setdefault(clave_obra(n), j)
            cur.execute("SELECT asa_job_id, segmento FROM asa_obra_atributos")
            segmentos = dict(cur.fetchall())
            por_anio = {}
            calzan = 0
            for f in filas:
                job = obras.get(clave_obra(f["obra"]))
                f["asa_job_id"] = job
                f["segmento"] = segmento_de(f["seg_planilla"], segmentos.get(job) if job else None)
                calzan += 1 if job else 0
                a = por_anio.setdefault(f["anio"], {"ton": 0.0, "obras": 0, "calzan": 0})
                a["ton"] += f["kg"] / 1000.0
                a["obras"] += 1
                a["calzan"] += 1 if job else 0
            for anio in sorted(por_anio):
                a = por_anio[anio]
                print("  %d: %6.0f ton · %3d obras · %3d con obra en aSa" % (anio, a["ton"], a["obras"], a["calzan"]))
            if not cargar:
                print("\nPRUEBA: no se escribió nada. Con --cargar se carga.")
                return
            fuente = os.path.basename(ARCHIVO) + " · " + HOJA
            cur.executemany(
                """INSERT INTO base_cubicacion_planilla (anio, cubicador, servicio, obra, asa_job_id, segmento, kg, fuente)
                   VALUES (%(anio)s, %(cubicador)s, %(servicio)s, %(obra)s, %(asa_job_id)s, %(segmento)s, %(kg)s, %(fuente)s)
                   ON CONFLICT (anio, cubicador, obra) DO UPDATE
                      SET servicio = EXCLUDED.servicio, asa_job_id = EXCLUDED.asa_job_id,
                          segmento = EXCLUDED.segmento, kg = EXCLUDED.kg, fuente = EXCLUDED.fuente,
                          importado_el = now()""",
                [dict(f, fuente=fuente) for f in filas])
        conn.commit()
    print("\nCARGADO: %d filas en base_cubicacion_planilla" % len(filas))


if __name__ == "__main__":
    main()
