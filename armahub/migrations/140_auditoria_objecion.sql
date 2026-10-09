-- EL AUDITOR PUEDE OBJETAR UN DESCARTE, pero no tiene que validarlo (9-oct)
--
-- Al contar que el desestimado le llega al auditor, el usuario preguntó: «¿el auditor debe
-- validar entonces?». La respuesta es NO, y por la misma razón por la que él mismo sacó al
-- auditor de la verificación tres días antes:
--
--   · Si validar fuera obligatorio, el auditor vuelve al camino crítico: nada cierra hasta
--     que él se pronuncie, y una semana de vacaciones deja veinte barras congeladas.
--   · Y vuelve a mezclar los roles. El auditado es responsable de lo que decide; el
--     auditor, de lo que observó.
--
-- Entonces: EL DESCARTE VALE POR DEFECTO —no traba el cierre y la barra sale de pendientes—
-- y el auditor tiene DERECHO A RÉPLICA: ve el descarte con su motivo y, si no lo acepta,
-- reabre ESA barra dejando por escrito por qué. La barra vuelve a contar como abierta y el
-- auditado tiene que resolverla de otra manera.
--
-- Así el registro cuenta la historia completa y no sólo el final: el auditado descartó
-- porque X, el auditor no lo aceptó porque Y. Si después el error sale en la obra, está
-- escrito quién dijo qué y cuándo — que es exactamente lo que el usuario quería del
-- descarte: «existirá trazabilidad de que el auditado no consideró lo auditado».
ALTER TABLE auditoria_items
    -- Por qué el auditor no aceptó el descarte. El `desestimado_motivo` NO se borra al
    -- objetar: las dos posturas quedan, porque la discusión es el dato.
    ADD COLUMN IF NOT EXISTS objecion     TEXT,
    ADD COLUMN IF NOT EXISTS objecion_por TEXT,
    ADD COLUMN IF NOT EXISTS objecion_el  TIMESTAMPTZ;
