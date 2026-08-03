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
            cur.execute(
                """INSERT INTO lotes (id_proyecto, tipo, estado, creado_por, creado_fecha, n_barras)
                   VALUES (%s, 'manual', 'borrador', %s, %s, 0) RETURNING id""",
                (body.id_proyecto, email, _now_iso()),
            )
            lote_id = cur.fetchone()[0]
            # Correlativo del lote DENTRO de la obra (lo que ve el usuario). Es el conteo de lotes
            # de esa obra con id <= el recién creado (= su posición 1..N).
            cur.execute("SELECT COUNT(*) FROM lotes WHERE id_proyecto = %s AND id <= %s",
                        (body.id_proyecto, lote_id))
            num_obra = int(cur.fetchone()[0])
    audit(email, "crear_lote", f"obra {body.id_proyecto}", "lote", str(lote_id))
    return {"ok": True, "lote_id": lote_id, "estado": "borrador", "num_obra": num_obra}


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


@router.delete("/lotes/{lote_id}")
def eliminar_lote(lote_id: int, user=Depends(get_current_user)):
    """Elimina un lote y TODAS sus barras (átomo de carga, análogo a 'eliminar carga CSV').
    Aplica a cualquier estado, INCLUSO terminado (diseno_editor_cubicacion.md §150-168): es la
    ÚNICA forma de borrar un lote. La confirmación (escribir ELIMINAR) se hace en el front; aquí
    se ejecuta el borrado. Solo toca barras origen='manual' de ESTE lote (nunca CSV)."""
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            cur.execute("SELECT id_proyecto FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Lote no encontrado.")
            id_proyecto = r[0]
            # Sectores afectados ANTES de borrar (para marcarlos 'modificado' tras el borrado).
            cur.execute(
                "SELECT DISTINCT sector, piso, ciclo FROM barras WHERE lote_id = %s AND origen = 'manual'",
                (lote_id,),
            )
            sectores_tocados = cur.fetchall()
            # Borrar barras del lote (solo manuales — invariante de canales) y luego el lote.
            cur.execute("DELETE FROM barras WHERE lote_id = %s AND origen = 'manual'", (lote_id,))
            n_barras = cur.rowcount
            cur.execute("DELETE FROM lotes WHERE id = %s", (lote_id,))
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
            # num_obra: correlativo del lote DENTRO de la obra (1,2,3…) por orden de creación (id).
            # El `id` real (SERIAL global) se mantiene para uso interno; num_obra es lo que ve el
            # usuario ("Lote #1 de esta obra" aunque el id global sea 7).
            cur.execute(
                """
                SELECT l.id, l.estado, l.creado_por, l.creado_fecha, l.terminado_fecha,
                       COUNT(b.id_unico)                       AS n_barras,
                       COALESCE(SUM(b.peso_total), 0)          AS kg,
                       MIN(b.sector) AS sector, MIN(b.ciclo) AS ciclo, MIN(b.eje) AS eje,
                       ROW_NUMBER() OVER (ORDER BY l.id)       AS num_obra
                FROM lotes l
                LEFT JOIN barras b ON b.lote_id = l.id
                WHERE l.id_proyecto = %s
                GROUP BY l.id, l.estado, l.creado_por, l.creado_fecha, l.terminado_fecha
                ORDER BY l.id DESC
                """,
                (proyecto,),
            )
            lotes = [
                {"id": r[0], "estado": r[1], "creado_por": r[2], "creado_fecha": r[3],
                 "terminado_fecha": r[4], "n_barras": r[5], "kg": float(r[6] or 0),
                 "sector": r[7], "ciclo": r[8], "eje": r[9], "num_obra": r[10]}
                for r in cur.fetchall()
            ]
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
                "SELECT id, id_proyecto, estado, creado_por, creado_fecha, terminado_fecha, n_barras "
                "FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Lote no encontrado.")
            # Correlativo por obra (lo que ve el usuario), independiente del id global.
            cur.execute("SELECT COUNT(*) FROM lotes WHERE id_proyecto = %s AND id <= %s", (r[1], r[0]))
            num_obra = int(cur.fetchone()[0])
            lote = {"id": r[0], "id_proyecto": r[1], "estado": r[2], "creado_por": r[3],
                    "creado_fecha": r[4], "terminado_fecha": r[5], "n_barras": r[6], "num_obra": num_obra}
            cur.execute(
                "SELECT " + ", ".join(campos) + " FROM barras WHERE lote_id = %s ORDER BY id",
                (lote_id,))
            barras = [dict(zip(campos, row)) for row in cur.fetchall()]
    return {"ok": True, "lote": lote, "barras": barras}


@router.get("/diametros-estandar")
def diametros_estandar(user=Depends(get_current_user)):
    """Lista fija de diámetros estándar (5N.12)."""
    return {"diametros": _DIAM_ESTANDAR}
