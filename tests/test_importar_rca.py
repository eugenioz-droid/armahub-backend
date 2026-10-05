"""IMPORTAR LOS ANÁLISIS CAUSA RAÍZ HECHOS A MANO (5-oct).

Lo que se congela: de qué celda sale cada dato de la ficha, cómo se engancha la causa
escrita con el catálogo de la plataforma, y qué pasa con lo que no engancha. Esto último
es lo que más importa: una causa mal enganchada le pone a un reclamo la causa de otro, y
nadie lo notaría mirando el tablero.

Correr con: python tests/test_importar_rca.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


SRC = open(os.path.join(ROOT, "scripts", "importar_rca_historicos.py"), encoding="utf-8").read()
from importar_rca_historicos import causa_de, palabras, norm, fecha, CELDAS  # noqa: E402

print("TEST: importación de los análisis causa raíz")

print("\n1. De qué celda sale cada dato")
# El formato es una plantilla fija. Si alguien mueve una fila, lo que se carga queda
# corrido y nadie lo nota: por eso las posiciones están declaradas y congeladas acá.
check("el ID del reclamo y el correlativo salen de la cabecera",
      CELDAS["id_reclamo"] == (2, 6) and CELDAS["correlativo"] == (3, 6))
check("la explicación de la causa y quién analizó",
      CELDAS["explicacion"] == (12, 2) and CELDAS["analista"] == (9, 6))
check("si aplica al área, y a cuál si no",
      CELDAS["aplica"] == (10, 3) and CELDAS["area_aplica"] == (10, 5))
check("las acciones se leen hasta donde empiezan las observaciones",
      "FILA_ACCIONES = 22" in SRC and "FILA_OBSERVACIONES = 30" in SRC)

print("\n2. La causa se busca por TEXTO, no por la fila donde quedó escrita")
# Hay fichas con «Error de interpretación o criterio técnico» escrito en la fila de
# Máquina, cuando en el catálogo esa causa es de Mano de obra. Fiarse de la fila habría
# metido la categoría equivocada.
check("se recorren las seis M y se toma la que tenga texto",
      "FILAS_ISHIKAWA = range(14, 20)" in SRC)
check("...y la razón queda escrita", "LA CAUSA SE MAPEA POR TEXTO, NO POR LA FILA" in SRC)

CAT = {
    "sobrecargalaboraloplazosajustadosquereducentiempoderevision":
        ("MO09", "mano_de_obra", "Sobrecarga laboral o plazos ajustados que reducen tiempo de revisión"),
    "faltaregistroformaldeinformacionacordada":
        ("MO05", "mano_de_obra", "Falta registro formal de información acordada"),
    "errordeinterpretacionocriteriotecnico":
        ("MO08", "mano_de_obra", "Error de interpretación o criterio técnico"),
}

print("\n3. Engancha aunque esté escrita con otras palabras")
check("texto idéntico", causa_de("Error de interpretación o criterio técnico", CAT)[0] == "MO08")
check("con la viñeta de la planilla delante",
      causa_de("◦ Error de interpretación o criterio técnico", CAT)[0] == "MO08")
# Estos dos son reales y son los que rompían el enganche por prefijo: una palabra de
# diferencia («alta», «de») dejaba sin causa a cuatro fichas que sí la tenían.
check("«Sobrecarga laboral ALTA o plazos...» es la misma que «Sobrecarga laboral o plazos...»",
      causa_de("◦ Sobrecarga laboral alta o plazos ajustados que reducen tiempo de revisión",
               CAT)[0] == "MO09")
check("«Falta DE registro formal» es la misma que «Falta registro formal»",
      causa_de("◦ Falta de registro formal de información acordada", CAT)[0] == "MO05")

print("\n4. Lo que NO es una causa del catálogo se deja sin causa")
# El analista a veces escribe su propia frase. Forzarla contra el catálogo le pondría al
# reclamo una causa que nadie eligió; vacío significa «falta clasificarlo», que es cierto.
check("una frase propia no se fuerza", causa_de("Error de cubicación F7", CAT) is None)
check("...ni una descripción larga que no es del catálogo",
      causa_de("Interpetración incompleta del plano de elevación y fundación.", CAT) is None)
check("ni un texto demasiado corto para decidir", causa_de("NA", CAT) is None)
check("y la razón queda escrita", "Ese texto se guarda como explicacion" in SRC)

print("\n5. Detalles que ya mordieron")
check("la misma ficha en los dos libros se cuenta UNA vez",
      "if clave in fichas:" in SRC and "repetidas += 1" in SRC)
check("se busca el reclamo por el ID de Icarus antes que por el correlativo",
      'via = "id"' in SRC and 'via = "correlativo"' in SRC)
check("las fechas se entienden", fecha("2025-04-29 00:00:00") == "2025-04-29" and fecha("") is None)
check("las tildes no cambian la comparación", norm("Interpretación") == "interpretacion")
check("las palabras cortas no cuentan para enganchar", "o" not in palabras("Sobrecarga o plazos"))

print("\n6. No pisa lo que ya había ni lo que se agregue después")
check("sólo rellena lo vacío, con COALESCE", SRC.count("COALESCE(%s,") >= 6)
check("rehace SOLO las acciones que creó esta importación",
      'DELETE FROM reclamo_acciones WHERE reclamo_id = %s AND creado_por = %s' in SRC
      and 'CREADO_POR = "importacion.rca"' in SRC)
check("por defecto no escribe nada", 'CARGAR = "--cargar" in sys.argv' in SRC)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
