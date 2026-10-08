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

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg.errors import UniqueViolation
from pydantic import BaseModel

from .auth import get_current_user
from .orden import sql_tipologia_order
from .db import get_conn, audit

router = APIRouter()

# Lo que `sector` significa en las barras. Es lo que el formulario ofrece como «tipo».
SECTORES = {"ELEV": "Elevación", "LCIELO": "Losa", "VCIELO": "Viga de cielo", "FUND": "Fundación"}
MUESTRA_POR_DEFECTO = 10
MUESTRA_MAXIMA = 200
# QUIÉN VE Y HACE AUDITORÍAS: administración y los cubicadores, nadie más (decisión
# del usuario, 2-oct). Un USC o un externo no tiene nada que hacer acá: esto mide el
# trabajo del área de cubicación. La regla de INDEPENDENCIA —no auditas lo que tú
# cubicaste— se avisa elemento a elemento, no se resuelve con el rol.
# QUIEN AUDITA. No existe un rol «cubicador»: los cubicadores son usuarios con rol
# miembro (los contratados por Armacero) o externo, y lo que los define es pertenecer al
# AREA de Cubicaciones. Filtrar por un rol inexistente dejaba en la lista solo a los dos
# administradores y les escondia el tab a los que de verdad auditan.
ROLES_ADMINISTRAN = ("admin", "admin_calidad")
AREA_AUDITA = "Cubicaciones"
# Se mantiene el nombre por los tests y el shell: son los roles que PUEDEN contener a un
# auditor. La pertenencia al area la decide la base, no el rol.
ROLES_AUDITAN = ("admin", "admin_calidad", "miembro", "externo")
# Estados de la auditoría (los usa el front; se congelan acá para que haya UNA lista).
ESTADOS = ("planificada", "en_curso", "cerrada")
# Hallazgos posibles sobre un elemento, en el idioma de la ISO.
# LO QUE EL AUDITOR DECLARA, y nada más que eso (7-oct). Antes eran cuatro y dos de ellas
# —«NC menor» y «NC mayor»— le pedían GRADUAR: dos auditores gradúan distinto el mismo
# defecto y el indicador queda a merced de quién miró. Ahora declara un hecho verificable
# —está conforme, hay algo que observar, o hay un hallazgo— y LA GRAVEDAD LA CALCULA EL
# SISTEMA con un dato que ya tiene: si el código alcanzó a despacharse (ver `gravedad_de`).
HALLAZGOS = ("conforme", "observacion", "hallazgo")
# El que abre una acción para quien cubicó. Los otros dos no.
HALLAZGO_ABRE_ACCION = "hallazgo"
# El área cuyo Ishikawa da las causas de una no conformidad (tabla `areas`).
AREA_CUBICACIONES = "Cubicaciones"
# De dónde sale la muestra. 'armahub' = las barras de acá; 'asa' = los ítems de aSa, para
# las obras que no están en ArmaHub (319 contra 18).
ORIGENES = ("armahub", "asa")
# Las obras de prueba de aSa no se auditan. Mismo patrón que usa Programación.
PATRON_OBRAS_FUERA = r"\m(prueba|no usar|barras)\M"
# Los dos estados de aSa que dejan un código FUERA de una auditoría, y por razones
# distintas: el anulado no es trabajo, y el despachado ya se fabricó y se fue a la obra
# —auditarlo llega tarde, y lo que vale es revisar antes de que salga—. Son los mismos
# nombres que usa Programación (`programacion.ESTADO_NUNCA`): acá se repiten para no
# importar ese módulo entero sólo por dos textos.
ESTADO_NUNCA = "Cancelled"
ESTADO_DESPACHADO = "Shipped"
# Desde cuántos días un código despachado se marca como «salió hace rato». No cambia
# ninguna regla: sólo pinta, para que al elegir el alcance se vea de un vistazo hasta
# dónde se está yendo hacia atrás.
DIAS_DESPACHO_ANTIGUO = 30
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
# Cuando un ítem de aSa no trae ElementID. Medido el 1-oct: viene en el 100%, pero si
# faltara, el elemento se agrupa igual bajo esta etiqueta en vez de desaparecer.
SIN_ELEMENTO = "(sin elemento)"


def _lista(valor: Optional[str]):
    return [v for v in (valor or "").split(",") if v.strip()]


def _ubicacion_txt(e) -> str:
    """Dónde está el elemento, en una línea: «CC SUP4 · Elevación · Piso 3 · Ciclo 2 · Eje K2».

    Sólo lo que está lleno. En aSa al principio vienen sólo el código y el eje, y el resto
    aparece cuando el auditor lo escribe: por eso esto va al informe —si no, llenarlo no
    serviría de nada, porque el informe seguiría diciendo lo mismo—.
    """
    partes = []
    # El código de control manda: es lo primero que el auditado busca para ubicarse. En la
    # pantalla va en su propia columna, pero el informe se lee suelto y tiene que decirlo.
    if e.get("cc"):
        partes.append("CC %s" % e["cc"])
    tipo = SECTORES.get(e.get("sector") or "", e.get("sector") or "")
    if tipo:
        partes.append(tipo)
    for etiqueta, campo in (("Piso", "piso"), ("Ciclo", "ciclo"), ("Eje", "eje")):
        valor = (e.get(campo) or "").strip()
        if not valor or valor == SIN_ELEMENTO:
            continue
        # Si el auditor ya escribió «Eje K2», no se le pone «Eje» otra vez delante.
        partes.append(valor if valor.lower().startswith(etiqueta.lower())
                      else "%s %s" % (etiqueta, valor))
    return " · ".join(partes)


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


def _es_del_area(cur, email: str) -> bool:
    cur.execute("""SELECT 1 FROM area_usuarios au
                     JOIN areas a ON a.id = au.area_id
                     JOIN users u ON u.id = au.user_id
                    WHERE a.nombre = %s AND u.email = %s LIMIT 1""", (AREA_AUDITA, email))
    return cur.fetchone() is not None


def _puede_auditar(user):
    """Administracion siempre; el resto, solo si integra el area de Cubicaciones. Se
    consulta ANTES de que el endpoint abra su propia conexion, asi que no se anidan."""
    if user.get("role") in ROLES_ADMINISTRAN:
        return
    if user.get("role") in ROLES_AUDITAN:
        with get_conn() as conn:
            with conn.cursor() as cur:
                if _es_del_area(cur, user.get("email", "")):
                    return
    raise HTTPException(status_code=403, detail="No tiene permiso para auditar.")


def _puede_ver(user):
    """Ver una auditoría es lo mismo que poder hacerla: administración y cubicadores. El
    módulo entero queda cerrado para el resto, no sólo los botones."""
    _puede_auditar(user)


def estado_de(revisados: int, total: int) -> str:
    """El estado NO se elige: se deriva. Sin revisar es planificada; algo revisado, en
    curso; todo revisado, cerrada. Función pura para poder probarla."""
    if revisados <= 0:
        return "planificada"
    return "cerrada" if revisados >= total else "en_curso"


