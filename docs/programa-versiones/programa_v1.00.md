# Programa de Trabajo - ArmaHub

> **Estado:** VIGENTE (oficializado 2026-06-08). Reemplaza a la versión inicial de CODEX,
> archivada en `docs/archive/superseded/programa_v1.00_codex.md`.
>
> **Qué cambió respecto a la versión de CODEX:**
> 1. Estado real reconciliado con el código (no con los roadmaps obsoletos).
> 2. Infraestructura (Cloudflare + Supabase + R2) movida al inicio como base.
> 3. Calugas de obra redefinidas con nombres y públicos acordados (Programa de Obra, Cubicación, Mis Proyectos).
> 4. Barrido de pendientes reales arrastrados desde Roadmap.md y ROADMAP_RECLAMOS.md.
> 5. Sistema de correo unificado como pieza transversal (no duplicado por caluga).

**Plataforma operacional y documental para obras, cubicaciones, calidad, CRM, procedimientos, capacitación y terreno.**

**Objetivo v1.00:** dejar ArmaHub sobre una infraestructura final (fuera de Render) y avanzar por calugas completas, sin picotear tareas sueltas, partiendo desde el estado real verificado del repositorio.

**Stack actual:** FastAPI | PostgreSQL | Jinja templates | JavaScript modular | Auth JWT/RBAC

**Infraestructura objetivo:** Cloudflare (programa) + Supabase (PostgreSQL) + Cloudflare R2 (archivos) + workers para tareas pesadas (futuro).

---

## 0. Decisiones rectoras

### 0.1 Calugas objetivo

| # | Caluga | Público | Propósito |
|---|--------|---------|-----------|
| 1 | **Programa de Obra** | Interno (USC, cubicadores, jefatura) | USC planifica/programa la obra; cubicadores dan cumplimiento (automático si hay carga Detailer, manual + validación si no). Hitos, avance, secuencia. |
| 2 | **Cubicación** | Interno (cubicadores) | Módulo actual: cargas CSV, barras, pedidos, Bar Manager, exportación. No todas las obras se cubican con Detailer. |
| 3 | **Mis Proyectos** | Transversal (cliente: sus obras; interno/gerente: las que correspondan) | Expediente de obra. Cliente y armacero ven y **editan** según permisos: archivos, RDIs con respuesta, mailing a involucrados, avance, documentos, certificados. |
| 4 | Calidad / Reclamos | Interno + externo | Reclamos, no conformidades, acciones correctivas, certificados, PDF/envío, multi-origen. |
| 5 | CRM + Inteligencia Comercial | Interno comercial | Clientes, contactos, leads, oportunidades, seguimientos. |
| 6 | Procedimientos y Capacitación | Interno | Biblioteca, versiones, cursos, matriz cargo/procedimiento. |
| 7 | Administración del Sistema | Admin | Usuarios, roles, permisos, parámetros, plantillas, auditoría, integraciones. |
| + | App Terreno | Terreno | Cliente móvil/API: checklist, fotos, observaciones, firma, protocolos PDF. No es caluga web. |

**Relación entre calugas de obra:** una sola tabla raíz `obra` (hoy `proyectos`). Programa de Obra y Cubicación **escriben** datos operativos; Mis Proyectos es la vista/expediente compartido donde cliente y armacero interactúan según permisos.

### 0.2 Estrategia de implementación

- Implementar caluga por caluga; cada una cierra un flujo usable antes de abrir la siguiente.
- Flujo por caluga: discovery corto → modelo de datos → backend → UI → permisos → auditoría → smoke test → documentación.
- No crear módulos duplicados para el mismo proceso.
- No crear módulo USC/despacho inicial; consumir desde SAP/externo o integración futura.
- Calidad controla certificados; el expediente de obra (Mis Proyectos) los disponibiliza.

### 0.3 Decisión de infraestructura (FIJADA)

Salir de Render. Tres piezas a su destino final:

| Pieza | Hoy (Render) | Destino | Nota |
|-------|--------------|---------|------|
| Programa (FastAPI) | Render Web Service | **Cloudflare** (empaquetado en container/Docker) | Mismo proveedor que EZ Trader. |
| Base de datos | Render PostgreSQL | **Supabase** (PostgreSQL administrado) | Solo metadata/datos estructurados, NO archivos. |
| Archivos (imágenes hoy; PDF/DWG futuro) | Dentro de la BD (BYTEA) ❌ | **Cloudflare R2** | Saca el binario de la BD. Urgente antes de subir planos pesados. |

