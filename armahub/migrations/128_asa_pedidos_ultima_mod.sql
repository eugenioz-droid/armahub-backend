-- La última vez que aSa tocó el pedido (LastModified), para saber cuándo se dejó de cubicar un código
-- aSa NO tiene una fecha de «cubicación terminada»: no está en getOrderSummary, ni en
-- getOrderItemView, ni en getScheduling. Lo más cercano es `LastModified`, la última vez
-- que se tocó el PEDIDO (la programación de planta tiene la suya aparte,
-- `SchedLastModified`, así que agendar no mueve ésta). Medido sobre 1.138 códigos de
-- ago-oct 2026: en los que siguen abiertos el 47% no se tocó después del día del pedido y
-- la mediana es 1 día —ahí es el cubicador—, pero en los despachados la mediana sube a 10
-- días, o sea que fabricar y despachar sí la mueven. Por eso la pantalla muestra las dos
-- fechas: la del pedido (estable) y ésta, con el aviso de qué significa cada una.
ALTER TABLE asa_pedidos ADD COLUMN IF NOT EXISTS ultima_mod TIMESTAMPTZ;
