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
import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext

from .db import get_conn, users_count, audit

router = APIRouter()

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = "HS256"

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
auth_scheme = HTTPBearer()


def create_token(email: str, role: str) -> str:
    return jwt.encode({"email": email, "role": role}, JWT_SECRET, algorithm=JWT_ALG)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(auth_scheme)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return payload  # {email, role}
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido")


def require_admin(user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Solo admin")
    return user


def require_admin_or_coordinador(user=Depends(get_current_user)):
    if user.get("role") not in ("admin", "coordinador"):
        raise HTTPException(status_code=403, detail="Solo admin o coordinador")
    return user


@router.post("/auth/login")
def login(email: str, password: str):
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
def register(email: str, password: str, nombre: str = "", apellido: str = "", role: str = "usc", user=Depends(require_admin_or_coordinador)):
    """
    Crea usuarios. Requiere admin o coordinador.
    Coordinador solo puede crear usuarios con rol 'usc'.
    """
    VALID_ROLES = ("admin", "coordinador", "cubicador", "usc", "externo", "cliente")
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"role debe ser uno de: {', '.join(VALID_ROLES)}")
    # Coordinador solo puede crear usuarios USC
    if user.get("role") == "coordinador" and role != "usc":
        raise HTTPException(status_code=403, detail="Coordinador solo puede crear usuarios con rol USC")

    password_hash = pwd_context.hash(password)

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO users (email, password_hash, role, nombre, apellido) VALUES (%s,%s,%s,%s,%s)",
                    (email, password_hash, role, nombre.strip() or None, apellido.strip() or None),
                )
        audit(user.get("email", "?"), "registrar_usuario", f"{email} como {role}", "usuario", email)
        return {"ok": True}
    except Exception:
        raise HTTPException(status_code=400, detail="Email ya existe")


@router.post("/auth/signup")
def signup(email: str, password: str, nombre: str = ""):
    """
    Registro público. Crea usuario con rol 'usc'.
    El admin puede cambiar el rol después desde el panel.
    """
    email = email.strip().lower()
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email y contraseña son requeridos")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")

    password_hash = pwd_context.hash(password)

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO users (email, password_hash, role) VALUES (%s, %s, 'usc')",
                    (email, password_hash),
                )
        audit(email, "signup", "auto-registro usc", "usuario", email)
        token = create_token(email, "usc")
        return {"ok": True, "access_token": token, "token_type": "bearer", "role": "usc"}
    except Exception:
        raise HTTPException(status_code=400, detail="Este email ya está registrado")


@router.get("/me")
def me(user=Depends(get_current_user)):
    email = user.get("email")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT role, nombre, apellido FROM users WHERE email = %s", (email,))
            row = cur.fetchone()
    if not row:
        return {"email": email, "role": user.get("role"), "nombre": None, "apellido": None}
    return {"email": email, "role": row[0], "nombre": row[1], "apellido": row[2]}


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

VALID_ROLES = ("admin", "coordinador", "cubicador", "usc", "externo", "cliente")


@router.get("/users/dropdown")
def users_dropdown(user=Depends(get_current_user)):
    """Lista de usuarios activos para dropdowns (nombre apellido). Todos los autenticados."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, email, nombre, apellido, role
                FROM users WHERE activo = TRUE ORDER BY nombre, apellido, email
            """)
            rows = cur.fetchall()
    return {
        "users": [
            {"id": r[0], "email": r[1], "nombre": r[2], "apellido": r[3], "role": r[4],
             "display": ((r[2] or '') + ' ' + (r[3] or '')).strip() or r[1]}
            for r in rows
        ]
    }


@router.get("/admin/users")
def admin_list_users(admin=Depends(require_admin_or_coordinador)):
    """Lista completa de usuarios con todos los campos. Admin o coordinador."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, email, role, nombre, apellido, activo, fecha_creacion
                FROM users ORDER BY id
            """)
            rows = cur.fetchall()
    return {
        "users": [
            {"id": r[0], "email": r[1], "role": r[2], "nombre": r[3], "apellido": r[4],
             "activo": r[5] if r[5] is not None else True,
             "fecha_creacion": r[6]}
            for r in rows
        ]
    }


@router.patch("/admin/users/{user_id}/role")
def admin_change_role(user_id: int, role: str, admin=Depends(require_admin)):
    """Cambiar rol de un usuario. Solo admin."""
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Rol inválido. Válidos: {', '.join(VALID_ROLES)}")
    admin_email = admin.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            if row[1] == admin_email and role != "admin":
                raise HTTPException(status_code=400, detail="No puedes quitarte el rol admin a ti mismo")
            cur.execute("UPDATE users SET role = %s WHERE id = %s", (role, user_id))
    audit(admin_email, "cambiar_rol", f"{row[1]}: {role}", "usuario", str(user_id))
    return {"ok": True, "id": user_id, "role": role}


@router.patch("/admin/users/{user_id}/activo")
def admin_toggle_activo(user_id: int, activo: bool, admin=Depends(require_admin_or_coordinador)):
    """Activar/desactivar un usuario. Admin o coordinador."""
    admin_email = admin.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            if row[1] == admin_email and not activo:
                raise HTTPException(status_code=400, detail="No puedes desactivarte a ti mismo")
            cur.execute("UPDATE users SET activo = %s WHERE id = %s", (activo, user_id))
    estado = "activado" if activo else "desactivado"
    audit(admin_email, "toggle_usuario", f"{row[1]}: {estado}", "usuario", str(user_id))
    return {"ok": True, "id": user_id, "activo": activo}


@router.patch("/admin/users/{user_id}/password")
def admin_reset_password(user_id: int, password: str, admin=Depends(require_admin_or_coordinador)):
    """Resetear contraseña de un usuario. Admin o coordinador."""
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            password_hash = pwd_context.hash(password)
            cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user_id))
    audit(admin.get("email", "?"), "reset_password", row[1], "usuario", str(user_id))
    return {"ok": True, "id": user_id}


@router.patch("/admin/users/{user_id}/nombre")
def admin_change_nombre(user_id: int, nombre: str = "", apellido: str = "", admin=Depends(require_admin_or_coordinador)):
    """Cambiar nombre y/o apellido de un usuario. Admin o coordinador."""
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
def admin_delete_user(user_id: int, admin=Depends(require_admin)):
    """Eliminar un usuario. Solo admin. No puede eliminarse a sí mismo."""
    admin_email = admin.get("email", "?")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            if row[1] == admin_email:
                raise HTTPException(status_code=400, detail="No puedes eliminarte a ti mismo")
            cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
    audit(admin_email, "eliminar_usuario", row[1], "usuario", str(user_id))
    return {"ok": True, "id": user_id}