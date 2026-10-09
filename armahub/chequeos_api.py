# -*- coding: utf-8 -*-
"""LA REVISIÓN AUTOMÁTICA, por la API (8-oct).

EL FLUJO, y por qué es así:

  1. Se elige una OBRA. No hay un botón «revisar todo»: pedirle a aSa los ítems de un
     código cuesta 1,7 segundos y hay 3.232 códigos vivos en 296 obras. Revisar todo son
     85 minutos y nadie se queda mirando eso.
  2. La pantalla pide los códigos Open y Processed de esa obra y los recorre UNO POR UNO,
     una llamada por código. Así se ve avanzar, no hay un request largo que se caiga por
     timeout, y si el usuario se va la revisión simplemente se detiene donde iba. Eso es
     lo que pidió el usuario con «una forma de checkear sin romper el sistema».
  3. Cada código revisado deja sus señales. La segunda revisión del mismo código no
     duplica nada: la señal se reconoce por su firma y sólo sube el contador.
  4. Lo que ya no aparece se cierra SOLO. Si una señal estaba marcada para corregir y en
     la siguiente revisión del código ya no está, el sistema la da por corregida. Nadie
     tiene que avisar que arregló algo.

QUÉ SE REGISTRA. Cada revisión deja una fila con quién la lanzó, cuándo, cuántos códigos
y barras miró y qué encontró — sin que nadie llene un formulario. La única firma humana
está en resolver una señal: «está bien» o «hay que corregirla». Un clic, y queda con
nombre y fecha. Lo demás sería burocracia.
"""
import logging
import os
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .asa import AsaError
from .auditorias import (PATRON_OBRAS_FUERA, _avisar, alias_de, _es_barra, _items_de, _puede_auditar,
                         _puede_ver, refs_de_barras)
from .auth import get_current_user
from .chequeos import REGLAS, correr, normalizar_asa
from .db import audit, get_conn

log = logging.getLogger("armahub.chequeos")

router = APIRouter(prefix="/api/v1", tags=["chequeos"])

# QUÉ CÓDIGOS SE REVISAN, Y POR QUÉ SÓLO LOS `Open` (8-oct).
#
# Lo despachado nunca entró: revisar lo que ya salió a la obra llega tarde, igual que en la
# auditoría. Los `Processed` entraban, y el usuario avisó que ésos también llegan tarde.
# Medido sobre las obras con movimiento: de 186 códigos Processed, 86 YA PASARON su fecha
# de despacho proyectada, 88 despachan dentro de siete días y sólo 7 tienen más de una
# semana por delante. Además 165 están confirmados en planta y 77 ya tienen guía, o sea que
# salieron. Revisar eso es encontrar un error cuando el fierro ya está en el camión.
#
# Donde sí hay margen es en los `Open`: de 785, 657 no tienen siquiera fecha de despacho y
# 644 están sin programar en planta.
#
# Se pueden pedir igual —a veces hay que mirar lo que ya se fue, porque es justo donde el
# error costó plata— pero hay que pedirlo, con el chip de la pantalla.
ESTADOS_CON_MARGEN = ("Open",)
ESTADOS_TARDE = ("Processed",)
ESTADOS_VIVOS = ESTADOS_CON_MARGEN + ESTADOS_TARDE


def _estados(incluir_tarde: bool) -> list:
    return list(ESTADOS_VIVOS if incluir_tarde else ESTADOS_CON_MARGEN)
# Los estados en que una señal está esperando a alguien.
ABIERTAS = ("abierta", "corregir")
# OBRA EN PRODUCCIÓN = TUVO MOVIMIENTO EN LOS ÚLTIMOS N MESES. Es el mismo criterio que usa
# el tab de Stock Cubicaciones (`programacion.asa_cubicador`), y se reusa a propósito: dos
# definiciones distintas de «obra activa» conviviendo terminan diciendo cosas distintas.
#
# HACE FALTA. Sin él la lista trae 296 obras y 2.992 códigos, y adentro hay obras cuyo
# último pedido es de 2021 —códigos que nadie cerró en aSa, no trabajo vivo—. Con tres
# meses quedan 62 obras y 917 códigos, que es lo que de verdad se está cubicando. El filtro
# se ve y se puede soltar: una obra se mira igual aunque esté quieta, pero que uno lo pida.
MESES_MOVIMIENTO = 3
# «Todo»: cien años, o sea la historia completa del espejo. Mismo truco que en programación.
VENTANA_TODO = 1200


def _filtro_movimiento(meses: int):
    """El trozo de SQL y su argumento. `meses = 0` es «todas»."""
    if not meses:
        return "", ()
    return (""" AND p.asa_job_id IN (SELECT asa_job_id FROM asa_pedidos
                                      WHERE order_date >= CURRENT_DATE - make_interval(months => %s)
                                      GROUP BY asa_job_id)""", (meses,))


@router.get("/chequeos/reglas")
def listar_reglas(user=Depends(get_current_user)):
    """Qué se revisa y por qué. La pantalla lo muestra tal cual: una regla que nadie
    entiende es una regla que se ignora."""
    _puede_ver(user)
    return {"reglas": [{"codigo": r["codigo"], "nombre": r["nombre"],
                        "corto": r.get("corto") or r["nombre"], "porque": r["porque"]}
                       for r in REGLAS]}


