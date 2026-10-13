-- LA REVISIÓN ES LA UNIDAD, Y EL CICLO DE UN HALLAZGO SE CIERRA (13-oct)
--
-- Hasta acá las señales eran una bolsa acumulada de 540 y la revisión sólo las producía:
-- la pantalla mostraba todo junto y no había forma de preguntar «¿qué salió HOY?». El
-- usuario lo redefinió: la unidad es la REVISIÓN —cada vez que alguien aprieta el botón o
-- corre el reloj queda un registro— y cada una muestra SÓLO lo que apareció en ella.
--
-- 1. DE QUÉ REVISIÓN ES CADA SEÑAL. Se derivaba comparando `visto_primero` con la hora de
--    arranque de la corrida, que es frágil (dos revisiones solapadas, o una que se corta).
--    Ahora se guarda el id, que es un hecho y no una inferencia.
ALTER TABLE chequeo_senales ADD COLUMN IF NOT EXISTS revision_id BIGINT;
CREATE INDEX IF NOT EXISTS ix_chequeo_senales_rev ON chequeo_senales (revision_id);

-- Las que ya existen se reparten por la hora en que se vieron por primera vez: es lo mejor
-- que hay para lo viejo, y para lo nuevo ya no hace falta adivinar.
UPDATE chequeo_senales s SET revision_id = (
    SELECT r.id FROM chequeo_revisiones r
     WHERE r.arrancada <= s.visto_primero
     ORDER BY r.arrancada DESC LIMIT 1)
 WHERE s.revision_id IS NULL;

-- 2. EL CICLO DE UN HALLAZGO, CON LOS NOMBRES DE LA NORMA.
--
--      Abierta ──[el responsable declara la corrección]──> Corregida (declarada)
--          │                     └──[se verifica en aSa]──> Verificada ✓
--          │                            └── sigue igual ──> vuelve a Abierta
--          └──[no aplica, con justificación]──> No aplica –
--
--    ISO 9001 §10.2 separa la CORRECCIÓN (lo que se hace para eliminar la no conformidad)
--    de la VERIFICACIÓN de su eficacia. Acá son dos pasos distintos a propósito y los hacen
--    dos actores distintos: la corrección la declara una persona; la eficacia la comprueba
--    el sistema leyendo aSa. Que una persona pudiera marcar «verificada» sería firmar su
--    propia tarea.
--
--    `declarada` es el estado nuevo. `corregida` ya existía y es la que pone el sistema
--    cuando la regla deja de saltar: pasa a mostrarse como VERIFICADA. `aceptada` también
--    existía y pasa a mostrarse como NO APLICA. No se renombran los valores para no tocar
--    las 540 filas ni el código que ya los lee; lo que cambia es qué significan en pantalla.
ALTER TABLE chequeo_senales DROP CONSTRAINT IF EXISTS ck_chequeo_estado;
ALTER TABLE chequeo_senales ADD CONSTRAINT ck_chequeo_estado
    CHECK (estado IN ('abierta', 'declarada', 'aceptada', 'corregir', 'corregida'));

ALTER TABLE chequeo_senales
    ADD COLUMN IF NOT EXISTS declarada_por TEXT,
    ADD COLUMN IF NOT EXISTS declarada_el  TIMESTAMPTZ,
    -- POR QUÉ NO APLICA, en categorías y no sólo en texto libre. El usuario acotó cuándo es
    -- legítimo: «cuando haya una confirmación con producción de que podría dejarse como se
    -- pide por un tema relacionado con el cliente… o que sea una figura donde las 10 veces
    -- el diámetro no aplique». Categorizarlo permite leer después lo que el texto libre
    -- esconde: si veinte personas marcan «la regla no aplica a esta figura», el problema
    -- está en la REGLA, no en las barras.
    ADD COLUMN IF NOT EXISTS motivo_tipo   TEXT;

-- 3. «corregir» queda sin uso: era el paso de ASIGNAR que el usuario eliminó —la señal
--    nace con dueño (quien cubicó el código), así que no hay nada que repartir—. Hoy no hay
--    ninguna fila en ese estado; si alguna quedara, pasa a declarada, que es lo que
--    significaba en la práctica.
UPDATE chequeo_senales SET estado = 'declarada' WHERE estado = 'corregir';
