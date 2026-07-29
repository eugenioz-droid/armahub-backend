-- 5N.3 (Rediseno B): backfill de sector_estado desde la data existente, para NO perder
-- el estado actual al estrenar la tabla. Deriva el estado inicial con el criterio del
-- dirty-flag por fechas (rojo si la ultima carga es posterior a la ultima exportacion).
--
-- FIX: el ON CONFLICT va sobre las COLUMNAS DIRECTAS (id_proyecto, sector, piso, ciclo),
-- que ahora son NOT NULL DEFAULT '' en la 086. El SELECT normaliza NULL->'' con COALESCE
-- para que la clave sea unica y no viole el NOT NULL. Idempotente (DO NOTHING).

-- 1) Un renglon por cada sector constructivo PRESENTE en barras (NULL normalizado a '').
INSERT INTO sector_estado (id_proyecto, sector, piso, ciclo, estado, modificado_fecha, actualizado_fecha)
SELECT id_proyecto, sector, piso, ciclo, 'pendiente', ult, ult
FROM (
    SELECT b.id_proyecto                AS id_proyecto,
           COALESCE(b.sector, '')       AS sector,
           COALESCE(b.piso, '')         AS piso,
           COALESCE(b.ciclo, '')        AS ciclo,
           MAX(b.fecha_carga)           AS ult
    FROM barras b
    GROUP BY b.id_proyecto, COALESCE(b.sector, ''), COALESCE(b.piso, ''), COALESCE(b.ciclo, '')
) g
ON CONFLICT (id_proyecto, sector, piso, ciclo) DO NOTHING;

-- 2) Marcar 'exportado' o 'modificado' segun la ultima exportacion (export_log), con la
--    misma export_key del dirty-flag actual (UPPER(sector)_piso_ciclo).
UPDATE sector_estado se
SET estado = CASE
        WHEN se.modificado_fecha IS NULL THEN 'exportado'
        WHEN se.modificado_fecha > e.ultima_export THEN 'modificado'
        ELSE 'exportado'
    END,
    exportado_fecha = e.ultima_export
FROM (
    SELECT id_proyecto, export_key, MAX(fecha) AS ultima_export
    FROM export_log
    GROUP BY id_proyecto, export_key
) e
WHERE e.id_proyecto = se.id_proyecto
  AND e.export_key = UPPER(se.sector) || '_' || se.piso || '_' || se.ciclo;
