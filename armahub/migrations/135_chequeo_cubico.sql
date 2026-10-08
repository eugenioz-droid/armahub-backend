-- QUIÉN CUBICÓ LA BARRA DE LA SEÑAL (8-oct)
--
-- Lo pidió el usuario para el reporte masivo: «que indique quien o quienes cubicó». Se
-- guarda EN LA SEÑAL y no se resuelve por join al mirarla, por una razón concreta: el
-- `detail_person` del pedido puede cambiar cuando una obra pasa de manos, y entonces un
-- reporte de hace dos meses se reescribiría solo y le atribuiría a otro algo que no hizo.
-- La señal es una foto de un momento, y quién cubicó es parte de esa foto.
--
-- Y QUE QUEDE CLARO PARA QUÉ ES. Es para saber a quién preguntarle, no para contar errores
-- por persona. Las señales las levanta una máquina y la mitad van a ser correctas: el día
-- que alguien las sume como indicador va a estar midiendo las reglas, no a la gente.
ALTER TABLE chequeo_senales ADD COLUMN IF NOT EXISTS cubico TEXT;

-- Las que ya están cargadas: se completan desde el espejo, que es de donde habrían salido.
UPDATE chequeo_senales s
   SET cubico = NULLIF(TRIM(p.detail_person), '')
  FROM asa_pedidos p
 WHERE p.control_code = s.cc AND s.cubico IS NULL;

CREATE INDEX IF NOT EXISTS ix_chequeo_cubico ON chequeo_senales (id_proyecto, cubico);
