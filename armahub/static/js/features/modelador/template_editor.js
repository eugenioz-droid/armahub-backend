// =============================================================================
// Template Editor — Colocador por proyecciones (sub-tab del Catálogo).
// Cablea el modal tabs/template_editor_modal.html (calca static/demo/colocador.html).
//
// Esta entrega convierte los 3 cuadrantes 2D de SOLO-VISUALIZACIÓN a un
// EDITOR INTERACTIVO (§DISCOVERY-INTERACCIÓN del programa):
//   - COLOCAR (modo): "＋ Agregar barra" (ribbon) / "＋ Agregar componente" (panel)
//     entran en MODO COLOCACIÓN; figura+tipología del ribbon → clic en una vista 2D → nace un
//     componente anclado a la cara clicada (estribo "toma contorno"; barra con
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
    // mundo: 2 grados de libertad y sin alabeo. Ese modelo NO da para girar en torno
    // a un eje cualquiera —el eje propio de la pieza, que es lo que hace ctrl—:
    // girar sobre un eje horizontal INCLINA el horizonte (tercer grado que no
    // existía) y encima pasa por el cenit, donde la pareja (elevación, acimut) es
    // singular: la base se degenera porque |derecha| = cos(elev) → 0 y el gesto se
    // trababa justo ahí. Con el quaternion los 3 grados están, el cenit no es un
    // punto especial y ctrl gira 360° sin trabarse. La órbita normal NO cambió: se
    // compone EXACTAMENTE el mismo par de giros (ver _girarPorArrastre).
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
    figura: '', tipologia: 'CBS', diam: null, contorno: true,
    tool: 'mover', snap: true, cotas: false,   // arranca en SELECCIONAR (flechita), no colocando
    selCi: -1,                 // índice del componente seleccionado (-1 = ninguno)
    ultimoPlano: 'largo',      // última vista tocada (define el eje de rotación)
    transforms: {},            // {plano: {minU,maxU,minV,maxV,s,offX,offY}}
    dragMove: null,            // {ci, plano, startHost, startHint} durante mover
    dragMarco: null,           // arrastre del marco de la barra (ver _iniciarDragMarco)
    dragRango: null,           // {ci} durante arrastre de la flechita doble
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
    //   { figura, tipologia, diam, contorno } | null. Se setea al elegir
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
    _catPedido: false
  };

  function $(id) { return document.getElementById(id); }

  function _deps() {
    return {
      gen: global.ModeladorGenerar,
      geom: global.ModeladorMotorGeom,
      reglas: global.ModeladorReglas,
      semilla: global.ModeladorSemilla
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

  // Texto compacto de la pose para la ficha / tooltips: "cara sup · corre en largo (Y)".
  // La LETRA del eje sale siempre de _ejeLetra (única traducción interno→visible).
  var _CARA_TXT = { sup: 'cara sup', inf: 'cara inf', lateral: 'cara lateral', extremo: 'extremo' };
  function _poseTexto(p) {
    if (!p) return '';
    var t = _CARA_TXT[p.cara] || ('cara ' + p.cara);
    if (p.cara === 'lateral' || p.cara === 'extremo') t += (p.lado < 0 ? ' −' : ' +');
    t += ' · corre en ' + (_EJE_NOMBRE[p.rumbo] || p.rumbo) + ' (' + _ejeLetra(p.rumbo) + ')';
    if (p.espejo) t += ' · espejada';
    return t;
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

  // dims por defecto para una figura recién colocada. Estribo con "tomar contorno"
  // → todas auto (se ajustan al recubrimiento; recub 0 = al borde). Cabezal con
  // lados → B auto (largo − recub), patas A/C fijas.
  function _dimsDefault(fig, rol, contorno) {
    var spec = _figSpec(fig);
    var dims = {};
    // TODO EN AUTO, para todos los roles (pedido del usuario 13-ago, tras el
    // AUTO universal): cada lado se ancla solo a lo que su dirección cruza
    // (diagonal → gancho normativo · perpendicular → profundidad útil · a lo
    // largo → largo útil). Los defaults fijos anteriores (15 y luego el gancho)
    // eran muletas de cuando las patas en auto no se anclaban a nada.
    spec.parciales.forEach(function (L) { dims[L] = { modo: 'auto' }; });
    if (rol === 'estribo' && contorno === false) dims.__contorno = false;
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

  function _anclarHintUI(comp) {
    var d = _deps();
    if (!comp || !d.reglas || typeof d.reglas.anclarPosHint !== 'function') return comp;
    try { d.reglas.anclarPosHint(comp, _hostDeReceta(), true); } catch (e) { /* idem */ }
    return comp;
  }

  // Rango por defecto (toda la dimensión útil del EJE DE DISTRIBUCIÓN) para los modos
  // que lo necesitan. `eje` = 'x' (normal) | 'z' (pieza volteada) | 'y'.
  function _rangoDefault(sep, eje) {
    var g = ST.receta.geometria;
    var dim, r;
    if (eje === 'z') { dim = Number(g.ancho); r = (g.recub_lat != null ? Number(g.recub_lat) : 3); }
    else if (eje === 'y') { dim = Number(g.alto); r = (g.recub_sup != null ? Number(g.recub_sup) : 4); }
    else { dim = Number(g.largo); r = 4; }
    // `eje` SIEMPRE declarado: sin él, el distribuidor cae a X y un rango de
    // cabezal (valores en Z, ±ancho/2) se interpretaba como X → 2 barras juntas.
    var rg = { from: -dim / 2 + r, to: dim / 2 - r, sep: sep || 20, eje: (eje === 'y' || eje === 'z') ? eje : 'x' };
    return _anclarRangoUI(rg, rg.eje);   // nace anclado a los bordes (r cm de cada uno)
  }

  // ==========================================================================
  // TRAMOS DEL RANGO (reparto multi-@) — contrato del motor:
  //     cfg.rango.tramos = [{long, sep}, ...]
  // Largos y @ en cm, en orden desde rango.from hacia rango.to; su suma cubre el
  // rango completo. UN SOLO tramo = el comportamiento de siempre, y en ese caso NO se
  // escribe `tramos`: manda el @ simple (d.sep), que se mantiene como atajo del panel.
  // Los tramos SUBDIVIDEN el rango; el largo total lo siguen mandando sus handles.
  // ==========================================================================
  function _rangoLong(d) {
    var r = d && d.rango;
    if (!r || r.from == null || r.to == null) return 0;
    return Math.abs(Number(r.to) - Number(r.from));
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

  // El rango cambió de largo (handles, campos from/to) → los tramos se renormalizan
  // para seguir cubriéndolo. Sin esto, el motor leería longs viejos que ya no suman.
  function _syncTramos(d) {
    if (d && d.rango && d.rango.tramos && d.rango.tramos.length > 1) _setTramos(d, _tramosDe(d));
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
      if (c.pos_hint) delete c.pos_hint[ejeD];   // el rango la distribuye
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
  function _etiquetarCi(out) {
    var d = _deps();
    if (!out || !out.placements || !d.reglas) return;
    var host = _hostDeReceta();
    var idx = 0;
    (ST.receta.componentes || []).forEach(function (comp, ci) {
      var n = d.reglas.expandirComponente(comp, host).length;
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
    var out = d.gen.generarViga(ST.receta, {});
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
    } catch (e) { return; }
    if (ST.undoStack.length > ST._undoMax) ST.undoStack.shift();
  }

  function _undo() {
    if (!ST.undoStack.length) { _actualizarStatus('Nada que deshacer.'); return; }
    var snap = ST.undoStack.pop();
    ST.receta = snap.receta;
    ST.selCi = (snap.selCi != null) ? snap.selCi : -1;
    if (ST.selCi >= (ST.receta.componentes || []).length) ST.selCi = -1;
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

  // Marca el tema vigente EN EL DOM: de esta clase cuelgan las variables --te-ov-*
  // (colores de todo lo que dibuja el overlay SVG de las vistas 2D) y el color de su
  // grilla de fondo. Es lo que evita que oscurecer el fondo deje texto oscuro sobre
  // oscuro. Se llama también al abrir el modal, no sólo al tocar el radial.
  function _marcarTemaEnQuad() {
    var quad = $('te_quad'); if (!quad) return;
    ['oscuro', 'medio', 'claro'].forEach(function (k) {
      quad.classList.toggle('te-tema-' + k, ST.tema3d === k);
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
      var sel = (ST.selCi >= 0 && mesh.userData.ci === ST.selCi);
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
      '<rect x="0" y="0" width="46" height="46" rx="8" fill="rgba(255,255,255,.85)" stroke="#dbe1e8"/>' +
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

  // Rango [i0, i1] de índices de `puntos` que ocupa el LADO DOMINANTE, o null si
  // el mapeo no se pudo derivar con certeza. `rol` es el rol EFECTIVO con el que
  // el motor dibujó la barra (comp._rol), no el que sugiere la tipología: la
  // topología de la figura puede mandar a un 106A al pipeline de sección aunque el
  // chip diga MH, y entonces la familia de dibujo es otra.
  function _tramoDominanteEnTrazo(figura, rol, puntos, diamCm, ladoDom) {
    var fp = _figPuntos();
    if (!fp || !fp.tramosDeFigura || !fp.familiaDeDibujo) return null;
    if (!ladoDom || !puntos || puntos.length < 2) return null;
    if (!GHOST_FAM_MAPEABLE[fp.familiaDeDibujo(figura, rol || null)]) return null;
    var tr = fp.tramosDeFigura(figura);
    if (!tr || !tr.tramos || !tr.tramos.length) return null;
    var i, iDom = -1;
    for (i = 0; i < tr.tramos.length; i++) {
      if (tr.tramos[i] && String(tr.tramos[i].lado || '').toUpperCase() === ladoDom) { iDom = i; break; }
    }
    if (iDom < 0) return null;
    // Agrupar los puntos en VÉRTICES (suelto | grupo de arco pegado).
    var maxCuerda = 1.5 * (Number(diamCm) || 0);
    if (!(maxCuerda > 0)) return null;              // sin φ no hay cota: no se adivina
    var verts = [];
    i = 0;
    while (i < puntos.length) {
      if (!puntos[i] || !puntos[i].esArco) { verts.push([i, i]); i++; continue; }
      var j = i;
      while (j + 1 < puntos.length && puntos[j + 1].esArco &&
        _dist3(puntos[j], puntos[j + 1]) <= maxCuerda) j++;
      verts.push([i, j]); i = j + 1;
    }
    if (verts.length !== tr.tramos.length + 1) return null;
    // El tramo va del FINAL del vértice que lo abre al PRINCIPIO del que lo cierra:
    // así el resaltado cubre el trecho recto y no se mete dentro de los codos.
    var a = verts[iDom][1], b = verts[iDom + 1][0];
    if (!(b > a)) return null;
    return { i0: a, i1: b };
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
    var contorno = (ST.cargado.contorno !== false);

    if (rol === 'estribo') {
      // Estribo/traba "toma contorno": rectángulo al recubrimiento (o al borde si
      // contorno=false / recub 0). En SECCIÓN se ve el recinto completo; en las
      // vistas donde X es horizontal se ve como un trazo vertical a la X del cursor.
      if (plano === 'seccion') {
        var hw = (contorno ? iW : rect.W) / 2, hh = (contorno ? iH : rect.H) / 2;
        return { tipo: 'rect', pts: [{ u: -hw, v: hh }, { u: -hw, v: -hh }, { u: hw, v: -hh }, { u: hw, v: hh }], cerrar: true };
      }
      // largo/planta: el estribo es un trazo perpendicular al eje X (vertical), a la
      // X clicada. Su alto = recinto útil en V.
      var vh = (contorno ? iH : rect.H) / 2;
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
      var sel = (ci === ST.selCi && ST.selCi >= 0);
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
        if (activa && !L.segunda) _dibujarTramosRango(g, d, rango, true, X, yy, plano);
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
        if (activa && !L.segunda) _dibujarTramosRango(g, d, rango, false, Y, xx, plano);
      }
      // COTA VIVA AL BORDE (pedido 15-ago): mientras se arrastra ESTA línea, cada
      // extremo dice a cuánto quedó del borde del elemento en su eje. Es la
      // pregunta real del usuario ("¿cuánto me falta para el borde?") y sin ella
      // hay que soltar, mirar el campo y volver a agarrar.
      if (ST.dragRango && ST.dragRango.ci === ST.selCi && ST.dragRango.cual === L.cual) {
        var lim = _facesEje(eje), bordes = [];
        for (var q = 0; q < lim.length; q++) bordes.push(Number(lim[q]));
        if (bordes.length) {
          var bMin = Math.min.apply(null, bordes), bMax = Math.max.apply(null, bordes);
          var dIni = Math.abs(Number(rango.from) - bMin), dFin = Math.abs(bMax - Number(rango.to));
          var horiz = (eje === def.u);
          var yTxt = horiz ? (TE_RANGO_OFF_V + (L.segunda ? 16 : 0) - 10) : 0;
          function cota(px, py, txt) {
            var t = _svgEl('text', { 'class': 'te-rango-cota', x: px, y: py, 'text-anchor': 'middle' });
            t.textContent = txt; g.appendChild(t);
          }
          if (horiz) {
            cota(X(rango.from), yTxt, Math.round(dIni) + '');
            cota(X(rango.to), yTxt, Math.round(dFin) + '');
          } else {
            var xT = TE_RANGO_OFF_H + (L.segunda ? 16 : 0) + 16;
            cota(xT, Y(rango.from) + 3, Math.round(dIni) + '');
            cota(xT, Y(rango.to) + 3, Math.round(dFin) + '');
          }
        }
      }
    });
  }

  // TRAMOS SOBRE LA FLECHA (punto 4b) — por cada límite interno un DIVISOR arrastrable
  // (mueve el límite entre los dos tramos contiguos) y por cada tramo una etiqueta
  // "@N" CLICABLE que abre un input inline para editar ese @ sin ir al panel.
  // `P` proyecta la coordenada del eje de reparto a px; `fija` es la coordenada
  // perpendicular (la línea de la flecha). Se dibuja DESPUÉS del rect de arrastre y de
  // los handles → queda encima y se puede clicar.
  function _dibujarTramosRango(svg, d, rango, horiz, P, fija, plano) {
    var arr = _tramosDe(d);
    if (!arr.length) return;
    var sgn = (Number(rango.to) >= Number(rango.from)) ? 1 : -1;
    var acc = Number(rango.from);
    for (var i = 0; i < arr.length; i++) {
      var a = acc, b = acc + sgn * arr[i].long;
      if (i > 0) {                                   // divisor: sólo en límites INTERNOS
        var pd = P(a);
        _divisorTramo(svg, i, horiz ? pd : fija, horiz ? fija : pd, horiz, plano);
      }
      var pm = P((a + b) / 2);
      _etiquetaAt(svg, arr[i].sep, i, horiz ? pm : fija, horiz ? fija : pm, horiz, plano);
      acc = b;
    }
  }

  function _divisorTramo(svg, idx, x, y, horiz, plano) {
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
      'data-rango-div': idx, 'data-plano': plano,
      style: 'cursor:' + (horiz ? 'ew-resize' : 'ns-resize')
    }));
  }

  function _etiquetaAt(svg, sep, idx, x, y, horiz, plano) {
    var txt = '@' + (Math.round(Number(sep) * 10) / 10);
    var w = txt.length * 5.1 + 6, h = 11;
    // La etiqueta va DEBAJO de la flecha horizontal (arriba está la .te-vtitle de la
    // vista, que llega hasta ~27 del viewBox y se la comería) y a la DERECHA de la
    // vertical. Se dibuja después del rect de arrastre → queda clicable.
    var bx = horiz ? (x - w / 2) : (x + 6);
    var by = horiz ? (y + 6) : (y - h / 2);
    svg.appendChild(_svgEl('rect', {
      'class': 'te-rango-atbg', x: bx, y: by, width: w, height: h, rx: 2,
      'data-rango-at': idx, 'data-plano': plano
    }));
    var t = _svgEl('text', {
      'class': 'te-rango-at', x: bx + w / 2, y: by + h - 3, 'text-anchor': 'middle',
      'data-rango-at': idx, 'data-plano': plano
    });
    t.textContent = txt;
    svg.appendChild(t);
  }

  // INPUT INLINE del "@N" — un <input> HTML flotando sobre el cuadrante (la .te-vista
  // es position:relative), no un <foreignObject>: así hereda el estilo del modal, el
  // foco y el teclado sin rarezas de SVG. Se confirma con Enter o al perder el foco;
  // Esc cancela. Sólo edita el @ de ESE tramo: el resto del reparto no se toca.
  var _atEditEl = null;
  function _cerrarEditorAt() {
    var el = _atEditEl; _atEditEl = null;
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  function _abrirEditorAt(plano, svg, idx, evt) {
    _cerrarEditorAt();
    if (ST.selCi < 0 || !ST.receta) return;
    var c = ST.receta.componentes[ST.selCi]; if (!c) return;
    var d = c.distribucion || {}; if (!d.rango) return;
    var arr = _tramosDe(d); if (!arr[idx]) return;
    var vista = svg.closest ? svg.closest('.te-vista') : null; if (!vista) return;
    var rv = vista.getBoundingClientRect();
    var inp = document.createElement('input');
    inp.type = 'number'; inp.className = 'te-atedit'; inp.value = arr[idx].sep;
    inp.min = SEP_MIN; inp.step = 'any';   // capeo del @ también en el editor inline
    inp.title = 'Espaciamiento del tramo ' + (idx + 1) + ' (cm, mínimo ' + SEP_MIN + ')';
    inp.style.left = Math.max(2, Math.round(evt.clientX - rv.left - 24)) + 'px';
    inp.style.top = Math.max(2, Math.round(evt.clientY - rv.top - 9)) + 'px';
    var cerrado = false;
    // ¿el valor tecleado pasa el capeo del @? Si no: borde rojo + status y NO se aplica.
    function _sepOk() {
      var v = Number(inp.value);
      if (isFinite(v) && v >= SEP_MIN) { inp.classList.remove('bad'); return true; }
      inp.classList.add('bad');
      _actualizarStatus('@ mínimo ' + SEP_MIN + ' cm: valor rechazado.');
      return false;
    }
    function cerrar(guardar) {
      if (cerrado) return;
      if (guardar && !_sepOk()) guardar = false;   // se cierra igual (no atrapa el foco)
      cerrado = true;
      var v = Number(inp.value);
      _cerrarEditorAt();
      if (!guardar) return;
      var a = _tramosDe(d);
      if (!a[idx] || a[idx].sep === v) return;
      _pushUndo();
      a[idx].sep = v;
      _setTramos(d, a);
      _regenerar(); _renderPanel();
    }
    inp.addEventListener('keydown', function (e) {
      e.stopPropagation();                       // Supr/Esc del editor no borran la barra
      // Enter con un @ inválido NO cierra: marca en rojo y deja corregir en el sitio.
      if (e.key === 'Enter') { e.preventDefault(); if (_sepOk()) cerrar(true); }
      else if (e.key === 'Escape') { e.preventDefault(); cerrar(false); }
    });
    inp.addEventListener('blur', function () { cerrar(true); });
    ['mousedown', 'click', 'wheel'].forEach(function (ev) {
      inp.addEventListener(ev, function (e) { e.stopPropagation(); });   // no pan/zoom del cuadrante
    });
    vista.appendChild(inp);
    _atEditEl = inp;
    inp.focus(); inp.select();
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

  function _facesEje(eje) {
    var g = ST.receta.geometria;
    if (eje === 'x') return [-g.largo / 2, g.largo / 2, 0];
    if (eje === 'y') return [-g.alto / 2, g.alto / 2, 0, g.alto / 2 - (g.recub_sup || 4), -g.alto / 2 + (g.recub_inf || 4)];
    return [-g.ancho / 2, g.ancho / 2, 0, g.ancho / 2 - (g.recub_lat || 3), -g.ancho / 2 + (g.recub_lat || 3)];
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
  // `sel` = { tipologia, figura, diam, contorno } — el ribbon (ST.*) al colocar,
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
      dims: _dimsDefault(sel.figura, rol, sel.contorno),
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
      tipologia: ST.tipologia, figura: ST.figura, diam: ST.diam, contorno: ST.contorno
    });
    ST.receta.componentes.push(comp);
    ST.selCi = ST.receta.componentes.length - 1;
    _regenerar();
    _renderPanel();
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
    var t = 'Girar 90° en ' + nomVista + ' (R) — ' + _poseTexto(p);
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
  function _seleccionar(ci) {
    ST.selCi = ci;
    _renderPanel();
    _redibujar2D(ST.ultimoOut);
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
    if (ST.selCi < 0) { _actualizarStatus('Nada seleccionado: haz clic en una barra y vuelve a Borrar.'); return; }
    _pushUndo();
    ST.receta.componentes.splice(ST.selCi, 1);
    ST.selCi = -1;
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
        // SHIFT+arrastre TAMBIÉN es PAN de la vista (_bindVistaOrto, en el contenedor
        // .te-vista). Mismo problema que el botón medio: los dos handlers se disputaban
        // el mismo mousedown, así que el pan con shift "no agarraba" (y en modo colocar
        // dejaba una barra suelta al empezar a panear). El pan vive en el contenedor;
        // aquí sólo hay que soltarle el evento.
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

        // ¿tocó un DIVISOR de tramo? → arrastra el límite entre dos tramos contiguos
        // (el par conserva su largo total; el rango no cambia).
        var tgtDiv = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-rango-div');
        if (tgtDiv != null) {
          evt.preventDefault(); _pushUndo();
          ST.dragRango = {
            ci: ST.selCi, plano: plano, lastX: sp.px, lastY: sp.py,
            end: null, div: Number(tgtDiv), eje: null
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
          _seleccionar(ci);
          if (ST.tool === 'mover' && uv) {
            // pushed:false → el snapshot se toma en el 1er movimiento real (un
            // simple clic para seleccionar NO ensucia el stack de undo).
            ST.dragMove = { ci: ci, plano: plano, startHost: _clickHost(plano, uv), startHint: _clonHint(ci), pushed: false };
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
            if (uv) ST.dragMove = { ci: pk, plano: plano, startHost: _clickHost(plano, uv), startHint: _clonHint(pk), pushed: false };
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
      });
    }
  }

  function _clonHint(ci) {
    var c = ST.receta.componentes[ci];
    return c && c.pos_hint ? { x: c.pos_hint.x, y: c.pos_hint.y, z: c.pos_hint.z } : {};
  }

  function _dragMover(plano, uv) {
    var dm = ST.dragMove; if (!dm) return;
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
    // DONDE LA SOLTASTE ES EL ANCLA: el hint se guarda como distancia a la referencia
    // más cercana de su eje (borde − / centro / borde +), no como coordenada fija.
    // Sin esto, la barra arrastrada a 50 cm del testero aparecía a 150 cm del testero
    // en cuanto la viga pasaba de 600 a 800.
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

  function _iniciarDragMarco(plano, ci, eje, ladoUV, uv0) {
    var c = ST.receta.componentes[ci]; if (!c) return;
    var R = global.ModeladorReglas, host = ST.receta && ST.receta.geometria;
    if (!R || !R.expandirComponente || !host) return;
    var PROBE = 5;   // cm del sondeo: grande contra redondeos, chico contra avisos
    // expande un CLON (sin campos runtime _*) con un Δ extra opcional en un lado
    function expandir(mod) {
      var clon = JSON.parse(JSON.stringify(c, function (k, val) {
        return (String(k).charAt(0) === '_') ? undefined : val;
      }));
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
    var b0 = _bboxUVdePls(expandir(null), plano);
    if (!b0) { _actualizarStatus('No se pudo medir la pieza en esta vista.'); return; }
    // EL PAR ESPEJO ES UNA SOLA PERILLA (fix 17-ago, «pasado la mitad se
    // bloquea»). B y D miden LA MISMA medida del marco: escribir Δ propio en los
    // DOS dispara la regla del motor «Δ distintos en el par → se dibuja el
    // mayor», y el sondeo sobre el par de un lado ya arrastrado no medía el
    // efecto de +5 sino el salto del conflicto (~40 cm de borde por cm de Δ):
    // ganaba el par, el drag escribía el lado equivocado y el estribo quedaba
    // trabado/saltando. Por eso: todo candidato se PLIEGA al lado del par que
    // ya trae Δ propio, y el par jamás recibe un Δ nuevo desde el tirador.
    var fpM = global.ModeladorFiguraPuntos || {};
    var pares = (fpM.paresEspejoFigura ? fpM.paresEspejoFigura(c.figura) : null) || {};
    function deltaPropioDe(L) {
      var d = c.dims && c.dims[L];
      return (d && typeof d === 'object' && d.delta) ? d : null;
    }
    function plegarAlKnob(L) {
      if (deltaPropioDe(L)) return L;
      var P = pares[L];
      return (P && deltaPropioDe(P)) ? P : L;
    }
    // candidatos: primero los lados que YA traen Δ propio (arrastrar continúa lo
    // escrito en vez de pelearlo), después el resto de los lados de la figura —
    // cada uno PLEGADO a su knob y sin duplicados.
    var spec = _figSpec(c.figura);
    var lados = [];
    function agregar(L) { L = plegarAlKnob(L); if (lados.indexOf(L) < 0) lados.push(L); }
    Object.keys(c.dims || {}).forEach(function (L) { if (deltaPropioDe(L)) agregar(L); });
    ((spec && spec.parciales) || Object.keys(c.dims || {})).forEach(agregar);
    var mejor = null;
    lados.forEach(function (L) {
      var dEx = deltaPropioDe(L);
      var extEx = dEx ? ((dEx.extremo === 'ini') ? 'ini' : (dEx.extremo === 'centro' ? 'centro' : 'fin')) : null;
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
    var d0 = (c.dims && c.dims[mejor.L] && typeof c.dims[mejor.L] === 'object')
      ? (Number(c.dims[mejor.L].delta) || 0) : 0;
    ST.dragMarco = {
      plano: plano, ci: ci, eje: eje, ladoUV: ladoUV,
      L: mejor.L, extremo: mejor.extremo, ratio: mejor.ratio || 1,
      delta0: d0, uv0: uv0, pushed: false
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
    var delta = Math.round((dm.delta0 + afuera / (dm.ratio || 1)) / pasoT) * pasoT;
    c.dims = c.dims || {};
    var d = c.dims[dm.L];
    if (!d || typeof d !== 'object') {
      d = c.dims[dm.L] = (d != null && isFinite(Number(d)))
        ? { modo: 'fija', valor: Number(d) } : { modo: 'auto' };
    }
    // misma escritura que el campo Δ de la ficha: 0 = sin Δ (se borra la clave)
    if (!delta) { delete d.delta; }
    else { d.delta = delta; d.extremo = dm.extremo; }
    _actualizarStatus('Δ ' + dm.L + ' = ' + delta + ' cm (' +
      (dm.extremo === 'ini' ? '← ini' : 'fin →') + ') — se suma al largo de corte.');
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
      if (c.pos_hint) delete c.pos_hint[eje];
      // el mouseup global ya re-renderiza el panel → la ficha muestra el modo nuevo
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
    _sincronizarOverlayOrto();              // repinta la cota viva del borde
    _regenerarDiferido();
  }

  // ==========================================================================
  // PANEL IZQUIERDO — render dinámico desde ST.receta.componentes
  // ==========================================================================
  var LETRAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

  function _renderPanel() {
    var cont = $('te_compList'); if (!cont || !ST.receta) return;
    var cnt = $('te_compCount'); if (cnt) cnt.textContent = ST.receta.componentes.length;
    cont.innerHTML = '';
    ST.receta.componentes.forEach(function (c, ci) {
      cont.appendChild(_compEl(c, ci));
    });
    // El selector de elemento se habilita/deshabilita según haya barras: hay que
    // refrescarlo con cada mutación (colocar la 1ª barra lo bloquea; borrar la
    // última lo libera).
    _renderElemSel();
    _actualizarStatus();
    // La ficha flotante del 3D muestra la SELECCIÓN: se repinta acá porque este es
    // el punto por el que pasa todo cambio de selección (_seleccionar → _renderPanel).
    _pintarFichaSel();
  }

  // Refresca SÓLO la línea de descripción de cada componente YA pintado (cara ·
  // reparto · N barras · ø). Hace falta porque la CANTIDAD DE BARRAS no sale de la
  // receta sino del último generado: tocar un @, mover un rango o cambiar el hormigón
  // la mueve sin que el panel se re-arme. Y llamar a _renderPanel desde _regenerar NO
  // es opción: re-arma toda la ficha y le mata el foco al input que el usuario está
  // tecleando (por eso _mut sólo la re-arma cuando cambia la FORMA de la ficha).
  function _refrescarDescComps() {
    var cont = $('te_compList'); if (!cont || !ST.receta) return;
    var comps = ST.receta.componentes || [];
    Array.prototype.forEach.call(cont.querySelectorAll('.te-comp'), function (el) {
      var ci = Number(el.getAttribute('data-ci'));
      var c = comps[ci]; if (!c) return;
      var de = el.querySelector('.te-de'); if (!de) return;
      de.textContent = _compDesc(c, ci);
    });
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

  function _compEl(c, ci) {
    var rol = _rolComp(c);
    var col = _colorComp(c);   // el swatch muestra el color REAL de la barra (override incluido)
    var sel = (ci === ST.selCi);
    var wrap = document.createElement('div');
    wrap.className = 'te-comp' + (sel ? ' open sel' : '');
    wrap.setAttribute('data-ci', ci);

    // TIPOLOGÍA HUÉRFANA — se marca EN LA FILA, no sólo dentro de la ficha: el
    // usuario cierra las fichas y mira la lista, y ahí es donde tiene que ver
    // CUÁL de sus barras quedó con la tipología de otro elemento.
    var ajena = _tipAjenaAlElemento(c);
    if (ajena) wrap.style.borderLeft = '3px solid #e65100';

    // FIGURA QUE EL CATÁLOGO YA NO TIENE (la marca el normalizador de apertura al
    // abrir un template viejo). Es más grave que la tipología ajena —de esta barra
    // NO sale nada— así que va en ROJO y pisa la marca ámbar.
    var mig = _migracionDe(c);
    var sinFig = !!(mig && mig.figura_desconocida);
    if (sinFig) wrap.style.borderLeft = '3px solid #c62828';

    // MARCA DE ESPEJO — pegada al swatch y SÓLO si la pose está espejada.
    // Es la contrapartida de haberle sacado la cara a _compDesc: sin ella, dos
    // componentes iguales que sólo difieren en el espejo (las dos MH 104B del reporte)
    // quedan indistinguibles en la lista. Va como icono y no como palabra a propósito:
    // el usuario pidió menos texto en la línea.
    var esp = _poseDe(c).espejo
      ? '<span class="te-espm" title="Pose espejada (el gancho cierra al otro lado)">⇋</span>' : '';

    // Cabecera
    var ch = document.createElement('div'); ch.className = 'te-ch';
    ch.innerHTML =
      '<span class="te-drag" title="Arrastrar para reordenar">⠿</span>' +
      '<span class="te-sw" style="background:' + col + '"></span>' + esp +
      '<div><div class="te-nm">' +
      (sinFig ? '<span style="color:#c62828" title="La figura ' + _esc(c.figura || '') +
        ' no está en el catálogo vigente: esta barra no se genera.">⛔ </span>' : '') +
      (ajena ? '<span style="color:#e65100" title="' + _esc(ajena.texto) + '">⚠ </span>' : '') +
      _esc(c.tipologia) + ' · ' + _esc(c.figura) + '</div>' +
      '<div class="te-de">' + _esc(_compDesc(c, ci)) + '</div></div>' +
      '<span class="te-sp"></span>' +
      '<button class="te-mini" data-act="dup" title="Duplicar">⧉</button>' +
      '<button class="te-mini" data-act="del" title="Quitar">🗑</button>';
    // JERARQUÍA (nivel vs recubrimiento) — se edita en el HEADER, junto a ⧉/🗑, para
    // verla y cambiarla sin abrir el componente. 'auto' = sin dato (el motor aplica
    // el default del rol: estribo 0, traba/cabezal 1). Los eventos del select NO
    // burbujean al header (si no, elegir un nivel plegaría/desplegaría la ficha).
    ch.insertBefore(_selJerarquia(c, ci), ch.querySelector('[data-act="dup"]'));
    ch.addEventListener('click', function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'del') { e.stopPropagation(); ST.selCi = ci; _borrarSeleccion(); return; }
      if (act === 'dup') { e.stopPropagation(); _duplicar(ci); return; }
      // BUG 6B — el header es un TOGGLE: si el componente ya está seleccionado (abierto),
      // volver a clicarlo lo PLIEGA (deselecciona). Antes solo seleccionaba, así que la
      // única forma de plegar era clic-en-vacío en una vista (y en las densas nunca caías
      // en vacío → "solo se pliega en XZ"). Ahora se pliega desde el panel en cualquier caso.
      if (ST.selCi === ci) { _seleccionar(-1); } else { _seleccionar(ci); }
    });
    wrap.appendChild(ch);

    // Cuerpo (solo si seleccionado — evita DOM enorme)
    if (sel) wrap.appendChild(_compBody(c, ci, rol));

    // Drag-reorder básico
    _habilitarDrag(wrap, ci);
    return wrap;
  }

  // Nivel de jerarquía por DEFECTO — SIEMPRE 1 (decisión del usuario 13-ago:
  // "siempre deben venir en 1, el usuario elige si las cambia"). Espejo del
  // default del motor (JER_DEFAULT_POR_ROL, también todo en 1). Esta función
  // era una TABLA DUPLICADA con el criterio viejo (traba/cabezal = 2) y por eso
  // el select seguía mostrando 2 después de corregir el motor.
  function _jerDefault(rol) { return 1; }

  // <select> de JERARQUÍA del componente (header). Escribe comp.jerarquia:
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
    // el header es clicable (selecciona/pliega): el select se lo queda para él.
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
    // patas que apuntar ni extremo libre que empalmar (el marco manda la forma).
    // Los controles no se ofrecen — y, sobre todo, se DICE por qué: hasta acá
    // simplemente no aparecían y la ficha quedaba muda.
    var cerrado = _esContornoCerrado(c);

    // Identidad
    var idRow = _div('te-grid3');
    idRow.appendChild(_fld('Figura', _figInputComp(c, ci)));
    idRow.appendChild(_fld('φ mm', _select(TE_DIAMS.map(String), String(c.diam), function (v) { c.diam = Number(v); _mut(ci); })));
    idRow.appendChild(_fld('Sufijo', _input({ value: c.suf_tipo || '', placeholder: 'sup / A…' }, function (v) { c.suf_tipo = v; _mut(ci, true); })));
    body.appendChild(idRow);

    // TIPOLOGÍA HUÉRFANA (ver _tipAjenaAlElemento) — esta barra quedó con la
    // tipología de otro elemento, típicamente tras cambiar Viga → Muro. El aviso
    // de la barra de estado dura hasta el primer clic; esta nota NO se va hasta
    // que se arregle, y trae el arreglo puesto: la tipología no se podía cambiar
    // en ninguna parte (se elegía al colocar), así que la única salida era borrar
    // la barra y volver a colocarla perdiendo su pose.
    var avTipAj = _tipAjenaAlElemento(c);
    if (avTipAj) {
      var nTipAj = _div('te-note');
      nTipAj.style.color = '#e65100';
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
      nErr.style.color = '#c62828';
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
        nAv.style.color = '#e65100';
        nAv.textContent = '⚠ ' + avFig.texto;
        body.appendChild(nAv);
      }
    }

    // ------------------------------------------------------------------
    // POSE (TANDA P) — cara + lado + rumbo + espejo, el modelo único. La ficha
    // ESCRIBE siempre con _setPose (que espeja los campos viejos), nunca campo a
    // campo: así la ficha, el botón de giro y el motor no pueden divergir.
    // ------------------------------------------------------------------
    var pose = _poseDe(c);

    // Cara / anclaje (radial) — 4 caras: las dos del eje vertical (sup/inf), la
    // LATERAL (cortinas) y el EXTREMO (testeros del elemento), que antes no se podía
    // elegir ni clicando el borde.
    var caraRow = _div('te-row');
    caraRow.appendChild(_label('Cara / anclaje'));
    caraRow.appendChild(_radial(
      [['sup', 'Superior'], ['inf', 'Inferior'], ['lateral', 'Lateral'], ['extremo', 'Extremo']],
      pose.cara,
      function (v) {
        if (v === pose.cara) return;
        _pushUndo();
        var ejeAntes = _ejeDistDe(c);
        var p = _poseDe(c);
        p.cara = v;
        // el rumbo tiene que seguir siendo ⊥ a la cara nueva; si no lo es, cae al
        // rumbo por defecto de esa cara (el largo cuando es posible).
        if (!_rumboValido(v, p.rumbo)) p.rumbo = _rumboDefaultDeCara(v);
        if (v !== 'lateral' && v !== 'extremo') p.lado = 1;   // sup/inf ya llevan el signo
        _setPose(c, p);
        _reencuadrarReparto(c, ejeAntes);   // la cara puede cambiar el eje de reparto
        _mut(ci, true);
      }
    ));
    body.appendChild(caraRow);

    // LADO de la cara — sólo lo tienen las caras cuyo signo NO va en el nombre:
    // LATERAL (cortina +Z/−Z) y EXTREMO (testero inicio/fin). Escribe comp.lado
    // (1 | −1), que es lo que el motor mira para anclar; el arrastre (pos_hint) no
    // lo cambia. Los estribos/trabas laterales encuadran el núcleo entero (no tienen
    // lado que elegir), pero en un EXTREMO sí lo tienen.
    var mostrarLado = _CARA_CON_LADO[pose.cara] && (pose.cara === 'extremo' || rol === 'cabezal');
    if (mostrarLado) {
      var esExtremo = (pose.cara === 'extremo');
      var ladoRow = _div('te-row');
      ladoRow.appendChild(_label('Lado'));
      var ladoSeg = _radial(
        esExtremo ? [['1', 'Fin +'], ['-1', 'Inicio −']] : [['1', '+Z'], ['-1', '−Z']],
        String(pose.lado),
        function (v) {
          _pushUndo();
          var p = _poseDe(c);
          p.lado = (Number(v) < 0) ? -1 : 1;
          _setPose(c, p);
          _mut(ci, true);   // redibuja la ficha → el botón activo sigue al valor
        }
      );
      ladoSeg.title = esExtremo
        ? 'Testero contra el que se ancla: Fin (+' + _ejeLetra('x') + ') o Inicio (−' + _ejeLetra('x') + ').'
        : 'Cara cortina contra la que se apoya (+Z / −Z). El arrastre no la cambia.';
      ladoRow.appendChild(ladoSeg);
      body.appendChild(ladoRow);
    }

    // Recub override — SUBE antes del kit de rotaciones (pedido 13-ago: Rotación,
    // Pose/Espejo —y la rotación de plano cuando vuelva— quedan AGRUPADAS abajo).
    var recRow = _div('te-row');
    recRow.appendChild(_label('Recub. override'));
    recRow.appendChild(_input({ value: (c.recub_override != null ? c.recub_override : ''), placeholder: 'global cm' }, function (v) { c.recub_override = (v === '' ? null : Number(v)); _mut(ci); }));
    body.appendChild(recRow);

    // INDICADOR COMPACTO DE POSE + toggle ESPEJO. El texto dice de un vistazo dónde
    // está anclada y hacia dónde corre; el espejo refleja la misma pose (los ganchos
    // cierran al otro lado) sin tocar cara ni rumbo.
    // ESPEJO ES TAMBIÉN LA MEDIA VUELTA (ver _signoLong en reglas.js): en una pieza
    // PLANA, reflejarla en su plano y girarla 180° sobre su normal son lo mismo, así
    // que este bit es el SENTIDO del rumbo — el que completa las 24 orientaciones. Por
    // eso R lo enciende y lo apaga solo al pasar por la media vuelta: no es que el
    // botón se mueva "por su cuenta", es la pose girando entera.
    var poseRow = _div('te-row');
    poseRow.appendChild(_label('Pose'));
    var poseWrap = _div('');
    poseWrap.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    var poseTxt = document.createElement('span');
    poseTxt.className = 'te-posetxt';
    poseTxt.textContent = _poseTexto(pose);
    poseTxt.title = 'Cara de anclaje · eje por el que corre la pieza · espejo. Gira 90° en la vista activa con R.';
    var espSeg = _radial([['no', 'Normal'], ['si', 'Espejo']], pose.espejo ? 'si' : 'no', function (v) {
      var quiere = (v === 'si');
      if (quiere === _poseDe(c).espejo) return;
      _pushUndo();
      var p = _poseDe(c);
      p.espejo = quiere;
      _setPose(c, p);
      _mut(ci, true);
    });
    espSeg.title = 'Espejo: la MISMA pose dada vuelta sobre su eje de anclaje ' +
      '(el gancho cierra al otro lado). Girando con R también se pasa por acá.';
    poseWrap.appendChild(poseTxt);
    poseWrap.appendChild(espSeg);
    poseRow.appendChild(poseWrap);

    // Rotación (ángulo exacto + botón 90°)
    var rotRow = _div('te-row');
    rotRow.appendChild(_label('Rotación °'));
    var rotWrap = _div('');
    rotWrap.style.display = 'flex'; rotWrap.style.gap = '6px'; rotWrap.style.alignItems = 'center';
    var rotInp = _input({ value: (c.orient && c.orient.deg) ? c.orient.deg : 0, type: 'number' }, function (v) {
      // eje = profundidad de la vista activa SEGÚN EL ELEMENTO (no la tabla viga)
      var eje = _ejeProfundidadDeVista(ST.ultimoPlano) || (c.orient && c.orient.eje) || 'x';
      c.orient = c.orient || {};
      c.orient.eje = eje; c.orient.deg = Number(v) || 0;   // conserva spin/pivot
      _mut(ci);
    });
    rotInp.style.width = '70px';
    // +90° = giro de POSE en la vista activa (13-ago): re-deriva dims contra lo
    // nuevo que cruzan, re-ancla a la cara y re-reparte. Antes era rotación
    // RÍGIDA en grados (la pieza giraba tal cual y se salía del hormigón); los
    // grados del input quedan SOLO para inclinar (barras a 45°).
    var rot90 = document.createElement('button'); rot90.className = 'te-ctool'; rot90.textContent = '+90°'; rot90.style.padding = '3px 8px';
    rot90.title = 'Girar 90° en la vista activa (pose): se reajusta a recubrimientos y reparto. Igual que R.';
    rot90.addEventListener('click', function () { _rotarPoseSeleccion(_vistaActiva()); });
    // ROTAR DE PLANO (restaurada, 13-ago): manda la pieza a PROFUNDIDAD — gira
    // 90° en torno al eje VERTICAL de la vista activa (como una puerta). También
    // es giro de POSE: respeta recubrimientos y dims del hormigón.
    var rotPlano = document.createElement('button'); rotPlano.className = 'te-ctool'; rotPlano.textContent = 'Plano 90°'; rotPlano.style.padding = '3px 8px';
    rotPlano.title = 'Rotar DE PLANO: la pieza pasa a estar colocada en profundidad (gira en el eje vertical de la vista).';
    rotPlano.addEventListener('click', function () {
      var defs = _defsPlanos();
      var d = defs[_vistaActiva()] || defs.seccion;
      _rotarPoseSeleccionEje(d.v);
    });
    rotWrap.appendChild(rotInp); rotWrap.appendChild(rot90); rotWrap.appendChild(rotPlano);
    rotRow.appendChild(rotWrap);
    body.appendChild(rotRow);
    // La fila Pose (espejo) va PEGADA a Rotación: el kit de orientar la pieza
    // queda junto (Rotación° · Pose/Espejo · y la rotación de plano cuando vuelva).
    body.appendChild(poseRow);

    // PATAS — hacia dónde apuntan los ganchos. Es orient.spin (0/90/180/270): el motor
    // gira SÓLO las patas alrededor del eje longitudinal, la barra NO se mueve de su
    // sitio. Reemplaza la fila "Giro barra °" (número libre + botón +90°): un ángulo
    // en grados no describe nada que el usuario pueda ver, la dirección de la pata sí.
    // Sólo aparece si la figura TIENE patas y el rol no es estribo/traba (esos son
    // marcos cerrados: no hay dirección de pata que elegir).
    var patas = _patasDe(c);
    if (!cerrado && rol !== 'estribo' && rol !== 'traba' && (patas.inicio || patas.fin)) {
      var spinRow = _div('te-row');
      spinRow.appendChild(_label('Patas'));
      var spinNow = ((((Number(c.orient && c.orient.spin) || 0) % 360) + 360) % 360);
      var spinSeg = _radial([['0', '↓'], ['90', '→'], ['180', '↑'], ['270', '←']], String(spinNow), function (v) {
        _pushUndo();
        c.orient = c.orient || {};
        c.orient.spin = Number(v) || 0;
        _mut(ci, true);   // redibuja la ficha → el botón activo sigue al valor
      });
      spinSeg.title = 'Dirección de las patas (la barra no se mueve)';
      spinRow.appendChild(spinSeg);
      body.appendChild(spinRow);
    }

    // Δ de EXTREMO LIBRE (empalme) — sólo en los extremos SIN pata.
    _filasEmpalme(body, c, ci, rol, patas, cerrado);

    // …y por qué esta ficha trae menos controles que otra (ver `cerrado` arriba).
    if (cerrado) {
      var nCer = _div('te-note');
      nCer.textContent = 'Contorno cerrado: el marco manda la forma y se ajusta al recubrimiento ' +
        'del hormigón. Por eso no lleva patas ni Δ de empalme — el largo sale del contorno.';
      body.appendChild(nCer);
    } else if (rol === 'estribo' || rol === 'traba') {
      // Pieza de sección ABIERTA (una cadena de sección, p.ej. una TC 104B): el
      // marco no la cierra, pero el motor sigue ignorando el Δ de empalme en
      // estribos y trabas (reglas.js · empIgnorado), así que tampoco se ofrece.
      var nSec = _div('te-note');
      nSec.textContent = 'Pieza de sección: se encuadra contra el recubrimiento del núcleo. ' +
        'El Δ de empalme no se ofrece porque el motor sólo lo aplica a las barras longitudinales.';
      body.appendChild(nSec);
    }

    // COLOR DE LA BARRA — default el de su tipología (COL2D), editable por
    // componente y guardado en la receta (D9 del usuario: "colores por defecto
    // pero se pueden cambiar en el componente"). Se aplica en 'change' (al cerrar
    // el picker), no en 'input': cada cambio regenera motor+3D y el arrastre del
    // picker dispara decenas por segundo.
    var rowCol = _div('te-row');
    rowCol.appendChild(_label('Color'));
    var wCol = _div(''); wCol.style.display = 'flex'; wCol.style.gap = '6px'; wCol.style.alignItems = 'center';
    wCol.style.flexWrap = 'wrap';   // la fila de colores usados baja de línea, no desborda
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
    body.appendChild(rowCol);

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
            nAngMsg.style.color = '#e65100';
            nAngMsg.textContent = '⚠ α' + (i + 1) + ': ' + vv.motivo + '. El motor usa el del catálogo (' + a + '°) y avisa.';
          }
        }
        angRow.appendChild(_fld('α' + (i + 1) + ' (°)', inpA));
      });
      body.appendChild(angRow);
      if (!nAngMsg.textContent) nAngMsg.textContent =
        'Catálogo = valor por defecto. Editarlo desplaza el gancho dentro del rango de su doblez; el largo total no cambia.';
      body.appendChild(nAngMsg);
    }
    // FIGURA CON RADIO (catálogo: radio = true, p.ej. 201A). Se DICE, no se ofrece un
    // campo: generar.js escribe `radio: null` fijo en la BarraPayload, así que un
    // input aquí sería un valor que el usuario edita y que nunca llega al backend.
    if (spec.radio) {
      var nRad = _div('te-note');
      nRad.style.color = '#c62828';
      nRad.textContent = '⚠ Figura con RADIO: el editor todavía no lo edita y el payload lo manda en null.';
      body.appendChild(nRad);
    }
    var note = _div('te-note'); note.textContent = 'Dim en Auto se derivan del elemento (largo/alto/ancho − recub). Fija = valor manual.';
    body.appendChild(note);
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
    n.style.color = '#e65100';
    n.textContent = '⚠ Esta barra tiene un empalme guardado (' +
      (e.inicio ? 'inicio ' + e.inicio + ' cm' : '') +
      (e.inicio && e.fin ? ' · ' : '') +
      (e.fin ? 'fin ' + e.fin + ' cm' : '') +
      '). El campo se retiró: ahora el traslapo se pone con el Δ de cada lado. ' +
      'El motor sigue aplicando este valor hasta que lo pases.';
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
    var n = _div('te-note');
    // PIEZA DE MARCO: acá el dominante SÍ manda (mueve la esquina de los
    // ganchos), así que el aviso rojo de «el motor la ignoró» ya no corresponde
    // (reporte 17-ago: «me tira un texto grande en rojo que no sé si sirve»).
    if (esMarco) {
      n.textContent = 'Contorno cerrado: la letra elegida manda DÓNDE CIERRAN LOS GANCHOS ' +
        '(ESPACIO también los gira de esquina). El Δ de un lado se replica en su espejo.';
      body.appendChild(n);
      return;
    }
    if (!elegibles.length) {
      n.textContent = 'Esta figura cierra sobre sí misma: no tiene un lado que se estire ni que se empalme. ' +
        'El Δ de un lado se replica en su espejo y el marco crece simétrico.';
      body.appendChild(n);
      return;
    }
    var elegido = _ladoDomElegido(c);
    n.textContent = 'Clic en una letra = ese lado es el DOMINANTE (el que corre a lo largo: el que Auto ' +
      'estira contra el hormigón y el que recibe el empalme). Δ = cuánto se suma a ese lado.' +
      ((elegido && elegido !== efectivo)
        ? ' ⚠ La elección ' + elegido + ' no está mandando (el motor la ignoró y avisa): manda ' + (efectivo || '—') + '.'
        : '');
    if (elegido && elegido !== efectivo) n.style.color = '#e65100';
    body.appendChild(n);
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
    var inp = _input({ value: (d.modo === 'fija' && d.valor != null) ? d.valor : '', placeholder: (d.modo === 'auto' ? 'auto' : 'medida'), type: 'number' }, function (v) {
      d.modo = 'fija'; d.valor = Number(v); _mut(ci);
    });
    if (d.modo === 'auto') inp.disabled = true;
    // CANDADO en vez de "Fija/Auto" (idea del usuario, 15-ago): el texto se comía
    // ~45 px y en el flex los controles de la derecha se COMPRIMÍAN hasta
    // desaparecer — por eso la flecha "no se veía". Cerrado = medida FIJA (la
    // escribe el usuario) · abierto = AUTO (la deriva el elemento).
    var tog = document.createElement('button');
    tog.className = 'te-lock ' + ((d.modo === 'fija') ? 'cerrado' : 'abierto');
    tog.textContent = (d.modo === 'fija') ? '🔒' : '🔓';
    tog.title = (d.modo === 'fija')
      ? 'Medida FIJA (la escribes tú). Clic para volver a Auto.'
      : 'Medida AUTO (la deriva el elemento: largo/alto/ancho − recub). Clic para fijarla.';
    tog.addEventListener('click', function () {
      d.modo = (d.modo === 'fija') ? 'auto' : 'fija';
      // El toggle NO inventa un valor. Antes ponía 0 al pasar a «Fija» (hay que pasar
      // por Fija para que el input se habilite y se pueda escribir), o sea: un CLIC
      // escribía en la receta una medida que el usuario no puso — un lado de 0 cm que
      // el motor dibuja igual. Sin valor el input arranca VACÍO, que es exactamente lo
      // que el usuario ve: "acá falta la medida" (y reglas.js ya lo avisa en rojo).
      _mut(ci); _renderPanel();
    });
    wrap.appendChild(inp); wrap.appendChild(tog);

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
    if (!esEspejo) {
      var ext = (d.extremo === 'ini') ? 'ini' : (d.extremo === 'fin' ? 'fin' : (cerrada ? 'centro' : 'fin'));
      var flecha = document.createElement('button');
      flecha.type = 'button'; flecha.className = 'te-deltadir';
      flecha.textContent = (ext === 'fin') ? '→' : (ext === 'ini' ? '←' : '↔');
      flecha.title = (ext === 'centro')
        ? 'Crece/acorta CENTRADO (mitad por cada borde). Clic para cargarlo a un lado.'
        : (ext === 'fin'
          ? 'Crece/acorta por el borde FINAL' + (cerrada ? ' (el opuesto queda quieto)' : ' (el inicio queda quieto)') + '. Clic para cambiar.'
          : 'Crece/acorta por el borde INICIAL' + (cerrada ? ' (el opuesto queda quieto)' : ' (el final queda quieto)') + '. Clic para cambiar.');
      flecha.onclick = function () {
        // cerradas: centro → fin → ini → centro · abiertas: fin ↔ ini
        if (cerrada) d.extremo = (ext === 'centro') ? 'fin' : (ext === 'fin' ? 'ini' : 'centro');
        else d.extremo = (ext === 'fin') ? 'ini' : 'fin';
        _mut(ci); _renderPanel();
      };
      wrap.appendChild(flecha);
    }

    // ATAJOS 40φ / 60φ — rescatados de la fila de EMPALME, que se retiró por
    // redundante (era el mismo concepto —prolongar el extremo libre— en otro
    // campo y sólo para el lado longitudinal). Acá sirven para CUALQUIER lado.
    [40, 60].forEach(function (nPhi) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'te-phibtn';
      b.textContent = nPhi + 'φ';
      var cm = _nPhi(c, nPhi);
      b.title = nPhi + ' diámetros · φ' + (c.diam || '?') + ' → ' + cm + ' cm';
      b.onclick = function () { _pushUndo(); d.delta = cm; _mut(ci, true); _renderPanel(); };
      wrap.appendChild(b);
    });
    row.appendChild(wrap);
    return row;
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
    var note = _div('te-note'); note.textContent = 'Las capas se apilan desde la cara hacia el núcleo con la separación indicada.';
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
  function _filaAnidar(box, c, ci, rol, d) {
    if (!(Number(d.n_capas) > 1)) return;
    var esEstribo = (rol === 'estribo' || rol === 'traba');
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
      var note0 = _div('te-note'); note0.textContent = 'Zonas de espaciamiento (extremos confinados / centro). Para pasar a rango, arrastra la flecha de rango sobre la barra seleccionada.';
      box.appendChild(note0);
      return;
    }
    // Con VARIOS tramos el @ simple ya no describe nada (cada tramo tiene el suyo) →
    // se esconde y manda el editor de tramos. Con uno solo se mantiene como atajo.
    var multi = _tramosDe(d).length > 1;
    var g2 = _div(multi ? '' : 'te-grid2');
    if (!multi) g2.appendChild(_fld('@ sep cm', _inputSep(d.sep || 20, function (v) { d.sep = v; if (d.rango) d.rango.sep = d.sep; _syncN(d, 'rango'); _mut(ci, true); })));
    g2.appendChild(_fld('Rango', _rangoEditor(c, d, ci)));
    box.appendChild(g2);
    _tramosEditor(box, d, ci);
    var note = _div('te-note'); note.textContent = 'Define el rango (from → to) por campos o arrastrando la flecha doble en las vistas. cant = ceil(dist/@)+1.';
    box.appendChild(note);
  }

  // ARREGLO — rango en un sentido + n_capas + sep_capas (rango × capas). El eje de
  // profundidad de las capas lo fija el plano de trabajo (eje_capas).
  function _camposArreglo(box, c, ci, rol, d) {
    if (!d.rango) d.rango = _rangoDefault(d.sep || 20, _ejeDistDe(c));
    var multi = _tramosDe(d).length > 1;
    var g2 = _div(multi ? '' : 'te-grid2');
    if (!multi) g2.appendChild(_fld('@ sep (rango) cm', _inputSep(d.sep || 20, function (v) { d.sep = v; if (d.rango) d.rango.sep = d.sep; _syncN(d, 'rango'); _mut(ci, true); })));
    g2.appendChild(_fld('Rango', _rangoEditor(c, d, ci)));
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
      g2b.appendChild(_fld('Rango 2ª · ' + nomEje2, _rangoEditor(c, d, ci, 'rango2'),
        'La 2ª línea corre por el ' + nomEje2 + ' (automático: el otro eje del plano de la pieza).'));
      box.appendChild(g2b);
    }
    _filaAnidar(box, c, ci, rol, d);
    var note = _div('te-note');
    note.textContent = legadoCapas
      ? 'Arreglo con CAPAS (forma antigua): rango a lo largo × N capas en profundidad. Convertir la deja como dos líneas de distribución.'
      : 'Arreglo por ÁREA: dos líneas de distribución, cada una con su eje, su rango y su @. ' +
        'La cantidad es el producto de las dos. Es lo que reparte trabas de muro, de confinamiento y estribos de confinamiento.';
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
        row.appendChild(_fld('Largo ' + (i + 1) + ' cm', _input({ value: Math.round(t.long * 10) / 10, type: 'number' }, function (v) {
          _pushUndo(); _setLongTramo(d, i, Number(v) || 0); _mut(ci, true);
        })));
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
      var span = Math.abs(Number(r.to) - Number(r.from));
      r.n = Math.max(1, Math.round(span / sep) + 1);
      return;
    }
    var sgn = (Number(r.to) >= Number(r.from)) ? 1 : -1;
    r.to = Number(r.from) + sgn * (Math.max(1, Math.round(Number(r.n))) - 1) * sep;
    _anclarRangoUI(r, r.eje);   // el `to` se movió → su ancla también (helper único)
  }

  function _rangoEditor(c, d, ci, campo) {
    var cual = (campo === 'rango2') ? 'rango2' : 'rango';
    var wrap = _div(''); wrap.style.cssText = 'display:flex;gap:4px;align-items:center';
    if (!d[cual]) { return _static('(arrastra la flecha de rango)'); }
    // Cambiar from/to reencaja los TRAMOS (si los hay) y sólo entonces redibuja la
    // ficha — si no, un re-render en cada campo le robaría el foco al usuario.
    function _setExtremo(k, v) {
      d[cual][k] = Number(v);
      _anclarRangoUI(d[cual], d[cual].eje);   // el número que escribió el usuario ES el ancla
      var hayTramos = !!(d[cual].tramos && d[cual].tramos.length > 1);
      if (cual === 'rango') _syncTramos(d);
      _mut(ci, hayTramos);
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
    function _sepDe() { return Number(r.sep) || Number(d.sep) || 20; }
    function _nDeRango() {
      var span = Math.abs(Number(r.to) - Number(r.from));
      return Math.max(1, Math.round(span / _sepDe()) + 1);
    }
    function _aplicarN(n) {
      n = Math.max(1, Math.round(Number(n) || 1));
      r.n = n;
      var sgn = (Number(r.to) >= Number(r.from)) ? 1 : -1;
      r.to = Number(r.from) + sgn * (n - 1) * _sepDe();
      _anclarRangoUI(r, r.eje);               // el `to` calculado por N también se ancla
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
      if (porCantidad) { delete r.n; _mut(ci, true); }
      else { _aplicarN(_nDeRango()); }
    };
    if (porCantidad) {
      var nn = _input({ value: _nDeRango(), type: 'number', min: 1 }, function (v) { _aplicarN(v); });
      nn.style.width = '52px';
      nn.title = 'CUÁNTAS columnas. Parten en ' + Math.round(r.from) + ' cm, cada ' + _sepDe() +
        ' cm; el final se calcula solo.';
      wrap.appendChild(nn);
    } else {
      var fi = _input({ value: Math.round(r.from), type: 'number' }, function (v) { _setExtremo('from', v); });
      fi.style.width = '52px';
      fi.title = 'Dónde va la PRIMERA barra de esta línea (cm desde el centro del elemento, sobre su eje).';
      var ff = _input({ value: Math.round(r.to), type: 'number' }, function (v) { _setExtremo('to', v); });
      ff.style.width = '52px';
      ff.title = 'Dónde va la ÚLTIMA barra (cm). La cantidad la calcula el motor: ceil(dist/@)+1.';
      wrap.appendChild(fi); wrap.appendChild(ff);
    }
    wrap.appendChild(tog);
    return wrap;
  }

  // --- fábricas de UI reutilizables ---
  function _div(cls) { var d = document.createElement('div'); if (cls) d.className = cls; return d; }
  function _label(t) { var l = document.createElement('label'); l.textContent = t; return l; }
  // `title` opcional: el label queda CORTO (no empuja la columna de la grilla) y la
  // explicación larga vive en el tooltip del campo entero.
  function _fld(labelText, inputEl, title) {
    var f = _div('te-fld');
    var l = _label(labelText);
    if (title) { l.title = title; f.title = title; }
    f.appendChild(l); f.appendChild(inputEl);
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
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Mutación de un componente → regenerar. redibujaPanel solo si cambia la ficha.
  // (El snapshot de undo NO se toma aquí: los handlers de campo ya mutaron el
  //  componente antes de llamar a _mut, así que un push aquí capturaría el estado
  //  YA cambiado. El undo cubre las acciones estructurales — colocar/borrar/rotar/
  //  duplicar/agregar/rango/mover/nodo/reordenar — donde el snapshot precede a la
  //  mutación.)
  function _mut(ci, redibujaFicha) {
    _regenerar();
    if (redibujaFicha) _renderPanel();
    else { _actualizarStatus(); }
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

  function _duplicar(ci) {
    var c = ST.receta.componentes[ci]; if (!c) return;
    _pushUndo();
    var copia = JSON.parse(JSON.stringify(c));
    ST.receta.componentes.splice(ci + 1, 0, copia);
    ST.selCi = ci + 1;
    _regenerar(); _renderPanel();
  }

  // Drag-reorder simple (HTML5 DnD sobre el ⠿).
  function _habilitarDrag(wrap, ci) {
    var handle = wrap.querySelector('.te-drag'); if (!handle) return;
    handle.setAttribute('draggable', 'true');
    handle.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', String(ci)); e.dataTransfer.effectAllowed = 'move'; });
    wrap.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    wrap.addEventListener('drop', function (e) {
      e.preventDefault();
      var from = Number(e.dataTransfer.getData('text/plain'));
      var to = ci;
      if (isNaN(from) || from === to) return;
      _pushUndo();
      var arr = ST.receta.componentes;
      var m = arr.splice(from, 1)[0]; arr.splice(to, 0, m);
      ST.selCi = to;
      _regenerar(); _renderPanel();
    });
  }

  // ==========================================================================
  // RIBBON + HERRAMIENTAS
  // ==========================================================================

  // "Cargar" = sellar figura+tipología+φ+contorno del ribbon → el ghost sigue el
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
    ST.cargado = { figura: ST.figura, tipologia: ST.tipologia, diam: Number(ST.diam), contorno: ST.contorno !== false };
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
      // El <select> arranca en el placeholder 'φ…'; asignarle un φ que no está en
      // TE_DIAMS lo dejaría en blanco, así que se comprueba contra la lista.
      if (TE_DIAMS.indexOf(Number(diamCfg)) >= 0) {
        dia.value = String(diamCfg);
        ST.diam = Number(diamCfg);
      }
    }
  }

  // Soltar lo cargado (Esc / herramienta que no coloca) → sin ghost, deselecciona.
  function _soltarCargado() {
    ST.cargado = null;
    _limpiarGhost();
    _actualizarStatus();
  }

  function _bindRibbon() {
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
          }
        }
      });
      fig.addEventListener('change', function () {
        if (!_validarFiguraRibbon(true)) return;
        ST.figura = _figKey(fig.value);
        if (_hayCargado()) _sellarCargado(); else _actualizarStatus();
      });
      if (_figKey(fig.value)) ST.figura = _figKey(fig.value);
    }
    var dia = $('te_ribDiam');
    if (dia && !dia._teBound) {
      dia._teBound = true;
      // La lista de φ la manda TE_DIAMS (una sola fuente para ribbon y panel).
      // PARTE VACÍO (pedido 13-ago): el usuario elige el φ antes de colocar.
      dia.innerHTML = '';
      var ph = document.createElement('option');
      ph.value = ''; ph.textContent = 'φ…'; ph.selected = true;
      dia.appendChild(ph);
      TE_DIAMS.forEach(function (d) {
        var op = document.createElement('option');
        op.value = String(d); op.textContent = String(d);
        dia.appendChild(op);
      });
      dia.addEventListener('change', function () { ST.diam = Number(dia.value) || null; if (_hayCargado()) _sellarCargado(); else _actualizarStatus(); });
      ST.diam = Number(dia.value) || null;
    }
    var con = $('te_ribContorno');
    if (con && !con._teBound) { con._teBound = true; con.addEventListener('change', function () { ST.contorno = con.checked; if (_hayCargado()) _sellarCargado(); }); ST.contorno = con.checked; }

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
  //   VIGA: Largo · Alto · Ancho + "Recub (cm)" ÚNICO (escribe los 3 → como estaba).
  //   MURO: Largo · Alto · ESPESOR(=ancho) + "Recub caras"(=recub_lat) y
  //         "Recub bordes"(=recub_sup+recub_inf, un solo campo para los dos).
  // Un campo con `ks` escribe varias claves; el ajuste fino por barra sigue en
  // "Recub. override" del panel.
  // ==========================================================================
  var GEO_RECUB_DEF = 2;   // cm — lo que muestra el campo si la receta no trae recub
  var GEO_CAMPOS_POR_ELEMENTO = {
    viga: [
      { id: 'te_geoLargo', k: 'largo', lbl: 'Largo', min: 1, title: 'Largo del elemento (cm)' },
      { id: 'te_geoAlto', k: 'alto', lbl: 'Alto', min: 1, title: 'Alto del elemento (cm)' },
      { id: 'te_geoAncho', k: 'ancho', lbl: 'Ancho', min: 1, title: 'Ancho del elemento (cm)' },
      { id: 'te_geoRecub', k: 'recub_sup', ks: ['recub_sup', 'recub_inf', 'recub_lat'], lbl: 'Recub (cm)',
        min: 0, def: GEO_RECUB_DEF, fila: 2, title: 'Recubrimiento (cm) — se aplica arriba, abajo y a los lados' }
    ],
    muro: [
      { id: 'te_geoLargo', k: 'largo', lbl: 'Largo', min: 1, title: 'Largo del muro (cm)' },
      { id: 'te_geoAlto', k: 'alto', lbl: 'Alto', min: 1, title: 'Alto del muro (cm)' },
      { id: 'te_geoAncho', k: 'ancho', lbl: 'Espesor', min: 1, title: 'Espesor del muro (cm) — geometria.ancho' },
      { id: 'te_geoRecubCaras', k: 'recub_lat', lbl: 'Recub caras', min: 0, fila: 2,
        title: 'Recubrimiento de las CARAS del muro (cm) — donde se anclan las cortinas' },
      { id: 'te_geoRecubBordes', k: 'recub_sup', ks: ['recub_sup', 'recub_inf'], lbl: 'Recub bordes', min: 0, fila: 2,
        title: 'Recubrimiento de los BORDES del muro (cm) — arriba, abajo y extremos' }
    ]
  };
  function _geoCampos() {
    return GEO_CAMPOS_POR_ELEMENTO[_tipoElemento()] || GEO_CAMPOS_POR_ELEMENTO.viga;
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
    });
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
    if (caraPlano) _redibujar2D(ST.ultimoOut);   // limpia la cara resaltada
    _setQuadCursor();
    _actualizarStatus();
  }

  // MODO COLOCACIÓN — lo activan "＋ Agregar barra" (ribbon) y "＋ Agregar componente"
  // (panel izq): el ghost sigue al cursor y el clic coloca. Se sale con Esc o con
  // clic derecho sobre una vista. Sustituye a la vieja herramienta "Colocar" y al
  // antiguo _agregarComponenteManual() (que agregaba al tiro, sin pasar por pantalla).
  function _entrarModoColocacion() {
    _sellarCargado();   // re-valida figura/φ y deja el motivo en el status si falta algo
    _activarHerramienta('colocar');
    // Sin sello (figura vacía/inválida o φ vacío) el status ya dice por qué.
    if (!ST.cargado) return;
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
          b.classList.toggle('on');
          var t = b.getAttribute('data-toggle');
          if (t === 'snap') ST.snap = b.classList.contains('on');
          if (t === 'cotas') { ST.cotas = b.classList.contains('on'); _redibujar2D(ST.ultimoOut); }
        });
      });
    }
    // OJO: los binds de abajo van FUERA del guard de #te_ctools y con guard PROPIO —
    // si un día #te_ctools ya viniera marcado, el botón Borrar se quedaba sin listener.
    var del = $('te_btnBorrar');
    if (del && !del._teBound) { del._teBound = true; del.addEventListener('click', function () { _borrarSeleccion(); }); }

    // El botón "⟳ Rotar" del ribbon SE ELIMINÓ (decisión del usuario): duplicaba el
    // "+90°" de la fila "Rotación °" del panel del componente. La acción sigue viva
    // en el panel y con la BARRA ESPACIADORA (_rotarSeleccion), que no se tocó.

    // Los DOS botones "agregar" hacen lo mismo: entrar en modo colocación.
    var addRib = $('te_btnAgregarBarra');
    if (addRib && !addRib._teBound) { addRib._teBound = true; addRib.addEventListener('click', function () { _entrarModoColocacion(); }); }
    var add = $('te_addComp');
    if (add && !add._teBound) { add._teBound = true; add.addEventListener('click', function () { _entrarModoColocacion(); }); }

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
    if (msg) { s.innerHTML = '<b style="color:var(--te-acero-d)">' + _esc(msg) + '</b>'; return; }
    var selTxt = '', avisoTxt = '';
    if (ST.selCi >= 0 && ST.receta.componentes[ST.selCi]) {
      var c = ST.receta.componentes[ST.selCi];
      var ang = (c.orient && c.orient.deg) ? (' · ' + c.orient.deg + '°') : '';
      selTxt = ' · sel: <b>' + _esc(c.tipologia + ' ' + c.figura) + ang + '</b>';
      // AVISOS DEL MOTOR (comp._avisos): lo que NO se generó y por qué — hoy, capas
      // anidadas que no caben (dims ≤ 0 con ese Sep). Se muestran en ROJO junto a
      // la selección: antes esas capas salían con dims aplastadas a 0 (payload que
      // el backend rechaza) y con el bbox fuera del hormigón, en SILENCIO.
      var av = c._avisos;
      if (av && av.length) {
        avisoTxt = ' · <b style="color:#c62828">⚠ ' + _esc(av.join(' · ')) + '</b>';
      }
    }
    // AVISO FIGURA vs TIPOLOGÍA — se RECALCULA acá (no se guarda en ST) para que
    // aparezca y desaparezca solo: basta corregir la figura o la tipología para
    // que la línea vuelva a estar limpia. Ámbar = aviso (se puede colocar), a
    // diferencia del rojo de los avisos del motor, que son cosas que NO salieron.
    var avTip = _figAvisoTipologia(ST.figura, _tipoElemento(), ST.tipologia);
    var tipTxt = avTip ? (' · <b style="color:#e65100">⚠ ' + _esc(avTip.corto) + '</b>') : '';
    s.innerHTML = 'Herramienta: <b>' + _esc(ST.tool) + '</b> · figura <b>' + _esc(ST.figura) + '</b> · ' +
      '<b style="color:' + _colDe(ST.tipologia) + '">' + _esc(ST.tipologia) + '</b> ø' + _esc(ST.diam) +
      tipTxt + selTxt + avisoTxt;
  }

  // Teclado: Ctrl+Z deshace · ESPACIO rota el ángulo fino 90° · R gira la pieza 90°
  // EN LA VISTA ACTIVA (rotar-en-vista, TANDA P) · Supr/Backspace borra.
  function _bindTeclado() {
    if (ST._tecladoOk) return; ST._tecladoOk = true;
    document.addEventListener('keydown', function (e) {
      var bd = $('te_backdrop');
      if (!bd || !bd.classList.contains('on')) return;
      // no capturar mientras se escribe en un input/select (deja el undo nativo del
      // campo de texto y el tipeo normal)
      var tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
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
        // actual: es "volver al punto de partida", no un encuadre nuevo. Devolver la
        // orientación a CAM0 también ENDEREZA EL HORIZONTE: el giro sobre el eje de
        // la pieza (ctrl) deja alabeo, y éste es el botón que lo saca.
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
      // pan con botón medio o shift (el clic izq queda para la interacción SVG)
      if (e.button === 1 || e.shiftKey) { panning = true; lx = e.clientX; ly = e.clientY; e.preventDefault(); }
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
    // claro) lo resuelve el CSS: _aplicarTema3D marca #te_quad con te-tema-* y las
    // variables --te-ov-* invierten cotas, recubrimiento, handles y textos.
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
  // CÁMARA DEL CUADRANTE 3D — modelo, órbita y giro sobre el eje de la pieza
  //
  // MODELO (19-ago): (target, dist, quat, panX, panY).
  //   base   = {derecha, arriba, atrás} = los tres ejes del QUATERNION
  //   ojo    = target + dist·atrás + panX·derecha + panY·arriba
  //   mirada = −atrás
  // Es el modelo de siempre con la orientación guardada como quaternion en vez de
  // (rotX = elevación, rotY = acimut) + el "arriba" clavado en +Y del mundo. Lo que
  // se gana es el TERCER GRADO DE LIBERTAD (el alabeo) y perder la singularidad del
  // cenit —donde la base vieja se degeneraba porque |derecha| = cos(elev) → 0—, y
  // sin las dos cosas no hay giro posible en torno a un eje cualquiera: ver
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
  // sola vez: lo usan el centro y el eje propio, y si divergieran, el pivote y el eje
  // del giro dejarían de ser de la misma pieza.
  function _placementsSeleccion3D() {
    var out = ST.ultimoOut;
    if (ST.selCi < 0 || !out || !out.placements) return [];
    return out.placements.filter(function (pl) { return !!(pl.meta && pl.meta.ci === ST.selCi); });
  }

  // CENTRO (en coords de mundo) del ELEMENTO SELECCIONADO: bbox de TODOS sus
  // placements. Sin selección (o sin geometría todavía) devuelve el centro de la
  // escena — el host está centrado en el origen.
  function _centroSeleccion3D() {
    var lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity }, n = 0;
    _placementsSeleccion3D().forEach(function (pl) {
      (pl.puntos || []).forEach(function (p) {
        if (!p || !isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) return;
        if (p.x < lo.x) lo.x = p.x; if (p.x > hi.x) hi.x = p.x;
        if (p.y < lo.y) lo.y = p.y; if (p.y > hi.y) hi.y = p.y;
        if (p.z < lo.z) lo.z = p.z; if (p.z > hi.z) hi.z = p.z;
        n++;
      });
    });
    if (!n) return { x: 0, y: 0, z: 0 };
    return { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 };
  }

  // --- EJE PROPIO DE LA PIEZA (lo que hace distinto al ctrl+arrastre) -------------
  //
  // Sale de la geometría de UNA colocación —la primera del componente—, no de la nube
  // entera: las copias de una distribución son traslaciones, así que todas dan el
  // mismo eje, y con una sola un estribo suelto y una familia de 30 estribos giran
  // IGUAL. (Con la nube entera no: la familia daba el eje del reparto y el estribo
  // suelto su lado largo, dos respuestas distintas para la misma pieza.)
  //
  // La regla es la del fierro, y son dos casos (quién decide cuál: _piezaEsPlana,
  // que le pregunta al catálogo y sólo si no sabe mira la forma de la nube):
  //   · pieza LINEAL (una barra): su eje es su propia recta → dirección de MAYOR
  //     varianza (λ1).
  //   · pieza PLANA (un estribo, o cualquier figura cerrada o doblada dentro de un
  //     plano): el fierro da la vuelta a un contorno y su eje es el del carrete, o
  //     sea la NORMAL de su plano → dirección de MENOR varianza (λ3).
  // El INDICIO geométrico (el que se usa sólo cuando el catálogo no sabe) corta en
  // λ2/λ1 < 0,05, y los números medidos dicen que no es un ajuste fino: barra recta =
  // 0,0000 · barra de 600 con patas de 20 = 0,0011 · estribo 60×30 = 0,2387 · estribo
  // cuadrado 60×60 = 0,7143. Con la geometría REAL de la semilla de viga: CBS (103B)
  // = 0,0005 y ES (104D) = 0,1598, y las cuatro piezas dan el eje que uno señalaría
  // con el dedo (x, x, x y la traba vertical y) — ver C6 del test.
  var LINEAL_MAX = 0.05;

  // Covarianza 3×3 de una nube de puntos (matriz simétrica, en fila mayor).
  function _covarianzaPuntos(pts) {
    var n = pts.length, i, cx = 0, cy = 0, cz = 0;
    for (i = 0; i < n; i++) { cx += pts[i].x; cy += pts[i].y; cz += pts[i].z; }
    cx /= n; cy /= n; cz /= n;
    var m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < n; i++) {
      var dx = pts[i].x - cx, dy = pts[i].y - cy, dz = pts[i].z - cz;
      m[0] += dx * dx; m[1] += dx * dy; m[2] += dx * dz;
      m[4] += dy * dy; m[5] += dy * dz; m[8] += dz * dz;
    }
    for (i = 0; i < 9; i++) m[i] /= n;
    m[3] = m[1]; m[6] = m[2]; m[7] = m[5];
    return m;
  }

  function _matPorVec(m, v) {
    return { x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
             y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
             z: m[6] * v.x + m[7] * v.y + m[8] * v.z };
  }
  function _varianzaEn(m, v) { var w = _matPorVec(m, v); return v.x * w.x + v.y * w.y + v.z * w.z; }

  // Autovector DOMINANTE por iteración de potencia (48 vueltas). No se arma un
  // solucionador general porque acá sólo hacen falta los dos extremos del espectro:
  // el menor de C es el dominante de tr(C)·I − C, y esta misma función lo saca.
  // La semilla es el eje del mundo con más varianza propia (nunca es ortogonal al que
  // se busca) con una pizca en los otros dos, para que una nube perfectamente alineada
  // con un eje no deje la iteración clavada en un autovector equivocado.
  function _dominante(m) {
    var k = (m[0] >= m[4] && m[0] >= m[8]) ? 0 : (m[4] >= m[8] ? 1 : 2);
    var v = { x: k === 0 ? 1 : 1e-3, y: k === 1 ? 1 : 1e-3, z: k === 2 ? 1 : 1e-3 };
    for (var i = 0; i < 48; i++) {
      v = _matPorVec(m, v);
      var L = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      if (!(L > 1e-12)) return null;
      v.x /= L; v.y /= L; v.z /= L;
    }
    return v;
  }

  // SIGNO CANÓNICO: la componente de mayor módulo, positiva. El eje es una recta (u y
  // −u son el mismo eje), pero el SENTIDO decide para qué lado gira el arrastre; si
  // se dedujera de la cámara podría darse vuelta a mitad del gesto y el arrastre se
  // invertiría solo. Con una regla puramente geométrica, no.
  // LO QUE ESTO CUESTA, dicho: como el eje es fijo en el mundo, mirando la pieza desde
  // el otro lado el gesto se siente invertido (medido: el mismo arrastre mueve un
  // punto +36 px con la cámara abajo y −26 px con la cámara arriba). Es lo que hace
  // cualquier asador: girar sobre un eje fijo se ve al revés desde el otro lado. La
  // órbita normal no lo muestra porque su tope de ±83° la deja siempre en el mismo
  // hemisferio. Cambiar el signo según la cámara traería una discontinuidad peor: el
  // gesto se invertiría A MITAD del arrastre al cruzar el plano de la pieza.
  function _signoCanonico(v) {
    var ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
    var c = (ax >= ay && ax >= az) ? v.x : (ay >= az ? v.y : v.z);
    return (c < 0) ? { x: -v.x, y: -v.y, z: -v.z } : { x: v.x, y: v.y, z: v.z };
  }

  // ¿Contorno cerrado o barra? PRIMERO se le pregunta AL CATÁLOGO (_esContornoCerrado,
  // que sale de la familia de dibujo de la figura): es la verdad, y la forma de la nube
  // sólo es un indicio. Se vio con dos casos que el indicio solo se come:
  //   · barra de 100 con patas de 40 → λ2/λ1 = 0,16 → la nube dice "plana" y la hacía
  //     girar como carrete, cuando es una barra y su eje es su largo;
  //   · estribo 400×12 → λ2/λ1 = 0,002 → la nube dice "lineal" y le quitaba su eje de
  //     carrete, que es lo que un estribo es.
  // ALCANCE REAL DEL CAMBIO, medido: de 441 combinaciones figura×tipología, 314 pasan
  // a decidirse distinto que con la nube sola, y TODAS son 'cadena' (barra doblada) —
  // o sea, barras dobladas que antes giraban como carrete y ahora giran sobre su
  // largo. Es un cambio de política, no dos parches. En el otro sentido no cambia
  // nada: no hay ni un caso de "el catálogo dice plana y la nube decía lineal".
  // EL FALLBACK GEOMÉTRICO casi no se usa, y hay que decirlo: familiaDeDibujo SIEMPRE
  // contesta algo para una figura con nombre (aunque sea inventada). Sólo entra
  // cuando el componente no tiene figura todavía, o cuando este editor corre sin el
  // módulo de figuras (los tests headless de cámara, por ejemplo).
  function _piezaEsPlana(comp, m, traza, u1, u3) {
    if (comp && _familiaDibujo(comp)) return _esContornoCerrado(comp);
    var l1 = _varianzaEn(m, u1);
    var l3 = u3 ? _varianzaEn(m, u3) : 0;
    return !!(u3 && l1 > 0 && ((traza - l1 - l3) / l1) >= LINEAL_MAX);
  }

  // Devuelve el eje propio (unitario, {x,y,z}) o null si la pieza todavía no tiene
  // dos puntos distintos que definan una dirección.
  function _ejePropioSeleccion3D() {
    var pls = _placementsSeleccion3D();
    if (!pls.length) return null;
    var pts = [];
    (pls[0].puntos || []).forEach(function (p) {
      if (p && isFinite(p.x) && isFinite(p.y) && isFinite(p.z)) pts.push(p);
    });
    if (pts.length < 2) return null;
    var m = _covarianzaPuntos(pts);
    var traza = m[0] + m[4] + m[8];
    if (!(traza > 1e-9)) return null;                 // todos los puntos en el mismo sitio
    var u1 = _dominante(m); if (!u1) return null;
    var mi = m.slice();                               // tr·I − C: su dominante es el MENOR de C
    for (var i = 0; i < 9; i++) mi[i] = -mi[i];
    mi[0] += traza; mi[4] += traza; mi[8] += traza;
    var u3 = _dominante(mi);
    var comp = ST.receta && ST.receta.componentes && ST.receta.componentes[ST.selCi];
    var plana = _piezaEsPlana(comp, m, traza, u1, u3);
    return _signoCanonico((plana && u3) ? u3 : u1);
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
    // TOLERANCIA DE 1e-6 cm EN EL RANGO — no es cosmética. La vuelta por el producto
    // punto pierde ~2e-12 cm, así que con la cámara en el mínimo EXACTO (dist = 15,
    // que es donde la deja el clamp de la rueda: 80 ruedas y ahí estás) el pivote de
    // siempre daba 14,999999999999998 y quedaba RECHAZADO: el arrastre se moría de a
    // ratos y el enderezado no volvía nunca. La tolerancia separa el ruido de coma
    // flotante en el borde de lo que el guard sí tiene que atajar — la pieza a 10 cm
    // con el mínimo en 15, que es el salto de 152 px.
    if (!(distN >= DIST_MIN - 1e-6 && distN <= DIST_MAX + 1e-6)) return false;   // detrás del ojo, encima o lejísimos
    // Sin renormalizar a propósito: la orientación se acumula multiplicando
    // quaternions unitarios y la norma se desvía 1,4e-13 en 100.000 pasos de arrastre
    // (medido). Un gesto largo son unos miles: renormalizar sería ruido.
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

  // ABSORBE EL PAN DENTRO DEL PIVOTE — invisible, y evita de raíz el enganche del
  // zoom-hacia-el-cursor: ese zoom hace crecer el pan, y como el pivote se queda
  // donde estaba (a menudo el origen), termina fuera de pantalla; al rotar, la escena
  // "se va volando" porque gira en torno a un punto que no se ve. Mover el pivote al
  // punto que está AL CENTRO DE LA PANTALLA (a la distancia actual) deja el pan en
  // cero sin mover la imagen: el giro siempre es en torno a lo que se está mirando.
  // El alabeo SOBREVIVE (se reescribe el mismo quaternion): un pan después de un
  // giro sobre la pieza no puede enderezar el horizonte de golpe.
  function _absorberPanEnTarget() {
    var THREE = global.THREE;
    if (!THREE || !ST.target) return;
    if (!ST.panX && !ST.panY) return;
    var b = _baseCam();
    _pivotarEnSinMover(_ojoCam(b).addScaledVector(b.atras, -ST.dist));
  }

  // ==========================================================================
  // UN PASO DEL ARRASTRE DE GIRO — LOS DOS MODOS, EN UN SOLO SITIO.
  //
  // POR QUÉ SON DOS COSAS DISTINTAS Y NO DOS VARIANTES DE LO MISMO (no hay que
  // volver a buscarlo, está medido):
  //   · el ojo SIEMPRE orbita el `target`: la base es ortonormal, así que la
  //     distancia no depende de la orientación. Medido en 60 pasos: el target se
  //     mueve 0,000000 px. La teoría de que el pivote efectivo era "target + pan" es
  //     FALSA.
  //   · el ctrl viejo —orbitar rígidamente EN TORNO A LA PIEZA— no se notaba porque
  //     tras cada pan o rueda corre _absorberPanEnTarget y deja el pivote en el punto
  //     que está AL CENTRO DE LA PANTALLA; como uno mira la pieza teniéndola cerca
  //     del centro, girar en torno al centro y girar en torno a la pieza difieren
  //     12,7 px en TODO el gesto (490 px sólo con la pieza lejos del centro). Eran el
  //     mismo gesto.
  // Por eso ctrl ahora cambia el EJE, no el centro:
  //   · arrastre normal → MESA GIRATORIA DEL MUNDO: acimut alrededor de +Y del mundo,
  //     elevación alrededor de la derecha de la cámara. Igual que siempre.
  //   · ctrl+arrastre   → MESA GIRATORIA DE LA PIEZA: el eje vertical del mundo se
  //     reemplaza por el EJE PROPIO de la pieza y el pivote pasa por su centro. La
  //     pieza queda clavada —su recta entera— y la escena da vueltas a su alrededor
  //     como un asador.
  // MEDIDO (tests/test_camara_ctrl.js · barra de 600 cm · arrastre horizontal de
  // 60 pasos × 4 px): los dos puntos de la recta de la pieza se mueven 0,000000 px
  // con ctrl y 339 px sin él; un punto cualquiera de la escena se mueve 735 px con
  // ctrl (la escena SÍ gira), y la imagen de un modo termina hasta 346 px separada de
  // la del otro. Contra los 12,7 px de las cuatro vueltas anteriores.
  //
  // EL PRECIO ES EL ALABEO: girar sobre un eje que no es el vertical INCLINA el
  // horizonte, y tiene que ser así (una cámara rígida no puede girar sobre un eje
  // horizontal dejando el horizonte a nivel). El ⟳ lo devuelve a cero.
  //
  // DÓNDE SE NOTA MENOS, dicho y no escondido: si el eje propio de la pieza ES el
  // vertical del mundo, los dos modos casi coinciden (el eje es el mismo y sólo queda
  // de diferencia el pivote: los 12,7 px de arriba). Barrido de 48 escenarios con la
  // geometría real de la semilla (4 piezas × 4 poses de cámara × 3 gestos, C7 del
  // test): la barra superior, la inferior y el estribo se separan como MÍNIMO 334 px
  // en todos; la única que baja es la TRABA, que es vertical, hasta 11,1 px.
  // ==========================================================================

  var K_GIRO = 0.008;    // rad por píxel de arrastre — el MISMO en los dos modos
  // Tope de elevación de la órbita normal: 1,45 rad ≈ 83°. Existe para no llegar al
  // cenit mirando desde arriba (el gesto se vuelve confuso), no por el modelo — el
  // modelo ya no tiene ahí ninguna singularidad. El giro sobre la pieza NO lo usa: ahí
  // el gesto puede dar la vuelta entera, y toparlo rompería la rigidez.
  var ELEV_MAX = 1.45;

  // ALABEO ACTUAL (rad): cuánto está torcido el horizonte respecto de la vertical del
  // mundo. Sale de comparar el "arriba" de la cámara con el que tendría un lookAt
  // normal desde la misma dirección. Cero mirando al cenit (ahí no hay horizonte que
  // medir) — y ahí tampoco hace falta enderezar nada.
  function _alabeoCam(b) {
    var THREE = global.THREE;
    var der0 = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), b.atras);
    if (!(der0.length() > 1e-6)) return 0;
    der0.normalize();
    var arr0 = new THREE.Vector3().crossVectors(b.atras, der0).normalize();
    return Math.atan2(-b.arriba.dot(der0), b.arriba.dot(arr0));
  }

  // ENDEREZADO PROGRESIVO: fracción del alabeo que se devuelve POR CADA PÍXEL
  // RECORRIDO de arrastre normal. Existe porque el giro sobre la pieza deja el
  // horizonte torcido y la única salida era el ⟳, que además tira abajo el encuadre
  // (medido: dist 240 → 1320, pan a cero y pivote al origen), y porque 500 pasos de
  // órbita normal no enderezaban una cámara volcada.
  // POR PÍXEL Y NO POR EVENTO — importa: cobrándolo por mousemove, el MISMO gesto de
  // 60 px corregía 2,4% partido en 60 eventos de 1 px y 94% en un solo evento de 60
  // (factor 38 medido). Quien parte el gesto es el muestreo del ratón, no el usuario.
  // Con 0,06 por píxel: 60 px de recorrido dejan 2,4% del alabeo —un arrastre normal
  // endereza— y 10 px dejan 54%, así que no se siente como tirón. Sólo actúa si hay
  // alabeo: con la cámara a nivel el giro normal es EXACTAMENTE el de siempre
  // (verificado, 2,8e-10 cm de ojo en 60 pasos).
  var ROLL_DECAY = 0.06;

  // Destuerce el horizonte girando sobre el EJE DE VISTA QUE PASA POR EL OJO. El ojo
  // no se mueve y la dirección de vista tampoco: la imagen sólo ROTA en torno al
  // centro de la pantalla. Hacerlo pasando por el PIVOTE —como estaba— la traslada
  // cuando el pivote no está al centro, que es justo lo que pasa después de un giro
  // con ctrl: medido, el primer píxel de arrastre normal movía la imagen 32 px en vez
  // de los 3 que mueve el arrastre solo.
  // `dPix` = píxeles recorridos por el gesto en este evento.
  // NO PASA POR _fijarCamDesdeOjo, y hay una razón medida: un giro sobre `atrás` deja
  // `atrás` —y por lo tanto `dist`— intactos, pero recalcular dist con un producto
  // punto pierde 2,2e-12 cm, y con la cámara en el mínimo exacto (dist = 15, que es
  // donde te deja el clamp de la rueda: 80 ruedas y ahí estás) eso devolvía
  // 14,999999999999998 → el guard del rango lo rechazaba y el enderezado se apagaba
  // EN SILENCIO Y PARA SIEMPRE (medido: 100 de 100 pasos sin enderezar, alabeo
  // clavado en 51,6°). Acá dist ni se toca y el pan se gira con la fórmula exacta:
  //   ojo = target + dist·atrás + panX·derecha + panY·arriba, y girar la base φ sobre
  //   `atrás` pide pan' = (panX·cosφ + panY·senφ, −panX·senφ + panY·cosφ) para que el
  //   ojo quede EXACTAMENTE donde estaba. El test lo verifica (ojo inmóvil, 1e-9).
  function _enderezarHorizonte(dPix) {
    var THREE = global.THREE;
    var b = _baseCam();
    var roll = _alabeoCam(b);
    if (!roll) return;
    var frac = 1 - Math.pow(1 - ROLL_DECAY, Math.max(0, dPix || 0));
    if (!(frac > 0)) return;
    var ang = -roll * frac;
    ST.quat = new THREE.Quaternion().setFromAxisAngle(b.atras, ang).multiply(_quatCam());
    var c = Math.cos(ang), s = Math.sin(ang);
    var pX = ST.panX * c + ST.panY * s;
    ST.panY = -ST.panX * s + ST.panY * c;
    ST.panX = pX;
    _marcarSucio();
  }

  // ÓRBITA NORMAL. Componer el acimut alrededor de +Y del mundo con la elevación
  // alrededor de la derecha (ya girada) da EXACTAMENTE lo que daba `rotY += dAz;
  // rotX += dEl`, porque el quaternion manda la base vieja a la nueva y el ojo se
  // reconstruye con los mismos dist/pan. El tope se aplica al INCREMENTO y no al
  // resultado: recortarlo después descoloca la escena en vez de frenarla.
  function _orbitarMundo(dAz, dEl) {
    var THREE = global.THREE;
    var b = _baseCam();
    var elev = Math.asin(Math.max(-1, Math.min(1, b.atras.y)));
    dEl = Math.max(-ELEV_MAX - elev, Math.min(ELEV_MAX - elev, dEl));
    if (!dAz && !dEl) return false;
    var qAz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dAz);
    var derecha = b.derecha.clone().applyQuaternion(qAz);
    var q = new THREE.Quaternion().setFromAxisAngle(derecha, -dEl).multiply(qAz);
    if (!_girarCamRigido(ST.target, q)) return false;
    // El giro del mundo devuelve el horizonte a nivel, y se cobra con los píxeles que
    // REALMENTE giraron: por eso se calculan ACÁ, después del tope de elevación y no
    // antes. Contra el tope, un arrastre vertical de 18 px giraba la vista 0,66° y se
    // comía el alabeo entero (medido) — la misma trampa que el radial de eje.
    _enderezarHorizonte(Math.sqrt(dAz * dAz + dEl * dEl) / K_GIRO);
    return true;
  }

  // MESA GIRATORIA CON EL EJE DE LA PIEZA. Es la MISMA construcción de arriba
  // cambiando dos cosas: el eje vertical del mundo por `u` y el pivote por `p`.
  //   dAz → giro alrededor de u — el asador: la recta de la pieza no se mueve.
  //   dEl → giro alrededor de normalize(u × atrás), que es el análogo EXACTO de la
  //         derecha de la cámara (three la arma igual: normalize(arriba_mundo × atrás)).
  // Mirando justo a lo largo de la pieza ese producto cruz se degenera y se cae a la
  // derecha de la cámara, así el arrastre vertical nunca queda muerto.
  // EFECTO LATERAL CONOCIDO: al pivotar en la pieza, `dist` pasa a ser la distancia al
  // plano de LA PIEZA, no al del centro de pantalla (medido: −7% con la pieza 100 cm
  // más cerca, −45% con 600). Como el pan y el paso de la rueda se escalan con `dist`,
  // después de un giro con ctrl el pan va más lento. Es coherente —se pana a la
  // profundidad de lo que se está mirando— y es el precio de que el pivote sea la
  // pieza; el primer pan lo devuelve al centro de pantalla (_absorberPanEnTarget).
  function _girarSobreEje(p, u, dAz, dEl) {
    var THREE = global.THREE;
    var b = _baseCam();
    var ejeU = new THREE.Vector3(u.x, u.y, u.z);
    if (!(ejeU.length() > 1e-9)) return false;
    ejeU.normalize();
    var qAz = new THREE.Quaternion().setFromAxisAngle(ejeU, dAz);
    var perp = new THREE.Vector3().crossVectors(ejeU, b.atras);
    if (!(perp.length() > 1e-6)) perp.copy(b.derecha);
    perp.normalize().applyQuaternion(qAz);
    var q = new THREE.Quaternion().setFromAxisAngle(perp, -dEl).multiply(qAz);
    return _girarCamRigido(p, q);
  }

  // ¿EL EJE DE LA PIEZA ES EL VERTICAL DEL MUNDO? Ahí los dos modos COINCIDEN, y no
  // por un error: el giro normal ya gira sobre la vertical, así que girar sobre el eje
  // de una barra de pie es el MISMO giro y sólo queda de diferencia el centro (los
  // 12,7 px de siempre). Medido con la traba de la semilla, arrastre horizontal:
  // 0,0 px de diferencia. No se puede arreglar sin dejar de hacer lo que dice el
  // nombre del modo, así que se DICE en la barra de estado en vez de fingir.
  // EL CORTE ES ANGOSTO A PROPÓSITO: 0,996 = 5° de la vertical, que es donde el gesto
  // completo separa ~23 px (o sea, casi nada). Con 12° ya separaba 64 px —se ve— y el
  // aviso habría estado mintiendo al revés: diciendo "esto se verá igual" cuando sí se
  // nota. Más vale avisar de menos.
  var COS_VERTICAL = 0.996;

  // Aplica un paso de arrastre. `enPieza` = ctrl sostenido (y con selección viva).
  // Devuelve el modo que REALMENTE se aplicó ('pieza' | 'pieza-vertical' | 'mundo') o
  // null si el gesto no movía nada, para que la barra de estado pueda decir la verdad.
  function _girarPorArrastre(dx, dy, enPieza) {
    var THREE = global.THREE;
    if (!THREE || !ST.target) return null;
    // EJE RESTRINGIDO (radial X/Y/Z): el incremento se recorta ANTES de elegir el
    // modo, así los dos usan el MISMO delta y el ctrl no cambia la velocidad del
    // gesto, sólo su eje. Las letras son las visibles del editor (EJE_DISPLAY): acá
    // la vertical se rotula 'Z', igual que en el gizmo.
    //   Z    → sólo el giro de acimut (o el del eje de la pieza, con ctrl).
    //   X/Y  → sólo el de elevación (o el de su perpendicular, con ctrl).
    var eje = ST.ejeRot || 'libre';
    var dAz = (eje === 'libre' || eje === 'z') ? -dx * K_GIRO : 0;
    var dEl = (eje === 'z') ? 0 : dy * K_GIRO;
    if (!dAz && !dEl) return null;
    if (enPieza) {
      var u = _ejePropioSeleccion3D();
      if (u && _girarSobreEje(_centroSeleccion3D(), u, dAz, dEl)) {
        return (Math.abs(u.y) >= COS_VERTICAL) ? 'pieza-vertical' : 'pieza';
      }
    }
    // (el enderezado del horizonte se cobra dentro de _orbitarMundo, con los píxeles
    // que sobreviven al radial de eje Y al tope de elevación)
    return _orbitarMundo(dAz, dEl) ? 'mundo' : null;
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

  // BUG 4 — PAN del 3D rotaba en vez de panear. Rediseño del reparto de botones con un
  // ÚNICO estado 'mode' ('pan' | 'rot' | null) fijado en el mousedown, mutuamente
  // exclusivo (antes había 2 flags drag/panning que podían quedar mal). Reparto:
  //   · botón IZQUIERDO sin modificador     → ROTAR (mesa giratoria del mundo)
  //   · CTRL/⌘ + izquierdo                  → GIRAR SOBRE EL EJE PROPIO DE LA PIEZA
  //   · botón MEDIO, botón DERECHO, o SHIFT/ALT+izq → PAN
  //
  // EL CTRL, QUINTA VUELTA (19-ago), por «no siento ni veo diferencia alguna al usar
  // CTRL» arrastrado durante varias sesiones. Las cuatro anteriores movieron el
  // CENTRO del giro (pivote en la pieza), y eso está medido: es indistinguible del
  // giro normal, porque el pivote normal queda en el centro de la pantalla y ahí es
  // donde uno tiene la pieza — 12,7 px de diferencia en todo el gesto. Ahora ctrl
  // cambia el EJE, no el centro; el álgebra y los números están en la nota de
  // _girarPorArrastre. La decisión aquí es sólo de reparto de botones.
  // El pivote QUEDA en la pieza mientras dure el gesto y también el arrastre siguiente
  // (no se "presta" y se devuelve). Lo que sí lo suelta es el primer pan o la primera
  // rueda, porque _absorberPanEnTarget lo lleva al centro de la pantalla: es lo que
  // hace falta para que el zoom al cursor no mande la escena a volar.
  //
  // El mousedown captura el botón real (e.button) Y los modificadores del PROPIO evento
  // (no de un mousemove posterior, que podía llegar sin shift y caer a rotar). El middle
  // click además necesita preventDefault en 'mousedown' Y 'auxclick' para matar el
  // autoscroll del navegador (que se tragaba los mousemove y hacía que "no paneara").
  function _bindOrbita(cv) {
    var mode = null, lx = 0, ly = 0;
    // El aviso de "ctrl sin selección" se dice UNA vez por gesto (el mousemove llega
    // decenas de veces por segundo); se rearma al soltar el botón.
    var ctrlAviso = false;
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });   // botón der = pan, no menú
    cv.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });   // mata autoscroll medio
    cv.addEventListener('mousedown', function (e) {
      lx = e.clientX; ly = e.clientY;
      // PAN si: botón medio (1) · botón derecho (2) · o izquierdo con shift/alt.
      var quierePan = (e.button === 1 || e.button === 2 || e.shiftKey || e.altKey);
      if (e.button === 0 && !quierePan) mode = 'rot';   // con o sin ctrl: rotar
      else mode = quierePan ? 'pan' : null;
      if (mode) e.preventDefault();
    });
    global.addEventListener('mouseup', function () {
      ctrlAviso = false;
      // Fin de un gesto de PAN: el pivote vuelve a lo que quedó al centro (ver
      // _absorberPanEnTarget). Sin esto el giro siguiente sale volando.
      if (mode === 'pan') _absorberPanEnTarget();
      mode = null;
    });
    global.addEventListener('mousemove', function (e) {
      if (!mode) return;
      var dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (mode === 'pan') {
        ST.panX -= dx * ST.dist * 0.0011; ST.panY += dy * ST.dist * 0.0011;
      } else {   // rot
        // El modificador se lee del PROPIO mousemove (no del mousedown) para poder
        // apretarlo y soltarlo A MITAD del gesto: se encuadra con la mesa del mundo y
        // se remata girando sobre el eje de la pieza, sin soltar el botón.
        var quiereEnPieza = !!(e.ctrlKey || e.metaKey);
        if (quiereEnPieza && ST.selCi < 0) {
          // Sin selección no hay eje propio: se gira normal y se avisa.
          if (!ctrlAviso) {
            ctrlAviso = true;
            _actualizarStatus('El giro sobre el eje de la pieza necesita una barra seleccionada: no hay ninguna, se gira la escena.');
          }
          quiereEnPieza = false;
        }
        // Los dos modos viven en _girarPorArrastre (con el mismo delta: ctrl cambia el
        // eje, no la velocidad). Devuelve lo que REALMENTE hizo, y de ahí sale el
        // aviso: es la única señal en pantalla de que el arrastre está haciendo otra
        // cosa, y se dice UNA vez por gesto (el mousemove llega decenas de veces por
        // segundo).
        var modo = _girarPorArrastre(dx, dy, quiereEnPieza);
        if (quiereEnPieza && !ctrlAviso && modo) {
          ctrlAviso = true;
          _actualizarStatus(
            modo === 'pieza' ? 'Giro sobre el EJE PROPIO de la pieza: su recta queda clavada y la escena da vueltas a su alrededor (el horizonte se inclina; el arrastre normal lo vuelve a enderezar).'
              : modo === 'pieza-vertical' ? 'El eje de esta pieza es VERTICAL, así que girar sobre él se ve casi igual que el giro normal (sólo cambia el centro). Con una barra o un estribo tumbado la diferencia salta.'
                : 'No se pudo agarrar el eje de esa pieza (¿quedó fuera de cuadro o pegada al ojo?): se gira la escena.');
        }
      }
      _marcarSucio();   // PERF: la cámara 3D cambió → repintar
    });
    // ZOOM HACIA EL CURSOR — la matemática vive en _zoomAlCursor (arriba); acá sólo
    // se traduce el evento a fracciones del cuadrante.
    var _absTimer = null;
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = cv.getBoundingClientRect();
      var hayRect = (r.width > 1 && r.height > 1);
      _zoomAlCursor(_factorZoomRueda(e),
        hayRect ? (e.clientX - r.left) / r.width : 0.5,
        hayRect ? (e.clientY - r.top) / r.height : 0.5,
        hayRect ? (r.width / r.height) : 0);
      // Fin del gesto de rueda = mismo silencio que usa _factorZoomRueda. Ahí el pan
      // acumulado se absorbe en el pivote (ver _absorberPanEnTarget).
      if (_absTimer) global.clearTimeout(_absTimer);
      _absTimer = global.setTimeout(function () { _absTimer = null; _absorberPanEnTarget(); }, _ZOOM_GAP);
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
    // giro sobre el eje de la pieza deja ALABEO, y un lookAt con el arriba del mundo
    // lo perdería — el triad diría que el horizonte está a nivel cuando no lo está.
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
        if (bd && bd.classList.contains('on')) _posicionarFlipBtn();
      });
    }
  }

  // T2 — templateEditorAbrir(cfg) con firma EXTENDIDA (§GAP-ANALYSIS-TE · AGENTE 1):
  //   cfg = { elemento, nombre, dims, receta?, templateId?, obra?, puedeModificar? }
  //         | undefined.
  //   · Con cfg (pantalla previa "Crear" / "Abrir"): hormigón listo desde dims y
  //     CERO componentes (o la receta guardada si viene de "Abrir").
  //   · SIN args (ruta vieja / tests): conserva el comportamiento actual con semilla.
  global.templateEditorAbrir = function (cfg) {
    var bd = $('te_backdrop');
    if (!bd) { alert('El Template Editor aún se está cargando. Reintenta en un momento.'); return; }
    var d = _deps();
    if (cfg && cfg.elemento) {
      ST.elemento = String(cfg.elemento).toLowerCase();
      ST.nombre = (cfg.nombre || '').trim();
      ST.templateId = (cfg.templateId != null) ? cfg.templateId : null;
      ST.obra = (cfg.obra != null) ? cfg.obra : null;
      // Sin dato explícito se asume que SÍ (un template nuevo es de quien lo crea);
      // el backend manda el valor real al abrir uno de la biblioteca.
      ST.puedeModificar = (cfg.puedeModificar === false) ? false : true;
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
      ST.selCi = -1; ST.ultimoOut = null;
      ST.dragMove = null; ST.dragMarco = null; ST.dragRango = null;
    } else {
      // Ruta vieja: semilla (solo para tests / compatibilidad).
      if (!ST.receta && d.semilla) ST.receta = d.semilla.semillaViga();
      ST.elemento = (ST.receta && ST.receta.tipo) || 'viga';
      if (!ST.nombre) ST.nombre = 'Viga tipo Explora';
      if (ST.templateId === undefined) ST.templateId = null;
    }
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
  }

  // T2 — dirty-check en TODAS las salidas (✕, backdrop, Esc pasan por aquí).
  global.templateEditorCerrar = function () {
    if (_hayCambiosSinGuardar() && !global.confirm('Hay cambios sin guardar. ¿Cerrar igual?')) return;
    _cerrarModal();
  };

  // Botón "📂 Abrir" del titlebar: volver a la pantalla previa (que ya lista los
  // guardados — no hay mini-lista dentro del modal). Confirm propio si hay cambios.
  global.templateEditorVolverALista = function () {
    if (_hayCambiosSinGuardar() && !global.confirm('Hay cambios sin guardar. ¿Volver a la lista igual?')) return;
    _cerrarModal();
    // La biblioteca se re-pide al volver: si se guardó (o se renombró) en esta
    // sesión, la lista de atrás tiene los datos viejos hasta que alguien la toque.
    if (typeof global.tplCargarGuardados === 'function') global.tplCargarGuardados();
  };

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
    // Sufijo informativo: si el template vino de la biblioteca se dice, para que
    // "Guardar cambios" no sorprenda a nadie.
    var ruta = $('te_subRuta');
    if (ruta) {
      ruta.textContent = (ST.templateId != null)
        ? ('· biblioteca #' + ST.templateId + (ST.puedeModificar === false ? ' (de otro usuario)' : ''))
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

  // ---- Ribbon dinámico de tipologías por elemento (wrap si son >6) ----
  function _renderRibbonTips() {
    var cont = $('te_tipbtns'); if (!cont) return;
    var lista = TPL_TIPOLOGIAS[(ST.elemento || 'viga').toUpperCase()] || TPL_TIPOLOGIAS.VIGA;
    var codigos = lista.map(function (t) { return t[0]; });
    if (codigos.indexOf(ST.tipologia) === -1) ST.tipologia = codigos[0];
    cont.innerHTML = lista.map(function (t) {
      var col = TPL_COLORES[t[0]] || '#607d8b';
      return '<span class="te-tipbtn' + (t[0] === ST.tipologia ? ' on' : '') + '" data-tip="' + _esc(t[0]) +
        '" title="' + _esc(t[1]) + '"><span class="te-sw" style="background:' + col + '"></span>' + _esc(t[0]) + '</span>';
    }).join('');
    // Cambiar de ELEMENTO cambia las tipologías (y arriba pudo reasignarse
    // ST.tipologia): el datalist y el campo Figura tienen que seguirlas, si no el
    // ribbon queda ofreciendo y validando contra la tipología del elemento anterior.
    // El prellenado va sin forzar: acá el usuario no eligió tipología, así que sólo
    // se rellena lo que está vacío (apertura del editor / cambio de elemento).
    _prellenarRibbonDesdeConfig(false);
    _refrescarFigDatalist();
    _validarFiguraRibbon(false);
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
      return '<span class="muted" title="El backend todavía no manda este dato en GET /templates">—</span>';
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
      '<th ' + th + '>Obra</th><th ' + th + '>Última edición</th><th></th></tr>' +
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
        return '<tr style="border-bottom:1px solid #eee;">' +
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
          '<td style="padding:4px 6px; text-align:right; white-space:nowrap;">' +
            '<button data-id="' + _esc(t.id) + '" onclick="tplAbrirTemplate(this.getAttribute(\'data-id\'))"' +
            ' style="' + btnCss + '">Abrir</button> ' +
            // Eliminar sólo a quien el BACKEND dijo que puede (puede_modificar): un
            // botón que siempre termina en 403 no es un botón, es una trampa.
            '<button data-id="' + _esc(t.id) + '"' + (puedo ? '' : ' disabled') +
            ' onclick="tplEliminarTemplate(this.getAttribute(\'data-id\'))"' +
            ' title="' + (puedo ? 'Eliminar este template' : 'Sólo su autor (o un administrador) puede eliminarlo') + '"' +
            ' style="' + btnCss + (puedo ? ' color:#c62828;' : ' opacity:.4; cursor:default;') + '">🗑</button>' +
          '</td></tr>';
      }).join('') +
      '</table>' +
      // Pendiente A LA VISTA, no escondido en un comentario: mientras GET /templates
      // no traiga estos tres campos, las columnas quedan en '—'.
      '<div class="muted" style="font-size:10.5px; margin-top:8px;">Barras, peso estimado y φ promedio ' +
      'salen en «—» porque <b>GET /templates todavía no los manda</b>: la lista es liviana y sólo trae ' +
      'el número de componentes. Los pesos, cuando lleguen, son <b>estimados</b> (dependen del hormigón ' +
      'contra el que se genere el template).</div>';
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
    _ghostForma: _ghostForma,
    // Ghost con la FORMA REAL: la polilínea proyectada y el componente de preview
    // (el MISMO que crea el clic) — para poder comparar ghost ≡ barra colocada.
    _ghostPlacement: _ghostPlacement, _ghostFormaBasica: _ghostFormaBasica,
    _compDesdeClick: _compDesdeClick,
    // TANDA P · POSE CANÓNICA {cara, lado, rumbo, espejo} + rotar-en-vista
    _poseDe: _poseDe, _setPose: _setPose, _poseTexto: _poseTexto,
    _poseDefault: _poseDefault, _poseDefaultMotor: _poseDefaultMotor,
    _rumbosDeCara: _rumbosDeCara, _rumboValido: _rumboValido, _rumboDefaultDeCara: _rumboDefaultDeCara,
    rotarPoseEnVista: rotarPoseEnVista,                         // gira 90° en el eje de profundidad de la vista
    _rotarPoseSeleccion: _rotarPoseSeleccion, _vistaActiva: _vistaActiva,
    _ejeProfundidadDeVista: _ejeProfundidadDeVista,
    _reencuadrarReparto: _reencuadrarReparto,
    _ladoDominante: _ladoDominante,                             // parcial que se estira/ancla
    // LADO DOMINANTE: verlo en el preview (tramo destacado) y elegirlo en la ficha
    _ladoDomMotor: _ladoDomMotor,                               // el del MOTOR, sin fallback
    _ladoDomElegido: _ladoDomElegido, _setLadoDominante: _setLadoDominante,
    _tramoDominanteEnTrazo: _tramoDominanteEnTrazo,             // rango [i0,i1] en el trazo
    // PIEZA SELECCIONADA: dónde está (pivote) y cuál es su eje propio (el de ctrl)
    _placementsSeleccion3D: _placementsSeleccion3D, _centroSeleccion3D: _centroSeleccion3D,
    _ejePropioSeleccion3D: _ejePropioSeleccion3D,
    _pivotarEnSinMover: _pivotarEnSinMover, _absorberPanEnTarget: _absorberPanEnTarget,
    // MODELO DE CÁMARA (quaternion) + los dos modos de giro y su descomposición inversa
    _baseCam: _baseCam, _ojoCam: _ojoCam, _quatDeAngulos: _quatDeAngulos, CAM0: CAM0,
    _girarPorArrastre: _girarPorArrastre, _girarCamRigido: _girarCamRigido,
    _alabeoCam: _alabeoCam, _enderezarHorizonte: _enderezarHorizonte,
    _fijarCamDesdeOjo: _fijarCamDesdeOjo,
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
    // FIGURA vs TIPOLOGÍA (aviso, no bloqueo)
    _figsDeTipologia: _figsDeTipologia, _figsDeTipologiaActiva: _figsDeTipologiaActiva,
    _figAvisoTipologia: _figAvisoTipologia, _validarFiguraRibbon: _validarFiguraRibbon,
    _actualizarStatus: _actualizarStatus,   // la barra de estado lleva el aviso
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
