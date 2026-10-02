"""
AUDITORÍAS DE CUBICACIÓN — backend (1-oct).

QUÉ SE AUDITA. Un ELEMENTO CONSTRUCTIVO —«Muro Eje A P1 Ciclo 1»—, no una barra suelta.
En las barras ese elemento es la clave (sector · piso · ciclo · eje): `sector` dice si es
elevación (ELEV), losa (LCIELO), viga de cielo (VCIELO) o fundación (FUND); `estructura`
el tipo (Muro, Losa, Viga, Columna). El elemento se audita entero, con todas sus barras.

EL FLUJO (definición del usuario, 1-oct): en un formulario se elige obra, quién audita, el
alcance (losa/elevación, pisos, ciclos) y cuántos elementos; las fechas se llenan solas.
El sistema saca la MUESTRA al azar dentro del alcance. Después, en la auditoría, el
auditor ve cada elemento completo y marca si hay desviación y qué encontró. La
corrección NO la hace el auditor en el sistema: se le manda al cubicador una acción.

VOCABULARIO (ISO 19011 / 9001, para que el informe hable el idioma de Calidad):
  alcance · criterio · muestra · hallazgo → conforme | observación | no conformidad
  (menor / mayor) · corrección (arreglar lo encontrado) · acción correctiva (eliminar
  la causa) · verificación. La «rotación» de obras que viene después es el PROGRAMA de
  auditoría, basado en riesgo (las obras con más reclamos primero).

LA MUESTRA SE GUARDA, no se vuelve a sortear. Se saca al azar ordenando por un hash del
elemento más una semilla —con la misma semilla sale la misma muestra, y eso permite
explicar de dónde salió—, pero los elementos quedan escritos en `auditoria_elementos`: si
se resorteara, el auditor abriría mañana una lista distinta de la que empezó a revisar.

LAS FECHAS LAS PONE EL SISTEMA. Creación hoy; plazo a DIAS_PLAZO hábiles; inicio al primer
hallazgo; cierre cuando se revisa el último elemento. Y el ESTADO se DERIVA de los
hallazgos: nadie lo elige. Así no puede haber una auditoría «cerrada» a medio revisar.
"""
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import get_current_user
from .db import get_conn, audit

router = APIRouter()

# Lo que `sector` significa en las barras. Es lo que el formulario ofrece como «tipo».
SECTORES = {"ELEV": "Elevación", "LCIELO": "Losa", "VCIELO": "Viga de cielo", "FUND": "Fundación"}
MUESTRA_POR_DEFECTO = 10
MUESTRA_MAXIMA = 200
# Roles que pueden auditar: cualquiera del área que cubica o de Calidad. La regla de
# INDEPENDENCIA (no auditas lo que tú cubicaste) se aplica elemento a elemento, no acá.
ROLES_AUDITAN = ("admin", "admin_calidad", "cubicador", "jefe_servicio", "miembro", "usc")
# Estados de la auditoría (los usa el front; se congelan acá para que haya UNA lista).
ESTADOS = ("planificada", "en_curso", "cerrada")
# Hallazgos posibles sobre un elemento, en el idioma de la ISO.
HALLAZGOS = ("conforme", "observacion", "nc_menor", "nc_mayor")
# El área cuyo Ishikawa da las causas de una no conformidad (tabla `areas`).
AREA_CUBICACIONES = "Cubicaciones"
# De dónde sale la muestra. 'armahub' = las barras de acá; 'asa' = los ítems de aSa, para
# las obras que no están en ArmaHub (319 contra 18).
ORIGENES = ("armahub", "asa")
# Las obras de prueba de aSa no se auditan. Mismo patrón que usa Programación.
PATRON_OBRAS_FUERA = r"\m(prueba|no usar)\M"
# Los dos estados de aSa que dejan un código FUERA de una auditoría, y por razones
# distintas: el anulado no es trabajo, y el despachado ya se fabricó y se fue a la obra
# —auditarlo llega tarde, y lo que vale es revisar antes de que salga—. Son los mismos
# nombres que usa Programación (`programacion.ESTADO_NUNCA`): acá se repiten para no
# importar ese módulo entero sólo por dos textos.
ESTADO_NUNCA = "Cancelled"
ESTADO_DESPACHADO = "Shipped"
# Una auditoría sobre aSa pide los ítems CC a CC (la vista entera se atora), y cada
# consulta tarda entre 1 y 11 segundos. Con más de esto la creación se haría eterna.
MUESTRA_MAXIMA_ASA = 20

# Estados de la acción que nace de una no conformidad. La CORRECCIÓN la hace quien
# cubicó, en su cubicación; el auditor sólo VERIFICA. Por eso son tres y no dos.
ACCIONES = ("pendiente", "corregida", "verificada")
# Días hábiles que tiene el auditor para cerrar. Si algún día hay que configurarlo, se
# mueve de acá y no de la pantalla.
DIAS_PLAZO = 10

_CLAVE = "(sector, piso, ciclo, eje)"


def _lista(valor: Optional[str]):
    return [v for v in (valor or "").split(",") if v.strip()]


def _hoy() -> date:
    return datetime.now(timezone.utc).date()


def _habiles(desde: date, n: int) -> date:
    """`n` días hábiles después de `desde`. Sin feriados: los mismos que usa Programación."""
    d = desde
    while n > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


def _puede_auditar(user):
    if user.get("role") not in ROLES_AUDITAN:
        raise HTTPException(status_code=403, detail="No tiene permiso para auditar.")


def estado_de(revisados: int, total: int) -> str:
    """El estado NO se elige: se deriva. Sin revisar es planificada; algo revisado, en
    curso; todo revisado, cerrada. Función pura para poder probarla."""
    if revisados <= 0:
        return "planificada"
    return "cerrada" if revisados >= total else "en_curso"


@router.get("/auditorias/obras")
def obras(user=Depends(get_current_user)):
    """Las obras que tienen algo que auditar (barras en ArmaHub), con su tamaño y sus
    reclamos abiertos —el dato que después ordena el programa de auditorías—, y la
    gente que puede auditar."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""SELECT b.id_proyecto, COALESCE(p.nombre_proyecto, b.id_proyecto),
                           COUNT(*), COALESCE(SUM(b.peso_total), 0),
                           COUNT(DISTINCT {_CLAVE}),
                           (SELECT COUNT(*) FROM reclamos r
                             WHERE r.id_proyecto = b.id_proyecto
                               AND r.estado NOT IN ('cerrado', 'rechazado')) AS reclamos
                      FROM barras b
                      LEFT JOIN proyectos p ON p.id_proyecto = b.id_proyecto
                     GROUP BY 1, 2 ORDER BY 2""")
            lista = [{"id_proyecto": r[0], "obra": r[1], "barras": r[2], "kg": float(r[3] or 0),
                      "elementos": r[4], "reclamos": r[5]} for r in cur.fetchall()]
            cur.execute(
                """SELECT email, TRIM(COALESCE(nombre,'') || ' ' || COALESCE(apellido,'')), role
                     FROM users WHERE COALESCE(activo, TRUE) AND role = ANY(%s) ORDER BY 2, 1""",
                (list(ROLES_AUDITAN),))
            auditores = [{"email": r[0], "nombre": r[1] or r[0], "role": r[2]} for r in cur.fetchall()]
            # Las CAUSAS posibles de una no conformidad: el Ishikawa del área Cubicaciones
            # que Calidad ya tiene cargado. Así las auditorías alimentan el mismo Pareto
            # que los reclamos, en vez de inventar otra lista.
            cur.execute(
                """SELECT c.slug, c.nombre, s.codigo, s.descripcion
                     FROM area_rca_subcausas s
                     JOIN area_rca_categorias c ON c.id = s.categoria_id
                     JOIN areas a ON a.id = c.area_id
                    WHERE a.nombre = %s AND COALESCE(s.activo, TRUE)
                    ORDER BY c.orden, s.orden""", (AREA_CUBICACIONES,))
            causas = [{"categoria": r[0], "categoria_nombre": r[1], "codigo": r[2], "descripcion": r[3]}
                      for r in cur.fetchall()]
            # LAS OBRAS DE aSa: 319 activas contra 18 con barras en ArmaHub. Se auditan
            # igual —el elemento vive en getOrderItemView—, sólo cambia de dónde sale la
            # muestra. Las que YA están en ArmaHub no se repiten acá: ahí la auditoría es
            # más profunda (las barras están en casa) y ésa es la que conviene.
            # UNA FILA POR JOB DE aSa, no por nombre. Nueve obras tienen dos jobs con el
            # mismo nombre, y agrupando por nombre el conteo decía una cosa y la muestra
            # miraba otra: se elegía «422 códigos» y se sorteaba dentro de 63.
            cur.execute(
                """SELECT MAX(p.job_name), p.asa_job_id, COUNT(*), COALESCE(SUM(p.kg), 0),
                          MAX(GREATEST(p.order_date, p.proj_ship_date))
                     FROM asa_pedidos p
                    WHERE COALESCE(p.estado,'') <> 'Cancelled'
                      AND p.asa_job_id IS NOT NULL
                      AND p.job_name !~* %s
                      AND GREATEST(p.order_date, p.proj_ship_date) >= CURRENT_DATE - make_interval(months => 12)
                      AND NOT EXISTS (SELECT 1 FROM proyectos pr
                                       WHERE pr.asa_job_id = p.asa_job_id
                                         AND EXISTS (SELECT 1 FROM barras b WHERE b.id_proyecto = pr.id_proyecto))
                    GROUP BY p.asa_job_id ORDER BY 1""",
                (PATRON_OBRAS_FUERA,))
            asa_obras = [{"job": r[1], "obra": r[0], "cc": r[2], "kg": float(r[3] or 0),
                          "ultimo": r[4].isoformat() if r[4] else None} for r in cur.fetchall()]
    return {"obras": lista, "obras_asa": asa_obras, "auditores": auditores, "sectores": SECTORES,
            "estados": list(ESTADOS), "hallazgos": list(HALLAZGOS), "acciones": list(ACCIONES),
            "causas": causas, "muestra_por_defecto": MUESTRA_POR_DEFECTO, "dias_plazo": DIAS_PLAZO}


