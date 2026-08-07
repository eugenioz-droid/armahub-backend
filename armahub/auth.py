"""
auth.py
-------
Autenticación y autorización.

Incluye:
- POST /auth/login
- POST /auth/register  (solo admin)
- GET  /me

Además:
- Dependencias FastAPI:
    - get_current_user (valida JWT)
    - require_admin (valida rol admin)

Bootstrap:
- POST /bootstrap/create-admin (solo si no existe ningún usuario aún)
  Esto permite partir de cero cuando borras tablas / reseteas la DB.
"""

import os
import time
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext

from .db import get_conn, users_count, audit

router = APIRouter()

# M0.1 — la app NO arranca sin secreto real: un default público permitiría a
# cualquiera firmar tokens admin.
JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET or JWT_SECRET == "dev-secret-change-me":
    raise RuntimeError(
        "JWT_SECRET no configurado (o con valor de desarrollo). "
        "Define la variable de entorno JWT_SECRET antes de arrancar."
    )
JWT_ALG = "HS256"
TOKEN_HORAS = 8  # M0.3 — vida del token; el front lo renueva en silencio antes de vencer

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
auth_scheme = HTTPBearer()


def create_token(email: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"email": email, "role": role, "iat": now, "exp": now + timedelta(hours=TOKEN_HORAS)},
        JWT_SECRET, algorithm=JWT_ALG,
    )


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(auth_scheme)):
    token = credentials.credentials
    try:
        # require exp: tokens antiguos (sin expiración) dejan de valer → re-login único
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG], options={"require": ["exp"]})
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesión expirada. Vuelve a iniciar sesión.")
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido")
    # Always read fresh role from DB to avoid JWT/BD desync
    email = payload.get("email")
    if email:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT role FROM users WHERE email = %s", (email,))
                row = cur.fetchone()
                if row:
                    payload["role"] = row[0]
    return payload


