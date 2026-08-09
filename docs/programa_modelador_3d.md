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
