# Auditoría Fase 2 — Riesgos antes de migrar

> **Generado:** 2026-06-09 por AuditorArmaHub.
> **Alcance:** revisión de seguridad backend, consistencia de permisos, compatibilidad con
> container e inventario de accesos a archivos/BYTEA. NO se modificó código — solo auditoría.
> **Criterio de salida (tarea 2.8 del programa):** tener un mapa de riesgos antes de la migración.

---

## Resumen ejecutivo

El backend está **más maduro de lo esperado en autorización**: Reclamos tiene un patrón sólido de
ownership en editar/eliminar/presentar y filtro por rol en listados (`build_role_filter`). El código
**ya trabaja en memoria** (no escribe a disco local), lo que hace la migración a container **de bajo
riesgo**. Pero hay **3 hallazgos de seguridad reales** que deben corregirse, dos de ellos **antes de
abrir acceso a clientes externos**.

Semáforo de migración:
- 🟢 **Compatibilidad con container (Cloudflare):** baja fricción. No hay escritura a disco local.
- 🟡 **Seguridad:** 3 hallazgos a corregir (1 alto, 2 medios). No bloquean la migración técnica, pero el #1 sí debe cerrarse pronto.
- 🟢 **Storage/BYTEA:** inventario claro y acotado (5 puntos de toque para R2).

---

## 🔴 Hallazgos de seguridad

### H1 (ALTO) — Imágenes de reclamos accesibles SIN autenticación
- **Dónde:** `reclamos.py:1671` — `GET /reclamos/{reclamo_id}/imagenes/{imagen_id}` (`ver_imagen`).
- **Qué:** el endpoint NO tiene `Depends(get_current_user)`. Cualquiera con la URL (sin login) puede
  ver cualquier imagen de cualquier reclamo, probando IDs secuenciales (1, 2, 3...).
- **Riesgo:** fuga de evidencia/fotos de reclamos a no autenticados. Las imágenes pueden contener
  información sensible de obras/clientes.
- **Por qué existe:** se hizo público para poder mostrar `<img src="...">` directo en el navegador.
- **Corrección:** exigir autenticación + validar que el usuario tenga permiso sobre ese reclamo.
  Para `<img>` sin header Authorization, usar URL firmada temporal (esto encaja con la migración a R2
  y presigned URLs, tarea 3.5).

### H2 (MEDIO) — Detalle de reclamo sin filtro de ownership (IDOR)
- **Dónde:** `reclamos.py:960` — `GET /reclamos/{reclamo_id}` (`get_reclamo_optimizado`).
- **Qué:** está autenticado, pero NO aplica `build_role_filter`. Cualquier usuario logueado puede leer
  el detalle COMPLETO de cualquier reclamo pasando el ID, aunque el listado (`GET /reclamos`) sí filtre
  por rol. Inconsistencia: el listado oculta, el detalle expone.
- **Riesgo:** un cubicador/externo puede ver reclamos que no le corresponden conociendo el ID.
- **Corrección:** aplicar el mismo filtro de ownership/rol del listado al detalle.

### H3 (MEDIO) — Eliminar imagen sin validar ownership
- **Dónde:** `reclamos.py:1692` — `DELETE /reclamos/{reclamo_id}/imagenes/{imagen_id}`.
- **Qué:** autenticado, pero cualquier usuario puede borrar imágenes de cualquier reclamo (no valida
  que sea propio ni el rol). Ya estaba parcialmente previsto en tarea 6.1 del programa.
- **Corrección:** validar ownership/rol antes de borrar (consistente con editar/eliminar reclamo).

> **Nota:** H1 y H2 deben cerrarse **antes de la mini-revisión de seguridad de la tarea 9.12**
> (apertura a clientes externos). H1 conviene cerrarlo cuanto antes por ser acceso anónimo.

---

## 🟢 Lo que está BIEN (no tocar)

- **Ownership maduro en Reclamos:** editar (1203/1211), eliminar (1428), presentar (880) validan
  reclamo propio; listados usan `build_role_filter` (473/713/787).
- **Auth sólida:** `get_current_user` lee el rol **fresco de la BD** en cada request (evita desync
  JWT/BD). Login valida usuario activo. Passwords con `pbkdf2_sha256` (passlib).
- **Gestión de usuarios bien protegida:** admin2 no puede tocar admin/admin2 ni auto-modificarse
  (auth.py 277-302, 320, 355). Bootstrap solo si no hay usuarios.
- **Sin secretos hardcodeados** (salvo el default `JWT_SECRET="dev-secret-change-me"` — ver R-INFRA).
- **SQL parametrizado** en todo lo revisado (sin concatenación de strings en queries).

---

## 🟢 Compatibilidad con container (tarea 2.3)

**Resultado: baja fricción para migrar a Cloudflare.**

- ✅ NO hay escritura a disco local: exportación Excel (`export.py:217`) y PDF (`reclamos.py:2149`)
  usan `BytesIO()` en memoria. ZIP de exportación igual.
- ✅ StaticFiles sirve desde `armahub/static/` (parte de la imagen, no escritura).
- ⚠️ **Único punto a verificar:** las **imágenes en BYTEA** (ver abajo) deben migrarse a R2 ANTES o
  DURANTE el cutover, porque hoy viven en la BD — al migrar la BD a Supabase se irían igual, pero
  conviene sacarlas a R2 primero para no inflar Supabase.

---

