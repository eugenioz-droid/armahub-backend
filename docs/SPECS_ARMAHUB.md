# SPECS ARMAHUB — Especificaciones Funcionales

> **Propósito:** mapa funcional vivo de ArmaHub. Documenta flujos, permisos y decisiones de
> diseño por caluga. Se actualiza cada vez que cambia un flujo, rol o comportamiento. No es
> un roadmap — para eso está `docs/programa-versiones/`.
>
> Última actualización: 2026-06-11 · Infraestructura: Render (FastAPI) + Supabase (PostgreSQL) + Cloudflare R2
>
> **Discovery Reclamos v2 (2026-06-10):** diseño de áreas, flujos multi-área y RCA documentado. Pendiente de implementación.
> **Validaciones (2026-06-11):** flujo `en_revision` + sub-tab Validaciones implementados (estados reales: `en_revision`/`validacion`). Rol `admin2` renombrado a `admin_calidad`. Modal reutilizado por contexto (`_recModalOrigen`); acciones de flujo solo desde Validaciones. PATCH no destructivo (respeta `__fields_set__`). Ver 3.3.1–3.3.3. Filtro por área del Jefe de Servicio pendiente (Plan 2).

---

## ÍNDICE

0. [Glosario / terminología](#0-glosario--terminología)
1. [Roles y permisos globales](#1-roles-y-permisos-globales)
2. [Infraestructura y almacenamiento](#2-infraestructura-y-almacenamiento)
3. [Caluga: Reclamos](#3-caluga-reclamos)
4. [Caluga: Cubicación](#4-caluga-cubicacion)
4A. [Caluga: Catálogo Armacero](#4a-caluga-catálogo-armacero)
5. [Caluga: Mis Proyectos (Discovery Obra)](#5-caluga-mis-proyectos-discovery-obra)
6. [Caluga: Programa de Obra](#6-caluga-programa-de-obra)
7. [Caluga: Admin](#7-caluga-admin)
8. [Caluga: CRM](#8-caluga-crm)
9. [Servicios transversales](#9-servicios-transversales)
10. [Decisiones de diseño globales](#10-decisiones-de-diseño-globales)

---

## 0. GLOSARIO / TERMINOLOGÍA

> Fijado 2026-07. Términos rectores para evitar la ambigüedad histórica entre "cliente",
> "obra" y "constructora". Usar estos términos en código, UI y documentación.

| Término | Qué es | Tabla | Ejemplo |
|---------|--------|-------|---------|
| **Constructora** | La empresa que encarga las obras. Nivel corporativo: una constructora tiene MUCHAS obras. Es la entidad que agrupa para métricas corporativas. | `constructoras` | "DLP" |
| **Obra** (= Proyecto) | El proyecto específico que se cubica. Pertenece a UNA constructora. | `proyectos` | "Edificio Talca 2 Sur" |
| ~~Cliente~~ | **Término AMBIGUO — evitar en lo técnico.** Históricamente se usó tanto para la constructora como para la obra. En la UI la caluga se rotula "Clientes" por costumbre comercial, pero conceptualmente gestiona **Constructoras**. | — | — |

**Modelo (fijado 2026-07):** dos niveles. La **OBRA** (`proyectos`) es el registro de
trabajo; la **EMPRESA** (`constructoras`) es una entidad propia que la obra referencia.

| Nivel | Tabla | Qué es | Campos clave |
|-------|-------|--------|--------------|
| **Obra / Tienda** | `proyectos` | La unidad que se cubica. Registro principal de trabajo. | `clasificacion` (obra/tienda/otro), `constructora_id` (→ empresa), `calculista_id`, kilos, reclamos |
| **Empresa** | `constructoras` | Constructora o retail. Entidad con ficha propia. | `nombre`, `tipo` (constructora/retail/otro), `rut`, `contacto`, `email`... |

**Caluga "Clientes"** (nombre global — engloba obras y tiendas). Dos sub-tabs:
- **Obras / Tiendas** (primario): lista las obras existentes, edita su data (clasificación, empresa —selector de entidad—, calculista, fecha, descripción). Columnas incluyen Kilos y **Reclamos** (indicador de carga asignada). Filtros por clasificación/empresa/sin-empresa.
- **Empresas** (secundario): CRUD de empresas (ficha con RUT/contacto). Conteo de obras por empresa. Borrado bloqueado si la empresa tiene obras asignadas.

**Notas de terminología:**
- El `nombre_proyecto` histórico es texto compuesto `Empresa - Obra` (ej. `"DLP - Edificio Talca 2 Sur"`). El prefijo está embebido por cómo se ingresa en el sistema de procesamiento (Detailer). Se deja tal cual; limpiar el prefijo es tarea futura.
- La obra→empresa es `proyectos.constructora_id` (FK a `constructoras`). `proyectos.empresa` (texto, mig 81) quedó INERTE al reactivar la empresa como entidad.
- Una **Empresa** (constructora/retail) NO es lo mismo que un **Calculista** (quien diseña la obra, `calculistas`). El modelo unificado completo de cliente/CRM sigue siendo Fase 11.

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

### 1.6 Matriz de acceso — quién entra a dónde (TABLA VIVA)

> Fuente de verdad de permisos por rol × tab. Editar aquí cuando cambie un acceso.
> `✓` = acceso completo · `propio` = solo sus reclamos · `RO` = solo lectura · `—` = sin acceso.

| Tab / Módulo | admin | admin_calidad | jefe_servicio | miembro / usc | cubicador | externo | cliente |
|---|---|---|---|---|---|---|---|
| Reclamos (listado Clientes) | ✓ | ✓ | área | propio | propio | propio | — |
| Reclamos — Validaciones | ✓ | ✓ | su área | — | — | — | — |
| Reclamos Internos *(futuro)* | ✓ | ✓ | su área | área | — | — | — |
| Matrices RCA | ✓ | ✓ | su área | — | — | — | — |
| Cubicación | ✓ | — | — | por obra | por obra | propio | RO |
| Admin / Gestión | ✓ | — | — | — | — | — | — |
| Dashboards | ✓ | ✓ | RO | RO | — | — | — |

Notas:
- **jefe_servicio** y **miembro** son roles **por área** (`area_usuarios.rol_area`), no globales. "su área" = las áreas donde el usuario tiene ese rol.
- **cubicador externo:** es un miembro del área Cubicaciones con acceso restringido — solo el tab Reclamos y solo sus propios reclamos. No tiene otro acceso.
- **admin_calidad (Jefa de Calidad):** validación final en todas las áreas; fallback de cualquier jefe.
- Cambios de acceso futuros (ej. mover el panel del flag de revisión a Calidad) se reflejan primero acá.

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
- **`MAIL_FROM` (remitente) es configurable por env var** → cambiar el dominio NO
  toca código. Para enviar a destinatarios externos, el dominio de `MAIL_FROM` debe
  estar **verificado en Resend** (registros DNS DKIM/SPF en el DNS del dominio).
  Sin dominio propio verificado, Resend solo entrega de forma fiable a la cuenta
  dueña de la API key (modo prueba). Plan: usar un dominio ya disponible para
  pruebas y cambiar `MAIL_FROM` al definitivo (`armacero.cl`) cuando esté verificado.

### 2.4 Convenciones de UI (transversal — NO romper)

Reglas de prolijidad gráfica que aplican a TODA caluga, para mantener consistencia:

- **Estructura de tabs de dos niveles** (patrón shell estándar, ej. Calidad/Reclamos):
  1. **Nivel 1** = botones de tab en la barra superior (`switchTab`).
  2. **Nivel 2** = sub-tabs DENTRO del tab. La **barra de sub-tabs va PRIMERO**,
     inmediatamente bajo los tabs de nivel 1. Estilo estándar: contenedor
     `display:flex; padding-top:4px; border-bottom:1px solid #f0f0f0; background:#fafafa;`
     y botones `padding:5px 16px; font-size:12px; font-weight:600; border-bottom:2px`
     (color de marca si activo, `transparent`/gris si no).
  3. **El título de cada sección va DENTRO de su panel**, como `<h3>`/`<h4>` de una
     `card` (con `border-top`/`border-left` de color). **NUNCA** un rectángulo de
     título suelto entre los tabs de nivel 1 y la barra de nivel 2 — rompe la línea.
- **Referencia canónica:** `templates/tabs/reclamos.html` (sub-tabs `recSubTabNav` +
  cards con título dentro). Replicar ese patrón al crear cualquier tab nuevo.

#### Carga de datos por tab y navegación (estándar — NO romper)

Reglas para que la navegación sea uniforme y la restauración tras F5 funcione sola:

- **La carga de datos de un tab vive en un loader centralizado, NO en el `onclick`.**
  `shell.js` tiene un mapa `tabLoaders = { tab: 'nombreFuncionGlobal' }`; `switchTab`
  invoca ese loader al activar el tab. Los botones solo llaman `switchTab('x')` — sin
  `; loadXxx()` pegado. Así, activar un tab por clic O por restauración carga sus datos
  igual. Antipatrón: poner la carga en el `onclick` (queda fuera del flujo de F5).
- **Los loaders deben ser idempotentes** o tener guard (ej. `if (_loaded) return;`) para
  no recargar de más cuando se invocan varias veces.
- **Navegación = una sola fuente de verdad en el hash** (`#mod=...&tab=...&sub=...`).
  `switchModule`/`switchTab`/`switchRecSubTab` escriben el hash; el init de `app.js` lo
  lee tras `loadMe()` y restaura la posición.
- **Restaurar abre DIRECTO el destino, sin pasar por el default.** `switchModule(mod, tab)`
  acepta el tab destino como 2º parámetro y lo activa en vez del `defaultTab` — evita el
  "carga el default y luego salta" (parpadeo). Mecanismo global: vale para cualquier
  módulo/tab, sin condiciones especiales por panel.
- **Referencia:** `shell.js` (`switchModule`, `switchTab`, `tabLoaders`, `updateNavHash`)
  + `app.js` (init que restaura desde el hash).

#### Sensación rápida — actualización optimista tras guardar (estándar — NO romper)

> Directriz transversal (2026-07). El portal debe sentirse instantáneo al editar. El
> antipatrón que genera lag: **"guardar → recargar TODO del servidor"**.

- **Al guardar un cambio, NO recargar toda la lista desde el servidor.** Si el backend
  confirmó (`data.ok`), el frontend ya sabe qué cambió: actualizar el objeto en la caché
  en memoria (el array que ya tiene el listado) y **re-renderizar solo la vista local**.
  Sin viaje de red extra → respuesta instantánea.
- **Patrón:** `PATCH` → `if (data.ok) { actualizar item en el array local; render(); }`.
  Recargar del servidor (`loadXxx()`) solo si el cambio afecta datos que el frontend NO
  puede calcular (ej. un total del backend que no se puede derivar localmente) — y aún así,
  evaluar si vale el lag.
- **Por qué:** el caso típico malo es recargar un endpoint pesado (que recalcula kilos de
  todas las barras, hace joins, etc.) tras editar UN campo de UNA fila. Editaste una cosa,
  no el universo.
- **Datos derivados en memoria:** si un campo editado alimenta un selector/autocompletado
  (ej. lista de empresas), incorporar el valor nuevo al array local en vez de re-pedirlo.
- **Referencia (piloto):** `features/clientes/index.js` (`guardarObraData` → optimistic
  update de `_obrasData` + `renderClientesLista()`, sin recargar `/proyectos`).
- **Pendiente:** propagar este patrón a los módulos que aún hacen "guardar → recargar todo"
  (Reclamos, Cubicación, Admin). Ver tarea en el programa.

#### IDs de HTML únicos en TODO el DOM (estándar — NO romper)

> Regla nacida de un bug real (2026-07): el buscador de obra del Bar Manager dejó de cargar
> data porque su `id="proyectoSearchInput"` **ya existía** en el tab Obras. Como TODOS los
> tabs se incluyen en la misma página (`{% include %}`) y coexisten en el DOM, un id repetido
> hace que `document.getElementById(id)` devuelva **el primero en el DOM** (el de otro tab),
> normalmente vacío → el filtro lee el elemento equivocado → falla en silencio, sin error.

- **Cada `id` debe ser único en TODA la app, no solo dentro de su tab.** Los tabs no están
  aislados: conviven en el mismo documento. No hay "scope por tab".
- **Convención:** prefijar los ids de controles con el tab/caluga cuando el nombre es genérico
  y podría chocar (`bmProyectoSearchInput`, `recFiltroEstado`, `catFigBusqueda`…). Nombres
  genéricos sin prefijo (`proyecto`, `sector`, `q`, `buscar`) son la trampa.
- **Filtros con texto (input + `<datalist>` o input que controla un `<select>` oculto):** el
  patrón depende de `getElementById` para leer el input y fijar el valor; un id duplicado lo
  rompe callado. Aplica al buscador de obra y al de Eje (Bar Manager) — y a cualquier filtro
  nuevo de este tipo. Si agregas uno, **dale id único con prefijo**.
- **Verificación (correr al tocar plantillas de tabs):**
  ```
  py -c "import re,glob,collections,os; ids=collections.defaultdict(set)
  [ids[m].add(os.path.basename(f)) for f in glob.glob('armahub/templates/tabs/*.html')
   for m in re.findall(r'\\sid=\"([^\"]+)\"', open(f,encoding='utf-8').read())]
  [print(k,'->',sorted(v)) for k,v in sorted(ids.items()) if len(v)>1] or print('sin duplicados cross-tab')"
  ```
  Debe imprimir "sin duplicados cross-tab". Si lista alguno, renómbralo con prefijo.
- **Referencia del bug:** commit `b406ffc` (id duplicado `proyectoSearchInput` bar_manager↔obras).

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
| `externo` | Roles configurables (hoy: admin/admin_calidad/usc) | Cliente / Proyecto |
| `interno` | Roles configurables (hoy: todos menos externo) | Cliente OPCIONAL (puede no tener cliente) |

**Quién levanta reclamos es CONFIGURABLE** (tabla `reclamo_crear_config(accion, rol, activo)`,
panel en Admin → Áreas). Se separa por `externo`/`interno`: se tilda qué roles pueden
crear cada tipo. `admin`/`admin_calidad` siempre pueden (no se desmarcan). El backend
valida contra esta config (`_rol_puede_crear`), no por rol hardcodeado. Mismo mecanismo
servirá al formulario de internos tildando los roles que correspondan.

**Diferencias internos vs externos (a resolver al construir la sección):**
- Internos pueden NO estar asociados a un cliente (externos sí lo están).
- Flujo interno hoy: el área responsable analiza y va a validación (igual que externo).
  Si se quiere, se puede reusar el flag `tiene_revision` por área. Cambios de UI
  pendientes; singularidades se resuelven al construir Internos.

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
| `en_revision` | Jefe de Servicio (admin) revisa la respuesta del intermediario. Solo existe en áreas con etapa de revisión activada (ver nota de flujo). Aparece en sub-tab Validaciones → "En revisión". Aprobar → `validacion`; Devolver → `en_analisis`, explicación obligatoria |
| `validacion` | Jefa de Calidad (`admin_calidad`) valida. Aparece en "Validación Calidad". Aprobar → `cerrado`; Devolver → `en_revision` (rebota al Jefe de Servicio que aprobó) |
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

> **¿Qué determina el flujo?** Que el área tenga o no **etapa de revisión**. Por diseño, el flujo correcto es: **por defecto todas las áreas van directo a validación** (Flujo B) — el Jefe de Servicio responde y pasa a Calidad, asumiendo que tiene criterio suficiente y que no hay un rol previo. La **etapa de revisión** (Flujo A) es la **excepción configurable**: solo se activa en áreas donde el Jefe de Servicio antepone un intermediario que responde el reclamo (ej. Producción con un cubicador/analista previo).
>
> **Estado actual (heurística temporal):** hoy se decide por texto sobre `area_aplica` ("Cubicación…") o por `cubicador_asignado`. Esto es un hardcode a reemplazar.
>
> **Plan 2 — flag de revisión por área (modular):** un flag `tiene_revision` (bool) **por área**, no por usuario (la pregunta "¿este servicio revisa?" es del servicio). Tabla/columna propia (`areas_config` o similar), un endpoint GET/PATCH, y un panel de checkboxes. **Ubicación inicial:** Admin → Gestión. **Migrable a Calidad/Reclamos** después para que lo administre la Jefa de Calidad (al estar aislado en su propio panel/endpoint, mover dónde se renderiza es trivial). El flujo entonces se decide por `area.tiene_revision`, no por el nombre del área. Incluye también el modelo `area_id` real + `area_usuarios` para filtrar la cola "En revisión" por el área de cada Jefe de Servicio.

> **Reasignación:** si un reclamo fue asignado al área equivocada, quien lo creó puede reasignarlo mientras está en `abierto` o `en_analisis`. Si ya pasó a validación, solo admin/admin_calidad pueden reasignar.

### 3.3.0 Asignación del responsable (IMPORTANTE)

Quién "trabaja" un reclamo se define distinto según el tipo:

- **Externos (Reclamos Clientes):** el **Responsable** lo elige USC (o quien crea el reclamo) y puede ser **CUALQUIER usuario** del sistema — normalmente un **miembro** o **jefe de servicio** de un área, pero no se restringe por rol. Se guarda en `cubicador_asignado` (email) + `responsable` (nombre). El `area_id` del reclamo se infiere del área de ese responsable.
  - **Implicancia técnica:** los `<select>` de Responsable (form de creación y de edición) y el filtro "Cub. Resp." se pueblan con **todos** los usuarios activos (`/users/dropdown`), **sin filtrar por rol**. Filtrar por `cubicador`/`externo` es un error: deja fuera responsables con otros roles (p.ej. tras migrar un usuario de `cubicador` a `miembro`) y el select aparece vacío aunque el responsable exista.
  - **Reasignación:** solo `admin`/`admin_calidad` (o el USC propietario mientras está `abierto`), entrando a **Editar**. No hay selector de reasignación en el header del detalle.

- **Internos (Reclamos Internos):** NO se elige usuario. Se elige el **ÁREA destino**; el responsable se asigna automáticamente al **Jefe de Servicio de esa área** (`_jefe_servicio_de_area`). Reasignar = cambiar el área (vía Editar), lo que recalcula el jefe de servicio.

> **Nota de roles:** los roles legacy con oficio (`cubicador`, `externo`) están siendo reemplazados por roles con nivel que pertenecen a áreas (`miembro`, `jefe_servicio`). Por eso ninguna lógica de asignación de responsable debe asumir un rol concreto. Reclamos creados antes de una migración de rol pueden tener un responsable cuyo rol ya cambió: sigue siendo válido (la identidad es el email, no el rol).

### 3.3.1 Sub-tab Validaciones — arquitectura (IMPORTANTE)

El sub-tab **Validaciones** (dentro de Calidad/Reclamos) es una **vista de trabajo**, igual que Presentaciones: trae reclamos por estado y permite avanzarlos, pero **no es el listado oficial**. Reglas de diseño que NO se deben romper:

1. **El listado oficial es "Reclamos Clientes".** Muestra TODOS los reclamos en cualquier estado, siempre. Ningún estado los oculta. Es la fuente de verdad.

2. **El sub-tab Validaciones tiene dos secciones:**
   - **🔍 En revisión** (sección ámbar): cola de reclamos en estado `en_revision`. Visible solo para `admin` (Jefe de Servicio). KPIs: En revisión / Abiertos / Cerrados.
   - **✅ Validación Calidad** (sección verde): cola de reclamos en estado `validacion`. Visible para `admin` y `admin_calidad`. KPIs: Pendientes / Abiertos / Cerrados / Tiempo (este último pendiente, tarea 5.40). Dos listas: Clientes / Internos (Internos hoy placeholder).
   - Acceso: `admin` ve ambas; `admin_calidad` solo Validación Calidad.

3. **Las filas de ambas colas** usan el formato compacto de la lista oficial (`_renderColaReclamos` en dashboards.js): N° · Título · Proyecto · Aplica. Clic en la fila → abre el **modal de detalle** (`verReclamo(id, {origen:'validaciones'})`). Sin botones en la fila.

4. **El modal de detalle se reutiliza** (no se recrea). Vive en el DOM dentro de `recSubClientes`, que se oculta al cambiar de sub-tab; por eso al entrar a Validaciones se **reparenta** a `tab-reclamos` con `_ensureModalFueraDeSubpaneles()` (dashboards.js), para que flote sobre cualquier sub-tab.

5. **Las acciones de flujo viven DENTRO del modal**, en secciones de color según estado, y **solo se muestran si el sub-tab Validaciones está visible** (se deriva del DOM: `recSubValidaciones` con `display !== 'none'`, en `detail-permissions.js`). NO se usa una variable de estado (la antigua `_recModalOrigen` se eliminó por frágil: se quedaba pegada entre aperturas). Ambas secciones tienen **la misma gráfica y disposición**: un campo de explicación + dos acciones (Devolver / Aprobar). Sin desplegables ni campos extra.
   - Estado `en_revision` → sección **ámbar**: "Aprobar" (→ validacion) o "Devolver" (→ en_analisis). Explicación **obligatoria** para ambas (`recRevisionComentario`).
   - Estado `validacion` → sección **verde**: "Aprobar" (→ cerrado, vía `validacion_resultado='aprobado'`) o "Devolver" (→ en_revision, rebota al Jefe de Servicio). Explicación **obligatoria** para ambas (`recValidacionComentario`).
   - **Sin `prompt()`:** el motivo es el campo en pantalla. Si está vacío, warning bloqueante (no deja avanzar). No se pide la explicación por segunda vía.
   - **Desde el listado oficial (Reclamos Clientes) estas secciones NUNCA aparecen.** El modal ahí es solo lectura/registro.

6. **El botón "Enviar a revisión/validación"** (sección 1 del modal, `recCerrarContainer`) aparece cuando el reclamo está en `abierto`/`en_analisis` y el usuario es el responsable o admin. Es el cierre del análisis, no una acción de validación. Al enviar, persiste TODO el análisis del form junto con el cambio de estado (no exige "Guardar análisis" previo).

7. **El formulario de datos queda READ-ONLY fuera de la etapa de análisis.** Mientras el reclamo está en `abierto`/`en_analisis` es editable (por el responsable/admin); una vez en `en_revision`/`validacion`/`cerrado`/`rechazado` **se bloquea para TODOS los roles, admin incluido** — está en otra etapa. Aplica a: edición de datos (sección 1), selector Aplica, respuesta/análisis (sección 2) y acciones. Para volver a editar hay que **Reabrir** (admin), que devuelve el reclamo a `en_analisis`. Las únicas acciones disponibles fuera de análisis son las de flujo (Aprobar/Devolver, regla 5).

#### Estructura de archivos JS del modal (refactor 2026-06-12)

El antiguo `detail.js` (1.290 líneas) se dividió en 4 archivos por responsabilidad. Todos son file-scope global (window), cargados en paralelo por `bootstrap.js` y reutilizables por cualquier listado (Clientes, Internos):

| Archivo | Responsabilidad |
|---|---|
| `detail-render.js` | Render de la ficha (header, antecedentes, respuesta, assets) + helpers (acciones/imágenes/timeline) + captura/restauración del borrador de análisis |
| `detail-permissions.js` | Visibilidad y read-only del modal según rol, estado y contexto (deriva el contexto Validaciones del DOM) |
| `detail-flow.js` | Navegación del modal (verReclamo, prev/next) + acciones de flujo (enviar, aprobar/devolver en revisión y validación, reabrir) |
| `detail-edit.js` | Edición de datos, respuesta/análisis, aplica, acciones (medidas), uploads, seguimientos, ishikawa, eliminar, PDF |

Los datos compartidos (`_reclamoActual`, `_reclamosListaIds`, `_ishikawaSelection`) viven en `constants.js` (carga primero). Las funciones se exponen vía el orquestador `index.js`.

#### Reclamos Internos (sub-tab Internos)

Reclamo **área → área** (gestión interna de calidad / oportunidades de mejora). **Recicla EXACTAMENTE el diseño de Reclamos Clientes**: mismas 3 secciones (Mi Resumen / Nuevo reclamo / Lista+filtros), mismos colores, mismos botones, mismo modal de creación elevado (`openReclamoModal` sobre la card, NO un form embebido aparte) y el mismo modal de ficha. Solo cambian las diferencias funcionales de abajo.

**Estructura visual (idéntica a Clientes):**
1. **Mi Resumen** — 3 charts mismo formato (datos filtrados a internos).
2. **Nuevo reclamo** — card con botón "+ Registrar reclamo" que **eleva la card a modal** (igual que externos), con el mismo form y colores. Botón rojo "Registrar reclamo".
3. **Lista + filtros** — mismos botones (Mis Reclamos / Aplica / Abiertos-Cerrados / búsqueda) y tabla.

**Diferencias funcionales (lo ÚNICO que cambia):**
- **Tipo:** `reclamos.tipo_origen = 'interno'`. Separa las dos listas; `/reclamos` filtra por `tipo_origen`.
- **Área destino en vez de Cubicador Responsable:** se elige el ÁREA responsable; el responsable se asigna automáticamente al **Jefe de Servicio de esa área** (`_jefe_servicio_de_area`). Sin selección manual de usuario.
- **Cliente/Proyecto opcional:** puede no tener cliente. Los clientes se gestionan con la **lógica central de clientes/obras** (NO hay cliente "Armacero" hardcodeado/sembrado; si se quiere un cliente interno, se crea con el método normal de clientes).
- **Año/N° calidad:** se mantienen igual que externos (el correlativo de calidad aplica a ambos).
- **Flujo:** idéntico, gobernado por el flag `areas.tiene_revision` del área destino. Se valida desde el sub-tab Validaciones igual que los externos.
- **Quién levanta:** configurable (`reclamo_crear_config` acción `interno`).
- El "área origen" (quién reclama) NO es campo: se obtiene de `creado_por` → su área, para estadísticas.

**Implementación correcta:** reusar `toggleNuevoReclamo`/`crearReclamo`/`openReclamoModal` parametrizados por tipo, NO funciones separadas. El modal de ficha se abre con `verReclamo(id, {origen:'internos'})`.

### 3.3.2 Integridad de datos — PATCH no destructivo (REGLA CRÍTICA)

El endpoint `PATCH /reclamos/{id}` (`actualizar_reclamo` en reclamos.py) **solo escribe los campos que vinieron en el JSON** (`body.__fields_set__`). Un campo ausente del request NUNCA se toca. Esto evita que el formulario, al reenviar campos vacíos, borre datos que el usuario no editó (bug histórico de meses, resuelto 2026-06-11).

- `"" → NULL` solo para campos `nullable_fields` **enviados explícitamente vacíos** (borrado intencional).
- La regla `aplica="no"` que borra Ishikawa **solo corre en la transición explícita** (aplica vino en el JSON, valor "no", y antes no era "no").
- El frontend (`guardarRespuesta`, `cerrarReclamo`) construye el body **omitiendo campos vacíos** (helper `_setIf`).
- **Para cualquier endpoint PATCH nuevo: seguir este patrón.** Nunca mandar el form completo en cada guardado; nunca escribir campos no enviados.

### 3.3.3 Validaciones de completitud al enviar

Al **enviar** un reclamo hacia adelante por primera vez (`abierto`/`en_analisis` → `en_revision` o `validacion`), el backend exige: Aplica marcado (sí/no, no "pendiente"), explicación/justificación (`respuesta_texto`) no vacía, y al menos 1 acción. Estas son obligatorias (filtro de calidad del análisis).

Al **aprobar** o **devolver** en revisión o validación, NO se re-exige el análisis completo (ya se validó al enviar), pero **SÍ es obligatoria una explicación** del revisor/validador: tanto para aprobar como para devolver, en ambas secciones (ámbar y verde). Es la justificación de la decisión y queda en el timeline de seguimiento. Si el campo está vacío, warning bloqueante en el front.

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

El flujo de cada área NO se decide por su nombre, sino por el flag `areas.tiene_revision`:
- `tiene_revision = TRUE` → el área tiene **etapa de revisión** (análisis → revisión → validación).
- `tiene_revision = FALSE` → directo (análisis → validación). Es el nivel base.

| Área | tiene_revision | Quién analiza | Revisa | Valida final |
|------|----------------|--------------|--------|--------------|
| Cubicaciones | **TRUE** | Miembro del área (cubicador) | Jefe de Servicio del área | admin_calidad (Calidad) |
| USC C&D / MPEC | FALSE | Jefe de Servicio | — | admin_calidad |
| Producción C&D / MPEC / Prearmado | FALSE | Jefe de Servicio | — | admin_calidad |
| Logística | FALSE | Jefe de Servicio | — | admin_calidad |
| Ventas C&D / MPEC | FALSE | Jefe de Servicio | — | admin_calidad |
| Calidad | FALSE | Jefe de Servicio | — | admin_calidad |
| Planificación | FALSE | Jefe de Servicio | — | admin_calidad |

> Hoy solo Cubicaciones está en TRUE. El flag se administra desde Admin (ver [PLAN_MODELO_AREAS.md](PLAN_MODELO_AREAS.md)).
> Un jefe puede ser Jefe de Servicio de más de un área (M:N en `area_usuarios`).
> `admin` es fallback total; puede actuar en cualquier paso de cualquier área.

### 3.6 Modelo de datos de áreas

**YA IMPLEMENTADO** (migraciones 55-58): tablas `areas` (11 áreas sembradas),
`area_usuarios` (M:N usuario↔área), `area_rca_categorias`/`area_rca_subcausas`
(matriz Ishikawa por área).

```sql
areas                          -- ✅ implementada (mig. 55, seed 58)
  id          BIGSERIAL PK
  nombre      TEXT NOT NULL
  slug        TEXT UNIQUE NOT NULL   -- 'cubicaciones', 'usc_cd', etc.
  activo      BOOLEAN DEFAULT TRUE
  tiene_revision BOOLEAN DEFAULT FALSE   -- ⬜ pendiente (PLAN_MODELO_AREAS Fase A)

area_usuarios                  -- ✅ implementada (mig. 56)
  id          BIGSERIAL PK
  area_id     BIGINT FK→areas
  user_id     BIGINT FK→users
  rol_area    TEXT  -- 'miembro' | 'jefe_servicio'
  UNIQUE(area_id, user_id)

area_rca_categorias            -- ✅ implementada (mig. 57)
  id          BIGSERIAL PK
  area_id     BIGINT FK→areas
  slug        TEXT
  nombre      TEXT NOT NULL  -- ej: 'Mano de obra'
  orden       INTEGER
  UNIQUE(area_id, slug)

area_rca_subcausas             -- ✅ implementada (mig. 57)
  id           BIGSERIAL PK
  categoria_id BIGINT FK→area_rca_categorias
  codigo       TEXT          -- ej: 'MO01'
  descripcion  TEXT NOT NULL
  activo       BOOLEAN DEFAULT TRUE
  orden        INTEGER
```

**Pendiente** (ver [PLAN_MODELO_AREAS.md](PLAN_MODELO_AREAS.md)): columna `tiene_revision`
en `areas`, y conectar el reclamo a su área real (`area_id`, inferido del usuario)
para reemplazar la heurística de texto sobre `area_aplica`.

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

### 4.5 Edición de barras desde la plataforma (5M — en construcción)

> Objetivo: que el cubicador corrija data de una barra sin re-exportar desde ArmaDetailer.
> Ver programa sección 5M (fases). Diseño fijado 2026-07.

**Modelo de geometría de la barra:** `figura` (código) + `dim_a..dim_i` (9 slots de
dimensión) + `ang1..ang4` (4 ángulos) + `radio`. Los slots que usa cada figura pueden ser
NO contiguos (ej. figura 201A usa B, G, H). La semántica de qué slots/ángulos usa cada
figura vive en el **Catálogo Armacero** (§4A), no en las barras.

**Edición segura (reglas de diseño):**
- **Bloqueo:** botón candado 🔒 en Bar Manager, con warning al activar el modo edición.
  Por defecto solo lectura; se abre a propósito. Solo UI (no persiste). Al cerrar el candado,
  si hay cambios sin guardar → pregunta "¿Guardar cambios?". Celdas editadas se resaltan.
- **Permisos:** editar = cubicador DUEÑO de la obra (`proyecto_usuarios`) + admin. Otro
  cubicador → aviso "no puedes editar esta barra".
- **Validación de figura:** al editar geometría, el backend valida contra el catálogo: la
  figura exige valor en SUS slots (`parciales`) y no en otros. Incoherente → rechaza.
- **Resaltado del dato que sobra:** al cambiar a una figura con menos lados, el sistema pinta
  en ROJO el/los dim(s) que sobran; el usuario los borra MANUALMENTE (control humano). No
  se borra solo.
- **Marca de edición manual:** columnas `editado_por`/`editado_fecha` en `barras`. Distingue
  la edición-plataforma de la data del CSV.
- **Auditoría:** acción `editar_barra` al `audit_log` central + panel de ediciones recientes
  al final del Bar Manager (vista de conveniencia por obra).
- **Re-import:** al subir un CSV que reescribiría barras con `editado_por`, el preview del
  import AVISA qué barras/campos se reescribirían antes de confirmar.
- **Color en matrices de exportación:** una celda editada en plataforma se pinta con color
  DISTINTO al rojo de "re-import pendiente" (`exportacion.js`), para distinguir visualmente.

### 4.6 Pendientes funcionales

> Detalle en programa F8-F9. Esta sección se completa durante el trabajo de esas fases.

---

## 4A. CALUGA: CATÁLOGO ARMACERO

> Caluga en construcción (programa 5M Fase 1). Centro técnico de data maestra: catálogo de
> figuras/tipologías de fierro, y a futuro configuración de lectura de catálogos y cargas
> en otros formatos, homologación multi-empresa, y motor de render.

### 4A.1 Propósito

Data maestra transversal de figuras de fierro. La consumen: Bar Manager (edición/validación
/filtros de barras), la validación de geometría, y a futuro el render SVG y el multi-catálogo.
Es una entidad de referencia propia (como Clientes/Calculistas), no un apéndice de Cubicación.

### 4A.2 Modelo (portado de `typology_catalog.py` de ArmaPilot)

- **Figura:** `codigo` (ej. 105A), `parciales` (slots dim que usa, ej. A,B,C,D,E), `angulos`
  (lista, ej. 45,135), `radio` (bool), descripción. Mapea directo a los slots de la barra
  (A→dim_a...). Fuente: `FIGURE_CATALOG`.
- **Tipología / tipo de estructura:** MURO/LOSA/VIGA/COLUMNA/FUNDACION/GEN → tipos (MH, MV,
  Fi, ES, CB...). Fuente: `TIPOS_*`.
- **Relación tipología → figuras aplicables:** qué figuras valen para cada tipología. Fuente:
  `FIGURAS_POR_TIPO`.
- **Tabla en BD editable** (no módulo estático), catálogo **ÚNICO** (Armacero). No hay
  multi-catálogo paralelo: el catálogo Armacero es la fuente de verdad. Lo que viene a futuro
  (F8) es un motor de **homologación** — traer data de catálogos externos (otros formatos) y
  mapearla al Armacero.

### 4A.3 Sub-tabs (previstos)

- **Figuras:** lista/creación/edición del catálogo de figuras.
- **Tipologías:** tipologías y sus figuras aplicables.
- (Futuro) **Homologación / Integraciones:** por cada catálogo externo, un tab de config que
  define cómo su formato se mapea al catálogo Armacero (integración 1-a-1). El resultado
  siempre queda homologado al Armacero.

### 4A.4 Diseñador de figuras (IMPLEMENTADO — `disenador.js`)

Sub-tab "🎨 Diseñador". El usuario **dibuja la figura por clicks** en un lienzo con grilla;
snap a ángulos limpios (45/90/135°). Cada segmento = un lado (A,B,C… reasignables). **El
nombre lo pone el usuario** (no autogenera). Guardar → `POST /figuras-catalogo` (UPSERT por
código): crea figura nueva O **puebla la geometría de una existente** (esto ES la homologación
por nombre — dibujar con el nombre del catálogo pega la geometría a esa figura). Galería de
figuras dibujadas (editar/borrar). Etiquetas α1/α2… en los vértices (convención aSa: 90° no
cuenta como α, solo los especiales van a `angulos`).

**Modelo de geometría** (campo `geometria` JSONB de `figuras_catalogo`):
```
{ dim:"2D"|"3D",
  tramos:[ {tipo:"recto",  lado, giro, sentido},              // línea
           {tipo:"arco",   lado, radio, barrido, sentido} ],  // curva (Plan curvas)
  puntos:[{x,y}...],          // WYSIWYG: render reproduce el dibujo exacto (no rota)
  etiquetas:[{tipo:"medida"|"letra"|"angulo", texto, x, y}] } // manuales (Plan curvas)
```
- **WYSIWYG:** `puntos` se guardan tal cual se dibujaron; el render los usa directo (no
  reconstruye desde heading=0, que rotaba la figura). Fallback a tramos para figuras viejas.
- El motor (`geometriaAPuntos`/`svgDesdePuntos`/`dibujarFigura`) es compartido por lienzo,
  galería, catálogo y Bar Manager. Vive en `window.disenadorMotor`.

**Render (antes "Fase 7"): HECHO.** El SVG se dibuja en el Diseñador, catálogo (tabla) y Bar
Manager (celda Figura). Vectorial, liviano, sin imágenes ni servidor. Estilo unificado
(90×72, pad proporcional, centrado).

### 4A.4.1 Plan CURVAS 2D + etiquetas manuales + drag de nodos (EN CURSO)

- **Curvas:** tramo `tipo:"arco"` (radio + barrido) → `<path>` SVG comando `A` (nativo).
  Control del radio = **slider** (decisión: lo más simple/liviano; el usuario pone los 2
  extremos con clicks y el slider curva). Parámetros de curva: **radio, altura de cuerda,
  desarrollo** — se ingresan 2, el sistema calcula el 3º.
- **Etiquetas manuales:** botón "Etiquetas" → modo donde el dibujo se limpia y el usuario
  coloca etiquetas de **medida (cota), letra y ángulo**. Visuales, ayudan a identificar. Regla
  de sistema: letra y ángulo deben ser de los DISPONIBLES en la data (no texto libre); la cota
  de medida sí es libre. Modelo `etiquetas:[{tipo,texto,x,y}]`.
- **Drag de nodos:** arrastrar los vértices para modificar la figura (2D y 3D). Factible (el
  SVG es persistente). Da versatilidad sin rehacer.

### 4A.4.2 Plan 3D (toggle 2D/3D) (PLANIFICADO)

- **Activación:** botones **2D / 3D** que cargan un lienzo u otro (con sus funciones).
- En 3D: visor Three.js `TubeGeometry` (barra=tubo de radio Ø siguiendo la polilínea 3D),
  cargado ON-DEMAND (solo al activar 3D). Entrada por parámetros de tramo (largo + giro +
  plano de doblez) — clicks planos son ambiguos en profundidad. + etiquetado manual también.
- Modelo `dim:"3D"` + plano por tramo. Las 2D no se tocan. Curva-3D = arco orientado (mismo
  concepto de tramo → no rehacer).

### 4A.5 Permisos

- **Ver catálogo:** admin + miembros (rol `miembro`; lo consumen para editar/filtrar barras).
- **Crear/editar figuras (Diseñador):** admins + editores extra por email (`_FIGURAS_EDITORES_EXTRA`
  en catalogo.py — override para cubicadores que ayudan a poblar, ej. Nicolás López). **Eliminar:
  solo admins.** Pendiente "bien hecho": permiso configurable en Admin.

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
| Gestión de constructoras | ➡️ movida a caluga **Clientes** (5L.11) |
| Gestión de calculistas | ➡️ movida a caluga **Clientes** → sub-tab Calculistas (5L.11.15) |
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

- **Dos fuentes, un solo registro** (`schema_migrations`, por número de versión):
  - **Legacy (1–81):** array `MIGRATIONS` en `armahub/db.py`. No se tocan.
  - **Nuevas (82+):** archivos `.sql` en `armahub/migrations/` (una por archivo, estilo
    Tekplan). Ver `armahub/migrations/README.md`.
- **Formato de archivo:** `NNN_descripcion.sql`. El prefijo `NNN` es la versión. La primera
  línea `-- descripción` se guarda como descripción. Varias sentencias separadas por `;`
  (el cargador respeta los bloques `DO $$ ... $$`).
- El cargador (`_run_migrations` en `db.py`) une legacy + archivos, ordena por versión y
  aplica solo las que no están en `schema_migrations`. Idempotente por diseño.
- Numeración correlativa y única. Nunca modificar/borrar una migración ya aplicada; para
  corregir, crear una nueva.
- Toda modificación de esquema entra como migración versionada.

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
