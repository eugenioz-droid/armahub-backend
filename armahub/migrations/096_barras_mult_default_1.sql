-- Coherencia de cantidad: mult NUNCA debe quedar NULL (el multiplicador implícito es 1). Los CSV
-- importados sin columna MULT dejaban mult=NULL. Se backfillea a 1 (donde el cant ya = cant_total,
-- así 1×cant = cant_total sigue siendo coherente). Aditiva e idempotente.
UPDATE barras SET mult = 1 WHERE mult IS NULL;