@router.get("/auditorias/obras")
def obras(user=Depends(get_current_user)):
    _puede_ver(user)
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
            # Los que pueden quedar como auditor: los integrantes del area de
            # Cubicaciones. Es la misma lista que mantiene el usuario en el panel de
            # areas, asi que agregar o sacar un cubicador se hace alla y no aca.
            cur.execute(
                """SELECT DISTINCT u.email, TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), u.role
                     FROM users u
                     JOIN area_usuarios au ON au.user_id = u.id
                     JOIN areas a ON a.id = au.area_id
                    WHERE a.nombre = %s AND COALESCE(u.activo, TRUE)
                    ORDER BY 2, 1""",
                (AREA_AUDITA,))
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
    _puede_ver(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT marca, diam, figura, dim_a, dim_b, dim_c, dim_d, dim_e, dim_f, dim_g, dim_h, dim_i,
                          largo_total, cant, mult, cant_total, peso_unitario, peso_total,
                          nombre_plano, tipo, INITCAP(estructura), COALESCE(creado_por, editado_por, '?'),
                          bar_id, id_unico, ang1, ang2, ang3, ang4, radio
                     FROM barras
                    WHERE id_proyecto = %s AND COALESCE(sector,'') = %s AND COALESCE(piso,'') = %s
                      AND COALESCE(ciclo,'') = %s AND COALESCE(eje,'') = %s
                    -- EL MISMO ORDEN QUE EL RESTO DE LA PLATAFORMA. Las tipologías tienen
                    -- una secuencia constructiva (MH, MV, TR, …, CB) que vive en orden.py y
                    -- la usan el despiece y el export; ordenar alfabético acá dejaba la
                    -- lista en otro orden que el que el cubicador tiene en pantalla.
                    ORDER BY """ + sql_tipologia_order("marca") + """, marca, diam, bar_id""",
                (id_proyecto, sector, piso, ciclo, eje))
            dims = "abcdefghi"
            barras = []
            for r in cur.fetchall():
                barras.append({
                    "marca": r[0], "diam": r[1], "figura": r[2],
                    "dims": {dims[i]: r[3 + i] for i in range(9) if r[3 + i] not in (None, 0)},
                    "largo": r[12], "cant": r[13], "mult": r[14], "cant_total": r[15],
                    "peso_unitario": r[16], "peso_total": r[17], "plano": r[18], "tipo": r[19],
                    "estructura": r[20], "cubicado_por": r[21], "bar_id": r[22], "id_unico": r[23],
                    # Los ángulos y el radio, como los muestra el Bar Manager (0 = no usado).
                    "angulos": [float(r[i]) for i in range(24, 28) if r[i] not in (None, 0)],
                    "radio": r[28] or None})
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
    _puede_ver(user)
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
# `LengthTheor` y `LengthCut` NO son lo mismo y la diferencia importa (7-oct, lo cazó el
# cubicador que hizo la primera auditoría): el TEÓRICO es la suma de los largos parciales
# —medidos al vértice, que es como se cubica y como los suma ArmaHub— y el de CORTE
# descuenta lo que se come cada doblez. Medido sobre 318 barras: `LengthTheor` coincide
# EXACTO con la suma de los lados en las 318, y `LengthCut` difiere en 35 de 50 en un solo
# código. Mostrábamos el de corte, así que el auditor veía 2.576 donde su cubicación dice
# 2.640 y parecía un error que no existía.
CAMPOS_ITEM = ["CtrlCode", "ElementID", "ElementDesc", "BarMark", "BarSizeDescr", "ShpNameID",
               "ShapeDims", "LegAngle", "LengthCut", "LengthTheor", "TotalQty", "LineWeight", "PinDiam",
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


def _sin_tildes(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return "".join(c for c in s if c.isalnum())


def alias_de(nombre: str, apellido: str, login_asa: str) -> bool:
    """¿`login_asa` es el nombre de esta persona en aSa? Función pura, para probarla sola.

    En las auditorías de aSa, `cubicado_por` NO es un correo: es el login de aSa, que se
    arma con la inicial del nombre pegada al apellido — `Nlopez`, `HMONDACA`, `Dvenegas`—
    y a veces con dos iniciales (`JHvelasquez`). El correo nunca va a calzar con eso.

    LA REGLA: termina en el apellido y empieza con la inicial del nombre. Medido sobre los
    18 nombres que aSa trae en el último año y los usuarios del área de Cubicaciones:
    calza con los 7 cubicadores que están en la plataforma y NO se equivoca con ninguno.
    Los once que quedan fuera son gente que simplemente no es usuario acá.
    """
    a, n, l = _sin_tildes(apellido), _sin_tildes(nombre), _sin_tildes(login_asa)
    return bool(a and n and l and l.endswith(a) and l[:1] == n[:1])


def alias_cubicador(cur, email: str) -> list:
    """Con qué nombres aparece esta persona en `cubicado_por`: su correo —así es en las
    auditorías de ArmaHub— y su login de aSa. Sin esto, las 47 barras por corregir que hay
    hoy no le llegan a nadie: están todas a nombre de «Nlopez»."""
    nombres = [email]
    cur.execute("SELECT nombre, apellido FROM users WHERE email = %s", (email,))
    fila = cur.fetchone()
    if not fila:
        return nombres
    nombre, apellido = fila
    cur.execute("""SELECT DISTINCT NULLIF(TRIM(cubicado_por), '')
                     FROM auditoria_elementos WHERE cubicado_por IS NOT NULL""")
    for (login,) in cur.fetchall():
        if login and alias_de(nombre, apellido, login):
            nombres.append(login)
    return nombres


def _json(d):
    """Un dict a JSONB. Se escribe acá y no se importa `json` en cada sitio."""
    import json
    return json.dumps(d, ensure_ascii=False)


def _hallazgos_de_items(cur, elemento_id: int) -> dict:
    """Lo ya registrado barra por barra, para repintarlo al reabrir el elemento: el
    veredicto, lo que debería decir, y en qué va la corrección."""
    cur.execute(
        """SELECT ref, conforme, observacion, revisado_por, revisado_el, esperado,
                  corregido, corregido_por, corregido_el, nota_correccion,
                  tipo_correccion, cc_nuevo, verificado, verificado_el, verificado_dato
             FROM auditoria_items WHERE elemento_id = %s""", (elemento_id,))
    return {r[0]: {"conforme": r[1], "observacion": r[2], "revisado_por": r[3],
                   "revisado_el": r[4].isoformat() if r[4] else None,
                   "esperado": r[5] or {},
                   "corregido": bool(r[6]), "corregido_por": r[7],
                   "corregido_el": r[8].isoformat() if r[8] else None,
                   "nota_correccion": r[9], "tipo_correccion": r[10], "cc_nuevo": r[11],
                   "verificado": r[12],
                   "verificado_el": r[13].isoformat() if r[13] else None,
                   "verificado_dato": r[14]} for r in cur.fetchall()}


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


# LO QUE SE LEE DEL NOMBRE. En aSa el tipo, el piso y el ciclo no son campos, pero el
# cubicador los escribe en el nombre del código («Elev S3 C7», «LC S1 C5 Lourdes», «ELEV.
# 10°P (CICLO 1)») y el tipo suele venir además en el ElementDesc («LCIELO», «ELEV»,
# «L Fund»). Se leen con reglas cortas y conservadoras —sólo las formas que se repiten en
# las 12.000 descripciones de 2025— y lo que no se reconoce queda vacío para que lo
# complete el auditor, que corrige en la fila. Lo leído NO se da por confirmado: viaja
# sin `ubicado_el` y la pantalla lo muestra como «leído del nombre». Decisión del usuario
# (6-oct): «si puedes derivarlo del nombre y es fácil, mucho mejor: así completas los
# raros solamente».
_FAMILIAS_SECTOR = (
    ("ELEV", re.compile(r"^(ELEV|ELEVACION(ES)?|MURO(S)?)\.?$")),
    ("LCIELO", re.compile(r"^(LC|L\.?C\.?|LOSA(S)?|LCIELO)\.?$")),
    ("VCIELO", re.compile(r"^(VC|V\.?C\.?|VIGA(S)?|VCIELO)\.?$")),
    ("FUND", re.compile(r"^(FUND|FUNDACION(ES)?|L\.?\s?FUND)\.?$")),
)
# El piso: «P3» / «S1» / «PB», o el número con grado («10°P», «1°SUBT.», «C2°P» = cielo del
# 2° piso) o con la palabra entera («10 PISO», «4SUBT»). Con grado no hace falta mirar qué
# hay antes: el ° ya dice que es un ordinal.
_RE_PISO = re.compile(r"(?<![A-Z0-9])(?:(P|S)(\d{1,2})|(PB))(?![A-Z0-9°])"
                      r"|(\d{1,2})\s*°\s*(P|PISO|S|SUBT|SUB)\b"
                      r"|(?<![A-Z0-9])(\d{1,2})\s*(PISO|SUBT|SUB)\b")
_RE_CICLO = re.compile(r"(?<![A-Z0-9])(?:C(\d{1,2})(?![A-Z0-9°])|CICLO\s*([A-Z]?\d{1,2})\b)")


def _ubicacion_desde_nombre(descr: Optional[str], estructura: Optional[str]) -> dict:
    """{sector, piso, ciclo} leídos del nombre del código y del ElementDesc; vacío lo que
    no se reconoce con certeza. Nunca adivina: «VIGAS+LOSAS» no es ni viga ni losa."""
    descr_u = (descr or "").upper().replace("_", " ")
    estr_u = (estructura or "").upper().replace("_", " ")
    sector = ""
    # El tipo: primero el ElementDesc entero («L Fund»), después los tokens del nombre.
    for sec, patron in _FAMILIAS_SECTOR:
        if estr_u and patron.match(estr_u.strip()):
            sector = sec
            break
    if not sector:
        for token in re.split(r"[\s,;/()\-]+", descr_u):
            for sec, patron in _FAMILIAS_SECTOR:
                if token and patron.match(token):
                    sector = sec
                    break
            if sector:
                break
    piso = ciclo = ""
    for texto in (descr_u, estr_u):
        if not piso:
            m = _RE_PISO.search(texto)
            if m:
                if m.group(3):
                    piso = "PB"
                elif m.group(1):
                    piso = m.group(1) + m.group(2)
                else:
                    numero = m.group(4) or m.group(6)
                    palabra = m.group(5) or m.group(7)
                    piso = ("S" if palabra.startswith("S") else "P") + numero
        if not ciclo:
            m = _RE_CICLO.search(texto)
            if m:
                bruto = m.group(1) or m.group(2)
                ciclo = ("C" + bruto) if bruto.isdigit() else bruto
    return {"sector": sector, "piso": piso, "ciclo": ciclo}


def _es_barra(it) -> bool:
    """aSa manda, dentro del código, una LÍNEA POR ELEMENTO además de sus barras: sin marca,
    sin φ, sin figura, cantidad 1 y de peso el del conjunto (medido: 581 kg = la suma de sus
    barras). No es una barra: contaba doble el kilaje de la muestra y salía en la grilla como
    una fila vacía (el usuario la vio, 6-oct). Barra es lo que tiene marca o diámetro."""
    return bool((it.get("BarMark") or "").strip() or (it.get("BarSizeDescr") or "").strip())


def _elementos_de_items(items, cc: str, descr: str, cubico: Optional[str]):
    """Agrupa los ítems de un CC por elemento. Un CC puede traer uno o veintidós. La línea
    del elemento (ver _es_barra) sólo aporta el nombre si ninguna barra lo trae."""
    por: dict = {}
    for it in items:
        eid = (it.get("ElementID") or "").strip()
        clave = eid or SIN_ELEMENTO
        # `ref_origen` es el ElementID TAL CUAL lo manda aSa: con él se vuelven a pedir las
        # barras. `eje` arranca igual pero es la etiqueta, y el auditor la puede corregir.
        e = por.setdefault(clave, {"cc": cc, "sector": "", "piso": "", "ciclo": "", "eje": clave,
                                   "ref_origen": eid,
                                   "estructura": (it.get("ElementDesc") or "").strip() or None,
                                   "barras": 0, "kg": 0.0, "cubicado_por": cubico,
                                   "tipo": None, "descr_cc": descr})
        if not _es_barra(it):
            continue
        e["barras"] += 1
        e["kg"] += float(it.get("LineWeight") or 0)
    for clave, e in por.items():
        # EL NOMBRE ES SÓLO DEL ELEMENTO. El código de control y su descripción tienen sus
        # propias columnas: pegarlos acá daba «SUP4 · INF · FUN C17», que además repite el
        # eje. Cada columna dice una cosa.
        e["nombre"] = (e["estructura"]
                       or (clave if clave != SIN_ELEMENTO else "")
                       or descr or cc)
        # Tipo, piso y ciclo: lo que se lee del nombre (ver _ubicacion_desde_nombre).
        e.update(_ubicacion_desde_nombre(descr, e["estructura"]))
    return list(por.values())


@router.get("/auditorias/cc")
def codigos_de_control(job: str, user=Depends(get_current_user)):
    _puede_ver(user)
    """LOS CÓDIGOS DE CONTROL de una obra de aSa, para elegir de cuáles sacar la muestra.

    LOS DESPACHADOS TAMBIÉN SE OFRECEN (7-oct). Antes se escondían: auditar algo que ya
    salió llega tarde, y ése seguía siendo el criterio. Pero esconderlos le quitaba al
    cubicador una decisión que es suya —a veces hay que revisar lo que ya se fue, porque
    es justo donde puede haber un error que ya costó plata—. Ahora se ofrecen todos,
    del más nuevo al más antiguo, y el que elige hasta dónde revisar es el usuario.

    ORDENADOS POR LA FECHA DEL PEDIDO, UNA SOLA PARA TODOS (8-oct). Antes se ordenaba por
    una fecha mezclada: la de despacho para los despachados y la del pedido para el resto.
    Eso ponía los despachados arriba, y es justo al revés: un código que ya salió se
    cubicó ANTES que uno que sigue abierto —tuvo tiempo de fabricarse y despacharse—, así
    que tiene que ir más abajo. Lo cazó el usuario mirando la pantalla: el SUBM se pidió
    el 26 de agosto y despachó el 2 de octubre, y aparecía tercero, sobre códigos pedidos
    un mes después. Con `order_date` para todos, los Open quedan arriba, los Processed al
    medio y los Shipped al final, que es el orden en que se cubicaron.

    La fecha de despacho no se pierde: viaja aparte y es la que cuenta los días para
    pintar lo que salió hace más de un mes.

    En aSa no hay piso ni ciclo: lo que hay es `Descr`, el nombre que el usuario le
    puso al código —en edificación suele llevar ELEV, FUND, LC o VC, pero no siempre—.
    Por eso se eligen los códigos a mano en vez de intentar clasificarlos."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT control_code, COALESCE(descr,''), kg, order_date, COALESCE(estado,''),
                          COALESCE(detail_person,''), sched_estado, proj_ship_date
                     FROM asa_pedidos
                    WHERE asa_job_id = %s
                      AND COALESCE(estado,'') <> %s
                      AND job_name !~* %s
                    -- PRIMERO LO QUE NO SALIÓ, DESPUÉS LO DESPACHADO, y dentro de cada
                    -- grupo del más nuevo al más antiguo. Ordenar sólo por fecha dejaba
                    -- los despachados intercalados entre los vivos, y en la práctica no
                    -- se eligen juntos: lo normal es revisar lo que todavía se puede
                    -- atajar. Siguen estando y se pueden elegir igual, pero abajo.
                    --
                    -- Una sola fecha ordena, y es la del pedido. Mezclar la de despacho
                    -- para unos y la del pedido para otros ordena por dos varas distintas
                    -- y sube justo lo que se cubicó hace más tiempo.
                    ORDER BY (COALESCE(estado,'') = %s), order_date DESC NULLS LAST,
                             control_code""",
                (job, ESTADO_NUNCA, PATRON_OBRAS_FUERA, ESTADO_DESPACHADO))
            hoy = date.today()
            ccs = []
            for r in cur.fetchall():
                despachado = r[4] == ESTADO_DESPACHADO
                pedido, despacho = r[3], r[7]
                # DOS CUENTAS DE DÍAS, porque son dos preguntas distintas:
                #  · `dias` — desde que se pidió. Es la que ordena y la que dice hace
                #    cuánto se cubicó eso.
                #  · `dias_despacho` — desde que salió, sólo si salió. Es la que decide si
                #    el código se pinta por despachado hace rato.
                dias = (hoy - pedido).days if pedido else None
                dias_desp = (hoy - despacho).days if (despachado and despacho) else None
                ccs.append({"cc": r[0], "descr": r[1], "kg": float(r[2] or 0),
                            "fecha": pedido.isoformat() if pedido else None, "estado": r[4],
                            "persona": r[5], "planta": r[6],
                            "despacho": despacho.isoformat() if despacho else None,
                            "despachado": despachado,
                            "dias": dias, "dias_despacho": dias_desp,
                            "antiguo": bool(dias_desp is not None
                                            and dias_desp > DIAS_DESPACHO_ANTIGUO)})
            cur.execute(
                """SELECT MAX(job_name),
                          COUNT(*) FILTER (WHERE COALESCE(estado,'') = %s),
                          COUNT(*) FILTER (WHERE COALESCE(estado,'') NOT IN (%s, %s))
                     FROM asa_pedidos WHERE asa_job_id = %s AND job_name !~* %s""",
                (ESTADO_DESPACHADO, ESTADO_NUNCA, ESTADO_DESPACHADO, job, PATRON_OBRAS_FUERA))
            obra, despachados, vivos = cur.fetchone()
            vivos = (vivos or 0) + (despachados or 0)   # ahora se ofrecen los dos
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
            "dias_antiguo": DIAS_DESPACHO_ANTIGUO,
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
    _puede_ver(user)
    # El elemento se pide por su referencia EN aSa (el ElementID). La etiqueta `(sin
    # elemento)` no es un ElementID: significa «los ítems a los que aSa no les puso
    # ninguno», y filtrar por ese texto devolvía cero ítems y un 404 sin explicación.
    items = [it for it in _items_de(cc)
             if _es_barra(it)
             and (not element
                  or (it.get("ElementID") or "").strip() == ("" if element == SIN_ELEMENTO else element))]
    if not items:
        raise HTTPException(status_code=404, detail="Ese elemento no tiene ítems en aSa.")
    from .figura_asa import figura_de, trazo_de_catalogo
    # EL TRAZO QUE EXPORTÓ aSa, para las figuras que estén en su catálogo (el RDX). Se usa de
    # RESPALDO cuando nuestra reconstrucción no cuadra con la envolvente que aSa declara: ahí
    # la topología que trae el trazo —declarada por aSa, no deducida por nosotros— es la
    # mejor fuente que queda. El porqué de no usarlo siempre, con los números medidos, está
    # en trazo_de_catalogo().
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT codigo, puntos, lados FROM asa_figuras_catalogo WHERE codigo = ANY(%s)",
                        ([(it.get("ShpNameID") or "").strip() for it in items],))
            trazos = {r[0]: {"puntos": r[1] or [], "lados": r[2] or []} for r in cur.fetchall()}

    def mejor_eje(it, dims):
        """La figura que se dibuja: la reconstrucción si cuadra, y si no el trazo de aSa.
        Una figura TRIDIMENSIONAL se deja como está aunque no cuadre: el trazo del RDX es
        plano y taparía justamente el aviso de que la barra se dobla en dos planos."""
        eje = figura_de(it.get("ShapeDims"), it.get("LegAngle"), it.get("PinDiam"),
                        _mm(it.get("BarSizeDescr")))
        if eje.get("ok") or eje.get("tridimensional"):
            return eje
        alterna = trazo_de_catalogo(trazos.get((it.get("ShpNameID") or "").strip()), dims,
                                    it.get("LegAngle"), it.get("PinDiam") or 0)
        return alterna if (alterna and alterna.get("ok")) else eje
    barras = []
    for it in items:
        lados = _lados(it.get("LegAngle"))
        barras.append({
            "marca": it.get("BarMark"), "diam": it.get("BarSizeDescr"), "figura": it.get("ShpNameID"),
            # Los lados en mm con su letra, los ángulos entre lados y qué lados son gancho:
            # la grilla los pone en columnas, en cm, igual que el Bar Manager.
            "dims": lados["dims"], "angulos": lados["angulos"], "ganchos": lados["ganchos"],
            # El largo que se audita es la SUMA DE LOS PARCIALES (ver CAMPOS_ITEM); el de
            # corte viaja al lado porque es el que aSa manda a fabricar, y que los dos no
            # coincidan es normal: la diferencia es el doblez.
            "largo": it.get("LengthTheor"), "largo_corte": it.get("LengthCut"),
            # EL DIBUJO. La figura se construye con lo que manda aSa (lados, ángulos,
            # mandril, φ) como una policurva —ver figura_asa.py— y se comprueba contra la
            # envolvente que ella misma declara: si no cuadra se intenta con el trazo que
            # exportó aSa, y si tampoco, se dibuja igual con el aviso y el porqué al lado.
            # `eje.fuente` dice de dónde salió, porque el auditor merece saberlo.
            "eje": mejor_eje(it, lados["dims"]),
            "cant_total": it.get("TotalQty"), "peso_total": it.get("LineWeight"),
            "plano": it.get("ElementDesc"), "radio": it.get("PinDiam"),
            "nota": " · ".join(x for x in ((it.get("Notes") or "").strip(),
                                           (it.get("ShopMessage") or "").strip()) if x) or None,
        })
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


def _mm(descr) -> float:
    """El φ en mm desde el texto de aSa («10mm», «12 mm»)."""
    import re as _re
    m = _re.search(r"([\d.]+)", str(descr or ""))
    return float(m.group(1)) if m else 0.0


def _lados(xml: Optional[str]) -> dict:
    """Los lados de la barra, del XML de `LegAngle`, para la grilla: `dims` {letra: mm},
    `angulos` [grados entre cada lado y el anterior] y `ganchos` [letras]. Si aSa no le
    puso letra a un lado (las rectas), se nombra por posición: A, B, C… que es como las
    nombra ella misma cuando sí lo hace."""
    salida = {"dims": {}, "angulos": [], "ganchos": []}
    if not xml:
        return salida
    import re as _re
    for i, cp in enumerate(_re.findall(r"<cp>(.*?)</cp>", str(xml))):
        largo = _re.search(r"<l>([-\d.]+)</l>", cp)
        if not largo:
            continue
        nombre = (_re.search(r"<ln>(.*?)</ln>", cp) or [None, ""])[1] or "ABCDEFGHI"[i:i + 1] or str(i + 1)
        salida["dims"][nombre] = float(largo.group(1))
        ang = _re.search(r"<a>([-\d.]+)</a>", cp)
        if ang:
            salida["angulos"].append(float(ang.group(1)))
        tipo = _re.search(r"<t>(.*?)</t>", cp)
        if tipo and tipo.group(1).upper().startswith("H"):
            salida["ganchos"].append(nombre)
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
    """A-2026-001: el número que se dice en voz alta. Corre por año.

    NO SE CUENTAN LAS QUE HAY: se lleva un correlativo aparte. Contarlas tenía dos caras
    y las dos muerden. Borrar una dejaba un hueco y la siguiente pedía un número ya usado,
    que chocaba con el índice único y salía como «Error interno del servidor». Y aunque no
    chocara, REUSAR el número es peor: al crear una auditoría se manda un correo con su
    código, así que dos correos distintos hablarían de la misma A-2026-002.

    El INSERT ... ON CONFLICT DO UPDATE toma el candado de la fila del año, así que dos
    personas creando a la vez se ordenan solas: no hacen falta reintentos.
    """
    anio = _hoy().year
    cur.execute(
        """INSERT INTO auditoria_correlativo (anio, ultimo) VALUES (%s, 1)
           ON CONFLICT (anio) DO UPDATE SET ultimo = auditoria_correlativo.ultimo + 1
           RETURNING ultimo""", (anio,))
    return "A-%d-%03d" % (anio, cur.fetchone()[0])


@router.post("/auditorias")
def crear(body: CrearBody, request: Request, user=Depends(get_current_user)):
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
                       (auditoria_id, cc, sector, piso, ciclo, eje, nombre, estructura, barras, kg,
                        cubicado_por, ref_origen, descr_cc)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                [(aud_id, e.get("cc"), e["sector"], e["piso"], e["ciclo"], e["eje"], e["nombre"],
                  e["estructura"], e["barras"], e["kg"], e["cubicado_por"],
                  # Sólo en aSa: la referencia con la que se le vuelven a pedir las barras.
                  # En ArmaHub la clave son las cuatro columnas y no hay nada que guardar.
                  e.get("ref_origen") if es_asa else None,
                  # La descripción del código de control, en foto: el nombre que alguien le
                  # puso en aSa puede cambiar, y el informe tiene que seguir diciendo
                  # contra qué se auditó.
                  e.get("descr_cc") if es_asa else None) for e in elementos])
            audit(email, "auditoria_crear",
                  f"{body.origen} · {obra}: {len(elementos)} de {total}", "auditoria", str(aud_id))
    aud = detalle(aud_id, user)
    # Fuera de la transacción: el correo avisa, no decide. Si falla, la auditoría ya está.
    aud["correo"] = _avisar_auditoria_nueva(aud, request)
    return aud


@router.get("/auditorias")
def listar(id_proyecto: str = "", auditor: str = "", estado: str = "", limite: int = 100,
           user=Depends(get_current_user)):
    """La lista: estado, fechas y qué encontró cada una. El resumen por hallazgo se cuenta
    en la base, no en el navegador: es lo que se mira sin abrir nada."""
    _puede_ver(user)
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
                           COUNT(e.id) FILTER (WHERE e.hallazgo = 'hallazgo')    AS hallazgo,
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
            "resultado": {"conforme": r[19], "observacion": r[20], "hallazgo": r[21]},
            "acciones_abiertas": r[22], "kg": float(r[23] or 0)}


@router.get("/auditorias/indicadores")
def indicadores(desde: str = "", hasta: str = "", user=Depends(get_current_user)):
    """LO QUE LA AUDITORÍA DEJA: conformidad por cubicador, por obra, por causa y por mes.
    Sin esto los hallazgos se registran y nadie los suma, que es la forma más común de
    que un sistema de calidad no sirva para nada.

    Sólo cuenta elementos REVISADOS: un elemento pendiente no es ni conforme ni no
    conforme, y meterlo en el denominador bajaría el porcentaje de quien aún no termina.
    La «conformidad» es conformes sobre revisados; una observación no es conformidad."""
    _puede_ver(user)
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
              " COUNT(*) FILTER (WHERE e.hallazgo = 'hallazgo')    AS hallazgo,"
              " COALESCE(SUM(e.kg), 0) AS kg")

    def arma(filas, clave):
        salida = []
        for r in filas:
            rev = r[1] or 0
            salida.append({clave: r[0], "revisados": rev, "conforme": r[2], "observacion": r[3],
                           "hallazgo": r[4], "kg": float(r[5] or 0),
                           # `nc` se mantiene con ese nombre: lo lee el front y lo que
                           # cuenta es lo mismo de siempre, lo que abre una acción.
                           "nc": r[4] or 0,
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
                      {base} AND e.hallazgo IN ('hallazgo','hallazgo')
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
    _puede_ver(user)
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
                                  # Despachado = ya no se puede auditar. Entra al total de
                                  # la obra pero no al denominador de lo auditable.
                                  "auditable": r[3] != ESTADO_DESPACHADO,
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
                                  "auditados": 1 if info else 0, "auditable": True,
                                  "hallazgos": [info["hallazgo"]] if info and info["hallazgo"] else [],
                                  "auditorias": [info["auditoria"]] if info else []})
                unidad = "elemento"
    # DOS DENOMINADORES, y la diferencia importa: lo despachado ya no se puede auditar,
    # así que medir contra el total de la obra castiga por algo que nadie puede hacer. Se
    # informan los dos: contra lo auditable (lo exigible) y contra el total (el panorama).
    total = len(filas)
    auditables = [f for f in filas if f["auditable"]]
    con = sum(1 for f in filas if f["auditados"])
    kg_total = sum(f["kg"] for f in filas)
    kg_aud = sum(f["kg"] for f in auditables)
    kg_con = sum(f["kg"] for f in filas if f["auditados"])
    return {"id_proyecto": id_proyecto, "origen": origen, "unidad": unidad,
            "total": total, "auditable": len(auditables), "auditados": con,
            "pct": round(con / len(auditables) * 100) if auditables else 0,
            "pct_total": round(con / total * 100) if total else 0,
            "kg": kg_total, "kg_auditable": kg_aud, "kg_auditados": kg_con,
            "pct_kg": round(kg_con / kg_aud * 100) if kg_aud else 0,
            "filas": filas}


@router.get("/auditorias/{auditoria_id}")
def detalle(auditoria_id: int, user=Depends(get_current_user)):
    """La auditoría con su muestra, elemento por elemento y con su hallazgo."""
    _puede_ver(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT a.id, a.codigo, a.obra, a.id_proyecto, a.auditor, a.sectores, a.pisos, a.ciclos,
                          a.n, a.total_rango, a.estado, a.creada_fecha, a.plazo_fecha, a.inicio_fecha,
                          a.cierre_fecha, a.semilla, a.origen, a.ccs,
                          COUNT(e.id) FILTER (WHERE e.hallazgo IS NOT NULL),
                          COUNT(e.id) FILTER (WHERE e.hallazgo = 'conforme'),
                          COUNT(e.id) FILTER (WHERE e.hallazgo = 'observacion'),
                          COUNT(e.id) FILTER (WHERE e.hallazgo = 'hallazgo'),
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
                """SELECT e.id, e.sector, e.piso, e.ciclo, e.eje, e.nombre, e.estructura, e.barras,
                          e.kg, e.cubicado_por, e.hallazgo, e.texto, e.causa, e.revisado_por,
                          e.revisado_el, e.accion_estado, e.accion_por, e.accion_el, e.accion_nota, e.cc,
                          (SELECT COUNT(*) FROM auditoria_items i WHERE i.elemento_id = e.id),
                          (SELECT COUNT(*) FROM auditoria_items i
                            WHERE i.elemento_id = e.id AND i.conforme IS FALSE),
                          e.ref_origen, e.ubicado_por, e.ubicado_el, e.descr_cc,
                          -- EL ESTADO DEL CÓDIGO, HOY. La muestra se sortea entre los que
                          -- NO están despachados, pero el estado cambia después: un
                          -- código Open el lunes sale el jueves y la auditoría ya estaba
                          -- creada. Auditar algo despachado llega tarde —lo que vale es
                          -- revisar antes de que salga— así que el auditor tiene que
                          -- verlo en la lista, no descubrirlo al abrir el elemento.
                          p.estado, p.proj_ship_date
                     FROM auditoria_elementos e
                     LEFT JOIN asa_pedidos p ON p.control_code = e.cc
                    WHERE e.auditoria_id = %s ORDER BY e.id""", (auditoria_id,))
            aud["elementos"] = [
                {"id": e[0], "cc": e[19], "sector": e[1], "piso": e[2], "ciclo": e[3], "eje": e[4], "nombre": e[5],
                 "estructura": e[6], "barras": e[7], "kg": float(e[8] or 0), "cubicado_por": e[9],
                 "tipo": SECTORES.get(e[1] or "", e[1]),
                 "hallazgo": e[10], "texto": e[11], "causa": e[12],
                 "revisado_por": e[13], "revisado_el": e[14].isoformat() if e[14] else None,
                 "accion_estado": e[15], "accion_por": e[16],
                 "accion_el": e[17].isoformat() if e[17] else None, "accion_nota": e[18],
                 "items": e[20], "items_malos": e[21],
                 # La referencia en aSa (con ella se piden las barras) viaja aparte del
                 # `eje`, que es la etiqueta y el auditor puede corregir.
                 "ref_origen": e[22], "ubicado_por": e[23],
                 "ubicado_el": e[24].isoformat() if e[24] else None,
                 # El código de control y su descripción son columnas, no parte del nombre.
                 "descr_cc": e[25],
                 "estado_cc": e[26],
                 "despacho_cc": e[27].isoformat() if e[27] else None,
                 "despachado": (e[26] or "") == ESTADO_DESPACHADO,
                 # La gravedad del hallazgo, calculada: no se le pregunta a nadie.
                 "gravedad": gravedad_de(e[10], e[26]),
                 "gravedad_txt": GRAVEDAD.get(gravedad_de(e[10], e[26]) or "", ""),
                 # INDEPENDENCIA: no se bloquea, se avisa. Bloquear sería inútil en una
                 # obra que cubicó una sola persona; lo que importa es que se vea.
                 "conflicto": bool(e[9] and aud["auditor"] and aud["auditor"] in (e[9] or ""))}
                for e in cur.fetchall()]
            # LO QUE SE ENCONTRÓ EN CADA BARRA, por su nombre. Va aparte de `texto` —que es
            # la observación del elemento entero— porque son dos cosas distintas y
            # mezclarlas dejaba el informe ilegible. Sólo las no conformes: las conformes
            # no tienen nada que contar.
            cur.execute(
                """SELECT i.elemento_id, i.ref, i.marca, i.observacion
                     FROM auditoria_items i
                     JOIN auditoria_elementos e ON e.id = i.elemento_id
                    WHERE e.auditoria_id = %s AND i.conforme IS FALSE
                    ORDER BY i.elemento_id, i.ref""", (auditoria_id,))
            por_elemento = {}
            for eid, ref, marca, obs in cur.fetchall():
                por_elemento.setdefault(eid, []).append(
                    {"ref": ref, "marca": marca, "observacion": obs})
            for e in aud["elementos"]:
                e["barras_malas"] = por_elemento.get(e["id"], [])
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
                       request: Request, user=Depends(get_current_user)):
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
    es_nc = body.hallazgo in ("hallazgo",)
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
            cerro = _recalcular(cur, auditoria_id)
            audit(email, "auditoria_hallazgo", f"{codigo} · {nombre}: {body.hallazgo}", "auditoria", str(auditoria_id))
    # La acción le llega a quien cubicó. Fuera de la transacción: que falle el aviso no
    # puede deshacer el hallazgo.
    if es_nc and cubico and accion_previa != "verificada":
        _avisar(cubico, f"Auditoría {codigo} · {obra}: {_NOMBRE[body.hallazgo]} en {nombre}. {texto[:120]}")
    aud = detalle(auditoria_id, user)
    # EL RESULTADO, al cerrar: el último hallazgo es el que cierra la auditoría, y es el
    # único momento en que hay algo que contarle a los tres.
    if cerro:
        aud["correo_cierre"] = _avisar_auditoria_cerrada(aud, request)
    return aud


_NOMBRE = {"conforme": "Conforme", "observacion": "Observación", "hallazgo": "Hallazgo"}


def que_se_encontro(elemento, tope: int = 0) -> str:
    """Lo que se encontró en un elemento, en una línea: primero la observación general, si
    el auditor escribió una, y después lo de cada barra con el nombre de la barra adelante.

    Esto se arma AL ESCRIBIR y no al guardar (8-oct). Antes la concatenación se guardaba en
    `texto` y pisaba el campo de la observación general, así que en el informe no se podía
    saber si una frase era del elemento o de una barra. Función pura."""
    partes = []
    general = (elemento.get("texto") or "").strip()
    if general:
        partes.append(general)
    for b in (elemento.get("barras_malas") or []):
        obs = (b.get("observacion") or "").strip()
        if obs:
            partes.append("%s: %s" % (b.get("ref") or b.get("marca") or "barra", obs))
    txt = " · ".join(partes)
    return (txt[:tope - 1] + "…") if (tope and len(txt) > tope) else txt

# LA GRAVEDAD NO SE OPINA, SE MIRA. Un hallazgo atajado antes de que el código saliera no
# es lo mismo que uno que llegó a la obra: el primero se corrige y no le cuesta nada a
# nadie; el segundo obliga a refabricar y ÉSE es el que después pesa en los indicadores.
# El dato que lo decide —el estado del código en aSa— ya está en el espejo.
GRAVEDAD = {
    "antes": "Detectado antes del despacho",
    "despachado": "Detectado después del despacho",
    "sin_dato": "Sin estado del código",
}


def gravedad_de(hallazgo: Optional[str], estado_cc: Optional[str]) -> Optional[str]:
    """La gravedad de un hallazgo, calculada. None cuando no hay hallazgo que graduar.
    Función pura, para poder probarla."""
    if hallazgo != HALLAZGO_ABRE_ACCION:
        return None
    if not estado_cc:
        return "sin_dato"
    return "despachado" if estado_cc == ESTADO_DESPACHADO else "antes"

# Cuánto se acepta escribir en cada campo de ubicación. Son etiquetas de plano («P3»,
# «Ciclo 2», «Eje K2»), no descripciones.
LARGO_UBICACION = 40


class UbicacionBody(BaseModel):
    sector: Optional[str] = None
    piso: Optional[str] = None
    ciclo: Optional[str] = None
    eje: Optional[str] = None


@router.put("/auditorias/{auditoria_id}/elementos/{elemento_id}/ubicacion")
def ubicar_elemento(auditoria_id: int, elemento_id: int, body: UbicacionBody,
                    user=Depends(get_current_user)):
    """DÓNDE ESTÁ EL ELEMENTO, cuando el sistema no lo puede saber.

    QUÉ SE PUEDE SACAR SOLO Y QUÉ NO:

      · En ArmaHub los cuatro campos SON la clave con la que se buscan las barras del
        elemento, y vienen de la cubicación. Acá no se tocan: cambiarlos dejaría la
        auditoría apuntando a un elemento que no existe. Si están mal, se arreglan en la
        cubicación, que es donde el error importa de verdad.
      · En aSa el único que existe es el `ElementID` —en muros ES el eje, con la misma
        nomenclatura de ArmaHub—. El piso y el ciclo no están en ningún campo, y sacarlos
        del texto del nombre del código de control sería adivinar. Así que llegan vacíos y
        los escribe el auditor, que tiene el plano delante.

    El `eje` se puede corregir (aSa dice «01» y en el plano es «Eje A»), y eso no rompe
    nada porque la referencia con la que se le piden las barras a aSa vive aparte, en
    `ref_origen`, y no se toca nunca.
    """
    _puede_auditar(user)
    email = user.get("email", "?")
    campos = {}
    if body.sector is not None:
        s = (body.sector or "").strip()
        if s and s not in SECTORES:
            raise HTTPException(status_code=422, detail="Tipo no válido: " + " / ".join(SECTORES))
        campos["sector"] = s
    for nombre, valor in (("piso", body.piso), ("ciclo", body.ciclo), ("eje", body.eje)):
        if valor is None:
            continue
        v = " ".join((valor or "").split())        # sin dobles espacios ni saltos
        if len(v) > LARGO_UBICACION:
            raise HTTPException(status_code=422,
                                detail="El %s es una etiqueta de plano: hasta %d caracteres."
                                       % (nombre, LARGO_UBICACION))
        campos[nombre] = v
    if not campos:
        raise HTTPException(status_code=400, detail="No llegó ningún campo que escribir.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT a.origen, a.codigo, e.nombre, e.ref_origen, e.eje
                     FROM auditoria_elementos e JOIN auditorias a ON a.id = e.auditoria_id
                    WHERE e.id = %s AND e.auditoria_id = %s""", (elemento_id, auditoria_id))
            el = cur.fetchone()
            if not el:
                raise HTTPException(status_code=404, detail="Ese elemento no es de esta auditoría.")
            origen, codigo, nombre, ref, eje_actual = el
            if origen != "asa":
                raise HTTPException(
                    status_code=400,
                    detail="En una obra de ArmaHub el tipo, el piso, el ciclo y el eje salen de "
                           "la cubicación y son la clave del elemento. Se corrigen en la "
                           "cubicación, no en la auditoría.")
            if "eje" in campos and not campos["eje"]:
                raise HTTPException(status_code=400,
                                    detail="El eje no puede quedar vacío: es cómo se nombra el elemento.")
            # Los nombres de columna salen de una lista cerrada (sector/piso/ciclo/eje), no
            # de lo que mande el navegador; los valores van como parámetros.
            sets = ", ".join(c + " = %s" for c in campos)
            try:
                cur.execute(
                    "UPDATE auditoria_elementos SET " + sets +
                    ", ubicado_por = %s, ubicado_el = now() WHERE id = %s",
                    list(campos.values()) + [email, elemento_id])
            except UniqueViolation:
                raise HTTPException(
                    status_code=400,
                    detail="Esa ubicación ya la tiene otro elemento de esta auditoría. "
                           "Dos elementos distintos no pueden llamarse igual.")
            audit(email, "auditoria_ubicar",
                  "%s · %s: %s" % (codigo, nombre,
                                   ", ".join("%s=%s" % (k, v or "—") for k, v in campos.items())),
                  "auditoria", str(auditoria_id))
    return detalle(auditoria_id, user)


