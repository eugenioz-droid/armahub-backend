"""
CONTROL AUDITORÍAS (4-nov). El tablero de las tres fuentes de calidad de cubicación
—revisión de barras, revisión de elementos y auditorías— para el sub-tab del mismo nombre
en Dashboards de Reclamos. El usuario: «ahí deberíamos controlar estas revisiones de
barras, las auditorías y las revisiones de elementos».

TRES PREGUNTAS, LAS MISMAS PARA LAS TRES FUENTES, y por eso las tres vuelven con la misma
forma y la pantalla tiene un solo dibujante:

  1. ¿Se cierra lo que sale? — por DÍA de detección y por cubicador: detectadas, y de
     ésas cuántas no aplican, cuántas se resolvieron y cuántas siguen sin resolver HOY. El
     día es el de detección y el estado es el de ahora: así la barra roja que crece es la
     alarma. Va por cubicador para que la pantalla filtre sin volver a preguntar (4-nov:
     «un filtro con botones por cubicador»).
  2. ¿Dónde está el problema? — cubicador × regla (o causa, en auditorías). Una columna
     encendida para todos es una regla mal calibrada, no una persona.
  3. ¿Cuánto se tarda en cerrar? — mediana de días entre detección y cierre, por cubicador
     y total. Mide la reacción, que es lo que vale de una revisión automática.

QUÉ ES «RESUELTA» EN CADA FUENTE. En las revisiones, lo mismo que en la hoja: aSa lo
confirmó, o se cerró bajo la firma de quien lo decidió («cerrar igual»); «no aplica» cierra
pero no resuelve. En auditorías, «detectada» es el elemento con observación o hallazgo, «no
aplica» son las observaciones (no abren acción), y «resuelta» es el hallazgo con la acción
corregida o verificada.

NO HAY RANKING NI PORCENTAJES SIN DENOMINADOR: el usuario ya los sacó una vez («no se
entiende sobre qué se están tomando los porcentajes»). Los números van con su base.
"""
from datetime import date

from fastapi import APIRouter, Depends

from .auth import require_admin_or_admin_calidad
from .chequeos import REGLAS
from .chequeos_elementos import REGLAS_ELEMENTO
from .db import get_conn

router = APIRouter(tags=["control-auditorias"])

# Una señal CERRADA, igual que la lee la hoja (revision.js::_cerrada).
SQL_SENAL_CERRADA = ("(s.estado IN ('aceptada', 'corregida')"
                     " OR (s.estado IN ('declarada', 'corregir') AND s.cierre_confirmado_el IS NOT NULL))")
# Una señal RESUELTA: cerrada y no «no aplica».
SQL_SENAL_RESUELTA = ("(s.estado = 'corregida'"
                      " OR (s.estado IN ('declarada', 'corregir') AND s.cierre_confirmado_el IS NOT NULL))")
# Cuándo se cerró. La que no aplica, cuando se decidió; la confirmada, cuando pasó el cierre.
SQL_SENAL_CIERRE = ("CASE WHEN s.estado = 'aceptada' THEN s.resuelto_el"
                    " ELSE COALESCE(s.cierre_confirmado_el, s.resuelto_el, s.visto_ultimo) END")
SQL_CUB_SENAL = "COALESCE(NULLIF(TRIM(s.cubico), ''), '(sin dato)')"
SQL_CUB_AUD = "COALESCE(NULLIF(TRIM(e.cubicado_por), ''), '(sin dato)')"
SQL_DIAS = "EXTRACT(EPOCH FROM (%s - %s)) / 86400.0"


def _dias(filas):
    """Las filas (día, cubicador, detectadas, no_aplica, resueltas) → dicts con «abiertas» = el resto."""
    out = []
    for dia, cub, n, nap, res in filas:
        n, nap, res = int(n or 0), int(nap or 0), int(res or 0)
        out.append({"dia": dia, "cub": cub, "detectadas": n, "no_aplica": nap, "resueltas": res,
                    "abiertas": max(0, n - nap - res)})
    return out


def _cierre(filas):
    return [{"cub": c, "n": int(n or 0), "mediana": round(float(m), 1) if m is not None else None}
            for c, n, m in filas]


def _fuente_senales(cur, nivel: str, desde: date, reglas) -> dict:
    cur.execute(
        f"""SELECT TO_CHAR(s.visto_primero, 'YYYY-MM-DD'), {SQL_CUB_SENAL},
                   COUNT(*),
                   COUNT(*) FILTER (WHERE s.estado = 'aceptada'),
                   COUNT(*) FILTER (WHERE {SQL_SENAL_RESUELTA})
              FROM chequeo_senales s
             WHERE s.nivel = %s AND s.visto_primero >= %s
             GROUP BY 1, 2 ORDER BY 1, 2""", (nivel, desde))
    dias = _dias(cur.fetchall())
    cur.execute(
        f"""SELECT {SQL_CUB_SENAL}, s.regla, COUNT(*)
              FROM chequeo_senales s
             WHERE s.nivel = %s AND s.visto_primero >= %s
             GROUP BY 1, 2""", (nivel, desde))
    calor = [{"cub": c, "col": r, "n": int(n)} for c, r, n in cur.fetchall()]
    expr_dias = SQL_DIAS % (SQL_SENAL_CIERRE, "s.visto_primero")
    base = (f"FROM chequeo_senales s WHERE s.nivel = %s AND s.visto_primero >= %s"
            f" AND {SQL_SENAL_CERRADA} AND ({SQL_SENAL_CIERRE}) IS NOT NULL")
    cur.execute(f"""SELECT {SQL_CUB_SENAL}, COUNT(*),
                           percentile_cont(0.5) WITHIN GROUP (ORDER BY {expr_dias})
                      {base} GROUP BY 1""", (nivel, desde))
    cierre = _cierre(cur.fetchall())
    cur.execute(f"""SELECT 'total', COUNT(*),
                           percentile_cont(0.5) WITHIN GROUP (ORDER BY {expr_dias}) {base}""", (nivel, desde))
    total = _cierre(cur.fetchall())
    return {"dias": dias, "calor": calor, "cierre": cierre,
            "cierre_total": total[0] if total else {"cub": "total", "n": 0, "mediana": None},
            "columnas": {r["codigo"]: r.get("corto") or r["nombre"] for r in reglas}}


