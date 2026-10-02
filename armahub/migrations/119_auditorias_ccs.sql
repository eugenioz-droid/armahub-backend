-- 119 — EN aSa EL ALCANCE SON LOS CÓDIGOS DE CONTROL (2-oct).
--
-- POR QUÉ. Se intentó acotar una auditoría de aSa por piso y ciclo, reconociéndolos del
-- texto del código. Funcionaba a medias (55-77% según la obra) y era adivinar: en aSa el
-- piso y el ciclo NO EXISTEN como dato — lo que hay es `Descr`, el nombre que el usuario
-- le puso al código. El usuario lo zanjó: se eligen los CÓDIGOS, y dentro de ellos salen
-- los elementos. Así no se adivina nada.
--
-- SE ELIGEN SOLO LOS NO DESPACHADOS. Un código Shipped ya se fabricó y se fue a la obra:
-- auditarlo llega tarde. Lo que vale es revisar antes de que salga.
--
-- Esta columna guarda qué códigos se eligieron, que es el alcance real de esa auditoría.
-- Sin esto el alcance quedaría sólo implícito en los elementos sorteados, y no se podría
-- decir «de estos 12 códigos salieron estos 5 elementos».

DO $$ BEGIN ALTER TABLE auditorias ADD COLUMN ccs TEXT[] NOT NULL DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
