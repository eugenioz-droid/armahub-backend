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

from .db import init_db
from .armahub.auth import router as auth_router
from .importer import router as importer_router
from .barras import router as barras_router
from .ui import router as ui_router


def create_app() -> FastAPI:
    app = FastAPI(title="ArmaHub Backend")

    # Inicializa DB una vez al arrancar el servicio.
    # IMPORTANTE: init_db() usa CREATE TABLE IF NOT EXISTS (no borra datos).
    init_db()

    # Routers
    app.include_router(auth_router)
    app.include_router(importer_router)
    app.include_router(barras_router)
    app.include_router(ui_router)

    @app.get("/")
    def root():
        return {"ok": True, "service": "armahub-backend"}

    return app


app = create_app()