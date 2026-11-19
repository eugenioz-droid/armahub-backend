-- Subir plano desde ArmaScanner (19-nov, programa §8.13 paso 1)
--
-- El usuario, 19-nov: subir todas las barras del plano con su estado y «bloquear la
-- exportación si hay algo con duda». El plano entra por la importación de despieces de
-- siempre (origen 'csv', reemplazo por plano); esto agrega lo que la importación no sabía:
--
-- barras.revision   cómo quedó la barra en la revisión de ArmaScanner: 'aprobada', 'duda' o
--                   'pendiente'. NULL = barra que no viene de ArmaScanner (A Detailer, manual):
--                   no frena nada.
-- imports.herramienta / herramienta_version / equipo   de dónde vino la carga.
-- imports.pendientes  {"SECTOR|PISO|CICLO": n} barras del plano que todavía no están
--                   aprobadas, incluidas las que no se pudieron subir por datos incompletos.
--                   Mientras una carga vigente tenga pendientes en una combinación, esa
--                   combinación no se exporta.
ALTER TABLE barras  ADD COLUMN IF NOT EXISTS revision TEXT;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS herramienta TEXT;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS herramienta_version TEXT;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS equipo TEXT;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS pendientes JSONB;
