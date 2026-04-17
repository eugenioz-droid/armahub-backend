# Roadmap Operativo - Abril 2026

Este roadmap reemplaza el documento historico anterior y parte desde el estado real verificado del repositorio. La intencion es ordenar el trabajo en dos lineas simultaneas:

- estabilizacion y refactor estructural
- entrega de features nuevas sobre una base modular

---

## Estado Base Confirmado

### Completado

- [x] EC.1 Backend FastAPI con PostgreSQL y migraciones versionadas
- [x] EC.2 Auth JWT y RBAC operativo
- [x] EC.3 Hub con modulos de Cubicacion, Reclamos y Administracion
- [x] EC.4 Importacion CSV ArmaDetailer con validaciones y trazabilidad
- [x] EC.5 Dashboards de cubicacion, matriz constructiva y exportacion a aSa Studio
- [x] EC.6 Gestion de obras, cargas, pedidos, calculistas y constructoras
- [x] EC.7 Flujo principal de reclamos: registro, respuesta, validacion y presentaciones
- [x] EC.8 Templates Jinja separados y assets estaticos

### Deuda tecnica confirmada

- [x] DT.1 app.js sigue siendo monolitico y concentra demasiadas responsabilidades
- [x] DT.2 Reclamos mantiene contratos y nomenclaturas mezcladas entre legacy y canonico
- [x] DT.3 La documentacion tecnica estaba desalineada con el estado real del repo
- [x] DT.4 El Hub todavia no esta formalizado como shell modular con registro de calugas

---

## Programa de Trabajo

### Fase A - Estabilizacion de Reclamos

Objetivo: dejar Reclamos como modulo confiable antes de extraerlo.

- [x] A.1 Identificar la causa de "respuesta invalida" en Presentaciones
- [x] A.2 Corregir deriva entre endpoint legacy y endpoint canonico de detalle
- [x] A.3 Normalizar contrato de imagenes y fechas en reclamos
- [x] A.4 Invalidar cache de reclamos al mutar datos
- [x] A.5 Mantener separados los repositorios de imagenes de registro y de analisis
- [ ] A.6 Revisar humo funcional completo: listar, abrir, responder, validar, presentar, subir imagen

### Fase B - Limpieza estructural minima de Reclamos

Objetivo: eliminar duplicaciones y compatibilidades ocultas antes de extraer modulos.

- [x] B.1 Crear normalizador unico para listado y detalle de Reclamos
- [x] B.2 Dejar una sola implementacion activa para Presentaciones
- [x] B.3 Dejar una sola implementacion activa para detalle principal de Reclamos
- [x] B.4 Mover compatibilidad legacy a adaptadores explicitos
- [x] B.5 Separar render de detalle, acciones e imagenes sin salir aun de app.js
- [ ] B.6 Confirmar smoke test funcional con imagen rosada y celeste por separado

### Fase C - Nucleo compartido del frontend

Objetivo: sacar de app.js todo lo transversal antes de extraer modulos.

- [x] C.1 Extraer cliente HTTP compartido
- [x] C.2 Extraer auth y sesion
- [x] C.3 Extraer helpers DOM
- [x] C.4 Extraer formateadores de fecha y numeros
- [x] C.5 Extraer modales, uploads e infraestructura de Chart.js
- [x] C.6 Dejar app.js solo como bootstrap temporal

### Fase D - Shell del portal y registro de calugas

Objetivo: preparar ArmaHub para crecer como portal.

- [x] D.1 Crear app/bootstrap.js
- [x] D.2 Crear app/shell.js
- [x] D.3 Crear app/registry.js
- [x] D.4 Definir contrato de registro para modulos y calugas
- [x] D.5 Mover el Hub a un modelo de modulos registrados por permisos
- [x] D.6 Permitir nuevas calugas sin tocar logica interna de Cubicacion o Reclamos

### Fase E - Extraccion por modulos

Objetivo: separar negocio por features reales.

