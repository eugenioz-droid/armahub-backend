-- 5N.42: SUFIJO de tipología para el ingreso manual. Texto libre por barra que se CONCATENA a la
-- tipología (marca) SOLO al exportar a aSa Studio; dentro del sistema la tipología (marca) NO se
-- modifica, para no romper dashboards/agrupaciones. Aditiva, nullable, sin default.
DO $$ BEGIN ALTER TABLE barras ADD COLUMN suf_tipo TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
