# Programa: "Agregar Cubicación" — Ingreso manual de barras + rediseños de fondo

**Estado:** PLANIFICACIÓN APROBADA en concepto (2026-07-28). Pendiente OK final del programa
escrito antes de codear. Producción activa → todo aditivo, nunca borrar/perder data.

**Tab:** "Agregar Cubicación" (dice qué hace). **Título de sección:** "Formulario de Cubicación".

---

## 0. Filosofía (leer antes de implementar)

- **Rediseñar, no parchar.** Donde el modelo actual tiene una brecha, se corrige el MODELO
  (invariante), no se agrega un `if` puntual.
- **Producción:** migraciones idempotentes y ADITIVAS (nunca DROP de columna/tabla con data).
  Ningún cambio de estado borra barras. Ediciones preservan procedencia.
- **Reciclar el motor.** El formulario de creación es el mismo núcleo que a futuro usará el
  cliente para pedidos (`origen='pedido'`) — se diseña con `origen` + `estado` + `lote` desde
  el día 1. Ver [[project-armahub-pedidos-cliente]] / `docs/programa_pedidos_cliente.md`.
- Reutilizar lo existente: modelo `barras`, `_calcular_peso`, `sectores-nav`, el motor de
  render `disenadorMotor.dibujarFigura`, la UI del Bar Manager como referencia.

---

## 1. Conceptos y vocabulario

| Concepto | Técnico | UI (para el cubicador) |
|---|---|---|
| Tanda de barras ingresadas juntas manualmente | `lote_id` (gemelo de `import_id` del CSV) | "Planilla" / "Ingreso" (DECIDIR) |
| Canal de origen de la barra | `origen` = `csv` \| `manual` \| `pedido` | (badge "manual") |
| Estado del lote | `lote.estado` = `borrador` \| `terminada` | "En edición" / "Terminada" |
| Estado del sector constructivo | entidad nueva `sector_estado` (ver §3) | color matriz: pendiente/exportado/modificado |

**Sector constructivo** = combinación `(sector, piso, ciclo)`. `sector` es el elemento
constructivo (FUND/ELEV/LCIELO/VCIELO). Hoy NO es entidad; se rediseña (§3).

---

## 2. Rediseño A — Canales de datos independientes (invariante)

**Brecha actual:** el import CSV borra por `(eje,piso,ciclo)` o `plano_code` sin mirar `origen`
(`importer.py:654-684`), y el UPSERT fija `origen='csv'` (`importer.py:706`). → una barra manual
en un sector reimportado **se borra sin retorno**. Nada la protege.

**Rediseño (no fix):** establecer el invariante *"cada canal solo tiene autoridad sobre sus
propias barras"*.
- La importación CSV opera SOLO sobre `origen='csv'`: sus DELETE de reemplazo llevan
  `AND origen = 'csv'` (o `AND (origen IS NULL OR origen='csv')` por la data legada sin origen).
- Se centraliza en UNA función/guardia (no repetir el filtro en cada DELETE) para que cualquier
  operación de import futura respete el invariante por diseño.
- El UPSERT de import nunca cambia el `origen` de una barra existente de otro canal (de hecho no
  debería tocarla: distinto `id_unico` por el prefijo, ver §5).

**Efecto:** barras `manual` y `pedido` sobreviven SIEMPRE a cualquier reimport. Sin parches.

**Aviso en preview de reimport (transparencia):** el preview (`/import/armadetailer/preview`)
informa "en estos sectores hay N barras manuales/pedido que se conservarán" (no las borra;
solo avisa). Cuenta por `origen IN ('manual','pedido')`, distinto del actual conteo por
`editado_por`.

---

## 3. Rediseño B — Estado del sector constructivo como entidad real

**Brecha actual (confirmada en código):**
1. El sector NO existe como entidad; nace solo al exportar (`export_log`). Un sector
   nunca-exportado no es consultable como "pendiente" salvo derivándolo.
2. El dirty-flag verde/rojo = `MAX(barras.fecha_carga) > MAX(export_log.fecha)`, evaluado en el
   navegador (`exportacion.js:193`, `obras.js:577`). Es un hack por fechas.
3. **`editar_barra` NO actualiza `fecha_carga`** (`barras.py:1434-1435` solo setea editado_por/
   fecha) → **editar una barra NO marca el sector como modificado**. En producción, un sector
   exportado que se edita sigue mostrándose VERDE (mentira de "al día"). Brecha real.
