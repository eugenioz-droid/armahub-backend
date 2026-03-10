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

**Pendiente próximo checkpoint**: Fase 4 (Refactorización UI y sistema de roles)

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

El sistema tiene **pestañas horizontales** con acceso diferenciado por rol.
**Principio**: mismos tabs, contenido adaptado por rol. No se duplican vistas.

### **TODOS LOS ROLES**
- **Tab 1: 🏠 Inicio** (Landing / Home)
  - KPI cards: proyectos activos, barras totales, kilos totales, última carga
  - Actividad reciente: últimas 5-10 cargas (proyecto, usuario, fecha, barras)
  - Resumen por proyecto: mini-cards con nombre + kilos
  - Chart: Top 5 proyectos por kilos (gráfico horizontal)
  - Datos filtrados por acceso del usuario

- **Tab 2: 📦 Obras** (Gestión de proyectos)
  - Tarjetas de proyectos con resumen kilos/barras
  - Crear/editar/eliminar obras, gestionar usuarios autorizados
  - Zona de carga CSV: solo visible para cubicador y admin
  - Historial de cargas por proyecto
  - Admin/coordinador: ven todos los proyectos
  - Cubicador: ve solo proyectos asignados (owner o autorizado)
  - Cliente (futuro): ve solo su proyecto, sin acciones de edición

- **Tab 4: 📊 Dashboards** (Análisis)
  - Selector de dimensión: sector, piso, ciclo, plano, proyecto, eje
  - Sectores constructivos + Matriz constructiva
  - Datos filtrados por acceso del usuario

### **CUBICADOR, COORDINADOR, ADMIN**
- **Tab 3: � Bar Manager** (Gestión de barras)
  - Filtros (Proyecto, Plano, Sector, Piso, Ciclo) + búsqueda rápida
  - Tabla compacta con checkboxes para selección
  - Acciones: mover barras entre proyectos, cambiar sector
  - Paginación y ordenamiento por columnas

- **Tab 5: 📥 Exportación** (Producción)
  - Selector de obra + vista previa sectores/pisos/ciclos + descarga ZIP Excel

- **Tab 6: 📝 Pedidos** (Future MVP)
  - Selector de obra + formulario manual + tabla de items

### **SOLO ADMIN**
- **Tab 7: ⚙️ Admin** (Panel sistema)
  - Info de BD en tiempo real (conteos, kilos totales)
  - Reset de base de datos (doble confirmación)
  - Gestión de usuarios (crear operador/admin)
  - Futuro: auditoría, logs, configuración del sistema

### **ROL: CLIENTE** (Future)
- Tab Inicio (read-only, solo su proyecto)
- Tab Obras (read-only, sin acciones)
- Tab Dashboards (read-only)
- Tab Pedidos (crear pedido + ver estado)

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
    - Formato Excel: 26 columnas (EJE, SECTOR, PISO, CICLO, CANT, Ømm, FIGURA, L/cm, MARCA, PROD, A-I cm, J cm, AngV1-3, R cm, PesoKg, PesoTotal) - OK
    - Corrección columnas: B=SECTOR (dato ELEV/FUND/etc), G=FIGURA (catálogo Detailer), I=MARCA (CB/TR/etc), J=PROD (código producto aSa) - OK
    - Headers dimensiones con espacio: "A cm", "B cm"... "R cm" — PesoKg 3 decimales, PesoTotal 2 decimales - OK

19. Endpoint de export a EXCEL - OK
    - GET /proyectos/{id}/exportar genera ZIP con .xlsx por SECTOR+PISO+CICLO - OK
    - export.py: openpyxl, formato aSa Studio, headers en fila 5, datos desde fila 6 - OK
    - Nombre archivo: "{SECTOR} {PISO} {CICLO}.xlsx" dentro del ZIP - OK

20. UI para exportación - OK
    - Tab "Exportación" con selector proyecto (búsqueda), vista previa sectores/pisos/ciclos, botón descarga ZIP - OK
    - loadFilters() pobla todos los selects de proyecto (búsqueda, export, dashboard) - OK