@router.get("/chequeos/obras")
def obras(meses: int = MESES_MOVIMIENTO, tarde: bool = False,
          user=Depends(get_current_user)):
    """Las obras con códigos vivos, con lo que ya se sabe de cada una: cuántos códigos
    tiene, cuántos se revisaron, cuándo fue la última revisión y cuántas señales esperan.

    `meses` es la ventana de movimiento (0 = todas). Ver MESES_MOVIMIENTO."""
    _puede_ver(user)
    meses = max(0, min(int(MESES_MOVIMIENTO if meses is None else meses), 120))
    mov, arg = _filtro_movimiento(meses)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT p.asa_job_id, MAX(p.job_name), COUNT(*),
                          MAX(p.order_date), SUM(p.kg),
                          STRING_AGG(DISTINCT NULLIF(TRIM(p.detail_person),''), ', ')
                     FROM asa_pedidos p
                    WHERE COALESCE(p.estado,'') = ANY(%s)
                      AND p.job_name !~* %s""" + mov + """
                    GROUP BY p.asa_job_id
                    ORDER BY MAX(p.order_date) DESC NULLS LAST""",
                (_estados(tarde), PATRON_OBRAS_FUERA) + arg)
            filas = cur.fetchall()
            cur.execute(
                """SELECT id_proyecto,
                          COUNT(*) FILTER (WHERE estado = ANY(%s)),
                          COUNT(*) FILTER (WHERE estado = 'corregir'),
                          COUNT(DISTINCT cc)
                     FROM chequeo_senales GROUP BY id_proyecto""", (list(ABIERTAS),))
            senales = {r[0]: {"abiertas": r[1], "corregir": r[2], "ccs": r[3]}
                       for r in cur.fetchall()}
            cur.execute(
                """SELECT DISTINCT ON (id_proyecto) id_proyecto, arrancada, lanzada_por, ccs
                     FROM chequeo_revisiones ORDER BY id_proyecto, arrancada DESC""")
            ultima = {r[0]: {"el": r[1].isoformat(), "por": r[2], "ccs": r[3]}
                      for r in cur.fetchall()}
    return {"obras": [
        {"job": r[0], "obra": r[1], "ccs": r[2],
         "ultimo_pedido": r[3].isoformat() if r[3] else None, "kg": float(r[4] or 0),
         "cubico": r[5],
         "senales": senales.get(r[0]) or {"abiertas": 0, "corregir": 0, "ccs": 0},
         "ultima_revision": ultima.get(r[0])}
        for r in filas],
        "meses": meses, "tarde": tarde}


@router.get("/chequeos/codigos")
def codigos(job: str, tarde: bool = False, user=Depends(get_current_user)):
    """Los códigos de una obra que vale la pena revisar, con si ya se revisaron y qué salió.

    Por defecto sólo los `Open`, que son los que tienen margen. Ver ESTADOS_CON_MARGEN."""
    _puede_ver(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT control_code, COALESCE(descr,''), kg, order_date,
                          COALESCE(estado,''), COALESCE(detail_person,'')
                     FROM asa_pedidos
                    WHERE asa_job_id = %s AND COALESCE(estado,'') = ANY(%s)
                      AND job_name !~* %s
                    ORDER BY order_date DESC NULLS LAST, control_code""",
                (job, _estados(tarde), PATRON_OBRAS_FUERA))
            ccs = [{"cc": r[0], "descr": r[1], "kg": float(r[2] or 0),
                    "fecha": r[3].isoformat() if r[3] else None,
                    "estado": r[4], "persona": r[5]} for r in cur.fetchall()]
            cur.execute(
                """SELECT cc, COUNT(*) FILTER (WHERE estado = ANY(%s)), COUNT(*)
                     FROM chequeo_senales WHERE id_proyecto = %s GROUP BY cc""",
                (list(ABIERTAS), job))
            vis = {r[0]: {"abiertas": r[1], "total": r[2]} for r in cur.fetchall()}
            # Cuándo se revisó cada código, y si lo que hay en aSa cambió desde entonces.
            cur.execute(
                """SELECT c.cc, c.revisado_el, c.revisado_por, c.barras, c.error,
                          (p.ultima_mod IS NOT NULL AND c.ultima_mod IS NOT NULL
                           AND p.ultima_mod > c.ultima_mod) AS cambio
                     FROM chequeo_codigos c
                     LEFT JOIN asa_pedidos p ON p.control_code = c.cc
                    WHERE c.id_proyecto = %s""", (job,))
            rev = {r[0]: {"revisado": r[1].isoformat(), "revisado_por": r[2],
                          "barras_vistas": r[3], "error": r[4], "cambio": bool(r[5])}
                   for r in cur.fetchall()}
            cur.execute("SELECT MAX(job_name) FROM asa_pedidos WHERE asa_job_id = %s", (job,))
            obra = (cur.fetchone() or [None])[0]
    for c in ccs:
        c.update(vis.get(c["cc"]) or {"abiertas": 0, "total": 0})
        c.update(rev.get(c["cc"]) or {"revisado": None, "revisado_por": None,
                                      "barras_vistas": 0, "error": None, "cambio": False})
    return {"job": job, "obra": obra, "ccs": ccs, "total": len(ccs)}


