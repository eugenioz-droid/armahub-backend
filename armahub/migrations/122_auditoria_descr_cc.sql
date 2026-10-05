-- 122 — EL CÓDIGO DE CONTROL ES UNA COLUMNA, NO PARTE DEL NOMBRE (2-oct).
--
-- QUÉ PASABA. El nombre del elemento de aSa se armaba pegando tres cosas con puntos:
-- «SUP4 · INF · FUN C17». Leído en la tabla queda enredado, y encima repite: el «INF» ya
-- está en la columna Eje. El usuario lo dijo así: «es mejor poner encabezado para el CC,
-- para Descr del CC y separarlo del nombre del elemento porque queda enredado y confuso».
--
-- QUÉ QUEDA. El código de control en su columna (ya existía, `cc`), la descripción del
-- código en una nueva (`descr_cc`) y el nombre del elemento con lo que es suyo: la
-- descripción que aSa le da al elemento. Así cada columna dice UNA cosa.

DO $$ BEGIN ALTER TABLE auditoria_elementos ADD COLUMN descr_cc TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- La descripción del código, para las auditorías que ya existen: sale del espejo de aSa.
UPDATE auditoria_elementos e
   SET descr_cc = (SELECT NULLIF(p.descr, '') FROM asa_pedidos p
                    WHERE p.control_code = e.cc AND p.asa_job_id = a.id_proyecto LIMIT 1)
  FROM auditorias a
 WHERE a.id = e.auditoria_id AND a.origen = 'asa'
   AND e.cc IS NOT NULL AND e.descr_cc IS NULL;

-- Y el nombre se queda con lo que es del elemento. `estructura` es el ElementDesc de aSa;
-- si viene vacío queda el ElementID, que es lo único que hay. El nombre viejo nunca se
-- pierde del todo: sus tres partes siguen estando en `cc`, `eje` y `estructura`.
UPDATE auditoria_elementos e
   SET nombre = COALESCE(NULLIF(btrim(e.estructura), ''), NULLIF(btrim(e.eje), ''), e.nombre)
  FROM auditorias a
 WHERE a.id = e.auditoria_id AND a.origen = 'asa';
