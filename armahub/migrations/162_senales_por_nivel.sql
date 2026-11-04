-- SEÑALES POR NIVEL: BARRA O ELEMENTO (4-nov).
--
-- La revisión de barras mira una barra contra una regla. La revisión de elementos mira un
-- CÓDIGO contra el mismo ciclo del piso anterior: si le faltan muros, si los kilos se
-- dispararon, si es el mismo código mandado dos veces. Son hallazgos de otra unidad, con
-- otra fila en pantalla, pero el ciclo de vida es el mismo —abierta, resuelta, no aplica,
-- cerrada— y por eso viven en la misma tabla, separados por `nivel`. Todo lo que ya existe
-- es `barra`; lo nuevo entra como `elemento`.
ALTER TABLE chequeo_senales ADD COLUMN IF NOT EXISTS nivel TEXT NOT NULL DEFAULT 'barra';
CREATE INDEX IF NOT EXISTS chequeo_senales_nivel_idx ON chequeo_senales (nivel, estado);
