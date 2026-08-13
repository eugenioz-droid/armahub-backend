# PROGRAMA — Sistema de Modelado 3D y Templates de Elementos

**Estado:** DISEÑO + **MVP F0/F1 IMPLEMENTADO** (08-ago-2026). Documento fuente. Ver §IMPL abajo para
lo que quedó construido y los hallazgos de la ejecución.

## §IMPL — Estado de implementación (MVP F0+F1, ejecutado de corrido)

**HECHO y verificado (tests headless + py_compile/node --check):**
- **F0 motor genérico (client-side, `armahub/static/js/features/modelador/`):**
  - `motor_geom.js` — barra sólida (cilindros + toros tangentes con radio de doblado de norma; portado
    de rebar3d). Lógica de dobleces testeable sin THREE. Test `tests/test_motor_geom.js`.
  - `figura_puntos.js` — figura+dims+anchor → polilínea 3D (cabezal longitudinal / estribo perimetral /
    traba). Test `tests/test_figura_puntos.js`.
  - `reglas.js` — EXPANSOR genérico de distribuidores: **linear** (estribos por zonas) + **layered**
    (cabezales en capas). `grid`/`perimeter`/`points` = **STUB** (devuelven []; 2ª entrega muro/columna).
    Redondeo de cantidad centralizado. Test `tests/test_reglas.js`.
  - `generar.js` — `generarViga(receta,ctx)` → placements → BarraPayload (shape ac2, SIN largo/peso: los
    calcula el backend), agrupa por item/etiqueta (capas iguales → 1 etiqueta ×N), estima kg (espejo
    peso.py) solo para stats. Test `tests/test_generar.js` (viga-semilla → 4 items / 70 barras / ~139 kg).
- **F1 3D Template (modo AJUSTAR):**
  - `semilla_viga.js` — viga-semilla como DATA (CBS 103B ø16 2capas×3, CBI 101A ø18 1×4, ES 104D ø8 por
    3 zonas, TRV 101A ø8 lineal).
  - `panel_3d.js` + modal `armahub/templates/tabs/modelador3d_modal.html` (calca `static/demo/template3d.html`,
    IDs `m3d_`): panel de componentes colapsables (φ/cara radial/dims fija-auto/capas/zonas), canvas 3D
    (Three.js on-demand por CDN), toolbar (hormigón/tema/rotar eje), stats + resumen en vivo, pan con
    botón MEDIO, mensaje claro si falta WebGL. Acciones: Cargar al despiece / Guardar template /
    Regenerar / Cargar template.
  - Botón **"🧱 3D Template"** en la cabecera del Fabricator (`agregar_cubicacion2.html`), visible solo
    con lote BORRADOR activo; registrado en `bootstrap.js`; modal incluido en `app.html`.
  - **Backend** (`armahub/modelador.py`, montado en `main.py` root + /api/v1): `POST /templates`,
    `GET /templates?tipo=&obra=`, `GET /templates/{id}`, `POST /elementos/instancia` (traza opcional).
    Migración **104_modelador.sql** (templates_catalogo + elementos_template + barras.template_instancia_id),
    idempotente. `lotes.py::agregar_barras` + modelo `BarraManual` extendidos con `origen`/
    `template_instancia_id` OPCIONALES (default 'manual'/NULL → comportamiento actual intacto). Las barras
    del template se insertan por el endpoint EXISTENTE `POST /lotes/{id}/barras` (no hay endpoint nuevo de
    inserción). Test no-regresión `tests/test_modelador_backend.py` + integración `tests/test_integracion_modelador.js`.

**Flujo funcional end-to-end:** Fabricator con lote borrador → botón "🧱 3D Template" → modal con la
viga-semilla → ajustar (largo/recub/φ/dims/zonas/capas) → 3D + resumen en vivo → "Cargar al despiece" →
las barras entran al lote (origen='template', backend calcula largo/peso) → se ven en el editor y en el
Bar Manager → el export aSa las trata como barras normales.

**STUB / 2ª entrega (NO en el MVP):** modos grid/perimeter/points (muro/columna); Colocador por
proyecciones; multi-radio real; homologación del render 2D; herramientas finas de medición/cotas.

**REGLA DE ARQUITECTURA (usuario 08-ago) — el PISO es del USO, no del TEMPLATE:** el 3D Template (USAR
el template para generar barras en un despiece concreto) SÍ pide piso — es correcto, la barra necesita
piso. Pero el TEMPLATE EDITOR (CREAR el template, el Colocador, 2ª entrega) NO debe tener piso: un
template es genérico/reutilizable en cualquier piso/obra. Ponerle piso ahí lo amarraría a un caso y
rompería la reutilización. → Al construir el Colocador, NO meter piso. Pendiente revisar: al cargar al
despiece, que ningún piso quede fuera si la viga abarca varios (hoy pide 1 piso, default=sector).

**REDONDEO estribos RESUELTO (08-ago):** ceil(L/@)+1 = espejo exacto de ArmaPilot
(python/bar_model.py::calc_line_count + lisp ARM-FLUJOS-CALC-LINE-COUNT). "Cerrar el intervalo, @ o
menos". Verificado contra el repo Arma Pilot real. Ya aplicado en reglas.js::redondeoCantidadZona.

**HALLAZGO T0.5 — redondeo de cantidad de estribos (PENDIENTE confirmar con el usuario):** se buscó en
el repo (importer/lotes/front) y **NO existe** ninguna derivación "cantidad desde el espaciamiento": el
importador recibe la cantidad ya calculada del CSV de ADetailer y el ingreso manual la escribe a mano.
No hay criterio previo que copiar. Se usó el DEFAULT `round(L/@)` (igual que la maqueta), **centralizado
en `reglas.js::redondeoCantidadZona` con un flag `MODO_REDONDEO`** para que confirmar el criterio EXACTO
de ADetailer sea un cambio de una línea. Alternativas frecuentes: `ceil(L/@)+1` (postes de cerca) o
`floor(L/@)+1`. **Acción usuario:** confirmar cuál usa ADetailer.

---

**Estado (diseño original):** DISEÑO / DISCOVERY (08-ago-2026). Barrido completo de requerimientos. NO
implementar hasta cerrar decisiones abiertas (§13). Documento fuente para ejecución continua por agente.

Expande la fase **M7** de `docs/programa_maestro.md`. Reusa el render sólido validado en
`static/demo/rebar3d.html` (M7.0).

**Terminología acordada (usuario, 08-ago):**
- **Fabricator** = el editor/creador de despieces ACTUAL (hoy tab "Agregar Despiece"). Se renombrará.
- **3D Template** = el visor/generador 3D de un elemento (viga/muro/columna) a partir de un template.
  Se abre con un botón DENTRO del Fabricator; al "cargar" inyecta las barras al despiece activo.
- **Template Editor** = herramienta para CREAR/EDITAR los templates. Vive en la caluga de Catálogo,
  que pasa a ser el "Configurador de herramientas".
- **Editor de Figuras** = el diseñador de figuras del catálogo actual (2D + 3D). Distinto de lo anterior.

---

## 0. Alcance y filosofía

Cuatro piezas, DESACOPLADAS (se pueden construir en fases y por separado):
1. **Motor geométrico** — dada una figura + dimensiones → geometría 3D sólida (barra con curvas de
   doblado y tramos curvos reales). Base de TODO.
2. **3D Template (visor/generador)** — instancia un template con parámetros → conjunto de barras
   posicionadas en 3D → botón "cargar al despiece".
3. **Template Editor** — define los templates (componentes, reglas, figuras) sin programar.
4. **Impacto en el catálogo / render actual** — decidir si el render 2D pasa a mostrar curvas y si
   las figuras necesitan más parámetros (multi-radio).

Regla rectora: **el usuario describe, el motor deriva.** Se guarda la RECETA, no el resultado.
Escalabilidad es requisito explícito del usuario en TODAS las fases.

---

## 0bis. GIRO DE ARQUITECTURA (discovery viga, 08-ago) — CRÍTICO

El discovery de la viga reveló que **hardcodear templates NO es el camino**. Razones (del usuario):
- El recubrimiento varía por plano/cara (los 4 recubrimientos ajustables), y afecta distinto a cada
  barra. Tekla/Revit lo resuelven ingresando PUNTOS por pantalla para limitar la distribución.
- El cubicador ajusta manualmente largos de barra según la figura.
- El cubicador decide cómo SUBDIVIDE el elemento (una "viga" puede abarcar 2 tramos con espaciamientos
  distintos, según su criterio). No es un patrón fijo.
- Una viga tiene ~5 componentes; un muro ~7. Hardcodear cada variante = trabajo enorme y cobertura baja.

**Conclusión:** el corazón NO es "la viga tipo programada", sino un **EDITOR DE COMPOSICIÓN**: el
cubicador trabaja sobre una vista por plano/volumen, POSICIONA componentes con clicks, define
recubrimientos y restricciones, ajusta largos. Un "template" pasa a ser una **composición GUARDADA**
que el usuario creó y reutiliza — no algo que programamos. Esto es esencialmente el **Template Editor**
adelantado: se vuelve el núcleo, no una fase posterior.

**Implicación en fases (revisar §11):** no "F1 viga hardcodeada → F2 editor". Más bien: el editor de
composición ES el MVP. Un primer elemento (viga) sirve para acotar el alcance del editor, no para
codear una viga rígida. Se re-planifica en §11bis tras cerrar el discovery.

**Riesgo:** esto es MÁS ambicioso que un generador de templates fijos. Hay que dimensionarlo bien
(posicionamiento por clicks, restricciones, recubrimientos por cara/barra = trabajo de editor gráfico).
Alternativa intermedia a evaluar: un editor de composición SIMPLE (formulario + pocas reglas) para el
MVP, y el posicionamiento por clicks/volúmenes como evolución. DECISIÓN PENDIENTE (§13 D8).

## 0ter. DECISIÓN DE ALCANCE D8 — RESUELTA: "paramétrico por componentes con capas"

Tras el debate crítico (08-ago), el MVP NO es ni hardcodeo rígido ni editor gráfico por clicks. Es un
**motor paramétrico por componentes con posicionamiento por reglas**:

- Una viga = **volumen de hormigón (caja)** + **lista de componentes**.
- Cada componente se define por: **tipología** (CBS/CBI/LT/ES/TRV…, cerrada), **figura** (libre),
  **φ**, **cara de anclaje** (sup/inf/lateral/perímetro), **recubrimiento/offset** desde esa cara,
  **índice de capa** (1ª/2ª/n → se apila hacia el núcleo automáticamente), **cantidad/distribución**,
  y para estribos **espaciamiento por tramos** (§ zonas confinadas/central).
- El **motor posiciona** cada componente aplicando esas reglas: la capa 2 se corre hacia el núcleo por
  su índice + φ; el recubrimiento define el offset desde la cara. RESUELVE el problema de las capas
  variables (CBS/CBS2/CBSn ya existen en el catálogo) que el hardcodeo rígido NO resolvía.
- El cubicador **agrega/quita/edita componentes** en un FORMULARIO (no dibuja). "Agregar 2ª capa de
  cabezal sup" = agregar componente con capa=2; el motor lo apila solo.
- Un **"template" = una composición de componentes guardada** ("Viga tipo Explora"). Se carga, se
  ajustan 2 cosas, se genera. Esto ES el flujo "20% + edición posterior = mitad de tiempo" que el
  usuario quiere, PERO sin el techo del hardcodeo (soporta capas, figuras libres, componentes N).

**Por qué este punto medio (opinión crítica registrada):**
- El hardcodeo rígido resuelve el 20% pero se ROMPE con capas variables (hueco que el usuario detectó).
- El editor gráfico por clicks es potente pero es un editor serio → tarda mucho antes de dar valor.
- Posicionar por reglas (cara + offset + capa) NO es difícil (el usuario tiene razón): no necesita
  Tekla, necesita anclaje-a-cara + apilado-por-capa. El click es comodidad futura, no prerrequisito.
- Ventaja: da valor rápido, soporta la realidad (capas/figuras libres), y evoluciona a clicks sin
  rehacer (el click solo cambia CÓMO se fija el offset, no el modelo de datos).

**Evolución natural (post-MVP):** posicionamiento fino por CLICKS/arrastre sobre el 3D (mover un
componente respecto a la cara con el mouse en vez del formulario) + restricciones visuales, estilo
Tekla-lite. El modelo de datos (componente = cara+offset+capa) ya lo soporta; solo cambia la UI de
edición del offset. Muros (7 componentes) usan el MISMO motor con más tipos de componente.

## 0-4ter. QUÉ se programa vs. QUÉ es data + "guardar como template" (confirmado 08-ago)

**Aclaración importante (el usuario preguntó si "hardcodeamos elementos"):**
- Lo ÚNICO que se programa una vez = el **MOTOR** (posicionar un componente por cara+offset+capa;
  genérico, sirve a cualquier componente de cualquier elemento).
- Un ELEMENTO (viga/muro) NO se hardcodea: es **DATA** — una lista de componentes con parámetros, en
  la BD. Cambiar/crear una viga distinta NO toca código.
- Se carga una **viga tipo SEMILLA como data** (no código) para tener punto de partida.

**"Guardar como template" (integración — corazón del diseño):** dos acciones sobre un elemento armado:
1. **Cargar al despiece** → genera barras, las mete al despiece actual (uso puntual).
2. **Guardar como template** → guarda la composición con nombre ("Viga Explora P1-P4") en la biblioteca
   de templates (`templates_catalogo`).
Luego, en cualquier despiece: **Cargar template** → reaparece con todos sus componentes configurados;
se ajusta lo que cambie (ej. largo) y se genera. Reutilización total.

**Por qué encaja natural:** un template ES una composición de componentes = los MISMOS datos que se
usan para generar. Guardarlo = persistir ese JSON. NO hay dos sistemas (crear vs. guardar): son lo
mismo. Un template instanciado (elementos_template) referencia opcionalmente el template de origen
(templates_catalogo) del que salió.

## 0-5ter. Modelo de COMPONENTE fijado (discovery UI, 08-ago) — firme

- **Componente = N capas** (tabla de capas dentro). Cada capa: N° barras + OFFSET a la cara
  (retranqueo hacia el núcleo). RAZÓN DE FABRICACIÓN (no solo UI): capas IGUALES en 1 componente →
  1 item / 1 ETIQUETA / 1 tanda (con cantidad ×N). Hacerlas como componentes separados duplicaría
  etiquetas/tandas. El sistema deja AMBAS abiertas (2 componentes de 1 capa, o 1 de 2 capas): el
  usuario agrupa cuando son iguales. Conecta con la lógica cant/mult ya existente en barras.
- **Cara editable por componente** = radial de 3 botones (Sup/Inf/Lat), NO dropdown. Para muros:
  cabezal en un lado u otro; trabas/estribos igual.
- **Offset a la cara por capa** = el retranqueo. Recubrimiento GLOBAL del elemento + OVERRIDE por
  componente. NO los 4-recubrimientos-por-lado de Tekla (eso es para fabricar/detallar, no cubicar;
  futuro, con el offset ya por-componente extensible a por-lado sin romper).
- **Jerarquía de recubrimiento = FIJA por defecto por elemento** (MVP) + ajuste manual del offset donde
  no calce. Escalable a jerarquía configurable después (el offset por componente ya lo permite). NO
  modelar la jerarquía completa ahora (pozo: reglas de armado por elemento = proyecto en sí).
- **φ = dropdown** (el usuario lo acepta: evita el "dedo malo" de escribirlo).
- **Estribo:** zonas NUMERADAS (1,2,3…; el usuario sabe cuál es ext/centro). Cada zona = longitud +
  @espaciamiento; la CANTIDAD se calcula sola (longitud÷@). REDONDEO debe replicar EXACTO el criterio
  de ADetailer → TAREA de investigación (agente).
- **Componentes REORDENABLES** (drag).
- **SIN vista previa tabla** (el usuario corrigió): el 3D + stats en vivo (items/etiquetas, barras, kg)
  ES la previa. El detalle fino se ve en el Bar Manager después.
