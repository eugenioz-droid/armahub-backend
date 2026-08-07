"""Test de NO-REGRESIÓN del backend del modelador (F1 · T1.1).

Como fastapi/psycopg NO están instalados localmente, este test valida por
ANÁLISIS DE FUENTE (sin importar la app):
  1. El INSERT de agregar_barras (lotes.py) tiene columnas == valores y
     placeholders == params (una barra manual normal sigue insertándose igual).
  2. El INSERT incluye la nueva columna template_instancia_id y usa un parámetro
     origen (no el literal 'manual' hardcodeado) → soporta origen='template'.
  3. El modelo BarraManual declara origen y template_instancia_id OPCIONALES con
     default None (comportamiento actual intacto).
  4. La lógica de fallback de origen: cualquier valor fuera de manual/template
     cae a 'manual' (invariante de canales).

Correr con: python tests/test_modelador_backend.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOTES = os.path.join(ROOT, "armahub", "lotes.py")
MODELADOR = os.path.join(ROOT, "armahub", "modelador.py")
MAIN = os.path.join(ROOT, "armahub", "main.py")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


def main():
    with open(LOTES, "r", encoding="utf-8") as f:
        lotes = f.read()

    # --- Localizar el INSERT INTO barras de agregar_barras (el que tiene RETURNING id
    # Y la columna template_instancia_id). Anclamos a esa columna para no capturar el
    # INSERT de duplicar_lote (que no tiene RETURNING ni esa columna). ---
    m = re.search(
        r"INSERT INTO barras\s*\(([^)]*template_instancia_id[^)]*)\)\s*VALUES\s*\((.*?)\)\s*RETURNING id",
        lotes, re.DOTALL)
    check("se encuentra el INSERT INTO barras ... RETURNING id (con template_instancia_id)", bool(m))
    if m:
        cols_raw, values_raw = m.group(1), m.group(2)
        cols = [c.strip() for c in cols_raw.replace("\n", " ").split(",") if c.strip()]
        val_tokens = [v.strip() for v in values_raw.replace("\n", " ").split(",") if v.strip()]
        n_ph = values_raw.count("%s")
        n_lit = sum(1 for v in val_tokens if v in ("NULL", "'borrador'"))
        check("columnas == tokens de VALUES (%d==%d)" % (len(cols), len(val_tokens)),
              len(cols) == len(val_tokens))
        check("placeholders + literales == tokens (%d+%d==%d)" % (n_ph, n_lit, len(val_tokens)),
              n_ph + n_lit == len(val_tokens))
        check("la columna template_instancia_id está en el INSERT",
              "template_instancia_id" in cols)
        check("origen ya NO es literal 'manual' hardcodeado en ese INSERT",
              "'manual'" not in values_raw)

    # --- Modelo BarraManual con los campos opcionales ---
    check("BarraManual declara origen: Optional[str]",
          re.search(r"origen:\s*Optional\[str\]\s*=\s*None", lotes) is not None)
    check("BarraManual declara template_instancia_id: Optional[int]",
          re.search(r"template_instancia_id:\s*Optional\[int\]\s*=\s*None", lotes) is not None)

    # --- Fallback de origen (invariante de canales) ---
    check("fallback: origen fuera de manual/template cae a 'manual'",
          'origen_barra not in ("manual", "template")' in lotes and
          'origen_barra = "manual"' in lotes)

    # --- Router modelador montado ---
    with open(MAIN, "r", encoding="utf-8") as f:
        main_src = f.read()
    check("main.py importa modelador_router", "from .modelador import router as modelador_router" in main_src)
    check("main.py monta modelador_router (root)", "app.include_router(modelador_router)" in main_src)
    check("main.py incluye modelador_router en _api_routers", "modelador_router" in main_src.split("_api_routers")[1])

    # --- Endpoints del router ---
    with open(MODELADOR, "r", encoding="utf-8") as f:
        mod = f.read()
    for ep, verbo in [("/templates", '@router.post("/templates")'),
                      ("/templates?", '@router.get("/templates")'),
                      ("/templates/{id}", '@router.get("/templates/{template_id}")'),
                      ("/elementos/instancia", '@router.post("/elementos/instancia")')]:
        check("router define %s" % ep, verbo in mod)
    check("la escritura requiere permiso (_puede_editar_barras)", "_puede_editar_barras" in mod)

    if fallos:
        print("\nFALLARON %d chequeos" % fallos)
        sys.exit(1)
    print("\nOK — backend del modelador (no-regresión + montaje) pasa.")


if __name__ == "__main__":
    main()
