-- EL NOMBRE DE LA OBRA LO PONE aSa (15-oct).
--
-- Decisión del usuario: «Pones el nombre de aSa. El nombre de armaHUB servirá para
-- relacionar». aSa es el sistema donde se fabrica, así que su nombre es el que la gente
-- reconoce y el que tienen que decir los tableros, los informes y los selectores. El
-- nombre que se escribió a mano en ArmaHub no se tira: se guarda en `nombre_armahub`,
-- porque es con el que el equipo enlazó las obras y porque es lo único que distingue dos
-- obras de ArmaHub que cuelgan del mismo job.
--
-- EL CASO QUE LO OBLIGA: en aSa «EURO - EDIFICIO SAN PABLO» es UN job (2012732) y en
-- ArmaHub son tres obras —Basílica, Lourdes y San Pablo—, cada una con sus barras y una
-- con nueve reclamos. No se funden (son tres despiezes distintos), así que las tres llevan
-- el nombre de aSa MÁS su distintivo de ArmaHub. Donde el job tiene una sola obra, el
-- nombre queda limpio.
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS nombre_armahub TEXT;

-- El nombre con el que vivió hasta hoy, antes de pisarlo. Sólo la primera vez.
UPDATE proyectos SET nombre_armahub = nombre_proyecto
 WHERE nombre_armahub IS NULL AND nombre_proyecto IS NOT NULL;

-- El nombre de aSa, y el distintivo detrás sólo cuando varias obras comparten el job.
WITH cuantas AS (
    SELECT asa_job_id, COUNT(*) AS n FROM proyectos
     WHERE asa_job_id IS NOT NULL GROUP BY asa_job_id
)
UPDATE proyectos p
   SET nombre_proyecto = LEFT(ao.nombre || CASE WHEN c.n > 1 AND COALESCE(p.nombre_armahub, '') <> ''
                                                THEN ' · ' || p.nombre_armahub ELSE '' END, 250)
  FROM asa_obras ao, cuantas c
 WHERE ao.asa_job_id = p.asa_job_id AND c.asa_job_id = p.asa_job_id
   AND COALESCE(ao.nombre, '') <> '';