20b. Matriz de control de exportación por sector constructivo - OK
    **Objetivo**: Control visual y selectivo de qué sectores constructivos se exportan,
    reutilizando el patrón de la matriz constructiva (piso × ciclo) del tab Dashboards.

    a) Backend: exportación selectiva - OK
       - Modificar GET /proyectos/{id}/exportar para aceptar param opcional `sectores`
       - Formato: `sectores=ELEV_P1_C1,FUND_P1_C1,LCIELO_P2_C1,...`
       - Si `sectores` está vacío o ausente: comportamiento actual (exporta todo)
       - Si `sectores` tiene valores: filtrar barras solo a esas combinaciones
       - ZIP resultante contiene solo los archivos de las combinaciones solicitadas

    b) Frontend: matriz de exportación - OK
       - Reutilizar layout de la matriz constructiva existente (piso × ciclo grid)
       - Cada sub-fila de sector (FUND/ELEV/LCIELO/VCIELO) tiene un checkbox
       - Cada celda muestra: checkbox + nombre sector + kilos + barras (compacto)
       - Celdas vacías (sin datos) no muestran checkbox
       1. Usuario selecciona proyecto en el selector
       2. Se carga la matriz + historial de exportación del servidor
       3. Usuario marca checkboxes (individualmente, por piso con checkbox, o por ciclo)
       4. Click "Exportar seleccionados" descarga ZIP parcial + registra en export_log
       5. Celdas exportadas cambian a verde con checkmark (persistido en servidor)
       6. Al volver al proyecto, el estado se carga del servidor
       7. Reporte muestra progreso, veces exportado, usuario y fecha

---
## FASE 4 — Refactorización UI y sistema de roles

**Objetivo**: Extraer CSS/JS de ui.py a archivos estáticos, modularizar templates,
renombrar tabs y preparar la UI para vistas diferenciadas por rol.
Esto elimina de raíz los bugs de escaping Python↔JS, mejora mantenibilidad
y sienta las bases para el crecimiento multi-cliente.

### Sistema de roles

| Rol          | Descripción                          | Acceso                                              |
|--------------|--------------------------------------|-----------------------------------------------------|
| admin        | Gestor de plataforma                 | Todo + panel admin (usuarios, reset BD)              |
| coordinador  | Administrador de proyecto / contacto cliente | Todos los proyectos de sus clientes, dashboards, export. No importa CSVs |
| cubicador    | Detallador (usuario principal)       | Solo proyectos asignados. Importa, gestiona barras, exporta |
| cliente      | Mandante (futuro)                    | Solo sus proyectos, read-only + pedidos              |

### Tabs renombrados y visibilidad por rol

| Tab            | Antes        | Roles que lo ven                  | Notas                                   |
|----------------|--------------|-----------------------------------|-----------------------------------------|
| Inicio         | Inicio       | todos                             | KPIs filtrados por acceso del usuario    |
| Obras          | Mis Obras    | todos                             | Contenido adaptado: import solo cubicador |
| Bar Manager    | Admin Data   | cubicador, coordinador, admin     | Gestión individual de barras             |
| Dashboards     | Dashboards   | todos                             | Datos filtrados por acceso               |
| Exportación    | Exportación  | cubicador, coordinador, admin     | Export Excel aSa Studio                  |
| Pedidos        | Pedidos      | todos (futuro)                    | Solicitudes de material                  |
| Admin          | Admin        | solo admin                        | Panel sistema                            |

**Principio**: mismos tabs, contenido adaptado por rol. No se duplican vistas.

---

### Paso 1: Extraer archivos estáticos (CSS + JS) — OK
- Crear carpeta `static/css/` y `static/js/`
- Extraer TODO el bloque `<style>` de ui.py → `static/css/app.css`
- Extraer TODO el bloque `<script>` de ui.py → `static/js/app.js`
- El HTML referencia con `<link href="/static/css/app.css">` y `<script src="/static/js/app.js">`
- FastAPI ya monta `/static` en main.py; verificar que sirva estos archivos
- **Beneficio**: elimina 100% de bugs de escaping Python↔JS
- **Beneficio**: permite linting JS/CSS con herramientas estándar (ESLint, Prettier)
- **Beneficio**: browser cachea archivos estáticos (performance)
- Verificar que la app funcione idénticamente post-extracción

