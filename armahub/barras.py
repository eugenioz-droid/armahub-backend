from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
import math
from .db import get_conn, audit
from .auth import get_current_user

router = APIRouter()

def _get_allowed_project_ids(cur, user: dict):
    """Returns None (unrestricted) for all roles.
    All users with cubicación module access see all projects.
    Module-level access is controlled at the hub/frontend layer."""
    return None

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
    """Retorna True si el usuario es admin/admin2 o está en proyecto_usuarios."""
    if user.get("role") in ("admin", "admin2"):
        return True
    cur.execute("SELECT id FROM users WHERE email = %s", (user.get("email"),))
    row = cur.fetchone()
    if not row:
        return False
    uid = row[0]
    cur.execute("SELECT 1 FROM proyecto_usuarios WHERE id_proyecto = %s AND user_id = %s", (id_proyecto, uid))
    return cur.fetchone() is not None

BARRAS_COLUMNS = [
    "id_unico","id_proyecto","nombre_proyecto","plano_code","nombre_plano","sector","piso","ciclo","eje",
    "diam","largo_total","mult","cant","cant_total",
    "peso_unitario","peso_total","version_mod","version_exp","fecha_carga",
    "origen","import_id"
]

ALLOWED_ORDER_BY = {
    "fecha_carga", "peso_total", "peso_unitario", "cant_total",
    "diam", "largo_total",
    "id_proyecto", "plano_code", "sector", "piso", "ciclo", "eje", "id_unico", "nombre_proyecto",
    "import_id"
}

