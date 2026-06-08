# Roadmap Reclamos — Escalamiento a Sistema de Calidad Multi-Origen [FUENTE HISTÓRICA - OBSOLETO]

> **FUENTE HISTÓRICA (archivado 2026-06-08):** Obsoleto. Sus pendientes vigentes (multi-origen
> R1–R4, migración imágenes a R2 R5, envío de informe PC.15) ya fueron barridos al programa
> oficial `docs/programa-versiones/programa_v1.00.md` (Fases 6B/6C y 3A). Se conserva por
> trazabilidad de las decisiones arquitectónicas (1 DB, 1 backend, storage externo). NO usar
> como programa activo.


## Visión

Escalar el módulo de Reclamos actual (orientado a cubicación) a un sistema de gestión de calidad que cubra toda la planta: retail, producción, despacho y cualquier origen futuro. Un solo portal, un solo backend, una sola base de datos.

---

## Decisiones Arquitectónicas

| Aspecto | Decisión | Justificación |
|---------|----------|---------------|
| Repositorios | **1 solo** | Comparten auth, shell, UI toolkit. Separar duplica todo. |
| Base de datos | **1 sola** (PostgreSQL) | Un usuario = una row. Reclamos cruzados entre orígenes. |
| Backend | **1 servicio** FastAPI, routers por dominio | Ya funciona así. Agregar routers no afecta los existentes. |
| Frontend | **1 portal**, calugas por permisos | Shell + Registry ya filtran por rol. |
| Storage imágenes | **Externo** (Cloudflare R2) | ~$0–2/mes. Elimina bytea de PostgreSQL. |
| Admin | **1 caluga**, sub-tabs por rol | Admin ve todo, admin_reclamos solo su sección. |
| Aislamiento | **Lógico** (permisos + campo `origen`) | No físico. Sin duplicación de infraestructura. |

---

## Arquitectura Técnica

### Modelo de Datos — Cambios Principales

```
clientes (NUEVA)
├── id SERIAL PK
├── nombre TEXT NOT NULL          -- "Falabella Lo Barnechea"
├── empresa TEXT                  -- "Falabella Retail"
├── ubicacion TEXT                -- Comuna o dirección
├── contacto_nombre TEXT
├── contacto_email TEXT
├── activo BOOLEAN DEFAULT true
└── fecha_creacion TIMESTAMPTZ

areas_planta (NUEVA — opcional fase 2)
├── id SERIAL PK
├── nombre TEXT NOT NULL          -- "Producción", "Despacho", "QA"
└── activo BOOLEAN DEFAULT true

reclamos (EXISTENTE — agregar columnas)
├── ...existentes...
├── id_cliente INT FK clientes    -- NULL si es cubicación
├── origen TEXT DEFAULT 'cubicacion'  -- 'cubicacion' | 'retail' | 'planta' | ...
├── area TEXT                     -- Área de planta involucrada (libre o FK)
└── ...

reclamo_imagenes (MIGRAR storage)
├── ...existentes...
├── storage_key TEXT              -- Key en R2 (reemplaza bytea)
├── storage_url TEXT              -- URL pública/firmada
└── imagen BYTEA                  -- Se elimina post-migración
```

### Roles

| Rol | Alcance |
|-----|---------|
| `admin` | Todo. Gestiona ambos mundos. |
| `admin2` | Admin limitado cubicación (como hoy). |
| `admin_reclamos` (NUEVO) | Admin de calidad: clientes, config reclamos, dashboards reclamos. Sin acceso a cubicación. |
| `cubicador` | Cubicación + responder reclamos de cubicación. |
| `usc` | Crear/gestionar reclamos (todos los orígenes). |
| `usc_retail` (NUEVO — opcional) | Solo reclamos retail. |
| `externo` | Acceso restringido cubicación. |
| `cliente` | Solo lectura cubicación. |

### Backend — Estructura de Archivos

```
armahub/
├── reclamos.py            -- Endpoints reclamos (ya existe, extender)
├── reclamos_queries.py    -- Queries (ya existe, extender con filtro origen)
├── clientes.py            -- NUEVO: CRUD clientes
├── storage.py             -- NUEVO: abstracción R2 (upload/download/delete/presign)
├── reclamos_imagenes.py   -- NUEVO: refactor imágenes reclamos → usa storage.py
```

### Frontend — Estructura

```
static/js/features/
├── reclamos/index.js      -- Extender con selector origen/cliente
├── admin/
│   ├── index.js           -- Agregar sub-tab "Clientes"
│   └── clientes.js        -- NUEVO: CRUD clientes
```

---

## Infraestructura y Hosting

### Evaluación de Plataforma (VALIDAR)

Hoy el stack corre en **Render** (plan Web Service). Al agregar Cloudflare R2 como storage externo, la arquitectura queda:

```
[Browser] → [Render: FastAPI] → [PostgreSQL en Render]
                              → [Cloudflare R2: imágenes]
```

#### ¿Por qué Render puede ser más caro?

| Factor | Render | Alternativas |
|--------|--------|-------------|
| **Web Service** | Starter $7/mes (512MB RAM, sleep tras 15min inactividad) / Standard $25/mes (siempre activo) | Railway: $5/mes + uso. Fly.io: $0 hasta 3 shared-cpu VMs |
| **PostgreSQL** | Starter gratuito 1GB → Standard $7/mes (1GB) → $20/mes (10GB) | Supabase: 500MB free → $25/mes (8GB). Neon: 0.5GB free → pay-per-use |
| **Egress** | 100GB/mes incluido, luego $0.10/GB | Fly.io: sin cobro interno. Railway: sin cobro |
| **Cold starts** | Plan Starter: ~30s wake-up si duerme. Standard: sin cold start | Fly.io: machines duermen/despiertan en ~300ms. Railway: siempre activo |

**El costo principal de Render no es la app, es que el plan gratuito/starter duerme** y el plan "siempre activo" salta a $25/mes. Si hoy ya estás en Standard ($25), el costo es razonable para lo que ofrece. Si estás en Starter y necesitas que no duerma, la alternativa más barata sería Fly.io (~$5/mes por una VM persistente).

#### Tareas de validación de infraestructura

- [ ] **INF.1** Confirmar plan actual de Render (Starter vs Standard) y costo mensual real
- [ ] **INF.2** Evaluar si el cold start de 30s es aceptable para los usuarios de planta
- [ ] **INF.3** Comparar costo Render Standard ($25 web + $7-20 DB) vs Fly.io + Supabase ($5 + $0-25)
- [ ] **INF.4** Confirmar que Cloudflare R2 free tier (10GB storage, 10M reads/mes) es suficiente para el volumen de imágenes estimado
- [ ] **INF.5** Si se migra de Render: documentar proceso de migración (env vars, DB dump/restore, DNS)
- [ ] **INF.6** Decisión final: quedarse en Render o migrar — documentar razones

> **Nota**: Cloudflare R2 no depende de dónde corra la app. Se puede usar R2 desde Render, Fly.io, Railway o cualquiera. La decisión de hosting es independiente de la decisión de storage.

---

## Programa de Tareas

### Fase R1 — Base de datos y modelo de clientes

- [ ] R1.1 Crear migración: tabla `clientes` con campos base (nombre, empresa, ubicación, contacto, activo)
- [ ] R1.2 Crear migración: columnas `id_cliente`, `origen`, `area` en tabla `reclamos` (nullable, default cubicacion)
- [ ] R1.3 Crear `armahub/clientes.py` — CRUD básico (listar, crear, editar, desactivar)
- [ ] R1.4 Montar router en `main.py` + duplicar bajo `/api/v1`
- [ ] R1.5 Permisos: `require_role('admin', 'admin_reclamos')` para CRUD clientes
- [ ] R1.6 Endpoint `GET /clientes` con filtro `?activo=true` y búsqueda por nombre

### Fase R2 — Rol admin_reclamos

- [ ] R2.1 Agregar `admin_reclamos` a `ROL_MAP` en `auth.py`
- [ ] R2.2 Migración: CHECK constraint de `users.role` incluye `admin_reclamos`
- [ ] R2.3 Actualizar `registry.js`: caluga Admin visible para `admin_reclamos`
- [ ] R2.4 Actualizar `registry.js`: caluga Reclamos visible para `admin_reclamos`
- [ ] R2.5 Filtrar sub-tabs de Admin por rol: `admin_reclamos` solo ve General + Clientes + Notificaciones
- [ ] R2.6 Actualizar ROLES_Y_PERMISOS.md con nuevo rol

### Fase R3 — Admin de clientes (frontend)

- [ ] R3.1 Crear sub-tab "Clientes" en módulo Admin (HTML en `tabs/admin.html`)
- [ ] R3.2 Crear `features/admin/clientes.js` — tabla, formulario CRUD, búsqueda
- [ ] R3.3 Cargar script en `bootstrap.js`
- [ ] R3.4 Botón crear/editar/desactivar cliente con permisos
- [ ] R3.5 Validar flujo completo: crear cliente → usarlo en reclamo

### Fase R4 — Reclamos multi-origen