- [x] E.1 Extraer Reclamos a features/reclamos/
	- [x] E.1.1 Crear features/reclamos/index.js como punto de entrada del feature
	- [x] E.1.2 Cargar el feature desde app/bootstrap.js con sincronizacion de readiness
	- [x] E.1.3 Delegar loadReclamosModule y tabs al feature con fallback temporal
	- [x] E.1.4 Mover estado y helpers base de Reclamos fuera de app.js
	- [x] E.1.5 Mover Presentaciones y utilidades ligadas al feature
	- [x] E.1.6 Limpiar app.js, dejar wrappers minimos y cerrar E.1
		- [x] E.1.6a Mover funciones core de Reclamos al feature
		- [x] E.1.6b Eliminar bloque RECLAMOS de app.js
		- [x] E.1.6c Actualizar IIFE wrapper y eliminar legacy bridging
- [x] E.2 Mantener images.js con separacion explicita entre ImagenesRegistro y ImagenesAnalisis
	- Nota: ya cubierto por shared/uploads.js + shared/modals.js + normalizers en features/reclamos/index.js. No requiere archivo adicional.
- [x] E.3 Extraer Portal a features/portal/
	- [x] E.3.1 Crear features/portal/index.js (Inicio + Mi Actividad + Landing Indicadores)
	- [x] E.3.2 Cargar portal en paralelo con reclamos desde bootstrap.js
	- [x] E.3.3 Eliminar bloques INICIO, MI ACTIVIDAD y LANDING INDICADORES de app.js
- [x] E.4 Extraer Cubicacion por submodulos: index, helpers, obras, filtros, import, barmanager, exportacion, dashboards, pedidos → 9 archivos en features/cubicacion/
- [x] E.5 Extraer Admin por features: usuarios, proyectos, constructoras, calculistas, auditoria
	- [x] E.5.1 Crear features/admin/ (3 archivos: index, entidades, proyectos)
	- [x] E.5.2 Actualizar bootstrap.js para cargar scripts admin
	- [x] E.5.3 Eliminar código extraído de app.js + validar errores
- [x] E.6 Dejar legacy/compat.js para wrappers temporales
	- [x] E.6.1 Crear legacy/compat.js (bridges: waitForReclamosFeatureReady, loadReclamosModule)
	- [x] E.6.2 Actualizar bootstrap.js: cargar compat.js → app.js → features
	- [x] E.6.3 Limpiar app.js: eliminar bridges, _proyectosData muerto, 30 comentarios de delegación (~75 líneas finales)
- [x] E.7 Corregir bugs de imagenes en Reclamos
	- [x] E.7.1 Presentaciones: click en thumbnail no abre viewer (self._openImageModal → self.openImageModal)
	- [x] E.7.2 Formulario registro: drop zones no se enlazan si DOM no existe al init (guard condicional)
	- [x] E.7.3 Corregir XSS en renderImagenesEnContainer (migrar de innerHTML string a DOM API)

### Fase F - Limpieza backend por contratos

Objetivo: consolidar contratos y reducir drift.

- [x] F.1 Unificar respuestas por dominio en reclamos
	- [x] F.1.1 Unificar mutaciones: todas devuelven `{"ok", "id"}` (presentar, eliminar_accion, eliminar_imagen)
	- [x] F.1.2 Eliminar endpoint legacy `GET /reclamos/{id}/detail` (alias puro sin consumidores)
	- [x] F.1.3 Normalizar analytics: `por_estado`, `por_categoria`, `por_prioridad`, `por_aplica` → array `[{key, count}]` en admin-dashboards y kpis
	- [x] F.1.4 Estandarizar envelope de listados (`{"data":[...]}`)
		- [x] F.1.4a `GET /reclamos` → `{"data":[...]}` + adaptar loadReclamos
		- [x] F.1.4b `GET /reclamos/usuarios-usc` → `{"data":[...]}` + adaptar loadUsuariosUsc
		- [x] F.1.4c `GET /reclamos/ishikawa` → `{"data":[...]}` + adaptar consumidores
		- [x] F.1.4d `GET /reclamos/para-presentar` → `{"data":[...], "cubicadores":[...]}` + adaptar loadPresentaciones
		- [x] F.1.4e Eliminar endpoints muertos sin consumidores (`/reclamos/cubicadores`, `/reclamos/options`)
