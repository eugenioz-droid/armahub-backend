# Auditoría — impacto del cambio de roles (cubicador → miembro) en Cubicación

**Contexto:** al migrar el rol `cubicador` a `miembro` + área, el módulo Cubicación
(legacy, que valida `role === 'cubicador'`) quedó con checks desalineados. Esta
auditoría lista TODO lo afectado, clasificado por impacto. Diagnóstico 2026-06-18.

> Dato clave verificado: la migración 71 (backfill de roles) tocó SOLO `area_usuarios`,
> NO `proyecto_usuarios`. Las asociaciones usuario↔obra en `proyecto_usuarios` siguen
> intactas. Y `_puede_editar_proyecto` decide por PERTENENCIA a `proyecto_usuarios`,
> NO por rol → un miembro asociado a su obra SÍ puede editarla.

---

## A. BUGS que rompen una acción (prioridad)

### A.1 — Eliminar carga AJENA requiere estar en proyecto_usuarios (reporte del usuario)
- `delete_carga` (barras.py:986): permite borrar si `_puede_editar_proyecto` **O** eres el uploader.
- Para borrar carga de OTRA persona: necesitas editar el proyecto = estar en `proyecto_usuarios` de esa obra.
- **¿Es bug?** Depende del modelo deseado. Hoy: solo quien está autorizado en la obra
  (o el propio uploader) borra cargas. Un miembro NO autorizado a esa obra no puede.
  Esto NO lo rompió el cambio de rol (la lógica es por pertenencia, no por rol). Pero SÍ
  puede sentirse como regresión si antes los cubicadores tenían acceso más amplio.
- **Decisión pendiente del usuario:** ¿los miembros del área Cubicaciones deben poder
  borrar cargas de CUALQUIER obra de cubicación, o solo de las que están autorizados?

### A.2 — Eliminar OBRA con barras: check legacy `role == 'cubicador'`
- `barras.py:1648`: `if role == 'cubicador' and barras_count > 0 → 403`.
- Rol muerto → esta protección NO se aplica a `miembro`. Un miembro con acceso podría
  borrar una obra CON barras (antes bloqueado). **Riesgo de borrado indebido.**
- **Fix:** cambiar `cubicador` → `miembro` (y/o basar en permiso real, no rol).

---

## B. DASHBOARDS / MÉTRICAS que quedan vacías o no se ven (rol muerto)

### B.1 — Landing "Cubicado semana" no visible para miembro
- `barras.py:1842`: `if role in (admin, admin_calidad, cubicador)` → miembro NO lo ve.

### B.2 — Métrica de kilos filtra `WHERE u.role = 'cubicador'` → vacía
- `barras.py:1851`: cuenta solo usuarios rol cubicador (ya no existen) → **dato vacío**.
- `barras.py:1434`: `WHERE pu.rol = 'cubicador'` (lista de cubicadores por proyecto) → vacía.

### B.3 — "Reclamos levantados semana" excluye a miembro
- `barras.py:1872, 1874`: incluye `cubicador/externo`, no `miembro`.

### B.4 — Vista de estados de reclamos: rama `elif role == 'cubicador'`
- `barras.py:1917`: miembro no entra en esa rama.

---

## C. FRONTEND (cubicación)

- `obras.js:348`: borrar obra vacía ya migrado a `miembro` (OK).
- `obras.js:1312`: check `admin/admin_calidad` para barras — revisar si miembro debe entrar.
- Colores de rol (`rolColors`) incluyen `cubicador` — cosmético, sin impacto.

---

## D. Código de depuración a limpiar (no es bug, es higiene)
- `_puede_editar_proyecto` (barras.py:35-50): tiene varios `print(...)` de debug en
  producción. Limpiar.

---

## RESUELTO (2026-06-18, decisiones del usuario)
- **A.1 borrar carga:** ahora SOLO el uploader (o admin) puede borrar cada carga (antes
  bastaba estar autorizado en la obra). `delete_carga` y `bulk_delete_cargas` corregidos.
  Se flexibilizará más adelante.
- **Aviso faltante (bug del "no avisa"):** `bulk_delete_cargas` omitía en silencio las
  cargas sin permiso (parecía que se borraban). Ahora devuelve `sin_permiso` y el front
  muestra "⚠️ N carga(s) no se eliminaron: solo puedes borrar las que tú subiste".
- **A.2 eliminar obra con barras:** ahora SOLO admin/admin_calidad (antes check muerto
  `role=='cubicador'` no aplicaba a miembro → riesgo de borrado indebido).
- **B dashboards:** "Cubicado semana" y "Reclamos semana" migrados de `cubicador`→`miembro`;
  el filtro de kilos ya no exige rol muerto (contaba vacío). Responsable de proyecto incluye
  `miembro`.
- **D higiene:** removidos los `print()` de debug de `_puede_editar_proyecto` y bulk-delete.
- **Crear obra:** confirmado por el usuario que restringir a admin fue intencional. Se queda.

**Pendiente futuro:** flexibilizar borrado de cargas (quién puede borrar ajenas) cuando
exista el panel de administración de obras.
