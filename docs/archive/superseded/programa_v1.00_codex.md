# Programa de Trabajo - ArmaHub [SUPERSEDED]

> **SUPERSEDED (2026-06-08):** Esta es la versión inicial de CODEX. Fue reemplazada por el
> programa reordenado vigente en `docs/programa-versiones/programa_v1.00.md`, tras la auditoría
> de AuditorArmaHub. Motivos del reemplazo: estado de partida desactualizado (planificaba como
> si el sistema estuviera en cero, ignorando trabajo ya hecho), infraestructura mal ubicada en
> el orden, calugas de obra sin definir públicos, y pendientes reales sin arrastrar. Se conserva
> por trazabilidad. NO usar como programa activo.

**Plataforma operacional y documental para obras, cubicaciones, calidad, CRM, procedimientos, capacitacion y terreno.**

**Objetivo v1.00:** transformar ArmaHub desde el portal actual de cubicacion/reclamos hacia una plataforma modular, estable y escalable, avanzando por calugas completas y evitando picotear tareas sueltas.

**Stack actual:** FastAPI | PostgreSQL | Jinja templates | JavaScript modular | Auth JWT/RBAC

**Stack objetivo base:** Web + API modular + PostgreSQL + storage documental + workers/colas + mailing + auditoria + IA opcional.

---

## 0. Decisiones rectoras

### 0.1 Calugas objetivo

| # | Caluga / componente | Proposito |
|---|---------------------|-----------|
| 1 | Administrador de Obra | Expediente vivo de cada obra: programa, documentos, planos/versiones, RDI, aprobaciones, certificados, protocolos y reportes. |
| 2 | Cubicaciones | Continuidad y evolucion del modulo actual: cargas CSV, barras, pedidos, exportacion, trazabilidad y conexion con obra. |
| 3 | Calidad / Reclamos | Reclamos, no conformidades, acciones correctivas, certificados, reportes, PDF/envio y multi-origen. |
| 4 | CRM + Inteligencia Comercial | Clientes, contactos, leads, oportunidades, seguimientos, correos e informacion comercial. |
| 5 | Procedimientos y Capacitacion | Biblioteca, versiones, cursos, evaluaciones, matriz cargo/procedimiento y cumplimiento. |
| 6 | Administracion del Sistema | Usuarios, roles, permisos, parametros, plantillas, auditoria, automatizaciones e integraciones. |
| + | App Terreno | Cliente movil/API: checklist, fotos, observaciones, firma y protocolos PDF. No es caluga web inicial. |

### 0.2 Estrategia de implementacion

- Implementar caluga por caluga.
- Cada caluga debe cerrar un flujo usable antes de abrir la siguiente.
- Cada caluga pasa por: discovery corto -> modelo de datos -> backend -> UI -> permisos -> auditoria -> smoke test -> documentacion.
- No crear modulos duplicados para el mismo proceso.
- No crear un modulo USC/despacho inicial; consumir informacion desde SAP/software externo o integracion futura.
- Calidad controla certificados; Administrador de Obra los disponibiliza.

### 0.3 Decision inicial de backend

Decision propuesta para v1.00:

**Mantener un backend FastAPI modular unico** y separar solo componentes asincronos o pesados como workers.

Diagnostico actual:

- El backend actual es **parcialmente modular**: existen archivos/routers por dominio (`reclamos.py`, `barras.py`, `importer.py`, `admin.py`, etc.).
- Todavia no es modular en sentido fuerte: algunos dominios concentran demasiada logica, SQL, permisos, normalizacion y efectos secundarios en archivos grandes.
- La modularidad real debe avanzar hacia routers delgados, servicios por dominio, queries aisladas, schemas/contratos claros, permisos centralizados y tests por flujo.
- Por eso la Fase 2 debe auditar codigo antes de sumar calugas grandes.

Motivo:

