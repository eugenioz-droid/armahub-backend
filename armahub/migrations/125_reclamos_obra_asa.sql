-- 125 — CADA RECLAMO SABE DE QUÉ OBRA DE aSa ES (5-oct).
--
-- QUÉ PASABA. Los reclamos de este año salían «sin segmento» aunque su obra SÍ está
-- categorizada. El segmento no vive en el reclamo: vive en la obra, en
-- `asa_obra_atributos`. El camino para llegar existía —reclamo → proyecto → obra de aSa,
-- con `proyectos.asa_job_id` desde la migración 112— pero esa columna nunca se llenó, así
-- que la cadena se cortaba en el primer salto y todos caían en «(sin segmento)».
--
-- Y los 511 históricos ni siquiera tienen proyecto: su obra es texto escrito a mano.
--
-- QUÉ QUEDA. El enlace a la obra de aSa en el propio reclamo. Uno solo para los dos
-- casos, en vez de un camino distinto según de dónde venga el reclamo.
--
-- POR QUÉ EL ENLACE Y NO EL SEGMENTO. Se podría haber copiado el segmento al reclamo y
-- listo. Pero el usuario está justamente corrigiendo esa categorización, y un segmento
-- copiado se queda con el valor viejo sin avisar. El enlace a la obra no cambia cuando
-- se recategoriza; el segmento se lee de la obra en el momento de mirarlo, así que
-- siempre dice lo que la obra dice hoy.

DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN asa_job_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_reclamos_asa_job ON reclamos (asa_job_id);
