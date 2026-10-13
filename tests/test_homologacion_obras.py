"""HOMOLOGACIÓN DE OBRAS: una obra, la de aSa (13-oct).

Lo que se congela: las 37 obras legacy están enlazadas a su job de aSa (menos «Obra de
Prueba», a propósito); varias obras pueden ser un job (San Pablo); las obras nuevas entran
SÓLO por «adoptar» y nunca a mano; lo que se ve es el nombre y el código de aSa; un reclamo
puede colgar de cualquier obra del espejo; el job del reclamo lo manda su obra (trigger);
y las obras de prueba de aSa no suman kilos ni aparecen en ningún selector.

Necesita la base. Correr con: python tests/test_homologacion_obras.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
try:
    from asa_ping import cargar_env
    cargar_env()
except Exception:
    pass
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")
os.environ.setdefault("CORS_ORIGINS", "http://localhost")

fallos = 0


def check(nombre, cond, detalle=""):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -- " + str(detalle)[:160]) if not cond else ""))
    if not cond:
        fallos += 1


def _leer(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


PR = _leer("armahub", "programacion.py")
BA = _leer("armahub", "barras.py")
RE = _leer("armahub", "reclamos.py")
AU = _leer("armahub", "auditorias.py")
CH = _leer("armahub", "chequeos_api.py")
M143 = _leer("armahub", "migrations", "143_homologar_obras_asa.sql")
M144 = _leer("armahub", "migrations", "144_reclamo_job_desde_obra.sql")
OBJS = _leer("armahub", "static", "js", "features", "cubicacion", "obras.js")
OBHT = _leer("armahub", "templates", "tabs", "obras.html")
FORM = _leer("armahub", "static", "js", "features", "reclamos", "form.js")
RCHT = _leer("armahub", "templates", "tabs", "reclamos.html")

print("TEST: homologación de obras")

print("\n1. Una sola puerta de entrada: adoptar desde el espejo")
check("existe `adoptar_obra` como función, no sólo como endpoint", "def adoptar_obra(" in PR)
check("...y la usan el endpoint, el reclamo al crear y el reclamo al editar",
      PR.count("adoptar_obra(cur,") >= 1 and RE.count("adoptar_obra(cur, body.asa_job_id, email)") == 2)
check("es idempotente: un job ya enlazado devuelve su obra, no crea otra",
      "WHERE asa_job_id = %s OR id_proyecto = %s" in PR)
check("una obra no válida de aSa no se trae", "marcada como no válida en aSa" in PR)
check("crear una obra a mano se cerró (410, con la razón)",
      "status_code=410" in BA and "se traen desde aSa" in BA)
check("...y el front ya no ofrece crear: ni en Cubicaciones ni en Reclamos",
      "Crear obra manualmente" not in OBHT and "Traer una obra desde aSa" in OBHT
      and "crearProyectoDesdeReclamo" not in FORM and "toggleNuevoProyectoRec()" not in RCHT)

print("\n2. Varias obras de ArmaHub pueden ser un job (los frentes de San Pablo)")
check("el índice único sobre asa_job_id se fue", "DROP INDEX IF EXISTS ux_proyectos_asa_job" in M143)
check("y enlazar no exige que el job esté libre", "ENLAZAR no exige que el job esté libre" in PR)

print("\n3. Existir como obra no es aparecer en Cubicaciones")
check("hay una marca `en_cubicacion`, y Cubicaciones filtra por ella",
      "en_cubicacion BOOLEAN" in M143 and "cubicacion: int = 0" in BA and "AND p.en_cubicacion" in BA
      and "/proyectos?cubicacion=1" in OBJS)
check("...se enciende al traer la obra desde esa caluga", "en_cubicacion: true" in OBJS)

print("\n4. Lo que se ve es lo de aSa")
check("/proyectos: código = job, nombre = espejo, y el de ArmaHub queda aparte",
      '"codigo": r[17] or r[0]' in BA and '"nombre_proyecto": r[18] or r[1]' in BA and '"nombre_armahub": r[1]' in BA)
check("la lista de reclamos prefiere el nombre del espejo",
      "COALESCE(ao.nombre, p.nombre_proyecto, r.id_proyecto, 'Obra eliminada')" in RE)
check("...y los dashboards de reclamos también", RE.count("COALESCE(ao.nombre, p.nombre_proyecto") >= 4)
check("el selector de auditorías trae el código de aSa", '"codigo": r[6] or r[0]' in AU)
check("Cubicaciones muestra el job al lado del nombre", 'title="Job en aSa"' in OBJS)

print("\n5. Un reclamo puede ser sobre cualquier obra de aSa")
check("los cuerpos aceptan el job", RE.count("asa_job_id: Optional[str] = None") == 2)
check("el selector se llena del espejo, no de Cubicaciones",
      "function loadObrasReclamo(" in FORM and "/programacion/asa/espejo" in FORM
      and "const rpf = document.getElementById('recProyecto')" not in OBJS)
check("...con «asa:<job>» para las que todavía no están en ArmaHub",
      "'asa:' + o.asa_job_id" in FORM and "body.asa_job_id = proyecto.slice(4)" in FORM)
check("el espejo no ofrece ni las excluidas ni los gemelos «- BARRAS»",
      "WHERE NOT a.excluida" in PR and "a.asa_job_id !~ 'B$'" in PR)

print("\n6. El job del reclamo lo manda su obra, en la base")
check("hay un trigger BEFORE INSERT OR UPDATE OF id_proyecto",
      "trg_reclamo_job_desde_obra" in M144 and "BEFORE INSERT OR UPDATE OF id_proyecto" in M144)

print("\n7. Las obras de prueba de aSa no suman kilos ni aparecen")
check("la verdad es una marca en el espejo (`asa_obras.excluida`), no una lista en el código",
      "excluida BOOLEAN" in M143)
check("...y entra en TODOS los sitios que filtraban por nombre (22)",
      sum(s.count("asa_job_id NOT IN (SELECT asa_job_id FROM asa_obras WHERE excluida)")
          for s in (PR, AU, CH, RE)) == 22)
check("TERRATEST no está excluida: contiene «test» pero es un cliente", "TERRATEST" not in M143.split("UPDATE asa_obras SET excluida")[1].split(";")[0])

print("\n8. Contra la base")
from armahub.db import get_conn  # noqa: E402
with get_conn() as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*), COUNT(asa_job_id) FROM proyectos")
        total, enlazadas = cur.fetchone()
        cur.execute("SELECT nombre_proyecto FROM proyectos WHERE asa_job_id IS NULL")
        sin = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT COUNT(*) FROM proyectos WHERE asa_job_id = '2012732'")
        sanpablo = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM proyectos WHERE nombre_proyecto ILIKE '%macul coipue%'")
        macul = cur.fetchone()[0]
        cur.execute("SELECT asa_job_id FROM reclamos WHERE id_proyecto = 'PROY-F658B960' AND asa_job_id <> '2011149'")
        torreb_mal = cur.fetchall()
        cur.execute("SELECT COUNT(*) FROM asa_obras WHERE excluida")
        excluidas = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM reclamos WHERE NOT historico AND id_proyecto IS NOT NULL AND asa_job_id IS NULL")
        sin_job = cur.fetchone()[0]
        # El trigger, dentro de una transacción que se deshace: no toca nada.
        cur.execute("SELECT id FROM reclamos WHERE id_proyecto = 'PROY-E84CFAAE' LIMIT 1")
        rid = (cur.fetchone() or [None])[0]
        job_tras = None
        if rid:
            cur.execute("UPDATE reclamos SET id_proyecto = 'PROY-BA0B51EB' WHERE id = %s RETURNING asa_job_id", (rid,))
            job_tras = cur.fetchone()[0]
        conn.rollback()
check("las obras legacy están enlazadas; sólo «Obra de Prueba» queda sin job, a propósito",
      sin == ["Obra de Prueba"] and enlazadas == total - 1, (total, enlazadas, sin))
check("San Pablo: tres obras, un job", sanpablo == 3, sanpablo)
check("Macul Coipue quedó una sola", macul == 1, macul)
check("los reclamos de Torre B apuntan a Torre B", not torreb_mal, torreb_mal)
check("hay obras de aSa excluidas (las de prueba)", excluidas >= 10, excluidas)
check("ningún reclamo vivo con obra se quedó sin job", sin_job == 0, sin_job)
check("el trigger pone el job de la obra nueva al mover un reclamo", job_tras == "2013080", job_tras)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
