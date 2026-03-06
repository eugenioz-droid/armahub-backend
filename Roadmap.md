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
- Interfaz web con 6 tabs (5 operativas + 1 admin)
- Panel de administración (solo admin): reset BD, crear usuarios, info BD
- Header con branding Armacero (logo banner, colores institucionales)

---

## ESTADO ACTUAL (6 Marzo 2026)

**Fase 0 — Preparación de datos**: 
- Extracción de nombres de proyectos y planos desde CSV (PROYECTO: PROY-XXX|Nombre)
- Tabla proyectos + endpoints GET /proyectos y GET /proyectos/{id}/sectores

**Fase 1.1 — Hardening UI**: 
- Autenticación JWT, badges de usuario/rol, manejo de errores

**Fase 1.2 — Tabla de barras**: 
- Paginación, ordenamiento por columnas, búsqueda rápida
- Columnas nombre_proyecto y nombre_plano en tabla barras

**Fase 1.3 — Rediseño UX con estructura de tabs**: 
- 5 tabs funcionales + 1 tab Admin (condicional por rol)
- Colores Armacero implementados

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

**Pendiente próximo checkpoint**: Backend para tracking de cargas (tabla imports, endpoints /cargas)

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

### **ROL: CUBICADOR / OPERADOR**
- **Tab 1: Mis Obras** (Administración)
  - Resumen de proyectos cargados (tarjetas con kilos, barras, sector)
  - Resumen de cargas: quién cargó, cuándo, versión del archivo (tabla editable)
  - Botones: Recargar archivo | Editar carga | Eliminar | Generar EXCEL
  - Formulario para cargar nuevo CSV
  
- **Tab 2: Búsqueda de Barras** (Detalle)
  - Filtros (Proyecto, Plano con nombres legibles, Sector, Piso, Ciclo)
  - Tabla pageable con ordenamiento
  - Búsqueda rápida

- **Tab 3: Dashboards** (Generales)
  - Resumen global kilos por sector
  - Top 5 proyectos por peso
  - Gráficos de distribución por dimensión

- **Tab 4: Pedidos** (Future MVP)
  - Selector de obra
  - Formulario: ingresar barras manualmente (ID, Eje, Diam, Largo, Cant)
  - Tabla de items agregados
  - Generar solicitud → notificar

- **Tab 5: Exportación** (Producción)
  - Selector de obra
  - Vista previa tabla en formato aSa Studio
  - Botón descargar EXCEL (formato específico)
  - Validación de datos

### **ROL: ADMIN** (hereda todo de cubicador)
- **Tab 6: Admin** (solo visible para admin)
  - Info de BD en tiempo real (conteos, kilos totales)
  - Reset de base de datos (doble confirmación: texto + popup JS)
  - Gestión de usuarios (crear operador/admin)
  - Futuro: auditoría, logs, configuración del sistema

### **ROL: CLIENTE** (Future)
- **Tab 1: Mi Proyecto** (Read-only)
  - Resumen de kilos y barras de su obra
  - Desglose por sector
  
- **Tab 2: Búsqueda de Barras** (Read-only)
  - Acceso igual pero sin botones de edición

- **Tab 3: Pedidos** (Read-only + Submit)
  - Ver historial de pedidos
  - Crear nuevo pedido
  
- **Tab 4: Dashboards** (Read-only)

---

ARMAHUB – PROGRAMA DE TRABAJO

## FASE 0 — Preparación de datos 
0. Extracción de nombres de proyectos y planos desde CSV - OK
   - Tabla proyectos con mapeo id_proyecto → nombre_proyecto - OK
   - Importer parsea "PROYECTO: PROY-XXX|Nombre" desde metadatos - OK
   - Importer parsea "PLANO: UID-XXXX|Nombre del Plano" desde metadatos - OK
   - Columnas nombre_proyecto y nombre_plano en tabla barras - OK
   - Endpoint GET /proyectos (lista obras con totales) - OK
   - Endpoint GET /proyectos/{id}/sectores (desglose por sector) - OK

---

## FASE 1 — MVP usable (UX + operación) 
1. Hardening de UI actual - OK
   - Mostrar usuario y rol siempre en la interfaz - OK
   - Mejorar mensajes de error y estados de carga - OK
   - Ajustes menores de UX - OK

2. Tabla de barras usable - OK
   - Paginación en endpoint /barras (limit / offset) - OK
   - Orden por columnas (kilos, plano, ciclo, fecha, etc.) - OK
   - Búsqueda rápida por id_unico, eje o plano_code - OK

3. Rediseño UX/visual completo - OK
   a) Layout general con tabs de navegación - OK
      - 6 tabs: Mis Obras, Búsqueda, Dashboards, Pedidos, Exportación, Admin - OK
      - Header oscuro con logo Armacero y título verde ArmaHub - OK
      - Tab switching con estado persistente en click - OK
      - Tab Admin condicional (solo visible para rol admin) - OK
   b) CSS profesional - OK
      - Colores Armacero: verde #8BC34A, negro #1a1a1a, gris #2C2C2C - OK
      - Badges de usuario adaptados a header oscuro - OK
   c) **Tab "Mis Obras"** - OK (funcional)
      - Tarjetas de proyectos con resumen kilos/barras - OK
      - Importer CSV integrado - OK
      - Tabla de cargas (placeholder para historia futura) - OK
   d) **Tab "Búsqueda de Barras"** - OK (funcional)
      - Filtros por proyecto, plano (con nombres legibles), sector, piso, ciclo - OK
      - Tabla pageable con ordenamiento por click - OK
      - Columnas nombre_proyecto y nombre_plano visibles - OK
   e) **Tab "Dashboards"** - OK (funcional)
      - Selector de dimensión: sector, piso, ciclo, plano, proyecto, eje - OK
      - Gráficos Chart.js por dimensión con nombres legibles - OK
   f) **Tab "Pedidos"** (placeholder) - OK
   g) **Tab "Exportación"** (placeholder) - OK
   h) **Tab "Admin"** (solo admin) - OK
      - Info de BD (barras, proyectos, usuarios, kilos) - OK
      - Reset de BD con doble confirmación - OK
      - Crear usuarios (operador/admin) - OK

