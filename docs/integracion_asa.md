# Integración con aSa Studio

**Estado: sin implementar.** Este documento es el instructivo donde vive lo que sabemos de
aSa: cómo se conecta, qué se puede pedir, qué se guarda y qué NO. Se escribe una vez y se
va completando; el código viene después.

Alcance acordado (28-sep): **sólo el módulo de Programación.** Las obras de Cubicación no
se tocan por ahora. La homologación entre "obra de aSa" y "obra de ArmaHub" se resuelve
más adelante, pero el campo de enlace se deja puesto desde el primer día para no tener que
rehacer data.

---

## 1. Las credenciales: cómo se pasan

**Regla: nunca por chat, nunca en el repo.** Ni en un archivo, ni en un comentario, ni
"provisoriamente". `.env` está en `.gitignore` (línea 4) y así se queda.

El mecanismo es el mismo que ya usan R2, Resend y Anthropic: **variables de entorno en
Render**.

1. Render → servicio `armahub-backend` → pestaña **Environment** → *Add Environment
   Variable*.
2. Se crean estas (los nombres son los que el código va a leer; si prefieres otros, avisa):

   | Variable | Qué lleva | Secreto |
   |---|---|---|
   | `ASA_API_URL` | la base de la API, p. ej. `https://xxx.asa.../api` | no |
   | `ASA_API_KEY` | la llave | **sí** |
   | `ASA_API_USER` | usuario, si el esquema lo pide además de la key | quizás |
   | `ASA_TIMEOUT` | segundos máximos por consulta (por defecto 10) | no |

3. Después de guardarlas, Render redespliega solo. **Me dices sólo los nombres**, no los
   valores. Si algo no calza, el código lo dice en el log sin filtrar el contenido.

### Lo que sí necesito pegado en el chat (no es secreto)

El **M de Power Query**, con la key reemplazada por `XXXX`. Eso es la documentación real de
la API y me da de una vez: URL base, método, cabeceras, parámetros, formato de respuesta y
nombres de campos.

En Power BI: *Inicio → Transformar datos → Editor avanzado* sobre la consulta de aSa.
Copias el texto, borras la key, lo pegas. Si la consulta tiene varios pasos aplicados,
sirve igual el listado de pasos.

### Registro (a completar)

- Nombres de variables efectivamente creadas en Render: _(pendiente)_
- Fecha en que se cargaron: _(pendiente)_
- Quién tiene la key: _(pendiente)_
- Vencimiento / rotación: _(pendiente)_

---

## 2. La superficie técnica

| Dato | Valor |
|---|---|
| Host conocido | `qa254.asahq.com` — **ambiente QA**, en internet público (no red interna) |
| Ruta base | `/api/public/` |
| Documentación viva | `/api/public/doc` — lista todos los endpoints con sus campos |
| Protocolo | **OData** — confirmado por el ejemplo `?$filter=OrderID eq 'O-0000350'` |
| URL de producción | _(pendiente)_ |
| Autenticación | _(pendiente — ¿header, query string, campo "API Key" de Power BI?)_ |

### Que sea OData cambia el diseño, para bien

Power Query lo habla de forma nativa; por eso funciona en BI sin configurar nada. Nosotros
aprovechamos lo mismo:

- `$select` — pedir sólo los campos que usamos. Las tablas traen ~60 columnas; nos sirven 6.
- `$top` / `$skip` — tope duro y paginación. Nunca "tráeme todo de golpe".
- `$filter` — el filtrado lo hace aSa, no Render.
- **`$filter=LastModified gt <ayer>` — sincronización INCREMENTAL.** Varios endpoints traen
  `LastModified` (DateTimeOffset). La primera carga del espejo es grande; las diarias
  siguientes traen sólo lo que cambió. Esto es lo que hace que el espejo diario sea barato
  para aSa.

### Glosario aSa → Armacero

| aSa | Nosotros |
|---|---|
| Job | obra / proyecto |
| Order | pedido / cubicación |
| Control Code (`CtrlCode`) | el CC |
| WBS | desglose del job (¿sectores?) |
| Shipping Ticket | guía de despacho |
| Load | carga / camión |
| Business Partner | cliente / constructora |

### Endpoints

| Endpoint | Para qué | Prioridad |
|---|---|---|
| `getJobData` | las obras. Alimenta el espejo `asa_obras` | **1 — esencial** |
| `getOrderSummary` | "Control Code Summary": el CC agregado. Ya lo usa el usuario en BI | **1 — esencial** |
| `getWBSData` | desglose del job. A confirmar si trae los sectores constructivos | 2 — evaluar |
| `getShippingTickets` | fecha REAL de despacho vs. la programada | 3 — cierra el círculo |
| `getScheduling` | la programación de producción de aSa. Puede chocar conceptualmente con la nuestra | 3 — mirar antes |
| `getLoad` | cargas/camión, para cuadrar kilaje | 4 — más adelante |
| `getOrderItemView` | línea por línea (`BarMark`, `BarSizeDescr`). **Grano demasiado fino: NO se espeja** | — |
| `getBusPartnerData`, `*Contact*` | **NO se consumen**: ahí viven nombres, correos y teléfonos de personas | — |

