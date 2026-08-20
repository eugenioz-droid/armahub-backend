-- 107 — ESTRUCTURA REABRIBLE del modelador (elementos_template deja de ser write-only)
-- ADITIVA e IDEMPOTENTE (patrón de la 104/105). NO toca ni borra un solo dato existente:
-- todas las columnas nacen nullables y sin backfill.
--
-- QUÉ RESUELVE
-- Hasta ahora `elementos_template` guardaba la receta instanciada y nadie la volvía a
-- leer: cargar una estructura al despiece era un viaje de ida. Para poder REABRIRLA y
-- regenerarla hacen falta dos cosas que la tabla no tenía:
--   1) la TRAZA de la estructura (dónde vive y cómo se llama), y
--   2) un identificador que cruce las barras entre una generación y la siguiente.
--
-- (1) TRAZA. El nombre NO es un campo que el usuario escriba: se DERIVA de obra + ciclo
-- + piso + eje (decisión del usuario: "no debiera haber 2 muros por eje; si un eje tiene
-- 2 muros, el cubicador los subdivide"). Se guarda ya derivado para que mañana un
-- "element manager" sea LEER esta tabla y no recalcular nada.
--
-- (2) barras.origen_ref — DE DÓNDE NACIÓ CADA BARRA dentro de la receta: qué componente
-- y qué posición de su distribución. Es la llave del cruce entre generaciones: con ella
-- reabrir + regenerar ACTUALIZA lo que cambió, CREA lo nuevo y BORRA lo que dejó de
-- existir, conservando el id de cada barra, su historia y su marca de revisión. Sin ella
-- sólo se podía borrar todo y recrear, que es justo lo que el usuario no quiere.
--
-- El borrado de esas barras usa el MISMO registro histórico que el Bar Manager
-- (barras_eliminadas, migración 100): se le agregan las dos columnas nuevas para que el
-- snapshot no pierda de qué estructura venía la barra borrada.

-- ── (1) TRAZA DE LA ESTRUCTURA ────────────────────────────────────────────────────────
-- nombre   = DERIVADO (obra · ciclo · piso · eje) — el usuario no lo escribe.
-- elemento = viga / muro / losa / columna / fundacion / gen.
-- piso     = UNO por estructura; se estampa igual en todas sus barras.
-- estado   = 'activa' | 'retirada' (la estructura cuyas barras se borraron todas).
ALTER TABLE elementos_template ADD COLUMN IF NOT EXISTS nombre      TEXT;
ALTER TABLE elementos_template ADD COLUMN IF NOT EXISTS elemento    TEXT;
ALTER TABLE elementos_template ADD COLUMN IF NOT EXISTS piso        TEXT;
ALTER TABLE elementos_template ADD COLUMN IF NOT EXISTS estado      TEXT;
ALTER TABLE elementos_template ADD COLUMN IF NOT EXISTS id_proyecto TEXT;
ALTER TABLE elementos_template ADD COLUMN IF NOT EXISTS sector      TEXT;
ALTER TABLE elementos_template ADD COLUMN IF NOT EXISTS ciclo       TEXT;
ALTER TABLE elementos_template ADD COLUMN IF NOT EXISTS eje         TEXT;
ALTER TABLE elementos_template ADD COLUMN IF NOT EXISTS updated_at  TEXT;
ALTER TABLE elementos_template ADD COLUMN IF NOT EXISTS editado_por TEXT;

-- Listar las estructuras de UN despiece es la consulta de todos los días (la hace el
-- creador de despieces cada vez que se abre un lote): sin este índice es un seq scan.
CREATE INDEX IF NOT EXISTS ix_elementos_template_lote ON elementos_template (lote_id);

-- ── (2) IDENTIFICADOR DE ORIGEN POR BARRA ─────────────────────────────────────────────
-- Formato: '<uid del componente>#<ordinal del item dentro de ese componente>'. El uid lo
-- estampa el editor en la receta y viaja con ella, así que sobrevive a guardar y reabrir.
DO $$ BEGIN
  ALTER TABLE barras ADD COLUMN origen_ref TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- El sync de una estructura lee TODAS sus barras por template_instancia_id.
CREATE INDEX IF NOT EXISTS ix_barras_instancia ON barras (template_instancia_id);

-- ── (3) EL REGISTRO DE BORRADOS NO PIERDE LA PROCEDENCIA ──────────────────────────────
-- barras_eliminadas (migración 100) es la copia de solo-lectura de toda barra borrada.
-- El borrado del sync escribe ahí igual que el del Bar Manager, así que necesita las dos
-- columnas nuevas para poder decir de QUÉ estructura y de qué parte de ella venía.
DO $$ BEGIN
  ALTER TABLE barras_eliminadas ADD COLUMN template_instancia_id BIGINT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE barras_eliminadas ADD COLUMN origen_ref TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
