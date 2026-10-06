"""
SINCRONIZACIÓN DE aSa AL ESPEJO (29-sep).

QUÉ HACE. Trae de aSa las obras y los pedidos y los guarda en `asa_obras` y `asa_pedidos`.
Nada más: no expone endpoints ni sabe de usuarios. Existe como módulo aparte justamente
para eso — lo llaman DOS clientes muy distintos y ninguno debería depender del otro:

  · los endpoints de `programacion.py`, cuando el usuario aprieta «Traer de aSa»;
  · el reloj de `asa_scheduler.py`, tres veces al día, sin nadie mirando.

LA REGLA QUE ORDENA TODO: la primera carga es grande, las siguientes son minúsculas.
`sincronizar_pedidos(anio)` trae un año completo — se usa una vez por año, al poblar.
`sincronizar_incremental()` trae sólo lo que cambió desde la última corrida buena, que en
un día normal son decenas de filas. Es lo que hace viable refrescar tres veces al día sin
molestar a aSa.

Catálogo de campos y endpoints de aSa: docs/asa_campos.md
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from . import asa
from .db import get_conn

log = logging.getLogger("armahub.asa_sync")

# ── Obras ─────────────────────────────────────────────────────────────────────
# Nombres posibles de cada dato. aSa no siempre llama igual al mismo campo entre
# endpoints, así que se acepta el primero que aparezca en vez de adivinar uno solo.
CAMPOS_OBRA = {
    "asa_job_id": ("JobID", "JobId", "Job", "ID", "Id"),
    "job_key":    ("JobKey", "JobKeyID"),
    "nombre":     ("JobName", "Name", "Descr", "Description"),
    "cliente":    ("CustomerName", "Customer", "BusPartnerName"),
    "descripcion": ("DetailingLocName", "Descr", "Description", "JobDescr"),
    "estado":     ("JobStatusDescr", "JobStatusID", "Status", "JobStatus", "StatusID"),
}

# Los ÚNICOS campos que se le piden a aSa para las obras. No es una optimización:
# getJobData devuelve 131 columnas, y entre ellas van PrimaryContactFirstName,
# PrimaryPhoneDetail, PrimaryEmailDetail y nueve líneas de dirección. Con el $select esos
# datos NUNCA SALEN DE aSa — no es que los protejamos después, es que no los pedimos.
SELECT_OBRAS = ["JobID", "JobKey", "JobName", "CustomerName",
                "JobStatusID", "JobStatusDescr", "DetailingLocName", "LastModified"]

# Se traen TODAS las obras (677: 376 abiertas, 278 finalizadas, 23 inactivas). Filtrar por
# abiertas impediría programar sobre una obra que aSa ya dio por terminada, y 677 filas no
# le hacen nada a Postgres. Este filtro queda por si conviene una corrida corta.
FILTRO_SOLO_ABIERTAS = "JobStatusID eq 'O'"

# ── Pedidos ───────────────────────────────────────────────────────────────────
# Las dimensiones por las que aSa agrupa. Todo lo que el reporte muestra o filtra tiene que
# estar acá, porque `$apply` sólo devuelve lo que se le pide agrupar.
DIMS_PEDIDOS = ["ControlCode", "JobID", "JobName", "Descr", "DetailPerson",
                "OrderDate", "PromisedDeliveryDate", "Status"]

# Cuántos días hacia atrás mira el incremental si nunca hubo una corrida buena, y cuánto se
# solapa con la anterior. El solape no es paranoia: si un pedido se modificó justo mientras
# corría la sincronización anterior, sin solape no lo vería nunca más.
DIAS_SIN_HISTORIA = 7
SOLAPE_MINUTOS = 30


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def _primer(fila: dict, nombres):
    """El primer campo presente y no vacío."""
    for n in nombres:
        v = fila.get(n)
        if v not in (None, ""):
            return v
    return None


def _fecha(valor):
    """aSa manda fechas ISO con hora y zona. Aquí sólo importa el día."""
    if not valor:
        return None
    try:
        return date.fromisoformat(str(valor)[:10])
    except ValueError:
        return None


def _abrir_bitacora(cur, endpoint: str, lanzado_por: str) -> int:
    cur.execute("INSERT INTO asa_sync (endpoint, lanzado_por) VALUES (%s,%s) RETURNING id",
                (endpoint, lanzado_por))
    return cur.fetchone()[0]


def _cerrar_bitacora(sync_id: int, ok: bool, filas: int = 0, nuevas: int = 0,
                     detalle: Optional[str] = None):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE asa_sync SET fin=now(), ok=%s, filas=%s, nuevas=%s, detalle=%s WHERE id=%s",
                (ok, filas, nuevas, (detalle or "")[:400] or None, sync_id))
        conn.commit()


# ---------------------------------------------------------------------------
# OBRAS
# ---------------------------------------------------------------------------
def sincronizar_obras(lanzado_por: str = "sistema", solo_abiertas: bool = False,
                      endpoint: str = "getJobData") -> dict:
    """Trae las obras al espejo. Devuelve {filas, nuevas}. Lanza asa.AsaError si aSa falla."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            sync_id = _abrir_bitacora(cur, endpoint, lanzado_por)
        conn.commit()

    es_obras = (endpoint == "getJobData")
    try:
        filas = asa.consultar_todo(
            endpoint,
            select=SELECT_OBRAS if es_obras else None,
            filtro=(FILTRO_SOLO_ABIERTAS if (solo_abiertas and es_obras) else None),
            maximo=3000 if es_obras else asa.MAX_TOP,
        )
    except asa.AsaError as e:
        _cerrar_bitacora(sync_id, False, detalle=str(e))
        raise

    valores = []
    for fila in filas:
        if not isinstance(fila, dict):
            continue
        job_id = _primer(fila, CAMPOS_OBRA["asa_job_id"])
        if not job_id:
            continue
        key = _primer(fila, CAMPOS_OBRA["job_key"])
        try:
            key = int(key) if key is not None else None
        except (TypeError, ValueError):
            key = None
        valores.append((
            str(job_id)[:120], key,
            str(_primer(fila, CAMPOS_OBRA["nombre"]) or "")[:250],
            (str(_primer(fila, CAMPOS_OBRA["cliente"]) or "") or None),
            (str(_primer(fila, CAMPOS_OBRA["descripcion"]) or "") or None),
            (str(_primer(fila, CAMPOS_OBRA["estado"]) or "") or None),
            sync_id))

    # Un solo viaje a la base, no uno por obra: con `execute` en bucle serían 677 idas y
    # vueltas a Supabase. `executemany` de psycopg >=3.1 los manda en modo pipeline.
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM asa_obras")
            antes = cur.fetchone()[0]
            cur.executemany(
                """
                INSERT INTO asa_obras (asa_job_id, job_key, nombre, cliente, descripcion,
                                       estado, visto_el, sync_id)
                VALUES (%s, %s, %s, %s, %s, %s, now(), %s)
                ON CONFLICT (asa_job_id) DO UPDATE
                   SET job_key = EXCLUDED.job_key, nombre = EXCLUDED.nombre,
                       cliente = EXCLUDED.cliente, descripcion = EXCLUDED.descripcion,
                       estado = EXCLUDED.estado, visto_el = now(),
                       sync_id = EXCLUDED.sync_id
                """,
                valores,
            )
            cur.execute("SELECT COUNT(*) FROM asa_obras")
            nuevas = cur.fetchone()[0] - antes
        conn.commit()
    _cerrar_bitacora(sync_id, True, len(valores), nuevas)
    return {"filas": len(valores), "nuevas": nuevas, "endpoint": endpoint}


