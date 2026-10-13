"""
constructoras.py
----------------
CRUD para gestión de constructoras (antes clientes/mandantes/empresas).

Endpoints:
- GET    /constructoras          — listar constructoras (con stats de proyectos)
- GET    /constructoras/{id}     — detalle de una constructora
- POST   /constructoras          — crear constructora
- PATCH  /constructoras/{id}     — actualizar constructora
- DELETE /constructoras/{id}     — desactivar constructora (soft delete)
- POST   /proyectos/{id_proyecto}/asignar-constructora — asignar constructora a proyecto
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import get_current_user, require_admin_or_admin_calidad
from .db import get_conn, audit
from .barras import _sql_excluir_borrador

router = APIRouter()

# Roles que pueden gestionar clientes desde el tab (5L.11). USC = dueños naturales.
_ROLES_CLIENTES = ("admin", "admin_calidad", "usc")


def _require_gestion_clientes(user: dict = Depends(get_current_user)):
    """Permite el acceso al tab de Clientes: admin/admin_calidad/usc.
    IMPORTANTE: `user` DEBE declararse como Depends aquí, si no FastAPI lo interpreta
    como campo del request body y falla con 'user: Field required'."""
    if user.get("role") not in _ROLES_CLIENTES:
        raise HTTPException(status_code=403, detail="No tiene permiso para gestionar clientes")
    return user


def _puede_modificar_cliente(cur, constructora_id: int, user: dict) -> bool:
    """Editar/eliminar: solo el creador o admin/admin_calidad. Un USC no toca lo
    de otro USC. Clientes legacy (creado_por NULL) solo los gestiona admin."""
    role = user.get("role", "")
    if role in ("admin", "admin_calidad"):
        return True
    cur.execute("SELECT creado_por FROM constructoras WHERE id = %s", (constructora_id,))
    row = cur.fetchone()
    if not row:
        return False
    creador = row[0]
    return bool(creador) and creador == user.get("email")


_TIPOS_CLIENTE = ("constructora", "retail", "otro")


class ConstructoraCreate(BaseModel):
    nombre: str
    tipo: Optional[str] = "constructora"
    rut: Optional[str] = None
    contacto: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None
    direccion: Optional[str] = None
    notas: Optional[str] = None


class ConstructoraUpdate(BaseModel):
    nombre: Optional[str] = None
    tipo: Optional[str] = None
    rut: Optional[str] = None
    contacto: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None
    direccion: Optional[str] = None
    notas: Optional[str] = None
    activo: Optional[bool] = None


@router.get("/constructoras")
def listar_constructoras(activo: Optional[bool] = None, user=Depends(get_current_user)):
    """Listar constructoras con conteo de proyectos asociados. Accesible a cualquier
    autenticado (los selectores de obra/reclamo la consumen); la GESTIÓN (crear/
    editar/borrar) sí está restringida por rol y ownership en sus endpoints."""
    email = user.get("email", "")
    role = user.get("role", "")
    puede_gestionar = role in _ROLES_CLIENTES
    with get_conn() as conn:
        with conn.cursor() as cur:
            where = ""
            params = []
            if activo is not None:
                where = " WHERE c.activo = %s"
                params.append(activo)

            cur.execute("""
                SELECT c.id, c.nombre, c.rut, c.contacto, c.email, c.telefono,
                       c.direccion, c.notas, c.activo, c.fecha_creacion, c.creado_por, c.tipo,
                       COUNT(p.id_proyecto) AS proyectos_count,
                       COALESCE(SUM(stats.items), 0) AS total_items,
                       COALESCE(SUM(stats.barras_fis), 0) AS total_barras,
                       COALESCE(SUM(stats.kilos), 0) AS total_kilos
                FROM constructoras c
                LEFT JOIN proyectos p ON p.constructora_id = c.id
                LEFT JOIN (
                    -- items = nº de filas (COUNT); barras_fis = barras físicas (Σ cant_total).
                    SELECT id_proyecto, COUNT(*) AS items, COALESCE(SUM(cant_total), 0) AS barras_fis,
                           COALESCE(SUM(peso_total), 0) AS kilos
                    FROM barras WHERE 1=1 """ + _sql_excluir_borrador() + """ GROUP BY id_proyecto
                ) stats ON stats.id_proyecto = p.id_proyecto
            """ + where + """
                GROUP BY c.id, c.nombre, c.rut, c.contacto, c.email, c.telefono,
                         c.direccion, c.notas, c.activo, c.fecha_creacion, c.creado_por, c.tipo
                ORDER BY c.nombre
            """, params)
            rows = cur.fetchall()

    def _puede_mod(creador):
        if role in ("admin", "admin_calidad"):
            return True
        return puede_gestionar and bool(creador) and creador == email

    return {
        "puede_gestionar": puede_gestionar,
        "constructoras": [
            {
                "id": r[0], "nombre": r[1], "rut": r[2], "contacto": r[3],
                "email": r[4], "telefono": r[5], "direccion": r[6], "notas": r[7],
                "activo": r[8], "fecha_creacion": r[9], "creado_por": r[10], "tipo": r[11],
                "proyectos_count": int(r[12]),
                "total_items": int(r[13]),
                "total_barras": round(float(r[14])),   # barras físicas (Σ cant_total)
                "total_kilos": round(float(r[15]), 2),
                # El frontend usa esto para mostrar/ocultar los botones editar/eliminar.
                "puede_modificar": _puede_mod(r[10]),
            }
            for r in rows
        ]
    }


@router.get("/constructoras/{constructora_id}")
def detalle_constructora(constructora_id: int, user=Depends(_require_gestion_clientes)):
    """Detalle de una constructora con sus proyectos."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, nombre, rut, contacto, email, telefono,
                       direccion, notas, activo, fecha_creacion, creado_por, tipo
                FROM constructoras WHERE id = %s
            """, (constructora_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Constructora no encontrada")

            constructora = {
                "id": r[0], "nombre": r[1], "rut": r[2], "contacto": r[3],
                "email": r[4], "telefono": r[5], "direccion": r[6], "notas": r[7],
                "activo": r[8], "fecha_creacion": r[9], "creado_por": r[10], "tipo": r[11],
                "puede_modificar": _puede_modificar_cliente(cur, constructora_id, user),
            }

            cur.execute("""
                SELECT p.id_proyecto, p.nombre_proyecto,
                       COUNT(b.id_unico) AS items,
                       COALESCE(SUM(b.cant_total), 0) AS barras_fis,
                       COALESCE(SUM(b.peso_total), 0) AS kilos
                FROM proyectos p
                LEFT JOIN barras b ON b.id_proyecto = p.id_proyecto AND b.estado IS DISTINCT FROM 'borrador'
                WHERE p.constructora_id = %s
                GROUP BY p.id_proyecto, p.nombre_proyecto
                ORDER BY p.nombre_proyecto
            """, (constructora_id,))
            proyectos = [
                {
                    "id_proyecto": pr[0], "nombre_proyecto": pr[1],
                    "items": int(pr[2]), "barras": round(float(pr[3])), "kilos": round(float(pr[4]), 2),
                }
                for pr in cur.fetchall()
            ]

    constructora["proyectos"] = proyectos
    return constructora


@router.post("/constructoras")
def crear_constructora(body: ConstructoraCreate, user=Depends(_require_gestion_clientes)):
    """CERRADO (13-oct). Los clientes vienen de aSa: la constructora de ArmaHub se crea
    desde la ficha del cliente de aSa («agregar datos de ArmaHub»), que es lo que la deja
    enlazada a su nombre en aSa. Crearla suelta la dejaba sin obras y duplicada. El
    endpoint responde con la razón, no con un 404 que parezca un error."""
    raise HTTPException(
        status_code=410,
        detail="Los clientes ya no se crean a mano: vienen de aSa. Abre el cliente en la "
               "lista y apreta «Agregar datos de ArmaHub».")
    nombre = body.nombre.strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="El nombre es requerido")

    email = user.get("email", "?")
    tipo = body.tipo if body.tipo in _TIPOS_CLIENTE else "constructora"
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO constructoras (nombre, tipo, rut, contacto, email, telefono, direccion, notas, creado_por)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (nombre, tipo, body.rut, body.contacto, body.email, body.telefono, body.direccion, body.notas, email))
                new_id = cur.fetchone()[0]
        audit(email, "crear_constructora", f"{nombre} ({tipo})", "constructora", str(new_id))
        return {"ok": True, "id": new_id, "nombre": nombre}
    except Exception as e:
        if "idx_constructoras_nombre" in str(e):
            raise HTTPException(status_code=400, detail="Ya existe una constructora con ese nombre")
        # M0.8: detalle al log, mensaje genérico al cliente
        import logging as _l; _l.getLogger("armahub.constructoras").error("crear_constructora FALLO: %s", e)
        raise HTTPException(status_code=400, detail="No se pudo crear la constructora.")


@router.patch("/constructoras/{constructora_id}")
def actualizar_constructora(constructora_id: int, body: ConstructoraUpdate, user=Depends(_require_gestion_clientes)):
    """Actualizar datos de una constructora. Solo el creador o admin/admin_calidad."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM constructoras WHERE id = %s", (constructora_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Constructora no encontrada")
            if not _puede_modificar_cliente(cur, constructora_id, user):
                raise HTTPException(status_code=403, detail="Solo puedes editar clientes que tú creaste.")

            sets = []
            params = []
            for field in ["nombre", "rut", "contacto", "email", "telefono", "direccion", "notas"]:
                val = getattr(body, field, None)
                if val is not None:
                    sets.append(f"{field} = %s")
                    params.append(val.strip() if isinstance(val, str) else val)
            if body.tipo is not None and body.tipo in _TIPOS_CLIENTE:
                sets.append("tipo = %s")
                params.append(body.tipo)
            if body.activo is not None:
                sets.append("activo = %s")
                params.append(body.activo)

            if not sets:
                raise HTTPException(status_code=400, detail="Nada que actualizar")

            params.append(constructora_id)
            try:
                cur.execute(f"UPDATE constructoras SET {', '.join(sets)} WHERE id = %s", params)
            except Exception as e:
                if "idx_constructoras_nombre" in str(e):
                    raise HTTPException(status_code=400, detail="Ya existe una constructora con ese nombre")
                raise

    audit(user.get("email", "?"), "editar_constructora", f"campos: {', '.join(s.split(' =')[0] for s in sets)}", "constructora", str(constructora_id))
    return {"ok": True, "id": constructora_id}


@router.get("/constructoras/{constructora_id}/puede-eliminar")
def puede_eliminar_constructora(constructora_id: int, user=Depends(_require_gestion_clientes)):
    """Informa si el cliente puede eliminarse (sin obras asociadas) y, si no,
    qué obras hay que limpiar antes (5L.11). También valida ownership."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM constructoras WHERE id = %s", (constructora_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Constructora no encontrada")
            puede_mod = _puede_modificar_cliente(cur, constructora_id, user)
            cur.execute("""
                SELECT id_proyecto, nombre_proyecto FROM proyectos
                WHERE constructora_id = %s ORDER BY nombre_proyecto
            """, (constructora_id,))
            obras = [{"id_proyecto": o[0], "nombre_proyecto": o[1]} for o in cur.fetchall()]
    if not puede_mod:
        return {"puede": False, "motivo": "sin_permiso",
                "mensaje": "Solo el creador del cliente o un administrador puede eliminarlo.",
                "obras": obras}
    if obras:
        return {"puede": False, "motivo": "tiene_obras",
                "mensaje": f"No se puede eliminar: el cliente tiene {len(obras)} obra(s) asociada(s). "
                           "Reasigna o elimina esas obras primero y vuelve a intentar.",
                "obras": obras}
    return {"puede": True, "obras": []}


@router.delete("/constructoras/{constructora_id}")
def eliminar_constructora(constructora_id: int, user=Depends(_require_gestion_clientes)):
    """Borrado REAL del cliente. Solo el creador o admin/admin_calidad, y solo si
    NO tiene obras asociadas (el usuario debe limpiarlas antes — 5L.11)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, nombre FROM constructoras WHERE id = %s", (constructora_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Constructora no encontrada")
            if not _puede_modificar_cliente(cur, constructora_id, user):
                raise HTTPException(status_code=403, detail="Solo puedes eliminar clientes que tú creaste.")
            cur.execute("SELECT COUNT(*) FROM proyectos WHERE constructora_id = %s", (constructora_id,))
            n_obras = int(cur.fetchone()[0] or 0)
            if n_obras > 0:
                raise HTTPException(
                    status_code=409,
                    detail=f"No se puede eliminar: el cliente tiene {n_obras} obra(s) asociada(s). "
                           "Reasigna o elimina esas obras primero."
                )
            nombre = row[1]
            cur.execute("DELETE FROM constructoras WHERE id = %s", (constructora_id,))
    audit(user.get("email", "?"), "eliminar_constructora", nombre, "constructora", str(constructora_id))
    return {"ok": True, "id": constructora_id}


