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
- Sistema de autenticación con usuarios y roles (admin, coordinador, cubicador, usc, externo, cliente)
- RBAC completo: permisos por módulo, acción y sección (ver FASE 6.5)
- Importación de CSV desde Arma Detailer con nombres legibles (proyectos + planos)
- Cálculo automático de peso de acero
- Dashboard con agrupaciones por múltiples dimensiones
- Filtros de consulta con nombres legibles
- Interfaz web modular: Hub + Cubicación + Reclamos + Administración
- Panel de administración (admin completo, coordinador limitado)
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
7. **Permisos granulares (RBAC)**: ver FASE 6.5 para matriz completa
   - Admin: acceso total + panel administración completo
   - Coordinador: reclamos + admin limitado (usuarios USC, clientes, proyectos)
   - Cubicador: cubicación completa + responde reclamos
   - USC: crea y documenta reclamos
   - Externo: responde reclamos
   - Cliente: vista limitada de sus proyectos

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

El sistema usa un Hub con 3 módulos: Cubicación, Reclamos, Administración.
Cada módulo tiene tabs internos. La visibilidad del Hub y tabs depende del rol (ver FASE 6.5).

### **Módulo Cubicación** (admin, cubicador, cliente)
- **Inicio**: KPIs, resumen proyectos, chart top 5
- **Obras**: Tarjetas de proyectos, carga CSV, historial
- **Bar Manager**: Filtros, tabla barras, mover barras
- **Dashboards**: Análisis por sector, piso, ciclo, matriz constructiva
- **Pedidos**: Formulario manual de barras
- **Exportación**: ZIP Excel formato aSa Studio
- Cliente: solo ve Inicio + Dashboards (sus proyectos)

### **Módulo Reclamos** (admin, coordinador, cubicador, usc, externo)
- Lista de reclamos con filtros y KPIs
- Flujo 3 etapas: Creación → Respuesta → Validación
- Permisos detallados por sección y acción (ver FASE 6.5)

### **Módulo Administración** (admin, coordinador)
- Gestión de usuarios (admin: completo, coordinador: limitado a crear USC)
- Gestión de clientes y proyectos
- Calculistas, limpieza datos, reset BD, auditoría (solo admin)

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
    - Crear obra inline desde formulario reclamo (+ Crear obra) → POST /proyectos - OK
    - Obra se auto-selecciona en dropdown tras crearla - OK
    - Nota: cliente_id en reclamos fue revertido (redundante — cliente se obtiene vía proyecto)
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

32c. Flujo 3 etapas de reclamos - OK
    Flujo: Creación (Usuario 1) → Respuesta (Cubicador) → Validación (Validador)

    a) Etapa 1 — Creación del reclamo
       - Categoría tipo_reclamo: Error / Faltante (selector al crear) - OK
       - Imágenes de antecedentes (tipo='antecedente') con drag&drop + Ctrl+V - OK
       - Prioridad eliminada de UI, default 'alta' en backend - OK
       - Drop zone para imágenes al crear reclamo - OK
       - Ishikawa removido del formulario de creación (se mueve a respuesta) - OK

    b) Etapa 2 — Respuesta del responsable (cubicador)
       - Sección "Respuesta del responsable" en detalle (fondo azul) - OK
       - Campos: respuesta_texto, respuesta_fecha, respuesta_por (auto-set en backend) - OK
       - Imágenes de respuesta (tipo='respuesta') con drag&drop + Ctrl+V - OK
       - Cubicador clasifica causa Ishikawa desde sección respuesta - OK
       - Botón "Guardar respuesta" guarda RCA + texto respuesta - OK

    c) Etapa 3 — Validación
       - Sección "Validación" en detalle (fondo verde) - OK
       - Campos: validacion_resultado (aprobado/rechazado/corregido), validacion_observaciones - OK
       - Campos: validacion_fecha, validacion_por (auto-set en backend) - OK
       - Botón "Guardar validación" con resultado obligatorio - OK
       - Pendiente futuro: auto-cambio de estado al rechazar/aprobar

    d) Migración 19: nuevos campos en reclamos y reclamo_imagenes - OK
       - reclamos: tipo_reclamo, respuesta_texto, respuesta_fecha, respuesta_por
       - reclamos: validacion_resultado, validacion_observaciones, validacion_fecha, validacion_por
       - reclamo_imagenes: tipo (antecedente/respuesta)
       - Estado 'validacion' agregado al CHECK constraint

    e) Estados actualizados - OK
       - abierto → en_analisis → accion_correctiva → validacion → cerrado/rechazado
       - Dropdowns de estado actualizados en detalle y seguimiento
       - Color violeta (#7B1FA2) para estado 'En validación'

    f) Fix modal Ishikawa - OK
       - Botón Cancelar agregado junto a Confirmar
       - ESC cierra el modal
       - Click en backdrop (fuera del contenido) cierra el modal
       - Botón ✕ ya existía

    g) Pendiente futuro: notificaciones, permisos por rol, dashboard específico, auto-estado en validación

