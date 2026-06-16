# Inventario de residuales legacy "cubicador" (tarea 5J.1)

**Propósito:** red anti-regresión para la depuración del rol legacy `cubicador`
(tareas 5J.2–5J.6). Clasifica las ~374 ocurrencias en 33 archivos por riesgo, para
saber qué se arregla, qué se limpia y qué NO se toca.

> Congelado 2026-06-16. Verificado leyendo el código. Estado usuarios: 0 con rol
> `cubicador` (todos migrados a `miembro`); rol `externo` sigue vivo (2 usuarios).
> Roles vivos: admin, admin_calidad, cliente, miembro, externo.

---

## Clasificación por grupo

### Grupo C — NO TOCAR (nombres internos BD/API)
La columna BD `cubicador_asignado` y sus lecturas/escrituras son el contrato de datos.
Renombrarla es la tarea separada **5J.7** (migración de esquema), NO parte de 5J.2–5J.6.
- `reclamos.py`: `cubicador_asignado` en INSERT/SELECT/PATCH (columna real).
- `reclamos_queries.py:158`: `r.cubicador_asignado` (columna en WHERE).
- `helpers.js:84,94`: `detail.cubicador_asignado` (campo del JSON de la API).
- `helpers.js:141`: `cubicador_nombre` (campo derivado).
- Modelos `ReclamoIn`/`ReclamoUpdate`: campo `cubicador_asignado`.
- **Regla:** estos se mantienen tal cual hasta 5J.7.

### Grupo B — RIESGO / BUG ACTIVO (rol usado SOLO, sin `miembro`)
Código que depende del rol muerto `cubicador` → hoy falla en silencio o cambia comportamiento.

**B.1 — KPIs/dashboards rotos (devuelven vacío):**
- `reclamos.py:742,767`: `WHERE u.role = 'cubicador' AND r.respuesta_por IS NOT NULL` → KPI "por cubicador" y "kilos por cubicador" vacíos.
- `reclamos.py:959`: `FROM users WHERE role = 'cubicador' AND activo = TRUE` → lista de cubicadores vacía.
- `dashboards.js:480,518`: consumen `por_cubicador_asignado` / `kilos_por_cubicador` (vacíos por lo anterior).
- **Fix (5J.2):** contar **miembros del área Cubicaciones** (vía `area_usuarios` + área), no `role='cubicador'`.

**B.2 — caché "ve todo" excluye a quien debería:**
- `reclamos.py:147,1189`: `role in ("admin","admin_calidad","cubicador")` para usar caché/ver todo. Hoy ningún cubicador entra; revisar si miembro/jefe_servicio debe.
- **Decisión (5J.2/5J.3):** definir si la caché aplica a miembro.

**B.3 — UI condicionada a rol muerto:**
- `dashboards.js:337`: `currentRole === 'cubicador'` → badge de tareas pendientes nunca aparece.
- `dashboards.js:26`: sub-tab Presentaciones `roles:[...'cubicador','externo']` SIN `miembro` → miembros no ven Presentaciones.
- `registry.js:75`: módulo Cubicación `allowedRoles:[...'cubicador'...]` SIN `miembro` → **verificar si miembros de Cubicaciones pueden entrar al módulo**.
- **Fix (5J.3):** reemplazar/añadir `miembro` según el comportamiento deseado.

**B.4 — visibilidad de reclamos (DECISIÓN, no rename):**
- `reclamos_queries.py:157-159`: `cubicador/externo` ven "donde son responsables"; `jefe_servicio/miembro` ven "todos los de su área". Son **semánticas distintas**. Al migrar cubicador→miembro, su visibilidad cambió de "mis reclamos" a "todos los de mi área".
- **Requiere decisión del usuario (5J.3/5J.5):** ¿es el comportamiento deseado o un efecto colateral?

### Grupo A — código muerto inofensivo (rol JUNTO a `miembro`)
`cubicador` aparece junto a `miembro` en checks de permisos → los usuarios ya entran por `miembro`; quitar `cubicador` es cosmético, sin cambio funcional.
- `reclamos.py:390,648,924,998,1072,1092,1465,1847,1864,1920,1942,1980,2539`: tuplas `("cubicador","externo","miembro","jefe_servicio")` o similares.
- `detail-permissions.js:30,38,110,111,140,141,154`: arrays `['cubicador','externo','miembro','jefe_servicio']`.
- **Fix (5J.3):** quitar `'cubicador'` de estas listas. Validar permisos por rol tras cada tanda.

### Catálogo del rol (decisión 5J.5)
- `auth.py:82,119,243`: `ROL_MAP`, `VALID_ROLES` incluyen `cubicador`.
- `admin.py:498`: `VALID_ROLES_CONFIG` incluye `cubicador`.
- `registry.js`: `allowedRoles` con `cubicador`.
- **Decisión (5J.5):** retirar `cubicador` del catálogo de roles asignables, o dejarlo como alias inactivo. Solo tras cerrar B y A.

### Labels visibles (5J.4)
- Opciones del select "Detectado por" (`reclamos.html:156,234,341`): valor `Cubicador`. **Es taxonomía de "quién detectó", NO el rol** → evaluar aparte; puede tener data histórica.
- Otros textos "Cubicador" visibles ya limpiados en sesión 16-jun (label responsable).
- **Fix (5J.4):** revisar caso por caso; no tocar valores con data guardada sin plan.

---

## Orden de ejecución recomendado
1. **5J.2** (bug activo B.1/B.2): restaura KPIs. Mayor valor, contenible.
2. **5J.3** (A + B.3): limpiar código muerto y arreglar UI; incluye decisión B.4 (visibilidad).
3. **5J.4** (labels): cosmético.
4. **5J.5** (catálogo rol): retiro o alias.
5. **5J.6** (validación): smoke por rol + dashboards con datos.
6. **5J.7** (futuro): rename columna BD.

## Checklist validación (5J.6)
- [ ] KPIs de cubicador/kilos muestran datos (miembros de Cubicaciones).
- [ ] Miembro de Cubicaciones: ve módulo Cubicación, Presentaciones, badge pendientes (si aplica).
- [ ] Visibilidad de reclamos por rol = la decidida en B.4.
- [ ] Permisos sin cambios para admin, admin_calidad, cliente, externo.
- [ ] Externo sigue funcionando (rol vivo, no se toca su lógica salvo limpieza A).
