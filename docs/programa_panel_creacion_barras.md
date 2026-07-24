# Programa de trabajo — Panel de creación de barras (Cubicación manual)

> Tab **Cubicar** dentro de Cubicaciones. Similar al Bar Manager pero enfocado en
> **ingresar** barras (no consultar). Barras marcadas `origen='manual'` que
> **sobreviven** a la reimportación de un sector constructivo.
> Redactado para trabajo autónomo. Al final: **preguntas pendientes** para Eugenio.

---

## 1. Estado actual verificado (lo que YA existe — reutilizar, no reinventar)

- **Columna `origen`** en `barras` (`csv` / `manual` / `pedido`). Es la base de la protección. Los filtros y stats ya la respetan ([barras.py:74,120](armahub/barras.py)).
- **Andamiaje deshabilitado ya presente:**
  - `POST /barras/crear` con modelo `BarraManualCreate` → hoy responde 403 "deshabilitado" ([barras.py:1447](armahub/barras.py)). **Hay que rehabilitarlo y completarlo.**
  - `POST /barras/{id}/duplicar` (manual) también deshabilitado ([barras.py:1453](armahub/barras.py)).
  - `BarraManualCreate` ya define: id_proyecto, sector, piso, ciclo, eje, diam, largo_total, cant, figura, marca ([barras.py:1434](armahub/barras.py)).
- **Cálculo de peso** listo: `_calcular_peso(diam, largo)` → kg ([barras.py:1252](armahub/barras.py)).
- **Eliminación de cargas** es por `import_id` ([barras.py:1048](armahub/barras.py)). Las barras `manual` **no tienen import_id de CSV**, así que ya sobreviven a "eliminar carga". **PERO** hay que verificar la reimportación (ver §5).
- **Ubicaciones reutilizables:** `GET /proyectos/{id}/sectores-nav` devuelve piso→ciclo→sector con stats ([barras.py:1489](armahub/barras.py)); hay `SELECT DISTINCT piso/sector/eje`. Sirve para autocompletar/seleccionar ubicación existente.
- **Catálogo de figuras:** `GET /figuras-catalogo` (el que alimenta el diseñador) da figura + parciales + ángulos + radio. Sirve para el selector de figura y para **generar los campos de dimensiones** que la barra necesita.
- **Bar Manager frontend** (`static/js/features/cubicacion/`): `barmanager.js`, `barmanager_edit.js`, `filtros.js`, `helpers.js`, `import.js`. La edición masiva y el form de edición son la **referencia de UI**.
- **Modelo completo de una barra** (`BARRAS_COLUMNS`): id_unico, id_proyecto, sector, piso, ciclo, eje, diam, largo_total, mult, cant, cant_total, peso_unitario, peso_total, marca, figura, dim_a..dim_i, ang1..ang4, radio, origen, import_id, editado_por, editado_fecha.

---

## 2. Objetivo del panel

Un formulario de **alta de barras** donde el cubicador:
1. Elige/confirma la **ubicación** (proyecto → piso → ciclo → sector → eje), **reutilizando** las ubicaciones ya existentes del proyecto (no re-tipear).
2. Elige la **figura** del catálogo → el form pide **solo las dimensiones que esa figura usa** (A, B, C…, ángulos, radio) — homologado con el diseñador.
3. Ingresa diámetro, cantidad, marca, etc.
4. Guarda → barra `origen='manual'`, con peso calculado, que **no se borra** al reimportar el sector.

---

## 3. Fases de implementación

### Fase 1 — Backend: rehabilitar y completar `POST /barras/crear`
- Quitar el 403; implementar la inserción real.
- Generar `id_unico` único para barras manuales (prefijo claro, ej. `MAN-{proyecto}-{correlativo}` o UUID corto) — que NO colisione con los id_unico del CSV.
- Setear `origen='manual'`, `import_id=NULL`, `fecha_carga=now`, `editado_por=user`, `peso_unitario`/`peso_total` con `_calcular_peso` × cant.
- Ampliar `BarraManualCreate` con: `nombre_proyecto`, `plano_code`/`nombre_plano` (opcional), `dim_a..dim_i`, `ang1..ang4`, `radio`. (Hoy solo tiene diam/largo/figura.)
- Permisos: ¿quién puede crear? (ver preguntas). Base: cubicadores del proyecto + admins.
- Validaciones: diam > 0, cant > 0, ubicación mínima requerida (proyecto+sector), figura válida del catálogo.

### Fase 2 — Backend: endpoints de apoyo
- `GET /proyectos/{id}/ubicaciones` (o reutilizar sectores-nav): lista de sectores/pisos/ciclos/ejes existentes para autocompletar.
- `GET /figuras-catalogo` ya existe → el front lo usa para el selector + campos dinámicos.
- (Opcional) `POST /barras/crear-lote`: alta de varias barras de una (mismo sector, varias marcas/diámetros) — muy útil para productividad.

### Fase 3 — Frontend: tab "Cubicar" + formulario
- Nuevo sub-tab en Cubicaciones (junto a Bar Manager), o botón "➕ Crear barra".
- **Selector de ubicación en cascada** que se **autopopula** con las ubicaciones existentes del proyecto (dropdowns con opción "＋ nueva"): Proyecto → Piso → Ciclo → Sector → Eje.
- **Selector de figura** (del catálogo) → render de la figura (reutiliza `disenadorMotor.dibujarFigura`) + **campos de dimensiones dinámicos** según los parciales/ángulos/radio de esa figura.
- Campos: diámetro (selector de diámetros estándar), cantidad, marca, largo total (¿auto-sumado de las dims? ver preguntas).
- Peso calculado en vivo (preview) antes de guardar.
- Botón guardar → POST; feedback; opción "guardar y crear otra" (mantiene ubicación).

