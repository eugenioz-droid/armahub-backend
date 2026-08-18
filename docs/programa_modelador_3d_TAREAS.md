# PROGRAMA DE TAREAS — Modelador 3D · MVP (F0 motor + F1 3D Template)

**Este documento es el guion EJECUTABLE por un agente.** El diseño y las decisiones están en
`docs/programa_modelador_3d.md` (leerlo primero para el CONTEXTO; este archivo es el QUÉ HACER paso a
paso). Maquetas de referencia visual (calzar con ellas): `static/demo/template3d.html` (modo AJUSTAR,
el que se implementa) y `static/demo/rebar3d.html` (render sólido validado). NO implementar el Colocador
(`colocador.html`) en este MVP — es 2ª entrega.

## Reglas de ejecución (OBLIGATORIAS)
- **Idempotencia BD:** solo migraciones nuevas `armahub/migrations/NNN_*.sql` idempotentes (CREATE TABLE
  IF NOT EXISTS; columnas con DO $$ … EXCEPTION WHEN duplicate_column …). NUNCA tocar/borrar datos.
- **No romper el export aSa:** las barras generadas son figuras del catálogo normales (origen='template');
  NO tocar export.py.
- **No romper el Fabricator:** el 3D Template solo AÑADE barras al lote activo; el flujo existente intacto.
- **Motor client-side = ÚNICA fuente de geometría.** Reusa la técnica de rebar3d.js (cilindros + toros
  tangentes, fusión con BufferGeometryUtils). Detección de WebGL ausente → mensaje claro, no pantalla blanca.
- **Verificar cada pieza:** `python -m py_compile` en cada .py; `node --check` en cada .js nuevo; correr
  los tests nuevos. Al final: arrancar mentalmente el flujo (crear despiece → abrir 3D Template → generar
  → cargar → ver barras en Bar Manager).
- **Commits separados** por tarea (código) y docs. Sin Co-Authored-By. Verificar deploy antes de declarar.

---

## MODELO DE DATOS (contrato — lo comparten motor y backend)

### La RECETA (lo que se guarda; NO las barras)
```json
// elemento_template.params (JSONB)
{
  "tipo": "viga",
  "geometria": { "largo": 600, "ancho": 30, "alto": 60, "recub_sup":4, "recub_inf":4, "recub_lat":3 },  // cm
  "componentes": [
    {
      "tipologia": "CBS", "figura": "103B", "diam": 16, "suf_tipo": "",
      "cara": "sup",                    // sup|inf|lateral
      "recub_override": null,           // cm o null (usa global)
      "dims": { "A": {"modo":"fija","valor":30}, "B": {"modo":"auto"}, "C": {"modo":"fija","valor":30} },
      "angulos": { "a1":45, "a2":45 }, "radio": null,
      "distribucion": {
        "modo": "layered",              // linear|layered|grid|perimeter|points
        // layered:
        "n_capas": 2, "barras_capa": 3, "gap": 4, "sentido": "nucleo"
        // linear: { "path":"eje", "zonas":[{"long":150,"sep":10},{"long":300,"sep":20},{"long":150,"sep":10}], "start_offset":0, "end_offset":0 }
        // grid:   { "at_u":20, "at_v":20, "pattern":"staggered", "stagger":0.5 }
        // perimeter/points: (2ª entrega)
      }
    }
  ]
}
```

### El MOTOR (JS, client-side) — contrato de funciones
```
// modelador/motor_geom.js  (F0)
barraSolida(puntos:Vector3[], diametro:number, material) -> Mesh   // reusa rebar3d: cilindros+toros
radioDobladoNorma(diam) -> number

// modelador/reglas.js  (F0) — el motor genérico de distribución
expandirComponente(comp, geometriaHost) -> Placement[]
  // Placement = { puntos: Vector3[], diam, tipologia, figura, dims, meta:{cara,capa,zona} }
  // Aplica la cadena de distribuidores según comp.distribucion.modo.
distribuidorLinear(base, cfg, host) -> Placement[]
distribuidorLayered(base, cfg, host) -> Placement[]
distribuidorGrid(base, cfg, host) -> Placement[]     // MVP: implementar linear+layered; grid stub para muro (2ª entrega)
figuraAPuntos(figura, dims, host, anchor) -> Vector3[]   // usa la geometría del catálogo (parciales/tramos) + dims

// modelador/generar.js  (F0)
generarViga(receta, catalogo) -> { placements:Placement[], barras:BarraPayload[], resumen:{items,barras,kg} }
  // BarraPayload = shape de ac2Payload para POST /lotes/{id}/barras:
  //   { sector, ciclo, piso, eje, diam, figura, marca, cant, mult, radio, suf_tipo, dim_a..dim_i, ang1..ang4 }
  //   (+ origen:'template' y template_instancia_id que el backend aceptará — T1.1)
  //   NO incluye largo ni peso: el BACKEND los calcula (largo_desde_lados + peso.py + factor obra).
  //   sector/ciclo/eje/piso salen del contexto del lote activo (AC2), no de la receta.
  // El motor SOLO llena los dim_*/ang* que la FIGURA usa (según parciales/angulos del catálogo);
  //   los demás van en 0/vacío para pasar validar_geometria.
  // El kg del resumen (para stats en vivo) se estima en el front con la misma fórmula (peso.py espejo),
  //   pero NO se envía; el valor oficial lo pone el backend al insertar.
estimarLargoYPeso(figura, dims, diam, catalogo) -> {largo, peso}  // SOLO para el stats en vivo del panel
```

