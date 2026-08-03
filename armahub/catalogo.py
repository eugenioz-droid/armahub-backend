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


def reparar_parciales_vacios(cur) -> int:
    """Repara en la BD las figuras que quedaron con `parciales` vacío pero SÍ tienen geometría
    dibujada (bug histórico del Diseñador que podía guardar parciales=[]). Deriva los lados de
    geometria.tramos y los escribe de vuelta. Se ejecuta en el arranque; idempotente (una figura
    ya reparada no vuelve a entrar). Corrige la data de raíz — sin esto, esas figuras marcan sus
    barras como 'geometría inválida'."""
    import json as _json
    cur.execute("""
        SELECT codigo, geometria FROM figuras_catalogo
        WHERE (parciales IS NULL OR parciales = '{}') AND geometria IS NOT NULL
    """)
    filas = cur.fetchall()
    reparadas = 0
    for codigo, geometria in filas:
        try:
            g = geometria if isinstance(geometria, dict) else _json.loads(geometria)
            tramos = (g or {}).get("tramos") or []
            lados = [t.get("lado") for t in tramos
                     if t.get("lado") and str(t.get("lado")).isalpha() and len(str(t.get("lado"))) == 1]
            if not lados:
                continue
            cur.execute("UPDATE figuras_catalogo SET parciales = %s WHERE codigo = %s", (lados, codigo))
            reparadas += 1
        except Exception:
            continue
    return reparadas


# ============================================================================
# VALIDACIÓN DE GEOMETRÍA (5M.4)
# ============================================================================

# Mapa slot (letra del catálogo) → columna dim de barras.
_SLOT_A_DIM = {L: f"dim_{L.lower()}" for L in "ABCDEFGHI"}
_ANG_COLS = ["ang1", "ang2", "ang3", "ang4"]


def get_figura(cur, codigo: str):
    """Devuelve {parciales, angulos, radio} de una figura, o None si no existe.
    Robusto al tipo de cursor (tupla o dict_row): accede por nombre de columna."""
    if not codigo:
        return None
    cur.execute("SELECT parciales, angulos, radio FROM figuras_catalogo WHERE codigo = %s", (codigo,))
    row = cur.fetchone()
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


def largo_desde_lados(cur, codigo_figura: str, valores: dict):
    """Largo = suma de los lados (dims) que la figura USA (5M.4). None si no hay
    figura o falta algún lado usado."""
    fig = get_figura(cur, codigo_figura)
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


def validar_geometria(cur, codigo_figura: str, valores: dict) -> dict:
    """Valida la geometría de una barra contra el catálogo (5M.4).
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
    fig = get_figura(cur, codigo_figura)
    if fig is None:
        return {"ok": False, "errores": [f"La figura '{codigo_figura}' no existe en el catálogo."],
                "slots_sobran": [], "slots_faltan": []}

    usados = set(fig["parciales"])
    n_ang = len(fig["angulos"] or [])
    usa_radio = fig["radio"]
    slots_faltan, slots_sobran = [], []

    # Dims
    for letra, dim_col in _SLOT_A_DIM.items():
        usa = letra in usados
        tiene = _tiene_valor_real(valores.get(dim_col))
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
    if slots_faltan:
        errores.append("Falta(n): " + ", ".join(_lbl(s) for s in slots_faltan) + ".")
    if slots_sobran:
        errores.append("Sobra(n) para la figura " + codigo_figura + " — déjalo(s) vacío(s): "
                       + ", ".join(_lbl(s) for s in slots_sobran) + ".")

    return {"ok": len(errores) == 0, "errores": errores,
            "slots_sobran": slots_sobran, "slots_faltan": slots_faltan}


# ============================================================================
# ENDPOINTS DE LECTURA (5M.1) — CRUD de edición viene en Fase 8
# ============================================================================

@router.get("/figuras-catalogo/_diag/{codigo}")
def _diag_figura(codigo: str, user=Depends(get_current_user)):
    """DIAGNÓSTICO TEMPORAL: devuelve el dato CRUDO de una figura para depurar la validación.
    Muestra parciales (con repr para ver espacios/caja), tipo, y los tramos de la geometría."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT codigo, parciales, angulos, radio, geometria FROM figuras_catalogo WHERE codigo = %s", (codigo,))
            r = cur.fetchone()
            if not r:
                return {"encontrada": False, "codigo": codigo}
            parciales = r[1]
            geo = r[4]
            import json as _json
            tramos = []
            try:
                g = geo if isinstance(geo, dict) else (_json.loads(geo) if geo else {})
                tramos = [{"lado": t.get("lado"), "lado_repr": repr(t.get("lado"))} for t in (g.get("tramos") or [])]
            except Exception as e:
                tramos = [{"error": str(e)}]
            return {
                "encontrada": True, "codigo": r[0],
                "parciales": parciales,
                "parciales_repr": [repr(x) for x in (parciales or [])],
                "parciales_tipo": str(type(parciales)),
                "angulos": r[2], "radio": r[3],
                "tiene_geometria": geo is not None,
                "tramos": tramos,
            }


@router.get("/figuras-catalogo")
def listar_figuras(activo: Optional[bool] = True, user=Depends(get_current_user)):
    """Catálogo de figuras. Lo consumen Bar Manager (validación/filtros) y el editor."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            where = " WHERE activo = TRUE" if activo else ""
            cur.execute(f"""
                SELECT codigo, parciales, angulos, radio, descripcion, activo, geometria
                FROM figuras_catalogo{where} ORDER BY codigo
            """)
            rows = cur.fetchall()
    return {
        "figuras": [
            {"codigo": r[0], "parciales": r[1] or [], "angulos": r[2] or [],
             "radio": bool(r[3]), "descripcion": r[4], "activo": r[5],
             "geometria": r[6]}   # 5M.8: JSON de armado (o None si sin render)
            for r in rows
        ]
    }


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
    """Elimina una figura del catálogo (5M.8). Solo admin. Data maestra: se borra
    de verdad (no soft-delete) porque el diseñador la puede recrear."""
    from fastapi import HTTPException
    rol = (user.get("role") or "").lower()
    if rol not in ("admin", "admin_calidad"):
        raise HTTPException(status_code=403, detail="Solo un administrador puede eliminar figuras del catálogo.")
    codigo = (codigo or "").strip()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM figuras_catalogo WHERE codigo = %s", (codigo,))
            n = cur.rowcount or 0
    if n == 0:
        raise HTTPException(status_code=404, detail=f"Figura '{codigo}' no encontrada.")
    try:
        from .db import audit
        audit(user.get("email", "?"), "eliminar_figura_catalogo", codigo, "figura", codigo)
    except Exception:
        pass
    return {"ok": True, "codigo": codigo}


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
