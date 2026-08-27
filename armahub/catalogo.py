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

import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .auth import get_current_user
from .db import get_conn


def _now_iso():
    return datetime.now(timezone.utc).isoformat()

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
            # RECONCILIACIÓN DE FIGURAS NUNCA DIBUJADAS (15-ago). Antes era
            # `DO NOTHING`: una fila sembrada con una versión vieja del seed se
            # quedaba vieja PARA SIEMPRE. Caso real: la 106A quedó con 3 parciales
            # en producción mientras el seed declara sus 6 (A-F), y la ficha del
            # editor —que muestra los parciales que dice el catálogo— sólo ofrecía
            # A, B y C: la figura era ineditable en sus otros 3 lados.
            # SOLO se reconcilia lo que NADIE dibujó: `geometria IS NULL` marca
            # las filas que nunca pasaron por el Diseñador (que sí escribe
            # parciales/ángulos junto con su geometría). Así una figura que el
            # usuario dibujó jamás se pisa con la semilla.
            """INSERT INTO figuras_catalogo (codigo, parciales, angulos, radio)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (codigo) DO UPDATE SET
                   parciales = EXCLUDED.parciales,
                   angulos   = EXCLUDED.angulos,
                   radio     = EXCLUDED.radio
               WHERE figuras_catalogo.geometria IS NULL
                 AND (figuras_catalogo.parciales IS DISTINCT FROM EXCLUDED.parciales
                      OR figuras_catalogo.angulos IS DISTINCT FROM EXCLUDED.angulos
                      OR figuras_catalogo.radio   IS DISTINCT FROM EXCLUDED.radio)""",
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
# VALIDACIÓN DE GEOMETRÍA (5M.4)
# ============================================================================

# Mapa slot (letra del catálogo) → columna dim de barras.
_SLOT_A_DIM = {L: f"dim_{L.lower()}" for L in "ABCDEFGHI"}
_ANG_COLS = ["ang1", "ang2", "ang3", "ang4"]


class CatalogoFiguras:
    """El catálogo de figuras LEÍDO DE UNA VEZ, para pasárselo a las operaciones que
    validan MUCHAS barras seguidas en lugar del cursor.

    POR QUÉ EXISTE (medido el 25-ago sobre el muro de 825 barras del usuario):
    `get_figura` hace UNA consulta por llamada, y cada barra que se carga al despiece
    la llama DOS veces — `validar_geometria` y `largo_desde_lados`. O sea 2 SELECT a
    figuras_catalogo POR BARRA: 1.650 de las 2.483 consultas del request (66%), y cada
    una es un round-trip Render→Supabase por la red. Con este snapshot el mismo request
    baja a 833 consultas y el catálogo se lee UNA vez.

    NO es un caché global ni con TTL A PROPÓSITO: vive lo que dura la llamada que lo
    creó, se lee dentro de la MISMA transacción que las barras (misma foto, misma
    consistencia que consultando barra por barra) y muere con ella. Por eso editar el
    catálogo (POST /figuras-catalogo, DELETE) no tiene NADA que invalidar: la carga
    siguiente lo vuelve a leer. Un caché entre requests sí habría necesitado
    invalidación, y en Render son varios workers: no habría forma de propagarla.

    Devuelve EXACTAMENTE lo mismo que get_figura contra la BD, None incluido para una
    figura que no está.
    """

    __slots__ = ("_figs",)

    def __init__(self, figs: dict):
        self._figs = figs

    def get(self, codigo):
        if not codigo:
            return None
        return self._figs.get(codigo)

    def __len__(self):
        return len(self._figs)

    def __contains__(self, codigo):
        return codigo in self._figs


