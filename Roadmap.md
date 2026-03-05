Arquitectura actual y estado del proyecto

ArmaHub es una plataforma backend para gestión de datos de acero de refuerzo proveniente de Arma Detailer (Revit / GStarCAD). El sistema recibe archivos CSV exportados desde modelación, procesa la información de barras, calcula pesos de acero y permite visualizar estadísticas mediante un dashboard.

La arquitectura actual está compuesta por un backend desarrollado en Python con FastAPI, desplegado en Render, utilizando PostgreSQL como base de datos persistente. El backend expone una API REST protegida mediante autenticación JWT, que permite importar datos, consultarlos, filtrarlos y generar estadísticas.

El código fue recientemente refactorizado a una arquitectura modular basada en paquetes Python, separando responsabilidades en distintos módulos (auth, importer, barras, db, ui). Esto permite escalar el sistema de manera ordenada y facilita futuras integraciones con aplicaciones web o móviles.

Actualmente el sistema ya cuenta con:

- Backend desplegado en la nube
- Base de datos PostgreSQL persistente
- Sistema de autenticación con usuarios y roles
- Importación de CSV desde Arma Detailer
- Cálculo automático de peso de acero
- Dashboard básico con agrupaciones
- Filtros de consulta
- Interfaz web mínima para operación

Con esta base ya es posible demostrar el concepto internamente y comenzar a reemplazar procesos manuales basados en Excel. Las siguientes fases del desarrollo se enfocan en mejorar la usabilidad, robustecer la importación de datos, generar exportaciones para producción y preparar el sistema para futuras aplicaciones web y móviles.

---

## ESTADO ACTUAL (5 Marzo 2026)

**Fase 0 — Preparación de datos**: ✅ COMPLETADA
- Extracción de nombres de proyectos desde CSV (PROYECTO: PROY-XXX|Nombre)
- Tabla proyectos + endpoints GET /proyectos y GET /proyectos/{id}/sectores

**Fase 1.1 — Hardening UI**: ✅ COMPLETADA
- Autenticación JWT, badges de usuario/rol, manejo de errores

**Fase 1.2 — Tabla de barras**: ✅ COMPLETADA
- Paginación, ordenamiento por columnas, búsqueda rápida

**Fase 1.3 — Rediseño UX con estructura de tabs**: ✅ COMPLETADA (5 Marzo 2026)
- 5 tabs funcionales: Mis Obras, Búsqueda, Dashboards, Pedidos (placeholder), Exportación (placeholder)
- Colores Armacero implementados
- Integración con endpoints existentes

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
   - Admin: puede ver y editar todo
   - Cubicador/Operador: administra sus obras (carga, edita, elimina)
   - Cliente (futuro): solo ve su proyecto en modo lectura

## PALETA DE COLORES

Basada en identidad visual ArmaCero:
- **Verde principal**: #8BC34A (lime/chartreuse)
- **Gris oscuro**: #2C2C2C (textos, bordes)
- **Gris claro**: #F5F5F5 (fondos)
- **Blanco**: #FFFFFF
- **Acentos**: Verde oscuro #558B2F para hover/active

## ESTRUCTURA DE NAVEGACIÓN Y SECCIONES

El sistema tendrá **pestañas/sidebar** con acceso diferenciado por rol:

### **ROL: CUBICADOR / OPERADOR**
- **Tab 1: Mis Obras** (Administración)
  - Resumen de proyectos cargados (tarjetas con kilos, barras, sector)
  - Resumen de cargas: quién cargó, cuándo, versión del archivo (tabla editable)
  - Botones: Recargar archivo | Editar carga | Eliminar | Generar EXCEL
  - Formulario para cargar nuevo CSV
  
- **Tab 2: Búsqueda de Barras** (Detalle)
  - Filtros (Proyecto, Plano, Sector, Piso, Ciclo)
  - Tabla pageable con ordenamiento
  - Búsqueda rápida

- **Tab 3: Dashboards** (Generales)
  - Resumen global kilos por sector
  - Top 5 proyectos por peso
  - Gráficos de distribución
  
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

### **ROL: ADMIN**
- Ver todo igual que cubicador
- Plus: Gestionar usuarios, limpiar datos, auditoría

---

ARMAHUB – PROGRAMA DE TRABAJO

## FASE 0 — Preparación de datos

0. Extracción de nombres de proyectos desde CSV - OK
   - Tabla proyectos con mapeo id_proyecto → nombre_proyecto - OK
   - Importer parsea "PROYECTO: PROY-XXX|Nombre" desde línea 2 - OK
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

3. Rediseño UX/visual completo - OK (estructura de tabs implementada)
   a) Layout general con sidebar/tabs de navegación - OK ✅
      - 5 tabs: Mis Obras, Búsqueda, Dashboards, Pedidos, Exportación - OK
      - Header con user info y rol badge - OK
      - Tab switching con estado persistente en click - OK
   b) CSS profesional (colores tomados de armacero.cl, espacios, responsivo) - OK (base)
      - Colores: #8BC34A verde, #2C2C2C gris, #FFFFFF blanco - OK
      - Espacios y layouts mejorados - OK
      - Responsive (mobile-friendly) - OK (básico)
   c) **Tab "Mis Obras"** (para cubicador) - OK (funcional)
      - Tarjetas de proyectos con resumen kilos/barras - OK
      - Importer CSV integrado - OK
      - Tabla de cargas (placeholder para historia futura) - OK
   d) **Tab "Búsqueda de Barras"** - OK (funcional)
      - Filtros por proyecto, plano, sector, piso, ciclo - OK
      - Tabla pageable con ordenamiento por click - OK
      - Búsqueda rápida por ID/Eje/Plano - OK
      - Paginación anterior/siguiente - OK
   e) **Tab "Dashboards"** - OK (funcional)
      - Selector de dimensión: sector, piso, ciclo, plano, proyecto - OK
      - Gráficos Chart.js por dimensión - OK
      - Resúmenes de totales (kilos, barras) - OK
   f) **Tab "Pedidos"** (Future MVP, UI skeleton) - OK (placeholder)
   g) **Tab "Exportación"** (Future, con placeholder) - OK (placeholder)

