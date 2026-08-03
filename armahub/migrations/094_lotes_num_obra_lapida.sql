-- 5N.47b: correlativo de lote POR OBRA fijo + lápida al eliminar (trazabilidad).
--
-- num_obra: número del lote DENTRO de su obra (#1, #2…), asignado UNA vez al crear y NUNCA
-- recalculado (es una referencia estable, como una factura). Antes se derivaba de la posición
-- (ROW_NUMBER) → borrar un lote renumeraba los siguientes: bug de referencia.
--
-- Al eliminar un lote NO se borra la fila: se marca estado='eliminado' y se guarda una "lápida"
-- con el resumen de lo que había (kg, n_barras) + quién/cuándo. Las barras sí se borran.
-- Aditiva e idempotente.

DO $$ BEGIN ALTER TABLE lotes ADD COLUMN num_obra INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE lotes ADD COLUMN eliminado_por TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE lotes ADD COLUMN eliminado_fecha TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
-- Foto del lote al eliminar (las barras ya no existen; esto conserva el resumen para el histórico).
DO $$ BEGIN ALTER TABLE lotes ADD COLUMN snap_n_barras INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE lotes ADD COLUMN snap_kg DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE lotes ADD COLUMN snap_sector TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE lotes ADD COLUMN snap_ciclo TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE lotes ADD COLUMN snap_eje TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Backfill del num_obra para los lotes ya existentes (por orden de creación dentro de cada obra).
-- Se hace UNA vez: solo toca los que aún no tienen num_obra.
WITH num AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY id_proyecto ORDER BY id) AS n
    FROM lotes
)
UPDATE lotes l SET num_obra = num.n
FROM num WHERE num.id = l.id AND l.num_obra IS NULL;
