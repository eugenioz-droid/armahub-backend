-- LOS AVISOS QUE SE MANDARON AL LOGIN DE aSa, AL CORREO (21-oct).
--
-- La campana busca por correo (`WHERE destinatario = email`), pero varios avisos de
-- auditoría salían con el login de aSa como destinatario —«HMONDACA», «Nlopez»—: 37 de
-- 48, incluido el «tienes 24 horas para corregir» del envío. Nunca le llegaron a nadie, y
-- eso explica parte de que los cubicadores no supieran cómo responder.
--
-- El código ya resuelve el login al correo al avisar (`_avisar` → `correo_de_login`). Esto
-- es para los que ya salieron: se re-dirigen con la misma regla —inicial del nombre pegada
-- al apellido, sin tildes— para que aparezcan ahora en la campana de quien correspondía.
-- Lo que no calce con ningún usuario (un externo que ya no está) se queda como está: no
-- hay a quién dárselo, y borrarlo sería perder el registro de que se intentó avisar.
UPDATE notificaciones n
   SET destinatario = u.email
  FROM users u
 WHERE n.destinatario NOT LIKE '%@%'
   AND COALESCE(u.activo, TRUE)
   AND LOWER(TRANSLATE(n.destinatario, 'ÁÉÍÓÚÑáéíóúñ', 'AEIOUNaeioun')) IN (
         LOWER(TRANSLATE(LEFT(COALESCE(u.nombre, ''), 1) || REPLACE(COALESCE(u.apellido, ''), ' ', ''),
                         'ÁÉÍÓÚÑáéíóúñ', 'AEIOUNaeioun')),
         LOWER(TRANSLATE(LEFT(COALESCE(u.nombre, ''), 1) || SPLIT_PART(COALESCE(u.apellido, ''), ' ', 1),
                         'ÁÉÍÓÚÑáéíóúñ', 'AEIOUNaeioun'))
       );