### Paso 2: Modularizar HTML con Jinja2 templates — OK
- Carpeta `templates/` creada con 10 archivos HTML - OK
- `templates/app.html`: layout principal con head, header, nav tabs, modal, script refs - OK
- `templates/login.html`: página de login standalone - OK
- `templates/bootstrap.html`: página de bootstrap standalone - OK
- Cada tab como template parcial con `{% include %}`:
  - `templates/tabs/inicio.html` - OK
  - `templates/tabs/obras.html` - OK
  - `templates/tabs/bar_manager.html` - OK
  - `templates/tabs/dashboards.html` - OK
  - `templates/tabs/exportacion.html` - OK
  - `templates/tabs/pedidos.html` - OK
  - `templates/tabs/admin.html` - OK
- ui.py refactorizado: Jinja2 Environment + FileSystemLoader (647→49 líneas) - OK
- jinja2 ya estaba en requirements.txt - OK
- **Beneficio**: cada tab se edita independientemente, sin bugs de escaping Python↔JS

### Paso 3: Renombrar tabs y limpiar navegación — OK
- "Mis Obras" → "Obras"
- "Admin Data" → "Bar Manager"
- Actualizar switchTab() y botones de navegación
- Actualizar IDs de tabs (`tab-buscar` → `tab-barmanager`, `tab-obras` → `tab-obras`)
- Reordenar tabs en la barra de navegación según tabla de arriba
- Verificar que todos los onclick, IDs y referencias JS estén actualizados

### Paso 4: Visibilidad de tabs por rol — OK
- Backend: endpoint GET /me ya devuelve `role`
- Backend: roles válidos expandidos (admin, coordinador, cubicador, operador, cliente) - OK
- Frontend: al cargar, ocultar tabs no autorizados según rol - OK
- Lógica en loadMe(): leer rol del usuario y aplicar display:none a tabs no permitidos - OK
- Coordinador: ocultar zona de importación CSV en tab Obras - OK
- Cliente: ocultar Bar Manager y Exportación - OK
- Admin: mostrar todo - OK
- Dropdown de roles en panel Admin actualizado con 5 roles - OK
- Cubicador: filtrar proyectos a solo los asignados/autorizados - Pendiente (requiere Paso 5)

### Paso 5: Filtrado de datos por autorización — OK
- Helper _get_allowed_project_ids(): None para admin/coordinador, lista de IDs para cubicador/operador/cliente - OK
- Helper _project_filter_sql(): genera fragmento SQL AND id_proyecto IN (...) con params - OK
- GET /proyectos filtra por owner_id + autorizados - OK
- GET /barras filtra por proyectos autorizados - OK
- GET /filters filtra proyectos y filtros dependientes por autorización - OK
- GET /stats filtra KPIs por proyectos autorizados - OK
- GET /dashboard filtra todos los group_by por proyectos autorizados - OK
- GET /dashboard/sectores filtra por proyectos autorizados - OK
- GET /cargas/recientes filtra por proyectos autorizados - OK
- Admin/coordinador bypasean todos los filtros (ven todo) - OK
- Cubicador/operador/cliente ven solo proyectos donde son owner o están autorizados - OK
- Migración 7: CHECK constraint expandido (admin/coordinador/cubicador/operador/cliente) - OK
- Base table users actualizada con 5 roles para fresh DBs - OK

---
## FASE 5 — Funcionalidades avanzadas y multi-cliente

21. Dashboard landing: analítica de cubicación - OK
    - Dashboard en tab Inicio con resumen de cubicación de TODOS los cubicadores - OK
    - Filtros por rango de fecha: semana / mes / año / todo / rango personalizado - OK
    - Endpoint GET /stats acepta parámetros fecha_desde, fecha_hasta - OK
    - Endpoint GET /stats/timeline (cubicación acumulada por día/semana/mes) - OK
    - Endpoint GET /stats/cubicadores (resumen por usuario) - OK
    - Gráfico dual-axis: kilos (barras) + barras (línea) por período con agrupación día/semana/mes - OK
    - Tabla resumen por cubicador: email, barras, kilos, cargas, proyectos, última actividad - OK
    - Botones de período con estado activo visual (CSS .secondary.active) - OK
    - Inputs date para rango personalizado - OK

22. Dashboard diario del cubicador - OK
    - Panel "Mi actividad" en tab Obras con KPIs del día (barras, kilos, cargas) - OK
    - KPI semana actual con comparativa % vs semana anterior (▲/▼ color) - OK
    - Endpoint GET /stats/mi-actividad: hoy, últimos 14 días, semana actual vs anterior - OK
    - Mini-chart dual-axis 14 días: kilos (barras) + barras (línea), hoy destacado - OK
    - Auto-refresh tras importar, eliminar carga, crear obra - OK

