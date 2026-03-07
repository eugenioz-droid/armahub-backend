Arquitectura actual y estado del proyecto

ArmaHub es una plataforma backend para gestión de datos de acero de refuerzo proveniente de Arma Detailer (Revit / GStarCAD). El sistema recibe archivos CSV exportados desde modelación, procesa la información de barras, calcula pesos de acero y permite visualizar estadísticas mediante un dashboard.

La arquitectura actual está compuesta por un backend desarrollado en Python con FastAPI, desplegado en Render, utilizando PostgreSQL como base de datos persistente. El backend expone una API REST protegida mediante autenticación JWT, que permite importar datos, consultarlos, filtrarlos y generar estadísticas.

Arquitectura modular basada en paquetes Python:
- **auth.py** — Autenticación JWT, login, registro, bootstrap
- **admin.py** — Endpoints administrativos (reset DB, info BD)
- **barras.py** — CRUD barras, filtros, dashboard, proyectos
- **importer.py** — Importación de CSV desde Arma Detailer
- **db.py** — Conexión Postgres, init_db, migraciones, reset
- **ui.py** — Interfaz web completa (HTML/JS/CSS inline)
- **main.py** — Punto de entrada FastAPI, monta routers y static

Actualmente el sistema ya cuenta con:

- Backend desplegado en Render (auto-deploy desde GitHub)
- Base de datos PostgreSQL persistente con migraciones automáticas
- Sistema de autenticación con usuarios y roles (admin, operador)
- Importación de CSV desde Arma Detailer con nombres legibles (proyectos + planos)
- Cálculo automático de peso de acero
- Dashboard con agrupaciones por múltiples dimensiones
- Filtros de consulta con nombres legibles
- Interfaz web con 7 tabs (5 operativas + 1 inicio + 1 admin)
- Panel de administración (solo admin): reset BD, crear usuarios, info BD
- Header con branding Armacero (logo banner, colores institucionales)

---

## ESTADO ACTUAL (6 Marzo 2026)

**Fase 0 — Preparación de datos**: 
- Extracción de nombres de proyectos y planos desde CSV
- Tabla proyectos + endpoints GET /proyectos y GET /proyectos/{id}/sectores

**Fase 1.1 — Hardening UI**: 
- Autenticación JWT, badges de usuario/rol, manejo de errores

**Fase 1.2 — Tabla de barras**: 
- Paginación, ordenamiento por columnas, búsqueda rápida
- Columnas nombre_proyecto y nombre_plano en tabla barras

**Fase 1.3 — Rediseño UX con estructura de tabs**: 
- 7 tabs funcionales + Tab Admin condicional por rol + colores Armacero

**Fase 1.4 — Nombres legibles**: 
- nombre_proyecto en barras (desde metadato CSV)
- nombre_plano en barras (desde metadato CSV)
- /filters devuelve planos como {code, nombre}
- Dashboard muestra nombres via COALESCE
- Migraciones ALTER TABLE automáticas en init_db

