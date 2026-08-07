# ArmaHub — Arquitectura y flujo de datos (carpeta de seguridad)

*Preparado para revisión con Seguridad Informática. Actualizado: 2026-08-06.*

## Diagrama (texto)

```
Usuario (navegador, HTTPS/TLS 1.2+)
   │
   ▼
Render.com (servicio web, EE.UU.)
   FastAPI (Python) — armahub.main:app
   │  ├── Autenticación JWT (HS256, expiración 8h, renovación silenciosa)
   │  ├── Autorización por rol (admin / admin_calidad / jefe_servicio / miembro / usc / …)
   │  └── Registro de auditoría (tabla audit_log: quién, qué, cuándo)
   │
   ├──► Supabase (PostgreSQL gestionado) — datos de negocio y usuarios
   │       cifrado en reposo (AES-256, provisto por Supabase) y en tránsito (TLS)
   ├──► Cloudflare R2 (object storage) — imágenes/archivos adjuntos
   │       cifrado en reposo (provisto por Cloudflare), acceso por credenciales S3
   └──► Resend — envío de correo transaccional (notificaciones)
```

No hay otros flujos de salida. No se usan trackers ni analytics de terceros.

## Autenticación y acceso
- Login con email + contraseña. Hash de contraseñas: PBKDF2-SHA256 (passlib).
- Tokens JWT HS256 firmados con secreto de entorno (la app NO arranca sin él), expiración 8 horas.
- Registro público DESHABILITADO: las cuentas las crea únicamente un administrador.
- Rate limit en login: 5 intentos por IP por minuto.
- Roles con capacidades diferenciadas; acciones administrativas restringidas a admin/admin_calidad.
- Pendiente en roadmap (fase M2): scope estricto por obra para usuarios externos; MFA en evaluación.

## Protecciones aplicadas (fase M0, ago-2026)
- Security headers: X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, HSTS.
- Endpoint /health sin detalles internos; errores 500 con mensaje genérico (detalle solo en logs).
- SQL 100% parametrizado (psycopg); campos dinámicos validados contra whitelists (verificado en auditoría interna, sin hallazgos de inyección).
- Secretos exclusivamente en variables de entorno de Render (no hay secretos en el repositorio ni en el frontend).

## Datos personales tratados
Ver `datos_personales.md` (inventario) — resumen: nombre, apellido, email y rol de usuarios
internos; registros de auditoría de sus acciones. No se tratan datos sensibles ni de menores.

## Subprocesadores
| Servicio | Rol | Ubicación | Certificaciones publicadas |
|---|---|---|---|
| Render.com | hosting app | EE.UU. | SOC 2 Type II |
| Supabase | BD PostgreSQL | EE.UU./UE (según proyecto) | SOC 2 Type II, DPA disponible |
| Cloudflare R2 | archivos | red global | ISO 27001, SOC 2, DPA disponible |
| Resend | correo | EE.UU. | DPA disponible |

## Respaldo y continuidad
- Migraciones de BD idempotentes y versionadas en el repositorio (reconstrucción de esquema reproducible).
- En curso (fase I del programa): plan de BD con backups automáticos/PITR y entorno de staging.
- Código fuente en GitHub (repositorio privado) — historial completo.

## Gestión de vulnerabilidades y roadmap
- Auditoría interna de seguridad realizada (ago-2026) con plan de remediación por fases
  (programa maestro M0-M2): ver `plan_remediacion.md`.
- Ley 21.719: registro de cumplimiento en `docs/compliance/ley21719.md` (vigencia dic-2026).
