-- 178: Desarrollo de ArmaScanner (23-nov-2026)
--
-- Los casos que llegan de ArmaScanner: los planos que el lector no reconoce (tipo «plano», con el DWG
-- y lo que el lector encontró) y los reportes («reporte»), con su estado: nuevo → en_estudio →
-- resuelto (con la versión que lo resolvió) | descartado. Y la base de conocimiento de las oficinas de
-- cálculo: qué lector de ArmaScanner lee sus planos y lo que se sabe de ellas.
-- [Usuario 23-nov: «un flujo que no dependa de estar enviando planos manualmente sin control ni
-- trazabilidad»; «un pequeño apartado donde listemos las oficinas de cálculo… así se va estableciendo
-- una base de conocimiento»]
ALTER TABLE armascanner_reportes ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'reporte';
ALTER TABLE armascanner_reportes ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'nuevo';
ALTER TABLE armascanner_reportes ADD COLUMN IF NOT EXISTS obra_id TEXT;
ALTER TABLE armascanner_reportes ADD COLUMN IF NOT EXISTS lector TEXT;
ALTER TABLE armascanner_reportes ADD COLUMN IF NOT EXISTS nota TEXT;
ALTER TABLE armascanner_reportes ADD COLUMN IF NOT EXISTS version_resuelto TEXT;
ALTER TABLE armascanner_reportes ADD COLUMN IF NOT EXISTS resuelto_por TEXT;
ALTER TABLE armascanner_reportes ADD COLUMN IF NOT EXISTS resuelto_el TIMESTAMPTZ;
-- Los reportes de antes ya se vieron: quedan en estudio, no como nuevos.
UPDATE armascanner_reportes SET estado = 'en_estudio' WHERE estado = 'nuevo';

CREATE TABLE IF NOT EXISTS armascanner_oficinas (
    calculista_id    BIGINT PRIMARY KEY,
    lector           TEXT,
    notas            TEXT,
    actualizado_por  TEXT,
    actualizado_el   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lo que ya se sabe (lectores.py): Los Lilenes → scad; Santolaya → revit; Playa Peñuelas → delporte.
INSERT INTO armascanner_oficinas (calculista_id, lector, actualizado_por)
SELECT calculista_id, 'scad', 'migración 178' FROM proyectos WHERE id_proyecto = '2013160' AND calculista_id IS NOT NULL
ON CONFLICT (calculista_id) DO NOTHING;
INSERT INTO armascanner_oficinas (calculista_id, lector, actualizado_por)
SELECT calculista_id, 'revit', 'migración 178' FROM proyectos WHERE id_proyecto = 'PROY-2461137.6285' AND calculista_id IS NOT NULL
ON CONFLICT (calculista_id) DO NOTHING;
INSERT INTO armascanner_oficinas (calculista_id, lector, actualizado_por)
SELECT calculista_id, 'delporte', 'migración 178' FROM proyectos WHERE id_proyecto = '2013204' AND calculista_id IS NOT NULL
ON CONFLICT (calculista_id) DO NOTHING;
