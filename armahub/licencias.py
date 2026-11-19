"""
licencias.py
------------
Licencias de las herramientas de escritorio de Armacero (hoy ArmaScanner), por usuario.

El usuario, 18-nov: «en el portal debo poder al usuario asignarle una licencia en el menú de
gestión de usuarios… al ejecutar ArmaScanner, debe revisar validación de esa licencia con
internet. Posterior a eso, define tiempo de vigencia».

Flujo:
    Administración → Gestión de usuarios: casilla «ArmaScanner» y fecha de vencimiento
        PUT /admin/users/{id}/licencias/{producto}
    ArmaScanner, la primera vez en un equipo: el cubicador entra con su correo y clave de
    ArmaHub
        POST /licencias/{producto}/activar   → ficha de licencia (token propio, 30 días)
    ArmaScanner, cada vez que se abre: presenta la ficha y recibe una nueva (renovación)
        POST /licencias/{producto}/validar   → ficha nueva, o 403 con el motivo

LA FICHA NO ES UNA SESIÓN DE ARMAHUB. Es un JWT firmado con el mismo secreto pero con
`tipo = "licencia"`: get_current_user lo rechaza (auth.py), así que no abre ninguna otra
ruta de la API. Dura FICHA_DIAS y se renueva en cada validación: quien abre ArmaScanner al
menos una vez al mes no vuelve a escribir su clave. Revocar (quitar la casilla, vencer,
desactivar al usuario) vale en la siguiente validación con internet.

Sin internet, ArmaScanner deja trabajar hasta SIN_CONEXION_DIAS desde la última validación
buena (y nunca pasado el vencimiento). Ese plazo lo manda el servidor en cada respuesta, para
cambiarlo sin publicar otra versión de la herramienta.
"""

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from .auth import JWT_ALG, JWT_SECRET, _rate_limit_login, pwd_context, require_admin_or_admin_calidad
from .db import audit, get_conn

logger = logging.getLogger("armahub.licencias")

router = APIRouter()
_bearer = HTTPBearer()

PRODUCTOS = {"armascanner": "ArmaScanner"}
FICHA_DIAS = 30          # vida de la ficha; se renueva en cada validación
SIN_CONEXION_DIAS = 3    # cuánto trabaja la herramienta sin poder validar
TIPO_FICHA = "licencia"


def _producto(producto: str) -> str:
    if producto not in PRODUCTOS:
        raise HTTPException(status_code=404, detail="Producto desconocido")
    return producto


def estado_licencia(fila, hoy: date):
    """Si la licencia vale hoy. Función pura (se prueba sin base).
    fila = (licencia activa, vence o None, usuario activo) o None si no tiene.
    Devuelve (vale, motivo para el usuario o "")."""
    if fila is None:
        return False, "Tu usuario no tiene licencia de ArmaScanner. Pídela al administrador de ArmaHub."
    activa, vence, usuario_activo = fila
    if usuario_activo is False:
        return False, "Tu usuario de ArmaHub está desactivado. Contacta al administrador."
    if not activa:
        return False, "Tu licencia de ArmaScanner fue retirada. Contacta al administrador de ArmaHub."
    if vence is not None and vence < hoy:
        return False, f"Tu licencia de ArmaScanner venció el {vence.strftime('%d-%m-%Y')}. Pide renovarla."
    return True, ""


def crear_ficha(email: str, producto: str, ahora: datetime = None) -> str:
    ahora = ahora or datetime.now(timezone.utc)
    return jwt.encode({"email": email, "producto": producto, "tipo": TIPO_FICHA,
                       "iat": ahora, "exp": ahora + timedelta(days=FICHA_DIAS)},
                      JWT_SECRET, algorithm=JWT_ALG)


def leer_ficha(token: str, producto: str) -> str:
    """El correo de una ficha válida de ese producto; si no, 401."""
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG], options={"require": ["exp"]})
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="La licencia de este equipo caducó: vuelve a entrar con tu usuario.")
    except Exception:
        raise HTTPException(status_code=401, detail="Licencia no reconocida: vuelve a entrar con tu usuario.")
    if p.get("tipo") != TIPO_FICHA or p.get("producto") != producto or not p.get("email"):
        raise HTTPException(status_code=401, detail="Licencia no reconocida: vuelve a entrar con tu usuario.")
    return p["email"]