38b. Gestión de usuarios desde Admin - ✅ Implementado 10-Mar-2026
    Migración 20: nombre, activo, fecha_creacion en tabla users

    a) Panel de usuarios en Admin - OK
       - Tabla con email, nombre, rol (dropdown editable), estado, fecha creación
       - Formulario colapsable "+ Nuevo usuario" con email, nombre, contraseña, rol
       - Total de usuarios visible
       - GET /admin/users (solo admin)

    b) Crear usuario sin registro público - OK
       - Admin crea usuario con email, nombre, rol, contraseña temporal
       - POST /auth/register incluye nombre
       - Lista se actualiza automáticamente tras crear

    c) Bloquear/desbloquear usuario - OK
       - Botón Activar/Desactivar por fila
       - PATCH /admin/users/{id}/activo
       - Login bloqueado para usuarios inactivos (403 "Usuario desactivado")
       - No se puede desactivar a sí mismo

    d) Cambiar rol - OK
       - Dropdown inline por usuario (admin, coordinador, cubicador, operador, cliente)
       - PATCH /admin/users/{id}/role
       - No se puede quitar admin a sí mismo

    e) Resetear contraseña - OK
       - Botón "Cambiar clave" → prompt con nueva contraseña
       - PATCH /admin/users/{id}/password (mín. 6 caracteres)

    f) Eliminar usuario - OK
       - Botón "Eliminar" con confirmación
       - DELETE /admin/users/{id}
       - No se puede eliminar a sí mismo

    g) Nota: no se envían correos al crear usuarios (sin sistema de notificaciones aún)

38d. Mejoras reclamos: filtros, dropdowns, apellido usuarios - ✅ Implementado 10-Mar-2026
    Migración 21: apellido en tabla users

    a) Filtros expandidos en lista de reclamos - OK
       - Búsqueda por texto (título, descripción, correlativo, id_calidad)
       - Filtro por tipo (Error/Faltante)
       - Filtro por categoría Ishikawa
       - Filtro por aplica (Sí/No/Pendiente)
       - Filtro por detectado_por (Cliente/USC/Cubicador/Producción)
       - Filtro por proyecto (dropdown con obras)
       - Filtro por responsable (dropdown con usuarios)
       - Botón "Limpiar" para resetear todos los filtros
       - Backend: nuevos params tipo_reclamo, detectado_por, responsable, busqueda en GET /reclamos

    b) Detectado por: dropdown fijo - OK
       - Opciones: Cliente, USC, Cubicador, Producción
       - En formulario de creación y filtro de lista

    c) Responsable: dropdown de usuarios - OK
       - GET /users/dropdown: devuelve id, email, nombre, apellido, display (nombre apellido)
       - Dropdown muestra "Nombre Apellido (rol)" en creación
       - Dropdown muestra "Nombre Apellido" en filtro
       - Valor almacenado: nombre completo del usuario (no email)

    d) Apellido en usuarios - OK
       - Migración 21: campo apellido en tabla users
       - Formulario crear usuario: campos Nombre y Apellido separados
       - POST /auth/register acepta apellido
       - GET /admin/users devuelve apellido
       - Tabla admin muestra "Nombre Apellido" combinado

    e) Columnas adicionales en tabla reclamos - OK
       - Detectado por y Responsable ahora visibles en la tabla

    f) Dashboard de reclamos: comparación multi-año - OK
       - Gráfico de barras agrupadas por mes (Ene-Dic), una barra de color por año
       - Backend retorna datos agrupados por año+mes para todos los años
       - Leyenda automática cuando hay más de un año
       - 8 colores distintos para hasta 8 años