**Por qué R2 es estructural:** hoy las imágenes de reclamos viven como `BYTEA` dentro de PostgreSQL. Con 30–80 DWG por obra × ~100 obras/año, eso no puede vivir en la BD ni en el disco del container (efímero). R2 es el lugar correcto: datos en Supabase, archivos en R2.

**Un solo storage R2 con carpetas (FIJADO):** no se crean buckets/storages separados. Un único bucket R2 con separación lógica por carpetas cubre todas las necesidades (imágenes de reclamos registro/análisis, planos/documentos por obra, certificados, fotos de terreno), con permisos diferenciados por carpeta. Dos storages físicos solo se justificarían por aislamiento legal o escalas radicalmente distintas — no es el caso. Estructura prevista:

```
R2 (un solo bucket)
├── reclamos/registro/      ← evidencia inicial
├── reclamos/analisis/      ← material de análisis
├── obras/{id}/planos/      ← DWG y PDF por obra
├── obras/{id}/documentos/  ← antecedentes, RDI
├── certificados/           ← certificados de calidad
└── terreno/{obra}/fotos/   ← fotos de la App Terreno
```

**Validación antes de cortar Render:** probar que FastAPI con sus dependencias (`pandas`, `openpyxl`, `psycopg`, `fpdf2`) corre bien en Cloudflare y medir cold start. Solo tras smoke test exitoso se apaga Render.

### 0.4 Backend: un solo backend modular

**Mantener un backend FastAPI único y modular.** El sistema comparte usuarios, permisos, obras, documentos y auditoría; separar backends antes de tener fronteras maduras solo agrega costo. Hoy el backend ya está separado por dominio en archivos (`reclamos.py`, `barras.py`, `admin.py`, etc.); algunos son grandes (`reclamos.py` ~2150 líneas, `barras.py` ~1935) y se endurecen donde valga la pena, sin reescritura masiva. NO se migra a estructura `modules/` salvo que un dominio lo justifique (decisión: se descarta la propuesta de `modules/` del refactor-analysis por ahora).

### 0.5 Workers / tareas pesadas (futuro acotado)

Separar a worker solo cuando se cumpla un criterio fuerte (escala/dependencia/seguridad/costo distintos). Primer caso real previsto: **previsualización de DWG** (formato propietario, requiere servicio o librería pesada). Va a worker futuro, no al backend principal.

### 0.6 Previsualización de planos (FIJADA)

- **PDF:** preview en navegador en v1.00 (barato y viable).
- **DWG:** en v1.00 solo almacenar en R2 + descarga directa. Preview DWG = worker/servicio futuro (Autodesk APS u ODA), condicionado a costo razonable.

### 0.7 Sistema de correo: único y transversal

El mailing de Mis Proyectos (avisar involucrados ante RDI, etc.) y el envío de informes de Reclamos usan **un solo helper de correo reutilizable**. No se construyen dos sistemas de correo. Se implementa una vez en la fase de infraestructura/admin y lo consumen todas las calugas.

---

## Estado real verificado del repositorio (junio 2026)

Esto reemplaza lo que dicen los roadmaps obsoletos. Verificado contra el código:

**Ya hecho (no re-planificar):**
- Backend FastAPI por dominio + PostgreSQL + migraciones (van por ~52).
- Auth JWT/RBAC operativo; roles: admin, admin2, cubicador, usc, externo, cliente.
- **Refactor frontend modular COMPLETO**: `app.js` reducido de monolito a ~80 líneas. Estructura `app/`, `shared/` (9 archivos), `features/{reclamos,cubicacion,admin,portal,notifications}/`, `legacy/compat.js`.
- Cubicación madura: importación CSV con obra destino, Bar Manager (vista por elementos + heatmap cobertura), pedidos, exportación aSa, mover/reimportar cargas.
- Reclamos maduro: flujo completo, multi-imagen separada (registro/análisis), notificaciones in-app, correlativos año+número, modales, PDF de informe (`fpdf2`), roles afinados.
- Admin: usuarios, entidades, proyectos, auditoría, tab Roles y Permisos, notificaciones.

**Deuda / pendiente real confirmado (sin tocar aún):**
- Imágenes en `BYTEA` dentro de PostgreSQL → migrar a R2 (no existe storage externo en el código).
- No existe SMTP / envío de correo (solo notificaciones in-app).
- No existe ninguna entidad de programa/hitos/avance de obra.
- `MODELO_DE_DATOS.md` desactualizado (dice migraciones 28–32; el código va por ~52).
- `reclamos.py` y `barras.py` son archivos grandes.
- 231 commits locales sin pushear a origin/main.

