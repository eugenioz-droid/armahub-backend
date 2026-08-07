-- 103 — M1.10: plano del despiece a nivel de LOTE (edificio = un plano por lote).
-- El cubicador registra con qué plano trabajó; se estampa a plano_code de sus barras.
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS plano TEXT;

-- Backfill: si todas las barras manuales de un lote comparten el mismo nombre_plano
-- (el NOMBRE legible, no el código interno plano_code), se adopta como plano del lote.
UPDATE lotes l
SET plano = sub.pn
FROM (
  SELECT lote_id, MAX(nombre_plano) AS pn
  FROM barras
  WHERE lote_id IS NOT NULL AND origen = 'manual'
    AND nombre_plano IS NOT NULL AND nombre_plano <> ''
  GROUP BY lote_id
  HAVING COUNT(DISTINCT nombre_plano) = 1
) sub
WHERE l.id = sub.lote_id AND (l.plano IS NULL OR l.plano = '');
