-- LA CORRECCIÓN ES POR ITEM, IGUAL QUE EL HALLAZGO (8-oct)
--
-- Lo dijo el usuario: «El hallazgo es por ITEM siempre. La corrección también es por ITEM».
-- Hasta acá la acción vivía en `auditoria_elementos`: un elemento son cuatro, trece o
-- ciento cincuenta barras, y si dos salían mal y se arreglaba una, no había forma de
-- decirlo. Ahora cada barra lleva su propia corrección.
--
-- QUIÉN CIERRA QUÉ. También cambia, y es el corazón de esto:
--   · el AUDITOR declara el hallazgo y lo que debería decir. Ahí termina su trabajo.
--   · el AUDITADO declara que lo corrigió, y puede dejar un comentario cuando lo que hizo
--     no es exactamente lo observado («se cambió el largo pero la cantidad estaba bien»).
--   · NADIE verifica a mano. Antes verificaba el auditor, y el usuario lo sacó: la
--     corrección es responsabilidad del auditado. Lo que comprueba que se hizo es el
--     SISTEMA, volviendo a pedirle la barra a aSa y mirando si el valor cambió.
--
-- EL VALOR ESPERADO es lo que hace posible esa comprobación. Un texto libre —«la cantidad
-- debe ser 103»— no se puede comparar con nada; `{"cant": 103}` sí. El auditor lo escribe
-- en el mismo formulario, corrigiendo el dato sobre la grilla, y eso solo marca la barra
-- como hallazgo: no hay que acordarse de apretar nada aparte.
ALTER TABLE auditoria_items
    -- Lo que el auditor dice que DEBERÍA decir la barra: {"A": 120, "cant": 103, ...}.
    -- Las llaves son las mismas columnas de la grilla (letras de lado, `cant`, `largo`).
    ADD COLUMN IF NOT EXISTS esperado        JSONB,
    -- La corrección, declarada por el auditado.
    ADD COLUMN IF NOT EXISTS corregido       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS corregido_por   TEXT,
    ADD COLUMN IF NOT EXISTS corregido_el    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS nota_correccion TEXT,
    -- CÓMO se corrigió. El usuario: «los únicos que no serán automáticos es cuando
    -- aparece un nuevo item y/o CC». Si se corrigió el mismo ítem, el sistema puede ir a
    -- mirarlo; si se hizo uno nuevo, la barra vieja va a seguir igual para siempre y
    -- comprobarla diría que no se corrigió. Por eso se declara cuál de las dos fue.
    ADD COLUMN IF NOT EXISTS tipo_correccion TEXT,   -- 'item' | 'nuevo'
    ADD COLUMN IF NOT EXISTS cc_nuevo        TEXT,   -- el código nuevo, si lo hubo
    -- LO QUE COMPRUEBA EL SISTEMA, aparte de lo que declaró la persona. Son dos cosas
    -- distintas y se guardan distinto: una es un dicho y la otra una medición.
    ADD COLUMN IF NOT EXISTS verificado      TEXT,   -- 'ok' | 'sigue_igual' | 'no_aplica'
    ADD COLUMN IF NOT EXISTS verificado_el   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verificado_dato JSONB;  -- lo que decía aSa al comprobar

-- Las restricciones, aparte y en dos pasos: `ADD CONSTRAINT` no tiene `IF NOT EXISTS`, y
-- la migración se vuelve a correr en cada arranque. Sin el DROP previo falla siempre
-- desde la segunda vez, y aunque el arranque la omite sin caerse, deja un error en el log
-- que después nadie sabe si importa.
ALTER TABLE auditoria_items DROP CONSTRAINT IF EXISTS ck_aud_item_tipo;
ALTER TABLE auditoria_items DROP CONSTRAINT IF EXISTS ck_aud_item_verif;
ALTER TABLE auditoria_items
    ADD CONSTRAINT ck_aud_item_tipo
        CHECK (tipo_correccion IS NULL OR tipo_correccion IN ('item', 'nuevo')),
    ADD CONSTRAINT ck_aud_item_verif
        CHECK (verificado IS NULL OR verificado IN ('ok', 'sigue_igual', 'no_aplica'));

CREATE INDEX IF NOT EXISTS ix_aud_items_pend
    ON auditoria_items (elemento_id) WHERE conforme IS FALSE AND corregido IS FALSE;

-- EL PLAZO, REGISTRADO. Por ahora no dispara nada —el correo todavía no está— pero queda
-- la traza: cuándo venció y si la corrección llegó antes o después. Cuando se habilite el
-- mailing, el dato ya va a estar y no habrá que reconstruirlo.
ALTER TABLE auditorias
    ADD COLUMN IF NOT EXISTS enviada_el  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS enviada_por TEXT;