### Regla dura: ArmaHub sólo lee

La mitad del catálogo son `create*` / `update*` / `approveOrder`. **ArmaHub no llama a
ninguno, nunca.** Si aSa puede emitir una key de sólo lectura, se pide: esa es la
protección real, no una promesa en un documento.

### Campos que nos interesan de una obra (Job)

_(pendiente: id, nombre, cliente, estado, LastModified. Nada más hasta que haga falta.)_

### Campos que nos interesan de un Order Summary

Confirmados en la doc de `getOrderItemView`, probablemente presentes también en el summary:
`CtrlCode`, `JobID` / `JobKey` / `JobName`, `LastModified`. Falta ver dónde están los
**kilos** y la fecha de la cubicación.

---

## 3. Los tres cuidados que puso el usuario

### 3.1 No reventar aSa — el espejo diario

**Decisión del usuario (28-sep), y es mejor que la alternativa.** No se consulta aSa cada
vez que alguien busca. Se trae la data **una vez al día** a una tabla espejo en Supabase
(el "cubo"), y todas las pantallas de ArmaHub leen de ahí.

|  | buscador contra aSa en vivo | espejo diario ← ELEGIDO |
|---|---|---|
| Velocidad del buscador | 1–3 s por búsqueda | instantáneo (es una query local) |
| Carga sobre aSa | impredecible, cada tecla | 1 vez, en horario muerto |
| Si aSa se cae o cambia IP | el buscador no sirve | ArmaHub sigue andando con lo de ayer |
| Data desactualizada | no | hasta 24 h — irrelevante para obras |

El "delay de traer todo de una" deja de importar porque **nadie está mirando la pantalla**
cuando corre el job. La latencia sólo molesta cuando hay un humano esperando.

Reglas que se mantienen:

1. **Cero consultas a aSa desde una pantalla.** Ninguna petición de usuario toca aSa.
   La única excepción es un botón explícito "Refrescar ahora" para cuando se creó una obra
   hoy y no se quiere esperar al job.
2. **Timeout y sin reintentos ciegos.** Si aSa no contesta, el job falla, lo dice en el
   log y el espejo se queda con lo de ayer. Un 4xx nunca se reintenta.
3. **Se guardan sólo los campos de la sección 2**, no el JSON completo.
4. **Se avisa a aSa.** Render sale por IPs fijas de datacenter, no por la red de Armacero.
   Si aSa tiene lista blanca de IPs nos bloquea, y si vigila el uso de la key puede
   levantar una alerta al verla desde un lugar nuevo. Hay que avisarles la IP y la
   frecuencia **antes** de encender el job, no después.

### 3.2 No reventar Render

Con el espejo, el riesgo del worker bloqueado desaparece: ninguna petición de usuario
espera a aSa. Queda sólo la pregunta de **cómo se dispara el job diario** — Render Cron
Job (servicio aparte) o un endpoint protegido por token que llame un cron externo. Se
decide cuando sepamos si Render alcanza a aSa; antes es teoría.

El volumen no es tema: unas cientos de obras y sus cubicaciones. Hoy `barras` tiene
decenas de miles de filas y Supabase ni se despeina.

**Lo que sí hay que verificar antes de codear:** que Render **pueda alcanzar** aSa. Si la
API vive dentro de la red corporativa de Armacero (que es lo normal cuando Power BI la
consume desde un PC de la oficina), Render no llega y la integración no existe. Es lo
primero que se prueba: un `curl` desde el shell de Render. Si no llega, las opciones son
publicar la API, una VPN, o un puente — y eso ya es conversación con TI.

### 3.3 Ley de datos

No soy abogado, así que digo lo que sí es técnico y verificable:

- **Una obra no es un dato personal.** Nombre de obra, código, cliente-empresa, kilos: eso
  es información comercial de Armacero, y sale de un sistema de Armacero hacia otro sistema
  de Armacero. No hay tratamiento de datos personales de terceros.
- **Lo que sí hay que evitar es traer personas.** Si el endpoint de obras devuelve nombres
  de contacto, correos o teléfonos, esos campos **no se guardan**. Se pide lo mínimo y se
  descarta el resto al entrar, no después.
- **La key es un secreto de Armacero**, no un dato personal, pero se trata igual de bien:
  variable de entorno, fuera del repo, rotable.
- Los datos quedan en la misma infraestructura donde ya vive todo ArmaHub (Supabase +
  Render). No se agrega ningún tercero nuevo.