def cargar_figuras(cur, codigos=None) -> CatalogoFiguras:
    """Lee en UNA consulta las figuras cuyos códigos se piden (o el catálogo entero si
    `codigos` es None) y devuelve el snapshot que consumen get_figura /
    largo_desde_lados / validar_geometria.

    OJO: hay que pasarle TODOS los códigos que se van a consultar después — un código
    ausente de la lista se comporta como "figura inexistente". Los call sites arman el
    conjunto recorriendo la MISMA lista de barras/componentes que después validan.

    Mismas columnas y mismo criterio que get_figura: NO filtra por `activo` (validar
    una barra mira la figura que la barra DICE tener, esté activa o no)."""
    figs = {}
    if codigos is None:
        cur.execute("SELECT codigo, parciales, angulos, radio FROM figuras_catalogo")
    else:
        pedidos = sorted({c for c in codigos if c})
        if not pedidos:
            return CatalogoFiguras(figs)
        cur.execute(
            "SELECT codigo, parciales, angulos, radio FROM figuras_catalogo WHERE codigo = ANY(%s)",
            (pedidos,),
        )
    for row in cur.fetchall():
        # dict_row → acceso por clave; tupla → por índice (mismo criterio que get_figura).
        if isinstance(row, dict):
            cod, p, a, r = row.get("codigo"), row.get("parciales"), row.get("angulos"), row.get("radio")
        else:
            cod, p, a, r = row[0], row[1], row[2], row[3]
        figs[cod] = {"parciales": p or [], "angulos": a or [], "radio": bool(r)}
    return CatalogoFiguras(figs)


def get_figura(fuente, codigo: str):
    """Devuelve {parciales, angulos, radio} de una figura, o None si no existe.

    `fuente` es un CURSOR (lee esa figura de la BD: 1 consulta) o un CatalogoFiguras ya
    leído (no toca la BD). Lo segundo es lo que usan las cargas de muchas barras — ver
    CatalogoFiguras para el porqué y los números.
    Robusto al tipo de cursor (tupla o dict_row): accede por nombre de columna."""
    if not codigo:
        return None
    if isinstance(fuente, CatalogoFiguras):
        return fuente.get(codigo)
    fuente.execute("SELECT parciales, angulos, radio FROM figuras_catalogo WHERE codigo = %s", (codigo,))
    row = fuente.fetchone()
    if not row:
        return None
    # dict_row → acceso por clave; tupla → por índice.
    if isinstance(row, dict):
        return {"parciales": row.get("parciales") or [], "angulos": row.get("angulos") or [], "radio": bool(row.get("radio"))}
    return {"parciales": row[0] or [], "angulos": row[1] or [], "radio": bool(row[2])}


def _tiene_valor_real(v):
    """Un slot tiene valor REAL si no es None/vacío Y es distinto de 0.
    En la data de origen, los lados que la figura no usa vienen en 0 (no NULL).
    Por eso 0 y vacío = 'no existe'; solo un valor ≠ 0 cuenta como presente."""
    if v is None:
        return False
    s = str(v).strip()
    if s == "" or s.lower() == "none":
        return False
    try:
        return float(s) != 0
    except (ValueError, TypeError):
        return False


def largo_desde_lados(fuente, codigo_figura: str, valores: dict):
    """Largo = suma de los lados (dims) que la figura USA (5M.4). None si no hay
    figura o falta algún lado usado.
    `fuente`: cursor o CatalogoFiguras ya leído (ver get_figura)."""
    fig = get_figura(fuente, codigo_figura)
    if fig is None:
        return None
    total = 0.0
    for letra in fig["parciales"]:
        # Normalizar la letra del parcial: mayúscula y sin espacios. Si viene una
        # letra fuera de A-I (data sucia en el catálogo), se ignora ese parcial en
        # vez de reventar con KeyError (que provocaba un 500 al guardar la barra).
        dim_col = _SLOT_A_DIM.get(str(letra).strip().upper())
        if dim_col is None:
            continue
        v = valores.get(dim_col)
        try:
            total += float(v)
        except (ValueError, TypeError):
            return None  # falta un lado usado → no se puede calcular aún
    return total