# ══════ LOS CLIENTES, COMO LOS VE aSa (13-oct) ══════
#
# La unidad es el CLIENTE DE aSa (el texto que trae `asa_obras.cliente`), con lo que aSa
# sabe de él: sus obras, cuántas abiertas, kilos del último año, última actividad. Y al
# lado, si lo tiene, lo que ArmaHub agregó: la constructora enlazada por `constructora_alias`
# con su RUT, contacto, correo y notas.
#
# POR QUÉ LA UNIDAD ES EL NOMBRE DE aSa Y NO LA CONSTRUCTORA: porque lo que existe de
# verdad son los 173 nombres de aSa; las constructoras son 9 y son el complemento. Si la
# lista partiera de las constructoras, 160 clientes con obras no aparecerían.

MESES_KILOS = 12


@router.get("/clientes/asa")
def clientes_asa(user=Depends(_require_gestion_clientes)):
    """La lista de clientes según aSa, cada uno con sus obras y, si lo tiene, su complemento
    de ArmaHub. Sólo lee."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Los kilos por cliente, con el gemelo «- BARRAS» incluido (son kilos de la misma
            # obra) y sin las obras marcadas como no válidas.
            cur.execute(
                """SELECT TRIM(o.cliente),
                          COALESCE(SUM(p.kg), 0),
                          COALESCE(SUM(p.kg) FILTER (WHERE p.order_date >= CURRENT_DATE - make_interval(months => %s)), 0),
                          MAX(GREATEST(p.order_date, p.proj_ship_date))
                     FROM asa_pedidos p
                     JOIN asa_obras o ON o.asa_job_id = p.asa_job_id
                    WHERE NOT o.excluida AND COALESCE(p.estado, '') <> 'Cancelled'
                      AND o.cliente IS NOT NULL AND TRIM(o.cliente) <> ''
                    GROUP BY 1""", (MESES_KILOS,))
            kilos = {r[0]: {"kg": float(r[1] or 0), "kg_12m": float(r[2] or 0),
                            "ultimo_pedido": r[3].isoformat() if r[3] else None} for r in cur.fetchall()}
            # Las obras de cada cliente (sin gemelos ni inválidas), con su obra de ArmaHub
            # si está adoptada.
            cur.execute(
                """SELECT TRIM(o.cliente), o.asa_job_id, o.nombre, o.estado, o.ultima_actividad,
                          (SELECT MIN(p.id_proyecto) FROM proyectos p WHERE p.asa_job_id = o.asa_job_id),
                          (SELECT BOOL_OR(p.en_cubicacion) FROM proyectos p WHERE p.asa_job_id = o.asa_job_id)
                     FROM asa_obras o
                    WHERE NOT o.excluida AND o.asa_job_id !~ 'B$'
                      AND o.cliente IS NOT NULL AND TRIM(o.cliente) <> ''
                    ORDER BY (COALESCE(o.estado,'') = 'Open') DESC, o.ultima_actividad DESC NULLS LAST, o.nombre""")
            obras = {}
            for cli, job, nom, est, ult, idp, encub in cur.fetchall():
                obras.setdefault(cli, []).append(
                    {"asa_job_id": job, "nombre": nom, "estado": est,
                     "ultima_actividad": ult.isoformat() if ult else None,
                     "id_proyecto": idp, "en_cubicacion": bool(encub)})
            # El complemento de ArmaHub, por nombre de aSa.
            cur.execute(
                """SELECT a.nombre_asa, c.id, c.nombre, c.rut, c.contacto, c.email, c.telefono,
                          c.direccion, c.notas, c.tipo, c.creado_por
                     FROM constructora_alias a JOIN constructoras c ON c.id = a.constructora_id
                    WHERE COALESCE(c.activo, TRUE)""")
            comp = {r[0]: {"id": r[1], "nombre": r[2], "rut": r[3], "contacto": r[4], "email": r[5],
                           "telefono": r[6], "direccion": r[7], "notas": r[8], "tipo": r[9],
                           "creado_por": r[10]} for r in cur.fetchall()}
            # Y las constructoras que todavía no tienen ningún nombre de aSa: no se esconden,
            # se muestran al final para que alguien las junte con su cliente.
            cur.execute(
                """SELECT c.id, c.nombre, c.rut, c.contacto FROM constructoras c
                    WHERE COALESCE(c.activo, TRUE)
                      AND NOT EXISTS (SELECT 1 FROM constructora_alias a WHERE a.constructora_id = c.id)
                    ORDER BY c.nombre""")
            sueltas = [{"id": r[0], "nombre": r[1], "rut": r[2], "contacto": r[3]} for r in cur.fetchall()]
    nombres = sorted(set(kilos) | set(obras))
    filas = []
    for n in nombres:
        k = kilos.get(n, {})
        obs = obras.get(n, [])
        filas.append({
            "cliente_asa": n,
            "obras": obs,
            "n_obras": len(obs),
            "n_abiertas": sum(1 for o in obs if (o["estado"] or "") == "Open"),
            "kg": k.get("kg", 0.0), "kg_12m": k.get("kg_12m", 0.0),
            "ultimo_pedido": k.get("ultimo_pedido"),
            "armahub": comp.get(n),            # None = sin complemento todavía
        })
    # Lo activo primero: kilos del último año, después abiertas, después nombre.
    filas.sort(key=lambda f: (-f["kg_12m"], -f["n_abiertas"], f["cliente_asa"]))
    return {"clientes": filas, "n": len(filas), "sin_nombre_asa": sueltas,
            "puede_gestionar": user.get("role") in _ROLES_CLIENTES}


class ComplementarBody(BaseModel):
    """Enlaza un nombre de aSa con una constructora de ArmaHub. Sin `constructora_id` se
    crea una con ese nombre (o se usa la que ya se llame igual); con él, se junta esta
    grafía a una constructora existente («es el mismo cliente que…»)."""
    nombre_asa: str
    constructora_id: Optional[int] = None


@router.post("/clientes/asa/complementar")
def complementar_cliente(body: ComplementarBody, user=Depends(_require_gestion_clientes)):
    """LA ÚNICA FORMA DE QUE NAZCA UNA CONSTRUCTORA: desde un cliente de aSa. Así nunca
    queda una constructora sin cliente, ni un cliente con dos constructoras."""
    email = user.get("email", "?")
    nombre_asa = (body.nombre_asa or "").strip()
    if not nombre_asa:
        raise HTTPException(status_code=400, detail="Falta el nombre del cliente en aSa.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM asa_obras WHERE TRIM(cliente) = %s LIMIT 1", (nombre_asa,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Ese cliente no está en el espejo de aSa.")
            cur.execute("SELECT constructora_id FROM constructora_alias WHERE nombre_asa = %s", (nombre_asa,))
            ya = cur.fetchone()
            if body.constructora_id:
                cur.execute("SELECT id, nombre FROM constructoras WHERE id = %s", (body.constructora_id,))
                c = cur.fetchone()
                if not c:
                    raise HTTPException(status_code=404, detail="Esa constructora no existe.")
                cid, cnombre, creada = c[0], c[1], False
            elif ya:
                return {"ok": True, "constructora_id": ya[0], "creada": False, "ya_estaba": True}
            else:
                # Se usa la que ya se llame igual, si la hay; si no, se crea con el nombre
                # de aSa y después se edita (RUT, contacto…) desde la misma ficha.
                cur.execute("SELECT id FROM constructoras WHERE lower(nombre) = lower(%s)", (nombre_asa,))
                c = cur.fetchone()
                if c:
                    cid, creada = c[0], False
                else:
                    cur.execute(
                        """INSERT INTO constructoras (nombre, tipo, creado_por)
                           VALUES (%s, 'constructora', %s) RETURNING id""", (nombre_asa[:120], email))
                    cid, creada = cur.fetchone()[0], True
                cnombre = nombre_asa
            cur.execute(
                """INSERT INTO constructora_alias (nombre_asa, constructora_id, creado_por)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (nombre_asa) DO UPDATE SET constructora_id = EXCLUDED.constructora_id""",
                (nombre_asa, cid, email))
            # Las obras de ese cliente heredan la constructora, si no tenían una.
            cur.execute(
                """UPDATE proyectos p SET constructora_id = %s
                     FROM asa_obras o
                    WHERE o.asa_job_id = p.asa_job_id AND TRIM(o.cliente) = %s
                      AND p.constructora_id IS NULL""", (cid, nombre_asa))
            audit(email, "cliente_complementar", "%s -> constructora %s%s"
                  % (nombre_asa, cnombre, " (creada)" if creada else ""), "constructora", str(cid))
    return {"ok": True, "constructora_id": cid, "creada": creada}


@router.get("/proyectos-sin-constructora")
def proyectos_sin_constructora(busqueda: Optional[str] = None, user=Depends(_require_gestion_clientes)):
    """Obras que aún no tienen constructora asignada (constructora_id NULL). Para el
    poblado desde la ficha (5L.11.10). Filtro opcional por texto del nombre."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            where = "WHERE p.constructora_id IS NULL"
            params: list = []
            if busqueda and busqueda.strip():
                where += " AND p.nombre_proyecto ILIKE %s"
                params.append(f"%{busqueda.strip()}%")
            cur.execute(f"""
                SELECT p.id_proyecto, p.nombre_proyecto,
                       COUNT(b.id_unico) AS barras,
                       COALESCE(SUM(b.peso_total), 0) AS kilos
                FROM proyectos p
                LEFT JOIN barras b ON b.id_proyecto = p.id_proyecto AND b.estado IS DISTINCT FROM 'borrador'
                {where}
                GROUP BY p.id_proyecto, p.nombre_proyecto
                ORDER BY p.nombre_proyecto
            """, params)
            obras = [
                {"id_proyecto": r[0], "nombre_proyecto": r[1],
                 "barras": int(r[2]), "kilos": round(float(r[3]), 2)}
                for r in cur.fetchall()
            ]
    return {"obras": obras}