### Fase 4 — Frontend: listado y gestión de barras manuales
- Ver las barras manuales creadas (filtro `origen=manual` ya soportado en `GET /barras`).
- Editar/eliminar (reusar el form de edición del Bar Manager).
- **Badge visual** "manual" para distinguirlas de las importadas.

### Fase 5 — Protección contra reimportación (el requisito clave)
- Verificar/garantizar que al **reimportar un sector** (nueva carga CSV que pisa un sector), las barras `origen='manual'` de ese sector **NO se borren**.
- Si la importación borra por sector antes de insertar, agregar `AND origen != 'manual'` (o `AND (origen IS NULL OR origen <> 'manual')`) a ese DELETE.
- Confirmar el flujo real de reimport (hoy el DELETE de carga es por import_id, que ya excluye manuales — pero hay que revisar si hay algún path que borre por sector/proyecto).

### Fase 6 — Integración con el catálogo/diseñador (homologación)
- La figura elegida define qué dimensiones pide el form (A, B… ángulos, radio) → viene del catálogo, que a su vez se alimenta del diseñador. Coherencia total.
- Cuando el diseñador termine de poblar todas las figuras, este panel las usará directamente.

---

## 4. Pensado críticamente — cosas que PUEDEN FALTAR (y hay que resolver)

1. **Generación de `id_unico`:** debe ser único y no chocar con CSV ni con reimportaciones. ¿Correlativo por proyecto? ¿Qué pasa si se borra y se recrea?
2. **`largo_total` vs dimensiones parciales:** ¿el largo total lo ingresa el usuario, o se calcula sumando A+B+C…+ desarrollo de dobleces? En acero el desarrollo real considera radios de doblez. **Decisión importante** (ver preguntas).
3. **Diámetros estándar:** ¿lista fija (8,10,12,16,18,22,25,28,32,36…) o libre? Mejor selector con estándar.
4. **`cant` vs `cant_total` vs `mult`:** el modelo tiene los tres. Definir qué ingresa el usuario y qué se deriva.
5. **Marca:** ¿libre, autoincremental, o del catálogo? ¿Se repite marca en un mismo sector?
6. **Versionado:** las barras CSV traen `version_mod`/`version_exp`. Las manuales ¿qué versión llevan? (probablemente null o "manual").
7. **Duplicados:** ¿avisar si ya existe una barra igual (misma ubicación+figura+dims+diam)? ¿Permitir o bloquear?
8. **Permisos y ownership:** ¿un cubicador puede crear en cualquier proyecto o solo en los suyos? ¿Puede editar/borrar manuales de otro?
9. **Auditoría:** guardar `editado_por`/`creado_por` y fecha (ya hay columnas). ¿Log de creación manual?
10. **Reimport que cambia la ubicación:** si un CSV renombra un sector, las barras manuales quedan "huérfanas" en el sector viejo. ¿Se migran? (probablemente no, pero avisarlo).
11. **Exportación:** ¿las barras manuales se incluyen en los export/PDF/pedidos? (Sí, deberían, pero marcadas).
12. **Dashboard/stats:** las manuales ya suman en stats (buena) — confirmar que no rompen conteos de "cargas".
13. **Multi-alta:** crear 20 barras iguales cambiando solo la marca es común → el "crear otra" o el lote ahorra muchísimo.
14. **Validación de figura sin geometría:** figuras viejas del catálogo sin geometría del diseñador — el form igual debe pedir dims por los `parciales`.

---

## 5. Riesgos / dependencias

- **Depende del catálogo de figuras** poblado (el diseñador). Mientras no estén todas las figuras, se puede crear con figuras existentes.
- **La reimportación** es el punto delicado: si algún path borra por sector, hay que blindarlo. Requiere leer bien el flujo de import (que hoy no encontré completo — el import CSV real puede estar en otro módulo o endpoint; revisar `import.js` y el POST de carga).
- No romper el Bar Manager ni la edición masiva existentes (compartimos endpoints).

---

## 6. PREGUNTAS PENDIENTES para Eugenio (responder para avanzar sin trabas)

1. **Largo total:** ¿lo ingresa el usuario manualmente, o se calcula automático sumando las dimensiones parciales (con o sin desarrollo de dobleces)?
2. **id_unico manual:** ¿prefieres un correlativo legible (ej. `MAN-001`, `MAN-002` por proyecto) o un ID interno tipo UUID que no ves? ¿Importa que sea "bonito" para el usuario?
3. **Multi-alta:** ¿quieres poder crear varias barras de una (mismo sector, cambiando marca/diámetro/cantidad en una grilla), o de a una con "guardar y crear otra" basta por ahora?
4. **Permisos:** ¿cualquier cubicador crea barras manuales en cualquier proyecto, o solo en los proyectos donde participa? ¿Quién puede editarlas/borrarlas?
5. **Marca:** ¿la marca la escribe el usuario libre, o el sistema sugiere la siguiente disponible en ese sector?
6. **Diámetro:** ¿lista fija de diámetros estándar (cuáles), o campo libre?
7. **Ubicación nueva:** al crear una barra en un sector/piso/eje que NO existe aún en el proyecto, ¿se crea la ubicación al vuelo sin fricción, o quieres una confirmación ("estás creando el sector X nuevo")?
8. **Alcance del tab:** ¿es un tab nuevo "Cubicar" separado, o un botón "➕ Crear barra" dentro del Bar Manager actual?
9. **Reimport:** confirmar el comportamiento esperado: una barra manual en el sector "Torre A - Piso 3" debe sobrevivir aunque se reimporte el CSV de ese mismo sector, ¿correcto? (Asumo que sí.)
