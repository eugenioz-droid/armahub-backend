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

from psycopg.errors import UniqueViolation

from .db import get_conn, audit
from .peso import peso_unitario_kg
from .auth import get_current_user
from . import cache as _cache
from .diametros import DIAM_ESTANDAR as _DIAM_ESTANDAR, cod_prod_de_diam

router = APIRouter()


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _peso_teorico(diam, largo):
    """M1.3: delega en peso.py (fórmula única de la plataforma)."""
    return peso_unitario_kg(diam, largo)


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
    # Ubicación del despiece (se estampa en el lote para el histórico, aunque aún no tenga barras).
    ciclo: Optional[str] = None
    eje: Optional[str] = None
    sector: Optional[str] = None
    estructura: Optional[str] = None


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
    # Modelador 3D (T1.1): origen/traza OPCIONALES. Default = comportamiento actual intacto
    # (barra manual, sin instancia de template). El 3D Template manda origen='template' +
    # el id de la receta (elementos_template) para trazabilidad. No cambia nada más.
    origen: Optional[str] = None
    template_instancia_id: Optional[int] = None


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
            # M1.8: índice único (migración 102) + reintento con savepoint — dos creaciones
            # simultáneas ya no pueden duplicar num_obra; el perdedor recalcula.
            for _intento in range(3):
                try:
                    with conn.transaction():
                        cur.execute("SELECT COALESCE(MAX(num_obra), 0) + 1 FROM lotes WHERE id_proyecto = %s",
                                    (body.id_proyecto,))
                        num_obra = int(cur.fetchone()[0])
                        cur.execute(
                            """INSERT INTO lotes (id_proyecto, tipo, estado, creado_por, creado_fecha, n_barras,
                                                  num_obra, ciclo, eje, sector, estructura)
                               VALUES (%s, 'manual', 'borrador', %s, %s, 0, %s, %s, %s, %s, %s) RETURNING id""",
                            (body.id_proyecto, email, _now_iso(), num_obra,
                             (body.ciclo or None), (body.eje or None), (body.sector or None), (body.estructura or None)),
                        )
                        lote_id = cur.fetchone()[0]
                    break
                except UniqueViolation:
                    if _intento == 2:
                        raise HTTPException(status_code=409, detail="Conflicto al numerar el despiece. Reintenta.")
    audit(email, "crear_lote", f"obra {body.id_proyecto} · {body.sector}/{body.ciclo}/{body.eje}", "lote", str(lote_id))
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


class LoteContexto(BaseModel):
    ciclo: str          # nuevo ciclo del despiece
    eje: str            # nuevo eje del despiece