- [ ] R4.1 Frontend: selector de origen en formulario de registro (`cubicacion` | `retail` | `planta`)
- [ ] R4.2 Frontend: condicional — si origen=cubicacion muestra "Proyecto/Obra", si no muestra "Cliente"
- [ ] R4.3 Frontend: dropdown de clientes (cargado desde `/clientes`) en formulario registro
- [ ] R4.4 Backend: `POST /reclamos` acepta `id_cliente`, `origen`, `area`
- [ ] R4.5 Backend: `PATCH /reclamos/{id}` acepta `id_cliente`, `origen`, `area`
- [ ] R4.6 Backend: listado acepta filtro `?origen=retail&id_cliente=5`
- [ ] R4.7 Frontend: filtros de origen y cliente en la lista de reclamos
- [ ] R4.8 Frontend: detalle muestra Cliente en vez de Proyecto cuando `origen != cubicacion`
- [ ] R4.9 Backend: queries de dashboard segmentables por origen
- [ ] R4.10 Frontend: dashboards con toggle/filtro por origen

### Fase R5 — Migración de imágenes a Cloudflare R2

- [ ] R5.1 Crear cuenta Cloudflare (si no existe) y bucket R2
- [ ] R5.2 Generar API token R2 con permisos read/write
- [ ] R5.3 Crear `armahub/storage.py` — funciones: `upload_file(key, data, content_type)`, `get_url(key)`, `delete_file(key)`, `generate_presigned_url(key, expires)`
- [ ] R5.4 Configurar env vars: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- [ ] R5.5 Refactor `POST /reclamos/{id}/imagenes` — subir a R2, guardar `storage_key` en DB (no bytea)
- [ ] R5.6 Refactor `GET /reclamos/{id}/imagenes/{img_id}/file` — proxy desde R2 o redirect a presigned URL
- [ ] R5.7 Migración one-shot: script que lee bytea existentes → sube a R2 → actualiza storage_key → limpia bytea
- [ ] R5.8 Eliminar columna `imagen` (bytea) de `reclamo_imagenes` post-migración
- [ ] R5.9 Actualizar frontend si cambia el contrato de URL de imágenes
- [ ] R5.10 Validar que upload/view/delete funcionan con R2

### Fase R6 — Infraestructura y hosting (validación)

- [ ] R6.1 Ejecutar checklist INF.1–INF.6 (ver sección Infraestructura arriba)
- [ ] R6.2 Si se decide migrar: crear proyecto en plataforma destino
- [ ] R6.3 Configurar variables de entorno en nuevo hosting
- [ ] R6.4 Migrar base de datos (pg_dump / pg_restore)
- [ ] R6.5 Configurar dominio/DNS
- [ ] R6.6 Smoke test completo post-migración
- [ ] R6.7 Cutover: apagar Render, activar nuevo hosting

### Fase R7 — Áreas de planta y categorización avanzada (futuro)

- [ ] R7.1 Tabla `areas_planta` si se necesita catálogo fijo (vs texto libre)
- [ ] R7.2 Categorías de reclamo por origen (cubicación usa las actuales, retail puede tener otras)
- [ ] R7.3 SLA por origen/categoría (ej: retail = 5 días, planta = 3 días)
- [ ] R7.4 Escalamiento automático si SLA vence
- [ ] R7.5 Reportes cross-origen para gerencia

### Fase R8 — Permisos granulares (futuro)

- [ ] R8.1 Tabla `user_permissions` (user_id, permiso, activo) para permisos por acción
- [ ] R8.2 Refactor `require_role()` → `require_permission()` donde haga falta
- [ ] R8.3 Admin UI para asignar permisos individuales
- [ ] R8.4 Migrar permisos actuales basados en rol a la tabla de permisos

---

## Orden de Ejecución Recomendado

```
R1 (clientes DB) → R2 (rol admin_reclamos) → R3 (admin clientes UI)
                                             → R4 (reclamos multi-origen)
                                             → R5 (imágenes R2) — independiente
R6 (hosting) — puede hacerse en paralelo con R1–R4
R7, R8 — futuro, cuando el sistema esté en uso multi-origen
```

**R5 y R6 son independientes entre sí y del resto.** Se pueden ejecutar cuando convenga.

---

## Estimaciones de Esfuerzo

| Fase | Complejidad | Sesiones estimadas |
|------|-------------|-------------------|
| R1 | Baja | 1 |
| R2 | Baja | 1 |
| R3 | Media | 1–2 |
| R4 | Media-Alta | 2–3 |
| R5 | Media | 2 |
| R6 | Variable | 1–3 (depende si se migra) |
| R7 | Media | 2 |
| R8 | Alta | 3–4 |

**Total R1–R5**: ~7–9 sesiones para tener el sistema multi-origen operativo con storage externo.

---

## Criterios de Éxito

- Un reclamo puede registrarse con origen "retail" y asociarse a un cliente (no a un proyecto)
- Un `admin_reclamos` puede gestionar clientes y reclamos sin ver cubicación
- Las imágenes se almacenan en R2, no en PostgreSQL
- Los dashboards muestran métricas segmentadas por origen
- El costo mensual de infraestructura no supera los ~$10–15 USD (app + DB + storage)
- Zero downtime en la migración de imágenes
