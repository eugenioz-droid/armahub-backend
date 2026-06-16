// ArmaHub Reclamos — Dashboards
// Split from index.js (PC.17.3)

var _recLandChartHist = null;
let _recDashHist = null, _recDashResueltos = null, _recDashTipo = null;
let _recDashUSC = null, _recDashCubAsig = null, _recDashIshikawa = null, _recDashKilos = null;
let _recDashProyecto = null, _recDashProyectoMes = null;
var _adminDashLoaded = false;
var _recLandChartResueltos = null;

// ── Sub-tabs Nivel 2 (dentro de tab-reclamos) ──
var _rcaRecAreaId = null;
var _rcaRecData = null;

// Sub-tab Nivel 2 actualmente activo. Fuente de verdad para restaurar la
// posición tras F5 sin parpadeo. Default 'clientes' (primer sub-tab).
var _recSubTabActual = 'clientes';

// Metadatos de los 5 sub-tabs en un solo lugar: panel, color, botón y qué
// roles pueden verlo. Clientes/Internos: todos los roles del módulo. Matriz
// RCA / Presentaciones / Validaciones: restringidos. Único flujo para los 5.
var REC_SUBTABS = {
  clientes:      { panel: 'recSubClientes',       btn: 'recSubBtnClientes', color: '#e53935', roles: null },
  internos:      { panel: 'recSubInternos',       btn: 'recSubBtnInternos', color: '#1565C0', roles: null },
  rca:           { panel: 'recSubRCA',            btn: 'recSubBtnRCA',      color: '#e65100', roles: ['admin','admin_calidad'] },
  presentaciones:{ panel: 'recSubPresentaciones', btn: 'recSubBtnPres',     color: '#7B1FA2', roles: ['admin','admin_calidad','cubicador','externo'] },
  validaciones:  { panel: 'recSubValidaciones',   btn: 'recSubBtnVal',      color: '#7B1FA2', roles: ['admin','admin_calidad'] }
};

// ¿El rol actual puede ver este sub-tab? roles=null → visible para todos.
function _recSubTabVisible(key) {
  var cfg = REC_SUBTABS[key];
  if (!cfg) return false;
  if (!cfg.roles) return true;
  return cfg.roles.indexOf(currentRole) !== -1;
}

// Muestra/oculta los BOTONES de los 5 sub-tabs según rol. Síncrono (solo
// depende de currentRole y del DOM estático), se llama al montar el módulo
// antes de cualquier carga async para que los títulos aparezcan de inmediato.
function _applyRecSubTabsVisibility() {
  Object.keys(REC_SUBTABS).forEach(function(key) {
    var btn = document.getElementById(REC_SUBTABS[key].btn);
    if (btn) btn.style.display = _recSubTabVisible(key) ? '' : 'none';
  });
}

function switchRecSubTab(sub) {
  // Guardia: si el sub-tab pedido no es visible para el rol, caer a 'clientes'
  // (siempre disponible). Evita restaurar desde hash a un tab prohibido.
  if (!_recSubTabVisible(sub)) sub = 'clientes';
  _recSubTabActual = sub;

  Object.keys(REC_SUBTABS).forEach(function(key) {
    var cfg = REC_SUBTABS[key];
    var el = document.getElementById(cfg.panel);
    if (el) el.style.display = (key === sub) ? '' : 'none';
    var btn = document.getElementById(cfg.btn);
    if (btn) {
      btn.style.borderBottomColor = (key === sub) ? cfg.color : 'transparent';
      btn.style.color = (key === sub) ? cfg.color : '#999';
    }
  });

  if (sub === 'rca') { rcaRecIniciar(); }
  if (sub === 'presentaciones') {
    var src = document.getElementById('recTabPresentaciones');
    var dst = document.getElementById('recSubPresentaciones');
    if (src && dst && dst.children.length === 0) {
      while (src.firstChild) dst.appendChild(src.firstChild);
    }
    loadPresentaciones();
  }
  if (sub === 'validaciones') { _ensureModalFueraDeSubpaneles(); loadRecValidaciones(); }
  if (sub === 'internos') { _ensureModalFueraDeSubpaneles(); if (typeof loadReclamosInternos === 'function') loadReclamosInternos(); if (typeof initInternosForm === 'function') initInternosForm(); }

  if (typeof window.__armahubUpdateNavHash === 'function') {
    window.__armahubUpdateNavHash(window.currentModule, 'reclamos', sub);
  }
}

// El modal de detalle (reclamoDetailCard) y su backdrop viven dentro de
// recSubClientes, que se oculta al cambiar de sub-tab. Para que el modal se pueda
// abrir desde cualquier sub-tab (ej. Validaciones), lo movemos una vez al
// contenedor raíz del tab (tab-reclamos), que siempre está visible.
var _modalReparented = false;
function _ensureModalFueraDeSubpaneles() {
  if (_modalReparented) return;
  var root = document.getElementById('tab-reclamos');
  var card = document.getElementById('reclamoDetailCard');
  var backdrop = document.getElementById('recModalBackdrop');
  if (!root || !card) return;
  root.appendChild(card);
  if (backdrop) root.appendChild(backdrop);
  _modalReparented = true;
}