4. Backend para nuevas funcionalidades - Parcialmente hecho
   - Endpoint GET /proyectos (lista obras con totales) - OK ✅
   - Endpoint GET /proyectos/{id}/sectores (desglose por sector) - OK ✅
   - Endpoint DELETE /proyectos/{id} (eliminar obra con cascada) - Pendiente
   - Tabla "imports" (tracking de cargas: usuario, fecha, version, archivo) - Pendiente
   - Endpoint POST /cargas (registrar nueva carga) - Pendiente
   - Endpoint GET /cargas?proyecto={id} (listar cargas de una obra) - Pendiente
   - Endpoint PATCH /cargas/{id} (editar metadatos de carga) - Pendiente
   - Endpoint DELETE /cargas/{id} (eliminar carga) - Pendiente
   - Endpoint GET /proyectos/{id}/exportar-excel (generar EXCEL formato aSa) - Pendiente (esperar definición formato)

5. Filtros avanzados - No realizado
   - Filtros dependientes (proyecto → plano → ciclo → piso) - Pendiente
   - Persistencia de filtros en URL o localStorage - Pendiente

---

## FASE 2 — Importación robusta y trazabilidad (operación real)

6. Tracking de cargas (trazabilidad) - En progreso
   - Tabla "imports" con: id, id_proyecto, usuario, fecha_carga, versión, archivo_original, estado - Pendiente
   - Al importar CSV: registrar en tabla imports - Pendiente
   - UI: tabla de cargas por obra (mostrar quién cargó, cuándo, versión) - Pendiente
   - Posibilidad recargar/editar versión - Pendiente

7. Importación múltiple de CSV - No realizado
   - Permitir subir varios CSV en una sola operación - Pendiente
   - Opción de importar ZIP con varios archivos - Pendiente

8. Validación de datos avanzada - No realizado
   - Reporte de filas rechazadas - Pendiente
   - Normalización de formatos - Pendiente
   - Advertencias: datos incompletos, duplicados - Pendiente

---

## FASE 3 — Export para producción (reemplazo Excel)

9. Definir y documentar formato aSa Studio - Pendiente
   - Mapear columnas requeridas - Pendiente
   - Documentar unidades y estructura - Pendiente
   - Crear ejemplos/plantillas - Pendiente

10. Endpoint de export a EXCEL - Pendiente
    - POST /proyectos/{id}/exportar-excel - Pendiente
    - Generar archivo XLSX con formato aSa Studio - Pendiente
    - Incluir metadatos: proyecto, fecha, usuario, versión - Pendiente

11. UI para exportación - Pendiente
    - Tab "Exportación" con selector de obra - Pendiente
    - Vista previa de datos en tabla - Pendiente
    - Botón descargar EXCEL - Pendiente
    - Histórico de exportaciones - Pendiente

---

## FASE 4 — Funcionalidades avanzadas y multi-cliente

12. Sistema de pedidos (MVP) - Future
    - Tabla "pedidos": id, id_proyecto, usuario, fecha, estado, items - Pendiente
    - Tabla "pedido_items": id_barra, cantidad, notas - Pendiente
    - Endpoint POST /pedidos (crear solicitud de material) - Pendiente
    - Endpoint GET /pedidos?proyecto={id} (listar pedidos de obra) - Pendiente
    - UI Tab "Pedidos": formulario manual + tabla de items - Pendiente
    - Notificaciones (email/dashboard) cuando se crea pedido - Pendiente (Future)

13. Modelo de datos clientes - Future
    - Tabla "clientes": id, nombre, email, contacto - Pendiente
    - Relación: cliente → proyectos (1:N) - Pendiente
    - Actualizar permisos por cliente - Pendiente

14. Permisos por proyecto/cliente - Future
    - Usuarios asociados a proyectos - Pendiente
    - Restricción de acceso por cliente - Pendiente
    - Cubicador solo ve obras asignadas - Pendiente
    - Cliente solo ve su proyecto - Pendiente

15. Bootstrap profesional - No realizado
    - Permitir bootstrap solo en entorno dev - Pendiente
    - Bloquear bootstrap en producción - Pendiente

---

## FASE 5 — Preparación para Apps

14. API versionada - No realizado
    - Estructura /api/v1 - Pendiente

15. CORS para aplicaciones externas - No realizado
    - Permitir acceso desde futura web/app móvil - Pendiente

16. Observabilidad del sistema - No realizado
    - Endpoint /health - Pendiente
    - Logs más claros - Pendiente

17. Performance y optimización - No realizado
    - Ajustar queries - Pendiente
    - Pool de conexiones - Pendiente