# CÓMO SE NOMBRA A LA GENTE Y A LAS COSAS EN LOS CORREOS (7-oct). Tres reglas del
# usuario: el elemento se identifica entero —código, elemento y la descripción del código,
# que es la que dice piso, ciclo y si es elevación o losa—, las personas van por su nombre
# y no por su correo, y el texto va en tercera persona y formal.
def _nombres(correos) -> dict:
    """email -> «Nombre Apellido». Lo que no esté en la tabla queda con la parte de antes
    del arroba, que es mejor que un correo entero en medio de una frase."""
    correos = sorted({(c or "").strip() for c in (correos or []) if c and "@" in c})
    salida = {c: c.split("@")[0] for c in correos}
    if not correos:
        return salida
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT email, TRIM(COALESCE(nombre,'') || ' ' || COALESCE(apellido,''))
                         FROM users WHERE email = ANY(%s)""", (correos,))
                for email, nombre in cur.fetchall():
                    if (nombre or "").strip():
                        salida[email] = nombre.strip()
    except Exception:
        pass
    return salida


def _quien(correo, nombres) -> str:
    return (nombres or {}).get((correo or "").strip(), (correo or "").split("@")[0] or "—")


def _fecha_larga(iso) -> str:
    """dd/mm/aaaa. Un 2026-10-21 en medio de una frase se lee como un número de serie."""
    s = str(iso or "")[:10]
    p = s.split("-")
    return "%s/%s/%s" % (p[2], p[1], p[0]) if len(p) == 3 else (s or "sin plazo")


def _elemento_txt(e) -> str:
    """El elemento, identificado entero: «SUQC · L101 · LC S1 C5 Lourdes». El código solo
    no le dice nada a nadie; la descripción es la que trae piso, ciclo y de qué es."""
    partes = [x for x in ((e.get("cc") or "").strip(),
                          (e.get("nombre") or e.get("eje") or "").strip(),
                          (e.get("descr_cc") or "").strip()) if x]
    return " · ".join(partes) or "(sin identificar)"


def _lista_elementos(elementos) -> str:
    """Los elementos como lista HTML, para que se lean uno por línea y no en un párrafo."""
    if not elementos:
        return ""
    filas = "".join("<li style='margin:2px 0'>%s</li>" % _elemento_txt(e) for e in elementos)
    return "<ul style='margin:4px 0 0;padding-left:20px'>%s</ul>" % filas


def _html_correo(titulo: str, lineas: list, pie: str = "", enlace: str = "",
                 texto_enlace: str = "Abrir la auditoría") -> str:
    """El correo de una auditoría. Sobrio y corto: lo que hay que hacer, para cuándo y un
    botón que lleva DERECHO a ella (sin el botón, «entra a ArmaHub y búscala» es trabajo
    que se le pasa al que recibe el correo)."""
    cuerpo = "".join("<p style='margin:0 0 8px'>%s</p>" % x for x in lineas)
    boton = ("<p style='margin:18px 0 4px'>"
             "<a href='%s' style=\"display:inline-block;background:#1565C0;color:#fff;"
             "text-decoration:none;font-weight:700;font-size:14px;padding:10px 20px;"
             "border-radius:6px\">%s</a></p>"
             "<p style='margin:0;font-size:11px;color:#90a4ae'>Si el botón no funciona, "
             "copia esta dirección: %s</p>") % (enlace, texto_enlace, enlace) if enlace else ""
    return (
        "<div style=\"font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;"
        "font-size:14px;color:#263238;max-width:620px\">"
        "<h2 style='color:#1565C0;margin:0 0 4px;font-size:18px'>%s</h2>"
        "<hr style='border:0;border-top:2px solid #1565C0;margin:6px 0 14px'>"
        "%s%s"
        "<p style='margin-top:18px;font-size:12px;color:#78909c'>%s</p></div>"
    ) % (titulo, cuerpo, boton, pie or "ArmaHub · Auditorías de cubicación")


def _avisar_correo(destinatarios, asunto: str, titulo: str, lineas: list, enlace: str = ""):
    """Manda el correo si Resend está configurado. NUNCA tumba lo que se estaba haciendo:
    una auditoría creada no se deshace porque el correo falle."""
    destinatarios = sorted({d for d in (destinatarios or []) if d and "@" in d})
    if not destinatarios:
        return {"enviado": False, "motivo": "sin destinatarios"}
    try:
        from . import mailer
        if not mailer.is_configured():
            return {"enviado": False, "motivo": "falta RESEND_API_KEY"}
        mailer.send_email(to=destinatarios, subject=asunto,
                          html=_html_correo(titulo, lineas, enlace=enlace))
        return {"enviado": True, "a": destinatarios}
    except Exception as e:
        return {"enviado": False, "motivo": str(e)[:120]}


# A DÓNDE LLEVA EL BOTÓN DEL CORREO. El front guarda su posición en el hash
# (#mod=...&tab=...), así que un enlace con ese hash abre la pantalla correcta; `aud` lo
# lee el tab de Auditorías y abre ESA auditoría. La base sale de APP_URL si está puesta y,
# si no, de la propia petición: así el enlace sirve igual en Render y en local sin tener
# que acordarse de configurar nada.
def _url_app(request=None) -> str:
    import os
    base = (os.getenv("APP_URL", "") or "").strip().rstrip("/")
    if base:
        return base
    if request is not None:
        try:
            return str(request.base_url).rstrip("/")
        except Exception:
            pass
    return ""


def _enlace_auditoria(aud_id, request=None) -> str:
    base = _url_app(request)
    return "%s/#mod=reclamos&tab=auditorias&aud=%s" % (base, aud_id) if base else ""


# A QUIÉN SE LE MANDA LA COPIA del correo de una auditoría nueva. Por defecto a los `admin`
# y no a todo `ROLES_ADMINISTRAN`: el usuario la pidió para sí mismo y dijo «por ahora que
# no copie a Constanza», que es `admin_calidad`. Con `AUDITORIA_COPIA` (correos separados
# por coma) se cambia sin tocar código — sumar a alguien no debería ser un despliegue.
ROLES_COPIA_AUDITORIA = ("admin",)


def _correo_administracion() -> list:
    """La copia para administración: lo que diga AUDITORIA_COPIA o, si no está, los
    usuarios con rol admin."""
    import os
    fijos = [x.strip() for x in (os.getenv("AUDITORIA_COPIA", "") or "").split(",") if x.strip()]
    if fijos:
        return fijos
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT email FROM users
                        WHERE role = ANY(%s) AND COALESCE(activo, TRUE) AND email IS NOT NULL""",
                    (list(ROLES_COPIA_AUDITORIA),))
                return [r[0] for r in cur.fetchall()]
    except Exception:
        return []