38e. Campo kilos mal fabricados - ✅ Implementado 10-Mar-2026
    Migración 22: kilos_mal_fabricados (DOUBLE PRECISION) en tabla reclamos

    a) Input numérico en Sección 2 (Respuesta del responsable) - OK
       - Campo tipo number con step 0.01
       - Guardado junto con la respuesta via guardarRespuesta()
       - Editable por cubicador y admin

    b) Visible en Sección 1 (Antecedentes) - OK
       - Muestra "Kilos mal fabricados: X.XX kg" en rojo cuando tiene valor

    c) Backend - OK
       - ReclamoUpdate incluye kilos_mal_fabricados (Optional[float])
       - GET /reclamos/{id} retorna kilos_mal_fabricados
       - PATCH /reclamos/{id} permite actualizar kilos_mal_fabricados

38c. Perfil de usuario y mejoras admin - ✅ Implementado 10-Mar-2026

    a) Cambiar contraseña propia (self-service) - OK
       - POST /me/password: valida contraseña actual, cambia a nueva (mín. 6 chars)
       - Botón "🔑 Mi clave" en header, junto a "Salir"
       - 3 prompts: contraseña actual → nueva → confirmar
       - Auditoría: acción "cambiar_password_propia"

    b) Editar nombre de usuarios (admin) - OK
       - Botón "Nombre" en tabla de usuarios del panel admin
       - Prompts para nombre y apellido, llama PATCH /admin/users/{id}/nombre
       - Tabla se actualiza automáticamente tras editar

    c) Header muestra nombre del usuario - OK
       - GET /me retorna nombre y apellido desde DB
       - Header muestra "Nombre Apellido" en vez de email (fallback a email si sin nombre)

    d) Área responsable: dropdown fijo en reclamos - OK
       - Opciones: USC, Logística, Producción, Cubicación
       - Reemplaza input texto libre por <select> en sección Respuesta
       - Valor se guarda con guardarRespuesta()

38f. Editar reclamo (antecedentes) - ✅ Implementado 10-Mar-2026
    a) Botón "✏️ Editar" en Sección 1 (Antecedentes) - OK
       - Toggle inline: muestra formulario de edición, oculta info read-only
       - Botón cambia a "✕ Cancelar" cuando está abierto
       - Se resetea al abrir otro reclamo

    b) Campos editables - OK
       - Título, Categoría (Error/Faltante), Fecha detección
       - Detectado por (dropdown), Responsable (dropdown usuarios)
       - Descripción del problema (textarea)

    c) Guardar cambios via PATCH /reclamos/{id} - OK
       - Validación: título obligatorio
       - Cierra formulario y refresca vista + lista tras guardar

    d) Permisos - 
       - Solo admin y creador del reclamo pueden ver el botón "" Editar"
       - Verificación: currentRole === 'admin' || data.creado_por === currentUserEmail
       - Doble guarda: botón oculto en UI + validación en guardarEdicionReclamo()
       - currentUserEmail se carga desde GET /me al iniciar sesión

38g. Gestión de proyectos desde Admin - ✅ Implementado 10-Mar-2026

    a) Tabla de proyectos en panel admin - OK
       - Columnas: Nombre, ID, Calculista, Cliente, Barras, Kilos, Creador
       - Total de proyectos visible
       - Botón "Actualizar" para refrescar

    b) Editar proyecto inline - OK
       - Botón "Editar" por fila → formulario inline sobre la tabla
       - Campos editables: Nombre, Calculista (dropdown), Cliente (dropdown), Descripción
       - Al renombrar proyecto, se actualiza nombre en barras (cascada backend)
       - Guardar refresca tabla admin + dropdowns de proyecto en otras secciones

    c) Backend ya existente reutilizado - OK
       - GET /proyectos: ahora incluye descripcion, fecha_creacion, usuario_creador
       - PATCH /proyectos/{id}: nombre, descripcion, calculista_id, cliente_id
       - Cascada: UPDATE barras SET nombre_proyecto al renombrar

38h. Campo id_calidad editable - ✅ Implementado 10-Mar-2026
    a) Input "Correlativo calidad" añadido al formulario de edición (fila 1)
       - Se pre-llena con valor actual al abrir formulario
       - Se incluye en PATCH /reclamos/{id} al guardar
       - Backend ya lo soportaba (ReclamoUpdate.id_calidad)

---
## FASE 6.5 — Roles y Permisos (RBAC)

