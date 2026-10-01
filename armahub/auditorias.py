"""
AUDITORÍAS DE CUBICACIÓN — backend (1-oct). Hoy es MAQUETA: sólo lecturas.

QUÉ SE AUDITA. Un ELEMENTO CONSTRUCTIVO —«Muro Eje A P1 Ciclo 1»—, no una barra suelta.
En las barras ese elemento es la clave (sector · piso · ciclo · eje): `sector` dice si es
elevación (ELEV), losa (LCIELO), viga de cielo (VCIELO) o fundación (FUND); `estructura`
el tipo (Muro, Losa, Viga, Columna). El elemento se audita entero, con todas sus barras.

EL FLUJO (definición del usuario, 1-oct): en un formulario se elige obra, quién audita, el
alcance (losa/elevación, pisos, ciclos) y cuántos elementos; las fechas se llenan solas.
El sistema saca la MUESTRA al azar dentro del alcance. Después, en la auditoría, el
auditor ve cada elemento completo y marca si hay desviación y qué encontró. La
corrección NO la hace el auditor en el sistema: se le manda al cubicador una acción.

VOCABULARIO (ISO 19011 / 9001, para que el informe hable el idioma de Calidad):
  alcance · criterio · muestra · hallazgo → conforme | observación | no conformidad
  (menor / mayor) · corrección (arreglar lo encontrado) · acción correctiva (eliminar
  la causa) · verificación. La «rotación» de obras que viene después es el PROGRAMA de
  auditoría, basado en riesgo (las obras con más reclamos primero).

La muestra es REPRODUCIBLE: se ordena por un hash del elemento más una semilla. Con la
misma semilla sale la misma muestra; así, cuando esto deje de ser maqueta, la auditoría
guarda la semilla y no una copia de los elementos.
"""
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from .auth import get_current_user
from .db import get_conn

router = APIRouter()

# Lo que `sector` significa en las barras. Es lo que el formulario ofrece como «tipo».
SECTORES = {"ELEV": "Elevación", "LCIELO": "Losa", "VCIELO": "Viga de cielo", "FUND": "Fundación"}
MUESTRA_POR_DEFECTO = 10
MUESTRA_MAXIMA = 200
# Roles que pueden auditar: cualquiera del área que cubica o de Calidad. La regla de
# INDEPENDENCIA (no auditas lo que tú cubicaste) se aplica elemento a elemento, no acá.
ROLES_AUDITAN = ("admin", "admin_calidad", "cubicador", "jefe_servicio", "miembro", "usc")
# Estados de la auditoría (los usa el front; se congelan acá para que haya UNA lista).
ESTADOS = ("planificada", "en_curso", "cerrada")
# Hallazgos posibles sobre un elemento, en el idioma de la ISO.
HALLAZGOS = ("conforme", "observacion", "nc_menor", "nc_mayor")

_CLAVE = "(sector, piso, ciclo, eje)"


def _lista(valor: Optional[str]):
    return [v for v in (valor or "").split(",") if v.strip()]


@router.get("/auditorias/obras")
def obras(user=Depends(get_current_user)):
    """Las obras que tienen algo que auditar (barras en ArmaHub), con su tamaño y sus
    reclamos abiertos —el dato que después ordena el programa de auditorías—, y la
    gente que puede auditar."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""SELECT b.id_proyecto, COALESCE(p.nombre_proyecto, b.id_proyecto),
                           COUNT(*), COALESCE(SUM(b.peso_total), 0),
                           COUNT(DISTINCT {_CLAVE}),
                           (SELECT COUNT(*) FROM reclamos r
                             WHERE r.id_proyecto = b.id_proyecto
                               AND r.estado NOT IN ('cerrado', 'rechazado')) AS reclamos
                      FROM barras b
                      LEFT JOIN proyectos p ON p.id_proyecto = b.id_proyecto
                     GROUP BY 1, 2 ORDER BY 2""")
            lista = [{"id_proyecto": r[0], "obra": r[1], "barras": r[2], "kg": float(r[3] or 0),
                      "elementos": r[4], "reclamos": r[5]} for r in cur.fetchall()]
            cur.execute(
                """SELECT email, TRIM(COALESCE(nombre,'') || ' ' || COALESCE(apellido,'')), role
                     FROM users WHERE COALESCE(activo, TRUE) AND role = ANY(%s) ORDER BY 2, 1""",
                (list(ROLES_AUDITAN),))
            auditores = [{"email": r[0], "nombre": r[1] or r[0], "role": r[2]} for r in cur.fetchall()]
    return {"obras": lista, "auditores": auditores, "sectores": SECTORES,
            "estados": list(ESTADOS), "hallazgos": list(HALLAZGOS),
            "muestra_por_defecto": MUESTRA_POR_DEFECTO}


