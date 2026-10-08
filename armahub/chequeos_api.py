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
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .asa import AsaError
from .auditorias import (PATRON_OBRAS_FUERA, _es_barra, _items_de, _puede_auditar,
                         _puede_ver, refs_de_barras)
from .auth import get_current_user
from .chequeos import REGLAS, correr, normalizar_asa
from .db import audit, get_conn

router = APIRouter(prefix="/api/v1", tags=["chequeos"])

# Los estados de un código que se revisan. Lo despachado queda fuera: revisar algo que ya
# salió a la obra llega tarde, que es la misma razón por la que la auditoría no lo sortea.
ESTADOS_VIVOS = ("Open", "Processed")
# Los estados en que una señal está esperando a alguien.
ABIERTAS = ("abierta", "corregir")


@router.get("/chequeos/reglas")
def listar_reglas(user=Depends(get_current_user)):
    """Qué se revisa y por qué. La pantalla lo muestra tal cual: una regla que nadie
    entiende es una regla que se ignora."""
    _puede_ver(user)
    return {"reglas": [{"codigo": r["codigo"], "nombre": r["nombre"], "porque": r["porque"]}
                       for r in REGLAS]}


@router.get("/chequeos/obras")
def obras(user=Depends(get_current_user)):
    """Las obras con códigos vivos, con lo que ya se sabe de cada una: cuántos códigos
    tiene, cuántos se revisaron, cuándo fue la última revisión y cuántas señales esperan."""
    _puede_ver(user)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT p.asa_job_id, MAX(p.job_name), COUNT(*),
                          MAX(p.order_date), SUM(p.kg)
                     FROM asa_pedidos p
                    WHERE COALESCE(p.estado,'') = ANY(%s)
                      AND p.job_name !~* %s
                    GROUP BY p.asa_job_id
                    ORDER BY MAX(p.order_date) DESC NULLS LAST""",
                (list(ESTADOS_VIVOS), PATRON_OBRAS_FUERA))
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
         "senales": senales.get(r[0]) or {"abiertas": 0, "corregir": 0, "ccs": 0},
         "ultima_revision": ultima.get(r[0])}
        for r in filas]}


@router.get("/chequeos/codigos")
def codigos(job: str, user=Depends(get_current_user)):
    """Los códigos vivos de una obra, con si ya se revisaron y qué salió."""
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
                (job, list(ESTADOS_VIVOS), PATRON_OBRAS_FUERA))
            ccs = [{"cc": r[0], "descr": r[1], "kg": float(r[2] or 0),
                    "fecha": r[3].isoformat() if r[3] else None,
                    "estado": r[4], "persona": r[5]} for r in cur.fetchall()]
            cur.execute(
                """SELECT cc, COUNT(*) FILTER (WHERE estado = ANY(%s)),
                          COUNT(*), MAX(visto_ultimo)
                     FROM chequeo_senales WHERE id_proyecto = %s GROUP BY cc""",
                (list(ABIERTAS), job))
            vis = {r[0]: {"abiertas": r[1], "total": r[2],
                          "revisado": r[3].isoformat() if r[3] else None}
                   for r in cur.fetchall()}
            cur.execute("SELECT MAX(job_name) FROM asa_pedidos WHERE asa_job_id = %s", (job,))
            obra = (cur.fetchone() or [None])[0]
    for c in ccs:
        c.update(vis.get(c["cc"]) or {"abiertas": 0, "total": 0, "revisado": None})
    return {"job": job, "obra": obra, "ccs": ccs, "total": len(ccs)}


class RevisionNueva(BaseModel):
    job: str
    ccs: Optional[List[str]] = None


@router.post("/chequeos/revision")
def abrir_revision(body: RevisionNueva, user=Depends(get_current_user)):
    """Abre el registro de una revisión y devuelve los códigos a recorrer. La pantalla los
    pide uno por uno: acá no se revisa nada todavía."""
    _puede_auditar(user)
    email = user.get("email", "?")
    datos = codigos(body.job, user)
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
    _puede_auditar(user)
    email = user.get("email", "?")
    try:
        items = [it for it in _items_de(body.cc) if _es_barra(it)]
    except AsaError as e:
        # Un código que falla no bota la revisión: se cuenta y se sigue con el siguiente.
        _sumar_revision(body.revision, ccs=1, errores=1)
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
                            diam_mm, detalle, firma, firma_patron, estado, resuelto_por, nota,
                            resuelto_el)
                       VALUES (%s,'asa',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                               CASE WHEN %s THEN now() END)
                       ON CONFLICT (firma) DO UPDATE
                          SET veces = chequeo_senales.veces + 1, visto_ultimo = now(),
                              detalle = EXCLUDED.detalle
                       RETURNING (xmax = 0) AS insertada""",
                    (s["regla"], body.job, obra, s["cc"], s["elemento"], s["ref"], s["marca"],
                     s["figura"], s["diam"], _json(s["detalle"]), s["firma"], s["firma_patron"],
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

    _sumar_revision(body.revision, ccs=1, barras=len(barras), nuevas=nuevas,
                    vistas=vistas, corregidas=corregidas)
    return {"cc": body.cc, "barras": len(barras), "nuevas": nuevas, "vistas": vistas,
            "corregidas": corregidas,
            "senales": [{"regla": s["regla"], "ref": s["ref"], "texto": s["detalle"]["texto"]}
                        for s in senales]}


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
def senales(job: str = "", estado: str = "", regla: str = "",
            user=Depends(get_current_user)):
    """Las señales de una obra. Por defecto, las que esperan a alguien."""
    _puede_ver(user)
    where, args = ["TRUE"], []
    if job:
        where.append("id_proyecto = %s"); args.append(job)
    if regla:
        where.append("regla = %s"); args.append(regla)
    if estado == "todas":
        pass
    elif estado:
        where.append("estado = %s"); args.append(estado)
    else:
        where.append("estado = ANY(%s)"); args.append(list(ABIERTAS))
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, regla, id_proyecto, obra, cc, elemento, ref, marca, figura, diam_mm,"
                " detalle, veces, visto_primero, visto_ultimo, estado, resuelto_por, resuelto_el,"
                " nota, firma_patron"
                " FROM chequeo_senales WHERE " + " AND ".join(where) +
                " ORDER BY regla, cc, ref LIMIT 2000", tuple(args))
            filas = cur.fetchall()
            cur.execute(
                """SELECT regla, estado, COUNT(*) FROM chequeo_senales
                    WHERE id_proyecto = %s OR %s = '' GROUP BY regla, estado""", (job, job))
            resumen = {}
            for r, e, n in cur.fetchall():
                resumen.setdefault(r, {})[e] = n
    return {"senales": [
        {"id": f[0], "regla": f[1], "job": f[2], "obra": f[3], "cc": f[4], "elemento": f[5],
         "ref": f[6], "marca": f[7], "figura": f[8], "diam": float(f[9] or 0),
         "detalle": f[10], "veces": f[11],
         "visto_primero": f[12].isoformat() if f[12] else None,
         "visto_ultimo": f[13].isoformat() if f[13] else None,
         "estado": f[14], "resuelto_por": f[15],
         "resuelto_el": f[16].isoformat() if f[16] else None,
         "nota": f[17], "patron": f[18]} for f in filas],
        "resumen": resumen,
        "reglas": {r["codigo"]: {"nombre": r["nombre"], "porque": r["porque"]} for r in REGLAS}}


class ResolverBody(BaseModel):
    estado: str
    nota: Optional[str] = None
    patron: bool = False


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
                    """UPDATE chequeo_senales
                          SET estado = %s, resuelto_por = %s, resuelto_el = now(), nota = %s
                        WHERE id_proyecto = %s AND regla = %s AND firma_patron = %s
                          AND estado <> 'corregida'
                    RETURNING id""",
                    (body.estado, email, (body.nota or "").strip() or None, job, regla, patron))
            else:
                cur.execute(
                    """UPDATE chequeo_senales
                          SET estado = %s, resuelto_por = %s, resuelto_el = now(), nota = %s
                        WHERE id = %s RETURNING id""",
                    (body.estado, email, (body.nota or "").strip() or None, senal_id))
            n = len(cur.fetchall())
    audit(email, "chequeo_senal", "%s · %s · %s -> %s%s" % (cc, ref, regla, body.estado,
                                                            " (patrón, %d)" % n if body.patron else ""),
          "chequeo", str(senal_id))
    return {"ok": True, "afectadas": n}


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
