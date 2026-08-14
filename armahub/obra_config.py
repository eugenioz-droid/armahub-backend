"""6-config — Backend del panel "Configuración de obra" del creador de barras.

La config se guarda POR OBRA (proyecto). Modelo clave: es una PLANTILLA de opciones
(pisos/ciclos que el usuario deja listos para elegir al crear barras), NO una lista
autoritativa que compita con lo derivado de barras. La verdad de "lo que existe" sigue
siendo las barras (SELECT DISTINCT piso/ciclo/eje de la tabla `barras`); la plantilla solo
SUGIERE opciones para el desplegable.

Endpoints:
  GET /proyectos/{id}/config             -> config guardada + derivados de barras
  PUT /proyectos/{id}/config             -> guarda plantilla + factores (+ factor_peso)
  GET /proyectos/{id}/pisos-combinados   -> lista FINAL de pisos (plantilla ∪ existentes),
                                            ordenada, marcando cuáles tienen barras

Reglas:
- LEER: basta estar autenticado (get_current_user).
- ESCRIBIR: permiso de editar la obra (_puede_editar_proyecto de barras.py) — el mismo
  guard del PATCH /proyectos. NO es el permiso de editar barras del Bar Manager.
- factor_peso NO vive en obra_config: ya está en proyectos (migración 089). Este panel lo
  lee/escribe allá para que sea una sola fuente de verdad.
- Este backend NO edita/renombra ejes (eso va en Bar Manager). Aquí los ejes existentes se
  exponen SOLO como derivado de lectura.
- Orden de pisos (CRÍTICO): subterráneos (S2,S1..) primero (el más profundo primero) →
  P1..Pn ascendente → SM/salas de máquina al final. Se reusa el mismo criterio que el front
  (pisoOrder en static/js/features/cubicacion/index.js) y el backend (_piso_order de barras.py).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import json

from .db import get_conn, audit
from .auth import get_current_user

router = APIRouter()

# Defaults del creador de barras (× diámetro para el extremo; cm para el intermedio).
DEFAULT_FACTOR_EXTREMO = 10.0
DEFAULT_LARGO_INTERMEDIO = 100.0
# Piso por defecto para una obra LIMPIA (sin barras y sin plantilla): S2,S1,P1..P10,SM.
DEFAULT_PISOS = ["S2", "S1"] + [f"P{i}" for i in range(1, 11)] + ["SM"]


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _piso_order(p: str) -> int:
    """Orden de pisos: FUND (fundación) SIEMPRE al fondo → subterráneos (el más profundo
    primero, S2<S1) → P1..Pn ascendente → SM/PM (sala de máquinas / techumbre) SIEMPRE
    arriba. Idéntico a _piso_order de barras.py (fuente única de criterio)."""
    import re
    up = (p or "").upper().strip()
    if up in ("FUND", "FUNDACION", "FUNDACIÓN"):
        return -1000000       # fundación: bajo todo, siempre
    if up in ("SM", "PM", "SALA DE MAQUINAS"):
        return 9999           # sala de máquinas/techumbre: sobre todo, siempre
    m = re.match(r"^S(\d+)", up)
    if m:
        return -int(m.group(1))
    m = re.match(r"^P(\d+)", up)
    if m:
        return int(m.group(1))
    m = re.search(r"(\d+)", up)
    if m:
        return int(m.group(1))
    return 0


def _proyecto_existe(cur, id_proyecto: str) -> bool:
    cur.execute("SELECT 1 FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
    return cur.fetchone() is not None


def _check_permiso_editar(cur, id_proyecto: str, user: dict):
    """ESCRIBIR la config de la obra (pisos, ciclos, factores).

    DOS CAMINOS, unidos (fix 14-ago): quien puede editar la OBRA (admin o
    asignado a ESE proyecto en proyecto_usuarios) O quien CUBICA — un miembro
    del área 'cubicaciones', que es exactamente el rol que agrega los pisos y
    ciclos con los que después despieza.
    Por qué: el guard era sólo el primero, así que un cubicador que trabajaba la
    obra sin estar en proyecto_usuarios recibía 403 al agregar un piso — no podía
    hacer su trabajo. Es la MISMA función que ya lo habilita a editar barras en
    el Bar Manager (_puede_editar_barras), no un criterio nuevo."""
    from .barras import _puede_editar_proyecto, _puede_editar_barras
    if _puede_editar_proyecto(cur, id_proyecto, user):
        return
    if _puede_editar_barras(cur, user):
        return
    raise HTTPException(status_code=403, detail="No tienes permiso para configurar esta obra.")


def _factor_peso(cur, id_proyecto: str) -> float:
    """Factor de peso de la obra (%). Vive en proyectos (migración 089). Default 0."""
    cur.execute("SELECT factor_peso FROM proyectos WHERE id_proyecto = %s", (id_proyecto,))
    r = cur.fetchone()
    return float(r[0]) if (r and r[0] is not None) else 0.0


def _leer_config(cur, id_proyecto: str) -> dict:
    """Lee la fila de obra_config; si no existe, devuelve los defaults del creador.
    JSONB se lee como lista Python (psycopg3)."""
    cur.execute(
        """SELECT pisos_plantilla, ciclos_plantilla, factor_extremo, largo_intermedio
           FROM obra_config WHERE id_proyecto = %s""",
        (id_proyecto,),
    )
    r = cur.fetchone()
    if not r:
        return {
            "pisos_plantilla": [],
            "ciclos_plantilla": [],
            "factor_extremo": DEFAULT_FACTOR_EXTREMO,
            "largo_intermedio": DEFAULT_LARGO_INTERMEDIO,
        }
    return {
        "pisos_plantilla": list(r[0] or []),
        "ciclos_plantilla": list(r[1] or []),
        "factor_extremo": float(r[2]) if r[2] is not None else DEFAULT_FACTOR_EXTREMO,
        "largo_intermedio": float(r[3]) if r[3] is not None else DEFAULT_LARGO_INTERMEDIO,
    }


def _distinct_barras(cur, id_proyecto: str, campo: str) -> List[str]:
    """SELECT DISTINCT de un campo de ubicación (piso/ciclo/eje) de las barras de la obra.
    Excluye NULL y ''. Todo lo que sale de aquí TIENE barras por definición. `campo` es una
    whitelist fija (no viene del usuario) → no hay inyección."""
    assert campo in ("piso", "ciclo", "eje")
    from .barras import _sql_excluir_borrador
    cur.execute(
        f"SELECT DISTINCT {campo} FROM barras "
        f"WHERE id_proyecto = %s AND {campo} IS NOT NULL AND {campo} <> ''"
        + _sql_excluir_borrador(),
        (id_proyecto,),
    )
    return [row[0] for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------
class ConfigUpdate(BaseModel):
    pisos_plantilla: List[str] = []
    ciclos_plantilla: List[str] = []
    factor_extremo: float = DEFAULT_FACTOR_EXTREMO
    largo_intermedio: float = DEFAULT_LARGO_INTERMEDIO
    factor_peso: float = 0.0            # se guarda en proyectos (no en obra_config)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/proyectos/{id_proyecto}/config")
def get_config(id_proyecto: str, user=Depends(get_current_user)):
    """Config guardada (plantilla + factores) MÁS los derivados de barras (existentes).

    pisos_existentes / ciclos_existentes / ejes_existentes salen de SELECT DISTINCT sobre
    `barras`: todo lo que aparece TIENE barras (tiene_barras=True → no borrable). La plantilla
    puede tener pisos aún sin barras (tiene_barras=False)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not _proyecto_existe(cur, id_proyecto):
                raise HTTPException(status_code=404, detail="Obra no encontrada.")
            cfg = _leer_config(cur, id_proyecto)
            pisos_ex = _distinct_barras(cur, id_proyecto, "piso")
            ciclos_ex = _distinct_barras(cur, id_proyecto, "ciclo")
            ejes_ex = _distinct_barras(cur, id_proyecto, "eje")
            factor_peso = _factor_peso(cur, id_proyecto)

    return {
        "id_proyecto": id_proyecto,
        "pisos_plantilla": cfg["pisos_plantilla"],
        # Cada existente TIENE barras por definición (viene del DISTINCT) → no borrable.
        "pisos_existentes": [{"valor": v, "tiene_barras": True} for v in sorted(pisos_ex, key=_piso_order)],
        "ciclos_plantilla": cfg["ciclos_plantilla"],
        "ciclos_existentes": [{"valor": v, "tiene_barras": True} for v in sorted(ciclos_ex)],
        "ejes_existentes": [{"valor": v, "tiene_barras": True} for v in sorted(ejes_ex)],
        "factor_peso": factor_peso,
        "factor_extremo": cfg["factor_extremo"],
        "largo_intermedio": cfg["largo_intermedio"],
    }


