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

**Fase 1.10 — Administración de Obras**: ✅
- Crear obra manualmente (sin CSV)
- Eliminar obra con cascada
- Mover barras masivamente entre proyectos
- Renombrar obra / editar metadatos

**Fase 1.11 — KPIs avanzados (métricas Detailer)**: ✅
- Peso Promedio Barra (PPB)
- Peso Promedio Item (PPI)
- Diámetro Promedio
- Integrar en Tab Inicio y Dashboards

**Fase 1.12 — Buscadores contextuales (lupas)**: ✅
- Lupa + typeahead en selectores de proyecto (búsqueda, sectores, matriz)
- Función filterProjectSelect reutilizable

**Fase 1.13 — Filtros avanzados**: ✅
- Filtros dependientes: proyecto → plano → sector → piso → ciclo
- Backend /filters acepta params de contexto
- Persistencia de filtros en localStorage (save/restore/clear)

**Fase 1.14 — Fix KPIs + Matriz constructiva + Dashboard layout**: ✅
- Fix KPI cards vacíos (NULL plano_code, try-except diam, Optional[str])
- Matriz: compact layout, piso blanco+negro, sin separador, celdas vacías en blanco
- Matriz: checkbox completado (localStorage) → texto verde al marcar
- Dashboard layout 2 columnas: charts izquierda (60%), matriz derecha (40%) sticky
- pisoOrder global: SM siempre arriba, subterráneos abajo, orden edificio en charts

**Fase 1.15 — Ownership de proyectos y auto-creación**: OK
- owner_id en tabla proyectos (FK a users), asignado al crear/importar - OK
- Popup confirmación al detectar proyecto nuevo en importación - OK
- Campos al crear: nombre_proyecto, calculista (texto), owner (select preseleccionado) - OK
- Endpoints autorización: POST/DELETE/GET autorizados por proyecto - OK
- GET /users/list para selectores - OK
- Dashboard layout mejorado (1600px, matriz 100%) - OK
- Enforcement permisos: _puede_editar_proyecto (admin/owner/autorizado) con 403 - OK
- UI gestión autorizados: panel colapsable en tarjeta de proyecto - OK
- Fix KPI /stats: corregido regex en DOUBLE PRECISION + SAVEPOINT recovery - OK

**Fase 2 — Importación robusta y trazabilidad**: OK
- Tracking de cargas completo: imports con estado/version/plano/errores, endpoint por proyecto, UI cargas por obra - OK
- Validación de datos avanzada: filas rechazadas (ID_UNICO vacío), parseo numérico con try-except, normalización texto, advertencias sin peso - OK
- Sistema de migraciones versionado: tabla schema_migrations, MIGRATIONS[], _run_migrations(), solo ejecuta pendientes - OK

**Fase 2.5 — Calidad de datos y administración**: OK
- Validación sectores: archivo rechazado si sector inválido (GEN, etc.) - OK
- Gestión cargas: botón eliminar carga por proyecto (DELETE /cargas/{id}) - OK
- Admin Data: tab rediseñado con tabla compacta, checkboxes, acciones (mover proyecto/sector) - OK
- POST /barras/mover: mover barras individuales por id_unico + cambiar sector - OK

**Fase 3 — Exportación a producción (aSa Studio)**: OK
- Migración 6: 21 columnas nuevas en barras (bar_id, estructura, tipo, marca, figura, esp, dim_a-i, ang1-3, radio, cod_proyecto, nombre_dwg) - OK
- Importer actualizado: almacena TODAS las columnas del CSV ArmaDetailer (40 campos) - OK
- export.py: GET /proyectos/{id}/exportar genera ZIP con un .xlsx por SECTOR+PISO+CICLO - OK
- Formato Excel aSa Studio: 26 columnas (EJE, ELEMCONFIREQ, PISO, CICLO, CANT, Ømm, DE|PA, L/cm, Masa, Pied, A-Icm, AngV1-3, Rcm, PesoKg, PesoTotal) - OK
- UI Exportación: selector proyecto con búsqueda, preview sectores/pisos/ciclos, descarga ZIP - OK
- Fix JS: corregido escaping roto en onclick deleteCarga que impedía carga de la página - OK
- Dependencia: openpyxl agregada a requirements.txt - OK

