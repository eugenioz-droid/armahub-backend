-- 174: planos de ArmaScanner sin bloqueo: se sube al terminar, una entrega por plano y el reemplazo pedido (22-nov-2026)
--
-- Nadie «toma» un plano. El cubicador lo sube cuando lo terminó: es la entrega del plano (una sola por
-- obra y plano). Otro cubicador que termina el mismo plano no puede subirlo mientras el autor de la
-- entrega no acepte el reemplazo (o la elimine): pide el reemplazo, el autor acepta o rechaza (o un
-- administrador responde por él) y, aceptado, la nueva entrega reemplaza a la anterior al terminar.
--   archivo y pdf: claves en R2, únicas por subida (llevan un uuid): una subida nunca pisa otra.
-- `planos_obra` sigue con una fila por plano: el documento (el antecedente cargado) y el resumen de
-- la entrega, que es lo que leen las listas, los indicadores y el pedido.
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
    subido_el    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id_proyecto, plano)
);

-- Pedidos de reemplazo de una entrega. estado: 'pendiente' · 'aceptado' · 'rechazado' · 'cumplido'
-- (la entrega del solicitante reemplazó a la del autor) · 'anulado' (lo retiró el solicitante, o la
-- entrega del autor ya no está). autor = el dueño de la entrega cuando se pidió.
CREATE TABLE IF NOT EXISTS planos_obra_reemplazos (
    id             SERIAL PRIMARY KEY,
    id_proyecto    TEXT NOT NULL,
    plano          TEXT NOT NULL,
    solicitante    TEXT NOT NULL,
    autor          TEXT NOT NULL,
    estado         TEXT NOT NULL DEFAULT 'pendiente',
    creado_el      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    respondido_por TEXT,
    respondido_el  TIMESTAMPTZ
);
-- un pedido que corre (pendiente o aceptado) por obra, plano y solicitante
CREATE UNIQUE INDEX IF NOT EXISTS planos_obra_reemplazos_abierto
    ON planos_obra_reemplazos (id_proyecto, plano, solicitante) WHERE estado IN ('pendiente', 'aceptado');

-- Lo que la fila del plano era antes de su primera entrega (etapa, quién la cargó y cuándo, su
-- resumen): si la entrega se elimina, vuelve a eso.
ALTER TABLE planos_obra ADD COLUMN IF NOT EXISTS base JSONB;

-- Transición: ya no hay planos tomados, y lo guardado a medias antes del cambio queda «en_trabajo».
-- etapa desde ahora: 'cargado' · 'terminado' · 'en_trabajo' (sólo lo anterior al cambio).
UPDATE planos_obra SET tomado_por = NULL, tomado_el = NULL;
UPDATE planos_obra SET etapa = 'en_trabajo' WHERE etapa IS NULL;
