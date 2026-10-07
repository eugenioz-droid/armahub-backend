"""
mailer.py
---------
Helper único de correo transversal para ArmaHub.

Todas las calugas que necesiten enviar correos importan este módulo.
No se construyen helpers de correo separados por caluga.

DOS FORMAS DE ENVIAR, y la elección no es un detalle técnico (7-oct):

  · SMTP de un buzón que ya existe (Gmail, Outlook…). NO necesita dominio propio, ni
    registros DNS, ni pedirle nada a TI, y no cuesta. El correo sale DE VERDAD desde ese
    buzón, así que su SPF y su DKIM son los del proveedor y están bien: no es suplantación
    y no cae en no deseados por eso. El remitente es la dirección de ese buzón.
  · API de Resend. Manda desde un dominio propio —queda `no-reply@loquesea`— pero exige
    verificar ese dominio con registros DNS. Con el remitente de pruebas
    (`onboarding@resend.dev`) Resend entrega SÓLO al dueño de la cuenta.

POR QUÉ NO SE PUEDE MANDAR COMO @armacero.cl SIN TI. Medido el 7-oct: ese dominio publica
`v=spf1 ... -all` y `v=DMARC1; p=reject; pct=100; aspf=s`. Un correo que diga venir de ahí
y no salga de sus servidores autorizados se RECHAZA —no es que llegue a spam—. Para usarlo
hay que agregar los registros de Resend en su DNS, que administra TI.

Si están las dos configuraciones manda SMTP: es la que no depende de nadie más.

Configuración (env vars en Render):
    SMTP_HOST   - p. ej. smtp.gmail.com
    SMTP_PORT   - 587 (STARTTLS, por defecto) o 465 (SSL)
    SMTP_USER   - la dirección del buzón
    SMTP_PASS   - contraseña de aplicación (en Gmail: Cuenta → Seguridad → Contraseñas
                  de aplicaciones; la normal no sirve si hay verificación en dos pasos)
    MAIL_FROM   - remitente; si no está, se usa SMTP_USER
    MAIL_NOMBRE - nombre visible del remitente (por defecto «ArmaHub»)

    RESEND_API_KEY - alternativa: API key de Resend (re_...)
    MAIL_FROM      - con Resend, la dirección de un dominio verificado allá

Uso:
    from .mailer import send_email, is_configured

    send_email(
        to=["persona@ejemplo.com"],
        subject="Asunto",
        html="<p>Cuerpo HTML</p>",
    )
"""

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
MAIL_FROM = os.getenv("MAIL_FROM", "onboarding@resend.dev")


def _cfg(nombre: str, por_defecto: str = "") -> str:
    """Se lee en cada llamada y no al importar: en Render una variable se cambia y se
    reinicia, pero en local se cambia y se vuelve a probar sin reiniciar nada."""
    return (os.getenv(nombre, "") or por_defecto).strip()


def smtp_configurado() -> bool:
    return bool(_cfg("SMTP_HOST") and _cfg("SMTP_USER") and _cfg("SMTP_PASS"))


def resend_configurado() -> bool:
    return bool(_cfg("RESEND_API_KEY", RESEND_API_KEY))


def is_configured() -> bool:
    """True si hay por dónde mandar: SMTP o Resend."""
    return smtp_configurado() or resend_configurado()


def remitente() -> str:
    """La dirección desde la que sale el correo. Con SMTP, la del buzón: mandar desde una
    dirección distinta a la autenticada es justo lo que los filtros tratan como
    suplantación."""
    if smtp_configurado():
        return _cfg("MAIL_FROM") or _cfg("SMTP_USER")
    return _cfg("MAIL_FROM", MAIL_FROM)


def _de() -> str:
    """El remitente con nombre visible: «ArmaHub <correo>»."""
    nombre = _cfg("MAIL_NOMBRE", "ArmaHub")
    direccion = remitente()
    return "%s <%s>" % (nombre, direccion) if nombre else direccion


