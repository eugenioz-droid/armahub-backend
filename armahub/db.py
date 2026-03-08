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
            cur.execute("DROP TABLE IF EXISTS pedido_items")
            cur.execute("DROP TABLE IF EXISTS pedidos")
            cur.execute("DROP TABLE IF EXISTS proyecto_usuarios")
            cur.execute("DROP TABLE IF EXISTS imports")
            cur.execute("DROP TABLE IF EXISTS barras")
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