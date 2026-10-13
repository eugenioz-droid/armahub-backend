-- SE RETIRA «ESTRIBO CUADRADO» Y ENTRA «LADOS OPUESTOS DISTINTOS» (13-oct)
--
-- La regla vieja marcaba el estribo CUADRADO, con la idea de que un cuadrado suele ser la
-- misma medida tipeada dos veces. Es falso: un estribo de 56 × 56 es un pilar cuadrado y
-- está bien. En la primera revisión de verdad levantó 43 barras, y el usuario trajo tres
-- —SUSW 10mmA26, SUSW 10mmA29 y SUQ8 8mmA51, de 560, 710 y 160 por lado— que estaban
-- correctas: «parece que los levantaste mal».
--
-- El criterio que puso en su lugar: «comparar los lados que son paralelos para esa figura;
-- si un lado paralelo al otro es distinto, debiera mostrar hallazgo». Medido sobre 2.169
-- barras reales, eso marca UNA barra (SUL0 12mmA103, con 1.520 contra 1.530 en lados
-- opuestos) donde la anterior marcaba 43.
--
-- 1. LAS SEÑALES DE LA REGLA RETIRADA SE VAN. No se pueden «corregir»: miden otra cosa.
--    Ninguna tenía trabajo encima —la revisión es de hoy y nadie alcanzó a tocarlas—, y
--    dejarlas sería pedirle a la gente que resuelva 43 barras que están bien.
DELETE FROM chequeo_senales
 WHERE regla = 'estribo_cuadrado'
   AND estado = 'abierta'
   AND declarada_por IS NULL
   AND NULLIF(TRIM(COALESCE(nota, '')), '') IS NULL;

-- Lo que alguien SÍ hubiera tocado se queda, pero se dice por qué ya no aplica: borrar el
-- trabajo de una persona es peor que dejar una fila explicada.
UPDATE chequeo_senales
   SET nota = CONCAT_WS(' · ', NULLIF(TRIM(COALESCE(nota, '')), ''),
                        'La regla «estribo cuadrado» se retiró el 13-oct: un estribo '
                        'cuadrado es correcto. Ahora se comparan los lados opuestos.')
 WHERE regla = 'estribo_cuadrado';

-- 2. LOS CÓDIGOS VUELVEN A LA COLA. La regla nueva busca algo que la vieja no miraba, así
--    que sus hallazgos NO están en la lista: no alcanza con limpiar, hay que volver a
--    mirar. No se borra `chequeo_codigos` —se perdería el registro de qué se revisó y
--    cuándo—: se le antigua la marca de contraste con aSa, que es lo que los devuelve a
--    «pendiente» por el camino normal.
--
--    Volver a correr NO duplica nada: las señales se insertan con ON CONFLICT (firma), así
--    que las 261 del lado corto sólo suman una vista más y siguen perteneciendo a la
--    revisión que las encontró.
UPDATE chequeo_codigos SET ultima_mod = TIMESTAMPTZ '1900-01-01'
 WHERE revisado_el >= '2026-10-13';