- El sistema comparte usuarios, permisos, obras, documentos y auditoria.
- Separar backends antes de tener fronteras maduras aumentaria costo operativo.
- FastAPI ya permite routers por dominio y contratos OpenAPI.
- Workers/colas permiten separar carga pesada sin duplicar autenticacion ni modelo central.

Arquitectura objetivo:

```text
Browser / App Terreno
        |
        v
Cloudflare Worker / Proxy / WAF
        |
        v
FastAPI modular unico
        |
        +-- PostgreSQL externo
        +-- Storage documental (R2 u otro S3 compatible)
        +-- Cola / workers asincronos
        +-- Servicio de correo
        +-- Integraciones futuras (SAP, IA, CAD preview)
```

### 0.4 Criterios para separar un backend o servicio

Separar un backend/servicio solo si cumple al menos una condicion fuerte:

| Condicion | Ejemplo | Decision esperada |
|-----------|---------|-------------------|
| Escala distinta | Procesamiento masivo de PDFs, previews CAD, scraping pesado | Worker o servicio asincrono |
| Dependencias incompatibles | Libreria pesada, binarios, runtime especial | Container/worker separado |
| Disponibilidad distinta | App Terreno necesita API liviana aun si reportes caen | Router/API estable, no necesariamente otro backend |
| Seguridad distinta | Integracion SAP o correo con credenciales sensibles | Servicio acotado o worker con secretos propios |
| Costo distinto | Tarea ocasional consume CPU/memoria alta | Job bajo demanda |
| Equipo/despliegue independiente | Otro equipo mantiene una app o integracion | Servicio separado documentado |

Lo que NO justifica otro backend:

- Una caluga nueva con datos compartidos.
- Un CRUD nuevo.
- Un nuevo tab dentro de una caluga.
- Diferencias menores de permisos.
- Preferencias de orden visual.

### 0.5 Cloudflare como infraestructura objetivo

Hipotesis de trabajo:

- No portar ArmaHub a Python Workers puro en primera instancia.
- Usar **Cloudflare Containers** para mantener FastAPI y dependencias actuales.
- Usar **PostgreSQL externo** para la base de datos.
- Usar **R2** para documentos, imagenes, certificados, PDFs y adjuntos.
- Evaluar **Queues** para trabajos asincronos: emails, previews, reportes, IA, imports pesados.

Razon tecnica:

- Cloudflare Python Workers soporta FastAPI, pero los paquetes deben ser pure Python o estar soportados en Pyodide; ArmaHub usa dependencias con riesgo de compatibilidad como `psycopg[binary]`, `pandas`, `openpyxl` y PDF/upload.
- Containers permite ejecutar una app existente con Docker y filesystem Linux.

Referencias oficiales revisadas:

- Cloudflare Containers: https://developers.cloudflare.com/containers/
- Cloudflare Containers pricing: https://developers.cloudflare.com/containers/pricing/
- Cloudflare Python Workers FastAPI: https://developers.cloudflare.com/workers/languages/python/packages/fastapi/
- Cloudflare Python packages: https://developers.cloudflare.com/workers/languages/python/packages/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Queues: https://developers.cloudflare.com/queues/

---

## Estado de la version v1.00

### Pendientes activos prioritarios

1. Fase 1 - Cerrar alineamiento documental con el documento base Word.
2. Fase 2 - Auditar calidad del codigo actual antes de cambios grandes.
3. Fase 3 - Migrar/desplegar el sistema actual en Cloudflare como baseline paralelo.
4. Fase 4 - Definir arquitectura base y fronteras de modulos.
5. Fase 5 - Fortalecer Administracion del Sistema para soportar las calugas.
6. Fase 6 - Pulir y ampliar Calidad/Reclamos antes de abrir calugas grandes nuevas.
7. Fase 7 - Consolidar Cubicaciones y conectarla mejor con Calidad/obra.
8. Fase 8 - Implementar Administrador de Obra cuando la base ya este saneada.

