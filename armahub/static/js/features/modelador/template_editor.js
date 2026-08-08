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
    _redibujar2D(out);                                  // 3 vistas 2D (siempre)
    if (ST.threeCargado && ST.webglOk) _redibujar(out); // 3D (si hay WebGL listo)
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

  // --------------------------------------------------------------------------
  // Vistas 2D en vivo — proyectan los MISMOS placements que el 3D a cada plano.
  // Genéricas: reciben placements + un proyector (punto3D → {u,v}) y escalan al
  // tamaño del cuadrante por bounding box. Nada específico de viga: un muro o
  // columna futuros usan los mismos placements con otras proyecciones.
  //   SECCIÓN  = corte transversal  → plano Y-Z (u=z, v=y)
  //   A LO LARGO = elevación        → plano X-Y (u=x, v=y)
  //   PLANTA   = vista superior     → plano X-Z (u=x, v=z)
  // Colores por tipología: mismos que el 3D (CBS azul / CBI teal / ES naranja /
  // TRV morado / LT gris-azulado). En la SECCIÓN los cabezales (longitudinales)
  // se ven como PUNTOS (círculos); estribos/trabas como el recorrido perimetral.
  // --------------------------------------------------------------------------
  var COL2D = { CBS: '#1565c0', CBI: '#00897b', ES: '#e65100', TRV: '#7b1fa2', LT: '#607d8b' };
  var SVG_NS = 'http://www.w3.org/2000/svg';
  // Proyectores por plano (genéricos: cualquier polilínea 3D → 2D).
  var PROY2D = {
    seccion: function (p) { return { u: p.z, v: p.y }; },
    largo:   function (p) { return { u: p.x, v: p.y }; },
    planta:  function (p) { return { u: p.x, v: p.z }; }
  };

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
  // host (cm), centrado en el origen. Devuelve {out:[w,h], in:[w,h]} en (u,v).
  function _rectPlano(g, plano) {
    var rs = g.recub_sup != null ? Number(g.recub_sup) : 4;
    var ri = g.recub_inf != null ? Number(g.recub_inf) : 4;
    var rl = g.recub_lat != null ? Number(g.recub_lat) : 3;
    var largo = Number(g.largo), alto = Number(g.alto), ancho = Number(g.ancho);
    if (plano === 'seccion') return { W: ancho, H: alto, iW: ancho - 2 * rl, iH: alto - rs - ri };
    if (plano === 'largo')   return { W: largo, H: alto, iW: largo - 2 * rl, iH: alto - rs - ri };
    return { W: largo, H: ancho, iW: largo - 2 * rl, iH: ancho - 2 * rl }; // planta
  }

  // Dibuja UN cuadrante 2D. `plano` ∈ {seccion,largo,planta}.
  function _dibujarVista2D(svg, out, plano, geo) {
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var proj = PROY2D[plano];
    var placements = (out && out.placements) || [];

    // --- Bounding box en (u,v): hormigón + todos los puntos proyectados ---
    var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    function acc(u, v) {
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    var rect = geo ? _rectPlano(geo, plano) : null;
    if (rect) { acc(-rect.W / 2, -rect.H / 2); acc(rect.W / 2, rect.H / 2); }
    placements.forEach(function (pl) {
      (pl.puntos || []).forEach(function (pt) { var q = proj(pt); if (isFinite(q.u) && isFinite(q.v)) acc(q.u, q.v); });
    });
    if (!isFinite(minU) || !isFinite(minV)) return;   // sin geometría → vista vacía

    // --- Escala fit al viewBox del SVG, con margen; V se invierte (SVG y↓) ---
    var vb = (svg.getAttribute('viewBox') || '0 0 620 300').split(/\s+/).map(Number);
    var VW = vb[2] || 620, VH = vb[3] || 300, MARGIN = 26;
    var spanU = Math.max(maxU - minU, 1e-6), spanV = Math.max(maxV - minV, 1e-6);
    var s = Math.min((VW - 2 * MARGIN) / spanU, (VH - 2 * MARGIN) / spanV);
    var offX = (VW - spanU * s) / 2, offY = (VH - spanV * s) / 2;
    function X(u) { return offX + (u - minU) * s; }
    function Y(v) { return offY + (maxV - v) * s; }   // invertir eje vertical

    // --- Hormigón + boundary de recubrimiento (centrados en el origen) ---
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

    // --- Barras proyectadas ---
    placements.forEach(function (pl) {
      var color = _colDe(pl.tipologia);
      var rol = _rolDe(pl.tipologia);
      var pts = (pl.puntos || []).map(proj).filter(function (q) { return isFinite(q.u) && isFinite(q.v); });
      if (!pts.length) return;

      // En SECCIÓN, un cabezal longitudinal (corre por X) se proyecta a un punto
      // → se dibuja como círculo. Estribos/trabas conservan su recorrido.
      if (plano === 'seccion' && rol === 'cabezal') {
        var q0 = pts[0];
        svg.appendChild(_svgEl('circle', { cx: X(q0.u), cy: Y(q0.v), r: 4.2, fill: color }));
        return;
      }
      // Polilínea (elevación, planta, y estribos en sección).
      var d = pts.map(function (q, i) { return (i ? 'L' : 'M') + X(q.u).toFixed(1) + ',' + Y(q.v).toFixed(1); }).join(' ');
      svg.appendChild(_svgEl('path', {
        'class': 'te-bar', d: d, stroke: color,
        opacity: (rol === 'estribo' && plano === 'planta') ? 0.6 : 1
      }));
    });
  }

  function _redibujar2D(out) {
    var geo = ST.receta && ST.receta.geometria;
    _dibujarVista2D($('te_svgSeccion'), out, 'seccion', geo);
    _dibujarVista2D($('te_svgLargo'),   out, 'largo',   geo);
    _dibujarVista2D($('te_svgPlanta'),  out, 'planta',  geo);
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
    // Nunca abortar en 0×0 (canvas negro): cae a un mínimo si el layout no asentó.
    if (!w) w = 300; if (!h) h = 200;
    ST.renderer.setSize(w, h, false);
    ST.renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
    if (ST.camera) { ST.camera.aspect = w / h; ST.camera.updateProjectionMatrix(); }
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
      _resize();
      global.console && console.log('[Template Editor] 3D iniciado · placements:', (ST.ultimoOut && ST.ultimoOut.placements || []).length);
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
    // Diferir 2 frames: el modal recién mostrado ya tiene tamaño → canvas nunca 0×0.
    global.requestAnimationFrame(function () { global.requestAnimationFrame(function () {
      _iniciar3dEnVivo();
    }); });
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
