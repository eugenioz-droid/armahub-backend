"""
Lo que comparten los módulos de ArmaScanner: nombres y fechas para mostrar, borrar archivos en R2, los
avisos de la campana y el cuerpo {obra, plano} de varias rutas.
"""

import logging

from pydantic import BaseModel


logger = logging.getLogger("armahub.armascanner")


AVISO = "armascanner_reemplazo"         # tipo de aviso en la campana (notifications.TIPO_EVENTO_LABELS)
AVISO_DESARROLLO = "armascanner_desarrollo"


def _cuando(ts) -> str:
    """«20-11 10:30», en la hora de Chile."""
    if not ts:
        return ""
    try:
        from zoneinfo import ZoneInfo
        ts = ts.astimezone(ZoneInfo("America/Santiago"))
    except Exception:
        pass
    return ts.strftime("%d-%m %H:%M")


def _nombres(cur, emails) -> dict:
    """{correo: «Nombre Apellido»} (el correo, si el usuario no tiene nombre)."""
    emails = sorted({e for e in emails if e})
    if not emails:
        return {}
    cur.execute("SELECT email, nombre, apellido FROM users WHERE email = ANY(%s)", (emails,))
    return {e: ((n or "") + " " + (a or "")).strip() or e for e, n, a in cur.fetchall()}


def _borrar(*claves):
    """Borra de R2 archivos que ya nadie usa. Va siempre después de que la base confirmó; si R2
    falla, el archivo queda suelto y se anota, pero la operación ya hecha no se cae por eso."""
    from .. import storage
    for clave in claves:
        if clave:
            try:
                storage.delete_file(clave)
            except Exception as e:
                logger.warning("R2: no se pudo borrar %s (%s)", clave, e)


def _avisar(destinatarios, mensaje: str, tipo: str = AVISO):
    """Aviso en la campana de ArmaHub, después de confirmada la operación. Si falla queda en el log:
    lo ya hecho no se cae por un aviso."""
    destinatarios = [d for d in dict.fromkeys(destinatarios or []) if d]
    if not destinatarios:
        return
    try:
        from ..notifications import crear_notificacion
        crear_notificacion(tipo, None, mensaje, destinatarios_extra=destinatarios)
    except Exception as e:
        logger.warning("Aviso de ArmaScanner no enviado a %s: %s", destinatarios, e)


class PlanoEnLinea(BaseModel):
    obra: str
    plano: str


# Lo que vale un enlace de descarga de R2 (planos, reportes, versiones).
DESCARGA_SEGUNDOS = 600
