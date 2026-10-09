-- LA CAUSA ES POR ITEM, Y LA PONE QUIEN RESPONDE (8-oct)
--
-- DOS CAMBIOS, y los dos los pidió el usuario.
--
-- 1. SALE DEL AUDITOR. Hasta acá la causa raíz se elegía en el formulario de auditoría,
--    o sea la ponía quien encontró el problema. El auditor ve QUÉ está mal; el POR QUÉ lo
--    sabe quien lo hizo. Ahora la clasifica el cubicador cuando responde, en el mismo
--    momento en que declara la corrección. Es además como lo pide la ISO: el análisis de
--    causa es del auditado, no del auditor.
--
-- 2. ES POR ITEM. Igual que el hallazgo y que la corrección. Dos barras del mismo elemento
--    pueden estar mal por razones distintas —una por un plano desactualizado y otra por
--    una digitación— y meterlas en la misma casilla hace que el Pareto mienta.
--
-- LA CAUSA DE LA AUDITORÍA NO ES LA DEL RECLAMO. Viven en tablas distintas y ningún
-- reporte de reclamos las lee: un hallazgo de auditoría no es un reclamo del cliente y
-- sumarlos daría un Pareto que no describe ninguna de las dos cosas. Por ahora las dos
-- eligen del MISMO catálogo —el Ishikawa del área de Cubicaciones, que es el único que
-- está cargado—; separar también el catálogo es una decisión de contenido que el usuario
-- tiene que tomar, y la estructura ya está lista para eso.
ALTER TABLE auditoria_items
    ADD COLUMN IF NOT EXISTS causa           TEXT,   -- el código de la sub-causa
    ADD COLUMN IF NOT EXISTS causa_categoria TEXT,   -- la M del Ishikawa
    ADD COLUMN IF NOT EXISTS causa_texto     TEXT,   -- la sub-causa, como se eligió
    ADD COLUMN IF NOT EXISTS causa_por       TEXT,
    ADD COLUMN IF NOT EXISTS causa_el        TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_aud_items_causa ON auditoria_items (causa) WHERE causa IS NOT NULL;
