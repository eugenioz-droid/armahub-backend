-- EL AVISO DE FABRICACIÓN VA POR CÓDIGO, NO POR AUDITORÍA (9-oct)
--
-- La 138 puso `aviso_fabrica_el` en `auditorias`, y está mal pensado: el hecho que se avisa
-- es «ESTE código entró a fabricación con un hallazgo sin corregir», y una auditoría tiene
-- diez códigos distintos. Guardando la marca en la auditoría, el primer código que entra a
-- Processed dispara el aviso y los nueve siguientes se lo comen en silencio —que es
-- justamente el caso que el aviso existe para cubrir—. Va en el elemento, que es quien
-- tiene el `cc`.
--
-- Se puede borrar la columna sin cuidado: nació ayer y nunca se escribió.
ALTER TABLE auditorias DROP COLUMN IF EXISTS aviso_fabrica_el;

ALTER TABLE auditoria_elementos
    -- CUÁNDO SE AVISÓ QUE EL CÓDIGO SE ESTABA FABRICANDO. Es la única excepción al «el
    -- auditado no ve nada antes del envío», y la pidió el usuario: «sería deseable indicar
    -- si la figura está como procesada, avisar al auditor para que sepa que debe apurarse y
    -- avisar ojalá al cubicador para arreglar, aunque no se haya terminado la auditoría».
    --
    -- La urgencia manda sobre el orden: una barra mal que ya está en la máquina se arregla
    -- ahora, no cuando el auditor termine de revisar los otros once elementos. El aviso
    -- lleva el código y la marca para que se pueda ir a arreglar directo en aSa, sin
    -- esperar a que la auditoría aparezca en el panel.
    --
    -- Se guarda la fecha para no repetir el mismo aviso todos los días: un aviso diario que
    -- dice lo mismo se deja de leer, y entonces el día que importa tampoco se lee.
    ADD COLUMN IF NOT EXISTS aviso_fabrica_el TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_aud_elem_cc_aviso
    ON auditoria_elementos (cc) WHERE cc IS NOT NULL AND aviso_fabrica_el IS NULL;
