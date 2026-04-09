# Plan de Refactorizacion Valido - ArmaHub

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

- landing.js
- list.js
- detail.js
- ishikawa.js
- images.js
- presentaciones.js

Reclamos va primero porque hoy es el area con mas deriva entre frontend, backend y estado real.

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

1. Estabilizar reclamos y presentaciones.
2. Extraer shared/core.
3. Disenar el registro de modulos del Hub.
4. Sacar Reclamos completo de app.js.
5. Luego extraer Cubicacion y Admin.