4. Nombres legibles en todo el sistema - OK
   - nombre_proyecto en barras (desde metadato CSV) - OK
   - nombre_plano en barras (desde metadato CSV) - OK
   - /filters devuelve planos como {code, nombre} - OK
   - Dashboard muestra nombres via COALESCE - OK
   - Migraciones ALTER TABLE automáticas en init_db - OK

5. Panel de administración - OK
   - Módulo admin.py con endpoints separados - OK
   - POST /admin/reset-db (con confirm=CONFIRMAR) - OK
   - GET /admin/db-info (resumen BD) - OK
   - UI con sección de reset y gestión de usuarios - OK

6. Backend endpoints pendientes
   - Endpoint DELETE /proyectos/{id} (eliminar obra con cascada) - Pendiente
   - Endpoint GET /proyectos/{id}/exportar-excel (generar EXCEL formato aSa) - Pendiente

7. Filtros avanzados - Pendiente
   - Filtros dependientes (proyecto → plano → ciclo → piso) - Pendiente
   - Persistencia de filtros en URL o localStorage - Pendiente

---

## FASE 2 — Importación robusta y trazabilidad (operación real)

8. Tracking de cargas (trazabilidad) - Pendiente
   - Tabla "imports" con: id, id_proyecto, usuario, fecha_carga, versión, archivo_original, estado - Pendiente
   - Al importar CSV: registrar en tabla imports - Pendiente
   - UI: tabla de cargas por obra (mostrar quién cargó, cuándo, versión) - Pendiente
   - Posibilidad recargar/editar versión - Pendiente

9. Importación múltiple de CSV - Pendiente
   - Permitir subir varios CSV en una sola operación - Pendiente
   - Opción de importar ZIP con varios archivos - Pendiente

10. Validación de datos avanzada - Pendiente
    - Reporte de filas rechazadas - Pendiente
    - Normalización de formatos - Pendiente
    - Advertencias: datos incompletos, duplicados - Pendiente

11. Sistema de migraciones robusto - Pendiente
    - Mecanismo para actualizar esquema sin perder datos - Pendiente
    - Versionado de migraciones - Pendiente
    - Rollback de migraciones (si aplica) - Pendiente

---

## FASE 3 — Export para producción (reemplazo Excel)

12. Definir y documentar formato aSa Studio - Pendiente
    - Mapear columnas requeridas - Pendiente
    - Documentar unidades y estructura - Pendiente
    - Crear ejemplos/plantillas - Pendiente

13. Endpoint de export a EXCEL - Pendiente
    - POST /proyectos/{id}/exportar-excel - Pendiente
    - Generar archivo XLSX con formato aSa Studio - Pendiente
    - Incluir metadatos: proyecto, fecha, usuario, versión - Pendiente

14. UI para exportación - Pendiente
    - Tab "Exportación" con selector de obra - Pendiente
    - Vista previa de datos en tabla - Pendiente
    - Botón descargar EXCEL - Pendiente
    - Histórico de exportaciones - Pendiente

---

## FASE 4 — Funcionalidades avanzadas y multi-cliente

15. Sistema de pedidos (MVP) - Future
    - Tabla "pedidos": id, id_proyecto, usuario, fecha, estado, items - Pendiente
    - Tabla "pedido_items": id_barra, cantidad, notas - Pendiente
    - Endpoint POST /pedidos (crear solicitud de material) - Pendiente
    - Endpoint GET /pedidos?proyecto={id} (listar pedidos de obra) - Pendiente
    - UI Tab "Pedidos": formulario manual + tabla de items - Pendiente
    - Notificaciones (email/dashboard) cuando se crea pedido - Pendiente

16. Modelo de datos clientes - Future
    - Tabla "clientes": id, nombre, email, contacto - Pendiente
    - Relación: cliente → proyectos (1:N) - Pendiente
    - Actualizar permisos por cliente - Pendiente

17. Permisos por proyecto/cliente - Future
    - Usuarios asociados a proyectos - Pendiente
    - Restricción de acceso por cliente - Pendiente
    - Cubicador solo ve obras asignadas - Pendiente
    - Cliente solo ve su proyecto - Pendiente

18. Separación de UI en módulos - Future
    - Evaluar dividir ui.py en archivos separados (templates, JS, CSS) - Pendiente
    - Posible migración a frontend separado (React/Vue) - Pendiente
    - Separar estilos CSS en archivo estático - Pendiente

19. Auditoría y logs en panel Admin - Future
    - Registro de acciones (quién importó, quién borró, etc.) - Pendiente
    - Visualización de logs en tab Admin - Pendiente
    - Historial de resets - Pendiente

---

## FASE 5 — Preparación para Apps

20. API versionada - Pendiente
    - Estructura /api/v1 - Pendiente

21. CORS para aplicaciones externas - Pendiente
    - Permitir acceso desde futura web/app móvil - Pendiente

22. Observabilidad del sistema - Pendiente
    - Endpoint /health - Pendiente
    - Logs estructurados - Pendiente

23. Performance y optimización - Pendiente
    - Ajustar queries - Pendiente
    - Pool de conexiones - Pendiente

24. Bootstrap profesional - Pendiente
    - Permitir bootstrap solo en entorno dev - Pendiente
    - Bloquear bootstrap en producción - Pendiente