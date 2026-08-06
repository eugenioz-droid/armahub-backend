# Programa de trabajo — Flujo por etapas del editor de despieces

**Objetivo:** eliminar la ambigüedad del editor (hoy muestra todas las herramientas aunque no haya
nada abierto) mediante **revelación progresiva**: una sola pantalla que revela capas según la etapa.
Aprovecha el espacio vacío para una landing de obras con despieces + un gráfico de kilos que sigue la
navegación. **Regla de oro: no se elimina ni re-cablea ningún control existente; solo se controla su
VISIBILIDAD por etapa.** El look no cambia (mismo design system). Maqueta aprobada 2026-08-06.

Archivos: `templates/tabs/agregar_cubicacion2.html` + `static/js/features/cubicacion/agregar_cubicacion2.js`.

---

## Modelo: "estado de etapa"

Una variable `AC2.etapa` deriva de estado ya existente (no inventa fuentes de verdad):

| Etapa | Condición (derivada de estado actual) | Qué se muestra |
|---|---|---|
| **0** landing | sin obra (`!AC2.proyecto`) | buscador obra + gráfico (todas las obras) + lista obras con despieces activos |
| **1** obra sin despiece | obra elegida, sin lote abierto (`AC2.proyecto && !AC2.loteId`) | ← volver · gráfico (esa obra) · botón Crear despiece · histórico protagonista |
| **2** creando (ctx) | presionó "Crear despiece" (flag `AC2.creando`), aún sin ciclo/eje completos | + fila Ciclo/Eje + Config obra |
| **3** ctx listo | ciclo+eje completos, aún sin lote creado | + Sector/Estructura |
| **4** editor | lote abierto/creado (`AC2.loteId`) | editor completo · gráfico OCULTO · ✕ vuelve a etapa 1 |

`AC2.etapa` es una función `ac2Etapa()` que devuelve 0-4 leyendo `AC2.proyecto/loteId/creando/ciclo/eje`.
Un único `ac2AplicarEtapa()` muestra/oculta los bloques según `ac2Etapa()`. Se llama donde hoy ya se
llama `ac2ActualizarCabecera()` (elegir obra, crear/retomar/descartar lote, corregir contexto).

---

## Mapa de bloques → etapa que los muestra (IDs REALES, ya existen)

| Bloque | ID(s) | Etapas visibles |
|---|---|---|
| Buscador obra (fila `.ctx`, campo obra) | `ac2_obra` + datalist | 0, 1 (como buscador); en 2-4 el campo obra se OCULTA (obra en título) |
| Gráfico kilos (NUEVO) | `ac2_grafico` (nuevo div) | 0, 1, 2, 3 · OCULTO en 4 |
| Lista obras con despieces (NUEVO) | `ac2_landingObras` (nuevo div) | 0 |
| Botón "Crear despiece" (landing) | reusar/nuevo `ac2_crearDespieceBtn` | 1 |
| Fila Ciclo/Eje | `ac2_ciclo`, `ac2_eje`, `ac2_crearLoteBtn` | 2, 3, 4 |
| Config obra | botón ⚙ existente | 2, 3, 4 |
| Corregir eje/ciclo | `ac2_reasignarBtn` y familia | 4 (solo borrador con barras, como hoy) |
| Sector/Estructura | `ac2_sectorChips`, `ac2_estructChips`, `ac2_sectorLock` | 3, 4 |
| Tipologías | `ac2_subtabs` | 4 |
| Toolbar (barra/barrasM/pisos/masiva/orden/mult/render) | fila 3 (102-147) | 4 |
| Barra acciones masivas | `ac2_masivaBar` | 4 (al activar masiva, como hoy) |
| Grilla | `ac2_grid` | 4 |
| Rollup validación | `ac2_revcount`, `ac2_rollup` | 4 |
| Botones estado (🚩💾✕🗑) | `ac2_bandera`, `ac2_guardarBtn`, `ac2_descartarBtn`, `ac2_eliminarBtn` | 4 (según estado lote, como hoy) |
| Histórico despieces | `ac2_lotesBody` + `ac2_verEliminados` | 1 (protagonista), 4 (abajo, como hoy) |
| ← Volver a obras (NUEVO) | `ac2_volverObras` (nuevo, a la DERECHA del título) | 1, 2, 3 |
| Título obra | `<h3>` (nuevo binding al nombre) | 1-4 (nombre de obra); 0 = genérico |

