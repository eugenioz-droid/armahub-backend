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
    _regenPendiente: false,
    _uiOk: false,
    // --- P3: plano de trabajo activo resaltado en el 3D ---
    //   'seccion' | 'largo' | 'planta' | null  (null = ninguno resaltado)
    planoActivo: null, planoMesh: null, elemento: 'viga'
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
    return { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 4, sentido: 'nucleo' };
  }

  // Nombre corto legible del componente (para el panel).
  function _compDesc(c) {
    var rol = _rolDe(c.tipologia);
    var d = c.distribucion || {};
    if (rol === 'cabezal') return (c.cara === 'inf' ? 'inferior' : (c.cara === 'sup' ? 'superior' : 'lateral')) + ' · ' + (d.n_capas || 1) + ' capa' + ((d.n_capas || 1) > 1 ? 's' : '') + ' · ø' + c.diam;
    if (rol === 'estribo') return 'estribo · ' + (d.activa ? ('@' + (d.sep || 20)) : 'sin distribución') + ' · ø' + c.diam;
    return 'traba · ' + (d.activa ? ('@' + (d.sep || 40)) : 'sin distribución') + ' · ø' + c.diam;
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

  // Dibuja UN cuadrante 2D. Guarda su transform para el hit-testing inverso.
  function _dibujarVista2D(svg, out, plano, geo) {
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var def = (_defsPlanos() || {})[plano];
    if (!def) { ST.transforms[plano] = null; return; }
    var proj = _proyectorDe(def);
    var placements = (out && out.placements) || [];

    // Bounding box en (u,v): hormigón + puntos proyectados.
    var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    function acc(u, v) {
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    var rect = geo ? boundaryDeVista(geo, plano, def) : null;
    if (rect) { acc(-rect.W / 2, -rect.H / 2); acc(rect.W / 2, rect.H / 2); }
    placements.forEach(function (pl) {
      (pl.puntos || []).forEach(function (pt) { var q = proj(pt); if (isFinite(q.u) && isFinite(q.v)) acc(q.u, q.v); });
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
      var pts = (pl.puntos || []).map(proj).filter(function (q) { return isFinite(q.u) && isFinite(q.v); });
      if (!pts.length) return;

      // Cabezal longitudinal en SECCIÓN → punto (círculo).
      if (plano === 'seccion' && rol === 'cabezal') {
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
      var d = pts.map(function (q, i) { return (i ? 'L' : 'M') + X(q.u).toFixed(1) + ',' + Y(q.v).toFixed(1); }).join(' ');
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
    var rol = _rolDe(ST.tipologia);
    var cara = _caraDefault(ST.tipologia);
    // La cara puede ajustarse por el click: en sección, click en mitad sup→'sup'.
    if (rol === 'cabezal') {
      if (plano === 'seccion' || plano === 'largo') cara = (host.y >= 0) ? 'sup' : 'inf';
    }
    var comp = {
      tipologia: ST.tipologia, figura: ST.figura, diam: Number(ST.diam), suf_tipo: '',
      cara: cara, recub_override: null,
      angulos: _figSpec(ST.figura).angulos.slice(),
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
    ST.receta.componentes.splice(ST.selCi, 1);
    ST.selCi = -1;
    _regenerar();
    _renderPanel();
  }

  function _rotarSeleccion(plano, deltaDeg) {
    if (ST.selCi < 0 || !ST.receta) return;
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

      svg.addEventListener('mousedown', function (evt) {
        ST.ultimoPlano = plano;
        var sp = _svgPoint(svg, evt); if (!sp) return;

        // ¿tocó un NODO?
        var tgtNode = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-node');
        if (tgtNode) { evt.preventDefault(); ST.dragNode = { plano: plano, corner: tgtNode }; return; }

        // ¿tocó la flechita de RANGO?
        var tgtRango = evt.target && evt.target.getAttribute && evt.target.getAttribute('data-rango');
        if (tgtRango != null) { evt.preventDefault(); ST.dragRango = { ci: Number(tgtRango), plano: plano, lastX: sp.px }; return; }

        var uv = _pixelToUV(plano, sp.px, sp.py);

        // Herramienta RANGO: 2 clics.
        if (ST.tool === 'rango') {
          if (!uv) return;
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
            ST.dragMove = { ci: ci, plano: plano, startHost: _clickHost(plano, uv), startHint: _clonHint(ci) };
          }
          evt.preventDefault();
          return;
        }

        // Herramienta COLOCAR: clic en vacío → nueva barra.
        if (ST.tool === 'colocar' && uv) {
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
    var host = _clickHost(plano, uv);
    var dx = host.x - dm.startHost.x, dy = host.y - dm.startHost.y, dz = host.z - dm.startHost.z;
    var base = dm.startHint || {};
    c.pos_hint = c.pos_hint || {};
    // Solo mueve en los ejes que el plano controla.
    if (plano === 'seccion') { c.pos_hint.z = (base.z || 0) + dz; c.pos_hint.y = (base.y || 0) + dy; }
    else if (plano === 'largo') { c.pos_hint.x = (base.x || 0) + dx; c.pos_hint.y = (base.y || 0) + dy; }
    else { c.pos_hint.x = (base.x || 0) + dx; c.pos_hint.z = (base.z || 0) + dz; }
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
    c.distribucion = c.distribucion || {};
    c.distribucion.modo = 'linear';
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

  function _distBox(c, ci, rol, d) {
    var box = _div('te-modebox');
    var head = _div('te-mh');
    var modoLabel = { layered: 'CAPAS', linear: 'LINEAL @', grid: 'ÁREA 2D', perimeter: 'PERÍMETRO', points: 'PUNTUAL' }[d.modo] || 'LINEAL @';
    head.innerHTML = '<span>Distribución</span><span class="te-chip">' + modoLabel + '</span><span style="flex:1"></span>';
    // check activar (para estribo/traba)
    if (rol !== 'cabezal') {
      var lab = document.createElement('label');
      lab.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:600;color:var(--te-muted)';
      var cbx = document.createElement('input'); cbx.type = 'checkbox'; cbx.style.width = 'auto'; cbx.checked = !!d.activa;
      cbx.addEventListener('change', function () { d.activa = cbx.checked; if (d.activa && !d.rango) { var g = ST.receta.geometria; d.rango = { from: -g.largo / 2 + 4, to: g.largo / 2 - 4, sep: d.sep || 20 }; if (c.pos_hint) delete c.pos_hint.x; } _mut(ci); _renderPanel(); });
      lab.appendChild(cbx); lab.appendChild(document.createTextNode('activar')); head.appendChild(lab);
    }
    box.appendChild(head);

    if (d.modo === 'layered') {
      var g3 = _div('te-grid3');
      g3.appendChild(_fld('N° capas', _input({ value: d.n_capas || 1, type: 'number' }, function (v) { d.n_capas = Math.max(1, Number(v) || 1); _mut(ci, true); })));
      g3.appendChild(_fld('Barras/capa', _input({ value: d.barras_capa || 1, type: 'number' }, function (v) { d.barras_capa = Math.max(1, Number(v) || 1); _mut(ci, true); })));
      g3.appendChild(_fld('Sep. capas cm', _input({ value: d.gap != null ? d.gap : 4, type: 'number' }, function (v) { d.gap = Number(v) || 0; _mut(ci); })));
      box.appendChild(g3);
    } else if (d.zonas && d.zonas.length && !d.rango && d.zonas.some(function (z) { return z.long > 0; })) {
      // Distribución por ZONAS (semilla): @ editable por zona (confinamiento/central).
      d.zonas.forEach(function (z, zi) {
        var zr = _div('te-grid2');
        zr.appendChild(_fld('Zona ' + (zi + 1) + ' long', _input({ value: z.long, type: 'number' }, function (v) { z.long = Number(v) || 0; _mut(ci); })));
        zr.appendChild(_fld('@ sep cm', _input({ value: z.sep, type: 'number' }, function (v) { z.sep = Number(v) || 1; _mut(ci); })));
        box.appendChild(zr);
      });
      var note0 = _div('te-note'); note0.textContent = 'Zonas de espaciamiento (extremos confinados / centro). Para redefinir por pantalla usa la herramienta ↔ Rango.';
      box.appendChild(note0);
    } else {
      var g2 = _div('te-grid2');
      g2.appendChild(_fld('@ sep cm', _input({ value: d.sep || 20, type: 'number' }, function (v) { d.sep = Number(v) || 20; if (d.rango) d.rango.sep = d.sep; _mut(ci); })));
      var rangoTxt = d.rango ? (Math.round(d.rango.from) + ' → ' + Math.round(d.rango.to) + ' cm') : '(usa herramienta ↔ Rango)';
      g2.appendChild(_fld('Rango', _static(rangoTxt)));
      box.appendChild(g2);
      var note = _div('te-note'); note.textContent = 'Activa la distribución y define el rango con 2 clics (herramienta ↔ Rango), o arrastra la flechita doble.';
      box.appendChild(note);
    }
    return box;
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
      var arr = ST.receta.componentes;
      var m = arr.splice(from, 1)[0]; arr.splice(to, 0, m);
      ST.selCi = to;
      _regenerar(); _renderPanel();
    });
  }

  // ==========================================================================
  // RIBBON + HERRAMIENTAS
  // ==========================================================================
  function _bindRibbon() {
    var fig = $('te_ribFigura');
    if (fig && !fig._teBound) { fig._teBound = true; fig.addEventListener('change', function () { ST.figura = fig.value.trim().toUpperCase() || '103B'; _actualizarStatus(); }); ST.figura = fig.value.trim().toUpperCase() || ST.figura; }
    var dia = $('te_ribDiam');
    if (dia && !dia._teBound) { dia._teBound = true; dia.addEventListener('change', function () { ST.diam = Number(dia.value) || 16; _actualizarStatus(); }); ST.diam = Number(dia.value) || ST.diam; }
    var con = $('te_ribContorno');
    if (con && !con._teBound) { con._teBound = true; con.addEventListener('change', function () { ST.contorno = con.checked; }); ST.contorno = con.checked; }

    var tips = $('te_tipbtns');
    if (tips && !tips._teBound) {
      tips._teBound = true;
      tips.querySelectorAll('.te-tipbtn').forEach(function (b) {
        b.addEventListener('click', function () {
          tips.querySelectorAll('.te-tipbtn').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          ST.tipologia = b.getAttribute('data-tip') || 'CBS';
          _actualizarStatus();
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
  }

  function _agregarComponenteManual() {
    var rol = _rolDe(ST.tipologia);
    var comp = {
      tipologia: ST.tipologia, figura: ST.figura, diam: Number(ST.diam), suf_tipo: '',
      cara: _caraDefault(ST.tipologia), recub_override: null,
      angulos: _figSpec(ST.figura).angulos.slice(),
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

  // Teclado: ESPACIO rota 90°, Supr/Backspace borra.
  function _bindTeclado() {
    if (ST._tecladoOk) return; ST._tecladoOk = true;
    document.addEventListener('keydown', function (e) {
      var bd = $('te_backdrop');
      if (!bd || !bd.classList.contains('on')) return;
      // no capturar mientras se escribe en un input/select
      var tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.key === ' ' || e.code === 'Space') {
        if (ST.selCi >= 0) { e.preventDefault(); _rotarSeleccion(ST.ultimoPlano, 90); }
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
    _renderPanel();
    _regenerar();
    global.requestAnimationFrame(function () { global.requestAnimationFrame(function () {
      _iniciar3dEnVivo();
    }); });
  };

  global.templateEditorCerrar = function () {
    var bd = $('te_backdrop'); if (bd) bd.classList.remove('on');
  };

  global.templateEditorVerEn3D = function () { _iniciar3dEnVivo(); };

  // Cerrar con clic en el backdrop (fuera del modal)
  document.addEventListener('click', function (e) {
    var bd = $('te_backdrop');
    if (bd && e.target === bd) global.templateEditorCerrar();
  });
  // Cerrar con Escape (si no hay un rango en curso)
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var bd = $('te_backdrop');
    if (bd && bd.classList.contains('on')) {
      if (ST.rangoTmp) { ST.rangoTmp = null; _redibujar2D(ST.ultimoOut); _actualizarStatus(); return; }
      global.templateEditorCerrar();
    }
  });

  // Exponer para tests / depuración.
  global.TemplateEditor = {
    _st: ST, _regenerar: function () { _regenerar(); },
    _colocarEnVista: _colocarEnVista, _rotarSeleccion: _rotarSeleccion,
    _borrarSeleccion: _borrarSeleccion, _rangoClick: _rangoClick,
    _rolDe: _rolDe,
    boundaryDeVista: boundaryDeVista, _rectPlano: _rectPlano,   // P2/base task2
    setPlanoActivo: _setPlanoActivo                             // P3 — 'seccion'|'largo'|'planta'|null
  };

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
