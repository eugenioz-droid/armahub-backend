-- 5M.8.7: convertir los angulos de las figuras DIBUJADAS en el Disenador a la
-- convencion del sistema (aSa): angulo INTERNO del vertice = 180 - giro.
-- El Disenador guardaba el "giro" (desviacion); aSa pide el interno.
--
-- SOLO se convierten las figuras que tienen geometria (las dibujadas con la
-- convencion vieja). Las figuras semilla del catalogo original (sin geometria)
-- NO se tocan: sus angulos ya estan en su propia convencion y se dejan como estan.
--
-- Idempotente por el sistema de migraciones (corre una sola vez). NO re-ejecutar
-- manualmente: aplicar 180-x dos veces vuelve al valor original.
UPDATE figuras_catalogo
SET angulos = (
    SELECT array_agg(180 - a ORDER BY ord)
    FROM unnest(angulos) WITH ORDINALITY AS t(a, ord)
)
WHERE geometria IS NOT NULL
  AND angulos IS NOT NULL
  AND array_length(angulos, 1) > 0;