@router.put("/proyectos/{id_proyecto}/config")
def put_config(id_proyecto: str, body: ConfigUpdate, user=Depends(get_current_user)):
    """Guarda la plantilla y los factores del creador (UPSERT en obra_config) y el
    factor_peso de la obra (UPDATE proyectos). Requiere permiso de editar la obra."""
    email = user.get("email", "?")
    # Normaliza plantilla: strings no vacíos, sin duplicados, PRESERVANDO el orden del usuario.
    def _limpiar(items):
        vistos = set()
        out = []
        for x in (items or []):
            s = str(x).strip()
            if s and s not in vistos:
                vistos.add(s)
                out.append(s)
        return out

    pisos = _limpiar(body.pisos_plantilla)
    ciclos = _limpiar(body.ciclos_plantilla)

    with get_conn() as conn:
        with conn.cursor() as cur:
            if not _proyecto_existe(cur, id_proyecto):
                raise HTTPException(status_code=404, detail="Obra no encontrada.")
            _check_permiso_editar(cur, id_proyecto, user)

            cur.execute(
                """INSERT INTO obra_config
                       (id_proyecto, pisos_plantilla, ciclos_plantilla,
                        factor_extremo, largo_intermedio, actualizado_por, actualizado_fecha)
                   VALUES (%s, %s::jsonb, %s::jsonb, %s, %s, %s, %s)
                   ON CONFLICT (id_proyecto) DO UPDATE SET
                       pisos_plantilla   = EXCLUDED.pisos_plantilla,
                       ciclos_plantilla  = EXCLUDED.ciclos_plantilla,
                       factor_extremo    = EXCLUDED.factor_extremo,
                       largo_intermedio  = EXCLUDED.largo_intermedio,
                       actualizado_por   = EXCLUDED.actualizado_por,
                       actualizado_fecha = EXCLUDED.actualizado_fecha""",
                (
                    id_proyecto,
                    json.dumps(pisos),
                    json.dumps(ciclos),
                    body.factor_extremo,
                    body.largo_intermedio,
                    email,
                    _now_iso(),
                ),
            )
            # factor_peso vive en proyectos (única fuente de verdad; lo lee lotes.py).
            cur.execute(
                "UPDATE proyectos SET factor_peso = %s WHERE id_proyecto = %s",
                (body.factor_peso, id_proyecto),
            )
    audit(email, "guardar_config_obra", f"obra {id_proyecto}", "obra_config", id_proyecto)
    return {
        "ok": True,
        "id_proyecto": id_proyecto,
        "pisos_plantilla": pisos,
        "ciclos_plantilla": ciclos,
        "factor_extremo": body.factor_extremo,
        "largo_intermedio": body.largo_intermedio,
        "factor_peso": body.factor_peso,
    }