def _avisar_auditoria_nueva(aud: dict, request=None) -> dict:
    """Los correos al asignar una auditoría. Tres destinatarios y un mismo hecho contado
    desde donde le toca a cada uno:

      · al AUDITOR, lo que tiene que revisar y hasta cuándo;
      · al AUDITADO, UNO POR PERSONA y sólo con SUS elementos —antes iban todos en el
        mismo `to:` y cada uno veía a quién más estaban auditando—, con lo que se le pide:
        entregar los planos al auditor y verificar en BShark que sean la versión vigente;
      · a ADMINISTRACIÓN, la copia.

    Todos llevan un botón que abre ESA auditoría. El texto va en tercera persona: es un
    registro de calidad, no un mensaje entre dos personas.
    """
    elementos = aud.get("elementos") or []
    auditados = sorted({(e.get("cubicado_por") or "").strip()
                        for e in elementos if (e.get("cubicado_por") or "").strip()})
    nombres = _nombres([aud.get("auditor")] + auditados)
    audita = _quien(aud.get("auditor"), nombres)
    plazo = _fecha_larga(aud.get("plazo"))
    asignada = _fecha_larga(aud.get("creada"))
    cab = "%s · %s" % (aud["codigo"], aud["obra"])
    enlace = _enlace_auditoria(aud["id"], request)
    # Las tres líneas que comparten los tres correos: de qué auditoría se habla y quiénes
    # son las partes. Repetirlas es a propósito — cada correo tiene que poder leerse solo.
    comunes = [
        "Obra: <b>%s</b>" % aud["obra"],
        "Auditoría: <b>%s</b>" % aud["codigo"],
        "Audita: <b>%s</b>" % audita,
        "Auditado: <b>%s</b>" % (", ".join(_quien(x, nombres) for x in auditados) or "—"),
        "Fecha de asignación: <b>%s</b> · Plazo de cierre: <b>%s</b>" % (asignada, plazo),
    ]

    r1 = _avisar_correo(
        [aud["auditor"]], "Auditoría %s asignada · %s" % (aud["codigo"], aud["obra"]),
        "Auditoría de cubicación asignada",
        comunes + ["Elementos a revisar (%d de %d del alcance):%s"
                   % (len(elementos), aud.get("total_rango") or 0, _lista_elementos(elementos))],
        enlace=enlace)

    # UNO POR AUDITADO: cada uno recibe el suyo, con sus elementos y sin ver los ajenos.
    envios = {}
    for cub in auditados:
        mios = [e for e in elementos if (e.get("cubicado_por") or "").strip() == cub]
        envios[cub] = _avisar_correo(
            [cub], "Auditoría %s · cubicación auditada · %s" % (aud["codigo"], aud["obra"]),
            "Cubicación incluida en una auditoría",
            ["Obra: <b>%s</b>" % aud["obra"],
             "Auditoría: <b>%s</b>" % aud["codigo"],
             "Audita: <b>%s</b>" % audita,
             "Auditado: <b>%s</b>" % _quien(cub, nombres),
             "Fecha de asignación: <b>%s</b> · Plazo de cierre: <b>%s</b>" % (asignada, plazo),
             "Elementos de su cubicación incluidos en la muestra (%d):%s"
             % (len(mios), _lista_elementos(mios)),
             "Debe entregar al auditor los planos de los elementos indicados y verificar en "
             "la plataforma <b>BShark</b> que correspondan a las versiones vigentes.",
             "Las no conformidades que se detecten se asignarán como acción a quien cubicó, "
             "y la corrección se realiza en la cubicación."],
            enlace=enlace)

    # La copia NO repite a quien ya recibió el suyo: dos correos del mismo hecho en la
    # misma bandeja es ruido, y el del auditor dice más.
    ya = set([aud["auditor"]] + auditados)
    copia = [c for c in _correo_administracion() if c not in ya]
    r3 = _avisar_correo(
        copia, "Auditoría %s asignada · %s" % (aud["codigo"], aud["obra"]),
        "Auditoría de cubicación asignada",
        comunes + ["Alcance: <b>%d</b> elementos sorteados de %d · <b>%s</b> kg.%s"
                   % (len(elementos), aud.get("total_rango") or 0,
                      _kg(aud.get("kg")), _lista_elementos(elementos))],
        enlace=enlace)
    return {"auditor": r1, "auditados": envios, "administracion": r3}