def _respuesta(cur, email: str, producto: str, equipo: str, version: str):
    """Revisa la licencia del correo; si vale, anota el uso y devuelve la ficha nueva."""
    cur.execute("""
        SELECT u.id, u.nombre, u.apellido, COALESCE(u.activo, TRUE), l.activa, l.vence
          FROM users u
          LEFT JOIN licencias l ON l.user_id = u.id AND l.producto = %s
         WHERE u.email = %s
    """, (producto, email))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="El usuario ya no existe en ArmaHub.")
    uid, nombre, apellido, usuario_activo, activa, vence = row
    vale, motivo = estado_licencia(None if activa is None else (activa, vence, usuario_activo),
                                   datetime.now(timezone.utc).date())
    if not vale:
        raise HTTPException(status_code=403, detail=motivo)
    cur.execute("""
        UPDATE licencias SET ultimo_uso = NOW(), ultimo_equipo = %s, version = %s
         WHERE user_id = %s AND producto = %s
    """, ((equipo or "")[:120] or None, (version or "")[:40] or None, uid, producto))
    return {
        "ok": True,
        "ficha": crear_ficha(email, producto),
        "email": email,
        "nombre": ((nombre or "") + " " + (apellido or "")).strip() or email,
        "producto": producto,
        "vence": vence.isoformat() if vence else None,
        "sin_conexion_dias": SIN_CONEXION_DIAS,
        "ficha_dias": FICHA_DIAS,
    }


class Activar(BaseModel):
    email: str
    password: str
    equipo: str = ""
    version: str = ""


class Validar(BaseModel):
    equipo: str = ""
    version: str = ""


@router.post("/licencias/{producto}/activar")
def activar(producto: str, datos: Activar, request: Request):
    """Primera vez en un equipo: correo y clave de ArmaHub. Mismo freno de intentos que el
    inicio de sesión del portal."""
    producto = _producto(producto)
    _rate_limit_login(request)
    email = (datos.email or "").strip()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT email, password_hash FROM users WHERE email = %s", (email,))
            row = cur.fetchone()
            if not row or not pwd_context.verify(datos.password or "", row[1]):
                raise HTTPException(status_code=401, detail="Correo o clave incorrectos.")
            res = _respuesta(cur, row[0], producto, datos.equipo, datos.version)
    audit(row[0], "licencia_activar", f"{PRODUCTOS[producto]} en {datos.equipo or '?'} ({datos.version or '?'})",
          "licencia", row[0])
    return res


@router.post("/licencias/{producto}/validar")
def validar(producto: str, datos: Validar, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Cada vez que se abre la herramienta: la ficha del equipo por una nueva, o 403 con el
    motivo (retirada, vencida, usuario desactivado)."""
    producto = _producto(producto)
    email = leer_ficha(credentials.credentials, producto)
    with get_conn() as conn:
        with conn.cursor() as cur:
            return _respuesta(cur, email, producto, datos.equipo, datos.version)


# ══════ ADMINISTRACIÓN ══════

class Asignar(BaseModel):
    activa: bool
    vence: Optional[date] = None


def licencias_por_usuario(cur):
    """{user_id: {producto: {...}}} para la lista de Gestión de usuarios."""
    cur.execute("""
        SELECT user_id, producto, activa, vence, ultimo_uso, ultimo_equipo, version
          FROM licencias
    """)
    out = {}
    for uid, prod, activa, vence, uso, equipo, version in cur.fetchall():
        out.setdefault(uid, {})[prod] = {
            "activa": activa, "vence": vence.isoformat() if vence else None,
            "ultimo_uso": uso.isoformat() if uso else None, "ultimo_equipo": equipo, "version": version}
    return out


@router.put("/admin/users/{user_id}/licencias/{producto}")
def asignar(user_id: int, producto: str, datos: Asignar, admin=Depends(require_admin_or_admin_calidad)):
    """Da, quita o cambia el vencimiento de la licencia de un usuario. Quitar no borra la
    fila: queda inactiva, con su último uso (se ve quién la tenía)."""
    producto = _producto(producto)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT email, role FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            if admin.get("role") != "admin" and row[1] in ("admin", "admin_calidad"):
                raise HTTPException(status_code=403,
                                    detail="Admin Calidad no puede modificar usuarios admin o admin_calidad")
            cur.execute("""
                INSERT INTO licencias (user_id, producto, activa, vence, asignada_por)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id, producto)
                DO UPDATE SET activa = EXCLUDED.activa, vence = EXCLUDED.vence,
                              asignada_por = EXCLUDED.asignada_por, asignada_el = NOW()
            """, (user_id, producto, datos.activa, datos.vence, admin.get("email")))
    detalle = (f"{row[0]}: {PRODUCTOS[producto]} "
               + ("asignada" + (f" hasta {datos.vence.isoformat()}" if datos.vence else " sin vencimiento")
                  if datos.activa else "retirada"))
    audit(admin.get("email", "?"), "licencia_asignar", detalle, "usuario", str(user_id))
    return {"ok": True, "id": user_id, "producto": producto, "activa": datos.activa,
            "vence": datos.vence.isoformat() if datos.vence else None}
