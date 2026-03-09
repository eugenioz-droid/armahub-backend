"""
calculistas.py
--------------
CRUD para gestión de calculistas + KPIs analíticos.

Endpoints:
- GET    /calculistas          — listar calculistas (con stats)
- GET    /calculistas/{id}     — detalle de un calculista con proyectos
- POST   /calculistas          — crear calculista
- PATCH  /calculistas/{id}     — actualizar calculista
- DELETE /calculistas/{id}     — desactivar calculista (soft delete)
- GET    /calculistas/kpis     — KPIs comparativos entre calculistas
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import get_current_user
from .db import get_conn, audit

router = APIRouter()


class CalculistaCreate(BaseModel):
    nombre: str
    email: Optional[str] = None


class CalculistaUpdate(BaseModel):
    nombre: Optional[str] = None
    email: Optional[str] = None
    activo: Optional[bool] = None


@router.get("/calculistas")
def listar_calculistas(activo: Optional[bool] = None, user=Depends(get_current_user)):
    """Listar calculistas con conteo de proyectos y stats."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            where = ""
            params = []
            if activo is not None:
                where = " WHERE c.activo = %s"
                params.append(activo)

            cur.execute("""
                SELECT c.id, c.nombre, c.email, c.activo, c.fecha_creacion,
                       COUNT(DISTINCT p.id_proyecto) AS proyectos_count,
                       COALESCE(SUM(stats.barras), 0) AS total_barras,
                       COALESCE(SUM(stats.kilos), 0) AS total_kilos
                FROM calculistas c
                LEFT JOIN proyectos p ON p.calculista_id = c.id
                LEFT JOIN (
                    SELECT id_proyecto, COUNT(*) AS barras, COALESCE(SUM(peso_total), 0) AS kilos
                    FROM barras GROUP BY id_proyecto
                ) stats ON stats.id_proyecto = p.id_proyecto
            """ + where + """
                GROUP BY c.id, c.nombre, c.email, c.activo, c.fecha_creacion
                ORDER BY c.nombre
            """, params)
            rows = cur.fetchall()

    return {
        "calculistas": [
            {
                "id": r[0], "nombre": r[1], "email": r[2],
                "activo": r[3], "fecha_creacion": r[4],
                "proyectos_count": int(r[5]),
                "total_barras": int(r[6]),
                "total_kilos": round(float(r[7]), 2),
            }
            for r in rows
        ]
    }


@router.get("/calculistas/kpis")
def kpis_calculistas(user=Depends(get_current_user)):
    """KPIs comparativos por calculista: diam promedio ponderado, PPI, PPB, kilos, proyectos."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    c.id,
                    c.nombre,
                    COUNT(DISTINCT p.id_proyecto) AS proyectos,
                    COUNT(b.id_unico) AS barras,
                    COALESCE(SUM(b.peso_total), 0) AS kilos,
                    CASE WHEN COUNT(b.id_unico) > 0
                        THEN SUM(b.diam * b.peso_total) / NULLIF(SUM(b.peso_total), 0)
                        ELSE 0
                    END AS diam_prom_ponderado,
                    CASE WHEN COUNT(DISTINCT p.id_proyecto) > 0
                        THEN COALESCE(SUM(b.peso_total), 0) / COUNT(DISTINCT p.id_proyecto)
                        ELSE 0
                    END AS ppi,
                    CASE WHEN COUNT(b.id_unico) > 0
                        THEN COALESCE(SUM(b.peso_total), 0) / COUNT(b.id_unico)
                        ELSE 0
                    END AS ppb
                FROM calculistas c
                LEFT JOIN proyectos p ON p.calculista_id = c.id
                LEFT JOIN barras b ON b.id_proyecto = p.id_proyecto
                WHERE c.activo = TRUE
                GROUP BY c.id, c.nombre
                ORDER BY kilos DESC
            """)
            rows = cur.fetchall()

    return {
        "kpis": [
            {
                "id": r[0],
                "nombre": r[1],
                "proyectos": int(r[2]),
                "barras": int(r[3]),
                "kilos": round(float(r[4]), 2),
                "diam_prom_ponderado": round(float(r[5]), 1) if r[5] else 0,
                "ppi": round(float(r[6]), 2),
                "ppb": round(float(r[7]), 3) if r[7] else 0,
            }
            for r in rows
        ]
    }


