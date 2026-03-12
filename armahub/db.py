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
from contextlib import contextmanager

import psycopg


def get_database_url() -> str:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("Falta DATABASE_URL. Este backend es Postgres-only.")
    # Render a veces entrega postgres://; psycopg espera postgresql://
    if db_url.startswith("postgres://"):
        db_url = "postgresql://" + db_url[len("postgres://") :]
    return db_url


@contextmanager
def get_conn():
    """
    Context manager para obtener conexión a Postgres.

    Uso:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(...)
    """
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
        # Tipo de imagen: antecedente (creador) / respuesta (cubicador)
        "DO $$ BEGIN ALTER TABLE reclamo_imagenes ADD COLUMN tipo TEXT NOT NULL DEFAULT 'antecedente' CHECK (tipo IN ('antecedente','respuesta')); EXCEPTION WHEN duplicate_column THEN NULL; END $$;",
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
    (25, "renombrar coordinador a admin2", [
        "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;",
        "UPDATE users SET role = 'admin2' WHERE role = 'coordinador';",
        "ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'admin2', 'cubicador', 'usc', 'externo', 'cliente'));",
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
        "ALTER TABLE proyecto_usuarios DROP CONSTRAINT IF EXISTS proyecto_usuarios_rol_check;",
        "UPDATE proyecto_usuarios SET rol = 'cubicador' WHERE rol NOT IN ('admin','usc','cubicador','externo','cliente');",
        "ALTER TABLE proyecto_usuarios ADD CONSTRAINT proyecto_usuarios_rol_check CHECK (rol IN ('admin','usc','cubicador','externo','cliente'));",
    ]),
    (32, "proyecto_aliases: multiples IDs de proyecto por obra", [
        """CREATE TABLE IF NOT EXISTS proyecto_aliases (
            alias TEXT PRIMARY KEY,
            id_proyecto TEXT NOT NULL REFERENCES proyectos(id_proyecto) ON DELETE CASCADE,
            creado_por TEXT,
            fecha_creacion TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
        )""",
        "CREATE INDEX IF NOT EXISTS idx_proyecto_aliases_proyecto ON proyecto_aliases(id_proyecto)",
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


def init_db() -> None:
    """
    Crea tablas base, ejecuta migraciones versionadas y crea índices.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            _create_base_tables(cur)
            _run_migrations(cur)
            _create_indexes(cur)


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