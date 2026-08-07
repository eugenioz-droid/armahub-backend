-- 102 — M1.8: cerrar carreras MAX+1 con unicidad real en BD.
-- 1) Repara duplicados históricos de num_obra por obra (si los hubiera): el lote
--    con id menor conserva su número; los siguientes reciben números nuevos a
--    continuación del máximo de la obra. Idempotente (sin duplicados no hace nada).
WITH dups AS (
  SELECT id, id_proyecto,
         ROW_NUMBER() OVER (PARTITION BY id_proyecto, num_obra ORDER BY id) AS rn
  FROM lotes
  WHERE num_obra IS NOT NULL
), maxn AS (
  SELECT id_proyecto, MAX(num_obra) AS mx FROM lotes GROUP BY id_proyecto
), reasign AS (
  SELECT d.id,
         m.mx + ROW_NUMBER() OVER (PARTITION BY d.id_proyecto ORDER BY d.id) AS nuevo
  FROM dups d
  JOIN maxn m USING (id_proyecto)
  WHERE d.rn > 1
)
UPDATE lotes l SET num_obra = r.nuevo FROM reasign r WHERE l.id = r.id;

-- 2) Unicidad num_obra por obra (NULLs permitidos, no chocan entre sí).
CREATE UNIQUE INDEX IF NOT EXISTS idx_lotes_proyecto_num_obra
  ON lotes (id_proyecto, num_obra);

-- 3) Repara duplicados históricos de correlativo REC- (misma estrategia).
WITH dups AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY correlativo ORDER BY id) AS rn
  FROM reclamos WHERE correlativo IS NOT NULL
), mx AS (
  SELECT COALESCE(MAX(CAST(REPLACE(correlativo, 'REC-', '') AS INTEGER)), 0) AS m
  FROM reclamos WHERE correlativo LIKE 'REC-%'
), reasign AS (
  SELECT d.id, 'REC-' || LPAD((mx.m + ROW_NUMBER() OVER (ORDER BY d.id))::text, 3, '0') AS nuevo
  FROM dups d, mx WHERE d.rn > 1
)
UPDATE reclamos r SET correlativo = s.nuevo FROM reasign s WHERE r.id = s.id;

-- 4) Unicidad de correlativo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reclamos_correlativo
  ON reclamos (correlativo);