### Backend — endpoints nuevos (router `modelador`)
```
POST /templates             body: {nombre, tipo, params, obra?}    -> {id}          # guardar template (biblioteca)
GET  /templates?tipo=&obra= -> {templates:[{id,nombre,tipo,params,obra}]}            # listar (por obra + otras)
GET  /templates/{id}        -> {id,nombre,tipo,params}
POST /elementos/instancia   body: {lote_id, template_id?, params}  -> {id}           # guarda la RECETA en elementos_template (traza)
```
**IMPORTANTE (hallazgo del mapeo técnico):** para INSERTAR las barras generadas NO se crea endpoint
nuevo — se REUSA el existente `POST /lotes/{id}/barras` (lotes.py) que ya el Fabricator usa vía
`ac2Guardar`. El front EXPANDE la receta con el motor JS (F0), arma las barras con el MISMO shape que
`ac2Payload` (sector/ciclo/eje/piso/diam/figura/marca/cant/mult/radio/suf_tipo/dim_*/ang1..4) y las
manda a `POST /lotes/{AC2.loteId}/barras {barras:[...]}`. Así heredan id_unico, peso, estado, origen.
Para marcar origen='template' + template_instancia_id: extender el payload de ac2Payload con esos
campos y que lotes.py::agregar_barras los acepte (ver T1.1). El endpoint /elementos/instancia solo
guarda la RECETA para trazabilidad (opcional en MVP; puede diferirse).

---

## FASE F0 — Motor geométrico genérico (client-side, testeable solo)

**T0.1 [migración]** `armahub/migrations/104_modelador.sql` (primera línea `-- 104 — modelador 3D:
templates + elementos_template + barras.template_instancia_id`). Idempotente:
```sql
CREATE TABLE IF NOT EXISTS templates_catalogo (
  id BIGSERIAL PRIMARY KEY, nombre TEXT NOT NULL, tipo TEXT NOT NULL,
  params JSONB NOT NULL, obra TEXT, creado_por TEXT, fecha TEXT DEFAULT (NOW() AT TIME ZONE 'UTC'));
CREATE TABLE IF NOT EXISTS elementos_template (
  id BIGSERIAL PRIMARY KEY, template_id BIGINT, lote_id BIGINT, params JSONB NOT NULL,
  creado_por TEXT, fecha TEXT DEFAULT (NOW() AT TIME ZONE 'UTC'));
DO $$ BEGIN ALTER TABLE barras ADD COLUMN template_instancia_id BIGINT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_templates_obra ON templates_catalogo (obra, tipo);
```
- `barras.origen` es TEXT libre (sin CHECK) → 'template' sin cambio. Criterio: arranca sin error; tablas
  y columna creadas; barras existentes intactas.

**T0.2 [motor/geom]** `armahub/static/js/features/modelador/motor_geom.js`:
- Portar de `rebar3d.js` el generador de barra sólida con CODOS REALES (cilindros + toros tangentes,
  radio de doblado de norma) + fusión con BufferGeometryUtils. Exponer `MotorGeom.barraSolida(puntos,diam,mat)`.
- Test headless (node + three) `tests/test_motor_geom.js`: geometrías conocidas → sin NaN, nº de vértices
  coherente, el codo existe. (Three se puede stubear o cargar; si no, validar la lógica de puntos sin render.)
- Criterio: node --check OK; test pasa.

