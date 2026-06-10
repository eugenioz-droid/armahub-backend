"""
notifications.py
-----------------
Centro de notificaciones in-app.

Endpoints:
- GET  /notificaciones         → Mis notificaciones (paginadas)
- GET  /notificaciones/count   → Contador de no leídas
- PATCH /notificaciones/{id}/leer → Marcar como leída
- POST /notificaciones/leer-todas → Marcar todas como leídas
- GET  /notificaciones/config  → Config de notificaciones (admin)
- PATCH /notificaciones/config → Actualizar config (admin)

Helper:
- crear_notificacion(tipo_evento, reclamo_id, mensaje, extras)
  → Crea notificaciones para los roles configurados + usuarios específicos
"""

from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from .auth import get_current_user, require_admin_or_admin_calidad
from .db import get_conn

router = APIRouter()

# ========================= TIPOS DE EVENTO =========================

TIPOS_EVENTO = [
    "reclamo_creado",
    "reclamo_asignado",
    "analisis_completado",
    "validacion_realizada",
    "reclamo_cerrado",
    "reclamo_reabierto",
    "cambio_estado",
]

TIPO_EVENTO_LABELS = {
    "reclamo_creado": "Reclamo creado",
    "reclamo_asignado": "Reclamo asignado",
    "analisis_completado": "Análisis causa raíz completado",
    "validacion_realizada": "Validación realizada",
    "reclamo_cerrado": "Reclamo cerrado",
    "reclamo_reabierto": "Reclamo reabierto",
    "cambio_estado": "Cambio de estado",
}

# ========================= HELPER: CREAR NOTIFICACION =========================


def crear_notificacion(tipo_evento: str, reclamo_id: int, mensaje: str,
                       destinatarios_extra: Optional[List[str]] = None):
    """Crea notificaciones según la configuración de roles + destinatarios extras.

    Args:
        tipo_evento: Tipo de evento (de TIPOS_EVENTO)
        reclamo_id: ID del reclamo relacionado
        mensaje: Texto descriptivo de la notificación
        destinatarios_extra: Emails específicos a notificar además de los roles configurados
    """
    now = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Obtener roles configurados para este evento
            cur.execute(
                "SELECT rol FROM notificacion_config WHERE tipo_evento = %s AND activo = TRUE",
                (tipo_evento,)
            )
            roles_activos = [r[0] for r in cur.fetchall()]

            # Obtener emails de usuarios activos con esos roles
            destinatarios = set()
            if roles_activos:
                placeholders = ",".join(["%s"] * len(roles_activos))
                cur.execute(
                    f"SELECT email FROM users WHERE role IN ({placeholders}) AND activo = TRUE",
                    roles_activos
                )
                destinatarios = {r[0] for r in cur.fetchall()}

            # Agregar destinatarios extra (emails específicos)
            if destinatarios_extra:
                for email in destinatarios_extra:
                    if email:
                        destinatarios.add(email)

            # Insertar una notificación por destinatario
            for email in destinatarios:
                cur.execute(
                    """INSERT INTO notificaciones (destinatario, tipo_evento, reclamo_id, mensaje, fecha)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (email, tipo_evento, reclamo_id, mensaje, now)
                )


# ========================= ENDPOINTS =========================


@router.get("/notificaciones")
def mis_notificaciones(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    solo_no_leidas: bool = Query(False),
    user=Depends(get_current_user)
):
    """Lista de notificaciones del usuario actual."""
    email = user.get("email", "")
    where = "WHERE destinatario = %s"
    params = [email]
    if solo_no_leidas:
        where += " AND leida = FALSE"

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM notificaciones {where}", params)
            total = cur.fetchone()[0]

            cur.execute(f"""
                SELECT id, tipo_evento, reclamo_id, mensaje, leida, fecha
                FROM notificaciones {where}
                ORDER BY fecha DESC
                LIMIT %s OFFSET %s
            """, params + [limit, offset])
            rows = cur.fetchall()

    return {
        "data": [
            {
                "id": r[0], "tipo_evento": r[1], "reclamo_id": r[2],
                "mensaje": r[3], "leida": r[4], "fecha": r[5],
                "tipo_label": TIPO_EVENTO_LABELS.get(r[1], r[1]),
            }
            for r in rows
        ],
        "total": total,
    }


@router.get("/notificaciones/count")
def notificaciones_count(user=Depends(get_current_user)):
    """Contador de notificaciones no leídas."""
    email = user.get("email", "")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM notificaciones WHERE destinatario = %s AND leida = FALSE",
                (email,)
            )
            count = cur.fetchone()[0]
    return {"count": count}


@router.patch("/notificaciones/{notif_id}/leer")
def marcar_leida(notif_id: int, user=Depends(get_current_user)):
    """Marcar una notificación como leída."""
    email = user.get("email", "")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE notificaciones SET leida = TRUE WHERE id = %s AND destinatario = %s RETURNING id",
                (notif_id, email)
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    return {"ok": True, "id": notif_id}


@router.post("/notificaciones/leer-todas")
def marcar_todas_leidas(user=Depends(get_current_user)):
    """Marcar todas las notificaciones del usuario como leídas."""
    email = user.get("email", "")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE notificaciones SET leida = TRUE WHERE destinatario = %s AND leida = FALSE",
                (email,)
            )
            count = cur.rowcount
    return {"ok": True, "marcadas": count}


# ========================= CONFIG (ADMIN) =========================


@router.get("/notificaciones/config")
def get_config(admin=Depends(require_admin_or_admin_calidad)):
    """Obtener configuración de notificaciones (evento × rol)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, tipo_evento, rol, activo FROM notificacion_config ORDER BY tipo_evento, rol"
            )
            rows = cur.fetchall()
    return {
        "data": [
            {"id": r[0], "tipo_evento": r[1], "rol": r[2], "activo": r[3]}
            for r in rows
        ],
        "tipos_evento": TIPOS_EVENTO,
        "labels": TIPO_EVENTO_LABELS,
    }


class ConfigUpdate(BaseModel):
    tipo_evento: str
    rol: str
    activo: bool


@router.patch("/notificaciones/config")
def update_config(body: ConfigUpdate, admin=Depends(require_admin_or_admin_calidad)):
    """Activar/desactivar una notificación para un evento × rol."""
    if body.tipo_evento not in TIPOS_EVENTO:
        raise HTTPException(status_code=400, detail=f"Tipo inválido: {body.tipo_evento}")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO notificacion_config (tipo_evento, rol, activo)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (tipo_evento, rol) DO UPDATE SET activo = EXCLUDED.activo
                   RETURNING id""",
                (body.tipo_evento, body.rol, body.activo)
            )
            row = cur.fetchone()
    return {"ok": True, "id": row[0] if row else None}