**Fase 1.5 — Panel Admin + Header redesign**: 
- Tab Admin (solo visible para rol admin)
- Reset de base de datos con doble confirmación (texto + popup)
- Gestión de usuarios desde UI (crear operador/admin)
- Info de BD en tiempo real (barras, proyectos, usuarios, kilos)
- Header oscuro (#1a1a1a) con título verde ArmaHub + logo banner Armacero a la derecha
- Módulo admin.py separado con endpoints /admin/reset-db y /admin/db-info

**Fase 1.6 — Tab Inicio**: 
- Tab Inicio con KPIs, resumen proyectos, chart top 5
- Endpoint GET /stats
- Tab Inicio como tab activo por defecto

**Fase 1.7 — Mejoras Mis Obras**: 
- Multi-file upload con drag & drop
- Feedback visual importación, protección re-import
- Historial últimas cargas (tabla imports)

**Fase 1.8 — Dashboard sectores constructivos**: 
- Gráfico agrupado por sector+piso+ciclo con kilos y barras
- Tabla resumen + chart dual-axis (kilos + barras)
- Selector de proyecto para filtrar
- Endpoint GET /dashboard/sectores

**Fase 1.9 — Matriz constructiva + detección duplicados**: 
- Matriz visual pisos x ciclos (ELEV / VCIELO / LCIELO por piso)
- Heatmap de kilos por celda, selector de proyecto
- Detección de proyectos duplicados al importar (reasignar / forzar)

**Pendiente próximo checkpoint**: Filtros avanzados + endpoints pendientes

---

## OBJETIVOS DE DISEÑO

La interfaz debe ser intuitiva para **cubicadores** (usuarios principales) y **controladores de obra**, permitiendo:

1. **Visibilidad de obras**: Ver de un vistazo qué proyectos (Cliente - Obra) existen, con resumen de kilos totales
2. **Desglose por sector constructivo**: Visualizar kilos y cantidad de barras por sector (ELEV, FUND, LCIELO, VCIELO)
3. **Búsqueda de barras específicas**: Filtrar y paginar barras individuales con ordenamiento flexible
4. **Gestión de datos**: Cargar CSV, editar cargas, ver versiones, eliminar proyectos (con permisos por rol)
5. **Pedidos de material**: Formulario para ingresar barras manualmente y generar solicitudes
6. **Exportación a producción**: Generar archivo Excel en formato aSa Studio
7. **Permisos granulares**: 
   - Admin: puede ver y editar todo + panel de administración (reset BD, gestión usuarios)
   - Cubicador/Operador: administra sus obras (carga, edita, elimina)
   - Cliente (futuro): solo ve su proyecto en modo lectura

## PALETA DE COLORES

Basada en identidad visual ArmaCero:
- **Verde principal**: #8BC34A (lime/chartreuse) — botones, títulos, acentos
- **Verde oscuro**: #558B2F — hover/active states
- **Negro header**: #1a1a1a — fondo del header principal
- **Gris oscuro**: #2C2C2C — textos, bordes
- **Gris claro**: #F5F5F5 — fondos de secciones
- **Blanco**: #FFFFFF — tarjetas y fondos principales
- **Rojo peligro**: #b42318 — acciones destructivas (reset, eliminar)

## ESTRUCTURA DE NAVEGACIÓN Y SECCIONES

El sistema tiene **pestañas horizontales** con acceso diferenciado por rol:

### **TODOS LOS ROLES**
- **Tab 1: 🏠 Inicio** (Landing / Home)
  - KPI cards: proyectos activos, barras totales, kilos totales, última carga
  - Actividad reciente: últimas 5-10 cargas (proyecto, usuario, fecha, barras)
  - Resumen por proyecto: mini-cards con nombre + kilos
  - Chart: Top 5 proyectos por kilos (gráfico horizontal)

### **ROL: CUBICADOR / OPERADOR**
- **Tab 2: 📦 Mis Obras** (Workspace del cubicador)
  - Zona de carga CSV: multi-file upload con drag & drop
  - Feedback visual: spinner durante carga, mensaje éxito/error con resumen
  - Protección re-import: detectar duplicados, informar que es UPSERT
  - Historial últimas 3 cargas (fecha, proyecto, barras, kilos)
  - Tarjetas de proyectos con resumen kilos/barras
  - Futuro: sidebar dashboard diario (barras del día, avance semanal)
  
- **Tab 3: 🔍 Búsqueda de Barras** (Detalle)
  - Filtros (Proyecto, Plano con nombres legibles, Sector, Piso, Ciclo)
  - Tabla pageable con ordenamiento
  - Búsqueda rápida

- **Tab 4: 📊 Dashboards** (Análisis profundo)
  - Selector de dimensión: sector, piso, ciclo, plano, proyecto, eje
  - Gráficos Chart.js con nombres legibles
  - Resúmenes de totales

- **Tab 5: 📝 Pedidos** (Future MVP)
  - Selector de obra + formulario manual + tabla de items

- **Tab 6: 📥 Exportación** (Producción)
  - Selector de obra + vista previa + descarga EXCEL

### **ROL: ADMIN** (hereda todo de cubicador)
- **Tab 7: ⚙️ Admin** (solo visible para admin)
  - Info de BD en tiempo real (conteos, kilos totales)
  - Reset de base de datos (doble confirmación)
  - Gestión de usuarios (crear operador/admin)
  - Futuro: auditoría, logs, configuración del sistema

### **ROL: CLIENTE** (Future)
- Tab Inicio (read-only, solo su proyecto)
- Tab Búsqueda (read-only)
- Tab Pedidos (read-only + crear pedido)
- Tab Dashboards (read-only)

---

ARMAHUB – PROGRAMA DE TRABAJO

## FASE 0 — Preparación de datos 

0. Extracción de nombres de proyectos y planos desde CSV - OK
   - Tabla proyectos con mapeo id_proyecto → nombre_proyecto - OK
   - Importer parsea metadatos PROYECTO y PLANO desde CSV - OK
   - Columnas nombre_proyecto y nombre_plano en tabla barras - OK
   - Endpoints GET /proyectos y GET /proyectos/{id}/sectores - OK

---

## FASE 1 — MVP usable (UX + operación)

1. Hardening UI + Tabla barras + Rediseño visual - OK
   - Auth JWT, badges, mensajes de error, paginación, orden, búsqueda - OK
   - 7 tabs: Inicio, Mis Obras, Búsqueda, Dashboards, Pedidos, Exportación, Admin - OK
   - Header oscuro + logo Armacero + título verde ArmaHub - OK
   - CSS profesional con colores Armacero - OK

2. Nombres legibles en todo el sistema - OK
   - nombre_proyecto y nombre_plano en barras, filtros y dashboards - OK
3. Panel de administración - OK
   - admin.py: POST /admin/reset-db, GET /admin/db-info - OK
   - UI: reset BD con doble confirmación, crear usuarios - OK

4. Tab Inicio (Landing / Home) - OK
   - Endpoint GET /stats (KPIs: proyectos, barras, kilos, última carga) - OK
   - KPI cards en fila superior - OK
   - Resumen por proyecto: mini-cards con nombre + kilos - OK
   - Chart: Top 5 proyectos por kilos (gráfico horizontal Chart.js) - OK
   - Tab Inicio como tab activo por defecto al entrar - OK

5. Mejoras Mis Obras: importación multi-archivo con drag & drop - OK
   a) Multi-file upload - OK
      - Input file con atributo multiple para seleccionar varios CSV - OK
      - Zona de drag & drop visual (borde punteado, icono, texto "arrastra archivos aquí") - OK
      - Importación secuencial automática de todos los archivos seleccionados - OK
      - Barra de progreso o contador (archivo 1/5, 2/5, etc.) - OK
   b) Feedback visual en importación - OK
      - Spinner/loading durante carga, botón deshabilitado - OK
      - Mensaje éxito con resumen (proyecto, barras importadas, kilos) - OK
      - Mensaje error claro si falla, con detalle del archivo - OK
      - Limpiar input file después de importar exitosamente - OK
   c) Protección contra re-importación - OK
      - Nota: el backend ya usa UPSERT (ON CONFLICT DO UPDATE), no duplica datos - OK
      - Informar al usuario que re-importar actualiza los datos existentes - OK
   d) Historial de últimas cargas - OK
      - Tabla "imports" en BD (id, id_proyecto, usuario, fecha, archivo, barras_count, kilos) - OK
      - Endpoint GET /cargas/recientes (últimas N cargas) - OK
      - Tabla compacta debajo del importador con últimas 3 cargas - OK

