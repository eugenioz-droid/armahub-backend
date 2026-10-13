-- LOS CHEQUEOS PARTEN DE CERO (13-oct)
--
-- Las 540 señales y las 10 revisiones que había eran de la construcción del módulo: tres
-- corridas a mano del 8-oct mientras se escribían las reglas, la primera corrida completa
-- del reloj del 9-oct (305 hallazgos de una), dos barridos de pendientes ese mismo día, y
-- las corridas del reloj del 11 al 13 que ya no encontraron nada nuevo. Ninguna tenía
-- trabajo encima: las 540 estaban en 'abierta', nadie declaró una corrección ni dejó un
-- hallazgo sin efecto.
--
-- Eso importa porque una señal ya vista NO se vuelve a reportar: mientras estuvieran ahí,
-- la primera revisión de verdad habría salido con cero hallazgos nuevos y 540 arrastrados
-- de una etapa que no era operación. El usuario pidió limpiar y partir de cero, y es lo
-- correcto: el registro de calidad empieza cuando el módulo empieza a usarse.
--
-- SE BORRA SÓLO LO ANTERIOR AL 14-oct, y sólo si nada de eso fue tocado por una persona.
-- Las dos condiciones están puestas a propósito: así esta migración no puede llevarse por
-- delante lo que venga después, ni acá ni en otro ambiente donde ya se esté trabajando.
DELETE FROM chequeo_senales
 WHERE visto_primero < '2026-10-14'
   AND estado = 'abierta'
   AND declarada_por IS NULL
   AND NULLIF(TRIM(COALESCE(nota, '')), '') IS NULL;

DELETE FROM chequeo_revisiones r
 WHERE r.arrancada < '2026-10-14'
   AND NOT EXISTS (SELECT 1 FROM chequeo_senales s WHERE s.revision_id = r.id);

-- Los códigos que el motor marcó como «ya revisados» también vuelven a cero: si no, la
-- primera revisión no recorrería nada. Esta tabla es la memoria del motor, no un registro.
DELETE FROM chequeo_codigos WHERE revisado_el < '2026-10-14';

-- El número de la revisión es lo que el usuario ve en pantalla («Revisión #1»), así que la
-- próxima parte en 1. Sólo si la tabla quedó vacía: si alguien ya trabajó, no se toca.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM chequeo_revisiones) THEN
        ALTER SEQUENCE chequeo_revisiones_id_seq RESTART WITH 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM chequeo_senales) THEN
        ALTER SEQUENCE chequeo_senales_id_seq RESTART WITH 1;
    END IF;
END $$;
