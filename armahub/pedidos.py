"""
pedidos.py
----------
CRUD endpoints para sistema de pedidos de material.
"""

from datetime import datetime, timezone
from typing import Optional, List
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from .auth import get_current_user
from .db import get_conn, audit

router = APIRouter()


# ========================= MODELS =========================

# Validación EJE para aSa Studio: max 14 chars, alfanumérico + espacios
_EJE_RE = re.compile(r'^[A-Za-z0-9 ]{1,14}$')

def _validar_eje(eje: str) -> str:
    """Valida y limpia el campo eje para compatibilidad con aSa Studio."""
    eje = eje.strip()
    if len(eje) > 14:
        raise HTTPException(status_code=400, detail="EJE no puede exceder 14 caracteres")
    if not _EJE_RE.match(eje):
        raise HTTPException(status_code=400, detail="EJE solo permite caracteres alfanuméricos y espacios (sin tildes, ñ, símbolos)")
    return eje


class PedidoItemCreate(BaseModel):
    eje: Optional[str] = None
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
    tipo: str = 'generico'
    items: List[PedidoItemCreate] = []


class PedidoUpdate(BaseModel):
    titulo: Optional[str] = None
    descripcion: Optional[str] = None
    estado: Optional[str] = None


class PedidoItemUpdate(BaseModel):
    eje: Optional[str] = None
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
                       (SELECT COUNT(*) FROM pedido_items pi WHERE pi.pedido_id = p.id) AS total_items,
                       p.tipo, p.procesado
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
                "tipo": r[10],
                "procesado": r[11],
            }
            for r in rows
        ]
    }


