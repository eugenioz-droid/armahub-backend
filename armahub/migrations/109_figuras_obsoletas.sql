-- 109 — SOFT ERASE de figuras del catálogo (26-ago).
--
-- QUÉ PROBLEMA RESUELVE. Hasta ahora `DELETE /figuras-catalogo/{codigo}` borraba
-- físicamente y sin comprobar nada. El caso real del usuario: una figura quedó
-- dibujada en un sentido que no calza con aSa Studio y quiere REDIBUJARLA
-- conservando su código (104B tiene que seguir llamándose 104B, porque el código es
-- un estándar que viaja en el export). Borrar y recrear dejaba, entre medio, a los
-- templates que la usaban generando un componente menos — y al regenerar una
-- estructura, esas barras se borraban del despiece.
--
-- EL MODELO QUE LO HACE SEGURO: la BARRA es autosuficiente — guarda sus lados, sus
-- ángulos, su largo, su peso y el nombre de la figura. El catálogo es una capa de
-- VALIDACIÓN encima, no la fuente del contenido (la plataforma funcionaba antes de
-- que existiera el catálogo, y el export manda lo que la barra dice). Por eso este
-- flujo NO TOCA NI UNA BARRA. Lo único que hay que repuntar son las RECETAS
-- (templates y estructuras), porque ésas REGENERAN barras leyendo el catálogo.
--
-- CÓMO QUEDA. Al retirar una figura, se le cambia el código por uno obsoleto
-- (`104B~1`), se marca inactiva y se anota de dónde viene. El código original queda
-- LIBRE para redibujar. Las recetas se repuntan al código obsoleto, así que siguen
-- dibujando y generando exactamente lo que generaban.
--
-- `obsoleta_de` es además el candado del "reactivar": sólo se puede volver al código
-- original si nadie lo ocupó mientras tanto.
DO $$ BEGIN ALTER TABLE figuras_catalogo ADD COLUMN obsoleta_de TEXT;      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE figuras_catalogo ADD COLUMN retirada_fecha TEXT;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE figuras_catalogo ADD COLUMN retirada_por TEXT;     EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Para el listado de obsoletas y para el candado del reactivar (¿está libre el
-- código original?). Parcial: las obsoletas son una minoría del catálogo.
CREATE INDEX IF NOT EXISTS ix_figuras_obsoleta_de
    ON figuras_catalogo (obsoleta_de) WHERE obsoleta_de IS NOT NULL;
