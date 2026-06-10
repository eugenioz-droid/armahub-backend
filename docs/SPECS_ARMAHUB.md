# SPECS ARMAHUB — Especificaciones Funcionales

> **Propósito:** mapa funcional vivo de ArmaHub. Documenta flujos, permisos y decisiones de
> diseño por caluga. Se actualiza cada vez que cambia un flujo, rol o comportamiento. No es
> un roadmap — para eso está `docs/programa-versiones/`.
>
> Última actualización: 2026-06-10 · Infraestructura: Render (FastAPI) + Supabase (PostgreSQL) + Cloudflare R2

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

### 1.1 Roles disponibles

| Rol | Descripción |
|-----|-------------|
| `admin` | Acceso total al sistema |
| `admin2` | Mismo acceso que admin (sin distinción operativa actual) |
| `cubicador` | Profesional interno que analiza y responde reclamos |
| `usc` | Usuario de supervisión de calidad — crea reclamos, supervisa |
| `externo` | Cubicador externo — mismas funciones que cubicador en sus reclamos |
| `cliente` | Acceso de solo lectura; sin acceso a reclamos |

### 1.2 Roles por obra (proyecto_usuarios)

Un usuario puede tener un rol distinto por obra: `admin · usc · cubicador · externo · cliente`.
Este rol complementa el rol global en los contextos donde aplica (ej: quién es USC de un reclamo específico).

### 1.3 Reglas generales de ownership

- **admin / admin2:** acceso total a todo el sistema.
- **cubicador / externo:** solo ven y editan sus propios registros (donde son `cubicador_asignado`).
- **usc:** solo ve y edita donde es `creado_por` o `asignado_a`.
- **cliente:** solo lectura, sin acceso a módulos sensibles.
- El ownership se valida **en backend**, no solo en frontend (IDOR protegido en todos los endpoints).

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

Gestión del ciclo de vida de reclamos de calidad: desde el registro inicial hasta el cierre con
PDF e informe enviado por correo. Incluye análisis de causa, acciones correctivas y validación.

**Usuarios principales:** USC (crea y supervisa) · Cubicador/Externo (analiza y responde) · Admin (gestión total).

### 3.2 Flujo de estados

```
                    ┌─────────────────────────────────────┐
                    │                                     │
  ABIERTO ──────► EN_ANALISIS ──────► VALIDACION ──────► CERRADO
                                          │
                                          ▼
                                      RECHAZADO ──────► EN_ANALISIS
                                      (reabre automático)
```

| Estado | Significado | Quién avanza |
|--------|-------------|--------------|
| `abierto` | Recién creado, esperando respuesta | USC crea; cubicador/externo responden |
| `en_analisis` | Cubicador trabajando el análisis | — (transición automática al editar análisis) |
| `validacion` | Enviado para que USC valide | Cubicador/Externo (propios) + admin/admin2 |
| `cerrado` | USC validó y aprobó | Admin/admin2 |
| `rechazado` | Rechazado definitivamente | Admin/admin2 |

### 3.3 Permisos por sección

#### Ver listado

| Rol | Qué ve |
|-----|--------|
| admin / admin2 / cubicador | Todos los reclamos (toggle Todos/Mis reclamos) |
| usc | Propios por defecto (toggle para ver todos en lectura) |
| externo | Solo propios, sin toggle |
| cliente | Sin acceso a la caluga |

#### Ver detalle

| Rol | Acceso |
|-----|--------|
| admin / admin2 / cubicador | Cualquier reclamo |
| usc | Solo donde es `creado_por` o `asignado_a` |
| externo | Solo donde es `cubicador_asignado` o `respuesta_por` |
| cliente | Sin acceso |

#### Crear reclamo

- Permitido: USC, admin, admin2.
- No permitido: cubicador, externo, cliente.

#### Sección 1 — Registro (datos básicos)

Campos: título, descripción, proyecto, USC responsable, cubicador responsable, prioridad, id_calidad, observaciones.

| Acción | admin/admin2 | usc (propio) | cubicador | externo | cliente |
|--------|:---:|:---:|:---:|:---:|:---:|
| Ver | ✅ | ✅ | ✅ | ✅ | — |
| Editar | ✅ | ✅ (estado=abierto) | — | — | — |

#### Sección 2 — Análisis (respuesta cubicador)

Campos: categoría Ishikawa, sub-causa, respuesta, área aplica, fecha análisis, kilos mal fabricados, imágenes análisis, acciones correctivas.

| Acción | admin/admin2 | usc | cubicador (propio) | externo (propio) | cliente |
|--------|:---:|:---:|:---:|:---:|:---:|
| Ver | ✅ | ✅ | ✅ | ✅ | — |
| Editar | ✅ | — | ✅ | ✅ | — |
| Botón "Enviar a validación" (morado) | ✅ | — | ✅ | ✅ | — |

