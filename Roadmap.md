Arquitectura actual y estado del proyecto

ArmaHub es una plataforma backend para gestión de datos de acero de refuerzo proveniente de Arma Detailer (Revit / GStarCAD). El sistema recibe archivos CSV exportados desde modelación, procesa la información de barras, calcula pesos de acero y permite visualizar estadísticas mediante un dashboard.

La arquitectura actual está compuesta por un backend desarrollado en Python con FastAPI, desplegado en Render, utilizando PostgreSQL como base de datos persistente. El backend expone una API REST protegida mediante autenticación JWT, que permite importar datos, consultarlos, filtrarlos y generar estadísticas.

El código fue recientemente refactorizado a una arquitectura modular basada en paquetes Python, separando responsabilidades en distintos módulos (auth, importer, barras, db, ui). Esto permite escalar el sistema de manera ordenada y facilita futuras integraciones con aplicaciones web o móviles.

Actualmente el sistema ya cuenta con:

Backend desplegado en la nube

Base de datos PostgreSQL persistente

Sistema de autenticación con usuarios y roles

Importación de CSV desde Arma Detailer

Cálculo automático de peso de acero

Dashboard básico con agrupaciones

Filtros de consulta

Interfaz web mínima para operación

Con esta base ya es posible demostrar el concepto internamente y comenzar a reemplazar procesos manuales basados en Excel. Las siguientes fases del desarrollo se enfocan en mejorar la usabilidad, robustecer la importación de datos, generar exportaciones para producción y preparar el sistema para futuras aplicaciones web y móviles.

ARMAHUB – PROGRAMA DE TRABAJO

FASE 1 — MVP usable (UX + operación)

1. Hardening de UI actual - Realizado
   - Mostrar usuario y rol siempre en la interfaz - OK
   - Mejorar mensajes de error y estados de carga - OK
   - Ajustes menores de UX - OK

2. Tabla de barras usable - Realizado
   - Paginación en endpoint /barras (limit / offset)
   - Orden por columnas (kilos, plano, ciclo, fecha, etc.)
   - Búsqueda rápida por id_unico, eje o plano_code

3. Filtros avanzados - No realizado
   - Filtros dependientes (proyecto → plano → ciclo → piso)
   - Persistencia de filtros en URL o localStorage

4. Dashboard mejorado - No realizado
   - Gráficos más claros (Top N + Otros)
   - Mostrar kilos y número de barras
   - Exportar datos del gráfico a CSV


FASE 2 — Importación robusta (operación real)

5. Importación múltiple de CSV - No realizado
   - Permitir subir varios CSV en una sola operación
   - Opción de importar ZIP con varios archivos

6. Control de duplicados y trazabilidad - No realizado
   - Crear tabla "imports"
   - Guardar quién cargó, cuándo, y archivo original
   - Opciones: reemplazar datos o sumar datos

7. Validación de datos - No realizado
   - Reporte de filas rechazadas
   - Normalización de formatos


FASE 3 — Export para producción (reemplazo Excel)

8. Definir formato aSa Studio - No realizado
   - Mapear columnas requeridas
   - Validar unidades y estructura

9. Endpoint de export - No realizado
   - Crear endpoint /export/asa
   - Permitir exportar según filtros

10. UI export - No realizado
   - Botón "Exportar a producción"
   - Vista previa de datos


FASE 4 — Multi-proyecto / clientes

11. Modelo de datos clientes y proyectos - No realizado
   - Tabla clientes
   - Tabla proyectos
   - Relación con barras

12. Permisos por proyecto - No realizado
   - Usuarios asociados a proyectos
   - Restricción de acceso por permisos

13. Bootstrap profesional - No realizado
   - Permitir bootstrap solo en entorno dev
   - Bloquear bootstrap en producción


FASE 5 — Preparación para Apps

14. API versionada - No realizado
   - Estructura /api/v1

15. CORS para aplicaciones externas - No realizado
   - Permitir acceso desde futura web/app móvil

16. Observabilidad del sistema - No realizado
   - Endpoint /health
   - Logs más claros

17. Performance y optimización - No realizado
   - Ajustar queries
   - Pool de conexiones


YA IMPKLE