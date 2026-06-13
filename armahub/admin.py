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
from .auth import require_admin, require_admin_or_admin_calidad, get_current_user

router = APIRouter()


@router.get("/admin/db-info")
def db_info(admin=Depends(require_admin_or_admin_calidad)):
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
def get_table_counts(admin=Depends(require_admin_or_admin_calidad)):
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
    admin=Depends(require_admin_or_admin_calidad),
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
def listar_areas(user=Depends(require_admin_or_admin_calidad)):
    """Lista todas las áreas con conteo de subcausas RCA, flag de revisión y nº de usuarios."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT a.id, a.nombre, a.slug, a.activo, a.tiene_revision,
                       COUNT(DISTINCT arc.id) AS cat_count,
                       COUNT(DISTINCT ars.id) AS sub_count,
                       COUNT(DISTINCT au.id)  AS user_count
                FROM areas a
                LEFT JOIN area_rca_categorias arc ON arc.area_id = a.id
                LEFT JOIN area_rca_subcausas ars ON ars.categoria_id = arc.id AND ars.activo = TRUE
                LEFT JOIN area_usuarios au ON au.area_id = a.id
                GROUP BY a.id, a.nombre, a.slug, a.activo, a.tiene_revision
                ORDER BY a.id
            """)
            rows = cur.fetchall()
    return [
        {
            "id": r[0], "nombre": r[1], "slug": r[2], "activo": r[3],
            "tiene_revision": bool(r[4]),
            "tiene_rca": int(r[5] or 0) > 0,
            "total_subcausas": int(r[6] or 0),
            "total_usuarios": int(r[7] or 0),
        }
        for r in rows
    ]


# ---- Gestión de áreas (panel Admin · base del CRM configurable) ----

class AreaIn(BaseModel):
    nombre: str
    slug: Optional[str] = None


class AreaRevisionIn(BaseModel):
    tiene_revision: bool


class AreaUsuarioIn(BaseModel):
    user_id: int
    rol_area: str = "miembro"  # 'miembro' | 'jefe_servicio'


def _slugify_area(texto: str) -> str:
    base = (texto or "").strip().lower()
    out = []
    for ch in base:
        if ch.isalnum():
            out.append(ch)
        elif ch in (" ", "-", "_", "/"):
            out.append("_")
        # acentos comunes
    s = "".join(out)
    for a, b in (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"), ("ñ", "n")):
        s = s.replace(a, b)
    while "__" in s:
        s = s.replace("__", "_")
    return s.strip("_") or "area"


@router.post("/admin/areas")
def crear_area(body: AreaIn, user=Depends(require_admin)):
    """Crea una nueva área. El slug se deriva del nombre si no se da."""
    email = user.get("email", "")
    nombre = (body.nombre or "").strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="El nombre del área es obligatorio")
    slug = (body.slug or _slugify_area(nombre)).strip()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM areas WHERE slug = %s", (slug,))
            if cur.fetchone():
                raise HTTPException(status_code=409, detail=f"Ya existe un área con slug '{slug}'")
            cur.execute(
                "INSERT INTO areas (nombre, slug) VALUES (%s, %s) RETURNING id",
                (nombre, slug),
            )
            new_id = cur.fetchone()[0]
        conn.commit()
    audit(email, "crear_area", f"{nombre} ({slug})", "area", str(new_id))
    return {"ok": True, "id": new_id, "slug": slug}


@router.patch("/admin/areas/{area_id}")
def editar_area(area_id: int, body: AreaIn, user=Depends(require_admin)):
    """Edita el nombre de un área (el slug no se cambia para no romper referencias)."""
    email = user.get("email", "")
    nombre = (body.nombre or "").strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="El nombre del área es obligatorio")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM areas WHERE id = %s", (area_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Área no encontrada")
            cur.execute("UPDATE areas SET nombre = %s WHERE id = %s", (nombre, area_id))
        conn.commit()
    audit(email, "editar_area", nombre, "area", str(area_id))
    return {"ok": True}


@router.patch("/admin/areas/{area_id}/activo")
def toggle_area_activo(area_id: int, user=Depends(require_admin)):
    """Activa/desactiva un área (soft-delete): invierte el estado activo actual."""
    email = user.get("email", "")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT activo FROM areas WHERE id = %s", (area_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Área no encontrada")
            nuevo = not bool(row[0])
            cur.execute("UPDATE areas SET activo = %s WHERE id = %s", (nuevo, area_id))
        conn.commit()
    audit(email, "toggle_area_activo", f"activo={nuevo}", "area", str(area_id))
    return {"ok": True, "activo": nuevo}


