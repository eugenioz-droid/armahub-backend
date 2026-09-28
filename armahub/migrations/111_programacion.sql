-- 111 — PROGRAMACIÓN DE CUBICACIONES (28-sep).
--
-- QUÉ REEMPLAZA. Hoy la programación del área vive en una planilla Excel: cada USC arma la
-- suya, un cubicador junta las cinco cada semana a mano y copia de aSa lo cubicado. La
-- consolidación no se automatiza — con esta tabla deja de existir, porque los cinco escriben
-- en el mismo lugar.
--
-- QUÉ ES UNA TAREA. Un SECTOR CONSTRUCTIVO de una obra: obra · sector · piso · ciclo. Es la
-- misma clave que ya usa `sector_estado`, así que las tareas NO se teclean: se derivan de los
-- frentes que ArmaHub ya conoce (ver _sincronizar_desde_sector_estado en programacion.py).
-- Las obras de infraestructura, que no tienen estos sectores, llevan un frente de nombre
-- propio: sector='LIBRE' y el nombre en `ciclo`, para que la clave única siga sirviendo.
--
-- LAS DOS FECHAS. El USC escribe la de DESPACHO, que es la que maneja y la que no puede
-- disfrazar; la de CUBICACIÓN se calcula 10 días hábiles antes y es la que manda para el
-- programa semanal. Se guardan las dos: la derivada también, porque es por la que se consulta
-- y porque el día que cambie la regla de los 10 días no se puede reescribir el pasado.
--
-- PLAZO CORTO. Si al programar quedan menos de 7 días hábiles hasta la cubicación, la tarea
-- entra IGUAL —el área atiende— pero queda marcada. No es un castigo al cubicador: es la
-- única medida que hoy no existe de cómo se está planificando. `plazo_corto` se congela al
-- programar, no se recalcula: lo que importa es con cuánta anticipación se PIDIÓ.

CREATE TABLE IF NOT EXISTS tareas_programacion (
  id                BIGSERIAL PRIMARY KEY,
  id_proyecto       TEXT NOT NULL,
  sector            TEXT NOT NULL DEFAULT '',
  piso              TEXT NOT NULL DEFAULT '',
  ciclo             TEXT NOT NULL DEFAULT '',
  estado            TEXT NOT NULL DEFAULT 'disponible',   -- disponible | programada | cubicada
  fecha_despacho    DATE,
  fecha_cubicacion  DATE,
  ton_estimadas     NUMERIC,
  cubicador_email   TEXT,
  plazo_corto       BOOLEAN NOT NULL DEFAULT FALSE,
  programado_por    TEXT,
  programado_fecha  TEXT,
  cubicada_fecha    TEXT,
  creado_por        TEXT,
  creado_fecha      TEXT,
  editado_por       TEXT,
  editado_fecha     TEXT
);

-- La clave natural del frente. Es la MISMA de sector_estado (ux_sector_estado_clave), para que
-- una tarea y su frente sean la misma cosa y la sincronización pueda hacer UPSERT sin duplicar.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tareas_prog_clave
  ON tareas_programacion (id_proyecto, sector, piso, ciclo);

-- El tablero se consulta por semana y por cubicador; la cola del USC, por obra y estado.
CREATE INDEX IF NOT EXISTS ix_tareas_prog_cubicacion ON tareas_programacion (fecha_cubicacion);
CREATE INDEX IF NOT EXISTS ix_tareas_prog_obra ON tareas_programacion (id_proyecto, estado);
CREATE INDEX IF NOT EXISTS ix_tareas_prog_cubicador ON tareas_programacion (cubicador_email, fecha_cubicacion);
