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
  5. La TRAZA template→instancia está cableada: panel_3d.js manda el template_id
     REAL en POST /elementos/instancia (antes: null hardcodeado, así que el 409 que
     protege el DELETE nunca se disparaba y un template ya usado se borraba mudo).

Correr con: python tests/test_modelador_backend.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOTES = os.path.join(ROOT, "armahub", "lotes.py")
MODELADOR = os.path.join(ROOT, "armahub", "modelador.py")
MAIN = os.path.join(ROOT, "armahub", "main.py")
PANEL3D = os.path.join(ROOT, "armahub", "static", "js", "features", "modelador", "panel_3d.js")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


def main():
    with open(LOTES, "r", encoding="utf-8") as f:
        lotes = f.read()

    # --- Localizar el INSERT INTO barras de agregar_barras (el único que termina en
    # RETURNING id). ANTES se anclaba en la columna template_instancia_id creyendo que
    # solo la tenía ese INSERT; después el de duplicar_lote también la ganó (para
    # HEREDAR la trazabilidad al duplicar) y el ancla dejó de distinguirlos: con
    # re.DOTALL la búsqueda arrancaba en las columnas de duplicar_lote y terminaba en el
    # RETURNING id del OTRO INSERT, midiendo 41 columnas contra 297 "valores" (3 checks
    # rojos sin que hubiera nada roto en lotes.py).
    # Ahora se parte el archivo POR SENTENCIA: así cada INSERT se mide contra su propio
    # VALUES y agregar columnas a uno no puede volver a contaminar al otro. ---
    m = None
    for bloque in lotes.split("INSERT INTO barras")[1:]:
        cand = re.match(r"\s*\(([^)]*)\)\s*VALUES\s*\((.*?)\)\s*RETURNING id", bloque, re.DOTALL)
        if cand and "template_instancia_id" in cand.group(1):
            m = cand
            break
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

    # --- TRAZABILIDAD REAL template -> instancia -----------------------------
    # El DELETE de un template se protege con 409 contando elementos_template por
    # template_id. Esa cuenta valía 0 SIEMPRE porque el único cliente del endpoint
    # mandaba template_id: null hardcodeado: la protección no protegía nada y un
    # template que ya había generado barras se borraba sin aviso. Se chequea acá, en
    # el mismo test que ya mira el cableado, porque el defecto vive JUSTO entre los
    # dos archivos (el backend estaba bien; el cliente no le daba el dato).
    check("el DELETE cuenta las instancias por template_id",
          "FROM elementos_template WHERE template_id = %s" in mod)
    with open(PANEL3D, "r", encoding="utf-8") as f:
        panel = f.read()
    m_inst = re.search(r"_post\('/elementos/instancia',\s*\{([^}]*)\}", panel)
    check("panel_3d manda el POST /elementos/instancia", bool(m_inst))
    if m_inst:
        check("…con el template_id REAL, no un null hardcodeado",
              re.search(r"template_id:\s*ST\.templateId", m_inst.group(1)) is not None)
    check("ST declara templateId (de qué template salió la receta viva)",
          re.search(r"^\s*templateId:\s*null", panel, re.MULTILINE) is not None)
    check("cargar un template estampa ST.templateId",
          re.search(r"ST\.templateId\s*=\s*\(det\.id", panel) is not None)
    check("volver a la semilla LIMPIA ST.templateId (la receta ya no es de ese template)",
          re.search(r"semillaViga\(\);\s*\n(?:\s*//[^\n]*\n)*\s*ST\.templateId\s*=\s*null", panel) is not None)

    if fallos:
        print("\nFALLARON %d chequeos" % fallos)
        sys.exit(1)
    print("\nOK — backend del modelador (no-regresión + montaje) pasa.")


if __name__ == "__main__":
    main()
