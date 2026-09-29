-- 114 — LA PROGRAMACIÓN DE PLANTA DE aSa, sobre los pedidos ya espejados (29-sep).
--
-- POR QUÉ. Hasta ahora «tiene fecha de despacho» se leía de `PromisedDeliveryDate`, que es
-- un campo DEL PEDIDO y no siempre se llena. Resultado: 13 códigos de 2026 aparecían como
-- «stock por programar» estando en producción o despachados. Lo detectó el usuario con una
-- frase que es una regla de negocio: «nada que pase a producción puede no tener fecha de
-- scheduling».
--
-- Y tenía razón. De esos 13, los 9 despachados tienen GUÍA (`ShipID`) y 8 tienen fecha de
-- planta (`ProjShipDate`); lo que faltaba era el campo del pedido, no el hecho.
--
-- QUÉ SE AGREGA. Las columnas de `getScheduling`, que es la programación real de la
-- planta, sobre la misma fila del código de control. No es una tabla nueva porque
-- getScheduling también viene a grano de CC: 4.933 de los 5.191 de 2026. Evita un join en
-- cada consulta del reporte.
--
-- LA FECHA QUE MANDA pasa a ser COALESCE(proj_ship_date, promised_date): primero lo que
-- dice la planta, y sólo si no hay, lo que dice el pedido.
--
-- BONUS. `ship_id` es la guía de despacho: si existe, el pedido salió de verdad, haya o no
-- fecha. Y tener juntas la fecha programada y la real es lo que por fin permite medir
-- cumplimiento, que es lo que el usuario buscaba desde el principio.

DO $$ BEGIN ALTER TABLE asa_pedidos ADD COLUMN proj_ship_date DATE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE asa_pedidos ADD COLUMN proj_fab_date DATE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Guía de despacho (REM-xxxxxx). Su sola existencia dice que el pedido salió.
DO $$ BEGIN ALTER TABLE asa_pedidos ADD COLUMN ship_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Estado en la programación de planta: sólo dos valores, Scheduled y Confirmed.
DO $$ BEGIN ALTER TABLE asa_pedidos ADD COLUMN sched_estado TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Cuándo se leyó la programación de planta de esta fila. Se guarda aparte de `visto_el`
-- porque las dos fuentes se sincronizan por separado y con distinta frecuencia: saber que
-- una fila tiene pedido fresco pero planta vieja es la diferencia entre confiar en el
-- dato y no saber si se puede.
DO $$ BEGIN ALTER TABLE asa_pedidos ADD COLUMN planta_vista_el TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- El reporte separa las dos cajas por esta fecha, así que se indexa por ella.
CREATE INDEX IF NOT EXISTS idx_asa_pedidos_ship ON asa_pedidos (proj_ship_date);
