# Inventario congelado — Formularios de Reclamos (tarea 5I.19.1)

**Propósito:** red de seguridad anti-regresión para la separación de las vistas de
Reclamos Internos vs Externos (tareas 5I.19.2–5I.19.4). Documenta el estado ACTUAL
y CORRECTO de los 4 formularios. Tras separar, el comportamiento debe ser idéntico
a lo aquí descrito. Es el checklist contra el que se valida el "después".

> Fecha de congelamiento: 2026-06-16. Verificado leyendo el código (no de memoria).
> Archivos fuente: `templates/tabs/reclamos.html`, `static/js/features/reclamos/{form,internos,detail-edit,detail-render,detail-permissions,list}.js`, `reclamos.py`.

---

## 0. Modelo de datos compartido (NO se separa)

- Tabla única `reclamos` con discriminador `tipo_origen` ∈ {`externo`, `interno`} + columnas nullable. **Patrón válido; NO migrar a tablas separadas.**
- Backend `ReclamoIn` (crear) acepta: titulo, descripcion, prioridad, tipo_reclamo, categoria_ishikawa, sub_causa, cod_causa, responsable, detectado_por, fecha_deteccion, id_calidad, anio_calidad, numero_calidad, asignado_a, cubicador_asignado, **tipo_origen**, **area_id**.
- Backend `ReclamoUpdate` (PATCH) acepta los anteriores editables + estado, aplica, fecha_analisis, analista, area_aplica, explicacion_causa, accion_correctiva/preventiva, resolucion, observaciones, respuesta_texto, validacion_*, kilos_mal_fabricados, tiempo_respuesta*, metodo_rca, cinco_por_que, **area_id** (agregado en 5I.19.1; sin él la reasignación de área interna se descartaba en silencio).
- **PATCH no destructivo:** solo se escriben campos en `body.__fields_set__`. Campo ausente nunca se toca.

---

## 1. CREAR EXTERNO (`crearReclamo` — form.js; HTML `nuevoReclamoForm`)

Campos visibles:
| Campo | Control | ID | Envía a backend |
|---|---|---|---|
| Título * | input texto | `recTitulo` | `titulo` (obligatorio) |
| Proyecto/Obra | combobox (input+datalist, hidden select) | `recProyectoSearch`/`recProyecto` | `id_proyecto` |
| (Crear obra inline) | botón | — | flujo aparte |
| Año calidad | number | `recAnioCalidad` | `anio_calidad` |
| N° calidad | number | `recNumeroCalidad` | `numero_calidad` |
| Categoría * | select | `recTipoReclamo` | `tipo_reclamo` |
| Fecha detección | date | `recFechaDeteccion` | `fecha_deteccion` |
| Detectado por | select | `recDetectadoPor` | `detectado_por` |
| Cubicador Responsable | combobox | `recResponsableSearch`/`recResponsable` | `cubicador_asignado` + `responsable` (display) |
| (USC) | input hidden | `recAsignadoA` | `asignado_a` (auto-asigna creador en backend) |
| Descripción | textarea | `recDescripcion` | `descripcion` |
| Evidencia | dropzone | `recCreateDropZone` | sube imágenes tipo `antecedente` tras crear |

Reglas: Responsable = **cualquier usuario** (sin filtro de rol). POST `/reclamos`. Tras éxito: limpia campos, cierra modal, recarga lista + landing.

---

## 2. CREAR INTERNO (`crearReclamoInterno` — internos.js; HTML `nuevoReclamoInternoForm`)

Campos visibles:
| Campo | Control | ID | Envía a backend |
|---|---|---|---|
| Título * | input texto | `recIntTitulo` | `titulo` (obligatorio) |
| Cliente/Obra | combobox | `recIntProyectoSearch`/`recIntProyecto` | `id_proyecto` (opcional) |
| Año calidad | number | `recIntAnioCalidad` | `anio_calidad` |
| N° calidad | number | `recIntNumeroCalidad` | `numero_calidad` |
| Categoría * | select | `recIntTipoReclamo` | `tipo_reclamo` |
| Fecha detección | date | `recIntFechaDeteccion` | `fecha_deteccion` |
| **Área responsable (destino) *** | combobox | `recIntAreaSearch`/`recIntAreaDestino` | `area_id` (obligatorio) |
| Descripción | textarea | `recIntDescripcion` | `descripcion` |
| Evidencia | dropzone | `recIntCreateDropZone` | sube imágenes tras crear |

Reglas: envía `tipo_origen:'interno'` + `area_id`. **NO** hay: Detectado por (se infiere de `creado_por`), ni Responsable usuario (lo asigna el backend = Jefe de Servicio del área). `recIntResponsable` es input hidden no usado por el usuario. POST `/reclamos`. Tras éxito: limpia, cierra, recarga lista internos + landing.

**Diferencia clave vs externo:** Área destino en lugar de Cubicador Responsable; sin "Detectado por".

