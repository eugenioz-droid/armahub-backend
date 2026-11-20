-- Planos en línea de ArmaScanner: una copia vigente por plano y quién lo tiene tomado (20-nov,
-- programa §8.13 paso 6, SPECS §5.4).
--
-- Al subir un plano, ArmaScanner manda también su paquete (la copia de trabajo, su lectura y su
-- estado: ciclos, revisión, elemento). Queda en R2 (archivo) como la versión en línea del plano;
-- la anterior se borra (una sola copia). Otro usuario lo toma: lo baja y queda a su nombre
-- (tomado_por); mientras tanto nadie más sube encima, porque dos versiones de un DWG no se
-- juntan. Al subir, el plano queda libre con la versión siguiente. Lo suelta quien lo tomó o un
-- administrador.
CREATE TABLE IF NOT EXISTS planos_obra (
    id            SERIAL PRIMARY KEY,
    id_proyecto   TEXT NOT NULL,
    plano         TEXT NOT NULL,            -- el nombre del plano en ArmaScanner (archivo sin .dwg; «~k» = otra planta del mismo DWG)
    numero        TEXT,
    titulo        TEXT,
    revision      TEXT,
    elemento      TEXT,
    version       INTEGER NOT NULL DEFAULT 0,
    archivo       TEXT,                     -- key del paquete en R2
    tamano        BIGINT,
    barras        INTEGER,
    aprobadas     INTEGER,
    kg            NUMERIC,
    subido_por    TEXT,
    subido_el     TIMESTAMPTZ,
    tomado_por    TEXT,
    tomado_el     TIMESTAMPTZ,
    UNIQUE (id_proyecto, plano)
);
