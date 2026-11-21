-- 173: trazabilidad de revisiones de los planos de ArmaScanner (20-nov-2026, programa 4.12)
-- Al cargar una revisión nueva de un plano (mismo número), el cubicador indica si reemplaza a la
-- anterior o si la complementa (una nube que cambia un elemento: las dos quedan vigentes).
-- relacion: 'reemplaza' | 'complementa' | NULL; relacion_de: el plano (archivo) de la revisión anterior.
ALTER TABLE planos_obra ADD COLUMN IF NOT EXISTS relacion TEXT;
ALTER TABLE planos_obra ADD COLUMN IF NOT EXISTS relacion_de TEXT;
