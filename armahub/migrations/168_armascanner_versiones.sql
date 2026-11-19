-- Versiones de ArmaScanner: el instalador que se descarga desde la caluga y la actualización
-- desde la herramienta (19-nov, programa §8.13 paso 3, SPECS §13).
--
-- Cada versión es un instalador en R2 (archivo). La vigente es la activa más nueva: la que baja
-- «Descargar» en la caluga y la que ofrece «Actualizar» en ArmaScanner. «Retirar» la desactiva
-- (vuelve a mandar la anterior). `obligatoria`: ArmaScanner pide actualizar antes de seguir.
CREATE TABLE IF NOT EXISTS armascanner_versiones (
    id            SERIAL PRIMARY KEY,
    version       TEXT NOT NULL UNIQUE,
    archivo       TEXT NOT NULL,            -- key en R2
    tamano        BIGINT,
    notas         TEXT,
    obligatoria   BOOLEAN NOT NULL DEFAULT FALSE,
    activa        BOOLEAN NOT NULL DEFAULT TRUE,
    publicada_por TEXT,
    publicada_el  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
