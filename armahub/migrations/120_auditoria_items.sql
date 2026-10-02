-- 120 — EL HALLAZGO SE REGISTRA POR BARRA, no por elemento entero (2-oct).
--
-- POR QUÉ. Un elemento son 4, 13 o 150 barras. Decir «este eje tiene una no conformidad»
-- y un párrafo suelto no sirve para corregir: el cubicador necesita saber CUÁL barra está
-- mala y qué tiene. El usuario lo pidió así: «el comentario debe agregarse por ITEM, no
-- por elemento completo; un check de conforme o NC y ahí se abre el campo de observación».
--
-- CÓMO QUEDA REPARTIDO.
--   · Por BARRA (esta tabla): conforme sí/no y qué se encontró. Es la evidencia.
--   · Por ELEMENTO (`auditoria_elementos`): la SEVERIDAD —observación, NC menor, NC
--     mayor—, la causa del Ishikawa y la acción para quien cubicó. Eso se decide una vez
--     mirando el conjunto, no barra por barra, y es lo que viaja al informe.
-- El hallazgo del elemento se DERIVA: si todas sus barras están conformes, es conforme.
--
-- LA REFERENCIA DE LA BARRA (`ref`) es la marca —`10mmA110` en aSa, la marca en ArmaHub—
-- y, si esa marca se repite dentro del elemento, se le pega un ordinal (`10mmA110#2`).
-- No se usa un id de aSa porque las barras NO están espejadas: se piden en vivo y su id
-- interno podría cambiar; la marca es lo que el cubicador ve y lo que puede buscar.

CREATE TABLE IF NOT EXISTS auditoria_items (
    id           BIGSERIAL PRIMARY KEY,
    elemento_id  BIGINT NOT NULL REFERENCES auditoria_elementos(id) ON DELETE CASCADE,
    ref          TEXT NOT NULL,           -- la marca, con ordinal si se repite
    marca        TEXT,
    conforme     BOOLEAN,                 -- NULL = no se revisó esta barra
    observacion  TEXT,                    -- qué encontró el auditor (obligatoria si NO conforme)
    revisado_por TEXT,
    revisado_el  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_aud_items_elemento ON auditoria_items (elemento_id);
-- Una barra, un veredicto: volver a guardar la misma reemplaza, no acumula.
CREATE UNIQUE INDEX IF NOT EXISTS ux_aud_items ON auditoria_items (elemento_id, ref);
