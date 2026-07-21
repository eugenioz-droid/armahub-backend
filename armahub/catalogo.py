"""
catalogo.py
-----------
Caluga Catálogo Armacero (5M): data maestra de figuras y tipologías de fierro.
Catálogo ÚNICO (fuente de verdad), portado de typology_catalog.py de ArmaPilot.

- Figura: código + parciales (slots dim A..I que usa) + ángulos + radio.
- Tipología: estructura (MURO/LOSA/...) + código (MH, Fi, ES...) + nombre.
- tipologia_figuras: qué figuras aplican a cada tipología.

El seed (`seed_catalogo`) carga el catálogo semilla de forma idempotente (no pisa
ediciones hechas desde la UI en el futuro: solo inserta lo que falta).
"""

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .auth import get_current_user
from .db import get_conn

router = APIRouter()


# ============================================================================
# CATÁLOGO SEMILLA (portado de ArmaPilot typology_catalog.py)
# Formato figura: (codigo, [parciales], [angulos], radio)
# ============================================================================

_FIGURAS_SEED = [
    ("101A", ["A"], [], False),
    ("102A", ["A", "B"], [], False),
    ("102B", ["A", "B"], [135], False),
    ("102C", ["A", "B"], [45], False),
    ("103A", ["A", "B", "C"], [], False),
    ("103B", ["A", "B", "C"], [45, 45], False),
    ("103C", ["A", "B", "C"], [45], False),
    ("103D", ["A", "B", "C"], [135], False),
    ("103E", ["A", "B", "C"], [135, 135], False),
    ("103F", ["A", "B", "C"], [135, 45], False),
    ("103G", ["A", "B", "C"], [], False),
    ("103H", ["A", "B", "C"], [135, 135], False),
    ("103I", ["A", "B", "C"], [135], False),
    ("103J", ["A", "B", "C"], [135, 45], False),
    ("103K", ["A", "B", "C"], [45], False),
    ("103L", ["A", "B", "C"], [45, 45], False),
    ("104A", ["A", "B", "C", "D"], [], False),
    ("104B", ["A", "B", "C", "D"], [45, 45], False),
    ("104C", ["A", "B", "C", "D"], [45], False),
    ("104D", ["A", "B", "C", "D"], [135, 135], False),
    ("104E", ["A", "B", "C", "D"], [135], False),
    ("104F", ["A", "B", "C", "D"], [135], False),
    ("104G", ["A", "B", "C", "D"], [], False),
    ("104H", ["A", "B", "C", "D"], [135, 45], False),
    ("104I", ["A", "B", "C", "D"], [135, 45], False),
    ("104J", ["A", "B", "C", "D"], [45], False),
    ("104K", ["A", "B", "C", "D"], [45], False),
    ("104L", ["A", "B", "C", "D"], [45, 45], False),
    ("104M", ["A", "B", "C", "D"], [135], False),
    ("104N", ["A", "B", "C", "D"], [], False),
    ("104O", ["A", "B", "C", "D"], [135, 135], False),
    ("104P", ["A", "B", "C", "D"], [135, 135], False),
    ("104Q", ["A", "B", "C", "D"], [135], False),
    ("104R", ["A", "B", "C", "D"], [45, 135], False),
    ("104S", ["A", "B", "C", "D"], [45, 135], False),
    ("104T", ["A", "B", "C", "D"], [45], False),
    ("104U", ["A", "B", "C", "D"], [45, 45], False),
    ("105A", ["A", "B", "C", "D", "E"], [], False),
    ("105B", ["A", "B", "C", "D", "E"], [45], False),
    ("105C", ["A", "B", "C", "D", "E"], [45, 45], False),
    ("105D", ["A", "B", "C", "D", "E"], [], False),
    ("105E", ["A", "B", "C", "D", "E"], [], False),
    ("105F", ["A", "B", "C", "D", "E"], [135], False),
    ("105G", ["A", "B", "C", "D", "E"], [135], False),
    ("105H", ["A", "B", "C", "D", "E"], [45], False),
    ("105I", ["A", "B", "C", "D", "E"], [135, 45], False),
    ("105J", ["A", "B", "C", "D", "E"], [135, 45], False),
    ("105K", ["A", "B", "C", "D", "E"], [45], False),
    ("105L", ["A", "B", "C", "D", "E"], [135, 135], False),
    ("105M", ["A", "B", "C", "D", "E"], [45, 45], False),
    ("105N", ["A", "B", "C", "D", "E"], [135, 135], False),
    ("105O", ["A", "B", "C", "D", "E"], [135], False),
    ("105P", ["A", "B", "C", "D", "E"], [45, 135], False),
    ("105Q", ["A", "B", "C", "D", "E"], [135, 135], False),
    ("105R", ["A", "B", "C", "D", "E"], [135], False),
    ("105S", ["A", "B", "C", "D", "E"], [45, 135], False),
    ("105T", ["A", "B", "C", "D", "E"], [45], False),
    ("106A", ["A", "B", "C", "D", "E", "F"], [45, 45], False),
    ("106B", ["A", "B", "C", "D", "E", "F"], [45], False),
    ("106C", ["A", "B", "C", "D", "E", "F"], [], False),
    ("106D", ["A", "B", "C", "D", "E", "F"], [], False),
    ("201A", ["B", "G", "H"], [], True),
    ("305A", ["A", "B", "C", "D", "E"], [], False),
]

