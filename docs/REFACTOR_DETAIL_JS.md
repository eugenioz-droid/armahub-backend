# Programa de refactor — `detail.js` (módulo Reclamos)

> **Objetivo doble:** (1) dividir el archivo `detail.js` (1.290 líneas, demasiado grande, mezcla responsabilidades) en piezas manejables; (2) dejar el código en bloques **reutilizables** para construir el **segundo listado (Reclamos Internos)** sin duplicar lógica.
>
> **Estado:** PLANIFICADO. No iniciado.
> **Regla de oro:** refactor sin cambio de comportamiento. Cada fase debe dejar la app funcionando idéntica. Commits chicos por fase, push y prueba en la página antes de seguir.

---

## 1. Diagnóstico del estado actual

### Archivos del módulo `static/js/features/reclamos/`
| Archivo | Líneas | Responsabilidad | ¿Reutilizable para Internos? |
|---|---|---|---|
| `constants.js` | 47 | Labels/colores de estado, aplica, ishikawa | Sí, tal cual |
| `helpers.js` | 161 | Normalizadores, cálculo de días, correlativo, causa display | Sí, tal cual |
| `list.js` | 252 | Tabla de Clientes + filtros + toggles | **Parcial** — la tabla y filtros se reciclan; hoy están atados a Clientes |
| `form.js` | 249 | Form de creación | Parcial (Internos tendrá su propio form) |
| `dashboards.js` | 695 | Landing, KPIs, sub-tabs, colas de Validaciones | Parcial |
| `detail.js` | **1.290** | **TODO el modal de ficha** (ver desglose abajo) | **Sí, es el principal a reciclar** |
| `presentaciones.js` | 470 | Feature presentaciones | No (otra feature) |
| `index.js` | 130 | Orquestador: carga, expone API vía `window` | Se amplía con los nuevos archivos |

### Desglose funcional de `detail.js` (lo que hay que separar)
Agrupando las ~55 funciones por responsabilidad:

| Grupo | Funciones | ¿Genérico o específico? |
|---|---|---|
| **A. Render de ficha** | `_renderReclamoHeader`, `_renderReclamoAntecedentes`, `_renderReclamoRespuesta`, `_renderReclamoValidacion`, `_renderReclamoActionsSection`, `_renderReclamoImagesSection`, `_renderReclamoTimelineSection`, `_renderReclamoAssets`, `_renderReclamoDetail`, `_populateReclamoDetailSelectors` | Genérico (sirve a cualquier listado) |
| **B. Permisos / visibilidad** | `_applyReclamoDetailPermissions` (115 líneas, la más compleja) | Genérico pero con reglas de flujo |
| **C. Navegación del modal** | `verReclamo`, `_updateRecNavButtons`, `recNavPrevReclamo`, `recNavNextReclamo`, `openReclamoModal`, `closeReclamoModal` | Genérico |
| **D. Borrador de análisis** | `_captureReclamoAnalysisDraft`, `_restoreReclamoAnalysisDraft` | Genérico |
| **E. Acciones de flujo** | `cerrarReclamo`, `aprobarParaValidacion`, `devolverRevisionDesdeModal`, `aprobarValidacionDesdeModal`, `devolverValidacionDesdeModal`, `reabrirReclamo`, `_refrescarTrasAccionFlujo` | Genérico (el flujo es el mismo) |
| **F. Edición de datos** | `toggleEditarReclamo`, `guardarEdicionReclamo`, `guardarAnioNumeroCalidad`, `cambiarProyectoReclamo`, `cambiarAsignadoAReclamo`, `loadUsuariosUsc` | Genérico |
| **G. Respuesta / análisis** | `guardarRespuesta`, `cambiarAplicaReclamo`, `_updateAplicaBadge`, `clearReclamoCausa`, `_clearReclamoCausaFields` | Genérico |
| **H. Acciones (medidas)** | `agregarAccion`, `refreshAccionesList`, `eliminarAccion`, `limpiarFormularioAcciones`, `renderAcciones` | Genérico |
| **I. Imágenes / uploads** | `_initDropZone`, `_addCreatePreview`, `_uploadFilesWithTipo`, `initRecImageDropZones`, `eliminarImagen`, `renderImagenesEnContainer` | Genérico |
| **J. Seguimientos / timeline** | `agregarSeguimiento`, `renderReclamoTimeline` | Genérico |
| **K. Ishikawa modal** | `abrirIshikawaModal`, `seleccionarIshikawa`, `confirmarIshikawa`, `cerrarIshikawaModal` | Genérico |
| **L. PDF / varios** | `descargarPdfReclamo`, `eliminarReclamo` | Genérico |

