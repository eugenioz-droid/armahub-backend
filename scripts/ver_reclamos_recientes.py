"""SOLO LECTURA: los reclamos externos de 2026 desde una fecha, para cruzarlos con la planilla
del usuario antes de cargar los que falten. No escribe nada.

    python scripts/ver_reclamos_recientes.py 2026-09-01           -> la lista
    python scripts/ver_reclamos_recientes.py --detalle 120 128     -> todos los campos de esos números
    python scripts/ver_reclamos_recientes.py --obras texto1 texto2 -> proyectos que calzan y quién
                                                                     cubicó sus reclamos
"""
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, "scripts"))
from asa_ping import cargar_env  # noqa: E402

cargar_env()
os.environ.setdefault("JWT_SECRET", "lectura-local-no-sirve-en-produccion")
sys.stdout.reconfigure(encoding="utf-8")

from armahub.db import get_conn  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402


def lista(cur, desde):
    cur.execute("""
        SELECT r.anio_calidad, r.numero_calidad, r.fecha_deteccion, r.estado, r.tipo_reclamo,
               COALESCE(p.nombre_proyecto, r.id_proyecto, '') AS obra,
               COALESCE(NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), ''),
                        r.cubicador_asignado, '—') AS cub,
               r.titulo, r.creado_por, r.fecha_creacion::date
          FROM reclamos r
          LEFT JOIN proyectos p ON p.id_proyecto = r.id_proyecto
          LEFT JOIN users u ON u.email = r.cubicador_asignado
         WHERE NOT r.historico AND COALESCE(r.tipo_origen, 'externo') = 'externo'
           AND COALESCE(r.fecha_deteccion::text, r.fecha_creacion::text) >= %s
         ORDER BY r.anio_calidad, r.numero_calidad, r.id
    """, (desde,))
    filas = cur.fetchall()
    for f in filas:
        cod = f"{f[0]}-{f[1]:03d}" if f[0] and f[1] else "s/n"
        print(f"{cod} | {str(f[2])[:10]} | {f[3]:<11} | {f[4]:<9} | {f[5][:34]:<34} | {f[6][:20]:<20} | "
              f"{(f[7] or '')[:70]} | creado {f[9]} por {f[8]}")
    print(f"\n{len(filas)} reclamos desde {desde}")
    cur.execute("""SELECT MAX(numero_calidad) FROM reclamos
                    WHERE anio_calidad = 2026 AND NOT historico
                      AND COALESCE(tipo_origen, 'externo') = 'externo'""")
    print("último número 2026:", cur.fetchone()[0])


def detalle(conn, a, b):
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""SELECT * FROM reclamos
                        WHERE anio_calidad = 2026 AND numero_calidad BETWEEN %s AND %s
                          AND NOT historico ORDER BY numero_calidad""", (a, b))
        for r in cur.fetchall():
            print("─" * 40, r["numero_calidad"])
            for k, v in r.items():
                if v not in (None, "", [], {}) and k not in ("descripcion",):
                    print(f"  {k}: {str(v)[:90]}")
            print("  descripcion:", (r.get("descripcion") or "")[:160].replace("\n", " / "))


def obras(cur, textos):
    for t in textos:
        print("═" * 30, t)
        cur.execute("""
            SELECT p.id_proyecto, p.nombre_proyecto, p.asa_job_id,
                   (SELECT string_agg(x.cub || ' ×' || x.n, ', ' ORDER BY x.n DESC) FROM (
                        SELECT COALESCE(NULLIF(TRIM(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')), ''),
                                        r.cubicador_asignado) AS cub, COUNT(*) AS n
                          FROM reclamos r LEFT JOIN users u ON u.email = r.cubicador_asignado
                         WHERE r.id_proyecto = p.id_proyecto AND NOT r.historico
                         GROUP BY 1) x) AS cubicadores
              FROM proyectos p
             WHERE p.nombre_proyecto ILIKE %s OR p.id_proyecto ILIKE %s
             ORDER BY p.nombre_proyecto
        """, (f"%{t}%", f"%{t}%"))
        for f in cur.fetchall():
            print(f"  {f[0]} | {f[1]} | job {f[2]} | {f[3] or 'sin reclamos 2026'}")


with get_conn() as conn:
    with conn.cursor() as cur:
        cur.execute("SET TRANSACTION READ ONLY")
        if "--detalle" in sys.argv:
            i = sys.argv.index("--detalle")
            detalle(conn, int(sys.argv[i + 1]), int(sys.argv[i + 2]))
        elif "--obras" in sys.argv:
            obras(cur, sys.argv[sys.argv.index("--obras") + 1:])
        else:
            lista(cur, sys.argv[1] if len(sys.argv) > 1 else "2026-09-01")
