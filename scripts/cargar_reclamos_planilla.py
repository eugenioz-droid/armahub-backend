"""CARGAR A LA PLATAFORMA LOS RECLAMOS NUEVOS DE LA PLANILLA DEL USUARIO.

    python scripts/cargar_reclamos_planilla.py entrada/Reclamos/<lote>.json            -> PRUEBA
    python scripts/cargar_reclamos_planilla.py entrada/Reclamos/<lote>.json --cargar   -> escribe

El usuario lleva los reclamos de clientes en su planilla y los pasa a la plataforma para que
los cubicadores los analicen. Este script los crea con la MISMA función que usa la página
(`crear_reclamo`): numeración REC, área inferida del cubicador, seguimiento «Reclamo creado» y
aviso al cubicador, igual que si se hubieran ingresado a mano. Quien los crea es el usuario
que se indique en el lote (`creado_por`), como en las cargas anteriores.

NO DUPLICA. Antes de crear revisa el número de calidad (año-número) y el mismo título en la
misma fecha; si ya existe, lo salta y lo dice. Se puede correr dos veces.

El lote es un JSON: {"creado_por": "...", "anio": 2026, "reclamos": [{"numero", "fecha",
"tipo", "titulo", "id_proyecto" o "asa_job_id", "cubicador", "descripcion"}, ...]}. Con
`asa_job_id` en vez de `id_proyecto`, la obra se adopta del espejo de aSa como en la página.
Una fila con "pendiente": "<por qué>" no se carga (queda esperando una respuesta). Va en
entrada/ (no se sube al repositorio: trae datos reales de obras).
"""
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, "scripts"))
from asa_ping import cargar_env  # noqa: E402

cargar_env()
os.environ.setdefault("JWT_SECRET", "carga-local-no-sirve-en-produccion")
sys.stdout.reconfigure(encoding="utf-8")

from armahub.db import get_conn  # noqa: E402
from armahub.reclamos import ReclamoCreate, crear_reclamo, TIPOS_RECLAMO  # noqa: E402

CARGAR = "--cargar" in sys.argv
lote = json.load(open(sys.argv[1], encoding="utf-8"))
anio = lote["anio"]

with get_conn() as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT role, activo FROM users WHERE email = %s", (lote["creado_por"],))
        quien = cur.fetchone()
        if not quien or not quien[1]:
            raise SystemExit(f"{lote['creado_por']} no es un usuario activo")
        autor = {"email": lote["creado_por"], "role": quien[0]}

        problemas, plan = [], []
        for r in lote["reclamos"]:
            cod = f"{anio}-{r['numero']:03d}"
            if r.get("pendiente"):
                print(f"  {cod} queda esperando: {r['pendiente']}")
                continue
            cur.execute("""SELECT 1 FROM reclamos WHERE anio_calidad = %s AND numero_calidad = %s
                             AND NOT historico AND COALESCE(tipo_origen, 'externo') = 'externo'""",
                        (anio, r["numero"]))
            if cur.fetchone():
                print(f"  ya existe {cod} — se salta")
                continue
            cur.execute("SELECT 1 FROM reclamos WHERE titulo = %s AND fecha_deteccion::date = %s",
                        (r["titulo"], r["fecha"]))
            if cur.fetchone():
                print(f"  ya existe «{r['titulo']}» del {r['fecha']} — se salta")
                continue
            if r["tipo"] not in TIPOS_RECLAMO:
                problemas.append(f"{cod}: tipo «{r['tipo']}» no existe")
            if r.get("id_proyecto"):
                cur.execute("SELECT nombre_proyecto FROM proyectos WHERE id_proyecto = %s", (r["id_proyecto"],))
            else:
                cur.execute("SELECT nombre || ' (se adopta de aSa)' FROM asa_obras WHERE asa_job_id = %s",
                            (r.get("asa_job_id"),))
            obra = cur.fetchone()
            if not obra:
                problemas.append(f"{cod}: la obra {r.get('id_proyecto') or r.get('asa_job_id')} no existe")
            cur.execute("""SELECT TRIM(COALESCE(nombre,'') || ' ' || COALESCE(apellido,'')) FROM users
                            WHERE email = %s AND activo""", (r["cubicador"],))
            cub = cur.fetchone()
            if not cub:
                problemas.append(f"{cod}: el cubicador {r['cubicador']} no es un usuario activo")
            plan.append((r, cod, obra[0] if obra else "?", cub[0] if cub else "?"))

for r, cod, obra, cub in plan:
    print(f"  {cod} | {r['fecha']} | {r['tipo']:<8} | {obra[:34]:<34} | {cub:<18} | {r['titulo'][:60]}")
if problemas:
    print("\nNO SE CARGA NADA:\n  " + "\n  ".join(problemas))
    sys.exit(1)
if not CARGAR:
    print(f"\nPRUEBA: {len(plan)} por crear. Para escribir: --cargar")
    sys.exit(0)

for r, cod, obra, cub in plan:
    res = crear_reclamo(ReclamoCreate(
        id_proyecto=r.get("id_proyecto"), asa_job_id=r.get("asa_job_id"),
        titulo=r["titulo"], descripcion=r["descripcion"],
        prioridad="alta", tipo_reclamo=r["tipo"], responsable=cub,
        detectado_por=r.get("detectado_por", "Constructora"), fecha_deteccion=r["fecha"],
        anio_calidad=anio, numero_calidad=r["numero"],
        asignado_a=r["cubicador"], cubicador_asignado=r["cubicador"], tipo_origen="externo",
    ), user=autor)
    print(f"  creado {cod} → {res['correlativo']} (id {res['id']})")
print(f"\nListo: {len(plan)} reclamos creados.")
