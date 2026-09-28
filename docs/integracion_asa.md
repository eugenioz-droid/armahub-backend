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

## 2. La superficie técnica (a completar con el Power Query)

| Dato | Valor |
|---|---|
| URL base | _(pendiente)_ |
| Autenticación | _(¿header `Authorization`? ¿`ApiKey`? ¿query string?)_ |
| Endpoint de obras | _(pendiente)_ |
| Endpoint de cubicaciones / códigos de control | _(pendiente)_ |
| ¿Acepta filtro por texto? | _(pendiente — define si el buscador es server-side)_ |
| ¿Acepta paginación? | _(pendiente)_ |
| Formato | _(JSON / OData / XML)_ |

### Campos que nos interesan de una obra

_(pendiente: id, nombre, cliente, estado. Nada más hasta que haga falta.)_

### Campos que nos interesan de una cubicación

_(pendiente: código de control, obra, fecha, kilos. Nada más.)_

---

## 3. Los tres cuidados que puso el usuario

### 3.1 No reventar aSa

Reglas de diseño, en orden de importancia:

1. **aSa nunca se consulta al cargar una pantalla.** Sólo cuando el usuario escribe en el
   buscador y aprieta. Cero polling, cero sincronización masiva, cero job nocturno
   mientras no haga falta.
2. **Se pide filtrado y acotado.** El buscador manda el texto a aSa y pide un tope (20–50
   resultados). Nunca "tráeme todas las obras".
3. **Lo que se trae se guarda.** Una obra se consulta una vez; después vive en Supabase y
   nadie vuelve a molestar a aSa por ella. Refrescar es una acción explícita.
4. **Timeout corto y sin reintentos ciegos.** 10 s; si aSa no contesta, el buscador dice
   "aSa no respondió" y no vuelve a golpear. Un 4xx nunca se reintenta.
5. **Debounce en el buscador**: no se dispara por cada tecla, sino cuando el usuario
   deja de escribir (~400 ms) y con mínimo 3 caracteres.

Con esto, el volumen es del orden de **decenas de consultas al día**, no miles.

### 3.2 No reventar Render

El riesgo real no es el volumen, es el **bloqueo**: la llamada a aSa ocurre dentro de una
petición web, así que si aSa se demora, el worker de Render queda ocupado. Por eso el
timeout corto es tan importante como el punto anterior.

Lo demás es cómodo: se guardan sólo los campos de la tabla de arriba, no el JSON completo;
no se pagina en memoria; no se sube ningún archivo. Supabase ni se entera — hoy
`sector_estado` tiene 435 filas y `barras` decenas de miles.

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

**Diseño propuesto** — el mínimo que resuelve las dos cosas:

- La obra traída de aSa entra a la tabla `proyectos` **normal**, con dos campos nuevos:
  `asa_id` (el identificador en aSa) y `origen='asa'`. No es una tabla aparte: es una obra
  de Armacero como cualquier otra, sólo que todavía sin barras. Hoy `proyectos` ya tiene 37
  filas y `sector_estado` sólo 18 obras — obras sin despiece ya son la norma, no una
  excepción que haya que inventar.
- `asa_id` es **el campo de enlace** que pidió el usuario ("un campo Key para que las
  importaciones a aSa guarden ese dato"). Homologar más adelante = escribir el `asa_id` en
  la obra de ArmaHub que corresponda. Una línea, sin migrar nada.
- Si la misma obra ya existía en ArmaHub con otro nombre, `proyecto_aliases` (tabla que ya
  existe, con `alias` / `id_proyecto`, y hoy casi vacía) es donde se registra el alias sin
  duplicar la obra.
- La tarea de programación sigue apuntando a `id_proyecto`. No cambia nada del módulo.

Lo que **no** se hace: una tabla `obras_asa` paralela. Duplicaría el selector de obras, los
permisos y las consultas, y el día de la homologación habría que fusionar dos mundos.

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
| 0 | Probar desde el shell de Render que aSa es alcanzable | la URL |
| 1 | Cargar las variables en Render | la key |
| 2 | Cliente HTTP `armahub/asa.py`: una función de búsqueda, con timeout y tope | 0 y 1 |
| 3 | Campos `asa_id` / `origen` en `proyectos` + buscador de obras en Programación | 2 |
| 4 | Campos `asa_cc*` en `tareas_programacion` + buscador de CC | 2 |
| 5 | Toneladas reales desde aSa para las tareas con CC | 4 |

Los pasos 3 y 4 son independientes entre sí. Nada de esto arranca antes del paso 0.
