-- barras: marca de edicion manual desde la plataforma (5M.3)
-- editado_por = email de quien edito por ultima vez; editado_fecha = cuando.
-- Distingue la edicion-plataforma de la data del CSV. Alimenta el aviso de re-import
-- (5M.5) y el color en matrices (5M.6). NULL = nunca editada a mano.
DO $$ BEGIN ALTER TABLE barras ADD COLUMN editado_por TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE barras ADD COLUMN editado_fecha TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
