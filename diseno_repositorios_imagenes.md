# Diseño de Repositorios de Imágenes Separados para Registro y Análisis

## Diagrama de Arquitectura Propuesta

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              ARMAHUB BACKEND                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
│   Módulo          │  │   Módulo          │  │   Módulo          │
│   RECLAMOS        │  │   PRESENTACIONES  │  │   ADMIN           │
└───────────────────┘  └───────────────────┘  └───────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼

┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
│  Formulario       │  │  Presentaciones   │  │  Gestión         │
│  Registro         │  │  (Análisis)       │  │  de Archivos     │
│  (Sección Roja)   │  │  (Sección Azul)   │  │  (Admin)         │
└───────────────────┘  └───────────────────┘  └───────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼

┌─────────────────────────────────────────────────────────────────────────────────┐
│                          REPOSITORIOS DE IMÁGENES                              │
├─────────────────────────────────────┬───────────────────────────────────────────┤
│        REPOSITORIO_REGISTRO         │        REPOSITORIO_ANALISIS               │
├─────────────────────────────────────┼───────────────────────────────────────────┤
│  📁 /uploads/registro/              │  📁 /uploads/analisis/                   │
│  ├─ {reclamo_id}/                   │  ├─ {presentacion_id}/                    │
│  │   ├─ evidencia_001.jpg           │  │   ├─ diagrama_001.png                   │
│  │   ├─ evidencia_002.jpg           │  │   ├─ foto_sitio_001.jpg                 │
│  │   └─ documento_001.pdf           │  │   └─ analisis_001.pdf                  │
│  └─ temp/                           │  └─ temp/                                │
│      └─ {session_id}/               │      └─ {session_id}/                    │
├─────────────────────────────────────┼───────────────────────────────────────────┤
│  • Imágenes de evidencia inicial    │  • Diagramas de análisis                  │
│  • Fotos del problema detectado     │  • Fotos de sitio                         │
│  • Documentos de soporte            │  • Gráficos y presentaciones              │
│  • Capturas de pantalla             │  • Reportes técnicos                      │
│  • Videos cortos (opcional)         │  • Documentos de análisis                 │
└─────────────────────────────────────┴───────────────────────────────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼

┌─────────────────────────────────────────────────────────────────────────────────┐
│                          BASE DE DATOS (PostgreSQL)                            │
├─────────────────────────────────────┬───────────────────────────────────────────┤
│        TABLA RECLAMOS               │        TABLA PRESENTACIONES               │
├─────────────────────────────────────┼───────────────────────────────────────────┤
│  id (PK)                            │  id (PK)                                  │
│  titulo                             │  titulo                                   │
│  descripcion                        │  descripcion                              │
│  estado                             │  estado                                   │
│  prioridad                          │  id_reclamo (FK)                          │
│  categoria_ishikawa                 │  fecha_presentacion                       │
│  responsable                        │  presentador                              │
│  ...                                │  ...                                      │
└─────────────────────────────────────┼───────────────────────────────────────────┤
│        TABLA RECLAMOS_IMAGENES      │        TABLA PRESENTACIONES_IMAGENES     │
├─────────────────────────────────────┼───────────────────────────────────────────┤
│  id (PK)                            │  id (PK)                                  │
│  reclamo_id (FK)                    │  presentacion_id (FK)                     │
│  nombre_archivo                     │  nombre_archivo                           │
│  ruta_fisica                       │  ruta_fisica                              │
│  tipo_archivo                       │  tipo_archivo                             │
│  tamaño_bytes                       │  tamaño_bytes                             │
│  fecha_subida                       │  fecha_subida                             │
│  subido_por                         │  subido_por                               │
│  categoria ('evidencia'|'doc')      │  categoria ('diagrama'|'foto'|'reporte') │
└─────────────────────────────────────┴───────────────────────────────────────────┘
```

## Flujo de Trabajo Detallado

### 1. Módulo de Registro (Sección Roja)
```
Usuario detecta problema
         ↓
   Inicia Reclamo
         ↓
   Sube Evidencia
