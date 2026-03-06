"""
admin.py
--------
Endpoints administrativos (solo admin).

Incluye:
- POST /admin/reset-db (resetear base de datos con confirmación)
- GET  /admin/db-info (info de la base de datos)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from .db import get_conn, reset_database
from .auth import require_admin

router = APIRouter()


@router.get("/admin/db-info")
def db_info(admin=Depends(require_admin)):
    """Info actual de la base de datos."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM barras")
            total_barras = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM proyectos")
            total_proyectos = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM users")
            total_usuarios = int(cur.fetchone()[0])
            cur.execute("SELECT COALESCE(SUM(peso_total), 0) FROM barras")
            total_kilos = float(cur.fetchone()[0])
    return {
        "barras": total_barras,
        "proyectos": total_proyectos,
        "usuarios": total_usuarios,
        "kilos_totales": round(total_kilos, 2),
    }


@router.post("/admin/reset-db")
def admin_reset_db(
    confirm: str = Query(..., description="Debe ser 'CONFIRMAR' para ejecutar"),
    keep_users: bool = Query(True, description="Mantener usuarios (default: sí)"),
    admin=Depends(require_admin),
):
    """
    Resetea la base de datos (borra barras y proyectos).
    Requiere confirm='CONFIRMAR' como medida de seguridad.
    Si keep_users=false, también borra usuarios (necesitarás bootstrap después).
    """
    if confirm != "CONFIRMAR":
        raise HTTPException(
            status_code=400,
            detail="Debes enviar confirm=CONFIRMAR para ejecutar el reset."
        )
    summary = reset_database(keep_users=keep_users)
    return {"ok": True, "reset": summary}
