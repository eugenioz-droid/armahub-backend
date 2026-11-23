"""
La base de los planos de las obras: `planos_obra` (una fila por plano), su entrega
(`planos_obra_entregas`) y sus pedidos de reemplazo (`planos_obra_reemplazos`). Leer, reservar la fila del plano,
ponerla al día y eliminarla. Sin HTTP: quien llama responde.
"""

from .comun import _cuando

NO_ESTA = "Ese plano no está en ArmaHub."


# ══════ Planos de las obras: antecedentes y una entrega por plano, sin bloqueo (mig 169 y 174; SPECS §5.4) ══════
# [Usuario 21-nov] Nadie «toma» un plano. El cubicador carga el plano del calculista (queda como
# antecedente, etapa «cargado») y lo sube cuando lo terminó: su entrega. Hay UNA entrega por plano. Otro
# cubicador que termina el mismo plano no puede subirlo mientras el autor de la entrega no acepte el
# reemplazo (o un administrador responda por él): su plano no se carga hasta entonces. [Usuario 22-nov: «la misma herramienta
# le da un aviso al cubicador inicial para que, aceptando, acepte que se reemplace la versión de su
# plano. El plano nuevo no se carga hasta que ocurra esto. Así se coordinan y evitamos duplicar data»]
# `planos_obra` tiene una fila por plano: el antecedente (archivo) y el resumen de la entrega, que es lo
# que leen las listas, los indicadores y el pedido. Todos los usuarios con licencia ven los planos de
# todas las obras.
ABIERTOS = ("pendiente", "aceptado")   # pedidos de reemplazo que siguen corriendo


# ── La entrega, los pedidos de reemplazo y la fila del plano en la base ──
def _entregas(cur, obras=None, plano=None) -> dict:
    """{(obra, plano): entrega}, sin sus barras. `obras`: lista de ids (None: todas las obras)."""
    if obras is not None and not obras:
        return {}
    cond, params = [], []
    if obras is not None:
        cond.append("id_proyecto = ANY(%s)")
        params.append(list(obras))
    if plano is not None:
        cond.append("plano = %s")
        params.append(plano)
    cur.execute("""SELECT id, id_proyecto, plano, autor, version, archivo, tamano, resumen, pdf, subido_el
                     FROM planos_obra_entregas""" + (" WHERE " + " AND ".join(cond) if cond else ""), params)
    return {(f[1], f[2]): {"id": f[0], "autor": f[3], "version": f[4], "archivo": f[5], "tamano": f[6],
                           "resumen": f[7] or {}, "pdf": f[8], "subido_el": f[9]} for f in cur.fetchall()}


def _entrega(cur, obra: str, plano: str):
    return _entregas(cur, [obra], plano).get((obra, plano))


def _reemplazos(cur, obras=None) -> dict:
    """{(obra, plano): [pedido…]} los pedidos de reemplazo que siguen corriendo (pendientes y
    aceptados), del más antiguo al más nuevo. `obras`: lista de ids (None: todas las obras)."""
    if obras is not None and not obras:
        return {}
    cur.execute("""SELECT id_proyecto, plano, solicitante, autor, estado, creado_el FROM planos_obra_reemplazos
                    WHERE estado = ANY(%s)""" + (" AND id_proyecto = ANY(%s)" if obras is not None else "") + " ORDER BY id",
                [list(ABIERTOS)] + ([list(obras)] if obras is not None else []))
    out = {}
    for f in cur.fetchall():
        out.setdefault((f[0], f[1]), []).append({"solicitante": f[2], "autor": f[3], "estado": f[4], "creado_el": f[5]})
    return out


def _entrega_dict(e, nombres, yo: str):
    """La entrega del plano como la ven las listas (o None)."""
    return e and {"autor": nombres.get(e["autor"], e["autor"]), "autor_email": e["autor"], "mia": e["autor"] == yo,
                  "version": e["version"], "subido_el": _cuando(e["subido_el"]), "pdf": bool(e["pdf"])}


def _reemplazos_dict(e, pedidos, nombres, yo: str) -> list:
    """Los pedidos de reemplazo que corren sobre la entrega del plano, como los ven las listas."""
    return [{"solicitante": nombres.get(r["solicitante"], r["solicitante"]), "solicitante_email": r["solicitante"],
             "estado": r["estado"], "creado_el": _cuando(r["creado_el"]), "mio": r["solicitante"] == yo}
            for r in pedidos if e and r["autor"] == e["autor"]]


