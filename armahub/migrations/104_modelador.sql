-- 104 — modelador 3D: templates + elementos_template + barras.template_instancia_id
-- Idempotente: se aplica sola al arranque (db.py _run_migrations, savepoint por migración).
-- NO toca datos existentes. barras.origen es TEXT libre (sin CHECK) → acepta 'template' sin cambio.

CREATE TABLE IF NOT EXISTS templates_catalogo (
  id BIGSERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  params JSONB NOT NULL,
  obra TEXT,
  creado_por TEXT,
  fecha TEXT DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS elementos_template (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT,
  lote_id BIGINT,
  params JSONB NOT NULL,
  creado_por TEXT,
  fecha TEXT DEFAULT (NOW() AT TIME ZONE 'UTC')
);

DO $$ BEGIN
  ALTER TABLE barras ADD COLUMN template_instancia_id BIGINT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_templates_obra ON templates_catalogo (obra, tipo);
