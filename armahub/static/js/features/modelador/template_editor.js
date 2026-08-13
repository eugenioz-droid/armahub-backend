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

  // Tema CLARO del 3D del cuadrante (calca --canvas3d / colores de la maqueta).
  var TEMA = {
    bg: 0xd8dee7, g1: 0xb4bdc9, g2: 0xc6cdd6,
    CBS: 0x1565c0, CBI: 0x00897b, ES: 0xe65100, TRV: 0x7b1fa2, LT: 0x455a64
  };

  var GRID_SNAP = 5;   // cm — paso de snap a grilla

  var ST = {
    receta: null, ultimoOut: null,
    scene: null, camera: null, renderer: null, world: null, grid: null,
    materiales: null,
    rotX: 0.55, rotY: 0.9, dist: 900, target: null, panX: 0, panY: 0,
    threeCargado: false, webglOk: null, rafId: null, verHormigon: true,
    // --- Estado de interacción 2D ---
    figura: '103B', tipologia: 'CBS', diam: 16, contorno: true,
    tool: 'mover', snap: true, cotas: false,   // arranca en SELECCIONAR (flechita), no colocando
    selCi: -1,                 // índice del componente seleccionado (-1 = ninguno)
    ultimoPlano: 'largo',      // última vista tocada (define el eje de rotación)
    transforms: {},            // {plano: {minU,maxU,minV,maxV,s,offX,offY}}
    dragMove: null,            // {ci, plano, startHost, startHint} durante mover
    dragNode: null,            // {plano, corner} durante arrastre de nodo
    dragRango: null,           // {ci} durante arrastre de la flechita doble
    // --- Snap de CARA (§INTERACCIÓN-2.0) — elegir la cara VIENDO ---
    caraHi: null,              // {plano, cara, edge, orient, pos, a, b} cara resaltada bajo el cursor
    _regenPendiente: false,
    _uiOk: false,
    // --- P3: plano de trabajo activo resaltado en el 3D ---
    //   'seccion' | 'largo' | 'planta' | null  (null = ninguno resaltado)
    planoActivo: null, planoMesh: null, elemento: 'viga',
    // --- T2 (pantalla previa + guardar/abrir) ---
    // nombre: nombre del template (se define en el TAB, antes de entrar al modal).
    // templateId: id si vino de "Abrir" (el POST crea COPIA: no hay PUT).
    // _recetaGuardada: JSON.stringify de la receta al abrir / tras guardar (dirty-tracking).
    nombre: '', templateId: null, _recetaGuardada: null,
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
  var TIP_ROL = {
    ES: 'estribo', ESC: 'estribo', EC: 'estribo',
    TRV: 'traba', TR: 'traba', TC: 'traba', TRC: 'traba', TRL: 'traba', TRF: 'traba'
  };
  function _rolDe(t) {
    t = (t || '').toUpperCase();
    return TIP_ROL[t] || 'cabezal';   // CBS/CBI/LT/... = cabezal (longitudinal)
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
  function _refrescarFigDatalist() {
    var dl = $('te_figs'); if (!dl) return;
    var F = _figuras(), html = '';
    _figsDibujables().forEach(function (k) {
      var d = F[k] || {};
      var lbl = (d.descripcion ? d.descripcion + ' · ' : '') + (d.parciales || []).join('');
      html += '<option value="' + _esc(k) + '"' + (lbl ? ' label="' + _esc(lbl) + '"' : '') + '>';
    });
    dl.innerHTML = html;
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
        if (bd && bd.classList.contains('on')) _renderPanel();   // la ficha re-lee parciales
      }, function () {
        ST._catPedido = false;                                   // reintenta al reabrir
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
  var _ORIENT_LABEL = { acostada: 'acostada', volteada: 'volteada', de_pie: 'de pie' };
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

  // ¿el componente ci está VOLTEADO? (orientación 'volteada'). Sólo lo usa la UI
  // (estado del botón); el efecto GEOMÉTRICO lo resuelve el motor por permutación
  // de ejes (§INTERACCIÓN-2.0 · G3/B3).
  function _compVolteado(ci) {
    if (ci == null || ci < 0 || !ST.receta) return false;
    return _orientacionDe(ST.receta.componentes[ci]) === 'volteada';
  }
  // Orientación del componente ci (para el botón/estado de la UI).
  function _compOrientacion(ci) {
    if (ci == null || ci < 0 || !ST.receta) return 'acostada';
    return _orientacionDe(ST.receta.componentes[ci]);
  }

  // dims por defecto para una figura recién colocada. Estribo con "tomar contorno"
  // → todas auto (se ajustan al recubrimiento; recub 0 = al borde). Cabezal con
  // lados → B auto (largo − recub), patas A/C fijas.
  function _dimsDefault(fig, rol, contorno) {
    var spec = _figSpec(fig);
    var dims = {};
    spec.parciales.forEach(function (L) {
      if (rol === 'estribo') { dims[L] = { modo: 'auto' }; return; }
      if (rol === 'cabezal' && (L === 'A' || L === 'C')) { dims[L] = { modo: 'fija', valor: 15 }; return; }
      dims[L] = { modo: 'auto' };
    });
    if (rol === 'estribo' && contorno === false) dims.__contorno = false;
    return dims;
  }

  // Distribución por defecto según rol.
  function _distDefault(rol) {
    if (rol === 'estribo') {
      return { modo: 'linear', activa: false, sep: 20, zonas: [{ long: 0, sep: 20 }], start_offset: 4 };
    }
    if (rol === 'traba') {
      return { modo: 'linear', activa: false, sep: 40, zonas: [{ long: 0, sep: 40 }], start_offset: 4 };
    }
    return { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 4, sentido: 'nucleo', justify: 'centrar' };
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
    var reglas = global.ModeladorReglas;
    if (reglas && reglas.modoDefaultDeTipologia) return reglas.modoDefaultDeTipologia(tip);
    var rol = _rolDe(tip);
    return (rol === 'estribo' || rol === 'traba') ? 'lineal' : 'puntual';
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
    return { from: -dim / 2 + r, to: dim / 2 - r, sep: sep || 20, eje: (eje === 'y' || eje === 'z') ? eje : 'x' };
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
    var sepBase = Math.max(1, Number(d && d.sep) || 20);
    var t = (d && d.rango && d.rango.tramos) || null;
    if (!t || !t.length) return [{ long: total, sep: sepBase }];
    return _ajustarTramos(t.map(function (x) {
      return { long: Math.max(0, Number(x && x.long) || 0), sep: Math.max(1, Number(x && x.sep) || sepBase) };
    }), total);
  }

  // Escribe los tramos. Con 1 solo tramo se BORRA `tramos` y se vuelve al shape simple
  // (d.sep) → el motor toma exactamente el camino de siempre.
  function _setTramos(d, arr) {
    d.rango = d.rango || {};
    if (!arr || arr.length <= 1) {
      var s = Math.max(1, (arr && arr[0] && Number(arr[0].sep)) || Number(d.sep) || 20);
      delete d.rango.tramos;
      d.sep = s; d.rango.sep = s;
      return;
    }
    d.rango.tramos = arr.map(function (x) {
      return { long: Math.round((Number(x.long) || 0) * 10) / 10, sep: Math.max(1, Number(x.sep) || 20) };
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
    var rol = _rolDe(c.tipologia);
    var ejeD = _ejeDistDe(c);   // X, o Z si la pieza está volteada
    d.modo = MODO_A_DIST[modo];
    if (modo === 'puntual') {
      if (d.n_capas == null) d.n_capas = 1;
      if (d.barras_capa == null) d.barras_capa = 1;
      if (d.gap == null) d.gap = 4;
      if (d.sentido == null) d.sentido = 'nucleo';
      if (d.justify == null) d.justify = 'centrar';
    } else if (modo === 'lineal') {
      if (d.sep == null) d.sep = (rol === 'traba') ? 40 : 20;
      if (!d.rango) d.rango = _rangoDefault(d.sep, ejeD);
      else if (d.rango.eje == null) d.rango.eje = ejeD;   // migrar rangos viejos sin eje
      d.activa = true;
      if (c.pos_hint) delete c.pos_hint[ejeD];   // el rango la distribuye
    } else { // arreglo
      if (d.sep == null) d.sep = (rol === 'traba') ? 40 : 20;
      if (!d.rango) d.rango = _rangoDefault(d.sep, ejeD);
      else if (d.rango.eje == null) d.rango.eje = ejeD;
      if (d.n_capas == null) d.n_capas = 2;      // arreglo real ≥ 2 capas
      if (d.sep_capas == null) d.sep_capas = 10;
      if (d.eje_capas == null) d.eje_capas = _ejeCapasDefault();
      d.activa = true;
      if (c.pos_hint) delete c.pos_hint[ejeD];
    }
  }

  // Nombre corto legible del componente (para el panel).
  function _compDesc(c) {
    var d = c.distribucion || {};
    var modo = _modoDe(c);
    var caraTxt = (c.cara === 'inf' ? 'inferior' : (c.cara === 'sup' ? 'superior' : 'lateral'));
    if (modo === 'arreglo') {
      return caraTxt + ' · arreglo ' + (d.n_capas || 2) + '×@' + (d.sep || 20) + ' · ø' + c.diam;
    }
    if (modo === 'puntual') {
      var nc = d.n_capas || 1;
      return caraTxt + ' · ' + nc + ' capa' + (nc > 1 ? 's' : '') + '×' + (d.barras_capa || 1) + ' · ø' + c.diam;
    }
    // lineal
    return caraTxt + ' · lineal @' + (d.sep || 20) + ' · ø' + c.diam;
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

  function _regenerar() {
    var d = _deps();
    if (!d.gen || !ST.receta) return;
    var out = d.gen.generarViga(ST.receta, {});
    _etiquetarCi(out);
    ST.ultimoOut = out;
    var fi = $('te_footItems'), fb = $('te_footBarras'), fk = $('te_footKg');
    if (fi) fi.textContent = out.resumen.items;
    if (fb) fb.textContent = out.resumen.barras;
    if (fk) fk.textContent = _num(out.resumen.kg);
    _renderBarras();   // listado de barras del panel (contador siempre; tabla si está abierto)
    _redibujar2D(out);
    // WARNING ANTI-COLAPSO: se evalúa SIEMPRE (aunque no haya WebGL) — el aviso es
    // sobre el tamaño del elemento, no sobre el 3D.
    _actualizarWarnTamano((out.placements || []).length);
    if (ST.threeCargado && ST.webglOk) _redibujar(out);
    _marcarSucio();
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
    ST.dragMove = null; ST.dragNode = null; ST.dragRango = null;
    _regenerar();
    _renderPanel();
    _actualizarStatus('Deshecho.');
  }

  function _initEscena() {
    var THREE = global.THREE;
    var cv = $('te_cv');
    if (!cv) return false;
    ST.scene = new THREE.Scene();
    ST.scene.background = new THREE.Color(TEMA.bg);
    ST.camera = new THREE.PerspectiveCamera(38, 1, 1, 8000);
    try {
      ST.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
      ST.renderer.localClippingEnabled = true;   // habilita el plano de corte de las vistas orto
    } catch (e) { ST.webglOk = false; return false; }
    ST.world = new THREE.Group(); ST.scene.add(ST.world);
    ST.target = new THREE.Vector3(0, 0, 0);
    ST.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    var dir = new THREE.DirectionalLight(0xffffff, 0.7); dir.position.set(1, 1.4, 0.8); ST.scene.add(dir);
    var dir2 = new THREE.DirectionalLight(0xbcd4ff, 0.3); dir2.position.set(-1, -0.4, -0.7); ST.scene.add(dir2);
    ST.grid = new THREE.GridHelper(1400, 28, TEMA.g1, TEMA.g2); ST.grid.position.y = -1; ST.scene.add(ST.grid);
    ST.materiales = {
      CBS: new THREE.MeshStandardMaterial({ color: TEMA.CBS, metalness: 0.5, roughness: 0.5 }),
      CBI: new THREE.MeshStandardMaterial({ color: TEMA.CBI, metalness: 0.5, roughness: 0.5 }),
      ES: new THREE.MeshStandardMaterial({ color: TEMA.ES, metalness: 0.5, roughness: 0.5 }),
      TRV: new THREE.MeshStandardMaterial({ color: TEMA.TRV, metalness: 0.5, roughness: 0.5 }),
      LT: new THREE.MeshStandardMaterial({ color: TEMA.LT, metalness: 0.5, roughness: 0.5 }),
      // BUG 7: el hormigón es el VOLUMEN DE REFERENCIA y NO debe seguir la regla del
      // cuchillo (si lo recortan los clipping planes, en algunas vistas la cara
      // desaparece). clippingPlanes:[] hace que ESTE material ignore los planos de
      // corte globales del renderer → la caja de hormigón se ve SIEMPRE completa.
      hormigon: new THREE.MeshStandardMaterial({ color: 0x9aa6b5, transparent: true, opacity: 0.14, roughness: 0.9, depthWrite: false, clippingPlanes: [] })
    };
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
      var mat = _matDe(pl.tipologia);
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
      mesh.userData.rol = _rolDe(pl.tipologia);
      mesh.userData.ejeMayor = _ejeMayorSpan(pl.puntos);
      ST.barras3D.push(mesh);
      ST.world.add(mesh);
    });
    _resaltarSeleccion3D();    // selección sutil: leve emissive en la pieza activa
    ST.dist = g.largo * 1.15 + 160;
    _redibujarPlanoActivo();   // P3 — re-agregar el resaltado tras vaciar el world
    ST.dirty = true;
  }

  // SELECCIÓN SUTIL en el render — la pieza seleccionada sube apenas de brillo
  // (emissive) en el 3D y en las vistas orto; nada de halos gruesos. Se materializa
  // igual que el clipping: un CLON del material base con emissive, cacheado en el
  // mesh (userData.matSel). `matActivo` es lo que _clipLocalPorVista usa como base,
  // así el realce compone con el corte sin combinatoria de clones.
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
          if (ms.emissive) ms.emissive = new THREE.Color(base.color).multiplyScalar(0.45);
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
  var COL2D = { CBS: '#1565c0', CBI: '#00897b', ES: '#e65100', TRV: '#7b1fa2', LT: '#607d8b' };
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
    // El eje sobre el que se REPARTE depende del ROL y de la CARA:
    //   · estribo/traba          → a lo largo (x);
    //   · cabezal sup/inf        → corre en x y se apila hacia el núcleo en Y, así
    //     que el reparto de la capa va A LO ANCHO (z);
    //   · cabezal LATERAL        → ancla a la CORTINA Z (las capas entran en Z hacia
    //     el núcleo), así que el reparto de la capa va EN ALTURA (y). Repartirlo en
    //     z lo apilaría contra su propia dirección de capas.
    // Sobre ese eje BASE se aplica la permutación de la orientación de la pieza
    // (acostada = identidad · volteada = x↔z · de pie = x↔y).
    if (c && _rolDe(c.tipologia) === 'cabezal') {
      var base = (c.cara === 'lateral') ? 'y' : 'z';
      return _permOrientacion(c)[base] || base;
    }
    var reglas = global.ModeladorReglas;
    if (reglas && reglas.ejeDistribucion) return reglas.ejeDistribucion(c);
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
  // que representa → cara colocable (sup/inf = eje Y; lateral = eje Z). Las
  // aristas del eje X (extremos del elemento) NO son caras de anclaje en el MVP.
  // ==========================================================================
  // eje del mundo + signo → cara colocable (o null si no aplica al MVP viga).
  function _caraDeEje(eje, sign) {
    if (eje === 'y') return sign > 0 ? 'sup' : 'inf';
    if (eje === 'z') return 'lateral';
    return null;   // eje 'x' = extremos del elemento (no se ancla ahí por ahora)
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
  // umbral en cm. Solo caras colocables (cara != null). null si ninguna cerca.
  function _caraCercana(plano, uv) {
    if (!uv) return null;
    var faces = _facesDeVista(plano);
    var umbral = 9;   // cm — banda de captura de la cara (generosa, como el snap)
    var best = null, bestD = umbral;
    faces.forEach(function (f) {
      if (!f.cara) return;                 // aristas no-colocables (extremos X)
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
    var pls;
    try {
      pls = d.reglas.expandirComponente(
        _compDesdeClick(plano, _clickHost(plano, uv), ST.cargado), _hostDeReceta());
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
    return mejor;
  }

  // FORMA del ghost para un plano → { tipo:'poly'|'rect'|'line'|'point', pts:[{u,v}],
  // cerrar:bool } o null. Primero la barra REAL (_ghostPlacement) proyectada al
  // plano; si no hay, el esquema básico de siempre (_ghostFormaBasica).
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
    if (def && _rolDe(pl.tipologia) === 'cabezal' && _ejeMayorSpan(raw) === def.depth) {
      var q0 = proy(raw[0]), mejorDelta = -1;
      for (var si = 1; si < raw.length; si++) {
        var dd = Math.abs((raw[si][def.depth] || 0) - (raw[si - 1][def.depth] || 0));
        if (dd > mejorDelta) { mejorDelta = dd; q0 = proy(raw[si]); }
      }
      if (isFinite(q0.u) && isFinite(q0.v)) return { tipo: 'point', pts: [{ u: q0.u, v: q0.v }] };
    }

    var pts = [];
    for (var i = 0; i < raw.length; i++) {
      var q = proy(raw[i]);
      if (isFinite(q.u) && isFinite(q.v)) pts.push({ u: q.u, v: q.v });
    }
    if (pts.length < 2) return _ghostFormaBasica(plano, uv);
    // Una figura CERRADA (marco de estribo, o cualquier polilínea que vuelva a su
    // origen) no tiene extremos libres: se cierra el path y no se le ponen puntas.
    var a = pts[0], b = pts[pts.length - 1];
    return {
      tipo: 'poly', pts: pts,
      cerrar: (Math.abs(a.u - b.u) < GHOST_PT_TOL && Math.abs(a.v - b.v) < GHOST_PT_TOL)
    };
  }

  // FALLBACK — esquema geométrico del ghost cuando la barra REAL no se puede
  // calcular (motor no cargado todavía, o figura que el motor no dibuja). No es la
  // forma de la figura: es el RECINTO que va a ocupar (estribo = marco al
  // recubrimiento; cabezal = punto en sección / línea a lo largo). Ancla en (u,v)
  // del cursor los ejes libres; el resto sale del hormigón.
  function _ghostFormaBasica(plano, uv) {
    var geo = ST.receta && ST.receta.geometria; if (!geo) return null;
    var rol = _rolDe(ST.cargado.tipologia);
    var b = boundaryDeVista(geo, plano, (_defsPlanos() || {})[plano]);
    if (!b) return null;
    var rect = _rectPlano(geo, plano);          // W/H exteriores + iW/iH útiles (recub)
    var iW = rect.iW > 0 ? rect.iW : rect.W, iH = rect.iH > 0 ? rect.iH : rect.H;
    var contorno = (ST.cargado.contorno !== false);

    if (rol === 'estribo' || rol === 'traba') {
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
    if (!_hayCargado()) { ST.ghost = null; ST.caraHi = null; return; }
    var uvRaw = _pixelToUV(plano, sp.px, sp.py);
    if (!uvRaw) { ST.ghost = null; ST.caraHi = null; return; }

    // SNAP DE CARA — al acercarse a una cara del hormigón, esa cara se RESALTA y el
    // ghost se PEGA a ella (el usuario ve a qué cara va antes de clicar). Solo con la
    // herramienta Colocar; con Rango el rango se define libre dentro del contorno.
    var f = (ST.tool === 'colocar') ? _caraCercana(plano, uvRaw) : null;
    ST.caraHi = f ? { plano: plano, cara: f.cara, edge: f.edge, orient: f.orient, pos: f.pos, a: f.a, b: f.b } : null;

    var dentro = _dentroDelBoundary(plano, uvRaw);
    // Fuera del hormigón: pegar la forma al borde válido (clamp) y pintar en rojo.
    var uv = dentro ? uvRaw : _clampAlBoundary(plano, uvRaw);
    // Si hay cara resaltada (y estamos dentro), pegar el eje libre a la cara.
    if (f && dentro) uv = _snapUvACara(uv, f);
    ST.ghost = { plano: plano, uv: uv, valido: dentro };

    var vista = svg.closest ? svg.closest('.te-vista') : null;
    if (vista) vista.classList.toggle('te-ghost-block', !dentro);

    var color = dentro ? _colDe(ST.cargado.tipologia) : '#d32f2f';
    // resaltado de la cara (bajo el trazo del ghost).
    if (f && dentro) _dibujarCaraHiEnCapa(layer, plano, f, _colDe(ST.cargado.tipologia));
    var forma = _ghostForma(plano, uv);
    if (!forma) return;

    // Trazar la forma en pixeles.
    if (forma.tipo === 'point') {
      var pp = _uvToPixel(plano, forma.pts[0].u, forma.pts[0].v); if (!pp) return;
      layer.appendChild(_svgEl('circle', { cx: pp.px.toFixed(1), cy: pp.py.toFixed(1), r: 3.4, fill: color, 'class': 'te-ghostpt', opacity: dentro ? 0.85 : 0.9 }));
    } else {
      var d = forma.pts.map(function (q, i) { var p = _uvToPixel(plano, q.u, q.v); return (i ? 'L' : 'M') + p.px.toFixed(1) + ',' + p.py.toFixed(1); }).join(' ');
      if (forma.cerrar) d += ' Z';
      layer.appendChild(_svgEl('path', { 'class': 'te-ghostbar', d: d, stroke: color }));
      // Puntas en los extremos (circulitos .te-gpt, como la maqueta). Marca los
      // EXTREMOS LIBRES de la barra: una forma CERRADA (marco de estribo, o una
      // polilínea real que vuelve a su origen) no tiene extremos que marcar.
      var ends = (!forma.cerrar && forma.pts.length > 1)
        ? [forma.pts[0], forma.pts[forma.pts.length - 1]] : [];
      ends.forEach(function (q) { var p = _uvToPixel(plano, q.u, q.v); layer.appendChild(_svgEl('circle', { cx: p.px.toFixed(1), cy: p.py.toFixed(1), r: 3, 'class': 'te-gpt', fill: color })); });
    }

    // BADGE de texto "CBS ø16" pegado al cursor (fondo + texto), desplazado para no
    // quedar bajo el puntero.
    _dibujarGhostBadge(layer, sp.px, sp.py, ST.cargado.tipologia + ' ø' + ST.cargado.diam, color, sp.VW, sp.VH, dentro);
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
      var color = _colDe(pl.tipologia);
      var rol = _rolDe(pl.tipologia);
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
    // 3D (emissive) y el contorno fino .te-bar-halo. Estilo CAD, nada de halos.
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
      }
    }

    // Cotas (básico): extensión del hormigón en U y V.
    if (ST.cotas && rect) _dibujarCotas(svg, rect, t.s, X, Y, plano);

    // Flecha de RANGO del componente seleccionado (real si la distribución está
    // activa; "inactiva" en gris si todavía no lo está — arrastrarla la activa).
    _dibujarFlechaRango(svg, plano, X, Y, VW, VH);

    // NODOS de esquina (arrastrables).
    if (rect) _dibujarNodos(svg, rect, X, Y, plano);
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
    var eje = _ejeDistDe(c);
    if (eje !== def.u && eje !== def.v) return;   // eje de reparto no visible en esta vista
    var activa = !!d.activa;
    // Las ZONAS de la semilla (confinamiento) se editan por campos, no con la flecha.
    if (activa && !d.rango && d.zonas && d.zonas.length) return;
    var rango = activa ? d.rango : _rangoDefault(d.sep, eje);   // preview: NO se escribe
    if (!rango || rango.from == null || rango.to == null) return;
    var g = _svgEl('g', activa ? {} : { opacity: 0.35, 'data-rango-preview': '1' });
    svg.appendChild(g);
    svg = g;   // todo lo que sigue cuelga del grupo (así la opacidad aplica a la flecha entera)
    var attrs = { 'class': 'te-rango-hit', 'data-rango': ST.selCi, 'data-rango-eje': eje };
    // handle cuadradito en cada EXTREMO (achica/agranda ESE extremo); el tramo del
    // medio desplaza el rango completo.
    function handle(cx, cy, cual, cursor) {
      svg.appendChild(_svgEl('rect', {
        'class': 'te-rango-end', x: cx - 3.5, y: cy - 3.5, width: 7, height: 7,
        'data-rango': ST.selCi, 'data-rango-end': cual, 'data-rango-eje': eje,
        style: 'cursor:' + cursor
      }));
    }
    if (eje === def.u) {
      var xa = X(rango.from), xb = X(rango.to), yy = TE_RANGO_OFF_V;
      svg.appendChild(_svgEl('line', { 'class': 'te-rango-line', x1: xa, y1: yy, x2: xb, y2: yy }));
      svg.appendChild(_svgEl('path', { 'class': 'te-rango-arrow', d: 'M' + (xa + 7) + ',' + (yy - 4) + ' L' + xa + ',' + yy + ' L' + (xa + 7) + ',' + (yy + 4) }));
      svg.appendChild(_svgEl('path', { 'class': 'te-rango-arrow', d: 'M' + (xb - 7) + ',' + (yy - 4) + ' L' + xb + ',' + yy + ' L' + (xb - 7) + ',' + (yy + 4) }));
      attrs.x = Math.min(xa, xb) + 5; attrs.y = yy - 7;
      attrs.width = Math.max(4, Math.abs(xb - xa) - 10); attrs.height = 14;
      attrs.style = 'cursor:move';
      svg.appendChild(_svgEl('rect', attrs));
      handle(xa, yy, 'from', 'ew-resize'); handle(xb, yy, 'to', 'ew-resize');
      if (activa) _dibujarTramosRango(svg, d, rango, true, X, yy, plano);
    } else {
      // el eje de reparto es el VERTICAL de esta vista → flecha ↕ pegada al margen izq.
      var ya = Y(rango.from), yb = Y(rango.to), xx = TE_RANGO_OFF_H;
      svg.appendChild(_svgEl('line', { 'class': 'te-rango-line', x1: xx, y1: ya, x2: xx, y2: yb }));
      svg.appendChild(_svgEl('path', { 'class': 'te-rango-arrow', d: 'M' + (xx - 4) + ',' + (ya + 7) + ' L' + xx + ',' + ya + ' L' + (xx + 4) + ',' + (ya + 7) }));
      svg.appendChild(_svgEl('path', { 'class': 'te-rango-arrow', d: 'M' + (xx - 4) + ',' + (yb - 7) + ' L' + xx + ',' + yb + ' L' + (xx + 4) + ',' + (yb - 7) }));
      attrs.x = xx - 7; attrs.y = Math.min(ya, yb) + 5;
      attrs.width = 14; attrs.height = Math.max(4, Math.abs(yb - ya) - 10);
      attrs.style = 'cursor:move';
      svg.appendChild(_svgEl('rect', attrs));
      handle(xx, ya, 'from', 'ns-resize'); handle(xx, yb, 'to', 'ns-resize');
      if (activa) _dibujarTramosRango(svg, d, rango, false, Y, xx, plano);
    }
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
    inp.title = 'Espaciamiento del tramo ' + (idx + 1) + ' (cm)';
    inp.style.left = Math.max(2, Math.round(evt.clientX - rv.left - 24)) + 'px';
    inp.style.top = Math.max(2, Math.round(evt.clientY - rv.top - 9)) + 'px';
    var cerrado = false;
    function cerrar(guardar) {
      if (cerrado) return; cerrado = true;
      var v = Number(inp.value);
      _cerrarEditorAt();
      if (!guardar || !isFinite(v) || v <= 0) return;
      var a = _tramosDe(d);
      if (!a[idx] || a[idx].sep === v) return;
      _pushUndo();
      a[idx].sep = v;
      _setTramos(d, a);
      _regenerar(); _renderPanel();
    }
    inp.addEventListener('keydown', function (e) {
      e.stopPropagation();                       // Supr/Esc del editor no borran la barra
      if (e.key === 'Enter') { e.preventDefault(); cerrar(true); }
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
  function _dibujarNodos(svg, rect, X, Y, plano) {
    var corners = [
      { u: -rect.W / 2, v: rect.H / 2, c: 'tl' },
      { u: rect.W / 2, v: rect.H / 2, c: 'tr' },
      { u: rect.W / 2, v: -rect.H / 2, c: 'br' },
      { u: -rect.W / 2, v: -rect.H / 2, c: 'bl' }
    ];
    corners.forEach(function (k) {
      svg.appendChild(_svgEl('circle', {
        'class': 'te-node', cx: X(k.u), cy: Y(k.v), r: 3.5,
        'data-node': k.c, 'data-plano': plano
      }));
    });
  }

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

  // Snap de un valor host al grid o a las caras del hormigón (si snap activo).
  function _snapValor(val, faces) {
    if (!ST.snap) return val;
    var best = val, bestD = 6;   // umbral de snap en cm
    (faces || []).forEach(function (f) { var dd = Math.abs(val - f); if (dd < bestD) { bestD = dd; best = f; } });
    // grilla
    var g = Math.round(val / GRID_SNAP) * GRID_SNAP;
    if (Math.abs(val - g) < bestD) best = g;
    return best;
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
    var rol = _rolDe(sel.tipologia);
    // CARA por SNAP DE CARA (elegida VIENDO): si hay una cara resaltada bajo el
    // cursor en esta vista, esa manda. Reemplaza la adivinación host.y>=0.
    var cara;
    if (ST.caraHi && ST.caraHi.plano === plano && ST.caraHi.cara) {
      cara = ST.caraHi.cara;
    } else {
      cara = _caraDefault(sel.tipologia);
      // El fallback por altura del click SOLO aplica a tipologías cuya cara
      // default es sup/inf (CBS/CBI de viga). Antes PISABA la cara 'lateral' de
      // las mallas de muro (MH/MV): colocadas en la elevación caían a sup/inf y
      // el reparto se iba al ESPESOR (±7 cm → 2 barras) en vez de la ALTURA
      // (hallazgo del verificador de la Tanda F).
      if (rol === 'cabezal' && cara !== 'lateral' && (plano === 'seccion' || plano === 'largo')) {
        cara = (host.y >= 0) ? 'sup' : 'inf';   // fallback si el cursor no tocó una cara
      }
    }
    var meta = _metaModular(sel.tipologia);
    var comp = {
      tipologia: sel.tipologia, figura: sel.figura, diam: Number(sel.diam), suf_tipo: '',
      cara: cara, recub_override: null,
      angulos: _figSpec(sel.figura).angulos.slice(),
      modo: meta.modo, plano_pieza: meta.plano_pieza, arreglo: meta.arreglo,
      dims: _dimsDefault(sel.figura, rol, sel.contorno),
      distribucion: _distDefault(rol),
      // LADO de la cara CORTINA (z+ / z−). Lo elige el CLIC (dónde puso la barra el
      // usuario), no el arrastre posterior: pos_hint es traslación pura. Sólo
      // significa algo con cara 'lateral'; en las demás queda en su default (1).
      lado: (cara === 'lateral' && Number(host.z) < 0) ? -1 : 1
    };
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
      // _distDefault(rol) ya devuelve la forma lineal para estribo/traba (esta
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
    comp.pos_hint = _posHintDeClick(plano, host, rol, cara);
    return comp;
  }

  function _colocarEnVista(plano, host) {
    // GATE DE FIGURA: el clic coloca por ST.tool, no por ST.cargado, así que la
    // última palabra la tiene el catálogo. Una figura inexistente o no dibujable NO
    // nace: antes se colaba como "recta" con parciales inventados y kg = 0.
    var errFig = _figError(ST.figura);
    if (errFig) { _actualizarStatus(errFig); return; }
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
  function _posHintDeClick(plano, host, rol, cara) {
    var ph = {};
    if (rol === 'estribo' || rol === 'traba') {
      // el estribo se dibuja a una X; el click en largo/planta define esa X.
      if (plano === 'largo' || plano === 'planta') ph.x = host.x;
      if (rol === 'traba' && (plano === 'seccion' || plano === 'planta')) ph.z = host.z;
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
  function rotarPlanoPieza(comp, ori) {
    if (!comp) return;
    _setOrientacion(comp, ori || _orientacionSiguiente(_orientacionDe(comp)));
    var d = comp.distribucion;
    if (d) {
      var ejeN = _ejeDistDe(comp);   // eje de reparto YA con la orientación nueva
      if (d.rango) d.rango = _rangoDefault(d.rango.sep || d.sep || 20, ejeN);
      _reencuadrarZonas(d, ejeN);
    }
    _regenerar();          // el motor re-expande con los ejes permutados
    _renderPanel();
    _posicionarFlipBtn();  // el overlay sigue pegado a la pieza tras reproyectar
    _actualizarStatus();
  }

  // Cambiar la orientación de la pieza SELECCIONADA (lo llaman la tecla 'R' y el
  // botón contextual que flota sobre la barra seleccionada). Snapshot para Ctrl+Z.
  function _voltearSeleccion() {
    if (ST.selCi < 0 || !ST.receta) return;
    _pushUndo();
    rotarPlanoPieza(ST.receta.componentes[ST.selCi]);
  }

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
    _pintarFlipBtn(btn, _compOrientacion(ST.selCi));
  }

  // Icono / tooltip / clase del botón según la ORIENTACIÓN actual de la pieza. El
  // botón CICLA (acostada → volteada → de pie → acostada), así que muestra el estado
  // presente y anuncia el siguiente.
  // Notación de obra, legible a 30 px: ↔ corre a lo largo (acostada) · ⊗ corre hacia
  // el fondo, se ve de canto (volteada) · ↕ corre en vertical (de pie).
  var _ORIENT_ICONO = { acostada: '↔', volteada: '⊗', de_pie: '↕' };
  function _pintarFlipBtn(btn, ori) {
    if (!btn) return;
    var sig = _orientacionSiguiente(ori);
    btn.textContent = _ORIENT_ICONO[ori] || '🔄';
    var t = 'Orientación: ' + (_ORIENT_LABEL[ori] || ori) + ' — clic: ' + (_ORIENT_LABEL[sig] || sig) + ' (R)';
    btn.title = t;
    btn.setAttribute('aria-label', t);
    btn.setAttribute('data-ori', ori);
    btn.classList.toggle('flipped', ori === 'volteada');
    btn.classList.toggle('depie', ori === 'de_pie');
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
    var eje = EJE_ROT[plano] || 'x';
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
        if (ST.dragMove || ST.dragNode || ST.dragRango) return;
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
        ST.ultimoPlano = plano;
        var sp = _svgPoint(svg, evt); if (!sp) return;

        // ¿tocó un NODO?
        var tgtNode = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-node');
        if (tgtNode) { evt.preventDefault(); _pushUndo(); ST.dragNode = { plano: plano, corner: tgtNode }; return; }

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
            eje: evt.target.getAttribute('data-rango-eje') || null
          };
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
        var drag = ST.dragMove || ST.dragNode || ST.dragRango;
        if (!drag) return;
        var plano = drag.plano;
        var svg = $(SVG_ID[plano]); if (!svg) return;
        var sp = _svgPoint(svg, evt); if (!sp) return;
        var uv = _pixelToUV(plano, sp.px, sp.py);
        if (ST.dragMove && uv) { _dragMover(plano, uv); }
        else if (ST.dragNode) { _dragNodo(plano, uv, sp); }
        else if (ST.dragRango) { _dragRangoMove(plano, sp); }
      });
      global.addEventListener('mouseup', function () {
        if (ST.dragMove || ST.dragNode || ST.dragRango) { ST.dragMove = null; ST.dragNode = null; ST.dragRango = null; _renderPanel(); }
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
    var esCabezal = (_rolDe(c.tipologia) === 'cabezal');
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
    _regenerarDiferido();
  }

  function _dragNodo(plano, uv, sp) {
    if (!uv) return;
    var g = ST.receta.geometria;
    // El nodo redimensiona la dimensión del plano llevando la cara a |coord|·2.
    // seccion: U=ancho, V=alto · largo: U=largo, V=alto · planta: U=largo, V=ancho
    var newW = Math.max(GRID_SNAP, Math.round(Math.abs(uv.u) * 2 / GRID_SNAP) * GRID_SNAP);
    var newH = Math.max(GRID_SNAP, Math.round(Math.abs(uv.v) * 2 / GRID_SNAP) * GRID_SNAP);
    if (plano === 'seccion') { g.ancho = newW; g.alto = newH; }
    else if (plano === 'largo') { g.largo = newW; g.alto = newH; }
    else { g.largo = newW; g.ancho = newH; }
    _sincronizarRibbonGeo();   // los campos del ribbon siguen al arrastre
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
    var eje = _ejeDistDe(c);
    var dHost;
    if (eje === def.u) { dHost = (sp.px - dr.lastX) / t.ku; }
    else if (eje === def.v) { dHost = (sp.py - dr.lastY) / t.kv; }
    else return;
    dr.lastX = sp.px; dr.lastY = sp.py;
    if (!isFinite(dHost) || !dHost) return;
    var d = c.distribucion = c.distribucion || {};
    // PRIMER arrastre sobre la flecha "inactiva" (preview): ACTIVAR la distribución.
    // Ese es el único gesto que la enciende (ya no hay herramienta ↔ Rango de 2 clics).
    if (!d.activa) {
      if (d.sep == null) d.sep = (_rolDe(c.tipologia) === 'traba') ? 40 : 20;
      if (_modoDe(c) !== 'arreglo') { c.modo = 'lineal'; d.modo = 'linear'; }
      d.activa = true;
      d.rango = _rangoDefault(d.sep, eje);
      // La barra base ya no necesita pos_hint en ese eje (el rango la distribuye).
      if (c.pos_hint) delete c.pos_hint[eje];
      // el mouseup global ya re-renderiza el panel → la ficha muestra el modo nuevo
    }
    var rango = d.rango || _rangoDefault(d.sep, eje);
    if (dr.div != null) {
      // DIVISOR de tramo: mueve el límite entre dos tramos contiguos. Trabaja con la
      // coordenada ABSOLUTA bajo el cursor (no con el delta) para poder SNAPear a las
      // caras del eje igual que los handles.
      d.rango = rango;
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
      rango.from += dHost; rango.to += dHost;   // tramo del medio → desplaza
    }
    if (rango.eje == null) rango.eje = eje;
    d.rango = rango;
    _syncTramos(d);   // el rango cambió de largo → los tramos se reencajan dentro
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
    _actualizarStatus();
  }

  // ==========================================================================
  // LISTADO DE BARRAS (despiece) — sección colapsable al fondo del panel izquierdo.
  // Fuente: ST.ultimoOut.barras, que generar.js ya entrega AGRUPADO por
  // figura+φ+marca+suf+dims+ángulos (agruparBarras) con `cant` = nº de barras
  // idénticas y `_pesoEstimado` = kg del grupo. No se re-agrupa aquí: se pinta.
  // ==========================================================================
  function _bindBarras() {
    var t = $('te_barrasToggle');
    if (!t || t._teBound) return;
    t._teBound = true;
    t.addEventListener('click', function () {
      var box = $('te_barrasBox'); if (!box) return;
      var abierto = box.classList.toggle('open');
      t.setAttribute('aria-expanded', abierto ? 'true' : 'false');
      _renderBarras();   // la tabla se arma sólo cuando la sección está abierta
    });
  }

  function _renderBarras() {
    var box = $('te_barrasBox'); if (!box) return;
    var out = ST.ultimoOut;
    var barras = (out && out.barras) || [];
    var res = (out && out.resumen) || {};
    var cnt = $('te_barrasCount');
    if (cnt) cnt.textContent = '(' + (res.items || 0) + ' ítems · ' + _num(res.kg || 0) + ' kg)';
    var body = $('te_barrasBody'); if (!body) return;
    if (!box.classList.contains('open')) { body.innerHTML = ''; return; }
    if (!barras.length) { body.innerHTML = '<div class="te-note" style="margin:0">Todavía no hay barras.</div>'; return; }
    var filas = barras.map(function (b) {
      var dims = [];
      LETRAS.forEach(function (L) {
        var v = b['dim_' + L.toLowerCase()];
        if (v != null && isFinite(Number(v))) dims.push(L + ' ' + _num(Math.round(Number(v) * 10) / 10));
      });
      var marca = (b.marca || '—') + (b.suf_tipo ? ('·' + b.suf_tipo) : '');
      var cant = (Number(b.cant) || 0) * (Number(b.mult) || 1);
      var kg = (b._pesoEstimado != null) ? _num(Math.round(b._pesoEstimado * 10) / 10) : '—';
      return '<tr><td>' + _esc(marca) + '<br><span style="color:var(--te-muted)">' + _esc(b.figura || '') + '</span></td>' +
        '<td class="te-bnum">' + _esc(b.diam) + '</td>' +
        '<td>' + _esc(dims.join(' · ')) + '</td>' +
        '<td class="te-bnum">' + cant + '</td>' +
        '<td class="te-bnum">' + kg + '</td></tr>';
    }).join('');
    body.innerHTML = '<table class="te-btab"><thead><tr>' +
      '<th>Marca</th><th>φ mm</th><th>Dims (cm)</th><th>Cant</th><th>kg</th>' +
      '</tr></thead><tbody>' + filas + '</tbody></table>';
  }

  function _compEl(c, ci) {
    var rol = _rolDe(c.tipologia);
    var col = _colDe(c.tipologia);
    var sel = (ci === ST.selCi);
    var wrap = document.createElement('div');
    wrap.className = 'te-comp' + (sel ? ' open sel' : '');
    wrap.setAttribute('data-ci', ci);

    // Cabecera
    var ch = document.createElement('div'); ch.className = 'te-ch';
    ch.innerHTML =
      '<span class="te-drag" title="Arrastrar para reordenar">⠿</span>' +
      '<span class="te-sw" style="background:' + col + '"></span>' +
      '<div><div class="te-nm">' + _esc(c.tipologia) + ' · ' + _esc(c.figura) + '</div>' +
      '<div class="te-de">' + _esc(_compDesc(c)) + '</div></div>' +
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

  // Nivel de jerarquía por DEFECTO según el rol (mismo criterio que el motor):
  // estribo = 1 (nivel exterior), traba y cabezal = 2 (se apoyan por dentro).
  function _jerDefault(rol) { return (rol === 'estribo') ? 1 : 2; }

  // <select> de JERARQUÍA del componente (header). Escribe comp.jerarquia:
  //   'no'  → pegado al recubrimiento, NO participa de la jerarquía
  //   1..9  → nivel (1 = exterior; 2+ se apoyan por dentro del anterior).
  // No hay opción "auto": si el componente no trae el campo, se estampa el default
  // por rol al renderizar el panel, de modo que lo que se ve es lo que hay.
  function _selJerarquia(c, ci) {
    if (c.jerarquia == null) c.jerarquia = _jerDefault(_rolDe(c.tipologia));
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

    // Identidad
    var idRow = _div('te-grid3');
    idRow.appendChild(_fld('Figura', _figInputComp(c, ci)));
    idRow.appendChild(_fld('φ mm', _select(TE_DIAMS.map(String), String(c.diam), function (v) { c.diam = Number(v); _mut(ci); })));
    idRow.appendChild(_fld('Sufijo', _input({ value: c.suf_tipo || '', placeholder: 'sup / A…' }, function (v) { c.suf_tipo = v; _mut(ci, true); })));
    body.appendChild(idRow);

    // La figura GUARDADA puede no estar en el catálogo (receta vieja, figura dada de
    // baja): se dice en la ficha, porque esa barra no se dibuja ni pesa.
    var errFig = _figError(c.figura);
    if (errFig) {
      var nErr = _div('te-note');
      nErr.style.color = '#c62828';
      nErr.textContent = '⚠ ' + errFig + ' — esta barra no se dibuja ni pesa hasta corregirla.';
      body.appendChild(nErr);
    }

    // Cara / anclaje (radial)
    var caraRow = _div('te-row');
    caraRow.appendChild(_label('Cara / anclaje'));
    caraRow.appendChild(_radial([['sup', 'Superior'], ['inf', 'Inferior'], ['lateral', 'Lateral']], c.cara, function (v) { c.cara = v; _mut(ci, true); }));
    body.appendChild(caraRow);

    // LADO de la cara CORTINA — sólo para un LONGITUDINAL lateral (estribo/traba
    // encuadran el núcleo entero: no tienen lado que elegir). Escribe comp.lado
    // (1 | −1), que es lo ÚNICO que el motor mira para anclar la cortina; el
    // arrastre (pos_hint) ya no cambia de cara.
    if (rol === 'cabezal' && c.cara === 'lateral') {
      if (c.lado !== 1 && c.lado !== -1) c.lado = 1;
      var ladoRow = _div('te-row');
      ladoRow.appendChild(_label('Lado'));
      var ladoSeg = _radial([['1', '+Z'], ['-1', '−Z']], String(c.lado), function (v) {
        _pushUndo();
        c.lado = (Number(v) < 0) ? -1 : 1;
        _mut(ci, true);   // redibuja la ficha → el botón activo sigue al valor
      });
      ladoSeg.title = 'Cara cortina contra la que se apoya (+Z / −Z). El arrastre no la cambia.';
      ladoRow.appendChild(ladoSeg);
      body.appendChild(ladoRow);
    }

    // Recub override
    var recRow = _div('te-row');
    recRow.appendChild(_label('Recub. override'));
    recRow.appendChild(_input({ value: (c.recub_override != null ? c.recub_override : ''), placeholder: 'global cm' }, function (v) { c.recub_override = (v === '' ? null : Number(v)); _mut(ci); }));
    body.appendChild(recRow);

    // Rotación (ángulo exacto + botón 90°)
    var rotRow = _div('te-row');
    rotRow.appendChild(_label('Rotación °'));
    var rotWrap = _div('');
    rotWrap.style.display = 'flex'; rotWrap.style.gap = '6px'; rotWrap.style.alignItems = 'center';
    var rotInp = _input({ value: (c.orient && c.orient.deg) ? c.orient.deg : 0, type: 'number' }, function (v) {
      var eje = EJE_ROT[ST.ultimoPlano] || (c.orient && c.orient.eje) || 'x';
      c.orient = c.orient || {};
      c.orient.eje = eje; c.orient.deg = Number(v) || 0;   // conserva spin/pivot
      _mut(ci);
    });
    rotInp.style.width = '70px';
    var rot90 = document.createElement('button'); rot90.className = 'te-ctool'; rot90.textContent = '+90°'; rot90.style.padding = '3px 8px';
    rot90.addEventListener('click', function () { _rotarSeleccion(ST.ultimoPlano, 90); });
    rotWrap.appendChild(rotInp); rotWrap.appendChild(rot90);
    rotRow.appendChild(rotWrap);
    body.appendChild(rotRow);

    // PATAS — hacia dónde apuntan los ganchos. Es orient.spin (0/90/180/270): el motor
    // gira SÓLO las patas alrededor del eje longitudinal, la barra NO se mueve de su
    // sitio. Reemplaza la fila "Giro barra °" (número libre + botón +90°): un ángulo
    // en grados no describe nada que el usuario pueda ver, la dirección de la pata sí.
    // Sólo aparece si la figura TIENE patas y el rol no es estribo/traba (esos son
    // marcos cerrados: no hay dirección de pata que elegir).
    var patas = _patasDe(c);
    if (rol !== 'estribo' && rol !== 'traba' && (patas.inicio || patas.fin)) {
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
    _filasEmpalme(body, c, ci, rol, patas);

    // Distribución
    body.appendChild(_distBox(c, ci, rol, d));

    // Dimensiones dinámicas de la figura (Fija/Auto por dim)
    c.dims = c.dims || {};
    spec.parciales.forEach(function (L) {
      body.appendChild(_dimRow(c, ci, L));
    });
    if (spec.angulos.length) {
      var angRow = _div('te-grid2');
      spec.angulos.forEach(function (a, i) {
        angRow.appendChild(_fld('α' + (i + 1) + ' (°)', _input({ value: (c.angulos && c.angulos[i] != null) ? c.angulos[i] : a, type: 'number' }, function (v) {
          c.angulos = c.angulos || spec.angulos.slice(); c.angulos[i] = Number(v); _mut(ci);
        })));
      });
      body.appendChild(angRow);
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
  function _figInputComp(c, ci) {
    var inp = _input({ value: c.figura || '', list: 'te_figs', placeholder: 'buscar figura…' }, function (v) {
      var k = _figKey(v);
      var err = _figError(k);
      if (err) { inp.classList.add('bad'); inp.title = err; _actualizarStatus(err); return; }
      inp.classList.remove('bad'); inp.title = _figTitle(k);
      _setFigura(ci, k);
    });
    inp.addEventListener('input', function () {
      var v = inp.value.trim();
      if (!v) { inp.classList.remove('bad'); inp.title = ''; return; }   // a medio tipear
      var err = _figError(v);
      inp.classList.toggle('bad', !!err);
      inp.title = err || _figTitle(v);
    });
    var err0 = _figError(c.figura);
    if (err0) { inp.classList.add('bad'); inp.title = err0; }
    else inp.title = _figTitle(c.figura);
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

  function _filasEmpalme(body, c, ci, rol, patas) {
    if (rol !== 'cabezal') return;                    // estribo/traba: marco cerrado
    var libres = [];
    if (!patas.inicio) libres.push(['inicio', 'Δ inicio cm']);
    if (!patas.fin) libres.push(['fin', 'Δ fin cm']);
    if (!libres.length) return;                       // los dos extremos rematan en pata
    var g = _div(libres.length > 1 ? 'te-grid2' : '');
    libres.forEach(function (p) {
      var cual = p[0];
      var wrap = _div(''); wrap.style.cssText = 'display:flex;gap:4px;align-items:center';
      var val = _empalmeDe(c)[cual];
      var inp = _input({ value: (val != null ? val : ''), placeholder: '0', type: 'number' }, function (v) {
        _setEmpalme(c, cual, (v === '' ? null : Number(v)));
        _mut(ci);
      });
      inp.style.width = '56px';
      wrap.appendChild(inp);
      [40, 60].forEach(function (n) {
        var b = document.createElement('button');
        b.className = 'te-ctool';
        b.style.cssText = 'padding:2px 6px;font-size:10px;font-weight:700';
        b.textContent = n + 'φ';
        b.title = n + ' diámetros · φ' + (c.diam || '?') + ' → ' + _nPhi(c, n) + ' cm';
        b.addEventListener('click', function () {
          _pushUndo();
          _setEmpalme(c, cual, _nPhi(c, n));
          _mut(ci, true);                             // el campo tiene que mostrar el valor nuevo
        });
        wrap.appendChild(b);
      });
      g.appendChild(_fld(p[1], wrap));
    });
    body.appendChild(g);
    var note = _div('te-note');
    note.textContent = 'Δ = prolongación del extremo libre (traslapo). Sólo se ofrece donde el tramo no remata en pata.';
    body.appendChild(note);
  }

  function _dimRow(c, ci, L) {
    var d = c.dims[L] || { modo: 'auto' };
    c.dims[L] = d;
    var row = _div('te-row');
    row.appendChild(_label(L));
    var wrap = _div(''); wrap.style.display = 'flex'; wrap.style.gap = '6px'; wrap.style.alignItems = 'center';
    var inp = _input({ value: (d.modo === 'fija' && d.valor != null) ? d.valor : '', placeholder: (d.modo === 'auto' ? 'auto' : ''), type: 'number' }, function (v) {
      d.modo = 'fija'; d.valor = Number(v); _mut(ci);
    });
    if (d.modo === 'auto') inp.disabled = true;
    var tog = document.createElement('button'); tog.className = 'te-ctool'; tog.style.padding = '3px 8px';
    tog.textContent = (d.modo === 'fija') ? 'Fija' : 'Auto';
    tog.addEventListener('click', function () {
      d.modo = (d.modo === 'fija') ? 'auto' : 'fija';
      if (d.modo === 'fija' && d.valor == null) d.valor = 0;
      _mut(ci); _renderPanel();
    });
    wrap.appendChild(inp); wrap.appendChild(tog);
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
  //   · ESTRIBO  → anidar es el DEFAULT (las capas interiores se achican hacia
  //                adentro). El check nace marcado; desmarcarlo escribe anidar=false.
  //   · CABEZAL/otros → el anidado es OPT-IN: el check nace desmarcado y sólo al
  //                marcarlo se escribe anidar=true (desmarcar borra el campo). La
  //                semántica actual NO alinea patas: achica B y desplaza la capa.
  // Aquí sólo se escribe el dato (distribucion.anidar); quien lo consume es el motor.
  function _filaAnidar(box, c, ci, rol, d) {
    if (!(Number(d.n_capas) > 1)) return;
    var esEstribo = (rol === 'estribo');
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
        zr.appendChild(_fld('@ sep cm', _input({ value: z.sep, type: 'number' }, function (v) { z.sep = Number(v) || 1; _mut(ci); })));
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
    if (!multi) g2.appendChild(_fld('@ sep cm', _input({ value: d.sep || 20, type: 'number' }, function (v) { d.sep = Number(v) || 20; if (d.rango) d.rango.sep = d.sep; _mut(ci); })));
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
    if (!multi) g2.appendChild(_fld('@ sep (rango) cm', _input({ value: d.sep || 20, type: 'number' }, function (v) { d.sep = Number(v) || 20; if (d.rango) d.rango.sep = d.sep; _mut(ci); })));
    g2.appendChild(_fld('Rango', _rangoEditor(c, d, ci)));
    box.appendChild(g2);
    _tramosEditor(box, d, ci);

    var g3 = _div('te-grid3');
    g3.appendChild(_fld('N° capas', _input({ value: d.n_capas || 2, type: 'number' }, function (v) { d.n_capas = Math.max(1, Number(v) || 1); _mut(ci); })));
    g3.appendChild(_fld('Sep. ejes cm', _input({ value: d.sep_capas != null ? d.sep_capas : 10, type: 'number' }, function (v) { d.sep_capas = Number(v) || 0; _mut(ci); }),
      'Separación entre ejes de capas (eje a eje)'));
    g3.appendChild(_fld('Prof. (capas)', _selectPairs([['x', 'largo'], ['y', 'alto'], ['z', 'ancho']], d.eje_capas || _ejeCapasDefault(), function (v) { d.eje_capas = v; _mut(ci); })));
    box.appendChild(g3);
    _filaAnidar(box, c, ci, rol, d);
    var note = _div('te-note'); note.textContent = 'Arreglo 2D = rango a lo largo × N capas separadas en profundidad. n_capas=1 equivale a la distribución lineal. El plano de trabajo activo sugiere la profundidad.';
    box.appendChild(note);
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
        row.appendChild(_fld('@ ' + (i + 1) + ' cm', _input({ value: t.sep, type: 'number' }, function (v) {
          _pushUndo();
          var a = _tramosDe(d); a[i].sep = Math.max(1, Number(v) || 1); _setTramos(d, a);
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
  function _rangoEditor(c, d, ci) {
    var wrap = _div(''); wrap.style.cssText = 'display:flex;gap:4px;align-items:center';
    if (!d.rango) { return _static('(arrastra la flecha de rango)'); }
    // Cambiar from/to reencaja los TRAMOS (si los hay) y sólo entonces redibuja la
    // ficha — si no, un re-render en cada campo le robaría el foco al usuario.
    function _setExtremo(k, v) {
      d.rango[k] = Number(v);
      var hayTramos = !!(d.rango.tramos && d.rango.tramos.length > 1);
      _syncTramos(d);
      _mut(ci, hayTramos);
    }
    var fi = _input({ value: Math.round(d.rango.from), type: 'number' }, function (v) { _setExtremo('from', v); });
    var ti = _input({ value: Math.round(d.rango.to), type: 'number' }, function (v) { _setExtremo('to', v); });
    fi.style.width = '52px'; ti.style.width = '52px';
    var sep = document.createElement('span'); sep.textContent = '→'; sep.style.cssText = 'color:var(--te-muted);font-size:11px';
    wrap.appendChild(fi); wrap.appendChild(sep); wrap.appendChild(ti);
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
    el.value = (attrs.value != null ? attrs.value : '');
    el.addEventListener('change', function () { onchange(el.value); });
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
    // Nada se carga con una figura que el catálogo no reconoce: sin esto el ghost
    // seguía al cursor y el clic paría una barra fantasma (kg = 0).
    var err = _figError(ST.figura);
    if (err) { ST.cargado = null; _limpiarGhost(); _actualizarStatus(err); return; }
    ST.cargado = { figura: ST.figura, tipologia: ST.tipologia, diam: Number(ST.diam), contorno: ST.contorno !== false };
    _actualizarStatus();
  }

  // Valida el campo Figura del RIBBON contra el catálogo: pinta el borde rojo, deja
  // el motivo en el tooltip y (con `conStatus`) en la barra de estado. Devuelve
  // true sólo si la figura sirve para colocar.
  function _validarFiguraRibbon(conStatus) {
    var el = $('te_ribFigura'); if (!el) return true;
    var v = el.value.trim();
    if (!v) { el.classList.remove('bad'); el.title = ''; return false; }
    var err = _figError(v);
    el.classList.toggle('bad', !!err);
    el.title = err || _figTitle(v);
    if (err && conStatus) _actualizarStatus(err);
    return !err;
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
      fig.addEventListener('input', function () { _validarFiguraRibbon(false); });
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
      var prev = Number(dia.value) || 16;
      dia.innerHTML = '';
      TE_DIAMS.forEach(function (d) {
        var op = document.createElement('option');
        op.value = String(d); op.textContent = String(d);
        if (d === prev) op.selected = true;
        dia.appendChild(op);
      });
      dia.addEventListener('change', function () { ST.diam = Number(dia.value) || 16; if (_hayCargado()) _sellarCargado(); else _actualizarStatus(); });
      ST.diam = Number(dia.value) || ST.diam;
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
    var cand = {
      largo: g.largo, alto: g.alto, ancho: g.ancho,
      recub_sup: (g.recub_sup != null ? g.recub_sup : 4),
      recub_inf: (g.recub_inf != null ? g.recub_inf : 4),
      recub_lat: (g.recub_lat != null ? g.recub_lat : 3)
    };
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
    _activarHerramienta('colocar');
    // Sin sello (figura que el catálogo no acepta) _sellarCargado ya dejó el motivo
    // en el status: no se pisa con el mensaje de "Colocando…".
    if (!ST.cargado) return;
    _actualizarStatus('Colocando ' + ST.tipologia + ' ' + ST.figura + ': clic en una vista · Esc o clic derecho para salir.');
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

    // Botón contextual "Voltear plano (R)" sobre la pieza seleccionada.
    var flip = $('te_flipBtn');
    if (flip && !flip._teBound) {
      flip._teBound = true;
      flip.addEventListener('click', function (e) { e.stopPropagation(); _voltearSeleccion(); });
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
    s.innerHTML = 'Herramienta: <b>' + _esc(ST.tool) + '</b> · figura <b>' + _esc(ST.figura) + '</b> · ' +
      '<b style="color:' + _colDe(ST.tipologia) + '">' + _esc(ST.tipologia) + '</b> ø' + _esc(ST.diam) +
      selTxt + avisoTxt;
  }

  // Teclado: Ctrl+Z deshace · ESPACIO rota 90° · R voltea el plano de la pieza ·
  // Supr/Backspace borra.
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
        if (ST.selCi >= 0) { e.preventDefault(); _rotarSeleccion(ST.ultimoPlano, 90); }
      } else if (e.key === 'r' || e.key === 'R') {
        // R → VOLTEAR PLANO DE LA PIEZA (§INTERACCIÓN-2.0). Ignorar combos con
        // modificadores (Ctrl+R recargar, etc.).
        if (!e.ctrlKey && !e.metaKey && !e.altKey && ST.selCi >= 0) {
          e.preventDefault(); _voltearSeleccion();
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
      ST.orto[plano] = { cam: cam, canvas: canvas, vista: vista, def: def, zoom: 1, panU: 0, panV: 0, corte: 0.5 };
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
    if (d === 'x') {
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
      // y/z: banda gruesa (semi-espesor completo). frac 0.5 → 0 (centro); pela una cara.
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
      e.preventDefault(); o.zoom *= (e.deltaY > 0 ? 0.9 : 1.1);
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
  // +X) da un coseno pobre y, con metalness 0.5, el círculo salía OSCURO ("apagado /
  // de otro color"). Esta luz extra se coloca en el EYE de la vista que se está
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
  // Cámara / órbita / loop / resize (3D) — sin cambios de comportamiento
  // ==========================================================================
  function _applyCam() {
    var THREE = global.THREE;
    var cx = ST.dist * Math.cos(ST.rotX) * Math.sin(ST.rotY);
    var cy = ST.dist * Math.sin(ST.rotX);
    var cz = ST.dist * Math.cos(ST.rotX) * Math.cos(ST.rotY);
    ST.camera.up.set(0, 1, 0);
    ST.camera.position.set(cx + ST.target.x, cy + ST.target.y, cz + ST.target.z);
    ST.camera.lookAt(ST.target);
    var right = new THREE.Vector3().setFromMatrixColumn(ST.camera.matrix, 0);
    var up = new THREE.Vector3().setFromMatrixColumn(ST.camera.matrix, 1);
    var shift = right.multiplyScalar(ST.panX).add(up.multiplyScalar(ST.panY));
    ST.camera.position.add(shift);
    ST.camera.lookAt(new THREE.Vector3().copy(ST.target).add(shift));
  }

  // BUG 4 — PAN del 3D rotaba en vez de panear. Rediseño del reparto de botones con un
  // ÚNICO estado 'mode' ('pan' | 'rot' | null) fijado en el mousedown, mutuamente
  // exclusivo (antes había 2 flags drag/panning que podían quedar mal). Reparto:
  //   · botón IZQUIERDO sin modificador            → ROTAR
  //   · botón MEDIO, botón DERECHO, o SHIFT/ALT/CTRL+izq → PAN
  // El mousedown captura el botón real (e.button) Y los modificadores del PROPIO evento
  // (no de un mousemove posterior, que podía llegar sin shift y caer a rotar). El middle
  // click además necesita preventDefault en 'mousedown' Y 'auxclick' para matar el
  // autoscroll del navegador (que se tragaba los mousemove y hacía que "no paneara").
  function _bindOrbita(cv) {
    var mode = null, lx = 0, ly = 0;
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });   // botón der = pan, no menú
    cv.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });   // mata autoscroll medio
    cv.addEventListener('mousedown', function (e) {
      lx = e.clientX; ly = e.clientY;
      // PAN si: botón medio (1) · botón derecho (2) · o izquierdo con shift/alt/ctrl.
      var quierePan = (e.button === 1 || e.button === 2 || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey);
      mode = quierePan ? 'pan' : (e.button === 0 ? 'rot' : null);
      if (mode) e.preventDefault();
    });
    global.addEventListener('mouseup', function () { mode = null; });
    global.addEventListener('mousemove', function (e) {
      if (!mode) return;
      var dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (mode === 'pan') {
        ST.panX -= dx * ST.dist * 0.0011; ST.panY += dy * ST.dist * 0.0011;
      } else {   // rot
        ST.rotY -= dx * 0.008; ST.rotX += dy * 0.008;
        ST.rotX = Math.max(-1.45, Math.min(1.45, ST.rotX));
      }
      _marcarSucio();   // PERF: la cámara 3D cambió → repintar
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault(); ST.dist *= (e.deltaY > 0 ? 1.1 : 0.9);
      ST.dist = Math.max(120, Math.min(6000, ST.dist));
      _marcarSucio();
    }, { passive: false });
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
  function _render3DQuad() {
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
    var THREE = global.THREE;
    if (!THREE || !ST.renderer || !ST.camera) return;
    var gz = _initGizmo3D(); if (!gz) return;
    var d3 = document.querySelector('#te_quad .te-vista.d3'); if (!d3) return;
    var r = d3.getBoundingClientRect();
    if (r.width < GIZMO_PX + 10 || r.height < GIZMO_PX + 10) return;
    var full = ST.renderer.domElement.getBoundingClientRect();
    var pad = 8;
    var x = (r.left - full.left) + pad;
    var y = full.height - ((r.top - full.top) + r.height) + pad;   // esquina INFERIOR
    // la cámara del gizmo copia la ORIENTACIÓN de la perspectiva (dirección desde el
    // target hacia la cámara), a distancia fija → mismo giro, tamaño constante.
    // Distancia 4.4 (no 3.4): con fov 42 el half-extent a 3.4 era ~1.30 y las letras
    // viven a 1.34·L → la Y/Z quedaban FUERA del frustum ("solo se ve la X").
    var dir = new THREE.Vector3().subVectors(ST.camera.position, ST.target).normalize();
    gz.cam.position.copy(dir.multiplyScalar(4.4));
    gz.cam.up.copy(ST.camera.up);
    gz.cam.lookAt(0, 0, 0);
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
    _bindRibbon();
    _bindHerramientas();
    _bindVistas();
    _bindTeclado();
    _bindWarnTamano();           // ✕ del banner anti-colapso
    _bindBarras();               // sección colapsable "📋 Barras" (despiece)
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
  //   cfg = { elemento, nombre, dims, receta?, templateId? } | undefined.
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
      if (cfg.receta) {
        // "Abrir": receta guardada (params del backend), clonada para no mutar la fuente.
        ST.receta = JSON.parse(JSON.stringify(cfg.receta));
      } else {
        // "Crear": SIEMPRE rectángulo de hormigón desde dims + componentes vacíos.
        var geo = {}, src = cfg.dims || {};
        for (var k in src) if (src.hasOwnProperty(k)) geo[k] = Number(src[k]);
        geo.contorno = null;
        ST.receta = { tipo: ST.elemento, geometria: geo, componentes: [] };
      }
      if (!ST.receta.tipo) ST.receta.tipo = ST.elemento;
      ST.selCi = -1; ST.ultimoOut = null;
      ST.dragMove = null; ST.dragNode = null; ST.dragRango = null;
    } else {
      // Ruta vieja: semilla (solo para tests / compatibilidad).
      if (!ST.receta && d.semilla) ST.receta = d.semilla.semillaViga();
      ST.elemento = (ST.receta && ST.receta.tipo) || 'viga';
      if (!ST.nombre) ST.nombre = 'Viga tipo Explora';
      if (ST.templateId === undefined) ST.templateId = null;
    }
    // Asegurar el flag de distribución en la semilla (estribo/traba ya distribuidos).
    (ST.receta.componentes || []).forEach(function (c) {
      var rol = _rolDe(c.tipologia);
      if (rol !== 'cabezal' && c.distribucion && c.distribucion.zonas && c.distribucion.activa == null) c.distribucion.activa = true;
    });
    // Dirty-tracking: baseline al abrir (después de la normalización, que muta).
    ST._recetaGuardada = JSON.stringify(ST.receta);
    bd.classList.add('on');
    _actualizarTitulos();
    _renderRibbonTips();
    _actualizarBtnGuardar();
    var se = $('te_saveErr'); if (se) se.textContent = '';
    _bindUI();
    // CATÁLOGO DE FIGURAS: pide el real (GET /figuras-catalogo) y refresca el
    // datalist + la validación del campo Figura. Es asíncrono: hasta que llegue
    // manda el espejo estático del módulo, y si la red falla se queda con él.
    _cargarCatalogoFiguras();
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
    global.requestAnimationFrame(function () { global.requestAnimationFrame(function () {
      _iniciar3dEnVivo();
    }); });
  };

  // Cierre SIN confirm (interno): esconde el modal y limpia estado transitorio.
  function _cerrarModal() {
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
  };

  global.templateEditorVerEn3D = function () { _iniciar3dEnVivo(); };

  // Cerrar con clic en el backdrop (fuera del modal)
  document.addEventListener('click', function (e) {
    var bd = $('te_backdrop');
    if (bd && e.target === bd) global.templateEditorCerrar();
  });
  // Escape (tarea 4): 1º sale del MODO COLOCACIÓN (mata el ghost, vuelve a
  // Seleccionar) · 2º cierra el modal.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var bd = $('te_backdrop');
    if (!bd || !bd.classList.contains('on')) return;
    if (ST.tool === 'colocar') { _salirModoColocacion(); return; }
    global.templateEditorCerrar();
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

  var TPL_COLORES = {
    // VIGA (conserva los existentes; n-capas = variante clara del mismo tono)
    CBS: '#1565c0', CBS2: '#42a5f5', CBSn: '#64b5f6',
    CBI: '#00897b', CBI2: '#26a69a', CBIn: '#4db6ac',
    ES: '#e65100', TRV: '#7b1fa2', LT: '#607d8b',
    // MURO (principales azul/teal · estribos naranja · trabas púrpura)
    MH: '#1565c0', MV: '#00897b', TR: '#7b1fa2', EC: '#e65100', TC: '#7b1fa2', CB: '#1565c0',
    // LOSA / FUNDACION (mallas inf azul/teal · sup variante clara · refuerzos índigo ·
    // soportes/reparticiones gris · trabas púrpura)
    Fi: '#1565c0', Fs: '#00897b', "F'i": '#42a5f5', "F's": '#26a69a',
    F: '#5e35b1', "F'": '#7e57c2', SP: '#607d8b', Rp: '#607d8b', TRL: '#7b1fa2',
    SPF: '#607d8b', TRF: '#7b1fa2',
    // COLUMNA
    CB2: '#42a5f5', CBn: '#64b5f6', TRC: '#7b1fa2', ESC: '#e65100'
  };

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
    MURO: {
      dims:   [{ k: 'largo', lbl: 'Largo', def: 400 }, { k: 'alto', lbl: 'Alto', def: 250 }, { k: 'ancho', lbl: 'Espesor', def: 20 }],
      recubs: [{ k: 'recub_lat', lbl: 'Caras', def: 2.5 },
               { k: 'recub_sup', ks: ['recub_sup', 'recub_inf'], lbl: 'Bordes', def: 3 }],
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
  function _actualizarTitulos() {
    var el = (ST.elemento || 'viga');
    var h1 = document.querySelector('#te_titlebar h1');
    if (h1) h1.textContent = 'Template Editor — ' + _capitalizar(el);
    var badge = $('te_elemBadge'); if (badge) badge.textContent = el.toUpperCase();
    var sub = $('te_subNombre'); if (sub) sub.textContent = ST.nombre || '(sin nombre)';
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
  }

  // ---- Dirty-tracking ----
  function _hayCambiosSinGuardar() {
    if (!ST.receta || ST._recetaGuardada == null) return false;
    try { return JSON.stringify(ST.receta) !== ST._recetaGuardada; } catch (e) { return false; }
  }

  // Texto/estado normal del botón Guardar. Si el template vino de "Abrir" (hay
  // templateId), el POST crea COPIA (el backend no tiene PUT) → "Guardar como nuevo".
  function _actualizarBtnGuardar() {
    var b = $('te_btnGuardar'); if (!b) return;
    b.disabled = false;
    b.textContent = (ST.templateId != null) ? '💾 Guardar como nuevo' : '💾 Guardar template';
  }

  // ---- GUARDAR: POST /templates {nombre, tipo, params, obra:null} ----
  // OJO: el campo del backend es "params" (NO "receta") — modelador.py:45-49.
  global.templateEditorGuardar = function () {
    var btn = $('te_btnGuardar');
    var err = $('te_saveErr'); if (err) err.textContent = '';
    if (!ST.receta || (btn && btn.disabled)) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    var body = {
      nombre: (ST.nombre || '').trim(),
      tipo: (ST.elemento || 'viga').toLowerCase(),
      params: ST.receta,
      obra: null
    };
    fetch(_tplUrl('/templates'), { method: 'POST', headers: _tplHeaders(true), body: JSON.stringify(body) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.detail || ('HTTP ' + res.status));
          return data;
        });
      })
      .then(function (data) {
        // El editor pasa a apuntar a la copia recién creada (guardados siguientes
        // también serán copias — no hay PUT, pendiente versionado real).
        if (data && data.id != null) ST.templateId = data.id;
        ST._recetaGuardada = JSON.stringify(ST.receta);
        if (btn) btn.textContent = '✓ Guardado';
        if (typeof global.tplCargarGuardados === 'function') global.tplCargarGuardados();
        setTimeout(function () { _actualizarBtnGuardar(); }, 1500);
      })
      .catch(function (e) {
        _actualizarBtnGuardar();
        if (err) err.textContent = 'No se pudo guardar: ' + ((e && e.message) || 'error de red');
      });
  };

  // ==========================================================================
  // PANTALLA PREVIA (vive en tabs/catalogo.html · #catSubTemplates). Estos globals
  // los llaman los onclick/oninput del HTML y switchCatSubTab (catalogo/index.js).
  // ==========================================================================
  var _tplElemSel = 'VIGA';   // elemento seleccionado (default: VIGA, único con máquina)

  // Dimensiones POR DEFECTO del elemento (cm). La grilla de dims salió del tab: se
  // aplican en silencio al crear y se editan DENTRO del modal (grupo HORMIGÓN del
  // ribbon).
  // Un campo puede escribir VARIAS claves de la geometría (d.ks: el "Recub bordes"
  // del muro = recub_sup + recub_inf). Sin ks, escribe la suya.
  function _tplDimsDefault(elem) {
    var spec = TPL_DIMS_POR_ELEMENTO[String(elem || '').toUpperCase()] || TPL_DIMS_POR_ELEMENTO.VIGA;
    var dims = {};
    spec.dims.concat(spec.recubs).forEach(function (d) {
      (d.ks || [d.k]).forEach(function (k) { dims[k] = d.def; });
    });
    return dims;
  }

  // Click en un botón de elemento. NUNCA borra el nombre escrito ni roba el foco.
  global.tplSeleccionarElemento = function (elem) {
    elem = String(elem || '').toUpperCase();
    if (!TPL_DIMS_POR_ELEMENTO[elem]) return;
    _tplElemSel = elem;
    var grid = $('tplElemGrid');
    if (grid) grid.querySelectorAll('button[data-elem]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-elem') === elem);
    });
    global.tplValidar();
  };

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
      elemento: _tplElemSel,
      nombre: (nom ? nom.value.trim() : ''),
      dims: _tplDimsDefault(_tplElemSel)
    });
  };

  function _tplFecha(iso) {
    var s = String(iso || '').slice(0, 10).split('-');
    return (s.length === 3) ? (s[2] + '-' + s[1] + '-' + s[0]) : (iso || '—');
  }

  function _tplPintarLista(templates) {
    var cont = $('tplGuardadosLista'); if (!cont) return;
    var cnt = $('tplGuardadosCount');
    if (cnt) cnt.textContent = templates.length + ' template' + (templates.length === 1 ? '' : 's');
    if (!templates.length) {
      cont.innerHTML = '<div class="muted">Aún no hay templates guardados. Crea el primero aquí arriba.</div>';
      return;
    }
    var th = 'style="padding:5px 6px; font-size:10.5px; text-transform:uppercase; text-align:left;" class="muted"';
    cont.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
      '<tr><th ' + th + '>Nombre</th><th ' + th + '>Tipo</th><th ' + th + '>Fecha</th><th ' + th + '>Creado por</th><th></th></tr>' +
      templates.map(function (t) {
        var tipo = String(t.tipo || '').toUpperCase();
        var col = TPL_ELEM_COLORES[tipo] || '#607d8b';
        return '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:4px 6px; font-weight:700;">' + _esc(t.nombre) + '</td>' +
          '<td style="padding:4px 6px;"><span style="font-size:10px; text-transform:uppercase; font-weight:700; color:#fff; background:' + col + '; border-radius:8px; padding:1px 7px;">' + _esc(tipo) + '</span></td>' +
          '<td style="padding:4px 6px;">' + _esc(_tplFecha(t.fecha)) + '</td>' +
          '<td style="padding:4px 6px;">' + _esc(t.creado_por || '—') + '</td>' +
          '<td style="padding:4px 6px; text-align:right;"><button data-id="' + t.id + '" onclick="tplAbrirTemplate(this.getAttribute(\'data-id\'))"' +
          ' style="border:1px solid #dbe1e8; background:#fff; border-radius:7px; font-size:11.5px; padding:4px 12px; cursor:pointer;">Abrir</button></td>' +
          '</tr>';
      }).join('') +
      '</table>';
  }

  // Al entrar al sub-tab (switchCatSubTab → aquí): estado del botón Crear + GET
  // /templates para la lista de guardados.
  global.tplCargarGuardados = function () {
    global.tplValidar();
    var cont = $('tplGuardadosLista'); if (!cont) return;
    cont.innerHTML = '<div class="muted">Cargando templates…</div>';
    fetch(_tplUrl('/templates'), { headers: _tplHeaders(false) })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) { _tplPintarLista((data && data.templates) || []); })
      .catch(function () {
        var cnt = $('tplGuardadosCount'); if (cnt) cnt.textContent = '';
        cont.innerHTML = '<div class="muted">No se pudieron cargar los templates. ' +
          '<a onclick=tplCargarGuardados() style="cursor:pointer; text-decoration:underline;">Reintentar</a></div>';
      });
  };

  // Click "Abrir" en la lista → GET /templates/{id} → abre el modal con la receta.
  global.tplAbrirTemplate = function (id) {
    fetch(_tplUrl('/templates/' + encodeURIComponent(id)), { headers: _tplHeaders(false) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.detail || ('HTTP ' + res.status));
          return data;
        });
      })
      .then(function (t) {
        global.templateEditorAbrir({
          elemento: String(t.tipo || 'viga').toUpperCase(),
          nombre: t.nombre || '',
          dims: (t.params && t.params.geometria) || null,
          receta: t.params,
          templateId: t.id
        });
      })
      .catch(function (e) {
        alert('No se pudo abrir el template: ' + ((e && e.message) || 'error de red'));
      });
  };

  // Exponer para tests / depuración.
  global.TemplateEditor = {
    _st: ST, _regenerar: function () { _regenerar(); },
    _colocarEnVista: _colocarEnVista, _rotarSeleccion: _rotarSeleccion,
    _borrarSeleccion: _borrarSeleccion,
    _entrarModoColocacion: _entrarModoColocacion, _salirModoColocacion: _salirModoColocacion,
    _rolDe: _rolDe,
    boundaryDeVista: boundaryDeVista, _rectPlano: _rectPlano,   // P2/base task2
    setPlanoActivo: _setPlanoActivo,                            // P3 — 'seccion'|'largo'|'planta'|null
    // INTERACCIÓN-2.0 · ghost + grosor + clamp + undo
    _pushUndo: _pushUndo, _undo: _undo,
    _dentroDelBoundary: _dentroDelBoundary, _clampAlBoundary: _clampAlBoundary,
    _sellarCargado: _sellarCargado, _soltarCargado: _soltarCargado,
    _ghostForma: _ghostForma,
    // Ghost con la FORMA REAL: la polilínea proyectada y el componente de preview
    // (el MISMO que crea el clic) — para poder comparar ghost ≡ barra colocada.
    _ghostPlacement: _ghostPlacement, _ghostFormaBasica: _ghostFormaBasica,
    _compDesdeClick: _compDesdeClick,
    // INTERACCIÓN-2.0 · orientación de la pieza + snap de cara
    rotarPlanoPieza: rotarPlanoPieza,                           // cicla (o fija) la orientación + regenera
    _compVolteado: _compVolteado, _compOrientacion: _compOrientacion,
    _orientacionDe: _orientacionDe, _orientacionSiguiente: _orientacionSiguiente,
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
    // ficha del componente (el panel de dims dinámico sale de los parciales del catálogo)
    _compBody: _compBody
  };

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
