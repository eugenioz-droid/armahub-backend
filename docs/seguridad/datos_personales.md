# ArmaHub — Inventario de datos personales (registro de actividades de tratamiento)

*Base para cumplimiento Ley 21.719 (vigencia 1-dic-2026). Actualizado: 2026-08-06.*

## Qué datos personales existen hoy

| Dato | De quién | Dónde vive | Para qué | Quién accede |
|---|---|---|---|---|
| Nombre, apellido, email | usuarios internos (planta) | tabla `users` (Supabase) | identificación, login, asignación de trabajo | admins; el resto ve nombre/área en dropdowns |
| Hash de contraseña (PBKDF2) | usuarios internos | tabla `users` | autenticación | nadie (solo verificación) |
| Registro de acciones (audit_log) | usuarios internos | tabla `audit_log` | trazabilidad de operaciones | admins |
| Email de contacto | calculistas / constructoras (empresas) | tablas `calculistas`, `constructoras` | gestión de proyectos | usuarios autenticados |
| Emails de notificación | responsables de reclamos | config de plantillas | avisos por correo | admins |

**No se tratan:** datos sensibles (salud, biometría, etc.), datos de menores, datos financieros
personales, geolocalización.

## Módulos futuros que SUMARÁN datos personales (diseñar cumpliendo)

| Módulo (fase) | Datos nuevos | Cuidado principal |
|---|---|---|
| Pre-armado: asistencia (M4) | asistencia/turnos de trabajadores | datos laborales → minimizar, definir retención, informar a trabajadores |
| App clientes: protocolos (M5) | nombres y FIRMAS de cliente e ITO, fotos de terreno | consentimiento, retención de PDFs, acceso restringido por obra |
| CRM / leads (M6) | contactos comerciales, seguimiento | base de licitud, derecho de supresión (borrar un lead debe ser posible) |

## Derechos ARCO (acceso, rectificación, cancelación, oposición) — cómo se atienden hoy
- Acceso/rectificación: un admin puede ver y editar nombre/apellido/email desde el panel Admin.
- Supresión: un admin puede eliminar el usuario (DELETE); el audit_log conserva acciones por
  interés legítimo de trazabilidad (evaluar plazo de retención — pendiente C.2).
- Portabilidad: exportable vía consulta (no hay autoservicio; volumen de titulares es bajo).

## Transferencia internacional
Los datos se alojan en EE.UU. (Render/Supabase/R2/Resend). La Ley 21.719 permite transferencia
con garantías adecuadas → cubierto vía DPAs estándar de cada proveedor (acción C.4: archivarlos).

## Responsable
- Responsable del tratamiento: [completar razón social].
- DPO / encargado designado: Eugenio Zalazar (propuesto — confirmar).