## 🟢 Inventario de accesos a imágenes/BYTEA (tarea 2.4)

Puntos exactos que tocará la migración a R2 (tareas 3.4–3.7). Acotado y manejable:

| # | Ubicación | Operación | Acción en R2 |
|---|-----------|-----------|--------------|
| 1 | `db.py:394` | Tabla `reclamo_imagenes` con `data BYTEA NOT NULL` | Agregar `storage_key`, dejar BYTEA nullable, luego eliminar |
| 2 | `reclamos.py:1652` | INSERT imagen (subir) | Subir a R2, guardar `storage_key` |
| 3 | `reclamos.py:1671-1689` | `ver_imagen` (lee `bytes(row[0])`) | Servir desde R2 / presigned URL |
| 4 | `reclamos.py:2121-2129` | PDF lee `bytes(img["data"])` para embeber | Leer desde R2 |
| 5 | `reclamos.py:1652-1698` | Subir/eliminar | Eliminar también de R2 |

No hay otros usos de BYTEA fuera de `reclamo_imagenes`. El alcance está contenido a Reclamos.

---

## Consistencia ROLES_Y_PERMISOS.md ↔ código (tarea 2.2)

**Resultado: el documento es FIEL al código.** Se verificaron los puntos de mayor riesgo y todos coinciden:

| Afirmación del documento | Verificado en código | ¿Coincide? |
|--------------------------|----------------------|------------|
| Pedidos/calculistas/constructoras = solo admin/admin2 (3e) | `require_admin_or_admin2` en todos los CRUD | ✅ |
| Reset DB / limpiar tabla = solo admin, NO admin2 (3b) | `reset-db` y `tables/clear` usan `require_admin` | ✅ |
| Ver DB-info / auditoría = admin y admin2 (3b) | `db-info` y `audit` usan `require_admin_or_admin2` | ✅ |
| `GET imagenes` sin auth (obs. 2) | Confirmado = H1 | ✅ (es el bug) |
| Eliminar imagen/acción sin ownership (obs. 5) | Confirmado = H3 | ✅ (es el bug) |
| `numero_calidad` editable por cualquier rol salvo cliente (obs. 6) | No está en REGISTRO/ANALISIS_FIELDS | ✅ (decisión abierta, tarea 6.x del programa) |

**Consistencia frontend (registry.js) ↔ doc tabla 1a — verificado 2026-06-10:**
- Cubicación: código `admin, admin2, cubicador, cliente` = doc ✅
- Reclamos: código `admin, admin2, cubicador, usc, externo` = doc ✅
- Admin: código `admin, admin2` = doc ✅
- Las tres capas (doc ↔ backend ↔ frontend) son consistentes. Tarea 2.2 cerrada completa.

**Observaciones positivas:**
- El documento es **honesto sobre sus propias debilidades**: ya lista H1 (obs. 2) y H3 (obs. 5) como pendientes
  conocidos. Esto valida los hallazgos de la auditoría: no son sorpresas, son deuda reconocida sin cerrar.
- `clear_table` interpola `table_name` en SQL, **pero** valida contra lista blanca `CLEARABLE` antes de ejecutar
  (`admin.py:128`) y las queries son literales. **No hay inyección SQL.**
- El documento está actualizado con cambios recientes (notificaciones 3f, año/número calidad, mover/bulk cargas).

**Acción:** ninguna corrección de inconsistencia necesaria. La única deuda es cerrar H1/H3 (ya en el programa) y
decidir el tema `numero_calidad` (obs. 6 → evaluar en hardening Fase 6A).

---

## Riesgos de infraestructura para la migración (tarea 2.8)

- **R-INFRA1:** `JWT_SECRET` tiene default `"dev-secret-change-me"`. En producción DEBE venir de env var
  segura en Cloudflare (tarea 3.15). Verificar que esté seteado antes del cutover, o todas las sesiones
  serían falsificables.
- **R-INFRA2:** `CORS_ORIGINS` se lee de env var (bien). Confirmar que liste el dominio de Cloudflare
  tras migrar (hoy probablemente apunta a Render).
- **R-INFRA3:** dependencias pesadas (`pandas`, `openpyxl`, `psycopg[binary]`, `fpdf2`) deben validarse
  en el build del container (tarea 3.16/3.18). Riesgo medio, mitigado por usar container (no Workers puro).
- **R-INFRA4:** la migración de imágenes BYTEA→R2 (tarea 3.6) debe correr ANTES del `pg_dump` a Supabase
  para no arrastrar binarios pesados a la nueva BD. Ajustar orden si es necesario.

---

## Acciones recomendadas (se incorporan al programa)

| Hallazgo | Tarea destino en el programa |
|----------|------------------------------|
| H1 (imágenes sin auth) | Adelantar a Fase 3 (3.5, al refactorizar lectura de imágenes a R2 con presigned URL) |
| H2 (detalle sin ownership) | Fase 6A hardening (nueva tarea 6.x) |
| H3 (eliminar imagen sin ownership) | Ya en tarea 6.1 |
| R-INFRA1 (JWT_SECRET) | Ya en tarea 3.15 — marcar como crítico |
| R-INFRA4 (orden BYTEA→R2 antes de Supabase) | Nota en Fase 3 |

Criterio de salida Fase 2 cumplido: tenemos mapa de riesgos, sabemos que el estado actual es
migrable con baja fricción, y sabemos qué NO tocar sin pruebas (el patrón de ownership existente).
