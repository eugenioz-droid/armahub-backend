# ArmaHub — Matriz de Roles y Permisos

Documento de referencia para visualizar qué ve y qué puede hacer cada rol.
Actualizado: 2025-07.

---

## 1. Acceso a Módulos y Tabs

### 1a. Módulos (calugas del Hub)

| Módulo (caluga)              | admin | admin2 | cubicador | usc   | externo | cliente |
| ---------------------------- |:-----:|:------:|:---------:|:-----:|:-------:|:-------:|
| Cubicación                   |  ✅   |   ✅   |    ✅     |   —   |    —    |   ✅    |
| Reclamos                     |  ✅   |   ✅   |    ✅     |  ✅   |   ✅    |    —    |
| Administración               |  ✅   |   ✅   |     —     |   —   |    —    |    —    |

> Definido en `registry.js` → `allowedRoles`.

### 1b. Tabs por módulo

| Módulo         | Tab              | admin | admin2 | cubicador | usc   | externo | cliente |
| -------------- | ---------------- |:-----:|:------:|:---------:|:-----:|:-------:|:-------:|
| **Cubicación** | Obras            |  ✅   |   ✅   |    ✅     |   —   |    —    |    —    |
| **Cubicación** | Metrics          |  ✅   |   ✅   |    ✅     |   —   |    —    |   ✅    |
| **Cubicación** | Bar Manager      |  ✅   |   ✅   |    ✅     |   —   |    —    |    —    |
| **Cubicación** | Pedidos          |  ✅   |   ✅   |    ✅     |   —   |    —    |    —    |
| **Cubicación** | Exportación      |  ✅   |   ✅   |    ✅     |   —   |    —    |    —    |
| **Reclamos**   | Reclamos         |  ✅   |   ✅   |    ✅     |  ✅   |   ✅    |    —    |
| **Admin**      | Admin            |  ✅   |   ✅   |     —     |   —   |    —    |    —    |

> El rol `cliente` dentro de Cubicación solo ve el tab **Metrics** (los demás se ocultan en frontend).
> Tab **Obras** es el default al entrar a Cubicación.
> Los roles sin acceso al módulo (—) no ven ningún tab de ese módulo.

---

## 2. Indicadores y Vistas Analíticas

### 2a. Landing (Hub principal)

| Indicador                    | admin    | admin2   | cubicador      | usc          | externo      | cliente |
| ---------------------------- |:--------:|:--------:|:--------------:|:------------:|:------------:|:-------:|
| Cubicado semanal (chart)     |    ✅    |    ✅    |      ✅        |      —       |      —       |    —    |
| Reclamos semana (chart)      |    ✅    |    ✅    |   ✅ propios   |  ✅ propios  |  ✅ propios  |    —    |
| Alertas reclamos             | ✅ todos | ✅ todos |   ✅ propios   |  ✅ propios  |  ✅ propios  |    —    |
| Resumen reclamos (mi-resumen)|    ✅    |    ✅    |   ✅ propios   |  ✅ propios  |  ✅ propios  |    —    |

### 2b. Metrics (tab Cubicación)

| Vista                        | admin | admin2 | cubicador | usc   | externo | cliente |
| ---------------------------- |:-----:|:------:|:---------:|:-----:|:-------:|:-------:|
| KPIs generales               |  ✅   |  ✅\*  |    ✅     | ✅\*  |  ✅\*   |   ✅    |
| Top 15 proyectos (chart)     |  ✅   |  ✅\*  |    ✅     | ✅\*  |  ✅\*   |   ✅    |
| Cubicadores (chart)          |  ✅   |  ✅\*  |    ✅     | ✅\*  |  ✅\*   |   ✅    |
| Cubicación mensual (chart)   |  ✅   |  ✅\*  |    ✅     | ✅\*  |  ✅\*   |   ✅    |

> \*Acceso API disponible pero sin card en el Hub.

### 2c. Reclamos — Vistas analíticas

| Vista                        | admin      | admin2     | cubicador  | usc        | externo    | cliente |
| ---------------------------- |:----------:|:----------:|:----------:|:----------:|:----------:|:-------:|
| Resumen General              | ✅ global  | ✅ global  | ✅ global  | ✅ propios | ✅ propios |    ✖    |
| Dashboards admin             |      ✅    |      ✅    |      ✖     |      ✖     |      ✖     |    ✖    |
| Presentaciones stats         | ✅ todos   | ✅ todos   | ✅ todos   |      ✖     | ✅ propios |    ✖    |

> `✖` = prohibido (403 en backend o sin acceso al módulo).
> **"propios"**: externo ve reclamos donde es `cubicador_asignado` o `respuesta_por`; usc ve donde es `creado_por` o `asignado_a`. Admin, admin2 y cubicador ven todo (global).

---

## 3. Permisos (Acciones) × Rol

### 3a. Autenticación y usuarios