39. Definición e implementación de roles - ✅ Implementado 10-Mar-2026

    a) Roles del sistema:
       - admin: Dueño del sistema, acceso total
       - coordinador: Jefa USC, administra reclamos y calidad, admin limitado
       - cubicador: Cubicador interno, cubicación + responde reclamos
       - usc: Personal USC, crea y documenta reclamos
       - externo: Cubicador externo, solo reclamos (responde)
       - cliente: Cliente externo, acceso cubicación (ve todos los proyectos)
       - Rol "operador" eliminado, migrado a "usc" (migración 23)

    b) Hub (pantalla inicial):
       - Cubicación: admin, cubicador, cliente
       - Reclamos: admin, coordinador, cubicador, usc, externo
       - Administración: admin, coordinador

    c) Cubicación datos:
       - Todos los roles con acceso al módulo ven TODOS los proyectos y cubicaciones
       - No hay filtrado por proyecto a nivel backend (acceso controlado en hub)
       - Cliente: solo tabs Inicio + Dashboards
       - Admin/cubicador: todos los tabs

    d) Reclamos permisos por acción:
       - Crear reclamo: admin, coordinador, usc
       - Editar antecedentes (Sec 1): admin/coordinador cualquiera, usc propios
       - Responder (Sec 2): admin, coordinador, cubicador, externo (NO usc)
       - Validar (Sec 3): admin, coordinador
       - Cambiar aplica: solo admin
       - Cambiar estado: admin/coordinador siempre, cubicador solo propios
       - Eliminar reclamo: admin, coordinador
       - Agregar seguimiento: todos con acceso a reclamos
       - Agregar acción correctiva: admin, coordinador, cubicador
       - Imágenes antecedente: todos
       - Imágenes respuesta: admin, coordinador, cubicador, externo (NO usc)

    e) Bloqueo post-validación:
       - Una vez validado (Sec 3), se bloquean Sec 1/2/3 para todos excepto admin

    f) Admin permisos coordinador:
       - SI: ver usuarios, crear usuarios (solo rol USC), editar nombre, bloquear, resetear clave, clientes, proyectos
       - NO: cambiar roles, eliminar usuarios, calculistas, limpieza datos, reset BD

    g) Cambios backend:
       - Migración 23: UPDATE operador a usc, nuevo CHECK constraint
       - VALID_ROLES actualizado en auth.py
       - require_admin_or_coordinador para endpoints compartidos
       - Coordinador solo puede crear usuarios USC (validación en register)
       - _get_allowed_project_ids actualizado para nuevos roles

    h) Cambios frontend:
       - Hub cards con visibility por rol
       - Tab access por módulo y rol
       - verReclamo: bloque completo de permisos (botones, dropdowns, secciones)
       - loadUsers: role dropdown/label según rol del viewer
       - switchModule admin: oculta secciones para coordinador
       - Dropdown de roles en crear usuario filtrado para coordinador

40. Registro de creador USC en reclamos (asignado_a / "Subido por") - ✅ Implementado 10-Mar-2026
    Migración 24: campo asignado_a (TEXT, nullable) en tabla reclamos

    a) Lógica automática al crear reclamo:
       - USC crea reclamo: se registra automáticamente como "Subido por"
       - Admin/coordinador crea reclamo: puede elegir usuario USC del dropdown o dejar vacío
       - Campo "Subido por" visible solo para admin/coordinador en formulario de creación

    b) Dropdown "Subido por" en detalle del reclamo:
       - Muestra usuarios USC activos (GET /reclamos/usuarios-usc)
       - Solo admin/coordinador pueden cambiar el valor
       - Otros roles ven el campo deshabilitado
       - Cambio en tiempo real via PATCH /reclamos/{id}

    c) Metadatos visibles:
       - "Subido por: email" en la línea de meta del reclamo
       - Disponible en lista de reclamos (asignado_a en respuesta GET /reclamos)

    d) Backend:
       - ReclamoCreate y ReclamoUpdate incluyen asignado_a
       - GET /reclamos y GET /reclamos/{id} retornan asignado_a
       - GET /reclamos/usuarios-usc: lista usuarios USC activos para dropdown
       - Lógica de auto-asignación en crear_reclamo según rol del creador

---
## FASE 7 — Preparación para Apps