@router.get("/auditorias/elemento")
def elemento(id_proyecto: str, sector: str = "", piso: str = "", ciclo: str = "", eje: str = "",
             elemento_id: int = 0, user=Depends(get_current_user)):
    """UN ELEMENTO ENTERO, barra por barra, para revisarlo: marca, diámetro, figura y sus
    dimensiones, largo, cantidad, peso y de qué plano salió. Es lo que el auditor mira."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT marca, diam, figura, dim_a, dim_b, dim_c, dim_d, dim_e, dim_f, dim_g, dim_h, dim_i,
                          largo_total, cant, mult, cant_total, peso_unitario, peso_total,
                          nombre_plano, tipo, INITCAP(estructura), COALESCE(creado_por, editado_por, '?'),
                          bar_id, id_unico
                     FROM barras
                    WHERE id_proyecto = %s AND COALESCE(sector,'') = %s AND COALESCE(piso,'') = %s
                      AND COALESCE(ciclo,'') = %s AND COALESCE(eje,'') = %s
                    ORDER BY marca, diam, bar_id""",
                (id_proyecto, sector, piso, ciclo, eje))
            dims = "abcdefghi"
            barras = []
            for r in cur.fetchall():
                barras.append({
                    "marca": r[0], "diam": r[1], "figura": r[2],
                    "dims": {dims[i]: r[3 + i] for i in range(9) if r[3 + i] not in (None, 0)},
                    "largo": r[12], "cant": r[13], "mult": r[14], "cant_total": r[15],
                    "peso_unitario": r[16], "peso_total": r[17], "plano": r[18], "tipo": r[19],
                    "estructura": r[20], "cubicado_por": r[21], "bar_id": r[22], "id_unico": r[23]})
    if not barras:
        raise HTTPException(status_code=404, detail="Ese elemento no tiene barras.")
    _poner_refs(barras)
    revisados = {}
    if elemento_id:
        with get_conn() as conn:
            with conn.cursor() as cur:
                revisados = _hallazgos_de_items(cur, elemento_id)
    return {"id_proyecto": id_proyecto, "sector": sector, "piso": piso, "ciclo": ciclo, "eje": eje,
            "barras": barras, "n": len(barras), "revisados": revisados,
            "kg": sum(float(b["peso_total"] or 0) for b in barras),
            "planos": sorted({b["plano"] for b in barras if b["plano"]}),
            "cubicaron": sorted({b["cubicado_por"] for b in barras})}


@router.get("/auditorias/universo")
def universo(id_proyecto: str, user=Depends(get_current_user)):
    """De qué está hecha una obra, para armar el alcance: tipos (sector), pisos y ciclos
    con cuántos elementos tiene cada uno, y quién cubicó. Todo sale de las barras."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""SELECT sector, COUNT(DISTINCT (piso, ciclo, eje)), COUNT(*), COALESCE(SUM(peso_total),0)
                      FROM barras WHERE id_proyecto = %s GROUP BY 1 ORDER BY 2 DESC""", (id_proyecto,))
            sectores = [{"sector": r[0] or "", "nombre": SECTORES.get(r[0] or "", r[0] or "(sin sector)"),
                         "elementos": r[1], "barras": r[2], "kg": float(r[3] or 0)} for r in cur.fetchall()]
            # Pisos en orden natural (P1, P2, …, P12), no alfabético (P1, P12, P2).
            cur.execute(
                """SELECT piso, COUNT(DISTINCT (sector, ciclo, eje))
                     FROM barras WHERE id_proyecto = %s GROUP BY 1
                    ORDER BY NULLIF(regexp_replace(COALESCE(piso,''), '\\D', '', 'g'), '')::int NULLS LAST, piso""",
                (id_proyecto,))
            pisos = [{"piso": r[0] or "", "elementos": r[1]} for r in cur.fetchall()]
            cur.execute(
                """SELECT ciclo, COUNT(DISTINCT (sector, piso, eje))
                     FROM barras WHERE id_proyecto = %s GROUP BY 1
                    ORDER BY NULLIF(regexp_replace(COALESCE(ciclo,''), '\\D', '', 'g'), '')::int NULLS LAST, ciclo""",
                (id_proyecto,))
            ciclos = [{"ciclo": r[0] or "", "elementos": r[1]} for r in cur.fetchall()]
            cur.execute(
                f"""SELECT COALESCE(creado_por, editado_por, '?'), COUNT(DISTINCT {_CLAVE}), COUNT(*)
                      FROM barras WHERE id_proyecto = %s GROUP BY 1 ORDER BY 2 DESC""", (id_proyecto,))
            cubicadores = [{"email": r[0], "elementos": r[1], "barras": r[2]} for r in cur.fetchall()]
            cur.execute(f"SELECT COUNT(DISTINCT {_CLAVE}) FROM barras WHERE id_proyecto = %s", (id_proyecto,))
            total = cur.fetchone()[0]
    return {"id_proyecto": id_proyecto, "elementos": total, "sectores": sectores,
            "pisos": pisos, "ciclos": ciclos, "cubicadores": cubicadores}


