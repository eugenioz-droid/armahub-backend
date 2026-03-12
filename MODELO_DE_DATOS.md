📋 MODELO DE DATOS ARMAHUB
========================

Este documento describe todas las tablas, campos y relaciones del sistema ArmaHub.
Objetivo: tener una visión clara del modelo relacional actual para planificar mejoras.

---

## 📁 ENTIDADES PRINCIPALES

### 1. Proyectos (Obra)
Tabla: proyectos
PK: id_proyecto (TEXT)
Campos:
  - nombre_proyecto (TEXT NOT NULL)
  - descripcion (TEXT)
  - calculista_id → calculistas.id (BIGINT) — calculista asignado
  - constructora_id → constructoras.id (BIGINT) — constructora
  - fecha_creacion (TEXT)
  - usuario_creador (TEXT)

Relaciones:
  - 1:N → barras (muchas barras por proyecto)
  - 1:N → imports (muchas importaciones)
  - 1:N → pedidos (muchos pedidos)
  - 1:N → export_log (historial de exportaciones)
  - 1:N → reclamos (muchos reclamos)
  - M:N → proyecto_usuarios (usuarios asignados con rol)
  - 1:N → proyecto_aliases (múltiples códigos ArmaDetailer por obra)

### 1b. Proyecto Aliases (Códigos ArmaDetailer)
Tabla: proyecto_aliases (migración 32)
PK: alias (TEXT) — código de proyecto del CSV ArmaDetailer
FK: id_proyecto → proyectos.id_proyecto (ON DELETE CASCADE)
Campos:
  - creado_por (TEXT) — email del usuario que creó el alias
  - fecha_creacion (TEXT NOT NULL)

Propósito: Permite que una obra tenga múltiples códigos de proyecto ArmaDetailer.
Cuando un cubicador importa un CSV con un código nuevo, puede asignarlo a una obra
existente en vez de crear un proyecto nuevo. Esto crea un alias que se resuelve
automáticamente en futuras importaciones.

Restricciones:
  - Un alias no puede pertenecer a más de una obra
  - Un código que ya existe como id_proyecto en proyectos no puede ser alias

---

### 2. Users (Personas)
Tabla: users
PK: id (BIGSERIAL)
Campos:
  - email (TEXT UNIQUE NOT NULL) — login
  - password_hash (TEXT NOT NULL)
  - role (TEXT) CHECK IN ('admin', 'admin2', 'cubicador', 'usc', 'externo', 'cliente')
  - nombre (TEXT)
  - apellido (TEXT)
  - activo (BOOLEAN NOT NULL DEFAULT TRUE)
  - fecha_creacion (TEXT NOT NULL)

Relaciones:
  - M:N → proyecto_usuarios (con rol por proyecto)
  - Referenciado en auditoría, reclamos, pedidos

---

### 3. Constructoras
Tabla: constructoras (renombrada desde clientes en migración 28)
PK: id (BIGSERIAL)
Campos:
  - nombre (TEXT NOT NULL)
  - rut (TEXT)
  - contacto (TEXT)
  - email (TEXT)
  - telefono (TEXT)
  - direccion (TEXT)
  - notas (TEXT)
  - activo (BOOLEAN NOT NULL DEFAULT TRUE)
  - fecha_creacion (TEXT NOT NULL)

Relaciones:
  - 1:N → proyectos.constructora_id
  - 1:N → reclamos.cliente_id (FK legacy, apunta a constructoras.id)

---

### 4. Calculistas
Tabla: calculistas
PK: id (BIGSERIAL)
Campos:
  - nombre (TEXT NOT NULL)
  - email (TEXT)
  - activo (BOOLEAN NOT NULL DEFAULT TRUE)
  - fecha_creacion (TEXT NOT NULL)

Relaciones:
  - 1:N → proyectos.calculista_id

---

## 🏗️ ENTIDADES OPERATIVAS

