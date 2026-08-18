-- 106 — CONFIGURACIÓN GLOBAL DEL MODELADOR (con qué nace cada barra)
-- Aditiva e idempotente (patrón CREATE TABLE IF NOT EXISTS de la 092/104). NO toca
-- ninguna tabla existente.
--
-- GLOBAL, NO POR OBRA (decisión del usuario 17-ago). obra_config (migración 092) es
-- otra cosa: la plantilla de pisos/ciclos y los factores del CREADOR DE BARRAS de UNA
-- obra. Esta config es del MODELADOR y rige para toda la plataforma, así que NO cuelga
-- de obra_config ni de proyectos. Cómo conviven las dos se decidirá cuando se aborde el
-- Enfierrador; colgarla de la obra ahora sería adelantar una decisión que no está tomada.
--
-- UNA FILA (id = 1), CONTENIDO EN JSONB. Por qué JSON y no columnas: la pantalla de
-- configuración va a seguir creciendo (redondeo del corte, lados fijos por figura,
-- tipologías nuevas…) y cada campo nuevo obligaría a una migración de esquema. El
-- CHECK (id = 1) es lo que impide que aparezca una segunda config "global".
--
-- La fila NO se siembra aquí: los valores por defecto viven en modelador_config.py
-- (DEFAULTS) y se sirven cuando la fila no existe. Sembrarlos en SQL los congelaría en
-- el estado del día de la migración y dejaría dos fuentes de verdad.
CREATE TABLE IF NOT EXISTS modelador_config (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    config            JSONB NOT NULL DEFAULT '{}'::jsonb,
    actualizado_por   TEXT,
    actualizado_fecha TEXT
);
