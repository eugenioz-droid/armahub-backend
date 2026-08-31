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

#### Filtro de texto BUSCABLE (input + datalist) — patrón estándar (NO reinventar)

> Nació de ~5 días de bugs (2026-07) intentando arreglar el filtro de Eje del Bar Manager. La
> lección: los 3 problemas que perseguíamos NO eran del campo, y se arreglan en la raíz. Este es
> el patrón que quedó funcionando; **reutilizarlo para cualquier filtro donde el usuario deba
> ESCRIBIR para buscar** (obra, eje, y futuros con muchas opciones — un `<select>` no sirve
> cuando hay decenas/cientos de valores, p.ej. una obra con ~140 ejes).

**Cuándo usarlo:** filtro sobre una lista con muchas opciones donde conviene teclear. Si son pocas
opciones fijas (sector, piso, ciclo, φ), usar `<select>` normal — más simple.

**Las 3 causas raíz que hacían fallar estos campos (y su fix DEFINITIVO, ya aplicado):**
1. **"Pide clave" / ícono de llave de Chrome.** NO es del input. Chrome escanea TODO el documento;
   si existe UN `<input type="password">` en el DOM (aunque esté `display:none`), trata los demás
   text inputs como credenciales. Fix transversal: **no dejar ningún `type="password"` en reposo**
   — el de crear-usuario (admin) arranca `type="text"` (+`-webkit-text-security:disc` para verse
   con puntos) y se promueve a `password` por JS solo mientras su form está abierto. Con eso, los
   blindajes por-campo (`autocomplete=off`, etc.) dejan de ser necesarios para el síntoma de clave.
2. **"No filtra al elegir."** Era el BACKEND, no el front: el endpoint de la vista por defecto
   (`GET /barras/elementos`) no declaraba el parámetro y FastAPI lo descartaba en silencio. Regla:
   **si un filtro manda un query param, el endpoint DEBE declararlo y aplicarlo** (`AND col=%s`).
   Al agregar un filtro, revisar los DOS endpoints (agrupado `/barras/elementos` y plano `/barras`).
3. **`readonly` rompía el filtro.** Se había puesto `readonly` como defensa anti-Chrome, pero un
   `<input readonly>` NO dispara `oninput` → el filtro no se aplicaba. **Nunca usar readonly** en
   estos campos (ya no hace falta: la clave se resolvió por la causa 1).

**Anatomía del patrón (clon del buscador de obra `bmProyectoSearchInput`, que es el de referencia):**
- HTML: `<input type="text" id="<prefijo>Xxx" list="<prefijo>XxxDatalist" name="..." autocomplete="off"
  autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-form-type="other"
  oninput/onchange/onblur="onXxxInput()">` + `<datalist id="<prefijo>XxxDatalist">`. **Sin readonly.**
  Id único con prefijo de tab (ver sección anterior).
- JS: una fn `_fill<Xxx>Datalist(lista)` que puebla el `<datalist>` (escapando `"`), y un handler
  `onXxxInput()` con **debounce corto (~200ms)** que dispara la búsqueda. Los 3 eventos
  (input/change/blur) apuntan al MISMO handler idempotente.
- **Dos variantes:** (a) *texto libre* (eje) → lo escrito ES el valor del filtro, se lee
  `getElementById('eje').value` directo, sin nada que resolver. (b) *resuelve a id* (obra) →
  `<select>` oculto + fn que resuelve texto→id (exacto → prefijo único → fallback). Elegir la
  variante según si el valor final es el texto o un id.

**COMPONENTES REUTILIZABLES (usar estos; NO reescribir el patrón cada vez):**

- **`shared/buscador_obra.js` → `BuscadorObra`** — buscador de OBRA (input + `<datalist>` +
  `<select>` oculto que guarda el id). Resuelve texto→id (exacto → prefijo único → fallback),
  idempotente. **Es EL componente para el filtro/selector de obra; lo usan el Bar Manager Y el
  creador v2** (misma UX, un solo código). API:
  `BuscadorObra.crear({ inputId, datalistId, selectId, onElegir(idProyecto) })` →
  `{ setProyectos([{id,nombre}]), getId(), limpiar(), resolver() }`. El HTML necesita el trío
  `<input list=X>` + `<datalist id=X>` + `<select id=Y style="display:none">`. Cada vez que se
  necesite un filtro de este tipo (elegir una obra existente), REUTILIZAR este componente.

- **`shared/combobox.js` → `Combobox`** — buscador de texto genérico con lista propia de `<div>`
  (sin `<datalist>`). Filtra por "contiene", `onSelect` entrega el item completo, soporta
  `textoLibre:true` (crear valores nuevos, ej. ciclo/eje del creador), teclado, pie "N de M".
  API: `Combobox.crear(input, {items, onSelect, onInput, getLabel, getSub, textoLibre, placeholder})`.
  Úsalo para campos donde se pueda ESCRIBIR un valor nuevo (ciclo, eje, marca en el creador).

- El Bar Manager sigue usando `<datalist>` nativo para eje/ciclo/etc. (funciona, no se toca).
  Regla: para OBRA → `BuscadorObra`; para campos de texto libre nuevos → `Combobox`.

**Referencia:** commits `a8c6307` (fix backend eje + password fuera del DOM), `5599114` (eje Bar
Manager como input buscable), + mejoras del combobox (pie "N de M", panel más alto) en el creador.

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

> **⚠ DEUDA / UPGRADE FUTURO — ampliación de parámetros de barra (transversal).**
> El modelo actual de parámetros (9 dims + 4 ángulos + radio) es FIJO y probablemente se
> quedará corto. A futuro habrá que **ampliar los parámetros** de una barra (más slots, o
> tipos de parámetro nuevos: pesos, recubrimientos, tipos de acero, ganchos, etc.). Esto es
> **TRANSVERSAL** y toca varios sistemas a la vez, hay que considerarlo al construir features
> nuevas para no cablear el número/tipo de parámetros en cada lugar:
> - **Editores** (diseñador de figuras 2D/3D, `disenador.js`/`disenador3d.js`): las etiquetas
>   letra/ángulo/radio que definen los parámetros de una figura.
> - **Catálogo Armacero** (§4A): `parciales`/`angulos`/`radio` de cada figura → debería poder
>   crecer sin migración destructiva.
> - **Bar Manager / edición de barras**: columnas `dim_a..i`/`ang1..4`/`radio` en la tabla
>   `barras` y en el form de edición (hoy hard-coded a 9+4+1).
> - **Cubicación manual** (§4.7), **exportaciones/matrices**, **PDF/pedidos**, **validación**
>   (`validar_geometria`, `largo_desde_lados` en catalogo.py).
> **Dirección recomendada al implementar:** modelar los parámetros como una lista
> extensible/JSONB (no columnas fijas) o un catálogo de "tipos de parámetro", para que agregar
> uno nuevo sea dato/config y no un cambio de esquema + toque en N archivos. NO abordar hasta
> que haya un requerimiento concreto; solo tenerlo presente para no cablear más el 9+4+1.

**Edición segura (reglas de diseño):**
- **Bloqueo:** botón candado 🔒 en Bar Manager, con warning al activar el modo edición.
  Por defecto solo lectura; se abre a propósito. Solo UI (no persiste). Al cerrar el candado,
  si hay cambios sin guardar → pregunta "¿Guardar cambios?". Celdas editadas se resaltan.
- **Permisos (actualizado 2026-07-24):** editar barras = **miembro del área 'cubicaciones'**
  (`area_usuarios.rol_area='miembro'`, `areas.slug='cubicaciones'`) O admin/admin_calidad.
  NO depende de la obra (cualquier obra). Ni USC, jefe_servicio, cubicador-global, cliente,
  externo. Función backend `_puede_editar_barras` (separada de `_puede_editar_proyecto`, que
  controla editar proyectos/autorizar usuarios). Antes exigía estar en `proyecto_usuarios` de
  la obra → causaba 403 en cada guardado a cubicadores no asignados.
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

### 4.7 "Agregar Cubicación" — Ingreso manual de barras (DISEÑO CERRADO 2026-07-28)

> Tab **"Agregar Cubicación"** (entre Bar Manager y Pedidos). Título de sección: **"Formulario
> de Cubicación"**. Panel de **alta** de barras (no consulta). Programa detallado en
> `docs/programa_agregar_cubicacion.md`. Reemplaza al viejo `programa_panel_creacion_barras.md`.
> Incluye 3 REDISEÑOS de fondo (no fixes). Producción activa → todo aditivo, nunca borrar data.

