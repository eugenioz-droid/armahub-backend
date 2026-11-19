-- Licencias de las herramientas de escritorio (ArmaScanner) por usuario (18-nov)
--
-- El usuario, 18-nov: «en el portal debo poder al usuario asignarle una licencia en el menú
-- de gestión de usuarios… al ejecutar ArmaScanner, debe revisar validación de esa licencia
-- con internet. Posterior a eso, define tiempo de vigencia».
--
-- Una fila por usuario y producto. La licencia vale si la fila está activa, no venció y el
-- usuario está activo (desactivar al usuario la corta igual). `vence` NULL = sin vencimiento.
-- Lo último que reportó la herramienta (cuándo, desde qué equipo, qué versión) queda para
-- saber quién la usa de verdad.
CREATE TABLE IF NOT EXISTS licencias (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    producto      TEXT NOT NULL DEFAULT 'armascanner',
    activa        BOOLEAN NOT NULL DEFAULT TRUE,
    vence         DATE,
    asignada_por  TEXT,
    asignada_el   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_uso    TIMESTAMPTZ,
    ultimo_equipo TEXT,
    version       TEXT,
    UNIQUE (user_id, producto)
);

-- Los administradores parten con licencia de ArmaScanner: hoy es el usuario quien la usa y
-- prueba, y sin esto la primera versión con validación lo dejaría fuera hasta asignársela.
INSERT INTO licencias (user_id, producto, activa, asignada_por)
SELECT id, 'armascanner', TRUE, 'migración 165'
  FROM users WHERE role = 'admin' AND COALESCE(activo, TRUE)
ON CONFLICT (user_id, producto) DO NOTHING;
