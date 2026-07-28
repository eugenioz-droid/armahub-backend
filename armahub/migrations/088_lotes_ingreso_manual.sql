-- 5N.5 (Rediseno C): LOTE de ingreso manual (provenance de la tanda), gemelo del
-- import_id del CSV. Un lote agrupa las barras que un cubicador ingresa juntas en el
-- tab "Agregar Cubicacion". Estado del lote: borrador -> terminada (bloqueo).
--
-- Aditiva e idempotente. No borra nada. lote_id/estado en barras quedan NULL para las
-- barras del CSV (no las afecta).

-- Tabla de lotes (metadata de la tanda).
CREATE TABLE IF NOT EXISTS lotes (
    id               SERIAL PRIMARY KEY,
    id_proyecto      TEXT NOT NULL,
    tipo             TEXT NOT NULL DEFAULT 'manual',   -- 'manual' hoy; 'pedido' a futuro
    estado           TEXT NOT NULL DEFAULT 'borrador', -- 'borrador' | 'terminada'
    creado_por       TEXT,
    creado_fecha     TEXT,
    terminado_fecha  TEXT,
    n_barras         INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_lotes_proyecto ON lotes (id_proyecto);

-- Columnas en barras (aditivas): lote_id (FK logica al lote) y estado de la barra.
-- estado de barra: NULL/'confirmada' para CSV; 'borrador'|'terminada' para manual
-- (mientras el lote esta en edicion / cerrado). El patron DO $$ EXCEPTION es el mismo
-- de la migracion 083 (idempotente: si la columna ya existe, no falla).
DO $$ BEGIN ALTER TABLE barras ADD COLUMN lote_id INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE barras ADD COLUMN estado TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_barras_lote ON barras (lote_id);
CREATE INDEX IF NOT EXISTS ix_barras_origen ON barras (origen);