---

## FASE 1 — Alineamiento y cierre documental

Objetivo: dejar un único programa oficial partiendo del estado real, no de los roadmaps obsoletos.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 1.1 | Aprobar este programa reordenado y renombrarlo a `programa_v1.00.md` | ☑ | TÚ |
| 1.2 | Archivar `programa_v1.00.md` (versión CODEX) en `docs/archive/superseded/` | ☑ | YO |
| 1.3 | Clasificar `Roadmap.md` y `ROADMAP_RECLAMOS.md` como fuente histórica y archivar | ☑ | TÚ+YO |
| 1.4 | Cerrar decisión de `refactor-analysis.md`: backend se mantiene por dominio, NO migra a `modules/` | ☑ | YO |
| 1.5 | Cerrar decisión de `diseno_repositorios_imagenes.md`: storage va a R2, NO a filesystem local | ☑ | YO |
| 1.6 | Actualizar `MODELO_DE_DATOS.md` al estado real (migraciones hasta ~52, tablas vigentes) | ☑ | YO |
| 1.7 | Confirmar push de los 231 commits locales a origin/main (decisión de rama) | ☑ | TÚ+YO |

---

## FASE 2 — Auditoría de calidad y riesgos antes de migrar

Objetivo: saber qué se puede mover sin romper. No refactorizar todo; identificar riesgos.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 2.1 | Revisar seguridad backend: auth, roles, ownership, campos editables, endpoints públicos | ☑ | YO |
| 2.2 | Revisar consistencia `ROLES_Y_PERMISOS.md` ↔ frontend ↔ backend | ☑ | YO |
| 2.3 | Detectar dependencias incompatibles con el container (rutas de archivo, /uploads local, etc.) | ☑ | YO |
| 2.4 | Inventariar todo acceso a archivos/imágenes que hoy use BYTEA o disco local | ☑ | YO |
| 2.5 | Smoke test funcional Reclamos (baseline pre-migración) | ⏭ diferido a Fase 3 | TÚ+YO |
| 2.6 | Smoke test funcional Cubicación (baseline pre-migración) | ⏭ diferido a Fase 3 | TÚ+YO |
| 2.7 | Smoke test funcional Admin (baseline pre-migración) | ⏭ diferido a Fase 3 | TÚ+YO |

> **Decisión (2026-06-09):** smoke tests baseline diferidos. No aportan valor corriendo aún en Render;
> se cubren con los smoke tests de la propia migración (3.8, 3.19). Render se mantiene en paralelo como
> respaldo y NO se apaga hasta que Cloudflare pase los smoke tests (cutover 3.20).
| 2.8 | Crear lista de riesgos bloqueantes antes de la migración → `docs/auditoria_fase2_riesgos.md` | ☑ | YO |

> **Resultado Fase 2 (ver `docs/auditoria_fase2_riesgos.md`):** migración de baja fricción (código ya
> trabaja en memoria, no escribe a disco). 3 hallazgos de seguridad: **H1** imágenes accesibles sin auth
> (ALTO, `reclamos.py:1671`), **H2** detalle de reclamo sin ownership/IDOR (MEDIO, `reclamos.py:960`),
> **H3** eliminar imagen sin ownership (MEDIO, ya en 6.1). Incorporados al programa abajo. Pendientes 2.2
> y smoke tests 2.5–2.7 requieren coordinación contigo (TÚ+YO).

---

## FASE 3 — Infraestructura: incorporar R2 (sin gasto, sin migrar hosting)

Objetivo: sacar las imágenes de la base de datos (hoy en BYTEA) y llevarlas a Cloudflare R2, manteniendo el programa donde ya corre. Lo urgente y de valor real es R2; el hosting se queda como está para no gastar.