- Queda registro de quién trajo qué obra y cuándo (la tabla lleva `traida_por` y
  `traida_el`), que es lo que pide cualquier auditoría.

Si TI de Armacero tiene una política escrita sobre consumo de la API de aSa, **eso manda
sobre esto**. Vale la pena preguntarlo antes de pedir la key.

---

## 4. Las dos derivadas del usuario

### 4.1 Obras que están en aSa pero no en ArmaHub

Tienen que poder programarse igual. Y cuando después esa obra se cree en ArmaHub (o ya
exista con otro nombre), debe poder enlazarse sin perder la programación hecha.

**Diseño: dos capas.** El espejo por un lado, las obras adoptadas por otro. Esto sale
directo de cómo lo planteó el usuario: *"un listado vacío al cual podamos poblar con un
buscador que busque en este cubo de datos de aSa"*.

- **`asa_obras`** — el espejo. TODO lo que aSa tiene, refrescado a diario. Es data cruda:
  nadie la ve en la interfaz salvo a través del buscador. Campos: `asa_id` (PK), nombre,
  cliente, estado, `visto_el`.
- **`proyectos`** — sólo las obras que el usuario **adopta** desde el buscador. Se le
  agregan `asa_id` y `origen='asa'`. Es una obra de Armacero normal, sólo que todavía sin
  barras (hoy `proyectos` ya tiene 37 filas y `sector_estado` sólo 18 obras: obras sin
  despiece ya son la norma).

Por qué dos capas y no volcar el espejo directo a `proyectos`: aSa tiene cientos de obras
y `proyectos` alimenta el selector de obras de **toda** la plataforma. Volcarlo lo
ensuciaría para todos. Con el espejo aparte, las obras entran de a una, cuando el usuario
decide.

Sobre el enlace:

- `asa_id` es **el campo Key** que pidió el usuario ("un campo Key para que las
  importaciones a aSa guarden ese dato"). Homologar más adelante una obra que ya existía en
  ArmaHub = escribirle su `asa_id`. Una línea, sin migrar nada.
- Si la misma obra existe con otro nombre, `proyecto_aliases` (ya existe, con
  `alias` / `id_proyecto`, hoy casi vacía) registra el alias sin duplicar la obra.
- La tarea de programación sigue apuntando a `id_proyecto`. No cambia nada del módulo.

### 4.2 El código de control (CC) de las cubicaciones hechas en aSa

Hay trabajo que no pasa por ArmaHub: se cubica directo en aSa Studio y queda con un CC. Esa
tarea igual estaba programada, así que el programa tiene que poder cerrarla.

**Diseño propuesto:**

- `tareas_programacion` gana `asa_cc`, `asa_cc_el`, `asa_cc_por`.
- Al marcar una tarea como cubicada, si la obra tiene `asa_id`, se ofrece buscar el CC.
- El buscador **sugiere primero**: como el nombre de la cubicación en aSa está
  medianamente estandarizado (`LCIELO P1 C5`), se pre-filtra por obra y por parecido de
  nombre. En la mayoría de los casos es un clic.
- Si no calza, se busca a mano por texto. Misma caja, mismo flujo.
- Una vez enlazado el CC, los **kilos reales** pueden venir de aSa. Hoy la caja 4
  ("Realizadas") muestra toneladas reales sólo para obras cubicadas en ArmaHub
  (`SUM(peso_total)` de `barras`); con el CC enlazado, cierra el círculo para las demás.

Ése es el verdadero premio de esta integración: el usuario dijo que quiere cruzar qué sale
de ADetailer, qué de ArmaHub y qué se cubica directo en aSa. El CC es ese cruce.

---

## 5. Orden de trabajo

| # | Paso | Depende de |
|---|---|---|
| 0 | Probar desde el shell de Render que aSa es alcanzable (y avisarle a aSa) | la URL |
| 1 | Cargar las variables en Render | la key |
| 2 | Cliente HTTP `armahub/asa.py`: leer un endpoint, con timeout | 0 y 1 |
| 3 | Tabla espejo `asa_obras` + job de refresco diario + botón "Refrescar ahora" | 2 |
| 4 | Campos `asa_id` / `origen` en `proyectos` + buscador contra el espejo | 3 |
| 5 | Espejo de cubicaciones + `asa_cc*` en `tareas_programacion` + buscador de CC | 3 |
| 6 | Toneladas reales desde aSa para las tareas con CC | 5 |

Los pasos 4 y 5 son independientes entre sí. Nada de esto arranca antes del paso 0: si
Render no alcanza a aSa, la integración no existe y hay que hablar con TI (VPN, publicar
la API, o un puente).

**Pendiente de decidir:** cómo se dispara el job diario (Render Cron Job vs. endpoint con
token llamado por un cron externo). Se define en el paso 3.