**Vocabulario:**
- **Lote** (`lote_id`): tanda de barras ingresadas juntas manualmente (gemelo del `import_id` del
  CSV; procedencia/provenance). Estado del lote: `borrador` → `terminada` (bloqueo). Nombre UI a
  decidir (Planilla/Ingreso/Tanda/Carga).
- **`origen`** ∈ `csv`|`manual`|`pedido`: canal de datos de la barra.

**REDISEÑO A — Canales de datos independientes (invariante):** cada canal solo tiene autoridad
sobre SUS barras. La importación CSV opera solo sobre `origen='csv'` (sus DELETE de reemplazo
llevan `AND origen='csv'`, centralizado en una guardia). Barras `manual`/`pedido` sobreviven
SIEMPRE a cualquier reimport. El preview de reimport AVISA "N barras manuales/pedido se
conservarán". (Antes: el DELETE por `(eje,piso,ciclo)`/`plano_code` en importer.py NO miraba
origen → las manuales se borraban. Era brecha real.)

**REDISEÑO B — Estado del sector constructivo como entidad (`sector_estado`):** el dirty-flag
verde/rojo hoy es un hack por fechas (`MAX(fecha_carga) > MAX(export_log.fecha)`) y tiene una
BRECHA: `editar_barra` no toca `fecha_carga` → editar una barra NO marca el sector como
modificado (sigue verde = mentira). Rediseño: tabla `sector_estado(id_proyecto, sector, piso,
ciclo, estado, ...)` con estados explícitos `pendiente`/`exportado`/`modificado`, actualizada por
EVENTOS (crear/editar/eliminar barra, reimport con cambios, exportar). Aditivo y en paralelo: el
mecanismo viejo se mantiene hasta verificar el nuevo; los lectores (`export-history`,
`exportacion.js`, `obras.js`) migran a leer `sector_estado`. `version_mod`/`version_exp` son
columnas MUERTAS (nadie las lee) — se dejan quietas, no forman parte del diseño.

**REDISEÑO C — Lote (`lote_id`):** tabla `lotes` + columna `lote_id` en `barras` (aditiva, NULL
para CSV). Trazabilidad de la tanda; no afecta la agrupación constructiva.

**MODELO DE INGRESO — "GRUPOS por elemento + estampado en pisos" (rediseño 2026-07-28, tras
smoke test; reemplaza la grilla plana inicial que no reflejaba cómo cubica el usuario).** El
cubicador NO piensa en barras sueltas; piensa por ELEMENTO constructivo y el PISO es el eje de
replicación masiva (una losa tipo se repite en 15 pisos = 15 items idénticos salvo el piso).
- **Contexto GLOBAL (arriba, común a todos los grupos):** Obra · Ciclo · Sector (elemento
  constructivo: ELEV/LCIELO/VCIELO/FUND, selector FIJO — es enum validado, NO texto libre). Ej.
  "ELEV · C1". Cambiar de ciclo/sector = nueva tanda de trabajo.
- **GRUPOS de barras (unidad de cubicación):** cada grupo define **Eje** + **Nombre de plano**
  (texto libre, de dónde sacó las barras — POR grupo/elemento) + **selector de PISOS** (P3,P4,P5…)
  + sus **barras**. Se pueden tener varios grupos abiertos (distintos ejes del mismo ciclo/sector).
- **Estampado en pisos (la eficiencia):** el grupo se define UNA vez y se aplica a los pisos
  elegidos → al guardar genera **1 item por (barra × piso)**. `cant` es POR PISO (cant=4 en 5
  pisos = 4 barras en cada uno). Herramientas: duplicar grupo, pegar desde Excel (barras), copiar
  barra-abajo.
- **Barras de un grupo (grilla):** Marca (desplegable con texto dinámico de las marcas existentes)
  · Figura (del catálogo → pide solo las dims que usa + **render en vivo** ajustado a las medidas)
  · φ (lista fija 8,10,12,16,18,22,25,28,32,36) · dims · Cant · Mult (doble/triple malla).
- **PROD (cod_proyecto):** NO se pide en el editor. Se deriva del DIÁMETRO en el backend con el
  mapa `_DIAM_COD_MAP` (importer.py) reutilizado en `lotes.py`. Va a la BD y a la exportación.
- **Eje:** texto libre autopoblado (`/filters`), NO bloquear, **advertencia suave** por similitud
  (normalizado solo para comparar; guardar tal cual). Merge posterior = fase aparte.
- **`largo_total` y peso AUTOMÁTICOS** (suma de dims de la figura; radio no suma; peso × factor
  obra). Hook `_largo_desde_figura` para barras redondas futuras.
- **Vista:** las barras creadas se agrupan por ELEMENTO real (piso+sector+eje), como el Bar
  Manager, con rollups Σcant/Σlargo/Σkg por grupo.

**Backend creación:** rehabilitar `POST /barras/crear` como parte del modelo de canales. Barra:
`origen='manual'`, `import_id=NULL`, `lote_id=<lote>`, `fecha_carga=now`, `editado_por=user`,
peso = `_calcular_peso` × cant × **factor_obra**. `id_unico` = patrón de lámina + **letra prefijo**
(marca "creado en plataforma"; no colisiona con CSV). Alta masiva transaccional. Permisos:
cualquier cubicador en cualquier proyecto (revisar set después). Valida en backend; nunca crea
`origen != 'manual'`.

**Bar Manager (integración):** badge + filtro de barras `manual`. Edición de barras `terminada`
SOLO desde Bar Manager (formulario = alta masiva; Bar Manager = corrección puntual; mismo motor,
permiso por estado). **Procedencia SE PRESERVA** al editar (conserva `origen`/`lote_id`, suma
`editado_por/fecha`). Editar marca el sector `modificado`. En "Agregar Cubicación" NUNCA se editan
barras de otro canal.

**Config de peso por obra:** factor global (default **0%**, no altera nada hoy) sobre el peso
teórico. Persistir por proyecto.

**Sufijo de tipología (`suf_tipo`, 5N.42):** campo de texto libre por barra, a la derecha de la
Tipología en la grilla. Se **CONCATENA a la columna MARCA solo al exportar a aSa Studio** (marca +
suf_tipo, en `export.py`); la tipología interna (`marca`) NO se modifica, para que los dashboards y
agrupaciones no se rompan por inconsistencias. Columna `barras.suf_tipo` (migración 093), nullable.
Viaja en el payload de `agregar_barras`, se restaura al retomar el lote.

**Multiplicador en la grilla (5N.42):** columnas **Mult** (editable, ocultable con un checkbox) y
**Cant.T** (=cant×mult, solo lectura, informativa) entre Cant y Largo. Coherente con el importador
(CANT del CSV = total, cant_total = cant×mult, peso sobre cant_total). El peso YA incluye ×mult →
Cant.T es solo display (no re-multiplicar el peso, sería cant×mult²). `mult` nunca queda vacío.

**Nomenclatura "Items" vs "Barras" (5N.49):** en TODA la plataforma, **items** = nº de entradas/filas
(`COUNT`); **barras** = barras físicas (`Σ cant_total` = cant×mult). Una fila con cant=20/mult=2 es
**1 item** y **40 barras**. Aplicado en Bar Manager, creador, histórico, /stats, constructoras,
calculistas, obras, clientes.

**"Despiece" = nombre visible del "lote" (5N.51):** en la UI se llama **Despiece** (tab "Agregar
Despiece", "Despiece de Cubicación", "Despiece #N"). Internamente sigue siendo `lote` (tabla `lotes`,
endpoints `/lotes`, `loteId`): la capa de datos NO cambia por una etiqueta de UI. El despiece es el
átomo de carga manual (gemelo del import CSV).

**Despiece — reglas cerradas (5N.38, 5N.47b, 5N.48):**
- **Crear** es explícito y previo: exige Obra + Ciclo + Eje (obligatorios). Sin despiece creado,
  Sector/Estructura/+barra bloqueados.
- **num_obra** (correlativo por obra, "#N") es FIJO: se asigna una vez al crear (`MAX+1`) y no se
  reusa ni recalcula. Un despiece **vacío** (nunca guardado, 0 barras) se descarta físicamente al
  abandonarlo y libera su número.