> **Decisión de infraestructura (2026-06-09, FINAL):** se evaluó mover el programa a Cloudflare
> Containers y se DESCARTÓ por costo: Containers exige el plan Workers Paid ($5/mes) y, sobre la cuota
> gratuita, puede cobrar por uso — sin garantía de tope. Como ArmaHub es una iniciativa personal sin
> presupuesto hasta estar operativo, **el programa Python/FastAPI se mantiene en Render** (gratis). NO se
> reescribe a JS (sería rehacer meses de trabajo sin ganar calidad).
>
> **Arquitectura final v1.00 (TODA gratis, $0):**
> - Programa (FastAPI) → **Render** (donde ya corre; plan free).
> - Base de datos (PostgreSQL) → **Supabase** (plan free 500 MB, real y permanente; sin las imágenes
>   —que van a R2— entra cómodo). Migrar de Render a Supabase SÍ es parte del plan.
> - Archivos/imágenes → **Cloudflare R2** (plan free 10 GB; saca BYTEA de la BD).
>
> **Garantía de no-sorpresa (acordada con el usuario):** ninguna de estas 3 piezas arrastra otro servicio
> pagado ni se obligan entre sí. Supabase free no exige pagar Workers ni nada; R2 funciona desde Render.
> Si alguna pieza creciera más allá del free tier (improbable a escala inicial), se avisa ANTES con datos.
>
> Descartados los artefactos de Containers (Dockerfile, worker/, wrangler.toml, package.json) — se eliminan
> o quedan archivados, no se usan en esta arquitectura. `storage.py` y `boto3` SÍ se usan (son para R2).
> El cold start de Render se acepta por ahora; revisar plan de Render solo si molesta en producción.
>
> Estado adelantado: bucket R2 `armahub` creado; `storage.py` y `boto3` implementados y subidos.
> El usuario regenerará el API token R2 cuando toque (tarea 3.2).

### 3A. Conectar R2 al sistema actual (en Render)

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 3.1 | Eliminar artefactos de Containers no usados (Dockerfile, etc.) | ☑ | YO |
| 3.2 | Regenerar API token R2 (Object Read & Write, bucket `armahub`) y guardarlo seguro | ☑ | TÚ |
| 3.3 | Configurar env vars R2 en Render (validado con `/health/r2` → `storage:ok`) | ☑ | TÚ+YO |
| 3.4 | Refactor subida de imágenes de reclamos: guardar en R2, en BD solo `storage_key` (migración 53) | ☑ | YO |
| 3.5 | Refactor lectura de imágenes: servir desde R2 (presigned URL). **H1 CERRADO**: `ver_imagen` ahora exige auth + ownership | ☑ | YO |
| 3.6 | Validar upload/ver imágenes contra R2 — confirmado en producción (imágenes se ven) | ☑ | TÚ+YO |

### 3B. Migrar imágenes existentes a R2

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 3.7 | Migración one-shot: 28 imágenes BYTEA → R2 (endpoint temporal, no-destructivo, 28/28 OK) | ☑ | YO |
| 3.8 | Validar imágenes viejas desde R2 — confirmado (vistas en R2 y en los reclamos) | ☑ | TÚ+YO |
| 3.9 | Eliminar columna `data` (BYTEA) post-validación — PENDIENTE (BYTEA se conserva como respaldo hasta decidir) | ☐ | YO |

### 3C. Migrar base de datos a Supabase ✅ COMPLETADA

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 3.10 | Crear proyecto Supabase para ArmaHub (plan free, Session pooler) | ☑ | TÚ |
| 3.11 | Migrar datos de Render a Supabase (endpoint temporal con autodetección de tablas + verificación origen=destino; todas cuadran, 0 errores) | ☑ | YO |
| 3.12 | Cambiar `DATABASE_URL` en Render → Supabase (`?sslmode=require`) + validar | ☑ | TÚ+YO |
| 3.13 | Smoke test post-migración: login, proyectos, reclamos, crear reclamo de prueba — OK | ☑ | TÚ+YO |

> **Notas de la migración (2026-06-10):** se hizo vía endpoint temporal (ya retirado), no pg_dump (no
> había tools locales). Bugs depurados en el camino: auth pooler (usuario `postgres.{ref}` + contraseña sin
> símbolos), COUNT por tabla aislado, copiar solo columnas comunes (desfase `fecha_subida`/`fecha` en
> `reclamo_imagenes` y `proyecto_aliases` — esas columnas quedaron vacías en destino, dato secundario),
> TRUNCATE atómico (el CASCADE borraba `proyectos` ya copiada), INSERT ON CONFLICT DO NOTHING (idempotente).
> Render-Postgres se conserva como respaldo (no se apagó). BYTEA de imágenes también sigue como respaldo
> (tarea 3.9). Pendiente seguridad: rotar contraseña de BD (quedó visible en chat) y revocar token R2 viejo.

> **Orden sugerido:** hacer 3C (BD a Supabase) puede ir antes o después de 3A/3B (R2); son independientes.
> Conviene migrar la BD a Supabase ANTES de meter las imágenes a R2 NO es necesario — de hecho conviene
> sacar primero las imágenes pesadas (BYTEA→R2) para que el `pg_dump` a Supabase sea liviano. Sugerencia:
> 3A+3B (R2) primero, luego 3C (BD liviana a Supabase).