def _fila_base(cur, obra: str, plano: str, exclusiva: bool = False):
    """La fila del plano en `planos_obra` (o None). Con `exclusiva` queda reservada hasta el fin de
    la transacción: lo que cambia la entrega de un plano o sus pedidos pasa de a uno."""
    cur.execute("""SELECT version, archivo, tamano, etapa, subido_por, subido_el
                     FROM planos_obra WHERE id_proyecto = %s AND plano = %s""" + (" FOR UPDATE" if exclusiva else ""),
                (obra, plano))
    f = cur.fetchone()
    return f and {"version": f[0], "archivo": f[1], "tamano": f[2], "etapa": f[3] or "", "subido_por": f[4],
                  "subido_el": f[5]}


def _rotulo(cur, obra: str, plano: str) -> str:
    """«215 (INGEVEC - EDIFICIO LOS LILENES)»: el plano por su número y su obra, para los avisos."""
    cur.execute("SELECT numero FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (obra, plano))
    f = cur.fetchone()
    cur.execute("SELECT nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (obra,))
    g = cur.fetchone()
    return f"{(f and f[0]) or plano} ({(g and g[0]) or obra})"


def _recalcular(cur, obra: str, plano: str):
    """Pone `planos_obra` al día con la entrega del plano, recién guardada por «Terminar» (con su fila
    reservada: _fila_base(exclusiva)): toma el resumen de la entrega, y su versión sube cuando la entrega
    cambia (así el pedido sabe si quedó atrás). (Hasta el 23-nov también deshacía una entrega borrada y
    guardaba lo que la fila era antes, para eso; ninguna ruta borra ya una entrega sola.)"""
    entrega = _entrega(cur, obra, plano)
    if entrega:
        cur.execute("""
            UPDATE planos_obra AS p
               SET numero = COALESCE(e.numero, p.numero), titulo = COALESCE(e.titulo, p.titulo),
                   revision = COALESCE(e.revision, p.revision), elemento = COALESCE(e.elemento, p.elemento),
                   barras = CAST(e.resumen->>'barras' AS INTEGER), aprobadas = CAST(e.resumen->>'aprobadas' AS INTEGER),
                   kg = CAST(e.resumen->>'kg' AS NUMERIC), resumen = e.resumen, barras_json = e.barras_json,
                   pdf = e.pdf, etapa = 'terminado',
                   version = p.version + CASE WHEN p.etapa IS DISTINCT FROM 'terminado'
                                                   OR p.subido_por IS DISTINCT FROM e.autor
                                                   OR p.subido_el IS DISTINCT FROM e.subido_el THEN 1 ELSE 0 END,
                   subido_por = e.autor, subido_el = e.subido_el
              FROM planos_obra_entregas AS e
             WHERE e.id = %s AND p.id_proyecto = e.id_proyecto AND p.plano = e.plano
        """, (entrega["id"],))


def _eliminar_plano(cur, email: str, obra: str, plano: str, con_barras: bool) -> dict:
    """Elimina el plano en la transacción de `cur` (no confirma ni toca R2): su fila, su entrega, sus
    pedidos de reemplazo que corren (quedan anulados) y, con `con_barras`, las barras que mandó a los
    despieces (las de sus códigos de carga; nunca lo ingresado a mano). Devuelve {version, entrega (si
    tenía), barras (borradas), claves (las keys de R2 que quedan sin uso)}: quien llama las borra de R2
    recién confirmada la base. None si el plano no está (quien llama responde 404: NO_ESTA)."""
    borradas = 0
    fila = _fila_base(cur, obra, plano, exclusiva=True)
    if not fila:
        return None
    cur.execute("SELECT codigos FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (obra, plano))
    codigos = cur.fetchone()[0]
    codigos = [c for c in (codigos if isinstance(codigos, list) else []) if isinstance(c, str) and c.strip()]
    if con_barras and codigos:
        cur.execute("""DELETE FROM barras WHERE id_proyecto = %s AND plano_code = ANY(%s)
                        AND (origen IS NULL OR origen = 'csv')""", (obra, codigos))
        borradas = cur.rowcount
    cur.execute("""DELETE FROM planos_obra_entregas WHERE id_proyecto = %s AND plano = %s
                   RETURNING archivo, pdf""", (obra, plano))
    entregas = cur.fetchall()
    cur.execute("""UPDATE planos_obra_reemplazos SET estado = 'anulado', respondido_por = %s, respondido_el = NOW()
                    WHERE id_proyecto = %s AND plano = %s AND estado IN ('pendiente', 'aceptado')""",
                (email, obra, plano))
    cur.execute("DELETE FROM planos_obra WHERE id_proyecto = %s AND plano = %s", (obra, plano))
    return {"version": fila["version"], "entrega": bool(entregas), "barras": borradas,
            "claves": [c for c in [fila["archivo"]] + [k for f in entregas for k in f] if c]}