- **Eliminar** deja LÁPIDA (estado `eliminado` + snapshot del resumen y del detalle de barras en
  `snap_barras` JSONB); las barras se borran de la tabla. La lápida es visible en el histórico (gris)
  y clickeable para VER su contenido en solo-lectura. Pide escribir ELIMINAR; aplica incluso a
  terminados. Es la ÚNICA forma de borrar un despiece.
- **Duplicar** (botón en el histórico): crea un despiece nuevo con toda la data del origen; el usuario
  elige Ciclo y Eje; el resto (piso/sector/tipología/figura/dims/cant/mult/sufijo) se copia. Funciona
  también desde una lápida.
- **Disquete** guarda avance y NO limpia; **la X** limpia el formulario y vuelve a crear despiece.
- **Sector↔Estructura**: combinaciones válidas ELEV→MURO/COLUMNA/GEN, LCIELO→LOSA/GEN, VCIELO→VIGA/GEN,
  FUND→FUNDACION/GEN (GEN sirve para todos). Las no válidas se deshabilitan en la UI.

**Limpieza:** borrar la tercera matriz MUERTA (`dashboards.js` + `tabs/dashboards.html` + 3
no-ops en `filtros.js:200-202`; confirmado sin uso, no enlazada). Endpoints `/dashboard/sectores`
y `/sectores-nav` SE CONSERVAN (los usan las 2 matrices vivas).

**Pedidos de cliente:** el motor se RECICLA para `origen='pedido'` (portal externo separado,
misma API, bandeja → USC valida/forward → cubicador → aSa Studio). SOLO PLANIFICADO — ver
`docs/programa_pedidos_cliente.md`. Condiciona hoy solo: `origen`/`estado`/`lote` parametrizables.

**VALORES POR DEFECTO al crear barra (creador v2, 2026-07-30):** rellenan solo celdas vacías.
Al elegir FIGURA: ángulos = los del catálogo (`f.angulos`), lados INTERMEDIOS = 100 cm. Al elegir
DIÁMETRO: lados EXTREMOS (1º y último parcial) = `AC2_FACTOR_EXTREMO`(**10**) × diámetro (confirmado
por el usuario). RADIO no se rellena.

**RENDER paramétrico — límite y DEUDA:** el dibujo se re-escala con las medidas ingresadas SOLO
donde cada letra está bien asociada a un lado recto. En figuras con RADIO, la "R" es hoy solo una
letra con un valor (no un radio geométrico con propiedades), y en figuras etiquetadas a MANO el
motor no re-escala. **DEUDA:** dar a los radios propiedades geométricas reales (radio/cuerda/
desarrollo) para render exacto y evitar el etiquetado a mano. Ambicioso — futuro. Mientras: el
render vale como referencia de forma; largo/peso SÍ son paramétricos (se calculan con las medidas).

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
  (lista, ej. 45,135 — **convención CERRADA 18-ago: es el ÁNGULO DEL VÉRTICE**, el que queda entre los
  dos tramos de fierro; ver 4A.4), `radio` (bool),
  descripción. Mapea directo a los slots de la barra (A→dim_a...). Fuente: `FIGURE_CATALOG`.
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

**Tab de templates del Catálogo — rediseño DEFINIDO 18-ago** (detalle en
`docs/programa_modelador_3d.md` §DEF-18ago puntos 1 y 6):
- La tarjeta **"Nuevo template"** pasa a ser **"Configuración"** — se van los botones de tipo de
  elemento y quedan **4 botones que abren modales**: *Figuras por tipología* · *Reglas de largos* ·
  *Recubrimientos* · *Por figura*. Esa configuración **aplica al Template Editor**; la configuración
  por obra (Enfierrador) queda **en standby**.
- Debajo, el **Gestor de templates**: nombre + **Crear template**, **buscador**, y **lista clickeable**
  ordenable **por tipo de elemento** con **toggle a fecha**, con **KPIs referenciales** (peso estimado,
  diámetro promedio y los típicos).
- **Reparto de roles (cerrado):** el **Template Editor** (aquí, en Catálogo) **solo crea templates** —
  nada de lo que hace queda almacenado como barra. El **Enfierrador 3D** (desde el Fabricator) llama un
  template, **crea las barras reales** del despiece (las que ve el Bar Manager) y guarda la instancia
  del elemento como algo **único de esa obra**. Los pesos que muestran ambas herramientas son
  **aproximados**; el peso definitivo lo asigna el backend al crear la barra en el despiece.

### 4A.4 Diseñador de figuras (IMPLEMENTADO — `disenador.js`)

Sub-tab "🎨 Diseñador". El usuario **dibuja la figura por clicks** en un lienzo con grilla;
snap a ángulos limpios (45/90/135°). Cada segmento = un lado (A,B,C… reasignables). **El
nombre lo pone el usuario** (no autogenera). Guardar → `POST /figuras-catalogo` (UPSERT por
código): crea figura nueva O **puebla la geometría de una existente** (esto ES la homologación
por nombre — dibujar con el nombre del catálogo pega la geometría a esa figura). Galería de
figuras dibujadas (editar/borrar). Etiquetas α1/α2… en los vértices (convención aSa: 90° no
cuenta como α, solo los especiales van a `angulos`).

**Convención del campo `angulos` — CERRADA POR EL USUARIO EL 18-ago: es el ÁNGULO DEL VÉRTICE.** El
número que se guarda en `angulos` y que se **exporta a aSa** (`ang1..4` → `"<135"`, sin convertir:
`export.py`) es el ángulo que queda **entre los dos tramos de fierro** que concurren en el doblez: en
la **102B es 135**. El **"recorrido del doblado"** (cuánto se desvía el tramo respecto de seguir recto)
es **180 − ese número** = 45 en la 102B, y **no se guarda**. **Los valores del catálogo están BIEN:** no
hay migración de datos ni conversión que agregar al export.
- **Lo que está MAL ROTULADO es el Diseñador de figuras:** muestra "Ángulo prev. 45°" y "α1=45" para la
  102B cuando debería mostrar **135** (la tabla del catálogo sí muestra 135). Es la ETIQUETA, no el
  dato. **Se arregla más adelante** — pendiente anotado, no en la iteración actual.
- *Redacción anterior (17-ago), corregida por lo de arriba:* se describía la columna como "el GIRO del
  doblez" y la convención como pendiente ("¿aSa espera 135 o 45?"). El número almacenado no cambia;
  cambiaba el nombre. La duda queda **cerrada: 135, el ángulo del vértice**.
- **Detalle histórico que sigue en pie:** las figuras dibujadas en el Diseñador **antes del 14-ago**
  quedaron con el complemento por la migración 085 (guardaba 180−giro) y nadie las reconcilió; se
  detectan porque `angulos[k] + giro_k = 180`. El SVG del catálogo no las delata (dibuja desde
  `geometria.puntos`), pero el trazador del modelador sí lee `angulos` (`figura_puntos.js:1208-1210`) y
  el export manda ese número a aSa. Revisarlas queda **pendiente sin urgencia**.
Detalle en `docs/programa_modelador_3d.md` §DEF-18ago punto 5.

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

### 4A.4.1 Curvas 2D + etiquetas + drag de nodos (HECHO)

- **Curvas 2D:** tramo `tipo:"arco"` (radio + sweep) → `<path>` SVG comando `A` (nativo).
  Control del radio = **slider**; botón **"Invertir lado"** (sweep 0↔1). Los vértices junto a
  un arco NO generan ángulo α (la curva ES el doblez). Guardado: `tipos_seg`/`radios_seg`/
  `sweeps_seg`. Params radio/cuerda/desarrollo NO van en el diseñador (la figura es solo FORMA;
  las medidas mm las aporta la barra concreta en Bar Manager).
- **Etiquetas manuales:** botón "Etiquetas" → abre un **canvas GRANDE** (reemplaza el área de
  dibujo) con la figura de fondo; se colocan/arrastran etiquetas de **medida (cota libre),
  letra (A-I de la data), ángulo (α1-α4)**. Halo blanco sutil. `disenador_preview_etiq.js`.
  Guardado: `geometria.etiquetas_preview`. Preview chico = solo ver.
- **Drag de nodos:** 2D (SVG) y 3D (raycast a esferas) — arrastrar vértices para modificar.

### 4A.4.2 Editor 3D (toggle 2D/3D) (HECHO — falta arcos 3D)