def require_admin(user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Solo admin")
    return user


def require_admin_or_admin_calidad(user=Depends(get_current_user)):
    if user.get("role") not in ("admin", "admin_calidad"):
        raise HTTPException(status_code=403, detail="Solo admin o admin_calidad")
    return user


def require_role(*allowed_roles):
    """Factory: returns a FastAPI dependency that restricts to the given roles."""
    def _dep(user=Depends(get_current_user)):
        if user.get("role") not in allowed_roles:
            raise HTTPException(status_code=403, detail=f"Requiere rol: {', '.join(allowed_roles)}")
        return user
    return _dep


# Shared role→project-role map (used by barras, importer, etc.)
ROL_MAP = {"admin": "admin", "admin_calidad": "admin", "jefe_servicio": "jefe_servicio", "miembro": "miembro", "cliente": "cliente", "cubicador": "cubicador", "usc": "usc", "externo": "externo"}

# Roles válidos en proyecto_usuarios.rol (CHECK legacy migración 31). Los roles
# nuevos (miembro/jefe_servicio) no existen ahí → se mapean a 'cubicador' para no
# violar el constraint. Usar SOLO al escribir en proyecto_usuarios.
_PROYECTO_USUARIOS_ROLES = ("admin", "usc", "cubicador", "externo", "cliente")
def _rol_proyecto_usuarios(role: str) -> str:
    mapped = ROL_MAP.get(role or "", "cubicador")
    return mapped if mapped in _PROYECTO_USUARIOS_ROLES else "cubicador"


# M0.5 — rate limit de login en memoria (una sola instancia en Render): máx. 5
# intentos por IP por minuto. Suficiente contra fuerza bruta; sin dependencias.
_LOGIN_MAX_INTENTOS = 5
_LOGIN_VENTANA_SEG = 60
_login_intentos = {}  # ip -> [timestamps recientes]


def _rate_limit_login(request: Request):
    ip = (request.headers.get("x-forwarded-for") or
          (request.client.host if request.client else "?")).split(",")[0].strip()
    now = time.time()
    recientes = [t for t in _login_intentos.get(ip, []) if now - t < _LOGIN_VENTANA_SEG]
    if len(recientes) >= _LOGIN_MAX_INTENTOS:
        _login_intentos[ip] = recientes
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera un minuto y reintenta.")
    recientes.append(now)
    _login_intentos[ip] = recientes
    if len(_login_intentos) > 1000:  # poda: no crecer sin límite
        for k in [k for k, v in list(_login_intentos.items()) if not v or now - v[-1] > _LOGIN_VENTANA_SEG]:
            _login_intentos.pop(k, None)


@router.post("/auth/login")
def login(request: Request, email: str, password: str):
    _rate_limit_login(request)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT email, password_hash, role, activo FROM users WHERE email = %s",
                (email,),
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    db_email, db_hash, db_role, db_activo = row
    if not db_activo:
        raise HTTPException(status_code=403, detail="Usuario desactivado. Contacta al administrador.")
    if not pwd_context.verify(password, db_hash):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    token = create_token(db_email, db_role)
    audit(db_email, "login", None, "usuario", db_email)
    return {"access_token": token, "token_type": "bearer", "role": db_role}


@router.post("/auth/register")
def register(
    email: str, password: str, nombre: str = "", apellido: str = "",
    role: str = "miembro", area_id: int = None, rol_area: str = "miembro",
    user=Depends(require_admin_or_admin_calidad)
):
    """
    Crea usuarios. Requiere admin o admin_calidad.
    Si se pasa area_id, inserta en area_usuarios con rol_area dado.
    """
    VALID_ROLES = ("admin", "admin_calidad", "jefe_servicio", "miembro", "cliente", "cubicador", "usc", "externo")
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"role debe ser uno de: {', '.join(VALID_ROLES)}")
    if user.get("role") == "admin_calidad" and role in ("admin", "admin_calidad"):
        raise HTTPException(status_code=403, detail="Admin Calidad no puede crear usuarios con rol admin o admin_calidad")
    if rol_area not in ("miembro", "jefe_servicio"):
        rol_area = "miembro"

    password_hash = pwd_context.hash(password)

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO users (email, password_hash, role, nombre, apellido) VALUES (%s,%s,%s,%s,%s) RETURNING id",
                    (email, password_hash, role, nombre.strip() or None, apellido.strip() or None),
                )
                new_user_id = cur.fetchone()[0]
                if area_id:
                    cur.execute(
                        "INSERT INTO area_usuarios (area_id, user_id, rol_area) VALUES (%s,%s,%s) ON CONFLICT (area_id, user_id) DO NOTHING",
                        (area_id, new_user_id, rol_area),
                    )
        audit(user.get("email", "?"), "registrar_usuario", f"{email} como {role}", "usuario", email)
        return {"ok": True}
    except Exception:
        raise HTTPException(status_code=400, detail="Email ya existe")


@router.post("/auth/signup")
def signup():
    """M0.2 — Registro público DESHABILITADO: los usuarios los crea un administrador
    (/auth/register). Se mantiene la ruta para responder con mensaje claro."""
    raise HTTPException(status_code=403, detail="Registro deshabilitado. Solicita tu cuenta a un administrador.")


@router.post("/auth/renew")
def renew(user=Depends(get_current_user)):
    """M0.3 — Renovación silenciosa: emite un token fresco (8h) para la sesión activa.
    El rol viene refrescado desde la BD por get_current_user."""
    return {"access_token": create_token(user["email"], user.get("role", "")),
            "token_type": "bearer", "role": user.get("role")}


@router.get("/me")
def me(user=Depends(get_current_user)):
    email = user.get("email")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, role, nombre, apellido FROM users WHERE email = %s", (email,))
            row = cur.fetchone()
            if not row:
                return {"email": email, "role": user.get("role"), "nombre": None, "apellido": None, "areas": []}
            user_id = row[0]
            cur.execute("""
                SELECT au.area_id, a.nombre, a.slug
                FROM area_usuarios au
                JOIN areas a ON a.id = au.area_id
                WHERE au.user_id = %s AND a.activo = TRUE
                ORDER BY a.nombre
            """, (user_id,))
            areas_rows = cur.fetchall()
    areas = [{"area_id": r[0], "area_nombre": r[1], "area_slug": r[2]} for r in areas_rows]
    return {"email": email, "role": row[1], "nombre": row[2], "apellido": row[3], "areas": areas}


