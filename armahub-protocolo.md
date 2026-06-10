# Protocolo de Trabajo - ArmaHub

## Jerarquia de reglas

- Este archivo es especifico de ArmaHub.
- Las reglas generales para todos los proyectos viven en [../PROTOCOLO_GENERAL_REP.md](../PROTOCOLO_GENERAL_REP.md).
- Si hay conflicto, manda el protocolo general salvo que el usuario indique una excepcion explicita para ArmaHub.

## Como usar este programa

### 1. Estructura general

- Las tareas estan organizadas en **FASES**.
- Cada fase agrupa tareas relacionadas por tema o etapa del proyecto.
- Dentro de cada fase, las tareas usan numeracion simple: `1.1`, `1.2`, `2.1`, etc.
- El primer numero indica la fase; el segundo indica el orden dentro de la fase.

### 2. Como marcar una tarea como realizada

- Cambia el simbolo `☐` por `☑` cuando termines.
- Marca una sola tarea por vez para que el progreso sea legible.
- Si una tarea queda bloqueada, deja una nota breve y no la borres.

### 3. Como incorporar tareas que surgen en el camino (captura ordenada)

A medida que se avanza por fase y por caluga, apareceran tareas nuevas, mejoras de
flujo, bugs y ajustes que no estaban previstos. Esto es esperado. La regla es capturarlos
sin desordenar el programa ni perder el hilo. Procedimiento:

1. **Clasificar el hallazgo** antes de escribirlo:
   - **Bloqueante de la fase actual** -> se agrega a la fase en curso, despues de su prerequisito.
   - **Pertenece a una fase futura** -> se agrega a esa fase (aunque aun no se trabaje), para no olvidarlo.
   - **Mejora no urgente / idea** -> se agrega al **Backlog futuro no bloqueante** del programa.
   - **Bug** -> se agrega como tarea con prefijo `FIX:` en la fase del modulo afectado.

2. **Numeracion al insertar**: agregar la tarea al final de su fase con el siguiente numero
   correlativo de esa fase (ej: si la Fase 6A llega hasta 6.4, la nueva es 6.5). No intercalar
   numeros con letras sueltas salvo que sea una subtarea directa y necesaria.

3. **Renumeracion**: NO renumerar toda la fase cada vez que entra una tarea (genera ruido y
   rompe referencias). Solo se renumera limpio en el **cierre de version**, segun la regla de
   cambio de version. Durante la version activa, se agrega al final de la fase.

4. **Trazabilidad del origen**: si la tarea nace de un hallazgo durante otra tarea, dejar una
   nota breve de donde salio (ej: "detectado al revisar permisos de reclamos").

5. **No mezclar**: una tarea emergente nunca se mete "donde se este trabajando" si en realidad
   pertenece a otra fase. Se anota en la fase correcta aunque sea futura.

Regla de oro: si dudas donde va, va al Backlog futuro no bloqueante y se reubica en el
proximo cierre de version. Es preferible capturarla en el lugar equivocado que perderla.

### 3b. Reglas base al agregar cualquier tarea

- Agregar la tarea dentro de la fase que corresponda por logica de ejecucion.
- Si depende de otra, debe quedar despues de su prerequisito.
- Mantener descripciones cortas, accionables y con verbo inicial.

### 4. Cuando reordenar tareas

- Reordenar cuando mejore la secuencia real de trabajo.
- Luego de reordenar, renumerar para evitar huecos o duplicados.
- Evitar subtareas profundas; si crecen demasiado, convertirlas en tareas normales.

### 5. Reglas importantes

- Una tarea debe ser concreta y verificable.
- Todas las tareas comienzan con verbo: Crear, Revisar, Configurar, Implementar, Validar, Testing.
- Separar trabajo activo de backlog futuro.
- No mezclar decisiones historicas con programa vigente.
- No borrar documentos antiguos sin confirmacion del usuario.

