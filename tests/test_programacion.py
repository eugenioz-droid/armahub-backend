"""Test de la PROGRAMACIÓN DE CUBICACIONES (28-sep).

QUÉ CUIDA. Este módulo reemplaza la planilla semanal del área, y todo su valor depende de dos
reglas de fecha que tienen que ser las mismas en todas partes:

  1. El USC escribe la fecha de DESPACHO —la que maneja y no puede disfrazar—; la de
     CUBICACIÓN se deriva 10 días hábiles antes y es la que manda para el programa semanal.
  2. Si al programar quedan menos de 7 días hábiles hasta la cubicación, la tarea entra IGUAL
     pero queda marcada. No bloquea: el área atiende. Lo que se registra es cómo se planifica.
     Un USC que programa el mes sólo la ve en la primera; al que se queda sin programa le
     aparece en todas.

Y una regla de arquitectura: esas cuentas viven en el BACKEND. Si el front las duplicara,
el día que cambie el plazo habría dos verdades y una se quedaría atrás. El test lo vigila.

Se EJECUTAN las funciones reales (extraídas con ast, sin importar el módulo, que arrastraría
fastapi/psycopg). Correr con: python tests/test_programacion.py
"""
import ast
import datetime
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROG = os.path.join(ROOT, "armahub", "programacion.py")
JS = os.path.join(ROOT, "armahub", "static", "js", "features", "programacion", "index.js")
MIG = os.path.join(ROOT, "armahub", "migrations", "111_programacion.sql")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


def _cargar(path, nombres):
    """Compila sólo las funciones/constantes pedidas, en un entorno propio."""
    with open(path, encoding="utf-8") as fh:
        arbol = ast.parse(fh.read())
    entorno = {"date": datetime.date, "timedelta": datetime.timedelta}
    cuerpo = []
    for nodo in arbol.body:
        if isinstance(nodo, ast.FunctionDef) and nodo.name in nombres:
            cuerpo.append(nodo)
        elif isinstance(nodo, ast.Assign):
            for t in nodo.targets:
                if isinstance(t, ast.Name) and t.id in nombres:
                    cuerpo.append(nodo)
    exec(compile(ast.Module(body=cuerpo, type_ignores=[]), path, "exec"), entorno)
    return entorno


src = open(PROG, encoding="utf-8").read()
env = _cargar(PROG, {"_es_habil", "_suma_habiles", "_habiles_entre", "_derivar_fechas",
                     "DIAS_CUBICACION_A_DESPACHO", "DIAS_MINIMOS"})
habil, suma, entre = env["_es_habil"], env["_suma_habiles"], env["_habiles_entre"]
D = datetime.date

print("TEST: programación de cubicaciones")

# ── 1. Los plazos son los acordados ─────────────────────────────────────────
print("\n1. Los plazos")
check("cubicación = 10 días hábiles antes del despacho", env["DIAS_CUBICACION_A_DESPACHO"] == 10)
check("mínimo para tomar una tarea = 7 días hábiles", env["DIAS_MINIMOS"] == 7)

# ── 2. Días hábiles: lunes a viernes, en los dos sentidos ───────────────────
print("\n2. Aritmética de días hábiles")
check("sábado y domingo no son hábiles", not habil(D(2026, 10, 3)) and not habil(D(2026, 10, 4)))
check("lunes a viernes sí", all(habil(D(2026, 9, 28) + datetime.timedelta(days=i)) for i in range(5)))
check("desde un viernes, +1 hábil cae el lunes", suma(D(2026, 10, 2), 1) == D(2026, 10, 5))
check("desde un lunes, -1 hábil cae el viernes", suma(D(2026, 9, 28), -1) == D(2026, 9, 25))
check("+5 hábiles desde un lunes cae el lunes siguiente", suma(D(2026, 9, 28), 5) == D(2026, 10, 5))
check("de lunes a lunes hay 5 hábiles", entre(D(2026, 9, 28), D(2026, 10, 5)) == 5)
check("y al revés, -5", entre(D(2026, 10, 5), D(2026, 9, 28)) == -5)
check("el mismo día son 0", entre(D(2026, 9, 28), D(2026, 9, 28)) == 0)
check("restar 10 y volver a sumar 10 devuelve el mismo día hábil",
      suma(suma(D(2026, 11, 20), -10), 10) == D(2026, 11, 20))

# ── 3. La derivación completa, con HOY fijo ─────────────────────────────────
# _derivar_fechas usa date.today(); se reemplaza por una fecha fija para que el test no
# cambie de resultado según el día en que se corra.
print("\n3. Del despacho salen la cubicación y la marca de plazo corto")
HOY = D(2026, 9, 28)   # lunes


class _HoyFijo(datetime.date):
    @classmethod
    def today(cls):
        return HOY


env2 = _cargar(PROG, {"_es_habil", "_suma_habiles", "_habiles_entre", "_derivar_fechas",
                      "DIAS_CUBICACION_A_DESPACHO", "DIAS_MINIMOS"})
env2["date"] = _HoyFijo
derivar = env2["_derivar_fechas"]

