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


def init_db() -> None:
    """
    Crea tablas e índices si no existen.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS barras (
                id_unico TEXT PRIMARY KEY,
                id_proyecto TEXT,
                plano_code TEXT,
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
                fecha_carga TEXT
            )
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'operador'))
            )
            """)

            # Índices para consultas rápidas (filtros/dashboard)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_proyecto ON barras (id_proyecto)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_plano ON barras (plano_code)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_sector ON barras (sector)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_piso ON barras (piso)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_ciclo ON barras (ciclo)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_eje ON barras (eje)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_barras_fecha ON barras (fecha_carga)")


def users_count() -> int:
    """
    Devuelve cuántos usuarios existen.
    Útil para habilitar bootstrap cuando la BD está vacía.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM users")
            return int(cur.fetchone()[0])