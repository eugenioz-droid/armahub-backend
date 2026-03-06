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

**Fase 1.6 — Tab Inicio + mejoras Mis Obras**: EN PROGRESO
- Tab Inicio con KPIs, actividad reciente, resumen proyectos, chart top 5
- Mis Obras: multi-file upload con drag & drop
- Mis Obras: feedback visual importación, protección re-import
- Mis Obras: historial últimas cargas (tabla imports)

**Pendiente próximo checkpoint**: Tab Inicio + mejoras importación en Mis Obras

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

## FASE 0 — Preparación de datos ✅ COMPLETADA

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
   - Migraciones ALTER TABLE automáticas en init_db - OK

3. Panel de administración - OK
   - admin.py: POST /admin/reset-db, GET /admin/db-info - OK
   - UI: reset BD con doble confirmación, crear usuarios - OK

4. Tab Inicio (Landing / Home) - Pendiente
   - Endpoint GET /stats (KPIs: proyectos, barras, kilos, última carga) - Pendiente
   - KPI cards en fila superior - Pendiente
   - Actividad reciente: últimas 5-10 cargas (proyecto, usuario, fecha, barras) - Pendiente
   - Resumen por proyecto: mini-cards con nombre + kilos - Pendiente
   - Chart: Top 5 proyectos por kilos (gráfico horizontal Chart.js) - Pendiente
   - Tab Inicio como tab activo por defecto al entrar - Pendiente

5. Mejoras Mis Obras: importación multi-archivo con drag & drop - Pendiente
   a) Multi-file upload - Pendiente
      - Input file con atributo multiple para seleccionar varios CSV - Pendiente
      - Zona de drag & drop visual (borde punteado, icono, texto "arrastra archivos aquí") - Pendiente
      - Importación secuencial automática de todos los archivos seleccionados - Pendiente
      - Barra de progreso o contador (archivo 1/5, 2/5, etc.) - Pendiente
   b) Feedback visual en importación - Pendiente
      - Spinner/loading durante carga, botón deshabilitado - Pendiente
      - Mensaje éxito con resumen (proyecto, barras importadas, kilos) - Pendiente
      - Mensaje error claro si falla, con detalle del archivo - Pendiente
      - Limpiar input file después de importar exitosamente - Pendiente
   c) Protección contra re-importación - Pendiente
      - Nota: el backend ya usa UPSERT (ON CONFLICT DO UPDATE), no duplica datos - Pendiente
      - Informar al usuario que re-importar actualiza los datos existentes - Pendiente
   d) Historial de últimas cargas - Pendiente
      - Tabla "imports" en BD (id, id_proyecto, usuario, fecha, archivo, barras_count, kilos) - Pendiente
      - Endpoint GET /cargas/recientes (últimas N cargas) - Pendiente
      - Tabla compacta debajo del importador con últimas 3 cargas - Pendiente

6. Backend endpoints pendientes de Fase 1
   - Endpoint DELETE /proyectos/{id} (eliminar obra con cascada) - Pendiente
   - Endpoint GET /stats (KPIs para tab Inicio) - Pendiente
   - Endpoint GET /cargas/recientes (historial importaciones) - Pendiente

7. Filtros avanzados - Pendiente
   - Filtros dependientes (proyecto → plano → ciclo → piso) - Pendiente
   - Persistencia de filtros en URL o localStorage - Pendiente

---

## FASE 2 — Importación robusta y trazabilidad (operación real)

8. Tracking de cargas completo - Pendiente
   - Tabla "imports" completa con versión, estado, archivo_original - Pendiente
   - UI: tabla de cargas por obra (quién, cuándo, versión) - Pendiente
   - Posibilidad recargar/editar versión - Pendiente

9. Validación de datos avanzada - Pendiente
   - Reporte de filas rechazadas - Pendiente
   - Normalización de formatos - Pendiente
   - Advertencias: datos incompletos, duplicados - Pendiente

10. Sistema de migraciones robusto - Pendiente
    - Mecanismo para actualizar esquema sin perder datos - Pendiente
    - Versionado de migraciones - Pendiente

---

## FASE 3 — Export para producción (reemplazo Excel)

11. Definir y documentar formato aSa Studio - Pendiente
    - Mapear columnas, documentar unidades, crear plantillas - Pendiente

12. Endpoint de export a EXCEL - Pendiente
    - POST /proyectos/{id}/exportar-excel con formato aSa Studio - Pendiente

13. UI para exportación - Pendiente
    - Tab "Exportación" con selector, vista previa, descarga - Pendiente

---

## FASE 4 — Funcionalidades avanzadas y multi-cliente

14. Sistema de pedidos (MVP) - Future
    - Tablas "pedidos" y "pedido_items", endpoints CRUD - Pendiente
    - UI Tab "Pedidos": formulario + tabla de items - Pendiente

15. Modelo de datos clientes + permisos - Future
    - Tabla "clientes", relación con proyectos, permisos por rol - Pendiente

16. Separación de UI en módulos - Future
    - Dividir ui.py en archivos separados o migrar a frontend SPA - Pendiente

17. Auditoría y logs en panel Admin - Future
    - Registro de acciones, visualización en tab Admin - Pendiente

18. Mis Obras: dashboard diario del cubicador - Future
    - Sidebar con barras del día, kilos del día, mini-chart semanal - Pendiente

---

## FASE 5 — Preparación para Apps

19. API versionada (/api/v1) - Pendiente
20. CORS para aplicaciones externas - Pendiente
21. Observabilidad: /health, logs estructurados - Pendiente
22. Performance: queries optimizadas, pool de conexiones - Pendiente
23. Bootstrap profesional (solo dev) - Pendiente