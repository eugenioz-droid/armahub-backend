"""EL RESPONSABLE SIEMPRE VE SUS RECLAMOS (16-nov).

En Presentaciones, la lista le muestra al cubicador (rol miembro o jefe_servicio) los
reclamos de los que es responsable; la ficha, en cambio, sólo lo dejaba ver los de las
áreas a las que pertenece. Elegía un reclamo suyo de otra área —o sin área, como los
externos— y la página le contestaba «Error: No tiene permiso para ver este reclamo».
Las imágenes, además, se pedían sin el área del reclamo, así que a esos dos roles se les
negaban todas.

Correr con: python tests/test_reclamos_ver_propios.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

from armahub.reclamos import _puede_ver_reclamo  # noqa: E402

fallos = 0


def check(nombre, cond, detalle=""):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -- " + str(detalle)[:120]) if not cond else ""))
    if not cond:
        fallos += 1


class Cursor:
    """Responde la consulta de pertenencia a un área con las áreas que se le den."""

    def __init__(self, areas):
        self.areas, self.fila = areas, None

    def execute(self, sql, params):
        self.fila = (1,) if params[1] in self.areas else None

    def fetchone(self):
        return self.fila


YO = "cubicador@armacero.cl"
OTRO = "otro@armacero.cl"

print("TEST: el responsable siempre ve sus reclamos")
for rol in ("miembro", "jefe_servicio"):
    u = {"role": rol, "email": YO}
    check(f"{rol}: el suyo de otra área se ve",
          _puede_ver_reclamo({"cubicador_asignado": YO, "area_id": 9}, u, Cursor([3])))
    check(f"{rol}: el suyo sin área (externo) se ve",
          _puede_ver_reclamo({"cubicador_asignado": YO, "area_id": None}, u, Cursor([3])))
    check(f"{rol}: el que respondió él se ve",
          _puede_ver_reclamo({"cubicador_asignado": OTRO, "respuesta_por": YO, "area_id": None}, u, Cursor([])))
    check(f"{rol}: uno ajeno de su área se sigue viendo",
          _puede_ver_reclamo({"cubicador_asignado": OTRO, "area_id": 3}, u, Cursor([3])))
    check(f"{rol}: uno ajeno de otra área sigue cerrado",
          not _puede_ver_reclamo({"cubicador_asignado": OTRO, "area_id": 9}, u, Cursor([3])))
    check(f"{rol}: uno ajeno sin área sigue cerrado",
          not _puede_ver_reclamo({"cubicador_asignado": OTRO, "area_id": None}, u, Cursor([3])))

check("cliente: ni siquiera el suyo",
      not _puede_ver_reclamo({"cubicador_asignado": YO}, {"role": "cliente", "email": YO}, Cursor([])))

SRC = open(os.path.join(ROOT, "armahub", "reclamos.py"), encoding="utf-8").read()
check("las imágenes se piden con el área del reclamo",
      "SELECT creado_por, asignado_a, cubicador_asignado, respuesta_por, area_id" in SRC)

JS = open(os.path.join(ROOT, "armahub", "static", "js", "features", "reclamos", "presentaciones.js"),
          encoding="utf-8").read()
check("la ficha no se queda con la respuesta de un reclamo que ya no está elegido",
      "if (sel.value !== String(id)) return;" in JS)
check("el detalle que llega después no borra lo marcado en el formulario",
      "_renderPresentacionDetail(detail, true);" in JS)
check("las imágenes atrasadas no se pintan en la ficha de otro reclamo",
      "if (String(detail.id) !== document.getElementById('presReclamoSelect').value) return;" in JS)

print(f"\n{'TODO OK' if not fallos else str(fallos) + ' FALLOS'}")
sys.exit(1 if fallos else 0)