### Principio de avance

No se abre una caluga nueva hasta que la anterior tenga:

- Modelo de datos minimo.
- Endpoints principales.
- UI navegable.
- Permisos basicos.
- Auditoria de acciones criticas.
- Smoke test manual documentado.
- Tareas pendientes explicitamente arrastradas.

---

## Fase 1: Alineamiento documental y programa maestro

Objetivo: dejar un unico programa operativo a partir del protocolo REP, roadmaps previos y documento base Word.

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 1.1 | Crear protocolo especifico de ArmaHub | ☑ | YO |
| 1.2 | Crear carpeta `docs/programa-versiones/` | ☑ | YO |
| 1.3 | Crear programa vigente `programa_v1.00.md` | ☑ | YO |
| 1.4 | Integrar `Roadmap.md` como fuente historica | ☑ | YO |
| 1.5 | Integrar `ROADMAP_RECLAMOS.md` como fuente de producto | ☑ | YO |
| 1.6 | Leer `Armahub_Documento_Base_Desarrollo_v0_1.docx` como fuente de producto | ☑ | YO |
| 1.7 | Transformar el programa a ruta por calugas completas | ☑ | YO |
| 1.8 | Revisar `refactor-analysis.md` y extraer decisiones vigentes | ☐ | YO |
| 1.9 | Revisar `diseno_repositorios_imagenes.md` y consolidar decision en storage documental | ☐ | YO |
| 1.10 | Definir carpeta final para documentos historicos/superseded | ☐ | TU+YO |
| 1.11 | Pedir auditoria de OPUS sobre este programa antes de implementar producto | ☐ | TU |

---

## Fase 2: Auditoria de calidad del codigo actual

Objetivo: entender el estado real antes de construir encima. Esta fase no busca refactorizar todo; busca identificar riesgos, limpiar lo imprescindible y dejar criterios de calidad.

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 2.1 | Revisar estructura backend: routers, dependencias, init DB, migraciones y legacy | ☐ | YO |
| 2.2 | Revisar estructura frontend: shell, registry, shared, features y compat legacy | ☐ | YO |
| 2.3 | Detectar archivos grandes, duplicados, codigo muerto y responsabilidades mezcladas | ☐ | YO |
| 2.4 | Revisar endpoints legacy y decidir mantener, adaptar o retirar | ☐ | YO |
| 2.5 | Revisar seguridad backend: auth, roles, ownership, campos editables y endpoints publicos | ☐ | YO |
| 2.6 | Revisar consistencia entre `ROLES_Y_PERMISOS.md`, frontend y backend | ☐ | YO |
| 2.7 | Revisar `MODELO_DE_DATOS.md` contra schema/migraciones reales | ☐ | YO |
| 2.8 | Ejecutar smoke test funcional de Reclamos | ☐ | TU+YO |
| 2.9 | Ejecutar smoke test funcional de Cubicaciones | ☐ | TU+YO |
| 2.10 | Ejecutar smoke test funcional de Admin | ☐ | TU+YO |
| 2.11 | Crear lista de riesgos bloqueantes antes de Cloudflare | ☐ | YO |
| 2.12 | Crear backlog tecnico minimo para no arrastrar deuda peligrosa | ☐ | YO |

Criterio de salida:

- Tenemos un mapa de riesgos.
- Sabemos que se puede desplegar el estado actual.
- Sabemos que partes no deben tocarse sin pruebas.

---

## Fase 3: Migracion baseline a Cloudflare

Objetivo: mover o replicar lo actual a Cloudflare antes de construir la nueva plataforma, para no migrar al final con demasiadas piezas nuevas.

Decision inicial:

- Probar Cloudflare Containers + PostgreSQL externo + R2.
- Mantener Render activo como baseline hasta validar Cloudflare.
- No cortar produccion hasta pasar smoke tests.

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 3.1 | Confirmar plan/costo actual de Render y base PostgreSQL actual | ☐ | TU |
| 3.2 | Confirmar cuenta Cloudflare, Workers Paid y restricciones de red corporativa | ☐ | TU |
| 3.3 | Decidir PostgreSQL externo para Cloudflare: Render Postgres, Supabase, Neon u otro | ☐ | TU+YO |
| 3.4 | Crear `Dockerfile` para FastAPI actual | ☐ | YO |
| 3.5 | Crear `.dockerignore` y ajustar arranque `uvicorn armahub.main:app` | ☐ | YO |
| 3.6 | Crear Worker proxy y `wrangler.toml` para Containers | ☐ | YO |
| 3.7 | Configurar secrets/env vars: `DATABASE_URL`, `JWT_SECRET`, CORS, SMTP futuro, R2 futuro | ☐ | TU+YO |
| 3.8 | Validar build local del container | ☐ | YO |
| 3.9 | Desplegar Cloudflare en URL paralela | ☐ | TU+YO |
| 3.10 | Verificar `/health`, login, static files y navegacion shell | ☐ | TU+YO |
| 3.11 | Probar importacion CSV en Cloudflare | ☐ | TU+YO |
| 3.12 | Probar Reclamos, imagenes actuales y PDF en Cloudflare | ☐ | TU+YO |
| 3.13 | Medir cold start, latencia, errores y logs | ☐ | YO |
| 3.14 | Documentar costos estimados y riesgos Cloudflare vs Render | ☐ | YO |
| 3.15 | Decidir cutover, mantener paralelo o postergar migracion | ☐ | TU+YO |

Criterio de salida:

- ArmaHub actual corre en Cloudflare paralelo o se documenta por que no conviene aun.
- No se avanza a calugas nuevas sin una decision clara de infraestructura.

---

## Fase 4: Arquitectura base de plataforma

Objetivo: preparar la base para crecer sin volver inmanejable el portal.

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 4.1 | Definir mapa final de routers backend por dominio | ☐ | YO |
| 4.2 | Definir convencion frontend para calugas, tabs y subfeatures | ☐ | YO |
| 4.3 | Definir contrato comun de auditoria: usuario, fecha, entidad, accion, estado anterior/nuevo | ☐ | YO |
| 4.4 | Definir modelo comun de documentos/adjuntos versionados | ☐ | YO |
| 4.5 | Definir estrategia storage: DB solo metadata, R2/storage para archivos | ☐ | YO |
| 4.6 | Definir convencion de estados por entidad: obra, documento, plano, certificado, reclamo | ☐ | TU+YO |
| 4.7 | Definir criterio de permisos por rol, cliente, obra y accion | ☐ | TU+YO |
| 4.8 | Crear matriz de roles objetivo v2 | ☐ | YO |
| 4.9 | Definir estrategia de workers/colas: emails, PDF, previews, IA, reportes | ☐ | YO |
| 4.10 | Decidir si se necesita `user_permissions` granular o basta RBAC + ownership por obra | ☐ | TU+YO |
| 4.11 | Actualizar `armahub-protocolo.md` con decisiones de arquitectura | ☐ | YO |
| 4.12 | Actualizar `MODELO_DE_DATOS.md` con modelo objetivo resumido | ☐ | YO |

Criterio de salida:

- Antes de crear calugas nuevas, sabemos donde viven datos, archivos, permisos y auditoria.

---

## Fase 5: Caluga Administracion del Sistema