**Pendiente próximo checkpoint**: Fase 4 (Pedidos / solicitudes de material)

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
   - Diseño tipo edificio: grises hormigón, sin espacios, pisos alternados - OK
   - Leyenda de intensidad (gris claro → gris oscuro) - OK
   - Separador fino entre pisos - OK

7. Detección de proyectos duplicados (distinto ID, mismo nombre) - OK
   - Al importar, detectar si ya existe un proyecto con el mismo nombre pero diferente ID - OK
   - Consultar al usuario si desea reasignar al proyecto existente o crear uno nuevo - OK
   - Parámetros reasignar_a y forzar en POST /import/armadetailer - OK

8. Administración de Obras - OK
   a) Crear obra manualmente (sin CSV) - OK
      - Endpoint POST /proyectos (nombre, descripción) - OK
      - UI: formulario en Mis Obras para crear obra vacía - OK
   b) Eliminar obra con cascada - OK
      - Endpoint DELETE /proyectos/{id} (elimina barras + imports asociados) - OK
      - UI: botón eliminar en tarjeta de obra con doble confirmación (confirm + texto ELIMINAR) - OK
   c) Mover barras masivamente entre proyectos - OK
      - Endpoint POST /proyectos/{id}/mover-barras (body: {destino, sector, piso, ciclo}) - OK
      - UI: selector origen → destino con filtros opcionales - OK
   d) Editar metadatos de obra - OK
      - Endpoint PATCH /proyectos/{id} (nombre, descripción) - OK
      - UI: prompt de renombrar desde tarjeta de obra - OK
      - Migración: columna descripcion en tabla proyectos - OK

9. KPIs avanzados (métricas Detailer) - OK
   - Peso Promedio Barra (PPB = kilos totales / cant barras) - OK
   - Peso Promedio Item (PPI = kilos totales / cant items únicos) - OK
   - Diámetro Promedio (ponderado por peso) - OK
   - Mostrar en Tab Inicio como KPI cards adicionales - OK
   - Endpoint GET /stats devuelve ppb, ppi, diam_promedio, total_items - OK

10. Buscadores contextuales (lupas) en secciones con mucha data - OK
    - Buscar proyecto en tab Búsqueda (lupa + typeahead sobre select) - OK
    - Buscar proyecto en selector de sectores constructivos (lupa + typeahead) - OK
    - Buscar proyecto en selector de matriz constructiva (lupa + typeahead) - OK
    - Función filterProjectSelect reutilizable para cualquier selector - OK
    - Buscar en tabla de barras (ya existe búsqueda rápida) - OK

11. Filtros avanzados - OK
    - Filtros dependientes (proyecto → plano → sector → piso → ciclo) - OK
    - Backend /filters acepta params: proyecto, plano_code, sector, piso - OK
    - Frontend: onProyectoChange recarga plano/sector/piso/ciclo filtrados - OK
    - Frontend: onFilterChange recarga filtros con contexto acumulado - OK
    - Persistencia de filtros en localStorage (save/restore/clear) - OK
    - Restauración automática al recargar página - OK

12. Fix KPIs + Matriz constructiva + Dashboard layout - OK
    - Fix KPI cards vacíos (NULL plano_code en query, try-except diam, Optional[str]) - OK
    - Matriz: layout compacto, piso blanco+negro, sin separador, celdas vacías en blanco - OK
    - Matriz: checkbox completado en esquina (localStorage por proyecto) → texto verde - OK
    - Dashboard: layout 2 columnas (charts izq 60%, matriz der 40% sticky) - OK
    - pisoOrder global: SM=9999 siempre arriba, subterráneos abajo - OK
    - Orden de pisos correcto en gráficos y tabla sectores - OK

