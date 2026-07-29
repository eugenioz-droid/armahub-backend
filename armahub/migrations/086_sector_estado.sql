-- 5N.3 (Rediseno B): estado del SECTOR CONSTRUCTIVO como entidad real.
-- El sector constructivo = (id_proyecto, sector, piso, ciclo).
--
-- estado: 'pendiente' (nunca exportado) | 'exportado' (al dia) | 'modificado' (cambio
-- despues de exportar). Actualizado por eventos (crear/editar/eliminar barra, reimport,
-- exportar).
--
-- FIX (arranque colgado): sector/piso/ciclo son NOT NULL DEFAULT '' y el indice unico va
-- sobre las COLUMNAS DIRECTAS (NO un indice de EXPRESION con COALESCE). El ON CONFLICT
-- con indices de expresion (COALESCE(...)) no siempre lo matchea Postgres -> el INSERT
-- fallaba -> la migracion fallaba -> el server no arrancaba. Con columnas NOT NULL
-- DEFAULT '' no hay NULL, no hace falta COALESCE, y el ON CONFLICT sobre columnas simples
-- es 100% soportado.
--
-- Aditiva e idempotente. No borra nada.
CREATE TABLE IF NOT EXISTS sector_estado (
    id                 SERIAL PRIMARY KEY,
    id_proyecto        TEXT NOT NULL,
    sector             TEXT NOT NULL DEFAULT '',
    piso               TEXT NOT NULL DEFAULT '',
    ciclo              TEXT NOT NULL DEFAULT '',
    estado             TEXT NOT NULL DEFAULT 'pendiente',
    exportado_fecha    TEXT,
    modificado_fecha   TEXT,
    actualizado_fecha  TEXT,
    actualizado_por    TEXT
);

-- Indice unico sobre columnas DIRECTAS (no expresion) → ON CONFLICT lo matchea siempre.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sector_estado_clave
    ON sector_estado (id_proyecto, sector, piso, ciclo);

CREATE INDEX IF NOT EXISTS ix_sector_estado_proyecto ON sector_estado (id_proyecto);
