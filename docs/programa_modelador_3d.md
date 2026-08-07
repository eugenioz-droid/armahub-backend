# PROGRAMA — Modelador 3D de Elementos (Templates paramétricos)

**Estado:** DISEÑO (discovery en curso, 08-ago-2026). NO implementar hasta cerrar las decisiones
pendientes (§9). Este documento es la fuente para ejecución continua por un agente.

Relación: expande la fase **M7** de `docs/programa_maestro.md`. Reusa el render 3D validado en la
maqueta `armahub/static/demo/rebar3d.html` (M7.0).

---

## 1. Objetivo

Que el cubicador **describa** un elemento (viga/muro/columna) con pocos parámetros y el sistema
**genere automáticamente todas sus barras**, las muestre en 3D para verificar congestión, y con un
botón las **cargue al despiece** (Fabricator) ya indexadas. Menos errores, mucho más rápido, y
verificado visualmente antes de tabular.

## 2. Concepto central (decidido)

- El motor **genera**, el usuario **describe**. No es CAD, es un generador paramétrico.
- Un **template** = elemento + lista de **componentes** configurables (cabezal, estribo, traba,
  malla…). Cada componente tiene: figura del catálogo (elegible), reglas de cantidad/espaciamiento,
  reglas de posición. Así "muro entre-piso" y "muro superior" son el MISMO template con parámetros
  distintos; cambiar el cabezal de figura 1→3 es cambiar un parámetro, no un template nuevo.
- **Se guarda la RECETA (chica), no el resultado (grande).** Un elemento son ~50-100 barras, pero su
  receta son ~15 parámetros (~1 KB). La posición espacial NO se almacena barra por barra: se DERIVA
  de la receta cuando se necesita el 3D. Cero duplicación de data, cero riesgo de reventar el sistema.

## 3. Arquitectura de datos (decidida)

**Al "Cargar al despiece" se guardan dos cosas:**
1. Las **barras** entran a la tabla `barras` normal, con `origen='template'` y un `template_instancia_id`
   que las agrupa (nueva columna). Siguen el flujo normal: Bar Manager, edición, export a aSa.
2. La **receta** en tabla nueva `elementos_template` (chica): template usado + JSON de parámetros +
   posición del elemento en la obra. NO guarda las barras.

**Comportamiento (resuelve las dudas de trazabilidad):**
- Borrar una barra en el Fabricator → desaparece del despiece; la receta queda como "estado original".
  Se puede RE-GENERAR desde la receta (vuelve completo) o conservar la edición manual.
- Modificar una barra → la edición vive en la barra; la receta es el estado inicial (mismo modelo que
  el CSV vs. edición del Bar Manager, ya probado).
- Ver el 3D de un elemento existente → se re-deriva la geometría desde la receta (el motor recalcula
  posiciones). No se leen posiciones almacenadas.

**Tablas nuevas:**
- `templates_catalogo`: definición de cada template (tipo, componentes, reglas). Editable a futuro.
- `elementos_template`: instancias creadas (receta: template_id, params JSONB, ubicación, obra, autor).
- `barras` gana: `template_instancia_id` (FK nullable), `origen` acepta 'template'.

## 4. El motor de generación (client-side, reusa la maqueta)

Módulo nuevo `static/js/features/modelador/` (JS). Responsabilidades:
- **Reglas por template** (JS puro, sin BD): dada la receta → lista de barras con figura del catálogo
  + dimensiones calculadas + posición 3D. Ej. viga: cabezales sup/inf (longitud = largo - 2·recub),
  estribos (n = largo/espaciamiento, geometría cerrada con gancho 135°), trabas si ancho ≥ umbral.
- **Render 3D del conjunto:** posiciona cada barra sólida en el espacio (técnica de la maqueta:
  cilindros + toros, fusión por barra + InstancedMesh → 5 draw calls). Hormigón semitransparente
  toggleable, órbita/zoom.
- **Radio de doblado:** visual automático por norma (2φ φ≤16, 3.5φ φ>16). NO es parámetro del usuario.
  No afecta el cálculo de kilos (se usa el largo desarrollado ya existente).
- **Ganchos sin superposición:** offset del cierre ~1φ + alternar la esquina del gancho entre estribos
  consecutivos (pulido visual, no bloquea el arranque).

## 5. Integración con el catálogo (decidida)