- **Activación:** botones **2D / 3D**. Three.js ON-DEMAND (solo al activar 3D).
- **Espacio 3D:** grilla + ejes XYZ rotulados (sprites), rotable con el mouse.
- **Dibujo por CLICKS** sobre un **plano de trabajo** (Piso XZ / Frontal XY / Lateral YZ;
  raycasting al plano; badge del plano activo). Se decidió clicks (no parámetros — más
  intuitivo). **ORTO:** snap a múltiplos de 45° dentro del plano (igual que 2D). **Drag de
  nodos** (raycast a esferas). **Snapshot FIJABLE** ("📸 Fijar vista": congela el ángulo que
  se verá/guardará). Panel de parámetros 3D (lado/largo/dirección).
- **Guardado:** `dim:"3D"` con nodos + tramos (lado/largo/dir) + puntos iso 2D + snapshot.
  Galería: badge "3D" + imagen del snapshot. Backend sin cambios (geometría es JSONB).
- **PENDIENTE: arcos/curvas 3D** (la "patita" final). Modelo ya contempla `tipo:"arco"`.

### 4A.4.3 Render 3D vectorial + mejoras de UX del editor (PLANIFICADO 2026-07-27)

**A) Migrar el preview/render 3D de FOTO (snapshot PNG) → SVG isométrico paramétrico.**
Hoy la miniatura de una figura 3D es una foto del canvas Three.js. Problemas: (1) no es
paramétrico — no puede escalar proporcional a las dimensiones reales (A=115) ni mostrar la
figura al tamaño que se fabricará; (2) deformación diagonal (antialiasing del PNG WebGL);
(3) el badge "3D" y las cotas quedan pegados sobre una foto, no integrados; (4) la cota de
arco 3D no funciona (no hay curva real que seguir, solo una foto).
**Solución (sin reinventar):** el modelo 3D YA guarda `nodos` (coords 3D) + `puntos` (proyección
isométrica 2D). Alimentar el **motor SVG del 2D** (`dibujarFigura`) con los puntos isométricos
→ dibujo vectorial de la figura 3D, igual criterio que el 2D. El **etiquetado ya es SVG** (letras/
ángulos/cotas/radios se dibujan sobre el lienzo con el registro; solo el FONDO es foto hoy) →
al cambiar el fondo de foto a SVG iso, el etiquetado se hereda tal cual Y la **cota de arco 3D
pasa a funcionar** (hay curva vectorial real). El editor 3D interactivo SIGUE con Three.js
(ahí se quiere rotación/perspectiva); solo el preview/catálogo pasa a SVG. Matiz aceptado: las
cotas acotan la VISTA isométrica (ángulo fijo estándar de dibujo técnico), no el 3D real — es
lo correcto para un catálogo/plano de fierro. **NO** buscar otra librería 3D (Babylon, etc.):
no aporta, ya tenemos los datos; el problema es solo usarlos. Descartar `SVGRenderer` de Three.js
(más pesado que la proyección iso que ya calculamos).

**B) Flujo de editor real (2D y 3D):** botón **"Nueva figura / Limpiar"** siempre visible +
banda/indicador **"✏️ Editando 305A"** al cargar una figura (hoy al cargar una 3D no hay forma
de vaciar ni señal de que se está editando algo cargado).

**C) Barra de etiquetado con botones (no desplegables):** un **botón por tipo** (6: cota, arco,
radio, diámetro, letra, ángulo) en vez del `<select>` de tipo. Para **letra/ángulo: avance
automático** (colocas → siguiente letra/ángulo libre; corregible). Más fluido que elegir en
dropdown cada vez. (Campo de texto libre descartado de primera: propenso a error; el avance
automático da el 90% del beneficio.)

**D) Salir del etiquetado en 3D:** hoy NO hay forma de salir del modo etiquetado en 3D (bug).
El botón "Etiquetar barra" debe alternar entrar/salir (o botón "Terminar etiquetado").

**E) Cota de arco 3D:** queda resuelta por (A) — con SVG iso hay curva real → la cota de arco
con offset funciona como en 2D. Sin (A), en 3D sería manual (2 clicks sobre la foto).

### 4A.4.4 Especificación TÉCNICA de A (render 3D vectorial) — para implementar sin iterar

> Estado: B/C/D aprobados y en curso. **A aprobado en concepto; esta spec detalla el CÓMO.**
> Objetivo: que quede a la primera. Implementar A de forma AISLADA (rama/commit propio).

**A.1 — Qué es la vista y cómo se genera.**
- El editor 3D interactivo (dibujar/rotar/clickear nodos) **SIGUE con Three.js, sin cambios**.
- El **preview + render de catálogo/galería/Bar Manager + (futuro) formulario de cubicación**
  pasa a ser un **SVG generado por proyección isométrica** de los nodos 3D. NO es foto.
- Función base ya existe: `_iso(p)` en disenador3d.js = proyección iso a 30°: `x=(px−pz)·cos(a)`,
  `y=py−(px+pz)·sin(a)`. El modelo ya guarda `geometria.puntos` = nodos proyectados con `_iso`.
- El motor SVG del 2D (`svgDesdePuntos`/`dibujarFigura`) debe aceptar esos puntos iso y dibujar
  la polilínea + arcos + nodos IGUAL que una figura 2D. Es el mismo motor; solo cambia el origen
  de los puntos (proyección de 3D vs figura plana).

**A.2 — Ángulo isométrico configurable por figura (DECIDIDO: selector 30/35/40 con preview).**
- Guardar en `geometria.iso_angulo` (grados; default 30). **Selector simple 30°/35°/40°** al
  crear/guardar la figura 3D. **Al presionar una opción, el PREVIEW se actualiza en vivo** para
  que el usuario vea cómo queda el render con ese ángulo antes de fijarlo. Ese ángulo queda
  guardado para TODAS las visualizaciones de esa figura en toda la plataforma (preview, catálogo,
  cubicación). Futuro (si las funciones de edición operan bien): permitir re-editar el ángulo;
  por ahora se fija al crear.
- `_iso` toma el ángulo de la figura en vez de la constante 30. Costo: nulo (un parámetro).

**A.3 — Paramétrico (lo que vale ORO para cubicación).**
- El SVG iso se dibuja desde los `nodos` (coords 3D). Si se pasan DIMENSIONES reales (A=115,
  B=80…), los nodos se ESCALAN proporcional a esas medidas antes de proyectar → la figura se ve
  al tamaño/proporción que se fabricará. Esto es lo que el formulario de cubicación (§4.7) usará:
  el cubicador ingresa medidas y ve la figura real. Con foto era imposible.
- La figura del catálogo es la PLANTILLA (forma); las medidas mm las aporta la barra concreta
  (misma lógica que el 2D — decisión ya tomada en 5M.8.7 A4).

**A.4 — Etiquetado: modelo AUTOMÁTICO (redefinido con Eugenio 2026-07-27, aplica 2D Y 3D).**
El motor SVG es compartido → esto se implementa una vez y sirve a ambos. Reglas:
- **Letras de lado: AUTOMÁTICAS siempre** (A, B, C…), con ajuste manual opcional (reordenar/
  renombrar, útil en curvas). La LETRA representa la cota del lado recto → **los lados rectos NO
  llevan cota de medida** (redundante). Ya existe en 2D (`svgDesdePuntos` dibuja las letras).
- **Ángulos:** sin cambios — convención aSa (solo especiales ≠90 en la bisectriz del vértice).
- **ARCO → 4 COTAS AUTOMÁTICAS** (un arco es 1 segmento pero requiere 4 dimensiones para quedar
  definido): (1) **proyección horizontal** = recta entre los dos nodos extremos, (2) **proyección
  vertical** = sagita del arco (medio cuerda→guata) dibujada AL COSTADO, (3) **desarrollo** = curva
  paralela al arco con offset, (4) **radio** = medio cuerda→arco inclinado 45°. Se generan solas
  cuando hay un segmento curvo, derivando de la geometría del arco (NO se dibujan a mano). El
  "problema de la elipse" NO existe: la cota del arco COPIA la línea del arco YA proyectado (con
  offset), sea círculo o elipse en la proyección — sigue lo que está dibujado.
- **Modo etiquetado MANUAL:** queda solo para casos que lo necesitan (reordenar parámetros en
  curvas, ajustar posición de una letra). No es el flujo principal — la mayoría queda automático.
- Coords: las etiquetas manuales se colocan sobre el SVG iso (no sobre foto), coords relativas a
  ese espacio (como el 2D relativo a p0). El registro de etiquetas no cambia.