def validar_geometria(fuente, codigo_figura: str, valores: dict) -> dict:
    """Valida la geometría de una barra contra el catálogo (5M.4).
    `fuente`: cursor o CatalogoFiguras ya leído (ver get_figura). La validación es la
    MISMA en los dos casos — lo único que cambia es de dónde sale la figura.
    `valores`: dict con dim_a..dim_i, ang1..ang4, radio (los valores EFECTIVOS tras editar).
    Reglas:
      - La figura debe existir en el catálogo.
      - Los slots (dims) que la figura USA deben tener valor; los que NO usa deben estar
        VACÍOS (null). Un slot que no va con valor (incl. 0) → SOBRA.
      - Ángulos: la figura usa N ángulos (len de su lista). Los ang más allá de N deben
        estar vacíos; los primeros N deben tener valor.
      - Radio: si la figura NO usa radio, radio debe estar vacío; si lo usa, con valor.
    Retorna {ok, errores, slots_sobran, slots_faltan} donde los slots incluyen
    dim_x, angN y 'radio' (columnas a resaltar en el front)."""
    fig = get_figura(fuente, codigo_figura)
    if fig is None:
        return {"ok": False, "errores": [f"La figura '{codigo_figura}' no existe en el catálogo."],
                "slots_sobran": [], "slots_faltan": []}

    usados = set(fig["parciales"])
    n_ang = len(fig["angulos"] or [])
    usa_radio = fig["radio"]
    slots_faltan, slots_sobran = [], []

    # Dims. NEGATIVAS (15-ago): una medida negativa NO es una barra real — antes
    # pasaba (_tiene_valor_real(-452) es True porque solo pregunta ≠ 0) y aguas
    # abajo largo_desde_lados la sumaba tal cual: quedaban barras con largo y PESO
    # NEGATIVOS insertadas en el despiece (medido: Δ −1000 en un lado auto →
    # dim_b −452, kg −12.4, todo con 200). El editor puede DIBUJAR el negativo
    # (dato honesto, con aviso); persistirlo en la facturación, jamás.
    slots_negativos = []
    for letra, dim_col in _SLOT_A_DIM.items():
        usa = letra in usados
        v = valores.get(dim_col)
        tiene = _tiene_valor_real(v)
        if tiene:
            try:
                if float(str(v).strip()) < 0:
                    slots_negativos.append(dim_col)
                    continue
            except (ValueError, TypeError):
                pass
        if usa and not tiene:
            slots_faltan.append(dim_col)
        elif not usa and tiene:
            slots_sobran.append(dim_col)

    # Ángulos: los primeros n_ang deben tener valor; el resto vacío.
    for i, ang_col in enumerate(_ANG_COLS):
        usa = i < n_ang
        tiene = _tiene_valor_real(valores.get(ang_col))
        if usa and not tiene:
            slots_faltan.append(ang_col)
        elif not usa and tiene:
            slots_sobran.append(ang_col)

    # Radio
    tiene_r = _tiene_valor_real(valores.get("radio"))
    if usa_radio and not tiene_r:
        slots_faltan.append("radio")
    elif not usa_radio and tiene_r:
        slots_sobran.append("radio")

    def _lbl(col):
        if col.startswith("dim_"):
            return "lado " + col.split("_")[1].upper()
        if col.startswith("ang"):
            return "ángulo " + col[3:]
        return "radio"

    errores = []
    if slots_negativos:
        errores.append("Medida NEGATIVA en " + ", ".join(_lbl(s) for s in slots_negativos) +
                       ": una barra no puede tener un lado negativo (revisa el Δ o la medida).")
    if slots_faltan:
        errores.append("Falta(n): " + ", ".join(_lbl(s) for s in slots_faltan) + ".")
    if slots_sobran:
        errores.append("Sobra(n) para la figura " + codigo_figura + " — déjalo(s) vacío(s): "
                       + ", ".join(_lbl(s) for s in slots_sobran) + ".")
    # los negativos también van en slots_faltan para que el front los RESALTE
    # (misma columna, mismo mecanismo de pintado que un slot ausente).
    slots_faltan = slots_negativos + slots_faltan

    return {"ok": len(errores) == 0, "errores": errores,
            "slots_sobran": slots_sobran, "slots_faltan": slots_faltan}


# ============================================================================
# ENDPOINTS DE LECTURA (5M.1) — CRUD de edición viene en Fase 8
# ============================================================================

