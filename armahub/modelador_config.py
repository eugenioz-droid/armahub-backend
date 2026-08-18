"""
modelador_config.py — CONFIGURACIÓN GLOBAL DEL MODELADOR (con qué nace cada barra).

Backend de la tarjeta «Configuración» del sub-tab Catálogo › Templates
(static/js/features/catalogo/config_modelador.js). Hasta ayer esa pantalla SÓLO
mostraba: los valores de partida vivían repartidos entre template_editor.js
(SEP_POR_TIPOLOGIA, TPL_DIMS_POR_ELEMENTO), reglas.js (TIPOLOGIA_MODO_DEFAULT) y el
catálogo (FIGURAS_POR_TIPOLOGIA), y no había forma de cambiarlos sin tocar código.

  GET /modelador/config   -> la config completa (guardada, o los defaults si no hay fila)
  PUT /modelador/config   -> guarda por SECCIONES (sólo las que vienen en el JSON)

GLOBAL, NO POR OBRA (decisión del usuario 17-ago). `obra_config` es la config del
CREADOR DE BARRAS de una obra concreta; ésta es del MODELADOR y vale para toda la
plataforma. No se cuelga de ahí a propósito: cómo conviven las dos se decide cuando se
aborde el Enfierrador.

PERMISOS — se REUSAN, no se inventa un rol nuevo:
  · ESCRIBIR: _puede_gestionar_templates (modelador.py) — quien puede crear/editar
    templates es exactamente quien decide con qué nacen. Un criterio, un lugar.
  · LEER: cualquier autenticado. El editor NECESITA leerla para arrancar con los
    valores correctos, así que cerrarla dejaría al editor cayendo siempre al fallback.

LOS DEFAULTS SON LOS VALORES QUE HOY RIGEN. Cablear esta pantalla NO puede cambiarle el
comportamiento a nadie: cada default de abajo es espejo de la constante que hoy manda,
con la fuente anotada. La ÚNICA excepción declarada es la pata del gancho (ver LARGOS).

LA FILA NO SE SIEMBRA. Mientras nadie guarde, no hay fila y el GET devuelve los DEFAULTS
con `guardada: false`. Así el día que se corrija una constante del código, la plataforma
que nunca tocó la pantalla se mueve con ella en vez de quedar clavada en una copia.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import json

from .db import get_conn, audit
from .auth import get_current_user
from .catalogo import _TIPOLOGIAS_SEED, _FIGURAS_POR_TIPO_SEED
from .diametros import DIAM_ESTANDAR

router = APIRouter()


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# ORDEN DE LOS ELEMENTOS
# ---------------------------------------------------------------------------
# VIGA y MURO primero porque son los ÚNICOS que el Template Editor sabe abrir hoy
# (_elementoConDatos): son los que el usuario va a configurar. El resto va igual —
# la config los cubre completos para que el día que el editor los soporte no haya
# que volver a pasar por acá.
ORDEN_ELEMENTOS = ["VIGA", "MURO", "LOSA", "COLUMNA", "FUNDACION", "GEN"]

# ---------------------------------------------------------------------------
# DEFAULTS · SEPARACIÓN — espejo de template_editor.js SEP_POR_TIPOLOGIA
# ---------------------------------------------------------------------------
SEP_DEFAULT = 20.0
SEP_TRABAS = 40.0
_TIPOLOGIAS_SEP_TRABA = {"TRV", "TR", "TC", "TRC", "TRL", "TRF"}

# ---------------------------------------------------------------------------
# DEFAULTS · MODO DE COLOCACIÓN — espejo de reglas.js TIPOLOGIA_MODO_DEFAULT
# ---------------------------------------------------------------------------
MODOS_VALIDOS = ("puntual", "lineal", "arreglo")
_MODO_POR_TIPOLOGIA = {
    # Longitudinales / cabezales → PUNTUAL
    "CB": "puntual", "CBS": "puntual", "CBI": "puntual", "CBS2": "puntual", "CBI2": "puntual",
    "CBSN": "puntual", "CBIN": "puntual", "LT": "puntual", "L": "puntual",
    # Estribos / trabas → LINEAL
    "ES": "lineal", "ESC": "lineal", "EC": "lineal",
    "TRV": "lineal", "TR": "lineal", "TC": "lineal", "TRC": "lineal", "TRL": "lineal", "TRF": "lineal",
    # Mallas de muro → LINEAL (distribución "MH φ8 @20", no arreglo)
    "MH": "lineal", "MV": "lineal",
    "MA": "arreglo", "MALLA": "arreglo", "TM": "arreglo", "TRM": "arreglo",
}
# Lo que NO está en la tabla de arriba. reglas.modoDefaultDeTipologia cae al ROL, y
# _rolDeTipologia sólo devuelve 'estribo'/'traba' para ES/ESC/EC/TRV/TR/TC/TRC/TRL/TRF
# — que YA están todas listadas. O sea: para cualquier otra tipología el fallback por
# rol da 'cabezal' → 'puntual', SIEMPRE. Por eso acá basta la constante y no hay que
# duplicar la tabla de roles del motor.
MODO_FALLBACK = "puntual"

# ---------------------------------------------------------------------------
# DEFAULTS · FIGURA y φ DE PARTIDA (los que prellena el ribbon)
# ---------------------------------------------------------------------------
# ESTO NO EXISTÍA EN EL CÓDIGO: hasta ahora el ribbon nacía con Figura y φ VACÍOS y el
# clic no colocaba nada hasta que el usuario los llenaba a mano. Como no hay un "valor
# que hoy rige" que preservar, el arranque sale de las dos únicas fuentes que había, y
# cada fila dice de cuál:
#   'semilla'   → escrito en semilla_viga.js (la viga-semilla del modelador).
#   'pantalla'  → propuesto por la maqueta de esta pantalla de configuración y ya
#                 visible en ella desde ayer. NO lo usaba nadie: al cablearla empieza
#                 a usarse, y es exactamente la mejora pedida.
# Las tipologías que no están acá nacen con figura/φ en NULL: no hay de dónde sacarlas
# y no se inventan. El ribbon las deja vacías, igual que hoy.
# (VIGA-CBI: la semilla usa 101A y esta pantalla propuso 103B — cabezal con dos patas.
#  Manda la pantalla, que es la decisión más reciente y ahora se cambia con un clic.)
_FIGURA_DIAM_DEFAULT = {
    "VIGA-CBS": ("103B", 16, "semilla"),
    "VIGA-CBI": ("103B", 18, "pantalla"),
    "VIGA-ES":  ("104D", 8,  "semilla"),
    "VIGA-TRV": ("101A", 8,  "semilla"),
    "VIGA-LT":  ("101A", 12, "pantalla"),
    "MURO-MH":  ("101A", 8,  "pantalla"),
    "MURO-MV":  ("101A", 8,  "pantalla"),
    "MURO-EC":  ("104D", 8,  "pantalla"),
    "MURO-TR":  ("101A", 8,  "pantalla"),
    "MURO-TC":  ("101A", 8,  "pantalla"),
    "MURO-CB":  ("101A", 16, "pantalla"),
}

# ---------------------------------------------------------------------------
# DEFAULTS · RECUBRIMIENTOS — espejo de template_editor.js TPL_DIMS_POR_ELEMENTO
# ---------------------------------------------------------------------------
# Se guardan con las claves CANÓNICAS de la geometría, que son las que lee el motor.
# CUÁNTOS CAMPOS TIENE CADA ELEMENTO ES PARTE DEL DATO: la viga tiene tres
# independientes (sup/inf/lat) y el muro UNO SOLO que escribe caras y bordes a la vez
# (`ks`), tal como el grupo HORMIGÓN del ribbon. La losa no tiene lateral: esa clave
# no existe, y "no existe" es la respuesta correcta, no un campo vacío por llenar.
#
# Esta tabla es la ÚNICA: el mapa de valores por defecto se DERIVA de ella (abajo), y
# el front la recibe en el GET para pintar exactamente los campos que hay. Tener dos
# tablas —una de campos y otra de valores— es como se desincronizan estas cosas.
_RECUB_CAMPOS = {
    "VIGA": [
        {"k": "recub_sup", "ks": ["recub_sup"], "lbl": "Superior", "def": 4.0},
        {"k": "recub_inf", "ks": ["recub_inf"], "lbl": "Inferior", "def": 4.0},
        {"k": "recub_lat", "ks": ["recub_lat"], "lbl": "Lateral", "def": 3.0},
    ],
    "MURO": [
        {"k": "recub_lat", "ks": ["recub_lat", "recub_sup", "recub_inf"],
         "lbl": "Recub", "def": 2.5, "nota": "un solo campo: escribe caras y bordes"},
    ],
    "COLUMNA": [{"k": "recub", "ks": ["recub"], "lbl": "Recub", "def": 4.0}],
    "LOSA": [
        {"k": "recub_sup", "ks": ["recub_sup"], "lbl": "Superior", "def": 2.5},
        {"k": "recub_inf", "ks": ["recub_inf"], "lbl": "Inferior", "def": 2.5},
    ],
    "FUNDACION": [{"k": "recub", "ks": ["recub"], "lbl": "Recub", "def": 5.0,
                   "nota": "contra terreno"}],
    "GEN": [{"k": "recub", "ks": ["recub"], "lbl": "Recub", "def": 4.0}],
}
_RECUB_DEFAULT = {
    elem: {k: campo["def"] for campo in campos for k in campo["ks"]}
    for elem, campos in _RECUB_CAMPOS.items()
}

# ---------------------------------------------------------------------------
# DEFAULTS · REGLA DE LARGOS (la pata del gancho)
# ---------------------------------------------------------------------------
# ÚNICO default que NO es espejo del modelador, y es a propósito (instrucción del
# usuario 17-ago): figura_puntos.extGancho tiene 6φ mínimo 7,5 cm escrito a mano, una
# regla que el usuario nunca pidió, mientras el CREADOR DE BARRAS de la plataforma usa
# 10φ (obra_config.DEFAULT_FACTOR_EXTREMO). La config nace en 10φ, que es el número de
# la casa.
#
# ⚠ EL MOTOR TODAVÍA NO LEE ESTO. Pasar de 6φ a 10φ mueve largos de corte y kilos
# (medido: viga-semilla como la arma hoy el editor, +1,2 kg de 136,2 → 137,4; con
# estribo 106A φ16, +10,7 kg de 234,9 → 245,6), y además rompe la suite headless
# (tests/test_pose.js fija extGancho(0.8) = 7.5). Se guarda, se muestra y se avisa;
# aplicarlo al motor es un paso APARTE que el usuario tiene que confirmar. Que quede
# guardado y sin efecto está DICHO en la pantalla, no escondido.
MODOS_LARGOS = ("fabricacion", "nch211", "custom")
GANCHO_FABRICACION = {"factor": 10.0, "min": 7.5}
# NCh 211 se OFRECE como modo pero no tiene tabla: nadie escribió sus valores por rango
# de diámetro. Inventarlos sería peor que no tenerlos (son números normativos que
# después facturan), así que el modo se rechaza al guardar con el motivo explícito.
GANCHO_NCH211 = None
# El gancho que el MOTOR usa hoy, para poder contrastarlo en la pantalla sin que el
# front tenga que volver a escribir la constante (figura_puntos.js extGancho).
GANCHO_MOTOR_HOY = {"factor": 6.0, "min": 7.5}


# ---------------------------------------------------------------------------
# CONSTRUCCIÓN DE LOS DEFAULTS
# ---------------------------------------------------------------------------
def _clave(elem: str, tip: str) -> str:
    return f"{elem}-{tip}"


def _sep_default(tip: str) -> float:
    return SEP_TRABAS if str(tip).upper() in _TIPOLOGIAS_SEP_TRABA else SEP_DEFAULT


def _modo_default(tip: str) -> str:
    return _MODO_POR_TIPOLOGIA.get(str(tip).upper(), MODO_FALLBACK)


def defaults() -> dict:
    """La config con la que arranca la plataforma = lo que el código hace HOY.
    Se construye en cada llamada (no es una constante de módulo) para que nadie pueda
    mutar el default compartido al mezclar con lo guardado."""
    tipologias = {}
    for elem, tipos in _TIPOLOGIAS_SEED.items():
        for cod, _nombre in tipos:
            k = _clave(elem, cod)
            fig, diam, origen = _FIGURA_DIAM_DEFAULT.get(k, (None, None, None))
            tipologias[k] = {
                "figura": fig,
                "diam": diam,
                "figura_origen": origen,       # 'semilla' | 'pantalla' | None (ver arriba)
                "sep": _sep_default(cod),
                "modo": _modo_default(cod),
                # Las sugeridas del buscador son las MISMAS que ya sirve el catálogo
                # (tipologia_figuras): la config nace copiándolas, no compitiendo.
                "figuras": list(_FIGURAS_POR_TIPO_SEED.get(k, [])),
            }
    return {
        "version": 1,
        "tipologias": tipologias,
        "recubrimientos": {e: dict(v) for e, v in _RECUB_DEFAULT.items()},
        "largos": {"modo": "fabricacion", "custom": dict(GANCHO_FABRICACION)},
    }


def _gancho_activo(largos: dict) -> dict:
    """Factor y mínimo que MANDAN según el modo elegido. Se calcula acá (no en el
    front) para que el día que el motor lo lea haya un solo número que pedir."""
    modo = str((largos or {}).get("modo") or "fabricacion")
    if modo == "custom":
        c = (largos or {}).get("custom") or {}
        return {"factor": float(c.get("factor", GANCHO_FABRICACION["factor"])),
                "min": float(c.get("min", GANCHO_FABRICACION["min"])),
                "fuente": "custom"}
    if modo == "nch211":
        # No debería llegar (el PUT lo rechaza), pero una fila vieja o editada a mano
        # no puede devolver números inventados.
        return {"factor": None, "min": None, "fuente": "nch211"}
    return dict(GANCHO_FABRICACION, fuente="fabricacion")


def _mezclar(guardado: dict) -> dict:
    """Defaults + lo guardado ENCIMA, sección por sección y clave por clave.

    No es un `update` plano a propósito: una tipología nueva del catálogo (o un campo
    nuevo de esta pantalla) tiene que aparecer con su default aunque la fila guardada
    sea de antes, en vez de desaparecer del editor. Lo guardado sólo PISA lo que trae.
    """
    cfg = defaults()
    g = guardado if isinstance(guardado, dict) else {}

    for k, valores in (g.get("tipologias") or {}).items():
        if k not in cfg["tipologias"] or not isinstance(valores, dict):
            continue   # tipología que ya no existe en el catálogo: se ignora, no se resucita
        cfg["tipologias"][k].update(valores)

    for elem, valores in (g.get("recubrimientos") or {}).items():
        if elem not in cfg["recubrimientos"] or not isinstance(valores, dict):
            continue
        cfg["recubrimientos"][elem].update(valores)

    if isinstance(g.get("largos"), dict):
        cfg["largos"].update(g["largos"])
        if isinstance(g["largos"].get("custom"), dict):
            cfg["largos"]["custom"] = dict(GANCHO_FABRICACION, **g["largos"]["custom"])
    return cfg


# ---------------------------------------------------------------------------
# LECTURA / ESCRITURA
# ---------------------------------------------------------------------------
def _leer_fila(cur):
    cur.execute("SELECT config, actualizado_por, actualizado_fecha FROM modelador_config WHERE id = 1")
    r = cur.fetchone()
    if not r:
        return None
    cfg = r[0]
    if isinstance(cfg, str):
        try:
            cfg = json.loads(cfg)
        except Exception:
            cfg = {}
    return {"config": cfg if isinstance(cfg, dict) else {},
            "actualizado_por": r[1], "actualizado_fecha": r[2]}


def _check_permiso_escribir(cur, user):
    """MISMO criterio que crear/editar un template (modelador._puede_gestionar_templates):
    quien arma los templates es quien decide con qué nacen. Ningún rol nuevo."""
    from .modelador import _puede_gestionar_templates
    if not _puede_gestionar_templates(cur, user):
        raise HTTPException(
            status_code=403,
            detail="No tienes permiso para cambiar la configuración del modelador. "
                   "La cambia quien puede gestionar templates del catálogo.")


# ---------------------------------------------------------------------------
# VALIDACIÓN DE LO QUE LLEGA
# ---------------------------------------------------------------------------
# La config decide con qué nacen TODAS las barras nuevas: un número imposible acá se
# multiplica por cada barra que alguien coloque después. Se valida al GUARDAR, que es
# cuando el usuario todavía tiene el campo delante y puede corregirlo.
_MAX_ERRORES = 8


def _num(v):
    if isinstance(v, bool) or v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _figuras_existentes(cur) -> set:
    cur.execute("SELECT codigo FROM figuras_catalogo")
    return {str(r[0]).strip().upper() for r in cur.fetchall()}


def _validar_tipologias(cur, tipologias, base) -> list:
    errores = []
    if not isinstance(tipologias, dict):
        return ["El bloque de tipologías no es un objeto."]
    catalogo = _figuras_existentes(cur)
    diams = {float(d) for d in DIAM_ESTANDAR}
    for k, v in tipologias.items():
        if k not in base["tipologias"]:
            errores.append(f"«{k}» no es una tipología del catálogo.")
            continue
        if not isinstance(v, dict):
            errores.append(f"«{k}» no trae valores.")
            continue
        fig = v.get("figura")
        if fig not in (None, "") and str(fig).strip().upper() not in catalogo:
            errores.append(f"{k}: la figura «{fig}» no existe en el catálogo.")
        d = v.get("diam")
        if d not in (None, ""):
            dn = _num(d)
            if dn is None or dn not in diams:
                errores.append(f"{k}: φ {d} no es un diámetro estándar.")
        if "sep" in v:
            s = _num(v.get("sep"))
            if s is None or s <= 0:
                errores.append(f"{k}: la separación tiene que ser un número mayor que 0.")
        if "modo" in v and str(v.get("modo")) not in MODOS_VALIDOS:
            errores.append(f"{k}: «{v.get('modo')}» no es un modo de colocación.")
        if "figuras" in v:
            lista = v.get("figuras")
            if not isinstance(lista, list):
                errores.append(f"{k}: las figuras sugeridas tienen que ser una lista.")
            else:
                for f in lista:
                    if str(f).strip().upper() not in catalogo:
                        errores.append(f"{k}: la figura sugerida «{f}» no existe en el catálogo.")
    return errores


def _validar_recubrimientos(recubs, base) -> list:
    errores = []
    if not isinstance(recubs, dict):
        return ["El bloque de recubrimientos no es un objeto."]
    for elem, v in recubs.items():
        if elem not in base["recubrimientos"]:
            errores.append(f"«{elem}» no es un elemento del modelador.")
            continue
        if not isinstance(v, dict):
            errores.append(f"{elem}: no trae valores.")
            continue
        for k, val in v.items():
            if k not in base["recubrimientos"][elem]:
                # Cada elemento tiene SUS campos (el muro no tiene tres recubrimientos
                # independientes): aceptar una clave ajena guardaría un número que
                # después nadie lee.
                errores.append(f"{elem}: «{k}» no es un recubrimiento de este elemento.")
                continue
            n = _num(val)
            if n is None or n < 0:
                errores.append(f"{elem}: el recubrimiento «{k}» tiene que ser un número ≥ 0.")
    return errores


def _validar_largos(largos) -> list:
    errores = []
    if not isinstance(largos, dict):
        return ["El bloque de largos no es un objeto."]
    modo = largos.get("modo")
    if modo is not None:
        if str(modo) not in MODOS_LARGOS:
            errores.append(f"«{modo}» no es un modo de regla de largos.")
        elif str(modo) == "nch211" and GANCHO_NCH211 is None:
            errores.append(
                "El modo «NCh 211» todavía no tiene tabla cargada: nadie escribió sus "
                "valores por rango de diámetro y no se van a inventar. Usa «Fabricación» "
                "o «Custom» mientras tanto.")
    if "custom" in largos:
        c = largos.get("custom")
        if not isinstance(c, dict):
            errores.append("La tabla «Custom» no es un objeto.")
        else:
            f = _num(c.get("factor"))
            if f is None or f <= 0:
                errores.append("Custom: la pata del gancho (× φ) tiene que ser mayor que 0.")
            m = _num(c.get("min"))
            if m is None or m < 0:
                errores.append("Custom: el mínimo absoluto tiene que ser un número ≥ 0.")
    return errores


def _raise_invalida(errores):
    """422 con el detalle como TEXTO: la pantalla muestra `detail` tal cual."""
    visibles = errores[:_MAX_ERRORES]
    msg = " · ".join(visibles)
    resto = len(errores) - len(visibles)
    if resto > 0:
        msg += f" · (y {resto} problema(s) más)"
    raise HTTPException(status_code=422, detail="No se puede guardar la configuración: " + msg)


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------
class ConfigUpdate(BaseModel):
    """PUT POR SECCIONES: sólo se escribe lo que VIENE en el JSON (__fields_set__,
    mismo criterio que el PUT de templates y el PATCH de reclamos). Cada modal de la
    pantalla guarda LO SUYO; mandar el objeto entero desde uno de ellos pisaría lo que
    otro usuario acaba de cambiar en otra sección."""
    tipologias: Optional[dict] = None
    recubrimientos: Optional[dict] = None
    largos: Optional[dict] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/modelador/config")
def get_modelador_config(user=Depends(get_current_user)):
    """Config vigente = defaults + lo guardado encima.

    Devuelve además el andamiaje que la pantalla necesita para RENDERIZAR sin volver a
    escribir tablas que ya existen en el backend: los nombres de cada tipología, el
    orden de los elementos y el gancho que el motor usa HOY (para poder contrastarlo
    con el configurado, que todavía no está aplicado).
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            fila = _leer_fila(cur)
    cfg = _mezclar(fila["config"] if fila else {})
    return {
        "ok": True,
        "guardada": fila is not None,
        "config": cfg,
        "gancho_activo": _gancho_activo(cfg["largos"]),
        # El motor NO lee gancho_activo todavía: esto es lo que de verdad aplica hoy.
        "gancho_motor": dict(GANCHO_MOTOR_HOY),
        "gancho_aplicado_al_motor": False,
        "elementos": list(ORDEN_ELEMENTOS),
        "tipologias_catalogo": {e: [[c, n] for c, n in _TIPOLOGIAS_SEED.get(e, [])]
                                for e in ORDEN_ELEMENTOS},
        # Qué campos de recubrimiento tiene CADA elemento (y cuáles escribe uno solo).
        # Lo manda el backend para que la pantalla no tenga que llevar su propia copia
        # de TPL_DIMS_POR_ELEMENTO, que es como se desincronizó todo esto la vez pasada.
        "recubrimientos_campos": {e: [dict(c) for c in _RECUB_CAMPOS.get(e, [])]
                                  for e in ORDEN_ELEMENTOS},
        "modos_largos": list(MODOS_LARGOS),
        # NCh 211 se ofrece pero NO tiene tabla: nadie escribió sus valores. La pantalla
        # lo muestra deshabilitado con este motivo en vez de fingir números.
        "nch211_disponible": GANCHO_NCH211 is not None,
        "diametros": list(DIAM_ESTANDAR),
        "actualizado_por": fila["actualizado_por"] if fila else None,
        "actualizado_fecha": fila["actualizado_fecha"] if fila else None,
    }