@router.get("/barras")
def get_barras(
    proyecto: str = None,
    plano_code: str = None,
    sector: str = None,
    piso: str = None,
    ciclo: str = None,
    q: str = None,                      # búsqueda simple
    origen: str = None,                 # csv / manual / pedido
    import_id: int = None,              # filtrar por carga específica
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

    # filtro por origen
    if origen:
        base_where += " AND origen = %s"
        params.append(origen)

    # filtro por carga (import_id)
    if import_id is not None:
        base_where += " AND import_id = %s"
        params.append(import_id)

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
            pf_b, pf_bp = _project_filter_sql(allowed, "b")

            # Proyectos: filtered by authorization (return id + nombre)
            cur.execute("""
                SELECT DISTINCT b.id_proyecto, COALESCE(p.nombre_proyecto, b.nombre_proyecto, b.id_proyecto)
                FROM barras b
                LEFT JOIN proyectos p ON b.id_proyecto = p.id_proyecto
                WHERE 1=1""" + pf_b + """
                ORDER BY COALESCE(p.nombre_proyecto, b.nombre_proyecto, b.id_proyecto)
            """, pf_bp)
            proyectos = [{"id": r[0], "nombre": r[1]} for r in cur.fetchall() if r[0] is not None]

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
def get_stats(
    fecha_desde: Optional[str] = Query(None, description="ISO date start filter (inclusive)"),
    fecha_hasta: Optional[str] = Query(None, description="ISO date end filter (inclusive)"),
    user=Depends(get_current_user),
):
    """KPIs generales para Tab Inicio. Filtered by user authorization and optional date range."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            allowed = _get_allowed_project_ids(cur, user)
            pf_sql, pf_params = _project_filter_sql(allowed)
            w = " WHERE 1=1" + pf_sql
            wp = list(pf_params)

            # Date range filter on fecha_carga
            if fecha_desde:
                w += " AND fecha_carga >= %s"
                wp.append(fecha_desde)
            if fecha_hasta:
                w += " AND fecha_carga <= %s"
                wp.append(fecha_hasta + "T23:59:59Z")

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


@router.get("/stats/timeline")
def get_stats_timeline(
    fecha_desde: Optional[str] = Query(None, description="ISO date start filter"),
    fecha_hasta: Optional[str] = Query(None, description="ISO date end filter"),
    agrupacion: str = Query("dia", description="dia|semana|mes"),
    user=Depends(get_current_user),
):
    """Cubicación acumulada por período (barras y kilos importados por día/semana/mes)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            allowed = _get_allowed_project_ids(cur, user)
            pf_sql, pf_params = _project_filter_sql(allowed, "i")

            w = " WHERE 1=1" + pf_sql
            wp = list(pf_params)

            if fecha_desde:
                w += " AND i.fecha >= %s"
                wp.append(fecha_desde)
            if fecha_hasta:
                w += " AND i.fecha <= %s"
                wp.append(fecha_hasta + "T23:59:59Z")

            # Group by truncated date
            if agrupacion == "semana":
                trunc = "LEFT(i.fecha, 4) || '-W' || LPAD(CAST(EXTRACT(WEEK FROM CAST(LEFT(i.fecha, 10) AS DATE)) AS TEXT), 2, '0')"
            elif agrupacion == "mes":
                trunc = "LEFT(i.fecha, 7)"
            else:
                trunc = "LEFT(i.fecha, 10)"

            cur.execute(f"""
                SELECT {trunc} AS periodo,
                       SUM(i.barras_count) AS barras,
                       SUM(i.kilos) AS kilos,
                       COUNT(*) AS cargas
                FROM imports i
                {w}
                GROUP BY periodo
                ORDER BY periodo
            """, wp)
            rows = cur.fetchall()

    return {
        "agrupacion": agrupacion,
        "timeline": [
            {"periodo": r[0], "barras": int(r[1] or 0), "kilos": round(float(r[2] or 0), 2), "cargas": int(r[3])}
            for r in rows
        ]
    }


@router.get("/stats/cubicadores")
def get_stats_cubicadores(
    fecha_desde: Optional[str] = Query(None, description="ISO date start filter"),
    fecha_hasta: Optional[str] = Query(None, description="ISO date end filter"),
    user=Depends(get_current_user),
):
    """Resumen de cubicación por usuario (cubicador): barras, kilos, última actividad."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            allowed = _get_allowed_project_ids(cur, user)
            pf_sql, pf_params = _project_filter_sql(allowed, "i")

            w = " WHERE 1=1" + pf_sql
            wp = list(pf_params)

            if fecha_desde:
                w += " AND i.fecha >= %s"
                wp.append(fecha_desde)
            if fecha_hasta:
                w += " AND i.fecha <= %s"
                wp.append(fecha_hasta + "T23:59:59Z")

            cur.execute(f"""
                SELECT i.usuario,
                       SUM(i.barras_count) AS barras,
                       SUM(i.kilos) AS kilos,
                       COUNT(*) AS cargas,
                       COUNT(DISTINCT i.id_proyecto) AS proyectos,
                       MAX(i.fecha) AS ultima_actividad
                FROM imports i
                {w}
                GROUP BY i.usuario
                ORDER BY kilos DESC
            """, wp)
            rows = cur.fetchall()

    return {
        "cubicadores": [
            {
                "email": r[0],
                "barras": int(r[1] or 0),
                "kilos": round(float(r[2] or 0), 2),
                "cargas": int(r[3]),
                "proyectos": int(r[4]),
                "ultima_actividad": r[5],
            }
            for r in rows
        ]
    }


@router.get("/stats/mi-actividad")
def get_mi_actividad(user=Depends(get_current_user)):
    """Stats personales del cubicador logueado: hoy, últimos 14 días, semana actual vs anterior."""
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    # Last 14 days for daily breakdown
    day14_ago = (now - timedelta(days=13)).strftime("%Y-%m-%d")
    # Week boundaries (Monday-based)
    weekday = now.weekday()  # 0=Monday
    this_monday = (now - timedelta(days=weekday)).strftime("%Y-%m-%d")
    last_monday = (now - timedelta(days=weekday + 7)).strftime("%Y-%m-%d")
    last_sunday = (now - timedelta(days=weekday + 1)).strftime("%Y-%m-%d")

    email = user.get("email", "")

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Today's stats
            cur.execute("""
                SELECT COALESCE(SUM(barras_count), 0), COALESCE(SUM(kilos), 0), COUNT(*)
                FROM imports
                WHERE usuario = %s AND LEFT(fecha, 10) = %s
            """, (email, today))
            hoy = cur.fetchone()

            # Daily breakdown last 14 days
            cur.execute("""
                SELECT LEFT(fecha, 10) AS dia,
                       COALESCE(SUM(barras_count), 0) AS barras,
                       COALESCE(SUM(kilos), 0) AS kilos,
                       COUNT(*) AS cargas
                FROM imports
                WHERE usuario = %s AND LEFT(fecha, 10) >= %s
                GROUP BY dia
                ORDER BY dia
            """, (email, day14_ago))
            daily_rows = cur.fetchall()

            # This week totals
            cur.execute("""
                SELECT COALESCE(SUM(barras_count), 0), COALESCE(SUM(kilos), 0), COUNT(*)
                FROM imports
                WHERE usuario = %s AND LEFT(fecha, 10) >= %s
            """, (email, this_monday))
            sem_actual = cur.fetchone()

            # Last week totals
            cur.execute("""
                SELECT COALESCE(SUM(barras_count), 0), COALESCE(SUM(kilos), 0), COUNT(*)
                FROM imports
                WHERE usuario = %s AND LEFT(fecha, 10) >= %s AND LEFT(fecha, 10) <= %s
            """, (email, last_monday, last_sunday))
            sem_anterior = cur.fetchone()

    # Fill missing days in the 14-day window
    daily_map = {r[0]: {"barras": int(r[1]), "kilos": round(float(r[2]), 2), "cargas": int(r[3])} for r in daily_rows}
    dias = []
    for i in range(14):
        d = (now - timedelta(days=13 - i)).strftime("%Y-%m-%d")
        entry = daily_map.get(d, {"barras": 0, "kilos": 0.0, "cargas": 0})
        dias.append({"dia": d, **entry})

    return {
        "email": email,
        "hoy": {
            "fecha": today,
            "barras": int(hoy[0]),
            "kilos": round(float(hoy[1]), 2),
            "cargas": int(hoy[2]),
        },
        "dias": dias,
        "semana_actual": {
            "desde": this_monday,
            "barras": int(sem_actual[0]),
            "kilos": round(float(sem_actual[1]), 2),
            "cargas": int(sem_actual[2]),
        },
        "semana_anterior": {
            "desde": last_monday,
            "hasta": last_sunday,
            "barras": int(sem_anterior[0]),
            "kilos": round(float(sem_anterior[1]), 2),
            "cargas": int(sem_anterior[2]),
        },
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
                       estado, version_archivo, plano_code, errores
                FROM imports
                WHERE 1=1""" + pf_sql + """
                ORDER BY id DESC
                LIMIT %s
            """, (pf_params + [limit]))
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
                "errores": r[11],
            }
            for r in rows
        ]
    }