**Conclusión:** casi todo `detail.js` es genérico. Lo específico de "Clientes" no está en `detail.js` sino en `list.js` (la tabla y filtros). El modal de ficha ya sirve para ambos listados — solo hay que dividirlo para que sea legible y mantenible.

---

## 2. División propuesta de `detail.js`

Partir el archivo en 4 nuevos, por responsabilidad. Todos siguen el patrón actual (funciones file-scope expuestas vía `window`, cargadas por el orquestador):

| Nuevo archivo | Contiene (grupos) | Líneas aprox. |
|---|---|---|
| `detail-render.js` | A (render) + D (borrador) + J (timeline render) | ~380 |
| `detail-permissions.js` | B (permisos/visibilidad) | ~130 |
| `detail-flow.js` | E (acciones de flujo) + C (navegación modal) | ~280 |
| `detail-edit.js` | F (edición) + G (respuesta) + H (acciones) + I (uploads) + K (ishikawa) + L (varios) | ~500 |

`detail.js` desaparece o queda como cascarón mínimo. El orquestador (`index.js`) carga los 4 nuevos en orden de dependencia.

> **Criterio del corte:** que cada archivo tenga una sola razón para cambiar. Render no debería tocarse al cambiar una regla de permisos; el flujo no debería tocarse al agregar un campo al form.

---

## 3. Preparación para el segundo listado (Reclamos Internos)

El reciclaje real no es de `detail.js` (que ya es genérico) sino de **`list.js`**. Hoy `loadReclamos`, la tabla y los filtros están escritos para Clientes con IDs DOM fijos (`reclamosList`, `recFiltro*`). Para Internos hay que parametrizar.

### 3.1 Extraer el renderizador de tabla genérico
- Sacar de `list.js` el bloque que arma la tabla (`reclamos.map(...)` → `<tr>`) a una función `renderReclamosTabla(reclamos, opts)` que reciba el container y las columnas. Internos podría tener columnas distintas (área origen/destino en vez de proyecto/cubicador).
- `verReclamo(id, {origen})` ya es genérico; el `{origen:'lista'}` debe poder ser `'internos'` también. Revisar la lógica de contexto del modal (hoy deriva de `recSubValidaciones` visible — ver `detail-permissions.js`).

### 3.2 Parametrizar `loadReclamos`
- Hoy lee IDs DOM hardcodeados. Opciones: (a) factory `crearListadoReclamos(config)` que reciba los IDs de filtros y container; (b) pasar un objeto `config` a `loadReclamos`. Internos llamaría con su propia config.
- El endpoint `/reclamos` ya filtra por parámetros; Internos agregará un filtro de "tipo" (cliente/interno) — **definir en backend** una columna o flag que distinga reclamo cliente vs interno (decisión pendiente, ligar con el modelo de áreas del Plan 2).

### 3.3 Qué se recicla tal cual (sin tocar)
- `constants.js`, `helpers.js` completos.
- Todo el modal de ficha (los 4 nuevos `detail-*.js`).
- Las acciones de flujo (mismo flujo revisión/validación).

