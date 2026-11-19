"""LICENCIAS DE ARMASCANNER (18-nov): cuándo vale una licencia y qué abre su ficha.

Sin base: lo que se prueba es la regla (estado_licencia) y la ficha (crear_ficha /
leer_ficha), que es donde un error abriría de más. La ficha se firma con el mismo secreto
que las sesiones del portal: el test exige que NO sirva como sesión, y que una sesión no
sirva como ficha.

Correr con: python tests/test_licencias.py
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("JWT_SECRET", "test-local-secret-que-no-vale-en-produccion")

from fastapi import HTTPException  # noqa: E402
from fastapi.security import HTTPAuthorizationCredentials  # noqa: E402

from armahub import auth as A  # noqa: E402
from armahub import licencias as L  # noqa: E402

fallos = 0


def check(nombre, cond, detalle=""):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre + (("  -- " + str(detalle)[:160]) if not cond else ""))
    if not cond:
        fallos += 1


def codigo(f, *a):
    try:
        f(*a)
        return 200
    except HTTPException as e:
        return e.status_code


print("TEST: licencias de ArmaScanner")
hoy = date(2026, 11, 18)

print("\n1. Cuándo vale")
check("con licencia activa y sin vencimiento", L.estado_licencia((True, None, True), hoy) == (True, ""))
check("vence hoy: vale todo el día", L.estado_licencia((True, hoy, True), hoy)[0])
check("venció ayer: no vale, y dice la fecha",
      not L.estado_licencia((True, hoy - timedelta(days=1), True), hoy)[0]
      and "17-11-2026" in L.estado_licencia((True, hoy - timedelta(days=1), True), hoy)[1])
check("retirada (casilla quitada): no vale", not L.estado_licencia((False, None, True), hoy)[0])
check("usuario desactivado: no vale aunque tenga licencia",
      not L.estado_licencia((True, None, False), hoy)[0])
check("sin fila: no vale, y dice a quién pedirla",
      not L.estado_licencia(None, hoy)[0] and "administrador" in L.estado_licencia(None, hoy)[1])

print("\n2. La ficha sirve para la licencia y para nada más")
ficha = L.crear_ficha("cubicador@armacero.cl", "armascanner")
check("la ficha se lee y trae el correo", L.leer_ficha(ficha, "armascanner") == "cubicador@armacero.cl")
check("de otro producto: 401", codigo(L.leer_ficha, ficha, "otro") == 401)
sesion = A.create_token("cubicador@armacero.cl", "miembro")
check("una sesión del portal no es ficha: 401", codigo(L.leer_ficha, sesion, "armascanner") == 401)


class _Req:
    method, url = "GET", type("U", (), {"path": "/api/v1/reclamos"})()


cred = HTTPAuthorizationCredentials(scheme="Bearer", credentials=ficha)
check("la ficha no abre la API del portal: 401", codigo(A.get_current_user, _Req(), cred) == 401)
vieja = L.crear_ficha("cubicador@armacero.cl", "armascanner",
                      datetime.now(timezone.utc) - timedelta(days=L.FICHA_DIAS + 1))
check("ficha caducada: 401 que pide volver a entrar",
      codigo(L.leer_ficha, vieja, "armascanner") == 401)
check("una firma ajena no pasa", codigo(L.leer_ficha, ficha[:-3] + "abc", "armascanner") == 401)

print("\n3. Plazos")
check("sin conexión se trabaja menos que lo que dura la ficha", L.SIN_CONEXION_DIAS < L.FICHA_DIAS)

print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
