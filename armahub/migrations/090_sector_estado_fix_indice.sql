-- 5N.3 FIX defensivo: garantiza que sector_estado tenga el indice unico sobre COLUMNAS
-- DIRECTAS (no de expresion), sin importar que haya quedado de deploys anteriores.
--
-- Contexto: una version previa de la 086 creaba un indice UNICO DE EXPRESION con COALESCE,
-- que Postgres no matchea bien en ON CONFLICT y colgaba el arranque. Si algun deploy
-- alcanzo a crear la tabla con ese indice viejo, la 086 corregida (CREATE ... IF NOT
-- EXISTS) NO lo arregla. Esta migracion lo corrige idempotentemente.
--
-- Todo con IF EXISTS / IF NOT EXISTS y DO $$ EXCEPTION → no falla en ningun estado.

-- 1) Asegurar columnas NOT NULL DEFAULT '' (por si la tabla vieja las tenia nullable).
DO $$ BEGIN
    UPDATE sector_estado SET sector = '' WHERE sector IS NULL;
    UPDATE sector_estado SET piso   = '' WHERE piso   IS NULL;
    UPDATE sector_estado SET ciclo  = '' WHERE ciclo  IS NULL;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- 2) Quitar el indice de EXPRESION viejo si existe (mismo nombre) y crear el bueno sobre
--    columnas directas. DROP + CREATE IF NOT EXISTS es idempotente.
DROP INDEX IF EXISTS ux_sector_estado_clave;
DO $$ BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS ux_sector_estado_clave
        ON sector_estado (id_proyecto, sector, piso, ciclo);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
