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


def orden_constructivo_key(b):
    """SORT KEY constructiva ÚNICA para barras/elementos. `b` es un dict con claves
    piso/sector/ciclo/eje/diam (usa .get, tolera ausencias)."""
    return (
        piso_order(b.get("piso")),
        sector_order(b.get("sector")),
        ciclo_order(b.get("ciclo")),
        (b.get("eje") or ""),
        (b.get("diam") or 0),
    )