### 6. Quien hace que

- **TU**: decisiones de negocio, cuentas, aprobaciones, testing operativo.
- **YO**: documentacion, programacion, debugging, estructura, validacion tecnica.
- **TU+YO**: decisiones mixtas de producto, arquitectura o costo.

## Al inicio de cada sesion de trabajo

1. Revisar [../PROTOCOLO_GENERAL_REP.md](../PROTOCOLO_GENERAL_REP.md).
2. Revisar este protocolo.
3. Revisar el programa vigente en `docs/programa-versiones/`.
4. Revisar `git status`.
5. Identificar cambios locales no propios antes de editar.
6. Confirmar el bloque activo antes de tocar codigo.

Si hay cambios locales de otro agente o del usuario, no se revierten ni se pisan. Se trabaja alrededor de ellos o se pide coordinacion si bloquean la tarea.

## Protocolo general por versiones

Objetivo: mantener orden historico sin perder pendientes.

### Estructura recomendada

- Carpeta por proyecto: `docs/programa-versiones/`.
- Un archivo por version.
- Nombre estandar: `programa_vX.YY.md`.

### Regla de cambio de version

- Cuando el usuario indique cierre de version, congelar el archivo actual.
- Crear un nuevo archivo para la siguiente version.
- Pasar solo pendientes vigentes al nuevo archivo.
- Reordenar por prioridad/dependencia y renumerar limpio.

### Reglas de limpieza al abrir nueva version

- Reducir subtareas innecesarias.
- Unificar tareas duplicadas.
- Mantener cada tarea en formato verbo + resultado esperado.
- Si una tarea antigua no aplica, marcarla como descartada y no arrastrarla.

## Arquitectura de trabajo

### Alcance del proyecto

ArmaHub es el portal operativo que agrupa:

- Cubicacion y gestion de obras/cargas/barras.
- Reclamos y gestion de calidad.
- Administracion de usuarios, permisos y entidades.
- Futuras calugas o miniaplicaciones del portal.

La direccion arquitectonica es mantener un solo portal, un solo backend FastAPI y una sola base de datos, con modulos separados por dominio y permisos.

### Frontend

La direccion vigente es portal modular:

- `armahub/static/js/app/`: bootstrap, shell y registro.
- `armahub/static/js/shared/`: utilidades transversales.
- `armahub/static/js/features/`: modulos por dominio.
- `armahub/static/js/legacy/`: compatibilidad temporal explicita.

Reglas:

- Nuevas features no deben entrar a `app.js`.
- Las calugas nuevas deben registrarse en el shell/registry.
- El shell no debe contener logica de negocio.
- Compatibilidad legacy solo si queda localizada y con salida clara.

### Backend

El backend puede seguir en archivos por dominio mientras sea legible:

- `auth.py`
- `barras.py`
- `reclamos.py`
- `reclamos_queries.py`
- `admin.py`
- `pedidos.py`
- `importer.py`
- `db.py`

Reglas:

- Un caso de uso debe tener un contrato canonico.
- Endpoints legacy no deben mantener SQL propio si ya existe contrato vigente.
- Permisos y ownership deben validarse en backend, no solo en frontend.
- Cambios de schema deben quedar versionados por migracion.

## Documento de especificaciones funcionales (SPECS_ARMAHUB)

### Proposito

`docs/SPECS_ARMAHUB.md` es el mapa funcional vivo de ArmaHub. Documenta flujos, permisos y
decisiones de diseno por caluga. No es un roadmap — para eso esta `docs/programa-versiones/`.

### Metodologia de trabajo

1. **Una seccion por caluga.** Cada caluga tiene su propia seccion en SPECS_ARMAHUB.
2. **Se actualiza al cerrar cada caluga.** Cuando una caluga queda funcionando, se documenta su
   flujo completo, permisos por rol y decisiones de diseno.