**Criterio de salida Fase 3:** imágenes en R2 (no BYTEA), BD en Supabase, programa en Render. Todo gratis. H1 cerrado.

> **Nota costo:** arquitectura $0 — Render free + Supabase free (500 MB) + R2 free (10 GB). Ninguna pieza
> arrastra otra pagada. Si algo creciera más allá del free tier, se avisa antes con datos. El dominio
> propio (Fase 15) es independiente. Salir de Render por el cold start = futuro, solo con presupuesto.

---

## FASE 4 — Arquitectura base de plataforma

Objetivo: definir dónde viven datos, archivos, permisos, auditoría y correo antes de crear calugas grandes.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 4.1 | Definir modelo común de documentos/adjuntos versionados (sobre R2 + metadata) | ☐ | YO |
| 4.2 | Definir contrato común de auditoría: usuario, fecha, entidad, acción, estado ant/nuevo | ☐ | YO |
| 4.3 | Definir convención de estados por entidad: obra, documento, plano, RDI, certificado | ☐ | TÚ+YO |
| 4.4 | Definir criterio de permisos por rol, cliente, obra y acción | ☐ | TÚ+YO |
| 4.5 | Implementar helper único de correo (SMTP/servicio) reutilizable por todas las calugas | ☐ | YO |
| 4.6 | Configurar SMTP/servicio de correo + validación en health check | ☐ | TÚ+YO |
| 4.7 | Definir convención frontend para nuevas calugas, tabs y subfeatures | ☐ | YO |
| 4.8 | Actualizar `armahub-protocolo.md` y `MODELO_DE_DATOS.md` con decisiones de arquitectura | ☐ | YO |

**Criterio de salida:** existe contrato de documentos, auditoría, permisos y correo reutilizable.

---

## FASE 5 — Administración del Sistema

Objetivo: reforzar la base administrativa antes de abrir calugas de obra/cliente.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5.1 | Consolidar gestión de usuarios y roles (incluye roles nuevos de obra/cliente) | ☐ | YO |
| 5.2 | Definir permisos por caluga, tab, obra y acción (matriz objetivo) | ☐ | TÚ+YO |
| 5.3 | Implementar vista de matriz de permisos objetivo | ☐ | YO |
| 5.4 | Ajustar auditoría global de acciones críticas al contrato común | ☐ | YO |
| 5.5 | Crear gestión de parámetros del sistema | ☐ | YO |
| 5.6 | Crear base de plantillas: certificados, correos, reportes | ☐ | YO |
| 5.7 | Implementar editor central de obras/clientes/constructoras/calculistas (entidades) con flujo hermético — gestión única, no creación dispersa (depende de decisión 7.9) | ☐ | YO |
| 5.8 | Cerrar la creación "al vuelo" de obras desde reclamos/import CSV: redirigir a selección de obra existente o flujo controlado de alta | ☐ | YO |
| 5.9 | Health/admin técnico: DB (Supabase), storage (R2), correo | ☐ | YO |

---

## FASE 6 — Calidad / Reclamos (hardening + cierre de pendientes)

Objetivo: endurecer Reclamos y cerrar los pendientes reales arrastrados, antes de multi-origen.

### 6A. Hardening

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 6.1 | Validar ownership en acciones correctivas y al eliminar imágenes (**H3** de auditoría Fase 2: `DELETE /reclamos/{id}/imagenes/{img}` no valida ownership) | ☐ | YO |
| 6.2 | **H2** de auditoría Fase 2: aplicar filtro ownership/rol al detalle `GET /reclamos/{id}` (`reclamos.py:960`) — hoy cualquier autenticado lee cualquier reclamo por ID (IDOR) | ☐ | YO |
| 6.3 | Revisar acceso a imágenes (ahora en R2) y documentar política | ☐ | TÚ+YO |
| 6.4 | QA visual del PDF de reclamo (campos largos, sin acciones, sin validación) | ☐ | YO |
| 6.5 | FIX: cubicador externo no tiene botón "enviar a validar" reclamo; los otros cubicadores sí. Revisar y corregir permiso | ☐ | YO |
| 6.6 | Optimizar query del listado de reclamos: reemplazar subconsulta correlacionada de seguimientos (COUNT por fila) por LEFT JOIN + GROUP BY; agregar índices para ORDER BY estado/prioridad/año/número. (No requiere worker; 72 registros es trivial. La lentitud actual es mayormente cold start de Render → se resuelve al migrar en Fase 3) | ☐ | YO |
| 6.7 | Evaluar tamaño de `reclamos.py` y separar solo si la legibilidad lo exige | ☐ | YO |