class RevisionNueva(BaseModel):
    job: str
    ccs: Optional[List[str]] = None
    tarde: bool = False


@router.post("/chequeos/revision")
def abrir_revision(body: RevisionNueva, user=Depends(get_current_user)):
    """Abre el registro de una revisión y devuelve los códigos a recorrer. La pantalla los
    pide uno por uno: acá no se revisa nada todavía."""
    _puede_auditar(user)
    email = user.get("email", "?")
    datos = codigos(body.job, body.tarde, user)
    pedidos = [c["cc"] for c in datos["ccs"]]
    if body.ccs:
        elegidos = [c for c in pedidos if c in set(body.ccs)]
    else:
        elegidos = pedidos
    if not elegidos:
        raise HTTPException(status_code=400, detail="Esa obra no tiene códigos abiertos o en proceso.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO chequeo_revisiones (id_proyecto, obra, lanzada_por)
                   VALUES (%s,%s,%s) RETURNING id""",
                (body.job, datos["obra"], email))
            rid = cur.fetchone()[0]
    audit(email, "chequeo_revision", "%s · %d codigos" % (datos["obra"] or body.job, len(elegidos)),
          "chequeo", str(rid))
    return {"revision": rid, "job": body.job, "obra": datos["obra"], "ccs": elegidos}


class RevisarCc(BaseModel):
    job: str
    cc: str
    revision: Optional[int] = None


@router.post("/chequeos/revisar")
def revisar_cc(body: RevisarCc, user=Depends(get_current_user)):
    """REVISA UN CÓDIGO. Es el paso que la pantalla repite: un código por llamada, para que
    se vea avanzar y para que ninguna petición dure minutos."""
    # El reloj llama a esta misma función sin pasar por la API. No se le inventa un permiso:
    # se reconoce que no viene de una petición y se salta el control, que es lo único que
    # sobra ahí (no hay nadie a quien negarle nada).
    if user.get("rol_interno") != "reloj":
        _puede_auditar(user)
    email = user.get("email", "?")
    try:
        items = [it for it in _items_de(body.cc) if _es_barra(it)]
    except AsaError as e:
        # Un código que falla no bota la revisión: se cuenta y se sigue con el siguiente.
        _sumar_revision(body.revision, ccs=1, errores=1)
        _marcar_codigo(body.job, body.cc, email, 0, 0, str(e))
        return {"cc": body.cc, "error": str(e), "barras": 0,
                "nuevas": 0, "vistas": 0, "corregidas": 0, "senales": []}
    # LA MISMA REFERENCIA QUE USA LA AUDITORÍA, con la misma función: así una señal y un
    # hallazgo sobre la misma barra se pueden cruzar y se puede medir si la regla acierta.
    refs = refs_de_barras([{"marca": it.get("BarMark")} for it in items])
    barras = []
    for it, ref in zip(items, refs):
        b = normalizar_asa(it, ref)
        if b:
            barras.append(b)
    senales = correr(barras)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(job_name) FROM asa_pedidos WHERE asa_job_id = %s", (body.job,))
            obra = (cur.fetchone() or [None])[0]
            # QUIÉN CUBICÓ ESTE CÓDIGO. Se guarda EN la señal y no se resuelve por join al
            # mirarla: si la obra pasa de manos, un reporte viejo se reescribiría solo y le
            # atribuiría a otro algo que no hizo. Es para saber a quién preguntarle.
            cur.execute("""SELECT NULLIF(TRIM(detail_person),'') FROM asa_pedidos
                            WHERE control_code = %s LIMIT 1""", (body.cc,))
            cubico = (cur.fetchone() or [None])[0]
            # LO QUE YA SE ACEPTÓ NO VUELVE A MOLESTAR. Si alguien dijo que ese patrón está
            # bien en esta obra, la señal nueva nace aceptada con el mismo motivo: queda el
            # registro de que se vio, pero no vuelve a la lista de pendientes.
            cur.execute(
                """SELECT DISTINCT ON (regla, firma_patron) regla, firma_patron, resuelto_por, nota
                     FROM chequeo_senales
                    WHERE id_proyecto = %s AND estado = 'aceptada'
                    ORDER BY regla, firma_patron, resuelto_el DESC""", (body.job,))
            aceptados = {(r[0], r[1]): (r[2], r[3]) for r in cur.fetchall()}

            nuevas = vistas = 0
            for s in senales:
                acep = aceptados.get((s["regla"], s["firma_patron"]))
                cur.execute(
                    """INSERT INTO chequeo_senales
                           (regla, origen, id_proyecto, obra, cc, elemento, ref, marca, figura,
                            diam_mm, cubico, detalle, firma, firma_patron, estado, resuelto_por,
                            nota, resuelto_el)
                       VALUES (%s,'asa',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                               CASE WHEN %s THEN now() END)
                       ON CONFLICT (firma) DO UPDATE
                          SET veces = chequeo_senales.veces + 1, visto_ultimo = now(),
                              detalle = EXCLUDED.detalle, cubico = EXCLUDED.cubico
                       RETURNING (xmax = 0) AS insertada""",
                    (s["regla"], body.job, obra, s["cc"], s["elemento"], s["ref"], s["marca"],
                     s["figura"], s["diam"], cubico, _json(s["detalle"]), s["firma"],
                     s["firma_patron"],
                     "aceptada" if acep else "abierta",
                     acep[0] if acep else None,
                     ("Aceptado antes en esta obra: " + (acep[1] or "sin motivo")) if acep else None,
                     bool(acep)))
                if cur.fetchone()[0]:
                    nuevas += 1
                else:
                    vistas += 1

            # EL SISTEMA COMPRUEBA QUE SE CORRIGIÓ. Lo que estaba esperando y ya no aparece
            # en este código es porque alguien lo arregló en aSa. Se cierra solo.
            vivas = [s["firma"] for s in senales]
            cur.execute(
                """UPDATE chequeo_senales
                      SET estado = 'corregida', resuelto_el = now(),
                          nota = COALESCE(nota || ' · ', '') ||
                                 'Ya no aparece al revisar de nuevo el código.'
                    WHERE id_proyecto = %s AND cc = %s AND estado = ANY(%s)
                      AND NOT (firma = ANY(%s))
                RETURNING id""",
                (body.job, body.cc, list(ABIERTAS), vivas))
            corregidas = len(cur.fetchall())

    # QUE UN CÓDIGO ESTÉ LIMPIO TAMBIÉN ES UN RESULTADO. Si sólo se guardaran las señales,
    # un código sin problemas se vería igual que uno que nadie miró nunca.
    _marcar_codigo(body.job, body.cc, email, len(barras), len(senales), None)
    _sumar_revision(body.revision, ccs=1, barras=len(barras), nuevas=nuevas,
                    vistas=vistas, corregidas=corregidas)
    return {"cc": body.cc, "barras": len(barras), "nuevas": nuevas, "vistas": vistas,
            "corregidas": corregidas,
            "senales": [{"regla": s["regla"], "ref": s["ref"], "texto": s["detalle"]["texto"]}
                        for s in senales]}


def _marcar_codigo(job: str, cc: str, por: str, barras: int, senales: int,
                   error) -> None:
    """Deja escrito que este código se revisó, con la marca de tiempo que tenía en aSa.

    Esa marca es lo que después deja al reloj saltarse lo que no cambió: si el código no se
    tocó desde la última revisión, volver a pedirle los ítems a aSa son segundos tirados."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO chequeo_codigos
                       (id_proyecto, cc, revisado_el, revisado_por, barras, senales,
                        ultima_mod, error)
                   SELECT %s, %s, now(), %s, %s, %s, p.ultima_mod, %s
                     FROM asa_pedidos p WHERE p.control_code = %s LIMIT 1
                   ON CONFLICT (id_proyecto, cc) DO UPDATE
                      SET revisado_el = now(), revisado_por = EXCLUDED.revisado_por,
                          barras = EXCLUDED.barras, senales = EXCLUDED.senales,
                          ultima_mod = EXCLUDED.ultima_mod, error = EXCLUDED.error""",
                (job, cc, por, barras, senales, error, cc))


def _json(d):
    import json
    return json.dumps(d, ensure_ascii=False)


def _sumar_revision(rid, ccs=0, errores=0, barras=0, nuevas=0, vistas=0, corregidas=0) -> None:
    """Va sumando en el registro de la revisión, código a código. Si no hay registro (se
    revisó un código suelto) no pasa nada: la señal igual queda guardada."""
    if not rid:
        return
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE chequeo_revisiones
                      SET ccs = ccs + %s, ccs_error = ccs_error + %s, barras = barras + %s,
                          senales_nuevas = senales_nuevas + %s,
                          senales_vistas = senales_vistas + %s,
                          corregidas = corregidas + %s
                    WHERE id = %s""",
                (ccs, errores, barras, nuevas, vistas, corregidas, rid))


