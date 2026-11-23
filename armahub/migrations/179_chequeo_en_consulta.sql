-- Revisión de barras: «En consulta», una marca sobre la barra abierta con su fecha y quién
-- «EN CONSULTA» (23-nov): la barra todavía no se puede resolver porque se le preguntó algo a
-- alguien. NO es un estado nuevo: sigue abierta y cuenta como por resolver en todos lados.
-- Se guarda desde cuándo y quién la marcó; el fin es cuando se resuelve (declarada_el o
-- resuelto_el, que ya existen), así que no hace falta una tercera fecha.
ALTER TABLE chequeo_senales ADD COLUMN IF NOT EXISTS consulta_desde TIMESTAMPTZ;
ALTER TABLE chequeo_senales ADD COLUMN IF NOT EXISTS consulta_por TEXT;
