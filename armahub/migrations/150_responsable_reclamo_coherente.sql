-- EL RESPONSABLE DE UN RECLAMO: UN SOLO DATO EN DOS COLUMNAS (14-oct)
--
-- El usuario: «el reclamo 046 lo reasignamos a gerardo pero se lo filtra a José Rodríguez.
-- Pareciera que todos los reasignados tienen ese problema».
--
-- QUÉ PASÓ. El responsable vive en dos columnas: `cubicador_asignado` —el correo, con el
-- que se FILTRA y con el que se decide quién puede editar— y `responsable` —el nombre,
-- que es lo que se VE—. Nada obligaba a que dijeran lo mismo. El 6-oct un script de carga
-- escribió el correo de Jose Rodriguez en el 046 y el 066; después se reasignaron a
-- Gerardo Mendoza por pantalla, eso cambió el nombre, y el correo se quedó donde estaba.
-- Resultado: el reclamo dice «Gerardo Mendoza» y el filtro lo entrega como de Jose.
--
-- El agujero se cerró en el PATCH (tocar una columna obliga a resolver la otra). Acá se
-- arreglan los dos reclamos que quedaron partidos.
--
-- SON DOS, medidos: de 19 reclamos vivos con las dos columnas distintas, 17 difieren sólo
-- por la FORMA —«hans.mondaca@armacero.cl» contra «Hans Mondaca», que es la misma
-- persona— y 2 apuntan a personas distintas. Por eso la condición no es «que sean
-- distintas»: es que el nombre no corresponda a la persona del correo.
UPDATE reclamos r
   SET cubicador_asignado = u.email
  FROM users u
 WHERE NOT r.historico
   AND LOWER(TRIM(CONCAT_WS(' ', u.nombre, u.apellido))) = LOWER(TRIM(r.responsable))
   AND COALESCE(u.activo, TRUE)
   AND NULLIF(TRIM(COALESCE(r.responsable, '')), '') IS NOT NULL
   AND NULLIF(TRIM(COALESCE(r.cubicador_asignado, '')), '') IS NOT NULL
   AND LOWER(TRIM(r.cubicador_asignado)) <> LOWER(u.email)
   -- Y SÓLO SI EL CORREO QUE HAY APUNTA A OTRA PERSONA. Si el correo es de quien dice el
   -- nombre y sólo cambia la forma de escribirlo, no hay nada que arreglar.
   AND NOT EXISTS (
         SELECT 1 FROM users u2
          WHERE LOWER(u2.email) = LOWER(TRIM(r.cubicador_asignado))
            AND LOWER(TRIM(CONCAT_WS(' ', u2.nombre, u2.apellido))) = LOWER(TRIM(r.responsable)));