- **Templates agrupados por OBRA** (orden) + poder cargar templates de OTRAS obras (reutilización).
- Maqueta v2 en `static/demo/template3d.html` refleja todo lo anterior. Sirve de referencia para que
  la implementación calce (método anti-desviación §9).

## 0-6ter. Dimensiones de figura DINÁMICAS por componente (discovery UI v3, 08-ago)

Hallazgo del usuario: **cada figura funciona distinto** — sus dimensiones dependen de sus `parciales`
(catalogo.py ya los define): 101A usa [A]; 103A usa [A,B,C]; 104D usa [A,B,C,D]. En un cabezal de viga
(típ. fig 103) A y C = patas del gancho (FIJAS, las pone el usuario), B = tramo largo (AUTO, derivado
del largo de la viga − recubrimientos).

**Diseño:** el componente muestra DINÁMICAMENTE los campos de dimensión de LA FIGURA elegida (leídos de
`figuras_catalogo.parciales`). Cada dimensión tiene un toggle **Fija / Auto**:
- Fija = el usuario ingresa el valor.
- Auto = el motor la deriva del elemento (ej. B = largo − recubrimientos; en un estribo el perímetro
  deriva de ancho/alto − recubrimientos).
Qué es auto por defecto depende de la figura + rol (cabezal vs estribo). El usuario puede sobrescribir.
Esto RESUELVE "distintas figuras funcionan diferente" sin hardcodear cada figura: se lee del catálogo.

**Resumen de barras a crear (reincorporado):** el usuario SÍ quiere ver las barras resultantes con sus
dimensiones, en vivo. NO es el Bar Manager: es un resumen COMPACTO abajo del canvas (tip/figura/φ/cant/
A/B/C/D/largo/kg) que se actualiza con cada cambio de parámetro. Complementa el 3D (uno ve la forma, el
otro las medidas exactas que se van a fabricar). Maqueta v3 lo incluye.

## 0-7ter. Pendiente de flujo (usuario, 08-ago)
El selector de elemento (viga/muro/columna) NO debería vivir dentro del modal del 3D Template. Debe
haber un FLUJO PREVIO: elegir elemento → cargar/abrir el 3D Template con ese elemento. Resolver DESPUÉS
(no bloquea el cableado del canvas). Anotado para el diseño del flujo de entrada.

## 0-8ter. Cierre de la MAQUETA (08-ago) — validada como referencia UX

La maqueta `static/demo/template3d.html` cumplió su rol: validó LAYOUT, controles, interoperabilidad
controles↔3D, curvas de doblado reales (toros), colores, y las herramientas (órbita/zoom/pan/ejes).
Queda como REFERENCIA VISUAL para que la implementación calce (método anti-desviación §9).

**LÍMITE de la maqueta (reconocido con el usuario):** su motor de generación está HARDCODEADO para
viga (corridaLong, estribos rectangulares). NO se puede configurar un muro con ella. Auditoría de
cableado (subagente 08-ago): solo 7 controles cableados (largo/ancho/alto/recub/n-sup/zonas-estribo);
el 3D NO lee Figura ni dims A/B/C de los componentes (usa geometría fija). Esto NO se arregla puliendo
la maqueta — el motor genérico es implementación real (F0).

**LECCIÓN CLAVE (para el MVP del muro):** viga y muro NO comparten geometría; el MVP "mismas funciones
para viga y muro" se cumple SOLO si el MOTOR es GENÉRICO: una corrida = figura + cara + distribución +
cantidad, sin saber el tipo de elemento. Viga = corridas cara sup/inf + distribución lineal; muro =
corridas cara lateral + distribución MALLA 2D (horizontal×vertical) + bordes confinamiento + trabas
que cosen las 2 mallas. El motor F0 debe soportar distribución 2D desde el diseño (no solo lineal).

**Pendientes de la maqueta (arreglar en la IMPLEMENTACIÓN, no en el HTML):**
- PAN real: debe ser con botón del MEDIO y desplazar sin rotar (hoy el pan aproximado "arrastra
  rotando", tiene trampa). En la impl. usar el pan estándar de una lib de controles.
- Cablear lo que la auditoría marcó decorativo (Figura→geometría, dims A/B/C, capas, acciones, etc.).
- Cantidades .calc del estribo que se recalculen; Regenerar que llame a generar; stats/resumen en vivo.

## 0-9ter. COLOCADOR POR PROYECCIONES (idea del usuario, 08-ago) — resuelve el motor genérico

Idea del usuario que RESUELVE cómo se construye un template de forma genérica (viga/muro/columna),
sin dibujar barras con puntos:

**Concepto:** 3 vistas 2D del elemento (proyecciones estándar del plano estructural):
- ELEVACIÓN (X-Y, de frente): largo × alto.
- PLANTA (X-Z, desde arriba): largo × ancho.
- SECCIÓN/CORTE (Y-Z, transversal): ancho × alto.
En cada vista el HORMIGÓN es un rectángulo (la cara de esa proyección) con sus recubrimientos = BOUNDARY
conocido. El usuario TOMA una figura del catálogo y la ANCLA dentro del boundary (ej. cabezal 103A
longitudinal en la elevación; estribo en la sección; malla distribuida en la elevación del muro) y
define su tipología. NO dibuja nodos: ancla a las CARAS del hormigón; el recubrimiento define el offset.
El 3D sólido se ARMA SOLO combinando las 3 proyecciones.

**Por qué es el MOTOR GENÉRICO:** no hay "viga-only". Hay "anclar figuras a un volumen por sus
proyecciones". Viga = cabezales long. en elevación + estribos en sección. Muro = mallas distribuidas 2D
en elevación + confinamiento en bordes de sección + trabas. MISMO mecanismo, distintas figuras/
distribuciones. La figura reconoce los boundaries del hormigón (o viceversa) → posición automática.

**VERIFICADO (reuso):** el diseñador de figuras 2D (disenador.js) YA tiene la base: click en lienzo con
SNAP a grilla (GRID=40), snap de ángulo (SNAP_ANG=45), manejo de planos/proyecciones (2D + iso 3D +
arcos por plano), motor de tramos. Falta: el rectángulo de hormigón como BOUNDARY con recubrimientos, y
ANCLAR figuras a caras (no dibujar nodos). Es EXTENSIÓN de lo existente, no desde cero.

**DOS MODOS COMPLEMENTARIOS del módulo (opinión acordada — la UI previa NO se descarta):**
1. **COLOCAR** (proyecciones 2D, esta idea) = construir el template anclando figuras. ES el
   **Template Editor** real (vive en Catálogo/Configurador).
2. **AJUSTAR** (panel de componentes colapsables de la maqueta v1-v8) = tomar un template YA construido
   y afinar parámetros rápido por formulario (φ, cantidad, espaciamiento). Es el uso día-a-día del
   cubicador en el **3D Template** (dentro del Fabricator).
3. El **3D sólido** (técnica rebar) = VISOR/verificador del resultado de ambos.

Los tres encajan: Colocar (nace el template) → Ajustar (se reutiliza y afina) → 3D (se verifica). La
maqueta de componentes ya hecha = modo AJUSTAR. Falta diseñar/maquetar el modo COLOCAR (proyecciones).

**Siguiente:** discovery/maqueta del COLOCADOR por proyecciones (cómo se ancla una figura a una cara,
cómo se define una distribución lineal vs malla 2D, cómo se pasan las 3 vistas al motor 3D). Este es el
núcleo genérico que faltaba.

## 0-10ter. Taxonomía de distribución (usuario 08-ago) — clave del motor

**Orientación al colocar:** cada figura se coloca con la orientación con que se CONSTRUYÓ en el catálogo
(incluido el estribo). El usuario a lo más no sabrá qué lado queda hacia qué cara del hormigón, pero
ROTANDO se resuelve. Al cambiar de figura, la orientación la manda el ROL/tipología del componente (no
el dibujo): un cabezal usa 2-3 figuras, todas mismo rol → cambio seguro. Cambio a rol distinto → avisar.

**Anclaje (cerrado):** (1) colocar la figura tal cual + rotar (barra/botón medio/botón canvas); (2)
distribución por RANGO con 2 clics (botón "definir rango" → inicio/fin → repetir cada @); (3) colocar la
barra en la VISTA donde su recorrido es más natural (estribo en sección, cabezal en elevación); las
otras vistas la reflejan. El 3D se arma solo.

**DOS TIPOS de elemento (como ADetailer — investigación lanzada):**
- **De DISTRIBUCIÓN:** se repiten con una regla. Modos:
  - LINEAL 1D a lo largo con @ (estribos; traba de confinamiento en viga/columna = "como estribo").
  - CAPAS apiladas hacia el núcleo (CABEZALES). Las capas las da la TIPOLOGÍA, no la figura. Se
    agregan/quitan en el panel de componentes (modo Ajustar).
  - ÁREA / MALLA 2D con @ en dos direcciones (mallas de muro; TRABAS de MURO = elemento de área,
    espaciadas en X y Z, posible + capas ajustando la regla).
- **PUNTUALES:** barras individuales sin regla de repetición (bastones, refuerzos puntuales).

**NO todos los elementos usan capas:** solo cabezales (por tipología). La taxonomía de distribución la
está precisando un agente (distribución vs puntual, modos, parámetros de cada modo, y una ABSTRACCIÓN
genérica de "distribución" para que cabezal-con-capas / estribo-lineal / malla-2D / traba-área salgan
del mismo modelo de datos). Resultado se integra aquí.

## 0-11ter. MODELO GENÉRICO DE DISTRIBUCIÓN (investigación 08-ago) — el corazón del motor

Hallazgo clave: "puntual vs distribución" = CÓMO se coloca la barra (no su forma). El cabezal es
distribución POR CAPAS (no puntual). La abstracción que unifica viga/muro/columna:

**Componente = figura de barra + CADENA de "distribuidores" (operadores) que se aplican en orden.**
Cada distribuidor toma un conjunto de placements (poses) y lo multiplica. Un solo motor de expansión
los aplica en cadena → viga, muro y columna salen del MISMO bucle, sin casos especiales.

```
Componente {
  bar_figure_ref,        // la geometría de UNA barra (figura del catálogo) + φ
  host_ref,              // elemento hospedador (viga/muro/columna) + sistema local
  anchor { face|axis|corner, cover, u0,v0,w0 },   // dónde arranca la barra base
  distribution: [ Distributor, ... ]              // cadena, en orden
}
Distributor =
  | Linear   {path, segments:[{from,to,spacing|count}], start/end_offset, justify}  // (a) estribos, trabas confinamiento
  | Layered  {count, step_vector(→núcleo), gap, per_layer?}                          // (b) CAPAS de cabezal, doble cortina malla
  | Grid     {surface, spacing_u, spacing_v, pattern:aligned|staggered, stagger, edges} // (c) mallas, trabas de muro
  | Perimeter{contour, per_face_count | equal_spacing}                                // (d) longitudinales de columna
  | Points   {positions[], count_each}                                               // (e) puntuales/bastones
```

**Cada caso real = una cadena:**
- Estribo c/confinamiento: `[Linear{segments: zonas @}]`
- Traba de confinamiento: `Linear` que COMPARTE path/@ del estribo, anchor interno.
- Cabezal (7φ25 en 2 capas): `[Perimeter/Points(7 pos a lo ancho), Layered{count:2, step→abajo, gap}]`
- Longitudinales columna: `[Perimeter{per_face_count}, Layered?]`
- Malla muro doble: una FAMILIA de barras por dirección (H y V, más limpio p/cubicar) + `Layered{count:2}` (2 cortinas)
- Trabas de muro: `[Grid{@h,@v, pattern:"staggered", stagger:0.5}]`, atraviesa el espesor, capas=1
  (patrón TRESBOLILLO por defecto, NO cuadrícula; "capas" del usuario = la traba conecta las 2 cortinas)

**DOS NIVELES (recomendación firme):**
1. **TIPOLOGÍA** (viga/muro/columna) = plantilla que conoce la geometría del hormigón y EMITE una lista
   de componentes con cadenas de distribución POR DEFECTO. Aquí vive el conocimiento de dominio
   ("cabezal→capas", "estribo→lineal con confinamiento", "muro→malla+trabas"). El usuario coloca
   TIPOLOGÍAS; ellas instancian componentes; el usuario solo ajusta params (@, n capas, φ).
2. **COMPONENTE** = figura + cadena de Distributors, editable.

→ El MOTOR es genérico (expande cadenas de Distributors sobre placements). El conocimiento de qué lleva
una viga/muro vive en las TIPOLOGÍAS, no en el motor. Esto ELIMINA el "motor viga-only" de la maqueta.

**Encaja con la arquitectura ya definida:** la RECETA guardada = `figura + cadena de Distributors +
params`; el motor la expande a barras al cargar al despiece. Cada Distributor sabe cuántas copias
genera → kilos/largo por familia salen directo.

**Parámetros por modo** (para el Template Editor / panel de ajuste):
- Linear: path, length/from-to, @|count, zones[], offsets, justify.
- Layered: n_layers, gap, step→núcleo, per_layer_count.
- Grid: surface(paño), @u, @v, pattern, stagger, edge_offsets, n_cortinas.
- Perimeter: contour, per_face_count | equal_spacing.
- Points: positions[], count_each.
- Transversal: cover (offset desde cara), bar (figura+φ).

## 0-12ter. ALCANCE MVP CERRADO (usuario 08-ago) — para el agente ejecutor

- **MVP = F0 (motor genérico) + F1 (3D Template que USA una viga-semilla, la ajusta, la carga al
  despiece).** El COLOCADOR (construir templates desde cero por proyecciones) NO va en el MVP; es 2ª
  entrega. La viga-semilla se carga como DATA (no código) para tener de dónde partir.
- **Agente ejecuta DE CORRIDO** (F0→F1 sin parar); el usuario revisa al final. Expectativa: primera
  pasada deja la base funcional; se afinan detalles después (como con las maquetas).
- **BD: migraciones NUEVAS idempotentes** (patrón del repo, no tocan datos existentes).
- Maquetas de referencia (método anti-desviación §9): 3D Template = `static/demo/template3d.html`
  (modo AJUSTAR); Colocador = `static/demo/colocador.html` (2ª entrega). El MVP implementa el modo
  AJUSTAR + el motor + carga al despiece.

## §DISCOVERY-INTERACCIÓN — Template Editor (definiciones del usuario, 08-ago)

Definiciones cerradas para la COLOCACIÓN INTERACTIVA (lo que falta para que los 3 cuadrantes 2D dejen
de ser solo-visualización). Las vistas 2D ya dibujan la viga real (proyección de placements); FALTA la
interacción encima.

**1. Colocar una barra:**
- Se coloca en CUALQUIER vista 2D. Ideal: todas las vistas + el 3D conectadas (si el 3D en vivo es
  fácil, sumarlo; si no, al menos las 2D).
- **Estribo (barra que toma el contorno):** eliges la CARA, y un CHECK hace que el estribo tome los
  límites de la sección como medidas, definidos por el recubrimiento. Recub=0 → la barra se ajusta al
  contorno de la sección.
- **Barra con lados (101A, 103A…):** se posiciona y ajusta según sus lados (2 lados = uno a cada cara).
  La ORIENTACIÓN inicial la determina la posición actual de la barra EN EL CATÁLOGO (ej. |___|).
- Se pega a la cara con el recubrimiento; el usuario puede hacer OVERRIDE con un controlador.

**2. Rotar:** seleccionar la barra + ESPACIO → rota 90° por defecto, en torno a la profundidad del plano
(se ve girar de frente: ___|  →  |___). Deseable: rotación con ángulo preciso definido, y visualizar el
ángulo resultante (opcional pero bienvenido).

**3. Distribución (rango):** un CHECK define si el componente tiene distribución. Rango con 2 clics.
Ej: dibujo el estribo en ZX, y en la vista ZY una FLECHITA DOBLE lo desplaza y van apareciendo los
estribos @20. SNAP activable/desactivable. La distribución se elige en las otras vistas según convenga.

**4. Nodos desplazables:** cada esquina del elemento dibujado tendría un NODO desplazable. Herramienta
futura: desplazar nodos con medidas específicas. Esto REEMPLAZA en gran parte la necesidad de un 2º
recubrimiento (mover el nodo resuelve la mayoría de los casos de ajuste fino).

**5. Editar lo colocado:** clic en una barra → se selecciona → editar propiedades en el panel izq;
mover y borrar desde la vista.

**6. Guardar/usar:** el NOMBRE del template se define en el TAB antes de entrar al modal; editable
después. (Pendiente aclarar: "Usar en el despiece" ¿abre el Enfierrador con el template cargado, o
carga barras directo al Fabricator?)

**7. Snap + Cotas:** snaps siempre, activables/desactivables con botón. Cotas: NO como tal, salvo para
indicar TRAMOS de un estribo/distribución que cambia (zonas @). Botón para prender/apagar cotas.

**8. Muro/Columna + PLANOS DE TRABAJO:** con lo anterior se resuelve. Ej muro: posiciono la 104B en la
vista de sección transversal, y en la de elevación defino la altura. Para un vertical: 103C en la
sección vertical, distribución en la elevación transversal. CLAVE: definir bien las COORDENADAS de los
planos de trabajo por tipo de elemento (la "sección" es plano distinto en viga vs muro). DESEABLE:
seleccionar el plano de trabajo activo (trabajar solo en uno) y que el 3D lo muestre RESALTADO.

**9. DEPENDENCIAS entre barras (feat clave, factibilidad en estudio):** poder definir dependencias
cuando el usuario quiera (no todas las barras las tienen). Ej: dependencia horizontal↔vertical con
PRIORIDAD elegida: la de mayor prioridad va más afuera (al recubrimiento); la otra se ajusta hacia el
interior SOLO en los tramos donde cruza una barra prioritaria. Si en un lado NO hay barra con prioridad,
ese tramo NO se desplaza. Ahorra data de entrada. Requiere reconocer bien tramo-a-tramo cuándo se ajusta
y cuándo no. (Subagente evaluando factibilidad.)

**10. Dimensiones del template:** el usuario elige las dimensiones de la viga EN EL TEMPLATE; al cargar
en el Enfierrador, parte con esos valores por defecto anclados.

**11. FUTURO — dibujar el hormigón:** poder dibujar la sección de hormigón (polígono) para elementos
especiales. NO ahora, pero dejar la puerta abierta si es posible (subagente evaluando).

**FIX aplicado (08-ago):** etiquetas de ejes de las vistas 2D eran confusas (Z→·Y↑ con Z a la derecha).
Cambiadas a descriptivas: "ancho→·alto↑", "largo→·alto↑", "largo→·ancho↑". Títulos sin ejes crudos.

**PENDIENTE de aclarar (siguiente fase de discovery):** override de recubrimiento (¿controlador o solo
nodos?); "Usar en el despiece" (Enfierrador vs Fabricator directo); detalle de la herramienta de nodos;
prioridad/dependencias UX exacta.

## §DISCOVERY-INTERACCIÓN-2 — Empalmes, retranqueo, flujo, prioridad (usuario 08-ago)

**A. EMPALMES (feat nuevo):** poder definir longitud de empalme por barra. Extiende el EXTREMO que el
usuario defina, en la cara definida, una cantidad. Default = 60·φ + 10 mm (configurable). No todas las
barras lo necesitan (típico: cabezales y verticales, pero debe ser posible para CUALQUIER tipología).
Efecto: la barra se alarga FUERA del hormigón por la cara definida esa cantidad. CLAVE: al usar el
template, el usuario reemplaza ese valor y las barras se reajustan solas. → Implementación: campo
`empalme: { extremo:'inicio'|'fin'|null, valor: '60*phi+1' | número }` por componente; el motor alarga
el lado/extremo indicado. El valor puede ser fórmula (60·φ+1cm) o override numérico.

**B. RETRANQUEO / DEPENDENCIAS — MODELO CORREGIDO POR EL USUARIO (cambia veredicto a MEDIO-FÁCIL):**
El agente lo entendió mal (creyó "escalones por tramo" → barra se alarga → peso roto). REAL: la barra
se desplaza COMPLETA hacia el núcleo (no por tramos, no inserta escalones). Si es recta (101A) solo
cambia de posición, largo IGUAL. Si tiene patas (103A): B (vertical) se corre adentro y A/C (patas) se
ACORTAN en el offset → largo se recalcula normal (suma de lados) → PESO SALE BIEN, sin conflicto.
Ej malla muro: horizontal (MH) al recubrimiento; verticales 1·φ_MH hacia el núcleo en cada cara. El
motor ya posiciona todo por ANCHOR + dims → retranquear = correr el anchor + restar offset a las patas.
Ambas son entradas que el motor ya consume. → SE INCLUYE (no era el algoritmo difícil).
Objetivo de fondo: barras con BOUNDARIES claros para que al cambiar la forma del hormigón queden casi
automáticamente bien, con mínimos ajustes manuales.

**C. PRIORIDAD (cómo se define):** número de prioridad GLOBAL por componente, ÚNICO (nunca 2 iguales).
Prioridad 1 va más afuera; la 2 se ajusta al núcleo si choca con un tramo de la 1. NO todas las barras
tienen prioridad — puede existir dependencia de solo 2 componentes; las sin prioridad funcionan como si
no chocaran con nadie. UX: desde el MENÚ (campo numérico que aparece al querer definir prioridades) o
por PANTALLA (botón → clicar las barras a priorizar). Elegir la más fácil/funcional al implementar.

**D. FLUJO "usar en el despiece" (definitivo, el usuario lo corrigió):** El Template Editor (caluga
Catálogo › tab Template) SOLO crea/edita templates y los deja guardados. NADA más. Aparte: en
CUBICACIONES → Fabricator → formulario de crear barras → botón "Enfierrador 3D" → el usuario ELIGE un
template → recién ahí el Enfierrador se carga con el template preconfigurado → ajusta rápido → "cargar
al editor" → se cierra el Enfierrador, las barras quedan en el editor y opera normal (como cualquier
cubicación). Se genera un REGISTRO de esa entidad consultable en Bar Manager (visualizar el 3D). Si una
barra de ese 3D se elimina (editor o Bar Manager), al consultar el 3D desde Bar Manager esa barra
DEBE desaparecer (el 3D refleja las barras ACTUALES, no el estado original).

