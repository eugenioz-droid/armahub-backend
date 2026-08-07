-- 103 — M1.10: plano del despiece a nivel de LOTE (edificio = un plano por lote).
-- El cubicador registra con qué plano trabajó; se estampa a plano_code de sus barras.
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS plano TEXT;

-- Backfill: si todas las barras manuales de un lote comparten el mismo plano_code,
-- se adopta como plano del lote (no pisa lo que ya exista).
UPDATE lotes l
SET plano = sub.pc
FROM (
  SELECT lote_id, MAX(plano_code) AS pc
  FROM barras
  WHERE lote_id IS NOT NULL AND origen = 'manual'
    AND plano_code IS NOT NULL AND plano_code <> ''
  GROUP BY lote_id
  HAVING COUNT(DISTINCT plano_code) = 1
) sub
WHERE l.id = sub.lote_id AND (l.plano IS NULL OR l.plano = '');
