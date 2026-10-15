-- EL AUDITADO NO PUEDE ESCRIBIR EL VEREDICTO DEL AUDITOR: SE ANULA LO QUE ESCRIBIÓ (15-oct)
--
-- El usuario: «un cubicador "contestó" la auditoría editando todo… puso todo conforme.
-- La de Zañartu hecha por José Rodríguez y "mal respondida" por Nicolás López… eso tenía
-- como 10 hallazgos, ahora no tiene ninguno porque el cubicador no entendió cómo
-- responder, y modificó los hallazgos a conforme».
--
-- QUÉ PASÓ, CON FECHAS. José auditó A-2026-013 el 7-oct y dejó 4 elementos con barras no
-- conformes (D-8: 3, N-4: 2, 154 R0: 1, 8 (C-D): 1). El 11-oct de madrugada Nicolás —que
-- cubicó esos elementos y era el auditado— abrió el mismo formulario del auditor y guardó
-- los 4 como «conforme». El guardado pisa el veredicto ref por ref, así que lo de José se
-- perdió. José la envió el 13 con «10 de 10 conforme» sin saberlo y se cerró sola. En
-- A-2026-012 hizo lo mismo con dos elementos de Emilio (406 REV1 tenía 12 barras malas).
--
-- POR QUÉ PUDO. El endpoint que guarda la revisión sólo exigía «puede auditar» —ser del
-- área de Cubicaciones— y no «ser el auditor de ESTA auditoría». Eso se cerró el 14-oct
-- (commit b3f108a: 403 a un tercero, 409 sobre una enviada). Y el día que lo hizo, el
-- auditado no tenía controles propios: el Resumen Hallazgos con Aplica / No aplica / RCA
-- se construyó el 14. No tenía cómo responder y respondió por donde pudo.
--
-- QUÉ SE HACE. Los veredictos del auditado se ANULAN —no son suyos para escribirlos— y
-- esos elementos vuelven a «pendiente», para que el auditor los revise de nuevo. No se
-- inventa lo que marcó José: no hay registro ref por ref. Lo que sí hay es el conteo, y
-- se le manda en el aviso. A-2026-013 se reabre, porque se envió y cerró sobre datos que
-- no eran del auditor.
--
-- LA REGLA ES GENERAL y no una lista de ids: todo elemento cuyo `revisado_por` no sea el
-- auditor de su auditoría ni administración. Hoy son exactamente seis, los de arriba.

CREATE TEMP TABLE _ajenos AS
SELECT e.id AS elemento_id, e.auditoria_id, a.codigo, a.auditor, e.revisado_por,
       COALESCE(e.cc, '') AS cc, e.nombre
  FROM auditoria_elementos e
  JOIN auditorias a ON a.id = e.auditoria_id
 WHERE e.revisado_por IS NOT NULL
   AND e.revisado_por <> a.auditor
   AND e.revisado_por NOT IN (SELECT email FROM users WHERE role IN ('admin', 'admin_calidad'));

-- 1. Las barras que el auditado marcó se van: eran SU respuesta al formulario equivocado.
--    Con ellas se van también las correcciones y causas que declaró sobre esas barras,
--    porque colgaban de un veredicto que no existía.
DELETE FROM auditoria_items WHERE elemento_id IN (SELECT elemento_id FROM _ajenos);

-- 2. El elemento vuelve a pendiente, como si nadie lo hubiera revisado.
UPDATE auditoria_elementos e
   SET hallazgo = NULL, texto = NULL, revisado_por = NULL, revisado_el = NULL,
       accion_estado = NULL, accion_por = NULL, accion_el = NULL, accion_nota = NULL
 WHERE e.id IN (SELECT elemento_id FROM _ajenos);

-- 3. Las auditorías tocadas: si estaban enviadas o cerradas, se reabren (mismo reset que
--    el botón «Reabrir»), porque lo que se envió no era el veredicto del auditor. El
--    estado se deriva: con elementos sin revisar y sin envío, es «en_curso».
UPDATE auditorias a
   SET enviada_el = NULL, enviada_por = NULL, cerrada_a_mano = FALSE, cerrada_motivo = NULL,
       cerrada_por = NULL, cierre_fecha = NULL, correccion_vence = NULL,
       estado = 'en_curso'
 WHERE a.id IN (SELECT DISTINCT auditoria_id FROM _ajenos);

-- 4. Queda escrito en el registro, por auditoría, qué se anuló y de quién.
INSERT INTO audit_log (usuario, accion, detalle, entidad, entidad_id, fecha)
SELECT 'sistema', 'auditoria_veredicto_ajeno_anulado',
       codigo || ': ' || COUNT(*) || ' elemento(s) revisados por ' ||
       split_part(MIN(revisado_por), '@', 1) || ' (el auditado, no el auditor) vuelven a pendiente; ' ||
       'la auditoría se reabre para ' || split_part(MIN(auditor), '@', 1),
       'auditoria', auditoria_id::text, now()::text
  FROM _ajenos GROUP BY auditoria_id, codigo;

-- 5. Y el auditor se entera, con el conteo que sí se conserva del registro, para que no
--    tenga que adivinar por dónde empezar.
INSERT INTO notificaciones (destinatario, tipo_evento, reclamo_id, mensaje, fecha)
SELECT auditor, 'auditoria_accion', NULL,
       'Auditoría ' || codigo || ': ' || COUNT(*) || ' elemento(s) que habías revisado fueron ' ||
       'guardados después por quien cubicó (' || split_part(MIN(revisado_por), '@', 1) || ') y ' ||
       'perdieron tu veredicto: ' || string_agg(COALESCE(NULLIF(cc, ''), '?') || ' · ' || nombre, ', ' ORDER BY nombre) ||
       '. Vuelven a pendiente y la auditoría queda reabierta para que los revises de nuevo.',
       now()::text
  FROM _ajenos GROUP BY auditoria_id, codigo, auditor;

DROP TABLE _ajenos;
