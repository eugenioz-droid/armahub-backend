-- 112 — ESPEJO DE OBRAS DE aSa + ASIGNACIÓN DE USC (28-sep).
--
-- POR QUÉ UN ESPEJO Y NO CONSULTAR aSa EN VIVO.
-- El usuario reporta que traer un OrderSummary completo desde Power BI a veces "se queda
-- pegado" y hay que repetir hasta que salga. O sea: aSa aguanta consultas chicas y se atora
-- con las grandes. Si el buscador de obras consultara aSa en cada tecleo, la pantalla
-- heredaría esa fragilidad. Con el espejo, aSa se toca UNA vez al día en horario muerto y
-- el buscador lee de Postgres: instantáneo, y sigue funcionando aunque aSa esté caído.
--
-- POR QUÉ DOS CAPAS Y NO VOLCAR TODO A `proyectos`.
-- aSa tiene cientos de obras y `proyectos` alimenta el selector de obras de TODA la
-- plataforma. Volcarlo lo ensuciaría para todos los módulos. Entonces:
--   asa_obras  = el espejo crudo. Todo lo que aSa tiene. Sólo lo ve el buscador.
--   proyectos  = sólo las obras que el usuario ADOPTA desde el buscador, con su asa_job_id.
-- Es exactamente lo que pidió: "un listado vacío que podamos poblar con un buscador".
--
-- EL CAMPO DE ENLACE. `proyectos.asa_job_id` es la "Key" que el usuario pidió para que las
-- importaciones a aSa guarden el dato. Homologar más adelante una obra que ya existía en
-- ArmaHub es escribirle su asa_job_id: una línea, sin migrar nada.
--
-- LA ASIGNACIÓN DE USC no necesita tabla nueva: `proyecto_usuarios` ya acepta rol='usc'
-- (migración 31). Acá sólo se agrega el índice para que la consulta por USC no barra.

-- ── El espejo ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asa_obras (
    asa_job_id       TEXT PRIMARY KEY,          -- JobID en aSa
    job_key          INTEGER,                   -- JobKey (id numérico)
    nombre           TEXT NOT NULL DEFAULT '',  -- JobName
    cliente          TEXT,                      -- CustomerName (empresa, NO una persona)
    descripcion      TEXT,
    estado           TEXT,
    -- Contexto para elegir bien en el buscador: sin esto, dos obras de nombre parecido son
    -- indistinguibles y el usuario adopta la equivocada.
    pedidos          INTEGER NOT NULL DEFAULT 0,
    kg_total         NUMERIC(14,2),
    ultima_actividad TIMESTAMPTZ,
    -- Trazabilidad de la sincronización: cuándo lo vimos por última vez y con qué traída.
    visto_el         TIMESTAMPTZ NOT NULL DEFAULT now(),
    sync_id          BIGINT
);

-- El buscador filtra por nombre, id o cliente. Sin índice, con cientos de filas da igual;
-- con miles, no. Se pone ahora que es gratis.
CREATE INDEX IF NOT EXISTS idx_asa_obras_nombre ON asa_obras (lower(nombre));
CREATE INDEX IF NOT EXISTS idx_asa_obras_cliente ON asa_obras (lower(coalesce(cliente,'')));

-- Bitácora de sincronizaciones. Sirve para dos cosas concretas: saber desde cuándo pedir la
-- próxima vez (sync incremental por LastModified) y poder responder "¿por qué no aparece
-- esta obra?" mirando si la última corrida falló.
CREATE TABLE IF NOT EXISTS asa_sync (
    id           BIGSERIAL PRIMARY KEY,
    endpoint     TEXT NOT NULL,
    inicio       TIMESTAMPTZ NOT NULL DEFAULT now(),
    fin          TIMESTAMPTZ,
    filas        INTEGER NOT NULL DEFAULT 0,
    nuevas       INTEGER NOT NULL DEFAULT 0,
    ok           BOOLEAN NOT NULL DEFAULT FALSE,
    detalle      TEXT,
    lanzado_por  TEXT
);

-- ── El enlace con las obras de ArmaHub ────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE proyectos ADD COLUMN asa_job_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE proyectos ADD COLUMN origen TEXT NOT NULL DEFAULT 'armahub';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Una obra de aSa no puede quedar enlazada a dos obras de ArmaHub: sería duplicar el
-- programa de la misma obra sin que nadie se dé cuenta. El índice es parcial porque la
-- inmensa mayoría de las obras no tiene asa_job_id y NULL no debe chocar con NULL.
CREATE UNIQUE INDEX IF NOT EXISTS ux_proyectos_asa_job
    ON proyectos (asa_job_id) WHERE asa_job_id IS NOT NULL;

-- ── Asignación de USC ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_proyecto_usuarios_rol
    ON proyecto_usuarios (rol, id_proyecto);
