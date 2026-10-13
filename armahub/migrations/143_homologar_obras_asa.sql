-- HOMOLOGACIÓN DE OBRAS: UNA OBRA, LA DE aSa (13-oct)
--
-- EL PROBLEMA. ArmaHub tenía 37 obras creadas a mano (`PROY-…`) y aSa 648 jobs, y nada
-- los unía: `proyectos.asa_job_id` existía y estaba vacío en las 37. Cuatro tablas
-- guardaban jobs de aSa dentro de `id_proyecto` (chequeos, auditorías de aSa), los
-- reclamos históricos traían el job y los nuevos no, y para colgar un reclamo de una obra
-- de aSa había que crearla a mano. Dos estándares de obra.
--
-- LA DECISIÓN (usuario, 13-oct): de aquí en adelante los cubicadores ven las obras COMO
-- ESTÁN EN aSa. Lo que ya existe queda como legacy ENLAZADO; lo nuevo entra desde el
-- espejo de aSa y nunca más a mano.
--
-- POR QUÉ ENLAZAR Y NO RENOMBRAR `id_proyecto`: de él cuelgan 26.094 barras, 641 reclamos
-- y 11 tablas más (6 con FK). El id de aSa no es una identidad limpia de obra ni dentro
-- de aSa (una obra son dos jobs: principal y «- BARRAS»; hay ids con punto, con guion, y
-- gemelos irregulares como 2011268 / 1001549B), y tres obras de ArmaHub son UN job (San
-- Pablo). El enlace deja las dos llaves en la misma fila; renombrar después, con el
-- mapeo probado en producción, es una migración mecánica si se quiere.
--
-- LA TABLA DE ABAJO SE LEVANTÓ CRUZANDO TRES COSAS: el nombre, los kilos y fechas de cada
-- job, y —lo decisivo— el job que traen los RECLAMOS históricos de cada obra. Las dudas
-- las resolvió el usuario: San Pablo ×3 → un job; Torre A = 2011447 y Torre B = 2011149
-- (sus 6 reclamos apuntaban a la torre equivocada); Collahuasi → la obra viva (2012799);
-- Macul Coipue estaba duplicada en ArmaHub → se fusiona; Obra de Prueba no se homologa.

-- ── 1. Esquema ───────────────────────────────────────────────────────────────────

-- VARIAS OBRAS DE ArmaHub PUEDEN SER UN JOB (los frentes de San Pablo). El índice era
-- único y lo impedía.
DROP INDEX IF EXISTS ux_proyectos_asa_job;
CREATE INDEX IF NOT EXISTS ix_proyectos_asa_job ON proyectos (asa_job_id) WHERE asa_job_id IS NOT NULL;

-- EXISTIR COMO OBRA ≠ APARECER EN CUBICACIONES. Un reclamo puede colgar de cualquier obra
-- de aSa (se adopta sola al guardarlo), pero la caluga de Cubicaciones muestra sólo las
-- que se cubican acá. Se marca al agregarla desde esa caluga, y se enciende sola cuando
-- la obra recibe barras.
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS en_cubicacion BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE proyectos p SET en_cubicacion = TRUE
 WHERE NOT en_cubicacion
   AND (EXISTS (SELECT 1 FROM barras b WHERE b.id_proyecto = p.id_proyecto)
     OR EXISTS (SELECT 1 FROM lotes l WHERE l.id_proyecto = p.id_proyecto));

-- OBRAS DE aSa QUE NO SON OBRAS. «Obra de Prueba», «Cotizaciones», «NO USAR»… existen en
-- aSa y van a seguir existiendo, pero no pueden sumar kilos ni aparecer en ningún
-- selector. Es una marca en el espejo, no una lista en el código: el sync la respeta
-- (su upsert sólo toca las columnas que trae de aSa) y se puede corregir sin desplegar.
-- Se precargan las evidentes; «TERRATEST» NO está aunque contenga «test»: es un cliente.
ALTER TABLE asa_obras ADD COLUMN IF NOT EXISTS excluida BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE asa_obras SET excluida = TRUE
 WHERE asa_job_id IN ('200002', 'ObradePrueba', '00004', '2010159MALO', '24-00081', '1000128',
                      '25-00101', '22-00010', '22-00012', 'DOVELA A2', '00005', '22-00009', '1234567');

