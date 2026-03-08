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
from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from jinja2 import Environment, FileSystemLoader
from .db import users_count

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
    html = tmpl.render()
    return HTMLResponse(
        content=html,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    )
