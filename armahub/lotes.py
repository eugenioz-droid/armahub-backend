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
    audit(email, "crear_lote", f"obra {body.id_proyecto}", "lote", str(lote_id))
    return {"ok": True, "lote_id": lote_id, "estado": "borrador"}


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
            cur.execute(
                "UPDATE lotes SET estado = 'terminada', terminado_fecha = %s WHERE id = %s",
                (_now_iso(), lote_id),
            )
            # Las barras del lote pasan a 'terminada' (se editan solo desde Bar Manager).
            cur.execute("UPDATE barras SET estado = 'terminada' WHERE lote_id = %s", (lote_id,))
    audit(email, "terminar_lote", "", "lote", str(lote_id))
    return {"ok": True, "lote_id": lote_id, "estado": "terminada"}


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
                cur.execute(
                    """INSERT INTO barras
                       (id_unico, id_proyecto, sector, piso, ciclo, eje, nombre_plano, diam, largo_total,
                        mult, cant, cant_total, peso_unitario, peso_total, marca, figura, cod_proyecto,
                        dim_a, dim_b, dim_c, dim_d, dim_e, dim_f, dim_g, dim_h, dim_i,
                        ang1, ang2, ang3, ang4, radio,
                        origen, import_id, lote_id, estado, fecha_carga, editado_por, editado_fecha)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s, %s,%s,%s,%s,%s,%s,%s,%s,
                               %s,%s,%s,%s,%s,%s,%s,%s,%s, %s,%s,%s,%s,%s,
                               'manual', NULL, %s, 'borrador', %s, %s, %s)""",
                    (idu, id_proyecto, b.sector, b.piso, b.ciclo, b.eje, b.nombre_plano, b.diam, largo,
                     b.mult, b.cant, cant_total, peso_u, peso_t, b.marca, b.figura, cod_prod,
                     b.dim_a, b.dim_b, b.dim_c, b.dim_d, b.dim_e, b.dim_f, b.dim_g, b.dim_h, b.dim_i,
                     b.ang1, b.ang2, b.ang3, b.ang4, b.radio,
                     lote_id, now, email, now),
                )
                creadas.append(idu)
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
    return {"ok": True, "lote_id": lote_id, "creadas": len(creadas), "id_unicos": creadas}


@router.get("/lotes/{lote_id}")
def ver_lote(lote_id: int, user=Depends(get_current_user)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso(cur, user)
            cur.execute(
                "SELECT id, id_proyecto, estado, creado_por, creado_fecha, terminado_fecha, n_barras "
                "FROM lotes WHERE id = %s", (lote_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="Lote no encontrado.")
            lote = {"id": r[0], "id_proyecto": r[1], "estado": r[2], "creado_por": r[3],
                    "creado_fecha": r[4], "terminado_fecha": r[5], "n_barras": r[6]}
    return {"ok": True, "lote": lote}


@router.get("/diametros-estandar")
def diametros_estandar(user=Depends(get_current_user)):
    """Lista fija de diámetros estándar (5N.12)."""
    return {"diametros": _DIAM_ESTANDAR}