@router.get("/figuras-catalogo")
def listar_figuras(activo: Optional[bool] = True, incluir_obsoletas: bool = False,
                   user=Depends(get_current_user)):
    """Catálogo de figuras. Lo consumen Bar Manager (validación/filtros) y el editor.

    RESOLVER TODO, OFRECER SÓLO LO ACTIVO (26-ago). Con el soft erase existen figuras
    OBSOLETAS: retiradas del catálogo pero todavía referenciadas por recetas que hay
    que poder dibujar y generar. Son dos preguntas distintas y por eso son dos
    llamadas distintas:
      · un SELECTOR de figura (el picker del editor, el datalist del Bar Manager, el
        select del creador) pregunta «¿qué puedo elegir?» → sólo activas, el default;
      · el MOTOR pregunta «¿qué significa este código?» → `incluir_obsoletas=true`.
    Si el motor no las recibiera, un template repuntado a una obsoleta no podría
    dibujarse ni generar barras: es el punto exacto donde este esquema se cae si la
    asimetría no se hace a propósito.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            where = " WHERE activo = TRUE" if (activo and not incluir_obsoletas) else ""
            cur.execute(f"""
                SELECT codigo, parciales, angulos, radio, descripcion, activo, geometria,
                       obsoleta_de
                FROM figuras_catalogo{where} ORDER BY codigo
            """)
            rows = cur.fetchall()
    return {
        "figuras": [
            {"codigo": r[0], "parciales": r[1] or [], "angulos": r[2] or [],
             "radio": bool(r[3]), "descripcion": r[4], "activo": r[5],
             "geometria": r[6],   # 5M.8: JSON de armado (o None si sin render)
             "obsoleta_de": r[7]}
            for r in rows
        ]
    }


# ---------------------------------------------------------------------------
# SOFT ERASE — el código obsoleto
# ---------------------------------------------------------------------------
# FORMATO: el código original + '~' + un correlativo → `104B~1`, `104B~2`…
#   · '~' porque no aparece en ningún código del catálogo Armacero (todos son
#     dígitos + letra) ni en los de aSa Studio, y se ordena DESPUÉS de las letras y
#     los dígitos en ASCII, así que las obsoletas caen juntas al final de cualquier
#     lista ordenada por código sin tener que filtrarlas.
#   · CORRELATIVO porque el mismo código se puede retirar más de una vez: redibujas
#     104B, no te gusta, lo retiras otra vez. Sin número, la segunda pisaría a la
#     primera y se perdería la receta de un template viejo.
#   · Y como el código es texto libre, el carácter queda PROHIBIDO al crear (ver
#     crear_o_actualizar_figura): sin eso, un usuario podría crear `104B~1` a mano y
#     colisionar con una obsoleta. El esquema entero descansa en que '~' sea nuestro.
MARCA_OBSOLETA = "~"


def _codigo_obsoleto(cur, codigo: str) -> str:
    """Siguiente código obsoleto libre para `codigo`. Cuenta los que ya existen en vez
    de leer un contador: el dato ya está en la tabla y no hay nada que mantener."""
    cur.execute(
        "SELECT codigo FROM figuras_catalogo WHERE codigo LIKE %s",
        (codigo + MARCA_OBSOLETA + "%",),
    )
    usados = set()
    for (c,) in cur.fetchall():
        suf = c[len(codigo) + 1:]
        if suf.isdigit():
            usados.add(int(suf))
    n = 1
    while n in usados:
        n += 1
    return f"{codigo}{MARCA_OBSOLETA}{n}"


# Las dos tablas que guardan RECETAS con `params.componentes[].figura`. Las dos
# regeneran barras contra el catálogo, así que las dos hay que repuntarlas: los
# templates (la biblioteca) y las estructuras ya cargadas a un despiece — si sólo se
# repuntara la primera, reabrir una estructura y actualizarla le cambiaría la
# geometría en silencio, que es el defecto que este mecanismo viene a evitar.
_TABLAS_RECETA = ("templates_catalogo", "elementos_template")


def _repuntar_recetas(cur, viejo: str, nuevo: str) -> dict:
    """Cambia `viejo` → `nuevo` en la figura de cada componente, en las dos tablas de
    recetas. UNA sentencia por tabla (nada de leer N recetas a Python y reescribirlas:
    es el N+1 que ya costó caro en lotes.py). Devuelve cuántas filas tocó cada una."""
    tocadas = {}
    for tabla in _TABLAS_RECETA:
        cur.execute(
            f"""
            UPDATE {tabla} t
               SET params = jsonb_set(t.params, '{{componentes}}', (
                     SELECT COALESCE(jsonb_agg(
                              CASE WHEN x.c->>'figura' = %s
                                   THEN jsonb_set(x.c, '{{figura}}', to_jsonb(%s::text))
                                   ELSE x.c END
                              ORDER BY x.ord), '[]'::jsonb)
                       FROM jsonb_array_elements(t.params->'componentes')
                            WITH ORDINALITY AS x(c, ord)))
             WHERE jsonb_typeof(t.params->'componentes') = 'array'
               AND t.params->'componentes' @> %s::jsonb
            """,
            (viejo, nuevo, json.dumps([{"figura": viejo}])),
        )
        tocadas[tabla] = cur.rowcount or 0
    return tocadas


def _uso_de_figura(cur, codigo: str) -> dict:
    """Dónde se usa una figura. Se dice ANTES de retirarla, con números reales: una
    advertencia genérica no deja decidir. Las BARRAS son informativas — no se tocan
    nunca en este flujo, porque llevan su propia geometría."""
    cur.execute("SELECT COUNT(*) FROM barras WHERE figura = %s", (codigo,))
    barras = int(cur.fetchone()[0] or 0)
    conteo = {"barras": barras}
    ref = json.dumps([{"figura": codigo}])
    for tabla in _TABLAS_RECETA:
        cur.execute(
            f"""SELECT COUNT(*) FROM {tabla}
                 WHERE jsonb_typeof(params->'componentes') = 'array'
                   AND params->'componentes' @> %s::jsonb""",
            (ref,),
        )
        conteo[tabla] = int(cur.fetchone()[0] or 0)
    return conteo


@router.get("/figuras-catalogo/{codigo}/uso")
def uso_figura(codigo: str, user=Depends(get_current_user)):
    """Cuántas barras, templates y estructuras referencian esta figura. Lo pide la
    confirmación de retirar, para que el admin decida con el número a la vista."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            u = _uso_de_figura(cur, (codigo or "").strip())
    return {"codigo": codigo, "barras": u["barras"],
            "templates": u["templates_catalogo"], "estructuras": u["elementos_template"]}


