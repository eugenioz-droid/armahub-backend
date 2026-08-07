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


def build_role_filter(user, cur=None):
    """Construye filtro WHERE según rol → (where_clause, params).
    - admin/admin_calidad: todo
    - usc: reclamos que creó o le asignaron
    - externo: reclamos donde está asignado como responsable
    - jefe_servicio/miembro: todos los reclamos de las áreas a las que pertenecen
    """
    email = user.get("email", "")
    role = user.get("role", "usc")
    if role == "usc":
        return " AND (r.creado_por = %s OR r.asignado_a = %s)", [email, email]
    elif role == "externo":
        return " AND (r.cubicador_asignado = %s OR r.respuesta_por = %s)", [email, email]
    elif role in ("jefe_servicio", "miembro"):
        if cur is None:
            return " AND FALSE", []
        cur.execute("""
            SELECT au.area_id FROM area_usuarios au
            JOIN users u ON u.id = au.user_id
            WHERE u.email = %s
        """, (email,))
        area_ids = [r[0] for r in cur.fetchall()]
        if not area_ids:
            return " AND FALSE", []
        placeholders = ",".join(["%s"] * len(area_ids))
        return f" AND r.area_id IN ({placeholders})", area_ids
    return "", []
