-- EL COMENTARIO SUELTO DEL ELEMENTO TAMBIÉN SE RESUELVE (15-oct).
--
-- El hallazgo es por barra, pero no todo hallazgo es de una barra: «falta trabas de muro»
-- no se puede colgar de ninguna, porque la barra que falta no está. El auditor lo escribe
-- en el comentario del elemento y hasta hoy ese comentario no tenía dónde resolverse: el
-- auditado lo leía y el elemento quedaba pendiente para siempre.
--
-- El elemento ya tenía `causa` y `accion_*`; le faltaban las dos columnas con que el
-- Ishikawa guarda de dónde salió la causa elegida, las mismas que ya tiene la barra.
ALTER TABLE auditoria_elementos ADD COLUMN IF NOT EXISTS causa_categoria TEXT;
ALTER TABLE auditoria_elementos ADD COLUMN IF NOT EXISTS causa_texto TEXT;
