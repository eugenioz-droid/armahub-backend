# -*- coding: utf-8 -*-
"""
MATERIAL DISPONIBLE (25-nov) — las rutas de la caluga (SPECS §15). La lógica vive en
material.py; acá sólo el permiso, la conexión y el registro en audit_log.

Entran administración y las áreas de material.AREAS. Un usuario fuera de esas áreas recibe
403 aunque conozca la ruta: la caluga ni siquiera le aparece (registry.js, `areas`).
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import material, material_asignar
from .asa import AsaError
from .auth import get_current_user
from .db import audit, get_conn

router = APIRouter(tags=["material"])


def _exigir(cur, user):
    if not material.puede(cur, user):
        raise HTTPException(status_code=403, detail="Tu área no tiene acceso a Material disponible.")


def _hacer(user, funcion, *args):
    """Abre la conexión, revisa el permiso y traduce lo que el usuario puede corregir (400) y
    lo que aSa no contestó (502)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            _exigir(cur, user)
            try:
                return funcion(cur, *args)
            except material.ErrorMaterial as e:
                raise HTTPException(status_code=400, detail=str(e))
            except AsaError as e:
                raise HTTPException(status_code=502, detail="aSa no respondió: %s" % e)


class IngresoBody(BaseModel):
    origen: str
    # Desde aSa
    item_key: Optional[int] = None
    motivo: Optional[str] = None
    # A mano
    figura: Optional[str] = None
    lados: dict = {}
    radios: dict = {}
    diam: Optional[float] = None
    grado: Optional[str] = None
    # Las dos
    cantidad: Optional[int] = None
    ubicacion: Optional[str] = None
    nota: Optional[str] = None


class LoteBody(BaseModel):
    cc: str
    items: list = []          # [{item_key, cantidad}]
    motivo: Optional[str] = None
    ubicacion: Optional[str] = None
    nota: Optional[str] = None


class AjusteBody(BaseModel):
    cantidad: Optional[int] = None
    ubicacion: Optional[str] = None
    nota: Optional[str] = None


class DescarteBody(BaseModel):
    motivo: str = ""


class AsignarBody(BaseModel):
    items: list = []          # [{item_key, cantidad (barras), marca, cc}]


class ProducidaBody(BaseModel):
    producida: bool = True


@router.get("/material/barras")
def material_barras(user=Depends(get_current_user)):
    """Las barras disponibles (las consumidas están en el Resumen)."""
    return {"barras": _hacer(user, material.listar),
            "motivos": material.MOTIVOS, "grados": material.GRADOS,
            "diametros": list(material.DIAMETROS)}


@router.get("/material/cc/{cc}/items")
def material_items_de_cc(cc: str, user=Depends(get_current_user)):
    """Las barras de un código de control, para elegir cuál queda disponible."""
    return {"items": _hacer(user, material.items_de_cc, cc)}


@router.get("/material/figuras")
def material_figuras(user=Depends(get_current_user)):
    """Las figuras que se usan en aSa, para el ingreso a mano."""
    return {"figuras": _hacer(user, material.figuras_para_pantalla)}


@router.post("/material/previa")
def material_previa(body: IngresoBody, user=Depends(get_current_user)):
    """El dibujo, el largo y el peso de una barra a mano mientras se escribe."""
    return _hacer(user, material.previa, dict(body))


@router.post("/material/barras")
def material_crear(body: IngresoBody, user=Depends(get_current_user)):
    email = user.get("email", "")
    barra_id = _hacer(user, material.crear, email, dict(body))
    audit(email, "material_ingresada", "%s · %s" % (body.origen, body.motivo or "inventario"),
          "material_barras", str(barra_id))
    return {"id": barra_id}


@router.post("/material/barras/{barra_id}/ajustar")
def material_ajustar(barra_id: int, body: AjusteBody, user=Depends(get_current_user)):
    email = user.get("email", "")
    if not _hacer(user, material.ajustar, barra_id, email, dict(body)):
        raise HTTPException(status_code=404, detail="Esa barra no existe o ya está descartada.")
    audit(email, "material_ajustada", str(dict(body)), "material_barras", str(barra_id))
    return {"ok": True}