@router.post("/me/password")
def change_my_password(current_password: str, new_password: str, user=Depends(get_current_user)):
    """Cambiar contraseña propia. Requiere contraseña actual."""
    email = user.get("email")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 6 caracteres")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT password_hash FROM users WHERE email = %s", (email,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            if not pwd_context.verify(current_password, row[0]):
                raise HTTPException(status_code=401, detail="Contraseña actual incorrecta")
            new_hash = pwd_context.hash(new_password)
            cur.execute("UPDATE users SET password_hash = %s WHERE email = %s", (new_hash, email))
    audit(email, "cambiar_password_propia", None, "usuario", email)
    return {"ok": True}


@router.post("/bootstrap/create-admin")
def bootstrap_create_admin(email: str, password: str):
    """
    Endpoint de bootstrap seguro:
    - SOLO funciona si la tabla users está vacía (COUNT = 0).
    - Crea un usuario admin.

    Útil para “partir de cero” sin depender de /docs.
    """
    if users_count() > 0:
        raise HTTPException(status_code=403, detail="Bootstrap deshabilitado (ya existen usuarios)")

    password_hash = pwd_context.hash(password)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (email, password_hash, role) VALUES (%s,%s,'admin')",
                (email, password_hash),
            )
    return {"ok": True, "created_role": "admin"}


# ========================= ADMIN: USER MANAGEMENT =========================

VALID_ROLES = ("admin", "admin_calidad", "jefe_servicio", "miembro", "cliente", "cubicador", "usc", "externo")


@router.get("/users/dropdown")
def users_dropdown(user=Depends(get_current_user)):
    """Lista de usuarios activos para dropdowns (nombre apellido). Todos los autenticados.
    Incluye el área de cada usuario (5L.10): mismo criterio que _area_id_de_usuario —
    prioriza el área donde es jefe_servicio, si no la primera. Sirve para mostrar el
    área junto al responsable al crear un reclamo externo (el área se infiere de él)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, email, nombre, apellido, role
                FROM users WHERE activo = TRUE ORDER BY nombre, apellido, email
            """)
            rows = cur.fetchall()
            # Área por usuario: una fila por usuario, priorizando donde es jefe_servicio.
            cur.execute("""
                SELECT DISTINCT ON (au.user_id) au.user_id, a.id, a.nombre
                FROM area_usuarios au
                JOIN areas a ON a.id = au.area_id
                JOIN users u ON u.id = au.user_id
                WHERE a.activo = TRUE
                ORDER BY au.user_id,
                         CASE WHEN u.role = 'jefe_servicio' THEN 0 ELSE 1 END,
                         au.id
            """)
            area_por_user = {r[0]: {"area_id": r[1], "area_nombre": r[2]} for r in cur.fetchall()}
    return {
        "users": [
            {"id": r[0], "email": r[1], "nombre": r[2], "apellido": r[3], "role": r[4],
             "display": ((r[2] or '') + ' ' + (r[3] or '')).strip() or r[1],
             "area_id": (area_por_user.get(r[0]) or {}).get("area_id"),
             "area_nombre": (area_por_user.get(r[0]) or {}).get("area_nombre")}
            for r in rows
        ]
    }


@router.get("/admin/users")
def admin_list_users(admin=Depends(require_admin_or_admin_calidad)):
    """Lista completa de usuarios con todos los campos + áreas asignadas."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, email, role, nombre, apellido, activo, fecha_creacion
                FROM users ORDER BY nombre, apellido, email
            """)
            rows = cur.fetchall()
            # Áreas por usuario en una sola query
            cur.execute("""
                SELECT au.user_id, a.id, a.nombre
                FROM area_usuarios au
                JOIN areas a ON a.id = au.area_id
                WHERE a.activo = TRUE
                ORDER BY a.nombre
            """)
            area_rows = cur.fetchall()

    areas_por_usuario = {}
    for ar in area_rows:
        areas_por_usuario.setdefault(ar[0], []).append(
            {"area_id": ar[1], "area_nombre": ar[2]}
        )

    return {
        "users": [
            {"id": r[0], "email": r[1], "role": r[2], "nombre": r[3], "apellido": r[4],
             "activo": r[5] if r[5] is not None else True,
             "fecha_creacion": r[6],
             "areas": areas_por_usuario.get(r[0], [])}
            for r in rows
        ]
    }


