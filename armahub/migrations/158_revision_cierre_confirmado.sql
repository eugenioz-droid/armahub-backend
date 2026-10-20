-- EL CUBICADOR CIERRA LO RESUELTO DE SU REVISIÓN, Y QUEDA SU FIRMA (20-oct).
--
-- Mismo flujo que la auditoría, porque el usuario pidió armonizarlos: la barra la marca
-- «Resuelto» quien la cubicó, y al CERRAR se le pregunta a aSa en vivo por cada una. La
-- que aSa confirma pasa a `corregida`; la que sigue como estaba se avisa sin bloquear, y
-- si el cubicador cierra igual queda escrito acá que lo confirmó él y cuándo —así nadie
-- tiene que adivinar después por qué una señal «resuelta» sigue diciendo lo mismo en aSa—.
ALTER TABLE chequeo_senales ADD COLUMN IF NOT EXISTS cierre_confirmado_por TEXT;
ALTER TABLE chequeo_senales ADD COLUMN IF NOT EXISTS cierre_confirmado_el TIMESTAMPTZ;