### 6B. Envío de informe por correo (arrastrado de PC.15)

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 6.5 | Crear tabla `reclamo_envios` (trazabilidad de envíos) | ☐ | YO |
| 6.6 | Endpoint `POST /reclamos/{id}/enviar-informe` usando el helper de correo de 4.5 | ☐ | YO |
| 6.7 | UI: columna/acción de envío en lista + mini-modal de destinatarios | ☐ | YO |
| 6.8 | Historial de envíos en detalle de reclamo | ☐ | YO |
| 6.9 | Indicadores de envío en dashboard de Calidad | ☐ | YO |

### 6C. Calidad multi-origen (arrastrado de ROADMAP_RECLAMOS R1–R4)

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 6.10 | Definir tipos (reclamo, no conformidad, observación, preventiva) y orígenes (cubicación, retail, planta) | ☐ | TÚ+YO |
| 6.11 | Crear tabla `clientes` (casos no ligados a obra) + CRUD | ☐ | YO |
| 6.12 | Agregar `id_cliente`, `origen`, `area` en reclamos | ☐ | YO |
| 6.13 | Evaluar rol `admin_reclamos` | ☐ | TÚ+YO |
| 6.14 | UI: selector de origen y obra/cliente según corresponda | ☐ | YO |
| 6.15 | Listado, detalle y dashboards segmentables por origen | ☐ | YO |
| 6.16 | Smoke test: reclamo obra → análisis → acciones → validación → PDF → envío → certificado | ☐ | TÚ+YO |

---

## FASE 7 — Discovery del dominio Obra (modelo común)

Objetivo: definir el modelo de obra/programa/expediente ANTES de construir las calugas que lo usan. Esto evita el retrabajo que tendría hacer Cubicación-integración u Obra a ciegas.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 7.1 | Definir ficha de obra objetivo: cliente, constructora, responsables, estados, fechas, metadata | ☐ | TÚ+YO |
| 7.2 | Definir estados de obra y semáforos | ☐ | TÚ+YO |
| 7.3 | Definir modelo de programa de obra: hitos, tareas, fechas, responsables | ☐ | TÚ+YO |
| 7.4 | Definir regla de cumplimiento: auto (cruce con carga Detailer ligada a tarea) vs manual + validación | ☐ | TÚ+YO |
| 7.5 | Definir estructura documental por obra (planos, RDI, certificados, antecedentes) | ☐ | TÚ+YO |
| 7.6 | Definir nomenclatura de planos, versiones, aprobaciones y obsoletos | ☐ | TÚ+YO |
| 7.7 | Definir RDI: campos, estados, adjuntos, responsables, flujo de respuesta del cliente | ☐ | TÚ+YO |
| 7.8 | Definir qué ve/edita el cliente vs el interno en el expediente (permisos por obra) | ☐ | TÚ+YO |
| 7.9 | Definir flujo hermético de alta de obra/cliente/constructora: quién puede crear, dónde, y relación entre entidades. Hoy se crean dispersamente (reclamos, import CSV) sin dueño claro → riesgo de cubicaciones en obras mal relacionadas. Define el editor central de 5.7 | ☐ | TÚ+YO |

---

## FASE 8 — Caluga Programa de Obra (interna)

Objetivo: que USC programe la obra y los cubicadores den cumplimiento.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 8.1 | Crear tablas: programa/hitos/tareas de obra + estados de cumplimiento | ☐ | YO |
| 8.2 | Backend: CRUD de programa y tareas | ☐ | YO |
| 8.3 | Backend: cumplimiento automático — detectar carga Detailer ligada a una tarea y marcar avance | ☐ | YO |
| 8.4 | Backend: cumplimiento manual — cubicador completa tarea sin Detailer → estado pendiente de validación | ☐ | YO |
| 8.5 | Backend: validación de cumplimiento manual por USC/jefatura | ☐ | YO |
| 8.6 | Crear caluga Programa de Obra en registry (visible a roles internos) | ☐ | YO |
| 8.7 | UI: vista de programa (hitos/tareas/semana), edición por USC | ☐ | YO |
| 8.8 | UI: marca de cumplimiento del cubicador + indicador auto/manual/validado | ☐ | YO |
| 8.9 | Permisos: USC edita programa, cubicador da cumplimiento, jefatura valida | ☐ | TÚ+YO |
| 8.10 | Smoke test: USC programa → cubicador cumple (auto y manual) → jefatura valida | ☐ | TÚ+YO |

---

## FASE 9 — Caluga Mis Proyectos (expediente, cliente + interno)