# ---------------------------------------------------------------------------
# PEDIDOS
# ---------------------------------------------------------------------------
def _guardar_pedidos(filas, sync_id: int, anio_por_defecto: int) -> dict:
    valores = []
    for f in filas:
        cc = (f.get("ControlCode") or "").strip()
        if not cc:
            continue     # hay pedidos sin código de control; no son del reporte
        orden = _fecha(f.get("OrderDate"))
        valores.append((
            cc[:60], (f.get("JobID") or None), str(f.get("JobName") or "")[:250],
            (f.get("Descr") or None), (f.get("DetailPerson") or None),
            orden, _fecha(f.get("PromisedDeliveryDate")),
            (f.get("Status") or None), round(float(f.get("Kgs") or 0), 2),
            orden.year if orden else anio_por_defecto, sync_id))

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM asa_pedidos")
            antes = cur.fetchone()[0]
            if valores:
                cur.executemany(
                    """
                    INSERT INTO asa_pedidos (control_code, asa_job_id, job_name, descr,
                                             detail_person, order_date, promised_date,
                                             estado, kg, anio, visto_el, sync_id)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now(), %s)
                    ON CONFLICT (control_code) DO UPDATE
                       SET asa_job_id=EXCLUDED.asa_job_id, job_name=EXCLUDED.job_name,
                           descr=EXCLUDED.descr, detail_person=EXCLUDED.detail_person,
                           order_date=EXCLUDED.order_date, promised_date=EXCLUDED.promised_date,
                           estado=EXCLUDED.estado, kg=EXCLUDED.kg, anio=EXCLUDED.anio,
                           visto_el=now(), sync_id=EXCLUDED.sync_id
                    """,
                    valores,
                )
            cur.execute("SELECT COUNT(*) FROM asa_pedidos")
            nuevas = cur.fetchone()[0] - antes
        conn.commit()
    return {"filas": len(valores), "nuevas": nuevas}