23. Navegador de sectores constructivos - OK
    - Endpoint GET /proyectos/{id}/sectores-nav: árbol jerárquico sector→piso→ciclo con stats - OK
    - Stats por nodo: barras, kilos, ejes distintos, diámetro promedio ponderado - OK
    - UI collapsible tree en tab Dashboards con selector de proyecto - OK
    - Colores por sector (FUND marrón, ELEV verde, LCIELO azul, VCIELO naranja) - OK
    - Summary bar con totales de sectores, barras y kilos - OK
    - Nivel ciclo muestra: barras, kilos, ejes, ⌀ promedio ponderado - OK
    - CSS para hover y toggle open/close con animación de flecha - OK

24. Sistema de pedidos (MVP) - OK
    - Migración 8: tablas pedidos (id, proyecto, titulo, estado, creado_por, fechas) + pedido_items (diam, largo, cantidad, sector, nota, estado) - OK
    - pedidos.py: CRUD completo — GET/POST/PATCH/DELETE /pedidos, GET /pedidos/{id}, POST/PATCH/DELETE items - OK
    - Estados pedido: borrador → enviado → en_proceso → completado / cancelado - OK
    - Estados item: pendiente → en_proceso → completado - OK
    - UI Tab Pedidos: crear pedido (proyecto + título), lista con filtro por estado, detalle con items - OK
    - Agregar items inline: diámetro, largo, cantidad, sector, nota - OK
    - Cambiar estado pedido desde dropdown, eliminar pedido/items con confirmación - OK
    - Color-coded badges para estados (gris/azul/naranja/verde/rojo) - OK
    - Registrado en main.py, selects de proyecto poblados en loadProyectos + loadFilters - OK

25. Modelo de datos clientes + permisos - OK
    - Migración 10: tabla clientes (id, nombre, rut, contacto, email, telefono, direccion, notas, activo) + cliente_id FK en proyectos - OK
    - clientes.py: CRUD completo GET/POST/PATCH/DELETE /clientes + GET /clientes/{id} con proyectos asociados - OK
    - POST /proyectos/{id}/asignar-cliente para asignar/desasignar cliente a proyecto - OK
    - GET /proyectos incluye cliente_id y cliente_nombre - OK
    - POST/PATCH /proyectos acepta cliente_id - OK
    - UI: selector de cliente al crear obra, panel de clientes con tabla (nombre, rut, contacto, email, tel, proyectos, kilos) - OK
    - UI: crear cliente inline, editar nombre, proyecto cards muestran cliente - OK
    - Soft-delete clientes (activo=false), unique index en nombre - OK

25b. Rediseño de roles y permisos - Pendiente
    Roles actuales: admin, coordinador, cubicador, operador, cliente.
    Problemas detectados:
    - "operador" es genérico y poco claro → redefinir o eliminar
    - Se necesita un rol tipo "jefe/supervisor" con acceso visual a todo pero sin poder destructivo
    - Solo el admin principal debería poder resetear BD, eliminar usuarios, etc.

    Propuesta:
    - Nuevo rol "jefe" o "supervisor": ve todos los proyectos, dashboards, reportes, exportaciones.
      No importa CSVs, no elimina obras/BD, no gestiona usuarios. Ideal para gerencia.
    - Aclarar "operador": definir si es un cubicador limitado o se reemplaza por otro nombre.
    - Registro público (/auth/signup) asigna rol por defecto (actualmente "operador").
    - El admin puede cambiar roles desde el panel Admin.
    - Acciones destructivas (reset BD, eliminar usuarios) restringidas a admin exclusivamente.
    - Pendiente: definir permisos exactos por rol con el usuario.

26. Auditoría y logs en panel Admin - OK
    - Migración 11: tabla audit_log (id, usuario, accion, detalle, entidad, entidad_id, fecha) con índices - OK
    - Helper audit() en db.py: fire-and-forget, no falla si tabla no existe - OK
    - GET /admin/audit: consulta con filtros (usuario, accion, entidad), paginación, dropdown values - OK
    - Acciones instrumentadas: login, signup, registrar_usuario, importar_csv, exportar_excel,
      crear/editar/eliminar_proyecto, mover_barras, crear/editar/desactivar_cliente, asignar_cliente, reset_db - OK
    - UI: panel Auditoría en tab Admin con tabla color-coded, filtros por usuario/acción/entidad, paginación - OK