**A.4.1 — Ganancia:** esto SIMPLIFICA la creación de barras. Con figuras 3D sin arco (las más),
el usuario dibuja y ya tiene letras + geometría sin etiquetar nada. Con arco, las 4 cotas salen
solas. El etiquetado manual pasa de "obligatorio" a "excepcional".

**A.4.2 — Las cotas del arco SIEMPRE se dibujan (aclarado Eugenio 2026-07-27).**
Las 4 cotas del arco se DERIVAN de la geometría del segmento curvo → se dibujan SIEMPRE, en
cualquier modo (normal o etiquetado manual). No viven en `_etiquetas`, se recalculan del dato del
arco. Por eso NUNCA se pierden y el usuario NO tiene que volver a dibujarlas — que era la
preocupación. Lo ÚNICO que el modo etiqueta-manda oculta/gestiona son las LETRAS (para que el
usuario ponga las suyas). NO se reordenan letras, NO se "materializa" nada — era una confusión
mía. Regla simple: cotas de arco = siempre automáticas y persistentes; letras = automáticas con
override manual; el arco dibujado (con sus cotas) es intocable por el etiquetado.

**A.5 — Data 3D existente: DESCARTADA (decisión Eugenio).** Solo hay 1 barra 3D de prueba; el
usuario la elimina. Empezamos limpio con SVG iso — sin migración ni fallback de snapshot para
data vieja. (El `snapshot` puede conservarse en el modelo por si se quiere una foto de respaldo,
pero el render pasa a ser SVG iso para todas.)

**A.6 — Qué se conserva y qué se elimina.**
- CONSERVAR `snapshot` en el modelo (fallback + no romper data vieja). No es obligatorio generarlo
  para figuras nuevas si el SVG iso lo reemplaza, pero mantenerlo no cuesta.
- El editor 3D Three.js, el fijado de vista, el encuadre: se mantienen (para dibujar).
- Se elimina la DEPENDENCIA del preview/catálogo respecto a la foto (pasa a SVG).

**A.7 — Alcance del cambio (archivos).**
- `disenador3d.js`: exponer `nodos`/`puntos` iso + el `iso_angulo`; punto de entrada al etiquetado
  sobre SVG iso en vez de sobre foto.
- `disenador.js`: `svgDesdePuntos`/`dibujarFigura` — asegurar que dibujan bien los puntos iso
  (arcos incluidos); el modo etiquetado usa SVG iso de fondo (no `_fondoImagen` foto).
- `index.js` (catálogo) + galería + Bar Manager mini: usar `dibujarFigura(puntos_iso)` para las 3D
  en vez de la `<img>` del snapshot.
- Registro etiquetas: sin cambios (ya es agnóstico al fondo).

**A.8 — Riesgos / casos borde.**
- **Arco proyectado (RESUELTO, no era problema):** el arco de la barra se dibuja en el SVG iso con
  la forma que tenga (círculo o elipse según la proyección). Las cotas del arco (cuerda/vert/horiz/
  radio) se derivan de la geometría y se dibujan sobre esa curva ya proyectada. No hay que "resolver
  la elipse" — se copia lo dibujado. Descartada la preocupación inicial.
- **Las 4 cotas del arco (definición final, Eugenio 2026-07-27):**
  (1) **proyección horizontal** = recta que conecta los DOS NODOS extremos del arco (la cuerda
  directa entre extremos, NO bounding box);
  (2) **proyección vertical** = la sagita/flecha del arco (del medio de la cuerda a la guata,
  perpendicular a la cuerda), pero DIBUJADA AL COSTADO del arco (desplazada lateralmente), no al
  centro;
  (3) **desarrollo** = curva paralela al arco con offset (copia el arco ya proyectado);
  (4) **radio** = del medio de la cuerda al arco, inclinado ~45° (para no confundirse con la vertical).
  Todas se calculan en 3D y se proyectan con `_iso` (nunca se reconstruyen con SVG 'A' en 2D, que
  se descalibra). Probar que se posicionan legibles — el ángulo iso configurable (A.2) ayuda.
- Figuras muy "planas" o con nodos superpuestos en la proyección: no es error, solo visual; el
  ángulo configurable mitiga.
- **Orden de implementación sugerido:** (1) render SVG iso de figuras RECTAS + letras automáticas
  (el 90% de casos, prueba el núcleo); (2) selector de ángulo iso con preview en vivo; (3) las 4
  cotas automáticas del arco; (4) etiquetado manual sobre SVG iso; (5) enganchar catálogo/galería/
  Bar Manager a `dibujarFigura(iso)`. Cada paso verificable.

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

## Programa Maestro 2026-H2

El orden de ejecución vigente (saneamiento + expansión) está en **`docs/programa_maestro.md`**:
fases M0-M7 (M0 seguridad, M1 higiene, M2 autorización multi-obra, M3 deuda selectiva, M4 pre-armado,
M5 epic app clientes, M6 CRM, M7 templates 3D) + transversales C (Ley 21.719) e I (infraestructura).
Ordena — no reemplaza — el roadmap de features de `programa-versiones/programa_v1.00.md`.

El **Modelador 3D de elementos** (expande M7) tiene su diseño en **`docs/programa_modelador_3d.md`**:
generador paramétrico (templates viga/muro/columna) que crea barras y las carga al despiece; guarda
la RECETA (parámetros), no el resultado (barras derivadas); reusa el render de la maqueta M7.0.
**MVP F0+F1 IMPLEMENTADO** (guion en `docs/programa_modelador_3d_TAREAS.md`): motor genérico
client-side (`static/js/features/modelador/`: motor_geom/figura_puntos/reglas/generar/semilla_viga) +
3D Template modo AJUSTAR (`panel_3d.js` + modal `tabs/modelador3d_modal.html`, botón "🧱 3D Template" en
el Fabricator). Backend: router `modelador.py` (templates + elementos_template) + `lotes.py::agregar_barras`
acepta `origen='template'`/`template_instancia_id` (migración 104). Las barras se insertan por el endpoint
EXISTENTE `POST /lotes/{id}/barras`. FUNCIONAL: viga-semilla (cabezales 103A/103B, estribo 104D por zonas,
traba 101A) → ajustar → cargar al despiece. STUB (2ª entrega): grid/perimeter/points (muro/columna),
Colocador. PENDIENTE de confirmar con el usuario: redondeo exacto de ADetailer (hoy `round(L/@)`,
centralizado en `reglas.js::redondeoCantidadZona`).

---

## 11. MODELADOR 3D — REGLAS DEL MOTOR QUE NO SE PUEDEN PERDER

Esta sección existe porque son reglas que **una figura nueva tiene que heredar sola**. Si alguien
pregunta en el futuro «¿por qué esta figura se comporta así?» o «¿puedo cambiar X?», la respuesta
y las opciones están acá.

### 11.1 La tipología NO decide nada del motor

La lógica de inserción y de colocación es **una sola para todas las barras**. La tipología aporta
únicamente la **pose de partida** (la dirección en que corre la barra: es lo único que distingue MH
de MV). No aporta posición, no aporta descuentos, no aporta excepciones.

**No puede haber ramas por tipología ni por rol.** `rolDeComponente` / `_rolDe` parecen
discriminantes legítimos —se derivan, no dicen «tipología» por ninguna parte— pero **llevan la
tipología adentro**: ramificar por rol es ramificar por tipología con otro nombre.

Criterio para saber si una condición es legítima: **¿la condición es un HECHO o una ETIQUETA?**
`¿la cadena cierra sobre sí misma?` es un hecho que la figura contesta sola → vale.
`¿es un estribo?` es una etiqueta → no vale.

Discriminantes topológicos disponibles: `familiaDeDibujo(fig, null)`, `esCadenaDeSeccion(fig)`,
`paresEspejoFigura(fig)`, `figuraCerrada(fig)`, `extremosQueCierran(fig, dims)`.

### 11.2 Autoajuste de capas anidadas (check «Ajustar capas anidadas»)

**La regla (decidida con el usuario, 25-ago-2026):**

> Un extremo del cuerpo **CIERRA** cuando de él sale un lado **PERPENDICULAR** que va hacia el
> núcleo. El descuento de la capa *k* es `(k − 1) × diámetro × (nº de extremos que cierran)`, y el
> **retiro sale por la punta que cierra** — el extremo libre no se mueve.