# Tipologías: estructura -> [(codigo, nombre), ...]
_TIPOLOGIAS_SEED = {
    "MURO": [("MH", "Malla Horizontal"), ("MV", "Malla Vertical"), ("TR", "Traba Muro"),
             ("EC", "Estribo Confinamiento"), ("TC", "Traba Confinamiento"), ("CB", "Cabezal")],
    "LOSA": [("Fi", "Malla Inferior i"), ("Fs", "Malla Inferior s"), ("F'i", "Malla Superior i"),
             ("F's", "Malla Superior s"), ("F", "Refuerzo o Suple Inferior"),
             ("F'", "Refuerzo o Suple Superior"), ("SP", "Soporte Losa"), ("Rp", "Reparticion"),
             ("TRL", "Traba Losa")],
    "VIGA": [("CBS", "Cabezal Superior primera capa"), ("CBS2", "Cabezal Superior segunda capa"),
             ("CBSn", "Cabezal Superior n capa"), ("CBI", "Cabezal Inferior primera capa"),
             ("CBI2", "Cabezal Inferior segunda capa"), ("CBIn", "Cabezal Inferior n capa"),
             ("LT", "Lateral"), ("ES", "Estribo"), ("TRV", "Traba Viga")],
    "COLUMNA": [("CB", "Cabezal"), ("CB2", "Cabezal 2"), ("CBn", "Cabezal n"),
                ("TRC", "Traba Columna"), ("ESC", "Estribo Columna")],
    "FUNDACION": [("Fi", "Malla Inferior i"), ("Fs", "Malla Inferior s"),
                  ("F'i", "Malla Superior i"), ("F's", "Malla Superior s"),
                  ("SPF", "Soporte Fundacion"), ("TRF", "Traba Fundacion")],
    "GEN": [("CB", "Cabezal"), ("F", "Refuerzo o Suple Inferior"), ("F'", "Refuerzo o Suple Superior")],
}

# Figuras aplicables por tipología (estructura-codigo -> [figuras])
_FIGURAS_POR_TIPO_SEED = {
    "MURO-MH": ["101A", "102A", "102B", "102C", "103A", "103G"],
    "MURO-MV": ["101A", "102A", "102B", "102C", "103A", "103G"],
    "MURO-TR": ["101A", "102A", "103A", "104A"],
    "MURO-EC": ["103H", "103E", "104D", "104O", "104P"],
    "MURO-TC": ["101A", "102A", "102B", "102C"],
    "MURO-CB": ["101A", "102A", "102B", "102C", "103A", "103B"],
    "LOSA-Fi": ["101A", "102A", "103A", "104A", "105A"],
    "LOSA-Fs": ["101A", "102A", "103A", "104A", "105A"],
    "LOSA-F'i": ["101A", "102A", "103A", "104A", "105A"],
    "LOSA-F's": ["101A", "102A", "103A", "104A", "105A"],
    "LOSA-F": ["101A", "102A", "103A"],
    "LOSA-F'": ["101A", "102A", "103A"],
    "LOSA-SP": ["101A"],
    "LOSA-Rp": ["101A", "102A"],
    "LOSA-TRL": ["101A", "102A", "103A", "104A"],
    "VIGA-CBS": ["101A", "102A", "102B", "102C", "103A", "103B", "103C", "103D"],
    "VIGA-CBS2": ["101A", "102A", "102B", "102C", "103A"],
    "VIGA-CBSn": ["101A", "102A", "102B", "102C", "103A"],
    "VIGA-CBI": ["101A", "102A", "102B", "102C", "103A", "103B", "103C", "103D"],
    "VIGA-CBI2": ["101A", "102A", "102B", "102C", "103A"],
    "VIGA-CBIn": ["101A", "102A", "102B", "102C", "103A"],
    "VIGA-LT": ["101A", "102A", "103A"],
    "VIGA-ES": ["103H", "103E", "104D", "104O", "104P"],
    "VIGA-TRV": ["101A", "102A"],
    "COLUMNA-CB": ["101A", "102A", "102B", "102C", "103A", "103B"],
    "COLUMNA-CB2": ["101A", "102A", "102B", "102C"],
    "COLUMNA-CBn": ["101A", "102A", "102B", "102C"],
    "COLUMNA-TRC": ["101A", "102A"],
    "COLUMNA-ESC": ["103H", "103E", "104D", "104O"],
    "FUNDACION-Fi": ["101A", "102A", "103A", "104A", "105A"],
    "FUNDACION-Fs": ["101A", "102A", "103A", "104A", "105A"],
    "FUNDACION-F'i": ["101A", "102A", "103A", "104A", "105A"],
    "FUNDACION-F's": ["101A", "102A", "103A", "104A", "105A"],
    "FUNDACION-SPF": ["101A"],
    "FUNDACION-TRF": ["101A", "102A", "103A", "104A"],
    "GEN-CB": ["101A", "102A", "102B", "102C", "103A", "103B"],
    "GEN-F": ["101A", "102A", "103A"],
    "GEN-F'": ["101A", "102A", "103A"],
}


