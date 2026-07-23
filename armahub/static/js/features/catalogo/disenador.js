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
    // 5M.8.6: si la geometría trae PUNTOS reales (dibujados), usarlos tal cual →
    // render idéntico al lienzo (sin rotar). Fallback: reconstruir desde tramos.
    if (geometria && geometria.puntos && geometria.puntos.length >= 2) {
      return geometria.puntos.map(function(p) { return { x: p.x, y: p.y }; });
    }
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
    // Etiquetas de lado, desplazadas perpendicular a la línea (no encima).
    for (var i = 1; i < tpts.length; i++) {
      var a = tpts[i - 1], b = tpts[i];
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var lbl = labels[i - 1] || '';
      if (lbl) {
        var svx = b.x - a.x, svy = b.y - a.y; var sl = Math.sqrt(svx*svx + svy*svy) || 1;
        var lox = mx - (svy/sl) * 10, loy = my + (svx/sl) * 10;
        svg += '<text x="' + lox.toFixed(1) + '" y="' + (loy + 3).toFixed(1) +
          '" text-anchor="middle" fill="#00695c" font-size="11" font-weight="700">' + lbl + '</text>';
      }
    }
    // 5M.8.6: etiquetas de ÁNGULO en la bisectriz de cada vértice interno (α1…;
    // 90° gris). Solo si opts.angulos !== false (permite render limpio si se quiere).
    if (opts.angulos !== false) {
      var nAlfa = 0;
      for (var j = 1; j < tpts.length - 1; j++) {
        // Ángulo de doblez en el vértice j (sobre los puntos ORIGINALES, no escalados).
        var q0 = pts[j - 1], q1 = pts[j], q2 = pts[j + 1];
        var a1 = Math.atan2(q1.y - q0.y, q1.x - q0.x);
        var a2 = Math.atan2(q2.y - q1.y, q2.x - q1.x);
        var dd = (a2 - a1) * 180 / Math.PI; while (dd > 180) dd -= 360; while (dd < -180) dd += 360;
        var giro = Math.abs(Math.round(dd));
        if (giro === 0) continue;
        var txt, col;
        if (giro === 90) { txt = '90°'; col = '#bbb'; }
        else { nAlfa++; txt = 'α' + nAlfa; col = '#c62828'; }
        // Bisectriz en coords escaladas (tpts).
        var tv = tpts[j], ta = tpts[j - 1], tb = tpts[j + 1];
        var w1x = ta.x - tv.x, w1y = ta.y - tv.y; var m1 = Math.sqrt(w1x*w1x + w1y*w1y) || 1;
        var w2x = tb.x - tv.x, w2y = tb.y - tv.y; var m2 = Math.sqrt(w2x*w2x + w2y*w2y) || 1;
        var cbx = w1x/m1 + w2x/m2, cby = w1y/m1 + w2y/m2; var cbl = Math.sqrt(cbx*cbx + cby*cby);
        if (cbl < 0.15) { cbx = -w1y/m1; cby = w1x/m1; cbl = 1; }
        var aox = tv.x + (cbx/cbl) * 14, aoy = tv.y + (cby/cbl) * 14;
        svg += '<text x="' + aox.toFixed(1) + '" y="' + (aoy + 3).toFixed(1) + '" text-anchor="middle" fill="' + col + '" font-size="10" font-weight="700">' + txt + '</text>';
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

  // ==========================================================================
  // EDITOR POR LIENZO — crear una figura NUEVA dibujando con clicks (5M.8)
  // El usuario hace click en un lienzo; los puntos se pegan (snap) a ángulos
  // limpios; cada segmento se vuelve un LADO (A, B, C…). El nombre lo pone el
  // usuario (no se autogenera). Salida = geometría (tramos) → catálogo.
  //
  // MODELO ampliable (preparado, NO todo dibujado aún):
  //   - Ø real de la barra → grosor del trazo (trivial en 2D, se activa después).
  //   - radio_doblado → esquinas redondeadas (arco por vértice; futuro).
  //   - dim:"3D" → render TubeGeometry (Three.js on-demand; futuro).
  //   - La geometría es la VERDAD; el nombre es etiqueta (multi-catálogo).
  // ==========================================================================

  var GRID = 40;                 // paso de la grilla del lienzo (px)
  var SNAP_ANG = 45;             // snap de ángulo (grados) — ángulos limpios
  var LETRAS = 'ABCDEFGHI'.split('');

  // Estado del editor.
  var _puntos = [];              // vértices clickeados en el lienzo {x,y} (coord lienzo)
  var _labels = [];              // letra asignada a cada LADO (segmento). editable.
  var _figurasCat = [];          // catálogo (para galería/edición/homologación)
  var _hoverPt = null;           // punto de previsualización bajo el cursor (con snap)
  var _dibujando = true;         // ¿rubber band activo? false = figura terminada
  var _editando = null;          // código de figura que se está EDITANDO (o null = nueva)

  function disenadorInit(figuras) {
    if (figuras) _figurasCat = figuras;
    var res = document.getElementById('disenadorResumen');
    if (res) {
      var conGeom = _figurasCat.filter(function(f) { return f.geometria && f.geometria.tramos && f.geometria.tramos.length; }).length;
      res.textContent = conGeom + ' de ' + _figurasCat.length + ' figuras con render';
    }
    _redibujarLienzo();
    _redibujarPanel();
    _redibujarGaleria();
  }

  // Termina el dibujo: apaga el rubber band (deja de proponer el próximo lado).
  global.disenadorTerminar = function() {
    _dibujando = false;
    _hoverPt = null;
    _redibujarLienzo();
    _actualizarBotonTerminar();
  };

  function _actualizarBotonTerminar() {
    var b = document.getElementById('disenadorBtnTerminar');
    if (b) b.style.display = (_dibujando && _puntos.length >= 2) ? '' : 'none';
    var r = document.getElementById('disenadorBtnRetomar');
    if (r) r.style.display = (!_dibujando && _puntos.length >= 1) ? '' : 'none';
  }

  // Retoma el dibujo (vuelve a activar el rubber band para agregar más lados).
  global.disenadorRetomar = function() {
    _dibujando = true;
    _redibujarLienzo();
    _actualizarBotonTerminar();
  };

  // ---- Snap: pega un punto a la grilla y fuerza ángulo limpio desde el previo ----
  function _snap(x, y) {
    if (_puntos.length === 0) {
      // Primer punto: solo a la grilla.
      return { x: Math.round(x / GRID) * GRID, y: Math.round(y / GRID) * GRID };
    }
    // Puntos siguientes: ángulo limpio respecto al último punto + largo a la grilla.
    var last = _puntos[_puntos.length - 1];
    var dx = x - last.x, dy = y - last.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    // Si el cursor está casi encima del último punto, aún así proponer un tramo
    // hacia la derecha (nunca colapsar → el click SIEMPRE engancha un lado).
    var ang = (dist < GRID / 2) ? 0 : Math.atan2(dy, dx) * 180 / Math.PI;
    var angSnap = Math.round(ang / SNAP_ANG) * SNAP_ANG;    // ángulo limpio
    // Largo a la grilla, mínimo 1 GRID (avance garantizado).
    var distSnap = Math.max(GRID, Math.round(dist / GRID) * GRID);
    var rad = angSnap * Math.PI / 180;
    return { x: last.x + distSnap * Math.cos(rad), y: last.y + distSnap * Math.sin(rad) };
  }

  // ---- Puntos del lienzo → geometría (tramos con lado + giro + sentido) ----
  // Deriva, por cada segmento, el ángulo de doblez respecto al anterior.
  function _puntosAGeometria() {
    var tramos = [];
    for (var i = 1; i < _puntos.length; i++) {
      var lado = _labels[i - 1] || LETRAS[i - 1] || ('L' + i);
      if (i === 1) {
        tramos.push({ lado: lado, giro: 0, sentido: null });
      } else {
        var p0 = _puntos[i - 2], p1 = _puntos[i - 1], p2 = _puntos[i];
        var a1 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        var a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        var d = (a2 - a1) * 180 / Math.PI;
        while (d > 180) d -= 360; while (d < -180) d += 360;
        // En coords de pantalla el Y crece hacia abajo; el motor usa Y hacia arriba.
        // El giro es el mismo valor absoluto; el sentido se normaliza para el motor.
        var giro = Math.abs(Math.round(d));
        var sentido = (d < 0) ? 'izq' : 'der';   // pantalla: horario = der
        tramos.push({ lado: lado, giro: giro, sentido: sentido });
      }
    }
    // 5M.8.6: guardar también los PUNTOS reales (normalizados al primer punto y
    // con Y invertida a "hacia arriba"), para que el render reproduzca la figura
    // IDÉNTICA a como se dibujó (no reconstruida desde heading=0, que rotaba).
    var p0 = _puntos[0] || { x: 0, y: 0 };
    var puntos = _puntos.map(function(p) { return { x: p.x - p0.x, y: -(p.y - p0.y) }; });
    return { dim: '2D', tramos: tramos, puntos: puntos };
  }

  // ---- Longitudes de cada lado desde los puntos del lienzo (en px de grilla) ----
  function _largos() {
    var out = {};
    for (var i = 1; i < _puntos.length; i++) {
      var lado = _labels[i - 1] || LETRAS[i - 1];
      var dx = _puntos[i].x - _puntos[i - 1].x, dy = _puntos[i].y - _puntos[i - 1].y;
      out[lado] = Math.round(Math.sqrt(dx * dx + dy * dy) / GRID);   // en unidades de grilla
    }
    return out;
  }

  // ---- Etiquetas de ángulo por vértice interno (α1, α2… solo para especiales) ----
  // Convención aSa: un doblez de 90° NO cuenta como α (queda implícito). Solo los
  // ángulos ≠90 reciben número α, en orden. Devuelve { indicePunto: {texto, esAlfa} }
  // donde indicePunto es la posición del vértice en _puntos (1..n-1).
  function _etiquetasAngulos() {
    var out = {};
    var nAlfa = 0;
    for (var i = 1; i < _puntos.length - 1; i++) {   // vértices internos
      var p0 = _puntos[i - 1], p1 = _puntos[i], p2 = _puntos[i + 1];
      var a1 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      var a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      var d = (a2 - a1) * 180 / Math.PI;
      while (d > 180) d -= 360; while (d < -180) d += 360;
      var giro = Math.abs(Math.round(d));
      if (giro === 0) continue;                       // sin doblez → nada
      if (giro === 90) {
        out[i] = { texto: '90°', esAlfa: false };     // implícito, no es α
      } else {
        nAlfa++;
        out[i] = { texto: 'α' + nAlfa + ' (' + giro + '°)', esAlfa: true };
      }
    }
    return out;
  }

  var CW = 420, CH = 320;   // dimensiones del lienzo
  var _svgCreado = false;

  // Crea el SVG del lienzo UNA sola vez (grilla + rect capturador de eventos + una
  // capa <g> dinámica). Los listeners van con addEventListener sobre el SVG, que
  // NO se recrea → el click nunca cae sobre un nodo destruido (causa del bug).
  function _crearLienzo() {
    var wrap = document.getElementById('disenadorLienzo');
    if (!wrap) return;
    var s = '<svg id="disenadorSvgCanvas" width="' + CW + '" height="' + CH + '" ' +
      'style="background:#fff; border-radius:6px; cursor:crosshair; touch-action:none; max-width:100%;">';
    // Grilla (estática).
    for (var gx = 0; gx <= CW; gx += GRID) s += '<line x1="' + gx + '" y1="0" x2="' + gx + '" y2="' + CH + '" stroke="#eee" stroke-width="1"/>';
    for (var gy = 0; gy <= CH; gy += GRID) s += '<line x1="0" y1="' + gy + '" x2="' + CW + '" y2="' + gy + '" stroke="#eee" stroke-width="1"/>';
    // Rect transparente que captura mouse en toda el área.
    s += '<rect x="0" y="0" width="' + CW + '" height="' + CH + '" fill="transparent"/>';
    // Capa dinámica (polilínea, preview, vértices, etiquetas).
    s += '<g id="disenadorCapa"></g>';
    s += '</svg>';
    wrap.innerHTML = s;
    var svg = document.getElementById('disenadorSvgCanvas');
    if (svg) {
      svg.addEventListener('mousemove', global.disenadorHover);
      svg.addEventListener('mouseleave', global.disenadorHoverOut);
      svg.addEventListener('click', global.disenadorClick);
    }
    _svgCreado = true;
  }

  // Redibuja SOLO la capa dinámica (no toca el SVG raíz ni la grilla ni el rect
  // de eventos). Así un mousemove no destruye el nodo sobre el que caerá el click.
  function _redibujarLienzo() {
    if (!_svgCreado || !document.getElementById('disenadorSvgCanvas')) _crearLienzo();
    var capa = document.getElementById('disenadorCapa');
    if (!capa) return;
    var s = '';
    if (_puntos.length >= 2) {
      var poly = _puntos.map(function(p) { return p.x + ',' + p.y; }).join(' ');
      s += '<polyline points="' + poly + '" fill="none" stroke="#00695c" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    if (_dibujando && _puntos.length >= 1 && _hoverPt) {
      var lp = _puntos[_puntos.length - 1];
      s += '<line x1="' + lp.x + '" y1="' + lp.y + '" x2="' + _hoverPt.x + '" y2="' + _hoverPt.y + '" stroke="#4db6ac" stroke-width="2" stroke-dasharray="5,4"/>';
      s += '<circle cx="' + _hoverPt.x + '" cy="' + _hoverPt.y + '" r="4" fill="#4db6ac" opacity="0.6"/>';
    }
    _puntos.forEach(function(p, i) {
      var isEnd = (i === 0 || i === _puntos.length - 1);
      s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (isEnd ? 5 : 4) + '" fill="' + (isEnd ? '#004d40' : '#00897b') + '"/>';
    });
    for (var i = 1; i < _puntos.length; i++) {
      var a = _puntos[i - 1], b = _puntos[i];
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var lbl = _labels[i - 1] || LETRAS[i - 1];
      // Desplazar la etiqueta PERPENDICULAR a la línea (hacia afuera) para que no
      // quede tapada por la barra. Normal unitaria del segmento × offset.
      var vx = b.x - a.x, vy = b.y - a.y;
      var len = Math.sqrt(vx * vx + vy * vy) || 1;
      var off = 15;
      var lx = mx - (vy / len) * off;   // normal = (-vy, vx)
      var ly = my + (vx / len) * off;
      // Fondo blanco sutil detrás del texto para legibilidad sobre la grilla.
      s += '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="9" fill="#fff" opacity="0.85"/>';
      s += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '" text-anchor="middle" fill="#00695c" font-size="13" font-weight="700">' + lbl + '</text>';
    }
    // Etiquetas de ÁNGULO en cada vértice interno, ubicadas en la BISECTRIZ del
    // ángulo (entre los dos segmentos que forman el vértice), pegadas al vértice.
    var angs = _etiquetasAngulos();
    Object.keys(angs).forEach(function(idx) {
      idx = Number(idx);
      var v = _puntos[idx], pa = _puntos[idx - 1], pb = _puntos[idx + 1];
      var info = angs[idx];
      var color = info.esAlfa ? '#c62828' : '#999';   // α especial en rojo, 90° gris
      // Vectores unitarios desde el vértice hacia cada segmento vecino.
      var u1x = pa.x - v.x, u1y = pa.y - v.y; var l1 = Math.sqrt(u1x*u1x + u1y*u1y) || 1;
      var u2x = pb.x - v.x, u2y = pb.y - v.y; var l2 = Math.sqrt(u2x*u2x + u2y*u2y) || 1;
      var bx = u1x/l1 + u2x/l2, by = u1y/l1 + u2y/l2;
      var bl = Math.sqrt(bx*bx + by*by);
      // Si los segmentos son casi opuestos (bisectriz ~0), usar la perpendicular.
      if (bl < 0.15) { bx = -u1y/l1; by = u1x/l1; bl = 1; }
      var off = 20;
      var lx = v.x + (bx/bl) * off, ly = v.y + (by/bl) * off;
      s += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '" text-anchor="middle" fill="' + color + '" font-size="12" font-weight="700">' + info.texto + '</text>';
    });
    capa.innerHTML = s;
  }

  // ---- Coordenada del evento relativa al SVG ----
  function _coord(ev) {
    var svg = document.getElementById('disenadorSvgCanvas');
    if (!svg) return null;
    var r = svg.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  global.disenadorHover = function(ev) {
    if (!_dibujando) return;         // figura terminada → sin rubber band
    var c = _coord(ev); if (!c) return;
    _hoverPt = _snap(c.x, c.y);
    _redibujarLienzo();
  };
  global.disenadorHoverOut = function() { _hoverPt = null; _redibujarLienzo(); };

  global.disenadorClick = function(ev) {
    if (!_dibujando) return;         // terminado → los clicks no agregan lados
    var c = _coord(ev); if (!c) return;
    var p = _snap(c.x, c.y);
    // Evitar duplicar el mismo punto.
    var last = _puntos[_puntos.length - 1];
    if (last && Math.abs(last.x - p.x) < 1 && Math.abs(last.y - p.y) < 1) return;
    _puntos.push(p);
    if (_puntos.length >= 2) _labels[_puntos.length - 2] = LETRAS[_puntos.length - 2] || ('L' + (_puntos.length - 1));
    _redibujarLienzo();
    _redibujarPanel();
    _actualizarBotonTerminar();
  };

  global.disenadorDeshacer = function() {
    if (_puntos.length === 0) return;
    _puntos.pop();
    _labels = _labels.slice(0, Math.max(0, _puntos.length - 1));
    _redibujarLienzo();
    _redibujarPanel();
  };

  global.disenadorLimpiar = function() {
    if (_puntos.length && !confirm('¿Borrar el dibujo actual?')) return;
    _puntos = []; _labels = []; _hoverPt = null;
    _dibujando = true; _editando = null;
    var nb = document.getElementById('disenadorNombre'); if (nb) nb.value = '';
    _redibujarLienzo();
    _redibujarPanel();
    _actualizarBotonTerminar();
  };

  // Cambiar la LETRA asignada a un lado (requerimiento: reasignar A/B/C…).
  global.disenadorSetLetra = function(idx, valor) {
    valor = (valor || '').trim().toUpperCase();
    if (valor) _labels[idx] = valor;
    _redibujarLienzo();
    _redibujarPanel();
  };

  // ---- Panel lateral de PARÁMETROS en vivo (el resumen que gustó) ----
  function _redibujarPanel() {
    var cont = document.getElementById('disenadorPanel');
    if (!cont) return;
    if (_puntos.length < 2) {
      cont.innerHTML = '<div class="muted" style="font-size:12px;">Haz click en el lienzo para trazar el primer lado. Cada click agrega un lado; el ángulo se ajusta a 45/90/135°.</div>';
      return;
    }
    var geo = _puntosAGeometria();
    var largos = _largos();
    var ladosUsados = geo.tramos.map(function(t) { return t.lado; });
    var angulos = geo.tramos.filter(function(t, i) { return i > 0; }).map(function(t) { return t.giro; });

    var html = '<div style="font-weight:700; color:#00695c; margin-bottom:8px;">Parámetros de la figura</div>';
    html += '<table style="width:100%; font-size:12px; border-collapse:collapse;">';
    html += '<tr style="color:#666; text-align:left;"><th style="padding:2px 4px;">Lado</th><th style="padding:2px 4px;">Largo (grilla)</th><th style="padding:2px 4px;">Ángulo prev.</th></tr>';
    geo.tramos.forEach(function(t, i) {
      html += '<tr style="border-top:1px solid #eee;">' +
        '<td style="padding:2px 4px;"><input value="' + t.lado + '" maxlength="2" onchange="disenadorSetLetra(' + i + ', this.value)" style="width:34px; font-weight:700; color:#00695c; text-align:center; font-size:12px;" /></td>' +
        '<td style="padding:2px 4px;">' + (largos[t.lado] || '—') + '</td>' +
        '<td style="padding:2px 4px;">' + (i === 0 ? '—' : (t.giro + '° ' + (t.sentido || ''))) + '</td>' +
        '</tr>';
    });
    html += '</table>';
    // Ángulos como α (solo especiales ≠90; los 90° son implícitos, convención aSa).
    var especiales = angulos.filter(function(g) { return g !== 90 && g !== 0; });
    var alfaTxt = especiales.length
      ? especiales.map(function(g, k) { return 'α' + (k + 1) + '=' + g + '°'; }).join(', ')
      : '— (todos 90° o rectos)';
    html += '<div style="margin-top:8px; font-size:12px; color:#444;">' +
      '<div><b>Lados:</b> ' + ladosUsados.join(', ') + '</div>' +
      '<div><b>Ángulos α (≠90°):</b> ' + alfaTxt + '</div>' +
      '<div><b>N° de lados:</b> ' + ladosUsados.length + '</div>' +
      (especiales.length > 4 ? '<div style="color:#c62828; margin-top:4px;">⚠ ' + especiales.length + ' ángulos especiales — el sistema soporta máx. 4 (α1-α4).</div>' : '') +
      '</div>';
    cont.innerHTML = html;
  }

  // ---- Guardar la figura dibujada (crear en el catálogo con nombre del usuario) ----
  global.disenadorGuardar = async function() {
    var nombre = ((document.getElementById('disenadorNombre') || {}).value || '').trim();
    if (!nombre) { alert('Ponle un nombre a la figura antes de guardar.'); return; }
    if (_puntos.length < 2) { alert('Dibuja al menos un lado (dos puntos) antes de guardar.'); return; }
    var geo = _puntosAGeometria();
    var parciales = geo.tramos.map(function(t) { return t.lado; });
    // Convención aSa: solo los ángulos ESPECIALES (≠90 y ≠0) van a `angulos`.
    // Un doblez de 90° es implícito (no es α1-α4).
    var angulos = geo.tramos
      .map(function(t) { return t.giro; })
      .filter(function(g) { return g !== 90 && g !== 0; });
    if (angulos.length > 4) {
      alert('Esta figura tiene ' + angulos.length + ' ángulos especiales (≠90°), pero el sistema soporta máximo 4 (α1-α4).\n\nAjusta la figura antes de guardar.');
      return;
    }
    var payload = { codigo: nombre, parciales: parciales, angulos: angulos, radio: false, geometria: geo };
    // Endpoint de creación (se implementa en backend). Por ahora avisamos si no existe.
    try {
      var res = await fetch(apiUrl('/figuras-catalogo'), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, (typeof authHeaders === 'function' ? authHeaders() : {})),
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        if (typeof showToast === 'function') showToast('Figura "' + nombre + '" guardada en el catálogo', 'success');
        // Limpiar el lienzo y refrescar el catálogo/galería con lo recién guardado.
        _puntos = []; _labels = []; _hoverPt = null; _dibujando = true; _editando = null;
        var nb = document.getElementById('disenadorNombre'); if (nb) nb.value = '';
        await _recargarCatalogo();
        _redibujarLienzo(); _redibujarPanel(); _actualizarBotonTerminar();
      } else {
        var d = await res.json().catch(function() { return {}; });
        alert('No se pudo guardar: ' + (d.detail || res.status));
      }
    } catch (e) {
      alert('Error al guardar la figura: ' + e.message);
    }
  };

  // Recarga el catálogo desde el backend (tras guardar/borrar) y refresca galería.
  async function _recargarCatalogo() {
    try {
      var data = await apiGet('/figuras-catalogo');
      _figurasCat = (data && data.figuras) || _figurasCat;
    } catch (e) {}
    disenadorInit();   // refresca resumen + galería
  }

  // ---- GALERÍA de figuras YA dibujadas (con render): editar / eliminar ----
  function _redibujarGaleria() {
    var cont = document.getElementById('disenadorGaleria');
    if (!cont) return;
    var conGeom = _figurasCat.filter(function(f) { return f.geometria && f.geometria.tramos && f.geometria.tramos.length; });
    if (conGeom.length === 0) {
      cont.innerHTML = '<div class="muted" style="font-size:12px;">Aún no hay figuras dibujadas. Las que guardes aparecerán aquí para editarlas o borrarlas.</div>';
      return;
    }
    cont.innerHTML = conGeom.map(function(f) {
      var svg = dibujarFigura(f.geometria, null, { width: 90, height: 72, pad: 12 });
      var cod = String(f.codigo).replace(/'/g, "\\'");
      return '<div style="border:1px solid #e0e0e0; border-radius:6px; padding:6px; text-align:center; background:#fff; position:relative;">' +
        '<div style="cursor:pointer;" title="Editar" onclick="disenadorEditar(\'' + cod + '\')">' + svg + '</div>' +
        '<div style="font-size:11px; font-weight:700; color:#00695c; margin-top:2px;">' + f.codigo + '</div>' +
        '<button title="Borrar" onclick="disenadorEliminar(\'' + cod + '\')" style="position:absolute; top:2px; right:2px; width:18px; height:18px; line-height:1; padding:0; border:none; background:#fdecea; color:#c62828; border-radius:4px; cursor:pointer; font-size:12px;">✕</button>' +
        '</div>';
    }).join('');
  }

  // Carga una figura del catálogo al lienzo para EDITARLA. Convierte su geometría
  // a puntos del lienzo (misma dirección de armado; se escala a la grilla).
  global.disenadorEditar = function(codigo) {
    var f = _figurasCat.find(function(x) { return x.codigo === codigo; });
    if (!f || !f.geometria || !f.geometria.tramos) return;
    // geometriaAPuntos usa Y hacia arriba; el lienzo usa Y hacia abajo → invertir Y.
    var pts = geometriaAPuntos(f.geometria, null, GRID);   // largo unidad = 1 grilla
    // Centrar en el lienzo (offset simple).
    var offX = 120, offY = 140;
    _puntos = pts.map(function(p) { return { x: Math.round(p.x) + offX, y: offY - Math.round(p.y) }; });
    _labels = f.geometria.tramos.map(function(t) { return t.lado; });
    _dibujando = false;    // cargada = terminada (sin rubber band); "Retomar" para seguir
    _editando = codigo;
    _hoverPt = null;
    var nb = document.getElementById('disenadorNombre'); if (nb) nb.value = f.codigo;
    _redibujarLienzo(); _redibujarPanel(); _actualizarBotonTerminar();
    if (typeof showToast === 'function') showToast('Editando "' + codigo + '". Usa "Retomar dibujo" para agregar lados.', 'info');
  };

  // Elimina una figura del catálogo (solo admin; confirma).
  global.disenadorEliminar = async function(codigo) {
    if (!confirm('¿Eliminar la figura "' + codigo + '" del catálogo?\n\nEsto la quita del catálogo Armacero. No se puede deshacer.')) return;
    try {
      var res = await fetch(apiUrl('/figuras-catalogo/' + encodeURIComponent(codigo)), {
        method: 'DELETE',
        headers: (typeof authHeaders === 'function' ? authHeaders() : {})
      });
      if (res.ok) {
        if (typeof showToast === 'function') showToast('Figura "' + codigo + '" eliminada', 'success');
        await _recargarCatalogo();
      } else {
        var d = await res.json().catch(function() { return {}; });
        alert('No se pudo eliminar: ' + (d.detail || res.status));
      }
    } catch (e) {
      alert('Error al eliminar: ' + e.message);
    }
  };

  // Exponer al scope global.
  global.disenadorInit = disenadorInit;
  // Motor reutilizable (SVG 2D; base para 3D TubeGeometry y export BVBS futuros).
  global.disenadorMotor = { geometriaAPuntos: geometriaAPuntos, svgDesdePuntos: svgDesdePuntos, dibujarFigura: dibujarFigura, puntosAGeometria: _puntosAGeometria };
})(window);
