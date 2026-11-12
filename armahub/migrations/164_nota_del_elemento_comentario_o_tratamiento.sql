-- La nota del elemento: comentario o requiere tratamiento (12-nov)
--
-- Hasta hoy la nota del elemento («falta una traba en el nudo del eje 4») se respondía sólo
-- si el elemento no tenía barras marcadas; con barras marcadas nadie la contestaba y en el
-- informe salía como «Comentario · sin respuesta propia», que el usuario no entendió. Ahora
-- el AUDITOR elige, al escribirla:
--
--   comentario   queda escrito; nadie lo responde; va al final del informe.
--   tratamiento  es un hallazgo del elemento, como una barra no conforme: el cubicador lo
--                resuelve (Resuelto / No aplica, con su RCA) y cuenta en el resumen.
--
-- `nota_estado` es el estado de la NOTA (pendiente / corregida / desestimada), aparte del
-- del elemento: con barras marcadas, `accion_estado` se deriva de las barras Y la nota, y
-- la nota necesita el suyo propio. Lo demás de su respuesta usa las columnas que el
-- comentario suelto ya tenía (accion_nota, accion_por, accion_el, accion_cc_nuevo, causa*).
ALTER TABLE auditoria_elementos ADD COLUMN IF NOT EXISTS nota_trato TEXT;
ALTER TABLE auditoria_elementos ADD COLUMN IF NOT EXISTS nota_estado TEXT;

-- LAS AUDITORÍAS YA ENVIADAS O CERRADAS SE HICIERON SIN ESTA PREGUNTA: todas sus notas quedan
-- como comentario. El usuario, 12-nov: «tengo todas las auditorías cerradas… marcar los
-- comentarios como comentarios, ya que no se usó esa lógica. Para las siguientes ya
-- aplicará». Al aplicarse eran 7 auditorías, todas cerradas, con 16 notas. Las de
-- auditorías en borrador quedan sin elegir, y el auditor elige antes de enviar.
UPDATE auditoria_elementos e
   SET nota_trato = 'comentario'
  FROM auditorias a
 WHERE a.id = e.auditoria_id AND e.nota_trato IS NULL
   AND TRIM(COALESCE(e.texto, '')) <> ''
   AND (a.enviada_el IS NOT NULL OR a.estado = 'cerrada');

-- Sin barras marcadas, la nota era lo único que había que tratar en el elemento; como
-- comentario ya no queda nada, y el estado del elemento se deriva a NULL, igual que lo hace
-- `_accion_de_items`. Eran 2 (A-2026-012 F-6 y A-2026-013 D-8, las dos «no aplica»). Lo que
-- respondió el auditado (accion_nota, accion_por, accion_el) se conserva: no es nuestro.
UPDATE auditoria_elementos e
   SET accion_estado = NULL
  FROM auditorias a
 WHERE a.id = e.auditoria_id
   AND (a.enviada_el IS NOT NULL OR a.estado = 'cerrada')
   AND e.nota_trato = 'comentario' AND e.accion_estado IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auditoria_items i
                    WHERE i.elemento_id = e.id AND i.conforme IS FALSE);