Objetivo: reforzar la base administrativa antes de dar acceso a clientes, obras, CRM, calidad ampliada y terreno.

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 5.1 | Revisar modulo Admin actual y separar tabs reales si corresponde | ☐ | YO |
| 5.2 | Consolidar gestion de usuarios y roles | ☐ | YO |
| 5.3 | Definir permisos por caluga, tab, obra y accion | ☐ | TU+YO |
| 5.4 | Implementar vista de matriz de permisos objetivo | ☐ | YO |
| 5.5 | Crear/ajustar auditoria global de acciones criticas | ☐ | YO |
| 5.6 | Crear gestion de parametros del sistema | ☐ | YO |
| 5.7 | Crear base para plantillas: certificados, correos, reportes, procedimientos | ☐ | YO |
| 5.8 | Crear health/admin tecnico para DB, storage, correo y workers | ☐ | YO |
| 5.9 | Validar permisos admin/admin2/admin_reclamos/cliente/cubicador/usc | ☐ | TU+YO |

Criterio de salida:

- Podemos administrar usuarios, permisos, parametros y auditoria sin tocar codigo por cada ajuste menor.

---

## Fase 6: Caluga Calidad / Reclamos

Objetivo: evolucionar Reclamos hacia calidad completa sin romper el flujo existente.

Motivo del orden:

- Es el modulo actual con mas valor operativo inmediato.
- Ya existe codigo y usuarios/flujo base.
- Conviene endurecerlo antes de construir Administrador de Obra, porque Calidad definira certificados, adjuntos, trazabilidad y permisos que Obra consumira despues.

### 6A. Hardening previo

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 6.1 | Revisar estructura actual de `reclamos.py` y separar riesgos de modularidad | ☐ | YO |
| 6.2 | Validar ownership en acciones correctivas | ☐ | YO |
| 6.3 | Validar ownership al eliminar imagenes | ☐ | YO |
| 6.4 | Decidir restriccion de `numero_calidad` por rol | ☐ | TU+YO |
| 6.5 | Revisar acceso publico a imagenes y documentar decision | ☐ | TU+YO |
| 6.6 | Validar QA visual del PDF de reclamo | ☐ | TU+YO |
| 6.7 | Actualizar `ROLES_Y_PERMISOS.md` con decisiones de Calidad/Reclamos | ☐ | YO |

### 6B. Informe y correo

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 6.8 | Configurar SMTP o servicio de correo | ☐ | TU+YO |
| 6.9 | Crear helper reutilizable de envio de correo | ☐ | YO |
| 6.10 | Crear tabla `reclamo_envios` | ☐ | YO |
| 6.11 | Crear endpoint de envio de informe PDF | ☐ | YO |
| 6.12 | Crear historial de envios en detalle de reclamo | ☐ | YO |
| 6.13 | Agregar indicadores de envio en dashboard de Calidad | ☐ | YO |

### 6C. Calidad ampliada

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 6.14 | Definir tipos: reclamo, no conformidad, observacion, accion preventiva | ☐ | TU+YO |
| 6.15 | Definir multi-origen: cubicacion, retail, planta u otros | ☐ | TU+YO |
| 6.16 | Crear tabla `clientes` para casos no ligados a obra | ☐ | YO |
| 6.17 | Agregar `id_cliente`, `origen` y `area` en reclamos/calidad | ☐ | YO |
| 6.18 | Crear rol `admin_reclamos` si sigue vigente | ☐ | YO |
| 6.19 | Crear UI Admin de clientes | ☐ | YO |
| 6.20 | Ajustar formulario para elegir origen y obra/cliente segun corresponda | ☐ | YO |
| 6.21 | Ajustar listado, detalle y dashboards por origen | ☐ | YO |
| 6.22 | Definir certificados controlados por Calidad y visibles en Obra | ☐ | TU+YO |
| 6.23 | Smoke test: reclamo de obra -> analisis -> acciones -> validacion -> PDF -> envio -> certificado visible | ☐ | TU+YO |

Criterio de salida:

- Reclamos queda endurecido y preparado como modulo de Calidad multi-origen.

---

## Fase 7: Caluga Cubicaciones

Objetivo: mantener lo existente, conectarlo con Calidad y preparar la futura conexion con Administrador de Obra.

Motivo del orden:

- Cubicaciones ya existe y debe seguir estable.
- Debe adaptarse a los contratos de obra/calidad antes de que el expediente de obra sea grande.
- Permite ordenar cargas, pedidos, planos y exportaciones con menor riesgo que abrir toda la caluga de Obra.

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 7.1 | Revisar estructura actual de `barras.py`, `importer.py` y frontend de Cubicaciones | ☐ | YO |
| 7.2 | Revisar flujo actual de importacion CSV contra futura ficha de obra | ☐ | YO |
| 7.3 | Definir relacion entre pedidos, cargas, planos y reclamos/calidad | ☐ | TU+YO |
| 7.4 | Ajustar selector de obra como fuente unica de destino | ☐ | YO |
| 7.5 | Mantener reimportacion CSV sin barras huerfanas | ☐ | YO |
| 7.6 | Integrar Bar Manager con trazabilidad de plano/version futura | ☐ | YO |
| 7.7 | Integrar pedidos especificos con obra/programa futuro | ☐ | YO |
| 7.8 | Agregar trazabilidad entre carga, plano, pedido, reclamo y exportacion | ☐ | YO |
| 7.9 | Revisar permisos de cubicador, cliente y admin por obra | ☐ | YO |
| 7.10 | Smoke test: obra existente -> carga CSV -> Bar Manager -> pedido -> exportacion -> reclamo asociado | ☐ | TU+YO |

Criterio de salida:

- Cubicaciones queda estable, auditable y lista para integrarse al expediente de obra.

---

## Fase 8: Caluga Administrador de Obra

Objetivo: construir la caluga central del sistema cuando Admin, Calidad y Cubicaciones ya tengan contratos mas firmes.

Motivo para no hacerla antes:

- Requiere decisiones de documentos, permisos, estados, certificados, planos, clientes y trazabilidad.
- Si se implementa antes de pulir Reclamos/Cubicaciones, puede forzar retrabajo.
- Conviene llegar con componentes reutilizables ya saneados: permisos, storage, auditoria, certificados y cargas.

### 8A. Discovery y modelo

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 8.1 | Definir ficha de obra objetivo: cliente, constructora, responsables, estados, fechas y metadata | ☐ | TU+YO |
| 8.2 | Definir estados de obra y semaforos | ☐ | TU+YO |
| 8.3 | Definir programa de obra: hitos, fechas, responsables y relacion con pedidos/cubicaciones | ☐ | TU+YO |
| 8.4 | Definir estructura documental por obra | ☐ | TU+YO |
| 8.5 | Definir nomenclatura de planos, versiones, aprobaciones y obsoletos | ☐ | TU+YO |
| 8.6 | Definir RDI/aprobaciones: campos, estados, adjuntos y responsables | ☐ | TU+YO |

### 8B. Backend y datos

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 8.7 | Crear/ajustar tablas de obra para metadata extendida | ☐ | YO |
| 8.8 | Crear tabla de hitos/programa de obra | ☐ | YO |
| 8.9 | Crear tabla de documentos de obra con versionado | ☐ | YO |
| 8.10 | Crear tabla de planos/versiones | ☐ | YO |
| 8.11 | Crear tabla de RDI/aprobaciones | ☐ | YO |
| 8.12 | Crear endpoints de resumen de obra | ☐ | YO |
| 8.13 | Crear endpoints CRUD de documentos/planos/RDI | ☐ | YO |
| 8.14 | Integrar storage documental con metadata en PostgreSQL | ☐ | YO |

### 8C. Frontend

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 8.15 | Crear caluga Administrador de Obra en registry | ☐ | YO |
| 8.16 | Crear tab Resumen de obra | ☐ | YO |
| 8.17 | Crear tab Programa / hitos | ☐ | YO |
| 8.18 | Crear tab Documentos | ☐ | YO |
| 8.19 | Crear tab Planos y versiones | ☐ | YO |
| 8.20 | Crear tab RDI / aprobaciones | ☐ | YO |
| 8.21 | Mostrar certificados controlados por Calidad cuando existan | ☐ | YO |
| 8.22 | Crear permisos cliente: solo obras y documentos autorizados | ☐ | YO |
| 8.23 | Smoke test: crear obra -> subir doc -> versionar plano -> crear RDI -> ver como cliente | ☐ | TU+YO |