@router.get("/proyectos/{id_proyecto}/pisos-combinados")
def get_pisos_combinados(id_proyecto: str, user=Depends(get_current_user)):
    """Lista FINAL de pisos para el desplegable de la grilla = plantilla ∪ existentes,
    ordenada (subterráneos primero, luego P1..Pn, salas al final) y marcando cuáles tienen
    barras (tiene_barras=True → no borrable). Si la obra está LIMPIA (sin barras y sin
    plantilla), devuelve el DEFAULT S2,S1,P1..P10,SM."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not _proyecto_existe(cur, id_proyecto):
                raise HTTPException(status_code=404, detail="Obra no encontrada.")
            cfg = _leer_config(cur, id_proyecto)
            pisos_plantilla = cfg["pisos_plantilla"]
            pisos_existentes = _distinct_barras(cur, id_proyecto, "piso")

    con_barras = {p for p in pisos_existentes}

    # Obra limpia (sin barras y sin plantilla): default sugerido; ninguno tiene barras aún.
    if not con_barras and not pisos_plantilla:
        base = DEFAULT_PISOS
    else:
        # Unión preservando: plantilla (orden del usuario) + existentes que no estén ya.
        base = list(pisos_plantilla)
        for p in pisos_existentes:
            if p not in base:
                base.append(p)

    pisos_ordenados = sorted(base, key=_piso_order)
    return {
        "id_proyecto": id_proyecto,
        "pisos": [{"valor": p, "tiene_barras": p in con_barras} for p in pisos_ordenados],
    }
