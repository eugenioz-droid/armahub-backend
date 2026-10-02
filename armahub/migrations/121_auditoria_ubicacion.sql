-- 121 — DÓNDE ESTÁ EL ELEMENTO, cuando aSa no lo sabe (2-oct).
--
-- EL PEDIDO: «el tipo, piso, ciclo y eje al final salía del texto del nombre del CC;
-- entonces si se puede obtener bien, sino se puede obtener, que lo llene el usuario».
--
-- QUÉ SE PUEDE OBTENER Y QUÉ NO. En ArmaHub los cuatro salen de la cubicación: son la
-- clave con la que se buscan las barras del elemento, y por eso no se tocan desde la
-- auditoría —cambiarlas la dejaría apuntando a un elemento que no existe; si están mal,
-- se arreglan en la cubicación—. En aSa sólo existe el `ElementID` (que en muros ES el
-- eje): el piso y el ciclo no existen en ningún campo, y sacarlos del texto del código de
-- control sería adivinar. Así que llegan vacíos y los escribe el auditor, que tiene el
-- plano a la vista.
--
-- POR QUÉ UNA COLUMNA NUEVA. El `eje` se usaba para DOS cosas a la vez: identificar el
-- elemento en aSa (con él se le piden las barras) y mostrarlo. Mientras fueran lo mismo no
-- molestaba, pero si el auditor corrige el eje —aSa dice «01» y en el plano es «Eje A»—,
-- con un solo campo se perdería la forma de volver a pedir esas barras. `ref_origen`
-- guarda el identificador EN SU ORIGEN y no se toca nunca; `eje` queda como la etiqueta,
-- que sí se corrige.

DO $$ BEGIN ALTER TABLE auditoria_elementos ADD COLUMN ref_origen TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Las auditorías de aSa que ya existen: su `eje` ES el ElementID, así que de ahí sale la
-- referencia. En las de ArmaHub se deja NULL: allá la clave son las cuatro columnas.
UPDATE auditoria_elementos e
   SET ref_origen = e.eje
  FROM auditorias a
 WHERE a.id = e.auditoria_id AND a.origen = 'asa' AND e.ref_origen IS NULL;

-- Quién escribió la ubicación y cuándo. Una auditoría es un registro de calidad: lo que
-- no salió del sistema tiene que decir de quién salió.
DO $$ BEGIN ALTER TABLE auditoria_elementos ADD COLUMN ubicado_por TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE auditoria_elementos ADD COLUMN ubicado_el TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
