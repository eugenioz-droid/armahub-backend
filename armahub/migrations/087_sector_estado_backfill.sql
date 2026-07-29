-- 5N.3 (Rediseno B): backfill de sector_estado desde la data existente, para NO perder
-- el estado actual al estrenar la tabla. Deriva el estado inicial con el MISMO criterio
-- del mecanismo viejo (dirty-flag por fechas): rojo si la ultima carga es posterior a la
-- ultima exportacion.
--
-- FIX (arranque colgado): el GROUP BY agrupa por COALESCE(...,'') para que las claves
-- coincidan EXACTO con el indice unico de la 086 (que usa COALESCE) y NO se generen dos
-- filas con la misma clave de conflicto en el mismo INSERT (barras con sector NULL vs ''
-- colapsaban a la misma clave -> "ON CONFLICT cannot affect row a second time" ->
-- migracion fallaba -> init_db reintentaba y el server no arrancaba).
--
-- Idempotente: ON CONFLICT DO NOTHING. Corre una sola vez por el sistema de migraciones.

-- 1) Un renglon por cada sector constructivo PRESENTE en barras. Se agrupa por las MISMAS
--    expresiones COALESCE del indice unico, y se insertan esos valores normalizados.
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
ON CONFLICT (id_proyecto, COALESCE(sector,''), COALESCE(piso,''), COALESCE(ciclo,''))
DO NOTHING;

-- 2) Marcar 'exportado' o 'modificado' segun la ultima exportacion (export_log), usando la
--    misma export_key que el dirty-flag actual (UPPER(sector)_piso_ciclo).
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
  AND e.export_key = UPPER(COALESCE(se.sector,'')) || '_' || COALESCE(se.piso,'') || '_' || COALESCE(se.ciclo,'');
