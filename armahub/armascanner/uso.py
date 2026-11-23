"""
Licencias y Uso (administración): quién tiene la licencia de ArmaScanner y cuánto se usó en los últimos
30 días.
"""

from fastapi import APIRouter, Depends

from ..auth import require_admin_or_admin_calidad
from ..db import get_conn
from .acceso import PRODUCTO

router = APIRouter()


@router.get("/armascanner/licencias")
def licencias(admin=Depends(require_admin_or_admin_calidad)):
    """Licencias: quién la tiene (también las retiradas, para volver a darlas)."""
    from ..licencias import licencias_por_usuario
    with get_conn() as conn:
        with conn.cursor() as cur:
            por_usuario = licencias_por_usuario(cur)
            ids = [uid for uid, prods in por_usuario.items() if PRODUCTO in prods]
            usuarios = {}
            if ids:
                cur.execute("""SELECT id, email, nombre, apellido, role, COALESCE(activo, TRUE)
                                 FROM users WHERE id = ANY(%s)""", (ids,))
                usuarios = {r[0]: r for r in cur.fetchall()}
    out = []
    for uid in ids:
        u = usuarios.get(uid)
        if not u:
            continue
        lic = por_usuario[uid][PRODUCTO]
        out.append({"user_id": uid, "email": u[1], "nombre": ((u[2] or "") + " " + (u[3] or "")).strip() or u[1],
                    "role": u[4], "usuario_activo": u[5], **lic})
    out.sort(key=lambda x: (not x["activa"], x["nombre"].lower()))
    return {"licencias": out}


@router.get("/armascanner/uso")
def uso(admin=Depends(require_admin_or_admin_calidad)):
    """Uso: KPIs de los últimos 30 días y el uso por usuario (cargas vigentes de ArmaScanner)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT COUNT(*) FROM licencias
                            WHERE producto = %s AND activa AND (vence IS NULL OR vence >= CURRENT_DATE)""",
                        (PRODUCTO,))
            activas = cur.fetchone()[0]
            cur.execute("""
                SELECT i.usuario, COUNT(DISTINCT i.id), COUNT(b.*), COALESCE(SUM(b.peso_total), 0),
                       COUNT(b.*) FILTER (WHERE b.revision = 'aprobada'), MAX(i.fecha)
                  FROM imports i JOIN barras b ON b.import_id = i.id
                 WHERE i.herramienta = 'ArmaScanner'
                   AND i.fecha >= to_char(NOW() - INTERVAL '30 days', 'YYYY-MM-DD')
                 GROUP BY i.usuario
                 ORDER BY 4 DESC
            """)
            filas = cur.fetchall()
    por_usuario = [{"usuario": u, "planos": pl, "items": it, "kg": round(float(kg), 1),
                    "aprobadas_pct": round(100.0 * ap / it, 1) if it else 0.0, "ultima": ul}
                   for u, pl, it, kg, ap, ul in filas]
    items, aprobadas = sum(f[2] for f in filas), sum(f[4] for f in filas)
    return {"licencias_activas": activas, "planos": sum(f[1] for f in filas),
            "kg": round(sum(float(f[3]) for f in filas), 1),
            "aprobadas_pct": round(100.0 * aprobadas / items, 1) if items else 0.0,
            "por_usuario": por_usuario}
