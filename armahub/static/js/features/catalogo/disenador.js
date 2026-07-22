// ArmaHub — Diseñador de figuras (5M.7/5M.8)
// Motor de geometría 2D + render SVG. Paso 1: solo visualización.
//
// MODELO DE GEOMETRÍA (campo `geometria` de una figura, JSON):
//   { "dim": "2D",
//     "tramos": [
//       { "lado": "A", "giro": 0,   "sentido": null  },   // tramo inicial (recto)
//       { "lado": "B", "giro": 45,  "sentido": "izq" },   // gira 45° a la izq antes de trazar B
//       ...
//     ] }
// - lado:    letra A..I → la longitud sale de la dimensión de la barra (dim_a..dim_i).
// - giro:    grados que gira el "rumbo" ANTES de trazar este lado (0 = seguir recto). Libre.
// - sentido: 'izq' | 'der' | null. Define el signo del giro.
//
// El motor recorre los tramos avanzando cada lado en el rumbo actual y girando
// entre tramos. Devuelve la polilínea de puntos, que el editor y el render
// comparten. (Las figuras 3D se marcarán dim:"3D" y usarán otro render; no en
// este paso.)

(function(global) {

  // ---- Motor: tramos + longitudes → puntos {x,y} ----
  // dims: mapa { A: 120, B: 80, ... } con la longitud de cada lado.
  // Si una longitud falta, usa longitud unitaria (para previsualizar la FORMA
  // sin dimensiones reales, útil en el catálogo).
  function geometriaAPuntos(geometria, dims, unidad) {
    unidad = unidad || 100;                 // largo por defecto de un lado sin dimensión
    var tramos = (geometria && geometria.tramos) || [];
    var pts = [{ x: 0, y: 0 }];
    var heading = 0;                        // rumbo actual en grados (0 = hacia la derecha)
    for (var i = 0; i < tramos.length; i++) {
      var t = tramos[i];
      // Girar el rumbo ANTES de trazar (salvo el primer tramo, que define el eje).
      if (i > 0) {
        var g = Number(t.giro) || 0;
        if (t.sentido === 'der') g = -g;    // convención: izq = +, der = −
        heading += g;
      }
      var largo = (dims && dims[t.lado] != null && !isNaN(dims[t.lado]) && Number(dims[t.lado]) > 0)
        ? Number(dims[t.lado]) : unidad;
      var rad = heading * Math.PI / 180;
      var last = pts[pts.length - 1];
      pts.push({ x: last.x + largo * Math.cos(rad), y: last.y + largo * Math.sin(rad) });
    }
    return pts;
  }

  // ---- Render: puntos → <svg> string ----
  // Escala y centra la polilínea en un viewBox fijo, con margen. Dibuja los
  // vértices y etiqueta cada lado con su letra.
  function svgDesdePuntos(pts, opts) {
    opts = opts || {};
    var W = opts.width || 320, H = opts.height || 240, pad = opts.pad || 26;
    var labels = opts.labels || [];         // etiqueta por tramo (letra del lado)
    if (!pts || pts.length < 2) {
      return '<svg width="' + W + '" height="' + H + '"><text x="' + (W/2) + '" y="' + (H/2) +
        '" text-anchor="middle" fill="#999" font-size="12">Sin geometría para dibujar</text></svg>';
    }
    // Bounding box.
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(function(p) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    });
    var bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    var scale = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    // El eje Y del SVG crece hacia abajo; invertimos para que la figura no salga espejada.
    function tx(p) { return { x: pad + (p.x - minX) * scale, y: H - (pad + (p.y - minY) * scale) }; }
    var tpts = pts.map(tx);

    var poly = tpts.map(function(p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="max-width:100%; height:auto;">';
    svg += '<polyline points="' + poly + '" fill="none" stroke="#00695c" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />';
    // Vértices.
    tpts.forEach(function(p, i) {
      var isEnd = (i === 0 || i === tpts.length - 1);
      svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (isEnd ? 4 : 3) +
        '" fill="' + (isEnd ? '#004d40' : '#4db6ac') + '" />';
    });
    // Etiquetas de lado (en el punto medio de cada segmento).
    for (var i = 1; i < tpts.length; i++) {
      var a = tpts[i - 1], b = tpts[i];
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var lbl = labels[i - 1] || '';
      if (lbl) {
        svg += '<text x="' + mx.toFixed(1) + '" y="' + (my - 4).toFixed(1) +
          '" text-anchor="middle" fill="#00695c" font-size="12" font-weight="700">' + lbl + '</text>';
      }
    }
    svg += '</svg>';
    return svg;
  }

  // ---- Conveniencia: geometría + dims → SVG completo ----
  function dibujarFigura(geometria, dims, opts) {
    opts = opts || {};
    var pts = geometriaAPuntos(geometria, dims, opts.unidad || 100);
    var labels = ((geometria && geometria.tramos) || []).map(function(t) { return t.lado; });
    var o = { labels: labels, width: opts.width, height: opts.height, pad: opts.pad };
    return svgDesdePuntos(pts, o);
  }

  // ---- Figuras de DEMOSTRACIÓN (para validar el motor en el Paso 1) ----
  // Geometrías de prueba escritas a mano hasta que exista el editor. Muestran que
  // el motor dibuja: recto, L, U, Z, con giro libre.
  var DEMOS = {
    '101A (recta)':      { dim: '2D', tramos: [ {lado:'A', giro:0} ] },
    '102A (L 90°)':      { dim: '2D', tramos: [ {lado:'A', giro:0}, {lado:'B', giro:90, sentido:'izq'} ] },
    '103A (U / gancho)': { dim: '2D', tramos: [ {lado:'A', giro:0}, {lado:'B', giro:90, sentido:'izq'}, {lado:'C', giro:90, sentido:'izq'} ] },
    '104A (marco C)':    { dim: '2D', tramos: [ {lado:'A', giro:0}, {lado:'B', giro:90, sentido:'izq'}, {lado:'C', giro:90, sentido:'izq'}, {lado:'D', giro:90, sentido:'izq'} ] },
    '102B (135°)':       { dim: '2D', tramos: [ {lado:'A', giro:0}, {lado:'B', giro:135, sentido:'izq'} ] },
    'Z (giro libre)':    { dim: '2D', tramos: [ {lado:'A', giro:0}, {lado:'B', giro:60, sentido:'izq'}, {lado:'C', giro:120, sentido:'der'} ] }
  };

  // ---- Estado / UI del sub-tab Diseñador ----
  var _figurasCat = [];   // catálogo de figuras (para el selector y su info)

  // Cargado por la caluga al abrir el diseñador.
  function disenadorInit(figuras) {
    _figurasCat = figuras || [];
    var sel = document.getElementById('disenadorFiguraSel');
    if (sel) {
      sel.innerHTML = '<option value="">— Selecciona una figura —</option>' +
        _figurasCat.map(function(f) {
          var tieneGeom = !!(f.geometria && f.geometria.tramos && f.geometria.tramos.length);
          return '<option value="' + f.codigo + '">' + f.codigo + (tieneGeom ? '' : ' (sin geometría)') + '</option>';
        }).join('');
    }
    var demo = document.getElementById('disenadorDemoSel');
    if (demo) {
      demo.innerHTML = '<option value="">— Figuras de demostración —</option>' +
        Object.keys(DEMOS).map(function(k) { return '<option value="' + k + '">' + k + '</option>'; }).join('');
    }
    var res = document.getElementById('disenadorResumen');
    if (res) {
      var conGeom = _figurasCat.filter(function(f) { return f.geometria && f.geometria.tramos && f.geometria.tramos.length; }).length;
      res.textContent = conGeom + ' de ' + _figurasCat.length + ' figuras con geometría';
    }
  }

  // Render de una figura del catálogo (si tiene geometría).
  function disenadorRender() {
    var codigo = (document.getElementById('disenadorFiguraSel') || {}).value || '';
    var wrap = document.getElementById('disenadorSvgWrap');
    var info = document.getElementById('disenadorInfo');
    if (!codigo) {
      if (wrap) wrap.innerHTML = '<span class="muted" style="font-size:12px;">Selecciona una figura para ver su dibujo.</span>';
      if (info) info.innerHTML = '—';
      return;
    }
    // Al elegir una figura del catálogo, limpiar el selector de demo.
    var demo = document.getElementById('disenadorDemoSel'); if (demo) demo.value = '';
    var f = _figurasCat.find(function(x) { return x.codigo === codigo; });
    if (!f) return;
    var tieneGeom = !!(f.geometria && f.geometria.tramos && f.geometria.tramos.length);
    if (wrap) {
      wrap.innerHTML = tieneGeom
        ? dibujarFigura(f.geometria, null, { width: 340, height: 260 })
        : '<div style="text-align:center; color:#b26a00; font-size:12px;">⚠ Esta figura aún no tiene geometría definida.<br><span class="muted">Se podrá dibujar cuando se cree su geometría en el editor (próximo paso).</span></div>';
    }
    if (info) {
      info.innerHTML =
        '<div style="font-weight:700; color:#00695c; font-size:14px; margin-bottom:6px;">' + f.codigo + '</div>' +
        '<div><b>Lados:</b> ' + ((f.parciales || []).join(', ') || '—') + '</div>' +
        '<div><b>Ángulos:</b> ' + ((f.angulos || []).length ? (f.angulos.join('°, ') + '°') : '—') + '</div>' +
        '<div><b>Radio:</b> ' + (f.radio ? 'sí' : 'no') + '</div>' +
        '<div style="margin-top:6px;"><b>Geometría:</b> ' + (tieneGeom ? (f.geometria.tramos.length + ' tramos') : '<span style="color:#b26a00;">no definida</span>') + '</div>';
    }
  }

  // Render de una figura de demostración (geometría de prueba a mano).
  function disenadorRenderDemo() {
    var key = (document.getElementById('disenadorDemoSel') || {}).value || '';
    var wrap = document.getElementById('disenadorSvgWrap');
    var info = document.getElementById('disenadorInfo');
    if (!key || !DEMOS[key]) return;
    var sel = document.getElementById('disenadorFiguraSel'); if (sel) sel.value = '';
    var geom = DEMOS[key];
    if (wrap) wrap.innerHTML = dibujarFigura(geom, null, { width: 340, height: 260 });
    if (info) {
      info.innerHTML =
        '<div style="font-weight:700; color:#00695c; font-size:14px; margin-bottom:6px;">' + key + '</div>' +
        '<div class="muted" style="font-size:11px; margin-bottom:6px;">Geometría de demostración (motor de prueba).</div>' +
        '<div><b>Tramos:</b></div>' +
        '<ol style="margin:4px 0 0 16px; padding:0; font-size:11px;">' +
        geom.tramos.map(function(t) {
          var giro = t.giro ? (t.giro + '° ' + (t.sentido || 'izq')) : 'recto';
          return '<li>Lado ' + t.lado + ' · ' + giro + '</li>';
        }).join('') +
        '</ol>';
    }
  }

  // Exponer al scope global (para onclick/onchange y la caluga).
  global.disenadorInit = disenadorInit;
  global.disenadorRender = disenadorRender;
  global.disenadorRenderDemo = disenadorRenderDemo;
  // Motor reutilizable por el futuro editor.
  global.disenadorMotor = { geometriaAPuntos: geometriaAPuntos, svgDesdePuntos: svgDesdePuntos, dibujarFigura: dibujarFigura };
})(window);