@router.post("/material/barras/{barra_id}/descartar")
def material_descartar(barra_id: int, body: DescarteBody, user=Depends(get_current_user)):
    email = user.get("email", "")
    if not _hacer(user, material.descartar, barra_id, email, body.motivo):
        raise HTTPException(status_code=404, detail="Esa barra no existe o ya está dada de baja.")
    audit(email, "material_descartada", body.motivo[:200], "material_barras", str(barra_id))
    return {"ok": True}


# ---------------------------------------------------------------------------
# LA VENTANA DE LA BARRA (fase 3): buscar en el momento, asignar, confirmar
# ---------------------------------------------------------------------------
@router.get("/material/barras/{barra_id}")
def material_barra(barra_id: int, user=Depends(get_current_user)):
    """La barra y lo que ya se le asignó."""
    return _hacer(user, material_asignar.detalle, barra_id)


@router.post("/material/barras/{barra_id}/coincidencias")
def material_coincidencias(barra_id: int, user=Depends(get_current_user)):
    """«Buscar coincidencias»: aSa en el momento (unos segundos)."""
    return _hacer(user, material_asignar.coincidencias, barra_id)


@router.post("/material/barras/{barra_id}/asignar")
def material_asignar_items(barra_id: int, body: AsignarBody, user=Depends(get_current_user)):
    email = user.get("email", "")
    r = _hacer(user, material_asignar.asignar, barra_id, email, body.items)
    audit(email, "material_asignada", "; ".join("%s %s x%s" % (p.get("cc"), p.get("marca"), p.get("cantidad"))
                                                for p in body.items)[:500], "material_barras", str(barra_id))
    return r


@router.post("/material/asignaciones/{asignacion_id}/quitar")
def material_quitar(asignacion_id: int, user=Depends(get_current_user)):
    r = _hacer(user, material_asignar.quitar, asignacion_id)
    audit(user.get("email", ""), "material_asignacion_quitada", "", "material_asignaciones", str(asignacion_id))
    return r


@router.post("/material/asignaciones/{asignacion_id}/producida")
def material_producida(asignacion_id: int, body: ProducidaBody, user=Depends(get_current_user)):
    email = user.get("email", "")
    r = _hacer(user, material_asignar.producida, asignacion_id, email, body.producida)
    audit(email, "material_producida" if body.producida else "material_producida_deshecha", "",
          "material_asignaciones", str(asignacion_id))
    return r


@router.get("/material/resumen")
def material_resumen(user=Depends(get_current_user)):
    """Lo reutilizado: lo que producción confirmó."""
    return _hacer(user, material_asignar.resumen)


# ---------------------------------------------------------------------------
# INGRESAR DESDE aSa, POR PASOS (25-nov): obra → CC → ítems (varios) → datos
# ---------------------------------------------------------------------------
@router.get("/material/obras")
def material_obras(user=Depends(get_current_user)):
    """Las obras de aSa, para el campo desplegable."""
    return {"obras": _hacer(user, material.obras)}


@router.get("/material/obras/{job}/ccs")
def material_ccs_de_obra(job: str, user=Depends(get_current_user)):
    """Los códigos de una obra, del espejo de aSa."""
    return {"ccs": _hacer(user, material.ccs_de_obra, job)}


@router.post("/material/barras/lote")
def material_crear_lote(body: LoteBody, user=Depends(get_current_user)):
    """Varios ítems de un CC de una vez."""
    email = user.get("email", "")
    ids = _hacer(user, material.crear_lote, email, dict(body))
    audit(email, "material_ingresadas", "%s · %d ítem(s) · %s" % (body.cc, len(ids), body.motivo or ""),
          "material_barras", ",".join(str(i) for i in ids))
    return {"ids": ids}
