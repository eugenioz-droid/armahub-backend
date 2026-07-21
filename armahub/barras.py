from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
import math
from psycopg.rows import dict_row
from .db import get_conn, audit
from .auth import get_current_user, ROL_MAP, _rol_proyecto_usuarios, _PROYECTO_USUARIOS_ROLES
from . import cache as _cache

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
    """Retorna True si el usuario es admin/admin_calidad o está en proyecto_usuarios."""
    email = user.get("email", "")
    role = user.get("role", "")
    if role in ("admin", "admin_calidad"):
        return True
    cur.execute("SELECT id FROM users WHERE email = %s", (email,))
    row = cur.fetchone()
    if not row:
        return False
    uid = row[0]
    cur.execute("SELECT 1 FROM proyecto_usuarios WHERE id_proyecto = %s AND user_id = %s", (id_proyecto, uid))
    return cur.fetchone() is not None

BARRAS_COLUMNS = [
    "id",  # PK numérico (5M.3) — necesario para editar una barra
    "id_unico","id_proyecto","nombre_proyecto","plano_code","nombre_plano","sector","piso","ciclo","eje",
    "diam","largo_total","mult","cant","cant_total",
    "peso_unitario","peso_total","version_mod","version_exp","fecha_carga",
    "origen","import_id",
    "marca","figura",
    "dim_a","dim_b","dim_c","dim_d","dim_e","dim_f","dim_g","dim_h","dim_i",
    "ang1","ang2","ang3","ang4","radio",
    "editado_por","editado_fecha"  # marca de edición manual (5M.3)
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
    eje: str = None,
    q: str = None,                      # búsqueda simple
    origen: str = None,                 # csv / manual / pedido
    import_id: int = None,              # filtrar por carga específica
    figura: str = None,                 # 5M.2: filtro por código de figura
    marca: str = None,                  # 5M.2: filtro por tipología (marca)
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

    if eje:
        base_where += " AND eje = %s"
        params.append(eje)

    # filtro por origen
    if origen:
        base_where += " AND origen = %s"
        params.append(origen)

    # filtro por carga (import_id)
    if import_id is not None:
        base_where += " AND import_id = %s"
        params.append(import_id)

    # 5M.2: filtro por figura y por tipología (marca)
    if figura:
        base_where += " AND figura = %s"
        params.append(figura)
    if marca:
        base_where += " AND marca = %s"
        params.append(marca)

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


# ========================= VISTA AGRUPADA POR ELEMENTO =========================
# Un "elemento" es la unidad lógica de cubicación: (piso, sector, eje).
# Dentro de un elemento hay barras distribuidas en múltiples ciclos.
# Esta vista permite navegar la cubicación con la granularidad real del cubicador.

@router.get("/barras/elementos")
def get_barras_elementos(
    proyecto: str = None,
    plano_code: str = None,
    sector: str = None,
    piso: str = None,
    ciclo: str = None,
    q: str = None,
    origen: str = None,
    import_id: int = None,
    figura: str = None,                 # 5M.2
    marca: str = None,                  # 5M.2
    limit: int = 50,
    offset: int = 0,
    user=Depends(get_current_user),
):
    """Retorna barras agrupadas por (piso, sector, eje).

    Cada fila ('elemento') agrega:
      - items: número de filas/barras lógicas en BD
      - sum_cant_total, sum_largo_total, sum_kg: sumas reales
      - diam_min, diam_max: rango de diámetros
      - ciclos: lista ordenada de ciclos cubiertos
      - origenes: lista de origenes presentes (csv/manual/pedido)

    Paginación por elemento. Orden fijo: piso (natural) → sector → eje.

    Devuelve también KPIs globales del filtro: elementos_total, barras_total,
    kg_total, pisos_count, sectores_count, ejes_count.
    """
    if limit < 1: limit = 1
    if limit > 500: limit = 500
    if offset < 0: offset = 0

    base_where = " WHERE 1=1 "
    params = []
    if proyecto:
        base_where += " AND id_proyecto = %s"; params.append(proyecto)
    if plano_code:
        base_where += " AND plano_code = %s"; params.append(plano_code)
    if sector:
        base_where += " AND sector = %s"; params.append(sector)
    if piso:
        base_where += " AND piso = %s"; params.append(piso)
    if ciclo:
        base_where += " AND ciclo = %s"; params.append(ciclo)
    if origen:
        base_where += " AND origen = %s"; params.append(origen)
    if import_id is not None:
        base_where += " AND import_id = %s"; params.append(import_id)
    if figura:
        base_where += " AND figura = %s"; params.append(figura)
    if marca:
        base_where += " AND marca = %s"; params.append(marca)
    if q and q.strip():
        qq = f"%{q.strip()}%"
        base_where += " AND (id_unico ILIKE %s OR eje ILIKE %s OR plano_code ILIKE %s)"
        params.extend([qq, qq, qq])

    with get_conn() as conn:
        with conn.cursor() as cur:
            allowed = _get_allowed_project_ids(cur, user)
            pf_sql, pf_params = _project_filter_sql(allowed)
            full_where = base_where + pf_sql
            full_params = params + pf_params

            # Agregación por (piso, sector, eje)
            agg_select = """
                SELECT COALESCE(piso, '')   AS piso,
                       COALESCE(sector, '') AS sector,
                       COALESCE(eje, '')    AS eje,
                       COUNT(*)                                       AS items,
                       COALESCE(SUM(cant_total), 0)                   AS sum_cant_total,
                       COALESCE(SUM(largo_total), 0)                  AS sum_largo_total,
                       COALESCE(SUM(peso_total), 0)                   AS sum_kg,
                       MIN(diam)                                      AS diam_min,
                       MAX(diam)                                      AS diam_max,
                       array_agg(DISTINCT COALESCE(ciclo, ''))        AS ciclos,
                       array_agg(DISTINCT COALESCE(origen, 'csv'))    AS origenes
                FROM barras
                """
            # COUNT total de elementos para paginación
            count_sql = f"""
                SELECT COUNT(*) FROM (
                    SELECT 1 FROM barras
                    {full_where}
                    GROUP BY COALESCE(piso, ''), COALESCE(sector, ''), COALESCE(eje, '')
                ) t
            """
            cur.execute(count_sql, full_params)
            elementos_total = int(cur.fetchone()[0])

            # KPIs globales del filtro
            kpi_sql = f"""
                SELECT COUNT(*)                                             AS barras_total,
                       COALESCE(SUM(peso_total), 0)                         AS kg_total,
                       COALESCE(SUM(cant_total), 0)                         AS cant_total_sum,
                       COUNT(DISTINCT COALESCE(piso, ''))                   AS pisos_count,
                       COUNT(DISTINCT COALESCE(sector, ''))                 AS sectores_count,
                       COUNT(DISTINCT COALESCE(eje, ''))                    AS ejes_count
                FROM barras
                {full_where}
            """
            cur.execute(kpi_sql, full_params)
            kpi_row = cur.fetchone() or (0, 0, 0, 0, 0, 0)

            # Datos agrupados con orden natural por piso usando regex para extraer número
            # Ej: P1, P2, P10 ordenan correctamente; resto al final.
            # Orden: Piso (natural) → Sector (ELEV/LCIELO/VCIELO/FUND) → Eje
            order_clause = """
                ORDER BY
                  CASE WHEN COALESCE(piso, '') = '' THEN 1 ELSE 0 END,
                  COALESCE(NULLIF(regexp_replace(COALESCE(piso, ''), '\\D', '', 'g'), '')::int, 0),
                  COALESCE(piso, ''),
                  CASE COALESCE(sector, '')
                    WHEN 'ELEV'   THEN 1
                    WHEN 'LCIELO' THEN 2
                    WHEN 'VCIELO' THEN 3
                    WHEN 'FUND'   THEN 4
                    ELSE 9
                  END,
                  COALESCE(sector, ''),
                  COALESCE(eje, '')
            """
            data_sql = f"""
                {agg_select}
                {full_where}
                GROUP BY COALESCE(piso, ''), COALESCE(sector, ''), COALESCE(eje, '')
                {order_clause}
                LIMIT %s OFFSET %s
            """
            cur.execute(data_sql, full_params + [limit, offset])
            rows = cur.fetchall()

    elementos = []
    for r in rows:
        ciclos_arr = list(r[9]) if r[9] else []
        ciclos_arr = [c for c in ciclos_arr if c]
        try:
            ciclos_arr.sort(key=lambda c: (
                ''.join([ch for ch in c if not ch.isdigit()]),
                int(''.join([ch for ch in c if ch.isdigit()]) or 0),
                c
            ))
        except Exception:
            ciclos_arr.sort()
        origenes_arr = sorted(set([o for o in (list(r[10]) if r[10] else []) if o]))
        elementos.append({
            "piso": r[0] or "",
            "sector": r[1] or "",
            "eje": r[2] or "",
            "items": int(r[3]),
            "sum_cant_total": float(r[4] or 0),
            "sum_largo_total": float(r[5] or 0),
            "sum_kg": round(float(r[6] or 0), 2),
            "diam_min": int(r[7]) if r[7] is not None else None,
            "diam_max": int(r[8]) if r[8] is not None else None,
            "ciclos": ciclos_arr,
            "origenes": origenes_arr,
        })

    return {
        "data": elementos,
        "total": elementos_total,
        "limit": limit,
        "offset": offset,
        "summary": {
            "elementos_total": elementos_total,
            "barras_total": int(kpi_row[0] or 0),
            "kg_total": round(float(kpi_row[1] or 0), 2),
            "cant_total_sum": float(kpi_row[2] or 0),
            "pisos_count": int(kpi_row[3] or 0),
            "sectores_count": int(kpi_row[4] or 0),
            "ejes_count": int(kpi_row[5] or 0),
        }
    }


@router.get("/barras/facetas")
def get_barras_facetas(proyecto: str, user=Depends(get_current_user)):
    """Valores distintos de figura y tipología (marca) PRESENTES en una obra (5M.2).
    Para poblar los filtros del Bar Manager con lo que realmente existe, no el
    catálogo entero."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            allowed = _get_allowed_project_ids(cur, user)
            pf_sql, pf_params = _project_filter_sql(allowed)
            cur.execute(
                "SELECT DISTINCT figura FROM barras WHERE id_proyecto = %s AND figura IS NOT NULL AND figura <> ''"
                + pf_sql + " ORDER BY figura",
                [proyecto] + pf_params,
            )
            figuras = [r[0] for r in cur.fetchall()]
            cur.execute(
                "SELECT DISTINCT marca FROM barras WHERE id_proyecto = %s AND marca IS NOT NULL AND marca <> ''"
                + pf_sql + " ORDER BY marca",
                [proyecto] + pf_params,
            )
            tipologias = [r[0] for r in cur.fetchall()]
    return {"figuras": figuras, "tipologias": tipologias}


# ========================= MAPA DE COBERTURA PISO × CICLO =========================

@router.get("/barras/cobertura")
def get_barras_cobertura(
    proyecto: str = None,
    plano_code: str = None,
    sector: str = None,
    origen: str = None,
    import_id: int = None,
    user=Depends(get_current_user),
):
    """Heatmap Piso × Ciclo. Para cada cruce devuelve barras y kg.
    Útil para detectar pisos/ciclos no cubicados ('huecos')."""
    base_where = " WHERE 1=1 "
    params = []
    if proyecto:
        base_where += " AND id_proyecto = %s"; params.append(proyecto)
    if plano_code:
        base_where += " AND plano_code = %s"; params.append(plano_code)
    if sector:
        base_where += " AND sector = %s"; params.append(sector)
    if origen:
        base_where += " AND origen = %s"; params.append(origen)
    if import_id is not None:
        base_where += " AND import_id = %s"; params.append(import_id)

    with get_conn() as conn:
        with conn.cursor() as cur:
            allowed = _get_allowed_project_ids(cur, user)
            pf_sql, pf_params = _project_filter_sql(allowed)
            full_where = base_where + pf_sql
            full_params = params + pf_params

            sql = f"""
                SELECT COALESCE(piso, '')   AS piso,
                       COALESCE(ciclo, '')  AS ciclo,
                       COALESCE(sector, '') AS sector,
                       COUNT(*)             AS barras,
                       COALESCE(SUM(peso_total), 0) AS kg
                FROM barras
                {full_where}
                GROUP BY COALESCE(piso, ''), COALESCE(ciclo, ''), COALESCE(sector, '')
            """
            cur.execute(sql, full_params)
            rows = cur.fetchall()

    cells = [
        {
            "piso": r[0] or "",
            "ciclo": r[1] or "",
            "sector": r[2] or "",
            "barras": int(r[3] or 0),
            "kg": round(float(r[4] or 0), 2),
        }
        for r in rows
    ]
    pisos = sorted({c["piso"] for c in cells if c["piso"]})
    ciclos = sorted({c["ciclo"] for c in cells if c["ciclo"]})
    # max_kg se calcula sobre cuadrantes individuales (piso×ciclo×sector), que es la
    # unidad visual del heatmap (cada cuadrante se colorea por su propia intensidad).
    max_kg = max((c["kg"] for c in cells), default=0)

    return {
        "pisos": pisos,
        "ciclos": ciclos,
        "cells": cells,
        "max_kg": round(float(max_kg), 2),
    }


@router.get("/filters")
def filters(
    proyecto: Optional[str] = None,
    plano_code: Optional[str] = None,
    sector: Optional[str] = None,
    piso: Optional[str] = None,
    ciclo: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Filtros dependientes en cascada: proyecto → plano → sector → piso → ciclo → eje.
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

            # Ejes: filtrado por proyecto + plano + sector + piso + ciclo (+ auth)
            if ciclo:
                w_parts.append("ciclo = %s"); w_vals.append(ciclo)
            wsql = " WHERE " + " AND ".join(w_parts)
            cur.execute(f"SELECT DISTINCT eje FROM barras{wsql} AND eje IS NOT NULL ORDER BY eje", w_vals)
            ejes = [r[0] for r in cur.fetchall() if r[0] is not None]

    return {
        "sectores": sectores,
        "pisos": pisos,
        "ciclos": ciclos,
        "ejes": ejes,
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
    cache_key = f"stats:{user.get('email','')}:{fecha_desde}:{fecha_hasta}"
    cached = _cache.get(cache_key)
    if cached:
        return cached
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

            # Exported kilos per project (from export_log, deduplicated)
            # Only take the latest export per (proyecto, sector, piso, ciclo)
            pf_e, pf_ep = _project_filter_sql(allowed, "e")
            cur.execute("""
                SELECT e.id_proyecto, COALESCE(SUM(e.kilos), 0) AS kilos_exp
                FROM (
                    SELECT DISTINCT ON (id_proyecto, sector, piso, ciclo)
                           id_proyecto, kilos
                    FROM export_log
                    WHERE 1=1""" + pf_e + """
                    ORDER BY id_proyecto, sector, piso, ciclo, fecha DESC
                ) e
                GROUP BY e.id_proyecto
            """, pf_ep)
            exp_map = {r[0]: round(float(r[1]), 2) for r in cur.fetchall()}

            # Total cargas
            pf_i, pf_ip = _project_filter_sql(allowed, "i")
            cur.execute("SELECT COUNT(*) FROM imports i WHERE 1=1" + pf_i, pf_ip)
            total_cargas = int(cur.fetchone()[0])

    proyectos_all = [
        {"nombre": r[0], "id_proyecto": r[1], "barras": int(r[2]),
         "kilos": round(float(r[3]), 2),
         "kilos_exportados": exp_map.get(r[1], 0)}
        for r in proyectos_rows
    ]

    result = {
        "total_barras": total_barras,
        "total_proyectos": total_proyectos,
        "total_kilos": round(total_kilos, 2),
        "ultima_carga": ultima_carga,
        "ppb": ppb,
        "ppi": ppi,
        "diam_promedio": diam_prom,
        "total_items": total_items,
        "total_cargas": total_cargas,
        "kg_por_carga": round(total_kilos / total_cargas, 2) if total_cargas > 0 else 0,
        "top5": proyectos_all[:5],
        "proyectos": proyectos_all,
    }
    _cache.put(cache_key, result, ttl=30)
    return result


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

            # Exported kilos per user (from export_log, deduplicated)
            pf_el, pf_elp = _project_filter_sql(allowed, "el")
            cur.execute("""
                SELECT el.usuario, COALESCE(SUM(el.kilos), 0) AS kilos_exp
                FROM (
                    SELECT DISTINCT ON (id_proyecto, sector, piso, ciclo)
                           usuario, kilos
                    FROM export_log
                    WHERE 1=1""" + pf_el + """
                    ORDER BY id_proyecto, sector, piso, ciclo, fecha DESC
                ) el
                GROUP BY el.usuario
            """, pf_elp)
            exp_user_map = {r[0]: round(float(r[1]), 2) for r in cur.fetchall()}

    return {
        "cubicadores": [
            {
                "email": r[0],
                "barras": int(r[1] or 0),
                "kilos": round(float(r[2] or 0), 2),
                "kilos_exportados": exp_user_map.get(r[0], 0),
                "cargas": int(r[3]),
                "proyectos": int(r[4]),
                "ultima_actividad": r[5],
            }
            for r in rows
        ]
    }


@router.get("/stats/cubicacion-mensual")
def get_cubicacion_mensual(
    anio: int = Query(..., description="Año a consultar (ej: 2026)"),
    user=Depends(get_current_user),
):
    """Cubicación mensual desglosada por cubicador. Retorna 12 meses con tonelaje por usuario."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            allowed = _get_allowed_project_ids(cur, user)
            pf_sql, pf_params = _project_filter_sql(allowed, "i")

            cur.execute("""
                SELECT EXTRACT(MONTH FROM CAST(LEFT(i.fecha, 10) AS DATE))::int AS mes,
                       i.usuario,
                       COALESCE(SUM(i.kilos), 0) AS kilos
                FROM imports i
                WHERE LEFT(i.fecha, 4) = %s""" + pf_sql + """
                GROUP BY mes, i.usuario
                ORDER BY mes, kilos DESC
            """, [str(anio)] + pf_params)
            rows = cur.fetchall()

    # Build cubicador map: {usuario: [12 values]}
    cub_map = {}
    for r in rows:
        mes_idx = int(r[0]) - 1
        usuario = r[1] or "desconocido"
        kilos = round(float(r[2]) / 1000, 3)  # convert to Tn
        if usuario not in cub_map:
            cub_map[usuario] = [0.0] * 12
        cub_map[usuario][mes_idx] = kilos

    # Sort by total desc
    cubicadores = sorted(
        [{"nombre": u, "datos": d} for u, d in cub_map.items()],
        key=lambda x: sum(x["datos"]),
        reverse=True
    )

    return {
        "anio": anio,
        "meses": ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
        "cubicadores": cubicadores,
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
                "SELECT id, id_proyecto, archivo, fecha, barras_count, usuario FROM imports WHERE id = %s",
                (carga_id,)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Carga no encontrada")
            id_proyecto = row[1]
            archivo = row[2]
            uploader = row[5]

            # Borrar carga: solo quien la subió (o admin/admin_calidad). Por ahora
            # NO se permite borrar cargas ajenas (decisión 2026-06-18; se flexibiliza
            # más adelante). Antes bastaba con estar autorizado en la obra.
            role = user.get("role", "")
            es_admin = role in ("admin", "admin_calidad")
            es_uploader = (uploader == user.get("email"))
            if not es_admin and not es_uploader:
                raise HTTPException(status_code=403, detail="Solo puedes eliminar cargas que tú subiste. Esta carga la realizó otro usuario.")

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

    _cache.invalidate("stats:", "landing:")
    return {
        "ok": True,
        "carga_id": carga_id,
        "archivo": archivo,
        "barras_eliminadas": barras_eliminadas,
    }


class BulkDeleteCargasRequest(BaseModel):
    ids: list


@router.post("/cargas/bulk-delete")
def bulk_delete_cargas(body: BulkDeleteCargasRequest, user=Depends(get_current_user)):
    """Eliminar múltiples cargas a la vez. Solo el uploader (o admin) puede borrar
    cada carga; las que no correspondan se informan como 'sin permiso' para que el
    front avise (antes se omitían en silencio y parecía que se borraban)."""
    if not body.ids:
        raise HTTPException(status_code=400, detail="No se proporcionaron IDs de cargas")
    if len(body.ids) > 100:
        raise HTTPException(status_code=400, detail="No se pueden eliminar más de 100 cargas a la vez")

    role = user.get("role", "")
    es_admin = role in ("admin", "admin_calidad")
    email = user.get("email")

    total_barras_eliminadas = 0
    cargas_eliminadas = 0
    sin_permiso = 0
    no_encontradas = 0

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                for carga_id in body.ids:
                    cur.execute(
                        "SELECT id, id_proyecto, archivo, fecha, barras_count, usuario FROM imports WHERE id = %s",
                        (carga_id,)
                    )
                    row = cur.fetchone()
                    if not row:
                        no_encontradas += 1
                        continue

                    id_proyecto = row[1]
                    uploader = row[5]

                    # Solo el uploader o admin (decisión 2026-06-18).
                    if not es_admin and uploader != email:
                        sin_permiso += 1
                        continue

                    cur.execute("DELETE FROM barras WHERE import_id = %s", (carga_id,))
                    barras_eliminadas = cur.rowcount
                    if barras_eliminadas == 0:
                        fecha = row[3]
                        cur.execute(
                            "DELETE FROM barras WHERE id_proyecto = %s AND fecha_carga = %s",
                            (id_proyecto, fecha)
                        )
                        barras_eliminadas = cur.rowcount

                    total_barras_eliminadas += barras_eliminadas
                    cur.execute("DELETE FROM imports WHERE id = %s", (carga_id,))
                    cargas_eliminadas += 1

        _cache.invalidate("stats:", "landing:")
        return {
            "ok": True,
            "cargas_eliminadas": cargas_eliminadas,
            "barras_eliminadas": total_barras_eliminadas,
            "sin_permiso": sin_permiso,
            "no_encontradas": no_encontradas,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al eliminar cargas: {str(e)}")


class MoverCargasRequest(BaseModel):
    ids: list
    destino: str


@router.post("/cargas/mover")
def mover_cargas(body: MoverCargasRequest, user=Depends(get_current_user)):
    """Mover cargas (imports + barras) de un proyecto a otro."""
    if not body.ids:
        raise HTTPException(status_code=400, detail="No se proporcionaron IDs de cargas")
    if not body.destino:
        raise HTTPException(status_code=400, detail="No se proporcionó proyecto destino")
    if len(body.ids) > 100:
        raise HTTPException(status_code=400, detail="No se pueden mover más de 100 cargas a la vez")

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                # Validar proyecto destino
                cur.execute("SELECT id_proyecto, nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (body.destino,))
                dest = cur.fetchone()
                if not dest:
                    raise HTTPException(status_code=404, detail="Proyecto destino no encontrado")
                dest_id = dest[0]
                dest_nombre = dest[1]

                cargas_movidas = 0
                total_barras = 0
                skipped = 0

                for carga_id in body.ids:
                    cur.execute(
                        "SELECT id, id_proyecto, usuario FROM imports WHERE id = %s",
                        (carga_id,)
                    )
                    row = cur.fetchone()
                    if not row:
                        skipped += 1
                        continue

                    origen = row[1]
                    uploader = row[2]

                    # Permisos: poder editar proyecto origen O ser el uploader
                    if not _puede_editar_proyecto(cur, origen, user) and uploader != user.get("email"):
                        skipped += 1
                        continue

                    # Ya está en el destino
                    if origen == body.destino:
                        skipped += 1
                        continue

                    # Verificar conflictos en destino: barras con mismo id_unico ya presentes
                    cur.execute("""
                        SELECT COUNT(*) FROM barras b_origen
                        WHERE b_origen.import_id = %s
                          AND EXISTS (
                              SELECT 1 FROM barras b_dest
                              WHERE b_dest.id_proyecto = %s
                                AND b_dest.id_unico = b_origen.id_unico
                          )
                    """, (carga_id, body.destino))
                    conflictos_count = cur.fetchone()[0]
                    if conflictos_count > 0:
                        raise HTTPException(
                            status_code=409,
                            detail=f"La carga {carga_id} tiene {conflictos_count} barras con id_unico ya existentes en la obra destino. Elimina esas barras primero o usa reemplazo selectivo."
                        )

                    # Mover barras
                    cur.execute(
                        "UPDATE barras SET id_proyecto = %s WHERE import_id = %s",
                        (body.destino, carga_id)
                    )
                    total_barras += cur.rowcount

                    # Mover import
                    cur.execute(
                        "UPDATE imports SET id_proyecto = %s WHERE id = %s",
                        (body.destino, carga_id)
                    )
                    cargas_movidas += 1

        _cache.invalidate("stats:", "landing:")
        return {
            "ok": True,
            "cargas_movidas": cargas_movidas,
            "barras_movidas": total_barras,
            "skipped": skipped,
            "destino": body.destino,
            "destino_nombre": dest_nombre,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[mover_cargas] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Error al mover cargas: {str(e)}")


class CambiarSectorRequest(BaseModel):
    id_unicos: list
    nuevo_sector: str


@router.post("/barras/cambiar-sector")
def cambiar_sector_barras(body: CambiarSectorRequest, user=Depends(get_current_user)):
    """Cambiar sector de barras individuales (dentro del mismo proyecto). DESHABILITADO."""
    raise HTTPException(status_code=403, detail="Función deshabilitada — sistema cerrado")


def _calcular_peso(diam, largo):
    """Fórmula ArmaHub: diam mm, largo cm => kg."""
    if diam is None or largo is None:
        return None, None
    peso_unitario = 7850 * 3.1416 * (diam / 2000) ** 2 * (largo / 100)
    return peso_unitario, peso_unitario


class BarraUpdate(BaseModel):
    # 5M.3 — edición de campos simples (no rompen figura). Geometría llega en 5M.4.
    diam: Optional[float] = None
    largo_total: Optional[float] = None
    cant: Optional[float] = None
    cant_total: Optional[float] = None
    mult: Optional[float] = None


@router.patch("/barras/{barra_id}")
def editar_barra(barra_id: int, body: BarraUpdate, user=Depends(get_current_user)):
    """Editar campos simples de UNA barra desde la plataforma (5M.3). Permiso:
    cubicador dueño de la obra (proyecto_usuarios) o admin. Recalcula peso al cambiar
    diam/largo/cant. Marca edición manual (editado_por/fecha) y audita."""
    email = user.get("email", "?")
    campos = body.model_dump(exclude_unset=True)
    if not campos:
        return {"ok": True, "message": "Sin cambios"}
    now = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT id, id_proyecto, diam, largo_total, cant, cant_total, mult FROM barras WHERE id = %s",
                (barra_id,),
            )
            barra = cur.fetchone()
            if not barra:
                raise HTTPException(status_code=404, detail="Barra no encontrada")
            if not _puede_editar_proyecto(cur, barra["id_proyecto"], user):
                raise HTTPException(status_code=403, detail="No puedes editar barras de esta obra. Solo el cubicador asignado a la obra o un administrador pueden hacerlo.")

            # Valores efectivos (nuevo si vino, si no el actual) para recálculo de peso.
            diam = campos.get("diam", barra["diam"])
            largo = campos.get("largo_total", barra["largo_total"])
            cant_total = campos.get("cant_total", barra["cant_total"])

            sets, params, cambios = [], [], []
            for f in ("diam", "largo_total", "cant", "cant_total", "mult"):
                if f in campos:
                    sets.append(f"{f} = %s")
                    params.append(campos[f])
                    cambios.append(f"{f}: {barra[f]}→{campos[f]}")

            # Recalcular peso si cambió diam/largo/cant_total.
            if any(k in campos for k in ("diam", "largo_total", "cant_total")):
                peso_unitario, _ = _calcular_peso(diam, largo)
                peso_total = (peso_unitario * cant_total) if (peso_unitario is not None and cant_total is not None) else None
                sets.append("peso_unitario = %s"); params.append(peso_unitario)
                sets.append("peso_total = %s"); params.append(peso_total)

            # Marca de edición manual.
            sets.append("editado_por = %s"); params.append(email)
            sets.append("editado_fecha = %s"); params.append(now)

            params.append(barra_id)
            cur.execute(f"UPDATE barras SET {', '.join(sets)} WHERE id = %s", params)

    _cache.invalidate("stats:", "landing:")
    audit(email, "editar_barra", "; ".join(cambios), "barra", str(barra_id))
    return {"ok": True, "id": barra_id, "cambios": cambios, "editado_por": email, "editado_fecha": now}


@router.get("/barras/ediciones")
def ediciones_barras(proyecto: str, limit: int = 20, user=Depends(get_current_user)):
    """Ediciones manuales recientes de barras de UNA obra (5M.3), para el panel al
    final del Bar Manager. Une audit_log (accion editar_barra) con las barras de la
    obra por su id."""
    if limit < 1: limit = 1
    if limit > 100: limit = 100
    with get_conn() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            allowed = _get_allowed_project_ids(cur, user)
            pf_sql, pf_params = _project_filter_sql(allowed, "b")
            cur.execute(
                """
                SELECT a.usuario, a.detalle, a.fecha, a.entidad_id,
                       b.id_unico, b.sector, b.piso, b.eje
                FROM audit_log a
                JOIN barras b ON b.id::text = a.entidad_id
                WHERE a.accion = 'editar_barra' AND a.entidad = 'barra'
                  AND b.id_proyecto = %s""" + pf_sql + """
                ORDER BY a.fecha DESC
                LIMIT %s
                """,
                [proyecto] + pf_params + [limit],
            )
            rows = cur.fetchall()
    return {
        "ediciones": [
            {"usuario": r["usuario"], "detalle": r["detalle"], "fecha": r["fecha"],
             "id_unico": r["id_unico"], "sector": r["sector"], "piso": r["piso"], "eje": r["eje"]}
            for r in rows
        ]
    }


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
    """Crear una barra manual (origen='manual'). DESHABILITADO."""
    raise HTTPException(status_code=403, detail="Función deshabilitada — sistema cerrado")


@router.post("/barras/{id_unico}/duplicar")
def duplicar_barra(id_unico: str, user=Depends(get_current_user)):
    """Duplicar una barra existente como nueva barra manual. DESHABILITADO."""
    raise HTTPException(status_code=403, detail="Función deshabilitada — sistema cerrado")


@router.delete("/barras/{id_unico}")
def eliminar_barra(id_unico: str, user=Depends(get_current_user)):
    """Eliminar una barra individual. DESHABILITADO."""
    raise HTTPException(status_code=403, detail="Función deshabilitada — sistema cerrado")


import re as _re

def _piso_order(p: str) -> int:
    """Orden de pisos: subterráneos (S1,S2..) < P1,P2.. < SM/PM (techumbre) al final."""
    up = (p or '').upper().strip()
    if up in ('SM', 'PM', 'SALA DE MAQUINAS'):
        return 9999
    m = _re.match(r'^S(\d+)', up)
    if m:
        return -int(m.group(1))
    m = _re.match(r'^P(\d+)', up)
    if m:
        return int(m.group(1))
    m = _re.search(r'(\d+)', up)
    if m:
        return int(m.group(1))
    return 0

def _ciclo_order(c: str) -> int:
    """Orden de ciclos: numérico por dígito encontrado."""
    m = _re.search(r'(\d+)', c or '')
    return int(m.group(1)) if m else 0


@router.get("/proyectos/{id_proyecto}/sectores-nav")
def get_sectores_nav(id_proyecto: str, user=Depends(get_current_user)):
    """Navegador jerárquico: Piso → Ciclo → Sector con stats por nodo."""
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
                ORDER BY piso, ciclo, sector
            """, (id_proyecto,))
            rows = cur.fetchall()

    # Build tree: Piso → Ciclo → Sector
    tree = {}
    for r in rows:
        sector, piso, ciclo = r[0] or '', r[1] or '', r[2] or ''
        leaf = {"barras": int(r[3]), "kilos": round(float(r[4]), 2), "ejes": int(r[5]), "diam_prom": float(r[6])}

        if piso not in tree:
            tree[piso] = {"barras": 0, "kilos": 0.0, "ciclos": {}}
        tree[piso]["barras"] += leaf["barras"]
        tree[piso]["kilos"] += leaf["kilos"]

        if ciclo not in tree[piso]["ciclos"]:
            tree[piso]["ciclos"][ciclo] = {"barras": 0, "kilos": 0.0, "sectores": {}}
        tree[piso]["ciclos"][ciclo]["barras"] += leaf["barras"]
        tree[piso]["ciclos"][ciclo]["kilos"] += leaf["kilos"]

        tree[piso]["ciclos"][ciclo]["sectores"][sector] = leaf

    result = []
    for piso in sorted(tree.keys(), key=_piso_order):
        p = tree[piso]
        ciclos_list = []
        for ciclo in sorted(p["ciclos"].keys(), key=_ciclo_order):
            c = p["ciclos"][ciclo]
            sectores_list = [
                {"sector": s, **c["sectores"][s]}
                for s in sorted(c["sectores"].keys())
            ]
            ciclos_list.append({
                "ciclo": ciclo,
                "barras": c["barras"],
                "kilos": round(c["kilos"], 2),
                "sectores": sectores_list,
            })
        result.append({
            "piso": piso,
            "barras": p["barras"],
            "kilos": round(p["kilos"], 2),
            "ciclos": ciclos_list,
        })

    return {"id_proyecto": id_proyecto, "pisos": result}


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


@router.get("/proyectos/empresas")
def get_empresas_distintas(user=Depends(get_current_user)):
    """Lista de nombres de empresa ya usados (para autocompletado en la ficha de obra).
    Evita duplicados por tipeo ('DLP' vs 'D.L.P')."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT empresa FROM proyectos
                WHERE empresa IS NOT NULL AND TRIM(empresa) <> ''
                ORDER BY empresa
            """)
            empresas = [r[0] for r in cur.fetchall()]
    return {"empresas": empresas}


@router.get("/proyectos")
def get_proyectos(user=Depends(get_current_user)):
    """
    Devuelve lista de proyectos con resumen de kilos, barras, diam_prom, PPI, PPB.
    Incluye constructora, calculista y cubicador asignado. Filtered by user authorization.
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
                    p.usuario_creador,
                    p.fecha_inicio,
                    COALESCE(ROUND(CAST(SUM(b.diam * b.peso_total) / NULLIF(SUM(b.peso_total), 0) AS NUMERIC), 1), 0) as diam_prom,
                    p.clasificacion,
                    p.empresa,
                    COALESCE(rec.n_reclamos, 0) as n_reclamos
                FROM proyectos p
                LEFT JOIN barras b ON p.id_proyecto = b.id_proyecto
                LEFT JOIN constructoras co ON p.constructora_id = co.id
                LEFT JOIN calculistas ca ON p.calculista_id = ca.id
                LEFT JOIN (
                    SELECT id_proyecto, COUNT(*) AS n_reclamos
                    FROM reclamos GROUP BY id_proyecto
                ) rec ON rec.id_proyecto = p.id_proyecto
                WHERE 1=1""" + pf_p + """
                GROUP BY p.id_proyecto, p.nombre_proyecto,
                         p.constructora_id, co.nombre, p.calculista_id, ca.nombre,
                         p.descripcion, p.fecha_creacion, p.usuario_creador, p.fecha_inicio,
                         p.clasificacion, p.empresa, rec.n_reclamos
                ORDER BY COALESCE(p.fecha_inicio, p.fecha_creacion) ASC NULLS LAST, p.nombre_proyecto ASC
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
            
            # Responsable de cubicación de cada proyecto (primer miembro/cubicador en
            # proyecto_usuarios). Incluye 'miembro' además de 'cubicador' legacy.
            cubicador_map = {}
            try:
                cur.execute("""
                    SELECT pu.id_proyecto, u.nombre, u.apellido, u.email
                    FROM proyecto_usuarios pu
                    JOIN users u ON pu.user_id = u.id
                    WHERE pu.rol IN ('cubicador', 'miembro')
                """)
                for c_row in cur.fetchall():
                    if c_row[0] not in cubicador_map:
                        nombre = (c_row[1] or '') + (' ' + c_row[2] if c_row[2] else '')
                        cubicador_map[c_row[0]] = nombre.strip() or c_row[3]
            except Exception:
                pass

    proyectos = []
    for r in rows:
        total_barras = int(r[2]) if r[2] else 0
        total_kilos = float(r[3]) if r[3] else 0.0
        diam_prom = float(r[12]) if r[12] else 0.0
        # PPI = Peso Por Item (kg promedio por barra)
        ppi = round(total_kilos / total_barras, 2) if total_barras > 0 else 0.0
        # PPB = Peso Por Barra (same as PPI for now, can be refined)
        ppb = ppi
        
        proyectos.append({
            "id_proyecto": r[0],
            "nombre_proyecto": r[1],
            "total_barras": total_barras,
            "total_kilos": total_kilos,
            "constructora_id": r[4],
            "constructora_nombre": r[5],
            "calculista_id": r[6],
            "calculista_nombre": r[7],
            "descripcion": r[8],
            "fecha_creacion": r[9],
            "usuario_creador": r[10],
            "fecha_inicio": r[11],
            "diam_prom": diam_prom,
            "ppi": ppi,
            "ppb": ppb,
            "cubicador": cubicador_map.get(r[0], ""),
            "aliases": alias_map.get(r[0], []),
            "clasificacion": r[13] or "obra",
            "empresa": r[14],
            "n_reclamos": int(r[15]) if r[15] else 0,
        })
    
    return {"proyectos": proyectos}


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
    clasificacion: Optional[str] = None   # obra | tienda | otro (5L.11)
    empresa: Optional[str] = None         # nombre constructora/retail (texto libre)
    fecha_inicio: Optional[str] = None

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
    """Crear una obra vacía manualmente (sin CSV).
    Solo admin/admin_calidad: la creación de obras se centraliza en administración
    (decisión 2026-06-18). Evita el cruce con proyecto_usuarios cuyo CHECK legacy no
    acepta el rol 'miembro'. A futuro habrá un panel de administración de obras."""
    role = user.get("role", "")
    if role not in ("admin", "admin_calidad"):
        raise HTTPException(status_code=403, detail="Solo administración puede crear obras. Contacta a un administrador.")
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
                rol = _rol_proyecto_usuarios(user.get('role', ''))
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
            if body.clasificacion is not None and body.clasificacion in ("obra", "tienda", "otro"):
                sets.append("clasificacion = %s")
                params.append(body.clasificacion)
            if body.empresa is not None:
                sets.append("empresa = %s")
                params.append(body.empresa.strip() or None)
            if body.fecha_inicio is not None:
                sets.append("fecha_inicio = %s")
                params.append(body.fecha_inicio.strip() or None)

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

            # Obra CON barras: solo admin/admin_calidad puede eliminarla (protección
            # contra borrado indebido). Antes el check era `role == 'cubicador'`, que
            # con el rol migrado a 'miembro' quedó inactivo → cualquier miembro con
            # acceso podía borrar una obra llena. Decisión 2026-06-18.
            if barras_count > 0 and user.get("role") not in ("admin", "admin_calidad"):
                raise HTTPException(status_code=403, detail=f"No puedes eliminar una obra con {barras_count} barras cargadas. Solo un administrador puede hacerlo.")

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
    """Mover barras de un proyecto a otro. DESHABILITADO."""
    raise HTTPException(status_code=403, detail="Función deshabilitada — sistema cerrado")
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
            # Asegurar que el rol pase el CHECK legacy de proyecto_usuarios.
            rol_seguro = body.rol if body.rol in _PROYECTO_USUARIOS_ROLES else _rol_proyecto_usuarios(body.rol)
            cur.execute("""
                INSERT INTO proyecto_usuarios (id_proyecto, user_id, rol)
                VALUES (%s, %s, %s)
                ON CONFLICT (id_proyecto, user_id) DO UPDATE SET rol = EXCLUDED.rol
            """, (id_proyecto, body.user_id, rol_seguro))
    return {"ok": True, "id_proyecto": id_proyecto, "user_id": body.user_id, "rol": rol_seguro}


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


# ========================= COBERTURA POR CICLO =========================

@router.get("/proyectos/{id_proyecto}/cobertura-ciclos")
def get_cobertura_ciclos(id_proyecto: str, user=Depends(get_current_user)):
    """Matriz de cobertura derivada de barras: por cada ciclo, lista de ejes
    distintos agrupados por sector (FUND, ELEV, LCIELO, VCIELO).
    Cada celda incluye además el desglose por piso (byPiso) para permitir
    filtrado en cliente sin re-consulta.
    """
    SECTORES = ["LCIELO", "VCIELO", "ELEV", "FUND"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")
            allowed_ids = _get_allowed_project_ids(cur, user)
            if allowed_ids is not None and id_proyecto not in allowed_ids:
                raise HTTPException(status_code=403, detail="Sin acceso a este proyecto")
            cur.execute(
                """
                SELECT COALESCE(ciclo, '')  AS ciclo,
                       COALESCE(sector, '') AS sector,
                       COALESCE(piso, '')   AS piso,
                       array_agg(DISTINCT eje ORDER BY eje) AS ejes
                FROM barras
                WHERE id_proyecto = %s
                  AND eje IS NOT NULL AND eje <> ''
                GROUP BY COALESCE(ciclo, ''), COALESCE(sector, ''), COALESCE(piso, '')
                """,
                (id_proyecto,),
            )
            rows = cur.fetchall()

    pisos_set: set = set()
    ciclos_map: dict = {}
    for ciclo, sector, piso, ejes in rows:
        if sector not in SECTORES:
            continue
        if piso:
            pisos_set.add(piso)
        if ciclo not in ciclos_map:
            ciclos_map[ciclo] = {s: {"byPiso": {}, "_ejes_set": set()} for s in SECTORES}
        cell = ciclos_map[ciclo][sector]
        cell["byPiso"][piso or ""] = list(ejes or [])
        for e in (ejes or []):
            cell["_ejes_set"].add(e)

    ciclos = []
    for ciclo in sorted(ciclos_map.keys(), key=_ciclo_order):
        sectores_payload = {}
        for s in SECTORES:
            cell = ciclos_map[ciclo][s]
            ejes_union = sorted(cell["_ejes_set"])
            sectores_payload[s] = {
                "ejes": ejes_union,
                "count": len(ejes_union),
                "byPiso": cell["byPiso"],
            }
        ciclos.append({"ciclo": ciclo or "(sin ciclo)", "sectores": sectores_payload})

    pisos = sorted(pisos_set, key=_piso_order)
    return {"sectores": SECTORES, "pisos": pisos, "ciclos": ciclos}


# ========================= LANDING INDICADORES =========================

@router.get("/landing/indicadores")
def landing_indicadores(user=Depends(get_current_user)):
    """Flash indicators for the hub landing page, role-aware."""
    from datetime import timedelta
    email = user.get("email", "")
    role = user.get("role", "usc")

    cache_key = f"landing:{email}:{role}"
    cached = _cache.get(cache_key)
    if cached:
        return cached

    now = datetime.now(timezone.utc)
    # Monday of current week
    monday = (now - timedelta(days=now.weekday())).strftime("%Y-%m-%d")
    sunday = (now - timedelta(days=now.weekday()) + timedelta(days=6)).strftime("%Y-%m-%d")

    result = {}

    with get_conn() as conn:
        with conn.cursor() as cur:
            # --- Cubicado semana (visible a admin, admin_calidad, miembro) ---
            # Cuenta a QUIEN hizo cargas esta semana, sin filtrar por rol (antes
            # filtraba u.role='cubicador' → vacío tras migrar a 'miembro').
            if role in ("admin", "admin_calidad", "miembro"):
                cur.execute("""
                    SELECT i.usuario,
                           COALESCE(u.nombre, '') AS nombre,
                           COALESCE(u.apellido, '') AS apellido,
                           EXTRACT(ISODOW FROM i.fecha::timestamp)::INTEGER AS dow,
                           COALESCE(SUM(i.kilos), 0) AS kilos
                    FROM imports i
                    JOIN users u ON u.email = i.usuario
                    WHERE LEFT(i.fecha, 10) >= %s
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

            # --- Reclamos levantados semana (visible a admin, admin_calidad, usc, miembro, externo) ---
            if role in ("admin", "admin_calidad", "usc", "miembro", "externo"):
                # Filtro "propios" para miembro/externo/usc
                if role in ("miembro", "externo"):
                    prop_where = "AND (r.cubicador_asignado = %s OR r.respuesta_por = %s)"
                    prop_params = (monday, sunday, email, email)
                elif role == "usc":
                    prop_where = "AND (r.creado_por = %s OR r.asignado_a = %s)"
                    prop_params = (monday, sunday, email, email)
                else:
                    prop_where = ""
                    prop_params = (monday, sunday)
                cur.execute(f"""
                    SELECT r.creado_por,
                           COALESCE(u.nombre, '') AS nombre,
                           COALESCE(u.apellido, '') AS apellido,
                           EXTRACT(ISODOW FROM COALESCE(r.fecha_deteccion, r.fecha_creacion)::timestamp)::INTEGER AS dow,
                           COUNT(*) AS cnt
                    FROM reclamos r
                    LEFT JOIN users u ON u.email = r.creado_por
                    WHERE LEFT(COALESCE(r.fecha_deteccion, r.fecha_creacion), 10) >= %s
                      AND LEFT(COALESCE(r.fecha_deteccion, r.fecha_creacion), 10) <= %s
                    {prop_where}
                    GROUP BY r.creado_por, u.nombre, u.apellido, dow
                    ORDER BY r.creado_por, dow
                """, prop_params)
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

            # --- Alertas: reclamos por estado ---
            if role in ("admin", "admin_calidad"):
                cur.execute("""
                    SELECT estado, COUNT(*) FROM reclamos
                    GROUP BY estado ORDER BY 2 DESC
                """)
            elif role in ("miembro", "externo"):
                cur.execute("""
                    SELECT estado, COUNT(*) FROM reclamos
                    WHERE (cubicador_asignado = %s OR respuesta_por = %s)
                    GROUP BY estado ORDER BY 2 DESC
                """, (email, email))
            elif role == "usc":
                cur.execute("""
                    SELECT estado, COUNT(*) FROM reclamos
                    WHERE (creado_por = %s OR asignado_a = %s)
                    GROUP BY estado ORDER BY 2 DESC
                """, (email, email))
            elif role == "externo":
                cur.execute("""
                    SELECT estado, COUNT(*) FROM reclamos
                    WHERE (cubicador_asignado = %s OR respuesta_por = %s)
                    GROUP BY estado ORDER BY 2 DESC
                """, (email, email))
            else:
                cur.execute("SELECT estado, 0 FROM reclamos WHERE FALSE")

            alertas_rows = cur.fetchall()
            alertas = [{"estado": r[0], "count": int(r[1])} for r in alertas_rows]
            total_abiertos = sum(a["count"] for a in alertas)
            result["alertas"] = {"total_abiertos": total_abiertos, "por_estado": alertas}

    _cache.put(cache_key, result, ttl=60)
    return result