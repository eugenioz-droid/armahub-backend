# MODELO DE DATOS ARMAHUB

> **Estado (actualizado 2026-06-10, tarea 4.8):** Refleja el esquema real tras la migración 54.
> Fuente de verdad del esquema: `armahub/db.py`. Infraestructura vigente: Render (FastAPI) +
> Supabase (PostgreSQL) + Cloudflare R2 (archivos). Sin BYTEA — todo archivo va a R2.

---

## ENTIDADES PRINCIPALES

### 1. proyectos (Obra)
PK: `id_proyecto` (TEXT)

| Campo | Tipo | Notas |
|-------|------|-------|
| nombre_proyecto | TEXT NOT NULL | |
| descripcion | TEXT | |
| calculista_id | BIGINT FK→calculistas | |
| constructora_id | BIGINT FK→constructoras | |
| fecha_creacion | TEXT | |
| usuario_creador | TEXT | |
| fecha_inicio | TEXT | migración 36 |

Relaciones: 1:N barras, imports, pedidos, export_log, reclamos · M:N proyecto_usuarios · 1:N proyecto_aliases

---

### 2. users
PK: `id` (BIGSERIAL)

| Campo | Tipo | Notas |
|-------|------|-------|
| email | TEXT UNIQUE NOT NULL | login |
| password_hash | TEXT NOT NULL | |
| role | TEXT | admin · admin2 · cubicador · usc · externo · cliente |
| nombre | TEXT | |
| apellido | TEXT | |
| activo | BOOLEAN DEFAULT TRUE | |
| fecha_creacion | TEXT NOT NULL | |

---

### 3. constructoras
PK: `id` (BIGSERIAL) — renombrada desde `clientes` (migración 28)

| Campo | Tipo |
|-------|------|
| nombre | TEXT NOT NULL |
| rut | TEXT |
| contacto | TEXT |
| email | TEXT |
| telefono | TEXT |
| direccion | TEXT |
| notas | TEXT |
| activo | BOOLEAN DEFAULT TRUE |
| fecha_creacion | TEXT NOT NULL |

---

### 4. calculistas
PK: `id` (BIGSERIAL)

| Campo | Tipo |
|-------|------|
| nombre | TEXT NOT NULL |
| email | TEXT |
| activo | BOOLEAN DEFAULT TRUE |
| fecha_creacion | TEXT NOT NULL |

---

## ENTIDADES OPERATIVAS — CUBICACIÓN

### 5. barras
PK: `id` (BIGSERIAL) · UNIQUE(`id_unico`, `id_proyecto`) — migración 51

| Campo | Tipo | Notas |
|-------|------|-------|
| id_unico | TEXT | único por obra (no global) |
| id_proyecto | TEXT FK→proyectos | |
| import_id | BIGINT FK→imports | |
| pedido_id | BIGINT FK→pedidos | |
| pedido_item_id | INTEGER | |
| origen | TEXT DEFAULT 'csv' | csv · pedido |
| creado_por | TEXT | |
| plano_code | TEXT | |
| nombre_plano | TEXT | |
| sector / piso / ciclo / eje | TEXT | |
| diam | DOUBLE PRECISION | |
| largo_total | DOUBLE PRECISION | |
| mult / cant / cant_total | DOUBLE PRECISION | |
| peso_unitario / peso_total | DOUBLE PRECISION | |
| version_mod / version_exp | TEXT | |
| fecha_carga | TEXT | |
| figura / marca / tipo / estructura | TEXT | |
| bar_id / cod_proyecto / nombre_dwg | TEXT | |
| dim_a … dim_i | DOUBLE PRECISION | |
| ang1 … ang4 | DOUBLE PRECISION | |
| radio / esp | DOUBLE PRECISION | |

---

### 6. imports (Cargas CSV)
PK: `id` (BIGSERIAL)

| Campo | Tipo | Notas |
|-------|------|-------|
| id_proyecto | TEXT FK→proyectos | |
| nombre_proyecto | TEXT | |
| usuario | TEXT | |
| archivo | TEXT | |
| fecha | TEXT | |
| barras_count | INTEGER DEFAULT 0 | |
| kilos | DOUBLE PRECISION DEFAULT 0 | |
| estado | TEXT DEFAULT 'ok' | |
| version_archivo | TEXT | |
| plano_code | TEXT | |
| errores | TEXT | |
| modo_reemplazo | TEXT DEFAULT 'ninguno' | migración 50 |
| scope_reemplazo | TEXT | migración 50 |
| barras_eliminadas_previo | INTEGER DEFAULT 0 | migración 50 |
| supersedida_por | INTEGER FK→imports | migración 52 |

