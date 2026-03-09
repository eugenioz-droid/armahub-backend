"""
clientes.py
-----------
CRUD para gestión de clientes (mandantes/empresas).

Endpoints:
- GET    /clientes          — listar clientes (con stats de proyectos)
- GET    /clientes/{id}     — detalle de un cliente
- POST   /clientes          — crear cliente
- PATCH  /clientes/{id}     — actualizar cliente
- DELETE /clientes/{id}     — desactivar cliente (soft delete)
- POST   /proyectos/{id_proyecto}/asignar-cliente — asignar cliente a proyecto
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import get_current_user
from .db import get_conn, audit

router = APIRouter()


class ClienteCreate(BaseModel):
    nombre: str
    rut: Optional[str] = None
    contacto: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None
    direccion: Optional[str] = None
    notas: Optional[str] = None


class ClienteUpdate(BaseModel):
    nombre: Optional[str] = None
    rut: Optional[str] = None
    contacto: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None
    direccion: Optional[str] = None
    notas: Optional[str] = None
    activo: Optional[bool] = None


@router.get("/clientes")
def listar_clientes(activo: Optional[bool] = None, user=Depends(get_current_user)):
    """Listar clientes con conteo de proyectos asociados."""
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
                FROM clientes c
                LEFT JOIN proyectos p ON p.cliente_id = c.id
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
        "clientes": [
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


@router.get("/clientes/{cliente_id}")
def detalle_cliente(cliente_id: int, user=Depends(get_current_user)):
    """Detalle de un cliente con sus proyectos."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, nombre, rut, contacto, email, telefono,
                       direccion, notas, activo, fecha_creacion
                FROM clientes WHERE id = %s
            """, (cliente_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Cliente no encontrado")

            cliente = {
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
                WHERE p.cliente_id = %s
                GROUP BY p.id_proyecto, p.nombre_proyecto
                ORDER BY p.nombre_proyecto
            """, (cliente_id,))
            proyectos = [
                {
                    "id_proyecto": pr[0], "nombre_proyecto": pr[1],
                    "barras": int(pr[2]), "kilos": round(float(pr[3]), 2),
                }
                for pr in cur.fetchall()
            ]

    cliente["proyectos"] = proyectos
    return cliente


@router.post("/clientes")
def crear_cliente(body: ClienteCreate, user=Depends(get_current_user)):
    """Crear un nuevo cliente."""
    nombre = body.nombre.strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="El nombre es requerido")

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO clientes (nombre, rut, contacto, email, telefono, direccion, notas)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (nombre, body.rut, body.contacto, body.email, body.telefono, body.direccion, body.notas))
                new_id = cur.fetchone()[0]
        audit(user.get("email", "?"), "crear_cliente", nombre, "cliente", str(new_id))
        return {"ok": True, "id": new_id, "nombre": nombre}
    except Exception as e:
        if "idx_clientes_nombre" in str(e):
            raise HTTPException(status_code=400, detail="Ya existe un cliente con ese nombre")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/clientes/{cliente_id}")
def actualizar_cliente(cliente_id: int, body: ClienteUpdate, user=Depends(get_current_user)):
    """Actualizar datos de un cliente."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM clientes WHERE id = %s", (cliente_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Cliente no encontrado")

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

            params.append(cliente_id)
            try:
                cur.execute(f"UPDATE clientes SET {', '.join(sets)} WHERE id = %s", params)
            except Exception as e:
                if "idx_clientes_nombre" in str(e):
                    raise HTTPException(status_code=400, detail="Ya existe un cliente con ese nombre")
                raise

    audit(user.get("email", "?"), "editar_cliente", f"campos: {', '.join(s.split(' =')[0] for s in sets)}", "cliente", str(cliente_id))
    return {"ok": True, "id": cliente_id}


@router.delete("/clientes/{cliente_id}")
def eliminar_cliente(cliente_id: int, user=Depends(get_current_user)):
    """Soft-delete: desactiva el cliente. Los proyectos mantienen la referencia."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM clientes WHERE id = %s", (cliente_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Cliente no encontrado")
            cur.execute("UPDATE clientes SET activo = FALSE WHERE id = %s", (cliente_id,))
    audit(user.get("email", "?"), "desactivar_cliente", None, "cliente", str(cliente_id))
    return {"ok": True, "id": cliente_id}


@router.post("/proyectos/{id_proyecto}/asignar-cliente")
def asignar_cliente(id_proyecto: str, cliente_id: Optional[int] = None, user=Depends(get_current_user)):
    """Asignar o desasignar un cliente a un proyecto. cliente_id=null para desasignar."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")

            if cliente_id is not None:
                cur.execute("SELECT id FROM clientes WHERE id = %s", (cliente_id,))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="Cliente no encontrado")

            cur.execute("UPDATE proyectos SET cliente_id = %s WHERE id_proyecto = %s", (cliente_id, id_proyecto))
    audit(user.get("email", "?"), "asignar_cliente", f"cliente_id={cliente_id}", "proyecto", id_proyecto)
    return {"ok": True, "id_proyecto": id_proyecto, "cliente_id": cliente_id}
