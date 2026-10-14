-- UNA BARRA, UN HALLAZGO (14-oct)
--
-- El usuario, viendo la misma barra dos veces en la lista —una fila por el lado A y otra
-- por el lado E, los dos de 9 cm y los dos bajo el mínimo—: «fíjate que el E también es
-- de 9 y no se pinta rojo… aunque sean 2 cosas para una barra, creo que es mejor dejarlo
-- como un único hallazgo».
--
-- Tenía razón por partida doble. Contar: de 482 señales, 324 eran barras distintas y 157
-- estaban repetidas (`SUCN 12mmA139` aparecía tres veces: lados A, B y G). Y trabajar:
-- quien corrige abre el código UNA vez y arregla la barra entera; dos filas son dos veces
-- el mismo trabajo. Además cada fila sólo sabía pintar SU lado, así que el otro lado
-- igual de malo quedaba sin marcar al lado del primero.
--
-- La regla ya devuelve un hallazgo por barra. Acá se juntan las que quedaron sueltas, SIN
-- perder nada: la que sobrevive se queda con todos los lados y con el texto de todas.
--
-- NADA DE ESTO TOCA LO TRABAJADO: sólo se funden señales abiertas, sin declarar y sin
-- nota. Si alguien ya resolvió una, se queda como está y la otra también.
WITH g AS (
    SELECT revision_id, id_proyecto, cc, ref, regla,
           MIN(id) AS se_queda,
           COUNT(*) AS cuantas,
           -- Los lados de todas, sin repetir y ordenados, que es como los deja la regla.
           (SELECT jsonb_agg(DISTINCT l ORDER BY l)
              FROM chequeo_senales s2,
                   LATERAL jsonb_array_elements_text(COALESCE(s2.detalle->'lados', '[]'::jsonb)) l
             WHERE s2.revision_id = s.revision_id AND s2.cc = s.cc
               AND s2.ref = s.ref AND s2.regla = s.regla) AS lados,
           STRING_AGG(detalle->>'texto', ' · ' ORDER BY id) AS texto,
           MIN((detalle->>'valor')::numeric) AS valor
      FROM chequeo_senales s
     WHERE estado = 'abierta'
       AND declarada_por IS NULL
       AND NULLIF(TRIM(COALESCE(nota, '')), '') IS NULL
     GROUP BY revision_id, id_proyecto, cc, ref, regla
    HAVING COUNT(*) > 1
)
UPDATE chequeo_senales s
   SET detalle = s.detalle
                 || jsonb_build_object('lados', g.lados)
                 || jsonb_build_object('texto', g.texto)
                 || jsonb_build_object('valor', g.valor)
  FROM g
 WHERE s.id = g.se_queda;

-- Y las sobrantes se van. Van DESPUÉS del update para que, si el update falla, no se
-- pierda ninguna: la migración corre entera o no corre (cada una va en su SAVEPOINT).
DELETE FROM chequeo_senales s
 USING (
    SELECT id, MIN(id) OVER (PARTITION BY revision_id, cc, ref, regla) AS se_queda
      FROM chequeo_senales
     WHERE estado = 'abierta'
       AND declarada_por IS NULL
       AND NULLIF(TRIM(COALESCE(nota, '')), '') IS NULL
 ) t
 WHERE s.id = t.id AND t.id <> t.se_queda;
