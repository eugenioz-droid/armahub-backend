"""5N-B — Backend de "Agregar Cubicación" (ingreso manual de barras).

Un LOTE agrupa las barras que un cubicador ingresa juntos (provenance, gemelo del
import_id del CSV). Las barras creadas aquí llevan origen='manual', import_id=NULL,
lote_id, y sobreviven a cualquier reimport (invariante de canales, 5N.1).

Endpoints:
  POST /lotes                     -> crea un lote 'borrador' para una obra
  POST /lotes/{id}/terminar       -> cierra el lote ('terminada'); bloquea edición desde acá
  POST /lotes/{id}/barras         -> agrega 1..N barras al lote (transaccional)
  GET  /lotes/{id}                -> estado del lote + sus barras

Reglas:
- Permiso: mismo que editar barras (_puede_editar_barras): miembro del área cubicaciones
  o admin/admin_calidad. Cualquier obra.
- id_unico manual = 'M-' + uuid corto (nunca colisiona con el id_unico del CSV, que es
  ID_PROYECTO/PLANO/ID de ArmaDetailer).
- largo_total AUTOMÁTICO = suma de los lados de la figura (radio no suma). Hook aislado
  para ampliar a barras redondas/estribos a futuro.
- peso = teórico * (1 + factor_peso_obra/100). Factor default 0.
- Al crear barras se marca el sector 'modificado' (evento de sector_estado, 5N.4).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid

from .db import get_conn, audit
from .auth import get_current_user
from . import cache as _cache
from .diametros import DIAM_ESTANDAR as _DIAM_ESTANDAR, cod_prod_de_diam

router = APIRouter()


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _peso_teorico(diam, largo):
    """Peso teórico (kg) = 7850 kg/m³ × área × largo. Misma fórmula que _calcular_peso
    de barras.py (diam mm, largo cm). Aislada aquí para no importar barras.py."""
    if diam is None or largo is None:
        return None
    try:
        diam = float(diam); largo = float(largo)
    except (ValueError, TypeError):
        return None
    return 7850 * 3.1416 * (diam / 2000) ** 2 * (largo / 100)


def _largo_desde_figura(cur, figura, dims):
    """largo_total AUTOMÁTICO = suma de los lados (dims) que la figura USA. El radio NO
    suma; sin desarrollo real de dobleces (5N.7). HOOK: aislado para ampliar a barras
    redondas/estribos circulares a futuro sin tocar el resto. Reusa largo_desde_lados
    del catálogo (la fuente de verdad de qué lados usa cada figura)."""
    from .catalogo import largo_desde_lados
    if not figura:
        # Sin figura del catálogo: no se puede derivar → 0 (el front puede exigir figura).
        return None
    return largo_desde_lados(cur, figura, dims)


def _id_unico_manual():
    """id_unico de barra manual: prefijo 'M-' + uuid corto. Nunca colisiona con el
    id_unico del CSV (ID_PROYECTO/PLANO/ID de ArmaDetailer)."""
    return "M-" + uuid.uuid4().hex[:12].upper()


def _factor_peso(cur, id_proyecto):
    """Factor de peso de la obra (%). Default 0 (no altera). peso = teorico*(1+f/100)."""
    try:
        cur.execute("SELECT factor_peso FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
        r = cur.fetchone()
        return float(r[0]) if (r and r[0] is not None) else 0.0
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------
class LoteCreate(BaseModel):
    id_proyecto: str


class BarraManual(BaseModel):
    # Ubicación
    sector: Optional[str] = None
    piso: Optional[str] = None
    ciclo: Optional[str] = None
    eje: Optional[str] = None
    nombre_plano: Optional[str] = None   # texto libre: de qué plano salió (por grupo/elemento)
    # Barra
    diam: float
    figura: Optional[str] = None
    marca: Optional[str] = None
    cant: float = 1
    mult: float = 1
    # Dimensiones (según la figura)
    dim_a: Optional[float] = None
    dim_b: Optional[float] = None
    dim_c: Optional[float] = None
    dim_d: Optional[float] = None
    dim_e: Optional[float] = None
    dim_f: Optional[float] = None
    dim_g: Optional[float] = None
    dim_h: Optional[float] = None
    dim_i: Optional[float] = None
    ang1: Optional[float] = None
    ang2: Optional[float] = None
    ang3: Optional[float] = None
    ang4: Optional[float] = None
    radio: Optional[float] = None
    revisada: bool = False   # el cubicador la marcó revisada en la grilla (5N.19); viaja con la barra
    suf_tipo: Optional[str] = None   # sufijo que se concatena a la tipología SOLO al exportar (5N.42)


class BarrasBatch(BaseModel):
    barras: List[BarraManual]


def _check_permiso(cur, user):
    from .barras import _puede_editar_barras
    if not _puede_editar_barras(cur, user):
        raise HTTPException(status_code=403,
                            detail="Solo un miembro del área de Cubicaciones puede crear barras.")


# ---------------------------------------------------------------------------
# Endpoints de lote
# ---------------------------------------------------------------------------
@router.post("/lotes")
def crear_lote(body: LoteCreate, user=Depends(get_current_user)):
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            cur.execute("SELECT 1 FROM proyectos WHERE id_proyecto = %s", (body.id_proyecto,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Obra no encontrada.")
            # num_obra FIJO: MAX(num_obra de la obra) + 1. Monótono: nunca se reusa ni se recalcula,
            # aunque se eliminen lotes (quedan lápidas). Es una referencia estable (como una factura).
            cur.execute("SELECT COALESCE(MAX(num_obra), 0) + 1 FROM lotes WHERE id_proyecto = %s",
                        (body.id_proyecto,))
            num_obra = int(cur.fetchone()[0])
            cur.execute(
                """INSERT INTO lotes (id_proyecto, tipo, estado, creado_por, creado_fecha, n_barras, num_obra)
                   VALUES (%s, 'manual', 'borrador', %s, %s, 0, %s) RETURNING id""",
                (body.id_proyecto, email, _now_iso(), num_obra),
            )
            lote_id = cur.fetchone()[0]
    audit(email, "crear_lote", f"obra {body.id_proyecto}", "lote", str(lote_id))
    return {"ok": True, "lote_id": lote_id, "estado": "borrador", "num_obra": num_obra}


@router.delete("/lotes/{lote_id}/vacio")
def descartar_lote_vacio(lote_id: int, user=Depends(get_current_user)):
    """Borra FÍSICAMENTE un lote SOLO si está vacío (0 barras en BD, estado borrador). Se llama al
    abandonar el creador sin guardar (X, cambiar de obra, crear otro). Así un lote creado y nunca
    usado no ensucia el histórico y LIBERA su num_obra (el próximo lo reusa vía MAX+1). Si el lote
    tiene barras o no es borrador, NO se toca (para eso está la eliminación con lápida). Idempotente:
    si ya no existe, responde ok sin error."""
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            cur.execute("SELECT estado FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                return {"ok": True, "borrado": False, "motivo": "no_existe"}
            if r[0] != "borrador":
                return {"ok": True, "borrado": False, "motivo": "no_borrador"}
            cur.execute("SELECT COUNT(*) FROM barras WHERE lote_id = %s", (lote_id,))
            if int(cur.fetchone()[0]) > 0:
                return {"ok": True, "borrado": False, "motivo": "tiene_barras"}
            cur.execute("DELETE FROM lotes WHERE id = %s AND estado = 'borrador'", (lote_id,))
            borrado = cur.rowcount > 0
    if borrado:
        audit(email, "descartar_lote_vacio", f"lote {lote_id}", "lote", str(lote_id))
    return {"ok": True, "borrado": borrado}


class LoteDuplicar(BaseModel):
    ciclo: str          # ciclo del NUEVO lote (obligatorio)
    eje: str            # eje del NUEVO lote (obligatorio)


@router.post("/lotes/{lote_id}/duplicar")
def duplicar_lote(lote_id: int, body: LoteDuplicar, user=Depends(get_current_user)):
    """Crea un lote NUEVO con TODA la data del lote origen (piso, sector, tipología, figura, dims,
    ángulos, cant, mult, sufijo), cambiando SOLO el ciclo y el eje por los que elige el usuario. El
    nuevo lote nace en 'borrador' con su propio num_obra. Sirve el origen desde la tabla `barras` o,
    si el origen es una lápida (eliminado), desde su snapshot congelado."""
    email = user.get("email", "?")
    ciclo = (body.ciclo or "").strip()
    eje = (body.eje or "").strip()
    if not ciclo or not eje:
        raise HTTPException(status_code=400, detail="Ciclo y Eje son obligatorios para duplicar.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            cur.execute("SELECT id_proyecto, estado, snap_barras FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Lote origen no encontrado.")
            id_proyecto, estado_o, snap = r[0], r[1], r[2]
            campos = ["sector", "piso", "marca", "figura", "diam", "cant", "mult",
                      "dim_a", "dim_b", "dim_c", "dim_d", "dim_e", "dim_f", "dim_g", "dim_h", "dim_i",
                      "ang1", "ang2", "ang3", "ang4", "radio", "suf_tipo"]
            if estado_o == "eliminado":
                import json as _json
                origen = snap if isinstance(snap, list) else (_json.loads(snap) if snap else [])
            else:
                cur.execute("SELECT " + ", ".join(campos) +
                            " FROM barras WHERE lote_id = %s AND origen = 'manual' ORDER BY id", (lote_id,))
                origen = [dict(zip(campos, row)) for row in cur.fetchall()]
            if not origen:
                raise HTTPException(status_code=400, detail="El lote origen no tiene barras que duplicar.")
            # Crear el lote nuevo (num_obra fijo).
            cur.execute("SELECT COALESCE(MAX(num_obra), 0) + 1 FROM lotes WHERE id_proyecto = %s", (id_proyecto,))
            num_obra = int(cur.fetchone()[0])
            cur.execute(
                """INSERT INTO lotes (id_proyecto, tipo, estado, creado_por, creado_fecha, n_barras, num_obra)
                   VALUES (%s, 'manual', 'borrador', %s, %s, 0, %s) RETURNING id""",
                (id_proyecto, email, _now_iso(), num_obra))
            nuevo_id = cur.fetchone()[0]
            factor = _factor_peso(cur, id_proyecto)
            now = _now_iso()
            n = 0
            for b in origen:
                dims = {f"dim_{L}": b.get(f"dim_{L}") for L in "abcdefghi"}
                dims.update({a: b.get(a) for a in ("ang1", "ang2", "ang3", "ang4")})
                dims["radio"] = b.get("radio")
                largo = _largo_desde_figura(cur, b.get("figura"), dims)
                peso_u = _peso_teorico(b.get("diam"), largo)
                if peso_u is not None:
                    peso_u = peso_u * (1 + factor / 100.0)
                cant_total = (b.get("cant") or 0) * (b.get("mult") or 1)
                peso_t = (peso_u * cant_total) if (peso_u is not None) else None
                idu = _id_unico_manual()
                cod_prod = cod_prod_de_diam(b.get("diam"))
                cur.execute(
                    """INSERT INTO barras
                       (id_unico, id_proyecto, sector, piso, ciclo, eje, diam, largo_total,
                        mult, cant, cant_total, peso_unitario, peso_total, marca, figura, cod_proyecto,
                        dim_a, dim_b, dim_c, dim_d, dim_e, dim_f, dim_g, dim_h, dim_i,
                        ang1, ang2, ang3, ang4, radio, suf_tipo,
                        origen, import_id, lote_id, estado, fecha_carga, editado_por, editado_fecha)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s, %s,%s,%s,%s,%s,%s,%s,%s,
                               %s,%s,%s,%s,%s,%s,%s,%s,%s, %s,%s,%s,%s,%s,%s,
                               'manual', NULL, %s, 'borrador', %s, %s, %s)""",
                    (idu, id_proyecto, b.get("sector"), b.get("piso"), ciclo, eje, b.get("diam"), largo,
                     b.get("mult"), b.get("cant"), cant_total, peso_u, peso_t, b.get("marca"), b.get("figura"), cod_prod,
                     b.get("dim_a"), b.get("dim_b"), b.get("dim_c"), b.get("dim_d"), b.get("dim_e"),
                     b.get("dim_f"), b.get("dim_g"), b.get("dim_h"), b.get("dim_i"),
                     b.get("ang1"), b.get("ang2"), b.get("ang3"), b.get("ang4"), b.get("radio"),
                     ((b.get("suf_tipo") or "").strip() or None),
                     nuevo_id, now, email, now))
                n += 1
            cur.execute("UPDATE lotes SET n_barras = %s WHERE id = %s", (n, nuevo_id))
            try:
                from .sector_estado import marcar_sector_modificado
                for sec, pis in {(b.get("sector"), b.get("piso")) for b in origen}:
                    marcar_sector_modificado(cur, id_proyecto, sec, pis, ciclo, por=email)
            except Exception:
                pass
    _cache.invalidate("stats:", "landing:")
    audit(email, "duplicar_lote", f"origen {lote_id} → {nuevo_id} · {n} barras", "lote", str(nuevo_id))
    return {"ok": True, "lote_id": nuevo_id, "num_obra": num_obra, "barras": n}


@router.post("/lotes/{lote_id}/terminar")
def terminar_lote(lote_id: int, user=Depends(get_current_user)):
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            cur.execute("SELECT estado FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Lote no encontrado.")
            # 5N.19 — REGLA DURA: no se termina un lote VACÍO ni uno con barras SIN revisar.
            # La revisión es el filtro de calidad del cubicador; cerrar bloquea la edición.
            cur.execute("SELECT COUNT(*) FROM barras WHERE lote_id = %s", (lote_id,))
            total = cur.fetchone()[0]
            if total == 0:
                raise HTTPException(status_code=409, detail={"msg": "El lote no tiene barras; no se puede terminar."})
            cur.execute(
                "SELECT COUNT(*) FROM barras WHERE lote_id = %s AND COALESCE(revisada, FALSE) = FALSE",
                (lote_id,),
            )
            sin_revisar = cur.fetchone()[0]
            if sin_revisar:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "msg": f"No se puede terminar: {sin_revisar} barra(s) sin revisar. "
                               "Marca todas como revisadas antes de cerrar el lote.",
                        "sin_revisar": sin_revisar,
                    },
                )
            cur.execute(
                "UPDATE lotes SET estado = 'terminada', terminado_fecha = %s WHERE id = %s",
                (_now_iso(), lote_id),
            )
            # Las barras del lote pasan a 'terminada' (se editan solo desde Bar Manager).
            cur.execute("UPDATE barras SET estado = 'terminada' WHERE lote_id = %s", (lote_id,))
    audit(email, "terminar_lote", "", "lote", str(lote_id))
    return {"ok": True, "lote_id": lote_id, "estado": "terminada"}


class RevisadaBody(BaseModel):
    barra_ids: List[int]        # barras a marcar (por id numérico)
    revisada: bool = True       # True = marcar revisada; False = desmarcar


@router.post("/lotes/{lote_id}/revisar")
def marcar_revisadas(lote_id: int, body: RevisadaBody, user=Depends(get_current_user)):
    """5N.19 — Marca/desmarca barras como REVISADAS, con trazabilidad (quién + cuándo).
    La revisión es de a una (proceso real); el front puede enviar 1..N ids de un golpe.
    Solo afecta barras de ESTE lote (no se puede revisar barras de otro lote por error).
    """
    email = user.get("email", "?")
    if not body.barra_ids:
        raise HTTPException(status_code=400, detail="No hay barras para revisar.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            cur.execute("SELECT estado FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Lote no encontrado.")
            if r[0] == "terminada":
                raise HTTPException(status_code=409, detail="El lote está terminado; no se puede cambiar la revisión.")
            if body.revisada:
                cur.execute(
                    "UPDATE barras SET revisada = TRUE, revisada_por = %s, revisada_fecha = %s "
                    "WHERE lote_id = %s AND id = ANY(%s)",
                    (email, _now_iso(), lote_id, body.barra_ids),
                )
            else:
                # Desmarcar: limpia también la trazabilidad (ya no está revisada).
                cur.execute(
                    "UPDATE barras SET revisada = FALSE, revisada_por = NULL, revisada_fecha = NULL "
                    "WHERE lote_id = %s AND id = ANY(%s)",
                    (lote_id, body.barra_ids),
                )
            afectadas = cur.rowcount
    audit(email, "revisar_barras", str(body.revisada), "lote", str(lote_id))
    return {"ok": True, "lote_id": lote_id, "revisada": body.revisada, "afectadas": afectadas}


@router.post("/lotes/{lote_id}/barras")
def agregar_barras(lote_id: int, body: BarrasBatch, user=Depends(get_current_user)):
    """Agrega 1..N barras al lote. Transaccional: o entran todas o ninguna."""
    email = user.get("email", "?")
    if not body.barras:
        raise HTTPException(status_code=400, detail="No hay barras para crear.")
    creadas = []
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            cur.execute("SELECT id_proyecto, estado FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Lote no encontrado.")
            id_proyecto, estado_lote = r[0], r[1]
            if estado_lote == "terminada":
                raise HTTPException(status_code=409, detail="El lote está terminado; edita las barras desde el Bar Manager.")
            factor = _factor_peso(cur, id_proyecto)
            now = _now_iso()
            sectores_tocados = set()
            from .catalogo import validar_geometria
            for i, b in enumerate(body.barras):
                # UBICACIÓN OBLIGATORIA (defensa server-side, fuente de verdad): ninguna barra
                # manual se guarda sin ciclo, eje y sector. Antes eran Optional y se insertaba
                # NULL en silencio → lotes "corruptos" sin contexto. Se rechaza TODA la tanda.
                faltan = [n for n, val in (("sector", b.sector), ("ciclo", b.ciclo), ("eje", b.eje))
                          if not (val or "").strip()]
                if faltan:
                    raise HTTPException(status_code=400, detail={
                        "msg": "Falta ubicación obligatoria (" + ", ".join(faltan) + ") en la barra " + str(i + 1) + ".",
                        "barra_idx": i, "faltan": faltan,
                    })
                dims = {f"dim_{L}": getattr(b, f"dim_{L}") for L in "abcdefghi"}
                dims.update({a: getattr(b, a) for a in ("ang1", "ang2", "ang3", "ang4")})
                dims["radio"] = b.radio
                # Validar la geometría contra el catálogo (misma regla que el Bar Manager):
                # la figura exige valor en SUS slots y vacío en los demás. Si no cuadra, se
                # rechaza TODA la tanda (transaccional) con detalle de qué barra/slots fallan
                # → no se crean barras con geometría inválida (data siempre buena).
                if b.figura:
                    v = validar_geometria(cur, b.figura, dims)
                    if not v.get("ok"):
                        raise HTTPException(status_code=400, detail={
                            "msg": "Geometría inválida en la barra " + str(i + 1) + " (figura " + str(b.figura) + ").",
                            "barra_idx": i, "figura": b.figura,
                            "slots_sobran": v.get("slots_sobran", []),
                            "slots_faltan": v.get("slots_faltan", []),
                            "errores": v.get("errores", []),
                        })
                largo = _largo_desde_figura(cur, b.figura, dims)
                peso_u = _peso_teorico(b.diam, largo)
                if peso_u is not None:
                    peso_u = peso_u * (1 + factor / 100.0)
                cant_total = (b.cant or 0) * (b.mult or 1)
                peso_t = (peso_u * cant_total) if (peso_u is not None) else None
                idu = _id_unico_manual()
                # PROD (cod_proyecto) se DERIVA del diámetro (no lo ingresa el usuario).
                cod_prod = cod_prod_de_diam(b.diam)
                # Revisada viaja con la barra: si el cubicador la marcó en la grilla, se guarda
                # revisada=true + trazabilidad (quién/cuándo). Habilita terminar el lote (5N.19).
                rev_por = email if b.revisada else None
                rev_fecha = now if b.revisada else None
                cur.execute(
                    """INSERT INTO barras
                       (id_unico, id_proyecto, sector, piso, ciclo, eje, nombre_plano, diam, largo_total,
                        mult, cant, cant_total, peso_unitario, peso_total, marca, figura, cod_proyecto,
                        dim_a, dim_b, dim_c, dim_d, dim_e, dim_f, dim_g, dim_h, dim_i,
                        ang1, ang2, ang3, ang4, radio,
                        revisada, revisada_por, revisada_fecha, suf_tipo,
                        origen, import_id, lote_id, estado, fecha_carga, editado_por, editado_fecha)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s, %s,%s,%s,%s,%s,%s,%s,%s,
                               %s,%s,%s,%s,%s,%s,%s,%s,%s, %s,%s,%s,%s,%s,
                               %s,%s,%s,%s,
                               'manual', NULL, %s, 'borrador', %s, %s, %s) RETURNING id""",
                    (idu, id_proyecto, b.sector, b.piso, b.ciclo, b.eje, b.nombre_plano, b.diam, largo,
                     b.mult, b.cant, cant_total, peso_u, peso_t, b.marca, b.figura, cod_prod,
                     b.dim_a, b.dim_b, b.dim_c, b.dim_d, b.dim_e, b.dim_f, b.dim_g, b.dim_h, b.dim_i,
                     b.ang1, b.ang2, b.ang3, b.ang4, b.radio,
                     bool(b.revisada), rev_por, rev_fecha, ((b.suf_tipo or "").strip() or None),
                     lote_id, now, email, now),
                )
                creadas.append({"id": cur.fetchone()[0], "id_unico": idu})   # id numérico + id_unico
                sectores_tocados.add((b.sector, b.piso, b.ciclo))
            # Actualizar contador del lote.
            cur.execute(
                "UPDATE lotes SET n_barras = (SELECT COUNT(*) FROM barras WHERE lote_id = %s) WHERE id = %s",
                (lote_id, lote_id),
            )
            # 5N.4: crear barras cambia el contenido de sus sectores → 'modificado'.
            try:
                from .sector_estado import marcar_sector_modificado
                for sec, pis, cic in sectores_tocados:
                    marcar_sector_modificado(cur, id_proyecto, sec, pis, cic, por=email)
            except Exception:
                pass
    _cache.invalidate("stats:", "landing:")
    audit(email, "crear_barras_manual", f"{len(creadas)} barras · lote {lote_id}", "lote", str(lote_id))
    # Devolvemos id numérico + id_unico de cada barra creada (en orden), para que el front asocie
    # cada barra del formulario con su id de BD y pueda luego marcarla revisada (/revisar) sin re-insertar.
    return {"ok": True, "lote_id": lote_id, "creadas": len(creadas),
            "ids": [c["id"] for c in creadas], "id_unicos": [c["id_unico"] for c in creadas]}


@router.delete("/lotes/{lote_id}/barras/{barra_id}")
def eliminar_barra_lote(lote_id: int, barra_id: int, user=Depends(get_current_user)):
    """Borra UNA barra ya guardada de un lote (cuando el usuario la quita de la grilla). Sin esto,
    quitar una barra guardada solo la sacaba del front y quedaba huérfana en BD → 'terminar' la
    contaba como no revisada. Solo barras origen='manual' de un lote NO terminado."""
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            cur.execute("SELECT estado FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Lote no encontrado.")
            if r[0] == "terminada":
                raise HTTPException(status_code=409, detail="El lote está terminado; edita las barras desde el Bar Manager.")
            cur.execute(
                "SELECT sector, piso, ciclo FROM barras WHERE id = %s AND lote_id = %s AND origen = 'manual'",
                (barra_id, lote_id))
            b = cur.fetchone()
            if not b:
                raise HTTPException(status_code=404, detail="Barra no encontrada en este lote.")
            cur.execute("DELETE FROM barras WHERE id = %s AND lote_id = %s AND origen = 'manual'", (barra_id, lote_id))
            cur.execute("UPDATE lotes SET n_barras = (SELECT COUNT(*) FROM barras WHERE lote_id = %s) WHERE id = %s",
                        (lote_id, lote_id))
            cur.execute("SELECT id_proyecto FROM lotes WHERE id = %s", (lote_id,))
            id_proyecto = cur.fetchone()[0]
            try:
                from .sector_estado import marcar_sector_modificado
                marcar_sector_modificado(cur, id_proyecto, b[0], b[1], b[2], por=email)
            except Exception:
                pass
    _cache.invalidate("stats:", "landing:")
    audit(email, "eliminar_barra_lote", f"barra {barra_id} · lote {lote_id}", "lote", str(lote_id))
    return {"ok": True, "lote_id": lote_id, "barra_id": barra_id}


@router.delete("/lotes/{lote_id}")
def eliminar_lote(lote_id: int, user=Depends(get_current_user)):
    """Elimina un lote: borra TODAS sus barras, pero el LOTE queda como LÁPIDA (estado='eliminado'
    + snapshot del resumen + quién/cuándo) para trazabilidad en el histórico de la obra. El número
    de lote (num_obra) NO se reusa. Aplica a cualquier estado, INCLUSO terminado
    (diseno_editor_cubicacion.md §150-168). Confirmación (escribir ELIMINAR) se valida en el front.
    Solo toca barras origen='manual' de ESTE lote (nunca CSV)."""
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            cur.execute("SELECT id_proyecto, estado FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Lote no encontrado.")
            id_proyecto = r[0]
            if r[1] == "eliminado":
                raise HTTPException(status_code=409, detail="El lote ya fue eliminado.")
            # Sectores afectados ANTES de borrar (para marcarlos 'modificado' tras el borrado).
            cur.execute(
                "SELECT DISTINCT sector, piso, ciclo FROM barras WHERE lote_id = %s AND origen = 'manual'",
                (lote_id,),
            )
            sectores_tocados = cur.fetchall()
            # Snapshot del resumen ANTES de borrar las barras (para la lápida del histórico).
            cur.execute(
                """SELECT COUNT(*), COALESCE(SUM(peso_total),0), MIN(sector), MIN(ciclo), MIN(eje)
                   FROM barras WHERE lote_id = %s AND origen = 'manual'""", (lote_id,))
            s = cur.fetchone()
            snap_n, snap_kg, snap_sec, snap_cic, snap_eje = int(s[0]), float(s[1] or 0), s[2], s[3], s[4]
            # Snapshot del DETALLE completo de las barras (para poder VERLAS luego en solo-lectura).
            # Mismos campos que ver_lote, así el front reconstruye la grilla igual.
            _snap_campos = ["id", "sector", "piso", "ciclo", "eje", "marca", "figura", "diam", "cant", "mult",
                            "dim_a", "dim_b", "dim_c", "dim_d", "dim_e", "dim_f", "dim_g", "dim_h", "dim_i",
                            "ang1", "ang2", "ang3", "ang4", "radio", "revisada", "suf_tipo"]
            cur.execute("SELECT " + ", ".join(_snap_campos) +
                        " FROM barras WHERE lote_id = %s AND origen = 'manual' ORDER BY id", (lote_id,))
            snap_barras = [dict(zip(_snap_campos, row)) for row in cur.fetchall()]
            import json as _json
            snap_barras_json = _json.dumps(snap_barras, default=str)
            # Borrar las barras (solo manuales — invariante de canales) y dejar el lote como LÁPIDA.
            cur.execute("DELETE FROM barras WHERE lote_id = %s AND origen = 'manual'", (lote_id,))
            n_barras = cur.rowcount
            cur.execute(
                """UPDATE lotes SET estado='eliminado', n_barras=0,
                       eliminado_por=%s, eliminado_fecha=%s,
                       snap_n_barras=%s, snap_kg=%s, snap_sector=%s, snap_ciclo=%s, snap_eje=%s,
                       snap_barras=%s
                   WHERE id=%s""",
                (email, _now_iso(), snap_n, snap_kg, snap_sec, snap_cic, snap_eje, snap_barras_json, lote_id),
            )
            # Los sectores que quedaron sin esas barras cambian de contenido → 'modificado'.
            try:
                from .sector_estado import marcar_sector_modificado
                for sec, pis, cic in sectores_tocados:
                    marcar_sector_modificado(cur, id_proyecto, sec, pis, cic, por=email)
            except Exception:
                pass
    _cache.invalidate("stats:", "landing:")
    audit(email, "eliminar_lote", f"lote {lote_id} · {n_barras} barras · obra {id_proyecto}", "lote", str(lote_id))
    return {"ok": True, "lote_id": lote_id, "barras_eliminadas": n_barras}


@router.get("/lotes")
def listar_lotes(proyecto: str, user=Depends(get_current_user)):
    """Lista los lotes de una obra (para el repositorio del creador: retomar/ver lotes).
    Cada lote trae conteo de barras y kg REALES (desde la tabla barras) + sector/ciclo/eje
    representativos de la tanda (para mostrar de qué es el lote)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            # num_obra: correlativo FIJO del lote en la obra (columna, asignado al crear; nunca se
            # recalcula). Para lotes ELIMINADOS (lápidas) las barras ya no existen → se usa el
            # snapshot (snap_*) guardado al eliminar. Se incluyen las lápidas en el histórico.
            # n_items = nº de ENTRADAS/filas (COUNT). n_barras = BARRAS FÍSICAS = SUM(cant_total).
            # Nomenclatura estandarizada: "items"=filas, "barras"=físicas. Para lápidas se usa el
            # snapshot (snap_n_barras era el COUNT histórico; las físicas se derivan del snap_barras).
            cur.execute(
                """
                SELECT l.id, l.estado, l.creado_por, l.creado_fecha, l.terminado_fecha,
                       CASE WHEN l.estado='eliminado' THEN COALESCE(l.snap_n_barras,0) ELSE COUNT(b.id_unico) END AS n_items,
                       CASE WHEN l.estado='eliminado' THEN 0 ELSE COALESCE(SUM(b.cant_total),0) END AS n_barras,
                       CASE WHEN l.estado='eliminado' THEN COALESCE(l.snap_kg,0)       ELSE COALESCE(SUM(b.peso_total),0) END AS kg,
                       CASE WHEN l.estado='eliminado' THEN l.snap_sector ELSE MIN(b.sector) END AS sector,
                       CASE WHEN l.estado='eliminado' THEN l.snap_ciclo  ELSE MIN(b.ciclo)  END AS ciclo,
                       CASE WHEN l.estado='eliminado' THEN l.snap_eje    ELSE MIN(b.eje)    END AS eje,
                       l.num_obra, l.eliminado_por, l.eliminado_fecha, l.snap_barras
                FROM lotes l
                LEFT JOIN barras b ON b.lote_id = l.id
                WHERE l.id_proyecto = %s
                GROUP BY l.id, l.estado, l.creado_por, l.creado_fecha, l.terminado_fecha,
                         l.snap_n_barras, l.snap_kg, l.snap_sector, l.snap_ciclo, l.snap_eje,
                         l.num_obra, l.eliminado_por, l.eliminado_fecha, l.snap_barras
                ORDER BY l.num_obra DESC NULLS LAST, l.id DESC
                """,
                (proyecto,),
            )
            # Columnas: 0 id, 1 estado, 2 creado_por, 3 creado_fecha, 4 terminado_fecha, 5 n_items,
            # 6 n_barras(físicas), 7 kg, 8 sector, 9 ciclo, 10 eje, 11 num_obra, 12 eliminado_por,
            # 13 eliminado_fecha, 14 snap_barras.
            import json as _json
            lotes = []
            for r in cur.fetchall():
                n_barras = float(r[6] or 0)
                if r[1] == "eliminado":
                    # Barras físicas de una lápida: derivar de snap_barras (cant×mult) si existe.
                    snap = r[14]
                    if isinstance(snap, str):
                        try: snap = _json.loads(snap)
                        except Exception: snap = []
                    if snap:
                        n_barras = sum((x.get("cant") or 0) * (x.get("mult") or 1) for x in snap)
                lotes.append({
                    "id": r[0], "estado": r[1], "creado_por": r[2], "creado_fecha": r[3],
                    "terminado_fecha": r[4], "n_items": int(r[5] or 0), "n_barras": n_barras,
                    "kg": float(r[7] or 0), "sector": r[8], "ciclo": r[9], "eje": r[10],
                    "num_obra": r[11], "eliminado_por": r[12], "eliminado_fecha": r[13],
                })
    return {"ok": True, "lotes": lotes}


