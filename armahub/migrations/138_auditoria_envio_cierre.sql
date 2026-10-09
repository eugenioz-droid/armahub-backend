-- EL FLUJO DE LA AUDITORÍA: ENVIAR, RESOLVER, CERRAR (9-oct)
--
-- Hasta acá «cerrada» significaba «se revisó el último elemento», y eso no es cerrar: es
-- terminar de mirar. Peor: el auditado veía sus barras y podía accionar en cuanto el
-- auditor guardaba CADA elemento, o sea sobre una auditoría a medio hacer. El usuario lo
-- fijó: «al enviar, recién ahí el cubicador auditado puede accionar sobre la auditoría».
--
-- CUATRO ESTADOS, y el cierre pasa a significar RESUELTA:
--   planificada  creada, sin revisar
--   en_curso     el auditor está revisando. SÓLO ÉL la ve.
--   enviada      el auditor la terminó y la mandó. Recién acá el auditado puede accionar.
--   cerrada      todas las barras con hallazgo quedaron resueltas.
-- No hay CHECK sobre `auditorias.estado` (se validan en Python contra ESTADOS), así que no
-- hay nada que alterar para que entre el valor nuevo.
--
-- LO QUE SE AGREGA, y por qué cada cosa:

ALTER TABLE auditoria_items
    -- CÓMO ESTABA LA BARRA CUANDO SE AUDITÓ. Sin esto no se puede comprobar nada: para
    -- decir «esto cambió» hace falta el antes. Y hay dos niveles de comprobación, los dos
    -- los pidió el usuario:
    --   · si el auditor corrigió los números en el formulario (el `esperado`), se compara
    --     campo por campo y la comprobación es ESPECÍFICA;
    --   · si sólo dejó un comentario, no hay con qué comparar, pero igual se puede decir
    --     si la barra CAMBIÓ o sigue idéntica — que es lo único honesto que se puede
    --     afirmar ahí.
    -- Las 47 barras no conformes que ya existen no lo tienen: para ésas sólo va a servir
    -- el valor esperado, y se dice en pantalla en vez de inventar una comprobación.
    ADD COLUMN IF NOT EXISTS dato_original JSONB,
    -- DÓNDE QUEDÓ LA BARRA SI SE HIZO UN CÓDIGO NUEVO. `cc_nuevo` ya guardaba el código;
    -- faltaba la marca dentro de él, sin la cual hay que adivinar cuál de las barras del
    -- código nuevo es la que reemplaza a ésta.
    ADD COLUMN IF NOT EXISTS item_nuevo TEXT,
    -- EL AUDITADO DESESTIMA UN HALLAZGO. Lo pidió el usuario: «el cubicador auditado
    -- podría resolver que la observación del auditor no es la correcta, pero debe tener un
    -- botón que le permita marcar como lista la barra donde desestime la corrección».
    -- El motivo es OBLIGATORIO (lo valida el endpoint): un desestimado sin motivo no
    -- sirve de trazabilidad, que es exactamente para lo que se guarda — «si eso llegase a
    -- hacerlo mal el auditado, el error saltará en la obra y existirá trazabilidad de que
    -- el auditado no consideró lo auditado».
    ADD COLUMN IF NOT EXISTS desestimado        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS desestimado_motivo TEXT,
    ADD COLUMN IF NOT EXISTS desestimado_por    TEXT,
    ADD COLUMN IF NOT EXISTS desestimado_el     TIMESTAMPTZ;

ALTER TABLE auditorias
    -- EL CIERRE A MANO, con su motivo. El cierre normal es derivado —todas las barras
    -- resueltas— pero hace falta una válvula para lo que el sistema NO puede comprobar: la
    -- barra que ya no existe en aSa, el código que se anuló, la obra que terminó. Sin
    -- ella una auditoría queda abierta para siempre por un caso raro. El motivo es
    -- obligatorio por la misma razón que el del desestimado.
    ADD COLUMN IF NOT EXISTS cerrada_a_mano BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS cerrada_motivo TEXT,
    ADD COLUMN IF NOT EXISTS cerrada_por    TEXT,
    -- CUÁNDO SE AVISÓ QUE EL CÓDIGO SE ESTABA FABRICANDO. La única excepción al «nadie ve
    -- nada antes del envío», y la pidió el usuario: si un código con un hallazgo sin
    -- corregir pasa a Processed, hay que avisar aunque la auditoría no esté terminada —al
    -- auditor para que apure y al cubicador para que arregle—. Se guarda la fecha para no
    -- mandar el mismo aviso todos los días.
    ADD COLUMN IF NOT EXISTS aviso_fabrica_el TIMESTAMPTZ;

-- Las barras desestimadas se consultan para contarlas aparte (no se diluyen en el
-- indicador: salen de «pendientes» pero tienen su propia columna).
CREATE INDEX IF NOT EXISTS ix_aud_items_desestimado
    ON auditoria_items (elemento_id) WHERE desestimado;

-- LAS AUDITORÍAS QUE YA ESTABAN CERRADAS SE QUEDAN CERRADAS. Se marcan como cerradas a
-- mano porque es lo único cierto: se cerraron con la regla vieja («se revisó todo»), no
-- porque sus hallazgos estuvieran resueltos. Dejarlas pasar por la regla nueva las
-- reabriría de golpe, y reabrir una auditoría cerrada hace tres días por un cambio de
-- definición es exactamente lo que no hay que hacerle al historial.
UPDATE auditorias
   SET cerrada_a_mano = TRUE,
       cerrada_motivo = COALESCE(cerrada_motivo,
                                 'Cerrada con la regla anterior: se revisaron todos los '
                                 'elementos. El flujo de envío y resolución es posterior.')
 WHERE estado = 'cerrada' AND NOT cerrada_a_mano;

-- Y LAS QUE ESTÁN A MEDIO REVISAR NO QUEDAN ENVIADAS. `enviada_el` nació en la 136 y
-- nunca se escribió, así que no hay nada que rellenar: lo que importa es que ninguna
-- auditoría en curso aparezca como enviada por accidente.
UPDATE auditorias SET enviada_el = NULL, enviada_por = NULL
 WHERE estado IN ('planificada', 'en_curso');
