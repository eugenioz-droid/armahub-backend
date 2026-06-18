# Arquitectura del sistema de correo de ArmaHub

**Estado:** PROPUESTA de arquitectura para aprobar antes de implementar el motor (5B/B).
Surge de la observación correcta del usuario (2026-06-17): el motor de envío necesita
decisiones de arquitectura previas para que automáticos y manuales queden ordenados y
con control claro para el admin de calidad. NO empezar a codear el motor sin acordar esto.

---

## 0. AVISOS AUTOMÁTICOS — definición acordada (2026-06-17)

**Canal correo = independiente de la campanita in-app** (esta última aporta poco; no se
toca ni se depende de ella). El correo es su propio canal para avisar a la gente que
entre a la plataforma a tratar sus reclamos.

**Dos eventos automáticos iniciales (la lista crecerá):**

| Evento | Destinatarios (derivados del reclamo) |
|---|---|
| **Reclamo EXTERNO creado** | Responsable asignado · Jefa de Calidad (`admin_calidad`) · USC creador |
| **Reclamo INTERNO creado** | Jefe del área destino · Jefa de Calidad · Creador |

Los destinatarios son **roles relativos al reclamo** (el asignado de ESE reclamo, el
creador de ESE reclamo), no roles genéricos. Cada uno será destildable por evento en el
tab "Envío automático" (2ª parte).

**Disparo:** al CREAR el reclamo, con **warning de confirmación** en pantalla (muestra a
quién se enviará). El envío NO es silencioso: el USC confirma.

**Tres conceptos separados (NO mezclar):**
- **Plantilla** = el contenido (qué dice). Una por evento. → tab Plantillas.
- **Regla** = cuándo y a quién (evento → destinatarios destildables). → tab Envío automático.
- **Cierre Reclamos** = envío manual del informe (ya implementado). → tab Cierre Reclamos.
→ Esto justifica el 3er tab: "qué dice" (plantilla) y "a quién/cuándo" (regla) son distintos.

**DECISIONES ABIERTAS (no implementar hasta resolver — el usuario quiere darles una vuelta):**
1. Qué pasa si el USC NO confirma el envío: idea = no se crea el reclamo PERO no perder lo
   ingresado en el formulario; quizás un estado "no enviado" o dejar la línea pendiente.
   UX por madurar.
2. Destinatario faltante (área sin jefe / usuario sin correo): "no debería ocurrir";
   idea = caer a Jefa de Calidad. Revisar bien después.