Objetivo: expediente de obra donde cliente y armacero ven y editan según permisos. Visualiza avance (de Fase 8) y cubicación.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 9.1 | Crear tablas: documentos de obra versionados, planos/versiones, RDI | ☐ | YO |
| 9.2 | Backend: CRUD documentos/planos/RDI sobre R2 + metadata | ☐ | YO |
| 9.3 | Backend: preview PDF; DWG solo almacenar + descargar | ☐ | YO |
| 9.4 | Backend: flujo RDI con respuesta del cliente | ☐ | YO |
| 9.5 | Backend: mailing a involucrados (usa helper de correo 4.5) ante RDI/eventos | ☐ | YO |
| 9.6 | Crear caluga Mis Proyectos en registry (cliente ve sus obras; interno las que correspondan) | ☐ | YO |
| 9.7 | UI: resumen de obra + avance (lee programa de Fase 8) | ☐ | YO |
| 9.8 | UI: documentos, planos/versiones, RDI con respuesta | ☐ | YO |
| 9.9 | UI: cliente aporta antecedentes y responde RDI | ☐ | YO |
| 9.10 | Permisos cliente: solo sus obras y documentos autorizados; gerente puede ver varias | ☐ | TÚ+YO |
| 9.11 | Mostrar certificados controlados por Calidad cuando existan | ☐ | YO |
| 9.12 | **Mini-revisión de seguridad antes de abrir acceso a clientes externos** (ver nota) | ☐ | TÚ+YO |
| 9.13 | Smoke test: interno crea obra → sube doc → versiona plano → crea RDI → cliente responde → recibe correo | ☐ | TÚ+YO |

> **Nota de seguridad (importante):** Mis Proyectos es la primera caluga que da acceso a **clientes externos**. El momento crítico de seguridad no es el final del desarrollo, sino **justo antes de que entre el primer cliente externo**. La tarea 9.12 adelanta una revisión acotada (ownership por obra, que un cliente no vea obras ajenas, endpoints expuestos, validación de uploads) sin esperar a la auditoría formal de Fase 15.

---

## FASE 10 — Cubicación: consolidar y conectar con Obra

Objetivo: mantener Cubicación estable y conectarla al programa/expediente de obra.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 10.1 | Confirmar selector de obra como fuente única de destino (ya implementado, validar) | ☐ | YO |
| 10.2 | Conectar carga Detailer con tarea de programa de obra (para cumplimiento auto de Fase 8) | ☐ | YO |
| 10.3 | Trazabilidad entre carga, plano, pedido, reclamo y exportación | ☐ | YO |
| 10.4 | Bar Manager con trazabilidad de plano/versión (de Fase 9) | ☐ | YO |
| 10.5 | Revisar permisos cubicador/cliente/admin por obra | ☐ | YO |
| 10.6 | Smoke test: obra → carga CSV → cumplimiento auto en programa → Bar Manager → pedido → exportación | ☐ | TÚ+YO |

---

## FASE 11 — CRM + Inteligencia Comercial

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 11.1 | Definir diferencia entre cliente, constructora, contacto, empresa y obra | ☐ | TÚ+YO |
| 11.2 | Revisar tabla `constructoras` y decidir migración a modelo CRM | ☐ | YO |
| 11.3 | Crear modelo cuentas/clientes, contactos, leads/oportunidades, seguimientos | ☐ | YO |
| 11.4 | Crear caluga CRM en registry con tabs | ☐ | YO |
| 11.5 | Permisos comerciales por rol | ☐ | TÚ+YO |
| 11.6 | Smoke test: cliente → contacto → oportunidad → seguimiento → obra vinculada | ☐ | TÚ+YO |

---

## FASE 12 — Procedimientos y Capacitación

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 12.1 | Definir tipos de procedimiento, versionado, vigencia y matriz cargo/procedimiento | ☐ | TÚ+YO |
| 12.2 | Crear tablas de procedimientos/versiones/aprobaciones y capacitaciones/evaluaciones | ☐ | YO |
| 12.3 | Crear caluga con biblioteca documental (búsqueda/filtros) | ☐ | YO |
| 12.4 | Vista de matriz de cumplimiento + flujo de evaluación simple | ☐ | YO |
| 12.5 | Smoke test: subir procedimiento → aprobar versión → asignar cargo → evaluar usuario | ☐ | TÚ+YO |

---

