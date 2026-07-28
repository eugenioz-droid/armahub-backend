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
| 3.9 | Eliminar columna `data` (BYTEA) post-validación — migración 54 + código limpiado (2026-06-10) | ☑ | YO |

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

> **Decisión (2026-06-10):** las tareas de diseño transversal (estados, permisos, modelo de documentos,
> convención frontend) se disuelven como bloque previo. El diseño se hace caluga por caluga — cada fase
> define sus propios flujos y estados. La armonización transversal queda como tarea explícita al final
> (ver tarea 4.X abajo), una vez que haya calugas concretas que armonizar.
> Solo se ejecutan ahora las piezas que desbloquean trabajo inmediato: correo (4.5+4.6) y docs (4.8).

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 4.1 | Definir modelo común de documentos/adjuntos versionados | ⏭ disuelto → se define en F9 (Mis Proyectos) | — |
| 4.2 | Definir contrato común de auditoría | ⏭ disuelto → se ajusta caluga a caluga | — |
| 4.3 | Definir convención de estados por entidad | ⏭ disuelto → cada caluga define sus estados | — |
| 4.4 | Definir criterio de permisos por rol, cliente, obra | ⏭ disuelto → se define en F7/F9 | — |
| 4.5 | Implementar helper único de correo (Resend API, mailer.py) reutilizable | ☑ | YO |
| 4.6 | Configurar RESEND_API_KEY en Render + health check /health → mail:ok | ☑ | TÚ+YO |
| 4.7 | Definir convención frontend para nuevas calugas | ⏭ disuelto → se define al arrancar F6 | — |
| 4.8 | Actualizar `armahub-protocolo.md` y `MODELO_DE_DATOS.md` | ☑ | YO |
| 4.X | **Armonización transversal:** revisar estados, permisos, modelo de docs y convención frontend una vez que F6+F7+F9 estén construidas — ajustar inconsistencias entre calugas | ☐ | TÚ+YO |

**Criterio de salida:** correo operativo y docs actualizados. Armonización (4.X) se ejecuta post-F9.

---

## FASE 5 — Calidad / Reclamos (hardening + cierre de pendientes)

> **Reordenamiento (2026-06-10):** Admin se movió después de Programa de Obra (nueva F10) porque
> el pool de requisitos de Admin se aclara recién cuando las calugas de obra estén construidas.
> CRM y Procedimientos se mueven al final. El orden de calugas queda:
> F5 Reclamos → F6 Discovery Obra → F7 Mis Proyectos → F8 Programa de Obra →
> F9 Cubicación integrada → F10 Admin → F11 CRM → F12 Procedimientos → F13 Terreno →
> F14 Automatizaciones → F15 Cierre.

Objetivo: endurecer Reclamos y cerrar los pendientes reales arrastrados.

### 5A. Hardening

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5.1 | Validar ownership en acciones correctivas y al eliminar imágenes (**H3**: `DELETE /reclamos/{id}/imagenes/{img}` no valida ownership) | ☑ | YO |
| 5.2 | **H2** IDOR: aplicar filtro ownership/rol al detalle `GET /reclamos/{id}` — hoy cualquier autenticado lee cualquier reclamo por ID | ☑ | YO |
| 5.3 | Revisar política de acceso a imágenes en R2 y documentar — presigned URL 1h aceptado uso interno | ☑ | TÚ+YO |
| 5.4 | QA visual del PDF de reclamo (campos largos, sin acciones, sin validación) | ☑ | YO |
| 5.5 | FIX: cubicador externo sin botón "enviar a validar" + ocultar sección validación a no-admin | ☑ | YO |
| 5.6 | Optimizar query listado reclamos: LEFT JOIN + GROUP BY + índices para ORDER BY | ☑ | YO |
| 5.7 | Evaluar tamaño de `reclamos.py` y separar solo si la legibilidad lo exige | ⏭ diferido a F9 | YO |
| 5.18 | Refactorizar navegación de Calidad/Reclamos: convertir Dashboards y Procedimientos a tabs reales del shell (patrón Cubicación) — extrae HTML a `tabs/rec_dashboards.html` y `tabs/rec_procedimientos.html`, registra en `shell.js`, elimina `switchRecTab` para esos paneles | ☑ | YO |

### 5D. Módulo Matrices RCA + rediseño caluga (implementado en esta sesión)

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5.19 | Renombrar caluga "Reclamos" → "Calidad / Reclamos" en registry | ☑ | YO |
| 5.20 | Separar áreas: Ventas C&D y Ventas MPEC (antes una sola "Ventas") — 11 áreas totales | ☑ | TÚ+YO |
| 5.21 | Migraciones 55–58: tablas `areas`, `area_usuarios`, `area_rca_categorias`, `area_rca_subcausas` + seed 11 áreas + matriz Ishikawa de Cubicaciones | ☑ | YO |
| 5.22 | Backend: endpoints `GET/PUT /admin/areas` y `GET/PUT /admin/areas/{id}/rca` | ☑ | YO |
| 5.23 | Editor Matrices RCA en tab Admin (por área, edición por categoría Ishikawa, colores por categoría) | ☑ | YO |
| 5.24 | Definir estructura de tabs: Nivel 1 (shell) = Reclamos / Dashboards / Procedimientos; Nivel 2 (sub-tabs internos) = Reclamos Clientes / Reclamos Internos / Matriz RCA / Presentaciones | ☑ | TÚ+YO |
| 5.25 | Editor Matrices RCA en Nivel 2 de Calidad/Reclamos (Jefes de Servicio editan su matriz) | ☑ | YO |
| 5.26 | Smoke test visual: tabs Nivel 1 y Nivel 2, editor RCA por área, dashboards | ☐ | TÚ |

### 5E. Pendientes Nivel 2 (sub-tabs internos)

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5.27 | Implementar Reclamos Internos (área→área; tipo_origen, área destino, cliente opcional Armacero, responsable=jefe de área, flujo por flag) — probado 2026-06-13. | ☑ | YO |
| 5.52 | Ajustes post-prueba Internos: eliminar "Detectado por" (se infiere de creado_por), N° calidad serie independiente por tipo_origen, Cliente/Obra pasa a combobox buscable con "Armacero" por defecto, fecha detección prellenada con hoy (Externos e Internos) | ☑ | YO |
| 5.28 | Implementar 5 Por Qué como método RCA alternativo a Ishikawa (por reclamo, excluyente) — migración 68, selector radio, campos dinámicos hasta 5, guardar/cargar, visualización en Presentaciones | ☑ | YO |
| 5.53 | FIX: endpoint /reclamos/ishikawa lee desde BD por area_id (ya no devuelve hardcode de Cubicaciones a todas las áreas) | ☑ | YO |
| 5.29 | Rol Jefe de Servicio: activar en flujos de RCA y área — RESUELTO opción A (jefe_servicio + area_usuarios). Implementado en 5G. | ☑ | TÚ+YO |
| 5.54 | FIX flujo devolución desde Calidad: `devolverValidacionDesdeModal` usaba `en_revision` hardcodeado — ahora lee `area_tiene_revision` (ext) o `area_tiene_revision_interno` (int) para decidir destino | ☑ | YO |
| 5.55 | FIX refresh post-acción: `_refrescarTrasAccionFlujo`, `cerrarReclamo`, `guardarRespuesta`, `eliminarReclamo` ahora llaman `loadReclamosInternos()` para internos y `loadReclamos()` para externos | ☑ | YO |
| 5.56 | FIX cambiar "Aplica" ya no recarga el modal completo (no borra formulario RCA) — actualiza memoria + badge sin `verReclamo` | ☑ | YO |
| 5.57 | FIX `cerrarReclamo` incluye metodo_rca y cinco_por_que en el PATCH para no perder análisis RCA al cambiar estado | ☑ | YO |
| 5.58 | FIX listado Validación Calidad: filtro usaba `es_interno` (inexistente) → corregido a `tipo_origen === 'interno'` | ☑ | YO |
| 5.59 | FIX Proyecto editable en estado validación/revisión — `recDetailProyecto` ahora usa `puedeEditarSec1` | ☑ | YO |
| 5.60 | FIX nombre proyecto interno sin obra muestra "Armacero" (antes "Obra eliminada") — CASE en SQL por tipo_origen | ☑ | YO |
| 5.61 | Panel Áreas: columna "Flujo Revisión" con dos checkboxes Ext/Int independientes — migración 69 `tiene_revision_interno` | ☑ | YO |
| 5.62 | Label dinámico "Cubicador/Responsable área" en modal de reclamo según tipo_origen | ☑ | YO |
| 5.63 | Responsable en acciones: combobox (input+datalist) en vez de select fijo | ☑ | YO |
| 5.64 | Área responsable + Fecha análisis movidos fuera del bloque Ishikawa (visibles siempre independiente del método RCA) | ☑ | YO |
| 5.65 | Fecha análisis prefillada con hoy si está vacía al abrir el modal | ☑ | YO |

### 5F. Refactor roles + flujo de validación (iniciado sesión 2026-06-11)

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5.30 | Renombrar rol `admin2` → `admin_calidad` en todo el sistema (código + migración 59 + docs + labels UI) | ☑ | YO |
| 5.31 | Reemplazar filtros desplegables de Aplica por botón toggle único en listado reclamos | ☑ | YO |
| 5.32 | Agregar estado `en_revision` al flujo de reclamos (migración 60 + constantes + labels + colores) | ☑ | YO |
| 5.33 | Botón dinámico: cubicador "Enviar a revisión", admin "Enviar a validación", admin "Aprobar para validación" cuando está en revisión | ☑ | YO |
| 5.34 | Mover sección Validación fuera del detalle de reclamo → sub-tab Validaciones | ☑ | YO |
| 5.35 | Sub-tab Validaciones: "Mi revisión" (Jefe Servicio — cola en_revision, botones Aprobar/Devolver con motivo) | ☑ | YO |
| 5.36 | Sub-tab Validaciones: "Validación Calidad" (admin_calidad — listas, panel de acción con datos reales, KPIs) | ☑ | YO |
| 5.37 | Devolución: Jefe Servicio devuelve en_revision → en_analisis con motivo (timeline); Calidad rechaza vía PA.5 | ☑ | YO |
| 5.38 | Smoke test flujo completo: cubicador → en revisión → aprobado → en validación → cerrado/devuelto | ☐ | TÚ |
| 5.39 | KPIs "Validación Calidad": Abiertos/Cerrados reales ahora. Devueltos y Tiempo prom. → diferidos a sección de reportes (5.40) | ◐ | YO |
| 5.40 | Sección de Reportes/Consultas de reclamos (devueltos por período, tiempos de respuesta, etc.) — diseño + implementación | ☐ | TÚ+YO |

**✅ DECISIÓN RESUELTA (2026-06-12) — Modelo de acceso por área:** opción **A** (rol único `jefe_servicio` + `area_usuarios`). Implementado en 5G. Flujo = uno con etapa de revisión OPCIONAL por área (flag `areas.tiene_revision`). Devolución desde validación rebota a `en_revision`. Detalle en `docs/PLAN_MODELO_AREAS.md` y memoria.

### 5G. Modelo de áreas + refactor detail.js + configurabilidad (sesiones 2026-06-12/13)

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5.41 | Sección verde Validación = misma gráfica que ámbar (Devolver/Aprobar, explicación obligatoria, sin desplegable/tiempo) | ☑ | YO |
| 5.42 | Bloqueo read-only del formulario fuera de análisis (todos los roles); explicación obligatoria al aprobar/devolver | ☑ | YO |
| 5.43 | Modal context-aware robusto: secciones de flujo solo si sub-tab Validaciones visible (DOM, no variable pegada) | ☑ | YO |
| 5.44 | Listado ordenado por más nuevo arriba; botones de filtro reordenados; filtro Abiertos/Cerrados; limpieza console.log | ☑ | YO |
| 5.45 | **Refactor detail.js (1.290 líneas) → 4 archivos** (detail-render/permissions/flow/edit). Reutilizable para Internos | ☑ | YO |
| 5.46 | **Panel de gestión de Áreas en Admin** (CRUD áreas, flag tiene_revision, asignar usuarios por área con rol) — migración 63 | ☑ | YO |
| 5.47 | reclamos.area_id (FK) inferido del responsable; flujo decidido por flag tiene_revision (no heurística de texto) — migración 64 | ☑ | YO |
| 5.48 | "Área responsable" del modal pasa a solo-lectura (se infiere, no se elige) | ☑ | YO |
| 5.49 | Quién levanta reclamos CONFIGURABLE por rol (externo/interno) — tabla reclamo_crear_config + panel Admin — migración 65 | ☑ | YO |
| 5.50 | Visibilidad del formulario de creación según config (GET /reclamos/puedo-crear), no hardcode | ☑ | YO |
| 5.51 | Smoke test del flujo configurable (área con/sin revisión, flag manda, quién levanta) | ☐ | TÚ |