@router.get("/auditorias/muestra")
def muestra(id_proyecto: str, n: int = MUESTRA_POR_DEFECTO, sectores: str = "", pisos: str = "",
            ciclos: str = "", semilla: str = "", user=Depends(get_current_user)):
    """La MUESTRA: `n` elementos al azar dentro del alcance. Reproducible con la semilla.
    Cada elemento viene entero: cuántas barras, cuántos kilos y quién lo cubicó, que es
    lo que después permite exigir independencia (que no audite el mismo que cubicó)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            total, elementos, semilla, n = _sortear(cur, id_proyecto, n, sectores, pisos, ciclos, semilla)
    return {"semilla": semilla, "n": n, "total_rango": total, "elementos": elementos,
            "kg": sum(e["kg"] for e in elementos), "barras": sum(e["barras"] for e in elementos)}


def _sortear(cur, id_proyecto: str, n, sectores: str, pisos: str, ciclos: str, semilla: str):
    """EL SORTEO, en un solo lugar: lo usan la vista previa y la creación de la auditoría.
    Si estuviera escrito dos veces, la muestra que se ve y la que se guarda podrían
    dejar de ser la misma."""
    n = max(1, min(int(n or MUESTRA_POR_DEFECTO), MUESTRA_MAXIMA))
    semilla = (semilla or secrets.token_hex(4)).strip()
    where, params = ["id_proyecto = %s"], [id_proyecto]
    for col, valor in (("sector", sectores), ("piso", pisos), ("ciclo", ciclos)):
        lista = _lista(valor)
        if lista:
            where.append(f"COALESCE({col},'') = ANY(%s)")
            params.append(lista)
    cond = " AND ".join(where)
    cur.execute(f"SELECT COUNT(DISTINCT {_CLAVE}) FROM barras WHERE {cond}", params)
    total = cur.fetchone()[0]
    if not total:
        raise HTTPException(status_code=400, detail="No hay elementos en ese alcance.")
    # El orden es un hash de la clave más la semilla: al azar, pero el MISMO azar
    # cada vez que se pida con la misma semilla.
    cur.execute(
        f"""SELECT sector, piso, ciclo, eje, MAX(INITCAP(estructura)),
                   COUNT(*), COALESCE(SUM(peso_total),0),
                   STRING_AGG(DISTINCT COALESCE(creado_por, editado_por, '?'), ', ')
              FROM barras WHERE {cond}
             GROUP BY 1, 2, 3, 4
             ORDER BY md5(COALESCE(sector,'') || '|' || COALESCE(piso,'') || '|' ||
                          COALESCE(ciclo,'') || '|' || COALESCE(eje,'') || '|' || %s)
             LIMIT %s""",
        # Se piden de más porque después se descartan los ya auditados: pedir justo `n`
        # dejaría la muestra corta en una obra que ya lleva varias auditorías.
        params + [semilla, n * 4])
    elementos = [
        {"sector": r[0] or "", "tipo": SECTORES.get(r[0] or "", r[0]), "piso": r[1] or "",
         "ciclo": r[2] or "", "eje": r[3] or "", "estructura": r[4], "barras": r[5],
         "kg": float(r[6] or 0), "cubicado_por": r[7],
         "nombre": " · ".join(x for x in (r[4] or SECTORES.get(r[0] or "", ""),
                                           ("Eje " + r[3]) if r[3] else "", r[1], r[2]) if x)}
        for r in cur.fetchall()]
    # Fuera los que ya salieron en otra auditoría de la obra.
    vistos = _ya_auditados(cur, id_proyecto)
    nuevos = [e for e in elementos if _clave_elemento(e) not in vistos]
    if not nuevos:
        raise HTTPException(status_code=400,
                            detail="Todos los elementos de ese alcance ya fueron auditados. Amplía el alcance.")
    return total, nuevos[:n], semilla, min(n, len(nuevos))


# ---------------------------------------------------------------------------
# EL MISMO TRABAJO, PERO SOBRE aSa
# ---------------------------------------------------------------------------
# El elemento de aSa es `CtrlCode` + `ElementID` de getOrderItemView. Se guarda en las
# mismas columnas que el de ArmaHub: `eje` lleva el ElementID —que en muros ES el eje, con
# la misma nomenclatura— y `estructura` el ElementDesc. Así la revisión, los hallazgos y
# las acciones son UN solo camino y no dos.
CAMPOS_ITEM = ["CtrlCode", "ElementID", "ElementDesc", "BarMark", "BarSizeDescr", "ShpNameID",
               "ShapeDims", "LegAngle", "LengthCut", "TotalQty", "LineWeight", "PinDiam",
               "Notes", "ShopMessage", "OrderDescr"]


def _ya_auditados(cur, id_proyecto: str) -> set:
    """Los elementos que YA salieron en otra auditoría de esta obra.

    Una obra grande necesita varias auditorías, y si el sorteo pudiera repetir
    elementos se revisaría dos veces lo mismo mientras otras partes no se miran
    nunca. Se excluyen los ya sorteados, no sólo los ya revisados: un elemento que
    está en una auditoría abierta ya tiene dueño.

    La clave incluye el código de control porque en aSa dos códigos distintos
    pueden traer el mismo ElementID (`01`, `02`...)."""
    cur.execute(
        """SELECT COALESCE(e.cc,''), e.sector, e.piso, e.ciclo, e.eje
             FROM auditoria_elementos e JOIN auditorias a ON a.id = e.auditoria_id
            WHERE a.id_proyecto = %s""", (id_proyecto,))
    return {tuple(r) for r in cur.fetchall()}


def refs_de_barras(barras) -> list:
    """La REFERENCIA de cada barra dentro del elemento: su marca, y un ordinal si esa
    marca se repite (`10mmA110#2`). Es con lo que se guarda el hallazgo por barra.

    No se usa el id interno de aSa porque las barras no están espejadas —se piden en
    vivo— y ese id podría cambiar; la marca es lo que el cubicador ve en el plano y
    lo que puede buscar para corregir. Función pura: se prueba sin base ni red."""
    vistas: dict = {}
    refs = []
    for b in barras:
        marca = str((b.get("marca") if isinstance(b, dict) else b) or "?").strip() or "?"
        vistas[marca] = vistas.get(marca, 0) + 1
        refs.append(marca if vistas[marca] == 1 else "%s#%d" % (marca, vistas[marca]))
    return refs


def _poner_refs(barras):
    for b, r in zip(barras, refs_de_barras(barras)):
        b["ref"] = r
    return barras


def _hallazgos_de_items(cur, elemento_id: int) -> dict:
    """Lo ya registrado barra por barra, para repintarlo al reabrir el elemento."""
    cur.execute(
        """SELECT ref, conforme, observacion, revisado_por, revisado_el
             FROM auditoria_items WHERE elemento_id = %s""", (elemento_id,))
    return {r[0]: {"conforme": r[1], "observacion": r[2], "revisado_por": r[3],
                   "revisado_el": r[4].isoformat() if r[4] else None} for r in cur.fetchall()}


def _clave_elemento(e) -> tuple:
    return (e.get("cc") or "", e["sector"], e["piso"], e["ciclo"], e["eje"])


def _orden_azar(valor: str, semilla: str) -> str:
    """El mismo azar reproducible que usa el sorteo en SQL, pero en Python."""
    import hashlib
    return hashlib.md5(("%s|%s" % (valor, semilla)).encode("utf-8")).hexdigest()


def _items_de(cc: str):
    """Los ítems de UN código de control. aSa se atora si se le pide la vista sin filtrar
    por CtrlCode, y el tope de este endpoint es 500 (no 2.000 como los otros)."""
    from . import asa
    try:
        return asa.consultar("getOrderItemView", select=CAMPOS_ITEM, filtro="CtrlCode eq '%s'" % cc, top=500)
    except asa.AsaError as e:
        raise HTTPException(status_code=502, detail="aSa no respondió por el código %s: %s" % (cc, e))


def _elementos_de_items(items, cc: str, descr: str, cubico: Optional[str]):
    """Agrupa los ítems de un CC por elemento. Un CC puede traer uno o veintidós."""
    por: dict = {}
    for it in items:
        eid = (it.get("ElementID") or "").strip()
        clave = eid or "(sin elemento)"
        e = por.setdefault(clave, {"cc": cc, "sector": "", "piso": "", "ciclo": "", "eje": clave,
                                   "estructura": (it.get("ElementDesc") or "").strip() or None,
                                   "barras": 0, "kg": 0.0, "cubicado_por": cubico,
                                   "tipo": None, "descr_cc": descr})
        e["barras"] += 1
        e["kg"] += float(it.get("LineWeight") or 0)
    for clave, e in por.items():
        e["nombre"] = " · ".join(x for x in (cc, clave if clave != "(sin elemento)" else "",
                                             e["estructura"] or descr) if x)
    return list(por.values())


@router.get("/auditorias/cc")
def codigos_de_control(job: str, user=Depends(get_current_user)):
    """LOS CÓDIGOS DE CONTROL de una obra de aSa, para elegir de cuáles sacar la muestra.

    SÓLO LOS NO DESPACHADOS. Un código `Shipped` ya se fabricó y se fue a la obra:
    auditarlo llega tarde, y lo que vale es revisar antes de que salga. Se informa
    cuántos quedaron fuera por eso, para que no parezca que falta data.

    En aSa no hay piso ni ciclo: lo que hay es `Descr`, el nombre que el usuario le
    puso al código —en edificación suele llevar ELEV, FUND, LC o VC, pero no siempre—.
    Por eso se eligen los códigos a mano en vez de intentar clasificarlos."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT control_code, COALESCE(descr,''), kg, order_date, COALESCE(estado,''),
                          COALESCE(detail_person,''), sched_estado
                     FROM asa_pedidos
                    WHERE asa_job_id = %s
                      AND COALESCE(estado,'') NOT IN (%s, %s)
                      AND job_name !~* %s
                    ORDER BY order_date DESC NULLS LAST, control_code""",
                (job, ESTADO_NUNCA, ESTADO_DESPACHADO, PATRON_OBRAS_FUERA))
            ccs = [{"cc": r[0], "descr": r[1], "kg": float(r[2] or 0),
                    "fecha": r[3].isoformat() if r[3] else None, "estado": r[4],
                    "persona": r[5], "planta": r[6]} for r in cur.fetchall()]
            cur.execute(
                """SELECT MAX(job_name),
                          COUNT(*) FILTER (WHERE COALESCE(estado,'') = %s),
                          COUNT(*) FILTER (WHERE COALESCE(estado,'') NOT IN (%s, %s))
                     FROM asa_pedidos WHERE asa_job_id = %s AND job_name !~* %s""",
                (ESTADO_DESPACHADO, ESTADO_NUNCA, ESTADO_DESPACHADO, job, PATRON_OBRAS_FUERA))
            obra, despachados, vivos = cur.fetchone()
            # Cuántos elementos de cada código ya salieron en otra auditoría: así se ve
            # qué códigos conviene elegir y cuáles ya se miraron.
            cur.execute(
                """SELECT e.cc, COUNT(*) FROM auditoria_elementos e
                          JOIN auditorias a ON a.id = e.auditoria_id
                    WHERE a.id_proyecto = %s AND e.cc IS NOT NULL GROUP BY 1""", (job,))
            ya = dict(cur.fetchall())
    for c in ccs:
        c["auditados"] = ya.get(c["cc"], 0)
    return {"job": job, "obra": obra, "ccs": ccs, "total": vivos or 0,
            "despachados": despachados or 0, "maximo": MUESTRA_MAXIMA_ASA,
            "con_auditoria": sum(1 for c in ccs if c["auditados"])}


def _sortear_asa(cur, job: str, n, ccs, semilla: str):
    """La muestra sobre aSa: `n` ELEMENTOS al azar, sacados de los códigos que se
    eligieron. Dos pasos, porque los ítems no están espejados:

      1. se barajan los códigos elegidos (azar reproducible por semilla);
      2. se les piden los ítems a aSa uno por uno —1 a 11 s cada uno, la parte lenta—
         hasta juntar elementos de sobra, y de esa bolsa se sortean los `n` finales.

    Son ELEMENTOS, no códigos: si un código trae 22 elementos, puede aportar más de uno.
    El tope de consultas existe porque cada código le cuesta segundos a aSa."""
    n = max(1, min(int(n or MUESTRA_POR_DEFECTO), MUESTRA_MAXIMA_ASA))
    semilla = (semilla or secrets.token_hex(4)).strip()
    elegidos = [str(c).strip() for c in (ccs or []) if str(c).strip()]
    if not elegidos:
        raise HTTPException(status_code=400, detail="Elige al menos un código de control.")
    cur.execute(
        """SELECT control_code, COALESCE(descr,''), COALESCE(detail_person,'')
             FROM asa_pedidos
            WHERE asa_job_id = %s AND control_code = ANY(%s)
              AND COALESCE(estado,'') NOT IN (%s, %s)""",
        (job, elegidos, ESTADO_NUNCA, ESTADO_DESPACHADO))
    candidatos = cur.fetchall()
    if not candidatos:
        raise HTTPException(status_code=400,
                            detail="Esos códigos no están en el espejo, o ya fueron despachados.")
    candidatos.sort(key=lambda c: _orden_azar(c[0], semilla))
    bolsa = []
    for cc, descr, quien in candidatos[:MUESTRA_MAXIMA_ASA]:
        bolsa.extend(_elementos_de_items(_items_de(cc), cc, descr, quien))
        if len(bolsa) >= n * 3:
            break
    if not bolsa:
        raise HTTPException(status_code=502, detail="aSa no devolvió ítems para esos códigos de control.")
    # Fuera los que ya salieron en otra auditoría de la obra: una obra grande necesita
    # varias auditorías y repetir elementos deja partes sin mirar nunca.
    vistos = _ya_auditados(cur, job)
    bolsa = [e for e in bolsa if _clave_elemento(e) not in vistos]
    if not bolsa:
        raise HTTPException(status_code=400,
                            detail="Todos los elementos de esos códigos ya fueron auditados. Elige otros códigos.")
    bolsa.sort(key=lambda e: _orden_azar(e["cc"] + "|" + e["eje"], semilla))
    return len(candidatos), bolsa[:n], semilla, min(n, len(bolsa))


@router.get("/auditorias/elemento-asa")
def elemento_asa(cc: str, element: str = "", elemento_id: int = 0, user=Depends(get_current_user)):
    """Un elemento de aSa, barra por barra: marca, Ø, figura, largo, cantidad y peso. La
    geometría viene entera en `LegAngle` (lado, largo, ángulo, gancho); acá se muestra
    como texto, que es lo que pidió el usuario para revisar rápido."""
    items = [it for it in _items_de(cc)
             if not element or (it.get("ElementID") or "").strip() == element]
    if not items:
        raise HTTPException(status_code=404, detail="Ese elemento no tiene ítems en aSa.")
    barras = [{
        "marca": it.get("BarMark"), "diam": it.get("BarSizeDescr"), "figura": it.get("ShpNameID"),
        "dims": _lados(it.get("LegAngle")), "largo": it.get("LengthCut"),
        "cant_total": it.get("TotalQty"), "peso_total": it.get("LineWeight"),
        "plano": it.get("ElementDesc"), "radio": it.get("PinDiam"),
        "nota": " · ".join(x for x in ((it.get("Notes") or "").strip(),
                                       (it.get("ShopMessage") or "").strip()) if x) or None,
    } for it in items]
    _poner_refs(barras)
    revisados = {}
    if elemento_id:
        with get_conn() as conn:
            with conn.cursor() as cur:
                revisados = _hallazgos_de_items(cur, elemento_id)
    return {"cc": cc, "element": element, "barras": barras, "n": len(barras), "revisados": revisados,
            "kg": sum(float(b["peso_total"] or 0) for b in barras),
            "planos": sorted({b["plano"] for b in barras if b["plano"]}),
            "cubicaron": [], "descr": (items[0].get("OrderDescr") or "")}


def _lados(xml: Optional[str]) -> dict:
    """Los lados de la barra, del XML de `LegAngle`, como texto corto para la tabla:
    `A=300 · B=11400 (90°) · C=300 ↱`. No se dibuja nada —el auditor sabe leer una
    barra—, pero ver los lados en la misma línea es lo que acelera la revisión."""
    if not xml:
        return {}
    import re as _re
    salida = {}
    for cp in _re.findall(r"<cp>(.*?)</cp>", str(xml)):
        nombre = (_re.search(r"<ln>(.*?)</ln>", cp) or [None, ""])[1] if _re.search(r"<ln>", cp) else ""
        largo = (_re.search(r"<l>(.*?)</l>", cp) or [None, ""])[1] if _re.search(r"<l>", cp) else ""
        ang = _re.search(r"<a>(.*?)</a>", cp)
        tipo = _re.search(r"<t>(.*?)</t>", cp)
        if not largo:
            continue
        texto = largo
        if ang:
            texto += " (%s°)" % ang.group(1)
        if tipo and tipo.group(1).upper().startswith("H"):
            texto += " ↱"      # gancho
        salida[nombre or str(len(salida) + 1)] = texto
    return salida


# ---------------------------------------------------------------------------
# LA AUDITORÍA: crear, listar, revisar, cerrar
# ---------------------------------------------------------------------------
class CrearBody(BaseModel):
    id_proyecto: str            # obra de ArmaHub, o el JobID de aSa si origen='asa'
    auditor: str
    origen: str = "armahub"
    n: int = MUESTRA_POR_DEFECTO
    # Alcance de ArmaHub
    sectores: List[str] = []
    pisos: List[str] = []
    ciclos: List[str] = []
    # Alcance de aSa: los códigos de control elegidos. Allá no hay sector/piso/ciclo.
    ccs: List[str] = []
    notas: Optional[str] = None


def _codigo(cur) -> str:
    """A-2026-001: el número que se dice en voz alta. Corre por año."""
    anio = _hoy().year
    cur.execute("SELECT COUNT(*) FROM auditorias WHERE EXTRACT(YEAR FROM creada_fecha) = %s", (anio,))
    return "A-%d-%03d" % (anio, (cur.fetchone()[0] or 0) + 1)


@router.post("/auditorias")
def crear(body: CrearBody, user=Depends(get_current_user)):
    """Crea la auditoría y GUARDA la muestra sorteada. A partir de acá la lista de
    elementos no cambia: es contra ésa que se audita."""
    _puede_auditar(user)
    email = user.get("email", "?")
    if body.origen not in ORIGENES:
        raise HTTPException(status_code=422, detail="Origen no válido: " + " / ".join(ORIGENES))
    es_asa = body.origen == "asa"
    with get_conn() as conn:
        with conn.cursor() as cur:
            if es_asa:
                # En aSa la obra es el JobID, y el nombre sale del espejo.
                cur.execute("""SELECT MAX(job_name) FROM asa_pedidos WHERE asa_job_id = %s
                                AND COALESCE(estado,'') <> 'Cancelled'""", (body.id_proyecto,))
                fila = cur.fetchone()
                if not fila or not fila[0]:
                    raise HTTPException(status_code=404, detail="Ese job no está en el espejo de aSa.")
                obra = fila[0]
                total, elementos, semilla, n = _sortear_asa(cur, body.id_proyecto, body.n, body.ccs, "")
                # El alcance de aSa son los códigos elegidos: van en su propia columna.
                alcance = ([], [], [])
            else:
                cur.execute("SELECT COALESCE(nombre_proyecto, id_proyecto) FROM proyectos WHERE id_proyecto = %s",
                            (body.id_proyecto,))
                fila = cur.fetchone()
                cur.execute("SELECT 1 FROM barras WHERE id_proyecto = %s LIMIT 1", (body.id_proyecto,))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="Esa obra no tiene barras en ArmaHub.")
                obra = fila[0] if fila else body.id_proyecto
                total, elementos, semilla, n = _sortear(
                    cur, body.id_proyecto, body.n, ",".join(body.sectores), ",".join(body.pisos),
                    ",".join(body.ciclos), "")
                alcance = (body.sectores, body.pisos, body.ciclos)
            hoy = _hoy()
            cur.execute(
                """INSERT INTO auditorias (codigo, id_proyecto, obra, auditor, origen, sectores, pisos, ciclos,
                                           n, total_rango, semilla, estado, creada_fecha, plazo_fecha,
                                           creada_por, notas, ccs)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'planificada',%s,%s,%s,%s,%s) RETURNING id""",
                (_codigo(cur), body.id_proyecto, obra, body.auditor, body.origen,
                 alcance[0], alcance[1], alcance[2], len(elementos), total, semilla, hoy,
                 _habiles(hoy, DIAS_PLAZO), email, body.notas, body.ccs if es_asa else []))
            aud_id = cur.fetchone()[0]
            cur.executemany(
                """INSERT INTO auditoria_elementos
                       (auditoria_id, cc, sector, piso, ciclo, eje, nombre, estructura, barras, kg, cubicado_por)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                [(aud_id, e.get("cc"), e["sector"], e["piso"], e["ciclo"], e["eje"], e["nombre"],
                  e["estructura"], e["barras"], e["kg"], e["cubicado_por"]) for e in elementos])
            audit(email, "auditoria_crear",
                  f"{body.origen} · {obra}: {len(elementos)} de {total}", "auditoria", str(aud_id))
    return detalle(aud_id, user)


