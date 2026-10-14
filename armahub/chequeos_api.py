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
from .auditorias import (PATRON_OBRAS_FUERA, ROLES_ADMINISTRAN, _avisar, alias_de, alias_cubicador,
                         _es_barra, _items_de, _puede_auditar, _puede_ver, refs_de_barras)
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
                      AND p.job_name !~* %s AND p.asa_job_id NOT IN (SELECT asa_job_id FROM asa_obras WHERE excluida)""" + mov + """
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
                      AND job_name !~* %s AND asa_job_id NOT IN (SELECT asa_job_id FROM asa_obras WHERE excluida)
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
                            nota, resuelto_el, revision_id)
                       VALUES (%s,'asa',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                               CASE WHEN %s THEN now() END, %s)
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
                     bool(acep),
                     # DE QUÉ REVISIÓN ES. Sólo al INSERTAR: una señal que ya existía sigue
                     # siendo de la corrida que la encontró, aunque se vuelva a ver.
                     body.revision))
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
                      AND p.job_name !~* %s AND p.asa_job_id NOT IN (SELECT asa_job_id FROM asa_obras WHERE excluida)
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


# ══════ LA TAREA DEL CUBICADOR (13-oct) ══════
#
# «Hay que corregirla» le llegaba al cubicador como un aviso en la campana, y nada más: no
# tenía dónde ver sus barras ni cómo cerrarlas. El usuario lo dijo: «debiera enviarse
# como tarea al cubicador y que tenga una forma de hacerle seguimiento y modificar; por
# último se hace el check automático que valide esa modificación». Son estos dos
# endpoints: lo mío, y comprobar.

def _fila_senal(r) -> dict:
    """La misma forma que devuelve /chequeos, para que la pantalla trate igual una señal
    venga de donde venga."""
    return {"id": r[0], "regla": r[1], "job": r[2], "obra": r[3], "cc": r[4], "elemento": r[5],
            "ref": r[6], "marca": r[7], "figura": r[8], "diam": float(r[9] or 0),
            "detalle": r[10], "veces": r[11],
            "visto_primero": r[12].isoformat() if r[12] else None,
            "visto_ultimo": r[13].isoformat() if r[13] else None,
            "estado": r[14], "resuelto_por": r[15],
            "resuelto_el": r[16].isoformat() if r[16] else None,
            "nota": r[17], "patron": r[18], "cubico": r[19]}


_COLS_SENAL = ("s.id, s.regla, s.id_proyecto, s.obra, s.cc, s.elemento, s.ref, s.marca,"
               " s.figura, s.diam_mm, s.detalle, s.veces, s.visto_primero, s.visto_ultimo,"
               " s.estado, s.resuelto_por, s.resuelto_el, s.nota, s.firma_patron, s.cubico")


