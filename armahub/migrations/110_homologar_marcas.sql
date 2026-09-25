-- 110 — HOMOLOGAR LAS MARCAS CON EL CATÁLOGO (25-sep).
--
-- QUÉ PROBLEMA RESUELVE. El CSV de ArmaDetailer traía la tipología en MAYÚSCULAS
-- (F'S, F'I, FI, FS, CBSN, CBIN, RP) y el catálogo la escribe como se usa en obra
-- (F's, F'i, Fi, Fs, CBSn, CBIn, Rp). O sea, dos escrituras del MISMO código
-- conviviendo en `barras`: 2.990 filas al momento de escribir esto, TODAS de losa,
-- fundación y viga — ninguna de muro, que es por lo que nunca se notó.
--
-- Por qué importa: cualquier filtro, agrupación o KPI que compare texto exacto las
-- trata como tipologías DISTINTAS. Los subtabs de tipología del editor de despieces
-- comparan contra el código del catálogo, así que esas barras no aparecían en el
-- subtab que les corresponde.
--
-- QUÉ HACE. Sólo corrige mayúsculas/minúsculas de un código que YA EXISTE en el
-- catálogo. No inventa nada: una marca que el catálogo no conoce se deja intacta.
-- Se deriva de `tipologias_catalogo` en vez de listar los siete casos, para que el
-- día que aparezca otro desajuste igual quede cubierto.
--
-- EL HAVING ES EL CANDADO. Si dos tipologías del catálogo se escribieran igual salvo
-- por las mayúsculas, no habría forma de saber a cuál corresponde una marca: esa
-- clave se queda fuera y no se toca ninguna barra suya. Hoy no hay ninguna así.
--
-- NO TOCA NADA MÁS: ni pesos, ni medidas, ni figuras, ni la ubicación. Sólo la
-- escritura de un texto. Es idempotente — correrla de nuevo actualiza 0 filas.
--
-- EL ORIGEN VA APARTE. Esta migración limpia el histórico UNA vez; que no vuelva a
-- ensuciarse lo resuelve la importación, que aplica esta misma regla a las barras
-- que acaba de cargar (catalogo.homologar_marcas, llamada desde importer.py). Sin
-- esa mitad, la próxima carga de CSV reintroduce el problema.

UPDATE barras b
   SET marca = m.codigo
  FROM (SELECT UPPER(codigo) AS clave, MIN(codigo) AS codigo
          FROM tipologias_catalogo
         GROUP BY UPPER(codigo)
        HAVING COUNT(DISTINCT codigo) = 1) m
 WHERE UPPER(TRIM(b.marca)) = m.clave
   AND b.marca IS DISTINCT FROM m.codigo;

-- Las lápidas de despieces eliminados llevan la misma columna y se leen igual en el
-- histórico: si no se homologan, el problema sobrevive ahí.
UPDATE barras_eliminadas b
   SET marca = m.codigo
  FROM (SELECT UPPER(codigo) AS clave, MIN(codigo) AS codigo
          FROM tipologias_catalogo
         GROUP BY UPPER(codigo)
        HAVING COUNT(DISTINCT codigo) = 1) m
 WHERE UPPER(TRIM(b.marca)) = m.clave
   AND b.marca IS DISTINCT FROM m.codigo;