41. Landing page reclamos con KPI charts + Dashboards admin + Rename Constructoras - ✅ Implementado 11-Mar-2026

    a) Landing page reclamos (todos los roles con acceso):
       - 3 charts fijos: total reclamos, doughnut error/faltante, histórico mensual por año
       - 4to chart (reclamos por año): visible solo para cubicador y admin
       - Títulos adaptativos: "Mi Resumen" (USC/cubicador) vs "Resumen General" (admin)
       - Backend: GET /reclamos/mi-resumen (filtrado por rol)

    b) Filtrado de lista por rol:
       - USC: solo propios (creado_por o asignado_a) via solo_mios=true
       - Cubicador/Externo: solo respondidos (respuesta_por) via solo_mios=true
       - Admin/Admin2: ven todos los reclamos

    c) Tab Dashboards (solo admin/admin2):
       - Columna USC: bar chart por usuario, stacked error/faltante, histórico mensual
       - Columna Cubicador: doughnut Ishikawa global, bar por cubicador, stacked Ishikawa por cubicador
       - Backend: GET /reclamos/admin-dashboards (solo admin)

    d) Rename Clientes → Constructoras (UI only, DB unchanged):
       - admin.html: título sección, botones crear/guardar
       - app.html: modals nuevo proyecto, proyecto sin match
       - obras.html: label y dropdown en crear obra
       - app.js: dropdowns, mensajes éxito, prompts edición, TABLE_LABELS, lista vacía
       - reclamos.html: "Detectado por" opciones (Cliente → Constructora)
       - Nota: el rol de usuario "cliente" NO se renombra (es un rol, no la entidad)

42. Validación de importación mejorada + resumen multi-planilla - ✅ Implementado 11-Mar-2026

    a) Pre-validación all-or-nothing por archivo:
       - Si CUALQUIER fila tiene error crítico, se rechaza el archivo COMPLETO
       - Errores críticos: ID_UNICO vacío, inconsistencia de IDs
       - Mensaje detallado: "X/Y barras inválidas" con detalle por fila (primeras 10)
       - Archivos con warnings no-críticos (DIAM/LARGO faltante) se cargan normalmente

    b) Verificación de consistencia de IDs:
       - Compara ID_UNICO con sus componentes: ID_PROYECTO, PLANO_CODE, ID
       - Detecta discrepancias causadas por versiones antiguas de ArmaDetailer
       - Si algún componente no aparece en ID_UNICO → error crítico → archivo rechazado

    c) Resumen consolidado multi-planilla (frontend):
       - Al finalizar importación de múltiples archivos, muestra resumen:
         "📊 Resumen: X/Y planillas cargadas — Z barras — W kg"
       - Barra lateral coloreada: verde (todas OK), naranja (parcial), rojo (todas fallaron)
       - Cada archivo individual sigue mostrando su resultado por separado

    d) Detección de ID_UNICO duplicados dentro del mismo archivo:
       - Si un archivo tiene filas con el mismo ID_UNICO → rechazo completo
       - Mensaje: "Archivo tiene X barras pero Y ID_UNICO duplicados (Z filas afectadas)"
       - Previene pérdida silenciosa por ON CONFLICT (ej: 64 barras → 41 cargadas)

    e) Calculista dropdown en modales de creación de proyecto:
       - Dropdown con calculistas existentes + opción "Otro (escribir)" para texto libre
       - Aplicado en modal "Nuevo proyecto detectado" y "Archivo sin proyecto"
       - Usa _calculistasCache ya cargado por loadCalculistas()

    f) Cubicador no puede eliminar obras con datos:
       - Frontend: alerta y bloqueo si barrasCount > 0
       - Backend: HTTP 403 si role=cubicador y barras > 0
       - Obras vacías (sin barras) sí pueden ser eliminadas por cubicador

    g) Bugfix: campo rows_upserted → barras en frontend
       - Corregido en todos los paths de retry (missing_project, new_project, duplicate_warning)
       - Agregados campos filas_rechazadas y advertencias al response del backend

