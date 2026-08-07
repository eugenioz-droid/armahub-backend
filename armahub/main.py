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

from fastapi import FastAPI, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import os, time, logging, traceback

from .db import init_db, get_conn
from . import mailer, storage
from .auth import router as auth_router
from .importer import router as importer_router
from .barras import router as barras_router
from .ui import router as ui_router
from .admin import router as admin_router
from .export import router as export_router
from .lotes import router as lotes_router
from .pedidos import router as pedidos_router
from .constructoras import router as constructoras_router
from .calculistas import router as calculistas_router
from .catalogo import router as catalogo_router
from .reclamos import router as reclamos_router
from .notifications import router as notifications_router
from .obra_config import router as obra_config_router


def create_app() -> FastAPI:
    app = FastAPI(title="ArmaHub Backend")

    # --- CORS ---
    allowed_origins = os.getenv("CORS_ORIGINS", "").split(",")
    allowed_origins = [o.strip() for o in allowed_origins if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # init_db corre en CADA cold-start (Render free tier duerme el proceso). Si algo
    # falla (una migración, la BD lenta), NUNCA debe impedir que el web server arranque
    # → causa del "carga una vez y luego no": init_db hacía raise y tumbaba el boot.
    # Se envuelve: si falla, se loguea y la app arranca igual (las migraciones pendientes
    # se reintentan en el próximo arranque; son idempotentes). El server SIEMPRE responde.
    try:
        init_db()
    except Exception as _exc:
        import logging as _logging
        _logging.getLogger("armahub").error(
            "init_db falló en el arranque (la app arranca igual; se reintenta luego): %s", _exc
        )

    # --- Current routes (no prefix, backward compatible) ---
    app.include_router(auth_router)
    app.include_router(importer_router)
    app.include_router(barras_router)
    app.include_router(ui_router)
    app.include_router(admin_router)
    app.include_router(export_router)
    app.include_router(lotes_router)
    app.include_router(pedidos_router)
    app.include_router(constructoras_router)
    app.include_router(calculistas_router)
    app.include_router(catalogo_router)
    app.include_router(reclamos_router)
    app.include_router(notifications_router)
    # obra_config expone /proyectos/{id}/config y /pisos-combinados. Se monta IGUAL que
    # barras_router (sin prefijo Y bajo /api/v1) porque comparte el espacio de rutas
    # /proyectos; así el front lo consume por cualquiera de las dos bases, sin sorpresas.
    app.include_router(obra_config_router)

    # --- API v1 (same routers under /api/v1 prefix) ---
    _api_routers = [
        auth_router, importer_router, barras_router, admin_router,
        export_router, lotes_router, pedidos_router, constructoras_router,
        calculistas_router, catalogo_router, reclamos_router, notifications_router,
        obra_config_router,
    ]
    for r in _api_routers:
        app.include_router(r, prefix="/api/v1")
    
    # Servir archivos estáticos (CSS, JS, imágenes)
    static_path = os.path.join(os.path.dirname(__file__), "static")
    if os.path.exists(static_path):
        app.mount("/static", StaticFiles(directory=static_path), name="static")

    @app.api_route("/", methods=["GET", "HEAD"])
    def root():
        return {"ok": True, "service": "armahub-backend"}

    @app.api_route("/health", methods=["GET", "HEAD"])
    def health():
        # M0.6 — endpoint público: solo estados ok/error por componente. El detalle
        # (mensajes de excepción, nombres de bucket, remitente) va al log, no al cliente.
        _hlog = logging.getLogger("armahub.health")
        result = {"status": "ok", "db": "ok"}
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
        except Exception as e:
            result["db"] = "error"
            _hlog.error("health db error: %s", e)
        sh = storage.health()
        result["storage"] = sh.get("storage", "?")
        if sh.get("detail"):
            _hlog.error("health storage error: %s", sh.get("detail"))
        mh = mailer.health()
        result["mail"] = mh.get("mail", "?")
        if result["db"] != "ok" or result["storage"] not in ("ok", "not-configured"):
            result["status"] = "error"
        return result
    # --- Request logging middleware ---
    logger = logging.getLogger("armahub.access")

    # M0.7 — security headers en toda respuesta (incl. el 500 genérico).
    def _security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Strict-Transport-Security"] = "max-age=15552000"
        return response

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start = time.time()
        try:
            response = await call_next(request)
        except Exception:
            # Cualquier excepción NO capturada por un endpoint caía en el manejador
            # genérico de Starlette, que responde 500 con texto plano ("Internal
            # Server Error"). El frontend siempre espera JSON (hace res.json()), así
            # que ese texto plano rompía el parseo (SyntaxError) y el guardado
            # quedaba sin completar SIN aviso claro al usuario. Ahora se loguea el
            # traceback completo (para diagnosticar) y se devuelve JSON siempre.
            ms = round((time.time() - start) * 1000)
            logger.error("UNHANDLED %s %s %dms\n%s", request.method, request.url.path, ms, traceback.format_exc())
            return _security_headers(JSONResponse(status_code=500, content={"detail": "Error interno del servidor. Ya quedó registrado — vuelve a intentar en un momento."}))
        ms = round((time.time() - start) * 1000)
        if not request.url.path.startswith(("/static", "/health")):
            logger.info("%s %s %s %dms", request.method, request.url.path, response.status_code, ms)
        return _security_headers(response)

    return app


app = create_app()