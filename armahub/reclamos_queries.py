"""
Queries de agregación reutilizables para Reclamos.
Cada función recibe un cursor y opcionalmente un filtro WHERE,
y devuelve datos ya formateados para la API.
"""


def q_total(cur, where="", params=None):
    """Cuenta total de reclamos."""
    cur.execute(f"SELECT COUNT(*) FROM reclamos r WHERE 1=1{where}", params or [])
    return int(cur.fetchone()[0])


def q_abiertos(cur, where="", params=None):
    """Cuenta de reclamos no cerrados/rechazados."""
    cur.execute(f"SELECT COUNT(*) FROM reclamos r WHERE r.estado NOT IN ('cerrado','rechazado'){where}", params or [])
    return int(cur.fetchone()[0])


def q_por_estado(cur, where="", params=None):
    """Distribución por estado → [{estado, count}]."""
    cur.execute(f"SELECT estado, COUNT(*) FROM reclamos r WHERE 1=1{where} GROUP BY estado ORDER BY 2 DESC", params or [])
    return [{"estado": r[0], "count": int(r[1])} for r in cur.fetchall()]


def q_por_estado_dict(cur, where="", params=None):
    """Distribución por estado → {estado: count} (para cálculos internos)."""
    cur.execute(f"SELECT estado, COUNT(*) FROM reclamos r WHERE 1=1{where} GROUP BY estado", params or [])
    return {r[0]: int(r[1]) for r in cur.fetchall()}


def q_por_tipo(cur, where="", params=None):
    """Distribución por tipo_reclamo → {tipo: count}."""
    cur.execute(f"SELECT COALESCE(r.tipo_reclamo, 'error'), COUNT(*) FROM reclamos r WHERE 1=1{where} GROUP BY 1", params or [])
    return {r[0]: int(r[1]) for r in cur.fetchall()}


def q_por_anio_mes(cur, fecha_col="fecha_deteccion", where="", params=None):
    """Reclamos por año-mes → [{anio, mes, count}].
    fecha_col: 'fecha_deteccion' (con fallback a fecha_creacion) o 'fecha_creacion'."""
    if fecha_col == "fecha_deteccion":
        date_expr = "COALESCE(r.fecha_deteccion, r.fecha_creacion)::timestamp"
    else:
        date_expr = "r.fecha_creacion::timestamp"
    cur.execute(f"""
        SELECT EXTRACT(YEAR FROM {date_expr})::INTEGER AS anio,
               EXTRACT(MONTH FROM {date_expr})::INTEGER AS mes,
               COUNT(*)
        FROM reclamos r WHERE 1=1{where}
        GROUP BY anio, mes ORDER BY anio, mes
    """, params or [])
    return [{"anio": r[0], "mes": r[1], "count": int(r[2])} for r in cur.fetchall()]


def q_resueltos_no_resueltos(cur, where="", params=None):
    """Conteo resueltos vs no resueltos → {resuelto: N, no_resuelto: N}."""
    cur.execute(f"""
        SELECT CASE WHEN r.estado IN ('cerrado') THEN 'resuelto' ELSE 'no_resuelto' END, COUNT(*)
        FROM reclamos r WHERE 1=1{where} GROUP BY 1
    """, params or [])
    raw = {r[0]: int(r[1]) for r in cur.fetchall()}
    return {"resuelto": raw.get("resuelto", 0), "no_resuelto": raw.get("no_resuelto", 0)}


def q_por_categoria(cur, where="", params=None):
    """Distribución por categoría Ishikawa → [{categoria, count}]."""
    cur.execute(f"""
        SELECT COALESCE(r.categoria_ishikawa, 'sin_categoria'), COUNT(*)
        FROM reclamos r WHERE 1=1{where} GROUP BY 1 ORDER BY 2 DESC
    """, params or [])
    return [{"categoria": r[0], "count": int(r[1])} for r in cur.fetchall()]


