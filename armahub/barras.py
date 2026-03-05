"""
barras.py
---------
Endpoints de lectura/consulta de datos de barras.

Incluye:
- GET /stats
- GET /filters
- GET /barras
- GET /dashboard

Esto soporta el “Paso B” (dashboard con datos reales).
La UI luego lo grafica con Chart.js.
"""

from fastapi import APIRouter, Depends, HTTPException

from .db import get_conn
from .auth import get_current_user

router = APIRouter()

BARRAS_COLUMNS = [
    "id_unico","id_proyecto","plano_code","sector","piso","ciclo","eje",
    "diam","largo_total","mult","cant","cant_total",
    "peso_unitario","peso_total","version_mod","version_exp","fecha_carga"
]


@router.get("/stats")
def stats():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM barras")
            total_barras = int(cur.fetchone()[0])

            cur.execute("SELECT COALESCE(SUM(peso_total),0) FROM barras")
            total_kilos_exact = float(cur.fetchone()[0])

            cur.execute("SELECT COALESCE(peso_total,0) FROM barras")
            rows = cur.fetchall()
            total_kilos_item_rounded = float(sum(round(float(r[0]), 2) for r in rows))

    return {
        "total_barras": total_barras,
        "total_kilos_exact": total_kilos_exact,
        "total_kilos_item_rounded": total_kilos_item_rounded,
    }


@router.get("/filters")
def filters():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT sector FROM barras WHERE sector IS NOT NULL ORDER BY sector")
            sectores = [r[0] for r in cur.fetchall()]

            cur.execute("SELECT DISTINCT piso FROM barras WHERE piso IS NOT NULL ORDER BY piso")
            pisos = [r[0] for r in cur.fetchall()]

            cur.execute("SELECT DISTINCT ciclo FROM barras WHERE ciclo IS NOT NULL ORDER BY ciclo")
            ciclos = [r[0] for r in cur.fetchall()]

            cur.execute("SELECT DISTINCT plano_code FROM barras WHERE plano_code IS NOT NULL ORDER BY plano_code")
            planos = [r[0] for r in cur.fetchall()]

            cur.execute("SELECT DISTINCT id_proyecto FROM barras WHERE id_proyecto IS NOT NULL ORDER BY id_proyecto")
            proyectos = [r[0] for r in cur.fetchall()]

    return {
        "sectores": sectores,
        "pisos": pisos,
        "ciclos": ciclos,
        "planos": planos,
        "proyectos": proyectos,
    }


@router.get("/barras")
def get_barras(
    proyecto: str = None,
    plano_code: str = None,
    sector: str = None,
    piso: str = None,
    ciclo: str = None,
    user=Depends(get_current_user),
):
    query = "SELECT " + ",".join(BARRAS_COLUMNS) + " FROM barras WHERE 1=1"
    params = []

    if proyecto:
        query += " AND id_proyecto = %s"
        params.append(proyecto)
    if plano_code:
        query += " AND plano_code = %s"
        params.append(plano_code)
    if sector:
        query += " AND sector = %s"
        params.append(sector)
    if piso:
        query += " AND piso = %s"
        params.append(piso)
    if ciclo:
        query += " AND ciclo = %s"
        params.append(ciclo)

    query += " ORDER BY fecha_carga DESC NULLS LAST"

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

    data = [dict(zip(BARRAS_COLUMNS, r)) for r in rows]
    return {"count": len(data), "data": data}


@router.get("/dashboard")
def dashboard(group_by: str = "ciclo", user=Depends(get_current_user)):
    allowed = {"sector", "piso", "ciclo", "plano_code", "id_proyecto", "eje"}
    if group_by not in allowed:
        raise HTTPException(status_code=400, detail=f"group_by debe ser uno de {sorted(list(allowed))}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS barras, COALESCE(SUM(peso_total),0) AS kilos FROM barras")
            total = cur.fetchone()

            # group_by es controlado por whitelist (allowed), así que es seguro interpolarlo
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
        "total": {"barras": int(total[0]), "kilos": float(total[1])},
        "group_by": group_by,
        "items": [{"grupo": r[0], "barras": int(r[1]), "kilos": float(r[2])} for r in rows],
    }