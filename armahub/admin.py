"""
admin.py
--------
Endpoints administrativos (solo admin).

Incluye:
- POST /admin/reset-db (resetear base de datos con confirmación)
- GET  /admin/db-info (info de la base de datos)
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from .db import get_conn, reset_database, audit
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
    audit(admin.get("email", "?"), "reset_db", f"keep_users={keep_users}", "sistema", None)
    summary = reset_database(keep_users=keep_users)
    return {"ok": True, "reset": summary}


@router.get("/admin/audit")
def get_audit_log(
    usuario: Optional[str] = None,
    accion: Optional[str] = None,
    entidad: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    admin=Depends(require_admin),
):
    """Consultar audit log con filtros opcionales."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            where = []
            params = []
            if usuario:
                where.append("usuario ILIKE %s")
                params.append(f"%{usuario}%")
            if accion:
                where.append("accion = %s")
                params.append(accion)
            if entidad:
                where.append("entidad = %s")
                params.append(entidad)

            w = (" WHERE " + " AND ".join(where)) if where else ""

            cur.execute("SELECT COUNT(*) FROM audit_log" + w, params)
            total = int(cur.fetchone()[0])

            cur.execute(
                "SELECT id, usuario, accion, detalle, entidad, entidad_id, fecha FROM audit_log"
                + w + " ORDER BY fecha DESC LIMIT %s OFFSET %s",
                params + [limit, offset]
            )
            rows = cur.fetchall()

            # Distinct values for filter dropdowns
            cur.execute("SELECT DISTINCT accion FROM audit_log ORDER BY accion")
            acciones = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT entidad FROM audit_log WHERE entidad IS NOT NULL ORDER BY entidad")
            entidades = [r[0] for r in cur.fetchall()]

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "acciones_disponibles": acciones,
        "entidades_disponibles": entidades,
        "logs": [
            {
                "id": r[0], "usuario": r[1], "accion": r[2],
                "detalle": r[3], "entidad": r[4], "entidad_id": r[5],
                "fecha": r[6],
            }
            for r in rows
        ],
    }
