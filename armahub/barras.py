from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
import math
import logging
import traceback
from psycopg.rows import dict_row
from .db import get_conn, audit
from .peso import peso_unitario_kg
from .auth import get_current_user, ROL_MAP, _rol_proyecto_usuarios, _PROYECTO_USUARIOS_ROLES
from . import cache as _cache

router = APIRouter()
_log = logging.getLogger("armahub.barras")

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
    """Retorna True si el usuario es admin/admin_calidad o está en proyecto_usuarios.
    OJO: esto controla editar PROYECTOS, autorizar/revocar usuarios y mover barras
    entre obras — NO es el permiso de editar barras del Bar Manager (ver
    _puede_editar_barras). No mezclar."""
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


def _puede_editar_barras(cur, user: dict) -> bool:
    """Permiso para EDITAR barras en el Bar Manager (5M). Decisión (2026-07-24):
    un MIEMBRO del área 'cubicaciones' (area_usuarios.rol_area='miembro' en el área
    slug='cubicaciones') O un admin/admin_calidad (acceso total, para soporte). Ni
    USC, ni jefes de servicio, ni cubicador global, ni cliente/externo. No depende
    de la obra (cualquier obra)."""
    role = (user.get("role") or "").lower()
    if role in ("admin", "admin_calidad"):
        return True
    email = (user.get("email") or "").strip().lower()
    if not email:
        return False
    cur.execute(
        """
        SELECT 1
        FROM area_usuarios au
        JOIN areas a ON a.id = au.area_id
        JOIN users u ON u.id = au.user_id
        WHERE a.slug = 'cubicaciones'
          AND au.rol_area = 'miembro'
          AND LOWER(u.email) = %s
        LIMIT 1
        """,
        (email,),
    )
    return cur.fetchone() is not None

BARRAS_COLUMNS = [
    "id",  # PK numérico (5M.3) — necesario para editar una barra
    "id_unico","id_proyecto","nombre_proyecto","plano_code","nombre_plano","sector","piso","ciclo","eje",
    "diam","largo_total","mult","cant","cant_total",
    "peso_unitario","peso_total","version_mod","version_exp","fecha_carga",
    "origen","import_id",
    "template_instancia_id",  # trazabilidad enfierrador/TE (migración 104; sin esto el BM no la veía)
    # cod_proyecto (PROD) y suf_tipo eran CAMPOS CIEGOS: la BD los tenía, el export
    # los escribía, pero el Bar Manager no los recibía → la columna Suf salía
    # siempre vacía y el PROD desalineado era invisible (incidente "diámetros
    # diferentes"). Read-only en pantalla; el PROD se deriva del diámetro.
    "cod_proyecto","suf_tipo",
    "marca","figura",
    "dim_a","dim_b","dim_c","dim_d","dim_e","dim_f","dim_g","dim_h","dim_i",
    "ang1","ang2","ang3","ang4","radio",
    "editado_por","editado_fecha",  # marca de edición manual (5M.3)
    "revisada","revisada_por","revisada_fecha"  # check de revisión del cubicador (5N.19)
]

# Filtro que EXCLUYE las barras de despieces en BORRADOR (no terminados). Directriz de negocio: una
# barra de un despiece "no existe" hasta que el despiece se cierra con bandera (estado pasa a
# 'terminada'). Hasta entonces no aparece en Bar Manager ni suma en KPIs/export/totales — solo vive en
# el creador de despieces (única fuente de edición hasta la bandera). Usar IS DISTINCT FROM (NO !=)
# para NO descartar las barras CSV que tienen estado NULL. Se antepone con el alias correcto donde haga
# falta (ej. "b.estado"); por defecto sin alias.
def _sql_excluir_borrador(alias=""):
    col = (alias + ".estado") if alias else "estado"
    return f" AND {col} IS DISTINCT FROM 'borrador' "

ALLOWED_ORDER_BY = {
    "fecha_carga", "peso_total", "peso_unitario", "cant_total",
    "diam", "largo_total",
    "id_proyecto", "plano_code", "sector", "piso", "ciclo", "eje", "id_unico", "nombre_proyecto",
    "import_id",
    "constructivo",   # orden constructivo: piso (bajo→alto) → sector → ciclo → eje → diam. Ver ORDER_CONSTRUCTIVO_SQL.
}

# ORDER BY constructivo expresado en SQL (para respetar paginación LIMIT/OFFSET). Es el ESPEJO en SQL
# del helper _orden_constructivo_key/_piso_order (fuente única del criterio). Piso: FUND al fondo,
# subterráneos (S1,S2) negativos, P1..Pn positivos, SM/PM arriba del todo, desconocido al medio.
# Sector: FUND→ELEV→VCIELO→LCIELO. Mantener sincronizado con _piso_order/_sector_order si cambian.
# No admite dirección (siempre bajo→alto).
# _SQL_PISO_ORDER y _SQL_SECTOR_ORDER se componen para armar dos variantes: la de barra individual
# (con ciclo/eje/diam) y la agrupada por elemento (solo piso/sector/eje, sin columnas no agrupadas).
_SQL_PISO_ORDER = """
    CASE
        WHEN UPPER(TRIM(COALESCE(piso,''))) IN ('FUND','FUNDACION','FUNDACIÓN') THEN -1000000
        WHEN UPPER(TRIM(COALESCE(piso,''))) IN ('SM','PM','SALA DE MAQUINAS') THEN 9999
        WHEN UPPER(TRIM(COALESCE(piso,''))) ~ '^S[0-9]' THEN -1 * COALESCE(NULLIF((substring(UPPER(TRIM(piso)) FROM '^S([0-9]+)')), '')::int, 0)
        WHEN UPPER(TRIM(COALESCE(piso,''))) ~ '^P[0-9]' THEN COALESCE(NULLIF((substring(UPPER(TRIM(piso)) FROM '^P([0-9]+)')), '')::int, 0)
        WHEN COALESCE(piso,'') ~ '[0-9]' THEN COALESCE(NULLIF(regexp_replace(COALESCE(piso,''), '\\D', '', 'g'), '')::int, 0)
        ELSE 0
    END ASC
"""
_SQL_SECTOR_ORDER = """
    CASE UPPER(TRIM(COALESCE(sector,'')))
        WHEN 'FUND' THEN 0 WHEN 'ELEV' THEN 1 WHEN 'VCIELO' THEN 2 WHEN 'LCIELO' THEN 3 ELSE 99
    END ASC
"""
# CASE SQL de orden por tipología (marca), generado desde la fuente única (orden.py) para no
# desincronizarse con la convención MH,MV,TR,…
from .orden import sql_tipologia_order as _sql_tipologia_order
_SQL_TIPOLOGIA_ORDER = _sql_tipologia_order("marca")