### 5. Barras (Cubicación)
Tabla: barras
PK: id_unico (TEXT)
FK: id_proyecto → proyectos
Campos:
  - nombre_proyecto (TEXT)
  - plano_code (TEXT)
  - nombre_plano (TEXT)
  - sector (TEXT)
  - piso (TEXT)
  - ciclo (TEXT)
  - eje (TEXT)
  - diam (DOUBLE PRECISION)
  - largo_total (DOUBLE PRECISION)
  - mult (DOUBLE PRECISION)
  - cant (DOUBLE PRECISION)
  - cant_total (DOUBLE PRECISION)
  - peso_unitario (DOUBLE PRECISION)
  - peso_total (DOUBLE PRECISION)
  - version_mod (TEXT)
  - version_exp (TEXT)
  - fecha_carga (TEXT)
  - origen (TEXT DEFAULT 'csv')
  - import_id → imports.id (BIGINT)
  - pedido_id → pedidos.id (BIGINT)
  - creado_por (TEXT)
  - pedido_item_id (INTEGER)
  - ang1 (DOUBLE PRECISION)
  - ang2 (DOUBLE PRECISION)
  - ang3 (DOUBLE PRECISION)
  - ang4 (DOUBLE PRECISION)
  - radio (DOUBLE PRECISION)
  - dim_a, dim_b, dim_c, dim_d, dim_e, dim_f, dim_g, dim_h, dim_i (DOUBLE PRECISION)
  - marca (TEXT)
  - cod_proyecto (TEXT)
  - figura (TEXT)

Relaciones:
  - N:1 → proyectos
  - N:1 → imports (via import_id)
  - N:1 → pedidos (via pedido_id)

---

### 6. Imports (Cargas CSV)
Tabla: imports
PK: id (BIGSERIAL)
FK: id_proyecto → proyectos
Campos:
  - nombre_proyecto (TEXT)
  - usuario (TEXT)
  - archivo (TEXT)
  - fecha (TEXT)
  - barras_count (INTEGER DEFAULT 0)
  - kilos (DOUBLE PRECISION DEFAULT 0)
  - estado (TEXT DEFAULT 'ok')
  - version_archivo (TEXT)
  - plano_code (TEXT)
  - errores (TEXT)

Relaciones:
  - 1:N → barras (via import_id)

---

### 7. Pedidos
Tabla: pedidos
PK: id (BIGSERIAL)
FK: id_proyecto → proyectos
Campos:
  - titulo (TEXT NOT NULL)
  - descripcion (TEXT)
  - estado (TEXT NOT NULL DEFAULT 'borrador')
    CHECK IN ('borrador','enviado','en_proceso','completado','cancelado')
  - creado_por (TEXT NOT NULL)
  - fecha_creacion (TEXT NOT NULL)
  - fecha_actualizacion (TEXT)
  - tipo (TEXT NOT NULL DEFAULT 'generico')
    CHECK IN ('generico','especifico')
  - procesado (BOOLEAN NOT NULL DEFAULT FALSE)

Relaciones:
  - 1:N → pedido_items
  - 1:N → barras (via pedido_id)

---

### 8. Pedido_items
Tabla: pedido_items
PK: id (BIGSERIAL)
FK: pedido_id → pedidos
Campos:
  - diam (DOUBLE PRECISION NOT NULL)
  - largo (DOUBLE PRECISION)
  - cantidad (INTEGER NOT NULL DEFAULT 1)
  - sector (TEXT)
  - piso (TEXT)
  - ciclo (TEXT)
  - eje (TEXT)
  - nota (TEXT)
  - estado (TEXT NOT NULL DEFAULT 'pendiente')
    CHECK IN ('pendiente','en_proceso','completado')

Relaciones:
  - 1:1 → barras.pedido_item_id

---

## 🔍 ENTIDADES DE CALIDAD (RECLAMOS)

