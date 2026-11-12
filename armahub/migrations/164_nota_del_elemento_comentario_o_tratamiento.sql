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

-- LO DE ANTES QUEDA COMO ESTABA. El comentario suelto (hallazgo con nota y sin barras
-- marcadas) ya se respondía: pasa a «tratamiento» con el estado que tenía.
UPDATE auditoria_elementos e
   SET nota_trato = 'tratamiento', nota_estado = COALESCE(e.accion_estado, 'pendiente')
 WHERE e.nota_trato IS NULL AND e.hallazgo = 'hallazgo'
   AND TRIM(COALESCE(e.texto, '')) <> ''
   AND NOT EXISTS (SELECT 1 FROM auditoria_items i
                    WHERE i.elemento_id = e.id AND i.conforme IS FALSE);

-- Las demás notas de auditorías ya enviadas o cerradas nadie las respondía: comentario. Las
-- de auditorías todavía en borrador quedan sin elegir, y el auditor elige antes de enviar.
UPDATE auditoria_elementos e
   SET nota_trato = 'comentario'
  FROM auditorias a
 WHERE a.id = e.auditoria_id AND e.nota_trato IS NULL
   AND TRIM(COALESCE(e.texto, '')) <> ''
   AND (a.enviada_el IS NOT NULL OR a.estado = 'cerrada');
