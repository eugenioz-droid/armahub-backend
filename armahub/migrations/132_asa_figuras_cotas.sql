-- LAS COTAS CON QUE aSa DIBUJA CADA FIGURA (7-oct)
--
-- El trazo (migración 131) dice por dónde va el fierro. Pero aSa, igual que nuestro editor,
-- NO dibuja sólo el fierro: dibuja encima las cotas —la altura, el ancho, el ángulo entre
-- dos lados— y eso es la mitad de lo que se lee en una figura. Sin ellas el dibujo es un
-- contorno, no un plano.
--
-- Están en el mismo RDX, en los componentes que NO son fierro: `WS` (cota entre dos
-- vértices), `WD` (auxiliar de dibujo), `AN` (ángulo), `WR` (radio). Hasta ahora el
-- importador los descartaba por eso mismo: no son barra. Lo son del dibujo.
--
-- CÓMO SE ARMA UNA COTA, comprobado sobre las 1.713 del catálogo: la LÍNEA DE COTA va de
-- `Stt` a `St2`, y los dos vértices que mide son `End` y `En2`. En 94 de cada 100 esos dos
-- puntos caen exactamente sobre un vértice del trazo, y en 98 de cada 100 el largo de la
-- línea coincide con lo que separa a esos vértices: el modelo es de aSa, no nuestro.
ALTER TABLE asa_figuras_catalogo
    ADD COLUMN IF NOT EXISTS cotas JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN asa_figuras_catalogo.cotas IS
    'Anotaciones del dibujo de aSa: [{nombre, tipo, linea:[[x1,y1],[x2,y2]], ref:[[..],[..]], centro:[x,y], texto:[x,y]}]';
