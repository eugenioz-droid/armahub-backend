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
            cur.execute(
                """SELECT p.job_name, MAX(p.asa_job_id), COUNT(*), COALESCE(SUM(p.kg), 0),
                          MAX(GREATEST(p.order_date, p.proj_ship_date))
                     FROM asa_pedidos p
                    WHERE COALESCE(p.estado,'') <> 'Cancelled'
                      AND p.job_name !~* %s
                      AND GREATEST(p.order_date, p.proj_ship_date) >= CURRENT_DATE - make_interval(months => 12)
                      AND NOT EXISTS (SELECT 1 FROM proyectos pr
                                       WHERE pr.asa_job_id = p.asa_job_id
                                         AND EXISTS (SELECT 1 FROM barras b WHERE b.id_proyecto = pr.id_proyecto))
                    GROUP BY p.job_name ORDER BY p.job_name""",
                (PATRON_OBRAS_FUERA,))
            asa_obras = [{"job": r[1], "obra": r[0], "cc": r[2], "kg": float(r[3] or 0),
                          "ultimo": r[4].isoformat() if r[4] else None} for r in cur.fetchall()]
    return {"obras": lista, "obras_asa": asa_obras, "auditores": auditores, "sectores": SECTORES,
            "estados": list(ESTADOS), "hallazgos": list(HALLAZGOS), "acciones": list(ACCIONES),
            "causas": causas, "muestra_por_defecto": MUESTRA_POR_DEFECTO, "dias_plazo": DIAS_PLAZO}


@router.get("/auditorias/elemento")
def elemento(id_proyecto: str, sector: str = "", piso: str = "", ciclo: str = "", eje: str = "",
             user=Depends(get_current_user)):
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
    return {"id_proyecto": id_proyecto, "sector": sector, "piso": piso, "ciclo": ciclo, "eje": eje,
            "barras": barras, "n": len(barras),
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
        params + [semilla, n])
    elementos = [
        {"sector": r[0] or "", "tipo": SECTORES.get(r[0] or "", r[0]), "piso": r[1] or "",
         "ciclo": r[2] or "", "eje": r[3] or "", "estructura": r[4], "barras": r[5],
         "kg": float(r[6] or 0), "cubicado_por": r[7],
         "nombre": " · ".join(x for x in (r[4] or SECTORES.get(r[0] or "", ""),
                                           ("Eje " + r[3]) if r[3] else "", r[1], r[2]) if x)}
        for r in cur.fetchall()]
    return total, elementos, semilla, n


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


@router.get("/auditorias/universo-asa")
def universo_asa(job: str, user=Depends(get_current_user)):
    """De qué está hecha una obra EN aSa, para armar el alcance. Acá no hay sector ni piso
    ni ciclo —aSa no los tiene: el sector va como texto libre en la descripción—, así que
    el alcance es por año, estado y quién cubicó, más el buscador libre. Se mide: del
    texto del CC sólo se reconoce el piso en el 27% y el eje en el 2%, así que clasificar
    automáticamente sería inventar."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT anio, COUNT(*), COALESCE(SUM(kg),0) FROM asa_pedidos
                    WHERE asa_job_id = %s AND COALESCE(estado,'') <> 'Cancelled'
                    GROUP BY 1 ORDER BY 1 DESC""", (job,))
            anios = [{"anio": r[0], "cc": r[1], "kg": float(r[2] or 0)} for r in cur.fetchall()]
            cur.execute(
                """SELECT COALESCE(estado,'?'), COUNT(*) FROM asa_pedidos
                    WHERE asa_job_id = %s AND COALESCE(estado,'') <> 'Cancelled'
                    GROUP BY 1 ORDER BY 2 DESC""", (job,))
            estados = [{"estado": r[0], "cc": r[1]} for r in cur.fetchall()]
            cur.execute(
                """SELECT COALESCE(detail_person,'?'), COUNT(*) FROM asa_pedidos
                    WHERE asa_job_id = %s AND COALESCE(estado,'') <> 'Cancelled'
                    GROUP BY 1 ORDER BY 2 DESC""", (job,))
            personas = [{"email": r[0], "cc": r[1]} for r in cur.fetchall()]
            cur.execute(
                """SELECT COUNT(*), MAX(job_name) FROM asa_pedidos
                    WHERE asa_job_id = %s AND COALESCE(estado,'') <> 'Cancelled'""", (job,))
            total, nombre = cur.fetchone()
    return {"job": job, "obra": nombre, "cc": total, "anios": anios, "estados": estados,
            "personas": personas, "maximo": MUESTRA_MAXIMA_ASA}


