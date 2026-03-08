"""
pedidos.py
----------
CRUD endpoints para sistema de pedidos de material.
"""

from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from .auth import get_current_user
from .db import get_conn

router = APIRouter()


# ========================= MODELS =========================

class PedidoItemCreate(BaseModel):
    diam: float
    largo: Optional[float] = None
    cantidad: int = 1
    sector: Optional[str] = None
    piso: Optional[str] = None
    ciclo: Optional[str] = None
    nota: Optional[str] = None


class PedidoCreate(BaseModel):
    id_proyecto: str
    titulo: str
    descripcion: Optional[str] = None
    items: List[PedidoItemCreate] = []


class PedidoUpdate(BaseModel):
    titulo: Optional[str] = None
    descripcion: Optional[str] = None
    estado: Optional[str] = None


class PedidoItemUpdate(BaseModel):
    diam: Optional[float] = None
    largo: Optional[float] = None
    cantidad: Optional[int] = None
    sector: Optional[str] = None
    piso: Optional[str] = None
    ciclo: Optional[str] = None
    nota: Optional[str] = None
    estado: Optional[str] = None


# ========================= PEDIDOS =========================

@router.get("/pedidos")
def list_pedidos(
    id_proyecto: Optional[str] = None,
    estado: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Lista pedidos, opcionalmente filtrados por proyecto y/o estado."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            where = "WHERE 1=1"
            params = []
            if id_proyecto:
                where += " AND p.id_proyecto = %s"
                params.append(id_proyecto)
            if estado:
                where += " AND p.estado = %s"
                params.append(estado)

            cur.execute(f"""
                SELECT p.id, p.id_proyecto, p.titulo, p.descripcion, p.estado,
                       p.creado_por, p.fecha_creacion, p.fecha_actualizacion,
                       COALESCE(pr.nombre_proyecto, p.id_proyecto) AS nombre_proyecto,
                       (SELECT COUNT(*) FROM pedido_items pi WHERE pi.pedido_id = p.id) AS total_items
                FROM pedidos p
                LEFT JOIN proyectos pr ON p.id_proyecto = pr.id_proyecto
                {where}
                ORDER BY p.id DESC
            """, params)
            rows = cur.fetchall()

    return {
        "pedidos": [
            {
                "id": r[0],
                "id_proyecto": r[1],
                "titulo": r[2],
                "descripcion": r[3],
                "estado": r[4],
                "creado_por": r[5],
                "fecha_creacion": r[6],
                "fecha_actualizacion": r[7],
                "nombre_proyecto": r[8],
                "total_items": int(r[9]),
            }
            for r in rows
        ]
    }


@router.post("/pedidos")
def crear_pedido(body: PedidoCreate, user=Depends(get_current_user)):
    """Crear un pedido con items opcionales."""
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (body.id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")

            cur.execute("""
                INSERT INTO pedidos (id_proyecto, titulo, descripcion, creado_por, fecha_creacion)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            """, (body.id_proyecto, body.titulo, body.descripcion, email, now))
            pedido_id = cur.fetchone()[0]

            for item in body.items:
                cur.execute("""
                    INSERT INTO pedido_items (pedido_id, diam, largo, cantidad, sector, piso, ciclo, nota)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (pedido_id, item.diam, item.largo, item.cantidad,
                      item.sector, item.piso, item.ciclo, item.nota))

    return {"ok": True, "id": pedido_id}


@router.get("/pedidos/{pedido_id}")
def get_pedido(pedido_id: int, user=Depends(get_current_user)):
    """Obtener un pedido con todos sus items."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.id, p.id_proyecto, p.titulo, p.descripcion, p.estado,
                       p.creado_por, p.fecha_creacion, p.fecha_actualizacion,
                       COALESCE(pr.nombre_proyecto, p.id_proyecto) AS nombre_proyecto
                FROM pedidos p
                LEFT JOIN proyectos pr ON p.id_proyecto = pr.id_proyecto
                WHERE p.id = %s
            """, (pedido_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pedido no encontrado")

            cur.execute("""
                SELECT id, diam, largo, cantidad, sector, piso, ciclo, nota, estado
                FROM pedido_items
                WHERE pedido_id = %s
                ORDER BY id
            """, (pedido_id,))
            items = cur.fetchall()

    return {
        "id": row[0],
        "id_proyecto": row[1],
        "titulo": row[2],
        "descripcion": row[3],
        "estado": row[4],
        "creado_por": row[5],
        "fecha_creacion": row[6],
        "fecha_actualizacion": row[7],
        "nombre_proyecto": row[8],
        "items": [
            {
                "id": i[0],
                "diam": i[1],
                "largo": i[2],
                "cantidad": int(i[3]),
                "sector": i[4],
                "piso": i[5],
                "ciclo": i[6],
                "nota": i[7],
                "estado": i[8],
            }
            for i in items
        ],
    }


@router.patch("/pedidos/{pedido_id}")
def update_pedido(pedido_id: int, body: PedidoUpdate, user=Depends(get_current_user)):
    """Actualizar título, descripción o estado de un pedido."""
    ESTADOS_VALIDOS = {"borrador", "enviado", "en_proceso", "completado", "cancelado"}
    if body.estado and body.estado not in ESTADOS_VALIDOS:
        raise HTTPException(status_code=400, detail=f"Estado inválido. Válidos: {sorted(ESTADOS_VALIDOS)}")

    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM pedidos WHERE id = %s", (pedido_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Pedido no encontrado")

            sets = ["fecha_actualizacion = %s"]
            params = [now]
            if body.titulo is not None:
                sets.append("titulo = %s")
                params.append(body.titulo)
            if body.descripcion is not None:
                sets.append("descripcion = %s")
                params.append(body.descripcion)
            if body.estado is not None:
                sets.append("estado = %s")
                params.append(body.estado)

            params.append(pedido_id)
            cur.execute(f"UPDATE pedidos SET {', '.join(sets)} WHERE id = %s", params)

    return {"ok": True}


@router.delete("/pedidos/{pedido_id}")
def delete_pedido(pedido_id: int, user=Depends(get_current_user)):
    """Eliminar un pedido y todos sus items."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM pedidos WHERE id = %s", (pedido_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Pedido no encontrado")
            cur.execute("DELETE FROM pedido_items WHERE pedido_id = %s", (pedido_id,))
            items_deleted = cur.rowcount
            cur.execute("DELETE FROM pedidos WHERE id = %s", (pedido_id,))

    return {"ok": True, "items_eliminados": items_deleted}


# ========================= PEDIDO ITEMS =========================

@router.post("/pedidos/{pedido_id}/items")
def add_pedido_item(pedido_id: int, body: PedidoItemCreate, user=Depends(get_current_user)):
    """Agregar un item a un pedido existente."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, estado FROM pedidos WHERE id = %s", (pedido_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pedido no encontrado")
            if row[1] not in ("borrador", "en_proceso"):
                raise HTTPException(status_code=400, detail="Solo se pueden agregar items a pedidos en borrador o en proceso")

            cur.execute("""
                INSERT INTO pedido_items (pedido_id, diam, largo, cantidad, sector, piso, ciclo, nota)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (pedido_id, body.diam, body.largo, body.cantidad,
                  body.sector, body.piso, body.ciclo, body.nota))
            item_id = cur.fetchone()[0]

            now = datetime.now(timezone.utc).isoformat()
            cur.execute("UPDATE pedidos SET fecha_actualizacion = %s WHERE id = %s", (now, pedido_id))

    return {"ok": True, "id": item_id}


@router.patch("/pedidos/{pedido_id}/items/{item_id}")
def update_pedido_item(pedido_id: int, item_id: int, body: PedidoItemUpdate, user=Depends(get_current_user)):
    """Actualizar un item de pedido."""
    ESTADOS_ITEM = {"pendiente", "en_proceso", "completado"}
    if body.estado and body.estado not in ESTADOS_ITEM:
        raise HTTPException(status_code=400, detail=f"Estado inválido. Válidos: {sorted(ESTADOS_ITEM)}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM pedido_items WHERE id = %s AND pedido_id = %s", (item_id, pedido_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Item no encontrado")

            sets = []
            params = []
            for field in ["diam", "largo", "cantidad", "sector", "piso", "ciclo", "nota", "estado"]:
                val = getattr(body, field)
                if val is not None:
                    sets.append(f"{field} = %s")
                    params.append(val)

            if not sets:
                return {"ok": True, "message": "Sin cambios"}

            params.append(item_id)
            cur.execute(f"UPDATE pedido_items SET {', '.join(sets)} WHERE id = %s", params)

            now = datetime.now(timezone.utc).isoformat()
            cur.execute("UPDATE pedidos SET fecha_actualizacion = %s WHERE id = %s", (now, pedido_id))

    return {"ok": True}


@router.delete("/pedidos/{pedido_id}/items/{item_id}")
def delete_pedido_item(pedido_id: int, item_id: int, user=Depends(get_current_user)):
    """Eliminar un item de un pedido."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM pedido_items WHERE id = %s AND pedido_id = %s", (item_id, pedido_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Item no encontrado")
            cur.execute("DELETE FROM pedido_items WHERE id = %s", (item_id,))

            now = datetime.now(timezone.utc).isoformat()
            cur.execute("UPDATE pedidos SET fecha_actualizacion = %s WHERE id = %s", (now, pedido_id))

    return {"ok": True}
