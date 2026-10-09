-- LOS DOS PLAZOS SON DE 24 HORAS, Y SON DOS (9-oct)
--
-- El usuario los fijó: la auditoría tiene 24 horas para hacerse, y la corrección 24 horas
-- para hacerse. Suenan al mismo plazo y no lo son — son de personas distintas y arrancan
-- en momentos distintos:
--
--   · EL DEL AUDITOR corre desde que se CREA la auditoría y mide cuánto se demora en
--     revisarla. Antes eran 10 días hábiles (`DIAS_PLAZO`).
--   · EL DEL AUDITADO corre desde que se ENVÍA, porque hasta ese segundo no podía hacer
--     nada: su panel ni siquiera mostraba las barras.
--
-- Y hasta ahora el panel del auditado mostraba el PRIMERO como si fuera el suyo, lo que
-- daba las dos lecturas equivocadas: una barra recién enviada aparecía con una semana de
-- holgura, y una de una auditoría vieja nacía vencida sin que nadie hubiera podido tocarla.
--
-- VAN COMO TIMESTAMP y no como fecha: 24 horas desde las 16:30 vencen a las 16:30 del día
-- siguiente, no a medianoche. `plazo_fecha` se mantiene —la leen el informe, la lista y
-- los correos— con la FECHA de ese vencimiento, para no romper nada de eso.
ALTER TABLE auditorias
    -- Cuándo se le vence al AUDITOR terminar de revisar. Se pone al crear la auditoría.
    ADD COLUMN IF NOT EXISTS auditoria_vence  TIMESTAMPTZ,
    -- Cuándo se le vence al AUDITADO corregir. Se pone AL ENVIAR y se borra al reabrir: el
    -- plazo no puede correr mientras la auditoría está reabierta y él no la ve.
    ADD COLUMN IF NOT EXISTS correccion_vence TIMESTAMPTZ;

COMMENT ON COLUMN auditorias.plazo_fecha IS
    'La FECHA de auditoria_vence. Se conserva porque la leen el informe, la lista y los correos.';
COMMENT ON COLUMN auditorias.auditoria_vence IS
    'Cuándo vence la revisión del AUDITOR: 24 h desde que se crea la auditoría.';
COMMENT ON COLUMN auditorias.correccion_vence IS
    'Cuándo vence la corrección del AUDITADO: 24 h desde el ENVÍO. Otro plazo, otra persona.';

-- LAS AUDITORÍAS QUE YA EXISTEN NO SE RECALCULAN. Nacieron con diez días hábiles y
-- aplicarles 24 horas hacia atrás las dejaría a todas vencidas por una regla que no regía
-- cuando se crearon. Se les copia el plazo que ya tenían, al cierre de ese día.
UPDATE auditorias
   SET auditoria_vence = (plazo_fecha + TIME '23:59') AT TIME ZONE 'America/Santiago'
 WHERE auditoria_vence IS NULL AND plazo_fecha IS NOT NULL;