Vive en `figura_puntos.extremosQueCierran` (el predicado) y `figura_puntos.anidarFigura` (lo
aplica). Lo consumen `reglas.distribuidorLayered` y `reglas.distribuidorArreglo`.

Consecuencias que hay que respetar:

- **No hay tabla por figura.** Todo sale de `tramosDeFigura` leído en el marco del trazador. Una
  figura nueva trae su respuesta en su propia geometría el día que se dibuja o se siembra.
- **El redondeo va DESPUÉS del descuento y hacia abajo.** 588,8 no es medida de taller; sobrar
  hormigón es un dato, faltar es una barra que no entra.
- **El sesgo lo aplica el trazo, no la pose.** La dirección se lee de la propia polilínea que se
  está dibujando. Razonar por `cara`/`lado`/`rumbo` es donde se cometen los errores de signo.
- **Es OPT-IN en figuras abiertas** (`cfg.anidar === true`) y viene puesto en las cerradas
  (`anidar !== false`). El usuario elige cuándo aplicarlo.
- **El despiece separa las capas solas**: `_claveBarra` incluye todas las dims, así que dos capas
  con cuerpos distintos son ítems distintos. No hay que separar por número de capa.

**POR QUÉ «PERPENDICULAR» Y NO «cualquier vecino» — y cuál es la opción abierta.**

Sale de una regla anterior del mismo usuario: *«al ajustar capas anidadas no debe considerar el
Sep, debe ajustar SOLO la medida de B»*. Si el descuento no puede depender del gap, sólo un vecino
perpendicular lo produce: baja recto, así que a cualquier profundidad sigue en la misma coordenada
longitudinal y el retiro es exactamente φ. Un vecino **diagonal**, a profundidad *gap*, está en
`u ∓ gap·cot(θ)`: su retiro **sí depende del Sep**.

Por eso hoy una pata diagonal **no se descuenta y se AVISA** (`reglas._avisoDiagonalAnidado`).
Son 38 figuras (103B, 103E, 103F, 103H, 103J, 103L con los dos extremos diagonales; el resto con
uno).

> **Esto es lo importante para el futuro: esa frontera existe por una RESTRICCIÓN, no porque la
> geometría no sepa contestar.** El número de la diagonal es derivable — sólo que lleva el Sep
> adentro. Las opciones son dos:
>
> 1. **Como está hoy** — regla general + frontera declarada. El usuario ve el aviso y ajusta esa
>    medida a mano si quiere.
> 2. **Levantar la restricción del Sep sólo para este cálculo** — el descuento de la diagonal se
>    deriva de θ y del gap, la regla cubre las 63 figuras y la frontera desaparece. Cuesta una
>    excepción menos y una dependencia más.
>
> No hay una tercera que no sea inventar un número.

**Contornos cerrados**: quedan fuera de este movimiento. Su capa no se traslada, se **insetá** —
cada lado se retira por su propia normal, o sea cierra por sus dos extremos. Es la misma frase
leída sobre otro movimiento, no un caso especial: la condición es «¿la cadena cierra?», que es un
hecho geométrico.

**Deuda anotada**: si la figura no tiene geometría en el catálogo, el predicado cae a un criterio
viejo (contar posiciones en la lista de dims), que es exactamente la regla equivocada que esto
reemplazó. En la app el catálogo siempre carga, así que no se ejecuta. Lo correcto es que una
figura desconocida reciba el mismo trato que la diagonal: **no se descuenta y se dice por qué.**

### 11.3 El Δ por lado y su flecha

El Δ de un lado se suma al largo de corte y a los kilos. La **flecha** dice por dónde crece o se
acorta, con **tres estados en toda figura**: `fin` (→) · `ini` (←) · `centro` (↔, mitad por cada
borde). El largo de corte es el mismo en los tres; lo único que cambia es dónde queda la barra.
El default es `centro` en un marco cerrado (crece centrado por naturaleza) y `fin` en una cadena
abierta.

**La flecha sólo manda en el lado que CORRE.** `reglas._deltaDelDominante` sesga un solo lado: el
longitudinal. En una pata el Δ alarga, pero la flecha no mueve nada — una pata tiene un extremo
soldado a la esquina del cuerpo y el otro libre, así que no hay elección. Por eso se muestra
apagada con el motivo.

**Dos ampliaciones legítimas, no hechas:**

1. En una figura de 5+ lados, los lados **interiores** también tienen los dos extremos amarrados y
   ahí la flecha sí tendría sentido. Hoy el motor sólo sesga el lado longitudinal.
2. El **tirador** escribe `extremo` al arrastrar un borde, así que pisa un `centro` puesto a mano.
   Lo correcto sería que arrastrando en modo centrado la barra crezca a los dos lados a la vez
   (el borde arrastrado sigue al mouse igual y el opuesto se abre lo mismo).

## 12. ASISTENTE IA DE ENFIERRADO — chat en el modelador (DISEÑO CERRADO 2026-08-30, 2ª ronda auditada)

### 12.1 Propósito

Copiloto conversacional dentro del modelador: el cubicador le pega **recortes de plano** (imagen
sacada del CAD) y/o le describe el muro con texto, el asistente conversa corto y va armando/
modificando la **receta** del muro, lista para que el motor genere las barras. Sirve tanto para
**crear templates desde cero** (esa es parte de la gracia) como para ajustar uno existente.
Partimos con **MUROS**; después se extrapola a los otros elementos.

**Es ayuda productiva, NO automatización.** El humano siempre valida en el 3D antes de aceptar.

### 12.2 Principios firmes

1. **El modelo NUNCA genera geometría.** Solo llena/modifica los parámetros de la receta
   (`{tipo, geometria, componentes[]}` — mismo shape que el TE produce a mano, schema 2 de dims).
   El motor de reglas existente hace todo lo demás. Cero ramas nuevas en el motor.
2. **Puede partir de un template existente O del muro en blanco** (defaults del TE). No exige
   biblioteca poblada.
3. **Entrada acotada a UN muro/eje** — pero pueden ser varios recortes del mismo muro en distintos
   rangos de pisos (p.ej. 4-7 y 8-12): el asistente entiende la película completa del eje.
   La lámina completa con muchos muros queda fuera.
4. **Nada silencioso.** Cada campo con su **origen**: `leído del recorte` · `config` ·
   `asumido (dicho al usuario)` · `no encontrado`. Lo crítico se pregunta; jamás inventa un
   diámetro o espaciamiento. El origen vive en el estado del chat (no se guarda en la receta).
5. **El resultado entra como elemento en edición, SIN guardar** — guardar template o cargar al
   despiece son las acciones manuales de siempre.
6. **Si el usuario edita en el 3D y sigue conversando, el asistente recibe la receta ACTUAL del
   editor en cada turno** — nunca pisa lo editado con una copia vieja.

### 12.3 UI (cerrada 30-ago 2ª ronda)

- **UN solo botón IA** en el modal del Template Editor. Como el "Enfierrador" es el MISMO modal en
  modo obra (desde 25-ago), el botón sirve en ambos contextos sin doble integración.
- El chat **NO es un modal sobre el modal**: reemplaza/ocupa el panel de controles (o panel
  lateral), de modo que el 3D queda SIEMPRE visible mientras se conversa — "vamos a ver lo que
  dibujó" sin cerrar nada. Minimizable.
