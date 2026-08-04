-- Backfill: las barras CSV viejas no tenían `creado_por` (solo la tabla imports registraba quién
-- importó). Se rellena desde imports.usuario vía import_id, para que TODAS las barras (CSV + manual)
-- tengan su responsable y los KPIs de productividad por persona puedan sumar sobre `barras`.
-- Solo toca barras CSV sin creado_por que tengan un import_id conocido. Aditiva e idempotente.
UPDATE barras b
SET creado_por = i.usuario
FROM imports i
WHERE b.import_id = i.id
  AND b.creado_por IS NULL
  AND i.usuario IS NOT NULL;
