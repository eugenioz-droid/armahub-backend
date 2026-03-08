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

from .db import get_conn, users_count

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


@router.post("/auth/login")
def login(email: str, password: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT email, password_hash, role FROM users WHERE email = %s",
                (email,),
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    db_email, db_hash, db_role = row
    if not pwd_context.verify(password, db_hash):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    token = create_token(db_email, db_role)
    return {"access_token": token, "token_type": "bearer", "role": db_role}


@router.post("/auth/register")
def register(email: str, password: str, role: str = "operador", admin=Depends(require_admin)):
    """
    Crea usuarios. Requiere admin.

    Esto es tu “Paso A” (crear usuarios desde UI) pero el endpoint debe ser seguro.
    La UI lo llama con token.
    """
    VALID_ROLES = ("admin", "coordinador", "cubicador", "operador", "cliente")
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"role debe ser uno de: {', '.join(VALID_ROLES)}")

    password_hash = pwd_context.hash(password)

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO users (email, password_hash, role) VALUES (%s,%s,%s)",
                    (email, password_hash, role),
                )
        return {"ok": True}
    except Exception:
        raise HTTPException(status_code=400, detail="Email ya existe")


@router.get("/me")
def me(user=Depends(get_current_user)):
    return {"email": user.get("email"), "role": user.get("role")}


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