-- LOS FERIADOS, PARA QUE LOS PLAZOS NO CORRAN EN ELLOS (9-oct)
--
-- Lo pidió el usuario al fijar el plazo de 24 horas: «son días hábiles. Si hay un feriado
-- no debería correr». Hasta acá no existía ningún calendario en la plataforma: tanto
-- Programación como Auditorías decían «sin feriados por ahora» en un comentario.
--
-- POR QUÉ UNA TABLA Y NO UNA LISTA EN EL CÓDIGO. Dos de los feriados chilenos se mueven
-- cada año (Semana Santa sigue a la Pascua) y otros tres se trasladan por ley según el día
-- en que caen. Una lista escrita en Python envejece en silencio: el año que alguien no la
-- actualice, los plazos simplemente empiezan a correr mal y nadie se entera. En una tabla
-- se ve lo que hay, se corrige sin tocar código y se puede cargar el año siguiente.
CREATE TABLE IF NOT EXISTS feriados (
    fecha   DATE PRIMARY KEY,
    nombre  TEXT NOT NULL,
    -- Para cuando haga falta distinguirlos (los irrenunciables cierran el comercio, no
    -- necesariamente la planta). Hoy el cálculo no lo usa: un feriado es un feriado.
    irrenunciable BOOLEAN NOT NULL DEFAULT FALSE,
    nota    TEXT
);

-- 2026 y 2027. Las fechas de Semana Santa están CALCULADAS con el algoritmo de la Pascua,
-- no escritas de memoria: Pascua 2026 = 5 de abril, Pascua 2027 = 28 de marzo.
--
-- OJO CON 2027, y queda dicho acá para que no se pase: el 29 de junio y el 12 de octubre
-- caen MARTES, y la ley los traslada al lunes. Se cargan en su fecha nominal porque la
-- regla exacta del traslado hay que confirmarla; cuando se confirme, se corrige la fila y
-- listo. En 2026 los dos caen lunes, así que no hay nada que trasladar.
INSERT INTO feriados (fecha, nombre, irrenunciable, nota) VALUES
    ('2026-01-01', 'Año Nuevo', TRUE, NULL),
    ('2026-04-03', 'Viernes Santo', FALSE, NULL),
    ('2026-04-04', 'Sábado Santo', FALSE, NULL),
    ('2026-05-01', 'Día del Trabajo', TRUE, NULL),
    ('2026-05-21', 'Glorias Navales', FALSE, NULL),
    ('2026-06-21', 'Día de los Pueblos Indígenas', FALSE, 'Solsticio; confirmar la fecha cada año'),
    ('2026-06-29', 'San Pedro y San Pablo', FALSE, 'Cae lunes: sin traslado'),
    ('2026-07-16', 'Virgen del Carmen', FALSE, NULL),
    ('2026-08-15', 'Asunción de la Virgen', FALSE, NULL),
    ('2026-09-18', 'Independencia Nacional', TRUE, NULL),
    ('2026-09-19', 'Glorias del Ejército', TRUE, NULL),
    ('2026-10-12', 'Encuentro de Dos Mundos', FALSE, 'Cae lunes: sin traslado'),
    ('2026-10-31', 'Día de las Iglesias Evangélicas', FALSE, NULL),
    ('2026-11-01', 'Día de Todos los Santos', FALSE, NULL),
    ('2026-12-08', 'Inmaculada Concepción', FALSE, NULL),
    ('2026-12-25', 'Navidad', TRUE, NULL),
    ('2027-01-01', 'Año Nuevo', TRUE, NULL),
    ('2027-03-26', 'Viernes Santo', FALSE, NULL),
    ('2027-03-27', 'Sábado Santo', FALSE, NULL),
    ('2027-05-01', 'Día del Trabajo', TRUE, NULL),
    ('2027-05-21', 'Glorias Navales', FALSE, NULL),
    ('2027-06-21', 'Día de los Pueblos Indígenas', FALSE, 'Solsticio; confirmar la fecha cada año'),
    ('2027-06-29', 'San Pedro y San Pablo', FALSE, 'Cae MARTES: la ley lo traslada al lunes. Confirmar.'),
    ('2027-07-16', 'Virgen del Carmen', FALSE, NULL),
    ('2027-08-15', 'Asunción de la Virgen', FALSE, NULL),
    ('2027-09-18', 'Independencia Nacional', TRUE, NULL),
    ('2027-09-19', 'Glorias del Ejército', TRUE, NULL),
    ('2027-10-12', 'Encuentro de Dos Mundos', FALSE, 'Cae MARTES: la ley lo traslada al lunes. Confirmar.'),
    ('2027-10-31', 'Día de las Iglesias Evangélicas', FALSE, NULL),
    ('2027-11-01', 'Día de Todos los Santos', FALSE, NULL),
    ('2027-12-08', 'Inmaculada Concepción', FALSE, NULL),
    ('2027-12-25', 'Navidad', TRUE, NULL)
ON CONFLICT (fecha) DO NOTHING;
