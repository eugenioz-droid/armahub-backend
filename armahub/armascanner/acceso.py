"""
Quién puede usar ArmaScanner en ArmaHub: la ficha de la licencia (desde ArmaScanner), la licencia vigente
(desde el portal) y el administrador. Responde 401 y 403 como las rutas: es parte de la capa HTTP.
"""

from fastapi import HTTPException

from ..licencias import estado_licencia, leer_ficha


PRODUCTO = "armascanner"


def hoy_chile():
    """La fecha de hoy en Chile. El servidor corre en UTC y de noche allá ya es mañana: con la fecha
    UTC, una licencia que vence hoy dejaría de valer a las 21:00."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/Santiago")).date()


def _usuario(cur, ficha: str) -> dict:
    """El usuario de la ficha, si su licencia vale hoy (en Chile). 401 si la ficha no sirve, 403 si la
    licencia no vale o es un cliente."""
    email = leer_ficha(ficha, PRODUCTO)
    cur.execute("""
        SELECT u.role, COALESCE(u.activo, TRUE), l.activa, l.vence
          FROM users u
          LEFT JOIN licencias l ON l.user_id = u.id AND l.producto = %s
         WHERE u.email = %s
    """, (PRODUCTO, email))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="El usuario ya no existe en ArmaHub.")
    role, activo, activa, vence = row
    vale, motivo = estado_licencia(None if activa is None else (activa, vence, activo), hoy_chile())
    if not vale:
        raise HTTPException(status_code=403, detail=motivo)
    if role == "cliente":
        raise HTTPException(status_code=403, detail="Tu usuario no puede cargar despieces.")
    return {"email": email, "role": role}


def licencias_vigentes(cur, email: str) -> list:
    """Los productos con licencia vigente hoy para ese correo (GET /me: la caluga ArmaScanner
    sólo se muestra a quien la tiene, y al administrador). Hoy, en Chile."""
    cur.execute("""
        SELECT l.producto, l.activa, l.vence, COALESCE(u.activo, TRUE)
          FROM licencias l JOIN users u ON u.id = l.user_id
         WHERE u.email = %s
    """, (email,))
    hoy = hoy_chile()
    return [p for p, activa, vence, activo in cur.fetchall() if estado_licencia((activa, vence, activo), hoy)[0]]


def _es_admin(user) -> bool:
    return user.get("role") in ("admin", "admin_calidad")


def _con_licencia_o_admin(cur, user):
    if not _es_admin(user) and PRODUCTO not in licencias_vigentes(cur, user.get("email", "")):
        raise HTTPException(status_code=403, detail="Requiere licencia de ArmaScanner.")
