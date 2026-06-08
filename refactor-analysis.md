# Plan de Refactorizacion Valido - ArmaHub

> **DECISIÓN CERRADA (2026-06-08, tarea 1.4 del programa vigente):**
> - El refactor **frontend** propuesto aquí (extraer app.js a app/shared/features/legacy) **YA SE EJECUTÓ
>   completo**: app.js pasó de monolito a ~80 líneas. Esta parte del documento es histórica.
> - La estructura **backend** `modules/{dominio}/router,services,queries,schemas` propuesta aquí **NO se
>   adopta por ahora**. El backend se mantiene en archivos por dominio (`reclamos.py`, `barras.py`, etc.),
>   que sigue siendo legible. Solo se separará un dominio puntual si su tamaño lo exige (ver decisión 0.4
>   del programa vigente). Esto cierra la ambigüedad: NO hay migración pendiente a `modules/`.
>
> Documento conservado como fuente arquitectónica. Programa vigente: `docs/programa-versiones/programa_v1.00.md`.


## Objetivo

ArmaHub ya no es solo una app de cubicacion. Hoy es un portal con Hub, modulos separados por negocio y una proyeccion clara a nuevas calugas y miniaplicaciones. El refactor debe preparar esa expansion sin reescribir todo ni romper la operacion diaria.

La meta correcta no es partir app.js porque si. La meta es dejar una arquitectura donde:

- el Hub actue como shell del portal
- cada modulo tenga fronteras claras
- el frontend pueda crecer por features independientes
- el backend tenga un solo contrato por caso de uso
- las capas legacy se reduzcan de forma controlada

---

## Estado Verificado del Repositorio

### Lo que ya esta bien

- El backend ya esta razonablemente separado por dominio en archivos como auth.py, barras.py, reclamos.py, admin.py, export.py y pedidos.py.
- La UI ya no vive inline en ui.py. Hoy existe una base correcta con templates Jinja en templates/ y assets estaticos en static/.
- El Hub y los tabs ya expresan una separacion funcional util para seguir creciendo.

### Lo que hoy esta mal

- app.js sigue siendo el cuello de botella principal. El archivo concentra shell, auth, landing, cubicacion, admin, reclamos, presentaciones, imagenes y compatibilidad legacy.
- Hay refactor parcial incrustado dentro del mismo app.js. Eso dejo duplicacion de flujos y contratos mezclados.
- Reclamos tiene deriva de contrato: endpoint canonico, endpoint legacy y frontend con nomenclaturas mezcladas.
- Parte de la documentacion quedo atrasada y describe un sistema que ya no coincide con el repo real.

### Conclusion tecnica

La prioridad no es rehacer el backend completo. La prioridad es estabilizar contratos y extraer el frontend a una estructura orientada a portal y features.

---

## Principios del Refactor

1. Un caso de uso, un contrato.
2. Un modulo dueno de cada feature.
3. El shell del portal no contiene logica de negocio.
4. Los helpers compartidos viven en shared, no repartidos por modulos.
5. La compatibilidad legacy debe ser transitoria y explicita.
6. No hacer big bang refactor. Solo extraccion incremental con sistema funcionando.
7. No mezclar repositorios de imagenes de registro y de analisis.

---

## Arquitectura Objetivo

### 1. Shell del portal

El Hub debe pasar a ser el contenedor principal del sistema. Su responsabilidad es minima:

- bootstrap de sesion
- registro de modulos y calugas
- navegacion entre modulos
- permisos de alto nivel
- estado global liviano

El shell no debe conocer reglas especificas de reclamos, exportacion o pedidos.

### 2. Modulos de negocio

Cada modulo debe encapsular sus pantallas, eventos, llamadas API y estado local:

- Cubicacion
- Reclamos
- Administracion
- Portal

Cuando aparezcan nuevas calugas no relacionadas al acero, deben entrar como nuevos modulos del portal, no como bloques pegados dentro de app.js.

### 3. Shared/Core

Todo lo transversal debe extraerse a una capa comun:

- cliente HTTP
- auth y sesion
- permisos
- helpers DOM
- formateo
- modales
- upload de archivos
- componentes reusables simples

### 4. Contratos backend

En backend, cada feature debe tener un contrato canonico. Los endpoints legacy, si existen, deben delegar al contrato vigente. No deben mantener SQL propio porque eso genera drift.

### 5. Politica de imagenes de Reclamos

Las imagenes de Reclamos deben seguir separadas por dominio funcional.

- Repositorio rosado: imagenes de registro o antecedentes.
- Repositorio celeste: imagenes de analisis o respuesta.

La refactorizacion no debe fusionar esos repositorios. Lo que si debe hacer es unificar la forma de representarlos en contrato y frontend.

Regla de arquitectura:

- una sola coleccion en payload si conviene transportar juntas
- pero siempre con tipo canonico explicito
- y siempre renderizadas en contenedores separados por modulo

Tipos canonicos vigentes:

- ImagenesRegistro
- ImagenesAnalisis

Resultado esperado:

- no se pierde la separacion visual ni funcional entre rosado y celeste
- no se duplican handlers de upload
- no se mezclan referencias legacy con nombres nuevos dentro del render

---

## Estructura Objetivo Recomendada

### Backend

```text
armahub/
  main.py
  auth.py
  db.py
  ui.py
  modules/
    cubicacion/
      router.py
      services.py
      queries.py
      schemas.py
    reclamos/
      router.py
      services.py
      queries.py
      schemas.py
    admin/
      router.py
      services.py
      schemas.py
    portal/
      router.py
      cards.py
  shared/
    permissions.py
    responses.py
    dates.py
```

