# Programa de trabajo — Refactor del editor de barras (Bar Manager)

> Objetivo: dejar el editor **confiable** — que el usuario NUNCA dude de si sus
> cambios se guardaron o no. Hoy está enredado: estado esparcido, validación
> duplicada, y re-renders que desincronizan. NO es reescribir de cero: es
> centralizar el estado y unificar la validación. Redactado 2026-07-24.

---

## 1. Diagnóstico de la deuda (verificado en código)

**El editor son ~2000 líneas repartidas en 3 archivos con estado esparcido:**
- `barmanager.js` (1039 líneas): render de tabla/vista plana/agrupada, `lastBarrasPlano`, `detailCache`, búsqueda, paginación.
- `barmanager_edit.js` (610 líneas): `_modoEdicion`, `_cambios`, `_seleccion`, `_modoMasivo`, `_catFiguras`, validación local, guardado, operar columnas.
- `filtros.js` (382 líneas): filtros, `_bmFiltrosSnapshot`, bloqueos.

**Los 3 problemas de raíz (causantes de todos los bugs recientes):**

### 1.1 — Estado esparcido en 3+ lugares que se desincronizan
`_cambios` (ediciones pendientes), `_seleccion` (marcadas), `lastBarrasPlano`/`detailCache` (datos en memoria), y el DOM (values de los inputs). No hay una fuente única de verdad. El render leía del DOM/memoria e ignoraba `_cambios` (ya parcheado con `bmValorEfectivoCelda`, pero es un parche, no la solución estructural).

### 1.2 — Validación de geometría DUPLICADA (frontend + backend)
- Frontend: `_validarFilaLocal` / `bmValidarTodasLasFilas` (barmanager_edit.js) — resalta rojo al instante leyendo `_catFiguras`.
- Backend: `validar_geometria` (catalogo.py) — valida al guardar.
Son **dos implementaciones de la misma regla** que pueden discrepar. Cada cambio de regla obliga a tocar las dos. Fuente de confusión (ej. "cambié figura y sigue pidiendo la anterior").

### 1.3 — Re-renders que pierden/desincronizan estado
Muchas acciones disparan re-render completo (`bmReRenderVistaActual`): marcar todas, togglear masivo, paginar, cambiar figura. Cada re-render reconstruye el HTML desde memoria. Sin el parche de `bmValorEfectivoCelda`, perdía los cambios. El foco del input y el scroll también se pierden en cada re-render.

**Singularidades/malas prácticas detectadas:**
- 25 funciones globales (`global.*`) — superficie enorme, difícil de razonar.
- Optimistic update (`bmActualizarBarraEnMemoria`) actualiza memoria sin re-pedir → puede divergir de la BD si el backend hace algo no reflejado.
- `_valorEfectivo` (operar columnas) y `bmValorEfectivoCelda` (render) hacen casi lo mismo con nombres distintos → duplicación.
- El largo se calcula en 2 lugares (backend `largo_desde_lados` + frontend `bmLargoEfectivo`) → misma regla duplicada.
- Lógica de "0 = vacío" repetida en `_valReal`, `_tiene_valor_real`, `_celdaEdit`, `_normalizarValorCelda`.

---

## 2. Principios del refactor (el norte)

1. **Una sola fuente de verdad del estado de edición.** Un objeto `bmEditState` con `{ cambios, seleccion, modoEdicion, modoMasivo }` y métodos para mutarlo. Nadie toca esas variables directo; todo pasa por el objeto.
2. **El render es una función pura del estado.** `render(barra, estado) → HTML`. Cualquier cambio de estado dispara un re-render que SIEMPRE refleja el estado (ya no hay "cambios pegados en el DOM").
3. **La validación es UNA sola.** Idealmente el backend es la autoridad; el frontend consulta la misma regla (o comparte una tabla de figuras y una única función `validarGeometria` que ambos usen conceptualmente). Eliminar la duplicación `_validarFilaLocal` vs `validar_geometria`.
4. **El largo se calcula en UN solo lugar** (una función `largoDeLados(figura, valores)` compartida conceptualmente front/back).
5. **Helpers únicos** para "0 = vacío" (`esValorReal`), "valor efectivo de celda", "figura usa lado X".