def _kg(v) -> str:
    try:
        return format(int(round(float(v or 0))), ",d").replace(",", ".")
    except (TypeError, ValueError):
        return "0"


def _avisar_auditoria_cerrada(aud: dict, request=None) -> dict:
    """EL RESULTADO, cuando la auditoría se cierra. A los tres (pedido del usuario, 7-oct):
    una auditoría que nadie lee no corrige nada, y el cierre es el único momento en que
    hay algo que contar. Un solo correo con el mismo contenido para todos: el resultado es
    el mismo para quien audita, para quien fue auditado y para administración."""
    elementos = aud.get("elementos") or []
    revisados = [e for e in elementos if e.get("hallazgo")]
    res = aud.get("resultado") or {}
    conformes = int(res.get("conforme") or 0)
    pct = round(conformes * 100.0 / len(revisados)) if revisados else 0
    auditados = sorted({(e.get("cubicado_por") or "").strip()
                        for e in elementos if (e.get("cubicado_por") or "").strip()})
    nombres = _nombres([aud.get("auditor")] + auditados)
    no_conformes = [e for e in revisados if e.get("hallazgo") != "conforme"]
    detalle_nc = ""
    if no_conformes:
        filas = "".join(
            "<li style='margin:2px 0'>%s — <b>%s</b>%s</li>"
            % (_elemento_txt(e), _NOMBRE.get(e.get("hallazgo"), e.get("hallazgo") or ""),
               (": " + que_se_encontro(e, 200)) if que_se_encontro(e) else "")
            for e in no_conformes)
        detalle_nc = "<ul style='margin:4px 0 0;padding-left:20px'>%s</ul>" % filas
    lineas = [
        "Obra: <b>%s</b>" % aud["obra"],
        "Auditoría: <b>%s</b>" % aud["codigo"],
        "Audita: <b>%s</b>" % _quien(aud.get("auditor"), nombres),
        "Auditado: <b>%s</b>" % (", ".join(_quien(x, nombres) for x in auditados) or "—"),
        "Fecha de cierre: <b>%s</b>" % _fecha_larga(aud.get("cierre")),
        "Resultado: <b>%d</b> elemento(s) revisados · <b>%d%%</b> de conformidad." % (len(revisados), pct),
        "Conformes: <b>%d</b> · Observaciones: <b>%d</b> · No conformidades menores: <b>%d</b> · "
        "mayores: <b>%d</b>." % (conformes, int(res.get("observacion") or 0),
                                 int(res.get("hallazgo") or 0), int(res.get("hallazgo") or 0)),
    ]
    if no_conformes:
        lineas.append("Elementos con hallazgo:%s" % detalle_nc)
        lineas.append("Acciones abiertas: <b>%d</b>. La corrección la realiza quien cubicó, en su "
                      "cubicación, y el auditor la verifica." % int(aud.get("acciones_abiertas") or 0))
    else:
        lineas.append("No se detectaron no conformidades.")
    ya = set([aud.get("auditor")] + auditados)
    destinatarios = sorted({x for x in ya if x} | {c for c in _correo_administracion() if c})
    return _avisar_correo(
        destinatarios, "Auditoría %s cerrada · %s" % (aud["codigo"], aud["obra"]),
        "Resultado de la auditoría de cubicación", lineas,
        enlace=_enlace_auditoria(aud["id"], request))


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