def sincronizar_pedidos(anio: int, lanzado_por: str = "sistema") -> dict:
    """Trae UN AÑO completo de pedidos, agregados por código de control.

    Un año por llamada, a propósito: `$apply` no pagina —devuelve todo el resultado en una
    respuesta— así que el año es lo único que acota el tamaño. Pedir varios años de una
    sería justo la consulta que atora a aSa."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            sync_id = _abrir_bitacora(cur, "getOrderSummary/%d" % anio, lanzado_por)
        conn.commit()
    filtro = "OrderDate ge %d-01-01 and OrderDate le %d-12-31" % (anio, anio)
    try:
        filas = asa.consultar_agregado("getOrderSummary", DIMS_PEDIDOS, "TotalKgs",
                                       alias="Kgs", filtro=filtro, carga=True)
    except asa.AsaError as e:
        _cerrar_bitacora(sync_id, False, detalle=str(e))
        raise
    r = _guardar_pedidos(filas, sync_id, anio)
    _cerrar_bitacora(sync_id, True, r["filas"], r["nuevas"])
    r["anio"] = anio
    return r


# ---------------------------------------------------------------------------
# PROGRAMACIÓN DE PLANTA (getScheduling)
# ---------------------------------------------------------------------------
# Lo que de verdad dice cuándo sale un pedido. `PromisedDeliveryDate` es del pedido y no
# siempre se llena; esto es lo que la planta tiene agendado. Viene al mismo grano de
# código de control, así que se guarda en las mismas filas de `asa_pedidos`.
DIMS_PLANTA = ["CtrlCode", "SchedStatusDescr", "ProjFabDate", "ProjShipDate", "ShipID"]


def sincronizar_planta(lanzado_por: str = "sistema") -> dict:
    """Trae la programación de planta ENTERA y la pega sobre los pedidos ya espejados.

    SIN FILTRO DE AÑO, y la razón importa: al filtrar por `ProjShipDate` no venían
    justamente los que no tienen esa fecha —los 3.027 `Unscheduled`—, que son los que hay
    que reconocer como stock. Completo son 26.800 filas en 5,5 s y 4,3 MB: barato.

    Sólo ACTUALIZA: si un código de control no está en `asa_pedidos`, no se inventa una
    fila. La programación describe pedidos, y uno que no vino en getOrderSummary no tiene
    obra, descripción ni kilos — una fila con sólo una fecha no le sirve a nadie."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            sync_id = _abrir_bitacora(cur, "getScheduling", lanzado_por)
        conn.commit()
    try:
        # Agregado por CC igual que los pedidos: un CC puede venir repetido por carga.
        filas = asa.consultar_agregado("getScheduling", DIMS_PLANTA, "TotalWeight",
                                       alias="Kgs")
    except asa.AsaError as e:
        _cerrar_bitacora(sync_id, False, detalle=str(e))
        raise

    valores = []
    for f in filas:
        cc = (f.get("CtrlCode") or "").strip()
        if not cc:
            continue
        valores.append((_fecha(f.get("ProjShipDate")), _fecha(f.get("ProjFabDate")),
                        (f.get("ShipID") or None), (f.get("SchedStatusDescr") or None),
                        cc[:60]))

    with get_conn() as conn:
        with conn.cursor() as cur:
            if valores:
                cur.executemany(
                    """UPDATE asa_pedidos
                          SET proj_ship_date = %s, proj_fab_date = %s, ship_id = %s,
                              sched_estado = %s, planta_vista_el = now()
                        WHERE control_code = %s""",
                    valores,
                )
            cur.execute("SELECT COUNT(*) FROM asa_pedidos WHERE sched_estado IS NOT NULL")
            con_planta = cur.fetchone()[0]
        conn.commit()
    _cerrar_bitacora(sync_id, True, len(valores), 0)
    log.info("aSa planta: %d filas leídas, %d pedidos con programación", len(valores), con_planta)
    return {"filas": len(valores), "con_planta": con_planta}


