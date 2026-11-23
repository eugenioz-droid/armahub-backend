-- 175: registro del chat del cubicador de ArmaScanner (22-nov-2026, programa 6.19 etapa 1)
--
-- Una fila por mensaje del cubicador: lo que pidió, lo que respondió la IA y la propuesta que armó
-- (la acción y su criterio, nunca las barras: las elige ArmaScanner), con el modelo y los tokens.
-- ArmaScanner informa después qué pasó con la propuesta: «aplicado», «cancelado», «cambio» (no se
-- aplicó porque las barras cambiaron desde que se mostró) o «error», con cuántas barras y kilos; el
-- último va en `resultado` y todos, en orden, en `eventos`. Para mejora continua e informes. El
-- tope diario de mensajes por usuario se cuenta acá (usuario, creado_el).
--   error: el error de la API, o por qué la propuesta llegó incompleta.
CREATE TABLE IF NOT EXISTS armascanner_chat (
    id                SERIAL PRIMARY KEY,
    usuario           TEXT NOT NULL,
    obra              TEXT,
    plano             TEXT,
    modelo            TEXT,
    mensaje           TEXT,
    respuesta         TEXT,
    propuesta         JSONB,
    accion            TEXT,
    resultado         TEXT,
    resultado_detalle TEXT,
    barras            INTEGER,
    kg                DOUBLE PRECISION,
    eventos           JSONB,
    tokens_entrada    INTEGER,
    tokens_salida     INTEGER,
    error             TEXT,
    version_app       TEXT,
    creado_el         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resultado_el      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS armascanner_chat_usuario_dia ON armascanner_chat (usuario, creado_el);
