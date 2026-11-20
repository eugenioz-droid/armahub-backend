-- 172: planos sólo cargados (sin trabajo) y reportes de ArmaScanner (20-nov-2026)
-- etapa: 'cargado' = el cubicador cargó el plano del calculista en ArmaScanner y todavía no lo trabaja
--        (queda en ArmaHub para que cualquiera lo vea y lo tome); NULL = con copia de trabajo.
ALTER TABLE planos_obra ADD COLUMN IF NOT EXISTS etapa TEXT;

-- Reportes que el cubicador manda desde ArmaScanner («Enviar reporte»): el diagnóstico del equipo,
-- el registro del último escaneo y la bitácora del plano, en un ZIP en R2.
CREATE TABLE IF NOT EXISTS armascanner_reportes (
    id         SERIAL PRIMARY KEY,
    email      TEXT,
    equipo     TEXT,
    version    TEXT,
    obra       TEXT,
    plano      TEXT,
    comentario TEXT,
    archivo    TEXT NOT NULL,
    tamano     BIGINT,
    creado_el  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