Criterio de salida:

- Una obra puede administrarse documentalmente desde una caluga central.
- Cliente ve solo lo autorizado.
- Cubicacion y Calidad quedan enlazadas a la obra.

---

## Fase 9: Caluga CRM + Inteligencia Comercial

Objetivo: consolidar clientes, contactos y oportunidades sin duplicar constructoras/clientes actuales.

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 9.1 | Definir diferencia entre cliente, constructora, contacto, empresa y obra | ☐ | TU+YO |
| 9.2 | Revisar tabla `constructoras` y decidir migracion a modelo CRM | ☐ | YO |
| 9.3 | Crear modelo de cuentas/clientes y contactos | ☐ | YO |
| 9.4 | Crear modelo de leads/oportunidades | ☐ | YO |
| 9.5 | Crear seguimiento comercial | ☐ | YO |
| 9.6 | Crear caluga CRM en registry | ☐ | YO |
| 9.7 | Crear tabs Clientes, Contactos, Oportunidades, Seguimientos | ☐ | YO |
| 9.8 | Definir permisos comerciales por rol | ☐ | TU+YO |
| 9.9 | Definir estrategia de correo: envio propio o integracion con buzones | ☐ | TU+YO |
| 9.10 | Smoke test: crear cliente -> contacto -> oportunidad -> seguimiento -> obra vinculada | ☐ | TU+YO |

Criterio de salida:

- CRM alimenta Obras y Calidad sin crear duplicidad de entidades.

---

## Fase 10: Caluga Procedimientos y Capacitacion

Objetivo: crear base documental versionada y matriz de cumplimiento por cargo/persona.

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 10.1 | Definir tipos de procedimiento y documentos controlados | ☐ | TU+YO |
| 10.2 | Definir versionado, aprobacion y vigencia de procedimientos | ☐ | TU+YO |
| 10.3 | Definir matriz cargo/procedimiento | ☐ | TU+YO |
| 10.4 | Crear tablas de procedimientos, versiones y aprobaciones | ☐ | YO |
| 10.5 | Crear tablas de capacitaciones, evaluaciones y resultados | ☐ | YO |
| 10.6 | Crear caluga Procedimientos y Capacitacion | ☐ | YO |
| 10.7 | Crear biblioteca documental con busqueda y filtros | ☐ | YO |
| 10.8 | Crear vista de matriz de cumplimiento | ☐ | YO |
| 10.9 | Crear flujo de evaluacion/aprobacion simple | ☐ | YO |
| 10.10 | Smoke test: subir procedimiento -> aprobar version -> asignar cargo -> evaluar usuario | ☐ | TU+YO |

Criterio de salida:

- Existe una biblioteca controlada y una matriz minima de cumplimiento.

---

## Fase 11: App Terreno

Objetivo: preparar API y luego app para terreno, sin convertirla en otra caluga web.

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 11.1 | Definir casos iniciales: checklist, fotos, observaciones, firma, protocolo PDF | ☐ | TU+YO |
| 11.2 | Decidir si requiere offline en v1 o queda futuro | ☐ | TU+YO |
| 11.3 | Definir autenticacion para app y permisos por obra | ☐ | YO |
| 11.4 | Crear endpoints API para obras asignadas | ☐ | YO |
| 11.5 | Crear endpoints API para checklist y evidencias | ☐ | YO |
| 11.6 | Crear almacenamiento de fotos en storage documental | ☐ | YO |
| 11.7 | Crear generacion de protocolo PDF desde datos de terreno | ☐ | YO |
| 11.8 | Decidir tecnologia app: PWA, React Native/Expo u otra | ☐ | TU+YO |
| 11.9 | Crear prototipo minimo de App Terreno | ☐ | YO |
| 11.10 | Smoke test: usuario terreno -> checklist -> fotos -> firma -> protocolo PDF en obra | ☐ | TU+YO |