@router.get("/proyectos/{id_proyecto}/cargas")
def get_cargas_proyecto(
    id_proyecto: str,
    limit: int = 500,
    user=Depends(get_current_user),
):
    """Historial de cargas de un proyecto específico."""
    if limit < 1:
        limit = 1
    if limit > 500:
        limit = 500
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")
            cur.execute("""
                SELECT id, usuario, archivo, fecha, barras_count, kilos,
                       estado, version_archivo, plano_code, errores
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
                "errores": r[9],
            }
            for r in rows
        ]
    }


@router.delete("/cargas/{carga_id}")
def delete_carga(carga_id: int, user=Depends(get_current_user)):
    """Eliminar una carga: borra las barras por import_id y el registro de import."""
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

            if not _puede_editar_proyecto(cur, id_proyecto, user):
                raise HTTPException(status_code=403, detail="No tienes permiso para eliminar cargas de este proyecto")

            # Eliminar barras por import_id (principio de inmutabilidad de la carga)
            cur.execute(
                "DELETE FROM barras WHERE import_id = %s",
                (carga_id,)
            )
            barras_eliminadas = cur.rowcount
            # Fallback: si no hay barras con import_id (datos legacy), usar método antiguo
            if barras_eliminadas == 0:
                fecha = row[3]
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


class CambiarSectorRequest(BaseModel):
    id_unicos: list
    nuevo_sector: str


@router.post("/barras/cambiar-sector")
def cambiar_sector_barras(body: CambiarSectorRequest, user=Depends(get_current_user)):
    """Cambiar sector de barras individuales (dentro del mismo proyecto)."""
    if not body.id_unicos:
        raise HTTPException(status_code=400, detail="Lista de barras vacía")
    if not body.nuevo_sector:
        raise HTTPException(status_code=400, detail="Debe indicar nuevo_sector")

    SECTORES_VALIDOS = {"FUND", "ELEV", "LCIELO", "VCIELO"}
    if body.nuevo_sector.upper() not in SECTORES_VALIDOS:
        raise HTTPException(status_code=400, detail=f"Sector inválido. Válidos: {sorted(SECTORES_VALIDOS)}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM barras WHERE id_unico = %s", (body.id_unicos[0],))
            brow = cur.fetchone()
            if not brow:
                raise HTTPException(status_code=404, detail="Barra no encontrada")
            if not _puede_editar_proyecto(cur, brow[0], user):
                raise HTTPException(status_code=403, detail="No tienes permiso para editar barras de este proyecto")

            placeholders = ",".join(["%s"] * len(body.id_unicos))
            params = [body.nuevo_sector.upper()] + list(body.id_unicos)
            cur.execute(
                f"UPDATE barras SET sector = %s WHERE id_unico IN ({placeholders})",
                params
            )
            count = cur.rowcount

    return {"ok": True, "modificadas": count}


def _calcular_peso(diam, largo):
    """Fórmula ArmaHub: diam mm, largo cm => kg."""
    if diam is None or largo is None:
        return None, None
    peso_unitario = 7850 * 3.1416 * (diam / 2000) ** 2 * (largo / 100)
    return peso_unitario, peso_unitario


class BarraManualCreate(BaseModel):
    id_proyecto: str
    sector: str
    piso: str
    ciclo: str
    eje: str
    diam: float
    largo_total: float
    cant: float = 1
    figura: Optional[str] = None
    marca: Optional[str] = None


@router.post("/barras/crear")
def crear_barra_manual(body: BarraManualCreate, user=Depends(get_current_user)):
    """Crear una barra manual (origen='manual')."""
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto, nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (body.id_proyecto,))
            prow = cur.fetchone()
            if not prow:
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")
            if not _puede_editar_proyecto(cur, body.id_proyecto, user):
                raise HTTPException(status_code=403, detail="No tienes permiso para editar barras de este proyecto")

            nombre_proyecto = prow[1]
            id_unico = f"MAN-{uuid.uuid4().hex[:12].upper()}"
            cant_total = body.cant
            peso_unitario, _ = _calcular_peso(body.diam, body.largo_total)
            peso_total = peso_unitario * cant_total if peso_unitario else None

            cur.execute("""
                INSERT INTO barras (id_unico, id_proyecto, nombre_proyecto, sector, piso, ciclo, eje,
                    diam, largo_total, mult, cant, cant_total, peso_unitario, peso_total,
                    fecha_carga, origen, creado_por, figura, marca)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (id_unico, body.id_proyecto, nombre_proyecto,
                  body.sector.upper(), body.piso.upper(), body.ciclo.upper(), body.eje,
                  body.diam, body.largo_total, 1, body.cant, cant_total,
                  peso_unitario, peso_total, now, 'manual', email,
                  body.figura, body.marca))

    audit(email, "crear_barra_manual", f"Barra {id_unico} en {body.id_proyecto}", "barra", id_unico)
    return {"ok": True, "id_unico": id_unico, "peso_total": round(peso_total, 3) if peso_total else None}


