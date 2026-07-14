"""
db.py
-----
Capa de base de datos (Postgres-only).

Responsabilidades:
- Leer DATABASE_URL desde environment (Render)
- Entregar conexiones psycopg (context manager)
- Crear tablas e índices (init_db)

Nota:
- Esto NO usa SQLite.
- Esto NO borra datos. Solo crea si no existe.
"""

import os
import logging
import time
from contextlib import contextmanager

import psycopg

_pool = None
logger = logging.getLogger(__name__)


def get_database_url() -> str:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("Falta DATABASE_URL. Este backend es Postgres-only.")
    # Render a veces entrega postgres://; psycopg espera postgresql://
    if db_url.startswith("postgres://"):
        db_url = "postgresql://" + db_url[len("postgres://") :]
    return db_url


def _get_pool():
    """Lazy-init del pool de conexiones. Min 2, max 10."""
    global _pool
    if _pool is None:
        try:
            from psycopg_pool import ConnectionPool
            _pool = ConnectionPool(
                conninfo=get_database_url(),
                min_size=2,
                max_size=10,
                open=True,
            )
        except ImportError:
            pass
    return _pool


@contextmanager
def get_conn():
    """
    Context manager para obtener conexión a Postgres.
    Usa pool si está disponible, sino abre conexión directa.

    Uso:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(...)
    """
    pool = _get_pool()
    if pool is not None:
        with pool.connection() as conn:
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise
    else:
        conn = psycopg.connect(get_database_url())
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def _create_base_tables(cur) -> None:
    """Crea tablas base si no existen (idempotente)."""
    cur.execute("""
    CREATE TABLE IF NOT EXISTS proyectos (
        id_proyecto TEXT PRIMARY KEY,
        nombre_proyecto TEXT NOT NULL,
        fecha_creacion TEXT,
        usuario_creador TEXT
    )
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS barras (
        id_unico TEXT PRIMARY KEY,
        id_proyecto TEXT,
        nombre_proyecto TEXT,
        plano_code TEXT,
        nombre_plano TEXT,
        sector TEXT,
        piso TEXT,
        ciclo TEXT,
        eje TEXT,
        diam DOUBLE PRECISION,
        largo_total DOUBLE PRECISION,
        mult DOUBLE PRECISION,
        cant DOUBLE PRECISION,
        cant_total DOUBLE PRECISION,
        peso_unitario DOUBLE PRECISION,
        peso_total DOUBLE PRECISION,
        version_mod TEXT,
        version_exp TEXT,
        fecha_carga TEXT,
        FOREIGN KEY (id_proyecto) REFERENCES proyectos(id_proyecto)
    )
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'coordinador', 'cubicador', 'operador', 'cliente'))
    )
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS imports (
        id BIGSERIAL PRIMARY KEY,
        id_proyecto TEXT,
        nombre_proyecto TEXT,
        usuario TEXT,
        archivo TEXT,
        fecha TEXT,
        barras_count INTEGER DEFAULT 0,
        kilos DOUBLE PRECISION DEFAULT 0
    )
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
    )
    """)


