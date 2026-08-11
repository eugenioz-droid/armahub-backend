// =============================================================================
// Template Editor — Colocador por proyecciones (sub-tab del Catálogo).
// Cablea el modal tabs/template_editor_modal.html (calca static/demo/colocador.html).
//
// Esta entrega convierte los 3 cuadrantes 2D de SOLO-VISUALIZACIÓN a un
// EDITOR INTERACTIVO (§DISCOVERY-INTERACCIÓN del programa):
//   - COLOCAR: figura+tipología del ribbon → clic en una vista 2D → nace un
//     componente anclado a la cara clicada (estribo "toma contorno"; barra con
//     lados se orienta según su figura). Se agrega a ST.receta.componentes y se
//     regenera (las 4 vistas + el 3D se actualizan).
//   - SELECCIONAR / MOVER / BORRAR: clic en una barra dibujada la selecciona
//     (halo + panel izq); arrastrar la mueve; Supr/botón la borra.
//   - ROTAR: ESPACIO (o herramienta Rotar) gira 90° en el plano de la vista;
//     campo de ángulo exacto en el panel; se muestra el ángulo al seleccionar.
//   - RANGO: herramienta Rango + 2 clics sobre el hormigón define la distribución
//     lineal @; flechita doble para desplazarla; check para activar distribución.
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
    rangoTmp: null,            // {ci, plano, from} mientras se definen los 2 clics
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
    warnNivel: null, warnDescartado: false
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

  // Espejo mínimo de parciales/ángulos del catálogo (mismas figuras que generar.js).
  var FIG = {
    '101A': { parciales: ['A'], angulos: [] },
    '102A': { parciales: ['A', 'B'], angulos: [] },
    '102B': { parciales: ['A', 'B'], angulos: [] },
    '103A': { parciales: ['A', 'B', 'C'], angulos: [] },
    '103B': { parciales: ['A', 'B', 'C'], angulos: [45, 45] },
    '103D': { parciales: ['A', 'B', 'C'], angulos: [45, 45] },
    '104D': { parciales: ['A', 'B', 'C', 'D'], angulos: [135, 135] },
    '106A': { parciales: ['A', 'B', 'C', 'D'], angulos: [135, 135] }
  };
  function _figSpec(fig) { return FIG[(fig || '').toUpperCase()] || { parciales: ['A'], angulos: [] }; }

  // Cara por defecto según tipología (para colocar).
  function _caraDefault(tip) {
    var t = (tip || '').toUpperCase();
    if (t === 'CBS' || t === 'CBS2' || t === 'CBSN') return 'sup';
    if (t === 'CBI' || t === 'CBI2' || t === 'CBIN') return 'inf';
    return 'lateral';   // ES/TRV/LT
  }

  // ¿el componente ci está VOLTEADO? (plano_pieza.volteado). Campo ADITIVO: si el
  // componente no lo trae, cuenta como false → proyección idéntica a la actual.
  // (§INTERACCIÓN-2.0 · ROTAR PLANO DE LA PIEZA)
  function _compVolteado(ci) {
    if (ci == null || ci < 0 || !ST.receta) return false;
    var c = ST.receta.componentes[ci];
    return !!(c && c.plano_pieza && c.plano_pieza.volteado);
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
    return {
      modo: _modoDefault(tip),
      plano_pieza: { volteado: false },
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

  // Rango por defecto (todo el largo útil) para modos que lo necesitan.
  function _rangoDefault(sep) {
    var g = ST.receta.geometria;
    return { from: -g.largo / 2 + 4, to: g.largo / 2 - 4, sep: sep || 20 };
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
    d.modo = MODO_A_DIST[modo];
    if (modo === 'puntual') {
      if (d.n_capas == null) d.n_capas = 1;
      if (d.barras_capa == null) d.barras_capa = 1;
      if (d.gap == null) d.gap = 4;
      if (d.sentido == null) d.sentido = 'nucleo';
      if (d.justify == null) d.justify = 'centrar';
    } else if (modo === 'lineal') {
      if (d.sep == null) d.sep = (rol === 'traba') ? 40 : 20;
      if (!d.rango) d.rango = _rangoDefault(d.sep);
      d.activa = true;
      if (c.pos_hint) delete c.pos_hint.x;   // el rango la distribuye
    } else { // arreglo
      if (d.sep == null) d.sep = (rol === 'traba') ? 40 : 20;
      if (!d.rango) d.rango = _rangoDefault(d.sep);
      if (d.n_capas == null) d.n_capas = 2;      // arreglo real ≥ 2 capas
      if (d.sep_capas == null) d.sep_capas = 10;
      if (d.eje_capas == null) d.eje_capas = _ejeCapasDefault();
      d.activa = true;
      if (c.pos_hint) delete c.pos_hint.x;
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
    ST.rangoTmp = null; ST.dragMove = null; ST.dragNode = null; ST.dragRango = null;
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
      // El CLON de material para el clipping por vista (B2) vive en userData, no
      // necesariamente asignado a .material en este instante → disponerlo aparte.
      var clip = n.userData && n.userData.matClip;
      if (clip && clip.dispose) { clip.dispose(); n.userData.matClip = null; }
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
      ST.barras3D.push(mesh);
      ST.world.add(mesh);
    });
    ST.dist = g.largo * 1.15 + 160;
    _redibujarPlanoActivo();   // P3 — re-agregar el resaltado tras vaciar el world
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
  var PLANOS_POR_ELEMENTO = {
    viga: {
      seccion: { u: 'z', v: 'y', depth: 'x', W: 'ancho', H: 'alto',  recub: { W: 'lat', H: 'supinf' } },
      largo:   { u: 'x', v: 'y', depth: 'z', W: 'largo', H: 'alto',  recub: { W: 'lat', H: 'supinf' } },
      planta:  { u: 'x', v: 'z', depth: 'y', W: 'largo', H: 'ancho', recub: { W: 'lat', H: 'lat' } }
    }
    // muro: { seccion: {...}, largo: {...}, planta: {...} },      // TODO P2: poblar
    // columna: { seccion: {...}, largo: {...}, planta: {...} }    // TODO P2: poblar
  };

  // Elemento activo (por ahora fijo 'viga'; muro/columna cambian solo esta clave).
  function _tipoElemento() {
    return (ST.receta && ST.receta.tipo) || ST.elemento || 'viga';
  }
  function _defsPlanos() {
    return PLANOS_POR_ELEMENTO[_tipoElemento()] || PLANOS_POR_ELEMENTO.viga;
  }

  // BUG 8 — TÍTULOS por EJE. El nombre semántico ('SECCIÓN'/'A LO LARGO'/'PLANTA') es
  // fijo por cuadrante, pero el EJE (YZ/XY/XZ) es universal y sale de PLANOS_POR_ELEMENTO
  // (u,v del plano). Así, cuando se pueble muro/columna, el título sigue al elemento sin
  // tocar el HTML. Se llama al abrir (y podría llamarse al cambiar de elemento).
  var _TITULO_SEMANTICO = { seccion: 'SECCIÓN', largo: 'A LO LARGO', planta: 'PLANTA' };
  // BUG 8b — el eje se etiqueta en ORDEN CANÓNICO X<Y<Z (no en el orden u,v del plano).
  // Antes se concatenaba u+v tal cual → SECCIÓN daba 'ZY' (u=z, v=y), sobrescribiendo el
  // 'YZ' del HTML. Ordenar los dos ejes del plano canónicamente da YZ/XY/XZ, que es cómo
  // se nombran los planos (y coincide con el HTML). No cambia qué eje es horizontal/vertical
  // en la vista (eso lo fija u,v); solo el TEXTO del título.
  var _EJE_ORDEN = { x: 0, y: 1, z: 2 };
  function _ejeCanonico(u, v) {
    var a = String(u || '').toLowerCase(), b = String(v || '').toLowerCase();
    if ((_EJE_ORDEN[b] != null ? _EJE_ORDEN[b] : 9) < (_EJE_ORDEN[a] != null ? _EJE_ORDEN[a] : 9)) {
      var t = a; a = b; b = t;
    }
    return (a + b).toUpperCase();
  }
  // Color estándar por eje (gizmo): X rojo, Y verde, Z azul.
  var _EJE_COLOR = { x: '#e53935', y: '#43a047', z: '#1e88e5' };
  var _EJE_NOMBRE = { x: 'largo', y: 'alto', z: 'ancho' };

  function _actualizarTitulosVista() {
    var defs = _defsPlanos() || {};
    ['seccion', 'largo', 'planta'].forEach(function (plano) {
      var def = defs[plano]; if (!def) return;
      var vista = document.querySelector('#te_quad .te-vista[data-plano="' + plano + '"]');
      if (!vista) return;
      var t = vista.querySelector('.te-vtitle');
      if (t) {
        var eje = _ejeCanonico(def.u, def.v);
        t.textContent = (_TITULO_SEMANTICO[plano] || plano.toUpperCase()) + ' · ' + eje;
      }
      // B4·(a) — GIZMO GRÁFICO de ejes (antes: 3 líneas de texto). Mini SVG con el
      // triad estándar de modelador. Las cámaras ortográficas NO rotan, así que este
      // gizmo es ESTÁTICO: se genera una vez por vista → cero costo por frame.
      var gz = vista.querySelector('.te-vgizmo');
      if (gz) {
        gz.innerHTML = _svgGizmoOrto(def);
        // el nombre semántico del eje queda en el tooltip (el dibujo lleva sólo la letra)
        gz.setAttribute('title',
          def.u.toUpperCase() + ' = ' + _EJE_NOMBRE[def.u] + ' (horizontal) · ' +
          def.v.toUpperCase() + ' = ' + _EJE_NOMBRE[def.v] + ' (vertical) · ' +
          def.depth.toUpperCase() + ' = ' + _EJE_NOMBRE[def.depth] + ' (hacia ti)');
      }
    });
  }

  // Mini SVG (46×46) del triad de ejes de una vista ortográfica:
  //   · flecha HORIZONTAL con la letra del eje u (horizontal de la vista);
  //   · flecha VERTICAL con la letra del eje v;
  //   · símbolo ⊙ (círculo con punto = "sale hacia ti") con la letra del eje depth.
  // Colores _EJE_COLOR (X rojo / Y verde / Z azul). El origen del triad va en la
  // esquina inf-izq del recuadro (7,39); las flechas miden 26 px.
  function _svgGizmoOrto(def) {
    var u = String(def.u || 'x'), v = String(def.v || 'y'), d = String(def.depth || 'z');
    var cu = _EJE_COLOR[u] || '#607d8b', cv = _EJE_COLOR[v] || '#607d8b', cd = _EJE_COLOR[d] || '#607d8b';
    var ox = 7, oy = 39, L = 26;          // origen del triad + largo de flecha
    function flecha(x1, y1, x2, y2, color) {
      // línea + cabeza triangular en (x2,y2), orientada por el vector
      var dx = x2 - x1, dy = y2 - y1, m = Math.hypot(dx, dy) || 1;
      var ux = dx / m, uy = dy / m, px = -uy, py = ux, h = 5, w = 3;
      var bx = x2 - ux * h, by = y2 - uy * h;
      var pts = x2 + ',' + y2 + ' ' + (bx + px * w) + ',' + (by + py * w) + ' ' + (bx - px * w) + ',' + (by - py * w);
      return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + bx + '" y2="' + by + '" stroke="' + color +
             '" stroke-width="1.8" stroke-linecap="round"/>' +
             '<polygon points="' + pts + '" fill="' + color + '"/>';
    }
    return '<svg viewBox="0 0 46 46" aria-hidden="true">' +
      // fondo tenue para que el triad se lea sobre cualquier render
      '<rect x="0" y="0" width="46" height="46" rx="6" fill="rgba(255,255,255,.72)"/>' +
      flecha(ox, oy, ox + L, oy, cu) +
      '<text class="te-gzt" x="' + (ox + L + 2) + '" y="' + (oy + 3.5) + '" fill="' + cu + '">' + u.toUpperCase() + '</text>' +
      flecha(ox, oy, ox, oy - L, cv) +
      '<text class="te-gzt" x="' + (ox - 4.5) + '" y="' + (oy - L - 3) + '" fill="' + cv + '">' + v.toUpperCase() + '</text>' +
      // eje de profundidad: ⊙ (círculo con punto) = apunta hacia el observador
      '<circle cx="' + (ox + 9) + '" cy="' + (oy - 9) + '" r="4.6" fill="none" stroke="' + cd + '" stroke-width="1.5"/>' +
      '<circle cx="' + (ox + 9) + '" cy="' + (oy - 9) + '" r="1.5" fill="' + cd + '"/>' +
      '<text class="te-gzt" x="' + (ox + 15) + '" y="' + (oy - 11) + '" fill="' + cd + '">' + d.toUpperCase() + '</text>' +
      '</svg>';
  }

  // Proyector genérico: dado el def de un plano → función punto3D → {u,v}.
  function _proyectorDe(def) {
    return function (p) { return { u: p[def.u], v: p[def.v] }; };
  }
  // Proyector "de canto" (pieza VOLTEADA, §INTERACCIÓN-2.0 / ROTAR PLANO DE LA
  // PIEZA): en vez del par (u,v) del plano, proyecta sobre (depth, v). Efecto en
  // la vista: una figura que se dibujaba "de frente" (rectángulo cerrado, p.ej.
  // estribo en SECCIÓN) COLAPSA a una línea a lo largo de su eje de profundidad
  // → se ve "de canto" (línea vertical + su rango). Es un cambio de PROYECCIÓN
  // (no toca la geometría 3D ni los kilos): el eje horizontal de la vista pasa a
  // ser el `depth` del plano, conservando la vertical `v`.
  function _proyectorVolteado(def) {
    return function (p) { return { u: p[def.depth], v: p[def.v] }; };
  }
  // Devuelve el proyector correcto para un placement según si el componente que lo
  // generó está volteado (meta.ci → ST.receta.componentes[ci].plano_pieza.volteado).
  function _proyPlacement(def, projNormal, projVolteado, pl) {
    var ci = (pl && pl.meta && pl.meta.ci != null) ? pl.meta.ci : -1;
    return (_compVolteado(ci)) ? projVolteado : projNormal;
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

  // (u,v) del plano → pixel del viewBox (inverso de _pixelToUV). Requiere transform.
  function _uvToPixel(plano, u, v) {
    var t = ST.transforms[plano];
    if (!t) return null;
    return { px: t.offX + (u - t.minU) * t.s, py: t.offY + (t.maxV - v) * t.s };
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

  // ¿Hay algo cargado para colocar? (ribbon con figura+tipología y herramienta de
  // colocación activa). Es el gate del ghost y del clic-para-colocar.
  function _hayCargado() {
    return !!ST.cargado && (ST.tool === 'colocar' || ST.tool === 'rango');
  }

  // Puntos (u,v en host) de la FORMA del ghost para un plano, dada la tipología
  // cargada. Devuelve { tipo:'rect'|'line'|'point', pts:[{u,v}], cerrar:bool } o null.
  // Calca la lógica con que se DIBUJAN las barras reales (estribo=recinto de recub;
  // cabezal=punto en sección / línea a lo largo). Ancla en (u,v) del cursor los
  // ejes libres; el resto sale del hormigón.
  function _ghostForma(plano, uv) {
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
      layer.appendChild(_svgEl('circle', { cx: pp.px.toFixed(1), cy: pp.py.toFixed(1), r: 4.6, fill: color, 'class': 'te-ghostpt', opacity: dentro ? 0.9 : 0.95 }));
    } else {
      var d = forma.pts.map(function (q, i) { var p = _uvToPixel(plano, q.u, q.v); return (i ? 'L' : 'M') + p.px.toFixed(1) + ',' + p.py.toFixed(1); }).join(' ');
      if (forma.cerrar) d += ' Z';
      layer.appendChild(_svgEl('path', { 'class': 'te-ghostbar', d: d, stroke: color }));
      // puntas en los extremos (como la maqueta: circulitos .te-gpt en los vértices)
      var ends = forma.tipo === 'line' ? [forma.pts[0], forma.pts[forma.pts.length - 1]] : [];
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

  // Dibuja UN cuadrante 2D. Guarda su transform para el hit-testing inverso.
  function _dibujarVista2D(svg, out, plano, geo) {
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var def = (_defsPlanos() || {})[plano];
    if (!def) { ST.transforms[plano] = null; return; }
    var proj = _proyectorDe(def);            // normal (u,v)
    var projV = _proyectorVolteado(def);     // "de canto" (depth,v) para piezas volteadas
    var placements = (out && out.placements) || [];

    // Bounding box en (u,v): hormigón + puntos proyectados (cada placement con el
    // proyector que le toca según su pieza esté o no volteada).
    var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    function acc(u, v) {
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    var rect = geo ? boundaryDeVista(geo, plano, def) : null;
    if (rect) { acc(-rect.W / 2, -rect.H / 2); acc(rect.W / 2, rect.H / 2); }
    placements.forEach(function (pl) {
      var pj = _proyPlacement(def, proj, projV, pl);
      (pl.puntos || []).forEach(function (pt) { var q = pj(pt); if (isFinite(q.u) && isFinite(q.v)) acc(q.u, q.v); });
    });
    if (!isFinite(minU) || !isFinite(minV)) { ST.transforms[plano] = null; return; }

    var vb = (svg.getAttribute('viewBox') || '0 0 620 300').split(/\s+/).map(Number);
    var VW = vb[2] || 620, VH = vb[3] || 300, MARGIN = 30;
    var spanU = Math.max(maxU - minU, 1e-6), spanV = Math.max(maxV - minV, 1e-6);
    var s = Math.min((VW - 2 * MARGIN) / spanU, (VH - 2 * MARGIN) / spanV);
    var offX = (VW - spanU * s) / 2, offY = (VH - spanV * s) / 2;
    function X(u) { return offX + (u - minU) * s; }
    function Y(v) { return offY + (maxV - v) * s; }   // invertir eje vertical

    // Persistir transform (para pixelToHost).
    ST.transforms[plano] = { minU: minU, maxU: maxU, minV: minV, maxV: maxV, s: s, offX: offX, offY: offY };

    // Hormigón + boundary de recubrimiento (en modo orto lo pinta el 3D; el SVG solo
    // conserva el boundary de recubrimiento punteado como guía de interacción).
    if (rect && !ST.ortoActivo) {
      svg.appendChild(_svgEl('rect', {
        'class': 'te-horm', rx: 2,
        x: X(-rect.W / 2), y: Y(rect.H / 2), width: rect.W * s, height: rect.H * s
      }));
      if (rect.iW > 0 && rect.iH > 0) {
        svg.appendChild(_svgEl('rect', {
          'class': 'te-recub',
          x: X(-rect.iW / 2), y: Y(rect.iH / 2), width: rect.iW * s, height: rect.iH * s
        }));
      }
    }

    // ETAPA A (render ortográfico): el 3D proyectado ya dibuja hormigón + barras con
    // la calidad del 3D. El SVG queda como OVERLAY transparente solo para la
    // interacción (ghost/handles/cotas). No re-dibujamos hormigón ni barras aquí.
    // (El transform ya quedó guardado arriba para el hit-testing.)
    if (ST.ortoActivo) return;

    // Barras proyectadas (halo de selección DEBAJO; luego la barra).
    placements.forEach(function (pl) {
      var color = _colDe(pl.tipologia);
      var rol = _rolDe(pl.tipologia);
      var ci = (pl.meta && pl.meta.ci != null) ? pl.meta.ci : -1;
      var sel = (ci === ST.selCi && ST.selCi >= 0);
      var volteado = _compVolteado(ci);
      var pj = volteado ? projV : proj;
      var pts = (pl.puntos || []).map(pj).filter(function (q) { return isFinite(q.u) && isFinite(q.v); });
      if (!pts.length) return;

      // Cabezal longitudinal en SECCIÓN → punto (círculo). Si está VOLTEADO se ve
      // "de canto" (línea a lo largo de X): NO se colapsa a punto → cae al trazo.
      if (plano === 'seccion' && rol === 'cabezal' && !volteado) {
        var q0 = pts[0];
        if (sel) svg.appendChild(_svgEl('circle', { cx: X(q0.u), cy: Y(q0.v), r: 6.5, 'class': 'te-bar-halo' }));
        // círculo visible (no interactivo) + hit generoso encima
        svg.appendChild(_svgEl('circle', { cx: X(q0.u), cy: Y(q0.v), r: 4.2, fill: color, style: 'pointer-events:none' }));
        svg.appendChild(_svgEl('circle', {
          cx: X(q0.u), cy: Y(q0.v), r: 7.5, fill: 'transparent',
          'data-ci': ci, 'data-hit': '1', style: 'cursor:pointer'
        }));
        return;
      }
      // Estribo en SECCIÓN: separar los 2 ganchos ½·diam para que no se superpongan.
      var dpts = pts;   // sin offset en-plano: el estribo cierra en la esquina (motor 3D)
      var d = dpts.map(function (q, i) { return (i ? 'L' : 'M') + X(q.u).toFixed(1) + ',' + Y(q.v).toFixed(1); }).join(' ');
      if (sel) svg.appendChild(_svgEl('path', { 'class': 'te-bar-halo', d: d }));
      // barra VISIBLE (técnica, fina, sin eventos)
      svg.appendChild(_svgEl('path', {
        'class': 'te-bar' + (sel ? ' sel' : ''), d: d, stroke: color, style: 'pointer-events:none',
        opacity: (rol === 'estribo' && plano === 'planta') ? 0.6 : 1
      }));
      // trazo de HIT transparente ancho (facilita el clic sobre la línea fina)
      svg.appendChild(_svgEl('path', {
        d: d, fill: 'none', stroke: 'transparent', 'stroke-width': 9, 'stroke-linecap': 'round',
        'data-ci': ci, 'data-hit': '1', style: 'cursor:pointer'
      }));
    });

    // Cotas (básico): extensión del hormigón en U y V.
    if (ST.cotas && rect) _dibujarCotas(svg, rect, s, X, Y, plano);

    // Ghost de rango en curso (1er clic puesto).
    if (ST.rangoTmp && ST.rangoTmp.plano === plano && ST.rangoTmp.from != null) {
      var xf = X(_proyU(plano, { x: ST.rangoTmp.from.x, y: ST.rangoTmp.from.y, z: ST.rangoTmp.from.z }));
      svg.appendChild(_svgEl('line', { 'class': 'te-rango-line', x1: xf, y1: 6, x2: xf, y2: VH - 6 }));
    }

    // Flechita doble de RANGO para el componente seleccionado con distribución activa.
    _dibujarFlechaRango(svg, plano, X, Y, VW, VH);

    // NODOS de esquina (arrastrables) — solo en vistas 2D.
    if (rect) _dibujarNodos(svg, rect, X, Y, plano);
  }

  function _proyU(plano, p) { return _proyDe(plano)(p).u; }

  function _dibujarCotas(svg, rect, s, X, Y, plano) {
    var y0 = Y(-rect.H / 2) + 14;
    // cota horizontal (ancho de la vista)
    svg.appendChild(_svgEl('line', { 'class': 'te-dimL', x1: X(-rect.W / 2), y1: y0, x2: X(rect.W / 2), y2: y0 }));
    svg.appendChild(_svgEl('line', { 'class': 'te-dimTick', x1: X(-rect.W / 2), y1: y0 - 3, x2: X(-rect.W / 2), y2: y0 + 3 }));
    svg.appendChild(_svgEl('line', { 'class': 'te-dimTick', x1: X(rect.W / 2), y1: y0 - 3, x2: X(rect.W / 2), y2: y0 + 3 }));
    var tW = _svgEl('text', { 'class': 'te-dim', x: X(0), y: y0 - 4, 'text-anchor': 'middle' });
    tW.textContent = Math.round(rect.W) + ' cm'; svg.appendChild(tW);
    // cota vertical (alto de la vista)
    var x0 = X(-rect.W / 2) - 12;
    svg.appendChild(_svgEl('line', { 'class': 'te-dimL', x1: x0, y1: Y(-rect.H / 2), x2: x0, y2: Y(rect.H / 2) }));
    var tH = _svgEl('text', { 'class': 'te-dim', x: x0 - 2, y: Y(0), 'text-anchor': 'middle', transform: 'rotate(-90 ' + (x0 - 2) + ' ' + Y(0) + ')' });
    tH.textContent = Math.round(rect.H) + ' cm'; svg.appendChild(tH);
  }

  // Flechita doble ↔ para desplazar la distribución del componente seleccionado.
  function _dibujarFlechaRango(svg, plano, X, Y, VW, VH) {
    if (ST.selCi < 0 || !ST.receta) return;
    var c = ST.receta.componentes[ST.selCi];
    if (!c || !c.distribucion || !c.distribucion.activa) return;
    // La flechita doble solo aplica al modelo por RANGO (2 clics). Las zonas de
    // la semilla se editan por campos, no con la flecha.
    var rango = c.distribucion.rango;
    if (!rango || rango.from == null) return;
    // La flecha vive en las vistas donde el eje X es horizontal (largo/planta).
    if (plano !== 'largo' && plano !== 'planta') return;
    var fromX = rango.from, toX = rango.to;
    var xa = X(fromX), xb = X(toX), yy = 18;
    svg.appendChild(_svgEl('line', { 'class': 'te-rango-line', x1: xa, y1: yy, x2: xb, y2: yy }));
    // dos puntas de flecha
    svg.appendChild(_svgEl('path', { 'class': 'te-rango-arrow', d: 'M' + (xa + 7) + ',' + (yy - 4) + ' L' + xa + ',' + yy + ' L' + (xa + 7) + ',' + (yy + 4) }));
    svg.appendChild(_svgEl('path', { 'class': 'te-rango-arrow', d: 'M' + (xb - 7) + ',' + (yy - 4) + ' L' + xb + ',' + yy + ' L' + (xb - 7) + ',' + (yy + 4) }));
    // zona de arrastre (mueve todo el rango)
    var hit = _svgEl('rect', { 'class': 'te-rango-hit', x: Math.min(xa, xb), y: yy - 8, width: Math.abs(xb - xa) || 4, height: 16, 'data-rango': ST.selCi });
    svg.appendChild(hit);
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
        'class': 'te-node', cx: X(k.u), cy: Y(k.v), r: 4.5,
        'data-node': k.c, 'data-plano': plano
      }));
    });
  }

  function _redibujar2D(out) {
    var geo = ST.receta && ST.receta.geometria;
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
    if (!t) return null;
    var u = t.minU + (px - t.offX) / t.s;
    var v = t.maxV - (py - t.offY) / t.s;
    return { u: u, v: v };
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
  function _colocarEnVista(plano, host) {
    _pushUndo();   // snapshot ANTES de mutar (tarea 1: _pushUndo antes de colocar)
    var rol = _rolDe(ST.tipologia);
    // CARA por SNAP DE CARA (elegida VIENDO): si hay una cara resaltada bajo el
    // cursor en esta vista, esa manda. Reemplaza la adivinación host.y>=0.
    var cara;
    if (ST.caraHi && ST.caraHi.plano === plano && ST.caraHi.cara) {
      cara = ST.caraHi.cara;
    } else {
      cara = _caraDefault(ST.tipologia);
      if (rol === 'cabezal' && (plano === 'seccion' || plano === 'largo')) {
        cara = (host.y >= 0) ? 'sup' : 'inf';   // fallback si el cursor no tocó una cara
      }
    }
    var meta = _metaModular(ST.tipologia);
    var comp = {
      tipologia: ST.tipologia, figura: ST.figura, diam: Number(ST.diam), suf_tipo: '',
      cara: cara, recub_override: null,
      angulos: _figSpec(ST.figura).angulos.slice(),
      modo: meta.modo, plano_pieza: meta.plano_pieza, arreglo: meta.arreglo,
      dims: _dimsDefault(ST.figura, rol, ST.contorno),
      distribucion: _distDefault(rol)
    };
    // pos_hint desde el click (los ejes que el plano define). El motor ancla por
    // cara y offset; el pos_hint corre la barra al punto clicado en los ejes libres.
    comp.pos_hint = _posHintDeClick(plano, host, rol, cara);
    ST.receta.componentes.push(comp);
    ST.selCi = ST.receta.componentes.length - 1;
    _regenerar();
    _renderPanel();
  }

  // pos_hint: qué ejes fija el click. Estribo (perimetral) → su X (posición a lo
  // largo). Cabezal → su Z (posición a lo ancho) si se clicó en sección/planta.
  function _posHintDeClick(plano, host, rol, cara) {
    var g = ST.receta.geometria;
    var ph = {};
    if (rol === 'estribo' || rol === 'traba') {
      // el estribo se dibuja a una X; el click en largo/planta define esa X.
      if (plano === 'largo' || plano === 'planta') ph.x = host.x;
      if (rol === 'traba' && (plano === 'seccion' || plano === 'planta')) ph.z = host.z;
      return ph;
    }
    // cabezal longitudinal: corre por X; el click define su Z (a lo ancho) y afina Y.
    if (plano === 'seccion' || plano === 'planta') ph.z = host.z;
    return ph;
  }

  // ==========================================================================
  // ROTAR PLANO DE LA PIEZA (§INTERACCIÓN-2.0) — NO rota EN el plano; VOLTEA el
  // plano de la pieza. Toggle de comp.plano_pieza.volteado + regenerar. El motor
  // 3D y los kilos NO cambian (es un cambio de PROYECCIÓN): en las vistas 2D, la
  // pieza volteada pasa de dibujarse "de frente" (rectángulo cerrado del estribo,
  // círculo del cabezal) a "de canto" (línea vertical a lo largo de su eje de
  // profundidad + su rango). Así se define su eje longitudinal / dirección de
  // distribución con UN solo mecanismo (resuelve fundación y trabas).
  function rotarPlanoPieza(comp) {
    if (!comp) return;
    comp.plano_pieza = comp.plano_pieza || { volteado: false };
    comp.plano_pieza.volteado = !comp.plano_pieza.volteado;
    _regenerar();          // reproyecta las 4 vistas (2D leen plano_pieza por placement)
    _renderPanel();
    _posicionarFlipBtn();  // el overlay sigue pegado a la pieza tras reproyectar
    _actualizarStatus();
  }

  // Voltear el plano de la pieza SELECCIONADA (lo llaman la tecla 'R' y el botón
  // contextual que flota sobre la barra seleccionada). Snapshot para Ctrl+Z.
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
    var pj = _compVolteado(ci) ? _proyectorVolteado(def) : _proyectorDe(def);
    function X(u) { return t.offX + (u - t.minU) * t.s; }
    function Y(v) { return t.offY + (t.maxV - v) * t.s; }
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
    btn.classList.toggle('flipped', _compVolteado(ST.selCi));
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

  function _borrarSeleccion() {
    if (ST.selCi < 0 || !ST.receta) return;
    _pushUndo();
    ST.receta.componentes.splice(ST.selCi, 1);
    ST.selCi = -1;
    _regenerar();
    _renderPanel();
  }

  function _rotarSeleccion(plano, deltaDeg) {
    if (ST.selCi < 0 || !ST.receta) return;
    _pushUndo();
    var c = ST.receta.componentes[ST.selCi];
    var eje = EJE_ROT[plano] || 'x';
    if (!c.orient || c.orient.eje !== eje) c.orient = { eje: eje, deg: 0 };
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

      svg.addEventListener('mousedown', function (evt) {
        ST.ultimoPlano = plano;
        var sp = _svgPoint(svg, evt); if (!sp) return;

        // ¿tocó un NODO?
        var tgtNode = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-node');
        if (tgtNode) { evt.preventDefault(); _pushUndo(); ST.dragNode = { plano: plano, corner: tgtNode }; return; }

        // ¿tocó la flechita de RANGO?
        var tgtRango = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-rango');
        if (tgtRango != null) { evt.preventDefault(); _pushUndo(); ST.dragRango = { ci: Number(tgtRango), plano: plano, lastX: sp.px }; return; }

        var uv = _pixelToUV(plano, sp.px, sp.py);

        // Herramienta RANGO: 2 clics. Clamp: ambos clics dentro del hormigón.
        if (ST.tool === 'rango') {
          if (!uv) return;
          if (!_dentroDelBoundary(plano, uv)) { _actualizarStatus('Fuera del hormigón: define el rango dentro del contorno.'); return; }
          var host = _clickHost(plano, uv);
          _rangoClick(plano, host);
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

        // Herramienta COLOCAR: clic en vacío → nueva barra.
        // CLAMP (tarea 3): si el clic cae FUERA del hormigón, NO se coloca nada
        // (mata "barras al aire"). El ghost ya avisó en rojo + not-allowed.
        if (ST.tool === 'colocar' && uv) {
          if (!_dentroDelBoundary(plano, uv)) { _actualizarStatus('Fuera del hormigón: clic dentro del contorno para colocar.'); return; }
          var h2 = _clickHost(plano, uv);
          _colocarEnVista(plano, h2);
          return;
        }

        // Rotar: clic en vacío no hace nada; se rota con ESPACIO o botón.
        // Mover en vacío: deseleccionar.
        if (ST.tool === 'mover') { _seleccionar(-1); }
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
    _regenerarDiferido();
  }

  function _dragRangoMove(plano, sp) {
    var dr = ST.dragRango; if (!dr) return;
    var c = ST.receta.componentes[dr.ci]; if (!c || !c.distribucion) return;
    var t = ST.transforms[plano]; if (!t) return;
    var duPx = sp.px - dr.lastX; dr.lastX = sp.px;
    var dHost = duPx / t.s;   // px → cm en U (X para largo/planta)
    var rango = c.distribucion.rango || { from: -ST.receta.geometria.largo / 2 + 4, to: ST.receta.geometria.largo / 2 - 4, sep: c.distribucion.sep || 20 };
    rango.from += dHost; rango.to += dHost;
    c.distribucion.rango = rango;
    _regenerarDiferido();
  }

  // RANGO — 1er clic fija 'from', 2º clic fija 'to' y activa distribución lineal.
  function _rangoClick(plano, host) {
    if (ST.selCi < 0) {
      // Si no hay selección, coloca primero una barra base con la tipología activa.
      _colocarEnVista(plano, host);
    }
    var c = ST.receta.componentes[ST.selCi];
    if (!c) return;
    if (!ST.rangoTmp) {
      ST.rangoTmp = { ci: ST.selCi, plano: plano, from: host };
      _redibujar2D(ST.ultimoOut);
      _actualizarStatus('Rango: clic el FIN de la distribución.');
      return;
    }
    var from = ST.rangoTmp.from, to = host;
    ST.rangoTmp = null;
    _pushUndo();   // snapshot antes de activar la distribución por rango
    c.distribucion = c.distribucion || {};
    // La herramienta ↔ Rango define una DISTRIBUCIÓN lineal salvo que el componente
    // ya esté en modo arreglo (ahí el rango es el "a lo largo" del arreglo 2D).
    if (_modoDe(c) !== 'arreglo') { c.modo = 'lineal'; c.distribucion.modo = 'linear'; }
    c.distribucion.activa = true;
    c.distribucion.sep = c.distribucion.sep || (_rolDe(c.tipologia) === 'traba' ? 40 : 20);
    c.distribucion.rango = { from: from.x, to: to.x, sep: c.distribucion.sep };
    // La barra base ya no necesita pos_hint.x (el rango la distribuye).
    if (c.pos_hint) delete c.pos_hint.x;
    _regenerar();
    _renderPanel();
    _actualizarStatus();
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

  function _compBody(c, ci, rol) {
    var body = document.createElement('div'); body.className = 'te-cbody';
    var spec = _figSpec(c.figura);
    var d = c.distribucion || {};

    // Identidad
    var idRow = _div('te-grid3');
    idRow.appendChild(_fld('Figura', _input({ value: c.figura, list: 'te_figs' }, function (v) { _setFigura(ci, v); })));
    idRow.appendChild(_fld('φ mm', _select(['8', '10', '12', '16', '18', '22', '25'], String(c.diam), function (v) { c.diam = Number(v); _mut(ci); })));
    idRow.appendChild(_fld('Sufijo', _input({ value: c.suf_tipo || '', placeholder: 'sup / A…' }, function (v) { c.suf_tipo = v; _mut(ci, true); })));
    body.appendChild(idRow);

    // Cara / anclaje (radial)
    var caraRow = _div('te-row');
    caraRow.appendChild(_label('Cara / anclaje'));
    caraRow.appendChild(_radial([['sup', 'Superior'], ['inf', 'Inferior'], ['lateral', 'Lateral']], c.cara, function (v) { c.cara = v; _mut(ci); }));
    body.appendChild(caraRow);

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
      c.orient = { eje: eje, deg: Number(v) || 0 }; _mut(ci);
    });
    rotInp.style.width = '70px';
    var rot90 = document.createElement('button'); rot90.className = 'te-ctool'; rot90.textContent = '+90°'; rot90.style.padding = '3px 8px';
    rot90.addEventListener('click', function () { _rotarSeleccion(ST.ultimoPlano, 90); });
    rotWrap.appendChild(rotInp); rotWrap.appendChild(rot90);
    rotRow.appendChild(rotWrap);
    body.appendChild(rotRow);

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
    var note = _div('te-note'); note.textContent = 'Dim en Auto se derivan del elemento (largo/alto/ancho − recub). Fija = valor manual.';
    body.appendChild(note);
    return body;
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
    g3.appendChild(_fld('Sep. capas cm', _input({ value: d.gap != null ? d.gap : 4, type: 'number' }, function (v) { d.gap = Number(v) || 0; _mut(ci); })));
    box.appendChild(g3);
    var note = _div('te-note'); note.textContent = 'Las capas se apilan desde la cara hacia el núcleo con la separación indicada.';
    box.appendChild(note);
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
      var note0 = _div('te-note'); note0.textContent = 'Zonas de espaciamiento (extremos confinados / centro). Cambia a rango con la herramienta ↔ Rango.';
      box.appendChild(note0);
      return;
    }
    var g2 = _div('te-grid2');
    g2.appendChild(_fld('@ sep cm', _input({ value: d.sep || 20, type: 'number' }, function (v) { d.sep = Number(v) || 20; if (d.rango) d.rango.sep = d.sep; _mut(ci); })));
    g2.appendChild(_fld('Rango', _rangoEditor(c, d, ci)));
    box.appendChild(g2);
    var note = _div('te-note'); note.textContent = 'Define el rango (from → to) por campos, con 2 clics (herramienta ↔ Rango) o arrastrando la flechita doble. cant = ceil(dist/@)+1.';
    box.appendChild(note);
  }

  // ARREGLO — rango en un sentido + n_capas + sep_capas (rango × capas). El eje de
  // profundidad de las capas lo fija el plano de trabajo (eje_capas).
  function _camposArreglo(box, c, ci, rol, d) {
    if (!d.rango) d.rango = _rangoDefault(d.sep || 20);
    var g2 = _div('te-grid2');
    g2.appendChild(_fld('@ sep (rango) cm', _input({ value: d.sep || 20, type: 'number' }, function (v) { d.sep = Number(v) || 20; if (d.rango) d.rango.sep = d.sep; _mut(ci); })));
    g2.appendChild(_fld('Rango', _rangoEditor(c, d, ci)));
    box.appendChild(g2);

    var g3 = _div('te-grid3');
    g3.appendChild(_fld('N° capas', _input({ value: d.n_capas || 2, type: 'number' }, function (v) { d.n_capas = Math.max(1, Number(v) || 1); _mut(ci); })));
    g3.appendChild(_fld('Sep. capas cm', _input({ value: d.sep_capas != null ? d.sep_capas : 10, type: 'number' }, function (v) { d.sep_capas = Number(v) || 0; _mut(ci); })));
    g3.appendChild(_fld('Prof. (capas)', _selectPairs([['x', 'largo'], ['y', 'alto'], ['z', 'ancho']], d.eje_capas || _ejeCapasDefault(), function (v) { d.eje_capas = v; _mut(ci); })));
    box.appendChild(g3);
    var note = _div('te-note'); note.textContent = 'Arreglo 2D = rango a lo largo × N capas separadas en profundidad. n_capas=1 equivale a la distribución lineal. El plano de trabajo activo sugiere la profundidad.';
    box.appendChild(note);
  }

  // Editor compacto del rango (from/to en cm) — números editables.
  function _rangoEditor(c, d, ci) {
    var wrap = _div(''); wrap.style.cssText = 'display:flex;gap:4px;align-items:center';
    if (!d.rango) { return _static('(usa ↔ Rango)'); }
    var fi = _input({ value: Math.round(d.rango.from), type: 'number' }, function (v) { d.rango.from = Number(v); _mut(ci); });
    var ti = _input({ value: Math.round(d.rango.to), type: 'number' }, function (v) { d.rango.to = Number(v); _mut(ci); });
    fi.style.width = '52px'; ti.style.width = '52px';
    var sep = document.createElement('span'); sep.textContent = '→'; sep.style.cssText = 'color:var(--te-muted);font-size:11px';
    wrap.appendChild(fi); wrap.appendChild(sep); wrap.appendChild(ti);
    return wrap;
  }

  // --- fábricas de UI reutilizables ---
  function _div(cls) { var d = document.createElement('div'); if (cls) d.className = cls; return d; }
  function _label(t) { var l = document.createElement('label'); l.textContent = t; return l; }
  function _fld(labelText, inputEl) { var f = _div('te-fld'); f.appendChild(_label(labelText)); f.appendChild(inputEl); return f; }
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
    ST.cargado = { figura: ST.figura, tipologia: ST.tipologia, diam: Number(ST.diam), contorno: ST.contorno !== false };
    _actualizarStatus();
  }

  // Soltar lo cargado (Esc / herramienta que no coloca) → sin ghost, deselecciona.
  function _soltarCargado() {
    ST.cargado = null;
    _limpiarGhost();
    _actualizarStatus();
  }

  function _bindRibbon() {
    var fig = $('te_ribFigura');
    if (fig && !fig._teBound) { fig._teBound = true; fig.addEventListener('change', function () { ST.figura = fig.value.trim().toUpperCase() || '103B'; if (_hayCargado()) _sellarCargado(); else _actualizarStatus(); }); ST.figura = fig.value.trim().toUpperCase() || ST.figura; }
    var dia = $('te_ribDiam');
    if (dia && !dia._teBound) { dia._teBound = true; dia.addEventListener('change', function () { ST.diam = Number(dia.value) || 16; if (_hayCargado()) _sellarCargado(); else _actualizarStatus(); }); ST.diam = Number(dia.value) || ST.diam; }
    var con = $('te_ribContorno');
    if (con && !con._teBound) { con._teBound = true; con.addEventListener('change', function () { ST.contorno = con.checked; if (_hayCargado()) _sellarCargado(); }); ST.contorno = con.checked; }

    var tips = $('te_tipbtns');
    if (tips && !tips._teBound) {
      tips._teBound = true;
      tips.querySelectorAll('.te-tipbtn').forEach(function (b) {
        b.addEventListener('click', function () {
          tips.querySelectorAll('.te-tipbtn').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          ST.tipologia = b.getAttribute('data-tip') || 'CBS';
          // Elegir una tipología es la señal explícita de "quiero colocar esto":
          // si estamos en el estado neutro (Seleccionar), pasa a Colocar y carga el
          // ghost. Si ya estaba en rango, respeta el rango. Esto hace que Seleccionar
          // sea el estado por defecto real y colocar sea siempre intencional.
          if (ST.tool !== 'colocar' && ST.tool !== 'rango') _activarHerramienta('colocar');
          _sellarCargado();
        });
      });
    }
  }

  // Activa una herramienta (marca el botón + setea ST.tool + carga/suelta el ghost).
  // Reutilizable desde el listener de botones y desde otros flujos (elegir tipología).
  function _activarHerramienta(tool) {
    var ct = $('te_ctools'); if (!ct) return;
    ct.querySelectorAll('.te-ctool[data-tool]').forEach(function (x) {
      x.classList.toggle('on', x.getAttribute('data-tool') === tool);
    });
    ST.tool = tool;
    ST.rangoTmp = null;
    // Al cambiar de herramienta se apaga el snap de cara (evita resaltados fantasma
    // con Seleccionar/Rango/Rotar); el ghost se redibuja en el próximo hover.
    var caraPlano = ST.caraHi && ST.caraHi.plano;
    ST.caraHi = null;
    // Herramienta de colocación → carga el ghost; las demás lo sueltan.
    if (tool === 'colocar' || tool === 'rango') _sellarCargado();
    else _soltarCargado();
    if (caraPlano) _redibujar2D(ST.ultimoOut);   // limpia la cara resaltada
    _setQuadCursor();
    _actualizarStatus();
  }

  function _bindHerramientas() {
    var ct = $('te_ctools'); if (!ct || ct._teBound) return;
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
    var del = $('te_btnBorrar');
    if (del) del.addEventListener('click', function () { _borrarSeleccion(); });
    var add = $('te_addComp');
    if (add && !add._teBound) { add._teBound = true; add.addEventListener('click', function () { _agregarComponenteManual(); }); }

    // Botón contextual "Voltear plano (R)" sobre la pieza seleccionada.
    var flip = $('te_flipBtn');
    if (flip && !flip._teBound) {
      flip._teBound = true;
      flip.addEventListener('click', function (e) { e.stopPropagation(); _voltearSeleccion(); });
      // evitar que el mousedown burbujee a las vistas (no deseleccionar al clicarlo)
      flip.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    }
  }

  function _agregarComponenteManual() {
    _pushUndo();
    var rol = _rolDe(ST.tipologia);
    var meta = _metaModular(ST.tipologia);
    var comp = {
      tipologia: ST.tipologia, figura: ST.figura, diam: Number(ST.diam), suf_tipo: '',
      cara: _caraDefault(ST.tipologia), recub_override: null,
      angulos: _figSpec(ST.figura).angulos.slice(),
      modo: meta.modo, plano_pieza: meta.plano_pieza, arreglo: meta.arreglo,
      dims: _dimsDefault(ST.figura, rol, ST.contorno),
      distribucion: _distDefault(rol)
    };
    ST.receta.componentes.push(comp);
    ST.selCi = ST.receta.componentes.length - 1;
    _regenerar(); _renderPanel();
  }

  function _setQuadCursor() {
    var q = $('te_quad'); if (!q) return;
    q.classList.remove('tool-colocar', 'tool-rango', 'tool-mover', 'tool-rotar');
    q.classList.add('tool-' + ST.tool);
  }

  function _actualizarStatus(msg) {
    var s = $('te_ctoolsStatus'); if (!s) return;
    if (msg) { s.innerHTML = '<b style="color:var(--te-acero-d)">' + _esc(msg) + '</b>'; return; }
    var selTxt = '';
    if (ST.selCi >= 0 && ST.receta.componentes[ST.selCi]) {
      var c = ST.receta.componentes[ST.selCi];
      var ang = (c.orient && c.orient.deg) ? (' · ' + c.orient.deg + '°') : '';
      selTxt = ' · sel: <b>' + _esc(c.tipologia + ' ' + c.figura) + ang + '</b>';
    }
    s.innerHTML = 'Herramienta: <b>' + _esc(ST.tool) + '</b> · figura <b>' + _esc(ST.figura) + '</b> · ' +
      '<b style="color:' + _colDe(ST.tipologia) + '">' + _esc(ST.tipologia) + '</b> ø' + _esc(ST.diam) + selTxt;
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
  var _ORTO_DIR = {   // depth → posición de cámara (unitaria) y up, en ejes de mundo
    x: { eye: [1, 0, 0], up: [0, 1, 0] },   // sección: mira por +X (ve el plano YZ)
    y: { eye: [0, 1, 0], up: [0, 0, 1] },   // planta:  mira por +Y (ve el plano XZ)
    z: { eye: [0, 0, 1], up: [0, 1, 0] }    // largo:   mira por +Z (ve el plano XY)
  };

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
        _marcarSucio();   // PERF: reset de vista → repintar
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
      if (slices.pos.length) {
        // banda fina centrada en la rebanada (estribo) más cercana al slider.
        o.cortePos = _sliceMasCercana(slices.pos, target);
        o.corteGrosor = Math.max(slices.diam * 1.4, 1.2);   // ~1 barra de espesor
      } else {
        // sin estribos que aislar → banda gruesa (jaula entera, nunca vacía).
        o.cortePos = target;
        o.corteGrosor = Math.max(half, 5);
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
  function _bindVistaOrto(plano) {
    var o = ST.orto[plano]; if (!o) return;
    var host = o.vista, panning = false, lx = 0, ly = 0;
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
      _marcarSucio();   // PERF: pan de una vista orto → repintar
    });
    host.addEventListener('wheel', function (e) {
      e.preventDefault(); o.zoom *= (e.deltaY > 0 ? 0.9 : 1.1);
      o.zoom = Math.max(0.15, Math.min(12, o.zoom));
      _marcarSucio();
    }, { passive: false });
  }

  // ==========================================================================
  // B2·(a) — CLIPPING **LOCAL** POR VISTA (arregla "longitudinales invisibles").
  //
  // Antes el corte se hacía con renderer.clippingPlanes (GLOBAL): la banda fina de la
  // SECCIÓN recortaba TAMBIÉN las dos tapas del cilindro de un longitudinal visto de
  // punta → quedaba un TUBO ABIERTO cuyo manto se ve de canto (0 px) y cuyo interior
  // son back-faces (MeshStandardMaterial es FrontSide) → no se pintaba NADA. Ese era
  // el "círculo apagado / barra invisible".
  //
  // Fix: el cuchillo sólo debe cortar lo que un cuchillo REAL corta — las barras que
  // el plano atraviesa de canto ("rebanadas": estribos/trabas en SECCIÓN). Las que
  // CORREN a lo largo del eje de profundidad cruzan el corte esté donde esté, así que
  // se dejan SIN CLIP: su tapa cercana se ve entera y estable como un círculo sólido.
  //
  // Mecánica (three r160): con renderer.localClippingEnabled=true, los planos se
  // asignan POR MATERIAL. Como los materiales son COMPARTIDOS por tipología, a las
  // barras "rebanada" se les pone un CLON del material con clippingPlanes; a las demás
  // se les restituye el material base (clippingPlanes vacío). El clon se cachea en el
  // propio mesh (userData.matClip) → no se crea material por frame. El hormigón y el
  // plano P3 siguen exentos: su material ya lleva clippingPlanes:[] y no se toca.
  // ==========================================================================

  // ¿esta barra es una REBANADA para el eje de profundidad `dep`? Mismo criterio que
  // _slicesEnProfundidad: span pequeño en ese eje = vive casi en un solo valor.
  function _esRebanada(mesh, dep) {
    var span = mesh.userData && mesh.userData.span;
    if (!span) return true;                 // sin dato → comportarse como antes (clipear)
    var espesor = _espesorProfundidad(dep);
    var umbral = Math.min(Math.max(espesor * 0.15, 8), 40);
    return span[dep] <= umbral;
  }

  // Aplica/retira los 2 planos de corte de una vista sobre los materiales de las barras.
  function _clipLocalPorVista(dep, planos) {
    var barras = ST.barras3D || [];
    for (var i = 0; i < barras.length; i++) {
      var mesh = barras[i];
      var base = mesh.userData.matBase;
      if (!base) continue;
      if (planos && _esRebanada(mesh, dep)) {
        // clon cacheado del material compartido, con los planos de ESTA vista
        var clip = mesh.userData.matClip;
        if (!clip || clip.userData._base !== base) {
          clip = base.clone();
          clip.userData._propio = true;    // creado al vuelo → dispose al vaciar el world
          clip.userData._base = base;
          mesh.userData.matClip = clip;
        }
        clip.clippingPlanes = planos;
        mesh.material = clip;
      } else {
        mesh.material = base;              // longitudinal (o pase 3D): SIN clip
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
      _marcarSucio();      // PERF (render-on-demand): un resize obliga a repintar
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
  var GIZMO_PX = 64;

  function _initGizmo3D() {
    var THREE = global.THREE;
    if (!THREE || ST.gizmo) return ST.gizmo;
    var esc = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    var L = 1;                                   // largo del eje en unidades del gizmo
    var ejes = [
      { v: new THREE.Vector3(1, 0, 0), c: _EJE_COLOR.x, t: 'X' },
      { v: new THREE.Vector3(0, 1, 0), c: _EJE_COLOR.y, t: 'Y' },
      { v: new THREE.Vector3(0, 0, 1), c: _EJE_COLOR.z, t: 'Z' }
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
    var dir = new THREE.Vector3().subVectors(ST.camera.position, ST.target).normalize();
    gz.cam.position.copy(dir.multiplyScalar(3.4));
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

  global.templateEditorAbrir = function () {
    var bd = $('te_backdrop');
    if (!bd) { alert('El Template Editor aún se está cargando. Reintenta en un momento.'); return; }
    var d = _deps();
    if (!ST.receta && d.semilla) ST.receta = d.semilla.semillaViga();
    // Asegurar el flag de distribución en la semilla (estribo/traba ya distribuidos).
    (ST.receta.componentes || []).forEach(function (c) {
      var rol = _rolDe(c.tipologia);
      if (rol !== 'cabezal' && c.distribucion && c.distribucion.zonas && c.distribucion.activa == null) c.distribucion.activa = true;
    });
    bd.classList.add('on');
    _bindUI();
    _marcarSucio();     // PERF (render-on-demand): al abrir siempre hay que pintar
    // Undo limpio por sesión + sellar lo cargado (la herramienta por defecto es
    // 'colocar' → el ghost queda listo para seguir el cursor de una).
    ST.undoStack = [];
    if (ST.tool === 'colocar' || ST.tool === 'rango') _sellarCargado(); else ST.cargado = null;
    _renderPanel();
    _regenerar();
    global.requestAnimationFrame(function () { global.requestAnimationFrame(function () {
      _iniciar3dEnVivo();
    }); });
  };

  global.templateEditorCerrar = function () {
    var bd = $('te_backdrop'); if (bd) bd.classList.remove('on');
    // limpiar estado transitorio de hover (snap de cara / ghost) y esconder overlay.
    ST.caraHi = null;
    _limpiarGhost();
    var fb = $('te_flipBtn'); if (fb) fb.classList.remove('on');
  };

  global.templateEditorVerEn3D = function () { _iniciar3dEnVivo(); };

  // Cerrar con clic en el backdrop (fuera del modal)
  document.addEventListener('click', function (e) {
    var bd = $('te_backdrop');
    if (bd && e.target === bd) global.templateEditorCerrar();
  });
  // Escape (tarea 4): 1º cancela un rango en curso · 2º SUELTA lo cargado
  // (deselecciona la herramienta → 'mover', mata el ghost) · 3º cierra el modal.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var bd = $('te_backdrop');
    if (!bd || !bd.classList.contains('on')) return;
    if (ST.rangoTmp) { ST.rangoTmp = null; _redibujar2D(ST.ultimoOut); _actualizarStatus(); return; }
    if (_hayCargado()) {
      // pasar a "mover" (herramienta que no coloca) y soltar el ghost
      var ct = $('te_ctools');
      if (ct) {
        ct.querySelectorAll('.te-ctool[data-tool]').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-tool') === 'mover'); });
      }
      ST.tool = 'mover';
      _soltarCargado();
      _setQuadCursor();
      return;
    }
    global.templateEditorCerrar();
  });

  // Exponer para tests / depuración.
  global.TemplateEditor = {
    _st: ST, _regenerar: function () { _regenerar(); },
    _colocarEnVista: _colocarEnVista, _rotarSeleccion: _rotarSeleccion,
    _borrarSeleccion: _borrarSeleccion, _rangoClick: _rangoClick,
    _rolDe: _rolDe,
    boundaryDeVista: boundaryDeVista, _rectPlano: _rectPlano,   // P2/base task2
    setPlanoActivo: _setPlanoActivo,                            // P3 — 'seccion'|'largo'|'planta'|null
    // INTERACCIÓN-2.0 · ghost + grosor + clamp + undo
    _pushUndo: _pushUndo, _undo: _undo,
    _dentroDelBoundary: _dentroDelBoundary, _clampAlBoundary: _clampAlBoundary,
    _sellarCargado: _sellarCargado, _soltarCargado: _soltarCargado,
    _ghostForma: _ghostForma,
    // INTERACCIÓN-2.0 · rotar plano de la pieza + snap de cara
    rotarPlanoPieza: rotarPlanoPieza,                           // toggle plano_pieza.volteado + regenera
    _compVolteado: _compVolteado,
    _facesDeVista: _facesDeVista, _caraCercana: _caraCercana,   // snap de cara
    _proyectorVolteado: _proyectorVolteado,
    // INTERACCIÓN-2.0 · 3 modos de uso (puntual/lineal/arreglo)
    _modoDe: _modoDe, _modoDefault: _modoDefault, _setModoComp: _setModoComp,
    _metaModular: _metaModular
  };

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