**E. VEREDICTOS FINALES (qué se hace en esta ronda de implementación):**
- P2 planos por elemento: SÍ (fácil, prerrequisito muro).
- P3 resaltar plano activo en 3D: SÍ (fácil).
- P4 hormigón polígono: NO implementar; SÍ dejar el DATO abierto (`contorno` nullable + boundaryDeVista
  único). Casos futuros del usuario: muros con ventanas, pedestales (fundación + mini columna).
- P1 dependencias/retranqueo: SÍ, con el modelo CORREGIDO del usuario (barra completa + acortar patas,
  no escalones) → MEDIO-FÁCIL. Incluye empalmes (A) y prioridad (C).
- Campos aditivos al modelo de componente: `comp_id`, `prioridad`, `empalme`, `depende_de`.

**F. MÉTODO DE IMPLEMENTACIÓN (el usuario pregunta por una Skill multi-agente):** el usuario quiere un
proceso donde yo lance MÚLTIPLES agentes, implemente todo, y luego un proceso que AUDITE lo hecho,
revise, corrija — iterativo, para aprovechar el tiempo que él no está. (= orquestación tipo workflow con
fase de implementación + fase de verificación adversarial. Evaluar usar Workflow/ultracode.)

## §MURO/COLUMNA = MISMA MÁQUINA (usuario 08-ago)
Muro/columna NO requieren discovery propio: son la MISMA máquina que la viga. Solo cambian (a) qué eje
muestra el primer cuadrante (preconfiguración por elemento = P2 PLANOS_POR_ELEMENTO) y (b) las
tipologías disponibles (del catálogo por estructura). Todo lo demás (colocar/rotar/rango/nodos/empalme/
dependencias/planos) es idéntico. → Muro/columna = preconfiguración posterior, NO fase de discovery.
El MVP se implementa para VIGA; agregar otros elementos = poblar la tabla de planos + tipologías.

## 1. Correcciones de concepto (errores previos, ahora fijados)

- **R (radio) NO es el radio de doblado de los codos.** En ArmaHub, `radio` es un BOOLEAN por figura
  (tiene o no un TRAMO CURVO / desarrollo en arco) + el valor del radio de ESE arco. Es geometría del
  desarrollo de la barra, no del doblez de las esquinas.
- **El radio de DOBLADO de los codos** (la curva donde la barra gira en un ángulo) hoy NO se modela:
  el render 2D del catálogo muestra ángulos EN PUNTA por simplicidad. En el 3D Template SÍ importa
  (para visualizar congestión con el desarrollo real), pero es ESTÉTICO — no afecta cálculo de kilos.
- **Cálculo de kilos/largo (norma):** se usa el TRAMO EFECTIVO RECTO, sin considerar el desarrollo del
  doblado. Así trabaja la industria y así lo hace hoy el sistema. El radio de doblado 3D NO cambia esto.
  (Si algún día ArmaHub fabricara, el doblado real pasaría a ser relevante — no ahora.)
- **Multi-radio (futuro):** hoy el sistema acepta 1 radio por figura. En el futuro puede haber figuras
  con VARIOS tramos curvos, cada uno con sus parámetros reales (radio, cuerda, desarrollo). Además:
  un radio que aplica a 2 tramos como ESPEJO (R define ambos) vs. radios INDEPENDIENTES (Radio 1,
  Radio 2). Esto es del **Editor de Figuras**, no del Template Editor — pero la arquitectura de datos
  del motor geométrico debe dejar la puerta abierta (no asumir "1 radio").

---

## 2. SUB-SISTEMA A · Motor geométrico (la base)

Convierte (figura del catálogo + dimensiones A..I, ángulos, radio) → polilínea 3D → geometría sólida.

- **Entrada:** la geometría que ya existe en `figuras_catalogo.geometria` (JSON tramos {lado,giro,
  sentido}) + valores dim/ang/radio de la barra.
- **Salida:** malla 3D sólida (cilindros por tramo recto + toros por doblez, técnica de la maqueta).
- **Curvas de doblado (codos):** radio VISUAL automático por norma (2φ φ≤16, 3.5φ φ>16). No es
  parámetro del usuario. Solo estético.
- **Tramos curvos (R real de la figura):** cuando la figura usa `radio`, ese tramo se dibuja como arco
  real (no recto). Debe soportar 1 radio hoy, con estructura de datos preparada para N radios / espejo.
- **Ganchos:** ver §5 (superposición en el nodo).
- **Debe ser la ÚNICA fuente de geometría** (client-side, reutilizable por: 3D Template, render del
  catálogo, y a futuro el render 2D si se decide mostrar curvas).

**Decisión pendiente (§13-A):** ¿este motor REEMPLAZA el render actual del catálogo (que el 2D del
Bar Manager/Fabricator muestre curvas de doblado) o solo alimenta el 3D Template por ahora?

---

## 3. SUB-SISTEMA B · 3D Template (visor + generador + carga)

Se abre con un botón dentro del **Fabricator**. Flujo:
1. Elegir template (muro/viga/columna) + variante.
2. Ingresar parámetros del elemento (§4).
3. El motor de reglas del template genera la lista de componentes → barras (figura del catálogo + dims
   calculadas + posición 3D). Reusa el Sub-sistema A para dibujar cada barra sólida.
4. Ver en 3D: rotar, ocultar hormigón, verificar congestión. Ajustar parámetro → regenera al instante.
5. **"Cargar al despiece"** → las barras entran al despiece activo del Fabricator (origen='template',
   template_instancia_id), indexadas, con sus figuras del catálogo. Siguen el flujo normal.

**Guardado (arquitectura de datos, §7):** se guarda la RECETA (parámetros), no las barras como modelo
aparte. La posición se DERIVA al re-abrir. Ver §7 para el comportamiento de regenerar/editar/borrar.

## 4. Parámetros de elemento (base — se AMPLIARÁ en discovery)

Todo elemento de hormigón: **Largo, Ancho/Espesor** (según el elemento), **Altura**. Más:
- **Recubrimientos** — y CÓMO afecta cada recubrimiento a CADA barra (no es uno global). Esto puede
  hacer que barras se traslapen: algunas se resuelven al instalar (OK), otras NO pueden traslaparse
  (problema real de instalación). El motor debe distinguir/avisar. [Requiere reglas por componente.]
- Por componente: figura del catálogo elegible, φ, cantidad/distribución, espaciamiento.
- **Espaciamiento POR TRAMOS** (crítico para columnas): en diseño columna-fuerte/viga-débil el
  espaciamiento de estribos VARÍA a lo largo del elemento (confinamiento en extremos, más abierto al
  centro). El template debe permitir definir zonas con distinto espaciamiento. (Reemplaza la idea de
  "estribos alternados", que el usuario NO quiere.)
- Cada figura DEBE aportar TODOS sus parámetros necesarios para cargarse en el Fabricator.

*El usuario aportará muchos parámetros más por elemento en el discovery de cada template.*

## 5. Ganchos de estribo — superposición en el nodo (decisión del usuario)

- El "cierre desplazado" que propuse **NO sirve** (no representa la pieza real).
- Realidad: con el DESARROLLO DEL DOBLEZ EN CURVA, cada gancho queda a un offset natural del otro
  (por el radio de doblado), mostrándose como "/ /". Las curvas de doblado de cada lado deben
  **coincidir exactamente** para que se vea correcto (ver foto del usuario).
- Programas como Revit/Tekla "acomodan" el gancho; **acá NO es necesario hacerlo**.
- **MISIÓN (§13-D):** averiguar si el componente/lib de render (Three.js + nuestra técnica) YA resuelve
  bien el gancho con el desarrollo curvo. Si sí, usarlo. Si no, **mostrarlo traslapado tal cual** (es
  aceptable; no inventar offsets artificiales).

## 6. SUB-SISTEMA C · Template Editor (Configurador de herramientas)

Vive en la caluga de **Catálogo** (que se reposiciona como "Configurador de herramientas"). Permite
CREAR/EDITAR templates sin programar. Debe ser ESCALABLE (requisito explícito):
- **Fase 2 (editor de reglas por formulario):** el usuario define un template = elemento + lista de
  componentes; por componente elige figura del catálogo, define reglas de cantidad/espaciamiento/
  posición/recubrimiento. Guarda variantes ("Muro Explora tipo A", "Muro cruce"). NO modela.
- **Múltiples templates por tipo de elemento** SÍ soportado (el usuario lo quiere para muros: un cruce
  de muro cambia varias cosas → template propio). La arquitectura NO debe asumir "1 template por
  elemento".
- **Fase 3 (volúmenes + posicionamiento con restricciones):** el usuario define VOLÚMENES de hormigón
  y posiciona figuras dentro con restricciones claras (NO modelado libre CAD). Debe ser una evolución
  natural del editor de reglas, no un rehacer. Diseñar Fase 2 con esto en mente.

## 7. Arquitectura de datos (decidida)

- **`templates_catalogo`**: definición de cada template (tipo elemento, componentes, reglas, figuras).
  Editable por el Template Editor. Varios templates por tipo de elemento permitidos.
- **`elementos_template`**: instancias creadas = RECETA (template_id, params JSONB, ubicación/posición
  del elemento, obra, autor, fecha). NO guarda barras. ~1 KB por instancia.
- **`barras`** gana: `template_instancia_id` (FK nullable) + `origen` acepta 'template'. Las barras
  generadas son barras normales del despiece.
- **La posición espacial NO se almacena barra por barra** — se DERIVA del motor desde la receta al
  re-abrir el 3D. Cero duplicación.

**Comportamiento (responde las dudas del usuario):**
- **Borrar el cabezal (o una barra) en el Fabricator:** la barra desaparece del despiece. Al RE-ABRIR
  el 3D Template hay dos modos posibles (decisión §13-B): (b1) "estado original" = re-deriva de la
  receta y el cabezal reaparece; (b2) "reflejar la edición" = el 3D lee las barras ACTUALES del
  despiece (con el cabezal ya borrado) y no lo muestra. El usuario quiere que si eliminó el cabezal,
  el modelo lo reconozca y no aparezca → esto apunta a (b2) o a un "regenerar" explícito que respete
  ediciones. CERRAR en §13-B.