13. Ownership de proyectos y auto-creación al importar - OK
    a) owner_id en tabla proyectos (FK a users) - OK
       - Migración: agregar columna owner_id a proyectos - OK
       - Asignar automáticamente al usuario que crea/importa - OK
       - GET /proyectos devuelve owner_id, owner_email - OK
    b) Auto-creación de proyecto al importar - OK
       - Detectar proyecto nuevo en CSV al importar (new_project flag) - OK
       - Popup confirmación con campos: nombre_proyecto, calculista (texto), owner (select preseleccionado) - OK
       - Crear proyecto automáticamente con owner_id + calculista - OK
       - Parámetros confirmar_nuevo y calculista en endpoint import - OK
    c) Autorización de usuarios adicionales - OK
       - Tabla proyecto_usuarios (id_proyecto, user_id, rol) - OK
       - POST /proyectos/{id}/autorizar (upsert) - OK
       - DELETE /proyectos/{id}/autorizar/{user_id} (revocar) - OK
       - GET /proyectos/{id}/autorizados (listar) - OK
       - GET /users/list (para selectores) - OK
       - Solo owner/admin/autorizados pueden editar/eliminar/mover barras - OK
       - Helper _puede_editar_proyecto (admin/owner/autorizado) con 403 en PATCH/DELETE/mover/autorizar - OK
       - UI: panel colapsable "Usuarios" en tarjeta de proyecto (listar, autorizar, revocar) - OK
    d) Columna calculista en tabla proyectos - OK
       - Migración: agregar columna calculista (texto) - OK
       - POST/PATCH proyectos acepta calculista - OK
       - UI: campo calculista en formulario crear obra manual - OK
       - UI: mostrar calculista y owner en tarjeta de proyecto - OK
    e) Dashboard layout mejorado - OK
       - max-width 1600px en contenido de tabs - OK
       - Matriz constructiva width:100% llena panel - OK
       - Buscador sin max-width restrictivo - OK

---
## FASE 2 — Importación robusta y trazabilidad (operación real)

14. Tracking de cargas completo - OK
    - Tabla "imports" ampliada: estado (ok/parcial/error), version_archivo, plano_code, errores - OK
    - Migraciones DB para columnas nuevas en imports - OK
    - Endpoint GET /proyectos/{id}/cargas (historial por proyecto) - OK
    - GET /cargas/recientes incluye estado, version, plano - OK
    - Importer registra version_exp y plano_code del CSV en imports - OK
    - UI: botón "Cargas" en tarjeta de proyecto → panel colapsable con tabla historial - OK
    - UI: tabla cargas recientes muestra columnas Plano, Versión, estado badge - OK

15. Validación de datos avanzada - OK
    - Validación ID_UNICO: filas sin ID se rechazan con reporte - OK
    - Parseo numérico robusto: try-except en DIAM, LARGO_TOTAL, CANT con warnings - OK
    - Normalización de texto: strip whitespace, filtrar "nan" - OK
    - Advertencias: datos incompletos para cálculo de peso - OK
    - Estado de importación: ok/parcial/error según filas rechazadas - OK
    - Errores guardados en imports (max 500 chars) - OK
    - Respuesta incluye: total_filas_csv, filas_rechazadas, advertencias, rejected[], warnings[] - OK
    - UI: feedback visual con conteo rechazadas/advertencias y detalle primeras 5 - OK

16. Sistema de migraciones robusto - OK
    - Tabla schema_migrations (version, description, applied_at) - OK
    - Lista MIGRATIONS[] versionada en db.py (nunca modificar aplicadas) - OK
    - _run_migrations(): ejecuta solo pendientes, registra versión - OK
    - init_db refactorizado: _create_base_tables → _run_migrations → _create_indexes - OK
    - reset_database dropea schema_migrations para slate limpio - OK

---
## FASE 2.5 — Calidad de datos y administración

17. Validación de sectores en importación - OK
    Sectores válidos: FUND, ELEV, LCIELO, VCIELO.
    - Archivo rechazado si contiene sectores inválidos (ej: GEN) - OK
    - Respuesta incluye: sectores_invalidos, conteo por sector, mensaje claro - OK
    - UI muestra error detallado con lista de sectores inválidos encontrados - OK

17b. Gestión de cargas por proyecto - OK
    - Botón "Eliminar" en cada carga del panel de cargas por proyecto - OK
    - DELETE /cargas/{id}: elimina barras (por fecha_carga) + registro de import - OK
    - Confirmación antes de eliminar, feedback con cantidad de barras borradas - OK