@router.put("/modelador/config")
def put_modelador_config(body: ConfigUpdate, user=Depends(get_current_user)):
    """Guarda las secciones que vengan. UPSERT de la fila única (id = 1).

    Se guarda el resultado de mezclar lo que había con lo que llega, NO el JSON crudo
    del cliente: así una pantalla vieja (o un modal que sólo conoce su sección) no
    puede borrar el resto de la configuración."""
    email = user.get("email", "?")
    enviados = set(getattr(body, "__fields_set__", None) or getattr(body, "model_fields_set", set()))
    if not enviados:
        raise HTTPException(status_code=400, detail="No se envió ningún cambio.")

    base = defaults()
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso_escribir(cur, user)

            errores = []
            if "tipologias" in enviados:
                errores += _validar_tipologias(cur, body.tipologias, base)
            if "recubrimientos" in enviados:
                errores += _validar_recubrimientos(body.recubrimientos, base)
            if "largos" in enviados:
                errores += _validar_largos(body.largos)
            if errores:
                _raise_invalida(errores)

            fila = _leer_fila(cur)
            guardado = dict(fila["config"]) if fila else {}
            secciones = []
            for seccion in ("tipologias", "recubrimientos", "largos"):
                if seccion not in enviados:
                    continue
                entrante = getattr(body, seccion) or {}
                previo = guardado.get(seccion)
                previo = dict(previo) if isinstance(previo, dict) else {}
                # Mezcla por CLAVE dentro de la sección: guardar una tipología no puede
                # borrar las otras (cada fila de la tabla se guarda con el resto).
                for k, v in entrante.items():
                    if isinstance(v, dict) and isinstance(previo.get(k), dict):
                        previo[k].update(v)
                    else:
                        previo[k] = v
                guardado[seccion] = previo
                secciones.append(seccion)
            guardado["version"] = base["version"]

            cur.execute(
                """INSERT INTO modelador_config (id, config, actualizado_por, actualizado_fecha)
                   VALUES (1, %s::jsonb, %s, %s)
                   ON CONFLICT (id) DO UPDATE SET
                       config            = EXCLUDED.config,
                       actualizado_por   = EXCLUDED.actualizado_por,
                       actualizado_fecha = EXCLUDED.actualizado_fecha""",
                (json.dumps(guardado), email, _now_iso()),
            )

    cfg = _mezclar(guardado)
    audit(email, "guardar_config_modelador", ", ".join(secciones) or "(nada)",
          "modelador_config", "1")
    return {
        "ok": True,
        "guardada": True,
        "secciones": secciones,
        "config": cfg,
        "gancho_activo": _gancho_activo(cfg["largos"]),
        "gancho_motor": dict(GANCHO_MOTOR_HOY),
        "gancho_aplicado_al_motor": False,
        "actualizado_por": email,
    }
