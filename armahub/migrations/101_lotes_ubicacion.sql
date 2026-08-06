-- La ubicación del despiece (ciclo/eje/sector/estructura) vivía SOLO en sus barras → un despiece recién
-- creado sin barras aparecía en el histórico como "— · — · —". Ahora el lote guarda su propia ubicación
-- (estampada al crearlo), para mostrarla aunque no tenga barras aún. El histórico la usa con fallback a
-- las barras para los lotes viejos que no la tengan. Aditiva e idempotente.
DO $$ BEGIN ALTER TABLE lotes ADD COLUMN ciclo TEXT;       EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE lotes ADD COLUMN eje TEXT;         EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE lotes ADD COLUMN sector TEXT;      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE lotes ADD COLUMN estructura TEXT;  EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Backfill: para los lotes existentes (no eliminados) que no tengan ubicación propia, tomarla de sus
-- barras (una vez). Los eliminados ya la conservan en snap_sector/ciclo/eje.
UPDATE lotes l SET
    ciclo  = COALESCE(l.ciclo,  sub.ciclo),
    eje    = COALESCE(l.eje,    sub.eje),
    sector = COALESCE(l.sector, sub.sector)
FROM (
    SELECT lote_id, MIN(ciclo) AS ciclo, MIN(eje) AS eje, MIN(sector) AS sector
    FROM barras WHERE lote_id IS NOT NULL AND origen = 'manual'
    GROUP BY lote_id
) sub
WHERE l.id = sub.lote_id
  AND l.estado IS DISTINCT FROM 'eliminado'
  AND (l.ciclo IS NULL OR l.eje IS NULL OR l.sector IS NULL);
