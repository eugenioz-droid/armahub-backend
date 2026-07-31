-- 6-config: Configuración de obra del creador de barras. Config POR OBRA (una fila
-- por proyecto). Modelo clave: es una PLANTILLA de opciones (pisos/ciclos que el usuario
-- deja listos para elegir al crear barras), NO una lista autoritativa. La verdad de "lo
-- que existe" sigue siendo las barras (SELECT DISTINCT piso/ciclo/eje); la plantilla solo
-- sugiere opciones para el desplegable.
--
-- Aditiva e idempotente (patrón CREATE TABLE IF NOT EXISTS de la migración 088). NO toca
-- barras ni proyectos. factor_peso NO va aquí: ya vive en proyectos (migración 089); este
-- panel lo lee/escribe allá.
--
-- pisos_plantilla / ciclos_plantilla: arrays JSONB de strings, ORDEN significativo (el
-- orden en que el usuario los dejó). factor_extremo (× diámetro) y largo_intermedio son
-- los defaults del creador de barras; se prellenan pero la barra puede sobrescribirlos.
CREATE TABLE IF NOT EXISTS obra_config (
    id_proyecto       TEXT PRIMARY KEY,
    pisos_plantilla   JSONB DEFAULT '[]',
    ciclos_plantilla  JSONB DEFAULT '[]',
    factor_extremo    DOUBLE PRECISION DEFAULT 10,
    largo_intermedio  DOUBLE PRECISION DEFAULT 100,
    actualizado_por   TEXT,
    actualizado_fecha TEXT
);
