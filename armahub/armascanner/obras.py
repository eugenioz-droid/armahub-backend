"""
Las obras de ArmaScanner: la lista que ve ArmaScanner (ficha) y Mis obras en el portal. La obra se agrega
en ArmaHub primero, desde la lista de aSa, y recién ahí ArmaScanner la muestra; el administrador la limpia o la
elimina. Y la sección aSa de la ventana de la obra.
"""

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from ..auth import get_current_user, require_admin_or_admin_calidad
from ..db import audit, get_conn
from ..licencias import _bearer
from .acceso import _con_licencia_o_admin, _es_admin, _usuario
from .comun import _borrar, _cuando
from .datos import _diam_faltante, _eliminar_plano, _entregas, _por_piso_faltante, _reemplazos
from .kpis import kpis_de, plano_para_kpis, tabla_por_piso
from .reglas import estado_pedido, reemplazados

router = APIRouter()


@router.get("/armascanner/obras")
def obras(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Las obras de ArmaScanner: las agregadas en ArmaHub › Mis obras (`armascanner_obras`), con su
    nombre de aSa. ArmaScanner ofrece sólo éstas: la obra se agrega primero en ArmaHub y las ven todos
    los cubicadores. [Usuario 23-nov: «debemos agregar la obra en ArmaHub primero… al agregar que
    ArmaScanner reconozca la obra automáticamente»]"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _usuario(cur, credentials.credentials)
            cur.execute("""
                SELECT COALESCE(pr.asa_job_id, ''), COALESCE(ao.nombre, pr.nombre_proyecto, o.id_proyecto) AS nombre,
                       COALESCE(ao.cliente, ''), COALESCE(ao.estado, ''), o.id_proyecto
                  FROM armascanner_obras o
                  JOIN proyectos pr ON pr.id_proyecto = o.id_proyecto
                  LEFT JOIN asa_obras ao ON ao.asa_job_id = pr.asa_job_id
                 ORDER BY nombre
            """)
            return {"obras": [{"asa": r[0], "nombre": r[1], "cliente": r[2], "estado": r[3], "id": r[4]}
                              for r in cur.fetchall()]}


def _registrar_obra(cur, obra: str, email: str) -> bool:
    """La obra queda en ArmaScanner (`armascanner_obras`). True si no estaba."""
    cur.execute("""INSERT INTO armascanner_obras (id_proyecto, agregada_por) VALUES (%s, %s)
                   ON CONFLICT (id_proyecto) DO NOTHING""", (obra, email))
    return cur.rowcount == 1


# ── Mis obras: la obra se agrega aquí primero (cualquier cubicador, desde la lista de aSa) y recién ahí
# ArmaScanner la muestra; el administrador la limpia o la elimina, con aviso. [Usuario 23-nov: «en el
# menú mis obras debiéramos tener un botón de Agregar Obra, ahí buscar de las de aSa Studio»; «lo
# importante es que yo pueda eliminarlas y/o limpiarlas con algún warning»] ──
@router.get("/armascanner/obras-asa")
def obras_asa(user=Depends(get_current_user)):
    """«Agregar obra»: las obras COMO ESTÁN EN aSa (el espejo `asa_obras`, la misma lista que los
    selectores de obra del portal), para elegir con filtro de texto; `agregada` si ya está en
    ArmaScanner. [Usuario 19-nov: «hay que traer las obras de aSa, no las que creamos en la plataforma»]"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            cur.execute("""
                SELECT a.asa_job_id, a.nombre, a.cliente, a.estado,
                       EXISTS (SELECT 1 FROM armascanner_obras o JOIN proyectos p ON p.id_proyecto = o.id_proyecto
                                WHERE p.asa_job_id = a.asa_job_id OR p.id_proyecto = a.asa_job_id)
                  FROM asa_obras a
                 WHERE NOT a.excluida
                   AND a.asa_job_id !~ 'B$'                 -- el gemelo «- BARRAS» no es otra obra
                 ORDER BY (COALESCE(a.estado, '') = 'Open') DESC, a.ultima_actividad DESC NULLS LAST, a.nombre
            """)
            return {"obras": [{"asa": r[0], "nombre": r[1], "cliente": r[2] or "", "estado": r[3] or "",
                               "agregada": bool(r[4])} for r in cur.fetchall()]}


class AgregarObra(BaseModel):
    asa: str


@router.post("/armascanner/obras-linea/agregar")
def agregar_obra(datos: AgregarObra, user=Depends(get_current_user)):
    """La obra de aSa entra a ArmaHub (programacion.adoptar_obra, la única puerta) y a ArmaScanner."""
    from ..programacion import adoptar_obra
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            obra = adoptar_obra(cur, datos.asa, email, en_cubicacion=True)
            nueva = _registrar_obra(cur, obra, email)
    if nueva:
        audit(email, "armascanner_agregar_obra", f"aSa {datos.asa}", "proyecto", obra)
    return {"ok": True, "id": obra, "ya_estaba": not nueva}


class QuitarObra(BaseModel):
    obra: str
    eliminar: bool = False


@router.post("/armascanner/obras-linea/quitar")
def quitar_obra(datos: QuitarObra, admin=Depends(require_admin_or_admin_calidad)):
    """Limpiar (administrador): se eliminan los planos de la obra en ArmaHub, con sus entregas, sus
    archivos y las barras que mandaron a los despieces (_eliminar_plano). Con `eliminar`, además la obra
    sale de Mis obras y de ArmaScanner. La obra sigue en ArmaHub para lo demás y en aSa no se toca.
    Todo o nada: una sola transacción en la base (la fila de la obra queda tomada: un «Terminar» que
    llega mientras tanto espera, _obra_vigente); los archivos de R2 se borran recién confirmada."""
    email = admin.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM armascanner_obras WHERE id_proyecto = %s FOR UPDATE", (datos.obra,))
            cur.execute("SELECT plano FROM planos_obra WHERE id_proyecto = %s ORDER BY plano", (datos.obra,))
            planos = [r[0] for r in cur.fetchall()]
            hechos = [_eliminar_plano(cur, email, datos.obra, p, True) for p in planos]
            if datos.eliminar:
                cur.execute("DELETE FROM armascanner_obras WHERE id_proyecto = %s", (datos.obra,))
    _borrar(*[c for x in hechos for c in x["claves"]])
    barras = sum(x["barras"] for x in hechos)
    audit(email, "armascanner_eliminar_obra" if datos.eliminar else "armascanner_limpiar_obra",
          f"{len(planos)} planos" + (f" ({', '.join(planos)[:500]})" if planos else "") + f", {barras} barras",
          "proyecto", datos.obra)
    return {"ok": True, "planos": len(planos), "barras_eliminadas": barras}


@router.get("/armascanner/obras-linea")
def obras_linea(user=Depends(get_current_user)):
    """Mis obras: las obras agregadas a ArmaScanner (un plano sólo sube a una de ellas: _obra_de; el
    trabajo es colaborativo: todos los usuarios con licencia ven todo [Usuario 20-nov]), con sus datos
    (cliente, constructora, código de aSa), cuántos planos tiene en cada etapa, lo que espera a alguien
    (reemplazos pedidos, barras con consulta, pedidos sin enviar), sus KPIs (kpis_de) y su tabla por piso
    (tabla_por_piso).
    Suman los planos con barras que no están reemplazados por otro; los m², sólo los de losa. La de
    actividad más reciente, primero. [Usuario 22-nov: «un listado de obras con datos mínimos y KPIs»]"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            cur.execute("""SELECT id_proyecto, plano, etapa, elemento, resumen, barras, aprobadas, kg, relacion,
                                  relacion_de, version, pedido_version, subido_el
                             FROM planos_obra WHERE id_proyecto IN (SELECT id_proyecto FROM armascanner_obras)""")
            filas = cur.fetchall()
            cur.execute("SELECT id_proyecto, agregada_el FROM armascanner_obras")
            agregadas = dict(cur.fetchall())
            ids = sorted(agregadas)
            info = {}
            if ids:
                cur.execute("""SELECT pr.id_proyecto, pr.nombre_proyecto, COALESCE(pr.asa_job_id, ''),
                                      COALESCE(ao.cliente, ''), COALESCE(co.nombre, '')
                                 FROM proyectos pr
                                 LEFT JOIN asa_obras ao ON ao.asa_job_id = pr.asa_job_id
                                 LEFT JOIN constructoras co ON co.id = pr.constructora_id
                                WHERE pr.id_proyecto = ANY(%s)""", (ids,))
                info = {f[0]: f[1:] for f in cur.fetchall()}
            entregas, pedidos = _entregas(cur), _reemplazos(cur)
            fuera = reemplazados([(f[0], f[1], f[8], f[9]) for f in filas])
            diam = _diam_faltante(cur, [(f[0], f[1]) for f in filas
                                        if f[2] != "cargado" and f[5] and "diam_prom" not in (f[4] or {})])
            por_piso = _por_piso_faltante(cur, [(f[0], f[1]) for f in filas if f[2] != "cargado" and f[5]
                                                and (f[0], f[1]) not in fuera and "por_piso" not in (f[4] or {})])
    obras = {}

    def de(obra):  # la obra en la lista; sin planos, su actividad es la fecha en que se agregó
        nombre, asa, cliente, constructora = info.get(obra) or (obra, "", "", "")
        return obras.setdefault(obra, {"id": obra, "nombre": nombre or obra, "asa": asa, "cliente": cliente,
                                       "constructora": constructora, "planos": 0, "terminados": 0, "cargados": 0,
                                       "en_trabajo": 0, "reemplazos": 0, "consultas": 0, "sin_enviar": 0,
                                       "_ultima": agregadas.get(obra), "_kpis": []})

    for obra in agregadas:
        de(obra)
    for (obra, plano, etapa, elemento, resumen, barras, aprobadas, kg, _rel, _de, version, pedido_version,
         subido_el) in filas:
        o = de(obra)
        o["planos"] += 1
        etapa = etapa or ""
        o["terminados" if etapa == "terminado" else "cargados" if etapa == "cargado" else "en_trabajo"] += 1
        e = entregas.get((obra, plano))
        o["reemplazos"] += sum(1 for r in pedidos.get((obra, plano), [])
                               if r["estado"] == "pendiente" and e and r["autor"] == e["autor"])
        if subido_el and (o["_ultima"] is None or subido_el > o["_ultima"]):
            o["_ultima"] = subido_el
        if etapa == "cargado" or (obra, plano) in fuera:
            continue
        r = resumen or {"barras": barras or 0, "aprobadas": aprobadas or 0, "kg": float(kg or 0)}
        o["consultas"] += int(r.get("consultas") or 0)
        o["sin_enviar"] += estado_pedido(version, pedido_version) != "enviado"
        o["_kpis"].append(plano_para_kpis(r, elemento, diam.get((obra, plano)), por_piso.get((obra, plano))))
    lista = sorted(obras.values(), key=lambda o: (o["_ultima"] is None, -(o["_ultima"].timestamp() if o["_ultima"]
                                                                         else 0), str(o["nombre"])))
    return {"admin": _es_admin(user),
            "obras": [dict({k: v for k, v in o.items() if not k.startswith("_")}, ultima=_cuando(o["_ultima"]),
                           kpis=kpis_de(o["_kpis"]), por_piso=tabla_por_piso(o["_kpis"])) for o in lista]}


# ── La sección aSa de la ventana de la obra: qué parte de cada plano está en aSa y con qué códigos ──
# En aSa la cubicación es un pedido con su código de control (CC: `control_code` del espejo
# `asa_pedidos`, refrescado cada día; integracion_asa.md). aSa no tiene sector, piso ni ciclo: el
# cubicador los escribe en la descripción del código («LCIELO P5 C1»). El plano llega a aSa así: su
# pedido (Enviar pedido) deja sus barras en los despieces de la obra con su sector, piso y ciclo; la
# exportación arma un Excel por sector + piso + ciclo (export.py), y ése se carga en aSa como un CC.
# El cruce, entonces, es por obra (su job de aSa) y por sector + piso + ciclo, leídos de la
# descripción con las reglas de la auditoría (auditorias._ubicacion_desde_nombre). Es por nombre: un
# código con otra descripción no se reconoce. El cruce exacto (la columna PLANO de la exportación queda
# en el ElementDesc de cada barra en aSa) pide consultar aSa barra a barra y no está en el espejo.
ESTADO_ANULADO = "Cancelled"  # (programacion.ESTADO_NUNCA) un código anulado en aSa no cuenta


def clave_ubicacion(sector, piso, ciclo) -> tuple:
    """(SECTOR, PISO, CICLO) como se comparan con lo leído de un código de aSa: «LCIELO», «P5», «C1».
    ArmaScanner anota el piso sólo con su número («5»). Función pura."""
    import re
    from ..auditorias import _ubicacion_desde_nombre
    u = _ubicacion_desde_nombre(" ".join(str(x or "") for x in (sector, piso, ciclo)), None)
    p = str(piso or "").strip().upper()
    s = (u["sector"] or str(sector or "").strip().upper(),
         ("P" + p) if p.isdigit() else (u["piso"] or p), u["ciclo"] or str(ciclo or "").strip().upper())
    return tuple(re.sub(r"^([A-Z]+)0+(\d)", r"\1\2", x) for x in s)


def ubicacion_de_codigo(descr):
    """(SECTOR, PISO, CICLO) leídos de la descripción de un código de aSa, o None si falta alguno
    (no se adivina). Función pura."""
    import re
    from ..auditorias import _ubicacion_desde_nombre
    u = _ubicacion_desde_nombre(descr, None)
    if not (u["sector"] and u["piso"] and u["ciclo"]):
        return None
    return tuple(re.sub(r"^([A-Z]+)0+(\d)", r"\1\2", u[k]) for k in ("sector", "piso", "ciclo"))


def cruce_asa(combos, codigos) -> dict:
    """Qué parte de un plano está en aSa. `combos`: [(sector, piso, ciclo, kg)] de las barras que el
    plano mandó a los despieces; `codigos`: [{cc, descr, kg, estado, fecha}] de la obra en aSa.
    → {kg, kg_en_asa, pct, codigos (los que calzan), faltan (lo que no tiene código: «LCIELO P5 C3»)}.
    Un código calza si su descripción dice el mismo sector, piso y ciclo. Función pura."""
    por = {}
    for c in codigos:
        k = ubicacion_de_codigo(c.get("descr"))
        if k:
            por.setdefault(k, []).append(c)
    kg = en = 0.0
    calzan, faltan = [], []
    for sector, piso, ciclo, k_kg in combos:
        k, k_kg = clave_ubicacion(sector, piso, ciclo), float(k_kg or 0)
        kg += k_kg
        if k in por:
            en += k_kg
            calzan += [c for c in por[k] if c not in calzan]
        elif " ".join(x for x in k if x) not in faltan:
            faltan.append(" ".join(x for x in k if x))
    return {"kg": round(kg, 1), "kg_en_asa": round(en, 1), "pct": round(100 * en / kg) if kg else None,
            "codigos": calzan, "faltan": faltan}


@router.get("/armascanner/obras-linea/asa")
def asa_de_obra(obra: str, user=Depends(get_current_user)):
    """La sección aSa de la ventana de la obra: los códigos de la obra en aSa y, por plano con pedido
    enviado, qué parte de sus kilos tiene código en aSa y cuáles son (cruce_asa). Un plano sin pedido
    no puede estar en aSa por esta vía: va con `pct` null."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _con_licencia_o_admin(cur, user)
            cur.execute("SELECT COALESCE(asa_job_id, '') FROM proyectos WHERE id_proyecto = %s", (obra,))
            f = cur.fetchone()
            job = f[0] if f else ""
            cur.execute("""SELECT plano, etapa, codigos, version, pedido_version
                             FROM planos_obra WHERE id_proyecto = %s""", (obra,))
            planos = cur.fetchall()
            de_codigo = {c: p[0] for p in planos for c in (p[2] if isinstance(p[2], list) else [])
                         if isinstance(c, str) and c.strip()}
            combos = {}
            if de_codigo:
                cur.execute("""SELECT plano_code, COALESCE(sector, ''), COALESCE(piso, ''), COALESCE(ciclo, ''),
                                      COALESCE(SUM(peso_total), 0)
                                 FROM barras WHERE id_proyecto = %s AND plano_code = ANY(%s)
                                GROUP BY plano_code, sector, piso, ciclo""", (obra, sorted(de_codigo)))
                for code, s, p, c, kg in cur.fetchall():
                    combos.setdefault(de_codigo[code], []).append((s, p, c, float(kg or 0)))
            codigos, al = [], None
            if job:
                cur.execute("""SELECT control_code, COALESCE(descr, ''), COALESCE(kg, 0), COALESCE(estado, ''), order_date
                                 FROM asa_pedidos WHERE asa_job_id = %s AND (estado IS NULL OR estado <> %s)
                                ORDER BY order_date, control_code""", (job, ESTADO_ANULADO))
                codigos = [{"cc": r[0], "descr": r[1], "kg": round(float(r[2]), 1), "estado": r[3],
                            "fecha": r[4].isoformat() if hasattr(r[4], "isoformat") else (r[4] or "")}
                           for r in cur.fetchall()]
                cur.execute("SELECT MAX(fin) FROM asa_sync WHERE ok")
                al = cur.fetchone()[0]
    out = []
    for plano, etapa, _c, version, pedido_version in planos:
        if etapa == "cargado":
            continue
        pedido = estado_pedido(version, pedido_version)
        x = cruce_asa(combos.get(plano, []), codigos) if pedido != "sin_enviar" \
            else {"kg": None, "kg_en_asa": None, "pct": None, "codigos": [], "faltan": []}
        out.append(dict(x, plano=plano, pedido=pedido))
    return {"asa": job, "al": _cuando(al) if hasattr(al, "astimezone") else "", "codigos": len(codigos),
            "kg": round(sum(c["kg"] for c in codigos), 1), "planos": out}