@router.patch("/admin/areas/{area_id}/revision")
def set_area_revision(area_id: int, body: AreaRevisionIn, user=Depends(require_admin)):
    """Activa/desactiva la etapa de revisión del área (flag tiene_revision)."""
    email = user.get("email", "")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM areas WHERE id = %s", (area_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Área no encontrada")
            cur.execute(
                "UPDATE areas SET tiene_revision = %s WHERE id = %s",
                (body.tiene_revision, area_id),
            )
        conn.commit()
    audit(email, "set_area_revision", f"tiene_revision={body.tiene_revision}", "area", str(area_id))
    return {"ok": True, "tiene_revision": body.tiene_revision}


@router.get("/admin/areas/{area_id}/usuarios")
def listar_usuarios_area(area_id: int, user=Depends(require_admin_or_admin_calidad)):
    """Usuarios asignados a un área, con su rol de área."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM areas WHERE id = %s", (area_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Área no encontrada")
            cur.execute("""
                SELECT au.id, u.id, u.email,
                       NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), '') AS display,
                       au.rol_area
                FROM area_usuarios au
                JOIN users u ON u.id = au.user_id
                WHERE au.area_id = %s
                ORDER BY au.rol_area DESC, display
            """, (area_id,))
            rows = cur.fetchall()
    return [
        {"asignacion_id": r[0], "user_id": r[1], "email": r[2],
         "nombre": r[3] or r[2], "rol_area": r[4]}
        for r in rows
    ]


@router.post("/admin/areas/{area_id}/usuarios")
def asignar_usuario_area(area_id: int, body: AreaUsuarioIn, user=Depends(require_admin)):
    """Asigna (o actualiza el rol de) un usuario en un área."""
    email = user.get("email", "")
    if body.rol_area not in ("miembro", "jefe_servicio"):
        raise HTTPException(status_code=400, detail="rol_area inválido")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM areas WHERE id = %s", (area_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Área no encontrada")
            cur.execute("SELECT id FROM users WHERE id = %s", (body.user_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            cur.execute("""
                INSERT INTO area_usuarios (area_id, user_id, rol_area)
                VALUES (%s, %s, %s)
                ON CONFLICT (area_id, user_id) DO UPDATE SET rol_area = EXCLUDED.rol_area
            """, (area_id, body.user_id, body.rol_area))
        conn.commit()
    audit(email, "asignar_usuario_area", f"user={body.user_id} rol={body.rol_area}", "area", str(area_id))
    return {"ok": True}


@router.delete("/admin/areas/{area_id}/usuarios/{user_id}")
def quitar_usuario_area(area_id: int, user_id: int, user=Depends(require_admin)):
    """Quita un usuario de un área."""
    email = user.get("email", "")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM area_usuarios WHERE area_id = %s AND user_id = %s",
                (area_id, user_id),
            )
        conn.commit()
    audit(email, "quitar_usuario_area", f"user={user_id}", "area", str(area_id))
    return {"ok": True}


# ---- Configuración: quién puede levantar reclamos (externo/interno) ----

class CrearReclamoConfigIn(BaseModel):
    accion: str  # 'externo' | 'interno'
    rol: str
    activo: bool


@router.get("/admin/reclamo-crear-config")
def get_crear_reclamo_config(user=Depends(require_admin_or_admin_calidad)):
    """Matriz de quién puede levantar reclamos: filas (accion, rol, activo)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT accion, rol, activo FROM reclamo_crear_config ORDER BY accion, rol")
            rows = cur.fetchall()
    return [{"accion": r[0], "rol": r[1], "activo": bool(r[2])} for r in rows]


@router.patch("/admin/reclamo-crear-config")
def set_crear_reclamo_config(body: CrearReclamoConfigIn, user=Depends(require_admin)):
    """Activa/desactiva un (accion, rol). admin/admin_calidad no se pueden desactivar
    (el sistema siempre debe tener quién cree reclamos)."""
    email = user.get("email", "")
    if body.accion not in ("externo", "interno"):
        raise HTTPException(status_code=400, detail="accion inválida")
    if body.rol in ("admin", "admin_calidad") and not body.activo:
        raise HTTPException(status_code=400, detail="admin y admin_calidad no se pueden desactivar")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO reclamo_crear_config (accion, rol, activo)
                VALUES (%s, %s, %s)
                ON CONFLICT (accion, rol) DO UPDATE SET activo = EXCLUDED.activo
            """, (body.accion, body.rol, body.activo))
        conn.commit()
    audit(email, "set_crear_reclamo_config", f"{body.accion}/{body.rol}={body.activo}", "config", body.accion)
    return {"ok": True}


@router.get("/admin/areas/{area_id}/rca")
def get_rca_area(area_id: int, user=Depends(require_admin_or_admin_calidad)):
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
def guardar_rca_area(area_id: int, body: MatrizRCAIn, user=Depends(require_admin_or_admin_calidad)):
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
