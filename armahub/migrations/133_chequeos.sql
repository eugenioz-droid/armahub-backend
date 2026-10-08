-- REVISIÓN AUTOMÁTICA DE BARRAS (8-oct)
--
-- QUÉ ES Y QUÉ NO ES. Una auditoría es una muestra al azar que revisa una persona, con su
-- nombre, su vocabulario ISO y una acción nominada para quien cubicó. Esto es lo contrario:
-- la máquina mira TODAS las barras de un código y levanta la mano donde algo no calza.
-- Por eso vive aparte y no escribe en `auditoria_elementos`: si una regla pudiera dejar un
-- hallazgo, el indicador de conformidad por cubicador dejaría de medir a las personas y
-- pasaría a medir al robot, y la muestra dejaría de ser aleatoria.
--
-- LA SEÑAL SUGIERE, LA PERSONA DECIDE. Lo que se registra con nombre y fecha no es quién
-- corrió la revisión —eso lo hace la máquina— sino quién dijo «está bien» o «hay que
-- corregirla». Esa es la única firma que vale y es un clic.
--
-- EL CICLO DE UNA SEÑAL:
--   abierta   recién encontrada, nadie la miró
--   aceptada  alguien dijo que está bien. No vuelve a aparecer, ni ese mismo patrón en
--             esa obra: si no, aceptar el estribo cuadrado de un pilar de 20x20 habría
--             que repetirlo en cada código y a la semana nadie usa esto.
--   corregir  alguien dijo que hay que arreglarla. Queda esperando.
--   corregida la máquina volvió a revisar ese código y la señal YA NO ESTÁ. Nadie la marca
--             a mano: el sistema comprueba solo que la corrección se hizo.

CREATE TABLE IF NOT EXISTS chequeo_senales (
    id            BIGSERIAL PRIMARY KEY,
    regla         TEXT NOT NULL,
    origen        TEXT NOT NULL DEFAULT 'asa',   -- de dónde salió la barra
    id_proyecto   TEXT NOT NULL,                 -- el job de aSa
    obra          TEXT,                          -- foto del nombre, para no depender del espejo
    cc            TEXT,                          -- código de control
    elemento      TEXT,                          -- ElementID dentro del código
    ref           TEXT NOT NULL,                 -- la MISMA referencia que usa la auditoría
    marca         TEXT,
    figura        TEXT,
    diam_mm       NUMERIC,
    detalle       JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- LAS DOS FIRMAS. `firma` es esta barra de este código: con ella una segunda revisión
    -- no duplica nada. `firma_patron` es la forma del problema sin la barra ni el código
    -- («estribo T1 de 8 mm, 160 x 160»): con ella, aceptar una apaga todas las iguales de
    -- esa obra, que es lo que hace que el módulo se siga usando a la semana.
    firma         TEXT NOT NULL,
    firma_patron  TEXT NOT NULL,
    veces         INTEGER NOT NULL DEFAULT 1,
    visto_primero TIMESTAMPTZ NOT NULL DEFAULT now(),
    visto_ultimo  TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado        TEXT NOT NULL DEFAULT 'abierta',
    resuelto_por  TEXT,
    resuelto_el   TIMESTAMPTZ,
    nota          TEXT,
    CONSTRAINT ck_chequeo_estado CHECK (estado IN ('abierta','aceptada','corregir','corregida'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_chequeo_firma ON chequeo_senales (firma);
CREATE INDEX IF NOT EXISTS ix_chequeo_obra ON chequeo_senales (id_proyecto, estado);
CREATE INDEX IF NOT EXISTS ix_chequeo_patron ON chequeo_senales (id_proyecto, regla, firma_patron);
CREATE INDEX IF NOT EXISTS ix_chequeo_cc ON chequeo_senales (cc, regla);

-- EL REGISTRO DE CADA REVISIÓN. Se escribe solo, sin que nadie llene nada: quién la lanzó,
-- cuándo, sobre qué obra, cuántos códigos y barras miró y qué encontró. Es lo que permite
-- decir «esta obra se revisó el martes» sin preguntarle a nadie.
CREATE TABLE IF NOT EXISTS chequeo_revisiones (
    id             BIGSERIAL PRIMARY KEY,
    id_proyecto    TEXT NOT NULL,
    obra           TEXT,
    lanzada_por    TEXT NOT NULL,
    arrancada      TIMESTAMPTZ NOT NULL DEFAULT now(),
    terminada      TIMESTAMPTZ,
    ccs            INTEGER NOT NULL DEFAULT 0,
    ccs_error      INTEGER NOT NULL DEFAULT 0,
    barras         INTEGER NOT NULL DEFAULT 0,
    senales_nuevas INTEGER NOT NULL DEFAULT 0,
    senales_vistas INTEGER NOT NULL DEFAULT 0,
    corregidas     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_chequeo_rev_obra ON chequeo_revisiones (id_proyecto, arrancada DESC);
