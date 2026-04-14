# ArmaHub — Matriz de Roles, Dashboards y Permisos

Documento de referencia para visualizar qué ve y qué puede hacer cada rol.

---

## 1. Módulos y Tabs × Rol

### 1a. Acceso a módulos (calugas del Hub)

| Módulo (caluga)              | admin | admin2 | cubicador | usc   | externo | cliente |
| ---------------------------- |:-----:|:------:|:---------:|:-----:|:-------:|:-------:|
| Cubicación                   |  ✅   |   ✅   |    ✅     |   —   |    —    |   ✅    |
| Reclamos                     |  ✅   |   ✅   |    ✅     |  ✅   |   ✅    |    —    |
| Administración               |  ✅   |   ✅   |     —     |   —   |    —    |    —    |

> Definido en `registry.js` → `allowedRoles`.

### 1b. Acceso a tabs dentro de cada módulo

| Módulo         | Tab              | admin | admin2 | cubicador | usc   | externo | cliente |
| -------------- | ---------------- |:-----:|:------:|:---------:|:-----:|:-------:|:-------:|
| **Cubicación** | Inicio           |  ✅   |   ✅   |    ✅     |   —   |    —    |   ✅    |
| **Cubicación** | Obras            |  ✅   |   ✅   |    ✅     |   —   |    —    |    —    |
| **Cubicación** | Bar Manager      |  ✅   |   ✅   |    ✅     |   —   |    —    |    —    |
| **Cubicación** | Dashboards       |  ✅   |   ✅   |    ✅     |   —   |    —    |    —    |
| **Cubicación** | Pedidos          |  ✅   |   ✅   |    ✅     |   —   |    —    |    —    |
| **Cubicación** | Exportación      |  ✅   |   ✅   |    ✅     |   —   |    —    |    —    |
| **Reclamos**   | Reclamos         |  ✅   |   ✅   |    ✅     |  ✅   |   ✅    |    —    |
| **Reclamos**   | Dashboards       |  ✅   |   ✅   |     —     |   —   |    —    |    —    |
| **Reclamos**   | Presentación     |  ✅   |   ✅   |    ✅     |   —   |   ✅    |    —    |
| **Admin**      | Admin            |  ✅   |   ✅   |     —     |   —   |    —    |    —    |

> El rol `cliente` dentro de Cubicación solo ve el tab **Inicio** (los demás se ocultan en frontend).
> En Reclamos, el tab **Dashboards** es solo para admin/admin2. El tab **Presentación** excluye a usc.
> Los roles sin acceso al módulo (—) no ven ningún tab de ese módulo.

---

## 2. Dashboards / Vistas × Rol

### 2a. Landing (Hub principal)

| Indicador                    | admin    | admin2   | cubicador      | usc          | externo      | cliente |
| ---------------------------- |:--------:|:--------:|:--------------:|:------------:|:------------:|:-------:|
| Cubicado semanal (chart)     |    ✅    |    ✅    |      ✅        |      —       |      —       |    —    |
| Reclamos semana (chart)      |    ✅    |    ✅    |   ✅ propios   |  ✅ propios  |  ✅ propios  |    —    |
| Alertas reclamos             | ✅ todos | ✅ todos |   ✅ propios   |  ✅ propios  |  ✅ propios  |    —    |

### 2b. Reclamos — Vistas analíticas

| Vista                        | admin      | admin2     | cubicador  | usc        | externo    | cliente |
| ---------------------------- |:----------:|:----------:|:--------- :|:----------:|:----------:|:-------:|
| Resumen General              | ✅ global  | ✅ global | ✅ global | ✅ propios | ✅ propios |    ✖    |
| Tab Dashboards               |      ✅    |      ✅   |      ✖    |      ✖     |      ✖     |    ✖    |
| Presentaciones stats         | ✅ todos   | ✅ todos  | ✅ todos  |      ✖     | ✅ propios |    ✖    |

> `✖` = prohibido (403 en backend o sin acceso al módulo).
> `cliente` no tiene acceso al módulo Reclamos actualmente.
> **"propios"** = filtrado por `build_role_filter()`: externo ve reclamos donde es `cubicador_asignado` o `respuesta_por`; usc ve donde es `creado_por` o `asignado_a`. Admin, admin2 y cubicador ven todo (global).

### 2c. Cubicación — Vistas

| Vista                        | admin | admin2 | cubicador | usc   | externo | cliente |
| ---------------------------- |:-----:|:------:|:---------:|:-----:|:-------:|:-------:|
| Stats generales              |  ✅   |  ✅\*  |    ✅     | ✅\*  |  ✅\*   |   ✅    |
| Timeline                     |  ✅   |  ✅\*  |    ✅     | ✅\*  |  ✅\*   |   ✅    |
| Cubicadores                  |  ✅   |  ✅\*  |    ✅     | ✅\*  |  ✅\*   |   ✅    |
| Mi Actividad                 |  ✅   |  ✅\*  |    ✅     | ✅\*  |  ✅\*   |   ✅    |
| Dashboard cubicación         |  ✅   |  ✅\*  |    ✅     | ✅\*  |  ✅\*   |   ✅    |

> \*Acceso API disponible pero sin card en el Hub.

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