@router.get("/auditorias")
def listar(id_proyecto: str = "", auditor: str = "", estado: str = "", limite: int = 100,
           user=Depends(get_current_user)):
    """La lista: estado, fechas y qué encontró cada una. El resumen por hallazgo se cuenta
    en la base, no en el navegador: es lo que se mira sin abrir nada."""
    where, params = ["1=1"], []
    for col, valor in (("a.id_proyecto", id_proyecto), ("a.auditor", auditor), ("a.estado", estado)):
        if valor:
            where.append(f"{col} = %s")
            params.append(valor)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""SELECT a.id, a.codigo, a.obra, a.id_proyecto, a.auditor, a.sectores, a.pisos, a.ciclos,
                           a.n, a.total_rango, a.estado, a.creada_fecha, a.plazo_fecha, a.inicio_fecha,
                           a.cierre_fecha, a.semilla, a.origen, a.ccs,
                           COUNT(e.id) FILTER (WHERE e.hallazgo IS NOT NULL) AS revisados,
                           COUNT(e.id) FILTER (WHERE e.hallazgo = 'conforme')    AS conforme,
                           COUNT(e.id) FILTER (WHERE e.hallazgo = 'observacion') AS observacion,
                           COUNT(e.id) FILTER (WHERE e.hallazgo = 'nc_menor')    AS nc_menor,
                           COUNT(e.id) FILTER (WHERE e.hallazgo = 'nc_mayor')    AS nc_mayor,
                           COUNT(e.id) FILTER (WHERE e.accion_estado = 'pendiente') AS acciones_abiertas,
                           COALESCE(SUM(e.kg), 0)
                      FROM auditorias a
                      LEFT JOIN auditoria_elementos e ON e.auditoria_id = a.id
                     WHERE {' AND '.join(where)}
                     GROUP BY a.id ORDER BY a.creada_fecha DESC, a.id DESC LIMIT %s""",
                params + [max(1, min(int(limite or 100), 500))])
            filas = [_fila_lista(r) for r in cur.fetchall()]
    return {"auditorias": filas}


def _fila_lista(r):
    return {"id": r[0], "codigo": r[1], "obra": r[2], "id_proyecto": r[3], "auditor": r[4],
            "sectores": r[5] or [], "pisos": r[6] or [], "ciclos": r[7] or [],
            "n": r[8], "total_rango": r[9], "estado": r[10],
            "creada": r[11].isoformat() if r[11] else None,
            "plazo": r[12].isoformat() if r[12] else None,
            "inicio": r[13].isoformat() if r[13] else None,
            "cierre": r[14].isoformat() if r[14] else None,
            "semilla": r[15], "origen": r[16], "ccs": r[17] or [], "revisados": r[18],
            "resultado": {"conforme": r[19], "observacion": r[20], "nc_menor": r[21], "nc_mayor": r[22]},
            "acciones_abiertas": r[23], "kg": float(r[24] or 0)}


@router.get("/auditorias/indicadores")
def indicadores(desde: str = "", hasta: str = "", user=Depends(get_current_user)):
    """LO QUE LA AUDITORÍA DEJA: conformidad por cubicador, por obra, por causa y por mes.
    Sin esto los hallazgos se registran y nadie los suma, que es la forma más común de
    que un sistema de calidad no sirva para nada.

    Sólo cuenta elementos REVISADOS: un elemento pendiente no es ni conforme ni no
    conforme, y meterlo en el denominador bajaría el porcentaje de quien aún no termina.
    La «conformidad» es conformes sobre revisados; una observación no es conformidad."""
    where, params = ["e.hallazgo IS NOT NULL"], []
    if desde:
        where.append("a.creada_fecha >= %s")
        params.append(desde)
    if hasta:
        where.append("a.creada_fecha <= %s")
        params.append(hasta)
    cond = " AND ".join(where)
    campos = ("COUNT(*) AS revisados,"
              " COUNT(*) FILTER (WHERE e.hallazgo = 'conforme')    AS conforme,"
              " COUNT(*) FILTER (WHERE e.hallazgo = 'observacion') AS observacion,"
              " COUNT(*) FILTER (WHERE e.hallazgo = 'nc_menor')    AS nc_menor,"
              " COUNT(*) FILTER (WHERE e.hallazgo = 'nc_mayor')    AS nc_mayor,"
              " COALESCE(SUM(e.kg), 0) AS kg")

    def arma(filas, clave):
        salida = []
        for r in filas:
            rev = r[1] or 0
            salida.append({clave: r[0], "revisados": rev, "conforme": r[2], "observacion": r[3],
                           "nc_menor": r[4], "nc_mayor": r[5], "kg": float(r[6] or 0),
                           "nc": (r[4] or 0) + (r[5] or 0),
                           "conformidad": round((r[2] or 0) / rev * 100) if rev else None})
        return salida

    with get_conn() as conn:
        with conn.cursor() as cur:
            base = f"FROM auditoria_elementos e JOIN auditorias a ON a.id = e.auditoria_id WHERE {cond}"
            cur.execute(f"SELECT COALESCE(e.cubicado_por,'(sin dato)'), {campos} {base} GROUP BY 1 ORDER BY 2 DESC", params)
            por_cubicador = arma(cur.fetchall(), "cubicador")
            cur.execute(f"SELECT a.obra, {campos} {base} GROUP BY 1 ORDER BY 2 DESC", params)
            por_obra = arma(cur.fetchall(), "obra")
            cur.execute(
                f"""SELECT TO_CHAR(a.creada_fecha, 'YYYY-MM'), {campos} {base} GROUP BY 1 ORDER BY 1""", params)
            por_mes = arma(cur.fetchall(), "mes")
            # El Pareto de causas: sólo las no conformidades, que son las que piden acción.
            cur.execute(
                f"""SELECT COALESCE(e.causa,'(sin causa)'), COUNT(*), COALESCE(SUM(e.kg),0)
                      {base} AND e.hallazgo IN ('nc_menor','nc_mayor')
                     GROUP BY 1 ORDER BY 2 DESC""", params)
            causas = [{"causa": r[0], "n": r[1], "kg": float(r[2] or 0)} for r in cur.fetchall()]
            cur.execute(f"SELECT 'total', {campos} {base}", params)
            total = (arma(cur.fetchall(), "x") or [{}])[0]
            cur.execute(
                f"""SELECT COUNT(*) FILTER (WHERE e.accion_estado = 'pendiente'),
                           COUNT(*) FILTER (WHERE e.accion_estado = 'corregida'),
                           COUNT(*) FILTER (WHERE e.accion_estado = 'verificada') {base}""", params)
            p, c, v = cur.fetchone()
            cur.execute(
                """SELECT COUNT(*), COUNT(*) FILTER (WHERE estado = 'cerrada') FROM auditorias a
                    WHERE (%s = '' OR a.creada_fecha >= %s::date) AND (%s = '' OR a.creada_fecha <= %s::date)""",
                (desde, desde or None, hasta, hasta or None))
            n_aud, n_cerradas = cur.fetchone()
    return {"desde": desde, "hasta": hasta, "total": total,
            "auditorias": n_aud, "cerradas": n_cerradas,
            "acciones": {"pendiente": p, "corregida": c, "verificada": v},
            "por_cubicador": por_cubicador, "por_obra": por_obra, "por_mes": por_mes,
            "causas": causas}


@router.get("/auditorias/cobertura")
def cobertura(id_proyecto: str, origen: str = "armahub", user=Depends(get_current_user)):
    """CUÁNTO DE LA OBRA SE HA AUDITADO, y qué falta. Lista TODO y marca lo auditado.

    Es la pregunta que no responde una auditoría suelta: «¿qué parte de esta obra ya se
    miró?». Sin esto se puede auditar tres veces el mismo sector y nunca el resto.

    Las dos fuentes no se miden igual, y decirlo importa:
      · ArmaHub: la unidad es el ELEMENTO (sector·piso·ciclo·eje) y se conocen todos,
        así que el porcentaje es exacto.
      · aSa: los elementos sólo se conocen pidiéndolos código a código, y eso tarda
        segundos por código. Así que la unidad es el CÓDIGO DE CONTROL: se informa
        cuántos tienen al menos un elemento auditado. Es más grueso, y se dice."""
    if origen not in ORIGENES:
        raise HTTPException(status_code=422, detail="Origen no válido.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT COALESCE(e.cc,''), e.sector, e.piso, e.ciclo, e.eje, e.hallazgo,
                          a.codigo, e.nombre
                     FROM auditoria_elementos e JOIN auditorias a ON a.id = e.auditoria_id
                    WHERE a.id_proyecto = %s""", (id_proyecto,))
            auditados = {(r[0], r[1], r[2], r[3], r[4]): {"hallazgo": r[5], "auditoria": r[6],
                                                          "nombre": r[7]} for r in cur.fetchall()}
            filas = []
            if origen == "asa":
                cur.execute(
                    """SELECT control_code, COALESCE(descr,''), kg, COALESCE(estado,''),
                              COALESCE(detail_person,'')
                         FROM asa_pedidos
                        WHERE asa_job_id = %s AND COALESCE(estado,'') <> %s AND job_name !~* %s
                        ORDER BY order_date DESC NULLS LAST, control_code""",
                    (id_proyecto, ESTADO_NUNCA, PATRON_OBRAS_FUERA))
                por_cc: dict = {}
                for clave, info in auditados.items():
                    por_cc.setdefault(clave[0], []).append(info)
                for r in cur.fetchall():
                    vistos = por_cc.get(r[0], [])
                    filas.append({"clave": r[0], "nombre": r[1] or r[0], "kg": float(r[2] or 0),
                                  "estado": r[3], "quien": r[4], "auditados": len(vistos),
                                  "hallazgos": [v["hallazgo"] for v in vistos if v["hallazgo"]],
                                  "auditorias": sorted({v["auditoria"] for v in vistos})})
                unidad = "código de control"
            else:
                cur.execute(
                    f"""SELECT sector, piso, ciclo, eje, MAX(INITCAP(estructura)), COUNT(*),
                               COALESCE(SUM(peso_total),0),
                               STRING_AGG(DISTINCT COALESCE(creado_por, editado_por, '?'), ', ')
                          FROM barras WHERE id_proyecto = %s
                         GROUP BY 1,2,3,4 ORDER BY 1,2,3,4""", (id_proyecto,))
                for r in cur.fetchall():
                    info = auditados.get(("", r[0] or "", r[1] or "", r[2] or "", r[3] or ""))
                    nombre = " · ".join(x for x in (r[4] or SECTORES.get(r[0] or "", ""),
                                                    ("Eje " + r[3]) if r[3] else "", r[1], r[2]) if x)
                    filas.append({"clave": "|".join([r[0] or "", r[1] or "", r[2] or "", r[3] or ""]),
                                  "nombre": nombre, "kg": float(r[6] or 0), "estado": "",
                                  "quien": r[7], "barras": r[5],
                                  "auditados": 1 if info else 0,
                                  "hallazgos": [info["hallazgo"]] if info and info["hallazgo"] else [],
                                  "auditorias": [info["auditoria"]] if info else []})
                unidad = "elemento"
    total = len(filas)
    con = sum(1 for f in filas if f["auditados"])
    kg_total = sum(f["kg"] for f in filas)
    kg_con = sum(f["kg"] for f in filas if f["auditados"])
    return {"id_proyecto": id_proyecto, "origen": origen, "unidad": unidad,
            "total": total, "auditados": con,
            "pct": round(con / total * 100) if total else 0,
            "kg": kg_total, "kg_auditados": kg_con,
            "pct_kg": round(kg_con / kg_total * 100) if kg_total else 0,
            "filas": filas}


