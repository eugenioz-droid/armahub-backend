"""Orden CONSTRUCTIVO de barras/elementos — FUENTE ÚNICA del criterio.

Criterio (decisión de negocio 2026-08-05): piso BAJO→ALTO (FUND, S2, S1, P1..Pn, SM) →
sector (FUND→ELEV→VCIELO→LCIELO) → ciclo (numérico) → eje → diámetro.

Módulo SIN dependencias (solo `re`) a propósito: lo importan barras.py y export.py, y se puede testear
sin levantar FastAPI. El ORDER BY en SQL (barras.ORDER_CONSTRUCTIVO_SQL) es el espejo de estos helpers.

GANCHO Fase 4 (orden manual): cuando exista un campo de orden manual por barra/elemento, se antepondrá
como primer término en _orden_constructivo_key (COALESCE(orden_manual, ∞)) para que el manual mande y
el automático sea el fallback. Mantener ESTE módulo como el único lugar que define el criterio.
"""
import re as _re


def piso_order(p):
    """Orden de pisos: FUND (fundación) al fondo < subterráneos (S2<S1) < P1,P2.. < SM/PM (techumbre).
    Texto libre desconocido cae en el medio (0)."""
    up = (p or '').upper().strip()
    if up in ('FUND', 'FUNDACION', 'FUNDACIÓN'):
        return -1000000
    if up in ('SM', 'PM', 'SALA DE MAQUINAS'):
        return 9999
    m = _re.match(r'^S(\d+)', up)
    if m:
        return -int(m.group(1))
    m = _re.match(r'^P(\d+)', up)
    if m:
        return int(m.group(1))
    m = _re.search(r'(\d+)', up)
    if m:
        return int(m.group(1))
    return 0


def ciclo_order(c):
    """Orden de ciclos: numérico por el primer grupo de dígitos."""
    m = _re.search(r'(\d+)', c or '')
    return int(m.group(1)) if m else 0


# Orden canónico de sectores constructivos: FUND → ELEV → VCIELO → LCIELO. Desconocido al final.
_SECTOR_ORDEN = {"FUND": 0, "ELEV": 1, "VCIELO": 2, "LCIELO": 3}


def sector_order(s):
    return _SECTOR_ORDEN.get((s or "").upper().strip(), 99)


# Orden canónico de TIPOLOGÍAS (marca) por estructura. Debe reflejar catalogo._TIPOLOGIAS_SEED (misma
# secuencia). Se aplana a un índice único por código de marca (primera aparición) para poder ordenar
# barras por tipología sin conocer su estructura. Mantener sincronizado con catalogo._TIPOLOGIAS_SEED.
_TIPOLOGIAS_ORDEN = [
    # MURO
    "MH", "MV", "TR", "EC", "TC", "CB",
    # LOSA
    "Fi", "Fs", "F'i", "F's", "F", "F'", "SP", "Rp", "TRL",
    # VIGA
    "CBS", "CBS2", "CBSn", "CBI", "CBI2", "CBIn", "LT", "ES", "TRV",
    # COLUMNA
    "CB2", "CBn", "TRC", "ESC",
    # FUNDACION
    "SPF", "TRF",
    # GEN (los repetidos ya indexados arriba)
]
_TIPOLOGIA_INDICE = {}
for _i, _cod in enumerate(_TIPOLOGIAS_ORDEN):
    _TIPOLOGIA_INDICE.setdefault(_cod, _i)   # primera aparición manda


def tipologia_order(m):
    """Índice de orden de una tipología (marca) según la convención por estructura (MH<MV<TR<…).
    Marca desconocida → al final (999). Los códigos son case-sensitive (F'i, CBSn…); se compara con trim."""
    return _TIPOLOGIA_INDICE.get((m or "").strip(), 999)


def sql_tipologia_order(col="marca"):
    """Genera el fragmento SQL `CASE TRIM(col) WHEN 'MH' THEN 0 ... ELSE 999 END` para ordenar por
    tipología en un ORDER BY de Postgres, derivado del MISMO _TIPOLOGIA_INDICE (fuente única → no se
    desincroniza). Los códigos se escapan doblando comillas simples (F'i → 'F''i')."""
    whens = " ".join(
        "WHEN '{}' THEN {}".format(cod.replace("'", "''"), idx)
        for cod, idx in sorted(_TIPOLOGIA_INDICE.items(), key=lambda kv: kv[1])
    )
    return "CASE TRIM(COALESCE({}, '')) {} ELSE 999 END".format(col, whens)


def orden_constructivo_key(b):
    """SORT KEY constructiva ÚNICA para barras/elementos. `b` es un dict con claves
    piso/sector/ciclo/eje/marca/diam (usa .get, tolera ausencias). Dentro de un eje, ordena por
    TIPOLOGÍA (marca) según la convención (MH,MV,TR,…) y luego por diámetro."""
    return (
        piso_order(b.get("piso")),
        sector_order(b.get("sector")),
        ciclo_order(b.get("ciclo")),
        (b.get("eje") or ""),
        tipologia_order(b.get("marca")),
        (b.get("diam") or 0),
    )


def orden_barra_en_archivo_key(b):
    """SORT KEY para las barras DENTRO de un archivo de exportación (1 sector·piso·ciclo). Ahí piso/
    sector/ciclo son constantes, así que solo varían eje/marca/diam: eje → tipología (MH,MV,TR,…) →
    diámetro. Es el orden que verá aSa dentro de cada planilla."""
    return (
        (b.get("eje") or ""),
        tipologia_order(b.get("marca")),
        (b.get("diam") or 0),
    )
