"""
reclamos.py
-----------
CRUD endpoints para sistema de reclamos y errores.
Incluye seguimientos (timeline), cambio de estado, y KPIs.
Categorías Ishikawa provisorias — se ajustarán con input del usuario.
"""

from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from .auth import get_current_user
from .db import get_conn, audit

router = APIRouter()


# ========================= CONSTANTS =========================

ESTADOS_RECLAMO = ("abierto", "en_analisis", "accion_correctiva", "cerrado", "rechazado")
PRIORIDADES = ("baja", "media", "alta", "critica")
CATEGORIAS_ISHIKAWA = (
    "mano_de_obra",
    "metodo",
    "material",
    "maquina",
    "medicion",
    "medio_ambiente",
)

ISHIKAWA_LABELS = {
    "mano_de_obra": "Mano de obra",
    "metodo": "Método",
    "material": "Material",
    "maquina": "Máquina",
    "medicion": "Medición",
    "medio_ambiente": "Medio ambiente",
}

ESTADO_LABELS = {
    "abierto": "Abierto",
    "en_analisis": "En análisis",
    "accion_correctiva": "Acción correctiva",
    "cerrado": "Cerrado",
    "rechazado": "Rechazado",
}

PRIORIDAD_LABELS = {
    "baja": "Baja",
    "media": "Media",
    "alta": "Alta",
    "critica": "Crítica",
}


# ========================= MODELS =========================

class ReclamoCreate(BaseModel):
    id_proyecto: Optional[str] = None
    titulo: str
    descripcion: Optional[str] = None
    prioridad: Optional[str] = "media"
    categoria_ishikawa: Optional[str] = None
    responsable: Optional[str] = None


class ReclamoUpdate(BaseModel):
    titulo: Optional[str] = None
    descripcion: Optional[str] = None
    estado: Optional[str] = None
    prioridad: Optional[str] = None
    categoria_ishikawa: Optional[str] = None
    responsable: Optional[str] = None
    accion_correctiva: Optional[str] = None
    accion_preventiva: Optional[str] = None
    resolucion: Optional[str] = None


class SeguimientoCreate(BaseModel):
    comentario: str
    estado_nuevo: Optional[str] = None


# ========================= RECLAMOS CRUD =========================

