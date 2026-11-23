-- 177: las obras de ArmaScanner (23-nov-2026)
--
-- La obra se agrega primero en ArmaHub › Mis obras (cualquier cubicador, desde la lista de aSa) y
-- recién ahí ArmaScanner la muestra: ArmaScanner sólo ofrece las obras de esta tabla. Las ven todos
-- los cubicadores. El administrador la limpia (sus planos) o la elimina (sale de aquí).
-- [Usuario 23-nov: «debemos agregar la obra en ArmaHub primero… al agregar que ArmaScanner reconozca
-- la obra automáticamente. Recién ahí el usuario puede ir agregando planos en la aplicación de escritorio»]
-- (176 queda para la rama `protocolo`.)
CREATE TABLE IF NOT EXISTS armascanner_obras (
    id_proyecto   TEXT PRIMARY KEY,
    agregada_por  TEXT,
    agregada_el   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Las que ya estaban en ArmaScanner (Peñuelas, Lilenes, Zañartu, Santolaya) y toda obra con planos.
INSERT INTO armascanner_obras (id_proyecto, agregada_por)
SELECT id_proyecto, 'migración 177' FROM proyectos
 WHERE id_proyecto IN ('2013204', '2013160', 'PROY-BA0B51EB', 'PROY-2461137.6285')
    OR id_proyecto IN (SELECT id_proyecto FROM planos_obra)
ON CONFLICT (id_proyecto) DO NOTHING;
