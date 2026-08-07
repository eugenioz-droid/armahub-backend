# ArmaHub — Plan de remediación de seguridad

*Resultado de auditoría interna (3 revisiones paralelas, 2026-08-06) y estado de remediación.
Para presentar a Seguridad Informática. Detalle de ejecución: `docs/programa_maestro.md`.*

## Hallazgos y estado

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| C1 | Secreto JWT con valor por defecto si faltaba la variable de entorno | Crítica | ✅ Corregido (M0.1: fail-fast, la app no arranca sin secreto real) |
| C2 | Endpoint de registro público abierto | Crítica | ✅ Corregido (M0.2: deshabilitado; cuentas solo por admin) |
| C3 | Aplicación legacy en la raíz del repo (código muerto con endpoints inseguros) | Crítica | ✅ Corregido (M0.4: eliminada; verificado que producción no la ejecuta) |
| C4/C5 | Scope por obra desactivado (todo usuario autenticado ve todas las obras) | Alta | 🔶 Programado (fase M2, antes de incorporar usuarios externos) |
| A1 | Tokens JWT sin expiración | Alta | ✅ Corregido (M0.3: expiración 8h + renovación silenciosa) |
| A3 | Sin rate limit en login; sin security headers | Alta | ✅ Corregido (M0.5/M0.7) |
| A4 | /health exponía detalles internos (mensajes de error, nombres de recursos) | Media | ✅ Corregido (M0.6) |
| A5+ | Mensajes de error 500 exponían tipo/estructura de excepciones internas | Media | ✅ Corregido (M0.8: mensaje genérico, detalle solo en logs) |
| M9 | Fallos del registro de auditoría eran silenciosos | Baja | ✅ Corregido (M0.9) |
| — | Inyección SQL | — | ✅ Sin hallazgos (SQL parametrizado + whitelists; verificado en auditoría) |
| — | Secretos en repositorio o frontend | — | ✅ Sin hallazgos |

## Compromisos siguientes (roadmap)

| Ítem | Fase | Cuándo |
|---|---|---|
| Autorización estricta por obra (multi-tenant) | M2 | antes de usuarios externos |
| Entorno de staging separado de producción | I.1 | previo a M2 |
| Backups automáticos/PITR de BD | I.2 | corto plazo |
| WAF/rate limit perimetral (Cloudflare) + monitoreo (Sentry/UptimeRobot) | I.4 | corto plazo |
| MFA para cuentas admin | evaluación | con portal de clientes (M5) |
| Pentest externo | evaluación | post M2 |
| Cumplimiento Ley 21.719 (registro en docs/compliance/) | C | continuo, vigencia dic-2026 |
