-- El hallazgo deja de graduarse a ojo: «NC menor/mayor» pasa a ser un solo «hallazgo»
-- «NC mayor o menor es subjetiva», y es cierto: dos auditores gradúan distinto el mismo
-- defecto. La gravedad REAL ya es un dato que el sistema tiene —si el código alcanzó a
-- despacharse o no— así que el auditor declara un hecho verificable (está conforme, hay
-- una observación, o hay un hallazgo) y el peso lo calcula el sistema.
--
-- No se pierde nada: lo que era «NC menor» y «NC mayor» queda como «hallazgo» con su
-- texto, su causa, quién revisó y su acción intactos. Sólo cambia la etiqueta.
UPDATE auditoria_elementos SET hallazgo = 'hallazgo'
 WHERE hallazgo IN ('nc_menor', 'nc_mayor');