def _accion_de_items(cur, elemento_id: int) -> Optional[str]:
    """EN QUÉ VA LA CORRECCIÓN DEL ELEMENTO, mirando sus barras. No se elige: se deriva,
    igual que el estado de la auditoría.

    El usuario lo fijó así: «el hallazgo es por ITEM siempre; la corrección también». El
    elemento ya no es la unidad de trabajo —lo es la barra— pero su estado sigue haciendo
    falta para la lista y para el informe, donde una fila por barra no cabe.

      pendiente   queda alguna barra mala sin corregir
      corregida   el auditado las declaró todas corregidas
      verificada  el SISTEMA comprobó contra aSa que ya no están mal. Nadie la pone a
                  mano: antes la ponía el auditor y el usuario lo sacó, porque corregir
                  es responsabilidad del auditado y comprobar es del sistema.
    """
    cur.execute(
        """SELECT COUNT(*), COUNT(*) FILTER (WHERE corregido),
                  COUNT(*) FILTER (WHERE verificado = 'ok')
             FROM auditoria_items WHERE elemento_id = %s AND conforme IS FALSE""",
        (elemento_id,))
    malas, corregidas, verificadas = cur.fetchone()
    if not malas:
        return None
    if verificadas >= malas:
        return "verificada"
    return "corregida" if corregidas >= malas else "pendiente"