casos = [
    # (despacho,       cubicación esperada, ¿plazo corto?, por qué)
    (D(2026, 11, 20), D(2026, 11, 6),  False, "holgado: mes y medio por delante"),
    (D(2026, 10, 23), D(2026, 10, 9),  False, "justo en el límite de los 7 hábiles"),
    (D(2026, 10, 22), D(2026, 10, 8),  False, "8 hábiles de margen"),
    # El límite es «menos de 7»: con exactamente 7 SÍ se puede, que es lo que pidió el usuario
    # («no se puede programar si no se cuenta con 7 días»). Con 6 ya queda marcada.
    (D(2026, 10, 21), D(2026, 10, 7),  False, "exactamente 7 hábiles: alcanza"),
    (D(2026, 10, 20), D(2026, 10, 6),  True,  "6 hábiles: por debajo del mínimo"),
    (D(2026, 10, 12), D(2026, 9, 28),  True,  "la cubicación cae HOY"),
    (D(2026, 10, 5),  D(2026, 9, 21),  True,  "la cubicación ya pasó"),
]
for despacho, cub_esp, corto_esp, porque in casos:
    cub, corto = derivar(despacho)
    margen = entre(HOY, cub)
    check("despacho %s -> cubicar %s (%+d hábiles) %s  [%s]" % (
        despacho, cub, margen, "CORTO" if corto else "ok", porque),
        cub == cub_esp and corto == corto_esp)

check("nunca bloquea: derivar siempre devuelve una fecha, incluso si ya pasó",
      derivar(D(2026, 9, 29))[0] is not None)

# ── 4. Las reglas NO se duplican en el front ────────────────────────────────
print("\n4. Las reglas viven en el backend, no en el front")
js = open(JS, encoding="utf-8").read()
check("el front no recalcula la fecha de cubicación (no resta días hábiles)",
      not re.search(r"habil|10\s*\)\s*;|LEAD", js, re.I) or "sumaHabiles" not in js)
check("el front no decide el plazo corto: lo recibe en `plazo_corto`",
      "plazo_corto" in js and "CORTO" not in js)
check("y el backend es quien lo manda", "plazo_corto" in src and "_derivar_fechas" in src)

# ── 5. La tarea es el frente que ArmaHub ya conoce ──────────────────────────
print("\n5. Las tareas se derivan, no se teclean")
check("la sincronización inserta desde sector_estado", "FROM sector_estado se" in src and
      "INSERT INTO tareas_programacion" in src)
check("y no pisa las que ya existen (ON CONFLICT DO NOTHING)",
      re.search(r"ON CONFLICT \(id_proyecto, sector, piso, ciclo\) DO NOTHING", src) is not None)
mig = open(MIG, encoding="utf-8").read()
check("la clave única de la tarea es la misma del frente",
      "ux_tareas_prog_clave" in mig and "(id_proyecto, sector, piso, ciclo)" in mig)

# ── 6. Cubicado automático y peso real ──────────────────────────────────────
print("\n6. Lo que ArmaHub sabe, no se teclea")
check("una tarea programada cuyo frente ya se exportó pasa sola a 'cubicada'",
      "_auto_cubicadas" in src and "se.estado IN ('exportado','modificado')" in src)
check("...y sólo si además tiene barras (exportar sin barras no es cubicar)",
      "EXISTS (SELECT 1 FROM barras b" in src)
check("el peso REAL sale de las barras, no de un campo que alguien llena",
      "SUM(peso_total) AS kg" in src and "ton_reales" in src)
check("queda el marcado a mano para las obras que se cubican fuera de ArmaHub",
      "/programacion/tareas/{tarea_id}/cubicada" in src)

# ── 7. Permisos y no-destrucción ────────────────────────────────────────────
print("\n7. Permisos y cuidado del dato")
check("sólo USC o administración programan", "_ROLES_PROGRAMAN" in src and
      '"usc"' in src.split("_ROLES_PROGRAMAN")[1][:120])
check("desprogramar NO borra la tarea: la devuelve a 'disponible'",
      "estado='disponible'" in src and "DELETE FROM tareas_programacion" not in src)
check("el PATCH sólo toca lo que vino en el cuerpo (__fields_set__)",
      "__fields_set__" in src)

# ── 8. El router responde por /api/v1, que es por donde habla el front ──────
# El front construye TODAS sus URLs con apiUrl(), que antepone /api/v1. Un router montado
# sólo sin prefijo responde 404 a toda la pantalla, y ningún test de lógica lo nota: el
# módulo de Programación estuvo así desde que nació (28-sep) y se veía vacío. El check es
# genérico: todo router que la app monta, salvo el de HTML (ui), tiene que estar en la
# lista que se vuelve a montar bajo /api/v1.
print("\n8. Todos los routers se montan también bajo /api/v1")
main_src = open(os.path.join(ROOT, "armahub", "main.py"), encoding="utf-8").read()
montados = set(re.findall(r"app\.include_router\((\w+_router)\)", main_src))
lista = main_src.split("_api_routers = [")[1].split("]")[0]
bajo_api = set(re.findall(r"(\w+_router)", lista))
faltan = sorted(montados - bajo_api - {"ui_router"})
check("ningún router de API falta bajo /api/v1 (faltan: %s)" % (", ".join(faltan) or "ninguno"),
      not faltan)
check("el de programación está, en particular", "programacion_router" in bajo_api)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