┌─────────────────────────────────────┐
│  📤 UPLOAD DE ARCHIVOS              │
│  ┌─────────────────────────────────┐│
│  │  Selector de archivos           ││
│  │  📷 [Evidencia_001.jpg]         ││
│  │  📷 [Foto_problema.jpg]         ││
│  │  📄 [Documento_soporte.pdf]     ││
│  │                                 ││
│  │  [x] Previsualización            ││
│  │  [🗑️] Eliminar individual        ││
│  └─────────────────────────────────┘│
│           │                         │
│           ▼                         │
│  ┌─────────────────────────────────┐│
│  │  📁 Guardar en:                 ││
│  │  /uploads/registro/{reclamo_id}/ ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
         ↓
   Registro Completo
```

### 2. Módulo de Análisis (Sección Azul)
```
Análisis de Causa Raíz
         ↓
   Crear Presentación
         ↓
   Subir Material de Análisis
┌─────────────────────────────────────┐
│  📤 UPLOAD DE ARCHIVOS              │
│  ┌─────────────────────────────────┐│
│  │  Selector de archivos           ││
│  │  📊 [Diagrama_Ishikawa.png]     ││
│  │  📷 [Foto_sitio_001.jpg]        ││
│  │  📊 [Grafico_analisis.xlsx]     ││
│  │  📄 [Reporte_tecnico.pdf]       ││
│  │                                 ││
│  │  [x] Previsualización            ││
│  │  [🗑️] Eliminar individual        ││
│  └─────────────────────────────────┘│
│           │                         │
│           ▼                         │
│  ┌─────────────────────────────────┐│
│  │  📁 Guardar en:                 ││
│  │  /uploads/analisis/{present_id}/ ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
         ↓
   Presentación Completa
```

## API Endpoints Propuestos

### Repositorio de Registro
```python
# Registro de imágenes en reclamos
POST /reclamos/{id}/imagenes
- multipart/form-data
- files: List[UploadFile]
- categoria: 'evidencia' | 'documento'
- response: lista de imágenes guardadas

GET /reclamos/{id}/imagenes
- response: lista de imágenes del reclamo

DELETE /reclamos/{id}/imagenes/{imagen_id}
- elimina archivo físico y registro BD
```

### Repositorio de Análisis
```python
# Registro de imágenes en presentaciones
POST /presentaciones/{id}/imagenes
- multipart/form-data
- files: List[UploadFile]
- categoria: 'diagrama' | 'foto' | 'reporte'
- response: lista de imágenes guardadas

GET /presentaciones/{id}/imagenes
- response: lista de imágenes de la presentación

DELETE /presentaciones/{id}/imagenes/{imagen_id}
- elimina archivo físico y registro BD
```

## Estructura de Archivos en Servidor

```
armahub-backend/
├── uploads/
│   ├── registro/
│   │   ├── 123/          # reclamo_id
│   │   │   ├── evidencia_001.jpg
│   │   │   ├── evidencia_002.jpg
│   │   │   └── documento_001.pdf
│   │   ├── 124/
│   │   └── temp/
│   │       └── session_abc123/
│   │           └── temp_upload.jpg
│   └── analisis/
│       ├── 45/           # presentacion_id
│       │   ├── diagrama_001.png
│       │   ├── foto_sitio_001.jpg
│       │   └── reporte_001.pdf
│       ├── 46/
│       └── temp/
│           └── session_def456/
│               └── temp_upload.png
└── static/
    └── uploads/          # symlink para acceso web
        ├── registro/
        └── analisis/
```

## Ventajas del Diseño Propuesto

1. **Separación Clara**: Distinción física y lógica entre evidencia inicial y material de análisis
2. **Escalabilidad**: Cada repositorio puede crecer independientemente
3. **Seguridad**: Permisos diferenciados por tipo de repositorio
4. **Mantenimiento**: Limpieza organizada por tipo de contenido
5. **Rendimiento**: Búsquedas más rápidas al estar segmentadas
6. **Auditoría**: Trazabilidad separada para cada fase del proceso

## Implementación en Fases

**Fase 1**: Crear estructura de directorios y tablas BD
**Fase 2**: Implementar endpoints para repositorio de registro
**Fase 3**: Implementar endpoints para repositorio de análisis  
**Fase 4**: Integrar UI en formularios existentes
**Fase 5**: Migrar imágenes existentes a nueva estructura