@router.post("/barras/{id_unico}/duplicar")
def duplicar_barra(id_unico: str, user=Depends(get_current_user)):
    """Duplicar una barra existente como nueva barra manual."""
    email = user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id_unico, id_proyecto, nombre_proyecto, plano_code, nombre_plano,
                       sector, piso, ciclo, eje, diam, largo_total, mult, cant, cant_total,
                       peso_unitario, peso_total, figura, marca,
                       bar_id, estructura, tipo, esp,
                       dim_a, dim_b, dim_c, dim_d, dim_e, dim_f, dim_g, dim_h, dim_i,
                       ang1, ang2, ang3, ang4, radio
                FROM barras WHERE id_unico = %s
            """, (id_unico,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Barra no encontrada")

            src_proyecto = row[1]
            if not _puede_editar_proyecto(cur, src_proyecto, user):
                raise HTTPException(status_code=403, detail="No tienes permiso para duplicar barras de este proyecto")

            new_id = f"MAN-{uuid.uuid4().hex[:12].upper()}"

            cur.execute("""
                INSERT INTO barras (id_unico, id_proyecto, nombre_proyecto, plano_code, nombre_plano,
                    sector, piso, ciclo, eje, diam, largo_total, mult, cant, cant_total,
                    peso_unitario, peso_total, figura, marca,
                    bar_id, estructura, tipo, esp,
                    dim_a, dim_b, dim_c, dim_d, dim_e, dim_f, dim_g, dim_h, dim_i,
                    ang1, ang2, ang3, ang4, radio,
                    fecha_carga, origen, creado_por)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s)
            """, (new_id, row[1], row[2], row[3], row[4],
                  row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12], row[13],
                  row[14], row[15], row[16], row[17],
                  row[18], row[19], row[20], row[21],
                  row[22], row[23], row[24], row[25], row[26], row[27], row[28], row[29], row[30],
                  row[31], row[32], row[33], row[34], row[35],
                  now, 'manual', email))

    audit(email, "duplicar_barra", f"Duplicada {id_unico} → {new_id}", "barra", new_id)
    return {"ok": True, "id_unico": new_id, "origen": id_unico}


@router.delete("/barras/{id_unico}")
def eliminar_barra(id_unico: str, user=Depends(get_current_user)):
    """Eliminar una barra individual. Admin/cubicador pueden eliminar cualquier barra."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_unico, id_proyecto, origen FROM barras WHERE id_unico = %s", (id_unico,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Barra no encontrada")

            # Admin y cubicador pueden eliminar cualquier barra; otros roles solo manual/pedido
            if user.get("role") not in ("admin", "cubicador") and row[2] not in ('manual', 'pedido', None):
                raise HTTPException(status_code=400,
                    detail="Solo se pueden eliminar barras manuales o de pedido. Las barras CSV se eliminan borrando la carga completa.")

            if not _puede_editar_proyecto(cur, row[1], user):
                raise HTTPException(status_code=403, detail="No tienes permiso para eliminar barras de este proyecto")

            cur.execute("DELETE FROM barras WHERE id_unico = %s", (id_unico,))

    email = user.get("email", "unknown")
    audit(email, "eliminar_barra", f"Barra {id_unico} eliminada", "barra", id_unico)
    return {"ok": True, "id_unico": id_unico}


@router.get("/proyectos/{id_proyecto}/sectores-nav")
def get_sectores_nav(id_proyecto: str, user=Depends(get_current_user)):
    """Navegador de sectores: árbol sector->piso->ciclo con stats por nodo."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")

            cur.execute("""
                SELECT sector, piso, ciclo,
                       COUNT(*) AS barras,
                       COALESCE(SUM(peso_total), 0) AS kilos,
                       COUNT(DISTINCT eje) AS ejes,
                       COALESCE(
                         ROUND(CAST(SUM(diam * peso_total) / NULLIF(SUM(peso_total), 0) AS NUMERIC), 1),
                         0
                       ) AS diam_prom
                FROM barras
                WHERE id_proyecto = %s
                GROUP BY sector, piso, ciclo
                ORDER BY sector, piso, ciclo
            """, (id_proyecto,))
            rows = cur.fetchall()

    tree = {}
    for r in rows:
        sector, piso, ciclo = r[0] or '', r[1] or '', r[2] or ''
        node = {"barras": int(r[3]), "kilos": round(float(r[4]), 2), "ejes": int(r[5]), "diam_prom": float(r[6])}

        if sector not in tree:
            tree[sector] = {"barras": 0, "kilos": 0.0, "pisos": {}}
        tree[sector]["barras"] += node["barras"]
        tree[sector]["kilos"] += node["kilos"]

        if piso not in tree[sector]["pisos"]:
            tree[sector]["pisos"][piso] = {"barras": 0, "kilos": 0.0, "ciclos": {}}
        tree[sector]["pisos"][piso]["barras"] += node["barras"]
        tree[sector]["pisos"][piso]["kilos"] += node["kilos"]

        tree[sector]["pisos"][piso]["ciclos"][ciclo] = node

    result = []
    for sector in sorted(tree.keys()):
        s = tree[sector]
        pisos_list = []
        for piso in sorted(s["pisos"].keys()):
            p = s["pisos"][piso]
            ciclos_list = [
                {"ciclo": c, **p["ciclos"][c]}
                for c in sorted(p["ciclos"].keys())
            ]
            pisos_list.append({
                "piso": piso,
                "barras": p["barras"],
                "kilos": round(p["kilos"], 2),
                "ciclos": ciclos_list,
            })
        result.append({
            "sector": sector,
            "barras": s["barras"],
            "kilos": round(s["kilos"], 2),
            "pisos": pisos_list,
        })

    return {"id_proyecto": id_proyecto, "sectores": result}


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
    Incluye constructora y calculista. Filtered by user authorization.
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
                    p.constructora_id,
                    co.nombre as constructora_nombre,
                    p.calculista_id,
                    ca.nombre as calculista_nombre,
                    p.descripcion,
                    p.fecha_creacion,
                    p.usuario_creador
                FROM proyectos p
                LEFT JOIN barras b ON p.id_proyecto = b.id_proyecto
                LEFT JOIN constructoras co ON p.constructora_id = co.id
                LEFT JOIN calculistas ca ON p.calculista_id = ca.id
                WHERE 1=1""" + pf_p + """
                GROUP BY p.id_proyecto, p.nombre_proyecto,
                         p.constructora_id, co.nombre, p.calculista_id, ca.nombre,
                         p.descripcion, p.fecha_creacion, p.usuario_creador
                ORDER BY p.fecha_creacion DESC
            """, pf_pp)
            rows = cur.fetchall()

            # Fetch aliases for all projects
            alias_map = {}
            try:
                cur.execute("SELECT alias, id_proyecto FROM proyecto_aliases")
                for a_row in cur.fetchall():
                    alias_map.setdefault(a_row[1], []).append(a_row[0])
            except Exception:
                pass

    return {
        "proyectos": [
            {
                "id_proyecto": r[0],
                "nombre_proyecto": r[1],
                "total_barras": int(r[2]) if r[2] else 0,
                "total_kilos": float(r[3]) if r[3] else 0.0,
                "constructora_id": r[4],
                "constructora_nombre": r[5],
                "calculista_id": r[6],
                "calculista_nombre": r[7],
                "descripcion": r[8],
                "fecha_creacion": r[9],
                "usuario_creador": r[10],
                "aliases": alias_map.get(r[0], []),
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
    calculista_id: Optional[int] = None
    constructora_id: Optional[int] = None

class ProyectoUpdate(BaseModel):
    nombre_proyecto: Optional[str] = None
    descripcion: Optional[str] = None
    calculista_id: Optional[int] = None
    constructora_id: Optional[int] = None

class AutorizarUsuarioRequest(BaseModel):
    user_id: int
    rol: str = "cubicador"

class MoverBarrasRequest(BaseModel):
    destino_id: str
    sector: Optional[str] = None
    piso: Optional[str] = None
    ciclo: Optional[str] = None


@router.post("/proyectos")
def crear_proyecto(body: ProyectoCreate, user=Depends(get_current_user)):
    """Crear una obra vacía manualmente (sin CSV)."""
    import uuid
    id_proyecto = "PROY-" + uuid.uuid4().hex[:8].upper()
    email = user.get("email", "unknown")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO proyectos (id_proyecto, nombre_proyecto, usuario_creador, calculista_id, constructora_id)
                VALUES (%s, %s, %s, %s, %s)
            """, (id_proyecto, body.nombre_proyecto, email, body.calculista_id, body.constructora_id))

            # Auto-add creator to proyecto_usuarios
            cur.execute("SELECT id FROM users WHERE email = %s", (email,))
            user_row = cur.fetchone()
            if user_row:
                rol_map = {'admin': 'admin', 'admin2': 'admin', 'cubicador': 'cubicador', 'usc': 'usc', 'externo': 'externo', 'cliente': 'cliente'}
                rol = rol_map.get(user.get('role', ''), 'cubicador')
                cur.execute("""
                    INSERT INTO proyecto_usuarios (id_proyecto, user_id, rol)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (id_proyecto, user_id) DO NOTHING
                """, (id_proyecto, user_row[0], rol))
    audit(email, "crear_proyecto", body.nombre_proyecto, "proyecto", id_proyecto)
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
            if body.calculista_id is not None:
                sets.append("calculista_id = %s")
                params.append(body.calculista_id if body.calculista_id != 0 else None)
            if body.constructora_id is not None:
                sets.append("constructora_id = %s")
                params.append(body.constructora_id if body.constructora_id != 0 else None)

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
    audit(user.get("email", "?"), "editar_proyecto", f"campos: {', '.join(s.split(' =')[0] for s in sets)}", "proyecto", id_proyecto)
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

            cur.execute("SELECT COUNT(*) FROM reclamos WHERE id_proyecto = %s", (id_proyecto,))
            reclamos_count = int(cur.fetchone()[0])

            # Bloquear eliminación si hay reclamos asociados (cualquier rol)
            if reclamos_count > 0:
                raise HTTPException(status_code=403, detail=f"No puedes eliminar una obra con {reclamos_count} reclamos asociados. Contacta al administrador.")

            # Cubicador: solo puede eliminar obras vacías
            if user.get("role") == "cubicador" and barras_count > 0:
                raise HTTPException(status_code=403, detail=f"No puedes eliminar una obra con {barras_count} barras cargadas. Contacta al administrador.")

            cur.execute("DELETE FROM proyecto_usuarios WHERE id_proyecto = %s", (id_proyecto,))
            cur.execute("DELETE FROM imports WHERE id_proyecto = %s", (id_proyecto,))
            cur.execute("DELETE FROM barras WHERE id_proyecto = %s", (id_proyecto,))
            cur.execute("DELETE FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
    audit(user.get("email", "?"), "eliminar_proyecto", f"{nombre} ({barras_count} barras)", "proyecto", id_proyecto)
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
    audit(user.get("email", "?"), "mover_barras", f"{count} barras {id_proyecto} → {body.destino_id}", "proyecto", id_proyecto)
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
                SELECT pu.user_id, u.email, pu.rol, u.nombre, u.apellido
                FROM proyecto_usuarios pu
                JOIN users u ON pu.user_id = u.id
                WHERE pu.id_proyecto = %s
                ORDER BY pu.rol, u.email
            """, (id_proyecto,))
            rows = cur.fetchall()
    return {
        "autorizados": [
            {"user_id": r[0], "email": r[1], "rol": r[2], "nombre": r[3], "apellido": r[4]}
            for r in rows
        ]
    }


# ========================= LANDING INDICADORES =========================

@router.get("/landing/indicadores")
def landing_indicadores(user=Depends(get_current_user)):
    """Flash indicators for the hub landing page, role-aware."""
    from datetime import timedelta
    email = user.get("email", "")
    role = user.get("role", "usc")
    now = datetime.now(timezone.utc)
    # Monday of current week
    monday = (now - timedelta(days=now.weekday())).strftime("%Y-%m-%d")
    sunday = (now - timedelta(days=now.weekday()) + timedelta(days=6)).strftime("%Y-%m-%d")

    result = {}

    with get_conn() as conn:
        with conn.cursor() as cur:
            # --- Cubicado semana (visible to admin, admin2, cubicador) ---
            if role in ("admin", "admin2", "cubicador"):
                cur.execute("""
                    SELECT i.usuario,
                           COALESCE(u.nombre, '') AS nombre,
                           COALESCE(u.apellido, '') AS apellido,
                           EXTRACT(ISODOW FROM i.fecha::timestamp)::INTEGER AS dow,
                           COALESCE(SUM(i.kilos), 0) AS kilos
                    FROM imports i
                    JOIN users u ON u.email = i.usuario
                    WHERE u.role = 'cubicador'
                      AND LEFT(i.fecha, 10) >= %s
                      AND LEFT(i.fecha, 10) <= %s
                    GROUP BY i.usuario, u.nombre, u.apellido, dow
                    ORDER BY i.usuario, dow
                """, (monday, sunday))
                rows = cur.fetchall()
                cub_map = {}
                for r in rows:
                    email_cub = r[0]
                    if email_cub not in cub_map:
                        nombre = ((r[1] or "") + " " + (r[2] or "")).strip()
                        cub_map[email_cub] = {
                            "email": email_cub,
                            "nombre": nombre or email_cub.split("@")[0],
                            "dias": [0, 0, 0, 0, 0, 0, 0],
                        }
                    cub_map[email_cub]["dias"][r[3] - 1] = round(float(r[4]), 1)
                result["cubicado_semana"] = list(cub_map.values())

            # --- Reclamos levantados semana (visible to admin, admin2, usc, cubicador) ---
            if role in ("admin", "admin2", "usc", "cubicador"):
                cur.execute("""
                    SELECT r.creado_por,
                           COALESCE(u.nombre, '') AS nombre,
                           COALESCE(u.apellido, '') AS apellido,
                           EXTRACT(ISODOW FROM COALESCE(r.fecha_deteccion, r.fecha_creacion)::timestamp)::INTEGER AS dow,
                           COUNT(*) AS cnt
                    FROM reclamos r
                    LEFT JOIN users u ON u.email = r.creado_por
                    WHERE LEFT(COALESCE(r.fecha_deteccion, r.fecha_creacion), 10) >= %s
                      AND LEFT(COALESCE(r.fecha_deteccion, r.fecha_creacion), 10) <= %s
                    GROUP BY r.creado_por, u.nombre, u.apellido, dow
                    ORDER BY r.creado_por, dow
                """, (monday, sunday))
                rows = cur.fetchall()
                usc_map = {}
                for r in rows:
                    email_usc = r[0] or "desconocido"
                    if email_usc not in usc_map:
                        nombre = ((r[1] or "") + " " + (r[2] or "")).strip()
                        usc_map[email_usc] = {
                            "email": email_usc,
                            "nombre": nombre or email_usc.split("@")[0],
                            "dias": [0, 0, 0, 0, 0, 0, 0],
                        }
                    usc_map[email_usc]["dias"][r[3] - 1] = int(r[4])
                result["reclamos_semana"] = list(usc_map.values())

            # --- Alertas: reclamos abiertos ---
            if role in ("admin", "admin2"):
                cur.execute("""
                    SELECT estado, COUNT(*) FROM reclamos
                    WHERE estado NOT IN ('cerrado', 'rechazado')
                    GROUP BY estado ORDER BY 2 DESC
                """)
            elif role == "cubicador":
                cur.execute("""
                    SELECT estado, COUNT(*) FROM reclamos
                    WHERE (cubicador_asignado = %s OR respuesta_por = %s)
                      AND estado NOT IN ('cerrado', 'rechazado')
                    GROUP BY estado ORDER BY 2 DESC
                """, (email, email))
            elif role == "usc":
                cur.execute("""
                    SELECT estado, COUNT(*) FROM reclamos
                    WHERE (creado_por = %s OR asignado_a = %s)
                      AND estado NOT IN ('cerrado', 'rechazado')
                    GROUP BY estado ORDER BY 2 DESC
                """, (email, email))
            else:
                cur.execute("SELECT estado, 0 FROM reclamos WHERE FALSE")

            alertas_rows = cur.fetchall()
            alertas = [{"estado": r[0], "count": int(r[1])} for r in alertas_rows]
            total_abiertos = sum(a["count"] for a in alertas)
            result["alertas"] = {"total_abiertos": total_abiertos, "por_estado": alertas}

    return result