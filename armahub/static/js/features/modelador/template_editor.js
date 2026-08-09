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
    tool: 'colocar', snap: true, cotas: false,
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
    undoStack: [], _undoMax: 60
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
    if (ST.threeCargado && ST.webglOk) _redibujar(out);
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
      hormigon: new THREE.MeshStandardMaterial({ color: 0x9aa6b5, transparent: true, opacity: 0.14, roughness: 0.9, depthWrite: false })
    };
    _bindOrbita(cv);
    ST.webglOk = true;
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

  function _redibujar(out) {
    var THREE = global.THREE, geom = _deps().geom;
    if (!THREE || !ST.world || !geom) return;
    while (ST.world.children.length) ST.world.remove(ST.world.children[0]);
    var g = ST.receta.geometria;
    if (ST.verHormigon) {
      var box = new THREE.Mesh(new THREE.BoxGeometry(g.largo, g.alto, g.ancho), ST.materiales.hormigon);
      var edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(g.largo, g.alto, g.ancho)),
        new THREE.LineBasicMaterial({ color: 0x8a96a5 }));
      ST.world.add(box); ST.world.add(edges);
    }
    (out.placements || []).forEach(function (pl) {
      var mat = _matDe(pl.tipologia);
      var mesh = geom.barraSolida(pl.puntos, pl.diam, mat, { segmentosRadiales: 10 });
      if (mesh) ST.world.add(mesh);
    });
    ST.dist = g.largo * 1.15 + 160;
    _redibujarPlanoActivo();   // P3 — re-agregar el resaltado tras vaciar el world
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
    if (ST.planoMesh && ST.world && ST.planoMesh.parent === ST.world) {
      ST.world.remove(ST.planoMesh);
    }
    ST.planoMesh = null;
    if (!THREE || !ST.world || !ST.planoActivo || !ST.receta) return;
    var def = (_defsPlanos() || {})[ST.planoActivo];
    if (!def || !def.depth) return;
    var g = ST.receta.geometria;
    var W = Number(g[def.W]), H = Number(g[def.H]);   // tamaño real de la cara (cm)
    if (!(W > 0) || !(H > 0)) return;

    var mat = new THREE.MeshBasicMaterial({
      color: 0x2f80ed, transparent: true, opacity: 0.15,
      side: THREE.DoubleSide, depthWrite: false
    });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    // Orientar según el eje de profundidad (normal del plano).
    if (def.depth === 'x')      mesh.rotation.y = Math.PI / 2;  // normal → X
    else if (def.depth === 'y') mesh.rotation.x = Math.PI / 2;  // normal → Y
    // depth === 'z' → sin rotar (normal ya es Z)
    mesh.renderOrder = 999;                 // dibujar al final (semitransparente)
    mesh.position[def.depth] = 0.05;        // micro-offset anti z-fighting
    ST.planoMesh = mesh;
    ST.world.add(mesh);
  }

  // Setear el plano de trabajo activo y resaltarlo (o quitarlo con null).
  // Toggle: volver a pedir el mismo plano lo apaga.
  function _setPlanoActivo(plano) {
    if (plano !== 'seccion' && plano !== 'largo' && plano !== 'planta') plano = null;
    ST.planoActivo = (ST.planoActivo === plano) ? null : plano;
    _sincronizarResaltado2D();
    _redibujarPlanoActivo();
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
  // (§INTERACCIÓN-2.0 tarea 2). En el corte, el gancho de apertura y el de cierre
  // caen uno SOBRE otro (los puntos [0]≈[n-1] y sus anclas [1]≈[n-2] coinciden) →
  // se veían como UNA sola línea. Aquí desplazamos cada gancho ±½·diam PERPENDICULAR
  // a su propio tramo, en unidades host (cm), para que se lean separados. Opera solo
  // sobre los tramos-gancho (primero y último); el rectángulo perimetral no se toca.
  // NO altera el motor ni el peso: es puramente el trazo 2D de esta vista.
  function _separarGanchosSeccion(pts, diamCm) {
    if (!pts || pts.length < 4) return pts;
    var off = Math.max((Number(diamCm) || 0) / 2, 0.3);   // ½·diam en cm (mín visible)
    var out = pts.map(function (q) { return { u: q.u, v: q.v }; });
    function nudgeSeg(iTip, iAnchor, sign) {
      var tip = out[iTip], anc = out[iAnchor];
      var du = tip.u - anc.u, dv = tip.v - anc.v;
      var len = Math.hypot(du, dv);
      if (len < 1e-6) {   // gancho degenerado (tip encima del ancla): usa vertical
        du = 0; dv = 1; len = 1;
      }
      // perpendicular unitaria (−dv, du)
      var pu = -dv / len, pv = du / len;
      // desplaza tanto la punta como su ancla → el tramo entero se corre paralelo,
      // así el gancho no se "tuerce", solo se separa de su gemelo.
      tip.u += sign * off * pu; tip.v += sign * off * pv;
      anc.u += sign * off * pu; anc.v += sign * off * pv;
    }
    nudgeSeg(0, 1, +1);                       // gancho de apertura → un lado
    nudgeSeg(pts.length - 1, pts.length - 2, -1);  // gancho de cierre → el otro
    return out;
  }

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

    // Hormigón + boundary de recubrimiento.
    if (rect) {
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
      var dpts = (plano === 'seccion' && rol === 'estribo') ? _separarGanchosSeccion(pts, pl.diam) : pts;
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

      // P3 — DOBLE clic en el cuadrante 2D → fija/quita ese plano como activo
      // (resaltado en el 3D). Doble clic para no chocar con los single-clicks de
      // las herramientas (colocar/mover/rango).
      svg.addEventListener('dblclick', function (evt) {
        evt.preventDefault();
        _setPlanoActivo(plano);
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
      _seleccionar(ci);
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
          // Elegir tipología "carga" la herramienta (si estás colocando/rango).
          if (ST.tool === 'colocar' || ST.tool === 'rango') _sellarCargado();
          else _actualizarStatus();
        });
      });
    }
  }

  function _bindHerramientas() {
    var ct = $('te_ctools'); if (!ct || ct._teBound) return;
    ct._teBound = true;
    ct.querySelectorAll('.te-ctool[data-tool]').forEach(function (b) {
      b.addEventListener('click', function () {
        ct.querySelectorAll('.te-ctool[data-tool]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        ST.tool = b.getAttribute('data-tool');
        ST.rangoTmp = null;
        // Al cambiar de herramienta se apaga el snap de cara (evita resaltados
        // fantasma con Mover/Rango/Rotar); el ghost se redibuja en el próximo hover.
        var caraPlano = ST.caraHi && ST.caraHi.plano;
        ST.caraHi = null;
        // Herramienta de colocación → carga el ghost; las demás lo sueltan.
        if (ST.tool === 'colocar' || ST.tool === 'rango') _sellarCargado();
        else _soltarCargado();
        if (caraPlano) _redibujar2D(ST.ultimoOut);   // limpia la cara resaltada
        _setQuadCursor();
        _actualizarStatus();
      });
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

  function _bindOrbita(cv) {
    var drag = false, panning = false, lx = 0, ly = 0;
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('mousedown', function (e) {
      lx = e.clientX; ly = e.clientY;
      if (e.button === 1 || e.button === 2 || e.shiftKey) { panning = true; e.preventDefault(); }
      else drag = true;
    });
    global.addEventListener('mouseup', function () { drag = false; panning = false; });
    global.addEventListener('mousemove', function (e) {
      var dx = e.clientX - lx, dy = e.clientY - ly;
      if (panning) { ST.panX -= dx * ST.dist * 0.0011; ST.panY += dy * ST.dist * 0.0011; lx = e.clientX; ly = e.clientY; return; }
      if (!drag) return;
      ST.rotY -= dx * 0.008; ST.rotX += dy * 0.008;
      ST.rotX = Math.max(-1.45, Math.min(1.45, ST.rotX));
      lx = e.clientX; ly = e.clientY;
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault(); ST.dist *= (e.deltaY > 0 ? 1.1 : 0.9);
      ST.dist = Math.max(120, Math.min(6000, ST.dist));
    }, { passive: false });
  }

  function _resize() {
    if (!ST.renderer) return;
    var cv = $('te_cv'); if (!cv) return;
    var host = cv.parentElement; if (!host) return;
    var w = host.clientWidth, h = host.clientHeight;
    if (!w) w = 300; if (!h) h = 200;
    ST.renderer.setSize(w, h, false);
    ST.renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
    if (ST.camera) { ST.camera.aspect = w / h; ST.camera.updateProjectionMatrix(); }
  }

  function _loop() {
    ST.rafId = global.requestAnimationFrame(_loop);
    var bd = $('te_backdrop');
    if (!bd || !bd.classList.contains('on')) return;
    _resize(); _applyCam(); ST.renderer.render(ST.scene, ST.camera);
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
    _ghostForma: _ghostForma, _separarGanchosSeccion: _separarGanchosSeccion,
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
