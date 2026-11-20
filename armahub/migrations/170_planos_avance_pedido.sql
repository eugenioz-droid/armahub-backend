-- Planos en línea: avance, barras a la vista y pedido aparte (20-nov, 2ª vuelta; programa §8.13
-- 6.11–6.14, SPECS §5.4).
--
-- Guardar el plano (con su avance, terminado o no) ya no carga sus barras como despiece: quedan
-- a la vista en `barras_json` (lo que ArmaScanner manda al guardar) con su resumen. «Enviar
-- pedido» las pasa a los despieces de la obra desde la versión guardada: `pedido_version` dice
-- cuál fue y `codigos`, los códigos con que el plano ya entró (se reemplazan en el envío siguiente).
ALTER TABLE planos_obra ADD COLUMN IF NOT EXISTS resumen        JSONB;
ALTER TABLE planos_obra ADD COLUMN IF NOT EXISTS barras_json    JSONB;
ALTER TABLE planos_obra ADD COLUMN IF NOT EXISTS codigos        JSONB;
ALTER TABLE planos_obra ADD COLUMN IF NOT EXISTS pedido_version INTEGER;
ALTER TABLE planos_obra ADD COLUMN IF NOT EXISTS pedido_el      TIMESTAMPTZ;
ALTER TABLE planos_obra ADD COLUMN IF NOT EXISTS pedido_por     TEXT;
ALTER TABLE planos_obra ADD COLUMN IF NOT EXISTS pdf            TEXT;