**T0.3 [motor/figura]** `modelador/figura_puntos.js`:
- `figuraAPuntos(figura, dims, host, anchor)`: dada una figura del catálogo (sus `parciales`/tramos +
  ángulos) y las dims efectivas, produce la polilínea 3D de esa barra ubicada según `anchor` (cara+recub).
  Reusa la geometría del catálogo (leer del backend o de un dump embebido para el MVP de la viga-semilla).
- Test: figura 103B con A=30,B=592,C=30, ang 45/45 → 4 puntos con las patas correctas; largo = A+B+C.

**T0.4 [motor/reglas]** `modelador/reglas.js` — el EXPANSOR genérico:
- `expandirComponente(comp, host)` que despacha por `comp.distribucion.modo`.
- Implementar **linear** (zonas: por cada zona, n = round(long/sep) con el REDONDEO de ADetailer —
  ver T0.5; genera placements a lo largo del eje) y **layered** (n_capas × barras_capa, apiladas hacia
  el núcleo con gap). `grid`/`perimeter`/`points` = stub que devuelve [] con TODO comentado (2ª entrega).
- Test `tests/test_reglas.js`: una viga-semilla → conteos correctos (estribos por zona, cabezales por capa).

**T0.5 [investigación redondeo]** documentar y aplicar el REDONDEO de cantidad de ADetailer
(longitud÷@ → nº de barras): ¿ceil, round, floor+1? Buscar en el repo si ya existe ese criterio
(importer/lotes); si no, usar `round` y dejar TODO marcado para confirmar con el usuario. Registrar en el doc.

**T0.6 [generar]** `modelador/generar.js`:
- `generarViga(receta)` → expande todos los componentes → placements → convierte cada placement a una
  BarraLogica (marca=tipologia+suf, figura, diam, dims A..I, ang, cant, largo=recalcularLargo, peso=
  fórmula de peso.py replicada en JS). Devuelve {placements, barras, kg}.
- Test: viga-semilla completa → nº de barras y kg plausibles; cada barra con figura/dims válidas.

---

## FASE F1 — 3D Template (UI que USA la viga-semilla + carga al despiece)

**T1.1 [backend]** dos partes:
- (a) `armahub/modelador.py` router NUEVO con: POST /templates, GET /templates?tipo=&obra=,
  GET /templates/{id}, POST /elementos/instancia (guarda receta en elementos_template — trazabilidad,
  opcional). Montar en main.py (root + _api_routers).
- (b) EXTENDER `lotes.py::agregar_barras` + modelo `BarraManual`: agregar campos OPCIONALES
  `origen: str = 'manual'` y `template_instancia_id: int = None`; usarlos en el INSERT (lotes.py:515-533)
  en vez de los literales `'manual'`/NULL. Default = comportamiento actual intacto. Agregar la columna
  `template_instancia_id` a la lista de columnas del INSERT.
- Criterio: py_compile OK; /templates responde 401 sin token (montado); insertar una barra con
  origen='template' la marca como tal; barras manuales normales SIGUEN insertándose igual (test de no-regresión).

**T1.2 [viga-semilla]** cargar una viga-semilla como DATA:
- Una receta viga por defecto (la de la maqueta: cabezales 103B sup/inf, estribo 104D por zonas, traba)
  en `modelador/semilla_viga.js` (o en templates_catalogo vía migración seed). El 3D Template arranca con
  ella para que el usuario ajuste, no construya de cero.

**T1.3 [UI panel]** `armahub/templates/tabs/` (o dentro del modal): implementar el modal del 3D Template
CALCANDO `static/demo/template3d.html` (mismo layout, IDs, textos): panel de componentes colapsables
(N capas, cara radial, dims dinámicas por figura fija/auto, estribo por zonas), canvas 3D, toolbar
(hormigón/cotas/medir/ejes/pan), stats en vivo, acciones (Cargar al despiece / Guardar template /
Regenerar / Cargar template). Reusar la maqueta como base literal.

**T1.4 [UI motor real]** `modelador/panel_3d.js`:
- Cablear el panel al motor (F0): cada cambio de parámetro → regenerar barras → redibujar el 3D →
  actualizar stats y el resumen de barras. Los codos reales, colores por tipología, hormigón toggleable.