def seed_catalogo(cur) -> dict:
    """Carga el catálogo semilla de forma idempotente. Solo inserta lo que falta
    (no pisa ediciones futuras hechas desde la UI). Se llama al arrancar la app,
    después de las migraciones. Retorna conteos de lo insertado."""
    n_fig = n_tip = n_rel = 0

    # Figuras
    for codigo, parciales, angulos, radio in _FIGURAS_SEED:
        cur.execute(
            """INSERT INTO figuras_catalogo (codigo, parciales, angulos, radio)
               VALUES (%s, %s, %s, %s) ON CONFLICT (codigo) DO NOTHING""",
            (codigo, parciales, angulos, radio),
        )
        n_fig += cur.rowcount

    # Tipologías
    tip_ids = {}  # (estructura, codigo) -> id
    for estructura, tipos in _TIPOLOGIAS_SEED.items():
        for codigo, nombre in tipos:
            cur.execute(
                """INSERT INTO tipologias_catalogo (estructura, codigo, nombre)
                   VALUES (%s, %s, %s) ON CONFLICT (estructura, codigo) DO NOTHING""",
                (estructura, codigo, nombre),
            )
            n_tip += cur.rowcount
            cur.execute(
                "SELECT id FROM tipologias_catalogo WHERE estructura = %s AND codigo = %s",
                (estructura, codigo),
            )
            row = cur.fetchone()
            if row:
                tip_ids[(estructura, codigo)] = row[0]

    # Relación tipología → figuras
    for key, figuras in _FIGURAS_POR_TIPO_SEED.items():
        estructura, _, codigo = key.partition("-")
        tip_id = tip_ids.get((estructura, codigo))
        if not tip_id:
            continue
        for fig in figuras:
            cur.execute(
                """INSERT INTO tipologia_figuras (tipologia_id, figura_codigo)
                   VALUES (%s, %s) ON CONFLICT (tipologia_id, figura_codigo) DO NOTHING""",
                (tip_id, fig),
            )
            n_rel += cur.rowcount

    return {"figuras": n_fig, "tipologias": n_tip, "relaciones": n_rel}


# ============================================================================
# ENDPOINTS DE LECTURA (5M.1) — CRUD de edición viene en Fase 8
# ============================================================================

@router.get("/figuras-catalogo")
def listar_figuras(activo: Optional[bool] = True, user=Depends(get_current_user)):
    """Catálogo de figuras. Lo consumen Bar Manager (validación/filtros) y el editor."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            where = " WHERE activo = TRUE" if activo else ""
            cur.execute(f"""
                SELECT codigo, parciales, angulos, radio, descripcion, activo
                FROM figuras_catalogo{where} ORDER BY codigo
            """)
            rows = cur.fetchall()
    return {
        "figuras": [
            {"codigo": r[0], "parciales": r[1] or [], "angulos": r[2] or [],
             "radio": bool(r[3]), "descripcion": r[4], "activo": r[5]}
            for r in rows
        ]
    }


@router.get("/tipologias")
def listar_tipologias(user=Depends(get_current_user)):
    """Tipologías por estructura + las figuras que aplican a cada una."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT t.id, t.estructura, t.codigo, t.nombre,
                       COALESCE(ARRAY_AGG(tf.figura_codigo) FILTER (WHERE tf.figura_codigo IS NOT NULL), '{}')
                FROM tipologias_catalogo t
                LEFT JOIN tipologia_figuras tf ON tf.tipologia_id = t.id
                WHERE t.activo = TRUE
                GROUP BY t.id, t.estructura, t.codigo, t.nombre
                ORDER BY t.estructura, t.codigo
            """)
            rows = cur.fetchall()
    return {
        "tipologias": [
            {"id": r[0], "estructura": r[1], "codigo": r[2], "nombre": r[3],
             "figuras": sorted(r[4] or [])}
            for r in rows
        ]
    }
