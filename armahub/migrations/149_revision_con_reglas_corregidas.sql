-- LA REVISIÓN #1 SE REHACE CON LAS REGLAS YA CORREGIDAS (13-oct)
--
-- La corrida del 13-oct dejó 261 hallazgos, y todos quedaron cortos por dos cambios que
-- vinieron DESPUÉS de ella:
--
--   · Los ganchos estaban exentos de la regla del largo mínimo. El usuario lo corrigió
--     —«ningún lado se excluye, el cubicador siempre puede condorearse y digitar algo
--     mal»— y con eso entran unas veinte barras más por cada mil cuatrocientas.
--   · La regla de los lados opuestos no existía: la que había marcaba el estribo cuadrado
--     y se retiró en la 148 por levantar 43 barras correctas. Ningún hallazgo de lados
--     opuestos está en la lista, incluido el real que se encontró midiendo (SUVI 8mmA100,
--     una 106A con 350 contra 360).
--
-- Así que esa lista no es «la revisión con algo que falta»: es una revisión hecha con
-- otras reglas. Se rehace entera, que además deja el registro limpio —una sola corrida,
-- una sola fecha— en vez de una #1 incompleta más una #2 con los parches.
--
-- SE PUEDE PORQUE NADIE TRABAJÓ NADA. Medido antes de escribir esto: las 261 están en
-- 'abierta', ninguna declarada, ninguna con nota. Si alguna lo estuviera, esta migración
-- la deja en pie: la condición está abajo y no es decorativa.
DELETE FROM chequeo_senales
 WHERE estado = 'abierta'
   AND declarada_por IS NULL
   AND NULLIF(TRIM(COALESCE(nota, '')), '') IS NULL;

DELETE FROM chequeo_revisiones r
 WHERE NOT EXISTS (SELECT 1 FROM chequeo_senales s WHERE s.revision_id = r.id);

-- Los códigos ya estaban en la cola desde la 148; se deja dicho igual, porque esta
-- migración tiene que poder correr sola en otro ambiente.
UPDATE chequeo_codigos SET ultima_mod = TIMESTAMPTZ '1900-01-01';

-- La próxima corrida vuelve a ser la #1: el número es lo que el usuario ve en pantalla.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM chequeo_revisiones) THEN
        ALTER SEQUENCE chequeo_revisiones_id_seq RESTART WITH 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM chequeo_senales) THEN
        ALTER SEQUENCE chequeo_senales_id_seq RESTART WITH 1;
    END IF;
END $$;
