-- UN SOLO VOCABULARIO DE HALLAZGO (15-oct).
--
-- Quedaban cuatro elementos diciendo «nc_menor», del vocabulario que el usuario sacó el
-- 9-oct: él no quería que el auditor GRADUARA la falta —dos auditores gradúan distinto el
-- mismo defecto— sino que declarara un hecho, y que la gravedad la calculara el sistema
-- con el estado del código. Desde entonces los hallazgos son tres: conforme, observacion,
-- hallazgo.
--
-- El problema no era de forma: el código compara contra «hallazgo» para saber si hay una
-- no conformidad —`gravedad_de`, el comentario que el auditado tiene que resolver, el
-- cierre—, así que esos cuatro eran no conformidades que el sistema no contaba como tales.
-- Pasan a «hallazgo», que es el mismo hecho sin la graduación que ya no existe. La
-- gravedad se recalcula sola, porque sale del estado del código y no de esta columna.
UPDATE auditoria_elementos SET hallazgo = 'hallazgo'
 WHERE hallazgo IN ('nc_menor', 'nc_mayor');
