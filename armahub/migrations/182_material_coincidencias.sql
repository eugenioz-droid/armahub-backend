-- Material disponible › coincidencias (25-nov, SPECS §15.3-15.4, fase 2): lo que encontró la última búsqueda.
--
-- Una fila por par «barra disponible ↔ ítem por fabricar» de aSa. Se reemplaza en cada
-- búsqueda (la completa de las 06:00, la del botón, o la de una barra recién ingresada): no
-- es historia, es la foto de qué se podría hacer hoy con lo disponible. Del ítem se guarda lo
-- que muestra la pantalla, para no volver a preguntarle a aSa.
CREATE TABLE IF NOT EXISTS material_coincidencias (
    id           SERIAL PRIMARY KEY,
    barra_id     INTEGER NOT NULL REFERENCES material_barras(id) ON DELETE CASCADE,
    item_key     BIGINT NOT NULL,                -- OrderItemKey del ítem por fabricar
    cc           TEXT,
    marca        TEXT,
    obra         TEXT,
    cliente      TEXT,
    descr_cc     TEXT,
    elemento     TEXT,
    estado_asa   TEXT,                           -- Open | Processed
    figura       TEXT,
    lados        JSONB NOT NULL,                 -- los del ítem, en mm
    tipo         TEXT NOT NULL,                  -- 'igual' | 'corte'
    cortes       JSONB NOT NULL DEFAULT '[]',    -- [[letra, mm]]: lo que se corta (en las rectas, lo que sobra)
    piezas       INTEGER NOT NULL DEFAULT 1,     -- cuántas piezas salen de una barra disponible
    cant_item    NUMERIC(12,2),
    cubre        NUMERIC(12,2),
    kg_ahorro    NUMERIC(12,2),
    buscado_el   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (barra_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_material_coincidencias_barra ON material_coincidencias (barra_id);
