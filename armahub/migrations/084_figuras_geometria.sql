-- figuras_catalogo: geometria de armado para el render (5M.8 Diseñador).
-- geometria = JSON { dim:"2D", tramos:[{lado,giro,sentido}] } dibujado en el
-- Diseñador. NULL = figura sin render aun (se poblara 1x1 desde la interfaz).
-- Base para: render SVG 2D (Bar Manager), 3D (TubeGeometry) y export BVBS.
DO $$ BEGIN ALTER TABLE figuras_catalogo ADD COLUMN geometria JSONB; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