def _fuente_auditorias(cur, desde: date) -> dict:
    cur.execute(
        f"""SELECT TO_CHAR(a.creada_fecha, 'YYYY-MM-DD'), {SQL_CUB_AUD},
                   COUNT(*) FILTER (WHERE e.hallazgo IN ('observacion', 'hallazgo')),
                   COUNT(*) FILTER (WHERE e.hallazgo = 'observacion'),
                   COUNT(*) FILTER (WHERE e.hallazgo = 'hallazgo'
                                      AND e.accion_estado IN ('corregida', 'verificada'))
              FROM auditoria_elementos e JOIN auditorias a ON a.id = e.auditoria_id
             WHERE e.hallazgo IS NOT NULL AND a.creada_fecha >= %s
             GROUP BY 1, 2 ORDER BY 1, 2""", (desde,))
    dias = _dias(cur.fetchall())
    # LA CAUSA VIVE EN LA BARRA (8-oct), como en el Pareto de indicadores: la clasifica
    # quien responde. «(sin clasificar)» se cuenta y no se esconde.
    cur.execute(
        f"""SELECT {SQL_CUB_AUD}, COALESCE(NULLIF(TRIM(i.causa), ''), '(sin clasificar)'), COUNT(*)
              FROM auditoria_items i
              JOIN auditoria_elementos e ON e.id = i.elemento_id
              JOIN auditorias a ON a.id = e.auditoria_id
             WHERE a.creada_fecha >= %s AND i.conforme IS FALSE AND e.hallazgo = 'hallazgo'
             GROUP BY 1, 2""", (desde,))
    calor = [{"cub": c, "col": r, "n": int(n)} for c, r, n in cur.fetchall()]
    expr_dias = SQL_DIAS % ("e.accion_el", "e.revisado_el")
    base = ("FROM auditoria_elementos e JOIN auditorias a ON a.id = e.auditoria_id"
            " WHERE a.creada_fecha >= %s AND e.hallazgo = 'hallazgo'"
            " AND e.accion_estado IN ('corregida', 'verificada')"
            " AND e.accion_el IS NOT NULL AND e.revisado_el IS NOT NULL")
    cur.execute(f"""SELECT {SQL_CUB_AUD}, COUNT(*),
                           percentile_cont(0.5) WITHIN GROUP (ORDER BY {expr_dias})
                      {base} GROUP BY 1""", (desde,))
    cierre = _cierre(cur.fetchall())
    cur.execute(f"""SELECT 'total', COUNT(*),
                           percentile_cont(0.5) WITHIN GROUP (ORDER BY {expr_dias}) {base}""", (desde,))
    total = _cierre(cur.fetchall())
    return {"dias": dias, "calor": calor, "cierre": cierre,
            "cierre_total": total[0] if total else {"cub": "total", "n": 0, "mediana": None},
            "columnas": {}}


@router.get("/control-auditorias")
def control_auditorias(desde: str = "", user=Depends(require_admin_or_admin_calidad)):
    """Las tres fuentes, con la misma forma. `desde` (YYYY-MM-DD) acota la detección; por
    defecto el año en curso, que es desde cuando hay revisiones automáticas."""
    try:
        d0 = date.fromisoformat(desde) if desde else date(date.today().year, 1, 1)
    except ValueError:
        d0 = date(date.today().year, 1, 1)
    with get_conn() as conn:
        with conn.cursor() as cur:
            barras = _fuente_senales(cur, "barra", d0, REGLAS)
            elementos = _fuente_senales(cur, "elemento", d0, REGLAS_ELEMENTO)
            auditorias = _fuente_auditorias(cur, d0)
    barras.update({"titulo": "Revisión de barras", "unidad": "barras", "columna": "regla",
                   "series": {"no_aplica": "No aplica", "resueltas": "Resueltas", "abiertas": "Sin resolver"}})
    elementos.update({"titulo": "Revisión de elementos", "unidad": "hallazgos", "columna": "regla",
                      "series": {"no_aplica": "No aplica", "resueltas": "Resueltas", "abiertas": "Sin resolver"}})
    auditorias.update({"titulo": "Auditorías", "unidad": "elementos con hallazgo u observación", "columna": "causa",
                       "series": {"no_aplica": "Observaciones", "resueltas": "Corregidas", "abiertas": "Pendientes"}})
    return {"desde": d0.isoformat(),
            "fuentes": {"barras": barras, "elementos": elementos, "auditorias": auditorias}}
