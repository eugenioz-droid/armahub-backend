-- 117 — AUDITORÍAS DE CUBICACIÓN: salen del navegador y pasan a la base (1-oct).
--
-- La maqueta guardaba las auditorías en localStorage. Eso sirvió para acordar el formato,
-- pero una auditoría es un REGISTRO DE CALIDAD: tiene que sobrevivir a que alguien limpie
-- su navegador, y tiene que poder leerla otro. Acá quedan.
--
-- DOS TABLAS. La auditoría (quién, qué alcance, cuándo) y sus elementos (la muestra que
-- salió, con el hallazgo de cada uno). La muestra se GUARDA, no se vuelve a sortear: si se
-- resorteara, el auditor abriría mañana una lista distinta de la que empezó a revisar. La
-- semilla queda igual, para poder explicar de dónde salió.
--
-- LA ACCIÓN VIVE EN EL ELEMENTO, no en una tabla aparte: cada no conformidad genera una y
-- sólo una acción, sobre ese elemento. Una tabla más sería una fila por fila sin ganar nada.
--
-- VOCABULARIO ISO 19011 / 9001: alcance · muestra · hallazgo (conforme · observación · no
-- conformidad menor/mayor) · corrección (la hace quien cubicó) · verificación (la hace el
-- auditor). Los valores viven en `auditorias.py`; acá no se restringen con CHECK a
-- propósito, para que agregar un nivel no exija una migración.

CREATE TABLE IF NOT EXISTS auditorias (
    id              BIGSERIAL PRIMARY KEY,
    codigo          TEXT UNIQUE NOT NULL,        -- A-2026-001, lo que se dice en voz alta
    id_proyecto     TEXT NOT NULL,
    obra            TEXT NOT NULL,               -- foto del nombre: la obra puede renombrarse
    auditor         TEXT NOT NULL,               -- email de quien audita
    origen          TEXT NOT NULL DEFAULT 'armahub',  -- de dónde salió la muestra ('asa' después)
    -- El alcance, tal como se eligió. Vacío = todo.
    sectores        TEXT[] NOT NULL DEFAULT '{}',
    pisos           TEXT[] NOT NULL DEFAULT '{}',
    ciclos          TEXT[] NOT NULL DEFAULT '{}',
    n               INTEGER NOT NULL,            -- elementos pedidos
    total_rango     INTEGER NOT NULL,            -- elementos que había en el alcance
    semilla         TEXT NOT NULL,               -- con esto se reproduce el sorteo
    estado          TEXT NOT NULL DEFAULT 'planificada',
    -- Las fechas NO las escribe nadie a mano: las pone el sistema.
    creada_fecha    DATE NOT NULL DEFAULT CURRENT_DATE,
    plazo_fecha     DATE,                        -- creación + días hábiles
    inicio_fecha    DATE,                        -- primer hallazgo registrado
    cierre_fecha    DATE,                        -- último elemento revisado
    creada_por      TEXT NOT NULL,
    creada_el       TIMESTAMPTZ NOT NULL DEFAULT now(),
    notas           TEXT
);
CREATE INDEX IF NOT EXISTS ix_auditorias_obra ON auditorias (id_proyecto);
CREATE INDEX IF NOT EXISTS ix_auditorias_auditor ON auditorias (auditor);

-- La MUESTRA: un elemento constructivo por fila, con su hallazgo.
CREATE TABLE IF NOT EXISTS auditoria_elementos (
    id              BIGSERIAL PRIMARY KEY,
    auditoria_id    BIGINT NOT NULL REFERENCES auditorias(id) ON DELETE CASCADE,
    -- La clave del elemento en las barras, y su nombre ya armado para mostrar.
    sector          TEXT NOT NULL DEFAULT '',
    piso            TEXT NOT NULL DEFAULT '',
    ciclo           TEXT NOT NULL DEFAULT '',
    eje             TEXT NOT NULL DEFAULT '',
    nombre          TEXT NOT NULL,
    estructura      TEXT,
    -- Foto de lo que tenía el elemento cuando se sorteó: si después cambia, la auditoría
    -- sigue diciendo contra qué se revisó.
    barras          INTEGER NOT NULL DEFAULT 0,
    kg              DOUBLE PRECISION NOT NULL DEFAULT 0,
    cubicado_por    TEXT,
    -- El hallazgo.
    hallazgo        TEXT,                        -- NULL = pendiente de revisar
    texto           TEXT,                        -- qué encontró el auditor
    causa           TEXT,                        -- código del Ishikawa de Cubicaciones
    revisado_por    TEXT,
    revisado_el     TIMESTAMPTZ,
    -- La acción que nace de una no conformidad.
    accion_estado   TEXT,                        -- pendiente | corregida | verificada
    accion_por      TEXT,
    accion_el       TIMESTAMPTZ,
    accion_nota     TEXT
);
CREATE INDEX IF NOT EXISTS ix_aud_elem_auditoria ON auditoria_elementos (auditoria_id);
-- Para «mis acciones»: lo que le toca corregir a cada cubicador.
CREATE INDEX IF NOT EXISTS ix_aud_elem_accion ON auditoria_elementos (cubicado_por, accion_estado);
-- El mismo elemento no puede estar dos veces en la misma auditoría.
CREATE UNIQUE INDEX IF NOT EXISTS ux_aud_elem ON auditoria_elementos
    (auditoria_id, sector, piso, ciclo, eje);
