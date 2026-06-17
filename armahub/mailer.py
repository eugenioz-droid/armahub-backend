"""
mailer.py
---------
Helper único de correo transversal para ArmaHub (usa Resend API).

Todas las calugas que necesiten enviar correos importan este módulo.
No se construyen helpers de correo separados por caluga.

Configuración (env vars en Render):
    RESEND_API_KEY  - API key de Resend (empieza con re_...)
    MAIL_FROM       - dirección remitente (ej: noreply@armacero.cl)
                      Si no está definida, usa onboarding@resend.dev (solo para pruebas)

Uso:
    from .mailer import send_email, is_configured

    send_email(
        to=["persona@ejemplo.com"],
        subject="Asunto",
        html="<p>Cuerpo HTML</p>",
    )
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
MAIL_FROM = os.getenv("MAIL_FROM", "onboarding@resend.dev")


def is_configured() -> bool:
    """True si hay API key de Resend disponible."""
    return bool(RESEND_API_KEY)


def send_email(
    to: list[str],
    subject: str,
    html: str,
    reply_to: Optional[str] = None,
    attachments: Optional[list] = None,
) -> dict:
    """
    Envía un correo vía Resend API.

    Args:
        attachments: lista opcional de adjuntos. Cada uno: dict con
            {"filename": str, "content": bytes}. El contenido (bytes) se
            codifica a base64 como espera Resend. Ej: el PDF de un informe.

    Retorna el dict de respuesta de Resend con el campo `id` del mensaje.
    Lanza RuntimeError si Resend no está configurado o si el envío falla.
    """
    if not is_configured():
        raise RuntimeError(
            "Correo no configurado. Falta la env var RESEND_API_KEY en Render."
        )

    try:
        import resend as _resend
    except ImportError:
        raise RuntimeError(
            "Librería 'resend' no instalada. Agregar resend a requirements.txt."
        )

    _resend.api_key = RESEND_API_KEY

    params: dict = {
        "from": MAIL_FROM,
        "to": to,
        "subject": subject,
        "html": html,
    }
    if reply_to:
        params["reply_to"] = reply_to

    if attachments:
        import base64
        params["attachments"] = [
            {
                "filename": att["filename"],
                "content": base64.b64encode(att["content"]).decode("ascii"),
            }
            for att in attachments
        ]

    try:
        email = _resend.Emails.send(params)
        logger.info("Correo enviado a %s — id: %s", to, email.get("id"))
        return email
    except Exception as exc:
        logger.error("Error al enviar correo a %s: %s", to, exc)
        raise RuntimeError(f"Error al enviar correo: {exc}") from exc


def health() -> dict:
    """Estado del correo para el health check de admin."""
    if not is_configured():
        return {"mail": "not-configured"}
    try:
        import resend  # noqa: F401
        return {"mail": "ok", "from": MAIL_FROM}
    except ImportError:
        return {"mail": "no-resend-lib"}
