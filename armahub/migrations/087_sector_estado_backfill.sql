-- 5N.3 (Rediseno B): backfill de sector_estado desde la data existente, para NO perder
-- el estado actual al estrenar la tabla. Deriva el estado inicial con el MISMO criterio
-- del mecanismo viejo (dirty-flag por fechas): rojo si la ultima carga es posterior a la
-- ultima exportacion. Asi el arranque es coherente con lo que las matrices muestran hoy.
--
-- Idempotente: ON CONFLICT DO NOTHING (si ya hay filas, no las pisa). Corre una sola vez
-- por el sistema de migraciones de todos modos.

-- 1) Un renglon por cada sector constructivo PRESENTE en barras (existan o no en export_log).
INSERT INTO sector_estado (id_proyecto, sector, piso, ciclo, estado, modificado_fecha, actualizado_fecha)
SELECT b.id_proyecto,
       b.sector,
       b.piso,
       b.ciclo,
       'pendiente',                 -- provisional; se ajusta abajo segun export_log
       MAX(b.fecha_carga),          -- ultima carga del sector (senal de modificacion)
       MAX(b.fecha_carga)
FROM barras b
GROUP BY b.id_proyecto, b.sector, b.piso, b.ciclo
ON CONFLICT (id_proyecto, COALESCE(sector,''), COALESCE(piso,''), COALESCE(ciclo,''))
DO NOTHING;

-- 2) Marcar 'exportado' o 'modificado' segun la ultima exportacion registrada en export_log.
--    Se compara la ultima export (por export_key = SECTOR_PISO_CICLO, con UPPER(sector)
--    como hace el dirty-flag actual) contra la ultima carga del sector.
UPDATE sector_estado se
SET estado = CASE
        WHEN se.modificado_fecha IS NULL THEN 'exportado'          -- exportado, sin carga posterior conocida
        WHEN se.modificado_fecha > e.ultima_export THEN 'modificado'
        ELSE 'exportado'
    END,
    exportado_fecha = e.ultima_export
FROM (
    SELECT id_proyecto,
           export_key,
           MAX(fecha) AS ultima_export
    FROM export_log
    GROUP BY id_proyecto, export_key
) e
WHERE e.id_proyecto = se.id_proyecto
  AND e.export_key = UPPER(COALESCE(se.sector,'')) || '_' || COALESCE(se.piso,'') || '_' || COALESCE(se.ciclo,'');