6. Dashboard: visualización de sectores constructivos - OK
   - Gráfico agrupado por combinación sector+piso+ciclo (ej: FUND S2 C1, ELEV S2 C1) - OK
   - Mostrar kilos y cantidad de barras por sector constructivo - OK
   - Selector o filtro por proyecto para desglose por sector constructivo - OK
   - Tabla resumen + chart dual-axis (kilos y barras) - OK
   - Endpoint GET /dashboard/sectores - OK

6b. Matriz constructiva (visualización tipo edificio) - OK
   - Matriz HTML: filas = pisos (de abajo hacia arriba), columnas = ciclos - OK
   - Cada piso tiene sub-filas: LCIELO (arriba), VCIELO (medio), ELEV (abajo) - OK
   - Fundaciones solo en piso base - OK
   - Cada celda muestra kilos + barras del sector constructivo correspondiente - OK
   - Selector de proyecto obligatorio para la matriz - OK
   - Colores de intensidad según kilos (heatmap verde) - OK
   - Leyenda de intensidad - OK
   - Separador verde entre pisos - OK

7. Detección de proyectos duplicados (distinto ID, mismo nombre) - OK
   - Al importar, detectar si ya existe un proyecto con el mismo nombre pero diferente ID - OK
   - Consultar al usuario si desea reasignar al proyecto existente o crear uno nuevo - OK
   - Parámetros reasignar_a y forzar en POST /import/armadetailer - OK