// ── RCA dentro de Calidad/Reclamos ──
function rcaRecIniciar() {
  var lista = document.getElementById('rcaRecAreasLista');
  var editor = document.getElementById('rcaRecEditor');
  var volverBtn = document.getElementById('rcaRecVolverBtn');
  if (!lista) return;
  lista.innerHTML = '<div class="muted">Cargando áreas...</div>';
  editor.style.display = 'none';
  volverBtn.style.display = 'none';
  lista.style.display = '';

  fetch(apiUrl('/admin/areas'), { headers: authHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(areas) { rcaRecRenderAreas(areas); })
    .catch(function() { lista.innerHTML = '<div class="muted">Error cargando áreas.</div>'; });
}

var CAT_COLORS_REC = {
  mano_de_obra:   { bg:'#fff8e1', border:'#f9a825', badge:'#f9a825' },
  metodo:         { bg:'#e8f5e9', border:'#388e3c', badge:'#388e3c' },
  material:       { bg:'#e3f2fd', border:'#1565c0', badge:'#1565c0' },
  maquina:        { bg:'#fce4ec', border:'#c62828', badge:'#c62828' },
  medicion:       { bg:'#f3e5f5', border:'#6a1b9a', badge:'#6a1b9a' },
  medio_ambiente: { bg:'#e0f2f1', border:'#00695c', badge:'#00695c' },
};

function rcaRecRenderAreas(areas) {
  var html = '<div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px;">';
  areas.forEach(function(a) {
    var badge = a.tiene_rca
      ? '<span style="font-size:10px; background:#e8f5e9; color:#2e7d32; padding:2px 8px; border-radius:10px; font-weight:600;">✓ ' + a.total_subcausas + ' sub-causas</span>'
      : '<span style="font-size:10px; background:#fff3e0; color:#e65100; padding:2px 8px; border-radius:10px; font-weight:600;">Sin matriz</span>';
    html += '<div onclick="rcaRecAbrirArea(' + a.id + ',\'' + a.nombre.replace(/'/g,"\\'") + '\')" '
      + 'style="padding:14px 16px; border:1px solid #e0e0e0; border-radius:8px; cursor:pointer; background:white; transition:box-shadow .15s;" '
      + 'onmouseover="this.style.boxShadow=\'0 2px 8px rgba(0,0,0,.12)\'" onmouseout="this.style.boxShadow=\'none\'">'
      + '<div style="font-weight:600; font-size:13px; margin-bottom:6px;">' + a.nombre + '</div>' + badge + '</div>';
  });
  html += '</div>';
  document.getElementById('rcaRecAreasLista').innerHTML = html;
}

function rcaRecAbrirArea(areaId, areaNombre) {
  _rcaRecAreaId = areaId;
  document.getElementById('rcaRecAreasLista').style.display = 'none';
  document.getElementById('rcaRecEditor').style.display = '';
  document.getElementById('rcaRecVolverBtn').style.display = '';
  document.getElementById('rcaRecEditorNombre').textContent = areaNombre;
  document.getElementById('rcaRecCategoriasContainer').innerHTML = '<div class="muted">Cargando matriz...</div>';
  document.getElementById('rcaRecGuardarMsg').textContent = '';

  fetch(apiUrl('/admin/areas/' + areaId + '/rca'), { headers: authHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(data) { _rcaRecData = data; rcaRecRenderEditor(data.categorias); })
    .catch(function() { document.getElementById('rcaRecCategoriasContainer').innerHTML = '<div class="muted">Error cargando matriz.</div>'; });
}

function rcaRecRenderEditor(categorias) {
  var SLUGS = ['mano_de_obra','metodo','material','maquina','medicion','medio_ambiente'];
  var html = '';
  categorias.forEach(function(cat, ci) {
    var col = CAT_COLORS_REC[cat.slug] || { bg:'#f5f5f5', border:'#bbb', badge:'#888' };
    html += '<div style="margin-bottom:14px; border:1px solid ' + col.border + '; border-radius:8px; overflow:hidden;">';
    html += '<div style="background:' + col.bg + '; padding:8px 14px; display:flex; justify-content:space-between; align-items:center;">';
    html += '<span style="font-weight:700; font-size:13px; color:' + col.badge + ';">' + cat.nombre + '</span>';
    html += '<button onclick="rcaRecAgregarSub(' + ci + ')" style="font-size:11px; padding:3px 10px; background:' + col.badge + '; color:white; border:none; border-radius:4px; cursor:pointer;">+ Agregar</button>';
    html += '</div><div style="padding:8px 12px;">';
    if (!cat.subcausas || cat.subcausas.length === 0) {
      html += '<div class="muted" style="font-size:12px; padding:4px 0;">Sin sub-causas.</div>';
    }
    (cat.subcausas || []).forEach(function(sub, si) { html += rcaRecSubRow(ci, si, sub); });
    html += '</div></div>';
  });
  document.getElementById('rcaRecCategoriasContainer').innerHTML = html;
}

function rcaRecSubRow(ci, si, sub) {
  var op = sub.activo ? '1' : '0.45';
  return '<div id="rcaRecRow_' + ci + '_' + si + '" style="display:flex; gap:8px; align-items:center; margin-bottom:6px; opacity:' + op + ';">'
    + '<input type="text" value="' + _rcaEsc(sub.codigo) + '" placeholder="Cód." style="width:64px; font-size:11px; font-family:monospace; padding:4px 6px; border:1px solid #ccc; border-radius:4px;" oninput="rcaRecUpd(' + ci + ',' + si + ',\'codigo\',this.value)" />'
    + '<input type="text" value="' + _rcaEsc(sub.descripcion) + '" placeholder="Descripción" style="flex:1; font-size:12px; padding:4px 8px; border:1px solid #ccc; border-radius:4px;" oninput="rcaRecUpd(' + ci + ',' + si + ',\'descripcion\',this.value)" />'
    + '<button onclick="rcaRecToggle(' + ci + ',' + si + ')" title="' + (sub.activo ? 'Activa — clic para desactivar' : 'Inactiva — clic para activar') + '" style="font-size:13px; font-weight:700; padding:3px 9px; border:1px solid ' + (sub.activo ? '#2e7d32' : '#ccc') + '; border-radius:4px; cursor:pointer; background:' + (sub.activo ? '#e8f5e9' : '#eee') + '; color:' + (sub.activo ? '#2e7d32' : '#999') + ';">✔</button>'
    + '<button onclick="rcaRecEliminar(' + ci + ',' + si + ')" style="font-size:11px; padding:3px 8px; border:none; border-radius:4px; cursor:pointer; background:#ffebee; color:#c62828;">✕</button>'
    + '</div>';
}

function _rcaEsc(s) { return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function rcaRecUpd(ci, si, campo, val) { if (_rcaRecData) _rcaRecData.categorias[ci].subcausas[si][campo] = val; }
function rcaRecToggle(ci, si) {
  if (!_rcaRecData) return;
  var sub = _rcaRecData.categorias[ci].subcausas[si];
  sub.activo = !sub.activo;
  var row = document.getElementById('rcaRecRow_' + ci + '_' + si);
  if (row) row.outerHTML = rcaRecSubRow(ci, si, sub);
}
function rcaRecEliminar(ci, si) {
  if (!_rcaRecData) return;
  _rcaRecData.categorias[ci].subcausas.splice(si, 1);
  rcaRecRenderEditor(_rcaRecData.categorias);
}
function rcaRecAgregarSub(ci) {
  if (!_rcaRecData) return;
  var cat = _rcaRecData.categorias[ci];
  var pfx = { mano_de_obra:'MO', metodo:'MD', material:'MT', maquina:'MQ', medicion:'ME', medio_ambiente:'MA' }[cat.slug] || 'XX';
  var n = (cat.subcausas ? cat.subcausas.length : 0) + 1;
  cat.subcausas = cat.subcausas || [];
  cat.subcausas.push({ id: null, codigo: pfx + String(n).padStart(2,'0'), descripcion: '', activo: true, orden: n });
  rcaRecRenderEditor(_rcaRecData.categorias);
}
function rcaRecGuardar() {
  if (!_rcaRecData || !_rcaRecAreaId) return;
  var msg = document.getElementById('rcaRecGuardarMsg');
  msg.textContent = 'Guardando...';
  fetch(apiUrl('/admin/areas/' + _rcaRecAreaId + '/rca'), {
    method: 'PUT',
    headers: Object.assign({}, authHeaders(), { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ categorias: _rcaRecData.categorias })
  }).then(function(r) { return r.json(); })
    .then(function() {
      msg.textContent = '✓ Guardado';
      // Invalidar el cache de Ishikawa: la matriz recién guardada debe
      // reflejarse sin F5 en el selector de método RCA de los reclamos de
      // esta área, en vez de quedarse con la versión leída antes de guardar.
      if (typeof _ishikawaData !== 'undefined') _ishikawaData = null;
      setTimeout(function() { msg.textContent=''; }, 3000);
    })
    .catch(function(e) { msg.textContent = 'Error: ' + (e.message || e); });
}
function rcaRecVolverAreas() {
  _rcaRecAreaId = null; _rcaRecData = null;
  document.getElementById('rcaRecEditor').style.display = 'none';
  document.getElementById('rcaRecVolverBtn').style.display = 'none';
  document.getElementById('rcaRecAreasLista').style.display = '';
  rcaRecIniciar();
}

async function loadRecLanding() {
  var data = await apiGet('/reclamos/mi-resumen');
  if (!data) return;

  var isAdmin = (currentRole === 'admin' || currentRole === 'admin_calidad' || currentRole === 'coordinador');
  var titleEl = document.querySelector('#recLandingCharts').parentElement.querySelector('h3');
  if (titleEl) titleEl.textContent = isAdmin ? 'Resumen General' : 'Mi Resumen';

  // Chart 1: KPI
  document.getElementById('recLandTotal').textContent = data.total || 0;
  document.getElementById('recLandAbiertos').textContent = (data.abiertos || 0) + ' abiertos';

  // Chart 2: Estados (reemplaza Resueltos vs No Resueltos)
  var porEstado = data.por_estado || {};

  // Convertir a array si viene como objeto (landing page)
  if (!Array.isArray(porEstado)) {
    porEstado = Object.keys(porEstado).map(estado => ({
      estado: estado,
      count: porEstado[estado]
    }));
  }
  
  var estados = porEstado.map(item => item.estado);
  var valores = porEstado.map(item => item.count);
  
  // Preparar datos para el gráfico de torta
  var labels = porEstado.map(item => {
    var estado = item.estado;
    var label = _recEstadoLabels[estado] || estado;
    var count = item.count;
    return `${label} (${count})`;
  });
  var colors = estados.map(estado => _recEstadoColors[estado] || '#999');
  
  _recLandChartResueltos = replaceChart(_recLandChartResueltos, document.getElementById('recLandChartResueltos'), {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{ 
        data: valores, 
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false,
      plugins: { 
        legend: { 
          position: 'bottom', 
          labels: { 
            font: { size: 11 }, 
            padding: 10,
            usePointStyle: true,
            pointStyle: 'circle'
          } 
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              var item = porEstado[context.dataIndex];
              var estado = item.estado;
              var label = _recEstadoLabels[estado] || estado;
              var value = item.count;
              var total = context.dataset.data.reduce((a, b) => a + b, 0);
              var percentage = ((value / total) * 100).toFixed(1);
              return `${label}: ${value} (${percentage}%)`;
            }
          }
        }
      }
    }
  });

  // Chart 3: Historical monthly bar (grouped by year, using fecha_deteccion from backend)
  var _mesNombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  var _anioColores = ['#e53935','#1565C0','#2e7d32','#ff9800','#7B1FA2','#00897B'];
  var anioMesData = data.por_anio_mes || [];
  var aniosSet = {};
  anioMesData.forEach(function(d) { aniosSet[d.anio] = true; });
  var anios = Object.keys(aniosSet).map(Number).sort();
  var datasets = anios.map(function(anio, idx) {
    var counts = new Array(12).fill(0);
    anioMesData.forEach(function(d) { if (d.anio === anio) counts[d.mes - 1] = d.count; });
    return { label: '' + anio, data: counts, backgroundColor: _anioColores[idx % _anioColores.length], borderRadius: 2 };
  });
  _recLandChartHist = replaceChart(_recLandChartHist, document.getElementById('recLandChartHist'), {
    type: 'bar',
    data: { labels: _mesNombres, datasets: datasets },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: anios.length > 1, labels: { font: { size: 9 } } } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 } } },
                x: { ticks: { font: { size: 9 } } } } }
  });

  // Pending tasks badge (cubicador only)
  var pendWrap = document.getElementById('recLandPendientesWrap');
  var pendCount = data.pendientes || 0;
  if (pendWrap) {
    if (currentRole === 'cubicador' && pendCount > 0) {
      pendWrap.style.display = '';
      document.getElementById('recLandPendientes').textContent = pendCount;
    } else {
      pendWrap.style.display = 'none';
    }
  }
}

