-- Las figuras que usa aSa, sacadas de las barras reales: aSa no expone un catálogo de formas
-- aSa no tiene endpoint de figuras (se probaron getShapes, getShapeLibrary, getBarShapes,
-- getPatterns y cuatro más: todos 401, o sea ni existen para esta credencial). Lo único
-- que hay son las barras de `getOrderItemView`, así que el catálogo se DERIVA de ellas:
-- por cada `ShpNameID` distinto se guarda una barra de ejemplo con lo que hace falta para
-- dibujarla. Lo llena scripts/escanear_figuras_asa.py y lo lee el tab «Catálogo aSa».
CREATE TABLE IF NOT EXISTS asa_figuras (
    codigo        TEXT PRIMARY KEY,       -- el ShpNameID de aSa
    barras        INTEGER NOT NULL DEFAULT 0,   -- cuántas barras se vieron con esta figura
    ejemplo_cc    TEXT,                   -- el código de control de la barra de ejemplo
    ejemplo_marca TEXT,                   -- su BarMark
    ejemplo_obra  TEXT,
    diam_mm       NUMERIC,                -- el φ de la barra de ejemplo, en mm
    pin_diam      NUMERIC,                -- el mandril: con el φ da el radio del codo
    largo_mm      NUMERIC,
    legangle      TEXT,                   -- el XML con los lados: de acá sale la figura
    shapedims     TEXT,                   -- el JSON con los vectores
    visto_el      TIMESTAMPTZ NOT NULL DEFAULT now()
);