---

### 7. pedidos
PK: `id` (BIGSERIAL)

| Campo | Tipo | Notas |
|-------|------|-------|
| id_proyecto | TEXT FK→proyectos | |
| titulo | TEXT NOT NULL | |
| descripcion | TEXT | |
| estado | TEXT DEFAULT 'borrador' | borrador · enviado · en_proceso · completado · cancelado |
| tipo | TEXT DEFAULT 'generico' | generico · especifico |
| procesado | BOOLEAN DEFAULT FALSE | |
| creado_por | TEXT NOT NULL | |
| fecha_creacion / fecha_actualizacion | TEXT | |

---

### 8. pedido_items
PK: `id` (BIGSERIAL) · FK: `pedido_id`→pedidos

| Campo | Tipo | Notas |
|-------|------|-------|
| diam | DOUBLE PRECISION NOT NULL | |
| largo | DOUBLE PRECISION | |
| cantidad | INTEGER DEFAULT 1 | |
| sector / piso / ciclo / eje | TEXT | |
| nota | TEXT | |
| estado | TEXT DEFAULT 'pendiente' | pendiente · en_proceso · completado |

---

## ENTIDADES DE CALIDAD — RECLAMOS

### 9. reclamos
PK: `id` (BIGSERIAL) · FK: `id_proyecto`→proyectos ON DELETE SET NULL

Estados vigentes: `abierto` → `en_analisis` → `validacion` → `cerrado` / `rechazado`

| Campo | Tipo | Notas |
|-------|------|-------|
| titulo | TEXT NOT NULL | |
| descripcion | TEXT | |
| estado | TEXT DEFAULT 'abierto' | ver estados vigentes arriba |
| prioridad | TEXT DEFAULT 'media' | baja · media · alta · critica |
| tipo_reclamo | TEXT DEFAULT 'error' | error · faltante · atraso · actualizacion_portal |
| categoria_ishikawa | TEXT | mano_de_obra · metodo · material · maquina · medicion · medio_ambiente |
| anio_calidad | INTEGER | correlativo año (migración 44) |
| numero_calidad | INTEGER | correlativo número (migración 44) |
| aplica | TEXT DEFAULT 'pendiente' | si · no · pendiente |
| creado_por | TEXT NOT NULL | |
| asignado_a | TEXT | responsable inicial |
| cubicador_asignado | TEXT | cubicador que responde |
| detectado_por / fecha_deteccion | TEXT | |
| analista / fecha_analisis | TEXT | |
| sub_causa / cod_causa / explicacion_causa | TEXT | |
| area_aplica | TEXT | |
| observaciones | TEXT | |
| accion_correctiva / accion_preventiva / resolucion | TEXT | |
| kilos_mal_fabricados | DOUBLE PRECISION | |
| tiempo_respuesta | INTEGER | en unidad indicada abajo |
| tiempo_respuesta_unidad | TEXT DEFAULT 'horas' | minutos · horas · dias |
| respuesta_texto / respuesta_por | TEXT | |
| respuesta_fecha | TIMESTAMPTZ | |
| validacion_resultado | TEXT | aprobado · rechazado · corregido |
| validacion_observaciones / validacion_por | TEXT | |
| validacion_fecha | TIMESTAMPTZ | |
| presentacion_realizada | BOOLEAN DEFAULT FALSE | |
| presentacion_fecha / presentacion_por / presentacion_asistentes / presentacion_comentarios | TEXT | |
| fecha_creacion / fecha_actualizacion / fecha_cierre | TEXT | |

---

### 10. reclamo_seguimientos
PK: `id` (BIGSERIAL) · FK: `reclamo_id`→reclamos CASCADE

| Campo | Tipo |
|-------|------|
| usuario | TEXT NOT NULL |
| comentario | TEXT |
| estado_anterior / estado_nuevo | TEXT |
| fecha | TEXT NOT NULL |

---

### 11. reclamo_acciones
PK: `id` (BIGSERIAL) · FK: `reclamo_id`→reclamos CASCADE

