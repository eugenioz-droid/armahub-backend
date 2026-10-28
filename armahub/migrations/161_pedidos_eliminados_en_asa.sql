-- LO QUE SE BORRÓ EN aSa DEJA DE SUMAR, PERO NO SE PIERDE (28-oct).
--
-- aSa borra un código de control y no queda rastro de que existió. Nuestro espejo nunca
-- sacaba lo que desaparecía, así que esos códigos seguían sumando kilos: medidos el
-- 28-oct, 7 códigos de 2026 por 70.529 kg —el mayor, SURI, 32 t de Lo Aguirre—.
--
-- El usuario lo pidió así: «déjalos como eliminados pero que no sumen kilos, así queda
-- registro, que es algo que aSa no tiene». Y con una condición que es la que manda el
-- diseño: «que en las distintas secciones de la plataforma no tengamos que llenarnos de
-- excepciones».
--
-- POR ESO UNA VISTA Y NO UNA COLUMNA MÁS. Hay 57 consultas a `asa_pedidos` repartidas en
-- siete módulos —programación, reclamos, auditorías, chequeos, constructoras…—. Agregar
-- «AND eliminado_el IS NULL» a cada una es garantizar que alguna se quede sin él, hoy o
-- dentro de seis meses, y que el kilo fantasma vuelva por esa rendija. Así que la tabla
-- pasa a llamarse `asa_pedidos_todos` y `asa_pedidos` queda como VISTA de lo vivo: las 57
-- consultas siguen escritas igual y ninguna puede olvidarse de filtrar. Quien quiera el
-- registro completo —el borrado incluido— pide `asa_pedidos_todos`, y tiene que decirlo.
--
-- OJO AL AGREGAR UNA COLUMNA: va en `asa_pedidos_todos` y hay que volver a crear la vista,
-- porque la lista de columnas queda fija al crearla. Lo mismo un índice: se crea sobre la
-- tabla, no sobre la vista.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'asa_pedidos' AND relkind = 'r') THEN
        ALTER TABLE asa_pedidos RENAME TO asa_pedidos_todos;
    END IF;
END $$;

ALTER TABLE asa_pedidos_todos ADD COLUMN IF NOT EXISTS eliminado_el TIMESTAMPTZ;

-- `security_invoker`: la vista se consulta con los permisos y las políticas de quien
-- pregunta, no con las del dueño. Sin esto una vista sobre una tabla con RLS sería una
-- puerta para saltarse el RLS de la tabla.
CREATE OR REPLACE VIEW asa_pedidos WITH (security_invoker = true) AS
    SELECT control_code, asa_job_id, job_name, descr, detail_person, order_date,
           promised_date, estado, kg, anio, visto_el, sync_id, proj_ship_date,
           proj_fab_date, ship_id, sched_estado, planta_vista_el, ultima_mod
      FROM asa_pedidos_todos
     WHERE eliminado_el IS NULL;

COMMENT ON VIEW asa_pedidos IS
    'Los pedidos VIVOS de aSa. Lo borrado en aSa queda en asa_pedidos_todos con '
    'eliminado_el, para que haya registro sin que sume kilos.';
