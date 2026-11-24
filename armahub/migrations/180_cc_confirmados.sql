-- CC confirmados modificados (24-nov): la foto de cada código confirmado en planta y los cambios que se le hicieron después.
--
-- EL PROBLEMA. La planta confirma un código con sus kilos y lo agenda. Si después alguien
-- lo edita en aSa, los kilos programados ya no son los del pedido, y nadie se entera hasta
-- que el camión no cuadra. aSa no guarda los kilos que se confirmaron (la programación
-- muestra siempre los de hoy) ni qué barras cambiaron (al guardar, TODAS las barras del
-- código quedan con la misma hora). Por eso ArmaHub saca su propia foto al ver el código
-- confirmado, y compara contra ella cuando aSa dice que el código se modificó después.

-- UNA FILA POR CÓDIGO CONFIRMADO. La foto vale para la confirmación que se vio
-- (`confirmado_el`); si la planta vuelve a confirmar, se reemplaza.
CREATE TABLE IF NOT EXISTS cc_confirmados (
    control_code   TEXT PRIMARY KEY,
    estado         TEXT,                  -- Open | Processed, al verlo
    confirmado_el  TIMESTAMPTZ NOT NULL,  -- SchedLastModified de aSa
    foto_el        TIMESTAMPTZ,           -- NULL = sin foto (se vio ya modificado, o falta tomarla)
    kg_foto        NUMERIC(14,2),         -- kilos a la hora de la foto
    barras         JSONB,                 -- la foto: [[elemento, marca, φ, figura, largo, cant, kg], ...]
    mod_visto      TIMESTAMPTZ,           -- la última modificación de aSa ya revisada
    visto_el       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UNA FILA POR CONFIRMACIÓN QUE SE MODIFICÓ. Si el código se vuelve a editar después de la
-- misma confirmación, se actualiza la fila (lo comparado es siempre contra la foto) y se
-- reabre si estaba resuelta: un cambio nuevo es una noticia nueva.
CREATE TABLE IF NOT EXISTS cc_modificados (
    id               SERIAL PRIMARY KEY,
    control_code     TEXT NOT NULL,
    confirmado_el    TIMESTAMPTZ NOT NULL,
    modificado_el    TIMESTAMPTZ NOT NULL,  -- LastModifiedTime de aSa
    estado           TEXT,                  -- estado del pedido al detectarlo
    obra             TEXT,
    descr            TEXT,
    cubicador        TEXT,                  -- DetailPerson: el cubicador a cargo (aSa no dice quién editó)
    kg_confirmado    NUMERIC(14,2),         -- NULL = no hubo foto antes del cambio
    kg_actual        NUMERIC(14,2),
    cambios          JSONB,                 -- {agregadas, quitadas, cambiadas}; NULL sin foto
    detectado_el     TIMESTAMPTZ NOT NULL DEFAULT now(),
    reprogramado_el  TIMESTAMPTZ,           -- la planta tocó la programación después del cambio
    resuelto_por     TEXT,
    resuelto_el      TIMESTAMPTZ,
    UNIQUE (control_code, confirmado_el)
);
CREATE INDEX IF NOT EXISTS idx_cc_modificados_mod ON cc_modificados (modificado_el DESC);
