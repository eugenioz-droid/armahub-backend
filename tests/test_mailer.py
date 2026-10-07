"""EL CORREO: por dónde sale y desde qué dirección (7-oct).

Por qué existe este test. El correo estuvo meses "configurado" y no llegaba a nadie: con
el remitente de pruebas de Resend (`onboarding@resend.dev`) sólo se entrega al dueño de la
cuenta, y el health decía `mail: ok`. Un canal de avisos que miente sobre su estado es peor
que uno apagado, porque nadie lo va a revisar.

Y no se puede mandar como @armacero.cl sin pasar por TI: ese dominio publica SPF `-all` y
DMARC `p=reject` con alineación estricta, así que un correo que diga venir de ahí y no
salga de sus servidores se RECHAZA. Por eso el módulo soporta SMTP de un buzón que ya
existe: sale de verdad desde ese buzón, sin dominio propio y sin pedirle nada a nadie.

Correr con: python tests/test_mailer.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

fallos = 0


def check(nombre, cond):
    global fallos
    print(("  OK  " if cond else "  XX  ") + nombre)
    if not cond:
        fallos += 1


VARS = ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "MAIL_NOMBRE",
        "RESEND_API_KEY")


def limpiar():
    for v in VARS:
        os.environ.pop(v, None)


limpiar()
from armahub import mailer  # noqa: E402

print("TEST: el correo")

print("\n1. Sin configurar, lo dice y no finge")
limpiar()
check("no está configurado", mailer.is_configured() is False
      and mailer.health() == {"mail": "not-configured"})
try:
    mailer.send_email(to=["x@y.cl"], subject="s", html="<p>h</p>")
    check("...y mandar revienta con un mensaje que dice qué falta", False)
except RuntimeError as e:
    check("...y mandar revienta con un mensaje que dice qué falta",
          "SMTP_HOST" in str(e) and "RESEND_API_KEY" in str(e))

print("\n2. SMTP: un buzón que ya existe, sin dominio ni DNS")
limpiar()
os.environ.update(SMTP_HOST="smtp.gmail.com", SMTP_USER="alguien@gmail.com", SMTP_PASS="clave-de-app")
check("queda configurado", mailer.is_configured() and mailer.smtp_configurado())
check("...el health dice por dónde sale y desde qué dirección",
      mailer.health() == {"mail": "ok", "via": "smtp", "from": "alguien@gmail.com"})
check("el remitente es el BUZÓN autenticado, no otro: mandar desde otra dirección es lo "
      "que los filtros tratan como suplantación", mailer.remitente() == "alguien@gmail.com")
os.environ["MAIL_NOMBRE"] = "ArmaHub · Calidad"
check("...con nombre visible delante", mailer._de() == "ArmaHub · Calidad <alguien@gmail.com>")

print("\n3. Faltando una pieza, SMTP no se da por configurado")
for falta in ("SMTP_HOST", "SMTP_USER", "SMTP_PASS"):
    limpiar()
    os.environ.update(SMTP_HOST="h", SMTP_USER="u", SMTP_PASS="p")
    os.environ.pop(falta)
    check("...sin %s no se intenta mandar por SMTP" % falta, mailer.smtp_configurado() is False)

print("\n4. Resend sigue sirviendo, y el remitente de pruebas se reconoce")
limpiar()
os.environ["RESEND_API_KEY"] = "re_lo_que_sea"
h = mailer.health()
check("sale por Resend", h.get("mail") == "ok" and h.get("via") == "resend")
check("...y sin MAIL_FROM queda el de pruebas, que sólo entrega al dueño de la cuenta",
      h.get("from") == "onboarding@resend.dev")
os.environ["MAIL_FROM"] = "no-reply@midominio.cl"
check("...con dominio propio, ése", mailer.health().get("from") == "no-reply@midominio.cl")

print("\n5. Con los dos configurados manda SMTP: es el que no depende de nadie más")
limpiar()
os.environ.update(SMTP_HOST="smtp.gmail.com", SMTP_USER="alguien@gmail.com",
                  SMTP_PASS="clave", RESEND_API_KEY="re_x")
check("gana SMTP", mailer.health().get("via") == "smtp")

print("\n6. El mensaje que se arma")
limpiar()
os.environ.update(SMTP_HOST="h", SMTP_USER="u@g.cl", SMTP_PASS="p")
enviados = []


class _SMTPFalso:
    def __init__(self, host, puerto, timeout=None):
        enviados.append({"host": host, "puerto": puerto})

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self, context=None):
        enviados[-1]["starttls"] = True

    def login(self, u, c):
        enviados[-1]["login"] = u

    def send_message(self, msg):
        enviados[-1]["msg"] = msg


import smtplib  # noqa: E402
smtplib.SMTP = _SMTPFalso
r = mailer.send_email(to=["a@b.cl", "c@d.cl"], subject="Auditoría A-1 asignada",
                      html="<p>Hola <b>mundo</b></p>", reply_to="jefe@g.cl",
                      attachments=[{"filename": "informe.pdf", "content": b"%PDF-1.4 x"}])
e = enviados[-1]
msg = e["msg"]
check("va al servidor y puerto configurados, con STARTTLS y login",
      e["host"] == "h" and e["puerto"] == 587 and e.get("starttls") and e["login"] == "u@g.cl")
check("el destinatario, el asunto y el reply-to van en la cabecera",
      msg["To"] == "a@b.cl, c@d.cl" and msg["Subject"] == "Auditoría A-1 asignada"
      and msg["Reply-To"] == "jefe@g.cl")
partes = [p.get_content_type() for p in msg.walk()]
check("lleva HTML y también texto plano: sólo-HTML sube el puntaje de spam",
      "text/html" in partes and "text/plain" in partes)
check("...y el texto plano es el HTML sin etiquetas, no un relleno",
      "Hola mundo" in msg.get_body(preferencelist=("plain",)).get_content())
check("el adjunto viaja con su nombre", any(
    p.get_filename() == "informe.pdf" for p in msg.walk()))
check("y se informa por dónde salió", r.get("via") == "smtp")

limpiar()
print("\nFALLOS: %d" % fallos if fallos else "\nTODO OK")
sys.exit(1 if fallos else 0)
