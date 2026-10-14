-- SE PARTE DE CERO PARA EL INICIO OFICIAL (14-oct)
--
-- El usuario: «te pediré limpiar las revisiones para poder hacer una revisión yo ahora y
-- que quede todo bien en una tanda, así le damos inicio oficial a esta herramienta».
--
-- Las dos revisiones que había eran de la puesta a punto, y cada una se hizo con reglas
-- distintas de las que quedaron: la #1 con los ganchos exentos del largo mínimo, las dos
-- con una señal por lado en vez de una por barra, y ninguna con el criterio de los lados
-- opuestos tal como quedó. Además se partieron en dos sin que nadie lo pidiera, por el
-- tope de 300 códigos por corrida: no son dos momentos de la obra, son una sola pasada
-- cortada al medio.
--
-- Nadie trabajó ninguna señal —las 324 están abiertas, sin declarar y sin nota—, así que
-- la corrida nueva no pierde nada y queda, por fin, una sola tanda con un solo criterio.
--
-- LA CONDICIÓN NO ES DECORATIVA: una señal con trabajo encima se queda en pie, acá y en
-- cualquier ambiente donde esto corra.
DELETE FROM chequeo_senales
 WHERE estado = 'abierta'
   AND declarada_por IS NULL
   AND NULLIF(TRIM(COALESCE(nota, '')), '') IS NULL;

DELETE FROM chequeo_revisiones r
 WHERE NOT EXISTS (SELECT 1 FROM chequeo_senales s WHERE s.revision_id = r.id);

-- Todos los códigos vuelven a la cola, para que la tanda sea completa y no la parte que
-- quedó pendiente de la anterior.
UPDATE chequeo_codigos SET ultima_mod = TIMESTAMPTZ '1900-01-01';

-- Y la numeración parte en #1: es lo que el usuario ve en pantalla.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM chequeo_revisiones) THEN
        ALTER SEQUENCE chequeo_revisiones_id_seq RESTART WITH 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM chequeo_senales) THEN
        ALTER SEQUENCE chequeo_senales_id_seq RESTART WITH 1;
    END IF;
END $$;
