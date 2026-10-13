-- LA OBRA MANDA EL JOB: reclamos.asa_job_id se deriva de la obra, en la base (13-oct)
--
-- Después de la homologación (143) cada obra tiene su job de aSa. El job que lleva un
-- reclamo ya no es un dato que alguien escribe: es el de su obra. Antes era un campo
-- suelto —los históricos lo traían de la planilla, los creados por pantalla no— y por eso
-- había 8 reclamos apuntando a la torre o a la obra equivocada.
--
-- VA EN UN TRIGGER Y NO EN EL ENDPOINT por tres razones: el PATCH de reclamos construye su
-- UPDATE campo por campo y meterle una regla más es donde se rompen cosas; los reclamos
-- también entran por importación de planilla; y una regla sobre el dato tiene que valer
-- para todas las puertas, no para la que uno se acordó de tocar.
--
-- Si la obra no tiene job (hoy sólo «Obra de Prueba»), el reclamo conserva el que traía.
CREATE OR REPLACE FUNCTION reclamo_job_desde_obra() RETURNS trigger AS $$
BEGIN
    IF NEW.id_proyecto IS NOT NULL THEN
        NEW.asa_job_id := COALESCE(
            (SELECT p.asa_job_id FROM proyectos p WHERE p.id_proyecto = NEW.id_proyecto),
            NEW.asa_job_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reclamo_job_desde_obra ON reclamos;
CREATE TRIGGER trg_reclamo_job_desde_obra
    BEFORE INSERT OR UPDATE OF id_proyecto ON reclamos
    FOR EACH ROW EXECUTE FUNCTION reclamo_job_desde_obra();