@router.get("/figuras-catalogo-obsoletas")
def listar_obsoletas(user=Depends(get_current_user)):
    """Las figuras retiradas, para poder VISITARLAS (pedido del usuario). Cada una
    dice de qué código viene, cuándo se retiró y si su código original está libre —
    que es la única condición para poder reactivarla."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT o.codigo, o.obsoleta_de, o.retirada_fecha, o.retirada_por,
                       o.parciales, o.angulos, o.radio, o.geometria,
                       EXISTS (SELECT 1 FROM figuras_catalogo v WHERE v.codigo = o.obsoleta_de)
                  FROM figuras_catalogo o
                 WHERE o.obsoleta_de IS NOT NULL
                 ORDER BY o.retirada_fecha DESC NULLS LAST, o.codigo
            """)
            rows = cur.fetchall()
    return {"obsoletas": [
        {"codigo": r[0], "obsoleta_de": r[1], "retirada_fecha": r[2], "retirada_por": r[3],
         "parciales": r[4] or [], "angulos": r[5] or [], "radio": bool(r[6]),
         "geometria": r[7], "codigo_ocupado": bool(r[8])}
        for r in rows
    ]}


@router.post("/figuras-catalogo/{codigo}/reactivar")
def reactivar_figura(codigo: str, user=Depends(get_current_user)):
    """Deshace un retiro: la obsoleta vuelve a su código original y a estar activa,
    y las recetas que se le repuntaron vuelven con ella.

    SÓLO si el código original sigue LIBRE. Si alguien ya redibujó ahí, reactivar
    significaría dos figuras con el mismo código: se rechaza con 409 diciendo por qué,
    en vez de inventar un desempate."""
    from fastapi import HTTPException
    if not _puede_editar_catalogo(user):
        raise HTTPException(status_code=403, detail="No tienes permiso para editar el catálogo de figuras.")
    codigo = (codigo or "").strip()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT obsoleta_de FROM figuras_catalogo WHERE codigo = %s", (codigo,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail=f"Figura '{codigo}' no encontrada.")
            original = r[0]
            if not original:
                raise HTTPException(status_code=400, detail=f"'{codigo}' no es una figura retirada.")
            cur.execute("SELECT 1 FROM figuras_catalogo WHERE codigo = %s", (original,))
            if cur.fetchone():
                raise HTTPException(status_code=409, detail=(
                    f"No se puede reactivar: el código '{original}' ya está ocupado por otra figura. "
                    f"Para recuperar ésta, primero retira la que ocupa ese código."))
            tocadas = _repuntar_recetas(cur, codigo, original)
            cur.execute(
                """UPDATE figuras_catalogo
                      SET codigo = %s, activo = TRUE, obsoleta_de = NULL,
                          retirada_fecha = NULL, retirada_por = NULL
                    WHERE codigo = %s""",
                (original, codigo),
            )
    try:
        from .db import audit
        audit(user.get("email", "?"), "reactivar_figura_catalogo",
              f"{codigo} → {original} · recetas repuntadas: "
              f"{tocadas['templates_catalogo']} templates, {tocadas['elementos_template']} estructuras",
              "figura", original)
    except Exception:
        pass
    return {"ok": True, "codigo": original, "desde": codigo,
            "templates": tocadas["templates_catalogo"],
            "estructuras": tocadas["elementos_template"]}