@router.get("/lotes/{lote_id}")
def ver_lote(lote_id: int, user=Depends(get_current_user)):
    """Estado del lote + SUS barras (para RETOMAR un lote en el creador). Trae los campos que el
    formulario necesita para reconstruir cada barra (ubicación, diám, figura, dims, áng, revisada)."""
    from .barras import BARRAS_COLUMNS
    # Incluimos `id` (id de BD) para que el front lo asocie a cada barra (_dbid) y pueda sincronizar
    # su estado "revisada" (/revisar) al terminar un lote retomado.
    campos = ["id", "sector", "piso", "ciclo", "eje", "marca", "figura", "diam", "cant", "mult",
              "dim_a", "dim_b", "dim_c", "dim_d", "dim_e", "dim_f", "dim_g", "dim_h", "dim_i",
              "ang1", "ang2", "ang3", "ang4", "radio", "revisada", "suf_tipo"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            cur.execute(
                "SELECT id, id_proyecto, estado, creado_por, creado_fecha, terminado_fecha, n_barras, num_obra, snap_barras "
                "FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Lote no encontrado.")
            num_obra = r[7]   # correlativo FIJO por obra (columna)
            estado = r[2]
            lote = {"id": r[0], "id_proyecto": r[1], "estado": estado, "creado_por": r[3],
                    "creado_fecha": r[4], "terminado_fecha": r[5], "n_barras": r[6], "num_obra": num_obra}
            if estado == "eliminado":
                # Lote ELIMINADO: sus barras ya no están en la tabla; se leen del snapshot congelado
                # (solo lectura). El front las muestra bloqueadas/en gris.
                import json as _json
                snap = r[8]
                if isinstance(snap, str):
                    try: snap = _json.loads(snap)
                    except Exception: snap = []
                barras = snap or []
            else:
                cur.execute(
                    "SELECT " + ", ".join(campos) + " FROM barras WHERE lote_id = %s ORDER BY id",
                    (lote_id,))
                barras = [dict(zip(campos, row)) for row in cur.fetchall()]
    return {"ok": True, "lote": lote, "barras": barras}


@router.get("/diametros-estandar")
def diametros_estandar(user=Depends(get_current_user)):
    """Lista fija de diámetros estándar (5N.12)."""
    return {"diametros": _DIAM_ESTANDAR}
