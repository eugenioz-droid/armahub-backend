-- Registro histórico de barras ELIMINADAS desde Bar Manager. NO es un "deshacer": al borrar, la barra
-- se elimina físicamente de `barras` (desaparece de todas las vistas/cálculos/exportación) y se guarda
-- aquí una COPIA COMPLETA como registro de solo-lectura (quién/cuándo/qué era). No se restaura.
-- Aislada a propósito: ninguna consulta de barras vivas la mira, así el borrado no ensucia KPIs/export.
-- Aditiva e idempotente.
CREATE TABLE IF NOT EXISTS barras_eliminadas (
    del_id          BIGSERIAL PRIMARY KEY,     -- id del registro de eliminación (no el de la barra)
    -- Traza del borrado
    eliminada_por   TEXT,
    eliminada_fecha TEXT,
    -- Copia de la barra original (mismo shape que `barras`, para poder mostrar/consultar sin joins).
    barra_id        BIGINT,                    -- id que tenía la barra en `barras`
    id_unico        TEXT,
    id_proyecto     TEXT,
    nombre_proyecto TEXT,
    plano_code      TEXT,
    nombre_plano    TEXT,
    sector          TEXT,
    piso            TEXT,
    ciclo           TEXT,
    eje             TEXT,
    diam            DOUBLE PRECISION,
    largo_total     DOUBLE PRECISION,
    mult            INTEGER,
    cant            DOUBLE PRECISION,
    cant_total      DOUBLE PRECISION,
    peso_unitario   DOUBLE PRECISION,
    peso_total      DOUBLE PRECISION,
    fecha_carga     TEXT,
    origen          TEXT,
    import_id       INTEGER,
    lote_id         INTEGER,
    estado          TEXT,
    marca           TEXT,
    figura          TEXT,
    dim_a DOUBLE PRECISION, dim_b DOUBLE PRECISION, dim_c DOUBLE PRECISION,
    dim_d DOUBLE PRECISION, dim_e DOUBLE PRECISION, dim_f DOUBLE PRECISION,
    dim_g DOUBLE PRECISION, dim_h DOUBLE PRECISION, dim_i DOUBLE PRECISION,
    ang1 DOUBLE PRECISION, ang2 DOUBLE PRECISION, ang3 DOUBLE PRECISION, ang4 DOUBLE PRECISION,
    radio DOUBLE PRECISION,
    suf_tipo        TEXT,
    editado_por     TEXT,
    revisada        BOOLEAN
);
CREATE INDEX IF NOT EXISTS ix_barras_elim_proyecto ON barras_eliminadas (id_proyecto);