**Plan por partes (acordado):**
- **Parte 1 (MOTOR, ahora):** helper que dado un reclamo calcula destinatarios por tipo y
  envía con su plantilla + registra en trazabilidad. Plantillas semilla de los 2 eventos.
  Destinatarios FIJOS por tipo (aún sin destildar). NO incluye el warning ni el disparo
  automático en la creación (eso depende de la decisión abierta #1).
- **Parte 2:** tab "Envío automático" para destildar roles por evento (configurable).
- **Parte 3:** enganchar el disparo en la creación + warning, una vez resuelta la UX (#1).

---

## 1. Hallazgo: ya existe una arquitectura de eventos

El sistema YA tiene la base correcta, hoy usada solo para avisos in-app:

- **`TIPOS_EVENTO`** (notifications.py): `reclamo_creado`, `reclamo_asignado`,
  `analisis_completado`, `enviado_a_revision`, `enviado_a_validacion`,
  `validacion_realizada`, `reclamo_cerrado`, `reclamo_reabierto`, `cambio_estado`.
- **`crear_notificacion(tipo_evento, reclamo_id, mensaje, destinatarios_extra)`**: helper
  central que, ante un evento, mira la matriz `notificacion_config` (evento × rol, activable)
  y crea una notificación in-app por cada rol/destinatario configurado.
- Se dispara desde puntos reales del flujo (reclamos.py: al crear, cambiar estado, cerrar…).

**Decisión de arquitectura nº1:** el correo NO es un sistema aparte. Es **otro canal**
del mismo evento. La matriz pasa de "evento × rol → ¿notifica in-app?" a
"evento × rol × **canal** (in-app | correo) → ¿activo?". Así, encender el correo
automático de un evento = activar el canal "correo" de ese evento para ciertos roles.

---

## 2. Dos modos de envío, una sola base

| | **Automático** | **Manual** |
|---|---|---|
| Disparo | Un evento del sistema (ej. reclamo_cerrado) | El admin aprieta "Enviar informe" |
| Destinatarios | Roles/usuarios configurados para ese evento+canal correo | El admin elige (involucrados tildados + manuales) |
| Plantilla | La asociada al evento | La que el admin elija, cuerpo editable antes de enviar |
| Adjunto | Normalmente no (aviso simple) | Sí: el PDF del informe |
| Control | Panel de Configuración (evento×rol×canal) | En el reclamo, en el momento |

**Lo común a ambos (base única):**
- **Plantillas** (`correo_templates`, ya existe): asunto + cuerpo con variables.
- **Render de variables**: una función que reemplaza `{{correlativo}}`, `{{proyecto}}`, etc.
- **Envío** vía `mailer.py` (Resend).
- **Log único** de todo correo enviado (auto o manual): a quién, cuándo, evento/manual,
  plantilla, estado, message_id. Hoy hay `reclamo_envios` (solo informe manual); se
  generaliza a `correo_log` transversal, o `reclamo_envios` se mantiene para el informe
  y se agrega `correo_log` para el resto. **Decisión nº2 (ver abajo).**

---

## 3. Cómo se configura desde el portal (control del admin de calidad)

El engranaje **Calidad → ⚙️ Configuración** tendrá (alcance acotado a mailing):

**Sub-tab "Plantillas de correo"** (ya existe el CRUD):
- Lista de plantillas. Cada una con clave, nombre, asunto, cuerpo, variables.
- A definir: ¿cada plantilla se asocia a un evento (para automáticos) o son libres?

**Sub-tab "Envío automático"** (hoy placeholder → se construye):
- Tabla **evento × ¿enviar correo? × a qué roles × con qué plantilla**.
- Por cada `TIPOS_EVENTO`: un switch "enviar correo", selección de roles destinatarios,
  y plantilla asociada. El admin de calidad enciende/apaga y elige plantilla.
- Esto es el "control claro" que pediste: en un solo lugar se ve qué correos salen solos.

**En el reclamo (manual):** botón "Enviar informe" → modal con plantilla elegible +
destinatarios + cuerpo editable. Lo manual NO se configura en el panel; se decide al vuelo.

---

## 4. Decisiones de arquitectura a tomar (ANTES de codear el motor)

1. **Canal sobre la matriz de eventos:** ¿extender `notificacion_config` con columna
   `canal` (in-app|correo), o crear `correo_evento_config` separada? (Recomiendo extender:
   un solo lugar para "qué notifica cada evento y por dónde".)
2. **Log de correos:** ¿`reclamo_envios` para el informe manual + `correo_log` general
   para todo lo demás, o un único `correo_log` para todo? (Recomiendo único `correo_log`
   transversal; `reclamo_envios` se absorbe o queda como vista.)
3. **Plantillas ↔ eventos:** ¿una plantilla por evento (relación directa), o plantillas
   libres que se asignan al configurar cada evento? (Recomiendo libres + asignación.)
4. **Alcance del primer entregable:** ¿construimos solo el MANUAL del informe ahora
   (caso 5B puro) sobre esta base, y el AUTOMÁTICO como segunda etapa? ¿O el panel de
   automáticos también ahora? (Recomiendo: base común + manual primero; automático después,
   pero con el modelo ya diseñado para que encaje sin retrabajo.)
5. **Variables disponibles** en plantillas: definir el set (correlativo, titulo, proyecto,
   cliente, responsable, estado, fecha_cierre, descripcion, causa_raiz…). El usuario define.
6. **Quién recibe los automáticos:** ¿por rol (como hoy in-app), por involucrados del
   proyecto, o ambos según el evento? El usuario define.

---

## 5. Orden propuesto (una vez aprobada la arquitectura)

1. Base común: render de variables + `mailer.py` con adjuntos + `correo_log` + helper PDF.
2. **Manual (5B):** endpoint enviar-informe + modal + marcador/historial. Probable con
   dominio de prueba a correo propio.
3. **Automático:** extender matriz de eventos con canal correo + panel "Envío automático"
   + enganchar `crear_notificacion` para que, además del in-app, dispare correo si está activo.
4. Smoke test integral por evento y manual.

> Sin el paso 1 (base común bien diseñada), construir el manual aislado obliga a rehacerlo
> al llegar al automático. Por eso se diseña el modelo completo primero, aunque se
> implemente por etapas.
