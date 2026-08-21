"""
ui.py (modularizado)
-----
UI con estructura de tabs por rol.
CSS y JS en archivos estáticos (static/css/app.css, static/js/app.js).
HTML modularizado en templates/ con Jinja2 includes.

Incluye:
- GET /ui/login      (login)
- GET /ui            (app con tabs: Obras, Bar Manager, Dashboards, Pedidos, Exportación)
- GET /ui/bootstrap  (crear primer admin si no hay usuarios)
"""

import os
import time
from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from jinja2 import Environment, FileSystemLoader
from .db import users_count

_start_ts = str(int(time.time()))

# VERSION VISIBLE (22-ago). Hasta hoy no habia forma de saber que version tiene un
# usuario en pantalla: cuando alguien reportaba "no veo el cambio" no se podia
# distinguir un despliegue pendiente de un cache del navegador de un cambio que
# simplemente no estaba donde el creia. Render publica el commit en el entorno; si no
# esta (local), se cae a la hora de arranque, que ya se usaba para el cache-bust.
_BUILD = (os.environ.get("RENDER_GIT_COMMIT") or "")[:7] or ("local-" + _start_ts)

router = APIRouter()

_templates_dir = os.path.join(os.path.dirname(__file__), "templates")
_env = Environment(loader=FileSystemLoader(_templates_dir))


@router.get("/ui/login", response_class=HTMLResponse)
def ui_login():
    tmpl = _env.get_template("login.html")
    return HTMLResponse(tmpl.render())

@router.get("/ui/bootstrap", response_class=HTMLResponse)
def ui_bootstrap():
    if users_count() > 0:
        return HTMLResponse(
            "<h3>Bootstrap deshabilitado: ya existen usuarios.</h3><a href='/ui/login'>Volver</a>",
            status_code=403,
        )
    tmpl = _env.get_template("bootstrap.html")
    return HTMLResponse(tmpl.render())

@router.get("/ui", response_class=HTMLResponse)
def ui_app():
    tmpl = _env.get_template("app.html")
    html = tmpl.render(cache_bust=_start_ts, build=_BUILD)
    return HTMLResponse(
        content=html,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    )
