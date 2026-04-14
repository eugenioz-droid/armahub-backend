# ArmaHub — Instrucciones para Agentes

## Stack
- **Backend**: Python 3 · FastAPI · PostgreSQL (psycopg 3, `dict_row`)
- **Frontend**: Vanilla JS (NO frameworks) · Jinja2 templates · CSS custom
- **Deploy**: Render (uvicorn)

## Arquitectura Backend

```
armahub/
  main.py          ← App factory, monta routers (sin prefix + /api/v1)
  auth.py          ← Login, JWT, helpers: get_current_user, require_admin,
                     require_admin_or_admin2, require_role(*roles), ROL_MAP
  db.py            ← get_conn(), init_db()
  reclamos.py      ← Endpoints /reclamos/*
  reclamos_queries.py ← Queries reutilizables (q_total, q_abiertos, etc.)
  barras.py        ← Endpoints /barras/*, /proyectos/*, /stats/*, /landing/*
  importer.py      ← Upload Excel → bulk insert barras
  pedidos.py       ← CRUD pedidos
  admin.py         ← CRUD usuarios, audit
  export.py        ← CSV/Excel export
  calculistas.py   ← CRUD calculistas
  constructoras.py ← CRUD constructoras
  ui.py            ← Serve HTML (bootstrap, login, app)
```

### Convenciones Backend
- Cada dominio = 1 archivo `.py` con su propio `router = APIRouter()`.
- Se monta en `main.py` con `app.include_router(router)` + duplicado bajo `/api/v1`.
- Queries reutilizables van en `*_queries.py` (patrón: `def q_xxx(cur, where="", params=None)`).
- Permisos: usar `Depends(require_admin_or_admin2)` o `Depends(require_role("rol1","rol2"))` en el endpoint. NO hacer checks inline de rol salvo lógica condicional interna.
- `ROL_MAP` centralizado en `auth.py` — importar, nunca redefinir.
- Mutaciones devuelven `{"ok": True, "id": <int>}`.
- Listados devuelven `{"data": [...]}` (envelope estandarizado).
- Analytics devuelven arrays `[{"key": ..., "count": ...}]`, nunca dicts.

## Arquitectura Frontend

```
static/js/
  app/
    registry.js   ← ArmaHubRegistry: define módulos (calugas del hub)
    shell.js      ← Render del hub, navegación entre módulos, tabs
    bootstrap.js  ← Carga inicial, auth, feature scripts
  features/
    portal/       ← Landing indicators, inicio tab (cubicación)
    reclamos/     ← Todo el módulo de reclamos
    admin/        ← Panel admin
  shared/
    modals.js     ← Modales reutilizables (confirm, imageViewer, etc.)
    toast.js      ← Notificaciones
templates/
  app.html        ← Layout principal con hubModulesGrid + tabs
  tabs/           ← Templates parciales por tab
```

### Cómo agregar un nuevo módulo (caluga) al Hub

1. **Backend** — Crear `armahub/nuevo_modulo.py`:
   ```python
   from fastapi import APIRouter, Depends
   from .auth import get_current_user
   router = APIRouter()

   @router.get("/nuevo-modulo/datos")
   def datos(user=Depends(get_current_user)):
       ...
   ```

2. **Montar router** en `main.py`:
   ```python
   from .nuevo_modulo import router as nuevo_modulo_router
   # En create_app():
   app.include_router(nuevo_modulo_router)
   # Agregar a _api_routers también
   ```

3. **Template** — Crear `templates/tabs/nuevo_modulo.html` e incluirlo en `app.html`.

4. **JS Feature** — Crear `static/js/features/nuevo_modulo/index.js` con la función loader.

5. **Registrar módulo** en `registry.js`:
   ```js
   registerModule({
     id: 'nuevo_modulo',
     title: 'Nuevo Módulo',
     css: 'mod-nuevo-modulo',
     defaultTab: 'nuevo_modulo',
     allowedRoles: ['admin', 'cubicador'],
     loaderFunction: 'loadNuevoModuloModule',
     hubCardId: 'hubCardNuevoModulo',
     hubOrder: 40,
     hubDescription: 'Descripción breve.',
     hubAccent: '#10b981',
     hubIcon: '📦'
   });
   ```

6. **Cargar script** en `bootstrap.js` (array de feature scripts).

### Reglas JS
- NO usar frameworks ni módulos ES6 (todo es IIFE + `window.`).
- Funciones globales para loaders: `window.loadXxxModule = function() {...}`.
- API calls con `fetch()` + header `Authorization: Bearer <token>`.
- Toast para feedback: `showToast('mensaje', 'success'|'error')`.
- Modales: `showConfirmModal(msg, onConfirm)`, `openImageViewer(imgs, idx)`.

## Roles del Sistema
- `admin` — Acceso total
- `admin2` — Acceso administrativo limitado (no puede crear roles != usc)
- `cubicador` — Módulo cubicación + reclamos (responder)
- `usc` — Módulo reclamos (crear/gestionar)
- `externo` — Similar a cubicador, acceso restringido
- `cliente` — Solo lectura cubicación

## Restricciones Operativas
- **NO ejecutar comandos en terminal** (política corporativa bloquea PowerShell).
- **NO usar git push/pull** — el usuario maneja deploys manualmente.
- Usar `get_errors` para validar sintaxis en vez de compilar en terminal.