17c. Administrador de Data (rediseño tab Búsqueda) - OK
    - Tab renombrado: "Admin Data" (antes "Buscar Barras") - OK
    - Proyecto obligatorio como primer filtro (no muestra nada sin proyecto) - OK
    - Tabla compacta: ID (corto) | Sector | Piso | Ciclo | Eje | φ | Cant | Largo | Peso U. | Peso Total - OK
    - ID corto: extrae sufijo del id_unico (sin prefijo proyecto/plano) - OK
    - φ (phi) como símbolo de diámetro - OK
    - Checkboxes para selección individual y masiva de barras - OK
    - Toolbar de acciones sobre barras seleccionadas:
      - Mover a otro proyecto (selector) - OK
      - Cambiar sector (selector con 4 válidos) - OK
    - POST /barras/mover: mueve barras individuales por lista de id_unico - OK
    - Validación de sector destino (solo FUND/ELEV/LCIELO/VCIELO) - OK
    - Paginación 100 barras por página, headers clickeables para ordenar - OK

17d. Helpers API - OK
    - apiPostJson(): POST con body JSON - OK
    - apiDelete(): DELETE request helper - OK

---
## FASE 3 — Export para producción (reemplazo Excel)

18. Definir y documentar formato aSa Studio - OK
    - Migración 6: 21 columnas nuevas en barras (bar_id, estructura, tipo, marca, figura, esp, dim_a-i, ang1-3, radio, cod_proyecto, nombre_dwg) - OK
    - Importer actualizado: almacena TODAS las columnas del CSV ArmaDetailer (40 campos) con helpers _opt_float/_opt_text - OK
    - Formato Excel: 26 columnas (EJE, ELEMCONFIREQ, PISO, CICLO, CANT, Ømm, DE|PA, L/cm, Masa, Pied, A-Icm, Jcm, AngV1-3, Rcm, PesoKg, PesoTotal) - OK

19. Endpoint de export a EXCEL - OK
    - GET /proyectos/{id}/exportar genera ZIP con .xlsx por SECTOR+PISO+CICLO - OK
    - export.py: openpyxl, formato aSa Studio, headers en fila 5, datos desde fila 6 - OK
    - Nombre archivo: "{SECTOR} {PISO} {CICLO}.xlsx" dentro del ZIP - OK

20. UI para exportación - OK
    - Tab "Exportación" con selector proyecto (búsqueda), vista previa sectores/pisos/ciclos, botón descarga ZIP - OK
    - loadFilters() pobla todos los selects de proyecto (búsqueda, export, dashboard) - OK

---
## FASE 4 — Funcionalidades avanzadas y multi-cliente

21. Navegador de sectores constructivos (Mis Obras avanzado) - Future
    - Navegador por sector+piso+ciclo dentro de cada proyecto - Pendiente
    - Visualizar ejes contenidos en cada sector constructivo - Pendiente
    - Herramientas de edición y reasignación de barras entre sectores - Pendiente
    - Mini-dashboard por sector: kilos, barras, diámetros predominantes - Pendiente

21. Sistema de pedidos (MVP) - Future
    - Tablas "pedidos" y "pedido_items", endpoints CRUD - Pendiente
    - UI Tab "Pedidos": formulario + tabla de items - Pendiente

22. Modelo de datos clientes + permisos - Future
    - Tabla "clientes", relación con proyectos, permisos por rol - Pendiente

23. Separación de UI en módulos - Future
    - Dividir ui.py en archivos separados o migrar a frontend SPA - Pendiente

24. Auditoría y logs en panel Admin - Future
    - Registro de acciones, visualización en tab Admin - Pendiente

25. Mis Obras: dashboard diario del cubicador - Future
    - Sidebar con barras del día, kilos del día, mini-chart semanal - Pendiente

---
## FASE 5 — Preparación para Apps

26. API versionada (/api/v1) - Pendiente
27. CORS para aplicaciones externas - Pendiente
28. Observabilidad: /health, logs estructurados - Pendiente
29. Performance: queries optimizadas, pool de conexiones - Pendiente
30. Bootstrap profesional (solo dev) - Pendiente