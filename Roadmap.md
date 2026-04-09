# Roadmap Operativo - Abril 2026

Este roadmap reemplaza el documento historico anterior y parte desde el estado real verificado del repositorio. La intencion es ordenar el trabajo en dos lineas simultaneas:

- estabilizacion y refactor estructural
- entrega de features nuevas sobre una base modular

---

## Estado Base Confirmado

### Completado

- [x] Backend FastAPI con PostgreSQL y migraciones versionadas
- [x] Auth JWT y RBAC operativo
- [x] Hub con modulos de Cubicacion, Reclamos y Administracion
- [x] Importacion CSV ArmaDetailer con validaciones y trazabilidad
- [x] Dashboards de cubicacion, matriz constructiva y exportacion a aSa Studio
- [x] Gestion de obras, cargas, pedidos, calculistas y constructoras
- [x] Flujo principal de reclamos: registro, respuesta, validacion y presentaciones
- [x] Templates Jinja separados y assets estaticos

### Deuda tecnica confirmada

- [x] app.js sigue siendo monolitico y concentra demasiadas responsabilidades
- [x] Reclamos mantiene contratos y nomenclaturas mezcladas entre legacy y canonico
- [x] La documentacion tecnica estaba desalineada con el estado real del repo
- [x] El Hub todavia no esta formalizado como shell modular con registro de calugas

---

## Programa de Trabajo

### Fase A - Estabilizacion de Reclamos

Objetivo: dejar Reclamos como modulo confiable antes de extraerlo.

- [x] Identificar la causa de "respuesta invalida" en Presentaciones
- [x] Corregir deriva entre endpoint legacy y endpoint canonico de detalle
- [x] Normalizar contrato de imagenes y fechas en reclamos
- [x] Invalidar cache de reclamos al mutar datos
- [ ] Revisar humo funcional completo: listar, abrir, responder, validar, presentar, subir imagen

### Fase B - Nucleo compartido del frontend

Objetivo: sacar de app.js todo lo transversal antes de extraer modulos.

- [ ] Extraer cliente HTTP compartido
- [ ] Extraer auth y sesion
- [ ] Extraer helpers DOM
- [ ] Extraer formateadores de fecha y numeros
- [ ] Extraer modales, uploads e infraestructura de Chart.js
- [ ] Dejar app.js solo como bootstrap temporal

### Fase C - Shell del portal y registro de calugas

Objetivo: preparar ArmaHub para crecer como portal.

- [ ] Crear app/bootstrap.js
- [ ] Crear app/shell.js
- [ ] Crear app/registry.js
- [ ] Definir contrato de registro para modulos y calugas
- [ ] Mover el Hub a un modelo de modulos registrados por permisos
- [ ] Permitir nuevas calugas sin tocar logica interna de Cubicacion o Reclamos

### Fase D - Extraccion por modulos

Objetivo: separar negocio por features reales.

- [ ] Extraer Reclamos a features/reclamos/
- [ ] Extraer Portal a features/portal/
- [ ] Extraer Cubicacion por submodulos: inicio, obras, bar manager, dashboards, exportacion, pedidos
- [ ] Extraer Admin por features: usuarios, proyectos, constructoras, calculistas, auditoria
- [ ] Dejar legacy/compat.js para wrappers temporales

### Fase E - Limpieza backend por contratos

Objetivo: consolidar contratos y reducir drift.

- [ ] Unificar respuestas por dominio en reclamos
- [ ] Mover logica pesada a servicios y queries donde valga la pena
- [ ] Reducir rutas legacy con SQL propio
- [ ] Definir helpers compartidos de permisos y respuestas
- [ ] Preparar base para API versionada

---

## Backlog de Producto Confirmado

### Prioridad Alta

- [ ] Landing extensible con nuevas calugas y microflujos
- [ ] Rediseno de dashboards por rol
- [ ] Formalizar permisos por rol con un perfil supervisor o jefe
- [ ] Smoke tests minimos por modulo critico

### Prioridad Media

- [ ] API versionada bajo /api/v1
- [ ] CORS para integraciones externas futuras
- [ ] Observabilidad: logs estructurados y health util
- [ ] Mejoras de performance en queries sensibles y uso de cache

### Prioridad Condicionada a definicion

- [ ] Notificaciones de reclamos
- [ ] Automatismos de cambio de estado en validacion
- [ ] Nuevas apps no relacionadas a cubicacion dentro del portal
- [ ] Repositorio de archivos e imagenes separado si el modulo de calidad sigue creciendo

---

## Orden Recomendado de Ejecucion

1. Terminar estabilizacion de Reclamos.
2. Extraer shared/core del frontend.
3. Implementar shell del portal y registro de calugas.
4. Sacar Reclamos completo de app.js.
5. Extraer Cubicacion y Admin.
6. Recien despues abrir features nuevas sobre la nueva estructura.

---

## Criterio de Exito

El roadmap va bien si se cumplen estas condiciones:

- nuevas features dejan de entrar a app.js
- cada modulo tiene dueno tecnico claro
- las calugas del landing se agregan por registro y no por parche manual
- Reclamos deja de depender de rutas legacy inestables
- la documentacion vuelve a describir el sistema real
