-- 5N.8: factor de peso por obra. Factor GLOBAL que multiplica el peso teorico de todas
-- las barras del proyecto (ej. +1% de norma). Default 0 (= no altera nada hoy); se
-- activa cuando el usuario lo configure. peso_final = peso_teorico * (1 + factor_peso/100).
--
-- Aditiva e idempotente (patron DO $$ EXCEPTION de la migracion 083). No toca data.
DO $$ BEGIN ALTER TABLE proyectos ADD COLUMN factor_peso DOUBLE PRECISION DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