- **Persistencia temporal de sesión**: la conversación vive mientras el modal esté abierto
  (minimizar/restaurar no la pierde). Cerrar el modal o recargar la página la pierde (F1).
  Muro nuevo = chat nuevo. No se persiste en BD (decisión 2ª ronda: "hacer el muro, cargar y
  cerrar").
- Muestra un **formulario tipo** con los campos de la receta (los del controlador de componentes)
  llenándose en vivo — pinta desde `ST.receta` viva, no desde una copia. Edición inline: NO v1.

### 12.4 Arquitectura (correcciones de auditoría incorporadas)

- **Backend**: endpoint nuevo (p.ej. `POST /api/v1/asistente/chat`) → **API de Anthropic** (visión
  + tool use, JSON-schema de la receta como salida forzada). API key en env; el navegador NUNCA
  habla directo con Anthropic. Agregar `anthropic` a requirements.txt.
- El cliente manda el historial completo en cada POST (estado en JS); sin tabla de conversaciones
  en F1.
- **La salida del modelo pasa por `_validar_receta` antes de cargarse al editor**; si no valida, se
  reintenta automático con el error como feedback; si vuelve a fallar, se muestra al usuario.
- **Unidades fijadas en el prompt**: dims en cm, φ en mm, sep en cm — igual que todo el modelador.
- **Contexto**: la config del modelador es **GLOBAL** (decisión 17-ago), no por obra — el asistente
  lee esa config global + `obra_config` cuando hay obra activa. (§12 v1 decía "de la obra activa":
  corregido.) Protocolo de cubicación se conecta a futuro.
- **Tope de gasto**: cuenta API del usuario, US$5 inicial. Crédito agotado → mensaje claro al
  usuario: «Asistente sin crédito, avisa al administrador». Contador simple de llamadas por
  usuario/día como freno de loops.
- **Modelo**: **Sonnet**; Opus solo si la lectura se queda corta.
- **Historial**: solo sesión del modal (ver §12.3).
- **Sin fine-tuning**: calidad por contexto (ver §12.8).

### 12.5 Permisos

**Los mismos que hoy gestionan templates** (`_puede_gestionar_templates`: admin/admin_calidad/
miembro ∪ editores de catálogo ∪ área cubicaciones). Quien ve el TE, ve el botón.

### 12.6 Decisiones cerradas por el usuario (30-ago, dos rondas)

1. Un botón IA en el modal del TE (sirve en catálogo y modo obra); chat en panel con el 3D siempre
   visible; minimizable con persistencia de sesión.
2. Siempre 1 muro; varios recortes por rangos de pisos del mismo eje.
3. Recortes se guardan (R2). En modo obra: asociados a la obra. En catálogo: **genéricos, sin
   obra** — son herramientas de trabajo del template.
4. Campos = los del controlador de componentes; formulario visible llenándose.
5. Contexto = config global del modelador + obra_config; protocolo de cubicación a futuro.
6. Conversación corta; parte de template existente O en blanco (sirve para crear templates).
7. Resultado en edición, sin guardar. Historial no persiste en BD.
8. Permisos = los mismos del TE actual.
9. API propia del usuario, tope inicial US$5; sin crédito → aviso claro.
10. OK enviar recortes a la API (límite real: contrato con cada cliente; sin mecanismo por obra,
    deuda anotada).
11. Historial por sesión de modal; muro nuevo = chat nuevo.
12. Sonnet primero.
13. Salida del modelo validada con `_validar_receta` + reintento; unidades cm/mm en prompt; origen
    por campo en el estado del chat.

14. **Respuesta del chat: en bloque (opción A, cerrada 30-ago)** — icono de cargando ~5-15 s y la
    respuesta llega completa. Streaming (texto de a poco) = mejora futura, migrable sin botar nada.

**No quedan preguntas abiertas de F1.**

### 12.7 Fases

- **F1 — texto → receta** (sin imagen): botón, chat en panel, esquema, formulario, validación,
  origen por campo, carga como elemento en edición. Deja toda la cañería lista.
  - **Etapa 1 (maqueta visual, HECHA 30-ago)**: botón 🤖 IA en el titlebar del TE, panel de chat
    que reemplaza a #te_side (3D visible), minimizable, formulario demo con chips de origen,
    conversación de ejemplo. Archivos: `template_editor_modal.html` (markup+CSS scopeado),
    `modelador/asistente.js` (nuevo), `bootstrap.js` (carga). SIN lógica: la respuesta es fija.
  - **Etapa 2 (conectar, HECHA 30-ago tras OK visual)**: `armahub/asistente.py` (nuevo router
    `POST /asistente/chat`): API Anthropic con tool use estricto `proponer_muro` — el modelo llena
    una FICHA simple (geometría, mallas, trabas, origenes) y el backend construye la receta
    determinísticamente (`_construir_receta_muro`, patrón del test canónico de muro); valida con
    `_validar_receta` + 1 reintento; tope 200 llamadas/usuario/día; errores en castellano (sin
    crédito → 402 «avisa al administrador»). Conocimiento en `armahub/data/conocimiento_asistente.md`
    (§12.8, por elemento). Front: `asistente.js` conectado (Pensando…, formulario real por origen,
    «Cargar como borrador» vía `templateEditorAbrir`), export nuevo `templateEditorEstado()` y
    muro-nuevo=chat-nuevo (envoltorio sobre `templateEditorAbrir`). Tests reales:
    `tests/test_asistente_backend.py` (16 checks del constructor/mensajes/cableado).
    **Prerrequisito para que responda: variable `ANTHROPIC_API_KEY` en Render.**
- **F2 — + recortes de imagen**. Rangos de pisos RESUELTO (2ª ronda): la salida es **UNA receta**;
  al instanciar en modo obra el asistente **presugiere los pisos donde detecta repetición** y el
  usuario inserta con el botón usual (la selección de pisos ya existe en el flujo de instanciar).
  Variantes distintas por rango = pasadas sucesivas del chat. Pendiente F2: formato/tope de MB y
  máximo de imágenes por conversación; tabla que asocie recorte↔obra/template.
- **F1.2 — traductor ficha→receta REAL (HECHA 31-ago, tras primera prueba del usuario)**: la
  primera versión armaba las mallas con un patrón simplificado (MA/arreglo + trabas rectas) y el
  muro salía mal (sin jerarquías, trabas sin gancho, sin bordes). Se reescribió
  `_construir_receta_muro` con el patrón EXACTO del editor (mapa de agente 31-ago): MV/MH modo
  lineal, UNA cortina por componente (lado ±1), traba TC **figura 103B** pose {sup,1,z} jerarquía 2
  en arreglo x×y (rango2, margen de gancho abajo), y **confinamiento de borde EN LA FICHA**:
  cabezales CB (cara extremo, layered n×m por punta) + estribo EC acotado (dims.B fija
  extremo 'centro' + pos_hint.x — única combinación que el motor respeta, medida). Verificado con
  el MOTOR REAL vía Node: `tests/test_asistente_receta_motor.js` (cortinas opuestas dentro del
  recub, traba cruza espesor, CB en ambos testeros, EC en la punta, nada fuera del hormigón);
  encadenado desde `tests/test_asistente_backend.py`. UX: auto-carga de la receta al editor,
  contador de segundos, cierre cuando la respuesta viene sin texto, esfuerzo medio.
- **F1.3 — figura/jerarquía en la ficha + instalación en vivo (HECHA 31-ago)**: el usuario pidió
  «malla horizontal 104B, jerarquía 1» y el asistente contestó que eso no era suyo y lo mandó a
  reportar un bug inexistente — era un hueco de la ficha, no del modelo. Ahora `figura` y
  `jerarquia` son campos OPCIONALES por elemento (null = default de la plataforma) y los parciales
  y ángulos salen del **catálogo real** (`cargar_figuras`), no de una tabla escrita a mano: una
  figura de 2, 3 o 4 lados escribe las dims que le corresponden. Además la receta se **instala en
  vivo**: entra el hormigón y las barras se colocan de a una por
  `templateEditorAgregarComponente` (la misma puerta del clic manual), con el chat mostrando
  «colocando 3 de 9». El botón del panel pasó a ser «Cargar la propuesta completa».
  Corregido también el filtro del documento de conocimiento: comparaba el título entero, así que
  una sección con paréntesis («## FIGURAS (códigos…)») nunca llegaba al prompt **en silencio**.
- **F1.4 — el catálogo de figuras va COMPLETO y desde la BD (31-ago)**: el asistente rechazó la
  figura 104B diciendo que no existía («las familias 104 son 104A y 104D») porque solo tenía la
  lista resumida que yo había escrito a mano en el documento de conocimiento, y una lista parcial
  dentro de un prompt no se lee como parcial. Ahora `_catalogo_de_figuras(cur)` lee
  `figuras_catalogo` (1 consulta) y le inyecta la lista completa como `codigo:lados:angulos`,
  declarada como única autoridad; el documento de conocimiento dejó de enumerar códigos y solo
  explica cómo leerlos. Nada que sincronizar a mano: el catálogo es dato.
- **F1.5 — EMPALME en la ficha + mapa de controles (31-ago)**: el usuario pidió «empalme 60» y el
  asistente no tenía dónde ponerlo. El traslapo es el **Δ por lado** del editor
  (`dims[L].delta` + `extremo`, template_editor.js:8722): se suma al largo de corte y la barra
  SOBRESALE del hormigón por esa punta (correcto — amarra con el piso de arriba; el test de motor
  lo tomaba como error y se corrigió para sumar el Δ declarado). Campo `empalme` (cm) en mallas y
  cabezales; se escribe en el lado que corre (A en barra recta, B en figura de 3-4 tramos).
  **Controles que el asistente TODAVÍA no alcanza** (inventario del panel, agente 31-ago), por
  orden de importancia: `rango.tramos[]` (reparto multi-@: @10 en zona confinada, @20 al centro),
  `distribucion.anidar`, `c.lado_dominante`, `c.orient.spin` (dirección de patas), `rango.n`
  (dictar por cantidad en vez de por rango), `c.color`, `c._oculto`. Inertes en toda la
  plataforma (no son huecos del asistente): `prioridad`, `depende_de`, `comp_id`.
- **F1.6 — la ficha alcanza los controles que faltaban (31-ago)**: el usuario pidió «cabezales
  102A con pata de 25, empalme 6φ, 2 capas cada 15» y salió una barra deforme («peineta»).
  MEDIDO con el motor: con la pata en AUTO, la pose del cabezal (cara `extremo`) la resuelve
  **contra el largo del muro** — A = 508 cm en un muro de 514, la barra que el editor marca como
  «fierro fuera del hormigón». Correcciones: (a) el lado que CORRE es **B** cuando la figura lo
  tiene (antes el empalme caía en A, la pata, y la barra se iba 266 cm afuera); (b) el cabezal
  escribe sus **patas FIJAS** — lo pedido, o el gancho normativo si no se dijo — porque auto ahí no
  sirve (en trabas y estribos sí, medido, y se deja); (c) campos nuevos en la ficha: `pata`,
  `sep_capas` (separación entre capas del cabezal), `tramos` (reparto multi-@: «@10 los primeros
  80, @20 el resto»), `anidar`, `lado_dominante` y `giro_patas`. El traslapo de la casa se corrigió
  a **60·φ** (no 40) en el conocimiento y en el prompt. Suite: 39 checks + motor real.
- **F1.7 — color por barra (31-ago)**: campo `color` en la ficha, por nombre en castellano o hex.
  El DEFAULT ya era correcto y no se toca: sin `c.color` el editor pinta con el color de la
  TIPOLOGÍA (`_colorComp` → COL2D, template_editor.js:3543) — MH azul, MV verde, TR/TC morado,
  EC naranjo, CB azul —, así que el constructor no lo escribe salvo que el usuario pida otro.
  Un color que no se entiende NO se inventa: se deja el de la tipología.
  **Verificación de la «peineta»** (duda razonable del usuario: ¿el motor cambió la figura?): NO.
  Medida la morfología de la 102A del cabezal en los tres casos — siempre **2 tramos con quiebre de
  90°, ejes X e Y**. Lo único que cambiaba era el largo de la pata: 507 cm en auto contra 24 con la
  pata fija. El motor fue consistente; el dato de entrada era absurdo.
- **F1.8 — no inventar armaduras (31-ago)**: el usuario pidió SOLO cabezales y el asistente creó
  además un estribo de confinamiento φ8@10 — 32 marcos apilados que en el 3D se ven como una
  «espina de pescado». No fue alucinación del modelo: **mi prompt le decía que asumiera el
  estribo**. Ahora la regla es la contraria y explícita: cada armadura de la ficha es una barra que
  se fabrica, lo que no se pidió va en null, y el estribo se PREGUNTA. Además el prompt separa
  `bordes.barras` (CABEZALES, por capas) de `bordes.estribo` (marco con @) — un pedido de
  cabezales nunca se escribe en el estribo. Y el formulario abre con una línea de **inventario**
  («2 mallas verticales + 2 horizontales + 1 traba + 2 cabezales») para que lo que sobra se vea
  antes de instalarse.
- **F1.9 — el estribo de la casa es la 106A + verificación del render (31-ago)**: el usuario
  preguntó si la barra que veía era una renderización defectuosa. **NO se pudo corroborar, y la
  evidencia apunta a lo contrario**: `motor_geom.partesDeBarra` dibuja la polilínea LITERAL — un
  cilindro por tramo y un toro por doblez, sin cerrar ni suavizar —, así que lo que se ve en
  pantalla ES la lista de puntos. Medido además que el estribo que genera el asistente sale
  CERRADO (6 tramos, puntas a 4 cm = el traslape del gancho). Corrección del usuario incorporada:
  el estribo de confinamiento por defecto pasa de 104D a **106A** (verificado contra el motor:
  6 lados, cierra, ganchos de 45°, tramos [8.6, 37.2, 15.2, 39.2, 13.2, 8.6] con B fija en 40).
- **F1.10 — un solo camino de construcción + el error se dice (31-ago)**: el usuario señaló el
  defecto de raíz — «si usara las reglas del motor como las usa el usuario, no debería poder
  ocurrir eso». Es correcto: el asistente armaba la receta en Python, un camino PARALELO al del
  editor, y un camino paralelo puede producir estados que el editor nunca produciría (distribución
  a medias, pose sin espejar, dims que no cubren los parciales de la figura) — justo los que salen
  deformes. Ahora `templateEditorAgregarComponente` NO empuja el componente crudo: lo pasa por los
  MISMOS mutadores del clic manual (`_setPose` → `_dimsDefault` por parcial real de la figura →
  `_setModoComp`), y el ancla la estampa `_regenerar` vía `reanclarReceta` como en cualquier otra
  mutación. Además el error de la API dejó de esconderse detrás de «tuvo un problema, intenta de
  nuevo» (mandaba a reintentar algo que no iba a funcionar): ahora se muestra el motivo técnico.
  Y el test valida el schema de la herramienta en todos sus niveles (strict exige
  additionalProperties:false y toda property en required).
- **F1.11 — el tope de uniones de la API (31-ago)**: al mostrar el motivo técnico (F1.10) apareció
  la causa real de que el asistente dejara de responder: `400 invalid_request_error — Schemas
  contains too many parameters with union types (33). Limit: 16`. Cada campo opcional que se fue
  agregando usaba `anyOf [null, X]`, y sumaron 33. Ahora los ESCALARES opcionales no son anulables:
  usan valor vacío — `""` en textos, `0` en números (ningún φ, @ ni largo real vale 0) y `-1` donde
  el 0 es legítimo (giro de patas, anidar). `tramos` pasó a lista vacía. Quedan 3 uniones, solo los
  objetos que pueden no existir (trabas, bordes, estribo). El test cuenta las uniones y falla si se
  pasa de 16 — este error no se puede repetir en silencio.
- **F3 — extrapolar** a viga/columna. **F4 (futuro)** — pisos inferiores irregulares, protocolo
  de cubicación como contexto, carga escalonada de barras (animación al recibir la receta).

### 12.8 Base de conocimiento del asistente (plan por capas, sin fine-tuning)

Para que entienda mejor las prácticas típicas, en este orden de esfuerzo/valor:

1. **Documento de conocimiento curado** (glosario chileno φ/@/malla/traba, prácticas típicas,
   convenciones de planos de las oficinas con que se trabaja) que se inyecta al prompt. Editable
   como data, no como código. Es la capa v1.
2. **Ejemplos resueltos** (few-shot): pares descripción/recorte → receta correcta, elegidos a mano.
   2-4 ejemplos buenos mueven más la aguja que cualquier otra cosa.
3. **La propia biblioteca de templates** como referencia: al conversar, se le pasan los templates
   de muro existentes (nombres + recetas resumidas) para que proponga "parecido al Muro X".
4. (Futuro, solo si el volumen lo pide) búsqueda de templates similares antes de llamar al modelo.

El documento de conocimiento (capa 1) se organiza **catalogado por tipo de elemento** (muro, viga,
columna, losa...) desde el día uno, para que al extrapolar a otros elementos solo se agregue la
sección nueva sin tocar lo demás.

### 12.9 Idea futura anotada (NO comprometida): muros irregulares por composición de cajas

Visión del usuario (30-ago): elementos de hormigón no-caja se armarían **componiendo varias
cajas**, reutilizando todo el motor actual. Insight clave: *da lo mismo en qué caja esté la barra
mientras sus dimensiones se configuren bien* — una barra podría nacer en una caja, cruzar otras y
morir en una distinta, tomando el **recubrimiento de la caja donde muere**. El contorno libre
(polígono extruido) queda descartado como camino: obligaría a rehacer colocador/caras/
recubrimientos. No abordar hasta que se decida explícitamente.

---

*Fin del documento. Actualizar al cerrar cada caluga o al cambiar flujos, permisos o decisiones de diseño.*
