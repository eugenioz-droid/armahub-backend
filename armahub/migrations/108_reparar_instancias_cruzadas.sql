-- 108 — REPARA los despieces DUPLICADOS ANTES del fix de duplicar_lote (25-ago).
--
-- EL DAÑO QUE REPARA: hasta ese fix, duplicar un despiece copiaba las barras con su
-- `template_instancia_id` APUNTANDO A LA INSTANCIA DEL LOTE ORIGEN. Consecuencia
-- reportada por un usuario: en el duplicado, "Actualizar en el despiece" editaba la
-- receta del lote ORIGINAL y el sync respondía 404 ("esa estructura no pertenece a
-- este despiece") — las modificaciones no se guardaban nunca. El código nuevo ya
-- duplica bien; esta migración arregla LOS DATOS que quedaron de antes.
--
-- QUÉ HACE: para cada (lote, instancia) donde las barras de un lote apuntan a una
-- instancia que vive en OTRO lote, copia la instancia a una fila propia del lote y
-- repunta SOLO esas barras. No toca ninguna barra en sí (las ediciones manuales que
-- los cubicadores hicieron por el Bar Manager quedan intactas: esto solo mueve el
-- vínculo), no borra nada, y el lote origen conserva su instancia tal cual.
--
-- IDEMPOTENTE: tras la primera pasada no queda ninguna referencia cruzada, así que
-- las siguientes pasadas (init_db corre en cada cold-start) no encuentran nada.
-- Las columnas de la copia se leen de information_schema en vez de listarse a mano:
-- así la 107 (traza, uid) y cualquier columna futura viajan solas y esta migración
-- no se desactualiza en silencio.
DO $$
DECLARE
  r RECORD;
  cols TEXT;
  nuevo_id BIGINT;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ')
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'elementos_template'
     AND column_name NOT IN ('id', 'lote_id');

  FOR r IN
    SELECT DISTINCT b.lote_id AS lote_destino, b.template_instancia_id AS inst_vieja
      FROM barras b
      JOIN elementos_template et ON et.id = b.template_instancia_id
     WHERE b.template_instancia_id IS NOT NULL
       AND b.lote_id IS NOT NULL
       AND et.lote_id IS DISTINCT FROM b.lote_id
  LOOP
    EXECUTE format(
      'INSERT INTO elementos_template (lote_id, %s) SELECT $1, %s FROM elementos_template WHERE id = $2 RETURNING id',
      cols, cols)
      INTO nuevo_id
      USING r.lote_destino, r.inst_vieja;

    UPDATE barras
       SET template_instancia_id = nuevo_id
     WHERE lote_id = r.lote_destino
       AND template_instancia_id = r.inst_vieja;
  END LOOP;
END $$;
