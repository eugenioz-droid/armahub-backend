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

  // Registro de tipos de etiqueta (etiquetas.js). Se resuelve en runtime (la carga
  // de scripts es paralela) para no depender del orden. Todas las decisiones sobre
  // "qué es cada tipo de etiqueta" salen de aquí, no de cadenas if (tipo===...).
  function REG() { return global.EtiquetasRegistro; }

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
    var W = opts.width || 320, H = opts.height || 240;
    // Pad PROPORCIONAL al tamaño del SVG (no fijo): ~14% del lado menor, acotado.
    // Un pad fijo grande achicaba la figura en miniaturas pequeñas. Deja aire para
    // las etiquetas sin comerse el espacio.
    var pad = opts.pad != null ? opts.pad : Math.max(6, Math.min(W, H) * 0.14);
    var labels = opts.labels || [];         // etiqueta por tramo (letra del lado)
    if (!pts || pts.length < 2) {
      return '<svg width="' + W + '" height="' + H + '"><text x="' + (W/2) + '" y="' + (H/2) +
        '" text-anchor="middle" fill="#999" font-size="12">Sin geometría para dibujar</text></svg>';
    }
    // Bounding box: incluye los puntos de la figura Y las etiquetas manuales, para
    // que las letras/cotas fuera del contorno NO queden cortadas y todo salga centrado.
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function _acum(x, y) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    pts.forEach(function(p) { _acum(p.x, p.y); });
    (opts.etiquetas || []).forEach(function(e) {
      if (e.x != null && e.y != null) _acum(e.x, e.y);        // texto (letra/ángulo)
      if (e.x1 != null) { _acum(e.x1, e.y1); _acum(e.x2, e.y2); }  // cota/radio/diámetro
      // arco (seg/lado): sus extremos ya están en pts, no aporta límites nuevos.
    });
    var bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    // Escalar para llenar el marco (menos el pad), y luego CENTRAR la figura en el
    // SVG (no anclarla a la esquina). Así queda centrada y aprovecha el espacio.
    var scale = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    var fw = bw * scale, fh = bh * scale;         // tamaño final de la figura
    var offX = (W - fw) / 2, offY = (H - fh) / 2; // centrado
    // El eje Y del SVG crece hacia abajo; invertimos para que no salga espejada.
    function tx(p) { return { x: offX + (p.x - minX) * scale, y: H - (offY + (p.y - minY) * scale) }; }
    var tpts = pts.map(tx);

    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="max-width:100%; height:auto;">';
    svg += '<defs>' +
      '<marker id="disArrowEnd" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#1565c0"/></marker>' +
      '<marker id="disArrowStart" markerWidth="9" markerHeight="9" refX="0" refY="3" orient="auto"><path d="M7,0 L0,3 L7,6 Z" fill="#1565c0"/></marker>' +
      '</defs>';
    // Línea principal: path con L (rectos) y A (arcos), usando tipos/radios de la
    // geometría (radios escalados al mismo factor que los puntos).
    var tiposEsc = opts.tipos_seg || [];
    var radiosEsc = (opts.radios_seg || []).map(function(r) { return (r || 0) * scale; });
    // Sweep directo: tx() ya invierte la Y, así que el arco se ve al MISMO lado
    // que en el lienzo sin invertir el sweep (invertirlo lo dejaba al revés).
    var sweepsEsc = (opts.sweeps_seg || []).map(function(sw) { return (sw != null ? sw : 1); });
    svg += '<path d="' + _pathDesdePuntos(tpts, tiposEsc, radiosEsc, sweepsEsc) + '" fill="none" stroke="#00695c" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />';
    // Vértices (nodos pequeños para no recargar la miniatura).
    tpts.forEach(function(p, i) {
      var isEnd = (i === 0 || i === tpts.length - 1);
      svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (isEnd ? 2.5 : 2) +
        '" fill="' + (isEnd ? '#004d40' : '#4db6ac') + '" />';
    });
    // Etiquetas de lado AUTOMÁTICAS, desplazadas perpendicular a la línea (no encima).
    // Se pueden suprimir con opts.labels_auto === false (modo etiqueta-manda: las
    // letras las pone el usuario a mano, no se muestran las automáticas).
    if (opts.labels_auto !== false) {
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
    }
    // 5M.8.6: etiquetas de ÁNGULO en la bisectriz de cada vértice interno (α1…;
    // 90° gris). Se suprimen con opts.angulos===false o en modo etiqueta-manda
    // (opts.labels_auto===false: los ángulos los pone el usuario a mano).
    if (opts.angulos !== false && opts.labels_auto !== false) {
      var nAlfa = 0;
      for (var j = 1; j < tpts.length - 1; j++) {
        // Saltar vértices adyacentes a un arco (la curva es el doblez, no un ángulo).
        if (tiposEsc[j - 1] === 'arco' || tiposEsc[j] === 'arco') continue;
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
    // Etiquetas MANUALES mapeadas con tx() al render. Mismas funciones de dibujo
    // que el lienzo (registro), con los tamaños/estilos propios del render.
    var oR = { sw: 1.2, tope: 4, dash: '3,2', fs: 11, halo: 2.5, dy: 3 };
    (opts.etiquetas || []).forEach(function(e) {
      if (REG().esArco(e.tipo)) {
        // Cota de arco concéntrica al segmento e.seg (mismo radio/sweep escalados).
        if (e.seg == null || !tpts[e.seg] || !tpts[e.seg + 1]) return;
        var pa = tpts[e.seg], pb = tpts[e.seg + 1];
        svg += REG().dibujarArco(pa, pb, radiosEsc[e.seg], sweepsEsc[e.seg], e.lado, 7 * scale, oR);
        return;
      }
      if (REG().esLinea(e.tipo)) {
        var p1 = tx({x:e.x1, y:e.y1}), p2 = tx({x:e.x2, y:e.y2});
        svg += (e.tipo === 'cota')
          ? REG().dibujarCota(p1, p2, oR)
          : REG().dibujarRadioDiam(e.tipo, p1, p2, oR);
        return;
      }
      // Texto (letra/ángulo).
      svg += REG().dibujarTexto(e.tipo, e.texto, tx({x:e.x, y:e.y}), oR);
    });
    svg += '</svg>';
    return svg;
  }

  // ---- Conveniencia: geometría + dims → SVG completo ----
  function dibujarFigura(geometria, dims, opts) {
    opts = opts || {};
    var pts = geometriaAPuntos(geometria, dims, opts.unidad || 100);
    var labels = ((geometria && geometria.tramos) || []).map(function(t) { return t.lado; });
    // Tipos/radios de segmento: del array directo o derivados de tramos[].tipo.
    var tipos = (geometria && geometria.tipos_seg) ||
      (((geometria && geometria.tramos) || []).map(function(t) { return t.tipo || 'recto'; }));
    var radios = (geometria && geometria.radios_seg) ||
      (((geometria && geometria.tramos) || []).map(function(t) { return t.radio || 0; }));
    var sweeps = (geometria && geometria.sweeps_seg) ||
      (((geometria && geometria.tramos) || []).map(function(t) { return (t.sweep != null ? t.sweep : 1); }));
    // labels_auto: si la geometría es "etiqueta-manda", suprimir letras/ángulos
    // automáticos también en galería/catálogo (aunque no pasen el flag explícito).
    var labelsAuto = opts.labels_auto;
    if (labelsAuto === undefined && geometria && geometria.etiquetas_manda) labelsAuto = false;
    var o = { labels: labels, width: opts.width, height: opts.height, pad: opts.pad,
              angulos: opts.angulos, labels_auto: labelsAuto,
              tipos_seg: tipos, radios_seg: radios, sweeps_seg: sweeps,
              etiquetas: (geometria && geometria.etiquetas) || [] };
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

  // El sistema (aSa) pide el ÁNGULO INTERNO del vértice (el suplementario del
  // giro/desviación que el motor calcula). interno = 180 − giro. 90 queda 90.
  function _anguloInterno(giro) { return 180 - (Number(giro) || 0); }

  // Construye el atributo `d` de un <path> desde puntos, usando L (línea) para
  // segmentos rectos y A (arco) para curvos. tipos/radios son paralelos a los
  // segmentos (índice = i-1 para el segmento entre punto i-1 e i).
  function _pathDesdePuntos(pts, tipos, radios, sweeps) {
    if (!pts || pts.length < 1) return '';
    var d = 'M ' + pts[0].x + ' ' + pts[0].y;
    for (var i = 1; i < pts.length; i++) {
      var tipo = (tipos && tipos[i - 1]) || 'recto';
      if (tipo === 'arco') {
        var a = pts[i - 1], b = pts[i];
        var cuerda = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y)) || 1;
        var r = (radios && radios[i - 1]) ? radios[i - 1] : cuerda * 0.75;
        r = Math.max(r, cuerda / 2 + 0.5);
        // sweep 0/1 define hacia qué lado curva (invertible por el usuario).
        var sw = (sweeps && sweeps[i - 1] != null) ? sweeps[i - 1] : 1;
        d += ' A ' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 0 ' + sw + ' ' + b.x + ' ' + b.y;
      } else {
        d += ' L ' + pts[i].x + ' ' + pts[i].y;
      }
    }
    return d;
  }

  // Estado del editor.
  var _puntos = [];              // vértices clickeados en el lienzo {x,y} (coord lienzo)
  var _labels = [];              // letra asignada a cada LADO (segmento). editable.
  var _figurasCat = [];          // catálogo (para galería/edición/homologación)
  var _hoverPt = null;           // punto de previsualización bajo el cursor (con snap)
  var _dibujando = true;         // ¿rubber band activo? false = figura terminada
  var _editando = null;          // código de figura que se está EDITANDO (o null = nueva)
  // A1-A3: por cada SEGMENTO (entre punto i-1 e i) si es 'recto' o 'arco', y su
  // radio (px, para arcos). Paralelos a los tramos (índice de segmento = i-1).
  var _tiposSeg = [];            // ['recto'|'arco', ...] por segmento
  var _radiosSeg = [];           // radio en px por segmento (solo arcos)
  var _sweepsSeg = [];           // 0/1 por segmento arco: hacia qué lado curva
  var _segSel = -1;              // segmento seleccionado (para ajustar su radio)
  var _modoTrazo = 'recto';      // 'recto' | 'arco' — tipo del PRÓXIMO segmento
  // A5: etiquetas MANUALES (para figuras raras). Modo aparte; las simples siguen
  // con el etiquetado automático. Cada etiqueta: {tipo:'medida'|'letra'|'angulo', texto, x, y}.
  var _modoEtiquetas = false;
  var _etiquetas = [];

  // MODO ETIQUETA-MANDA (Tanda B): con Etiquetas ON, los PARÁMETROS REALES de la
  // figura (lados/ángulos que alimentan las planillas) los definen las etiquetas
  // MANUALES de letra/ángulo, no los tramos automáticos del dibujo. Las etiquetas
  // de cota/radio/diámetro/arco son decorativas (no parámetros).
  // Devuelve { parciales:[...], angulos:[...] } derivados de _etiquetas (registro).
  function _parametrosDeEtiquetas() {
    return REG().parametros(_etiquetas);
  }

  // El próximo segmento que se dibuje será recto o arco.
  global.disenadorSetTrazo = function(t) { _modoTrazo = (t === 'arco') ? 'arco' : 'recto'; };

  // Ajusta el radio del segmento seleccionado (slider).
  global.disenadorSetRadio = function(v) {
    var r = Number(v) || 80;
    var val = document.getElementById('disRadioVal'); if (val) val.textContent = r;
    if (_segSel >= 0) { _radiosSeg[_segSel] = r; _redibujarLienzo(); _redibujarPanel(); }
  };

  // Invierte hacia qué lado curva el arco seleccionado (sweep 0↔1).
  global.disenadorInvertirCurva = function() {
    if (_segSel >= 0 && _tiposSeg[_segSel] === 'arco') {
      _sweepsSeg[_segSel] = _sweepsSeg[_segSel] ? 0 : 1;
      _redibujarLienzo();
      _redibujarPanel();   // actualiza el PREVIEW con la nueva dirección de curva
    }
  };

  // ---- A5: EDITOR DE ETIQUETAS MANUALES (toggle; para figuras raras) ----
  global.disenadorToggleEtiquetas = function() {
    // Al APAGAR con etiquetas dibujadas: avisar. NO se borran (solo cambia el modo
    // de visualización: al apagar se vuelve a mostrar el etiquetado automático).
    if (_modoEtiquetas && _etiquetas.length) {
      if (!confirm('Vas a salir del modo etiquetas.\n\nTus etiquetas se CONSERVAN (no se borran), pero el panel volverá a mostrar los lados automáticos del dibujo hasta que vuelvas a activar Etiquetas.\n\n¿Continuar?')) return;
    }
    _modoEtiquetas = !_modoEtiquetas;
    // Al activar etiquetas, la figura se da por TERMINADA (no más rubber band de
    // dibujo). Si estaba dibujando, se cierra el trazo.
    if (_modoEtiquetas) { _dibujando = false; _hoverPt = null; _cotaInicio = null; _cotaHover = null; _actualizarBotonTerminar(); }
    var btn = document.getElementById('disBtnEtiquetas');
    if (btn) {
      btn.textContent = _modoEtiquetas ? '🏷️ Etiquetas: ON' : '🏷️ Etiquetas';
      btn.style.background = _modoEtiquetas ? '#00695c' : '#fff';
      btn.style.color = _modoEtiquetas ? '#fff' : '#00695c';
    }
    var bar = document.getElementById('disEtiquetasBar');
    if (bar) bar.style.display = _modoEtiquetas ? 'flex' : 'none';
    _redibujarLienzo();
    _redibujarPanel();   // el panel cambia de fuente (tramos ↔ etiquetas) según el modo
  };

  // ---- ETIQUETADO 3D (reutiliza el lienzo 2D con imagen de fondo) ----
  // El 3D llama esto con el snapshot 2D de la barra. El lienzo 2D entra en "modo
  // imagen": muestra el snapshot y permite etiquetar encima con TODO el sistema 2D
  // (registro, click, drag, tipos). Las etiquetas colocadas se guardan con la
  // figura 3D (via disenador3dEtiquetasGet). Vuelve al 3D con salirEtiquetado3D.
  global.disenadorEntrarEtiquetado3D = function(snapshotUrl, etiquetasPrevias) {
    _fondoImagen = snapshotUrl || null;
    _etiquetas = (etiquetasPrevias || []).slice();   // reutiliza etiquetas ya puestas
    _puntos = [];                                    // sin figura de puntos en modo imagen
    _modoEtiquetas = true; _dibujando = false;
    _cotaInicio = null; _cotaHover = null;
    // Mostrar la barra de tipos de etiqueta (reutilizada del 2D).
    var bar = document.getElementById('disEtiquetasBar');
    if (bar) bar.style.display = 'flex';
    var btn = document.getElementById('disBtnEtiquetas');
    if (btn) { btn.textContent = '🏷️ Etiquetas: ON'; btn.style.background = '#00695c'; btn.style.color = '#fff'; }
    _redibujarLienzo();
    _redibujarPanel();
    _actualizarPreviewImagen();
  };
  // Preview en modo imagen (etiquetado 3D): snapshot + etiquetas superpuestas.
  function _actualizarPreviewImagen() {
    var prev = document.getElementById('disPreview');
    if (!prev || !_fondoImagen) return;
    var capa = _svgEtiquetasEscaladas(_etiquetas, 210, 140);
    prev.innerHTML = '<div style="position:relative; width:210px; height:140px; margin:0 auto;">' +
      '<img src="' + _fondoImagen + '" style="width:210px; height:140px; object-fit:contain;" alt="preview 3D"/>' +
      capa + '</div>';
  }
  // Devuelve las etiquetas colocadas en modo imagen (para guardarlas con la figura 3D).
  global.disenador3dEtiquetasGet = function() { return _fondoImagen ? _etiquetas.slice() : []; };
  // Sale del modo imagen (vuelve el lienzo 2D a su estado normal).
  global.disenadorSalirEtiquetado3D = function() {
    _fondoImagen = null; _etiquetas = []; _modoEtiquetas = false;
    _cotaInicio = null; _cotaHover = null;
    var bar = document.getElementById('disEtiquetasBar');
    if (bar) bar.style.display = 'none';
    var btn = document.getElementById('disBtnEtiquetas');
    if (btn) { btn.textContent = '🏷️ Etiquetas'; btn.style.background = '#fff'; btn.style.color = '#00695c'; }
  };
  global.disenadorEnModoImagen = function() { return !!_fondoImagen; };

  // Con "Etiquetas ON", el click en el lienzo coloca DIRECTO una etiqueta del tipo
  // seleccionado (sin botón "Colocar"). La cota necesita 2 clicks: _cotaInicio
  // guarda el primero mientras espera el segundo.
  var _cotaInicio = null;

  global.disenadorLimpiarEtiquetas = function() {
    if (_etiquetas.length && !confirm('¿Borrar TODAS las etiquetas?')) return;
    _etiquetas = []; _cotaInicio = null; _cotaHover = null; _redibujarLienzo(); _redibujarPanel();
  };
  // Deshacer la ÚLTIMA etiqueta (no borrar todo).
  global.disenadorDeshacerEtiqueta = function() {
    if (_cotaInicio) { _cotaInicio = null; _cotaHover = null; _redibujarLienzo(); return; }  // cancela cota a medias
    if (_etiquetas.length) { _etiquetas.pop(); _redibujarLienzo(); _redibujarPanel(); }
  };

  // Muestra el selector de letra o ángulo según el tipo de etiqueta elegido.
  global.disenadorEtTipoChange = function() {
    var tipo = (document.getElementById('disEtTipo') || {}).value;
    var sl = document.getElementById('disEtLetra'), sa = document.getElementById('disEtAngulo');
    if (sl) sl.style.display = (tipo === 'letra') ? '' : 'none';
    if (sa) sa.style.display = (tipo === 'angulo') ? '' : 'none';
  };

  // Muestra/oculta el slider de radio según haya un segmento arco seleccionado.
  function _actualizarSliderRadio() {
    var wrap = document.getElementById('disRadioWrap');
    var esArco = _segSel >= 0 && _tiposSeg[_segSel] === 'arco';
    if (wrap) wrap.style.display = esArco ? 'inline-flex' : 'none';
    if (esArco) {
      var sl = document.getElementById('disRadioSlider'), val = document.getElementById('disRadioVal');
      var r = _radiosSeg[_segSel] || 80;
      if (sl) sl.value = r; if (val) val.textContent = Math.round(r);
    }
  }

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
      var tipo = _tiposSeg[i - 1] || 'recto';
      var radio = (tipo === 'arco') ? (_radiosSeg[i - 1] || 0) : 0;
      var sweep = (tipo === 'arco') ? (_sweepsSeg[i - 1] != null ? _sweepsSeg[i - 1] : 1) : null;
      if (i === 1) {
        tramos.push({ lado: lado, giro: 0, sentido: null, tipo: tipo, radio: radio, sweep: sweep });
      } else {
        var p0v = _puntos[i - 2], p1v = _puntos[i - 1], p2v = _puntos[i];
        var a1 = Math.atan2(p1v.y - p0v.y, p1v.x - p0v.x);
        var a2 = Math.atan2(p2v.y - p1v.y, p2v.x - p1v.x);
        var d = (a2 - a1) * 180 / Math.PI;
        while (d > 180) d -= 360; while (d < -180) d += 360;
        var giro = Math.abs(Math.round(d));
        var sentido = (d < 0) ? 'izq' : 'der';   // pantalla: horario = der
        tramos.push({ lado: lado, giro: giro, sentido: sentido, tipo: tipo, radio: radio, sweep: sweep });
      }
    }
    // 5M.8.6: guardar los PUNTOS reales (normalizados, Y hacia arriba) → render
    // WYSIWYG. + tipos/radios de segmento (A1) para reproducir las curvas.
    var p0 = _puntos[0] || { x: 0, y: 0 };
    var puntos = _puntos.map(function(p) { return { x: p.x - p0.x, y: -(p.y - p0.y) }; });
    // Etiquetas manuales normalizadas al origen p0 (el registro sabe la forma de
    // cada tipo: arco=seg/lado, línea=x1..y2, texto=x/y).
    var etiquetas = _etiquetas.map(function(e) { return REG().normalizar(e, p0); });
    // etiquetas_manda: la figura usa las etiquetas MANUALES como parámetros → al
    // renderizarla (galería/catálogo) NO se dibujan letras/ángulos automáticos.
    var etMandaFlag = REG().tieneParametros(_etiquetas);
    return { dim: '2D', tramos: tramos, puntos: puntos,
             tipos_seg: _tiposSeg.slice(), radios_seg: _radiosSeg.slice(),
             sweeps_seg: _sweepsSeg.slice(), etiquetas: etiquetas,
             etiquetas_manda: etMandaFlag };
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
      // Si el segmento entrante (i) o saliente (i+1) es un ARCO, la curva ES el
      // doblez → ese vértice NO genera ángulo α (evita los 45° falsos).
      if (_tiposSeg[i - 1] === 'arco' || _tiposSeg[i] === 'arco') continue;
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
        out[i] = { texto: 'α' + nAlfa, esAlfa: true }; // solo el nombre, sin el valor
      }
    }
    return out;
  }

  var CW = 420, CH = 320;   // dimensiones del lienzo
  var _svgCreado = false;
  // MODO IMAGEN DE FONDO (etiquetado 3D): cuando el 3D activa el etiquetado, pone
  // aquí el snapshot 2D de la barra. El lienzo lo dibuja como fondo (en vez de la
  // figura de puntos) y las etiquetas se colocan encima, reutilizando TODO el
  // sistema 2D (registro, click, drag, tipos). null = modo normal 2D.
  var _fondoImagen = null;

  // Crea el SVG del lienzo UNA sola vez (grilla + rect capturador de eventos + una
  // capa <g> dinámica). Los listeners van con addEventListener sobre el SVG, que
  // NO se recrea → el click nunca cae sobre un nodo destruido (causa del bug).
  function _crearLienzo() {
    var wrap = document.getElementById('disenadorLienzo');
    if (!wrap) return;
    var s = '<svg id="disenadorSvgCanvas" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + CW + '" height="' + CH + '" ' +
      'style="background:#fff; border-radius:6px; cursor:crosshair; touch-action:none; max-width:100%;">';
    // Flechas de acotación (radio/diámetro), estilo CAD.
    s += '<defs>' +
      '<marker id="disArrowEnd" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#1565c0"/></marker>' +
      '<marker id="disArrowStart" markerWidth="9" markerHeight="9" refX="0" refY="3" orient="auto"><path d="M7,0 L0,3 L7,6 Z" fill="#1565c0"/></marker>' +
      '</defs>';
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
      // A6: arrastre de nodos. mousedown sobre un vértice inicia el drag.
      svg.addEventListener('mousedown', _dragStart);
      svg.addEventListener('mousemove', _dragMove);
      window.addEventListener('mouseup', _dragEnd);
    }
    _svgCreado = true;
  }

  // ---- A6: DRAG de nodos y etiquetas (arrastrar para reposicionar) ----
  var _dragIdx = -1;      // índice del vértice que se arrastra (-1 = ninguno)
  var _dragEtiq = -1;     // índice de la etiqueta manual que se arrastra (-1 = ninguna)
  var _dragMovido = false; // ¿hubo movimiento? (para suprimir el click posterior)
  function _dragStart(ev) {
    var t = ev.target; if (!t || !t.getAttribute) return;
    if (t.getAttribute('data-etiq') != null) {        // etiqueta manual
      var ei = parseInt(t.getAttribute('data-etiq'), 10);
      var et = _etiquetas[ei];
      // La cota de arco no se arrastra: un click sobre ella INVIERTE la guata.
      if (et && REG().esArco(et.tipo)) {
        et.lado = (et.lado || 1) * -1;
        _suprimirClick = true; setTimeout(function(){ _suprimirClick = false; }, 0);
        ev.preventDefault(); _redibujarLienzo(); return;
      }
      _dragEtiq = ei; _dragMovido = false; ev.preventDefault(); return;
    }
    if (t.getAttribute('data-nodo') != null) {        // vértice
      _dragIdx = parseInt(t.getAttribute('data-nodo'), 10); _dragMovido = false; ev.preventDefault();
    }
  }
  function _dragMove(ev) {
    var c = _coord(ev); if (!c) return;
    if (_dragEtiq >= 0 && _etiquetas[_dragEtiq]) {    // mover etiqueta (libre, sin snap)
      var et = _etiquetas[_dragEtiq];
      if (!REG().esArrastrable(et.tipo)) { return; }   // ej. cota de arco: enganchada, no se arrastra
      if (REG().esLinea(et.tipo)) {
        // Trasladar la línea completa (mantener su largo/ángulo). Ancla: punto medio.
        if (et._offx == null) { et._offx = c.x - (et.x1+et.x2)/2; et._offy = c.y - (et.y1+et.y2)/2; }
        var cx = c.x - et._offx, cy = c.y - et._offy;
        var hx = (et.x2-et.x1)/2, hy = (et.y2-et.y1)/2;
        et.x1 = cx-hx; et.y1 = cy-hy; et.x2 = cx+hx; et.y2 = cy+hy;
      } else { et.x = c.x; et.y = c.y; }
      _dragMovido = true; _redibujarLienzo(); return;
    }
    if (_dragIdx < 0) return;
    var p = { x: Math.round(c.x / GRID) * GRID, y: Math.round(c.y / GRID) * GRID };  // vértice snapea a grilla
    _puntos[_dragIdx] = p;
    _dragMovido = true;
    _redibujarLienzo();
    _redibujarPanel();
  }
  function _dragEnd() {
    if (_dragIdx < 0 && _dragEtiq < 0) return;
    // Limpiar el offset temporal de arrastre de cotas.
    _etiquetas.forEach(function(e){ delete e._offx; delete e._offy; });
    _dragIdx = -1; _dragEtiq = -1;
    _redibujarLienzo();
    _redibujarPanel();
    if (_dragMovido) { _suprimirClick = true; setTimeout(function(){ _suprimirClick = false; }, 0); }
  }
  var _suprimirClick = false;

  // Índice del segmento CURVO (i-1→i, tipo 'arco') cuyo punto medio esté más cerca
  // del click `pt` (coords de lienzo). -1 si no hay arcos o el click está lejos.
  function _arcoCercaDe(pt) {
    var mejor = -1, dmin = Infinity;
    for (var i = 1; i < _puntos.length; i++) {
      if (_tiposSeg[i - 1] !== 'arco') continue;
      var mx = (_puntos[i-1].x + _puntos[i].x) / 2, my = (_puntos[i-1].y + _puntos[i].y) / 2;
      var d = (mx - pt.x) * (mx - pt.x) + (my - pt.y) * (my - pt.y);
      if (d < dmin) { dmin = d; mejor = i - 1; }   // guardamos índice de SEGMENTO
    }
    // Aceptar solo si el click está razonablemente cerca del arco (< 60px del medio).
    return (mejor >= 0 && dmin < 60 * 60) ? mejor : -1;
  }

  // (El dibujo de la cota de arco vive ahora en EtiquetasRegistro.dibujarArco —
  // arco concéntrico al de la barra; un solo lugar para lienzo y render.)

  // Redibuja SOLO la capa dinámica (no toca el SVG raíz ni la grilla ni el rect
  // de eventos). Así un mousemove no destruye el nodo sobre el que caerá el click.
  function _redibujarLienzo() {
    if (!_svgCreado || !document.getElementById('disenadorSvgCanvas')) _crearLienzo();
    var capa = document.getElementById('disenadorCapa');
    if (!capa) return;
    var s = '';
    // MODO IMAGEN (etiquetado 3D): fondo = snapshot de la barra; sin figura de puntos.
    if (_fondoImagen) {
      s += '<image href="' + _fondoImagen + '" xlink:href="' + _fondoImagen + '" x="0" y="0" width="' + CW + '" height="' + CH + '" preserveAspectRatio="xMidYMid meet" style="pointer-events:none;"/>';
      _etiquetas.forEach(function(e, k) { s += _svgEtiqueta(e, k); });
      if (_modoEtiquetas && _cotaInicio && _cotaHover) s += _svgRubberCota();
      capa.innerHTML = s;
      return;
    }
    if (_puntos.length >= 2) {
      s += '<path d="' + _pathDesdePuntos(_puntos, _tiposSeg, _radiosSeg, _sweepsSeg) + '" fill="none" stroke="#00695c" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    if (_dibujando && _puntos.length >= 1 && _hoverPt) {
      var lp = _puntos[_puntos.length - 1];
      s += '<line x1="' + lp.x + '" y1="' + lp.y + '" x2="' + _hoverPt.x + '" y2="' + _hoverPt.y + '" stroke="#4db6ac" stroke-width="2" stroke-dasharray="5,4"/>';
      s += '<circle cx="' + _hoverPt.x + '" cy="' + _hoverPt.y + '" r="4" fill="#4db6ac" opacity="0.6"/>';
    }
    _puntos.forEach(function(p, i) {
      var isEnd = (i === 0 || i === _puntos.length - 1);
      // data-nodo + área de captura grande (r 8 transparente) para arrastrar fácil.
      s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="9" fill="transparent" data-nodo="' + i + '" style="cursor:move;"/>';
      s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (isEnd ? 5 : 4) + '" fill="' + (isEnd ? '#004d40' : '#00897b') + '" data-nodo="' + i + '" style="cursor:move;"/>';
    });
    // Etiquetas AUTOMÁTICAS (lado + ángulo). Se OCULTAN en modo etiquetas manuales
    // (el usuario toma control total de las etiquetas para figuras raras).
    if (!_modoEtiquetas) {
      for (var i = 1; i < _puntos.length; i++) {
        var a = _puntos[i - 1], b = _puntos[i];
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var lbl = _labels[i - 1] || LETRAS[i - 1];
        var vx = b.x - a.x, vy = b.y - a.y;
        var len = Math.sqrt(vx * vx + vy * vy) || 1;
        var off = 15;
        var lx = mx - (vy / len) * off, ly = my + (vx / len) * off;
        s += '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="9" fill="#fff" opacity="0.85"/>';
        s += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '" text-anchor="middle" fill="#00695c" font-size="13" font-weight="700">' + lbl + '</text>';
      }
      var angs = _etiquetasAngulos();
      Object.keys(angs).forEach(function(idx) {
        idx = Number(idx);
        var v = _puntos[idx], pa = _puntos[idx - 1], pb = _puntos[idx + 1];
        var info = angs[idx];
        var color = info.esAlfa ? '#c62828' : '#999';
        var u1x = pa.x - v.x, u1y = pa.y - v.y; var l1 = Math.sqrt(u1x*u1x + u1y*u1y) || 1;
        var u2x = pb.x - v.x, u2y = pb.y - v.y; var l2 = Math.sqrt(u2x*u2x + u2y*u2y) || 1;
        var bx = u1x/l1 + u2x/l2, by = u1y/l1 + u2y/l2;
        var bl = Math.sqrt(bx*bx + by*by);
        if (bl < 0.15) { bx = -u1y/l1; by = u1x/l1; bl = 1; }
        var lx2 = v.x + (bx/bl) * 20, ly2 = v.y + (by/bl) * 20;
        s += '<text x="' + lx2.toFixed(1) + '" y="' + (ly2 + 4).toFixed(1) + '" text-anchor="middle" fill="' + color + '" font-size="12" font-weight="700">' + info.texto + '</text>';
      });
    }
    // Etiquetas MANUALES (siempre visibles): arrastrables (data-etiq).
    _etiquetas.forEach(function(e, k) { s += _svgEtiqueta(e, k); });
    // Rubber band de la cota/radio/diámetro en curso (tras el 1er click).
    if (_modoEtiquetas && _cotaInicio && _cotaHover) s += _svgRubberCota();
    capa.innerHTML = s;
  }

  // SVG de una etiqueta manual (interactiva). La forma la decide el registro. Se
  // usa en el lienzo 2D normal Y en el modo imagen (etiquetado 3D). En modo imagen
  // NO hay segmentos de barra, así que la cota de arco se omite (no tiene curva base).
  function _svgEtiqueta(e, k) {
    if (REG().esArco(e.tipo)) {
      if (_fondoImagen) return '';   // sin curva base sobre la imagen 3D
      if (e.seg == null || !_puntos[e.seg + 1]) return '';
      var a = _puntos[e.seg], b = _puntos[e.seg + 1];
      return REG().dibujarArco(a, b, _radiosSeg[e.seg], _sweepsSeg[e.seg], e.lado, 12, { interactivo: true, idx: k });
    }
    if (REG().esLinea(e.tipo)) {
      var p1 = { x: e.x1, y: e.y1 }, p2 = { x: e.x2, y: e.y2 };
      return (e.tipo === 'cota')
        ? REG().dibujarCota(p1, p2, { interactivo: true, idx: k })
        : REG().dibujarRadioDiam(e.tipo, p1, p2, { interactivo: true, idx: k });
    }
    return REG().dibujarTexto(e.tipo, e.texto, { x: e.x, y: e.y }, { interactivo: true, idx: k });
  }
  function _svgRubberCota() {
    var rbCol = (_cotaInicio.tipo === 'radio' || _cotaInicio.tipo === 'diametro') ? '#1565c0' : '#4db6ac';
    return '<line x1="' + _cotaInicio.x + '" y1="' + _cotaInicio.y + '" x2="' + _cotaHover.x + '" y2="' + _cotaHover.y + '" stroke="' + rbCol + '" stroke-width="1.5" stroke-dasharray="5,4"/>' +
      '<circle cx="' + _cotaInicio.x + '" cy="' + _cotaInicio.y + '" r="3" fill="' + rbCol + '"/>';
  }

  // Capa SVG de etiquetas 3D (coords del lienzo 420x320) escalada a un overlay w×h,
  // para superponer sobre el snapshot en galería/preview. Sin cota de arco (no hay
  // curva base sobre la imagen). Devuelve un <svg> absoluto o '' si no hay etiquetas.
  function _svgEtiquetasEscaladas(etiquetas, w, h) {
    if (!etiquetas || !etiquetas.length) return '';
    var e = '';
    etiquetas.forEach(function(et) {
      if (REG().esArco(et.tipo)) return;   // no aplica sobre imagen
      if (REG().esLinea(et.tipo)) {
        var p1 = { x: et.x1, y: et.y1 }, p2 = { x: et.x2, y: et.y2 };
        e += (et.tipo === 'cota') ? REG().dibujarCota(p1, p2, { sw: 1 }) : REG().dibujarRadioDiam(et.tipo, p1, p2, { sw: 1 });
      } else {
        e += REG().dibujarTexto(et.tipo, et.texto, { x: et.x, y: et.y }, { fs: 13, halo: 3, dy: 4 });
      }
    });
    if (!e) return '';
    return '<svg viewBox="0 0 ' + CW + ' ' + CH + '" width="' + w + '" height="' + h + '" preserveAspectRatio="xMidYMid meet" ' +
      'style="position:absolute; top:0; left:0; width:' + w + 'px; height:' + h + 'px; pointer-events:none;">' +
      '<defs><marker id="disArrowEnd" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#1565c0"/></marker>' +
      '<marker id="disArrowStart" markerWidth="9" markerHeight="9" refX="0" refY="3" orient="auto"><path d="M7,0 L0,3 L7,6 Z" fill="#1565c0"/></marker></defs>' +
      e + '</svg>';
  }

  // ---- Coordenada del evento relativa al SVG ----
  function _coord(ev) {
    var svg = document.getElementById('disenadorSvgCanvas');
    if (!svg) return null;
    var r = svg.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  global.disenadorHover = function(ev) {
    // En modo etiquetas con una cota iniciada: rubber band de la cota hasta el cursor.
    if (_modoEtiquetas) {
      if (_cotaInicio) { var cc = _coord(ev); if (cc) { _cotaHover = cc; _redibujarLienzo(); } }
      return;
    }
    if (!_dibujando) return;         // figura terminada → sin rubber band
    var c = _coord(ev); if (!c) return;
    _hoverPt = _snap(c.x, c.y);
    _redibujarLienzo();
  };
  var _cotaHover = null;
  global.disenadorHoverOut = function() { _hoverPt = null; _redibujarLienzo(); };

  global.disenadorClick = function(ev) {
    if (_suprimirClick) return;      // click que sigue a un drag → ignorar
    // Modo etiquetas: el click coloca DIRECTO una etiqueta del tipo seleccionado
    // (sin botón "Colocar"). Si el click cae sobre una etiqueta existente, no
    // coloca (deja arrastrarla).
    if (_modoEtiquetas) {
      if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-etiq') != null) return;
      var cc = _coord(ev); if (!cc) return;
      var tipo = (document.getElementById('disEtTipo') || {}).value || 'cota';
      if (REG().esArco(tipo)) {
        // Cota de ARCO: 1 click sobre un segmento CURVO → la cota sigue ese arco,
        // separada hacia afuera (offset). Se puede invertir la guata luego.
        var seg = _arcoCercaDe(cc);
        if (seg < 0) {
          if (typeof showToast === 'function') showToast('Haz click sobre un segmento CURVO de la figura para acotarlo.', 'info');
        } else {
          _etiquetas.push({ tipo: 'arco', seg: seg, lado: 1 });   // lado: 1/-1 = guata
          _redibujarLienzo(); _redibujarPanel();
        }
      } else if (REG().esLinea(tipo)) {
        // Cota/radio/diámetro = línea de 2 clicks (inicio y fin), sin botón previo.
        if (!_cotaInicio) {
          _cotaInicio = { x: cc.x, y: cc.y, tipo: tipo };
          var msg = tipo === 'radio' ? 'Radio: click en el CENTRO del arco'
                  : (tipo === 'diametro' ? 'Diámetro: click en el otro extremo' : 'Cota: ahora click en el punto FINAL');
          if (typeof showToast === 'function') showToast(msg, 'info');
        } else {
          _etiquetas.push({ tipo: _cotaInicio.tipo || 'cota', x1: _cotaInicio.x, y1: _cotaInicio.y, x2: cc.x, y2: cc.y });
          _cotaInicio = null; _cotaHover = null; _redibujarLienzo(); _redibujarPanel();
        }
      } else {
        // Texto (letra/ángulo): 1 click; es PARÁMETRO en modo etiqueta-manda.
        var texto = (tipo === 'letra')
          ? ((document.getElementById('disEtLetra') || {}).value || 'A')
          : ((document.getElementById('disEtAngulo') || {}).value || 'α1');
        _etiquetas.push({ tipo: tipo, texto: texto, x: cc.x, y: cc.y });
        _redibujarLienzo(); _redibujarPanel();
      }
      return;
    }
    // Click sobre un nodo existente = seleccionar/arrastrar, no agregar punto.
    if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-nodo') != null) return;
    if (!_dibujando) return;         // terminado → los clicks no agregan lados
    var c = _coord(ev); if (!c) return;
    var p = _snap(c.x, c.y);
    // Evitar duplicar el mismo punto.
    var last = _puntos[_puntos.length - 1];
    if (last && Math.abs(last.x - p.x) < 1 && Math.abs(last.y - p.y) < 1) return;
    _puntos.push(p);
    if (_puntos.length >= 2) {
      _labels[_puntos.length - 2] = LETRAS[_puntos.length - 2] || ('L' + (_puntos.length - 1));
      // Tipo del segmento recién creado según el modo de trazo.
      var segIdx = _puntos.length - 2;
      _tiposSeg[segIdx] = _modoTrazo;
      if (_modoTrazo === 'arco') {
        var cuerda = Math.sqrt((p.x - last.x) * (p.x - last.x) + (p.y - last.y) * (p.y - last.y));
        _radiosSeg[segIdx] = Math.round(cuerda * 0.75);   // radio inicial razonable
        _sweepsSeg[segIdx] = 1;                            // lado por defecto (invertible)
        _segSel = segIdx;                                  // seleccionarlo para el slider
      }
    }
    _redibujarLienzo();
    _redibujarPanel();
    _actualizarBotonTerminar();
    _actualizarSliderRadio();
  };

  global.disenadorDeshacer = function() {
    if (_puntos.length === 0) return;
    _puntos.pop();
    _labels = _labels.slice(0, Math.max(0, _puntos.length - 1));
    _tiposSeg = _tiposSeg.slice(0, Math.max(0, _puntos.length - 1));
    _radiosSeg = _radiosSeg.slice(0, Math.max(0, _puntos.length - 1));
    _sweepsSeg = _sweepsSeg.slice(0, Math.max(0, _puntos.length - 1));
    _segSel = -1;
    _redibujarLienzo();
    _redibujarPanel();
    _actualizarSliderRadio();
  };

  // Limpiado real del lienzo 2D (sin confirmación). Reutilizado por el botón
  // Limpiar y por el cambio de vista 2D↔3D.
  function _limpiar2d() {
    _puntos = []; _labels = []; _hoverPt = null;
    _tiposSeg = []; _radiosSeg = []; _sweepsSeg = []; _segSel = -1;
    _etiquetas = []; _cotaInicio = null; _cotaHover = null;
    _modoEtiquetas = false;
    _dibujando = true; _editando = null;
    var nb = document.getElementById('disenadorNombre'); if (nb) nb.value = '';
    _redibujarLienzo();
    _redibujarPanel();
    _actualizarBotonTerminar();
    _actualizarSliderRadio();
  }
  global.disenadorLimpiar = function() {
    if (_puntos.length && !confirm('¿Borrar el dibujo actual?')) return;
    _limpiar2d();
  };
  // Helpers para el switch de vista 2D↔3D (los usa disenador3d.js).
  global.disenador2dTieneFigura = function() { return _puntos.length >= 2; };
  global.disenador2dLimpiarSilencioso = function() { _limpiar2d(); };

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
    // MODO IMAGEN (etiquetado 3D): sin figura de puntos; el panel muestra los
    // parámetros de las etiquetas colocadas sobre el snapshot. No tocar el preview.
    if (_fondoImagen) { _redibujarPanelEtiquetas(cont); return; }
    if (_puntos.length < 2) {
      cont.innerHTML = '<div class="muted" style="font-size:12px;">Haz click en el lienzo para trazar el primer lado. Cada click agrega un lado; el ángulo se ajusta a 45/90/135°.</div>';
      disenadorActualizarPreview2d();   // sin figura → limpiar el preview (no dejar la anterior pegada)
      return;
    }
    // MODO ETIQUETA-MANDA: los parámetros son las etiquetas MANUALES, no los tramos.
    if (_modoEtiquetas) { _redibujarPanelEtiquetas(cont); return; }
    var geo = _puntosAGeometria();
    var largos = _largos();
    var ladosUsados = geo.tramos.map(function(t) { return t.lado; });
    // Ángulos INTERNOS (convención aSa) de cada vértice, para el panel.
    var angulos = geo.tramos.filter(function(t, i) { return i > 0; }).map(function(t) { return _anguloInterno(t.giro); });

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
    // Radio: hay curva → la figura tiene radio (o etiqueta R/radio/diámetro/arco).
    var hayRadio = _tiposSeg.some(function(t) { return t === 'arco'; }) || REG().parametros(_etiquetas).radio;
    html += '<div style="margin-top:8px; font-size:12px; color:#444;">' +
      '<div><b>Lados:</b> ' + ladosUsados.join(', ') + '</div>' +
      '<div><b>Ángulos α (≠90°):</b> ' + alfaTxt + '</div>' +
      '<div><b>Radio:</b> ' + (hayRadio ? 'Sí' : '—') + '</div>' +
      '<div><b>N° de lados:</b> ' + ladosUsados.length + '</div>' +
      (especiales.length > 4 ? '<div style="color:#c62828; margin-top:4px;">⚠ ' + especiales.length + ' ángulos especiales — el sistema soporta máx. 4 (α1-α4).</div>' : '') +
      '</div>';
    cont.innerHTML = html;
    disenadorActualizarPreview2d();
  }

  // Panel en MODO ETIQUETA-MANDA: los parámetros REALES son las etiquetas manuales.
  // MISMA tabla que el panel automático (Lado / Largo / Ángulo), orden alfabético.
  function _redibujarPanelEtiquetas(cont) {
    // Etiquetas de letra (lados) ordenadas alfabéticamente; a cada una le asociamos
    // el LARGO del tramo cuyo punto medio esté más cerca de la etiqueta (en grilla).
    var letras = _etiquetas.filter(function(e) { return e.tipo === 'letra' && e.texto !== 'R'; });
    letras.sort(function(a, b) { return String(a.texto).localeCompare(String(b.texto)); });
    var angs = _etiquetas.filter(function(e) { return e.tipo === 'angulo'; })
                         .map(function(e) { return e.texto; });

    var html = '<div style="font-weight:700; color:#00695c; margin-bottom:8px;">Parámetros de la figura 🏷️</div>';
    if (!letras.length && !angs.length) {
      html += '<div class="muted" style="font-size:12px;">Coloca etiquetas de <b>letra</b> (lados) y <b>ángulo</b> sobre la figura. Esas serán los parámetros reales que alimentan las planillas. Cota/arco/radio/diámetro son solo visuales.</div>';
      cont.innerHTML = html;
      disenadorActualizarPreview2d();
      return;
    }
    html += '<table style="width:100%; font-size:12px; border-collapse:collapse;">';
    html += '<tr style="color:#666; text-align:left;"><th style="padding:2px 4px;">Lado</th><th style="padding:2px 4px;">Largo (grilla)</th></tr>';
    letras.forEach(function(e) {
      html += '<tr style="border-top:1px solid #eee;">' +
        '<td style="padding:2px 4px; font-weight:700; color:#00695c; text-align:center;">' + String(e.texto).replace(/[<>&]/g, '') + '</td>' +
        '<td style="padding:2px 4px;">' + _largoCercaDe(e) + '</td>' +
        '</tr>';
    });
    html += '</table>';
    var p = REG().parametros(_etiquetas);
    html += '<div style="margin-top:8px; font-size:12px; color:#444;">' +
      '<div><b>Lados:</b> ' + letras.map(function(e){ return e.texto; }).join(', ') + '</div>' +
      '<div><b>Ángulos:</b> ' + (angs.length ? angs.join(', ') : '— (todos 90°/implícitos)') + '</div>' +
      '<div><b>Radio:</b> ' + (p.radio ? 'Sí' : '—') + '</div>' +
      '<div><b>N° de lados:</b> ' + letras.length + '</div>' +
      (angs.length > 4 ? '<div style="color:#c62828; margin-top:4px;">⚠ ' + angs.length + ' ángulos — el sistema soporta máx. 4 (α1-α4).</div>' : '') +
      '</div>';
    cont.innerHTML = html;
    // Preview: en modo imagen (etiquetado 3D) = snapshot + etiquetas; en 2D = figura.
    if (_fondoImagen) _actualizarPreviewImagen();
    else disenadorActualizarPreview2d();
  }

  // Largo (en grilla) del tramo dibujado cuyo punto medio esté más cerca de la
  // etiqueta `e` (en coords de lienzo). Devuelve '—' si no hay tramos.
  function _largoCercaDe(e) {
    if (_puntos.length < 2) return '—';
    var mejor = -1, dmin = Infinity;
    for (var i = 1; i < _puntos.length; i++) {
      var mx = (_puntos[i-1].x + _puntos[i].x) / 2, my = (_puntos[i-1].y + _puntos[i].y) / 2;
      var d = (mx - e.x) * (mx - e.x) + (my - e.y) * (my - e.y);
      if (d < dmin) { dmin = d; mejor = i; }
    }
    if (mejor < 0) return '—';
    var dx = _puntos[mejor].x - _puntos[mejor-1].x, dy = _puntos[mejor].y - _puntos[mejor-1].y;
    return Math.round(Math.sqrt(dx*dx + dy*dy) / GRID);
  }

  // Preview 2D: pone la figura como FONDO del preview (el módulo de etiquetas del
  // preview la muestra + permite etiquetar encima). Mismo motor de render.
  global.disenadorActualizarPreview2d = function() {
    var prev = document.getElementById('disPreview');
    if (!prev) return;
    if (_puntos.length < 2) { prev.innerHTML = '<span class="muted" style="font-size:11px;">Dibuja para ver el preview.</span>'; return; }
    try {
      var geo = _puntosAGeometria();
      // Render a tamaño de preview. En modo etiqueta-manda NO dibujar las letras/
      // ángulos automáticos (labels_auto:false): solo se ven las etiquetas manuales.
      prev.innerHTML = dibujarFigura(geo, null, { width: 210, height: 140, pad: 18, labels_auto: _modoEtiquetas ? false : undefined });
    } catch (e) { prev.innerHTML = '<span class="muted" style="font-size:11px;">Preview no disponible.</span>'; }
  };

  // ---- Guardar la figura dibujada (crear en el catálogo con nombre del usuario) ----
  global.disenadorGuardar = async function() {
    var nombre = ((document.getElementById('disenadorNombre') || {}).value || '').trim();
    if (!nombre) { alert('Ponle un nombre a la figura antes de guardar.'); return; }
    // Si estamos en modo 3D, guardar la figura 3D (nodos + snapshot).
    if (typeof disenador3dEstado === 'function' && disenador3dEstado().vista === '3D') {
      return _guardarFigura3d(nombre);
    }
    if (_puntos.length < 2) { alert('Dibuja al menos un lado (dos puntos) antes de guardar.'); return; }
    var geo = _puntosAGeometria();
    var parciales, angulos, radio;
    // MODO ETIQUETA-MANDA (Tanda B): si hay etiquetas manuales de letra/ángulo, ESAS
    // son los parámetros reales (así el diseñador alimenta el catálogo). Las cotas
    // decorativas no cuentan. Si no hay etiquetas, se usan los tramos automáticos.
    var pe = _parametrosDeEtiquetas();
    var usarEtiquetas = _modoEtiquetas && (pe.parciales.length || pe.angulos.length || pe.radio);
    if (usarEtiquetas) {
      parciales = pe.parciales;
      angulos = pe.angulos;
      radio = pe.radio;   // R / cota de radio / diámetro / cota de arco → figura con radio
    } else {
      parciales = geo.tramos.map(function(t) { return t.lado; });
      // Convención aSa: solo los ángulos ESPECIALES (≠90 y ≠0) van a `angulos`.
      // Ángulo guardado = INTERNO del vértice. Un giro de 90 → interno 90 (implícito).
      angulos = geo.tramos
        .filter(function(t) { return t.tipo !== 'arco' && t.giro !== 90 && t.giro !== 0; })
        .map(function(t) { return _anguloInterno(t.giro); });
      radio = false;
    }
    if (angulos.length > 4) {
      alert('Esta figura tiene ' + angulos.length + ' ángulos especiales (≠90°), pero el sistema soporta máximo 4 (α1-α4).\n\nAjusta la figura antes de guardar.');
      return;
    }
    var payload = { codigo: nombre, parciales: parciales, angulos: angulos, radio: radio, geometria: geo };
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
        _tiposSeg = []; _radiosSeg = []; _sweepsSeg = []; _segSel = -1; _etiquetas = [];
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

  // Guardar una figura 3D (dim:"3D"). Reutiliza el mismo POST/catálogo del 2D.
  async function _guardarFigura3d(nombre) {
    if (typeof disenador3dGeometria !== 'function') { alert('Editor 3D no disponible.'); return; }
    var geo = disenador3dGeometria();
    if (!geo) { alert('Dibuja la figura 3D (al menos 2 nodos) antes de guardar.'); return; }
    // Etiquetas colocadas sobre el snapshot 2D → van con la geometría y definen los
    // parámetros REALES (modo etiqueta-manda, igual que el 2D). Si el usuario guarda
    // AÚN en modo etiquetado (sin cerrarlo), las etiquetas están en el lienzo actual
    // (disenador3dEtiquetasGet las lee de ahí); si ya cerró, están en _etiquetas3d
    // (disenador3dEtiquetas). Tomar las del lienzo si están disponibles.
    var etiq3d = [];
    if (typeof disenadorEnModoImagen === 'function' && disenadorEnModoImagen() && typeof disenador3dEtiquetasGet === 'function') {
      etiq3d = disenador3dEtiquetasGet();   // etiquetas del lienzo en curso
    } else if (typeof disenador3dEtiquetas === 'function') {
      etiq3d = disenador3dEtiquetas();      // etiquetas ya guardadas al cerrar etiquetado
    }
    if (etiq3d.length) geo.etiquetas = etiq3d;
    var parciales, angulos, radio;
    var pe = REG().parametros(etiq3d);
    if (pe.parciales.length || pe.angulos.length || pe.radio) {
      parciales = pe.parciales; angulos = pe.angulos; radio = pe.radio;
      geo.etiquetas_manda = true;
    } else {
      parciales = geo.parciales || []; angulos = []; radio = false;
    }
    if (angulos.length > 4) {
      alert('Esta figura tiene ' + angulos.length + ' ángulos, pero el sistema soporta máximo 4 (α1-α4).'); return;
    }
    var payload = { codigo: nombre, parciales: parciales, angulos: angulos, radio: radio, geometria: geo };
    try {
      var res = await fetch(apiUrl('/figuras-catalogo'), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, (typeof authHeaders === 'function' ? authHeaders() : {})),
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        if (typeof showToast === 'function') showToast('Figura 3D "' + nombre + '" guardada', 'success');
        var nb = document.getElementById('disenadorNombre'); if (nb) nb.value = '';
        if (typeof disenador3dLimpiarDibujo === 'function') disenador3dLimpiarDibujo();
        if (typeof disenador3dSetEtiquetas === 'function') disenador3dSetEtiquetas([]);
        _etiquetas = [];
        await _recargarCatalogo();
      } else {
        var d = await res.json().catch(function() { return {}; });
        alert('No se pudo guardar: ' + (d.detail || res.status));
      }
    } catch (e) {
      alert('Error al guardar la figura 3D: ' + e.message);
    }
  }

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
      var es3d = f.geometria && f.geometria.dim === '3D';
      // 3D con snapshot fijado → mostrar la imagen; si no, el SVG (vista iso 2D).
      var vis;
      if (es3d && f.geometria.snapshot) {
        // Snapshot + capa de etiquetas 3D superpuesta (escaladas del lienzo 420x320).
        var capaEt = _svgEtiquetasEscaladas((f.geometria.etiquetas || []), 90, 72);
        vis = '<div style="position:relative; width:90px; height:72px; margin:0 auto;">' +
          '<img src="' + f.geometria.snapshot + '" style="width:90px; height:72px; object-fit:contain; border-radius:4px;" alt="' + f.codigo + '"/>' +
          capaEt + '</div>';
      } else {
        vis = dibujarFigura(f.geometria, null, { width: 90, height: 72, pad: 12 });
      }
      var cod = String(f.codigo).replace(/'/g, "\\'");
      var badge3d = es3d ? '<span style="position:absolute; top:2px; left:2px; background:#1976d2; color:#fff; font-size:9px; font-weight:700; padding:1px 4px; border-radius:3px;">3D</span>' : '';
      return '<div style="border:1px solid #e0e0e0; border-radius:6px; padding:6px; text-align:center; background:#fff; position:relative;">' +
        badge3d +
        '<div style="cursor:pointer;" title="Editar" onclick="disenadorEditar(\'' + cod + '\')">' + vis + '</div>' +
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
    // Figura 3D → cargarla en el EDITOR 3D (no interpretarla como 2D, que la rompía).
    if (f.geometria.dim === '3D') {
      if (typeof disenadorSetVista === 'function') disenadorSetVista('3D');
      var okCarga = (typeof disenador3dCargarFigura === 'function') && disenador3dCargarFigura(f.geometria);
      var nb3 = document.getElementById('disenadorNombre'); if (nb3) nb3.value = f.codigo;
      _editando = codigo;
      if (typeof showToast === 'function') showToast(okCarga ? ('Editando figura 3D "' + codigo + '"') : 'No se pudo cargar la figura 3D', okCarga ? 'info' : 'error');
      return;
    }
    // geometriaAPuntos usa Y hacia arriba; el lienzo usa Y hacia abajo → invertir Y.
    var pts = geometriaAPuntos(f.geometria, null, GRID);   // largo unidad = 1 grilla
    // Centrar en el lienzo (offset simple).
    var offX = 120, offY = 140;
    _puntos = pts.map(function(p) { return { x: Math.round(p.x) + offX, y: offY - Math.round(p.y) }; });
    _labels = f.geometria.tramos.map(function(t) { return t.lado; });
    // Cargar tipos/radios de segmento (arcos) si la figura los tiene.
    _tiposSeg = f.geometria.tipos_seg ? f.geometria.tipos_seg.slice()
      : f.geometria.tramos.map(function(t) { return t.tipo || 'recto'; });
    _radiosSeg = f.geometria.radios_seg ? f.geometria.radios_seg.slice()
      : f.geometria.tramos.map(function(t) { return t.radio || 0; });
    _sweepsSeg = f.geometria.sweeps_seg ? f.geometria.sweeps_seg.slice()
      : f.geometria.tramos.map(function(t) { return t.sweep != null ? t.sweep : 1; });
    // Cargar etiquetas manuales (guardadas relativas a p0, Y arriba → lienzo).
    // El registro sabe la forma de cada tipo (arco/línea/texto).
    _etiquetas = (f.geometria.etiquetas || []).map(function(e) { return REG().desnormalizar(e, offX, offY); });
    _segSel = -1;
    _dibujando = false;    // cargada = terminada (sin rubber band); "Retomar" para seguir
    _editando = codigo;
    _hoverPt = null;
    // Si la figura fue creada en modo etiqueta-manda (o tiene etiquetas manuales),
    // reabrir en ese modo → así el render usa las etiquetas y NO reaparece la A auto.
    _modoEtiquetas = !!(f.geometria.etiquetas_manda || (_etiquetas && _etiquetas.length));
    var barEt = document.getElementById('disEtiquetasBar');
    if (barEt) barEt.style.display = _modoEtiquetas ? 'flex' : 'none';
    var btnEt = document.getElementById('disBtnEtiquetas');
    if (btnEt) { btnEt.textContent = _modoEtiquetas ? '🏷️ Etiquetas: ON' : '🏷️ Etiquetas';
      btnEt.style.background = _modoEtiquetas ? '#00695c' : '#fff'; btnEt.style.color = _modoEtiquetas ? '#fff' : '#00695c'; }
    var nb = document.getElementById('disenadorNombre'); if (nb) nb.value = f.codigo;
    _redibujarLienzo(); _redibujarPanel(); _actualizarBotonTerminar();
    if (typeof showToast === 'function') showToast('Editando "' + codigo + '".', 'info');
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
