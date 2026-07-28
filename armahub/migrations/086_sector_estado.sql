-- 5N.3 (Rediseno B): estado del SECTOR CONSTRUCTIVO como entidad real.
-- El sector constructivo = (id_proyecto, sector, piso, ciclo). Hoy no existe como
-- entidad; su estado exportado/modificado se infiere restando fechas (export_log vs
-- MAX(fecha_carga)), lo que tiene una brecha: editar una barra no marca el sector
-- modificado. Esta tabla materializa el estado con valores explicitos, actualizado por
-- eventos (crear/editar/eliminar barra, reimport con cambios, exportar).
--
-- estado: 'pendiente'  = nunca exportado
--         'exportado'  = al dia (exportado y sin cambios posteriores)
--         'modificado' = cambio despues de exportar (rojo en las matrices)
--
-- Aditiva e idempotente. No borra nada. Se puebla desde barras + export_log en el
-- backfill de la migracion 087.
CREATE TABLE IF NOT EXISTS sector_estado (
    id                 SERIAL PRIMARY KEY,
    id_proyecto        TEXT NOT NULL,
    sector             TEXT,
    piso               TEXT,
    ciclo              TEXT,
    estado             TEXT NOT NULL DEFAULT 'pendiente',
    exportado_fecha    TEXT,
    modificado_fecha   TEXT,
    actualizado_fecha  TEXT,
    actualizado_por    TEXT
);

-- Clave unica del sector constructivo (COALESCE para tolerar NULL en sector/piso/ciclo,
-- que en la data existen). El UPSERT del backend usa esta clave.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sector_estado_clave
    ON sector_estado (id_proyecto, COALESCE(sector,''), COALESCE(piso,''), COALESCE(ciclo,''));

CREATE INDEX IF NOT EXISTS ix_sector_estado_proyecto ON sector_estado (id_proyecto);
