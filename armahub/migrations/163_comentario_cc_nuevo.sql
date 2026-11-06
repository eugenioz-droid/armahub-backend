-- EL COMENTARIO DEL ELEMENTO TAMBIÉN SE RESUELVE EN UN CÓDIGO NUEVO (6-nov).
--
-- La línea de la auditoría ofrece tres salidas —Resuelto en CC, Resuelto en nuevo CC y No
-- aplica— igual para la barra y para el comentario del elemento («falta trabas de muro»).
-- La barra ya guarda su código nuevo en `auditoria_items.cc_nuevo`; el comentario no
-- tenía dónde. No hay barra que comprobar: queda dicho dónde quedó.
ALTER TABLE auditoria_elementos ADD COLUMN IF NOT EXISTS accion_cc_nuevo TEXT;
