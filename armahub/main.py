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

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import os

from .db import init_db
from .auth import router as auth_router
from .importer import router as importer_router
from .barras import router as barras_router
from .ui import router as ui_router


def create_app() -> FastAPI:
    app = FastAPI(title="ArmaHub Backend")

    init_db()

    app.include_router(auth_router)
    app.include_router(importer_router)
    app.include_router(barras_router)
    app.include_router(ui_router)
    
    # Servir archivos estáticos (CSS, JS, imágenes)
    static_path = os.path.join(os.path.dirname(__file__), "static")
    if os.path.exists(static_path):
        app.mount("/static", StaticFiles(directory=static_path), name="static")

    @app.get("/")
    def root():
        return {"ok": True, "service": "armahub-backend"}

    return app


app = create_app()