// =============================================================================
// Template Editor — Colocador por proyecciones (sub-tab del Catálogo).
// Cablea el modal tabs/template_editor_modal.html (calca static/demo/colocador.html):
//   - abrir/cerrar el modal,
//   - interacción COSMÉTICA de la maqueta (colapsar componentes, seleccionar
//     tipología y herramienta) — el flujo real (colocar por proyecciones) NO
//     está definido aún; el usuario lo construirá después,
//   - el cuadrante 3D EN VIVO (abajo-derecha) REUSA el motor del modelador
//     (motor_geom + generar + reglas + semilla). Three.js se carga on-demand
//     (mismo CDN que panel_3d.js). Fondo CLARO (como la maqueta).
//
// NO toca panel_3d.js ni modelador3d_modal.html — solo LEE los módulos globales
// (window.ModeladorGenerar / ModeladorMotorGeom / ModeladorReglas / ModeladorSemilla).
//
// Alcance de esta entrega: el sub-tab del Catálogo solo tiene un botón que ABRE
// este modal. El modal está completo y calcado; el 3D en vivo es real, el resto
// de las vistas y la interacción del panel son cosméticas.
// =============================================================================
(function (global) {
  'use strict';

  var THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';

  // Tema CLARO del 3D del cuadrante (calca --canvas3d / colores de la maqueta).
  var TEMA = {
    bg: 0xd8dee7, g1: 0xb4bdc9, g2: 0xc6cdd6,
    CBS: 0x1565c0, CBI: 0x00897b, ES: 0xe65100, TRV: 0x7b1fa2, LT: 0x455a64
  };

  var ST = {
    receta: null, ultimoOut: null,
    scene: null, camera: null, renderer: null, world: null, grid: null,
    materiales: null,
    rotX: 0.55, rotY: 0.9, dist: 900, target: null, panX: 0, panY: 0,
    threeCargado: false, webglOk: null, rafId: null, verHormigon: true
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

  // --------------------------------------------------------------------------
  // Interacción COSMÉTICA de la maqueta (colapsar / seleccionar). Idempotente:
  // se cablea una vez por apertura, con guard para no duplicar listeners.
  // --------------------------------------------------------------------------
  function _bindCosmetico() {
    if (ST._cosmeticoOk) return;
    ST._cosmeticoOk = true;
    var root = $('te_modal'); if (!root) return;

    // Colapsar/expandir componentes (clic en la cabecera, salvo en los mini-botones)
    root.querySelectorAll('.te-comp .te-ch').forEach(function (h) {
      h.addEventListener('click', function (e) {
        if (e.target.classList.contains('te-mini')) return;
        h.parentElement.classList.toggle('open');
      });
    });

    // Herramientas: una activa a la vez (Snap/Cotas son toggles independientes)
    root.querySelectorAll('.te-ctool').forEach(function (b) {
      var t = b.textContent;
      if (t.indexOf('Snap') >= 0 || t.indexOf('Cotas') >= 0) {
        b.addEventListener('click', function () { b.classList.toggle('on'); });
        return;
      }
      b.addEventListener('click', function () {
        root.querySelectorAll('.te-ctool').forEach(function (x) {
          if (x.textContent.indexOf('Snap') < 0 && x.textContent.indexOf('Cotas') < 0) x.classList.remove('on');
        });
        b.classList.add('on');
      });
    });

    // Tipologías: una activa a la vez
    root.querySelectorAll('.te-tipbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        root.querySelectorAll('.te-tipbtn').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
    });

    // Componente seleccionado (borde verde) al abrir su cabecera
    root.querySelectorAll('.te-comp .te-ch').forEach(function (h) {
      h.addEventListener('click', function (e) {
        if (e.target.classList.contains('te-mini')) return;
        root.querySelectorAll('.te-comp').forEach(function (c) { c.classList.remove('sel'); });
        h.parentElement.classList.add('sel');
      });
    });
  }

  // --------------------------------------------------------------------------
  // 3D en vivo — reusa el motor del modelador (Three.js on-demand)
  // --------------------------------------------------------------------------
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

  function _regenerar() {
    var d = _deps();
    if (!d.gen || !ST.receta) return;
    var out = d.gen.generarViga(ST.receta, {});
    ST.ultimoOut = out;
    // Footer stats (calcan el formato de la maqueta)
    var fi = $('te_footItems'), fb = $('te_footBarras'), fk = $('te_footKg');
    if (fi) fi.textContent = out.resumen.items;
    if (fb) fb.textContent = out.resumen.barras;
    if (fk) fk.textContent = _num(out.resumen.kg);
    if (ST.threeCargado && ST.webglOk) _redibujar(out);
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

  function _rolDe(t) {
    t = (t || '').toUpperCase();
    if (t === 'ES' || t === 'ESC' || t === 'EC') return 'estribo';
    if (t.indexOf('TR') === 0) return 'traba';
    return 'cabezal';
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
  }

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
    if (!w || !h) return;
    ST.renderer.setSize(w, h, false);
    ST.renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
    ST.camera.aspect = w / h; ST.camera.updateProjectionMatrix();
  }

  function _loop() {
    ST.rafId = global.requestAnimationFrame(_loop);
    var bd = $('te_backdrop');
    if (!bd || !bd.classList.contains('on')) return;   // no renderizar cerrado
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
      // Cambiar del placeholder SVG al canvas real.
      var cv = $('te_cv'), fb = $('te_svgFallback');
      if (cv) cv.style.display = 'block';
      if (fb) fb.style.display = 'none';
      if (ST.ultimoOut) _redibujar(ST.ultimoOut);
    });
  }

  // --------------------------------------------------------------------------
  // ABRIR / CERRAR
  // --------------------------------------------------------------------------
  global.templateEditorAbrir = function () {
    var bd = $('te_backdrop');
    if (!bd) { alert('El Template Editor aún se está cargando. Reintenta en un momento.'); return; }
    var d = _deps();
    if (!ST.receta && d.semilla) ST.receta = d.semilla.semillaViga();
    bd.classList.add('on');
    _bindCosmetico();
    _regenerar();          // footer stats aunque el 3D no esté listo
    _iniciar3dEnVivo();    // carga Three.js e inicia la escena (una vez)
  };

  global.templateEditorCerrar = function () {
    var bd = $('te_backdrop'); if (bd) bd.classList.remove('on');
  };

  // El botón "Ver en 3D" del footer solo garantiza que el 3D en vivo esté activo
  // (útil si el navegador no lo inició por WebGL). Cosmético por ahora.
  global.templateEditorVerEn3D = function () { _iniciar3dEnVivo(); };

  // Cerrar con clic en el backdrop (fuera del modal)
  document.addEventListener('click', function (e) {
    var bd = $('te_backdrop');
    if (bd && e.target === bd) global.templateEditorCerrar();
  });
  // Cerrar con Escape
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var bd = $('te_backdrop');
    if (bd && bd.classList.contains('on')) global.templateEditorCerrar();
  });

  // Exponer para tests / depuración.
  global.TemplateEditor = { _st: ST, _regenerar: _regenerar };

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
