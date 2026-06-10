// Módulo: Matrices RCA por área
// Permite ver y editar las matrices Ishikawa (6 categorías + subcausas) de cada área.

var _rcaAreaId = null;
var _rcaData = null;  // { area, categorias[] }

var CAT_COLORS = {
  mano_de_obra:   { bg: '#fff8e1', border: '#f9a825', badge: '#f9a825' },
  metodo:         { bg: '#e8f5e9', border: '#388e3c', badge: '#388e3c' },
  material:       { bg: '#e3f2fd', border: '#1565c0', badge: '#1565c0' },
  maquina:        { bg: '#fce4ec', border: '#c62828', badge: '#c62828' },
  medicion:       { bg: '#f3e5f5', border: '#6a1b9a', badge: '#6a1b9a' },
  medio_ambiente: { bg: '#e0f2f1', border: '#00695c', badge: '#00695c' },
};

function _rcaFetch(path, options) {
  var opts = Object.assign({ headers: authHeaders() }, options || {});
  if (opts.body && opts.headers['Content-Type'] === undefined) {
    opts.headers = Object.assign({}, opts.headers, { 'Content-Type': 'application/json' });
  }
  return fetch(apiUrl(path), opts).then(function(r) {
    if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || r.status); });
    return r.json();
  });
}

function rcaIniciarTab() {
  document.getElementById('rcaAreasLista').innerHTML = '<div class="muted">Cargando áreas...</div>';
  document.getElementById('rcaEditor').style.display = 'none';
  document.getElementById('rcaVolverBtn').style.display = 'none';
  document.getElementById('rcaAreasLista').style.display = '';

  _rcaFetch('/admin/areas')
    .then(function(areas) { rcaRenderAreas(areas); })
    .catch(function() {
      document.getElementById('rcaAreasLista').innerHTML = '<div class="muted">Error cargando áreas.</div>';
    });
}