4. El "completado" de la matriz muerta vivía en `localStorage` (no persistente).

**Rediseño (Opción B, aditivo y en paralelo):**
- Nueva tabla **`sector_estado`** (migración ≥ 086):
  `id, id_proyecto, sector, piso, ciclo, estado, actualizado_fecha, actualizado_por,
   exportado_fecha, modificado_fecha`.
  - `estado` ∈ `pendiente` (nunca exportado) · `exportado` (al día) · `modificado`
    (cambió después de exportar → rojo).
  - UNIQUE `(id_proyecto, sector, piso, ciclo)`.
- **Eventos que actualizan el estado** (centralizado en un helper `marcar_sector_*`):
  - Crear barra (manual/import) en un sector → si estaba `exportado`, pasa a `modificado`;
    si no existía, `pendiente`.
  - **Editar barra** (Bar Manager o donde sea) → sector a `modificado` (cierra la brecha #3).
  - Eliminar barra → sector a `modificado`.
  - Reimport que cambia contenido del sector → `modificado`.
  - Exportar sector → `exportado` + `exportado_fecha` (además del INSERT en `export_log` que se
    conserva para el histórico/kilos).
- **Migración de datos:** poblar `sector_estado` desde `DISTINCT(sector,piso,ciclo)` de `barras`
  y el estado inicial derivado del mecanismo viejo (comparar `export_log` vs `fecha_carga`), para
  no perder el estado actual.
- **Estrategia en paralelo (producción):** el mecanismo viejo (resta de fechas) se MANTIENE hasta
  que el nuevo esté verificado; los lectores (`export-history`, `exportacion.js`, `obras.js`)
  migran a leer `sector_estado`. Se elimina el hack de fechas SOLO cuando el nuevo esté probado.

**Nota:** `version_mod`/`version_exp` son columnas MUERTAS (solo las llena el CSV, nadie las lee).
No se usan; se dejan quietas (no se borran, data en producción) pero no forman parte del diseño.

---

## 4. Rediseño C — Lote de ingreso manual (`lote_id`)

Trazabilidad de la tanda (provenance), gemelo del `import_id`.
- Nueva tabla **`lotes`** (o reusar `imports` con `tipo='manual'` — DECIDIR en §9): `id,
  id_proyecto, tipo='manual', estado (borrador|terminada), creado_por, creado_fecha,
  terminado_fecha, n_barras`.
- Cada barra creada en "Agregar Cubicación" lleva su `lote_id` (nueva columna en `barras`,
  aditiva, NULL para CSV).
- **Estado del lote:**
  - `borrador`: el cubicador arma la tanda (barras editables en el formulario).
  - `terminada`: el cubicador marca la tanda como lista → BLOQUEO. Las barras pasan a editarse
    SOLO desde Bar Manager (§7). El lote no se vuelve a tocar desde el formulario.
- El `lote_id` NO afecta la agrupación constructiva (las barras se reparten por su ubicación al
  exportar); es solo procedencia/auditoría.

---

## 5. Backend — Creación de barras (rediseño del andamiaje deshabilitado)

Hoy `POST /barras/crear` responde 403 (`barras.py:1502`). Se rehabilita como parte del modelo
de canales (no como endpoint suelto).

- **`id_unico` manual:** misma estructura que el de lámina (que viene del CSV) + **letra prefijo**
  para marcar "creado en plataforma" (ej. `M-<...>`). Garantiza no colisión con `id_unico` del
  CSV (el ON CONFLICT del import es por `(id_unico, id_proyecto)` → nunca choca). DECIDIR la
  estructura exacta del correlativo en §9.
- Setear: `origen='manual'`, `import_id=NULL`, `lote_id=<lote>`, `fecha_carga=now`,
  `editado_por=user`, `peso_unitario/peso_total` con `_calcular_peso` × cant × factor_obra (§8).
- Ampliar el modelo de entrada con: ubicación (proyecto/sector/piso/ciclo/eje), `figura`,
  `dim_a..dim_i`, `ang1..ang4`, `radio`, `diam`, `cant`, `mult`, `cant_total`, `marca`.
- **`largo_total` AUTOMÁTICO:** suma de las dimensiones parciales de la figura (A+B+C…). El radio
  NO se suma. Sin desarrollo real de dobleces por ahora. **Hook para futuro:** dejar el cálculo
  del largo en una función aislada (`_largo_desde_figura`) para poder ampliar a barras
  redondas/estribos circulares/figuras raras sin tocar el resto.
- **Endpoint de lote:** crear/cerrar lote (`POST /lotes`, `POST /lotes/{id}/terminar`), y
  `POST /barras/crear` (o `/lotes/{id}/barras`) que inserta 1..N barras de la tanda.
- **Crear-lote (masivo):** insertar varias barras de una (la grilla manda un array). Transacción:
  o entran todas o ninguna.
- **Permisos:** cualquier cubicador crea en cualquier proyecto (revisar set completo después).
  Validado en backend, no solo frontend.
- **Validaciones:** diam en lista estándar, cant>0, ubicación mínima (proyecto+sector+piso+ciclo),
  figura válida del catálogo. Nunca crea en `origen != 'manual'`.

---

## 6. Frontend — Formulario de Cubicación (grilla)

Tab nuevo entre **Bar Manager** y **Pedidos** (lado derecho). Sub-tab en Cubicación.

### 6.1 Grilla estilo planilla
- **Filas = barras** (1 fila = 1 etiqueta/grupo de barras con su `mult` y `cant`).
- **Navegación matricial con flechas** (↑↓←→ entre celdas, Enter = siguiente fila/crear).
- **Pegar desde Excel** (bloque tabular → filas mapeadas). Alta prioridad (el cubicador tiene
  listas en Excel).
- **Copiar fila hacia abajo** (Ctrl+D / arrastrar) para repetir valores en columna.
- **Fila plantilla** fija arriba: defaults (ubicación/figura/diam) que se heredan al crear.

### 6.2 Tres modos de vista (el punto clave del usuario)
- **Agrupar:** colapsable por elemento constructivo (como Bar Manager).
- **Filtro plano:** lista sin agrupar.
- **Agrupación visual (simple):** TODAS las barras visibles, pintadas/separadas por bandas de
  color por elemento (eje/losa/fund) SIN colapsar. Resuelve "agregar una MH en 2 ejes sin
  desagrupar". El usuario puede agregar barras por agrupación.

### 6.3 Ubicación en cascada + control de calidad de datos (ejes parecidos)
Proyecto → Piso → Ciclo → Sector(elemento) → Eje. Dropdowns autopoblados con lo existente
(`sectores-nav`) + opción "＋ nuevo".
- **NO bloquear la creación** de una ubicación nueva (el cubicador manda; puede necesitar "Eje A'").
- **Autocompletar agresivo con filtro de texto** → previene el 90% de duplicados (el usuario
  elige el existente en vez de recrearlo).
- **Advertencia SUAVE (no bloqueo)** al escribir un nombre similar a uno existente (distancia de
  edición sobre versión normalizada: trim + colapsar espacios + minúsculas): "Existe 'Eje A'.
  ¿Es ese o uno nuevo?". Nunca fusionar automático.
- **Guardar el texto TAL CUAL** lo escribió el usuario (con apóstrofe/tildes); normalizar SOLO
  para comparar/advertir. El apóstrofe importa en la identidad real.
- **Herramienta de merge posterior** (posproceso, fase aparte): vista que agrupa ejes
  sospechosamente parecidos y permite fusionar manualmente ("Eje 1"/"EJE 1" → unificar). Es la
  cura correcta; no se previene el 100%, se da la herramienta.

### 6.4 Figura + dimensiones dinámicas + render
- Selector de figura del catálogo → el form pide SOLO las dims que esa figura usa (parciales,
  ángulos, radio).
- **Render en vivo** con `disenadorMotor.dibujarFigura`, AJUSTADO a las medidas que ingresa el
  usuario (escala real).
- **Toggle de renders** (apagar para ver más barras a la vez).

### 6.5 Otros campos
- Diámetro: lista fija estándar (8,10,12,16,18,22,25,28,32,36 mm — confirmado, no ampliar ahora).
- Marca: filtro de texto sobre marcas existentes (limitar variaciones; incorporar nueva es acción
  aparte). No autoincrementa.
- Cantidad: `cant` + `mult` (multiplicador para doble/triple malla). `cant_total` derivado.
- **Peso en vivo** (con factor de obra §8) antes de guardar.

### 6.6 Replicar en pisos
Botón "Replicar" → modal con selección de pisos destino. Copia la barra TAL CUAL a los pisos
elegidos, pero **queda en el formulario** (preview editable) para que el usuario reasigne/modifique
antes de confirmar. Al confirmar, se crean las barras y se reparten en sus agrupaciones. Evita
asignar el piso a mano.

### 6.7 Guardar
- "Guardar y crear otra" (mantiene ubicación).
- Terminar lote → bloqueo (§4).

---

## 7. Bar Manager — integración

- **Badge + filtro** de barras `origen='manual'` (la columna existe, filtros ya la respetan).
  Se pueden ver separadas o integradas en la agrupación estándar.
- **Edición de barras `terminada`:** SOLO desde Bar Manager (el formulario no las toca tras
  cerrar el lote). Separación por responsabilidad: formulario = alta masiva; Bar Manager =
  corrección puntual. Mismo motor, permiso distinto por estado.
- **Procedencia se preserva SIEMPRE:** editar desde Bar Manager conserva `origen='manual'` +
  `lote_id`; suma `editado_por/editado_fecha`. La barra "nació manual en tal lote, editada por X".
- Editar cualquier barra → marca el sector `modificado` (§3, evento de edición).
- **En "Agregar Cubicación" NUNCA se editan barras `origen != 'manual'`** (ni CSV ni pedido).
  Validado en backend.

---

## 8. Config de peso por obra

- **Factor global por obra** aplicado al peso teórico (`_calcular_peso`). Default **0%** (no
  altera nada hoy). Se activa cuando el usuario quiera (ej. +1% de norma).
- Persistir por proyecto (columna en `proyectos` o tabla de config por obra — DECIDIR §9).
- El peso teórico base ya es densidad 7850 kg/m³ × área × largo (`barras.py:1297`). El factor
  multiplica ese resultado.
- Aplica en creación manual y (a definir) en el recálculo del Bar Manager.

---

## 9. Limpieza

- **Borrar la tercera matriz muerta** (confirmado sin uso, no enlazada en navegación):
  `dashboards.js`, `tabs/dashboards.html`, y las 3 líneas no-op de `filtros.js:200-202`
  (`matrizProyectoFilter`/`sectorProyectoFilter`/`navProyectoFilter`). Los endpoints
  `/dashboard/sectores` y `/proyectos/{id}/sectores-nav` SE CONSERVAN (los usan las 2 matrices
  vivas). Cero riesgo: el renderizador no está en el DOM ni se carga.

---

## 10. Decisiones abiertas (para zanjar al aprobar, NO bloquean el diseño)

1. **Nombre UI del lote:** "Planilla" / "Ingreso" / "Tanda" / "Carga". (Técnico: `lote_id`.)
2. **`lotes` tabla nueva vs reusar `imports` con `tipo='manual'`:** inclina a tabla `lotes`
   propia (semántica distinta; `imports` es para CSV). Confirmar.
3. **Estructura exacta del `id_unico` manual:** prefijo + ¿correlativo por proyecto (`M-<proj>-001`)
   o derivado del patrón de lámina? Confirmar formato.
4. **Config de peso:** columna `factor_peso` en `proyectos` vs tabla `config_obra`. Inclina a
   columna simple en `proyectos` (un solo factor). Confirmar.
5. **`sector_estado`:** ¿tabla nueva (recomendado) o vista materializada? Tabla nueva por control.

---

## 11. Orden de implementación (fases)

**F1 — Rediseños de fondo (backend + migraciones), lo más crítico primero:**
- Invariante de canales (§2) + aviso en preview reimport.
- Entidad `sector_estado` (§3) + eventos + migración de datos + lectores en paralelo.
- Tabla `lotes` + `lote_id` en barras (§4).

**F2 — Backend creación (§5):** endpoints de lote y creación (individual + masivo), largo auto,
permisos, validaciones, factor de peso (§8).

**F3 — Frontend grilla (§6):** tab, 3 modos de vista, ubicación+autocompletar+advertencia,
figura+dims+render, peso vivo, navegación matricial, pegar-Excel, replicar, guardar/terminar.

**F4 — Bar Manager (§7):** badge + filtro manual, edición por estado, evento de sector.

**F5 — Limpieza (§9):** borrar tercera matriz.

**F6 — Merge de ejes parecidos (§6.3):** herramienta de posproceso (fase aparte, no bloqueante).

**Garantías transversales:** cada migración idempotente/aditiva; verificar (py_compile, balance
JS, no romper Bar Manager/import/export); nunca borrar barras; procedencia preservada.
