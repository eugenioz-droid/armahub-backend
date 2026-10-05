-- 123 — EL NÚMERO DE LA AUDITORÍA NO SE REPITE NUNCA (5-oct).
--
-- QUÉ PASABA. El código (A-2026-001) se sacaba contando las auditorías del año. Eso tiene
-- dos caras y las dos muerden:
--
--   1. Al borrar una quedaba un hueco y la siguiente pedía un número YA USADO: chocaba con
--      el índice único de `codigo` y el usuario veía «Error interno del servidor», que no
--      dice nada. Salió en el smoke, no en producción, de pura suerte.
--   2. Aunque no chocara, reusar el número es peor: al crear una auditoría se MANDA UN
--      CORREO con su código. Si la 002 se borra y otra nace 002, hay dos correos distintos
--      hablando de «la A-2026-002». En un registro de calidad eso no se puede.
--
-- QUÉ QUEDA. Un correlativo por año en su propia tabla. Se incrementa con un solo INSERT
-- ... ON CONFLICT DO UPDATE, que toma el candado de la fila: dos personas creando a la vez
-- se ordenan solas, sin reintentos ni carreras. Y como no mira las auditorías que existen,
-- borrar una no devuelve su número.
--
-- Si la creación falla después de pedir el número, la transacción entera se deshace y el
-- correlativo vuelve atrás: ahí sí corresponde, porque no nació ninguna auditoría ni se
-- mandó ningún correo (el correo sale después de confirmar).

CREATE TABLE IF NOT EXISTS auditoria_correlativo (
    anio   INTEGER PRIMARY KEY,
    ultimo INTEGER NOT NULL DEFAULT 0
);

-- Arranca donde iba la serie que ya está escrita, para no repetir lo ya emitido.
INSERT INTO auditoria_correlativo (anio, ultimo)
SELECT substring(codigo from '^A-([0-9]{4})-')::int AS anio,
       MAX(substring(codigo from '^A-[0-9]{4}-([0-9]+)$')::int)
  FROM auditorias
 WHERE codigo ~ '^A-[0-9]{4}-[0-9]+$'
 GROUP BY 1
ON CONFLICT (anio) DO NOTHING;
