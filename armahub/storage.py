"""
storage.py
----------
Abstracción de almacenamiento de archivos sobre Cloudflare R2 (compatible S3).

Reemplaza el almacenamiento de binarios en PostgreSQL (BYTEA) por archivos en R2,
dejando en la base de datos solo la metadata (storage_key).

Organización por carpetas dentro de un único bucket (ver decisión 0.3 del programa):
    reclamos/registro/{reclamo_id}/{archivo}
    reclamos/analisis/{reclamo_id}/{archivo}
    obras/{id}/planos/{archivo}
    obras/{id}/documentos/{archivo}
    certificados/{archivo}
    terreno/{obra}/fotos/{archivo}

Configuración (env vars):
    R2_ACCOUNT_ID         - ID de cuenta Cloudflare
    R2_ACCESS_KEY_ID      - Access key del API token R2
    R2_SECRET_ACCESS_KEY  - Secret key del API token R2
    R2_BUCKET             - Nombre del bucket (ej: "armahub")
    R2_PUBLIC_BASE_URL    - (opcional) base URL pública si el bucket expone dominio

Si R2 no está configurado, `is_configured()` devuelve False y las operaciones
lanzan RuntimeError con un mensaje claro. El import del módulo NUNCA rompe el
arranque del sistema aunque falten credenciales o boto3.
"""

import os
import uuid
from typing import Optional

try:
    import boto3
    from botocore.config import Config as _BotoConfig
    from botocore.exceptions import ClientError
    _BOTO_AVAILABLE = True
except Exception:  # boto3 no instalado aún
    _BOTO_AVAILABLE = False
    ClientError = Exception  # type: ignore


# --- Configuración desde entorno ---
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.getenv("R2_BUCKET", "")
R2_PUBLIC_BASE_URL = os.getenv("R2_PUBLIC_BASE_URL", "").rstrip("/")

# R2 expone un endpoint S3 por cuenta
_R2_ENDPOINT = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com" if R2_ACCOUNT_ID else ""

_client = None  # lazy singleton


def is_configured() -> bool:
    """True si hay credenciales R2 y boto3 disponible."""
    return bool(
        _BOTO_AVAILABLE
        and R2_ACCOUNT_ID
        and R2_ACCESS_KEY_ID
        and R2_SECRET_ACCESS_KEY
        and R2_BUCKET
    )


def _get_client():
    """Devuelve el cliente S3/R2 (lazy). Lanza RuntimeError si no está configurado."""
    global _client
    if not is_configured():
        raise RuntimeError(
            "Storage R2 no configurado. Faltan boto3 o las env vars "
            "R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET."
        )
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=_R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            config=_BotoConfig(signature_version="s3v4"),
            region_name="auto",  # R2 usa "auto"
        )
    return _client


def build_key(*parts: str, filename: Optional[str] = None, unique: bool = True) -> str:
    """
    Construye una key de storage a partir de partes de ruta.
    Ej: build_key("reclamos", "registro", "123", filename="foto.jpg")
        -> "reclamos/registro/123/3f9a..._foto.jpg"

    Si unique=True antepone un uuid corto al filename para evitar colisiones.
    """
    clean = [str(p).strip("/").replace("..", "") for p in parts if p is not None and str(p) != ""]
    base = "/".join(clean)
    if filename:
        safe_name = os.path.basename(filename).replace("/", "_").replace("\\", "_")
        if unique:
            safe_name = f"{uuid.uuid4().hex[:8]}_{safe_name}"
        base = f"{base}/{safe_name}" if base else safe_name
    return base


def upload_file(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    """Sube bytes a R2 bajo `key`. Devuelve la key."""
    client = _get_client()
    client.put_object(Bucket=R2_BUCKET, Key=key, Body=data, ContentType=content_type)
    return key


def download_file(key: str) -> bytes:
    """Descarga el contenido de `key` como bytes."""
    client = _get_client()
    resp = client.get_object(Bucket=R2_BUCKET, Key=key)
    return resp["Body"].read()


def delete_file(key: str) -> None:
    """Elimina el objeto `key`. No falla si no existe."""
    client = _get_client()
    try:
        client.delete_object(Bucket=R2_BUCKET, Key=key)
    except ClientError:
        # idempotente: borrar algo inexistente no es error
        pass


def generate_presigned_url(key: str, expires: int = 3600, content_type: Optional[str] = None) -> str:
    """
    Genera una URL temporal firmada para LECTURA de `key`.
    Sirve para mostrar imágenes/planos en el navegador sin exponer credenciales
    ni hacer el objeto público. `expires` en segundos (default 1h).
    """
    client = _get_client()
    params = {"Bucket": R2_BUCKET, "Key": key}
    if content_type:
        params["ResponseContentType"] = content_type
    return client.generate_presigned_url("get_object", Params=params, ExpiresIn=expires)


def public_url(key: str) -> Optional[str]:
    """
    URL pública directa si el bucket tiene dominio público configurado
    (R2_PUBLIC_BASE_URL). Si no, devuelve None y se debe usar presigned URL.
    """
    if R2_PUBLIC_BASE_URL:
        return f"{R2_PUBLIC_BASE_URL}/{key}"
    return None


def health() -> dict:
    """Estado del storage para el health check de admin (tarea 5.7 / 3.x)."""
    if not _BOTO_AVAILABLE:
        return {"storage": "no-boto3"}
    if not is_configured():
        return {"storage": "not-configured"}
    try:
        client = _get_client()
        client.head_bucket(Bucket=R2_BUCKET)
        return {"storage": "ok", "bucket": R2_BUCKET}
    except Exception as e:
        return {"storage": "error", "detail": str(e)}