@router.get("/chequeos/mios")
def mios(user=Depends(get_current_user)):
    """Las señales que ME marcaron para corregir: las de los códigos que yo cubiqué. El
    `cubico` de la señal es el login de aSa; se resuelve con la misma regla que las
    auditorías (`alias_cubicador`), así que llega a quien corresponde aunque el login no
    se parezca al correo.

    LO MÍO ES LO QUE ESTÁ ABIERTO O DECLARADO, no un estado aparte. Esto filtraba por
    'corregir', que era el paso de ASIGNAR —el usuario lo eliminó: la señal nace con dueño—
    y desde la migración 146 ya no existe ninguna fila así, con lo que la caja salía
    siempre vacía."""
    _puede_ver(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            quien = alias_cubicador(cur, user.get("email", "?"))
            cur.execute(
                "SELECT " + _COLS_SENAL + """ FROM chequeo_senales s
                  WHERE s.estado IN ('abierta', 'declarada')
                    AND TRIM(COALESCE(s.cubico, '')) = ANY(%s)
                  ORDER BY s.visto_primero DESC, s.obra, s.cc, s.ref""", (quien,))
            filas = [_fila_senal(r) for r in cur.fetchall()]
    return {"senales": filas, "n": len(filas),
            "reglas": {r["codigo"]: {"nombre": r["nombre"], "porque": r["porque"]} for r in REGLAS}}


@router.post("/chequeos/senal/{senal_id}/comprobar")
def comprobar_senal(senal_id: int, user=Depends(get_current_user)):
    """EL CHECK AUTOMÁTICO, A UN CLIC. Vuelve a leer en aSa el código de esta señal —en
    vivo, no del espejo— y corre las reglas de nuevo. Si la señal ya no salta, `revisar_cc`
    la deja CORREGIDA (es la misma lógica de siempre, no otra); si salta igual, se devuelve
    lo que mide hoy para que el cubicador vea qué falta.

    Lo puede pedir el cubicador desde «mis chequeos» y el auditor desde la bandeja: la
    comprobación es del sistema, no de una persona, así que da lo mismo quién la gatille."""
    _puede_ver(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto, cc, estado FROM chequeo_senales WHERE id = %s", (senal_id,))
            fila = cur.fetchone()
    if not fila:
        raise HTTPException(status_code=404, detail="Esa señal no existe.")
    job, cc, estado_antes = fila
    if estado_antes == "corregida":
        return {"id": senal_id, "estado": "corregida", "cc": cc, "ya_estaba": True}
    r = revisar_cc(RevisarCc(job=job, cc=cc), user)
    if r.get("error"):
        raise HTTPException(status_code=502, detail="aSa no respondió por el código %s: %s" % (cc, r["error"]))
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT estado, detalle, nota FROM chequeo_senales WHERE id = %s", (senal_id,))
            estado, detalle, nota = cur.fetchone()
    audit(user.get("email", "?"), "chequeo_comprobar", "%s · señal %s: %s -> %s" % (cc, senal_id, estado_antes, estado),
          "chequeo", str(senal_id))
    return {"id": senal_id, "estado": estado, "cc": cc, "job": job,
            "texto": (detalle or {}).get("texto") if estado != "corregida" else None,
            "barras": r.get("barras", 0), "corregidas_en_el_codigo": r.get("corregidas", 0)}


# ══════ LOS HALLAZGOS SE AGRUPAN POR CUBICADOR (13-oct) ══════
#
# Lo decidió el usuario: «mejor agrupamos de una por cubicador; al presionar se abre un
# modal que resume ordenadamente todas las barras con problemas. Eso me permite generar una
# acción por cubicador, y se envía todo listo».
#
# Y es lo correcto: una señal suelta no es accionable —nadie corrige UNA barra— pero «estas
# 47 barras tuyas, en estos 9 códigos» sí es un encargo. La lista de 540 filas servía para
# mirar; ésta sirve para repartir trabajo.

# ══════ EL CICLO DE UN HALLAZGO ══════
#
#   Abierta ──[declarar]──> Corregida (declarada) ──[verificar en aSa]──> Verificada ✓
#       │                         └──────── sigue igual ────────> vuelve a Abierta
#       └──[no aplica + justificación]──> No aplica –
#
# ISO 9001 §10.2 separa la CORRECCIÓN de la VERIFICACIÓN de su eficacia, y acá son dos
# actos de dos actores: la corrección la declara una persona, la eficacia la comprueba el
# sistema leyendo aSa. Que alguien pudiera marcar «verificada» sería firmar su propia tarea.
ESTADO_TXT = {"abierta": "Abierta", "declarada": "Corregida (por verificar)",
              "corregida": "Verificada", "aceptada": "No aplica", "corregir": "Corregida (por verificar)"}
# Los motivos por los que un hallazgo NO aplica. El usuario acotó cuándo es legítimo, y
# categorizarlo permite leer lo que el texto libre esconde: si muchos marcan «la regla no
# aplica a esta figura», el problema está en la REGLA.
MOTIVOS_NO_APLICA = {
    "figura": "La regla no aplica a esta figura",
    "produccion": "Confirmado con producción: debe ir así",
    "cliente": "Lo pide el cliente y no hay otra forma",
    "otro": "Otro (explicar)",
}


class DeclararBody(BaseModel):
    """Lo que declara quien corrigió, o quien deja un hallazgo sin efecto."""
    ids: List[int]
    estado: str                        # declarada | aceptada | abierta
    motivo_tipo: Optional[str] = None  # sólo para 'aceptada'
    nota: Optional[str] = None
    # «Y TODAS LAS IGUALES DE LA OBRA». Sólo para «no aplica», y es lo que hace que esto
    # se siga usando a la semana: una figura que la regla marca siempre sale decenas de
    # veces en la misma obra, y explicar treinta veces lo mismo es como no tenerlo.
    patron: bool = False


@router.put("/chequeos/declarar")
def declarar(body: DeclararBody, user=Depends(get_current_user)):
    """EL RESPONSABLE DECLARA: «ya la corregí» o «esto no aplica, por esto».

    Quién puede: quien cubicó el código, o administración. El resto no: un hallazgo es de
    quien lo hizo, y marcar lo ajeno dejaría el registro sin dueño.

    «No aplica» exige motivo Y explicación, y queda firmado. El usuario fue explícito en
    que sólo se justifica con una confirmación de producción o del cliente, o cuando la
    regla no aplica a esa figura: si se usa mal, el error salta en producción y el registro
    dice quién lo dejó pasar."""
    _puede_ver(user)
    email = user.get("email", "?")
    if body.estado not in ("declarada", "aceptada", "abierta"):
        raise HTTPException(status_code=422, detail="Estado no válido.")
    nota = (body.nota or "").strip()
    if body.estado == "aceptada":
        if body.motivo_tipo not in MOTIVOS_NO_APLICA:
            raise HTTPException(status_code=400, detail="Elige por qué no aplica.")
        if len(nota) < 10:
            raise HTTPException(
                status_code=400,
                detail="Explica por qué no aplica: lo va a leer quien audita y queda en el registro.")
    ids = list(dict.fromkeys(body.ids or []))
    if not ids:
        raise HTTPException(status_code=400, detail="No marcaste ninguna barra.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT id, cubico, cc, ref FROM chequeo_senales
                            WHERE id = ANY(%s) AND estado <> 'corregida'""", (ids,))
            filas = cur.fetchall()
            if not filas:
                raise HTTPException(status_code=400,
                                    detail="Esas barras ya están verificadas: no hay nada que declarar.")
            if user.get("role") not in ROLES_ADMINISTRAN:
                mios = set(alias_cubicador(cur, email))
                ajenas = {f[1] for f in filas if (f[1] or "").strip() and (f[1] or "").strip() not in mios}
                if ajenas:
                    raise HTTPException(
                        status_code=403,
                        detail="Hay barras que cubicó otra persona (%s): sólo puede declararlas quien las hizo."
                               % ", ".join(sorted(ajenas)[:3]))
            ids = [f[0] for f in filas]
            # «Y TODAS LAS IGUALES»: se suman las señales de la misma obra con la misma
            # regla y la misma firma —la figura que la regla marca siempre— que todavía
            # están abiertas. Las ya resueltas no se tocan: cada una tiene su firma y su
            # motivo, y reescribirlas borraría lo que alguien decidió antes.
            if body.patron and body.estado == "aceptada":
                cur.execute(
                    """SELECT s.id FROM chequeo_senales s
                         JOIN chequeo_senales o ON o.id_proyecto = s.id_proyecto
                                               AND o.regla = s.regla
                                               AND o.firma_patron = s.firma_patron
                        WHERE o.id = ANY(%s) AND s.estado IN ('abierta', 'declarada')""",
                    (ids,))
                del_patron = [r[0] for r in cur.fetchall()]
                if user.get("role") not in ROLES_ADMINISTRAN and del_patron:
                    # Las del patrón que cubicó otra persona no entran: un hallazgo es de
                    # quien lo hizo, y acá se estaría resolviendo lo ajeno sin pedirlo.
                    cur.execute(
                        """SELECT id FROM chequeo_senales
                            WHERE id = ANY(%s) AND TRIM(COALESCE(cubico, '')) = ANY(%s)""",
                        (del_patron, list(mios)))
                    del_patron = [r[0] for r in cur.fetchall()]
                ids = sorted(set(ids) | set(del_patron))
            if body.estado == "declarada":
                cur.execute(
                    """UPDATE chequeo_senales
                          SET estado = 'declarada', declarada_por = %s, declarada_el = now(),
                              nota = NULLIF(%s, ''), motivo_tipo = NULL
                        WHERE id = ANY(%s)""", (email, nota, ids))
            elif body.estado == "aceptada":
                cur.execute(
                    """UPDATE chequeo_senales
                          SET estado = 'aceptada', resuelto_por = %s, resuelto_el = now(),
                              nota = %s, motivo_tipo = %s
                        WHERE id = ANY(%s)""", (email, nota, body.motivo_tipo, ids))
            else:
                cur.execute(
                    """UPDATE chequeo_senales
                          SET estado = 'abierta', declarada_por = NULL, declarada_el = NULL,
                              resuelto_por = NULL, resuelto_el = NULL, nota = NULL, motivo_tipo = NULL
                        WHERE id = ANY(%s)""", (ids,))
    audit(email, "chequeo_declarar", "%d barra(s) -> %s%s"
          % (len(ids), body.estado, (" (%s)" % body.motivo_tipo) if body.motivo_tipo else ""),
          "chequeo", "lote")
    return {"ok": True, "afectadas": len(ids), "estado": body.estado}


# ══════ LAS REVISIONES SON LA UNIDAD ══════

@router.get("/chequeos/revision/{revision_id}")
def detalle_revision(revision_id: int, user=Depends(get_current_user)):
    """LO QUE ENCONTRÓ UNA REVISIÓN, y en qué va. Todos ven todo acá: el reparto por persona
    es lo que hace falta para saber dónde está parado el trabajo."""
    _puede_ver(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, id_proyecto, obra, lanzada_por, arrancada, terminada, ccs,
                          ccs_error, barras, senales_nuevas, nota
                     FROM chequeo_revisiones WHERE id = %s""", (revision_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Esa revisión no existe.")
            cab = {"id": r[0], "job": r[1], "obra": r[2], "por": r[3],
                   "arrancada": r[4].isoformat(), "terminada": r[5].isoformat() if r[5] else None,
                   "ccs": r[6], "ccs_error": r[7], "barras": r[8], "nuevas": r[9], "nota": r[10]}
            cur.execute(
                "SELECT " + _COLS_SENAL + """, s.motivo_tipo, s.declarada_por, s.declarada_el
                     FROM chequeo_senales s WHERE s.revision_id = %s
                    ORDER BY s.obra, s.cc, s.regla, s.ref""", (revision_id,))
            items = []
            for f in cur.fetchall():
                d = _fila_senal(f)
                d.update({"motivo_tipo": f[20], "declarada_por": f[21],
                          "declarada_el": f[22].isoformat() if f[22] else None})
                items.append(d)
            # Los kilos de los códigos tocados: el tamaño de lo que está en juego.
            ccs = sorted({(i["job"], i["cc"]) for i in items if i["cc"]})
            kg = 0.0
            if ccs:
                # Los pares (job, código) van como dos arrays y se cruzan con `unnest`:
                # psycopg3 no sabe mandar una lista de tuplas a un `IN`.
                cur.execute(
                    """SELECT COALESCE(SUM(p.kg), 0)
                         FROM asa_pedidos p
                         JOIN unnest(%s::text[], %s::text[]) AS t(job, cc)
                           ON t.job = p.asa_job_id AND t.cc = p.control_code""",
                    ([c[0] for c in ccs], [c[1] for c in ccs]))
                kg = float(cur.fetchone()[0] or 0)
    por_cub = {}
    for i in items:
        q = (i["cubico"] or "(sin dato)").strip() or "(sin dato)"
        c = por_cub.setdefault(q, {"cubico": q, "n": 0, "resueltas": 0, "declaradas": 0,
                                   "verificadas": 0, "no_aplica": 0, "abiertas": 0, "ccs": set()})
        c["n"] += 1
        c["ccs"].add(i["cc"])
        if i["estado"] == "corregida":
            c["verificadas"] += 1; c["resueltas"] += 1
        elif i["estado"] == "aceptada":
            c["no_aplica"] += 1; c["resueltas"] += 1
        elif i["estado"] in ("declarada", "corregir"):
            c["declaradas"] += 1
        else:
            c["abiertas"] += 1
    for c in por_cub.values():
        c["ccs"] = len(c["ccs"])
        c["pct"] = round(c["resueltas"] / c["n"] * 100) if c["n"] else 0
    cab.update({
        "items": len(items),
        "resueltas": sum(c["resueltas"] for c in por_cub.values()),
        "obras": len({i["job"] for i in items}),
        "ccs_con_hallazgo": len(ccs), "kg": kg,
        "por_cubicador": sorted(por_cub.values(), key=lambda c: (c["pct"], -c["n"])),
    })
    return {"revision": cab, "items": items,
            "estados": ESTADO_TXT, "motivos": MOTIVOS_NO_APLICA,
            "reglas": {r["codigo"]: {"nombre": r["nombre"], "porque": r["porque"]} for r in REGLAS}}


@router.get("/chequeos/por-cubicador")
def por_cubicador(user=Depends(get_current_user)):
    """Una fila por cubicador: cuántos hallazgos tiene, en cuántas obras y códigos, cómo se
    reparten por regla y en qué va su corrección.

    El `cubico` es el login de aSa (`Nlopez`, `JHvelasquez`). Se resuelve a correo con la
    misma regla que usan las auditorías para saber a quién se le puede mandar la tarea: los
    que no son usuarios de la plataforma salen igual, marcados, porque sus barras existen y
    alguien las tiene que ver."""
    _puede_ver(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT COALESCE(NULLIF(TRIM(cubico), ''), '(sin dato)') AS quien,
                          COUNT(*) FILTER (WHERE estado = 'abierta'),
                          COUNT(*) FILTER (WHERE estado = 'corregir'),
                          COUNT(*) FILTER (WHERE estado = 'aceptada'),
                          COUNT(*) FILTER (WHERE estado = 'corregida'),
                          COUNT(DISTINCT id_proyecto) FILTER (WHERE estado = ANY(%s)),
                          COUNT(DISTINCT cc) FILTER (WHERE estado = ANY(%s)),
                          MAX(visto_ultimo)
                     FROM chequeo_senales
                    GROUP BY 1""", (list(ABIERTAS), list(ABIERTAS)))
            filas = {r[0]: {"cubico": r[0], "abiertas": r[1], "corregir": r[2], "aceptadas": r[3],
                            "corregidas": r[4], "obras": r[5], "ccs": r[6],
                            "visto_ultimo": r[7].isoformat() if r[7] else None,
                            "por_regla": {}, "email": None}
                     for r in cur.fetchall()}
            cur.execute(
                """SELECT COALESCE(NULLIF(TRIM(cubico), ''), '(sin dato)'), regla, COUNT(*)
                     FROM chequeo_senales WHERE estado = ANY(%s)
                    GROUP BY 1, 2""", (list(ABIERTAS),))
            for quien, regla, n in cur.fetchall():
                if quien in filas:
                    filas[quien]["por_regla"][regla] = n
            for quien, f in filas.items():
                f["email"] = _email_de_login(cur, quien) if quien != "(sin dato)" else None
    lista = sorted(filas.values(), key=lambda f: (-(f["abiertas"] + f["corregir"]), f["cubico"]))
    return {"cubicadores": lista,
            "reglas": {r["codigo"]: r.get("corto") or r["nombre"] for r in REGLAS},
            "total": {"abiertas": sum(f["abiertas"] for f in lista),
                      "corregir": sum(f["corregir"] for f in lista),
                      "corregidas": sum(f["corregidas"] for f in lista),
                      "aceptadas": sum(f["aceptadas"] for f in lista),
                      "cubicadores": len(lista)}}


@router.get("/chequeos/cubicador/{quien}")
def hoja_cubicador(quien: str, estado: str = "", user=Depends(get_current_user)):
    """LA HOJA DE TRABAJO de un cubicador: todas sus barras con problema, ordenadas por obra
    y código, que es como se corrigen —abriendo un código en aSa y arreglando lo de ahí—.
    Se imprime tal cual."""
    _puede_ver(user)
    where, args = ["COALESCE(NULLIF(TRIM(s.cubico), ''), '(sin dato)') = %s"], [quien]
    if estado == "todas":
        pass
    elif estado:
        where.append("s.estado = %s"); args.append(estado)
    else:
        where.append("s.estado = ANY(%s)"); args.append(list(ABIERTAS) + ["corregida"])
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT " + _COLS_SENAL + """ FROM chequeo_senales s
                  WHERE """ + " AND ".join(where) + """
                  ORDER BY s.obra, s.cc, s.regla, s.ref""", tuple(args))
            filas = [_fila_senal(r) for r in cur.fetchall()]
            email = _email_de_login(cur, quien) if quien != "(sin dato)" else None
    # Agrupado por código: es la unidad en la que se trabaja y en la que se comprueba (una
    # llamada a aSa por código, no por barra).
    por_cc, orden = {}, []
    for f in filas:
        k = (f["job"], f["cc"] or "")
        if k not in por_cc:
            por_cc[k] = {"job": f["job"], "cc": f["cc"], "obra": f["obra"], "senales": []}
            orden.append(k)
        por_cc[k]["senales"].append(f)
    grupos = [por_cc[k] for k in orden]
    for g in grupos:
        g["n"] = len(g["senales"])
        g["corregidas"] = sum(1 for s in g["senales"] if s["estado"] == "corregida")
    return {"cubico": quien, "email": email, "grupos": grupos, "senales": filas,
            "n": len(filas), "ccs": len(grupos),
            "corregidas": sum(1 for f in filas if f["estado"] == "corregida"),
            "reglas": {r["codigo"]: {"nombre": r["nombre"], "porque": r["porque"]} for r in REGLAS}}


class ComprobarLoteBody(BaseModel):
    """Las señales marcadas por el cubicador: «éstas ya las corregí, revísalas»."""
    ids: List[int]
    # Tope de CÓDIGOS por llamada. Comprobar cuesta una lectura de aSa por código, no por
    # barra: 47 barras en 9 códigos son 9 lecturas. El tope existe para que una hoja con
    # treinta códigos no deje la pantalla colgada; lo que sobra vuelve en la siguiente.
    tope_ccs: int = 12


@router.post("/chequeos/comprobar-lote")
def comprobar_lote(body: ComprobarLoteBody, user=Depends(get_current_user)):
    """COMPRUEBA SÓLO LO MARCADO. Vuelve a leer en aSa los códigos de esas señales y corre
    las reglas con la misma lógica de siempre (`revisar_cc`): la que ya no salta queda
    corregida. Devuelve el estado final de cada id, para pintar verde lo que ya cumple."""
    _puede_ver(user)
    ids = list(dict.fromkeys(body.ids or []))
    if not ids:
        raise HTTPException(status_code=400, detail="No marcaste ninguna barra.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT DISTINCT id_proyecto, cc FROM chequeo_senales
                    WHERE id = ANY(%s) AND estado <> 'corregida' AND cc IS NOT NULL
                    ORDER BY 1, 2""", (ids,))
            ccs = cur.fetchall()
    tope = max(1, min(int(body.tope_ccs or 12), 30))
    hechos, errores = [], []
    for job, cc in ccs[:tope]:
        r = revisar_cc(RevisarCc(job=job, cc=cc), user)
        (errores if r.get("error") else hechos).append(
            {"cc": cc, "error": r.get("error"), "barras": r.get("barras", 0),
             "corregidas": r.get("corregidas", 0)})
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, estado FROM chequeo_senales WHERE id = ANY(%s)", (ids,))
            estados = {r[0]: r[1] for r in cur.fetchall()}
    audit(user.get("email", "?"), "chequeo_comprobar_lote",
          "%d barra(s) en %d código(s): %d corregida(s)"
          % (len(ids), len(hechos), sum(1 for e in estados.values() if e == "corregida")),
          "chequeo", "lote")
    return {"estados": estados, "ccs_revisados": hechos, "errores": errores,
            "faltan_ccs": max(0, len(ccs) - tope),
            "corregidas": sum(1 for i in ids if estados.get(i) == "corregida")}


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
                      AND p.job_name !~* %s AND p.asa_job_id NOT IN (SELECT asa_job_id FROM asa_obras WHERE excluida)""" + mov + """
                    GROUP BY p.asa_job_id""",
                (_estados(tarde), PATRON_OBRAS_FUERA) + arg)
            base = {r[0]: {"job": r[0], "obra": r[1], "ccs": r[2], "kg": float(r[3] or 0),
                           "cubico": r[4], "ultimo_pedido": r[5].isoformat() if r[5] else None,
                           "revisados": 0, "barras": 0, "abiertas": 0, "corregir": 0,
                           "aceptadas": 0, "corregidas": 0, "por_regla": {}, "quienes": [],
                           "ultima_revision": None}
                    for r in cur.fetchall()}
            # «REVISADOS» SE CUENTA SOBRE LOS MISMOS CÓDIGOS QUE «CÓDIGOS» (13-oct). Antes
            # contaba todo lo que alguna vez se revisó de la obra, y un código revisado
            # cuando estaba Open que después pasó a Processed seguía sumando: por eso el
            # reporte decía «16 revisados de 9 (faltan -7)». Un revisado de más no es un
            # error chico: hacía ver completa una obra que no lo estaba.
            cur.execute(
                """SELECT c.id_proyecto, COUNT(*), SUM(c.barras), MAX(c.revisado_el)
                     FROM chequeo_codigos c
                     JOIN asa_pedidos p ON p.asa_job_id = c.id_proyecto AND p.control_code = c.cc
                    WHERE COALESCE(p.estado,'') = ANY(%s)
                      AND p.job_name !~* %s AND p.asa_job_id NOT IN (SELECT asa_job_id FROM asa_obras WHERE excluida)""" + mov + """
                    GROUP BY c.id_proyecto""",
                (_estados(tarde), PATRON_OBRAS_FUERA) + arg)
            for job, n, barras, ult in cur.fetchall():
                if job in base:
                    base[job].update({"revisados": min(n, base[job]["ccs"]), "barras": int(barras or 0),
                                      "ultima_revision": ult.isoformat() if ult else None})
            # CUÁNDO SON ESTOS DATOS: la última carga de aSa que terminó bien. Lo pidió el
            # usuario para el reporte, y es la respuesta a «¿esto está al día?».
            cur.execute("SELECT MAX(fin) FROM asa_sync WHERE ok")
            ultima_carga = cur.fetchone()[0]
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
            "ultima_carga": ultima_carga.isoformat() if ultima_carga else None,
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
            # EL AVANCE DE CADA REVISIÓN, contado sobre SUS señales: una revisión sin
            # resolver no se arrastra a la siguiente —lo pidió el usuario— así que la suya
            # tiene que mostrar que sigue abierta.
            cur.execute(
                """SELECT r.id, r.id_proyecto, r.obra, r.lanzada_por, r.arrancada, r.terminada,
                          r.ccs, r.ccs_error, r.barras, r.senales_nuevas, r.senales_vistas,
                          COUNT(s.id),
                          COUNT(s.id) FILTER (WHERE s.estado = 'corregida'),
                          COUNT(s.id) FILTER (WHERE s.estado IN ('declarada', 'corregir')),
                          COUNT(DISTINCT s.cubico) FILTER (WHERE s.cubico IS NOT NULL),
                          -- LO QUE NO APLICA SALE DEL DENOMINADOR (14-oct). El avance se
                          -- medía contra todo lo DETECTADO, incluido lo que alguien ya
                          -- descartó: una revisión no llegaba nunca al cien por ciento
                          -- aunque no quedara nada que hacer. Son dos cosas distintas y
                          -- se dicen las dos: lo que la máquina marcó y lo que aplica.
                          COUNT(s.id) FILTER (WHERE s.estado = 'aceptada'),
                          EXTRACT(YEAR FROM r.arrancada)::int
                     FROM chequeo_revisiones r
                     LEFT JOIN chequeo_senales s ON s.revision_id = r.id
                    WHERE (%s = '' OR r.id_proyecto = %s)
                    GROUP BY r.id
                    ORDER BY r.arrancada DESC LIMIT 60""", (job, job))
            filas = cur.fetchall()
            # EL DESGLOSE POR CUBICADOR, para la matriz: una columna por persona, y las
            # personas salen del dato, no de una lista. Si mañana aparece alguien nuevo,
            # su columna aparece sola; si un año no tiene hallazgos de alguien, su columna
            # no se dibuja y no mete ruido.
            cur.execute(
                """SELECT s.revision_id, NULLIF(TRIM(s.cubico), ''),
                          COUNT(*), COUNT(*) FILTER (WHERE s.estado = 'aceptada'),
                          COUNT(*) FILTER (WHERE s.estado = 'corregida')
                     FROM chequeo_senales s
                    WHERE s.revision_id IS NOT NULL
                    GROUP BY 1, 2""")
            porcub = {}
            for rid, quien, n, nap, res in cur.fetchall():
                porcub.setdefault(rid, {})[quien or "(sin dato)"] = {
                    "n": n, "no_aplica": nap, "resueltos": res}
    def _fila(f):
        detectados, resueltos, no_aplica = f[11], f[12], f[15]
        aplican = detectados - no_aplica
        return {"id": f[0], "job": f[1], "obra": f[2], "por": f[3],
                "arrancada": f[4].isoformat(), "terminada": f[5].isoformat() if f[5] else None,
                "ccs": f[6], "ccs_error": f[7], "barras": f[8], "nuevas": f[9],
                "vistas": f[10],
                # `items` se mantiene por lo que ya lo lee; `detectados` es su nombre real.
                "items": detectados, "detectados": detectados, "aplican": aplican,
                "no_aplica": no_aplica,
                "resueltas": resueltos, "declaradas": f[13], "cubicadores": f[14],
                "anio": f[16], "por_cubicador": porcub.get(f[0], {}),
                "pct": round(resueltos / aplican * 100) if aplican else None}
    return {"revisiones": [_fila(f) for f in filas]}