Cada componente del template referencia figuras EXISTENTES del catálogo (`figuras_catalogo`). El motor
calcula sus dimensiones (A, B, C…) según los parámetros y las mete como barras normales. NO se crean
figuras nuevas; se instancian las del catálogo con dims computadas. Así el export a aSa sale idéntico
al de una barra cubicada a mano.

## 6. Fases de implementación

**F1 — Andamiaje + una viga (MVP):**
- Migración: tablas nuevas + columnas en barras.
- Motor: reglas de UNA viga rectangular (cabezales + estribos + trabas). Catálogo mapeado.
- UI: panel del modelador (form de parámetros + canvas 3D + botón "Cargar al despiece").
- Backend: endpoints crear/leer/regenerar instancia; "cargar" genera las barras en el despiece.

**F2 — Más elementos + robustez:**
- Muro y columna (con sus componentes: mallas, cabezales, distribución).
- Variantes por parámetro (entre-piso vs superior, confinamiento, figura de cabezal elegible).
- Pulido visual de ganchos/trabas.

**F3 — Editor de reglas (futuro):**
- El usuario guarda variantes de template (formulario, sin modelar). Administra sus propios "tipos".

## 7. Lista detallada de tareas (para ejecución por agente)

*Se completa al cerrar §9. Cada tarea llevará: archivos, criterio de aceptación, test.*

### F1 (MVP viga) — borrador de tareas
- T1 [migración] `NNN_modelador.sql`: `templates_catalogo`, `elementos_template`, + `barras.template_instancia_id` + origen 'template'. Idempotente. Semilla: 1 template viga.
- T2 [motor/reglas] `modelador/reglas_viga.js`: params → [barras {figura, dims, pos3d}]. Test headless (node) de conteos y geometría (sin NaN, largos coherentes).
- T3 [motor/3d] `modelador/render3d.js`: adaptar la maqueta a consumir la salida de T2 (posicionar barras del conjunto). Detección de WebGL ausente → mensaje elegante (ver M7 nota).
- T4 [UI] `modelador/panel.js` + tab/sección: form de parámetros (con defaults), canvas, toggle hormigón, contador de barras/kg en vivo.
- T5 [backend] endpoints: POST crear instancia (guarda receta), GET leer, POST regenerar. Auth + scope obra.
- T6 [integración] botón "Cargar al despiece": llama al motor, crea las barras (origen='template', template_instancia_id) en el lote actual del Fabricator. Reusa el guardado de barras existente.
- T7 [catálogo] mapear las figuras que usa la viga (cabezal, estribo, traba) a códigos reales del catálogo; el motor calcula sus dims.
- T8 [tests] test de "cargar al despiece": una viga genera N barras correctas; re-generar da lo mismo; borrar una barra no rompe la receta.
- T9 [docs] actualizar SPECS (puntero) + este doc con lo implementado.

## 8. Riesgos / cuidados
- NO duplicar data: la receta es la fuente, las barras el resultado. La posición se deriva.
- NO romper el export aSa: las barras generadas son figuras del catálogo normales.
- WebGL ausente en algunos equipos (GPU deshabilitada) → mensaje claro, no pantalla en blanco.
- Rendimiento: fusión por barra + InstancedMesh (ya validado: 5 draw calls para una viga completa).
- El motor de reglas debe ser la ÚNICA fuente de la geometría (client-side), para que ver/regenerar
  siempre dé lo mismo.

## 9. DECISIONES PENDIENTES (cerrar antes de codear)
*(Las escribe el usuario; sin esto no se ejecuta F1.)*
1. **Elemento de partida:** ¿viga, muro o columna? (recomendación: viga = caso más rico para probar el motor completo).
2. **¿El modelador es sección nueva o vive dentro del Fabricator (editor de despieces)?** (recomendación: sección/tab propia que al "cargar" inyecta en el despiece activo).
3. **Parámetros de la viga tipo:** lista exacta que define el cubicador (largo, ancho, alto hormigón, recubrimiento, φ long sup/inf, n° barras sup/inf, φ estribo, espaciamiento estribo, ¿confinamiento en extremos?, ¿trabas desde qué ancho?). Se puede partir de un set estándar y ajustar.
4. **Nombre definitivo del editor de despieces** (hoy "Agregar Despiece"; el usuario propuso "Fabricator").