# Lista ordenada de migraciones versionadas.
# Cada entrada: (version, description, list_of_sql)
# NUNCA modificar migraciones ya aplicadas. Solo agregar nuevas al final.
MIGRATIONS = [
    (1, "barras: nombre_proyecto, nombre_plano", [
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN nombre_proyecto TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN nombre_plano TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
    (2, "proyectos: descripcion", [
        "DO $$ BEGIN ALTER TABLE proyectos ADD COLUMN descripcion TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
    (3, "proyectos: owner_id, calculista", [
        "DO $$ BEGIN ALTER TABLE proyectos ADD COLUMN owner_id BIGINT REFERENCES users(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE proyectos ADD COLUMN calculista TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
    (4, "tabla proyecto_usuarios", [
        """CREATE TABLE IF NOT EXISTS proyecto_usuarios (
            id BIGSERIAL PRIMARY KEY,
            id_proyecto TEXT NOT NULL REFERENCES proyectos(id_proyecto) ON DELETE CASCADE,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            rol TEXT NOT NULL DEFAULT 'editor',
            UNIQUE(id_proyecto, user_id)
        )""",
    ]),
    (5, "imports: estado, version_archivo, plano_code, errores", [
        "DO $$ BEGIN ALTER TABLE imports ADD COLUMN estado TEXT DEFAULT 'ok'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE imports ADD COLUMN version_archivo TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE imports ADD COLUMN plano_code TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE imports ADD COLUMN errores TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
    (6, "barras: columnas completas ArmaDetailer para export", [
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN bar_id TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN estructura TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN tipo TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN marca TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN figura TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN esp DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN dim_a DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN dim_b DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN dim_c DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN dim_d DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN dim_e DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN dim_f DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN dim_g DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN dim_h DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN dim_i DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN ang1 DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN ang2 DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN ang3 DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN radio DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN cod_proyecto TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN nombre_dwg TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
    (7, "users: expandir roles válidos", [
        "DO $$ BEGIN ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check; EXCEPTION WHEN undefined_object THEN NULL; END $$;",
        "ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'coordinador', 'cubicador', 'operador', 'cliente'))",
    ]),
    (9, "tabla export_log para historial de exportaciones", [
        """CREATE TABLE IF NOT EXISTS export_log (
            id BIGSERIAL PRIMARY KEY,
            id_proyecto TEXT NOT NULL REFERENCES proyectos(id_proyecto) ON DELETE CASCADE,
            sector TEXT NOT NULL,
            piso TEXT NOT NULL,
            ciclo TEXT NOT NULL,
            export_key TEXT NOT NULL,
            usuario TEXT NOT NULL,
            fecha TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
            barras INTEGER DEFAULT 0,
            kilos DOUBLE PRECISION DEFAULT 0
        )""",
        "CREATE INDEX IF NOT EXISTS idx_export_log_proyecto ON export_log(id_proyecto)",
        "CREATE INDEX IF NOT EXISTS idx_export_log_key ON export_log(id_proyecto, export_key)",
    ]),
    (8, "tablas pedidos y pedido_items", [
        """CREATE TABLE IF NOT EXISTS pedidos (
            id BIGSERIAL PRIMARY KEY,
            id_proyecto TEXT NOT NULL REFERENCES proyectos(id_proyecto) ON DELETE CASCADE,
            titulo TEXT NOT NULL,
            descripcion TEXT,
            estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','enviado','en_proceso','completado','cancelado')),
            creado_por TEXT NOT NULL,
            fecha_creacion TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
            fecha_actualizacion TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS pedido_items (
            id BIGSERIAL PRIMARY KEY,
            pedido_id BIGINT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
            diam DOUBLE PRECISION NOT NULL,
            largo DOUBLE PRECISION,
            cantidad INTEGER NOT NULL DEFAULT 1,
            sector TEXT,
            piso TEXT,
            ciclo TEXT,
            nota TEXT,
            estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_proceso','completado'))
        )""",
    ]),
    (10, "tabla clientes y FK en proyectos", [
        """CREATE TABLE IF NOT EXISTS clientes (
            id BIGSERIAL PRIMARY KEY,
            nombre TEXT NOT NULL,
            rut TEXT,
            contacto TEXT,
            email TEXT,
            telefono TEXT,
            direccion TEXT,
            notas TEXT,
            activo BOOLEAN NOT NULL DEFAULT TRUE,
            fecha_creacion TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
        )""",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(LOWER(nombre))",
        "DO $$ BEGIN ALTER TABLE proyectos ADD COLUMN cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
    (11, "tabla audit_log para auditoría de acciones", [
        """CREATE TABLE IF NOT EXISTS audit_log (
            id BIGSERIAL PRIMARY KEY,
            usuario TEXT NOT NULL,
            accion TEXT NOT NULL,
            detalle TEXT,
            entidad TEXT,
            entidad_id TEXT,
            fecha TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
        )""",
        "CREATE INDEX IF NOT EXISTS idx_audit_log_fecha ON audit_log(fecha DESC)",
        "CREATE INDEX IF NOT EXISTS idx_audit_log_usuario ON audit_log(usuario)",
        "CREATE INDEX IF NOT EXISTS idx_audit_log_accion ON audit_log(accion)",
    ]),
    (12, "tabla calculistas normalizada + FK en proyectos", [
        """CREATE TABLE IF NOT EXISTS calculistas (
            id BIGSERIAL PRIMARY KEY,
            nombre TEXT NOT NULL,
            email TEXT,
            activo BOOLEAN NOT NULL DEFAULT TRUE,
            fecha_creacion TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
        )""",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_calculistas_nombre ON calculistas(LOWER(nombre))",
        "DO $$ BEGIN ALTER TABLE proyectos ADD COLUMN calculista_id BIGINT REFERENCES calculistas(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        """DO $$
        BEGIN
            INSERT INTO calculistas (nombre)
            SELECT DISTINCT calculista FROM proyectos
            WHERE calculista IS NOT NULL AND calculista != ''
            ON CONFLICT DO NOTHING;

            UPDATE proyectos p SET calculista_id = c.id
            FROM calculistas c WHERE LOWER(p.calculista) = LOWER(c.nombre)
            AND p.calculista_id IS NULL;
        END $$;""",
    ]),
    (13, "tablas reclamos y reclamo_seguimientos", [
        """CREATE TABLE IF NOT EXISTS reclamos (
            id BIGSERIAL PRIMARY KEY,
            id_proyecto TEXT REFERENCES proyectos(id_proyecto) ON DELETE CASCADE,
            titulo TEXT NOT NULL,
            descripcion TEXT,
            estado TEXT NOT NULL DEFAULT 'abierto'
                CHECK (estado IN ('abierto','en_analisis','accion_correctiva','cerrado','rechazado')),
            prioridad TEXT NOT NULL DEFAULT 'media'
                CHECK (prioridad IN ('baja','media','alta','critica')),
            categoria_ishikawa TEXT
                CHECK (categoria_ishikawa IN ('mano_de_obra','metodo','material','maquina','medicion','medio_ambiente')),
            responsable TEXT,
            accion_correctiva TEXT,
            accion_preventiva TEXT,
            resolucion TEXT,
            creado_por TEXT NOT NULL,
            fecha_creacion TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
            fecha_actualizacion TEXT,
            fecha_cierre TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS reclamo_seguimientos (
            id BIGSERIAL PRIMARY KEY,
            reclamo_id BIGINT NOT NULL REFERENCES reclamos(id) ON DELETE CASCADE,
            usuario TEXT NOT NULL,
            comentario TEXT,
            estado_anterior TEXT,
            estado_nuevo TEXT,
            fecha TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
        )""",
        "CREATE INDEX IF NOT EXISTS idx_reclamos_proyecto ON reclamos(id_proyecto)",
        "CREATE INDEX IF NOT EXISTS idx_reclamos_estado ON reclamos(estado)",
        "CREATE INDEX IF NOT EXISTS idx_reclamos_prioridad ON reclamos(prioridad)",
        "CREATE INDEX IF NOT EXISTS idx_reclamo_seg_reclamo ON reclamo_seguimientos(reclamo_id)",
    ]),
    (15, "barras: origen e import_id + reclamos: correlativo e id_calidad", [
        # Barras: trazabilidad de origen
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN origen TEXT DEFAULT 'csv'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN import_id BIGINT REFERENCES imports(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN pedido_id BIGINT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN creado_por TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "CREATE INDEX IF NOT EXISTS idx_barras_import_id ON barras(import_id)",
        "CREATE INDEX IF NOT EXISTS idx_barras_origen ON barras(origen)",
        # Backfill import_id para barras existentes (vincular por proyecto+fecha_carga)
        """DO $$
        BEGIN
            UPDATE barras b SET import_id = i.id
            FROM imports i
            WHERE b.id_proyecto = i.id_proyecto
              AND b.fecha_carga = i.fecha
              AND b.import_id IS NULL;
        END $$;""",
        # Reclamos: correlativo e id_calidad
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN correlativo TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN id_calidad TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "CREATE INDEX IF NOT EXISTS idx_reclamos_id_calidad ON reclamos(id_calidad)",
        # Backfill correlativo para reclamos existentes
        """DO $$
        DECLARE
            rec RECORD;
            seq INTEGER := 0;
        BEGIN
            FOR rec IN SELECT id FROM reclamos ORDER BY id LOOP
                seq := seq + 1;
                UPDATE reclamos SET correlativo = 'REC-' || LPAD(seq::TEXT, 3, '0') WHERE id = rec.id AND correlativo IS NULL;
            END LOOP;
        END $$;""",
    ]),
    (14, "reclamos: campos reales formulario + acciones + imagenes", [
        # Nuevos campos en reclamos
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN correlativo_calidad SERIAL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN aplica TEXT DEFAULT 'pendiente' CHECK (aplica IN ('si','no','pendiente')); EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN sub_causa TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN cod_causa TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN detectado_por TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN fecha_deteccion TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN fecha_analisis TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN analista TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN area_aplica TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN explicacion_causa TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN observaciones TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        # Tabla de acciones (inmediata, correctiva, preventiva)
        """CREATE TABLE IF NOT EXISTS reclamo_acciones (
            id BIGSERIAL PRIMARY KEY,
            reclamo_id BIGINT NOT NULL REFERENCES reclamos(id) ON DELETE CASCADE,
            tipo TEXT NOT NULL CHECK (tipo IN ('inmediata','correctiva','preventiva')),
            descripcion TEXT NOT NULL,
            responsable TEXT,
            fecha_prevista TEXT,
            fecha_completada TEXT,
            estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_proceso','completada')),
            creado_por TEXT NOT NULL,
            fecha_creacion TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
        )""",
        "CREATE INDEX IF NOT EXISTS idx_reclamo_acc_reclamo ON reclamo_acciones(reclamo_id)",
        # Tabla de imágenes/evidencia
        """CREATE TABLE IF NOT EXISTS reclamo_imagenes (
            id BIGSERIAL PRIMARY KEY,
            reclamo_id BIGINT NOT NULL REFERENCES reclamos(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            content_type TEXT NOT NULL,
            data BYTEA NOT NULL,
            descripcion TEXT,
            subido_por TEXT NOT NULL,
            fecha TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
        )""",
        "CREATE INDEX IF NOT EXISTS idx_reclamo_img_reclamo ON reclamo_imagenes(reclamo_id)",
    ]),
    (16, "reclamos: FK id_proyecto ON DELETE SET NULL en vez de CASCADE", [
        # Drop the old CASCADE FK and recreate as SET NULL
        """DO $$
        DECLARE fk_name TEXT;
        BEGIN
            SELECT constraint_name INTO fk_name
            FROM information_schema.table_constraints
            WHERE table_name = 'reclamos'
              AND constraint_type = 'FOREIGN KEY'
              AND constraint_name LIKE '%id_proyecto%';
            IF fk_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE reclamos DROP CONSTRAINT ' || fk_name;
            END IF;
        END $$;""",
        "ALTER TABLE reclamos ADD CONSTRAINT reclamos_id_proyecto_fkey FOREIGN KEY (id_proyecto) REFERENCES proyectos(id_proyecto) ON DELETE SET NULL",
    ]),
    (17, "pedidos: tipo pedido + eje en items + procesado flag", [
        # Tipo de pedido: generico (sin sector) o especifico (con sector)
        "DO $$ BEGIN ALTER TABLE pedidos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'generico' CHECK (tipo IN ('generico','especifico')); EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        # Eje en items: texto libre para aSa Studio (columna A), max 14 chars
        "DO $$ BEGIN ALTER TABLE pedido_items ADD COLUMN eje TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        # Flag para saber si el pedido ya fue procesado (items → barras)
        "DO $$ BEGIN ALTER TABLE pedidos ADD COLUMN procesado BOOLEAN NOT NULL DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        # Referencia al item de pedido en la barra generada
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN pedido_item_id INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
    (18, "reclamos: cliente_id", [
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
    (19, "reclamos: flujo 3 etapas (tipo_reclamo, respuesta, validacion, tipo imagen)", [
        # tipo_reclamo: error / faltante
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN tipo_reclamo TEXT DEFAULT 'error' CHECK (tipo_reclamo IN ('error','faltante')); EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        # Respuesta del cubicador
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN respuesta_texto TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN respuesta_fecha TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN respuesta_por TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        # Validación
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN validacion_resultado TEXT CHECK (validacion_resultado IN ('aprobado','rechazado','corregido')); EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN validacion_observaciones TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN validacion_fecha TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN validacion_por TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        # Tipo de imagen: ImagenesRegistro / ImagenesAnalisis (nueva nomenclatura)
        "DO $$ BEGIN ALTER TABLE reclamo_imagenes ADD COLUMN tipo TEXT NOT NULL DEFAULT 'antecedente' CHECK (tipo IN ('ImagenesRegistro','ImagenesAnalisis')); EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        # Actualizar constraint a nueva nomenclatura
        "DO $$ BEGIN ALTER TABLE reclamo_imagenes DROP CONSTRAINT IF EXISTS reclamo_imagenes_tipo_check; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamo_imagenes ADD CONSTRAINT reclamo_imagenes_tipo_check CHECK (tipo IN ('ImagenesRegistro','ImagenesAnalisis')); END $$;",
        # Agregar estado 'validacion' al CHECK constraint de reclamos
        """DO $$ BEGIN
            ALTER TABLE reclamos DROP CONSTRAINT IF EXISTS reclamos_estado_check;
            ALTER TABLE reclamos ADD CONSTRAINT reclamos_estado_check
                CHECK (estado IN ('abierto','en_analisis','accion_correctiva','validacion','cerrado','rechazado'));
        END $$;""",
    ]),
    (20, "users: nombre, activo, fecha_creacion", [
        "DO $$ BEGIN ALTER TABLE users ADD COLUMN nombre TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE users ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE users ADD COLUMN fecha_creacion TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'); EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
    (21, "users: apellido", [
        "DO $$ BEGIN ALTER TABLE users ADD COLUMN apellido TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
    (22, "reclamos: kilos_mal_fabricados", [
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN kilos_mal_fabricados DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
    (23, "roles: reemplazar operador por usc y externo", [
        "UPDATE users SET role = 'usc' WHERE role = 'operador';",
        "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;",
        "ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'coordinador', 'cubicador', 'usc', 'externo', 'cliente'));",
    ]),
    (24, "reclamos: tracking creador y asignación", [
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN creado_por TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN asignado_a TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "UPDATE reclamos SET creado_por = 'sistema' WHERE creado_por IS NULL;",
    ]),
    (25, "renombrar coordinador a admin_calidad", [
        "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;",
        "UPDATE users SET role = 'admin_calidad' WHERE role = 'coordinador';",
        "ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'admin_calidad', 'cubicador', 'usc', 'externo', 'cliente'));",
    ]),
    (26, "reclamos: cubicador_asignado para tracking de responsabilidad", [
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN cubicador_asignado TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "CREATE INDEX IF NOT EXISTS idx_reclamos_cubicador_asignado ON reclamos(cubicador_asignado)",
    ]),
    (27, "barras: agregar ang4 (ANG4 de ArmaDetailer, exporta como AngV3)", [
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN ang4 DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
    (28, "renombrar clientes → constructoras", [
        "DO $$ BEGIN ALTER TABLE clientes RENAME TO constructoras; EXCEPTION WHEN undefined_table THEN NULL; END $$;",
        "DO $$ BEGIN ALTER INDEX idx_clientes_nombre RENAME TO idx_constructoras_nombre; EXCEPTION WHEN OTHERS THEN NULL; END $$;",
    ]),
    (29, "proyectos: renombrar cliente_id → constructora_id", [
        "DO $$ BEGIN ALTER TABLE proyectos RENAME COLUMN cliente_id TO constructora_id; EXCEPTION WHEN undefined_column THEN NULL; END $$;",
    ]),
    (30, "proyectos: eliminar owner_id y calculista (texto)", [
        "DO $$ BEGIN ALTER TABLE proyectos DROP COLUMN owner_id; EXCEPTION WHEN undefined_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE proyectos DROP COLUMN calculista; EXCEPTION WHEN undefined_column THEN NULL; END $$;",
    ]),
    (31, "proyecto_usuarios: roles usc/cubicador/externo/cliente/admin", [
        "ALTER TABLE proyecto_usuarios DROP CONSTRAINT IF EXISTS proyecto_usuarios_rol_check",
        "UPDATE proyecto_usuarios SET rol = 'cubicador' WHERE rol NOT IN ('admin','usc','cubicador','externo','cliente')",
        "ALTER TABLE proyecto_usuarios ADD CONSTRAINT proyecto_usuarios_rol_check CHECK (rol IN ('admin','usc','cubicador','externo','cliente'))",
    ]),
    (32, "proyecto_aliases: multiples IDs de proyecto por obra", [
        """CREATE TABLE IF NOT EXISTS proyecto_aliases (
            alias TEXT PRIMARY KEY,
            id_proyecto TEXT NOT NULL REFERENCES proyectos(id_proyecto) ON DELETE CASCADE,
            creado_por TEXT,
            fecha TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
        )""",
        "CREATE INDEX IF NOT EXISTS idx_proyecto_aliases_proyecto ON proyecto_aliases(id_proyecto)",
    ]),
    (33, "reclamos: agregar tipo 'atraso' al CHECK de tipo_reclamo", [
        "ALTER TABLE reclamos DROP CONSTRAINT IF EXISTS reclamos_tipo_reclamo_check",
        "ALTER TABLE reclamos ADD CONSTRAINT reclamos_tipo_reclamo_check CHECK (tipo_reclamo IN ('error','faltante','atraso'))",
    ]),
    (34, "reclamos: agregar tipo 'actualizacion_portal' al CHECK de tipo_reclamo", [
        "ALTER TABLE reclamos DROP CONSTRAINT IF EXISTS reclamos_tipo_reclamo_check",
        "ALTER TABLE reclamos ADD CONSTRAINT reclamos_tipo_reclamo_check CHECK (tipo_reclamo IN ('error','faltante','atraso','actualizacion_portal'))",
    ]),
    (35, "reclamos: campos de presentación semanal", [
        "ALTER TABLE reclamos ADD COLUMN IF NOT EXISTS presentacion_realizada BOOLEAN DEFAULT FALSE",
        "ALTER TABLE reclamos ADD COLUMN IF NOT EXISTS presentacion_fecha TEXT",
        "ALTER TABLE reclamos ADD COLUMN IF NOT EXISTS presentacion_por TEXT",
        "ALTER TABLE reclamos ADD COLUMN IF NOT EXISTS presentacion_asistentes TEXT",
        "ALTER TABLE reclamos ADD COLUMN IF NOT EXISTS presentacion_comentarios TEXT",
    ]),
    (36, "proyectos: fecha_inicio para ordenar por antigüedad", [
        "ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS fecha_inicio TEXT",
    ]),
    (37, "barras: índice para navegador de sectores", [
        "CREATE INDEX IF NOT EXISTS idx_barras_proyecto_sector_piso_ciclo ON barras (id_proyecto, sector, piso, ciclo)",
    ]),
    (38, "reclamos: backfill cubicador_asignado from responsable display names", [
        """UPDATE reclamos r
           SET cubicador_asignado = u.email
           FROM users u
           WHERE r.cubicador_asignado IS NULL
             AND r.responsable IS NOT NULL
             AND r.responsable != ''
             AND TRIM(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellido, '')) = r.responsable""",
    ]),
    (39, "reclamos: drop unused cliente_id column (never used in endpoints, FK broken after clientes→constructoras rename)", [
        "DO $$ BEGIN ALTER TABLE reclamos DROP COLUMN cliente_id; EXCEPTION WHEN undefined_column THEN NULL; END $$;",
    ]),
    (40, "reclamos: tiempo_respuesta for manual tracking", [
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN tiempo_respuesta INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN tiempo_respuesta_unidad TEXT DEFAULT 'horas' CHECK (tiempo_respuesta_unidad IN ('minutos','horas','dias')); EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN tiempo_respuesta_actualizado_por TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN tiempo_respuesta_fecha_actualizacion TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
    (41, "reclamos: agregar estado 'validado' al CHECK constraint", [
        # Drop ALL check constraints on reclamos.estado (handles auto-named + explicit)
        """DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
                WHERE con.conrelid = 'reclamos'::regclass
                  AND con.contype = 'c'
                  AND att.attname = 'estado'
            ) LOOP
                EXECUTE 'ALTER TABLE reclamos DROP CONSTRAINT ' || r.conname;
            END LOOP;
            ALTER TABLE reclamos ADD CONSTRAINT reclamos_estado_check
                CHECK (estado IN ('abierto','en_analisis','accion_correctiva','validacion','validado','cerrado','rechazado'));
        END $$;""",
    ]),
    (42, "reclamos: fix CHECK constraint estado (force drop all + recreate)", [
        # Retry: migration 41 may have run but failed to drop old auto-named constraint
        """DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
                WHERE con.conrelid = 'reclamos'::regclass
                  AND con.contype = 'c'
                  AND att.attname = 'estado'
            ) LOOP
                EXECUTE 'ALTER TABLE reclamos DROP CONSTRAINT ' || r.conname;
            END LOOP;
            ALTER TABLE reclamos ADD CONSTRAINT reclamos_estado_check
                CHECK (estado IN ('abierto','en_analisis','accion_correctiva','validacion','validado','cerrado','rechazado'));
        END $$;""",
    ]),
    (43, "notificaciones: tablas para centro de notificaciones", [
        """CREATE TABLE IF NOT EXISTS notificaciones (
            id BIGSERIAL PRIMARY KEY,
            destinatario TEXT NOT NULL,
            tipo_evento TEXT NOT NULL,
            reclamo_id BIGINT REFERENCES reclamos(id) ON DELETE CASCADE,
            mensaje TEXT NOT NULL,
            leida BOOLEAN NOT NULL DEFAULT FALSE,
            fecha TEXT NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_notif_destinatario ON notificaciones(destinatario, leida)",
        "CREATE INDEX IF NOT EXISTS idx_notif_fecha ON notificaciones(fecha DESC)",
        """CREATE TABLE IF NOT EXISTS notificacion_config (
            id BIGSERIAL PRIMARY KEY,
            tipo_evento TEXT NOT NULL,
            rol TEXT NOT NULL,
            activo BOOLEAN NOT NULL DEFAULT TRUE,
            UNIQUE(tipo_evento, rol)
        )""",
        # Defaults: quién recibe cada tipo de evento
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('reclamo_creado', 'admin', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('reclamo_creado', 'admin_calidad', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('reclamo_asignado', 'cubicador', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('reclamo_asignado', 'usc', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('analisis_completado', 'admin', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('analisis_completado', 'admin_calidad', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('analisis_completado', 'usc', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('validacion_realizada', 'cubicador', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('validacion_realizada', 'usc', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('reclamo_cerrado', 'admin', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('reclamo_cerrado', 'usc', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('reclamo_reabierto', 'cubicador', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('cambio_estado', 'admin', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('cambio_estado', 'admin_calidad', TRUE) ON CONFLICT DO NOTHING",
    ]),

    (44, "reclamos: separar id_calidad en anio_calidad + numero_calidad", [
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN anio_calidad INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN numero_calidad INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "CREATE INDEX IF NOT EXISTS idx_reclamos_anio_numero ON reclamos(anio_calidad DESC, numero_calidad DESC);",
    ]),

    (45, "reclamos: backfill anio_calidad/numero_calidad desde id_calidad", [
        """UPDATE reclamos
           SET anio_calidad = CAST(split_part(id_calidad, '-', 1) AS INTEGER),
               numero_calidad = CAST(split_part(id_calidad, '-', 2) AS INTEGER)
           WHERE id_calidad ~ '^[0-9]{4}-[0-9]+$'
             AND anio_calidad IS NULL AND numero_calidad IS NULL;""",
    ]),

    (46, "reclamos: eliminar estado accion_correctiva — migrar a cerrado + nuevo CHECK", [
        # Migrar reclamos existentes con estado accion_correctiva → cerrado
        "UPDATE reclamos SET estado = 'cerrado' WHERE estado = 'accion_correctiva';",
        # Recrear CHECK constraint sin accion_correctiva
        """DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
                WHERE con.conrelid = 'reclamos'::regclass
                  AND con.contype = 'c'
                  AND att.attname = 'estado'
            ) LOOP
                EXECUTE 'ALTER TABLE reclamos DROP CONSTRAINT ' || r.conname;
            END LOOP;
            ALTER TABLE reclamos ADD CONSTRAINT reclamos_estado_check
                CHECK (estado IN ('abierto','en_analisis','validacion','validado','cerrado','rechazado'));
        END $$;""",
    ]),

    # --- Migration 47: Remove estado 'validado' — merge into 'cerrado' ---
    (47, "reclamos: eliminar estado 'validado', migrar a 'cerrado'", [
        "UPDATE reclamos SET estado = 'cerrado' WHERE estado = 'validado';",
        """DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
                WHERE con.conrelid = 'reclamos'::regclass
                  AND con.contype = 'c'
                  AND att.attname = 'estado'
            ) LOOP
                EXECUTE 'ALTER TABLE reclamos DROP CONSTRAINT ' || r.conname;
            END LOOP;
            ALTER TABLE reclamos ADD CONSTRAINT reclamos_estado_check
                CHECK (estado IN ('abierto','en_analisis','validacion','cerrado','rechazado'));
        END $$;""",
    ]),

    # --- Migration 49: limpiar tablas obra_ejes/obra_losas (enfoque revertido a vista derivada de barras) ---
    (49, "limpieza: drop obra_ejes y obra_losas", [
        "DROP TABLE IF EXISTS obra_ejes CASCADE",
        "DROP TABLE IF EXISTS obra_losas CASCADE",
    ]),

    # --- Migration 50: trazabilidad de reemplazos en importaciones ---
    (50, "imports: modo_reemplazo, scope_reemplazo, barras_eliminadas_previo", [
        "DO $$ BEGIN ALTER TABLE imports ADD COLUMN modo_reemplazo TEXT DEFAULT 'ninguno'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE imports ADD COLUMN scope_reemplazo TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE imports ADD COLUMN barras_eliminadas_previo INTEGER DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),

    # --- Migration 51: id_unico único por obra (no global) ---
    # Antes: id_unico TEXT PRIMARY KEY (global en todo el sistema)
    # Ahora: id BIGSERIAL PRIMARY KEY + UNIQUE(id_unico, id_proyecto)
    # Esto permite cargar el mismo archivo en distintas obras sin conflicto.
    (51, "barras: id BIGSERIAL PK + UNIQUE(id_unico, id_proyecto)", [
        # 1. Agregar columna id serial (si no existe)
        "DO $$ BEGIN ALTER TABLE barras ADD COLUMN id BIGSERIAL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        # 2. Crear la nueva restricción única compuesta
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_barras_unico_obra ON barras (id_unico, id_proyecto);",
        # 3. Quitar la PK actual de id_unico
        "DO $$ BEGIN ALTER TABLE barras DROP CONSTRAINT IF EXISTS barras_pkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;",
        # 4. Establecer id como nueva PK
        "DO $$ BEGIN ALTER TABLE barras ADD PRIMARY KEY (id); EXCEPTION WHEN invalid_table_definition THEN NULL; END $$;",
    ]),

    # --- Migration 52: historial de cargas supersedidas ---
    (52, "imports: supersedida_por (FK a imports.id)", [
        "DO $$ BEGIN ALTER TABLE imports ADD COLUMN supersedida_por INTEGER REFERENCES imports(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),

    # --- Migration 53: storage_key para migrar imágenes de BYTEA a R2 ---
    # Compatibilidad dual: durante la migración conviven imágenes en R2 (storage_key)
    # y viejas en BYTEA (data). Se hace `data` nullable; la columna se elimina recién
    # cuando todas las imágenes estén migradas a R2 (tarea 3.9 del programa).
    (53, "reclamo_imagenes: storage_key (R2) + data nullable", [
        "DO $$ BEGIN ALTER TABLE reclamo_imagenes ADD COLUMN storage_key TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamo_imagenes ALTER COLUMN data DROP NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;",
    ]),

    # --- Migration 54: eliminar columna data (BYTEA) de reclamo_imagenes ---
    # Todas las imágenes ya migradas a R2 (28/28 OK, validado 2026-06-09).
    # El backend ya no lee ni escribe data; todo pasa por storage_key.
    (54, "reclamo_imagenes: drop columna data (BYTEA eliminado, todo en R2)", [
        "DO $$ BEGIN ALTER TABLE reclamo_imagenes DROP COLUMN data; EXCEPTION WHEN undefined_column THEN NULL; END $$;",
    ]),

    # --- Migration 55: tabla areas ---
    (55, "areas: tabla de áreas de la empresa", [
        """
        CREATE TABLE IF NOT EXISTS areas (
            id      BIGSERIAL PRIMARY KEY,
            nombre  TEXT NOT NULL,
            slug    TEXT UNIQUE NOT NULL,
            activo  BOOLEAN DEFAULT TRUE,
            fecha_creacion TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        )
        """,
    ]),

    # --- Migration 56: tabla area_usuarios (M:N usuarios-areas) ---
    (56, "area_usuarios: rol de cada usuario en cada área", [
        """
        CREATE TABLE IF NOT EXISTS area_usuarios (
            id        BIGSERIAL PRIMARY KEY,
            area_id   BIGINT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
            user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            rol_area  TEXT NOT NULL DEFAULT 'miembro',
            UNIQUE(area_id, user_id)
        )
        """,
    ]),

    # --- Migration 57: tablas RCA por área ---
    (57, "area_rca: categorías y sub-causas Ishikawa por área", [
        """
        CREATE TABLE IF NOT EXISTS area_rca_categorias (
            id       BIGSERIAL PRIMARY KEY,
            area_id  BIGINT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
            slug     TEXT NOT NULL,
            nombre   TEXT NOT NULL,
            orden    INTEGER DEFAULT 0,
            UNIQUE(area_id, slug)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS area_rca_subcausas (
            id           BIGSERIAL PRIMARY KEY,
            categoria_id BIGINT NOT NULL REFERENCES area_rca_categorias(id) ON DELETE CASCADE,
            codigo       TEXT NOT NULL,
            descripcion  TEXT NOT NULL,
            activo       BOOLEAN DEFAULT TRUE,
            orden        INTEGER DEFAULT 0
        )
        """,
    ]),

    # --- Migration 58: seed áreas + seed matriz RCA de Cubicaciones ---
    (58, "seed: 11 áreas de la empresa + matriz RCA Cubicaciones", [
        """
        INSERT INTO areas (nombre, slug) VALUES
            ('USC C&D',              'usc_cd'),
            ('USC MPEC',             'usc_mpec'),
            ('Producción C&D',       'produccion_cd'),
            ('Producción MPEC',      'produccion_mpec'),
            ('Producción Prearmado', 'produccion_prearmado'),
            ('Cubicaciones',         'cubicaciones'),
            ('Logística',            'logistica'),
            ('Ventas C&D',           'ventas_cd'),
            ('Ventas MPEC',          'ventas_mpec'),
            ('Calidad',              'calidad'),
            ('Planificación',        'planificacion')
        ON CONFLICT (slug) DO NOTHING
        """,
        # Categorías Ishikawa para Cubicaciones
        """
        INSERT INTO area_rca_categorias (area_id, slug, nombre, orden)
        SELECT a.id, cat.slug, cat.nombre, cat.orden
        FROM areas a, (VALUES
            ('medio_ambiente', 'Medio Ambiente', 1),
            ('material',       'Material',       2),
            ('maquina',        'Máquina',        3),
            ('medicion',       'Medición',       4),
            ('metodo',         'Método',         5),
            ('mano_de_obra',   'Mano de Obra',   6)
        ) AS cat(slug, nombre, orden)
        WHERE a.slug = 'cubicaciones'
        ON CONFLICT (area_id, slug) DO NOTHING
        """,
        # Sub-causas Medio Ambiente — Cubicaciones
        """
        INSERT INTO area_rca_subcausas (categoria_id, codigo, descripcion, orden)
        SELECT c.id, sub.codigo, sub.descripcion, sub.orden
        FROM area_rca_categorias c
        JOIN areas a ON a.id = c.area_id
        CROSS JOIN (VALUES
            ('MA01', 'Interrupciones constantes durante la jornada', 1),
            ('MA02', 'Ruido ambiental o distracciones', 2),
            ('MA03', 'Puesto de trabajo incómodo o con mala ergonomía', 3),
            ('MA04', 'Falta de iluminación adecuada', 4),
            ('MA05', 'Actividades no planificadas que interrumpen la cubicación', 5)
        ) AS sub(codigo, descripcion, orden)
        WHERE a.slug = 'cubicaciones' AND c.slug = 'medio_ambiente'
        """,
        # Sub-causas Material — Cubicaciones
        """
        INSERT INTO area_rca_subcausas (categoria_id, codigo, descripcion, orden)
        SELECT c.id, sub.codigo, sub.descripcion, sub.orden
        FROM area_rca_categorias c
        JOIN areas a ON a.id = c.area_id
        CROSS JOIN (VALUES
            ('MT01', 'Falta de programa de obra (debe solicitar por escrito)', 1),
            ('MT02', 'Falta de ciclos constructivos o modificación', 2),
            ('MT03', 'Planos complejos o indefinidos', 3),
            ('MT04', 'Plano de planta no muestra todos los elementos (como muros dilotados)', 4),
            ('MT05', 'Medidas contradictorias entre planta y elevación', 5),
            ('MT06', 'Formato de digitaciones poco legible', 6)
        ) AS sub(codigo, descripcion, orden)
        WHERE a.slug = 'cubicaciones' AND c.slug = 'material'
        """,
        # Sub-causas Máquina — Cubicaciones
        """
        INSERT INTO area_rca_subcausas (categoria_id, codigo, descripcion, orden)
        SELECT c.id, sub.codigo, sub.descripcion, sub.orden
        FROM area_rca_categorias c
        JOIN areas a ON a.id = c.area_id
        CROSS JOIN (VALUES
            ('MQ01', 'Internet lento o inestable', 1),
            ('MQ02', 'aSa Studio inestable genera recubicaciones', 2),
            ('MQ03', 'Error de parámetros en planilla de importación - Cubicad', 3),
            ('MQ04', 'Error al captar datos desde aSa Studio', 4)
        ) AS sub(codigo, descripcion, orden)
        WHERE a.slug = 'cubicaciones' AND c.slug = 'maquina'
        """,
        # Sub-causas Medición — Cubicaciones
        """
        INSERT INTO area_rca_subcausas (categoria_id, codigo, descripcion, orden)
        SELECT c.id, sub.codigo, sub.descripcion, sub.orden
        FROM area_rca_categorias c
        JOIN areas a ON a.id = c.area_id
        CROSS JOIN (VALUES
            ('ME01', 'Error en la medición o lectura de cotas referencia incorrecta en el plano', 1),
            ('ME02', 'Diferencia entre cotas indicadas y cotas reales del in situ', 2),
            ('ME03', 'Inconsistencia entre planta y elevación no detectada al cubicar', 3),
            ('ME04', 'Inconsistencia no detectada entre Especificaciones técnicas y NCH 211', 4),
            ('ME05', 'Plano en formato no medible (PDF entrega medida equivocada)', 5)
        ) AS sub(codigo, descripcion, orden)
        WHERE a.slug = 'cubicaciones' AND c.slug = 'medicion'
        """,
        # Sub-causas Método — Cubicaciones
        """
        INSERT INTO area_rca_subcausas (categoria_id, codigo, descripcion, orden)
        SELECT c.id, sub.codigo, sub.descripcion, sub.orden
        FROM area_rca_categorias c
        JOIN areas a ON a.id = c.area_id
        CROSS JOIN (VALUES
            ('MD01', 'No se indica en procedimiento estandarizado', 1),
            ('MD02', 'Criterios de cubicación no estandarizados entre proyectos', 2),
            ('MD03', 'Falta información en protocolo (mejorar formulario)', 3)
        ) AS sub(codigo, descripcion, orden)
        WHERE a.slug = 'cubicaciones' AND c.slug = 'metodo'
        """,
        # Sub-causas Mano de Obra — Cubicaciones
        """
        INSERT INTO area_rca_subcausas (categoria_id, codigo, descripcion, orden)
        SELECT c.id, sub.codigo, sub.descripcion, sub.orden
        FROM area_rca_categorias c
        JOIN areas a ON a.id = c.area_id
        CROSS JOIN (VALUES
            ('MO01', 'No sigue procedimiento establecido', 1),
            ('MO02', 'No revisa información ingresada post ticket de ingreso aSa', 2),
            ('MO03', 'No considera correo o acuerdos con cliente', 3),
            ('MO04', 'No aplica protocolo correctamente', 4),
            ('MO05', 'Falta registro formal de información acordada', 5),
            ('MO06', 'Error al digitar o transcribir datos', 6),
            ('MO07', 'No consulta antecedentes incompletos mediante Bshark o RDI', 7),
            ('MO08', 'Error de interpretación o criterio técnico', 8),
            ('MO09', 'Sobrecarga laboral o plazos ajustados que reducen tiempo de revisión', 9)
        ) AS sub(codigo, descripcion, orden)
        WHERE a.slug = 'cubicaciones' AND c.slug = 'mano_de_obra'
        """,
    ]),
    (59, "Renombrar rol admin2 → admin_calidad en usuarios y configuraciones", [
        # 1) Quitar TODO check constraint sobre users.role (auto-nombrado o explícito)
        #    para poder normalizar los valores sin que el constraint viejo bloquee.
        """DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
                WHERE con.conrelid = 'users'::regclass
                  AND con.contype = 'c'
                  AND att.attname = 'role'
            ) LOOP
                EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || r.conname;
            END LOOP;
        END $$;""",
        # 2) Normalizar valores legados a la lista vigente
        "UPDATE users SET role = 'admin_calidad' WHERE role IN ('admin2', 'coordinador')",
        "UPDATE notificacion_config SET rol = 'admin_calidad' WHERE rol IN ('admin2', 'coordinador')",
        # 3) Recrear el constraint con la lista correcta de roles
        """ALTER TABLE users ADD CONSTRAINT users_role_check
            CHECK (role IN ('admin', 'admin_calidad', 'cubicador', 'usc', 'externo', 'cliente'))""",
    ]),

    (60, "reclamos: agregar estado en_revision al CHECK constraint", [
        """DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
                WHERE con.conrelid = 'reclamos'::regclass
                  AND con.contype = 'c'
                  AND att.attname = 'estado'
            ) LOOP
                EXECUTE 'ALTER TABLE reclamos DROP CONSTRAINT ' || r.conname;
            END LOOP;
            ALTER TABLE reclamos ADD CONSTRAINT reclamos_estado_check
                CHECK (estado IN ('abierto','en_analisis','en_revision','accion_correctiva','validacion','validado','cerrado','rechazado'));
        END $$;""",
    ]),

    (61, "notificaciones: defaults para eventos enviado_a_revision y enviado_a_validacion", [
        # Jefe de Servicio (admin) recibe avisos de reclamos enviados a revisión
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('enviado_a_revision', 'admin', TRUE) ON CONFLICT DO NOTHING",
        # Jefa de Calidad (admin_calidad) recibe avisos de reclamos enviados a validación
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('enviado_a_validacion', 'admin_calidad', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO notificacion_config (tipo_evento, rol, activo) VALUES ('enviado_a_validacion', 'admin', TRUE) ON CONFLICT DO NOTHING",
    ]),

    (62, "resincronizar secuencias id (corrige UniqueViolation tras importación de datos)", [
        # Tras restaurar/importar filas con id explícito, las secuencias quedan atrás
        # y el próximo INSERT choca con un id ya existente. Esto recorre cada TABLA BASE
        # del esquema public con columna 'id' serial y reposiciona su secuencia a MAX(id).
        # Usa pg_tables (no information_schema.columns directo) para excluir vistas y
        # tablas de extensiones (ej. pg_stat_statements_info) que no tienen secuencia.
        # Idempotente.
        """DO $$
        DECLARE
            r RECORD;
            seq TEXT;
            maxid BIGINT;
        BEGIN
            FOR r IN (
                SELECT t.tablename
                FROM pg_tables t
                JOIN information_schema.columns c
                  ON c.table_schema = t.schemaname AND c.table_name = t.tablename
                WHERE t.schemaname = 'public'
                  AND c.column_name = 'id'
                  AND pg_get_serial_sequence(quote_ident(t.tablename), 'id') IS NOT NULL
            ) LOOP
                seq := pg_get_serial_sequence(quote_ident(r.tablename), 'id');
                EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM %I', r.tablename) INTO maxid;
                IF maxid > 0 THEN
                    PERFORM setval(seq, maxid);
                END IF;
            END LOOP;
        END $$;""",
    ]),

    # --- Migration 63: flag tiene_revision por área (etapa de revisión opcional) ---
    (63, "areas: columna tiene_revision (Flujo con revisión opcional por área)", [
        "DO $$ BEGIN ALTER TABLE areas ADD COLUMN tiene_revision BOOLEAN DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        # Hoy solo Cubicaciones usa etapa de revisión.
        "UPDATE areas SET tiene_revision = TRUE WHERE slug = 'cubicaciones'",
    ]),

    # --- Migration 64: reclamos.area_id (FK al área real, inferida del responsable) ---
    (64, "reclamos: columna area_id (FK a areas)", [
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN area_id BIGINT REFERENCES areas(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        # Backfill best-effort: los reclamos viejos de Cubicación (texto area_aplica o con
        # cubicador asignado) apuntan al área Cubicaciones. El resto queda NULL y se
        # completará al (re)asignar responsable. area_aplica se conserva como histórico.
        """
        UPDATE reclamos r SET area_id = a.id
        FROM areas a
        WHERE r.area_id IS NULL
          AND a.slug = 'cubicaciones'
          AND (lower(COALESCE(r.area_aplica, '')) LIKE 'cubicac%'
               OR r.cubicador_asignado IS NOT NULL)
        """,
    ]),

    # --- Migration 65: configurar qué roles pueden levantar reclamos (externo/interno) ---
    (65, "reclamo_crear_config: qué roles levantan reclamos externos/internos", [
        """CREATE TABLE IF NOT EXISTS reclamo_crear_config (
            id     BIGSERIAL PRIMARY KEY,
            accion TEXT NOT NULL,   -- 'externo' | 'interno'
            rol    TEXT NOT NULL,
            activo BOOLEAN DEFAULT TRUE,
            UNIQUE(accion, rol)
        )""",
        # Externos: hoy los levanta USC (+ admin/admin_calidad). Replica el estado actual.
        "INSERT INTO reclamo_crear_config (accion, rol, activo) VALUES ('externo', 'admin', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO reclamo_crear_config (accion, rol, activo) VALUES ('externo', 'admin_calidad', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO reclamo_crear_config (accion, rol, activo) VALUES ('externo', 'usc', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO reclamo_crear_config (accion, rol, activo) VALUES ('externo', 'cubicador', FALSE) ON CONFLICT DO NOTHING",
        "INSERT INTO reclamo_crear_config (accion, rol, activo) VALUES ('externo', 'externo', FALSE) ON CONFLICT DO NOTHING",
        "INSERT INTO reclamo_crear_config (accion, rol, activo) VALUES ('externo', 'miembro', FALSE) ON CONFLICT DO NOTHING",
        # Internos: cualquier área puede levantar. Se siembran todos en TRUE.
        "INSERT INTO reclamo_crear_config (accion, rol, activo) VALUES ('interno', 'admin', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO reclamo_crear_config (accion, rol, activo) VALUES ('interno', 'admin_calidad', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO reclamo_crear_config (accion, rol, activo) VALUES ('interno', 'usc', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO reclamo_crear_config (accion, rol, activo) VALUES ('interno', 'cubicador', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO reclamo_crear_config (accion, rol, activo) VALUES ('interno', 'externo', FALSE) ON CONFLICT DO NOTHING",
        "INSERT INTO reclamo_crear_config (accion, rol, activo) VALUES ('interno', 'miembro', TRUE) ON CONFLICT DO NOTHING",
    ]),

    # --- Migration 66: reclamos internos (tipo_origen) ---
    (66, "reclamos: tipo_origen (externo|interno)", [
        # Distingue las dos listas (Clientes vs Internos). Default externo: todos los
        # reclamos actuales son externos. El cliente de un interno es OPCIONAL y se
        # gestiona con la lógica central de clientes/obras (sin hardcode).
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN tipo_origen TEXT DEFAULT 'externo'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "UPDATE reclamos SET tipo_origen = 'externo' WHERE tipo_origen IS NULL",
    ]),

    # --- Migration 67: limpiar el seed erróneo de "Armacero (Interno)" (era hardcode) ---
    (67, "limpiar proyecto sembrado ARMACERO-INT (los clientes se gestionan central)", [
        "DELETE FROM proyectos WHERE id_proyecto = 'ARMACERO-INT' AND NOT EXISTS (SELECT 1 FROM reclamos WHERE id_proyecto = 'ARMACERO-INT')",
    ]),

    # --- Migration 68: RCA flexible — método Ishikawa o 5 Por Qué por reclamo ---
    (68, "reclamos: metodo_rca y cinco_por_que (RCA flexible)", [
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN metodo_rca TEXT DEFAULT 'ishikawa'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN cinco_por_que JSONB; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),

    # --- Migration 69: revisión separada por tipo de reclamo (externo/interno) ---
    (69, "areas: tiene_revision_interno (revisión opcional independiente para internos)", [
        "DO $$ BEGIN ALTER TABLE areas ADD COLUMN tiene_revision_interno BOOLEAN DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),

    # --- Migration 70: quitar CHECK hardcodeado de users.role ---
    # Los roles objetivo son: admin, admin_calidad, miembro, cliente.
    # Los roles legacy (cubicador, usc, externo) coexisten durante la transición;
    # el CHECK se amplía para aceptarlos a todos hasta que el backfill esté completo.
    (70, "users: ampliar CHECK role para incluir 'miembro' (roles objetivo + legacy)", [
        """DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
                WHERE con.conrelid = 'users'::regclass
                  AND con.contype = 'c'
                  AND att.attname = 'role'
            ) LOOP
                EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || r.conname;
            END LOOP;
            ALTER TABLE users ADD CONSTRAINT users_role_check
                CHECK (role IN ('admin', 'admin_calidad', 'cubicador', 'usc', 'externo', 'cliente', 'miembro'));
        END $$;""",
    ]),

    # --- Migration 72: tabla area_rol_permisos (permisos por rol_area, configurable) ---
    # Mismo patrón que reclamo_crear_config: permite configurar qué puede hacer cada
    # rol_area sin hardcodear la lógica. Las acciones disponibles son:
    #   levantar_externo   — puede crear reclamos externos (tipo_origen='externo')
    #   levantar_interno   — puede crear reclamos internos (tipo_origen='interno')
    #   responder_externo  — puede responder/analizar reclamos externos del área
    #   responder_interno  — puede responder/analizar reclamos internos del área
    #   aprobar_revision   — puede aprobar/devolver reclamos en etapa de revisión
    (72, "area_rol_permisos: permisos configurables por rol_area", [
        """CREATE TABLE IF NOT EXISTS area_rol_permisos (
            id      BIGSERIAL PRIMARY KEY,
            rol_area TEXT NOT NULL,
            accion   TEXT NOT NULL,
            activo   BOOLEAN DEFAULT TRUE,
            UNIQUE(rol_area, accion)
        )""",
        # jefe_servicio: todo
        "INSERT INTO area_rol_permisos (rol_area, accion, activo) VALUES ('jefe_servicio', 'levantar_externo', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO area_rol_permisos (rol_area, accion, activo) VALUES ('jefe_servicio', 'levantar_interno', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO area_rol_permisos (rol_area, accion, activo) VALUES ('jefe_servicio', 'responder_externo', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO area_rol_permisos (rol_area, accion, activo) VALUES ('jefe_servicio', 'responder_interno', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO area_rol_permisos (rol_area, accion, activo) VALUES ('jefe_servicio', 'aprobar_revision', TRUE) ON CONFLICT DO NOTHING",
        # miembro: puede responder e interno, NO levantar externos (lo decide USC)
        "INSERT INTO area_rol_permisos (rol_area, accion, activo) VALUES ('miembro', 'levantar_externo', FALSE) ON CONFLICT DO NOTHING",
        "INSERT INTO area_rol_permisos (rol_area, accion, activo) VALUES ('miembro', 'levantar_interno', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO area_rol_permisos (rol_area, accion, activo) VALUES ('miembro', 'responder_externo', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO area_rol_permisos (rol_area, accion, activo) VALUES ('miembro', 'responder_interno', TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO area_rol_permisos (rol_area, accion, activo) VALUES ('miembro', 'aprobar_revision', FALSE) ON CONFLICT DO NOTHING",
    ]),

    # --- Migration 71: poblar area_usuarios desde roles legacy ---
    # Regla de mapeo:
    #   cubicador  → area 'cubicaciones',  rol_area 'miembro'
    #   usc        → area 'usc_cd',        rol_area 'jefe_servicio'  (jefe del área USC)
    #   externo    → area 'usc_cd',        rol_area 'miembro'        (operativo externo)
    # Solo inserta si el usuario NO tiene ya una entrada en area_usuarios para esa área.
    (71, "area_usuarios: backfill roles legacy (cubicador/usc/externo → área+rol_area)", [
        # Cubicadores → miembro de Cubicaciones
        """INSERT INTO area_usuarios (area_id, user_id, rol_area)
        SELECT a.id, u.id, 'miembro'
        FROM users u
        JOIN areas a ON a.slug = 'cubicaciones'
        WHERE u.role = 'cubicador' AND u.activo = TRUE
        ON CONFLICT (area_id, user_id) DO NOTHING""",
        # USC → jefe_servicio de usc_cd
        """INSERT INTO area_usuarios (area_id, user_id, rol_area)
        SELECT a.id, u.id, 'jefe_servicio'
        FROM users u
        JOIN areas a ON a.slug = 'usc_cd'
        WHERE u.role = 'usc' AND u.activo = TRUE
        ON CONFLICT (area_id, user_id) DO NOTHING""",
        # Externos → miembro de usc_cd
        """INSERT INTO area_usuarios (area_id, user_id, rol_area)
        SELECT a.id, u.id, 'miembro'
        FROM users u
        JOIN areas a ON a.slug = 'usc_cd'
        WHERE u.role = 'externo' AND u.activo = TRUE
        ON CONFLICT (area_id, user_id) DO NOTHING""",
    ]),

    # --- Migration 73: rol global jefe_servicio + simplificar area_usuarios ---
    # 1. Agrega 'jefe_servicio' al CHECK de users.role (es un rol global, no de área)
    # 2. Hace rol_area nullable en area_usuarios (ya no se usa para definir permisos)
    # 3. Crea tabla role_permisos (rol global → acción → activo), reemplaza area_rol_permisos
    # 4. Backfill: copia permisos desde area_rol_permisos mapeando rol_area→role
    (73, "roles: jefe_servicio global + role_permisos + area_usuarios sin rol_area", [
        # 1. Ampliar CHECK de users.role para incluir jefe_servicio
        """DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
                WHERE con.conrelid = 'users'::regclass
                  AND con.contype = 'c'
                  AND att.attname = 'role'
            ) LOOP
                EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || r.conname;
            END LOOP;
            ALTER TABLE users ADD CONSTRAINT users_role_check
                CHECK (role IN ('admin','admin_calidad','jefe_servicio','miembro','cliente','cubicador','usc','externo'));
        END $$;""",
        # 2. Hacer rol_area nullable en area_usuarios (ya no requerido)
        "ALTER TABLE area_usuarios ALTER COLUMN rol_area DROP NOT NULL",
        # 3. Crear tabla role_permisos (permisos por rol global)
        """CREATE TABLE IF NOT EXISTS role_permisos (
            id      BIGSERIAL PRIMARY KEY,
            role    TEXT NOT NULL,
            accion  TEXT NOT NULL,
            activo  BOOLEAN DEFAULT TRUE,
            UNIQUE(role, accion)
        )""",
        # 4. Poblar role_permisos — jefe_servicio hereda permisos del ex jefe_servicio de área
        "INSERT INTO role_permisos (role, accion, activo) VALUES ('jefe_servicio','levantar_externo',TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO role_permisos (role, accion, activo) VALUES ('jefe_servicio','levantar_interno',TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO role_permisos (role, accion, activo) VALUES ('jefe_servicio','responder_externo',TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO role_permisos (role, accion, activo) VALUES ('jefe_servicio','responder_interno',TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO role_permisos (role, accion, activo) VALUES ('jefe_servicio','aprobar_revision',TRUE) ON CONFLICT DO NOTHING",
        # miembro: puede responder pero no aprobar revisión ni levantar externos
        "INSERT INTO role_permisos (role, accion, activo) VALUES ('miembro','levantar_externo',FALSE) ON CONFLICT DO NOTHING",
        "INSERT INTO role_permisos (role, accion, activo) VALUES ('miembro','levantar_interno',TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO role_permisos (role, accion, activo) VALUES ('miembro','responder_externo',TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO role_permisos (role, accion, activo) VALUES ('miembro','responder_interno',TRUE) ON CONFLICT DO NOTHING",
        "INSERT INTO role_permisos (role, accion, activo) VALUES ('miembro','aprobar_revision',FALSE) ON CONFLICT DO NOTHING",
    ]),

    # --- Migration 74: estructura de correo (tarea 5B) ---
    # correo_templates: plantillas reutilizables (asunto + cuerpo HTML con variables)
    #   por caso de uso (clave). Transversal, pero hoy administradas desde Calidad.
    # reclamo_envios: trazabilidad de cada envío de informe (a quién, cuándo, por
    #   quién, estado). Permite el marcador "informe enviado" + historial.
    (74, "correo: plantillas (correo_templates) + trazabilidad de envíos (reclamo_envios)", [
        """CREATE TABLE IF NOT EXISTS correo_templates (
            id       BIGSERIAL PRIMARY KEY,
            clave    TEXT NOT NULL UNIQUE,
            nombre   TEXT NOT NULL DEFAULT '',
            asunto   TEXT NOT NULL DEFAULT '',
            cuerpo   TEXT NOT NULL DEFAULT '',
            activo   BOOLEAN DEFAULT TRUE,
            fecha_creacion       TIMESTAMPTZ DEFAULT now(),
            fecha_actualizacion  TIMESTAMPTZ DEFAULT now()
        )""",
        """CREATE TABLE IF NOT EXISTS reclamo_envios (
            id            BIGSERIAL PRIMARY KEY,
            reclamo_id    BIGINT NOT NULL REFERENCES reclamos(id) ON DELETE CASCADE,
            enviado_por   TEXT NOT NULL,
            destinatarios TEXT NOT NULL,
            asunto        TEXT DEFAULT '',
            estado        TEXT NOT NULL DEFAULT 'enviado',
            message_id    TEXT,
            error         TEXT,
            fecha         TIMESTAMPTZ DEFAULT now()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_reclamo_envios_reclamo ON reclamo_envios(reclamo_id)",
        # Plantilla semilla para el caso principal (informe validado). Editable luego.
        """INSERT INTO correo_templates (clave, nombre, asunto, cuerpo) VALUES (
            'informe_validado',
            'Informe de reclamo validado',
            'Informe de reclamo {{correlativo}} - {{proyecto}}',
            '<p>Estimado/a,</p><p>Adjuntamos el informe del reclamo <strong>{{correlativo}}</strong> correspondiente a la obra <strong>{{proyecto}}</strong>.</p><p>Saludos,<br>Equipo de Calidad - Armacero</p>'
        ) ON CONFLICT (clave) DO NOTHING""",
    ]),

    # --- Migration 75: avisos automáticos (motor, parte 1) ---
    # Columna 'evento' en reclamo_envios para distinguir manual vs automático en la
    # trazabilidad + plantillas semilla de los 2 eventos automáticos iniciales.
    (75, "correo: columna evento en reclamo_envios + plantillas aviso externo/interno", [
        "DO $$ BEGIN ALTER TABLE reclamo_envios ADD COLUMN evento TEXT DEFAULT 'informe_manual'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
        """INSERT INTO correo_templates (clave, nombre, asunto, cuerpo) VALUES (
            'aviso_reclamo_externo',
            'Aviso: reclamo externo creado',
            'Nuevo reclamo {{correlativo}} - {{proyecto}}',
            '<p>Estimado/a,</p><p>Se ha registrado el reclamo <strong>{{correlativo}}</strong> de la obra <strong>{{proyecto}}</strong>: {{titulo}}.</p><p>Ingresa a la plataforma ArmaHub para gestionarlo.</p><p>Saludos,<br>Equipo de Calidad - Armacero</p>'
        ) ON CONFLICT (clave) DO NOTHING""",
        """INSERT INTO correo_templates (clave, nombre, asunto, cuerpo) VALUES (
            'aviso_reclamo_interno',
            'Aviso: reclamo interno creado',
            'Nuevo reclamo interno {{correlativo}}',
            '<p>Estimado/a,</p><p>Se ha registrado un reclamo interno <strong>{{correlativo}}</strong> dirigido a tu área: {{titulo}}.</p><p>Ingresa a la plataforma ArmaHub para gestionarlo.</p><p>Saludos,<br>Equipo de Calidad - Armacero</p>'
        ) ON CONFLICT (clave) DO NOTHING""",
    ]),

    # --- Migration 76: fecha fin de análisis (5L.7) ---
    # Complementa fecha_analisis (inicio) con una fecha de fin, para diferenciar
    # el rango del análisis. Campo TEXT (fecha ISO 'YYYY-MM-DD'), como fecha_analisis.
    (76, "reclamos: columna fecha_fin_analisis", [
        "DO $$ BEGIN ALTER TABLE reclamos ADD COLUMN fecha_fin_analisis TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
    ]),
]


def _run_migrations(cur) -> int:
    """Ejecuta migraciones pendientes. Retorna cantidad aplicada."""
    cur.execute("SELECT version FROM schema_migrations ORDER BY version")
    applied = {r[0] for r in cur.fetchall()}
    count = 0
    for version, desc, sqls in MIGRATIONS:
        if version in applied:
            continue
        for sql in sqls:
            cur.execute(sql)
        cur.execute(
            "INSERT INTO schema_migrations (version, description) VALUES (%s, %s)",
            (version, desc),
        )
        count += 1
    return count


def _create_indexes(cur) -> None:
    """Crea índices para consultas rápidas (idempotente)."""
    cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_proyecto ON barras (id_proyecto)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_plano ON barras (plano_code)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_sector ON barras (sector)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_piso ON barras (piso)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_ciclo ON barras (ciclo)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_eje ON barras (eje)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_fecha ON barras (fecha_carga)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_imports_fecha ON imports (fecha)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_imports_proyecto ON imports (id_proyecto)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_imports_usuario ON imports (usuario)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reclamos_creado_por ON reclamos (creado_por)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reclamos_asignado_a ON reclamos (asignado_a)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reclamos_respuesta_por ON reclamos (respuesta_por)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reclamos_categoria_ishikawa ON reclamos (categoria_ishikawa)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reclamos_fecha_deteccion ON reclamos (fecha_deteccion)")


def _init_db_once() -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            _create_base_tables(cur)
            _run_migrations(cur)
            _create_indexes(cur)


def init_db() -> None:
    """
    Crea tablas base, ejecuta migraciones versionadas y crea índices.
    Reintenta ante fallos transitorios de DNS/conectividad en Render.
    """
    max_attempts = max(1, int(os.getenv("DB_INIT_MAX_ATTEMPTS", "6")))
    retry_seconds = max(1, int(os.getenv("DB_INIT_RETRY_SECONDS", "5")))
    last_error = None

    for attempt in range(1, max_attempts + 1):
        try:
            _init_db_once()
            if attempt > 1:
                logger.warning(
                    "DB init se recupero en el intento %s/%s",
                    attempt,
                    max_attempts,
                )
            return
        except Exception as exc:
            last_error = exc
            if attempt == max_attempts:
                break
            logger.warning(
                "DB init fallo en intento %s/%s: %s. Reintentando en %s s",
                attempt,
                max_attempts,
                exc,
                retry_seconds,
            )
            time.sleep(retry_seconds)

    raise last_error


def reset_database(keep_users: bool = True) -> dict:
    """
    Borra datos de barras y proyectos, y recrea las tablas.
    Si keep_users=False, también borra usuarios (requiere bootstrap después).
    Retorna resumen de lo eliminado.
    """
    summary = {}
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM barras")
            summary["barras_eliminadas"] = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM proyectos")
            summary["proyectos_eliminados"] = int(cur.fetchone()[0])
            # Tablas dependientes primero por FK
            cur.execute("DROP TABLE IF EXISTS schema_migrations")
            cur.execute("DROP TABLE IF EXISTS audit_log")
            cur.execute("DROP TABLE IF EXISTS reclamo_imagenes")
            cur.execute("DROP TABLE IF EXISTS reclamo_acciones")
            cur.execute("DROP TABLE IF EXISTS reclamo_seguimientos")
            cur.execute("DROP TABLE IF EXISTS reclamos")
            cur.execute("DROP TABLE IF EXISTS export_log")
            cur.execute("DROP TABLE IF EXISTS pedido_items")
            cur.execute("DROP TABLE IF EXISTS pedidos")
            cur.execute("DROP TABLE IF EXISTS proyecto_usuarios")
            cur.execute("DROP TABLE IF EXISTS imports")
            cur.execute("DROP TABLE IF EXISTS barras")
            cur.execute("DROP TABLE IF EXISTS proyecto_aliases")
            cur.execute("DROP TABLE IF EXISTS constructoras")
            cur.execute("DROP TABLE IF EXISTS calculistas")
            cur.execute("DROP TABLE IF EXISTS proyectos")
            if not keep_users:
                cur.execute("SELECT COUNT(*) FROM users")
                summary["usuarios_eliminados"] = int(cur.fetchone()[0])
                cur.execute("DROP TABLE IF EXISTS users")
    # Recrear tablas fuera de la conexión anterior
    init_db()
    summary["status"] = "reset_completo"
    return summary


def users_count() -> int:
    """
    Devuelve cuántos usuarios existen.
    Útil para habilitar bootstrap cuando la BD está vacía.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM users")
            return int(cur.fetchone()[0])


def audit(usuario: str, accion: str, detalle: str = None, entidad: str = None, entidad_id: str = None):
    """Registra una acción en el audit_log. Fire-and-forget, no falla si la tabla no existe."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO audit_log (usuario, accion, detalle, entidad, entidad_id)
                    VALUES (%s, %s, %s, %s, %s)
                """, (usuario, accion, detalle, entidad, entidad_id))
    except Exception:
        pass