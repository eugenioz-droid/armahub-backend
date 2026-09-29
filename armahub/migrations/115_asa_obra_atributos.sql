-- 115 — ATRIBUTOS DE OBRA que aSa no tiene (29-sep).
--
-- POR QUÉ. Los cubicadores necesitan catalogar cada obra en dos ejes que no existen en
-- aSa: si es de CUBICACIÓN o de DIGITACIÓN, y a qué SEGMENTO pertenece (1&2, 4&5 u
-- YPS). Se miró antes si aSa ya lo traía: `getJobData` expone cinco custom fields por
-- obra (USC, Correo_USC, Calculista, Ton_Proyecto, Tipo_Obra) y ninguno es esto.
--
-- TABLA APARTE, no columnas en `asa_obras`: el espejo se reescribe con cada sincronización
-- y un dato que escribe una persona no puede vivir en una tabla que se pisa sola. La
-- clave es el job de aSa, que es el que viaja en cada pedido, así que cruzarla contra el
-- reporte es un LEFT JOIN y nada más.
--
-- Los valores permitidos viven en `programacion.py` (TIPOS_OBRA, SEGMENTOS_OBRA), que es
-- quien valida: acá se guarda el texto tal como se muestra.

CREATE TABLE IF NOT EXISTS asa_obra_atributos (
    asa_job_id   TEXT PRIMARY KEY,                 -- JobID de aSa (2012279, a veces con letra)
    tipo         TEXT,                             -- Cubicación | Digitación
    segmento     TEXT,                             -- 1 y 2 | 4 y 5 | YPS
    editado_por  TEXT,                             -- quién lo tocó por última vez
    editado_el   TIMESTAMPTZ NOT NULL DEFAULT now()
);