| Campo | Tipo | Notas |
|-------|------|-------|
| tipo | TEXT NOT NULL | inmediata · correctiva · preventiva |
| descripcion | TEXT NOT NULL | |
| responsable | TEXT | |
| fecha_prevista / fecha_completada | TEXT | |
| estado | TEXT DEFAULT 'pendiente' | pendiente · en_proceso · completada |
| creado_por | TEXT NOT NULL | |
| fecha_creacion | TEXT NOT NULL | |

---

### 12. reclamo_imagenes
PK: `id` (BIGSERIAL) · FK: `reclamo_id`→reclamos CASCADE

| Campo | Tipo | Notas |
|-------|------|-------|
| filename | TEXT NOT NULL | |
| content_type | TEXT NOT NULL | |
| storage_key | TEXT | clave en R2 (reclamos/registro/ o reclamos/analisis/) |
| tipo | TEXT DEFAULT 'ImagenesRegistro' | ImagenesRegistro · ImagenesAnalisis |
| descripcion | TEXT | |
| subido_por | TEXT NOT NULL | |
| fecha | TEXT NOT NULL | |

> Sin columna `data` (BYTEA eliminado en migración 54). Todo archivo en R2.

---

## ENTIDADES DE SOPORTE

### 13. proyecto_usuarios (M:N obras-usuarios)
PK: `id` · FKs: `id_proyecto`→proyectos CASCADE, `user_id`→users CASCADE
UNIQUE: (`id_proyecto`, `user_id`)

Roles por obra: admin · usc · cubicador · externo · cliente

---

### 14. proyecto_aliases
PK: `alias` (TEXT) · FK: `id_proyecto`→proyectos CASCADE

Permite que una obra tenga múltiples códigos ArmaDetailer. Un CSV con código nuevo
puede asignarse a una obra existente creando un alias.

---

### 15. export_log
PK: `id` · FK: `id_proyecto`→proyectos CASCADE

| Campo | Tipo |
|-------|------|
| sector / piso / ciclo | TEXT NOT NULL |
| export_key | TEXT NOT NULL |
| usuario | TEXT NOT NULL |
| fecha | TEXT NOT NULL |
| barras / kilos | INTEGER / DOUBLE PRECISION |

---

### 16. audit_log
PK: `id` (BIGSERIAL)

| Campo | Tipo |
|-------|------|
| usuario | TEXT NOT NULL |
| accion | TEXT NOT NULL |
| detalle / entidad / entidad_id | TEXT |
| fecha | TEXT NOT NULL |

---

### 17. notificaciones
PK: `id` (BIGSERIAL) · FK: `reclamo_id`→reclamos CASCADE (migración 43)

| Campo | Tipo |
|-------|------|
| destinatario | TEXT NOT NULL |
| tipo_evento | TEXT NOT NULL |
| reclamo_id | BIGINT FK nullable |
| mensaje | TEXT NOT NULL |
| leida | BOOLEAN DEFAULT FALSE |
| fecha | TEXT NOT NULL |

---

### 18. notificacion_config
PK: `id` (BIGSERIAL) · UNIQUE(`tipo_evento`, `rol`) (migración 43)

| Campo | Tipo |
|-------|------|
| tipo_evento | TEXT NOT NULL |
| rol | TEXT NOT NULL |
| activo | BOOLEAN DEFAULT TRUE |

Eventos configurados: reclamo_creado · reclamo_asignado · analisis_completado ·
validacion_realizada · reclamo_cerrado · reclamo_reabierto · cambio_estado

---

### 19. schema_migrations
PK: `version` (INTEGER)

| Campo | Tipo |
|-------|------|
| description | TEXT NOT NULL |
| applied_at | TEXT NOT NULL |

Última migración aplicada: **54** (drop columna `data` BYTEA de reclamo_imagenes).

---

## NOTAS DEL MODELO

- **Roles globales:** admin · admin2 · cubicador · usc · externo · cliente
- **Roles por obra** (proyecto_usuarios): admin · usc · cubicador · externo · cliente
- **Infraestructura:** datos en Supabase, archivos en R2, sin BYTEA
- **Correlativos de reclamo:** `anio_calidad` + `numero_calidad` (enteros); `id_calidad` (texto legacy, se mantiene por compatibilidad)
- **Barras:** `id_unico` único por obra (no global desde migración 51); PK es `id` BIGSERIAL
- **Pedidos:** generico (sin sector) o especifico (con sector); `procesado=true` cuando los items se convirtieron en barras

---

*Fin del documento. Próxima actualización: al iniciar F7 (discovery de obra) cuando se definan tablas nuevas.*