3. **Tambien se actualiza cuando cambia un flujo.** Si un flujo, permiso o comportamiento cambia
   durante la implementacion, SPECS_ARMAHUB se actualiza en el mismo commit de codigo.
4. **Nunca se crea un specs por caluga separado.** Todo va al mismo documento general.
5. **Armonizacion visual post-F9.** El diseno visual se define caluga por caluga. La revision
   transversal de coherencia se hace al cierre de F9.
6. **Secciones futuras en borrador.** Las calugas no implementadas tienen una seccion minima con
   proposito y pendientes, para que el documento sirva de mapa completo.

### Que documenta

- Flujo de estados (diagramas ASCII).
- Permisos por rol y por seccion.
- Reglas de ownership.
- Decisiones de diseno que no son obvias desde el codigo.
- Pendientes funcionales activos de cada caluga.

### Que no documenta

- Esquema de base de datos (eso esta en `MODELO_DE_DATOS.md`).
- Roadmap o tareas pendientes (eso esta en `docs/programa-versiones/`).
- Codigo — solo comportamiento observable.

---

## Reclamos y calidad

Reclamos es un modulo critico:

- Mantener separadas las imagenes de registro/antecedentes y analisis/respuesta.
- Usar tipos canonicos para imagenes y payloads.
- No mezclar contratos legacy con contratos nuevos dentro del render.
- Todo cambio de permisos debe reflejarse en `ROLES_Y_PERMISOS.md`.
- Todo cambio de modelo debe reflejarse en `MODELO_DE_DATOS.md`.

Direccion de producto vigente:

- Escalar Reclamos a sistema de calidad multi-origen.
- Soportar origen `cubicacion`, `retail`, `planta` u otros futuros.
- Incorporar clientes no ligados a obra cuando el origen no sea cubicacion.
- Mantener aislamiento logico por permisos, rol y filtros de origen.

## Validacion y pruebas

Antes de cerrar un bloque funcional, validar segun riesgo:

- Smoke test del modulo afectado.
- Flujo manual si involucra UI.
- Permisos por rol si cambia acceso o acciones.
- Migracion local si cambia schema.
- PDF/correo/storage con casos vacios y casos completos.

Smoke tests minimos por modulo:

- Reclamos: listar, filtrar, abrir detalle, crear, editar registro, editar analisis, validar, presentar, subir imagen registro, subir imagen analisis.
- Cubicacion: importar CSV, abrir obra, mover/eliminar cargas, Bar Manager, exportar.
- Admin: usuarios, roles, entidades, notificaciones, permisos visibles.

## Flujo Git guiado

- No hacer push, merge ni rebase sin confirmacion del usuario.
- No tocar cambios locales no propios.
- Preferir ramas por bloque coherente si el cambio supera documentacion menor.
- Antes de commit: revisar `git status` y enumerar archivos tocados.
- Si Claude u otro agente trabaja en paralelo, coordinar por archivo y modulo.

Checklist minimo:

1. Revisar estado: `git status`
2. Confirmar rama actual: `git branch --show-current`
3. Crear rama si el cambio es mediano o grande.
4. Hacer cambios y validar.
5. Commit con mensaje claro.
6. Push solo con confirmacion explicita.

## Barrido documental

Clasificacion esperada:

- **Vigente**: documento operativo actual.
- **Fuente historica**: contiene decisiones utiles pero no es programa activo.
- **Superseded**: reemplazado por protocolo/programa vigente.
- **Archivo**: se conserva por trazabilidad, fuera del flujo diario.

Los documentos historicos se mueven o eliminan solo con confirmacion del usuario.

## Formato visual de la tabla

```text
| N°  | Descripción                          | Realizado | Quién |
|-----|--------------------------------------|-----------|-------|
| 1.1 | Crear protocolo del proyecto         | ☑         | YO    |
| 1.2 | Revisar permisos por rol             | ☐         | TÚ+YO |
```