Criterio de salida:

- Terreno puede registrar evidencia y generar protocolo ligado a obra.

---

## Fase 12: Automatizaciones, reportes e IA opcional

Objetivo: agregar productividad sin bloquear la operacion principal.

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 12.1 | Definir cola de trabajos para emails, PDFs, previews, reportes e IA | ☐ | YO |
| 12.2 | Implementar worker de envio de correos | ☐ | YO |
| 12.3 | Implementar worker de generacion de reportes/PDF pesados | ☐ | YO |
| 12.4 | Evaluar CAD preview: PDF preview inicial vs DWG preview avanzado | ☐ | TU+YO |
| 12.5 | Definir casos de IA: resumen, clasificacion, redaccion, busqueda y alertas | ☐ | TU+YO |
| 12.6 | Implementar IA solo en caso de uso aprobado y medible | ☐ | YO |
| 12.7 | Crear dashboards obligatorios por jefatura, cliente, calidad y ventas | ☐ | TU+YO |
| 12.8 | Crear monitoreo de workers y fallos | ☐ | YO |

Criterio de salida:

- Las automatizaciones operan por cola/worker y no hacen lento el portal.

---

## Fase 13: Seguridad, performance y cierre de version

Objetivo: cerrar v1.00 con una base sostenible.

| N° | Descripcion | Realizado | Quien |
|----|-------------|-----------|-------|
| 13.1 | Definir politica de contrasenas, MFA/SSO futuro y sesiones | ☐ | TU+YO |
| 13.2 | Revisar OWASP Top 10/ASVS minimo para endpoints criticos | ☐ | YO |
| 13.3 | Revisar performance de queries sensibles | ☐ | YO |
| 13.4 | Revisar indices y migraciones acumuladas | ☐ | YO |
| 13.5 | Crear backup/restore documentado de DB y storage | ☐ | YO |
| 13.6 | Crear checklist de release por caluga | ☐ | YO |
| 13.7 | Actualizar docs finales: protocolo, modelo de datos, permisos y arquitectura | ☐ | YO |
| 13.8 | Congelar `programa_v1.00.md` y crear siguiente version | ☐ | TU+YO |

---

## Backlog futuro no bloqueante

| N° | Descripcion | Estado |
|----|-------------|--------|
| BF.1 | Integracion SAP de solo lectura | Futuro |
| BF.2 | CAD preview avanzado DWG | Futuro |
| BF.3 | Busqueda semantica documental | Futuro |
| BF.4 | IA para resumen y clasificacion automatica | Condicionado |
| BF.5 | SSO corporativo | Futuro |
| BF.6 | Offline completo en App Terreno | Condicionado |
| BF.7 | Separacion de servicios por dominio | Solo si los criterios de 0.4 se cumplen |

---

## Fuentes usadas para consolidacion

- `../PROTOCOLO_GENERAL_REP.md`
- `armahub-protocolo.md`
- `docs/Armahub_Documento_Base_Desarrollo_v0_1.docx`
- `Roadmap.md`
- `ROADMAP_RECLAMOS.md`
- `ROLES_Y_PERMISOS.md`
- `MODELO_DE_DATOS.md`
- `refactor-analysis.md`
- `diseno_repositorios_imagenes.md`
- Cloudflare Containers: https://developers.cloudflare.com/containers/
- Cloudflare Python Workers/FastAPI: https://developers.cloudflare.com/workers/languages/python/packages/fastapi/
- Cloudflare Python packages: https://developers.cloudflare.com/workers/languages/python/packages/
- Cloudflare R2: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Queues: https://developers.cloudflare.com/queues/
