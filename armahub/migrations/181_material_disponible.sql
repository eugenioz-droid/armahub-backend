-- Material disponible (25-nov): las barras que se pueden reutilizar (SPECS §15, fase 1).
--
-- Una fila por barra ingresada: desde un ítem de aSa (una devolución, una barra mal
-- fabricada o un sobrante) o medida a mano en inventario. La barra se guarda entera —sus
-- lados en orden, con su tipo y su giro— porque es lo que la búsqueda va a comparar contra
-- los ítems por fabricar (fase 2), y el dibujo se guarda al ingresar: la lista no vuelve a
-- preguntarle nada a aSa.
CREATE TABLE IF NOT EXISTS material_barras (
    id               SERIAL PRIMARY KEY,
    origen           TEXT NOT NULL,                 -- 'asa' | 'mano'
    motivo           TEXT NOT NULL,                 -- 'devolucion' | 'mal_fabricada' | 'sobrante' | 'inventario'
    -- De dónde salió (sólo las que vienen de aSa)
    cc               TEXT,
    item_key         BIGINT,                        -- OrderItemKey: la única clave del ítem que no se repite
    obra             TEXT,
    cliente          TEXT,
    descr_cc         TEXT,                          -- la descripción del código (ELEV P1 C1)
    elemento         TEXT,                          -- ElementDesc (Eje X (1-2))
    marca            TEXT,
    notas            TEXT,                          -- Notes de aSa (MH, MV, TR…)
    -- La barra
    figura           TEXT,                          -- código de figura de aSa; NULL = recta
    diam_mm          NUMERIC(5,1) NOT NULL,
    grado            TEXT NOT NULL DEFAULT 'A630-420H',  -- el código de aSa tal cual (A630-420HS = soldable)
    lados            JSONB NOT NULL,                -- [{nombre, largo (mm), tipo, angulo, arco, radio, gancho}] en orden
    referencias      JSONB NOT NULL DEFAULT '[]',   -- lo que aSa muestra además de los lados: [[letra, mm]]
    eje              JSONB,                         -- el dibujo, calculado al ingresar
    largo_mm         NUMERIC(10,1),
    kg_unit          NUMERIC(10,3),
    cant_inicial     INTEGER NOT NULL,
    cant_disponible  INTEGER NOT NULL,
    ubicacion        TEXT,
    nota             TEXT,
    estado           TEXT NOT NULL DEFAULT 'disponible',   -- 'disponible' | 'agotada' | 'descartada'
    descarte_motivo  TEXT,
    creado_por       TEXT NOT NULL,
    creado_el        TIMESTAMPTZ NOT NULL DEFAULT now(),
    editado_por      TEXT,
    editado_el       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_material_barras_estado ON material_barras (estado, diam_mm);
CREATE INDEX IF NOT EXISTS idx_material_barras_item ON material_barras (item_key);
