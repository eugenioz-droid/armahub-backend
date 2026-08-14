-- 105 — ciclo de vida del template: schema_version + updated_at + editado_por
-- ADITIVA e IDEMPOTENTE. NO borra ni reescribe datos: solo agrega columnas nullables.
-- Por qué nullables y SIN backfill: las filas viejas no saben con qué shape se
-- guardaron; reescribirlas sería inventar data. schema_version se ESTAMPA al escribir
-- (POST/PUT) y se DEDUCE al leer para las filas antiguas (modelador.py
-- _deducir_schema_version) — así el dato viejo queda intacto y sigue abriendo.
--
-- schema_version identifica el SHAPE de params.componentes[].dims:
--   1 = Enfierrador MVP  → dims numéricas planas   ({"A": 30})
--   2 = Template Editor  → dims {modo, valor}      ({"A": {"modo":"fija","valor":30}})
-- Los dos conviven en la misma tabla a propósito (mismo motor de receta).

ALTER TABLE templates_catalogo ADD COLUMN IF NOT EXISTS schema_version INTEGER;
ALTER TABLE templates_catalogo ADD COLUMN IF NOT EXISTS updated_at TEXT;
ALTER TABLE templates_catalogo ADD COLUMN IF NOT EXISTS editado_por TEXT;

-- El DELETE de un template tiene que contar sus instancias (409 si está referenciado):
-- sin este índice esa cuenta es un seq scan de elementos_template en cada borrado.
CREATE INDEX IF NOT EXISTS ix_elementos_template_template ON elementos_template (template_id);

-- Filtro por nombre de la biblioteca (GET /templates?nombre=): búsqueda case-insensitive.
CREATE INDEX IF NOT EXISTS ix_templates_nombre_lower ON templates_catalogo (LOWER(nombre));