@router.get("/auditorias/{auditoria_id}")
def detalle(auditoria_id: int, user=Depends(get_current_user)):
    """La auditoría con su muestra, elemento por elemento y con su hallazgo."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT a.id, a.codigo, a.obra, a.id_proyecto, a.auditor, a.sectores, a.pisos, a.ciclos,
                          a.n, a.total_rango, a.estado, a.creada_fecha, a.plazo_fecha, a.inicio_fecha,
                          a.cierre_fecha, a.semilla, a.origen, a.ccs,
                          COUNT(e.id) FILTER (WHERE e.hallazgo IS NOT NULL),
                          COUNT(e.id) FILTER (WHERE e.hallazgo = 'conforme'),
                          COUNT(e.id) FILTER (WHERE e.hallazgo = 'observacion'),
                          COUNT(e.id) FILTER (WHERE e.hallazgo = 'nc_menor'),
                          COUNT(e.id) FILTER (WHERE e.hallazgo = 'nc_mayor'),
                          COUNT(e.id) FILTER (WHERE e.accion_estado = 'pendiente'),
                          COALESCE(SUM(e.kg), 0), a.notas, a.creada_por
                     FROM auditorias a
                     LEFT JOIN auditoria_elementos e ON e.auditoria_id = a.id
                    WHERE a.id = %s GROUP BY a.id""", (auditoria_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Auditoría no encontrada.")
            aud = _fila_lista(r)
            aud["notas"] = r[25]
            aud["creada_por"] = r[26]
            cur.execute(
                """SELECT e.id, e.sector, e.piso, e.ciclo, e.eje, e.nombre, e.estructura, e.barras,
                          e.kg, e.cubicado_por, e.hallazgo, e.texto, e.causa, e.revisado_por,
                          e.revisado_el, e.accion_estado, e.accion_por, e.accion_el, e.accion_nota, e.cc,
                          (SELECT COUNT(*) FROM auditoria_items i WHERE i.elemento_id = e.id),
                          (SELECT COUNT(*) FROM auditoria_items i
                            WHERE i.elemento_id = e.id AND i.conforme IS FALSE)
                     FROM auditoria_elementos e WHERE e.auditoria_id = %s ORDER BY e.id""", (auditoria_id,))
            aud["elementos"] = [
                {"id": e[0], "cc": e[19], "sector": e[1], "piso": e[2], "ciclo": e[3], "eje": e[4], "nombre": e[5],
                 "estructura": e[6], "barras": e[7], "kg": float(e[8] or 0), "cubicado_por": e[9],
                 "tipo": SECTORES.get(e[1] or "", e[1]),
                 "hallazgo": e[10], "texto": e[11], "causa": e[12],
                 "revisado_por": e[13], "revisado_el": e[14].isoformat() if e[14] else None,
                 "accion_estado": e[15], "accion_por": e[16],
                 "accion_el": e[17].isoformat() if e[17] else None, "accion_nota": e[18],
                 "items": e[20], "items_malos": e[21],
                 # INDEPENDENCIA: no se bloquea, se avisa. Bloquear sería inútil en una
                 # obra que cubicó una sola persona; lo que importa es que se vea.
                 "conflicto": bool(e[9] and aud["auditor"] and aud["auditor"] in (e[9] or ""))}
                for e in cur.fetchall()]
    # La cobertura de la OBRA (todas sus auditorías), no sólo la de ésta: es lo que
    # responde «qué falta por mirar».
    try:
        aud["cobertura"] = cobertura(aud["id_proyecto"], aud.get("origen") or "armahub", user)
    except HTTPException:
        aud["cobertura"] = None
    return aud


class HallazgoBody(BaseModel):
    hallazgo: str
    texto: Optional[str] = None
    causa: Optional[str] = None


@router.put("/auditorias/{auditoria_id}/elementos/{elemento_id}")
def registrar_hallazgo(auditoria_id: int, elemento_id: int, body: HallazgoBody,
                       user=Depends(get_current_user)):
    """Registra el hallazgo de UN elemento. Si no es conforme exige decir qué se encontró
    —un hallazgo sin texto no sirve de evidencia— y abre la acción para quien cubicó.
    Después recalcula el estado y las fechas de la auditoría: nadie las escribe."""
    _puede_auditar(user)
    email = user.get("email", "?")
    if body.hallazgo not in HALLAZGOS:
        raise HTTPException(status_code=422, detail="Hallazgo no válido: " + " / ".join(HALLAZGOS))
    texto = (body.texto or "").strip()
    if body.hallazgo != "conforme" and not texto:
        raise HTTPException(status_code=400, detail="Di qué encontraste: un hallazgo sin texto no es evidencia.")
    es_nc = body.hallazgo in ("nc_menor", "nc_mayor")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT e.nombre, e.cubicado_por, e.accion_estado, a.codigo, a.obra, a.n
                     FROM auditoria_elementos e JOIN auditorias a ON a.id = e.auditoria_id
                    WHERE e.id = %s AND e.auditoria_id = %s""", (elemento_id, auditoria_id))
            el = cur.fetchone()
            if not el:
                raise HTTPException(status_code=404, detail="Ese elemento no es de esta auditoría.")
            nombre, cubico, accion_previa, codigo, obra, _n = el
            # La acción nace con la NC y se va si el hallazgo deja de serlo. Lo ya
            # verificado no se pisa: sería borrar el trabajo del cubicador.
            accion = None
            if es_nc:
                accion = accion_previa if accion_previa in ("corregida", "verificada") else "pendiente"
            cur.execute(
                """UPDATE auditoria_elementos
                      SET hallazgo = %s, texto = %s, causa = %s, revisado_por = %s, revisado_el = now(),
                          accion_estado = %s
                    WHERE id = %s""",
                (body.hallazgo, texto or None, (body.causa or None) if body.hallazgo != "conforme" else None,
                 email, accion, elemento_id))
            _recalcular(cur, auditoria_id)
            audit(email, "auditoria_hallazgo", f"{codigo} · {nombre}: {body.hallazgo}", "auditoria", str(auditoria_id))
    # La acción le llega a quien cubicó. Fuera de la transacción: que falle el aviso no
    # puede deshacer el hallazgo.
    if es_nc and cubico and accion_previa != "verificada":
        _avisar(cubico, f"Auditoría {codigo} · {obra}: {_NOMBRE[body.hallazgo]} en {nombre}. {texto[:120]}")
    return detalle(auditoria_id, user)


_NOMBRE = {"conforme": "Conforme", "observacion": "Observación",
           "nc_menor": "No conformidad menor", "nc_mayor": "No conformidad mayor"}


def _avisar(destinatario: str, mensaje: str):
    """Aviso en la campana. `reclamo_id` va NULL: esto no es un reclamo (el front ya
    tolera notificaciones sin reclamo asociado)."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO notificaciones (destinatario, tipo_evento, reclamo_id, mensaje, fecha)
                       VALUES (%s, 'auditoria_accion', NULL, %s, %s)""",
                    (destinatario, mensaje, datetime.now(timezone.utc).isoformat()))
    except Exception:
        pass


def _recalcular(cur, auditoria_id: int):
    """El estado y las fechas se DERIVAN de los hallazgos, en la base y no en el front."""
    cur.execute(
        """SELECT COUNT(*), COUNT(*) FILTER (WHERE hallazgo IS NOT NULL)
             FROM auditoria_elementos WHERE auditoria_id = %s""", (auditoria_id,))
    total, revisados = cur.fetchone()
    estado = estado_de(revisados, total)
    cur.execute(
        """UPDATE auditorias
              SET estado = %s,
                  inicio_fecha = CASE WHEN %s > 0 THEN COALESCE(inicio_fecha, CURRENT_DATE) ELSE NULL END,
                  cierre_fecha = CASE WHEN %s = 'cerrada' THEN COALESCE(cierre_fecha, CURRENT_DATE) ELSE NULL END
            WHERE id = %s""", (estado, revisados, estado, auditoria_id))


class AccionBody(BaseModel):
    estado: str
    nota: Optional[str] = None


class ItemBody(BaseModel):
    ref: str
    marca: Optional[str] = None
    conforme: bool
    observacion: Optional[str] = None


class RevisionBody(BaseModel):
    """La revisión de UN elemento: el veredicto de cada barra y la severidad del conjunto."""
    items: List[ItemBody] = []
    hallazgo: Optional[str] = None     # severidad; si no viene, se deriva de las barras
    causa: Optional[str] = None
    texto: Optional[str] = None        # opcional: lo que se encontró ya está en las barras


def severidad_derivada(items, severidad: Optional[str]) -> str:
    """El hallazgo DEL ELEMENTO a partir de sus barras. Si todas están conformes es
    conforme y no hay severidad que elegir; si alguna no lo está, manda lo que dijo el
    auditor y, si no dijo nada, se asume la no conformidad menor —nunca se suaviza a
    «observación» por omisión, porque eso borraría la acción—. Función pura."""
    if not items:
        return severidad or "conforme"
    if all(getattr(i, "conforme", None) if not isinstance(i, dict) else i.get("conforme") for i in items):
        return "conforme"
    if severidad in ("observacion", "nc_menor", "nc_mayor"):
        return severidad
    return "nc_menor"


@router.put("/auditorias/{auditoria_id}/elementos/{elemento_id}/revision")
def guardar_revision(auditoria_id: int, elemento_id: int, body: RevisionBody,
                     user=Depends(get_current_user)):
    """Guarda la revisión completa de un elemento: cada barra con su veredicto y, si hay
    alguna no conforme, la severidad y la causa del conjunto.

    Una barra NO conforme EXIGE decir qué tiene: sin eso no es evidencia, y el cubicador
    no sabría qué corregir."""
    _puede_auditar(user)
    email = user.get("email", "?")
    for it in body.items:
        if not it.conforme and not (it.observacion or "").strip():
            raise HTTPException(status_code=400,
                                detail="La barra %s está marcada no conforme: di qué tiene." % it.ref)
    hallazgo = severidad_derivada(body.items, body.hallazgo)
    if hallazgo not in HALLAZGOS:
        raise HTTPException(status_code=422, detail="Hallazgo no válido: " + " / ".join(HALLAZGOS))
    malas = [it for it in body.items if not it.conforme]
    # El texto del elemento se arma de las barras si el auditor no escribió uno: el
    # informe necesita una línea que se entienda sin abrir el detalle.
    texto = (body.texto or "").strip() or " · ".join(
        "%s: %s" % (it.ref, (it.observacion or "").strip()) for it in malas)[:1000]
    if hallazgo != "conforme" and not texto:
        raise HTTPException(status_code=400, detail="Di qué encontraste: un hallazgo sin texto no es evidencia.")
    es_nc = hallazgo in ("nc_menor", "nc_mayor")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT e.nombre, e.cubicado_por, e.accion_estado, a.codigo, a.obra
                     FROM auditoria_elementos e JOIN auditorias a ON a.id = e.auditoria_id
                    WHERE e.id = %s AND e.auditoria_id = %s""", (elemento_id, auditoria_id))
            el = cur.fetchone()
            if not el:
                raise HTTPException(status_code=404, detail="Ese elemento no es de esta auditoría.")
            nombre, cubico, accion_previa, codigo, obra = el
            if body.items:
                cur.executemany(
                    """INSERT INTO auditoria_items (elemento_id, ref, marca, conforme, observacion,
                                                    revisado_por, revisado_el)
                       VALUES (%s,%s,%s,%s,%s,%s, now())
                       ON CONFLICT (elemento_id, ref) DO UPDATE SET
                           marca = EXCLUDED.marca, conforme = EXCLUDED.conforme,
                           observacion = EXCLUDED.observacion, revisado_por = EXCLUDED.revisado_por,
                           revisado_el = now()""",
                    [(elemento_id, it.ref, it.marca, it.conforme,
                      (it.observacion or "").strip() or None, email) for it in body.items])
            accion = None
            if es_nc:
                accion = accion_previa if accion_previa in ("corregida", "verificada") else "pendiente"
            cur.execute(
                """UPDATE auditoria_elementos
                      SET hallazgo = %s, texto = %s, causa = %s, revisado_por = %s, revisado_el = now(),
                          accion_estado = %s
                    WHERE id = %s""",
                (hallazgo, texto or None, (body.causa or None) if hallazgo != "conforme" else None,
                 email, accion, elemento_id))
            _recalcular(cur, auditoria_id)
            audit(email, "auditoria_revision",
                  "%s · %s: %s (%d barras, %d no conformes)" % (codigo, nombre, hallazgo,
                                                                len(body.items), len(malas)),
                  "auditoria", str(auditoria_id))
    if es_nc and cubico and accion_previa != "verificada":
        _avisar(cubico, "Auditoría %s · %s: %s en %s. %s" % (codigo, obra, _NOMBRE[hallazgo], nombre, texto[:120]))
    return detalle(auditoria_id, user)