### 9. Reclamos
Tabla: reclamos
PK: id (BIGSERIAL)
FK: id_proyecto → proyectos (ON DELETE SET NULL)
FK: cliente_id → constructoras (ON DELETE SET NULL) — FK legacy
Campos:
  - titulo (TEXT NOT NULL)
  - descripcion (TEXT)
  - estado (TEXT NOT NULL DEFAULT 'abierto')
    CHECK IN ('abierto','en_analisis','accion_correctiva','validacion','cerrado','rechazado')
  - prioridad (TEXT NOT NULL DEFAULT 'media')
    CHECK IN ('baja','media','alta','critica')
  - categoria_ishikawa (TEXT)
    CHECK IN ('mano_de_obra','metodo','material','maquina','medicion','medio_ambiente')
  - responsable (TEXT)
  - accion_correctiva (TEXT)
  - accion_preventiva (TEXT)
  - resolucion (TEXT)
  - creado_por (TEXT NOT NULL)
  - fecha_creacion (TEXT NOT NULL)
  - fecha_actualizacion (TEXT)
  - fecha_cierre (TEXT)
  - correlativo (TEXT) — ej: REC-001
  - id_calidad (TEXT)
  - aplica (TEXT DEFAULT 'pendiente')
    CHECK IN ('si','no','pendiente')
  - sub_causa (TEXT)
  - cod_causa (TEXT)
  - detectado_por (TEXT)
  - fecha_deteccion (TEXT)
  - fecha_analisis (TEXT)
  - analista (TEXT)
  - area_aplica (TEXT)
  - explicacion_causa (TEXT)
  - observaciones (TEXT)
  - kilos_mal_fabricados (DOUBLE PRECISION)
  - asignado_a (TEXT) — responsable inicial (USC se auto-asigna)
  - cubicador_asignado (TEXT) — cubicador que responde (específico del reclamo)
  - tipo_reclamo (TEXT DEFAULT 'error')
    CHECK IN ('error','faltante')
  - respuesta_texto (TEXT)
  - respuesta_fecha (TIMESTAMPTZ)
  - respuesta_por (TEXT)
  - validacion_resultado (TEXT)
    CHECK IN ('aprobado','rechazado','corregido')
  - validacion_observaciones (TEXT)
  - validacion_fecha (TIMESTAMPTZ)
  - validacion_por (TEXT)

Relaciones:
  - 1:N → reclamo_seguimientos
  - 1:N → reclamo_acciones
  - 1:N → reclamo_imagenes

---

### 10. Reclamo_seguimientos
Tabla: reclamo_seguimientos
PK: id (BIGSERIAL)
FK: reclamo_id → reclamos (ON DELETE CASCADE)
Campos:
  - usuario (TEXT NOT NULL)
  - comentario (TEXT)
  - estado_anterior (TEXT)
  - estado_nuevo (TEXT)
  - fecha (TEXT NOT NULL)

---

### 11. Reclamo_acciones
Tabla: reclamo_acciones
PK: id (BIGSERIAL)
FK: reclamo_id → reclamos (ON DELETE CASCADE)
Campos:
  - tipo (TEXT NOT NULL)
    CHECK IN ('inmediata','correctiva','preventiva')
  - descripcion (TEXT NOT NULL)
  - responsable (TEXT)
  - fecha_prevista (TEXT)
  - fecha_completada (TEXT)
  - estado (TEXT NOT NULL DEFAULT 'pendiente')
    CHECK IN ('pendiente','en_proceso','completada')
  - creado_por (TEXT NOT NULL)
  - fecha_creacion (TEXT NOT NULL)

---

### 12. Reclamo_imagenes
Tabla: reclamo_imagenes
PK: id (BIGSERIAL)
FK: reclamo_id → reclamos (ON DELETE CASCADE)
Campos:
  - filename (TEXT NOT NULL)
  - content_type (TEXT NOT NULL)
  - data (BYTEA NOT NULL)
  - descripcion (TEXT)
  - subido_por (TEXT NOT NULL)
  - fecha (TEXT NOT NULL)
  - tipo (TEXT NOT NULL DEFAULT 'antecedente')
    CHECK IN ('antecedente','respuesta')

