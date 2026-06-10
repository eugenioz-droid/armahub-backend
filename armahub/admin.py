"""
admin.py
--------
Endpoints administrativos (solo admin).

Incluye:
- POST /admin/reset-db (resetear base de datos con confirmación)
- GET  /admin/db-info (info de la base de datos)
"""

from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from .db import get_conn, reset_database, audit
from .auth import require_admin, require_admin_or_admin2, get_current_user

router = APIRouter()


@router.get("/admin/db-info")
def db_info(admin=Depends(require_admin_or_admin2)):
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


@router.get("/admin/tables")
def get_table_counts(admin=Depends(require_admin_or_admin2)):
    """Conteo de registros por tabla para el panel de gestión de datos."""
    tables = [
        ("barras", "barras"),
        ("imports", "imports"),
        ("proyectos", "proyectos"),
        ("reclamos", "reclamos"),
        ("calculistas", "calculistas"),
        ("constructoras", "constructoras"),
        ("proyecto_aliases", "proyecto_aliases"),
        ("pedidos", "pedidos"),
        ("audit_log", "audit_log"),
        ("users", "users"),
    ]
    result = []
    with get_conn() as conn:
        with conn.cursor() as cur:
            for label, table in tables:
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {table}")
                    count = int(cur.fetchone()[0])
                except Exception:
                    count = 0
                result.append({"table": label, "count": count})
    return {"tables": result}


