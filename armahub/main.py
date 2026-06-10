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

from fastapi import FastAPI, Response, Request, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os, time, logging

from .db import init_db, get_conn
from .auth import router as auth_router, require_admin
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

    @app.post("/admin/migrar-bd-supabase")
    def migrar_bd_supabase(payload: dict, admin=Depends(require_admin)):
        """
        TEMPORAL — copia los datos de la BD actual (Render) a otra BD (Supabase).
        Solo admin. NO destructivo: solo LEE de Render, escribe en el destino.
        Body JSON: {"destino_url": "postgresql://...", "dry_run": true/false}

        Orden de tablas respeta foreign keys. En el destino primero corre las
        migraciones (crea estructura), luego copia datos tabla por tabla.
        Se elimina tras validar.
        """
        import psycopg
        destino_url = (payload or {}).get("destino_url", "").strip()
        dry_run = bool((payload or {}).get("dry_run", True))
        if not destino_url:
            raise HTTPException(status_code=400, detail="Falta destino_url")
        if destino_url.startswith("postgres://"):
            destino_url = "postgresql://" + destino_url[len("postgres://"):]

        # Orden conocido por dependencias FK (padres antes que hijos)
        ORDEN_FK = [
            "schema_migrations", "users", "proyectos", "constructoras", "calculistas",
            "proyecto_usuarios", "proyecto_aliases", "imports", "barras",
            "pedidos", "pedido_items", "export_log", "audit_log",
            "reclamos", "reclamo_seguimientos", "reclamo_acciones", "reclamo_imagenes",
            "notificaciones", "notificacion_config",
        ]

        # Detectar TODAS las tablas reales del schema public (no depender de lista fija).
        # Garantiza que no quede ninguna tabla afuera.
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
                """)
                tablas_reales = {r[0] for r in cur.fetchall()}

        # Ordenar: primero las conocidas en orden FK, luego cualquier extra al final
        TABLAS = [t for t in ORDEN_FK if t in tablas_reales]
        TABLAS += sorted(tablas_reales - set(ORDEN_FK))

        # 1) Conteo en origen (Render). CADA tabla en su propia conexión: si una
        # falla (p.ej. tabla inexistente), no aborta la transacción de las demás.
        conteos = {}
        for t in TABLAS:
            try:
                with get_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(f"SELECT COUNT(*) FROM {t}")
                        conteos[t] = cur.fetchone()[0]
            except Exception:
                conteos[t] = None  # tabla no existe en origen

        if dry_run:
            return {"dry_run": True, "conteos_origen": conteos,
                    "mensaje": "Filas a copiar por tabla. Nada copiado. Pasar dry_run=false para migrar."}

        # 2) En destino: crear estructura (correr migraciones via init) y copiar datos
        copiadas = {}
        errores = []
        dst = psycopg.connect(destino_url)
        try:
            # 2a) Crear tablas + migraciones en el destino
            from .db import _create_base_tables, _run_migrations, _create_indexes
            with dst.cursor() as dcur:
                _create_base_tables(dcur)
                _run_migrations(dcur)
                _create_indexes(dcur)
            dst.commit()

            # 2b) Copiar datos tabla por tabla (con FK diferidas)
            with dst.cursor() as dcur:
                dcur.execute("SET session_replication_role = replica;")  # desactiva FK durante copia
                # Vaciar TODAS las tablas primero, en orden inverso, SIN cascade.
                # (Antes el TRUNCATE CASCADE de una tabla hija borraba la tabla
                #  padre proyectos que ya se habia copiado → quedaba en 0.)
                for t in reversed(TABLAS):
                    try:
                        dcur.execute(f"TRUNCATE {t};")
                    except Exception:
                        pass
            dst.commit()
            for t in TABLAS:
                if not conteos.get(t):
                    copiadas[t] = 0
                    continue
                try:
                    # Columnas que existen en el DESTINO (estructura recreada)
                    with dst.cursor() as dcur:
                        dcur.execute(
                            "SELECT column_name FROM information_schema.columns "
                            "WHERE table_schema='public' AND table_name=%s", (t,)
                        )
                        cols_dst = {r[0] for r in dcur.fetchall()}

                    with get_conn() as sconn:
                        with sconn.cursor() as scur:
                            scur.execute(f"SELECT * FROM {t}")
                            cols_src = [d[0] for d in scur.description]
                            rows = scur.fetchall()
                    if not rows:
                        copiadas[t] = 0
                        continue

                    # Copiar SOLO columnas presentes en ambos lados (evita desfases de nombres)
                    idx_comunes = [i for i, c in enumerate(cols_src) if c in cols_dst]
                    cols_comunes = [cols_src[i] for i in idx_comunes]
                    omitidas = [c for c in cols_src if c not in cols_dst]
                    rows_filtradas = [tuple(row[i] for i in idx_comunes) for row in rows]

                    collist = ", ".join(cols_comunes)
                    placeholders = ", ".join(["%s"] * len(cols_comunes))
                    with dst.cursor() as dcur:
                        # Ya se truncó todo al inicio; aquí solo insertar.
                        dcur.executemany(
                            f"INSERT INTO {t} ({collist}) VALUES ({placeholders})", rows_filtradas
                        )
                    dst.commit()
                    copiadas[t] = len(rows)
                    if omitidas:
                        copiadas[t] = f"{len(rows)} (columnas omitidas por desfase: {omitidas})"
                except Exception as exc:
                    dst.rollback()
                    errores.append({"tabla": t, "error": str(exc)})
            with dst.cursor() as dcur:
                dcur.execute("SET session_replication_role = DEFAULT;")
            dst.commit()

            # 3) VERIFICACIÓN: contar filas en destino y comparar con origen
            verificacion = {}
            descuadres = []
            with dst.cursor() as dcur:
                for t in TABLAS:
                    try:
                        dcur.execute(f"SELECT COUNT(*) FROM {t}")
                        n_dst = dcur.fetchone()[0]
                    except Exception:
                        n_dst = None
                    n_src = conteos.get(t)
                    verificacion[t] = {"origen": n_src, "destino": n_dst}
                    if (n_src or 0) != (n_dst or 0):
                        descuadres.append(t)
        finally:
            dst.close()

        return {
            "dry_run": False,
            "copiadas": copiadas,
            "errores": errores,
            "verificacion": verificacion,
            "descuadres": descuadres,
            "resultado": "OK — todas las tablas cuadran" if not descuadres and not errores
                         else f"REVISAR — descuadres en: {descuadres}",
            "nota": "Render NO modificado. Validar antes de cambiar DATABASE_URL.",
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