- Detección WebGL ausente → mensaje claro (chrome://settings/system…), no pantalla blanca.
- Órbita/zoom/pan (pan con botón MEDIO, sin rotar — arreglar el pan de la maqueta).

**T1.5 [enganche Fabricator]** botón "🧱 3D Template" en la cabecera del Fabricator
(`tabs/agregar_cubicacion2.html`, junto a los botones existentes) que abre el modal, SOLO cuando hay
lote activo (AC2.loteId). Registrar la feature JS nueva en bootstrap.js (patrón data-armahub-feature).
Cargar los scripts del modelador en app.html (?v=cache_bust).

**T1.6 [cargar al despiece]** el botón "Cargar al despiece": requiere lote activo (AC2.loteId; si no
hay, crear uno con POST /lotes primero, como hace ac2CrearLote). El front expande la receta con el motor
→ arma las BarraPayload (shape ac2Payload + origen='template') con sector/ciclo/eje/piso del AC2 →
`_ac2Post('/lotes/'+AC2.loteId+'/barras', {barras:[...], })` (MISMO endpoint que ac2Guardar) →
refresca AC2.barras / recarga el lote. Las barras aparecen en el editor y en el Bar Manager.
- (Opcional) POST /elementos/instancia para guardar la receta como traza.
- Criterio: generar una viga y cargarla crea N barras correctas en el lote (largo/peso calculados por el
  backend); se ven en Bar Manager con origen='template'; el export aSa las trata como barras normales.

**T1.7 [guardar/cargar template]** "Guardar como template" → POST /templates (con obra actual).
"Cargar template" → GET /templates?tipo=viga&obra= (esta obra + otras) → elegir → carga la receta al panel.

**T1.8 [tests + verificación]**
- Tests JS del motor (T0.2/0.4/0.6) pasan.
- Test de integración (headless si se puede, o checklist manual): receta viga → generarViga → N barras;
  POST /elementos/generar inserta; re-generar da lo mismo.
- Deploy + verificación: abrir Fabricator con lote, botón 3D Template, generar, cargar, ver en Bar Manager.

**T1.9 [docs]** actualizar `docs/programa_modelador_3d.md` (marcar F0/F1 hechas + hallazgos: redondeo
ADetailer, decisiones de implementación) y el puntero en SPECS.

---

## DATOS TÉCNICOS EXACTOS (del mapeo del repo — NO re-investigar)

**Tabla `barras` (db.py:119 + migraciones):** PK `id` BIGSERIAL; `id_unico` TEXT único por obra (mig.51).
Columnas relevantes para insertar: id_unico, id_proyecto, sector, piso, ciclo, eje, nombre_plano, diam,
largo_total, mult, cant, cant_total, peso_unitario, peso_total, marca, figura, cod_proyecto,
dim_a..dim_i (9), ang1..ang4 (4), radio, revisada/_por/_fecha, suf_tipo, origen, import_id, lote_id,
estado, fecha_carga, creado_por, editado_por/_fecha. NO existe columna `nombre` ni `largo` sueltos
(son nombre_plano y largo_total). Geometría 3D NO está en barras — vive en figuras_catalogo.geometria.

**Insertar barras = `POST /lotes/{lote_id}/barras`** (lotes.py:453 `agregar_barras`, body `BarrasBatch` de
`BarraManual` lotes.py:89-118). Requiere lote 'borrador' existente. Por barra:
- El BACKEND calcula largo (`largo_desde_lados`: suma de lados que usa la figura, radio NO suma) y peso
  (`peso_unitario_kg(diam mm, largo cm)=7850·π·(diam/2000)²·(largo/100)` × factor_peso de obra). → El
  modelador NO envía largo_total ni peso; SOLO figura + dim_* + ang* + diam + cant + mult.
- Valida con `validar_geometria(cur, figura, dims)`: los dim_* que la figura USA (sus `parciales`)
  deben tener valor; los que NO usa, vacíos; ang: los primeros len(angulos); radio según flag. → El
  motor debe llenar EXACTAMENTE los slots de la figura (leer parciales/angulos/radio del catálogo).
- id_unico = 'M-'+uuid12; cod_proyecto = derivado del diam (diametros.py); estado/origen HARDCODEADOS
  en el INSERT: `origen='manual'`, `estado='borrador'`, `import_id=NULL`.

**Para origen='template' + template_instancia_id (T1.1):** extender `agregar_barras` (lotes.py:515-533)
para aceptar `origen` y `template_instancia_id` OPCIONALES en el body (default 'manual'/NULL), y usarlos
en el INSERT en vez de los literales. Extender el modelo `BarraManual` con esos campos opcionales.
NO cambiar el comportamiento por defecto (barras manuales siguen igual).

**Ángulos — convención aSa:** ~~ángulo INTERNO del vértice = 180 − giro (mig.085)~~. El motor de render usa
el giro real; al PERSISTIR ang1..4 se guarda la convención que ya usa el catálogo/ingreso manual (mismo
criterio que ac2Payload — copiarlo, no reinventar).
**CORREGIDO 17-ago — esto ES FALSO para las figuras del seed.** Lo medido: `figuras_catalogo.angulos`
guarda hoy el **GIRO del doblez**, no el interno (104D = [135,135] es el gancho sísmico de 135°, y así
lo traza `_estriboPerimetral` desde siempre), y el exportador a aSa lo manda **tal cual** como "<135"
sin convertir (`export.py:139-144`). La columna está **MIXTA**: solo las figuras dibujadas en el
DISEÑADOR antes del 14-ago quedaron en INTERNO por la migración 085 (`disenador.js` guardaba 180−giro)
y nadie las reconcilió — se detectan porque `angulos[k] + giro_k = 180`. Esas filas son inertes para el
render (traen `geometria.tramos`, que manda sobre la derivación), pero NO para el export. **La decisión
de convención sigue PENDIENTE del usuario** (unificar a GIRO o a INTERNO); el modo de cerrarla es
contrastar un CSV real de aSa: si el operador espera 135 o 45. Ver la DEF al final de
`docs/programa_modelador_3d.md`. Mientras no se cierre: al persistir ang1..4, copiar el criterio de
ac2Payload — no reinventar.

**Catálogo (catalogo.py):** `get_figura(cur,codigo)→{parciales,angulos,radio}`. `figuras_catalogo.geometria`
JSONB `{dim,tramos:[{lado,giro,sentido}]}` (para render). Tipologías VIGA: CBS/CBS2/CBSn/CBI/CBI2/CBIn/
LT/ES/TRV con sus figuras (catalogo.py:134-142). Para el MVP la viga-semilla usa: CBS/CBI=103A/103B,
ES=104D, TRV=101A.

**Migraciones:** próxima = `104_*.sql`. Primera línea `-- 104 — descripción`. Idempotente:
`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, o
`DO $$ BEGIN ALTER TABLE … ADD COLUMN …; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`.
Se aplica sola al arranque (db.py:1392 _run_migrations, savepoint por migración). `barras.origen` es TEXT
libre (sin CHECK) → acepta 'template' sin migración de constraint.

**Router nuevo (main.py):** import + `app.include_router(mi_router)` (junto a main.py:67-83) + agregar a
`_api_routers` (main.py:86-91) para /api/v1.

**Front:** feature JS nueva → `loadScript(...)` en bootstrap.js (patrón :248-255, data-armahub-feature
único). Shared en app.html:298-313 (ANTES de bootstrap.js). Botón "3D Template" en la cabecera del
Fabricator (agregar_cubicacion2.html:9-24, junto a ac2_guardarBtn), visible solo con AC2.loteId.
Estado: `AC2.loteId/proyecto/barras/sector/ciclo/eje` (agregar_cubicacion2.js:11-31). Insertar barras:
patrón `ac2Guardar` → `_ac2Post('/lotes/'+AC2.loteId+'/barras',{barras:[...ac2Payload]})` (js:1517);
`ac2Payload` (js:1391) arma {sector,ciclo,piso,eje,diam,figura,marca,cant,mult,radio,revisada,suf_tipo,
dim_*,ang1..4}. Three.js: `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js` (on-demand);
BufferGeometryUtils se carga aparte (examples/js/utils/BufferGeometryUtils.js) SOLO si se usa fusión.

## ORDEN de ejecución
F0 completo (T0.1→T0.6) → F1 completo (T1.1→T1.9). De corrido. Al final, reporte de: qué quedó
funcional, qué quedó como TODO/stub (grid/perimeter/points para muro = 2ª entrega), y qué hallazgos
necesitan confirmación del usuario (redondeo ADetailer, cualquier ambigüedad de figura).

## PENDIENTES conocidos (NO bloquean; se afinan después con el usuario)
- Colocador por proyecciones (2ª entrega, maqueta colocador.html lista).
- Modos grid/perimeter/points (muro/columna) — stubs en el MVP.
- Pan con botón medio real; herramientas de medición/cotas finas.
- Multi-radio en figuras (diseño ya documentado; usar 1 radio en el MVP).
