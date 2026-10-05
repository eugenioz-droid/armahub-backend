-- 126 — UN ANÁLISIS IMPORTADO NO ES UN ANÁLISIS VALIDADO (5-oct).
--
-- QUÉ PASA. Entraron 36 análisis causa raíz que estaban hechos a mano en planillas. Son
-- un punto de partida, no una conclusión: el usuario lo dijo así, «esos reclamos yo
-- tengo que validarlos, no los des por cerrado». Y hay motivo: los escribieron los
-- propios cubicadores y la causa quedó a veces en la fila de la M equivocada.
--
-- SIN ESTO NO SE PODRÍAN DISTINGUIR. Un reclamo con causa puede venir de tres sitios: de
-- la planilla vieja de consolidado, de una ficha de análisis, o de que el usuario lo
-- clasificó él mismo. Mirando sólo `categoria_ishikawa` los tres se ven igual, y el
-- trabajo que falta —revisar lo que otros escribieron— quedaría invisible.
--
-- QUIÉN LO ESTAMPA. Nadie a mano: se pone solo cuando el usuario guarda el análisis
-- desde la pantalla. Lo importado nace sin estampar, que es lo correcto: nadie lo
-- validó todavía.

DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN analisis_validado_por TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN analisis_validado_el TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Para la lista de trabajo, que filtra justamente por esto.
CREATE INDEX IF NOT EXISTS ix_reclamos_analisis_validado
    ON reclamos (analisis_validado_el) WHERE historico;