---

## 🛠️ ENTIDADES DE SOPORTE

### 13. Proyecto_usuarios (M:N)
Tabla: proyecto_usuarios
PK: id (BIGSERIAL)
FKs:
  - id_proyecto → proyectos (ON DELETE CASCADE)
  - user_id → users (ON DELETE CASCADE)
Campos:
  - rol (TEXT NOT NULL DEFAULT 'cubicador')
    CHECK IN ('admin','usc','cubicador','externo','cliente')
Unique: (id_proyecto, user_id)

Nota: Al crear un proyecto, el creador se auto-agrega con un rol
mapeado desde su rol de sistema (admin/admin2→admin, cubicador→cubicador, etc.)

---

### 14. Export_log
Tabla: export_log
PK: id (BIGSERIAL)
FK: id_proyecto → proyectos (ON DELETE CASCADE)
Campos:
  - sector (TEXT NOT NULL)
  - piso (TEXT NOT NULL)
  - ciclo (TEXT NOT NULL)
  - export_key (TEXT NOT NULL)
  - usuario (TEXT NOT NULL)
  - fecha (TEXT NOT NULL)
  - archivo (TEXT)

---

### 15. Audit_log
Tabla: audit_log
PK: id (BIGSERIAL)
Campos:
  - usuario (TEXT NOT NULL)
  - accion (TEXT NOT NULL)
  - detalle (TEXT)
  - entidad (TEXT)
  - entidad_id (TEXT)
  - fecha (TEXT NOT NULL)

---

### 16. Schema_migrations
Tabla: schema_migrations
PK: version (INTEGER)
Campos:
  - description (TEXT NOT NULL)
  - applied_at (TEXT NOT NULL)

---

## 🎯 CAMPOS FUTUROS SUGERIDOS

### En proyectos (obra):
- fecha_inicio (TEXT)
- fecha_termino (TEXT)
- direccion_obra (TEXT)
- estado_obra (TEXT) CHECK IN ('activa','pausada','terminada')

---

## 📝 NOTAS IMPORTANTES

1. **Roles actuales:** admin, admin2, cubicador, usc, externo, cliente
2. **Flujo de reclamos:** 3 etapas (Creación → Respuesta → Validación)
3. **Asignación en reclamos:**
   - creado_por: quien crea el reclamo
   - asignado_a: responsable inicial (USC se auto-asigna)
   - cubicador_asignado: cubicador que responde (específico del reclamo)
4. **Origen de barras:** csv (importación) o pedido (generación)
5. **Pedidos:** tipo generic (sin sector) o especifico (con sector)
6. **Exportación:** por sector+piso+ciclo, genera archivos Excel aSa Studio

---

## ✅ CAMBIOS IMPLEMENTADOS (Migraciones 28–32)

1. **Migración 28:** Tabla `clientes` renombrada a `constructoras`
2. **Migración 29:** Columna `proyectos.cliente_id` renombrada a `constructora_id`
3. **Migración 30:** Columnas `proyectos.owner_id` y `proyectos.calculista` (texto) eliminadas
4. **Migración 31:** Roles en `proyecto_usuarios` actualizados a: admin, usc, cubicador, externo, cliente
5. **Migración 32:** Tabla `proyecto_aliases` creada para asociar múltiples códigos ArmaDetailer a una obra

## 🔍 DUDAS PENDIENTES

1. ¿Necesitamos más estados para proyectos (obra)?
2. ¿Deberíamos normalizar `barras.figura` en una tabla aparte?
3. ¿El campo `barras.cod_proyecto` debería ser FK a proyectos o es código externo?

---

Fin del documento.