def _sortear_asa(cur, job: str, n, anios: str, estados: str, personas: str, busca: str, semilla: str):
    """La muestra sobre aSa. Dos pasos, porque los ítems no están espejados: se sortean
    CÓDIGOS DE CONTROL del espejo —ahí sí está todo— y recién de los sorteados se piden
    los ítems a aSa, que es la parte lenta (1 a 11 s por código)."""
    n = max(1, min(int(n or MUESTRA_POR_DEFECTO), MUESTRA_MAXIMA_ASA))
    semilla = (semilla or secrets.token_hex(4)).strip()
    where = ["asa_job_id = %s", "COALESCE(estado,'') <> 'Cancelled'", "job_name !~* %s"]
    params: list = [job, PATRON_OBRAS_FUERA]
    if _lista(anios):
        where.append("anio = ANY(%s)")
        params.append([int(a) for a in _lista(anios)])
    if _lista(estados):
        where.append("COALESCE(estado,'') = ANY(%s)")
        params.append(_lista(estados))
    if _lista(personas):
        where.append("COALESCE(detail_person,'') = ANY(%s)")
        params.append(_lista(personas))
    if (busca or "").strip():
        where.append("descr ILIKE %s")
        params.append("%" + busca.strip() + "%")
    cond = " AND ".join(where)
    cur.execute(f"SELECT COUNT(*) FROM asa_pedidos WHERE {cond}", params)
    total = cur.fetchone()[0]
    if not total:
        raise HTTPException(status_code=400, detail="No hay códigos de control en ese alcance.")
    cur.execute(
        f"""SELECT control_code, descr, detail_person FROM asa_pedidos WHERE {cond}
             ORDER BY md5(control_code || '|' || %s) LIMIT %s""", params + [semilla, n])
    ccs = cur.fetchall()
    elementos = []
    for cc, descr, quien in ccs:
        items = _items_de(cc)
        del_cc = _elementos_de_items(items, cc, descr or "", quien)
        # UN elemento por código: si un CC trae 22, llevárselos todos sería auditar un
        # solo pedido en vez de una muestra repartida. Se toma el más pesado, que es el
        # que más vale la pena mirar.
        if del_cc:
            elementos.append(max(del_cc, key=lambda e: e["kg"]))
    if not elementos:
        raise HTTPException(status_code=502, detail="aSa no devolvió ítems para esos códigos de control.")
    return total, elementos, semilla, len(elementos)


@router.get("/auditorias/elemento-asa")
def elemento_asa(cc: str, element: str = "", user=Depends(get_current_user)):
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
    return {"cc": cc, "element": element, "barras": barras, "n": len(barras),
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
    # Alcance de aSa (allá no hay sector/piso/ciclo: ver universo_asa)
    anios: List[str] = []
    estados: List[str] = []
    personas: List[str] = []
    busca: str = ""
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
                total, elementos, semilla, n = _sortear_asa(
                    cur, body.id_proyecto, body.n, ",".join(body.anios), ",".join(body.estados),
                    ",".join(body.personas), body.busca, "")
                alcance = (body.anios, body.estados, body.personas)
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
                                           creada_por, notas)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'planificada',%s,%s,%s,%s) RETURNING id""",
                (_codigo(cur), body.id_proyecto, obra, body.auditor, body.origen,
                 alcance[0], alcance[1], alcance[2], len(elementos), total, semilla, hoy,
                 _habiles(hoy, DIAS_PLAZO), email, body.notas))
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
                           a.cierre_fecha, a.semilla, a.origen,
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
            "semilla": r[15], "origen": r[16], "revisados": r[17],
            "resultado": {"conforme": r[18], "observacion": r[19], "nc_menor": r[20], "nc_mayor": r[21]},
            "acciones_abiertas": r[22], "kg": float(r[23] or 0)}


@router.get("/auditorias/{auditoria_id}")
def detalle(auditoria_id: int, user=Depends(get_current_user)):
    """La auditoría con su muestra, elemento por elemento y con su hallazgo."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT a.id, a.codigo, a.obra, a.id_proyecto, a.auditor, a.sectores, a.pisos, a.ciclos,
                          a.n, a.total_rango, a.estado, a.creada_fecha, a.plazo_fecha, a.inicio_fecha,
                          a.cierre_fecha, a.semilla, a.origen,
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
            aud["notas"] = r[24]
            aud["creada_por"] = r[25]
            cur.execute(
                """SELECT id, sector, piso, ciclo, eje, nombre, estructura, barras, kg, cubicado_por,
                          hallazgo, texto, causa, revisado_por, revisado_el,
                          accion_estado, accion_por, accion_el, accion_nota, cc
                     FROM auditoria_elementos WHERE auditoria_id = %s ORDER BY id""", (auditoria_id,))
            aud["elementos"] = [
                {"id": e[0], "cc": e[19], "sector": e[1], "piso": e[2], "ciclo": e[3], "eje": e[4], "nombre": e[5],
                 "estructura": e[6], "barras": e[7], "kg": float(e[8] or 0), "cubicado_por": e[9],
                 "tipo": SECTORES.get(e[1] or "", e[1]),
                 "hallazgo": e[10], "texto": e[11], "causa": e[12],
                 "revisado_por": e[13], "revisado_el": e[14].isoformat() if e[14] else None,
                 "accion_estado": e[15], "accion_por": e[16],
                 "accion_el": e[17].isoformat() if e[17] else None, "accion_nota": e[18],
                 # INDEPENDENCIA: no se bloquea, se avisa. Bloquear sería inútil en una
                 # obra que cubicó una sola persona; lo que importa es que se vea.
                 "conflicto": bool(e[9] and aud["auditor"] and aud["auditor"] in (e[9] or ""))}
                for e in cur.fetchall()]
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
