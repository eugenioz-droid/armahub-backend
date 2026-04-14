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

- [ ] PC.1 Notificaciones de reclamos
- [ ] PC.2 Automatismos de cambio de estado en validacion
- [ ] PC.3 Nuevas apps no relacionadas a cubicacion dentro del portal
- [ ] PC.4 Repositorio de archivos e imagenes separado si el modulo de calidad sigue creciendo
- [ ] PC.5 Solicitudes/pedidos específicos — paquetes de pedido independientes de la cubicación importada, con ubicación, aislables de la data principal. Usuarios y clientes podrán crearlos como solicitudes adicionales.
- [ ] PC.6 Tab "Roles y Permisos" en módulo Admin — implementar tablas de ROLES_Y_PERMISOS.md como vista interactiva
	- [ ] PC.6.1 Tabla 1a: Acceso a módulos (calugas del Hub)
	- [ ] PC.6.2 Tabla 1b: Acceso a tabs dentro de cada módulo
	- [ ] PC.6.3 Tabla 2a: Landing (Hub principal) — indicadores
	- [ ] PC.6.4 Tabla 2b: Reclamos — Vistas analíticas
	- [ ] PC.6.5 Tabla 2c: Cubicación — Vistas
	- [ ] PC.6.6 Tabla 3a: Autenticación y usuarios
	- [ ] PC.6.7 Tabla 3b: Admin técnico
	- [ ] PC.6.8 Tabla 3c: Proyectos y barras (cubicación)
	- [ ] PC.6.9 Tabla 3d: Reclamos
	- [ ] PC.6.10 Tabla 3e: Pedidos, calculistas, constructoras
- [ ] PC.7 Campo "USC responsable" en formulario de registro de reclamos — desplegable con usuarios USC; bloqueado para USC (auto-asigna), desbloqueado para admin/admin2. Revisar tablas 3d de ROLES_Y_PERMISOS.md.
- [ ] PC.8 Migrar formularios de reclamos (registro, análisis, detalle) a modales — eliminar scroll, mejorar UX. Evaluar reutilizar FormRenderer y modals.js existentes.
- [ ] PC.9 Revisar administración de proyectos/clientes/constructoras/calculistas — definir flujo correcto de gestión de entidades, permisos granulares por rol, y relación entre ellas. Actualizar tabla 3e de ROLES_Y_PERMISOS.md.
- [ ] PC.10 Rediseñar flujo de carga de datos (importación Excel) — actualmente el sistema asume la obra destino y la crea automáticamente. Cambiar a: crear obra primero, luego el cubicador elige dónde cargar. Agregar warning por coincidencia de nombre para prevenir errores de carga.

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