@router.post("/pedidos")
def crear_pedido(body: PedidoCreate, user=Depends(get_current_user)):
    """Crear un pedido con items opcionales."""
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

    if body.tipo not in ('generico', 'especifico'):
        raise HTTPException(status_code=400, detail="Tipo debe ser 'generico' o 'especifico'")

    # Validar ejes de items
    for item in body.items:
        if item.eje:
            item.eje = _validar_eje(item.eje)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (body.id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")

            cur.execute("""
                INSERT INTO pedidos (id_proyecto, titulo, descripcion, tipo, creado_por, fecha_creacion)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (body.id_proyecto, body.titulo, body.descripcion, body.tipo, email, now))
            pedido_id = cur.fetchone()[0]

            for item in body.items:
                cur.execute("""
                    INSERT INTO pedido_items (pedido_id, eje, diam, largo, cantidad, sector, piso, ciclo, nota)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (pedido_id, item.eje, item.diam, item.largo, item.cantidad,
                      item.sector, item.piso, item.ciclo, item.nota))

    audit(email, "crear_pedido", f"Pedido #{pedido_id} ({body.tipo}) en {body.id_proyecto}", "pedido", str(pedido_id))
    return {"ok": True, "id": pedido_id}


@router.get("/pedidos/{pedido_id}")
def get_pedido(pedido_id: int, user=Depends(get_current_user)):
    """Obtener un pedido con todos sus items."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.id, p.id_proyecto, p.titulo, p.descripcion, p.estado,
                       p.creado_por, p.fecha_creacion, p.fecha_actualizacion,
                       COALESCE(pr.nombre_proyecto, p.id_proyecto) AS nombre_proyecto,
                       p.tipo, p.procesado
                FROM pedidos p
                LEFT JOIN proyectos pr ON p.id_proyecto = pr.id_proyecto
                WHERE p.id = %s
            """, (pedido_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pedido no encontrado")

            cur.execute("""
                SELECT id, eje, diam, largo, cantidad, sector, piso, ciclo, nota, estado
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
        "tipo": row[9],
        "procesado": row[10],
        "items": [
            {
                "id": i[0],
                "eje": i[1],
                "diam": i[2],
                "largo": i[3],
                "cantidad": int(i[4]),
                "sector": i[5],
                "piso": i[6],
                "ciclo": i[7],
                "nota": i[8],
                "estado": i[9],
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

            eje = _validar_eje(body.eje) if body.eje else body.eje
            cur.execute("""
                INSERT INTO pedido_items (pedido_id, eje, diam, largo, cantidad, sector, piso, ciclo, nota)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (pedido_id, eje, body.diam, body.largo, body.cantidad,
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

            if body.eje is not None and body.eje.strip():
                body.eje = _validar_eje(body.eje)

            sets = []
            params = []
            for field in ["eje", "diam", "largo", "cantidad", "sector", "piso", "ciclo", "nota", "estado"]:
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


# ========================= PROCESAR PEDIDO → BARRAS =========================

def _calcular_peso(diam, largo):
    """Fórmula ArmaHub: diam mm, largo cm => kg."""
    if diam is None or largo is None:
        return None
    return 7850 * 3.1416 * (diam / 2000) ** 2 * (largo / 100)


@router.post("/pedidos/{pedido_id}/procesar")
def procesar_pedido(pedido_id: int, user=Depends(get_current_user)):
    """Convierte los items de un pedido en barras con origen='pedido'.

    - Pedido genérico: sector=NA, piso=NA, ciclo=NA
    - Pedido específico: usa sector/piso/ciclo del item
    - Cada item genera una barra con id_unico PED-{uuid}
    - Las barras quedan vinculadas al pedido via pedido_id y pedido_item_id
    """
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.id, p.id_proyecto, p.tipo, p.procesado, p.estado,
                       COALESCE(pr.nombre_proyecto, p.id_proyecto)
                FROM pedidos p
                LEFT JOIN proyectos pr ON p.id_proyecto = pr.id_proyecto
                WHERE p.id = %s
            """, (pedido_id,))
            prow = cur.fetchone()
            if not prow:
                raise HTTPException(status_code=404, detail="Pedido no encontrado")

            id_proyecto = prow[1]
            tipo = prow[2] or 'generico'
            procesado = prow[3]
            estado = prow[4]
            nombre_proyecto = prow[5]

            if procesado:
                raise HTTPException(status_code=400, detail="Este pedido ya fue procesado. Las barras ya fueron generadas.")

            if estado not in ('enviado', 'en_proceso'):
                raise HTTPException(status_code=400,
                    detail="Solo se pueden procesar pedidos en estado 'enviado' o 'en_proceso'.")

            cur.execute("""
                SELECT id, eje, diam, largo, cantidad, sector, piso, ciclo
                FROM pedido_items WHERE pedido_id = %s ORDER BY id
            """, (pedido_id,))
            items = cur.fetchall()

            if not items:
                raise HTTPException(status_code=400, detail="El pedido no tiene items")

            barras_creadas = 0
            for item in items:
                item_id = item[0]
                eje = item[1] or ''
                diam = item[2]
                largo = item[3]
                cantidad = item[4] or 1

                if tipo == 'especifico':
                    sector = (item[5] or 'NA').upper()
                    piso = (item[6] or 'NA').upper()
                    ciclo = (item[7] or 'NA').upper()
                else:
                    sector = 'NA'
                    piso = 'NA'
                    ciclo = 'NA'

                id_unico = f"PED-{uuid.uuid4().hex[:12].upper()}"
                peso_unitario = _calcular_peso(diam, largo)
                peso_total = peso_unitario * cantidad if peso_unitario else None

                cur.execute("""
                    INSERT INTO barras (id_unico, id_proyecto, nombre_proyecto,
                        sector, piso, ciclo, eje, diam, largo_total,
                        mult, cant, cant_total, peso_unitario, peso_total,
                        fecha_carga, origen, pedido_id, pedido_item_id, creado_por)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (id_unico, id_proyecto, nombre_proyecto,
                      sector, piso, ciclo, eje, diam, largo,
                      1, cantidad, cantidad, peso_unitario, peso_total,
                      now, 'pedido', pedido_id, item_id, email))
                barras_creadas += 1

            # Marcar pedido como procesado y cambiar estado a en_proceso
            cur.execute("""
                UPDATE pedidos SET procesado = TRUE, estado = 'en_proceso',
                    fecha_actualizacion = %s WHERE id = %s
            """, (now, pedido_id))

    audit(email, "procesar_pedido",
          f"Pedido #{pedido_id} → {barras_creadas} barras en {id_proyecto}",
          "pedido", str(pedido_id))
    return {"ok": True, "barras_creadas": barras_creadas, "pedido_id": pedido_id}