def _desde_cuando() -> datetime:
    """El corte del incremental: cuándo terminó la última sincronización buena, menos un
    solape. El solape no es paranoia — si un pedido se modificó justo mientras corría la
    corrida anterior, sin solape no lo veríamos nunca más."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT MAX(fin) FROM asa_sync
                    WHERE ok AND endpoint LIKE 'getOrderSummary%%' AND fin IS NOT NULL""")
            ultimo = cur.fetchone()[0]
    if not ultimo:
        return _ahora() - timedelta(days=DIAS_SIN_HISTORIA)
    return ultimo - timedelta(minutes=SOLAPE_MINUTOS)


def sincronizar_incremental(lanzado_por: str = "sistema") -> dict:
    """Trae SÓLO los pedidos que cambiaron desde la última corrida buena.

    Es lo que hace viable refrescar varias veces al día: en un día normal son decenas de
    filas y tarda segundos, contra los ~10 s por año de la carga completa. El corte sale de
    `LastModified`, que es el campo que aSa actualiza en cada cambio."""
    desde = _desde_cuando()
    corte = desde.strftime("%Y-%m-%dT%H:%M:%SZ")
    with get_conn() as conn:
        with conn.cursor() as cur:
            sync_id = _abrir_bitacora(cur, "getOrderSummary/incremental", lanzado_por)
        conn.commit()
    try:
        filas = asa.consultar_agregado("getOrderSummary", DIMS_PEDIDOS, "TotalKgs",
                                       alias="Kgs", filtro="LastModified ge %s" % corte)
    except asa.AsaError as e:
        _cerrar_bitacora(sync_id, False, detalle=str(e))
        raise
    r = _guardar_pedidos(filas, sync_id, date.today().year)
    _cerrar_bitacora(sync_id, True, r["filas"], r["nuevas"])
    r["desde"] = corte
    log.info("aSa incremental desde %s: %d pedidos, %d nuevos", corte, r["filas"], r["nuevas"])
    return r