- [x] F.2 Mover logica pesada a servicios y queries donde valga la pena
- [x] F.3 Reducir rutas legacy con SQL propio
- [x] F.4 Definir helpers compartidos de permisos y respuestas
- [x] F.5 Preparar base para API versionada

---

## Backlog de Producto Confirmado

### Prioridad Alta

- [x] PA.1 Landing extensible con nuevas calugas y microflujos
- [x] PA.2 Implementar accesos por rol según matriz ROLES_Y_PERMISOS.md
	- [x] PA.2.1 Cuadro 1b: Acceso a tabs × rol
		- [x] PA.2.1a admin2 → acceso a módulo Cubicación (registry.js)
		- [x] PA.2.1b Reclamos tab Dashboards → solo admin/admin2
		- [x] PA.2.1c Reclamos tab Presentación → excluir usc
	- [x] PA.2.2 Cuadro 2: Dashboards/vistas × rol
		- [x] PA.2.2a Landing indicators (externo → propios en reclamos/alertas)
		- [x] PA.2.2b Reclamos vistas analíticas (build_role_filter, presentaciones)
	- [x] PA.2.3 Cuadro 3: Permisos/acciones × rol
		- [x] PA.2.3a Auth y usuarios (admin2 parcial)
		- [x] PA.2.3b Admin técnico (admin2 → ver DB/tablas/audit)
		- [x] PA.2.3c Proyectos y barras (5 endpoints deshabilitados, cliente sin acceso)
		- [x] PA.2.3d Reclamos (registro vs análisis, propiedad, imágenes separadas)
		- [x] PA.2.3e Pedidos/calculistas/constructoras (solo admin/admin2)
- [x] PA.3 Formalizar permisos por rol — documento ROLES_Y_PERMISOS.md creado
- [x] PA.4 Smoke tests minimos por modulo critico (22 tests, 20 pass, 2 pending deploy)
- [x] PA.5 Flujo rechazo validación: auto-reabre a en_analisis, limpia campos validación, seguimiento con motivo

### Prioridad Media

- [x] PM.1 API versionada bajo /api/v1
- [x] PM.2 CORS para integraciones externas futuras
- [x] PM.3 Observabilidad: logs estructurados y health util
- [x] PM.4 Mejoras de performance en queries sensibles y uso de cache

### Prioridad Condicionada a definicion

- [x] PC.1 Centro de notificaciones y configuración Admin — notificaciones in-app para reclamos + reestructuración del módulo Admin en tabs
	- [x] PC.1.1 Backend: tabla `notificaciones` (destinatario, tipo_evento, reclamo_id, mensaje, leida, fecha) + migración 43
	- [x] PC.1.2 Backend: tabla `notificacion_config` (evento, rol, activo) con defaults por evento + endpoints CRUD
	- [x] PC.1.3 Backend: generar notificaciones automáticas en crear_reclamo, PATCH estado, asignación
	- [x] PC.1.4 Backend: endpoints GET /notificaciones (mis pendientes), PATCH /notificaciones/{id}/leer, GET /notificaciones/config (admin)
	- [x] PC.1.5 Frontend: icono campana en header con badge contador + panel desplegable con lista
	- [x] PC.1.6 Frontend: marcar como leída al click, link directo al reclamo
	- [x] PC.1.7 Frontend: recarga contadores al navegar al hub (sin polling)
	- [x] PC.1.8 Landing: sección "Notificaciones recientes" en el hub como indicador rápido
	- [x] PC.1.9 Admin tab "Notificaciones": tabla de configuración evento × rol con checkboxes
	- [x] PC.1.10 Admin: reestructurar módulo en sub-tabs (General + Notificaciones)
	- [ ] PC.1.11 (Futuro) Notificaciones por email — integrar SMTP/servicio para enviar correo en eventos críticos