---

## 3. EDITAR (compartido hoy: `toggleEditarReclamo` + `guardarEdicionReclamo` — detail-edit.js; HTML `recEditForm`)

Form único con bifurcación `if (esInterno)`. Campos:
| Campo | ID | Externo | Interno |
|---|---|---|---|
| Título * | `recEditTitulo` | ✓ | ✓ |
| Categoría | `recEditTipo` | ✓ | ✓ |
| Fecha detección | `recEditFechaDeteccion` | ✓ | ✓ |
| Año calidad | `recEditAnioCalidad` | ✓ (solo admin) | ✓ (solo admin) |
| N° calidad | `recEditNumeroCalidad` | ✓ | ✓ |
| Proyecto/Obra | `recEditProyecto` | ✓ | ✓ |
| Detectado por | `recEditDetectadoPorWrap` | ✓ | **oculto** |
| Responsable (usuario) | `recEditResponsableWrap` | ✓ (cualquier usuario) | **oculto** |
| USC Responsable | `recEditAsignadoAWrap` | ✓ (solo admin) | oculto |
| Área responsable | `recEditAreaWrap` | oculto | ✓ (solo admin; reusa options de `recIntAreaDestino`) |
| Descripción | `recEditDescripcion` | ✓ | ✓ |

Guardado (PATCH `/reclamos/{id}`):
- Comunes: titulo, descripcion, tipo_reclamo, fecha_deteccion, anio/numero_calidad, id_proyecto.
- Externo: + `detectado_por`, `responsable`+`cubicador_asignado` (del select), `asignado_a` (USC, solo admin).
- Interno: + `area_id` (solo admin) → backend recalcula Jefe de Servicio (`cubicador_asignado`+`responsable`).
- Permiso editar: admin/admin_calidad, o usc creador. Bloqueado si validado y no-admin.

**Bug histórico corregido (no reintroducir):** poblar Responsable filtrando por rol `cubicador`/`externo` dejaba el select vacío (responsable con otro rol). Debe poblarse con TODOS los usuarios.

---

## 4. RENDER DETALLE / modo lectura (detail-render.js + detail-permissions.js)

Header (`_renderReclamoHeader`): título con correlativo, meta (proyecto, creado_por, fecha, responsable, detectado_por, USC), badge estado.
- **Obra en header:** SIEMPRE texto plano (`recDetailProyectoDisplay`), nunca desplegable. Editar obra solo vía Editar.
- **Externo:** USC visible como texto en la meta. NO hay selector de reasignación en el header.
- **Interno:** Área visible como texto (`recDetailAreaDisplay` en `recDetailAreaWrapDisplay`). NO selector de usuario.
- **Reasignación (ambos):** solo entrando a Editar. El header no reasigna.

Permisos (`_applyReclamoDetailPermissions`): botón Editar visible solo en abierto/en_analisis para admin o usc creador. Form de análisis/respuesta read-only fuera de análisis (todos los roles). Secciones de flujo (ámbar/verde) solo en contexto Validaciones.

---

## 5. CRUCES que NO se deben alterar al separar (compartidos por ambos tipos)

- **Método RCA** (Ishikawa / 5 Por Qué): `_initRcaMetodoParaReclamo`, `_setRcaMetodo`. Si el área no tiene matriz usable (≥1 sub-causa) → 5 Por Qué forzado.
- **Matriz Ishikawa:** `_cargarMatrizIshikawa` (cache por área, se invalida en `verReclamo` y al guardar matriz). Modal `abrirIshikawaModal`.
- **5 Por Qué:** `_render5PQData`, `_agregar5PQ`.
- **Acciones correctivas:** `agregarAccion`, `renderAcciones`.
- **Validaciones/flujo:** enviar a revisión/validación, aprobar/devolver, reabrir (detail-flow.js).
- **PDF e imágenes:** `descargarPdfReclamo`, dropzones de antecedentes/respuesta.

Estos son compartidos legítimamente (el análisis RCA es igual para interno y externo). La separación 5I.19 NO los toca: solo separa creación/edición/render del **encabezado y datos generales**.

---

## 6. Checklist de validación post-separación (para 5I.19.4)

- [ ] Crear externo: todos los campos de §1, responsable cualquier usuario, sube imágenes.
- [ ] Crear interno: campos de §2, área obligatoria, sin Detectado por / Responsable usuario.
- [ ] Editar externo: campos de §3 col Externo; responsable precargado correctamente.
- [ ] Editar interno: campos de §3 col Interno (sin Detectado por / Responsable usuario); reasignar área guarda y recalcula jefe de servicio.
- [ ] Detalle externo: obra texto, USC en meta, sin selector reasignación en header.
- [ ] Detalle interno: área como texto, sin selector usuario.
- [ ] Cruces §5 intactos: RCA Ishikawa/5PQ, acciones, validaciones, PDF — sin cambios.