| Acción                      | admin            | admin2         | cubicador | usc   | externo | cliente |
| --------------------------- |:----------------:|:--------------:|:---------:|:-----:|:-------:|:-------:|
| Login / cambiar password    |        ✅        |       ✅       |    ✅     |  ✅   |   ✅    |   ✅    |
| Registrar usuario           | ✅ cualquier rol | ✅ parcial¹    |     —     |   —   |    —    |    —    |
| Listar usuarios (admin)     |        ✅        |       ✅       |     —     |   —   |    —    |    —    |
| Cambiar rol de usuario      |        ✅        | ✅ parcial¹    |     —     |   —   |    —    |    —    |
| Activar/desactivar usuario  |        ✅        | ✅ parcial¹    |     —     |   —   |    —    |    —    |
| Resetear password de otro   |        ✅        | ✅ parcial¹    |     —     |   —   |    —    |    —    |
| Eliminar usuario            |        ✅        | ✅ parcial¹    |     —     |   —   |    —    |    —    |

> ¹ admin2 no puede operar sobre usuarios con rol `admin` ni `admin2`.

### 3b. Admin técnico

| Acción                              | admin | admin2 | cubicador | usc   | externo | cliente |
| ----------------------------------- |:-----:|:------:|:---------:|:-----:|:-------:|:-------:|
| Ver info DB                         |  ✅   |   ✅   |     —     |   —   |    —    |    —    |
| Reset DB                            |  ✅   |   —    |     —     |   —   |    —    |    —    |
| Ver tablas                          |  ✅   |   ✅   |     —     |   —   |    —    |    —    |
| Limpiar tabla                       |  ✅   |   —    |     —     |   —   |    —    |    —    |
| Ver auditoría                       |  ✅   |   ✅   |     —     |   —   |    —    |    —    |

### 3c. Proyectos y cargas (cubicación)

| Acción                              | admin  | admin2 | cubicador      | usc | externo | cliente |
| ----------------------------------- |:------:|:------:|:--------------:|:---:|:-------:|:-------:|
| Ver proyectos / barras              |   ✅   |   ✅   |      ✅        |  —  |    —    |   ✅†   |
| Crear proyecto                      |   ✅   |   ✅   |      ✅        |  —  |    —    |    —    |
| Editar proyecto                     |   ✅   |   ✅   |     ✅†        |  —  |    —    |    —    |
| Eliminar proyecto (vacío)           |   ✅   |   ✅   |     ✅†        |  —  |    —    |    —    |
| Importar CSV                        |   ✅   |   ✅   |      ✅        |  —  |    —    |    —    |
| Reimportar CSV (reemplaza carga)    |   ✅   |   ✅   |      ✅        |  —  |    —    |    —    |
| Exportar proyecto                   |   ✅   |   ✅   |      ✅        |  —  |    —    |    —    |
| Eliminar carga                      |   ✅   |   ✅   |  ✅† o propio  |  —  |    —    |    —    |
| Eliminar cargas (bulk)              |   ✅   |   ✅   |  ✅† o propio  |  —  |    —    |    —    |
| Mover cargas entre proyectos        |   ✅   |   ✅   |  ✅† o propio  |  —  |    —    |    —    |
| Autorizar usuario en proyecto       |   ✅   |   ✅   |     ✅†        |  —  |    —    |    —    |
| Ver cargas recientes                |   ✅   |   ✅   |      ✅        |  —  |    —    |   ✅    |
| Navegación sectores/pisos           |   ✅   |   ✅   |      ✅        |  —  |    —    |   ✅    |

> † Requiere estar autorizado en `proyecto_usuarios`. Admin/admin2 siempre tienen acceso.
> Reimportar CSV: ejecuta DELETE de barras del mismo `plano_code` antes del UPSERT, eliminando barras huérfanas.
> USC, externo no tienen acceso al módulo Cubicación. Cliente solo lectura (Metrics + ver proyectos filtrados).

### 3d. Reclamos

