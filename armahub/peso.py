"""
peso.py — Fórmula ÚNICA del peso teórico de una barra (M1.3).

diam en mm, largo en cm → kg (acero 7850 kg/m³).
El frontend tiene su espejo documentado en agregar_cubicacion2.js (ac2Peso).
Si cambia la fórmula, cambiar AMBOS.
"""


def peso_unitario_kg(diam, largo):
    """Peso de UNA barra. Castea de forma segura (data legada guarda números como
    texto); con datos inválidos o faltantes devuelve None, nunca lanza."""
    if diam is None or largo is None:
        return None
    try:
        diam = float(diam)
        largo = float(largo)
    except (ValueError, TypeError):
        return None
    return 7850 * 3.1416 * (diam / 2000) ** 2 * (largo / 100)