def _enviar_smtp(to: list, subject: str, html: str, reply_to: Optional[str],
                 attachments: Optional[list]) -> dict:
    import smtplib
    import ssl
    from email.message import EmailMessage

    msg = EmailMessage()
    msg["From"] = _de()
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    if reply_to:
        msg["Reply-To"] = reply_to
    # Un alternativo en texto plano: sin él, varios filtros suben el puntaje de spam de un
    # correo que es sólo HTML.
    import re as _re
    texto = _re.sub(r"<[^>]+>", " ", html)
    msg.set_content(_re.sub(r"\s+", " ", texto).strip() or "Ver este correo en HTML.")
    msg.add_alternative(html, subtype="html")
    for att in (attachments or []):
        msg.add_attachment(att["content"], maintype="application", subtype="octet-stream",
                           filename=att["filename"])

    host, puerto = _cfg("SMTP_HOST"), int(_cfg("SMTP_PORT", "587") or 587)
    usuario, clave = _cfg("SMTP_USER"), _cfg("SMTP_PASS")
    contexto = ssl.create_default_context()
    if puerto == 465:
        with smtplib.SMTP_SSL(host, puerto, context=contexto, timeout=30) as s:
            s.login(usuario, clave)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, puerto, timeout=30) as s:
            s.starttls(context=contexto)
            s.login(usuario, clave)
            s.send_message(msg)
    logger.info("Correo enviado por SMTP a %s", to)
    return {"id": None, "via": "smtp"}


def _enviar_resend(to: list, subject: str, html: str, reply_to: Optional[str],
                   attachments: Optional[list]) -> dict:
    try:
        import resend as _resend
    except ImportError:
        raise RuntimeError(
            "Librería 'resend' no instalada. Agregar resend a requirements.txt."
        )

    _resend.api_key = _cfg("RESEND_API_KEY", RESEND_API_KEY)

    params: dict = {
        "from": _de(),
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

    email = _resend.Emails.send(params)
    logger.info("Correo enviado por Resend a %s — id: %s", to, email.get("id"))
    return dict(email, via="resend")


def send_email(
    to: list[str],
    subject: str,
    html: str,
    reply_to: Optional[str] = None,
    attachments: Optional[list] = None,
) -> dict:
    """
    Envía un correo por SMTP o por Resend, lo que esté configurado (SMTP manda).

    Args:
        attachments: lista opcional de adjuntos. Cada uno: dict con
            {"filename": str, "content": bytes}. Ej: el PDF de un informe.

    Retorna el dict de respuesta con `via` y, en Resend, el `id` del mensaje.
    Lanza RuntimeError si no hay correo configurado o si el envío falla.
    """
    if not is_configured():
        raise RuntimeError(
            "Correo no configurado. Falta SMTP_HOST/SMTP_USER/SMTP_PASS o RESEND_API_KEY."
        )
    try:
        if smtp_configurado():
            return _enviar_smtp(to, subject, html, reply_to, attachments)
        return _enviar_resend(to, subject, html, reply_to, attachments)
    except RuntimeError:
        raise
    except Exception as exc:
        logger.error("Error al enviar correo a %s: %s", to, exc)
        raise RuntimeError(f"Error al enviar correo: {exc}") from exc


def health() -> dict:
    """Estado del correo para el health check de admin. Dice POR DÓNDE sale y DESDE QUÉ
    dirección: «configurado» no alcanza —con el remitente de pruebas de Resend el correo
    sólo le llega al dueño de la cuenta, y eso se ve como si estuviera todo bien—."""
    if smtp_configurado():
        return {"mail": "ok", "via": "smtp", "from": remitente()}
    if not resend_configurado():
        return {"mail": "not-configured"}
    try:
        import resend  # noqa: F401
    except ImportError:
        return {"mail": "no-resend-lib"}
    return {"mail": "ok", "via": "resend", "from": remitente()}
