-- Material disponible › la última búsqueda de cada barra queda guardada (26-nov, SPECS §15.3).
--
-- El usuario: «buscar coincidencias no me lo dejó guardado; ahora tengo que volver a buscar».
-- Se reutiliza material_coincidencias (182): cada búsqueda reemplaza las filas de esa barra, y
-- la ventana las muestra con su hora al abrirse. Lo que puede haber cambiado en aSa se revisa
-- al asignar (ítem borrado, despachado o que ya no calza).
--   · ubicacion y kg_item: lo que la ventana muestra de cada ítem (dónde va y sus kilos);
--   · material_barras.coin_buscado_el: cuándo se buscó por última vez (distingue «nunca se
--     buscó» de «se buscó y no hubo nada»).
DO $$ BEGIN
  ALTER TABLE material_coincidencias ADD COLUMN ubicacion TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE material_coincidencias ADD COLUMN kg_item NUMERIC(12,2);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE material_barras ADD COLUMN coin_buscado_el TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