def q_por_proyecto(cur, limit=None):
    """Top proyectos con más reclamos → [{proyecto, count}]."""
    limit_clause = f" LIMIT {int(limit)}" if limit else ""
    cur.execute(f"""
        SELECT COALESCE(p.nombre_proyecto, r.id_proyecto, 'Sin proyecto') AS proy, COUNT(*)
        FROM reclamos r
        LEFT JOIN proyectos p ON p.id_proyecto = r.id_proyecto
        GROUP BY 1 ORDER BY 2 DESC{limit_clause}
    """)
    return [{"proyecto": str(r[0]), "count": int(r[1])} for r in cur.fetchall()]


def q_avg_dias_resolucion(cur):
    """Promedio de días de resolución para reclamos cerrados."""
    cur.execute("""
        SELECT AVG(
            EXTRACT(EPOCH FROM (fecha_cierre::timestamp - fecha_creacion::timestamp)) / 86400.0
        ) FROM reclamos WHERE estado IN ('cerrado') AND fecha_cierre IS NOT NULL
    """)
    row = cur.fetchone()
    return round(float(row[0]), 1) if row and row[0] else None


def q_top_causas(cur, limit=10):
    """Top sub-causas más repetitivas → [{cod, sub_causa, categoria, count}]."""
    cur.execute("""
        SELECT cod_causa, sub_causa, categoria_ishikawa, COUNT(*) as cnt
        FROM reclamos
        WHERE sub_causa IS NOT NULL AND sub_causa != ''
        GROUP BY cod_causa, sub_causa, categoria_ishikawa
        ORDER BY cnt DESC LIMIT %s
    """, (limit,))
    return [{"cod": r[0], "sub_causa": r[1], "categoria": r[2], "count": int(r[3])} for r in cur.fetchall()]


def q_resolucion_por_mes(cur, meses=12):
    """Tiempo promedio de resolución por mes → [{mes, avg_dias}]."""
    cur.execute("""
        SELECT TO_CHAR(fecha_cierre::timestamp, 'YYYY-MM') AS mes,
               AVG(EXTRACT(EPOCH FROM (fecha_cierre::timestamp - fecha_creacion::timestamp)) / 86400.0)
        FROM reclamos
        WHERE estado IN ('cerrado') AND fecha_cierre IS NOT NULL
          AND fecha_cierre::timestamp >= NOW() - INTERVAL '%s months'
        GROUP BY mes ORDER BY mes
    """, (meses,))
    return [{"mes": r[0], "avg_dias": round(float(r[1]), 1)} for r in cur.fetchall()]


def q_matriz_obra_categoria(cur, top_obras=8):
    """Matriz obras × categorías Ishikawa → {obras, categorias, data}."""
    cur.execute("""
        SELECT COALESCE(p.nombre_proyecto, r.id_proyecto, 'Sin obra') AS obra,
               COALESCE(r.categoria_ishikawa, 'sin_categoria') AS cat,
               COUNT(*)
        FROM reclamos r
        LEFT JOIN proyectos p ON p.id_proyecto = r.id_proyecto
        GROUP BY obra, cat ORDER BY obra, cat
    """)
    obras_set = {}
    cats_set = set()
    for obra, cat, cnt in cur.fetchall():
        obras_set.setdefault(obra, {})[cat] = int(cnt)
        cats_set.add(cat)
    obras_sorted = sorted(obras_set.items(), key=lambda x: sum(x[1].values()), reverse=True)[:top_obras]
    cats_sorted = sorted(cats_set)
    return {
        "obras": [o[0] for o in obras_sorted],
        "categorias": cats_sorted,
        "data": [[o[1].get(c, 0) for c in cats_sorted] for o in obras_sorted],
    }


def build_role_filter(user):
    """Construye filtro WHERE según rol → (where_clause, params).
    USC: propio. Cubicador/Externo: asignado/respondido. Admin: todo."""
    email = user.get("email", "")
    role = user.get("role", "usc")
    if role == "usc":
        return " AND (r.creado_por = %s OR r.asignado_a = %s)", [email, email]
    elif role in ("cubicador", "externo"):
        return " AND (r.cubicador_asignado = %s OR r.respuesta_por = %s)", [email, email]
    return "", []