@router.get("/calculistas/{calculista_id}")
def detalle_calculista(calculista_id: int, user=Depends(get_current_user)):
    """Detalle de un calculista con sus proyectos."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, nombre, email, activo, fecha_creacion
                FROM calculistas WHERE id = %s
            """, (calculista_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Calculista no encontrado")

            calc = {
                "id": r[0], "nombre": r[1], "email": r[2],
                "activo": r[3], "fecha_creacion": r[4],
            }

            cur.execute("""
                SELECT p.id_proyecto, p.nombre_proyecto,
                       COUNT(b.id_unico) AS barras,
                       COALESCE(SUM(b.peso_total), 0) AS kilos
                FROM proyectos p
                LEFT JOIN barras b ON b.id_proyecto = p.id_proyecto
                WHERE p.calculista_id = %s
                GROUP BY p.id_proyecto, p.nombre_proyecto
                ORDER BY p.nombre_proyecto
            """, (calculista_id,))
            proyectos = [
                {
                    "id_proyecto": pr[0], "nombre_proyecto": pr[1],
                    "barras": int(pr[2]), "kilos": round(float(pr[3]), 2),
                }
                for pr in cur.fetchall()
            ]

    calc["proyectos"] = proyectos
    return calc


@router.post("/calculistas")
def crear_calculista(body: CalculistaCreate, user=Depends(get_current_user)):
    """Crear un nuevo calculista."""
    nombre = body.nombre.strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="El nombre es requerido")

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO calculistas (nombre, email)
                    VALUES (%s, %s)
                    RETURNING id
                """, (nombre, body.email))
                new_id = cur.fetchone()[0]
        audit(user.get("email", "?"), "crear_calculista", nombre, "calculista", str(new_id))
        return {"ok": True, "id": new_id, "nombre": nombre}
    except Exception as e:
        if "idx_calculistas_nombre" in str(e):
            raise HTTPException(status_code=400, detail="Ya existe un calculista con ese nombre")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/calculistas/{calculista_id}")
def actualizar_calculista(calculista_id: int, body: CalculistaUpdate, user=Depends(get_current_user)):
    """Actualizar datos de un calculista."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM calculistas WHERE id = %s", (calculista_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Calculista no encontrado")

            sets = []
            params = []
            for field in ["nombre", "email"]:
                val = getattr(body, field, None)
                if val is not None:
                    sets.append(f"{field} = %s")
                    params.append(val.strip() if isinstance(val, str) else val)
            if body.activo is not None:
                sets.append("activo = %s")
                params.append(body.activo)

            if not sets:
                raise HTTPException(status_code=400, detail="Nada que actualizar")

            params.append(calculista_id)
            try:
                cur.execute(f"UPDATE calculistas SET {', '.join(sets)} WHERE id = %s", params)
            except Exception as e:
                if "idx_calculistas_nombre" in str(e):
                    raise HTTPException(status_code=400, detail="Ya existe un calculista con ese nombre")
                raise

    audit(user.get("email", "?"), "editar_calculista", f"campos: {', '.join(s.split(' =')[0] for s in sets)}", "calculista", str(calculista_id))
    return {"ok": True, "id": calculista_id}


@router.delete("/calculistas/{calculista_id}")
def eliminar_calculista(calculista_id: int, user=Depends(get_current_user)):
    """Soft-delete: desactiva el calculista."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM calculistas WHERE id = %s", (calculista_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Calculista no encontrado")
            cur.execute("UPDATE calculistas SET activo = FALSE WHERE id = %s", (calculista_id,))
    audit(user.get("email", "?"), "desactivar_calculista", None, "calculista", str(calculista_id))
    return {"ok": True, "id": calculista_id}