### 5H. Refactor de modelo de roles y panel Admin (sesión 2026-06-15)

> **Decisión de arquitectura (2026-06-15, APROBADA):** separar nivel de acceso (rol global) de pertenencia a área (rol_area). Roles globales quedan en 4: `admin`, `admin_calidad`, `miembro`, `cliente`. Los roles `cubicador`, `usc`, `externo` se deprecan como roles globales — pasan a ser `miembro` de un área con `rol_area` correspondiente. Permisos por rol de área serán configurables via tabla `area_rol_permisos` (mismo patrón que `reclamo_crear_config`). Ver análisis completo en conversación 2026-06-15.

> **RECONCILIACIÓN 2026-06-17 (auditoría código vs programa):** este bloque figuraba
> como 0% pero en realidad está **~85% hecho** — se implementó en sesiones de junio sin
> marcar. Estado real verificado leyendo el código abajo. Lo que queda es menor (5H.4
> helper nombrado, 5H.14 frontend por área, y smoke tests que validas con usuarios reales).

#### Fase A — BD: compatibilidad hacia adelante

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5H.1 | Migración 70: quitar CHECK hardcodeado de `users.role` | ☑ | YO |
| 5H.2 | Migración 71: poblar `area_usuarios` (backfill roles legacy → área+rol_area) | ☑ | YO |
| 5H.3 | `miembro` en VALID_ROLES (`auth.py`) + formulario crea con 4 roles objetivo | ☑ | YO |

#### Fase B — Backend: lógica de permisos lee area_usuarios

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5H.4 | Helper de rol por área en `reclamos.py` | ◧ | YO |
| 5H.5 | Tabla permisos configurables — migración 72 `area_rol_permisos`, luego migración 73 `role_permisos` (permisos por rol global) | ☑ | YO |
| 5H.6 | Checks de permiso leen `role_permisos` (`_rol_puede_crear`) + `area_usuarios` | ☑ | YO |
| 5H.7 | `/me` devuelve `areas` (`{area_id, area_nombre, area_slug}`) | ☑ | YO |
| 5H.8 | Smoke test backend (crear/responder/validar por rol) | ☐ | TÚ+YO (con usuarios reales) |

#### Fase C — Panel Admin: reorganización en 3 sub-tabs

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5H.9 | Sub-tab "Organización" (áreas + usuarios) | ☑ | YO |
| 5H.10 | Sub-tab "Configuración" (quién levanta, permisos por rol, notificaciones, matriz roles) | ☑ | YO |
| 5H.11 | Sub-tab "Sistema" (estado BD, datos, reset) | ☑ | YO |
| 5H.12 | Smoke test panel Admin | ☐ | TÚ |

> **Decisión 2026-06-17 — dónde vive la configuración:** la config de **Calidad/Reclamos
> y avisos** se centraliza en el engranaje **Calidad → ⚙️ Configuración** (NO en Admin).
> Lógica: a futuro se habilitará a ciertos usuarios el acceso a esa zona SIN darles el
> panel de Administración completo. Admin queda para lo transversal (usuarios, áreas,
> sistema). Esto implica MOVER/replicar desde Admin→Configuración hacia Calidad→Config:
> quién levanta reclamos, permisos por rol, notificaciones de reclamos, plantillas de
> correo (ya está). Tarea: **5K** (abajo).

#### Fase D — Frontend: permisos basados en area_usuarios

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5H.13 | Shell expone `currentAreas` vía `/me` | ☑ | YO |
| 5H.14 | `detail-permissions.js` por rol de área (`currentAreaRol`) en vez de rol global legacy | ☐ | YO |
| 5H.15 | Smoke test frontend permisos por rol | ☐ | TÚ |

