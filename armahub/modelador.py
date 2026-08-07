"""
modelador.py — Backend del Modelador 3D (F1 · T1.1).

Router NUEVO para la biblioteca de templates y la traza de instancias:
  POST /templates                    -> guarda un template (composición) en la biblioteca
  GET  /templates?tipo=&obra=        -> lista templates (de esta obra + otras, para reutilizar)
  GET  /templates/{id}               -> un template por id
  POST /elementos/instancia          -> guarda la RECETA instanciada (trazabilidad, opcional)

IMPORTANTE: la INSERCIÓN de las barras generadas NO pasa por aquí — se reusa el
endpoint existente POST /lotes/{id}/barras (lotes.py, extendido en T1.1 con
origen/template_instancia_id). Este router SOLO persiste la definición del
template y la receta instanciada (elementos_template) para trazabilidad.

Tablas: templates_catalogo, elementos_template (migración 104, idempotente).
Permiso de escritura = mismo que crear barras (_puede_editar_barras): miembro de
Cubicaciones o admin. Lectura = cualquier usuario autenticado.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import json

from .db import get_conn, audit
from .auth import get_current_user

router = APIRouter()


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _check_permiso_escritura(cur, user):
    from .barras import _puede_editar_barras
    if not _puede_editar_barras(cur, user):
        raise HTTPException(status_code=403,
                            detail="Solo un miembro del área de Cubicaciones puede guardar templates.")


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------
class TemplateCrear(BaseModel):
    nombre: str
    tipo: str                      # 'viga' | 'muro' | 'columna' (MVP: viga)
    params: dict                   # la RECETA (geometria + componentes)
    obra: Optional[str] = None     # id_proyecto de la obra (agrupa; None = general)


class InstanciaCrear(BaseModel):
    lote_id: Optional[int] = None
    template_id: Optional[int] = None
    params: dict


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/templates")
def crear_template(body: TemplateCrear, user=Depends(get_current_user)):
    """Guarda un template (composición) en la biblioteca. Reutilizable: se lista
    por obra + otras obras (GET /templates)."""
    email = user.get("email", "?")
    nombre = (body.nombre or "").strip()
    tipo = (body.tipo or "").strip().lower()
    if not nombre:
        raise HTTPException(status_code=400, detail="El nombre del template es obligatorio.")
    if not tipo:
        raise HTTPException(status_code=400, detail="El tipo de elemento es obligatorio.")
    if not isinstance(body.params, dict) or not body.params:
        raise HTTPException(status_code=400, detail="El template no tiene parámetros (receta) válidos.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso_escritura(cur, user)
            cur.execute(
                """INSERT INTO templates_catalogo (nombre, tipo, params, obra, creado_por, fecha)
                   VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                (nombre, tipo, json.dumps(body.params), (body.obra or None), email, _now_iso()),
            )
            new_id = cur.fetchone()[0]
    audit(email, "crear_template", f"{nombre} ({tipo}) · obra {body.obra or '(general)'}", "template", str(new_id))
    return {"ok": True, "id": new_id}


@router.get("/templates")
def listar_templates(tipo: Optional[str] = None, obra: Optional[str] = None,
                     user=Depends(get_current_user)):
    """Lista templates. Si se pasa `obra`, prioriza los de ESA obra pero incluye
    también los de otras (reutilización). Filtra por `tipo` si se indica."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            where = []
            params = []
            if tipo:
                where.append("tipo = %s")
                params.append(tipo.strip().lower())
            sql = "SELECT id, nombre, tipo, params, obra, creado_por, fecha FROM templates_catalogo"
            if where:
                sql += " WHERE " + " AND ".join(where)
            # Ordena: los de la obra pedida primero, luego el resto; recientes arriba.
            if obra:
                sql += " ORDER BY (obra = %s) DESC, id DESC"
                params.append(obra)
            else:
                sql += " ORDER BY id DESC"
            cur.execute(sql, tuple(params))
            rows = cur.fetchall()
    templates = []
    for r in rows:
        p = r[3]
        if isinstance(p, str):
            try: p = json.loads(p)
            except Exception: p = {}
        templates.append({"id": r[0], "nombre": r[1], "tipo": r[2], "params": p,
                          "obra": r[4], "creado_por": r[5], "fecha": r[6]})
    return {"ok": True, "templates": templates}


@router.get("/templates/{template_id}")
def ver_template(template_id: int, user=Depends(get_current_user)):
    """Un template por id (para cargar su receta al panel)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, nombre, tipo, params, obra FROM templates_catalogo WHERE id = %s",
                (template_id,))
            r = cur.fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Template no encontrado.")
    p = r[3]
    if isinstance(p, str):
        try: p = json.loads(p)
        except Exception: p = {}
    return {"ok": True, "id": r[0], "nombre": r[1], "tipo": r[2], "params": p, "obra": r[4]}


@router.post("/elementos/instancia")
def crear_instancia(body: InstanciaCrear, user=Depends(get_current_user)):
    """Guarda la RECETA instanciada en elementos_template (trazabilidad). Devuelve
    su id, que puede viajar como template_instancia_id de las barras generadas
    (POST /lotes/{id}/barras). Opcional en el MVP: el flujo funciona sin él."""
    email = user.get("email", "?")
    if not isinstance(body.params, dict) or not body.params:
        raise HTTPException(status_code=400, detail="La instancia no tiene parámetros (receta) válidos.")
    with get_conn() as conn:
        with conn.cursor() as cur:
            _check_permiso_escritura(cur, user)
            cur.execute(
                """INSERT INTO elementos_template (template_id, lote_id, params, creado_por, fecha)
                   VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                (body.template_id, body.lote_id, json.dumps(body.params), email, _now_iso()),
            )
            new_id = cur.fetchone()[0]
    audit(email, "crear_instancia_template", f"lote {body.lote_id} · template {body.template_id}",
          "elemento_template", str(new_id))
    return {"ok": True, "id": new_id}