@router.put("/chequeos/revision/{revision_id}/cerrar")
def cerrar_revision(revision_id: int, user=Depends(get_current_user)):
    """Cierra el registro. La pantalla lo llama al terminar de recorrer los códigos."""
    _puede_auditar(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE chequeo_revisiones SET terminada = now() WHERE id = %s RETURNING id",
                        (revision_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Esa revisión no existe.")
    return {"ok": True}


@router.get("/chequeos")
def senales(job: str = "", estado: str = "", regla: str = "", cubico: str = "",
            revision: int = 0, busca: str = "",
            user=Depends(get_current_user)):
    """Las señales, con o sin obra. Por defecto, las que esperan a alguien.

    SIRVE A LA BANDEJA (9-oct). Hasta acá sólo se podía mirar por obra, y el usuario lo
    dijo con todas sus letras: «luego de revisar no entiendo cómo avanzo, debiera tener un
    menú para administrar los hallazgos». Medido ese día: 540 señales en 32 obras, TODAS
    abiertas, ninguna resuelta — porque para verlas había que clickear obra por obra.

    `revision` filtra las que APARECIERON en esa corrida (visto_primero desde que arrancó):
    es lo que responde «¿y las 15 nuevas de recién, dónde están?»."""
    _puede_ver(user)
    where, args = ["s.estado IS NOT NULL"], []
    if job:
        where.append("s.id_proyecto = %s"); args.append(job)
    if regla:
        where.append("s.regla = %s"); args.append(regla)
    if cubico:
        where.append("s.cubico = %s"); args.append(cubico)
    if revision:
        where.append("s.visto_primero >= (SELECT arrancada FROM chequeo_revisiones WHERE id = %s)")
        args.append(revision)
    if busca:
        where.append("(s.cc ILIKE %s OR s.ref ILIKE %s OR s.obra ILIKE %s)")
        args += ["%" + busca + "%"] * 3
    if estado == "todas":
        pass
    elif estado:
        where.append("s.estado = %s"); args.append(estado)
    else:
        where.append("s.estado = ANY(%s)"); args.append(list(ABIERTAS))
    with get_conn() as conn:
        with conn.cursor() as cur:
            cond = " AND ".join(where)
            cur.execute(
                "SELECT s.id, s.regla, s.id_proyecto, s.obra, s.cc, s.elemento, s.ref, s.marca,"
                " s.figura, s.diam_mm, s.detalle, s.veces, s.visto_primero, s.visto_ultimo,"
                " s.estado, s.resuelto_por, s.resuelto_el, s.nota, s.firma_patron, s.cubico"
                " FROM chequeo_senales s WHERE " + cond +
                " ORDER BY s.visto_primero DESC, s.obra, s.cc, s.ref LIMIT 2000", tuple(args))
            filas = cur.fetchall()
            cur.execute(
                """SELECT regla, estado, COUNT(*) FROM chequeo_senales
                    WHERE id_proyecto = %s OR %s = '' GROUP BY regla, estado""", (job, job))
            resumen = {}
            for r, e, n in cur.fetchall():
                resumen.setdefault(r, {})[e] = n
            # LOS CONTEOS DE LA BANDEJA, sobre el MISMO filtro que la lista: cuántas por
            # cubicador y por obra. Es lo que responde «a quién le pido qué».
            cur.execute("SELECT s.cubico, COUNT(*) FROM chequeo_senales s WHERE " + cond +
                        " GROUP BY 1 ORDER BY 2 DESC", tuple(args))
            por_cubicador = [{"cubico": r[0] or "(sin dato)", "n": r[1]} for r in cur.fetchall()]
            cur.execute("SELECT s.id_proyecto, MAX(s.obra), COUNT(*) FROM chequeo_senales s WHERE " +
                        cond + " GROUP BY 1 ORDER BY 3 DESC", tuple(args))
            por_obra = [{"job": r[0], "obra": r[1], "n": r[2]} for r in cur.fetchall()]
            # Y los totales por estado sin filtro, para las pastillas de arriba.
            cur.execute("SELECT estado, COUNT(*) FROM chequeo_senales GROUP BY 1")
            totales = {r[0]: r[1] for r in cur.fetchall()}
    return {"senales": [
        {"id": f[0], "regla": f[1], "job": f[2], "obra": f[3], "cc": f[4], "elemento": f[5],
         "ref": f[6], "marca": f[7], "figura": f[8], "diam": float(f[9] or 0),
         "detalle": f[10], "veces": f[11],
         "visto_primero": f[12].isoformat() if f[12] else None,
         "visto_ultimo": f[13].isoformat() if f[13] else None,
         "estado": f[14], "resuelto_por": f[15],
         "resuelto_el": f[16].isoformat() if f[16] else None,
         "nota": f[17], "patron": f[18], "cubico": f[19]} for f in filas],
        "resumen": resumen, "por_cubicador": por_cubicador, "por_obra": por_obra,
        "totales": totales, "total": len(filas),
        "reglas": {r["codigo"]: {"nombre": r["nombre"], "porque": r["porque"]} for r in REGLAS}}


class ResolverBody(BaseModel):
    estado: str
    nota: Optional[str] = None
    patron: bool = False


class ResolverVariasBody(BaseModel):
    """Varias señales de un golpe, elegidas a mano en la bandeja."""
    ids: List[int]
    estado: str
    nota: Optional[str] = None


def _email_de_login(cur, login: str) -> Optional[str]:
    """El correo del cubicador que en aSa se llama `login`. La misma regla que usan las
    auditorías (`alias_de`): el login es la inicial del nombre pegada al apellido."""
    if not login:
        return None
    cur.execute("SELECT email, nombre, apellido FROM users WHERE COALESCE(activo, TRUE)")
    for email, nombre, apellido in cur.fetchall():
        if alias_de(nombre or "", apellido or "", login):
            return email
    return None


def _avisar_por_corregir(cur, ids: list) -> int:
    """Le avisa a cada cubicador cuántas barras suyas quedaron POR CORREGIR, y dónde.

    ERA EL HUECO DEL FLUJO: marcar «hay que corregirla» no le llegaba a nadie. La señal
    quedaba en `corregir` esperando a que el cubicador la arreglara en aSa, y el cubicador
    no tenía cómo saberlo. Un aviso por persona, con la lista de códigos, no uno por barra."""
    if not ids:
        return 0
    cur.execute(
        """SELECT cubico, MAX(obra), STRING_AGG(DISTINCT cc, ', '), COUNT(*)
             FROM chequeo_senales WHERE id = ANY(%s) AND estado = 'corregir'
            GROUP BY cubico""", (ids,))
    avisados = 0
    for login, obra, ccs, n in cur.fetchall():
        email = _email_de_login(cur, login)
        if not email:
            continue
        _avisar(email, "Chequeo · %s: %d barra(s) tuyas por corregir en %s. Se comprueba solo "
                       "al volver a revisar el código." % (obra or "?", n, ccs[:120]))
        avisados += 1
    return avisados


def _resolver_ids(cur, ids: list, estado: str, nota, email: str) -> list:
    """La escritura, una sola para los tres caminos (una, patrón, varias). Lo ya corregido
    por el sistema no se pisa: eso lo comprobó aSa, no una persona."""
    cur.execute(
        """UPDATE chequeo_senales
              SET estado = %s, resuelto_por = %s, resuelto_el = now(), nota = %s
            WHERE id = ANY(%s) AND estado <> 'corregida' RETURNING id""",
        (estado, email, (nota or "").strip() or None, ids))
    return [r[0] for r in cur.fetchall()]


@router.put("/chequeos/senales")
def resolver_varias(body: ResolverVariasBody, user=Depends(get_current_user)):
    """Varias señales elegidas a mano, de un golpe. Con 540 abiertas, de a una no se avanza."""
    _puede_auditar(user)
    email = user.get("email", "?")
    if body.estado not in ("aceptada", "corregir", "abierta"):
        raise HTTPException(status_code=422, detail="Estado no válido: aceptada / corregir / abierta.")
    if body.estado == "aceptada" and not (body.nota or "").strip():
        raise HTTPException(status_code=400, detail="Di por qué están bien: queda en cada señal.")
    if not body.ids:
        raise HTTPException(status_code=400, detail="No elegiste ninguna señal.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            hechas = _resolver_ids(cur, list(body.ids), body.estado, body.nota, email)
            avisados = _avisar_por_corregir(cur, hechas) if body.estado == "corregir" else 0
    audit(email, "chequeo_senales", "%d señal(es) -> %s" % (len(hechas), body.estado), "chequeo", "varias")
    return {"ok": True, "afectadas": len(hechas), "avisados": avisados}


@router.put("/chequeos/senal/{senal_id}")
def resolver(senal_id: int, body: ResolverBody, user=Depends(get_current_user)):
    """LA ÚNICA FIRMA HUMANA: alguien dice que la señal está bien o que hay que corregirla.

    Con `patron` se aplica a todas las iguales de la obra: con cuatro formas distintas
    repetidas en decenas de códigos, resolverlas de a una es lo que haría que nadie use
    esto a la semana. Marcar CORREGIDA a mano no se puede: eso lo comprueba el sistema
    volviendo a revisar el código."""
    _puede_auditar(user)
    email = user.get("email", "?")
    if body.estado not in ("aceptada", "corregir", "abierta"):
        raise HTTPException(status_code=422,
                            detail="Estado no válido: aceptada / corregir / abierta.")
    if body.estado == "aceptada" and not (body.nota or "").strip():
        raise HTTPException(status_code=400,
                            detail="Di por qué está bien: una señal aceptada sin motivo no se "
                                   "puede revisar después.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto, regla, firma_patron, cc, ref FROM chequeo_senales WHERE id = %s",
                        (senal_id,))
            fila = cur.fetchone()
            if not fila:
                raise HTTPException(status_code=404, detail="Esa señal no existe.")
            job, regla, patron, cc, ref = fila
            if body.patron:
                cur.execute(
                    """SELECT id FROM chequeo_senales
                        WHERE id_proyecto = %s AND regla = %s AND firma_patron = %s""",
                    (job, regla, patron))
                ids = [r[0] for r in cur.fetchall()]
            else:
                ids = [senal_id]
            hechas = _resolver_ids(cur, ids, body.estado, body.nota, email)
            n = len(hechas)
            avisados = _avisar_por_corregir(cur, hechas) if body.estado == "corregir" else 0
    audit(email, "chequeo_senal", "%s · %s · %s -> %s%s" % (cc, ref, regla, body.estado,
                                                            " (patrón, %d)" % n if body.patron else ""),
          "chequeo", str(senal_id))
    return {"ok": True, "afectadas": n, "avisados": avisados}


# ─────────────────────────────────────────────────────────────────────────────
# LA REVISIÓN QUE CORRE SOLA
# ─────────────────────────────────────────────────────────────────────────────
# Cuelga del reloj de aSa (ver asa_scheduler), una vez al día después de sincronizar. Lo
# que la hace viable es que NO barre todo: mira sólo los códigos que nunca se revisaron y
# los que CAMBIARON en aSa desde la última revisión. La primera pasada es larga; después,
# un día normal son decenas de códigos.
#
# Y TIENE PRESUPUESTO. Corre dentro del proceso web, así que no puede quedarse horas: se
# detiene al llegar al tope de códigos o al de minutos, lo que pase primero, y deja escrito
# que se cortó y cuántos quedaban. Una revisión a medias que se ve completa es peor que no
# tenerla.
TOPE_AUTO = int(os.getenv("CHEQUEO_TOPE_CODIGOS", "300") or 300)
MINUTOS_AUTO = float(os.getenv("CHEQUEO_MINUTOS", "15") or 15)


def pendientes(limite: int = 0, meses: int = MESES_MOVIMIENTO, tarde: bool = False) -> list:
    """Los códigos que vale la pena revisar, los más nuevos primero. Función aparte para
    poder preguntarle a la pantalla «cuánto falta» sin revisar nada.

    EL RELOJ TAMPOCO BARRE OBRAS MUERTAS. Sin la ventana de movimiento la cola son 2.992
    códigos, y más de la mitad son de obras cuyo último pedido es de hace años: gastar
    segundos de aSa en cada uno para marcar barras que nadie va a corregir."""
    mov, arg = _filtro_movimiento(meses)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT p.asa_job_id, p.control_code, MAX(p.job_name)
                     FROM asa_pedidos p
                     LEFT JOIN chequeo_codigos c
                            ON c.id_proyecto = p.asa_job_id AND c.cc = p.control_code
                    WHERE COALESCE(p.estado,'') = ANY(%s)
                      AND p.job_name !~* %s
                      AND (c.cc IS NULL
                           OR (p.ultima_mod IS NOT NULL AND c.ultima_mod IS NOT NULL
                               AND p.ultima_mod > c.ultima_mod))""" + mov + """
                    GROUP BY p.asa_job_id, p.control_code
                    ORDER BY MAX(p.order_date) DESC NULLS LAST
                    """ + ("LIMIT %s" if limite else ""),
                (_estados(tarde), PATRON_OBRAS_FUERA) + arg + ((limite,) if limite else ()))
            return [{"job": r[0], "cc": r[1], "obra": r[2]} for r in cur.fetchall()]


def barrido_automatico(lanzado_por: str = "reloj") -> dict:
    """Revisa lo que haya cambiado, con tope de códigos y de minutos. La llama el reloj."""
    inicio = time.time()
    cola = pendientes(TOPE_AUTO)
    if not cola:
        return {"ccs": 0, "senales": 0, "motivo": "nada pendiente"}
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO chequeo_revisiones (id_proyecto, obra, lanzada_por)
                   VALUES (%s,%s,%s) RETURNING id""",
                ("(varias)" if len({c["job"] for c in cola}) > 1 else cola[0]["job"],
                 "Revisión automática", lanzado_por))
            rid = cur.fetchone()[0]
    hechos = nuevas = 0
    cortada = None
    for i, c in enumerate(cola):
        if (time.time() - inicio) / 60.0 >= MINUTOS_AUTO:
            cortada = "Se cortó por el tope de %g minutos: quedaban %d códigos." % (
                MINUTOS_AUTO, len(cola) - i)
            break
        try:
            r = revisar_cc(RevisarCc(job=c["job"], cc=c["cc"], revision=rid),
                           {"email": lanzado_por, "rol_interno": "reloj"})
            hechos += 1
            nuevas += r.get("nuevas", 0)
        except Exception as e:          # noqa: BLE001 — un código no puede botar el barrido
            log.warning("Revisión automática: %s falló (%s)", c["cc"], e)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE chequeo_revisiones SET terminada = now(), nota = %s WHERE id = %s",
                        (cortada, rid))
    return {"revision": rid, "ccs": hechos, "senales": nuevas,
            "motivo": cortada or "terminó la cola"}


@router.get("/chequeos/pendientes")
def cuantos_pendientes(limite: int = 0, tarde: bool = False,
                       user=Depends(get_current_user)):
    """Qué códigos esperan revisión: los que nunca se miraron y los que cambiaron en aSa.

    Devuelve la CUENTA y, si se pide un límite, la cola. Con eso la pantalla puede ofrecer
    «revisar lo pendiente» y recorrerlo de a uno, igual que cuando se elige una obra. NO
    hay un endpoint que haga el barrido entero de una: serían quince minutos colgado de un
    request, y el navegador —o Render— lo cortan antes. El barrido largo corre en el reloj,
    que no tiene a nadie esperando del otro lado."""
    _puede_ver(user)
    cola = pendientes(limite or 0, tarde=tarde)
    total = len(cola) if not limite else len(pendientes(0, tarde=tarde))
    return {"pendientes": total, "obras": len({c["job"] for c in cola}),
            "cola": cola if limite else [], "tope": TOPE_AUTO, "minutos": MINUTOS_AUTO}


class RevisionPendientes(BaseModel):
    limite: int = TOPE_AUTO
    tarde: bool = False


@router.post("/chequeos/revision-pendientes")
def abrir_revision_pendientes(body: RevisionPendientes, user=Depends(get_current_user)):
    """Abre el registro de una revisión de lo pendiente, y devuelve la cola. La pantalla la
    recorre de a uno, como la de una obra."""
    _puede_auditar(user)
    email = user.get("email", "?")
    cola = pendientes(max(1, min(body.limite or TOPE_AUTO, 2000)), tarde=body.tarde)
    if not cola:
        raise HTTPException(status_code=400, detail="No hay códigos pendientes de revisar.")
    jobs = {c["job"] for c in cola}
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO chequeo_revisiones (id_proyecto, obra, lanzada_por)
                   VALUES (%s,%s,%s) RETURNING id""",
                ("(varias)" if len(jobs) > 1 else cola[0]["job"],
                 "Pendientes · %d obra(s)" % len(jobs), email))
            rid = cur.fetchone()[0]
    audit(email, "chequeo_revision", "pendientes · %d codigos · %d obras" % (len(cola), len(jobs)),
          "chequeo", str(rid))
    return {"revision": rid, "ccs": cola, "obras": len(jobs)}


@router.get("/chequeos/reporte")
def reporte(meses: int = MESES_MOVIMIENTO, tarde: bool = False,
            user=Depends(get_current_user)):
    """EL REPORTE MASIVO, UNA FILA POR OBRA.

    La pantalla de una obra responde «qué arreglo acá». Esto responde otra cosa: dónde está
    concentrado el problema y a quién hay que preguntarle. Por eso va por obra y no por
    barra, trae quién cubicó, y separa lo revisado de lo que falta mirar — una obra con
    cero señales y cero códigos revisados no está limpia, está sin revisar, y leerlas igual
    sería el peor error que puede cometer un reporte así.

    NO ES UN RANKING DE PERSONAS. Las señales las levanta una máquina y buena parte van a
    ser correctas; sumarlas por cubicador sería medir las reglas, no a la gente. El nombre
    está para saber a quién preguntarle."""
    _puede_ver(user)
    meses = max(0, min(int(MESES_MOVIMIENTO if meses is None else meses), 120))
    mov, arg = _filtro_movimiento(meses)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT p.asa_job_id, MAX(p.job_name), COUNT(*), SUM(p.kg),
                          STRING_AGG(DISTINCT NULLIF(TRIM(p.detail_person),''), ', '),
                          MAX(p.order_date)
                     FROM asa_pedidos p
                    WHERE COALESCE(p.estado,'') = ANY(%s)
                      AND p.job_name !~* %s""" + mov + """
                    GROUP BY p.asa_job_id""",
                (_estados(tarde), PATRON_OBRAS_FUERA) + arg)
            base = {r[0]: {"job": r[0], "obra": r[1], "ccs": r[2], "kg": float(r[3] or 0),
                           "cubico": r[4], "ultimo_pedido": r[5].isoformat() if r[5] else None,
                           "revisados": 0, "barras": 0, "abiertas": 0, "corregir": 0,
                           "aceptadas": 0, "corregidas": 0, "por_regla": {}, "quienes": [],
                           "ultima_revision": None}
                    for r in cur.fetchall()}
            cur.execute(
                """SELECT id_proyecto, COUNT(*), SUM(barras), MAX(revisado_el)
                     FROM chequeo_codigos GROUP BY id_proyecto""")
            for job, n, barras, ult in cur.fetchall():
                if job in base:
                    base[job].update({"revisados": n, "barras": int(barras or 0),
                                      "ultima_revision": ult.isoformat() if ult else None})
            cur.execute(
                """SELECT id_proyecto, regla, estado, COUNT(*),
                          STRING_AGG(DISTINCT cubico, ', ')
                     FROM chequeo_senales GROUP BY id_proyecto, regla, estado""")
            for job, regla, estado, n, quienes in cur.fetchall():
                o = base.get(job)
                if not o:
                    continue
                if estado in ABIERTAS:
                    o["abiertas"] += n
                    o["por_regla"][regla] = o["por_regla"].get(regla, 0) + n
                    for q in (quienes or "").split(", "):
                        if q and q not in o["quienes"]:
                            o["quienes"].append(q)
                if estado == "corregir":
                    o["corregir"] += n
                if estado == "aceptada":
                    o["aceptadas"] += n
                if estado == "corregida":
                    o["corregidas"] += n
    filas = sorted(base.values(), key=lambda o: (-o["abiertas"], -(o["ccs"] - o["revisados"])))
    return {"obras": filas, "meses": meses, "tarde": tarde,
            "reglas": {r["codigo"]: r.get("corto") or r["nombre"] for r in REGLAS},
            "total": {"obras": len(filas),
                      "ccs": sum(o["ccs"] for o in filas),
                      "revisados": sum(o["revisados"] for o in filas),
                      "barras": sum(o["barras"] for o in filas),
                      "abiertas": sum(o["abiertas"] for o in filas),
                      "corregir": sum(o["corregir"] for o in filas),
                      "corregidas": sum(o["corregidas"] for o in filas)}}


@router.get("/chequeos/revisiones")
def revisiones(job: str = "", user=Depends(get_current_user)):
    """El registro de las revisiones: quién, cuándo y qué salió. Se escribe solo."""
    _puede_ver(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, id_proyecto, obra, lanzada_por, arrancada, terminada, ccs,
                          ccs_error, barras, senales_nuevas, senales_vistas, corregidas
                     FROM chequeo_revisiones
                    WHERE (%s = '' OR id_proyecto = %s)
                    ORDER BY arrancada DESC LIMIT 60""", (job, job))
            filas = cur.fetchall()
    return {"revisiones": [
        {"id": f[0], "job": f[1], "obra": f[2], "por": f[3],
         "arrancada": f[4].isoformat(), "terminada": f[5].isoformat() if f[5] else None,
         "ccs": f[6], "ccs_error": f[7], "barras": f[8], "nuevas": f[9],
         "vistas": f[10], "corregidas": f[11]} for f in filas]}
