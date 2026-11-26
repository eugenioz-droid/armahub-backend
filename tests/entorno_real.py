# -*- coding: utf-8 -*-
"""LA BASE REAL EN LAS PRUEBAS, SIN TOCAR SU ESQUEMA (25-nov).

Algunas pruebas miden contra la base de producción (cargan el .env real) y arrancan la app
entera con TestClient. Al arrancar, la app corre init_db: crea tablas, aplica las migraciones
pendientes del árbol y siembra el catálogo. Así la migración 184 quedó aplicada en producción
al correr la batería, antes de publicarla.

Con `cargar()` la app arranca sin init_db (ARMAHUB_INIT_DB=0): las pruebas leen la base y el
esquema lo cambia sólo el despliegue. No es un archivo de prueba (no empieza con test_).
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def cargar():
    """El .env real (si está) y la app sin tocar el esquema."""
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    try:
        from asa_ping import cargar_env
        cargar_env()
    except Exception:
        pass
    os.environ["ARMAHUB_INIT_DB"] = "0"
    os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")
    os.environ.setdefault("CORS_ORIGINS", "http://localhost")
