# Propuesta — Sistema de correo de ArmaHub (tarea 5B y más allá)

**Estado:** PROPUESTA para discusión. No implementar hasta acordar. Pediste un plan
antes de construir porque 5B se cruza con piezas que aún no existen (gestión de
involucrados por proyecto, panel de correos automáticos).

> Base ya existente (verificado 2026-06-16): helper `mailer.py` (Resend) operativo
> (4.5/4.6 ✓, solo HTML, sin adjuntos aún); PDF de informe en `/reclamos/{id}/pdf`
> vía `_ReclamoPDF().build()`; tabla `proyecto_usuarios` (usuario↔proyecto+rol) ya
> en BD, sin UI de gestión todavía.

---

## 1. Cómo funcionan estos sistemas (referencia de industria)

Los sistemas de notificación por correo en plataformas SaaS suelen separar dos cosas:

**A. Correos transaccionales / manuales (acción del usuario):**
- Se disparan por una acción concreta (ej. "Enviar informe a cliente").
- El usuario elige destinatarios y confirma. Lleva adjunto si aplica (el PDF).
- Se registra trazabilidad: a quién, cuándo, qué se envió, estado (enviado/falló).
- Marcador visible de "ya enviado" en la entidad.

**B. Correos automáticos (disparados por eventos del sistema):**
- Reglas tipo "cuando pasa X, notificar a Y" (ej. reclamo asignado → avisar responsable).
- Configurables: activar/desactivar por tipo de evento y por rol (ArmaHub YA tiene
  el embrión de esto: la matriz de notificaciones in-app por rol/evento).
- Plantillas de correo reutilizables.
- Un panel de administración centraliza qué eventos envían correo y a quién.

ArmaHub debería tener AMBOS, separados: 5B es el caso **A** (envío manual del informe).
El caso **B** (automáticos + panel) es una caluga aparte, futura.

---

## 2. Propuesta para 5B — Envío manual del informe validado

**Quién:** solo `admin`/`admin_calidad` por ahora (decisión del usuario).

**Cuándo:** el botón "Enviar" se habilita cuando el reclamo está **validado/cerrado**
(el informe ya tiene valor; no se manda un análisis a medias). A confirmar: ¿solo en
`cerrado`, o también en `validacion`?

**Flujo propuesto:**
1. Admin abre el reclamo → botón "📧 Enviar informe".
2. Se abre un **mini-modal de destinatarios**:
   - Pre-carga **todos los involucrados del proyecto** (`proyecto_usuarios` del
     `id_proyecto` del reclamo) con su correo, **todos tildados por defecto**.
   - El admin puede **destildar** los que no quiera.
   - Puede **agregar correos manuales** (un campo libre adicional).
   - Si el reclamo no tiene proyecto o el proyecto no tiene involucrados → solo campo manual.
3. Confirma → backend genera el PDF (reutiliza `_ReclamoPDF`), lo **adjunta** y envía
   vía Resend a los destinatarios elegidos.
4. Se registra el envío y se marca el reclamo como "informe enviado" (con fecha).
5. El detalle muestra el **historial de envíos** (a quién, cuándo, por quién, estado).

**Lo que hay que construir para 5B:**
| Pieza | Detalle |
|---|---|
| `mailer.py`: soporte de **adjuntos** | Resend acepta `attachments` (base64). Extender `send_email(..., attachments=[])`. |
| Tabla `reclamo_envios` | trazabilidad: reclamo_id, enviado_por, destinatarios, fecha, estado, message_id. |
| Endpoint `POST /reclamos/{id}/enviar-informe` | valida permiso+estado, genera PDF, envía, registra. Body: lista de correos. |
| Endpoint `GET /reclamos/{id}/involucrados` | correos sugeridos desde `proyecto_usuarios` (para pre-cargar el modal). |
| UI: mini-modal de destinatarios | checklist de involucrados + campo manual + botón enviar. |
| UI: marcador "enviado" + historial | badge en detalle/lista + lista de envíos en el detalle. |
| Helper PDF reutilizable | extraer la generación del endpoint `/pdf` a una función que ambos usen. |

**Dependencia parcial:** la pre-carga de involucrados depende de que `proyecto_usuarios`
tenga datos. Hoy la tabla existe pero no hay UI para poblarla. **Mitigación:** 5B
funciona igual con el campo de correos manual; los sugeridos aparecen cuando el
proyecto tenga involucrados cargados (cuando se construya esa gestión).

---

## 3. Propuesta para el futuro — Caluga "Comunicaciones / Correo"

(NO es 5B; es una caluga propia más adelante, probablemente cerca de Fase 10 Admin
o como módulo transversal.)

- **Panel de administración de correo** (un tab): ver plantillas, eventos que disparan
  correo, activar/desactivar por evento, log de todos los correos enviados.
- **Plantillas** reutilizables (asunto + cuerpo con variables).
- **Reglas de eventos → correo** (automáticos): reusar/expandir la matriz de
  notificaciones que ya existe (hoy in-app), agregando el canal "correo".
- **Log centralizado** de envíos (la tabla `reclamo_envios` sería un caso; lo
  general sería una tabla `correo_log` transversal).

---

## 4. Decisiones pendientes antes de implementar 5B

1. ¿El botón "Enviar" se habilita solo en `cerrado`, o también en `validacion`?
2. ¿El asunto/cuerpo del correo del informe — texto fijo institucional, o editable
   por el admin antes de enviar?
3. ¿`MAIL_FROM` definitivo? (hoy puede estar en `onboarding@resend.dev` de prueba;
   para enviar a clientes reales necesita dominio verificado en Resend, ej.
   `calidad@armacero.cl`). **Esto es un prerrequisito real para enviar a externos.**
4. ¿Reply-to apuntando al correo del admin que envía, para que el cliente responda
   a una persona y no a un noreply?

---

## 5. Orden sugerido de implementación (cuando se apruebe)

1. Verificar/definir `MAIL_FROM` con dominio verificado (prerrequisito externo).
2. `mailer.py`: soporte de adjuntos.
3. Extraer generación de PDF a helper reutilizable.
4. Tabla `reclamo_envios` (migración).
5. Endpoints: `enviar-informe` + `involucrados`.
6. UI: mini-modal + marcador + historial.
7. Smoke test: validar reclamo → enviar → llega correo con PDF → marcador y historial OK.