48. Bar Manager mejorado + filtro por carga + fix eliminación - ✅ Implementado 11-Mar-2026

    a) Filtro por carga (import_id) en Bar Manager:
       - Backend: import_id agregado a BARRAS_COLUMNS y ALLOWED_ORDER_BY
       - Backend: parámetro import_id en GET /barras para filtrar barras de una carga específica
       - Frontend: hidden input filtroCarga + badge visual "Filtrando por carga: archivo.csv"
       - Botón "✕ Quitar filtro" para desactivar filtro de carga
       - Texto dinámico: "X barras en esta carga" vs "X barras en proyecto"

    b) "Ver barras" desde Obras → Cargas:
       - Botón "Ver barras" en cada fila del historial de cargas por proyecto
       - Click navega a Bar Manager (switchTab) con proyecto + import_id pre-filtrados
       - Resuelve discrepancia "35 cargadas vs 41 en Bar Manager" (antes mostraba todas las barras del proyecto)

    c) Fix eliminación de barras para admin/cubicador:
       - Backend: admin y cubicador pueden eliminar CUALQUIER barra (incluyendo CSV)
       - Otros roles: mantienen restricción a manual/pedido solamente
       - Frontend: botón ✕ visible para admin/cubicador en todas las barras (no solo manual/pedido)
       - Bulk delete: mensaje de confirmación adaptado por rol
       - Resultado: "Eliminadas: X | No eliminadas: Y" (antes decía "Omitidas CSV")

    d) Fix resumen de importación:
       - Summary envuelto en try/catch para garantizar que siempre se muestra
       - Botón importar se re-habilita siempre (btn.disabled = false)
       - Refreshes post-import envueltos en try/catch (no bloquean el summary)
       - Resumen incluye conteo de errores: "X con error"

    e) Auditoría de entidades (estado actual del modelo de datos):
       - Entidades principales: proyectos, barras, users, clientes, calculistas, imports
       - Relaciones: proyecto→barras (1:N), proyecto→imports (1:N), proyecto→owner (N:1 user),
         proyecto→cliente (N:1), proyecto→calculista (N:1), proyecto→usuarios_autorizados (N:M via proyecto_usuarios)
       - Barras: import_id (FK imports), origen (csv/manual/pedido), pedido_id, creado_por
       - Reclamos: id_proyecto (FK), creado_por, asignado_a, respuesta_por, validacion_por
       - Pedidos: id_proyecto (FK), creado_por, items con sector/piso/ciclo/eje/diam/largo

49. Reclamos: Asignación de Cubicador Responsable - ✅ Implementado 11-Mar-2026

    a) Nuevo campo cubicador_asignado (migración 26):
       - Campo TEXT en reclamos para almacenar email del cubicador responsable del error
       - Índice para consultas rápidas por cubicador asignado

    b) Endpoint GET /reclamos/cubicadores:
       - Devuelve lista de usuarios con rol cubicador activos para dropdown filtrado
       - Respuesta: email, nombre, apellido, display

    c) Formulario de creación:
       - Nuevo dropdown "Cubicador asignado" filtrado solo a cubicadores
       - USC asigna al cubicador responsable al crear el reclamo
       - crearReclamo() envía cubicador_asignado al backend

    d) Detalle del reclamo (Sección 2):
       - Dropdown "Cubicador asignado" en Sección 2 (Respuesta del Responsable)
       - Admin/Admin2 pueden cambiar la asignación con botón "Guardar" independiente
       - Función cambiarCubicadorAsignado() para guardar cambio sin tocar respuesta

    e) Lógica de respuesta (admin responde en nombre del cubicador):
       - Cuando admin/admin2 guarda respuesta, respuesta_por = cubicador_asignado (no admin email)
       - Si no hay cubicador asignado, respuesta_por = admin email como fallback
       - Backend: PATCH verifica body.cubicador_asignado o busca en DB si no viene en body

    f) Landing cubicador mejorado:
       - Filtro mi-resumen usa cubicador_asignado OR respuesta_por (ve asignados + respondidos)
       - Nuevo Chart 5: Dona Ishikawa con distribución de causas del cubicador
       - Badge "Pendientes": cuenta reclamos asignados sin respuesta
       - Grid dinámico: ajusta columnas según charts visibles (3, 4 o 5)

    g) Lista de reclamos:
       - Nueva columna "Cubicador" en tabla de reclamos (muestra email truncado)
       - solo_mios para cubicador usa cubicador_asignado OR respuesta_por
       - cubicador_asignado y respuesta_por incluidos en response del GET /reclamos

    h) Permisos:
       - Creación: USC/Admin/Admin2 pueden asignar cubicador
       - Cambio asignación: solo Admin/Admin2
       - Respuesta: Admin/Admin2/Cubicador/Externo (sin cambio)

43. API versionada (/api/v1) - Pendiente
44. CORS para aplicaciones externas - Pendiente
45. Observabilidad: /health, logs estructurados - Pendiente
46. Performance: queries optimizadas, pool de conexiones - Pendiente
47. Bootstrap profesional (solo dev) - Pendiente