def _recalcular(cur, auditoria_id: int) -> bool:
    """El estado y las fechas se DERIVAN de los hallazgos, en la base y no en el front.

    Devuelve True si la auditoría ACABA de cerrarse, para que quien llama mande el correo
    del resultado una sola vez. Se mira el estado anterior en vez de confiar en el nuevo:
    revisar de nuevo el último elemento de una auditoría ya cerrada la deja cerrada igual,
    y no es un cierre."""
    cur.execute("SELECT estado FROM auditorias WHERE id = %s", (auditoria_id,))
    fila = cur.fetchone()
    antes = fila[0] if fila else None
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
    return estado == "cerrada" and antes != "cerrada"


class AccionBody(BaseModel):
    estado: str
    nota: Optional[str] = None


class ItemBody(BaseModel):
    ref: str
    marca: Optional[str] = None
    conforme: bool
    observacion: Optional[str] = None
    # LO QUE DEBERÍA DECIR LA BARRA: {"A": 120, "cant": 103}. Las llaves son las columnas
    # de la grilla. Un texto libre —«la cantidad debe ser 103»— no se puede comparar con
    # nada; esto sí, y es lo que después deja que el sistema compruebe la corrección sin
    # que nadie tenga que mirar.
    esperado: Optional[dict] = None


class RevisionBody(BaseModel):
    """La revisión de UN elemento: el veredicto de cada barra y la severidad del conjunto."""
    items: List[ItemBody] = []
    hallazgo: Optional[str] = None     # severidad; si no viene, se deriva de las barras
    causa: Optional[str] = None
    texto: Optional[str] = None        # opcional: lo que se encontró ya está en las barras


def severidad_derivada(items, severidad: Optional[str]) -> str:
    """El hallazgo DEL ELEMENTO a partir de sus barras. Si todas están conformes es
    conforme y no hay nada que elegir; si alguna no lo está, manda lo que dijo el auditor
    y, si no dijo nada, se asume HALLAZGO —nunca se suaviza a «observación» por omisión,
    porque eso borraría la acción—. Función pura."""
    if not items:
        return severidad or "conforme"
    if all(getattr(i, "conforme", None) if not isinstance(i, dict) else i.get("conforme") for i in items):
        return "conforme"
    if severidad in ("observacion", "hallazgo", "hallazgo"):
        return severidad
    return "hallazgo"


