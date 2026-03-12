"""
main.py
-------
Punto de entrada de FastAPI.

Responsabilidades:
- Crear la app FastAPI
- Inicializar DB (tablas/índices)
- Montar routers (auth, importer, barras, ui)

En Render, lo ideal es arrancar con:
    uvicorn armahub.main:app --host 0.0.0.0 --port 10000
"""

from fastapi import FastAPI, Response
from fastapi.staticfiles import StaticFiles
import os

from .db import init_db
from .auth import router as auth_router
from .importer import router as importer_router
from .barras import router as barras_router
from .ui import router as ui_router
from .admin import router as admin_router
from .export import router as export_router
from .pedidos import router as pedidos_router
from .constructoras import router as constructoras_router
from .calculistas import router as calculistas_router
from .reclamos import router as reclamos_router


def create_app() -> FastAPI:
    app = FastAPI(title="ArmaHub Backend")

    init_db()

    app.include_router(auth_router)
    app.include_router(importer_router)
    app.include_router(barras_router)
    app.include_router(ui_router)
    app.include_router(admin_router)
    app.include_router(export_router)
    app.include_router(pedidos_router)
    app.include_router(constructoras_router)
    app.include_router(calculistas_router)
    app.include_router(reclamos_router)
    
    # Servir archivos estáticos (CSS, JS, imágenes)
    static_path = os.path.join(os.path.dirname(__file__), "static")
    if os.path.exists(static_path):
        app.mount("/static", StaticFiles(directory=static_path), name="static")

    @app.api_route("/", methods=["GET", "HEAD"])
    def root():
        return {"ok": True, "service": "armahub-backend"}

    @app.api_route("/health", methods=["GET", "HEAD"])
    def health():
        return {"status": "ok"}

    return app


app = create_app()