@router.put("/auditorias/{auditoria_id}/elementos/{elemento_id}/accion")
def mover_accion(auditoria_id: int, elemento_id: int, body: AccionBody, user=Depends(get_current_user)):
    """Mueve la acción: el cubicador la marca CORREGIDA (en su cubicación, no acá) y el
    auditor la da por VERIFICADA. Verificar es del auditor: si pudiera hacerlo el mismo
    que corrigió, la verificación no verificaría nada."""
    email = user.get("email", "?")
    if body.estado not in ACCIONES:
        raise HTTPException(status_code=422, detail="Estado no válido: " + " / ".join(ACCIONES))
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT e.accion_estado, e.cubicado_por, e.nombre, a.auditor, a.codigo
                     FROM auditoria_elementos e JOIN auditorias a ON a.id = e.auditoria_id
                    WHERE e.id = %s AND e.auditoria_id = %s""", (elemento_id, auditoria_id))
            fila = cur.fetchone()
            if not fila:
                raise HTTPException(status_code=404, detail="Ese elemento no es de esta auditoría.")
            actual, cubico, nombre, auditor, codigo = fila
            if actual is None:
                raise HTTPException(status_code=400, detail="Ese elemento no tiene una no conformidad.")
            es_admin = user.get("role") in ("admin", "admin_calidad")
            if body.estado == "verificada" and email != auditor and not es_admin:
                raise HTTPException(status_code=403, detail="Verificar es del auditor de esta auditoría.")
            cur.execute(
                """UPDATE auditoria_elementos SET accion_estado = %s, accion_por = %s,
                          accion_el = now(), accion_nota = %s WHERE id = %s""",
                (body.estado, email, (body.nota or "").strip() or None, elemento_id))
            audit(email, "auditoria_accion", f"{codigo} · {nombre}: {body.estado}", "auditoria", str(auditoria_id))
    if body.estado == "corregida" and auditor:
        _avisar(auditor, f"Auditoría {codigo}: {nombre} fue corregida. Falta verificar.")
    return detalle(auditoria_id, user)


@router.get("/auditorias/mias/acciones")
def mis_acciones(user=Depends(get_current_user)):
    """Lo que le toca corregir a quien pregunta: sus no conformidades abiertas."""
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT a.id, a.codigo, a.obra, e.id, e.nombre, e.hallazgo, e.texto, e.causa,
                          e.accion_estado, a.plazo_fecha, a.auditor
                     FROM auditoria_elementos e JOIN auditorias a ON a.id = e.auditoria_id
                    WHERE e.cubicado_por ILIKE %s AND e.accion_estado IS NOT NULL
                    ORDER BY (e.accion_estado = 'verificada'), a.plazo_fecha""", ("%" + email + "%",))
            filas = [{"auditoria_id": r[0], "codigo": r[1], "obra": r[2], "elemento_id": r[3],
                      "elemento": r[4], "hallazgo": r[5], "texto": r[6], "causa": r[7],
                      "accion_estado": r[8], "plazo": r[9].isoformat() if r[9] else None,
                      "auditor": r[10]} for r in cur.fetchall()]
    return {"acciones": filas}


