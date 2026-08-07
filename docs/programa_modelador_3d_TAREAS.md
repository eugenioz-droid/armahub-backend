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
generarViga(receta) -> { placements:Placement[], barras:BarraLogica[], kg:number }
  // BarraLogica = campos listos para insertar en `barras` (marca, figura, diam, dims, cant, largo, peso...)
recalcularLargo(figura, dims) -> number   // suma de lados efectivos (reusa criterio del catálogo)
```

### Backend — endpoints nuevos (router `modelador`)
```
POST /templates            body: {nombre, tipo, params}            -> {id}          # guardar template (biblioteca)
GET  /templates?tipo=&obra= -> {templates:[{id,nombre,tipo,params,obra}]}            # listar (por obra + otras)
GET  /templates/{id}        -> {id,nombre,tipo,params}
POST /elementos/generar     body: {lote_id, receta}                 -> {barras_creadas:N, kg}  # EXPANDE la receta e INSERTA barras en el lote (origen='template', template_instancia_id)
  # Reusa la lógica de inserción de barras manuales (misma que lotes.py agregar_barras): id_unico, peso, estado.
```

---

## FASE F0 — Motor geométrico genérico (client-side, testeable solo)

**T0.1 [migración]** `NNN_modelador.sql` (idempotente):
- `templates_catalogo` (id BIGSERIAL PK, nombre TEXT, tipo TEXT, params JSONB, obra TEXT NULL, creado_por, fecha).
- `elementos_template` (id BIGSERIAL PK, template_id BIGINT NULL FK, lote_id BIGINT, params JSONB, creado_por, fecha).
- `barras`: agregar columna `template_instancia_id BIGINT NULL` (DO $$ … EXCEPTION duplicate_column …).
- `barras.origen` ya es TEXT libre → acepta 'template' sin cambio de constraint (VERIFICAR: si hay CHECK, ampliarlo).
- Criterio: arranca sin error; tablas creadas; columna añadida. Sin tocar datos.

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

**T1.1 [backend router]** `armahub/modelador.py` (nuevo router):
- Endpoints POST /templates, GET /templates, GET /templates/{id}, POST /elementos/generar (contrato arriba).
- `/elementos/generar`: recibe {lote_id, receta}; NO genera geometría en el server — recibe del front la
  lista de barras ya expandida (el motor es client-side) O expande en server con una versión Python del
  expansor. DECISIÓN DE IMPLEMENTACIÓN: para el MVP, el FRONT expande (reusa el motor JS) y manda las
  BarraLogica; el endpoint solo las INSERTA en el lote reusando la lógica de lotes.py::agregar_barras
  (mismo id_unico, peso, estado, origen='template', template_instancia_id). Guardar la receta en
  elementos_template.
- Montar el router en main.py (root + /api/v1), patrón del repo.
- Criterio: py_compile OK; endpoints responden 401 sin token (montados); con token, insertan barras.

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

**T1.6 [cargar al despiece]** el botón "Cargar al despiece": el front expande la receta con el motor →
manda las BarraLogica a POST /elementos/generar con el lote_id activo → refresca las barras del
Fabricator (AC2.barras). Las barras aparecen en el editor y en el Bar Manager (origen='template').
- Criterio: generar una viga y cargarla crea N barras correctas en el lote; se ven en Bar Manager;
  el export aSa las trata como barras normales.

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

## ORDEN de ejecución
F0 completo (T0.1→T0.6) → F1 completo (T1.1→T1.9). De corrido. Al final, reporte de: qué quedó
funcional, qué quedó como TODO/stub (grid/perimeter/points para muro = 2ª entrega), y qué hallazgos
necesitan confirmación del usuario (redondeo ADetailer, cualquier ambigüedad de figura).

## PENDIENTES conocidos (NO bloquean; se afinan después con el usuario)
- Colocador por proyecciones (2ª entrega, maqueta colocador.html lista).
- Modos grid/perimeter/points (muro/columna) — stubs en el MVP.
- Pan con botón medio real; herramientas de medición/cotas finas.
- Multi-radio en figuras (diseño ya documentado; usar 1 radio en el MVP).
