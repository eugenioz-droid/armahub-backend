-- LOS CLIENTES TAMBIÉN VIENEN DE aSa (13-oct)
--
-- Igual que las obras: la caluga de Clientes deja de ser un lugar donde se crean clientes y
-- pasa a ser un VISUALIZADOR de lo que aSa sabe de cada cliente (sus obras, sus kilos, su
-- actividad) más los datos que sólo existen en ArmaHub (RUT, contacto, correo, notas).
-- Lo fijó el usuario: «dejar visible ahí toda la data que viene de aSa + data
-- complementaria que queramos agregar en la plataforma… y sacar la opción de crear».
--
-- EL CLIENTE DE aSa NO ES UNA LLAVE LIMPIA. Es un texto que alguien tipeó en aSa Studio, y
-- la misma empresa aparece con varias grafías: «ECHEVERRIA», «ECHEVERRIA IZQUIERDO»,
-- «ECHEVERRIA IZQUIERDO EDIFICACIONES»; «B BOSCH S.A» y «BBOSCH S.A»; «MAS ERRAZURIZ» y
-- «MASERRAZURIZ». Medido: 173 nombres distintos para bastantes menos empresas.
--
-- POR ESO `constructoras` NO DESAPARECE: es el normalizador. Una constructora de ArmaHub
-- es la empresa real, con sus datos complementarios, y puede tener VARIOS nombres en aSa.
-- Esta tabla es ese enlace, N nombres de aSa → 1 constructora. Se llena desde la ficha del
-- cliente («agregar datos de ArmaHub» crea la constructora si no existe; «es el mismo
-- cliente que…» junta grafías), nunca a mano.
CREATE TABLE IF NOT EXISTS constructora_alias (
    nombre_asa      TEXT PRIMARY KEY,                       -- tal cual viene en asa_obras.cliente
    constructora_id INTEGER NOT NULL REFERENCES constructoras(id) ON DELETE CASCADE,
    creado_por      TEXT,
    fecha           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_constructora_alias_cid ON constructora_alias (constructora_id);

-- LA SEMILLA SALE DE LA EVIDENCIA, NO DE ADIVINAR NOMBRES. Las 9 constructoras que existen
-- ya tienen obras asignadas, y esas obras ya están enlazadas a su job de aSa (143): el
-- cliente que aSa le pone a esas obras ES la grafía de esa constructora. Un cruce por
-- parecido de nombre («CRCC Chile» ~ «CHINA RAILWAY…») sería inventar; esto no.
INSERT INTO constructora_alias (nombre_asa, constructora_id, creado_por)
SELECT DISTINCT TRIM(o.cliente), p.constructora_id, 'migracion-145'
  FROM proyectos p
  JOIN asa_obras o ON o.asa_job_id = p.asa_job_id
 WHERE p.constructora_id IS NOT NULL
   AND o.cliente IS NOT NULL AND TRIM(o.cliente) <> ''
ON CONFLICT (nombre_asa) DO NOTHING;

-- Y LA CONSTRUCTORA DE UNA OBRA SE DERIVA DE SU JOB. Las obras que no tenían constructora
-- la reciben si el cliente de su job ya tiene alias. Sólo rellena vacíos: lo que alguien
-- asignó a mano no se pisa.
UPDATE proyectos p SET constructora_id = a.constructora_id
  FROM asa_obras o
  JOIN constructora_alias a ON a.nombre_asa = TRIM(o.cliente)
 WHERE o.asa_job_id = p.asa_job_id
   AND p.constructora_id IS NULL;