### 3c. Proyectos y barras (cubicación)

| Acción                              | admin  | admin2 | cubicador      | usc | externo | cliente |
| ----------------------------------- |:------:|:------:|:--------------:|:---:|:-------:|:-------:|
| Ver proyectos / barras              |   ✅   |   ✅   |      ✅        |  —  |    —    |    —    |
| Crear proyecto                      |   ✅   |   ✅   |      ✅        |  —  |    —    |    —    |
| Editar proyecto                     |   ✅   |   ✅   |     ✅†        |  —  |    —    |    —    |
| Eliminar proyecto                   |   ✅   |   ✅   |   ✅† vacío    |  —  |    —    |    —    |
| Crear / duplicar barras             |   —    |   —    |      —         |  —  |    —    |    —    |
| Eliminar barras                     |   —    |   —    |      —         |  —  |    —    |    —    |
| Cambiar sector                      |   —    |   —    |      —         |  —  |    —    |    —    |
| Mover barras entre sectores         |   —    |   —    |      —         |  —  |    —    |    —    |
| Importar Excel                      |   ✅   |   ✅   |      ✅        |  —  |    —    |    —    |
| Exportar proyecto                   |   ✅   |   ✅   |      ✅        |  —  |    —    |    —    |
| Eliminar carga                      |   ✅   |   ✅   |  ✅† o propio  |  —  |    —    |    —    |
| Autorizar usuario en proyecto       |   ✅   |   ✅   |     ✅†        |  —  |    —    |    —    |

> † Requiere estar autorizado en `proyecto_usuarios`. Admin/admin2 siempre tienen acceso.
> USC, externo y cliente no tienen acceso al módulo Cubicación (excepto cliente en modo lectura).

### 3d. Reclamos

| Acción                              | admin      | admin2     | cubicador    | usc            | externo      | cliente |
| ----------------------------------- |:----------:|:----------:|:------------:|:--------------:|:------------:|:-------:|
| Ver listado reclamos                | ✅ todo    | ✅ todo    | ✅ todo      | ✅ propios     | ✅ propios   |    —    |
| Crear reclamo                       |     ✅     |     ✅     |      ✅      | ✅ auto-asigna |      ✅      |    —    |
| Editar registro (form básico)       |     ✅     |     ✅     |      —       | ✅ propios     |      —       |    —    |
| Editar análisis (form cubicador)    |     ✅     |     ✅     | ✅ propios   |       —        | ✅ propios   |    —    |
| Eliminar reclamo                    |     ✅     |     ✅     |      —       | ✅ propios     |      —       |    —    |
| Agregar historial de modificaciones |     ✅     |     ✅     |      ✅      |       ✅       |      ✅      |    —    |
| Agregar acción correctiva           |     ✅     |     ✅     | ✅ propios   |       —        | ✅ propios   |    —    |
| Subir imágenes registro             |     ✅     |     ✅     |      —       |       ✅       |      —       |    —    |
| Subir imágenes análisis             |     ✅     |     ✅     |      ✅      |       —        |      ✅      |    —    |
| Presentar reclamo                   |     ✅     |     ✅     | ✅ propios   |       —        | ✅ propios   |    —    |

> "Registro" = formulario básico (descripción, responsable, prioridad, id_calidad, observaciones, proyecto, cubicador_asignado).
> "Análisis" = formulario cubicador (categoría Ishikawa, sub-causa, respuesta, área aplica, fecha análisis, kilos mal fabricados).
> "propios" para cubicador/externo = reclamos donde es `cubicador_asignado` o `respuesta_por`.
> "propios" para USC = reclamos donde es `creado_por` o `asignado_a`.
> Historial de modificaciones = timeline de comentarios/cambios de estado en el detalle de cada reclamo (automático al modificar, manual vía formulario).
> Cliente no tiene acceso al módulo Reclamos.

### 3e. Pedidos, calculistas, constructoras

| Acción                              | admin | admin2 | cubicador | usc   | externo | cliente |
| ----------------------------------- |:-----:|:------:|:---------:|:-----:|:-------:|:-------:|
| CRUD pedidos                        |  ✅   |   ✅   |    —      |   —   |    —    |    —    |
| CRUD calculistas                    |  ✅   |   ✅   |    —      |   —   |    —    |    —    |
| CRUD constructoras                  |  ✅   |   ✅   |    —      |   —   |    —    |    —    |

---

## 4. Observaciones de seguridad

1. **Reclamos protegidos en backend** — los endpoints de mutación (PATCH, DELETE, POST acciones/imágenes/presentar) validan rol + propiedad. Los campos de registro y análisis están separados por rol.
2. **`GET /reclamos/{id}/imagenes/{iid}` no tiene auth** — públicamente accesible con la URL.
3. **Pedidos, calculistas, constructoras** — restringidos a admin/admin2 en backend.
4. **admin2** vs **admin**: admin2 no puede crear usuarios admin/admin2, no puede operar sobre usuarios admin/admin2, no puede reset DB ni limpiar tablas.
5. **Barras/cubicación** — crear/duplicar/eliminar barras, cambiar sector y mover barras deshabilitados para todos (sistema cerrado).
