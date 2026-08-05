"""Test de la lógica de ORDEN CONSTRUCTIVO de barras/elementos (fuente única del criterio).

Fija el criterio acordado (2026-08-05): piso BAJO→ALTO (FUND, S2, S1, P1..Pn, SM) → sector
(FUND→ELEV→VCIELO→LCIELO) → ciclo (numérico) → eje → diámetro. Si alguien cambia el criterio sin
querer (o rompe _piso_order/_sector_order), este test falla.

El ORDER BY en SQL (ORDER_CONSTRUCTIVO_SQL) es el ESPEJO de estos helpers; se mantienen sincronizados
a mano. Este test cubre la lógica Python, que es la que usa la exportación (export.py) directamente.

Correr con:  python -m pytest tests/test_orden_constructivo.py   (o)   python tests/test_orden_constructivo.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from armahub.orden import piso_order as _piso_order, sector_order as _sector_order, orden_constructivo_key as _orden_constructivo_key


def _check(nombre, cond):
    print(("  OK  " if cond else "  XX  ") + nombre)
    return cond


def main():
    fallos = 0

    # 1. Pisos: bajo -> alto. FUND al fondo, subterráneos negativos (S2<S1), P por número, SM arriba.
    pisos = ["SM", "P10", "P2", "P1", "S1", "S2", "FUND"]
    orden_pisos = sorted(pisos, key=_piso_order)
    esperado = ["FUND", "S2", "S1", "P1", "P2", "P10", "SM"]
    if not _check("pisos ordenan FUND<S2<S1<P1<P2<P10<SM", orden_pisos == esperado):
        print("      obtuve:", orden_pisos); fallos += 1

    # 2. Sectores: FUND -> ELEV -> VCIELO -> LCIELO.
    sects = ["LCIELO", "VCIELO", "ELEV", "FUND"]
    orden_sect = sorted(sects, key=_sector_order)
    if not _check("sectores ordenan FUND<ELEV<VCIELO<LCIELO", orden_sect == ["FUND", "ELEV", "VCIELO", "LCIELO"]):
        print("      obtuve:", orden_sect); fallos += 1

    # 3. Clave constructiva completa: el piso manda sobre el sector.
    barras = [
        {"piso": "P2", "sector": "FUND", "ciclo": "C1", "eje": "A", "diam": 8},
        {"piso": "P1", "sector": "LCIELO", "ciclo": "C1", "eje": "Z", "diam": 32},
        {"piso": "FUND", "sector": "ELEV", "ciclo": "C9", "eje": "M", "diam": 16},
    ]
    orden = sorted(barras, key=_orden_constructivo_key)
    pisos_result = [b["piso"] for b in orden]
    if not _check("clave constructiva: piso manda (FUND, P1, P2)", pisos_result == ["FUND", "P1", "P2"]):
        print("      obtuve:", pisos_result); fallos += 1

    # 4. Mismo piso: manda el sector; mismo piso+sector: manda ciclo; luego eje; luego diam.
    mismo = [
        {"piso": "P1", "sector": "ELEV", "ciclo": "C2", "eje": "B", "diam": 10},
        {"piso": "P1", "sector": "ELEV", "ciclo": "C1", "eje": "B", "diam": 10},
        {"piso": "P1", "sector": "FUND", "ciclo": "C9", "eje": "A", "diam": 25},
        {"piso": "P1", "sector": "ELEV", "ciclo": "C2", "eje": "A", "diam": 10},
        {"piso": "P1", "sector": "ELEV", "ciclo": "C2", "eje": "B", "diam": 8},
    ]
    orden = sorted(mismo, key=_orden_constructivo_key)
    # Esperado: FUND primero; luego ELEV por ciclo(C1<C2), dentro de C2 por eje(A<B), dentro de B por diam(8<10)
    firmas = [(b["sector"], b["ciclo"], b["eje"], b["diam"]) for b in orden]
    esperado4 = [
        ("FUND", "C9", "A", 25),
        ("ELEV", "C1", "B", 10),
        ("ELEV", "C2", "A", 10),
        ("ELEV", "C2", "B", 8),
        ("ELEV", "C2", "B", 10),
    ]
    if not _check("desempate sector>ciclo>eje>diam", firmas == esperado4):
        print("      obtuve:", firmas); fallos += 1

    # 5. Tolerancia a ausencias/None (no debe reventar).
    try:
        sorted([{"piso": None}, {}, {"sector": "ELEV"}], key=_orden_constructivo_key)
        _check("tolera None/campos ausentes sin reventar", True)
    except Exception as e:
        _check("tolera None/campos ausentes sin reventar", False); print("      excepción:", e); fallos += 1

    if fallos == 0:
        print("\nOK: el orden constructivo se cumple.")
        return 0
    print("\nFALLO: %d aserción(es)." % fallos)
    return 1


if __name__ == "__main__":
    sys.exit(main())