-- ── 2. La homologación: cada obra de ArmaHub → su job principal de aSa ─────────────
-- Sólo se escribe donde el enlace está vacío y el job existe en el espejo: correr esto
-- dos veces no cambia nada, y un job que no esté en aSa no se inventa.
UPDATE proyectos p SET asa_job_id = m.job
  FROM (VALUES
    ('PROY-5B33746D',      '2007889'),   -- CRCC - Hospital de Coquimbo
    ('PROY-2461083.6298',  '2010159'),   -- CRCC - Hospital de Illapel
    ('PROY-CD155BA6',      '2011706'),   -- CRCC - Hospital de Pichilemu
    ('PROY-2461109.4194',  '2011374'),   -- CYPCO - Edificio Z UDD
    ('PROY-673F4AB9',      '2011951'),   -- DEL MAR - Edificio Distrito Verde 5
    ('PROY-588FEC0C',      '2012187'),   -- DESCO - Edificio Llewellyn Jones
    ('PROY-DB91C0B0',      '2011235'),   -- Desco - Edificio Marin
    ('PROY-7848600C',      '2011872'),   -- DLP - CD ACHS Quilicura
    ('PROY-7C7EBCCA',      '2011269'),   -- DLP - Edificio Norte U Andes
    ('PROY-D47634AE',      '2011268'),   -- DLP - Edificio Talca 2 Sur (gemelo 1001549B)
    ('PROY-D5294C56',      '2012551'),   -- EBCO - Edificio Plaza Matilde
    ('PROY-6DF5A455',      '2012279'),   -- EBCO - NuMu
    ('PROY-A30DDFEB',      '2012822'),   -- EI - Ampliación Mall Plaza El Trébol
    ('PROY-9000C3A5',      '2012589'),   -- EI - Edificio La Pastora
    ('PROY-E84CFAAE',      '2010136'),   -- EI - Edificio Metropolis
    ('PROY-32653201',      '2012799'),   -- EI Montajes - Collahuasi Molibdeno → la obra VIVA (decisión)
    ('PROY-BA0B51EB',      '2013080'),   -- Euro - Edificio Zañartu (NO la de Santolaya, 2012575)
    ('PROY-DC9C4CBB',      '2012732'),   -- Euro - San Pablo - Basílica   ┐
    ('PROY-9F62310A',      '2012732'),   -- Euro - San Pablo - Lourdes    ├ tres frentes, UN job
    ('PROY-3CF9599A',      '2012732'),   -- Euro - San Pablo - San Pablo  ┘
    ('PROY-BF120F2B',      '2012786'),   -- Gesvial - Puente Lo Saldes
    ('PROY-05F8E3A2',      '2012451'),   -- Hospital Curacautin (MOLLER)
    ('PROY-650CFB1C',      '2012561'),   -- Inarco - Universidad Santo Tomas
    ('PROY-E0D62DF1',      '2011171'),   -- Inarco Tecsa - Novofarma
    ('PROY-2461041.3753',  '2010879'),   -- Ingevec - Franklin
    ('PROY-97E1CAC7',      '2012972'),   -- OHL - Metro L7 Vespucio (= Estación Vespucio)
    ('PROY-66FC6047',      '2012825'),   -- PLAENGE - Edificio Explora
    ('PROY-77877032',      '2011447'),   -- RVC - Francisco Zelada Torre A
    ('PROY-F658B960',      '2011149'),   -- RVC - Francisco Zelada Torre B
    ('PROY-137A491C',      '2008391'),   -- Sack - Bravo Izquierdo UNAB
    ('PROY-B5579851',      '2012930'),   -- SANTOLAYA - Casa La Fuente
    ('PROY-2461137.6285',  '2012313'),   -- SANTOLAYA - Edificio Martin de Solier
    ('PROY-B0740545',      '2010925'),   -- SANTOLAYA - Edificio Vicuña San Joaquín
    ('PROY-C299A26D',      '2009604'),   -- SANTOLAYA - Fuenzalida Urrejola
    ('PROY-C85E361C',      '2011117')    -- SANTOLAYA - Macul Coipue (la que tiene los reclamos)
  ) AS m(id, job)
 WHERE p.id_proyecto = m.id
   AND p.asa_job_id IS NULL
   AND EXISTS (SELECT 1 FROM asa_obras o WHERE o.asa_job_id = m.job);