@router.post("/admin/tables/{table_name}/clear")
def clear_table(
    table_name: str,
    confirm: str = Query(..., description="Debe ser 'CONFIRMAR'"),
    admin=Depends(require_admin),
):
    """Limpiar todos los registros de una tabla específica. Requiere confirm='CONFIRMAR'."""
    if confirm != "CONFIRMAR":
        raise HTTPException(status_code=400, detail="Debes enviar confirm=CONFIRMAR")

    # Tables allowed to be cleared and their cascade dependencies
    CLEARABLE = {
        "barras": ["DELETE FROM barras"],
        "imports": ["DELETE FROM barras", "DELETE FROM imports"],
        "proyectos": [
            "DELETE FROM reclamo_imagenes", "DELETE FROM reclamo_acciones",
            "DELETE FROM reclamo_seguimientos", "DELETE FROM reclamos",
            "DELETE FROM export_log", "DELETE FROM pedido_items",
            "DELETE FROM pedidos", "DELETE FROM proyecto_usuarios",
            "DELETE FROM barras", "DELETE FROM imports",
            "DELETE FROM proyecto_aliases", "DELETE FROM proyectos",
        ],
        "reclamos": [
            "DELETE FROM reclamo_imagenes", "DELETE FROM reclamo_acciones",
            "DELETE FROM reclamo_seguimientos", "DELETE FROM reclamos",
        ],
        "calculistas": [
            "UPDATE proyectos SET calculista_id = NULL",
            "DELETE FROM calculistas",
        ],
        "constructoras": [
            "UPDATE proyectos SET constructora_id = NULL",
            "DELETE FROM constructoras",
        ],
        "pedidos": ["DELETE FROM pedido_items", "DELETE FROM pedidos"],
        "audit_log": ["DELETE FROM audit_log"],
    }

    if table_name not in CLEARABLE:
        raise HTTPException(status_code=400, detail=f"Tabla no permitida: {table_name}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            for sql in CLEARABLE[table_name]:
                cur.execute(sql)
            deleted = cur.rowcount

    audit(admin.get("email", "?"), "limpiar_tabla", f"tabla={table_name}", "sistema", table_name)
    return {"ok": True, "table": table_name}


@router.get("/admin/audit")
def get_audit_log(
    usuario: Optional[str] = None,
    accion: Optional[str] = None,
    entidad: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    admin=Depends(require_admin_or_admin2),
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


# ========================= ÁREAS Y MATRICES RCA =========================

SLUGS_CATEGORIAS = ["mano_de_obra", "metodo", "material", "maquina", "medicion", "medio_ambiente"]
NOMBRES_CATEGORIAS = {
    "mano_de_obra":  "Mano de Obra",
    "metodo":        "Método",
    "material":      "Material",
    "maquina":       "Máquina",
    "medicion":      "Medición",
    "medio_ambiente": "Medio Ambiente",
}


class SubcausaIn(BaseModel):
    id: Optional[int] = None        # None = nueva
    codigo: str
    descripcion: str
    activo: bool = True
    orden: int = 0


class CategoriaIn(BaseModel):
    slug: str
    subcausas: List[SubcausaIn] = []


class MatrizRCAIn(BaseModel):
    categorias: List[CategoriaIn]


@router.get("/admin/areas")
def listar_areas(user=Depends(require_admin_or_admin2)):
    """Lista todas las áreas con conteo de subcausas RCA."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT a.id, a.nombre, a.slug, a.activo,
                       COUNT(DISTINCT arc.id) AS cat_count,
                       COUNT(DISTINCT ars.id) AS sub_count
                FROM areas a
                LEFT JOIN area_rca_categorias arc ON arc.area_id = a.id
                LEFT JOIN area_rca_subcausas ars ON ars.categoria_id = arc.id AND ars.activo = TRUE
                GROUP BY a.id, a.nombre, a.slug, a.activo
                ORDER BY a.id
            """)
            rows = cur.fetchall()
    return [
        {
            "id": r[0], "nombre": r[1], "slug": r[2], "activo": r[3],
            "tiene_rca": int(r[4] or 0) > 0,
            "total_subcausas": int(r[5] or 0),
        }
        for r in rows
    ]


@router.get("/admin/areas/{area_id}/rca")
def get_rca_area(area_id: int, user=Depends(require_admin_or_admin2)):
    """Devuelve la matriz RCA completa de un área (6 categorías + subcausas)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, nombre, slug FROM areas WHERE id = %s", (area_id,))
            area = cur.fetchone()
            if not area:
                raise HTTPException(status_code=404, detail="Área no encontrada")

            cur.execute("""
                SELECT id, slug, nombre, orden
                FROM area_rca_categorias
                WHERE area_id = %s
                ORDER BY orden, id
            """, (area_id,))
            cats = cur.fetchall()

            cat_ids = [c[0] for c in cats]
            subcausas_por_cat = {}
            if cat_ids:
                cur.execute("""
                    SELECT id, categoria_id, codigo, descripcion, activo, orden
                    FROM area_rca_subcausas
                    WHERE categoria_id = ANY(%s)
                    ORDER BY orden, id
                """, (cat_ids,))
                for row in cur.fetchall():
                    subcausas_por_cat.setdefault(row[1], []).append({
                        "id": row[0], "codigo": row[2],
                        "descripcion": row[3], "activo": row[4], "orden": row[5],
                    })

    # Devolver siempre las 6 categorías — vacías si no existen aún
    cats_by_slug = {c[1]: c for c in cats}
    resultado = []
    for slug in SLUGS_CATEGORIAS:
        cat = cats_by_slug.get(slug)
        resultado.append({
            "id": cat[0] if cat else None,
            "slug": slug,
            "nombre": NOMBRES_CATEGORIAS[slug],
            "orden": cat[3] if cat else 0,
            "subcausas": subcausas_por_cat.get(cat[0], []) if cat else [],
        })

    return {"area": {"id": area[0], "nombre": area[1], "slug": area[2]}, "categorias": resultado}


@router.put("/admin/areas/{area_id}/rca")
def guardar_rca_area(area_id: int, body: MatrizRCAIn, user=Depends(require_admin_or_admin2)):
    """Guarda (upsert) la matriz RCA de un área. Crea categorías si no existen."""
    email = user.get("email", "")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM areas WHERE id = %s", (area_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Área no encontrada")

            for i, cat_in in enumerate(body.categorias):
                if cat_in.slug not in SLUGS_CATEGORIAS:
                    continue
                nombre = NOMBRES_CATEGORIAS[cat_in.slug]

                # Upsert categoría
                cur.execute("""
                    INSERT INTO area_rca_categorias (area_id, slug, nombre, orden)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (area_id, slug) DO UPDATE SET nombre = EXCLUDED.nombre, orden = EXCLUDED.orden
                    RETURNING id
                """, (area_id, cat_in.slug, nombre, i))
                cat_id = cur.fetchone()[0]

                # Procesar subcausas
                ids_enviados = []
                for j, sub in enumerate(cat_in.subcausas):
                    if sub.id:
                        cur.execute("""
                            UPDATE area_rca_subcausas
                            SET codigo = %s, descripcion = %s, activo = %s, orden = %s
                            WHERE id = %s AND categoria_id = %s
                        """, (sub.codigo, sub.descripcion, sub.activo, j, sub.id, cat_id))
                        ids_enviados.append(sub.id)
                    else:
                        cur.execute("""
                            INSERT INTO area_rca_subcausas (categoria_id, codigo, descripcion, activo, orden)
                            VALUES (%s, %s, %s, %s, %s)
                            RETURNING id
                        """, (cat_id, sub.codigo, sub.descripcion, sub.activo, j))
                        ids_enviados.append(cur.fetchone()[0])

                # Eliminar subcausas que ya no están
                if ids_enviados:
                    cur.execute("""
                        DELETE FROM area_rca_subcausas
                        WHERE categoria_id = %s AND id != ALL(%s)
                    """, (cat_id, ids_enviados))
                else:
                    cur.execute("DELETE FROM area_rca_subcausas WHERE categoria_id = %s", (cat_id,))

        conn.commit()

    audit(email, "guardar_rca_area", str(area_id), "area", str(area_id))
    return {"ok": True}
