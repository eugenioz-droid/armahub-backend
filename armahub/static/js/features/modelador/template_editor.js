// =============================================================================
// Template Editor — Colocador por proyecciones (sub-tab del Catálogo).
// Cablea el modal tabs/template_editor_modal.html (calca static/demo/colocador.html).
//
// Esta entrega convierte los 3 cuadrantes 2D de SOLO-VISUALIZACIÓN a un
// EDITOR INTERACTIVO (§DISCOVERY-INTERACCIÓN del programa):
//   - COLOCAR (modo): "＋ Agregar barra" (ribbon) / "＋ Agregar componente" (panel)
//     entran en MODO COLOCACIÓN; figura+tipología del ribbon → clic en una vista 2D → nace un
//     componente anclado a la cara clicada (el estribo abraza el recinto útil; barra con
//     lados se orienta según su figura). Se agrega a ST.receta.componentes y se
//     regenera (las 4 vistas + el 3D se actualizan).
//   - SELECCIONAR / MOVER / BORRAR: clic en una barra dibujada la selecciona
//     (halo + panel izq); arrastrar la mueve; Supr/botón la borra.
//   - ROTAR: ESPACIO (o el botón +90° de la fila "Rotación °" del panel) gira 90° en
//     el plano de la vista; campo de ángulo exacto; se muestra el ángulo al seleccionar.
//     El botón "⟳ Rotar" del ribbon se eliminó (duplicaba el del panel).
//   - PATAS: segmented ↓ → ↑ ← en el panel = orient.spin (gira SÓLO las patas; la
//     barra no se mueve). Sólo en figuras con pata y roles que no son estribo/traba.
//   - RANGO: sin herramienta ni 2 clics. Con una barra SELECCIONADA se dibuja la
//     flecha de rango en las vistas donde su eje de reparto es visible (gris si la
//     distribución aún no está activa); arrastrarla la ACTIVA y la ajusta. Sus handles
//     de extremo SNAPean a las caras del eje. Si el reparto tiene varios TRAMOS
//     (rango.tramos = [{long,sep}]) la flecha muestra un divisor arrastrable por
//     límite y una etiqueta "@N" clicable por tramo (input inline).
//   - NODOS: cada esquina del hormigón con un nodo arrastrable (redimensiona el
//     elemento); desplazamiento con medida en el panel (básico).
//   - SNAP a grilla/caras/barras (toggle) · COTAS on/off (básico).
//
// Todo trabaja sobre ST.receta y llama _regenerar() para reflejar en las 4 vistas.
// El motor (motor_geom + reglas + generar + figura_puntos + semilla) se REUSA:
// la colocación/rotación/movimiento se modelan como campos ADITIVOS del componente
// (pos_hint / orient / distribucion.rango) que reglas.js respeta sin romper nada.
//
// REGLA CRÍTICA (bug histórico "0 barras / canvas negro"): NUNCA capturar THREE ni
// los módulos globales en 'var' al cargar — se resuelven DENTRO de cada función.
// NO toca panel_3d.js ni modelador3d_modal.html (otro modal).
// =============================================================================
(function (global) {
  'use strict';

  var THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';

  // (Acá vivía TEMA = el único tema del 3D, el claro. Se fusionó con TEMAS3D.claro
  // para que la escena y el selector de fondo no tengan dos tablas que puedan
  // divergir. Los colores por tipología viven en COL2D, fuente única 2D + 3D.)

  // TEMAS DEL FONDO (portados del Enfierrador, panel_3d.js TEMAS). SÓLO fondo y
  // grilla: el color de cada barra es DATO DEL USUARIO (tipología o color propio del
  // componente) y el tema no lo pisa — allá sí lo hacía, y cambiar de fondo te
  // cambiaba el color de las barras que habías elegido.
  //
  // AHORA SON LOS 4 CUADRANTES (18-ago, pedido del usuario). Antes el fondo se
  // aplicaba POR PASE: el 3D con su tema y las 3 vistas 2D fijas en BG_ORTO. La razón
  // de aquello era buena —los overlays SVG (cotas, recubrimiento, handles, textos)
  // estaban dibujados para fondo claro y sobre negro se perdían—, así que el fondo no
  // se soltó a secas: el tema ahora también marca #te_quad con la clase te-tema-*, y
  // el CSS reasigna con ella las variables --te-ov-* de TODOS los trazos del overlay.
  // Los trazos claros/oscuros se invierten con el fondo, no se dejan a la suerte.
  //
  // Y DESDE EL 20-AGO EL MARCO ACOMPAÑA (paleta de static/demo/te_temas.html): la
  // misma clase se pone también en #te_modal, de donde cuelgan las --te-* del ribbon,
  // el panel, las fichas y el pie. Antes el radial dejaba todo eso en blanco, que
  // contra el lienzo #14171c era un marco blanco alrededor de un agujero negro.
  var TEMAS3D = {
    oscuro: { bg: 0x14171c, g1: 0x2a3340, g2: 0x222a34 },
    medio: { bg: 0x2b3242, g1: 0x4a5568, g2: 0x3a4353 },
    claro: { bg: 0xd8dee7, g1: 0xb4bdc9, g2: 0xc6cdd6 }
  };
  function _tema3D() { return TEMAS3D[ST.tema3d] || TEMAS3D.claro; }

  // ACABADO PBR de las barras — ver la nota larga en _initEscena: sin envMap, el
  // metalness se cobra el color y no devuelve reflejo. Una sola constante para que
  // los materiales por tipología y los de color propio no puedan divergir.
  var MAT_METALNESS = 0;      // 0.1 → 0: ese 10% también se perdía (misma causa, sin envMap)
  var MAT_ROUGHNESS = 0.42;
  // EMISIÓN PROPIA de la barra, como fracción de su color (18-ago, «al soltarla se
  // oscurece»). CUENTA MEDIDA, no un número a ojo: three r160 pinta con luces físicas
  // (useLegacyLights=false), o sea que la contribución difusa de cada luz se divide
  // por π. Con el ambiente 0.85 y la direccional 0.7 de esta escena, una cara bien
  // iluminada llega a (0.85+0.7)/π ≈ 0.49 del color pintado: por eso el #e65100 se
  // veía café y el usuario sólo veía el color REAL mientras la barra estaba
  // seleccionada — el realce viejo le sumaba emissive = 0.45·color, y eso era
  // justamente lo que faltaba. Esos 0.45 se mudan al material BASE (0.45 emitido +
  // ~0.49 de luz ≈ el hex elegido) y la selección se marca de otra forma (SEL_COLOR).
  var MAT_EMISSIVE = 0.45;
  // COLOR DESIGNADO DE LA SELECCIÓN — la marca ya NO es "aclarar la barra" (eso era
  // lo que hacía ver bien el color y confundía las dos cosas). Magenta porque es el
  // único tono fuerte que NO usa COL2D (azules, teals, naranja, morados y gris) y
  // porque contrasta con los TRES fondos del selector: oscuro #14171c, medio #2b3242
  // y claro #d8dee7. Va con emisión ALTA para que se lea igual de fuerte en los tres
  // y para que siga distinguiéndose aunque el usuario le ponga magenta a un
  // componente. El color verdadero de la pieza sigue a la vista en el swatch de la
  // ficha flotante (#te_selcard) y en la lista de componentes.
  var SEL_COLOR = '#ff00b8';
  var SEL_EMISSIVE = 0.55;

  // ---- CÁMARA DEL CUADRANTE 3D: campo visual y TECHO DE ACERCAMIENTO ----
  // FOV3D es el ángulo vertical de la perspectiva. Lo que entra de alto en pantalla
  // es 2·dist·tan(FOV/2) ≈ 0,688·dist, así que la DISTANCIA MÍNIMA es lo que fija
  // cuánto se puede acercar el ojo. Con el mínimo viejo (120) la ventana más chica
  // medía 83 cm: una barra φ16 (1,6 cm) ocupaba ~7 px y era imposible mirarle el
  // gancho. Con 15 la ventana baja a ~10 cm, que es el detalle de un doblez.
  // near sigue en 1 (ver _initEscena): con el ojo a 15 no recorta nada útil.
  // UNA SOLA CONSTANTE Y UN SOLO CLAMP: el mínimo estaba escrito en cuatro sitios y
  // dos de ellos —encuadre automático y botón ⟳— ni siquiera pasaban por él.
  //
  // 38° → 25° (18-ago, «la viga cambia de orientación al panear»). NO era un bug de
  // la pose ni del pan: es DISTORSIÓN DE PERSPECTIVA. Con un lente abierto los rayos
  // que llegan al borde del cuadro entran con mucho ángulo respecto del eje óptico,
  // así que la misma pieza se ve DESDE OTRO LADO cuando está en el borde y no en el
  // centro (el edificio inclinado del gran angular). El ángulo entre el rayo del
  // borde y el eje es FOV/2: pasa de 19° a 12,5°, o sea que la "vuelta" que la pieza
  // parece dar al cruzar la pantalla se reduce a dos tercios, y el resultado se lee
  // más como dibujo técnico (una ortográfica sería 0°, pero perdería la profundidad).
  var FOV3D = 25;
  // PUNTO DE PARTIDA de la cámara: elevación 0,55 rad (31°) y acimut 0,9 rad (52°),
  // sin alabeo. Los mismos dos números los usaban el literal de ST y el botón ⟳
  // escritos a mano en los dos sitios; ahora salen de acá (una sola vez).
  var CAM0 = { elev: 0.55, azim: 0.9 };
  var DIST_MIN = 15, DIST_MAX = 6000;
  function _clampDist(d) {
    d = Number(d);
    if (!isFinite(d)) return DIST_MIN;
    return Math.max(DIST_MIN, Math.min(DIST_MAX, d));
  }

  // ENCUADRE AUTOMÁTICO — cuánta distancia hace falta para que el elemento entre.
  // La fórmula (largo·1.15 + 160) se calibró A OJO con la ventana de un FOV de 38°,
  // y lo que entra de alto en pantalla es 2·dist·tan(FOV/2): al cerrar el lente la
  // MISMA distancia muestra menos y el elemento salía recortado. Se re-escala por la
  // razón de tangentes, que es exactamente el factor que deja el tamaño en pantalla
  // idéntico; así el número calibrado deja de depender del FOV elegido.
  // Estaba escrita DOS VECES (encuadre inicial y botón ⟳) — ahora una sola.
  var FOV_CALIB = 38;
  function _distEncuadre(largo) {
    var k = Math.tan(FOV_CALIB * Math.PI / 360) / Math.tan(FOV3D * Math.PI / 360);
    return _clampDist((Number(largo) * 1.15 + 160) * k);
  }

  // PASO DEL ARRASTRE (cm) — la resolución con la que se mueve TODO lo arrastrable
  // del editor: los handles del rango, el divisor de tramos y la barra que se arrastra
  // (todos pasan por _snapValor, vía _clickHost o vía _hostEnEje). Era 5 y se llamaba
  // GRID_SNAP, que confundía: no tiene nada que ver con la grilla que se DIBUJA (su
  // paso es 1‑2‑5 adaptativo, _pasoGrilla2D) — es el redondeo del gesto.
  // 18-ago: 5 → 1 cm (pedido del usuario). Con paso 5 no se podía dejar un estribo a
  // 4 cm del borde, que es justo la medida que se usa todo el tiempo.
  var PASO_ARRASTRE_CM = 1;

  // Radio del IMÁN A LAS CARAS (bordes del hormigón, líneas de recubrimiento, centro)
  // en cm. Con el paso de 5 el imán efectivo era ~2.5 (más allá ganaba el múltiplo de
  // 5 más cercano, ver _snapValor de antes), así que 2 conserva el gesto de siempre.
  // NO puede volver a los 6 cm nominales de entonces: con paso 1 se tragaría todas las
  // posiciones entre 1 y 6 cm de una cara — justo el rango que el usuario necesita.
  var SNAP_CARA_CM = 2;

  // Mínimo razonable del espaciamiento @ (cm). Es el CAPEO DE UI (§TANDA 3 · punto 2):
  // los inputs de @ lo llevan en min= y rechazan en rojo cualquier valor menor, y los
  // clamps internos de tramos lo usan como piso (antes era 1: un 0.6 tecleado se
  // convertía en 1 sin decir nada). El motor tiene su propio tope aparte.
  var SEP_MIN = 0.5;

  var ST = {
    receta: null, ultimoOut: null,
    scene: null, camera: null, renderer: null, world: null, grid: null,
    materiales: null,
    // ORIENTACIÓN DE LA CÁMARA = UN QUATERNION, no dos ángulos (19-ago).
    // Antes eran rotX (elevación) + rotY (acimut) con el "arriba" clavado en +Y del
    // mundo: 2 grados de libertad, y la cámara se RECONSTRUÍA con un lookAt en cada
    // frame. Con el quaternion el par (ojo, orientación) se puede ESCRIBIR a mano, y
    // de ahí sale el giro rígido alrededor de un punto cualquiera que deja el pivote
    // clavado al píxel (ver _girarCamRigido). También desaparece la singularidad del
    // cenit, donde la base vieja se degeneraba porque |derecha| = cos(elev) → 0.
    // La órbita normal NO cambió: compone EXACTAMENTE el mismo par de giros (ver
    // _girarPorArrastre).
    // Nace en _initEscena, desde CAM0 (necesita THREE).
    quat: null, dist: 900, target: null, panX: 0, panY: 0,
    threeCargado: false, webglOk: null, rafId: null, verHormigon: true,
    // tema3d: clave de TEMAS3D — fondo y grilla del cuadrante 3D. Sólo memoria
    //   (no viaja en la receta: es preferencia de mirada, no dato del template).
    // ejeRot: 'libre' | 'x' | 'y' | 'z' — restringe el arrastre de la órbita a un
    //   solo eje (portado del Enfierrador).
    tema3d: 'claro', ejeRot: 'libre',
    // --- Estado de interacción 2D ---
    // figura y φ parten VACÍOS (pedido 13-ago): el usuario elige antes de colocar.
    // (20-ago) `contorno` SE FUE con su check: nadie leía el dato salvo el ghost de
    // respaldo, así que sólo servía para que el fantasma prometiera un recinto que
    // la barra ya colocada no respetaba.
    figura: '', tipologia: 'CBS', diam: null,
    tool: 'mover', snap: true, cotas: false,   // arranca en SELECCIONAR (flechita), no colocando
    // ESPEJAR (24-ago): el gesto es de DOS TIEMPOS —el botón arma, el clic en una
    // cara decide contra qué plano se refleja—, así que hay que recordar entre los
    // dos que hay un espejo esperando. No es una herramienta (`tool`) porque no
    // cambia lo que hace el clic sobre una barra: es un modo de UN solo clic que se
    // consume y se apaga.
    espejoPend: false,
    // Los <span> de "cuánto mide este lado" que la ficha tiene ahora en pantalla.
    // Se rehace con cada ficha y lo reescribe cada regeneración (ver _medVivas abajo).
    _medVivas: [],
    // SELECCIÓN MÚLTIPLE (25-ago) — `selCi` SIGUE SIENDO LA SELECCIÓN. Estos son los
    // componentes que van ADEMÁS, y sólo los miran tres cosas: el resaltado (tejas,
    // 2D y 3D), el espejo y el borrado. Todo lo demás —la ficha, los tiradores, el
    // abanico, girar, duplicar— sigue trabajando sobre `selCi` y no se enteró.
    //
    // POR QUÉ ASÍ Y NO UN ARRAY. `selCi` lo leen 65 sitios de este archivo, y varios
    // no tienen un significado plural: la ficha muestra UNA barra, el tirador estira
    // UNA, el abanico es el de UNA. Convertirlo en lista habría pedido decidir qué
    // hace cada uno de esos 65 con cuatro barras a la vez —y equivocarse en uno solo
    // es una regresión silenciosa—. Con un acompañante, lo que existía no cambia de
    // significado y lo plural se declara donde de verdad lo es.
    //
    // SE VACÍA en cuanto la lista de componentes se mueve (crear, borrar, duplicar,
    // reordenar, deshacer): son ÍNDICES, y un índice que sobrevive a un splice apunta
    // a otra barra. Antes que arrastrar índices podridos, se suelta la selección.
    selExtra: [],
    // `cotas` = UN SOLO INTERRUPTOR PARA LAS DOS CAPAS DE MEDIDAS (20-ago, pedido del
    // usuario). Antes eran dos cosas separadas —el botón del ribbon acotaba el
    // HORMIGÓN y SHIFT apretado mostraba las medidas por lado de la barra— y había
    // que acordarse de cuál prendía cada una. Ahora el botón «Cotas» y la tecla
    // SHIFT prenden y apagan LAS DOS JUNTAS, y SHIFT es un interruptor (se pulsa y
    // quedan; se vuelve a pulsar y se van), no un gate que hay que mantener.
    // El estado vive acá y sólo acá: el botón refleja `cotas`, no al revés.
    selCi: -1,                 // índice del componente seleccionado (-1 = ninguno)
    ultimoPlano: 'largo',      // última vista tocada (define el eje de rotación)
    transforms: {},            // {plano: {minU,maxU,minV,maxV,s,offX,offY}}
    dragMove: null,            // {ci, plano, startHost, startHint} durante mover
    dragMarco: null,           // arrastre del marco de la barra (ver _iniciarDragMarco)
    dragRango: null,           // {ci} durante arrastre de la flechita doble
    // Campos del panel con NÚMERO VIVO: funciones que releen la receta y reescriben
    // su <input>/<label> sin re-armar el DOM (ver _refrescarPanelVivo). Las registra
    // quien los construye y las tira _renderPanel al re-armar la lista.
    _panelVivo: [],
    // --- Snap de CARA (§INTERACCIÓN-2.0) — elegir la cara VIENDO ---
    caraHi: null,              // {plano, cara, edge, orient, pos, a, b} cara resaltada bajo el cursor
    _regenPendiente: false,
    _uiOk: false,
    // --- P3: plano de trabajo activo resaltado en el 3D ---
    //   'seccion' | 'largo' | 'planta' | null  (null = ninguno resaltado)
    planoActivo: null, planoMesh: null, elemento: 'viga',
    // --- T2 (pantalla previa + guardar/abrir) ---
    // nombre: nombre del template. Se propone en el TAB al crear y se EDITA aquí
    //   dentro (input del titlebar): antes no había forma de renombrar nada.
    // templateId: id si el template vino de la biblioteca ("Abrir"). Con id →
    //   "Guardar" hace PUT (lo actualiza); sin id → POST (lo crea).
    // obra: obra del template guardado (id_proyecto) — se conserva al duplicar con
    //   "Guardar como nuevo". El editor NUNCA la elige (crea templates generales),
    //   pero un template del Enfierrador sí la trae y la copia debe quedar en la
    //   misma obra, no mudarse a "general".
    // puedeModificar: lo dice el BACKEND (GET /templates/{id}.puede_modificar = su
    //   autor o un admin). Si es false el PUT daría 403 seguro: el editor ofrece
    //   "Guardar como nuevo" en vez de mandar una escritura condenada.
    // _recetaGuardada / _nombreGuardado: estado sellado al abrir y tras guardar
    //   (dirty-tracking). El NOMBRE va aparte porque no vive en la receta y
    //   renombrar TAMBIÉN es un cambio sin guardar.
    // _guardando: hay un POST/PUT en vuelo (el botón muestra "Guardando…" y
    //   ninguna regeneración puede pisarle el texto).
    nombre: '', templateId: null, obra: null, puedeModificar: true,
    _recetaGuardada: null, _nombreGuardado: null, _guardando: false,
    // --- INTERACCIÓN-2.0 (esta entrega) ---
    // cargado: "sello" de lo que quedó cargado en el ribbon para colocar
    //   { figura, tipologia, diam } | null. Se setea al elegir
    //   figura+tipología con una herramienta de colocación (colocar/rango);
    //   Esc lo suelta (deselecciona → herramienta 'mover').
    cargado: null,
    // ghost: estado del GHOST que sigue el cursor { plano, host, valido } | null.
    ghost: null,
    // undoStack: pila de snapshots de la receta para Ctrl+Z. _pushUndo() ANTES de
    //   mutar; _undo() restaura el último snapshot.
    undoStack: [], _undoMax: 60,
    // --- PERF / VISTAS (frente B) ---
    // dirty: render-on-demand. El loop sólo pinta si algo lo marcó (_marcarSucio).
    dirty: true,
    // barras3D: meshes de barra del último _redibujar, con userData.span (extensión
    //   por eje) y userData.matBase/matClip → clipping LOCAL por vista (B2).
    barras3D: [],
    // luzFrontal: DirectionalLight extra que se coloca en el eye de cada vista orto
    //   (sólo visible durante los 3 renders orto) para que las tapas/secciones no
    //   salgan oscuras (B2·b).
    luzFrontal: null,
    // gizmo: { escena, cam } del triad de ejes del cuadrante 3D (B4·b).
    gizmo: null,
    // warnNivel/warnDescartado: banner anti-colapso (>350 / >800 barras).
    warnNivel: null, warnDescartado: false,
    // corteIman: modo del slider de corte. true (default) = IMÁN — el corte salta a
    //   la rebanada con piezas más cercana (_sliceMasCercana). false = LIBRE — el
    //   corte es CONTINUO, se queda donde lo dejó el slider. Es GLOBAL (una sola
    //   preferencia para el editor) y vive SOLO en memoria: no se guarda en la receta.
    corteIman: true,
    // _catPedido: ya se pidió el catálogo real de figuras (GET /figuras-catalogo) en
    //   esta sesión de página. Se pide UNA vez; si el fetch falla vuelve a false para
    //   reintentar la próxima vez que se abra el editor.
    _catPedido: false,
    // ------------------------------------------------------------------------
    // MODO OBRA (el editor haciendo de ENFIERRADOR)
    // ------------------------------------------------------------------------
    // El editor es UNO SOLO: lo que cambia es que le entre CONTEXTO DE OBRA por la
    // puerta (templateEditorAbrirEnObra). Sin contexto (ctxObra = null) se comporta
    // EXACTAMENTE igual que siempre — biblioteca de templates y nada más. Así una
    // mejora del editor aparece en los dos lados por construccion, sin fork.
    //   ctxObra   : {loteId, id_proyecto, sector, ciclo, eje, nombre_plano, estructura}
    //   piso      : UNO por estructura, se estampa igual en todas sus barras. El
    //               backend lo EXIGE no vacio por barra (lotes.py agregar_barras).
    //   instanciaId: fila de elementos_template de ESTA estructura (traza).
    ctxObra: null, piso: '', instanciaId: null, tplOrigen: null,
    _tplsObra: null   // templates del elemento, cacheados para el selector de obra
  };

  function $(id) { return document.getElementById(id); }

  function _deps() {
    return {
      gen: global.ModeladorGenerar,
      geom: global.ModeladorMotorGeom,
      reglas: global.ModeladorReglas
      // `semilla` salió de acá con la puerta de entrada única: la semilla de viga
      // era el contenido de la apertura sin argumentos, que ya no existe. El módulo
      // sigue cargado porque lo usa el Enfierrador (panel_3d.js).
    };
  }

  // ==========================================================================
  // MODELO — helpers sobre ST.receta
  // ==========================================================================
  // ROL — SIN TABLA PROPIA (consolidación 15-ago). La UI tenía aquí su copia de
  // la tabla tipología→rol, con 'traba' vivo, mientras el motor lo había matado
  // (Modelo A). De esa divergencia salieron 4 defectos MEDIDOS: el clic que
  // desplazaba una TR 146 cm fuera del hormigón, el check "anidar" pintado sobre
  // un motor que ya no anida, y el empalme y las Patas ocultos en barras a las
  // que el motor SÍ se los aplica. Ahora la autoridad es una sola.
  //
  //   _rolComp(c)  → el rol que MANDA para ESE componente (topología incluida).
  //                  Es lo que hay que usar siempre que exista el componente.
  //   _rolDe(tip)  → sólo para cuando NO hay componente (el ribbon antes de
  //                  colocar, un chip suelto): pregunta por la tipología pelada.
  function _rolComp(c) {
    var reglas = global.ModeladorReglas;
    if (c && reglas && reglas.rolDeComponente) return reglas.rolDeComponente(c);
    return _rolDe(c && c.tipologia);
  }
  function _rolDe(t) {
    var reglas = global.ModeladorReglas;
    if (reglas && reglas.rolDeComponente) return reglas.rolDeComponente({ tipologia: t });
    return 'cabezal';
  }

  // @sep DE PARTIDA por tipología — PRESET, no regla: es el número con el que
  // nace el campo y el usuario lo cambia. Vivía escrito CINCO veces (y el motor
  // no lo conocía, así que su propio default caía a 20 igual para una traba).
  // Una tabla, un default. Que sea por tipología es legítimo: es un valor de
  // arranque, no una decisión de geometría.
  var SEP_POR_TIPOLOGIA = { TRV: 40, TR: 40, TC: 40, TRC: 40, TRL: 40, TRF: 40 };
  var SEP_DEFAULT = 20;
  // Desde el cableado de la pantalla de Configuración (Catálogo › Templates) el
  // número lo manda la CONFIG GUARDADA; la tabla de arriba queda como FALLBACK para
  // cuando la config no llegó (red caída, primera vez, tests headless). Sin fallback
  // el editor quedaría inutilizable por un GET que falla, y la tabla es justamente el
  // valor con el que la config nace.
  function _sepDefault(tip) {
    var cfg = global.ModeladorConfig;
    var v = (cfg && cfg.sep) ? cfg.sep(_tipoElemento(), tip) : null;
    if (v != null) return v;
    return SEP_POR_TIPOLOGIA[String(tip || '').toUpperCase()] || SEP_DEFAULT;
  }

  // Diámetros estándar (mm) — espejo de armahub/diametros.py: DIAM_ESTANDAR.
  // Alimenta los DOS selects de φ (ribbon y panel del componente): una sola lista.
  // MOVER LA BARRA A MANO: APAGADO (21-ago, pedido del usuario).
  //
  // Arrastrar una barra escribe su pos_hint, y esa posición a mano NO sobrevive un
  // cambio de dimensión del hormigón: la barra se queda donde el usuario la dejó
  // mientras el elemento crece o se achica alrededor. Es justo lo contrario de lo que
  // resolvimos con el anclaje, así que hasta que la posición manual se ancle igual que
  // el rango, la puerta queda cerrada.
  //
  // Lo que SÍ se puede seguir arrastrando: los tiradores del marco (ST.dragMarco) y el
  // abanico completo con sus dos extremos (ST.dragRango). Esos ya están anclados y se
  // reacomodan solos. El clic sobre la barra tampoco se pierde: sigue SELECCIONANDO,
  // que es el otro 90% de para qué se le hace clic a una barra.
  //
  // Para reabrirlo: poner esto en true. No hay nada más que revertir — `_dragMover`
  // sigue entero al otro lado de la llave.
  var TE_MOVER_A_MANO = false;

  var TE_DIAMS = [8, 10, 12, 16, 18, 22, 25, 28, 32, 36];

  // ==========================================================================
  // CATÁLOGO DE FIGURAS — FUENTE ÚNICA
  // Los parciales/ángulos/radio de una figura salen del catálogo REAL
  // (armahub/catalogo.py · GET /figuras-catalogo), publicado por
  // features/modelador/catalogo_figuras.js como
  //   global.ModeladorCatalogoFiguras = { FIGURAS, noDibujables, actualizar(data) }
  // y se resuelve EN EL MOMENTO de usar (nunca capturado a nivel de módulo: los
  // scripts cargan en paralelo).
  //
  // Aquí vivía un espejo local `FIG` de 8 figuras que además MENTÍA (106A con 4
  // parciales cuando el catálogo le da 6: A..F) y que mandaba cualquier código
  // desconocido al default {parciales:['A']} — o sea: se tipeaba basura en el
  // campo Figura, nacía una barra "recta" fantasma y salía con kg = 0 sin un solo
  // aviso. El espejo MURIÓ: lo que no está en el catálogo no se coloca.
  // ==========================================================================
  function _cat() { return global.ModeladorCatalogoFiguras || null; }
  function _figKey(f) { return String(f == null ? '' : f).trim().toUpperCase(); }

  // Mapa codigo → {parciales, angulos, radio, descripcion}. El módulo puede
  // publicar FIGURAS como mapa por código o como la lista cruda del endpoint;
  // las dos se leen igual (se indexa por `codigo`).
  function _figuras() {
    var c = _cat(), F = c && c.FIGURAS;
    if (!F) return {};
    if (!Array.isArray(F)) return F;
    var out = {};
    F.forEach(function (f) { if (f && f.codigo) out[_figKey(f.codigo)] = f; });
    return out;
  }
  function _catListo() { return Object.keys(_figuras()).length > 0; }
  function _figDef(fig) { return _figuras()[_figKey(fig)] || null; }

  // Motivo por el que una figura EXISTENTE no se puede dibujar en este editor
  // (lo publica el módulo del catálogo). null = dibujable. Se aceptan las tres
  // formas razonables del contrato: función, lista de códigos o mapa
  // codigo → motivo (el motivo, si viene, es lo que se muestra en el tooltip).
  function _motivoNoDibujable(fig) {
    var c = _cat(), nd = c && c.noDibujables;
    if (!nd) return null;
    var k = _figKey(fig), v;
    if (typeof nd === 'function') v = nd(k);
    else if (Array.isArray(nd)) v = (nd.indexOf(k) >= 0);
    else v = nd[k];
    if (!v) return null;
    return (typeof v === 'string') ? v : 'el motor no la dibuja';
  }

  // Códigos DIBUJABLES, ordenados: es lo que alimenta el datalist compartido.
  function _figsDibujables() {
    var F = _figuras();
    return Object.keys(F).filter(function (k) { return !_motivoNoDibujable(k); }).sort();
  }

  // Error de una figura tipeada, o null si sirve. Sin catálogo cargado NO se
  // inventa un veredicto (no hay contra qué validar): eso se avisa aparte.
  function _figError(fig) {
    var k = _figKey(fig);
    if (!k) return 'falta la figura';
    if (!_catListo()) return null;
    if (!_figDef(k)) return 'figura ' + k + ' no existe en el catálogo';
    var m = _motivoNoDibujable(k);
    if (m) return 'figura ' + k + ' no es dibujable aquí (' + m + ')';
    return null;
  }

  // ==========================================================================
  // FIGURA vs TIPOLOGÍA — el catálogo no sólo dice qué figuras EXISTEN, también
  // dice cuáles admite cada tipología (FIGURAS_POR_TIPOLOGIA: 'MURO-MH' →
  // 101A/102A/102B/102C/103A/103G). Hasta acá el campo Figura se validaba sólo
  // contra el catálogo COMPLETO: se podía tipear 106A estando en MH (malla
  // horizontal), el editor lo tragaba en silencio y la barra entraba por el
  // pipeline equivocado (se dibujaba cualquier cosa). El motor ya se protege por
  // topología; ACÁ es donde el usuario tiene que ENTERARSE.
  //
  // NO BLOQUEA: una figura del catálogo ajena a la tipología se puede colocar
  // igual (el usuario puede tener una razón: refuerzo especial, catálogo que va
  // atrás de la obra). Es un AVISO fuerte — borde ámbar + tooltip + barra de
  // estado. Lo que SÍ sigue impidiendo colocar es una figura que no existe en el
  // catálogo o que el editor no dibuja (eso es _figError, no se toca).
  // ==========================================================================
  function _figsPorTipologia() {
    var c = _cat();
    return (c && c.FIGURAS_POR_TIPOLOGIA) || {};
  }

  // Clave 'ELEMENTO-TIPOLOGIA' comparable. Las claves del catálogo vienen con
  // mayúsculas y minúsculas mezcladas (Fi, F's, CBSn) y algunas con apóstrofe
  // (LOSA-F'i): se compara TODO en mayúsculas y el apóstrofe se conserva porque
  // es parte del código de la tipología, no ruido.
  function _tipKey(elem, tip) { return _figKey(elem) + '-' + _figKey(tip); }

  // Figuras que el catálogo asocia a una tipología, EN EL ORDEN del catálogo
  // (primero las más usadas). [] = esa combinación elemento-tipología no está
  // declarada: no hay contra qué comparar, así que no se avisa nada (avisar sin
  // fuente sería inventar una regla).
  function _figsDeTipologia(elem, tip) {
    // SUGERIDAS CONFIGURABLES (Catálogo › Templates › Configuración). La lista que
    // manda es la GUARDADA; el catálogo (tipologia_figuras) queda como fallback —
    // es de donde la config nace, así que sin config el buscador ofrece lo mismo
    // que ofrecía antes. Una lista VACÍA configurada es un dato válido y distinto
    // de "no hay config": el llamador ya trata [] como "muestra el catálogo entero".
    var cfg = global.ModeladorConfig;
    var deCfg = (cfg && cfg.figuras) ? cfg.figuras(elem, tip) : null;
    if (deCfg) return deCfg;
    var M = _figsPorTipologia(), k = _tipKey(elem, tip), key;
    for (key in M) {
      if (!Object.prototype.hasOwnProperty.call(M, key)) continue;
      if (_figKey(key) === k) return (M[key] || []).map(_figKey);
    }
    return [];
  }

  // Figuras admitidas por la tipología ACTIVA del ribbon (elemento del template
  // + botón de tipología seleccionado).
  function _figsDeTipologiaActiva() {
    return _figsDeTipologia(_tipoElemento(), ST.tipologia);
  }

  // Nombre de obra de una tipología ('MH' → 'Malla Horizontal'), para que el
  // aviso hable en el vocabulario del usuario y no en códigos. El ELEMENTO se
  // pasa (no se lee de ST): el mismo código de tipología significa cosas
  // distintas según el elemento — 'CB' es Cabezal en muro y en columna, pero
  // 'F' es Refuerzo Inferior en losa y no existe en viga.
  // (15-ago) `_nombreTipologia` RETIRADA junto con _FIGS_EN_AVISO: eran el
  // traductor 'MH'→'Malla Horizontal' y el tope de nombres del aviso figura↔tipología
  // que se retiró el 14-ago (la tabla sugiere, no avisa). Cero llamadores.


  // ¿La figura tipeada es AJENA a la tipología? null = nada que decir. Si hay
  // algo que decir devuelve { figura, tip, admite, texto, corto }:
  //   texto = tooltip completo · corto = lo que cabe en la barra de estado.
  // Devuelve null cuando la figura ni siquiera existe en el catálogo: ese caso
  // ya lo canta _figError y dos mensajes encima del mismo campo confunden.
  function _figAvisoTipologia(fig, elem, tip) {
    // AVISO RETIRADO (regla del usuario, 14-ago): «cualquier barra puede ser
    // cualquier cosa — esa debiera ser la regla». La tabla figura↔tipología es
    // una SUGERENCIA (ordena el datalist con las figuras típicas primero), no
    // una validación: marcó en ámbar una 103C bajo MV que es perfectamente
    // legítima («eso es falso»). Cuando exista la sección de configuración de
    // sugeridas en el tab, este canal puede volver COMO dato configurable —
    // por eso la función queda (los llamadores ya la manejan en null) en vez
    // de borrarse con sus seis puntos de enganche.
    return null;
  }

  // ==========================================================================
  // TIPOLOGÍA HUÉRFANA — la barra es de OTRO elemento
  // ==========================================================================
  // Cambiar de elemento (Viga → Muro) conserva las barras colocadas, y con ellas
  // su tipología: una CBS (cabezal de viga) dentro de un muro. _cambiarElemento
  // lo NOMBRA una vez en la barra de estado, pero ese mensaje lo pisa el primer
  // clic (_actualizarStatus() sin argumento) y el usuario se queda con barras
  // huérfanas sin saber cuáles. Esto es la marca PERMANENTE.
  //
  // Es un chequeo aparte de _figAvisoTipologia a propósito: aquel compara
  // FIGURA vs TIPOLOGÍA contra el catálogo, y el catálogo no tiene ninguna
  // entrada 'MURO-CBS' que consultar (la combinación no existe: ese es el
  // problema). La fuente acá es TPL_TIPOLOGIAS, que es la lista de tipologías
  // que el elemento ofrece en el ribbon — la misma que el usuario ve.
  //
  // null = nada que decir. Si hay algo: { tip, elem, admite, texto }.
  function _tipAjenaAlElemento(c, elem) {
    var tip = String((c && c.tipologia) || '').trim();
    if (!tip) return null;
    var may = _figKey(elem || _tipoElemento());
    var lista = TPL_TIPOLOGIAS[may];
    // Elemento sin lista de tipologías: no hay contra qué comparar (avisar sin
    // fuente sería inventar una regla).
    if (!lista || !lista.length) return null;
    var codigos = lista.map(function (t) { return t[0]; });
    if (codigos.map(_figKey).indexOf(_figKey(tip)) >= 0) return null;
    return {
      tip: tip, elem: may, admite: codigos,
      texto: 'Esta barra es ' + tip + ' y este template es un ' + may +
        ': ' + tip + ' no es una tipología de ' + may + '. Elige una de ' +
        codigos.join(', ') + '.'
    };
  }

  // Tooltip informativo de una figura del catálogo (lados + ángulos + radio).
  function _figTitle(fig) {
    var d = _figDef(fig); if (!d) return '';
    var lados = (d.parciales || []).join('');
    var ang = (d.angulos || []).length ? ' · α ' + d.angulos.join('/') + '°' : '';
    return _figKey(fig) + (d.descripcion ? ' — ' + d.descripcion : '') +
      (lados ? ' · lados ' + lados : '') + ang + (d.radio ? ' · con radio' : '');
  }

  // spec de dibujo de una figura: SIEMPRE del catálogo. Una figura desconocida no
  // se disfraza de barra recta — devuelve parciales vacíos y la ficha la marca en
  // rojo (antes se la tragaba en silencio y salía con kg = 0).
  function _figSpec(fig) {
    var d = _figDef(fig);
    if (!d) return { parciales: [], angulos: [], radio: false };
    return {
      parciales: (d.parciales || []).slice(),
      angulos: (d.angulos || []).slice(),
      radio: !!d.radio
    };
  }

  // Rellena el datalist ÚNICO (#te_figs) que comparten el campo Figura del ribbon
  // y el de la ficha del componente, con TODAS las figuras DIBUJABLES del catálogo
  // (las no dibujables se excluyen: ofrecerlas sería ofrecer un error).
  //
  // ORDEN: PRIMERO las de la tipología ACTIVA (en el orden del catálogo, que pone
  // adelante las más usadas) y con la tipología en la etiqueta; después el resto.
  // El resto NO se saca: el usuario puede buscar cualquier figura, sólo que la
  // lista deja de empezar por 63 códigos que no vienen al caso. Hay que llamarlo
  // al cambiar de tipología o de elemento (la lista de arriba cambia).
  // PREFILTRO DENTRO DEL FILTRO DE TEXTO (pedido 17-ago). Antes la lista SIEMPRE
  // traía las 69 figuras (sólo ordenadas con las de la tipología primero), así que
  // abrirla era encarar el catálogo entero. Ahora:
  //   · campo VACÍO (recién abierto) → sólo las SUGERIDAS de esa tipología;
  //   · en cuanto el usuario escribe → el catálogo COMPLETO, sugeridas primero.
  // La tabla de sugeridas no es nueva: es la que ya vive en el catálogo
  // (FIGURAS_POR_TIPOLOGIA, clave ELEMENTO-TIPOLOGÍA) y que la pantalla de
  // configuración va a editar. Si una tipología no tiene sugeridas, se muestra
  // el catálogo completo — una lista vacía sería peor que una larga.
  // `tip` opcional: la ficha de un componente pregunta por LA SUYA, no por la del
  // ribbon (pueden ser distintas si se seleccionó una barra de otra tipología).
  function _refrescarFigDatalist(soloSugeridas, tip) {
    var dl = $('te_figs'); if (!dl) return;
    var F = _figuras(), html = '';
    var dib = _figsDibujables();
    var tipUsar = (tip == null) ? ST.tipologia : tip;
    var tipTxt = String(tipUsar == null ? '' : tipUsar).trim();
    // Sólo las de la tipología que además el editor sabe dibujar.
    var deTip = _figsDeTipologia(_tipoElemento(), tipUsar)
      .filter(function (k) { return dib.indexOf(k) >= 0; });
    var resto = dib.filter(function (k) { return deTip.indexOf(k) < 0; });
    function opt(k, prefijo) {
      var d = F[k] || {};
      var lbl = prefijo + (d.descripcion ? d.descripcion + ' · ' : '') + (d.parciales || []).join('');
      return '<option value="' + _esc(k) + '"' + (lbl ? ' label="' + _esc(lbl) + '"' : '') + '>';
    }
    deTip.forEach(function (k) { html += opt(k, tipTxt ? tipTxt + ' · ' : ''); });
    if (!(soloSugeridas && deTip.length)) resto.forEach(function (k) { html += opt(k, ''); });
    dl.innerHTML = html;
  }

  // Deja la lista del campo `el` en el estado que toca según lo que haya escrito:
  // vacío = sugeridas · con texto = catálogo completo. Se llama en focus y en cada
  // tecla, que son los dos momentos en que el desplegable se vuelve a abrir.
  function _syncFigDatalist(el, tip) {
    if (!el) return;
    _refrescarFigDatalist(!String(el.value || '').trim(), tip);
  }

  // ==========================================================================
  // BARRA RÁPIDA DE FIGURAS (21-ago) — matriz 2×5 en el ribbon
  // --------------------------------------------------------------------------
  // Las diez figuras que el usuario coloca casi siempre, a un clic. El clic hace
  // EXACTAMENTE lo mismo que teclear ese código en el campo Figura: escribe en el
  // campo y llama a la MISMA puerta (_aplicarFiguraRibbon). No hay una segunda
  // regla de validación ni un segundo camino hacia ST.figura — si mañana cambia
  // cómo se acepta una figura, cambia para las dos entradas a la vez.
  //
  // EL DIBUJO NO ES UN ICONO A MANO. Lo pinta el motor del Diseñador
  // (disenadorMotor.dibujarFigura) con la geometría del catálogo, que es el mismo
  // que dibuja la matriz del Catálogo y las miniaturas del Bar Manager. Así estos
  // botones heredan los codos y el trazo ya afinados, y no pueden quedar mostrando
  // una forma que el catálogo dejó de tener.
  //
  // LA GEOMETRÍA SÓLO LLEGA CON EL CATÁLOGO REAL: el espejo estático de
  // catalogo_figuras.js trae parciales/ángulos/radio pero NO `geometria` (el trazo
  // lo dibuja el Diseñador y vive en la BD). Por eso la matriz se repinta cuando
  // vuelve GET /figuras-catalogo. Hasta entonces —y si una figura no trae
  // geometría— la casilla queda VACÍA con su tooltip: no se inventa un dibujo.
  var TE_FIGS_RAPIDAS = ['101A', '102A', '102C', '103A', '103B', '103C',
                         '104A', '104B', '104C', '105A', '105C', '106A'];
  // Tamaño del dibujo de cada casilla, en px. El pad es chico a propósito: sin
  // etiquetas no hay que reservar sitio para ninguna letra, así que todo el
  // recuadro es figura. (El CSS le da min-width/min-height al botón para que las
  // casillas vacías midan lo mismo que las dibujadas.)
  var TE_FIGQ_W = 30, TE_FIGQ_H = 22, TE_FIGQ_PAD = 2;   // 20-ago: achicadas en proporción

  // SVG de una figura para la barra rápida, o '' si no hay con qué dibujarla.
  function _svgFigRapida(cod) {
    var motor = global.disenadorMotor;
    if (!motor || typeof motor.dibujarFigura !== 'function') return '';
    var d = _figDef(cod);
    var geo = d && d.geometria;
    // El motor dibuja desde `puntos` si los hay y, si no, reconstruye desde `tramos`:
    // basta con que venga cualquiera de los dos (con menos, devolvería el cartel de
    // "Sin geometría para dibujar", que dentro de un botón de 36 px no se lee).
    var hayPuntos = geo && geo.puntos && geo.puntos.length >= 2;
    var hayTramos = geo && geo.tramos && geo.tramos.length;
    if (!hayPuntos && !hayTramos) return '';
    // COPIA SIN ADORNOS. labels_auto:false ya apaga las letras de lado y los ángulos
    // automáticos, pero las etiquetas MANUALES (las que el usuario puso en el
    // Diseñador) y las cotas de arco se dibujan igual: son datos de la geometría, no
    // opciones del render. Se vacían en la copia y no en el motor, que dibuja la
    // ficha completa donde sí corresponde. `cotas_arco_iso: []` además apaga el
    // cálculo automático de cotas de arco 2D (el motor sólo lo hace si el campo
    // viene sin definir).
    var g = {}, k;
    for (k in geo) if (Object.prototype.hasOwnProperty.call(geo, k)) g[k] = geo[k];
    g.etiquetas = [];
    g.cotas_arco_iso = [];
    try {
      return motor.dibujarFigura(g, null, {
        width: TE_FIGQ_W, height: TE_FIGQ_H, pad: TE_FIGQ_PAD,
        labels_auto: false, angulos: false
      });
    } catch (e) { return ''; }
  }

  function _renderFigsRapidas() {
    var cont = $('te_figQuick'); if (!cont) return;
    cont.innerHTML = TE_FIGS_RAPIDAS.map(function (cod) {
      var svg = _svgFigRapida(cod);
      // La casilla sin dibujo NO se deshabilita con el atributo `disabled`: un botón
      // deshabilitado no recibe eventos de ratón y en varios navegadores se queda
      // también sin tooltip, que es justo lo único que le queda por decir.
      return '<button type="button" data-fig="' + _esc(cod) + '"' +
        (svg ? '' : ' class="vacia"') +
        ' title="' + _esc(cod) + (svg ? ' — dejarla lista para colocar' : ' — el catálogo no trae su dibujo') + '"' +
        ' aria-label="' + _esc(cod) + '">' + svg + '</button>';
    }).join('');
    _marcarFigRapida();
  }

  // Qué casilla está activa. Se llama desde las tres puertas por las que cambia
  // ST.figura (el campo mientras se teclea, el campo al aplicar, y el prellenado
  // desde la configuración), no desde _actualizarStatus: esa corre por cada
  // movimiento del ratón durante un arrastre.
  function _marcarFigRapida() {
    var cont = $('te_figQuick'); if (!cont) return;
    var act = _figKey(ST.figura);
    Array.prototype.forEach.call(cont.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-fig') === act);
    });
  }

  // Clic en una casilla = "quiero colocar ESTA figura".
  function _elegirFiguraRapida(cod) {
    var fig = $('te_ribFigura'); if (!fig) return;
    fig.value = cod;
    // Si el catálogo vigente la rechaza no se entra a colocar: el campo queda en
    // rojo y la barra de estado dice por qué (lo hace _validarFiguraRibbon).
    if (!_aplicarFiguraRibbon(true)) { _marcarFigRapida(); return; }
    // La otra mitad del gesto: elegir figura estando en "Seleccionar" no colocaba
    // nada, así que el atajo obligaba a ir igual a pulsar "＋ Agregar barra".
    if (ST.tool !== 'colocar') _entrarModoColocacion();
    _marcarFigRapida();
  }

  function _bindFigsRapidas() {
    var cont = $('te_figQuick'); if (!cont || cont._teBound) return;
    cont._teBound = true;
    // Delegado en el contenedor: la matriz se re-emite entera cuando llega el
    // catálogo, así que cablear botón por botón dejaría los listeners viejos
    // colgando de nodos que ya no están.
    cont.addEventListener('click', function (e) {
      var t = e.target;
      var b = (t && t.closest) ? t.closest('button[data-fig]') : null;
      if (!b || b.classList.contains('vacia')) return;
      e.stopPropagation();
      _elegirFiguraRapida(b.getAttribute('data-fig'));
    });
  }

  // Catálogo REAL al abrir el editor: GET /figuras-catalogo → actualizar(data).
  // El módulo del catálogo trae un espejo estático para arrancar; esto lo
  // REEMPLAZA por lo que hay en la BD. Si la red falla manda el espejo y NO se
  // muestra error (el editor sigue usable con lo conocido), pero se rearma el
  // flag para reintentar en la próxima apertura. fetch/apiUrl/authHeaders se
  // resuelven DENTRO (patrón de templateEditorGuardar).
  function _cargarCatalogoFiguras() {
    var c = _cat();
    if (!c || typeof c.actualizar !== 'function' || ST._catPedido) {
      _refrescarFigDatalist(); _validarFiguraRibbon(false); return;
    }
    ST._catPedido = true;
    fetch(_tplUrl('/figuras-catalogo'), { headers: _tplHeaders(false) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data) c.actualizar(data);
        _refrescarFigDatalist();
        _validarFiguraRibbon(false);
        // LA BARRA RÁPIDA SE DIBUJA ACÁ, no antes: el espejo estático no trae la
        // `geometria` de las figuras (sólo parciales/ángulos), así que hasta este
        // punto las diez casillas estaban vacías.
        _renderFigsRapidas();
        var bd = $('te_backdrop');
        if (bd && bd.classList.contains('on')) {
          // Este re-render es NORMALIZACIÓN, no edición del usuario: la ficha re-lee
          // los parciales del catálogo real y de paso rellena dims/rango que faltaban
          // en la receta. Si el template estaba LIMPIO, se re-sella el baseline — si
          // no, la llegada (asíncrona) del catálogo dejaba el editor "sucio" solo,
          // y cerrar sin tocar nada preguntaba por cambios que nadie hizo.
          var limpio = !_hayCambiosSinGuardar();
          // El catálogo REAL puede tener figuras que el espejo estático no tenía (o
          // al revés): las marcas de "figura desconocida" se recalculan con el
          // catálogo vigente antes de repintar, si no la lista queda acusando
          // figuras que sí existen.
          _normalizarRecetaViva();
          _renderPanel();
          if (limpio && ST.receta) ST._recetaGuardada = JSON.stringify(ST.receta);
          // El aviso de apertura se calculó con el espejo estático; el catálogo REAL
          // es el que manda. Se vuelve a decir con él: puede APARECER (figura que el
          // espejo tenía y la BD ya no) o RETIRARSE (al revés). Sin esto, la lista de
          // barras y la barra de estado contaban cosas distintas.
          _avisarMigracion();
        }
      }, function () {
        ST._catPedido = false;                                   // reintenta al reabrir
        _refrescarFigDatalist();
        _validarFiguraRibbon(false);
      });
  }

  // CONFIGURACIÓN DEL MODELADOR al abrir (GET /modelador/config vía ModeladorConfig).
  // De ahí salen los valores de partida: figura y φ del ribbon, @ sep, modo de
  // colocación, sugeridas del buscador y recubrimientos del elemento.
  //
  // ASÍNCRONO Y SIN BLOQUEAR: mientras no llegue, cada consumidor usa su constante de
  // siempre (ver _sepDefault / _modoDefault / _figsDeTipologia / _tplDimsDefault), o
  // sea que el editor abre y funciona igual que antes. Cuando llega se re-prellena el
  // ribbon y se reordena el buscador; NO se toca la receta — la config decide con qué
  // NACEN las barras nuevas, nunca reescribe un template ya guardado.
  // El módulo memoiza el pedido, así que llamarlo en cada apertura no repite el GET.
  function _cargarConfigModelador() {
    var cfg = global.ModeladorConfig;
    if (!cfg || typeof cfg.cargar !== 'function') return;
    cfg.cargar().then(function () {
      if (!cfg.cargada()) return;   // sin config: se sigue con las constantes, sin ruido
      _prellenarRibbonDesdeConfig(false);
      _refrescarFigDatalist();
      _validarFiguraRibbon(false);
    });
  }

  // ¿Qué EXTREMOS del componente llevan PATA (gancho)? Convención del catálogo, la
  // misma que usa _dimsDefault: en un cabezal A = pata del extremo inicial, C = pata
  // del extremo final, B = el cuerpo. De ahí:
  //   · 101x (un solo parcial) → barra RECTA: ningún extremo con pata.
  //   · 102x (A,B)             → sólo el extremo inicial (no existe C).
  //   · 103x/104x/106x (A,B,C…)→ los dos.
  // Una dim en 'fija' aporta pata si su valor es > 0; en 'auto' la deriva el motor y
  // cuenta como pata presente. Lo consumen el control "Patas" (orient.spin) y los
  // campos Δ de extremo libre (comp.empalme), que sólo aplican donde NO hay pata.
  function _patasDe(c) {
    var P = _figSpec(c && c.figura).parciales || [];
    if (P.length < 2) return { inicio: false, fin: false };
    function hay(L) {
      if (P.indexOf(L) < 0) return false;
      var d = (c.dims || {})[L];
      if (!d) return true;
      if (d.modo === 'fija') return (Number(d.valor) || 0) > 0;
      return true;
    }
    return { inicio: hay('A'), fin: hay('C') };
  }

  // LADO DOMINANTE de una figura = el parcial que SE ESTIRA/ANCLA contra el elemento
  // (el cuerpo de la barra: el que resuelve 'auto' contra el hormigón − recubrimiento).
  // Los demás son patas/retornos que cuelgan de él. La autoridad es el MOTOR
  // (reglas.ladoDominante), resuelta en el momento; sin ella vale la convención del
  // catálogo que ya usa _patasDe: A = pata inicial, C = pata final, B = CUERPO.
  // Devuelve la letra del parcial (o null si la figura no tiene parciales).
  function _ladoDominante(c) {
    // Un CONTORNO CERRADO (estribo/marco/rombo) NO tiene lado dominante: nada se
    // estira a un largo ni recibe empalme — el marco manda. La ficha marcaba "B"
    // igual (fallback de convención) y el usuario lo leyó como un dato editable
    // que no existe (14-ago). Para esas familias: null (la ficha no marca nada).
    var fpDom = global.ModeladorFiguraPuntos;
    if (c && fpDom && fpDom.familiaDeDibujo) {
      var famDom = fpDom.familiaDeDibujo(c.figura, _rolComp(c));
      if (famDom === 'estribo' || famDom === 'rombo') return null;
    }
    var reglas = global.ModeladorReglas;
    if (reglas && reglas.ladoDominante) {
      var L = reglas.ladoDominante(c);
      if (L) return String(L).toUpperCase();
    }
    var P = _figSpec(c && c.figura).parciales || [];
    if (!P.length) return null;
    if (P.length === 1) return P[0];
    return (P.indexOf('B') >= 0) ? 'B' : P[0];
  }

  // LADO DOMINANTE tal como lo resuelve el MOTOR para una barra concreta, SIN el
  // fallback de convención de _ladoDominante. La diferencia importa en el preview:
  // para una figura CERRADA el motor contesta null ("no hay lado que estirar ni
  // que empalmar") y el fallback igual devolvería 'B' — destacar ese B sería
  // pintar un lado dominante que el motor no reconoce.
  function _ladoDomMotor(figura, dims) {
    var reglas = global.ModeladorReglas;
    if (!reglas || !reglas.ladoDominante) return null;
    var L = reglas.ladoDominante({ figura: figura, dims: dims });
    return L ? String(L).toUpperCase() : null;
  }

  // ==========================================================================
  // LADO DOMINANTE ELEGIDO POR EL USUARIO — comp.lado_dominante
  // ==========================================================================
  // El dominante lo decide el MOTOR: la elección del componente (este campo) con
  // máxima prioridad, y si no viene —o es inválida: gancho, diagonal, contorno
  // cerrado, lado inexistente— la cascada del catálogo (ladoDominanteFigura).
  // Desde WF1 (14-ago) reglas.ladoDominante SÍ lee comp.lado_dominante y lo pasa
  // por validarLadoDominante; una elección inválida se ignora CON AVISO. La ficha
  // ofrece la LETRA de cada dim como botón radial (_dimRow) y marca la que manda.
  function _ladoDomElegido(c) {
    var v = c && c.lado_dominante;
    v = String(v == null ? '' : v).trim().toUpperCase();
    return v || null;
  }
  // Escribe la elección, o la BORRA con null ('auto' = vuelve a la cascada). Un
  // lado que la figura no tiene no se escribe: sería un dato imposible de honrar.
  function _setLadoDominante(c, L) {
    if (!c) return;
    var k = String(L == null ? '' : L).trim().toUpperCase();
    if (!k) { delete c.lado_dominante; return; }
    if ((_figSpec(c.figura).parciales || []).indexOf(k) < 0) return;
    c.lado_dominante = k;
  }

  // Cara por defecto según tipología (para colocar).
  function _caraDefault(tip) {
    var t = (tip || '').toUpperCase();
    if (t === 'CBS' || t === 'CBS2' || t === 'CBSN') return 'sup';
    if (t === 'CBI' || t === 'CBI2' || t === 'CBIN') return 'inf';
    return 'lateral';   // ES/TRV/LT
  }

  // ==========================================================================
  // ORIENTACIÓN DE LA PIEZA (contrato nuevo del motor, 12-ago)
  //   plano_pieza.orientacion = 'acostada' | 'volteada' | 'de_pie'
  // El campo viejo `volteado:true` sigue valiendo como 'volteada' (compat), y al
  // escribir se mantienen LOS DOS sincronizados: `orientacion` es la fuente y
  // `volteado` su reflejo booleano, para que ninguna ruta que aún lea el campo
  // viejo vea un estado distinto del que muestra la UI.
  //
  // Cada orientación es una PERMUTACIÓN de ejes del mundo (la misma que aplica el
  // motor a dims, pilas y recubrimientos):
  //   acostada = identidad · volteada = x↔z · de pie = x↔y
  // ==========================================================================
  var _ORIENTACIONES = ['acostada', 'volteada', 'de_pie'];
  var _ORIENT_PERM = {
    acostada: { x: 'x', y: 'y', z: 'z' },
    volteada: { x: 'z', y: 'y', z: 'x' },
    de_pie:   { x: 'y', y: 'x', z: 'z' }
  };

  // Orientación de un COMPONENTE (objeto). Prioriza el campo nuevo; sin él,
  // traduce el booleano viejo. Cualquier valor desconocido → 'acostada'.
  function _orientacionDe(c) {
    var pp = (c && c.plano_pieza) || {};
    var o = String(pp.orientacion || '').toLowerCase();
    if (_ORIENTACIONES.indexOf(o) >= 0) return o;
    return pp.volteado ? 'volteada' : 'acostada';
  }
  function _permOrientacion(c) { return _ORIENT_PERM[_orientacionDe(c)] || _ORIENT_PERM.acostada; }

  // Escribe la orientación en el componente (los dos campos sincronizados).
  function _setOrientacion(comp, ori) {
    if (!comp) return;
    if (_ORIENTACIONES.indexOf(ori) < 0) ori = 'acostada';
    comp.plano_pieza = comp.plano_pieza || {};
    comp.plano_pieza.orientacion = ori;
    comp.plano_pieza.volteado = (ori === 'volteada');   // compat con el campo viejo
  }

  // Siguiente orientación del ciclo del botón: acostada → volteada → de pie → …
  function _orientacionSiguiente(ori) {
    var i = _ORIENTACIONES.indexOf(ori);
    return _ORIENTACIONES[(i < 0 ? 0 : i + 1) % _ORIENTACIONES.length];
  }

  // ==========================================================================
  // POSE CANÓNICA (TANDA P) — UN SOLO MODELO PARA LA ORIENTACIÓN DE UNA PIEZA.
  //
  // Hasta hoy la pose vivía repartida en CUATRO mecanismos que no se hablaban:
  // `cara` (sup/inf/lateral) + `lado` (±1) + `plano_pieza.orientacion`
  // (acostada/volteada/de_pie) + `orient.deg` con su EJE_ROT por vista. Cada
  // elemento nuevo multiplicaba los casos especiales.
  //
  // El modelo único es:
  //     pose = { cara, lado, rumbo, espejo }
  //   · cara   : 'sup'|'inf'|'lateral'|'extremo' — la cara del hormigón contra la
  //              que se ancla. Con su `lado` (±1) son las 6 caras de la caja
  //              (sup/inf ya llevan el signo EN EL NOMBRE; lateral y extremo lo
  //              llevan en `lado`).
  //   · rumbo  : eje del MUNDO ('x'|'y'|'z') a lo largo del cual corre la pieza.
  //              Sólo puede ser uno de los DOS ejes ⊥ a la normal de la cara.
  //   · espejo : bool — la misma pose reflejada (los ganchos cierran al otro lado).
  // 6 caras × 2 rumbos = las 24 orientaciones de una caja, + espejo.
  //
  // COMPATIBILIDAD: `pose` es la fuente, y al escribirla se ESPEJAN los campos
  // viejos (cara / lado / plano_pieza.orientacion), porque el rumbo es exactamente
  // la permutación que ya aplicaba el motor: x=acostada · z=volteada · y=de pie.
  // Así ninguna ruta que aún lea el campo viejo ve un estado distinto del que
  // muestra la UI (misma regla que _setOrientacion).
  // ==========================================================================
  var _CARAS_POSE = ['sup', 'inf', 'lateral', 'extremo'];
  // Normal de cada cara (el eje del mundo al que la cara mira).
  var _NORMAL_DE_CARA = { sup: 'y', inf: 'y', lateral: 'z', extremo: 'x' };
  // Caras cuyo SIGNO no va en el nombre y por eso lo llevan en `lado` (±1):
  // sup/inf ya dicen de qué lado del eje Y están; lateral y extremo, no.
  var _CARA_CON_LADO = { lateral: true, extremo: true };
  // rumbo ↔ orientación vieja (la permutación de ejes que ya aplica el motor).
  var _RUMBO_A_ORIENT = { x: 'acostada', z: 'volteada', y: 'de_pie' };
  var _ORIENT_A_RUMBO = { acostada: 'x', volteada: 'z', de_pie: 'y' };
  var _EJES_MUNDO = ['x', 'y', 'z'];

  // Los dos ejes ⊥ a la normal de la cara = los rumbos POSIBLES de esa cara.
  function _rumbosDeCara(cara) {
    var n = _NORMAL_DE_CARA[cara] || 'y';
    return _EJES_MUNDO.filter(function (e) { return e !== n; });
  }
  function _rumboValido(cara, rumbo) { return _rumbosDeCara(cara).indexOf(rumbo) >= 0; }
  // Rumbo por defecto de una cara: el largo (x) si es ⊥ a ella; si no, el primero.
  function _rumboDefaultDeCara(cara) {
    var r = _rumbosDeCara(cara);
    return (r.indexOf('x') >= 0) ? 'x' : r[0];
  }

  // POSE de un componente. Prioriza `comp.pose`; sin ella hay que DERIVARLA de los
  // campos viejos — y esa derivación la hace el MOTOR (reglas.poseDe), no la UI.
  // Devuelve SIEMPRE un objeto nuevo (no una ref al componente): quien quiera
  // cambiar la pose escribe con _setPose.
  //
  // POR QUÉ EL MOTOR Y NO ACÁ (defecto D2 del verificador). El `cara` de los campos
  // viejos es la cara del MARCO LOCAL de la pieza, no la del mundo: para saber
  // contra qué cara del hormigón queda apoyada hay que COMPONERLA con la
  // permutación de la orientación (acostada = identidad · volteada = x↔z · de pie
  // = x↔y). Esta función leía `cara` como si ya fuera del mundo y, cuando el rumbo
  // que salía de la orientación no era válido para esa cara, lo DESCARTABA en
  // silencio. Divergía del motor en 6 de las 18 combinaciones:
  //     cara 'sup'     + de_pie   → UI {sup,x}      · motor {extremo,+1,y}
  //     cara 'inf'     + de_pie   → UI {inf,x}      · motor {extremo,−1,y}
  //     cara 'lateral' + volteada → UI {lateral,x}  · motor {extremo,±1,z}
  // Con eso, una receta guardada con el botón azul viejo mostraba en la ficha una
  // pose que la pieza NO tenía (dibujada contra el testero) y el botón R le pasaba
  // a rotarPose90 la pose equivocada y ESCRIBÍA el resultado: la pieza saltaba de
  // testero a testero y R×4 ya no restituía — el estado original quedaba fuera de
  // la órbita y se perdía sin aviso.
  //
  // La regla general: el que DIBUJA es el dueño de la traducción. La UI la
  // consulta; no la reimplementa.
  function _poseDe(c) {
    var reglas = global.ModeladorReglas;
    var base = c;
    // Sin `pose` NI `cara` no hay nada que traducir: la cara de partida la pone el
    // default de la TIPOLOGÍA, que es dato de la UI (el motor no lo puede adivinar).
    // Se arma un objeto aparte para no escribir nada en el componente.
    if (!(c && c.pose) && _CARAS_POSE.indexOf(c && c.cara) < 0) {
      base = {
        pose: null, cara: _caraDefault(c && c.tipologia),
        lado: (c && c.lado), plano_pieza: (c && c.plano_pieza), espejo: (c && c.espejo)
      };
    }
    if (reglas && typeof reglas.poseDe === 'function') return reglas.poseDe(base);
    // Sin motor no hay traducción posible de los campos viejos (y sin motor no hay
    // dibujo tampoco): se lee la pose CANÓNICA tal cual, que es lo único que no
    // requiere componer nada. Inventar acá la traducción es lo que causó el D2.
    var p = (base && base.pose) || {};
    var cara = (_CARAS_POSE.indexOf(p.cara) >= 0) ? p.cara : _caraDefault(c && c.tipologia);
    var rumbo = (_EJES_MUNDO.indexOf(p.rumbo) >= 0) ? p.rumbo : _rumboDefaultDeCara(cara);
    if (!_rumboValido(cara, rumbo)) rumbo = _rumboDefaultDeCara(cara);
    return {
      cara: cara, lado: (Number(p.lado) < 0) ? -1 : 1,
      rumbo: rumbo, espejo: !!p.espejo
    };
  }

  // Escribe la pose en el componente + ESPEJA los campos viejos (contrato de compat).
  function _setPose(comp, pose) {
    if (!comp || !pose) return;
    var cara = (_CARAS_POSE.indexOf(pose.cara) >= 0) ? pose.cara : _caraDefault(comp.tipologia);
    var rumbo = (_EJES_MUNDO.indexOf(pose.rumbo) >= 0) ? pose.rumbo : _rumboDefaultDeCara(cara);
    if (!_rumboValido(cara, rumbo)) rumbo = _rumboDefaultDeCara(cara);
    // sup/inf llevan el signo EN EL NOMBRE: su `lado` no significa nada y se
    // normaliza a 1 (si no, quedaría un −1 fantasma que nadie muestra ni edita).
    var lado = (_CARA_CON_LADO[cara] && Number(pose.lado) < 0) ? -1 : 1;
    comp.pose = { cara: cara, lado: lado, rumbo: rumbo, espejo: !!pose.espejo };
    comp.cara = cara;                                        // campo viejo (motor + fichas)
    comp.lado = lado;                                        // campo viejo (cara cortina)
    _setOrientacion(comp, _RUMBO_A_ORIENT[rumbo] || 'acostada');   // plano_pieza (compat)
  }

  // (22-ago) Acá vivía `_poseTexto` — "cara inf · corre en largo (Y)", la pose dicha
  // en coordenadas del MODELO (cara + signo + eje + letra). Su único llamador era el
  // tooltip del botón de giro, y desde el bloque ORIENTACIÓN ese tooltip usa la MISMA
  // frase de obra que la ficha (_fraseOrientacion). Dos vocabularios para el mismo
  // estado, en dos sitios que se miran a la vez, era justo lo que había que sacar.

  // ==========================================================================
  // ORIENTACIÓN EN LENGUAJE DE OBRA — la capa de PRESENTACIÓN de la pose (22-ago).
  //
  // POR QUÉ EXISTE. La ficha mostraba CINCO filas para una sola cosa —cómo está
  // puesta la pieza—: «Cara / anclaje», «Lado», «Rotar», «Pose» y «Patas». Y encima
  // la fila de Cara mezclaba dos niveles: 'sup' e 'inf' son CARAS CONCRETAS (el signo
  // va en el nombre) mientras 'lateral' y 'extremo' son PARES que necesitaban la fila
  // «Lado» para desambiguar. Por eso esa fila existía, por eso quedaba inerte la mitad
  // del tiempo, y por eso se comía un renglón entero de un panel de 360 px.
  //
  // Peor que eso: se enseñaban las COORDENADAS DEL MODELO (cara + signo + rumbo +
  // espejo, cada una en su fila) en vez del RESULTADO. Al girar 90° se movían dos
  // filas a la vez y parecía un error, cuando era UNA orientación cambiando.
  //
  // EL DATO NO CAMBIA: la pose sigue siendo {cara, lado, rumbo, espejo} con sus 24
  // orientaciones, y quien las escribe sigue siendo _setPose. Lo que cambia es cómo
  // se dice: las 6 caras de la caja en UN control (cara+lado fundidos), el RUMBO como
  // control propio —que antes no existía pese a ser una coordenada que el giro
  // cambia—, y una FRASE que lee la pose entera y la dice en una línea.
  //
  // EL VOCABULARIO NO ES NUEVO. Sale de CARAS_OBRA (la misma tabla del selector del
  // desplazamiento medido: «cara frontal», «lateral posterior», «testero inicio») y de
  // EJE_ROTULO_POS («a lo largo», «en altura», «a lo ancho»). Un solo vocabulario en
  // todo el editor: si esas tablas cambian con el elemento, esto cambia con ellas.
  // ==========================================================================
  // Las 6 caras de la caja = (cara, lado) APLANADO. Cada una trae el eje del mundo y
  // el extremo de ese eje que le tocan, y de ahí sale su nombre por CARAS_OBRA — no
  // hay una segunda tabla de nombres que se pueda desincronizar de la primera.
  var _CARAS6 = [
    { id: 'sup', cara: 'sup', lado: 1, eje: 'y', ref: 'max' },
    { id: 'inf', cara: 'inf', lado: 1, eje: 'y', ref: 'min' },
    { id: 'lat+', cara: 'lateral', lado: 1, eje: 'z', ref: 'max' },
    { id: 'lat-', cara: 'lateral', lado: -1, eje: 'z', ref: 'min' },
    { id: 'ext+', cara: 'extremo', lado: 1, eje: 'x', ref: 'max' },
    { id: 'ext-', cara: 'extremo', lado: -1, eje: 'x', ref: 'min' }
  ];
  function _cara6(id) {
    for (var i = 0; i < _CARAS6.length; i++) if (_CARAS6[i].id === id) return _CARAS6[i];
    return _CARAS6[0];
  }
  // Pose → id de cara. OJO CON EL `lado` DE sup/inf: el motor devuelve lado −1 para
  // 'inf' (su signo ES la cara) y _setPose lo normaliza a 1. O sea que el lado de
  // esas dos caras NO se puede mirar: la cara sola ya identifica.
  function _caraId(p) {
    if (!p) return 'sup';
    if (p.cara === 'sup' || p.cara === 'inf') return p.cara;
    var neg = (Number(p.lado) < 0);
    return (p.cara === 'extremo') ? (neg ? 'ext-' : 'ext+') : (neg ? 'lat-' : 'lat+');
  }
  // Nombre de obra de una cara — el MISMO que rotula el desplazamiento medido.
  function _nombreCara6(id) {
    var f = _cara6(id);
    var caras = _carasObraEje(f.eje);
    return (f.ref === 'max') ? caras.max : caras.min;
  }
  // Nombre de obra de un RUMBO ("a lo largo" / "en altura" / "a lo ancho"), en
  // minúscula porque va dentro de una frase y no encabezando una fila.
  function _nombreRumbo(r) {
    var n = EJE_ROTULO_POS[r];
    return n ? (n.charAt(0).toLowerCase() + n.slice(1)) : String(r || '');
  }
  // El artículo sale de la PRIMERA PALABRA del nombre de obra, que cambia con el
  // elemento ("cara/lateral/testero" en viga · "borde/cara/extremo" en muro): así no
  // hay una tabla de géneros que mantener a mano al lado de CARAS_OBRA.
  var _ART_CARA = { cara: 'la ', lateral: 'el ', testero: 'el ', borde: 'el ', extremo: 'el ' };
  // LA FRASE DE ESTADO. Es la pieza clave del bloque: dice la pose entera en una
  // línea de obra («Apoyada en la cara frontal · corre a lo largo · espejada»), y es
  // lo que le explica al usuario por qué al girar se movieron dos controles a la vez.
  function _fraseOrientacion(p) {
    if (!p) return '';
    var nom = _nombreCara6(_caraId(p));
    var art = _ART_CARA[String(nom).split(' ')[0]] || '';
    var t = 'Apoyada en ' + art + nom + ' · corre ' + _nombreRumbo(p.rumbo);
    if (p.espejo) t += ' · espejada';
    return t;
  }

  // ICONO DE CARA — la caja del elemento en axonometría con ESA cara encendida (el
  // cubo de vistas de Revit/Tekla). El botón no lleva texto: el nombre lo dice la
  // frase de arriba y el `title` del botón.
  //
  // LA CAJA VA EN ALAMBRE, no maciza, POR UNA RAZÓN: de las 6 caras sólo 3 miran al
  // observador (superior, frontal y fin). Sin relleno, las otras 3 tienen su propio
  // paralelogramo —desplazado del de su opuesta— y se pueden encender igual; las
  // aristas ocultas van punteadas, que es lo que le dice al ojo cuál es el fondo.
  // Todo se dibuja con `currentColor`, así el icono sigue al estado del botón
  // (apagado = gris de campo · encendido = azul) y a los tres temas sin una regla más.
  var _ICO_CARA = (function () {
    // Caja: rectángulo de FRENTE (x0,y0)-(x1,y1) + vector al FONDO (dx,dy).
    var x0 = 3, y0 = 9, x1 = 29, y1 = 25, dx = 8, dy = -6;
    function P(x, y) { return x + ',' + y; }
    var n = { bl: P(x0, y1), br: P(x1, y1), tr: P(x1, y0), tl: P(x0, y0) };
    var f = {
      bl: P(x0 + dx, y1 + dy), br: P(x1 + dx, y1 + dy),
      tr: P(x1 + dx, y0 + dy), tl: P(x0 + dx, y0 + dy)
    };
    return {
      // `frente:false` = la cara queda al fondo → se pinta más tenue y punteada.
      caras: {
        'sup': { pts: [n.tl, n.tr, f.tr, f.tl], frente: true },
        'inf': { pts: [n.bl, n.br, f.br, f.bl], frente: false },
        'lat+': { pts: [n.bl, n.br, n.tr, n.tl], frente: true },
        'lat-': { pts: [f.bl, f.br, f.tr, f.tl], frente: false },
        'ext+': { pts: [n.br, f.br, f.tr, n.tr], frente: true },
        'ext-': { pts: [n.bl, f.bl, f.tl, n.tl], frente: false }
      },
      frenteRect: [n.bl, n.br, n.tr, n.tl].join(' '),
      fondoVis: [f.tl, f.tr, f.br].join(' '),          // aristas del fondo que SÍ se ven
      unen: 'M' + n.tl + 'L' + f.tl + 'M' + n.tr + 'L' + f.tr + 'M' + n.br + 'L' + f.br,
      ocultas: 'M' + n.bl + 'L' + f.bl + 'M' + f.bl + 'L' + f.tl + 'M' + f.bl + 'L' + f.br
    };
  })();
  // UNA o VARIAS caras encendidas sobre la MISMA caja. El plural lo usa el bloque de
  // posición, que enciende el PAR DE CARAS OPUESTAS de un eje: un solo vocabulario
  // visual en toda la ficha, sin un segundo juego de símbolos que aprender.
  function _iconoCaras6(ids) {
    var relleno = (ids || []).map(function (id) {
      var c = _ICO_CARA.caras[id] || _ICO_CARA.caras.sup;
      return '<polygon points="' + c.pts.join(' ') + '" fill="currentColor" fill-opacity="' +
        (c.frente ? '.88' : '.32') + '" stroke="currentColor" stroke-width="1" stroke-opacity="' +
        (c.frente ? '.9' : '.65') + '"' + (c.frente ? '' : ' stroke-dasharray="2 1.5"') + '/>';
    }).join('');
    return '<svg class="te-caraico" viewBox="0 0 40 28" width="30" height="21" aria-hidden="true" focusable="false">' +
      relleno +
      '<g fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round">' +
      '<polygon points="' + _ICO_CARA.frenteRect + '" opacity=".6"/>' +
      '<polyline points="' + _ICO_CARA.fondoVis + '" opacity=".6"/>' +
      '<path d="' + _ICO_CARA.unen + '" opacity=".6"/>' +
      '<path d="' + _ICO_CARA.ocultas + '" opacity=".28" stroke-dasharray="2 1.5"/>' +
      '</g></svg>';
  }
  function _iconoCara6(id) { return _iconoCaras6([id]); }

  // ICONO DE ESPEJO (23-ago) — el de AutoCAD: un EJE PUNTEADO vertical con una figura
  // y su reflejo, uno a cada lado. Reemplaza a la letra «E» del botón, que no decía
  // nada a quien no supiera ya qué hacía. Mismo criterio que los iconos de cara: trazo
  // simple y `currentColor`, así el dibujo sigue al estado del botón (apagado = gris
  // de campo · encendido = el morado de espejo, con texto blanco) y a los tres temas
  // sin una regla de color nueva.
  // EL REFLEJO VA SIN RELLENO: es lo que distingue el original de su imagen. Con las
  // dos macizas el dibujo se lee como dos cuñas cualquiera y se pierde el «esto es lo
  // mismo, dado vuelta», que es justo lo que hace el botón.
  var _ICO_ESPEJO = (function () {
    var izq = '4,7 10,4 10,20 4,17';                 // la figura
    var der = '20,7 14,4 14,20 20,17';               // …y su reflejo en x = 12
    return '<svg class="te-espico" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false">' +
      '<polygon points="' + izq + '" fill="currentColor" fill-opacity=".85" stroke="currentColor" ' +
      'stroke-width="1.2" stroke-linejoin="round"/>' +
      '<polygon points="' + der + '" fill="none" stroke="currentColor" stroke-width="1.2" ' +
      'stroke-linejoin="round" opacity=".8"/>' +
      '<line x1="12" y1="1.5" x2="12" y2="22.5" stroke="currentColor" stroke-width="1.2" ' +
      'stroke-linecap="round" stroke-dasharray="3 2.5"/>' +
      '</svg>';
  })();
  // Las DOS caras opuestas de un eje, sacadas de _CARAS6 (no de una tabla nueva que
  // se pueda desincronizar): { min:'ext-', max:'ext+' } para x, etc.
  function _carasIdDeEje(eje) {
    var out = {};
    _CARAS6.forEach(function (f) { if (f.eje === eje) out[f.ref] = f.id; });
    return out;
  }

  // POSE POR DEFECTO de una tipología — la AUTORIDAD es el motor (tabla
  // POSES_DEFAULT por elemento×tipología, o la función poseDefault), resuelta EN EL
  // MOMENTO (nunca capturada a nivel de módulo: los scripts cargan en paralelo).
  // Devuelve null si el motor todavía no la publica → el llamador cae a los
  // defaults dispersos de siempre (_caraDefault + _metaModular).
  function _poseDefaultMotor(tip) {
    var reglas = global.ModeladorReglas;
    if (!reglas) return null;
    var elem = _tipoElemento();
    var p = null;
    if (typeof reglas.poseDefault === 'function') p = reglas.poseDefault(elem, tip);
    if (!p && reglas.POSES_DEFAULT) {
      var porElem = reglas.POSES_DEFAULT[elem] || reglas.POSES_DEFAULT[String(elem || '').toUpperCase()];
      if (porElem) p = porElem[String(tip || '').toUpperCase()] || porElem[tip] || null;
    }
    return p || null;
  }
  // Pose inicial de una tipología: la del motor si existe; si no, la que sale de los
  // defaults viejos (cara por tipología + orientación de _metaModular).
  function _poseDefault(tip, meta) {
    var m = _poseDefaultMotor(tip);
    if (m) return _poseDe({ tipologia: tip, pose: m });
    var ori = (meta && meta.plano_pieza && meta.plano_pieza.orientacion) || 'acostada';
    return _poseDe({ tipologia: tip, cara: _caraDefault(tip), lado: 1, plano_pieza: { orientacion: ori } });
  }

  // (15-ago) `_compVolteado` y `_compOrientacion` RETIRADAS: sólo alimentaban el
  // estado del viejo botón de voltear, que murió cuando el volteo y la tecla R
  // pasaron a ser una sola operación (_rotarPoseSeleccion). Cero llamadores.

  // dims por defecto para una figura recién colocada: TODAS auto (se ajustan al
  // recubrimiento; recub 0 = al borde).
  // (20-ago) Ya no recibe `contorno`: escribía dims.__contorno = false, una marca que
  // NADIE leía nunca — ni el motor, ni las vistas, ni el backend.
  function _dimsDefault(fig) {
    var spec = _figSpec(fig);
    var dims = {};
    // TODO EN AUTO, para todos los roles (pedido del usuario 13-ago, tras el
    // AUTO universal): cada lado se ancla solo a lo que su dirección cruza
    // (diagonal → gancho normativo · perpendicular → profundidad útil · a lo
    // largo → largo útil). Los defaults fijos anteriores (15 y luego el gancho)
    // eran muletas de cuando las patas en auto no se anclaban a nada.
    spec.parciales.forEach(function (L) { dims[L] = { modo: 'auto' }; });
    return dims;
  }

  // Distribución de PARTIDA. El MODO lo decide el preset de la tipología
  // (modoDefaultDeTipologia, autoridad del motor) y el @ sale de _sepDefault:
  // dos presets, ninguna regla. Antes ramificaba por el rol —incluido 'traba',
  // que el motor ya no emite—, así que una figura abierta bajo TR nacía por una
  // rama muerta.
  function _distDefault(tip) {
    if (_modoDefault(tip) === 'puntual') {
      return { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 4, sentido: 'nucleo', justify: 'centrar' };
    }
    var sp = _sepDefault(tip);
    return { modo: 'linear', activa: false, sep: sp, zonas: [{ long: 0, sep: sp }], start_offset: 4 };
  }

  // ==========================================================================
  // MODO DE USO (§0-11ter / §INTERACCIÓN-2.0 · los 3 botones del panel):
  // 'puntual' | 'lineal' | 'arreglo'. Es el selector de ALTO NIVEL con el que el
  // usuario decide CÓMO se coloca la barra; el panel muestra campos DISTINTOS por
  // modo (menú contextual). Es INDEPENDIENTE de la tipología (la tipología solo
  // trae un preset).
  //   puntual → distribucion.modo:'layered'  (capas hacia el núcleo)
  //   lineal  → distribucion.modo:'linear'   (rango @ ; cant = ceil(dist/@)+1)
  //   arreglo → distribucion.modo:'arreglo'  (rango × n_capas @ sep_capas)
  // reglas.js despacha 'arreglo' aparte; 'puntual'/'lineal' caen a layered/linear.
  // ==========================================================================
  var MODO_A_DIST = { puntual: 'layered', lineal: 'linear', arreglo: 'arreglo' };

  // MODO por default de una TIPOLOGÍA (§INTERACCIÓN-2.0). Fuente autoritativa: el
  // motor (ModeladorReglas.modoDefaultDeTipologia), resuelto EN EL MOMENTO de usar
  // (nunca capturado a nivel de módulo: los scripts cargan en paralelo). Fallback
  // por ROL si el motor no está: estribo/traba → 'lineal'; el resto → 'puntual'.
  function _modoDefault(tip) {
    // La CONFIG GUARDADA manda sobre el preset del motor: es lo que el usuario dejó
    // escrito en la pantalla de Configuración para ESTE elemento + tipología (el
    // preset del motor sólo conoce la tipología pelada). Sin config, todo sigue igual.
    var cfg = global.ModeladorConfig;
    var m = (cfg && cfg.modo) ? cfg.modo(_tipoElemento(), tip) : null;
    if (m) return m;
    var reglas = global.ModeladorReglas;
    if (reglas && reglas.modoDefaultDeTipologia) return reglas.modoDefaultDeTipologia(tip);
    // Fallback (motor no cargado): estribos y trabas nacen repartidos.
    return (_rolDe(tip) === 'estribo' || _sepDefault(tip) !== SEP_DEFAULT) ? 'lineal' : 'puntual';
  }

  // Metadata modular ADITIVA de un componente nuevo (§INTERACCIÓN-2.0). Defaults
  // INERTES: plano sin voltear + arreglo de 1 sola capa (= igual que hoy). El
  // `modo` es el preset de la tipología. Se copia al crear cada componente para
  // que todo consumidor vea el mismo shape (el motor igual lo normaliza).
  function _metaModular(tip) {
    // MV (Malla Vertical de muro) nace DE PIE: sus barras corren en la altura.
    // El resto nace acostada como siempre.
    var t = (tip || '').toUpperCase();
    var dePie = (t === 'MV');
    return {
      modo: _modoDefault(tip),
      plano_pieza: dePie ? { orientacion: 'de_pie', volteado: false }
                         : { orientacion: 'acostada', volteado: false },
      arreglo: { n_capas: 1, sep_capas: 20, rango: null }
    };
  }

  // Deriva el modo de uso ACTUAL de un componente (sin mutarlo). Prioriza el campo
  // explícito comp.modo; si no está, lo infiere de distribucion.modo (para la
  // semilla y recetas viejas que solo traen distribucion.modo).
  function _modoDe(c) {
    if (c.modo === 'puntual' || c.modo === 'lineal' || c.modo === 'arreglo') return c.modo;
    var dm = (c.distribucion && c.distribucion.modo) || '';
    if (dm === 'layered') return 'puntual';
    if (dm === 'arreglo') return 'arreglo';
    if (dm === 'linear') return 'lineal';
    return _modoDefault(c.tipologia);
  }

  // ==========================================================================
  // ANCLAJE DE LA POSICIÓN (18-ago) — helper ÚNICO de escritura
  // --------------------------------------------------------------------------
  // La receta guarda la INTENCIÓN («este punto va a 40 cm del borde»), no la
  // coordenada resuelta: sin eso, cambiar el hormigón dejaba la distribución
  // congelada donde se dibujó (medido: viga 600 → 800 dejaba los estribos a 140 cm
  // de cada borde en vez de a 40; a 400 sacaba 60 cm de fierro fuera del hormigón).
  // La fórmula vive UNA sola vez, en reglas.js (`anclarRango` / `anclarPosHint`), y
  // TODOS los sitios de la UI que escriben from/to o pos_hint pasan por acá: si la
  // cuenta se repartiera entre el arrastre, los campos del panel, _syncN y
  // _rangoDefault, la primera divergencia volvería a congelar el rango en silencio.
  // `forzar` = una edición del usuario mueve la INTENCIÓN, no sólo el número.
  // ==========================================================================
  function _anclarRangoUI(rango, eje) {
    var d = _deps();
    if (!rango || !d.reglas || typeof d.reglas.anclarRango !== 'function') return rango;
    try { d.reglas.anclarRango(rango, _hostDeReceta(), eje || rango.eje || 'x', true); } catch (e) { /* nunca romper la edición */ }
    return rango;
  }

  // El hint que acaba de escribir el gesto INVALIDA las anclas de posición del
  // componente (todos sus ejes con hint). No las reescribe: el ancla del pos_hint
  // guarda la POSICIÓN de la barra (base + hint) y la base —dónde nace la pieza sin
  // traslación— sólo existe mientras el motor expande. Las estampa él, en la
  // regeneración que viene detrás de cada arrastre.
  function _anclarHintUI(comp) {
    var d = _deps();
    if (!comp || !d.reglas || typeof d.reglas.anclarPosHint !== 'function') return comp;
    try { d.reglas.anclarPosHint(comp, _hostDeReceta(), true); } catch (e) { /* idem */ }
    return comp;
  }

  // ==========================================================================
  // DESPLAZAMIENTO MEDIDO CON CARA DE REFERENCIA (21-ago)
  // --------------------------------------------------------------------------
  // EL PROBLEMA (palabras del usuario): no había forma de decir «esta pieza va a
  // tantos centímetros de esta cara». O se daba una medida absoluta, o se dejaba que
  // la pieza llenara el hormigón; toda colocación deliberada terminaba arrastrando a
  // mano y perdiendo el control del número. Hace falta para poner una segunda capa de
  // cabezales sin arrastrarla y para colocar estribos de confinamiento de a uno.
  //
  // LO QUE YA EXISTÍA: el arrastre guarda la posición como DISTANCIA A LA CARA MÁS
  // CERCANA (comp.pos_ancla, que estampa el motor vía reglas.anclarPosHint) y la
  // resuelve contra el hormigón en cada generación. El dato, la referencia y la
  // resolución ya funcionaban: lo único que faltaba era poder ESCRIBIR el número y
  // VER contra qué cara se está midiendo. Esto no agrega un modelo nuevo.
  //
  // LA MISMA PUERTA QUE EL ARRASTRE. _setHuecoACara traduce «déjame tantos cm a esta
  // cara» a un delta de traslación y lo suma a pos_hint, igual que _dragMover, y
  // después invalida el ancla con _anclarHintUI para que el motor la re-estampe en la
  // regeneración siguiente. Si escribiera por su cuenta (tocando pos_ancla, por
  // ejemplo) el número tecleado y el gesto podrían discrepar; así no pueden.
  //
  // EL NÚMERO ES EL HUECO, NO EL ANCLA. La cota viva del arrastre ya rotula el hueco
  // REAL entre el bbox de la pieza y la cara (ver _cotasVivasPieza), y ése es el
  // número que el usuario ve mientras mueve y el que se mide en obra. El ancla guarda
  // la distancia al CENTRO del grupo —misma intención, otro punto de medida—, así
  // que la ficha rotula el hueco para no decir un número distinto del que la pantalla
  // ya muestra. Consecuencia honesta: al cambiar el hormigón se conserva la distancia
  // ANCLADA, y el hueco la acompaña mientras la pieza no cambie de tamaño en ese eje
  // (una dimensión en 'auto' que crece con el elemento SÍ lo mueve, y debe hacerlo).
  //
  // LA CARA NO SE ELIGE AL CREAR NI SALE DEL LADO DOMINANTE (decisión cerrada): al
  // colocar nadie sabe todavía dónde va a quedar la pieza, y el lado dominante habla
  // de la FORMA y de los ganchos, no de la colocación. Se DERIVA —la más cercana, que
  // es lo que ya hace el motor—, se MUESTRA siempre y se puede cambiar ahí mismo.
  // El selector de cara NO se persiste: dice desde dónde se está midiendo AHORA. El
  // ancla la sigue eligiendo el motor (la cara más cercana), que es la regla que el
  // usuario ya validó; por eso al reabrir la ficha el selector vuelve a esa cara.
  // ==========================================================================

  // Nombres de OBRA de las dos caras de cada eje. Sin jerga de ejes: la ficha dice
  // «a 12 cm del testero», no «x = −285». La letra del eje queda en el tooltip, con
  // _ejeLetra (que es la única traducción interno → letra visible).
  // LAS DOS CARAS DEL EJE DE PROFUNDIDAD (ancho de la viga, espesor del muro) SE
  // LLAMAN FRONTAL Y POSTERIOR, no «+» y «−». El signo es jerga de ejes y no dice
  // nada en obra; frontal/posterior sí, y además NO se inventa: la cámara de la
  // elevación mira desde +Z (_ORTO_DIR.z.eye = [0,0,1]), así que la cara que en esa
  // vista da hacia el usuario es literalmente la del máximo del eje. El vocabulario
  // es el mismo que ya usa el radial de Cara/anclaje (Superior · Inferior · Lateral ·
  // Extremo): por eso la viga conserva el «lateral» y el muro habla de sus caras.
  var CARAS_OBRA = {
    viga: {
      x: { min: 'testero inicio', max: 'testero fin' },
      y: { min: 'cara inferior', max: 'cara superior' },
      z: { min: 'lateral posterior', max: 'lateral frontal' }
    },
    muro: {
      x: { min: 'extremo inicio', max: 'extremo fin' },
      y: { min: 'borde inferior', max: 'borde superior' },
      z: { min: 'cara posterior', max: 'cara frontal' }
    }
  };
  // Cómo se llama el EJE en la ficha (tampoco por su letra: por lo que recorre).
  var EJE_ROTULO_POS = { x: 'A lo largo', y: 'En altura', z: 'A lo ancho' };

  function _carasObraEje(eje) {
    var t = CARAS_OBRA[_tipoElemento()] || CARAS_OBRA.viga;
    return t[eje] || CARAS_OBRA.viga[eje];
  }

  // ==========================================================================
  // LA MEDIDA VA AL BORDE DE LA BARRA, NO A SU EJE (23-ago)
  // --------------------------------------------------------------------------
  // Defecto de fondo: TODO el modelo mide a los bordes (las dims A/B/C de una figura
  // se miden a la CRESTA del doblez, no al eje), pero los `puntos` de un placement
  // son el EJE de la barra. Medido con los datos del usuario —recubrimiento 2 cm y
  // φ8—: el fierro apoya su BORDE en la línea de recubrimiento, así que su eje queda
  // a 2 + 0.4 = 2.4 cm de la cara y la ficha decía 2,4 donde en obra se mide 2,0.
  //
  // NO ES UN φ/2 A CIEGAS: CUÁNTO SOBRESALE DEPENDE DE LA DIRECCIÓN DEL TRAMO. Un
  // tramo que corre POR el eje que se mide termina en un CORTE PLANO y no sobresale
  // nada (el extremo de una barra longitudinal contra el testero mide lo que dice su
  // punta); uno perpendicular cruza el eje entero y sobresale φ/2 (la cresta de un
  // estribo). Para un cilindro de radio r y dirección unitaria u la envolvente sobre
  // cada eje e es r·√(1−u_e²), que da exactamente 0 a lo largo y r de través sin
  // partir en casos. Un tramo de largo cero cae en la esfera (r en los tres ejes).
  // ==========================================================================
  var _EJES3 = ['x', 'y', 'z'];
  function _acumBordeTramo(a, b, r, lo, hi) {
    if (!a || !b) return;
    var dx = Number(b.x) - Number(a.x), dy = Number(b.y) - Number(a.y), dz = Number(b.z) - Number(a.z);
    if (!isFinite(dx) || !isFinite(dy) || !isFinite(dz)) return;
    var d = { x: dx, y: dy, z: dz };
    var L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    for (var i = 0; i < 3; i++) {
      var e = _EJES3[i];
      var va = Number(a[e]), vb = Number(b[e]);
      if (!isFinite(va) || !isFinite(vb)) continue;
      var u = (L > 1e-9) ? (d[e] / L) : 0;
      var s = (Number(r) || 0) * Math.sqrt(Math.max(0, 1 - u * u));
      var v0 = Math.min(va, vb) - s, v1 = Math.max(va, vb) + s;
      if (v0 < lo[e]) lo[e] = v0;
      if (v1 > hi[e]) hi[e] = v1;
    }
  }

  // bbox del componente EN COORDENADAS DEL HOST (cm), de lo ÚLTIMO GENERADO.
  // Sale del generado real (ST.ultimoOut, etiquetado con meta.ci) y no de una
  // expansión propia a propósito: _hostDeReceta no lleva las pilas por cara que arma
  // generar.js, así que una expansión aparte pondría la pieza en otro sitio y la
  // ficha rotularía un hueco que el dibujo desmiente (la misma razón por la que
  // _etiquetarCi expande CLONES). null = todavía no hay nada generado.
  // Cada eje trae DOS pares: `lo`/`hi` son el EJE de la barra (lo que hay que mover
  // para trasladarla, y de donde sale el centro que elige la cara de anclaje) y
  // `loB`/`hiB` son el BORDE DEL ACERO (ver _acumBordeTramo), que es lo que se MIDE.
  function _bboxCompMundo(ci) {
    var out = ST.ultimoOut;
    if (!out || !out.placements) return null;
    var EJES = _EJES3;
    var lo = { x: Infinity, y: Infinity, z: Infinity };
    var hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    var loB = { x: Infinity, y: Infinity, z: Infinity };
    var hiB = { x: -Infinity, y: -Infinity, z: -Infinity };
    var n = 0;
    out.placements.forEach(function (pl) {
      if (!pl.meta || pl.meta.ci !== ci) return;
      var pts = pl.puntos || [];
      var r = (Number(pl.diam) || 0) / 2;      // pl.diam YA viene en cm (ver generar.js)
      pts.forEach(function (pt) {
        for (var i = 0; i < 3; i++) {
          var e = EJES[i], v = Number(pt[e]);
          if (!isFinite(v)) continue;
          if (v < lo[e]) lo[e] = v;
          if (v > hi[e]) hi[e] = v;
          n++;
        }
      });
      // El borde va POR TRAMOS, no por puntos: la envolvente de cada uno depende de
      // hacia dónde corre (un punto suelto —placement de un solo punto— es la esfera).
      if (pts.length === 1) _acumBordeTramo(pts[0], pts[0], r, loB, hiB);
      for (var j = 0; j + 1 < pts.length; j++) _acumBordeTramo(pts[j], pts[j + 1], r, loB, hiB);
    });
    if (!n) return null;
    var bb = {};
    for (var k = 0; k < 3; k++) {
      var ej = EJES[k];
      if (!isFinite(lo[ej]) || !isFinite(hi[ej])) return null;
      bb[ej] = {
        lo: lo[ej], hi: hi[ej], c: (lo[ej] + hi[ej]) / 2,
        // Sin tramos válidos (φ desconocido, un solo punto ilegible) el borde cae al
        // eje: se pierde la corrección, nunca la medida.
        loB: isFinite(loB[ej]) ? loB[ej] : lo[ej],
        hiB: isFinite(hiB[ej]) ? hiB[ej] : hi[ej]
      };
    }
    return bb;
  }

  // EJES EN LOS QUE EL DESPLAZAMIENTO APLICA (verificado MIDIENDO el motor, no
  // supuesto):
  //   · El EJE POR EL QUE REPARTE UNA DISTRIBUCIÓN queda FUERA. Ahí la posición la
  //     manda el rango, y el propio editor borra pos_hint/pos_ancla de ese eje al
  //     encender la distribución (_setModoComp y el 1er arrastre del abanico): un
  //     número escrito ahí se lo lleva el primer gesto. Se excluye el eje del rango
  //     y, en un ARREGLO, también el de la 2ª línea.
  //   · EL EJE DE LA CARA CONTRA LA QUE SE ANCLA UN CABEZAL SÍ SE OFRECE. El aviso
  //     del motor («la posición la fija el recubrimiento, no el rango») habla del
  //     RANGO, no del desplazamiento: medido sobre la viga-semilla, un pos_hint en
  //     ese eje mueve la pieza y el ancla se estampa bien (CBS con hint.y = 10 pasa
  //     de y = 10.876 a 20.876 y declara 9.12 cm a la cara superior, que es lo que
  //     se dibuja). Y es JUSTO el caso que el usuario pidió: la segunda capa de
  //     cabezales a tantos cm de la cara. El arrastre no escribe la Y de un cabezal
  //     —ahí la gobiernan las capas—, así que en ese eje escribir el número es el
  //     único camino, que es exactamente de lo que se trata esto.
  function _ejesDesplazables(c) {
    var libres = ['x', 'y', 'z'];
    var d = c && c.distribucion;
    if (!d || !d.activa) return libres;
    var modo = _modoDe(c);
    if (modo !== 'lineal' && modo !== 'arreglo') return libres;
    var fuera = {};
    fuera[(d.rango && d.rango.eje) || _ejeDistDe(c)] = true;
    if (modo === 'arreglo' && d.rango2 && d.rango2.eje) fuera[d.rango2.eje] = true;
    return libres.filter(function (e) { return !fuera[e]; });
  }

  // (23-ago) Acá vivía `_caraRefEje` — «la cara que eligió el motor», que era el valor
  // de partida del desplegable de cara. Ese desplegable YA NO EXISTE: la ficha muestra
  // las distancias a LAS DOS caras del eje, así que no hay ninguna que elegir ni
  // ninguna cara de partida que derivar. El ancla la sigue eligiendo el motor.

  // HUECO entre la pieza y una cara del HORMIGÓN (cm). Mismo criterio que la cota
  // viva del arrastre: borde de la pieza contra la cara, no contra el recubrimiento.
  // Negativo = la pieza se pasó de esa cara, y se dice con su signo.
  // VA AL BORDE DEL ACERO (loB/hiB), no al eje: con recub 2 y φ8 el campo dice 2,0 y
  // no 2,4. El medio diámetro se descuenta POR EL LADO QUE CORRESPONDE —el borde de
  // abajo baja y el de arriba sube—, así que los dos huecos se achican; escribirlo
  // con el mismo signo en los dos dejaría uno bien y el otro con un φ de error.
  function _huecoACara(bb, eje, ref) {
    if (!bb || !bb[eje]) return null;
    var D = _dimEjeGeo(eje);
    if (!isFinite(D)) return null;
    return (ref === 'max') ? (D / 2 - bb[eje].hiB) : (bb[eje].loB + D / 2);
  }

  // ESCRIBIR el desplazamiento: «déjame `cm` entre esta pieza y esta cara». Se
  // traduce a un delta de traslación y se suma a pos_hint —LA MISMA PUERTA que usa
  // _dragMover— y se invalida el ancla para que el motor la re-estampe al expandir.
  // NO regenera: eso lo hace quien llama (_mut), igual que el resto de los campos.
  // Devuelve true si escribió (o si ya estaba ahí), false si no había con qué medir.
  function _setHuecoACara(ci, eje, ref, cm) {
    var c = ST.receta && ST.receta.componentes && ST.receta.componentes[ci];
    if (!c) return false;
    var n = Number(cm);
    if (!isFinite(n)) return false;
    var hoy = _huecoACara(_bboxCompMundo(ci), eje, ref);
    if (hoy == null) return false;
    // El delta es la diferencia entre el hueco que se pide y el que hay: mover la
    // pieza ESE tanto la deja exactamente ahí (el bbox se traslada rígido con ella).
    // Contra la cara 'max' el signo se invierte: acercarse a ella es ir hacia +.
    var delta = (ref === 'max') ? (hoy - n) : (n - hoy);
    if (!isFinite(delta)) return false;
    if (Math.abs(delta) < 1e-9) return true;   // ya está donde se pide
    c.pos_hint = c.pos_hint || {};
    c.pos_hint[eje] = (Number(c.pos_hint[eje]) || 0) + delta;
    _anclarHintUI(c);
    return true;
  }

  // ==========================================================================
  // EL EJE QUE SÍ REPARTE — las dos puntas del rango, medidas a las caras (23-ago)
  // --------------------------------------------------------------------------
  // En un eje por el que corre la distribución la posición NO la manda pos_hint (el
  // editor lo borra al encender el abanico): la mandan `from`/`to`. Así que el par de
  // campos de ese eje muestra DÓNDE EMPIEZA Y DÓNDE TERMINA EL REPARTO, y moverlos
  // mueve el rango. Ahí los dos números SÍ son independientes: el largo del rango es
  // libre, a diferencia del eje que no reparte (donde la pieza tiene un tamaño y una
  // distancia determina la otra).
  //
  // SE MIDE AL EJE DE LA BARRA, no al borde: `from`/`to` son POSICIONES del reparto —
  // dónde va la primera y la última barra— y es exactamente el número que la cota
  // viva del abanico dibuja mientras se arrastra (_anclaViva). Los dos se miran a la
  // vez, así que tienen que decir lo mismo. El borde es la medida de una PIEZA contra
  // una cara (el otro par), que es otra cosa.
  // ==========================================================================
  // Rango que reparte por un eje del mundo, o null si por ese eje no reparte nadie.
  function _rangoDeEje(c, eje) {
    var d = c && c.distribucion;
    if (!d || !d.activa) return null;
    var modo = _modoDe(c);
    if (modo !== 'lineal' && modo !== 'arreglo') return null;
    if (d.rango && ((d.rango.eje || _ejeDistDe(c)) === eje)) return d.rango;
    if (modo === 'arreglo' && d.rango2 && d.rango2.eje === eje) return d.rango2;
    return null;
  }
  // Distancia de la CARA a la punta del rango de ese lado (cm). El rango puede ir al
  // revés (to < from), así que el lado se toma por geometría —el menor contra la cara
  // 'min'— y no por el nombre del campo.
  function _puntaRangoACara(rango, eje, ref) {
    if (!rango || rango.from == null || rango.to == null) return null;
    var D = _dimEjeGeo(eje);
    if (!isFinite(D)) return null;
    var a = Number(rango.from), b = Number(rango.to);
    return (ref === 'max') ? (D / 2 - Math.max(a, b)) : (Math.min(a, b) + D / 2);
  }
  // …y escribirla. Escribe SIEMPRE en la punta de ESE lado (no siempre en `from`): en
  // un rango al revés, escribir en el campo del testero inicio movería la otra punta.
  // NO regenera —lo hace quien llama, como el resto de los campos—, pero sí re-ancla
  // (el número que escribió el usuario ES el ancla) y reencaja los tramos.
  function _setPuntaRangoACara(c, rango, eje, ref, cm) {
    var n = Number(cm);
    var D = _dimEjeGeo(eje);
    if (!rango || !isFinite(n) || !isFinite(D)) return false;
    var asc = (Number(rango.to) >= Number(rango.from));
    rango[(asc === (ref === 'max')) ? 'to' : 'from'] = (ref === 'max') ? (D / 2 - n) : (-D / 2 + n);
    _anclarRangoUI(rango, rango.eje || eje);
    var d = c && c.distribucion;
    if (d && rango === d.rango) _syncTramos(d);
    return true;
  }

  // Rango por defecto (toda la dimensión útil del EJE DE DISTRIBUCIÓN) para los modos
  // que lo necesitan. `eje` = 'x' (normal) | 'z' (pieza volteada) | 'y'.
  function _rangoDefault(sep, eje) {
    // Las líneas de recubrimiento salen del helper ÚNICO (_lineasRecubEje): acá
    // vivía una tabla propia que además fijaba 4 cm a lo largo pasara lo que pasara,
    // así que con un recub distinto de 4 el rango por defecto nacía en un sitio y el
    // imán del arrastre lo llevaba a otro.
    var r = _lineasRecubEje(eje === 'y' ? 'y' : (eje === 'z' ? 'z' : 'x'));
    // `eje` SIEMPRE declarado: sin él, el distribuidor cae a X y un rango de
    // cabezal (valores en Z, ±ancho/2) se interpretaba como X → 2 barras juntas.
    var rg = { from: r.lo, to: r.hi, sep: sep || 20, eje: (eje === 'y' || eje === 'z') ? eje : 'x' };
    return _anclarRangoUI(rg, rg.eje);   // nace anclado: el recub de cada borde ES su ancla
  }

  // ==========================================================================
  // TRAMOS DEL RANGO (reparto multi-@) — contrato del motor:
  //     cfg.rango.tramos = [{long, sep}, ...]
  // Largos y @ en cm, en orden desde rango.from hacia rango.to; su suma cubre el
  // rango completo. UN SOLO tramo = el comportamiento de siempre, y en ese caso NO se
  // escribe `tramos`: manda el @ simple (d.sep), que se mantiene como atajo del panel.
  // Los tramos SUBDIVIDEN el rango; el largo total lo siguen mandando sus handles.
  // ==========================================================================
  // LARGO de UNA línea de reparto = la distancia que recorre su abanico. Es la
  // cuenta que usan el rótulo de pantalla, el campo del panel y el editor inline:
  // UNA sola, porque el mismo número escrito dos veces se desincroniza a la primera.
  function _largoRango(r) {
    if (!r || r.from == null || r.to == null) return 0;
    return Math.abs(Number(r.to) - Number(r.from));
  }

  function _rangoLong(d) { return _largoRango(d && d.rango); }

  // cm para mostrar: al décimo (los mensajes de estado y los rótulos no llevan ruido).
  function _cm(v) { return Math.round(Number(v) * 10) / 10; }

  // CUÁNTAS barras salen de un largo con un @ — LA CUENTA ES DEL MOTOR
  // (reglas.redondeoCantidadZona = ceil(span/@)+1, espejo exacto de ArmaPilot).
  // Acá vivía un Math.round(span/@)+1 propio, y las dos cuentas sólo coinciden
  // cuando el largo es múltiplo del @: medido, 521 cm @20 decía 27 en el panel
  // mientras el motor repartía 28. Con el largo rotulado en pantalla al lado de la
  // celda de cantidad, esa divergencia pasó de invisible a evidente — así que la
  // regla se pide prestada en vez de reescribirla.
  function _cantidadDe(span, sep) {
    var R = global.ModeladorReglas;
    var d = Math.abs(Number(span) || 0), s = Number(sep) || 0;
    if (R && R.redondeoCantidadZona) return R.redondeoCantidadZona(d, s);
    return (s <= 0 || d <= 0) ? 1 : Math.ceil(d / s) + 1;
  }

  // Reencaja una lista de tramos en `total` recalculando por LÍMITES acumulados y
  // clampándolos: un rango que se achicó no deja tramos negativos ni suma sobrante, y
  // uno que creció se lo entrega al último. Devuelve una lista NUEVA (no muta).
  function _ajustarTramos(arr, total) {
    if (!arr || !arr.length) return [{ long: total, sep: 20 }];
    // EL SOBRANTE LO ABSORBE EL TRAMO DEL MEDIO, igual que al cambiar el hormigón
    // (18-ago). Antes esta función se lo daba al ÚLTIMO —el bucle de abajo cierra el
    // último en `total`—, así que arrastrar el handle del rango y agrandar el elemento
    // repartían distinto: el confinamiento del extremo lejano se quedaba flotando en
    // el vano. Es UNA sola regla y vive en el motor (reglas._tramosElasticos), no
    // duplicada acá: con nº par de tramos reparte entre los dos del medio.
    var R = global.ModeladorReglas;
    if (R && R.tramosElasticos) {
      var suma = 0;
      for (var s = 0; s < arr.length; s++) suma += Number(arr[s].long) || 0;
      arr = R.tramosElasticos(arr, total - suma, null);
    }
    var acc = 0, out = [];
    for (var i = 0; i < arr.length; i++) {
      var ini = Math.min(acc, total);
      var fin = (i === arr.length - 1) ? total : Math.min(acc + arr[i].long, total);
      out.push({ long: Math.max(0, fin - ini), sep: arr[i].sep });
      acc += arr[i].long;
    }
    return out;
  }

  // Tramos NORMALIZADOS al largo actual del rango. No escribe nada: es la lectura que
  // usan tanto el editor del panel como el dibujo de la flecha.
  function _tramosDe(d) {
    var total = _rangoLong(d);
    var sepBase = Math.max(SEP_MIN, Number(d && d.sep) || 20);
    var t = (d && d.rango && d.rango.tramos) || null;
    if (!t || !t.length) return [{ long: total, sep: sepBase }];
    return _ajustarTramos(t.map(function (x) {
      return { long: Math.max(0, Number(x && x.long) || 0), sep: Math.max(SEP_MIN, Number(x && x.sep) || sepBase) };
    }), total);
  }

  // Escribe los tramos. Con 1 solo tramo se BORRA `tramos` y se vuelve al shape simple
  // (d.sep) → el motor toma exactamente el camino de siempre.
  function _setTramos(d, arr) {
    d.rango = d.rango || {};
    if (!arr || arr.length <= 1) {
      var s = Math.max(SEP_MIN, (arr && arr[0] && Number(arr[0].sep)) || Number(d.sep) || 20);
      delete d.rango.tramos;
      d.sep = s; d.rango.sep = s;
      return;
    }
    d.rango.tramos = arr.map(function (x) {
      return { long: Math.round((Number(x.long) || 0) * 10) / 10, sep: Math.max(SEP_MIN, Number(x.sep) || 20) };
    });
    d.sep = d.rango.tramos[0].sep;      // el @ simple queda como espejo del 1er tramo
    d.rango.sep = d.sep;
  }

  // Los tramos con el sobrante YA ABSORBIDO POR EL DEL MEDIO, pero SIN el recorte
  // contra el fin del rango. Es _tramosDe partido en dos: la parte elástica (que es
  // reversible: el medio es un derivado, no un dato) y la parte de recorte (que NO
  // lo es). Sólo la primera se persiste — ver _syncTramos.
  function _tramosElasticosDe(d) {
    var total = _rangoLong(d);
    var sepBase = Math.max(SEP_MIN, Number(d && d.sep) || 20);
    var t = (d && d.rango && d.rango.tramos) || null;
    if (!t || !t.length) return [{ long: total, sep: sepBase }];
    var arr = t.map(function (x) {
      return { long: Math.max(0, Number(x && x.long) || 0), sep: Math.max(SEP_MIN, Number(x && x.sep) || sepBase) };
    });
    var R = global.ModeladorReglas;
    if (!(R && R.tramosElasticos)) return arr;
    var suma = 0;
    for (var i = 0; i < arr.length; i++) suma += arr[i].long;
    return R.tramosElasticos(arr, total - suma, null);
  }

  // El rango cambió de largo (handles, campos from/to) → el tramo del MEDIO lo sigue.
  // LO QUE NO SE ESCRIBE ES EL RECORTE (fix 20-ago). Antes esto guardaba el reparto
  // YA RESUELTO (_tramosDe, que además de estirar el medio CLAMPEA cada tramo contra
  // el fin del rango): los centímetros que el usuario DECLARÓ en los extremos —el
  // confinamiento— quedaban destruidos en cuanto el rango se achicaba de más, y al
  // reagrandar el elástico repartía sobre el destrozo. Medido: 100/320/100 → achicar
  // a 150 (persistía 100/0/50) → agrandar a 520 devolvía 100/370/50, con 50 cm de
  // confinamiento perdidos y sin una palabra.
  // Ahora el recorte vive DONDE NO ENSUCIA: en la lectura (_tramosDe, para el panel y
  // la flecha) y en el motor (posicionesRango clampea cada tramo contra `to` y sigue
  // dando el mismo reparto). La receta guarda lo declarado y el ida y vuelta cierra.
  // OJO: _setLongTramo, _addTramo y _delTramo SÍ escriben — eso es el usuario
  // editando un tramo, que es otra cosa que un rango que se achicó.
  function _syncTramos(d) {
    if (d && d.rango && d.rango.tramos && d.rango.tramos.length > 1) _setTramos(d, _tramosElasticosDe(d));
  }

  // Mueve el LÍMITE entre el tramo i y su vecino: el PAR conserva su largo total, así
  // que los demás tramos no se enteran. Es la misma operación para el campo "Largo i"
  // del panel y para el divisor arrastrable de la flecha.
  function _setLongTramo(d, i, nuevo) {
    var a = _tramosDe(d);
    if (!a[i]) return;
    var j = (i + 1 < a.length) ? i + 1 : i - 1;
    if (j < 0) return;                       // 1 solo tramo: su largo lo manda el rango
    var par = a[i].long + a[j].long;
    var v = Math.max(0, Math.min(par, Number(nuevo) || 0));
    a[i].long = v; a[j].long = par - v;
    _setTramos(d, a);
  }

  // Mueve el divisor k (límite entre el tramo k-1 y el k) a `off` cm desde rango.from.
  function _moverDivisor(d, k, off) {
    var a = _tramosDe(d);
    if (k < 1 || k >= a.length) return;
    var ini = 0;
    for (var i = 0; i < k - 1; i++) ini += a[i].long;
    _setLongTramo(d, k - 1, off - ini);
  }

  // LARGO DE LA LÍNEA DE REPARTO — lo escribe el rótulo de pantalla (19-ago) y es
  // exactamente lo mismo que teclear `to` = from ± largo en el panel.
  // SE MUEVE EL `to`, NO EL `from`: el `from` es «dónde va la PRIMERA barra» (lo que
  // el usuario ancló contra su borde) y moverlo desplazaría la distribución entera
  // en vez de estirarla.
  // Pasa por los MISMOS helpers que el arrastre —no hay una segunda cuenta acá—:
  //   · _anclarRangoUI  → el largo escrito ES la intención; sin re-anclar, cambiar
  //     el hormigón después dejaría la distribución congelada donde quedó.
  //   · _syncN          → la cantidad sigue al largo nuevo con el mismo @.
  //   · _syncTramos     → el sobrante lo absorbe el tramo del MEDIO (regla única).
  // Devuelve true si cambió algo; el llamador decide cuándo regenerar.
  function _setLargoRango(d, cual, cm, eje) {
    var r = d && d[cual];
    if (!r || r.from == null || r.to == null) return false;
    var v = Number(cm);
    if (!isFinite(v) || v < 0) return false;      // un abanico no recorre menos que 0
    // EL EJE LO DICE LA LÍNEA DIBUJADA, igual que el arrastre de handles (que hace
    // `if (rango.eje == null) rango.eje = eje`). Una receta vieja puede no traerlo, y
    // sin él _anclarRangoUI cae a 'x': el rango del ALTO se anclaría contra el LARGO.
    if (r.eje == null && eje) r.eje = eje;
    var sgn = (Number(r.to) >= Number(r.from)) ? 1 : -1;
    var nuevo = Number(r.from) + sgn * v;
    if (Math.abs(nuevo - Number(r.to)) < 1e-9) return false;
    r.to = nuevo;
    _anclarRangoUI(r, r.eje);
    _syncN(d, cual, true);
    if (cual === 'rango') _syncTramos(d);
    return true;
  }

  // "+ Tramo": parte el ÚLTIMO en dos mitades con el mismo @ (el rango no cambia).
  function _addTramo(d) {
    var a = _tramosDe(d);
    var last = a[a.length - 1];
    var mitad = last.long / 2;
    last.long = mitad;
    a.push({ long: mitad, sep: last.sep });
    _setTramos(d, a);
  }

  // "×": borra el tramo i y su largo se lo queda el vecino (el rango no cambia).
  function _delTramo(d, i) {
    var a = _tramosDe(d);
    if (a.length <= 1 || !a[i]) return;
    var j = (i > 0) ? i - 1 : 1;
    a[j].long += a[i].long;
    a.splice(i, 1);
    _setTramos(d, a);
  }

  // Eje de PROFUNDIDAD por defecto de las capas del arreglo = el eje "depth" del
  // plano de trabajo activo (si hay uno). Sin plano activo → 'z' (ancho de la viga:
  // la 2ª cortina entra hacia el núcleo). Coherente con PLANOS_POR_ELEMENTO.
  function _ejeCapasDefault() {
    var def = ST.planoActivo && (_defsPlanos() || {})[ST.planoActivo];
    return (def && def.depth) || 'z';
  }

  // Cambia el modo de uso del componente y REMODELA su distribucion a la forma que
  // ese modo necesita, CONSERVANDO lo compartido (rango, @sep, capas) para no
  // perder ajustes al alternar. NO borra campos ajenos (aditivo/idempotente).
  function _setModoComp(c, modo) {
    if (!MODO_A_DIST[modo]) return;
    c.modo = modo;
    var d = c.distribucion = c.distribucion || {};
    var rol = _rolComp(c);
    var ejeD = _ejeDistDe(c);   // X, o Z si la pieza está volteada
    d.modo = MODO_A_DIST[modo];
    if (modo === 'puntual') {
      if (d.n_capas == null) d.n_capas = 1;
      if (d.barras_capa == null) d.barras_capa = 1;
      if (d.gap == null) d.gap = 4;
      if (d.sentido == null) d.sentido = 'nucleo';
      if (d.justify == null) d.justify = 'centrar';
    } else if (modo === 'lineal') {
      if (d.sep == null) d.sep = _sepDefault(c.tipologia);
      if (!d.rango) d.rango = _rangoDefault(d.sep, ejeD);
      else if (d.rango.eje == null) d.rango.eje = ejeD;   // migrar rangos viejos sin eje
      d.activa = true;
      // el rango la distribuye: se va el hint Y su ancla (una intención de posición
      // sin hint que la sostenga es dato muerto que reaparecería al próximo arrastre).
      if (c.pos_hint) delete c.pos_hint[ejeD];
      if (c.pos_ancla) delete c.pos_ancla[ejeD];
    } else { // arreglo
      if (d.sep == null) d.sep = _sepDefault(c.tipologia);
      if (!d.rango) d.rango = _rangoDefault(d.sep, ejeD);
      else if (d.rango.eje == null) d.rango.eje = ejeD;
      // ARREGLO = DOS LÍNEAS DE DISTRIBUCIÓN (fix 15-ago). Antes esto estrenaba
      // las CAPAS legadas (n_capas/sep_capas/eje_capas) y el panel —que muestra
      // la forma vieja mientras existan— nunca llegaba a ofrecer la 2ª línea:
      // el usuario elegía «Arreglo» y "no pasaba nada", seguía viendo un rango.
      // Ahora el modo estrena `rango2`, que es lo que el motor prefiere; las
      // capas sólo sobreviven en recetas que YA venían con ellas.
      if (!d.rango2 && !(Number(d.n_capas) > 1)) d.rango2 = _rango2Default(c, d);
      d.activa = true;
      if (c.pos_hint) delete c.pos_hint[ejeD];
      if (c.pos_ancla) delete c.pos_ancla[ejeD];
    }
  }

  // CUÁNTAS BARRAS SALEN DE UN COMPONENTE — se cuentan los placements que el motor le
  // atribuyó (meta.ci lo estampa _etiquetarCi). Es la MISMA fuente que usa la ficha
  // flotante de la selección, a propósito: con dos conteos distintos la lista y el
  // señalizador podrían decir números diferentes de la misma barra.
  // Devuelve null si todavía no se generó nada (no hay número que dar, y 0 sería
  // mentira). NO recalcula ni re-expande la receta: sólo recorre lo ya calculado.
  function _nBarrasComp(ci) {
    var pls = (ST.ultimoOut && ST.ultimoOut.placements) || null;
    if (!pls || ci == null || ci < 0) return null;
    var n = 0;
    for (var i = 0; i < pls.length; i++) {
      var m = pls[i].meta;
      if (m && m.ci === ci) n++;
    }
    return n;
  }

  // Nombre corto legible del componente (para el panel).
  //
  // SIN LA CARA (18-ago, pedido del usuario: «los textos "lateral esp." y "lateral" no
  // me dan información y me ensucian»). La cara sigue estando donde sirve —la ficha
  // flotante de la selección y el control de Pose de la ficha del componente—; acá
  // sólo ocupaba el principio de todas las líneas.
  // Y "barras" pasó a "un" (unidades): es la misma cifra en un tercio del ancho.
  // OJO — EFECTO COLATERAL A LA VISTA: sin la cara, dos componentes que sólo se
  // diferencian en el ESPEJO quedan con la línea idéntica (el caso de las dos MH 104B
  // del reporte). El estado de espejo se marca ahora al lado del swatch de la cabecera
  // con un icono, no con texto (ver _compEl).
  function _compDesc(c, ci) {
    var d = c.distribucion || {};
    var modo = _modoDe(c);
    // CANTIDAD DE BARRAS (18-ago) — entre el espaciamiento y el ø, en la misma línea y
    // con la misma letra que el resto: es un dato más de la descripción, no una
    // insignia. Un 0 SÍ se muestra: si el componente no está generando nada (figura
    // fuera del catálogo, rango vacío) ese cero es exactamente lo que hay que ver.
    var nb = _nBarrasComp(ci);
    var nbTxt = (nb == null) ? '' : (nb + ' un · ');
    if (modo === 'arreglo') {
      return 'arreglo ' + (d.n_capas || 2) + '×@' + (d.sep || 20) + ' · ' + nbTxt + 'ø' + c.diam;
    }
    if (modo === 'puntual') {
      var nc = d.n_capas || 1;
      return nc + ' capa' + (nc > 1 ? 's' : '') + '×' + (d.barras_capa || 1) + ' · ' + nbTxt + 'ø' + c.diam;
    }
    // lineal
    return 'lineal @' + (d.sep || 20) + ' · ' + nbTxt + 'ø' + c.diam;
  }

  // ==========================================================================
  // 3D en vivo — reusa el motor del modelador (Three.js on-demand)
  // ==========================================================================
  function cargarThree() {
    return new Promise(function (resolve) {
      if (global.THREE) { resolve(true); return; }
      var s = document.querySelector('script[data-te-three]');
      if (s) {
        s.addEventListener('load', function () { resolve(!!global.THREE); }, { once: true });
        s.addEventListener('error', function () { resolve(false); }, { once: true });
        return;
      }
      s = document.createElement('script');
      s.src = THREE_CDN; s.dataset.teThree = '1';
      s.addEventListener('load', function () { resolve(!!global.THREE); }, { once: true });
      s.addEventListener('error', function () { resolve(false); }, { once: true });
      document.head.appendChild(s);
    });
  }

  function _hostDeReceta() {
    var geo = (ST.receta && ST.receta.geometria) || {};
    return {
      largo: Number(geo.largo), alto: Number(geo.alto), ancho: Number(geo.ancho),
      recub_sup: geo.recub_sup != null ? Number(geo.recub_sup) : 4,
      recub_inf: geo.recub_inf != null ? Number(geo.recub_inf) : 4,
      recub_lat: geo.recub_lat != null ? Number(geo.recub_lat) : 3
    };
  }

  // Etiqueta cada placement de out con meta.ci = índice del componente que lo
  // generó. generarViga concatena placements EN ORDEN de componentes, así que
  // re-expandimos por componente (barato) y estampamos ci por rango de índice.
  // Esto habilita el hit-testing 2D sin tocar generar.js.
  //
  // SE EXPANDE UN CLON, NO EL COMPONENTE (21-ago). Este host NO es el de la
  // generación real: `_hostDeReceta` no lleva las pilas por cara (jer_caras) que
  // generar.js arma, así que la pieza nace en otro sitio. Y expandir MUTA el
  // componente —estampa el ancla del pos_hint y re-deriva el hint contra la base
  // que vea—, o sea que este conteo le estaba reescribiendo la posición a la barra
  // con una base equivocada. MEDIDO en un cabezal de jerarquía 2 (detrás de un
  // estribo φ8) con pos_hint.y = −5: el hint quedaba en −5.8, los 0.8 de la pila
  // que este host no tiene, y al volver a agarrar la barra saltaba esos 0.8 cm.
  // El clon devuelve el mismo conteo sin tocar la receta (mismo criterio que
  // _iniciarDragMarco, que sondea con clones por la misma razón). Coste medido en
  // headless sobre la viga-semilla: 0.461 → 0.510 ms el etiquetado entero, contra
  // 1.06 ms que cuesta generarViga en ese mismo frame.
  function _etiquetarCi(out) {
    var d = _deps();
    if (!out || !out.placements || !d.reglas) return;
    var host = _hostDeReceta();
    var idx = 0;
    (ST.receta.componentes || []).forEach(function (comp, ci) {
      var n = d.reglas.expandirComponente(JSON.parse(JSON.stringify(comp)), host).length;
      for (var k = 0; k < n && idx < out.placements.length; k++, idx++) {
        out.placements[idx].meta = out.placements[idx].meta || {};
        out.placements[idx].meta.ci = ci;
      }
    });
  }

  // ==========================================================================
  // NORMALIZADOR DE APERTURA (reglas.normalizarReceta) — recetas VIEJAS
  // --------------------------------------------------------------------------
  // Un template guardado hace meses no tiene los campos que el motor de hoy lee
  // (dims {modo,valor}, distribucion.modo, pose…). El normalizador los DERIVA de
  // lo que la receta ya decía y publica la vista canónica en campos NO enumerables
  // (_dims/_dist/_pose/_jerarquia/_migracion): no reescribe la receta —el
  // Enfierrador guarda otro shape en la misma tabla y su lector no se toca— y por
  // eso tampoco ensucia el dirty-tracking (JSON.stringify no ve lo no enumerable).
  // Es idempotente: se puede llamar todas las veces que haga falta.
  // ==========================================================================
  function _normalizarRecetaViva() {
    var d = _deps();
    if (!ST.receta || !d.reglas || typeof d.reglas.normalizarReceta !== 'function') return;
    try { d.reglas.normalizarReceta(ST.receta); } catch (e) { /* nunca romper la apertura */ }
  }

  // Lo que el normalizador derivó/no pudo, de UN componente ({derivados, avisos,
  // figura_desconocida} | null). Se pregunta a reglas.js: el editor no mantiene su
  // propia copia del criterio.
  function _migracionDe(c) {
    var d = _deps();
    if (!d.reglas || typeof d.reglas.migracionDe !== 'function') return null;
    return d.reglas.migracionDe(c);
  }

  // Aviso de migración que está EN PANTALLA ahora mismo (o null). Se recuerda para
  // poder RETIRARLO: el aviso de apertura se calcula con el espejo estático del
  // catálogo, y el catálogo REAL llega después (fetch asíncrono). Si el real SÍ tiene
  // la figura, el aviso era falso y hay que sacarlo — pero sólo si sigue siendo el
  // texto visible: en cuanto el usuario hace algo, la barra de estado es suya y no se
  // le pisa.
  var _avisoMigVisible = null;

  function _statusDice(txt) {
    var s = $('te_ctoolsStatus');
    return !!(s && txt && String(s.textContent || '').indexOf(txt) >= 0);
  }

  // Lo que el normalizador NO pudo derivar (comp._migracion.avisos) resumido para
  // la barra de estado al abrir. Lo RUTINARIO (defaults aplicados) no se muestra:
  // es trazabilidad, no una alarma — ver la cabecera de reglas.js.
  // Se llama DOS veces: al abrir (con el espejo estático) y cuando llega el catálogo
  // real, que es el que manda. Por eso tiene que saber tanto poner el aviso como
  // quitarlo.
  function _avisarMigracion() {
    if (!ST.receta) return;
    var comps = ST.receta.componentes || [];
    var figs = [], nAvisos = 0;
    comps.forEach(function (c) {
      var m = _migracionDe(c);
      if (!m) return;
      if (m.figura_desconocida && figs.indexOf(c.figura) < 0) figs.push(c.figura || '(vacía)');
      nAvisos += (m.avisos || []).length;
    });
    if (!nAvisos) {
      // Ya no queda nada que avisar (típico: el catálogo real SÍ tenía la figura que
      // el espejo estático no conocía). Se retira el aviso propio y la barra vuelve a
      // su línea normal, en vez de dejar una alarma roja por algo que no pasa.
      if (_avisoMigVisible && _statusDice(_avisoMigVisible)) {
        _avisoMigVisible = null;
        _actualizarStatus();
      }
      _avisoMigVisible = null;
      return;
    }
    var msg = '';
    if (figs.length) {
      // Es el caso GRAVE: sin figura en el catálogo no se genera barra. Se nombran
      // las figuras para que el usuario sepa exactamente qué corregir.
      msg = 'Este template usa ' + (figs.length === 1 ? 'una figura que ya no está' : 'figuras que ya no están') +
        ' en el catálogo (' + figs.join(', ') + '): esas barras no se generan. ' +
        'Están marcadas en rojo en la lista de barras.';
    } else {
      msg = 'Al abrir quedaron ' + nAvisos + ' aviso(s) en las barras: selecciónalas para ver el motivo.';
    }
    _avisoMigVisible = msg;
    _actualizarStatus(msg);
  }

  // CONTEXTO DE GENERACION — el hueco que separaba al editor del Enfierrador era
  // esta sola linea: generarViga(receta, {}) generaba barras SIN ubicacion, asi que
  // nunca podian entrar a un lote (el backend exige sector/piso/ciclo/eje). Con
  // contexto de obra devuelve la ubicacion real; sin el, {} y todo queda como estaba.
  function _ctxGen() {
    var c = ST.ctxObra;
    if (!c) return {};
    return {
      sector: c.sector || null, ciclo: c.ciclo || null,
      piso: (ST.piso || '').trim() || null, eje: c.eje || null,
      nombre_plano: c.nombre_plano || null,
      template_instancia_id: (ST.instanciaId != null) ? ST.instanciaId : null,
      // Cada item sale con su IDENTIFICADOR DE ORIGEN (de que componente y de que
      // posicion de su distribucion nacio): es la llave con la que el backend cruza
      // esta generacion con la anterior y decide que actualizar, crear y borrar.
      trazarOrigen: true
    };
  }

  // UID ESTABLE POR COMPONENTE - la otra mitad del identificador de origen.
  // Se estampa EN LA RECETA para que VIAJE con ella: al reabrir la estructura el
  // componente sigue siendo el mismo aunque se reordenen o se agreguen otros (el
  // indice posicional no sirve para eso). Idempotente y auto-sanador: solo escribe
  // donde falta o donde quedo DUPLICADO - duplicar un componente clona su uid, y dos
  // componentes con el mismo uid volverian ambiguo el cruce.
  // En modo biblioteca NO se llama: la receta de un template no cambia ni un byte.
  function _estamparUids(receta) {
    var comps = (receta && receta.componentes) || [];
    var vistos = {};
    comps.forEach(function (c, i) {
      if (!c || typeof c !== 'object') return;
      var u = (c.uid != null) ? String(c.uid) : '';
      if (!u || vistos[u]) {
        u = 'u' + i + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
        c.uid = u;
      }
      vistos[u] = true;
    });
  }

  function _modoObra() { return !!(ST.ctxObra && ST.ctxObra.loteId); }

  function _regenerar() {
    var d = _deps();
    if (!d.gen || !ST.receta) return;
    // REANCLAR ANTES DE GENERAR — punto ÚNICO. Toda mutación de la receta termina
    // acá, así que este es el sitio donde las posiciones (rango.from/to, tramos,
    // pos_hint) se re-derivan de su ancla contra el hormigón de AHORA: cambiar el
    // largo de la viga mueve la distribución con él, y el panel muestra el mismo
    // número que el motor reparte. Estampa el ancla que falte a partir del from/to
    // que la receta ya traía, contra SU propia geometría → una receta vieja abierta
    // no se mueve ni un milímetro. Es idempotente (llamarla en cada regeneración no
    // acumula nada) y va ANTES del sello del dirty-tracking, que se toma tras la 1ª.
    if (d.reglas && typeof d.reglas.reanclarReceta === 'function') {
      try { d.reglas.reanclarReceta(ST.receta); } catch (e) { /* nunca romper el render */ }
    }
    // Va ANTES de generar y ANTES del sello del dirty-tracking (que se toma tras la 1a
    // regeneracion): asi el uid es parte del estado "recien abierto" y estampar no
    // aparece como un cambio del usuario.
    if (_modoObra()) _estamparUids(ST.receta);
    var out = d.gen.generarViga(ST.receta, _ctxGen());
    _etiquetarCi(out);
    ST.ultimoOut = out;
    // Items · barras · peso: van al CUADRO FLOTANTE sobre el 3D (te_3dstats). Estaban
    // en la última línea del footer, lejos de donde se mira; el footer ya no los
    // repite (un solo lugar para el mismo número).
    var si = $('te_stItems'), sb = $('te_stBarras'), sk = $('te_stKg');
    if (si) si.textContent = out.resumen.items;
    if (sb) sb.textContent = out.resumen.barras;
    if (sk) sk.textContent = _num(out.resumen.kg) + ' kg';
    _renderBarras();     // listado de barras (subtítulo siempre; tabla si está visible)
    _pintarFichaSel();   // ficha flotante de la barra seleccionada (la receta cambió)
    _refrescarDescComps();   // "· N barras ·" de cada fila del panel (depende de ESTE out)
    _refrescarPanelVivo();   // …y los campos que el arrastre está escribiendo (rango, tramos, Δ)
    _redibujar2D(out);
    // WARNING ANTI-COLAPSO: se evalúa SIEMPRE (aunque no haya WebGL) — el aviso es
    // sobre el tamaño del elemento, no sobre el 3D.
    _actualizarWarnTamano((out.placements || []).length);
    if (ST.threeCargado && ST.webglOk) _redibujar(out);
    _marcarSucio();
    // El botón de guardar refleja si HAY algo que guardar (con un template abierto
    // se apaga cuando no hay cambios). Cada regeneración es un cambio potencial, así
    // que el estado se recalcula aquí y no en veinte llamadores sueltos.
    _actualizarBtnGuardar();
    // Las medidas por lado de la ficha muestran lo que ACABA de salir del motor. Va
    // acá —en el punto único por el que pasa toda mutación— y no en cada llamador:
    // así ninguna forma de cambiar la barra puede dejar el número viejo en pantalla.
    _refrescarMedidasLados();
    // NO PERDER TRABAJO: autoguardado del borrador (throttled; no hace nada con el
    // modal cerrado). Va al final: se guarda lo que YA quedó regenerado/normalizado.
    _programarBorrador();
  }

  // Regeneración diferida (para arrastres a 60fps sin recomputar de más).
  function _regenerarDiferido() {
    if (ST._regenPendiente) return;
    ST._regenPendiente = true;
    global.requestAnimationFrame(function () { ST._regenPendiente = false; _regenerar(); });
  }

  // Mutación a ritmo de RUEDA (rótulos del abanico): regenerar Y repintar el panel en
  // CADA evento tranca la vista, así que se coalescen en UN rAF — y en ese orden, para
  // que el panel muestre lo que el motor ya resolvió (un tope contra el borde incluido)
  // y no el número crudo que se acaba de escribir.
  var _mutPend = false;
  function _mutDiferido() {
    if (_mutPend) return;
    _mutPend = true;
    global.requestAnimationFrame(function () { _mutPend = false; _regenerar(); _renderPanel(); });
  }

  function _num(n) { try { return Number(n).toLocaleString('es-CL'); } catch (e) { return '' + n; } }

  // ==========================================================================
  // UNDO (§INTERACCIÓN-2.0 tarea 4) — snapshots de la receta.
  //   _pushUndo()  → apila un clon de {receta, selCi} ANTES de mutar.
  //   _undo()      → restaura el último snapshot (receta + selección) y redibuja.
  // Se clona con JSON (la receta es data pura, sin refs vivas) para no compartir
  // objetos con el estado presente. Pila acotada a _undoMax.
  // ==========================================================================
  function _pushUndo() {
    if (!ST.receta) return;
    try {
      ST.undoStack.push({ receta: JSON.parse(JSON.stringify(ST.receta)), selCi: ST.selCi });
      // Los acompañantes NO viajan en el snapshot: son índices y la receta que se
      // restaura puede tener otra cantidad de componentes. Deshacer deja UNA barra
      // seleccionada, que es un estado siempre válido.
    } catch (e) { return; }
    if (ST.undoStack.length > ST._undoMax) ST.undoStack.shift();
  }

  function _undo() {
    if (!ST.undoStack.length) { _actualizarStatus('Nada que deshacer.'); return; }
    var snap = ST.undoStack.pop();
    ST.receta = snap.receta;
    ST.selCi = (snap.selCi != null) ? snap.selCi : -1;
    if (ST.selCi >= (ST.receta.componentes || []).length) ST.selCi = -1;
    ST.selExtra = [];
    // cualquier interacción a medio-hacer se cancela al deshacer
    ST.dragMove = null; ST.dragMarco = null; ST.dragRango = null;
    // EL ELEMENTO VIAJA EN LA RECETA (receta.tipo) desde que se puede cambiar dentro
    // del editor: deshacer un cambio de elemento tiene que devolver TAMBIÉN el
    // ribbon, el hormigón y las 3 vistas. Si no, la receta vuelve a viga y la
    // pantalla se queda en muro (chips, campos y cámaras del elemento equivocado).
    var tipoSnap = String(ST.receta.tipo || ST.elemento || 'viga').toLowerCase();
    if (tipoSnap !== String(ST.elemento || '').toLowerCase()) {
      ST.elemento = tipoSnap;
      _renderElemSel();
      _actualizarTitulos();
      _renderRibbonTips();
      _renderRibbonGeo();
      _refrescarDefsOrto();
      _actualizarTitulosVista();
    }
    // El ribbon de HORMIGÓN es la ÚNICA parte de la UI que guarda copia de la receta
    // (los inputs con las dims): si no se re-sincroniza, tras deshacer un cambio de
    // dims el input sigue mostrando el valor viejo y el siguiente blur lo RE-APLICA
    // (el cambio "vuelve" solo). Todo lo demás se repinta desde la receta.
    _sincronizarRibbonGeo();
    _regenerar();
    _renderPanel();
    _actualizarStatus('Deshecho.');
  }

  // ==========================================================================
  // BORRADOR AUTOMÁTICO (TANDA 3 · NO PERDER TRABAJO)
  // Tras cada regeneración (throttle ~2 s) se guarda en localStorage el estado de
  // trabajo {nombre, elemento, receta, ts}. Al ABRIR el editor, si hay borrador
  // reciente (< 48 h) y DISTINTO de lo que se va a abrir, se ofrece recuperarlo en
  // una barra discreta arriba del modal. Guardar con éxito lo borra.
  //   · La receta se serializa con JSON.stringify NORMAL: los avisos del motor
  //     (comp._avisos) son NO enumerables y por eso no viajan al borrador.
  //   · NUNCA se escribe con el modal cerrado (_modalAbierto() lo corta).
  //   · SÓLO se escribe si HAY CAMBIOS SIN GUARDAR: el borrador guarda trabajo que
  //     todavía no está en el servidor. Escribir el estado recién abierto (idéntico
  //     al guardado) no protege nada Y pisa el borrador de la sesión anterior —
  //     _regenerar() corre al abrir, así que la escritura llegaba milisegundos
  //     después de ofrecer "Recuperar" y el botón devolvía lo que ya estaba abierto
  //     (y abrir/cerrar un template limpio dejaba un borrador fantasma).
  //   · localStorage puede faltar o estar lleno (modo privado / quota): todo va en
  //     try/catch — el borrador es best-effort y jamás rompe el editor.
  // ==========================================================================
  var BORRADOR_KEY = 'te_borrador';
  var BORRADOR_TTL = 48 * 60 * 60 * 1000;   // 48 h — más viejo que eso se descarta
  var BORRADOR_MS = 2000;                   // throttle del autoguardado
  var _borrTimer = null, _borrUltimo = 0, _borrRecuperando = false;
  // Borrador que la barra está OFRECIENDO ahora mismo (copia en memoria). La clave
  // de localStorage es UNA sola y la comparte el autoguardado en vivo: si el usuario
  // deja la barra puesta y sigue editando, la clave pasa a ser su trabajo actual.
  // [Recuperar] debe entregar EXACTAMENTE lo que la barra prometió, no lo que quedó
  // en la clave — de ahí esta copia.
  var _borrOfrecido = null;

  function _modalAbierto() {
    var bd = $('te_backdrop');
    return !!(bd && bd.classList.contains('on'));
  }

  function _ls() {
    try { return global.localStorage || null; } catch (e) { return null; }
  }

  function _guardarBorradorAhora() {
    if (_borrTimer) { global.clearTimeout(_borrTimer); _borrTimer = null; }
    if (!ST.receta || !_modalAbierto()) return;
    // Nada que proteger = no se toca la clave (ver cabecera del bloque). Es el ÚNICO
    // escritor, así que la regla vale para el throttle, para el cierre del modal y
    // para el beforeunload por igual.
    if (!_hayCambiosSinGuardar()) return;
    var ls = _ls(); if (!ls) return;
    try {
      ls.setItem(BORRADOR_KEY, JSON.stringify({
        nombre: ST.nombre || '',
        elemento: ST.elemento || 'viga',
        templateId: (ST.templateId != null) ? ST.templateId : null,
        // Viajan con el borrador para que al recuperarlo el botón de guardar diga
        // la verdad: sin esto, un borrador de un template AJENO volvía diciendo
        // "Guardar cambios" y el PUT terminaba en 403.
        obra: (ST.obra != null) ? ST.obra : null,
        puedeModificar: (ST.puedeModificar !== false),
        receta: ST.receta,
        ts: Date.now()
      }));
      _borrUltimo = Date.now();
    } catch (e) { /* quota / modo privado: se sigue trabajando sin borrador */ }
  }

  // Throttle: como mucho una escritura cada BORRADOR_MS, pero SIEMPRE hay una final
  // (el timer pendiente escribe el último estado tras el arrastre).
  function _programarBorrador() {
    if (!ST.receta || !_modalAbierto()) return;
    if (!_hayCambiosSinGuardar()) return;   // ni siquiera se agenda (idem _guardarBorradorAhora)
    if (_borrTimer) return;
    var espera = Math.max(0, BORRADOR_MS - (Date.now() - _borrUltimo));
    _borrTimer = global.setTimeout(function () {
      _borrTimer = null;
      _guardarBorradorAhora();
    }, espera);
  }

  function _borrarBorrador() {
    if (_borrTimer) { global.clearTimeout(_borrTimer); _borrTimer = null; }
    var ls = _ls(); if (!ls) return;
    try { ls.removeItem(BORRADOR_KEY); } catch (e) { /* nada que hacer */ }
  }

  function _leerBorrador() {
    var ls = _ls(); if (!ls) return null;
    var raw;
    try { raw = ls.getItem(BORRADOR_KEY); } catch (e) { return null; }
    if (!raw) return null;
    var b;
    try { b = JSON.parse(raw); } catch (e) { _borrarBorrador(); return null; }
    if (!b || !b.receta || !b.ts) return null;
    if (!(Date.now() - Number(b.ts) < BORRADOR_TTL)) { _borrarBorrador(); return null; }
    return b;
  }

  function _haceTexto(ts) {
    var min = Math.floor((Date.now() - Number(ts)) / 60000);
    if (!isFinite(min) || min < 1) return 'hace menos de 1 min';
    if (min < 60) return 'hace ' + min + ' min';
    return 'hace ' + Math.floor(min / 60) + ' h';
  }

  function _ocultarBarraBorrador() {
    _borrOfrecido = null;                   // sin barra no hay oferta viva
    var bar = $('te_borrador'); if (bar) bar.classList.remove('on');
  }

  // Al ABRIR: ¿quedó un borrador reciente y DISTINTO de lo que se acaba de cargar?
  // Se compara contra ST._recetaGuardada, que ya está sellado DESPUÉS de la primera
  // regeneración (receta normalizada) — si no, cualquier apertura mostraría la barra.
  function _ofrecerBorrador() {
    _ocultarBarraBorrador();
    if (_borrRecuperando) return;                 // recuperar no se re-ofrece a sí mismo
    var b = _leerBorrador(); if (!b) return;
    var s;
    try { s = JSON.stringify(b.receta); } catch (e) { return; }
    if (s === ST._recetaGuardada) return;         // es lo mismo que ya está abierto
    var bar = $('te_borrador'); if (!bar) return;
    var txt = $('te_borradorTxt');
    if (txt) {
      txt.textContent = 'Hay un borrador sin guardar de "' + (b.nombre || 'sin nombre') +
        '" (' + _haceTexto(b.ts) + ')';
    }
    _borrOfrecido = b;                            // lo que la barra promete entregar
    bar.classList.add('on');
  }

  function _bindBorrador() {
    var ok = $('te_borradorOk'), no = $('te_borradorNo');
    if (ok && !ok._teBound) {
      ok._teBound = true;
      ok.addEventListener('click', function () {
        var b = _borrOfrecido || _leerBorrador();
        _ocultarBarraBorrador();
        if (!b) return;
        // Recuperar = cargarlo como receta activa por el MISMO camino que "Abrir".
        // La clave NO se borra: el autoguardado la reescribe con lo mismo y sigue
        // siendo la red de seguridad si vuelve a caerse el navegador.
        _borrRecuperando = true;
        try {
          global.templateEditorAbrir({
            elemento: b.elemento || ST.elemento || 'viga',
            nombre: b.nombre || '',
            dims: (b.receta && b.receta.geometria) || null,
            receta: b.receta,
            templateId: (b.templateId != null) ? b.templateId : null,
            obra: (b.obra != null) ? b.obra : null,
            // Borradores anteriores a este campo: se asume que sí (el backend
            // sigue siendo el que manda, y responde 403 con el motivo).
            puedeModificar: (b.puedeModificar !== false)
          });
        } finally { _borrRecuperando = false; }
        _actualizarStatus('Borrador recuperado.');
      });
    }
    if (no && !no._teBound) {
      no._teBound = true;
      no.addEventListener('click', function () {
        _borrarBorrador();
        _ocultarBarraBorrador();
        _actualizarStatus('Borrador descartado.');
      });
    }
  }

  function _initEscena() {
    var THREE = global.THREE;
    var cv = $('te_cv');
    if (!cv) return false;
    ST.scene = new THREE.Scene();
    ST.scene.background = new THREE.Color(_tema3D().bg);
    // El FOV sale de la constante porque el zoom-hacia-el-cursor necesita el MISMO
    // ángulo para saber cuánto mundo cabe en pantalla (si se desincronizan, el punto
    // bajo el cursor deja de quedar clavado).
    ST.camera = new THREE.PerspectiveCamera(FOV3D, 1, 1, 8000);
    try {
      ST.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
      ST.renderer.localClippingEnabled = true;   // habilita el plano de corte de las vistas orto
    } catch (e) { ST.webglOk = false; return false; }
    ST.world = new THREE.Group(); ST.scene.add(ST.world);
    ST.target = new THREE.Vector3(0, 0, 0);
    ST.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    var dir = new THREE.DirectionalLight(0xffffff, 0.7); dir.position.set(1, 1.4, 0.8); ST.scene.add(dir);
    var dir2 = new THREE.DirectionalLight(0xbcd4ff, 0.3); dir2.position.set(-1, -0.4, -0.7); ST.scene.add(dir2);
    var T0 = _tema3D();
    ST.grid = new THREE.GridHelper(1400, 28, T0.g1, T0.g2); ST.grid.position.y = -1; ST.scene.add(ST.grid);
    // Un material por tipología, desde COL2D (FUENTE ÚNICA de colores: 2D y 3D
    // leen la misma tabla — antes el 3D tenía sus 5 claves de viga duplicadas en
    // TEMA y toda tipología de MURO caía al gris del fallback).
    // METALNESS CERO — POR QUÉ (17-ago, "un rojo se ve café"): en el modelo PBR de
    // MeshStandardMaterial, `metalness` es la FRACCIÓN del color que deja de ser
    // difusa y pasa a ser reflejo especular teñido. Esta escena NO tiene envMap, así
    // que ese reflejo no encuentra nada que reflejar y se pinta NEGRO: con 0.5 la
    // mitad del color pintado se perdía y toda la paleta salía oscura y desaturada
    // (el usuario elige un color en la ficha y ve otro). El acero se sugiere con el
    // BRILLO (roughness), no comprando metalness que aquí no se puede pagar.
    // EMISSIVE DEL PROPIO COLOR (18-ago) — el metalness sólo era la mitad del
    // problema: aun con 0, el reparto físico de luces de three deja la barra en ~0.49
    // del hex (ver MAT_EMISSIVE). El emissive repone el resto SIN inventar una luz
    // nueva que también bañaría al hormigón y a las vistas orto, y deja intacto el
    // relieve (la parte difusa sigue variando por cara, así que la barra no se aplana).
    ST.materiales = {};
    Object.keys(COL2D).forEach(function (k) {
      ST.materiales[k] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(COL2D[k]), metalness: MAT_METALNESS, roughness: MAT_ROUGHNESS,
        emissive: new THREE.Color(COL2D[k]), emissiveIntensity: MAT_EMISSIVE });
    });
    // BUG 7: el hormigón es el VOLUMEN DE REFERENCIA y NO debe seguir la regla del
    // cuchillo (si lo recortan los clipping planes, en algunas vistas la cara
    // desaparece). clippingPlanes:[] hace que ESTE material ignore los planos de
    // corte globales del renderer → la caja de hormigón se ve SIEMPRE completa.
    ST.materiales.hormigon = new THREE.MeshStandardMaterial({ color: 0x9aa6b5, transparent: true, opacity: 0.14, roughness: 0.9, depthWrite: false, clippingPlanes: [] });
    // El 3D se orbita en el CUADRANTE 3D (la vista .d3), NO en el canvas te_cv: ese
    // canvas ahora cubre toda la grilla con pointer-events:none (para no tapar los
    // overlays de las vistas 2D), así que los eventos del 3D los captura su cuadrante.
    _bindOrbita(document.querySelector('#te_quad .te-vista.d3') || cv);
    _initVistasOrto();     // 3 cámaras ortográficas (secciones 2D) sobre la MISMA escena
    ST.webglOk = true;
    ST.ortoActivo = true;  // las vistas 2D pasan a render orto; el SVG queda overlay
    ST.dirty = true;       // PERF (render-on-demand): primer frame siempre se pinta
    _loop();
    return true;
  }

  // TEMA DE LOS 4 CUADRANTES (oscuro / medio / claro) — portado del Enfierrador.
  // SÓLO fondo y grilla. Allá el tema también reescribía el color de CBS/CBI/ES/…,
  // y eso acá sería pisar un dato del usuario: la tipología (o el color propio del
  // componente, c.color) define el color de la barra y viaja EN LA RECETA — cambiar
  // el fondo no puede repintarle las barras.
  // El fondo de la escena se aplica en los pases de render (uno solo compartido); acá
  // se cambian la GridHelper del 3D y la CLASE de #te_quad, que es de la que cuelgan
  // los colores del overlay SVG y de la grilla de las vistas 2D.
  function _aplicarTema3D(t) {
    var THREE = global.THREE;
    var T = TEMAS3D[t] || TEMAS3D.claro;
    ST.tema3d = TEMAS3D[t] ? t : 'claro';
    _marcarTemaEnQuad();
    // Los trazos del overlay 2D cuelgan del tema (variables --te-ov-*), pero además
    // la GRILLA de fondo de las 2D se emite en el propio SVG: hay que reemitirla.
    if (ST.ultimoOut) _redibujar2D(ST.ultimoOut);
    if (!THREE || !ST.scene) return;
    if (ST.grid) {
      ST.scene.remove(ST.grid);
      // La GridHelper vieja hay que soltarla A MANO: three no libera buffers de WebGL
      // por GC (misma razón que el dispose de _vaciarWorld).
      if (ST.grid.geometry && ST.grid.geometry.dispose) ST.grid.geometry.dispose();
      if (ST.grid.material && ST.grid.material.dispose) ST.grid.material.dispose();
    }
    ST.grid = new THREE.GridHelper(1400, 28, T.g1, T.g2);
    ST.grid.position.y = -1;
    ST.scene.add(ST.grid);
    _marcarSucio();
  }

  // Marca el tema vigente EN EL DOM, en DOS nodos:
  //   · #te_quad  — de su clase cuelgan las variables --te-ov-* (todo lo que dibuja
  //     el overlay SVG de las vistas 2D) y el color de su grilla de fondo;
  //   · #te_modal — de la suya cuelgan las --te-* del MARCO ENTERO: ribbon, panel de
  //     componentes, fichas, fila de herramientas y pie. Antes el radial sólo pintaba
  //     el cuadrante y el resto se quedaba blanco: contra el lienzo #14171c eso era
  //     un marco blanco alrededor de un agujero negro.
  // La clase va en el MODAL y no en <body> a propósito: así el tema no puede
  // escaparse al tab del Catálogo ni al resto de la plataforma.
  // Es lo que evita que oscurecer el fondo deje texto oscuro sobre oscuro. Se llama
  // también al abrir el modal, no sólo al tocar el radial.
  function _marcarTemaEnQuad() {
    var nodos = [$('te_quad'), $('te_modal')];
    ['oscuro', 'medio', 'claro'].forEach(function (k) {
      var on = (ST.tema3d === k);
      nodos.forEach(function (n) { if (n) n.classList.toggle('te-tema-' + k, on); });
    });
  }

  function _matDe(tip) {
    tip = (tip || '').toUpperCase();
    if (ST.materiales[tip]) return ST.materiales[tip];
    var rol = _rolDe(tip);
    if (rol === 'estribo') return ST.materiales.ES;
    if (rol === 'traba') return ST.materiales.TRV;
    return ST.materiales.LT;
  }

  // PERF (F0·iii) — vaciar ST.world LIBERANDO la GPU. `remove()` sólo desengancha el
  // objeto del grafo: la BufferGeometry sigue viva en memoria de video hasta que el GC
  // de JS la suelta (y three NO libera buffers de WebGL por GC). Regenerar decenas de
  // veces en una sesión acumulaba cientos de MB de geometrías huérfanas. Aquí se
  // dispose()a la GEOMETRÍA de cada descendiente; los MATERIALES son COMPARTIDOS
  // (ST.materiales) y se reutilizan → NO se disponen nunca (hacerlo dejaría el resto de
  // las barras sin material). Excepción: los materiales creados al vuelo del plano P3,
  // que se marcan con userData._propio.
  function _vaciarWorld() {
    // soltar YA las refs a meshes cuyas geometrías se van a disponer (si el loop
    // pintara entre medio, _clipLocalPorVista tocaría meshes muertos).
    ST.barras3D = [];
    if (!ST.world) return;
    while (ST.world.children.length) {
      var obj = ST.world.children[0];
      ST.world.remove(obj);
      _disposeArbol(obj);
    }
  }

  function _disposeArbol(obj) {
    if (!obj) return;
    function limpiar(n) {
      if (n.geometry && n.geometry.dispose) n.geometry.dispose();
      if (n.material && n.material.userData && n.material.userData._propio && n.material.dispose) {
        n.material.dispose();
      }
      // Los CLONES de material (clipping por vista B2 / selección resaltada) viven
      // en userData, no necesariamente asignados a .material → disponerlos aparte.
      var clip = n.userData && n.userData.matClip;
      if (clip && clip.dispose) { clip.dispose(); n.userData.matClip = null; }
      var msel = n.userData && n.userData.matSel;
      if (msel && msel.dispose) { msel.dispose(); n.userData.matSel = null; }
    }
    if (obj.traverse) obj.traverse(limpiar); else limpiar(obj);
  }

  // B2·(a) — SPAN de una barra por eje. Un longitudinal corre a lo largo de X → su
  // span en X es grande; un estribo vive en YZ → span X ≈ 0. Ese span es lo que
  // decide, por VISTA, si la barra es una "rebanada" (la corta el cuchillo) o si
  // CRUZA el corte de lado a lado (y entonces NO se debe clipear — ver
  // _clipLocalPorVista). Mismo criterio que _slicesEnProfundidad, calculado una sola
  // vez al construir la malla y guardado en mesh.userData.
  function _spanDePuntos(pts) {
    var s = { x: 0, y: 0, z: 0 };
    if (!pts || pts.length < 2) return s;
    var lo = { x: Infinity, y: Infinity, z: Infinity };
    var hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.x < lo.x) lo.x = p.x; if (p.x > hi.x) hi.x = p.x;
      if (p.y < lo.y) lo.y = p.y; if (p.y > hi.y) hi.y = p.y;
      if (p.z < lo.z) lo.z = p.z; if (p.z > hi.z) hi.z = p.z;
    }
    s.x = hi.x - lo.x; s.y = hi.y - lo.y; s.z = hi.z - lo.z;
    return s;
  }

  function _redibujar(out) {
    var THREE = global.THREE, geom = _deps().geom;
    if (!THREE || !ST.world || !geom) return;
    _vaciarWorld();   // PERF: libera geometrías de la GPU y vacía ST.barras3D
    var g = ST.receta.geometria;
    if (ST.verHormigon) {
      var box = new THREE.Mesh(new THREE.BoxGeometry(g.largo, g.alto, g.ancho), ST.materiales.hormigon);
      // BUG 7: los EDGES de la caja también deben ignorar el cuchillo (clippingPlanes:[])
      // para que el contorno del hormigón se vea completo en todas las vistas.
      var matEdges = new THREE.LineBasicMaterial({ color: 0x8a96a5, clippingPlanes: [] });
      matEdges.userData._propio = true;    // creado al vuelo → se dispone al vaciar
      var edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(g.largo, g.alto, g.ancho)), matEdges);
      ST.world.add(box); ST.world.add(edges);
    }
    (out.placements || []).forEach(function (pl) {
      var mat = _matDeComp(pl);   // color por barra: override de la receta o el de su tipología
      var mesh = geom.barraSolida(pl.puntos, pl.diam, mat, { segmentosRadiales: 10 });
      if (!mesh) return;
      // B2·(a): guardar el span por eje + el material COMPARTIDO original. El clipping
      // por vista se aplica clonando ese material sólo cuando hace falta.
      mesh.userData.span = _spanDePuntos(pl.puntos);
      mesh.userData.matBase = mat;
      mesh.userData.ci = (pl.meta && pl.meta.ci != null) ? pl.meta.ci : -1;
      // SECCIÓN LIMPIA: rol + eje por el que CORRE la barra, calculados UNA vez aquí
      // (no por frame). Los usa _clipLocalPorVista para esconder del render las
      // barras vistas DE PUNTA — el overlay ya las dibuja como círculo de sección.
      ST.barras3D.push(mesh);
      ST.world.add(mesh);
    });
    _resaltarSeleccion3D();    // marca de selección: la pieza activa va en SEL_COLOR
    // ENCUADRE INICIAL, NO EN CADA REDIBUJO (bug 17-ago: «roto el muro en el 3D y
    // al hacer clic me resetea la imagen»). Esta función corre en CADA regeneración
    // —colocar una barra, seleccionar, arrastrar un tirador—, así que reponer la
    // distancia acá devolvía la cámara al zoom por defecto y borraba el encuadre
    // que el usuario acababa de buscar. Ahora se encuadra sólo cuando cambia el
    // ELEMENTO (sus medidas): abrir otro template o editar el hormigón. Mientras el
    // elemento sea el mismo, la cámara es del usuario.
    var firmaEnc = [g.largo, g.alto, g.ancho].join('|');
    if (ST._encuadreFirma !== firmaEnc) {
      ST._encuadreFirma = firmaEnc;
      ST.dist = _distEncuadre(g.largo);   // mismo clamp que la rueda: uno solo
    }
    _redibujarPlanoActivo();   // P3 — re-agregar el resaltado tras vaciar el world
    ST.dirty = true;
  }

  // MARCA DE SELECCIÓN — COLOR DESIGNADO, ya no "aclarar" (18-ago).
  // Antes esto clonaba el material y le subía el emissive al 45% del PROPIO color. El
  // efecto secundario era el bug que reportó el usuario: como el material base estaba
  // apagado (ver MAT_EMISSIVE), esa subida era justo lo que hacía que el color se
  // viera BIEN, así que seleccionar "arreglaba" el color y soltar lo "oscurecía" —
  // el realce estaba haciendo de corrección de brillo y no de marca.
  // Ahora: el color correcto vive en el material base y la selección PINTA la pieza
  // del color designado SEL_COLOR (magenta, alto emissive) — se distingue a la
  // primera sobre los tres fondos y no se puede confundir con "está más clara".
  // Se materializa igual que el clipping: un CLON del material base, cacheado en el
  // mesh (userData.matSel). `matActivo` es lo que _clipLocalPorVista usa como base,
  // así la marca compone con el corte sin combinatoria de clones.
  function _resaltarSeleccion3D() {
    var THREE = global.THREE;
    if (!THREE) return;
    var barras = ST.barras3D || [];
    for (var i = 0; i < barras.length; i++) {
      var mesh = barras[i];
      var base = mesh.userData.matBase;
      if (!base) continue;
      var sel = _estaSeleccionado(mesh.userData.ci);
      if (sel) {
        var ms = mesh.userData.matSel;
        if (!ms || ms.userData._base !== base) {
          if (ms && ms.dispose) ms.dispose();
          ms = base.clone();
          ms.userData._propio = true;
          ms.userData._base = base;
          ms.color = new THREE.Color(SEL_COLOR);
          if (ms.emissive) { ms.emissive = new THREE.Color(SEL_COLOR); ms.emissiveIntensity = SEL_EMISSIVE; }
          mesh.userData.matSel = ms;
        }
        mesh.userData.matActivo = ms;
      } else {
        mesh.userData.matActivo = base;
      }
      // fuera de los pases orto el mesh luce el material activo directamente
      if (!mesh.material || !mesh.material.clippingPlanes || !mesh.material.clippingPlanes.length) {
        mesh.material = mesh.userData.matActivo;
      }
    }
    ST.dirty = true;
  }

  // ==========================================================================
  // WARNING ANTI-COLAPSO — aviso NO modal cuando el elemento se vuelve pesado.
  // >350 barras = amarillo ("puede degradarse"), >800 = rojo ("considera dividirlo").
  // NUNCA bloquea la operación. El usuario lo puede descartar con la ✕; si luego el
  // recuento SUBE de nivel (amarillo→rojo) o baja y vuelve a subir, se muestra otra
  // vez (el descarte se recuerda por NIVEL, no para siempre).
  // ==========================================================================
  var WARN_AMARILLO = 350, WARN_ROJO = 800;

  function _actualizarWarnTamano(n) {
    var el = $('te_bigwarn'), txt = $('te_bigwarnTxt');
    if (!el || !txt) return;
    var nivel = (n > WARN_ROJO) ? 'danger' : (n > WARN_AMARILLO ? 'warn' : null);
    if (!nivel) { ST.warnNivel = null; el.classList.remove('on', 'warn', 'danger'); return; }
    if (ST.warnNivel !== nivel) ST.warnDescartado = false;   // cambió de nivel → re-mostrar
    ST.warnNivel = nivel;
    txt.textContent = (nivel === 'danger')
      ? 'Elemento muy grande (' + n + ' barras): considera dividirlo.'
      : 'Elemento grande (' + n + ' barras): el rendimiento puede degradarse.';
    el.classList.remove('warn', 'danger');
    el.classList.add(nivel);
    el.classList.toggle('on', !ST.warnDescartado);
  }

  function _bindWarnTamano() {
    var x = $('te_bigwarnX');
    if (!x || x._teOk) return;
    x._teOk = true;
    x.addEventListener('click', function () {
      ST.warnDescartado = true;
      var el = $('te_bigwarn'); if (el) el.classList.remove('on');
    });
  }

  // ==========================================================================
  // P3 — RESALTADO DEL PLANO DE TRABAJO ACTIVO en el 3D (§DISCOVERY-INTER 8/E)
  //
  // Dibuja un Mesh de PlaneGeometry semitransparente (azul) del tamaño real de
  // la cara del elemento, orientado según el eje de PROFUNDIDAD (`depth`) del
  // plano:  depth x → rotar Y 90° · depth y → rotar X 90° · depth z → sin rotar.
  // (Una PlaneGeometry nace en XY con normal +Z: rotarla lleva la normal al eje
  //  de profundidad.) El plano se AGREGA/QUITA de ST.world en cada _redibujar
  //  (que vacía el world), por eso se re-invoca desde ahí. El `depth` y el tamaño
  //  salen de la MISMA tabla PLANOS_POR_ELEMENTO que las vistas 2D → coherencia
  //  total (no hay mapa duplicado). THREE se resuelve DENTRO (bug histórico).
  // ==========================================================================
  function _redibujarPlanoActivo() {
    var THREE = global.THREE;
    // Quitar el plano previo del world (idempotente aunque el world ya se vació).
    // PERF: además se dispone su geometría/material propios (se re-crean cada vez).
    if (ST.planoMesh) {
      if (ST.world && ST.planoMesh.parent === ST.world) ST.world.remove(ST.planoMesh);
      _disposeArbol(ST.planoMesh);
    }
    ST.planoMesh = null;
    ST.dirty = true;
    if (!THREE || !ST.world || !ST.planoActivo || !ST.receta) return;
    var def = (_defsPlanos() || {})[ST.planoActivo];
    if (!def || !def.depth) return;
    var g = ST.receta.geometria;
    var W = Number(g[def.W]), H = Number(g[def.H]);   // tamaño real de la cara (cm)
    if (!(W > 0) || !(H > 0)) return;

    // Plano visualizador (BUG 3): antes quedaba DENTRO/tapado por el elemento (over 1.25
    // apenas asomaba y el clip global lo comía). Ahora: (a) SOBRESALE claramente del
    // volumen (over 1.6) para que su marco se lea SIEMPRE por fuera del hormigón; (b) su
    // material lleva clippingPlanes:[] → NO lo recorta el cuchillo (si no, la banda lo
    // partía); (c) borde grueso y color más sólido. Es un indicador de "por dónde pasa el
    // corte", así que se ubica en o.cortePos (centro de la banda).
    var mat = new THREE.MeshBasicMaterial({
      color: 0x2f80ed, transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false, clippingPlanes: []
    });
    mat.userData._propio = true;   // PERF: material al vuelo → se dispone al vaciar el world
    var over = 1.6;   // 60% más grande que la cara del elemento → marco visible por fuera
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(W * over, H * over), mat);
    // borde del plano (marcado, sin recorte del cuchillo)
    var matEdge = new THREE.LineBasicMaterial({ color: 0x1565c0, clippingPlanes: [] });
    matEdge.userData._propio = true;
    var edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(W * over, H * over)), matEdge);
    mesh.add(edge);
    // Orientar según el eje de profundidad (normal del plano).
    if (def.depth === 'x')      mesh.rotation.y = Math.PI / 2;  // normal → X
    else if (def.depth === 'y') mesh.rotation.x = Math.PI / 2;  // normal → Y
    // depth === 'z' → sin rotar (normal ya es Z)
    mesh.renderOrder = 999;                 // dibujar al final (semitransparente)
    // El plano 3D se ubica en la POSICIÓN del cuchillo (o.cortePos) → muestra por dónde
    // está pasando el corte que se ve en la vista 2D.
    var o = ST.orto && ST.orto[ST.planoActivo];
    var pos = o && o.cortePos != null ? o.cortePos : 0.05;
    mesh.position[def.depth] = pos;
    ST.planoMesh = mesh;
    ST.world.add(mesh);
  }

  // Setear el plano de trabajo activo y resaltarlo (o quitarlo con null).
  // Toggle: volver a pedir el mismo plano lo apaga.
  function _setPlanoActivo(plano) {
    if (plano !== 'seccion' && plano !== 'largo' && plano !== 'planta') plano = null;
    ST.planoActivo = (ST.planoActivo === plano) ? null : plano;
    _sincronizarResaltado2D();
    _redibujarPlanoActivo();   // marca dirty
  }

  // Refleja el plano activo en las vistas 2D (borde azul del cuadrante).
  function _sincronizarResaltado2D() {
    Object.keys(SVG_ID).forEach(function (k) {
      var svg = $(SVG_ID[k]); if (!svg) return;
      var vista = svg.closest ? svg.closest('.te-vista') : svg.parentElement;
      if (vista) vista.classList.toggle('te-plano-on', ST.planoActivo === k);
    });
  }

  // ==========================================================================
  // Vistas 2D — proyectan los MISMOS placements que el 3D a cada plano y
  // habilitan la interacción encima (hit-testing por data-ci).
  //   SECCIÓN  = corte transversal  → plano Y-Z (u=z, v=y)
  //   A LO LARGO = elevación        → plano X-Y (u=x, v=y)
  //   PLANTA   = vista superior     → plano X-Z (u=x, v=z)
  // ==========================================================================
  // PALETA ÚNICA por tipología — TODOS los elementos, UNA tabla (feedback
  // 13-ago: había DOS paletas — esta y TPL_COLORES de los chips del ribbon — y
  // el muro quedó con los valores invertidos entre chip y barra). Los chips
  // (TPL_COLORES) son un ALIAS de esta misma tabla, ver su declaración.
  // Criterio: mismos tonos = mismo significado en todos los elementos
  // (principales azul/teal · estribos naranja · trabas púrpura · n-capas claro).
  var COL2D = {
    // VIGA
    CBS: '#1565c0', CBS2: '#42a5f5', CBSn: '#64b5f6',
    CBI: '#00897b', CBI2: '#26a69a', CBIn: '#4db6ac',
    ES: '#e65100', TRV: '#7b1fa2', LT: '#607d8b',
    // MURO
    MH: '#1565c0', MV: '#00897b', MA: '#3949ab', TR: '#7b1fa2',
    EC: '#e65100', TC: '#7b1fa2', CB: '#1565c0',
    // LOSA / FUNDACION
    Fi: '#1565c0', Fs: '#00897b', "F'i": '#42a5f5', "F's": '#26a69a',
    F: '#5e35b1', "F'": '#7e57c2', SP: '#607d8b', Rp: '#607d8b', TRL: '#7b1fa2',
    SPF: '#607d8b', TRF: '#7b1fa2',
    // COLUMNA
    CB2: '#42a5f5', CBn: '#64b5f6', TRC: '#7b1fa2', ESC: '#e65100'
  };
  var SVG_NS = 'http://www.w3.org/2000/svg';
  // Eje de rotación perpendicular al plano de cada vista (para rotar 90° "de frente").
  var EJE_ROT = { seccion: 'x', largo: 'z', planta: 'y' };
  var SVG_ID = { seccion: 'te_svgSeccion', largo: 'te_svgLargo', planta: 'te_svgPlanta' };

  // --------------------------------------------------------------------------
  // TABLA DE PLANOS DE TRABAJO POR TIPO DE ELEMENTO (P2).
  // Para cada elemento, define sus 3 planos 2D de forma DECLARATIVA. La "sección"
  // es un plano distinto en viga vs muro vs columna: agregar un elemento nuevo es
  // SOLO poblar esta tabla (no tocar el código de dibujo).
  //
  // Cada plano = { u, v, depth, W, H, recub } donde:
  //   u, v   : ejes del mundo 3D ('x'|'y'|'z') que forman el plano 2D (u=horiz, v=vert).
  //   depth  : eje perpendicular al plano (la profundidad que se colapsa al proyectar).
  //   W, H   : nombre de la dim del hormigón (en geometria) para el ancho/alto del rect.
  //   recub  : cómo se recorta el rect de recubrimiento en cada eje del plano:
  //              'lat'    → resta 2·recub_lat
  //              'supinf' → resta recub_sup + recub_inf
  // El proyector de cualquier plano es genérico: function(p){return {u:p[def.u], v:p[def.v]}}.
  //
  // VIGA — sistema de coords del host (cm, centrada en origen):
  //   X = largo (longitudinal) · Y = alto (sup+/inf-) · Z = ancho (lateral)
  //   sección   = corte transversal → plano Z-Y (mirando a lo largo de X)
  //   elevación = vista de lado     → plano X-Y (mirando a lo largo de Z)
  //   planta    = vista superior    → plano X-Z (mirando a lo largo de Y)
  //
  // NOTA: las CLAVES internas de plano se mantienen ('seccion'/'largo'/'planta')
  // para no cambiar el comportamiento visual actual ni el cableado de _redibujar2D.
  // MURO — MISMO sistema de coords del host que la viga (la geometría se guarda con
  // las claves canónicas: largo · alto · ancho=ESPESOR), así que los ejes de los 3
  // planos son idénticos; lo que cambia es QUÉ RECUBRIMIENTO recorta cada lado:
  //   recub_lat = recub de las CARAS del muro (las dos caras Z±, donde van las cortinas)
  //   recub_sup = recub_inf = recub de los BORDES (arriba/abajo y extremos del largo)
  //   elevación (clave 'largo')  = largo × alto     → bordes en las dos direcciones
  //   sección  (clave 'seccion') = espesor × alto   → caras en horizontal, bordes en vertical
  //   planta   (clave 'planta')  = largo × espesor  → bordes en horizontal, caras en vertical
  var PLANOS_POR_ELEMENTO = {
    viga: {
      seccion: { u: 'z', v: 'y', depth: 'x', W: 'ancho', H: 'alto',  recub: { W: 'lat', H: 'supinf' } },
      largo:   { u: 'x', v: 'y', depth: 'z', W: 'largo', H: 'alto',  recub: { W: 'lat', H: 'supinf' } },
      planta:  { u: 'x', v: 'z', depth: 'y', W: 'largo', H: 'ancho', recub: { W: 'lat', H: 'lat' } }
    },
    // MURO (corrección del usuario 12-ago): el CORTE HORIZONTAL (largo×espesor) es
    // EL plano de trabajo del muro — ahí viven las 2 cortinas y las trabas — y por
    // eso va al PRIMER cuadrante como SECCIÓN. El canto (espesor×alto) pasa al
    // tercer cuadrante como ELEVACIÓN·XZ (elevación lateral).
    muro: {
      seccion: { u: 'x', v: 'z', depth: 'y', W: 'largo', H: 'ancho', recub: { W: 'supinf', H: 'lat' } },
      largo:   { u: 'x', v: 'y', depth: 'z', W: 'largo', H: 'alto',  recub: { W: 'supinf', H: 'supinf' } },
      planta:  { u: 'z', v: 'y', depth: 'x', W: 'ancho', H: 'alto',  recub: { W: 'lat', H: 'supinf' } }
    }
    // columna: { seccion: {...}, largo: {...}, planta: {...} }    // TODO tanda 3
  };

  // Elemento activo (por ahora fijo 'viga'; muro/columna cambian solo esta clave).
  function _tipoElemento() {
    return (ST.receta && ST.receta.tipo) || ST.elemento || 'viga';
  }
  function _defsPlanos() {
    return PLANOS_POR_ELEMENTO[_tipoElemento()] || PLANOS_POR_ELEMENTO.viga;
  }

  // BUG 8 — TÍTULOS por EJE. El nombre semántico ('SECCIÓN'/'A LO LARGO'/'PLANTA') es
  // fijo por cuadrante PERO depende del ELEMENTO (en un muro la vista larga es la
  // ELEVACIÓN), y el EJE sale de PLANOS_POR_ELEMENTO (u,v del plano). Así el título
  // sigue al elemento sin tocar el HTML. Se llama al abrir y al cambiar de elemento.
  var _TITULO_POR_ELEMENTO = {
    viga: { seccion: 'SECCIÓN', largo: 'A LO LARGO', planta: 'PLANTA' },
    // muro: la "planta" ES la sección del muro (corte horizontal, cuadrante 1);
    // el canto es una segunda elevación (se distinguen por las letras de eje).
    muro: { seccion: 'SECCIÓN', largo: 'ELEVACIÓN',  planta: 'ELEVACIÓN' }
  };
  function _titulosSemanticos() {
    return _TITULO_POR_ELEMENTO[_tipoElemento()] || _TITULO_POR_ELEMENTO.viga;
  }

  // ==========================================================================
  // REETIQUETADO VISUAL DE EJES (solo DISPLAY — la geometría interna NO cambia)
  // --------------------------------------------------------------------------
  // El motor usa x=largo, y=alto (vertical), z=ancho. La convención de obra que
  // usa el usuario nombra los ejes al revés: Z es la VERTICAL, Y el largo y X el
  // ancho. Este mapa es la ÚNICA traducción interno→letra visible; nadie más
  // debe imprimir una letra de eje a mano.
  //   interno x (largo)   → 'Y'
  //   interno y (alto)    → 'Z'
  //   interno z (ancho)   → 'X'
  // El COLOR sigue a la LETRA VISIBLE (X rojo / Y verde / Z azul), no al eje
  // interno: la flecha del eje interno x se dibuja verde porque en pantalla
  // se llama 'Y'.
  var EJE_DISPLAY = { x: 'Y', y: 'Z', z: 'X' };
  var _COLOR_LETRA = { X: '#e53935', Y: '#43a047', Z: '#1e88e5' };
  // letra visible de un eje interno ('x'|'y'|'z')
  function _ejeLetra(e) { return EJE_DISPLAY[String(e || '').toLowerCase()] || String(e || '').toUpperCase(); }
  // color del eje interno = color de su letra visible
  function _ejeColor(e) { return _COLOR_LETRA[_ejeLetra(e)] || '#607d8b'; }
  // Rótulo del plano de una vista: letras visibles en el orden u (horizontal),
  // v (vertical) de la vista → SECCIÓN 'XZ', A LO LARGO 'YZ', PLANTA 'YX'.
  function _ejeRotulo(u, v) { return _ejeLetra(u) + _ejeLetra(v); }
  var _EJE_NOMBRE = { x: 'largo', y: 'alto', z: 'ancho' };

  function _actualizarTitulosVista() {
    var defs = _defsPlanos() || {};
    var TIT = _titulosSemanticos();
    ['seccion', 'largo', 'planta'].forEach(function (plano) {
      var def = defs[plano]; if (!def) return;
      var vista = document.querySelector('#te_quad .te-vista[data-plano="' + plano + '"]');
      if (!vista) return;
      var t = vista.querySelector('.te-vtitle');
      if (t) {
        var eje = _ejeRotulo(def.u, def.v);
        t.textContent = (TIT[plano] || plano.toUpperCase()) + ' · ' + eje;
      }
      // B4·(a) — GIZMO GRÁFICO de ejes (antes: 3 líneas de texto). Mini SVG con el
      // triad estándar de modelador. Las cámaras ortográficas NO rotan, así que este
      // gizmo es ESTÁTICO: se genera una vez por vista → cero costo por frame.
      var gz = vista.querySelector('.te-vgizmo');
      if (gz) {
        gz.innerHTML = _svgGizmoOrto(def);
        // el nombre semántico del eje queda en el tooltip (el dibujo lleva sólo la letra)
        gz.setAttribute('title',
          _ejeLetra(def.u) + ' = ' + _EJE_NOMBRE[def.u] + ' (horizontal) · ' +
          _ejeLetra(def.v) + ' = ' + _EJE_NOMBRE[def.v] + ' (vertical) · ' +
          _ejeLetra(def.depth) + ' = ' + _EJE_NOMBRE[def.depth] + ' (hacia ti)');
      }
    });
  }

  // Mini SVG (46×46) del triad de ejes de una vista ortográfica:
  //   · flecha HORIZONTAL con la letra del eje u (horizontal de la vista);
  //   · flecha VERTICAL con la letra del eje v;
  //   · símbolo ⊙ (círculo con punto = "sale hacia ti") con la letra del eje depth.
  // Colores por LETRA VISIBLE (X rojo / Y verde / Z azul). El origen del triad va en la
  // esquina inf-izq del recuadro (7,39); las flechas miden 26 px.
  // Gizmo MINIMAL (pedido del usuario): SOLO los 2 ejes del plano, u→derecha y
  // v→arriba, letra en cada punta, colores X/Y/Z estándar. Sin marcador de
  // profundidad (queda en el tooltip) y sin volteos.
  function _svgGizmoOrto(def) {
    var u = String(def.u || 'x'), v = String(def.v || 'y');
    var cu = _ejeColor(u), cv = _ejeColor(v);
    var ox = 9, oy = 37, L = 22;
    function flecha(x1, y1, x2, y2, color) {
      var dx = x2 - x1, dy = y2 - y1, m = Math.hypot(dx, dy) || 1;
      var ux = dx / m, uy = dy / m, px = -uy, py = ux, h = 4.5, w = 2.6;
      var bx = x2 - ux * h, by = y2 - uy * h;
      var pts = x2 + ',' + y2 + ' ' + (bx + px * w) + ',' + (by + py * w) + ' ' + (bx - px * w) + ',' + (by - py * w);
      return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + bx + '" y2="' + by + '" stroke="' + color +
             '" stroke-width="1.6" stroke-linecap="round"/>' +
             '<polygon points="' + pts + '" fill="' + color + '"/>';
    }
    return '<svg viewBox="0 0 46 46" aria-hidden="true" style="font:700 9px \'Segoe UI\',system-ui,sans-serif">' +
      // La caja va por CSS (.te-gzbox, en template_editor_modal.html): con el fill y
      // el stroke escritos acá el gizmo se quedaba BLANCO en cuanto el fondo de los
      // cuadrantes se oscurece. Las flechas y las letras siguen con su color por eje.
      '<rect x="0" y="0" width="46" height="46" rx="8" class="te-gzbox"/>' +
      flecha(ox, oy, ox + L, oy, cu) +
      '<text x="' + (ox + L + 3) + '" y="' + (oy + 3.5) + '" fill="' + cu + '">' + _ejeLetra(u) + '</text>' +
      flecha(ox, oy, ox, oy - L, cv) +
      '<text x="' + (ox - 2) + '" y="' + (oy - L - 4) + '" fill="' + cv + '">' + _ejeLetra(v) + '</text>' +
      '</svg>';
  }

  // Proyector genérico: dado el def de un plano → función punto3D → {u,v}.
  function _proyectorDe(def) {
    return function (p) { return { u: p[def.u], v: p[def.v] }; };
  }
  // (G3/B3 — 11-ago) El "proyector de canto" (_proyectorVolteado) fue ELIMINADO: el
  // volteo de la pieza dejó de ser un truco de proyección y es GEOMETRÍA REAL en el
  // motor (reglas.js: permutación de ejes contra un host permutado). Los puntos ya
  // llegan girados, así que TODAS las vistas usan el proyector normal del plano —
  // eso también mata el bbox inflado del overlay y el arrastre en el eje equivocado.

  // Eje del MUNDO a lo largo del cual REPARTE un componente. La autoridad es el
  // motor; se resuelve DENTRO de la función (nunca capturado a nivel de módulo —
  // regla dura 1).
  function _ejeDistDe(c) {
    // El eje sobre el que se REPARTE un CABEZAL sale ENTERO de su POSE, sin tablas
    // caso-a-caso: las capas se apilan hacia el núcleo por la NORMAL de la cara y la
    // barra corre por el RUMBO, así que el reparto de la capa sólo puede ir por el
    // TERCER eje (el que no es ninguno de esos dos).
    //   sup/inf (normal y) + rumbo x → reparte en z  (a lo ancho)
    //   lateral (normal z) + rumbo x → reparte en y  (en altura)
    //   extremo (normal x) + rumbo y → reparte en z
    // Es la MISMA tabla que salía antes de "base z|y + permutación de orientación"
    // (acostada = identidad · volteada = x↔z · de pie = x↔y), pero derivada del
    // modelo único en vez de escrita a mano — y por eso cubre 'extremo' gratis.
    // (15-ago) Acá vivía una copia de la regla —"si el rol de la tipología es
    // cabezal, reparte por el tercer eje"— que dejaba fuera a todo lo demás: una
    // 103C bajo TR pedía su rango sobre su propio eje y el motor colocaba 1 barra.
    // La regla es UNA y vive en el motor (reglas.ejeDistribucion, por topología).
    var reglas = global.ModeladorReglas;
    // Se le pasa el HORMIGÓN para que el motor MIDA el plano de la pieza en vez
    // de deducirlo del campo `rumbo` (ver la nota de ejeDistribucion).
    if (reglas && reglas.ejeDistribucion) return reglas.ejeDistribucion(c, ST.receta && ST.receta.geometria);
    return _permOrientacion(c).x;
  }

  // Proyector por clave de plano (usado por el hit-testing y el ghost de rango).
  function _proyDe(plano) {
    var def = (_defsPlanos() || {})[plano];
    return def ? _proyectorDe(def) : function (p) { return { u: p.x, v: p.y }; };
  }

  function _colDe(tip) {
    tip = (tip || '').toUpperCase();
    if (COL2D[tip]) return COL2D[tip];
    var rol = _rolDe(tip);
    if (rol === 'estribo') return COL2D.ES;
    if (rol === 'traba') return COL2D.TRV;
    return COL2D.LT;
  }

  // COLOR POR BARRA (tanda 14-ago). La tipología da el DEFAULT (COL2D) y el
  // componente puede pisarlo con c.color (#rrggbb), que viaja EN LA RECETA — el
  // template se ve igual donde se abra. Fuente única para 2D, 3D, swatch de la
  // lista y el picker de la ficha. Un valor ilegible se ignora (cae al default).
  function _hexCompValido(c) {
    var v = c && c.color;
    if (typeof v !== 'string') return null;
    v = v.trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(v) ? v : null;
  }
  function _colorComp(c) {
    return _hexCompValido(c) || _colDe(c && c.tipologia);
  }
  // ARCHIVADOR DE COLORES DEL TEMPLATE — los colores que YA están en uso en la receta
  // abierta, sin repetidos y en el orden de los componentes.
  // POR QUÉ: el selector de color es un picker cromático. Al elegir un color a mano
  // para una barra no queda forma de volver a acertarlo en otra — hay que recordar el
  // hex. Esto NO es un dato nuevo: se LEE de los componentes en cada repintado, así
  // que no se guarda nada en la receta y al abrir otro template la fila cambia sola.
  // Se toma el color EFECTIVO (_colorComp), que es el que el usuario ve en el swatch
  // y en el 3D; el de la tipología cuenta igual que el elegido a mano.
  function _coloresDeReceta() {
    var comps = (ST.receta && ST.receta.componentes) || [];
    var out = [];
    for (var i = 0; i < comps.length; i++) {
      var hex = String(_colorComp(comps[i]) || '').trim().toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(hex) && out.indexOf(hex) < 0) out.push(hex);
    }
    return out;
  }
  // Componente de un placement (por meta.ci) — para que 2D/3D resuelvan el color.
  function _compDePl(pl) {
    var ci = (pl && pl.meta && pl.meta.ci != null) ? pl.meta.ci : -1;
    var comps = (ST.receta && ST.receta.componentes) || [];
    return (ci >= 0 && comps[ci]) ? comps[ci] : null;
  }
  // Material 3D del placement: el compartido de su tipología, o —con override—
  // uno por color, cacheado por hex (mismos parámetros que los de COL2D; el
  // realce de selección y el clipping clonan de matBase, así que componen igual).
  function _matDeComp(pl) {
    var hex = _hexCompValido(_compDePl(pl));
    if (!hex) return _matDe(pl.tipologia);
    var THREE = global.THREE;
    ST.materialesColor = ST.materialesColor || {};
    if (!ST.materialesColor[hex]) {
      // MISMA receta que los de COL2D (incluida la emisión del propio color): si acá
      // faltara el emissive, la barra con color propio se vería apagada y la de
      // tipología no — el usuario compararía dos rojos distintos en la misma escena.
      ST.materialesColor[hex] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex), metalness: MAT_METALNESS, roughness: MAT_ROUGHNESS,
        emissive: new THREE.Color(hex), emissiveIntensity: MAT_EMISSIVE });
    }
    return ST.materialesColor[hex];
  }

  function _svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) el.setAttribute(k, attrs[k]);
    return el;
  }

  // Rectángulo de hormigón (+recubrimiento) para un plano dado, en unidades del
  // host (cm), centrado en el origen. GENÉRICO: lee la dim del hormigón (W/H) y
  // la regla de recorte del recubrimiento (recub.W/recub.H) de la tabla de planos
  // del elemento activo. Devuelve {W,H,iW,iH} en (u,v).
  function _rectPlano(g, plano) {
    var def = (_defsPlanos() || {})[plano];
    if (!def) return { W: 0, H: 0, iW: 0, iH: 0 };
    var rs = g.recub_sup != null ? Number(g.recub_sup) : 4;
    var ri = g.recub_inf != null ? Number(g.recub_inf) : 4;
    var rl = g.recub_lat != null ? Number(g.recub_lat) : 3;
    function recorte(regla) {
      if (regla === 'lat') return 2 * rl;
      if (regla === 'supinf') return rs + ri;
      return 0;
    }
    var W = Number(g[def.W]), H = Number(g[def.H]);
    return {
      W: W, H: H,
      iW: W - recorte(def.recub && def.recub.W),
      iH: H - recorte(def.recub && def.recub.H)
    };
  }

  // ÚNICO PUNTO DE ENTRADA del boundary del hormigón para una vista/plano.
  // (§DISCOVERY-INTERACCIÓN-2 P4: dejar el DATO abierto sin implementar polígono.)
  // HOY: si geo.contorno es null/ausente → devuelve el rectángulo de _rectPlano
  //   (comportamiento IDÉNTICO al actual). A FUTURO, cuando geo.contorno sea un
  //   polígono, ESTE es el único lugar donde derivar el boundary de ese polígono.
  function boundaryDeVista(geo, plano, def) {
    if (!geo) return null;
    // contorno definido (polígono) → NO implementado aún: cae al rect (aditivo).
    return _rectPlano(geo, plano);
  }

  // ¿El punto host (o su (u,v) en el plano) cae DENTRO del hormigón de esta vista?
  // Es la REJA del ghost/clamp (§INTERACCIÓN-2.0 tarea 3). Usa boundaryDeVista como
  // ÚNICA fuente del contorno: hoy el rect [-W/2,W/2]×[-H/2,H/2]; a futuro, cuando
  // boundaryDeVista devuelva un polígono, aquí se resolverá point-in-polygon.
  // `tol` cm de holgura (permite pegarse al borde). Devuelve boolean.
  function _dentroDelBoundary(plano, uv, tol) {
    if (!uv || !ST.receta) return false;
    var geo = ST.receta.geometria;
    var b = boundaryDeVista(geo, plano, (_defsPlanos() || {})[plano]);
    if (!b || !(b.W > 0) || !(b.H > 0)) return false;
    var t = (tol != null) ? tol : 0.5;
    return (uv.u >= -b.W / 2 - t && uv.u <= b.W / 2 + t &&
            uv.v >= -b.H / 2 - t && uv.v <= b.H / 2 + t);
  }

  // Pega un (u,v) al borde válido más cercano del hormigón de la vista (clamp).
  // Deja el punto SOBRE el contorno para que "pegarse al borde" coloque sin barras
  // al aire. Devuelve un nuevo {u,v}.
  function _clampAlBoundary(plano, uv) {
    var geo = ST.receta && ST.receta.geometria;
    var b = geo ? boundaryDeVista(geo, plano, (_defsPlanos() || {})[plano]) : null;
    if (!b || !(b.W > 0) || !(b.H > 0)) return uv;
    return {
      u: Math.max(-b.W / 2, Math.min(b.W / 2, uv.u)),
      v: Math.max(-b.H / 2, Math.min(b.H / 2, uv.v))
    };
  }

  // ==========================================================================
  // SNAP DE CARA (§INTERACCIÓN-2.0 · elegir la cara VIENDO) — reemplaza la
  // adivinación _caraDefault(host.y>=0). Cada vista muestra el rectángulo del
  // hormigón; sus 4 aristas son las CARAS. Mapeamos cada arista al eje del mundo
  // que representa → cara colocable: sup/inf = eje Y · lateral = eje Z ·
  // EXTREMO = eje X (los TESTEROS del elemento).
  //
  // TANDA P — las aristas del eje X ya NO devuelven null. Antes eran "no se ancla
  // ahí por ahora" y por eso los testeros del muro no se podían seleccionar: la
  // cara 'extremo' existe en el modelo de pose (con su lado ±) y el motor la
  // acepta, así que las 4 aristas de las 3 vistas son colocables.
  // ==========================================================================
  // eje del mundo + signo → cara colocable. El SIGNO lo lleva la propia cara en
  // sup/inf; en lateral/extremo lo lleva `lado` (lo resuelve _compDesdeClick con
  // el f.sign de la arista clicada).
  function _caraDeEje(eje, sign) {
    if (eje === 'y') return sign > 0 ? 'sup' : 'inf';
    if (eje === 'z') return 'lateral';
    return 'extremo';   // eje 'x' = testeros del elemento
  }

  // Las 4 aristas del rectángulo de hormigón de una vista, con su cara mapeada.
  // Devuelve [{edge, cara, axis, sign, orient:'h'|'v', pos, a, b}] en coords (u,v):
  //   orient 'h' (top/bottom) → línea horizontal en v=pos, de u=a a u=b.
  //   orient 'v' (left/right) → línea vertical  en u=pos, de v=a a v=b.
  function _facesDeVista(plano) {
    var def = (_defsPlanos() || {})[plano];
    var geo = ST.receta && ST.receta.geometria;
    if (!def || !geo) return [];
    var rect = boundaryDeVista(geo, plano, def);
    if (!rect || !(rect.W > 0) || !(rect.H > 0)) return [];
    var hw = rect.W / 2, hh = rect.H / 2;
    return [
      { edge: 'top',    cara: _caraDeEje(def.v, +1), axis: def.v, sign: +1, orient: 'h', pos: +hh, a: -hw, b: +hw },
      { edge: 'bottom', cara: _caraDeEje(def.v, -1), axis: def.v, sign: -1, orient: 'h', pos: -hh, a: -hw, b: +hw },
      { edge: 'right',  cara: _caraDeEje(def.u, +1), axis: def.u, sign: +1, orient: 'v', pos: +hw, a: -hh, b: +hh },
      { edge: 'left',   cara: _caraDeEje(def.u, -1), axis: def.u, sign: -1, orient: 'v', pos: -hw, a: -hh, b: +hh }
    ];
  }

  // Cara del hormigón MÁS CERCANA al cursor (uv en coords del plano), dentro de un
  // umbral en cm. null si ninguna cerca. Las CUATRO aristas son colocables desde la
  // TANDA P (las del eje x son la cara 'extremo'), así que ya no hay aristas que
  // saltarse.
  function _caraCercana(plano, uv) {
    if (!uv) return null;
    var faces = _facesDeVista(plano);
    var umbral = 9;   // cm — banda de captura de la cara (generosa, como el snap)
    var best = null, bestD = umbral;
    faces.forEach(function (f) {
      var d = (f.orient === 'h') ? Math.abs(uv.v - f.pos) : Math.abs(uv.u - f.pos);
      // exigir que el cursor esté DENTRO del tramo de la arista (con holgura).
      var along = (f.orient === 'h') ? uv.u : uv.v;
      if (along < f.a - 4 || along > f.b + 4) return;
      if (d < bestD) { bestD = d; best = f; }
    });
    return best;
  }

  // La cara más cercana al cursor SIN umbral: siempre devuelve una de las cuatro.
  // Es lo que quiere un gesto de «elegí una cara» —el usuario ya decidió que va a
  // elegir una; hacerle acertar una franja sólo agrega frustración—, al revés del
  // snap del colocador, donde la banda de captura existe justamente para poder NO
  // elegir ninguna.
  function _caraMasCercana(plano, uv) {
    if (!uv) return null;
    var faces = _facesDeVista(plano);
    var best = null, bestD = Infinity;
    faces.forEach(function (f) {
      var d = (f.orient === 'h') ? Math.abs(uv.v - f.pos) : Math.abs(uv.u - f.pos);
      if (d < bestD) { bestD = d; best = f; }
    });
    return best;
  }

  // ==========================================================================
  // GHOST (§INTERACCIÓN-2.0 tarea 1) — previsualización que SIGUE al cursor con la
  // forma REAL de la figura cargada, el COLOR de la tipología y un BADGE "CBS ø16".
  // Se dibuja en una capa <g> DEDICADA por SVG (te-ghost-layer), separada de las
  // barras, para poder refrescarla en cada mousemove SIN regenerar toda la escena.
  // Si el cursor sale del hormigón → ghost ROJO + cursor not-allowed + el clic NO
  // coloca (tarea 3, clamp). Usa boundaryDeVista/_dentroDelBoundary como reja.
  // ==========================================================================

  // ==========================================================================
  // TRANSFORM DEL OVERLAY (G7-alineación) — (u,v) del plano ↔ px del viewBox.
  //
  // El transform es AFÍN e ISÓTROPO:  X(u) = cu + ku·u   ·   Y(v) = cv + kv·v
  // (ku/kv llevan el SIGNO de la cámara: con un transform "siempre positivo" el
  // hit-testing quedaba espejado respecto del render. Hoy las 3 cámaras van con
  // u→derecha (ku>0) y v→arriba (kv<0, porque el eje Y del SVG baja), pero el signo
  // se sigue LEYENDO de la cámara: nadie lo hardcodea.)
  //   · En modo ORTO se DERIVA de la cámara ortográfica (que ya incluye zoom y pan)
  //     → proyección, hit-testing y ghost coinciden con lo que se ve (_transformDesdeCamara).
  //   · Sin 3D (fallback SVG plano) se deriva del bounding box, como antes.
  // `s` = |ku| (px por cm) para el código que sólo necesita la magnitud.
  // ==========================================================================
  function _mkTransform(cu, ku, cv, kv) {
    return { cu: cu, ku: ku, cv: cv, kv: kv, s: Math.abs(ku) || 1 };
  }

  // GRILLA DE FONDO DE LAS VISTAS 2D (18-ago, va con el selector de fondo).
  // El 3D siempre tuvo su GridHelper; las 2D no tenían NINGUNA referencia de escala,
  // y sobre un fondo oscuro un cuadrante sin barras queda liso.
  // El paso NO es fijo en cm: con un paso fijo la grilla se vuelve una mancha al
  // alejarse y desaparece al acercarse. Se elige el primero de la escala 1-2-5 cuya
  // separación EN PANTALLA llegue a GRID2D_MIN_PX, así que siempre se ven líneas
  // legibles y cada 5 va una más marcada (la "decena" de la escala elegida).
  var GRID2D_PASOS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
  var GRID2D_MIN_PX = 14;
  // Techo de líneas por cuadrante (verticales + horizontales juntas). Al tocarlo el
  // paso SUBE: la grilla nunca se apaga por ser muchas, porque una grilla que
  // desaparece al alejarse es justo el agujero que se vino a tapar.
  var GRID2D_MAX_LINEAS = 400;
  function _pasoGrilla2D(pxPorCm) {
    for (var i = 0; i < GRID2D_PASOS.length; i++) {
      if (GRID2D_PASOS[i] * pxPorCm >= GRID2D_MIN_PX) return GRID2D_PASOS[i];
    }
    return GRID2D_PASOS[GRID2D_PASOS.length - 1];
  }
  // Siguiente paso de la escala; agotada la tabla sigue por décadas. SIEMPRE devuelve
  // algo mayor: es lo que garantiza que el bucle del techo termine.
  function _subirPaso1_2_5(paso) {
    for (var i = 0; i < GRID2D_PASOS.length; i++) { if (GRID2D_PASOS[i] > paso) return GRID2D_PASOS[i]; }
    return paso * 10;
  }
  function _nLineasGrilla2D(ru, rv, paso) {
    return Math.max(0, Math.floor(ru.hi / paso) - Math.ceil(ru.lo / paso) + 1) +
           Math.max(0, Math.floor(rv.hi / paso) - Math.ceil(rv.lo / paso) + 1);
  }
  // EL VIEWBOX NO ES EL CUADRANTE. Los overlays llevan preserveAspectRatio="xMidYMid
  // meet" con un viewBox de proporción FIJA (360×300, 620×300, 620×260), así que el
  // viewBox entra centrado y sobran dos franjas —una a cada lado del eje que sobra—
  // que el render orto de abajo sí pinta. Recorrer de 0..VW/0..VH dibujaba la grilla
  // sólo sobre ese parche y dejaba las franjas en blanco: ése era el corte.
  // Acá se devuelve el rect del ELEMENTO en unidades del viewBox (en el eje que sobra
  // da x0<0 y x1>VW). Ese excedente SE VE: el root <svg> recorta en el borde del
  // ELEMENTO, no en el viewBox. Es la misma cuenta de letterbox que ya hace
  // _transformDesdeCamara con padX/padY, sólo que devuelta al revés.
  function _rectElementoEnViewBox(svg, VW, VH) {
    var r = (svg && svg.getBoundingClientRect) ? svg.getBoundingClientRect() : null;
    var esc = r ? Math.min(r.width / VW, r.height / VH) : 0;
    if (!(esc > 0)) return { x0: 0, y0: 0, x1: VW, y1: VH };   // sin medida todavía: el viewBox
    var w = r.width / esc, h = r.height / esc;
    return { x0: (VW - w) / 2, y0: (VH - h) / 2, x1: (VW + w) / 2, y1: (VH + h) / 2 };
  }
  // Emite la grilla como DOS <path> (fina y marcada) en vez de N <line>: son 2 nodos
  // por vista en lugar de ~90, y esto se re-emite en cada redibujo.
  function _dibujarGrilla2D(svg, t, VW, VH) {
    if (!svg || !t || !(t.s > 0) || !t.ku || !t.kv) return;
    var R = _rectElementoEnViewBox(svg, VW, VH);
    function rango(c, k, p0, p1) {
      var a = (p0 - c) / k, b = (p1 - c) / k;
      return { lo: Math.min(a, b), hi: Math.max(a, b) };
    }
    var ru = rango(t.cu, t.ku, R.x0, R.x1), rv = rango(t.cv, t.kv, R.y0, R.y1);
    var paso = _pasoGrilla2D(t.s);
    while (_nLineasGrilla2D(ru, rv, paso) > GRID2D_MAX_LINEAS) paso = _subirPaso1_2_5(paso);
    var x0 = R.x0.toFixed(1), x1 = R.x1.toFixed(1), y0 = R.y0.toFixed(1), y1 = R.y1.toFixed(1);
    var dFina = '', dMarcada = '';
    var i0 = Math.ceil(ru.lo / paso), i1 = Math.floor(ru.hi / paso);
    for (var i = i0; i <= i1; i++) {
      var x = _tX(t, i * paso).toFixed(1);
      var seg = 'M' + x + ',' + y0 + ' L' + x + ',' + y1 + ' ';
      if (i % 5 === 0) dMarcada += seg; else dFina += seg;
    }
    var j0 = Math.ceil(rv.lo / paso), j1 = Math.floor(rv.hi / paso);
    for (var j = j0; j <= j1; j++) {
      var y = _tY(t, j * paso).toFixed(1);
      var segH = 'M' + x0 + ',' + y + ' L' + x1 + ',' + y + ' ';
      if (j % 5 === 0) dMarcada += segH; else dFina += segH;
    }
    if (dFina) svg.appendChild(_svgEl('path', { 'class': 'te-grid2d', d: dFina }));
    if (dMarcada) svg.appendChild(_svgEl('path', { 'class': 'te-grid2d te-grid2d-m', d: dMarcada }));
  }
  function _tX(t, u) { return t.cu + t.ku * u; }
  function _tY(t, v) { return t.cv + t.kv * v; }

  // (u,v) del plano → pixel del viewBox (inverso de _pixelToUV). Requiere transform.
  function _uvToPixel(plano, u, v) {
    var t = ST.transforms[plano];
    if (!t) return null;
    return { px: _tX(t, u), py: _tY(t, v) };
  }

  // Capa <g> persistente para el ghost de un SVG (se crea una vez; siempre al final).
  function _ghostLayer(svg) {
    if (!svg) return null;
    var g = svg.querySelector('.te-ghost-layer');
    // pointer-events:none → el ghost es SOLO preview; nunca intercepta los clics de
    // las barras (data-hit) ni de los nodos que quedan debajo.
    if (!g) { g = _svgEl('g', { 'class': 'te-ghost-layer', style: 'pointer-events:none' }); svg.appendChild(g); }
    else if (g !== svg.lastChild) svg.appendChild(g);   // mantener al frente
    return g;
  }

  // Limpia el ghost de TODOS los cuadrantes (al salir de una vista / soltar carga).
  function _limpiarGhost() {
    ST.ghost = null;
    ST.caraHi = null;
    Object.keys(SVG_ID).forEach(function (k) {
      var svg = $(SVG_ID[k]); if (!svg) return;
      var g = svg.querySelector('.te-ghost-layer'); if (g) while (g.firstChild) g.removeChild(g.firstChild);
      var v = svg.closest ? svg.closest('.te-vista') : null;
      if (v) v.classList.remove('te-ghost-block');
    });
  }

  // ¿Hay algo cargado para colocar? (ribbon con figura+tipología y MODO COLOCACIÓN
  // activo). Es el gate del ghost y del clic-para-colocar.
  function _hayCargado() {
    return !!ST.cargado && ST.tool === 'colocar';
  }

  // Tolerancia (cm) con la que el ghost decide que dos puntos proyectados son EL
  // MISMO: la usa para saber si una polilínea CIERRA (vuelve a su origen). Es de
  // DIBUJO (sub-milimétrica a escala de obra).
  var GHOST_PT_TOL = 0.5;

  // ==========================================================================
  // EL LADO DOMINANTE, DENTRO DEL TRAZO DIBUJADO
  // ==========================================================================
  // Para poder DESTACAR en el preview el lado que va a correr a lo largo de la
  // pieza hay que saber qué pedazo de la polilínea es ese lado. No sirve suponer
  // que "el tramo i son los puntos i,i+1":
  //
  //   · un gancho de más de 90° se dibuja como ARCO MUESTREADO (~10° por punto,
  //     marcados con esArco), así que UN vértice de la figura puede ocupar 15
  //     puntos de la lista;
  //   · dos ganchos seguidos dejan sus arcos PEGADOS (una 103E: puntos 1..15 y
  //     16..30), o sea "un run de esArco = un vértice" tampoco alcanza: entre los
  //     dos runs está justo el CUERPO, que es el tramo que estamos buscando.
  //
  // El mapeo se deriva así: un vértice de la cadena es un punto suelto, o un grupo
  // de puntos de arco consecutivos Y PEGADOS. "Pegados" tiene una cota dura: la
  // cuerda de un muestreo de 10° sobre el radio del codo (R = 2.5·φ) mide
  // 0.17·R ≈ 0.44·φ, mientras que el tramo más corto que la figura puede traer es
  // la extensión de gancho normativa (6·φ). El corte va en 1.5·φ, entre medio.
  //
  // Y hay DOS REDES DE SEGURIDAD, porque destacar el lado equivocado es peor que
  // no destacar nada:
  //   1. sólo se intenta con las familias de dibujo donde el trazo ES la cadena de
  //      tramos de la figura (recta / cadena). El marco de estribo, el rombo y la
  //      traba tienen constructores propios — dibujan 4 lados para una figura de 3,
  //      o un gancho fijo que no está en los parciales — y ahí no hay mapeo;
  //   2. si al agrupar no salen EXACTAMENTE tramos+1 vértices, se devuelve null.
  // ==========================================================================
  // El MÓDULO figura_puntos (no "los puntos de una figura"): se resuelve en el
  // momento, como _cat()/_deps(), porque los scripts cargan en paralelo.
  function _figPuntos() { return global.ModeladorFiguraPuntos || null; }

  // Familias de dibujo en las que la polilínea es, punto por punto, la cadena de
  // tramos que declara la figura (ver figura_puntos.familiaDeDibujo).
  var GHOST_FAM_MAPEABLE = { recta: true, cadena: true };

  // FAMILIA DE DIBUJO REAL de un componente: 'recta'|'cabezal'|'cadena'|'estribo'|
  // 'rombo'|'traba' (o null si no se puede saber). Se pregunta con el rol EFECTIVO
  // (comp._rol, el que el motor estampó en la última pasada) y no con el que sugiere
  // la tipología: reglas.js manda a 'estribo' cualquier figura de marco o rombo
  // aunque el chip diga CBS, y esa barra se dibuja como contorno cerrado.
  function _familiaDibujo(c) {
    var fp = _figPuntos();
    if (!fp || !fp.familiaDeDibujo || !c || !c.figura) return null;
    return fp.familiaDeDibujo(c.figura, _rolComp(c) || null);
  }

  // ¿Esta barra se dibuja como CONTORNO CERRADO (marco de estribo / rombo)? El
  // marco manda la forma —se encuadra contra el recubrimiento— así que no hay
  // dirección de pata que elegir ni extremo libre que prolongar.
  function _esContornoCerrado(c) {
    var fam = _familiaDibujo(c);
    return fam === 'estribo' || fam === 'rombo';
  }

  function _dist3(a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) + (a.z - b.z) * (a.z - b.z));
  }

  // Cota de "puntos de arco PEGADOS", en múltiplos de φ. Ver la nota de arriba: la
  // cuerda de un muestreo de 10° sobre el codo (R = 2.5·φ) mide ≈0.44·φ y el tramo
  // más corto que una figura puede traer es la extensión de gancho normativa (6·φ).
  // El corte va en medio. Vivía suelto dentro de _tramoDominanteEnTrazo; se sacó
  // porque ahora lo usan también el mapeo de TODOS los tramos y el del marco.
  var _CUERDA_ARCO_PHI = 1.5;

  // VÉRTICES DE LA FIGURA dentro del trazo → [[i0,i1], …]: un punto suelto, o un
  // grupo de puntos de ARCO consecutivos y PEGADOS. null = sin φ no hay cota con
  // que agrupar (no se adivina) o no hay trazo.
  function _verticesDelTrazo(puntos, diamCm) {
    var maxCuerda = _CUERDA_ARCO_PHI * (Number(diamCm) || 0);
    if (!(maxCuerda > 0) || !puntos || puntos.length < 2) return null;
    var verts = [], i = 0;
    while (i < puntos.length) {
      if (!puntos[i] || !puntos[i].esArco) { verts.push([i, i]); i++; continue; }
      var j = i;
      while (j + 1 < puntos.length && puntos[j + 1].esArco &&
        _dist3(puntos[j], puntos[j + 1]) <= maxCuerda) j++;
      verts.push([i, j]); i = j + 1;
    }
    return verts;
  }

  // Trechos RECTOS entre vértices consecutivos → [{i0,i1,L}] (L en cm). El tramo va
  // del FINAL del vértice que lo abre al PRINCIPIO del que lo cierra: así cubre el
  // trecho recto y no se mete dentro de los codos.
  function _tramosRectos(puntos, verts) {
    var out = [], k, a, b;
    if (!puntos || !verts) return out;   // contrato: sin trazo no hay tramos (está exportada)
    for (k = 0; k + 1 < verts.length; k++) {
      a = verts[k][1]; b = verts[k + 1][0];
      out.push({ i0: a, i1: b, L: (b > a) ? _dist3(puntos[a], puntos[b]) : 0 });
    }
    return out;
  }

  // TODOS los lados de la figura, ubicados en el trazo → [{lado, i0, i1}] o null.
  // Es el mapeo del que _tramoDominanteEnTrazo saca UNO: las mismas dos redes de
  // seguridad (sólo familias donde el trazo ES la cadena de tramos de la figura, y
  // el conteo exacto de vértices) escritas una sola vez.
  function _tramosEnTrazo(figura, rol, puntos, diamCm) {
    var fp = _figPuntos();
    if (!fp || !fp.tramosDeFigura || !fp.familiaDeDibujo) return null;
    if (!GHOST_FAM_MAPEABLE[fp.familiaDeDibujo(figura, rol || null)]) return null;
    var tr = fp.tramosDeFigura(figura);
    if (!tr || !tr.tramos || !tr.tramos.length) return null;
    var verts = _verticesDelTrazo(puntos, diamCm);
    if (!verts || verts.length !== tr.tramos.length + 1) return null;
    var rectos = _tramosRectos(puntos, verts), out = [], i;
    for (i = 0; i < rectos.length; i++) {
      if (!(rectos[i].i1 > rectos[i].i0)) return null;
      out.push({
        lado: String((tr.tramos[i] && tr.tramos[i].lado) || '').toUpperCase(),
        i0: rectos[i].i0, i1: rectos[i].i1
      });
    }
    return out;
  }

  // Rango [i0, i1] de índices de `puntos` que ocupa el LADO DOMINANTE, o null si
  // el mapeo no se pudo derivar con certeza. `rol` es el rol EFECTIVO con el que
  // el motor dibujó la barra (comp._rol), no el que sugiere la tipología: la
  // topología de la figura puede mandar a un 106A al pipeline de sección aunque el
  // chip diga MH, y entonces la familia de dibujo es otra.
  function _tramoDominanteEnTrazo(figura, rol, puntos, diamCm, ladoDom) {
    if (!ladoDom) return null;
    var tt = _tramosEnTrazo(figura, rol, puntos, diamCm);
    if (!tt) return null;
    for (var i = 0; i < tt.length; i++) {
      if (tt[i].lado === ladoDom) return { i0: tt[i].i0, i1: tt[i].i1 };
    }
    return null;
  }

  // ==========================================================================
  // LOS 4 LADOS DEL MARCO CERRADO, UBICADOS EN EL TRAZO
  // ==========================================================================
  // El estribo NO pasa por _tramosEnTrazo: `_estriboPerimetral` tiene constructor
  // propio (con sus arcos de gancho sísmico calibrados) y su polilínea NO es la
  // cadena de tramos del catálogo — MEDIDO en una 104D φ8 de viga 600×30×60: SIETE
  // trechos rectos para 4 parciales (pata 7.5 · izq 49.2 · inf 23.2 · der 51.2 ·
  // sup 21.2 · cuerda que abre el 2º codo 0.34 · pata 7.5). Pero el marco SÍ es
  // reconocible sin adivinar:
  //
  //   1. sus 4 lados son los 4 trechos MÁS LARGOS y van SEGUIDOS (los otros tres
  //      son las dos patas del gancho y la cuerda del codo);
  //   2. los lados OPUESTOS miden lo mismo salvo lo que el codo se come, que es
  //      exactamente Rc = 2.5·φ (49.2 vs 51.2 y 21.2 vs 23.2: 2.0 cm con φ0.8, en
  //      los dos pares). Si esa cuenta no cierra, lo agrupado NO es un marco y se
  //      devuelve null: mejor sin rótulo que con uno inventado.
  //
  // QUÉ LETRA VA EN CADA LADO. `ladosMarcoOrdenados` da la cadena del catálogo
  // (104D → [A,B,C,D] · 106A → [B,C,D,E]) y `ejesMarcoSeccion` contra qué eje mide
  // cada una (u = ancho · v = alto), o sea las letras ALTERNAN igual que los lados
  // del dibujo. Lo único que falta es el DESFASE, y no se supone: se elige el que
  // menos se aleja de las dims REALES de esta barra (medido: 104D → desfase 1, con
  // 7.2 cm de error total contra 112 del desfase 0; 106A → desfase 0). Es una
  // comparación de LARGOS, así que vale con la pieza girada: la misma 104D con pose
  // de rumbo z (lados 591.2/49.2/589.2/51.2) elige el mismo desfase 1.
  //
  // AMBIGÜEDAD QUE QUEDA, dicha: el desfase 0 empata siempre con el 2 (y el 1 con el
  // 3) — es el intercambio A↔C / B↔D — y se queda el menor. En un contorno CERRADO
  // ese par es el PAR ESPEJO: los dos lados miden LO MISMO por construcción
  // (reglas.js replica el Δ en el par o la figura deja de cerrar), así que el
  // intercambio no cambia NINGÚN número mostrado, sólo cuál de las dos letras del
  // par cae arriba.
  function _ladosMarcoEnTrazo(figura, rol, puntos, diamCm, dims) {
    var fp = _figPuntos();
    if (!fp || !fp.familiaDeDibujo || !fp.ladosMarcoOrdenados) return null;
    if (fp.familiaDeDibujo(figura, rol || null) !== 'estribo') return null;
    var orden = fp.ladosMarcoOrdenados(figura, rol || null);
    if (!orden || orden.length !== 4) return null;
    var verts = _verticesDelTrazo(puntos, diamCm);
    if (!verts || verts.length < 5) return null;
    var tramos = _tramosRectos(puntos, verts);
    if (tramos.length < 4) return null;
    // (1) LOS 4 LADOS = LOS 4 TRECHOS SEGUIDOS QUE CIERRAN.
    // -----------------------------------------------------------------------
    // Acá decía "los 4 MÁS LARGOS, y seguidos" y estaba MAL (auditoría 19-ago). En
    // una sección angosta la PATA del gancho (6·φ, mínimo 7.5 cm) mide más que el
    // lado corto del marco, se colaba en el grupo —y el guard de "seguidos" pasaba
    // igual, porque la ventana corrida también es consecutiva—, así que el rótulo
    // quedaba escrito sobre la pata y un lado real del estribo se quedaba mudo.
    // MEDIDO: 104D φ6 en una viga 15×20 recub 3 → tramos
    // [7.50 · 11.90 · 8.40 · 13.40 · 6.90 · 0.25 · 7.50]; "los 4 más largos" elige
    // k=0 (se come la pata) en vez de k=1. Pasaba en el 7.8% de las combinaciones
    // realistas de estribo (φ6-16 con ancho 12-21 cm: pilarcitos, vigas angostas).
    //
    // El criterio correcto no es el LARGO, es la TOPOLOGÍA: un marco CIERRA, o sea
    // sus 4 vectores suman ~0. No exactamente 0 —los dos lados que tocan el gancho
    // están recortados en Rc— así que el marco bueno deja un residuo de Rc·√2
    // (3.54·φ). Se prueba cada ventana de 4 tramos seguidos y gana la que MENOS
    // abre. En el ejemplo de arriba: k=1 abre 2.121 y k=0 abre 7.475 — no hay
    // empate posible, y el criterio no depende de qué mida cada lado.
    var k = -1, abreMin = Infinity, kk, jj, s, pa, pb, ab;
    for (kk = 0; kk + 3 < tramos.length; kk++) {
      s = { x: 0, y: 0, z: 0 };
      for (jj = 0; jj < 4; jj++) {
        pa = puntos[tramos[kk + jj].i0]; pb = puntos[tramos[kk + jj].i1];
        s.x += pb.x - pa.x; s.y += pb.y - pa.y; s.z += pb.z - pa.z;
      }
      ab = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
      if (ab < abreMin) { abreMin = ab; k = kk; }
    }
    if (k < 0) return null;
    // …y la ganadora tiene que cerrar DE VERDAD: se admite el doble del residuo que
    // dejan los dos recortes del gancho. Si ninguna ventana cierra, esto no es un
    // marco y no se rotula (mejor sin cota que con una inventada).
    if (!(abreMin <= 2 * Math.SQRT2 * 2.5 * (Number(diamCm) || 0))) return null;
    var L = [tramos[k].L, tramos[k + 1].L, tramos[k + 2].L, tramos[k + 3].L];
    if (!(L[0] > 0) || !(L[1] > 0) || !(L[2] > 0) || !(L[3] > 0)) return null;
    // (2) lados opuestos = mismo largo salvo el codo (Rc = 2.5·φ); se deja un pelo
    // más de holgura (3·φ) para no rechazar por el muestreo del arco.
    var tolPar = 3 * (Number(diamCm) || 0);
    if (Math.abs(L[0] - L[2]) > tolPar || Math.abs(L[1] - L[3]) > tolPar) return null;
    // (3) desfase de la cadena: el que menos se aleja de las dims reales
    var mejor = 0, mejorErr = Infinity, off, j, err, v;
    for (off = 0; off < 4; off++) {
      err = 0;
      for (j = 0; j < 4; j++) {
        v = Number(dims && dims[orden[(j + off) % 4]]);
        if (!isFinite(v)) { err = Infinity; break; }
        err += Math.abs(L[j] - v);
      }
      if (err < mejorErr) { mejorErr = err; mejor = off; }
    }
    if (!isFinite(mejorErr)) return null;      // sin dims no hay con qué elegir
    var out = [];
    for (j = 0; j < 4; j++) {
      out.push({ lado: orden[(j + mejor) % 4], i0: tramos[k + j].i0, i1: tramos[k + j].i1 });
    }
    // PATAS DE GANCHO DECLARADAS (106x: A y F son parciales con su propia dim). El
    // trazo las pone justo ANTES del marco y al FINAL de la lista — medido en la
    // 106A: tramos 0 y 6 de 7, los dos de 7.5 = dims A = dims F. La 104D no las
    // declara (ganchosTerminales → null) y ahí no hay letra que poner.
    var gt = fp.ganchosTerminales ? fp.ganchosTerminales(figura, rol || null) : null;
    if (gt && gt.ini && k >= 1) out.push({ lado: gt.ini, i0: tramos[k - 1].i0, i1: tramos[k - 1].i1 });
    if (gt && gt.fin && tramos.length > k + 4) {
      out.push({ lado: gt.fin, i0: tramos[tramos.length - 1].i0, i1: tramos[tramos.length - 1].i1 });
    }
    return out;
  }

  // LADOS ROTULABLES de un placement → [{lado, valor, i0, i1}] o null.
  // El VALOR es `pl.dims[letra]`: la dim EFECTIVA con la que el motor generó ESTA
  // barra —los 'auto' ya resueltos contra el hormigón y los Δ ya sumados—, o sea la
  // medida que se va a CORTAR. No se mide sobre el trazo a propósito: el trecho
  // dibujado es más corto que la dim (la convención BVBS mide a VÉRTICE y el codo se
  // come el setback), así que rotular el largo dibujado sería mostrar un número que
  // no está en ningún despiece (103B φ16: cuerpo dibujado 587.2 · dim B = 591.2).
  function _ladosRotulables(pl, rol) {
    if (!pl || !pl.puntos || !pl.dims) return null;
    var d = Number(pl.diam) || 0;
    var t = _tramosEnTrazo(pl.figura, rol, pl.puntos, d) ||
            _ladosMarcoEnTrazo(pl.figura, rol, pl.puntos, d, pl.dims);
    if (!t) return null;
    var out = [], i, v;
    for (i = 0; i < t.length; i++) {
      v = Number(pl.dims[t[i].lado]);
      if (!isFinite(v) || !(v > 0)) continue;   // lado sin medida: no se inventa una
      out.push({ lado: t[i].lado, valor: v, i0: t[i].i0, i1: t[i].i1 });
    }
    return out.length ? out : null;
  }

  // BARRA REAL que va a nacer de este clic — el PLACEMENT del motor (o null).
  //
  // Es LA MISMA FUENTE que el trazador, no una imitación: se arma el componente
  // que crearía este clic (_compDesdeClick — literalmente el que va a nacer, sin
  // apagarle nada) y se le pide al MOTOR su expansión (reglas.expandirComponente,
  // el mismo camino por el que _etiquetarCi casa placements con componentes). Así
  // el ghost hereda GRATIS todo lo que el motor sepa dibujar: ganchos, patas,
  // codos, arcos y las figuras que la dibujabilidad AMPLIADA rescate (las que
  // traen geometria.tramos del diseñador). No hay una sola forma cableada acá que
  // pueda quedar vieja cuando el motor aprenda una figura nueva.
  //
  // De un componente que nace REPARTIDO (modo lineal) el motor devuelve N barras;
  // el ghost muestra UNA: la más cercana al cursor. No la primera del reparto, que
  // puede quedar en la otra punta de la pieza — el ghost debe estar donde el
  // usuario está mirando, y sigue siendo una barra REAL del resultado.
  //
  // null = no hay con qué (motor ausente, figura que el catálogo no acepta,
  // expansión vacía) → el llamador cae al ghost básico.
  function _ghostPlacement(plano, uv) {
    var d = _deps();
    if (!d.reglas || !d.reglas.expandirComponente || !ST.receta || !ST.cargado) return null;
    if (_figError(ST.cargado.figura)) return null;
    // `comp` se declara afuera del try (lo necesita el rol efectivo, abajo) pero se
    // CONSTRUYE adentro: armar el componente del clic también puede reventar, y esa
    // caída ya estaba cubierta — el ghost cae al esquema básico en vez de romperse.
    var pls, comp = null;
    try {
      comp = _compDesdeClick(plano, _clickHost(plano, uv), ST.cargado);
      pls = d.reglas.expandirComponente(comp, _hostDeReceta());
    } catch (e) { return null; }
    if (!pls || !pls.length) return null;
    var proy = _proyDe(plano), mejor = null, mejorD = Infinity;
    for (var i = 0; i < pls.length; i++) {
      var pp = pls[i] && pls[i].puntos;
      if (!pp || pp.length < 2) continue;
      var su = 0, sv = 0, n = 0;
      for (var k = 0; k < pp.length; k++) {
        var q = proy(pp[k]);
        if (!q || !isFinite(q.u) || !isFinite(q.v)) { n = 0; break; }
        su += q.u; sv += q.v; n++;
      }
      if (!n) continue;
      var du = su / n - uv.u, dv = sv / n - uv.v, dd = du * du + dv * dv;
      if (dd < mejorD) { mejorD = dd; mejor = pls[i]; }
    }
    // ROL EFECTIVO con el que el motor acaba de dibujar (lo escribe
    // _baseDeComponente en el componente). La tipología PROPONE el rol y la
    // topología de la figura manda, así que re-derivarlo acá podría leer una
    // familia de dibujo distinta de la que se dibujó — y con ella un mapeo de
    // tramos equivocado. El placement no lo trae, el componente sí.
    if (mejor) mejor._rolUI = (comp && comp._rol) || null;
    return mejor;
  }

  // FORMA del ghost para un plano → { tipo:'poly'|'rect'|'line'|'point', pts:[{u,v}],
  // cerrar:bool, dom:{i0,i1}|null, domLado:'B'|null } o null. Primero la barra REAL
  // (_ghostPlacement) proyectada al plano; si no hay, el esquema básico de siempre
  // (_ghostFormaBasica). `dom` = índices DENTRO de `pts` del lado dominante.
  function _ghostForma(plano, uv) {
    var pl = _ghostPlacement(plano, uv);
    if (!pl) return _ghostFormaBasica(plano, uv);
    var def = (_defsPlanos() || {})[plano];
    var proy = _proyDe(plano);
    var raw = pl.puntos;

    // BARRA VISTA DE PUNTA → círculo, no polilínea. Se reproduce EL CRITERIO Y EL
    // PUNTO REPRESENTATIVO EXACTOS de _dibujarVista2D (rol cabezal + eje mayor ==
    // profundidad del plano; punto = extremo del segmento que más corre en
    // profundidad, NO raw[0], que es la punta del gancho). Si el ghost usara su
    // propio criterio, en SECCIÓN pintaría la pata de 15 cm donde la barra colocada
    // dibuja un punto: el ghost volvería a mentir, por otro lado.
    if (def && _rolComp(pl) === 'cabezal' && _ejeMayorSpan(raw) === def.depth) {
      var q0 = proy(raw[0]), mejorDelta = -1;
      for (var si = 1; si < raw.length; si++) {
        var dd = Math.abs((raw[si][def.depth] || 0) - (raw[si - 1][def.depth] || 0));
        if (dd > mejorDelta) { mejorDelta = dd; q0 = proy(raw[si]); }
      }
      if (isFinite(q0.u) && isFinite(q0.v)) return { tipo: 'point', pts: [{ u: q0.u, v: q0.v }] };
    }

    // `src` guarda de qué punto del trazo 3D salió cada punto proyectado: la
    // proyección DESCARTA los no finitos, así que los índices de los dos arreglos
    // no coinciden y el rango del lado dominante hay que traducirlo.
    var pts = [], src = [];
    for (var i = 0; i < raw.length; i++) {
      var q = proy(raw[i]);
      if (isFinite(q.u) && isFinite(q.v)) { pts.push({ u: q.u, v: q.v }); src.push(i); }
    }
    if (pts.length < 2) return _ghostFormaBasica(plano, uv);
    // Una figura CERRADA (marco de estribo, o cualquier polilínea que vuelva a su
    // origen) no tiene extremos libres: se cierra el path y no se le ponen puntas.
    var a = pts[0], b = pts[pts.length - 1];
    // LADO DOMINANTE: la letra que resuelve el MOTOR para esta barra y su tramo
    // dentro del trazo. Cualquiera de los dos en null ⇒ no se destaca nada.
    var ladoDom = _ladoDomMotor(pl.figura, pl.dims);
    var rng = _tramoDominanteEnTrazo(pl.figura, pl._rolUI, raw, Number(pl.diam) || 0, ladoDom);
    var dom = null;
    if (rng) {
      var d0 = src.indexOf(rng.i0), d1 = src.indexOf(rng.i1);
      if (d0 >= 0 && d1 > d0) dom = { i0: d0, i1: d1 };
    }
    return {
      tipo: 'poly', pts: pts,
      cerrar: (Math.abs(a.u - b.u) < GHOST_PT_TOL && Math.abs(a.v - b.v) < GHOST_PT_TOL),
      dom: dom, domLado: dom ? ladoDom : null
    };
  }

  // FALLBACK — esquema geométrico del ghost cuando la barra REAL no se puede
  // calcular (motor no cargado todavía, o figura que el motor no dibuja). No es la
  // forma de la figura: es el RECINTO que va a ocupar (estribo = marco al
  // recubrimiento; cabezal = punto en sección / línea a lo largo). Ancla en (u,v)
  // del cursor los ejes libres; el resto sale del hormigón.
  function _ghostFormaBasica(plano, uv) {
    var geo = ST.receta && ST.receta.geometria; if (!geo) return null;
    var rol = _rolComp(ST.cargado);
    var b = boundaryDeVista(geo, plano, (_defsPlanos() || {})[plano]);
    if (!b) return null;
    var rect = _rectPlano(geo, plano);          // W/H exteriores + iW/iH útiles (recub)
    var iW = rect.iW > 0 ? rect.iW : rect.W, iH = rect.iH > 0 ? rect.iH : rect.H;

    if (rol === 'estribo') {
      // Estribo/traba: rectángulo AL RECUBRIMIENTO (con recub 0 el útil ya es el
      // borde, así que no hace falta ninguna variante). En SECCIÓN se ve el recinto
      // completo; en las vistas donde X es horizontal, un trazo vertical a la X del
      // cursor. (20-ago) Antes esto ramificaba por el check "tomar contorno": el
      // ghost dibujaba el recinto al borde y la barra colocada salía igual al
      // recubrimiento, porque nadie leía ese dato aguas abajo.
      if (plano === 'seccion') {
        var hw = iW / 2, hh = iH / 2;
        return { tipo: 'rect', pts: [{ u: -hw, v: hh }, { u: -hw, v: -hh }, { u: hw, v: -hh }, { u: hw, v: hh }], cerrar: true };
      }
      // largo/planta: el estribo es un trazo perpendicular al eje X (vertical), a la
      // X clicada. Su alto = recinto útil en V.
      var vh = iH / 2;
      return { tipo: 'line', pts: [{ u: uv.u, v: vh }, { u: uv.u, v: -vh }] };
    }

    // Cabezal longitudinal: en SECCIÓN es un PUNTO; a lo largo/planta una LÍNEA que
    // corre todo el largo útil, a la V (altura/ancho) del cursor.
    if (plano === 'seccion') return { tipo: 'point', pts: [{ u: uv.u, v: uv.v }] };
    var uw = iW / 2;   // largo útil (recub extremo)
    return { tipo: 'line', pts: [{ u: -uw, v: uv.v }, { u: uw, v: uv.v }] };
  }

  // Línea gruesa de color sobre la arista (cara) resaltada bajo el cursor. Se dibuja
  // en la MISMA capa del ghost (no destructiva, pointer-events:none) para que
  // conviva con el ghost y sobreviva a los redibujados igual que él.
  function _dibujarCaraHiEnCapa(layer, plano, f, color) {
    if (!f) return;
    var p1, p2;
    if (f.orient === 'h') { p1 = _uvToPixel(plano, f.a, f.pos); p2 = _uvToPixel(plano, f.b, f.pos); }
    else { p1 = _uvToPixel(plano, f.pos, f.a); p2 = _uvToPixel(plano, f.pos, f.b); }
    if (!p1 || !p2) return;
    layer.appendChild(_svgEl('line', {
      'class': 'te-face-hi', x1: p1.px.toFixed(1), y1: p1.py.toFixed(1),
      x2: p2.px.toFixed(1), y2: p2.py.toFixed(1), stroke: color
    }));
  }

  // Pega el (u,v) del cursor a la cara resaltada: mueve el eje LIBRE de la forma a la
  // posición exacta de la cara (§INTERACCIÓN-2.0 · "el ghost se pega a ella"). Para
  // una cara horizontal (sup/inf) se fija la V; para una vertical (lateral) se fija la U.
  function _snapUvACara(uv, f) {
    if (!f) return uv;
    if (f.orient === 'h') return { u: uv.u, v: f.pos };
    return { u: f.pos, v: uv.v };
  }

  // Dibuja el ghost en el cuadrante `plano`. `sp` = _svgPoint del mousemove.
  function _dibujarGhost(plano, svg, sp) {
    var layer = _ghostLayer(svg); if (!layer) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    // Última posición del ghost: ESPACIO (espejo) redibuja AQUÍ mismo, sin
    // esperar al próximo mousemove (antes el preview desaparecía hasta mover).
    ST._ghostUlt = { plano: plano, svg: svg, sp: sp };
    if (!_hayCargado()) { ST.ghost = null; ST.caraHi = null; return; }
    var uvRaw = _pixelToUV(plano, sp.px, sp.py);
    if (!uvRaw) { ST.ghost = null; ST.caraHi = null; return; }

    // SNAP DE CARA — al acercarse a una cara del hormigón, esa cara se RESALTA y el
    // ghost se PEGA a ella (el usuario ve a qué cara va antes de clicar). Solo con la
    // herramienta Colocar; con Rango el rango se define libre dentro del contorno.
    var f = (ST.tool === 'colocar') ? _caraCercana(plano, uvRaw) : null;
    // axis/sign viajan con la cara resaltada: son lo que _compDesdeClick necesita
    // para derivar el LADO (± de la cara) y el ESPEJO del borde clicado.
    ST.caraHi = f ? {
      plano: plano, cara: f.cara, edge: f.edge, orient: f.orient,
      axis: f.axis, sign: f.sign, pos: f.pos, a: f.a, b: f.b
    } : null;

    var dentro = _dentroDelBoundary(plano, uvRaw);
    // Fuera del hormigón: pegar la forma al borde válido (clamp) y pintar en rojo.
    var uv = dentro ? uvRaw : _clampAlBoundary(plano, uvRaw);
    // Si hay cara resaltada (y estamos dentro), pegar el eje libre a la cara.
    if (f && dentro) uv = _snapUvACara(uv, f);
    ST.ghost = { plano: plano, uv: uv, valido: dentro };

    var vista = svg.closest ? svg.closest('.te-vista') : null;
    if (vista) vista.classList.toggle('te-ghost-block', !dentro);

    // GHOST MAGENTA (14-ago): el color de la tipología se confundía con las
    // barras ya puestas y se veía tenue; el preview debe GRITAR dónde va a caer.
    // Rojo se mantiene para "fuera del hormigón".
    var color = dentro ? '#d500f9' : '#d32f2f';
    // resaltado de la cara (bajo el trazo del ghost).
    if (f && dentro) _dibujarCaraHiEnCapa(layer, plano, f, _colDe(ST.cargado.tipologia));
    // PIEZA CERRADA (deseable del usuario 14-ago): al colocar un estribo/marco,
    // la ayuda marca LOS CUATRO BORDES del hormigón de la vista — la pieza no se
    // ancla a UNA cara, abraza el contorno completo. Se lee de inmediato qué va
    // a pasar al clicar.
    if (dentro) (function () {
      var fpG = global.ModeladorFiguraPuntos;
      if (!fpG || !fpG.familiaDeDibujo) return;
      var famG = fpG.familiaDeDibujo(ST.cargado.figura, _rolComp(ST.cargado));
      if (famG !== 'estribo' && famG !== 'rombo') return;
      var geoG = ST.receta && ST.receta.geometria;
      var bG = geoG ? boundaryDeVista(geoG, plano, (_defsPlanos() || {})[plano]) : null;
      if (!bG || !(bG.W > 0) || !(bG.H > 0)) return;
      var esq = [
        { u: -bG.W / 2, v: -bG.H / 2 }, { u: bG.W / 2, v: -bG.H / 2 },
        { u: bG.W / 2, v: bG.H / 2 }, { u: -bG.W / 2, v: bG.H / 2 }
      ];
      var dR = esq.map(function (q, i) {
        var p = _uvToPixel(plano, q.u, q.v);
        return (i ? 'L' : 'M') + p.px.toFixed(1) + ',' + p.py.toFixed(1);
      }).join(' ') + ' Z';
      layer.appendChild(_svgEl('path', {
        d: dR, fill: 'none', stroke: _colDe(ST.cargado.tipologia),
        'stroke-width': '2.5', 'stroke-dasharray': '7 4', opacity: '0.55'
      }));
    })();
    var forma = _ghostForma(plano, uv);
    if (!forma) return;

    // Trazar la forma en pixeles.
    if (forma.tipo === 'point') {
      var pp = _uvToPixel(plano, forma.pts[0].u, forma.pts[0].v); if (!pp) return;
      layer.appendChild(_svgEl('circle', { cx: pp.px.toFixed(1), cy: pp.py.toFixed(1), r: 3.4, fill: color, 'class': 'te-ghostpt', opacity: dentro ? 0.85 : 0.9 }));
    } else {
      var d = forma.pts.map(function (q, i) { var p = _uvToPixel(plano, q.u, q.v); return (i ? 'L' : 'M') + p.px.toFixed(1) + ',' + p.py.toFixed(1); }).join(' ');
      if (forma.cerrar) d += ' Z';
      // Con lado dominante identificado el trazo entero va ATENUADO y el tramo
      // dominante se repinta encima, grueso y opaco: así se lee de un vistazo cuál
      // es el lado que va a correr a lo largo de la pieza ANTES de clicar.
      layer.appendChild(_svgEl('path', {
        // El ghost YA NO se atenúa cuando hay dominante (feedback 14-ago: "la
        // verde es muy poco notoria"): el marcador corto señala solo.
        'class': 'te-ghostbar', d: d, stroke: color
      }));
      if (forma.dom) _dibujarGhostDominante(layer, plano, forma, color);
      // Puntas en los extremos (circulitos .te-gpt, como la maqueta). Marca los
      // EXTREMOS LIBRES de la barra: una forma CERRADA (marco de estribo, o una
      // polilínea real que vuelve a su origen) no tiene extremos que marcar.
      var ends = (!forma.cerrar && forma.pts.length > 1)
        ? [forma.pts[0], forma.pts[forma.pts.length - 1]] : [];
      ends.forEach(function (q) { var p = _uvToPixel(plano, q.u, q.v); layer.appendChild(_svgEl('circle', { cx: p.px.toFixed(1), cy: p.py.toFixed(1), r: 3, 'class': 'te-gpt', fill: color })); });
    }

    // BADGE de texto "CBS ø16" pegado al cursor (fondo + texto), desplazado para no
    // quedar bajo el puntero. Cuando hay tramo destacado el badge NOMBRA el lado
    // ("· lado B"): el trazo grueso dice dónde, el badge dice cuál — sin eso el
    // resaltado es una raya gruesa sin nombre.
    _dibujarGhostBadge(layer, sp.px, sp.py,
      ST.cargado.tipologia + ' ø' + ST.cargado.diam +
      (forma.domLado ? ' · lado ' + forma.domLado : ''),
      color, sp.VW, sp.VH, dentro);
  }

  // Repinta el TRAMO DOMINANTE encima del trazo atenuado. Nunca inventa puntos:
  // recorre el mismo `forma.pts` entre los índices que derivó _tramoDominanteEnTrazo.
  function _dibujarGhostDominante(layer, plano, forma, color) {
    // MARCADOR CORTO (feedback 14-ago): repintar el tramo dominante ENTERO
    // tapaba el ghost ("las líneas azules tapan la verde"). Señalar cuál lado
    // corre no necesita más que un guion grueso y breve CENTRADO en ese tramo:
    // se toma la polilínea del dominante, se mide en píxeles y se dibuja sólo
    // el 25% central (acotado entre 16 y 44 px).
    var pts = [], i, p, L = 0;
    for (i = forma.dom.i0; i <= forma.dom.i1 && i < forma.pts.length; i++) {
      p = _uvToPixel(plano, forma.pts[i].u, forma.pts[i].v);
      if (!p) return;
      if (pts.length) L += Math.hypot(p.px - pts[pts.length - 1].px, p.py - pts[pts.length - 1].py);
      pts.push(p);
    }
    if (pts.length < 2 || !(L > 4)) return;
    var largoMarca = Math.max(16, Math.min(44, L * 0.25));
    var ini = (L - largoMarca) / 2, fin = ini + largoMarca;
    var d = '', acc = 0;
    for (i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var seg = Math.hypot(b.px - a.px, b.py - a.py);
      if (!(seg > 0)) continue;
      var s0 = Math.max(ini, acc), s1 = Math.min(fin, acc + seg);
      if (s1 > s0) {
        var t0 = (s0 - acc) / seg, t1 = (s1 - acc) / seg;
        var x0 = a.px + (b.px - a.px) * t0, y0 = a.py + (b.py - a.py) * t0;
        var x1 = a.px + (b.px - a.px) * t1, y1 = a.py + (b.py - a.py) * t1;
        d += (d ? ' M' : 'M') + x0.toFixed(1) + ',' + y0.toFixed(1) + ' L' + x1.toFixed(1) + ',' + y1.toFixed(1);
      }
      acc += seg;
      if (acc > fin) break;
    }
    if (d) layer.appendChild(_svgEl('path', { 'class': 'te-ghostdom', d: d, stroke: color }));
  }

  // Badge flotante junto al cursor. Se ancla arriba-derecha del puntero y se voltea
  // si se saldría del viewBox.
  function _dibujarGhostBadge(layer, px, py, texto, color, VW, VH, dentro) {
    var padX = 5, h = 15, chW = 6.1;
    var w = padX * 2 + texto.length * chW;
    var bx = px + 12, by = py - h - 8;
    if (bx + w > VW - 2) bx = px - 12 - w;      // voltea a la izquierda
    if (bx < 2) bx = 2;
    if (by < 2) by = py + 12;                   // voltea abajo
    var g = _svgEl('g', { 'class': 'te-ghostbadge' });
    g.appendChild(_svgEl('rect', { x: bx.toFixed(1), y: by.toFixed(1), width: w.toFixed(1), height: h, rx: 3, fill: color, opacity: dentro ? 0.92 : 0.95 }));
    var t = _svgEl('text', { x: (bx + padX).toFixed(1), y: (by + h - 4.2).toFixed(1), 'class': 'te-ghostbadge-t', fill: '#fff' });
    t.textContent = texto;
    g.appendChild(t);
    if (!dentro) {
      // marca de "no permitido"
      var nx = bx + w + 3;
      if (nx + 10 < VW) {
        var no = _svgEl('text', { x: nx.toFixed(1), y: (by + h - 3).toFixed(1), 'class': 'te-ghostbadge-t', fill: '#d32f2f' });
        no.textContent = '⃠';
        g.appendChild(no);
      }
    }
    layer.appendChild(g);
  }

  // Separa visualmente los DOS ganchos del estribo en la proyección de SECCIÓN
  // NOTA (09-ago): el hack `_separarGanchosSeccion` (que separaba los 2 ganchos del
  // estribo EN EL PLANO de la sección) fue ELIMINADO. Era el offset equivocado: los
  // ganchos deben llegar a la MISMA esquina y superponerse (estribo real); el único
  // offset admisible es FUERA del plano (en X, por el espesor), y eso YA lo hace el
  // motor 3D (figura_puntos.js::_estriboPerimetral, `esp = diamCm*1.05` en X). Como
  // las vistas 2D ahora son el render 3D ortográfico, el estribo se ve correcto solo.

  // Ejes de PANTALLA de una cámara ortográfica: con qué SIGNO crecen los ejes (u,v)
  // del plano hacia la derecha / hacia arriba en el render. Se DERIVAN de _ORTO_DIR
  // (la misma tabla que construye las cámaras), no se hardcodean.
  //   camZ = eye · camY = up · camX = camY × camZ (base derecha de la cámara)
  // Desde el 12-ago las 3 cámaras están orientadas igual (su=+1, sv=+1), pero esta
  // función SIGUE derivando el signo de la tabla: el overlay se alinea con lo que se
  // ve aunque mañana una vista se mire desde el otro lado.
  var _EJE_IDX = { x: 0, y: 1, z: 2 };
  function _signosPantalla(def) {
    var dir = _ORTO_DIR[def.depth] || _ORTO_DIR.z;
    var ez = dir.eye, ey = dir.up;
    var ex = [
      ey[1] * ez[2] - ey[2] * ez[1],
      ey[2] * ez[0] - ey[0] * ez[2],
      ey[0] * ez[1] - ey[1] * ez[0]
    ];
    return { su: ex[_EJE_IDX[def.u]] || 0, sv: ey[_EJE_IDX[def.v]] || 0 };
  }

  // G7-ALINEACIÓN — transform del overlay DERIVADO de la cámara ortográfica.
  // El render orto usa _encuadrarOrto (margen 1.18 + zoom + pan) y pinta en el rect
  // de la vista; el SVG tiene su propio viewBox con preserveAspectRatio="xMidYMid
  // meet". Si el overlay se encuadra por su cuenta (bbox + margen propio), el
  // hit-testing y el ghost quedan corridos — y peor tras zoom/pan, que el transform
  // ni siquiera conocía. Aquí se recorre la cadena COMPLETA:
  //   (u,v) cm → coords de cámara (signo por eje) → NDC → px del viewport (rect de
  //   la vista) → px del viewBox del SVG (letterbox de xMidYMid meet).
  // La cadena es AFÍN, así que basta evaluarla en (0,0), (1,0) y (0,1) para sacar
  // sus coeficientes. Devuelve null si la vista/cámara aún no están listas.
  function _transformDesdeCamara(plano, svg) {
    var o = ST.orto && ST.orto[plano];
    if (!o || !o.cam || !o.vista || !svg || !svg.getBoundingClientRect) return null;
    var rv = o.vista.getBoundingClientRect();
    var rs = svg.getBoundingClientRect();
    if (!(rv.width > 1) || !(rv.height > 1) || !(rs.width > 1) || !(rs.height > 1)) return null;
    var def = o.def; if (!def) return null;
    var g = (ST.receta && ST.receta.geometria) || {};
    var W = Number(g[def.W]) || 60, H = Number(g[def.H]) || 60;
    // MISMO encuadre que el render (idempotente: sólo depende de zoom/pan/corte).
    _encuadrarOrto(o, W, H, rv.width / rv.height);
    var cam = o.cam;
    var anchoCam = cam.right - cam.left, altoCam = cam.top - cam.bottom;
    if (!(Math.abs(anchoCam) > 1e-9) || !(Math.abs(altoCam) > 1e-9)) return null;
    var vb = (svg.getAttribute('viewBox') || '0 0 620 300').split(/\s+/).map(Number);
    var VW = vb[2] || 620, VH = vb[3] || 300;
    var esc = Math.min(rs.width / VW, rs.height / VH);
    if (!(esc > 0)) return null;
    var padX = (rs.width - VW * esc) / 2, padY = (rs.height - VH * esc) / 2;
    var sg = _signosPantalla(def);
    if (!sg.su || !sg.sv) return null;
    function proyectar(u, v) {
      // coords de cámara: camX·P = su·u y camY·P = sv·v (la posición de la cámara
      // vive sobre el eje de profundidad → no aporta componente lateral).
      var ndcX = (sg.su * u - (cam.left + cam.right) / 2) / (anchoCam / 2);
      var ndcY = (sg.sv * v - (cam.bottom + cam.top) / 2) / (altoCam / 2);
      var cliX = rv.left + (ndcX + 1) / 2 * rv.width;    // viewport = rect de la vista
      var cliY = rv.top + (1 - ndcY) / 2 * rv.height;
      return { px: (cliX - rs.left - padX) / esc, py: (cliY - rs.top - padY) / esc };
    }
    var p00 = proyectar(0, 0), p10 = proyectar(1, 0), p01 = proyectar(0, 1);
    var ku = p10.px - p00.px, kv = p01.py - p00.py;
    if (!isFinite(ku) || !isFinite(kv) || !ku || !kv) return null;
    return _mkTransform(p00.px, ku, p00.py, kv);
  }

  // Dibuja UN cuadrante 2D. Guarda su transform para el hit-testing inverso.
  //
  // MODO ORTO (producción): las barras SÓLIDAS y el hormigón los pinta el render 3D
  // ortográfico que hay debajo. El SVG queda como OVERLAY, pero NO vacío: emite la
  // geometría INVISIBLE de hit-testing (data-ci/data-hit), el halo de la selección,
  // los nodos, la flecha de rango y las cotas. Antes cortaba con `return` antes de
  // todo eso y la interacción 2D quedaba MUERTA (G7): no se podía seleccionar,
  // mover ni borrar una barra clicándola.
  function _dibujarVista2D(svg, out, plano, geo) {
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var def = (_defsPlanos() || {})[plano];
    if (!def) { ST.transforms[plano] = null; return; }
    var proj = _proyectorDe(def);            // proyector ÚNICO (el volteo ya es geometría real)
    var placements = (out && out.placements) || [];
    var soloOverlay = !!ST.ortoActivo;       // el 3D pinta lo sólido; aquí sólo interacción
    var rect = geo ? boundaryDeVista(geo, plano, def) : null;

    var vb = (svg.getAttribute('viewBox') || '0 0 620 300').split(/\s+/).map(Number);
    var VW = vb[2] || 620, VH = vb[3] || 300;

    // TRANSFORM — en modo orto se deriva de la cámara (alineación exacta con el
    // render); si no hay 3D todavía, del bounding box proyectado (fallback SVG plano).
    var t = soloOverlay ? _transformDesdeCamara(plano, svg) : null;
    if (!t) {
      var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      var acc = function (u, v) {
        if (u < minU) minU = u; if (u > maxU) maxU = u;
        if (v < minV) minV = v; if (v > maxV) maxV = v;
      };
      if (rect) { acc(-rect.W / 2, -rect.H / 2); acc(rect.W / 2, rect.H / 2); }
      placements.forEach(function (pl) {
        (pl.puntos || []).forEach(function (pt) { var q = proj(pt); if (isFinite(q.u) && isFinite(q.v)) acc(q.u, q.v); });
      });
      if (!isFinite(minU) || !isFinite(minV)) { ST.transforms[plano] = null; return; }
      var MARGIN = 30;
      var spanU = Math.max(maxU - minU, 1e-6), spanV = Math.max(maxV - minV, 1e-6);
      var s = Math.min((VW - 2 * MARGIN) / spanU, (VH - 2 * MARGIN) / spanV);
      var offX = (VW - spanU * s) / 2, offY = (VH - spanV * s) / 2;
      t = _mkTransform(offX - minU * s, s, offY + maxV * s, -s);
    }
    ST.transforms[plano] = t;
    function X(u) { return _tX(t, u); }
    function Y(v) { return _tY(t, v); }

    // GRILLA DE FONDO — lo PRIMERO que se emite: es fondo, tiene que quedar debajo de
    // todo lo demás (el SVG no tiene z-index, manda el orden del documento).
    _dibujarGrilla2D(svg, t, VW, VH);

    // Hormigón sólido: en modo orto lo pinta el 3D. El punteado del RECUBRIMIENTO
    // sí va SIEMPRE en el overlay (el 3D no lo dibuja y el usuario lo necesita
    // como guía de colocación).
    if (rect && !soloOverlay) {
      svg.appendChild(_svgEl('rect', {
        'class': 'te-horm', rx: 2,
        x: Math.min(X(-rect.W / 2), X(rect.W / 2)), y: Math.min(Y(rect.H / 2), Y(-rect.H / 2)),
        width: rect.W * t.s, height: rect.H * t.s
      }));
    }
    if (rect && rect.iW > 0 && rect.iH > 0) {
      svg.appendChild(_svgEl('rect', {
        'class': 'te-recub',
        x: Math.min(X(-rect.iW / 2), X(rect.iW / 2)), y: Math.min(Y(rect.iH / 2), Y(-rect.iH / 2)),
        width: rect.iW * t.s, height: rect.iH * t.s
      }));
    }

    // Barras: halo de selección + HIT invisible SIEMPRE; el trazo sólido sólo cuando
    // el SVG es el que dibuja (sin render orto detrás).
    placements.forEach(function (pl) {
      var color = _colorComp(_compDePl(pl) || { tipologia: pl.tipologia });
      var rol = _rolComp(pl);
      var ci = (pl.meta && pl.meta.ci != null) ? pl.meta.ci : -1;
      var sel = (ci >= 0) && _estaSeleccionado(ci);
      var pts = (pl.puntos || []).map(proj).filter(function (q) { return isFinite(q.u) && isFinite(q.v); });
      if (!pts.length) return;

      // ¿La barra se ve DE PUNTA en esta vista? (su eje longitudinal es la
      // profundidad del plano) → círculo, no polilínea. Criterio GEOMÉTRICO (sirve
      // igual para piezas volteadas, cuyo eje longitudinal ya cambió de verdad).
      if (rol === 'cabezal' && _ejeMayorSpan(pl.puntos) === def.depth) {
        // Punto representativo = el TRAMO RECTO que corre en profundidad (el cuerpo
        // de la barra), NO pts[0] (que es la punta del gancho → el círculo salía
        // "abajo" mientras la barra iba arriba). Todos los puntos del tramo proyectan
        // al mismo (u,v): tomamos el extremo del segmento con mayor delta en depth.
        var q0 = pts[0], mejorDelta = -1;
        var raw = pl.puntos || [];
        for (var si = 1; si < raw.length; si++) {
          var dd = Math.abs((raw[si][def.depth] || 0) - (raw[si - 1][def.depth] || 0));
          if (dd > mejorDelta) { mejorDelta = dd; q0 = proj(raw[si]); }
        }
        // Radio REAL de la barra en px. OJO con las unidades: pl.diam YA viene en
        // CENTÍMETROS (reglas.js lo convierte una sola vez: φ16 → 1.6) y t.s es
        // px/cm → radio = diam/2 * s. Antes se dividía por 20 (se re-aplicaba el
        // mm→cm) y el círculo salía 10× chico; el piso de 3 px lo tapaba dibujando
        // todos los φ iguales. Piso 1.5 px: sólo actúa en zoom-out extremo.
        var rPx = Math.max(1.5, (Number(pl.diam) / 2) * Math.abs(t.s || 1));
        if (sel) svg.appendChild(_svgEl('circle', { cx: X(q0.u), cy: Y(q0.v), r: rPx + 2.5, 'class': 'te-bar-halo' }));
        svg.appendChild(_svgEl('circle', { cx: X(q0.u), cy: Y(q0.v), r: rPx, fill: color, style: 'pointer-events:none' }));
        // hit generoso (transparente) — es lo que hace clicable la barra
        svg.appendChild(_svgEl('circle', {
          cx: X(q0.u), cy: Y(q0.v), r: Math.max(7.5, rPx + 3), fill: 'transparent',
          'data-ci': ci, 'data-hit': '1', style: 'cursor:pointer'
        }));
        return;
      }
      var d = pts.map(function (q, i) { return (i ? 'L' : 'M') + X(q.u).toFixed(1) + ',' + Y(q.v).toFixed(1); }).join(' ');
      if (sel) svg.appendChild(_svgEl('path', { 'class': 'te-bar-halo', d: d }));
      if (!soloOverlay) {
        svg.appendChild(_svgEl('path', {
          'class': 'te-bar' + (sel ? ' sel' : ''), d: d, stroke: color, style: 'pointer-events:none',
          opacity: (rol === 'estribo' && plano === 'planta') ? 0.6 : 1
        }));
      }
      // trazo de HIT transparente ancho (facilita el clic sobre la línea fina)
      svg.appendChild(_svgEl('path', {
        d: d, fill: 'none', stroke: 'transparent', 'stroke-width': 9, 'stroke-linecap': 'round',
        'data-ci': ci, 'data-hit': '1', style: 'cursor:pointer'
      }));
    });

    // BBOX punteado de la PIEZA seleccionada (todas sus barras juntas) + esquinitas
    // — la marca de selección "de conjunto"; el realce por barra lo pone el render
    // 3D (SEL_COLOR) y el contorno fino .te-bar-halo, que usa ESE MISMO magenta para
    // que 2D y 3D digan lo mismo. Estilo CAD, nada de halos.
    if (ST.selCi >= 0) {
      var bU0 = Infinity, bV0 = Infinity, bU1 = -Infinity, bV1 = -Infinity;
      placements.forEach(function (pl) {
        var ci = (pl.meta && pl.meta.ci != null) ? pl.meta.ci : -1;
        if (ci !== ST.selCi) return;
        (pl.puntos || []).forEach(function (p) {
          var q = proj(p);
          if (!isFinite(q.u) || !isFinite(q.v)) return;
          if (q.u < bU0) bU0 = q.u; if (q.u > bU1) bU1 = q.u;
          if (q.v < bV0) bV0 = q.v; if (q.v > bV1) bV1 = q.v;
        });
      });
      if (isFinite(bU0)) {
        var px0 = Math.min(X(bU0), X(bU1)) - 6, px1 = Math.max(X(bU0), X(bU1)) + 6;
        var py0 = Math.min(Y(bV0), Y(bV1)) - 6, py1 = Math.max(Y(bV0), Y(bV1)) + 6;
        svg.appendChild(_svgEl('rect', {
          'class': 'te-sel-bbox', x: px0, y: py0, width: px1 - px0, height: py1 - py0
        }));
        [[px0, py0], [px1, py0], [px0, py1], [px1, py1]].forEach(function (e) {
          svg.appendChild(_svgEl('rect', {
            'class': 'te-sel-esq', x: e[0] - 2.5, y: e[1] - 2.5, width: 5, height: 5
          }));
        });
        // TIRADORES DEL MARCO DE LA BARRA (17-ago): uno por borde, en TODA vista.
        // Arrastrar un borde ESTIRA/ACHICA la pieza escribiendo el Δ del lado que
        // corresponde (con su extremo): el tirador y el campo Δ de la ficha son
        // la misma perilla. QUÉ lado y con qué signo NO sale de ninguna tabla:
        // se SONDEA con el motor al agarrar (_iniciarDragMarco) — genérico para
        // cualquier figura, sin ramas. data-mlado es el signo del borde EN EJES
        // DE LA VISTA (+ = borde de mayor u/v), no en pantalla: X/Y pueden ir
        // invertidos según la cámara y el drag se calcula en uv.
        var uDer = (X(bU1) >= X(bU0));    // ¿bU1 es el borde derecho en pantalla?
        var vArr = (Y(bV1) <= Y(bV0));    // ¿bV1 es el borde de arriba? (px menor)
        [
          { x: px1, y: (py0 + py1) / 2, eje: 'u', ml: uDer ? '+' : '-', cur: 'ew-resize' },
          { x: px0, y: (py0 + py1) / 2, eje: 'u', ml: uDer ? '-' : '+', cur: 'ew-resize' },
          { x: (px0 + px1) / 2, y: py0, eje: 'v', ml: vArr ? '+' : '-', cur: 'ns-resize' },
          { x: (px0 + px1) / 2, y: py1, eje: 'v', ml: vArr ? '-' : '+', cur: 'ns-resize' }
        ].forEach(function (h) {
          svg.appendChild(_svgEl('rect', {
            'class': 'te-mh', x: h.x - 3.5, y: h.y - 3.5, width: 7, height: 7, rx: 1.5,
            'data-marco': h.eje, 'data-mlado': h.ml,
            style: 'cursor:' + h.cur
          })).appendChild(_svgEl('title', {})).textContent =
            'Estira/achica la barra: escribe el Δ del lado correspondiente (se suma al largo de corte).';
        });
      }
    }

    // Cotas (básico): extensión del hormigón en U y V.
    if (ST.cotas && rect) _dibujarCotas(svg, rect, t.s, X, Y, plano);

    // Flecha de RANGO del componente seleccionado (real si la distribución está
    // activa; "inactiva" en gris si todavía no lo está — arrastrarla la activa).
    _dibujarFlechaRango(svg, plano, X, Y, VW, VH);

    // COTAS POR LADO de la barra seleccionada (gate SHIFT). Van LO ÚLTIMO = encima
    // de todo lo demás del overlay: son texto y no se leen a medio tapar. No pelean
    // por el puntero (pointer-events:none) y mientras SHIFT esté apretado el
    // cuadrante no acepta clics, así que tampoco esconden un tirador usable.
    // ESTIRANDO EL MARCO SE ENCIENDEN SOLAS (etapa 2, 20-ago): «la medida
    // resultante del lado que se está cambiando» ES esta capa. No se escribe una
    // segunda: la que existe ya sabe qué lado se ve en esta vista, cuál cae fuera
    // del cuchillo y cómo agrupar los que se pisan. Soltar la apaga.
    if (ST.cotas || (ST.dragMarco && ST.dragMarco.pushed)) _dibujarCotasLados(svg, plano, proj, X, Y, out);

    // COTAS VIVAS DE LA PIEZA — el hueco contra el hormigón mientras se mueve o se
    // estira. Reusa el bbox que acaba de calcular el marco de selección.
    if (_arrastrandoPieza() && isFinite(bU0)) {
      _cotasVivasPieza(svg, plano, X, Y, VW, VH, { u0: bU0, u1: bU1, v0: bV0, v1: bV1 });
    }

  }

  // Eje del mundo con MAYOR extensión de una polilínea = "por dónde corre" la barra.
  function _ejeMayorSpan(pts) {
    if (!pts || pts.length < 2) return null;
    var lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.x < lo.x) lo.x = p.x; if (p.x > hi.x) hi.x = p.x;
      if (p.y < lo.y) lo.y = p.y; if (p.y > hi.y) hi.y = p.y;
      if (p.z < lo.z) lo.z = p.z; if (p.z > hi.z) hi.z = p.z;
    }
    var mejor = 'x', span = hi.x - lo.x;
    if (hi.y - lo.y > span) { mejor = 'y'; span = hi.y - lo.y; }
    if (hi.z - lo.z > span) { mejor = 'z'; span = hi.z - lo.z; }
    return mejor;
  }

  function _dibujarCotas(svg, rect, s, X, Y, plano) {
    var y0 = Y(-rect.H / 2) + 14;
    // cota horizontal (ancho de la vista)
    svg.appendChild(_svgEl('line', { 'class': 'te-dimL', x1: X(-rect.W / 2), y1: y0, x2: X(rect.W / 2), y2: y0 }));
    svg.appendChild(_svgEl('line', { 'class': 'te-dimTick', x1: X(-rect.W / 2), y1: y0 - 3, x2: X(-rect.W / 2), y2: y0 + 3 }));
    svg.appendChild(_svgEl('line', { 'class': 'te-dimTick', x1: X(rect.W / 2), y1: y0 - 3, x2: X(rect.W / 2), y2: y0 + 3 }));
    var tW = _svgEl('text', { 'class': 'te-dim', x: X(0), y: y0 - 4, 'text-anchor': 'middle' });
    tW.textContent = Math.round(rect.W) + ' cm'; svg.appendChild(tW);
    // cota vertical (alto de la vista) — al borde IZQUIERDO real. Hoy las 3 cámaras
    // van con u→derecha, pero se sigue tomando el mínimo: el borde se calcula, no se
    // asume (si mañana una vista se mira desde el otro lado, la cota no se cruza).
    var x0 = Math.min(X(-rect.W / 2), X(rect.W / 2)) - 12;
    svg.appendChild(_svgEl('line', { 'class': 'te-dimL', x1: x0, y1: Y(-rect.H / 2), x2: x0, y2: Y(rect.H / 2) }));
    var tH = _svgEl('text', { 'class': 'te-dim', x: x0 - 2, y: Y(0), 'text-anchor': 'middle', transform: 'rotate(-90 ' + (x0 - 2) + ' ' + Y(0) + ')' });
    tH.textContent = Math.round(rect.H) + ' cm'; svg.appendChild(tH);
  }


  // ==========================================================================
  // COTAS POR LADO DE LA BARRA — LETRA=MEDIDA, SÓLO EN LOS TRAMOS VISIBLES
  // ==========================================================================
  // Gate: el interruptor de cotas (ST.cotas — botón «Cotas» o SHIFT). Sólo la barra
  // SELECCIONADA, y de sus N placements UNO SOLO — cuál, lo decide el cuchillo de
  // cada vista (ver abajo).
  //
  // TRES FILTROS, en este orden, y ninguno es opcional:
  //   1. ¿CUÁL barra? — la que ESTA vista está mostrando (la más cercana al corte).
  //   2. ¿ESTE LADO SE VE? — no si se proyecta como un punto, no si el cuchillo lo
  //      dejó fuera de la banda, no si no queda sitio para leer el rótulo.
  //   3. ¿SE PISA CON OTRO? — dos rótulos calcados se agrupan en uno.
  //
  // QUÉ ES UN TRAMO VISIBLE. El plano de cada vista colapsa su eje `depth`: un lado
  // que corre por ahí se proyecta COMO UN PUNTO y no hay lado que rotular. La cota
  // de "esto es un punto" no se inventa acá: es GHOST_PT_TOL (0.5 cm), la misma con
  // la que el ghost decide que dos puntos proyectados son el mismo.
  //
  // Y una segunda condición, de LECTURA y no de geometría: un rótulo sobre un
  // trecho de 9 px no señala nada, flota. Se pide un anclaje mínimo de
  // COTA_LADO_MIN_PX. No se pierde el dato: el umbral es en PÍXELES y el transform
  // sigue a la cámara, así que acercando el zoom el rótulo vuelve solo. MEDIDO en la
  // viga-semilla a encuadre completo (≈1 px/cm en 'largo'): las patas de 9.6 cm de
  // la 103B sólo caben en SECCIÓN (≈15 px/cm) y aparecen en las otras al acercarse.
  //
  // LADOS QUE SE PISAN EN LA PROYECCIÓN (defecto MEDIDO el 19-ago). "Visible" no
  // basta: dos lados distintos pueden caer sobre el MISMO trecho de pantalla y sus
  // rótulos quedan calcados, que se lee como un borrón en negrita. Medido en la
  // viga-semilla: las dos patas de la 103B en SECCIÓN, a 0.0 px una de otra; los dos
  // costados del estribo en A LO LARGO y sus dos travesaños en PLANTA, a 1.0 px (no
  // 0: el codo del gancho acorta un lado del par en Rc, así que "mismo segmento" no
  // sirve como criterio — el que sirve es "los dos rótulos se pisan").
  // Se AGRUPAN los lados PARALELOS cuyos anclajes quedan a menos de una línea de
  // texto. Dentro del grupo: si miden lo mismo —el caso normal, es el par espejo de
  // la figura— sale UN rótulo con las dos letras, `A·C=30`; si midieran distinto se
  // apilan uno debajo del otro, como una cota encadenada de CAD.
  // TAMAÑO DE LETRA (19-ago, el usuario las pidió más grandes: 9.5 → 11.5 px). Los
  // cuatro números de abajo NO son independientes del CSS: si sube la letra y no
  // suben ellos, el rótulo se cree más angosto de lo que es y el filtro de encaje
  // deja salir textos que ya no caben sobre su lado. Todos escalan por el MISMO
  // factor 11.5/9.5 = 1.21, salvo el encaje, que se DIVIDE por él justamente para
  // que el conjunto de lados rotulados no cambie: lo que se veía se sigue viendo,
  // sólo que legible.
  var COTA_LADO_OFF = 8;        // px del viewBox entre el trazo y el rótulo
  var COTA_LADO_PASO = 13.5;    // alto de línea: separación de los rótulos apilados
  var COTA_LADO_MIN_PX = 18;    // anclaje mínimo del rótulo sobre su lado
  var COTA_LADO_PARAL = 15;     // grados: hasta acá dos lados se consideran paralelos
  var COTA_LADO_CHAR = 6.8;     // ancho medio de un carácter (700 11.5px Segoe UI)
  // Cuánto puede el rótulo ser MÁS CORTO que su propio texto antes de dejar de
  // señalar a su lado. 0.65 = el texto puede sobresalir hasta ~1.5× el trecho.
  // Los dos números que lo fijan, MEDIDOS: un `A·C=24` (33.6 px) sobre el travesaño
  // de 23.2 px del estribo en PLANTA es legible y tiene que salir; un `A·C·E=22`
  // (44.8 px) sobre los 20.1 px de una 105A φ25 es 2.2× su lado y se mete encima de
  // los vecinos — ése no. El corte queda entre los dos.
  // 19-ago: 0.65 → 0.54 = 0.65 ÷ 1.21, la misma razón en que creció la letra. El
  // producto `anchoTxt · ENCAJE` queda idéntico, o sea que los dos casos medidos
  // arriba siguen cayendo del mismo lado del corte con la letra nueva.
  var COTA_LADO_ENCAJE = 0.54;

  // ¿ESTE LADO SE VE EN ESTE PLANO? Regla GEOMÉTRICA pura (sin píxeles ni cámara):
  // se proyecta el tramo y se mide. Devuelve el largo PROYECTADO en cm, o 0 si el
  // lado colapsa (corre por la profundidad del plano → es un punto, no un lado).
  function _ladoVisibleEnPlano(puntos, lado, proj) {
    if (!puntos || !lado || typeof proj !== 'function') return 0;
    if (!puntos[lado.i0] || !puntos[lado.i1]) return 0;
    var qa = proj(puntos[lado.i0]), qb = proj(puntos[lado.i1]);
    if (!qa || !qb || !isFinite(qa.u) || !isFinite(qa.v) || !isFinite(qb.u) || !isFinite(qb.v)) return 0;
    var d = Math.hypot(qb.u - qa.u, qb.v - qa.v);
    return (d > GHOST_PT_TOL) ? d : 0;
  }

  // ¿Los rótulos de estos dos lados se PISARÍAN? (anclajes a menos de una línea de
  // texto y trazos paralelos). Los dos van en píxeles del viewBox: es una pregunta
  // de pantalla, no de geometría.
  function _rotulosSePisan(a, b) {
    if (Math.hypot(a.mx - b.mx, a.my - b.my) >= COTA_LADO_PASO) return false;
    var d = Math.abs(a.ang - b.ang) % 180;
    return (d <= COTA_LADO_PARAL || d >= 180 - COTA_LADO_PARAL);
  }

  // ¿A qué distancia del CUCHILLO de esta vista queda esta barra? (0 = lo cruza).
  // Se mide sobre el eje de PROFUNDIDAD del plano, que es donde corta la banda.
  function _distAlCorte(pl, dep, corte) {
    var lo = Infinity, hi = -Infinity, w, i;
    for (i = 0; i < pl.puntos.length; i++) {
      w = pl.puntos[i][dep];
      if (!isFinite(w)) continue;
      if (w < lo) lo = w; if (w > hi) hi = w;
    }
    if (!isFinite(lo)) return Infinity;
    return (corte < lo) ? (lo - corte) : (corte > hi ? corte - hi : 0);
  }

  function _dibujarCotasLados(svg, plano, proj, X, Y, out) {
    if (ST.selCi < 0) return;
    var pls = (out && out.placements) || [], pl = null, i, j;
    // ¿CUÁL de las N barras del componente? LA QUE ESTA VISTA ESTÁ MOSTRANDO.
    // -----------------------------------------------------------------------
    // Un componente repartido son N barras congruentes (la viga-semilla trae 40
    // estribos con el mismo ci): rotularlas todas serían 160 rótulos apilados, así
    // que se rotula UNA. Pero no puede ser "la primera de la lista": cada cuadrante
    // tiene su CUCHILLO y en SECCIÓN la banda es FINA —del grosor de una barra, ver
    // _actualizarCorte— y deja pasar UN estribo. Con el corte a media viga, la
    // primera barra (x = −296) NO ESTÁ EN PANTALLA: los rótulos quedaban flotando
    // sobre una sección vacía. Se elige la que MENOS se aleja del corte, con los
    // MISMOS números que usa el render (o.cortePos / o.corteGrosor, no una copia), y
    // si ni esa entra en la banda no se rotula nada: esta vista no la está mostrando.
    var def = (_defsPlanos() || {})[plano];
    var o = ST.orto && ST.orto[plano];
    var dep = def && def.depth;
    var corte = (o && o.cortePos != null && isFinite(o.cortePos)) ? o.cortePos : null;
    var mejorD = Infinity, d;
    for (i = 0; i < pls.length; i++) {
      if (!pls[i] || !pls[i].meta || pls[i].meta.ci !== ST.selCi) continue;
      if (!pls[i].puntos || !pls[i].puntos.length) continue;
      if (!dep || corte == null) { pl = pls[i]; mejorD = 0; break; }   // sin cuchillo: la primera
      d = _distAlCorte(pls[i], dep, corte);
      if (d < mejorD) { mejorD = d; pl = pls[i]; }
    }
    if (!pl) return;
    var grosor = (o && o.corteGrosor != null && isFinite(o.corteGrosor)) ? o.corteGrosor : null;
    if (grosor != null && mejorD > grosor) return;   // ninguna barra del componente entra en la banda
    // ROL EFECTIVO: el que el motor estampó en el componente (comp._rol). La
    // tipología PROPONE el rol y la topología de la figura MANDA, así que
    // re-derivarlo de la tipología podría leer otra familia de dibujo —y con ella
    // otro mapeo de tramos— que la que realmente se dibujó.
    var comp = _compDePl(pl);
    var lados = _ladosRotulables(pl, (comp && comp._rol) || _rolComp(comp));
    if (!lados) return;

    // (1) los VISIBLES, ya llevados a píxeles del viewBox
    var vis = [], L, qa, qb, x0, y0, x1, y1, lpx, ang;
    for (i = 0; i < lados.length; i++) {
      L = lados[i];
      if (!_ladoVisibleEnPlano(pl.puntos, L, proj)) continue;   // se proyecta como punto
      // …y el CUCHILLO también corta LADO POR LADO, no sólo barra por barra: el
      // cuerpo de un longitudinal cruza la sección entera (por eso se lo ve como
      // círculo) pero sus PATAS viven en las puntas de la viga. Con el corte a media
      // luz, esas patas NO están en pantalla y rotularlas era poner una medida sobre
      // nada. Misma banda, misma cuenta, a la escala del lado.
      if (dep && corte != null && grosor != null &&
          _distAlCorte({ puntos: [pl.puntos[L.i0], pl.puntos[L.i1]] }, dep, corte) > grosor) continue;
      qa = proj(pl.puntos[L.i0]); qb = proj(pl.puntos[L.i1]);
      x0 = X(qa.u); y0 = Y(qa.v); x1 = X(qb.u); y1 = Y(qb.v);
      lpx = Math.hypot(x1 - x0, y1 - y0);
      if (!(lpx >= COTA_LADO_MIN_PX)) continue;   // sin anclaje: mejor nada que un rótulo flotando
      // El ángulo se pliega a [−90°, 90°] para que el texto nunca quede de cabeza
      // (girar 180° un texto centrado lo deja en el mismo sitio, sólo que legible).
      ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
      if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
      vis.push({ lado: L.lado, valor: L.valor, mx: (x0 + x1) / 2, my: (y0 + y1) / 2, ang: ang, lpx: lpx });
    }
    if (!vis.length) return;

    // (2) agrupar los que se pisarían
    var grupos = [], g;
    for (i = 0; i < vis.length; i++) {
      g = null;
      for (j = 0; j < grupos.length; j++) if (_rotulosSePisan(grupos[j][0], vis[i])) { g = grupos[j]; break; }
      if (g) g.push(vis[i]); else grupos.push([vis[i]]);
    }

    var capa = _svgEl('g', { 'class': 'te-cotalado-g' });
    // Centroide proyectado de la barra: el rótulo se corre hacia AFUERA de la figura
    // (si no, los 4 lados de un estribo escriben hacia adentro y el texto cae encima
    // del propio marco).
    var cu = 0, cv = 0, n = 0, q;
    for (i = 0; i < pl.puntos.length; i++) {
      q = proj(pl.puntos[i]);
      if (isFinite(q.u) && isFinite(q.v)) { cu += q.u; cv += q.v; n++; }
    }
    if (n) { cu /= n; cv /= n; }
    var cx = X(cu), cy = Y(cv);

    for (i = 0; i < grupos.length; i++) {
      g = grupos[i];
      var mx = g[0].mx, my = g[0].my, rad = g[0].ang * Math.PI / 180;
      // Hacia qué lado del trazo se corre: el que se aleja del centroide. En el
      // marco de la rotación, el eje +Y local apunta a (−sin α, cos α).
      var fuera = ((mx - cx) * -Math.sin(rad) + (my - cy) * Math.cos(rad)) >= 0 ? 1 : -1;
      // ¿el grupo mide lo mismo? (el caso normal: es el par espejo de la figura)
      var v0 = Math.round(g[0].valor), igual = true, letras = [];
      for (j = 0; j < g.length; j++) {
        if (Math.round(g[j].valor) !== v0) igual = false;
        letras.push(g[j].lado);
      }
      // Las letras del rótulo agrupado van en ORDEN ALFABÉTICO, no en el orden en
      // que el trazo recorre la figura: es una lista para leer, no un recorrido
      // ('A·C=24' y no 'C·A=24').
      var textos = igual ? [letras.sort().join('·') + '=' + v0]
                         : g.map(function (e) { return e.lado + '=' + Math.round(e.valor); });
      // ENCAJE — se comprueba con el texto YA ARMADO, no antes: agrupar dos lados
      // alarga el rótulo ('B=52' → 'B·D=52') y el trecho sigue siendo el mismo, así
      // que un umbral fijo dejaba salir rótulos del doble de ancho que su lado.
      var anchoTxt = 0;
      for (j = 0; j < textos.length; j++) anchoTxt = Math.max(anchoTxt, textos[j].length * COTA_LADO_CHAR);
      if (g[0].lpx < anchoTxt * COTA_LADO_ENCAJE) continue;
      for (j = 0; j < textos.length; j++) {
        var t = _svgEl('text', {
          'class': 'te-cotalado', 'text-anchor': 'middle', 'dominant-baseline': 'central',
          x: 0, y: (fuera * (COTA_LADO_OFF + j * COTA_LADO_PASO)).toFixed(1),
          transform: 'translate(' + mx.toFixed(1) + ',' + my.toFixed(1) + ') rotate(' + g[0].ang.toFixed(1) + ')'
        });
        t.textContent = textos[j];
        capa.appendChild(t);
      }
    }
    if (capa.firstChild) svg.appendChild(capa);
  }

  // AJUSTADOR DE DISTRIBUCIÓN — flechita doble ↔ (o ↕) para desplazar el rango del
  // componente seleccionado.
  //
  // El eje de reparto de un componente NO es siempre X: con la pieza volteada el
  // motor reparte en Z (reglas.ejeDistribucion). La flecha se dibuja en las vistas
  // donde ESE eje es VISIBLE — es decir, es el u o el v del plano (si es el `depth`,
  // el rango apunta hacia el observador y no se puede ajustar ahí) — y usa la
  // coordenada de ese eje, no X. Antes estaba cableada a largo/planta + rango.x.
  //
  // Se dibuja SIEMPRE que haya una barra seleccionada y su eje de reparto sea
  // visible en esta vista (ya no hay herramienta "↔ Rango" de 2 clics):
  //   · distribucion.activa  → flecha REAL (handles vivos, rango del componente).
  //   · NO activa            → flecha "inactiva" (opacity .35) con el rango DEFAULT
  //     del eje, SIN escribirlo en el componente. Arrastrarla (handle o tramo
  //     central) ACTIVA la distribución — lo hace _dragRangoMove.
  // OFFSETS de la flecha de rango dentro del viewBox del overlay SVG.
  //   V (flecha horizontal ↔): baja hasta 34 para NO toparse con la etiqueta de la
  //     vista (.te-vtitle: top 8px + ~19px de alto ⇒ ocupa hasta ~27).
  //   H (flecha vertical ↕): 30 para despegarla del borde izquierdo (antes 18).
  var TE_RANGO_OFF_V = 34;
  var TE_RANGO_OFF_H = 30;

  function _dibujarFlechaRango(svg, plano, X, Y, VW, VH) {
    if (ST.selCi < 0 || !ST.receta) return;
    var c = ST.receta.componentes[ST.selCi];
    if (!c) return;
    var d = c.distribucion || {};
    var def = (_defsPlanos() || {})[plano]; if (!def) return;
    var activa = !!d.activa;
    // Las ZONAS de la semilla (confinamiento) se editan por campos, no con la flecha.
    if (activa && !d.rango && d.zonas && d.zonas.length) return;

    // LAS DOS LÍNEAS (15-ago). El ARREGLO reparte por ÁREA: cada línea tiene su
    // eje, su rango y su @, y CADA UNA se dibuja en la vista que la contiene —
    // por eso el usuario ve dos flechas en el plano que muestra los dos ejes, y
    // una sola en los otros dos. La 2ª va en su propio color (clase te-r2) para
    // que no haya que adivinar cuál es cuál.
    var lineas = [{ cual: 'rango', eje: (d.rango && d.rango.eje) || _ejeDistDe(c), r: activa ? d.rango : _rangoDefault(d.sep, _ejeDistDe(c)) }];
    if (_modoDe(c) === 'arreglo' && d.rango2 && d.rango2.from != null && d.rango2.to != null) {
      lineas.push({ cual: 'rango2', eje: d.rango2.eje || 'y', r: d.rango2, segunda: true });
    }

    lineas.forEach(function (L) {
      var eje = L.eje, rango = L.r;
      if (eje !== def.u && eje !== def.v) return;   // este eje no se ve en esta vista
      if (!rango || rango.from == null || rango.to == null) return;
      var gAttrs = activa ? {} : { opacity: 0.35, 'data-rango-preview': '1' };
      var g = _svgEl('g', gAttrs);
      svg.appendChild(g);
      var sfx = L.segunda ? ' te-r2' : '';
      var attrs = { 'class': 'te-rango-hit', 'data-rango': ST.selCi, 'data-rango-eje': eje, 'data-rango-cual': L.cual };
      function handle(cx, cy, cualEnd, cursor) {
        g.appendChild(_svgEl('rect', {
          'class': 'te-rango-end' + sfx, x: cx - 3.5, y: cy - 3.5, width: 7, height: 7,
          'data-rango': ST.selCi, 'data-rango-end': cualEnd, 'data-rango-eje': eje,
          'data-rango-cual': L.cual, style: 'cursor:' + cursor
        }));
      }
      if (eje === def.u) {
        // la 2ª línea horizontal se separa un poco para no pisar a la 1ª cuando
        // las dos caen en el mismo eje de la vista.
        var yy = TE_RANGO_OFF_V + (L.segunda ? 16 : 0);
        var xa = X(rango.from), xb = X(rango.to);
        g.appendChild(_svgEl('line', { 'class': 'te-rango-line' + sfx, x1: xa, y1: yy, x2: xb, y2: yy }));
        g.appendChild(_svgEl('path', { 'class': 'te-rango-arrow' + sfx, d: 'M' + (xa + 7) + ',' + (yy - 4) + ' L' + xa + ',' + yy + ' L' + (xa + 7) + ',' + (yy + 4) }));
        g.appendChild(_svgEl('path', { 'class': 'te-rango-arrow' + sfx, d: 'M' + (xb - 7) + ',' + (yy - 4) + ' L' + xb + ',' + yy + ' L' + (xb - 7) + ',' + (yy + 4) }));
        attrs.x = Math.min(xa, xb) + 5; attrs.y = yy - 7;
        attrs.width = Math.max(4, Math.abs(xb - xa) - 10); attrs.height = 14;
        attrs.style = 'cursor:move';
        g.appendChild(_svgEl('rect', attrs));
        handle(xa, yy, 'from', 'ew-resize'); handle(xb, yy, 'to', 'ew-resize');
        var cajaLen = _rotuloLargoRango(g, rango, L.cual, eje, activa, true, xa, xb, yy, VW, VH, sfx);
        if (activa && !L.segunda) _dibujarTramosRango(g, d, rango, true, X, yy, plano, eje, L.cual);
        // LO ÚLTIMO = encima de todo (igual que las cotas por lado): son números que
        // el usuario está leyendo MIENTRAS mueve, no se leen a medio tapar.
        if (_arrastrandoLinea(L.cual)) _cotasVivas(g, rango, eje, true, X, yy, VW, VH, cajaLen);
      } else {
        var xx = TE_RANGO_OFF_H + (L.segunda ? 16 : 0);
        var ya = Y(rango.from), yb = Y(rango.to);
        g.appendChild(_svgEl('line', { 'class': 'te-rango-line' + sfx, x1: xx, y1: ya, x2: xx, y2: yb }));
        g.appendChild(_svgEl('path', { 'class': 'te-rango-arrow' + sfx, d: 'M' + (xx - 4) + ',' + (ya + 7) + ' L' + xx + ',' + ya + ' L' + (xx + 4) + ',' + (ya + 7) }));
        g.appendChild(_svgEl('path', { 'class': 'te-rango-arrow' + sfx, d: 'M' + (xx - 4) + ',' + (yb - 7) + ' L' + xx + ',' + yb + ' L' + (xx + 4) + ',' + (yb - 7) }));
        attrs.x = xx - 7; attrs.y = Math.min(ya, yb) + 5;
        attrs.width = 14; attrs.height = Math.max(4, Math.abs(yb - ya) - 10);
        attrs.style = 'cursor:move';
        g.appendChild(_svgEl('rect', attrs));
        handle(xx, ya, 'from', 'ns-resize'); handle(xx, yb, 'to', 'ns-resize');
        var cajaLenV = _rotuloLargoRango(g, rango, L.cual, eje, activa, false, ya, yb, xx, VW, VH, sfx);
        if (activa && !L.segunda) _dibujarTramosRango(g, d, rango, false, Y, xx, plano, eje, L.cual);
        if (_arrastrandoLinea(L.cual)) _cotasVivas(g, rango, eje, false, Y, xx, VW, VH, cajaLenV);
      }
    });
  }

  // TRAMOS SOBRE LA FLECHA (punto 4b) — por cada límite interno un DIVISOR arrastrable
  // (mueve el límite entre los dos tramos contiguos) y por cada tramo una etiqueta
  // "@N" CLICABLE que abre un input inline para editar ese @ sin ir al panel.
  // `P` proyecta la coordenada del eje de reparto a px; `fija` es la coordenada
  // perpendicular (la línea de la flecha). Se dibuja DESPUÉS del rect de arrastre y de
  // los handles → queda encima y se puede clicar.
  function _dibujarTramosRango(svg, d, rango, horiz, P, fija, plano, eje, cual) {
    var arr = _tramosDe(d);
    if (!arr.length) return;
    var multi = arr.length > 1;
    var sgn = (Number(rango.to) >= Number(rango.from)) ? 1 : -1;
    var acc = Number(rango.from);
    for (var i = 0; i < arr.length; i++) {
      var a = acc, b = acc + sgn * arr[i].long;
      if (i > 0) {                                   // divisor: sólo en límites INTERNOS
        var pd = P(a);
        _divisorTramo(svg, i, horiz ? pd : fija, horiz ? fija : pd, horiz, plano, eje, cual);
      }
      var pm = P((a + b) / 2);
      // El LARGO del tramo sólo se rotula con VARIOS tramos: con uno solo su largo
      // ES el del rango —ya lo dice el rótulo del abanico— y encima no sería
      // editable (_setLongTramo necesita un vecino que compense). Se le pasa el
      // TRECHO EN PANTALLA de este tramo para que la pareja [largo][@] se caiga
      // sola cuando no cabe (ver _etiquetaAt).
      _etiquetaAt(svg, arr[i].sep, i, horiz ? pm : fija, horiz ? fija : pm, horiz, plano,
        multi ? arr[i].long : null, Math.abs(P(b) - P(a)));
      acc = b;
    }
  }

  function _divisorTramo(svg, idx, x, y, horiz, plano, eje, cual) {
    var L = 6;
    svg.appendChild(_svgEl('line', {
      'class': 'te-rango-div',
      x1: horiz ? x : x - L, y1: horiz ? y - L : y,
      x2: horiz ? x : x + L, y2: horiz ? y + L : y
    }));
    svg.appendChild(_svgEl('rect', {
      'class': 'te-rango-divhit',
      x: (horiz ? x - 4 : x - L - 2), y: (horiz ? y - L - 2 : y - 4),
      width: (horiz ? 8 : 2 * L + 4), height: (horiz ? 2 * L + 4 : 8),
      // EL EJE Y LA LÍNEA VIAJAN EN EL TIRADOR (fix 19-ago): el arrastre del divisor
      // los deducía con _ejeDistDe(comp), que es el eje de reparto de AHORA. Girada
      // la pieza, ese eje cambia y el del rango guardado no, así que el divisor se
      // arrastraba contra el eje equivocado y no seguía al cursor. Manda lo dibujado.
      'data-rango-div': idx, 'data-plano': plano,
      'data-rango-eje': eje || '', 'data-rango-cual': cual || 'rango',
      style: 'cursor:' + (horiz ? 'ew-resize' : 'ns-resize')
    }));
  }

  // ==========================================================================
  // RÓTULOS DEL ABANICO (19-ago) — la distancia que recorre la distribución, EN
  // PANTALLA y EDITABLE ahí mismo (pedido del usuario). Tres gestos sobre el mismo
  // rótulo, y ninguno inventa un dato nuevo:
  //   · hover → se ilumina (CSS .te-rango-lengrp:hover): es un objetivo, no un letrero.
  //   · clic  → input inline (el MISMO editor del "@N", generalizado).
  //   · rueda → ±PASO_ARRASTRE_CM (1 cm), el paso de todos los arrastres del editor.
  // El número se DERIVA de from/to en cada repintado (_largoRango), así que el
  // rótulo y el campo del panel no pueden decir cosas distintas.
  // ==========================================================================
  var ROT_CHAR = 5.1, ROT_H = 11;             // ancho por carácter y alto de la caja

  function _anchoRotulo(txt) { return txt.length * ROT_CHAR + 6; }

  // Caja + texto de un rótulo del abanico, agrupados en un <g> para que el hover
  // ilumine LOS DOS (con el rect y el texto sueltos, pasar por encima del número
  // dejaba el fondo apagado y el realce se leía a medias).
  function _cajaRotulo(svg, txt, bx, by, clase, attrs, titulo, sfx) {
    var w = _anchoRotulo(txt), k;
    var g = _svgEl('g', { 'class': clase + 'grp' });
    var aR = { 'class': clase + 'bg' + (sfx || ''), x: bx, y: by, width: w, height: ROT_H, rx: 2 };
    var aT = { 'class': clase + (sfx || ''), x: bx + w / 2, y: by + ROT_H - 3, 'text-anchor': 'middle' };
    for (k in attrs) if (attrs.hasOwnProperty(k)) { aR[k] = attrs[k]; aT[k] = attrs[k]; }
    // El <title> va PRIMERO: el SVG pide que sea el primer hijo de su padre para que
    // el tooltip valga para todo el grupo (caja y número), no sólo para un trozo.
    if (titulo) g.appendChild(_svgEl('title', {})).textContent = titulo;
    g.appendChild(_svgEl('rect', aR));
    g.appendChild(_svgEl('text', aT)).textContent = txt;
    svg.appendChild(g);
    return w;
  }

  // Rótulo del LARGO de una línea de reparto.
  //   horizontal → CENTRADO SOBRE LA LÍNEA, con caja opaca que interrumpe el trazo
  //     (una cota de plano de toda la vida). Arriba NO cabe: la .te-vtitle llega
  //     hasta ~27 del viewBox y por eso la flecha vive en 34; abajo están los "@N".
  //   vertical   → a la IZQUIERDA de la línea (los "@N" van a la derecha).
  // Le cuesta al rect de arrastre unas 21 unidades de viewBox en el centro del
  // abanico (de ~500 en un rango completo): el resto del tramo central sigue
  // desplazando el rango, y los DIVISORES se dibujan DESPUÉS → quedan encima y no
  // pierden ni un píxel de su tirador.
  // En la flecha PREVIEW (distribución inactiva) el rótulo NO recibe puntero: ahí el
  // único gesto que vale es arrastrar para ACTIVAR, y un rótulo clicable se lo comería.
  // `a`/`b` son los dos extremos de la flecha en px del viewBox y `fija` la
  // coordenada perpendicular (la línea). El rótulo se centra en el trozo VISIBLE del
  // abanico, no en su punto medio: con zoom media flecha se va fuera del cuadrante y
  // el número quedaba fuera de pantalla justo cuando el usuario se acercó a leerlo.
  // Si no se ve nada de la flecha, no se dibuja (un número suelto en el borde de una
  // vista donde no hay flecha no se entiende).
  // DEVUELVE la caja que ocupó ({x0,x1,y0,y1} en px del viewBox) o null: las cotas
  // vivas del arrastre (20-ago) comparten renglón con ella y la esquivan con ese
  // rect. Con un umbral fijo no alcanzaba — la caja se MUEVE (se sale de la flecha
  // en rangos cortos), así que el único dato que no miente es dónde quedó.
  function _rotuloLargoRango(g, rango, cual, eje, activa, horiz, a, b, fija, VW, VH, sfx) {
    var txt = String(Math.round(_largoRango(rango)));
    var w = _anchoRotulo(txt);
    var lim = horiz ? VW : VH;
    var lo = Math.max(Math.min(a, b), 0), hi = Math.min(Math.max(a, b), lim);
    if (hi - lo < 4) return null;
    var med = (lo + hi) / 2, bx, by;
    if (horiz) {
      // ENCAJE (defecto de auditoría, 19-ago). La caja va SOBRE la línea, así que con
      // un rango corto es MÁS ANCHA que la flecha y tapaba LOS DOS handles y el rect
      // de arrastre: medido a 0.93 u/cm, un rango de 20 cm deja los handles en
      // [63.8, 70.8] y [82.5, 89.5] y la caja en [68.6, 84.8] — el abanico quedaba
      // inarrastrable, y con la rueda del propio rótulo se llega ahí sin querer.
      // Por debajo de w+16 unidades (los 7+7 de los dos handles más aire) el rótulo
      // SE SALE de la flecha y se pone al lado, que es lo que hace cualquier cota
      // apretada en un plano.
      if (hi - lo >= w + 16) bx = med - w / 2;
      else if (hi + 4 + w <= VW - 1) bx = hi + 4;       // pasada la punta de la flecha
      else bx = lo - 4 - w;                             // …o antes del otro extremo
      bx = Math.max(1, Math.min(bx, VW - w - 1));
      by = fija - ROT_H / 2;
    } else {
      // a la IZQUIERDA de la línea, y si el número es largo (elementos de 4 cifras)
      // se pega al borde del cuadrante antes que salirse y quedar cortado.
      bx = Math.max(1, fija - 8 - w);
      by = Math.max(1, Math.min(med - ROT_H / 2, VH - ROT_H - 1));
    }
    _cajaRotulo(g, txt, bx, by, 'te-rango-len',
      // `data-rango-eje` NO es decoración: lo leen el clic y la rueda para pasárselo a
      // _setLargoRango, que es el único escritor de from/to que no lo recibía.
      activa ? { 'data-rango-len': cual, 'data-rango-eje': eje } : { 'pointer-events': 'none' },
      activa
        ? 'Distancia que recorre la distribución (cm). Clic para escribirla, rueda = ±' +
          PASO_ARRASTRE_CM + ' cm. Se mueve el extremo final; la cantidad la recalcula el motor con el mismo @.'
        : 'Distancia del rango por defecto (cm). Arrastra la flecha para activar la distribución.',
      sfx);
    return { x0: bx, x1: bx + w, y0: by, y1: by + ROT_H };
  }

  // ==========================================================================
  // COTAS VIVAS DEL ARRASTRE (20-ago) — «un poco como lo hace Revit»
  // --------------------------------------------------------------------------
  // Mientras se ARRASTRA una línea de reparto (los dos extremos, el rango entero,
  // un divisor de tramo, y lo mismo en la 2ª línea), cada extremo dice EN VIVO a
  // cuánto quedó de su referencia, con una línea de extensión que llega hasta esa
  // referencia. El LARGO del abanico no se duplica acá: ya lo dice
  // _rotuloLargoRango, que se redibuja en el mismo rAF del arrastre y por lo tanto
  // también va en vivo — y además es CLICABLE (se edita a mano). Un solo rótulo
  // que fuera a la vez control editable y lectura efímera dejaría ambiguo qué se
  // edita al clicarlo.
  //
  // EL NÚMERO ES EL DEL ANCLAJE, NO UNO PROPIO. Se lo pide a `reglas.anclarRango`,
  // la MISMA función que _anclarRangoUI usa para escribir rango.ancla al arrastrar.
  // La cota anterior medía siempre `from` contra el borde − y `to` contra el +, y
  // eso se contradice con lo que el editor guarda en cuanto el punto pasa la mitad
  // del elemento: en una viga de 600 con el rango 100→260, el ancla del `from` es
  // {max, 200} y la cota decía 400. Peor con el rango al revés (to < from):
  // 260→−260 anclaba {max,40}/{min,40} y la cota mostraba 560 y 560.
  //
  // COSTE: el arrastre dispara decenas de eventos por segundo, así que se midió.
  // Headless sobre la viga-semilla (72 placements), 20.000 pasadas de
  // _dibujarFlechaRango: 0.5857 ms sin cotas · 0.5899 ms con cotas = 4.2 µs de
  // helper, el 0.025% de los 16.7 ms de un frame a 60 fps. No hace falta cachear
  // nada (y cachear el ancla sería justo la copia de dato que este helper evita).
  // ==========================================================================
  // Ancho aproximado por carácter de .te-rango-cota (10 px, bold). ROT_CHAR (5.1)
  // es el de los rótulos de 9 px; escalado a 10 px da 5.7. Sólo se usa para ENCAJAR
  // el número en su trecho, no para dibujarlo.
  var COTA_VIVA_CHAR = 5.7, COTA_VIVA_MED = 5.5;   // medio alto de la caja de texto

  // ¿Se está arrastrando ESTA línea de la selección? (from/to, el rango entero o un
  // divisor: los cuatro tiradores escriben en la misma línea y todos merecen cota).
  function _arrastrandoLinea(cual) {
    var dr = ST.dragRango;
    return !!(dr && dr.ci === ST.selCi && (dr.cual || 'rango') === cual);
  }

  // ANCLA de UN punto sobre un eje, para la COTA VIVA — la fórmula del motor, sin una
  // propia: `anclaDeCoord` es la misma que escribe el ancla real al arrastrar.
  //
  // POR QUÉ SIN RECUBRIMIENTO (19-ago). El ancla de un rango se mide desde la LÍNEA DE
  // RECUBRIMIENTO, para que cambiar el recub mueva el abanico. Pero lo que el usuario
  // pidió VER mientras arrastra una distribución es el hueco contra el HORMIGÓN
  // («para las cortinas está bien que sea al hormigón»; al recubrimiento es sólo el
  // tirador que redimensiona la barra). Los dos números difieren exactamente en el
  // recub, y la línea de extensión termina donde el número dice, así que el dibujo
  // sigue siendo la verificación del número.
  function _anclaViva(coord, eje) {
    var dp = _deps();
    var c = Number(coord);
    if (!isFinite(c) || !dp.reglas || typeof dp.reglas.anclaDeCoord !== 'function') return null;
    var g = _hostDeReceta(); if (!g) return null;
    var D = (eje === 'y') ? Number(g.alto) : (eje === 'z') ? Number(g.ancho) : Number(g.largo);
    return dp.reglas.anclaDeCoord(c, D);
  }

  // Coordenada de la REFERENCIA que eligió el ancla, deducida del ancla mismo:
  //   'min' → coord − d   ·   'max' → coord + d
  // No se vuelve a pedir la dimensión del host: la línea de extensión termina donde
  // el número dice que termina, así que el dibujo es la verificación del número (si
  // alguna vez discreparan, la línea se pasaría del borde a la vista).
  // SÓLO HAY DOS REFERENCIAS (21-ago): el 'centro' se retiró del anclaje, y una ref
  // desconocida devuelve null (sin cota) en vez de dibujar una línea al origen que
  // no corresponde a ningún borde.
  function _coordRefAncla(a, coord) {
    if (!a) return null;
    if (a.ref === 'min') return Number(coord) - Number(a.d);
    if (a.ref === 'max') return Number(coord) + Number(a.d);
    return null;
  }

  function _solapa(r1, r2) {
    return !!(r1 && r2 && r1.x0 < r2.x1 && r1.x1 > r2.x0 && r1.y0 < r2.y1 && r1.y1 > r2.y0);
  }

  // Cota viva de UN extremo. `P` proyecta la coordenada del eje a px del viewBox y
  // `fija` es la línea de la flecha. `obst` son las cajas ya ocupadas (el rótulo del
  // largo y la cota del otro extremo). Devuelve la caja que ocupó, o null.
  function _cotaVivaExtremo(g, coord, eje, horiz, P, fija, VW, VH, obst) {
    var a = _anclaViva(coord, eje);
    var ref = _coordRefAncla(a, coord);
    if (ref == null || !isFinite(ref)) return null;
    return _cotaEntre(g, P(Number(coord)), P(ref), String(Math.round(Number(a.d))),
      horiz, fija, VW, VH, obst, a.ref);
  }

  // EL DIBUJO de una cota viva, ya en píxeles: trecho del punto (`p0`) a su
  // referencia (`p1`), tick en la punta y el número encajado en ese trecho.
  // Está separado del CÁLCULO porque las dos etapas lo comparten: la del abanico
  // mide contra el ancla del rango y la de la pieza contra la cara del hormigón
  // (ver _cotasVivasPieza), pero se dibujan igual — y un segundo dibujo copiado
  // divergiría en el primer ajuste de encaje.
  function _cotaEntre(g, p0, p1, txt, horiz, fija, VW, VH, obst, marca) {
    if (!isFinite(p0) || !isFinite(p1) || !isFinite(fija)) return null;
    var lim = horiz ? VW : VH;
    // Ni el punto ni su referencia entran en el cuadrante: no se dibuja (misma
    // regla que el rótulo del largo — un número suelto en el borde no se entiende).
    if (Math.max(p0, p1) < 1 || Math.min(p0, p1) > lim - 1) return null;
    txt = String(txt);
    var w = txt.length * COTA_VIVA_CHAR;
    var sgn = (p1 >= p0) ? 1 : -1;
    var m = (p0 + p1) / 2;
    // El trecho no da para el número (extremo pegado a su referencia): se sale por
    // fuera de la referencia en vez de encimarse a la línea de extensión.
    if (Math.abs(p1 - p0) < w + 6) m = p1 + sgn * (w / 2 + 5);
    // ESQUIVAR lo que ya está dibujado en el mismo renglón. Se corre a lo largo del
    // eje de la flecha (la única dirección libre: arriba está el título de la vista,
    // que llega hasta ~27 del viewBox, y abajo los "@N" de los tramos).
    for (var k = 0; k < 3; k++) {
      var caja = _cajaCota(m, w, horiz, fija);
      var choque = null;
      for (var i = 0; i < obst.length; i++) if (_solapa(caja, obst[i])) { choque = obst[i]; break; }
      if (!choque) break;
      var lo = horiz ? choque.x0 : choque.y0, hi = horiz ? choque.x1 : choque.y1;
      m = (sgn > 0) ? Math.max(m, hi + w / 2 + 3) : Math.min(m, lo - w / 2 - 3);
    }
    m = Math.max(w / 2 + 1, Math.min(m, lim - w / 2 - 1));
    // Línea de extensión + tick en cada punta (una cota de plano de toda la vida).
    // Va ANTES del texto: el halo blanco de .te-rango-cota la borra por detrás del
    // número, que es exactamente el efecto que se busca.
    var T = 3;
    if (horiz) {
      g.appendChild(_svgEl('line', { 'class': 'te-rango-cotaL', x1: p0, y1: fija, x2: p1, y2: fija }));
      g.appendChild(_svgEl('line', { 'class': 'te-rango-cotaL', x1: p1, y1: fija - T, x2: p1, y2: fija + T }));
    } else {
      g.appendChild(_svgEl('line', { 'class': 'te-rango-cotaL', x1: fija, y1: p0, x2: fija, y2: p1 }));
      g.appendChild(_svgEl('line', { 'class': 'te-rango-cotaL', x1: fija - T, y1: p1, x2: fija + T, y2: p1 }));
    }
    var t = _svgEl('text', {
      'class': 'te-rango-cota', 'text-anchor': 'middle',
      x: horiz ? m : (fija + 7 + w / 2), y: (horiz ? fija : m) + 3.5,
      'data-cota-viva': (marca || '')
    });
    t.textContent = txt;
    g.appendChild(t);
    return _cajaCota(m, w, horiz, fija);
  }

  function _cajaCota(m, w, horiz, fija) {
    if (horiz) return { x0: m - w / 2, x1: m + w / 2, y0: fija - COTA_VIVA_MED, y1: fija + COTA_VIVA_MED };
    return { x0: fija + 7, x1: fija + 7 + w, y0: m - COTA_VIVA_MED, y1: m + COTA_VIVA_MED };
  }

  // Las DOS cotas de una línea. `cajaLen` es la del rótulo del largo (o null).
  function _cotasVivas(g, rango, eje, horiz, P, fija, VW, VH, cajaLen) {
    if (!rango || rango.from == null || rango.to == null) return;
    var obst = cajaLen ? [cajaLen] : [];
    var b = _cotaVivaExtremo(g, rango.from, eje, horiz, P, fija, VW, VH, obst);
    if (b) obst.push(b);
    _cotaVivaExtremo(g, rango.to, eje, horiz, P, fija, VW, VH, obst);
  }

  // ==========================================================================
  // COTAS VIVAS DE LA PIEZA (etapa 2, 20-ago) — mover y redimensionar
  // --------------------------------------------------------------------------
  // MOVER (ST.dragMove): los DOS huecos que la pieza deja contra el hormigón en
  //   cada eje que la vista controla. Los dos, no "el más cercano": al mover hacia
  //   un lado uno crece y el otro se achica, y un número que salta de cara al
  //   cruzar la mitad no se puede leer con la mano ocupada.
  // REDIMENSIONAR (ST.dragMarco): el hueco del borde que se está estirando, y
  //   nada más — los otros tres no cambian y serían ruido. La MEDIDA del lado la
  //   pone _dibujarCotasLados, el mismo layer del gate SHIFT, encendido mientras
  //   dura el arrastre: es exactamente «la medida resultante del lado que se está
  //   cambiando» y ya está escrito, encajado y probado (test_cotas_lados.js).
  //
  // CONTRA QUÉ SE MIDE (21-ago, pedido del usuario: «tengo la duda de si es más
  // conveniente que lo muestre hacia el recubrimiento o hacia el hormigón… podemos
  // hacer el cambio al recubrimiento, pero sería solamente para cuando redimensiono
  // una barra; para las cortinas está bien que sea al hormigón»):
  //   · REDIMENSIONAR → la LÍNEA DE RECUBRIMIENTO. Estirar una barra es decidir
  //     hasta dónde llega el fierro, y el límite no es el borde del hormigón sino el
  //     recubrimiento: el número dice cuánto queda antes de pasarse. Si la barra ya
  //     lo invadió sale NEGATIVO, con su signo — es lo que hay, y es más útil que un
  //     número positivo al hormigón que no avisa de nada (una barra puede estar
  //     dentro del hormigón y aun así fuera de norma).
  //     DOS PRECISIONES para leer el número: (1) se mide al BORDE del acero, no al
  //     eje (23-ago: los puntos son el eje y hasta entonces una pieza tangente al
  //     recubrimiento marcaba φ/2 en vez de 0 — ver _acumBordeTramo); (2) es el
  //     recubrimiento del HORMIGÓN, pelado — una barra de nivel 2 se ancla además
  //     detrás de la pila de su cara (0.8 cm tras un estribo φ8), así que su margen
  //     real es ese tanto menor. La línea que se rotula es la de la norma, que es la
  //     que el usuario pidió ver.
  //   · MOVER (y los abanicos de la distribución) → el HORMIGÓN, como hasta hoy.
  //
  // EL NÚMERO NO SALE DEL ANCLAJE, y es a propósito: es el hueco REAL entre el bbox
  // de la pieza y la cara, que es lo que se comprueba con el ojo y lo que se fabrica.
  // Desde el 21-ago el ancla del `pos_hint` guarda la POSICIÓN (ver reglas.js) y ya
  // no lo contradice —la 101A del ejemplo declara «15.2 cm PASADA la cara superior»,
  // que es exactamente el −15 que se dibuja—, pero el hueco se sigue midiendo sobre
  // el bbox: es el mismo que ya calculó el marco de selección (no se recorre la
  // geometría dos veces) y sirve igual para mover que para estirar.
  //
  // COSTE medido en headless sobre la viga-semilla (72 placements, 20.000 pasadas):
  // 0.030 ms moviendo (4 huecos) y 0.007 ms estirando (1 hueco) por vista, más
  // 0.052 ms de _dibujarCotasLados. Por frame (3 cuadrantes) son 0.09 y 0.18 ms
  // contra los 3.6 ms que cuesta generarViga en ese mismo frame: el arrastre no lo
  // nota. Por eso no se cachea nada.
  // ==========================================================================
  function _cotasVivasPieza(svg, plano, X, Y, VW, VH, b) {
    var def = (_defsPlanos() || {})[plano]; if (!def || !b) return;
    var marco = ST.dragMarco;
    // EL BORDE DEL ACERO en ejes del mundo (23-ago). `b` viene del marco de selección,
    // que recorre los PUNTOS (= el eje de la barra); la ficha ya mide al borde, y las
    // dos cosas se miran a la vez. Es una pasada más sobre el mismo generado
    // (0.01 ms en la viga-semilla, contra los 3.6 ms de generarViga del mismo frame).
    // Sin bbox —un `out` que no sea ST.ultimoOut— se cae al proyectado de siempre.
    var bbB = _bboxCompMundo(ST.selCi);
    // QUÉ EJES SE ROTULAN. Redimensionando: sólo el borde que la mano arrastra.
    // Moviendo: los dos ejes que la vista controla (el arrastre toca los dos).
    var filas = marco
      ? [{ eje: (marco.eje === 'u') ? def.u : def.v, horiz: (marco.eje === 'u'), lado: marco.ladoUV }]
      : [{ eje: def.u, horiz: true, lado: null }, { eje: def.v, horiz: false, lado: null }];
    var g = _svgEl('g', {}), n = 0;
    for (var i = 0; i < filas.length; i++) {
      var f = filas[i];
      var caras = _facesEje(f.eje);                  // [−dim/2, +dim/2, …] del eje
      if (!caras || caras.length < 2) continue;
      // Contra qué se mide: recubrimiento estirando, hormigón moviendo (ver arriba).
      var lim = marco ? _lineasRecubEje(f.eje)
        : { lo: Math.min(caras[0], caras[1]), hi: Math.max(caras[0], caras[1]) };
      var loW = lim.lo, hiW = lim.hi;
      var a0 = f.horiz ? Math.min(b.u0, b.u1) : Math.min(b.v0, b.v1);
      var a1 = f.horiz ? Math.max(b.u0, b.u1) : Math.max(b.v0, b.v1);
      if (bbB && bbB[f.eje]) { a0 = bbB[f.eje].loB; a1 = bbB[f.eje].hiB; }
      var P = f.horiz ? X : Y;
      // La cota corre por el MEDIO de la pieza en el eje perpendicular (como una
      // cota temporal de Revit): el trecho queda FUERA del bbox, así que la línea
      // no cruza el dibujo de la barra — sólo el número cae en el hueco.
      var q0 = f.horiz ? Y(b.v0) : X(b.u0), q1 = f.horiz ? Y(b.v1) : X(b.u1);
      var fija = Math.max(12, Math.min((q0 + q1) / 2, (f.horiz ? VH : VW) - 4));
      var obst = [];
      // Los dos huecos (o sólo el del borde arrastrado). Un hueco NEGATIVO se
      // escribe con su signo: la barra se pasó de la línea contra la que se mide y
      // eso se dice, no se tapa (el aviso del motor ya lo repite con el mismo
      // número cuando además sale del hormigón).
      if (f.lado !== '+') {
        var c1 = _cotaEntre(g, P(a0), P(loW), String(Math.round(a0 - loW)), f.horiz, fija, VW, VH, obst, 'pieza');
        if (c1) { obst.push(c1); n++; }
      }
      if (f.lado !== '-') {
        var c2 = _cotaEntre(g, P(a1), P(hiW), String(Math.round(hiW - a1)), f.horiz, fija, VW, VH, obst, 'pieza');
        if (c2) { obst.push(c2); n++; }
      }
    }
    if (n) svg.appendChild(g);
  }

  // ¿Hay un arrastre de PIEZA en curso sobre la selección? `pushed` = ya hubo
  // movimiento real: un simple clic para seleccionar deja ST.dragMove armado y sin
  // esto haría parpadear las cotas sin que nada se haya movido.
  function _arrastrandoPieza() {
    var dm = ST.dragMove || ST.dragMarco;
    return !!(dm && dm.pushed && dm.ci === ST.selCi);
  }

  // Rótulos de UN tramo: [largo][@], pegados, en la misma fila — así no hay dos
  // cajas peleando por el mismo sitio cuando el tramo es corto.
  function _etiquetaAt(svg, sep, idx, x, y, horiz, plano, largo, trechoPx) {
    var tAt = '@' + (Math.round(Number(sep) * 10) / 10);
    var wAt = _anchoRotulo(tAt);
    var tLen = (largo != null) ? String(Math.round(Number(largo))) : null;
    var wLen = tLen ? _anchoRotulo(tLen) : 0;
    // ENCAJE (defecto de auditoría 19-ago): la pareja mide el DOBLE que el "@N" solo,
    // así que en tramos cortos los rótulos de dos tramos vecinos se pisan y queda un
    // borrón que no se lee ni corrige nada. Si no cabe, se cae el LARGO y queda el
    // "@N" de siempre — el largo sigue estando en el panel y en el rótulo del abanico.
    // Horizontal: la pareja corre A LO LARGO del tramo. Vertical: va al costado, así
    // que lo que aprieta es el ALTO de la caja contra el trecho del tramo.
    if (tLen && trechoPx != null && trechoPx < (horiz ? (wLen + 2 + wAt + 4) : (ROT_H + 2))) {
      tLen = null; wLen = 0;
    }
    var hueco = tLen ? 2 : 0;
    var W = wLen + hueco + wAt;
    // La pareja va DEBAJO de la flecha horizontal (arriba está la .te-vtitle de la
    // vista, que llega hasta ~27 del viewBox y se la comería) y a la DERECHA de la
    // vertical. Se dibuja después del rect de arrastre → queda clicable.
    var bx = horiz ? (x - W / 2) : (x + 6);
    var by = horiz ? (y + 6) : (y - ROT_H / 2);
    if (tLen) {
      _cajaRotulo(svg, tLen, bx, by, 'te-rango-len',
        { 'data-rango-tlen': idx, 'data-plano': plano },
        'Largo del tramo ' + (idx + 1) + ' (cm). Clic para escribirlo, rueda = ±' + PASO_ARRASTRE_CM +
        ' cm. Mueve el límite con el tramo vecino: el rango NO cambia de largo.');
    }
    _cajaRotulo(svg, tAt, bx + wLen + hueco, by, 'te-rango-at',
      { 'data-rango-at': idx, 'data-plano': plano },
      'Espaciamiento del tramo ' + (idx + 1) + ' (cm, mínimo ' + SEP_MIN + '). Clic para escribirlo.');
  }

  // INPUT INLINE de los rótulos del abanico ("@N", el largo del rango, el largo de un
  // tramo) — un <input> HTML flotando sobre el cuadrante (la .te-vista es
  // position:relative), no un <foreignObject>: así hereda el estilo del modal, el foco
  // y el teclado sin rarezas de SVG. Se confirma con Enter o al perder el foco; Esc
  // cancela. ES UNO SOLO para los tres rótulos: con un editor por rótulo, el capeo,
  // el Esc y el "no me robes el pan/zoom del cuadrante" quedarían a medias en alguno.
  //   cfg = { valor, min, titulo, valido(v), msgMal, aplicar(v) }
  var _atEditEl = null, _atEditCerrar = null;
  // `aplicando` = se está abriendo OTRO rótulo con este todavía escrito. Sacar el
  // <input> del DOM NO dispara blur en Chrome, y el mousedown del rótulo nuevo hace
  // preventDefault antes del cambio de foco: lo tecleado se perdía en silencio
  // (defecto de auditoría 19-ago — con tres rótulos, saltar de uno a otro es lo
  // normal). Se cierra CONFIRMANDO, que es lo que el usuario cree que pasó.
  function _cerrarEditorAt(aplicando) {
    var f = _atEditCerrar;
    _atEditCerrar = null;
    if (aplicando && f) { f(true); return; }   // f() vuelve acá sin `aplicando` y limpia
    var el = _atEditEl; _atEditEl = null;
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  function _abrirEditorNum(svg, evt, cfg) {
    _cerrarEditorAt(true);
    var vista = svg.closest ? svg.closest('.te-vista') : null; if (!vista) return;
    var rv = vista.getBoundingClientRect();
    var inp = document.createElement('input');
    inp.type = 'number'; inp.className = 'te-atedit'; inp.value = cfg.valor;
    if (cfg.min != null) inp.min = cfg.min;
    inp.step = 'any';
    inp.title = cfg.titulo || '';
    inp.style.left = Math.max(2, Math.round(evt.clientX - rv.left - 24)) + 'px';
    inp.style.top = Math.max(2, Math.round(evt.clientY - rv.top - 9)) + 'px';
    var cerrado = false;
    // ¿el valor tecleado pasa el capeo? Si no: borde rojo + status y NO se aplica.
    function _valOk() {
      var v = Number(inp.value);
      if (isFinite(v) && (!cfg.valido || cfg.valido(v))) { inp.classList.remove('bad'); return true; }
      inp.classList.add('bad');
      _actualizarStatus(cfg.msgMal || 'Valor rechazado.');
      return false;
    }
    function cerrar(guardar) {
      if (cerrado) return;
      if (guardar && !_valOk()) guardar = false;   // se cierra igual (no atrapa el foco)
      cerrado = true;
      var v = Number(inp.value);
      _cerrarEditorAt();
      if (guardar) cfg.aplicar(v);
    }
    inp.addEventListener('keydown', function (e) {
      e.stopPropagation();                       // Supr/Esc del editor no borran la barra
      // Enter con un valor inválido NO cierra: marca en rojo y deja corregir en el sitio.
      if (e.key === 'Enter') { e.preventDefault(); if (_valOk()) cerrar(true); }
      else if (e.key === 'Escape') { e.preventDefault(); cerrar(false); }
    });
    inp.addEventListener('blur', function () { cerrar(true); });
    ['mousedown', 'click', 'wheel'].forEach(function (ev) {
      inp.addEventListener(ev, function (e) { e.stopPropagation(); });   // no pan/zoom del cuadrante
    });
    vista.appendChild(inp);
    _atEditEl = inp; _atEditCerrar = cerrar;
    inp.focus(); inp.select();
  }

  // La distribución del componente SELECCIONADO: los rótulos del abanico son suyos y
  // se dibujan sólo para él (_dibujarFlechaRango arranca con ST.selCi).
  function _distSel() {
    if (ST.selCi < 0 || !ST.receta) return null;
    var c = ST.receta.componentes[ST.selCi];
    return (c && c.distribucion) ? c.distribucion : null;
  }

  // "@N" de un tramo: sólo toca el @ de ESE tramo; el resto del reparto no se mueve.
  function _abrirEditorAt(plano, svg, idx, evt) {
    var d = _distSel(); if (!d || !d.rango) return;
    var arr = _tramosDe(d); if (!arr[idx]) return;
    _abrirEditorNum(svg, evt, {
      valor: arr[idx].sep, min: SEP_MIN,
      titulo: 'Espaciamiento del tramo ' + (idx + 1) + ' (cm, mínimo ' + SEP_MIN + ')',
      valido: function (v) { return v >= SEP_MIN; },
      msgMal: '@ mínimo ' + SEP_MIN + ' cm: valor rechazado.',
      aplicar: function (v) {
        var a = _tramosDe(d);
        if (!a[idx] || a[idx].sep === v) return;
        _pushUndo();
        a[idx].sep = v;
        _setTramos(d, a);
        _regenerar(); _renderPanel();
      }
    });
  }

  // LARGO DEL ABANICO — la distancia que recorre la distribución. Se mueve el extremo
  // final y el motor recalcula la cantidad con el mismo @ (ver _setLargoRango).
  function _abrirEditorLargo(plano, svg, cual, evt, eje) {
    var d = _distSel(); if (!d || !d[cual]) return;
    _abrirEditorNum(svg, evt, {
      valor: Math.round(_largoRango(d[cual])), min: 0,
      titulo: 'Distancia que recorre la distribución (cm). Se mueve el extremo final; ' +
              'la cantidad la recalcula el motor con el mismo @.',
      valido: function (v) { return v >= 0; },
      msgMal: 'El largo de un rango no puede ser negativo: valor rechazado.',
      aplicar: function (v) {
        if (Math.abs(v - _largoRango(d[cual])) < 1e-9) return;
        _pushUndo();
        if (_setLargoRango(d, cual, v, eje)) { _regenerar(); _renderPanel(); }
      }
    });
  }

  // LARGO DE UN TRAMO (nodo múltiple) — mueve su límite con el vecino: el PAR conserva
  // su largo total, así que el rango no cambia y los demás tramos no se enteran.
  function _abrirEditorLargoTramo(plano, svg, idx, evt) {
    var d = _distSel(); if (!d || !d.rango) return;
    var arr = _tramosDe(d); if (!arr[idx] || arr.length < 2) return;
    _abrirEditorNum(svg, evt, {
      valor: Math.round(arr[idx].long), min: 0,
      titulo: 'Largo del tramo ' + (idx + 1) + ' (cm). El vecino compensa: el rango no cambia de largo.',
      valido: function (v) { return v >= 0; },
      msgMal: 'El largo de un tramo no puede ser negativo: valor rechazado.',
      aplicar: function (v) {
        var a = _tramosDe(d);
        if (!a[idx] || Math.abs(a[idx].long - v) < 1e-9) return;
        var j = (idx + 1 < a.length) ? idx + 1 : idx - 1;
        var par = a[idx].long + ((a[j] && a[j].long) || 0);
        _pushUndo();
        _setLongTramo(d, idx, v);
        // TOPA Y AVISA CON EL NÚMERO (defecto de auditoría 19-ago): el PAR conserva su
        // largo total, así que un tramo no puede pasar de la suma de los dos. Antes se
        // topaba en silencio y el usuario veía otro número del que escribió.
        if (v > par + 1e-9) {
          _actualizarStatus('El tramo ' + (idx + 1) + ' y su vecino suman ' + _cm(par) +
            ' cm: ' + _cm(v) + ' no cabe, se topó en ' + _cm(par) + '.');
        }
        _regenerar(); _renderPanel();
      }
    });
  }

  // RUEDA SOBRE UN RÓTULO DE LARGO = ±PASO_ARRASTRE_CM, el mismo paso de todos los
  // arrastres del editor ("no fabricamos al milímetro, fabricamos al centímetro").
  // LA RUEDA DEL CUADRANTE ES EL ZOOM y vive en el .te-vista, al que le llega por
  // burbujeo desde el SVG: acá se corta la burbuja SÓLO cuando el cursor está encima
  // de un rótulo editable. En cualquier otro punto de la vista el zoom queda intacto.
  // Con SHIFT no hace nada: con shift el cuadrante es de MIRAR (mismo criterio que el
  // mousedown, que también se filtra completo).
  // El valor se lleva PRIMERO al paso (_enPaso) para que la rueda aterrice en el mismo
  // número que muestra el rótulo: un largo con decimales (tramo elástico repartido)
  // sumado a 1 daría 592.4 → 593.4 y el rótulo, que redondea, saltaría de 592 a 593.
  var _ruedaUndoT = 0;
  function _enPaso(v) { return Math.round(Number(v) / PASO_ARRASTRE_CM) * PASO_ARRASTRE_CM; }
  function _ruedaRotulo(plano, svg, evt) {
    if (evt.shiftKey) return;
    var t = evt.target; if (!t || !t.getAttribute) return;
    var cual = t.getAttribute('data-rango-len');
    var tl = t.getAttribute('data-rango-tlen');
    if (cual == null && tl == null) return;      // no es un rótulo: que la rueda haga zoom
    var d = _distSel(); if (!d) return;
    // Rótulo HUÉRFANO (la línea que rotulaba ya no existe): no se toca el evento, así
    // la rueda sigue siendo el zoom en vez de quedar muerta sobre un número viejo.
    if (cual != null && !d[cual]) return;
    // Un evento SIN deltaY vertical (rueda horizontal, trackpad de lado) no es un
    // gesto de "sube/baja": si se tomara igual, rozar el rótulo de costado sumaría
    // un centímetro que nadie pidió. Se deja pasar y el zoom tampoco hace nada con él.
    var dy = Number(evt.deltaY) || 0;
    if (!dy) return;
    evt.preventDefault(); evt.stopPropagation();
    var paso = (dy > 0 ? -1 : 1) * PASO_ARRASTRE_CM;
    // SE CALCULA EL VALOR NUEVO ANTES DE APILAR EL UNDO: seguir dando vueltas contra
    // el piso (largo 0) no puede llenar la pila de deshacer con pasos que no movieron
    // nada. Sólo se apila cuando el número VA a cambiar. Ojo: contra el piso el evento
    // YA se consumió y eso es a propósito — con el cursor sobre un rótulo la rueda es
    // del rótulo, y ponerse a hacer zoom porque el valor tocó fondo sería un salto
    // que el usuario no pidió.
    var idx = -1, nuevo = 0, a;
    if (cual != null) {
      nuevo = _enPaso(_largoRango(d[cual])) + paso;
      if (nuevo < 0 || Math.abs(nuevo - _largoRango(d[cual])) < 1e-9) return;
    } else {
      idx = Number(tl); a = _tramosDe(d);
      if (!a[idx] || a.length < 2) return;
      nuevo = Math.max(0, _enPaso(a[idx].long) + paso);
      if (Math.abs(nuevo - a[idx].long) < 1e-9) return;
    }
    // UN GESTO DE RUEDA = UN SOLO UNDO. Sin esto, deshacer un ajuste de 20 cm costaría
    // veinte Ctrl+Z y la pila (acotada) se comería el resto del historial.
    var ahora = Date.now();
    if (ahora - _ruedaUndoT > 500) _pushUndo();
    _ruedaUndoT = ahora;
    if (cual != null) _setLargoRango(d, cual, nuevo, t.getAttribute('data-rango-eje'));
    else _setLongTramo(d, idx, nuevo);
    _mutDiferido();     // repinta el overlay (el rótulo) y el panel, coalescidos en un rAF
  }

  // Coordenada HOST bajo el cursor MEDIDA SOBRE EL EJE DE REPARTO (absoluta, no delta).
  // La usan el snap de los handles del rango y el arrastre de los divisores de tramo.
  function _hostEnEje(plano, sp, eje) {
    var uv = _pixelToUV(plano, sp.px, sp.py); if (!uv) return null;
    var def = (_defsPlanos() || {})[plano]; if (!def) return null;
    if (eje === def.u) return uv.u;
    if (eje === def.v) return uv.v;
    return null;
  }

  // NODOS de las 4 esquinas del hormigón (arrastrables → redimensiona el elemento).
  // TIRADORES DEL HORMIGÓN — UNO POR CARA, UNA DIMENSIÓN CADA UNO (fix 15-ago).
  // Antes eran las 4 ESQUINAS y cada una redimensionaba LAS DOS dimensiones del
  // plano a la vez: el usuario agarraba una punta y le cambiaban el ancho y el
  // alto juntos («se edita en un patrón que no entiendo, parece que en ambos
  // ejes»). Con un tirador por cara, agarrar el lado derecho cambia SOLO la
  // dimensión horizontal y el de arriba SOLO la vertical. El elemento sigue
  // centrado en el origen —así está definida la geometría—, así que la cara
  // opuesta acompaña; lo que se elige es QUÉ MEDIDA se toca, no qué borde.
  // (Los tiradores del HORMIGÓN murieron el 17-ago a pedido del usuario: las
  //  medidas del elemento se escriben exactas en el ribbon. El tirador que queda
  //  es el del MARCO DE LA BARRA seleccionada — ver _iniciarDragMarco.)
  function _redibujar2D(out) {
    var geo = ST.receta && ST.receta.geometria;
    _resaltarSeleccion3D();   // la selección cambió/persiste → sincronizar el realce 3D
    _dibujarVista2D($('te_svgSeccion'), out, 'seccion', geo);
    _dibujarVista2D($('te_svgLargo'),   out, 'largo',   geo);
    _dibujarVista2D($('te_svgPlanta'),  out, 'planta',  geo);
    // El botón contextual "Voltear plano (R)" se re-pega a la pieza tras redibujar
    // (los transforms de cada vista quedaron frescos arriba → posición exacta).
    _posicionarFlipBtn();
    // LAS BANDAS DEL ESPEJO SE REPINTAN CON LA VISTA (25-ago, reportado: «el botón
    // del scroll para panear eliminó las ayudas visuales, pero la función seguía
    // activa»). Dibujar la vista rehace el SVG entero, así que la capa del espejo se
    // iba con él y el modo quedaba encendido sin nada en pantalla — lo peor de los
    // dos mundos. Van acá y no en el handler del pan porque _redibujar2D es por donde
    // pasan TODOS los repintados (pan, zoom, maximizar, cambio de tema): cablearlo en
    // cada gesto habría dejado a los demás sin bandas igual que ahora. Además hace
    // falta: las bandas están en píxeles y el paneo mueve los píxeles.
    if (ST.espejoPend) _pintarCarasEspejo();
  }

  // ==========================================================================
  // PIXEL ↔ HOST (inverso del transform de cada vista)
  // ==========================================================================
  // Devuelve la posición del click en el viewBox del SVG (coordenadas del svg).
  function _svgPoint(svg, evt) {
    var vb = (svg.getAttribute('viewBox') || '0 0 620 300').split(/\s+/).map(Number);
    var r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var VW = vb[2] || 620, VH = vb[3] || 300;
    // preserveAspectRatio xMidYMid meet → escala uniforme + centrado.
    var scale = Math.min(r.width / VW, r.height / VH);
    var padX = (r.width - VW * scale) / 2, padY = (r.height - VH * scale) / 2;
    var px = (evt.clientX - r.left - padX) / scale;
    var py = (evt.clientY - r.top - padY) / scale;
    return { px: px, py: py, VW: VW, VH: VH };
  }

  // (u,v) del plano desde pixel del viewBox usando el transform guardado.
  function _pixelToUV(plano, px, py) {
    var t = ST.transforms[plano];
    if (!t || !t.ku || !t.kv) return null;
    return { u: (px - t.cu) / t.ku, v: (py - t.cv) / t.kv };
  }

  // (u,v) del plano → punto host 3D (el eje ausente se deja en 0; el llamador lo ajusta).
  function _uvToHost(plano, u, v) {
    if (plano === 'seccion') return { x: 0, y: v, z: u };
    if (plano === 'largo')   return { x: u, y: v, z: 0 };
    return { x: u, y: 0, z: v };   // planta
  }

  // Snap de un valor host a las CARAS del hormigón o, si no hay ninguna cerca, al
  // PASO DEL ARRASTRE (si snap activo).
  // ORDEN: primero la cara, después el paso. Antes los dos competían por distancia y
  // eso funcionaba sólo porque el paso era GRUESO (5 cm): al bajarlo a 1 el candidato
  // del paso queda SIEMPRE a ≤0.5 cm y le ganaría a cualquier cara, o sea que el
  // "snap a nodos" del punto 4c (bordes, recubrimiento, centro) habría muerto en
  // silencio. Con la cara resuelta primero, el imán sigue vivo y el paso sólo manda
  // donde no hay nada a lo que pegarse.
  function _snapValor(val, faces) {
    if (!ST.snap) return val;
    var best = null, bestD = SNAP_CARA_CM;
    (faces || []).forEach(function (f) { var dd = Math.abs(val - f); if (dd < bestD) { bestD = dd; best = f; } });
    if (best != null) return best;
    return Math.round(val / PASO_ARRASTRE_CM) * PASO_ARRASTRE_CM;
  }

  // RECUBRIMIENTO de un eje, por borde. La convención es la del MOTOR (reglas
  // `_recubBordeEje`/`_recubDeCara`): en Y los dos bordes son caras distintas
  // (inf/sup), en Z manda `recub_lat`, y en X —los testeros— el usuario no declara
  // un recub propio, así que vale el VERTICAL (`recub_ext` si viniera, si no
  // `recub_sup`): es el mismo `anchorBase.recubExtremo` con el que el motor cierra
  // el eje longitudinal. Una segunda tabla acá diría otra cosa a la primera
  // geometría con recubrimientos distintos de los default.
  function _recubEje(eje, ref) {
    var g = ST.receta.geometria;
    if (eje === 'y') {
      var v = (ref === 'min') ? g.recub_inf : g.recub_sup;
      return Number(v != null ? v : 4);
    }
    if (eje === 'z') return Number(g.recub_lat != null ? g.recub_lat : 3);
    return Number(g.recub_ext != null ? g.recub_ext
      : (g.recub_sup != null ? g.recub_sup : 4));
  }

  // Línea del RECUBRIMIENTO de cada borde del eje (la "útil"), en coordenadas del
  // host. CUANDO EL RECUBRIMIENTO SE COME EL EJE ENTERO manda el hormigón: es la
  // MISMA regla del motor (`resolverRango`: «un elemento cuyo recubrimiento no deja
  // borde útil no tiene borde útil»), y sin ella los dos límites salen CRUZADOS.
  // Medido con ancho 5 y recub_lat 3: {lo: 0.5, hi: −0.5} → _rangoDefault devolvía
  // un rango invertido y la cota del tirador rotulaba los dos huecos con el signo
  // dado vuelta. En X es nuevo (antes el 4 cableado sólo cruzaba con largo < 8).
  function _dimEjeGeo(eje) {
    var g = ST.receta.geometria;
    return Number(eje === 'y' ? g.alto : (eje === 'z' ? g.ancho : g.largo));
  }
  function _lineasRecubEje(eje) {
    var D = _dimEjeGeo(eje);
    var lo = -D / 2 + _recubEje(eje, 'min'), hi = D / 2 - _recubEje(eje, 'max');
    if (!(lo < hi)) { lo = -D / 2; hi = D / 2; }
    return { lo: lo, hi: hi };
  }

  function _facesEje(eje) {
    var g = ST.receta.geometria;
    var r = _lineasRecubEje(eje);
    // X tenía sólo bordes y centro: el imán se saltaba justo la línea contra la que
    // el motor arranca las barras a lo largo (el recub de extremo). Ahora los tres
    // ejes ofrecen los mismos nodos: los dos bordes, el centro y los dos recubs.
    if (eje === 'x') return [-g.largo / 2, g.largo / 2, 0, r.hi, r.lo];
    if (eje === 'y') return [-g.alto / 2, g.alto / 2, 0, r.hi, r.lo];
    return [-g.ancho / 2, g.ancho / 2, 0, r.hi, r.lo];
  }

  // Click host con snap por eje (según el plano).
  function _clickHost(plano, uv) {
    var h = _uvToHost(plano, uv.u, uv.v);
    if (plano === 'seccion') { h.z = _snapValor(h.z, _facesEje('z')); h.y = _snapValor(h.y, _facesEje('y')); }
    else if (plano === 'largo') { h.x = _snapValor(h.x, _facesEje('x')); h.y = _snapValor(h.y, _facesEje('y')); }
    else { h.x = _snapValor(h.x, _facesEje('x')); h.z = _snapValor(h.z, _facesEje('z')); }
    return h;
  }

  // ==========================================================================
  // COLOCAR — clic en una vista crea un componente anclado.
  // ==========================================================================
  // COMPONENTE QUE NACE DE UN CLIC — FUENTE ÚNICA, sin efectos.
  // La usan los DOS lados de la misma acción: el GHOST (para previsualizar la
  // barra REAL bajo el cursor) y _colocarEnVista (para crearla). Que sea la MISMA
  // función es lo que impide que el preview mienta: construidos por separado, el
  // ghost y la barra colocada volverían a divergir al primer cambio de defaults.
  // `sel` = { tipologia, figura, diam } — el ribbon (ST.*) al colocar,
  // ST.cargado al previsualizar (son lo mismo: los sella _sellarCargado).
  // NO muta ST ni la receta: devuelve el componente suelto.
  function _compDesdeClick(plano, host, sel) {
    var rol = _rolComp(sel);
    var meta = _metaModular(sel.tipologia);
    // POSE INICIAL — la manda la TABLA DEL MOTOR (POSES_DEFAULT por elemento ×
    // tipología). Los defaults dispersos de la UI (_caraDefault + la orientación de
    // _metaModular) quedan SÓLO como fallback mientras el motor no publique la tabla.
    var pose = _poseDefault(sel.tipologia, meta);
    var deTabla = !!_poseDefaultMotor(sel.tipologia);

    // EL BORDE CLICADO MANDA (§colocación con borde): la arista resaltada bajo el
    // cursor define la CARA y —cuando esa cara no lleva el signo en el nombre— su
    // LADO, con el signo del borde. Y NADA MÁS.
    //
    // EL ESPEJO NO SE TOCA ACÁ (defecto D3 del verificador). El comentario viejo
    // prometía "los 2 ganchos por esquina" y hacía justo lo contrario, porque
    // `lado` y `espejo` NO son el mismo giro:
    //   · `lado = −1` ya pone la barra en la CORTINA opuesta, con su gancho
    //     doblando hacia el núcleo (la normal de la cara cambia de signo).
    //   · `espejo` refleja el eje LONGITUDINAL de la pieza: manda el gancho al otro
    //     EXTREMO del muro.
    // Medido en un muro 400×250×20 con una MH 102A (un solo gancho), vista sección:
    //     borde +z            → punta del gancho en x = −197
    //     borde −z CON espejo → punta del gancho en x = +197   ← esquina OPUESTA
    //     borde −z sin espejo → punta del gancho en x = −197   ← LA MISMA esquina
    // O sea: sin el espejo las dos cortinas cierran su gancho en la MISMA esquina,
    // que es exactamente la regla de obra que se buscaba. Con figuras simétricas
    // (una 103B con A = C) el espejo es un no-op geométrico, y por eso el doble
    // volteo pasaba desapercibido hasta encontrarse una figura de un solo gancho.
    // El espejo sigue siendo un control EXPLÍCITO del usuario (botón de la ficha):
    // acoplarlo al borde le quitaba el control sin decírselo.
    var f = (ST.caraHi && ST.caraHi.plano === plano && ST.caraHi.cara) ? ST.caraHi : null;
    if (f) {
      pose.cara = f.cara;
      if (_CARA_CON_LADO[f.cara] && f.axis === _NORMAL_DE_CARA[f.cara]) {
        pose.lado = (f.sign < 0) ? -1 : 1;
      }
      if (!_rumboValido(pose.cara, pose.rumbo)) pose.rumbo = _rumboDefaultDeCara(pose.cara);
    } else if (!deTabla && rol === 'cabezal' && pose.cara !== 'lateral' && (plano === 'seccion' || plano === 'largo')) {
      // FALLBACK por altura del click (sólo sin tabla del motor y sin borde tocado).
      // Aplica SOLO a tipologías cuya cara default es sup/inf (CBS/CBI de viga):
      // antes PISABA la cara 'lateral' de las mallas de muro (MH/MV), que colocadas
      // en la elevación caían a sup/inf y repartían en el ESPESOR (±7 cm → 2 barras)
      // en vez de la ALTURA (hallazgo del verificador de la Tanda F).
      pose.cara = (host.y >= 0) ? 'sup' : 'inf';
    }
    // LADO de la cara CORTINA cuando el clic NO tocó un borde: lo elige DÓNDE puso la
    // barra el usuario (no el arrastre posterior: pos_hint es traslación pura).
    if (!f && pose.cara === 'lateral' && Number(host.z) < 0) pose.lado = -1;
    if (!f && pose.cara === 'extremo' && Number(host.x) < 0) pose.lado = -1;

    // ==========================================================================
    // COLOCACIÓN POR VISTA (regla CONFIRMADA por el usuario, 14-ago): la pieza
    // nace EN el plano de la vista donde se hace clic — universal para cualquier
    // barra, con los autos re-derivándose solos contra la pose resultante.
    //   · Una pieza de SECCIÓN (estribo/traba/marco) vive ⊥ a su rumbo, así que
    //     su rumbo = la PROFUNDIDAD de la vista (el eje que sale de la pantalla).
    //     Antes el estribo tomaba la pose default de la tabla y podía aparecer
    //     "de canto" en otra vista (la 106A clickeada en la sección del muro
    //     aparecía en la elevación XZ).
    //   · Una LONGITUDINAL corre DENTRO de la vista: si su rumbo default es la
    //     profundidad (se vería de punta), pasa al eje horizontal de la vista
    //     (o al vertical si la cara no admite el horizontal).
    // El borde clickeado sigue mandando cara/lado: sus aristas viven EN el plano
    // de la vista, así que nunca choca con el rumbo elegido acá.
    var defV = (_defsPlanos() || {})[plano] || null;
    if (defV) {
      // "PIEZA DE SECCIÓN" LO DECIDE TAMBIÉN LA TOPOLOGÍA, no sólo la tipología
      // (bug 14-ago·2: un estribo 104D colocado con la tipología MV activa tenía
      // rol UI 'cabezal' → esta regla lo trataba como longitudinal y le metía el
      // rumbo DENTRO de la vista: clickeado en la sección aparecía en la
      // elevación XZ. El motor ya fuerza el rol por topología; acá se pregunta lo
      // mismo ANTES de elegir el rumbo).
      var fpV = global.ModeladorFiguraPuntos;
      // UNA SOLA AUTORIDAD (regla del usuario, 14-ago): decide la FAMILIA DE
      // DIBUJO de la pieza (cómo se traza), nunca la tipología a mano. Estribo,
      // marco y traba viven EN el plano de la vista (su rumbo es la normal /
      // el reparto); todo lo demás corre DENTRO del plano. Antes había un
      // `rol === 'estribo' || rol === 'traba'` acá — la segunda tabla en
      // paralelo que ya costó el estribo bajo tipología MV y la traba flotando.
      // (fix del fix, mismo 14-ago): la primera versión le pasaba el ROL a la
      // clasificación y familiaDeDibujo('106A', 'cabezal') contesta 'cabezal' —
      // la tipología PISABA a la topología y el estribo bajo MH caía al camino
      // de las abiertas (regresión reportada al minuto). La autoridad es DOBLE
      // y en este orden: la TOPOLOGÍA pura (cerrada = sección, venga la
      // tipología que venga — familiaDeDibujo con rol null, como el motor en
      // _baseDeComponente) O el rol de sección con su figura dibujable
      // (esPiezaDeSeccion: traba/estribo con 101x/103x/305A… = cadena/traba).
      // (Modelo A, 14-ago): la TRABA ya no entra como pieza de sección — toda
      // figura abierta entra COMO SE DIBUJÓ y se gira con ESPACIO. Sección =
      // topología cerrada, o rol estribo con figura de sección (305A/104B-ES).
      var esSeccionV = !!(fpV &&
        ((fpV.familiaDeDibujo && fpV.familiaDeDibujo(sel.figura, null) === 'estribo') ||
         (rol === 'estribo' && fpV.esPiezaDeSeccion && fpV.esPiezaDeSeccion(sel.figura, 'estribo'))));
      // AQUI VIVIO UN OVERRIDE PARA LA TRABA, Y ESTUVO MAL (25-ago). Se le hizo
      // ignorar esta regla para que cruzara el espesor viniera de donde viniera. El
      // usuario lo corto de raiz: «la tipologia NO DECIDE LA COLOCACION. La logica de
      // inserccion debe ser siempre la misma. Con cualquier barra tendras un caso mal
      // insertado si elegimos mal la vista o la cara: por eso el usuario debe tener
      // el control». Tiene razon y la regla es una sola: la barra nace en el plano de
      // la vista donde se clico, sea cual sea su tipologia. Si eso deja una traba
      // acostada en la elevacion, es porque ahi la puso el usuario — y la mueve.
      // Lo que la tipologia SI aporta es la pose de PARTIDA (POSES_DEFAULT), igual
      // que para MH, MV o un cabezal; esta regla la ajusta despues, para todos por
      // igual y sin excepciones.
      if (esSeccionV) {
        if (_NORMAL_DE_CARA[pose.cara] === defV.depth) {
          // la cara default quedó ∥ al plano de la pieza: elegir una cara VÁLIDA
          // (normal dentro del plano de la vista), priorizando el borde clickeado
          var cands = [f && f.cara, 'lateral', 'sup', 'extremo'];
          for (var c9 = 0; c9 < cands.length; c9++) {
            var cc = cands[c9];
            if (cc && _NORMAL_DE_CARA[cc] && _NORMAL_DE_CARA[cc] !== defV.depth) { pose.cara = cc; break; }
          }
        }
        pose.rumbo = defV.depth;
      } else {
        // Pieza ABIERTA: corre DENTRO del plano de la vista, "como se dibujó".
        // Si el clic fue en un BORDE, el dominante corre PARALELO a ese borde
        // (borde de arriba → ____ con las patas hacia abajo — regla del usuario);
        // sin borde, u y luego v. Antes solo se corregía cuando el rumbo default
        // apuntaba a la profundidad: un default en-plano pero perpendicular al
        // borde clickeado se quedaba como estaba.
        var candsR = [defV.u, defV.v];
        var nBorde = (f && f.cara) ? _NORMAL_DE_CARA[f.cara] : null;
        if (nBorde === defV.u) candsR = [defV.v, defV.u];        // borde vertical → corre en v
        else if (nBorde === defV.v) candsR = [defV.u, defV.v];   // borde horizontal → corre en u
        if (pose.rumbo === defV.depth || nBorde) {
          for (var c8 = 0; c8 < candsR.length; c8++) {
            if (_rumboValido(pose.cara, candsR[c8])) { pose.rumbo = candsR[c8]; break; }
          }
        }
      }
      if (!_rumboValido(pose.cara, pose.rumbo)) pose.rumbo = _rumboDefaultDeCara(pose.cara);
    }

    // ESPEJO DEL PREVISUALIZADOR (ESPACIO en colocación, pedido 13-ago): se aplica
    // acá para que el GHOST ya se vea reflejado y la barra se inserte igual.
    if (ST.espejoColoc) pose.espejo = !pose.espejo;

    var comp = {
      tipologia: sel.tipologia, figura: sel.figura, diam: Number(sel.diam), suf_tipo: '',
      recub_override: null,
      angulos: _figSpec(sel.figura).angulos.slice(),
      modo: meta.modo, plano_pieza: meta.plano_pieza, arreglo: meta.arreglo,
      dims: _dimsDefault(sel.figura),
      distribucion: _distDefault(sel.tipologia)
    };
    // POSE canónica + espejo de los campos viejos (cara / lado / plano_pieza): el
    // resto de esta función (y el motor) ya leen el estado NUEVO.
    _setPose(comp, pose);
    var cara = comp.cara;
    // DISTRIBUCIÓN AL NACER — LA DECIDE EL MODO, NO EL ROL.
    // Una barra cuyo MODO default es 'lineal' nace ya REPARTIDA (distribución
    // activa + rango útil de SU eje), no como 1 barra suelta: nadie quiere un
    // estribo solo ni una malla de un fierro, y así la flecha con handles aparece
    // de inmediato al quedar seleccionada y el reparto se ajusta arrastrándola.
    // Antes la condición era `rol === 'estribo' || rol === 'traba'`, o sea una
    // segunda tabla de tipologías escrita acá: las tipologías nuevas que el motor
    // presetea en 'lineal' (MH/MV de muro) nacían puntuales aunque el motor dijera
    // lo contrario. Ahora la autoridad es una sola: modoDefaultDeTipologia.
    // Los cabezales (CB*/LT preset 'puntual') no entran acá: su reparto son capas.
    if (meta.modo === 'lineal') {
      var d = comp.distribucion;
      // _distDefault(tipologia) ya devuelve la forma lineal cuando corresponde (esta
      // rama es idempotente en ellos); un rol cabezal con preset lineal llega con
      // la forma layered y hay que completarle los campos que el rango necesita.
      d.modo = MODO_A_DIST.lineal;
      if (!(Number(d.sep) > 0)) d.sep = 20;
      if (!Array.isArray(d.zonas) || !d.zonas.length) d.zonas = [{ long: 0, sep: d.sep }];
      if (!(Number(d.start_offset) >= 0)) d.start_offset = 4;
      d.activa = true;
      d.rango = _rangoDefault(d.sep, _ejeDistDe(comp));
    }
    // pos_hint desde el click (los ejes que el plano define). El motor ancla por
    // cara y offset; el pos_hint corre la barra al punto clicado en los ejes libres.
    comp.pos_hint = _posHintDeClick(plano, host, rol, cara, _poseDe(comp));
    return comp;
  }

  function _colocarEnVista(plano, host) {
    // GATE DE FIGURA: el clic coloca por ST.tool, no por ST.cargado, así que la
    // última palabra la tiene el catálogo. Una figura inexistente o no dibujable NO
    // nace: antes se colaba como "recta" con parciales inventados y kg = 0.
    var errFig = _figError(ST.figura);
    if (errFig) { _actualizarStatus(errFig); return; }
    // GATE DE φ (bug 14-ago): figura y φ parten VACÍOS, y el sello ya bloqueaba el
    // GHOST sin φ… pero esta ruta colocaba igual — el usuario clicaba "a ciegas"
    // (sin preview ni borde) y nacían barras con ø0: invisibles en el 3D (radio
    // cero, sólo se veía el contorno azul al seleccionarlas) y con 0 kg en el
    // listado. El clic exige lo MISMO que el sello: figura Y diámetro.
    if (!ST.figura || !Number(ST.diam)) {
      _sellarCargado();   // deja el motivo en la barra de estado
      // AYUDA VISIBLE (pedido 14-ago): el clic sin figura/φ parecía "no hacer
      // nada" — el mensaje del status pasaba piola. El campo FALTANTE parpadea
      // en rojo y recibe el foco: el ojo va directo a lo que hay que llenar.
      var faltante = !ST.figura ? $('te_ribFigura') : $('te_ribDiam');
      if (faltante) {
        faltante.classList.add('bad');
        try { faltante.focus(); } catch (e) { }
        setTimeout(function () { faltante.classList.remove('bad'); }, 1600);
      }
      return;
    }
    _pushUndo();   // snapshot ANTES de mutar (tarea 1: _pushUndo antes de colocar)
    var comp = _compDesdeClick(plano, host, {
      tipologia: ST.tipologia, figura: ST.figura, diam: ST.diam
    });
    ST.receta.componentes.push(comp);
    ST.selCi = ST.receta.componentes.length - 1;
    _soltarExtras();
    _regenerar();
    _renderPanel();
    // SALIR DEL MODO COLOCAR AL COLOCAR (22-ago, pedido del usuario). Antes el modo
    // quedaba encendido y el clic siguiente ponía otra barra sin querer -- y como el
    // clic tambien es "seleccionar", el usuario que iba a elegir la barra recien puesta
    // terminaba poniendo una segunda encima. Sale ademas por la misma puerta de siempre
    // (_activarHerramienta), asi que el ribbon esconde figura/phi/tipologia y la barra
    // de estado se actualiza sin cablear nada aparte.
    // Queda pendiente el modo CONTINUO que el usuario quiere despues: colocar varias
    // seguidas sin salir. Cuando llegue, esto pasa a ser el comportamiento por defecto
    // y el continuo un modificador, no al reves.
    _activarHerramienta('mover');
  }

  // pos_hint: qué ejes fija el click. Estribo (perimetral) → su X (posición a lo
  // largo). El CABEZAL no fija nada: se centra/reparte a lo ancho con sus propios
  // controles (barras/capa + Centrar/Repartir), así que el clic sólo elige la CARA.
  function _posHintDeClick(plano, host, rol, cara, pose) {
    var ph = {};
    if (rol === 'estribo' || rol === 'traba') {
      // COLOCACIÓN POR VISTA (14-ago): el clic fija la coordenada A LO LARGO del
      // RUMBO de la pieza cuando ese eje es VISIBLE en la vista (u o v). En su
      // propia vista de sección el rumbo es la profundidad (no clickeable): la
      // pieza nace con el reparto default. Antes esto era la tabla fija del
      // estribo de viga ("el click en largo/planta define esa X"), que es el
      // caso particular rumbo = x.
      var dv = (_defsPlanos() || {})[plano] || null;
      var ru = pose && pose.rumbo;
      if (dv && ru && (ru === dv.u || ru === dv.v)) ph[ru] = host[ru];
      // (14-ago) Aquí vivía un `ph.z = host.z` SOLO para rol traba — la regla por
      // tipología que dejaba la traba del muro flotando fuera del hormigón: el
      // click cerca de la cortina la trasladaba 10 cm en z cuando el marco ya la
      // centra cruzando el espesor. El click elige CARA y LADO; la posición en el
      // plano la manda el anclaje — igual para todas las piezas de sección.
      return ph;
    }
    // Cabezal longitudinal: corre por X y queda CENTRADO a lo ancho. NO se toma la
    // Z del clic (antes la barra nacía pegada donde cayó el cursor y la disposición
    // "centrar/repartir" no podía recolocarla).
    return ph;
  }

  // Re-encuadra las ZONAS de espaciamiento (confinado/centro) al tramo útil del eje
  // `eje`, repartiéndolas en PROPORCIÓN a como estaban y conservando cada @sep. Es
  // el mismo criterio que se aplica al rango. Sin esto, al voltear una viga de 600
  // las zonas (150/300/150) se siguen midiendo contra los 30 cm del ancho y el
  // distribuidor corta el reparto casi entero.
  function _reencuadrarZonas(d, eje) {
    var zs = d && d.zonas;
    if (!zs || !zs.length) return;
    var g = ST.receta.geometria;
    var dim = Number(eje === 'z' ? g.ancho : (eje === 'y' ? g.alto : g.largo));
    // el motor consume las zonas entre ±dim/2 ∓ start_offset (mismo margen que el rango)
    var rd = _rangoDefault(d.sep || 20, eje);
    var start = isFinite(Number(d.start_offset)) ? Number(d.start_offset) : (dim - (rd.to - rd.from)) / 2;
    var util = dim - 2 * start;
    if (!isFinite(util) || util <= 0) return;
    // zonas placeholder (todas long 0) = distribución por rango: no se tocan.
    var total = zs.reduce(function (a, z) { return a + (Number(z.long) || 0); }, 0);
    if (total <= 0) return;
    var acum = 0;
    for (var i = 0; i < zs.length; i++) {
      var v = (i === zs.length - 1)
        ? util - acum                                   // la última cierra exacto
        : Math.round((Number(zs[i].long) || 0) / total * util);
      zs[i].long = Math.max(0, v);
      acum += zs[i].long;
    }
  }

  // ==========================================================================
  // ORIENTAR LA PIEZA (§INTERACCIÓN-2.0 · G3/B3 · TANDA 1) — NO rota EN el plano;
  // cambia el PLANO DE TRABAJO de la pieza. Desde 11-ago es GEOMETRÍA REAL: el
  // motor (reglas.js) expande el componente con los ejes PERMUTADOS, así que la
  // figura cambia de plano Y el reparto cambia de eje, resolviendo las dims 'auto'
  // y el anclaje contra el recubrimiento de las caras NUEVAS. Las 4 vistas (que son
  // renders 3D) lo muestran girado sin ningún truco de proyección.
  //
  // Desde el 12-ago hay TRES orientaciones (acostada / volteada / de pie) y el botón
  // las CICLA. `ori` fija una en concreto; sin argumento avanza a la siguiente.
  //
  // El RANGO y las ZONAS se expresan en el eje de distribución, así que al cambiar
  // de orientación hay que llevarlos al eje NUEVO (el que salga de _ejeDistDe con la
  // orientación destino, sea x, z o y): se re-encuadran al tramo útil completo de
  // ese eje (conservando los @sep). Si se dejara el dato viejo, un estribo repartido
  // en ±296 (largo) pasaría a repartirse en ±296 de ANCHO — fuera del hormigón — y
  // las zonas (150/300/150 cm) se consumirían contra un marco de 30 cm: el
  // distribuidor las trunca en silencio y "desaparecen" casi todas las barras.
  // Lleva el RANGO y las ZONAS al eje de reparto que corresponde a la pose ACTUAL
  // del componente. `ejeAntes` (opcional) = el eje que tenía antes del cambio: si no
  // cambió, no se toca nada (una rotación de 180° no debe borrar el rango que el
  // usuario ajustó a mano). Sin `ejeAntes` se re-encuadra siempre.
  function _reencuadrarReparto(comp, ejeAntes) {
    var d = comp && comp.distribucion;
    if (!d) return;
    var ejeN = _ejeDistDe(comp);
    // REGLA (usuario 14-ago): el reparto vive en la NORMAL del plano de la pieza
    // — distribuir dentro del plano de desarrollo de la barra es apilar copias
    // sobre el mismo dibujo. Antes esto sólo reencuadraba si el eje "de antes"
    // difería del nuevo: si el RANGO ya venía en un eje equivocado (receta
    // guardada vieja, o una rotación que no pasó por acá), se quedaba mal para
    // siempre. Ahora se compara contra el eje REAL del rango: idempotente y
    // autocorrectivo — cualquier rotación deja el reparto en el rumbo nuevo.
    var rangoMal = !!(d.rango && d.rango.eje && d.rango.eje !== ejeN);
    if (!rangoMal && ejeAntes && ejeAntes === ejeN) return;
    if (!rangoMal && !ejeAntes) return;   // sin cambio de eje ni rango torcido
    if (d.rango) d.rango = _rangoDefault(d.rango.sep || d.sep || 20, ejeN);
    _reencuadrarZonas(d, ejeN);
  }

  function rotarPlanoPieza(comp, ori) {
    if (!comp) return;
    _setOrientacion(comp, ori || _orientacionSiguiente(_orientacionDe(comp)));
    // la orientación es el RUMBO en el modelo de pose: mantener las dos caras del
    // mismo dato sincronizadas (si no, la ficha mostraría la pose vieja).
    if (comp.pose) {
      var pr = _poseDe(comp);
      pr.rumbo = _ORIENT_A_RUMBO[_orientacionDe(comp)] || pr.rumbo;
      _setPose(comp, pr);
    }
    _reencuadrarReparto(comp);   // eje de reparto YA con la orientación nueva
    _regenerar();          // el motor re-expande con los ejes permutados
    _renderPanel();
    _posicionarFlipBtn();  // el overlay sigue pegado a la pieza tras reproyectar
    _actualizarStatus();
  }

  // ==========================================================================
  // ROTAR-EN-VISTA (TANDA P) — "girar de acuerdo a lo que se ve".
  //
  // UNA SOLA SEMÁNTICA para el giro grueso: la pieza gira 90° alrededor del eje de
  // PROFUNDIDAD de la vista donde el usuario está trabajando (el eje que sale de la
  // pantalla), que es exactamente lo que uno espera al mirar un plano y decir "gírala".
  // Sustituye al ciclo de 3 orientaciones del botón azul (acostada→volteada→de pie),
  // que era un ciclo ciego y no tenía nada que ver con la vista.
  //
  // La autoridad del giro es el MOTOR: reglas.rotarPose90(pose, ejeMundo) devuelve la
  // pose de las 24 (la tabla vive en un solo sitio). Se resuelve EN EL MOMENTO;
  // mientras el motor no la publique se cae al ciclo de orientaciones de siempre,
  // para que el control nunca quede muerto.
  //
  // El eje de profundidad sale de PLANOS_POR_ELEMENTO (def.depth), no de una tabla
  // aparte: en un muro la "sección" es otro plano que en una viga y el giro tiene que
  // seguir a la vista, no al nombre del cuadrante.
  // ==========================================================================
  function _ejeProfundidadDeVista(plano) {
    var def = (_defsPlanos() || {})[plano];
    return (def && def.depth) || EJE_ROT[plano] || 'x';
  }
  // Vista ACTIVA = la resaltada (P3) o, si no hay ninguna, la última tocada.
  function _vistaActiva() {
    var p = ST.planoActivo || ST.ultimoPlano || 'largo';
    return (_defsPlanos() || {})[p] ? p : 'largo';
  }

  // Gira 90° la pose de `comp` en la vista `plano`. Devuelve true si giró con el
  // modelo de pose (motor), false si cayó al ciclo viejo.
  function rotarPoseEnVista(comp, plano) {
    if (!comp) return false;
    var reglas = global.ModeladorReglas;
    var eje = _ejeProfundidadDeVista(plano);
    var nueva = (reglas && reglas.rotarPose90) ? reglas.rotarPose90(_poseDe(comp), eje) : null;
    if (!nueva) {
      // motor sin rotarPose90 todavía → ciclo de orientaciones (comportamiento previo)
      rotarPlanoPieza(comp);
      return false;
    }
    var ejeAntes = _ejeDistDe(comp);
    _setPose(comp, nueva);
    _reencuadrarReparto(comp, ejeAntes);
    _regenerar();
    _renderPanel();
    _posicionarFlipBtn();
    _actualizarStatus();
    return true;
  }

  // Girar la pieza SELECCIONADA en la vista activa (tecla R y botón contextual).
  // Snapshot para Ctrl+Z.
  function _rotarPoseSeleccion(plano) {
    if (!ST.receta) return;
    if (ST.selCi < 0) { _actualizarStatus('Nada seleccionado: haz clic en una barra y vuelve a girar (R).'); return; }
    _pushUndo();
    rotarPoseEnVista(ST.receta.componentes[ST.selCi], plano || _vistaActiva());
  }

  // ROTAR DE PLANO (restaurada 13-ago): giro de POSE de la selección en torno a
  // un EJE del mundo dado — el VERTICAL de la vista activa ("como una puerta"):
  // la pieza pasa de estar de frente a estar colocada en PROFUNDIDAD. Por ser de
  // pose, dims/anclaje/reparto se re-derivan igual que con R.
  function _rotarPoseSeleccionEje(eje) {
    if (!ST.receta) return;
    if (ST.selCi < 0) { _actualizarStatus('Nada seleccionado: haz clic en una barra y vuelve a girar.'); return; }
    var comp = ST.receta.componentes[ST.selCi];
    var reglas = global.ModeladorReglas;
    if (!comp || !reglas || !reglas.rotarPose90) return;
    _pushUndo();
    var ejeAntes = _ejeDistDe(comp);
    _setPose(comp, reglas.rotarPose90(_poseDe(comp), eje));
    _reencuadrarReparto(comp, ejeAntes);
    _regenerar();
    _renderPanel();
    _posicionarFlipBtn();
    _actualizarStatus();
  }
  // ESPACIO con selección (17-ago): girar la pieza EN SU PROPIO PLANO. El eje es
  // la normal del plano de la pieza (motor.normalDePieza, la misma medición del
  // reparto): un estribo gira sin salirse de su plano, da igual qué vista esté
  // activa. Si el motor no puede medirla, cae al giro por vista (como R).
  function _rotarEnPlanoPropio() {
    if (!ST.receta || ST.selCi < 0) { _rotarPoseSeleccion(_vistaActiva()); return; }
    var comp = ST.receta.componentes[ST.selCi];
    // PIEZA DE MARCO (estribo cerrado): girar la pose no mueve NADA visible — el
    // marco se re-deriva del hormigón siempre alineado a los ejes. Lo que SÍ
    // gira en un estribo son sus GANCHOS de esquina, y esos los manda el lado
    // dominante (reporte 17-ago: «los ganchos del estribo no rotan con
    // espacio»). ESPACIO avanza el dominante al siguiente lado del marco: los
    // ganchos recorren las 4 esquinas, la caja no se toca.
    var fpR = global.ModeladorFiguraPuntos || {};
    var ordenM = fpR.ladosMarcoOrdenados ? fpR.ladosMarcoOrdenados(comp.figura, _rolComp(comp)) : null;
    if (ordenM && ordenM.length === 4) {
      _pushUndo();
      var cur = _ladoDomElegido(comp) || ordenM[0];
      var sig = ordenM[(ordenM.indexOf(cur) + 1) % 4];
      comp.lado_dominante = sig;
      _mut(ST.selCi, true);
      _actualizarStatus('Ganchos → lado ' + sig + ' (ESPACIO sigue girándolos; la caja no cambia).');
      return;
    }
    var reglas = global.ModeladorReglas;
    var eje = (reglas && reglas.normalDePieza) ? reglas.normalDePieza(comp, ST.receta.geometria) : null;
    if (eje !== 'x' && eje !== 'y' && eje !== 'z') { _rotarPoseSeleccion(_vistaActiva()); return; }
    _rotarPoseSeleccionEje(eje);
  }

  // (El viejo _voltearSeleccion — ciclar acostada/volteada/de pie — MURIÓ: el botón
  //  flotante y la tecla R llaman los dos a _rotarPoseSeleccion. Una sola semántica.)

  // --------------------------------------------------------------------------
  // BOTÓN CONTEXTUAL "Voltear plano (R)" — flota junto a la pieza seleccionada.
  // Se posiciona en coords del contenedor #te_quad a partir del bounding box de
  // los placements del componente seleccionado en la MEJOR vista donde se ve.
  // --------------------------------------------------------------------------
  // viewBox (px del svg) → coords cliente, inverso de _svgPoint (xMidYMid meet).
  function _svgToClient(svg, px, py) {
    var vb = (svg.getAttribute('viewBox') || '0 0 620 300').split(/\s+/).map(Number);
    var r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var VW = vb[2] || 620, VH = vb[3] || 300;
    var scale = Math.min(r.width / VW, r.height / VH);
    var padX = (r.width - VW * scale) / 2, padY = (r.height - VH * scale) / 2;
    return { x: r.left + padX + px * scale, y: r.top + padY + py * scale };
  }

  // bbox (en px del viewBox) de los placements del componente ci en un plano dado,
  // usando el proyector que corresponde (volteado o no). null si no hay puntos.
  function _bboxCompEnPlano(ci, plano) {
    var t = ST.transforms[plano]; if (!t) return null;
    var def = (_defsPlanos() || {})[plano]; if (!def) return null;
    var out = ST.ultimoOut; if (!out || !out.placements) return null;
    var pj = _proyectorDe(def);   // proyector único: el volteo ya es geometría real
    function X(u) { return _tX(t, u); }
    function Y(v) { return _tY(t, v); }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
    out.placements.forEach(function (pl) {
      if (!pl.meta || pl.meta.ci !== ci) return;
      (pl.puntos || []).forEach(function (pt) {
        var q = pj(pt); if (!isFinite(q.u) || !isFinite(q.v)) return;
        var x = X(q.u), y = Y(q.v);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y; n++;
      });
    });
    if (!n) return null;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  // Posiciona (o esconde) el botón de voltear sobre la pieza seleccionada.
  // Elige la vista donde la pieza tenga mayor extensión visible (más "agarrable"),
  // priorizando la última tocada. Sin selección → oculto.
  function _posicionarFlipBtn() {
    var btn = $('te_flipBtn'); if (!btn) return;
    var quad = $('te_quad');
    if (ST.selCi < 0 || !ST.receta || !ST.receta.componentes[ST.selCi] || !quad) {
      btn.classList.remove('on'); return;
    }
    var planos = ['seccion', 'largo', 'planta'];
    // ordenar: la última tocada primero (empate → la de mayor área de bbox).
    var mejor = null, mejorPlano = null, mejorScore = -1;
    planos.forEach(function (p) {
      // CUADRANTE OCULTO POR LA LUPA (18-ago): su SVG mide 0×0, así que el bbox se
      // proyecta a coordenadas sin sentido y el botón terminaba clampeado en la
      // esquina de la grilla, encima del cuadrante que el usuario está mirando.
      // Con el 3D maximizado no queda ninguna vista 2D y el botón se esconde entero,
      // que es lo correcto: gira "en la vista activa" y no hay vista donde apuntar.
      var sv = $(SVG_ID[p]); if (!sv || sv.clientWidth < 2) return;
      var bb = _bboxCompEnPlano(ST.selCi, p); if (!bb) return;
      var area = Math.max(1, (bb.maxX - bb.minX)) * Math.max(1, (bb.maxY - bb.minY));
      var score = area + (p === ST.ultimoPlano ? 1e9 : 0);   // preferir la última vista tocada
      if (score > mejorScore) { mejorScore = score; mejor = bb; mejorPlano = p; }
    });
    if (!mejor) { btn.classList.remove('on'); return; }
    var svg = $(SVG_ID[mejorPlano]); if (!svg) { btn.classList.remove('on'); return; }
    // Esquina sup-der del bbox en coords cliente → coords relativas a #te_quad.
    var cli = _svgToClient(svg, mejor.maxX, mejor.minY); if (!cli) { btn.classList.remove('on'); return; }
    var qr = quad.getBoundingClientRect();
    var bw = 30, bh = 30, pad = 6;
    var left = cli.x - qr.left + pad;             // un pelín a la derecha del extremo
    var top = cli.y - qr.top - bh - pad;          // justo por encima
    // Clampear dentro del cuadrante (que nunca se salga del área visible).
    left = Math.max(2, Math.min(qr.width - bw - 2, left));
    top = Math.max(2, Math.min(qr.height - bh - 2, top));
    btn.style.left = left + 'px';
    btn.style.top = top + 'px';
    btn.classList.add('on');
    _pintarFlipBtn(btn, ST.receta.componentes[ST.selCi]);
  }

  // Icono / tooltip / clase del botón de GIRO. El botón ya NO cicla orientaciones:
  // gira 90° EN LA VISTA ACTIVA (una sola semántica, la misma que la tecla R). El
  // ICONO sigue mostrando el estado — el RUMBO de la pieza, o sea hacia dónde corre —
  // para que el usuario vea en qué quedó sin abrir la ficha.
  // Notación de obra, legible a 30 px: ↔ corre a lo largo · ⊗ corre hacia el fondo
  // (se ve de canto) · ↕ corre en vertical.
  var _RUMBO_ICONO = { x: '↔', z: '⊗', y: '↕' };
  function _pintarFlipBtn(btn, comp) {
    if (!btn || !comp) return;
    var p = _poseDe(comp);
    var vista = _vistaActiva();
    var nomVista = (_titulosSemanticos() || {})[vista] || vista;
    btn.textContent = _RUMBO_ICONO[p.rumbo] || '⟲';
    // El tooltip dice la pose CON LA MISMA FRASE que la ficha (22-ago). Antes usaba
    // _poseTexto, que habla en coordenadas del modelo ("cara inf · corre en largo (Y)"):
    // dos vocabularios para el mismo estado en dos sitios que se miran a la vez.
    var t = 'Girar 90° en ' + nomVista + ' (R) — ' + _fraseOrientacion(p);
    btn.title = t;
    btn.setAttribute('aria-label', t);
    btn.setAttribute('data-rumbo', p.rumbo);
    btn.classList.toggle('flipped', p.rumbo === 'z');
    btn.classList.toggle('depie', p.rumbo === 'y');
    btn.classList.toggle('espejo', !!p.espejo);
  }

  // (El etiquetado ci de cada placement se hace en _regenerar → _etiquetarCi.)

  // ==========================================================================
  // SELECCIÓN / MOVER / BORRAR / ROTAR
  // ==========================================================================
  // CAMBIAR DE SELECCIÓN NO RE-ARMA LA GRILLA (20-ago): la receta no cambió, así que
  // las tejas siguen valiendo. Sólo se mueve la marca .sel y se repinta la ficha en
  // su zona fija. Antes esto llamaba a _renderPanel y reconstruía el panel entero.
  // TODOS los componentes seleccionados: la selección más sus acompañantes, sin
  // repetidos y sin índices que ya no existen. Es la lista que consumen el espejo y
  // el borrado; ordenada de mayor a menor para poder recorrerla haciendo splice sin
  // que se corran los índices de atrás.
  function _selTodos() {
    var n = (ST.receta && ST.receta.componentes) ? ST.receta.componentes.length : 0;
    var out = [], vistos = {};
    function sumar(ci) {
      ci = Number(ci);
      if (!(ci >= 0) || ci >= n || vistos[ci]) return;
      vistos[ci] = true; out.push(ci);
    }
    sumar(ST.selCi);
    (ST.selExtra || []).forEach(sumar);
    return out.sort(function (a, b) { return b - a; });
  }
  function _estaSeleccionado(ci) {
    // El `ci < 0` es el placement SIN componente (meta.ci ausente). Antes lo filtraba
    // el `ST.selCi >= 0` que cada sitio de resaltado llevaba pegado; al centralizar
    // la pregunta hay que traerse el filtro, o con NADA seleccionado (selCi = -1)
    // esas barras se pintarian todas como elegidas.
    if (!(ci >= 0)) return false;
    return ci === ST.selCi || (ST.selExtra || []).indexOf(ci) >= 0;
  }
  // Vaciar los acompañantes. Se llama cada vez que la lista de componentes cambia de
  // forma (ver la nota de ST.selExtra).
  function _soltarExtras() {
    if (ST.selExtra && ST.selExtra.length) ST.selExtra = [];
  }
  // CTRL+CLIC: suma o resta una barra de la selección.
  //   · no estaba          → se suma como acompañante
  //   · era un acompañante → se quita
  //   · era LA selección   → se cede el puesto al primer acompañante (y si no hay,
  //                          se suelta todo). Así ctrl+clic siempre "quita lo que
  //                          clicaste", sin importar cuál de los dos papeles tenía.
  function _alternarSeleccion(ci) {
    ci = Number(ci);
    var n = (ST.receta && ST.receta.componentes) ? ST.receta.componentes.length : 0;
    if (!(ci >= 0) || ci >= n) return;
    ST.selExtra = ST.selExtra || [];
    if (ci === ST.selCi) {
      var siguiente = ST.selExtra.length ? ST.selExtra.shift() : -1;
      ST.selCi = siguiente;
    } else {
      var k = ST.selExtra.indexOf(ci);
      if (k >= 0) ST.selExtra.splice(k, 1);
      else if (ST.selCi < 0) ST.selCi = ci;
      else ST.selExtra.push(ci);
    }
    _renderSeleccion();
    _redibujar2D(ST.ultimoOut);
    _marcarBotonEspejo();
    if (ST.espejoPend) _pintarCarasEspejo();
    var n2 = _selTodos().length;
    _actualizarStatus(n2 > 1 ? (n2 + ' barras seleccionadas — ctrl+clic suma o quita.') : undefined);
  }

  // SHIFT+CLIC en la tira: de la seleccion actual hasta `ci`, inclusive. La
  // principal no se mueve -sigue siendo la que muestra la ficha- y el resto entra
  // de acompanante.
  function _seleccionarTramo(ci) {
    ci = Number(ci);
    var n = (ST.receta && ST.receta.componentes) ? ST.receta.componentes.length : 0;
    if (!(ci >= 0) || ci >= n || ST.selCi < 0) return;
    var a = Math.min(ST.selCi, ci), b = Math.max(ST.selCi, ci);
    ST.selExtra = [];
    for (var k = a; k <= b; k++) if (k !== ST.selCi) ST.selExtra.push(k);
    _renderSeleccion();
    _redibujar2D(ST.ultimoOut);
    _marcarBotonEspejo();
    if (ST.espejoPend) _pintarCarasEspejo();
    var t = _selTodos().length;
    _actualizarStatus(t > 1 ? (t + ' barras seleccionadas — ctrl+clic suma o quita, shift+clic toma un tramo.') : undefined);
  }

  function _seleccionar(ci) {
    _soltarExtras();          // un clic normal SUSTITUYE la selección, no la amplía
    ST.selCi = ci;
    _renderSeleccion();
    _redibujar2D(ST.ultimoOut);
    // El boton de espejar se prende y se apaga con la SELECCION (sin barra elegida
    // no hay nada que espejar). Va aca porque _seleccionar es la unica puerta por la
    // que la seleccion se mueve; cablearlo en cada llamador dejaria botones mintiendo.
    _marcarBotonEspejo();
    if (ST.espejoPend && ci < 0) _salirEspejo();
    _actualizarStatus();
  }

  // PICK por PROXIMIDAD (fallback del hit-testing por data-ci): barra más cercana
  // al punto clicado (px,py en coords del viewBox), con tolerancia en píxeles.
  // Cubre los casos donde el clic cae sobre el render 3D pero fuera de la geometría
  // SVG de hit (p.ej. la barra vista de punta cuyo hit es un círculo chico), y
  // cualquier elemento que se interponga como target del evento. Distancia
  // punto→segmento sobre la polilínea proyectada de cada placement.
  function _pickBarra(plano, px, py, tolPx) {
    var out = ST.ultimoOut; if (!out || !out.placements) return -1;
    var t = ST.transforms[plano]; if (!t) return -1;
    var def = (_defsPlanos() || {})[plano]; if (!def) return -1;
    var pj = _proyectorDe(def);
    var tol = tolPx || 9, best = -1, bestD = tol;
    function d2seg(ax, ay, bx, by) {
      var vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
      var L2 = vx * vx + vy * vy;
      var s = L2 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2)) : 0;
      var dx = px - (ax + s * vx), dy = py - (ay + s * vy);
      return Math.sqrt(dx * dx + dy * dy);
    }
    out.placements.forEach(function (pl) {
      var ci = (pl.meta && pl.meta.ci != null) ? pl.meta.ci : -1;
      if (ci < 0) return;
      var pts = (pl.puntos || []).map(pj).filter(function (q) { return isFinite(q.u) && isFinite(q.v); });
      if (!pts.length) return;
      var xs = pts.map(function (q) { return _tX(t, q.u); });
      var ys = pts.map(function (q) { return _tY(t, q.v); });
      var d;
      if (pts.length === 1) {
        d = Math.sqrt((px - xs[0]) * (px - xs[0]) + (py - ys[0]) * (py - ys[0]));
      } else {
        d = Infinity;
        for (var i = 1; i < xs.length; i++) d = Math.min(d, d2seg(xs[i - 1], ys[i - 1], xs[i], ys[i]));
      }
      if (d < bestD) { bestD = d; best = ci; }
    });
    return best;
  }

  function _borrarSeleccion() {
    if (!ST.receta) return;
    // Sin selección el botón parecía "roto" (no pasaba absolutamente nada): ahora lo
    // dice en la barra de estado.
    var borrar = _selTodos();
    if (!borrar.length) { _actualizarStatus('Nada seleccionado: haz clic en una barra y vuelve a Borrar.'); return; }
    _pushUndo();
    // De mayor a menor (así viene _selTodos): un splice no corre los índices que
    // faltan por borrar.
    borrar.forEach(function (ci) { ST.receta.componentes.splice(ci, 1); });
    ST.selCi = -1; ST.selExtra = [];
    if (borrar.length > 1) _actualizarStatus(borrar.length + ' barras borradas.');
    _regenerar();
    _renderPanel();
  }

  // ROTAR la pieza en el plano de la vista (ESPACIO / botón +90° / campo de ángulo).
  // El giro es SOBRE EL PROPIO CENTRO de cada barra y el motor la RE-ANCLA al
  // recubrimiento después (reglas.js::_aplicarPostTransform, pivote 'propio' por
  // defecto): antes se rotaba en torno al ORIGEN DEL HOST y la pieza se despegaba
  // del recubrimiento (bug reportado). Aquí NO se escribe `pivot`: el default del
  // motor ya es el correcto; 'host' queda como opción explícita para casos legacy.
  function _rotarSeleccion(plano, deltaDeg) {
    if (!ST.receta) return;
    // Sin selección el botón parecía "roto" (igual que pasaba con Borrar): avisar.
    if (ST.selCi < 0) { _actualizarStatus('Nada seleccionado: haz clic en una barra y vuelve a Rotar.'); return; }
    _pushUndo();
    var c = ST.receta.componentes[ST.selCi];
    // Eje = profundidad de la vista SEGÚN EL ELEMENTO (13-ago): EJE_ROT era la
    // tabla fija de la viga y en el muro este giro salía del plano ("la barra
    // queda saliendo").
    var eje = _ejeProfundidadDeVista(plano);
    c.orient = c.orient || {};
    if (c.orient.eje !== eje) { c.orient.eje = eje; c.orient.deg = 0; }   // conserva spin
    c.orient.deg = ((c.orient.deg || 0) + deltaDeg) % 360;
    _regenerar();
    _renderPanel();
    _actualizarStatus();
  }

  // ==========================================================================
  // EVENTOS DE LAS VISTAS 2D
  // ==========================================================================
  function _bindVistas() {
    ['seccion', 'largo', 'planta'].forEach(function (plano) {
      var svg = $(SVG_ID[plano]);
      if (!svg || svg._teBound) return;
      svg._teBound = true;

      // P3 — CUALQUIER acción en el cuadrante 2D lo hace la VISTA ACTIVA: resalta el
      // cuadrante + muestra ESE plano en el 3D (a la profundidad del corte). Se activa
      // al primer mousedown; no se desactiva con clics siguientes (queda activa hasta
      // que el usuario actúe en otra vista). El doble-clic la apaga (toggle explícito).
      svg.addEventListener('mousedown', function () {
        if (ST.planoActivo !== plano) _setPlanoActivo(plano);
      });
      svg.addEventListener('dblclick', function (evt) {
        evt.preventDefault();
        ST.planoActivo = null; _sincronizarResaltado2D(); _redibujarPlanoActivo();
      });

      // GHOST (tarea 1) — sigue el cursor mientras haya algo cargado. No regenera:
      // dibuja en la capa dedicada. Si hay un arrastre en curso, no interfiere.
      svg.addEventListener('mousemove', function (evt) {
        if (ST.dragMove || ST.dragMarco || ST.dragRango) return;
        // ESPEJO ARMADO: la capa del ghost muestra la CARA bajo el cursor, que es
        // contra la que se va a reflejar. Va antes del guard de "hay algo cargado"
        // porque el espejo no carga ninguna figura: copia la que ya está.
        if (ST.espejoPend) { _hoverEspejo(plano, svg, evt); return; }
        if (!_hayCargado()) { if (ST.ghost) _limpiarGhost(); return; }
        var sp = _svgPoint(svg, evt); if (!sp) return;
        ST.ultimoPlano = plano;
        _dibujarGhost(plano, svg, sp);
      });
      svg.addEventListener('mouseleave', function () {
        var g = svg.querySelector('.te-ghost-layer'); if (g) while (g.firstChild) g.removeChild(g.firstChild);
        var v = svg.closest ? svg.closest('.te-vista') : null; if (v) v.classList.remove('te-ghost-block');
        if (ST.ghost && ST.ghost.plano === plano) ST.ghost = null;
        if (ST.caraHi && ST.caraHi.plano === plano) ST.caraHi = null;
      });

      // RUEDA: por defecto es el ZOOM de la vista (el handler vive en el .te-vista y
      // le llega por burbujeo). Acá sólo se atiende cuando cae sobre un rótulo de
      // largo del abanico — ver _ruedaRotulo, que corta la burbuja SÓLO en ese caso.
      svg.addEventListener('wheel', function (evt) { _ruedaRotulo(plano, svg, evt); }, { passive: false });

      // Clic DERECHO = cancelar el modo colocación (además de Esc). No abre el menú
      // contextual del navegador dentro del cuadrante.
      svg.addEventListener('contextmenu', function (evt) {
        if (ST.tool !== 'colocar') return;
        evt.preventDefault();
        _salirModoColocacion();
      });

      svg.addEventListener('mousedown', function (evt) {
        if (evt.button === 2) return;             // el botón derecho lo maneja contextmenu
        // El botón MEDIO es del PAN: aquí se filtra completo — antes caía a la
        // lógica de selección/colocación (un middle-click en modo colocar PONÍA
        // una barra) y peleaba con el arrastre del pan ("no agarra a la primera").
        if (evt.button === 1) return;
        // SHIFT = GATE DE COTAS POR LADO (19-ago). Este `return` estaba desde que
        // shift era el PAN de la vista (los dos handlers se disputaban el mousedown y
        // el pan "no agarraba"); ahora shift no panea, pero el filtro SE QUEDA y por
        // una razón mejor: con shift apretado el cuadrante es de MIRAR. Un clic ahí
        // no selecciona, no coloca y no arranca ningún arrastre — que es justo lo que
        // hay que evitar cuando la mano está en el teclado leyendo medidas (antes,
        // en modo colocar, el clic dejaba una barra suelta).
        if (evt.shiftKey) return;
        ST.ultimoPlano = plano;
        var sp = _svgPoint(svg, evt); if (!sp) return;

        // ¿tocó un TIRADOR DEL MARCO de la barra seleccionada?
        var tgtMarco = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-marco');
        if (tgtMarco && ST.selCi >= 0) {
          evt.preventDefault();
          var uvM = _pixelToUV(plano, sp.px, sp.py);
          if (uvM) _iniciarDragMarco(plano, ST.selCi, tgtMarco,
            evt.target.getAttribute('data-mlado') || '+', uvM);
          return;
        }

        // ¿tocó la etiqueta "@N" de un tramo? → input inline (no arrastra nada).
        var tgtAt = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-rango-at');
        if (tgtAt != null) { evt.preventDefault(); _abrirEditorAt(plano, svg, Number(tgtAt), evt); return; }

        // ¿tocó el rótulo del LARGO del abanico (o el de un tramo)? → input inline.
        // Van ANTES del divisor y del rect de arrastre porque son objetivos pequeños
        // dibujados encima; el divisor, que se dibuja DESPUÉS del rótulo del abanico,
        // conserva igual su tirador completo (ver _rotuloLargoRango).
        var tgtLen = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-rango-len');
        if (tgtLen != null) {
          evt.preventDefault();
          _abrirEditorLargo(plano, svg, tgtLen, evt, evt.target.getAttribute('data-rango-eje'));
          return;
        }
        var tgtTLen = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-rango-tlen');
        if (tgtTLen != null) { evt.preventDefault(); _abrirEditorLargoTramo(plano, svg, Number(tgtTLen), evt); return; }

        // ¿tocó un DIVISOR de tramo? → arrastra el límite entre dos tramos contiguos
        // (el par conserva su largo total; el rango no cambia).
        var tgtDiv = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-rango-div');
        if (tgtDiv != null) {
          evt.preventDefault(); _pushUndo();
          ST.dragRango = {
            ci: ST.selCi, plano: plano, lastX: sp.px, lastY: sp.py,
            end: null, div: Number(tgtDiv),
            // El eje y la línea los dice EL TIRADOR DIBUJADO, no _ejeDistDe(comp)
            // (ver _divisorTramo): con la pieza girada los dos ya no coinciden.
            eje: evt.target.getAttribute('data-rango-eje') || null,
            cual: evt.target.getAttribute('data-rango-cual') || 'rango'
          };
          return;
        }

        // ¿tocó la flecha de RANGO? (un handle de extremo achica/agranda ese
        // extremo; el tramo del medio desplaza el rango completo). Si la flecha era
        // la PREVIEW inactiva, el arrastre ACTIVA la distribución (_dragRangoMove).
        var tgtRango = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-rango');
        if (tgtRango != null) {
          evt.preventDefault(); _pushUndo();
          ST.dragRango = {
            ci: Number(tgtRango), plano: plano, lastX: sp.px, lastY: sp.py,
            end: evt.target.getAttribute('data-rango-end') || null,
            eje: evt.target.getAttribute('data-rango-eje') || null,
            cual: evt.target.getAttribute('data-rango-cual') || 'rango'
          };
          // repintar YA: la cota viva al borde sólo se dibuja mientras hay
          // arrastre, y sin esto aparecía recién al primer movimiento.
          _sincronizarOverlayOrto();
          return;
        }

        var uv = _pixelToUV(plano, sp.px, sp.py);

        // MODO COLOCACIÓN: el clic COLOCA (aunque caiga encima de otra barra — es un
        // modo explícito, no se "roba" el clic para seleccionar).
        // CLAMP (tarea 3): si el clic cae FUERA del hormigón, NO se coloca nada
        // (mata "barras al aire"). El ghost ya avisó en rojo + not-allowed.
        // ESPEJO ARMADO: este clic elige la CARA de destino y se consume. Va antes
        // que todo lo demás —incluso antes de colocar— porque es un modo de un solo
        // clic: mientras está armado, el clic no hace ninguna otra cosa.
        if (ST.espejoPend) {
          evt.preventDefault();
          // UN CLIC SOBRE UNA BARRA LA ELIGE, no espeja. Es la otra mitad de «el
          // orden no importa»: con el modo ya armado, lo que falta es decirle a QUÉ
          // barra, y el gesto para eso es el de siempre. Sólo el hit exacto de la
          // barra cuenta —no el pick por proximidad—, porque las caras viven pegadas
          // al hormigón y ahí siempre hay barras cerca.
          var ciEsp = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-ci');
          if (ciEsp != null && evt.target.getAttribute('data-hit')) { _seleccionar(Number(ciEsp)); return; }
          if (ST.selCi < 0) {
            _actualizarStatus('ESPEJAR — elige primero la barra: clic sobre ella o sobre su caluga.');
            return;
          }
          // Lo normal es clicar la BANDA (que trae su propio listener). Esto es la
          // red: un clic en cualquier otra parte de la vista toma la cara MÁS
          // CERCANA, sin umbral. La primera versión exigía caer dentro de 9 cm de la
          // arista —9 píxeles en un muro de 600— y por eso «no pude seleccionar la
          // cara»: no hay puntería que valga, así que ya no hace falta tenerla.
          var fEsp = uv ? _caraMasCercana(plano, uv) : null;
          if (!fEsp) { _actualizarStatus('Espejar: clic DENTRO de una de las tres vistas.'); return; }
          _espejarEnCara(fEsp);
          return;
        }

        if (ST.tool === 'colocar') {
          if (!uv) return;
          if (!_dentroDelBoundary(plano, uv)) { _actualizarStatus('Fuera del hormigón: clic dentro del contorno para colocar.'); return; }
          evt.preventDefault();
          _colocarEnVista(plano, _clickHost(plano, uv));
          return;
        }

        // ¿tocó una barra? (data-hit) → seleccionar (+ preparar mover).
        var ci = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-ci');
        if (ci != null && evt.target.getAttribute('data-hit')) {
          ci = Number(ci);
          // CTRL+CLIC suma o quita, igual que en la teja. En los cuadrantes 2D ctrl
          // está libre: el pan es el botón del medio y shift son las cotas.
          if (evt.ctrlKey || evt.metaKey) { _alternarSeleccion(ci); return; }
          _seleccionar(ci);
          if (ST.tool === 'mover' && uv) {
            // pushed:false → el snapshot se toma en el 1er movimiento real (un
            // simple clic para seleccionar NO ensucia el stack de undo).
            // bloq: ver TE_MOVER_A_MANO. El arrastre SE ARMA igual estando apagado,
            // a propósito: así el primer movimiento real tiene a quién avisarle en
            // vez de que la barra simplemente no responda y parezca un cuelgue.
            ST.dragMove = { ci: ci, plano: plano, startHost: _clickHost(plano, uv), startHint: _clonHint(ci), pushed: false, bloq: !TE_MOVER_A_MANO };
          }
          evt.preventDefault();
          return;
        }

        // Rotar: clic en vacío no hace nada; se rota con ESPACIO o botón.
        // Mover: pick por PROXIMIDAD (fallback del data-ci — cubre clics sobre el
        // render 3D de la barra fuera de la geometría SVG de hit) y recién si no
        // hay nada cerca, deseleccionar.
        if (ST.tool === 'mover') {
          var pk = _pickBarra(plano, sp.px, sp.py);
          if (pk >= 0) {
            _seleccionar(pk);
            if (uv) ST.dragMove = { ci: pk, plano: plano, startHost: _clickHost(plano, uv), startHint: _clonHint(pk), pushed: false, bloq: !TE_MOVER_A_MANO };
            evt.preventDefault();
            return;
          }
          _seleccionar(-1);
        }
      });

    });

    // Arrastre: se escucha en GLOBAL (no en cada svg) para no perder el arrastre
    // si el cursor sale del cuadrante. Usa el plano guardado en el objeto de drag.
    if (!ST._dragBound) {
      ST._dragBound = true;
      global.addEventListener('mousemove', function (evt) {
        var drag = ST.dragMove || ST.dragMarco || ST.dragRango;
        if (!drag) return;
        var plano = drag.plano;
        var svg = $(SVG_ID[plano]); if (!svg) return;
        var sp = _svgPoint(svg, evt); if (!sp) return;
        var uv = _pixelToUV(plano, sp.px, sp.py);
        if (ST.dragMove && uv) { _dragMover(plano, uv); }
        else if (ST.dragMarco) { _dragMarcoMove(plano, uv); }
        else if (ST.dragRango) { _dragRangoMove(plano, sp); }
      });
      global.addEventListener('mouseup', function () {
        if (!(ST.dragMove || ST.dragMarco || ST.dragRango)) return;
        ST.dragMove = null; ST.dragMarco = null; ST.dragRango = null;
        _renderPanel();
        // AL SOLTAR SE BORRAN LAS COTAS VIVAS (las del abanico y las de la pieza).
        // _renderPanel NO toca el overlay SVG, y el último rAF del arrastre ya se
        // había ejecutado si el usuario paró la mano ≥1 frame antes de soltar: los
        // números se quedaban pegados en la vista hasta el siguiente redibujo.
        // Cuesta UN repintado, y sólo al soltar.
        _sincronizarOverlayOrto();
      });
    }
  }

  function _clonHint(ci) {
    var c = ST.receta.componentes[ci];
    return c && c.pos_hint ? { x: c.pos_hint.x, y: c.pos_hint.y, z: c.pos_hint.z } : {};
  }

  function _dragMover(plano, uv) {
    var dm = ST.dragMove; if (!dm) return;
    // MOVER A MANO APAGADO (ver TE_MOVER_A_MANO): se avisa UNA vez por arrastre —no en
    // cada mousemove— y no se toca la barra.
    if (dm.bloq) {
      if (!dm.aviso) {
        dm.aviso = true;
        _actualizarStatus('Mover la barra a mano está desactivado. Usa los campos de Offset de la ficha, o arrastra los tiradores del marco y del abanico.');
      }
      return;
    }
    var c = ST.receta.componentes[dm.ci]; if (!c) return;
    if (!dm.pushed) { _pushUndo(); dm.pushed = true; }   // snapshot en el 1er move
    var host = _clickHost(plano, uv);
    var dx = host.x - dm.startHost.x, dy = host.y - dm.startHost.y, dz = host.z - dm.startHost.z;
    var base = dm.startHint || {};
    c.pos_hint = c.pos_hint || {};
    // CORRECCIÓN INTERNA (§INTERACCIÓN-2.0 · triple contabilidad de Y): un CABEZAL
    // NO puede moverse en Y — la Y la manda el sistema de capas (distribuidorLayered)
    // + el retranqueo por dependencias. Escribir pos_hint.y en un cabezal chocaría
    // con las capas. Por eso, para cabezales, el arrastre solo toca X/Z (la Y queda
    // gobernada por las capas). Estribos/trabas SÍ pueden ajustar Y (no son layered).
    var esCabezal = (_rolComp(c) === 'cabezal');
    // Solo mueve en los ejes que el plano controla.
    if (plano === 'seccion') {
      c.pos_hint.z = (base.z || 0) + dz;                         // ancho (Z) — siempre
      if (!esCabezal) c.pos_hint.y = (base.y || 0) + dy;         // Y sólo si NO es cabezal
    } else if (plano === 'largo') {
      c.pos_hint.x = (base.x || 0) + dx;                         // largo (X) — siempre
      if (!esCabezal) c.pos_hint.y = (base.y || 0) + dy;         // Y sólo si NO es cabezal
    } else {
      c.pos_hint.x = (base.x || 0) + dx;
      c.pos_hint.z = (base.z || 0) + dz;
    }
    // DONDE LA SOLTASTE ES EL ANCLA: la POSICIÓN de la barra se guarda como distancia
    // al borde más cercano de su eje, no como coordenada fija. Sin esto, la barra
    // arrastrada a 50 cm del testero aparecía a 150 cm del testero en cuanto la viga
    // pasaba de 600 a 800.
    // ACÁ SÓLO SE INVALIDA el ancla vieja: para ESCRIBIRLA hace falta saber dónde
    // nace la pieza sin traslación, y eso sólo lo sabe el motor mientras expande. La
    // estampa él en el _regenerarDiferido de la línea siguiente (ver «SE ANCLA LA
    // POSICIÓN» en reglas.js).
    _anclarHintUI(c);
    _regenerarDiferido();
  }

  // ==========================================================================
  // TIRADOR DEL MARCO DE LA BARRA (17-ago) — arrastrar un borde del bbox de la
  // pieza seleccionada ESTIRA/ACHICA la pieza escribiendo el Δ del lado que
  // corresponde. GENÉRICO para cualquier figura y cualquier vista: qué lado
  // manda en ese borde, con qué extremo y a qué razón se mueve NO sale de
  // ninguna tabla — se SONDEA con el motor al agarrar: se expande un clon con
  // +5 cm de Δ en cada lado candidato y se mide qué borde del bbox se movió.
  // El lado cuyo Δ mueve el borde agarrado (y deja quieto el opuesto) gana; si
  // el crecimiento es simétrico (el motor centra) igual sirve, con razón 0.5.
  // Así el tirador y el campo Δ de la ficha son la MISMA perilla (conversan).
  // ==========================================================================
  // bbox de UN SOLO placement (el primero). No se une la distribución completa a
  // propósito: la FORMA es idéntica en todas las copias, y si el n de placements
  // cambiara entre la expansión base y la sondeada (medido en headless: 5 → 1),
  // el bbox unión mediría el reparto y no la pieza — el sondeo daría falsos NO.
  function _bboxUVdePls(pls, plano) {
    var pj = _proyDe(plano);
    var pl = (pls && pls.length) ? pls[0] : null;
    if (!pl) return null;
    var b = { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity };
    (pl.puntos || []).forEach(function (pt) {
      var q = pj(pt);
      if (!isFinite(q.u) || !isFinite(q.v)) return;
      if (q.u < b.u0) b.u0 = q.u; if (q.u > b.u1) b.u1 = q.u;
      if (q.v < b.v0) b.v0 = q.v; if (q.v > b.v1) b.v1 = q.v;
    });
    return isFinite(b.u0) ? b : null;
  }

  // EL RÉGIMEN EN EL QUE VA A CAER EL GESTO: un clon del componente con el ancla de
  // posición invalidada, o sea colocado por su `pos_hint` crudo. Es LA MISMA PUERTA
  // que usa _anclarHintUI sobre el componente de verdad (reglas.anclarPosHint sin
  // base = «esto que había ya no vale»), y por eso lo que se mida acá es lo que el
  // usuario va a ver. Sin componente con hint no hace nada.
  function _sinAnclaVieja(clon, host) {
    var R = global.ModeladorReglas;
    if (!R || typeof R.anclarPosHint !== 'function') return clon;
    try { R.anclarPosHint(clon, host, true); } catch (e) { /* nunca romper el arrastre */ }
    return clon;
  }

  // BORDES DE LA PIEZA SOBRE UN EJE DEL MUNDO (cm), expandiendo un CLON con el
  // hormigon de ahora. Se usa a mitad de arrastre, cuando ST.ultimoOut todavia
  // muestra el estado anterior: preguntarle al motor es lo unico honesto.
  //
  // SE MIDE CON EL ANCLA DE POSICIÓN INVALIDADA, que es como la deja el gesto
  // (25-ago, la deriva que quedaba: «el primero que ya desplacé se desplaza un
  // poco»). El ancla guarda `base + hint` y `base` —dónde nace la pieza SIN
  // traslación— depende del TAMAÑO: apenas el tirador reescribe la medida, el ancla
  // vieja deja de describir la pieza y pasa a pinchar el CENTRO del grupo. Medir con
  // ella era medir un estado que nunca iba a existir, porque el arrastre escribe
  // pos_hint y la invalida: la corrección salía calculada en un régimen y aplicada
  // en el otro. MEDIDO (estribo repartido a lo alto, 2º tirador de 40 cm arrastrado
  // con el mouse): el borde ya colocado se corría 19,5 cm — medio centímetro por
  // cada centímetro de medida. Invalidándola acá: 0.
  function _bordesEjeMundo(c, eje) {
    var R = global.ModeladorReglas, host = ST.receta && ST.receta.geometria;
    if (!R || !R.expandirComponente || !host || !c || !eje) return null;
    var pls;
    try {
      var clon = JSON.parse(JSON.stringify(c, function (k, v) {
        return (String(k).charAt(0) === '_') ? undefined : v;
      }));
      _sinAnclaVieja(clon, host);
      pls = R.expandirComponente(clon, host) || [];
    } catch (e) { return null; }
    var pl = pls[0];
    if (!pl || !pl.puntos || !pl.puntos.length) return null;
    var lo = Infinity, hi = -Infinity;
    pl.puntos.forEach(function (q) {
      var v = Number(q[eje]);
      if (!isFinite(v)) return;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    });
    return isFinite(lo) ? { lo: lo, hi: hi } : null;
  }

  // ¿Hacia donde crece este eje del mundo en la vista? La camara de algunos
  // cuadrantes mira "al reves", asi que el borde de la derecha en pantalla no
  // siempre es el maximo del eje. Se pregunta proyectando dos puntos.
  function _ejeMundoCreceHacia(plano, ejeVista, ejeMundo) {
    var pj = _proyDe(plano);
    var a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
    b[ejeMundo] = 1;
    var qa = pj(a), qb = pj(b);
    var d = (ejeVista === 'u') ? (qb.u - qa.u) : (qb.v - qa.v);
    return (d < 0) ? -1 : 1;
  }

  function _iniciarDragMarco(plano, ci, eje, ladoUV, uv0) {
    var c = ST.receta.componentes[ci]; if (!c) return;
    var R = global.ModeladorReglas, host = ST.receta && ST.receta.geometria;
    if (!R || !R.expandirComponente || !host) return;
    var PROBE = 5;   // cm del sondeo: grande contra redondeos, chico contra avisos
    // expande un CLON (sin campos runtime _*) con un Δ extra opcional en un lado.
    // EL SONDEO MIDE EN EL MISMO RÉGIMEN QUE EL ARRASTRE (25-ago): con el ancla de
    // posición viva, el motor pincha el CENTRO del grupo y TODO candidato mueve los
    // dos bordes por igual — el sondeo devolvía ratio 0,5 para los dos extremos y el
    // desempate «seguí el extremo ya escrito» dejaba el tirador cargando por el lado
    // contrario al que el usuario agarró. MEDIDO: un 3er gesto de 25 cm sobre el
    // borde 'fin' seguía escribiendo extremo 'ini' y la pieza se achicaba centrada,
    // 12,5 cm de deriva del borde opuesto en un solo salto.
    function expandir(mod) {
      var clon = JSON.parse(JSON.stringify(c, function (k, val) {
        return (String(k).charAt(0) === '_') ? undefined : val;
      }));
      _sinAnclaVieja(clon, host);
      if (mod) {
        clon.dims = clon.dims || {};
        var d = clon.dims[mod.L];
        if (!d || typeof d !== 'object') {
          d = clon.dims[mod.L] = (d != null && isFinite(Number(d)))
            ? { modo: 'fija', valor: Number(d) } : { modo: 'auto' };
        }
        d.delta = (Number(d.delta) || 0) + mod.delta;
        d.extremo = mod.extremo;
      }
      try { return R.expandirComponente(clon, host) || []; } catch (e) { return []; }
    }
    // La expansión base sirve para DOS cosas: el bbox contra el que se sondea y
    // la MEDIDA que tiene ahora mismo cada lado (`pl.dims`), que es la que el
    // arrastre va a mover y a dejar escrita.
    var pls0 = expandir(null);
    var b0 = _bboxUVdePls(pls0, plano);
    var dims0 = (pls0[0] && pls0[0].dims) || {};
    if (!b0) { _actualizarStatus('No se pudo medir la pieza en esta vista.'); return; }
    // EL PAR ESPEJO ES UNA SOLA PERILLA (fix 17-ago, «pasado la mitad se
    // bloquea»). B y D miden LA MISMA medida del marco: escribir Δ propio en los
    // DOS dispara la regla del motor «Δ distintos en el par → se dibuja el
    // mayor», y el sondeo sobre el par de un lado ya arrastrado no medía el
    // efecto de +5 sino el salto del conflicto (~40 cm de borde por cm de Δ):
    // ganaba el par, el drag escribía el lado equivocado y el estribo quedaba
    // trabado/saltando. Por eso: todo candidato se PLIEGA al lado del par que ya
    // trae perilla propia, y el par jamás recibe nada nuevo desde el tirador — su
    // medida (o su Δ) se la replica el motor, que es donde vive esa regla.
    var fpM = global.ModeladorFiguraPuntos || {};
    var pares = (fpM.paresEspejoFigura ? fpM.paresEspejoFigura(c.figura) : null) || {};
    // PERILLA PROPIA de un lado = lo que el usuario ya escribió en ÉL: un Δ, o
    // una MEDIDA FIJA. Antes sólo contaba el Δ porque era lo único que el tirador
    // escribía; desde que escribe medida, un lado ya arrastrado se reconoce por su
    // fija — si no, el 2º arrastre podía plegarse al par y escribir el lado
    // equivocado (que es el defecto que este plegado existe para impedir).
    function perillaPropiaDe(L) {
      var d = c.dims && c.dims[L];
      if (!d || typeof d !== 'object') return null;
      return (d.delta || (d.modo === 'fija' && isFinite(Number(d.valor)))) ? d : null;
    }
    function plegarAlKnob(L) {
      if (perillaPropiaDe(L)) return L;
      var P = pares[L];
      return (P && perillaPropiaDe(P)) ? P : L;
    }
    // candidatos: primero los lados que YA traen Δ propio (arrastrar continúa lo
    // escrito en vez de pelearlo), después el resto de los lados de la figura —
    // cada uno PLEGADO a su knob y sin duplicados.
    var spec = _figSpec(c.figura);
    var lados = [];
    function agregar(L) { L = plegarAlKnob(L); if (lados.indexOf(L) < 0) lados.push(L); }
    Object.keys(c.dims || {}).forEach(function (L) { if (perillaPropiaDe(L)) agregar(L); });
    ((spec && spec.parciales) || Object.keys(c.dims || {})).forEach(agregar);
    var mejor = null;
    lados.forEach(function (L) {
      // La perilla ya escrita en ESTE lado (Δ o medida) y el borde por el que se
      // desarrolla. El default no es el mismo en las dos: un Δ sin extremo crece
      // por 'fin' y una medida fija sin extremo crece CENTRADA — es lo que hace el
      // motor, y si acá se supusiera otra cosa la línea base del sondeo mediría un
      // recolocado que no existe.
      var dEx = perillaPropiaDe(L);
      var extEx = !dEx ? null
        : ((dEx.extremo === 'ini') ? 'ini'
          : (dEx.extremo === 'fin' ? 'fin'
            : (dEx.extremo === 'centro' ? 'centro' : (dEx.delta ? 'fin' : 'centro'))));
      ['fin', 'ini'].forEach(function (E) {
        // LÍNEA BASE POR CANDIDATO: si el lado ya acumula Δ con OTRO extremo,
        // compararlo contra el estado actual mediría el volteo del acumulado
        // (todo el Δ cambia de borde), no el efecto de +5. Se rebasa: la base
        // de ese candidato es el MISMO Δ ya recolocado en el extremo E.
        var b0E = b0;
        if (dEx && extEx !== E) {
          b0E = _bboxUVdePls(expandir({ L: L, delta: 0, extremo: E }), plano);
          if (!b0E) return;
        }
        var span0E = (eje === 'u') ? (b0E.u1 - b0E.u0) : (b0E.v1 - b0E.v0);
        var b1 = _bboxUVdePls(expandir({ L: L, delta: PROBE, extremo: E }), plano);
        if (!b1) return;
        var span1 = (eje === 'u') ? (b1.u1 - b1.u0) : (b1.v1 - b1.v0);
        if (Math.abs(span1 - span0E) < 0.25 * PROBE) return;   // no manda en este eje
        // cuánto salió hacia AFUERA el borde agarrado, y cuánto el opuesto
        var mAg, mOp;
        if (eje === 'u') {
          mAg = (ladoUV === '+') ? (b1.u1 - b0E.u1) : -(b1.u0 - b0E.u0);
          mOp = (ladoUV === '+') ? -(b1.u0 - b0E.u0) : (b1.u1 - b0E.u1);
        } else {
          mAg = (ladoUV === '+') ? (b1.v1 - b0E.v1) : -(b1.v0 - b0E.v0);
          mOp = (ladoUV === '+') ? -(b1.v0 - b0E.v0) : (b1.v1 - b0E.v1);
        }
        if (mAg < 0.1 * PROBE) return;   // ese extremo crece hacia el otro lado
        var cand = {
          L: L, extremo: E,
          ratio: mAg / PROBE,                                  // cm de borde por cm de Δ
          // 1 = solo ese borde se mueve; continuar el extremo YA escrito gana
          // los empates (cambiar de extremo recoloca el acumulado = salto)
          score: (mAg - Math.max(0, mOp)) / PROBE + ((dEx && extEx === E) ? 0.05 : 0)
        };
        if (!mejor || cand.score > mejor.score + 1e-9 ||
            (Math.abs(cand.score - mejor.score) <= 1e-9 && cand.ratio > mejor.ratio)) mejor = cand;
      });
    });
    if (!mejor) {
      _actualizarStatus('Ningún lado de la ' + (c.figura || 'figura') + ' mueve ese borde en esta vista.');
      return;
    }
    // MEDIDA DE PARTIDA del lado que manda: la que ese lado tiene AHORA según el
    // motor. Es la que el arrastre mueve y la que va a quedar escrita — el gesto
    // dice «que mida esto». `delta0` es el Δ que el usuario haya escrito A MANO en
    // ese lado: sigue vivo y se descuenta del valor guardado para que la suma
    // (valor + Δ) dé exactamente la medida hasta donde se soltó el tirador.
    var dRef = (c.dims && typeof c.dims[mejor.L] === 'object') ? c.dims[mejor.L] : null;
    var d0 = dRef ? (Number(dRef.delta) || 0) : 0;
    var m0 = Number(dims0[mejor.L]);
    if (!isFinite(m0)) {
      _actualizarStatus('El motor no reporta medida para el lado ' + mejor.L +
        ': no se puede redimensionar arrastrando.');
      return;
    }
    // EL BORDE OPUESTO SE QUEDA QUIETO (24-ago). Ver la nota larga en
    // _dragMarcoMove: el tirador cambia el TAMANO y el motor vuelve a centrar la
    // pieza, asi que los DOS bordes se mueven. Acá se decide si esta pieza acepta
    // que le compensemos la posicion, y contra que borde del mundo.
    //   · EL EJE DEL MUNDO que corre por el borde agarrado.
    //   · SI LA POSICION EN ESE EJE ES NUESTRA: la misma lista que ofrecen los
    //     campos de Offset de la ficha (_ejesDesplazables). Si por ese eje la pieza
    //     REPARTE, la posicion la manda el abanico y no se toca: ahi el tirador
    //     sigue como siempre (crece centrado sobre cada copia).
    //   · QUE BORDE es el agarrado en coordenadas del mundo (la camara puede estar
    //     mirando al reves).
    // Con compensacion el borde agarrado sigue al cursor 1:1, asi que la razon del
    // sondeo (0.5 cuando el motor centra) deja de aplicarse al numero.
    var defP = (_defsPlanos() || {})[plano] || null;
    var ejeMundo = defP ? ((eje === 'u') ? defP.u : defP.v) : null;
    var compensa = !!(ejeMundo && _ejesDesplazables(c).indexOf(ejeMundo) >= 0);
    var signo = ejeMundo ? _ejeMundoCreceHacia(plano, eje, ejeMundo) : 1;
    ST.dragMarco = {
      plano: plano, ci: ci, eje: eje, ladoUV: ladoUV,
      L: mejor.L, extremo: mejor.extremo, ratio: mejor.ratio || 1,
      medida0: m0, delta0: d0, uv0: uv0, pushed: false,
      ejeMundo: ejeMundo, compensa: compensa,
      agarradoEsMax: (ladoUV === '+') ? (signo > 0) : (signo < 0)
    };
  }

  function _dragMarcoMove(plano, uv) {
    var dm = ST.dragMarco; if (!dm || !uv) return;
    var c = ST.receta.componentes[dm.ci]; if (!c) return;
    if (!dm.pushed) { _pushUndo(); dm.pushed = true; }   // snapshot en el 1er move real
    var mov = (dm.eje === 'u') ? (uv.u - dm.uv0.u) : (uv.v - dm.uv0.v);
    var afuera = (dm.ladoUV === '+') ? mov : -mov;       // + = agrandar la pieza
    // PASO 1 cm, el mismo del resto de los arrastres: era 0.5 y el usuario lo corrigió
    // el 18-ago — «no fabricamos al milímetro, fabricamos al centímetro».
    var pasoT = PASO_ARRASTRE_CM;
    // EL BORDE AGARRADO SIGUE AL CURSOR 1:1 cuando compensamos (abajo). Sin
    // compensacion vale la razon del sondeo: si el motor reparte el crecimiento
    // entre los dos bordes, 1 cm de cursor son 2 cm de medida.
    var medida = Math.round((dm.medida0 + afuera / (dm.compensa ? 1 : (dm.ratio || 1))) / pasoT) * pasoT;
    // Donde esta AHORA el borde que NO se agarro. Se mide antes de escribir la dim
    // para poder devolverlo a su sitio despues.
    var b0 = dm.compensa ? _bordesEjeMundo(c, dm.ejeMundo) : null;
    c.dims = c.dims || {};
    var d = c.dims[dm.L];
    if (!d || typeof d !== 'object') {
      d = c.dims[dm.L] = (d != null && isFinite(Number(d)))
        ? { modo: 'fija', valor: Number(d) } : { modo: 'auto' };
    }
    // EL TIRADOR ESCRIBE UNA MEDIDA, NO UN DESCUENTO (21-ago).
    // Antes escribía Δ, o sea «tanto menos de lo que dé el hormigón»: un ajuste
    // RELATIVO. El usuario achicó un estribo de confinamiento con el muro en 600 y
    // al bajar el muro a 200 el estribo se achicó dos veces (bajó el 'auto' y el Δ
    // seguía montado encima) — MEDIDO: Δ −30 sobre un lado cuyo auto valía 13 dejó el
    // lado en −17 cm. Arrastrar el tirador significa «que mida esto», así que se
    // guarda la MEDIDA EFECTIVA y deja de depender del hormigón.
    //
    // SE FIJA ESTE LADO Y SU ESPEJO, NUNCA LA PIEZA ENTERA: el par que cruza el
    // espesor no se toca y sigue en 'auto' para reajustarse con los recubrimientos.
    // La réplica al espejo NO se escribe acá — la hace el motor (reglas._fijasEspejo),
    // el mismo sitio y la misma regla con la que ya replicaba el Δ.
    //
    // EL Δ ESCRITO A MANO SIGUE VIVO: es una intención distinta y válida. Como la
    // dim final es valor + Δ, se guarda `medida − Δ` para que el lado termine
    // midiendo justo donde quedó el tirador.
    d.modo = 'fija';
    d.valor = medida - dm.delta0;
    d.extremo = dm.extremo;
    // ==================================================================
    // EL BORDE OPUESTO SE QUEDA QUIETO (24-ago, defecto reportado por el usuario)
    // ------------------------------------------------------------------
    // EL DEFECTO. El usuario achicó un estribo de confinamiento con un tirador
    // hasta dejarlo sobre la 4ª capa de cabezales, y al arrastrar el OTRO tirador
    // para que alcanzara también la 3ª «se desajustaba completo». MEDIDO: el
    // tirador sólo escribía TAMAÑO, y una pieza sin posición propia el motor la
    // CENTRA — así que al cambiar la medida se movían LOS DOS bordes. El primer
    // arrastre se sentía perfecto (el borde agarrado sigue al cursor) mientras el
    // otro borde se corría en silencio la misma cantidad; recién el segundo
    // arrastre lo hacía evidente, porque ahí el que se corría era el que el
    // usuario acababa de colocar a mano.
    //
    // POR QUÉ EL OTRO ORDEN SÍ FUNCIONABA: tirador (tamaño) y después Offset
    // (posición) escriben campos DISTINTOS y no se pisan. Dos tiradores escribían
    // dos veces el mismo campo, y el segundo deshacía la intención del primero.
    // Los dos caminos tenían que llegar al mismo estado y no llegaban.
    //
    // LA REGLA: arrastrar un tirador mueve ESE borde y deja el otro donde está.
    // Se mide dónde quedó el borde opuesto después de reescribir la medida y se
    // corrige la posición por la diferencia — por la MISMA puerta que usan los
    // campos de Offset (pos_hint + ancla invalidada), no por un camino aparte. Así
    // dos tiradores dejan exactamente el mismo estado que tirador + Offset, y la
    // posición resultante queda anclada a su cara: sobrevive al cambio de
    // hormigón igual que la que se escribe a mano (MEDIDO: muro 600 → 800 → 400,
    // el hueco al testero no se mueve).
    //
    // CUÁNDO NO: si por ese eje la pieza REPARTE, la posición la manda el abanico
    // y no es nuestra para tocar (los campos de Offset tampoco la ofrecen). Ahí el
    // tirador sigue comportándose como antes: cada copia crece centrada.
    // ==================================================================
    if (dm.compensa && b0) {
      var b1 = _bordesEjeMundo(c, dm.ejeMundo);
      if (b1) {
        var corr = dm.agarradoEsMax ? (b0.lo - b1.lo) : (b0.hi - b1.hi);
        if (isFinite(corr) && corr) {
          c.pos_hint = c.pos_hint || {};
          c.pos_hint[dm.ejeMundo] = (Number(c.pos_hint[dm.ejeMundo]) || 0) + corr;
        }
      }
      // EL ANCLA SE INVALIDA AUNQUE LA CORRECCIÓN HAYA DADO 0 (25-ago, la deriva que
      // quedaba). Cambiar el TAMAÑO ya la dejó vieja: guarda `base + hint` y `base`
      // depende del tamaño. Dejarla viva no es «no tocar nada» — el motor la resuelve
      // en la regeneración siguiente, pincha el CENTRO del grupo y REESCRIBE el hint
      // con lo que le dé, así que la pieza se achica hacia adentro por los dos lados.
      // MEDIDO: medio centímetro de borde opuesto por cada centímetro de medida, o
      // sea 19,5 cm en un arrastre de 40 hecho con el mouse (paso a paso) y 12,5 en
      // uno de 25 de un solo salto. La re-estampa el motor al expandir, ya con el
      // tamaño y la posición nuevos.
      _anclarHintUI(c);
    }
    _actualizarStatus('Lado ' + dm.L + ' = ' + medida + ' cm (' +
      (dm.extremo === 'ini' ? '← ini' : 'fin →') + ')' +
      (dm.delta0 ? ' — incluye el Δ ' + dm.delta0 + ' de la ficha' : '') + '.');
    _regenerarDiferido();
  }

  // Arrastre del rango: se mueve sobre el EJE DE DISTRIBUCIÓN REAL del componente
  // (X normal, Z si la pieza está volteada), sea ese eje el horizontal o el vertical
  // de la vista. Los factores ku/kv llevan el signo del transform → el arrastre sigue
  // al cursor también en las vistas cuya cámara mira "al revés".
  function _dragRangoMove(plano, sp) {
    var dr = ST.dragRango; if (!dr) return;
    var c = ST.receta.componentes[dr.ci]; if (!c) return;
    var t = ST.transforms[plano]; if (!t) return;
    var def = (_defsPlanos() || {})[plano]; if (!def) return;
    // QUÉ LÍNEA se está arrastrando (1ª o la 2ª del arreglo): viene del elemento
    // que se agarró. Sin esto, mover la 2ª flecha reescribía el rango de la 1ª.
    var cual = dr.cual || 'rango';
    var eje = dr.eje || _ejeDistDe(c);
    var dHost;
    if (eje === def.u) { dHost = (sp.px - dr.lastX) / t.ku; }
    else if (eje === def.v) { dHost = (sp.py - dr.lastY) / t.kv; }
    else return;
    dr.lastX = sp.px; dr.lastY = sp.py;
    if (!isFinite(dHost) || !dHost) return;
    var d = c.distribucion = c.distribucion || {};
    // PRIMER arrastre sobre la flecha "inactiva" (preview): ACTIVAR la distribución.
    // Ese es el único gesto que la enciende (ya no hay herramienta ↔ Rango de 2 clics).
    if (!d.activa && cual === 'rango') {
      if (d.sep == null) d.sep = _sepDefault(c.tipologia);
      if (_modoDe(c) !== 'arreglo') { c.modo = 'lineal'; d.modo = 'linear'; }
      d.activa = true;
      d.rango = _rangoDefault(d.sep, eje);
      // La barra base ya no necesita pos_hint en ese eje (el rango la distribuye).
      // Su ancla se va CON él: dejarla suelta guardaba en la receta una intención de
      // una posición que ya no existe, y volvería a aplicarse si ese eje recibiera
      // otro hint más adelante.
      if (c.pos_hint) delete c.pos_hint[eje];
      if (c.pos_ancla) delete c.pos_ancla[eje];
      // LA FICHA CAMBIA DE FORMA (aparecen los campos del rango), así que acá SÍ se
      // re-arma el panel — una sola vez, en el frame en que la distribución se
      // enciende. Los refrescadores en vivo sólo saben reescribir valores de campos
      // que ya existen, y estos todavía no existían. Es seguro: el arrastre vive en
      // ST + el listener global del window, no en el DOM del panel.
      _renderPanel();
    }
    var rango = d[cual] || _rangoDefault(d.sep, eje);
    if (dr.div != null) {
      // DIVISOR de tramo: mueve el límite entre dos tramos contiguos. Trabaja con la
      // coordenada ABSOLUTA bajo el cursor (no con el delta) para poder SNAPear a las
      // caras del eje igual que los handles.
      d[cual] = rango;
      var hd = _hostEnEje(plano, sp, eje);
      if (hd == null) return;
      hd = _snapValor(hd, _facesEje(eje));
      var sgn = (Number(rango.to) >= Number(rango.from)) ? 1 : -1;
      _moverDivisor(d, dr.div, sgn * (hd - rango.from));
      _regenerarDiferido();
      return;
    }
    if (dr.end === 'from' || dr.end === 'to') {
      // SNAP A NODOS (punto 4c) — el handle de extremo ya no se ajusta "al ojo": la
      // coordenada bajo el cursor se pega a las caras del eje (bordes del hormigón,
      // líneas de recubrimiento, centro) y a la grilla, igual que al colocar. `grab`
      // conserva el desfase con que se agarró el handle → no salta al cursor.
      var hv = _hostEnEje(plano, sp, eje);
      if (hv == null) { rango[dr.end] += dHost; }
      else {
        if (dr.grab == null) dr.grab = hv - rango[dr.end];
        rango[dr.end] = _snapValor(hv - dr.grab, _facesEje(eje));
      }
    } else {
      // TRAMO DEL MEDIO → DESPLAZA EL RANGO ENTERO. Antes iba con el delta crudo y
      // el snap se PERDÍA apenas se arrastraba (el usuario: "cuando desplazamos la
      // línea verde se pierde el snap inicial"): los extremos snapeaban al agarrar
      // y después flotaban. Ahora se snapea el extremo que va ADELANTE del gesto
      // (el que el usuario está mirando) contra las mismas caras que usan los
      // handles, y el otro lo acompaña RÍGIDO: el largo del rango no cambia.
      var largoR = Number(rango.to) - Number(rango.from);
      var hm = _hostEnEje(plano, sp, eje);
      if (hm == null) { rango.from += dHost; rango.to += dHost; }
      else {
        var haciaFin = (dHost > 0) === (largoR >= 0);
        var guia = haciaFin ? 'to' : 'from';
        if (dr.grabMid == null) dr.grabMid = hm - Number(rango[guia]);
        var nuevo = _snapValor(hm - dr.grabMid, _facesEje(eje));
        if (guia === 'to') { rango.to = nuevo; rango.from = nuevo - largoR; }
        else { rango.from = nuevo; rango.to = nuevo + largoR; }
      }
    }
    if (rango.eje == null) rango.eje = eje;
    d[cual] = rango;
    // ARRASTRASTE = MOVISTE LA INTENCIÓN: el ancla se re-deriva del punto donde
    // quedó el handle (borde más cercano), no sólo su coordenada.
    _anclarRangoUI(rango, eje);
    _syncN(d, cual, true);                  // arrastraste: N sigue al largo nuevo
    if (cual === 'rango') _syncTramos(d);   // los tramos viven en la 1ª línea
    // UN SOLO REPINTADO POR FRAME. Acá había además un _sincronizarOverlayOrto(),
    // que es _redibujar2D(ST.ultimoOut): cada una tiene su propio flag (_overlayPend
    // / _regenPendiente) pero las dos se encolan en el MISMO rAF, así que los 3
    // cuadrantes se dibujaban DOS veces por frame de arrastre — la primera con el
    // `out` VIEJO, que ni siquiera es el que se acaba de mover. Se queda el
    // _regenerarDiferido, que redibuja al final de _regenerar y con el resultado
    // bueno. Medido en headless sobre la viga-semilla (72 placements): generarViga
    // 3.6 ms por frame y _dibujarFlechaRango 0.59 ms por vista — el repintado
    // duplicado era ~1.8 ms de los 16.7 que da un frame a 60 fps, tirados.
    _regenerarDiferido();
  }

  // ==========================================================================
  // PANEL IZQUIERDO — render dinámico desde ST.receta.componentes
  // ==========================================================================
  var LETRAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

  // EL PANEL SE PINTA EN DOS TROZOS INDEPENDIENTES (20-ago).
  //   _renderGrilla()  → las tejas. Depende de CUÁNTOS componentes hay y de la
  //                      identidad de cada uno. Sólo cambia con mutaciones.
  //   _renderDetalle() → la ficha de la barra seleccionada. Depende de QUIÉN está
  //                      seleccionado y de la forma de su ficha.
  // POR QUÉ SEPARADOS: antes _renderPanel re-armaba TODO el DOM del panel en cada
  // mutación y en cada cambio de selección. Con la ficha en zona propia, cambiar de
  // teja no tiene por qué reconstruir la grilla (y encima le perdería el scroll):
  // basta mover la clase .sel. _renderPanel queda como el camino COMPLETO, para los
  // llamadores estructurales (colocar, borrar, deshacer, abrir template…).
  function _renderPanel() {
    if (!$('te_compList') || !ST.receta) return;   // sin panel en el DOM no hay nada que pintar
    _renderGrilla();
    _renderDetalle();
    // El selector de elemento se habilita/deshabilita según haya barras: hay que
    // refrescarlo con cada mutación (colocar la 1ª barra lo bloquea; borrar la
    // última lo libera).
    _renderElemSel();
    _actualizarStatus();
    // La ficha flotante del 3D muestra la SELECCIÓN: se repinta acá porque este es
    // el punto por el que pasa todo cambio de selección.
    _pintarFichaSel();
  }

  // CAMBIÓ SÓLO LA SELECCIÓN: la grilla se queda como está (no se re-arma ni pierde
  // su scroll), sólo se mueve la marca y se repinta la ficha.
  function _renderSeleccion() {
    if (!$('te_compList') || !ST.receta) return;
    _marcarSelGrilla();
    _renderDetalle();
    _actualizarStatus();
    _pintarFichaSel();
  }

  function _renderGrilla() {
    var cont = $('te_compList'); if (!cont || !ST.receta) return;
    var cnt = $('te_compCount'); if (cnt) cnt.textContent = ST.receta.componentes.length;
    cont.innerHTML = '';
    // GRILLA VACÍA: se dice qué hacer AHÍ, que es donde el usuario está mirando, y
    // se va sola con la primera barra. Reemplaza a la nota fija que vivía bajo el
    // botón y que seguía ahí con el template lleno.
    if (!ST.receta.componentes.length) {
      var vacio = _div('te-note');
      vacio.style.marginTop = '2px';
      vacio.textContent = 'Todavía no hay barras: se agregan con ＋ Agregar barra y un clic en una vista.';
      cont.appendChild(vacio);
    }
    ST.receta.componentes.forEach(function (c, ci) {
      cont.appendChild(_compEl(c, ci));
    });
    _habilitarDropCola(cont);
  }

  // Mueve la marca de selección entre tejas YA pintadas y trae a la vista la que
  // quedó elegida (seleccionar desde una vista 2D/3D puede apuntar a una teja que
  // está fuera del scroll de la grilla). 'nearest' = no mueve nada si ya se ve.
  function _marcarSelGrilla() {
    var cont = $('te_compList'); if (!cont) return;
    Array.prototype.forEach.call(cont.querySelectorAll('.te-comp'), function (el) {
      var ciTeja = Number(el.getAttribute('data-ci'));
      var esta = (ciTeja === ST.selCi);
      el.classList.toggle('sel', esta);
      // ACOMPANANTES de una seleccion multiple. Esta funcion marcaba SOLO la
      // principal, asi que ctrl+clic sumaba barras que el resaltado 2D y 3D mostraba
      // pero la tira de tejas no: la marca de la teja solo se ponia al CREARLA, y
      // aca las tejas ya existen. Sin esto, el usuario no tenia como saber cuantas
      // llevaba elegidas justo en el sitio donde las esta eligiendo.
      el.classList.toggle('selx', !esta && (ST.selExtra || []).indexOf(ciTeja) >= 0);
      if (esta && el.scrollIntoView) {
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* navegador sin opciones */ }
      }
    });
  }

  // Repinta UNA teja en su sitio. La usa _mut cuando la ficha cambia algo que la teja
  // muestra (color, tipología, figura, φ, espejo): re-armar la grilla entera por eso
  // sería tirar el scroll y el DOM de las otras N tejas.
  function _refrescarTeja(ci) {
    var cont = $('te_compList'); if (!cont || !ST.receta) return;
    var c = ST.receta.componentes[ci]; if (!c) return;
    var viejo = cont.querySelector('.te-comp[data-ci="' + ci + '"]'); if (!viejo) return;
    cont.replaceChild(_compEl(c, ci), viejo);
  }

  // ZONA DE DETALLE — la ficha del componente seleccionado, en sitio FIJO.
  // Aquí (y sólo aquí) se resetea ST._panelVivo: todos los campos vivos los registra
  // _compBody, así que el DOM que se va es exactamente el que los tenía.
  function _renderDetalle() {
    var host = $('te_detBody'); if (!host) return;
    _bindDetalleAcciones();
    host.innerHTML = '';
    ST._panelVivo = [];   // el DOM viejo se va: sus refrescadores también
    ST._medVivas = [];    // idem: los <span> de las medidas por lado
    var c = (ST.selCi >= 0 && ST.receta && ST.receta.componentes) ? ST.receta.componentes[ST.selCi] : null;
    var sw = $('te_detSw'), tag = $('te_detTag'), bDup = $('te_detDup'), bDel = $('te_detDel');
    if (sw) sw.style.display = c ? '' : 'none';
    if (bDup) bDup.style.display = c ? '' : 'none';
    if (bDel) bDel.style.display = c ? '' : 'none';
    // SIN SELECCIÓN la zona NO se encoge: el hueco reservado es lo que impide que la
    // grilla salte de sitio al seleccionar (que es todo el punto del cambio).
    if (!c) {
      if (tag) tag.textContent = '';
      var vac = _div('te-detvacio');
      vac.textContent = 'Selecciona una barra —abajo en la grilla o directo en una vista— y su ficha se abre aquí.';
      host.appendChild(vac);
      return;
    }
    // ==================================================================
    // CON VARIAS ELEGIDAS, LA FICHA NO SE ABRE (25-ago, pedido del usuario)
    // ------------------------------------------------------------------
    // «El panel de la izquierda me muestra una tipología, pero tengo 2
    // seleccionadas. ¿A cuál le hará los cambios? Ahí debería aparecer algo distinto
    // para no ponerme a editar sin control».
    //
    // Tenía razón y el riesgo es real: la ficha edita SIEMPRE a la principal, así
    // que con cuatro barras elegidas el usuario tocaba un campo creyendo que iba a
    // las cuatro y le cambiaba una sola. No hay forma de que la ficha mienta menos
    // —los campos son de UNA barra: su figura, su φ, su recubrimiento propio—, así
    // que directamente NO se abre: en su lugar va la lista de lo que hay elegido y
    // las dos acciones que sí son plurales, espejar y borrar.
    //
    // SE SALE CLICANDO una de la lista: esa queda sola y su ficha se abre. Es el
    // camino de vuelta más corto y no hay que explicarlo.
    var todos = _selTodos();
    if (todos.length > 1) {
      if (tag) tag.textContent = todos.length + ' barras';
      if (bDup) bDup.style.display = 'none';   // duplicar es de UNA (ver _duplicar)
      host.appendChild(_detalleMultiple(todos));
      return;
    }
    if (sw) sw.style.background = _colorComp(c);
    if (tag) tag.textContent = (c.tipologia || '') + ' · ' + (c.figura || '—') +
      (_poseDe(c).espejo ? ' ⇋' : '');
    host.appendChild(_compBody(c, ST.selCi, _rolComp(c)));
  }

  // El panel de la selección múltiple. Dice CUÁNTAS, CUÁLES, y qué se puede hacer
  // con todas — nada de campos editables, que es justo lo que hay que evitar.
  function _detalleMultiple(todos) {
    var box = _div('te-multi');
    var t1 = _div('te-multi-tit');
    t1.textContent = todos.length + ' barras seleccionadas';
    box.appendChild(t1);

    var t2 = _div('te-multi-sub');
    t2.textContent = 'La ficha edita una sola barra, así que no se abre con varias elegidas. ' +
      'Lo que sí se aplica a todas: Espejar y Borrar.';
    box.appendChild(t2);

    var lista = _div('te-multi-lista');
    // De menor a mayor para que se lea en el orden de la tira (_selTodos las trae al
    // revés porque quien borra necesita ese orden).
    todos.slice().sort(function (a, b) { return a - b; }).forEach(function (ci) {
      var c = ST.receta.componentes[ci];
      if (!c) return;
      var fila = _div('te-multi-fila');
      var sw2 = _div('te-multi-sw');
      sw2.style.background = _colorComp(c);
      fila.appendChild(sw2);
      var txt = _span((c.tipologia || '') + ' · ' + (c.figura || '—') +
        (c.diam ? ' ø' + c.diam : '') + (ci === ST.selCi ? '  (principal)' : ''));
      fila.appendChild(txt);
      fila.title = 'Dejar sólo esta seleccionada y abrir su ficha';
      fila.addEventListener('click', function () { _seleccionar(ci); });
      lista.appendChild(fila);
    });
    box.appendChild(lista);

    var pie = _div('te-multi-pie');
    pie.textContent = 'Clic en una de la lista para dejarla sola y editarla.';
    box.appendChild(pie);
    return box;
  }

  // Duplicar y Quitar: viven en la barra del detalle y actúan sobre la selección
  // vigente, así que se enlazan UNA vez y no se re-crean con cada ficha.
  function _bindDetalleAcciones() {
    var d = $('te_detDup');
    if (d && !d._teBound) {
      d._teBound = true;
      d.addEventListener('click', function (e) { e.stopPropagation(); if (ST.selCi >= 0) _duplicar(ST.selCi); });
    }
    var x = $('te_detDel');
    if (x && !x._teBound) {
      x._teBound = true;
      x.addEventListener('click', function (e) { e.stopPropagation(); _borrarSeleccion(); });
    }
  }

  // ==========================================================================
  // NÚMEROS VIVOS DEL PANEL (21-ago) — el panel sigue al gesto, no al soltar
  // --------------------------------------------------------------------------
  // El panel izquierdo y el dibujo leen la MISMA receta, así que no pueden decir
  // cosas distintas ni por un segundo. Medido antes de tocar nada: durante un
  // arrastre, `_regenerar` refrescaba la línea de descripción (_refrescarDescComps),
  // la ficha flotante y el listado de barras… pero NO los campos de la ficha del
  // componente. Los que el propio arrastre está escribiendo:
  //     · el rango (desde/hasta, o la cantidad) y su rótulo "Rango · N cm"
  //     · el largo de cada tramo (el tirador del divisor)
  //     · el Δ del lado que estira el tirador del marco
  // se quedaban con el número de ANTES hasta el mouseup, que es donde estaba el
  // único _renderPanel. O sea: la vista decía 360 y el panel 520.
  //
  // POR QUÉ NO SE RE-ARMA EL PANEL Y SE REESCRIBE EL VALOR: _renderPanel reconstruye
  // el DOM de la ficha y le mata el foco al input que el usuario está tecleando (por
  // eso _mut sólo la re-arma cuando cambia la FORMA de la ficha). Cada campo vivo
  // registra un refrescador que RELEE la receta y reescribe su propio valor.
  //
  // SÓLO DURANTE UN ARRASTRE: es la única situación en la que el número cambia sin
  // que el usuario esté escribiendo en el panel. Con la mano en el cuadrante no hay
  // edición que pisar; fuera del arrastre manda quien teclea.
  function _vivo(fn) { if (typeof fn === 'function') ST._panelVivo.push(fn); }

  // NUNCA SE PISA EL CAMPO CON EL FOCO. El gate del arrastre ya debería bastar (con
  // la mano en el cuadrante no se teclea), pero un mouseup perdido fuera de la
  // ventana deja la bandera de arrastre pegada y a partir de ahí cada regeneración
  // le borraría al usuario lo que está escribiendo. El foco es el dato honesto de
  // "acá está el usuario"; todo campo vivo escribe por acá.
  function _valVivo(el, v) {
    if (!el || (document.activeElement === el)) return;
    el.value = v;
  }

  function _refrescarPanelVivo() {
    if (!(ST.dragRango || ST.dragMarco || ST.dragMove)) return;
    var L = ST._panelVivo;
    for (var i = 0; i < L.length; i++) { try { L[i](); } catch (e) { /* un campo no rompe el arrastre */ } }
  }

  // Línea chica de la TEJA: SÓLO cantidad y diámetro (decisión del usuario 20-ago).
  // El modo de colocación y la separación —que antes iban acá— se dicen en la ficha,
  // y en 101px de teja el espacio es lo escaso. El texto largo (_compDesc) sigue
  // existiendo: viaja al tooltip de la teja, así no se pierde de la vista rápida.
  // 21-ago: la teja se achica y reparte distinto. Arriba queda sólo la TIPOLOGÍA
  // (junto al asa y al color) y todo lo demás baja a esta línea: diámetro, cantidad y
  // FIGURA. La figura estaba arriba y era lo más largo del renglón; abajo cabe sin
  // ensanchar la teja, que es lo que se estaba pagando.
  function _tejaDesc(c, ci) {
    var nb = _nBarrasComp(ci);
    // Separadores SIN espacios: con la teja a 70 px lo que sobra es ancho, y
    // "ø8·17un·103B" entra donde "ø8 · 17 un · 103B" se cortaba con puntos suspensivos.
    return 'ø' + c.diam + '·' + (nb == null ? '' : nb + 'un·') + (c.figura || '');
  }

  // Refresca SÓLO la línea chica de cada teja YA pintada (N un · ø) y su tooltip.
  // Hace falta porque la CANTIDAD DE BARRAS no sale de la receta sino del último
  // generado: tocar un @, mover un rango o cambiar el hormigón la mueve sin que la
  // grilla se re-arme.
  function _refrescarDescComps() {
    var cont = $('te_compList'); if (!cont || !ST.receta) return;
    var comps = ST.receta.componentes || [];
    Array.prototype.forEach.call(cont.querySelectorAll('.te-comp'), function (el) {
      var ci = Number(el.getAttribute('data-ci'));
      var c = comps[ci]; if (!c) return;
      el.title = _tejaTitle(c, ci);
      var de = el.querySelector('.te-de'); if (!de) return;
      de.textContent = _tejaDesc(c, ci);
    });
  }

  function _tejaTitle(c, ci) {
    return (c.tipologia || '') + ' · ' + (c.figura || '—') + ' — ' + _compDesc(c, ci);
  }

  // ==========================================================================
  // LISTADO DE BARRAS (despiece) — franja mostrable/ocultable al pie de los
  // cuadrantes, con las MISMAS columnas del "Barras a crear" del Enfierrador.
  // Fuente: ST.ultimoOut.barras, que generar.js ya entrega AGRUPADO por
  // figura+φ+marca+suf+dims+ángulos (agruparBarras) con `cant` = nº de barras
  // idénticas y `_pesoEstimado` = kg del grupo. No se re-agrupa ni se recalcula
  // NADA aquí: se pinta lo que el motor ya dijo.
  // ==========================================================================
  function _bindBarras() {
    // El botón que MUESTRA/OCULTA vive en la barra de herramientas (lugar fijo) y el
    // ✕ de la franja hace lo mismo desde donde el usuario está mirando; los dos pasan
    // por _mostrarBarras para que el estado del botón y el de la franja no diverjan.
    var t = $('te_barrasToggle');
    if (t && !t._teBound) {
      t._teBound = true;
      t.addEventListener('click', function () {
        var box = $('te_barrasBox');
        _mostrarBarras(!(box && box.classList.contains('open')));
      });
    }
    var x = $('te_barrasCerrar');
    if (x && !x._teBound) {
      x._teBound = true;
      x.addEventListener('click', function (e) { e.stopPropagation(); _mostrarBarras(false); });
    }
  }

  function _mostrarBarras(ver) {
    var box = $('te_barrasBox'); if (!box) return;
    box.classList.toggle('open', !!ver);
    var t = $('te_barrasToggle');
    if (t) { t.classList.toggle('on', !!ver); t.setAttribute('aria-expanded', ver ? 'true' : 'false'); }
    _renderBarras();   // la tabla se arma sólo cuando la franja está visible
  }

  // Celda numérica: '—' cuando el motor no dio el dato (una figura sin ese parcial,
  // sin ángulo o sin radio). Calca el _cel() del Enfierrador.
  function _cel(v) {
    if (v == null || v === '' || !isFinite(Number(v))) return '—';
    return _num(Math.round(Number(v) * 10) / 10);
  }

  function _renderBarras() {
    var box = $('te_barrasBox'); if (!box) return;
    var out = ST.ultimoOut;
    var barras = (out && out.barras) || [];
    var res = (out && out.resumen) || {};
    // SUBTÍTULO VIVO — el mismo texto del Enfierrador. Se refresca SIEMPRE (aunque la
    // franja esté oculta) porque cuesta nada y así al abrirla ya está al día.
    var cnt = $('te_barrasCount');
    if (cnt) {
      cnt.textContent = (res.items || 0) + ' items · ' + (res.barras || 0) + ' barras · ' +
        _num(res.kg || 0) + ' kg · se actualiza en vivo';
    }
    var body = $('te_barrasBody'); if (!body) return;
    if (!box.classList.contains('open')) { body.innerHTML = ''; return; }
    if (!barras.length) { body.innerHTML = '<div class="te-barras-vacio">Todavía no hay barras.</div>'; return; }
    var filas = barras.map(function (b) {
      // cant × mult = barras reales del item (mult es el multiplicador de etiqueta).
      var cant = (Number(b.cant) || 0) * (Number(b.mult) || 1);
      var kg = (b._pesoEstimado != null) ? _num(Math.round(b._pesoEstimado * 10) / 10) : '—';
      var largo = (b._largoEstimado != null) ? _num(Math.round(b._largoEstimado)) : '—';
      return '<tr><td><span class="te-btip">' + _esc(b.marca || '—') + '</span>' +
        (b.suf_tipo ? ' <span class="te-bsuf">' + _esc(b.suf_tipo) + '</span>' : '') + '</td>' +
        '<td>' + _esc(b.figura || '') + '</td>' +
        '<td class="te-bnum">' + _esc(b.diam) + '</td>' +
        '<td class="te-bnum">' + cant + '</td>' +
        '<td class="te-bnum">' + _cel(b.dim_a) + '</td>' +
        '<td class="te-bnum">' + _cel(b.dim_b) + '</td>' +
        '<td class="te-bnum">' + _cel(b.dim_c) + '</td>' +
        '<td class="te-bnum">' + _cel(b.dim_d) + '</td>' +
        '<td class="te-bnum">' + _cel(b.ang1) + '</td>' +
        '<td class="te-bnum">' + _cel(b.ang2) + '</td>' +
        '<td class="te-bnum">' + _cel(b.radio) + '</td>' +
        '<td class="te-bnum">' + largo + '</td>' +
        '<td class="te-bnum">' + kg + '</td></tr>';
    }).join('');
    // FILA DE TOTAL — sale del MISMO `out.resumen` que el subtítulo vivo de arriba, no
    // de sumar las filas pintadas: si se sumara acá, el día que el listado filtre o
    // pagine (o que una fila caiga por una figura sin catálogo) el pie diría un número
    // y el encabezado otro, y no habría forma de saber cuál miente.
    // Reparto de las 13 columnas: 3 para el rótulo · 1 = Cant · 8 vacías · 1 = Kg,
    // así los dos números caen JUSTO bajo su columna.
    var tot = '<tr>' +
      '<td colspan="3" class="te-btot">Total' + (res.items ? ' · ' + res.items + ' items' : '') + '</td>' +
      '<td class="te-bnum">' + (res.barras || 0) + '</td>' +
      '<td colspan="8"></td>' +
      '<td class="te-bnum">' + _num(res.kg || 0) + '</td></tr>';
    body.innerHTML = '<table class="te-btab"><thead><tr>' +
      '<th>Tip.</th><th>Figura</th><th class="te-bnum">φ</th><th class="te-bnum">Cant</th>' +
      '<th class="te-bnum">A</th><th class="te-bnum">B</th><th class="te-bnum">C</th><th class="te-bnum">D</th>' +
      '<th class="te-bnum">α1</th><th class="te-bnum">α2</th><th class="te-bnum">R</th>' +
      '<th class="te-bnum">Largo</th><th class="te-bnum">Kg</th>' +
      '</tr></thead><tbody>' + filas + '</tbody><tfoot>' + tot + '</tfoot></table>';
  }

  // ==========================================================================
  // FICHA FLOTANTE DE LA BARRA SELECCIONADA (portada de la maqueta template3d.html)
  // --------------------------------------------------------------------------
  // Es DOM, no render: se repinta SÓLO desde _renderPanel (cambió la selección) y
  // _regenerar (cambió la receta). NUNCA por frame y sin pedirle nada al motor —
  // todos los datos ya están en el componente y en el ST.ultimoOut vigente, así que
  // no toca el presupuesto del 3D (que es render-on-demand).
  // ==========================================================================
  function _pintarFichaSel() {
    var card = $('te_selcard'); if (!card) return;
    var c = (ST.selCi >= 0 && ST.receta && ST.receta.componentes) ? ST.receta.componentes[ST.selCi] : null;
    if (!c) { card.style.display = 'none'; card.innerHTML = ''; return; }
    var d = c.distribucion || {};
    var p = _poseDe(c);
    var caraTxt = { sup: 'superior', inf: 'inferior', lateral: 'lateral', extremo: 'extremo' }[p.cara] || p.cara;
    // CANTIDAD REAL en el elemento — el MISMO _nBarrasComp que usa la lista de
    // componentes (antes este conteo estaba escrito otra vez acá: dos copias de la
    // misma cuenta que podían divergir al primer cambio).
    var n = _nBarrasComp(ST.selCi);
    if (n == null) n = 0;
    var modo = _modoDe(c);
    var repTxt;
    if (modo === 'arreglo') repTxt = 'arreglo ' + (d.n_capas || 2) + ' capas · @' + (d.sep || 20) + ' cm';
    else if (modo === 'puntual') repTxt = (d.n_capas || 1) + ' capa(s) × ' + (d.barras_capa || 1) + ' por capa';
    else repTxt = 'lineal @' + (d.sep || 20) + ' cm';
    var ang = (c.orient && c.orient.deg) ? (' · girada ' + c.orient.deg + '°') : '';
    var filas =
      '<div class="te-sct"><span class="te-scsw" style="background:' + _colorComp(c) + '"></span>' +
      _esc(_rolComp(c) === 'estribo' ? 'Estribo' : 'Barra') + ' · ' + _esc(c.tipologia || '') + '</div>' +
      '<div class="te-scr">Figura <b>' + _esc(c.figura || '—') + '</b> · ø<b>' + _esc(c.diam) + '</b></div>' +
      '<div class="te-scr">Cara ' + _esc(caraTxt) + (p.espejo ? ' (esp.)' : '') + _esc(ang) + '</div>' +
      '<div class="te-scr">' + _esc(repTxt) + '</div>' +
      '<div class="te-scr">Cantidad en el elemento: <b>' + n + '</b></div>';
    card.innerHTML = filas;
    card.style.display = '';
  }

  // TEJA de un componente. Ya NO contiene la ficha: al clicarla, la ficha se dibuja
  // en la zona fija de arriba (_renderDetalle). Lleva lo mínimo que identifica a la
  // barra y lo que se cambia sin abrirla: color · tipología·figura · cantidad·ø ·
  // jerarquía · puntitos de arrastre.
  function _compEl(c, ci) {
    var col = _colorComp(c);   // el swatch muestra el color REAL de la barra (override incluido)
    var sel = (ci === ST.selCi);
    // ACOMPAÑANTE de una selección múltiple: se marca distinto de la principal a
    // propósito. La ficha de la derecha muestra UNA barra —la principal—, y si las
    // cuatro tejas se vieran iguales no habría forma de saber cuál se está editando.
    var extra = !sel && (ST.selExtra || []).indexOf(ci) >= 0;
    var wrap = document.createElement('div');
    wrap.className = 'te-comp' + (sel ? ' sel' : (extra ? ' selx' : ''));
    wrap.setAttribute('data-ci', ci);
    // El texto largo que la línea chica ya no muestra (modo, separación) vive acá: la
    // teja no lo dice, pero sigue a un hover de distancia.
    wrap.title = _tejaTitle(c, ci);

    // TIPOLOGÍA HUÉRFANA — se marca EN LA TEJA, no sólo dentro de la ficha: el
    // usuario mira la grilla, y ahí es donde tiene que ver CUÁL de sus barras quedó
    // con la tipología de otro elemento.
    var ajena = _tipAjenaAlElemento(c);
    if (ajena) wrap.style.borderLeft = '3px solid var(--te-warn)';

    // FIGURA QUE EL CATÁLOGO YA NO TIENE (la marca el normalizador de apertura al
    // abrir un template viejo). Es más grave que la tipología ajena —de esta barra
    // NO sale nada— así que va en ROJO y pisa la marca ámbar.
    var mig = _migracionDe(c);
    var sinFig = !!(mig && mig.figura_desconocida);
    if (sinFig) wrap.style.borderLeft = '3px solid var(--te-err)';

    // Fila de arriba: asa de arrastre · color · marca de espejo. Se construye con
    // nodos y no con innerHTML porque el ASA se le pasa al enlazador de arrastre: con
    // innerHTML habría que ir a buscarla después con un querySelector, y el asa es
    // justo la pieza que no puede fallar en silencio.
    var top = _div('te-tjtop');
    var asa = _span('⠿');
    asa.className = 'te-drag'; asa.title = 'Arrastrar para reordenar';
    top.appendChild(asa);
    var swEl = document.createElement('span');
    swEl.className = 'te-sw'; swEl.style.background = col;
    top.appendChild(swEl);
    // LA MARCA DE ESPEJO SE FUE DE LA TEJA (21-ago, pedido del usuario): en 70 px de
    // ancho competía con la tipología, que es lo que de verdad identifica la barra.
    // Consecuencia asumida: dos componentes que sólo difieren en el espejo se ven
    // iguales en la grilla; la ficha lo sigue diciendo en la frase de Orientación.
    // Y FUERA el separador elástico: empujaba la tipología contra el borde derecho y
    // le comía el ancho, así que un "MH" salía cortado en "M…". Ahora va pegada al
    // color, que es donde se lee sola.
    wrap.appendChild(top);

    // LA TIPOLOGÍA VA ARRIBA, junto al asa y al color — y nada más. La figura bajó a
    // la línea chica (21-ago): era el texto más largo del renglón y obligaba a la teja
    // a ser ancha para nada.
    var nm = _span(
      (sinFig ? '⛔ ' : '') + (ajena ? '⚠ ' : '') + (c.tipologia || ''));
    nm.className = 'te-nm';
    if (sinFig) nm.style.color = 'var(--te-err)';
    else if (ajena) nm.style.color = 'var(--te-warn)';
    top.appendChild(nm);

    var de = _div('te-de');
    de.textContent = _tejaDesc(c, ci);
    wrap.appendChild(de);

    // LA JERARQUÍA SE FUE DE LA TEJA (21-ago, pedido del usuario): ocupaba un renglón
    // entero —etiqueta + desplegable— en cada una de las N tejas para un dato que sólo
    // se mira de la barra que se está editando. Vive ahora en la ficha, que es donde
    // está el resto de lo que define a esa barra.

    // PAPELERA EN LA TEJA (22-ago). Va superpuesta en la esquina y sólo aparece al
    // pasar el cursor —o en la teja seleccionada—, así la teja NO crece: en 70 px de
    // ancho un botón permanente le habría comido el sitio a la tipología, que es lo
    // que identifica la barra. Corta la propagación para no seleccionar al borrar.
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'te-tjdel';
    // ICONO DIBUJADO, NO EMOJI (25-ago). Iba con el carácter 🗑 y el usuario lo
    // verificó él mismo: «el botón está, pero no se ve. Si hago hover con el mouse sí
    // me da la opción de eliminar». O sea el botón existía, respondía y ocupaba su
    // sitio — lo que no se dibujaba era el GLIFO: ese emoji depende de que la fuente
    // instalada lo tenga, y a 11-12 px en una teja puede salir vacío. Tres rondas
    // subiendo opacidades no podían arreglar eso porque el problema nunca fue la
    // opacidad. Un <svg> inline se dibuja siempre y toma el color de la letra, igual
    // que el icono de la herramienta Seleccionar del ribbon.
    del.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>';
    del.title = 'Quitar esta barra';
    del.setAttribute('aria-label', 'Quitar esta barra');
    del.addEventListener('click', function (ev) {
      ev.stopPropagation();
      // La papelera de la teja borra ESA barra y nada más: _borrarSeleccion trabaja
      // sobre la selección, y con varias elegidas se habría llevado a todas.
      ST.selCi = ci; _soltarExtras();
      _borrarSeleccion();
    });
    wrap.appendChild(del);

    wrap.addEventListener('click', function (ev) {
      // BUG 6B — la teja es un TOGGLE: si el componente ya está seleccionado, volver a
      // clicarlo lo DESELECCIONA. Antes sólo seleccionaba, así que la única forma de
      // soltar la selección era clic-en-vacío en una vista (y en las densas nunca caías
      // en vacío → "solo se pliega en XZ").
      if (ev && (ev.ctrlKey || ev.metaKey)) { _alternarSeleccion(ci); return; }
      // SHIFT+CLIC = TRAMO, desde la seleccion actual hasta esta teja. Es el gesto
      // que todo el mundo prueba para "de la 1 a la 4", y en la TIRA shift esta
      // libre (en los cuadrantes no: ahi es el interruptor de las cotas).
      if (ev && ev.shiftKey && ST.selCi >= 0) { _seleccionarTramo(ci); return; }
      if (ST.selCi === ci) { _seleccionar(-1); } else { _seleccionar(ci); }
    });

    _habilitarDrag(wrap, ci, asa);
    return wrap;
  }

  // Nivel de jerarquía por DEFECTO — SIEMPRE 1 (decisión del usuario 13-ago:
  // "siempre deben venir en 1, el usuario elige si las cambia"). Espejo del
  // default del motor (JER_DEFAULT_POR_ROL, también todo en 1). Esta función
  // era una TABLA DUPLICADA con el criterio viejo (traba/cabezal = 2) y por eso
  // el select seguía mostrando 2 después de corregir el motor.
  function _jerDefault(rol) { return 1; }

  // <select> de JERARQUÍA del componente (pie de la teja). Escribe comp.jerarquia:
  //   'no'  → pegado al recubrimiento, NO participa de la jerarquía
  //   1..9  → nivel (1 = exterior; 2+ se apoyan por dentro del anterior).
  // No hay opción "auto": si el componente no trae el campo, se estampa el default
  // por rol al renderizar el panel, de modo que lo que se ve es lo que hay.
  function _selJerarquia(c, ci) {
    if (c.jerarquia == null) c.jerarquia = _jerDefault(_rolComp(c));
    var sel = document.createElement('select');
    sel.className = 'te-jer';
    sel.title = 'n/a = pegado al recubrimiento (no participa) · 1 = nivel exterior · 2+ se apoyan por dentro del anterior';
    // n/a + niveles 1..9 (antes llegaba a 4; el anidado real puede encadenar más).
    var opts = [['no', 'n/a']];
    for (var nj = 1; nj <= 9; nj++) opts.push([String(nj), String(nj)]);
    opts.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o[0]; op.textContent = o[1];
      sel.appendChild(op);
    });
    sel.value = String(c.jerarquia);
    // la teja entera es clicable (selecciona/deselecciona): el select se lo queda.
    ['click', 'mousedown', 'dblclick'].forEach(function (ev) {
      sel.addEventListener(ev, function (e) { e.stopPropagation(); });
    });
    sel.addEventListener('change', function (e) {
      e.stopPropagation();
      c.jerarquia = (sel.value === 'no') ? 'no' : Number(sel.value);
      _mut(ci);
    });
    return sel;
  }

  function _compBody(c, ci, rol) {
    var body = document.createElement('div'); body.className = 'te-cbody';
    var spec = _figSpec(c.figura);
    var d = c.distribucion || {};
    // FICHA POR FAMILIA: la barra que se dibuja como CONTORNO CERRADO no tiene
    // patas que apuntar ni extremo libre que empalmar (el marco manda la forma),
    // así que esos controles no se ofrecen.
    var cerrado = _esContornoCerrado(c);

    // Identidad
    var idRow = _div('te-idrow');
    idRow.appendChild(_fld('Figura', _figInputComp(c, ci)));
    idRow.appendChild(_fld('φ mm', _select(TE_DIAMS.map(String), String(c.diam), function (v) { c.diam = Number(v); _mut(ci); })));
    // RECUBRIMIENTO PROPIO — sube a esta fila (22-ago). Gastaba un renglon entero para
    // un campo de dos digitos, y pertenece a la identidad de la barra igual que el phi.
    var inRecId = _input({ value: (c.recub_override != null ? c.recub_override : ''), placeholder: 'auto' },
      function (v) { c.recub_override = (v === '' ? null : Number(v)); _mut(ci, true); });
    inRecId.title = 'Recubrimiento en cm solo para esta barra. Vacio = el del elemento.';
    idRow.appendChild(_fld('Recub', inRecId));
    idRow.appendChild(_fld('Sufijo', _input({ value: c.suf_tipo || '', placeholder: 'sup / A…' }, function (v) { c.suf_tipo = v; _mut(ci, true); })));
    // JERARQUÍA — bajó de la teja a la ficha el 21-ago. Va con la identidad de la
    // barra (figura, φ, sufijo) porque es de la misma naturaleza: describe ESTA barra,
    // no cómo se reparte.
    idRow.appendChild(_fld('Jerarquía', _selJerarquia(c, ci)));
    body.appendChild(idRow);
    // HUECO para la fila de color: se reserva acá —arriba, junto a la identidad de la
    // barra— pero la fila se construye más abajo, donde vive el resto de su lógica.
    // Appendearla aquí directamente la metía como `undefined`: la variable existe por
    // hoisting pero todavía no tiene valor.
    var huecoCol = _div(''); body.appendChild(huecoCol);

    // TIPOLOGÍA HUÉRFANA (ver _tipAjenaAlElemento) — esta barra quedó con la
    // tipología de otro elemento, típicamente tras cambiar Viga → Muro. El aviso
    // de la barra de estado dura hasta el primer clic; esta nota NO se va hasta
    // que se arregle, y trae el arreglo puesto: la tipología no se podía cambiar
    // en ninguna parte (se elegía al colocar), así que la única salida era borrar
    // la barra y volver a colocarla perdiendo su pose.
    var avTipAj = _tipAjenaAlElemento(c);
    if (avTipAj) {
      var nTipAj = _div('te-note');
      nTipAj.style.color = 'var(--te-warn)';
      nTipAj.textContent = '⚠ ' + avTipAj.texto +
        ' Cambiarla acá no mueve la barra: su cara, su giro y su posición quedan donde están.';
      body.appendChild(nTipAj);

      var tipRow = _div('te-row');
      tipRow.appendChild(_label('Tipología'));
      // La opción actual va PRIMERO y marcada, aunque sea la ajena: el select
      // tiene que mostrar lo que la barra tiene hoy, no un valor que nadie eligió.
      var pares = [[avTipAj.tip, avTipAj.tip + ' (de otro elemento)']];
      TPL_TIPOLOGIAS[avTipAj.elem].forEach(function (t) { pares.push([t[0], t[0] + ' — ' + t[1]]); });
      var selTipAj = _selectPairs(pares, avTipAj.tip, function (v) {
        if (v === c.tipologia) return;
        _pushUndo();
        c.tipologia = v;
        _mut(ci, true);   // re-render: cambia el color, el rol y desaparece esta nota
      });
      selTipAj.title = 'Tipología de esta barra dentro del ' + avTipAj.elem;
      tipRow.appendChild(selTipAj);
      body.appendChild(tipRow);
    }

    // La figura GUARDADA puede no estar en el catálogo (receta vieja, figura dada de
    // baja): se dice en la ficha, porque esa barra no se dibuja ni pesa.
    var errFig = _figError(c.figura);
    if (errFig) {
      var nErr = _div('te-note');
      nErr.style.color = 'var(--te-err)';
      nErr.textContent = '⚠ ' + errFig + ' — esta barra no se dibuja ni pesa hasta corregirla.';
      body.appendChild(nErr);
    } else {
      // La figura EXISTE pero puede no ser de la tipología de esta barra (se
      // tipeó a mano, o se cambió la tipología después). La barra se dibuja y
      // pesa igual — por eso es ÁMBAR y no rojo — pero hay que decirlo acá, que
      // es donde el usuario mira cuando algo salió distinto de lo que esperaba.
      var avFig = _figAvisoTipologia(c.figura, _tipoElemento(), c.tipologia);
      if (avFig) {
        var nAv = _div('te-note');
        nAv.style.color = 'var(--te-warn)';
        nAv.textContent = '⚠ ' + avFig.texto;
        body.appendChild(nAv);
      }
    }

    // ------------------------------------------------------------------
    // ORIENTACIÓN — cómo está puesta la pieza, TODO en un bloque (22-ago).
    //
    // Reemplaza las cinco filas de antes (Cara/anclaje · Lado · Rotar · Pose · Patas),
    // que decían la misma cosa repartida en cinco renglones y en coordenadas del
    // modelo. Ver la nota grande de _fraseOrientacion: el DATO es el mismo —la pose
    // sigue siendo {cara, lado, rumbo, espejo} y se escribe siempre con _setPose, así
    // que ficha, botón de giro y motor no pueden divergir— y lo que cambia es que
    // arriba se LEE el resultado y abajo se ACTÚA, separado por una línea.
    // ------------------------------------------------------------------
    var pose = _poseDe(c);
    // Las PATAS suben desde el final de la ficha: son una ACCIÓN sobre la orientación
    // (giran los ganchos sin mover la barra), no un campo suelto. `patas` lo sigue
    // consumiendo _filasEmpalme más abajo, por eso se calcula una sola vez acá.
    var patas = _patasDe(c);

    var oriBox = _div('te-modebox');
    var oriHead = _div('te-mh');
    oriHead.appendChild(_span('Orientación'));
    oriBox.appendChild(oriHead);

    // (a) LA FRASE DE ESTADO — lo primero y lo más importante del bloque: dice la pose
    // entera en lenguaje de obra. Es lo que explica que al girar se muevan dos
    // controles a la vez (es UNA orientación cambiando, no dos cosas sueltas).
    // Se re-arma en cada _renderPanel, y TODOS los caminos que tocan la pose pasan por
    // ahí —los botones de acá vía _mut(ci,true), y la tecla R / ESPACIO / el botón
    // flotante vía rotarPoseEnVista y _rotarPoseSeleccionEje, que llaman _renderPanel—,
    // así que la frase no puede quedarse diciendo una pose vieja.
    var frase = _div('te-ofrase');
    frase.textContent = _fraseOrientacion(pose);
    frase.title = 'Cómo está puesta esta pieza ahora mismo. Cambia sola con la cara, el rumbo, ' +
      'el espejo y los giros (R y ESPACIO): si al girar se movieron dos controles a la vez, ' +
      'esta línea dice por qué — es UNA orientación cambiando.';
    oriBox.appendChild(frase);

    // (b) CARA — UN control de SEIS opciones que funde las viejas «Cara» y «Lado».
    // La fila «Lado» desapareció: 'sup'/'inf' traían el signo en el nombre y
    // 'lateral'/'extremo' lo necesitaban aparte, o sea que aquella fila era la mitad
    // de este control puesta en otro renglón (y por eso quedaba inerte a ratos).
    // GANANCIA REAL, no sólo cosmética: «Lado» sólo se mostraba en 'extremo' o si el
    // rol era cabezal, así que las dos caras laterales de un estribo NO se podían
    // elegir desde la ficha. Ahora las seis están siempre.
    var caraRow = _div('te-row te-rowchica');
    caraRow.appendChild(_label('Cara'));
    caraRow.appendChild(_radialIconos(_CARAS6.map(function (f) {
      return { v: f.id, svg: _iconoCara6(f.id), title: 'Apoyar en ' + _nombreCara6(f.id) };
    }), _caraId(pose), function (v) {
      var f = _cara6(v);
      var p = _poseDe(c);
      // sup/inf no miran el `lado` (su signo ES la cara): comparar por él haría que
      // el clic en «inferior» pareciera un cambio que no es.
      if (f.cara === p.cara && (!_CARA_CON_LADO[f.cara] || f.lado === p.lado)) return;
      _pushUndo();
      var ejeAntes = _ejeDistDe(c);
      p.cara = f.cara;
      p.lado = f.lado;
      // el rumbo tiene que seguir siendo ⊥ a la cara nueva; si no lo es, cae al
      // rumbo por defecto de esa cara (el largo cuando es posible).
      if (!_rumboValido(p.cara, p.rumbo)) p.rumbo = _rumboDefaultDeCara(p.cara);
      _setPose(c, p);
      _reencuadrarReparto(c, ejeAntes);   // la cara puede cambiar el eje de reparto
      _mut(ci, true);
    }, 'te-caras'));
    oriBox.appendChild(caraRow);

    // (c) CORRE (el rumbo) — control que ANTES NO EXISTÍA, pese a ser una coordenada
    // que el giro cambia: el usuario veía moverse un estado que no podía tocar.
    // Sólo se ofrecen los DOS rumbos válidos de la cara elegida; el tercero (el eje
    // paralelo a la normal) es imposible por geometría y el motor lo normaliza solo,
    // así que ofrecerlo sería un botón que se deshace al pulsarlo.
    var corRow = _div('te-row te-rowchica');
    corRow.appendChild(_label('Corre'));
    var corWrap = _div('te-orow');
    var rumSeg = _radial(_rumbosDeCara(pose.cara).map(function (r) {
      return [r, _nombreRumbo(r)];
    }), pose.rumbo, function (v) {
      if (v === pose.rumbo) return;
      _pushUndo();
      var ejeAntes = _ejeDistDe(c);
      var p = _poseDe(c);
      p.rumbo = v;
      _setPose(c, p);
      _reencuadrarReparto(c, ejeAntes);   // el rumbo también manda el eje de reparto
      _mut(ci, true);
    });
    rumSeg.title = 'Hacia dónde CORRE la pieza. Sólo salen los dos rumbos posibles de la cara ' +
      'elegida: el tercero sería atravesar el hormigón por su normal.';
    corWrap.appendChild(rumSeg);

    // (d) ESPEJO — botón compacto, no una fila. Casi nunca se toca a mano: lo enciende
    // y lo apaga el propio giro al pasar por la media vuelta. Se conserva porque si una
    // rotación deja la pieza espejada sin querer, hay que poder devolverla SIN girar
    // de más. ES TAMBIÉN LA MEDIA VUELTA (ver _signoLong en reglas.js): en una pieza
    // PLANA, reflejarla en su plano y girarla 180° sobre su normal son lo mismo, así
    // que este bit es el SENTIDO del rumbo — el que completa las 24 orientaciones.
    var espBtn = document.createElement('button');
    espBtn.type = 'button';
    espBtn.className = 'te-espbtn' + (pose.espejo ? ' on' : '');
    espBtn.innerHTML = _ICO_ESPEJO;   // constante del módulo, nunca dato del usuario
    espBtn.title = 'Espejo: la MISMA pose dada vuelta sobre su eje de anclaje (el gancho cierra ' +
      'al otro lado). Ahora está ' + (pose.espejo ? 'ESPEJADA — clic para devolverla.' : 'normal.') +
      ' Girando con R también se pasa por acá.';
    espBtn.addEventListener('click', function () {
      _pushUndo();
      var p = _poseDe(c);
      p.espejo = !p.espejo;
      _setPose(c, p);
      _mut(ci, true);
    });
    corWrap.appendChild(espBtn);
    corRow.appendChild(corWrap);
    oriBox.appendChild(corRow);

    // (e) ACCIONES — separadas del ESTADO por una línea. Antes estaban mezcladas con él
    // en filas idénticas y no se distinguía qué DESCRIBE y qué HACE.
    var accRow = _div('te-oacc');
    // Girar 90° = giro de POSE en la vista activa (13-ago): re-deriva dims contra lo
    // nuevo que cruzan, re-ancla a la cara y re-reparte. Antes era rotación RÍGIDA en
    // grados (la pieza giraba tal cual y se salía del hormigón).
    var rot90 = document.createElement('button');
    rot90.type = 'button'; rot90.className = 'te-ctool'; rot90.textContent = 'Girar 90°';
    rot90.style.padding = '3px 8px';
    rot90.title = 'Girar 90° en la vista activa (pose): se reajusta a recubrimientos y reparto. Igual que R.';
    rot90.addEventListener('click', function () { _rotarPoseSeleccion(_vistaActiva()); });
    // Girar de plano: manda la pieza a PROFUNDIDAD — gira 90° en torno al eje VERTICAL
    // de la vista activa (como una puerta). También es giro de pose.
    var rotPlano = document.createElement('button');
    rotPlano.type = 'button'; rotPlano.className = 'te-ctool'; rotPlano.textContent = 'Girar de plano';
    rotPlano.style.padding = '3px 8px';
    rotPlano.title = 'Girar DE PLANO: la pieza pasa a estar colocada en profundidad (gira en el eje vertical de la vista).';
    rotPlano.addEventListener('click', function () {
      var defs = _defsPlanos();
      var dv = defs[_vistaActiva()] || defs.seccion;
      _rotarPoseSeleccionEje(dv.v);
    });
    accRow.appendChild(rot90);
    accRow.appendChild(rotPlano);

    // PATAS — hacia dónde apuntan los ganchos. Es orient.spin (0/90/180/270): el motor
    // gira SÓLO las patas alrededor del eje longitudinal, la barra NO se mueve de su
    // sitio. Sólo si la figura TIENE patas y el rol no es estribo/traba (esos son
    // marcos cerrados: no hay dirección de pata que elegir).
    if (!cerrado && rol !== 'estribo' && rol !== 'traba' && (patas.inicio || patas.fin)) {
      // El rótulo y sus flechas van en UN envoltorio: la fila de acciones envuelve
      // cuando no cabe, y sueltos el "Patas" podía quedarse en un renglón y sus
      // flechas irse al siguiente.
      // 22-ago: sin rótulo. Las cuatro flechas se explican solas y el texto "Patas"
      // gastaba ancho en una fila donde el ancho es lo escaso.
      var patWrap = _div('te-opatas');
      var spinNow = ((((Number(c.orient && c.orient.spin) || 0) % 360) + 360) % 360);
      var spinSeg = _radial([['0', '↓'], ['90', '→'], ['180', '↑'], ['270', '←']], String(spinNow), function (v) {
        _pushUndo();
        c.orient = c.orient || {};
        c.orient.spin = Number(v) || 0;
        _mut(ci, true);   // redibuja la ficha → el botón activo sigue al valor
      });
      spinSeg.title = 'Dirección de las patas (la barra no se mueve de su sitio)';
      patWrap.appendChild(spinSeg);
      accRow.appendChild(patWrap);
    }
    oriBox.appendChild(accRow);
    body.appendChild(oriBox);

    // POSICIÓN MEDIDA — va PEGADA a ORIENTACIÓN porque es la misma familia: contra qué
    // cara se ancla la pieza y a cuántos centímetros de ella.
    _filasDesplazamiento(body, c, ci);

    // Recub override — SUBE antes del kit de rotaciones (pedido 13-ago: Rotación,
    // Pose/Espejo —y la rotación de plano cuando vuelva— quedan AGRUPADAS abajo).
    // "Recub. override" era el nombre del campo de la receta puesto en pantalla.
    // El dato sigue llamándose recub_override; lo que se lee dice qué hace.
    // (la fila propia de «Recub. propio» se retiro: el campo vive ahora en la fila de
    //  identidad, detras del diametro, y con dos digitos le sobra)

    // (Las filas «Pose», «Rotar» y «Patas» que vivían acá se fueron ARRIBA, al bloque
    // ORIENTACIÓN: eran el mismo asunto —cómo está puesta la pieza— repartido por la
    // ficha, con el estado y las acciones mezclados en filas idénticas.)

    // Δ de EXTREMO LIBRE (empalme) — sólo en los extremos SIN pata.
    _filasEmpalme(body, c, ci, rol, patas, cerrado);

    // (Limpieza 19-ago) Aquí salían DOS notas grises explicando por qué la ficha de
    // un marco cerrado —o de un estribo/traba— trae menos controles: que el marco
    // manda la forma, que el motor sólo aplica el Δ de empalme a las longitudinales.
    // Eso es funcionamiento interno del motor: va en este comentario, no en la
    // pantalla. Quien cubica fierro no necesita que le expliquen la ausencia de un
    // control que nunca vio. Motivo técnico, para quien lea el código:
    //   · contorno cerrado → el largo sale del contorno, no hay pata ni extremo libre;
    //   · estribo/traba → reglas.js ignora `empalme` (empIgnorado), así que ofrecerlo
    //     sería un campo que no cambia el fierro.

    // COLOR DE LA BARRA — default el de su tipología (COL2D), editable por
    // componente y guardado en la receta (D9 del usuario: "colores por defecto
    // pero se pueden cambiar en el componente"). Se aplica en 'change' (al cerrar
    // el picker), no en 'input': cada cambio regenera motor+3D y el arrastre del
    // picker dispara decenas por segundo.
    // 22-ago: SIN rótulo y en UNA sola línea. Un selector de color se reconoce solo,
    // así que la palabra "Color" era un renglón regalado; y la barra ancha del picker
    // pasa a ser un cuadro del alto de la fila, con los colores ya usados a su lado en
    // la MISMA línea en vez de bajar a una segunda.
    var rowCol = _div('te-rowcol');
    var wCol = _div(''); wCol.style.display = 'flex'; wCol.style.gap = '6px'; wCol.style.alignItems = 'center';
    wCol.style.flexWrap = 'nowrap'; wCol.style.minWidth = '0';
    var inCol = document.createElement('input');
    inCol.type = 'color'; inCol.value = _colorComp(c); inCol.className = 'te-color';
    inCol.title = 'Color de esta barra en el editor (default: el de su tipología ' + _colDe(c.tipologia) + ')';
    inCol.addEventListener('change', function () { c.color = inCol.value; _mut(ci); });
    wCol.appendChild(inCol);
    if (_hexCompValido(c)) {
      var bColAuto = document.createElement('button');
      bColAuto.type = 'button'; bColAuto.className = 'te-mini'; bColAuto.textContent = 'auto';
      bColAuto.title = 'Volver al color de la tipología (' + _colDe(c.tipologia) + ')';
      bColAuto.onclick = function () { delete c.color; _mut(ci); };
      wCol.appendChild(bColAuto);
    }
    // COLORES YA USADOS EN ESTE TEMPLATE — un clic los repite en esta barra.
    // Sale de _coloresDeReceta (lectura de la receta abierta, sin dato nuevo que
    // guardar); el picker de arriba sigue siendo el que inventa colores.
    // Se salta el color que ESTA barra ya tiene: ofrecerlo sería un botón que no hace
    // nada. Si no queda ninguno (template de un solo color), no se dibuja la fila.
    var actual = String(_colorComp(c)).toLowerCase();
    var usados = _coloresDeReceta().filter(function (h) { return h !== actual; });
    if (usados.length) {
      var wSw = _div('te-colsws');
      wSw.title = 'Colores ya usados en este template — clic para aplicarlo a esta barra';
      usados.forEach(function (hex) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'te-colsw';
        b.style.background = hex;
        b.title = 'Usar ' + hex;
        b.setAttribute('aria-label', 'Usar ' + hex);
        b.onclick = function () { c.color = hex; _mut(ci, true); };
        wSw.appendChild(b);
      });
      wCol.appendChild(wSw);
    }
    rowCol.appendChild(wCol);
    huecoCol.appendChild(rowCol);   // ← al hueco reservado arriba, no al final

    // Distribución
    body.appendChild(_distBox(c, ci, rol, d));

    // Dimensiones dinámicas de la figura (Fija/Auto por dim). El LADO DOMINANTE va
    // MARCADO: es el que se estira/ancla contra el elemento, y saber cuál es explica
    // por qué al girar la pieza cambia ESE y no los otros.
    c.dims = c.dims || {};
    var dom = _ladoDominante(c);
    // PIEZA DE MARCO: el «dominante» no es el lado que se estira (no existe en un
    // cerrado) sino EL LADO DONDE CIERRAN LOS GANCHOS. Siempre hay uno vigente
    // (sin elección manda el primero de la cadena) y se pinta: antes la 106A no
    // traía ninguna letra marcada («tampoco viene el B marcado como dominante»).
    var fpDom = global.ModeladorFiguraPuntos || {};
    var ordenDom = fpDom.ladosMarcoOrdenados ? fpDom.ladosMarcoOrdenados(c.figura, _rolComp(c)) : null;
    var esMarcoDom = !!(ordenDom && ordenDom.length === 4);
    if (esMarcoDom) dom = _ladoDomElegido(c) || ordenDom[0];
    // …y DICHO en texto, junto a las dims, que es de lo que habla (cuál de estas
    // letras corre a lo largo). Con un solo parcial es obvio y no se repite —
    // salvo que la receta traiga un lado_dominante guardado, que sí hay que avisar.
    // (15-ago) La fila "Dominante" separada murió: la LETRA de cada dim ES ahora
    // su botón radial (ver _dimRow). Sólo queda la nota, y sólo cuando aporta.
    _notaLadoDominante(body, c, spec, dom, esMarcoDom);
    spec.parciales.forEach(function (L) {
      body.appendChild(_dimRow(c, ci, L, dom));
    });
    // ÁNGULOS EDITABLES POR BARRA (tanda 14-ago; el motor los consume desde WF1:
    // el trazado Y generar.js pasan por figura_puntos.angulosEfectivos, así que el
    // que se dibuja y el que se factura son EL MISMO número). Regla del usuario:
    // el catálogo SUGIERE (default), la barra decide; el ángulo se desplaza DENTRO
    // del rango de su doblez (≤90 se mueve en 0–90, >90 en 90–180 — cambiar de
    // rango sería otra figura); sólo varía la posición del gancho, el largo total
    // no cambia. Un valor fuera de rango se guarda tal cual (dato honesto) pero el
    // motor lo ignora con aviso — acá se pinta .bad y se dice el motivo al tiro.
    if (spec.angulos.length) {
      // TODOS LOS ÁNGULOS EN UNA FILA (pedido 15-ago): con la grilla de 2 columnas
      // una figura de 4 ángulos ocupaba dos renglones. Ahora la fila tiene tantas
      // columnas como ángulos declare la figura — 2 quedan anchos, 4 caben igual.
      var angRow = _div('te-angrow');
      angRow.style.gridTemplateColumns = 'repeat(' + spec.angulos.length + ', 1fr)';
      var fpAng = global.ModeladorFiguraPuntos || {};
      var nAngMsg = _div('te-note');   // mensaje vivo de validación (uno para todos)
      spec.angulos.forEach(function (a, i) {
        var rg = fpAng.rangoAngulo ? fpAng.rangoAngulo(c.figura, i) : null;
        var ovr = (c.angulos && c.angulos[i] != null && c.angulos[i] !== '') ? c.angulos[i] : null;
        var inpA = _input({
          value: (ovr != null ? ovr : a), type: 'number',
          placeholder: String(a)
        }, function (v) {
          c.angulos = c.angulos || [];
          // vacío o el valor del catálogo = SIN override (la receta no estrena el canal)
          var lim = String(v == null ? '' : v).trim();
          c.angulos[i] = (lim === '' || Number(lim) === Number(a)) ? null : Number(lim);
          _mut(ci);
        });
        if (rg) {
          inpA.min = rg.lo; inpA.max = rg.hi;
          inpA.title = 'α' + (i + 1) + ' · catálogo ' + a + '° · se mueve en ' + rg.lo + '–' + rg.hi +
            '° (el rango de su doblez). Sólo cambia la posición del gancho; el largo no.';
        } else {
          // sin rango (0/180 en el catálogo): no describe un doblez → no se edita
          inpA.readOnly = true; inpA.disabled = true;
          inpA.title = 'α' + (i + 1) + ' = ' + a + '° · no describe un doblez: no hay rango en el que moverlo.';
        }
        // validación viva: pinta el campo y dice el motivo (el mismo texto del motor)
        if (ovr != null && fpAng.validarAngulo) {
          var vv = fpAng.validarAngulo(c.figura, i, ovr);
          if (!vv.ok && !vv.vacio) {
            inpA.classList.add('bad');
            nAngMsg.style.color = 'var(--te-warn)';
            nAngMsg.textContent = '⚠ α' + (i + 1) + ': ' + vv.motivo + '. El motor usa el del catálogo (' + a + '°) y avisa.';
          }
        }
        angRow.appendChild(_fld('α' + (i + 1) + ' (°)', inpA));
      });
      body.appendChild(angRow);
      // La nota SÓLO aparece cuando hay algo que avisar. Antes, sin aviso, se
      // pintaba igual con un texto explicando de dónde sale el valor por defecto —
      // lo mismo que ya dice el tooltip de cada campo α, en una línea gris fija.
      if (nAngMsg.textContent) body.appendChild(nAngMsg);
    }
    // FIGURA CON RADIO (catálogo: radio = true, p.ej. 201A). Se DICE, no se ofrece un
    // campo: generar.js escribe `radio: null` fijo en la BarraPayload, así que un
    // input aquí sería un valor que el usuario edita y que nunca llega al backend.
    if (spec.radio) {
      var nRad = _div('te-note');
      nRad.style.color = 'var(--te-err)';
      nRad.textContent = '⚠ Esta figura lleva radio de doblado y el editor todavía no lo maneja: el radio va vacío en el despiece.';
      body.appendChild(nRad);
    }
    // (Limpieza 19-ago) Se fue la nota fija "Dim en Auto se derivan del elemento…":
    // decía palabra por palabra lo mismo que el tooltip del candado de cada fila de
    // dimensión, que es donde el usuario pregunta.
    return body;
  }

  // Campo FIGURA de la ficha, validado contra el catálogo: una figura que no existe
  // o no es dibujable NO se aplica al componente (borde rojo + motivo en el status).
  // Los mismos DOS niveles que el ribbon: rojo = no se aplica · ámbar = se aplica
  // pero la figura no es de la tipología de ESTA barra (c.tipologia, no la del
  // ribbon: en la ficha se está mirando una barra concreta).
  function _figInputComp(c, ci) {
    function _pintar(el, v) {
      var av = _figAvisoTipologia(v, _tipoElemento(), c.tipologia);
      el.classList.toggle('warn', !!av);
      el.title = av ? av.texto : _figTitle(v);
      return av;
    }
    var inp = _input({ value: c.figura || '', list: 'te_figs', placeholder: 'buscar figura…' }, function (v) {
      var k = _figKey(v);
      var err = _figError(k);
      if (err) { inp.classList.add('bad'); inp.classList.remove('warn'); inp.title = err; _actualizarStatus(err); return; }
      inp.classList.remove('bad');
      var av = _pintar(inp, k);
      _setFigura(ci, k);
      if (av) _actualizarStatus(av.texto);   // el borde ámbar es discreto: el aviso también se DICE
    });
    // prefiltro: al abrirlo, sólo las sugeridas de LA TIPOLOGÍA DE ESTA BARRA
    inp.addEventListener('focus', function () { _syncFigDatalist(inp, c.tipologia); });
    inp.addEventListener('input', function () {
      _syncFigDatalist(inp, c.tipologia);   // al escribir se abre a todo el catálogo
      var v = inp.value.trim();
      if (!v) { inp.classList.remove('bad'); inp.classList.remove('warn'); inp.title = ''; return; }   // a medio tipear
      var err = _figError(v);
      inp.classList.toggle('bad', !!err);
      if (err) { inp.classList.remove('warn'); inp.title = err; return; }
      _pintar(inp, v);
    });
    var err0 = _figError(c.figura);
    if (err0) { inp.classList.add('bad'); inp.title = err0; }
    else _pintar(inp, c.figura);
    return inp;
  }

  // ==========================================================================
  // Δ DE EXTREMO LIBRE (comp.empalme) — punto 5.
  // ==========================================================================
  // Un extremo CON pata ya define su remate; uno LIBRE (barra que muere recta) necesita
  // decir cuánto se prolonga más allá del tramo: el traslapo con la barra vecina. Se
  // escribe en comp.empalme con el shape NUEVO del motor {inicio, fin} en cm (el motor
  // sigue aceptando el shape viejo — un número suelto = el mismo Δ en los dos extremos —
  // que aquí se migra la primera vez que se edita).
  function _empalmeDe(c) {
    var e = c && c.empalme;
    if (e && typeof e === 'object') return e;
    var n = Number(e);
    return (isFinite(n) && n) ? { inicio: n, fin: n } : {};   // migración del shape viejo
  }
  function _setEmpalme(c, cual, val) {
    var e = _empalmeDe(c);
    var out = { inicio: e.inicio, fin: e.fin };
    if (val == null || !isFinite(val) || val === 0) delete out[cual];
    else out[cual] = val;
    if (out.inicio == null) delete out.inicio;
    if (out.fin == null) delete out.fin;
    if (out.inicio == null && out.fin == null) delete c.empalme;   // sin Δ → sin campo
    else c.empalme = out;
  }
  // n·φ en cm (φ del componente viene en mm): 40φ con φ16 → 64 cm.
  function _nPhi(c, n) { return Math.round((Number(c && c.diam) || 0) * n) / 10; }

  // EMPALME — FILA RETIRADA (15-ago, pedido del usuario: "queda redundante").
  // Era el MISMO concepto que el Δ por lado (prolongar el extremo libre para el
  // traslapo) en un campo aparte y sólo para el lado longitudinal; sus atajos
  // 40φ/60φ se rescataron y viven ahora junto al Δ de CADA lado (_dimRow).
  // Un `empalme` YA GUARDADO no se borra ni se migra a escondidas —el motor lo
  // sigue aplicando y sería fierro que cambia solo—: se DICE que está y se
  // ofrece pasarlo al Δ del lado que lo recibe.
  function _filasEmpalme(body, c, ci, rol, patas, cerrado) {
    var e = _empalmeDe(c);
    var total = (Number(e.inicio) || 0) + (Number(e.fin) || 0);
    if (!total) return;
    var n = _div('te-note');
    n.style.color = 'var(--te-warn)';
    n.textContent = '⚠ Esta barra tiene un empalme guardado (' +
      (e.inicio ? 'inicio ' + e.inicio + ' cm' : '') +
      (e.inicio && e.fin ? ' · ' : '') +
      (e.fin ? 'fin ' + e.fin + ' cm' : '') +
      '). Sigue sumando al largo de corte; el traslapo ahora se pone con el Δ de cada lado.';
    body.appendChild(n);
    var dom = _ladoDominante(c);
    if (!dom || !c.dims || !c.dims[dom]) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'te-ctool';
    b.textContent = 'Pasar los ' + total + ' cm al Δ del lado ' + dom;
    b.title = 'Suma el empalme al Δ del lado dominante y limpia el campo viejo. ' +
      'El largo de corte no cambia.';
    b.onclick = function () {
      _pushUndo();
      var d0 = c.dims[dom];
      d0.delta = (Number(d0.delta) || 0) + total;
      if (e.inicio && !e.fin) d0.extremo = 'ini';
      _setEmpalme(c, 'inicio', null); _setEmpalme(c, 'fin', null);
      _mut(ci, true); _renderPanel();
    };
    body.appendChild(b);
  }

  // ==========================================================================
  // FILA "LADO DOMINANTE" — SOLO LECTURA (mismo criterio que los ángulos)
  // ==========================================================================
  // Acá hubo un selector de letras + botón `auto` que escribía comp.lado_dominante.
  // Se sacó por el MISMO motivo por el que se deshabilitó el campo α: el motor NO
  // lee ese campo (comprobado 14-ago, tests/test_lado_dominante.js bloque D).
  // reglas.ladoDominante(comp) delega en _ladoLongitudinal(comp.figura, comp.dims)
  // → figura_puntos.ladoDominanteFigura, que sólo mira el catálogo
  // (spec.lado_dominante / geometria.lado_dominante) y nunca el componente.
  //
  // Y no era sólo cosmético: cada clic gastaba un slot de Ctrl+Z y ensuciaba la
  // receta (_hayCambiosSinGuardar compara el JSON), así que el editor pedía guardar
  // por un cambio que no cambiaba nada — ni el dibujo, ni el largo, ni el despiece.
  // Un control que promete y no cumple es peor que no tenerlo.
  //
  // Queda la LÍNEA INFORMATIVA (cuál es el dominante y de dónde sale), que es lo
  // que explica por qué al girar la pieza se estira ESE lado y no los otros. Cuando
  // el motor lea comp.lado_dominante (otra tanda: toca reglas._ladoLongitudinal y el
  // export), el selector vuelve — _setLadoDominante ya está escrito y probado.
  // DOMINANTE ELEGIBLE (tanda 14-ago, con el motor ya cableado por WF1): las letras
  // de la figura se muestran como BOTONES. Elegible → se puede elegir; gancho o
  // diagonal → deshabilitado CON EL MOTIVO en el title (regla del usuario: "nunca
  // un gancho"); contorno cerrado → sin botones (no hay lado que estirar). El botón
  // AUTO vuelve a la cascada del catálogo. El marcado azul de _dimRow sigue mostrando
  // el que MANDA de verdad (reglas.ladoDominante), elegido o heredado — así si el
  // motor ignora una elección inválida guardada, se VE que no mandó.
  // Nota del dominante. Los BOTONES viven en las letras de cada dim (_dimRow);
  // acá sólo queda lo que esas letras no pueden decir: qué significa el dominante
  // y —si el usuario eligió uno que el motor descartó— que no está mandando.
  function _notaLadoDominante(body, c, spec, efectivo, esMarco) {
    var fp = global.ModeladorFiguraPuntos || {};
    var elegibles = (fp.ladosDominantesElegibles ? fp.ladosDominantesElegibles(c.figura) : []) || [];
    // Figura sin lado elegible: NO se pinta nota (ni se crea el div). Antes había
    // una explicando que esta figura cierra sobre sí misma y por eso no hay
    // dominante — la misma frase que ya sale al pasar el mouse por cualquiera de
    // las letras, que están grises justamente por eso.
    if (!esMarco && !elegibles.length) return;
    var n = _div('te-note');
    // PIEZA DE MARCO: acá el dominante SÍ manda (mueve la esquina de los
    // ganchos), así que el aviso rojo de «el motor la ignoró» ya no corresponde
    // (reporte 17-ago: «me tira un texto grande en rojo que no sé si sirve»).
    if (esMarco) {
      n.textContent = 'La letra elegida marca dónde cierran los ganchos (ESPACIO los gira de esquina). ' +
        'El Δ de un lado se copia en su espejo.';
      body.appendChild(n);
      return;
    }
    // La explicación de qué significa clicar una letra se retiró (20-ago): ocupaba
    // tres renglones fijos del panel para contar algo que se aprende una vez. Lo
    // que SÍ se queda es el aviso, porque es un dato que cambia y que el usuario no
    // puede deducir mirando: su elección no está mandando.
    var elegido = _ladoDomElegido(c);
    if (elegido && elegido !== efectivo) {
      n.textContent = '⚠ La elección ' + elegido + ' no está mandando: manda ' + (efectivo || '—') + '.';
      n.style.color = 'var(--te-warn)';
      body.appendChild(n);
    }
  }

  function _dimRow(c, ci, L, dom) {
    var d = c.dims[L] || { modo: 'auto' };
    c.dims[L] = d;
    // `te-dimrow`: columna de la letra ANGOSTA (la genérica son 96 px de label y
    // aquí sólo va una letra) — ese ancho es justo el que necesita el Δ.
    var row = _div('te-row te-dimrow');
    var fp = global.ModeladorFiguraPuntos || {};
    var elegibles = (fp.ladosDominantesElegibles ? fp.ladosDominantesElegibles(c.figura) : []) || [];
    var elegido = _ladoDomElegido(c);

    // --- LA LETRA = BOTÓN RADIAL DEL DOMINANTE -------------------------------
    // La letra es SIEMPRE un botón (15-ago): antes, en un contorno cerrado —donde
    // no hay dominante que elegir— caía a una etiqueta suelta y la fila se veía
    // distinta según la figura. Ahora se ve igual siempre y el bloqueo se dice
    // con el gris, que es el mismo idioma que el resto de la fila.
    var lbl = document.createElement('button');
    lbl.type = 'button';
    lbl.textContent = L;
    var puede = elegibles.indexOf(L) >= 0;
    lbl.className = 'te-dimletra' + (elegido === L ? ' on' : '') + (L === dom ? ' manda' : '');
    {
      if (puede) {
        lbl.title = (L === dom ? 'Manda ahora. ' : '') +
          'Elegir ' + L + ' como lado dominante (clic de nuevo = volver a automático)';
        lbl.onclick = function () {
          // segundo clic sobre el elegido = volver a la cascada del catálogo
          _setLadoDominante(c, (elegido === L) ? null : L);
          // RE-RENDER (fix del reporte): sin esto la letra nueva no se pintaba —
          // el color de TODAS las letras depende de cuál está elegida y cuál
          // manda, así que hay que repintar la ficha, no sólo este botón.
          _mut(ci); _renderPanel();
        };
      } else {
        lbl.disabled = true;
        var vr = fp.validarLadoDominante ? fp.validarLadoDominante(c.figura, L) : null;
        lbl.title = (!elegibles.length)
          ? 'Esta figura cierra sobre sí misma: no tiene lado dominante que elegir.'
          : ((vr && vr.motivo) ? vr.motivo : 'Este lado no puede ser dominante');
      }
    }
    row.appendChild(lbl);
    var wrap = _div(''); wrap.style.display = 'flex'; wrap.style.gap = '4px'; wrap.style.alignItems = 'center';
    // El placeholder DICE qué falta: en Fija sin valor el campo ya no llega con un 0
    // inventado, así que tiene que verse que ahí va una medida escrita por el usuario.
    // SIN CANDADO (22-ago, idea del usuario). El campo está SIEMPRE habilitado y el
    // modo lo decide lo que haya escrito: un número lo fija, y vaciarlo —o poner 0—
    // lo devuelve a auto. Antes había que pulsar un candado sólo para poder escribir,
    // y ese botón ocupaba sitio en una fila donde el ancho es lo escaso.
    // El 0 vuelve a auto y no se acepta como medida a propósito: un lado de 0 cm no
    // es una barra, así que tratarlo como "no escribí nada" es lo que el usuario
    // quiso decir. Es el mismo criterio que ya usa el Δ de la fila de al lado.
    var inp = _input({ value: (d.modo === 'fija' && d.valor != null) ? d.valor : '', placeholder: 'auto', type: 'number' }, function (v) {
      var s = String(v == null ? '' : v).trim();
      if (s === '' || Number(s) === 0 || !isFinite(Number(s))) { d.modo = 'auto'; delete d.valor; }
      else { d.modo = 'fija'; d.valor = Number(s); }
      _mut(ci, true);   // el modo cambió: la ficha tiene que reflejarlo en el acto
    });
    // ESPEJO DE UNA MEDIDA FIJA: en un contorno CERRADO el lado opuesto mide lo
    // mismo y el motor le replica el crecimiento (reglas._fijasEspejo). El campo lo
    // DICE en vez de quedarse en 'auto' mintiendo — el mismo trato que ya recibe el
    // Δ replicado unas líneas más abajo.
    var Rm = global.ModeladorReglas;
    var fEsp = (Rm && Rm.fijasEspejoDeComponente) ? (Rm.fijasEspejoDeComponente(c) || {}) : {};
    if (fEsp[L]) {
      inp.disabled = true;
      inp.placeholder = '↔ ' + fEsp[L].de;
      inp.title = 'Este lado mide lo mismo que ' + fEsp[L].de + ' (contorno cerrado): ' +
        'su medida se replica sola. Para cambiarla, edita el lado ' + fEsp[L].de + '.';
    }
    // El TIRADOR DEL MARCO escribe ESTE campo (ya no el Δ): mientras se estira la
    // pieza, la ficha tiene que decir la medida que el tirador acaba de dejar en la
    // receta y no la de antes de agarrarla. Misma regla que el resto de los campos
    // vivos; el lado espejo se deja quieto porque su valor lo replica el motor.
    if (!fEsp[L]) _vivo(function () { _valVivo(inp, (d.modo === 'fija' && d.valor != null) ? d.valor : ''); });
    // (El candado que estaba acá se retiró: el modo lo dice el propio campo.)
    inp.title = 'Medida de este lado en cm. Vacío = la deriva el elemento (auto).';
    wrap.appendChild(inp);

    // --- Δ DE ESTE LADO + POR QUÉ PUNTA ---------------------------------------
    // El motor ya lo consume entero (suma al largo de corte y a los kg, y en una
    // figura CERRADA lo replica en el lado espejo). Acá sólo se escribe y se
    // MUESTRA de dónde viene: si el Δ de este lado llegó por réplica, el campo lo
    // dice en vez de aparecer vacío mintiendo.
    var R = global.ModeladorReglas;
    var dEf = (R && R.deltasDeComponente) ? (R.deltasDeComponente(c) || {}) : {};
    var info = dEf[L] || null;
    var propio = (d.delta != null && d.delta !== '');
    var esEspejo = !!(info && info.origen === 'espejo' && !propio);
    var inDelta = _input({
      value: esEspejo ? info.delta : (propio ? d.delta : ''),
      placeholder: 'Δ',
      type: 'number'
    }, function (v) {
      var t = String(v == null ? '' : v).trim();
      if (t === '' || Number(t) === 0) { delete d.delta; } else { d.delta = Number(t); }
      _mut(ci);
    });
    inDelta.className = 'te-delta';
    if (esEspejo) {
      // LADO ESPEJO: BLOQUEADO y con LA MISMA MEDIDA EN AZUL (pedido del usuario).
      // En un contorno cerrado los lados opuestos miden lo mismo — dejar el campo
      // editable invitaba a escribir dos números que no pueden coexistir (el marco
      // es un rectángulo). Se muestra el valor heredado, no un placeholder: lo que
      // se ve es lo que se corta.
      inDelta.disabled = true;
      inDelta.classList.add('te-delta-esp');
      inDelta.title = 'Δ ' + info.delta + ' cm — este lado mide lo mismo que ' + info.de +
        ' (contorno cerrado): su Δ se replica solo. Para cambiarlo, edita el lado ' + info.de + '.';
    } else {
      inDelta.title = 'Δ de este lado en cm: se suma al largo de corte y a los kg. Negativo acorta.';
    }
    var lblD = document.createElement('span');
    lblD.className = 'te-deltalbl'; lblD.textContent = 'Δ';
    lblD.title = 'Prolongación de este lado (traslapo). Se suma al largo de corte y a los kg.';
    wrap.appendChild(lblD);
    wrap.appendChild(inDelta);
    // ESTE Δ YA NO LO ESCRIBE EL TIRADOR (21-ago): el tirador escribe la MEDIDA (el
    // campo de arriba). El Δ se queda como estaba porque sigue siendo una intención
    // distinta y válida —«tanto menos de lo que dé el hormigón»— y el motor lo suma
    // a la medida. Se refresca en vivo igual: un arrastre puede cambiar la medida de
    // este lado y el panel no puede decir un número distinto del que se dibuja.
    // El lado espejo se deja quieto: su valor lo replica el motor y el campo está
    // bloqueado.
    if (!esEspejo) _vivo(function () { _valVivo(inDelta, (d.delta != null && d.delta !== '') ? d.delta : ''); });

    // FLECHA: por qué punta crece o se acorta. En un contorno CERRADO no se
    // ofrece — ahí el Δ va en pareja y el marco crece SIMÉTRICO (el motor ignora
    // `extremo`), así que un control que no hace nada sería una mentira.
    var pares = (fp.paresEspejoFigura ? fp.paresEspejoFigura(c.figura) : null) || {};
    var cerrada = !!Object.keys(pares).length;
    // FLECHA DE DIRECCIÓN — en las abiertas es de 2 estados (por qué punta crece) y
    // en las CERRADAS de 3, con el CENTRO por defecto: un contorno cerrado crecía
    // siempre simétrico y el usuario necesita acortar el estribo y CARGARLO a un
    // costado (estribo de confinamiento). El largo de corte es el mismo en los
    // tres; lo que cambia es dónde queda la barra.
    // LA FLECHA SE PINTA EN LOS DOS LADOS DEL PAR (reporte 19-ago: «deja la flecha,
    // que estén linkeadas también»). Antes sólo salía en el lado que el usuario tocó,
    // así que la fila del espejo tenía una celda MENOS y el par se veía desalineado
    // (B: «Δ −577 → 60φ» · D: «Δ −577 60φ»). El espejo la muestra BLOQUEADA, igual que
    // su campo Δ: el motor replica `extremo` junto con el valor, o sea que es el mismo
    // dato y no puede tener dos estados.
    // OJO: el estado se lee del lado que MANDA (`dFlecha`), no de _deltasEfectivos.
    // Esa función normaliza «sin extremo» a 'fin' y aquí el default de una figura
    // CERRADA es 'centro' — leerla de ahí habría pintado '→' en el espejo mientras su
    // par muestra '↔', que es otra vez el par diciendo dos cosas distintas.
    var dFlecha = esEspejo ? (c.dims[info.de] || {}) : d;
    var ext = (dFlecha.extremo === 'ini') ? 'ini' : (dFlecha.extremo === 'fin' ? 'fin' : (cerrada ? 'centro' : 'fin'));
    var flecha = document.createElement('button');
    flecha.type = 'button'; flecha.className = 'te-deltadir' + (esEspejo ? ' te-deltadir-esp' : '');
    flecha.textContent = (ext === 'fin') ? '→' : (ext === 'ini' ? '←' : '↔');
    flecha.title = (ext === 'centro')
      ? 'Crece/acorta CENTRADO (mitad por cada borde). Clic para cargarlo a un lado.'
      : (ext === 'fin'
        ? 'Crece/acorta por el borde FINAL' + (cerrada ? ' (el opuesto queda quieto)' : ' (el inicio queda quieto)') + '. Clic para cambiar.'
        : 'Crece/acorta por el borde INICIAL' + (cerrada ? ' (el opuesto queda quieto)' : ' (el final queda quieto)') + '. Clic para cambiar.');
    if (esEspejo) {
      flecha.disabled = true;
      flecha.title = 'Por dónde crece este lado: lo mismo que ' + info.de + ' (contorno cerrado), ' +
        'igual que su Δ. Para cambiarlo, edita el lado ' + info.de + '.';
    } else {
      flecha.onclick = function () {
        // cerradas: centro → fin → ini → centro · abiertas: fin ↔ ini
        if (cerrada) d.extremo = (ext === 'centro') ? 'fin' : (ext === 'fin' ? 'ini' : 'centro');
        else d.extremo = (ext === 'fin') ? 'ini' : 'fin';
        _mut(ci); _renderPanel();
      };
    }
    wrap.appendChild(flecha);

    // ATAJO 60φ — rescatado de la fila de EMPALME, que se retiró por redundante
    // (era el mismo concepto —prolongar el extremo libre— en otro campo y sólo para
    // el lado longitudinal). Acá sirve para CUALQUIER lado.
    // EL 40φ SE ELIMINÓ (21-ago, decisión del usuario: «el 40φ no se usa nunca»).
    // Queda la lista por si mañana vuelve a haber más de un atajo: el bucle es el
    // mismo y _nPhi ya calcula cualquier n·φ.
    [60].forEach(function (nPhi) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'te-phibtn';
      b.textContent = nPhi + 'φ';
      var cm = _nPhi(c, nPhi);
      b.title = nPhi + ' diámetros · φ' + (c.diam || '?') + ' → ' + cm + ' cm';
      b.onclick = function () { _pushUndo(); d.delta = cm; _mut(ci, true); _renderPanel(); };
      wrap.appendChild(b);
    });

    // LO QUE ESE LADO MIDE DE VERDAD (25-ago, pedido del usuario: «agrega el valor de
    // cada lado en esta parte… así si el usuario selecciona una barra, tiene los
    // valores reales que entrega esa barra»). La fila decía cómo NACE el lado —auto,
    // fijo, su Δ, su extremo— pero no cuánto termina midiendo, que es el número que
    // el usuario le va a leer al taller. Sale del motor, no de una cuenta propia:
    // es el `dims` del placement que la última generación emitió para esta barra.
    // Se refresca solo, porque la ficha se vuelve a armar en cada regeneración.
    var val = _span('—');
    val.className = 'te-dimval vacio';
    // SE REFRESCA SOLA EN CADA REGENERACIÓN (25-ago, reportado: «si modifico, tengo
    // que soltar la barra para que la vuelva a reconocer; debe actualizarse cuando
    // hago la edición»). Escribir el número una vez al armar la ficha no alcanza:
    // editar un campo REGENERA pero NO vuelve a armar la ficha —a propósito, para no
    // robarle el foco a quien está tecleando—, así que la medida se quedaba en el
    // valor de hace un rato. Se apunta en un registro y `_regenerar` la reescribe.
    // Es SEGURO hacerlo siempre, al revés que los refrescadores de _panelVivo: esto
    // escribe en un <span>, no en un <input>, así que no puede pisar lo que el
    // usuario está escribiendo ni moverle el cursor.
    ST._medVivas.push({ el: val, ci: ci, L: L });
    wrap.appendChild(val);
    row.appendChild(wrap);
    return row;
  }

  // Reescribe TODAS las medidas de la ficha con lo que el motor acaba de emitir.
  // Silenciosa si la ficha no tiene ninguna (nada seleccionado, o una figura sin
  // filas de lado).
  function _refrescarMedidasLados() {
    var L = ST._medVivas;
    if (!L || !L.length) return;
    for (var i = 0; i < L.length; i++) {
      var r = L[i];
      if (!r || !r.el) continue;
      var v = _medidaLadoReal(r.ci, r.L);
      r.el.textContent = (v == null) ? '—' : (v + '');
      r.el.className = 'te-dimval' + (v == null ? ' vacio' : '');
      r.el.title = (v == null)
        ? 'Todavía no hay una barra generada para leer esta medida.'
        : 'Lo que mide el lado ' + r.L + ' en la barra que se está generando: ' + v + ' cm.';
    }
  }

  // La medida REAL de un lado, tal como salió de la última generación. Se lee del
  // placement, que es lo que el motor emitió — no se recalcula acá, porque una
  // segunda cuenta que "debería dar lo mismo" es una que algún día no lo da.
  function _medidaLadoReal(ci, L) {
    var out = ST.ultimoOut;
    if (!out || !out.placements) return null;
    for (var i = 0; i < out.placements.length; i++) {
      var pl = out.placements[i];
      if (!pl.meta || pl.meta.ci !== ci) continue;
      var v = pl.dims ? Number(pl.dims[L]) : NaN;
      if (!isFinite(v)) return null;
      return Math.round(v * 10) / 10;
    }
    return null;
  }

  // Panel de distribución = SELECTOR de modo (3 botones) + campos CONTEXTUALES
  // según el modo (menú contextual, §0-11ter / §INTERACCIÓN-2.0). El "centrar vs
  // repartir" del modo puntual es un control EXPLÍCITO (no truco de clics).
  function _distBox(c, ci, rol, d) {
    var modo = _modoDe(c);
    var box = _div('te-modebox');

    // --- cabecera: título + chip del modo activo ---
    var head = _div('te-mh');
    var chip = { puntual: 'PUNTUAL', lineal: 'DISTRIBUCIÓN', arreglo: 'ARREGLO' }[modo] || 'PUNTUAL';
    head.innerHTML = '<span>Colocación</span><span class="te-chip">' + chip + '</span><span style="flex:1"></span>';
    box.appendChild(head);

    // --- los 3 BOTONCITOS DE MODO ---
    var seg = _div('te-modeseg');
    [['puntual', 'Puntual', 'Barras/capas hacia el núcleo'],
     ['lineal', 'Distribución', 'Rango @ espaciamiento (ceil(dist/@)+1)'],
     ['arreglo', 'Arreglo', 'Rango × capas (malla / trabas)']
    ].forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'te-modebtn' + (m[0] === modo ? ' on' : '');
      b.textContent = m[1];
      b.title = m[2];
      b.addEventListener('click', function () {
        if (_modoDe(c) === m[0]) return;
        _pushUndo();
        _setModoComp(c, m[0]);
        _regenerar();
        _renderPanel();   // re-render → campos contextuales del nuevo modo
      });
      seg.appendChild(b);
    });
    box.appendChild(seg);

    // --- campos contextuales por modo ---
    if (modo === 'puntual') _camposPuntual(box, c, ci, rol, d);
    else if (modo === 'lineal') _camposLineal(box, c, ci, rol, d);
    else _camposArreglo(box, c, ci, rol, d);

    return box;
  }

  // PUNTUAL — cara (arriba, ya está en la ficha) + centrar/repartir + nº barras/capa
  // + nº capas + espaciamiento (las capas se apilan hacia el núcleo).
  function _camposPuntual(box, c, ci, rol, d) {
    // centrar vs repartir: control EXPLÍCITO (reparte las barras/capa a lo ancho,
    // o las centra). Se persiste en d.justify (dato para el motor/futuro).
    var jRow = _div('te-row');
    jRow.appendChild(_label('Disposición'));
    jRow.appendChild(_radial([['centrar', 'Centrar'], ['repartir', 'Repartir']], d.justify || 'centrar', function (v) { d.justify = v; _mut(ci); }));
    box.appendChild(jRow);

    var g3 = _div('te-grid3');
    g3.appendChild(_fld('Barras/capa', _input({ value: d.barras_capa || 1, type: 'number' }, function (v) { d.barras_capa = Math.max(1, Number(v) || 1); _mut(ci, true); })));
    g3.appendChild(_fld('N° capas', _input({ value: d.n_capas || 1, type: 'number' }, function (v) { d.n_capas = Math.max(1, Number(v) || 1); _mut(ci, true); })));
    // gap = separación entre capas. Contrato nuevo del motor: es EJE A EJE (antes se
    // leía como luz libre) → el label lo dice para que el usuario no dude.
    g3.appendChild(_fld('Sep. ejes cm', _input({ value: d.gap != null ? d.gap : 4, type: 'number' }, function (v) { d.gap = Number(v) || 0; _mut(ci); }),
      'Separación entre ejes de capas (eje a eje)'));
    box.appendChild(g3);
    _filaAnidar(box, c, ci, rol, d);
    var note = _div('te-note'); note.textContent = 'Las capas se apilan desde la cara hacia adentro.';
    box.appendChild(note);
  }

  // TOGGLE del anidado de CAPAS — visible SIEMPRE que haya más de una capa. El
  // significado (y el default) dependen del rol, igual que en el motor:
  //   · PIEZA DE SECCIÓN (estribo Y TRABA) → anidar es el DEFAULT (las capas
  //                interiores se achican hacia adentro). El check nace marcado;
  //                desmarcarlo escribe anidar=false.
  //   · CABEZAL/otros → el anidado es OPT-IN: el check nace desmarcado y sólo al
  //                marcarlo se escribe anidar=true (desmarcar borra el campo). La
  //                semántica actual NO alinea patas: achica B y desplaza la capa.
  // LA TRABA ENTRA CON EL ESTRIBO (defecto F1): el motor las trata a las dos como
  // piezas de sección —encuadran el mismo marco de núcleo y anidan por default—, así
  // que el check tiene que decir lo mismo que hace el motor. Cuando esto miraba sólo
  // `rol === 'estribo'`, una traba de 2+ capas mostraba el toggle apagado mientras el
  // motor anidaba: el usuario leía un estado que no era el suyo.
  // Aquí sólo se escribe el dato (distribucion.anidar); quien lo consume es el motor.
  // ¿EL ANIDADO CAMBIA ALGO EN ESTA FIGURA? Se le PREGUNTA AL MOTOR en vez de
  // mantener una tabla figura por figura: se expande un clon con el anidado apagado
  // y otro con él encendido, y se comparan las barras que salen (sus dims y cuántas
  // son). Mismo criterio que el sondeo del tirador del marco.
  //
  // POR QUÉ HACE FALTA (25-ago, reportado por el usuario: «ajustar las capas
  // anidadas no hace nada»). Y era cierto EN SU CASO: el anidado acorta las PATAS de
  // la capa interior para que no choquen con la de afuera, y una barra recta (101A)
  // no tiene patas que acortar. MEDIDO: 101A con dos capas da A=595 con el check
  // marcado y sin marcar; una 103B en cambio pasa de B=592 a 588,8 en la 2ª capa
  // (−3,2 = dos diámetros de ø16). El check no estaba roto: estaba ofrecido donde no
  // aplica, que para el usuario es lo mismo que roto.
  function _anidadoCambiaAlgo(c) {
    var R = global.ModeladorReglas, host = _hostDeReceta();
    if (!R || !R.expandirComponente || !host || !c) return true;   // ante la duda, se ofrece
    function firma(valor) {
      var clon = JSON.parse(JSON.stringify(c, function (k, v) {
        return (String(k).charAt(0) === '_') ? undefined : v;
      }));
      clon.distribucion = clon.distribucion || {};
      clon.distribucion.anidar = valor;
      var pls;
      try { pls = R.expandirComponente(clon, host) || []; } catch (e) { return null; }
      return pls.length + '|' + pls.map(function (p) { return JSON.stringify(p.dims || {}); }).join(';');
    }
    var a = firma(false), b = firma(true);
    if (a == null || b == null) return true;
    return a !== b;
  }

  function _filaAnidar(box, c, ci, rol, d) {
    if (!(Number(d.n_capas) > 1)) return;
    var esEstribo = (rol === 'estribo' || rol === 'traba');
    // EL CHECK NO SE OFRECE SI NO HARÍA NADA. En vez de dejarlo ahí sin efecto —que
    // es lo que el usuario reportó— se dice POR QUÉ no está: si no, su ausencia sería
    // otro misterio. Sólo se evalúa en las figuras OPT-IN: en una cerrada el anidado
    // viene puesto y apagarlo siempre cambia algo (medido: la 2ª capa de un 104D en
    // una viga de 60 no cabe anidada y el motor no la emite).
    if (!esEstribo && !_anidadoCambiaAlgo(c)) {
      var nota = _div('te-note');
      nota.textContent = 'El anidado acorta las patas de la capa de adentro; esta figura no tiene patas que acortar, así que las capas van iguales.';
      box.appendChild(nota);
      return;
    }
    var row = _div('te-fld');
    var lab = document.createElement('label');
    lab.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer';
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = esEstribo ? (d.anidar !== false) : (d.anidar === true);
    chk.style.width = 'auto';
    chk.addEventListener('change', function () {
      if (esEstribo) d.anidar = chk.checked;          // false = desactiva el default
      else if (chk.checked) d.anidar = true;          // opt-in explícito
      else delete d.anidar;                           // volver al default (sin ajuste)
      _mut(ci, true);
    });
    var txt = document.createElement('span');
    txt.textContent = esEstribo
      ? 'Capas anidadas (se achican hacia adentro)'
      : 'Ajustar capas anidadas';
    lab.appendChild(chk); lab.appendChild(txt);
    row.appendChild(lab);
    box.appendChild(row);
  }

  // LINEAL — rango (from/to) + espaciamiento @. cant = ceil(dist/@)+1.
  function _camposLineal(box, c, ci, rol, d) {
    // Si la semilla trae ZONAS (sin rango), se editan por zona (confinamiento).
    if (d.zonas && d.zonas.length && !d.rango && d.zonas.some(function (z) { return z.long > 0; })) {
      d.zonas.forEach(function (z, zi) {
        var zr = _div('te-grid2');
        zr.appendChild(_fld('Zona ' + (zi + 1) + ' long', _input({ value: z.long, type: 'number' }, function (v) { z.long = Number(v) || 0; _mut(ci); })));
        zr.appendChild(_fld('@ sep cm', _inputSep(z.sep, function (v) { z.sep = v; _mut(ci); })));
        box.appendChild(zr);
      });
      var note0 = _div('te-note'); note0.textContent = 'Para pasar a un rango, arrastra la flecha doble sobre la barra seleccionada.';
      box.appendChild(note0);
      return;
    }
    // Con VARIOS tramos el @ simple ya no describe nada (cada tramo tiene el suyo) →
    // se esconde y manda el editor de tramos. Con uno solo se mantiene como atajo.
    var multi = _tramosDe(d).length > 1;
    var g2 = _div(multi ? '' : 'te-grid2');
    if (!multi) g2.appendChild(_fld('@ sep cm', _inputSep(d.sep || 20, function (v) { d.sep = v; if (d.rango) d.rango.sep = d.sep; _syncN(d, 'rango'); _mut(ci, true); })));
    var edR = _rangoEditor(c, d, ci);
    g2.appendChild(_fld(edR._rotulo(), edR));
    box.appendChild(g2);
    _tramosEditor(box, d, ci);
    // La nota que explicaba cómo se edita el rango se retiró (20-ago): los campos
    // están ahí mismo y la flecha se ve en las vistas — describía lo evidente y
    // ocupaba alto del panel, que es lo escaso.
  }

  // ARREGLO — rango en un sentido + n_capas + sep_capas (rango × capas). El eje de
  // profundidad de las capas lo fija el plano de trabajo (eje_capas).
  function _camposArreglo(box, c, ci, rol, d) {
    if (!d.rango) d.rango = _rangoDefault(d.sep || 20, _ejeDistDe(c));
    var multi = _tramosDe(d).length > 1;
    var g2 = _div(multi ? '' : 'te-grid2');
    if (!multi) g2.appendChild(_fld('@ sep (rango) cm', _inputSep(d.sep || 20, function (v) { d.sep = v; if (d.rango) d.rango.sep = d.sep; _syncN(d, 'rango'); _mut(ci, true); })));
    var edR = _rangoEditor(c, d, ci);
    g2.appendChild(_fld(edR._rotulo(), edR));
    box.appendChild(g2);
    _tramosEditor(box, d, ci);

    // --- 2ª LÍNEA DE DISTRIBUCIÓN (rango2) -----------------------------------
    // El ARREGLO es un reparto por ÁREA: dos líneas, cada una con su eje, su
    // rango y su @ (y sus tramos). El motor lo consume desde la tanda del arreglo
    // por área y PREFIERE `rango2` cuando está; sin él cae a las capas legadas
    // (n_capas/sep_capas/eje_capas), que es lo único que esta UI ofrecía.
    // Una receta VIEJA con capas se respeta tal cual —convertirla sola movería
    // barras sin permiso—: se muestran sus campos con el botón para pasarla.
    var legadoCapas = (!d.rango2 && Number(d.n_capas) > 1);
    if (legadoCapas) {
      var g3 = _div('te-grid3');
      g3.appendChild(_fld('N° capas', _input({ value: d.n_capas || 2, type: 'number' }, function (v) { d.n_capas = Math.max(1, Number(v) || 1); _mut(ci); })));
      g3.appendChild(_fld('Sep. ejes cm', _input({ value: d.sep_capas != null ? d.sep_capas : 10, type: 'number' }, function (v) { d.sep_capas = Number(v) || 0; _mut(ci); }),
        'Separación entre ejes de capas (eje a eje)'));
      g3.appendChild(_fld('Prof. (capas)', _selectPairs([['x', 'largo'], ['y', 'alto'], ['z', 'ancho']], d.eje_capas || _ejeCapasDefault(), function (v) { d.eje_capas = v; _mut(ci); })));
      box.appendChild(g3);
      var conv = document.createElement('button');
      conv.type = 'button'; conv.className = 'te-ctool'; conv.textContent = 'Convertir a 2ª línea de distribución';
      conv.title = 'Pasa estas capas a un segundo rango (from → to con su @), que es la forma nueva: ' +
        'se puede arrastrar, admite tramos y no está atada a la profundidad.';
      conv.onclick = function () { d.rango2 = _rango2Default(c, d); _mut(ci); _renderPanel(); };
      box.appendChild(conv);
    } else {
      if (!d.rango2) d.rango2 = _rango2Default(c, d);
      // EJE DE LA 2ª LÍNEA: AUTOMÁTICO (pedido 17-ago — «hay espacio para
      // mejora ahí»). Es el único eje que queda: el plano de la pieza tiene
      // dos, la 1ª línea reparte por la normal, así que la 2ª corre por el
      // otro eje del plano. Un desplegable ofrecía elegir entre 3 ejes de los
      // cuales 2 estaban mal — se deriva y se DICE en el label.
      if (!d.rango2.eje) d.rango2.eje = _rango2Default(c, d).eje;
      var nomEje2 = ({ x: 'largo', y: 'alto', z: 'ancho' })[d.rango2.eje] || d.rango2.eje;
      var g2b = _div('te-grid2');
      g2b.appendChild(_fld('@ sep (2ª) cm', _inputSep(d.rango2.sep || 20, function (v) {
        d.rango2.sep = v; _syncN(d, 'rango2'); _mut(ci, true);
      }), 'Espaciamiento de la SEGUNDA línea (la del eje ' + nomEje2 + ')'));
      var edR2 = _rangoEditor(c, d, ci, 'rango2', 'Rango 2ª · ' + nomEje2);
      g2b.appendChild(_fld(edR2._rotulo(), edR2,
        'La 2ª línea corre por el ' + nomEje2 + ' (automático: el otro eje del plano de la pieza).'));
      box.appendChild(g2b);
    }
    _filaAnidar(box, c, ci, rol, d);
    var note = _div('te-note');
    note.textContent = legadoCapas
      ? 'Forma antigua: un rango a lo largo × N capas en profundidad. Convertir lo deja como dos líneas de reparto.'
      : 'Dos líneas de reparto, cada una con su rango y su @. La cantidad final es una por la otra.';
    box.appendChild(note);
  }

  // Default de la 2ª línea: el eje que NO usa la 1ª y que NO es el desarrollo de
  // la pieza (el motor decide igual si la receta no lo declara; acá se propone
  // uno CONCRETO para que el usuario vea el rango encuadrado desde el principio).
  function _rango2Default(c, d) {
    var e1 = (d.rango && d.rango.eje) || 'x';
    var eDes = _ejeDistDe(c);          // por donde reparte la 1ª (normal del plano)
    var libres = ['x', 'y', 'z'].filter(function (e) { return e !== e1 && e !== eDes; });
    var eje = libres[0] || ['x', 'y', 'z'].filter(function (e) { return e !== e1; })[0] || 'y';
    var base = _rangoDefault(d.sep || 20, eje);
    // El ancla viaja con el rango: la 2ª línea también sigue al hormigón.
    return _anclarRangoUI({ eje: eje, from: base.from, to: base.to, sep: base.sep }, eje);
  }

  // EDITOR DE TRAMOS del panel (punto 4a) — una fila por tramo: largo cm + @ cm + ×,
  // y "+ Tramo" al final. Con un solo tramo no hay filas (el @ simple de arriba es el
  // atajo) pero sí el "+ Tramo", que es la puerta de entrada al reparto multi-@.
  function _tramosEditor(box, d, ci) {
    if (!d.rango) return;                       // sin rango no hay nada que subdividir
    var arr = _tramosDe(d);
    if (arr.length > 1) {
      var head = _div('te-note');
      head.style.marginTop = '2px';
      head.textContent = 'Tramos (desde el inicio del rango). Cambiar un largo mueve su límite: el vecino compensa.';
      box.appendChild(head);
      arr.forEach(function (t, i) {
        var row = _div('te-tramo');
        var inLong = _input({ value: Math.round(t.long * 10) / 10, type: 'number' }, function (v) {
          _pushUndo(); _setLongTramo(d, i, Number(v) || 0); _mut(ci, true);
        });
        row.appendChild(_fld('Largo ' + (i + 1) + ' cm', inLong));
        // El tirador del DIVISOR mueve este largo: se relee de la receta en cada
        // frame del arrastre (`_tramosDe`, no el `t` capturado, que es una copia).
        _vivo(function () {
          var a = _tramosDe(d);
          if (a[i]) _valVivo(inLong, Math.round(a[i].long * 10) / 10);
        });
        row.appendChild(_fld('@ ' + (i + 1) + ' cm', _inputSep(t.sep, function (v) {
          _pushUndo();
          var a = _tramosDe(d); a[i].sep = v; _setTramos(d, a);
          _mut(ci, true);
        })));
        var x = document.createElement('button');
        x.type = 'button'; x.className = 'te-tramo-x'; x.textContent = '×';
        x.title = 'Quitar este tramo (su largo pasa al vecino)';
        x.addEventListener('click', function () { _pushUndo(); _delTramo(d, i); _mut(ci, true); });
        row.appendChild(x);
        box.appendChild(row);
      });
    }
    var add = document.createElement('button');
    add.type = 'button'; add.className = 'te-tramo-add'; add.textContent = '＋ Tramo';
    add.title = 'Divide el rango en tramos con espaciamiento propio (parte el último en dos)';
    add.addEventListener('click', function () { _pushUndo(); _addTramo(d); _mut(ci, true); });
    box.appendChild(add);
  }

  // Editor compacto del rango (from/to en cm) — números editables.
  // `campo` (4º arg): 'rango' (default, la 1ª línea) o 'rango2' (la 2ª del arreglo
  // por área). Es el MISMO editor para las dos — si la 2ª tuviera el suyo propio,
  // cualquier arreglo posterior (tramos, snap, arrastre) quedaría a medias en una.
  // Mantiene coherentes `n`, `to` y `@` de una línea expresada por CANTIDAD.
  // Se llama cuando cambia el @ (el extremo se recalcula: N manda) y desde el
  // arrastre (ahí manda el gesto: N se recalcula del largo nuevo).
  function _syncN(d, cual, desdeArrastre) {
    var r = d && d[cual];
    if (!r || r.n == null) return;
    var sep = Number(r.sep) || Number(d.sep) || 20;
    if (desdeArrastre) {
      r.n = _cantidadDe(Number(r.to) - Number(r.from), sep);
      return;
    }
    var sgn = (Number(r.to) >= Number(r.from)) ? 1 : -1;
    r.to = Number(r.from) + sgn * (Math.max(1, Math.round(Number(r.n))) - 1) * sep;
    _anclarRangoUI(r, r.eje);   // el `to` se movió → su ancla también (helper único)
  }

  function _rangoEditor(c, d, ci, campo, prefijo) {
    var cual = (campo === 'rango2') ? 'rango2' : 'rango';
    var pref = (prefijo != null) ? prefijo : 'Rango';
    // EL RÓTULO DEL CAMPO LLEVA EL LARGO (19-ago) — el MISMO número que se ve sobre el
    // abanico en la vista, sacado de la MISMA cuenta (_largoRango) sobre el MISMO
    // from/to. No es una copia del dato: es la única fuente leída dos veces, que es lo
    // único que no se puede desincronizar.
    function _rotulo() { return pref + ' · ' + Math.round(_largoRango(d[cual])) + ' cm'; }
    var wrap = _div(''); wrap.style.cssText = 'display:flex;gap:4px;align-items:center';
    wrap._rotulo = _rotulo;
    if (!d[cual]) {
      var st = _static('(arrastra la flecha de rango)');
      st._rotulo = function () { return pref; };   // sin rango no hay largo que decir
      return st;
    }
    // Se refresca A MANO tras cada edición: el panel NO se re-renderiza mientras se
    // teclea (le robaría el foco al usuario) y un número que miente es peor que ninguno.
    function _refrescarRotulo() { if (wrap._lbl) wrap._lbl.textContent = _rotulo(); }
    // Cambiar from/to reencaja los TRAMOS (si los hay) y sólo entonces redibuja la
    // ficha — si no, un re-render en cada campo le robaría el foco al usuario.
    function _setExtremo(k, v) {
      d[cual][k] = Number(v);
      _anclarRangoUI(d[cual], d[cual].eje);   // el número que escribió el usuario ES el ancla
      var hayTramos = !!(d[cual].tramos && d[cual].tramos.length > 1);
      if (cual === 'rango') _syncTramos(d);
      _mut(ci, hayTramos);
      _refrescarRotulo();   // DESPUÉS de regenerar: el motor pudo topar el extremo
    }
    // ============================================================
    // TOGGLE «hasta dónde» ⇄ «cuántas» (pedido 15-ago)
    // ------------------------------------------------------------
    // El rango siempre fue from → to, y para poner "3 columnas @15 desde el borde"
    // había que calcular el `to` a mano. Ahora cada línea decide cómo se expresa:
    //   →N  (cantidad): escribes CUÁNTAS y el `to` sale de from + (N−1)·@.
    //   →   (extremos): lo de siempre.
    // Es AZÚCAR DE UI: la receta sigue guardando from/to/sep, así que el motor, el
    // despiece y los templates ya guardados no se enteran. Lo único que se persiste
    // de más es `n`, para que al reabrir la línea siga expresada como la dejaste
    // (el motor ignora los campos que no conoce).
    var r = d[cual];
    var porCantidad = (r.n != null && Number(r.n) > 0);
    // EL RANGO VIVO, no el capturado: el arrastre puede REEMPLAZAR el objeto
    // (`_dragRangoMove` termina con `d[cual] = rango`, y activar la distribución
    // estrena uno nuevo). Leyendo el capturado, el refresco en vivo escribía el
    // número de un objeto muerto — medido: con el rango cambiado a 592 cm @20 (31
    // columnas) el campo seguía diciendo 11.
    function _rr() { return d[cual] || r; }
    function _sepDe() { return Number(_rr().sep) || Number(d.sep) || 20; }
    function _nDeRango() {
      return _cantidadDe(Number(_rr().to) - Number(_rr().from), _sepDe());
    }
    // Escribe SIEMPRE sobre el rango vivo (_rr), no sobre el capturado: si un
    // arrastre reemplazó el objeto, escribir en el muerto se pierde en silencio.
    function _aplicarN(n) {
      var rv = _rr();
      n = Math.max(1, Math.round(Number(n) || 1));
      rv.n = n;
      var sgn = (Number(rv.to) >= Number(rv.from)) ? 1 : -1;
      rv.to = Number(rv.from) + sgn * (n - 1) * _sepDe();
      _anclarRangoUI(rv, rv.eje);             // el `to` calculado por N también se ancla
      if (cual === 'rango') _syncTramos(d);
      _mut(ci, true);
    }
    // DOS CAMPOS LIMPIOS + TOGGLE A LA DERECHA (pedido 17-ago: «elimina esa
    // flechita entre campos... deja solo los 2 campos» + «a la derecha un botón
    // que elimine el rango y deje una celda con la cantidad de columnas»).
    //   · extremos: [dónde la PRIMERA] [dónde la ÚLTIMA]  (cm desde el centro
    //     del elemento, sobre el eje de esta línea)
    //   · cantidad: una sola celda [cuántas] — el grupo parte del mismo inicio
    //     y el final se calcula solo (from + (N−1)·@).
    var tog = document.createElement('button');
    tog.type = 'button'; tog.className = 'te-rmodo' + (porCantidad ? ' on' : '');
    tog.textContent = '▥';
    tog.title = porCantidad
      ? 'Expresado por CANTIDAD de columnas. Clic para volver a extremos (desde → hasta en cm).'
      : 'Expresar por CANTIDAD DE COLUMNAS: deja una sola celda con cuántas van (cada @, desde el mismo inicio).';
    tog.onclick = function () {
      if (porCantidad) { delete _rr().n; _mut(ci, true); }
      else { _aplicarN(_nDeRango()); }
    };
    if (porCantidad) {
      var nn = _input({ value: _nDeRango(), type: 'number', min: 1 }, function (v) { _aplicarN(v); });
      nn.style.width = '52px';
      nn.title = 'CUÁNTAS columnas. Parten en ' + Math.round(r.from) + ' cm, cada ' + _sepDe() +
        ' cm; el final se calcula solo.';
      wrap.appendChild(nn);
      _vivo(function () { if (d[cual]) { _valVivo(nn, _nDeRango()); _refrescarRotulo(); } });
    } else {
      var fi = _input({ value: Math.round(r.from), type: 'number' }, function (v) { _setExtremo('from', v); });
      fi.style.width = '52px';
      fi.title = 'Dónde va la PRIMERA barra de esta línea (cm desde el centro del elemento, sobre su eje).';
      var ff = _input({ value: Math.round(r.to), type: 'number' }, function (v) { _setExtremo('to', v); });
      ff.style.width = '52px';
      ff.title = 'Dónde va la ÚLTIMA barra (cm). La cantidad la calcula el motor: ceil(dist/@)+1.';
      wrap.appendChild(fi); wrap.appendChild(ff);
      // ARRASTRE EN CURSO: los dos extremos y el rótulo siguen al tirador. Se relee
      // `d[cual]` —el rango VIVO de la receta— y no una copia: el arrastre puede
      // reemplazar el objeto entero (activar la distribución estrena uno nuevo).
      _vivo(function () {
        var rr = d[cual]; if (!rr) return;
        _valVivo(fi, Math.round(rr.from)); _valVivo(ff, Math.round(rr.to));
        _refrescarRotulo();
      });
    }
    wrap.appendChild(tog);
    return wrap;
  }

  // --- fábricas de UI reutilizables ---

  // ==========================================================================
  // POSICIÓN MEDIDA — TRES PARES DE CAMPOS, UNO POR EJE (23-ago)
  // --------------------------------------------------------------------------
  // Sustituye a las filas «A lo largo [2,4] cm de [extremo inicio ▾]». EL DESPLEGABLE
  // DESAPARECE: ya no hay que elegir referencia porque están las DOS distancias, una
  // a cada cara opuesta del eje. Encima de cada par va el icono de la caja con ESE PAR
  // de caras encendido — los mismos iconos del bloque de Orientación, no un segundo
  // juego de símbolos.
  //
  // SON DOS CASOS DISTINTOS, y el par no se comporta igual en los tres ejes:
  //   · EJE QUE NO REPARTE → los dos campos son DOS LECTURAS DE LA MISMA POSICIÓN.
  //     No son independientes: si la pieza está a 10 de una cara, su distancia a la
  //     otra ya está determinada por el tamaño del elemento. Los dos se escriben, y al
  //     escribir en uno EL OTRO SE RECALCULA SOLO (pedido expreso del usuario) — sale
  //     gratis porque los dos releen del generado después de mutar.
  //   · EJE QUE SÍ REPARTE → el par son LAS DOS PUNTAS DEL RANGO (ver
  //     _puntaRangoACara): dónde empieza y dónde termina el reparto, y moverlos mueve
  //     el rango. Ahí sí son independientes. NO se apagan: el usuario los quiere
  //     sincronizados con la distribución, y como todo campo vivo siguen al arrastre
  //     del abanico.
  //
  // CONTRA QUÉ SE MIDE (decisión cerrada): la CARA DEL HORMIGÓN, igual que la cota
  // viva del arrastre. Por dentro el ancla se sigue guardando contra el RECUBRIMIENTO
  // (reglas.js, _recubLadosEje), que es lo que hace que al cambiar el recubrimiento
  // las piezas se recoloquen. Las dos referencias conviven a propósito y difieren
  // exactamente en el recubrimiento.
  // ==========================================================================
  function _filasDesplazamiento(body, c, ci) {
    // Sin nada generado no hay medida honesta que rotular (la barra todavía no está
    // en ningún sitio). Aparece sola en cuanto se genera.
    var bb = _bboxCompMundo(ci);
    if (!bb) return;
    var libres = _ejesDesplazables(c);
    // RÓTULO al lado, no encima: la fila ya gasta alto con el icono y los dos campos,
    // y sin nombre nadie sabe qué son esos seis números. Lo que no cabe va al title.
    var envol = _div('te-posrow');
    var rot = _span('Offset');
    rot.className = 'te-posrot';
    rot.title = 'A cuántos centímetros está la barra de cada cara del hormigón. Cada par ' +
      'son las dos caras opuestas de un eje: escribes en el que te convenga y el otro se ' +
      'recalcula solo. En el eje por el que la barra se reparte, los dos campos son las ' +
      'puntas del reparto y sí son independientes.';
    envol.appendChild(rot);
    var fila = _div('te-posejes');
    var n = 0;
    _EJES3.forEach(function (eje) {
      if (!bb[eje]) return;
      fila.appendChild(_parPosicionEje(c, ci, eje, libres.indexOf(eje) >= 0));
      n++;
    });
    if (n) { envol.appendChild(fila); body.appendChild(envol); }
  }

  // UN par (icono + dos campos) del eje `eje`. `libre` = el desplazamiento manda en
  // este eje; si no, manda el rango que reparte por él.
  function _parPosicionEje(c, ci, eje, libre) {
    var rango = libre ? null : _rangoDeEje(c, eje);
    // Eje tomado por una distribución que NO expone un rango editable (el editor le
    // borra el hint a este eje en el primer gesto): se muestra la medida, pero
    // escribirla sería un número que se pierde solo. Se dice en el title.
    var muerto = !libre && !rango;
    var caras = _carasObraEje(eje);
    var ids = _carasIdDeEje(eje);
    var col = _div('te-poseje');
    var ico = _div('te-posico');
    ico.innerHTML = _iconoCaras6([ids.min, ids.max]);
    ico.title = EJE_ROTULO_POS[eje] + ' (eje ' + _ejeLetra(eje) + '): a la izquierda ' +
      caras.min + ', a la derecha ' + caras.max + '.';
    col.appendChild(ico);
    var par = _div('te-pospar');
    var campo = {};

    function leer(ref) {
      return rango ? _puntaRangoACara(rango, eje, ref)
                   : _huecoACara(_bboxCompMundo(ci), eje, ref);
    }
    function refrescar() {
      ['min', 'max'].forEach(function (ref) { _valVivo(campo[ref], _cm1(leer(ref))); });
    }
    ['min', 'max'].forEach(function (ref) {
      var inp = _input({ value: _cm1(leer(ref)), type: 'number', step: 'any' }, function (v) {
        // Campo vaciado = no hay medida que aplicar. Se repinta el valor de ahora en
        // vez de escribir un 0 que el usuario no pidió (mismo criterio que el candado
        // de las dims: un clic no inventa una medida).
        if (String(v == null ? '' : v).trim() === '') { refrescar(); return; }
        _pushUndo();
        var hecho = rango ? _setPuntaRangoACara(c, rango, eje, ref, v)
                          : _setHuecoACara(ci, eje, ref, v);
        if (!hecho) { refrescar(); return; }
        // La ficha no cambia de FORMA salvo que el rango lleve tramos (ahí se re-arma
        // la lista de tramos reencajada).
        _mut(ci, !!(rango && rango.tramos && rango.tramos.length > 1));
        refrescar();   // …y los DOS campos dicen dónde quedó DE VERDAD (pudo toparse)
      });
      inp.className = 'te-posd';
      if (muerto) inp.disabled = true;
      inp.title = _tituloPosicion(eje, ref, caras, rango, muerto);
      campo[ref] = inp;
      par.appendChild(inp);
    });
    col.appendChild(par);
    // Los campos siguen al ARRASTRE en vivo: mover la barra o el abanico con la mano
    // cambia estas distancias, y el panel no puede decir un número distinto del que se
    // dibuja (mismo trato que el rango, los tramos y el Δ).
    _vivo(refrescar);
    return col;
  }

  function _tituloPosicion(eje, ref, caras, rango, muerto) {
    var nom = (ref === 'max') ? caras.max : caras.min;
    var ejeTxt = ' (eje ' + _ejeLetra(eje) + ').';
    if (rango) {
      return 'Dónde ' + (ref === 'max' ? 'TERMINA' : 'EMPIEZA') + ' el reparto: cm entre ' + nom +
        ' y la barra de ese extremo' + ejeTxt + ' Mueve esa punta del rango, así que los ' +
        'dos campos del par son independientes (el largo del reparto es libre).';
    }
    if (muerto) {
      return 'Distancia entre esta barra y ' + nom + ', en cm' + ejeTxt + ' Sólo lectura: en ' +
        'este eje la posición la manda la distribución, y un número escrito acá se lo ' +
        'llevaría el primer gesto.';
    }
    return 'Distancia entre el BORDE de esta barra y ' + nom + ', en cm' + ejeTxt +
      ' Escríbela y la barra se va ahí: es el MISMO camino que arrastrarla, así que el ' +
      'número y el gesto no pueden discrepar. El otro campo del par es esta misma ' +
      'posición leída desde la cara opuesta, así que se recalcula solo. Al cambiar el ' +
      'hormigón la barra conserva su distancia a la cara. Negativo = se pasó de esa cara.';
  }

  // cm con UN decimal (lo que se lee en obra). null → campo vacío.
  function _cm1(v) {
    if (v == null || !isFinite(Number(v))) return '';
    return String(Math.round(Number(v) * 10) / 10);
  }

  function _div(cls) { var d = document.createElement('div'); if (cls) d.className = cls; return d; }
  function _label(t) { var l = document.createElement('label'); l.textContent = t; return l; }
  // <span> con texto: los rótulos que van DENTRO de una fila (la cabecera del bloque,
  // el "Patas" de la fila de acciones) no son <label> de ningún campo.
  function _span(t) { var s = document.createElement('span'); s.textContent = t; return s; }
  // `title` opcional: el label queda CORTO (no empuja la columna de la grilla) y la
  // explicación larga vive en el tooltip del campo entero.
  function _fld(labelText, inputEl, title) {
    var f = _div('te-fld');
    var l = _label(labelText);
    if (title) { l.title = title; f.title = title; }
    f.appendChild(l); f.appendChild(inputEl);
    // El campo se queda con su <label> a mano: hay rótulos que llevan un NÚMERO VIVO
    // (el largo del rango) y tienen que poder refrescarse sin re-renderizar el panel,
    // que en mitad de una edición le robaría el foco al usuario.
    inputEl._lbl = l;
    return f;
  }
  function _static(txt) { var s = document.createElement('div'); s.textContent = txt; s.style.cssText = 'font-size:11px;color:var(--te-muted);padding:4px 0'; return s; }
  function _input(attrs, onchange) {
    var el = document.createElement('input');
    if (attrs.type) el.type = attrs.type;
    if (attrs.list) el.setAttribute('list', attrs.list);
    if (attrs.placeholder) el.placeholder = attrs.placeholder;
    if (attrs.min != null) el.setAttribute('min', attrs.min);
    if (attrs.step != null) el.setAttribute('step', attrs.step);
    if (attrs.title) el.title = attrs.title;
    el.value = (attrs.value != null ? attrs.value : '');
    el.addEventListener('change', function () { onchange(el.value); });
    return el;
  }

  // ==========================================================================
  // CAPEO UI DEL @ (TANDA 3 · punto 2) — GUANTE, no la defensa de fondo.
  // Un @ de 0.1 cm en un rango de 600 cm son 6001 placements: el navegador se cae
  // ANTES de que el aviso anti-colapso alcance a decir nada. El motor además trunca
  // el @ por su cuenta; esto es lo que ve el usuario: min= en el input (las flechitas
  // no bajan de SEP_MIN) y RECHAZO explícito con borde rojo si igual teclea menos.
  // Rechazar = no se aplica nada (el dato viejo queda intacto). SEP_MIN vive arriba,
  // junto a PASO_ARRASTRE_CM, porque también es el piso de los clamps de tramos.
  // ==========================================================================
  function _inputSep(valor, aplicar) {
    var el = _input({
      value: valor, type: 'number', min: SEP_MIN, step: 'any',
      title: 'Espaciamiento en cm (mínimo ' + SEP_MIN + ' cm)'
    }, function (v) {
      var n = Number(v);
      if (!isFinite(n) || n < SEP_MIN) {
        el.classList.add('bad');
        el.title = '@ mínimo ' + SEP_MIN + ' cm — valor rechazado';
        _actualizarStatus('@ mínimo ' + SEP_MIN + ' cm: valor rechazado.');
        return;
      }
      el.classList.remove('bad');
      el.title = 'Espaciamiento en cm (mínimo ' + SEP_MIN + ' cm)';
      aplicar(n);
    });
    return el;
  }
  function _select(opts, val, onchange) {
    var el = document.createElement('select');
    opts.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; if (o === val) op.selected = true; el.appendChild(op); });
    el.addEventListener('change', function () { onchange(el.value); });
    return el;
  }
  // como _select pero con pares [valor, etiqueta] (valor persistido ≠ texto visible).
  function _selectPairs(pairs, val, onchange) {
    var el = document.createElement('select');
    pairs.forEach(function (p) { var op = document.createElement('option'); op.value = p[0]; op.textContent = p[1]; if (p[0] === val) op.selected = true; el.appendChild(op); });
    el.addEventListener('change', function () { onchange(el.value); });
    return el;
  }
  function _radial(pairs, val, onchange) {
    var r = _div('te-radial');
    pairs.forEach(function (p) {
      var b = document.createElement('button'); b.textContent = p[1]; if (p[0] === val) b.className = 'on';
      b.addEventListener('click', function () { onchange(p[0]); });
      r.appendChild(b);
    });
    return r;
  }
  // RADIAL DE ICONOS — el mismo control que _radial (mismo marco, mismo .on) pero con
  // un DIBUJO en cada botón en vez de una palabra. Lo usa el selector de las 6 caras:
  // ahí el nombre lo dicen la frase de estado y el `title`, así que meter texto en el
  // botón sería decir tres veces lo mismo… y en 360 px seis palabras no entran.
  // `items` = [{ v, svg, title }]. El SVG es una constante del módulo (_iconoCara6),
  // nunca dato del usuario: por eso puede ir por innerHTML sin pasar por _esc.
  function _radialIconos(items, val, onchange, cls) {
    var r = _div('te-radial' + (cls ? ' ' + cls : ''));
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = it.svg;
      if (it.title) { b.title = it.title; b.setAttribute('aria-label', it.title); }
      if (it.v === val) { b.className = 'on'; b.setAttribute('aria-pressed', 'true'); }
      b.addEventListener('click', function () { onchange(it.v); });
      r.appendChild(b);
    });
    return r;
  }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Mutación de un componente → regenerar. redibujaPanel solo si cambia la ficha.
  // (El snapshot de undo NO se toma aquí: los handlers de campo ya mutaron el
  //  componente antes de llamar a _mut, así que un push aquí capturaría el estado
  //  YA cambiado. El undo cubre las acciones estructurales — colocar/borrar/rotar/
  //  duplicar/agregar/rango/mover/nodo/reordenar — donde el snapshot precede a la
  //  mutación.)
  // (20-ago) redibujaFicha ya NO re-arma la grilla entera: re-arma la FICHA —que es lo
  // que cambió de forma— y repinta LA teja de ese componente, porque un cambio de
  // color/tipología/figura/φ/espejo sí se ve en ella. Las otras N tejas y el scroll de
  // la grilla se quedan como estaban.
  function _mut(ci, redibujaFicha) {
    _regenerar();
    if (redibujaFicha) { _renderDetalle(); _refrescarTeja(ci); }
    _actualizarStatus();
  }

  function _setFigura(ci, fig) {
    var c = ST.receta.componentes[ci]; if (!c) return;
    c.figura = fig;
    var spec = _figSpec(fig);
    c.angulos = spec.angulos.slice();
    // reconciliar dims con los parciales de la nueva figura
    var nd = {};
    spec.parciales.forEach(function (L) { nd[L] = (c.dims && c.dims[L]) ? c.dims[L] : { modo: 'auto' }; });
    c.dims = nd;
    // …y el LADO DOMINANTE elegido: si la figura nueva no tiene esa letra, el campo
    // queda apuntando a un lado que no existe. Se borra ACÁ, en el origen del
    // cambio, en vez de dejar el dato roto y taparlo después al leerlo.
    var ld = _ladoDomElegido(c);
    if (ld && spec.parciales.indexOf(ld) < 0) delete c.lado_dominante;
    _regenerar(); _renderPanel();
  }

  // ==========================================================================
  // ESPEJAR LA SELECCIÓN (24-ago, pedido del usuario)
  // --------------------------------------------------------------------------
  // «En muros el lado derecho será igual al izquierdo (o similar), entonces sería
  // muy conveniente poder espejar algunos componentes como los cabezales, estribos
  // y trabas de confinamiento». En su muro real son CUATRO componentes por extremo
  // —dos de cabezales con dos capas cada uno y dos de estribos de confinamiento—
  // que hoy hay que rehacer a mano en el otro testero.
  //
  // DOS TIEMPOS, PORQUE EL EJE NO SE ADIVINA. Una pieza puede espejarse contra tres
  // planos distintos y el editor no tiene forma de saber cuál quiere el usuario:
  // preguntarlo con un desplegable sería más clics y menos claro que señalarlo. Así
  // que el botón ARMA y el usuario CLICA LA CARA de destino en cualquiera de las
  // tres vistas —las mismas cuatro aristas que ya resaltan al colocar una barra—.
  // El eje sale de la arista clicada, explícito, sin inferencias: es la respuesta a
  // «para las barras distribuidas en otros sentidos se puede enredar el comando».
  //
  // LA COPIA ES UNA COPIA Y NADA MÁS (decisión del usuario): misma tipología, mismo
  // sufijo, sin ligadura con la original — «si vemos utilidad en agregar más
  // opciones lo hacemos después». Y si la pieza es simétrica en ese eje, la copia
  // cae encima, sólo dada vuelta: también decisión suya, «ahí obligamos al usuario
  // a ser cuidadoso».
  //
  // EL CÁLCULO NO VIVE ACÁ: lo hace reglas.espejarComponente, que es donde está el
  // modelo de poses y el de anclajes. Acá sólo se elige el eje y se inserta.
  // ==========================================================================
  // LAS CARAS SE PINTAN, NO SE ADIVINAN (25-ago). Primera versión: el botón armaba
  // y había que acertarle a una franja de 9 cm alrededor de una arista, sin nada en
  // pantalla que dijera dónde. El usuario: «no hay ayudas ni nada por el estilo,
  // tampoco sé si el plano de trabajo es el correcto o en cuál me deja seleccionar
  // la cara. Tampoco pude seleccionar la cara». Y tenía razón: 9 cm de un muro de
  // 600 son 9 píxeles, o sea un blanco invisible e imposible de acertar.
  //
  // AHORA: mientras el espejo espera, LAS TRES VISTAS pintan sus cuatro caras como
  // BANDAS anchas, translúcidas y ROTULADAS con su nombre de obra (el mismo que usa
  // el desplazamiento medido: «testero inicio», «cara frontal»…). La banda ES el
  // blanco: se clica ella, no una coordenada. Así queda contestado de una vez dónde
  // hay que clicar, en qué vista, y contra qué se va a espejar.
  //
  // LAS TRES VISTAS A LA VEZ, a propósito: cada una muestra cuatro de las seis
  // caras, y entre las tres están todas. El usuario elige en la que esté mirando en
  // vez de tener que deducir cuál es «la vista correcta».
  function _capaEspejo(svg) {
    if (!svg) return null;
    var g = svg.querySelector('.te-espejo-layer');
    if (!g) { g = _svgEl('g', { 'class': 'te-espejo-layer' }); svg.appendChild(g); }
    else if (g !== svg.lastChild) svg.appendChild(g);
    return g;
  }
  function _limpiarCarasEspejo() {
    Object.keys(SVG_ID).forEach(function (k) {
      var s = $(SVG_ID[k]); if (!s) return;
      var g = s.querySelector('.te-espejo-layer');
      if (g && g.parentNode) g.parentNode.removeChild(g);
    });
  }
  // eje + signo → id de las seis caras, para poder pedirle su nombre de obra.
  function _idCara6De(axis, sign) {
    if (axis === 'y') return (sign > 0) ? 'sup' : 'inf';
    if (axis === 'z') return (sign > 0) ? 'lat+' : 'lat-';
    return (sign > 0) ? 'ext+' : 'ext-';
  }
  function _pintarCarasEspejo() {
    _limpiarCarasEspejo();
    // Sin barra elegida no hay nada que espejar: el modo sigue armado esperándola y
    // las caras aparecen recién cuando hay a quién aplicárselas. Pintarlas antes
    // prometería una acción que el clic no podría cumplir.
    if (!ST.espejoPend || ST.selCi < 0) return;
    Object.keys(SVG_ID).forEach(function (plano) {
      var svg = $(SVG_ID[plano]); if (!svg) return;
      var faces = _facesDeVista(plano);
      if (!faces || !faces.length) return;
      var centro = _uvToPixel(plano, 0, 0);
      if (!centro) return;
      var g = _capaEspejo(svg); if (!g) return;
      faces.forEach(function (f) {
        var p1, p2;
        if (f.orient === 'h') { p1 = _uvToPixel(plano, f.a, f.pos); p2 = _uvToPixel(plano, f.b, f.pos); }
        else { p1 = _uvToPixel(plano, f.pos, f.a); p2 = _uvToPixel(plano, f.pos, f.b); }
        if (!p1 || !p2) return;
        var x0 = Math.min(p1.px, p2.px), x1 = Math.max(p1.px, p2.px);
        var y0 = Math.min(p1.py, p2.py), y1 = Math.max(p1.py, p2.py);
        // EL GRUESO SE MIDE CONTRA LA VISTA. 17 px fijos son cómodos en la elevación
        // de un muro, pero el canto del mismo muro son 20 cm — NUEVE píxeles— y ahí
        // las dos bandas se montaban una sobre otra y tapaban el elemento entero.
        // Se toma un tercio de lo que hay a lo ancho, con techo y piso.
        var perp = (f.orient === 'h') ? Math.abs(_uvToPixel(plano, 0, 0).py - _uvToPixel(plano, 0, f.pos).py) * 2
          : Math.abs(_uvToPixel(plano, 0, 0).px - _uvToPixel(plano, f.pos, 0).px) * 2;
        var GRUESO = Math.max(4, Math.min(17, perp * 0.34));
        // LA BANDA VA HACIA ADENTRO del hormigón —hacia el centro de la vista—: por
        // fuera se pisaría con las cotas y con el borde del cuadrante. El "adentro"
        // se pregunta comparando con el centro y no con el signo del eje, porque hay
        // cámaras que miran al revés y ahí el borde de la derecha no es el máximo.
        var r;
        if (f.orient === 'h') {
          var abajo = (y0 < centro.py);      // la cara está arriba en pantalla
          r = { x: x0, y: abajo ? y0 : (y0 - GRUESO), w: Math.max(4, x1 - x0), h: GRUESO };
        } else {
          var derecha = (x0 < centro.px);    // la cara está a la izquierda
          r = { x: derecha ? x0 : (x0 - GRUESO), y: y0, w: GRUESO, h: Math.max(4, y1 - y0) };
        }
        var nombre = _nombreCara6(_idCara6De(f.axis, f.sign));
        var rect = _svgEl('rect', {
          'class': 'te-esp-band', x: r.x.toFixed(1), y: r.y.toFixed(1),
          width: r.w.toFixed(1), height: r.h.toFixed(1), rx: 3,
          'data-esp-axis': f.axis, 'data-esp-cara': f.cara
        });
        rect.addEventListener('mousedown', function (ev) {
          ev.stopPropagation(); ev.preventDefault();
          _espejarEnCara(f);
        });
        var tt = _svgEl('title', {});
        tt.textContent = 'Espejar contra ' + nombre;
        rect.appendChild(tt);
        g.appendChild(rect);
        // El rótulo va DENTRO de la banda; en las verticales, girado.
        var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        var txt = _svgEl('text', { 'class': 'te-esp-lbl', x: cx.toFixed(1), y: cy.toFixed(1) });
        if (f.orient === 'v') txt.setAttribute('transform', 'rotate(-90 ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')');
        txt.textContent = nombre;
        g.appendChild(txt);
      });
    });
  }

  // EL BOTÓN DICE SI SE PUEDE, ANTES DE APRETARLO. Sin barra seleccionada no hay
  // nada que espejar: apretarlo dejaba un mensaje en la barra de estado y ninguna
  // otra señal, así que se leía como «el botón no funciona». Apagado se ve apagado.
  function _marcarBotonEspejo() {
    var b = $('te_btnEspejar');
    if (!b) return;
    b.classList.toggle('on', !!ST.espejoPend);
    b.classList.toggle('te-off', ST.selCi < 0);
  }
  // EL ORDEN NO IMPORTA (25-ago). La primera versión exigía elegir la barra ANTES de
  // apretar el botón: si no había selección no armaba y se quedaba muda. El usuario
  // hizo lo natural —«presiono el botón, selecciono un componente y no aparecen las
  // ayudas ni nada, así que nada ocurre»— porque una herramienta se aprieta primero y
  // se usa después, como el resto del editor. Ahora el modo se arma siempre y ESPERA
  // lo que falte: sin barra elegida pide la barra, y en cuanto hay una aparecen las
  // bandas solas (el repintado de la vista las trae, ver _redibujar2D).
  function _armarEspejo() {
    ST.espejoPend = true;
    _marcarBotonEspejo();
    _pintarCarasEspejo();
    _actualizarStatus(ST.selCi < 0
      ? 'ESPEJAR — elige la barra que quieres copiar (clic en la barra o en su caluga). Después aparecen las caras. Esc para salir.'
      : 'ESPEJAR — clic en la banda MORADA de la cara contra la que quieres espejar. Están en las tres vistas y cada una dice cuál es. Esc para salir.');
  }
  function _salirEspejo() {
    if (!ST.espejoPend) return;
    ST.espejoPend = false;
    _marcarBotonEspejo();
    _limpiarCarasEspejo();
    _limpiarGhost();
    _actualizarStatus('Espejar cancelado.');
  }
  // Resaltado de la cara bajo el cursor mientras el espejo espera. Reusa el mismo
  // dibujo que el snap de cara del colocador: si el usuario ya aprendió a leer ese
  // resaltado, no tiene que aprender otro.
  function _hoverEspejo(plano, svg, evt) {
    Object.keys(SVG_ID).forEach(function (k) {
      var s = $(SVG_ID[k]); if (!s) return;
      var g = s.querySelector('.te-ghost-layer');
      if (g) { while (g.firstChild) g.removeChild(g.firstChild); }
    });
    var layer = _ghostLayer(svg); if (!layer) return;
    var sp = _svgPoint(svg, evt); if (!sp) return;
    var uv = _pixelToUV(plano, sp.px, sp.py); if (!uv) return;
    var f = _caraMasCercana(plano, uv);
    ST.caraHi = f ? {
      plano: plano, cara: f.cara, edge: f.edge, orient: f.orient,
      axis: f.axis, sign: f.sign, pos: f.pos, a: f.a, b: f.b
    } : null;
    if (f) _dibujarCaraHiEnCapa(layer, plano, f, '#d500f9');
  }
  function _espejarEnCara(f) {
    // UN GESTO, UNA COPIA. La banda trae su propio listener y además está la red del
    // clic suelto sobre la vista: si algún día los dos llegaran, el segundo espejaría
    // la copia recién hecha (que ya es la seleccionada) y aparecerían dos. El modo es
    // la llave del gesto, así que se pregunta por él.
    if (!ST.espejoPend) return;
    // TODAS LAS SELECCIONADAS, no sólo la principal (25-ago): el caso real del
    // usuario son CUATRO componentes por extremo del muro —dos de cabezales y dos de
    // estribos de confinamiento— y espejarlos de a uno era justo el trabajo que esta
    // función vino a sacar. La lista viene de mayor a menor, así que cada copia se
    // inserta detrás de SU original sin correr los índices de las que faltan.
    var todos = _selTodos();
    if (!todos.length) {
      _actualizarStatus('ESPEJAR — elige primero la barra: clic sobre ella o sobre su caluga.');
      return;
    }
    var R = global.ModeladorReglas;
    if (!R || typeof R.espejarComponente !== 'function') { _salirEspejo(); return; }
    var host = _hostDeReceta();
    var hechos = [], fallidos = 0, inexactos = 0;
    todos.forEach(function (ci) {
      var c = ST.receta.componentes[ci];
      if (!c) return;
      var res = R.espejarComponente(c, host, f.axis);
      if (!res || !res.comp) { fallidos++; return; }
      if (!res.posicionExacta) inexactos++;
      hechos.push({ ci: ci, comp: res.comp });
    });
    if (!hechos.length) {
      _actualizarStatus('No se pudo espejar contra esa cara.');
      return;                    // el modo sigue armado: que pruebe otra cara
    }
    _pushUndo();
    hechos.forEach(function (h) { ST.receta.componentes.splice(h.ci + 1, 0, h.comp); });
    // La selección pasa a las COPIAS: es lo que el usuario acaba de crear y lo que va
    // a querer mirar o mover. La principal es la de la primera (la de índice menor).
    var nuevos = hechos.map(function (h) { return h.ci + 1; }).sort(function (a, b) { return a - b; });
    ST.selCi = nuevos[0];
    ST.selExtra = nuevos.slice(1);
    ST.espejoPend = false;
    _marcarBotonEspejo();
    _limpiarCarasEspejo();
    _limpiarGhost();
    _regenerar(); _renderPanel();
    // SE DICE LO QUE NO SE PUDO. Hay ejes donde la posición no es una distancia a
    // una cara sino el sistema de capas: ahí la copia queda donde estaba, sólo dada
    // vuelta, y callarlo dejaría al usuario buscando una barra que nunca se movió.
    var aviso = (hechos.length === 1 ? 'Copia espejada' : (hechos.length + ' copias espejadas')) +
      ' contra ' + (_nombreCara6(_idCara6De(f.axis, f.sign)) || 'la cara') + '.';
    if (fallidos) aviso += ' ' + fallidos + ' no se pudo(ieron) espejar.';
    if (inexactos) aviso += ' OJO: en ' + inexactos + ' la posición en ese eje la manda el reparto o las capas, así que quedó(aron) donde estaba(n) la(s) original(es) — muévela(s) desde la ficha.';
    _actualizarStatus(aviso);
  }

  function _duplicar(ci) {
    var c = ST.receta.componentes[ci]; if (!c) return;
    _pushUndo();
    var copia = JSON.parse(JSON.stringify(c));
    ST.receta.componentes.splice(ci + 1, 0, copia);
    ST.selCi = ci + 1;
    _soltarExtras();
    _regenerar(); _renderPanel();
  }

  // ==========================================================================
  // REORDENAR ARRASTRANDO — EN GRILLA (20-ago)
  // --------------------------------------------------------------------------
  // EN UNA LISTA VERTICAL "soltar sobre la fila N" bastaba: el hueco es uno solo y
  // está donde está la fila. EN UNA GRILLA no: la teja apuntada tiene un hueco a su
  // IZQUIERDA y otro a su DERECHA, y elegir "siempre el índice de la teja" hacía que
  // arrastrar hacia adelante cayera SIEMPRE una posición corta (el elemento que se
  // saca corre los índices de atrás). Así que:
  //   · la MITAD de la teja bajo el cursor decide el lado (antes / después),
  //   · el lado elegido se DIBUJA (caret .te-dz-l/.te-dz-r) para verlo antes de soltar,
  //   · y el índice de destino se corrige por el hueco que deja el propio arrastrado.
  // Soltar en el vacío de la grilla (bajo la última teja) manda al final.
  // El asa sigue siendo el ⠿: arrastrar desde el cuerpo de la teja no se activa,
  // porque ahí el gesto natural es CLIC = seleccionar.
  // ==========================================================================
  function _dzLimpiar(cont) {
    if (!cont) return;
    Array.prototype.forEach.call(cont.querySelectorAll('.te-dz-l,.te-dz-r'), function (el) {
      el.classList.remove('te-dz-l'); el.classList.remove('te-dz-r');
    });
  }

  // Mueve `from` al hueco `hueco` (índice de inserción ANTES de sacar el elemento).
  function _reordenarComp(from, hueco) {
    var arr = ST.receta && ST.receta.componentes; if (!arr) return;
    if (isNaN(from) || from < 0 || from >= arr.length) return;
    var to = hueco;
    if (from < to) to--;   // al sacar el arrastrado, todo lo que iba detrás corre uno
    if (to === from || to < 0) return;
    _pushUndo();
    var m = arr.splice(from, 1)[0]; arr.splice(to, 0, m);
    ST.selCi = to;
    _soltarExtras();   // reordenar corre los índices: los acompañantes ya no valen
    _regenerar(); _renderPanel();
  }

  function _habilitarDrag(wrap, ci, handle) {
    if (!handle) return;
    handle.setAttribute('draggable', 'true');
    handle.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', String(ci));
      e.dataTransfer.effectAllowed = 'move';
    });
    handle.addEventListener('dragend', function () { _dzLimpiar($('te_compList')); });
    // Mitad izquierda = insertar ANTES de esta teja; mitad derecha = DESPUÉS.
    wrap.addEventListener('dragover', function (e) {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      var r = wrap.getBoundingClientRect();
      var antes = (e.clientX - r.left) < (r.width / 2);
      wrap.classList.toggle('te-dz-l', antes);
      wrap.classList.toggle('te-dz-r', !antes);
    });
    wrap.addEventListener('dragleave', function (e) {
      // dragleave TAMBIÉN salta al pasar de la teja a un hijo suyo (el swatch, el
      // texto): sin este filtro el caret parpadearía mientras se cruza la teja.
      if (e.relatedTarget && wrap.contains && wrap.contains(e.relatedTarget)) return;
      wrap.classList.remove('te-dz-l'); wrap.classList.remove('te-dz-r');
    });
    wrap.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation();   // no dejar que la grilla lo mande al final
      var antes = wrap.classList.contains('te-dz-l');
      _dzLimpiar($('te_compList'));
      _reordenarComp(Number(e.dataTransfer.getData('text/plain')), ci + (antes ? 0 : 1));
    });
  }

  // Soltar en el HUECO de la grilla (debajo de la última teja) = mandar al final.
  // Sin esto, ese gesto no hacía nada y parecía que el arrastre se había perdido.
  function _habilitarDropCola(cont) {
    if (!cont || cont._teDropBound) return;
    cont._teDropBound = true;
    cont.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    cont.addEventListener('drop', function (e) {
      e.preventDefault();
      _dzLimpiar(cont);
      var n = (ST.receta && ST.receta.componentes) ? ST.receta.componentes.length : 0;
      _reordenarComp(Number(e.dataTransfer.getData('text/plain')), n);
    });
  }

  // ==========================================================================
  // RIBBON + HERRAMIENTAS
  // ==========================================================================

  // "Cargar" = sellar figura+tipología+φ del ribbon → el ghost sigue el
  // cursor y el clic coloca (§INTERACCIÓN-2.0 tarea 1). Se sella al elegir en el
  // ribbon o al activar una herramienta de colocación.
  function _sellarCargado() {
    // Nada se carga sin figura NI sin φ (parten vacíos, pedido 13-ago) ni con una
    // figura que el catálogo no reconoce: sin esto el ghost seguía al cursor y el
    // clic paría una barra fantasma (kg = 0).
    if (!ST.figura) { ST.cargado = null; _limpiarGhost(); _actualizarStatus('Elige una FIGURA para colocar.'); return; }
    if (!Number(ST.diam)) { ST.cargado = null; _limpiarGhost(); _actualizarStatus('Elige el diámetro φ para colocar.'); return; }
    var err = _figError(ST.figura);
    if (err) { ST.cargado = null; _limpiarGhost(); _actualizarStatus(err); return; }
    ST.cargado = { figura: ST.figura, tipologia: ST.tipologia, diam: Number(ST.diam) };
    _actualizarStatus();
  }

  // Valida el campo Figura del RIBBON. DOS niveles, distintos a propósito:
  //   · ERROR (borde ROJO): la figura no existe en el catálogo o el editor no la
  //     dibuja → NO se aplica y NO se coloca (devuelve false).
  //   · AVISO (borde ÁMBAR): la figura existe pero NO es de la tipología activa
  //     (el agujero de 106A en MH) → sí se aplica y sí se coloca (devuelve true),
  //     pero queda marcada, con el detalle en el tooltip y en la barra de estado.
  // El aviso de la barra de estado no se escribe acá: lo recalcula
  // _actualizarStatus() desde ST.figura/ST.tipologia, así no se borra cuando el
  // llamador refresca el estado ni se queda pegado si el usuario corrige.
  function _validarFiguraRibbon(conStatus) {
    var el = $('te_ribFigura'); if (!el) return true;
    var v = el.value.trim();
    if (!v) { el.classList.remove('bad'); el.classList.remove('warn'); el.title = ''; return false; }
    var err = _figError(v);
    el.classList.toggle('bad', !!err);
    if (err) {
      el.classList.remove('warn');
      el.title = err;
      if (conStatus) _actualizarStatus(err);
      return false;
    }
    var av = _figAvisoTipologia(v, _tipoElemento(), ST.tipologia);
    el.classList.toggle('warn', !!av);
    el.title = av ? av.texto : _figTitle(v);
    return true;
  }

  // LA PUERTA del campo Figura del ribbon: valida lo que hay escrito y, si el
  // catálogo lo acepta, lo deja como figura activa (re-sellando lo cargado si se
  // estaba colocando). Devuelve si la aplicó.
  // Existe como función propia desde que hay DOS gestos que hacen lo mismo —teclear
  // el código y pulsar una casilla de la barra rápida—: el segundo escribe en el
  // campo y llama aquí, en vez de repetir la validación por su cuenta, que es como
  // se terminan teniendo dos reglas que se separan al primer cambio.
  function _aplicarFiguraRibbon(conStatus) {
    var fig = $('te_ribFigura'); if (!fig) return false;
    if (!_validarFiguraRibbon(!!conStatus)) return false;
    ST.figura = _figKey(fig.value);
    if (_hayCargado()) _sellarCargado(); else _actualizarStatus();
    _marcarFigRapida();
    return true;
  }

  // ==========================================================================
  // PRELLENADO DEL RIBBON DESDE LA CONFIGURACIÓN (figura y φ de partida)
  // ==========================================================================
  // El ribbon nacía con Figura VACÍA y φ sin elegir, así que el primer clic no
  // colocaba nada hasta que el usuario llenaba los dos campos a mano — cada vez, para
  // cada tipología. Con la config cableada, elegir una tipología trae SU figura y SU
  // φ (Catálogo › Templates › Configuración › Figuras por tipología).
  //
  // `forzar` distingue los dos gestos:
  //   true  → el usuario ELIGIÓ una tipología: es un cambio de intención, se prellena
  //           aunque hubiera algo escrito (si no, seguiría colocando lo anterior).
  //   false → apertura / cambio de elemento: sólo se rellena lo que está VACÍO, para
  //           no pisar lo que el usuario venía usando.
  // Una tipología sin figura o sin φ configurados NO se inventa: ese campo queda como
  // estaba y el gate de colocación sigue pidiéndolo, igual que hoy.
  function _prellenarRibbonDesdeConfig(forzar) {
    var cfg = global.ModeladorConfig;
    if (!cfg || !cfg.cargada || !cfg.cargada()) return;
    var elem = _tipoElemento(), tip = ST.tipologia;

    var fig = $('te_ribFigura');
    var figCfg = cfg.figuraDefault(elem, tip);
    if (fig && figCfg && (forzar || !String(fig.value || '').trim())) {
      // Sólo si el editor sabe dibujarla: prellenar con una figura que el catálogo
      // vigente no acepta dejaría el campo en rojo apenas se abre.
      if (!_figError(figCfg)) {
        fig.value = figCfg;
        ST.figura = figCfg;
      }
    }

    var dia = $('te_ribDiam');
    var diamCfg = cfg.diamDefault(elem, tip);
    if (dia && diamCfg && (forzar || !String(dia.value || '').trim())) {
      // El <select> arranca en su placeholder vacío; asignarle un φ que no está en
      // TE_DIAMS lo dejaría en blanco, así que se comprueba contra la lista.
      if (TE_DIAMS.indexOf(Number(diamCfg)) >= 0) {
        dia.value = String(diamCfg);
        ST.diam = Number(diamCfg);
      }
    }
    _marcarFigRapida();   // el prellenado también cambia ST.figura
  }

  // Soltar lo cargado (Esc / herramienta que no coloca) → sin ghost, deselecciona.
  function _soltarCargado() {
    ST.cargado = null;
    _limpiarGhost();
    _actualizarStatus();
  }

  function _bindRibbon() {
    _bindFigsRapidas();   // matriz 2×5 de figuras frecuentes (delegado, una sola vez)
    // FIGURA del ribbon — VALIDADA contra el catálogo. 'input' sólo pinta el borde
    // mientras se teclea; 'change' (blur/Enter) APLICA, y si la figura no existe o
    // no es dibujable NO se aplica: ST.figura conserva la última válida y el status
    // dice por qué. Antes era texto libre: cualquier cosa entraba y salía kg = 0.
    var fig = $('te_ribFigura');
    if (fig && !fig._teBound) {
      fig._teBound = true;
      // LA FIGURA SE APLICA MIENTRAS SE ESCRIBE (bug 14-ago·4): solo se aplicaba
      // en 'change' (al salir del campo) — el usuario tipeaba 103C y clickeaba
      // DIRECTO a la vista, y se colocaba la figura ANTERIOR (su estribo). Si lo
      // tipeado es una figura válida del catálogo, ST.figura la toma al instante;
      // lo inválido no pisa nada (el clic ya lo bloquea el gate de figura/φ).
      // prefiltro: vacío = sugeridas de la tipología activa · con texto = todo el catálogo
      fig.addEventListener('focus', function () { _syncFigDatalist(fig); });
      fig.addEventListener('input', function () {
        _syncFigDatalist(fig);
        if (_validarFiguraRibbon(false)) {
          var kf = _figKey(fig.value);
          if (kf && !_figError(kf)) {
            ST.figura = kf;
            if (_hayCargado()) _sellarCargado();
            _marcarFigRapida();   // la barra rápida dice cuál está activa, se teclee o se pulse
          }
        }
      });
      fig.addEventListener('change', function () { _aplicarFiguraRibbon(true); });
      if (_figKey(fig.value)) ST.figura = _figKey(fig.value);
    }
    var dia = $('te_ribDiam');
    if (dia && !dia._teBound) {
      dia._teBound = true;
      // La lista de φ la manda TE_DIAMS (una sola fuente para ribbon y panel).
      // PARTE VACÍO (pedido 13-ago): el usuario elige el φ antes de colocar.
      dia.innerHTML = '';
      var ph = document.createElement('option');
      // El texto del placeholder es sólo '…': la φ ya la pone la etiqueta grande de
      // al lado (20-ago), y repetirla acá dejaba "φ φ…" en pantalla.
      ph.value = ''; ph.textContent = '…'; ph.selected = true;
      dia.appendChild(ph);
      TE_DIAMS.forEach(function (d) {
        var op = document.createElement('option');
        op.value = String(d); op.textContent = String(d);
        dia.appendChild(op);
      });
      dia.addEventListener('change', function () { ST.diam = Number(dia.value) || null; if (_hayCargado()) _sellarCargado(); else _actualizarStatus(); });
      ST.diam = Number(dia.value) || null;
    }
    // (20-ago) Acá se cableaba el check "tomar contorno" (#te_ribContorno). Se
    // eliminó junto con el check: su valor no llegaba a ninguna parte.

    // DELEGACIÓN en el contenedor (no por botón): el ribbon se re-renderiza por
    // elemento (_renderRibbonTips) y los listeners por-botón morirían con el innerHTML.
    var tips = $('te_tipbtns');
    if (tips && !tips._teBound) {
      tips._teBound = true;
      tips.addEventListener('click', function (ev) {
        var b = ev.target;
        while (b && b !== tips && !(b.classList && b.classList.contains('te-tipbtn'))) b = b.parentNode;
        if (!b || b === tips) return;
        tips.querySelectorAll('.te-tipbtn').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        // SELECTOR PURO: elegir tipología NO activa ninguna herramienta (colocar es
        // siempre explícito, con "＋ Agregar barra"). Re-clicar la que ya estaba
        // seleccionada es inocuo. Si el modo colocación está activo, sólo se
        // actualiza lo cargado (el ghost cambia en el acto).
        ST.tipologia = b.getAttribute('data-tip') || 'CBS';
        // FIGURA y φ DE PARTIDA de la tipología recién elegida (config del catálogo).
        // Va ANTES de refrescar el datalist y de re-validar para que esas dos cosas
        // trabajen sobre el valor nuevo y no sobre el que quedó del clic anterior.
        _prellenarRibbonDesdeConfig(true);
        // Cambiar de tipología cambia el juego de figuras admitidas: se reordena
        // el datalist (las de la nueva tipología primero) y se RE-VALIDA la
        // figura YA escrita — la que era correcta en CBS puede ser ajena a ES, y
        // el usuario tiene que verlo en el acto, no cuando la barra sale rara.
        _refrescarFigDatalist();
        _validarFiguraRibbon(false);
        if (_hayCargado()) _sellarCargado(); else _actualizarStatus();
      });
    }
    _bindGeometria();
  }

  // ==========================================================================
  // GRUPO "HORMIGÓN" DEL RIBBON — las dims (cm) que antes vivían en la pantalla
  // previa del tab. Leen/escriben ST.receta.geometria y regeneran.
  // Validación mínima: dims > 0, recubs >= 0, recub_sup+recub_inf < alto y
  // 2·recub_lat < ancho. Si es inválido: borde rojo y NO se aplica.
  //
  // POR ELEMENTO (TANDA 1): la geometría se guarda SIEMPRE con las claves canónicas
  // (largo/alto/ancho/recub_sup/recub_inf/recub_lat) — son las que leen el motor y
  // las vistas — pero cada elemento las MUESTRA con su nombre de obra:
  //   VIGA: Largo · Alto · Ancho
  //   MURO: Largo · Alto · ESPESOR (= geometria.ancho)
  // Un campo con `ks` escribe varias claves; el ajuste fino por barra sigue en
  // "Recub. override" del panel.
  //
  // RECUBRIMIENTO — UN SOLO CAMPO PARA TODOS LOS ELEMENTOS (20-ago). El muro tenía
  // "Recub caras" (recub_lat, donde se anclan las cortinas) y "Recub bordes"
  // (recub_sup + recub_inf) separados, y la distinción resultó poco intuitiva: en
  // obra se habla de UN recubrimiento. El MODELO DE DATOS NO CAMBIA — las tres claves
  // siguen existiendo y el motor las sigue usando por separado —; lo que cambia es
  // que el ribbon escribe las tres con el mismo número.
  // GANCHO PARA RE-EXPONER EL CONTROL POR CARA: `GEO_RECUB_POR_CARA` elige entre el
  // campo único y los campos por cara, que siguen ACÁ y VIVOS. El botón con la
  // isométrica que el usuario tiene pensado no necesita más que llamar a
  // _setRecubPorCara(true) — el render, el bind, la validación y el volcado ya
  // trabajan con listas de campos, no con estos campos en particular.
  // ==========================================================================
  var GEO_RECUB_DEF = 2;   // cm — lo que muestra el campo si la receta no trae recub
  var GEO_RECUB_POR_CARA = false;   // false = un solo campo (hoy) · true = por cara
  // Campo ÚNICO: la misma definición para todo elemento (por eso no está en la tabla
  // por elemento). `k` = clave que se MUESTRA cuando las tres difieren (una receta
  // vieja, o la semilla de viga, que nace 4/4/3).
  // fila 1 = AL LADO DEL ESPESOR (21-ago, pedido del usuario). Estuvo en la fila 2
  // desde que se unificaron los tres recubrimientos en un campo, y esa segunda fila
  // le costaba un renglón de altura a los 4 cuadrantes sin ganar nada: es UN campo.
  // Los campos POR CARA (4 campos) siguen declarando fila:2 — ahí la segunda fila sí
  // se gana el sitio, y el render por filas los soporta sin tocar nada.
  var GEO_RECUB_UNICO = {
    id: 'te_geoRecub', k: 'recub_sup', ks: ['recub_sup', 'recub_inf', 'recub_lat'],
    lbl: 'Recub (cm)', min: 0, def: GEO_RECUB_DEF, fila: 1,
    title: 'Recubrimiento (cm) — se aplica a todas las caras y bordes'
  };
  // Campos POR CARA, por elemento. Hoy no se renderizan (GEO_RECUB_POR_CARA=false),
  // pero son la definición que vuelve a entrar entera cuando se re-exponga.
  var GEO_RECUB_POR_CARA_CAMPOS = {
    viga: [
      { id: 'te_geoRecubSupInf', k: 'recub_sup', ks: ['recub_sup', 'recub_inf'], lbl: 'Recub sup/inf', min: 0, fila: 2,
        title: 'Recubrimiento ARRIBA y ABAJO de la viga (cm)' },
      { id: 'te_geoRecubLat', k: 'recub_lat', lbl: 'Recub lateral', min: 0, fila: 2,
        title: 'Recubrimiento de las CARAS laterales de la viga (cm)' }
    ],
    muro: [
      { id: 'te_geoRecubCaras', k: 'recub_lat', lbl: 'Recub caras', min: 0, fila: 2,
        title: 'Recubrimiento de las CARAS del muro (cm) — donde se anclan las cortinas' },
      { id: 'te_geoRecubBordes', k: 'recub_sup', ks: ['recub_sup', 'recub_inf'], lbl: 'Recub bordes', min: 0, fila: 2,
        title: 'Recubrimiento de los BORDES del muro (cm) — arriba, abajo y extremos' }
    ]
  };
  // DIMS por elemento (sin recubrimientos: esos los pone _geoCampos según el modo).
  var GEO_CAMPOS_POR_ELEMENTO = {
    viga: [
      { id: 'te_geoLargo', k: 'largo', lbl: 'Largo', min: 1, title: 'Largo del elemento (cm)' },
      { id: 'te_geoAlto', k: 'alto', lbl: 'Alto', min: 1, title: 'Alto del elemento (cm)' },
      { id: 'te_geoAncho', k: 'ancho', lbl: 'Ancho', min: 1, title: 'Ancho del elemento (cm)' }
    ],
    muro: [
      { id: 'te_geoLargo', k: 'largo', lbl: 'Largo', min: 1, title: 'Largo del muro (cm)' },
      { id: 'te_geoAlto', k: 'alto', lbl: 'Alto', min: 1, title: 'Alto del muro (cm)' },
      { id: 'te_geoAncho', k: 'ancho', lbl: 'Espesor', min: 1, title: 'Espesor del muro (cm) — geometria.ancho' }
    ]
  };
  function _geoCampos() {
    var el = _tipoElemento();
    var dims = GEO_CAMPOS_POR_ELEMENTO[el] || GEO_CAMPOS_POR_ELEMENTO.viga;
    if (!GEO_RECUB_POR_CARA) return dims.concat([GEO_RECUB_UNICO]);
    return dims.concat(GEO_RECUB_POR_CARA_CAMPOS[el] || GEO_RECUB_POR_CARA_CAMPOS.viga);
  }
  // Cambia entre el recubrimiento único y el control por cara, y repinta el grupo.
  // Existe para el botón futuro (isométrica de recubrimientos): sin él, re-exponer
  // el control obligaría a tocar el render y el bind.
  function _setRecubPorCara(v) {
    GEO_RECUB_POR_CARA = !!v;
    _renderRibbonGeo();
    _sincronizarRibbonGeo();
  }

  // Dibuja los campos del grupo HORMIGÓN según el elemento activo y los cablea.
  // Se re-renderiza al abrir (el elemento puede cambiar entre aperturas), igual que
  // el ribbon de tipologías: por eso el binding va DESPUÉS, sobre los inputs nuevos.
  function _renderRibbonGeo() {
    var cont = $('te_hormRows'); if (!cont) return;
    var campos = _geoCampos();
    var filas = {};
    campos.forEach(function (f) {
      var n = f.fila || 1;
      (filas[n] = filas[n] || []).push(f);
    });
    cont.innerHTML = Object.keys(filas).sort().map(function (n) {
      return '<div class="te-hormrow">' + filas[n].map(function (f) {
        return '<div class="te-geo"><label for="' + f.id + '">' + _esc(f.lbl) + '</label>' +
          '<input type="number" id="' + f.id + '" step="any" min="' + (f.min || 0) + '"' +
          ' title="' + _esc(f.title || f.lbl) + '"></div>';
      }).join('') + '</div>';
    }).join('');
    _bindGeometria();
    _ajustarRibbonUnaLinea();   // cambian los campos → cambia el ancho del ribbon
  }

  // Vuelca ST.receta.geometria a los inputs (al abrir y tras arrastrar un nodo).
  function _sincronizarRibbonGeo() {
    var g = (ST.receta && ST.receta.geometria) || {};
    _geoCampos().forEach(function (f) {
      var el = $(f.id); if (!el) return;
      var v = g[f.k];
      if ((v == null || !isFinite(Number(v))) && f.def != null) v = f.def;
      el.value = (v == null || !isFinite(Number(v))) ? '' : String(Math.round(Number(v) * 100) / 100);
      el.classList.remove('bad');
      // UN CAMPO, VARIAS CLAVES: si las claves que escribe NO valen todas lo mismo
      // (receta hecha cuando el muro tenía caras y bordes por separado, o la semilla
      // de viga, que nace 4/4/3), el input muestra UNA de ellas. No se toca el dato
      // —el motor sigue usando cada clave por su lado— pero el tooltip lo dice: el
      // número de la pantalla no es toda la verdad hasta que se edite el campo.
      el.title = _tituloGeoCampo(f, g);
    });
  }

  // Tooltip del campo: el suyo, más el detalle de las claves cuando difieren.
  function _tituloGeoCampo(f, g) {
    var base = f.title || f.lbl;
    var ks = f.ks || [f.k];
    if (ks.length < 2) return base;
    var vals = ks.map(function (k) { return Number(g[k]); });
    var difieren = vals.some(function (x) { return !(x === vals[0]); });
    if (!difieren) return base;
    return base + ' · HOY DIFIEREN: ' + ks.map(function (k, i) {
      return k + ' = ' + (isFinite(vals[i]) ? vals[i] : '—');
    }).join(', ') + '. Al editar este campo se igualan.';
  }

  // Geometría COMPLETA para validar: una receta vieja puede no traer recubs y sin
  // ellos _geoValida daría NaN → "inválida" siempre. Mismos defaults que _hostDeReceta.
  function _geoConDefaults(g) {
    g = g || {};
    return {
      largo: g.largo, alto: g.alto, ancho: g.ancho,
      recub_sup: (g.recub_sup != null ? g.recub_sup : 4),
      recub_inf: (g.recub_inf != null ? g.recub_inf : 4),
      recub_lat: (g.recub_lat != null ? g.recub_lat : 3)
    };
  }

  // ¿El set de dimensiones propuesto es coherente? (no se aplica si no lo es)
  function _geoValida(g) {
    var largo = Number(g.largo), alto = Number(g.alto), ancho = Number(g.ancho);
    var rs = Number(g.recub_sup), ri = Number(g.recub_inf), rl = Number(g.recub_lat);
    if (!(largo > 0) || !(alto > 0) || !(ancho > 0)) return false;
    if (!(rs >= 0) || !(ri >= 0) || !(rl >= 0)) return false;
    if (rs + ri >= alto) return false;
    if (2 * rl >= ancho) return false;
    return true;
  }

  // Motivo legible de por qué _geoValida dijo que no (mismo orden de chequeos). Lo
  // usa el arrastre de nodo para decir QUÉ se rechazó al revertir.
  function _motivoGeoInvalida(g) {
    var largo = Number(g.largo), alto = Number(g.alto), ancho = Number(g.ancho);
    var rs = Number(g.recub_sup), ri = Number(g.recub_inf), rl = Number(g.recub_lat);
    if (!(largo > 0) || !(alto > 0) || !(ancho > 0)) return 'dimensión ≤ 0';
    if (!(rs >= 0) || !(ri >= 0) || !(rl >= 0)) return 'recubrimiento negativo';
    if (rs + ri >= alto) return 'alto ≤ recub sup + recub inf';
    if (2 * rl >= ancho) return 'ancho ≤ 2·recub lateral';
    return 'geometría inválida';
  }

  function _bindGeometria() {
    _geoCampos().forEach(function (f) {
      var el = $(f.id); if (!el || el._teBound) return;
      el._teBound = true;
      // 'change' (blur/Enter) APLICA; 'input' sólo pinta el borde rojo mientras se
      // teclea (aplicar por tecla regeneraría con valores a medio escribir y
      // ensuciaría el undo con un snapshot por dígito).
      el.addEventListener('change', function () { _aplicarGeoDesdeRibbon(f, el); });
      el.addEventListener('input', function () { _validarGeoCampo(f, el); });
      el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') el.blur(); });
    });
  }

  // Devuelve el valor del campo si es válido en el conjunto; si no, null (y marca).
  function _validarGeoCampo(f, el) {
    if (!ST.receta || !ST.receta.geometria) return null;
    var g = ST.receta.geometria;
    var v = parseFloat(el.value);
    // candidato = geometría actual con este campo cambiado
    var cand = _geoConDefaults(g);
    (f.ks || [f.k]).forEach(function (k) { cand[k] = v; });
    if (!isFinite(v) || v < f.min || !_geoValida(cand)) { el.classList.add('bad'); return null; }
    el.classList.remove('bad');
    return v;
  }

  function _aplicarGeoDesdeRibbon(f, el) {
    var v = _validarGeoCampo(f, el);
    if (v == null) return;
    var g = ST.receta.geometria;
    var ks = f.ks || [f.k];
    var cambia = ks.some(function (k) { return Number(g[k]) !== v; });
    if (!cambia) return;
    _pushUndo();
    ks.forEach(function (k) { g[k] = v; });
    el.title = _tituloGeoCampo(f, g);   // las claves ya coinciden → fuera el aviso
    // Mismo refresco que el arrastre de nodos: regenerar re-encuadra las cámaras
    // ortográficas (leen la geometría en cada frame) y redibuja los 4 cuadrantes.
    _regenerarDiferido();
    _actualizarStatus();
  }

  // Activa una herramienta (marca el botón + setea ST.tool + carga/suelta el ghost).
  // Reutilizable desde el listener de botones y desde otros flujos (elegir tipología).
  function _activarHerramienta(tool) {
    var ct = $('te_ctools'); if (!ct) return;
    ct.querySelectorAll('.te-ctool[data-tool]').forEach(function (x) {
      x.classList.toggle('on', x.getAttribute('data-tool') === tool);
    });
    ST.tool = tool;
    // Al cambiar de herramienta se apaga el snap de cara (evita resaltados fantasma
    // con Seleccionar/Rotar); el ghost se redibuja en el próximo hover.
    var caraPlano = ST.caraHi && ST.caraHi.plano;
    ST.caraHi = null;
    // Modo colocación → carga el ghost; las demás herramientas lo sueltan.
    if (tool === 'colocar') _sellarCargado();
    else _soltarCargado();
    var btnAdd = $('te_btnAgregarBarra');
    if (btnAdd) btnAdd.classList.toggle('on', tool === 'colocar');
    // BLOQUE DE COLOCACIÓN (figura + φ + tipologías) — SÓLO en modo colocación
    // (20-ago). Va acá y no en el botón porque _activarHerramienta es el ÚNICO paso
    // por el que se entra y se sale del modo (botón, Esc, clic derecho, apertura del
    // editor y las herramientas de la fila): cablearlo en cada puerta habría dejado
    // alguna sin el bloque. Los campos siguen existiendo en el DOM mientras está
    // oculto —_renderRibbonTips y _prellenarRibbonDesdeConfig escriben en ellos
    // igual—, sólo no se ven.
    // DOS bloques desde el 20-ago: la barra rápida de figuras se metió ENTRE el φ y
    // las tipologías (para que no se corra de sitio al cambiar de elemento), y eso
    // partió en dos lo que era un solo contenedor. Los dos se encienden juntos.
    var bloque = $('te_colocBloque');
    if (bloque) bloque.classList.toggle('on', tool === 'colocar');
    var bloqueTip = $('te_colocTip');
    if (bloqueTip) bloqueTip.classList.toggle('on', tool === 'colocar');
    // El bloque entra y sale de la MISMA línea del ribbon: con él abierto el ancho
    // pedido crece de golpe, así que hay que re-medir (puede tocar compactar) y al
    // cerrarlo hay que devolver las etiquetas.
    _ajustarRibbonUnaLinea();
    if (caraPlano) _redibujar2D(ST.ultimoOut);   // limpia la cara resaltada
    _setQuadCursor();
    _actualizarStatus();
  }

  // MODO COLOCACIÓN — lo activan "＋ Agregar barra" (ribbon) y "＋ Agregar componente"
  // (panel izq): el ghost sigue al cursor y el clic coloca. Se sale con Esc o con
  // clic derecho sobre una vista. Sustituye a la vieja herramienta "Colocar" y al
  // antiguo _agregarComponenteManual() (que agregaba al tiro, sin pasar por pantalla).
  function _entrarModoColocacion() {
    _activarHerramienta('colocar');   // abre el bloque figura/φ/tipología y sella
    // Sin sello (figura vacía/inválida o φ vacío) hay que RE-sellar: el
    // _actualizarStatus() con que termina _activarHerramienta se comió el motivo, y
    // desde que el bloque sólo aparece acá ese motivo es la única pista de que falta
    // llenar algo — el bloque recién abierto está a la vista para hacerlo.
    if (!ST.cargado) { _sellarCargado(); return; }
    ST.espejoColoc = false;   // el previsualizador parte en Normal
    _actualizarStatus('Colocando ' + ST.tipologia + ' ' + ST.figura +
      ': clic en una vista · ESPACIO alterna Normal/Espejo · Esc o clic derecho para salir.');
  }

  function _salirModoColocacion() {
    _activarHerramienta('mover');
  }

  function _bindHerramientas() {
    var ct = $('te_ctools');
    if (ct && !ct._teBound) {
      ct._teBound = true;
      ct.querySelectorAll('.te-ctool[data-tool]').forEach(function (b) {
        b.addEventListener('click', function () { _activarHerramienta(b.getAttribute('data-tool')); });
      });
      ct.querySelectorAll('.te-ctool[data-toggle]').forEach(function (b) {
        b.addEventListener('click', function () {
          var t = b.getAttribute('data-toggle');
          // COTAS: el clic NO escribe el estado, PIDE el cambio. Quien manda es
          // _setCotas —la misma puerta que usa el atajo SHIFT—, que deja el botón y
          // ST.cotas siempre diciendo lo mismo. Si acá se hiciera el toggle de la
          // clase por fuera, prender con la tecla y después clicar apagaría… y
          // volvería a prender, porque el botón venía pintado al revés.
          if (t === 'cotas') { _setCotas(!ST.cotas); return; }
          b.classList.toggle('on');
          if (t === 'snap') ST.snap = b.classList.contains('on');
        });
      });
    }
    // OJO: los binds de abajo van FUERA del guard de #te_ctools y con guard PROPIO —
    // si un día #te_ctools ya viniera marcado, el botón Borrar se quedaba sin listener.
    var del = $('te_btnBorrar');
    if (del && !del._teBound) { del._teBound = true; del.addEventListener('click', function () { _borrarSeleccion(); }); }
    // ESPEJAR: el mismo botón arma y desarma (apretarlo dos veces sale, igual que
    // Esc). Va con el mismo guard propio que Borrar, por la misma razón.
    var esp = $('te_btnEspejar');
    if (esp && !esp._teBound) {
      esp._teBound = true;
      esp.addEventListener('click', function () {
        if (ST.espejoPend) _salirEspejo(); else _armarEspejo();
      });
    }

    // El botón "⟳ Rotar" del ribbon SE ELIMINÓ (decisión del usuario): duplicaba el
    // "+90°" de la fila "Rotación °" del panel del componente. La acción sigue viva
    // en el panel y con la BARRA ESPACIADORA (_rotarSeleccion), que no se tocó.

    // Los DOS botones "agregar" hacen lo mismo: entrar en modo colocación.
    // PLEGAR LA TIRA DE COMPONENTES (21-ago). La tira come el ancho de una teja a los
    // cuadrantes; plegada deja una pestaña de 18 px y los devuelve enteros. El 3D vive
    // de su tamaño en píxeles, así que hay que avisarle: sin el resize se queda con el
    // viewport viejo y la escena aparece estirada hasta el siguiente gesto.
    var plg = $('te_gridPlegar');
    if (plg && !plg._teBound) {
      plg._teBound = true;
      plg.addEventListener('click', function () {
        var g = $('te_grid'); if (!g) return;
        var plegado = g.classList.toggle('plegado');
        plg.textContent = plegado ? '‹' : '›';
        plg.title = plegado ? 'Mostrar la tira de componentes' : 'Plegar la tira de componentes';
        _resize();   // el 3D y las ortográficas viven de su tamaño en píxeles
      });
    }
    var addRib = $('te_btnAgregarBarra');
    if (addRib && !addRib._teBound) { addRib._teBound = true; addRib.addEventListener('click', function () { _entrarModoColocacion(); }); }
    // (el botón "＋ Agregar componente" del panel se retiró el 19-ago: era el mismo
    // handler que el del ribbon, y dos puertas para la misma acción confundían.)

    // Botón contextual "Girar 90° en esta vista (R)" sobre la pieza seleccionada.
    // MISMA acción que la tecla R (una sola semántica de giro grueso).
    var flip = $('te_flipBtn');
    if (flip && !flip._teBound) {
      flip._teBound = true;
      flip.addEventListener('click', function (e) { e.stopPropagation(); _rotarPoseSeleccion(_vistaActiva()); });
      // evitar que el mousedown burbujee a las vistas (no deseleccionar al clicarlo)
      flip.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    }
  }

  function _setQuadCursor() {
    var q = $('te_quad'); if (!q) return;
    q.classList.remove('tool-colocar', 'tool-mover', 'tool-rotar');
    q.classList.add('tool-' + ST.tool);
  }

  function _actualizarStatus(msg) {
    var s = $('te_ctoolsStatus'); if (!s) return;
    var selTxt = '', avisoTxt = '';
    if (ST.selCi >= 0 && ST.receta && ST.receta.componentes[ST.selCi]) {
      var c = ST.receta.componentes[ST.selCi];
      var ang = (c.orient && c.orient.deg) ? (' · ' + c.orient.deg + '°') : '';
      // El gate de SHIFT no tiene botón: si no se dice, no existe. Se anuncia SÓLO
      // con algo seleccionado, que es cuando hace algo.
      selTxt = ' · sel: <b>' + _esc(c.tipologia + ' ' + c.figura) + ang + '</b>' +
        ' · <span style="color:var(--te-ov-hint)">SHIFT = medidas de sus lados</span>';
      // AVISOS DEL MOTOR (comp._avisos): lo que NO se generó y por qué — hoy, capas
      // anidadas que no caben (dims ≤ 0 con ese Sep). Se muestran en ROJO junto a
      // la selección: antes esas capas salían con dims aplastadas a 0 (payload que
      // el backend rechaza) y con el bbox fuera del hormigón, en SILENCIO.
      var av = c._avisos;
      if (av && av.length) {
        avisoTxt = ' · <b style="color:var(--te-err)">⚠ ' + _esc(av.join(' · ')) + '</b>';
      }
    }
    // UN MENSAJE DE PASO NO TAPA UN AVISO DEL MOTOR (21-ago). El mensaje del gesto
    // (el del tirador, el de una herramienta) reemplazaba la línea ENTERA, avisos
    // incluidos: arrastrando el marco hasta dejar un lado en −17 cm, el motor lo
    // decía —«El lado A queda en −17 cm: esa barra no es construible»— y la pantalla
    // mostraba sólo la medida del arrastre hasta soltar. El aviso rojo va SIEMPRE
    // detrás del mensaje; es el aviso que ya emite el motor, no uno nuevo.
    if (msg) {
      s.innerHTML = '<b style="color:var(--te-acero-t)">' + _esc(msg) + '</b>' + avisoTxt;
      return;
    }
    // AVISO FIGURA vs TIPOLOGÍA — se RECALCULA acá (no se guarda en ST) para que
    // aparezca y desaparezca solo: basta corregir la figura o la tipología para
    // que la línea vuelva a estar limpia. Ámbar = aviso (se puede colocar), a
    // diferencia del rojo de los avisos del motor, que son cosas que NO salieron.
    var avTip = _figAvisoTipologia(ST.figura, _tipoElemento(), ST.tipologia);
    var tipTxt = avTip ? (' · <b style="color:var(--te-warn)">⚠ ' + _esc(avTip.corto) + '</b>') : '';
    s.innerHTML = 'Herramienta: <b>' + _esc(ST.tool) + '</b> · figura <b>' + _esc(ST.figura) + '</b> · ' +
      '<b style="color:' + _colDe(ST.tipologia) + '">' + _esc(ST.tipologia) + '</b> ø' + _esc(ST.diam) +
      tipTxt + selTxt + avisoTxt;
  }

  // EL INTERRUPTOR DE LAS COTAS — ÚNICA PUERTA (botón «Cotas» y tecla SHIFT).
  // Prende/apaga LAS DOS CAPAS a la vez (cotas del hormigón + medidas por lado de la
  // barra seleccionada) y REPINTA el overlay una sola vez por transición.
  // El BOTÓN se sincroniza acá dentro, no en el llamador: da igual que lo prenda el
  // ratón o el atajo, el ribbon tiene que decir el estado de verdad. Y se toca ANTES
  // del corto-circuito de "ya estaba así", porque el botón puede haber quedado
  // desfasado (clic que se comió otro handler) y esta es la que lo devuelve a su sitio.
  // Sin selección NO se bloquea (ya no): las cotas del hormigón se ven igual, es la
  // capa de la barra la que se dibuja sola cuando hay algo seleccionado.
  function _btnCotas() {
    var ct = $('te_ctools');
    return ct ? ct.querySelector('.te-ctool[data-toggle="cotas"]') : null;
  }
  function _setCotas(v) {
    v = !!v;
    if (v) {
      var bd = $('te_backdrop');
      if (!bd || !bd.classList.contains('on')) return;   // editor cerrado
    }
    var b = _btnCotas();
    if (b) { if (v) b.classList.add('on'); else b.classList.remove('on'); }
    if (ST.cotas === v) return;
    ST.cotas = v;
    if (ST.ultimoOut) _redibujar2D(ST.ultimoOut);
  }

  // Teclado: Ctrl+Z deshace · ESPACIO rota el ángulo fino 90° · R gira la pieza 90°
  // EN LA VISTA ACTIVA (rotar-en-vista, TANDA P) · Supr/Backspace borra ·
  // SHIFT prende y apaga las cotas (las dos capas) — es un INTERRUPTOR, no un gate.
  function _bindTeclado() {
    if (ST._tecladoOk) return; ST._tecladoOk = true;
    // El keyup y el blur que APAGABAN las cotas se fueron con el gate (20-ago): con
    // un interruptor, soltar la tecla no significa nada y apagar al perder el foco
    // borraría lo que el usuario dejó encendido a propósito.
    document.addEventListener('keydown', function (e) {
      var bd = $('te_backdrop');
      if (!bd || !bd.classList.contains('on')) return;
      // no capturar mientras se escribe en un input/select (deja el undo nativo del
      // campo de texto y el tipeo normal)
      var tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      // SHIFT → prende/apaga las cotas (el MISMO estado del botón «Cotas»). Va ANTES
      // que todo lo demás y con `return`: shift solo no es atajo de nada más, y el
      // Shift+Ctrl+Z de más abajo se filtra por su propia condición (!e.shiftKey).
      // `e.repeat` es OBLIGATORIO acá: mantener la tecla auto-repite el keydown
      // decenas de veces por segundo, y un interruptor que se dispara con cada
      // repetición parpadearía en vez de conmutar.
      if (e.key === 'Shift') { if (!e.repeat) _setCotas(!ST.cotas); return; }
      // Ctrl/Cmd+Z → deshacer (tarea 4). Shift+Ctrl+Z NO se usa (sin redo).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault(); _undo(); return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        // EN COLOCACIÓN (pedido 13-ago): ESPACIO alterna Normal/Espejo del
        // previsualizador — la barra se inserta con esa mano (el ghost pasa por
        // _compDesdeClick, así que el reflejo SE VE antes de clicar). Con una
        // pieza seleccionada, espacio sigue rotando como siempre.
        if (ST.tool === 'colocar' && ST.cargado) {
          e.preventDefault();
          ST.espejoColoc = !ST.espejoColoc;
          _actualizarStatus('Colocando ' + ST.tipologia + ' ' + ST.figura +
            (ST.espejoColoc ? ' · ESPEJO' : ' · Normal') + ' — ESPACIO alterna, clic coloca.');
          // redibujar el ghost EN SU SITIO (sin esperar el próximo mousemove)
          var gu = ST._ghostUlt;
          if (gu && gu.plano && gu.svg && gu.sp) _dibujarGhost(gu.plano, gu.svg, gu.sp);
        } else if (ST.selCi >= 0) {
          // Con pieza seleccionada, ESPACIO gira EN EL PLANO DE LA PROPIA PIEZA
          // (17-ago): el eje de giro es la normal del plano de la pieza medida
          // por el motor, no la profundidad de la vista activa — con otra vista
          // activa, ESPACIO sacaba al estribo de su plano. R queda POR VISTA.
          e.preventDefault(); _rotarEnPlanoPropio();
        }
      } else if (e.key === 'r' || e.key === 'R') {
        // R → GIRAR 90° EN LA VISTA ACTIVA (TANDA P · rotar-en-vista): la pieza gira
        // alrededor del eje que sale de la pantalla en la vista donde se está
        // trabajando. Ignorar combos con modificadores (Ctrl+R recargar, etc.).
        if (!e.ctrlKey && !e.metaKey && !e.altKey && ST.selCi >= 0) {
          e.preventDefault(); _rotarPoseSeleccion(_vistaActiva());
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ST.selCi >= 0) { e.preventDefault(); _borrarSeleccion(); }
      }
    });
  }

  // ==========================================================================
  // VISTAS ORTOGRÁFICAS 2D (Opción A) — cada cuadrante "2D" es la MISMA escena 3D
  // vista con una cámara ORTOGRÁFICA fija (frente/lado/arriba). No se redibuja la
  // barra en SVG: es el 3D proyectado → misma calidad y codos que el 3D, y escala
  // igual (un solo renderer, 4 viewports con scissor). El SVG queda ENCIMA solo
  // para la interacción (ghost/handles/cotas) en etapas siguientes.
  //
  // La dirección de cada cámara sale de la MISMA tabla PLANOS_POR_ELEMENTO (eje de
  // profundidad `depth`): la cámara mira A LO LARGO de ese eje, con `up` = eje v.
  // ==========================================================================
  // ORIENTACIÓN COHERENTE DE LAS 3 VISTAS (bug 12-ago: "en PLANTA la línea de
  // distribución y el componente salen intercambiados respecto de A LO LARGO").
  // Causa: las cámaras de SECCIÓN y PLANTA quedaban con su = −1 (el eje u del plano
  // crecía hacia la IZQUIERDA), así que el MISMO eje interno x se veía a la derecha
  // en 'largo' y a la izquierda en 'planta' → las dos vistas eran espejo una de otra.
  // Regla nueva (exigida por el usuario y ya dibujada por el gizmo): en las TRES
  // vistas el eje u crece a la DERECHA y el v hacia ARRIBA → su=+1 y sv=+1.
  //
  // Con camX = up × eye (base derecha de la cámara), para que camX = +u hay que
  // mirar desde el lado que hace (u, v, hacia-el-observador) una terna DERECHA:
  //   sección (u=z, v=y): z × y = −x  → eye = −X (antes +X: mirror horizontal)
  //   planta  (u=x, v=z): x × z = −y  → eye = −Y (antes +Y: mirror horizontal)
  //   largo   (u=x, v=y): x × y = +z  → eye = +Z (ya estaba bien; no cambia)
  // Sólo se ESPEJA la horizontal: la vertical de cada vista se mantiene como estaba
  // (sv seguía siendo +1 en las tres). La banda de corte es simétrica y la luz sale
  // del propio eye, así que ambas siguen a la cámara sin tocar nada más.
  var _ORTO_DIR = {   // depth → posición de cámara (unitaria) y up, en ejes de mundo
    x: { eye: [-1, 0, 0], up: [0, 1, 0] },  // sección: mira hacia +X (ve el plano ZY, z→derecha)
    y: { eye: [0, -1, 0], up: [0, 0, 1] },  // planta:  mira hacia +Y (ve el plano XZ, x→derecha)
    z: { eye: [0, 0, 1], up: [0, 1, 0] }    // largo:   mira hacia −Z (ve el plano XY, x→derecha)
  };

  // Las cámaras orto se crean UNA vez (_initVistasOrto) pero el `def` de cada plano
  // depende del ELEMENTO (PLANOS_POR_ELEMENTO). Al abrir un template de otro tipo
  // hay que refrescarlo o el encuadre/overlay seguiría usando el del anterior.
  function _refrescarDefsOrto() {
    if (!ST.orto) return;
    var defs = _defsPlanos() || {};
    Object.keys(ST.orto).forEach(function (p) {
      if (ST.orto[p] && defs[p]) ST.orto[p].def = defs[p];
    });
  }

  function _initVistasOrto() {
    var THREE = global.THREE;
    if (!THREE) return;
    ST.orto = {};   // por plano: { cam, canvas, vista, zoom, panU, panV }
    var defs = _defsPlanos() || {};
    ['seccion', 'largo', 'planta'].forEach(function (plano) {
      var def = defs[plano]; if (!def) return;
      var vista = document.querySelector('#te_quad .te-vista[data-plano="' + plano + '"]');
      var canvas = vista ? vista.querySelector('.te-vcanvas') : null;
      if (!vista || !canvas) return;
      var cam = new THREE.OrthographicCamera(-100, 100, 100, -100, -6000, 6000);
      // `plano` = clave SEMÁNTICA de la vista ('seccion'/'largo'/'planta'). Viaja en el
      // estado porque el CUCHILLO se decide por semántica, no por eje (fix 14-ago): la
      // sección de la viga corta en x y la del muro en y — cablear el eje rompía al muro.
      ST.orto[plano] = { cam: cam, canvas: canvas, vista: vista, def: def, plano: plano, zoom: 1, panU: 0, panV: 0, corte: 0.5 };
      _bindVistaOrto(plano);
    });
    // botones de reset (pan/zoom/corte)
    Array.prototype.forEach.call(document.querySelectorAll('#te_quad .te-vreset'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var p = b.getAttribute('data-plano'), o = ST.orto && ST.orto[p];
        if (o) { o.zoom = 1; o.panU = 0; o.panV = 0; o.corte = 0.5; }
        var r = document.querySelector('.te-vcut-r[data-plano="' + p + '"]'); if (r) r.value = 50;
        _marcarSucio();               // PERF: reset de vista → repintar
        _sincronizarOverlayOrto();    // zoom/pan a cero → transforms del overlay nuevos
      });
    });
    // HERRAMIENTAS DEL 3D (17-ago) — ver la nota del HTML.
    var b3r = $('te_3dReset');
    if (b3r && !b3r._teBound) {
      b3r._teBound = true;
      b3r.addEventListener('click', function (e) {
        e.stopPropagation();
        // mismos valores con que nace la cámara (CAM0) + el encuadre del elemento
        // actual: es "volver al punto de partida", no un encuadre nuevo. Es TAMBIÉN
        // la salida cuando el pan y la rueda dejaron el centro del elemento fuera de
        // cuadro: devuelve el pan a cero y el pivote del giro normal a la vista.
        // (a null: _quatCam la rearma en CAM0 al primer uso, así el botón también
        // funciona si THREE todavía no terminó de cargar.)
        ST.quat = null; ST.panX = 0; ST.panY = 0;
        if (ST.target && ST.target.set) ST.target.set(0, 0, 0);
        var gg = ST.receta && ST.receta.geometria;
        if (gg && isFinite(Number(gg.largo))) ST.dist = _distEncuadre(gg.largo);
        _marcarSucio();
        _actualizarStatus('3D recentrado.');
      });
    }
    var b3h = $('te_3dHormigon');
    if (b3h && !b3h._teBound) {
      b3h._teBound = true;
      b3h.addEventListener('click', function (e) {
        e.stopPropagation();
        ST.verHormigon = !ST.verHormigon;
        b3h.classList.toggle('off', !ST.verHormigon);
        // el sólido del hormigón se arma en _redibujar: basta rearmar el world
        // (no hace falta re-expandir la receta, que es lo caro).
        if (ST.ultimoOut) _redibujar(ST.ultimoOut);
        _marcarSucio();
        _actualizarStatus(ST.verHormigon ? 'Hormigón visible.' : 'Hormigón oculto (solo las barras).');
      });
    }
    // EJE DE ROTACIÓN (X/Y/Z) — radial portado del Enfierrador. Allá había un cuarto
    // botón "Libre"; acá SOBRA (18-ago) porque clicar el que ya está activo lo apaga:
    // NINGUNO encendido ES el estado libre, y es como arranca el editor.
    // 'libre' sigue siendo el valor interno de ST.ejeRot (lo lee _bindOrbita), sólo
    // que ya no tiene botón: al des-seleccionar, ningún data-eje coincide y el radial
    // queda entero apagado.
    var ejes = $('te_3dEjes');
    if (ejes && !ejes._teBound) {
      ejes._teBound = true;
      ejes.querySelectorAll('button').forEach(function (bt) {
        bt.addEventListener('click', function (e) {
          e.stopPropagation();
          var eje = bt.getAttribute('data-eje');
          if (eje === ST.ejeRot) eje = 'libre';               // toggle: el activo suelta
          ST.ejeRot = eje;
          ejes.querySelectorAll('button').forEach(function (x) {
            x.classList.toggle('on', x.getAttribute('data-eje') === eje);
          });
          _actualizarStatus(eje === 'libre' ? 'Rotación libre.' : ('Rotación restringida al eje ' + eje.toUpperCase() + '.'));
        });
      });
    }
    // TEMA (fondo + grilla) de LOS 4 CUADRANTES. NO toca los materiales: el color de
    // cada barra es dato del usuario (tipología o color propio del componente).
    // La marca en el DOM se repone en cada apertura del modal: #te_quad puede venir
    // sin clase (primera vez) y el tema vive en memoria entre aperturas.
    _marcarTemaEnQuad();
    var tema = $('te_3dTema');
    if (tema && !tema._teBound) {
      tema._teBound = true;
      tema.querySelectorAll('button').forEach(function (bt) {
        bt.addEventListener('click', function (e) {
          e.stopPropagation();
          var t = bt.getAttribute('data-tema');
          _aplicarTema3D(t);
          tema.querySelectorAll('button').forEach(function (x) {
            x.classList.toggle('on', x.getAttribute('data-tema') === t);
          });
        });
      });
    }
    // sliders de PLANO DE CORTE → o.corte (0..1). Mover el slider ACTIVA esa vista
    // (highlight del cuadrante + plano en el 3D a esa profundidad).
    Array.prototype.forEach.call(document.querySelectorAll('#te_quad .te-vcut-r'), function (r) {
      var p = r.getAttribute('data-plano');
      r.addEventListener('input', function (e) {
        e.stopPropagation();
        var o = ST.orto && ST.orto[p]; if (!o) return;
        o.corte = Math.max(0, Math.min(1, Number(r.value) / 100));
        if (ST.planoActivo !== p) _setPlanoActivo(p);   // activar la vista al ajustar
        else _redibujarPlanoActivo();                    // mover el plano 3D con el corte
        _marcarSucio();   // PERF: el corte cambió → repintar (B1: arrastre continuo)
      });
      r.addEventListener('mousedown', function (e) { e.stopPropagation(); });   // no dispara pan
    });
    // Check IMÁN / LIBRE del corte — hay UNO POR VISTA (sección, largo y planta) pero
    // el estado es UNO SOLO y global (ST.corteIman, sólo en memoria): tocar cualquiera
    // de los 3 los mueve a los 3. Antes vivía sólo en la sección y había que volver a
    // ese cuadrante para cambiar el modo.
    var imanes = Array.prototype.slice.call(document.querySelectorAll('#te_quad .te-vcut-iman input'));
    imanes.forEach(function (iman) {
      iman.checked = ST.corteIman !== false;
      ['click', 'mousedown'].forEach(function (ev) {
        iman.addEventListener(ev, function (e) { e.stopPropagation(); });   // no dispara pan/selección
      });
      iman.addEventListener('change', function (e) {
        e.stopPropagation();
        ST.corteIman = iman.checked;
        imanes.forEach(function (o) { o.checked = ST.corteIman; });   // los 3 sincronizados
        _marcarSucio();               // el encuadre del corte cambia → repintar
        _redibujarPlanoActivo();      // y mover el plano 3D a la nueva posición
      });
    });
  }

  // Encuadra la cámara ortográfica del plano al bounding del elemento + un margen,
  // aplicando zoom/pan de esa vista. spanU/spanV en cm (mundo).
  // Espesor del elemento (cm) en el eje de PROFUNDIDAD de una vista (x→ancho·largo,
  // según el mapeo). Es el rango de coordenadas que la cámara "atraviesa".
  function _espesorProfundidad(depthEje) {
    var g = ST.receta ? ST.receta.geometria : {};
    if (depthEje === 'x') return Number(g.largo) || 600;
    if (depthEje === 'y') return Number(g.alto) || 60;
    return Number(g.ancho) || 30;   // z
  }

  // ==========================================================================
  // CUCHILLO / SLICES (rediseño CORTE) — posiciones candidatas del corte a lo
  // largo del eje de PROFUNDIDAD de una vista.
  //
  // El "cuchillo" del usuario = lo que un corte real dejaría ver EN ESE plano:
  // en SECCIÓN (depth=x) UN estribo, no los ~30 superpuestos. Para eso hay que
  // saber DÓNDE están las barras que el plano cruza de canto (las "rebanadas").
  //
  // Una barra es una REBANADA para este eje si su extensión A LO LARGO del eje
  // de profundidad es PEQUEÑA (vive casi en un solo valor de `depthEje`): un
  // estribo/traba corre en YZ → su extensión en X es ~0 → es una rebanada para
  // la SECCIÓN. Un longitudinal corre en X → extensión en X grande → NO es
  // rebanada (lo cruza el cuchillo esté donde esté; se ve como punto estable).
  //
  // Devuelve { pos:[...], diam } — `pos` = centros (cm) de las rebanadas ordenados,
  // `diam` = φ (cm) representativo para el grosor de la banda fina. Sin rebarbas:
  // si no hay placements o ninguno es rebanada, pos=[] (el llamador usa banda
  // gruesa → nunca vacía).
  function _slicesEnProfundidad(depthEje) {
    var out = { pos: [], diam: 1.6 };
    var pls = (ST.ultimoOut && ST.ultimoOut.placements) || [];
    if (!pls.length) return out;
    var espesor = _espesorProfundidad(depthEje);
    // umbral de "extensión pequeña": una barra cuenta como rebanada si su span en
    // el eje de profundidad es < 15% del espesor del elemento (y en absoluto < 40cm).
    // Así un estribo (span x ~0) entra y un longitudinal (span x ~= largo) no.
    var umbral = Math.min(Math.max(espesor * 0.15, 8), 40);
    var centros = [], diamMax = 0;
    pls.forEach(function (pl) {
      var pts = pl.puntos || [];
      if (pts.length < 2) return;
      var lo = Infinity, hi = -Infinity;
      for (var i = 0; i < pts.length; i++) {
        var c = pts[i][depthEje];
        if (c < lo) lo = c; if (c > hi) hi = c;
      }
      if (!(hi - lo <= umbral)) return;          // no es rebanada (corre a lo largo del eje)
      // (14-ago: aquí hubo un intento de sumar las ZONAS DE PATA como candidatas
      // del imán — competían con las rebanadas y el corte se imantaba lejos de
      // las barras: "se apagan". REVERTIDO; ver la pata queda para el modo libre
      // del imán o un diseño posterior.)
      centros.push((lo + hi) / 2);
      if (pl.diam > diamMax) diamMax = pl.diam;
    });
    if (!centros.length) return out;
    centros.sort(function (a, b) { return a - b; });
    // colapsar centros casi iguales (mismo estribo con varias barras) a 1
    var uniq = [centros[0]];
    for (var k = 1; k < centros.length; k++) {
      if (Math.abs(centros[k] - uniq[uniq.length - 1]) > 0.5) uniq.push(centros[k]);
    }
    out.pos = uniq;
    if (diamMax > 0) out.diam = diamMax;
    return out;
  }

  // Rebanada MÁS CERCANA a una posición objetivo (cm) en un arreglo ordenado.
  // Devuelve el valor del arreglo más próximo a `target` (o `target` si vacío).
  function _sliceMasCercana(pos, target) {
    if (!pos || !pos.length) return target;
    var best = pos[0], bestD = Math.abs(pos[0] - target);
    for (var i = 1; i < pos.length; i++) {
      var d = Math.abs(pos[i] - target);
      if (d < bestD) { bestD = d; best = pos[i]; }
    }
    return best;
  }

  function _encuadrarOrto(o, W, H, aspect) {
    var THREE = global.THREE;
    var d = o.def.depth;
    var dir = _ORTO_DIR[d];
    var g = ST.receta ? ST.receta.geometria : { largo: 600, alto: 60, ancho: 30 };
    var margen = 1.18;
    // half-extents en U (horizontal de la vista) y V (vertical), en cm
    var halfU = Math.max(W, 1) * margen / 2 / o.zoom;
    var halfV = Math.max(H, 1) * margen / 2 / o.zoom;
    // corregir por aspecto del cuadrante para no deformar
    if (aspect > (halfU / halfV)) halfU = halfV * aspect; else halfV = halfU / aspect;
    o.cam.left = -halfU + o.panU; o.cam.right = halfU + o.panU;
    o.cam.top = halfV + o.panV; o.cam.bottom = -halfV + o.panV;
    var dist = 2000;
    o.cam.position.set(dir.eye[0] * dist, dir.eye[1] * dist, dir.eye[2] * dist);
    o.cam.up.set(dir.up[0], dir.up[1], dir.up[2]);
    o.cam.lookAt(0, 0, 0);
    // PLANO DE CORTE: la cámara ortográfica ve todo el eje de profundidad (near/far
    // amplios); el "corte" real lo hacen 2 clipping planes en _renderVistasOrto sobre una
    // BANDA en profundidad. o.corte ∈ [0..1] posiciona el centro de la banda; el plano 3D
    // (P3) se dibuja a o.cortePos para mostrar por dónde pasa el corte.
    var half = _espesorProfundidad(d) / 2;                 // semi-espesor del elemento (cm)
    var frac = (o.corte != null ? o.corte : 0.5);
    // SENTIDO DEL CORTE — DERIVADO DE LA CÁMARA, no hardcodeado (hallazgo D).
    // La fórmula cruda `cortePos = −frac·2·half + half` hace que el extremo ALTO del
    // slider (frac 1 → cortePos −half) pele la cara +eje. Eso pela la cara CERCANA
    // sólo si el observador está en +eje. Al invertir las cámaras de SECCIÓN
    // (eye −X) y PLANTA (eye −Y) el slider quedó pelando por el lado CONTRARIO al
    // de antes en esas dos vistas, mientras ELEVACIÓN (eye +Z) seguía igual.
    // Con el signo del eye en el eje de profundidad, las 3 vistas se comportan
    // igual otra vez: arriba del slider = se pela la cara que mira al observador.
    var eyeProf = (dir && dir.eye) ? dir.eye[_EJE_IDX[d]] : 1;
    if (eyeProf < 0) frac = 1 - frac;
    // MODELO CUCHILLO (rediseño CORTE) — el grosor de la banda se DESACOPLA por eje,
    // porque las 3 vistas necesitan cosas OPUESTAS:
    //
    //  • SECCIÓN (depth=x): el usuario quiere "lo que un cuchillo cortaría" = UN estribo
    //    limpio, no los ~30 superpuestos. La banda GRUESA anterior (semi-espesor completo)
    //    dejaba pasar todos los estribos sobre YZ → rectángulos desfasados. Ahora: banda
    //    FINA (φ del estribo + margen) que se AJUSTA (snap) a la rebanada más cercana a la
    //    posición del slider → se aísla ese estribo. Los longitudinales corren en X, así
    //    que cruzan CUALQUIER corte de sección → sus círculos se ven SIEMPRE (estables).
    //    Si NO hay rebanadas (sin estribos), cae a banda gruesa → nunca vacía.
    //
    //  • A LO LARGO / PLANTA (depth=y/z): aquí una banda fina VACIARÍA la vista (la
    //    armadura vive en capas discretas en y/z y una lonja fina se las salta). Se
    //    mantiene la banda GRUESA (semi-espesor completo) → se ve la jaula ENTERA; el
    //    slider PELA una cara al alejarse del centro. Longitudinales y estribos se ven
    //    completos.
    //
    // El hormigón queda fuera del clip (material clippingPlanes:[]) → su volumen se ve
    // completo siempre (BUG 7). El plano 3D (P3) se ubica en o.cortePos (centro real de
    // la banda, ya con snap) → marca por dónde pasa el corte que se ve en 2D.
    // REGRESIÓN DEL CUCHILLO (fix 14-ago, reporte del usuario en el muro): esto
    // decidía con `d === 'x'` — el eje de profundidad de la sección DE LA VIGA.
    // En el muro la sección corta en profundidad Y (corte horizontal), así que caía
    // a banda gruesa y "se veía la profundidad completa, con las patas de los
    // cabezales"; y peor, la ELEVACIÓN del canto (depth x en muro) recibía el
    // cuchillo fino y quedaba casi vacía. La regla correcta es SEMÁNTICA: el
    // cuadrante SECCIÓN es el que corta como cuchillo, en el eje que le toque a
    // cada elemento (PLANOS_POR_ELEMENTO). Para la viga (seccion.depth='x') el
    // comportamiento es idéntico al de siempre.
    if (o.plano === 'seccion') {
      var slices = _slicesEnProfundidad(d);
      var target = -frac * (2 * half) + half;     // frac→posición cruda en [-half..half]
      // MODO LIBRE (ST.corteIman === false): sin snap. El corte se queda EXACTO donde
      // lo dejó el slider aunque ahí no haya ninguna pieza (permite cortar entre
      // estribos). La banda sigue siendo fina: es un cuchillo, no una lonja.
      if (!ST.corteIman) {
        o.cortePos = target;
        o.corteGrosor = slices.diam > 0 ? Math.max(slices.diam * 1.4, 1.2) : 4;
      } else if (slices.pos.length) {
        // banda fina centrada en la rebanada (estribo) más cercana al slider.
        o.cortePos = _sliceMasCercana(slices.pos, target);
        o.corteGrosor = Math.max(slices.diam * 1.4, 1.2);   // ~1 barra de espesor
      } else {
        // Sin estribos que aislar → banda FINA igual (modelo cuchillo total): los
        // longitudinales cruzan el corte y se ven como su círculo; sus PATAS solo
        // aparecen si el corte pasa por ellas. (Antes: banda gruesa = jaula entera
        // → "la pata se ve siempre en la sección".)
        o.cortePos = target;
        o.corteGrosor = 4;
      }
    } else {
      // elevaciones/planta (el eje depende del elemento): banda gruesa (semi-espesor
      // completo) — se ve la jaula entera; frac 0.5 → 0 (centro); el slider pela una cara.
      o.corteGrosor = Math.max(half, 5);
      o.cortePos = -frac * (2 * half) + half;
    }
    // El corte lo hacen 2 CLIPPING PLANES en _renderVistasOrto; near/far amplios.
    o.cam.near = -6000; o.cam.far = 6000;
    o.cam.updateProjectionMatrix();
  }

  // Pan (arrastre) + zoom (rueda) por vista ortográfica. Sin orbitar. Se cablea en
  // el CONTENEDOR .te-vista (el canvas marcador no captura eventos; el SVG overlay
  // sí, pero pan/zoom usan botón medio + rueda, que el SVG deja pasar por burbujeo).
  // G7-ALINEACIÓN — el overlay SVG deriva sus transforms de la cámara ortográfica,
  // así que TODO cambio de cámara (pan / zoom / resize) obliga a re-emitirlo: si no,
  // el hit-testing, los nodos y la flecha de rango quedan donde estaban ANTES del
  // zoom. Throttle por rAF: como mucho un redibujo del overlay por frame.
  function _sincronizarOverlayOrto() {
    if (ST._overlayPend) return;
    ST._overlayPend = true;
    global.requestAnimationFrame(function () {
      ST._overlayPend = false;
      var bd = $('te_backdrop');
      if (!bd || !bd.classList.contains('on')) return;
      if (ST.ultimoOut) _redibujar2D(ST.ultimoOut);
    });
  }

  // ZOOM DE RUEDA — GESTO ACOTADO, LA INERCIA NO CUENTA (6ª vuelta, con el
  // diagnóstico correcto del usuario: «dejaba de girar y se seguía moviendo el
  // zoom»). La rueda es LIBRE: al soltarla sigue girando sola un buen rato y
  // mandando eventos, así que el zoom seguía avanzando sin que nadie la tocara.
  // Las vueltas anteriores atacaron el síntoma equivocado (velocidad, ventanas,
  // saturación) y ninguna cortaba la inercia.
  // Regla final: un GESTO = todos los eventos separados por menos de _ZOOM_GAP.
  // Un gesto mueve como máximo _ZOOM_MAX pasos y de ahí NO SE MUEVE MÁS por más
  // que la rueda siga girando sola. Para volver a hacer zoom hay que soltar y
  // tocar de nuevo (una pausa > _ZOOM_GAP), que es exactamente lo que hace la
  // mano. Cambiar de sentido también abre un gesto nuevo (corregir es inmediato).
  // Perillas: _ZOOM_PASO = cuánto mueve UN click de rueda · _ZOOM_EV_MAX = clicks
  // que se le aceptan a UN evento · _ZOOM_GESTO = cuánto puede cambiar el zoom un
  // gesto entero · _ZOOM_GAP = silencio que separa un gesto del siguiente.
  //
  // RE-ESCALADO (18-ago) — «hacer zoom es muy lento; agrandar algo considerablemente
  // me toma mucho tiempo». Medido: del encuadre de una viga al mínimo eran ~50 clicks
  // repartidos en 9 gestos. Tres causas, todas de la vuelta anterior:
  //   1) se ignoraba deltaMode y la MAGNITUD de deltaY (sólo se miraba el signo), así
  //      que un evento de 400 px valía lo mismo que uno de 10;
  //   2) el paso era 1.04 (4% por click);
  //   3) el tope del gesto se contaba en PASOS (6 × 4% = ×1.27), o sea que el gesto
  //      se agotaba antes de que la imagen cambiara de forma perceptible.
  // Ahora deltaY se normaliza a CLICKS (píxeles/100 · líneas/3 · páginas×1), el paso
  // es 12% por click y el tope del gesto se mide en ZOOM ACUMULADO (×5), que es lo
  // que el usuario percibe. El tope POR EVENTO sigue siendo el blindaje contra el
  // mouse que manda un delta gigante de una sola vez: se re-escaló a 3 clicks, no se
  // eliminó (era el bug original: un giro producía un zoom descontrolado).
  var _ZOOM_PASO = 1.12;      // zoom por click de rueda
  var _ZOOM_EV_MAX = 3;       // clicks que se le aceptan como máximo a UN evento
  var _ZOOM_GESTO = 5;        // un gesto no cambia el zoom más de ×5 (ni ÷5)
  var _ZOOM_GAP = 150;        // ms de silencio que cierran el gesto
  var _zUlt = 0, _zAcum = 1, _zSigno = 0;
  function _factorZoomRueda(e) {
    var d = Number(e.deltaY) || 0;
    if (!d) return 1;
    // deltaY viene en la unidad que diga deltaMode: 0 = píxeles (≈100 por click de
    // rueda), 1 = líneas (3 por click), 2 = páginas (1 por click). Sin esto un mismo
    // giro movía distinto según el navegador y el trackpad no tenía finura.
    var m = Number(e.deltaMode) || 0;
    var clicks = (m === 1) ? (d / 3) : (m === 2 ? d : (d / 100));
    var sg = (clicks > 0) ? 1 : -1;
    clicks = Math.min(Math.abs(clicks), _ZOOM_EV_MAX);
    if (!(clicks > 0)) return 1;
    var t = Date.now();
    // gesto NUEVO: hubo silencio, o el usuario invirtió el sentido (corrigiendo)
    if (t - _zUlt > _ZOOM_GAP || sg !== _zSigno) { _zAcum = 1; _zSigno = sg; }
    _zUlt = t;
    var f = Math.pow(_ZOOM_PASO, sg * clicks);
    // TOPE DEL GESTO: lo que ya se movió en este gesto + lo que pide este evento no
    // puede pasar de ×_ZOOM_GESTO. Pasado el tope se devuelve 1 y la rueda que sigue
    // girando sola no mueve nada hasta que la mano vuelva a tocarla.
    var acum = _zAcum * f;
    if (acum > _ZOOM_GESTO) { f = _ZOOM_GESTO / _zAcum; acum = _ZOOM_GESTO; }
    else if (acum < 1 / _ZOOM_GESTO) { f = (1 / _ZOOM_GESTO) / _zAcum; acum = 1 / _ZOOM_GESTO; }
    _zAcum = acum;
    return (f > 0 && isFinite(f)) ? f : 1;
  }

  function _bindVistaOrto(plano) {
    var o = ST.orto[plano]; if (!o) return;
    var host = o.vista, panning = false, lx = 0, ly = 0;
    // "El pan no agarra a la primera": el AUTOSCROLL de Windows se comía el botón
    // medio de forma intermitente (el cuadrante 3D ya lo mataba con auxclick; las
    // vistas 2D no). Mismo remedio aquí.
    host.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });
    host.addEventListener('mousedown', function (e) {
      // PAN = BOTÓN MEDIO, y sólo él. SHIFT dejó de panear (19-ago): se recicló como
      // interruptor de las cotas (ver _setCotas). No se pierde nada — el pan
      // ya respondía al botón medio y era el gesto que el usuario usaba —, pero las
      // cotas y el pan NO pueden compartir tecla: mirar las medidas arrastraría la
      // vista. El clic izq queda para la interacción del SVG.
      if (e.button === 1) { panning = true; lx = e.clientX; ly = e.clientY; e.preventDefault(); }
    });
    global.addEventListener('mouseup', function () { panning = false; });
    global.addEventListener('mousemove', function (e) {
      if (!panning) return;
      var r = host.getBoundingClientRect();
      var kU = (o.cam.right - o.cam.left) / Math.max(r.width, 1);
      var kV = (o.cam.top - o.cam.bottom) / Math.max(r.height, 1);
      o.panU -= (e.clientX - lx) * kU; o.panV += (e.clientY - ly) * kV;
      lx = e.clientX; ly = e.clientY;
      _marcarSucio();               // PERF: pan de una vista orto → repintar
      _sincronizarOverlayOrto();    // el overlay sigue a la cámara (hit/nodos/flecha)
    });
    host.addEventListener('wheel', function (e) {
      e.preventDefault(); o.zoom /= _factorZoomRueda(e);
      o.zoom = Math.max(0.15, Math.min(12, o.zoom));
      _marcarSucio();
      _sincronizarOverlayOrto();
    }, { passive: false });
  }

  // ==========================================================================
  // B2·(a) — CLIPPING **LOCAL** POR VISTA. El cuchillo corta TODO (feedback del
  // usuario: "es una foto de ese corte, debiera verse solo lo que corta el plano").
  //
  // Antes se dejaba a los LONGITUDINALES sin clip para que su tapa se viera como
  // círculo sólido — pero eso hacía que sus PATAS/ganchos aparecieran SIEMPRE en la
  // sección aunque el plano no las cortara. Ahora se clipea todo y el material del
  // clip es DoubleSide: el corte de un cilindro muestra su pared interior (algo más
  // oscura), que se lee como el círculo/sección de la barra. La luz frontal por
  // vista (_luzOrto) mantiene la lectura pareja.
  //
  // Mecánica (three r160): con renderer.localClippingEnabled=true, los planos se
  // asignan POR MATERIAL. Como los materiales son COMPARTIDOS por tipología, cada
  // mesh usa un CLON con clippingPlanes cacheado en userData.matClip (no se crea
  // material por frame). El "material base" puede ser matBase o matSel (selección
  // resaltada, _resaltarSeleccion3D): el caché se invalida al cambiar (_base). El
  // hormigón y el plano P3 siguen exentos: su material ya lleva clippingPlanes:[].
  // ==========================================================================

  // PATAS DE PUNTA — SIN EXCEPCIÓN (bug "me volvieron a aparecer las patas en todos
  // los cortes"). Existía un caso especial (_esDePunta) que renderizaba la barra vista
  // DE PUNTA con su material BASE, sin planos: eso le devolvía el gancho ENTERO en
  // TODAS las secciones, cortara el plano por él o no. Se eliminó: la barra de punta
  // se clipea con la banda como todo lo demás, así que el gancho aparece SÓLO cuando
  // el corte pasa por él (y puede verse un muñón parcial: es exactamente lo que el
  // cuchillo corta). Su marca de sección permanente es el CÍRCULO del overlay 2D
  // (_dibujarVista2D), que no depende del clip.

  // Aplica/retira los 2 planos de corte de una vista sobre los materiales de las barras.
  function _clipLocalPorVista(dep, planos) {
    var THREE = global.THREE;
    var barras = ST.barras3D || [];
    for (var i = 0; i < barras.length; i++) {
      var mesh = barras[i];
      mesh.visible = true;
      var base = mesh.userData.matActivo || mesh.userData.matBase;
      if (!base) continue;
      if (planos) {
        // clon cacheado del material activo, con los planos de ESTA vista
        var clip = mesh.userData.matClip;
        if (!clip || clip.userData._base !== base) {
          if (clip && clip.dispose) clip.dispose();   // el activo cambió (selección)
          clip = base.clone();
          clip.userData._propio = true;    // creado al vuelo → dispose al vaciar el world
          clip.userData._base = base;
          clip.side = THREE.DoubleSide;    // el interior del tubo cortado se ve (círculo)
          mesh.userData.matClip = clip;
        }
        clip.clippingPlanes = planos;
        mesh.material = clip;
      } else {
        mesh.material = base;              // pase 3D en perspectiva: SIN clip
      }
    }
  }

  // B2·(b) — LUZ FRONTAL por vista ortográfica. La luz direccional principal de la
  // escena viene de (1,1.4,0.8): contra la tapa de un longitudinal en SECCIÓN (normal
  // +X) da un coseno pobre y, con el metalness 0.5 que tenían los materiales por
  // entonces, el círculo salía OSCURO ("apagado / de otro color"). El metalness ya
  // bajó a MAT_METALNESS, pero el coseno pobre sigue igual y esta luz sigue haciendo
  // falta. Esta luz extra se coloca en el EYE de la vista que se está
  // pintando → las tapas y las secciones quedan parejas. Sólo está VISIBLE durante los
  // 3 renders orto y se apaga para el pase perspectivo (mismo patrón que grid/planoMesh
  // en _loop) → el 3D no cambia en nada.
  function _luzOrto() {
    var THREE = global.THREE;
    if (!THREE || !ST.scene) return null;
    if (!ST.luzFrontal) {
      ST.luzFrontal = new THREE.DirectionalLight(0xffffff, 0.5);
      ST.luzFrontal.visible = false;
      ST.scene.add(ST.luzFrontal);
      // el target de una DirectionalLight debe estar EN la escena para que su
      // matrixWorld se actualice (si no, la luz apunta siempre a (0,0,0) del padre).
      ST.scene.add(ST.luzFrontal.target);
    }
    return ST.luzFrontal;
  }

  // Renderiza las 3 vistas ortográficas con scissor sobre el MISMO renderer/canvas
  // grande. El canvas del renderer (te_cv) se estira para cubrir todo te_quad; cada
  // vista se pinta en su rectángulo (viewport+scissor) mirando su .te-vcanvas.
  function _renderVistasOrto() {
    var THREE = global.THREE;
    if (!THREE || !ST.renderer || !ST.orto) return;
    var quad = $('te_quad'); if (!quad) return;
    var full = ST.renderer.domElement.getBoundingClientRect();
    // FONDO DE LAS 2D = EL MISMO TEMA QUE EL 3D (18-ago). Los 4 cuadrantes salen del
    // MISMO renderer y de la MISMA escena, así que `scene.background` es uno solo y el
    // fondo se sigue fijando POR PASE — pero ahora con el mismo valor. Lo que antes
    // obligaba a dejar las 2D siempre claras (los overlays SVG dibujados para fondo
    // claro) lo resuelve el CSS: _aplicarTema3D marca #te_quad (y #te_modal) con
    // te-tema-* y las variables --te-ov-* invierten cotas, recubrimiento, handles y
    // textos; las --te-* hacen lo propio con el marco del modal.
    _fondoEscena(_tema3D().bg);
    var luz = _luzOrto();
    if (luz) luz.visible = true;
    Object.keys(ST.orto).forEach(function (plano) {
      var o = ST.orto[plano];
      var r = o.vista.getBoundingClientRect();
      var w = r.width, h = r.height; if (w < 2 || h < 2) return;
      // rect en píxeles del canvas del renderer (origen abajo-izq para GL)
      var x = r.left - full.left;
      var yTop = r.top - full.top;
      var y = full.height - (yTop + h);
      var def = o.def;
      var g = ST.receta ? ST.receta.geometria : {};
      var W = Number(g[def.W]) || 60, H = Number(g[def.H]) || 60;
      _encuadrarOrto(o, W, H, w / h);
      // CLIPPING = BANDA (cuchillo, rediseño BUG 2/5/6): dos planos perpendiculares al
      // eje de profundidad que dejan ver [cortePos-grosor .. cortePos+grosor]. En
      // SECCIÓN la banda es FINA (aísla UN estribo); en las otras 2 es gruesa (jaula
      // entera, el slider PELA una cara). Ahora se aplican LOCALMENTE (por material) y
      // SÓLO a las barras "rebanada" — ver _clipLocalPorVista.
      var dep = def.depth;
      var ax = dep === 'x' ? 1 : 0, ay = dep === 'y' ? 1 : 0, az = dep === 'z' ? 1 : 0;
      var c = (o.cortePos != null ? o.cortePos : 0);
      var gr = (o.corteGrosor != null ? o.corteGrosor : 9999);
      if (!o.clipA) { o.clipA = new THREE.Plane(); o.clipB = new THREE.Plane(); }
      // conserva  coord >= c-gr   → normal +eje, constant = -(c-gr) = gr-c
      o.clipA.set(new THREE.Vector3(ax, ay, az), gr - c);
      // conserva  coord <= c+gr   → normal -eje, constant = c+gr
      o.clipB.set(new THREE.Vector3(-ax, -ay, -az), c + gr);
      if (!o.clipPlanos) o.clipPlanos = [o.clipA, o.clipB];
      _clipLocalPorVista(dep, o.clipPlanos);
      // luz frontal en el EYE de ESTA vista (B2·b)
      if (luz) {
        var dir = _ORTO_DIR[dep] || _ORTO_DIR.z;
        luz.position.set(dir.eye[0] * 1000, dir.eye[1] * 1000, dir.eye[2] * 1000);
        luz.target.position.set(0, 0, 0);
        luz.target.updateMatrixWorld();
      }
      ST.renderer.clippingPlanes = [];   // el corte ya NO es global: es por material
      ST.renderer.setViewport(x, y, w, h);
      ST.renderer.setScissor(x, y, w, h);
      ST.renderer.setScissorTest(true);
      ST.renderer.render(ST.scene, o.cam);
    });
    // dejar la escena como la espera el pase 3D: sin clip en ningún material, luz apagada.
    _clipLocalPorVista(null, null);
    if (luz) luz.visible = false;
    ST.renderer.clippingPlanes = [];
    ST.renderer.setScissorTest(false);
  }

  // ==========================================================================
  // CÁMARA DEL CUADRANTE 3D — modelo, órbita y el punto alrededor del que gira
  //
  // MODELO (19-ago): (target, dist, quat, panX, panY).
  // `target` NO es "el pivote del giro": es el ANCLA de la parametrización. El pivote
  // se elige en cada gesto (centro del elemento, o el punto señalado con ctrl) y se
  // le pasa al giro; lo que queda escrito en `target` después es una consecuencia,
  // no un estado que haya que cuidar. Ver la nota de _girarPorArrastre.
  //   base   = {derecha, arriba, atrás} = los tres ejes del QUATERNION
  //   ojo    = target + dist·atrás + panX·derecha + panY·arriba
  //   mirada = −atrás
  // Es el modelo de siempre con la orientación guardada como quaternion en vez de
  // (rotX = elevación, rotY = acimut) + el "arriba" clavado en +Y del mundo. Lo que
  // se gana es poder ESCRIBIR la orientación (un lookAt la reconstruiría con el
  // arriba del mundo) y perder la singularidad del cenit —donde la base vieja se
  // degeneraba porque |derecha| = cos(elev) → 0—; sin eso no hay giro rígido
  // alrededor de un punto cualquiera: ver
  // _girarPorArrastre. Lo que NO cambia: el pan y el zoom al cursor siguen apoyados
  // en la MISMA base de pantalla, y la órbita normal compone exactamente los dos
  // giros de antes (verificado numéricamente en tests/test_camara_ctrl.js: mismo ojo
  // hasta 1e-9 tras 60 pasos).
  // ==========================================================================

  // Los tres ejes de la cámara, en coordenadas de mundo.
  function _baseCam() {
    var THREE = global.THREE;
    var q = _quatCam();
    return {
      derecha: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
      arriba: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
      atras: new THREE.Vector3(0, 0, 1).applyQuaternion(q)   // three mira por su −Z
    };
  }

  // EL OJO, sacado de la parametrización de ST. Es álgebra pura (no toca ST.camera),
  // así que se puede pedir en cualquier momento sin depender de si la matriz de la
  // cámara es la de este frame o la del anterior — que era el flanco del modelo viejo.
  function _ojoCam(b) {
    var THREE = global.THREE;
    b = b || _baseCam();
    return new THREE.Vector3().copy(ST.target)
      .addScaledVector(b.atras, ST.dist)
      .addScaledVector(b.derecha, ST.panX)
      .addScaledVector(b.arriba, ST.panY);
  }

  // Quaternion SIN alabeo para (elevación, acimut): la orientación con la que nace el
  // editor y a la que vuelve el ⟳. Es la composición de los dos giros que hacían
  // rotX/rotY —acimut alrededor de +Y del mundo, elevación alrededor del X ya girado—
  // y da el MISMO vector que la fórmula vieja atrás = (cos e·sin a, sin e, cos e·cos a).
  function _quatDeAngulos(elev, azim) {
    var THREE = global.THREE;
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), azim)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -elev));
  }

  // La orientación vigente, creándola en el primer uso (ST nace sin THREE cargado).
  function _quatCam() {
    if (!ST.quat) ST.quat = _quatDeAngulos(CAM0.elev, CAM0.azim);
    return ST.quat;
  }

  function _applyCam() {
    ST.camera.position.copy(_ojoCam());
    // La orientación se ESCRIBE, no se deduce con lookAt: lookAt la reconstruye con
    // el "arriba" del mundo y borraría el alabeo en cada frame.
    ST.camera.quaternion.copy(_quatCam());
    ST.camera.updateMatrix();   // el render la recompone igual; el gizmo la lee ya hecha
  }

  // Las colocaciones del componente SELECCIONADO. El filtro por meta.ci vive acá una
  // sola vez: lo usan el centro de la selección y la caída del pivote de ctrl, y si
  // divergieran, "la barra seleccionada" sería otra según quién pregunte.
  function _placementsSeleccion3D() {
    var out = ST.ultimoOut;
    if (ST.selCi < 0 || !out || !out.placements) return [];
    return out.placements.filter(function (pl) { return !!(pl.meta && pl.meta.ci === ST.selCi); });
  }

  // CENTRO DE LA CAJA que envuelve una lista de colocaciones, o null si no hay ni un
  // punto finito. Está escrito una sola vez porque lo piden DOS pivotes (el centro de
  // la barra seleccionada y el del elemento cuando todavía no hay hormigón) y dos
  // bboxes que se separen son dos pivotes que se separan.
  function _centroDePlacements(pls) {
    var lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity }, n = 0;
    (pls || []).forEach(function (pl) {
      (pl.puntos || []).forEach(function (p) {
        if (!p || !isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) return;
        if (p.x < lo.x) lo.x = p.x; if (p.x > hi.x) hi.x = p.x;
        if (p.y < lo.y) lo.y = p.y; if (p.y > hi.y) hi.y = p.y;
        if (p.z < lo.z) lo.z = p.z; if (p.z > hi.z) hi.z = p.z;
        n++;
      });
    });
    if (!n) return null;
    return { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 };
  }

  // CENTRO (en coords de mundo) del ELEMENTO SELECCIONADO: bbox de TODOS sus
  // placements. Sin selección (o sin geometría todavía) devuelve el centro de la
  // escena — el host está centrado en el origen.
  function _centroSeleccion3D() {
    return _centroDePlacements(_placementsSeleccion3D()) || { x: 0, y: 0, z: 0 };
  }

  // --- EL PIVOTE DEL GIRO: EL MISMO GIRO, DOS CENTROS -----------------------------
  //
  // Lo ÚNICO que cambia entre el arrastre normal y el ctrl+arrastre es ALREDEDOR DE
  // QUÉ PUNTO gira la cámara. El giro es el de siempre (acimut + elevación):
  //   · sin ctrl → el CENTRO DEL ELEMENTO DE HORMIGÓN. Fijo, sacado del modelo y no
  //     de la cámara, así que no se mueve por panear ni por hacer zoom.
  //   · con ctrl → EL PUNTO QUE SE ESTÁ SEÑALANDO al empezar el gesto.
  // Es lo que hacen las dos herramientas que el usuario usa: Revit orbita el centro
  // del modelo (y el del elemento seleccionado, si hay selección) y Tekla deja marcar
  // un punto —el punto rosado— y orbita en torno a él.
  //
  // ACÁ MURIÓ EL "ASADOR" (20-ago). Hasta ayer el ctrl cambiaba el EJE: giraba sobre
  // el eje propio de la pieza (sacado por PCA de su nube de puntos) y dejaba la barra
  // clavada como una brocheta mientras la escena daba vueltas. Nunca fue eso lo que
  // se pidió —«no quiero que CTRL gire sobre el eje propio de la pieza»— y encima
  // producía un giro horizontal raro. Con el modo se fueron _ejePropioSeleccion3D, la
  // covarianza 3×3, la iteración de potencia, el corte λ2/λ1 con su tabla de
  // indicios, el signo canónico, el aviso de "pieza vertical" y el enderezado del
  // horizonte (que sólo existía para destorcer lo que el asador torcía: el giro de
  // ahora es el de siempre en los DOS modos y nunca inclina el horizonte).
  // Lo que NO se fue —y no tenía que irse— es el modelo de cámara a quaternion: es lo
  // que permite escribir el par (ojo, orientación) a mano, y de ahí sale que el
  // pivote quede clavado al píxel.

  // CENTRO DEL ELEMENTO DE HORMIGÓN — el pivote del arrastre NORMAL.
  // La caja se arma con BoxGeometry SIN posicionarla (ver _redibujar) y el sistema de
  // coordenadas del host está centrado en el origen (viga y muro por igual): el
  // centro del hormigón ES el origen del mundo. Se lee de la receta y NO se guarda en
  // la cámara a propósito — un pivote guardado es un pivote que se ensucia, que es
  // justo lo que hacía el absorbedor.
  // Sin hormigón todavía (el editor headless de los tests) cae a la caja de todas las
  // barras, y si no hay ni eso, al origen.
  function _centroElemento3D() {
    var g = ST.receta && ST.receta.geometria;
    if (g && isFinite(Number(g.largo)) && isFinite(Number(g.alto)) && isFinite(Number(g.ancho))) {
      return { x: 0, y: 0, z: 0 };
    }
    return _centroDePlacements((ST.ultimoOut && ST.ultimoOut.placements) || []) || { x: 0, y: 0, z: 0 };
  }

  // --- EL PUNTO BAJO EL CURSOR (el pivote del ctrl) -------------------------------
  //
  // POR QUÉ NO THREE.Raycaster, que es lo primero que uno pensaría:
  //   · three entra por CDN y los tests headless corren con un THREE de mentira
  //     (Vector3 + Quaternion). Con un raycaster contra los meshes, ESTA función —la
  //     que decide dónde queda clavado el giro— quedaría sin una sola medición, y
  //     esta función ya se volvió indemostrable a ojo dos veces seguidas.
  //   · el mesh de una barra es un TUBO teselado (10 caras, ver _redibujar): el
  //     raycaster devolvería un punto de su SUPERFICIE, con el error de la
  //     teselación. Acá el punto cae en el EJE de la barra, que es donde el usuario
  //     cree que está apuntando.
  //
  // Radio de agarre en píxeles, ADEMÁS del grosor real de la barra: una φ16 vista a
  // 900 cm mide 1,3 px de ancho en el cuadrante, o sea que sin holgura habría que
  // acertarle al píxel. Con 10 px se agarra apuntando "por al lado", como en
  // cualquier CAD.
  var PICK_PX = 10;
  // DOS BARRAS "BAJO EL CURSOR" A LA VEZ: por debajo de esta separación en píxeles las
  // dos están tocando el cursor y lo que decide es cuál TAPA a cuál (la de adelante).
  // Por encima, manda la que esté más cerca del cursor. Ver el desempate en
  // _puntoBajoCursor3D: ordenar por profundidad pura agarraba una barra 8 px al
  // costado teniendo otra justo debajo (medido por la auditoría).
  var EMPATE_PX = 1.5;

  // Un punto de verdad: tres NÚMEROS finitos. El `typeof` no sobra — con una
  // coordenada que sea el string '0', isFinite('0') es true y la aritmética de más
  // abajo CONCATENA en vez de sumar: el pivote salía con y = "00" (medido por la
  // auditoría) y de ahí en adelante la cámara opera con basura.
  function _esPunto3D(p) {
    return !!p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number' &&
      isFinite(p.x) && isFinite(p.y) && isFinite(p.z);
  }

  // RAYO DEL CURSOR. fx/fy = cursor DENTRO del cuadrante en [0..1] (0,0 = arriba-izq)
  // y aspect = w/h: la MISMA convención y el MISMO lente que _zoomAlCursor (si
  // divergieran, el pivote no caería donde apunta el cursor).
  // `dir` NO va normalizado a propósito: se arma con componente 1 sobre la dirección
  // de vista (−atrás), así el parámetro del rayo ES la profundidad en cm y la
  // tolerancia en píxeles se convierte a centímetros con una regla de tres, sin
  // proyectar de vuelta.
  function _rayoDesdeCursor(fx, fy, aspect) {
    var THREE = global.THREE;
    if (!THREE || !ST.target) return null;
    if (!isFinite(fx) || !isFinite(fy) || !(aspect > 0)) return null;
    var b = _baseCam();
    var th = Math.tan(FOV3D * Math.PI / 360);
    var u = (fx * 2 - 1) * th * aspect, v = -(fy * 2 - 1) * th;
    var dir = new THREE.Vector3(-b.atras.x, -b.atras.y, -b.atras.z)
      .addScaledVector(b.derecha, u).addScaledVector(b.arriba, v);
    return { ojo: _ojoCam(b), dir: dir, th: th };
  }

  // ACERCAMIENTO RAYO↔SEGMENTO: el punto del segmento AB más cercano al rayo, con la
  // profundidad a la que queda y a qué distancia pasa el rayo de él. Es el clásico
  // recta-recta resuelto con el sistema 2×2, con el parámetro del segmento RECORTADO
  // a [0,1] (apuntar a la punta de una barra tiene que agarrarla) y recalculando el
  // del rayo DESPUÉS de recortar — si no, en las puntas el punto elegido se corre.
  // Devuelve null si el acercamiento queda detrás del ojo.
  function _acercarRayoSegmento(r, A, B) {
    var ux = r.dir.x, uy = r.dir.y, uz = r.dir.z;
    var vx = B.x - A.x, vy = B.y - A.y, vz = B.z - A.z;
    var wx = r.ojo.x - A.x, wy = r.ojo.y - A.y, wz = r.ojo.z - A.z;
    var a = ux * ux + uy * uy + uz * uz;
    var b = ux * vx + uy * vy + uz * vz;
    var c = vx * vx + vy * vy + vz * vz;
    var d = ux * wx + uy * wy + uz * wz;
    var e = vx * wx + vy * wy + vz * wz;
    if (!(a > 1e-12)) return null;
    var den = a * c - b * b;
    var s;
    // den ≈ 0 = rayo y barra PARALELOS (mirar una longitudinal a lo largo). Ahí no
    // hay un punto más cercano único: se toma el del segmento más cercano AL OJO, que
    // es el que el usuario tiene delante.
    if (c > 1e-12 && den > 1e-9 * a * c) s = (a * e - b * d) / den;
    else if (c > 1e-12) s = e / c;
    else s = 0;                                   // segmento degenerado (dos puntos iguales)
    s = Math.max(0, Math.min(1, s));
    var t = (b * s - d) / a;                      // = profundidad, por cómo se armó `dir`
    if (!(t > 1e-6)) return null;                 // detrás del ojo (o encima)
    var qx = A.x + vx * s, qy = A.y + vy * s, qz = A.z + vz * s;
    var dx = r.ojo.x + ux * t - qx, dy = r.ojo.y + uy * t - qy, dz = r.ojo.z + uz * t - qz;
    return { p: { x: qx, y: qy, z: qz }, prof: t, sep: Math.sqrt(dx * dx + dy * dy + dz * dz) };
  }

  // CORTE DEL RAYO CON LA CAJA DE HORMIGÓN (centrada en el origen; dims largo·alto·
  // ancho sobre x·y·z). Método de las láminas. Devuelve la profundidad de ENTRADA, o
  // la de salida si el ojo ya está DENTRO de la caja (ahí lo que se ve es la cara de
  // atrás), y null si el rayo no la toca o si quedó entera detrás.
  function _cortarCajaConRayo(r, g) {
    var half = [Number(g.largo) / 2, Number(g.alto) / 2, Number(g.ancho) / 2];
    var o = [r.ojo.x, r.ojo.y, r.ojo.z], u = [r.dir.x, r.dir.y, r.dir.z];
    var t0 = -Infinity, t1 = Infinity;
    for (var i = 0; i < 3; i++) {
      if (!(half[i] > 0)) return null;
      if (Math.abs(u[i]) < 1e-12) {               // rayo paralelo a esta lámina
        if (o[i] < -half[i] || o[i] > half[i]) return null;
        continue;
      }
      var ta = (-half[i] - o[i]) / u[i], tb = (half[i] - o[i]) / u[i];
      if (ta > tb) { var sw = ta; ta = tb; tb = sw; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }
    var t = (t0 > 1e-6) ? t0 : t1;
    if (!(t > 1e-6)) return null;
    return { p: { x: o[0] + u[0] * t, y: o[1] + u[1] * t, z: o[2] + u[2] * t }, prof: t };
  }

  // EL PUNTO DE LA GEOMETRÍA BAJO EL CURSOR. Devuelve {x,y,z,tipo} o null.
  // wpx/hpx = tamaño del cuadrante 3D en píxeles: hace falta para traducir PICK_PX a
  // centímetros a cada profundidad (lo que entra de alto a la profundidad t es
  // 2·t·tan(FOV/2), repartido en hpx píxeles).
  // LAS BARRAS LE GANAN AL HORMIGÓN aunque el hormigón esté delante, y no es un
  // empate mal resuelto: la caja es TRANSLÚCIDA (opacity 0.14) y su cara de adelante
  // pasa por delante de las barras —15 cm en una viga de 30 de ancho—, así que
  // ordenar por profundidad pura pondría SIEMPRE el pivote en una cara que casi no se
  // ve, incluso apuntando de lleno a una barra.
  // ENTRE BARRAS MANDA LA DISTANCIA AL CURSOR, no la profundidad, y esto lo corrigió
  // la auditoría: con una barra 8 px al costado a 600 cm y otra JUSTO bajo el cursor a
  // 1200, ordenar por profundidad agarraba la de 600 — una barra que el cursor no está
  // tocando. La profundidad sólo desempata entre las que están IGUAL de bajo el cursor
  // (±EMPATE_PX): ahí gana la de adelante, que es la que tapa a la otra.
  function _puntoBajoCursor3D(fx, fy, wpx, hpx) {
    if (!(wpx > 1) || !(hpx > 1)) return null;
    var r = _rayoDesdeCursor(fx, fy, wpx / hpx);
    if (!r) return null;
    var pls = (ST.ultimoOut && ST.ultimoOut.placements) || [];
    var cand = [];
    for (var k = 0; k < pls.length; k++) {
      var pts = pls[k].puntos || [];
      var radio = (isFinite(pls[k].diam) && Number(pls[k].diam) > 0 ? Number(pls[k].diam) : 1.6) / 2;
      for (var i = 0; i + 1 < pts.length; i++) {
        var A = pts[i], B = pts[i + 1];
        if (!_esPunto3D(A) || !_esPunto3D(B)) continue;
        var h = _acercarRayoSegmento(r, A, B);
        if (!h) continue;
        // cm por píxel a ESA profundidad: lo que entra de alto es 2·prof·tan(FOV/2)
        var cmPorPx = 2 * h.prof * r.th / hpx;
        if (h.sep > radio + PICK_PX * cmPorPx) continue;   // ni rozando el cursor
        h.sepPx = h.sep / cmPorPx;                         // a cuántos píxeles pasa del cursor
        cand.push(h);
      }
    }
    var mejor = null;
    for (var j = 0; j < cand.length; j++) {
      var c = cand[j];
      if (!mejor) { mejor = c; continue; }
      if (c.sepPx < mejor.sepPx - EMPATE_PX) mejor = c;                        // más pegada al cursor
      else if (c.sepPx <= mejor.sepPx + EMPATE_PX && c.prof < mejor.prof) mejor = c;   // empatan: la de adelante
    }
    if (mejor) return { x: mejor.p.x, y: mejor.p.y, z: mejor.p.z, tipo: 'barra' };
    // El HORMIGÓN ya no se señala (19-ago, decisión del usuario: «no queremos que
    // detecte la superficie del hormigón, la idea sería que rote en el punto en el que
    // está»). Su cara metía el pivote a una profundidad que no era la que el usuario
    // miraba, y encima dependía de tener el 🧊 encendido.
    return null;
  }

  // EL PUNTO QUE EL CURSOR SEÑALA CUANDO NO HAY FIERRO DEBAJO. No se inventa nada: se
  // corta el rayo con el plano PARALELO A LA PANTALLA que pasa por la pieza (o por el
  // elemento si no hay selección), que es la profundidad a la que el usuario está
  // mirando. Así el ctrl gira siempre alrededor del punto donde está el cursor, con o
  // sin barra debajo, y desaparece el salto al centro.
  function _puntoEnPlanoDeVista(fx, fy, wpx, hpx) {
    if (!(wpx > 1) || !(hpx > 1)) return null;
    var r = _rayoDesdeCursor(fx, fy, wpx / hpx);
    if (!r) return null;
    var C = (ST.selCi >= 0 && _placementsSeleccion3D().length)
      ? _centroSeleccion3D() : _centroElemento3D();
    if (!C || !_esPunto3D(C)) return null;
    var b = _baseCam();
    // Profundidad de C: su proyección sobre el eje de vista. `dir` no viene normalizado
    // justamente para que el parámetro SEA la profundidad (misma convención que el pick).
    var prof = -((C.x - r.ojo.x) * b.atras.x + (C.y - r.ojo.y) * b.atras.y + (C.z - r.ojo.z) * b.atras.z);
    if (!(prof > 1e-6)) return null;
    return { x: r.ojo.x + r.dir.x * prof, y: r.ojo.y + r.dir.y * prof, z: r.ojo.z + r.dir.z * prof };
  }

  // EL PIVOTE DEL CTRL, CON SUS CAÍDAS. Nunca devuelve null: siempre hay pivote.
  //   'barra'     → el eje de la barra que está bajo el cursor
  //   'hormigon'  → la cara del hormigón bajo el cursor (no había barra)
  //   'seleccion' → no había geometría bajo el cursor: el centro de la barra
  //                 seleccionada
  //   'elemento'  → tampoco hay selección: el centro del elemento, o sea EL MISMO
  //                 pivote del arrastre normal. Ahí el ctrl no hace nada distinto, y
  //                 por eso se DICE en la barra de estado en vez de fingir.
  function _pivoteDelCursor(fx, fy, wpx, hpx) {
    var h = _puntoBajoCursor3D(fx, fy, wpx, hpx);
    if (h) return { p: { x: h.x, y: h.y, z: h.z }, fuente: h.tipo };
    var pl = _puntoEnPlanoDeVista(fx, fy, wpx, hpx);
    if (pl) return { p: pl, fuente: 'plano' };
    return { p: _centroElemento3D(), fuente: 'elemento' };
  }

  // PROYECCIÓN de un punto del mundo a PÍXELES del cuadrante 3D. Es la inversa exacta
  // de _rayoDesdeCursor (mismo lente, misma convención) y la usan el punto del pivote
  // que se dibuja en pantalla y los tests, que miden en píxeles lo que el usuario ve.
  // Devuelve null si el punto está DETRÁS de la cámara.
  function _proyectarEnCuadrante(P, wpx, hpx) {
    var THREE = global.THREE;
    if (!THREE || !ST.target || !P || !(wpx > 1) || !(hpx > 1)) return null;
    var b = _baseCam(), ojo = _ojoCam(b);
    var d = new THREE.Vector3(P.x - ojo.x, P.y - ojo.y, P.z - ojo.z);
    var prof = -d.dot(b.atras);
    if (!(prof > 1e-6)) return null;
    var th = Math.tan(FOV3D * Math.PI / 360);
    return {
      px: (d.dot(b.derecha) / (prof * th * (wpx / hpx))) * (wpx / 2) + wpx / 2,
      py: -(d.dot(b.arriba) / (prof * th)) * (hpx / 2) + hpx / 2,
      prof: prof
    };
  }

  // ESTADO REAL de la cámara de este instante: ojo y orientación. Ahora es
  // álgebra sobre ST (antes había que correr _applyCam primero y leer la matriz, que
  // podía ser la del frame anterior; ese requisito ya no existe).
  function _estadoCamara() {
    var THREE = global.THREE;
    if (!THREE || !ST.target) return null;
    return { eye: _ojoCam(), q: _quatCam().clone() };
  }

  // ESCRIBE UN PAR (ojo, orientación) EN LA PARAMETRIZACIÓN DE ST, pivotando en `p`.
  // Es la conversión inversa de _applyCam y la usan LOS DOS caminos que mueven la
  // cámara "a mano" (_pivotarEnSinMover y el giro rígido): está escrita una sola vez
  // porque duplicarla dejaría dos álgebras que divergen al primer cambio de _applyCam.
  // Con la base ortonormal del quaternion no hay que proyectar en dos pasos:
  //   ojo − p = dist·atrás + panX·derecha + panY·arriba
  // y cada término sale de un producto punto. Devuelve false si `p` queda detrás del
  // ojo (no hay pivote posible).
  // ACÁ NO SE RECORTA NADA, Y ES A PROPÓSITO. Recortar en esta función es cambiar el
  // ojo que se pidió, o sea mover la imagen sin que nadie lo haya pedido:
  //   · la ELEVACIÓN se recortaba acá a ±1,45 y rompía la rigidez justo en el tope;
  //     el tope ahora vive en el incremento de la órbita normal (_orbitarMundo).
  //   · la DISTANCIA pasaba por _clampDist, y con la pieza más cerca del ojo que el
  //     mínimo (dist 40 y la pieza 30 cm por delante → 10, recortado a 15) la imagen
  //     SALTABA 152 px al empezar a girar (medido). Ahora ese pivote sencillamente
  //     SE RECHAZA: el gesto cae al giro normal, que no salta.
  // Devuelve false si `p` no sirve de pivote (detrás del ojo o fuera del rango de
  // distancia en el que la cámara sabe vivir).
  function _fijarCamDesdeOjo(eye, q, p) {
    var THREE = global.THREE;
    if (!THREE || !ST.target || !eye || !q || !p) return false;
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) return false;
    var derecha = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    var arriba = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    var atras = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    var w = new THREE.Vector3(eye.x - p.x, eye.y - p.y, eye.z - p.z);
    var distN = w.dot(atras);
    // QUÉ SE RECHAZA Y QUÉ NO. Lo único IMPOSIBLE es un pivote que no está DELANTE del
    // ojo: ahí no hay pantalla donde clavarlo. El techo (DIST_MAX) se mantiene porque
    // un pivote a 60 m de una viga de 6 no es un pivote, es un error de cuenta.
    // EL PISO SE FUE (20-ago) y hay que decir por qué, porque estuvo puesto: venía de
    // cuando esta función RECORTABA la distancia con _clampDist —eso sí reconstruía
    // otro ojo y hacía saltar la imagen 152 px—, y al sacar el recorte el piso quedó
    // de más. Lo que costaba, medido por la auditoría: con la cámara en el máximo
    // acercamiento (dist 15, donde la deja el clamp de la rueda) la ventana mide 10 cm
    // de alto, así que CASI CUALQUIER barra que uno señale está a menos de 15 cm del
    // ojo — y quedaba rechazada: el ctrl no clavaba el punto (se movía 18,7 px por
    // cada paso de arrastre) justo en el zoom donde más falta hace, mirando un doblez.
    // Sin piso, ese mismo caso da 0,000000 px. Lo que `dist` por debajo del mínimo sí
    // trae —que el paso de la rueda y del pan se calculan con ella— dura sólo el
    // gesto: al soltar, el pivote vuelve al elemento (ver _restaurarPivoteGuardado).
    if (!(distN > 1e-6 && distN <= DIST_MAX + 1e-6)) return false;   // encima del ojo, detrás, o lejísimos
    // Sin renormalizar el quaternion: la orientación se acumula multiplicando
    // quaternions unitarios y la norma se desvía 2e-12 en 100.000 pasos (medido). El
    // que SÍ hay que cuidar es el EJE del giro — ver _orbitarMundo.
    ST.quat = q.clone();
    ST.target.set(p.x, p.y, p.z);
    ST.dist = distN;                  // ya validado arriba: nada que recortar
    ST.panX = w.dot(derecha);
    ST.panY = w.dot(arriba);
    _marcarSucio();
    return true;
  }

  // CAMBIA EL PIVOTE A `p` SIN MOVER UN SOLO PÍXEL: el ojo y la orientación se dejan
  // intactos y sólo se reparte el estado (dist ← lo que hay hasta el plano de `p`,
  // pan ← lo que `p` está corrido respecto del centro de pantalla). Verificado:
  // 0,000000 px de deriva.
  function _pivotarEnSinMover(p) {
    var est = _estadoCamara(); if (!est) return false;
    return _fijarCamDesdeOjo(est.eye, est.q, p);
  }

  // GIRA LA CÁMARA COMO CUERPO RÍGIDO alrededor de `p` con el quaternion `q` (el ojo
  // y la orientación reciben el MISMO giro) y deja el resultado escrito en ST. Todo
  // lo que esté sobre el EJE de `q` que pasa por `p` queda CLAVADO en pantalla —no un
  // punto, la recta entera—, y eso es exactamente lo que el test mide (0,000000 px).
  function _girarCamRigido(p, q) {
    var THREE = global.THREE;
    if (!THREE || !p || !q) return false;
    var est = _estadoCamara(); if (!est) return false;
    var eye = new THREE.Vector3(est.eye.x - p.x, est.eye.y - p.y, est.eye.z - p.z)
      .applyQuaternion(q).add(new THREE.Vector3(p.x, p.y, p.z));
    return _fijarCamDesdeOjo(eye, q.clone().multiply(est.q), p);
  }

  // EL PUNTO QUE ESTÁ AL CENTRO DE LA PANTALLA, a la distancia actual. Es el pivote
  // de ÚLTIMO RECURSO: siempre existe y siempre es válido (está justo a `dist` del
  // ojo, o sea dentro del rango en el que la cámara sabe vivir), así que con él
  // ningún arrastre se queda muerto.
  function _puntoCentroPantalla() {
    var b = _baseCam();
    return _ojoCam(b).addScaledVector(b.atras, -ST.dist);
  }

  // ==========================================================================
  // UN PASO DEL ARRASTRE DE GIRO — UN SOLO GIRO, DOS CENTROS.
  //
  // El giro es SIEMPRE el mismo (mesa giratoria: acimut alrededor de +Y del mundo,
  // elevación alrededor de la derecha de la cámara). Lo único que cambia con ctrl es
  // el PUNTO alrededor del cual se hace, que es exactamente lo que pidió el usuario:
  // «¿cómo puede ser que, según dónde yo haga click, haga una rotación un poco
  // distinta?».
  //
  // POR QUÉ EL PIVOTE QUEDA CLAVADO: _girarCamRigido gira el ojo Y la orientación con
  // el MISMO quaternion alrededor de p, así que las coordenadas de p en el sistema de
  // la cámara no cambian ni un bit y p se proyecta en el MISMO píxel. No depende del
  // pan ni de la distancia (medido: 0,000000 px en 60 pasos, con la pieza centrada y
  // con la pieza a 490 px del centro).
  //
  // EL ABSORBEDOR DE PAN SE FUE (20-ago) y hay que decir qué pasa sin él. Corría tras
  // cada pan y cada rueda y dejaba el pivote en lo que quedara AL CENTRO DE LA
  // PANTALLA. Eso es lo que hacía que los dos modos se sintieran iguales: con la
  // pieza centrada, "el centro de la vista" y "la pieza" son el mismo punto (12,7 px
  // de diferencia en todo un gesto; 490 px sólo con la pieza fuera del centro).
  // Estaba puesto para que el giro no "saliera volando" después de panear, y ese
  // efecto hay que mirarlo de frente, porque es GEOMETRÍA y no se arregla escondiendo
  // el pivote: al orbitar, cada cosa en pantalla se mueve tanto como su distancia EN
  // PÍXELES al pivote, multiplicada por el ángulo. O sea:
  //   · lo que está EN el pivote no se mueve (0,000000 px) — y el pivote es el
  //     elemento, que es lo que uno está mirando;
  //   · EL ANTES/DESPUÉS, medido, tras panear el elemento 400×150 px a un costado y
  //     arrastrar 60×4 px: SIN absorbedor el elemento queda clavado (0,000000 px) y
  //     barre el vacío que quedó al centro (540,6 px en todo el gesto, 13,8 px en el
  //     peor paso suelto de 4 px). CON absorbedor era al revés y PEOR: el vacío del
  //     centro quedaba clavado y EL ELEMENTO se iba 914,6 px. O sea que el absorbedor
  //     no evitaba que algo volara: elegía que volara la pieza en vez del vacío;
  //   · el caso feo es el MISMO mecanismo llevado al extremo, y hay que decirlo
  //     completo: cuanto más lejos queda el pivote EN PÍXELES, más barre la imagen.
  //     Con la rueda metida en un detalle lejos del centro del elemento, ese centro
  //     queda a miles de píxeles y un paso de 4 px mueve la imagen 66 px (medido);
  //     con un pan bestial de 5.000 px y sin tocar la rueda, 132 px por paso (medido
  //     por la auditoría). Y con el ojo a centímetros del pivote los puntos que cruzan
  //     el plano de la cámara estallan proyectivamente: números de millones de píxeles
  //     que no son un salto de la cámara sino la perspectiva haciendo lo suyo.
  //     Para eso está el ctrl, que orbita el punto que se está señalando: es el mismo
  //     remedio que da Tekla (marcar el punto) y Revit (seleccionar el elemento), pero
  //     a la vista y a pedido, no a escondidas. Cuando el centro del elemento queda
  //     fuera de cuadro, el editor lo DICE y dibuja el pivote pegado al borde para que
  //     se vea hacia dónde está.
  // ==========================================================================

  var K_GIRO = 0.008;    // rad por píxel de arrastre — el MISMO en los dos modos
  // Tope de elevación: 1,45 rad ≈ 83°. Existe para no llegar al cenit mirando desde
  // arriba (el gesto se vuelve confuso), no por el modelo — el modelo de quaternion
  // ya no tiene ahí ninguna singularidad. Vale para los dos modos: el giro es el
  // mismo y sólo cambia el centro.
  var ELEV_MAX = 1.45;

  // ÓRBITA — la de siempre, alrededor de `p`. Componer el acimut alrededor de +Y del
  // mundo con la elevación alrededor de la derecha (ya girada) da EXACTAMENTE lo que
  // daba `rotY += dAz; rotX += dEl`, porque el quaternion manda la base vieja a la
  // nueva y el ojo se reconstruye con los mismos dist/pan. El tope se aplica al
  // INCREMENTO y no al resultado: recortarlo después descoloca la escena en vez de
  // frenarla.
  // COMO EL EJE DE ACIMUT ES LA VERTICAL DEL MUNDO, el horizonte queda a nivel solo,
  // en los dos modos: cambiar el centro del giro no lo inclina (lo inclinaba el
  // asador, que giraba sobre un eje cualquiera, y por eso ya no hace falta el
  // enderezado progresivo que lo destorcía).
  function _orbitarMundo(dAz, dEl, p) {
    var THREE = global.THREE;
    var b = _baseCam();
    var elev = Math.asin(Math.max(-1, Math.min(1, b.atras.y)));
    dEl = Math.max(-ELEV_MAX - elev, Math.min(ELEV_MAX - elev, dEl));
    if (!dAz && !dEl) return false;
    var qAz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dAz);
    // NORMALIZAR EL EJE NO ES DECORACIÓN: setFromAxisAngle da por hecho que el eje es
    // unitario, y `derecha` sale del quaternion vigente, cuya norma se desvía un
    // poquito en cada paso. Sin normalizar, el error se REALIMENTA (quaternion no
    // unitario → base no unitaria → quaternion peor) y crece al cuadrado: medido por
    // la auditoría en un gesto de elevación, |q|−1 llegaba a 3,1e-7 en 100.000 pasos y
    // a 5,9e-5 en 1.000.000, y con eso el punto clavado se corría 3,1 px y 290,6 px.
    // Con el eje normalizado se queda en el ruido de coma flotante (1e-13).
    var derecha = b.derecha.clone().applyQuaternion(qAz).normalize();
    var q = new THREE.Quaternion().setFromAxisAngle(derecha, -dEl).multiply(qAz);
    return _girarCamRigido(p || ST.target, q);
  }

  // UN PASO DE ARRASTRE alrededor de `pivote` ({x,y,z}; sin él, el centro del
  // elemento). Devuelve:
  //   'pivote' → giró alrededor del punto pedido;
  //   'centro' → ese punto NO servía de pivote (quedó detrás del ojo, encima, o fuera
  //              del rango de distancia de la cámara) y se giró alrededor de lo que
  //              está al centro de la pantalla, para que el gesto no se muera. Es el
  //              mismo criterio de siempre: un pivote imposible se RECHAZA en vez de
  //              recortarse (recortar la distancia hacía saltar la imagen 152 px);
  //   null     → el gesto no movía nada (radial de eje, o ya contra el tope).
  function _girarPorArrastre(dx, dy, pivote) {
    var THREE = global.THREE;
    if (!THREE || !ST.target) return null;
    // EJE RESTRINGIDO (radial X/Y/Z): el incremento se recorta ANTES de girar, así
    // los dos modos usan el MISMO delta y el ctrl no cambia la velocidad del gesto,
    // sólo su centro. Las letras son las visibles del editor (EJE_DISPLAY): acá la
    // vertical se rotula 'Z', igual que en el gizmo.
    //   Z    → sólo el giro de acimut.
    //   X/Y  → sólo el de elevación.
    var eje = ST.ejeRot || 'libre';
    var dAz = (eje === 'libre' || eje === 'z') ? -dx * K_GIRO : 0;
    var dEl = (eje === 'z') ? 0 : dy * K_GIRO;
    if (!dAz && !dEl) return null;
    if (_orbitarMundo(dAz, dEl, pivote || _centroElemento3D())) return 'pivote';
    if (_orbitarMundo(dAz, dEl, _puntoCentroPantalla())) return 'centro';
    return null;
  }

  // ZOOM HACIA EL CURSOR — antes el zoom iba siempre al centro del cuadrante, así
  // que al acercarse el detalle que se estaba mirando se salía de cuadro y había que
  // panear a mano. Se resuelve con el PAN que ya existe, sin raycasting: _applyCam
  // desplaza la cámara con panX·derecha + panY·arriba, que es exactamente el plano
  // de pantalla, así que basta con corregir el pan en la fracción que el punto bajo
  // el cursor se movería. u/v son ese punto en unidades de mundo sobre el plano del
  // pivote (lo que entra en pantalla a la distancia vieja).
  //
  // EL FOV ENTRA ACÁ (y por eso sale de la constante, no de un 38 escrito a mano):
  // lo que entra de alto a la distancia d0 es 2·d0·tan(FOV/2). Si este ángulo y el de
  // la PerspectiveCamera se desincronizan, el punto bajo el cursor deja de quedar
  // clavado y la imagen deriva en cada rueda.
  // fx/fy = cursor DENTRO del cuadrante en [0..1] (0,0 = arriba-izq) · aspect = w/h.
  // Salió del handler de la rueda para poder verificarlo numéricamente sin DOM.
  function _zoomAlCursor(factor, fx, fy, aspect) {
    var d0 = ST.dist;
    ST.dist = _clampDist(ST.dist * factor);
    if (!(d0 > 0) || !(aspect > 0) || !isFinite(fx) || !isFinite(fy)) return;
    var halfH = d0 * Math.tan(FOV3D * Math.PI / 360);
    var halfW = halfH * aspect;
    var u = (fx * 2 - 1) * halfW;
    var v = -(fy * 2 - 1) * halfH;
    // f se calcula DESPUÉS del clamp: con el factor pedido (y no el aplicado) la
    // imagen deriva de a poco cada vez que se llega a un tope.
    var f = ST.dist / d0;
    ST.panX += u * (1 - f);
    ST.panY += v * (1 - f);
  }

  // AL SOLTAR EL CTRL: el pivote guardado vuelve al centro del elemento, SIN MOVER UN
  // PÍXEL (0,000000 px medido). No es cosmético: `dist` es la distancia AL PIVOTE y de
  // ella salen la velocidad del pan y el paso de la rueda, así que dejándola clavada
  // en un punto cualquiera de una barra el pan siguiente iba a otra velocidad.
  // LA SEGUNDA CAÍDA existe por el piso que se le quitó al pivote: si el ctrl agarró
  // algo a 3 cm del ojo, `dist` queda en 3 y el pan y la rueda se vuelven inservibles
  // (el paso de la rueda se multiplica, así que de 3 no sale). Si el centro del
  // elemento no sirve para volver (quedó detrás del ojo), se pivota en el punto del
  // EJE DE VISTA a una distancia con la que la cámara sabe vivir: tampoco mueve la
  // imagen, y deja el estado utilizable.
  function _restaurarPivoteGuardado() {
    // …y el centro del elemento tampoco vale si deja `dist` por debajo del mínimo, que
    // es lo que pasa con el elemento casi encima del ojo (medido: 0,6 cm). Devolver el
    // pivote no sirve de nada si deja la cámara igual de inservible que como estaba.
    if (_pivotarEnSinMover(_centroElemento3D()) && ST.dist >= DIST_MIN) return true;
    var b = _baseCam();
    return _pivotarEnSinMover(_ojoCam(b).addScaledVector(b.atras, -_clampDist(ST.dist)));
  }

  // ==========================================================================
  // EL PIVOTE, DIBUJADO — el punto rosado de Tekla (20-ago).
  //
  // POR QUÉ ES OBLIGATORIO Y NO UN ADORNO: sin él, "alrededor de qué gira la cámara"
  // es invisible, y esta función ya se volvió indemostrable a ojo dos veces seguidas
  // (dos entregas en que el usuario no vio ninguna diferencia y hubo que medirla
  // headless para descubrir que, efectivamente, no la había). Con el punto en
  // pantalla, el usuario y quien programa ven lo mismo.
  //
  // VA COMO <div> ABSOLUTO dentro del .te-vista.d3, no como objeto de la escena:
  //   · un sprite en el mundo cambia de tamaño con la distancia y hay que recalcular
  //     su escala por frame;
  //   · obligaría a tener THREE cargado para dibujar un punto;
  //   · su posición sale de _proyectarEnCuadrante, que se mide en los tests — un
  //     objeto de la escena habría que verificarlo mirando.
  // Si el pivote cae FUERA del cuadrante, el punto se pega al borde (hueco) en vez de
  // desaparecer: así se ve HACIA DÓNDE está el centro del giro, que es justo lo que
  // hay que saber cuando el gesto se siente raro. Detrás de la cámara se esconde: la
  // proyección se da vuelta y el borde que marcaría sería el equivocado.
  // ==========================================================================
  function _dibujarPivote(p, esPunto) {
    var v = document.querySelector('#te_quad .te-vista.d3'); if (!v) return false;
    var el = v.querySelector('.te-pivote');
    if (!el) { el = document.createElement('div'); el.className = 'te-pivote'; v.appendChild(el); }
    var r = v.getBoundingClientRect();
    var pr = _proyectarEnCuadrante(p, r.width, r.height);
    if (!pr) { el.className = 'te-pivote'; return true; }
    var m = 8;                                    // el radio del punto: que no se corte
    var px = Math.max(m, Math.min(r.width - m, pr.px));
    var py = Math.max(m, Math.min(r.height - m, pr.py));
    var fuera = (Math.abs(px - pr.px) > 0.5 || Math.abs(py - pr.py) > 0.5);
    el.style.left = px.toFixed(1) + 'px';
    el.style.top = py.toFixed(1) + 'px';
    el.className = 'te-pivote on' + (esPunto ? ' pto' : '') + (fuera ? ' fuera' : '');
    return fuera;
  }

  function _ocultarPivote() {
    var v = document.querySelector('#te_quad .te-vista.d3'); if (!v) return;
    var el = v.querySelector('.te-pivote'); if (el) el.className = 'te-pivote';
  }

  // BUG 4 — PAN del 3D rotaba en vez de panear. Rediseño del reparto de botones con un
  // ÚNICO estado 'mode' ('pan' | 'rot' | null) fijado en el mousedown, mutuamente
  // exclusivo (antes había 2 flags drag/panning que podían quedar mal). Reparto:
  //   · botón IZQUIERDO sin modificador     → ROTAR en torno al CENTRO DEL ELEMENTO
  //   · CTRL/⌘ + izquierdo                  → ROTAR en torno al PUNTO SEÑALADO
  //   · botón MEDIO, botón DERECHO, o SHIFT/ALT+izq → PAN
  //
  // EL CTRL, SEXTA VUELTA (20-ago). Las cuatro primeras movieron el pivote a la
  // PIEZA y no se notaban (el absorbedor dejaba el pivote normal en el centro de la
  // pantalla, que es donde uno tiene la pieza: 12,7 px de diferencia en todo el
  // gesto). La quinta cambió el EJE —el asador— y eso NUNCA fue lo que se pidió. Esta
  // vuelta hace lo que dicen Revit y Tekla, y lo que dijo el usuario: el mismo giro
  // de siempre, alrededor de OTRO PUNTO. Y ahora se ve, porque el pivote se dibuja.
  //
  // CUÁNDO SE ELIGE EL PUNTO: al ENTRAR el ctrl (en el mousedown si ya venía apretado,
  // o en el mousemove donde se apretó), con el cursor de ESE instante — es el «según
  // dónde yo haga click». Y no se vuelve a tocar hasta soltarlo: si se recalculara en
  // cada mousemove, el pivote seguiría al cursor y el punto señalado NO quedaría
  // clavado, que es todo el contrato del modo. Al soltar el ctrl se olvida (no es
  // pegajoso entre gestos, a diferencia del de Tekla).
  //
  // El mousedown captura el botón real (e.button) Y los modificadores del PROPIO evento
  // (no de un mousemove posterior, que podía llegar sin shift y caer a rotar). El middle
  // click además necesita preventDefault en 'mousedown' Y 'auxclick' para matar el
  // autoscroll del navegador (que se tragaba los mousemove y hacía que "no paneara").
  function _bindOrbita(cv) {
    var mode = null, lx = 0, ly = 0;
    // pivCtrl = {p, fuente} mientras el ctrl esté apretado; null = giro normal.
    var pivCtrl = null;
    // ÚLTIMO AVISO DICHO, no un "ya avisé": el mousemove llega decenas de veces por
    // segundo y hay que repetir sólo cuando la cosa CAMBIA. Con una bandera booleana
    // —como estaba— un gesto que empieza bien y a mitad topa con un pivote imposible
    // se comía el aviso de eso último (lo cazó la auditoría): el usuario veía saltar la
    // imagen sin ninguna explicación.
    var ultimoAviso = '';
    var MSG = {
      barra: 'Giro alrededor del punto de la barra que señalaste: ese punto queda clavado y todo lo demás gira a su alrededor.',
      plano: 'Giro alrededor del punto que señalaste: queda clavado, aunque no haya fierro debajo.',
      elemento: 'No había geometría bajo el cursor ni barra seleccionada: se gira alrededor del centro del elemento, igual que sin ctrl.'
    };

    // Cursor DENTRO del cuadrante, en fracciones [0..1] + el tamaño en píxeles: es lo
    // que piden el picking y la proyección (la misma convención del zoom a la rueda).
    function _pivoteEnEvento(e) {
      var r = cv.getBoundingClientRect();
      if (!(r.width > 1 && r.height > 1)) return { p: _centroElemento3D(), fuente: 'elemento' };
      return _pivoteDelCursor((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, r.width, r.height);
    }

    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });   // botón der = pan, no menú
    cv.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });   // mata autoscroll medio
    cv.addEventListener('mousedown', function (e) {
      lx = e.clientX; ly = e.clientY;
      // PAN si: botón medio (1) · botón derecho (2) · o izquierdo con ALT.
      // SHIFT SE FUE DE ACÁ (20-ago). Las vistas 2D ya se lo habían quitado el
      // 19-ago; el 3D era el último que lo tenía, y como el atajo de las cotas
      // escucha el keydown a nivel de DOCUMENTO, panear el 3D con shift prendía de
      // paso los rótulos de las cuatro vistas. Quedan medio, derecho y alt, que son
      // los gestos que el usuario ya usaba.
      var quierePan = (e.button === 1 || e.button === 2 || e.altKey);
      if (e.button === 0 && !quierePan) mode = 'rot';   // con o sin ctrl: rotar
      else mode = quierePan ? 'pan' : null;
      if (mode === 'rot') {
        pivCtrl = (e.ctrlKey || e.metaKey) ? _pivoteEnEvento(e) : null;
        ultimoAviso = '';
        // se dibuja YA, antes de mover un píxel: el usuario ve dónde va a quedar
        // clavado el giro antes de arrastrar.
        _dibujarPivote(pivCtrl ? pivCtrl.p : _centroElemento3D(), !!pivCtrl);
      }
      if (mode) e.preventDefault();
    });
    global.addEventListener('mouseup', function () {
      if (mode === 'rot') {
        _ocultarPivote();
        // El pivote del ctrl vive SÓLO mientras dura el gesto (ver
        // _restaurarPivoteGuardado: no mueve la imagen y devuelve `dist` a la del
        // elemento, que es de donde salen el pan y el paso de la rueda).
        if (pivCtrl) _restaurarPivoteGuardado();
      }
      pivCtrl = null; ultimoAviso = '';
      mode = null;
    });
    // LA VENTANA PIERDE EL FOCO A MITAD DE UN ARRASTRE (alt+tab, un diálogo del
    // navegador): no llega ningún mouseup más, así que el gesto quedaba abierto y el
    // punto del pivote se quedaba pegado en pantalla con coordenadas viejas (lo cazó
    // la auditoría). Se cierra igual que un mouseup.
    global.addEventListener('blur', function () {
      if (mode === 'rot') { _ocultarPivote(); if (pivCtrl) _restaurarPivoteGuardado(); }
      pivCtrl = null; ultimoAviso = ''; mode = null;
    });
    global.addEventListener('mousemove', function (e) {
      if (!mode) return;
      var dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (mode === 'pan') {
        ST.panX -= dx * ST.dist * 0.0011; ST.panY += dy * ST.dist * 0.0011;
      } else {   // rot
        // El modificador se lee del PROPIO mousemove (no del mousedown) para poder
        // apretarlo y soltarlo A MITAD del gesto: se encuadra con el giro normal y se
        // remata girando sobre un punto, sin soltar el botón.
        var conCtrl = !!(e.ctrlKey || e.metaKey);
        if (!conCtrl && pivCtrl) { pivCtrl = null; ultimoAviso = ''; }
        else if (conCtrl && !pivCtrl) { pivCtrl = _pivoteEnEvento(e); ultimoAviso = ''; }
        var piv = pivCtrl ? pivCtrl.p : _centroElemento3D();
        var res = _girarPorArrastre(dx, dy, piv);
        // se dibuja EL PIVOTE QUE SE USÓ, no el que se pidió: cuando el pedido se
        // rechaza (res = 'centro'), pintar el pedido sería dibujar una mentira justo
        // en el caso raro, que es cuando más falta hace ver la verdad.
        var fuera = _dibujarPivote(res === 'centro' ? _puntoCentroPantalla() : piv, !!pivCtrl && res !== 'centro');
        // La barra de estado dice la VERDAD de lo que acaba de pasar: es la única
        // señal escrita de qué punto agarró el gesto.
        var msg = null;
        if (res === 'centro') {
          msg = pivCtrl
            ? 'Ese punto no sirve de pivote (quedó detrás del ojo): se gira alrededor de lo que está al centro de la pantalla.'
            : 'El centro del elemento quedó DETRÁS de la cámara: se gira alrededor de lo que está al centro de la pantalla (⟳ recentra).';
        } else if (res && pivCtrl) msg = MSG[pivCtrl.fuente];
        else if (res && fuera) msg = 'El giro normal orbita el CENTRO DEL ELEMENTO, que ahora quedó fuera de cuadro (el punto rosado del borde marca hacia dónde): ⟳ recentra, y ctrl+arrastre gira sobre el punto que señales.';
        // GESTO MUDO: con un eje fijado en el radial, media dirección de arrastre no
        // hace nada. Sin decirlo, el usuario ve el punto del pivote, arrastra y no pasa
        // NADA — parece que el editor se colgó (lo cazó la auditoría).
        else if (!res && (ST.ejeRot || 'libre') !== 'libre') {
          msg = 'El eje ' + String(ST.ejeRot).toUpperCase() + ' está fijado: este arrastre no gira nada (prueba en la otra dirección, o apaga el eje).';
        }
        if (msg && msg !== ultimoAviso) { ultimoAviso = msg; _actualizarStatus(msg); }
      }
      _marcarSucio();   // PERF: la cámara 3D cambió → repintar
    });
    // ZOOM HACIA EL CURSOR — la matemática vive en _zoomAlCursor (arriba); acá sólo
    // se traduce el evento a fracciones del cuadrante.
    // ACÁ COLGABA EL ABSORBEDOR DE PAN (un timer que, tras el silencio que cierra el
    // gesto de rueda, mudaba el pivote a lo que hubiera quedado al centro de la
    // pantalla). Se fue con él: el pivote ya no es estado que se ensucia solo, se
    // elige en cada gesto (centro del elemento, o el punto señalado con ctrl).
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = cv.getBoundingClientRect();
      var hayRect = (r.width > 1 && r.height > 1);
      _zoomAlCursor(_factorZoomRueda(e),
        hayRect ? (e.clientX - r.left) / r.width : 0.5,
        hayRect ? (e.clientY - r.top) / r.height : 0.5,
        hayRect ? (r.width / r.height) : 0);
      _marcarSucio();
    }, { passive: false });
  }

  // ==========================================================================
  // LUPA — MAXIMIZAR UN CUADRANTE (18-ago). Vale para los 4 (el 3D y las 3 orto).
  //
  // El layout lo hace SOLO el CSS (#te_quad.te-maxon): los otros 3 cuadrantes se
  // ocultan y el elegido ocupa las 2 filas × 2 columnas. #te_quad NO cambia de
  // tamaño, así que el canvas del renderer —que lo cubre entero— tampoco: _resize
  // no tiene nada que hacer y no se le pide nada.
  //
  // Lo que sí cambia son los RECTS de las vistas, y ahí hay dos mundos distintos:
  //   · el RENDER (3D y las 3 orto) lee el rect de cada .te-vista por frame
  //     (_render3DQuad / _renderVistasOrto), así que se adapta solo; los cuadrantes
  //     ocultos miden 0 y sus pases se saltan con el `if (w < 2 || h < 2)` que ya
  //     estaba.
  //   · el OVERLAY SVG NO: su transform sale de la cámara orto encuadrada con el
  //     ASPECTO del cuadrante (_transformDesdeCamara → _encuadrarOrto). Maximizar
  //     cambia ese aspecto de golpe, y sin re-emitirlo el hit-testing, los nodos y
  //     la flecha de rango quedan corridos respecto de lo que se ve dibujado.
  //     Por eso el _sincronizarOverlayOrto() del final: es obligatorio, no cosmético.
  // ==========================================================================
  function _vistaMaximizada() {
    var quad = $('te_quad');
    return quad ? quad.querySelector('.te-vista.te-max') : null;
  }

  // vista = el .te-vista a maximizar · null (o la que ya estaba) = volver a los 4.
  function _maximizarVista(vista) {
    var quad = $('te_quad'); if (!quad) return;
    var destino = (vista && vista !== _vistaMaximizada()) ? vista : null;
    Array.prototype.forEach.call(quad.querySelectorAll('.te-vista'), function (v) {
      var esta = (v === destino);
      v.classList.toggle('te-max', esta);
      var b = v.querySelector('.te-vzoom');
      if (!b) return;
      b.classList.toggle('on', esta);
      // 🔍 = agrandar · ⤡ = volver. La flecha diagonal en vez de otro emoji porque el
      // estado ya lo canta el fondo verde (.on) y hace falta un icono que se LEA como
      // "encoger", no como una segunda lupa.
      b.textContent = esta ? '⤡' : '🔍';
      b.title = esta ? 'Volver a los 4 cuadrantes (Esc)' : 'Agrandar este cuadrante';
    });
    quad.classList.toggle('te-maxon', !!destino);
    _marcarSucio();               // render-on-demand: los viewports cambiaron de rect
    _sincronizarOverlayOrto();    // …y el overlay SVG hay que recalcularlo (ver la nota)
    _actualizarStatus(destino
      ? 'Cuadrante agrandado — la lupa o Esc vuelven a los 4.'
      : 'De vuelta a los 4 cuadrantes.');
  }

  function _bindLupas() {
    var quad = $('te_quad'); if (!quad) return;
    Array.prototype.forEach.call(quad.querySelectorAll('.te-vzoom'), function (b) {
      if (b._teBound) return;
      b._teBound = true;
      // El botón es HERMANO del SVG overlay y vive dentro del .te-vista, que es donde
      // se cablean el pan de las orto y la órbita del 3D: sin cortar el mousedown, un
      // clic en la lupa arrancaba un arrastre de cámara.
      b.addEventListener('mousedown', function (e) { e.stopPropagation(); });
      b.addEventListener('click', function (e) {
        e.stopPropagation(); e.preventDefault();
        var v = b.parentNode;
        _maximizarVista((v && v.classList.contains('te-vista')) ? v : null);
      });
    });
  }

  // El canvas del renderer cubre TODA la grilla te_quad (para pintar los 4
  // cuadrantes con viewport+scissor). Se posiciona absoluto sobre te_quad, DEBAJO
  // de los canvas/SVG de cada cuadrante (que quedan como marco/overlay).
  function _resize() {
    if (!ST.renderer) return;
    var cv = $('te_cv'); if (!cv) return;
    var quad = $('te_quad'); if (!quad) return;
    var w = quad.clientWidth || 600, h = quad.clientHeight || 400;
    // estirar el canvas del renderer sobre toda la grilla (una sola vez por tamaño)
    if (cv.parentElement !== quad) {
      quad.appendChild(cv);
      cv.style.position = 'absolute'; cv.style.left = '0'; cv.style.top = '0';
      cv.style.width = '100%'; cv.style.height = '100%'; cv.style.zIndex = '0';
      cv.style.display = 'block'; cv.style.pointerEvents = 'none';
    }
    if (ST._quadW !== w || ST._quadH !== h) {
      ST.renderer.setSize(w, h, false);
      ST.renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
      ST._quadW = w; ST._quadH = h;
      _marcarSucio();               // PERF (render-on-demand): un resize obliga a repintar
      _sincronizarOverlayOrto();    // cambió el rect de las vistas → transforms nuevos
    }
  }

  // Renderiza el cuadrante 3D (perspectiva) en SU rectángulo con scissor. El resto
  // del canvas grande lo pintan las vistas ortográficas.
  // Color de fondo de la escena, reutilizando el THREE.Color que ya existe (crear uno
  // nuevo por frame sería basura para el GC en un loop que puede pintar a 60 fps).
  function _fondoEscena(hex) {
    var THREE = global.THREE;
    if (!THREE || !ST.scene) return;
    if (ST.scene.background && ST.scene.background.isColor) ST.scene.background.setHex(hex);
    else ST.scene.background = new THREE.Color(hex);
  }

  function _render3DQuad() {
    // El TEMA se aplica en ESTE pase porque la escena es UNA sola y su background lo
    // comparten los 4 viewports: cada pase lo fija antes de dibujar. Desde el 18-ago
    // el valor es el mismo en los cuatro — ver la nota de _renderVistasOrto.
    _fondoEscena(_tema3D().bg);
    var d3 = document.querySelector('#te_quad .te-vista.d3');
    if (!d3) { _applyCam(); ST.renderer.render(ST.scene, ST.camera); return; }
    var r = d3.getBoundingClientRect();
    var full = ST.renderer.domElement.getBoundingClientRect();
    var w = r.width, h = r.height; if (w < 2 || h < 2) return;
    var x = r.left - full.left, y = full.height - ((r.top - full.top) + h);
    ST.camera.aspect = w / h; ST.camera.updateProjectionMatrix();
    _applyCam();
    ST.renderer.setViewport(x, y, w, h);
    ST.renderer.setScissor(x, y, w, h);
    ST.renderer.setScissorTest(true);
    ST.renderer.render(ST.scene, ST.camera);
    ST.renderer.setScissorTest(false);
  }

  // ==========================================================================
  // B4·(b) — GIZMO 3D tipo modelador (triad de ejes que SIGUE a la cámara).
  //
  // Escena secundaria mínima (3 ArrowHelper + letras como sprites) con su propia
  // cámara, renderizada al FINAL del pase 3D en un viewport chico (~64×64) de la
  // esquina inf-izq del cuadrante 3D, con el MISMO renderer (setViewport+setScissor,
  // patrón ya usado por las vistas orto). La cámara del gizmo copia la ORIENTACIÓN de
  // la cámara perspectiva (misma dirección, distancia fija) → el triad gira igual que
  // el modelo. Antes del pase se limpia el DEPTH (clearDepth) para que el gizmo se
  // dibuje ENCIMA del 3D, y se anulan los clippingPlanes.
  // THREE se resuelve DENTRO de la función (regla dura 1).
  // ==========================================================================
  var GIZMO_PX = 96;

  function _initGizmo3D() {
    var THREE = global.THREE;
    if (!THREE || ST.gizmo) return ST.gizmo;
    var esc = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    var L = 1;                                   // largo del eje en unidades del gizmo
    // Las DIRECCIONES son las del mundo interno (x,y,z) y NO cambian; solo la
    // letra y el color, que siguen al reetiquetado visual (EJE_DISPLAY).
    var ejes = [
      { v: new THREE.Vector3(1, 0, 0), c: _ejeColor('x'), t: _ejeLetra('x') },
      { v: new THREE.Vector3(0, 1, 0), c: _ejeColor('y'), t: _ejeLetra('y') },
      { v: new THREE.Vector3(0, 0, 1), c: _ejeColor('z'), t: _ejeLetra('z') }
    ];
    var origen = new THREE.Vector3(0, 0, 0);
    ejes.forEach(function (e) {
      esc.add(new THREE.ArrowHelper(e.v, origen, L, new THREE.Color(e.c).getHex(), 0.3, 0.18));
      var sp = _spriteLetra(e.t, e.c);
      if (sp) { sp.position.copy(e.v).multiplyScalar(L * 1.34); esc.add(sp); }
    });
    ST.gizmo = { escena: esc, cam: cam };
    return ST.gizmo;
  }

  // Letra del eje como Sprite (canvas 64×64) — siempre mira a la cámara.
  function _spriteLetra(txt, color) {
    var THREE = global.THREE;
    if (!THREE || !THREE.Sprite) return null;
    var cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    var g2 = cv.getContext('2d');
    g2.font = 'bold 46px "Segoe UI",system-ui,sans-serif';
    g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.lineWidth = 6; g2.strokeStyle = 'rgba(255,255,255,.95)';
    g2.strokeText(txt, 32, 34);
    g2.fillStyle = color; g2.fillText(txt, 32, 34);
    var tex = new THREE.CanvasTexture(cv);
    var mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    var sp = new THREE.Sprite(mat);
    sp.scale.set(0.62, 0.62, 1);
    return sp;
  }

  // Pinta el gizmo en la esquina inf-izq del cuadrante 3D (tras el pase 3D).
  function _renderGizmo3D() {
    if (!global.THREE || !ST.renderer || !ST.camera) return;
    var gz = _initGizmo3D(); if (!gz) return;
    var d3 = document.querySelector('#te_quad .te-vista.d3'); if (!d3) return;
    var r = d3.getBoundingClientRect();
    if (r.width < GIZMO_PX + 10 || r.height < GIZMO_PX + 10) return;
    var full = ST.renderer.domElement.getBoundingClientRect();
    var pad = 8;
    var x = (r.left - full.left) + pad;
    var y = full.height - ((r.top - full.top) + r.height) + pad;   // esquina INFERIOR
    // la cámara del gizmo copia la ORIENTACIÓN de la perspectiva a distancia fija →
    // mismo giro, tamaño constante.
    // Distancia 4.4 (no 3.4): con fov 42 el half-extent a 3.4 era ~1.30 y las letras
    // viven a 1.34·L → la Y/Z quedaban FUERA del frustum ("solo se ve la X").
    // La ORIENTACIÓN se copia entera (quaternion), no se reconstruye con lookAt: el
    // triad tiene que decir lo que la cámara HACE, no lo que un lookAt supondría.
    var b = _baseCam();
    gz.cam.position.copy(b.atras.multiplyScalar(4.4));
    gz.cam.quaternion.copy(_quatCam());
    gz.cam.aspect = 1; gz.cam.updateProjectionMatrix();
    ST.renderer.clippingPlanes = [];              // el gizmo NUNCA se corta
    ST.renderer.setViewport(x, y, GIZMO_PX, GIZMO_PX);
    ST.renderer.setScissor(x, y, GIZMO_PX, GIZMO_PX);
    ST.renderer.setScissorTest(true);
    // autoClear OFF: el gizmo se COMPONE encima del 3D ya pintado (si se dejara en
    // true, el pase borraría el color de ese rectángulo y el gizmo quedaría sobre un
    // cuadrado de fondo). Sólo se limpia el DEPTH para que el triad no lo tape el 3D.
    var auto = ST.renderer.autoClear;
    ST.renderer.autoClear = false;
    ST.renderer.clearDepth();
    ST.renderer.render(gz.escena, gz.cam);
    ST.renderer.autoClear = auto;
    ST.renderer.setScissorTest(false);
  }

  // ==========================================================================
  // PERF (F0·iv) — RENDER ON DEMAND.
  // El loop pintaba 4 viewports (3 orto + 3D) a 60 fps SIEMPRE, aunque nada cambiara:
  // con un elemento grande eso mantiene la GPU al 100% sin razón. Ahora sólo se
  // repinta si algo lo pide: ST.dirty. Lo marcan cámara/pan/zoom/slider/selección/
  // regeneración/resize (_marcarSucio). El rAF sigue corriendo (es barato) pero sin
  // trabajo de GPU cuando la escena está quieta.
  // ==========================================================================
  function _marcarSucio() { ST.dirty = true; }

  function _loop() {
    ST.rafId = global.requestAnimationFrame(_loop);
    var bd = $('te_backdrop');
    if (!bd || !bd.classList.contains('on')) return;
    _resize();                       // marca dirty si el tamaño cambió
    if (!ST.dirty) return;           // nada cambió → no gastar GPU
    ST.dirty = false;
    // grid + plano de corte P3 solo en el 3D: en las vistas orto MOLESTAN (el plano
    // se ve de frente como un rectángulo azul tapando la sección; el grid ensucia).
    // Se ocultan al pintar las orto y se re-muestran para el 3D. (Mismo patrón grid.)
    if (ST.grid) ST.grid.visible = true;
    if (ST.planoMesh) ST.planoMesh.visible = true;
    _render3DQuad();
    _renderGizmo3D();                // B4·b — triad de ejes sobre el cuadrante 3D
    if (ST.grid) ST.grid.visible = false;
    if (ST.planoMesh) ST.planoMesh.visible = false;
    _renderVistasOrto();
    if (ST.grid) ST.grid.visible = true;
    if (ST.planoMesh) ST.planoMesh.visible = true;
  }

  function _mostrarWebglMsg() {
    var m = $('te_webglMsg'), cv = $('te_cv'), fb = $('te_svgFallback');
    if (m) m.style.display = 'flex';
    if (cv) cv.style.display = 'none';
    if (fb) fb.style.display = 'none';
  }

  function _iniciar3dEnVivo() {
    if (ST.threeCargado) {
      if (ST.webglOk && ST.ultimoOut) _redibujar(ST.ultimoOut);
      else if (ST.webglOk === false) _mostrarWebglMsg();
      return;
    }
    cargarThree().then(function (ok) {
      ST.threeCargado = true;
      if (!ok || !global.THREE) { _mostrarWebglMsg(); return; }
      var iniciado = _initEscena();
      if (!iniciado || !ST.webglOk) { _mostrarWebglMsg(); return; }
      var cv = $('te_cv'), fb = $('te_svgFallback');
      if (cv) cv.style.display = 'block';
      if (fb) fb.style.display = 'none';
      if (ST.ultimoOut) _redibujar(ST.ultimoOut);
      _resize();
      // Ahora ortoActivo=true: RE-dibujar las vistas 2D para LIMPIAR el SVG plano que
      // se pintó durante el arranque (cuando ortoActivo aún era false) y quedaba
      // encima del render orto ("Paint pegado"). Con ortoActivo=true el SVG solo deja
      // el overlay (sin hormigón ni barras).
      if (ST.ultimoOut) _redibujar2D(ST.ultimoOut);
      global.console && console.log('[Template Editor] 3D iniciado · placements:', (ST.ultimoOut && ST.ultimoOut.placements || []).length);
    });
  }

  // ==========================================================================
  // ABRIR / CERRAR
  // ==========================================================================
  function _bindUI() {
    if (ST._uiOk) return;
    var root = $('te_modal'); if (!root) return;
    ST._uiOk = true;
    _bindElemSel();              // selector de ELEMENTO del titlebar
    _bindNombre();               // campo NOMBRE editable del titlebar
    _bindRibbon();
    _bindHerramientas();
    _bindVistas();
    _bindTeclado();
    _bindWarnTamano();           // ✕ del banner anti-colapso
    _bindBorrador();             // [Recuperar] / [Descartar] de la barra de borrador
    _bindBarras();               // sección colapsable "📋 Barras" (despiece)
    _bindLupas();                // 🔍 por cuadrante — maximizar / volver a los 4
    _actualizarTitulosVista();   // BUG 8: títulos + GIZMO gráfico de ejes por vista
    _setQuadCursor();
    // Al redimensionar la ventana, el overlay de voltear se re-pega a la pieza.
    if (!ST._resizeBtnBound) {
      ST._resizeBtnBound = true;
      global.addEventListener('resize', function () {
        var bd = $('te_backdrop');
        if (!(bd && bd.classList.contains('on'))) return;
        _posicionarFlipBtn();
        // …y el ribbon vuelve a medirse: achicar la ventana puede obligar al plan B
        // (etiquetas de tipología fuera) y agrandarla tiene que devolverlas.
        _ajustarRibbonUnaLinea();
      });
    }
  }

  // PUERTA DE ENTRADA ÚNICA (19-ago) — al editor se entra SÓLO desde el Gestor de
  // templates del tab (Catálogo › Template Editor): "Crear template" (tplCrearTemplate)
  // o "Abrir" de una fila de la lista (tplAbrirTemplate). No hay otra forma.
  //   cfg = { elemento, nombre, dims, receta?, templateId?, obra?, puedeModificar? }
  //   · Sin receta ("Crear"): hormigón listo desde dims y CERO componentes.
  //   · Con receta ("Abrir"): la guardada, normalizada al abrir.
  // ANTES existía una segunda puerta: llamar sin argumentos abría el editor con la
  // semilla de viga hardcodeada ("Viga tipo Explora"), sin nombre y sin templateId —
  // un template fantasma que no salía de la lista y que al guardar creaba una copia
  // huérfana. Nadie la usaba (ni la UI ni los tests) y se retiró: quien llame mal
  // ahora no abre nada y lo dice, en vez de abrir algo que el usuario no pidió.
  global.templateEditorAbrir = function (cfg) {
    var bd = $('te_backdrop');
    if (!bd) { alert('El Template Editor aún se está cargando. Reintenta en un momento.'); return; }
    if (!cfg || !cfg.elemento) {
      // No es un caso de usuario: es un llamado mal hecho desde el código. Se avisa
      // por consola y NO se abre (abrir "algo" sería inventarle un template).
      if (global.console && global.console.warn) {
        global.console.warn('[TE] templateEditorAbrir necesita { elemento, … }: se entra desde el Gestor de templates.');
      }
      return;
    }
    ST.elemento = String(cfg.elemento).toLowerCase();
    ST.nombre = (cfg.nombre || '').trim();
    ST.templateId = (cfg.templateId != null) ? cfg.templateId : null;
    ST.obra = (cfg.obra != null) ? cfg.obra : null;
    // Sin dato explícito se asume que SÍ (un template nuevo es de quien lo crea);
    // el backend manda el valor real al abrir uno de la biblioteca.
    ST.puedeModificar = (cfg.puedeModificar === false) ? false : true;
    // MODO OBRA — el contexto de despiece entra POR LA PUERTA (decision 1 del
    // usuario): no hay rama, ni fork, ni modal paralelo. Si no viene, las tres
    // variables quedan apagadas y el editor es EXACTAMENTE el de la biblioteca.
    ST.ctxObra = (cfg.ctxObra && cfg.ctxObra.loteId) ? cfg.ctxObra : null;
    ST.piso = (cfg.piso != null) ? String(cfg.piso) : '';
    ST.instanciaId = (cfg.instanciaId != null) ? cfg.instanciaId : null;
    // De que template de la biblioteca salio esta estructura (solo TRAZA). NO se
    // reusa como ST.templateId: en modo obra el hormigon se ajusta a lo REAL y un
    // PUT con esa geometria corromperia el template de la biblioteca.
    ST.tplOrigen = (cfg.tplOrigen != null) ? cfg.tplOrigen : null;
    if (cfg.receta) {
      // "Abrir": receta guardada (params del backend), clonada para no mutar la fuente.
      ST.receta = JSON.parse(JSON.stringify(cfg.receta));
      // NORMALIZADOR DE APERTURA (reglas.normalizarReceta): deja cada componente
      // con la vista canónica que el motor de hoy espera, DERIVADA de lo que la
      // receta ya decía, y marca lo que no se pudo derivar (figura que el catálogo
      // ya no tiene, dims sin medida…). Va ANTES del primer _renderPanel para que
      // la lista de barras ya nazca con las marcas puestas.
      _normalizarRecetaViva();
    } else {
      // "Crear": SIEMPRE rectángulo de hormigón desde dims + componentes vacíos.
      var geo = {}, src = cfg.dims || {};
      for (var k in src) if (src.hasOwnProperty(k)) geo[k] = Number(src[k]);
      geo.contorno = null;
      ST.receta = { tipo: ST.elemento, geometria: geo, componentes: [] };
    }
    if (!ST.receta.tipo) ST.receta.tipo = ST.elemento;
    ST.selCi = -1; ST.selExtra = []; ST.ultimoOut = null;
    ST.dragMove = null; ST.dragMarco = null; ST.dragRango = null;
    ST.espejoPend = false;   // abrir otra receta no puede dejar un espejo a medias
    // Asegurar el flag de distribución en la semilla (estribo/traba ya distribuidos).
    (ST.receta.componentes || []).forEach(function (c) {
      var rol = _rolComp(c);
      if (rol !== 'cabezal' && c.distribucion && c.distribucion.zonas && c.distribucion.activa == null) c.distribucion.activa = true;
    });
    // Dirty-tracking: el baseline NO se puede sellar aquí. _regenerar() (más abajo)
    // NORMALIZA la receta al generar — rellena sep/zonas/rango/activa —, así que un
    // sello previo quedaba distinto del estado real y abrir+cerrar SIN TOCAR NADA
    // preguntaba "hay cambios sin guardar". Se sella DESPUÉS de la 1ª regeneración.
    // Mientras tanto queda en null = "no hay nada que comparar" (sin falsos dirty).
    ST._recetaGuardada = null;
    ST._nombreGuardado = null;
    ST._guardando = false;    // una apertura cancela cualquier "Guardando…" colgado
    _ocultarBarraBorrador();
    bd.classList.add('on');
    _actualizarTitulos();
    _renderElemSel();   // el selector del titlebar apunta al elemento de ESTE template
    _renderRibbonTips();
    _renderFigsRapidas();   // matriz 2×5 del ribbon (se repinta cuando llega el catálogo real)
    _actualizarBtnGuardar();
    var se = $('te_saveErr'); if (se) se.textContent = '';
    _bindUI();
    // CATÁLOGO DE FIGURAS: pide el real (GET /figuras-catalogo) y refresca el
    // datalist + la validación del campo Figura. Es asíncrono: hasta que llegue
    // manda el espejo estático del módulo, y si la red falla se queda con él.
    _cargarCatalogoFiguras();
    // CONFIGURACIÓN (figura/φ de partida, @sep, modo, sugeridas, recubrimientos).
    // Mismo trato que el catálogo: asíncrona, y hasta que llegue mandan las constantes.
    _cargarConfigModelador();
    // El ELEMENTO puede cambiar entre aperturas (viga → muro): las 3 cosas que
    // dependen de él se rehacen aquí, no en _bindUI (que corre una sola vez).
    _renderRibbonGeo();        // campos del grupo HORMIGÓN de ESTE elemento
    _refrescarDefsOrto();      // cada cámara orto vuelve a leer el def de su plano
    _actualizarTitulosVista(); // títulos (SECCIÓN/ELEVACIÓN/PLANTA) + gizmo de ejes
    _sincronizarRibbonGeo();   // el grupo HORMIGÓN del ribbon refleja la receta
    _aplicarModoObra();        // grupo DESPIECE del ribbon + botón "Cargar al despiece"
    _marcarSucio();     // PERF (render-on-demand): al abrir siempre hay que pintar
    // Undo limpio por sesión. Se ABRE SIEMPRE en SELECCIONAR: colocar es un modo
    // explícito ("＋ Agregar barra"), nunca el estado inicial.
    ST.undoStack = [];
    ST.cargado = null;
    _activarHerramienta('mover');
    _renderPanel();
    _regenerar();
    // AHORA sí: la receta ya pasó por el motor (normalizada) → este es el estado
    // "recién abierto" contra el que se comparan los cambios del usuario.
    _sellarGuardado();
    _actualizarBtnGuardar();   // recién ahora se sabe si hay algo que guardar
    // LO QUE EL NORMALIZADOR NO PUDO DERIVAR se dice al abrir (figura que el
    // catálogo ya no tiene, dim sin medida…). Va después del sello para no
    // confundirse con un cambio del usuario, y antes de la barra de borrador.
    _avisarMigracion();
    // ¿Quedó un borrador sin guardar de una sesión anterior? Se ofrece recuperarlo.
    _ofrecerBorrador();
    global.requestAnimationFrame(function () { global.requestAnimationFrame(function () {
      _iniciar3dEnVivo();
    }); });
  };


  // ==========================================================================
  // MODO OBRA - EL EDITOR HACIENDO DE ENFIERRADOR
  // --------------------------------------------------------------------------
  // NO hay un segundo editor. Es el mismo modal, el mismo motor y el mismo
  // listado de barras: lo unico que cambia es que ST.ctxObra trae la ubicacion
  // del despiece, y con ella _ctxGen() deja de devolver {} - que era, literal, el
  // unico hueco entre "generar barras" y "cargarlas a un lote".
  //
  // Las barras salen por POST /lotes/{id}/barras, el MISMO endpoint del ingreso
  // manual, con origen='template' (clasificacion propia de las barras nacidas del
  // 3D: en un despiece conviven con las del CSV y las del editor de despieces, y
  // el sistema las distingue por ese campo).
  // ==========================================================================

  // Texto del chip de contexto: lo que el usuario necesita para saber DONDE esta
  // cargando (no es decorativo: el sector/ciclo/eje se estampan en cada barra).
  function _ctxObraTexto() {
    var c = ST.ctxObra; if (!c) return '\u2014';
    return [c.id_proyecto, c.sector, c.ciclo, c.eje].filter(function (x) {
      return !!(x && String(x).trim());
    }).join(' \u00b7 ') || '\u2014';
  }

  // NOMBRE DE LA ESTRUCTURA - se DERIVA, no se pide (decision 3 del usuario: "no
  // debiera haber 2 muros por eje; si un eje tiene 2 muros, el cubicador los
  // subdivide"). Obra + ciclo + piso + eje identifican la estructura sin campo.
  function _nombreEstructura() {
    var c = ST.ctxObra; if (!c) return '';
    return [c.id_proyecto, c.ciclo, (ST.piso || '').trim(), c.eje].filter(function (x) {
      return !!(x && String(x).trim());
    }).join(' \u00b7 ');
  }

  // Muestra/esconde TODO lo que es exclusivo del modo obra. Un solo sitio: si
  // manana se agrega otro control de obra, se enciende aqui y no en 5 llamadores.
  function _aplicarModoObra() {
    var obra = _modoObra();
    ['te_grpObra', 'te_grpObraSep'].forEach(function (id) {
      var el = $(id); if (el) el.style.display = obra ? '' : 'none';
    });
    var btn = $('te_btnCargarDespiece');
    if (btn) {
      btn.style.display = obra ? '' : 'none'; btn.disabled = false;
      // El texto DICE cual de las dos cosas hace: crear la estructura o actualizarla.
      if (obra) btn.textContent = _textoBotonDespiece();
    }
    // (Aca se escondia "📂 Abrir" en modo obra: ese boton ya no existe — 21-ago.)
    if (!obra) return;
    var chip = $('te_obraCtx'); if (chip) chip.textContent = _ctxObraTexto();
    var pi = $('te_ribPiso'); if (pi) pi.value = ST.piso || '';
    _bindObra();
    _cargarTemplatesObra();
  }

  function _bindObra() {
    var pi = $('te_ribPiso');
    if (pi && !pi._teBound) {
      pi._teBound = true;
      // El piso viaja EN CADA BARRA (el backend lo exige no vacio), asi que cambiarlo
      // obliga a regenerar: si no, el payload conservaria el piso anterior.
      var aplicar = function () {
        var v = (pi.value || '').trim();
        if (v === (ST.piso || '')) return;
        ST.piso = v;
        _regenerar();
      };
      pi.addEventListener('change', aplicar);
      pi.addEventListener('blur', aplicar);
    }
    var sel = $('te_ribTemplate');
    if (sel && !sel._teBound) {
      sel._teBound = true;
      sel.addEventListener('change', function () {
        var id = sel.value;
        sel.value = '';                   // vuelve al placeholder: es una ACCION, no un estado
        if (!id) return;
        _cargarRecetaTemplateEnObra(id);
      });
    }
  }

  // FILTRO POR ELEMENTO (decision 4): haciendo muros solo se pueden llamar templates
  // de muro. El filtro lo hace el BACKEND (?tipo=), que es donde vive la lista.
  function _cargarTemplatesObra() {
    var sel = $('te_ribTemplate'); if (!sel) return;
    var tipo = (ST.elemento || '').toLowerCase();
    sel.innerHTML = '<option value="">cargando\u2026</option>';
    _tplFetch('/templates?tipo=' + encodeURIComponent(tipo), { headers: _tplHeaders(false) })
      .then(function (data) {
        var tpls = (data && data.templates) || [];
        ST._tplsObra = tpls;
        sel.innerHTML = '<option value="">' +
          (tpls.length ? ('\u2014 llamar template de ' + _esc(tipo) + ' \u2014')
                       : ('sin templates de ' + _esc(tipo))) + '</option>' +
          tpls.map(function (t) {
            return '<option value="' + _esc(t.id) + '">' + _esc(t.nombre || ('#' + t.id)) + '</option>';
          }).join('');
      })
      .catch(function () { sel.innerHTML = '<option value="">no se pudo cargar la lista</option>'; });
  }

  // Llamar un template DENTRO del modo obra: se reabre el MISMO modal con la receta
  // del template y el contexto de obra intacto. Se reusa templateEditorAbrir a
  // proposito (normalizador, render y sellos son los mismos): duplicar ese camino
  // seria justamente el fork que no queremos.
  function _cargarRecetaTemplateEnObra(id) {
    _errObra('');
    if (_hayCambiosSinGuardar() &&
        !global.confirm('Llamar un template REEMPLAZA lo que hay en pantalla. \u00bfContinuar?')) return;
    _tplFetch('/templates/' + encodeURIComponent(id), { headers: _tplHeaders(false) })
      .then(function (t) {
        if (!t || !t.params || !t.params.geometria) {
          _errObra('Ese template no tiene receta utilizable.');
          return;
        }
        global.templateEditorAbrir({
          elemento: String(t.tipo || ST.elemento || 'viga').toUpperCase(),
          nombre: t.nombre || '',
          dims: t.params.geometria,
          receta: t.params,
          // templateId NULL a proposito: en obra el hormigon se ajusta a lo REAL
          // (decision 5) y un "Guardar cambios" con esa geometria pisaria el
          // template de la biblioteca. Su id queda solo como TRAZA (tplOrigen).
          templateId: null, tplOrigen: t.id,
          ctxObra: ST.ctxObra, piso: ST.piso, instanciaId: ST.instanciaId
        });
      })
      .catch(function (e) {
        _errObra('No se pudo abrir el template: ' + ((e && e.message) || ''));
      });
  }

  // PUERTA DE ENTRADA DEL MODO OBRA - la usa "Agregar Cubicacion" (ac2AbrirEditor3D).
  //   ctx = { loteId, id_proyecto, sector, ciclo, eje, nombre_plano, estructura }
  // Sin receta abre en blanco con el hormigon por defecto del ELEMENTO del lote
  // (su estructura); con receta (reabrir una estructura ya cargada) abre esa.
  global.templateEditorAbrirEnObra = function (ctx, opts) {
    if (!ctx || !ctx.loteId) {
      if (global.console && global.console.warn) {
        global.console.warn('[TE] templateEditorAbrirEnObra necesita { loteId, ... }.');
      }
      return;
    }
    opts = opts || {};
    var elem = String(opts.elemento || ctx.estructura || 'VIGA').toUpperCase();
    if (!TPL_DIMS_POR_ELEMENTO[elem]) elem = 'VIGA';
    global.templateEditorAbrir({
      elemento: elem,
      nombre: opts.nombre || '',
      dims: (opts.receta && opts.receta.geometria) || _tplDimsDefault(elem),
      receta: opts.receta || null,
      templateId: null,
      tplOrigen: (opts.tplOrigen != null) ? opts.tplOrigen : null,
      ctxObra: ctx,
      piso: opts.piso || '',
      instanciaId: (opts.instanciaId != null) ? opts.instanciaId : null
    });
  };

  // Payload de barras: lo que YA genero el motor, sin las claves de trabajo (las que
  // empiezan con "_" son estimaciones del front - largo y peso los calcula el
  // backend) y con la traza de la instancia estampada.
  function _barrasPayload(instId) {
    var out = ST.ultimoOut;
    if (!out || !out.barras) return [];
    return out.barras.map(function (b) {
      var o = {};
      for (var k in b) if (b.hasOwnProperty(k) && k.charAt(0) !== '_') o[k] = b[k];
      o.origen = 'template';
      o.template_instancia_id = (instId != null) ? instId : null;
      return o;
    });
  }

  function _errObra(msg) {
    var err = $('te_saveErr'); if (err) { err.textContent = msg || ''; err.title = msg || ''; }
  }

  // TRAZA de la estructura. El NOMBRE va DERIVADO (obra . ciclo . piso . eje): se guarda
  // ya resuelto para que un futuro "element manager" sea LEER la tabla, no recalcular.
  function _trazaInstancia() {
    var c = ST.ctxObra || {};
    return {
      nombre: _nombreEstructura(), elemento: (ST.elemento || '').toLowerCase(),
      piso: (ST.piso || '').trim(),
      id_proyecto: c.id_proyecto || null, sector: c.sector || null,
      ciclo: c.ciclo || null, eje: c.eje || null
    };
  }

  var _TXT_CARGAR = '\ud83e\uddf1 Cargar al despiece';
  var _TXT_ACTUALIZAR = '\ud83e\uddf1 Actualizar en el despiece';

  function _textoBotonDespiece() {
    return (ST.instanciaId != null) ? _TXT_ACTUALIZAR : _TXT_CARGAR;
  }

  // CARGAR / ACTUALIZAR EN EL DESPIECE.
  // --------------------------------------------------------------------------
  // La PRIMERA vez crea la estructura y sus barras por POST /lotes/{id}/barras (el
  // canal del ingreso manual). Cuando la estructura YA existe, regenerar no la
  // reemplaza: se ACTUALIZA (PUT de la receta + POST .../barras/sync), y el backend
  // cruza las barras por su origen_ref para actualizar lo que cambio, crear lo nuevo y
  // borrar lo que dejo de existir. Asi la barra conserva su id, su historia y su marca
  // de revision en vez de nacer de cero en cada pasada.
  global.templateEditorCargarAlDespiece = function () {
    if (!_modoObra()) return;
    var btn = $('te_btnCargarDespiece');
    if (btn && btn.disabled) return;
    _errObra('');
    var piso = (ST.piso || '').trim();
    if (!piso) {
      // El backend lo rechaza con 400, pero el arreglo esta ACA (campo del ribbon).
      _errObra('Elige el piso de esta estructura (arriba, en el grupo Despiece).');
      var pi = $('te_ribPiso'); if (pi && pi.focus) { pi.focus(); if (pi.select) pi.select(); }
      return;
    }
    var barras = _barrasPayload(ST.instanciaId);
    if (!barras.length) {
      _errObra('Todavia no hay barras generadas: agrega componentes al elemento.');
      return;
    }
    var ctx = ST.ctxObra;
    var regenera = (ST.instanciaId != null);
    if (btn) { btn.disabled = true; btn.textContent = regenera ? 'Actualizando\u2026' : 'Cargando\u2026'; }
    var traza = _trazaInstancia();
    var paso1 = regenera
      ? _tplFetch('/elementos/instancia/' + encodeURIComponent(ST.instanciaId), {
          method: 'PUT', headers: _tplHeaders(true),
          body: JSON.stringify({
            params: ST.receta, nombre: traza.nombre, elemento: traza.elemento,
            piso: traza.piso, template_id: ST.tplOrigen
          })
        }).then(function () { return ST.instanciaId; })
      : _tplFetch('/elementos/instancia', {
          method: 'POST', headers: _tplHeaders(true),
          body: JSON.stringify(Object.assign({
            lote_id: ctx.loteId, template_id: ST.tplOrigen, params: ST.receta
          }, traza))
        }).then(function (ri) { return (ri && ri.id != null) ? ri.id : null; });

    paso1.then(function (instId) {
      if (instId == null) {
        // Sin estructura no hay a que colgar las barras: mejor no cargarlas que
        // dejarlas huerfanas y sin forma de reabrirlas.
        throw new Error('no se pudo guardar la estructura');
      }
      ST.instanciaId = instId;
      var url = '/lotes/' + encodeURIComponent(ctx.loteId) + '/barras' + (regenera ? '/sync' : '');
      var cuerpo = regenera
        ? { instancia_id: instId, barras: _barrasPayload(instId) }
        : { barras: _barrasPayload(instId) };
      return _tplFetch(url, {
        method: 'POST', headers: _tplHeaders(true), body: JSON.stringify(cuerpo)
      });
    })
      .then(function (r) {
        if (btn) { btn.disabled = false; btn.textContent = _textoBotonDespiece(); }
        _errObra('');
        var msg;
        if (regenera) {
          msg = '\u2705 ' + (r.actualizadas || 0) + ' actualizada(s) \u00b7 ' + (r.creadas || 0) +
                ' nueva(s) \u00b7 ' + (r.eliminadas || 0) + ' borrada(s)';
        } else {
          msg = '\u2705 ' + ((r && r.creadas) || barras.length) + ' item(s) cargados al despiece';
        }
        _actualizarStatus(msg + ' \u00b7 ' + _nombreEstructura());
        // La grilla del despiece tiene que mostrar lo que acaba de entrar.
        if (typeof global.ac2CargarLote === 'function') {
          try { global.ac2CargarLote(ctx.loteId); } catch (e) { /* la carga ya esta hecha */ }
        }
      })
      .catch(function (e) {
        if (btn) { btn.disabled = false; btn.textContent = _textoBotonDespiece(); }
        _errObra((regenera ? 'No se actualizo la estructura: ' : 'No se cargaron las barras: ') +
                 ((e && e.message) || 'error desconocido'));
      });
  };

  // Cierre SIN confirm (interno): esconde el modal y limpia estado transitorio.
  function _cerrarModal() {
    // Si se cierra con cambios sin guardar, el borrador se vuelca AHORA (el throttle
    // podía tener hasta 2 s en vuelo y con el modal cerrado ya no escribe): la próxima
    // apertura ofrece recuperarlos. Descartar sigue estando a un clic en la barra.
    // Sin cambios no escribe nada (la guarda vive dentro de _guardarBorradorAhora).
    _guardarBorradorAhora();
    _ocultarBarraBorrador();
    var bd = $('te_backdrop'); if (bd) bd.classList.remove('on');
    // limpiar estado transitorio de hover (snap de cara / ghost) y esconder overlay.
    ST.caraHi = null;
    _limpiarGhost();
    var fb = $('te_flipBtn'); if (fb) fb.classList.remove('on');
    // RE-PEDIR LA BIBLIOTECA AL SALIR (21-ago). Esto lo hacía sólo el botón "📂 Abrir"
    // del titlebar, que se eliminó; ahora vive donde tiene que estar: la lista del tab
    // queda DEBAJO del modal ya dibujada, así que si en esta sesión se guardó o se
    // renombró algo, cerrar por cualquier vía (✕, backdrop, Esc) dejaba a la vista los
    // datos viejos hasta que alguien tocara el tab.
    if (typeof global.tplCargarGuardados === 'function') global.tplCargarGuardados();
  }

  // T2 — dirty-check en TODAS las salidas (✕, backdrop, Esc pasan por aquí).
  global.templateEditorCerrar = function () {
    if (_hayCambiosSinGuardar() && !global.confirm('Hay cambios sin guardar. ¿Cerrar igual?')) return;
    _cerrarModal();
  };

  // El botón "📂 Abrir" del titlebar y su templateEditorVolverALista SE ELIMINARON
  // (21-ago). Era una SEGUNDA salida hacia la lista del tab, que es exactamente a
  // donde deja la ✕ al cerrar el modal. Lo único propio que tenía —re-pedir la
  // biblioteca al salir— se mudó a _cerrarModal(), o sea que ahora lo hacen TODAS
  // las salidas y no sólo ese botón.

  global.templateEditorVerEn3D = function () { _iniciar3dEnVivo(); };

  // Cerrar con clic en el backdrop (fuera del modal)
  document.addEventListener('click', function (e) {
    var bd = $('te_backdrop');
    if (bd && e.target === bd) global.templateEditorCerrar();
  });
  // Escape — se deshace de lo más superficial a lo más profundo: 1º deshace la
  // MAXIMIZACIÓN de un cuadrante (18-ago) · 2º sale del MODO COLOCACIÓN (mata el
  // ghost, vuelve a Seleccionar) · 3º cierra el modal. La lupa va primero a propósito:
  // con un cuadrante agrandado, el reflejo es apretar Esc para volver a los 4, y si
  // eso cerrara el editor el usuario perdería la pantalla por querer salir del zoom.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var bd = $('te_backdrop');
    if (!bd || !bd.classList.contains('on')) return;
    if (_vistaMaximizada()) { _maximizarVista(null); return; }
    if (ST.espejoPend) { _salirEspejo(); return; }
    if (ST.tool === 'colocar') { _salirModoColocacion(); return; }
    global.templateEditorCerrar();
  });

  // NO PERDER TRABAJO (a) — F5 / cerrar pestaña / navegar con el editor ABIERTO y
  // cambios sin guardar dispara el confirm NATIVO del navegador. Se registra UNA sola
  // vez (aquí, junto a los otros listeners globales del módulo) y con el modal cerrado
  // sale de inmediato. Antes de avisar VUELCA el borrador: si el usuario confirma la
  // salida, lo último que hizo queda igual en localStorage.
  global.addEventListener('beforeunload', function (e) {
    if (!_modalAbierto() || !_hayCambiosSinGuardar()) return;
    _guardarBorradorAhora();
    e.preventDefault();
    e.returnValue = '';   // Chrome/Safari sólo muestran el diálogo si se setea esto
    return '';
  });

  // ==========================================================================
  // T2 — PANTALLA PREVIA del sub-tab Templates + GUARDAR/ABRIR
  // (§GAP-ANALYSIS-TE · bloque AGENTE 1 del programa_modelador_3d.md)
  //
  // Espejos locales (data pura, NO dependencias — regla 1: nada de módulos
  // capturados a nivel de módulo; fetch/apiUrl/authHeaders se resuelven DENTRO
  // de cada función porque los scripts cargan en paralelo):
  //   TPL_TIPOLOGIAS        — copia 1:1 de _TIPOLOGIAS_SEED (catalogo.py:99-114).
  //   TPL_COLORES           — color por código de tipología (por ROL: mismos tonos
  //                           significan lo mismo en todos los elementos; viga
  //                           conserva los existentes; n-capas = variante clara).
  //   TPL_DIMS_POR_ELEMENTO — campos y defaults (cm) de la pantalla previa
  //                           (espíritu de PLANOS_POR_ELEMENTO; VIGA = semilla_viga).
  // ==========================================================================
  var TPL_TIPOLOGIAS = {
    MURO: [['MH', 'Malla Horizontal'], ['MV', 'Malla Vertical'], ['TR', 'Traba Muro'],
           ['EC', 'Estribo Confinamiento'], ['TC', 'Traba Confinamiento'], ['CB', 'Cabezal']],
    LOSA: [['Fi', 'Malla Inferior i'], ['Fs', 'Malla Inferior s'], ["F'i", 'Malla Superior i'],
           ["F's", 'Malla Superior s'], ['F', 'Refuerzo o Suple Inferior'],
           ["F'", 'Refuerzo o Suple Superior'], ['SP', 'Soporte Losa'], ['Rp', 'Reparticion'],
           ['TRL', 'Traba Losa']],
    VIGA: [['CBS', 'Cabezal Superior primera capa'], ['CBS2', 'Cabezal Superior segunda capa'],
           ['CBSn', 'Cabezal Superior n capa'], ['CBI', 'Cabezal Inferior primera capa'],
           ['CBI2', 'Cabezal Inferior segunda capa'], ['CBIn', 'Cabezal Inferior n capa'],
           ['LT', 'Lateral'], ['ES', 'Estribo'], ['TRV', 'Traba Viga']],
    COLUMNA: [['CB', 'Cabezal'], ['CB2', 'Cabezal 2'], ['CBn', 'Cabezal n'],
              ['TRC', 'Traba Columna'], ['ESC', 'Estribo Columna']],
    FUNDACION: [['Fi', 'Malla Inferior i'], ['Fs', 'Malla Inferior s'],
                ["F'i", 'Malla Superior i'], ["F's", 'Malla Superior s'],
                ['SPF', 'Soporte Fundacion'], ['TRF', 'Traba Fundacion']],
    GEN: [['CB', 'Cabezal'], ['F', 'Refuerzo o Suple Inferior'], ["F'", 'Refuerzo o Suple Superior']]
  };

  // ALIAS de la paleta única (ver COL2D): chips del ribbon, barras 2D y
  // materiales 3D leen LA MISMA tabla — no puede volver a divergir.
  var TPL_COLORES = COL2D;

  // Color del ELEMENTO (chip de tipo en la lista + reconocimiento cruzado tab↔modal).
  var TPL_ELEM_COLORES = {
    MURO: '#795548', LOSA: '#607d8b', VIGA: '#558B2F',
    COLUMNA: '#1565c0', FUNDACION: '#5d4037', GEN: '#616161'
  };

  // Campos y defaults (cm) por elemento. checks = [recubA, recubB, dim]: inválido
  // si recubA + recubB >= dim (suma de recubs opuestos < dimensión de esa cara).
  // VIGA calca semilla_viga.js:41 (NO inventar otros).
  var TPL_DIMS_POR_ELEMENTO = {
    VIGA: {
      dims:   [{ k: 'largo', lbl: 'Largo', def: 600 }, { k: 'alto', lbl: 'Alto', def: 60 }, { k: 'ancho', lbl: 'Ancho', def: 30 }],
      recubs: [{ k: 'recub_sup', lbl: 'Sup', def: 4 }, { k: 'recub_inf', lbl: 'Inf', def: 4 }, { k: 'recub_lat', lbl: 'Lat', def: 3 }],
      checks: [['recub_sup', 'recub_inf', 'alto'], ['recub_lat', 'recub_lat', 'ancho']]
    },
    // MURO — se guarda con las claves CANÓNICAS de la geometría (las únicas que el
    // motor y las vistas conocen), sólo que se LLAMAN distinto en la UI:
    //   ancho = ESPESOR · recub_lat = recub de CARAS · recub_sup/inf = recub de BORDES.
    // El "Recub bordes" escribe los dos (ks) porque arriba y abajo son el mismo borde.
    // MURO: UN solo recubrimiento (pedido del usuario 13-ago) — escribe caras y
    // bordes con el mismo valor. Independizar recubrimientos por cara queda como
    // opción futura, fuera de alcance por ahora.
    MURO: {
      dims:   [{ k: 'largo', lbl: 'Largo', def: 400 }, { k: 'alto', lbl: 'Alto', def: 250 }, { k: 'ancho', lbl: 'Espesor', def: 20 }],
      recubs: [{ k: 'recub_lat', ks: ['recub_lat', 'recub_sup', 'recub_inf'], lbl: 'Recub', def: 2.5 }],
      checks: [['recub_lat', 'recub_lat', 'ancho'], ['recub_sup', 'recub_inf', 'alto']]
    },
    COLUMNA: {
      dims:   [{ k: 'alto', lbl: 'Alto', def: 300 }, { k: 'b', lbl: 'b', def: 40 }, { k: 'h', lbl: 'h', def: 40 }],
      recubs: [{ k: 'recub', lbl: 'Recub', def: 4 }],
      checks: [['recub', 'recub', 'b'], ['recub', 'recub', 'h']]
    },
    LOSA: {
      dims:   [{ k: 'largo', lbl: 'Largo', def: 500 }, { k: 'ancho', lbl: 'Ancho', def: 400 }, { k: 'espesor', lbl: 'Espesor', def: 15 }],
      recubs: [{ k: 'recub_sup', lbl: 'Sup', def: 2.5 }, { k: 'recub_inf', lbl: 'Inf', def: 2.5 }],
      checks: [['recub_sup', 'recub_inf', 'espesor']]
    },
    FUNDACION: {
      dims:   [{ k: 'largo', lbl: 'Largo', def: 300 }, { k: 'ancho', lbl: 'Ancho', def: 100 }, { k: 'alto', lbl: 'Alto', def: 80 }],
      recubs: [{ k: 'recub', lbl: 'Recub', def: 5 }],
      checks: [['recub', 'recub', 'alto'], ['recub', 'recub', 'ancho']]
    },
    GEN: {
      dims:   [{ k: 'largo', lbl: 'Largo', def: 300 }, { k: 'alto', lbl: 'Alto', def: 100 }, { k: 'ancho', lbl: 'Ancho', def: 100 }],
      recubs: [{ k: 'recub', lbl: 'Recub', def: 4 }],
      checks: [['recub', 'recub', 'alto'], ['recub', 'recub', 'ancho']]
    }
  };

  function _capitalizar(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

  // Headers de auth para los fetch — patrón de disenador.js (resuelto EN el momento).
  function _tplHeaders(conJson) {
    var h = conJson ? { 'Content-Type': 'application/json' } : {};
    return Object.assign(h, (typeof global.authHeaders === 'function' ? global.authHeaders() : {}));
  }
  function _tplUrl(path) {
    return (typeof global.apiUrl === 'function') ? global.apiUrl(path) : path;
  }

  // ---- Titlebar dinámico: h1 "Template Editor — Viga" + badge + nombre ----
  // El NOMBRE es un input EDITABLE (antes venía fijo desde la pantalla previa y no
  // había forma de corregirlo: para renombrar había que crear otro template).
  function _actualizarTitulos() {
    var el = (ST.elemento || 'viga');
    var h1 = document.querySelector('#te_titlebar h1');
    if (h1) h1.textContent = 'Template Editor — ' + _capitalizar(el);
    var badge = $('te_elemBadge'); if (badge) badge.textContent = el.toUpperCase();
    var inp = $('te_nombre');
    // Con el foco DENTRO no se pisa: el usuario está escribiendo (y le borraría el
    // cursor a mitad de palabra). El campo ya es la fuente de ST.nombre.
    if (inp && document.activeElement !== inp) inp.value = ST.nombre || '';
    // Sufijo informativo. El "· biblioteca #<id>" SE FUE (21-ago, pedido del usuario):
    // el número es la clave primaria de la tabla, no dice nada de este template y sólo
    // servía para depurar. Lo que SÍ queda es el aviso de propiedad: si el template es
    // de otro usuario, "Guardar cambios" no puede sorprender a nadie.
    var ruta = $('te_subRuta');
    if (ruta) {
      ruta.textContent = (ST.templateId != null)
        ? (ST.puedeModificar === false ? '· de otro usuario' : '')
        : '· nuevo · Catálogo › Templates';
    }
  }

  // Campo NOMBRE del titlebar. Escribe ST.nombre en vivo (el dirty-tracking lo
  // mira) y no toca la receta: el nombre es columna propia del template.
  function _bindNombre() {
    var inp = $('te_nombre'); if (!inp || inp._teBound) return;
    inp._teBound = true;
    inp.addEventListener('input', function () {
      ST.nombre = inp.value;      // SIN trim en vivo: el usuario escribe espacios entre palabras
      _actualizarBtnGuardar();    // renombrar YA es un cambio guardable
      _programarBorrador();       // …y el borrador también lo protege
    });
    // Enter no envía nada (no hay form): sólo confirma y suelta el foco, así el
    // teclado del editor (Ctrl+Z, R, ESPACIO) vuelve a funcionar.
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && inp.blur) inp.blur();
    });
    inp.addEventListener('blur', function () {
      ST.nombre = _nombreLimpio();
      inp.value = ST.nombre;
      _actualizarBtnGuardar();
    });
  }

  // ==========================================================================
  // EL RIBBON EN UNA SOLA LÍNEA — y el PLAN B, medido
  // --------------------------------------------------------------------------
  // El ribbon no wrappea (CSS: flex-wrap:nowrap): el pedido es ganar altura para los
  // cuadrantes, y un segundo renglón la devuelve entera. Cuando el ancho no alcanza
  // ceden, por orden: (1) la nota de ayuda, que se recorta sola con ellipsis, y
  // (2) las ETIQUETAS de las tipologías — el plan B que el usuario autorizó, que
  // deja el cuadrito de color con su tooltip.
  //
  // SE MIDE, NO SE ADIVINA. Un breakpoint por ancho de ventana no sabe cuántas
  // tipologías tiene el elemento en curso (9 en viga, otras en muro), ni si el bloque
  // de colocación está abierto, ni cuánto mide la fuente del usuario. Acá se pregunta
  // al DOM si el contenido cabe (scrollWidth > clientWidth) con las etiquetas puestas,
  // y sólo entonces se compacta. En una pantalla ancha las etiquetas siguen ahí.
  // Se re-mide tras cada cosa que cambia el contenido del ribbon (render de campos,
  // de tipologías, entrar/salir de colocación) y al cambiar el tamaño de la ventana.
  function _ajustarRibbonUnaLinea() {
    var rib = $('te_ribbon'), modal = $('te_modal');
    if (!rib || !modal || typeof rib.clientWidth !== 'number') return;
    // Se mide SIEMPRE desde el estado ancho: si no, una vez compactado el ribbon ya
    // cabría y nunca volvería a soltar las etiquetas al agrandar la ventana.
    modal.classList.remove('te-rib-compacto');
    if (!rib.clientWidth) return;                    // modal cerrado: nada que medir
    if (rib.scrollWidth > rib.clientWidth + 1) modal.classList.add('te-rib-compacto');
  }

  // ---- Ribbon dinámico de tipologías por elemento (wrap si son >6) ----
  function _renderRibbonTips() {
    var cont = $('te_tipbtns'); if (!cont) return;
    var lista = TPL_TIPOLOGIAS[(ST.elemento || 'viga').toUpperCase()] || TPL_TIPOLOGIAS.VIGA;
    var codigos = lista.map(function (t) { return t[0]; });
    if (codigos.indexOf(ST.tipologia) === -1) ST.tipologia = codigos[0];
    cont.innerHTML = lista.map(function (t) {
      var col = TPL_COLORES[t[0]] || '#607d8b';
      // La ETIQUETA va en su propio <span>. Desde el 22-ago YA NO se esconde cuando el
      // ribbon aprieta: ahora el ribbon baja a dos líneas y el nombre se conserva.
      return '<span class="te-tipbtn' + (t[0] === ST.tipologia ? ' on' : '') + '" data-tip="' + _esc(t[0]) +
        '" title="' + _esc(t[0]) + ' · ' + _esc(t[1]) + '"><span class="te-sw" style="background:' + col + '"></span>' +
        '<span class="te-tipnm">' + _esc(t[0]) + '</span></span>';
    }).join('');
    // Cambiar de ELEMENTO cambia las tipologías (y arriba pudo reasignarse
    // ST.tipologia): el datalist y el campo Figura tienen que seguirlas, si no el
    // ribbon queda ofreciendo y validando contra la tipología del elemento anterior.
    // El prellenado va sin forzar: acá el usuario no eligió tipología, así que sólo
    // se rellena lo que está vacío (apertura del editor / cambio de elemento).
    _prellenarRibbonDesdeConfig(false);
    _refrescarFigDatalist();
    _validarFiguraRibbon(false);
    _ajustarRibbonUnaLinea();   // cambian los chips → cambia el ancho del ribbon
  }

  // ==========================================================================
  // SELECTOR DE ELEMENTO DENTRO DEL EDITOR
  // --------------------------------------------------------------------------
  // Antes el elemento se fijaba FUERA (pantalla previa del sub-tab) y para pasar
  // de viga a muro había que cerrar, crear otro template y volver a colocar todo.
  // Ahora se cambia acá y el editor rehace lo que depende del elemento.
  //
  // QUÉ ELEMENTOS SE OFRECEN: los que tienen los DATOS COMPLETOS, y eso se
  // PREGUNTA a las tablas, no se mantiene una lista aparte que se desincroniza:
  //   · PLANOS_POR_ELEMENTO        → las 3 vistas (u/v/depth de cada cuadrante)
  //   · GEO_CAMPOS_POR_ELEMENTO    → los campos del grupo HORMIGÓN del ribbon
  //   · TPL_TIPOLOGIAS             → los chips de tipología
  //   · TPL_DIMS_POR_ELEMENTO      → los defaults (cm) de esas dims
  // Hoy dan VIGA y MURO. Los demás salen DESHABILITADOS con "(próximamente)": a
  // medias sería peor que no estar (el usuario dijo explícitamente que no quiere
  // empezar columna sin terminar el muro).
  // ==========================================================================
  function _elementoConDatos(elem) {
    var min = String(elem || '').toLowerCase();
    var may = _figKey(elem);
    return !!(PLANOS_POR_ELEMENTO[min] && GEO_CAMPOS_POR_ELEMENTO[min] &&
      TPL_TIPOLOGIAS[may] && TPL_DIMS_POR_ELEMENTO[may]);
  }

  // Pinta las opciones del <select> del titlebar y lo deja apuntando al elemento
  // activo. El ORDEN sale de TPL_DIMS_POR_ELEMENTO (VIGA y MURO primero, que son
  // los que se pueden usar). El elemento ACTIVO nunca se deshabilita aunque le
  // falten datos: se puede abrir un template guardado de un tipo todavía
  // incompleto, y dejarlo bloqueado ahí sería encerrar al usuario.
  function _renderElemSel() {
    var sel = $('te_elemSel'); if (!sel) return;
    var act = _figKey(_tipoElemento());
    sel.innerHTML = Object.keys(TPL_DIMS_POR_ELEMENTO).map(function (k) {
      var listo = _elementoConDatos(k);
      return '<option value="' + _esc(k) + '"' +
        ((listo || k === act) ? '' : ' disabled') + (k === act ? ' selected' : '') + '>' +
        _esc(_capitalizar(k)) + (listo ? '' : ' (próximamente)') + '</option>';
    }).join('');
    sel.value = act;
    // CON BARRAS COLOCADAS EL ELEMENTO NO SE CAMBIA (decisión del usuario 14-ago:
    // "si ya tengo barras no es razonable que cambie de tipo de elemento"). Las
    // poses/tipologías de una viga no significan lo mismo en un muro y el cambio
    // a receta poblada terminaba en error. El selector se DESHABILITA con el
    // porqué en el tooltip; el flujo más orgánico se definirá con el usuario.
    var conBarras = !!(ST.receta && ST.receta.componentes && ST.receta.componentes.length);
    sel.disabled = conBarras;
    sel.title = conBarras
      ? 'El elemento se elige con la receta vacía: elimina las barras colocadas para cambiarlo.'
      : 'Tipo de elemento de hormigón de este template.';
  }

  // El listener va UNA vez sobre el <select> (no sobre las <option>, que mueren en
  // cada _renderElemSel): patrón _teBound del resto del módulo.
  function _bindElemSel() {
    var sel = $('te_elemSel'); if (!sel || sel._teBound) return;
    sel._teBound = true;
    sel.addEventListener('change', function () {
      _cambiarElemento(sel.value);
      // SOLTAR EL FOCO. El teclado del editor (Ctrl+Z, R, ESPACIO, Supr) se
      // ignora mientras el foco está en un input/select (_bindTeclado), y el
      // <select> nativo no tiene undo propio: si el foco se quedaba acá, el
      // reflejo "me equivoqué de elemento → Ctrl+Z" no disparaba nada.
      if (sel.blur) sel.blur();
    });
  }

  // Cambio de elemento. NO borra la receta: las barras ya colocadas se quedan con
  // su figura, su φ y su posición. Lo que NO se hace es re-estampar las poses por
  // defecto del elemento nuevo (eso pisaría el trabajo del usuario), así que se
  // DICE en la barra de estado en vez de dejarlo pasar en silencio.
  function _cambiarElemento(elem) {
    var may = _figKey(elem), min = may.toLowerCase();
    if (!may || !TPL_DIMS_POR_ELEMENTO[may]) { _renderElemSel(); return; }
    if (min === String(_tipoElemento()).toLowerCase()) return;
    if (!_elementoConDatos(may)) {
      // El <option> ya viene disabled; esto cubre el cambio por código.
      _renderElemSel();
      _actualizarStatus(_capitalizar(may) + ' todavía no está disponible en el editor.');
      return;
    }
    _pushUndo();
    ST.elemento = min;
    if (ST.receta) {
      ST.receta.tipo = min;
      // DIMS QUE EL ELEMENTO NUEVO PIDE Y LA RECETA NO TRAE (o trae vacías): se
      // rellenan con los defaults de ESE elemento. Sin ellas el motor genera NaN
      // y las vistas salen en blanco. Sólo se toca lo que FALTA: un largo o un
      // recubrimiento que el usuario ya escribió se respeta.
      var g = ST.receta.geometria = ST.receta.geometria || {};
      var defs = _tplDimsDefault(may);
      Object.keys(defs).forEach(function (k) {
        if (!isFinite(Number(g[k]))) g[k] = defs[k];
      });
    }
    var comps = (ST.receta && ST.receta.componentes) || [];
    // Tipologías que quedaron huérfanas: la barra sigue existiendo y dibujándose,
    // pero su tipología es de otro elemento (una CBS dentro de un muro). No se
    // toca el dato — se nombra, que es lo que el usuario necesita para arreglarlo.
    var codigos = (TPL_TIPOLOGIAS[may] || []).map(function (t) { return _figKey(t[0]); });
    var ajenas = [];
    comps.forEach(function (c) {
      var t = _figKey(c.tipologia);
      if (t && codigos.indexOf(t) < 0 && ajenas.indexOf(c.tipologia) < 0) ajenas.push(c.tipologia);
    });

    // Todo lo que es data-driven por elemento se rehace acá (el mismo juego que
    // corre templateEditorAbrir cuando el elemento cambia entre aperturas).
    _renderElemSel();
    _actualizarTitulos();      // h1 + badge
    _renderRibbonTips();       // chips de tipología (+ datalist y re-validación de Figura)
    _renderRibbonGeo();        // campos del grupo HORMIGÓN de ESTE elemento
    _sincronizarRibbonGeo();   // …con los valores de la receta
    // El selector de templates del modo obra lista SOLO los del elemento en curso
    // (decision 4): cambiar de elemento tiene que cambiar la lista, o se ofrecerian
    // templates de viga a alguien que ya esta haciendo un muro.
    if (_modoObra()) _cargarTemplatesObra();
    _refrescarDefsOrto();      // cada cámara orto vuelve a leer el def de su plano
    _actualizarTitulosVista(); // títulos de las 3 vistas + gizmo de ejes
    if (_hayCargado()) _sellarCargado();
    _renderPanel();
    _regenerar();
    _marcarSucio();

    // El mensaje va AL FINAL: _renderPanel/_regenerar/_sellarCargado llaman a
    // _actualizarStatus() sin argumento y se lo comerían.
    var msg = 'Elemento: ' + may + '.';
    if (comps.length) {
      msg += ' Se conservan las ' + comps.length + ' barra' + (comps.length === 1 ? '' : 's') +
        ' colocada' + (comps.length === 1 ? '' : 's') + ' con su posición: las poses por defecto ' +
        'del ' + min + ' NO se vuelven a estampar.';
      // El mensaje del status lo pisa el primer clic (cualquier _actualizarStatus()
      // sin argumento): lo que QUEDA es la marca ámbar de _tipAjenaAlElemento en la
      // lista y en la ficha. Acá se dice dónde mirar, no se confía en este texto.
      if (ajenas.length) {
        msg += ' Revisa la tipología de ' + ajenas.join(', ') + ' (no es de ' + may +
          '): quedan marcadas en ámbar en la lista de barras.';
      }
    } else {
      msg += ' Hormigón, tipologías y vistas actualizados.';
    }
    _actualizarStatus(msg);
  }

  // ---- Dirty-tracking ----
  // Hay dos cosas que se guardan: la RECETA y el NOMBRE. El nombre no vive dentro
  // de la receta (es columna propia de templates_catalogo), así que renombrar no
  // movía el JSON y el editor decía "sin cambios" con un nombre nuevo escrito:
  // cerrar no preguntaba, el borrador no lo protegía y el botón quedaba apagado.
  function _hayCambiosSinGuardar() {
    if (!ST.receta || ST._recetaGuardada == null) return false;
    if (ST._nombreGuardado != null && _nombreLimpio() !== ST._nombreGuardado) return true;
    try { return JSON.stringify(ST.receta) !== ST._recetaGuardada; } catch (e) { return false; }
  }

  function _nombreLimpio() { return String(ST.nombre == null ? '' : ST.nombre).trim(); }

  // Sella el estado "esto ya está en el servidor" (al abrir y tras cada guardado
  // con éxito). Los dos campos van JUNTOS: sellar uno solo deja al otro mintiendo.
  // Tras guardar se sella lo que SE ENVIÓ, no lo que hay en pantalla: si el usuario
  // siguió editando mientras la petición estaba en vuelo, esos cambios NO están en
  // el servidor y tienen que seguir contando como pendientes.
  function _sellarGuardado(recetaJson, nombre) {
    if (recetaJson == null) {
      try { recetaJson = JSON.stringify(ST.receta); } catch (e) { recetaJson = null; }
    }
    ST._recetaGuardada = recetaJson;
    ST._nombreGuardado = (nombre != null) ? String(nombre) : _nombreLimpio();
  }

  // ¿"Guardar" sobrescribe el template abierto (PUT) o crea uno nuevo (POST)?
  // Sobrescribe sólo si vino de la biblioteca Y el backend dijo que este usuario
  // puede modificarlo. Sin lo segundo el PUT sería un 403 garantizado: en ese caso
  // el único guardado honesto es una copia propia.
  function _puedeSobrescribir() {
    return (ST.templateId != null) && (ST.puedeModificar !== false);
  }

  // Texto/estado de los DOS botones de guardado. Lo que el botón DICE es lo que
  // hace: "Guardar cambios" = PUT sobre el template abierto · "Guardar template" =
  // POST (uno nuevo). "Guardar como nuevo" (POST) sólo aparece con un template
  // abierto — antes era el único botón que había, y por eso la biblioteca se
  // llenaba de copias con el mismo nombre.
  function _actualizarBtnGuardar() {
    if (ST._guardando) return;   // hay una escritura en vuelo: no pisar "Guardando…"
    var b = $('te_btnGuardar');
    var nuevo = $('te_btnGuardarNuevo');
    var abierto = (ST.templateId != null);
    if (nuevo) nuevo.style.display = abierto ? '' : 'none';
    if (!b) return;
    if (_puedeSobrescribir()) {
      var hay = _hayCambiosSinGuardar();
      b.textContent = '💾 Guardar cambios';
      // Sin cambios no hay nada que mandar: el botón se apaga en vez de repetir un
      // PUT idéntico (y así se VE que el trabajo ya está guardado).
      b.disabled = !hay;
      b.title = hay
        ? ('Actualiza «' + _nombreLimpio() + '» en la biblioteca (no crea una copia).')
        : 'No hay cambios que guardar.';
    } else {
      b.disabled = false;
      b.textContent = '💾 Guardar template';
      b.title = abierto
        ? 'Este template es de otro usuario: se guarda como una copia tuya.'
        : 'Crea el template en la biblioteca.';
    }
  }

  // ---------------------------------------------------------------------------
  // ERRORES DEL BACKEND EN CASTELLANO
  // ---------------------------------------------------------------------------
  // modelador.py ya responde `detail` en castellano y ACCIONABLE (el 422 dice qué
  // barra y qué le falta; el 409 dice cuántas instancias usan el template): cuando
  // viene, se muestra TAL CUAL. El mapa de abajo es para cuando NO viene detail
  // (500, proxy, HTML de error, sesión caída) — antes eso salía como "HTTP 422"
  // pelado, que no le dice nada a nadie.
  function _msgHttp(status) {
    if (status === 401) return 'Tu sesión expiró. Vuelve a entrar a ArmaHub.';
    if (status === 403) return 'No tienes permiso para hacer esto. Pídelo a un administrador.';
    if (status === 404) return 'El template ya no existe (alguien lo eliminó).';
    if (status === 409) return 'El template está en uso y no se puede eliminar.';
    if (status === 422) return 'La receta no es válida: revisa figuras, diámetros y lados.';
    if (status >= 500) return 'El servidor falló. Reintenta en un momento.';
    return 'Error inesperado (HTTP ' + status + ').';
  }

  // fetch con el error ya traducido. Rechaza con un Error que lleva `.status` para
  // que el llamador pueda distinguir los casos que necesitan otra acción (404 al
  // actualizar → ofrecer copia; 409 al eliminar → NO borrar).
  function _tplFetch(path, opts) {
    return fetch(_tplUrl(path), opts || {}).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) return data;
        var e = new Error((data && data.detail) ? String(data.detail) : _msgHttp(res.status));
        e.status = res.status;
        throw e;
      });
    }, function () {
      var e = new Error('No hay conexión con el servidor. Revisa tu red y reintenta.');
      e.status = 0;
      throw e;
    });
  }

  // ---- GUARDAR ----
  //   actualizar = true  → PUT  /templates/{id}   (sobrescribe el abierto)
  //   actualizar = false → POST /templates        (crea uno nuevo)
  // OJO: el campo del backend es "params" (NO "receta") — modelador.py.
  function _guardarTemplate(actualizar) {
    var btn = $('te_btnGuardar');
    var err = $('te_saveErr'); if (err) err.textContent = '';
    if (!ST.receta || ST._guardando) return;
    var nombre = _nombreLimpio();
    if (!nombre) {
      // El backend lo rechaza con 400, pero el arreglo está ACÁ: el campo del
      // titlebar. Se enfoca en vez de mandar una petición que ya sabemos que falla.
      if (err) err.textContent = 'Ponle un nombre al template (arriba, en el título).';
      var inp = $('te_nombre'); if (inp && inp.focus) { inp.focus(); if (inp.select) inp.select(); }
      return;
    }
    ST._guardando = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    var nuevoBtn = $('te_btnGuardarNuevo'); if (nuevoBtn) nuevoBtn.disabled = true;

    var body = { nombre: nombre, tipo: (ST.elemento || 'viga').toLowerCase(), params: ST.receta };
    var path = '/templates', metodo = 'POST';
    if (actualizar) {
      path = '/templates/' + encodeURIComponent(ST.templateId);
      metodo = 'PUT';
      // `obra` NO se manda: el PUT sólo escribe los campos que VIENEN (no
      // destructivo), y el editor no elige obra. Mandar null aquí MUDARÍA a
      // "general" un template que el Enfierrador creó colgado de una obra.
    } else {
      // Copia: se queda en la MISMA obra que el original (null = general, que es lo
      // que crea siempre el editor). Mover la copia a otra obra no lo pidió nadie.
      body.obra = (ST.obra != null) ? ST.obra : null;
    }

    // Foto EXACTA de lo que se manda: es lo que quedará en el servidor y por lo
    // tanto lo que se sella como "guardado" (ver _sellarGuardado).
    var enviado = null;
    try { enviado = JSON.stringify(ST.receta); } catch (e) { enviado = null; }

    _tplFetch(path, { method: metodo, headers: _tplHeaders(true), body: JSON.stringify(body) })
      .then(function (data) {
        if (!actualizar && data && data.id != null) {
          // A partir de aquí el editor APUNTA al template recién creado: el próximo
          // "Guardar" lo actualiza en vez de fabricar otra copia.
          ST.templateId = data.id;
          ST.puedeModificar = true;            // lo acaba de crear este usuario
          if (data.obra !== undefined) ST.obra = data.obra;
        }
        _sellarGuardado(enviado, nombre);
        // Guardado con ÉXITO = el trabajo ya está en el servidor: el borrador local
        // deja de tener sentido (si sobreviviera, la próxima apertura ofrecería
        // "recuperar" algo idéntico a lo guardado).
        _borrarBorrador();
        _ocultarBarraBorrador();
        ST._guardando = false;
        if (btn) btn.textContent = actualizar ? '✓ Actualizado' : '✓ Guardado';
        if (nuevoBtn) nuevoBtn.disabled = false;
        _actualizarTitulos();                  // el titlebar muestra el nombre ya guardado
        if (typeof global.tplCargarGuardados === 'function') global.tplCargarGuardados();
        setTimeout(function () { _actualizarBtnGuardar(); }, 1500);
      })
      .catch(function (e) {
        ST._guardando = false;
        if (nuevoBtn) nuevoBtn.disabled = false;
        var msg = (e && e.message) || 'error desconocido';
        // El template desapareció mientras se editaba (otro usuario lo eliminó):
        // el trabajo NO se pierde — se le dice al usuario el camino para salvarlo.
        if (actualizar && e && e.status === 404) {
          ST.templateId = null;                // ya no hay a quién sobrescribir
          msg += ' Tu trabajo sigue aquí: usa «Guardar template» para crearlo de nuevo.';
        }
        _actualizarBtnGuardar();
        if (err) { err.textContent = 'No se pudo guardar: ' + msg; err.title = msg; }
      });
  }

  // "Guardar" = lo que diga el botón: actualiza el abierto o crea uno nuevo.
  global.templateEditorGuardar = function () {
    var btn = $('te_btnGuardar');
    if (btn && btn.disabled) return;
    _guardarTemplate(_puedeSobrescribir());
  };

  // "Guardar como nuevo" = SIEMPRE una copia (POST), aunque haya template abierto.
  global.templateEditorGuardarComoNuevo = function () {
    var btn = $('te_btnGuardarNuevo');
    if (btn && btn.disabled) return;
    _guardarTemplate(false);
  };

  // ==========================================================================
  // PANTALLA PREVIA (vive en tabs/catalogo.html · #catSubTemplates). Estos globals
  // los llaman los onclick/oninput del HTML y switchCatSubTab (catalogo/index.js).
  // ==========================================================================
  // Elemento con el que NACE un template nuevo. Ya no se elige en el tab (los 6
  // botones se sacaron): el selector de elemento vive DENTRO del editor y permite
  // cambiar viga ⇄ muro sin salir ni recrear (_cambiarElemento). VIGA porque es el
  // que trae semilla y era el que ya venía marcado por defecto en el tab.
  var TPL_ELEM_INICIAL = 'VIGA';

  // Dimensiones POR DEFECTO del elemento (cm). La grilla de dims salió del tab: se
  // aplican en silencio al crear y se editan DENTRO del modal (grupo HORMIGÓN del
  // ribbon).
  // Un campo puede escribir VARIAS claves de la geometría (d.ks: el "Recub bordes"
  // del muro = recub_sup + recub_inf). Sin ks, escribe la suya.
  function _tplDimsDefault(elem) {
    var may = String(elem || '').toUpperCase();
    var spec = TPL_DIMS_POR_ELEMENTO[may] || TPL_DIMS_POR_ELEMENTO.VIGA;
    var dims = {};
    spec.dims.concat(spec.recubs).forEach(function (d) {
      (d.ks || [d.k]).forEach(function (k) { dims[k] = d.def; });
    });
    // RECUBRIMIENTOS DE LA CONFIG (Catálogo › Templates › Configuración). Sólo pisan
    // las claves de recubrimiento; el largo/alto/ancho de partida siguen saliendo de
    // TPL_DIMS_POR_ELEMENTO (esa tabla no es configurable todavía). Sin config no
    // pasa nada: quedan los defaults de siempre.
    var cfg = global.ModeladorConfig;
    var recubs = (cfg && cfg.recubrimientos) ? cfg.recubrimientos(may) : null;
    if (recubs) {
      spec.recubs.forEach(function (d) {
        var v = Number(recubs[d.k]);
        if (!isFinite(v)) return;
        (d.ks || [d.k]).forEach(function (k) { dims[k] = v; });
      });
    }
    return dims;
  }

  // Validación de la card: sólo queda el NOMBRE (las dims se editan en el modal).
  global.tplValidar = function () {
    var nom = $('tplNombre');
    var nombreOk = !!(nom && nom.value.trim());
    var btn = $('tplBtnCrear'); if (btn) btn.disabled = !nombreOk;
    return true;
  };

  // Botón "🧱 Crear template" → abre el modal con el hormigón listo (defaults del
  // elemento) y CERO componentes.
  global.tplCrearTemplate = function () {
    var btn = $('tplBtnCrear'); if (btn && btn.disabled) return;
    if (!global.tplValidar()) return;
    var nom = $('tplNombre');
    global.templateEditorAbrir({
      elemento: TPL_ELEM_INICIAL,
      nombre: (nom ? nom.value.trim() : ''),
      dims: _tplDimsDefault(TPL_ELEM_INICIAL)
    });
  };

  function _tplFecha(iso) {
    var s = String(iso || '').slice(0, 10).split('-');
    return (s.length === 3) ? (s[2] + '-' + s[1] + '-' + s[0]) : (iso || '—');
  }

  // ==========================================================================
  // BIBLIOTECA DE TEMPLATES (card "Templates guardados")
  // --------------------------------------------------------------------------
  // La lista usa el GET LIVIANO (sin `params`: la receta completa pesa cientos de
  // KB por template y la lista sólo sirve para ELEGIR). La receta se pide con
  // GET /templates/{id} recién al abrir.
  // Los filtros los resuelve el BACKEND (?nombre= contiene · ?tipo=) — no se
  // filtra una copia local que se desincroniza en cuanto alguien guarda algo.
  // ==========================================================================
  var _tplLista = [];          // última lista pintada (para nombrar en el confirm de borrado)
  var _tplFiltroTimer = null;  // debounce del buscador (no una petición por tecla)

  function _tplPorId(id) {
    for (var i = 0; i < _tplLista.length; i++) {
      if (String(_tplLista[i].id) === String(id)) return _tplLista[i];
    }
    return null;
  }

  // Mensaje bajo el título de la card: verde (hecho) o rojo (no se pudo).
  function _tplMsg(texto, error) {
    var box = $('tplGuardadosMsg'); if (!box) return;
    if (!texto) { box.style.display = 'none'; box.textContent = ''; return; }
    box.style.display = 'block';
    box.style.color = error ? '#c62828' : '#33691e';
    box.style.background = error ? '#fff6f5' : '#f7fbf2';
    box.style.border = '1px solid ' + (error ? '#f3c6c2' : '#d7e8c2');
    box.textContent = texto;
  }

  // Opciones del filtro de ELEMENTO. Salen de TPL_DIMS_POR_ELEMENTO (la misma
  // tabla que ofrece el selector del editor): una lista escrita a mano en el HTML
  // se desincroniza en cuanto se agregue un elemento.
  function _tplRenderFiltroTipo() {
    var sel = $('tplFiltroTipo'); if (!sel || sel._teBound) return;
    sel._teBound = true;
    sel.innerHTML = '<option value="">Todos los elementos</option>' +
      Object.keys(TPL_DIMS_POR_ELEMENTO).map(function (k) {
        // value en MINÚSCULA: así se guarda `tipo` en templates_catalogo.
        return '<option value="' + _esc(k.toLowerCase()) + '">' + _esc(_capitalizar(k)) + '</option>';
      }).join('');
  }

  // ---------------------------------------------------------------------------
  // ORDEN DE LA BIBLIOTECA (toggle de la card)
  // ---------------------------------------------------------------------------
  // El backend devuelve la lista por id DESC (lo último creado arriba), que no
  // ayuda a encontrar nada cuando hay 30 templates. Se reordena ACÁ y no en el
  // servidor porque la lista completa ya está en el navegador: pedirla de nuevo
  // sólo para cambiar el orden sería un viaje al servidor por un click.
  //   'elemento' (default) — agrupa por tipo, en el orden canónico del tab, y
  //                          dentro de cada tipo por nombre.
  //   'fecha'              — lo editado más recientemente arriba.
  var TPL_ORDEN_ELEM = ['MURO', 'LOSA', 'VIGA', 'COLUMNA', 'FUNDACION', 'GEN'];
  var _tplOrden = 'elemento';

  function _tplOrdenar(lista) {
    var copia = (lista || []).slice();   // slice: no se reordena el array del llamador
    if (_tplOrden === 'fecha') {
      // La MISMA fecha que muestra la columna "Última edición": updated_at, o la de
      // creación en los templates anteriores a la migración 105. Son ISO, así que
      // comparar como texto ya ordena bien.
      copia.sort(function (a, b) {
        return String(b.updated_at || b.fecha || '').localeCompare(String(a.updated_at || a.fecha || ''));
      });
      return copia;
    }
    copia.sort(function (a, b) {
      var ia = TPL_ORDEN_ELEM.indexOf(String(a.tipo || '').toUpperCase());
      var ib = TPL_ORDEN_ELEM.indexOf(String(b.tipo || '').toUpperCase());
      // Un tipo que no esté en la lista canónica va al FINAL: con el -1 crudo de
      // indexOf se iría arriba de todo, que es justo donde no se le busca.
      if (ia < 0) ia = TPL_ORDEN_ELEM.length;
      if (ib < 0) ib = TPL_ORDEN_ELEM.length;
      if (ia !== ib) return ia - ib;
      return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' });
    });
    return copia;
  }

  // Qué botón del toggle se ve activo. Se pinta desde _tplOrden (y no al hacer
  // click) para que no pueda quedar marcado uno y aplicado el otro.
  function _tplPintarOrden() {
    [['elemento', 'tplOrdenElemento'], ['fecha', 'tplOrdenFecha']].forEach(function (par) {
      var b = $(par[1]);
      if (b && b.classList) b.classList.toggle('on', _tplOrden === par[0]);
    });
  }

  global.tplSetOrden = function (orden) {
    _tplOrden = (orden === 'fecha') ? 'fecha' : 'elemento';
    _tplPintarLista(_tplLista);   // la lista ya está en memoria: no se vuelve a pedir
  };

  // KPI de una fila. `valor` null/undefined = el backend NO manda ese dato: se
  // pinta un guion, NO un 0 ni una estimación calculada de la nada. Un 0 haría
  // creer que el template está vacío y un número inventado es peor todavía.
  function _tplKpi(valor, sufijo) {
    if (valor == null || valor === '') {
      return '<span class="muted" title="Este dato todavía no se calcula para la lista: se ve al abrir el template">—</span>';
    }
    return _esc(valor) + (sufijo ? ' <span class="muted" style="font-size:10px;">' + _esc(sufijo) + '</span>' : '');
  }

  function _tplPintarLista(templates) {
    var cont = $('tplGuardadosLista'); if (!cont) return;
    _tplLista = templates || [];
    _tplPintarOrden();
    var cnt = $('tplGuardadosCount');
    if (cnt) cnt.textContent = _tplLista.length + ' template' + (_tplLista.length === 1 ? '' : 's');
    if (!_tplLista.length) {
      cont.innerHTML = _tplHayFiltro()
        ? '<div class="muted">Ningún template coincide con la búsqueda.</div>'
        : '<div class="muted">Aún no hay templates guardados. Crea el primero aquí arriba.</div>';
      return;
    }
    var th = 'style="padding:5px 6px; font-size:10.5px; text-transform:uppercase; text-align:left;" class="muted"';
    var thN = 'style="padding:5px 6px; font-size:10.5px; text-transform:uppercase; text-align:right;" class="muted"';
    var tdN = 'style="padding:4px 6px; text-align:right; font-variant-numeric:tabular-nums;"';
    var btnCss = 'border:1px solid #dbe1e8; background:#fff; border-radius:7px; font-size:11.5px; padding:4px 12px; cursor:pointer;';
    cont.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
      '<tr><th ' + th + '>Nombre</th><th ' + th + '>Tipo</th>' +
      '<th ' + thN + '>Comp.</th><th ' + thN + '>Barras</th><th ' + thN + '>Peso est.</th><th ' + thN + '>φ prom</th>' +
      '<th ' + th + '>Obra</th><th ' + th + '>Última edición</th>' +
      '<th ' + thN + '>Administrar</th></tr>' +
      _tplOrdenar(_tplLista).map(function (t) {
        var tipo = String(t.tipo || '').toUpperCase();
        var col = TPL_ELEM_COLORES[tipo] || '#607d8b';
        // updated_at sólo existe desde la migración 105: en los templates viejos se
        // muestra la fecha de creación (no se inventa una edición que no hubo).
        var edit = t.updated_at || t.fecha;
        var quien = t.editado_por || t.creado_por || '';
        var puedo = (t.puede_modificar !== false);
        // n_componentes es LO ÚNICO que manda el GET liviano. Antes esta cifra se
        // rotulaba "N barras", que es falso: un componente en distribución genera
        // muchas barras. Las tres KPI que faltan van en '—' hasta que el backend
        // las mande (n_barras, kg estimados y φ promedio de la receta).
        var comps = (t.n_componentes == null) ? null : Number(t.n_componentes);
        // LA FILA ENTERA ABRE EL TEMPLATE (19-ago). Antes habia un boton "Abrir" al final
        // que competia con el basurero en la misma celda y se leia como dos cajas sueltas.
        // La fila es el objetivo natural: es lo que uno intenta clicar.
        return '<tr data-id="' + _esc(t.id) + '" class="tplFila"' +
          ' onclick="tplAbrirTemplate(this.getAttribute(\'data-id\'))"' +
          ' title="Abrir este template para seguir editandolo"' +
          ' style="border-bottom:1px solid #eee; cursor:pointer;">' +
          '<td style="padding:4px 6px; font-weight:700;">' + _esc(t.nombre) +
            (t.creado_por ? '<div class="muted" style="font-weight:400; font-size:10.5px;">' + _esc(t.creado_por) + '</div>' : '') + '</td>' +
          '<td style="padding:4px 6px;"><span style="font-size:10px; text-transform:uppercase; font-weight:700; color:#fff; background:' + col + '; border-radius:8px; padding:1px 7px;">' + _esc(tipo) + '</span></td>' +
          '<td ' + tdN + '>' + _tplKpi(comps) + '</td>' +
          '<td ' + tdN + '>' + _tplKpi(t.n_barras) + '</td>' +
          '<td ' + tdN + '>' + _tplKpi(t.kg_estimado, 'kg') + '</td>' +
          '<td ' + tdN + '>' + _tplKpi(t.diam_promedio, 'mm') + '</td>' +
          '<td style="padding:4px 6px;">' + _esc(t.obra_nombre || (t.obra ? t.obra : 'General')) + '</td>' +
          '<td style="padding:4px 6px;">' + _esc(_tplFecha(edit)) +
            (quien ? '<div class="muted" style="font-size:10.5px;">' + _esc(quien) + '</div>' : '') + '</td>' +
          // ADMINISTRAR EL TEMPLATE — RENOMBRAR y ELIMINAR, con palabra y no sólo
          // con icono (25-ago, pedido del usuario: «me falta un botón para eliminar y
          // administrar templates, ya que hoy no los puedo eliminar»). El basurero
          // ESTABA, pero al 35% de opacidad y encendiéndose sólo al pasar el cursor
          // por la fila: para el usuario no existía. Es la tercera vez en la semana
          // que un control escondido tras un hover se reporta como «no está», así que
          // acá se ven los dos, siempre.
          // Sólo a quien el BACKEND dijo que puede (puede_modificar): un botón que
          // siempre termina en 403 no es un botón, es una trampa.
          '<td style="padding:4px 6px; text-align:right; white-space:nowrap;">' +
            '<button data-id="' + _esc(t.id) + '"' + (puedo ? '' : ' disabled') +
            ' class="tplAccion tplRenombrar" onclick="event.stopPropagation(); tplRenombrarTemplate(this.getAttribute(\'data-id\'))"' +
            ' title="' + (puedo ? 'Cambiarle el nombre' : 'Sólo su autor (o un administrador) puede editarlo') + '">Renombrar</button>' +
            '<button data-id="' + _esc(t.id) + '"' + (puedo ? '' : ' disabled') +
            ' class="tplAccion tplBorrar" onclick="event.stopPropagation(); tplEliminarTemplate(this.getAttribute(\'data-id\'))"' +
            ' title="' + (puedo ? 'Eliminar este template' : 'Sólo su autor (o un administrador) puede eliminarlo') + '">🗑 Eliminar</button>' +
          '</td></tr>';
      }).join('') +
      '</table>' +
      // Pendiente A LA VISTA, no escondido en un comentario: mientras GET /templates
      // no traiga estos tres campos, las columnas quedan en '—'. Dicho SIN nombrar el
      // endpoint: quien lee esta pantalla cubica fierro, no llama a la API.
      '<div class="muted" style="font-size:10.5px; margin-top:8px;">Barras, peso y φ promedio ' +
      '<b>todavía no se calculan para la lista</b>: se ven al abrir el template. El peso, cuando ' +
      'llegue acá, es <b>estimado</b> (depende del hormigón contra el que se genere).</div>';
  }

  function _tplHayFiltro() {
    var b = $('tplBuscar'), s = $('tplFiltroTipo');
    return !!((b && b.value && b.value.trim()) || (s && s.value));
  }

  // Al entrar al sub-tab (switchCatSubTab → aquí), tras guardar y tras eliminar:
  // GET /templates con los filtros puestos.
  global.tplCargarGuardados = function () {
    global.tplValidar();
    _tplRenderFiltroTipo();
    // El toggle de orden se pinta ya, antes del fetch: si no, al entrar al sub-tab
    // los dos botones se ven apagados hasta que responda el servidor.
    _tplPintarOrden();
    var cont = $('tplGuardadosLista'); if (!cont) return;
    var b = $('tplBuscar'), s = $('tplFiltroTipo');
    var q = [];
    if (b && b.value && b.value.trim()) q.push('nombre=' + encodeURIComponent(b.value.trim()));
    if (s && s.value) q.push('tipo=' + encodeURIComponent(s.value));
    cont.innerHTML = '<div class="muted">Cargando templates…</div>';
    _tplFetch('/templates' + (q.length ? ('?' + q.join('&')) : ''), { headers: _tplHeaders(false) })
      .then(function (data) { _tplPintarLista((data && data.templates) || []); })
      .catch(function (e) {
        var cnt = $('tplGuardadosCount'); if (cnt) cnt.textContent = '';
        _tplLista = [];
        cont.innerHTML = '<div class="muted">' + _esc((e && e.message) || 'No se pudieron cargar los templates.') +
          ' <a onclick=tplCargarGuardados() style="cursor:pointer; text-decoration:underline;">Reintentar</a></div>';
      });
  };

  // Buscador y filtro: se recarga desde el servidor con un respiro de 250 ms para
  // no disparar una petición por tecla.
  global.tplFiltrarGuardados = function () {
    if (_tplFiltroTimer) global.clearTimeout(_tplFiltroTimer);
    _tplFiltroTimer = global.setTimeout(function () {
      _tplFiltroTimer = null;
      global.tplCargarGuardados();
    }, 250);
  };

  global.tplLimpiarFiltros = function () {
    var b = $('tplBuscar'); if (b) b.value = '';
    var s = $('tplFiltroTipo'); if (s) s.value = '';
    global.tplCargarGuardados();
  };

  // Click "Abrir" en la lista → GET /templates/{id} → abre el modal con la receta.
  global.tplAbrirTemplate = function (id) {
    _tplMsg('');
    _tplFetch('/templates/' + encodeURIComponent(id), { headers: _tplHeaders(false) })
      .then(function (t) {
        global.templateEditorAbrir({
          elemento: String(t.tipo || 'viga').toUpperCase(),
          nombre: t.nombre || '',
          dims: (t.params && t.params.geometria) || null,
          receta: t.params,
          templateId: t.id,
          obra: (t.obra != null) ? t.obra : null,
          // Lo decide el backend (autor o admin). Con false, "Guardar" ofrece copia
          // en vez de mandar un PUT que ya sabemos que va a dar 403.
          puedeModificar: (t.puede_modificar !== false)
        });
      })
      .catch(function (e) {
        var msg = (e && e.message) || 'No se pudo abrir el template.';
        if (e && e.status === 404) msg += ' Actualiza la lista.';
        _tplMsg('No se pudo abrir el template: ' + msg, true);
      });
  };

  // RENOMBRAR desde la lista. El PUT es no destructivo —sólo escribe los campos que
  // viajan—, así que mandar el nombre solo no toca la receta, ni la obra, ni el tipo.
  // Es la otra mitad de «administrar templates»: hasta hoy, un nombre mal puesto
  // obligaba a guardar una copia y borrar el original.
  global.tplRenombrarTemplate = function (id) {
    var t = _tplPorId(id);
    var actual = (t && t.nombre) ? t.nombre : '';
    _tplMsg('');
    var nuevo = global.prompt('Nombre del template:', actual);
    if (nuevo == null) return;                       // canceló
    nuevo = String(nuevo).trim();
    if (!nuevo || nuevo === actual) return;
    _tplFetch('/templates/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: _tplHeaders(true),
      body: JSON.stringify({ nombre: nuevo })
    })
      .then(function () {
        // Si el editor tiene ABIERTO ese template, su título ya no dice la verdad.
        if (ST.templateId != null && String(ST.templateId) === String(id)) {
          ST.nombre = nuevo;      // el campo del editor, que es de donde sale el titulo
          _actualizarTitulos();
        }
        _tplMsg('Ahora se llama «' + nuevo + '».');
        global.tplCargarGuardados();
      })
      .catch(function (e) {
        _tplMsg((e && e.message) || 'No se pudo renombrar el template.', true);
      });
  };

  // Eliminar desde la lista. Confirmación que NOMBRA el template (un "¿Eliminar?"
  // pelado sobre una tabla es una ruleta) y 409 tratado como lo que es: el
  // template está en uso, NO se borra y se dice cuántos elementos lo usan.
  global.tplEliminarTemplate = function (id) {
    var t = _tplPorId(id);
    var nombre = (t && t.nombre) ? t.nombre : ('#' + id);
    _tplMsg('');
    var texto = 'Eliminar el template «' + nombre + '»' +
      (t && t.tipo ? (' (' + String(t.tipo).toUpperCase() + ')') : '') + '.\n\n' +
      'Se borra de la biblioteca y no se puede deshacer.\n' +
      'Las barras ya cargadas a un lote NO se tocan.';
    if (!global.confirm(texto)) return;
    _tplFetch('/templates/' + encodeURIComponent(id), { method: 'DELETE', headers: _tplHeaders(false) })
      .then(function () {
        // Si el editor tenía ABIERTO ese template, deja de apuntar a un id que ya no
        // existe: el próximo "Guardar" lo crea de nuevo en vez de dar 404.
        if (ST.templateId != null && String(ST.templateId) === String(id)) {
          ST.templateId = null;
          ST.puedeModificar = true;
          _actualizarTitulos();
          _actualizarBtnGuardar();
        }
        _tplMsg('Template «' + nombre + '» eliminado.');
        global.tplCargarGuardados();
      })
      .catch(function (e) {
        // 409 = tiene instancias: el detail del backend ya dice CUÁNTAS. No se borra.
        _tplMsg((e && e.message) || 'No se pudo eliminar el template.', true);
      });
  };

  // Exponer para tests / depuración.
  global.TemplateEditor = {
    // GESTOR DE TEMPLATES (card del tab): orden de la biblioteca y KPI de la fila.
    _tplOrdenar: _tplOrdenar, _tplKpi: _tplKpi, _tplPintarLista: _tplPintarLista,
    _st: ST, _regenerar: function () { _regenerar(); },
    _colocarEnVista: _colocarEnVista, _rotarSeleccion: _rotarSeleccion,
    _borrarSeleccion: _borrarSeleccion,
    // SELECCION MULTIPLE: expuestos para que la suite maneje el gesto (ctrl+clic) y
    // no una imitacion de lo que el gesto deja escrito.
    _seleccionar: _seleccionar, _alternarSeleccion: _alternarSeleccion,
    _selTodos: _selTodos, _estaSeleccionado: _estaSeleccionado, _duplicar: _duplicar,
    _seleccionarTramo: _seleccionarTramo, _detalleMultiple: _detalleMultiple,
    _compEl: _compEl,   // la teja, para poder verificar que trae su papelera
    _medidaLadoReal: _medidaLadoReal, _refrescarMedidasLados: _refrescarMedidasLados,
    _anidadoCambiaAlgo: _anidadoCambiaAlgo,
    _entrarModoColocacion: _entrarModoColocacion, _salirModoColocacion: _salirModoColocacion,
    _rolDe: _rolDe, _rolComp: _rolComp,
    // PALETA ÚNICA — la consume panel_3d, que tenía su propia tabla ya divergida
    // (LT distinto y sin ninguna tipología de muro/losa/columna).
    colorDeTipologia: _colDe,
    boundaryDeVista: boundaryDeVista, _rectPlano: _rectPlano,   // P2/base task2
    setPlanoActivo: _setPlanoActivo,                            // P3 — 'seccion'|'largo'|'planta'|null
    // INTERACCIÓN-2.0 · ghost + grosor + clamp + undo
    _pushUndo: _pushUndo, _undo: _undo,
    // CICLO DE VIDA DEL TEMPLATE (guardar/actualizar/eliminar + normalizador)
    _actualizarBtnGuardar: _actualizarBtnGuardar, _puedeSobrescribir: _puedeSobrescribir,
    _guardarTemplate: _guardarTemplate, _sellarGuardado: _sellarGuardado,
    _msgHttp: _msgHttp, _nombreLimpio: _nombreLimpio,
    // Conteo por componente para el hit-testing 2D. Expuesto porque expande, y
    // expandir MUTA: el test congela que lo hace sobre un CLON y no le re-deriva
    // la posición a la barra con un host que no es el de la generación real.
    _etiquetarCi: _etiquetarCi,
    _normalizarRecetaViva: _normalizarRecetaViva, _avisarMigracion: _avisarMigracion,
    _migracionDe: _migracionDe,
    // TANDA 3 · no perder trabajo + capeo del @
    _hayCambiosSinGuardar: _hayCambiosSinGuardar,
    _guardarBorradorAhora: _guardarBorradorAhora, _programarBorrador: _programarBorrador,
    _leerBorrador: _leerBorrador,
    _borrarBorrador: _borrarBorrador, _ofrecerBorrador: _ofrecerBorrador,
    _geoValida: _geoValida, _geoConDefaults: _geoConDefaults,
    _motivoGeoInvalida: _motivoGeoInvalida, SEP_MIN: SEP_MIN,
    _dentroDelBoundary: _dentroDelBoundary, _clampAlBoundary: _clampAlBoundary,
    _sellarCargado: _sellarCargado, _soltarCargado: _soltarCargado,
    // RECUBRIMIENTO: hoy un solo campo. _setRecubPorCara(true) re-expone los campos
    // por cara (es el gancho del botón futuro con la isométrica).
    _geoCampos: _geoCampos, _setRecubPorCara: _setRecubPorCara,
    _ghostForma: _ghostForma,
    // Ghost con la FORMA REAL: la polilínea proyectada y el componente de preview
    // (el MISMO que crea el clic) — para poder comparar ghost ≡ barra colocada.
    _ghostPlacement: _ghostPlacement, _ghostFormaBasica: _ghostFormaBasica,
    _compDesdeClick: _compDesdeClick,
    // TANDA P · POSE CANÓNICA {cara, lado, rumbo, espejo} + rotar-en-vista
    _poseDe: _poseDe, _setPose: _setPose,
    _poseDefault: _poseDefault, _poseDefaultMotor: _poseDefaultMotor,
    _rumbosDeCara: _rumbosDeCara, _rumboValido: _rumboValido, _rumboDefaultDeCara: _rumboDefaultDeCara,
    // BLOQUE ORIENTACIÓN (22-ago) — la PRESENTACIÓN de la pose: las 6 caras aplanadas
    // (cara+lado en un solo control), sus nombres de obra, el rumbo y la FRASE de
    // estado. Se exportan para que el test headless congele que la frase describe la
    // pose y que las 24 orientaciones siguen siendo alcanzables desde estos controles.
    _CARAS6: _CARAS6, _cara6: _cara6, _caraId: _caraId, _nombreCara6: _nombreCara6,
    _nombreRumbo: _nombreRumbo, _fraseOrientacion: _fraseOrientacion, _iconoCara6: _iconoCara6,
    rotarPoseEnVista: rotarPoseEnVista,                         // gira 90° en el eje de profundidad de la vista
    _rotarPoseSeleccion: _rotarPoseSeleccion, _vistaActiva: _vistaActiva,
    _ejeProfundidadDeVista: _ejeProfundidadDeVista,
    _reencuadrarReparto: _reencuadrarReparto,
    _ladoDominante: _ladoDominante,                             // parcial que se estira/ancla
    // LADO DOMINANTE: verlo en el preview (tramo destacado) y elegirlo en la ficha
    _ladoDomMotor: _ladoDomMotor,                               // el del MOTOR, sin fallback
    _ladoDomElegido: _ladoDomElegido, _setLadoDominante: _setLadoDominante,
    _tramoDominanteEnTrazo: _tramoDominanteEnTrazo,             // rango [i0,i1] en el trazo
    // COTAS POR LADO (gate SHIFT) — el mapeo lado↔trazo y el filtro de visibilidad
    // son funciones PURAS a propósito: el test headless las corre sin DOM.
    _verticesDelTrazo: _verticesDelTrazo, _tramosRectos: _tramosRectos,
    _tramosEnTrazo: _tramosEnTrazo, _ladosMarcoEnTrazo: _ladosMarcoEnTrazo,
    _ladosRotulables: _ladosRotulables, _ladoVisibleEnPlano: _ladoVisibleEnPlano,
    _setCotas: _setCotas, _dibujarCotasLados: _dibujarCotasLados,
    // RÓTULO DEL LARGO DEL ABANICO (19-ago) — la distancia que recorre la distribución,
    // editable en pantalla. Se exponen la CUENTA (_largoRango), la ESCRITURA
    // (_setLargoRango / _setLongTramo) y el DIBUJO (_dibujarFlechaRango) para que el
    // test headless compruebe que el rótulo, el panel y el motor dicen lo mismo.
    _largoRango: _largoRango, _rangoLong: _rangoLong, _setLargoRango: _setLargoRango,
    _tramosDe: _tramosDe, _tramosElasticosDe: _tramosElasticosDe,
    _setTramos: _setTramos, _setLongTramo: _setLongTramo,
    _moverDivisor: _moverDivisor, _addTramo: _addTramo, _delTramo: _delTramo,
    _syncTramos: _syncTramos,
    _syncN: _syncN, _anclarRangoUI: _anclarRangoUI, _rangoDefault: _rangoDefault,
    _dibujarFlechaRango: _dibujarFlechaRango, PASO_ARRASTRE_CM: PASO_ARRASTRE_CM,
    // COTAS VIVAS DEL ARRASTRE (20-ago) — el número que se ve mientras se mueve un
    // abanico. Se exponen la CUENTA (_anclaViva, que es la del motor) y su
    // referencia (_coordRefAncla) para que el test headless compruebe que dicen lo
    // mismo que el ancla que la receta guarda, y no una cuenta paralela.
    _anclaViva: _anclaViva, _coordRefAncla: _coordRefAncla,
    _cotasVivas: _cotasVivas, _arrastrandoLinea: _arrastrandoLinea,
    // …y las de la PIEZA (etapa 2): el hueco real entre el bbox y la cara —contra el
    // RECUBRIMIENTO si se está redimensionando, contra el HORMIGÓN si se mueve.
    _cotasVivasPieza: _cotasVivasPieza, _arrastrandoPieza: _arrastrandoPieza,
    _lineasRecubEje: _lineasRecubEje, _facesEje: _facesEje,
    // POSICIÓN MEDIDA (21-ago · tres pares de campos desde el 23-ago) — el número que
    // la ficha escribe. Se exponen la MEDIDA al BORDE del acero (_huecoACara sobre
    // _bboxCompMundo), los EJES en los que manda el desplazamiento (_ejesDesplazables)
    // y la ESCRITURA (_setHuecoACara), que es la misma puerta del arrastre; para el eje
    // que reparte, las dos puntas del rango (_puntaRangoACara / _setPuntaRangoACara).
    _bboxCompMundo: _bboxCompMundo, _huecoACara: _huecoACara,
    _ejesDesplazables: _ejesDesplazables, _setHuecoACara: _setHuecoACara,
    _rangoDeEje: _rangoDeEje, _puntaRangoACara: _puntaRangoACara,
    _setPuntaRangoACara: _setPuntaRangoACara, _iconoCaras6: _iconoCaras6,
    _filasDesplazamiento: _filasDesplazamiento, _carasObraEje: _carasObraEje,
    // El panel sigue al gesto EN VIVO: los campos que el arrastre escribe (rango,
    // largo de tramo, Δ) se releen de la receta sin re-armar el DOM de la ficha.
    _refrescarPanelVivo: _refrescarPanelVivo,
    _ruedaRotulo: _ruedaRotulo,     // la rueda sobre el rótulo: ±1 cm y NO le roba el zoom al cuadrante
    _abrirEditorLargo: _abrirEditorLargo, _abrirEditorLargoTramo: _abrirEditorLargoTramo,
    _abrirEditorAt: _abrirEditorAt,   // el clic sobre cada rótulo (camino real de la edición)
    _rangoEditor: _rangoEditor,     // el campo del panel (su ._rotulo() lleva el mismo largo)
    // LOS DOS PIVOTES: el centro del elemento (giro normal) y el punto señalado (ctrl)
    _placementsSeleccion3D: _placementsSeleccion3D, _centroSeleccion3D: _centroSeleccion3D,
    _centroDePlacements: _centroDePlacements, _centroElemento3D: _centroElemento3D,
    _rayoDesdeCursor: _rayoDesdeCursor, _acercarRayoSegmento: _acercarRayoSegmento,
    _cortarCajaConRayo: _cortarCajaConRayo, _puntoBajoCursor3D: _puntoBajoCursor3D,
    _pivoteDelCursor: _pivoteDelCursor, PICK_PX: PICK_PX, EMPATE_PX: EMPATE_PX,
    _proyectarEnCuadrante: _proyectarEnCuadrante,                 // pantalla: el punto rosado y las medidas de los tests
    _dibujarPivote: _dibujarPivote, _ocultarPivote: _ocultarPivote,   // el punto rosado en sí (camino DOM, medido en C9)
    _pivotarEnSinMover: _pivotarEnSinMover, _puntoCentroPantalla: _puntoCentroPantalla,
    _restaurarPivoteGuardado: _restaurarPivoteGuardado,           // lo que corre al soltar el ctrl
    // MODELO DE CÁMARA (quaternion) + la órbita y su descomposición inversa
    _baseCam: _baseCam, _ojoCam: _ojoCam, _quatDeAngulos: _quatDeAngulos, CAM0: CAM0,
    _girarPorArrastre: _girarPorArrastre, _girarCamRigido: _girarCamRigido,
    _orbitarMundo: _orbitarMundo, _fijarCamDesdeOjo: _fijarCamDesdeOjo,
    _estadoCamara: _estadoCamara, _applyCam: _applyCam,
    _factorZoomRueda: _factorZoomRueda, _clampDist: _clampDist,   // zoom de rueda + techo de acercamiento
    FOV3D: FOV3D, _distEncuadre: _distEncuadre,                   // lente + encuadre automático
    _zoomAlCursor: _zoomAlCursor,                                 // zoom que clava el punto bajo el cursor
    _compDesc: _compDesc, _coloresDeReceta: _coloresDeReceta,     // línea del componente + archivador de colores
    _pasoGrilla2D: _pasoGrilla2D, _aplicarTema3D: _aplicarTema3D, // grilla 2D + tema de los 4 cuadrantes
    _rectElementoEnViewBox: _rectElementoEnViewBox,               // letterbox del overlay: rect del elemento en unidades del viewBox
    _subirPaso1_2_5: _subirPaso1_2_5, _nLineasGrilla2D: _nLineasGrilla2D,
    _ST: ST,                                                      // estado (lo usan los tests headless)
    // INTERACCIÓN-2.0 · orientación de la pieza + snap de cara
    rotarPlanoPieza: rotarPlanoPieza,                           // cicla (o fija) la orientación + regenera
    _orientacionDe: _orientacionDe, _orientacionSiguiente: _orientacionSiguiente,
    _caraDeEje: _caraDeEje,
    _facesDeVista: _facesDeVista, _caraCercana: _caraCercana,   // snap de cara
    // ESPEJAR: la suite maneja el gesto entero (armar, elegir cara, soltar).
    _armarEspejo: _armarEspejo, _salirEspejo: _salirEspejo, _espejarEnCara: _espejarEnCara,
    _ejeDistDe: _ejeDistDe,                                     // eje de reparto (x | z si volteada)
    _transformDesdeCamara: _transformDesdeCamara,               // G7 — overlay ≡ cámara orto
    _signosPantalla: _signosPantalla, _pixelToUV: _pixelToUV, _uvToPixel: _uvToPixel,
    // INTERACCIÓN-2.0 · 3 modos de uso (puntual/lineal/arreglo)
    _modoDe: _modoDe, _modoDefault: _modoDefault, _setModoComp: _setModoComp,
    _metaModular: _metaModular,
    // CATÁLOGO DE FIGURAS (fuente única = ModeladorCatalogoFiguras)
    _figSpec: _figSpec, _figError: _figError, _figsDibujables: _figsDibujables,
    _motivoNoDibujable: _motivoNoDibujable,
    _cargarCatalogoFiguras: _cargarCatalogoFiguras, _refrescarFigDatalist: _refrescarFigDatalist,
    // BARRA RÁPIDA DE FIGURAS (matriz 2×5 del ribbon)
    TE_FIGS_RAPIDAS: TE_FIGS_RAPIDAS, _svgFigRapida: _svgFigRapida,
    _renderFigsRapidas: _renderFigsRapidas, _elegirFiguraRapida: _elegirFiguraRapida,
    _aplicarFiguraRibbon: _aplicarFiguraRibbon,
    // FIGURA vs TIPOLOGÍA (aviso, no bloqueo)
    _figsDeTipologia: _figsDeTipologia, _figsDeTipologiaActiva: _figsDeTipologiaActiva,
    _figAvisoTipologia: _figAvisoTipologia, _validarFiguraRibbon: _validarFiguraRibbon,
    _actualizarStatus: _actualizarStatus,   // la barra de estado lleva el aviso
    // MOVER A MANO (apagado): expuestos para que la suite congele la política —que la
    // llave está en false y que un arrastre marcado `bloq` no toca la barra.
    _dragMover: _dragMover, _MOVER_A_MANO: TE_MOVER_A_MANO,
    // TIRADOR DEL MARCO: expuestos para que la suite maneje el gesto completo
    // (agarrar un borde y arrastrarlo), no una imitacion de lo que el gesto escribe.
    _iniciarDragMarco: _iniciarDragMarco, _dragMarcoMove: _dragMarcoMove,
    // TIPOLOGÍA vs ELEMENTO (marca PERSISTENTE: sobrevive al primer clic)
    _tipAjenaAlElemento: _tipAjenaAlElemento,
    // SELECTOR DE ELEMENTO dentro del editor (viga ⇄ muro sin salir ni recrear)
    _elementoConDatos: _elementoConDatos, _renderElemSel: _renderElemSel,
    _bindElemSel: _bindElemSel, _cambiarElemento: _cambiarElemento,
    // FICHA POR FAMILIA (contorno cerrado ⇒ sin patas ni empalme)
    _familiaDibujo: _familiaDibujo, _esContornoCerrado: _esContornoCerrado,
    // ficha del componente (el panel de dims dinámico sale de los parciales del catálogo)
    _compBody: _compBody
  };

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
