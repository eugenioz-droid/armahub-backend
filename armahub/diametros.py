"""Mapa diámetro → código de producción (PROD / cod_proyecto) — data maestra compartida.

Extraído para que lo usen TANTO el importer (corrección de COD_PROD del CSV) COMO el
creador de barras manuales (lotes.py), sin que lotes.py tenga que importar importer.py
(que arrastra pandas). Fuente única de verdad del PROD por diámetro.

El PROD se DERIVA del diámetro (regla de negocio: cada φ tiene su código de producción
fijo). El cubicador NO lo ingresa; se asigna solo al guardar y va a la exportación (col PROD).
"""

# Lista fija de diámetros estándar (mm) — 5N.12.
DIAM_ESTANDAR = [8, 10, 12, 16, 18, 22, 25, 28, 32, 36]

# Diámetro (mm) → código de producción (PROD). Mantener sincronizado con la realidad de
# Armacero. Si un φ no está aquí, cod_proyecto queda None (no se inventa).
DIAM_COD_MAP = {
    8.0:  "110002788",
    10.0: "110002774",
    12.0: "110002710",
    16.0: "110002776",
    18.0: "110002718",
    22.0: "110002790",
    25.0: "110002717",
    28.0: "110002777",
    32.0: "110002778",
    36.0: "110002779",
}


def cod_prod_de_diam(diam):
    """Devuelve el código de producción para un diámetro, o None si no está mapeado
    (φ no estándar). Castea de forma segura."""
    if diam is None:
        return None
    try:
        return DIAM_COD_MAP.get(float(diam))
    except (ValueError, TypeError):
        return None
