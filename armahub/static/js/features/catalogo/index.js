// ArmaHub — Caluga Catálogo Armacero (5M.1)
// Data maestra de figuras y tipologías de fierro (catálogo ÚNICO). Fase 1: solo
// lectura. La edición (crear/modificar figuras) llega en Fase 8. Lo consumen el
// Bar Manager (validación/filtros de barras) y, a futuro, el render y la homologación.

(function(global) {
  var _figurasData = [];
  var _tipologiasData = [];
  var _catSubActual = 'figuras';

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  async function loadCatalogoModule() {
    await Promise.all([_cargarFiguras(), _cargarTipologias()]);
    _poblarFiltroEstructura();
    switchCatSubTab(_catSubActual);
  }

  function switchCatSubTab(sub) {
    _catSubActual = sub;
    var panels = { figuras: 'catSubFiguras', tipologias: 'catSubTipologias', disenador: 'catSubDisenador' };
    var btns = { figuras: 'catSubBtnFiguras', tipologias: 'catSubBtnTipologias', disenador: 'catSubBtnDisenador' };
    var colors = { figuras: '#5d4037', tipologias: '#6d4c41', disenador: '#00695c' };
    Object.keys(panels).forEach(function(k) {
      var p = document.getElementById(panels[k]);
      if (p) p.style.display = (k === sub) ? '' : 'none';
      var b = document.getElementById(btns[k]);
      if (b) {
        b.style.borderBottomColor = (k === sub) ? colors[sub] : 'transparent';
        b.style.color = (k === sub) ? colors[sub] : '#999';
      }
    });
    if (sub === 'figuras') renderFigurasLista();
    else if (sub === 'tipologias') renderTipologiasLista();
    else if (sub === 'disenador' && typeof disenadorInit === 'function') disenadorInit(_figurasData);
  }

  async function _cargarFiguras() {
    var data = await apiGet('/figuras-catalogo');
    _figurasData = (data && data.figuras) || [];
  }
  async function _cargarTipologias() {
    var data = await apiGet('/tipologias');
    _tipologiasData = (data && data.tipologias) || [];
  }

  // ---- Figuras ----
  var _reintentoMotor = false;
  function renderFigurasLista() {
    var cont = document.getElementById('figurasLista');
    if (!cont) return;
    // Si hay figuras con geometría pero el motor de dibujo aún no cargó (timing de
    // scripts), reintentar una vez cuando esté disponible (para ver el render).
    var hayGeom = _figurasData.some(function(f) { return f.geometria && f.geometria.tramos && f.geometria.tramos.length; });
    if (hayGeom && (!window.disenadorMotor || !window.disenadorMotor.dibujarFigura) && !_reintentoMotor) {
      _reintentoMotor = true;
      setTimeout(function() { if (_catSubActual === 'figuras') renderFigurasLista(); }, 400);
    }
    var busq = ((document.getElementById('catFigBusqueda') || {}).value || '').trim().toLowerCase();
    var rows = _figurasData.filter(function(f) {
      return !busq || (f.codigo || '').toLowerCase().indexOf(busq) !== -1;
    });
    var res = document.getElementById('catFigResumen');
    if (res) res.textContent = _figurasData.length + ' figuras';
    if (rows.length === 0) {
      cont.innerHTML = '<div class="muted">No hay figuras con ese filtro.</div>';
      return;
    }
    // Mini-render de la figura (si tiene geometría del Diseñador). Degrada a "—".
    function _miniFig(f) {
      if (!f.geometria || !f.geometria.tramos || !f.geometria.tramos.length) return '<span class="muted" style="font-size:11px;">—</span>';
      if (!window.disenadorMotor || !window.disenadorMotor.dibujarFigura) return '<span class="muted" style="font-size:11px;">—</span>';
      try { return window.disenadorMotor.dibujarFigura(f.geometria, null, { width: 80, height: 54 }); }
      catch (e) { return '<span class="muted" style="font-size:11px;">—</span>'; }
    }
    cont.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
      '<tr style="background:#f5f5f5; text-align:left;">' +
        '<th style="padding:5px 6px;">Código</th>' +
        '<th style="padding:5px 6px; text-align:center;">Figura</th>' +
        '<th style="padding:5px 6px;">Lados (dims)</th>' +
        '<th style="padding:5px 6px; text-align:center;">N° lados</th>' +
        '<th style="padding:5px 6px;">Ángulos</th>' +
        '<th style="padding:5px 6px; text-align:center;">Radio</th>' +
      '</tr>' +
      rows.map(function(f) {
        var parc = (f.parciales || []).join(', ');
        var ang = (f.angulos || []).length ? (f.angulos.join('°, ') + '°') : '—';
        return '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:4px 6px; font-weight:600;">' + _esc(f.codigo) + '</td>' +
          '<td style="padding:4px 6px; text-align:center;">' + _miniFig(f) + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + _esc(parc || '—') + '</td>' +
          '<td style="padding:4px 6px; text-align:center;">' + (f.parciales || []).length + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + _esc(ang) + '</td>' +
          '<td style="padding:4px 6px; text-align:center;">' + (f.radio ? '✓' : '—') + '</td>' +
          '</tr>';
      }).join('') +
      '</table>' +
      '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + rows.length + ' de ' + _figurasData.length + ' figura(s)</div>';
  }

  // ---- Tipologías ----
  function _poblarFiltroEstructura() {
    var sel = document.getElementById('catTipFiltroEstructura');
    if (!sel) return;
    var estructuras = [];
    _tipologiasData.forEach(function(t) {
      if (estructuras.indexOf(t.estructura) === -1) estructuras.push(t.estructura);
    });
    var prev = sel.value;
    sel.innerHTML = '<option value="">Estructura: Todas</option>' +
      estructuras.map(function(e) { return '<option value="' + _esc(e) + '">' + _esc(e) + '</option>'; }).join('');
    sel.value = prev;
  }

  function renderTipologiasLista() {
    var cont = document.getElementById('tipologiasLista');
    if (!cont) return;
    var fEst = (document.getElementById('catTipFiltroEstructura') || {}).value || '';
    var busq = ((document.getElementById('catTipBusqueda') || {}).value || '').trim().toLowerCase();
    var rows = _tipologiasData.filter(function(t) {
      if (fEst && t.estructura !== fEst) return false;
      if (busq) {
        var blob = ((t.codigo || '') + ' ' + (t.nombre || '') + ' ' + (t.estructura || '')).toLowerCase();
        if (blob.indexOf(busq) === -1) return false;
      }
      return true;
    });
    var res = document.getElementById('catTipResumen');
    if (res) res.textContent = _tipologiasData.length + ' tipologías';
    if (rows.length === 0) {
      cont.innerHTML = '<div class="muted">No hay tipologías con ese filtro.</div>';
      return;
    }
    cont.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
      '<tr style="background:#f5f5f5; text-align:left;">' +
        '<th style="padding:5px 6px;">Estructura</th>' +
        '<th style="padding:5px 6px;">Código</th>' +
        '<th style="padding:5px 6px;">Nombre</th>' +
        '<th style="padding:5px 6px;">Figuras aplicables</th>' +
      '</tr>' +
      rows.map(function(t) {
        return '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:4px 6px; font-size:11px;">' + _esc(t.estructura) + '</td>' +
          '<td style="padding:4px 6px; font-weight:600;">' + _esc(t.codigo) + '</td>' +
          '<td style="padding:4px 6px;">' + _esc(t.nombre) + '</td>' +
          '<td style="padding:4px 6px; font-size:11px;">' + _esc((t.figuras || []).join(', ') || '—') + '</td>' +
          '</tr>';
      }).join('') +
      '</table>' +
      '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + rows.length + ' de ' + _tipologiasData.length + ' tipología(s)</div>';
  }

  global.loadCatalogoModule = loadCatalogoModule;
  global.switchCatSubTab = switchCatSubTab;
  global.renderFigurasLista = renderFigurasLista;
  global.renderTipologiasLista = renderTipologiasLista;
})(window);