- [x] PC.2 Automatismos de cambio de estado en validacion
- [ ] PC.3 Nuevas apps no relacionadas a cubicacion dentro del portal
- [ ] PC.4 Repositorio de archivos e imagenes separado si el modulo de calidad sigue creciendo
- [ ] PC.5 Solicitudes/pedidos específicos — paquetes de pedido independientes de la cubicación importada, con ubicación, aislables de la data principal. Usuarios y clientes podrán crearlos como solicitudes adicionales.
- [x] PC.6 Tab "Roles y Permisos" en módulo Admin — implementar tablas de ROLES_Y_PERMISOS.md como vista interactiva
	- [x] PC.6.1 Tabla 1a: Acceso a módulos (calugas del Hub)
	- [x] PC.6.2 Tabla 1b: Acceso a tabs dentro de cada módulo
	- [x] PC.6.3 Tabla 2a: Landing (Hub principal) — indicadores
	- [x] PC.6.4 Tabla 2b: Reclamos — Vistas analíticas
	- [x] PC.6.5 Tabla 2c: Cubicación — Vistas
	- [x] PC.6.6 Tabla 3a: Autenticación y usuarios
	- [x] PC.6.7 Tabla 3b: Admin técnico
	- [x] PC.6.8 Tabla 3c: Proyectos y barras (cubicación)
	- [x] PC.6.9 Tabla 3d: Reclamos
	- [x] PC.6.10 Tabla 3e: Pedidos, calculistas, constructoras
	- [ ] PC.6.11 Ordenar tabs Admin — migrar de sub-tabs internos a tabs reales (como Reclamos/Cubicación), cada sección como tab independiente en la barra de tabs del módulo
- [x] PC.7 Campo "USC responsable" en formulario de registro de reclamos — desplegable con usuarios USC; bloqueado para USC (auto-asigna), desbloqueado para admin/admin2. Revisar tablas 3d de ROLES_Y_PERMISOS.md.
- [x] PC.8 Migrar formularios de reclamos (registro, análisis, detalle) a modales — eliminar scroll, mejorar UX. Evaluar reutilizar FormRenderer y modals.js existentes.
	- [x] PC.8.1 CSS modal overlay (backdrop + `.rec-modal-open` + animación + responsive breakpoints)
	- [x] PC.8.2 JS helpers `openReclamoModal()` / `closeReclamoModal()` con Escape y backdrop click
	- [x] PC.8.3 Detalle de reclamo se abre como modal (5 secciones + timeline dentro)
	- [x] PC.8.4 Formulario de registro se abre como modal
	- [x] PC.8.5 Coordinar z-index: modal(950) < Ishikawa(9999) < ImageViewer(10000)
	- [x] PC.8.6 Validar errores, permisos y flujo de cierre/eliminación
- [ ] PC.9 Revisar administración de proyectos/clientes/constructoras/calculistas — definir flujo correcto de gestión de entidades, permisos granulares por rol, y relación entre ellas. Actualizar tabla 3e de ROLES_Y_PERMISOS.md.
- [x] PC.10 Rediseñar flujo de carga de datos (importación CSV) — selector obligatorio de obra destino antes de importar. Drop zone deshabilitada hasta seleccionar obra. Backend recibe `obra_destino` y salta toda resolución de proyecto del CSV. Botón "Crear obra" movido al selector.
	- [x] PC.10.1 Frontend: selector `obraDestinoSelect` obligatorio con drop zone deshabilitada por defecto
	- [x] PC.10.2 Frontend: `importAllFiles()` simplificado — envía `?obra_destino=X`, elimina flujos de missing/new/duplicate project
	- [x] PC.10.3 Backend: param `obra_destino` en `/import/armadetailer` — resuelve directo, ignora `PROYECTO:` del CSV
	- [x] PC.10.4 Frontend: auto-seleccionar obra recién creada en el selector
	- [x] PC.10.5 Permitir mover cargas entre obras — seleccionar cargas desde modal detalle de obra, elegir obra destino, `POST /cargas/mover` mueve imports + barras
	- [x] PC.10.6 Modal de detalle de obra — reemplazar expandible inline por modal con sidebar (KPIs + metadata + autorizados), matriz constructiva estilo exportación (sin checkboxes, click→BarManager), árbol expandible de estructura, historial de cargas con bulk delete
	- [x] PC.10.7 Rediseño tab Inicio → Metrics — nuevo layout: cubicación mensual (chart full-width con nav ◀▶ por año), Top 15 proyectos (stacked bar Cargado/Exportado), Cubicadores (stacked bar), grilla 2×5 de KPIs (Kilos Tot, Diám Prom, Barras Tot, Items Tot, PPB, PPI, Cant Cargas, Kg/Carga, Cant Proyectos, Última Carga). Renombrado Inicio→Metrics en shell.js, default tab→Obras
	- [x] PC.10.8 Eliminar tab Dashboards de Cubicación — contenido integrado en Metrics, tab removido de app.html y shell.js
