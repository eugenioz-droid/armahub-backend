-- 118 — AUDITAR OBRAS QUE NO ESTÁN EN ArmaHub, usando aSa (1-oct).
--
-- POR QUÉ. ArmaHub tiene barras de 18 obras; aSa tiene 319 activas. El usuario necesita
-- auditar las dos: «para crear auditorías debo poder traer las obras de aSa o las de
-- ArmaHub».
--
-- QUÉ CAMBIA. Nada de la forma de auditar: sigue siendo un ELEMENTO CONSTRUCTIVO con sus
-- barras, un hallazgo en cuatro niveles y una acción para quien cubicó. Lo único que
-- cambia es DE DÓNDE sale la muestra, y eso ya estaba previsto en `auditorias.origen`
-- ('armahub' | 'asa').
--
-- EL ELEMENTO EN aSa es `CtrlCode` + `ElementID` de getOrderItemView — medido el 1-oct:
-- viene en el 100% de los ítems, y en muros el ElementID ES el eje, con la misma
-- nomenclatura de ArmaHub (`K(12-18)`, `11(F-H)`). Por eso el elemento de aSa se guarda
-- en las MISMAS columnas: `eje` lleva el ElementID y `estructura` el ElementDesc. Lo
-- único que falta es dónde vive: el código de control.
--
-- Y en una auditoría de origen 'asa', `auditorias.id_proyecto` guarda el JobID de aSa y
-- `obra` el JobName: el identificador de la obra EN SU ORIGEN. No hay un id_proyecto de
-- ArmaHub que poner, porque justamente esa obra no está en ArmaHub.

DO $$ BEGIN ALTER TABLE auditoria_elementos ADD COLUMN cc TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- El elemento de aSa se identifica por CC + ElementID, no por sector/piso/ciclo/eje. El
-- índice único de la 117 sigue sirviendo (eje = ElementID), pero dos CC distintos del
-- mismo job pueden traer el mismo ElementID ('01', '02'…), así que entra el CC en la clave.
DROP INDEX IF EXISTS ux_aud_elem;
CREATE UNIQUE INDEX IF NOT EXISTS ux_aud_elem ON auditoria_elementos
    (auditoria_id, COALESCE(cc, ''), sector, piso, ciclo, eje);