@router.get("/auditorias/universo")
def universo(id_proyecto: str, user=Depends(get_current_user)):
    """De qué está hecha una obra, para armar el alcance: tipos (sector), pisos y ciclos
    con cuántos elementos tiene cada uno, y quién cubicó. Todo sale de las barras."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""SELECT sector, COUNT(DISTINCT (piso, ciclo, eje)), COUNT(*), COALESCE(SUM(peso_total),0)
                      FROM barras WHERE id_proyecto = %s GROUP BY 1 ORDER BY 2 DESC""", (id_proyecto,))
            sectores = [{"sector": r[0] or "", "nombre": SECTORES.get(r[0] or "", r[0] or "(sin sector)"),
                         "elementos": r[1], "barras": r[2], "kg": float(r[3] or 0)} for r in cur.fetchall()]
            # Pisos en orden natural (P1, P2, …, P12), no alfabético (P1, P12, P2).
            cur.execute(
                """SELECT piso, COUNT(DISTINCT (sector, ciclo, eje))
                     FROM barras WHERE id_proyecto = %s GROUP BY 1
                    ORDER BY NULLIF(regexp_replace(COALESCE(piso,''), '\\D', '', 'g'), '')::int NULLS LAST, piso""",
                (id_proyecto,))
            pisos = [{"piso": r[0] or "", "elementos": r[1]} for r in cur.fetchall()]
            cur.execute(
                """SELECT ciclo, COUNT(DISTINCT (sector, piso, eje))
                     FROM barras WHERE id_proyecto = %s GROUP BY 1
                    ORDER BY NULLIF(regexp_replace(COALESCE(ciclo,''), '\\D', '', 'g'), '')::int NULLS LAST, ciclo""",
                (id_proyecto,))
            ciclos = [{"ciclo": r[0] or "", "elementos": r[1]} for r in cur.fetchall()]
            cur.execute(
                f"""SELECT COALESCE(creado_por, editado_por, '?'), COUNT(DISTINCT {_CLAVE}), COUNT(*)
                      FROM barras WHERE id_proyecto = %s GROUP BY 1 ORDER BY 2 DESC""", (id_proyecto,))
            cubicadores = [{"email": r[0], "elementos": r[1], "barras": r[2]} for r in cur.fetchall()]
            cur.execute(f"SELECT COUNT(DISTINCT {_CLAVE}) FROM barras WHERE id_proyecto = %s", (id_proyecto,))
            total = cur.fetchone()[0]
    return {"id_proyecto": id_proyecto, "elementos": total, "sectores": sectores,
            "pisos": pisos, "ciclos": ciclos, "cubicadores": cubicadores}


@router.get("/auditorias/muestra")
def muestra(id_proyecto: str, n: int = MUESTRA_POR_DEFECTO, sectores: str = "", pisos: str = "",
            ciclos: str = "", semilla: str = "", user=Depends(get_current_user)):
    """La MUESTRA: `n` elementos al azar dentro del alcance. Reproducible con la semilla.
    Cada elemento viene entero: cuántas barras, cuántos kilos y quién lo cubicó, que es
    lo que después permite exigir independencia (que no audite el mismo que cubicó)."""
    n = max(1, min(int(n or MUESTRA_POR_DEFECTO), MUESTRA_MAXIMA))
    semilla = (semilla or secrets.token_hex(4)).strip()
    where, params = ["id_proyecto = %s"], [id_proyecto]
    for col, valor in (("sector", sectores), ("piso", pisos), ("ciclo", ciclos)):
        lista = _lista(valor)
        if lista:
            where.append(f"COALESCE({col},'') = ANY(%s)")
            params.append(lista)
    cond = " AND ".join(where)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(DISTINCT {_CLAVE}) FROM barras WHERE {cond}", params)
            total = cur.fetchone()[0]
            if not total:
                raise HTTPException(status_code=400, detail="No hay elementos en ese alcance.")
            # El orden es un hash de la clave más la semilla: al azar, pero el MISMO azar
            # cada vez que se pida con la misma semilla.
            cur.execute(
                f"""SELECT sector, piso, ciclo, eje, MAX(INITCAP(estructura)),
                           COUNT(*), COALESCE(SUM(peso_total),0),
                           STRING_AGG(DISTINCT COALESCE(creado_por, editado_por, '?'), ', ')
                      FROM barras WHERE {cond}
                     GROUP BY 1, 2, 3, 4
                     ORDER BY md5(COALESCE(sector,'') || '|' || COALESCE(piso,'') || '|' ||
                                  COALESCE(ciclo,'') || '|' || COALESCE(eje,'') || '|' || %s)
                     LIMIT %s""",
                params + [semilla, n])
            elementos = [
                {"sector": r[0], "tipo": SECTORES.get(r[0] or "", r[0]), "piso": r[1], "ciclo": r[2],
                 "eje": r[3], "estructura": r[4], "barras": r[5], "kg": float(r[6] or 0),
                 "cubicado_por": r[7],
                 "nombre": " · ".join(x for x in (r[4] or SECTORES.get(r[0] or "", ""),
                                                   ("Eje " + r[3]) if r[3] else "", r[1], r[2]) if x)}
                for r in cur.fetchall()]
    return {"semilla": semilla, "n": n, "total_rango": total, "elementos": elementos,
            "kg": sum(e["kg"] for e in elementos), "barras": sum(e["barras"] for e in elementos)}
