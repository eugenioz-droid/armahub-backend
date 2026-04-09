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

- [ ] C.1 Extraer cliente HTTP compartido
- [ ] C.2 Extraer auth y sesion
- [ ] C.3 Extraer helpers DOM
- [ ] C.4 Extraer formateadores de fecha y numeros
- [ ] C.5 Extraer modales, uploads e infraestructura de Chart.js
- [ ] C.6 Dejar app.js solo como bootstrap temporal

### Fase D - Shell del portal y registro de calugas

Objetivo: preparar ArmaHub para crecer como portal.

- [ ] D.1 Crear app/bootstrap.js
- [ ] D.2 Crear app/shell.js
- [ ] D.3 Crear app/registry.js
- [ ] D.4 Definir contrato de registro para modulos y calugas
- [ ] D.5 Mover el Hub a un modelo de modulos registrados por permisos
- [ ] D.6 Permitir nuevas calugas sin tocar logica interna de Cubicacion o Reclamos

### Fase E - Extraccion por modulos

Objetivo: separar negocio por features reales.

- [ ] E.1 Extraer Reclamos a features/reclamos/
- [ ] E.2 Mantener images.js con separacion explicita entre ImagenesRegistro y ImagenesAnalisis
- [ ] E.3 Extraer Portal a features/portal/
- [ ] E.4 Extraer Cubicacion por submodulos: inicio, obras, bar manager, dashboards, exportacion, pedidos
- [ ] E.5 Extraer Admin por features: usuarios, proyectos, constructoras, calculistas, auditoria
- [ ] E.6 Dejar legacy/compat.js para wrappers temporales

### Fase F - Limpieza backend por contratos

Objetivo: consolidar contratos y reducir drift.

- [ ] F.1 Unificar respuestas por dominio en reclamos
- [ ] F.2 Mover logica pesada a servicios y queries donde valga la pena
- [ ] F.3 Reducir rutas legacy con SQL propio
- [ ] F.4 Definir helpers compartidos de permisos y respuestas
- [ ] F.5 Preparar base para API versionada

---

## Backlog de Producto Confirmado

### Prioridad Alta

- [ ] PA.1 Landing extensible con nuevas calugas y microflujos
- [ ] PA.2 Rediseno de dashboards por rol
- [ ] PA.3 Formalizar permisos por rol con un perfil supervisor o jefe
- [ ] PA.4 Smoke tests minimos por modulo critico

### Prioridad Media

- [ ] PM.1 API versionada bajo /api/v1
- [ ] PM.2 CORS para integraciones externas futuras
- [ ] PM.3 Observabilidad: logs estructurados y health util
- [ ] PM.4 Mejoras de performance en queries sensibles y uso de cache

### Prioridad Condicionada a definicion

- [ ] PC.1 Notificaciones de reclamos
- [ ] PC.2 Automatismos de cambio de estado en validacion
- [ ] PC.3 Nuevas apps no relacionadas a cubicacion dentro del portal
- [ ] PC.4 Repositorio de archivos e imagenes separado si el modulo de calidad sigue creciendo

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