- **Modificar una barra:** la edición vive en la barra (fuente de verdad, como CSV vs Bar Manager).
  La receta es el estado inicial. NUNCA se sobreescribe la barra editada al re-abrir sin que el usuario
  pida "regenerar". → SIN clash, SIN sobreescritura silenciosa (preocupación del usuario resuelta).
- **Regla anti-clash:** el 3D Template en modo lectura NUNCA reescribe barras del despiece. Solo el
  botón explícito "Cargar/Regenerar" escribe, y avisa qué hará (crea nuevas / reemplaza las del
  template_instancia_id / respeta ediciones manuales).

## 7bis. HALLAZGOS DE INVESTIGACIÓN TÉCNICA (subagente, 08-ago) — impactan el diseño

**Gancho "/ /" (P1):** la maqueta rebar3d.js separa los dos ganchos con un offset ARTIFICIAL
`dx = 1.15·φ` en el eje de la viga (rebar3d.js:156-171, el comentario lo admite). Los codos SÍ son
toros reales y el LARGO del gancho deriva de la tangencia real del doblez 135°; lo inventado es solo
la SEPARACIÓN lateral. Conceptualmente incorrecto: el "/ /" real nace del ESPESOR de la barra (un
gancho pasa por delante/detrás del otro, offset ≈1·φ PERPENDICULAR al plano del estribo), no a lo
largo de la viga. → Para producto: parametrizar el offset (dirección perpendicular al plano + magnitud
= f(φ)) y elegir qué gancho va por dentro. NO es un número mágico en X. (Cierra parte de decisión D.)

**Tramos curvos / arcos (P2) — CORRIGE un supuesto:** el arco de desarrollo YA ESTÁ RESUELTO, pero en
el editor de figuras (disenador3d.js), NO en la maqueta sólida. disenador3d.js:277-302 `_puntosArco3d`
genera arcos 3D reales (centro/cuerda/sagita/sweep, 16 pts) y los renderiza con CatmullRomCurve3 +
TubeGeometry (L413-414), y calcula sus cotas (desarrollo/radio/horiz/vert, L309-376). La maqueta
rebar3d.js solo hace rectos+codos. → Integrar arcos sólidos al motor NO es rediseño: ruta recomendada
= TubeGeometry con radio=φ/2 sobre la polilínea de arco ya existente, o toro parcial reusando el
patrón de codos (rebar3d.js:137-139 makeBasis). El código de arco YA existe y es reutilizable.

**Multi-radio / estructura de datos (P3) — HALLAZGO CLAVE:** el JSON `geometria.tramos[]` YA es
por-segmento y YA soporta N arcos, cada uno con radio/plano/sweep propios (disenador3d.js:733-735:
`{lado,largo,tipo:'recto'|'arco',radio,plano,sweep}`). La FORMA escala. Lo que está ATADO A 1 es:
(a) el flag `radio BOOLEAN` de figuras_catalogo (082:11) y (b) los VALORES por barra: columnas fijas
`dim_a..dim_i` + `ang1..ang4` + UN `radio` escalar en la tabla `barras`. Una figura con 2 arcos de
radios distintos NO tiene dónde poner el 2º valor.
→ Recomendaciones del agente para el modelo de datos:
  1. `radio BOOLEAN` del catálogo → DERIVARLO (= existe algún tramo tipo 'arco', o `n_radios` contado
     del JSON). No mantener un booleano manual desincronizable.
  2. Consolidar `tramos[]` como modelo canónico; cada arco con `{radio,cuerda,desarrollo,sweep,plano}`
     (2 grados de libertad fuente, 3º derivado) + `grupo_radio`/`ref_espejo` opcional para modelar
     "radio espejo (1 R → 2 tramos)" vs "R1/R2 independientes". Campo ADITIVO, no rompe nada.
  3. El cuello real = valores por barra en columnas fijas. Para N arcos, migrar los VALORES a un JSON
     por-tramo (`valores_tramo`) en vez de dim_*/ang*/radio fijos. (Diseño mayor — planificar, no
     bloquear F0/F1 que usan figuras de ≤1 radio.)
  4. "Radio 1/Radio 2" = etiqueta derivada del orden de arcos en tramos[]. Sin esquema nuevo.

## 8. SUB-SISTEMA D · Impacto en catálogo y render actual (a decidir)

- ¿El render 2D del catálogo/Bar Manager/Fabricator pasa a mostrar CURVAS (doblado + tramos curvos) o
  se mantiene en punta por ahora? (§13-A). Recomendación inicial: mantener 2D simple; el 3D Template
  usa el motor nuevo. Evaluar unificar después.
- **Multi-radio en figuras** (§1): el Editor de Figuras deberá soportar N radios / espejo / independientes
  a futuro. El motor geométrico (Sub-sistema A) debe modelar el radio como una LISTA, no un escalar,
  aunque hoy se use 1. [Diseño ahora, implementación cuando se necesite.]
- **Barras con curvas (tramos curvos):** probablemente NO aparecen en los elementos estándar iniciales
  del 3D Template, pero el motor DEBE saber dibujarlas (una figura con `radio` real). Verificar que la
  técnica de la maqueta (toros/arcos) las cubra. [Checkear en §13-C.]

## 8bis. Aclaraciones del usuario sobre los hallazgos (08-ago)
- **Gancho (P1):** la solución correcta = espaciar en el sentido PERPENDICULAR (por el espesor). Si
  resulta muy complejo, es aceptable NO espaciar (no complica nada constructivo). Preferible hacerlo.
- **Multi-parámetro / letras (P2):** los valores extra por barra (más allá de dim_a..i, ang1..4, 1
  radio) hoy NO están parametrizados en la barra. El usuario resolverá cómo aSa Studio reconoce esos
  parámetros (en aSa puede asignar distintas letras) → el diseño solo debe dar FLEXIBILIDAD para que
  esos valores existan y se puedan mapear. No resolver el lado aSa aquí.
- **Multi-radio (P3):** igual — el usuario verá cómo lo resuelve con aSa Studio. Nuestro trabajo:
  estructura de datos flexible que soporte N radios; el mapeo a aSa lo define él después.

## 9. UX / diseño del módulo — POR DEFINIR (falta barrido de tabs/flujos/botones)

*Reconocido con el usuario (08-ago): NO se ha visto el diseño de cada tab, flujos, botones, colores.
La maqueta rebar3d.html sirve como APROXIMACIÓN visual del 3D Template, PERO hay un riesgo real
histórico: maquetas que a la hora de implementar no quedaban iguales. Mitigación acordada abajo.*

**Método anti-desviación (para que la implementación quede IGUAL a lo aprobado):**
- Antes de codear cada superficie (3D Template, Template Editor), se hace una MAQUETA VISUAL sin
  lógica, se aprueba, y el código parte DE esa maqueta (no se rehace). Método ya usado en el proyecto.
- La maqueta aprobada se conserva en el repo como referencia; la implementación debe calzar pixel a
  pixel con ella (mismos IDs, mismo layout, mismos textos). Si algo cambia, se cambia la maqueta primero.
- Se implementa por ETAPAS separadas (maqueta → cableado → datos reales), no todo junto.

**Superficies a diseñar (cada una necesita su maqueta aprobada):**
1. **Botón "3D Template" en el Fabricator:** dónde va, qué dice, ícono. Abre el visor (¿modal a pantalla
   completa? ¿panel lateral? ¿pestaña?).
2. **Visor 3D Template:** layout = panel de parámetros + canvas 3D + barra de acciones. Definir:
   - Zona de parámetros: agrupación (elemento / componentes / recubrimientos / espaciamiento por tramos).
   - Canvas: controles de vista (rotar/zoom/reset), toggle hormigón, ejes/grilla.
   - Acciones: "Cargar al despiece", "Regenerar", "Cerrar". Contadores en vivo (barras, kg).
   - Estados: vacío, generando, WebGL ausente (mensaje claro), error.
3. **Template Editor (en Catálogo/Configurador):** cómo se lista/crea/edita un template; cómo se define
   un componente (elegir figura, reglas). Maqueta propia.
4. **Colores/estética:** paleta (acero metálico, hormigón semitransparente, grilla, ejes, acento verde
   Armacero). Consistente con la identidad ArmaHub.

## 9-ORIG. UX técnica (referencia)

- **Dónde se activa:** botón "3D Template" dentro del Fabricator (abre visor); "Template Editor" como
  sub-sección del Catálogo/Configurador.
- **Layout del 3D Template:** panel de parámetros (izq) + canvas 3D (centro/der) + acciones (cargar,
  ocultar hormigón, resetear). Contadores en vivo (barras, kg).
- **Colores/estética:** definir paleta (acero metálico, hormigón semitransparente, grilla, ejes).
  Homologar con la identidad ArmaHub (verde Armacero). [Definir con el usuario.]
- **Estados vacíos, validaciones, mensajes** (incl. WebGL ausente → mensaje claro, no pantalla blanca).
- **Responsivo / rendimiento** (InstancedMesh; probado ~1M triángulos a 60fps).

## 10. Compatibilidad y no-romper
- Export a aSa: las barras del template son figuras del catálogo normales → export idéntico. NO tocar
  export.py.
- Sistema de tipologías FIJO intacto (las barras generadas llevan su marca/tipología del catálogo).
- Flujo del Fabricator intacto: el 3D Template solo AÑADE barras al despiece activo.

## 11. Fases (desacopladas)
- **F0 — Motor geométrico** (Sub-sistema A): barra sólida con curvas, desde la geometría del catálogo.
  Independiente; testeable solo. Es prerequisito de todo.
- **F1 — 3D Template MVP** (Sub-sistema B): UN elemento (muro o viga, §13-E), generación + 3D + cargar
  al despiece. Templates codificados por nosotros.
- **F2 — Template Editor** (Sub-sistema C): crear/editar templates por formulario; múltiples por tipo.
- **F3 — Volúmenes + posicionamiento con restricciones** (evolución de F2).
- **Transversal — Catálogo/render 2D** (Sub-sistema D): según §13-A.

## 12. Lista de tareas (se detalla al cerrar §13; borrador por sub-sistema)
*(Cada tarea llevará: archivos, criterio de aceptación, test. No ejecutar aún.)*

**F0 Motor geométrico:**
- Extraer/generalizar el generador de la maqueta a `modelador/motor_geom.js` (input: geometria del
  catálogo + dims; output: malla). Soporte de: tramos rectos, codos con radio de doblado visual,
  tramos curvos (radio real, estructura lista para N radios), ganchos.
- Test headless (node): geometrías conocidas → sin NaN, largos coherentes, conteos correctos.
- Investigación gancho (§5): ¿la técnica actual muestra bien "/ /"? Documentar hallazgo.

**F1 3D Template:**
- Migración: `templates_catalogo`, `elementos_template`, columnas en barras.
- Reglas del elemento elegido (§13-E) incl. espaciamiento por tramos, recubrimientos por barra.
- Panel UI + canvas + acciones + contadores + estados/validaciones/WebGL.
- Backend: crear/leer/regenerar instancia; "cargar al despiece" (respeta ediciones, anti-clash §7).
- Mapear figuras del catálogo del elemento.
- Tests: generar → N barras correctas; cargar; regenerar; borrar barra sin romper receta.

**F2 Template Editor:** (se detalla tras F1)
**F3 Volúmenes:** (se detalla tras F2)

---

## 12bis. DECISIONES CERRADAS POR EL USUARIO (08-ago) — firme

- **D1 · Elemento de partida = VIGA.** El usuario acepta partir por viga (validar el motor completo de
  punta a punta) y luego atacar muro sin riesgo de quedar a medias.
- **D2 · Render 2D actual = SE MANTIENE SIMPLE POR AHORA**, con la CONDICIÓN (confirmada) de que el
  motor nuevo tome bien las barras actuales del catálogo y permita HOMOLOGAR después el render de la
  plataforma (que hoy se ve "producto": estribos sin codo, gancho como un solo segmento). El motor es
  ÚNICO y sirve para ambos → homologar el 2D/wireframe a codos+ganchos reales es una fase corta
  posterior, no un rehacer. Prioridad: motor bien hecho una vez.
- **D3 · Re-apertura del 3D = LEE LAS BARRAS ACTUALES del despiece** (si borraste el cabezal, no
  aparece) + botón explícito "Regenerar" que vuelve al original avisando. FLUJO A DEFINIR (§9): el
  usuario propone que sea "una visualización POR ELEMENTO adicional a las que ya existen" (junto a las
  vistas actuales del Bar Manager/Fabricator). Se maqueta.
- **D4 · Activación = MODAL** (no salir de la sección actual). Confirmar que el modal a pantalla
  ~completa no complica el canvas 3D (verificar en la maqueta; probablemente OK).
- **D6 · Estética:** acero metálico + hormigón semitransparente + acento verde Armacero. ABRE temas
  nuevos a definir (ver §9ter): color del canvas/fondo, cómo se diferencia el hormigón y otros datos
  (cotas), y HERRAMIENTAS de inspección: medir distancias, HOVER que muestre cantidad de elementos y/o
  detalle de una barra/grupo. → El 3D Template no es solo "ver", también "inspeccionar".
- **D7 · Renombrar "Agregar Despiece" → "Fabricator"** en toda la plataforma. CONFIRMADO. Nota: en el
  Fabricator SE SIGUEN CREANDO despieces (no es incongruente); el nombre abarca crear + generar 3D.

## 8ter. Catálogo de VIGA (real, de catalogo.py) + regla figura-libre

**Tipologías de VIGA (cerradas por tipo de elemento, catalogo.py:105-108):**
- CBS (Cabezal Superior 1ª capa), CBS2 (2ª capa), CBSn (n capas)
- CBI (Cabezal Inferior), CBI2, CBIn
- LT (Lateral), ES (Estribo), TRV (Traba Viga)
- *(faltaría alguno según el usuario — confirmar en discovery)*

**Figuras sugeridas por tipología** (catalogo.py:134-142), ej. VIGA-ES: 103H/103E/104D/104O/104P;
VIGA-CBS: 101A/102A/102B/…/103D. PERO son SUGERENCIAS, no restricción.

**REGLA CLAVE (usuario, 08-ago): la TIPOLOGÍA es lo cerrado por tipo de elemento; la FIGURA es LIBRE.**
Ej.: EC es la tipología "estribo de confinamiento de muro", pero el usuario puede elegir la figura
106A/106B/106C para ese estribo, o usar esas mismas figuras en una viga tradicional. No se puede
restringir la figura por tipología (infinitas posibilidades). El sistema propone figuras frecuentes,
pero permite cualquiera. El **sufijo (suf_tipo)** define el rol fino (cabezal sup/inf, primera/segunda
capa, etc.) — ya existe en el sistema.

## 8-4ter. Homologación del render de plataforma (tarea D2, POSTERIOR al motor)
Una vez existe el motor geométrico (F0), homologar el render 2D/wireframe actual (Bar Manager/Fabricator/
catálogo) para que muestre codos y ganchos reales (hoy los estribos se ven "producto": gancho como un
solo segmento sin codo). Es fase CORTA porque reusa el mismo motor. NO se hace ahora; queda como tarea
planificada. Mantener el 2D simple hasta entonces.

## 9ter. Herramientas de inspección del 3D Template (D6 — nuevas, a diseñar)
- **Cotas:** mostrar medidas del elemento y/o de barras (largo, espaciamiento, recubrimiento) sobre el
  canvas. Definir cuáles por defecto y cuáles on-demand.
- **Hover:** al pasar el cursor sobre una barra/grupo → tooltip con detalle (tipología, φ, cantidad,
  largo) y/o "cantidad de elementos" del grupo señalado.