async function loadRecAdminDashboards() {
  if (_adminDashLoaded) return;
  var data = await apiGet('/reclamos/admin-dashboards');
  if (!data) return;
  _adminDashLoaded = true;

  var _mesNombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  var _anioColores = ['#e53935','#1565C0','#2e7d32','#ff9800','#7B1FA2','#00897B'];

  // KPI
  document.getElementById('recDashTotal').textContent = data.total || 0;
  document.getElementById('recDashAbiertos').textContent = (data.abiertos || 0);

  // Chart 1: Historico mensual (multi-year grouped bar)
  var anioMesData = data.por_anio_mes || [];
  var aniosSet = {};
  anioMesData.forEach(function(d) { aniosSet[d.anio] = true; });
  var anios = Object.keys(aniosSet).map(Number).sort();
  var histDS = anios.map(function(anio, idx) {
    var counts = new Array(12).fill(0);
    anioMesData.forEach(function(d) { if (d.anio === anio) counts[d.mes - 1] = d.count; });
    return { label: '' + anio, data: counts, backgroundColor: _anioColores[idx % _anioColores.length], borderRadius: 2 };
  });
  _recDashHist = replaceChart(_recDashHist, document.getElementById('recDashChartHist'), {
    type: 'bar',
    data: { labels: _mesNombres, datasets: histDS },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: anios.length > 1, labels: { font: { size: 9 } } },
        datalabels: { display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, anchor: 'end', align: 'end', color: '#333', font: { size: 8, weight: 'bold' } } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 } } }, x: { ticks: { font: { size: 9 } } } } },
    plugins: [ChartDataLabels]
  });

  // Chart 2: Estados (reemplaza Resueltos vs No Resueltos)
  var porEstado = data.por_estado || [];
  // Normalizar: si viene como dict legacy, convertir a array
  if (!Array.isArray(porEstado)) {
    porEstado = Object.keys(porEstado).map(function(k) { return {estado: k, count: porEstado[k]}; });
  }
  var estados = porEstado.map(function(item) { return item.estado; });
  var valores = porEstado.map(function(item) { return item.count; });
  
  // Preparar datos para el gráfico de torta
  var labels = porEstado.map(function(item) {
    var label = _recEstadoLabels[item.estado] || item.estado;
    return `${label} (${item.count})`;
  });
  var colors = estados.map(function(estado) { return _recEstadoColors[estado] || '#999'; });
  
  _recDashResueltos = replaceChart(_recDashResueltos, document.getElementById('recDashChartResueltos'), {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{ 
        data: valores, 
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false,
      plugins: { 
        legend: { 
          position: 'bottom', 
          labels: { 
            font: { size: 10 }, 
            padding: 6,
            usePointStyle: true,
            pointStyle: 'circle'
          } 
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              var item = porEstado[context.dataIndex];
              var estado = item.estado;
              var label = _recEstadoLabels[estado] || estado;
              var value = item.count;
              var total = context.dataset.data.reduce((a, b) => a + b, 0);
              var percentage = ((value / total) * 100).toFixed(1);
              return `${label}: ${value} (${percentage}%)`;
            }
          }
        },
        datalabels: { 
          display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, 
          color: '#fff', 
          font: { size: 10, weight: 'bold' } 
        }
      }
    },
    plugins: [ChartDataLabels]
  });

  // Chart 3: Tipo Error/Faltante/Atraso/Actualización Portal
  var pt = data.por_tipo || {};
  var errC = pt.error || 0; var falC = pt.faltante || 0; var atrC = pt.atraso || 0; var actC = pt.actualizacion_portal || 0;
  _recDashTipo = replaceChart(_recDashTipo, document.getElementById('recDashChartTipo'), {
    type: 'doughnut',
    data: { labels: ['Error (' + errC + ')', 'Faltante (' + falC + ')', 'Atraso (' + atrC + ')', 'Actualización Portal (' + actC + ')'],
            datasets: [{ data: [errC, falC, atrC, actC], backgroundColor: ['#e53935','#ff9800','#7B1FA2','#00897B'] }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 6 } },
        datalabels: { display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, color: '#fff', font: { size: 11, weight: 'bold' } } } },
    plugins: [ChartDataLabels]
  });

  // Chart 4: Detectados por USC (horizontal bar)
  var uscData = data.por_usc || [];
  var uscLabels = uscData.map(function(d) { return d.email.split('@')[0]; });
  var uscTotals = uscData.map(function(d) { return d.total; });
  _recDashUSC = destroyChart(_recDashUSC);
  if (uscData.length > 0) {
    _recDashUSC = replaceChart(_recDashUSC, document.getElementById('recDashChartUSC'), {
      type: 'bar',
      data: { labels: uscLabels, datasets: [
        { label: 'Error', data: uscData.map(function(d) { return d.errores; }), backgroundColor: '#e53935' },
        { label: 'Faltante', data: uscData.map(function(d) { return d.faltantes; }), backgroundColor: '#ff9800' },
        { label: 'Atraso', data: uscData.map(function(d) { return d.atrasos; }), backgroundColor: '#7B1FA2' },
        { label: 'Actualización Portal', data: uscData.map(function(d) { return d.actualizaciones || 0; }), backgroundColor: '#00897B' }
      ]},
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { labels: { font: { size: 9 } } },
          datalabels: { display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, color: '#fff', font: { size: 8, weight: 'bold' } } },
        scales: { x: { stacked: true, beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 } } }, y: { stacked: true, ticks: { font: { size: 9 } } } } },
      plugins: [ChartDataLabels]
    });
  } else {
    document.getElementById('recDashChartUSC').parentElement.innerHTML = '<div class="muted" style="text-align:center; padding:40px 0; font-size:12px;">Sin datos USC aún</div>';
  }

  // Chart 5: Por cubicador asignado (donut)
  var cubAsigData = data.por_cubicador_asignado || [];
  _recDashCubAsig = destroyChart(_recDashCubAsig);
  var cubAsigColors = ['#2e7d32','#1565C0','#ff9800','#e53935','#7B1FA2','#00897B','#795548','#607D8B'];
  var cubAsigLabels = cubAsigData.map(function(d, i) {
    var label = d.cubicador.includes('@') ? d.cubicador.split('@')[0] : d.cubicador;
    return label + ' (' + d.count + ')';
  });
  _recDashCubAsig = replaceChart(_recDashCubAsig, document.getElementById('recDashChartCubAsig'), {
    type: 'doughnut',
    data: { labels: cubAsigLabels,
            datasets: [{ data: cubAsigData.map(function(d) { return d.count; }),
                         backgroundColor: cubAsigColors.slice(0, cubAsigData.length) }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, padding: 5 } },
        datalabels: { display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, color: '#fff', font: { size: 10, weight: 'bold' } } } },
    plugins: [ChartDataLabels]
  });

  // Chart 6: Causas Ishikawa global (donut)
  var ishData = data.ishikawa_global || [];
  _recDashIshikawa = destroyChart(_recDashIshikawa);
  if (ishData.length > 0) {
    var ishLabels = ishData.map(function(d) { return (_recCatLabels[d.categoria] || d.categoria) + ' (' + d.count + ')'; });
    var ishValues = ishData.map(function(d) { return d.count; });
    var ishColors = ishData.map(function(d) { return _recCatColors[d.categoria] || '#BDBDBD'; });
    _recDashIshikawa = replaceChart(_recDashIshikawa, document.getElementById('recDashChartIshikawa'), {
      type: 'doughnut',
      data: { labels: ishLabels, datasets: [{ data: ishValues, backgroundColor: ishColors }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, padding: 4 } },
          datalabels: { display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, color: '#fff', font: { size: 10, weight: 'bold' } } } },
      plugins: [ChartDataLabels]
    });
  } else {
    document.getElementById('recDashChartIshikawa').parentElement.innerHTML = '<div class="muted" style="text-align:center; padding:40px 0; font-size:12px;">Sin causas registradas</div>';
  }

  // Chart 7: Kilos mal fabricados por cubicador (horizontal bar)
  var kilosData = data.kilos_por_cubicador || [];
  _recDashKilos = destroyChart(_recDashKilos);
  if (kilosData.length > 0) {
    var kilosLabels = kilosData.map(function(d) { return d.cubicador.includes('@') ? d.cubicador.split('@')[0] : d.cubicador; });
    var kilosVals = kilosData.map(function(d) { return d.kilos; });
    _recDashKilos = replaceChart(_recDashKilos, document.getElementById('recDashChartKilos'), {
      type: 'bar',
      data: { labels: kilosLabels, datasets: [{ label: 'Kilos', data: kilosVals, backgroundColor: '#e53935', borderRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false },
          datalabels: { anchor: 'end', align: 'end', color: '#333', font: { size: 9, weight: 'bold' } } },
        scales: { x: { beginAtZero: true, ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } } },
      plugins: [ChartDataLabels]
    });
  } else {
    document.getElementById('recDashChartKilos').parentElement.innerHTML = '<div class="muted" style="text-align:center; padding:40px 0; font-size:12px;">Sin kilos registrados</div>';
  }

  // Chart 8: Reclamos por Proyecto (horizontal bar) - ALL projects
  var proyData = data.por_proyecto || [];
  var ctxProy = document.getElementById('recDashChartProyecto');
  if (ctxProy) {
    _recDashProyecto = destroyChart(_recDashProyecto);
    if (proyData.length > 0) {
      // Dynamic height: 25px per project, min 200px
      var chartHeight = Math.max(200, proyData.length * 25);
      ctxProy.parentElement.style.height = chartHeight + 'px';
      var proyLabels = proyData.map(function(d) { return d.proyecto.length > 25 ? d.proyecto.substring(0, 23) + '...' : d.proyecto; });
      var proyVals = proyData.map(function(d) { return d.count; });
      _recDashProyecto = replaceChart(_recDashProyecto, ctxProy, {
        type: 'bar',
        data: { labels: proyLabels, datasets: [{ label: 'Reclamos', data: proyVals, backgroundColor: '#1565C0', borderRadius: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
          plugins: { legend: { display: false },
            datalabels: { anchor: 'end', align: 'end', color: '#333', font: { size: 9, weight: 'bold' }, formatter: function(v) { return v; } } },
          scales: { x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } } },
        plugins: [ChartDataLabels]
      });
    } else {
      ctxProy.parentElement.innerHTML = '<div class="muted" style="text-align:center; padding:40px 0; font-size:12px;">Sin datos</div>';
    }
  }

  // Chart 9: Reclamos por Proyecto/Mes - HEATMAP TABLE (scalable for all projects)
  var proyMesData = data.proyecto_por_mes || [];
  var ctxProyMes = document.getElementById('recDashChartProyectoMes');
  if (ctxProyMes) {
    // Destroy chart if exists (we're replacing with a table)
    if (_recDashProyectoMes) { _recDashProyectoMes.destroy(); _recDashProyectoMes = null; }
    var container = ctxProyMes.parentElement;
    
    if (proyMesData.length > 0) {
      // Get unique months and projects
      var mesesSet = {};
      var proyectosSet = {};
      var maxCount = 0;
      proyMesData.forEach(function(d) { 
        mesesSet[d.mes] = true; 
        proyectosSet[d.proyecto] = true;
        if (d.count > maxCount) maxCount = d.count;
      });
      var meses = Object.keys(mesesSet).sort();
      var proyectos = Object.keys(proyectosSet).sort();
      
      // Build lookup map
      var dataMap = {};
      proyMesData.forEach(function(d) { dataMap[d.proyecto + '|' + d.mes] = d.count; });
      
      // Generate heatmap table HTML
      var html = '<div style="overflow-x:auto; max-height:390px; overflow-y:auto;">';
      html += '<table style="width:100%; border-collapse:collapse; font-size:10px;">';
      html += '<thead><tr style="position:sticky; top:0; background:#fff; z-index:1;"><th style="padding:3px 4px; text-align:left; border-bottom:1px solid #ddd; min-width:120px;">Proyecto</th>';
      meses.forEach(function(m) {
        html += '<th style="padding:3px 4px; text-align:center; border-bottom:1px solid #ddd; min-width:45px;">' + m.substring(5) + '</th>';
      });
      html += '<th style="padding:3px 4px; text-align:center; border-bottom:1px solid #ddd; font-weight:700;">Total</th></tr></thead><tbody>';
      
      proyectos.forEach(function(proy) {
        var rowTotal = 0;
        html += '<tr><td style="padding:3px 4px; border-bottom:1px solid #eee; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:150px;" title="' + proy + '">' + (proy.length > 20 ? proy.substring(0, 18) + '...' : proy) + '</td>';
        meses.forEach(function(m) {
          var val = dataMap[proy + '|' + m] || 0;
          rowTotal += val;
          var intensity = maxCount > 0 ? Math.min(1, val / maxCount) : 0;
          var bgColor = val === 0 ? '#f5f5f5' : 'rgba(21, 101, 192, ' + (0.15 + intensity * 0.7) + ')';
          var textColor = intensity > 0.5 ? '#fff' : '#333';
          html += '<td style="padding:3px 4px; text-align:center; border-bottom:1px solid #eee; background:' + bgColor + '; color:' + textColor + ';">' + (val || '') + '</td>';
        });
        html += '<td style="padding:3px 4px; text-align:center; border-bottom:1px solid #eee; font-weight:600; background:#e3f2fd;">' + rowTotal + '</td></tr>';
      });
      
      // Totals row
      html += '<tr style="font-weight:600; background:#f5f5f5;"><td style="padding:3px 4px;">Total</td>';
      var grandTotal = 0;
      meses.forEach(function(m) {
        var colTotal = 0;
        proyectos.forEach(function(proy) { colTotal += dataMap[proy + '|' + m] || 0; });
        grandTotal += colTotal;
        html += '<td style="padding:3px 4px; text-align:center;">' + colTotal + '</td>';
      });
      html += '<td style="padding:3px 4px; text-align:center; background:#1565C0; color:#fff;">' + grandTotal + '</td></tr>';
      html += '</tbody></table></div>';
      
      container.innerHTML = html;
    } else {
      container.innerHTML = '<div class="muted" style="text-align:center; padding:40px 0; font-size:12px;">Sin datos</div>';
    }
  }

}