27. Gestión de calculistas y KPIs por calculista - OK
    - Migración 12: tabla calculistas (id, nombre, email, activo) + calculista_id FK en proyectos - OK
    - Migración automática: datos existentes en campo texto migrados a tabla normalizada - OK
    - Unique index en nombre (case-insensitive) para evitar duplicados - OK
    - calculistas.py: CRUD completo GET/POST/PATCH/DELETE + GET /calculistas/{id} con proyectos - OK
    - GET /calculistas/kpis: diam promedio ponderado, PPI (kg/proyecto), PPB (kg/barra), kilos, proyectos - OK
    - GET /proyectos incluye calculista_id y calculista_nombre desde tabla normalizada - OK
    - POST/PATCH /proyectos acepta calculista_id - OK
    - UI: selector desplegable de calculistas en crear obra (reemplaza input texto) - OK
    - UI: panel Calculistas con tabla (nombre, email, proyectos, barras, kilos) - OK
    - UI: crear calculista inline, editar nombre con prompt - OK
    - Soft-delete calculistas (activo=false) - OK
    - Audit logging en crear/editar/desactivar calculista - OK

28. Rediseño de dashboards y analítica avanzada - Pendiente
    - Definir qué dashboards se necesitan (KPIs clave, vistas por rol, comparativas) - Pendiente
    - Rediseñar tab Dashboards con métricas más relevantes y gráficos mejorados - Pendiente
    - Dashboards específicos por rol (admin vs coordinador vs cubicador) - Pendiente
    - Pendiente definición de requerimientos específicos por parte del usuario

---
## FASE 6 — Gestión de errores y reclamos

**Objetivo**: Módulo centralizado para registrar, clasificar, dar seguimiento y cerrar
errores y reclamos levantados por clientes. Incluye formulario tipo, análisis de causa raíz
(Ishikawa) y trazabilidad completa. Visible para todos los roles excepto cliente.

29. Modelo de datos de reclamos - OK
    - Migración 13: tabla reclamos (id, id_proyecto, titulo, descripcion, estado, prioridad, categoria_ishikawa, responsable, accion_correctiva, accion_preventiva, resolucion, creado_por, fechas) - OK
    - Tabla reclamo_seguimientos (id, reclamo_id, usuario, comentario, estado_anterior, estado_nuevo, fecha) - OK
    - Estados: abierto/en_analisis/accion_correctiva/cerrado/rechazado con CHECK constraint - OK
    - Prioridades: baja/media/alta/critica con CHECK constraint - OK
    - Categorías Ishikawa: 6 categorías clásicas (provisorias, ajustar con usuario) - OK
    - Índices en id_proyecto, estado, prioridad, reclamo_id - OK
    - Reset database actualizado con DROP reclamo_seguimientos + reclamos - OK

30. Formulario de registro de reclamo - OK (v2 ampliado)
    - Campos reales: proyecto, título, descripción, prioridad, responsable, detectado_por, fecha_detección - OK
    - Causa Ishikawa con modal interactivo: 6 categorías × sub-causas codificadas (ej. [P1] Falta capacitación) - OK
    - Campos ocultos: categoria_ishikawa, sub_causa, cod_causa poblados desde modal - OK
    - Asignación de responsable (texto libre) - OK
    - Upload de imágenes (múltiples, BYTEA, inline view, delete) - OK
    - Migración 14: nuevos campos reclamos + tabla reclamo_acciones + tabla reclamo_imagenes - OK

31. Seguimiento y cierre de reclamos - OK (v2 ampliado)
    - Timeline ascendente con usuario, comentario, cambio de estado color-coded - OK
    - Cambio de estado con registro automático (quién, cuándo, anterior → nuevo) - OK
    - Seguimiento auto-creado al crear reclamo y al cambiar estado - OK
    - Aplica / No aplica / Pendiente — dropdown en detalle con update inmediato - OK
    - Acciones (inmediata, correctiva, preventiva) — tabla CRUD con tipo, responsable, fecha prevista, estado - OK
    - Sección RCA en detalle: causa Ishikawa (modal), área aplica, fecha análisis, explicación causa, observaciones - OK
    - Cierre con resumen de resolución + fecha_cierre automática - OK
    - POST /reclamos/{id}/seguimientos con cambio de estado opcional - OK
    - POST/DELETE /reclamos/{id}/acciones — CRUD acciones - OK
    - POST/DELETE /reclamos/{id}/imagenes — upload y eliminación inline - OK
    - GET /reclamos/ishikawa — categorías y sub-causas para modal - OK
    - Audit logging en crear, actualizar, eliminar reclamo, seguimiento, acciones, imágenes - OK

