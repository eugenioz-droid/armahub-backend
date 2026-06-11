# SPECS ARMAHUB — Especificaciones Funcionales

> **Propósito:** mapa funcional vivo de ArmaHub. Documenta flujos, permisos y decisiones de
> diseño por caluga. Se actualiza cada vez que cambia un flujo, rol o comportamiento. No es
> un roadmap — para eso está `docs/programa-versiones/`.
>
> Última actualización: 2026-06-11 · Infraestructura: Render (FastAPI) + Supabase (PostgreSQL) + Cloudflare R2
>
> **Discovery Reclamos v2 (2026-06-10):** diseño de áreas, flujos multi-área y RCA documentado. Pendiente de implementación.
> **Validaciones (2026-06-11):** flujo `en_revision` + sub-tab Validaciones implementados (estados reales: `en_revision`/`validacion`). Rol `admin2` renombrado a `admin_calidad`. Filtro por área del Jefe de Servicio pendiente (Plan 2).

---

## ÍNDICE

1. [Roles y permisos globales](#1-roles-y-permisos-globales)
2. [Infraestructura y almacenamiento](#2-infraestructura-y-almacenamiento)
3. [Caluga: Reclamos](#3-caluga-reclamos)
4. [Caluga: Cubicación](#4-caluga-cubicacion)
5. [Caluga: Mis Proyectos (Discovery Obra)](#5-caluga-mis-proyectos-discovery-obra)
6. [Caluga: Programa de Obra](#6-caluga-programa-de-obra)
7. [Caluga: Admin](#7-caluga-admin)
8. [Caluga: CRM](#8-caluga-crm)
9. [Servicios transversales](#9-servicios-transversales)
10. [Decisiones de diseño globales](#10-decisiones-de-diseño-globales)

---

## 1. ROLES Y PERMISOS GLOBALES

### 1.1 Roles globales del sistema

| Rol | Descripción |
|-----|-------------|
| `admin` | Acceso total. Jefe de Servicio de Cubicaciones. Cierre final de reclamos. |
| `admin_calidad` | Jefa de Calidad. Validación final en todos los flujos. Puede saltarse jerarquía si jefe no disponible. (Antes `admin2`.) |
| `cubicador` | Analista de Cubicaciones — responde reclamos asignados a él. |
| `externo` | Cubicador externo — mismas funciones que cubicador en sus reclamos. |
| `usc` | Operador USC — levanta reclamos externos, no analiza ni valida. |
| `miembro` | Usuario de cualquier área — puede levantar reclamos internos. |
| `cliente` | Acceso de solo lectura; sin acceso a reclamos. |

> Los roles `cubicador` y `externo` son legacy del módulo original. En el modelo de áreas,
> el poder de análisis y validación viene de `area_usuarios.rol_area`, no del rol global.
> Se mantienen por compatibilidad durante la transición.

### 1.2 Áreas de la empresa

Las áreas son entidades en la BD. Un usuario puede pertenecer a múltiples áreas con distinto rol por área.

| Área | Slug |
|------|------|
| USC C&D | `usc_cd` |
| USC MPEC | `usc_mpec` |
| Producción C&D | `produccion_cd` |
| Producción MPEC | `produccion_mpec` |
| Producción Prearmado | `produccion_prearmado` |
| Cubicaciones | `cubicaciones` |
| Logística | `logistica` |
| Ventas | `ventas` |
| Calidad | `calidad` |
| Planificación | `planificacion` |

### 1.3 Roles por área (area_usuarios)

| Rol área | Descripción |
|----------|-------------|
| `miembro` | Pertenece al área, puede levantar y analizar reclamos internos según flujo |
| `jefe_servicio` | Valida reclamos donde su área es responsable (o analiza, según flujo del área) |

Un jefe puede serlo de más de un área. La tabla es M:N: `area_usuarios(area_id, user_id, rol_area)`.

### 1.4 Roles por obra (proyecto_usuarios)

Un usuario puede tener un rol distinto por obra: `admin · usc · cubicador · externo · cliente`.
Aplica al módulo de Cubicación — complementario al modelo de áreas.

### 1.5 Reglas generales de ownership

- **admin / admin_calidad:** acceso total a todo el sistema.
- **admin_calidad (Jefa de Calidad):** validación final en todos los flujos; puede actuar como fallback de cualquier jefe de servicio.
- **jefe_servicio:** valida (o analiza, según área) los reclamos donde su área es responsable.
- **cubicador / externo:** solo ven y editan sus propios reclamos asignados.
- **usc / miembro:** solo ven y editan donde son `creado_por` o `asignado_a`.
- **cliente:** solo lectura, sin acceso a reclamos.
- El ownership se valida **en backend**, no solo en frontend.

---

## 2. INFRAESTRUCTURA Y ALMACENAMIENTO

### 2.1 Stack

| Componente | Servicio | Notas |
|-----------|----------|-------|
| Backend | Render (FastAPI, free tier) | ~30s cold start aceptado |
| Base de datos | Supabase (PostgreSQL) | Session pooler, `?sslmode=require` |
| Archivos | Cloudflare R2 | Sin BYTEA — todo archivo va a R2 |
| Email | Resend API | `mailer.py`, helper único compartido |

### 2.2 Acceso a archivos (R2)

**No hay URLs públicas permanentes.** El flujo es:

```
Usuario autenticado → GET /reclamos/{id}/imagenes/{img_id}
                            ↓
                    Backend valida JWT + ownership
                            ↓
                    Backend genera presigned URL (temporal)
                            ↓
                    Browser redirige → R2 (acceso directo)
```

**Política vigente:** presigned URL de 1 hora. El usuario autenticado nunca ve la URL real de R2 — solo hace la petición al backend, que redirige. Si se comparte la URL cruda, expira en 1 hora.

> Decisión pendiente (5.3): evaluar bajar expiración a 15 minutos vs mantener 1 hora. No cambia la seguridad conceptual, solo el tiempo de exposición si alguien extrae la URL directa.

### 2.3 Email (mailer.py)

- Helper único: `send_email(to, subject, html, reply_to=None)`.
- Biblioteca: `resend` — configurada con `RESEND_API_KEY` + `MAIL_FROM`.
- Reutilizable desde cualquier módulo. No duplicar helpers de correo.

---

## 3. CALUGA: RECLAMOS

### 3.1 Propósito

Ticketera de calidad de Armacero. Gestiona dos tipos de reclamos:

- **Externos:** levantados por USC cuando un cliente reporta un problema. El área responsable analiza y responde.
- **Internos:** levantados por cualquier área contra otra área. El cliente no se entera — es gestión interna de calidad.

Incluye análisis de causa raíz (Ishikawa o 5 Por Qué), acciones correctivas, validación por jerarquía y cierre con PDF.

### 3.2 Tipos de reclamo

| Tipo | Quién levanta | Asociado a |
|------|--------------|------------|
| `externo` | USC | Cliente / Proyecto |
| `interno` | Cualquier área | Cliente (referencial, no se notifica) |

### 3.3 Flujos de estados

> **Estados reales en BD** (constraint `reclamos_estado_check`): `abierto`, `en_analisis`, `en_revision`, `validacion`, `cerrado`, `rechazado`. (Migración 60 agregó `en_revision`.)

#### Flujo A — Cubicaciones (doble validación interna)

```
  ABIERTO ──► EN_ANALISIS ──► EN_REVISION ──► VALIDACION ──► CERRADO
                  ▲                │               │
                  │                ▼               ▼
                  └──── (devolver con motivo) ◄────┘
```

| Estado | Quién actúa |
|--------|-------------|
| `abierto` | Reclamo creado, esperando análisis |
| `en_analisis` | Cubicador asignado trabaja el análisis. Botón "Enviar a revisión" → `en_revision` |
| `en_revision` | Jefe de Servicio de Cubicaciones (admin) revisa. Aparece en sub-tab Validaciones → "En revisión". Aprobar → `validacion`; Devolver → `en_analisis` con motivo |
| `validacion` | Jefa de Calidad (`admin_calidad`) valida. Aparece en "Validación Calidad". Aprobar → `cerrado`; Devolver → `en_analisis` |
| `cerrado` | Cierre formal |
| `rechazado` | Rechazo definitivo |

#### Flujo B — Resto de áreas (validación directa a Calidad)

```
  ABIERTO ──► EN_ANALISIS ──► VALIDACION ──► CERRADO
                  ▲               │
                  │               ▼
                  └──── (devolver con motivo)
```

| Estado | Quién actúa |
|--------|-------------|
| `abierto` | Reclamo creado, esperando análisis |
| `en_analisis` | Jefe de Servicio del área responsable analiza. "Enviar a validación" → `validacion` (NO pasa por `en_revision`) |
| `validacion` | Jefa de Calidad (`admin_calidad`) valida y cierra |
| `cerrado` | Cierre formal |
| `rechazado` | Rechazo definitivo |

> **¿Qué determina el flujo?** El área del reclamo. Hoy se decide por heurística sobre `area_aplica` (texto "Cubicación…") o `cubicador_asignado`. **Pendiente (Plan 2):** reemplazar por FK `area_id` real y modelo `jefe_servicio` + `area_usuarios` para filtrar la cola "En revisión" por el área de cada Jefe de Servicio.

> **Sub-tab Validaciones:** vista de trabajo (como Presentaciones). Trae reclamos por estado, muestra la ficha completa reutilizando el **modal de detalle** (`verReclamo`), y desde ahí solo cambia el estado. El listado oficial (tab Reclamos Clientes) muestra TODOS los reclamos siempre; ningún estado los oculta. Acceso actual: `admin` ve ambas secciones; `admin_calidad` solo "Validación Calidad".

> **Reasignación:** si un reclamo fue asignado al área equivocada, quien lo creó puede reasignarlo mientras está en `abierto` o `en_analisis`. Si ya pasó a validación, solo admin/admin_calidad pueden reasignar.

### 3.4 Análisis de causa raíz (RCA)

El método RCA se elige al crear o iniciar el análisis del reclamo. No pueden coexistir ambos en el mismo reclamo.

| Método | Cuándo usar | Campos |
|--------|-------------|--------|
| **Ishikawa** | Si el área tiene su matriz RCA cargada | Categoría + sub-causa + código causa |
| **5 Por Qué** | Si no hay matriz Ishikawa disponible o se prefiere | Por qué 1→5, causa raíz identificada |

- Si el área tiene matriz Ishikawa → se muestra Ishikawa por defecto.
- Si no → se muestra 5 Por Qué por defecto.
- El usuario puede cambiar el método antes de guardar el análisis.

#### Matrices RCA por área

Cada área puede cargar y editar su propia matriz RCA desde el sistema (categorías y sub-causas Ishikawa). Esto reemplaza el hardcoding actual de causas en el código.

> Pendiente de implementación: módulo de gestión de matrices RCA por área (Admin/Jefe de Servicio edita la matriz de su área).

### 3.5 Áreas de la empresa en reclamos

| Área | Flujo | Quién analiza | Quién valida (paso 1) | Quién cierra |
|------|-------|--------------|----------------------|--------------|
| Cubicaciones | A | Cubicador asignado | Jefe Servicio (Admin) | Admin2 → Admin |
| USC C&D | B | Jefe de Servicio | Admin2 | Admin |
| USC MPEC | B | Jefe de Servicio | Admin2 | Admin |
| Producción C&D | B | Jefe de Servicio | Admin2 | Admin |
| Producción MPEC | B | Jefe de Servicio | Admin2 | Admin |
| Producción Prearmado | B | Jefe de Servicio | Admin2 | Admin |
| Logística | B | Jefe de Servicio | Admin2 | Admin |
| Ventas | B | Jefe de Servicio | Admin2 | Admin |
| Calidad | B | Jefe de Servicio | Admin2 | Admin |
| Planificación | B | Jefe de Servicio | Admin2 | Admin |

> Un jefe puede ser Jefe de Servicio de más de un área (M:N en `area_usuarios`).

### 3.6 Modelo de datos nuevo (pendiente de implementación)

Tablas nuevas requeridas:

```sql
areas
  id          BIGSERIAL PK
  nombre      TEXT NOT NULL
  slug        TEXT UNIQUE NOT NULL   -- 'cubicaciones', 'usc_cd', etc.
  activo      BOOLEAN DEFAULT TRUE

area_usuarios
  id          BIGSERIAL PK
  area_id     BIGINT FK→areas
  user_id     BIGINT FK→users
  rol_area    TEXT  -- 'miembro' | 'jefe_servicio'
  UNIQUE(area_id, user_id)

area_rca_categorias          -- Matriz Ishikawa por área
  id          BIGSERIAL PK
  area_id     BIGINT FK→areas
  nombre      TEXT NOT NULL  -- ej: 'Mano de obra'
  orden       INTEGER

area_rca_subcausas
  id          BIGSERIAL PK
  categoria_id BIGINT FK→area_rca_categorias
  codigo      TEXT           -- ej: 'MO01'
  descripcion TEXT NOT NULL
  activo      BOOLEAN DEFAULT TRUE
```

Columnas nuevas en `reclamos`:

```sql
ALTER TABLE reclamos ADD COLUMN tipo_origen TEXT DEFAULT 'externo';  -- 'externo' | 'interno'
ALTER TABLE reclamos ADD COLUMN area_responsable_id BIGINT REFERENCES areas(id);
ALTER TABLE reclamos ADD COLUMN metodo_rca TEXT;  -- 'ishikawa' | '5_por_que'
ALTER TABLE reclamos ADD COLUMN cinco_por_que JSONB;  -- [{n:1, pregunta, respuesta}, ...]
```

### 3.7 Permisos por sección (estado actual — v1)

> Esta sección refleja el estado implementado hoy. Se actualizará al implementar v2 con áreas.

#### Ver listado

| Rol | Qué ve |
|-----|--------|
| admin / admin_calidad / cubicador | Todos los reclamos (toggle Todos/Mis reclamos) |
| usc | Propios por defecto (toggle para ver todos en lectura) |
| externo | Solo propios, sin toggle |
| cliente | Sin acceso |

#### Ver detalle

| Rol | Acceso |
|-----|--------|
| admin / admin_calidad / cubicador | Cualquier reclamo |
| usc | Solo donde es `creado_por` o `asignado_a` |
| externo | Solo donde es `cubicador_asignado` o `respuesta_por` |
| cliente | Sin acceso |

#### Sección 1 — Registro

| Acción | admin/admin_calidad | usc (propio) | cubicador | externo | cliente |
|--------|:---:|:---:|:---:|:---:|:---:|
| Ver | ✅ | ✅ | ✅ | ✅ | — |
| Editar | ✅ | ✅ (estado=abierto) | — | — | — |

#### Sección 2 — Análisis

| Acción | admin/admin_calidad | usc | cubicador (propio) | externo (propio) | cliente |
|--------|:---:|:---:|:---:|:---:|:---:|
| Ver | ✅ | ✅ | ✅ | ✅ | — |
| Editar | ✅ | — | ✅ | ✅ | — |
| Enviar a validación (morado) | ✅ | — | ✅ | ✅ | — |

#### Sección 3 — Validación

| Acción | admin/admin_calidad | resto |
|--------|:---:|:---:|
| Ver sección | ✅ | — |
| Editar | ✅ | — |

#### Imágenes

| Tipo | Sube | Elimina |
|------|------|---------|
| ImagenesRegistro | admin/admin_calidad/usc | admin/admin_calidad + usc (propios) |
| ImagenesAnalisis | admin/admin_calidad/cubicador/externo | admin/admin_calidad + cubicador/externo (propios) |

#### Acciones correctivas

| Acción | admin/admin_calidad | usc (propio) | cubicador (propio) | externo (propio) |
|--------|:---:|:---:|:---:|:---:|
| Agregar | ✅ | — | ✅ | ✅ |
| Editar | ✅ | ✅ | ✅ | ✅ |
| Eliminar | ✅ | ✅ | ✅ | ✅ |

#### PDF e informe por correo

| Acción | admin/admin_calidad | usc (propio) | cubicador (propio) | externo |
|--------|:---:|:---:|:---:|:---:|
| Exportar PDF | ✅ | ✅ | ✅ | — |
| Enviar por correo | ✅ | ✅ | — | — |

### 3.8 Pendientes funcionales

| # | Descripción | Estado |
|---|-------------|--------|
| 5.3 | Política presigned URL — 1 hora, aceptado | ☑ |
| 5.4 | QA visual PDF | ☑ 2026-06-10 |
| 5.6 | Optimizar query listado | ☑ 2026-06-10 |
| 5.7 | Evaluar split reclamos.py | ☑ Posponer a cierre F9 |
| 5.8–5.12 | Envío de informe por correo | ☐ |
| 5.13–5.17 | Multi-origen / multi-área (v2) | ☐ Discovery completado 2026-06-10 |

### 3.9 Decisiones de diseño

- **Un solo helper de correo** (`mailer.py`) reutilizado por todas las calugas.
- **Sin BYTEA:** toda imagen en R2 desde migración 54.
- **Cache:** deshabilitado para usc/externo — activo solo para admin/admin_calidad/cubicador.
- **Correlativo de calidad:** `anio_calidad` + `numero_calidad`, display "2026-003".
- **RCA:** Ishikawa o 5 Por Qué por reclamo — excluyentes. Método elegido al iniciar análisis.
- **Matrices RCA:** gestionadas por área desde el sistema — no hardcodeadas en el código.
- **Flujo por área:** determinado por `area_responsable_id` del reclamo. Cubicaciones = Flujo A, resto = Flujo B.
- **Ventas:** un solo pool por ahora (constructoras + retail). Se evalúa separar en v3.
- **Cliente/Proyecto:** un proyecto = un cliente. Sin abrir más por ahora. Retail sin proyecto → asociado a cliente directo.
- **Reasignación:** permitida por quien creó el reclamo mientras esté en `abierto`/`en_analisis`. Después solo admin/admin_calidad.

---

## 4. CALUGA: CUBICACIÓN

### 4.1 Propósito

Gestión de barras de acero por obra: importación desde CSV ArmaDetailer, visualización, filtros, exportación y pedidos. Núcleo productivo del portal.

### 4.2 Flujo de importación CSV

```
Usuario sube CSV ArmaDetailer
          │
          ▼
  Backend parsea y valida
          │ error → devuelve detalle de errores
          ▼
  Asigna import_id + barras al proyecto
          │
          ▼
  Barras visibles en obra (filtros: sector/piso/ciclo/eje)
```

**Modos de reemplazo (migración 50):**
- `ninguno`: agrega sin tocar las existentes.
- `parcial`: reemplaza barras del mismo scope (ej: mismo plano).
- `total`: elimina todas las barras previas del proyecto antes de importar.

Las cargas supersedidas se registran en `imports.supersedida_por`.

### 4.3 Flujo de pedidos

```
Cubicador selecciona barras
          │
          ▼
  Crea pedido (borrador)
          │ tipo: generico o especifico
          ▼
  Agrega items (diam, largo, cantidad, sector...)
          │
          ▼
  Envía pedido [borrador → enviado]
          │
          ▼
  Admin procesa → [en_proceso → completado]
          │
          ▼
  Items procesados crean barras con origen='pedido'
```

### 4.4 Permisos

| Acción | admin/admin_calidad | cubicador | usc | externo | cliente |
|--------|:---:|:---:|:---:|:---:|:---:|
| Ver obra completa | ✅ | ✅ | ✅ | ✅ | ✅ (lectura) |
| Importar CSV | ✅ | ✅ | — | — | — |
| Eliminar carga | ✅ | ✅ (propia) | — | — | — |
| Crear pedido | ✅ | ✅ | — | — | — |
| Bar Manager (mover/editar) | ✅ | ✅ | — | — | — |
| Exportar | ✅ | ✅ | ✅ | ✅ | ✅ |

### 4.5 Pendientes funcionales

> Detalle en programa F8-F9. Esta sección se completa durante el trabajo de esas fases.

---

## 5. CALUGA: MIS PROYECTOS (DISCOVERY OBRA)

> Caluga en diseño — discovery pendiente (F6 del programa).

### 5.1 Propósito (borrador)

Vista resumen de las obras asignadas al usuario. Panel de entrada al portal desde donde el usuario accede a su obra activa y puede ver estado general.

### 5.2 Pendientes

- Discovery con el usuario: qué información necesita cada rol al entrar.
- Definir si hay KPIs por obra (reclamos abiertos, kilos cubicados, etc.).
- Definir acceso rápido a otras calugas desde la tarjeta de obra.

---

## 6. CALUGA: PROGRAMA DE OBRA

> Caluga en diseño — pendiente (F8 del programa).

### 6.1 Propósito (borrador)

Cronograma o hitos de la obra. Permite registrar fechas clave, avance y alertas.

> Detalle se define en discovery F8.

---

## 7. CALUGA: ADMIN

> Caluga parcialmente implementada — completar en F10.

### 7.1 Propósito

Panel de administración del sistema: usuarios, roles, entidades, configuración de notificaciones.

### 7.2 Secciones

| Sección | Estado |
|---------|--------|
| Gestión de usuarios (crear, editar, activar/desactivar) | ✅ implementado |
| Gestión de constructoras | ✅ implementado |
| Gestión de calculistas | ✅ implementado |
| Gestión de notificaciones (config por rol/evento) | ✅ implementado |
| Gestión de permisos por obra (proyecto_usuarios) | ✅ implementado |

### 7.3 Pendientes F10

> Detallar durante la fase correspondiente.

---

## 8. CALUGA: CRM

> Caluga futura — pendiente (F11 del programa).

### 8.1 Propósito (borrador)

Gestión de relación con clientes: contactos, seguimientos, oportunidades.

> Discovery pendiente.

---

## 9. SERVICIOS TRANSVERSALES

### 9.1 Sistema de migraciones

- Definidas en `armahub/db.py` → lista `MIGRATIONS`.
- Numeradas y correlativas (última: migración 54).
- Idempotentes: cada migración verifica si ya se aplicó antes de ejecutar.
- Toda modificación de esquema debe entrar como migración versionada.

### 9.2 Notificaciones en app

- Tabla `notificaciones` con `tipo_evento` y `reclamo_id`.
- Configuración por rol y evento en `notificacion_config`.
- Eventos: `reclamo_creado · reclamo_asignado · analisis_completado · validacion_realizada · reclamo_cerrado · reclamo_reabierto · cambio_estado`.

### 9.3 Audit log

- Tabla `audit_log`: toda acción crítica queda registrada con usuario, acción, entidad y fecha.

### 9.4 Email (Resend)

- Helper: `armahub/mailer.py`.
- Un único helper compartido. Ningún módulo duplica lógica de envío.
- Health check incluido en `/health`.

### 9.5 Storage (Cloudflare R2)

- Helper: `armahub/storage.py`.
- Sin URLs públicas permanentes.
- Presigned URLs generadas en backend con validación JWT previa.
- Health check incluido en `/health`.

---

## 10. DECISIONES DE DISEÑO GLOBALES

| Decisión | Detalle |
|----------|---------|
| Un solo backend FastAPI | Sin microservicios. Módulos separados por archivo `.py`. |
| Un solo helper de correo | `mailer.py` — no duplicar. |
| Un solo helper de storage | `storage.py` — no duplicar. |
| Sin BYTEA | Todo archivo en R2 desde migración 54. |
| Permisos en backend | Ownership validado en FastAPI, no solo en frontend. |
| Cache condicional por rol | Cache activo para admin/admin_calidad/cubicador. Deshabilitado para usc/externo. |
| Diseño caluga por caluga | El diseño visual y funcional se define caluga por caluga. Armonización global post-F9. |
| No hay estado `validado` | Eliminado migración 47 — flujo termina en `cerrado`. |
| No hay estado `accion_correctiva` | Eliminado migración 46. |
| Roles globales vs por obra | Rol global determina capacidades del usuario. Rol por obra (proyecto_usuarios) determina scope dentro de una obra. |

---

*Fin del documento. Actualizar al cerrar cada caluga o al cambiar flujos, permisos o decisiones de diseño.*