// ── Sub-tab Validaciones ──

async function loadRecValidaciones() {
  // admin = jefe de servicio + co-administra calidad → ve ambas secciones
  // admin_calidad = solo validación de Calidad
  var verRevision = (currentRole === 'admin');
  var verCalidad = (currentRole === 'admin' || currentRole === 'admin_calidad');

  var secRev = document.getElementById('recValSeccionRevision');
  var secCal = document.getElementById('recValSeccionCalidad');
  if (secRev) secRev.style.display = verRevision ? '' : 'none';
  if (secCal) secCal.style.display = verCalidad ? '' : 'none';

  if (verRevision) { await _loadRevisionQueue(); }
  if (verCalidad) { await _loadValidacionCalidad(); }
  await _updateValidacionesKpis();
}

async function _loadRevisionQueue() {
  var listaExt = document.getElementById('recRevListaExt');
  var listaInt = document.getElementById('recRevListaInt');
  var badge = document.getElementById('recRevBadge');
  if (!listaExt || !listaInt) return;
  listaExt.innerHTML = '<div class="muted">Cargando...</div>';
  listaInt.innerHTML = '<div class="muted">Cargando...</div>';

  var data = await apiGet('/reclamos?estado=en_revision&limit=200');
  if (!data) {
    listaExt.innerHTML = '<div class="muted">Error al cargar.</div>';
    listaInt.innerHTML = '<div class="muted">Error al cargar.</div>';
    return;
  }
  var items = data.data || [];
  if (badge) badge.textContent = items.length;

  var externos = items.filter(function(r) { return (r.tipo_origen || 'externo') !== 'interno'; });
  var internos = items.filter(function(r) { return r.tipo_origen === 'interno'; });

  listaExt.innerHTML = _renderColaReclamos(externos);
  listaInt.innerHTML = _renderColaReclamos(internos);
}