32. UI Tab Reclamos - OK (v2 ampliado)
    - Tab "⚠️ Reclamos" visible para admin, coordinador, cubicador, operador - OK
    - KPIs: total, abiertos, aplica, no aplica, cerrados, días prom. resolución - OK
    - Top causas repetitivas con código y badge de frecuencia - OK
    - Formulario nuevo reclamo inline collapsible con todos los campos reales - OK
    - Modal Ishikawa interactivo: grid 6 categorías color-coded con radio buttons por sub-causa - OK
    - Lista con filtros (estado, prioridad, categoría, aplica) - OK
    - Tabla color-coded: correlativo, badges estado, aplica, prioridad, cod_causa, fecha detección - OK
    - Vista detalle: info completa, aplica dropdown, RCA con Ishikawa modal, acciones CRUD, imágenes, timeline - OK
    - Agregar seguimiento inline con cambio de estado opcional - OK
    - Upload múltiples imágenes con preview y eliminación inline - OK
    - Eliminar reclamo con confirmación (cascade: acciones + imágenes + seguimientos) - OK
    - Selector proyecto poblado desde loadProyectos - OK
    - Fix: tab reclamos subrayaba admin en vez de reclamos - OK
    - id_calidad editable en detalle + campo en formulario crear - OK
    - correlativo (REC-001) + id_calidad prominentes en tabla y detalle - OK
    - Cliente asociado al reclamo: migración 18 (cliente_id FK), dropdown en crear y detalle - OK
    - Crear cliente inline desde formulario reclamo (+ Nuevo) - OK
    - Cambiar cliente en detalle con PATCH inmediato - OK
    - Pendiente: filtro por proyecto del usuario, integración USC

32b. Dashboard de Reclamos - ✅ Implementado 9-Mar-2026
    - Sección colapsable debajo de KPIs, carga bajo demanda - OK
    - GET /reclamos/dashboard: endpoint con 8 agregaciones SQL - OK
    - Gráficos Chart.js:
      a) Reclamos por mes (bar, últimos 12 meses) - OK
      b) Tiempo promedio resolución por mes (line) - OK
      c) Distribución por categoría Ishikawa (doughnut, 6M color-coded) - OK
      d) Por estado actual (doughnut) - OK
      e) Por obra Top 10 (horizontal bar) - OK
      f) Por responsable Top 10 (horizontal bar) - OK
    - Matriz Obra × Categoría Ishikawa:
      - Tabla heatmap HTML con intensidad de color proporcional - OK
      - Top 8 obras × todas las categorías con totales fila/columna - OK
      - Grand total y color-coding rojo proporcional - OK
    - Por creador (top 10) disponible en endpoint para futura UI - OK

33. Hub de navegación y módulos - ✅ Implementado 9-Mar-2026
    **Diseño aprobado 9-Mar-2026**. Post-login el usuario ve una pantalla Hub con 3 módulos:

    a) Módulo 🏗️ Cubicación (todos los roles) - ✅ Hecho
       - Tabs internos: Inicio, Obras, Bar Manager, Dashboards, Exportación, Pedidos
       - Acceso según rol (igual que hoy)
       - Botón para volver al Hub siempre visible

    b) Módulo ⚠️ Reclamos (todos excepto cliente) - ✅ Hecho
       - Tabs internos: Dashboard Reclamos, Lista, Detalle
       - id_calidad prominente como identificador principal del usuario
       - Correlativo auto (REC-001) como referencia interna

    c) Módulo ⚙️ Administración (solo admin) - ✅ Hecho
       - Tabs internos: Usuarios, Clientes, Calculistas, Auditoría, Gestión de Datos
       - Absorbe el tab Admin actual (que se elimina)
       - Clientes y Calculistas migran de Obras a este módulo
       - Panel "Gestión de Datos": limpieza por tabla (barras, imports, proyectos,
         reclamos, calculistas, clientes, pedidos, audit_log) con contadores
       - Admin = operaciones masivas por tabla, nunca eliminación parcial individual
       - Reset completo de BD se mantiene con doble confirmación

    d) Diseño visual del Hub - ✅ Hecho
       - 3 cards grandes con ícono, título, descripción corta
       - Card Admin solo visible para rol admin
       - Header ArmaHub + info usuario siempre visible