class VincularObrasIn(BaseModel):
    ids_proyecto: list  # lista de id_proyecto a vincular a la constructora


@router.post("/constructoras/{constructora_id}/vincular-obras")
def vincular_obras(constructora_id: int, body: VincularObrasIn, user=Depends(_require_gestion_clientes)):
    """Vincula (o revincula) una o varias obras a esta constructora. Usado en el
    poblado masivo desde la ficha. Permiso de gestión de clientes (admin/admin_calidad/usc)."""
    ids = [str(x) for x in (body.ids_proyecto or []) if x]
    if not ids:
        raise HTTPException(status_code=400, detail="No se indicaron obras")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM constructoras WHERE id = %s", (constructora_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Constructora no encontrada")
            cur.execute(
                "UPDATE proyectos SET constructora_id = %s WHERE id_proyecto = ANY(%s)",
                (constructora_id, ids),
            )
            vinculadas = cur.rowcount
    audit(user.get("email", "?"), "vincular_obras_constructora", f"{vinculadas} obra(s)", "constructora", str(constructora_id))
    return {"ok": True, "vinculadas": vinculadas}


@router.post("/proyectos/{id_proyecto}/asignar-constructora")
def asignar_constructora(id_proyecto: str, constructora_id: Optional[int] = None, user=Depends(_require_gestion_clientes)):
    """Asignar o desasignar una constructora a un proyecto. constructora_id=null para
    desvincular (usado para limpiar una constructora antes de borrarla)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Proyecto no encontrado")

            if constructora_id is not None:
                cur.execute("SELECT id FROM constructoras WHERE id = %s", (constructora_id,))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="Constructora no encontrada")

            cur.execute("UPDATE proyectos SET constructora_id = %s WHERE id_proyecto = %s", (constructora_id, id_proyecto))
    audit(user.get("email", "?"), "asignar_constructora", f"constructora_id={constructora_id}", "proyecto", id_proyecto)
    return {"ok": True, "id_proyecto": id_proyecto, "constructora_id": constructora_id}
