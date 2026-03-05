from fastapi import APIRouter, Depends, HTTPException, Query
from .db import get_conn
from .auth import get_current_user

router = APIRouter()

BARRAS_COLUMNS = [
    "id_unico","id_proyecto","plano_code","sector","piso","ciclo","eje",
    "diam","largo_total","mult","cant","cant_total",
    "peso_unitario","peso_total","version_mod","version_exp","fecha_carga"
]

ALLOWED_ORDER_BY = {
    "fecha_carga", "peso_total", "peso_unitario", "cant_total",
    "diam", "largo_total",
    "id_proyecto", "plano_code", "sector", "piso", "ciclo", "eje", "id_unico"
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

    count_sql = "SELECT COUNT(*) FROM barras" + base_where
    data_sql = f"""
        SELECT {select_cols}
        FROM barras
        {base_where}
        ORDER BY {order_by} {order_dir} NULLS LAST
        LIMIT %s OFFSET %s
    """

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(count_sql, params)
            total = int(cur.fetchone()[0])

            cur.execute(data_sql, params + [limit, offset])
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
def filters(user=Depends(get_current_user)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT sector FROM barras ORDER BY sector")
            sectores = [r[0] for r in cur.fetchall() if r[0] is not None]

            cur.execute("SELECT DISTINCT piso FROM barras ORDER BY piso")
            pisos = [r[0] for r in cur.fetchall() if r[0] is not None]

            cur.execute("SELECT DISTINCT ciclo FROM barras ORDER BY ciclo")
            ciclos = [r[0] for r in cur.fetchall() if r[0] is not None]

            cur.execute("SELECT DISTINCT plano_code FROM barras ORDER BY plano_code")
            planos = [r[0] for r in cur.fetchall() if r[0] is not None]

            cur.execute("SELECT DISTINCT id_proyecto FROM barras ORDER BY id_proyecto")
            proyectos = [r[0] for r in cur.fetchall() if r[0] is not None]

    return {
        "sectores": sectores,
        "pisos": pisos,
        "ciclos": ciclos,
        "planos": planos,
        "proyectos": proyectos,
    }


@router.get("/stats")
def stats(user=Depends(get_current_user)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM barras")
            total_barras = int(cur.fetchone()[0])

            cur.execute("SELECT COALESCE(SUM(peso_total),0) FROM barras")
            total_kilos_exact = float(cur.fetchone()[0])

            # “tipo GStarCAD”: redondeo por item a 2 decimales
            cur.execute("SELECT COALESCE(peso_total,0) FROM barras")
            rows = cur.fetchall()
            total_kilos_item_rounded = float(sum(round(float(r[0] or 0), 2) for r in rows))

    return {
        "total_barras": total_barras,
        "total_kilos_exact": total_kilos_exact,
        "total_kilos_item_rounded": total_kilos_item_rounded,
    }


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
            cur.execute("SELECT COUNT(*) AS barras, COALESCE(SUM(peso_total),0) AS kilos FROM barras")
            total_barras, total_kilos = cur.fetchone()

            cur.execute(f"""
                SELECT {group_by} AS grupo,
                       COUNT(*) AS barras,
                       COALESCE(SUM(peso_total),0) AS kilos
                FROM barras
                GROUP BY {group_by}
                ORDER BY kilos DESC
            """)
            rows = cur.fetchall()

    return {
        "total": {"barras": int(total_barras), "kilos": float(total_kilos)},
        "group_by": group_by,
        "items": [{"grupo": r[0], "barras": int(r[1]), "kilos": float(r[2])} for r in rows],
    }