- [x] PC.11 Simplificar correlativos de reclamos — separar id_calidad en anio_calidad (int) + numero_calidad (int) para ordenamiento y carga retroactiva
	- [x] PC.11.1 Migración 44: columnas anio_calidad + numero_calidad en tabla reclamos + índice compuesto
	- [x] PC.11.2 Backend: modelos ReclamoCreate/ReclamoUpdate con campos nuevos, INSERT actualizado
	- [x] PC.11.3 Backend: endpoint GET /reclamos/siguiente-numero-calidad?anio=YYYY — sugiere MAX+1 del año
	- [x] PC.11.4 Backend: listado ordena por anio_calidad DESC, numero_calidad DESC (después de estado/prioridad)
	- [x] PC.11.5 Backend: detalle incluye anio_calidad + numero_calidad en response
	- [x] PC.11.6 Backend: PATCH soporta ambos campos, anio_calidad solo editable por admin/admin2
	- [x] PC.11.7 Frontend: formulario registro con campos Año calidad + N° calidad (auto-suggest al abrir)
	- [x] PC.11.8 Frontend: detalle header con campos Año + N° (onchange guarda directo)
	- [x] PC.11.9 Frontend: formulario edición con campos Año calidad + N° calidad
	- [x] PC.11.10 Frontend: lista y presentaciones muestran formato "YYYY-NNN" concatenado
	- [x] PC.11.11 Display: _formatCorrelativoCalidad() formatea como "2026-003", fallback a id_calidad legacy