@router.put("/auditorias/{auditoria_id}/elementos/{elemento_id}/revision")
def guardar_revision(auditoria_id: int, elemento_id: int, body: RevisionBody,
                     request: Request, user=Depends(get_current_user)):
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
    # CADA COSA EN SU CAMPO (8-oct). Antes, si el auditor no escribía una observación
    # general, acá se le metía la concatenación de lo que había dicho barra por barra. El
    # resultado era que en el informe «10mmA34: cantidad debe ser 103 · 10mmA5: cantidad
    # debe ser 103» aparecía en la misma columna que un comentario del elemento entero, y
    # no había forma de distinguir uno de otro. Lo cazó el usuario leyendo el resumen.
    #
    # Son dos cosas distintas y se guardan distinto: lo de cada barra vive en su fila de
    # `auditoria_items` —que es donde dice a qué barra le pasa—, y `texto` es sólo lo que
    # el auditor escribió del elemento. Quien arma el informe las junta al mostrarlas.
    texto = (body.texto or "").strip()
    # La evidencia no se pierde por esto: toda barra no conforme está obligada a decir qué
    # tiene (se valida arriba). Sólo hace falta pedir un texto cuando no hay barra alguna
    # que lo explique, que es el caso de un elemento marcado sin revisar sus barras.
    if hallazgo != "conforme" and not texto and not malas:
        raise HTTPException(status_code=400, detail="Di qué encontraste: un hallazgo sin texto no es evidencia.")
    es_nc = hallazgo in ("hallazgo",)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT e.nombre, e.cubicado_por, e.accion_estado, a.codigo, a.obra, e.cc
                     FROM auditoria_elementos e JOIN auditorias a ON a.id = e.auditoria_id
                    WHERE e.id = %s AND e.auditoria_id = %s""", (elemento_id, auditoria_id))
            el = cur.fetchone()
            if not el:
                raise HTTPException(status_code=404, detail="Ese elemento no es de esta auditoría.")
            nombre, cubico, accion_previa, codigo, obra, cc = el
            # El nombre es sólo del elemento: en un aviso suelto hay que decir el código,
            # o el cubicador no sabe en cuál de sus veinte códigos mirar.
            nombre = " · ".join(x for x in (cc, nombre) if x)
            if body.items:
                cur.executemany(
                    """INSERT INTO auditoria_items (elemento_id, ref, marca, conforme, observacion,
                                                    esperado, revisado_por, revisado_el)
                       VALUES (%s,%s,%s,%s,%s,%s,%s, now())
                       ON CONFLICT (elemento_id, ref) DO UPDATE SET
                           marca = EXCLUDED.marca, conforme = EXCLUDED.conforme,
                           observacion = EXCLUDED.observacion, esperado = EXCLUDED.esperado,
                           revisado_por = EXCLUDED.revisado_por, revisado_el = now()""",
                    [(elemento_id, it.ref, it.marca, it.conforme,
                      (it.observacion or "").strip() or None,
                      _json(it.esperado) if it.esperado else None, email)
                     for it in body.items])
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
            cerro = _recalcular(cur, auditoria_id)
            audit(email, "auditoria_revision",
                  "%s · %s: %s (%d barras, %d no conformes)" % (codigo, nombre, hallazgo,
                                                                len(body.items), len(malas)),
                  "auditoria", str(auditoria_id))
    if es_nc and cubico and accion_previa != "verificada":
        _avisar(cubico, "Auditoría %s · %s: %s en %s. %s" % (codigo, obra, _NOMBRE[hallazgo], nombre, texto[:120]))
    aud = detalle(auditoria_id, user)
    if cerro:
        aud["correo_cierre"] = _avisar_auditoria_cerrada(aud, request)
    return aud


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


class CorreccionBody(BaseModel):
    """Lo que declara el AUDITADO sobre una barra que le marcaron."""
    corregido: bool = True
    # Para cuando lo hecho no calza exacto con lo observado. Lo pidió el usuario: «un
    # posible comentario en caso de que haya alguna consideración mixta entre lo
    # observado y lo correcto».
    nota: Optional[str] = None
    # `item` = se corrigió la misma barra, y entonces el sistema puede ir a mirarla.
    # `nuevo` = se hizo un ítem o un código nuevo, y entonces NO puede: la barra vieja va
    # a seguir diciendo lo mismo para siempre y comprobarla diría que no se corrigió.
    tipo: str = "item"
    cc_nuevo: Optional[str] = None


@router.put("/auditorias/{auditoria_id}/items/{item_id}/correccion")
def corregir_item(auditoria_id: int, item_id: int, body: CorreccionBody,
                  user=Depends(get_current_user)):
    """EL AUDITADO DECLARA QUE CORRIGIÓ UNA BARRA.

    Es suyo y de nadie más: el auditor declara el hallazgo y ahí termina su trabajo. Y lo
    que declara acá es un DICHO, no una comprobación — eso lo hace el sistema aparte, y
    por eso se guardan en campos distintos."""
    _puede_ver(user)
    email = user.get("email", "?")
    if body.tipo not in ("item", "nuevo"):
        raise HTTPException(status_code=422, detail="Tipo no válido: item / nuevo.")
    if body.tipo == "nuevo" and not (body.cc_nuevo or "").strip():
        raise HTTPException(status_code=400,
                            detail="Si se hizo un código nuevo, hay que decir cuál: sin eso "
                                   "nadie puede ir a buscarlo después.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT i.elemento_id, i.conforme, i.ref, e.cubicado_por, e.nombre,
                          a.codigo, a.auditor
                     FROM auditoria_items i
                     JOIN auditoria_elementos e ON e.id = i.elemento_id
                     JOIN auditorias a ON a.id = e.auditoria_id
                    WHERE i.id = %s AND e.auditoria_id = %s""", (item_id, auditoria_id))
            fila = cur.fetchone()
            if not fila:
                raise HTTPException(status_code=404, detail="Esa barra no es de esta auditoría.")
            elemento_id, conforme, ref, cubico, nombre, codigo, auditor = fila
            if conforme is not False:
                raise HTTPException(status_code=400,
                                    detail="Esa barra no tiene nada que corregir.")
            # QUIÉN PUEDE: quien cubicó, o administración. El auditor no corrige lo que él
            # mismo marcó, y el resto no tiene nada que hacer acá.
            es_admin = user.get("role") in ROLES_ADMINISTRAN
            if not es_admin and cubico and (cubico or "").strip() not in alias_cubicador(cur, email):
                raise HTTPException(status_code=403,
                                    detail="Esta corrección es de quien cubicó el elemento.")
            cur.execute(
                """UPDATE auditoria_items
                      SET corregido = %s, corregido_por = %s,
                          corregido_el = CASE WHEN %s THEN now() END,
                          nota_correccion = %s, tipo_correccion = %s, cc_nuevo = %s,
                          -- Volver a abrirla borra lo que el sistema había comprobado:
                          -- esa medición era de la corrección anterior.
                          verificado = CASE WHEN %s THEN verificado END,
                          verificado_el = CASE WHEN %s THEN verificado_el END
                    WHERE id = %s""",
                (body.corregido, email if body.corregido else None, body.corregido,
                 (body.nota or "").strip() or None,
                 body.tipo if body.corregido else None,
                 (body.cc_nuevo or "").strip() or None if body.corregido else None,
                 body.corregido, body.corregido, item_id))
            accion = _accion_de_items(cur, elemento_id)
            cur.execute("UPDATE auditoria_elementos SET accion_estado = %s WHERE id = %s",
                        (accion, elemento_id))
            audit(email, "auditoria_correccion",
                  "%s · %s · %s: %s" % (codigo, nombre, ref,
                                        "corregida" if body.corregido else "reabierta"),
                  "auditoria", str(auditoria_id))
    if body.corregido and auditor:
        _avisar(auditor, "Auditoría %s: %s · %s quedó corregida." % (codigo, nombre, ref))
    return detalle(auditoria_id, user)


@router.get("/auditorias/mias/items")
def mis_items(user=Depends(get_current_user)):
    """LO QUE LE TOCA CORREGIR A QUIEN PREGUNTA, barra por barra.

    Reemplaza a la lista por elemento: un elemento son cuatro o ciento cincuenta barras, y
    «este eje tiene un hallazgo» no dice cuál hay que ir a arreglar."""
    _puede_ver(user)
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            quien = alias_cubicador(cur, email)
            cur.execute(
                """SELECT a.id, a.codigo, a.obra, e.id, e.cc,
                          CONCAT_WS(' · ', NULLIF(e.cc, ''), e.nombre),
                          i.id, i.ref, i.marca, i.observacion, i.esperado,
                          i.corregido, i.nota_correccion, i.tipo_correccion, i.cc_nuevo,
                          i.verificado, a.plazo_fecha, a.auditor, e.hallazgo, e.causa
                     FROM auditoria_items i
                     JOIN auditoria_elementos e ON e.id = i.elemento_id
                     JOIN auditorias a ON a.id = e.auditoria_id
                    WHERE i.conforme IS FALSE AND TRIM(e.cubicado_por) = ANY(%s)
                    ORDER BY i.corregido, a.plazo_fecha, a.codigo, e.id, i.ref""",
                (quien,))
            filas = [{"auditoria_id": r[0], "codigo": r[1], "obra": r[2], "elemento_id": r[3],
                      "cc": r[4], "elemento": r[5], "item_id": r[6], "ref": r[7],
                      "marca": r[8], "observacion": r[9], "esperado": r[10] or {},
                      "corregido": bool(r[11]), "nota_correccion": r[12],
                      "tipo_correccion": r[13], "cc_nuevo": r[14], "verificado": r[15],
                      "plazo": r[16].isoformat() if r[16] else None, "auditor": r[17],
                      "hallazgo": r[18], "causa": r[19]} for r in cur.fetchall()]
    hoy = date.today()
    for f in filas:
        # EL PLAZO, REGISTRADO. Todavía no dispara nada —el correo no está— pero el dato
        # viaja desde ya, para que cuando se habilite no haya que reconstruirlo.
        f["vencido"] = bool(f["plazo"] and not f["corregido"]
                            and date.fromisoformat(f["plazo"]) < hoy)
    return {"items": filas,
            "pendientes": sum(1 for f in filas if not f["corregido"]),
            "vencidas": sum(1 for f in filas if f["vencido"])}


@router.get("/auditorias/mias/acciones")
def mis_acciones(user=Depends(get_current_user)):
    """Lo que le toca corregir a quien pregunta: sus no conformidades abiertas."""
    _puede_ver(user)
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                # El elemento con su código de control delante: esta lista se mira sin
                # abrir la auditoría, y el nombre solo no dice en qué código buscarlo.
                """SELECT a.id, a.codigo, a.obra, e.id,
                          CONCAT_WS(' · ', NULLIF(e.cc, ''), e.nombre),
                          e.hallazgo, e.texto, e.causa,
                          e.accion_estado, a.plazo_fecha, a.auditor
                     FROM auditoria_elementos e JOIN auditorias a ON a.id = e.auditoria_id
                    WHERE TRIM(e.cubicado_por) = ANY(%s) AND e.accion_estado IS NOT NULL
                    ORDER BY (e.accion_estado = 'verificada'), a.plazo_fecha""",
                (alias_cubicador(cur, email),))
            filas = [{"auditoria_id": r[0], "codigo": r[1], "obra": r[2], "elemento_id": r[3],
                      "elemento": r[4], "hallazgo": r[5], "texto": r[6], "causa": r[7],
                      "accion_estado": r[8], "plazo": r[9].isoformat() if r[9] else None,
                      "auditor": r[10]} for r in cur.fetchall()]
    return {"acciones": filas}


@router.get("/auditorias/{auditoria_id}/pdf")
def informe_pdf(auditoria_id: int, user=Depends(get_current_user)):
    """El informe de la auditoría, para mandar o archivar. Una página cuando cabe."""
    _puede_ver(user)
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
             "hallazgo": (239, 154, 154), "hallazgo": (198, 40, 40)}
    NOMBRE = {"conforme": "Conforme", "observacion": "Observacion",
              "hallazgo": "No conformidad menor", "hallazgo": "No conformidad mayor"}

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
        for k in ("conforme", "observacion", "hallazgo", "hallazgo"):
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
        orden = {"hallazgo": 0, "observacion": 1, "conforme": 2, None: 3}
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
            titulo = " · ".join(x for x in (e.get("cc"), e["nombre"]) if x)
            p.cell(0, 5, self._s("  %s - %s" % (self.NOMBRE[e["hallazgo"]], titulo)),
                   new_x="LMARGIN", new_y="NEXT")
            p.set_font("Helvetica", "", 9)
            p.set_x(18)
            # Lo que se encontró, junto: la observación del elemento y lo de cada
            # barra. Se arma acá y no se guarda armado (ver que_se_encontro).
            p.multi_cell(self.w - 3, 4.5, self._s(que_se_encontro(e)), new_x="LMARGIN", new_y="NEXT")
            pie = []
            # Dónde está, primero: es lo que el auditado necesita para ir a buscarlo.
            if _ubicacion_txt(e):
                pie.append(_ubicacion_txt(e))
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
            # Con el código delante: esta tabla se lee sola, sin volver a la de hallazgos.
            quien = " · ".join(x for x in (e.get("cc"), e["nombre"]) if x)
            p.cell(74, 5, self._s(quien[:44]), border=0)
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
            "Contando TODAS las auditorias de esta obra: %d de %d %s(s) AUDITABLES revisados "
            "(%d%%), que son el %d%% de sus kilos. Sobre el total de la obra (%d, incluyendo "
            "lo ya despachado, que no se puede auditar) es un %d%%." % (
                c["auditados"], c["auditable"], c["unidad"], c["pct"], c["pct_kg"],
                c["total"], c["pct_total"])),
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
            nc = (r.get("hallazgo") or 0) + (r.get("hallazgo") or 0)
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
