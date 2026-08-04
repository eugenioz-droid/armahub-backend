-- Backfill: las barras MANUALES (origen='manual') se insertaban con editado_por pero SIN creado_por
-- → los KPIs de productividad (que agrupan por creado_por) no las contaban. Se rellena creado_por
-- desde editado_por (quien cubicó). Si editado_por también fuera NULL, se cae al creado_por del lote.
-- Aditiva e idempotente (solo toca manuales sin creado_por).
UPDATE barras b
SET creado_por = COALESCE(b.editado_por, l.creado_por)
FROM lotes l
WHERE b.lote_id = l.id
  AND b.origen = 'manual'
  AND b.creado_por IS NULL
  AND COALESCE(b.editado_por, l.creado_por) IS NOT NULL;

-- Por si alguna manual no tuviera lote_id (no debería), rellenar desde editado_por.
UPDATE barras
SET creado_por = editado_por
WHERE origen = 'manual' AND creado_por IS NULL AND editado_por IS NOT NULL;