- [x] PC.12 Regularizar matriz de roles post-cambios — actualizado ROLES_Y_PERMISOS.md con permisos nuevos (mover/bulk-delete cargas, reimportar CSV, notificaciones, año calidad, acciones correctivas CRUD, validación, etc.), renombrado secciones, eliminados tabs obsoletos (Dashboards, Presentación), agregado §3f Notificaciones y 6 observaciones de seguridad. Tab Roles y Permisos del panel Admin sincronizado (roles_permisos.js). Subtabs admin restyled a folder-tabs.
- [x] PC.13 Revisar permisos y acceso a acciones de obra por rol — bug técnico corregido: `apiPostJson` reemplazó `apiPost` para `POST /cargas/mover`. Modelo de permisos granulares pendiente para fase futura (ver ROADMAP_RECLAMOS.md R8).
- [x] PC.14 Reimportación CSV reemplaza carga completa por eje — antes del UPSERT se ejecuta `DELETE FROM barras WHERE id_proyecto AND plano_code IN (...)` para los plano_codes del CSV. Barras eliminadas del CSV desaparecen de la BD. Sin huérfanas ni tonelaje duplicado.
- [x] PC.16 Fix desync JWT/BD en roles + cubicador restringido a propios con toggle — `get_current_user` lee rol fresco de BD; `build_role_filter` y listado filtran cubicador como propios; toggle "Todos/Mis Reclamos" en UI; protección análisis solo propios en frontend; ROLES_Y_PERMISOS.md y roles_permisos.js actualizados
- [ ] PC.15 Informe PDF de reclamo + envío por correo
	- [ ] PC.15.1 Agregar `xhtml2pdf` a requirements.txt
	- [ ] PC.15.2 Crear template Jinja2 `templates/pdf/reclamo_informe.html` — layout del informe: header (logo, correlativo, fecha, estado, prioridad), sección Registro (título, descripción, proyecto/cliente, categoría, detectado por, fecha detección), sección Análisis (respuesta, causa Ishikawa, área responsable, kilos, tiempo respuesta), sección Acciones correctivas/preventivas (tabla), sección Validación (resultado, observaciones, fecha, validado por), imágenes antecedentes + respuesta (thumbnails inline ~300px), timeline de seguimientos
	- [ ] PC.15.3 CSS embebido para PDF — tipografía, márgenes, tablas, imágenes, saltos de página, colores por estado/prioridad
	- [ ] PC.15.4 Backend: endpoint `GET /reclamos/{id}/pdf` — carga detalle completo + imágenes (base64 inline), renderiza template, devuelve `Response(application/pdf)`. Permisos: admin, admin2, cubicador (si es propio), usc
	- [ ] PC.15.5 Frontend: botón "📄 PDF" en modal de detalle del reclamo — abre nueva pestaña con `apiUrl('/reclamos/' + id + '/pdf')`. Visible para roles con permiso
	- [ ] PC.15.6 Revisar layout y validar que el PDF refleje correctamente todas las secciones del reclamo (QA visual: campos largos, imágenes grandes, sin acciones, sin validación, etc.)
	- [ ] PC.15.7 Backend: configuración SMTP — env vars `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Helper `send_email(to, subject, body_html, attachments)` reutilizable. Validar conexión en health check. (Cierra también PC.1.11)
	- [ ] PC.15.8 Backend: tabla `reclamo_envios` (id, reclamo_id, destinatarios JSON, fecha, enviado_por, estado) — registro de envíos para trazabilidad. Migración correspondiente
	- [ ] PC.15.9 Backend: endpoint `POST /reclamos/{id}/enviar-informe` — genera PDF, envía por correo a destinatarios seleccionados (cliente, USC, cubicador, emails adicionales). Registra en `reclamo_envios` + seguimiento automático ("Informe enviado a: X, Y"). Permisos: admin, admin2
	- [ ] PC.15.10 Frontend: columna "Envío" en lista de reclamos — visible para admin/admin2. Reclamos cerrados sin enviar muestran botón "📧" (acción directa). Reclamos ya enviados muestran badge "✉️ Enviado" con tooltip (fecha + destinatarios). Reclamos no cerrados muestran "—"
	- [ ] PC.15.11 Frontend: al click en "📧" abre mini-modal inline con checkboxes (USC asignado, cubicador asignado, emails adicionales) + campo texto para emails extra. Botón "Enviar" ejecuta POST. Feedback con toast
	- [ ] PC.15.12 Backend: endpoint `GET /reclamos/{id}/envios` — historial de envíos de un reclamo (fecha, destinatarios, enviado_por). Consumido desde detalle del reclamo
	- [ ] PC.15.13 Frontend: sección "Historial de envíos" en modal de detalle — tabla compacta con fecha, destinatarios, enviado por. Visible para admin/admin2
	- [ ] PC.15.14 Dashboard: indicadores de envíos en tab Dashboards de Reclamos — total enviados/pendientes, % cobertura de reclamos cerrados, envíos por mes. Visible para admin/admin2
- [ ] PC.17 Split `features/reclamos/index.js` (3,067 líneas → 8 archivos) — extraer dominios a archivos independientes, eliminar clases legacy muertas, actualizar bootstrap.js
	- [ ] PC.17.1 Extraer `constants.js` — dicts de colores/labels, estado global (`_reclamoActual`, `_FECHA_OPERATIVA`, etc.)
	- [ ] PC.17.2 Extraer `helpers.js` — normalizers, adapters legacy, `_calcDiasReclamo`, `_diasBadgeHtml`, `_formatCorrelativoCalidad`
	- [ ] PC.17.3 Extraer `dashboards.js` — `switchRecTab`, `loadRecLanding`, `loadRecAdminDashboards` (9 charts)
	- [ ] PC.17.4 Extraer `presentaciones.js` — `loadPresentaciones`, render, nav, `guardarPresentacion`, `loadPresStats`
	- [ ] PC.17.5 Extraer `list.js` — `loadReclamos`, filtros, scope toggle, `loadRecUsersDropdown`
	- [ ] PC.17.6 Extraer `form.js` — modal helpers (PC.8), `crearReclamo`, crear proyecto/calc/const inline
	- [ ] PC.17.7 Extraer `detail.js` — detalle completo: render, permisos, edición, estado, análisis, validación, acciones CRUD, imágenes/drop zones, seguimientos, ishikawa
	- [ ] PC.17.8 Limpiar `index.js` — dejar solo IIFE registration + `_loadReclamosModule` + exports
	- [ ] PC.17.9 Actualizar `bootstrap.js` — cargar 8 scripts en orden correcto de dependencias
	- [ ] PC.17.10 Eliminar clases muertas — `FormRenderer`, `ReclamoPresenter`, `ReclamoUtils`, `ImageRenderer` (~410 líneas)
	- [ ] PC.17.11 Smoke test: listado + filtros + scope toggle
	- [ ] PC.17.12 Smoke test: detalle + edición + acciones + imágenes + ishikawa + seguimientos
	- [ ] PC.17.13 Smoke test: presentaciones + dashboards + landing

---

## Orden Recomendado de Ejecucion

1. Terminar Fase A de estabilizacion de Reclamos.
2. Ejecutar Fase B de limpieza estructural minima en Reclamos.
3. Extraer shared/core del frontend en Fase C.
4. Implementar shell del portal y registro de calugas en Fase D.
5. Sacar Reclamos completo de app.js en Fase E.
6. Extraer Cubicacion y Admin dentro de Fase E.
7. Recien despues abrir features nuevas sobre la nueva estructura.

## Secuencia Operativa Detallada

### Bloque 1 - Cierre tecnico de Reclamos

1. Consolidar shape canonico de listado. (B.1)
2. Consolidar shape canonico de detalle. (B.1)
3. Dejar un solo flujo activo para Presentaciones. (B.2)
4. Dejar un solo flujo activo para detalle principal. (B.3)
5. Aislar compatibilidad legacy en adaptadores. (B.4)
6. Verificar rosado y celeste por separado en uploads y render. (B.6)

### Bloque 2 - Base compartida

1. Extraer api.js. (C.1)
2. Extraer auth.js. (C.2)
3. Extraer dom.js. (C.3)
4. Extraer dates.js y formatters. (C.4)
5. Extraer uploads.js. (C.5)
6. Dejar app.js como bootstrap temporal. (C.6)

### Bloque 3 - Shell del portal

1. Crear bootstrap.js. (D.1)
2. Crear shell.js. (D.2)
3. Crear registry.js. (D.3)
4. Registrar modulos y calugas por permisos. (D.4-D.6)

### Bloque 4 - Extraccion de Reclamos

1. landing.js. (E.1)
2. list.js. (E.1)
3. detail.js. (E.1)
4. ishikawa.js. (E.1)
5. images.js con separacion rosado/celeste. (E.2)
6. presentaciones.js. (E.1)
7. limpieza de wrappers transitorios. (E.6)

---

## Criterio de Exito

El roadmap va bien si se cumplen estas condiciones:

- nuevas features dejan de entrar a app.js
- cada modulo tiene dueno tecnico claro
- las calugas del landing se agregan por registro y no por parche manual
- Reclamos deja de depender de rutas legacy inestables
- la documentacion vuelve a describir el sistema real
