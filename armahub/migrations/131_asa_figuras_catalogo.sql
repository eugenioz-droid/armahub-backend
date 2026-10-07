-- El catálogo de figuras de aSa, con el trazo oficial de cada una (export RDX «5G Shape Export»)
-- aSa no expone las figuras por la API —se probaron ocho endpoints y todos dan 401— pero SÍ
-- las exporta: el archivo RDX trae, por figura, las coordenadas con que ELLA dibuja cada
-- lado (`SHAPE_COORDINATES`, tipos `Stt` y `End`). O sea, el dibujo canónico, no una
-- reconstrucción. Con eso el tab «Catálogo aSa» deja de mostrar lo que nosotros creemos
-- que es cada figura y pasa a mostrar lo que aSa dice que es.
--
-- Lo carga scripts/importar_rdx_figuras.py. `puntos` y `lados` van en JSONB porque es
-- geometría: se lee entera o no se lee, y nadie va a consultarla por partes.
CREATE TABLE IF NOT EXISTS asa_figuras_catalogo (
    codigo       TEXT PRIMARY KEY,        -- ShapeName: el mismo código que el ShpNameID de las barras
    tipo         TEXT,                    -- ShapeTypeID: B (barra), TP (traba), R (radial), T
    generica     BOOLEAN DEFAULT TRUE,    -- 0 = creada dentro de una obra concreta
    descripcion  TEXT,
    puntos       JSONB NOT NULL,          -- [[x, y], ...] el trazo, en las unidades del dibujo de aSa
    lados        JSONB NOT NULL,          -- [{nombre, tipo, arco, radio}, ...] paralelo a los tramos
    tridimensional BOOLEAN DEFAULT FALSE, -- algún lado sale del plano (Z <> 0)
    fuente       TEXT,
    importado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);