Nota: no es obligatorio mover todo de inmediato a modules/. Hoy el backend ya esta usable. Este paso debe hacerse solo cuando cada dominio lo justifique.

### Frontend

```text
armahub/static/js/
  app/
    bootstrap.js
    shell.js
    registry.js
    state.js
  shared/
    api.js
    auth.js
    dom.js
    dates.js
    forms.js
    uploads.js
    modal.js
    charts.js
  features/
    portal/
      landing.js
      cards.js
      registry.js
    cubicacion/
      inicio.js
      obras.js
      bar_manager.js
      dashboards.js
      exportacion.js
      pedidos.js
    reclamos/
      landing.js
      list.js
      detail.js
      presentaciones.js
      ishikawa.js
      images.js
    admin/
      users.js
      proyectos.js
      constructoras.js
      calculistas.js
      audit.js
  legacy/
    compat.js
```

### Templates

```text
armahub/templates/
  app.html
  login.html
  bootstrap.html
  tabs/
    inicio.html
    obras.html
    bar_manager.html
    dashboards.html
    pedidos.html
    exportacion.html
    reclamos.html
    admin.html
  components/
    hub_card.html
    modal_base.html
    table_toolbar.html
```

---

## Diseno para el Hub y las Futuras Calugas

La estructura futura debe soportar que el landing tenga apps internas no necesariamente relacionadas con cubicacion.

Por eso la unidad de crecimiento no debe ser un tab nuevo en app.js, sino una entrada de registro de modulo.

### Registro de modulos propuesto

Cada modulo debe declararse con:

- id
- label
- icono
- permisos requeridos
- loader
- punto de entrada UI
- hooks opcionales de init y teardown

Ejemplo conceptual:

```js
registerModule({
  id: 'reclamos',
  label: 'Reclamos',
  roles: ['admin', 'admin2', 'cubicador', 'usc', 'externo'],
  mount: mountReclamos,
  unmount: unmountReclamos,
});
```

Esto permite que manana exista una caluga nueva como Indicadores Comerciales, Control de Entregas o Gestion Documental sin tocar el codigo interno de Cubicacion o Reclamos.

---

## Orden de Extraccion Recomendado

### Fase 0. Estabilizacion de contratos

- Unificar reclamos sobre un endpoint canonico por detalle.
- Eliminar SQL duplicado en rutas legacy.
- Normalizar nombres de tipos de imagen y campos de fecha.
- Invalidar cache cuando un reclamo cambia.

### Fase 0.5. Limpieza estructural minima antes de extraer

Esta fase no busca modularizar aun. Busca sacar el desorden que hoy genera regresiones.

Tareas exactas:

1. Definir un normalizador unico para listado y detalle de Reclamos.
2. Dejar una sola implementacion activa para Presentaciones.
3. Dejar una sola implementacion activa para detalle principal de Reclamos.
4. Mover compatibilidad legacy a funciones o adaptadores explicitos.
5. Separar render de detalle, acciones e imagenes en bloques independientes dentro del mismo archivo.
6. Confirmar smoke test minimo: listar, abrir, responder, validar, presentar, subir imagen rosada, subir imagen celeste.

Resultado esperado:

- deja de haber logica duplicada compitiendo dentro de app.js
- las compatibilidades quedan localizadas y visibles
- la extraccion posterior a modulos se hace sobre una base coherente

### Fase 1. Extraer shared/core

- api.js
- auth.js
- dom.js
- dates.js
- modal.js
- uploads.js

Resultado esperado:

- app.js baja de tamano sin cambiar funcionalidad
- se elimina duplicacion de utilidades

### Fase 2. Crear shell del portal

- bootstrap.js
- shell.js
- registry.js
- state.js
- registro de modulos y calugas

Resultado esperado:

- el Hub pasa a ser una plataforma de modulos

### Fase 3. Extraer Reclamos

Orden recomendado:

1. landing.js
2. list.js
3. detail.js
4. ishikawa.js
5. images.js
6. presentaciones.js

Reclamos va primero porque hoy es el area con mas deriva entre frontend, backend y estado real.

Orden interno recomendado para Reclamos:

1. mover cliente de datos y normalizadores
2. mover render del listado
3. mover render del detalle principal
4. mover uploads y render de imagenes separadas por repositorio
5. mover Presentaciones
6. borrar wrappers transitorios que ya no se usen

### Fase 4. Extraer Cubicacion y Admin

- Cubicacion por submodulo, no como bloque unico
- Admin por feature operativa, no como archivo generico gigante

### Fase 5. Limpieza final

- mover wrappers temporales a legacy/compat.js
- eliminar paths legacy ya sin uso
- actualizar documentacion tecnica
- definir smoke tests minimos por modulo

---

## Que NO hacer

- No reescribir toda la app en un framework nuevo sin necesidad.
- No mover backend y frontend al mismo tiempo por dominio si no hay cobertura minima.
- No mantener dos contratos vivos por feature con logicas distintas.
- No seguir agregando features grandes dentro de app.js.
- No mezclar nombres legacy y nombres nuevos en imagenes, estados o payloads.

---

## Definicion de Exito

El refactor se considera bien encaminado cuando:

- app.js deja de ser el lugar donde se agregan nuevas features
- cada modulo nuevo entra por registro en el shell del portal
- Reclamos deja de depender de rutas legacy con SQL duplicado
- shared contiene los helpers transversales reales
- roadmap y documentacion describen el repo real y no uno historico

---

## Prioridad Inmediata

1. Cerrar Fase 0 de estabilizacion de Reclamos.
2. Ejecutar Fase 0.5 de limpieza estructural minima.
3. Extraer shared/core.
4. Disenar el registro de modulos del Hub.
5. Sacar Reclamos completo de app.js.
6. Luego extraer Cubicacion y Admin.
