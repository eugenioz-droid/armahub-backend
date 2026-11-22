-- 176: Protocolo de cubicación: plantilla de la empresa y protocolo por obra (21-nov-2026, programa §8.13 filas 8.1 y 8.2)
-- protocolo_plantillas: cada fila es una versión de la plantilla de la empresa. `contenido` es el
--   documento entero: {nombre, secciones: [{titulo, criterios: [{clave, texto, tipo, unidad, ayuda,
--   croquis, opciones: [{id, texto, croquis}], columnas: [{id, titulo, unidad}], filas: []}]}]}.
--   tipo: opcion | opciones | si_no | numero | texto | tabla. croquis: clave del archivo en R2.
--   estado: 'borrador' (el administrador la edita) | 'vigente' (con la que nacen los protocolos)
--           | 'anterior' (lo fue: la conservan los protocolos que nacieron de ella).
--   revision: cuenta los guardados del borrador, para no pisar el cambio de otro administrador.
CREATE TABLE IF NOT EXISTS protocolo_plantillas (
    id            SERIAL PRIMARY KEY,
    version       INTEGER NOT NULL,
    estado        TEXT NOT NULL DEFAULT 'borrador',
    contenido     JSONB NOT NULL,
    revision      INTEGER NOT NULL DEFAULT 1,
    creada_por    TEXT,
    creada_el     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    guardada_por  TEXT,
    guardada_el   TIMESTAMPTZ,
    publicada_por TEXT,
    publicada_el  TIMESTAMPTZ
);
-- A lo más una plantilla vigente y un borrador a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_protocolo_plantilla_vigente ON protocolo_plantillas (estado) WHERE estado = 'vigente';
CREATE UNIQUE INDEX IF NOT EXISTS uq_protocolo_plantilla_borrador ON protocolo_plantillas (estado) WHERE estado = 'borrador';

-- protocolos: una fila por versión del protocolo de una obra, atada a la plantilla de la que salió.
--   respuestas: {clave del criterio: {valor, obs}}.
--   estado: 'borrador' | 'revisado' (revisado con el cliente) | 'cerrado' (no se edita: se abre versión nueva).
CREATE TABLE IF NOT EXISTS protocolos (
    id            SERIAL PRIMARY KEY,
    id_proyecto   TEXT NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1,
    estado        TEXT NOT NULL DEFAULT 'borrador',
    plantilla_id  INTEGER NOT NULL REFERENCES protocolo_plantillas(id),
    respuestas    JSONB NOT NULL DEFAULT '{}'::jsonb,
    creado_por    TEXT,
    creado_el     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    guardado_por  TEXT,
    guardado_el   TIMESTAMPTZ,
    revisado_por  TEXT,
    revisado_el   TIMESTAMPTZ,
    cerrado_por   TEXT,
    cerrado_el    TIMESTAMPTZ,
    UNIQUE (id_proyecto, version)
);