34. Integridad de datos de barras - ✅ Implementado 9-Mar-2026
    **Diseño aprobado 9-Mar-2026**. Principio de inmutabilidad de la carga.

    a) import_id en barras - ✅ Hecho (migración 15 + importer)
       - Migración: agregar import_id (FK a imports) en tabla barras
       - Importer asigna import_id al insertar barras
       - Trazabilidad explícita carga↔barra

    b) Eliminar carga por import_id - ✅ Hecho (con fallback legacy)
       - DELETE FROM barras WHERE import_id = X (no por proyecto+fecha)
       - Warning si barras fueron modificadas (cambio de sector)
       - Sin huérfanos posibles

    c) Eliminar "mover barras entre proyectos" - ✅ Hecho
       - Quitar funcionalidad de POST /barras/mover (cambio de id_proyecto)
       - Mantener cambio de sector dentro del mismo proyecto
       - Reemplazar con crear/duplicar barra manual

    d) Múltiples orígenes de barras - ✅ Hecho
       - Campos origen, import_id, pedido_id, creado_por ya en barras
       - origen TEXT DEFAULT 'csv' — valores: 'csv' | 'manual' | 'pedido'
       - import_id BIGINT FK a imports (solo origen='csv')
       - pedido_id BIGINT (solo origen='pedido')
       - creado_por TEXT — usuario que creó (manual/pedido)
       - Barras CSV: protegidas, se eliminan con su carga (por import_id)
       - Barras manuales: eliminación individual permitida
       - Barras de pedido: eliminación desde el pedido

35. Bar Manager rediseñado - ✅ Implementado 9-Mar-2026
    a) Quitar "mover entre proyectos" - ✅ Hecho
    b) Mantener "cambiar sector" (mismo proyecto) - ✅ Hecho (POST /barras/cambiar-sector)
    c) Crear barra manual - ✅ Hecho
       - Formulario colapsable "Crear barra" en Bar Manager
       - Campos: proyecto, sector, piso, ciclo, eje, φ, largo, cant, figura, marca
       - POST /barras/crear → id_unico=MAN-{uuid}, origen='manual', creado_por=email
       - Peso calculado con fórmula ArmaHub (7850 * π * (d/2000)² * largo/100)
    d) Duplicar barra - ✅ Hecho
       - Botón "Duplicar" por fila en la tabla de barras
       - POST /barras/{id_unico}/duplicar → copia todos los campos, nuevo MAN-{uuid}
       - Se crea como barra manual (origen='manual')
       - Original intacta
    e) Eliminar barra individual - ✅ Hecho
       - Botón "✕" por fila (solo visible en barras manual/pedido)
       - DELETE /barras/{id_unico} — solo permite manual/pedido
       - Barras CSV: protegidas, se eliminan solo con la carga completa
       - Eliminación masiva desde toolbar (omite CSV automáticamente)
    f) Filtrar por origen - ✅ Hecho
       - Dropdown "Origen: Todos / CSV / Manual / Pedido" en barra de filtros
       - Columna "Origen" con badge de color en la tabla de barras

36. IDs de reclamos - ✅ Implementado 9-Mar-2026
    a) correlativo auto-generado - ✅ Hecho
       - Formato: REC-001, REC-002, REC-003...
       - Secuencial, nunca resetea, inmutable
       - Generado al crear reclamo (MAX(correlativo) + 1)
       - Visible como referencia interna en tabla y detalle
    b) id_calidad manual - ✅ Hecho
       - Campo texto, ingresado por usuario (ej: NC-2026-014)
       - El identificador principal para el usuario
       - Nullable (puede asignarse después de crear)
       - Editable en cualquier momento
       - Buscable, filtrable, destacado en UI
       - Migración: campo id_calidad en tabla reclamos

