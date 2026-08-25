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
  5. La TRAZA template→instancia está cableada: el front manda el template_id REAL
     al escribir la estructura (antes: null hardcodeado, así que el 409 que protege
     el DELETE nunca se disparaba y un template ya usado se borraba mudo). Lo medía
     sobre panel_3d.js; ese cliente se retiró y hoy se mide sobre template_editor.js
     (ST.tplOrigen), que es quien escribe la traza.

Correr con: python tests/test_modelador_backend.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOTES = os.path.join(ROOT, "armahub", "lotes.py")
MODELADOR = os.path.join(ROOT, "armahub", "modelador.py")
MAIN = os.path.join(ROOT, "armahub", "main.py")
EDITOR = os.path.join(ROOT, "armahub", "static", "js", "features", "modelador", "template_editor.js")

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
    # …Y SE VOLVIÓ A ROMPER DOS VECES MÁS, las dos por cambios sanos de lotes.py:
    #   · el UPSERT metió un `ON CONFLICT … DO UPDATE SET … WHERE …` ENTRE el VALUES y
    #     el RETURNING (es lo que impide duplicar barras al reintentar un guardado);
    #   · el RETURNING pasó a `RETURNING id, id_unico`, porque el alta ahora escribe la
    #     tanda con executemany y cruza las filas devueltas POR id_unico y no por
    #     posición.
    # El ancla exigía `VALUES (…) RETURNING id` pegados y con nada detrás, así que dejó
    # de encontrar el INSERT y arrastró 3 checks al rojo sin que hubiera NADA roto. Un
    # test que lleva semanas en rojo por su propio ancla es peor que no tenerlo: enseña
    # a ignorar el rojo.
    # Lección: este bloque mide UNA cosa —la correspondencia columnas ↔ valores— así que
    # el ancla sólo puede exigir lo que esa medición necesita. Lo que haya entre el
    # VALUES y el RETURNING, y qué devuelva el RETURNING, no le incumbe.
    m = None
    for bloque in lotes.split("INSERT INTO barras")[1:]:
        cand = re.match(r"\s*\(([^)]*)\)\s*VALUES\s*\((.*?)\).*?RETURNING\s+[\w,\s]+", bloque, re.DOTALL)
        if cand and "template_instancia_id" in cand.group(1):
            m = cand
            break
    check("se encuentra el INSERT INTO barras ... RETURNING (con template_instancia_id)", bool(m))
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
    # La regla NO cambió: un origen que no sea de este canal cae a 'manual', para que
    # nadie pueda inyectar 'csv'/'pedido' por aquí. Lo que cambió es DÓNDE vive — se
    # extrajo a `_origen_valido()` cuando se sumó 'enfierrador' (la etiqueta del Template
    # Editor en modo obra) — y este check seguía buscando las dos líneas sueltas que la
    # implementaban antes. O sea: llevaba en rojo por un refactor sano, señalando una
    # regla que en realidad se sigue cumpliendo.
    # Ahora se mide la FUNCIÓN: que exista, que su lista blanca contenga los tres
    # orígenes propios del canal, y que lo que no esté en ella caiga a 'manual'.
    fn = re.search(r"def _origen_valido\(origen\):(.*?)(?=\ndef |\Z)", lotes, re.DOTALL)
    check("existe _origen_valido(), la puerta única del origen", fn is not None)
    if fn:
        cuerpo = fn.group(1)
        check("su lista blanca son los 3 orígenes de este canal (manual/template/enfierrador)",
              all(o in cuerpo for o in ('"manual"', '"template"', '"enfierrador"')))
        check("fallback: lo que no está en la lista cae a 'manual'",
              re.search(r"return\s+o\s+if\s+o\s+in\s*\(.*?\)\s*else\s*\"manual\"", cuerpo, re.DOTALL) is not None)

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
    #
    # EL CLIENTE CAMBIÓ, LA REGLA NO. Esto medía a panel_3d.js (Enfierrador MVP),
    # retirado el 25-ago; quien escribe la traza hoy es el Template Editor en modo
    # obra, con ST.tplOrigen. Las aserciones se MUEVEN a ese archivo, no se borran:
    # el 409 sigue dependiendo de que alguien mande el id de verdad.
    check("el DELETE cuenta las instancias por template_id",
          "FROM elementos_template WHERE template_id = %s" in mod)
    with open(EDITOR, "r", encoding="utf-8") as f:
        editor = f.read()
    check("ST declara tplOrigen (de qué template de la biblioteca salió la estructura)",
          re.search(r"\btplOrigen:\s*null", editor) is not None)
    check("abrir un template de la biblioteca estampa su id en tplOrigen",
          re.search(r"templateId:\s*null,\s*tplOrigen:\s*t\.id", editor) is not None)
    # LOS DOS ESCRITURAS que llevan la traza a la tabla: la PRIMERA carga (la estructura
    # viaja dentro del POST de barras, misma transacción) y el REGENERAR (PUT de la
    # receta). Si cualquiera de las dos vuelve a mandar null, el 409 deja de disparar.
    m_inst = re.search(r"instancia:\s*Object\.assign\(\{\s*template_id:\s*ST\.tplOrigen", editor)
    check("la primera carga manda la estructura con el template_id REAL", bool(m_inst))
    check("…y el PUT de regenerar también lo conserva",
          re.search(r"piso:\s*traza\.piso,\s*template_id:\s*ST\.tplOrigen", editor) is not None)
    # tplOrigen es SOLO traza: no se reusa como ST.templateId. Si se reusara, "Guardar
    # cambios" en modo obra pisaría el template de la biblioteca con el hormigón real
    # de esta estructura (decisión 5 del modo obra).
    check("en modo obra el template de la biblioteca NO se puede sobrescribir "
          "(templateId null, tplOrigen aparte)",
          re.search(r"templateId:\s*null,\s*\n?\s*tplOrigen:", editor) is not None)

    if fallos:
        print("\nFALLARON %d chequeos" % fallos)
        sys.exit(1)
    print("\nOK — backend del modelador (no-regresión + montaje) pasa.")


if __name__ == "__main__":
    main()
