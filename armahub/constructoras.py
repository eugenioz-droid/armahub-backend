"""
constructoras.py
----------------
CRUD para gestión de constructoras (antes clientes/mandantes/empresas).

Endpoints:
- GET    /constructoras          — listar constructoras (con stats de proyectos)
- GET    /constructoras/{id}     — detalle de una constructora
- POST   /constructoras          — crear constructora
- PATCH  /constructoras/{id}     — actualizar constructora
- DELETE /constructoras/{id}     — desactivar constructora (soft delete)
- POST   /proyectos/{id_proyecto}/asignar-constructora — asignar constructora a proyecto
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import get_current_user
from .db import get_conn, audit

router = APIRouter()


class ConstructoraCreate(BaseModel):
    nombre: str
    rut: Optional[str] = None
    contacto: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None
    direccion: Optional[str] = None
    notas: Optional[str] = None


class ConstructoraUpdate(BaseModel):
    nombre: Optional[str] = None
    rut: Optional[str] = None
    contacto: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None
    direccion: Optional[str] = None
    notas: Optional[str] = None
    activo: Optional[bool] = None


@router.get("/constructoras")
def listar_constructoras(activo: Optional[bool] = None, user=Depends(get_current_user)):
    """Listar constructoras con conteo de proyectos asociados."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            where = ""
            params = []
            if activo is not None:
                where = " WHERE c.activo = %s"
                params.append(activo)

            cur.execute("""
                SELECT c.id, c.nombre, c.rut, c.contacto, c.email, c.telefono,
                       c.direccion, c.notas, c.activo, c.fecha_creacion,
                       COUNT(p.id_proyecto) AS proyectos_count,
                       COALESCE(SUM(stats.barras), 0) AS total_barras,
                       COALESCE(SUM(stats.kilos), 0) AS total_kilos
                FROM constructoras c
                LEFT JOIN proyectos p ON p.constructora_id = c.id
                LEFT JOIN (
                    SELECT id_proyecto, COUNT(*) AS barras, COALESCE(SUM(peso_total), 0) AS kilos
                    FROM barras GROUP BY id_proyecto
                ) stats ON stats.id_proyecto = p.id_proyecto
            """ + where + """
                GROUP BY c.id, c.nombre, c.rut, c.contacto, c.email, c.telefono,
                         c.direccion, c.notas, c.activo, c.fecha_creacion
                ORDER BY c.nombre
            """, params)
            rows = cur.fetchall()

    return {
        "constructoras": [
            {
                "id": r[0], "nombre": r[1], "rut": r[2], "contacto": r[3],
                "email": r[4], "telefono": r[5], "direccion": r[6], "notas": r[7],
                "activo": r[8], "fecha_creacion": r[9],
                "proyectos_count": int(r[10]),
                "total_barras": int(r[11]),
                "total_kilos": round(float(r[12]), 2),
            }
            for r in rows
        ]
    }


@router.get("/constructoras/{constructora_id}")
def detalle_constructora(constructora_id: int, user=Depends(get_current_user)):
    """Detalle de una constructora con sus proyectos."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, nombre, rut, contacto, email, telefono,
                       direccion, notas, activo, fecha_creacion
                FROM constructoras WHERE id = %s
            """, (constructora_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Constructora no encontrada")

            constructora = {
                "id": r[0], "nombre": r[1], "rut": r[2], "contacto": r[3],
                "email": r[4], "telefono": r[5], "direccion": r[6], "notas": r[7],
                "activo": r[8], "fecha_creacion": r[9],
            }

            cur.execute("""
                SELECT p.id_proyecto, p.nombre_proyecto,
                       COUNT(b.id_unico) AS barras,
                       COALESCE(SUM(b.peso_total), 0) AS kilos
                FROM proyectos p
                LEFT JOIN barras b ON b.id_proyecto = p.id_proyecto
                WHERE p.constructora_id = %s
                GROUP BY p.id_proyecto, p.nombre_proyecto
                ORDER BY p.nombre_proyecto
            """, (constructora_id,))
            proyectos = [
                {
                    "id_proyecto": pr[0], "nombre_proyecto": pr[1],
                    "barras": int(pr[2]), "kilos": round(float(pr[3]), 2),
                }
                for pr in cur.fetchall()
            ]

    constructora["proyectos"] = proyectos
    return constructora


@router.post("/constructoras")
def crear_constructora(body: ConstructoraCreate, user=Depends(get_current_user)):
    """Crear una nueva constructora."""
    nombre = body.nombre.strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="El nombre es requerido")

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO constructoras (nombre, rut, contacto, email, telefono, direccion, notas)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (nombre, body.rut, body.contacto, body.email, body.telefono, body.direccion, body.notas))
                new_id = cur.fetchone()[0]
        audit(user.get("email", "?"), "crear_constructora", nombre, "constructora", str(new_id))
        return {"ok": True, "id": new_id, "nombre": nombre}
    except Exception as e:
        if "idx_constructoras_nombre" in str(e):
            raise HTTPException(status_code=400, detail="Ya existe una constructora con ese nombre")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/constructoras/{constructora_id}")
def actualizar_constructora(constructora_id: int, body: ConstructoraUpdate, user=Depends(get_current_user)):
    """Actualizar datos de una constructora."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM constructoras WHERE id = %s", (constructora_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Constructora no encontrada")

            sets = []
            params = []
            for field in ["nombre", "rut", "contacto", "email", "telefono", "direccion", "notas"]:
                val = getattr(body, field, None)
                if val is not None:
                    sets.append(f"{field} = %s")
                    params.append(val.strip() if isinstance(val, str) else val)
            if body.activo is not None:
                sets.append("activo = %s")
                params.append(body.activo)

            if not sets:
                raise HTTPException(status_code=400, detail="Nada que actualizar")

            params.append(constructora_id)
            try:
                cur.execute(f"UPDATE constructoras SET {', '.join(sets)} WHERE id = %s", params)
            except Exception as e:
                if "idx_constructoras_nombre" in str(e):
                    raise HTTPException(status_code=400, detail="Ya existe una constructora con ese nombre")
                raise

    audit(user.get("email", "?"), "editar_constructora", f"campos: {', '.join(s.split(' =')[0] for s in sets)}", "constructora", str(constructora_id))
    return {"ok": True, "id": constructora_id}


@router.delete("/constructoras/{constructora_id}")
def eliminar_constructora(constructora_id: int, user=Depends(get_current_user)):
    """Soft-delete: desactiva la constructora. Los proyectos mantienen la referencia."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM constructoras WHERE id = %s", (constructora_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Constructora no encontrada")
            cur.execute("UPDATE constructoras SET activo = FALSE WHERE id = %s", (constructora_id,))
    audit(user.get("email", "?"), "desactivar_constructora", None, "constructora", str(constructora_id))
    return {"ok": True, "id": constructora_id}


@router.post("/proyectos/{id_proyecto}/asignar-constructora")
def asignar_constructora(id_proyecto: str, constructora_id: Optional[int] = None, user=Depends(get_current_user)):
    """Asignar o desasignar una constructora a un proyecto. constructora_id=null para desasignar."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")

            if constructora_id is not None:
                cur.execute("SELECT id FROM constructoras WHERE id = %s", (constructora_id,))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="Constructora no encontrada")

            cur.execute("UPDATE proyectos SET constructora_id = %s WHERE id_proyecto = %s", (constructora_id, id_proyecto))
    audit(user.get("email", "?"), "asignar_constructora", f"constructora_id={constructora_id}", "proyecto", id_proyecto)
    return {"ok": True, "id_proyecto": id_proyecto, "constructora_id": constructora_id}