@router.patch("/lotes/{lote_id}/contexto")
def reasignar_contexto(lote_id: int, body: LoteContexto, user=Depends(get_current_user)):
    """Reasigna el CICLO y EJE de TODAS las barras de un despiece en BORRADOR (aún no terminado).
    Permite corregir un eje/ciclo mal escrito sin dejar el registro sucio: mientras el despiece está
    abierto (sin bandera) el nombre es editable. Un despiece TERMINADO ya no se puede reasignar."""
    email = user.get("email", "?")
    ciclo = (body.ciclo or "").strip()
    eje = (body.eje or "").strip()
    if not ciclo or not eje:
        raise HTTPException(status_code=400, detail="Ciclo y Eje son obligatorios.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            cur.execute("SELECT id_proyecto, estado FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Despiece no encontrado.")
            id_proyecto, estado = r[0], r[1]
            if estado != "borrador":
                raise HTTPException(status_code=409,
                                    detail="Solo se puede reasignar ciclo/eje mientras el despiece está en edición (no terminado ni eliminado).")
            # Sectores tocados (antes y con el nuevo ciclo) para marcar 'modificado'.
            cur.execute("SELECT DISTINCT sector, piso, ciclo FROM barras WHERE lote_id = %s", (lote_id,))
            sectores = cur.fetchall()
            cur.execute(
                "UPDATE barras SET ciclo=%s, eje=%s, editado_por=%s, editado_fecha=%s "
                "WHERE lote_id=%s",
                (ciclo, eje, email, _now_iso(), lote_id))
            n = cur.rowcount
            # Sincronizar la ubicación del LOTE (para el histórico, aunque no tenga barras).
            cur.execute("UPDATE lotes SET ciclo=%s, eje=%s WHERE id=%s", (ciclo, eje, lote_id))
            try:
                from .sector_estado import marcar_sector_modificado
                for sec, pis, cic in sectores:
                    marcar_sector_modificado(cur, id_proyecto, sec, pis, cic, por=email)
                    marcar_sector_modificado(cur, id_proyecto, sec, pis, ciclo, por=email)
            except Exception:
                pass
    _cache.invalidate("stats:", "landing:")
    audit(email, "reasignar_contexto_lote", f"lote {lote_id} → ciclo {ciclo} · eje {eje} ({n} barras)", "lote", str(lote_id))
    return {"ok": True, "lote_id": lote_id, "ciclo": ciclo, "eje": eje, "barras": n}


class LotePlano(BaseModel):
    plano: str = ""


@router.patch("/lotes/{lote_id}/plano")
def fijar_plano(lote_id: int, body: LotePlano, user=Depends(get_current_user)):
    """M1.10 — Fija el PLANO del despiece (edificio = un plano por lote). Editable mientras el
    despiece está en BORRADOR; se estampa a nombre_plano de sus barras manuales.
    NOTA: se usa nombre_plano (el NOMBRE legible del plano, mismo campo que trae el header del
    CSV: 'PLANO: UID|Nombre'), NO plano_code (que es el código interno UID de ADetailer)."""
    email = user.get("email", "?")
    plano = (body.plano or "").strip()[:120]
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            cur.execute("SELECT estado FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Despiece no encontrado.")
            if r[0] != "borrador":
                raise HTTPException(status_code=409, detail="El plano solo se edita mientras el despiece está en edición.")
            cur.execute("UPDATE lotes SET plano=%s WHERE id=%s", (plano or None, lote_id))
            cur.execute(
                "UPDATE barras SET nombre_plano=%s, editado_por=%s, editado_fecha=%s "
                "WHERE lote_id=%s",
                (plano or None, email, _now_iso(), lote_id))
            n = cur.rowcount
    audit(email, "fijar_plano_lote", f"lote {lote_id} → {plano or '(vacío)'} ({n} barras)", "lote", str(lote_id))
    return {"ok": True, "lote_id": lote_id, "plano": plano, "barras": n}


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
            cur.execute("SELECT id_proyecto, estado, snap_barras, sector, estructura FROM lotes WHERE id = %s",
                        (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Lote origen no encontrado.")
            id_proyecto, estado_o, snap = r[0], r[1], r[2]
            sector_o, estructura_o = r[3], r[4]
            # nombre_plano/origen/template_instancia_id TAMBIÉN viajan (hallazgo de
            # auditoría: el duplicado los perdía → columna PLANO del export en
            # blanco y trazabilidad de template cortada — "algunas cosas no
            # quedaron bien guardadas").
            campos = ["sector", "piso", "marca", "figura", "diam", "cant", "mult",
                      "dim_a", "dim_b", "dim_c", "dim_d", "dim_e", "dim_f", "dim_g", "dim_h", "dim_i",
                      "ang1", "ang2", "ang3", "ang4", "radio", "suf_tipo",
                      "nombre_plano", "origen", "template_instancia_id"]
            if estado_o == "eliminado":
                import json as _json
                origen = snap if isinstance(snap, list) else (_json.loads(snap) if snap else [])
            else:
                # TODAS las barras del despiece. ANTES se filtraba `AND origen = 'manual'`
                # y eso PERDÍA barras en silencio: `origen` admite NULL (por eso el resto
                # del código lo lee como COALESCE(origen,'csv')), y en SQL `NULL = 'manual'`
                # NO es verdadero → esas barras quedaban fuera del duplicado. El usuario
                # veía "duplicado (N barras)" con menos barras que el original, o un 400
                # "no tiene barras que duplicar" en un despiece que sí las tenía.
                # El filtro además era redundante: `lote_id` YA acota al despiece (las
                # barras de CSV y de pedidos no pertenecen a ningún lote).
                cur.execute("SELECT " + ", ".join(campos) +
                            " FROM barras WHERE lote_id = %s ORDER BY id", (lote_id,))
                origen = [dict(zip(campos, row)) for row in cur.fetchall()]
            if not origen:
                raise HTTPException(status_code=400, detail="El lote origen no tiene barras que duplicar.")
            # Crear el lote nuevo (num_obra fijo). M1.8: reintento sobre índice único.
            for _intento in range(3):
                try:
                    with conn.transaction():
                        cur.execute("SELECT COALESCE(MAX(num_obra), 0) + 1 FROM lotes WHERE id_proyecto = %s", (id_proyecto,))
                        num_obra = int(cur.fetchone()[0])
                        # El lote nuevo nace con su CONTEXTO completo, igual que
                        # crear_lote: sector/estructura heredados del origen y el
                        # ciclo/eje elegidos. Antes quedaban NULL y el despiece
                        # duplicado nacía sin contexto propio (el histórico lo
                        # disimulaba con COALESCE(l.ciclo, MIN(b.ciclo))).
                        cur.execute(
                            """INSERT INTO lotes (id_proyecto, tipo, estado, creado_por, creado_fecha,
                                                  n_barras, num_obra, ciclo, eje, sector, estructura)
                               VALUES (%s, 'manual', 'borrador', %s, %s, 0, %s, %s, %s, %s, %s) RETURNING id""",
                            (id_proyecto, email, _now_iso(), num_obra,
                             ciclo, eje, sector_o, estructura_o))
                        nuevo_id = cur.fetchone()[0]
                    break
                except UniqueViolation:
                    if _intento == 2:
                        raise HTTPException(status_code=409, detail="Conflicto al numerar el despiece. Reintenta.")
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
                # nombre_plano viaja (antes se perdía → columna PLANO del export en
                # blanco); origen se HEREDA (antes 'manual' fijo: una barra de
                # template duplicada perdía su clase) y template_instancia_id
                # conserva la trazabilidad de la receta.
                cur.execute(
                    """INSERT INTO barras
                       (id_unico, id_proyecto, sector, piso, ciclo, eje, diam, largo_total,
                        mult, cant, cant_total, peso_unitario, peso_total, marca, figura, cod_proyecto,
                        dim_a, dim_b, dim_c, dim_d, dim_e, dim_f, dim_g, dim_h, dim_i,
                        ang1, ang2, ang3, ang4, radio, suf_tipo, nombre_plano,
                        origen, template_instancia_id,
                        import_id, lote_id, estado, fecha_carga, creado_por, editado_por, editado_fecha)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s, %s,%s,%s,%s,%s,%s,%s,%s,
                               %s,%s,%s,%s,%s,%s,%s,%s,%s, %s,%s,%s,%s,%s,%s,%s,
                               %s, %s,
                               NULL, %s, 'borrador', %s, %s, %s, %s)""",
                    (idu, id_proyecto, b.get("sector"), b.get("piso"), ciclo, eje, b.get("diam"), largo,
                     b.get("mult"), b.get("cant"), cant_total, peso_u, peso_t, b.get("marca"), b.get("figura"), cod_prod,
                     b.get("dim_a"), b.get("dim_b"), b.get("dim_c"), b.get("dim_d"), b.get("dim_e"),
                     b.get("dim_f"), b.get("dim_g"), b.get("dim_h"), b.get("dim_i"),
                     b.get("ang1"), b.get("ang2"), b.get("ang3"), b.get("ang4"), b.get("radio"),
                     ((b.get("suf_tipo") or "").strip() or None),
                     ((b.get("nombre_plano") or "").strip() or None),
                     (b.get("origen") or "manual"),
                     b.get("template_instancia_id"),
                     nuevo_id, now, email, email, now))   # creado_por = quien duplica
                n += 1
            cur.execute("UPDATE lotes SET n_barras = %s WHERE id = %s", (n, nuevo_id))
            try:
                from .sector_estado import marcar_sector_modificado
                for sec, pis in {(b.get("sector"), b.get("piso")) for b in origen}:
                    marcar_sector_modificado(cur, id_proyecto, sec, pis, ciclo, por=email)
            except Exception:
                pass
    _cache.invalidate("stats:", "landing:")
    # El detalle lleva el nº POR OBRA (#N, el que ve el usuario en el histórico)
    # además del id global: sin él, un registro de auditoría no era rastreable
    # contra la pantalla de despieces.
    audit(email, "duplicar_lote",
          f"origen {lote_id} → {nuevo_id} (#{num_obra} en la obra) · {n} barras",
          "lote", str(nuevo_id))
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
                faltan = [n for n, val in (("sector", b.sector), ("piso", b.piso), ("ciclo", b.ciclo), ("eje", b.eje))
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
                # Modelador 3D (T1.1): origen OPCIONAL (default 'manual' → intacto) + template_instancia_id.
                # Solo se aceptan orígenes conocidos de este canal (manual/template); cualquier otro
                # cae a 'manual' (no se permite inyectar 'csv'/'pedido' desde aquí — invariante de canales).
                origen_barra = (b.origen or "manual").strip().lower()
                if origen_barra not in ("manual", "template"):
                    origen_barra = "manual"
                cur.execute(
                    """INSERT INTO barras
                       (id_unico, id_proyecto, sector, piso, ciclo, eje, nombre_plano, diam, largo_total,
                        mult, cant, cant_total, peso_unitario, peso_total, marca, figura, cod_proyecto,
                        dim_a, dim_b, dim_c, dim_d, dim_e, dim_f, dim_g, dim_h, dim_i,
                        ang1, ang2, ang3, ang4, radio,
                        revisada, revisada_por, revisada_fecha, suf_tipo,
                        origen, template_instancia_id, import_id, lote_id, estado, fecha_carga, creado_por, editado_por, editado_fecha)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s, %s,%s,%s,%s,%s,%s,%s,%s,
                               %s,%s,%s,%s,%s,%s,%s,%s,%s, %s,%s,%s,%s,%s,
                               %s,%s,%s,%s,
                               %s, %s, NULL, %s, 'borrador', %s, %s, %s, %s) RETURNING id""",
                    (idu, id_proyecto, b.sector, b.piso, b.ciclo, b.eje, b.nombre_plano, b.diam, largo,
                     b.mult, b.cant, cant_total, peso_u, peso_t, b.marca, b.figura, cod_prod,
                     b.dim_a, b.dim_b, b.dim_c, b.dim_d, b.dim_e, b.dim_f, b.dim_g, b.dim_h, b.dim_i,
                     b.ang1, b.ang2, b.ang3, b.ang4, b.radio,
                     bool(b.revisada), rev_por, rev_fecha, ((b.suf_tipo or "").strip() or None),
                     origen_barra, b.template_instancia_id,
                     lote_id, now, email, email, now),   # creado_por = editado_por = quien cubica
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
    contaba como no revisada. Barras de CUALQUIER origen del lote (manual o template:
    las del enfierrador daban 404 con el filtro viejo origen='manual') de un lote NO terminado."""
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
                "SELECT sector, piso, ciclo FROM barras WHERE id = %s AND lote_id = %s",
                (barra_id, lote_id))
            b = cur.fetchone()
            if not b:
                raise HTTPException(status_code=404, detail="Barra no encontrada en este lote.")
            cur.execute("DELETE FROM barras WHERE id = %s AND lote_id = %s", (barra_id, lote_id))
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
    Toca TODAS las barras de ESTE lote (manual y template; el filtro viejo origen='manual'
    dejaba las barras del enfierrador HUERFANAS apuntando a la lapida). Las de CSV no
    pertenecen a lotes, asi que siguen intactas por construccion."""
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
                "SELECT DISTINCT sector, piso, ciclo FROM barras WHERE lote_id = %s",
                (lote_id,),
            )
            sectores_tocados = cur.fetchall()
            # Snapshot del resumen ANTES de borrar las barras (para la lápida del histórico).
            cur.execute(
                """SELECT COUNT(*), COALESCE(SUM(peso_total),0), MIN(sector), MIN(ciclo), MIN(eje)
                   FROM barras WHERE lote_id = %s""", (lote_id,))
            s = cur.fetchone()
            snap_n, snap_kg, snap_sec, snap_cic, snap_eje = int(s[0]), float(s[1] or 0), s[2], s[3], s[4]
            # DESPIECE VACÍO (0 barras): NO se lapida (no hay data que preservar → sería una lápida
            # basura). Se borra FÍSICAMENTE y libera su número. La lápida solo tiene sentido si había
            # data real. Esto evita lápidas en cero en el histórico. El return se hace FUERA del `with`
            # (patrón de descartar_lote_vacio) para no saltar el commit del context manager.
            vacio = (snap_n == 0)
            n_barras = 0
            if vacio:
                cur.execute("DELETE FROM lotes WHERE id = %s", (lote_id,))
            else:
                # Snapshot del DETALLE completo de las barras (para poder VERLAS luego en solo-lectura).
                # Mismos campos que ver_lote, así el front reconstruye la grilla igual.
                # nombre_plano/origen/template_instancia_id también al snapshot: sin
                # ellos, duplicar DESDE una lápida los perdía aunque el duplicado
                # normal ya los copie (misma auditoría del incidente del export).
                _snap_campos = ["id", "sector", "piso", "ciclo", "eje", "marca", "figura", "diam", "cant", "mult",
                                "dim_a", "dim_b", "dim_c", "dim_d", "dim_e", "dim_f", "dim_g", "dim_h", "dim_i",
                                "ang1", "ang2", "ang3", "ang4", "radio", "revisada", "suf_tipo",
                                "nombre_plano", "origen", "template_instancia_id"]
                cur.execute("SELECT " + ", ".join(_snap_campos) +
                            " FROM barras WHERE lote_id = %s ORDER BY id", (lote_id,))
                snap_barras = [dict(zip(_snap_campos, row)) for row in cur.fetchall()]
                import json as _json
                snap_barras_json = _json.dumps(snap_barras, default=str)
                # Borrar las barras (solo manuales — invariante de canales) y dejar el lote como LÁPIDA.
                cur.execute("DELETE FROM barras WHERE lote_id = %s", (lote_id,))
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
    if vacio:
        audit(email, "eliminar_lote_vacio", f"lote {lote_id} (sin barras) · obra {id_proyecto}", "lote", str(lote_id))
        return {"ok": True, "lote_id": lote_id, "barras_eliminadas": 0, "purgado": True}
    audit(email, "eliminar_lote", f"lote {lote_id} · {n_barras} barras · obra {id_proyecto}", "lote", str(lote_id))
    return {"ok": True, "lote_id": lote_id, "barras_eliminadas": n_barras}


@router.delete("/lotes/{lote_id}/purgar")
def purgar_lote(lote_id: int, user=Depends(get_current_user)):
    """PURGA FÍSICA de un despiece del histórico. SOLO ADMIN. Borra la fila del lote y cualquier
    barra manual residual — para limpiar registros mal asignados por usuarios nuevos. Es
    IRREVERSIBLE y no deja lápida. Distinto de 'eliminar' (que deja lápida con snapshot)."""
    role = (user.get("role") or "").lower()
    if role not in ("admin", "admin_calidad"):
        raise HTTPException(status_code=403, detail="Solo un administrador puede purgar despieces del histórico.")
    email = user.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id_proyecto, num_obra FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Despiece no encontrado.")
            id_proyecto, num_purgado = r[0], r[1]
            # Sectores tocados (por si quedaban barras) para marcarlos modificados tras purgar.
            cur.execute("SELECT DISTINCT sector, piso, ciclo FROM barras WHERE lote_id = %s", (lote_id,))
            sectores = cur.fetchall()
            cur.execute("DELETE FROM barras WHERE lote_id = %s", (lote_id,))
            n = cur.rowcount
            cur.execute("DELETE FROM lotes WHERE id = %s", (lote_id,))
            # RENUMERAR EN CASCADA (solo en la purga admin, acción muy eventual): todos los despieces
            # de la MISMA obra con num_obra mayor al purgado bajan en 1, para no dejar hueco y mantener
            # el correlativo en orden. La eliminación con lápida NO renumera (el número queda estable);
            # esto es exclusivo del borrado físico del histórico.
            renumerados = 0
            if num_purgado is not None:
                cur.execute(
                    "UPDATE lotes SET num_obra = num_obra - 1 "
                    "WHERE id_proyecto = %s AND num_obra > %s",
                    (id_proyecto, num_purgado),
                )
                renumerados = cur.rowcount
            try:
                from .sector_estado import marcar_sector_modificado
                for sec, pis, cic in sectores:
                    marcar_sector_modificado(cur, id_proyecto, sec, pis, cic, por=email)
            except Exception:
                pass
    _cache.invalidate("stats:", "landing:")
    audit(email, "purgar_lote", f"lote {lote_id} · {n} barras · obra {id_proyecto} · #{num_purgado} (PURGA ADMIN, {renumerados} renumerados)", "lote", str(lote_id))
    return {"ok": True, "lote_id": lote_id, "barras_purgadas": n, "renumerados": renumerados}


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
                       CASE WHEN l.estado='eliminado' THEN l.snap_sector ELSE COALESCE(l.sector, MIN(b.sector)) END AS sector,
                       CASE WHEN l.estado='eliminado' THEN l.snap_ciclo  ELSE COALESCE(l.ciclo,  MIN(b.ciclo))  END AS ciclo,
                       CASE WHEN l.estado='eliminado' THEN l.snap_eje    ELSE COALESCE(l.eje,    MIN(b.eje))    END AS eje,
                       l.num_obra, l.eliminado_por, l.eliminado_fecha, l.snap_barras,
                       -- Ø PROMEDIO PONDERADO POR PESO (mismo criterio que el KPI de
                       -- obra en barras.py): Σ(diam·peso)/Σ(peso). No es el promedio
                       -- simple de diámetros — pondera por cuánto acero aporta cada uno.
                       COALESCE(ROUND(CAST(SUM(b.diam * b.peso_total) /
                                NULLIF(SUM(b.peso_total), 0) AS NUMERIC), 1), 0) AS diam_prom
                FROM lotes l
                LEFT JOIN barras b ON b.lote_id = l.id
                WHERE l.id_proyecto = %s
                GROUP BY l.id, l.estado, l.creado_por, l.creado_fecha, l.terminado_fecha,
                         l.snap_n_barras, l.snap_kg, l.snap_sector, l.snap_ciclo, l.snap_eje,
                         l.sector, l.ciclo, l.eje,
                         l.num_obra, l.eliminado_por, l.eliminado_fecha, l.snap_barras
                ORDER BY l.num_obra DESC NULLS LAST, l.id DESC
                """,
                (proyecto,),
            )
            # Columnas: 0 id, 1 estado, 2 creado_por, 3 creado_fecha, 4 terminado_fecha, 5 n_items,
            # 6 n_barras(físicas), 7 kg, 8 sector, 9 ciclo, 10 eje, 11 num_obra, 12 eliminado_por,
            # 13 eliminado_fecha, 14 snap_barras, 15 diam_prom.
            import json as _json
            lotes = []
            for r in cur.fetchall():
                n_items = int(r[5] or 0)
                n_barras = float(r[6] or 0)
                kg = float(r[7] or 0)
                if r[1] == "eliminado":
                    # Lápida: si el snapshot de resumen (snap_n_barras/snap_kg) quedó vacío pero hay
                    # detalle (snap_barras), derivar items/barras/kg del detalle. Barras físicas =
                    # Σ cant×mult; items = nº de filas; kg = Σ peso (si el detalle lo trajera).
                    snap = r[14]
                    if isinstance(snap, str):
                        try: snap = _json.loads(snap)
                        except Exception: snap = []
                    if snap:
                        n_barras = sum((x.get("cant") or 0) * (x.get("mult") or 1) for x in snap)
                        if not n_items:
                            n_items = len(snap)
                lotes.append({
                    "id": r[0], "estado": r[1], "creado_por": r[2], "creado_fecha": r[3],
                    "terminado_fecha": r[4], "n_items": n_items, "n_barras": n_barras,
                    "kg": kg, "sector": r[8], "ciclo": r[9], "eje": r[10],
                    "num_obra": r[11], "eliminado_por": r[12], "eliminado_fecha": r[13],
                    # KPIs del despiece. PPB/PPI se derivan en el front (kg/barras,
                    # kg/items); el Ø prom viene ponderado por peso desde el SQL.
                    "diam_prom": float(r[15] or 0),
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
                "SELECT id, id_proyecto, estado, creado_por, creado_fecha, terminado_fecha, n_barras, num_obra, snap_barras, plano "
                "FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Lote no encontrado.")
            num_obra = r[7]   # correlativo FIJO por obra (columna)
            estado = r[2]
            lote = {"id": r[0], "id_proyecto": r[1], "estado": estado, "creado_por": r[3],
                    "creado_fecha": r[4], "terminado_fecha": r[5], "n_barras": r[6], "num_obra": num_obra,
                    "plano": r[9]}
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


@router.get("/despieces/obras-activas")
def obras_con_despieces(user=Depends(get_current_user)):
    """Obras que TIENEN despieces (cualquier estado, salvo lápidas eliminadas) — para la landing del
    editor: es el punto de entrada para RETOMAR/ver trabajo. Distinto del buscador, que encuentra
    CUALQUIER obra del sistema (única forma de crear el primer despiece a una obra sin ninguno).
    Por obra: nombre, nº de despieces EN EDICIÓN (borrador), total de despieces, KPIs de lo LISTO
    (barras terminadas: items/barras/kg) y último movimiento."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Obras con al menos un despiece NO eliminado + conteo total, en edición, y último mov.
            cur.execute("""
                SELECT l.id_proyecto,
                       COALESCE(p.nombre_proyecto, l.id_proyecto) AS nombre,
                       COUNT(*) FILTER (WHERE l.estado = 'borrador')  AS en_edicion,
                       COUNT(*)                                        AS total,
                       MAX(COALESCE(l.terminado_fecha, l.creado_fecha)) AS ult
                FROM lotes l
                LEFT JOIN proyectos p ON p.id_proyecto = l.id_proyecto
                WHERE l.estado IS DISTINCT FROM 'eliminado'
                GROUP BY l.id_proyecto, p.nombre_proyecto
            """)
            obras = [{"id_proyecto": r[0], "nombre": r[1], "en_edicion": int(r[2] or 0),
                      "total": int(r[3] or 0), "ultimo": (r[4] or "")[:10]}
                     for r in cur.fetchall()]
            if not obras:
                return {"obras": []}
            ids = [o["id_proyecto"] for o in obras]
            # KPIs de lo LISTO por obra (barras terminadas: no borrador, no eliminadas físicamente).
            # items = filas; barras = Σ cant_total; kg = Σ peso_total. Excluye borrador.
            cur.execute("""
                SELECT id_proyecto,
                       COUNT(*) AS items,
                       COALESCE(SUM(cant_total), 0) AS barras,
                       COALESCE(SUM(peso_total), 0) AS kg
                FROM barras
                WHERE id_proyecto = ANY(%s) AND estado = 'terminada'
                GROUP BY id_proyecto
            """, (ids,))
            kpi = {r[0]: {"items": int(r[1]), "barras": float(r[2] or 0), "kg": round(float(r[3] or 0), 1)}
                   for r in cur.fetchall()}
    for o in obras:
        k = kpi.get(o["id_proyecto"], {"items": 0, "barras": 0, "kg": 0})
        o.update(k)
    obras.sort(key=lambda o: o["ultimo"], reverse=True)   # más reciente arriba
    return {"obras": obras}