@router.get("/reclamos")
def listar_reclamos(
    id_proyecto: Optional[str] = None,
    estado: Optional[str] = None,
    prioridad: Optional[str] = None,
    categoria: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Lista reclamos con filtros opcionales."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            where = "WHERE 1=1"
            params = []
            if id_proyecto:
                where += " AND r.id_proyecto = %s"
                params.append(id_proyecto)
            if estado:
                where += " AND r.estado = %s"
                params.append(estado)
            if prioridad:
                where += " AND r.prioridad = %s"
                params.append(prioridad)
            if categoria:
                where += " AND r.categoria_ishikawa = %s"
                params.append(categoria)

            cur.execute(f"""
                SELECT r.id, r.id_proyecto, r.titulo, r.descripcion, r.estado,
                       r.prioridad, r.categoria_ishikawa, r.responsable,
                       r.creado_por, r.fecha_creacion, r.fecha_actualizacion, r.fecha_cierre,
                       COALESCE(p.nombre_proyecto, r.id_proyecto) AS nombre_proyecto,
                       (SELECT COUNT(*) FROM reclamo_seguimientos s WHERE s.reclamo_id = r.id) AS total_seguimientos
                FROM reclamos r
                LEFT JOIN proyectos p ON r.id_proyecto = p.id_proyecto
                {where}
                ORDER BY
                    CASE r.estado
                        WHEN 'abierto' THEN 1
                        WHEN 'en_analisis' THEN 2
                        WHEN 'accion_correctiva' THEN 3
                        WHEN 'rechazado' THEN 4
                        WHEN 'cerrado' THEN 5
                    END,
                    CASE r.prioridad
                        WHEN 'critica' THEN 1
                        WHEN 'alta' THEN 2
                        WHEN 'media' THEN 3
                        WHEN 'baja' THEN 4
                    END,
                    r.id DESC
            """, params)
            rows = cur.fetchall()

    return {
        "reclamos": [
            {
                "id": r[0],
                "id_proyecto": r[1],
                "titulo": r[2],
                "descripcion": r[3],
                "estado": r[4],
                "prioridad": r[5],
                "categoria_ishikawa": r[6],
                "responsable": r[7],
                "creado_por": r[8],
                "fecha_creacion": r[9],
                "fecha_actualizacion": r[10],
                "fecha_cierre": r[11],
                "nombre_proyecto": r[12],
                "total_seguimientos": int(r[13]),
            }
            for r in rows
        ]
    }


@router.post("/reclamos")
def crear_reclamo(body: ReclamoCreate, user=Depends(get_current_user)):
    """Crear un nuevo reclamo."""
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

    if body.prioridad and body.prioridad not in PRIORIDADES:
        raise HTTPException(status_code=400, detail=f"Prioridad inválida. Válidas: {PRIORIDADES}")
    if body.categoria_ishikawa and body.categoria_ishikawa not in CATEGORIAS_ISHIKAWA:
        raise HTTPException(status_code=400, detail=f"Categoría inválida. Válidas: {CATEGORIAS_ISHIKAWA}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            if body.id_proyecto:
                cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (body.id_proyecto,))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="Proyecto no encontrado")

            cur.execute("""
                INSERT INTO reclamos (id_proyecto, titulo, descripcion, prioridad,
                    categoria_ishikawa, responsable, creado_por, fecha_creacion)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (body.id_proyecto, body.titulo, body.descripcion,
                  body.prioridad or "media", body.categoria_ishikawa,
                  body.responsable, email, now))
            reclamo_id = cur.fetchone()[0]

            # Auto-create first seguimiento
            cur.execute("""
                INSERT INTO reclamo_seguimientos (reclamo_id, usuario, comentario, estado_nuevo, fecha)
                VALUES (%s, %s, %s, %s, %s)
            """, (reclamo_id, email, "Reclamo creado", "abierto", now))

    audit(email, "crear_reclamo", body.titulo, "reclamo", str(reclamo_id))
    return {"ok": True, "id": reclamo_id}


@router.get("/reclamos/kpis")
def reclamos_kpis(user=Depends(get_current_user)):
    """KPIs de reclamos: abiertos, por prioridad, por categoría, tiempo promedio resolución."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Total by estado
            cur.execute("""
                SELECT estado, COUNT(*) FROM reclamos GROUP BY estado
            """)
            por_estado = {r[0]: int(r[1]) for r in cur.fetchall()}

            # Total by prioridad (only open)
            cur.execute("""
                SELECT prioridad, COUNT(*) FROM reclamos
                WHERE estado NOT IN ('cerrado', 'rechazado')
                GROUP BY prioridad
            """)
            por_prioridad = {r[0]: int(r[1]) for r in cur.fetchall()}

            # Total by categoria ishikawa
            cur.execute("""
                SELECT COALESCE(categoria_ishikawa, 'sin_categoria'), COUNT(*)
                FROM reclamos GROUP BY categoria_ishikawa
            """)
            por_categoria = {r[0]: int(r[1]) for r in cur.fetchall()}

            # Average resolution time (days) for closed reclamos
            cur.execute("""
                SELECT AVG(
                    EXTRACT(EPOCH FROM (fecha_cierre::timestamp - fecha_creacion::timestamp)) / 86400.0
                ) FROM reclamos
                WHERE estado = 'cerrado' AND fecha_cierre IS NOT NULL
            """)
            avg_row = cur.fetchone()
            avg_dias_resolucion = round(float(avg_row[0]), 1) if avg_row and avg_row[0] else None

            # Total
            cur.execute("SELECT COUNT(*) FROM reclamos")
            total = int(cur.fetchone()[0])

            abiertos = por_estado.get("abierto", 0) + por_estado.get("en_analisis", 0) + por_estado.get("accion_correctiva", 0)

    return {
        "total": total,
        "abiertos": abiertos,
        "por_estado": por_estado,
        "por_prioridad": por_prioridad,
        "por_categoria": por_categoria,
        "avg_dias_resolucion": avg_dias_resolucion,
    }


@router.get("/reclamos/options")
def reclamos_options(user=Depends(get_current_user)):
    """Devuelve opciones para dropdowns del formulario."""
    return {
        "estados": [{"value": k, "label": v} for k, v in ESTADO_LABELS.items()],
        "prioridades": [{"value": k, "label": v} for k, v in PRIORIDAD_LABELS.items()],
        "categorias_ishikawa": [{"value": k, "label": v} for k, v in ISHIKAWA_LABELS.items()],
    }


@router.get("/reclamos/{reclamo_id}")
def get_reclamo(reclamo_id: int, user=Depends(get_current_user)):
    """Obtener detalle de un reclamo con su timeline de seguimientos."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT r.id, r.id_proyecto, r.titulo, r.descripcion, r.estado,
                       r.prioridad, r.categoria_ishikawa, r.responsable,
                       r.accion_correctiva, r.accion_preventiva, r.resolucion,
                       r.creado_por, r.fecha_creacion, r.fecha_actualizacion, r.fecha_cierre,
                       COALESCE(p.nombre_proyecto, r.id_proyecto) AS nombre_proyecto
                FROM reclamos r
                LEFT JOIN proyectos p ON r.id_proyecto = p.id_proyecto
                WHERE r.id = %s
            """, (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")

            cur.execute("""
                SELECT id, usuario, comentario, estado_anterior, estado_nuevo, fecha
                FROM reclamo_seguimientos
                WHERE reclamo_id = %s
                ORDER BY fecha ASC, id ASC
            """, (reclamo_id,))
            seguimientos = cur.fetchall()

    return {
        "id": row[0],
        "id_proyecto": row[1],
        "titulo": row[2],
        "descripcion": row[3],
        "estado": row[4],
        "prioridad": row[5],
        "categoria_ishikawa": row[6],
        "responsable": row[7],
        "accion_correctiva": row[8],
        "accion_preventiva": row[9],
        "resolucion": row[10],
        "creado_por": row[11],
        "fecha_creacion": row[12],
        "fecha_actualizacion": row[13],
        "fecha_cierre": row[14],
        "nombre_proyecto": row[15],
        "seguimientos": [
            {
                "id": s[0],
                "usuario": s[1],
                "comentario": s[2],
                "estado_anterior": s[3],
                "estado_nuevo": s[4],
                "fecha": s[5],
            }
            for s in seguimientos
        ],
    }


@router.patch("/reclamos/{reclamo_id}")
def actualizar_reclamo(reclamo_id: int, body: ReclamoUpdate, user=Depends(get_current_user)):
    """Actualizar campos de un reclamo. Si cambia estado, crea seguimiento automático."""
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

    if body.estado and body.estado not in ESTADOS_RECLAMO:
        raise HTTPException(status_code=400, detail=f"Estado inválido. Válidos: {list(ESTADOS_RECLAMO)}")
    if body.prioridad and body.prioridad not in PRIORIDADES:
        raise HTTPException(status_code=400, detail=f"Prioridad inválida. Válidas: {list(PRIORIDADES)}")
    if body.categoria_ishikawa and body.categoria_ishikawa not in CATEGORIAS_ISHIKAWA:
        raise HTTPException(status_code=400, detail=f"Categoría inválida. Válidas: {list(CATEGORIAS_ISHIKAWA)}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, estado FROM reclamos WHERE id = %s", (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")
            estado_anterior = row[1]

            sets = ["fecha_actualizacion = %s"]
            params = [now]

            for field in ["titulo", "descripcion", "prioridad", "categoria_ishikawa",
                          "responsable", "accion_correctiva", "accion_preventiva", "resolucion"]:
                val = getattr(body, field)
                if val is not None:
                    sets.append(f"{field} = %s")
                    params.append(val)

            estado_changed = False
            if body.estado and body.estado != estado_anterior:
                sets.append("estado = %s")
                params.append(body.estado)
                estado_changed = True

                # If closing, set fecha_cierre
                if body.estado in ("cerrado", "rechazado"):
                    sets.append("fecha_cierre = %s")
                    params.append(now)
                # If reopening, clear fecha_cierre
                elif estado_anterior in ("cerrado", "rechazado"):
                    sets.append("fecha_cierre = NULL")

            params.append(reclamo_id)
            cur.execute(f"UPDATE reclamos SET {', '.join(sets)} WHERE id = %s", params)

            # Auto-create seguimiento for state change
            if estado_changed:
                comment = f"Estado cambiado: {ESTADO_LABELS.get(estado_anterior, estado_anterior)} → {ESTADO_LABELS.get(body.estado, body.estado)}"
                cur.execute("""
                    INSERT INTO reclamo_seguimientos (reclamo_id, usuario, comentario, estado_anterior, estado_nuevo, fecha)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (reclamo_id, email, comment, estado_anterior, body.estado, now))

    campos = [s.split(" =")[0] for s in sets if s != "fecha_actualizacion = %s"]
    audit(email, "actualizar_reclamo", f"campos: {', '.join(campos)}", "reclamo", str(reclamo_id))
    return {"ok": True, "id": reclamo_id}


@router.delete("/reclamos/{reclamo_id}")
def eliminar_reclamo(reclamo_id: int, user=Depends(get_current_user)):
    """Eliminar un reclamo y todos sus seguimientos."""
    email = user.get("email", "unknown")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, titulo FROM reclamos WHERE id = %s", (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")
            titulo = row[1]
            cur.execute("DELETE FROM reclamo_seguimientos WHERE reclamo_id = %s", (reclamo_id,))
            seg_deleted = cur.rowcount
            cur.execute("DELETE FROM reclamos WHERE id = %s", (reclamo_id,))

    audit(email, "eliminar_reclamo", f"{titulo} ({seg_deleted} seguimientos)", "reclamo", str(reclamo_id))
    return {"ok": True, "id": reclamo_id, "seguimientos_eliminados": seg_deleted}


# ========================= SEGUIMIENTOS =========================

@router.post("/reclamos/{reclamo_id}/seguimientos")
def crear_seguimiento(reclamo_id: int, body: SeguimientoCreate, user=Depends(get_current_user)):
    """Agregar un seguimiento (comentario) a un reclamo. Opcionalmente cambia estado."""
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

    if body.estado_nuevo and body.estado_nuevo not in ESTADOS_RECLAMO:
        raise HTTPException(status_code=400, detail=f"Estado inválido. Válidos: {list(ESTADOS_RECLAMO)}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, estado FROM reclamos WHERE id = %s", (reclamo_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reclamo no encontrado")
            estado_anterior = row[1]

            estado_nuevo = body.estado_nuevo
            if estado_nuevo and estado_nuevo == estado_anterior:
                estado_nuevo = None  # no real change

            cur.execute("""
                INSERT INTO reclamo_seguimientos (reclamo_id, usuario, comentario, estado_anterior, estado_nuevo, fecha)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (reclamo_id, email, body.comentario,
                  estado_anterior if estado_nuevo else None,
                  estado_nuevo, now))
            seg_id = cur.fetchone()[0]

            # Update reclamo if state changed
            if estado_nuevo:
                sets = ["estado = %s", "fecha_actualizacion = %s"]
                params = [estado_nuevo, now]
                if estado_nuevo in ("cerrado", "rechazado"):
                    sets.append("fecha_cierre = %s")
                    params.append(now)
                elif estado_anterior in ("cerrado", "rechazado"):
                    sets.append("fecha_cierre = NULL")
                params.append(reclamo_id)
                cur.execute(f"UPDATE reclamos SET {', '.join(sets)} WHERE id = %s", params)
            else:
                cur.execute("UPDATE reclamos SET fecha_actualizacion = %s WHERE id = %s", (now, reclamo_id))

    audit(email, "seguimiento_reclamo", body.comentario[:100] if body.comentario else "", "reclamo", str(reclamo_id))
    return {"ok": True, "id": seg_id}