**NADA de la etapa 4 cambia su cableado.** `ac2AplicarEtapa` solo togglea `display` de contenedores.

---

## Piezas NUEVAS (lo único que se construye)

1. **`ac2_grafico`** — div con un `<canvas>`. Reusa el componente Chart.js del Hub ("Cubicado semana").
   Datos: endpoint de kilos por cubicador/día de la semana. Etapa 0 = todas las obras; etapa 1 = filtrado
   por `AC2.proyecto`. **Solo kilos con bandera (terminados)** — coherente con "borrador no existe".
   → Requiere endpoint (o parámetro `proyecto` opcional en el que ya alimenta el Hub). Ver Fase B.

2. **`ac2_landingObras`** — tabla de obras con despieces activos + KPIs por fila (items/barras/kg-listos/
   último). Al click en una fila: setea la obra (rellena `ac2_obra` como hoy) → pasa a etapa 1.
   → Requiere endpoint "obras con despieces activos + KPIs". Ver Fase B.

3. **`ac2_volverObras`** — botón que limpia la obra (vuelve a etapa 0). Reusa `_ac2ResetTanda` + limpiar
   obra. A la derecha del título (`flex:1` empuja).

4. **`ac2_crearDespieceBtn`** (etapa 1) — botón que setea `AC2.creando=true` → etapa 2. La ✕/volver
   revierte `creando`.

5. **`ac2Etapa()` + `ac2AplicarEtapa()`** — la lógica de visibilidad. Único cambio de comportamiento.

---

## Orden de implementación (por sub-etapas, sin romper el editor)

**Fase A — Andamiaje de visibilidad (sin datos nuevos).** Implementar `ac2Etapa()`/`ac2AplicarEtapa()`
y el toggle de bloques. La landing y el gráfico quedan como placeholders vacíos. El editor (etapa 4)
debe seguir funcionando IDÉNTICO. Se prueba: elegir obra → etapa 1; crear → 2 → 3 → 4; ✕ → 1; volver → 0.
Es el corazón y el de mayor riesgo → se prueba a fondo antes de seguir.

**Fase B — Datos de la landing.** Endpoint(s): (b1) obras con despieces activos + KPIs; (b2) kilos por
cubicador/día con filtro `proyecto` opcional (para el gráfico). Cablear `ac2_landingObras` y `ac2_grafico`.

**Fase C — Pulido.** Título con nombre de obra, transiciones suaves de mostrar/ocultar, estados vacíos
("no hay obras con despieces activos"), responsive.

---

## Riesgos / cuidados

- **No romper el editor (etapa 4):** todo su cableado queda intacto; `ac2AplicarEtapa` solo togglea
  display. Verificar que ocultar/mostrar no dispare re-render que pierda estado.
- **La ✕ del editor** ya vuelve al estado sin lote (etapa 1) vía `_ac2ResetTanda` — reusar, no duplicar.
- **Corregir eje/ciclo, botones de estado, masiva:** su visibilidad SIGUE gobernada por
  `ac2ActualizarCabecera` (estado del lote), no por la etapa. La etapa solo decide si el BLOQUE editor
  se muestra; dentro, la lógica fina es la de hoy.
- **Gráfico solo kilos terminados** (bandera) — usar el filtro `estado IS DISTINCT FROM 'borrador'`.
- **Reusar, no reinventar:** buscador_obra.js, histórico (`ac2CargarLotes`), componente Chart.js del Hub.

Ver [[project_armahub_agregar_cubicacion]], maqueta aprobada (artifact flujo por etapas).