8. Backend endpoints pendientes de Fase 1
   - Endpoint DELETE /proyectos/{id} (eliminar obra con cascada) - Pendiente
   - Endpoint GET /stats (KPIs para tab Inicio) - OK
   - Endpoint GET /cargas/recientes (historial importaciones) - OK

9. Filtros avanzados - Pendiente
   - Filtros dependientes (proyecto → plano → ciclo → piso) - Pendiente
   - Persistencia de filtros en URL o localStorage - Pendiente

---

## FASE 2 — Importación robusta y trazabilidad (operación real)

10. Tracking de cargas completo - Pendiente (amplía lo básico de Fase 1)
    - Tabla "imports" completa con versión, estado, archivo_original - Pendiente
    - UI: tabla de cargas por obra (quién, cuándo, versión) - Pendiente
    - Posibilidad recargar/editar versión - Pendiente

11. Validación de datos avanzada - Pendiente
    - Reporte de filas rechazadas - Pendiente
    - Normalización de formatos - Pendiente
    - Advertencias: datos incompletos, duplicados - Pendiente

12. Sistema de migraciones robusto - Pendiente
    - Mecanismo para actualizar esquema sin perder datos - Pendiente
    - Versionado de migraciones - Pendiente

---

## FASE 3 — Export para producción (reemplazo Excel)

13. Definir y documentar formato aSa Studio - Pendiente
    - Mapear columnas por sector constructivo (sector+piso+ciclo) - Pendiente
    - Documentar unidades, crear plantillas - Pendiente

14. Endpoint de export a EXCEL - Pendiente
    - POST /proyectos/{id}/exportar-excel con formato aSa Studio - Pendiente
    - Agrupación por sector constructivo en la exportación - Pendiente

15. UI para exportación - Pendiente
    - Tab "Exportación" con selector, vista previa, descarga - Pendiente

---

## FASE 4 — Funcionalidades avanzadas y multi-cliente

16. Navegador de sectores constructivos (Mis Obras avanzado) - Future
    - Navegador por sector+piso+ciclo dentro de cada proyecto - Pendiente
    - Visualizar ejes contenidos en cada sector constructivo - Pendiente
    - Herramientas de edición y reasignación de barras entre sectores - Pendiente
    - Mini-dashboard por sector: kilos, barras, diámetros predominantes - Pendiente

17. Sistema de pedidos (MVP) - Future
    - Tablas "pedidos" y "pedido_items", endpoints CRUD - Pendiente
    - UI Tab "Pedidos": formulario + tabla de items - Pendiente

18. Modelo de datos clientes + permisos - Future
    - Tabla "clientes", relación con proyectos, permisos por rol - Pendiente

19. Separación de UI en módulos - Future
    - Dividir ui.py en archivos separados o migrar a frontend SPA - Pendiente

20. Auditoría y logs en panel Admin - Future
    - Registro de acciones, visualización en tab Admin - Pendiente

21. Mis Obras: dashboard diario del cubicador - Future
    - Sidebar con barras del día, kilos del día, mini-chart semanal - Pendiente

---

## FASE 5 — Preparación para Apps

22. API versionada (/api/v1) - Pendiente
23. CORS para aplicaciones externas - Pendiente
24. Observabilidad: /health, logs estructurados - Pendiente
25. Performance: queries optimizadas, pool de conexiones - Pendiente
26. Bootstrap profesional (solo dev) - Pendiente