### 5I. Mejoras UX formularios y listados reclamos (sesiones 2026-06-13/15)

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5I.1 | Sub-tab "Datos maestros" en Admin (Constructoras, Calculistas, Gestión de Proyectos separados de Configuración) | ☑ | YO |
| 5I.2 | Label rol Externo: eliminar "(legacy)" en panel Admin | ☑ | YO |
| 5I.3 | Revisiones (sub-tab Validaciones): dos listas separadas Clientes / Internos, misma columna que Validaciones | ☑ | YO |
| 5I.4 | Modal externo: Proyecto/Obra y Cubicador Responsable como combobox buscable (input+datalist) | ☑ | YO |
| 5I.5 | Modal interno: Área responsable como combobox buscable; Responsable asignado eliminado (lo asigna el backend) | ☑ | YO |
| 5I.6 | FIX A1: `toggleNuevoInterno()` pasa a async, espera `initInternosForm()` antes de abrir modal | ☑ | YO |
| 5I.7 | FIX crítico: `var btn` no declarado en `_render5PQData` crasheaba todo reclamo con método 5 Por Qué | ☑ | YO |
| 5I.8 | Preselección método RCA: si área sin matriz → 5 Por Qué preseleccionado, Ishikawa deshabilitado | ☑ | YO |
| 5I.9 | Filtros "Mis Reclamos" y "Aplica" en listado internos (botones morados, ciclo de estados) | ☑ | YO |
| 5I.10 | Campo "Tiempo respuesta" eliminado de formulario análisis (queda hidden) | ☑ | YO |
| 5I.11 | USC Responsable: eliminado del formulario de creación externo (auto-asigna backend); reasignación solo desde header del detalle (admin/admin_calidad) | ☑ | YO |
| 5I.12 | Banner encabezado diferenciado: verde (#43a047) clientes, morado (#9c27b0) internos; texto blanco 15px | ☑ | YO |
| 5I.13 | Header detalle: Año y N° calidad convertidos a hidden (no editables desde ahí, se editan via form "Editar") | ☑ | YO |
| 5I.14 | FIX `_setRcaMetodo`: fuerza display de bloques directamente sin depender del :checked (evita bug con radio disabled) | ☑ | YO |
| 5I.15 | SVG Renderizador 2D (deseable futura versión): catálogo de figuras base de barras, renderizado escalado por dimensiones, exportación a imagen/PDF | ☐ | TÚ+YO |
| 5I.16 | FIX sesión 2026-06-16: matriz RCA — quitado toggle activo/inactivo de sub-causas (causaba matriz "verde con 0 causas" y modal Ishikawa vacío); causas siempre activas; matriz usable solo si tiene ≥1 sub-causa en alguna de las 6 M; badge verde solo con sub-causas reales; botón "Guardar cambios" movido arriba del editor | ☑ | YO |
| 5I.17 | FIX sesión 2026-06-16: sub-tabs Nivel 2 visibles de inmediato (flujo uniforme `REC_SUBTABS` para los 5); F5 mantiene posición exacta (hash `#mod&tab&sub`, restauración sin parpadeo); 3 sub-tabs restringidos nacen visibles en HTML (no-cacheable) y JS solo oculta por rol | ☑ | YO |
| 5I.18 | FIX sesión 2026-06-16: editar reclamo interno (TypeError `srcUsc.options` — `recAsignadoA` es input hidden, no select); reasignación interna por ÁREA (no usuario), recalcula Jefe de Servicio; editar internos sin campos de externo (Detectado por / Responsable ocultos); responsable externo = cualquier usuario (no filtrar por rol cubicador/externo); Obra en header siempre texto; selector reasignación quitado del header (solo vía Editar) | ☑ | YO |

#### 5I.19 — Separar la vista de Reclamos Internos de la de Externos (refactor anti-fragilidad) — PLANIFICADO, no ejecutar aún

**Motivación:** hoy el modal de reclamos (modo lectura = render del detalle, y modo edición = formulario) está compartido entre externos e internos vía `if (tipo_origen === 'interno')`. Esa bifurcación es el origen comprobado de la mayoría de los bugs de las sesiones 13-16 jun (USC en internos, campos de más al editar, obra como desplegable, responsable vacío, TypeError de Editar). Separar las vistas elimina esa clase de bug de raíz. **NO se toca la tabla BD** (single-table con discriminador `tipo_origen` + columnas nullable es un patrón válido; las inconsistencias venían de la UI, no de la BD — confirmado). No es framework genérico ni rediseño: es separar componentes manteniendo formatos, flujos y funcionamiento idénticos.

**Momento óptimo:** ahora internos tiene 0 reclamos válidos (solo pruebas). Cuanto más data, más caro separar.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5I.19.1 | **Inventario congelado (red anti-regresión).** `docs/programa-versiones/inventario_forms_reclamos.md`: estado actual de los 4 forms, render, cruces y checklist. Durante el inventario se detectó y corrigió bug latente: `area_id` faltaba en `ReclamoUpdate` (reasignación de área interna se descartaba en silencio). | ☑ | TÚ+YO |
| 5I.19.2 | Separar el **formulario de edición** de internos: `recEditFormInterno` propio (HTML + `toggleEditarReclamoInterno`/`guardarEdicionReclamoInterno`). `recEditForm` quedó puro externo; `toggleEditarReclamo` enruta por `tipo_origen`. Cero `if (esInterno)` en edición. | ☑ | YO |
| 5I.19.3 | **Render del detalle: NO se separa (decisión crítica).** Medido: quedaban solo 3 bifurcaciones triviales y sanas (label responsable, mostrar área-texto, ocultar selector USC). Separarlo duplicaría header/antecedentes/respuesta que comparten RCA/acciones/validaciones/PDF → menos limpio, más riesgo. Se comparte lo igual, se separa lo que diverge (form de edición, ya hecho). Se aprovechó para eliminar el label legacy "Cubicador" → "Responsable" (el rol cubicador ya no existe; hoy son miembros por área). | ☑ | YO |
| 5I.19.4 | Validar contra el inventario 5I.19.1: smoke test de los 4 formularios (crear/editar × externo/interno) + cruces RCA/5PQ/acciones/validaciones. Cero cambios de formato/flujo respecto al "antes". **Aprobado por el usuario 2026-06-16 (smoke test de flujos y formularios OK).** | ☑ | TÚ |

> **Reglas del refactor (no romper):** no cambia formatos, ni flujos, ni funcionamiento; solo mueve la lógica bifurcada a componentes separados. Cuidado con los cruces: matrices Ishikawa, método RCA (Ishikawa/5PQ), acciones correctivas, validaciones y PDF se comparten y NO deben alterarse. La tabla BD NO se separa.

### 5J. Depuración legacy del sistema (roles sin oficio) — PLANIFICADO

**Contexto:** la migración de roles-con-oficio (`cubicador`) a roles-con-nivel-por-área (`miembro`/`jefe_servicio`) está hecha a nivel de USUARIOS (verificado 2026-06-16: 0 usuarios con rol `cubicador`; roles vivos = admin, admin_calidad, cliente, miembro, externo). Pero el CÓDIGO arrastra **374 ocurrencias de "cubicador" en 33 archivos**. Hay que depurarlas de forma ordenada. Aprovechar para revisar/limpiar código en el camino.

**Análisis de riesgo (3 grupos, hecho 2026-06-16):**

| Grupo | Qué es | Riesgo | Acción |
|---|---|---|---|
| **A** | `cubicador` JUNTO a `miembro` en checks de permisos (ej. `("cubicador","externo","miembro","jefe_servicio")`) | Ninguno (los usuarios ya entran por `miembro`). Código muerto inofensivo. | Quitar `cubicador` (cosmético/limpieza). |
| **B** | `cubicador` SOLO, sin `miembro` | **BUG ACTIVO** — devuelve vacío hoy | Arreglar (ver 5J.2). |
| **C** | Nombres internos BD/API (`cubicador_asignado`, columnas) | Romper BD/contrato si se tocan | **NO tocar columnas.** Solo labels visibles. |

**Bug activo identificado (Grupo B):** queries de dashboards/KPIs filtran `WHERE role = 'cubicador'` y devuelven VACÍO desde la migración (KPIs por cubicador rotos). Ubicaciones: `reclamos.py:147,742,767,959,1189` (caché "ve todo" + queries de KPI). El fix correcto: contar a los **miembros del área Cubicaciones**, no el rol muerto.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5J.1 | **Inventario de residuales legacy** → `docs/programa-versiones/inventario_legacy_cubicador.md` (3 grupos, ubicaciones, orden, checklist). | ☑ | YO |
| 5J.2 | **FIX bug activo (Grupo B):** KPIs/listas que filtraban `role='cubicador'` (vacíos) → por respuesta_por sin filtro de rol; asistentes = miembros del área Cubicaciones; caché/acceso "ve todo" solo admin (no miembro). | ☑ | YO |
| 5J.3 | **Limpieza Grupo A + B.3:** quitado `'cubicador'` muerto de permisos (backend+frontend); acceso a Cubicación/Presentaciones/notif/borrar-obra dado a `miembro`; visibilidad reclamos (externo=propios, miembro=por área). **Bug 403 resuelto:** `initInternosForm` pedía `/admin/areas` (admin-only) → nuevo endpoint ligero `/reclamos/areas` para cualquier autenticado. Validado por usuario 2026-06-16. | ☑ | YO+TÚ |
| 5J.4 | **Labels visibles:** "Cubicador Responsable"→"Responsable" en forms/detalle (hecho 5I.19.3); títulos de gráficos "Por Cubicador Asignado"→"Por Responsable Asignado" y "Kilos (Cubicador)"→"(Responsable)". Opción "Cubicador" del campo "Detectado por" NO se toca: es taxonomía con data, va en tarea futura 5J.8. | ☑ | YO |
| 5J.5 | **Decisión rol `cubicador` en VALID_ROLES / ROL_MAP / registry:** definir si se retira el rol del catálogo (auth.py, admin.py, registry.js) o se deja como alias. Solo tras 5J.2–5J.4. | ☐ | TÚ+YO |
| 5J.6 | Validación final: smoke test de permisos por cada rol vivo (admin, admin_calidad, cliente, miembro, externo) + dashboards con datos. Cero regresión. | ☐ | TÚ |
| 5J.8 | **(FUTURO) Rediseñar campo "Detectado por"** (columna texto `detectado_por`, hoy valores: Constructora/USC/Cubicador/Producción). Es taxonomía de "quién detectó el problema", NO el rol — se usa solo como filtro estadístico, no afecta lógica/permisos. Decisión pendiente: ¿cambiar a Áreas? ¿qué se quiere medir realmente? Requiere migrar los registros existentes (valores guardados como texto). No urgente; el campo es opcional/"por si acaso". | ☐ | TÚ+YO |
| 5J.7 | **(FUTURO, tarea propia) Renombre de columna BD `cubicador_asignado` → `responsable_asignado`** para dejar el esquema coherente con el modelo sin oficio. NO se hace junto con 5J.1–5J.6 (riesgo distinto: toca BD + migración SQL + datos existentes + todas las queries + modelos API + frontend, sincronizado). Requiere su propio inventario, migración y validación. Solo cuando 5J.1–5J.6 estén cerrados y haya ventana para hacerlo con cuidado. | ☐ | TÚ+YO |

> **Regla:** la columna BD `cubicador_asignado` y claves API equivalentes se MANTIENEN durante 5J.1–5J.6 (renombrarlas es la tarea separada 5J.7, fuera del alcance de la limpieza de rol-muerto/labels). No es incorrecto renombrarlas — es un trabajo de mayor riesgo (migración de esquema) que se hace aparte. Ver memoria [[project-armahub-roles-sin-oficio]].

### Decisiones de arquitectura registradas (pre-producción, NO implementar ahora)
- **Producto vendible = SOLO módulo Reclamos/Calidad** (no todo ArmaHub). Configurabilidad = núcleo solo de ese módulo. (memoria: producto-vendible)
- **Rediseño de admin god-mode:** "configurar sistema" debe ser un rol (`config_sistema`), no un comodín con overrides `=== 'admin'`. NO selector de roles ni 2 logins. (memoria: rediseno-admin)
- **Identidad de usuario:** email = llave hoy; NO varios usuarios por correo; truco `+alias` ahora, login por username pre-producción. (memoria: identidad-usuario)
- **Combobox buscable:** mejora transversal documentada en `docs/TAREA_COMBOBOX_BUSCABLE.md` (levantamiento de dónde aplica). Sin impacto de rendimiento.

### 5B. Envío de informe por correo (arrastrado de PC.15)

> **Diseño acordado 2026-06-16** → ver `docs/programa-versiones/propuesta_correo_5B.md`.
> Envío MANUAL del informe validado: admin de calidad, reclamo en `cerrado`, PDF
> adjunto, destinatarios pre-cargados desde involucrados del proyecto (todos tildados,
> se pueden destildar) + correos manuales, cuerpo editable desde plantillas, marcador
> "enviado" + historial. Correos automáticos = caluga futura (panel en Calidad/Configuración).
>
> **Preparado por adelantado 2026-06-16 (no rompe nada, aditivo):**
> - Tab **Calidad → ⚙️ Configuración** (nivel 1, junto a Procedimientos; solo admin). `rec_settings.html` + `settings.js` registrados.
> - Migración **74**: tablas `correo_templates` (plantillas) + `reclamo_envios` (trazabilidad) + plantilla semilla `informe_validado`.
> - CRUD de plantillas: endpoints `/admin/correo-templates` (GET/POST/PUT/DELETE) + UI funcional en Configuración → Plantillas de correo.
>
> **Prerrequisito externo (TÚ):** verificar dominio en Resend (DNS de `armacero.cl` vía TI) o definir `MAIL_FROM` alternativo. Sin dominio verificado, Resend no envía a externos. NO bloquea construir; bloquea el envío real a clientes.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5.7a | Tab Calidad/Configuración + estructura plantillas (esqueleto) | ☑ | YO |
| 5.7b | Migración 74: `correo_templates` + `reclamo_envios` + CRUD plantillas | ☑ | YO |
| 5.7c | Verificar dominio Resend / definir MAIL_FROM (prerrequisito envío externo) | ☐ | TÚ |
| 5.8 | `mailer.py`: soporte de **adjuntos** (Resend `attachments` base64) | ☑ | YO |
| 5.8b | Extraer generación de PDF (`_ReclamoPDF`) a helper reutilizable (`_generar_pdf_reclamo`) | ☑ | YO |
| 5.9 | Endpoint `POST /reclamos/{id}/enviar-informe` (valida cerrado+admin, genera PDF, adjunta, envía, registra en `reclamo_envios`) | ☑ | YO |
| 5.9b | Endpoint `GET /reclamos/{id}/involucrados` (correos sugeridos desde `proyecto_usuarios`) | ☑ | YO |
| 5.10 | UI: envío de informe (mini-modal destinatarios + cuerpo desde plantilla, anti-reenvío "CONFIRMAR"). Vive en sub-tab "Cierre Reclamos" (5K.3), no en el detalle | ☑ | YO |
| 5.11 | Marcador "informe enviado" + historial de envíos (estado en lista de Cierre Reclamos + `reclamo_envios`) | ☑ | YO |
| 5.12 | Indicadores de envío en dashboard de Calidad | ☐ | YO |

### 5C. Calidad multi-origen

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5.13 | Definir tipos (reclamo, no conformidad, observación, preventiva) y orígenes (cubicación, retail, planta) | ☐ | TÚ+YO |
| 5.14 | Agregar `origen` y `area` en reclamos — hecho vía `tipo_origen` (externo/interno) + `area_id` (5G) | ☑ | YO |
| 5.15 | Evaluar rol `admin_reclamos` | ☐ | TÚ+YO |
| 5.16 | UI: selector de origen; listado/detalle/dashboards segmentables por origen | ☐ | YO |
| 5.17 | Smoke test: reclamo → análisis → acciones → validación → PDF → envío | ☐ | TÚ+YO |

### 5K. Tab "Mailing" en Calidad (decisión 2026-06-17)

> El engranaje **Calidad → ⚙️ Mailing** (renombrado de "Configuración") centraliza el
> correo. Solo admin/admin_calidad. NO se mueven aquí los paneles de Admin (quién levanta,
> notificaciones in-app, permisos) — esos quedan en Admin. **Dos tipos de correo, separados:**
> (1) **informe de reclamo cerrado** = manual, con PDF, en sub-tab "Cierre Reclamos";
> (2) **avisos automáticos** = disparados por eventos, en sub-tab "Envío automático" (futuro).
> Tres sub-tabs: **Plantillas de correo** · **Cierre Reclamos** · **Envío automático**.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5K.1 | Tab Calidad/Mailing (engranaje nivel 1, solo admin/admin_calidad) | ☑ | YO |
| 5K.2 | Sub-tab "Plantillas de correo": CRUD (clave/nombre/asunto/cuerpo). Editor avanzado (campos seleccionables, destinatarios por tipo) = ampliación futura | ☑ | YO |
| 5K.3 | Sub-tab "Cierre Reclamos": lista de cerrados (filtro por año) + estado de envío + botón Enviar/Reenviar; anti-reenvío con confirmación "CONFIRMAR". Envío centralizado AQUÍ (se quitó el botón del detalle del reclamo) | ☑ | YO |
| 5K.4 | Sub-tab "Envío automático": placeholder (caluga futura — avisos por evento sobre matriz notificaciones) | ☑ | YO |

**Criterio de salida:** hardening cerrado, matrices RCA operativas, smoke test visual aprobado, correo de informe operativo, multi-origen definido, sub-tabs internos completos.

### 5L. Feedback de reclamos (sesión 2026-07) — auditado contra código

> Origen: feedback del usuario sobre el módulo de Reclamos. Cada tarea fue verificada
> contra el código real antes de listarla. Decisiones ya tomadas marcadas en la tarea.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5L.1 | FIX: quitar `<option>` "Cerrado" duplicado en desplegable de seguimiento — resuelto al eliminar el bloque completo (ver 5L.5) | ☑ | YO |
| 5L.2 | FIX zona horaria: convertir UTC→Chile (`America/Santiago`) en `shared/formatters.js` (formatDateTime/Short/Input) vía `Intl`, maneja los 3 formatos ISO + no toca fechas puras. Listados de reclamos migrados a `formatDateShort`. DECIDIDO: display-only | ☑ | YO |
| 5L.3 | Implementar edición de acciones en la UI. Botón ✏️ por acción → carga valores en el form (modo edición, con selector de estado) → PATCH. Permiso backend: creador de la acción o admin/admin_calidad | ☑ | YO |
| 5L.4 | FIX Ishikawa al cambiar responsable. La causa raíz responde al ÁREA: se limpia SOLO cuando `area_id` cambia de valor (externos: por responsable; internos: reasignación directa). Si el área se mantiene, NO se toca (antes se perdía siempre). Backend devuelve `ishikawa_limpiado_por_area`; frontend avisa con toast. DECIDIDO | ☑ | YO |
| 5L.5 | Eliminar input de "Agregar seguimiento" MANUAL del modal; mantener el timeline/historial automático de estados. Se limpió HTML + `agregarSeguimiento()` + registro + reset. DECIDIDO | ☑ | YO |
| 5L.6 | Ampliar categorías de error (externos + internos): agregadas Documentación, Stock, Programación, Diferencia de Kilogramos (ADICIONALES, no reemplazan). Migración 77 (CHECK) + `TIPOS_RECLAMO` + 5 selects (2 create, 2 edit, 1 filtro) + mapa central `_recTipoReclamoLabels`/`Colors` en constants.js (listado y detalle ya no muestran "Error" para categorías nuevas). Catálogo ampliable | ☑ | YO |
| 5L.6b | Dashboards de reclamos: el desglose por categoría (`por_usc`/`por_analista` en reclamos.py) tiene columnas fijas (errores/faltantes/atrasos/actualizaciones). Las categorías nuevas cuentan en `total` pero no se desglosan. Rediseñar el desglose (backend + charts frontend) para que sea dinámico por catálogo. Detectado al hacer 5L.6 | ☐ | TÚ+YO |
| 5L.7 | Agregar campo `fecha_fin_analisis` (diferenciar de fecha de análisis): migración 76 + Pydantic + updatable/nullable + input en modal + `_setIf` (guardar análisis y flujo). No se auto-rellena con hoy (se completa al terminar el análisis) | ☑ | YO |
| 5L.8 | Agregar columna "Resuelto" (días que tomó resolver) en listados Clientes e Internos, junto a "Días". Helper `_calcDiasResolucion`/`_diasResolucionBadgeHtml`; solo con reclamo cerrado (`fecha_cierre - fecha_creacion`); automática | ☑ | YO |
| 5L.9 | Verificar que en externos el área se reconozca correctamente según el responsable (ya se infiere en backend; validar tras migración de roles) | ☐ | TÚ+YO |
| 5L.10 | Mostrar el área al lado del responsable en el form de registro externo (read-only). `/users/dropdown` ahora expone area_id/area_nombre por usuario (mismo criterio que _area_id_de_usuario: prioriza jefe_servicio); el form la puebla al elegir responsable | ☑ | YO |
#### 5L.11 — Tab centralizado de Clientes (DISEÑO CERRADO, listo para implementar)

> Hallazgo clave: la única referencia real a un cliente es `proyectos.constructora_id`.
> `reclamos.cliente_id` se eliminó en migración 39 (columna rota, nunca usada) — los
> reclamos cuelgan de la obra, no del cliente directo. Reasignar una obra resuelve
> de una vez sus reclamos y kilos asociados. El backend CRUD (`constructoras.py`)
> ya existe casi completo, incluido `POST /proyectos/{id}/asignar-constructora`.

**Decisiones:**
- **Ubicación:** caluga propia "Clientes" en el menú principal (no sub-tab de Reclamos ni panel de Admin). Visible a admin/admin_calidad/usc.
- **Admin → Entidades** (parte clientes/constructoras): se retira. Un solo lugar oficial.
- **Permisos:** Crear = cualquiera del grupo (admin/admin_calidad/usc). Editar y Eliminar = el creador o admin/admin_calidad (un USC no toca lo de otro USC).
- **Eliminar con historial:** NO se construye flujo de reasignación masiva. El usuario ve qué tiene asignado el cliente (obras) y lo limpia MANUALMENTE con las herramientas que ya existen (editar obra → cambiar cliente, o eliminar la obra si fue error). Solo se puede eliminar el cliente cuando queda en 0 asociaciones. Se agrega el AVISO claro de qué falta limpiar.
- **Caso real detectado:** 2 reclamos huérfanos sin obra en validación final — reveló que el flujo NO exige `id_proyecto` antes de avanzar/cerrar un reclamo externo. Fix puntual (SQL a esos 2 registros) + cerrar el agujero con validación (ver 5L.11.6). Se descartó dar a admin un botón de "reasignar obra en cualquier etapa" (parche que se puede usar mal después).

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5L.11.1 | FIX puntual: asignar obra a los 2 reclamos huérfanos (SQL). REC-051(id57)→PROY-D47634AE, REC-065(id74)→PROY-DB91C0B0. Aplicado y verificado en BD | ☑ | YO |
| 5L.11.2 | Migración 79: `constructoras.creado_por TEXT` (existentes NULL = solo admin los gestiona) | ☑ | YO |
| 5L.11.3 | Backend `constructoras.py`: permisos por ownership (`_require_gestion_clientes` admin/admin_calidad/usc; editar/eliminar solo creador o admin via `_puede_modificar_cliente`). GET expone `puede_gestionar`/`puede_modificar`. Endpoint `GET /constructoras/{id}/puede-eliminar` | ☑ | YO |
| 5L.11.4 | Backend: `DELETE /constructoras/{id}` = borrado REAL cuando 0 obras; 409 con mensaje claro si tiene obras (antes era soft-delete) | ☑ | YO |
| 5L.11.5 | Frontend: caluga "Clientes" (registry hubOrder 25, roles admin/admin_calidad/usc). `tabs/clientes.html` + `features/clientes/index.js`: tabla nombre/RUT/contacto/#obras/#kilos, modal crear/editar, botones editar/eliminar por `puede_modificar`, aviso de obras a limpiar antes de eliminar. Registrado en app.html/shell (tabLabels/tabLoaders)/bootstrap | ☑ | YO |
| 5L.11.6 | Cerrar el agujero: reclamo EXTERNO no avanza a en_revision/validación sin `id_proyecto` (validación en `_primer_envio`, mensaje claro). Internos exentos | ☑ | YO |
| 5L.11.7 | Retirar creación de cliente "al vuelo": quitados los mini-forms + botones "+ nueva constructora" del form crear-obra-desde-reclamo y del editar-obra (app.html). Los selectores solo listan existentes | ☑ | YO |
| 5L.11.8 | Retirar sección constructoras de Admin → Datos maestros: reemplazada por puntero "Ir a Clientes →". `editarCliente()` legacy de entidades.js eliminado (evita colisión con la caluga nueva); `loadClientes()` se mantiene (llena selectores) | ☑ | YO |
| 5L.11.9 | Smoke test: crear cliente (USC) → usar en obra → intentar borrar con obra asociada (bloqueado, aviso correcto) → limpiar → borrar OK. Editar/borrar cliente ajeno (bloqueado para USC no dueño). Reclamo externo sin obra no avanza a validación | ☐ | TÚ+YO |
| 5L.11.10 | ~~Vincular obras a constructora (tabla constructoras como entidad)~~ → **RE-ENFOCADO en 5L.11.13**. El modelo correcto: la OBRA es el registro, empresa/clasificación son atributos de la obra | ☑ | YO |
| 5L.11.11 | Renombrar caluga a "Constructoras / Clientes" (registry title, tabLabels, botón, títulos). Alinear con glosario | ☑ | YO |
| 5L.11.12 | ~~Campo tipo en constructoras~~ → reemplazado por `clasificacion` a nivel de OBRA (ver 5L.11.13). Migración 80 (constructoras.tipo) queda inerte, no molesta | ☑ | YO |
| 5L.11.13 | REWORK: la caluga gira en torno a la OBRA. Migración 81: `proyectos.clasificacion` (obra/tienda/otro) + `proyectos.empresa`. Caluga lista obras y edita su data. Endpoints `GET /proyectos` extendido + `PATCH /proyectos/{id}` extendido | ☑ | YO |
| 5L.11.14 | **Empresa como ENTIDAD propia + 2 sub-tabs + columna Reclamos.** Caluga "Clientes": **Obras / Tiendas** (edita clasificación + empresa —selector de entidad— + calculista + fecha; columna Reclamos con `n_reclamos` por obra) + **Empresas** (CRUD reactivando `constructoras`, borrado bloqueado si tiene obras). Obra→empresa por `constructora_id` | ☑ | YO |
| 5L.11.15 | Tercer sub-tab **Calculistas** en la caluga Clientes: CRUD (nombre/email) reutilizando `/calculistas` (POST/PATCH/DELETE admin-only; botón crear oculto a USC). Columna obras/kilos por calculista; borrado bloqueado si tiene obras. Base para la futura gestión ampliada de calculistas (5L.15: bitácora/KPIs) — este sub-tab se moverá a su caluga propia entonces | ☑ | YO |

#### 5L.12 — Control de plazos / SLA de reclamos (requiere diseño, NO implementar aún)

> DECIDIDO (2026-07): empezar con **1 plazo global de 2 días** (refinable a por categoría/área
> después). Semáforo en listados: en plazo / vencido según días transcurridos vs plazo.
> Depende de 5L.7 (fecha fin) y 5L.8 (días).

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5L.12.1 | Definir plazos: global / por categoría / por área (decisión de negocio) | ☐ | TÚ |
| 5L.12.2 | Diseñar modelo de datos de SLA + indicador visual (en plazo / vencido) en listados | ☐ | YO |
| 5L.12.3 | Implementar cálculo y semáforo de cumplimiento | ☐ | YO |

#### 5L.13 — Tab de seguimiento/gestión de Acciones (requiere diseño, NO implementar aún)

> Hoy se ingresan acciones pero no hay seguimiento. Crear un tab para gestionarlas.
> La tabla `reclamo_acciones` ya tiene estado/responsable/fechas. Absorbe 5L.3.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5L.13.1 | Definir diseño y estructura del tab. DECIDIDO: ambas vistas por rol (Calidad/admin ven TODAS con toggle "Mis acciones"; resto solo las suyas) + foco v1 en vencimientos/estado (semáforo vencida/por vencer 7d/al día + cambio de estado inline). Prerrequisito elegido: opción A (responsable de acción como email estable) | ☑ | TÚ+YO |
| 5L.13.2 | Implementar tab de seguimiento de acciones. (A) Migración 78: `reclamo_acciones.responsable_email` + backfill por nombre contra users; POST/PATCH/detalle y form de acciones guardan display+email (mapa display→email). (B) Sub-tab "Acciones" (nivel 2, visible a todos; backend restringe datos): endpoint `GET /reclamos/acciones` (antes de `{reclamo_id}`), KPIs clicables, filtros estado/vencimiento/búsqueda, cambio de estado inline (PATCH mantiene fecha_completada coherente), clic en fila abre el reclamo. PATCH ampliado: creador, responsable asignado o admin pueden editar | ☑ | YO |

#### 5L.14 — [DIFERIDO a sesión dedicada] Rol admin_calidad como jefe de servicio de su área

> Problema: cada usuario tiene UN rol global. "Jefe de servicio de área" = `role='jefe_servicio'`.
> Una `admin_calidad` no puede ser además jefa formal del área Calidad/USC → al crear reclamo
> interno hacia esa área no encuentra jefe y no autoasigna responsable.
> Opciones: (A) reactivar `rol_area` en `area_usuarios` (desacopla rol de área — limpia);
> (B) fallback a Jefa de Calidad si el área no tiene jefe. El usuario decidió decidir después.
> Conecta con el "fallback destinatario faltante" del plan de mailing (5B).

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5L.14.1 | DECIDIDO: Opción B (fallback). Solo afecta reclamos INTERNOS (crear/reasignar/aviso). Helper `_responsable_area`: jefe del área o, si no hay, la Jefa de Calidad (admin_calidad, única). Aplicado en los 3 puntos. Evita reclamos internos sin responsable (ej. área Calidad). La Opción A (rol_area) queda descartada por ahora | ☑ | YO |
| 5L.14.2 | (Opcional) Backfill de reclamos internos existentes sin responsable (cubicador_asignado NULL) hacia áreas sin jefe → asignar Jefa de Calidad. Solo si hay alguno | ☐ | TÚ+YO |

#### 5L.15 — [DISEÑO PENDIENTE] Inteligencia de Calculistas (bitácora + vistas embebidas)

> Surgió al construir la caluga Clientes (2026-07). Objetivo del usuario: "estudiar a los
> proyectistas" para que el cubicador tenga feedback cuando entra una obra de un calculista
> conocido. HOY existe: tabla `calculistas` (nombre, email) + CRUD en Admin + KPIs
> cuantitativos (`GET /calculistas/kpis`: kilos, PPI, PPB, diámetro ponderado). NO existe
> nada cualitativo (comentarios/recomendaciones) ni vistas embebidas.
>
> **Dirección propuesta (a validar en discovery):** Calculista es entidad TÉCNICO-PRODUCTIVA
> distinta de Constructora (comercial) — amerita **caluga propia**, no sub-tab de Clientes.
> Tres capas: (1) datos duros/KPIs [existen], (2) bitácora cualitativa [comentarios con
> fecha+autor], (3) **vistas embebidas** del resumen en Cubicación y en Programa de Obra
> (F8), donde el cubicador lo consume al abrir una obra de ese calculista. El "protocolo de
> cubicaciones" (hoy en Excel) NO va aquí — va en Programa de Obra (F8), es cosa distinta.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5L.15.1 | Discovery: definir alcance de la bitácora (quién comenta, privacidad, si afecta asignaciones), ficha ampliada de calculista, y puntos de visualización embebida. Actualizar SPECS §7/nueva sección | ☐ | TÚ+YO |
| 5L.15.2 | Implementar caluga Calculistas (mover gestión desde Admin) + bitácora + vistas embebidas. Solo tras discovery | ☐ | YO |

#### 5L.16 — [INFRAESTRUCTURA] Directorio de migraciones (registro ordenado, estilo Tekplan)

> Objetivo simple (aclarado por el usuario): crear un **directorio de migraciones** donde
> cada migración FUTURA se guarde como su propio archivo, para que vaya quedando registro
> ordenado — igual que en Tekplan. Hoy todas viven amontonadas en un array dentro de `db.py`.
> Las migraciones existentes (1–81) se dejan donde están; a partir de ahora las nuevas van
> al directorio, numeradas y en su archivo. El sistema sigue registrando por número en
> `schema_migrations` (eso no cambia). Sin plan complicado.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5L.16.1 | Directorio `armahub/migrations/` + cargador (`_load_file_migrations`/`_split_sql_statements` en db.py) que lee archivos `NNN_desc.sql`, respeta bloques `DO $$`, y aplica contra el mismo `schema_migrations`. Legacy 1–81 en db.py sin tocar; 82+ como archivos. README + SPECS §9.1 actualizados. Parser testeado | ☑ | YO |

#### 5L.17 — Sensación rápida: actualización optimista tras guardar (transversal)

> Directriz en SPECS §2.4 (2026-07). El lag viene del antipatrón "guardar → recargar TODO".
> Fix: al confirmar el PATCH/POST/DELETE, actualizar el item en la caché en memoria y
> re-renderizar solo la vista local (sin viaje de red). Piloto en caluga Clientes.
>
> **Auditoría 2026-07 (mapa del lag, priorizado por gravedad):** las recargas HEAVY son las
> que re-piden listas con agregación DB (kilos/counts/joins) o el detalle completo con
> imágenes/relaciones. Referencia del patrón correcto: `toggleAreaRevision` (areas.js:84)
> — actualiza `_areasCache` en memoria, solo recarga en el path de ERROR para revertir.
>
> **Regla de conversión:** en éxito, mutar el objeto en el array/`_reclamoActual` + re-render;
> mantener el reload SOLO en el path de error (revertir) o cuando el dato dependa de un
> cálculo que el front no puede derivar. `verReclamo(id)` completo tras editar un campo es
> el peor patrón (re-pide detalle + imágenes + acciones).

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5L.17.1 | Piloto: caluga Clientes — optimistic update en `guardarObraData`/empresa/calculista (no recarga `/proyectos`) | ☑ | YO |
| 5L.17.2 | **Reclamos — acciones (prioridad 1, más frecuente).** `refreshAccionesList` (detail-edit.js:721) re-pide el DETALLE COMPLETO del reclamo (`GET /reclamos/{id}`) solo para redibujar la sub-lista de acciones. Convertir a mutar `_recAccionesCache` + `renderAcciones()` local, en: `agregarAccion` (:648), `_guardarEdicionAccion` (:714), `eliminarAccion` (:746). También `cambiarEstadoAccionSeguimiento` (acciones.js:152, tab global) que recarga todo para refrescar KPIs | ☐ | YO |
| 5L.17.3 | **Reclamos — PATCH de 1 campo (prioridad 2).** Cada uno hace `verReclamo(id)` + `loadReclamos()` (2 HEAVY) por un solo campo: `guardarAnioNumeroCalidad` (detail-edit.js:383), `cambiarProyectoReclamo` (:398), `cambiarAsignadoAReclamo` (:411). Mutar `_reclamoActual` + fila del listado en memoria | ☐ | YO |
| 5L.17.4 | **Reclamos — flujo/RCA (prioridad 3, 3 HEAVY c/u).** `guardarRespuesta` (detail-edit.js:557) y el helper `_refrescarTrasAccionFlujo` (detail-flow.js:159) que dispara verReclamo + loadReclamos/Internos + loadRecLanding. Callers: aprobar/devolver validación/revisión, `reabrirReclamo`. Terminar también `cambiarAplicaReclamo` (ya es medio-optimista: quitar los `loadReclamos`/`loadRecLanding` finales). Ojo: el cambio de estado sí puede necesitar refrescar el landing (KPIs) — evaluar cuáles se pueden derivar en memoria | ☐ | TÚ+YO |
| 5L.17.5 | **Reclamos — imágenes.** `_uploadFilesWithTipo` (detail-edit.js:830) y `eliminarImagen` (:843) hacen `verReclamo` completo para reflejar thumbnails. Mutar la lista de imágenes en memoria + re-render del bloque de imágenes | ☐ | YO |
| 5L.17.6 | **Cubicación — cargas (prioridad 4, cadenas de 5 reloads).** `eliminarCargasSeleccionadas` (obras.js:1021, 5 reloads), `deleteCarga` (:975), `eliminarCargasSeleccionadasModal` (:741), `moverCargasSeleccionadasModal` (:768). Todas disparan `loadProyectos`+`loadInicio`+`loadMiActividad`(+`loadCargasProyecto`). Mutar la carga/obra en memoria; los totales de kilos sí pueden requerir recálculo — evaluar derivar localmente restando los kilos de la carga borrada | ☐ | TÚ+YO |
| 5L.17.7 | **Cubicación + Admin — editar obra (doble agregación).** `guardarEditObra` (obras.js:1176) y `editarProyectoAdmin` (proyectos.js:250) editan metadata de UNA obra pero recargan `/proyectos` completo (agregado) — el de admin lo hace DOS veces (`loadAdminProyectos`+`loadProyectos`). Mutar la fila en memoria | ☐ | YO |
| 5L.17.8 | **Admin — single-field (prioridad menor).** Calculista rename (`editarCalculista` entidades.js:196 → recarga lista agregada), y usuarios: `guardarRolUsuario`/`toggleActivoUsuario`/`editarNombreUsuario`/`asignarAreaInline`/`quitarAreaUsuario` (index.js) que recargan la tabla users+areas completa por un campo. Mutar fila en memoria (referencia: `toggleAreaRevision`) | ☐ | YO |

> **LIGHT (no urgente, baja prioridad):** pedidos (pedidos.js), plantillas de correo
> (settings.js), áreas (areas.js excepto lo ya optimista), autorizados por obra. Recargan
> listas chicas — el lag es marginal. Convertir solo si sobra tiempo.

#### 5M — Edición de barras + Catálogo Armacero (sistema por fases)

> DISEÑO CERRADO (2026-07). Objetivo: que el cubicador corrija data de barras desde el Bar
> Manager sin re-exportar desde ArmaDetailer, con validación de figura (evita corromper la
> geometría), bloqueo, auditoría, y aviso ante re-import. Base: caluga "Catálogo Armacero"
> (data maestra de figuras, portada de `typology_catalog.py`). Ver SPECS §4.5 y §4A.
>
> **Decisiones fijadas:** catálogo = tabla editable (no módulo estático). Bloqueo = toggle UI
> candado con warning; guardar-al-cerrar. Permisos edición barra = cubicador dueño de obra +
> admin. Resaltado en rojo del dim que sobra (borrado manual). Re-import = aviso en preview.
> Marca = `editado_por`/`editado_fecha`. Editor de figuras (F8) = dibujo paramétrico guiado
> (no CAD libre), acceso restringido. Render (F7) = SVG en navegador (sin imágenes). Sin fase
> de imágenes (descartada). Caluga "Catálogo Armacero" (ícono barra), ampliable a lectura de
> otros formatos / config técnica / multi-catálogo.
>
> **Fases ordenadas por facilidad + urgencia + dependencia. Lo urgente = F1–F4 (editar masivo
> con figura protegida).**

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5M.1 | **Fase 1 — Catálogo a tabla.** Migración 082 (archivo, estrena directorio): `figuras_catalogo` + `tipologias_catalogo` + `tipologia_figuras`. `catalogo.py`: seed idempotente portado de typology_catalog.py (63 figuras, 38 tipologías, 167 relaciones, cero refs rotas) corrido en `_init_db_once`; endpoints `GET /figuras-catalogo` + `GET /tipologias`. Caluga "Catálogo Armacero" (registry hubOrder 15, roles admin/admin_calidad/miembro) con sub-tabs Figuras/Tipologías (solo lectura; edición UI en F8) | ☑ | YO |
| 5M.2 | **Fase 2 — Filtros por figura/tipología en Bar Manager.** Filtros `figura` y `marca` en `GET /barras` + `GET /barras/elementos` + `_buildFilterParams`. Endpoint `GET /barras/facetas` (figuras/tipologías PRESENTES en la obra, no el catálogo entero) puebla los selectores al elegir proyecto (`loadFacetasDropdown`). Solo lectura (navegar). Manejado en reset/proyecto-change | ☑ | YO |
| 5M.3 | **Fase 3 — Edición de campos simples + toggle + auditoría (habilita edición YA).** Migración 083 (`editado_por`/`editado_fecha`). `PATCH /barras/{id}` (permiso dueño de obra + admin via `_puede_editar_proyecto`; 403 claro; recalcula peso; marca edición; audita `editar_barra`). `GET /barras/ediciones` (panel). `GET /barras` ahora trae `id` + marca de edición. Frontend: candado 🔒 con warning (`barmanager_edit.js`), inputs inline en φ/cant/largo en modo edición, celdas resaltadas, guardar-al-cerrar, barras editadas marcadas (✏️/borde), panel de ediciones recientes de la obra. Tipología NO editable (ligada a figura). Reset del modo al cambiar de obra | ☑ | YO |
| 5M.4 | **Fase 4 — Edición de geometría con validación (el corazón).** `PATCH /barras/{id}` acepta figura/dim_a..i/ang1..4/radio. `validar_geometria` (catalogo.py): la figura exige valor en SUS slots (parciales), vacío en los demás; slots no contiguos OK (201A→B,G,H). Incoherente → 409 con slots_sobran/slots_faltan. **DECIDIDO: NO se guarda geometría incoherente (sin `forzar`)** — la data siempre queda buena. Frontend: en modo edición figura (input+datalist catálogo)/dims/ángulos/radio son editables; al 409 se RESALTAN en ROJO los lados que sobran/faltan; el usuario los corrige (borrar el que sobra = enviar null) y reintenta; las barras buenas del lote sí se guardan, las malas quedan pendientes | ☑ | YO |
| 5M.4b | **Fixes 5M.4 (feedback smoke test):** (1) validación ahora incluye ÁNGULOS y RADIO (no solo dims); un slot que no va con valor incl. 0 → sobra (para eliminarlo hay que dejar VACÍO, no 0). (2) Largo NO editable → se auto-calcula como suma de los lados usados (`largo_desde_lados`, backend) y recalcula peso. (3) Botón "💾 Guardar cambios" explícito (antes solo se guardaba al cerrar candado, se quedaban atrapados). Candado = "Salir de edición". (4) Scroll: contenedor con alto acotado (60vh) en modo edición para que la barra de scroll horizontal quede accesible. (5) Resaltado rojo llega a ang/R. Validación re-testeada (0-cuenta, ángulos, radio) | ☑ | YO |
| 5M.5 | **Fase 5 — Aviso en re-import.** El import hace DELETE+reescribe los (eje,piso,ciclo) del CSV → las barras editadas a mano se ELIMINAN (no se "modifican"). El preview cuenta esas barras (`editado_por`): `editadas_replace` por piso + `total_editadas_a_reemplazar` + `editadas_a_reemplazar` (detalle quién/cuándo/marca). Front: warning rojo por bloque ("Se ELIMINARÁN N barras editadas a mano… omite si no quieres perderlas"), columna ✏️ Editadas por piso, contador en el resumen. **Auditoría del borrado:** el DELETE del import usa `RETURNING` para capturar las editadas que borra; tras el commit se escribe una línea `reimport_borro_editadas` en audit_log (conteo + detalle marca/ubicación/quién editó, hasta 15 muestras) — rastro del evento destructivo. | ☑ | YO |
| 5M.6 | **Fase 6 — Color en matrices.** `/dashboard/sectores` expone `editadas` por celda (COUNT FILTER editado_por). Aplicado a **las 3 matrices constructivas** que reusan ese endpoint: exportación (`exportacion.js`), detalle de obra (`obras.js:buildObraDetailMatriz`) y matriz constructiva del dashboard (`dashboards.js:loadMatriz`, heatmap kg). En todas: **borde marrón izquierdo + badge ✏️** (marrón #8d6e63, igual que "editado" en Bar Manager), ORTOGONAL al rosado de re-import / al heatmap. Leyendas actualizadas en las 3 (+ exportacion.html). | ☑ | YO |
| 5M.7 | **Fase 7 — Render SVG.** Dibujo de la figura en el navegador desde geometría + dimensiones de la barra. Vectorial, liviano, sin imágenes. **DECISIÓN (invertir orden F7↔F8):** el catálogo NO tiene la dirección de los dobleces (solo parciales/ángulos), así que el render solo no basta → primero se hace el EDITOR (F8), que GENERA la geometría, y con eso se puebla/regulariza el catálogo; el render sale del mismo motor. Arquitectura: **motor SVG propio** (no librería — el problema es geometría 2D de polilíneas, trivial; Fabric/Konva sobredimensionados, Three.js solo para 3D). Modelo `geometria` JSON `{dim:"2D", tramos:[{lado,giro,sentido}]}`, **giro LIBRE**. 3D: declarado en `dim`, NO implementado ahora (las menos). Homologación catálogo real↔figuras dibujadas = posterior. | 🔄 | TÚ+YO |
| 5M.8.4 | **Diseñador — requisitos finos (Eugenio 23-jul), planificados.** (a) **Convención ángulo aSa Studio (ACLARADO):** un doblez de 90° NO se cuenta como α1/α2/α3/α4 → queda 0/implícito en la data. Solo los ángulos "especiales" (45, 135, etc.) van a la lista `angulos`. **Confirmado que la data se define por el CATÁLOGO, no por la barra:** la validación al editar barras usa `_catFiguras[figura]` (parciales + n° de ángulos que dicta el catálogo de esa figura). → El diseñador, al guardar, NO debe agregar los 90° a `angulos`; solo los especiales. (b) **Máximo 4 ángulos (α1-α4):** el modelo de barra soporta 4. Si se dibuja una figura con más dobleces, el diseñador debe AVISAR y no permitir guardar algo que no cabe (poco recurrentes, no urgente). (c) **Letras de lado renombrables libres:** figuras con curva/gancho 180° usan parámetros distintos que el software de fabricación lee en columnas específicas → el usuario debe poder renombrar cada letra para que la medida quede en la columna correcta (ya hay input por lado; asegurar que el nombre libre se respete dibujo→guardado→Bar Manager→exportación). (d) **Nombrar ángulos como las tablas** + IDEAL verlos en el render con su nombre. HECHO: etiquetas α1/α2… en los vértices del lienzo (rojo especiales, gris 90°). (f) **Etiquetas de lado desplazadas perpendicular** a la línea (con fondo blanco) para que no queden tapadas por la barra. FUTURO deseable: poder ACOMODAR manualmente la posición de cada letra (arrastrar) para casos donde el auto-posicionamiento no basta. (e) **FIX click REAL:** el SVG se recreaba en cada mousemove → el click caía sobre nodo destruido; ahora SVG persistente + capa dinámica (commit 40bb3d4). | 🔄 | TÚ+YO |
| 5M.8.6 | **Diseñador — FIX figura se rotaba al guardar + ángulos dentro del vértice.** (1) BUG RAÍZ: `geometriaAPuntos` reconstruía desde `heading=0` (siempre "hacia la derecha") → una figura dibujada con el primer lado vertical se guardaba/renderizaba ROTADA 90°; por eso unas rotaban y otras no (según la dirección del 1er lado). FIX: la geometría ahora guarda los PUNTOS reales (normalizados, Y hacia arriba) y el render los usa tal cual → WYSIWYG, idéntico al lienzo. Fallback a tramos para figuras viejas. (2) Etiqueta de ÁNGULO ahora va en la BISECTRIZ del vértice (entre los dos segmentos), no fuera. (3) El render guardado ahora TAMBIÉN dibuja los ángulos (α1…/90°), antes se perdían. Etiquetas de lado desplazadas perpendicular (no encima). | ☑ | YO |
| 5M.8.7 | **Diseñador — modo CURVAS (2D) + etiquetas manuales + drag de nodos (DEFINIDO, EN CURSO).** DEFINICIONES: control de radio = **slider** (Eugenio: lo más simple/liviano; 2 clicks extremos + slider curva). Params curva = radio/altura de cuerda/desarrollo, ingresas 2 y calcula el 3º. **Etiquetas manuales:** botón que abre modo etiquetas (dibujo limpio), agregar medida(cota libre)/letra/ángulo; letra y ángulo DEBEN ser de los disponibles en la data (no libre). **Drag de nodos:** arrastrar vértices para modificar la figura (Eugenio pidió; factible por SVG persistente). Modelo: `tramos` con `tipo:"recto"\|"arco"`; `etiquetas:[{tipo,texto,x,y}]`. Tareas: A1 modelo arco ☑, A2 motor (path SVG comando A) ☑, A3 UI slider ☑, A4 params 2→3 (→ va en Bar Manager, NO diseñador: la figura es solo FORMA/plantilla, las medidas mm las aporta la barra concreta — decisión Eugenio), A5 etiquetas manuales ☑, A6 drag nodos ☑. **A5 hecho:** botón toggle "🏷️ Etiquetas manuales" (para figuras raras; oculta las auto, las simples siguen con el esquema). Agregar etiqueta tipo medida (cota libre)/letra (A-I de la data)/ángulo (α1-α4 de la data) → click en el lienzo la coloca; arrastrables; se guardan en `geometria.etiquetas`. Pendiente menor: mostrar etiquetas manuales también en el render de miniaturas (hoy solo en el editor). | 🔄 | YO |
| 5M.8.8 | **Integración editor ↔ catálogo (PENDIENTE — orden acordado con Eugenio).** SECUENCIA: (1) Eugenio termina de diseñar TODAS sus barras. (2) Eugenio pasa el listado de ángulos del catálogo anterior que están AL REVÉS (alimentó mal esa info originalmente) → YO corrijo esos ángulos en el catálogo (data). (3) RECIÉN ahí la integración consciente: ver qué tiene el catálogo vs. qué se dibujó y decidir, no pisar a ciegas (editar el catálogo DESDE el editor). NO integrar antes de que el catálogo esté coherente. Hoy: dibujar pisa (asumido en el levantamiento). Fase propia, requiere discovery. | ☐ | TÚ+YO |
| 5M.8.5.2 | **Diseñador 3D — completo (Etapas B/C + extras).** Editor 3D real (no visor): espacio con grilla + ejes XYZ rotulados, rotable. **Dibujo por CLICKS sobre plano de trabajo** (Piso XZ / Frontal XY / Lateral YZ; raycasting al plano; distingue click de arrastre) + **modo ORTO** (fuerza tramos a 90° en el plano, default ON). **Panel de parámetros 3D** (lado/largo/dirección por tramo). **Preview** en columna propia al lado del canvas (2D: SVG del motor; 3D: snapshot). **Snapshot 3D FIJABLE** ("📸 Fijar vista": congela el ángulo que se verá/guardará). **Etiquetas manuales** sobre la vista 2D isométrica (reutiliza el sistema del 2D). **GUARDAR (Etapa C):** `disenadorGuardar` bifurca por vista; en 3D → `_guardarFigura3d` (mismo POST/catálogo, `dim:"3D"`, nodos + tramos con dir/largo + puntos iso 2D + snapshot). Galería muestra badge "3D" + la imagen del snapshot (o el SVG iso si no hay). NO se hizo refactor de etiquetado unificado (2D sobre lienzo, 3D sobre vista iso — ya etiquetan sobre "lo que se verá"; el preview 2D se mantiene porque muestra la miniatura ACHICADA real). Pendiente: arcos 3D; el snapshot infla la BD (aceptable para pocas 3D). | ☑ | YO |
| 5M.8.5.1 | **Diseñador 3D — Etapa 1: visor Three.js on-demand + barra rotable.** Botones 2D/3D en el diseñador. En 3D: se carga Three.js ON-DEMAND (CDN jsdelivr, mismo que Chart.js; solo al activar 3D → no pesa el resto) y se muestra un visor con la barra como `TubeGeometry` (tubo de radio Ø siguiendo una polilínea 3D), ROTABLE con arrastre del mouse. Etapa 1 = barra de PRUEBA (U con profundidad en Z) para validar que el 3D anda. NO toca el 2D (los controles 2D se ocultan en modo 3D). `disenador3d.js` nuevo, cargado en bootstrap. Etapa 2 (siguiente): definir la forma por tramos 3D (largo+giro+plano). Etapa 3: guardar/cargar geometría 3D. | ☑ | YO |
| 5M.8.5 | **Diseñador 3D (toggle 2D/3D) — HECHO.** Toggle 2D/3D. Espacio Three.js on-demand con grilla + ejes XYZ rotulados, rotable. **Dibujo por CLICKS** sobre plano de trabajo (Piso XZ/Frontal XY/Lateral YZ; raycasting; badge del plano activo) + **ORTO** (snap a múltiplos de 45° dentro del plano, igual que 2D) + **drag de nodos** (raycast a esferas). Panel de parámetros 3D. **Snapshot FIJABLE** (📸 Fijar vista). **Guardar** (`_guardarFigura3d`, `dim:"3D"`, mismo POST; galería con badge 3D + imagen snapshot). Etiquetado sobre canvas grande (compartido 2D/3D). NOTA: se decidió dibujo por clicks (no por parámetros, más intuitivo). **PENDIENTE: arcos/curvas 3D** (la "patita" final). | 🔄 | YO |
| 5M.8.9 | **Preview + canvas de etiquetado GRANDE (unificado 2D/3D) — HECHO.** El etiquetado manual se hace en un canvas GRANDE (reemplaza el área de dibujo al activar "Etiquetas"), no sobre la miniatura (era incómodo). Preview chico = solo ver. Etiquetas con halo blanco (no caja sólida). `disenador_preview_etiq.js`. FIX incluido: curva del arco se veía invertida en el render (sweep NO debe invertirse; tx() ya invierte la Y). Etiquetas viven en `geometria.etiquetas_preview`. | ☑ | YO |
| 5M.8.10 | **Render 3D vectorial (SVG iso) + UX del editor (PLANIFICADO 27-jul, ver SPECS §4A.4.3).** (A) **Migrar preview/render 3D de FOTO→SVG isométrico paramétrico:** el modelo 3D ya guarda `nodos`+`puntos` iso; alimentar el motor SVG del 2D (`dibujarFigura`) con los puntos iso → dibujo vectorial. Resuelve: paramétrico (escalar a dim real A=115), deformación diagonal del PNG, badge/cotas integrados, y **la cota de arco 3D pasa a funcionar** (hay curva vectorial real). El editor 3D interactivo SIGUE con Three.js; solo el preview/catálogo pasa a SVG. El etiquetado YA es SVG (solo el fondo es foto hoy) → se hereda tal cual. NO otra librería 3D. (B) Botón **"Nueva figura/Limpiar"** siempre visible + banda **"✏️ Editando X"** al cargar. (C) Barra de etiquetado con **botón por tipo** (6) + **avance automático** de letra/ángulo (no dropdown). (D) **Salir del etiquetado 3D** (hoy no hay forma — bug). (E) Cota de arco 3D resuelta por (A). **APROBADO por Eugenio: B y C. Pendiente decidir A (el grande).** | ☐ | YO |
| 5M.8.2 | **Diseñador — fix click, terminar dibujo, galería (editar/eliminar).** (1) Fix enganche: el snap ya no colapsa al punto anterior → el click SIEMPRE agrega un lado (avance mínimo 1 grilla). (2) "✓ Terminar figura" apaga el rubber band (antes seguía proponiendo un lado infinitamente) + "✎ Retomar dibujo" lo reactiva; estado `_dibujando`. (3) Galería de figuras YA dibujadas (con render) bajo el lienzo: miniatura SVG + nombre; **click = editar** (carga la geometría al lienzo, `disenadorEditar`), **✕ = borrar** (`DELETE /figuras-catalogo/{codigo}`, solo admin, audita). Guardar/borrar recargan el catálogo y refrescan la galería. Editar carga como "terminada" (Retomar para seguir). Nota: al editar, izq/der puede invertirse por la conversión de Y — el usuario lo ve y ajusta. | ☑ | YO |
| 5M.8.1 | **Diseñador de figuras — crear por lienzo (clicks).** Investigación previa (a conciencia): ACI 315 = shape-codes con dims letradas (igual al catálogo, no cambia); BVBS describe la barra por secuencia (largo, ángulo±) SIN nombres de figura → confirma que el diseñador trabaja con GEOMETRÍA, el nombre es etiqueta; render 3D real viable con Three.js `TubeGeometry` (barra = tubo de radio Ø siguiendo la polilínea), liviano si se carga on-demand — NO existe lib rebar-3D, no hace falta. **Construido:** editor por LIENZO en la caluga Catálogo (reemplaza el visualizador de solo-lectura del Paso 1). El usuario dibuja con clicks; snap a ángulos limpios (45/90/135°) + grilla; cada segmento = un lado (A,B,C… reasignables); **nombre lo pone el usuario** (no autogenera); panel lateral de parámetros en vivo (lados/largos/ángulos). Guardar → `POST /figuras-catalogo` (UPSERT por código, solo admin): crea figura nueva O puebla la geometría de una existente (el trabajo de render 1×1). Migración 084 (`geometria JSONB`). `GET /figuras-catalogo` devuelve `geometria`. Modelo preparado (NO construido) para: Ø→grosor de trazo, radio_doblado→esquinas, dim:"3D"→TubeGeometry, multi-catálogo (geometría=verdad, nombres=etiquetas mapeables), export BVBS. | ☑ | YO |
| 5M.7.1 | **Paso 1 — Motor de geometría + render SVG (base, reemplazado por 5M.8.1 en UI).** El motor (`geometriaAPuntos`/`svgDesdePuntos`/`dibujarFigura`) se conserva y reutiliza; la UI de solo-lectura del Paso 1 se reemplazó por el editor de lienzo. `disenador.js`: `geometriaAPuntos` (tramos+dims→puntos, avanza y gira rumbo; izq=+/der=−) + `svgDesdePuntos` (escala/centra en viewBox, invierte Y, polilínea + vértices + etiquetas de lado) + `dibujarFigura`. Motor expuesto en `disenadorMotor` para reusar en el editor. Tab "🎨 Diseñador" en la caluga Catálogo: selector de figura del catálogo (dibuja si tiene geometría, si no aviso) + selector de figuras DEMO (geometrías de prueba: recta/L/U/marco/135°/Z-giro-libre) que validan el motor. Cargado en bootstrap.js. | ☑ | YO |
| 5M.8 | **Fase 8 — Editor de figuras + HOMOLOGACIÓN de catálogos externos.** Dibujo paramétrico guiado (arma la figura por tramos → SVG auto), acceso restringido. Homologación: el catálogo Armacero es ÚNICO (fuente de verdad); F8 agrega un motor para traer data de catálogos externos (otros formatos) y mapearla/homologarla al Armacero (integración 1-a-1 por catálogo, con su tab de config). NO son catálogos paralelos: el resultado final siempre es Armacero. Requiere discovery propio | ☐ | TÚ+YO |
| 5M.9 | **Vista PLANA al filtrar por figura/tipología/diámetro (edición eficiente).** Cuando hay filtro de nivel-barra activo (figura, tipología o diámetro), el Bar Manager muestra una TABLA ÚNICA de todas las barras del filtro (sin desplegables de agrupación), editable, PAGINADA. Columnas + ubicación (piso/sector/ciclo/eje). Sin esos filtros, vista agrupada normal (intacta). Render de fila compartido (`_bmFilaBarraHTML`). **Optimistic update:** el PATCH devuelve la barra actualizada; el front muta memoria + re-render local sin re-pedir la lista. FIX incluido: get_figura reventaba con 500 sobre cursor dict_row. **El candado de edición también re-renderiza la vista plana** (bmReRenderVistaActual). **Descartar cambios** (solo la sesión de edición actual) + avisos de cambios sin guardar (cambio de sección, cerrar/recargar navegador, logout). | ☑ | YO |
| 5M.11 | **Edición MASIVA de barras (operación por lote con preview).** Para corregir cientos de barras (cambiar figura + desplazar dimensiones) sin editar una por una. **DECISIÓN:** operación masiva por lote, NO copiar/pegar tipo Excel (pegado ciego = alto riesgo de desalinear/corromper data; la transformación repetida encaja mejor con lote). **PRINCIPIO (fijado por Eugenio):** si la transformación deja ALGUNA barra incoherente → se avisa cuáles y por qué, y NO se aplica nada hasta que el usuario corrija la operación; nunca se excluye en silencio ni se guarda algo incoherente (coherente con 5M.4). Salvaguardas planificadas: preview obligatorio (antes→después en la tabla) + deshacer último lote. Aplica sobre el filtro/selección actual. Bug arreglado de paso: filtro de faceta pegado (localStorage) dejaba la tabla vacía sin error (`_valorFiltroValido`). | 🔄 | YO |
| 5M.11.1 | **Paso 1 — Selección múltiple (sin tocar datos).** En la vista plana + modo edición: checkbox por fila + "seleccionar todas", estado `_seleccion` (Set de ids). La selección se limpia al: cambiar de obra, salir de edición, re-buscar. Persiste entre páginas (por id). | ☑ | YO |
| 5M.12 | **Operar columnas: copiar / intercambiar (masivo).** Dentro de la barra de Modificación masiva (mismo flujo: marcar barras con checkbox), controles para operar entre columnas de las marcadas: "Operar columnas: [Copiar/Intercambiar] de [origen ▾] → [destino ▾] [Aplicar]". Copiar = origen pisa destino (origen queda). Intercambiar = origen ↔ destino. Columnas operables: lados A-I, ángulos α1-α4, φ, cantidad. Lee el valor EFECTIVO (cambio pendiente o memoria), escribe vía `_aplicarCambioBarra` (marca amarillo + valida geometría por fila → rojo si incoherente; nada malo se guarda, backend 409). Toast con el resumen. Resuelve el "desplazar dimensiones" masivo (ej. copiar B→A, C→B al cambiar figura). Flecha →/↔ según la operación. | ☑ | YO |
| 5M.11.2 | **Paso 2 — Modificación MASIVA en tándem (diseño de Eugenio).** Botón "🔁 Modificación masiva" (solo en modo edición). Al activarlo aparecen los checkboxes (no antes → tabla limpia en edición normal). Con el modo ON: marcas barras y al editar UNA celda de una marcada, ese valor se copia a TODAS las marcadas (misma columna) — reutiliza la edición celda-por-celda existente, sin panel/endpoint nuevo. La validación en rojo corre por fila (celda incoherente → roja); NADA incoherente se guarda (backend 409, regla 5M.4). Flujo: cambiar figura masivo → se pintan rojas → luego limpiar/ajustar la columna que sobra en las marcadas → guardar. Barra azul con contador + instrucción en pantalla. Toast "aplicado a N barras". Nota: la réplica pinta/valida solo las barras visibles de la página; las marcadas en otra página igual reciben el cambio y el backend las valida al guardar. Seguridad: la réplica SOLO ocurre con el modo masivo ON y sobre barras marcadas (sin accidentes en edición normal). | ☑ | YO |
| 5M.10 | **Orden de filtros del Bar Manager (iteración 1).** 2 grupos por significado: UBICACIÓN (proyecto + sector/piso/ciclo/eje) y TIPO DE BARRA · Vista plana (figura/tipología/**φ diámetro** nuevo). **Diámetro implementado** (backend: `diam` en /barras + /barras/elementos + `diametros` en /barras/facetas, poblado con los φ presentes en la obra). Proyecto = buscador-desplegable en un control (input+select fusionados). Plano/Carga/Origen → **Filtros avanzados** plegable (bajo uso). **Búsqueda libre eliminada** (sin valor). **Persistencia selectiva en refresh (F5):** recuerda la OBRA + figura/tipología/diámetro (vuelve a la vista en que estabas); NO recuerda ubicación/avanzados (evita resultados "fantasma"). | ☑ | YO |
| 5M.8.3 | **Bar Manager: mini-render de figura (seguro).** En la celda de figura (solo lectura), muestra el dibujo SVG junto al código si la figura tiene geometría (del Diseñador). Carga perezosa `/figuras-catalogo`; usa `window.disenadorMotor`. **Degrada a solo texto** si no hay geometría o el motor no cargó → cero riesgo para el Bar Manager. Paso intermedio antes de un render más rico. | ☑ | YO |
| FIX 5M.11 | **Filtro Eje/Losa (input+datalist) NO aplica bien al elegir + reaparece sugerencia de contraseña de Chrome.** Varios intentos fallidos (onchange solo → +oninput/onblur → readonly → select → volver a texto). Sospecha: remanente/desorden en el manejo del input+datalist; el `readonly` (defensa anti gestor de contraseñas) rompe `oninput`, pero quitarlo reactiva la sugerencia de clave. Pendiente: replicar EXACTO el buscador de obra que sí funciona (¿por qué ese no muestra la sugerencia y este sí? — buscar la diferencia real: quizá `name`/`autocomplete`/orden de atributos, o un listener duplicado). NO gastar más tiempo en caliente; retomar con cabeza fría. | ☐ | YO |

---

## 5N — "AGREGAR CUBICACIÓN" (ingreso manual de barras) — DISEÑO CERRADO 2026-07-28

> Tab **"Agregar Cubicación"** (entre Bar Manager y Pedidos). Título de sección: **"Formulario
> de Cubicación"**. Panel de ALTA de barras manuales. Reutiliza el motor del catálogo/diseñador.
> **Detalle de diseño completo:** SPECS §4.7 + `docs/programa_agregar_cubicacion.md` (referencia
> extendida de este bloque, no programa aparte). Pedidos de cliente (futuro): SPECS §4.7 +
> `docs/programa_pedidos_cliente.md`.
>
> **MENTALIDAD (Eugenio):** REDISEÑAR para código óptimo, NO parchar. Producción activa →
> migraciones aditivas/idempotentes, NUNCA borrar/perder data, ediciones preservan procedencia.
> **DECISIONES ya cerradas — no re-preguntar:** todos los requerimientos están definidos (ver
> tareas). Decisiones abiertas menores (nombre UI del lote, formato id_unico, tabla lotes propia
> vs imports, config peso columna vs tabla, sector_estado tabla) NO bloquean: se toman los
> defaults recomendados del programa detallado y se avanza.

### 5N-A — Rediseños de fondo (backend + migraciones) — LO MÁS CRÍTICO PRIMERO

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5N.1 | **Rediseño A — Canales de datos independientes (invariante).** Cada canal (`origen` csv/manual/pedido) solo tiene autoridad sobre SUS barras. La importación CSV opera SOLO sobre `origen='csv'`: sus DELETE de reemplazo (`importer.py:654-684`, por `(eje,piso,ciclo)` y `plano_code`) llevan `AND (origen IS NULL OR origen='csv')`, centralizado en UNA guardia (no repetir el filtro). Barras `manual`/`pedido` sobreviven SIEMPRE a cualquier reimport. **Brecha real hoy:** el DELETE no mira `origen` → mata las manuales. Es rediseño (invariante), no parche por DELETE. | ☑ | YO |
| 5N.2 | **Aviso en preview de reimport.** El preview (`/import/armadetailer/preview`) informa "N barras manuales/pedido en estos sectores se CONSERVARÁN" (cuenta por `origen IN ('manual','pedido')`, distinto del conteo por `editado_por` de 5M.5). Transparencia; no las borra. | ☑ | YO |
| 5N.3 | **Rediseño B — Estado del sector constructivo como entidad (`sector_estado`).** Migración ≥086: tabla `sector_estado(id_proyecto, sector, piso, ciclo, estado, actualizado_fecha/por, exportado_fecha, modificado_fecha)`, UNIQUE (proyecto,sector,piso,ciclo), estado ∈ `pendiente`/`exportado`/`modificado`. Actualizada por EVENTOS (helper `marcar_sector_*`): crear/editar/eliminar barra, reimport con cambios, exportar. **Cierra la brecha:** hoy `editar_barra` no toca `fecha_carga` (`barras.py:1434`) → editar barra NO marca el sector modificado (matriz sigue verde=mentira). Migrar datos desde `DISTINCT(sector,piso,ciclo)` + estado derivado actual. `version_mod`/`version_exp` = columnas muertas, se dejan quietas. | ☑ | YO |
| 5N.4 | **Migrar lectores del dirty-flag a `sector_estado` (en paralelo, verificado).** `export-history` (`export.py:255`) y el cálculo frontend (`exportacion.js:193`, `obras.js:577`) leen `sector_estado` en vez de restar fechas. El mecanismo viejo se mantiene hasta verificar el nuevo, luego se retira. `export_log` se conserva (histórico/kilos). | ☐ | YO |
| 5N.5 | **Rediseño C — Lote de ingreso manual (`lote_id`).** Migración: tabla `lotes(id, id_proyecto, tipo='manual', estado borrador\|terminada, creado_por/fecha, terminado_fecha, n_barras)` + columna `lote_id` en `barras` (aditiva, NULL para CSV). Trazabilidad de la tanda (provenance, gemelo de `import_id`); no afecta agrupación constructiva. Endpoints `POST /lotes`, `POST /lotes/{id}/terminar`. | ☑ | YO |

### 5N-B — Backend creación de barras

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5N.6 | **Rehabilitar creación (parte del modelo de canales).** `POST /barras/crear` (hoy 403, `barras.py:1502`) + alta MASIVA transaccional (array de barras del lote). `id_unico` = patrón de lámina + **letra prefijo** (marca "creado en plataforma"; no colisiona con CSV). Setear `origen='manual'`, `import_id=NULL`, `lote_id`, `fecha_carga=now`, `editado_por=user`. Ampliar modelo con dims/ángulos/radio/mult (hoy `BarraManualCreate` está incompleto). Permisos: cualquier cubicador cualquier proyecto (validado en backend). Nunca crea `origen != 'manual'`. Actualiza `sector_estado`. | ☐ | YO |
| 5N.7 | **`largo_total` automático + hook figuras raras.** Largo = suma de dims parciales (radio NO suma; sin desarrollo de dobleces). Cálculo aislado en `_largo_desde_figura` para ampliar a barras redondas/estribos circulares sin tocar el resto. | ☐ | YO |
| 5N.8 | **Config de peso por obra (factor global).** Factor default **0%** sobre el peso teórico (`_calcular_peso`, `barras.py:1297`). Persistir por proyecto. Aplica en creación (× cant × factor) y en el recálculo. | ☐ | TÚ+YO |

### 5N-C — Frontend: Formulario de Cubicación (grilla)

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5N.9 | **Tab + grilla estilo planilla.** Sub-tab entre Bar Manager y Pedidos. Grilla: filas=barras (etiqueta+mult+cant), navegación matricial con flechas, **pegar desde Excel**, copiar-fila-abajo (Ctrl+D), fila plantilla con defaults heredables. | ☐ | YO |
| 5N.10 | **3 modos de vista.** Agrupar (colapsable) · Filtro plano · **Agrupación visual** (todas visibles, pintadas por bandas de color por elemento, SIN colapsar → resuelve agregar en 2 ejes sin desagrupar). Toggle de renders (apagar para ver más barras). | ☐ | YO |
| 5N.11 | **Ubicación en cascada + calidad de datos (ejes parecidos).** Proyecto→Piso→Ciclo→Sector→Eje autopoblado (`sectores-nav`) + "＋nuevo". NO bloquear; autocompletar agresivo; **advertencia SUAVE** por similitud (distancia de edición sobre normalizado trim+espacios+minúsculas); guardar el texto TAL CUAL (apóstrofes/tildes importan). Nunca fusión automática. | ☐ | YO |
| 5N.12 | **Figura + dims dinámicas + render en vivo.** Selector de figura del catálogo → pide solo las dims que usa. Render con `disenadorMotor.dibujarFigura` **ajustado a las medidas** ingresadas. Diámetro lista fija (8,10,12,16,18,22,25,28,32,36). Marca por filtro de texto. cant+mult, cant_total derivado. Peso en vivo (con factor obra). | ☐ | YO |
| 5N.13 | **Replicar en pisos.** Modal de selección de pisos → copia la barra, queda editable en el form (preview) antes de confirmar → al confirmar se reparte en sus agrupaciones. "Guardar y crear otra" (mantiene ubicación). Terminar lote → bloqueo. | ☐ | YO |

### 5N-D — Bar Manager (integración)

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5N.14 | **Badge + filtro de barras `manual`** en Bar Manager (columna existe, filtros la respetan). Se ven separadas o integradas en la agrupación estándar. | ☐ | YO |
| 5N.15 | **Edición por estado.** Barras `terminada` se editan SOLO desde Bar Manager (formulario = alta masiva; Bar Manager = corrección puntual; mismo motor, permiso por estado). Editar PRESERVA procedencia (`origen`/`lote_id`, suma `editado_por/fecha`) y marca el sector `modificado`. En "Agregar Cubicación" NUNCA se editan barras de otro canal. | ☐ | YO |

### 5N-E — Limpieza y posproceso

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 5N.16 | **Borrar la tercera matriz MUERTA** (confirmado huérfana, no en DOM ni navegación): `dashboards.js` + `tabs/dashboards.html` + 3 no-ops en `filtros.js:200-202`. CONSERVAR endpoints `/dashboard/sectores` y `/sectores-nav` (los usan las 2 matrices vivas: Exportación y ficha Obra). | ☐ | YO |
| 5N.17 | **Herramienta de merge de ejes parecidos (posproceso).** Vista que agrupa ejes sospechosamente similares y permite fusionar manualmente ("Eje 1"/"EJE 1" → unificar). Fase aparte, no bloqueante. | ☐ | TÚ+YO |
| 5N.18 | **Homologación catálogo (arrastrada de la 5N vieja).** Cruzar figuras dibujadas con las del catálogo detailer; panel para asociar/confirmar. Base para multi-catálogo (ver `docs/programa_multicatalogo.md`). No bloqueante. | ☐ | TÚ+YO |

---

## FASE 6 — Discovery del dominio Obra (modelo común)

Objetivo: definir el modelo de obra/expediente ANTES de construir Mis Proyectos y Programa de Obra.
Sin este discovery, ambas calugas se construyen sobre supuestos que luego hay que rehacer.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 6.1 | Definir ficha de obra: cliente, constructora, responsables, estados, fechas, metadata | ☐ | TÚ+YO |
| 6.2 | Definir estados de obra y semáforos | ☐ | TÚ+YO |
| 6.3 | Definir estructura documental por obra: planos (vigente/obsoleto, por entrega), RDI, certificados, antecedentes | ☐ | TÚ+YO |
| 6.4 | Definir nomenclatura de planos, versiones por entrega y aprobaciones | ☐ | TÚ+YO |
| 6.5 | Definir RDI: campos, estados, adjuntos, responsables, flujo de respuesta del cliente | ☐ | TÚ+YO |
| 6.6 | Definir qué ve/edita el cliente vs el interno en el expediente | ☐ | TÚ+YO |
| 6.7 | Definir flujo hermético de alta de obra/cliente/constructora (hoy se crean dispersamente) | ☐ | TÚ+YO |
| 6.8 | Definir modelo de programa de obra: hitos, tareas, fechas, responsables, cumplimiento auto vs manual | ☐ | TÚ+YO |

**Criterio de salida:** modelo de datos de obra acordado → permite construir F7 y F8 sin retrabajo.

---

## FASE 7 — Caluga Mis Proyectos (expediente, cliente + interno)

Objetivo: expediente de obra donde cliente y armacero ven y editan según permisos.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 7.1 | Crear tablas: documentos de obra versionados por entrega, planos, RDI (modelo de F6) | ☐ | YO |
| 7.2 | Backend: CRUD documentos/planos/RDI sobre R2 + metadata | ☐ | YO |
| 7.3 | Backend: preview PDF; DWG solo almacenar + descargar | ☐ | YO |
| 7.4 | Backend: flujo RDI con respuesta del cliente | ☐ | YO |
| 7.5 | Backend: mailing a involucrados ante RDI/eventos (usa mailer 4.5) | ☐ | YO |
| 7.6 | Crear caluga Mis Proyectos en registry | ☐ | YO |
| 7.7 | UI: ficha de obra + resumen | ☐ | YO |
| 7.8 | UI: documentos, planos por entrega (vigente/obsoleto), RDI con respuesta | ☐ | YO |
| 7.9 | UI: cliente aporta antecedentes y responde RDI | ☐ | YO |
| 7.10 | Permisos: cliente solo sus obras y docs autorizados | ☐ | TÚ+YO |
| 7.11 | Mostrar certificados de Calidad cuando existan | ☐ | YO |
| 7.12 | **Mini-revisión de seguridad** antes de abrir acceso a clientes externos (ownership por obra, aislamiento) | ☐ | TÚ+YO |
| 7.13 | Smoke test: interno crea obra → sube doc → versiona plano → crea RDI → cliente responde → recibe correo | ☐ | TÚ+YO |

> **Nota:** Mis Proyectos es la primera caluga con acceso a clientes externos. La tarea 7.12 es
> una mini-revisión acotada de seguridad justo antes del primer cliente real — no esperar a F15.

**Criterio de salida:** cliente puede ver su expediente de obra, responder RDIs y recibir correos.

---

## FASE 8 — Caluga Programa de Obra (interna)

Objetivo: USC programa la obra; cubicadores dan cumplimiento (auto o manual + validación).

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 8.1 | Crear tablas: programa/hitos/tareas + estados de cumplimiento (modelo de F6) | ☐ | YO |
| 8.2 | Backend: CRUD de programa y tareas | ☐ | YO |
| 8.3 | Backend: cumplimiento automático — carga Detailer ligada a tarea marca avance | ☐ | YO |
| 8.4 | Backend: cumplimiento manual → estado pendiente de validación | ☐ | YO |
| 8.5 | Backend: validación de cumplimiento manual por USC/jefatura | ☐ | YO |
| 8.6 | Crear caluga Programa de Obra en registry (roles internos) | ☐ | YO |
| 8.7 | UI: vista de programa (hitos/tareas/semana), edición por USC | ☐ | YO |
| 8.8 | UI: marca de cumplimiento del cubicador + indicador auto/manual/validado | ☐ | YO |
| 8.9 | Permisos: USC edita, cubicador cumple, jefatura valida | ☐ | TÚ+YO |
| 8.10 | Conectar avance del programa a la vista de obra en Mis Proyectos (F7.7) | ☐ | YO |
| 8.11 | **Protocolo de cubicaciones**: migrar el protocolo que hoy vive en Excel a un módulo dentro de Programa de Obra (checklist/pasos de cómo se cubica una obra). Distinto de la bitácora de calculistas (5L.15). Definir estructura con el usuario | ☐ | TÚ+YO |
| 8.12 | Consumir el resumen/feedback del calculista (5L.15) en la vista de administración de obra, como antecedente para el cubicador | ☐ | YO |
| 8.13 | Smoke test: USC programa → cubicador cumple (auto y manual) → jefatura valida | ☐ | TÚ+YO |

**Criterio de salida:** USC puede programar una obra y ver su avance real.

---

## FASE 9 — Cubicación: consolidar y conectar con Obra

Objetivo: conectar Cubicación (ya funcional) al programa y expediente de obra.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 9.1 | Confirmar selector de obra como fuente única de destino (ya implementado, validar) | ☐ | YO |
| 9.2 | Conectar carga Detailer con tarea de programa de obra (cumplimiento auto F8) | ☐ | YO |
| 9.3 | Trazabilidad entre carga, plano, pedido, reclamo y exportación | ☐ | YO |
| 9.4 | Bar Manager con trazabilidad de plano/versión (de F7) | ☐ | YO |
| 9.5 | Revisar permisos cubicador/cliente/admin por obra | ☐ | YO |
| 9.6 | Smoke test: obra → carga CSV → cumplimiento auto en programa → Bar Manager → pedido → exportación | ☐ | TÚ+YO |

**Criterio de salida:** una carga CSV actualiza automáticamente el avance en el Programa de Obra.

---

## FASE 10 — Administración del Sistema

> Movida post-F8 (2026-06-10): el pool de requisitos de Admin se aclara una vez que las calugas
> de obra están construidas. Aquí se consolida, no se diseña en el aire.

Objetivo: consolidar la base administrativa con el conocimiento real de las calugas ya construidas.

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 10.1 | Consolidar gestión de usuarios y roles (incluye roles nuevos surgidos de F6–F9) | ☐ | YO |
| 10.2 | Implementar editor central de obras/clientes/constructoras con flujo hermético (definido en F6.7) | ☐ | YO |
| 10.3 | Cerrar creación "al vuelo" de obras desde reclamos/import CSV | ☐ | YO |
| 10.4 | Actualizar matriz de permisos completa (post-F9, cuando todas las calugas existen) | ☐ | TÚ+YO |
| 10.5 | Implementar vista de matriz de permisos en Admin | ☐ | YO |
| 10.6 | Auditoría global: ajustar contrato de audit_log a todas las calugas | ☐ | YO |
| 10.7 | Gestión de parámetros del sistema y plantillas (correos, certificados) | ☐ | YO |
| 10.8 | Armonización transversal (4.X): estados, permisos, modelo de docs entre calugas | ☐ | TÚ+YO |
| 10.9 | Smoke test Admin: crear usuario → asignar obra → verificar permisos por caluga | ☐ | TÚ+YO |

**Criterio de salida:** Admin refleja el estado real del sistema completo.

---

## FASE 11 — CRM + Inteligencia Comercial

| N° | Descripción | Realizado | Quién |
|----|-------------|-----------|-------|
| 11.1 | Definir diferencia entre cliente, constructora, contacto, empresa y obra (post-F9, con contexto real) | ☐ | TÚ+YO |
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
| 15.4b | Verificar que el patrón "actualización optimista tras guardar" (ver 5L.17 y SPECS §2.4) esté aplicado en todas las calugas antes del cierre | ☐ | YO |
| 15.5 | Backup/restore documentado de Supabase y R2 | ☐ | YO |
| 15.6 | Configurar dominio propio (DNS) | ☐ | TÚ+YO |
| 15.7 | Checklist de release por caluga | ☐ | YO |
| 15.8 | Actualizar docs finales (protocolo, modelo, permisos, arquitectura) | ☐ | YO |
| 15.9 | Congelar `programa_v1.00.md` y crear siguiente versión | ☐ | TÚ+YO |

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

| Cambio | Antes (CODEX) | Ahora (2026-06-10) |
|--------|---------------|---------------------|
| Estado de partida | Casi todo en ☐, ignora trabajo hecho | Estado real reconciliado con el código |
| Infraestructura | Fase 3, container completo, bloqueante | F3 R2→Supabase→Render; todo gratis $0 |
| Orden de calugas | Admin antes de obra | F5 Reclamos → F6 Discovery → F7 Mis Proyectos → F8 Prog. Obra → F9 Cubicación → F10 Admin |
| Admin | Fase 5, antes de todo | F10, post-F8: se consolida con contexto real de calugas |
| CRM y Procedimientos | Intercalados | Al final (F11–F12): no bloquean nada operativo |
| Discovery de obra | Mezclado con implementación | F6 explícito antes de F7/F8: evita retrabajo |
| Diseño transversal | Bloques previos abstractos | Caluga a caluga; armonización en F10.8 cuando hay algo concreto |
| Calugas de obra | "Administrador de Obra" única, Cubicación antes que Obra | Programa de Obra (interno) + Mis Proyectos (cliente+interno) + Cubicación; discovery de obra (F7) antes de construir |
| Cumplimiento programa | No contemplado | Auto (Detailer) + manual con validación (F8) |
| Correo | Disperso (Reclamos + futuro) | Helper único transversal (F4.5), consumido por Reclamos y Mis Proyectos |
| Preview DWG | Ambiguo | PDF en v1; DWG almacenar+descargar, preview a worker futuro |
| Pendientes Reclamos (PC.15 envío, multi-origen) | No arrastrados | Arrastrados a F6B/6C |
