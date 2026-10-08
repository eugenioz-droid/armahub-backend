-- QUÉ CÓDIGO SE REVISÓ Y CUÁNDO (8-oct)
--
-- POR QUÉ HACE FALTA. Hasta acá, lo único que decía que un código se había mirado eran sus
-- señales. Pero un código LIMPIO no deja ninguna, así que no se podía distinguir «lo
-- revisamos y está bien» de «nunca lo miramos» — que es justo lo que uno necesita saber
-- para no revisar dos veces lo mismo y para que la revisión automática sepa por dónde
-- seguir.
--
-- Y ES LO QUE HACE BARATA LA REVISIÓN AUTOMÁTICA. Pedirle a aSa los ítems de un código
-- cuesta segundos y hay más de tres mil códigos vivos: barrerlos todos cada día son horas.
-- Con esta tabla, el reloj mira sólo lo que vale la pena — lo que nunca se revisó, y lo que
-- CAMBIÓ en aSa después de la última revisión (`asa_pedidos.ultima_mod`)—. Después de la
-- primera pasada, un día normal son decenas de códigos.
CREATE TABLE IF NOT EXISTS chequeo_codigos (
    id_proyecto   TEXT NOT NULL,
    cc            TEXT NOT NULL,
    revisado_el   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revisado_por  TEXT,                     -- quién lo pidió, o 'reloj'
    barras        INTEGER NOT NULL DEFAULT 0,
    senales       INTEGER NOT NULL DEFAULT 0,
    -- El `LastModified` del código en aSa en el momento de revisarlo. Si después cambia,
    -- hay algo nuevo que mirar; si no, revisarlo de nuevo es gastar segundos para nada.
    ultima_mod    TIMESTAMPTZ,
    error         TEXT,
    PRIMARY KEY (id_proyecto, cc)
);
CREATE INDEX IF NOT EXISTS ix_chequeo_cod_rev ON chequeo_codigos (revisado_el DESC);

-- La revisión deja dicho CÓMO terminó: entera, o cortada por el tope de tiempo con lo que
-- quedó pendiente. Sin eso, una revisión automática a medias se ve igual que una completa.
ALTER TABLE chequeo_revisiones ADD COLUMN IF NOT EXISTS nota TEXT;
