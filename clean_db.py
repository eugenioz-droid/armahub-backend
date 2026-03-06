#!/usr/bin/env python3
"""
Script para limpiar la BD (borrar todos datos)
"""
import os
import sys
sys.path.insert(0, '/workspaces/armahub-backend')

from armahub.db import get_conn

def clean_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            print("Borrando datos de tabla barras...")
            cur.execute("TRUNCATE TABLE barras")
            print("✓ barras borradas")
            
            print("Borrando datos de tabla proyectos...")
            cur.execute("TRUNCATE TABLE proyectos")
            print("✓ proyectos borradas")
    
    print("\n✅ Base de datos limpiada exitosamente")

if __name__ == "__main__":
    clean_db()
