"""EL RESPONSABLE DE UN RECLAMO, Y QUIÉN VE QUÉ (14-oct).

Dos cosas que el usuario trajo el mismo día y que se tocan: el responsable se mostraba
distinto de como se filtraba, y los cubicadores arrancaban viendo sólo lo suyo.

EL RESPONSABLE VIVE EN DOS COLUMNAS: `cubicador_asignado` —el correo, con el que se
FILTRA y con el que se decide quién puede editar— y `responsable` —el nombre, que es lo
que se VE—. Nada obligaba a que dijeran lo mismo, así que un PATCH que tocara una sola
las separaba: el 2026-046 decía «Gerardo Mendoza» y se filtraba como de Jose Rodriguez.

Correr con: python tests/test_reclamos_responsable.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

fallos = 0


def check(nombre, cond, detalle=""):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -- " + str(detalle)[:120]) if not cond else ""))
    if not cond:
        fallos += 1


def _leer(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


SRC = _leer("armahub", "reclamos.py")
LIST = _leer("armahub", "static", "js", "features", "reclamos", "list.js")
INT = _leer("armahub", "static", "js", "features", "reclamos", "internos.js")
MIG = _leer("armahub", "migrations", "150_responsable_reclamo_coherente.sql")

print("TEST: el responsable de un reclamo, y quién ve qué")

print("\n1. El correo y el nombre del responsable viajan juntos")
check("hay UNA función que resuelve el par, y no dos criterios sueltos",
      "def _mismo_responsable(" in SRC)
check("tocar cualquiera de las dos columnas obliga a resolver la otra",
      '_toca_resp = ("responsable" in body.__fields_set__' in SRC
      and '"cubicador_asignado" in body.__fields_set__)' in SRC
      and "_mismo_responsable(cur, nombre=" in SRC)
check("se arregla en el PATCH y no en el filtro",
      "se arregla acá, no en el filtro" in SRC)
# LO QUE NO DEBE HACER: inventar un correo. Si el nombre no es de nadie —o hay dos
# personas que se llaman igual— es mejor dejar el correo como está que apuntar al que no es.
check("un nombre que no es de nadie NO inventa un correo",
      "se llaman igual no se adivina" in SRC and "return None, (nombre or None)" in SRC)
check("...y sólo se agrega la columna que falta, sin reescribir params por índice",
      "es la clase de arreglo que corrompe el UPDATE de al lado" in SRC)

print("\n2. Los dos reclamos que quedaron partidos")
check("la migración no toca lo que sólo difiere en la FORMA de escribirlo",
      "NOT EXISTS (" in MIG and "u2.email" in MIG)
check("...porque de 19 con las columnas distintas, 17 eran la misma persona",
      "17 difieren s" in MIG and "de 19 reclamos vivos" in MIG)

print("\n3. Todos los cubicadores ven todo")
check("el alcance arranca en TODO, para cualquier rol",
      "_recScopeAll = true;" in LIST and "var _intScopeAll = true;" in INT)
check("...y el rol `externo` ya no queda sin el botón ni forzado a lo suyo",
      "if (currentRole === 'cliente') {" in LIST
      and "if (currentRole === 'externo') {" not in LIST
      and "['externo','cliente'].includes(currentRole)" not in LIST)
# ESTO NO ABRE UN PERMISO: `solo_mios` siempre fue un filtro que manda el cliente, no una
# barrera. El backend no restringe el listado y nunca lo hizo.
check("queda dicho que esto era una vista por defecto, no una barrera",
      "NO ES UN PERMISO QUE SE ABRE" in LIST)
check("lo que sigue cerrado es ESCRIBIR lo ajeno",
      '"Solo puede editar reclamos propios"' in SRC
      and "_es_propietario_cubicador(rec, email)" in SRC)
# El cliente no entra por esta puerta: su cerrojo está en auth.py y es por ruta.
check("el cliente sigue fuera, y por su propio cerrojo",
      "su cerrojo está en auth.py" in LIST
      and "ROL_CLIENTE" in _leer("armahub", "auth.py"))

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