- **Medición:** herramienta para medir distancias entre puntos (verificar separaciones, congestión).
- **Diferenciación visual:** hormigón semitransparente vs. acero; posible resalte por tipología/φ.
- Todo esto son CAPAS sobre el canvas; se especifica en la maqueta del visor (§9).

## 13. DECISIONES QUE NECESITO DEL USUARIO (cerrar antes de codear)

**Ya resueltas (no requieren al usuario):**
- Gancho: offset perpendicular (por espesor); si es complejo, sin espaciar (aceptable). Usuario OK.
- Curvas/arcos: el motor las dibujará reusando `disenador3d.js` (código ya existe).
- Multi-radio: estructura de datos flexible (JSON por-tramo); el mapeo a aSa lo resuelve el usuario aparte.

**PENDIENTES (el usuario decide):**

- **D8. ¿MVP = editor de composición completo (posicionar por clicks + recubrimientos por cara +
  restricciones) o versión intermedia (formulario + pocas reglas)?** Es LA decisión de alcance tras el
  giro de arquitectura (§0bis). El editor por clicks es potente pero es un editor gráfico serio; el
  intermedio arranca antes pero cubre menos. Recomendación: MVP intermedio que YA guarde composiciones,
  con el posicionamiento por clicks como evolución — pero validar con el usuario cuánto necesita de
  entrada.
- **D3-flujo. Botón "3D Template":** el usuario ACLARA (08-ago) que el botón para CREAR barras con el
  3D Template va en el **Fabricator** (formulario de edición/creación de despieces), NO en el Bar
  Manager. El Bar Manager es para revisar la obra global, editar masivo, administrar data. IDEA
  ACEPTADA a futuro: cuando se depure el Bar Manager (mejores filtros, más info), PODRÍA incorporarse
  una visualización 3D por elemento AHÍ también — pero eso es posterior, no el MVP. El MVP: botón en
  el Fabricator.
- **D1. Elemento de partida:** ¿MURO (más productividad, más complejo) o VIGA (más simple, menos riesgo
  de quedar a medias)? El usuario prefiere muro pero teme que quede incompleto. Se dimensiona con D5.
- **D2. Render 2D actual:** ¿el render 2D del catálogo/Bar Manager/Fabricator pasa a mostrar curvas
  (doblado + arcos) reusando el motor nuevo, o se mantiene en punta por ahora y el motor solo alimenta
  el 3D Template? (Recom: mantener 2D simple ahora, evaluar unificar después.)
- **D3. Modo de re-apertura del 3D tras editar/borrar barras:** al re-abrir el 3D de un elemento ya
  cargado, ¿el visor LEE las barras actuales del despiece (si borraste el cabezal, no aparece) o
  muestra el ESTADO ORIGINAL de la receta (cabezal reaparece)? El usuario quiere que reconozca un
  cabezal borrado → apunta a "leer barras actuales" + un botón explícito "Regenerar" (que sí vuelve al
  original, avisando). Confirmar la mecánica exacta.
- **D4. Ubicación/activación de las superficies:** confirmar (a) el botón "3D Template" dentro del
  Fabricator (¿modal pantalla completa / panel lateral / pestaña?); (b) "Template Editor" como
  sub-sección del Catálogo (que se renombra a "Configurador de herramientas"). ¿OK?
- **D5. Parámetros completos del elemento elegido (D1):** lista exhaustiva (largo/ancho/alto,
  recubrimiento por-barra, componentes, φ, espaciamiento por tramos, confinamiento, figuras elegibles…).
  Discovery dedicado del elemento. ESTO ES LO MÁS GRANDE y define el alcance real.
- **D6. Colores/estética del módulo** (§9): paleta del 3D y del Template Editor.
- **D7. Nombre nuevo del Fabricator:** confirmar que el tab "Agregar Despiece" se renombra a
  "Fabricator" en toda la plataforma.

**MÉTODO:** cerrar D1-D7 → MAQUETA VISUAL aprobada de cada superficie (anti-desviación, §9) → detallar
§12 tarea por tarea → agente ejecuta F0(motor)→F1(3D Template) de corrido. Barrido COMPLETO antes de
tocar un elemento (prioridad del usuario).

## §INTERACCIÓN-2.0 — REDISEÑO DE INTERACCIÓN (usuario 09-ago) — MODULAR, cerrado, va a workflow

Cierre completo tras probar la 1ª versión + 3 auditorías (ADetailer / arquitectura / UX). El motor NO
cambia su núcleo; se COMPLETA la capa de interacción que la maqueta colocador.html prometía y el 1er
workflow omitió (ghost, grosor, clamp). Y se adopta el modelo MODULAR del usuario: el comportamiento lo
define el PLANO DE TRABAJO de la pieza + su rotación, NO el tipo de estructura.

### PRINCIPIO RECTOR (lo que hace todo modular)
- **El MODO de la barra es independiente de su TIPOLOGÍA.** 3 modos de uso: **PUNTUAL** (P1),
  **DISTRIBUCIÓN LINEAL** (DX·DY), **ARREGLO** (ex-"área", ahora arreglo rango+capas). La tipología
  trae un modo PRESETEADO (default), pero el usuario lo puede CAMBIAR con botoncitos. Reglas
  específicas = SOLO en la preconfiguración de la tipología; el motor es genérico (no sabe de
  vigas/muros). Fuente conceptual: ADetailer INPUT_METHOD_MAP (typology_catalog.py:452), pero allá el
  modo está fijo por tipo; aquí es editable.
- **ROTAR EL PLANO DE LA PIEZA (no rotar en el plano).** Cada pieza tiene un plano de trabajo propio
  que se puede voltear 90°. Al voltearlo cambia su proyección Y su lógica:
  - Estribo en sección XZ: plano normal -> figura completa (rectángulo cerrado); plano volteado -> de
    canto (línea vertical) + su RANGO (tanda hacia la profundidad).
  - Cabezal 103A en sección: plano normal -> círculo (viene longitudinal); volteado -> perfil de lado.
  - Esto permite colocar CUALQUIER barra en CUALQUIER vista. El eje longitudinal y la dirección de
    distribución quedan definidos por DÓNDE coloco + CÓMO roto el plano. Resuelve fundación (cualquier
    eje puede ser longitudinal), trabas de muro, etc. con UN solo mecanismo, sin lógica por estructura.
  - Control: **botón elegante SOBRE la pieza seleccionada** (overlay contextual, visualmente claro) +
    **tecla `R`**. Ambos llaman a la misma acción `rotarPlanoPieza()`. La rotación de plano es
    ORTOGONAL al modo (Puntual/DX·DY/Arreglo): el modo decide qué campos muestra el menú, la rotación
    decide desde qué cara se ve/coloca. No se pisan.

### LAS 3 LÓGICAS (mapeo ADetailer -> Template Editor)
- **A · PUNTUAL** (cabezal/CB, longitudinales). Clic -> la barra se pega a una CARA con SNAP RESALTADO
  (al acercar el cursor a una cara del hormigón, ESA cara se resalta y el ghost se pega; el usuario ve
  a qué cara va ANTES de clicar). En sección = punto (mejorado con ghost/grosor). En vista longitudinal
  = FORMA REAL de la barra (dibujar la figura; evaluar si además se puede COLOCAR desde ahí — deseable,
  si es viable hacerlo). Centrar-vs-repartir + CAPAS hacia el núcleo = control EXPLÍCITO en el panel
  (nº de barras/capa + nº de capas + espaciamiento), NO truco de nº de clics. Cantidad directa.
- **B · DISTRIBUCIÓN LINEAL** (estribo/traba). Colocar en sección -> snapea al recubrimiento (figura
  completa visible ahí). El RANGO de reparto (from/to, inicio/fin de la tanda) se ajusta en la vista
  que el plano define; parte con un rango mínimo razonable. cant = ceil(dist_util/@)+1 (fórmula
  ADetailer bar_model.calc_line_count, YA implementada en reglas.js). Al ROTAR el plano de la pieza en
  la sección, se ve de canto + su rango -> habilita distribuir en el otro eje (fundación: cualquiera
  de los 2 ejes puede ser el longitudinal). DXODY del ADetailer queda CONTENIDA aquí (elegir eje = rotar
  plano), no es una lógica aparte.
- **C · ARREGLO** (ex-área; trabas de muro, mallas). NO por cálculo de m². Se posiciona como cualquier
  barra y se define: RANGO en un sentido (ej. vertical) + N CAPAS que replican con ESPACIAMIENTO (nº de
  capas + separación, en vez de capa por capa) -> arreglo rango×capas, más preciso y simple. El PLANO DE
  TRABAJO define la orientación: si el plano es XY, la barra se posiciona hacia la profundidad. Según el
  plano donde defino el arreglo, se orienta la pieza. Soportes de losa (pieza 3D) = caso adaptado
  APARTE, después (son muy pocos los de área). D del ADetailer = contenida, no aplica como lógica extra.

### DIMENSIONES DE BARRA (el requerimiento real de "anclajes", aclarado por el usuario)
- La barra NACE bien anclada al boundary de RECUBRIMIENTO (auto: largo = hueco menos 2·recub, CRECE con
  el hormigón). Override por FIELD numérico (no por arrastre que congele): escribir valor -> dim pasa a
  modo:'fija'. Modelo YA soportado (reglas.js dims {modo:'auto'|'fija'}).
- FUTURO (no bloquea, se puede después): dibujar el BOUNDARY de la barra en pantalla y permitir
  ajustarlo visualmente <-> el gesto se traduce a un OFFSET que se refleja en el field (offset visual
  <-> field, sincronizados). NO se ancla al volumen de hormigón (innecesario si la barra ya viene pegada
  al recubrimiento). Este punto (visualizar/editar boundary de barra) se ABORDA MÁS ADELANTE, cuando el
  usuario entienda cómo quedó la plataforma. NO entra a este workflow.

### AUDITORÍA UX — lo que se COMPLETA (la maqueta ya lo prometía; el 1er workflow lo omitió)
Orden por impacto (van juntos, es el mínimo para que "se sienta bien"):
1. **GHOST que sigue el cursor** con COLOR de la tipología + BADGE "CBS ø16" pegado al cursor. Forma
   REAL (rectángulo para estribo snapeado al recub; punto/línea para longitudinal pegado a la cara).
   El CSS `.te-ghostbar`/`.te-gpt` YA existe en template_editor_modal.html pero NUNCA se dibuja: cablear
   el mousemove de la herramienta Colocar. Es el ~70% de la percepción de "herramienta natural".
2. **GROSOR 2D**: barras a ~3px round-cap (hoy 1.6px non-scaling = 1px, regresión vs maqueta 3.2px).
   **Separar los 2 ganchos del estribo** en la proyección de sección con offset visual de ½φ cada uno
   (o 1φ a un lado) para que NO se lean como una sola línea.
3. **CLAMP al hormigón**: fuera del boundary el ghost se pone rojo + cursor `not-allowed` y el clic no
   hace nada (o se pega al borde válido más cercano). `boundaryDeVista()` YA existe: usarla como REJA de
   validación, no solo para el bbox. Mata "barras al aire".
4. **Ctrl+Z** (undo de la última colocación) — tabla stakes, hoy ausente.

### SNAP DE CARA + HANDLES (v2 del mismo lote, va en este workflow)
- Al acercar el cursor a una cara del hormigón: HIGHLIGHT de esa cara (línea gruesa) y el ghost se pega
  a ella. El usuario elige cara VIENDO, no adivinando (hoy `_caraDefault` adivina con host.y>=0).
- HANDLES/nodos SOLO en la vista donde tienen sentido (no en las 3 a la vez). Color por eje (X rojo /
  Y verde / Z azul). Handles aparecen SOLO al seleccionar la pieza (no permanentes en las esquinas del
  hormigón). Atenuar handles de las otras vistas cuando hay un plano de trabajo activo (reusar P3, el
  resaltado de plano activo ya implementado).

### CORRECCIONES INTERNAS (yo, sin decisión del usuario)
- En SECCIÓN, un cabezal se mueve SOLO a lo ancho (Z), NUNCA en Y (la Y la manda el sistema de capas
  `distribuidorLayered`). Hoy `_dragMover` escribe `pos_hint.y` en sección -> choca con capas (triple
  contabilidad de Y: layered + pos_hint + retranqueo). PROHIBIR pos_hint.y en cabezales.
- Prioridad/retranqueo/dependencias (resolverDependencias) queda FUERA de la UI de arrastre de este
  lote (el dato ya está guardado; no activar el 3er offset de Y/Z en interacción todavía).
- MURO/COLUMNA: "misma máquina" es cierto para colocar/rotar/mover, pero el distribuidor GRID (malla
  2D) es stub. Con el modelo ARREGLO (rango+capas) de arriba, la malla se cubre SIN distribuidorGrid
  nuevo (arreglo rango×capas + plano de trabajo). Verificar en implementación.

### ALCANCE DE ESTE WORKFLOW (cerrado)
Entra: ghost+badge, grosor+ganchos, clamp, Ctrl+Z, 3 modos independientes de la tipología con preset+
override (botoncitos), rotar-plano-de-pieza (botón sobre la pieza + tecla R), snap de cara con highlight,
Lógica A (cara+capas panel), Lógica B (rango en vista según plano, rotación habilita otro eje), Lógica C
(arreglo rango+capas por plano de trabajo), handles por-vista con color por eje, correcciones internas.
NO entra: boundary visual de barra editable <-> offset (después), soportes de losa 3D (después), activar
retranqueo/prioridad en arrastre (después).


## §GAP-ANALYSIS-TE (10-ago) — Auditoría del Template Editor vs. este programa

Producido por workflow (agentes de diagnóstico, read-only) contra el código en el commit del estribo
resuelto (6bce693). ES LA LISTA DE TRABAJO VIGENTE del Template Editor: cada ítem tiene severidad
(CRÍTICO/IMPORTANTE/DETALLE), la cita del doc que lo respalda y el archivo:línea. Los 5 agentes de
implementación NO alcanzaron a correr (límite de sesión) — el workflow se reanuda con
resumeFromRunId: wf_378b1aad-716.

TITULARES (lo más grave descubierto, no estaba en el radar):
- G7 CRÍTICO · La INTERACCIÓN 2D está MUERTA en modo ortográfico: `if (ST.ortoActivo) return;`
  (template_editor.js ~1008) corta el dibujo de barras+hit-testing, nodos, flecha de rango y cotas.
  En producción NO se puede seleccionar/mover una barra clicándola en las vistas; sólo desde el panel.
  Es prerrequisito de casi todo lo demás.
- G3/B3 CRÍTICO · Voltear plano (tecla R) es DECORATIVO: sólo cambia la proyección SVG, nunca llega
  al motor; los distribuidores reparten SIEMPRE en X. Y _aplicarPostTransform rota en torno al ORIGEN
  DEL HOST → por eso se pierde el anclaje al recubrimiento. El fix correcto es permutación de ejes
  en el motor (reglas.js) para que el volteo sea geometría real y el recub se mantenga por
  construcción, y luego eliminar _proyectorVolteado.
- G2 CRÍTICO · Guardar/Abrir template SIN cablear (botones sin id ni handler; cero fetch en
  template_editor.js) → el trabajo se pierde al recargar. Backend POST/GET /templates YA existe.
- G1 CRÍTICO · Pantalla previa del sub-tab NO existe (nombre + estructura + dimensiones + lista de
  guardados), contra la decisión cerrada de discovery.



########## AGENTE 1 ##########
DISEÑO UX — Pantalla previa del sub-tab Templates + flujos del modal (READ-ONLY, listo para implementar).

