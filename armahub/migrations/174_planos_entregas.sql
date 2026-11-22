-- 174: planos de ArmaScanner sin bloqueo: se sube al terminar y cada cubicador tiene su entrega (21-nov-2026)
--
-- Nadie «toma» un plano. El cubicador lo sube cuando lo terminó, y si dos terminan el mismo plano
-- no se reescribe nada: cada uno tiene su entrega (una por obra, plano y autor), el plano queda
-- «por decidir» y un administrador indica cuál vale.
--   vale: NULL = sin decidir; TRUE = la vigente; FALSE = no vale (su autor debe eliminarla).
--   archivo y pdf: claves en R2, únicas por subida (llevan un uuid): una subida nunca pisa otra.
-- `planos_obra` sigue con una fila por plano: el documento (el antecedente cargado) y el resumen de
-- la entrega vigente, que es lo que leen las listas, los indicadores y el pedido.
CREATE TABLE IF NOT EXISTS planos_obra_entregas (
    id           SERIAL PRIMARY KEY,
    id_proyecto  TEXT NOT NULL,
    plano        TEXT NOT NULL,
    autor        TEXT NOT NULL,
    version      INTEGER NOT NULL DEFAULT 1,
    archivo      TEXT NOT NULL,
    tamano       BIGINT,
    numero       TEXT,
    titulo       TEXT,
    revision     TEXT,
    elemento     TEXT,
    resumen      JSONB,
    barras_json  JSONB,
    pdf          TEXT,
    vale         BOOLEAN,
    decidido_por TEXT,
    decidido_el  TIMESTAMPTZ,
    subido_el    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id_proyecto, plano, autor)
);

-- Lo que la fila del plano era antes de su primera entrega (etapa, quién la cargó y cuándo, su
-- resumen): si las entregas se eliminan todas, vuelve a eso.
ALTER TABLE planos_obra ADD COLUMN IF NOT EXISTS base JSONB;

-- Transición: ya no hay planos tomados, y lo guardado a medias antes del cambio queda «en_trabajo».
-- etapa desde ahora: 'cargado' · 'terminado' · 'en_trabajo' (sólo lo anterior al cambio).
UPDATE planos_obra SET tomado_por = NULL, tomado_el = NULL;
UPDATE planos_obra SET etapa = 'en_trabajo' WHERE etapa IS NULL;