#### Sección 3 — Validación (rectángulo verde)

Campos: resultado (aprobado/rechazado/corregido), observaciones, tiempo de respuesta.

| Acción | admin/admin2 | usc | cubicador | externo | cliente |
|--------|:---:|:---:|:---:|:---:|:---:|
| Ver sección completa | ✅ | — | — | — | — |
| Editar y guardar | ✅ | — | — | — | — |

> El contenedor verde completo es invisible para todos excepto admin/admin2.

#### Imágenes

| Tipo | Sube | Elimina |
|------|------|---------|
| ImagenesRegistro (evidencia USC) | admin/admin2/usc | admin/admin2 + usc (propios) |
| ImagenesAnalisis (evidencia cubicador) | admin/admin2/cubicador/externo | admin/admin2 + cubicador/externo (propios) |

- cliente: sin permiso de subir ni eliminar.
- Todas las imágenes viven en R2 bajo `reclamos/registro/` y `reclamos/analisis/`.

#### Acciones correctivas

| Acción | admin/admin2 | usc (propio) | cubicador (propio) | externo (propio) |
|--------|:---:|:---:|:---:|:---:|
| Agregar | ✅ | — | ✅ | ✅ |
| Editar | ✅ | ✅ | ✅ | ✅ |
| Eliminar | ✅ | ✅ | ✅ | ✅ |

#### PDF e informe por correo

| Acción | admin/admin2 | usc (propio) | cubicador (propio) | externo |
|--------|:---:|:---:|:---:|:---:|
| Exportar PDF | ✅ | ✅ | ✅ | — |
| Enviar informe por correo | ✅ | ✅ | — | — |

El PDF incluye: header, sección registro, análisis, acciones, validación, imágenes (descargadas de R2), timeline de seguimientos.

### 3.4 Flujo completo — Reclamo típico USC→Cubicador

```
USC crea reclamo
       │
       ▼
  [abierto]
       │ Cubicador asignado inicia análisis
       ▼
  [en_analisis]
       │ Cubicador completa y presiona "Enviar a validación" (morado)
       ▼
  [validacion]
       │ Admin/admin2 revisa y valida
       ├──────────► [cerrado] — fin. Admin genera PDF y envía por correo.
       │
       └──────────► [rechazado] → automático vuelve a [en_analisis]
                         Cubicador corrige y re-envía
```

### 3.5 Pendientes funcionales (F5)

| # | Descripción | Estado |
|---|-------------|--------|
| 5.3 | Política acceso imágenes R2 — presigned URL, decisión tiempo expiración | ☐ pendiente decisión |
| 5.4 | QA visual PDF: campos largos, sin acciones, sin validación | ☐ |
| 5.6 | Optimizar query listado: LEFT JOIN + GROUP BY + índices | ☐ |
| 5.7 | Evaluar split de reclamos.py | ☐ |
| 5.8–5.12 | Envío de informe por correo (tabla reclamo_envios, endpoint, UI, historial) | ☐ |
| 5.13–5.17 | Multi-origen: tipos de origen, UI segmentable | ☐ |

### 3.6 Decisiones de diseño

- **Un solo helper de correo** (`mailer.py`) reutilizado por todas las calugas.
- **No hay estado `accion_correctiva`** — eliminado (migración 46).
- **No hay estado `validado`** — eliminado (migración 47), merged a `cerrado`.
- **Correlativo de calidad:** `anio_calidad` (int) + `numero_calidad` (int), display como "2026-003".
- **Multi-origen:** pendiente de discovery antes de implementar (F5C).
- **Sin BYTEA:** toda imagen en R2 desde migración 54.
- **Cache:** deshabilitado para usc/externo (scope restringido) — activo solo para admin/admin2/cubicador.

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

| Acción | admin/admin2 | cubicador | usc | externo | cliente |
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
| Cache condicional por rol | Cache activo para admin/admin2/cubicador. Deshabilitado para usc/externo. |
| Diseño caluga por caluga | El diseño visual y funcional se define caluga por caluga. Armonización global post-F9. |
| No hay estado `validado` | Eliminado migración 47 — flujo termina en `cerrado`. |
| No hay estado `accion_correctiva` | Eliminado migración 46. |
| Roles globales vs por obra | Rol global determina capacidades del usuario. Rol por obra (proyecto_usuarios) determina scope dentro de una obra. |

---

*Fin del documento. Actualizar al cerrar cada caluga o al cambiar flujos, permisos o decisiones de diseño.*