37. Pedidos conectados con barras y exportación - ✅ Implementado 9-Mar-2026
    a) Pedido genérico (sin sector) - ✅ Hecho
       - Items con: eje (texto libre, máx 14 chars, alfanumérico+espacios),
         diámetro, largo, cantidad, nota
       - Sin sector/piso/ciclo → se exportan con SECTOR=NA, PISO=NA, CICLO=NA
       - EJE = texto del usuario (ej: "Trabas muro 1") → columna A en aSa Studio
       - Exportación en formato aSa Studio (igual que cubicación)
       - Tipo "genérico" en selector al crear pedido
       - Campos sector/piso/ciclo ocultos en UI para pedidos genéricos
    b) Pedido específico (con sector) - ✅ Hecho
       - Items con: sector, piso, ciclo, eje, diámetro, largo, cantidad, nota
       - Se integran a la cubicación del proyecto (origen='pedido')
       - Aparecen en matriz de exportación y se exportan en formato aSa Studio
       - Tipo "específico" en selector al crear pedido
       - Campos sector/piso/ciclo visibles en UI para pedidos específicos
    c) Validación columna EJE para aSa Studio - ✅ Hecho
       - Máximo 14 caracteres
       - Solo caracteres alfanuméricos + espacios (sin tildes, ñ, símbolos)
       - Validación en frontend (maxlength + pattern) y backend (regex _EJE_RE)
       - aSa Studio agrupa barras por valor de columna A (EJE)
    d) Procesar pedido → barras - ✅ Hecho
       - POST /pedidos/{id}/procesar convierte items en barras
       - Barras generadas con origen='pedido', pedido_id, pedido_item_id
       - id_unico: PED-{uuid12} para identificar barras de pedido
       - Peso calculado automáticamente (fórmula ArmaHub)
       - Botón "⚡ Procesar → Barras" visible solo si pedido enviado/en_proceso y no procesado
       - Una vez procesado, no se puede reprocesar (flag procesado=true)
    e) Migración 17 - ✅ Hecho
       - pedidos.tipo (generico/especifico)
       - pedidos.procesado (boolean)
       - pedido_items.eje (text)
       - barras.pedido_item_id (bigint)

38. Obra independiente de cubicación - Implementado
    - La obra es entidad de primer nivel, no depende de tener barras
    - Reclamos se vinculan a obras que pueden no tener cubicación
    - Pedidos se vinculan a obras que pueden no tener cubicación
    - Crear obra manualmente ya existe, se refuerza como flujo principal
    - Obras de cualquier tipo (no solo edificación) pueden existir en el sistema
    - CSV sin línea PROYECTO: ahora es válido: muestra modal para elegir proyecto existente o crear nuevo
    - Al crear proyecto nuevo desde import se puede asignar cliente, dueño y calculista
    - Parámetros backend: reasignar_a, cliente_id, owner_id, proyecto_nombre_manual
    - Modal "Archivo sin proyecto" con 2 opciones: asignar a existente o crear nuevo

38b. Gestión de usuarios desde Admin - Pendiente
    a) Crear usuario sin registro público - Pendiente
       - Admin crea usuario con email, nombre, rol, contraseña temporal
       - Sin necesidad de que el usuario se registre por /auth/signup
    b) Bloquear/desbloquear usuario - Pendiente
       - Toggle activo/inactivo desde panel Admin
       - Usuario bloqueado no puede hacer login
    c) Modificar contraseña de usuario - Pendiente
       - Admin puede resetear contraseña de cualquier usuario
       - Genera contraseña temporal o permite establecer una nueva
    d) Editar rol y datos del usuario - Pendiente
       - Cambiar rol, nombre, email desde panel Admin

38c. Perfil de usuario (self-service) - Pendiente
    a) Cambiar contraseña propia - Pendiente
       - Formulario: contraseña actual + nueva contraseña + confirmar
       - Validación de contraseña actual antes de permitir cambio
    b) Ver/editar datos básicos del perfil - Pendiente
       - Nombre, email (solo lectura o editable según diseño)

---
## FASE 7 — Preparación para Apps

39. API versionada (/api/v1) - Pendiente
40. CORS para aplicaciones externas - Pendiente
41. Observabilidad: /health, logs estructurados - Pendiente
42. Performance: queries optimizadas, pool de conexiones - Pendiente
43. Bootstrap profesional (solo dev) - Pendiente