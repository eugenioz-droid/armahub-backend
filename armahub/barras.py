from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from .db import get_conn
from .auth import get_current_user

router = APIRouter()

def _get_allowed_project_ids(cur, user: dict):
    """Returns list of project IDs the user can access, or None if unrestricted.
    admin/coordinador: None (see everything).
    cubicador/operador/cliente: only owned + authorized projects."""
    role = user.get("role", "operador")
    if role in ("admin", "coordinador"):
        return None
    cur.execute("SELECT id FROM users WHERE email = %s", (user.get("email"),))
    row = cur.fetchone()
    if not row:
        return []
    uid = row[0]
    cur.execute("SELECT id_proyecto FROM proyectos WHERE owner_id = %s", (uid,))
    owned = {r[0] for r in cur.fetchall()}
    cur.execute("SELECT id_proyecto FROM proyecto_usuarios WHERE user_id = %s", (uid,))
    authorized = {r[0] for r in cur.fetchall()}
    return list(owned | authorized)


def _project_filter_sql(allowed_ids, table_alias="", col="id_proyecto"):
    """Build a WHERE/AND fragment + params for project filtering.
    Returns (sql_fragment, params) where sql_fragment starts with ' AND ...' or is empty."""
    if allowed_ids is None:
        return "", []
    prefix = f"{table_alias}." if table_alias else ""
    if not allowed_ids:
        return f" AND FALSE", []
    placeholders = ",".join(["%s"] * len(allowed_ids))
    return f" AND {prefix}{col} IN ({placeholders})", list(allowed_ids)


def _puede_editar_proyecto(cur, id_proyecto: str, user: dict) -> bool:
    """Retorna True si el usuario es admin, owner del proyecto, o está autorizado."""
    if user.get("role") == "admin":
        return True
    cur.execute("SELECT id FROM users WHERE email = %s", (user.get("email"),))
    row = cur.fetchone()
    if not row:
        return False
    uid = row[0]
    cur.execute("SELECT owner_id FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
    prow = cur.fetchone()
    if not prow:
        return False
    if prow[0] == uid:
        return True
    cur.execute("SELECT 1 FROM proyecto_usuarios WHERE id_proyecto = %s AND user_id = %s", (id_proyecto, uid))
    return cur.fetchone() is not None

BARRAS_COLUMNS = [
    "id_unico","id_proyecto","nombre_proyecto","plano_code","nombre_plano","sector","piso","ciclo","eje",
    "diam","largo_total","mult","cant","cant_total",
    "peso_unitario","peso_total","version_mod","version_exp","fecha_carga"
]

ALLOWED_ORDER_BY = {
    "fecha_carga", "peso_total", "peso_unitario", "cant_total",
    "diam", "largo_total",
    "id_proyecto", "plano_code", "sector", "piso", "ciclo", "eje", "id_unico", "nombre_proyecto"
}

@router.get("/barras")
def get_barras(
    proyecto: str = None,
    plano_code: str = None,
    sector: str = None,
    piso: str = None,
    ciclo: str = None,
    q: str = None,                      # búsqueda simple
    limit: int = 200,                   # paginación
    offset: int = 0,
    order_by: str = "fecha_carga",      # orden
    order_dir: str = "desc",
    user=Depends(get_current_user),
):
    # límites sanos
    if limit < 1: limit = 1
    if limit > 2000: limit = 2000
    if offset < 0: offset = 0

    if order_by not in ALLOWED_ORDER_BY:
        raise HTTPException(status_code=400, detail=f"order_by inválido. Usa uno de: {sorted(ALLOWED_ORDER_BY)}")
    order_dir = order_dir.lower()
    if order_dir not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="order_dir debe ser asc o desc")

    base_where = " WHERE 1=1 "
    params = []

    if proyecto:
        base_where += " AND id_proyecto = %s"
        params.append(proyecto)
    if plano_code:
        base_where += " AND plano_code = %s"
        params.append(plano_code)
    if sector:
        base_where += " AND sector = %s"
        params.append(sector)
    if piso:
        base_where += " AND piso = %s"
        params.append(piso)
    if ciclo:
        base_where += " AND ciclo = %s"
        params.append(ciclo)

    # búsqueda simple: id_unico, eje, plano_code
    if q and q.strip():
        qq = f"%{q.strip()}%"
        base_where += " AND (id_unico ILIKE %s OR eje ILIKE %s OR plano_code ILIKE %s)"
        params.extend([qq, qq, qq])

    select_cols = ",".join(BARRAS_COLUMNS)

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Role-based project filter
            allowed = _get_allowed_project_ids(cur, user)
            pf_sql, pf_params = _project_filter_sql(allowed)
            full_where = base_where + pf_sql
            full_params = params + pf_params

            count_sql = "SELECT COUNT(*) FROM barras" + full_where
            data_sql = f"""
                SELECT {select_cols}
                FROM barras
                {full_where}
                ORDER BY {order_by} {order_dir} NULLS LAST
                LIMIT %s OFFSET %s
            """

            cur.execute(count_sql, full_params)
            total = int(cur.fetchone()[0])

            cur.execute(data_sql, full_params + [limit, offset])
            rows = cur.fetchall()

    data = [dict(zip(BARRAS_COLUMNS, r)) for r in rows]

    return {
        "count": len(data),
        "total": total,
        "limit": limit,
        "offset": offset,
        "order_by": order_by,
        "order_dir": order_dir,
        "q": q or "",
        "data": data
    }


