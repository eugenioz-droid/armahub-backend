-- Material disponible › asignaciones (25-nov, SPECS §15.4-15.5, fase 3): a qué ítem de aSa va
-- cada barra disponible.
--
-- Se asigna desde la ventana de la barra, con su búsqueda hecha en el momento. El saldo de la
-- barra (material_barras.cant_disponible) baja al asignar y vuelve al quitar. Producción marca
-- con un check que ya lo produjo (quién y cuándo). Sin saldo y con todo confirmado, la barra
-- queda 'consumida' y pasa al Resumen. Las cantidades se rebajan sólo acá: en aSa lo maneja
-- producción (usuario, 25-nov). Del ítem se guarda lo que muestra la pantalla.
CREATE TABLE IF NOT EXISTS material_asignaciones (
    id             SERIAL PRIMARY KEY,
    barra_id       INTEGER NOT NULL REFERENCES material_barras(id) ON DELETE CASCADE,
    item_key       BIGINT NOT NULL,              -- OrderItemKey del ítem que se hace con la barra
    cc             TEXT,
    marca          TEXT,
    obra           TEXT,
    cliente        TEXT,
    descr_cc       TEXT,
    elemento       TEXT,
    ubicacion      TEXT,                         -- dónde va: descripción del CC - elemento de la tarjeta
    estado_asa     TEXT,                         -- Open | Processed, al asignar
    figura         TEXT,
    lados          JSONB NOT NULL,               -- los del ítem, en mm
    tipo           TEXT NOT NULL,                -- 'igual' | 'corte'
    cortes         JSONB NOT NULL DEFAULT '[]',  -- [[letra, mm]]: lo que se corta
    piezas         INTEGER NOT NULL DEFAULT 1,   -- piezas del ítem por cada barra disponible
    cant_barras    INTEGER NOT NULL CHECK (cant_barras > 0),
    cant_piezas    NUMERIC(12,2) NOT NULL,
    kg             NUMERIC(12,2),                -- kilos del ítem que ya no se fabrican de cero
    asignado_por   TEXT NOT NULL,
    asignado_el    TIMESTAMPTZ NOT NULL DEFAULT now(),
    producido_por  TEXT,
    producido_el   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_material_asignaciones_barra ON material_asignaciones (barra_id);
CREATE INDEX IF NOT EXISTS idx_material_asignaciones_item ON material_asignaciones (item_key);
