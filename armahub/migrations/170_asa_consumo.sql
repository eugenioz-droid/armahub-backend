-- Consumo de aSa: kilos y piezas por código de control, diámetro y producto (20-nov).
--
-- El sub-tab «Consumo» de aSa Data compara lo que cada obra consume en cortado y doblado
-- (C&D) contra las barras en punta (barra recta en largo comercial, 6 a 12 m). El espejo
-- `asa_pedidos` sólo guarda los kilos del código entero; esto guarda el desglose que trae
-- getOrderSummary: una fila por código × diámetro × producto.
--
-- LA CLASE SALE DEL PRODUCTO, NO DEL NOMBRE DE LA OBRA. aSa vende la barra en punta con su
-- propio producto («B HORMIGON 12MM 12M A630-420H») y el cortado y doblado con otro
-- («FIERRO A630-420H CYD 12MM»). Así se cuentan también las barras que se piden en una obra
-- sin su gemela «- BARRAS» (Sodimac, subpaquetes) y el C&D que va dentro de una obra de
-- barras. Lo que no es ninguno de los dos (mallas, elementos armados) queda como 'otro'.
CREATE TABLE IF NOT EXISTS asa_consumo (
    control_code  TEXT NOT NULL,
    diametro_mm   INTEGER NOT NULL DEFAULT 0,   -- «12mm» → 12; 0 si aSa no lo trae
    producto      TEXT NOT NULL DEFAULT '',     -- ProductDescr tal cual
    clase         TEXT NOT NULL,                -- 'cyd' | 'barra' | 'otro'
    largo_m       NUMERIC(5,2),                 -- sólo barra: el largo comercial (12, 6, 8…)
    kg            NUMERIC(14,2) NOT NULL DEFAULT 0,
    piezas        NUMERIC(14,0) NOT NULL DEFAULT 0,
    visto_el      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (control_code, diametro_mm, producto)
);
CREATE INDEX IF NOT EXISTS idx_asa_consumo_cc ON asa_consumo (control_code);
