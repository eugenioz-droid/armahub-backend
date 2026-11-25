-- 183: ArmaScanner pide por ciclo: la versión «en revisión» sin terminar y la traza de lo enviado de cada grupo (25-nov-2026)
--
-- ArmaScanner sube la versión actual de un plano SIN terminarlo («Subir a ArmaHub»): queda como la entrega del
-- plano en etapa 'en_revision', con el estado de cada ciclo (grupos: {"C1": {barras, kg, completo, huella}}),
-- para pedir cada ciclo completo sin esperar el plano entero (aSa se sube por ciclo completo). «Terminar»
-- deja la entrega en 'terminado', como siempre.
-- planos_obra_grupos: lo enviado de cada grupo, con su historial (una fila por envío). «grupo» es genérico:
-- el ciclo en losas («C1»); en elevaciones será el eje. filas = lo enviado barra por barra (las filas del CSV
-- de A Detailer de ese grupo), para mostrar qué cambió antes de reenviar.
-- [Usuario 25-nov: «podemos permitir subir barras validadas siempre y cuando todas las asignadas a ese ciclo
-- estén ok»; «lo importante es que haya trazabilidad y si se edita algo subido, se pueda manejar bien»]
ALTER TABLE planos_obra_entregas ADD COLUMN IF NOT EXISTS etapa TEXT NOT NULL DEFAULT 'terminado';
ALTER TABLE planos_obra_entregas ADD COLUMN IF NOT EXISTS grupos JSONB;
CREATE TABLE IF NOT EXISTS planos_obra_grupos (
    id           SERIAL PRIMARY KEY,
    id_proyecto  TEXT NOT NULL,
    plano        TEXT NOT NULL,
    grupo        TEXT NOT NULL,
    version      INTEGER NOT NULL,
    huella       TEXT,
    barras       INTEGER,
    kg           NUMERIC,
    filas        JSONB,
    import_id    INTEGER,
    enviado_por  TEXT,
    enviado_el   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS planos_obra_grupos_plano ON planos_obra_grupos (id_proyecto, plano, grupo, id);
