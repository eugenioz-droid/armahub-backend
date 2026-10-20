-- QUIÉN CERRÓ Y QUÉ DIJO aSa AL CERRAR (20-oct).
--
-- Hasta hoy el cierre del auditado y la válvula de excepción del auditor se guardaban
-- igual, los dos como `cerrada_a_mano`, así que en el registro no se distinguía «terminé
-- lo mío» de «esto no se puede resolver, lo cierro yo». Son dos actos distintos y uno de
-- los dos es una excepción: tienen que poder contarse aparte.
--
-- Y ahora que el auditado marca «Resuelto» a mano —sin esperar un barrido—, el chequeo
-- contra aSa se corre en el momento de cerrar. Lo que ese chequeo encontró queda escrito
-- en la auditoría: si el cubicador cerró con barras que en aSa seguían como estaban, se
-- sabe cuáles eran y que él lo confirmó igual. El usuario lo pidió así: avisar sin
-- bloquear, «en ese warning igual el cubicador puede confirmar y queda trazabilidad».
ALTER TABLE auditorias ADD COLUMN IF NOT EXISTS cierre_tipo TEXT;
ALTER TABLE auditorias ADD COLUMN IF NOT EXISTS cierre_chequeo JSONB;

-- Lo ya cerrado: si lo cerró alguien distinto del auditor, fue el auditado.
UPDATE auditorias
   SET cierre_tipo = CASE WHEN cerrada_por IS NULL THEN 'automatico'
                          WHEN cerrada_por = auditor THEN 'auditor'
                          ELSE 'auditado' END
 WHERE estado = 'cerrada' AND cierre_tipo IS NULL;