@router.patch("/admin/users/{user_id}/role")
def admin_change_role(user_id: int, role: str, admin=Depends(require_admin_or_admin_calidad)):
    """Cambiar rol de un usuario. Admin o admin_calidad (parcial)."""
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Rol inválido. Válidos: {', '.join(VALID_ROLES)}")
    admin_email = admin.get("email", "?")
    admin_role = admin.get("role", "")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email, role FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            if row[1] == admin_email and role != admin_role:
                raise HTTPException(status_code=400, detail="No puedes cambiarte el rol a ti mismo")
            if admin_role != "admin" and row[2] in ("admin", "admin_calidad"):
                raise HTTPException(status_code=403, detail="Admin Calidad no puede modificar usuarios admin o admin_calidad")
            if admin_role != "admin" and role in ("admin", "admin_calidad"):
                raise HTTPException(status_code=403, detail="Admin Calidad no puede asignar rol admin o admin_calidad")
            cur.execute("UPDATE users SET role = %s WHERE id = %s", (role, user_id))
    audit(admin_email, "cambiar_rol", f"{row[1]}: {role}", "usuario", str(user_id))
    return {"ok": True, "id": user_id, "role": role}


@router.patch("/admin/users/{user_id}/activo")
def admin_toggle_activo(user_id: int, activo: bool, admin=Depends(require_admin_or_admin_calidad)):
    """Activar/desactivar un usuario. Admin o admin_calidad."""
    admin_email = admin.get("email", "?")
    admin_role = admin.get("role", "")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email, role FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            if row[1] == admin_email and not activo:
                raise HTTPException(status_code=400, detail="No puedes desactivarte a ti mismo")
            if admin_role != "admin" and row[2] in ("admin", "admin_calidad"):
                raise HTTPException(status_code=403, detail="Admin Calidad no puede modificar usuarios admin o admin_calidad")
            cur.execute("UPDATE users SET activo = %s WHERE id = %s", (activo, user_id))
    estado = "activado" if activo else "desactivado"
    audit(admin_email, "toggle_usuario", f"{row[1]}: {estado}", "usuario", str(user_id))
    return {"ok": True, "id": user_id, "activo": activo}


@router.patch("/admin/users/{user_id}/password")
def admin_reset_password(user_id: int, password: str, admin=Depends(require_admin_or_admin_calidad)):
    """Resetear contraseña de un usuario. Admin o admin_calidad (parcial)."""
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email, role FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            if admin.get("role") != "admin" and row[2] in ("admin", "admin_calidad"):
                raise HTTPException(status_code=403, detail="Admin Calidad no puede resetear password de admin o admin_calidad")
            password_hash = pwd_context.hash(password)
            cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user_id))
    audit(admin.get("email", "?"), "reset_password", row[1], "usuario", str(user_id))
    return {"ok": True, "id": user_id}


@router.patch("/admin/users/{user_id}/nombre")
def admin_change_nombre(user_id: int, nombre: str = "", apellido: str = "", admin=Depends(require_admin_or_admin_calidad)):
    """Cambiar nombre y/o apellido de un usuario. Admin o admin_calidad."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            cur.execute("UPDATE users SET nombre = %s, apellido = %s WHERE id = %s",
                        (nombre.strip() or None, apellido.strip() or None, user_id))
    audit(admin.get("email", "?"), "cambiar_nombre", f"{row[1]}: {nombre} {apellido}", "usuario", str(user_id))
    return {"ok": True, "id": user_id}


@router.delete("/admin/users/{user_id}")
def admin_delete_user(user_id: int, admin=Depends(require_admin_or_admin_calidad)):
    """Eliminar un usuario. Admin o admin_calidad (parcial). No puede eliminarse a sí mismo."""
    admin_email = admin.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email, role FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            if row[1] == admin_email:
                raise HTTPException(status_code=400, detail="No puedes eliminarte a ti mismo")
            if admin.get("role") != "admin" and row[2] in ("admin", "admin_calidad"):
                raise HTTPException(status_code=403, detail="Admin Calidad no puede eliminar usuarios admin o admin_calidad")
            cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
    audit(admin_email, "eliminar_usuario", row[1], "usuario", str(user_id))
    return {"ok": True, "id": user_id}