from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from .db import get_conn
from .auth import get_current_user

router = APIRouter()

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

            # Devolver planos como objetos {code, nombre}
            cur.execute("SELECT DISTINCT plano_code, nombre_plano FROM barras WHERE plano_code IS NOT NULL ORDER BY plano_code")
            planos = [{"code": r[0], "nombre": r[1] or r[0]} for r in cur.fetchall() if r[0] is not None]

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
def get_stats(user=Depends(get_current_user)):
    """KPIs generales para Tab Inicio. Accesible para todos los usuarios autenticados."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM barras")
            total_barras = int(cur.fetchone()[0])

            cur.execute("SELECT COUNT(*) FROM proyectos")
            total_proyectos = int(cur.fetchone()[0])

            cur.execute("SELECT COALESCE(SUM(peso_total), 0) FROM barras")
            total_kilos = float(cur.fetchone()[0])

            cur.execute("SELECT MAX(fecha_carga) FROM barras")
            ultima_carga = cur.fetchone()[0]

            # KPIs avanzados: PPB, PPI, Diámetro promedio
            # PPB = kilos totales / cantidad de barras
            ppb = round(total_kilos / total_barras, 3) if total_barras > 0 else 0

            # PPI = kilos totales / cantidad de items únicos (id_unico distintos por plano+sector)
            cur.execute("SELECT COUNT(DISTINCT plano_code || '-' || COALESCE(sector,'') || '-' || COALESCE(piso,'') || '-' || COALESCE(ciclo,'')) FROM barras")
            total_items = int(cur.fetchone()[0])
            ppi = round(total_kilos / total_items, 3) if total_items > 0 else 0

            # Diámetro promedio ponderado por peso
            cur.execute("""
                SELECT COALESCE(SUM(CAST(diam AS DOUBLE PRECISION) * peso_total) / NULLIF(SUM(peso_total), 0), 0)
                FROM barras
                WHERE diam IS NOT NULL AND diam ~ '^[0-9]+(\\.[0-9]+)?$'
            """)
            diam_prom = round(float(cur.fetchone()[0]), 1)

            cur.execute("""
                SELECT COALESCE(p.nombre_proyecto, b.id_proyecto) AS nombre,
                       b.id_proyecto,
                       COUNT(*) AS barras,
                       COALESCE(SUM(b.peso_total), 0) AS kilos
                FROM barras b
                LEFT JOIN proyectos p ON b.id_proyecto = p.id_proyecto
                GROUP BY b.id_proyecto, p.nombre_proyecto
                ORDER BY kilos DESC
            """)
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
            cur.execute("""
                SELECT id, id_proyecto, nombre_proyecto, usuario, archivo, fecha, barras_count, kilos
                FROM imports
                ORDER BY id DESC
                LIMIT %s
            """, (limit,))
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
            }
            for r in rows
        ]
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

            if group_by == "id_proyecto":
                # Si agrupamos por proyecto, traer el nombre legible
                # Prioridad: p.nombre_proyecto > b.nombre_proyecto > b.id_proyecto
                cur.execute("""
                    SELECT COALESCE(p.nombre_proyecto, b.nombre_proyecto, b.id_proyecto) AS grupo,
                           COUNT(*) AS barras,
                           COALESCE(SUM(b.peso_total),0) AS kilos
                    FROM barras b
                    LEFT JOIN proyectos p ON b.id_proyecto = p.id_proyecto
                    GROUP BY COALESCE(p.nombre_proyecto, b.nombre_proyecto, b.id_proyecto)
                    ORDER BY kilos DESC
                """)
            elif group_by == "plano_code":
                # Si agrupamos por plano, traer el nombre del plano o el código
                cur.execute("""
                    SELECT COALESCE(nombre_plano, plano_code) AS grupo,
                           COUNT(*) AS barras,
                           COALESCE(SUM(peso_total),0) AS kilos
                    FROM barras
                    WHERE plano_code IS NOT NULL
                    GROUP BY COALESCE(nombre_plano, plano_code), plano_code
                    ORDER BY kilos DESC
                """)
            elif group_by == "eje":
                # Si agrupamos por eje
                cur.execute("""
                    SELECT eje AS grupo,
                           COUNT(*) AS barras,
                           COALESCE(SUM(peso_total),0) AS kilos
                    FROM barras
                    WHERE eje IS NOT NULL
                    GROUP BY eje
                    ORDER BY kilos DESC
                """)
            else:
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


@router.get("/dashboard/sectores")
def dashboard_sectores(
    proyecto: str = None,
    user=Depends(get_current_user),
):
    """
    Agrupa barras por combinación sector+piso+ciclo (sector constructivo).
    Opcionalmente filtra por proyecto.
    """
    where = ""
    params = []
    if proyecto:
        where = "WHERE b.id_proyecto = %s"
        params.append(proyecto)

    with get_conn() as conn:
        with conn.cursor() as cur:
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
    Estructura: [{id_proyecto, nombre_proyecto, total_kilos, total_barras}, ...]
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT 
                    p.id_proyecto,
                    p.nombre_proyecto,
                    COUNT(DISTINCT b.id_unico) as total_barras,
                    COALESCE(SUM(b.peso_total), 0) as total_kilos
                FROM proyectos p
                LEFT JOIN barras b ON p.id_proyecto = b.id_proyecto
                GROUP BY p.id_proyecto, p.nombre_proyecto
                ORDER BY p.fecha_creacion DESC
            """)
            rows = cur.fetchall()

    return {
        "proyectos": [
            {
                "id_proyecto": r[0],
                "nombre_proyecto": r[1],
                "total_barras": int(r[2]) if r[2] else 0,
                "total_kilos": float(r[3]) if r[3] else 0.0,
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

class ProyectoUpdate(BaseModel):
    nombre_proyecto: Optional[str] = None
    descripcion: Optional[str] = None

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
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO proyectos (id_proyecto, nombre_proyecto, usuario_creador)
                VALUES (%s, %s, %s)
            """, (id_proyecto, body.nombre_proyecto, user.get("email", "unknown")))
    return {
        "ok": True,
        "id_proyecto": id_proyecto,
        "nombre_proyecto": body.nombre_proyecto,
    }


@router.patch("/proyectos/{id_proyecto}")
def editar_proyecto(id_proyecto: str, body: ProyectoUpdate, user=Depends(get_current_user)):
    """Editar nombre/descripción de una obra."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")

            sets = []
            params = []
            if body.nombre_proyecto is not None:
                sets.append("nombre_proyecto = %s")
                params.append(body.nombre_proyecto)
            if body.descripcion is not None:
                sets.append("descripcion = %s")
                params.append(body.descripcion)

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
            nombre = row[0]

            cur.execute("SELECT COUNT(*) FROM barras WHERE id_proyecto = %s", (id_proyecto,))
            barras_count = int(cur.fetchone()[0])

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