@router.get("/auditorias/{auditoria_id}/pdf")
def informe_pdf(auditoria_id: int, user=Depends(get_current_user)):
    """El informe de la auditoría, para mandar o archivar. Una página cuando cabe."""
    from fastapi import Response
    aud = detalle(auditoria_id, user)
    pdf = _InformePDF(aud).build()
    audit(user.get("email", "?"), "auditoria_pdf", aud["codigo"], "auditoria", str(auditoria_id))
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'inline; filename="%s.pdf"' % aud["codigo"]})


class _InformePDF:
    """EL INFORME DE AUDITORÍA, en el orden que pide la ISO 19011: qué se auditó (alcance
    y muestra), qué se encontró (hallazgos), qué hay que hacer (acciones) y la conclusión.
    Mismo motor que el informe de reclamos (fpdf2, fuentes integradas)."""

    COLOR = {"conforme": (139, 195, 74), "observacion": (255, 183, 77),
             "nc_menor": (239, 154, 154), "nc_mayor": (198, 40, 40)}
    NOMBRE = {"conforme": "Conforme", "observacion": "Observacion",
              "nc_menor": "No conformidad menor", "nc_mayor": "No conformidad mayor"}

    def __init__(self, aud):
        from fpdf import FPDF
        self.a = aud
        self.pdf = FPDF(orientation="P", unit="mm", format="A4")
        self.pdf.set_auto_page_break(auto=True, margin=16)
        self.pdf.add_page()
        self.pdf.set_margins(15, 15, 15)
        self.w = 180

    @staticmethod
    def _s(t):
        """Las fuentes integradas de fpdf2 son Latin-1: lo que no entra se reemplaza en vez
        de reventar el informe."""
        if t is None:
            return ""
        t = str(t)
        for a, b in (("→", "->"), ("—", "-"), ("–", "-"), ("·", "-"),
                     ("…", "..."), ("↱", "(gancho)"), ("’", "'")):
            t = t.replace(a, b)
        return t.encode("latin-1", "replace").decode("latin-1")

    def build(self) -> bytes:
        import io
        self._encabezado()
        self._ficha()
        self._resultado()
        self._hallazgos()
        self._acciones()
        self._cobertura()
        self._conclusion()
        buf = io.BytesIO()
        self.pdf.output(buf)
        buf.seek(0)
        return buf.read()

    def _titulo(self, texto, color=(21, 101, 192)):
        p = self.pdf
        p.ln(2)
        p.set_font("Helvetica", "B", 10)
        p.set_text_color(*color)
        p.cell(0, 6, self._s(texto), new_x="LMARGIN", new_y="NEXT")
        p.set_text_color(40, 40, 40)

    def _encabezado(self):
        p, a = self.pdf, self.a
        p.set_font("Helvetica", "B", 16)
        p.set_text_color(21, 101, 192)
        p.cell(0, 9, self._s("Informe de auditoria %s" % a["codigo"]), new_x="LMARGIN", new_y="NEXT")
        p.set_font("Helvetica", "", 10)
        p.set_text_color(90, 90, 90)
        p.cell(0, 5, self._s("%s   -   auditoria de cubicacion" % a["obra"]), new_x="LMARGIN", new_y="NEXT")
        p.set_draw_color(21, 101, 192)
        p.line(15, p.get_y() + 1, 195, p.get_y() + 1)
        p.ln(3)
        p.set_text_color(40, 40, 40)

    def _ficha(self):
        p, a = self.pdf, self.a
        self._titulo("1. Alcance y muestra")
        datos = [
            ("Obra", a["obra"]),
            ("Origen de la muestra", "ArmaHub (barras en el sistema)" if a.get("origen") != "asa" else "aSa (items del pedido)"),
            ("Alcance", self._alcance()),
            ("Muestra", "%d elementos de %d en el alcance (semilla %s)" % (a["n"], a["total_rango"], a["semilla"])),
            ("Audita", a["auditor"]),
            ("Fechas", "creada %s - plazo %s - inicio %s - cierre %s" % (
                a["creada"] or "-", a["plazo"] or "-", a["inicio"] or "-", a["cierre"] or "-")),
            ("Estado", {"planificada": "Planificada", "en_curso": "En curso", "cerrada": "Cerrada"}.get(a["estado"], a["estado"])),
        ]
        p.set_font("Helvetica", "", 9)
        for k, v in datos:
            p.set_font("Helvetica", "B", 9)
            p.cell(42, 5, self._s(k), border=0)
            p.set_font("Helvetica", "", 9)
            p.multi_cell(self.w - 42, 5, self._s(v), new_x="LMARGIN", new_y="NEXT")

    def _alcance(self):
        a = self.a
        if a.get("origen") == "asa":
            partes = [", ".join(a.get("sectores") or []) or "todos los anios",
                      ", ".join(a.get("pisos") or []) or "todos los estados",
                      ", ".join(a.get("ciclos") or []) or "todos los cubicadores"]
        else:
            partes = [", ".join(a.get("sectores") or []) or "todos los tipos",
                      ", ".join(a.get("pisos") or []) or "todos los pisos",
                      ", ".join(a.get("ciclos") or []) or "todos los ciclos"]
        return " - ".join(partes)

    def _resultado(self):
        p, a = self.pdf, self.a
        r = a.get("resultado") or {}
        self._titulo("2. Resultado")
        p.set_font("Helvetica", "", 9)
        rev = a.get("revisados") or 0
        if not rev:
            p.cell(0, 5, self._s("Sin elementos revisados todavia."), new_x="LMARGIN", new_y="NEXT")
            return
        for k in ("conforme", "observacion", "nc_menor", "nc_mayor"):
            n = r.get(k) or 0
            p.set_fill_color(*self.COLOR[k])
            p.cell(4, 5, "", fill=True, border=0)
            p.set_font("Helvetica", "B" if k.startswith("nc") and n else "", 9)
            p.cell(52, 5, self._s("  " + self.NOMBRE[k]), border=0)
            p.cell(16, 5, self._s("%d" % n), border=0, align="R")
            p.cell(16, 5, self._s("%d%%" % round(n / rev * 100)), border=0, align="R")
            # Barra proporcional, que es lo que se mira antes que el número.
            ancho = max(0.4, (n / rev) * 80) if n else 0
            if ancho:
                p.set_fill_color(*self.COLOR[k])
                p.cell(ancho, 4, "", fill=True, border=0)
            p.ln(5)
        p.ln(1)
        p.set_font("Helvetica", "", 8)
        p.set_text_color(110, 110, 110)
        p.cell(0, 4, self._s("Revisados %d de %d elementos de la muestra." % (rev, a["n"])),
               new_x="LMARGIN", new_y="NEXT")
        p.set_text_color(40, 40, 40)

    def _hallazgos(self):
        p, a = self.pdf, self.a
        # Primero lo que importa: las no conformidades, después las observaciones.
        orden = {"nc_mayor": 0, "nc_menor": 1, "observacion": 2, "conforme": 3, None: 4}
        els = sorted(a.get("elementos") or [], key=lambda e: (orden.get(e.get("hallazgo"), 4), e["nombre"]))
        con = [e for e in els if e.get("hallazgo") and e["hallazgo"] != "conforme"]
        self._titulo("3. Hallazgos")
        if not con:
            p.set_font("Helvetica", "", 9)
            p.cell(0, 5, self._s("Sin observaciones ni no conformidades en la muestra revisada."),
                   new_x="LMARGIN", new_y="NEXT")
        for e in con:
            p.set_fill_color(*self.COLOR[e["hallazgo"]])
            p.cell(3, 5, "", fill=True, border=0)
            p.set_font("Helvetica", "B", 9)
            p.cell(0, 5, self._s("  %s - %s" % (self.NOMBRE[e["hallazgo"]], e["nombre"])),
                   new_x="LMARGIN", new_y="NEXT")
            p.set_font("Helvetica", "", 9)
            p.set_x(18)
            p.multi_cell(self.w - 3, 4.5, self._s(e.get("texto") or ""), new_x="LMARGIN", new_y="NEXT")
            pie = []
            if e.get("causa"):
                pie.append("causa %s" % e["causa"])
            if e.get("cubicado_por"):
                pie.append("cubico %s" % e["cubicado_por"])
            if e.get("revisado_el"):
                pie.append("revisado %s" % str(e["revisado_el"])[:10])
            if pie:
                p.set_x(18)
                p.set_font("Helvetica", "I", 8)
                p.set_text_color(110, 110, 110)
                p.cell(0, 4, self._s(" - ".join(pie)), new_x="LMARGIN", new_y="NEXT")
                p.set_text_color(40, 40, 40)
            p.ln(1)

    def _acciones(self):
        p, a = self.pdf, self.a
        acc = [e for e in (a.get("elementos") or []) if e.get("accion_estado")]
        if not acc:
            return
        self._titulo("4. Acciones")
        p.set_font("Helvetica", "", 8)
        p.set_text_color(110, 110, 110)
        p.multi_cell(self.w, 4, self._s(
            "La correccion la ejecuta quien cubico, en su cubicacion; el auditor verifica. "
            "Una accion no se cierra sola."), new_x="LMARGIN", new_y="NEXT")
        p.set_text_color(40, 40, 40)
        p.set_font("Helvetica", "B", 8)
        for t, w in (("Elemento", 74), ("Responsable", 50), ("Estado", 26), ("Fecha", 30)):
            p.cell(w, 5, self._s(t), border="B")
        p.ln(5)
        p.set_font("Helvetica", "", 8)
        for e in acc:
            p.cell(74, 5, self._s(e["nombre"][:44]), border=0)
            p.cell(50, 5, self._s((e.get("cubicado_por") or "")[:32]), border=0)
            p.cell(26, 5, self._s({"pendiente": "Pendiente", "corregida": "Corregida",
                                   "verificada": "Verificada"}.get(e["accion_estado"], "")), border=0)
            p.cell(30, 5, self._s(str(e.get("accion_el") or "")[:10]), border=0)
            p.ln(5)

    def _cobertura(self):
        c = self.a.get("cobertura")
        if not c or not c.get("total"):
            return
        p = self.pdf
        self._titulo("5. Cobertura de la obra")
        p.set_font("Helvetica", "", 9)
        p.multi_cell(self.w, 5, self._s(
            "Contando TODAS las auditorias de esta obra, se ha revisado %d de %d %s(s) (%d%%), "
            "equivalentes al %d%% de los kilos. El resto no se ha mirado." % (
                c["auditados"], c["total"], c["unidad"], c["pct"], c["pct_kg"])),
            new_x="LMARGIN", new_y="NEXT")
        # Barra de cobertura: se lee antes que el numero.
        p.set_fill_color(236, 239, 241)
        p.cell(self.w, 4, "", fill=True, border=0, new_x="LMARGIN", new_y="NEXT")
        if c["pct"]:
            p.set_y(p.get_y() - 4)
            p.set_fill_color(21, 101, 192)
            p.cell(max(0.5, self.w * c["pct"] / 100), 4, "", fill=True, border=0, new_x="LMARGIN", new_y="NEXT")
        p.ln(1)

    def _conclusion(self):
        p, a = self.pdf, self.a
        r = a.get("resultado") or {}
        rev = a.get("revisados") or 0
        self._titulo("6. Conclusion")
        p.set_font("Helvetica", "", 9)
        if not rev:
            texto = "La auditoria esta planificada y todavia no se revisa ningun elemento."
        else:
            nc = (r.get("nc_menor") or 0) + (r.get("nc_mayor") or 0)
            conf = round((r.get("conforme") or 0) / rev * 100)
            texto = ("Se revisaron %d elementos de la muestra. Conformidad %d%%. "
                     "%s" % (rev, conf,
                             ("Se detectaron %d no conformidad(es), con su accion asignada." % nc) if nc
                             else "No se detectaron no conformidades."))
            if a["estado"] != "cerrada":
                texto += " La auditoria sigue abierta."
        p.multi_cell(self.w, 5, self._s(texto), new_x="LMARGIN", new_y="NEXT")
        p.ln(3)
        p.set_font("Helvetica", "I", 7)
        p.set_text_color(130, 130, 130)
        p.multi_cell(self.w, 3.5, self._s(
            "Generado por ArmaHub el %s. Muestra sorteada al azar dentro del alcance (semilla %s), "
            "reproducible. Terminologia segun ISO 19011." % (
                datetime.now(timezone.utc).strftime("%d-%m-%Y %H:%M UTC"), a["semilla"])),
            new_x="LMARGIN", new_y="NEXT")