-- «Obra de Prueba» (PROY-A192D913) queda SIN enlace a propósito: no es una obra.

-- ── 3. Macul Coipue estaba dos veces en ArmaHub: queda una ──────────────────────────
-- PROY-9DF0214E (vacía: 0 barras, 0 reclamos, 1 usuario) se fusiona en PROY-C85E361C (la
-- que tiene los 6 reclamos). El usuario se traslada si no estaba; el id viejo queda como
-- alias para que un CSV que lo traiga caiga en la obra correcta.
INSERT INTO proyecto_usuarios (id_proyecto, user_id, rol)
SELECT 'PROY-C85E361C', pu.user_id, pu.rol FROM proyecto_usuarios pu
 WHERE pu.id_proyecto = 'PROY-9DF0214E'
   AND NOT EXISTS (SELECT 1 FROM proyecto_usuarios q
                    WHERE q.id_proyecto = 'PROY-C85E361C' AND q.user_id = pu.user_id);
DELETE FROM proyecto_usuarios WHERE id_proyecto = 'PROY-9DF0214E';
DELETE FROM export_log        WHERE id_proyecto = 'PROY-9DF0214E';
DELETE FROM sector_estado     WHERE id_proyecto = 'PROY-9DF0214E';
DELETE FROM imports           WHERE id_proyecto = 'PROY-9DF0214E';
DELETE FROM obra_config       WHERE id_proyecto = 'PROY-9DF0214E';
DELETE FROM tareas_programacion WHERE id_proyecto = 'PROY-9DF0214E';
INSERT INTO proyecto_aliases (alias, id_proyecto, creado_por, fecha)
SELECT 'PROY-9DF0214E', 'PROY-C85E361C', 'migracion-143', now()::text
 WHERE EXISTS (SELECT 1 FROM proyectos WHERE id_proyecto = 'PROY-9DF0214E')
   AND NOT EXISTS (SELECT 1 FROM proyecto_aliases WHERE alias = 'PROY-9DF0214E');
DELETE FROM proyectos WHERE id_proyecto = 'PROY-9DF0214E';

-- ── 4. Los reclamos que apuntaban al job equivocado, y los que no traían ninguno ────
-- Torre B: sus 6 reclamos traían el job de Torre A.
UPDATE reclamos SET asa_job_id = '2011149'
 WHERE id_proyecto = 'PROY-F658B960' AND asa_job_id = '2011447';
-- Collahuasi: sus 2 reclamos traían la obra terminada (2010189) y hablan de la viva.
UPDATE reclamos SET asa_job_id = '2012799'
 WHERE id_proyecto = 'PROY-32653201' AND asa_job_id = '2010189';
-- Los que no traían job (los cargados por pantalla) lo heredan de su obra.
UPDATE reclamos r SET asa_job_id = p.asa_job_id
  FROM proyectos p
 WHERE p.id_proyecto = r.id_proyecto AND r.asa_job_id IS NULL AND p.asa_job_id IS NOT NULL;

-- ── 5. Las dos obras que hacían falta, traídas del espejo (no creadas a mano) ────────
-- El id de la obra ES el job de aSa: así nace toda obra de aquí en adelante.
INSERT INTO proyectos (id_proyecto, nombre_proyecto, asa_job_id, origen, en_cubicacion, usuario_creador)
SELECT o.asa_job_id, o.nombre, o.asa_job_id, 'asa', FALSE, 'migracion-143'
  FROM asa_obras o
 WHERE o.asa_job_id IN ('2013218', '2012973')          -- PL - EDIFICIO OPERA · OHL - ESTACION PARQUE ARAUCANO
   AND NOT EXISTS (SELECT 1 FROM proyectos p WHERE p.id_proyecto = o.asa_job_id);
UPDATE reclamos SET id_proyecto = '2013218', asa_job_id = '2013218'
 WHERE anio_calidad = 2026 AND numero_calidad = 124 AND NOT historico AND id_proyecto IS NULL
   AND EXISTS (SELECT 1 FROM proyectos WHERE id_proyecto = '2013218');
UPDATE reclamos SET id_proyecto = '2012973', asa_job_id = '2012973'
 WHERE anio_calidad = 2026 AND numero_calidad = 128 AND NOT historico AND id_proyecto IS NULL
   AND EXISTS (SELECT 1 FROM proyectos WHERE id_proyecto = '2012973');