class FiguraCrear(BaseModel):
    codigo: str
    parciales: list = []
    angulos: list = []
    radio: bool = False
    descripcion: Optional[str] = None
    geometria: Optional[dict] = None   # { dim, tramos:[{lado,giro,sentido}] }


# 5M.8: quién puede crear/editar/eliminar figuras del catálogo. Base = admins.
# EXTRA = override por email para colaboradores puntuales (ej. cubicadores que
# ayudan a poblar el catálogo) sin darles rol admin. Agregar un email aquí es una
# línea. Pendiente "bien hecho": permiso configurable en Admin (no urgente).
_FIGURAS_EDITORES_EXTRA = {
    "nicolas.lopez@armacero.cl",   # cubicador — ayuda a completar el catálogo
}

def _puede_editar_catalogo(user) -> bool:
    rol = (user.get("role") or "").lower()
    if rol in ("admin", "admin_calidad"):
        return True
    email = (user.get("email") or "").strip().lower()
    return email in _FIGURAS_EDITORES_EXTRA


@router.post("/figuras-catalogo")
def crear_o_actualizar_figura(body: FiguraCrear, user=Depends(get_current_user)):
    """Crea una figura NUEVA o actualiza su geometría (5M.8 Diseñador). El
    catálogo es data maestra → admins + editores extra (override por email).
    UPSERT por código: permite crear figuras nuevas dibujadas Y poblar la
    geometría de figuras que ya existían (el trabajo de render 1×1). NO borra
    data: si la figura ya existe, actualiza geometría/parciales/ángulos; el resto
    se conserva."""
    import json
    if not _puede_editar_catalogo(user):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="No tienes permiso para crear/editar figuras del catálogo.")
    codigo = (body.codigo or "").strip()
    if not codigo:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="El código/nombre de la figura es obligatorio.")
    # EL '~' ES NUESTRO (26-ago). El soft erase renombra la figura retirada a
    # `104B~1`, y eso sólo es seguro si nadie puede crear un código así a mano: si un
    # usuario creara `104B~1`, chocaría con la obsoleta y una de las dos perdería su
    # receta. Se bloquea al crear, que es la única puerta por donde entra un código
    # nuevo, y se dice por qué en vez de rechazarlo con un error mudo.
    if MARCA_OBSOLETA in codigo:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=(
            f"El código no puede llevar '{MARCA_OBSOLETA}': ese carácter lo usa el sistema "
            f"para marcar las figuras retiradas (por ejemplo 104B{MARCA_OBSOLETA}1)."))
    geo_json = json.dumps(body.geometria) if body.geometria is not None else None
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO figuras_catalogo (codigo, parciales, angulos, radio, descripcion, geometria, activo)
                VALUES (%s, %s, %s, %s, %s, %s, TRUE)
                ON CONFLICT (codigo) DO UPDATE SET
                    parciales   = EXCLUDED.parciales,
                    angulos     = EXCLUDED.angulos,
                    radio       = EXCLUDED.radio,
                    geometria   = EXCLUDED.geometria,
                    descripcion = COALESCE(EXCLUDED.descripcion, figuras_catalogo.descripcion)
                """,
                (codigo, body.parciales, body.angulos, body.radio, body.descripcion, geo_json),
            )
    try:
        from .db import audit
        audit(user.get("email", "?"), "guardar_figura_catalogo", codigo, "figura", codigo)
    except Exception:
        pass
    return {"ok": True, "codigo": codigo}


@router.delete("/figuras-catalogo/{codigo}")
def eliminar_figura(codigo: str, user=Depends(get_current_user)):
    """RETIRA una figura del catálogo: no la destruye. Solo admin.

    ANTES BORRABA DE VERDAD, con este argumento: «data maestra: se borra de verdad
    porque el diseñador la puede recrear». El argumento era cierto para la FIGURA y
    falso para todo lo que la referenciaba: entre el borrado y el redibujo, los
    templates que la usaban generaban un componente MENOS, y al actualizar una
    estructura en su despiece esas barras se borraban. Perdías fierro sin tocar el
    despiece.

    QUÉ HACE AHORA, en una transacción:
      · la figura pasa a un código obsoleto (`104B` → `104B~1`) y queda inactiva;
      · las RECETAS que la usaban se repuntan a ese código, así que siguen dibujando
        y generando exactamente lo mismo;
      · el código original queda LIBRE para redibujarlo.

    LAS BARRAS NO SE TOCAN, y no es un olvido: una barra es autosuficiente —guarda sus
    lados, sus ángulos, su largo, su peso y el nombre de la figura— y el catálogo es
    una capa de VALIDACIÓN encima, no la fuente de su contenido. El export manda lo
    que la barra dice. Por eso una barra vieja sigue diciendo `104B` y está bien: ese
    dato describe lo que se fabricó. Lo único que regenera contra el catálogo son las
    recetas, y ésas son las que se repuntan.
    """
    from fastapi import HTTPException
    rol = (user.get("role") or "").lower()
    if rol not in ("admin", "admin_calidad"):
        raise HTTPException(status_code=403, detail="Solo un administrador puede eliminar figuras del catálogo.")
    codigo = (codigo or "").strip()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT obsoleta_de FROM figuras_catalogo WHERE codigo = %s", (codigo,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail=f"Figura '{codigo}' no encontrada.")
            if r[0]:
                raise HTTPException(status_code=400, detail=(
                    f"'{codigo}' ya es una figura retirada. Se puede reactivar, no retirar de nuevo."))
            uso = _uso_de_figura(cur, codigo)
            nuevo = _codigo_obsoleto(cur, codigo)
            # El repunte va ANTES del renombre: mientras las recetas dicen el código
            # viejo, el UPDATE las encuentra. Al revés no habría a qué apuntar.
            tocadas = _repuntar_recetas(cur, codigo, nuevo)
            cur.execute(
                """UPDATE figuras_catalogo
                      SET codigo = %s, activo = FALSE, obsoleta_de = %s,
                          retirada_fecha = %s, retirada_por = %s
                    WHERE codigo = %s""",
                (nuevo, codigo, _now_iso(), user.get("email", "?"), codigo),
            )
    try:
        from .db import audit
        audit(user.get("email", "?"), "retirar_figura_catalogo",
              f"{codigo} → {nuevo} · {tocadas['templates_catalogo']} templates y "
              f"{tocadas['elementos_template']} estructuras repuntadas · "
              f"{uso['barras']} barras intactas",
              "figura", nuevo)
    except Exception:
        pass
    return {"ok": True, "codigo": codigo, "obsoleta": nuevo,
            "templates": tocadas["templates_catalogo"],
            "estructuras": tocadas["elementos_template"],
            "barras": uso["barras"]}


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
