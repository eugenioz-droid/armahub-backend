// ArmaHub — Etiquetas manuales sobre el PREVIEW (2D y 3D unificado).
// El preview (imagen del snapshot 3D o SVG 2D) se vuelve un mini-lienzo: la figura
// va de FONDO y encima una capa SVG de etiquetas arrastrables (medida/letra/ángulo).
// El canvas de dibujo (2D o 3D) NO se toca. Mismo etiquetado para ambos modos.
//
// El resto del diseñador solo debe: (1) poner el fondo del preview via
// previewEtiqSetFondo(html), y (2) leer/guardar las etiquetas via
// previewEtiqGet()/previewEtiqSet(). El módulo maneja el modo, el drag y el render.

(function(global) {
  var PW = 220, PH = 150;        // tamaño del lienzo de preview
  var _modo = false;             // ¿modo etiquetas activo?
  var _etiquetas = [];           // [{tipo, texto, x, y}]
  var _fondoHTML = '';           // fondo (img o svg) de la figura
  var _pendiente = null;         // etiqueta a colocar en el próximo click
  var _dragIdx = -1;

  // El diseñador setea el fondo del preview (imagen 3D o SVG 2D).
  global.previewEtiqSetFondo = function(html) { _fondoHTML = html || ''; _render(); };
  global.previewEtiqGet = function() { return _etiquetas.map(function(e){ return {tipo:e.tipo, texto:e.texto, x:e.x, y:e.y}; }); };
  global.previewEtiqSet = function(arr) { _etiquetas = (arr||[]).map(function(e){ return {tipo:e.tipo, texto:e.texto, x:e.x, y:e.y}; }); _render(); };
  global.previewEtiqLimpiar = function() { _etiquetas = []; _render(); };
  global.previewEtiqTamano = function() { return { w: PW, h: PH }; };

  // Activa/desactiva el modo etiquetas del preview.
  global.previewEtiqToggle = function() {
    _modo = !_modo;
    var btn = document.getElementById('disBtnEtiqPreview');
    if (btn) {
      btn.textContent = _modo ? '🏷️ Etiquetas: ON' : '🏷️ Etiquetas';
      btn.style.background = _modo ? '#00695c' : '#fff';
      btn.style.color = _modo ? '#fff' : '#00695c';
    }
    var bar = document.getElementById('disEtiqPreviewBar');
    if (bar) bar.style.display = _modo ? 'flex' : 'none';
    _render();
  };
  global.previewEtiqEnModo = function() { return _modo; };

  // Prepara una etiqueta para colocar en el próximo click sobre el preview.
  global.previewEtiqAgregar = function() {
    var tipo = (document.getElementById('disEtiqPvTipo') || {}).value || 'medida';
    var texto;
    if (tipo === 'medida') { texto = prompt('Cota / medida (texto libre):', ''); if (texto == null || texto === '') return; }
    else if (tipo === 'letra') texto = (document.getElementById('disEtiqPvLetra') || {}).value || 'A';
    else texto = (document.getElementById('disEtiqPvAngulo') || {}).value || 'α1';
    _pendiente = { tipo: tipo, texto: texto };
    if (typeof showToast === 'function') showToast('Haz click en el preview para colocar "' + texto + '"', 'info');
  };

  global.previewEtiqTipoChange = function() {
    var t = (document.getElementById('disEtiqPvTipo') || {}).value;
    var sl = document.getElementById('disEtiqPvLetra'), sa = document.getElementById('disEtiqPvAngulo');
    if (sl) sl.style.display = (t === 'letra') ? '' : 'none';
    if (sa) sa.style.display = (t === 'angulo') ? '' : 'none';
  };

  function _coord(ev) {
    var svg = document.getElementById('disPreviewSvg');
    if (!svg) return null;
    var r = svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (PW / r.width), y: (ev.clientY - r.top) * (PH / r.height) };
  }

  function _onClick(ev) {
    if (!_modo || !_pendiente) return;
    var c = _coord(ev); if (!c) return;
    _etiquetas.push({ tipo: _pendiente.tipo, texto: _pendiente.texto, x: c.x, y: c.y });
    _pendiente = null; _render();
  }
  function _onDown(ev) {
    if (!_modo) return;
    var t = ev.target;
    if (t && t.getAttribute && t.getAttribute('data-eti') != null) { _dragIdx = parseInt(t.getAttribute('data-eti'), 10); ev.preventDefault(); }
  }
  function _onMove(ev) {
    if (_dragIdx < 0) return;
    var c = _coord(ev); if (!c || !_etiquetas[_dragIdx]) return;
    _etiquetas[_dragIdx].x = c.x; _etiquetas[_dragIdx].y = c.y; _render();
  }
  function _onUp() { _dragIdx = -1; }

  // Render: fondo (figura) + capa de etiquetas SVG arrastrables.
  function _render() {
    var cont = document.getElementById('disPreview');
    if (!cont) return;
    if (!_fondoHTML) {
      cont.innerHTML = '<span class="muted" style="font-size:11px;">Dibuja para ver el preview.</span>';
      return;
    }
    var COL = { medida: '#1565c0', letra: '#00695c', angulo: '#c62828' };
    var etiq = '';
    _etiquetas.forEach(function(e, k) {
      var col = COL[e.tipo] || '#333';
      etiq += '<circle cx="' + e.x + '" cy="' + e.y + '" r="10" fill="#fff" opacity="0.9" data-eti="' + k + '" style="cursor:move;"/>';
      etiq += '<text x="' + e.x + '" y="' + (e.y + 4) + '" text-anchor="middle" fill="' + col + '" font-size="12" font-weight="700" data-eti="' + k + '" style="cursor:move;">' + String(e.texto).replace(/[<>&]/g, '') + '</text>';
    });
    // Fondo (figura) en un <foreignObject> que NO captura eventos (pointer-events
    // none) y con la imagen NO arrastrable → los clicks/drag caen sobre el SVG y
    // sus etiquetas, no sobre la imagen (bug: los clicks arrastraban la imagen).
    var fondoHTML = _fondoHTML.replace(/<img /gi, '<img draggable="false" ');
    var fondo = '<foreignObject x="0" y="0" width="' + PW + '" height="' + PH + '" style="pointer-events:none;">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center; pointer-events:none;">' + fondoHTML + '</div></foreignObject>';
    // Rect transparente que captura los clicks en toda el área (para colocar).
    var captura = _modo ? '<rect x="0" y="0" width="' + PW + '" height="' + PH + '" fill="transparent"/>' : '';
    var svg = '<svg id="disPreviewSvg" width="' + PW + '" height="' + PH + '" viewBox="0 0 ' + PW + ' ' + PH +
      '" style="max-width:100%; border-radius:4px; user-select:none; ' + (_modo ? 'cursor:crosshair;' : '') + '">' +
      fondo + captura + etiq + '</svg>';
    cont.innerHTML = svg;
    // Bind eventos (el SVG se recrea en cada render).
    var s = document.getElementById('disPreviewSvg');
    if (s && _modo) {
      s.addEventListener('click', _onClick);
      s.addEventListener('mousedown', _onDown);
    }
  }
  // Listeners globales de drag (una vez).
  window.addEventListener('mousemove', _onMove);
  window.addEventListener('mouseup', _onUp);

  global.previewEtiqRender = _render;
})(window);
