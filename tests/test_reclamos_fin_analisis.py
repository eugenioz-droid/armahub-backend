"""La FECHA DE FIN DE ANÁLISIS se llena sola (30-sep).

Antes la escribía el analista a mano, y casi nunca. El usuario pidió que la ponga el
sistema: cuando el analista ENVÍA a validación (o a revisión, si el área la tiene) se
cierra con la fecha de ese día; si el reclamo le VUELVE, se abre; y al reenviar se
cierra de nuevo. Un dato menos que llenar.

Se EJECUTA la regla (es una función pura) y se mira que el formulario ya no la mande.

Correr con: python tests/test_reclamos_fin_analisis.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


from armahub.reclamos import fecha_fin_analisis_automatica as regla, _hoy_chile  # noqa: E402

REC = open(os.path.join(ROOT, "armahub", "reclamos.py"), encoding="utf-8").read()
HTM = open(os.path.join(ROOT, "armahub", "templates", "tabs", "reclamos.html"), encoding="utf-8").read()
EDIT = open(os.path.join(ROOT, "armahub", "static", "js", "features", "reclamos", "detail-edit.js"), encoding="utf-8").read()
FLOW = open(os.path.join(ROOT, "armahub", "static", "js", "features", "reclamos", "detail-flow.js"), encoding="utf-8").read()

print("TEST: fecha de fin de análisis automática")

print("\n1. La regla, ejecutada")
check("enviar a validación (área sin revisión) la CIERRA", regla("en_analisis", "validacion") == "poner")
check("enviar a revisión (área con revisión) la CIERRA", regla("en_analisis", "en_revision") == "poner")
check("...también desde 'abierto' (primer envío directo)", regla("abierto", "validacion") == "poner")
check("devuelto por revisión al analista la ABRE", regla("en_revision", "en_analisis") == "borrar")
check("rechazado por Calidad al analista la ABRE", regla("validacion", "en_analisis") == "borrar")
check("el Jefe aprueba (revisión -> validación): NO se toca, el analista ya había enviado",
      regla("en_revision", "validacion") is None)
check("Calidad devuelve al Jefe (validación -> revisión): NO se toca, sigue fuera del analista",
      regla("validacion", "en_revision") is None)
check("cerrar no la toca", regla("validacion", "cerrado") is None)
check("sin cambio de estado no se toca", regla("en_analisis", "en_analisis") is None
      and regla("en_analisis", None) is None)
check("reabrir desde cerrado a análisis la abre", regla("cerrado", "en_analisis") == "borrar")

print("\n2. Está cableada en el PATCH y el usuario ya no la escribe")
check("el PATCH aplica la regla justo antes del UPDATE",
      '_ffa = fecha_fin_analisis_automatica(estado_anterior, body.estado)' in REC
      and 'sets.append("fecha_fin_analisis = %s")' in REC and 'sets.append("fecha_fin_analisis = NULL")' in REC
      and REC.index("_ffa = fecha_fin_analisis_automatica") < REC.index('cur.execute(f"UPDATE reclamos SET'))
check("...con la fecha de Chile, no la del servidor (UTC)",
      'ZoneInfo("America/Santiago")' in REC and len(_hoy_chile()) == 10 and _hoy_chile()[4] == "-")
check("el campo salió de la lista de campos editables del PATCH",
      '"fecha_analisis", "fecha_fin_analisis",' not in REC)
check("el formulario lo muestra en sólo lectura",
      'id="recDetailFechaFinAnalisis" readonly' in HTM)
check("...y ni guardar análisis ni enviar a validación lo mandan",
      "_setIf('fecha_fin_analisis'" not in EDIT and "_setIf('fecha_fin_analisis'" not in FLOW)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
