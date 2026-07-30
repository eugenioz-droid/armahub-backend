-- 5N.19: check "Revisada" de la barra, con trazabilidad. El cubicador marca cada barra
-- como revisada (proceso real de revision); para TERMINAR un lote, TODAS sus barras deben
-- estar revisadas (regla dura en backend). Se guarda quien y cuando (trazabilidad).
--
-- Aditiva e idempotente (patron DO $$ EXCEPTION de la migracion 083/089). No toca data:
-- lo existente queda revisada=false (nunca revisado explicitamente).
DO $$ BEGIN ALTER TABLE barras ADD COLUMN revisada BOOLEAN DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE barras ADD COLUMN revisada_por TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE barras ADD COLUMN revisada_fecha TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
