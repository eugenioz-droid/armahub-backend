-- 5N.47c: al eliminar un lote se conserva el DETALLE de sus barras en un snapshot JSON, para que
-- el usuario pueda VER qué contenía (solo lectura), sin dejar las barras en la tabla `barras`
-- (eso ensuciaría Bar Manager/export/stats). Las barras siguen borrándose de `barras`; su detalle
-- vive congelado aquí. Aditiva e idempotente.
DO $$ BEGIN ALTER TABLE lotes ADD COLUMN snap_barras JSONB; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