| Acción                              | admin      | admin2     | cubicador    | usc            | externo      | cliente |
| ----------------------------------- |:----------:|:----------:|:------------:|:--------------:|:------------:|:-------:|
| Ver listado reclamos                | ✅ todo    | ✅ todo    | ✅ propios*  | ✅ propios*    | ✅ propios   |    —    |
| Crear reclamo                       |     ✅     |     ✅     |      —       | ✅ auto-asigna |      —       |    —    |
| Asignar USC Responsable             | ✅ libre   | ✅ libre   |      —       | ✅ auto (bloq) |      —       |    —    |
| Asignar Cubicador Responsable       | ✅ libre   | ✅ libre   |      —       |  ✅ libre      |      —       |    —    |
| Editar registro (form básico)       |     ✅     |     ✅     |      —       | ✅ propios     |      —       |    —    |
| Editar análisis (form cubicador)    |     ✅     |     ✅     | ✅ propios   |       —        | ✅ propios   |    —    |
| Editar año calidad                  |     ✅     |     ✅     |      —       |       —        |      —       |    —    |
| Editar número calidad               |     ✅     |     ✅     |      ✅      |       ✅       |      ✅      |    —    |
| Validación resultado/observaciones  |     ✅     |     ✅     |      ✅      |       ✅       |      ✅      |    —    |
| Campos tiempo respuesta             |     ✅     |     ✅     | ✅ propios   |       —        | ✅ propios   |    —    |
| Eliminar reclamo                    |     ✅     |     ✅     |      —       | ✅ propios     |      —       |    —    |
| Agregar historial de modificaciones |     ✅     |     ✅     |      ✅      |       ✅       |      ✅      |    —    |
| Agregar acción correctiva           |     ✅     |     ✅     | ✅ propios   |       —        | ✅ propios   |    —    |
| Editar acción correctiva            |     ✅     |     ✅     |      ✅      |       ✅       |      ✅      |    —    |
| Eliminar acción correctiva          |     ✅     |     ✅     |      ✅      |       ✅       |      ✅      |    —    |
| Subir imágenes registro             |     ✅     |     ✅     |      —       |       ✅       |      —       |    —    |
| Subir imágenes análisis             |     ✅     |     ✅     |      ✅      |       —        |      ✅      |    —    |
| Eliminar imágenes                   |     ✅     |     ✅     |      ✅      |       ✅       |      ✅      |    —    |
| Presentar reclamo                   |     ✅     |     ✅     | ✅ propios   |       —        | ✅ propios   |    —    |
| Siguiente número calidad            |     ✅     |     ✅     |      ✅      |       ✅       |      ✅      |    —    |

> "Registro" = formulario básico (descripción, USC responsable, cubicador responsable, prioridad, id_calidad, observaciones, proyecto).
> "Análisis" = formulario cubicador (categoría Ishikawa, sub-causa, respuesta, área aplica, fecha análisis, kilos mal fabricados).
> "propios" para cubicador/externo = reclamos donde es `cubicador_asignado` o `respuesta_por`.
> "propios" para USC = reclamos donde es `creado_por` o `asignado_a`.
> *cubicador y usc: por defecto ven solo propios; toggle "Todos" permite ver el listado completo (read-only, sin permisos de edición sobre reclamos ajenos). Externo siempre ve solo propios, sin toggle.
> **Año calidad** (`anio_calidad`) solo editable por admin/admin2 (bloqueado inline en PATCH).
> **Editar/Eliminar acción correctiva e imágenes** — actualmente sin validación de propiedad en backend (cualquier usuario autenticado puede operar).

### 3e. Pedidos, calculistas, constructoras

| Acción                              | admin | admin2 | cubicador | usc   | externo | cliente |
| ----------------------------------- |:-----:|:------:|:---------:|:-----:|:-------:|:-------:|
| CRUD pedidos                        |  ✅   |   ✅   |    —      |   —   |    —    |    —    |
| CRUD calculistas                    |  ✅   |   ✅   |    —      |   —   |    —    |    —    |
| CRUD constructoras                  |  ✅   |   ✅   |    —      |   —   |    —    |    —    |

### 3f. Notificaciones

| Acción                              | admin | admin2 | cubicador | usc   | externo | cliente |
| ----------------------------------- |:-----:|:------:|:---------:|:-----:|:-------:|:-------:|
| Ver notificaciones propias          |  ✅   |   ✅   |    ✅     |  ✅   |   ✅    |   ✅    |
| Contar no leídas                    |  ✅   |   ✅   |    ✅     |  ✅   |   ✅    |   ✅    |
| Marcar leída / todas leídas         |  ✅   |   ✅   |    ✅     |  ✅   |   ✅    |   ✅    |
| Ver config notificaciones           |  ✅   |   ✅   |    —      |   —   |    —    |    —    |
| Editar config notificaciones        |  ✅   |   ✅   |    —      |   —   |    —    |    —    |

---

## 4. Observaciones de seguridad

1. **Reclamos protegidos en backend** — los endpoints de mutación (PATCH, DELETE, POST acciones/imágenes/presentar) validan rol + propiedad. Los campos de registro y análisis están separados por rol.
2. **`GET /reclamos/{id}/imagenes/{iid}` no tiene auth** — públicamente accesible con la URL.
3. **Pedidos, calculistas, constructoras** — restringidos a admin/admin2 en backend.
4. **admin2** vs **admin**: admin2 no puede crear usuarios admin/admin2, no puede operar sobre usuarios admin/admin2, no puede reset DB ni limpiar tablas.
5. **Acciones correctivas e imágenes** — `PATCH/DELETE /reclamos/{id}/acciones/{aid}` y `DELETE /reclamos/{id}/imagenes/{iid}` no validan propiedad. Cualquier usuario autenticado puede operar sobre cualquier reclamo. **Pendiente de hardening.**
6. **`numero_calidad`** — no está restringido a REGISTRO_FIELDS ni ANALISIS_FIELDS, lo que permite su edición por cualquier rol autenticado (excepto cliente). Evaluar si debería restringirse.