---

## 3. Fases del refactor

### Fase 1 — Centralizar el estado de edición
- Crear `bmEditState` (módulo/objeto) que encapsule `cambios/seleccion/modoEdicion/modoMasivo` + getters/setters + eventos.
- Reemplazar los accesos directos a `_cambios`/`_seleccion`/etc. por el objeto.
- Sin cambiar comportamiento (refactor invisible).

### Fase 2 — Render puro desde el estado
- `bmRenderFila(barra, estado)` que produce el HTML leyendo SIEMPRE el valor efectivo (cambio pendiente o memoria) y el estado de validación. Un solo camino de render.
- Preservar foco + scroll tras re-render (hoy se pierden) para que editar sea fluido.
- Consolidar `_valorEfectivo` + `bmValorEfectivoCelda` en una sola función.

### Fase 3 — Unificar la validación
- Una sola definición de "qué lados/ángulos/radio usa una figura y si la geometría es coherente".
- El frontend valida con la MISMA lógica que el backend (misma tabla de figuras, misma función). Eliminar `_validarFilaLocal` como implementación paralela → que consuma la validación canónica.
- Unificar `largoDeLados` (front/back).

### Fase 4 — Simplificar la superficie y limpiar singularidades
- Reducir las 25 funciones globales a las necesarias (el resto, privadas del módulo).
- Consolidar los helpers de "0=vacío".
- Documentar el árbol de casos de modo masivo (marcar/desmarcar/togglear/operar/paginar) y garantizar que cada uno preserva el estado.

### Fase 5 — Endurecer contra el usuario ("todo lo que puede pasar, pasará")
- Árbol de casos completo: ¿qué pasa si desmarca con cambios? ¿si cambia de página con cambios? ¿si cambia figura en masivo? Cada caso con comportamiento definido y probado.
- Bloqueos donde una combinación sea genuinamente incompatible.
- Mensajes claros que distingan: guardado OK / geometría a corregir / error del servidor.

---

## 4. Riesgos y método

- **Riesgo alto**: es el corazón operativo (usuarios reales cargando/editando). Un bug aquí corrompe data de producción.
- **Método**: refactor por fases, **una fase = un commit verificable**, comportamiento idéntico verificado en cada paso. NO mezclar refactor con features nuevas.
- **Antes de empezar**: capturar el comportamiento actual esperado (una checklist de "esto debe seguir funcionando igual") para no romper nada.
- Idealmente hacerlo en una **sesión dedicada, con calma**, no intercalado con otros fixes urgentes.

---

## 5. Bugs/parches actuales que este refactor debe ABSORBER (dejar de ser parches)

- `bmValorEfectivoCelda` (render coherente) → debe ser parte natural del render puro (Fase 2).
- `bmLargoEfectivo` (largo en front) → unificar con backend (Fase 3).
- `_ajustarLadosAFigura` (auto-limpiar al cambiar figura) → parte de la validación canónica (Fase 3).
- Bloqueo de filtros en edición → ya OK, revisar que siga coherente tras el refactor.
- El 500 al guardar → si persiste, cerrarlo ANTES del refactor (no arrastrar un bug de datos al refactor).

---

## 6. Definición de "listo" (editor filete)

- El usuario edita, marca, desmarca, cambia figura, pagina, opera columnas — y **lo que ve es SIEMPRE lo que se guardará**. Cero sorpresas.
- Guardar es rápido y el mensaje es inequívoco (guardado / a corregir / error).
- Un solo lugar define cada regla (validación, largo, "vacío").
- Ningún usuario duda de si su cambio quedó.