=====================================================================
1. PANTALLA PREVIA (reemplaza el contenido actual de #catSubTemplates en catalogo.html, líneas 235-256)
=====================================================================
Estructura: 2 cards apiladas dentro de #catSubTemplates (estilo plataforma: .card con border-top:3px solid #558B2F, títulos h3 color #558B2F, textos .muted 12px — igual que los otros sub-paneles del catálogo).

CARD 1 — "🧱 Nuevo template"
---------------------------------------------------------------
| 🧱 Nuevo template                    [Colocador por proyecciones] |
| Elige el elemento, define el hormigón y ponle nombre.            |
|                                                                   |
| ELEMENTO                                                          |
| [🧱 MURO] [⬜ LOSA] [📏 VIGA] [🏛 COLUMNA] [🪨 FUNDACION] [📦 GEN] |
|                                                                   |
| DIMENSIONES DEL HORMIGÓN (cm)          RECUBRIMIENTOS (cm)        |
| Largo [600]  Alto [60]  Ancho [30]     Sup [4] Inf [4] Lat [3]    |
|                                                                   |
| NOMBRE DEL TEMPLATE                                               |
| [Viga fundación tipo A________________]  [🧱 Crear template]      |
---------------------------------------------------------------

(a) Selector de ELEMENTO — id contenedor: tplElemGrid. 6 botones-card en fila (flex-wrap), orden CANÓNICO: MURO · LOSA · VIGA · COLUMNA · FUNDACION · GEN. Cada botón: id tplElemBtn_MURO … tplElemBtn_GEN, data-elem="MURO", ~92px ancho, ícono arriba (emoji 20px) + nombre abajo (11px, font-weight:700). Íconos: MURO 🧱, LOSA ⬜, VIGA 📏, COLUMNA 🏛, FUNDACION 🪨, GEN 📦. Estado normal: border 1px solid #dbe1e8, fondo #fff. Seleccionado: border #558B2F, fondo #f7fbf2, color #33691e. Hover: border #8BC34A. Default al entrar: VIGA seleccionada (único elemento con máquina completa hoy). Click → repinta la sección de dimensiones (tplDims) con los campos del elemento y sus defaults, y pone foco en el primer campo de dimensión NO — foco queda donde está (no robar foco al explorar); solo al click en nombre.

(b) DIMENSIONES — id contenedor: tplDims (se re-renderiza por elemento desde una tabla declarativa local TPL_DIMS_POR_ELEMENTO, espejo del espíritu de PLANOS_POR_ELEMENTO). Inputs type=number, width 70px, font-size 12px, label 10.5px .muted arriba. IDs genéricos por clave: tplDim_largo, tplDim_alto, tplDim_ancho, tplDim_recub_sup, tplDim_recub_inf, tplDim_recub_lat, tplDim_espesor, tplDim_b, tplDim_h, tplDim_recub (según elemento). Campos y defaults (cm):
  · VIGA: Largo 600 · Alto 60 · Ancho 30 | Recub sup 4 · inf 4 · lat 3  (= semilla_viga.js:41, NO inventar otros)
  · MURO: Largo 400 · Alto 250 · Espesor 20 | Recub caras 2.5 · bordes 3
  · COLUMNA: Alto 300 · b 40 · h 40 | Recub 4
  · LOSA: Largo 500 · Ancho 400 · Espesor 15 | Recub sup 2.5 · inf 2.5
  · FUNDACION: Largo 300 · Ancho 100 · Alto 80 | Recub 5
  · GEN: Largo 300 · Alto 100 · Ancho 100 | Recub 4
Validación mínima (en input/change): dims > 0; recubrimientos ≥ 0 y (suma de recubs opuestos) < dimensión de esa cara (ej. sup+inf < alto). Campo inválido: border #c62828 + mensajito único bajo la grilla (id tplDimsErr, 10.5px, color #c62828): "Revisa las dimensiones marcadas." Vacío o inválido ⇒ Crear deshabilitado.

(c) NOMBRE — input id tplNombre, placeholder "Nombre del template (ej. Viga fundación tipo A)", maxlength 80, width 100% máx 360px. trim() para validar. Enter en el input = click en Crear si está habilitado.

(d) BOTÓN CREAR — id tplBtnCrear, texto "🧱 Crear template", estilo botón primario acero (background #8BC34A, hover #558B2F, color #fff, radius 8px, font-weight:700 — igual al botón actual línea 251-254). disabled si nombre vacío O dims inválidas (opacity .5, cursor default, title "Ponle nombre y revisa las dimensiones"). Click → templateEditorAbrir({ elemento, nombre, dims }) (extender la firma actual de template_editor.js:2511 que hoy no recibe args): construye ST.receta con geometria desde dims (SIEMPRE rectángulo de hormigón), componentes:[], y abre el modal ya configurado. Para VIGA con las dims-default puede seguir ofreciéndose la semilla NO — discovery manda hormigón listo y vacío de fierros; la semilla queda solo para tests.

CARD 2 — "📂 Templates guardados"
---------------------------------------------------------------
| 📂 Templates guardados                          [n templates]     |
|  NOMBRE                    TIPO      FECHA         CREADO POR     |
|  Viga fundación tipo A     VIGA      07-08-2026    eugenio…  [Abrir] |
|  Muro perimetral M1        MURO      05-08-2026    …         [Abrir] |
---------------------------------------------------------------
IDs: card tplGuardadosCard, contador tplGuardadosCount (span .muted 11px, "3 templates"), contenedor lista tplGuardadosLista. Al entrar al sub-tab (switchCatSubTab('templates') en catalogo/index.js:33 → llamar nueva función global tplCargarGuardados()): estado de carga "<div class='muted'>Cargando templates…</div>"; luego fetch GET /templates → tabla simple (mismo look de tablas del catálogo: filas 12px, header 10.5px uppercase .muted). Columnas: Nombre (bold) · Tipo (chip 10px uppercase con el color del elemento) · Fecha (dd-mm-aaaa desde ISO) · Creado por · botón "Abrir" (id-less, data-id={id}, estilo ghost: border 1px #dbe1e8, radius 7px, 11.5px). Click Abrir → GET /templates/{id} → templateEditorAbrir({ elemento: tipo.toUpperCase(), nombre, dims: params.geometria, receta: params, templateId: id }). Error de red: "<div class='muted'>No se pudieron cargar los templates. <a onclick=tplCargarGuardados()>Reintentar</a></div>". Estado vacío: "<div class='muted'>Aún no hay templates guardados. Crea el primero aquí arriba.</div>".

=====================================================================
2. DENTRO DEL MODAL (template_editor_modal.html + template_editor.js)
=====================================================================
· TÍTULO (te_titlebar, líneas 226-236): h1 → "Template Editor — Viga" (elemento capitalizado); .te-sub → "Construyendo: <b id=te_subNombre>{nombre}</b> · Catálogo › Templates". ELIMINAR el segmented .te-seg Viga/Muro/Columna (línea 233) — la estructura se elige FUERA del modal (discovery); en su lugar un badge estático id te_elemBadge (chip .te-chip con el nombre del elemento). Botón "📂 Abrir" (línea 234): onclick → si hay cambios sin guardar confirm("Hay cambios sin guardar. ¿Volver a la lista igual?"); si acepta (o no hay cambios) → templateEditorCerrar() y quedar en la pantalla previa (que ya lista los guardados — NO duplicar una mini-lista dentro del modal).
· RIBBON TIPOLOGÍAS (te_tipbtns, líneas 256-262, hoy hardcodeado viga): renderizar dinámico desde espejo local TPL_TIPOLOGIAS (copia 1:1 de _TIPOLOGIAS_SEED, catalogo.py:99-114) según ST.elemento. Botón = <span class="te-tipbtn" data-tip="{codigo}" title="{nombre}"> con swatch .te-sw. Colores: mapa TPL_COLORES por código; viga conserva los existentes (CBS #1565c0, CBI #00897b, ES #e65100, TRV #7b1fa2, LT #607d8b); para el resto asignar por ROL para que el color signifique lo mismo en todos los elementos: principales/cabezales-mallas azul #1565c0 y teal #00897b (segunda capa/cara), estribos-confinamiento naranja #e65100, trabas púrpura #7b1fa2, soportes/reparticiones gris #607d8b, refuerzos índigo #5e35b1, n-capas variante clara del mismo tono. Si un elemento tiene >6 tipologías (LOSA tiene 9), el ribbon hace wrap (flex-wrap) — no scroll horizontal.
· GUARDAR (footer, botón línea 392): darle id te_btnGuardar, onclick templateEditorGuardar(): POST /templates con body {nombre: ST.nombre, tipo: ST.elemento.toLowerCase(), params: ST.receta} — OJO: el campo del backend es "params", NO "receta" (modelador.py:45-49). Estados del botón: normal "💾 Guardar template" → durante fetch disabled + "Guardando…" → éxito "✓ Guardado" 1.5 s y volver a normal, marcar receta limpia (guardar hash) y refrescar la lista del tab (tplCargarGuardados()) → error: re-habilitar + mensajito rojo junto al footer (id te_saveErr, 11px): "No se pudo guardar: {detail}". Si el template vino de "Abrir" (tiene templateId) el POST crea una COPIA nueva (el backend no tiene PUT) — texto del botón en ese caso: "💾 Guardar como nuevo" (dejar PUT/versionado como pendiente).
· Footer botón "✓ Usar en el despiece": queda como está (comportamiento pendiente en el doc §6, línea 416-418 — no diseñar aquí).

=====================================================================
3. FLUJO DE SALIDA
=====================================================================
Dirty-tracking simple: al abrir y tras cada guardado exitoso, ST._recetaGuardada = JSON.stringify(ST.receta); hayCambios() = JSON.stringify(ST.receta) !== ST._recetaGuardada. templateEditorCerrar() (js:2534) y el click en backdrop (js:2547) y el botón ✕ pasan todos por: if (hayCambios() && !confirm("Hay cambios sin guardar. ¿Cerrar igual?")) return; — confirm() nativo, coherente con la plataforma (mismo patrón ELIMINAR de lotes). Tecla Esc: mismo camino.

=====================================================================
4. SENSACIÓN "BIEN PENSADO"
=====================================================================
· Al abrir el sub-tab: VIGA preseleccionada con sus defaults ya puestos — un usuario puede escribir solo el nombre y crear en 2 acciones.
· Cambiar de elemento NUNCA borra el nombre escrito; solo re-renderiza dims con defaults del nuevo elemento.
· Foco inicial del modal: herramienta "mover" activa (como hoy); en la pantalla previa no se roba foco.
· Textos cortos ya especificados arriba; todo en español; nada de párrafos largos (reemplazan los 2 párrafos introductorios actuales de las líneas 241-250).
· El chip de tipo en la lista usa el mismo color del elemento para reconocimiento cruzado tab↔modal.

ARCHIVOS A TOCAR EN LA IMPLEMENTACIÓN (para el merge del orquestador):
· armahub/templates/tabs/catalogo.html — reemplazar interior de #catSubTemplates (líneas 235-256).
· armahub/static/js/features/catalogo/index.js — switchCatSubTab: al entrar a 'templates' llamar tplCargarGuardados() (si existe).
· armahub/static/js/features/modelador/template_editor.js — extender templateEditorAbrir(cfg), nuevo templateEditorGuardar(), render dinámico del ribbon, dirty-check en cerrar, espejo TPL_TIPOLOGIAS/TPL_COLORES/TPL_DIMS_POR_ELEMENTO (resolver deps DENTRO de funciones, regla 1).
· armahub/templates/tabs/template_editor_modal.html — titlebar (quitar te-seg, badge + te_subNombre), id te_btnGuardar, ribbon vaciado para render dinámico.

--- PENDIENTES ---
1) Backend sin PUT /templates/{id}: "Guardar" sobre un template abierto crea copia — decidir si se agrega PUT (edición real) o se acepta "Guardar como nuevo". 2) Campo obra del POST: la pantalla previa diseñada no pide obra (queda null=general); confirmar si se quiere selector de obra. 3) Colores de tipologías no-viga: propuse mapa por rol — validar con el usuario los tonos exactos. 4) "Usar en el despiece" sigue pendiente de definición (doc §6). 5) MURO/LOSA/COLUMNA/FUNDACION/GEN: la pantalla previa ya los ofrece, pero la máquina del modal solo tiene VIGA poblada en PLANOS_POR_ELEMENTO — decidir si los otros 5 botones van deshabilitados con tooltip "Próximamente" o habilitados (recomiendo deshabilitados hasta poblar la tabla).

########## AGENTE 2 ##########
GAP-ANALYSIS Template Editor vs programa_modelador_3d.md (leído completo, 953 líneas) + TAREAS. Suite completa PASA (140.3 kg / 72 placements / 4 items).

=== 1. DEFINICIONES DEL DISCOVERY NO IMPLEMENTADAS ===

[CRÍTICO] G1 · Pantalla previa del sub-tab NO existe. Decisión cerrada ("La selección de ESTRUCTURA va FUERA del modal… se entra con el tipo elegido y el hormigón listo"; §0-7ter; §DISCOVERY-INTER 6 "el NOMBRE del template se define en el TAB antes de entrar"). catalogo.html:235-256 (catSubTemplates) = solo intro + botón "Abrir Template Editor". Falta: campo nombre, selección de estructura (orden canónico MURO·LOSA·VIGA·COLUMNA·FUNDACION·GEN), lista de templates guardados (GET /templates ya existe en modelador.py), rectángulo de hormigón inicial. Título del modal hardcode "Construyendo: Viga tipo Explora" (modal:230).

[CRÍTICO] G2 · Guardar/Abrir template SIN cablear. Botones "💾 Guardar template" (modal:392), "📂 Abrir" (modal:234) y "✓ Usar en el despiece" (modal:393) NO tienen id ni handler. template_editor.js tiene CERO llamadas backend (grep /templates|fetch = solo panel_3d.js). El trabajo del usuario se pierde al recargar. Backend POST/GET /templates listo y sin consumidor desde este modal. (§0-4ter "guardar como template = corazón del diseño").

[CRÍTICO] G3 · Voltear plano NO cambia la LÓGICA de distribución. §INTERACCIÓN-2.0: al voltear, el estribo "de canto + su RANGO (tanda hacia la profundidad)… habilita distribuir en el otro eje (fundación: cualquiera de los 2 ejes)". Implementado SOLO como cambio de proyección SVG (_proyectorVolteado, te.js:624) que además es INVISIBLE en modo orto (ver G7): distribuidorLinear/Arreglo distribuyen SIEMPRE en X (reglas.js:182-219 "a lo largo del eje X"; _rangoClick usa from.x/to.x te.js:1568; flecha rango solo en largo/planta te.js:1093). Presionar R hoy no produce ningún cambio visible ni funcional. El mecanismo modular clave del rediseño queda decorativo.

[IMPORTANTE] G4 · Dims dinámicas desde el catálogo REAL (§0-6ter "leídos de figuras_catalogo.parciales"). te.js:104-112 FIG = espejo hardcode de 8 figuras; cualquier otra figura cae a {parciales:['A']} silenciosamente. datalist te_figs solo 6 opciones (modal:396). catalogo.py tiene 30+ figuras y GET del catálogo ya existe.

[IMPORTANTE] G5 · Tipologías del ribbon hardcode VIGA (modal:256-262: CBS/CBI/ES/TRV/LT). §MURO/COLUMNA: "las tipologías disponibles (del catálogo por estructura)". catalogo.py:98-115 _TIPOLOGIAS_SEED las tiene todas. Tampoco se muestra el chip de modo preset en el botón (CSS .te-mode existe, modal:62, sin uso).

[IMPORTANTE] G6 · PLANOS_POR_ELEMENTO solo viga (te.js:549-557, muro/columna = TODO comentado). Prerrequisito muro (P2, veredicto SÍ).

[IMPORTANTE] G7bis · HANDLES según spec: "SOLO al seleccionar la pieza, color por eje X rojo/Y verde/Z azul, solo en la vista donde tienen sentido, atenuar otras vistas". Lo implementado (_dibujarNodos te.js:1106) son nodos PERMANENTES de las 4 esquinas del HORMIGÓN, un solo color, en las 3 vistas — y además muertos en modo orto (G7). No hay handles de la pieza.

[IMPORTANTE] G8 · Empalme sin UI. Motor completo (reglas.js evalEmpalme:141, dims alargadas:426-436, tests pasan) pero el panel no tiene campo empalme (§E veredicto: "Incluye empalmes (A)").

