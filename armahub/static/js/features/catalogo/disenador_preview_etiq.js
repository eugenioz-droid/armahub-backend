// ArmaHub — Preview + Etiquetado en canvas GRANDE (2D y 3D unificado).
// Dos superficies:
//  - PREVIEW (chico, #disPreview): siempre muestra la figura + etiquetas (solo ver).
//  - CANVAS DE ETIQUETADO (grande, #disEtiqCanvas): se abre con "Etiquetas"; ahí se
//    colocan/arrastran las etiquetas cómodo. Reemplaza el área de dibujo.
// El fondo (figura) lo setea el diseñador via previewEtiqSetFondo(html). Las
// etiquetas se leen/guardan con previewEtiqGet()/previewEtiqSet().

(function(global) {
  var CW = 420, CH = 320;        // canvas de etiquetado grande
  var PW = 220, PH = 150;        // preview chico
  var _modo = false;             // ¿canvas de etiquetado abierto?
  var _etiquetas = [];           // [{tipo, texto, x, y}] en coords del canvas grande
  var _fondoHTML = '';           // fondo (img o svg) de la figura
  var _pendiente = null;
  var _dragIdx = -1;

  global.previewEtiqSetFondo = function(html) { _fondoHTML = html || ''; _render(); };
  global.previewEtiqGet = function() { return _etiquetas.map(function(e){ return {tipo:e.tipo, texto:e.texto, x:e.x, y:e.y}; }); };
  global.previewEtiqSet = function(arr) { _etiquetas = (arr||[]).map(function(e){ return {tipo:e.tipo, texto:e.texto, x:e.x, y:e.y}; }); _render(); };
  global.previewEtiqLimpiar = function() { _etiquetas = []; _render(); };
  global.previewEtiqTamano = function() { return { w: CW, h: CH }; };   // fondo grande

  // Abre/cierra el canvas de etiquetado grande (reemplaza el área de dibujo).
  global.previewEtiqToggle = function() {
    _modo = !_modo;
    var wrap = document.getElementById('disEtiqCanvasWrap');
    var c2d = document.getElementById('disControles2D');
    var v3d = document.getElementById('disenador3D'), ctrl3d = document.getElementById('disControles3D');
    var enVista3d = (typeof disenador3dEstado === 'function' && disenador3dEstado().vista === '3D');
    if (wrap) wrap.style.display = _modo ? '' : 'none';
    // Ocultar el área de dibujo (2D o 3D) mientras se etiqueta.
    if (_modo) {
      if (c2d) c2d.style.display = 'none';
      if (v3d) v3d.style.display = 'none';
      if (ctrl3d) ctrl3d.style.display = 'none';
    } else {
      if (enVista3d) { if (v3d) v3d.style.display = ''; if (ctrl3d) ctrl3d.style.display = ''; }
      else { if (c2d) c2d.style.display = ''; }
    }
    var btn = document.getElementById('disBtnEtiqPreview');
    if (btn) { btn.style.background = _modo ? '#00695c' : '#fff'; btn.style.color = _modo ? '#fff' : '#00695c'; }
    _render();
  };
  global.previewEtiqEnModo = function() { return _modo; };

  global.previewEtiqAgregar = function() {
    var tipo = (document.getElementById('disEtiqPvTipo') || {}).value || 'medida';
    var texto;
    if (tipo === 'medida') { texto = prompt('Cota / medida (texto libre):', ''); if (texto == null || texto === '') return; }
    else if (tipo === 'letra') texto = (document.getElementById('disEtiqPvLetra') || {}).value || 'A';
    else texto = (document.getElementById('disEtiqPvAngulo') || {}).value || 'α1';
    _pendiente = { tipo: tipo, texto: texto };
    if (typeof showToast === 'function') showToast('Haz click en el canvas para colocar "' + texto + '"', 'info');
  };

  global.previewEtiqTipoChange = function() {
    var t = (document.getElementById('disEtiqPvTipo') || {}).value;
    var sl = document.getElementById('disEtiqPvLetra'), sa = document.getElementById('disEtiqPvAngulo');
    if (sl) sl.style.display = (t === 'letra') ? '' : 'none';
    if (sa) sa.style.display = (t === 'angulo') ? '' : 'none';
  };

  function _coord(ev) {
    var svg = document.getElementById('disEtiqCanvasSvg');
    if (!svg) return null;
    var r = svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (CW / r.width), y: (ev.clientY - r.top) * (CH / r.height) };
  }
  function _onClick(ev) {
    if (!_pendiente) return;
    var c = _coord(ev); if (!c) return;
    _etiquetas.push({ tipo: _pendiente.tipo, texto: _pendiente.texto, x: c.x, y: c.y });
    _pendiente = null; _render();
  }
  function _onDown(ev) {
    var t = ev.target;
    if (t && t.getAttribute && t.getAttribute('data-eti') != null) { _dragIdx = parseInt(t.getAttribute('data-eti'), 10); ev.preventDefault(); }
  }
  function _onMove(ev) {
    if (_dragIdx < 0) return;
    var c = _coord(ev); if (!c || !_etiquetas[_dragIdx]) return;
    _etiquetas[_dragIdx].x = c.x; _etiquetas[_dragIdx].y = c.y; _render();
  }
  function _onUp() { _dragIdx = -1; }

  // Genera el SVG de etiquetas (halo sutil, sin fondo blanco sólido).
  function _capaEtiquetas(escala) {
    var COL = { medida: '#1565c0', letra: '#00695c', angulo: '#c62828' };
    var s = '';
    _etiquetas.forEach(function(e, k) {
      var col = COL[e.tipo] || '#333';
      var fs = 15 * escala;
      // Halo: mismo texto en blanco, más grueso, detrás → legible sin caja blanca.
      s += '<text x="' + (e.x*escala) + '" y="' + (e.y*escala + fs*0.35) + '" text-anchor="middle" fill="#fff" stroke="#fff" stroke-width="' + (3*escala) + '" font-size="' + fs + '" font-weight="800"' + (escala===1?' data-eti="'+k+'"':'') + ' style="cursor:move;">' + _esc(e.texto) + '</text>';
      s += '<text x="' + (e.x*escala) + '" y="' + (e.y*escala + fs*0.35) + '" text-anchor="middle" fill="' + col + '" font-size="' + fs + '" font-weight="800"' + (escala===1?' data-eti="'+k+'"':'') + ' style="cursor:move;">' + _esc(e.texto) + '</text>';
    });
    return s;
  }
  function _esc(t) { return String(t).replace(/[<>&]/g, function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c];}); }

  function _fondoObj(w, h) {
    var f = _fondoHTML.replace(/<img /gi, '<img draggable="false" ');
    return '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '" style="pointer-events:none;">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center; pointer-events:none;">' + f + '</div></foreignObject>';
  }

  // Render de AMBAS superficies: preview chico (solo ver) + canvas grande (si abierto).
  function _render() {
    // Preview chico.
    var prev = document.getElementById('disPreview');
    if (prev) {
      if (!_fondoHTML) prev.innerHTML = '<span class="muted" style="font-size:11px;">Dibuja para ver el preview.</span>';
      else {
        var esc = PW / CW;   // etiquetas escaladas al preview
        prev.innerHTML = '<svg width="' + PW + '" height="' + PH + '" viewBox="0 0 ' + PW + ' ' + PH + '" style="max-width:100%; border-radius:4px;">' +
          _fondoObj(PW, PH) + _capaEtiquetas(esc) + '</svg>';
      }
    }
    // Canvas grande de etiquetado (solo si el modo está abierto).
    if (_modo) {
      var cont = document.getElementById('disEtiqCanvas');
      if (cont) {
        var captura = '<rect x="0" y="0" width="' + CW + '" height="' + CH + '" fill="transparent"/>';
        cont.innerHTML = '<svg id="disEtiqCanvasSvg" width="' + CW + '" height="' + CH + '" viewBox="0 0 ' + CW + ' ' + CH +
          '" style="max-width:100%; user-select:none; cursor:crosshair;">' +
          _fondoObj(CW, CH) + captura + _capaEtiquetas(1) + '</svg>';
        var s = document.getElementById('disEtiqCanvasSvg');
        if (s) { s.addEventListener('click', _onClick); s.addEventListener('mousedown', _onDown); }
      }
    }
  }
  window.addEventListener('mousemove', _onMove);
  window.addEventListener('mouseup', _onUp);
  global.previewEtiqRender = _render;
})(window);
