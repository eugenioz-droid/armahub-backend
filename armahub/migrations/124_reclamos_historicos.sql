-- 124 — LOS RECLAMOS DE 2022 A 2025 ENTRAN A LA PLATAFORMA (5-oct).
--
-- QUÉ SE QUIERE. Dejar cargado el histórico «como si ya hubiese pasado por el sistema»,
-- para poder mirar errores por año y por mes, separando por cubicador y por segmento. Sin
-- flujos de validación: esto ya ocurrió, no hay nada que aprobar. Lo que falta de verdad
-- es el análisis causa raíz, que el Ishikawa empezó a existir después y hay que hacer
-- arqueología para los años viejos.
--
-- POR QUÉ COLUMNAS NUEVAS Y NO LAS QUE HAY:
--
--   · `obra_texto`. La obra viene escrita a mano («DESCO - EDIFICIO LOS ALERCES») y no
--     existe como proyecto en ArmaHub. `id_proyecto` tiene llave foránea contra
--     `proyectos`, así que meterla ahí sería imposible o falso. Queda el texto tal cual,
--     que es el dato que hay, y más adelante se puede cruzar contra las obras de aSa.
--   · `segmento`. Edificación u Otro. Es uno de los cortes que se piden y no está en la
--     tabla; derivarlo de la obra no se puede para los años viejos.
--   · `servicio`. Interno o Externo. OJO: esto NO es `tipo_origen`. Acá significa si la
--     cubicación la hizo servicio interno o externo, y viene repartido mitad y mitad en
--     todos los años; `tipo_origen` significa otra cosa (reclamo de cliente vs interno) y
--     es externo en el 98% de lo que hay cargado. Confundirlos arruinaría los dos cortes.
--   · `historico`. Para que lo viejo cuente en la estadística pero no aparezca en las
--     bandejas de pendientes ni en los contadores del día.
--   · `clave_import` y `fuente`. La primera hace que volver a correr la carga NO duplique:
--     si una planilla se corrige, se reimporta y las filas se actualizan en su lugar. La
--     segunda dice de qué libro, hoja y fila salió cada reclamo, que es lo único que
--     permite ir a revisar cuando un número no cuadre.

DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN historico BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN clave_import TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN fuente TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN obra_texto TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN segmento TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN servicio TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- La llave de la importación: una fila de planilla entra UNA vez. Parcial, porque los
-- reclamos que nacen en la plataforma no tienen ni necesitan esta llave.
CREATE UNIQUE INDEX IF NOT EXISTS ux_reclamos_clave_import
    ON reclamos (clave_import) WHERE clave_import IS NOT NULL;

-- Para separar rápido lo histórico de lo vivo, que es un filtro de toda pantalla.
CREATE INDEX IF NOT EXISTS ix_reclamos_historico ON reclamos (historico);
