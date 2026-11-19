-- Equipos de cada licencia de ArmaScanner (19-nov)
--
-- El usuario, 19-nov: «b) ok» a la propuesta de un máximo de 2 equipos por licencia (oficina
-- y casa). Cada equipo que activa o valida la licencia queda anotado; un equipo nuevo entra
-- sólo si la licencia tiene cupo. El administrador libera un equipo en Gestión de usuarios
-- (se borra su fila y el cupo queda libre). El equipo es el que reporta la herramienta
-- («NOMBRE-PC · usuario de Windows»).
ALTER TABLE licencias ADD COLUMN IF NOT EXISTS max_equipos INTEGER NOT NULL DEFAULT 2;

CREATE TABLE IF NOT EXISTS licencia_equipos (
    id          SERIAL PRIMARY KEY,
    licencia_id INTEGER NOT NULL REFERENCES licencias(id) ON DELETE CASCADE,
    equipo      TEXT NOT NULL,
    primer_uso  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_uso  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version     TEXT,
    UNIQUE (licencia_id, equipo)
);

-- El equipo que ya usó cada licencia (el último anotado) parte registrado: no pierde su cupo.
INSERT INTO licencia_equipos (licencia_id, equipo, primer_uso, ultimo_uso, version)
SELECT id, ultimo_equipo, COALESCE(ultimo_uso, NOW()), COALESCE(ultimo_uso, NOW()), version
  FROM licencias WHERE ultimo_equipo IS NOT NULL
ON CONFLICT (licencia_id, equipo) DO NOTHING;