@router.delete("/auditorias/{auditoria_id}")
def borrar(auditoria_id: int, user=Depends(get_current_user)):
    """Borra una auditoría. Sólo si NADIE la revisó todavía: una auditoría con hallazgos
    es un registro de calidad y no se borra — si se levantó por error, se deja cerrada
    con su nota. Admin puede borrar igual."""
    email = user.get("email", "?")
    es_admin = user.get("role") in ("admin", "admin_calidad")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT a.codigo, a.creada_por,
                          (SELECT COUNT(*) FROM auditoria_elementos e
                            WHERE e.auditoria_id = a.id AND e.hallazgo IS NOT NULL)
                     FROM auditorias a WHERE a.id = %s""", (auditoria_id,))
            fila = cur.fetchone()
            if not fila:
                raise HTTPException(status_code=404, detail="Auditoría no encontrada.")
            codigo, creada_por, revisados = fila
            if revisados and not es_admin:
                raise HTTPException(status_code=409,
                                    detail=f"Ya tiene {revisados} elemento(s) revisados: una auditoría con hallazgos no se borra.")
            if creada_por != email and not es_admin:
                raise HTTPException(status_code=403, detail="Sólo quien la creó o administración puede borrarla.")
            cur.execute("DELETE FROM auditorias WHERE id = %s", (auditoria_id,))
            audit(email, "auditoria_borrar", codigo, "auditoria", str(auditoria_id))
    return {"ok": True}