async function _loadValidacionCalidad() {
  var listaExt = document.getElementById('recCalListaExt');
  var listaInt = document.getElementById('recCalListaInt');
  var badge = document.getElementById('recCalBadge');
  if (!listaExt || !listaInt) return;
  listaExt.innerHTML = '<div class="muted">Cargando...</div>';
  listaInt.innerHTML = '<div class="muted">Cargando...</div>';

  var data = await apiGet('/reclamos?estado=validacion&limit=200');
  if (!data) {
    listaExt.innerHTML = '<div class="muted">Error.</div>';
    listaInt.innerHTML = '<div class="muted">Error.</div>';
    return;
  }
  var items = data.data || [];
  if (badge) badge.textContent = items.length;

  var externos = items.filter(function(r) { return (r.tipo_origen || 'externo') !== 'interno'; });
  var internos = items.filter(function(r) { return r.tipo_origen === 'interno'; });

  listaExt.innerHTML = _renderColaReclamos(externos);
  listaInt.innerHTML = _renderColaReclamos(internos);
}

// Render compacto reutilizando el formato de la lista oficial de reclamos,
// recortado a lo esencial (N° · Título · Proyecto · Aplica). Clic en la fila
// abre el modal completo (verReclamo). Sin botones en la fila: las acciones
// (Aprobar/Validar/Devolver) viven dentro del modal.
function _renderColaReclamos(reclamos) {
  if (!reclamos || reclamos.length === 0) {
    return '<div class="muted" style="padding:8px 0; font-size:12px;">Sin pendientes.</div>';
  }
  var head = '<table style="width:100%; border-collapse:collapse; font-size:12px;">' +
    '<tr style="background:#f5f5f5; text-align:left;">' +
    '<th style="padding:4px 6px;">N°</th>' +
    '<th style="padding:4px 6px;">Título</th>' +
    '<th style="padding:4px 6px;">Proyecto</th>' +
    '<th style="padding:4px 6px;">Aplica</th>' +
    '</tr>';
  var rows = reclamos.map(function(r) {
    var idLabel = (typeof _formatCorrelativoCalidad === 'function' && _formatCorrelativoCalidad(r)) || (r.correlativo || '#' + r.id);
    var aplLabel = _recAplicaLabels[r.aplica] || 'Pendiente';
    var aplColor = _recAplicaColors[r.aplica] || '#ff9800';
    var titulo = r.titulo || '';
    if (titulo.length > 55) titulo = titulo.substring(0, 55) + '…';
    return '<tr style="border-bottom:1px solid #eee; cursor:pointer;" onclick="verReclamo(' + r.id + ', {origen:\'validaciones\'})" title="Ver ficha completa">' +
      '<td style="padding:4px 6px; font-weight:600; white-space:nowrap;">' + idLabel + '</td>' +
      '<td style="padding:4px 6px;">' + titulo + '</td>' +
      '<td style="padding:4px 6px; color:#666;">' + (r.nombre_proyecto || '—') + '</td>' +
      '<td style="padding:4px 6px;"><span style="color:' + aplColor + '; font-weight:600; font-size:10px;">' + aplLabel + '</span></td>' +
      '</tr>';
  }).join('');
  return head + rows + '</table>';
}

async function _updateValidacionesKpis() {
  // KPIs reales de ambas secciones, una sola llamada
  var data = await apiGet('/reclamos/validacion-kpis');
  if (!data) return;
  var setKpi = function(elId, val) { var e = document.getElementById(elId); if (e) e.textContent = (val != null ? val : '—'); };
  // Sección En revisión
  setKpi('recRevKpiPend', data.en_revision);
  setKpi('recRevKpiAbiertos', data.abiertos);
  setKpi('recRevKpiCerrados', data.cerrados);
  // Sección Validación Calidad
  setKpi('recCalKpiPend', data.pendientes);
  setKpi('recCalKpiAprobados', data.cerrados);   // card "Cerrados"
  setKpi('recCalKpiDevueltos', data.abiertos);   // card "Abiertos"
  setKpi('recCalKpiTiempo', '—');                // Tiempo prom → reportes (5.40)
}
