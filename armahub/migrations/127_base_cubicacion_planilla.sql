-- Base de cubicación desde la planilla de calidad: toneladas por año, cubicador y obra, para los años en que aSa no estaba completo (2022)
-- aSa partió en marzo de 2022 y recién en agosto tomó volumen: del 2022 tiene 3.092 ton
-- contra las 29.931 que la planilla de calidad («Analisis Errores Acumulado al 2025»,
-- hoja «Consolidado al 2025») registra por cubicador y obra. Esa planilla es la base del
-- tablero de indicadores para 2022; para 2023 en adelante sigue mandando aSa (coinciden
-- dentro del 10%). Se carga con scripts/importar_base_cubicacion.py.
CREATE TABLE IF NOT EXISTS base_cubicacion_planilla (
    anio         INTEGER     NOT NULL,
    cubicador    TEXT        NOT NULL,   -- con el mismo nombre que usa el tablero (ASA_PERSONA / reclamos)
    servicio     TEXT,                   -- Interno / Externo, como lo dice la planilla
    obra         TEXT        NOT NULL,   -- el nombre tal cual en la planilla
    asa_job_id   TEXT,                   -- la obra en aSa, si el nombre calzó
    segmento     TEXT,                   -- de aSa si calzó; si no, «4 y 5» cuando la planilla dice Edificación
    kg           NUMERIC     NOT NULL DEFAULT 0,
    fuente       TEXT,                   -- archivo y hoja de donde salió
    importado_el TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (anio, cubicador, obra)
);
