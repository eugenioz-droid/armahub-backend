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

from fastapi import FastAPI, Response, Request, Depends, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os, time, logging

from .db import init_db, get_conn
from .auth import router as auth_router, require_admin
from . import storage
from .importer import router as importer_router
from .barras import router as barras_router
from .ui import router as ui_router
from .admin import router as admin_router
from .export import router as export_router
from .pedidos import router as pedidos_router
from .constructoras import router as constructoras_router
from .calculistas import router as calculistas_router
from .reclamos import router as reclamos_router
from .notifications import router as notifications_router


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

    init_db()

    # --- Current routes (no prefix, backward compatible) ---
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
    app.include_router(notifications_router)

    # --- API v1 (same routers under /api/v1 prefix) ---
    _api_routers = [
        auth_router, importer_router, barras_router, admin_router,
        export_router, pedidos_router, constructoras_router,
        calculistas_router, reclamos_router, notifications_router,
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
        result = {"status": "ok", "db": "ok"}
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
        except Exception as e:
            result["db"] = "error"
            result["detail"] = str(e)
        return result

    @app.post("/admin/migrar-imagenes-r2")
    def migrar_imagenes_r2(
        dry_run: bool = Query(True, description="true=simular sin subir; false=migrar real"),
        admin=Depends(require_admin),
    ):
        """
        TEMPORAL — migra imágenes de reclamos desde BYTEA a R2.
        Solo admin. NO destructivo (no borra el BYTEA original).
        Idempotente (omite las que ya tienen storage_key).
        Se elimina tras validar la migración.
        """
        if not storage.is_configured():
            raise HTTPException(status_code=400, detail="R2 no configurado")

        # Asegurar columna storage_key (idempotente, por si la migración 53 aún no corrió)
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DO $$ BEGIN ALTER TABLE reclamo_imagenes ADD COLUMN storage_key TEXT; "
                    "EXCEPTION WHEN duplicate_column THEN NULL; END $$;"
                )

        # Inventario de pendientes
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, reclamo_id, filename, content_type, tipo,
                           octet_length(data) AS bytes
                    FROM reclamo_imagenes
                    WHERE data IS NOT NULL
                      AND (storage_key IS NULL OR storage_key = '')
                    ORDER BY id ASC
                """)
                pendientes = cur.fetchall()

        total = len(pendientes)
        total_mb = round(sum((r[5] or 0) for r in pendientes) / (1024 * 1024), 2)

        if dry_run:
            return {
                "dry_run": True,
                "pendientes": total,
                "tamaño_mb": total_mb,
                "mensaje": f"{total} imágenes se migrarían ({total_mb} MB). Nada subido. "
                           f"Llamar con ?dry_run=false para migrar de verdad.",
            }

        ok, fallidas = 0, []
        for img_id, reclamo_id, filename, ct, tipo, _ in pendientes:
            try:
                with get_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT data FROM reclamo_imagenes WHERE id = %s", (img_id,))
                        row = cur.fetchone()
                        if not row or row[0] is None:
                            fallidas.append({"id": img_id, "error": "sin data"})
                            continue
                        data = bytes(row[0])
                sub = "analisis" if (tipo or "") == "ImagenesAnalisis" else "registro"
                key = storage.build_key("reclamos", sub, str(reclamo_id), filename=filename or f"img_{img_id}")
                storage.upload_file(key, data, ct or "application/octet-stream")
                with get_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute("UPDATE reclamo_imagenes SET storage_key = %s WHERE id = %s", (key, img_id))
                ok += 1
            except Exception as exc:
                fallidas.append({"id": img_id, "error": str(exc)})

        return {
            "dry_run": False,
            "migradas_ok": ok,
            "total": total,
            "fallidas": fallidas,
            "nota": "BYTEA original NO borrado. Validar imágenes antes de limpiar.",
        }

    # --- Request logging middleware ---
    logger = logging.getLogger("armahub.access")

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start = time.time()
        response = await call_next(request)
        ms = round((time.time() - start) * 1000)
        if not request.url.path.startswith(("/static", "/health")):
            logger.info("%s %s %s %dms", request.method, request.url.path, response.status_code, ms)
        return response

    return app


app = create_app()