[DETALLE] G9 · Ghost en vista longitudinal no dibuja la "FORMA REAL de la barra" (§DISCOVERY-INTER 1): _ghostForma te.js:817 dibuja línea recta, sin patas de la figura.
[DETALLE] G10 · Cotas: doc pide "indicar TRAMOS de estribo/distribución (zonas @)"; _dibujarCotas te.js:1068 solo acota W/H del hormigón (y está muerta en orto, G7).
[DETALLE] G11 · Aristas del eje X (extremos) no anclables (_caraDeEje te.js:724 devuelve null) — limita fundación.
[DETALLE] G12 · esArco (flag perf figura_puntos) no existe aún (frente perf, otro agente).

=== 2. MAL IMPLEMENTADAS ===

[CRÍTICO] B3-raíz · Rotación pierde el anclaje al recubrimiento (bug reportado). reglas.js:339-365 _aplicarPostTransform rota cada punto EN TORNO AL ORIGEN DEL HOST: una pieza anclada en cara sup (y=alto/2−recub) al rotar 90° se traslada a otra posición del volumen. §DISCOVERY-INTER 2 define rotar "en torno a la profundidad del plano… se ve girar de frente ___| → |___" = rotar sobre su propio centro/anclaje y RE-ANCLAR al recubrimiento. Fix: rotar respecto del centroide del placement (o del anchor) y re-aplicar el anchor de cara tras rotar.

[CRÍTICO] G7 · Interacción 2D MUERTA en modo orto (Etapa A). te.js:1008 `if (ST.ortoActivo) return;` corta _dibujarVista2D ANTES de dibujar barras+hit(data-ci), nodos, flecha de rango, cotas y ghost de 1er clic de rango. ortoActivo=true apenas carga Three (te.js:401) → en producción: NO se puede seleccionar/mover una barra clicándola (mousedown busca data-ci/data-node/data-rango que ya no existen, te.js:1412-1462), nodos de redimensión desaparecidos, flechita ↔ desaparecida, toggle Cotas sin efecto. Solo queda seleccionar desde el panel izquierdo. Contradice §DISCOVERY-INTER 4 y 5 ("clic en una barra → se selecciona; mover y borrar desde la vista"). Es el gap estructural más grave: el hit-testing debe reconstruirse sobre el overlay SVG (los transforms SÍ se guardan, te.js:987) o por picking del render orto.

[CRÍTICO] B1 · Slider de corte: modal:320,334,347 `<input type="range" min="0" max="100" value="50">` SIN step fino → 100 pasos; en sección (depth=x, viga 600) ≈6 cm/paso. Además _encuadrarOrto te.js:2250 snapea a la rebanada más cercana solo en depth=x; en largo/planta el paso grueso se siente directo.

[CRÍTICO] B2 · Sección YZ: la banda fina de clipping (te.js:2250-2266 + _renderVistasOrto:2318-2338) corta los cilindros de los longitudinales SIN tapas y con MeshStandardMaterial single-sided (te.js:384-393) → los "círculos apagados/de otro color" son el interior/backface del cilindro cortado; en los extremos la banda cae sobre las patas de gancho del 103B → "aparecen patas". Fixes candidatos: side:DoubleSide o stencil caps para el corte, y/o excluir longitudinales del clip en sección (siempre cruzan el corte).

[IMPORTANTE] G13 · Centrar/Repartir sin efecto. Panel escribe d.justify (te.js:1758-1764) pero distribuidorLayered (reglas.js:225-248) SIEMPRE reparte a lo ancho (z de −zHalf a +zHalf); justify no se lee. §INTERACCIÓN-2.0 A lo exige como "control EXPLÍCITO". Igual el "espaciamiento" de barras/capa del panel A no existe (solo gap entre capas).

[IMPORTANTE] G14 · Check "tomar contorno" = dato muerto. te.js:143 escribe dims.__contorno=false y NADIE lo consume (grep único hit). El estribo colocado siempre toma el recubrimiento; con el check apagado el ghost dibuja al borde (te.js:831) pero el resultado real no cambia → ghost ≠ resultado. §DISCOVERY-INTER 1: "Recub=0 → la barra se ajusta al contorno".

[IMPORTANTE] B4 · Gizmo = cuadro de texto. te.js:600-609 genera spans de texto ("X largo →…") en .te-vgizmo (modal:123). El usuario pide el triad de flechitas estándar de modelador (y el cuadrante 3D no tiene gizmo alguno).

[DETALLE] G15 · _caraDefault sigue existiendo como fallback (te.js:1203-1206, adivina con host.y>=0) — aceptable como fallback, pero con el ghost muerto en vista largo para cabezales (línea a lo largo) el usuario no siempre pasó por una cara.

=== 3. IMPLEMENTADO QUE EL DOC NO PEDÍA / MOLESTA ===

[IMPORTANTE] X1 · Selector "Viga|Muro|Columna" DENTRO del modal (modal:233, te-seg) sin cablear: contradice la decisión "la selección de estructura va FUERA del modal" Y el orden canónico. Quitar cuando exista la pantalla previa.
[IMPORTANTE] X2 · Botón "✓ Usar en el despiece" en el footer del Template Editor contradice el flujo D definitivo (§DISCOVERY-INTER-2.D: el Template Editor "SOLO crea/edita templates y los deja guardados. NADA más"; el uso va por Fabricator→Enfierrador). Debería ser solo Guardar.
[DETALLE] X3 · Doble modelo de arreglo: comp.arreglo {n_capas,sep_capas,rango} (normalizado en reglas.js:100-106, semilla) NUNCA se usa — el panel y el motor usan distribucion.n_capas/sep_capas/eje_capas/rango. Dato duplicado que confundirá persistencia de templates.
[DETALLE] X4 · Herramienta "⟳ Rotar" del toolbar (modal:279) no hace nada al clicar en vista (te.js:1459 comentario: "clic en vacío no hace nada") — solo cambia el cursor; la rotación real va por ESPACIO/+90°. Botón engañoso.

=== 4. ESTADO REAL VERIFICADO ===
· Modos puntual/lineal/arreglo: motor OK (distribuidorArreglo real, tests pasan; alternar modos conserva rango/@/capas via _setModoComp). Limitación: todo distribuye SOLO en X (G3).
· Rotar plano (R + botón te_flipBtn): cableado (tecla R te.js:2066, botón flotante _posicionarFlipBtn) pero SIN efecto visible en modo orto y sin efecto lógico (G3).
· Snap de cara: FUNCIONAL (highlight + pega ghost + manda la cara al colocar; solo herramienta Colocar).
· Rango 2 clics: funcional (con clamp), pero sin feedback del 1er clic ni flechita en modo orto (G7).
· Ctrl+Z: FUNCIONAL (pila 60, snapshot antes de mutar, sin redo — según alcance).
· Ghost: FUNCIONAL (forma por rol, badge tipología+ø, clamp rojo not-allowed).
· Panel contextual por modo: FUNCIONAL (3 botones + campos por modo).
· Guardar/cargar template: NO cableado (verificado: cero fetch en template_editor.js; botones sin id).
· Pantalla previa: NO existe (verificado catalogo.html:235-256).
· Multi-elemento: solo viga (PLANOS_POR_ELEMENTO te.js:549; muro/columna TODO).
· Tipologías ribbon: hardcode viga en HTML (modal:256-262).
· Dependencias/prioridad/retranqueo: motor implementado (generar.js resolverDependencias:163-253), sin UI — CONFORME al alcance ("NO entra: activar retranqueo/prioridad en arrastre").
· Backend modelador.py POST/GET /templates: existe, solo lo consume panel_3d.js (3D Template), no el Template Editor.

--- PENDIENTES ---
Para el orquestador, orden sugerido de ataque: (1) B1 slider paso fino (step + mapeo por cm) — trivial; (2) B2 corte: DoubleSide/caps o excluir longitudinales del clip en sección; (3) B3 rotación: rotar sobre centroide/anchor + re-anclar al recubrimiento (reglas.js _aplicarPostTransform); (4) B4 gizmo triad SVG; (5) G7 restaurar interacción sobre el overlay (hit-testing con los transforms ya guardados) — prerrequisito de casi todo lo demás; (6) G2 cablear Guardar/Abrir a modelador.py; (7) G1 pantalla previa del sub-tab (nombre+estructura+lista, orden canónico) y quitar el seg del modal + botón "Usar en el despiece" (X1/X2); (8) G3 distribución en eje según plano volteado; (9) G4/G5 leer figuras y tipologías del catálogo real; (10) G13/G14 justify y tomar-contorno funcionales o quitarlos. Decisión de usuario pendiente que el doc ya anota: mecánica exacta de "Usar en el despiece" (Enfierrador vs carga directa) — no bloquear por ella.

########## AGENTE 3 ##########
DIAGNÓSTICO READ-ONLY B1-B4 (no se editó ningún archivo).

B1 — SLIDER YZ DISCRETO.
Causa raíz: armahub/templates/tabs/template_editor_modal.html:320 (y 334/347): <input type=range class="te-vcut-r" min=0 max=100 value=50> SIN atributo step → step default = 1 (100 posiciones). Handler en template_editor.js:2119-2127: o.corte = Number(r.value)/100. En SECCIÓN·YZ el eje de profundidad es X = largo (PLANOS_POR_ELEMENTO.viga.seccion depth:'x', template_editor.js:551; _espesorProfundidad:2136-2141): 1 paso = 1% de 600 cm = 6 cm/paso. En A LO LARGO (depth=z, ancho 30) es 0.3 cm y en PLANTA (depth=y, alto 60) 0.6 cm — por eso solo YZ se siente grueso.
Fix propuesto: agregar step="0.1" (0.6 cm en viga de 600; step="any" también sirve para arrastre continuo) a los 3 inputs .te-vcut-r (líneas 320, 334, 347). El handler ya es float-safe (divide por 100 y clampa); no requiere cambio JS. Nota: en sección el snap a rebanadas (_sliceMasCercana, 2197-2205) domina cuando hay estribos, pero el step fino es necesario para el caso sin estribos y para las otras vistas/elementos futuros con depth grande.

B2 — LONGITUDINALES INVISIBLES / CÍRCULOS APAGADOS.
Causa raíz (a) invisibilidad: en SECCIÓN la banda de corte son 2 clipping planes perpendiculares a X (template_editor.js:2318-2332) con semigrosor fino snapeado al estribo (2250-2261: corteGrosor = diam*1.4). Los longitudinales son CylinderGeometry a lo largo de X vistos EXACTAMENTE de punta por la cámara orto (eye [1,0,0], _ORTO_DIR:2089): la banda fina en el centro recorta AMBAS tapas del cilindro → queda un tubo abierto cuyo manto se ve de canto (0 px) y cuyo interior son back-faces (MeshStandardMaterial side=FrontSide default, líneas 384-388) → se culean → NO se pinta nada. El comentario de diseño (2238: "sus círculos se ven SIEMPRE") asume tapas que el clipping elimina.
Causa raíz (b) extremos: al llevar el slider a un extremo la banda alcanza el FIN de la barra: la tapa +X (normal hacia la cámara) entra en la banda → círculo visible; pero la luz direccional principal dir(1,1.4,0.8) intensidad 0.7 (línea 380) da dot≈0.52 con la normal +X y con metalness 0.5 la componente ambiente se apaga → "círculos apagados/de otro color". En el extremo opuesto la tapa tiene normal -X (back-face, invisible) y lo que cruza la banda son las PATAS A/C del 103A (corren en Y) → "aparecen patas". Todo coincide con el reporte textual.
Fix propuesto (2 partes, sin tocar el 3D perspectivo):
 1. NO clipear las barras que corren a lo largo del eje de profundidad de la vista: al construir cada mesh de barra guardar su span por eje en mesh.userData (ya existe el criterio exacto en _slicesEnProfundidad:2161-2192 — "no rebanada" = span en depth > umbral); en _renderVistasOrto, antes de render de cada vista, asignar los planos de clipping por MATERIAL LOCAL (renderer.localClippingEnabled ya está en true, línea 375) solo a los meshes "rebanada" para ese depth (requiere material por-mesh o clon por rol), dejando los longitudinales sin clip en esa vista → cilindro completo visto de punta = su tapa cercana se pinta como círculo correcto y estable. Restaurar renderer.clippingPlanes=[] global como hoy (2338).
 2. Luz frontal por vista orto: crear una DirectionalLight extra (p.ej. intensidad 0.5) que en _renderVistasOrto se posicione en el eye de cada vista (dir de _ORTO_DIR) con visible=true solo durante los 3 renders orto y visible=false antes del render perspectivo en _loop → las tapas/secciones se ven bien iluminadas sin alterar el 3D. (THREE resuelto dentro de la función — regla dura 1.)

B3 — VOLTEAR PLANO PIERDE EL ANCLAJE AL RECUBRIMIENTO.
Causa raíz: plano_pieza.volteado hoy es SOLO un cambio de proyección SVG, jamás llega al motor. Evidencia: rotarPlanoPieza (template_editor.js:1250-1258) solo togglea el flag y regenera; grep en reglas.js/generar.js/figura_puntos.js: el único uso es la normalización del campo (reglas.js:93-97); generar.js: 0 matches. _baseDeComponente (reglas.js:439+) y los distribuidores (distribuidorLinear:202-212 reparte SIEMPRE en X; distribuidorLayered:230-241 ancla SIEMPRE y=alto·cara sup/inf y z=ancho−recubLat) y _dims auto (reglas.js:403-425) están cableados a la orientación NO volteada. Consecuencias visibles: (1) la geometría 3D/orto no rota nunca (el doc §INTERACCIÓN-2.0 exige "cambia su proyección Y su lógica": distribuir en el otro eje); (2) el overlay SVG sí usa _proyectorVolteado (624-626) en el bbox (972-975), lo que INFLA el transform de la vista (un volteado en sección mete u=x∈[-300,300] contra hormigón de 30) → ST.transforms (987) queda desalineado del render orto (encuadre independiente en _encuadrarOrto:2207) → recub/ghost/botón flip descolocados; (3) al ARRASTRAR una pieza volteada, _pixelToUV→_clickHost→_dragMover (1183-1189, 1492-1517) invierten con el proyector NORMAL (u→def.u), escribiendo pos_hint en el eje equivocado → la pieza se despega físicamente del recubrimiento. Eso es "se pierde el fix al recubrimiento".
Comportamiento correcto y fix: voltear debe ser un cambio REAL de geometría que conserve el anclaje: permutación de ejes por componente resuelta en el motor. Concreto: en reglas.js, si comp.plano_pieza.volteado, intercambiar el eje del plano de la figura con el eje de distribución (estribo: figura (z,y) repartida en x → figura (x,y) repartida en z), resolviendo dims 'auto' contra las dims del NUEVO plano (p.ej. lado = largo−2·recubExtremo en vez de ancho−2·recubLat) y el anchor contra el recub de las caras nuevas; los puntos generados salen ya rotados → todas las vistas (renders orto) lo muestran de canto/rotado y el recub se mantiene POR CONSTRUCCIÓN. Con volteado=false la ruta debe quedar byte-idéntica (protege test_generar 140.3 kg/72/4). Luego ELIMINAR _proyectorVolteado y sus 4 usos (624-626, 960/973/1017, 1290): con geometría real el proyector normal sirve para todo y desaparece el bbox inflado y el drag en eje equivocado. (Parche mínimo alternativo si el motor no se toca aún: excluir proyecciones volteadas del bbox 972-975 y usar la inversa (depth,v) en _clickHost/_dragMover para piezas volteadas — pero eso solo arregla el overlay, no cumple la semántica del doc.)

