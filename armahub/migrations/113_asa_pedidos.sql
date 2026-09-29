-- 113 — ESPEJO DE PEDIDOS DE aSa, agregados por código de control (28-sep).
--
-- QUÉ REEMPLAZA. Un reporte de Power BI que el usuario mantiene a mano: dos tablas,
-- «CUBICACIÓN EN ASA POR PROGRAMAR» y «PROGRAMADOS», con filtros por año, mes, obra y
-- cubicador. Aquí vive la data que las alimenta.
--
-- EL GRANO IMPORTA, Y NO ES EL DE aSa.
-- `getOrderSummary` viene agrupado por CC × diámetro × producto × unidad: sólo 2026 son
-- más de 12.000 filas, y pedirlas todas es exactamente lo que atora a aSa (el usuario lo
-- vive en Power BI: "se queda pegado y hay que repetir"). Con `$apply` de OData el motor
-- de aSa agrupa por código de control y devuelve 5.191 filas en 5 segundos. Esta tabla
-- guarda ESE grano: UNA FILA POR CÓDIGO DE CONTROL.
--
-- CÓMO SE PARTEN LAS DOS TABLAS DEL REPORTE.
-- No hay un campo "programado" en aSa. Lo que hay es `PromisedDeliveryDate`: si el pedido
-- tiene fecha comprometida, está PROGRAMADO; si no, está POR PROGRAMAR. En 2026 son 4.577
-- y 614 respectivamente, que es la misma división que muestra el reporte de BI. Por eso
-- `promised_date` acepta NULL y ese NULL significa algo — no es un dato faltante.

CREATE TABLE IF NOT EXISTS asa_pedidos (
    control_code  TEXT PRIMARY KEY,          -- ControlCode: el CC
    asa_job_id    TEXT,                      -- JobID → enlaza con asa_obras y proyectos
    job_name      TEXT NOT NULL DEFAULT '',  -- JobName
    -- En aSa NO existen los sectores constructivos: se escriben a mano en la descripción
    -- del pedido ("ELEV S1 C7", "FUND C12"). Por eso este campo, que parece decorativo,
    -- es la única llave de cruce con las tareas de ArmaHub.
    descr         TEXT,
    detail_person TEXT,                      -- DetailPerson: quién lo cubicó en aSa
    order_date    DATE,
    promised_date DATE,                      -- NULL = por programar (ver arriba)
    estado        TEXT,                      -- Status
    kg            NUMERIC(14,2) NOT NULL DEFAULT 0,
    anio          INTEGER,                   -- año de order_date, para filtrar barato
    visto_el      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sync_id       BIGINT
);

-- El reporte filtra por año+mes y agrupa por obra y por cubicador. Sin estos índices, con
-- 5.000 filas por año da igual; con cinco años de historia, no.
CREATE INDEX IF NOT EXISTS idx_asa_pedidos_anio     ON asa_pedidos (anio);
CREATE INDEX IF NOT EXISTS idx_asa_pedidos_promised ON asa_pedidos (promised_date);
CREATE INDEX IF NOT EXISTS idx_asa_pedidos_persona  ON asa_pedidos (detail_person);
CREATE INDEX IF NOT EXISTS idx_asa_pedidos_job      ON asa_pedidos (asa_job_id);