function rcaRenderAreas(areas) {
  var html = '<div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px;">';
  areas.forEach(function(a) {
    var badge = a.tiene_rca
      ? '<span style="font-size:10px; background:#e8f5e9; color:#2e7d32; padding:2px 8px; border-radius:10px; font-weight:600;">✓ ' + a.total_subcausas + ' sub-causas</span>'
      : '<span style="font-size:10px; background:#fff3e0; color:#e65100; padding:2px 8px; border-radius:10px; font-weight:600;">Sin matriz</span>';
    html += '<div onclick="rcaAbrirArea(' + a.id + ',\'' + a.nombre.replace(/'/g, "\\'") + '\')" '
      + 'style="padding:14px 16px; border:1px solid #e0e0e0; border-radius:8px; cursor:pointer; '
      + 'background:white; transition:box-shadow .15s;" '
      + 'onmouseover="this.style.boxShadow=\'0 2px 8px rgba(0,0,0,.12)\'" '
      + 'onmouseout="this.style.boxShadow=\'none\'">'
      + '<div style="font-weight:600; font-size:13px; margin-bottom:6px;">' + a.nombre + '</div>'
      + badge
      + '</div>';
  });
  html += '</div>';
  document.getElementById('rcaAreasLista').innerHTML = html;
}

function rcaAbrirArea(areaId, areaNombre) {
  _rcaAreaId = areaId;
  document.getElementById('rcaAreasLista').style.display = 'none';
  document.getElementById('rcaEditor').style.display = '';
  document.getElementById('rcaVolverBtn').style.display = '';
  document.getElementById('rcaEditorAreaNombre').textContent = areaNombre;
  document.getElementById('rcaCategoriasContainer').innerHTML = '<div class="muted">Cargando matriz...</div>';
  document.getElementById('rcaGuardarMsg').textContent = '';

  _rcaFetch('/admin/areas/' + areaId + '/rca')
    .then(function(data) {
      _rcaData = data;
      rcaRenderEditor(data.categorias);
    })
    .catch(function() {
      document.getElementById('rcaCategoriasContainer').innerHTML = '<div class="muted">Error cargando matriz.</div>';
    });
}

function rcaRenderEditor(categorias) {
  var html = '';
  categorias.forEach(function(cat, ci) {
    var col = CAT_COLORS[cat.slug] || { bg: '#f5f5f5', border: '#bbb', badge: '#888' };
    html += '<div style="margin-bottom:16px; border:1px solid ' + col.border + '; border-radius:8px; overflow:hidden;">';
    // Cabecera categoría
    html += '<div style="background:' + col.bg + '; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">';
    html += '<span style="font-weight:700; font-size:13px; color:' + col.badge + ';">' + cat.nombre + '</span>';
    html += '<button onclick="rcaAgregarSubcausa(' + ci + ')" style="font-size:11px; padding:3px 10px; background:' + col.badge + '; color:white; border:none; border-radius:4px; cursor:pointer;">+ Agregar</button>';
    html += '</div>';
    // Subcausas
    html += '<div id="rcaCat_' + ci + '" style="padding:8px 12px;">';
    if (!cat.subcausas || cat.subcausas.length === 0) {
      html += '<div class="muted" style="font-size:12px; padding:6px 0;">Sin sub-causas. Usa "+ Agregar" para comenzar.</div>';
    }
    cat.subcausas.forEach(function(sub, si) {
      html += rcaSubcausaRow(ci, si, sub);
    });
    html += '</div>';
    html += '</div>';
  });
  document.getElementById('rcaCategoriasContainer').innerHTML = html;
}

function rcaSubcausaRow(ci, si, sub) {
  var opacidad = sub.activo ? '1' : '0.45';
  return '<div id="rcaRow_' + ci + '_' + si + '" style="display:flex; gap:8px; align-items:center; margin-bottom:6px; opacity:' + opacidad + ';">'
    + '<input type="text" value="' + _esc(sub.codigo) + '" placeholder="Cód." '
    + 'style="width:64px; font-size:11px; font-family:monospace; padding:4px 6px; border:1px solid #ccc; border-radius:4px;" '
    + 'oninput="rcaUpdateSub(' + ci + ',' + si + ',\'codigo\',this.value)" />'
    + '<input type="text" value="' + _esc(sub.descripcion) + '" placeholder="Descripción" '
    + 'style="flex:1; font-size:12px; padding:4px 8px; border:1px solid #ccc; border-radius:4px;" '
    + 'oninput="rcaUpdateSub(' + ci + ',' + si + ',\'descripcion\',this.value)" />'
    + '<button title="' + (sub.activo ? 'Desactivar' : 'Activar') + '" '
    + 'onclick="rcaToggleActivo(' + ci + ',' + si + ')" '
    + 'style="font-size:11px; padding:3px 8px; border:1px solid #ccc; border-radius:4px; cursor:pointer; background:' + (sub.activo ? '#fff' : '#eee') + ';">'
    + (sub.activo ? '✓' : '✗') + '</button>'
    + '<button title="Eliminar" onclick="rcaEliminarSub(' + ci + ',' + si + ')" '
    + 'style="font-size:11px; padding:3px 8px; border:none; border-radius:4px; cursor:pointer; background:#ffebee; color:#c62828;">✕</button>'
    + '</div>';
}

function _esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

function rcaUpdateSub(ci, si, campo, valor) {
  if (_rcaData && _rcaData.categorias[ci] && _rcaData.categorias[ci].subcausas[si]) {
    _rcaData.categorias[ci].subcausas[si][campo] = valor;
  }
}

function rcaToggleActivo(ci, si) {
  if (!_rcaData) return;
  var sub = _rcaData.categorias[ci].subcausas[si];
  sub.activo = !sub.activo;
  // Re-render solo esa fila
  var rowEl = document.getElementById('rcaRow_' + ci + '_' + si);
  if (rowEl) rowEl.outerHTML = rcaSubcausaRow(ci, si, sub);
}

function rcaEliminarSub(ci, si) {
  if (!_rcaData) return;
  _rcaData.categorias[ci].subcausas.splice(si, 1);
  rcaRenderEditor(_rcaData.categorias);
}

function rcaAgregarSubcausa(ci) {
  if (!_rcaData) return;
  var cat = _rcaData.categorias[ci];
  var prefix = { mano_de_obra:'MO', metodo:'MD', material:'MT', maquina:'MQ', medicion:'ME', medio_ambiente:'MA' }[cat.slug] || 'XX';
  var n = (cat.subcausas ? cat.subcausas.length : 0) + 1;
  cat.subcausas = cat.subcausas || [];
  cat.subcausas.push({ id: null, codigo: prefix + String(n).padStart(2,'0'), descripcion: '', activo: true, orden: n });
  rcaRenderEditor(_rcaData.categorias);
}

function rcaGuardar() {
  if (!_rcaData || !_rcaAreaId) return;
  document.getElementById('rcaGuardarMsg').textContent = 'Guardando...';

  _rcaFetch('/admin/areas/' + _rcaAreaId + '/rca', {
    method: 'PUT',
    headers: Object.assign({}, authHeaders(), { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ categorias: _rcaData.categorias })
  })
    .then(function() {
      document.getElementById('rcaGuardarMsg').textContent = '✓ Guardado correctamente';
      setTimeout(function() { document.getElementById('rcaGuardarMsg').textContent = ''; }, 3000);
    })
    .catch(function(err) {
      document.getElementById('rcaGuardarMsg').textContent = 'Error al guardar: ' + (err.message || err);
    });
}

function rcaVolverAreas() {
  _rcaAreaId = null;
  _rcaData = null;
  document.getElementById('rcaEditor').style.display = 'none';
  document.getElementById('rcaVolverBtn').style.display = 'none';
  document.getElementById('rcaAreasLista').style.display = '';
  rcaIniciarTab();
}