@router.get("/filters")
def filters(
    proyecto: Optional[str] = None,
    plano_code: Optional[str] = None,
    sector: Optional[str] = None,
    piso: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Filtros dependientes en cascada: proyecto → plano → sector → piso → ciclo.
    Cada select se filtra solo por sus padres upstream, nunca por sí mismo."""

    def _where(parts, vals):
        if not parts:
            return "", []
        return " WHERE " + " AND ".join(parts), list(vals)

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Role-based project filter
            allowed = _get_allowed_project_ids(cur, user)
            pf_sql, pf_params = _project_filter_sql(allowed)

            # Proyectos: filtered by authorization
            cur.execute("SELECT DISTINCT id_proyecto FROM barras WHERE 1=1" + pf_sql + " ORDER BY id_proyecto", pf_params)
            proyectos = [r[0] for r in cur.fetchall() if r[0] is not None]

            # Planos: filtrado solo por proyecto (+ auth)
            w_parts, w_vals = ["1=1"], list(pf_params)
            if pf_sql:
                w_parts[0] = "1=1" + pf_sql
            if proyecto:
                w_parts.append("id_proyecto = %s"); w_vals.append(proyecto)
            wsql = " WHERE " + " AND ".join(w_parts)
            cur.execute(f"SELECT DISTINCT plano_code, nombre_plano FROM barras{wsql} AND plano_code IS NOT NULL ORDER BY plano_code", w_vals)
            planos = [{"code": r[0], "nombre": r[1] or r[0]} for r in cur.fetchall() if r[0] is not None]

            # Sectores: filtrado por proyecto + plano (+ auth)
            if plano_code:
                w_parts.append("plano_code = %s"); w_vals.append(plano_code)
            wsql = " WHERE " + " AND ".join(w_parts)
            cur.execute(f"SELECT DISTINCT sector FROM barras{wsql} ORDER BY sector", w_vals)
            sectores = [r[0] for r in cur.fetchall() if r[0] is not None]

            # Pisos: filtrado por proyecto + plano + sector (+ auth)
            if sector:
                w_parts.append("sector = %s"); w_vals.append(sector)
            wsql = " WHERE " + " AND ".join(w_parts)
            cur.execute(f"SELECT DISTINCT piso FROM barras{wsql} ORDER BY piso", w_vals)
            pisos = [r[0] for r in cur.fetchall() if r[0] is not None]

            # Ciclos: filtrado por proyecto + plano + sector + piso (+ auth)
            if piso:
                w_parts.append("piso = %s"); w_vals.append(piso)
            wsql = " WHERE " + " AND ".join(w_parts)
            cur.execute(f"SELECT DISTINCT ciclo FROM barras{wsql} ORDER BY ciclo", w_vals)
            ciclos = [r[0] for r in cur.fetchall() if r[0] is not None]

    return {
        "sectores": sectores,
        "pisos": pisos,
        "ciclos": ciclos,
        "planos": planos,
        "proyectos": proyectos,
    }


@router.get("/stats")
def get_stats(user=Depends(get_current_user)):
    """KPIs generales para Tab Inicio. Filtered by user authorization."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            allowed = _get_allowed_project_ids(cur, user)
            pf_sql, pf_params = _project_filter_sql(allowed)
            w = " WHERE 1=1" + pf_sql
            wp = list(pf_params)

            cur.execute("SELECT COUNT(*) FROM barras" + w, wp)
            total_barras = int(cur.fetchone()[0])

            if allowed is None:
                cur.execute("SELECT COUNT(*) FROM proyectos")
            elif not allowed:
                cur.execute("SELECT 0")
            else:
                ph = ",".join(["%s"] * len(allowed))
                cur.execute(f"SELECT COUNT(*) FROM proyectos WHERE id_proyecto IN ({ph})", allowed)
            total_proyectos = int(cur.fetchone()[0])

            cur.execute("SELECT COALESCE(SUM(peso_total), 0) FROM barras" + w, wp)
            total_kilos = float(cur.fetchone()[0])

            cur.execute("SELECT MAX(fecha_carga) FROM barras" + w, wp)
            ultima_carga = cur.fetchone()[0]

            ppb = round(total_kilos / total_barras, 3) if total_barras > 0 else 0

            cur.execute("SELECT COUNT(DISTINCT COALESCE(plano_code,'') || '-' || COALESCE(sector,'') || '-' || COALESCE(piso,'') || '-' || COALESCE(ciclo,'')) FROM barras" + w, wp)
            total_items = int(cur.fetchone()[0])
            ppi = round(total_kilos / total_items, 3) if total_items > 0 else 0

            try:
                cur.execute("SAVEPOINT sp_diam_prom")
                cur.execute("""
                    SELECT COALESCE(SUM(diam * peso_total) / NULLIF(SUM(peso_total), 0), 0)
                    FROM barras
                    WHERE diam IS NOT NULL AND peso_total IS NOT NULL
                """ + pf_sql, pf_params)
                diam_prom = round(float(cur.fetchone()[0]), 1)
            except Exception:
                cur.execute("ROLLBACK TO SAVEPOINT sp_diam_prom")
                diam_prom = 0

            # Join with auth filter on barras
            pf_b, pf_bp = _project_filter_sql(allowed, "b")
            cur.execute("""
                SELECT COALESCE(p.nombre_proyecto, b.id_proyecto) AS nombre,
                       b.id_proyecto,
                       COUNT(*) AS barras,
                       COALESCE(SUM(b.peso_total), 0) AS kilos
                FROM barras b
                LEFT JOIN proyectos p ON b.id_proyecto = p.id_proyecto
                WHERE 1=1""" + pf_b + """
                GROUP BY b.id_proyecto, p.nombre_proyecto
                ORDER BY kilos DESC
            """, pf_bp)
            proyectos_rows = cur.fetchall()

    proyectos_all = [
        {"nombre": r[0], "id_proyecto": r[1], "barras": int(r[2]), "kilos": round(float(r[3]), 2)}
        for r in proyectos_rows
    ]

    return {
        "total_barras": total_barras,
        "total_proyectos": total_proyectos,
        "total_kilos": round(total_kilos, 2),
        "ultima_carga": ultima_carga,
        "ppb": ppb,
        "ppi": ppi,
        "diam_promedio": diam_prom,
        "total_items": total_items,
        "top5": proyectos_all[:5],
        "proyectos": proyectos_all,
    }


@router.get("/cargas/recientes")
def get_cargas_recientes(
    limit: int = 5,
    user=Depends(get_current_user),
):
    """Últimas N importaciones registradas."""
    if limit < 1:
        limit = 1
    if limit > 50:
        limit = 50
    with get_conn() as conn:
        with conn.cursor() as cur:
            allowed = _get_allowed_project_ids(cur, user)
            pf_sql, pf_params = _project_filter_sql(allowed)
            cur.execute("""
                SELECT id, id_proyecto, nombre_proyecto, usuario, archivo, fecha, barras_count, kilos,
                       estado, version_archivo, plano_code
                FROM imports
                WHERE 1=1""" + pf_sql + """
                ORDER BY id DESC
                LIMIT %s
            """, (pf_params + [limit]))  # Added parentheses here
            rows = cur.fetchall()
    return {
        "cargas": [
            {
                "id": r[0],
                "id_proyecto": r[1],
                "nombre_proyecto": r[2],
                "usuario": r[3],
                "archivo": r[4],
                "fecha": r[5],
                "barras_count": r[6],
                "kilos": r[7],
                "estado": r[8],
                "version_archivo": r[9],
                "plano_code": r[10],
            }
            for r in rows
        ]
    }


@router.get("/proyectos/{id_proyecto}/cargas")
def get_cargas_proyecto(
    id_proyecto: str,
    limit: int = 20,
    user=Depends(get_current_user),
):
    """Historial de cargas de un proyecto específico."""
    if limit < 1:
        limit = 1
    if limit > 100:
        limit = 100
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")
            cur.execute("""
                SELECT id, usuario, archivo, fecha, barras_count, kilos,
                       estado, version_archivo, plano_code
                FROM imports
                WHERE id_proyecto = %s
                ORDER BY id DESC
                LIMIT %s
            """, (id_proyecto, limit))
            rows = cur.fetchall()
    return {
        "id_proyecto": id_proyecto,
        "cargas": [
            {
                "id": r[0],
                "usuario": r[1],
                "archivo": r[2],
                "fecha": r[3],
                "barras_count": r[4],
                "kilos": r[5],
                "estado": r[6],
                "version_archivo": r[7],
                "plano_code": r[8],
            }
            for r in rows
        ]
    }


@router.delete("/cargas/{carga_id}")
def delete_carga(carga_id: int, user=Depends(get_current_user)):
    """Eliminar una carga: borra las barras importadas en esa carga y el registro de import."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, id_proyecto, archivo, fecha, barras_count FROM imports WHERE id = %s",
                (carga_id,)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Carga no encontrada")
            id_proyecto = row[1]
            archivo = row[2]
            fecha = row[3]

            if not _puede_editar_proyecto(cur, id_proyecto, user):
                raise HTTPException(status_code=403, detail="No tienes permiso para eliminar cargas de este proyecto")

            cur.execute(
                "DELETE FROM barras WHERE id_proyecto = %s AND fecha_carga = %s",
                (id_proyecto, fecha)
            )
            barras_eliminadas = cur.rowcount
            cur.execute("DELETE FROM imports WHERE id = %s", (carga_id,))

    return {
        "ok": True,
        "carga_id": carga_id,
        "archivo": archivo,
        "barras_eliminadas": barras_eliminadas,
    }


class MoverBarrasIndividualRequest(BaseModel):
    id_unicos: list
    destino_id: Optional[str] = None
    nuevo_sector: Optional[str] = None


@router.post("/barras/mover")
def mover_barras_individual(body: MoverBarrasIndividualRequest, user=Depends(get_current_user)):
    """Mover barras individuales (por lista de id_unico) a otro proyecto y/o cambiar sector."""
    if not body.id_unicos:
        raise HTTPException(status_code=400, detail="Lista de barras vacía")
    if not body.destino_id and not body.nuevo_sector:
        raise HTTPException(status_code=400, detail="Debe indicar destino_id o nuevo_sector")

    SECTORES_VALIDOS = {"FUND", "ELEV", "LCIELO", "VCIELO"}
    if body.nuevo_sector and body.nuevo_sector.upper() not in SECTORES_VALIDOS:
        raise HTTPException(status_code=400, detail=f"Sector inválido. Válidos: {sorted(SECTORES_VALIDOS)}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Verificar permisos sobre el proyecto origen de la primera barra
            cur.execute("SELECT id_proyecto FROM barras WHERE id_unico = %s", (body.id_unicos[0],))
            brow = cur.fetchone()
            if not brow:
                raise HTTPException(status_code=404, detail="Barra no encontrada")
            if not _puede_editar_proyecto(cur, brow[0], user):
                raise HTTPException(status_code=403, detail="No tienes permiso para mover barras de este proyecto")

            sets = []
            params = []
            if body.destino_id:
                cur.execute("SELECT nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (body.destino_id,))
                dest = cur.fetchone()
                if not dest:
                    raise HTTPException(status_code=404, detail="Proyecto destino no encontrado")
                sets.append("id_proyecto = %s")
                params.append(body.destino_id)
                sets.append("nombre_proyecto = %s")
                params.append(dest[0])
            if body.nuevo_sector:
                sets.append("sector = %s")
                params.append(body.nuevo_sector.upper())

            placeholders = ",".join(["%s"] * len(body.id_unicos))
            params.extend(body.id_unicos)
            cur.execute(
                f"UPDATE barras SET {', '.join(sets)} WHERE id_unico IN ({placeholders})",
                params
            )
            count = cur.rowcount

    return {"ok": True, "movidas": count}


@router.get("/dashboard")
def dashboard(
    group_by: str = Query("ciclo"),
    user=Depends(get_current_user),
):
    allowed = {"sector", "piso", "ciclo", "plano_code", "id_proyecto", "eje"}
    if group_by not in allowed:
        raise HTTPException(status_code=400, detail=f"group_by debe ser uno de {sorted(list(allowed))}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            allowed_ids = _get_allowed_project_ids(cur, user)
            pf_sql, pf_params = _project_filter_sql(allowed_ids)
            pf_b, pf_bp = _project_filter_sql(allowed_ids, "b")
            w = " WHERE 1=1" + pf_sql

            cur.execute("SELECT COUNT(*) AS barras, COALESCE(SUM(peso_total),0) AS kilos FROM barras" + w, pf_params)
            total_barras, total_kilos = cur.fetchone()

            if group_by == "id_proyecto":
                cur.execute("""
                    SELECT COALESCE(p.nombre_proyecto, b.nombre_proyecto, b.id_proyecto) AS grupo,
                           COUNT(*) AS barras,
                           COALESCE(SUM(b.peso_total),0) AS kilos
                    FROM barras b
                    LEFT JOIN proyectos p ON b.id_proyecto = p.id_proyecto
                    WHERE 1=1""" + pf_b + """
                    GROUP BY COALESCE(p.nombre_proyecto, b.nombre_proyecto, b.id_proyecto)
                    ORDER BY kilos DESC
                """, pf_bp)
            elif group_by == "plano_code":
                cur.execute("""
                    SELECT COALESCE(nombre_plano, plano_code) AS grupo,
                           COUNT(*) AS barras,
                           COALESCE(SUM(peso_total),0) AS kilos
                    FROM barras
                    WHERE plano_code IS NOT NULL""" + pf_sql + """
                    GROUP BY COALESCE(nombre_plano, plano_code), plano_code
                    ORDER BY kilos DESC
                """, pf_params)
            elif group_by == "eje":
                cur.execute("""
                    SELECT eje AS grupo,
                           COUNT(*) AS barras,
                           COALESCE(SUM(peso_total),0) AS kilos
                    FROM barras
                    WHERE eje IS NOT NULL""" + pf_sql + """
                    GROUP BY eje
                    ORDER BY kilos DESC
                """, pf_params)
            else:
                cur.execute(f"""
                    SELECT {group_by} AS grupo,
                           COUNT(*) AS barras,
                           COALESCE(SUM(peso_total),0) AS kilos
                    FROM barras
                    """ + w + f"""
                    GROUP BY {group_by}
                    ORDER BY kilos DESC
                """, pf_params)
            rows = cur.fetchall()

    return {
        "total": {"barras": int(total_barras), "kilos": float(total_kilos)},
        "group_by": group_by,
        "items": [{"grupo": r[0], "barras": int(r[1]), "kilos": float(r[2])} for r in rows],
    }


@router.get("/dashboard/sectores")
def dashboard_sectores(
    proyecto: str = None,
    user=Depends(get_current_user),
):
    """
    Agrupa barras por combinación sector+piso+ciclo (sector constructivo).
    Opcionalmente filtra por proyecto.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            allowed_ids = _get_allowed_project_ids(cur, user)
            pf_b, pf_bp = _project_filter_sql(allowed_ids, "b")
            where = "WHERE 1=1" + pf_b
            params = list(pf_bp)
            if proyecto:
                where += " AND b.id_proyecto = %s"
                params.append(proyecto)

            cur.execute(f"""
                SELECT
                    COALESCE(b.sector, '?') || ' ' || COALESCE(b.piso, '?') || ' ' || COALESCE(b.ciclo, '?') AS sector_constructivo,
                    b.sector,
                    b.piso,
                    b.ciclo,
                    COUNT(*) AS barras,
                    COALESCE(SUM(b.peso_total), 0) AS kilos
                FROM barras b
                {where}
                GROUP BY b.sector, b.piso, b.ciclo
                ORDER BY b.piso, b.ciclo, b.sector
            """, params)
            rows = cur.fetchall()

    return {
        "proyecto": proyecto,
        "items": [
            {
                "sector_constructivo": r[0],
                "sector": r[1],
                "piso": r[2],
                "ciclo": r[3],
                "barras": int(r[4]),
                "kilos": round(float(r[5]), 2),
            }
            for r in rows
        ],
    }


@router.get("/proyectos")
def get_proyectos(user=Depends(get_current_user)):
    """
    Devuelve lista de proyectos con resumen de kilos y barras.
    Incluye owner y calculista. Filtered by user authorization.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            allowed = _get_allowed_project_ids(cur, user)
            pf_p, pf_pp = _project_filter_sql(allowed, "p")
            cur.execute("""
                SELECT 
                    p.id_proyecto,
                    p.nombre_proyecto,
                    COUNT(DISTINCT b.id_unico) as total_barras,
                    COALESCE(SUM(b.peso_total), 0) as total_kilos,
                    p.owner_id,
                    u.email as owner_email,
                    p.calculista
                FROM proyectos p
                LEFT JOIN barras b ON p.id_proyecto = b.id_proyecto
                LEFT JOIN users u ON p.owner_id = u.id
                WHERE 1=1""" + pf_p + """
                GROUP BY p.id_proyecto, p.nombre_proyecto, p.owner_id, u.email, p.calculista
                ORDER BY p.fecha_creacion DESC
            """, pf_pp)
            rows = cur.fetchall()

    return {
        "proyectos": [
            {
                "id_proyecto": r[0],
                "nombre_proyecto": r[1],
                "total_barras": int(r[2]) if r[2] else 0,
                "total_kilos": float(r[3]) if r[3] else 0.0,
                "owner_id": r[4],
                "owner_email": r[5],
                "calculista": r[6],
            }
            for r in rows
        ]
    }


@router.get("/proyectos/{id_proyecto}/sectores")
def get_proyecto_sectores(
    id_proyecto: str,
    user=Depends(get_current_user),
):
    """
    Devuelve desglose de kilos y barras por sector para un proyecto.
    Estructura: [{sector, total_kilos, total_barras}, ...]
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Verificar que el proyecto existe
            cur.execute("SELECT nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            proyecto = cur.fetchone()
            if not proyecto:
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")

            # Desglose por sector
            cur.execute("""
                SELECT 
                    COALESCE(sector, '(sin sector)') as sector,
                    COUNT(DISTINCT id_unico) as total_barras,
                    COALESCE(SUM(peso_total), 0) as total_kilos
                FROM barras
                WHERE id_proyecto = %s
                GROUP BY sector
                ORDER BY total_kilos DESC
            """, (id_proyecto,))
            rows = cur.fetchall()

    return {
        "id_proyecto": id_proyecto,
        "nombre_proyecto": proyecto[0],
        "sectores": [
            {
                "sector": r[0],
                "total_barras": int(r[1]) if r[1] else 0,
                "total_kilos": float(r[2]) if r[2] else 0.0,
            }
            for r in rows
        ]
    }


# ========================= ADMIN OBRAS =========================

class ProyectoCreate(BaseModel):
    nombre_proyecto: str
    descripcion: Optional[str] = None
    calculista: Optional[str] = None

class ProyectoUpdate(BaseModel):
    nombre_proyecto: Optional[str] = None
    descripcion: Optional[str] = None
    calculista: Optional[str] = None

class AutorizarUsuarioRequest(BaseModel):
    user_id: int
    rol: str = "editor"

class MoverBarrasRequest(BaseModel):
    destino_id: str
    sector: Optional[str] = None
    piso: Optional[str] = None
    ciclo: Optional[str] = None


@router.post("/proyectos")
def crear_proyecto(body: ProyectoCreate, user=Depends(get_current_user)):
    """Crear una obra vacía manualmente (sin CSV). Asigna owner automáticamente."""
    import uuid
    id_proyecto = "PROY-" + uuid.uuid4().hex[:8].upper()
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Resolve owner_id from current user email
            cur.execute("SELECT id FROM users WHERE email = %s", (user.get("email"),))
            owner_row = cur.fetchone()
            owner_id = owner_row[0] if owner_row else None

            cur.execute("""
                INSERT INTO proyectos (id_proyecto, nombre_proyecto, usuario_creador, owner_id, calculista)
                VALUES (%s, %s, %s, %s, %s)
            """, (id_proyecto, body.nombre_proyecto, user.get("email", "unknown"), owner_id, body.calculista))
    return {
        "ok": True,
        "id_proyecto": id_proyecto,
        "nombre_proyecto": body.nombre_proyecto,
    }


@router.patch("/proyectos/{id_proyecto}")
def editar_proyecto(id_proyecto: str, body: ProyectoUpdate, user=Depends(get_current_user)):
    """Editar nombre/descripción/calculista de una obra."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")
            if not _puede_editar_proyecto(cur, id_proyecto, user):
                raise HTTPException(status_code=403, detail="No tienes permiso para editar este proyecto")

            sets = []
            params = []
            if body.nombre_proyecto is not None:
                sets.append("nombre_proyecto = %s")
                params.append(body.nombre_proyecto)
            if body.descripcion is not None:
                sets.append("descripcion = %s")
                params.append(body.descripcion)
            if body.calculista is not None:
                sets.append("calculista = %s")
                params.append(body.calculista)

            if not sets:
                return {"ok": True, "message": "Sin cambios"}

            params.append(id_proyecto)
            cur.execute(f"UPDATE proyectos SET {', '.join(sets)} WHERE id_proyecto = %s", params)

            # Si se renombró, actualizar nombre en barras también
            if body.nombre_proyecto is not None:
                cur.execute(
                    "UPDATE barras SET nombre_proyecto = %s WHERE id_proyecto = %s",
                    (body.nombre_proyecto, id_proyecto)
                )

    return {"ok": True, "id_proyecto": id_proyecto, "nombre_proyecto": body.nombre_proyecto}


@router.delete("/proyectos/{id_proyecto}")
def eliminar_proyecto(id_proyecto: str, user=Depends(get_current_user)):
    """Eliminar obra con cascada: borra barras, imports y proyecto."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")
            if not _puede_editar_proyecto(cur, id_proyecto, user):
                raise HTTPException(status_code=403, detail="No tienes permiso para eliminar este proyecto")
            nombre = row[0]

            cur.execute("SELECT COUNT(*) FROM barras WHERE id_proyecto = %s", (id_proyecto,))
            barras_count = int(cur.fetchone()[0])

            cur.execute("DELETE FROM proyecto_usuarios WHERE id_proyecto = %s", (id_proyecto,))
            cur.execute("DELETE FROM imports WHERE id_proyecto = %s", (id_proyecto,))
            cur.execute("DELETE FROM barras WHERE id_proyecto = %s", (id_proyecto,))
            cur.execute("DELETE FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))

    return {
        "ok": True,
        "id_proyecto": id_proyecto,
        "nombre_proyecto": nombre,
        "barras_eliminadas": barras_count,
    }


@router.post("/proyectos/{id_proyecto}/mover-barras")
def mover_barras(id_proyecto: str, body: MoverBarrasRequest, user=Depends(get_current_user)):
    """Mover barras de un proyecto a otro, opcionalmente filtradas por sector/piso/ciclo."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Proyecto origen no encontrado")
            if not _puede_editar_proyecto(cur, id_proyecto, user):
                raise HTTPException(status_code=403, detail="No tienes permiso para mover barras de este proyecto")

            cur.execute("SELECT nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (body.destino_id,))
            dest = cur.fetchone()
            if not dest:
                raise HTTPException(status_code=404, detail="Proyecto destino no encontrado")

            where = "WHERE id_proyecto = %s"
            params = [id_proyecto]
            if body.sector:
                where += " AND sector = %s"
                params.append(body.sector)
            if body.piso:
                where += " AND piso = %s"
                params.append(body.piso)
            if body.ciclo:
                where += " AND ciclo = %s"
                params.append(body.ciclo)

            cur.execute(f"SELECT COUNT(*) FROM barras {where}", params)
            count = int(cur.fetchone()[0])

            if count == 0:
                return {"ok": True, "movidas": 0, "message": "No hay barras que coincidan con los filtros"}

            cur.execute(
                f"UPDATE barras SET id_proyecto = %s, nombre_proyecto = %s {where}",
                [body.destino_id, dest[0]] + params
            )

    return {
        "ok": True,
        "movidas": count,
        "origen": id_proyecto,
        "destino": body.destino_id,
    }


# ========================= USERS LIST =========================

@router.get("/users/list")
def list_users(user=Depends(get_current_user)):
    """Lista de usuarios (id, email, role) para selectores de ownership."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email, role FROM users ORDER BY email")
            rows = cur.fetchall()
    return {
        "users": [
            {"id": r[0], "email": r[1], "role": r[2]}
            for r in rows
        ]
    }


# ========================= AUTORIZACIÓN DE PROYECTO =========================

@router.post("/proyectos/{id_proyecto}/autorizar")
def autorizar_usuario(id_proyecto: str, body: AutorizarUsuarioRequest, user=Depends(get_current_user)):
    """Autorizar a un usuario adicional a editar un proyecto. Solo owner o admin."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")
            if not _puede_editar_proyecto(cur, id_proyecto, user):
                raise HTTPException(status_code=403, detail="No tienes permiso para gestionar autorizaciones de este proyecto")
            cur.execute("SELECT id FROM users WHERE id = %s", (body.user_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            cur.execute("""
                INSERT INTO proyecto_usuarios (id_proyecto, user_id, rol)
                VALUES (%s, %s, %s)
                ON CONFLICT (id_proyecto, user_id) DO UPDATE SET rol = EXCLUDED.rol
            """, (id_proyecto, body.user_id, body.rol))
    return {"ok": True, "id_proyecto": id_proyecto, "user_id": body.user_id, "rol": body.rol}


@router.delete("/proyectos/{id_proyecto}/autorizar/{user_id}")
def revocar_usuario(id_proyecto: str, user_id: int, user=Depends(get_current_user)):
    """Revocar autorización de un usuario en un proyecto. Solo owner o admin."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not _puede_editar_proyecto(cur, id_proyecto, user):
                raise HTTPException(status_code=403, detail="No tienes permiso para gestionar autorizaciones de este proyecto")
            cur.execute(
                "DELETE FROM proyecto_usuarios WHERE id_proyecto = %s AND user_id = %s",
                (id_proyecto, user_id)
            )
    return {"ok": True, "id_proyecto": id_proyecto, "user_id": user_id}


@router.get("/proyectos/{id_proyecto}/autorizados")
def get_autorizados(id_proyecto: str, user=Depends(get_current_user)):
    """Lista de usuarios autorizados en un proyecto."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT pu.user_id, u.email, pu.rol
                FROM proyecto_usuarios pu
                JOIN users u ON pu.user_id = u.id
                WHERE pu.id_proyecto = %s
                ORDER BY u.email
            """, (id_proyecto,))
            rows = cur.fetchall()
    return {
        "autorizados": [
            {"user_id": r[0], "email": r[1], "rol": r[2]}
            for r in rows
        ]
    }