B4 — GIZMO DE TEXTO → GIZMO GRÁFICO.
Estado actual: .te-vgizmo es un div con 3 <span> de texto ("X largo →…") — CSS en template_editor_modal.html:121-126, divs en 310/328/342, contenido inyectado por _actualizarTitulosVista (template_editor.js:600-609, innerHTML). Además queda un .te-vaxes muerto (CSS línea 120, sin uso en HTML) — limpiar.
Fix propuesto: (a) VISTAS ORTO (estático, las cámaras orto no rotan): en _actualizarTitulosVista reemplazar el innerHTML por un mini SVG inline (~46×46, esquina inf-izq): flecha horizontal color _EJE_COLOR[def.u] con letra u, flecha vertical color _EJE_COLOR[def.v] con letra v, y símbolo ⊙ (círculo con punto, "hacia ti") color _EJE_COLOR[def.depth]; ya existe _EJE_COLOR (586: X #e53935 / Y #43a047 / Z #1e88e5). Se genera una sola vez por vista al abrir/cambiar elemento — cero costo por frame. (b) VISTA 3D: gizmo tipo modelador — escena secundaria con 3 ArrowHelper (o AxesHelper + sprites de letras) y cámara propia cuya orientación copia la cámara perspectiva cada frame (gizmoCam.position = dirección de la cámara normalizada ×5, lookAt(0,0,0)); render al final de _loop en un viewport chico (~64×64 px) en la esquina del cuadrante 3D usando el MISMO renderer con setViewport+setScissor (patrón ya usado en _renderVistasOrto:2333-2335), con renderer.clippingPlanes=[] y clearDepth antes del pase. THREE resuelto dentro de la función (regla dura 1). CSS: reusar la posición de .te-vgizmo; en el cuadrante 3D solo reservar la esquina (el dibujo lo hace el renderer, no el DOM).

--- PENDIENTES ---
Para el implementador: (1) B2 parte 1 requiere decidir cómo pasar a clipping LOCAL por material (material por mesh o clones por rol) sin romper el pase perspectivo ni el hack del hormigón (clippingPlanes:[] — verificar empíricamente en r160 que el hormigón sigue exento al mover los planos de global a local). (2) B3 fix de raíz toca reglas.js (_baseDeComponente, distribuidores, dims auto): correr TODA la suite y garantizar ruta volteado=false byte-idéntica (140.3 kg / 72 placements / 4 items); definir permutación exacta también para cabezales y trabas, no solo estribos. (3) Existe un desalineamiento LATENTE adicional (fuera de alcance de B1-B4 pero relacionado): ST.transforms del overlay SVG (bbox+MARGIN, línea 978-987) se calcula independiente del encuadre de la cámara orto (_encuadrarOrto margen 1.18 + zoom/pan que el transform NO conoce) → el hit/ghost puede no coincidir con el render orto tras zoom/pan; conviene abordarlo cuando se toque B3. (4) B4 3D: presupuesto de un render extra por frame en _loop (mini viewport) — coordinar con el frente de performance de panel_3d.js.

## PROGRAMA DE TANDAS PRE-PRODUCCIÓN (12-ago) — Template Editor

Modo de trabajo acordado: cada tanda se lanza como UN workflow (implementación + verificación
adversarial) cuando el usuario diga "avanza con la tanda N". No se mezclan tandas.

### ACLARACIONES BASE (dudas resueltas 12-ago)
- Los 4 cuadrantes son CUATRO CÁMARAS SOBRE LA MISMA ESCENA 3D (una sola geometría, fuente única =
  placements del motor). Nada se replica entre canvas. La limitación vertical NO es de vistas: es
  que los CONSTRUCTORES de figuras solo generan barras corriendo en X (o Z vía volteo).
- El catálogo real (63 figuras, GET /figuras-catalogo) EXISTE y define parciales/ángulos por figura.
  El Template Editor NO lo consume: usa espejos hardcodeados (FIG=8 figuras en template_editor.js,
  FIGURAS=5 en generar.js) — atajo del MVP. La "integración editor↔catálogo ya hecha" era del
  DISEÑADOR de figuras (que escribe al catálogo), no de este editor (que debe leerlo). T7 = conectarlo.

### TANDA 1 — MURO (motor de orientaciones + cara cortina + config muro)
1. BUG cara LATERAL (reportado 12-ago): _yBordeCabezal solo distingue sup/inf → 'lateral' cae a la
   rama inferior (reglas.js:639). Anclaje a CORTINA: cara lateral = pegado a la cara Z± con la pila
   de 'lat' (recub_lat / recub_caras). Prerequisito muro y bug vivo en viga hoy.
2. ORIENTACIÓN VERTICAL ("de pie"): generalizar el volteo (hoy permutación x↔z) a un set de
   permutaciones: acostada (identidad), volteada (x↔z), de pie (x↔y). Pilas y recubrimientos
   permutan igual que en el volteo (patrón ya probado). UI: el botón de voltear pasa a ciclar o a
   un mini-selector de orientación de pieza.
3. VISTAS/RIBBON POR ELEMENTO: PLANOS_POR_ELEMENTO.muro (elevación XY, sección YZ, planta XZ con
   nombres de muro), grupo HORMIGÓN del ribbon renderizado por elemento (muro: largo/alto/espesor +
   recub caras/bordes → mapean a host.ancho/recub_lat/…), pantalla previa habilita MURO.
4. TIPOLOGÍAS MURO del seed (_TIPOLOGIAS_SEED) en el ribbon; malla = arreglo (rango×capas) en las
   2 cortinas; trabas de muro cosen cortinas (ya existen como rol).
5. Verificación adversarial: composición orientación × pilas × anidado × tramos en muro 400×250×20.

### TANDA 2 — T7: CATÁLOGO REAL DE FIGURAS (contrato de datos)
1. generar.js y template_editor.js consumen GET /figuras-catalogo al abrir (cache en memoria +
   fallback al espejo actual si no hay red): parciales/ángulos reales → dims a las casillas
   correctas, kg correcto, validar_geometria pasa. Se eliminan los espejos como fuente primaria.
2. Campo FIGURA validado: datalist completo del catálogo; figura desconocida = borde rojo y no
   coloca (hoy acepta cualquier texto y sale kg=0).
3. Mapa figura→familia de dibujo (cabezal/estribo/traba) por metadatos del catálogo; figuras no
   dibujables por el editor (espirales 105x etc.) quedan EXCLUIDAS del datalist con tooltip.
4. Fix conexo: empalme solo en roles donde es real (cabezal); ocultarlo en estribo/traba (hoy suma
   kg fantasma sin mover el dibujo).
5. Auditoría matriz: 63 figuras × (dims auto, pilas, anidado, volteo, spin, empalme) con scripts.

### TANDA 3 — OTRAS ESTRUCTURAS (tras 1 y 2)
- COLUMNA: estribos en plano HORIZONTAL (XZ) repartidos en Y → tercera permutación del set de
  orientaciones (sale del patrón de Tanda 1); longitudinales verticales (de pie, Tanda 1); vistas.
- LOSA: muro acostado — mallas en 2 lechos (sup/inf), cabezales en X y Z ya existen; vistas + dims.
- FUNDACIÓN y GEN: solo configuración (vistas + dims + tipologías); el motor ya alcanza.
- Regla: si el motor de Tanda 1 quedó bien generalizado, esta tanda es ~pura configuración.

### TANDA 4 — PULIDO PRE-PRODUCCIÓN (cierre)
- Redondeo de dims (reglas de aproximación a definir con el usuario; hoy salen decimales sucios).
- Aviso al voltear cuando las dims auto cambian drástico (estribo volteado en viga = barras 12 m).
- Rotación deg que no cabe: comportamiento definido (hoy puede quedar fuera del hormigón).
- Radios fijos al anidar estribos (codos interpenetrados) — arcos explícitos como el gancho.
- PUT /templates (editar en vez de guardar-como-nuevo), ghost de pieza volteada, "tomar contorno".
- Homologación visual con el enfierrador 3D (toggle hormigón, vista iso, órbita por eje, temas).

## PROGRAMA DE TANDAS — ACTUALIZADO (13-ago, tras 3 auditorías read-only: TE / plataforma / integración)
Tandas 1 (muro, DESPLEGADA) y 2 (catálogo real, EN CURSO) siguen como están. Lo de abajo REEMPLAZA
a las viejas Tanda 3 y Tanda 4. Regla: BLOQUEA = no se abre a usuarios reales sin eso.
HOTFIX de lote×template (origen='manual' en DELETE/eliminar/purgar/contexto/plano +
template_instancia_id en BARRAS_COLUMNS): APLICADO 13-ago (commit 88d58a3).

### TANDA 3 — NO PERDER TRABAJO (BLOQUEA · S/M)
1. beforeunload + borrador en localStorage con "recuperar" al abrir (hoy F5 = template perdido).
2. Capear el motor ANTES de generar: mínimo de @ (hoy acepta 0.1 → 6001 placements), techo de
   n_capas y de placements totales (el warning anti-colapso avisa DESPUÉS de generar).
3. _dragNodo pasa por _geoValida (hoy deja ancho < 2·recub_lat que el ribbon rechaza); _undo()
   re-sincroniza el ribbon de HORMIGÓN (hoy el input queda mintiendo y el blur re-aplica).
4. Falso "cambios sin guardar": sellar _recetaGuardada DESPUÉS del primer _regenerar (normaliza).

### TANDA 4 — CICLO DE VIDA DEL TEMPLATE (BLOQUEA · M)
1. PUT /templates/{id} + DELETE + nombre editable en la UI (hoy guardar = INSERT siempre con el
   mismo nombre → biblioteca que solo crece).
2. schema_version + updated_at/editado_por; normalizador de apertura que rellene lado/orientacion/
   tramos/jerarquia en recetas guardadas viejas.
3. PERMISOS DESALINEADOS (bloquea): el TE vive en Catálogo pero POST /templates exige área
   cubicaciones → 403 al guardar tras diseñar todo. Y el GET lo lee cualquier autenticado
   (incluido cliente externo). Unificar.
4. obra real en templates (hoy null) + lista con filtro/buscador sin traer params completos.
5. Validar la receta en POST/PUT (hoy se guarda un template que nunca podrá generar barras).
6. CANDADO: congelar la escritura de templates del enfierrador MVP (usa dims numéricas contra el
   {modo,valor} del TE en la MISMA tabla → dos shapes incompatibles conviviendo).

### TANDA 5 — PARIDAD CON EL BACKEND DE BARRAS (BLOQUEA · S/M)
Cualquiera de estos manda 400 de la tanda ENTERA al cargar al despiece:
1. Pata en 0 (Math.max reglas.js) → _tiene_valor_real la lee vacía → slots_faltan.
2. radio: null siempre, con figuras que lo exigen (201A) — y _revisarFiguraComp deja pasar
   no-dibujables.
3. Mapear el error del backend (barra_idx) de vuelta al comp_id y marcarlo en el panel.
4. ang1..4 canónicos del catálogo vs el ángulo dibujado (BD desalineada con la geometría) +
   validar signo/rango en backend (hoy pasan dims negativas).

### TANDA 6 — OTRAS ESTRUCTURAS (M — puede salir después si urge abrir con viga/muro)
COLUMNA (estribos en XZ repartidos en Y = tercera permutación; longitudinales de pie), LOSA
(2 lechos), FUNDACIÓN y GEN (vistas + dims + tipologías). Prerrequisito: canonizar
TPL_DIMS_POR_ELEMENTO (COLUMNA usa b/h/recub, LOSA espesor — claves que el motor no conoce).

### TANDA 7 — INTEGRACIÓN CON EL ENFIERRADOR 3D (BLOQUEA el enfierrador · M/L)
Después de 4 (hay qué editar/versionar), 5 (las barras entran sin 400) y 6 (templates de todos
los elementos); antes del pulido.
1. El enfierrador NACE de un template (hoy: semillaViga() hardcodeada + prompt() numerado);
   selector real GET /templates; un solo shape de receta (el del TE).
2. La instancia guarda Δ, no copia: elementos_template.params = {template_id, overrides} (hoy
   template_id:null + receta entera clonada) + GET /elementos/instancia/{id} (hoy write-only) +
   módulo front instancia.js (resolución template+Δ→receta) compartido.
3. Trazabilidad de vuelta: template_instancia_id visible/filtrable en Bar Manager; ac2Payload
   propaga origen (hoy lo pierde).
4. Fix: panel_3d llama global.ac2CargarLote que NO existe (la grilla no refresca tras cargar).
5. El enfierrador consume el catálogo real (datalist de 6 hardcodeadas) — hereda Tanda 2.
DEF PENDIENTE (usuario): no existe entidad "elemento real de obra" con dims de hormigón (solo
lotes.sector/piso/ciclo/eje); ¿tabla de elementos o se sigue tipeando a mano en la instancia?

### TANDA 8 — BARRIDO DE USABILIDAD (S agrupada — post-apertura)
_mut() sin undo (jerarquía/cara/φ/figura/@/rango/capas/anidar) · redo + botón de deshacer ·
duplicar con offset (hoy copia exacta encima) · scrollIntoView del seleccionado · _compDesc con
orientación/jerarquía/empalme · orientación en la ficha (no solo el botón flotante) · Esc =
deseleccionar (hoy CIERRA el editor) · Ctrl+S / Ctrl+D / flechas nudge · "Ver en 3D" no-op.

### TANDA 9 — PULIDO PRE-PRODUCCIÓN (cierre · L)
Redondeo de dims (reglas con el usuario) · aviso al voltear cuando dims auto cambian drástico ·
rotación deg que no cabe · radios fijos al anidar (codos interpenetrados) · ghost volteado ·
"tomar contorno" · homologación visual con el enfierrador (toggle hormigón, vista iso, órbita
por eje, temas).

### TANDA P — MODELO DE POSE (EJECUTADA 13-ago, entre Tanda 3 y Tanda 4)
pose = {cara: sup|inf|lateral|extremo, lado ±, rumbo, espejo} = las 24 orientaciones de una caja;
UNIFICA cara/lado/plano_pieza.orientacion/volteado (que se derivan y quedan compat byte-idéntica).
`espejo` ≡ signo del longitudinal L (piezas planas: reflejo = media vuelta → un solo bit cierra el
grupo sin campo nuevo en la receta). rotarPose90(pose, ejeVista) = giro cerrado en las 24 (tecla R
gira en el eje de profundidad de la vista activa). POSES_DEFAULT por elemento × tipología (dato).
Convergió tras 5 rondas de verificación adversarial (D1-D5 → N1/N1b/N2 → F1/F2):
- D1 cadena de sección transpuesta/fuera · D2 _poseDe sin traducción local→mundo · D3 espejo=doble
  volteo · D4 rumbo sin signo (media vuelta inalcanzable) · D5 88/435 recetas viejas se mueven,
  TODAS intencionales (pose/anclaje/ladoDominante; las "peores" eran dims fijas).
- N1/N1b anchor absoluto sumado como delta + reparto sin descontar semiancho (raíz: _marcoCara
  publicaba cara ancla, dato falso) · N2 solver de autos lineal 2-puntos → piecewise.
- F1 capas de cadenas de sección TRASLADABAN en vez de anidar (inset concéntrico unificado con el
  marco) · F2 cadena dibujada sin φ/2 (recub efectivo ahora = al del estribo).
Verificación final: órbitas D4 72/72 de orden 4 (24 poses válidas × 3 ejes) · semilla byte-idéntica
a HEAD (md5) · barrido 992 combinaciones (62 figs × ES/TRV × capas 1-4 × gap) = 0 fuera del
hormigón · autos 62 figuras 0 rompen marco · suite 19/19. Guard: tests/test_pose.js (P1-P8 + 41
figuras × linear/layered × 1-3 capas).

### DEF PENDIENTE (usuario) — convención de la columna `angulos` del catálogo (hallazgo Tanda F)
El verificador demostró que la columna tiene DOS escritores con convenciones complementarias:
- El SEED (63 figuras, a mano) la usa como GIRO/doblez (104D=[135,135] es el gancho sísmico 135°,
  y así la traza _estriboPerimetral desde siempre). El trazador genérico la lee IGUAL.
- El DISEÑADOR de figuras guarda 180−giro ("ángulos INTERNOS, convención aSa", disenador.js:1373).
HOY es inerte: las figuras del diseñador traen geometria.tramos (que MANDA sobre la derivación),
así que la lectura giro solo toca al seed, que es giro. PERO la columna queda mixta según el autor.
DEF: ¿unificamos a GIRO (el diseñador deja de convertir; migrar sus figuras existentes) o a INTERNO
(migrar el seed y la lectura)? Afecta también cómo aSa interpreta ang1..4 en el export.
