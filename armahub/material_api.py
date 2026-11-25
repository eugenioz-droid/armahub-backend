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

from . import material
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


class AjusteBody(BaseModel):
    cantidad: Optional[int] = None
    ubicacion: Optional[str] = None
    nota: Optional[str] = None


class DescarteBody(BaseModel):
    motivo: str = ""


@router.get("/material/barras")
def material_barras(user=Depends(get_current_user)):
    """Todas las barras ingresadas; la pantalla filtra por estado."""
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
        raise HTTPException(status_code=404, detail="Esa barra no existe o ya está descartada.")
    audit(email, "material_descartada", body.motivo[:200], "material_barras", str(barra_id))
    return {"ok": True}