### 3.4 Qué es nuevo para Internos (no reciclable)
- Su propio sub-panel HTML (hoy placeholder en `recSubInternos`).
- Su form de creación (campos distintos: área origen, área destino).
- La columna/flag backend que separa cliente de interno.

---

## 4. Plan de ejecución por fases (cada una: commit + push + prueba)

> Orden pensado para que nada se rompa entre fases. Si los créditos no alcanzan, se corta en cualquier fase completada.

**Fase 0 — Red de seguridad (antes de mover nada)**
- Snapshot del comportamiento actual: lista de funciones expuestas en `window` tras cargar el módulo (para verificar que ninguna desaparezca tras dividir).
- Confirmar el orden de carga en `index.js` y el mecanismo de exposición.

**Fase 1 — Extraer `detail-render.js`** (grupos A, D, J-render)
- Mover funciones, agregar el archivo al orquestador, exponer en `window`.
- Prueba: abrir un reclamo, ver que la ficha renderiza igual (header, antecedentes, respuesta, imágenes, timeline).

**Fase 2 — Extraer `detail-permissions.js`** (grupo B)
- Mover `_applyReclamoDetailPermissions`.
- Prueba: read-only por etapa, secciones ámbar/verde solo en Validaciones, botones por rol.

**Fase 3 — Extraer `detail-flow.js`** (grupos E, C)
- Mover acciones de flujo + navegación.
- Prueba: enviar a revisión, aprobar, devolver, validar, cerrar, reabrir, navegación prev/next.

**Fase 4 — Extraer `detail-edit.js`** (grupos F, G, H, I, K, L)
- Mover el resto. `detail.js` queda vacío o se elimina.
- Prueba: editar datos, guardar respuesta, agregar/eliminar acción, subir/eliminar imagen, ishikawa, PDF, eliminar reclamo.

**Fase 5 — Parametrizar `list.js`** (preparación Internos, grupo 3.1/3.2)
- Extraer `renderReclamosTabla` y la config de `loadReclamos`. El listado Clientes pasa a usar la versión parametrizada (sin cambio visible).
- Prueba: el listado Clientes funciona idéntico con la nueva estructura.

**Fase 6 (fuera de este refactor) — Construir Internos**
- Usar las piezas recicladas. Requiere antes la decisión backend cliente/interno (Plan 2 / modelo de áreas). NO es parte del refactor; es el trabajo que el refactor habilita.

---

## 5. Riesgos y mitigaciones
- **Funciones que se llaman entre archivos:** todas viven en `window` (file-scope global), así que dividir no rompe las llamadas mutuas siempre que el orden de carga respete dependencias. Mitigación: el orquestador ya serializa la carga; mantener ese orden.
- **`onclick` inline en HTML:** apuntan a `window.fn`. Mientras la función siga expuesta con el mismo nombre, los `onclick` no se tocan. Mitigación: Fase 0 lista los nombres; verificar que sigan expuestos tras cada fase.
- **Variables de estado compartidas** (`_reclamoActual`, `_recModalOrigen`, `_ishikawaSelection`): hoy son file-scope de `detail.js`. Al dividir, varios archivos las necesitan. Mitigación: moverlas a un archivo cargado primero (ej. `detail-render.js` o un `detail-state.js` chico) y exponerlas, o mantenerlas en `window`.
- **Sin tests automatizados:** la verificación es manual en la página. Mitigación: checklist de prueba por fase (arriba). No avanzar de fase sin probar.

---

## 6. Decisiones pendientes (del usuario, antes de Fase 5/6)
- Modelo backend para distinguir reclamo **cliente** vs **interno** (¿columna `tipo_listado`? ¿se deriva del área?). Ligado al Plan 2 (modelo de áreas + flag de revisión).
- Columnas de la tabla de Internos (¿área origen/destino en vez de proyecto/cubicador?).
- Si Internos comparte el flujo de validación o tiene uno propio.