## FASE 13 — App Terreno

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 13.1 | Definir casos iniciales: checklist, fotos, observaciones, firma, protocolo PDF | ☐ | TÚ+YO |
| 13.2 | Decidir offline en v1 o futuro | ☐ | TÚ+YO |
| 13.3 | Autenticación de app y permisos por obra | ☐ | YO |
| 13.4 | Endpoints API: obras asignadas, checklist, evidencias (fotos a R2) | ☐ | YO |
| 13.5 | Generación de protocolo PDF desde datos de terreno | ☐ | YO |
| 13.6 | Decidir tecnología app (PWA, React Native/Expo) + prototipo mínimo | ☐ | TÚ+YO |
| 13.7 | Smoke test: usuario terreno → checklist → fotos → firma → protocolo PDF en obra | ☐ | TÚ+YO |

---

## FASE 14 — Automatizaciones, reportes e IA opcional

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 14.1 | Definir cola de trabajos (emails masivos, PDFs pesados, previews, reportes, IA) | ☐ | YO |
| 14.2 | Worker de correos / reportes pesados | ☐ | YO |
| 14.3 | **Worker de preview DWG** (Autodesk APS u ODA) — condicionado a costo | ☐ | TÚ+YO |
| 14.4 | Definir e implementar casos de IA solo si aprobados y medibles | ☐ | TÚ+YO |
| 14.5 | Dashboards por jefatura, cliente, calidad, ventas | ☐ | TÚ+YO |
| 14.6 | Monitoreo de workers y fallos | ☐ | YO |

---

## FASE 15 — Seguridad, performance y cierre de versión

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 15.1 | Política de contraseñas, MFA/SSO futuro y sesiones | ☐ | TÚ+YO |
| 15.2 | Auditoría de seguridad formal: OWASP Top 10 en endpoints críticos | ☐ | YO |
| 15.3 | Revisar ownership y aislamiento por obra/cliente en todas las calugas | ☐ | YO |
| 15.4 | Performance de queries sensibles + índices | ☐ | YO |
| 15.5 | Backup/restore documentado de Supabase y R2 | ☐ | YO |
| 15.6 | Configurar dominio propio apuntando a Cloudflare (DNS) — no mueve nada, solo referencia | ☐ | TÚ+YO |
| 15.7 | Checklist de release por caluga | ☐ | YO |
| 15.8 | Actualizar docs finales (protocolo, modelo, permisos, arquitectura) | ☐ | YO |
| 15.9 | Congelar `programa_v1.00.md` y crear siguiente versión | ☐ | TÚ+YO |

> **Nota dominio:** el dominio propio (ej. `armahub.cl`) no requiere mover ni reconstruir nada — solo se apunta (DNS) a donde ya corre el sistema en Cloudflare. Puede hacerse en cualquier momento (15.6 lo ubica antes del cierre por prolijidad, pero técnicamente es independiente). Cloudflare lo facilita por tener hosting y DNS en el mismo lugar.

---

## Backlog futuro no bloqueante

| N° | Descripción | Estado |
|----|-------------|--------|
| BF.1 | Integración SAP solo lectura | Futuro |
| BF.2 | Preview DWG avanzado | Condicionado a costo |
| BF.3 | Búsqueda semántica documental | Futuro |
| BF.4 | IA resumen/clasificación automática | Condicionado |
| BF.5 | SSO corporativo | Futuro |
| BF.6 | Offline completo App Terreno | Condicionado |
| BF.7 | SLA por origen/categoría + escalamiento automático (reclamos) | Futuro |
| BF.8 | Permisos granulares `user_permissions` (vs RBAC + ownership) | Si se justifica |

---

## Resumen del reordenamiento (vs programa CODEX)

| Cambio | Antes (CODEX) | Ahora |
|--------|---------------|-------|
| Estado de partida | Casi todo en ☐, ignora trabajo hecho | Estado real reconciliado con el código |
| Infraestructura | Fase 3, container completo, bloqueante | Fase 3 con R2 primero, orden R2→Supabase→container, validación antes de cutover |
| Calugas de obra | "Administrador de Obra" única, Cubicación antes que Obra | Programa de Obra (interno) + Mis Proyectos (cliente+interno) + Cubicación; discovery de obra (F7) antes de construir |
| Cumplimiento programa | No contemplado | Auto (Detailer) + manual con validación (F8) |
| Correo | Disperso (Reclamos + futuro) | Helper único transversal (F4.5), consumido por Reclamos y Mis Proyectos |
| Preview DWG | Ambiguo | PDF en v1; DWG almacenar+descargar, preview a worker futuro |
| Pendientes Reclamos (PC.15 envío, multi-origen) | No arrastrados | Arrastrados a F6B/6C |