# Variante COMPLETA (barra individual): piso → sector → ciclo → eje → tipología → diam → id (desempate
# estable para que la paginación LIMIT/OFFSET sea determinista entre páginas).
ORDER_CONSTRUCTIVO_SQL = _SQL_PISO_ORDER + "," + _SQL_SECTOR_ORDER + """,
    COALESCE(NULLIF(regexp_replace(COALESCE(ciclo,''), '\\D', '', 'g'), ''), '0')::int ASC,
    TRIM(COALESCE(eje,'')) ASC,
    """ + _SQL_TIPOLOGIA_ORDER + """ ASC,
    COALESCE(diam, 0) ASC,
    id ASC
"""
# Variante AGRUPADA por elemento. IMPORTANTE: /barras/elementos agrupa por COALESCE(piso,''),
# COALESCE(sector,''), COALESCE(eje,''), y Postgres exige que el ORDER BY de un GROUP BY use EXACTAMENTE
# esas expresiones agrupadas (no `piso` crudo → "column must appear in GROUP BY"). Por eso esta variante
# referencia siempre COALESCE(...) — no reutiliza _SQL_PISO_ORDER (que usa `piso` crudo en el substring,
# válido solo en consultas SIN GROUP BY como el listado plano). Mismo criterio de orden, otra escritura.
ORDER_CONSTRUCTIVO_ELEMENTO_SQL = """
    CASE
        WHEN UPPER(TRIM(COALESCE(piso,''))) IN ('FUND','FUNDACION','FUNDACIÓN') THEN -1000000
        WHEN UPPER(TRIM(COALESCE(piso,''))) IN ('SM','PM','SALA DE MAQUINAS') THEN 9999
        WHEN UPPER(TRIM(COALESCE(piso,''))) ~ '^S[0-9]' THEN -1 * COALESCE(NULLIF(substring(UPPER(TRIM(COALESCE(piso,''))) FROM '^S([0-9]+)'), '')::int, 0)
        WHEN UPPER(TRIM(COALESCE(piso,''))) ~ '^P[0-9]' THEN COALESCE(NULLIF(substring(UPPER(TRIM(COALESCE(piso,''))) FROM '^P([0-9]+)'), '')::int, 0)
        WHEN COALESCE(piso,'') ~ '[0-9]' THEN COALESCE(NULLIF(regexp_replace(COALESCE(piso,''), '\\D', '', 'g'), '')::int, 0)
        ELSE 0
    END ASC,
    CASE UPPER(TRIM(COALESCE(sector,'')))
        WHEN 'FUND' THEN 0 WHEN 'ELEV' THEN 1 WHEN 'VCIELO' THEN 2 WHEN 'LCIELO' THEN 3 ELSE 99
    END ASC,
    TRIM(COALESCE(eje,'')) ASC
"""

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
    diam: int = None,                   # 5M.9: filtro por diámetro
    plano_txt: str = None,              # filtro de texto por nombre_plano (coincidencia parcial)
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

    base_where = " WHERE 1=1 " + _sql_excluir_borrador()   # ocultar barras de despieces en borrador
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
        # TRIM en ambos lados: igual que /barras/elementos (FIX 5M.12). El eje se guarda
        # crudo del CSV y puede traer espacios; ambos endpoints deben filtrar idéntico.
        base_where += " AND TRIM(eje) = TRIM(%s)"
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
    # 5M.9: filtro por diámetro
    if diam:
        base_where += " AND diam = %s"
        params.append(diam)
    if plano_txt and plano_txt.strip():
        base_where += " AND nombre_plano ILIKE %s"
        params.append(f"%{plano_txt.strip()}%")

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
            # El orden "constructivo" usa la expresión canónica (piso bajo→alto → sector → ciclo →
            # eje → diam), que ignora order_dir. El resto de columnas siguen el ORDER BY simple.
            order_sql = ORDER_CONSTRUCTIVO_SQL if order_by == "constructivo" else f"{order_by} {order_dir} NULLS LAST"
            data_sql = f"""
                SELECT {select_cols}
                FROM barras
                {full_where}
                ORDER BY {order_sql}
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
    eje: str = None,                    # FIX 5M.12: faltaba → el filtro de Eje no aplicaba
    q: str = None,
    origen: str = None,
    import_id: int = None,
    figura: str = None,                 # 5M.2
    marca: str = None,                  # 5M.2
    diam: int = None,                   # 5M.9
    plano_txt: str = None,              # filtro de texto por nombre_plano (coincidencia parcial)
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

    base_where = " WHERE 1=1 " + _sql_excluir_borrador()   # ocultar barras de despieces en borrador
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
    if eje:
        # FIX 5M.12: aplicar el filtro de Eje (antes se descartaba en silencio). TRIM en
        # ambos lados por el bug latente: 'eje' se guarda crudo del CSV y puede traer
        # espacios (24(A-E) vs 24 (A-E)); /filters devuelve el valor exacto, así que el
        # match funciona igual, pero el TRIM lo blinda ante espacios sobrantes.
        base_where += " AND TRIM(eje) = TRIM(%s)"; params.append(eje)
    if origen:
        base_where += " AND origen = %s"; params.append(origen)
    if import_id is not None:
        base_where += " AND import_id = %s"; params.append(import_id)
    if figura:
        base_where += " AND figura = %s"; params.append(figura)
    if marca:
        base_where += " AND marca = %s"; params.append(marca)
    if diam:
        base_where += " AND diam = %s"; params.append(diam)
    if plano_txt and plano_txt.strip():
        base_where += " AND nombre_plano ILIKE %s"; params.append(f"%{plano_txt.strip()}%")
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

            # Orden CONSTRUCTIVO unificado (mismo criterio que el listado /barras y la exportación):
            # Piso bajo→alto (FUND, S2, S1, P1…, SM) → Sector (FUND→ELEV→VCIELO→LCIELO) → Eje. Usa la
            # expresión canónica ORDER_CONSTRUCTIVO_SQL (incluye también ciclo/diam, inertes en el
            # agregado por elemento). Antes usaba un regex propio que ignoraba S/FUND/SM y tenía el
            # orden de sectores invertido → pisos y sectores salían mal.
            order_clause = "ORDER BY " + ORDER_CONSTRUCTIVO_ELEMENTO_SQL
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
                + _sql_excluir_borrador() + pf_sql + " ORDER BY figura",
                [proyecto] + pf_params,
            )
            figuras = [r[0] for r in cur.fetchall()]
            cur.execute(
                "SELECT DISTINCT marca FROM barras WHERE id_proyecto = %s AND marca IS NOT NULL AND marca <> ''"
                + _sql_excluir_borrador() + pf_sql + " ORDER BY marca",
                [proyecto] + pf_params,
            )
            tipologias = [r[0] for r in cur.fetchall()]
            # Diámetros presentes en la obra (5M.9): para poblar el filtro φ solo
            # con los diámetros que realmente existen, no una lista comercial fija.
            cur.execute(
                "SELECT DISTINCT diam FROM barras WHERE id_proyecto = %s AND diam IS NOT NULL AND diam > 0"
                + _sql_excluir_borrador() + pf_sql + " ORDER BY diam",
                [proyecto] + pf_params,
            )
            diametros = [int(r[0]) for r in cur.fetchall()]
    return {"figuras": figuras, "tipologias": tipologias, "diametros": diametros}


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
    base_where = " WHERE 1=1 " + _sql_excluir_borrador()   # ocultar barras de despieces en borrador
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

            # Proyectos: TODAS las obras autorizadas (tabla proyectos), tengan o no barras.
            # Antes salía de `barras` (DISTINCT id_proyecto) y omitía las obras vacías, lo que
            # impedía elegir una obra recién creada en el CREADOR de barras. La fuente correcta
            # es la tabla de obras; el Bar Manager, si eliges una obra sin barras, simplemente
            # no lista barras (comportamiento esperado, no un error).
            cur.execute("""
                SELECT id_proyecto, COALESCE(nombre_proyecto, id_proyecto)
                FROM proyectos
                WHERE 1=1""" + pf_sql + """
                ORDER BY COALESCE(nombre_proyecto, id_proyecto)
            """, list(pf_params))
            proyectos = [{"id": r[0], "nombre": r[1]} for r in cur.fetchall() if r[0] is not None]

            # Planos: filtrado solo por proyecto (+ auth)
            w_parts, w_vals = ["1=1"], list(pf_params)
            if pf_sql:
                w_parts[0] = "1=1" + pf_sql
            # Ocultar barras de despieces en borrador (no confirmados) en TODAS las
            # facetas de barras (planos/sectores/pisos/ciclos/ejes) de aquí en adelante.
            # NO afecta la consulta de `proyectos` (arriba, tabla proyectos).
            w_parts.append("estado IS DISTINCT FROM 'borrador'")
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
            w = " WHERE 1=1" + pf_sql + _sql_excluir_borrador()   # ocultar barras de despieces en borrador
            wp = list(pf_params)

            # Date range filter on fecha_carga
            if fecha_desde:
                w += " AND fecha_carga >= %s"
                wp.append(fecha_desde)
            if fecha_hasta:
                w += " AND fecha_carga <= %s"
                wp.append(fecha_hasta + "T23:59:59Z")

            # total_barras = nº de ENTRADAS/filas (items en el vocabulario estándar: COUNT).
            # total_barras_fisicas = BARRAS FÍSICAS = Σ cant_total (cant×mult). Ambos se exponen.
            cur.execute("SELECT COUNT(*), COALESCE(SUM(cant_total), 0) FROM barras" + w, wp)
            _row_tb = cur.fetchone()
            total_barras = int(_row_tb[0])
            total_barras_fisicas = float(_row_tb[1] or 0)

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
                """ + pf_sql + _sql_excluir_borrador(), pf_params)
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
                WHERE 1=1""" + pf_b + _sql_excluir_borrador("b") + """
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
        "total_barras": total_barras,                       # nº de entradas/filas (items)
        "total_barras_fisicas": round(total_barras_fisicas), # barras físicas = Σ cant_total
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
            pf_sql, pf_params = _project_filter_sql(allowed, "b")

            w = " WHERE 1=1" + pf_sql + _sql_excluir_borrador("b")   # ocultar barras de despieces en borrador
            wp = list(pf_params)

            if fecha_desde:
                w += " AND b.fecha_carga >= %s"
                wp.append(fecha_desde)
            if fecha_hasta:
                w += " AND b.fecha_carga <= %s"
                wp.append(fecha_hasta + "T23:59:59Z")

            # Group by truncated date (sobre fecha_carga de barras). Incluye CSV + manual.
            if agrupacion == "semana":
                trunc = "LEFT(b.fecha_carga, 4) || '-W' || LPAD(CAST(EXTRACT(WEEK FROM CAST(LEFT(b.fecha_carga, 10) AS DATE)) AS TEXT), 2, '0')"
            elif agrupacion == "mes":
                trunc = "LEFT(b.fecha_carga, 7)"
            else:
                trunc = "LEFT(b.fecha_carga, 10)"

            cur.execute(f"""
                SELECT {trunc} AS periodo,
                       COALESCE(SUM(b.cant_total), 0) AS barras,
                       COALESCE(SUM(b.peso_total), 0) AS kilos,
                       COUNT(*) AS cargas
                FROM barras b
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


@router.get("/stats/cubicado")
def get_cubicado(periodo: str = "S", anio: Optional[int] = None, anios: Optional[str] = None,
                 proyecto: Optional[str] = None, origen: str = "manual",
                 user=Depends(get_current_user)):
    """Kilos LISTOS (excluye borrador) por cubicador, agregados según `periodo` — para el gráfico del
    editor. Períodos: S=semana actual por día; MS=mes actual por semana; MD=mes actual por día; A=año
    por mes (Ene-Dic). `anios` = CSV de años a totalizar (ej. '2026,2025'). Con 1 año, todos los
    períodos valen; con VARIOS años se FUERZA A (por mes) y se suman los años (los otros períodos no
    cuadran por fecha). `anio` (singular) sigue soportado por compat. `proyecto` filtra la obra.
    Respuesta: {labels, cubicadores:[{nombre,valores}], anios(con data), forzadoA(bool)}."""
    import calendar as _cal
    from datetime import date
    now = datetime.now(timezone.utc)
    # Años seleccionados: de `anios` (CSV) o `anio` (single) o el actual.
    yrs = []
    if anios:
        for tok in str(anios).split(","):
            tok = tok.strip()
            if tok.isdigit():
                yrs.append(int(tok))
    elif anio:
        yrs = [int(anio)]
    if not yrs:
        yrs = [now.year]
    yrs = sorted(set(yrs))
    multi = len(yrs) > 1
    per = (periodo or "S").upper()
    if multi:
        per = "A"   # varios años → solo tiene sentido "por mes" (suma de los años)

    # Rango(s) de fechas y bucket según el período. En multi-año, el rango es la unión de años.
    rangos = []  # lista de (ini, fin)
    if per == "S":  # semana actual por día (ignora año)
        from datetime import timedelta
        d0 = (now - timedelta(days=now.weekday()))
        rangos = [(d0.strftime("%Y-%m-%d"), (d0 + timedelta(days=6)).strftime("%Y-%m-%d"))]
        n = 7
        labels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
        bucket = "EXTRACT(ISODOW FROM b.fecha_carga::timestamp)::INTEGER - 1"
    elif per == "A":  # año por mes — un rango por cada año marcado (se suman)
        for y in yrs:
            rangos.append((date(y, 1, 1).strftime("%Y-%m-%d"), date(y, 12, 31).strftime("%Y-%m-%d")))
        n = 12
        labels = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
        bucket = "EXTRACT(MONTH FROM b.fecha_carga::timestamp)::INTEGER - 1"
    else:  # mes actual del (único) año seleccionado: MS por semana, MD por día
        yr = yrs[0]
        mes = now.month if yr == now.year else 12
        ult = _cal.monthrange(yr, mes)[1]
        rangos = [(date(yr, mes, 1).strftime("%Y-%m-%d"), date(yr, mes, ult).strftime("%Y-%m-%d"))]
        if per == "MD":
            n = ult
            labels = [str(i + 1) for i in range(ult)]
            bucket = "EXTRACT(DAY FROM b.fecha_carga::timestamp)::INTEGER - 1"
        else:
            n = min(5, (ult - 1) // 7 + 1)
            labels = []
            for s in range(n):
                a = s * 7 + 1
                b_ = ult if s == 4 else min(s * 7 + 7, ult)
                labels.append("{}-{}".format(a, b_))
            bucket = "LEAST(4, (EXTRACT(DAY FROM b.fecha_carga::timestamp)::INTEGER - 1) / 7)"

    # WHERE de fechas: unión de rangos (OR). En multi-año son varios; normalmente uno.
    fecha_sql = " AND (" + " OR ".join(["(LEFT(b.fecha_carga,10) >= %s AND LEFT(b.fecha_carga,10) <= %s)"] * len(rangos)) + ")"
    params = []
    for (i0, i1) in rangos:
        params.extend([i0, i1])
    obra_sql = ""
    if proyecto:
        obra_sql = " AND b.id_proyecto = %s"
        params.append(proyecto)
    # M1.9: origen='manual' (default, editor) cuenta solo lo creado a mano;
    # origen='todos' (Hub/Bar Manager) suma también lo cargado por CSV.
    origen_sql = "" if origen == "todos" else " AND b.origen = 'manual'"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT b.creado_por, COALESCE(u.nombre,''), COALESCE(u.apellido,''),
                       (""" + bucket + """) AS bkt, COALESCE(SUM(b.peso_total),0)
                FROM barras b JOIN users u ON u.email = b.creado_por
                WHERE b.creado_por IS NOT NULL"""
                + origen_sql + fecha_sql + obra_sql + _sql_excluir_borrador("b") + """
                GROUP BY b.creado_por, u.nombre, u.apellido, bkt
            """, params)
            cub = {}
            for r in cur.fetchall():
                em, bkt = r[0], int(r[3])
                if bkt < 0 or bkt >= n:
                    continue
                if em not in cub:
                    nom = ((r[1] or "") + " " + (r[2] or "")).strip()
                    cub[em] = {"email": em, "nombre": nom or em.split("@")[0], "valores": [0] * n}
                cub[em]["valores"][bkt] += round(float(r[4]), 1)
            # Años que tienen data (para el selector). Excluye borrador.
            cur.execute("""
                SELECT DISTINCT LEFT(fecha_carga,4)
                FROM barras WHERE fecha_carga IS NOT NULL AND fecha_carga <> ''"""
                + _sql_excluir_borrador() + """
                ORDER BY 1 DESC
            """)
            anios_data = [int(r[0]) for r in cur.fetchall() if r[0] and r[0].isdigit()]
    return {"periodo": per, "anios_sel": yrs, "forzado_a": multi, "proyecto": proyecto or None,
            "labels": labels, "cubicadores": list(cub.values()), "anios": anios_data}


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

            # Productividad por persona desde la tabla `barras` (por creado_por): incluye CSV Y
            # cubicación manual (antes solo leía imports = solo CSV). barras=Σcant_total (físicas),
            # items=COUNT (entradas), kilos=Σpeso_total. Filtro por proyecto (alias b) y fecha_carga.
            pf_b, pf_bp = _project_filter_sql(allowed, "b")
            w = " WHERE b.creado_por IS NOT NULL" + pf_b + _sql_excluir_borrador("b")   # ocultar borrador
            wp = list(pf_bp)
            if fecha_desde:
                w += " AND b.fecha_carga >= %s"
                wp.append(fecha_desde)
            if fecha_hasta:
                w += " AND b.fecha_carga <= %s"
                wp.append(fecha_hasta + "T23:59:59Z")
            cur.execute(f"""
                SELECT b.creado_por AS usuario,
                       COALESCE(SUM(b.cant_total), 0) AS barras,
                       COUNT(*) AS items,
                       COALESCE(SUM(b.peso_total), 0) AS kilos,
                       COUNT(DISTINCT b.id_proyecto) AS proyectos,
                       MAX(b.fecha_carga) AS ultima_actividad
                FROM barras b
                {w}
                GROUP BY b.creado_por
                ORDER BY kilos DESC
            """, wp)
            rows = cur.fetchall()

            # nº de CARGAS (archivos CSV importados) por usuario — sigue viniendo de imports (es
            # "cuántos archivos subió"); la cubicación manual no genera cargas.
            pf_i, pf_ip = _project_filter_sql(allowed, "i")
            wi = " WHERE 1=1" + pf_i
            wip = list(pf_ip)
            if fecha_desde:
                wi += " AND i.fecha >= %s"; wip.append(fecha_desde)
            if fecha_hasta:
                wi += " AND i.fecha <= %s"; wip.append(fecha_hasta + "T23:59:59Z")
            cur.execute(f"SELECT i.usuario, COUNT(*) FROM imports i {wi} GROUP BY i.usuario", wip)
            cargas_map = {r[0]: int(r[1]) for r in cur.fetchall()}

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
                "barras": round(float(r[1] or 0)),   # barras físicas (Σ cant_total)
                "items": int(r[2] or 0),             # entradas/filas (COUNT)
                "kilos": round(float(r[3] or 0), 2),
                "kilos_exportados": exp_user_map.get(r[0], 0),
                "cargas": cargas_map.get(r[0], 0),   # nº de CSV importados (0 si solo cubicó manual)
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
            # Cubicación mensual por persona desde `barras` (creado_por): incluye CSV + manual.
            pf_sql, pf_params = _project_filter_sql(allowed, "b")
            cur.execute("""
                SELECT EXTRACT(MONTH FROM CAST(LEFT(b.fecha_carga, 10) AS DATE))::int AS mes,
                       b.creado_por AS usuario,
                       COALESCE(SUM(b.peso_total), 0) AS kilos
                FROM barras b
                WHERE b.creado_por IS NOT NULL AND LEFT(b.fecha_carga, 4) = %s""" + pf_sql + _sql_excluir_borrador("b") + """
                GROUP BY mes, b.creado_por
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
            # Actividad del usuario desde `barras` (creado_por): incluye CSV + manual. "barras" =
            # Σ cant_total (físicas), "cargas" pasa a ser COUNT (items/entradas). fecha_carga.
            # Today's stats
            cur.execute("""
                SELECT COALESCE(SUM(cant_total), 0), COALESCE(SUM(peso_total), 0), COUNT(*)
                FROM barras
                WHERE creado_por = %s AND LEFT(fecha_carga, 10) = %s
            """ + _sql_excluir_borrador(), (email, today))
            hoy = cur.fetchone()

            # Daily breakdown last 14 days
            cur.execute("""
                SELECT LEFT(fecha_carga, 10) AS dia,
                       COALESCE(SUM(cant_total), 0) AS barras,
                       COALESCE(SUM(peso_total), 0) AS kilos,
                       COUNT(*) AS cargas
                FROM barras
                WHERE creado_por = %s AND LEFT(fecha_carga, 10) >= %s
            """ + _sql_excluir_borrador() + """
                GROUP BY dia
                ORDER BY dia
            """, (email, day14_ago))
            daily_rows = cur.fetchall()

            # This week totals
            cur.execute("""
                SELECT COALESCE(SUM(cant_total), 0), COALESCE(SUM(peso_total), 0), COUNT(*)
                FROM barras
                WHERE creado_por = %s AND LEFT(fecha_carga, 10) >= %s
            """ + _sql_excluir_borrador(), (email, this_monday))
            sem_actual = cur.fetchone()

            # Last week totals
            cur.execute("""
                SELECT COALESCE(SUM(cant_total), 0), COALESCE(SUM(peso_total), 0), COUNT(*)
                FROM barras
                WHERE creado_por = %s AND LEFT(fecha_carga, 10) >= %s AND LEFT(fecha_carga, 10) <= %s
            """ + _sql_excluir_borrador(), (email, last_monday, last_sunday))
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
    except Exception:
        _log.error("eliminar_cargas FALLO:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail="Error al eliminar cargas. Quedó registrado — reintenta en un momento.")


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
    except Exception:
        _log.error("mover_cargas FALLO:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail="Error al mover cargas. Quedó registrado — reintenta en un momento.")


class CambiarSectorRequest(BaseModel):
    id_unicos: list
    nuevo_sector: str


@router.post("/barras/cambiar-sector")
def cambiar_sector_barras(body: CambiarSectorRequest, user=Depends(get_current_user)):
    """Cambiar sector de barras individuales (dentro del mismo proyecto). DESHABILITADO."""
    raise HTTPException(status_code=403, detail="Función deshabilitada — sistema cerrado")


def _calcular_peso(diam, largo):
    """M1.3: delega en peso.py (fórmula única). Mantiene la firma tupla histórica."""
    p = peso_unitario_kg(diam, largo)
    return (p, p) if p is not None else (None, None)


class BarraUpdate(BaseModel):
    # 5M.3 — campos simples.
    diam: Optional[float] = None
    largo_total: Optional[float] = None
    cant: Optional[float] = None
    cant_total: Optional[float] = None
    mult: Optional[float] = None
    # 5M.4 — geometría (validada contra el catálogo).
    figura: Optional[str] = None
    dim_a: Optional[float] = None
    dim_b: Optional[float] = None
    dim_c: Optional[float] = None
    dim_d: Optional[float] = None
    dim_e: Optional[float] = None
    dim_f: Optional[float] = None
    dim_g: Optional[float] = None
    dim_h: Optional[float] = None
    dim_i: Optional[float] = None
    ang1: Optional[float] = None
    ang2: Optional[float] = None
    ang3: Optional[float] = None
    ang4: Optional[float] = None
    radio: Optional[float] = None
    nombre_plano: Optional[str] = None   # nombre legible del plano (editable en Bar Manager)
    suf_tipo: Optional[str] = None       # sufijo complementario de la tipología (A/B/inf/sup/comentario corto)


_GEOM_FIELDS = ["figura", "dim_a", "dim_b", "dim_c", "dim_d", "dim_e", "dim_f",
                "dim_g", "dim_h", "dim_i", "ang1", "ang2", "ang3", "ang4", "radio"]


@router.patch("/barras/{barra_id}")
def editar_barra(barra_id: int, body: BarraUpdate, user=Depends(get_current_user)):
    """Editar una barra desde la plataforma. Permiso: cubicador dueño de la obra o
    admin. Campos simples (5M.3: diam/largo/cant/mult, recalcula peso) y geometría
    (5M.4: figura/dims/ángulos/radio, validada contra el catálogo). Si la geometría
    queda incoherente con la figura, RECHAZA (409) — no se guarda data mala. Marca
    edición manual y audita."""
    try:
        return _editar_barra_impl(barra_id, body, user)
    except HTTPException:
        raise   # 403/404/409 son respuestas legítimas, no errores internos
    except Exception as e:
        # M0.8: el traceback completo queda en el log; al cliente solo mensaje
        # genérico — no exponer tipos/estructura interna.
        _log.error("editar_barra id=%s FALLO: %s\n%s", barra_id, e, traceback.format_exc())
        raise HTTPException(status_code=500, detail="Error al guardar la barra. Quedó registrado — reintenta en un momento.")


def _editar_barra_impl(barra_id: int, body: BarraUpdate, user):
    from .catalogo import validar_geometria, largo_desde_lados
    email = user.get("email", "?")
    campos = body.model_dump(exclude_unset=True)
    if not campos:
        return {"ok": True, "message": "Sin cambios"}
    now = datetime.now(timezone.utc).isoformat()

    _GEOM_COLS = ["figura", "dim_a", "dim_b", "dim_c", "dim_d", "dim_e", "dim_f",
                  "dim_g", "dim_h", "dim_i", "ang1", "ang2", "ang3", "ang4", "radio"]

    with get_conn() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT id, id_proyecto, sector, piso, ciclo, diam, largo_total, cant, cant_total, mult, "
                "figura, dim_a, dim_b, dim_c, dim_d, dim_e, dim_f, dim_g, dim_h, dim_i, "
                "ang1, ang2, ang3, ang4, radio FROM barras WHERE id = %s",
                (barra_id,),
            )
            barra = cur.fetchone()
            if not barra:
                raise HTTPException(status_code=404, detail="Barra no encontrada")
            if not _puede_editar_barras(cur, user):
                raise HTTPException(status_code=403, detail="No tienes permiso para editar barras. Solo un miembro del área de Cubicaciones puede editar en el Bar Manager.")

            # Valores efectivos (nuevo si vino, si no el actual). NOTA: largo_total NO
            # es editable directamente — se calcula de la suma de los lados (5M.4).
            campos.pop("largo_total", None)
            diam = campos.get("diam", barra["diam"])
            largo = barra["largo_total"]
            cant_total = campos.get("cant_total", barra["cant_total"])

            sets, params, cambios = [], [], []
            for f in ("diam", "cant", "cant_total", "mult"):
                if f in campos:
                    sets.append(f"{f} = %s"); params.append(campos[f])
                    cambios.append(f"{f}: {barra[f]}→{campos[f]}")

            # FUENTE ÚNICA DE VERDAD DEL DIÁMETRO (incidente "el export salió con
            # diámetros diferentes"): cod_proyecto (PROD) ES el diámetro codificado
            # (diametros.py) y el export lo escribe como columna independiente de
            # Ømm. Este PATCH actualizaba diam y dejaba el PROD viejo → la planilla
            # salía con Ømm=nuevo y PROD=código del diámetro anterior, y aSa Studio
            # produce por el PROD. Igual que al crear/duplicar/importar: se DERIVA.
            if "diam" in campos:
                from .diametros import cod_prod_de_diam
                nuevo_cod = cod_prod_de_diam(campos["diam"])
                sets.append("cod_proyecto = %s"); params.append(nuevo_cod)
                cambios.append(f"cod_proyecto: →{nuevo_cod or '(sin código)'}")

            # COHERENCIA cant/mult → cant_total (el sync inverso ya existía abajo):
            # editar cant o mult por API sin mandar cant_total dejaba cant×mult ≠
            # cant_total y el peso_total viejo.
            if "cant_total" not in campos and ("cant" in campos or "mult" in campos):
                nuevo_ct = float(campos.get("cant", barra["cant"]) or 0) * float(campos.get("mult", barra["mult"]) or 1)
                if nuevo_ct != barra["cant_total"]:
                    sets.append("cant_total = %s"); params.append(nuevo_ct)
                    cambios.append(f"cant_total: {barra['cant_total']}→{nuevo_ct}")
                    cant_total = nuevo_ct

            # nombre_plano: texto libre editable (nombre del plano). Vacío → NULL.
            if "nombre_plano" in campos:
                np_val = (campos["nombre_plano"] or "").strip()[:120] or None
                sets.append("nombre_plano = %s"); params.append(np_val)
                cambios.append(f"plano: →{np_val or '(vacío)'}")

            # suf_tipo: sufijo complementario de tipología (se concatena a MARCA solo en el export;
            # NO altera el sistema fijo de tipologías). Texto corto; vacío → NULL.
            if "suf_tipo" in campos:
                st_val = (campos["suf_tipo"] or "").strip()[:30] or None
                sets.append("suf_tipo = %s"); params.append(st_val)
                cambios.append(f"suf_tipo: →{st_val or '(vacío)'}")

            # COHERENCIA cant/mult/cant_total: en el Bar Manager el usuario edita la CANTIDAD (que
            # es cant_total) y no ve cant ni mult. Al cambiar cant_total sin tocar cant/mult, estos
            # quedaban desincronizados (cant×mult ≠ cant_total). Se sincronizan: cant = cant_total,
            # mult = 1. Ambos cambios quedan en la TRAZA (mismo formato campo: viejo→nuevo).
            if "cant_total" in campos:
                nuevo_total = campos["cant_total"]
                if "cant" not in campos and barra["cant"] != nuevo_total:
                    sets.append("cant = %s"); params.append(nuevo_total)
                    cambios.append(f"cant: {barra['cant']}→{nuevo_total}")
                if "mult" not in campos and barra["mult"] != 1:
                    sets.append("mult = %s"); params.append(1)
                    cambios.append(f"mult: {barra['mult']}→1")

            # 5M.4: si se tocó geometría, validar coherencia contra el catálogo.
            toca_geom = any(k in campos for k in _GEOM_COLS)
            if toca_geom:
                # Valores geométricos efectivos (nuevos o actuales) para validar.
                efectivos = {c: campos.get(c, barra[c]) for c in _GEOM_COLS}
                figura_efectiva = efectivos["figura"]
                # Solo se valida contra el catálogo si hay figura efectiva (si la barra
                # no tiene figura, no hay contra qué validar y no se bloquea).
                if figura_efectiva:
                    val = validar_geometria(cur, figura_efectiva, efectivos)
                    if not val["ok"]:
                        # No se guarda geometría incoherente (decisión 5M.4): la data
                        # siempre debe quedar buena. El front resalta sobran/faltan.
                        raise HTTPException(status_code=409, detail={
                            "geometria_invalida": True,
                            "mensaje": " ".join(val["errores"]),
                            "slots_sobran": val["slots_sobran"],
                            "slots_faltan": val["slots_faltan"],
                        })
                    # Recalcular el largo = suma de los lados usados (5M.4).
                    nuevo_largo = largo_desde_lados(cur, figura_efectiva, efectivos)
                    if nuevo_largo is not None and nuevo_largo != largo:
                        sets.append("largo_total = %s"); params.append(nuevo_largo)
                        cambios.append(f"largo_total: {largo}→{nuevo_largo}")
                        largo = nuevo_largo
                for c in _GEOM_COLS:
                    if c in campos:
                        # 5M.4: un dim/ángulo/radio dejado vacío (null) se normaliza a 0
                        # (los lados no usados van en 0, no NULL, como la data de origen).
                        # La figura (texto) no se normaliza.
                        val = campos[c]
                        if c != "figura" and val is None:
                            val = 0
                        sets.append(f"{c} = %s"); params.append(val)
                        cambios.append(f"{c}: {barra[c]}→{val}")

            # Recalcular peso si cambió diam, cant/mult/cant_total o el largo (por
            # geometría). CON EL FACTOR DE PESO DE LA OBRA (incidente: aquí se usaba
            # el peso teórico puro mientras crear/duplicar aplican
            # teorico×(1+factor/100) → una barra corregida en el BM quedaba con
            # peso de otra escala que sus hermanas y el export mezclaba fórmulas).
            if any(k in campos for k in ("diam", "cant", "mult", "cant_total")) or toca_geom:
                peso_unitario, _ = _calcular_peso(diam, largo)
                if peso_unitario is not None:
                    from .lotes import _factor_peso
                    peso_unitario = peso_unitario * (1 + _factor_peso(cur, barra["id_proyecto"]) / 100.0)
                peso_total = (peso_unitario * cant_total) if (peso_unitario is not None and cant_total is not None) else None
                sets.append("peso_unitario = %s"); params.append(peso_unitario)
                sets.append("peso_total = %s"); params.append(peso_total)

            if not sets:
                return {"ok": True, "message": "Sin cambios"}

            # Marca de edición manual.
            sets.append("editado_por = %s"); params.append(email)
            sets.append("editado_fecha = %s"); params.append(now)
            # 5N.19 — editar una barra INVALIDA su revisión: si el contenido cambió, la
            # revisión anterior ya no refleja el estado actual → vuelve a "sin revisar"
            # (se limpia la trazabilidad). Debe volver a revisarse. Coherente con que
            # terminar un lote exige todas las barras revisadas.
            sets.append("revisada = FALSE")
            sets.append("revisada_por = %s"); params.append(None)
            sets.append("revisada_fecha = %s"); params.append(None)
            # 5N.4 (Rediseño B): editar una barra ES un cambio de contenido → el sector
            # queda desactualizado respecto a lo exportado. Actualizar fecha_carga (para
            # que el mecanismo viejo de fechas también lo detecte) y marcar el sector
            # 'modificado' en sector_estado (mecanismo nuevo). Antes editar NO marcaba el
            # sector → la matriz seguía verde (exportado) mostrando data desactualizada.
            sets.append("fecha_carga = %s"); params.append(now)

            params.append(barra_id)
            cur.execute(f"UPDATE barras SET {', '.join(sets)} WHERE id = %s", params)

            # Evento de estado del sector (mismo cursor = misma transacción, atómico).
            try:
                from .sector_estado import marcar_sector_modificado
                marcar_sector_modificado(cur, barra["id_proyecto"], barra.get("sector"),
                                         barra.get("piso"), barra.get("ciclo"), por=email)
            except Exception:
                pass  # el estado del sector no debe romper la edición de la barra

    _cache.invalidate("stats:", "landing:")
    audit(email, "editar_barra", "; ".join(cambios), "barra", str(barra_id))
    # Devolver la barra actualizada (para optimistic update en el front, 5M.9).
    with get_conn() as conn2:
        with conn2.cursor(row_factory=dict_row) as cur2:
            cur2.execute(
                "SELECT " + ", ".join(BARRAS_COLUMNS) + " FROM barras WHERE id = %s",
                (barra_id,),
            )
            barra_actual = cur2.fetchone()
    return {"ok": True, "id": barra_id, "cambios": cambios,
            "editado_por": email, "editado_fecha": now, "barra": barra_actual}


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
                  AND b.id_proyecto = %s""" + pf_sql + _sql_excluir_borrador("b") + """
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
    """Eliminar una barra individual (ruta legacy por id_unico). DESHABILITADO — el borrado desde
    Bar Manager usa POST /barras/eliminar (por id, con registro histórico). Ver eliminar_barras."""
    raise HTTPException(status_code=403, detail="Función deshabilitada — usa el borrado del Bar Manager.")


# Columnas de `barras` que se copian a `barras_eliminadas` como snapshot (registro histórico). El
# orden mapea 1:1 con las columnas del INSERT de más abajo. `id` de la barra va a la columna barra_id.
_SNAP_COLS_BARRA = [
    "id", "id_unico", "id_proyecto", "nombre_proyecto", "plano_code", "nombre_plano",
    "sector", "piso", "ciclo", "eje", "diam", "largo_total", "mult", "cant", "cant_total",
    "peso_unitario", "peso_total", "fecha_carga", "origen", "import_id", "lote_id", "estado",
    "marca", "figura",
    "dim_a", "dim_b", "dim_c", "dim_d", "dim_e", "dim_f", "dim_g", "dim_h", "dim_i",
    "ang1", "ang2", "ang3", "ang4", "radio", "suf_tipo", "editado_por", "revisada",
    # De QUÉ estructura del modelador venía (migración 107). Sin estas dos, el registro
    # de una barra borrada no decía de qué elemento salía ni de qué parte de él.
    "template_instancia_id", "origen_ref",
]
# Columnas destino en barras_eliminadas (misma secuencia; `id` → `barra_id`).
_SNAP_COLS_DEST = ["barra_id" if c == "id" else c for c in _SNAP_COLS_BARRA]


class EliminarBarrasReq(BaseModel):
    ids: List[int]   # ids (PK) de las barras a eliminar. 1 o varias (individual y masivo).


@router.post("/barras/eliminar")
def eliminar_barras(body: EliminarBarrasReq, user=Depends(get_current_user)):
    """Elimina barras desde el Bar Manager: las copia a `barras_eliminadas` (registro histórico de
    solo lectura, con quién/cuándo) y las BORRA físicamente de `barras`. NO es un deshacer: la barra
    desaparece de todas las vistas/cálculos/exportación; solo queda su registro. Individual o masivo
    (una o varias ids). Permiso: mismo que editar barras (miembro de cubicaciones o admin)."""
    ids = [int(i) for i in (body.ids or []) if i is not None]
    if not ids:
        raise HTTPException(status_code=400, detail="No se indicaron barras a eliminar.")
    email = user.get("email", "?")
    now = datetime.now(timezone.utc).isoformat()
    cols_src = ", ".join(_SNAP_COLS_BARRA)
    cols_dst = ", ".join(_SNAP_COLS_DEST)
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not _puede_editar_barras(cur, user):
                raise HTTPException(status_code=403, detail="No tienes permiso para eliminar barras. Solo un miembro del área de Cubicaciones puede hacerlo.")
            # Copiar a barras_eliminadas (snapshot) las que existen, estampando quién/cuándo.
            cur.execute(
                f"""INSERT INTO barras_eliminadas (eliminada_por, eliminada_fecha, {cols_dst})
                    SELECT %s, %s, {cols_src} FROM barras WHERE id = ANY(%s)""",
                (email, now, ids),
            )
            copiadas = cur.rowcount
            # Sectores afectados (para marcar 'modificado' tras el borrado), antes de borrar.
            cur.execute(
                "SELECT DISTINCT id_proyecto, sector, piso, ciclo FROM barras WHERE id = ANY(%s)", (ids,))
            sectores = cur.fetchall()
            # Borrar físicamente de barras.
            cur.execute("DELETE FROM barras WHERE id = ANY(%s)", (ids,))
            borradas = cur.rowcount
            try:
                from .sector_estado import marcar_sector_modificado
                for idp, sec, pis, cic in sectores:
                    marcar_sector_modificado(cur, idp, sec, pis, cic, por=email)
            except Exception:
                pass
    _cache.invalidate("stats:", "landing:")
    audit(email, "eliminar_barras", f"{borradas} barra(s) · ids {ids[:20]}{'…' if len(ids) > 20 else ''}", "barra", str(ids[0]) if ids else "")
    return {"ok": True, "eliminadas": borradas, "registradas": copiadas}


@router.get("/barras/eliminadas")
def listar_barras_eliminadas(proyecto: str, limit: int = 500, offset: int = 0, user=Depends(get_current_user)):
    """Lista el registro histórico de barras eliminadas de una obra (solo lectura, para el panel del
    Bar Manager). Ordena por fecha de eliminación descendente (lo más reciente arriba)."""
    if limit < 1: limit = 1
    if limit > 2000: limit = 2000
    if offset < 0: offset = 0
    cols = ", ".join(_SNAP_COLS_DEST)
    with get_conn() as conn:
        with conn.cursor() as cur:
            allowed = _get_allowed_project_ids(cur, user)
            # Respeta el filtro de proyectos por rol (si el usuario no puede ver la obra, no lista nada).
            if allowed is not None and proyecto not in allowed:
                return {"proyecto": proyecto, "total": 0, "data": []}
            cur.execute("SELECT COUNT(*) FROM barras_eliminadas WHERE id_proyecto = %s", (proyecto,))
            total = int(cur.fetchone()[0])
            cur.execute(
                f"""SELECT del_id, eliminada_por, eliminada_fecha, {cols}
                    FROM barras_eliminadas WHERE id_proyecto = %s
                    ORDER BY eliminada_fecha DESC, del_id DESC
                    LIMIT %s OFFSET %s""",
                (proyecto, limit, offset),
            )
            campos = ["del_id", "eliminada_por", "eliminada_fecha"] + _SNAP_COLS_DEST
            data = [dict(zip(campos, r)) for r in cur.fetchall()]
    return {"proyecto": proyecto, "total": total, "count": len(data), "data": data}


import re as _re
# Orden constructivo: helpers en armahub/orden.py (módulo sin deps, fuente única + testeable). Se
# re-exportan con nombres locales `_` para no tocar los usos existentes (sectores-nav, cobertura,
# el ORDER BY constructivo y la exportación).
from .orden import (
    piso_order as _piso_order,
    ciclo_order as _ciclo_order,
    sector_order as _sector_order,
    orden_constructivo_key as _orden_constructivo_key,
)


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
                WHERE id_proyecto = %s""" + _sql_excluir_borrador() + """
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
            where = "WHERE 1=1" + pf_b + _sql_excluir_borrador("b")   # ocultar barras de despieces en borrador
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
                    COALESCE(SUM(b.peso_total), 0) AS kilos,
                    COUNT(*) FILTER (WHERE b.editado_por IS NOT NULL) AS editadas
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
                # 5M.6: barras de esta celda editadas a mano en la plataforma
                # (para distinguir en la matriz edición-plataforma vs re-import).
                "editadas": int(r[6] or 0),
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
                    COALESCE(rec.n_reclamos, 0) as n_reclamos,
                    COALESCE(SUM(b.cant_total), 0) as total_barras_fisicas
                FROM proyectos p
                LEFT JOIN barras b ON p.id_proyecto = b.id_proyecto AND b.estado IS DISTINCT FROM 'borrador'
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
        total_items = int(r[2]) if r[2] else 0            # nº de entradas/filas (COUNT)
        total_barras = round(float(r[16])) if r[16] else 0  # barras físicas (Σ cant_total)
        total_kilos = float(r[3]) if r[3] else 0.0
        diam_prom = float(r[12]) if r[12] else 0.0
        # PPI = Peso Por Item (kg promedio por entrada/fila)
        ppi = round(total_kilos / total_items, 2) if total_items > 0 else 0.0
        # PPB = Peso Por Barra física (kg / Σ cant_total)
        ppb = round(total_kilos / total_barras, 2) if total_barras > 0 else 0.0

        proyectos.append({
            "id_proyecto": r[0],
            "nombre_proyecto": r[1],
            "total_items": total_items,
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
                WHERE id_proyecto = %s""" + _sql_excluir_borrador() + """
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
                  AND eje IS NOT NULL AND eje <> ''""" + _sql_excluir_borrador() + """
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
    from datetime import timedelta, date
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
                # Desde `barras` (creado_por): incluye CSV + cubicación manual. Antes solo imports (CSV).
                cur.execute("""
                    SELECT b.creado_por AS usuario,
                           COALESCE(u.nombre, '') AS nombre,
                           COALESCE(u.apellido, '') AS apellido,
                           EXTRACT(ISODOW FROM b.fecha_carga::timestamp)::INTEGER AS dow,
                           COALESCE(SUM(b.peso_total), 0) AS kilos
                    FROM barras b
                    JOIN users u ON u.email = b.creado_por
                    WHERE b.creado_por IS NOT NULL
                      AND LEFT(b.fecha_carga, 10) >= %s
                      AND LEFT(b.fecha_carga, 10) <= %s""" + _sql_excluir_borrador("b") + """
                    GROUP BY b.creado_por, u.nombre, u.apellido, dow
                    ORDER BY b.creado_por, dow
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

                # --- Cubicado AÑO (para el zoom del gráfico): línea de tiempo MIXTA del año en curso.
                # Los meses YA CERRADOS van comprimidos a 1 barra por mes (Ene…mes anterior); el mes
                # ACTUAL va desglosado por SEMANA (cortes fijos por día: 1-7, 8-14, 15-21, 22-28, 29-fin)
                # con sus fechas reales. Así se ve la tendencia del año y el detalle del mes en curso,
                # sin las ~30×N barras ilegibles de un día-a-día. Una sola consulta anual agrupada por
                # (mes, semana-del-mes); Python arma los períodos.
                anio = now.year
                anio_ini = date(anio, 1, 1).strftime("%Y-%m-%d")
                cur.execute("""
                    SELECT b.creado_por AS usuario,
                           COALESCE(u.nombre, '') AS nombre,
                           COALESCE(u.apellido, '') AS apellido,
                           EXTRACT(MONTH FROM b.fecha_carga::timestamp)::INTEGER AS mes,
                           LEAST(4, (EXTRACT(DAY FROM b.fecha_carga::timestamp)::INTEGER - 1) / 7)::INTEGER AS semana,
                           COALESCE(SUM(b.peso_total), 0) AS kilos
                    FROM barras b
                    JOIN users u ON u.email = b.creado_por
                    WHERE b.creado_por IS NOT NULL
                      AND LEFT(b.fecha_carga, 10) >= %s
                      AND LEFT(b.fecha_carga, 10) <= %s""" + _sql_excluir_borrador("b") + """
                    GROUP BY b.creado_por, u.nombre, u.apellido, mes, semana
                    ORDER BY b.creado_por, mes, semana
                """, (anio_ini, now.strftime("%Y-%m-%d")))
                arows = cur.fetchall()

                # Definir las columnas (períodos) del eje: meses 1..(mes_actual-1) comprimidos + las
                # semanas del mes actual. Cada período tiene una clave para mapear los kilos.
                MESES_ABR = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
                periodos = []   # [{"key": ..., "label": ...}]
                mes_actual = now.month
                for m in range(1, mes_actual):
                    periodos.append({"key": ("mes", m), "label": MESES_ABR[m]})
                # Semanas del mes actual con su rango de días real (1-7, 8-14, 15-21, 22-28, 29-fin).
                import calendar as _cal
                ult_dia = _cal.monthrange(anio, mes_actual)[1]
                sem_hasta = min(4, (now.day - 1) // 7)   # solo hasta la semana en curso (no futuras)
                for s in range(0, sem_hasta + 1):
                    d0 = s * 7 + 1
                    d1 = ult_dia if s == 4 else min(s * 7 + 7, ult_dia)
                    periodos.append({"key": ("sem", mes_actual, s),
                                     "label": "{}-{} {}".format(d0, d1, MESES_ABR[mes_actual].lower())})
                idx_por_key = {p["key"]: i for i, p in enumerate(periodos)}

                anio_map = {}
                for r in arows:
                    email_cub, mes_r, sem_r = r[0], r[3], r[4]
                    # ¿este dato cae en un mes cerrado o en una semana del mes actual?
                    key = ("sem", mes_r, sem_r) if mes_r == mes_actual else ("mes", mes_r)
                    idx = idx_por_key.get(key)
                    if idx is None:
                        continue
                    if email_cub not in anio_map:
                        nombre = ((r[1] or "") + " " + (r[2] or "")).strip()
                        anio_map[email_cub] = {
                            "email": email_cub,
                            "nombre": nombre or email_cub.split("@")[0],
                            "valores": [0] * len(periodos),
                        }
                    anio_map[email_cub]["valores"][idx] += round(float(r[5]), 1)
                result["cubicado_anio"] = {
                    "labels": [p["label"] for p in periodos],
                    # índice donde termina el histórico mensual y empiezan las semanas del mes actual
                    # (para dibujar una separación visual). = cantidad de meses cerrados.
                    "corte_semanas": mes_actual - 1,
                    "anio": anio,
                    "cubicadores": list(anio_map.values()),
                }

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