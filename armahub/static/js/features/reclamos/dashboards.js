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

// Metadatos de los sub-tabs en un solo lugar: panel, color, botón y qué
// roles pueden verlo. Clientes/Internos/Acciones: todos los roles del módulo
// (Acciones se auto-restringe en backend: cada uno ve las suyas salvo Calidad).
// Matriz RCA / Presentaciones / Validaciones: restringidos. Único flujo para todos.
var REC_SUBTABS = {
  clientes:      { panel: 'recSubClientes',       btn: 'recSubBtnClientes', color: '#e53935', roles: null },
  internos:      { panel: 'recSubInternos',       btn: 'recSubBtnInternos', color: '#1565C0', roles: null },
  acciones:      { panel: 'recSubAcciones',       btn: 'recSubBtnAcciones', color: '#00897b', roles: null },
  rca:           { panel: 'recSubRCA',            btn: 'recSubBtnRCA',      color: '#e65100', roles: ['admin','admin_calidad'] },
  presentaciones:{ panel: 'recSubPresentaciones', btn: 'recSubBtnPres',     color: '#7B1FA2', roles: ['admin','admin_calidad','miembro','externo'] },
  validaciones:  { panel: 'recSubValidaciones',   btn: 'recSubBtnVal',      color: '#7B1FA2', roles: ['admin','admin_calidad'] },
  // Sólo administración, por decisión del usuario. Mientras los análisis no estén
  // hechos, estos 511 reclamos viejos se leen como un marcador de quién lo hizo peor,
  // con gente que ya no está y sin la causa que explica cada caso. El backend valida
  // lo mismo: esconder el botón no es un permiso.
  analisis:      { panel: 'recSubAnalisis',       btn: 'recSubBtnAnalisis', color: '#5e35b1', roles: ['admin'] }
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

window.switchDashSubTab = switchDashSubTab;
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
  if (sub === 'acciones') { _ensureModalFueraDeSubpaneles(); if (typeof loadRecAccionesSeguimiento === 'function') loadRecAccionesSeguimiento(); }
  if (sub === 'analisis') { cargarAnalisisHistorico(); }

  if (typeof window.__armahubUpdateNavHash === 'function') {
    window.__armahubUpdateNavHash(window.currentModule, 'reclamos', sub);
  }
}

// El modal de detalle (reclamoDetailCard) y su backdrop viven dentro de
// recSubClientes, que se oculta al cambiar de sub-tab/tab. Para que se pueda abrir
// desde CUALQUIER lugar (sub-tab Validaciones, tab Mailing→Cierre Reclamos, etc.)
// lo movemos una vez a document.body. Al ser position:fixed con backdrop full-screen,
// flota sobre todo el viewport sin depender de qué contenedor esté visible.
var _modalReparented = false;
function _ensureModalFueraDeSubpaneles() {
  if (_modalReparented) return;
  var card = document.getElementById('reclamoDetailCard');
  var backdrop = document.getElementById('recModalBackdrop');
  if (!card) return;
  document.body.appendChild(card);
  if (backdrop) document.body.appendChild(backdrop);
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
    // Verde (matriz usable) SOLO si hay al menos una sub-causa activa. Tener
    // categorías vacías no cuenta como matriz: igualaría a "Sin matriz" para
    // efectos del formulario RCA (el modal Ishikawa saldría vacío).
    var badge = (a.total_subcausas > 0)
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
  // Sin toggle activo/inactivo: toda sub-causa creada está activa y usable.
  // Para descartar una causa se usa el botón eliminar (✕). El concepto de
  // "inactiva" generaba matrices que se veían con causas pero llegaban vacías
  // al formulario RCA (el modal y el contador solo cuentan activas).
  return '<div id="rcaRecRow_' + ci + '_' + si + '" style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">'
    + '<input type="text" value="' + _rcaEsc(sub.codigo) + '" placeholder="Cód." style="width:64px; font-size:11px; font-family:monospace; padding:4px 6px; border:1px solid #ccc; border-radius:4px;" oninput="rcaRecUpd(' + ci + ',' + si + ',\'codigo\',this.value)" />'
    + '<input type="text" value="' + _rcaEsc(sub.descripcion) + '" placeholder="Descripción" style="flex:1; font-size:12px; padding:4px 8px; border:1px solid #ccc; border-radius:4px;" oninput="rcaRecUpd(' + ci + ',' + si + ',\'descripcion\',this.value)" />'
    + '<button onclick="rcaRecEliminar(' + ci + ',' + si + ')" title="Eliminar causa" style="font-size:11px; padding:3px 8px; border:none; border-radius:4px; cursor:pointer; background:#ffebee; color:#c62828;">✕</button>'
    + '</div>';
}

function _rcaEsc(s) { return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function rcaRecUpd(ci, si, campo, val) { if (_rcaRecData) _rcaRecData.categorias[ci].subcausas[si][campo] = val; }
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
  // Forzar activo:true en todas las sub-causas. Ya no existe el estado
  // "inactiva"; esto además repara las que hubieran quedado inactivas antes.
  _rcaRecData.categorias.forEach(function(cat) {
    (cat.subcausas || []).forEach(function(sub) { sub.activo = true; });
  });
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
  // Este landing vive en la pestaña de reclamos de CLIENTES: cuenta solo los
  // externos. Sin el filtro sumaba los internos y el total no cuadraba con la lista
  // de abajo (usuario 21-sep: 106 arriba, 87 en la lista).
  var data = await apiGet('/reclamos/mi-resumen?tipo_origen=externo');
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

  // Badge de tareas pendientes (responsable de reclamos: miembro/externo)
  var pendWrap = document.getElementById('recLandPendientesWrap');
  var pendCount = data.pendientes || 0;
  if (pendWrap) {
    if ((currentRole === 'miembro' || currentRole === 'externo') && pendCount > 0) {
      pendWrap.style.display = '';
      document.getElementById('recLandPendientes').textContent = pendCount;
    } else {
      pendWrap.style.display = 'none';
    }
  }
}

// ── SUB-TABS DE DASHBOARDS (21-sep) ──────────────────────────────────────────────
// Mismo mecanismo que REC_SUBTABS: un registro, un switch que muestra el panel y
// pinta el botón. Los tableros de siempre viven en 'tableros' y no se tocaron;
// 'kpis' es la sección nueva, que carga su data la primera vez que se abre.
var DASH_SUBTABS = {
  tableros:  { panel: 'dashSubTableros', btn: 'dashSubBtnTableros', color: '#1565C0' },
  kpis:      { panel: 'dashSubKpis',     btn: 'dashSubBtnKpis',     color: '#00897b' },
  historico: { panel: 'dashSubHist',     btn: 'dashSubBtnHist',     color: '#5e35b1' },
  indicadores: { panel: 'dashSubInd',    btn: 'dashSubBtnInd',      color: '#00897b' }
};
var _dashSubActual = 'tableros';
var _dashKpisLoaded = false;

function switchDashSubTab(sub) {
  if (!DASH_SUBTABS[sub]) sub = 'tableros';
  _dashSubActual = sub;
  Object.keys(DASH_SUBTABS).forEach(function (key) {
    var cfg = DASH_SUBTABS[key];
    var el = document.getElementById(cfg.panel);
    if (el) el.style.display = (key === sub) ? '' : 'none';
    var btn = document.getElementById(cfg.btn);
    if (btn) {
      btn.style.borderBottomColor = (key === sub) ? cfg.color : 'transparent';
      btn.style.color = (key === sub) ? cfg.color : '#999';
    }
  });
  if (sub === 'tableros') loadRecAdminDashboards();
  if (sub === 'kpis') loadDashKpis();
  if (sub === 'historico') loadDashHistorico();
  if (sub === 'indicadores') loadDashIndicadores();
}

// ── POR AÑO (5-oct) ──────────────────────────────────────────────────────────────
// La foto de varios años junta: lo cargado de las planillas viejas y lo que se lleva
// hoy. Todo se agrupa en la base; acá sólo se dibuja.
var _dashHistLoaded = false;
var _rhCharts = {};
var MESES_C = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function rhNum(n) {
  return (n == null ? 0 : Math.round(n)).toLocaleString('es-CL');
}

function rhEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

// La matriz que se repite en cuatro cajas: filas por lo que sea, años en columnas y
// totales a los dos lados. Una sola función, porque son la misma tabla con otra fila.
function rhMatriz(el, filas, anios, cfg) {
  cfg = cfg || {};
  var tabla = document.getElementById(el);
  if (!tabla) return;
  var claves = [];
  var mapa = {};
  filas.forEach(function (f) {
    if (!mapa[f.clave]) { mapa[f.clave] = {}; claves.push(f.clave); }
    mapa[f.clave][f.col] = (mapa[f.clave][f.col] || 0) + f.valor;
  });
  var total = {};
  claves.forEach(function (k) {
    total[k] = anios.reduce(function (a, c) { return a + (mapa[k][c] || 0); }, 0);
  });
  // Ordenado por el total, de mayor a menor: lo que más pesa se lee primero. Salvo que
  // las filas sean años, donde el orden es el cronológico. Se ORDENA de verdad y no se
  // confía en el orden en que llegó la data: si el backend cambia un ORDER BY, la tabla
  // saldría con los años barajados y nadie lo relacionaría con eso.
  claves.sort(cfg.ordenNatural
    ? function (a, b) { return (parseFloat(a) || 0) - (parseFloat(b) || 0) || a.localeCompare(b); }
    : function (a, b) { return total[b] - total[a]; });
  var th = '<thead><tr><th>' + rhEsc(cfg.titulo || '') + '</th>' +
    anios.map(function (a) {
      return '<th>' + a + (cfg.enCurso === a ? '<span class="rhcurso">en curso</span>' : '') + '</th>';
    }).join('') + '<th>Total</th></tr></thead>';
  var tb = '<tbody>' + claves.map(function (k) {
    return '<tr><td title="' + rhEsc(k) + '">' + rhEsc(k) + '</td>' +
      anios.map(function (a) {
        var v = mapa[k][a] || 0;
        return '<td class="' + (v ? '' : 'cero') + '">' + (v ? rhNum(v) : '·') + '</td>';
      }).join('') + '<td><b>' + rhNum(total[k]) + '</b></td></tr>';
  }).join('') + '</tbody>';
  var sumas = anios.map(function (a) {
    return claves.reduce(function (acc, k) { return acc + (mapa[k][a] || 0); }, 0);
  });
  var tf = '<tfoot><tr><td>Total</td>' + sumas.map(function (s) { return '<td>' + rhNum(s) + '</td>'; }).join('') +
    '<td>' + rhNum(sumas.reduce(function (a, b) { return a + b; }, 0)) + '</td></tr></tfoot>';
  tabla.innerHTML = th + tb + tf;
}

// El gráfico de barras de siempre: una barra por serie, el número real encima y el
// total del año en la etiqueta del eje. Sin apilar, que no deja comparar.
function rhBarras(canvas, etiquetas, series, opciones) {
  opciones = opciones || {};
  if (_rhCharts[canvas]) _rhCharts[canvas].destroy();
  var ctx = document.getElementById(canvas);
  if (!ctx) return;
  _rhCharts[canvas] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: etiquetas,
      datasets: series.map(function (s) {
        return { label: s.nombre, data: s.datos, backgroundColor: s.color, borderRadius: 3,
                 maxBarThickness: 46 };
      })
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: series.length > 1, position: 'bottom',
                  labels: { boxWidth: 10, font: { size: 10 } } },
        datalabels: {
          display: true, anchor: 'end', align: 'end', offset: 1,
          color: '#546e7a', font: { size: 9, weight: '700' },
          formatter: function (v) { return v ? rhNum(v) : ''; }
        },
        tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + rhNum(c.parsed.y); } } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        // Aire arriba para que el número sobre la barra más alta no quede cortado.
        y: { beginAtZero: true, grace: '14%', ticks: { font: { size: 9 },
             callback: function (v) { return rhNum(v); } },
             grid: { color: '#f2f4f6' } }
      }
    },
    plugins: [ChartDataLabels]
  });
  if (opciones.sufijo) { /* reservado */ }
}

// LOS FILTROS. Vacio = todos, salvo `aplica`, que arranca dejando fuera lo que NO
// aplica al area: el usuario lo pidio asi, «los no aplica debieran visibilizarse pero
// salir de la data». Visible como boton, fuera de los numeros mientras no se encienda.
var RH = { datos: [], anio_en_curso: null, internos: [] };
var RH_F = { anio: [], cubicador: [], servicio: [], segmento: [], aplica: ['si', 'pendiente'] };
var RH_APLICA_TXT = { si: 'Aplica', no: 'No aplica', pendiente: 'Por revisar' };
// Sólo dos. Un reclamo sin cubicador no tiene servicio, y eso se ve en el filtro de
// cubicador, que para eso tiene su chip «Sin asignar».
var RH_SERV_TXT = { Interno: 'Interno', Externo: 'Externo' };

// Elegir como en los dashboards de programacion: clic deja SOLO ese, Ctrl+clic suma, y
// volver a tocar el unico encendido lo suelta y se ven todos. Es lo que el usuario ya
// conoce; inventar otra forma en esta pantalla seria hacerle aprender dos.
function rhMarcar(lista, valor, ev) {
  var i = lista.indexOf(valor);
  if (ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) {
    if (i === -1) lista.push(valor); else lista.splice(i, 1);
  } else if (lista.length === 1 && i === 0) {
    lista.length = 0;
  } else {
    lista.length = 0; lista.push(valor);
  }
}

function rhPasa(f) {
  return (!RH_F.anio.length || RH_F.anio.indexOf(f.anio) >= 0)
    && (!RH_F.cubicador.length || RH_F.cubicador.indexOf(f.cubicador) >= 0)
    && (!RH_F.servicio.length || RH_F.servicio.indexOf(f.servicio) >= 0)
    && (!RH_F.segmento.length || RH_F.segmento.indexOf(f.segmento) >= 0)
    && (!RH_F.aplica.length || RH_F.aplica.indexOf(f.aplica) >= 0);
}

function rhFilas() { return RH.datos.filter(rhPasa); }

// Suma el cubo por una clave. Devuelve {valor: {n, kilos, con_kilos}}.
function rhSuma(filas, clave) {
  var m = {};
  filas.forEach(function (f) {
    var k = f[clave];
    if (k == null) return;
    if (!m[k]) m[k] = { n: 0, kilos: 0, con_kilos: 0 };
    m[k].n += f.n; m[k].kilos += f.kilos; m[k].con_kilos += f.con_kilos;
  });
  return m;
}

function rhValores(clave) {
  var v = [];
  RH.datos.forEach(function (f) { if (f[clave] != null && v.indexOf(f[clave]) < 0) v.push(f[clave]); });
  return v.sort(function (a, b) {
    if (typeof a === 'number') return b - a;
    return String(a).localeCompare(String(b));
  });
}

// Un grupo de botones, con la cuenta de cada valor adentro. La cuenta se calcula sobre
// TODO y no sobre lo filtrado: si se encogiera al filtrar, los botones apagados
// marcarian cero y no se sabria que hay detras de encenderlos.
function rhGrupoF(titulo, clave, valores, etiqueta) {
  var sel = RH_F[clave];
  // La cuenta se calcula sobre TODO y no sobre lo filtrado: si se encogiera al filtrar,
  // los chips apagados marcarian cero y no se sabria que hay detras de encenderlos.
  var cuenta = rhSuma(RH.datos, clave);
  return '<span class="dshbl">' + rhEsc(titulo) + '</span>' +
    '<div class="dshchips" data-g="' + clave + '">' +
    valores.map(function (v) {
      return '<button data-v="' + rhEsc(v) + '" class="' + (sel.indexOf(v) >= 0 ? 'on' : '') + '">' +
        rhEsc(etiqueta ? etiqueta(v) : v) + '<i>' + ((cuenta[v] || {}).n || 0) + '</i></button>';
    }).join('') + '</div>';
}

// DOS LÍNEAS Y NO SEIS GRUPOS SUELTOS. Dejados a su aire, cada grupo se parte donde le
// toca y la barra queda escalonada. Arriba van los cortos, que caben juntos; abajo los
// dos largos, cubicador y tipo, que son los que necesitan el ancho entero.
function rhPintarFiltros() {
  var cont = document.getElementById('rhFiltros');
  if (!cont) return;
  cont.innerHTML =
    '<div class="dshbarra">' +
      rhGrupoF('Año', 'anio', rhValores('anio')) + '<span class="dshsep"></span>' +
      rhGrupoF('Servicio', 'servicio', rhValores('servicio'), function (v) { return RH_SERV_TXT[v] || v; }) +
      '<span class="dshsep"></span>' +
      rhGrupoF('Aplica', 'aplica', ['si', 'pendiente', 'no'], function (v) { return RH_APLICA_TXT[v] || v; }) +
      '<span class="dshsep"></span>' +
      rhGrupoF('Segmento', 'segmento', rhValores('segmento')) +
      '<span class="muted" style="font-size:10px; margin-left:auto;">clic = sólo ése · Ctrl+clic = sumar · clic en el encendido = todos</span>' +
    '</div>' +
    // Cubicador va solo en su barra: es la lista larga. El filtro por tipo se saco a
    // pedido del usuario: lo que importa catalogar es la causa Ishikawa, y para eso hay
    // otro panel.
    '<div class="dshbarra">' +
      rhGrupoF('Cubicador', 'cubicador', rhValores('cubicador')) +
    '</div>';
  cont.querySelectorAll('.dshchips button').forEach(function (b) {
    b.addEventListener('click', function (ev) {
      var g = b.parentNode.dataset.g;
      // Los anos viajan como numero y el resto como texto: sin esto '2024' no casaria
      // nunca con 2024 y el filtro de ano no haria nada.
      rhMarcar(RH_F[g], g === 'anio' ? Number(b.dataset.v) : b.dataset.v, ev);
      // La barra TAMBIEN se repinta: el filtro ya se aplicaba, pero el boton no se
      // encendia ni se apagaba, y parecia que el clic no habia hecho nada.
      rhPintarFiltros();
      rhPintarTodo();
    });
  });
}

function rhPintarTodo() {
  var filas = rhFilas();
  var anios = rhValores('anio').slice().sort(function (a, b) { return a - b; })
    .filter(function (a) { return !RH_F.anio.length || RH_F.anio.indexOf(a) >= 0; });

  var porAnio = rhSuma(filas, 'anio');
  var res = document.getElementById('rhResumen');
  if (res) {
    var tot = filas.reduce(function (a, f) { return a + f.n; }, 0);
    var kg = filas.reduce(function (a, f) { return a + f.kilos; }, 0);
    var fuera = RH.datos.reduce(function (a, f) { return a + f.n; }, 0) - tot;
    res.innerHTML = '<b>' + rhNum(tot) + '</b> reclamos · <b>' + rhNum(kg) + '</b> kg mal fabricados' +
      (fuera ? ' <span style="color:#90a4ae">(' + rhNum(fuera) + ' fuera por los filtros)</span>' : '');
  }

  // POR AÑO, separado entre lo que aplica al área y lo que no. El corte por servicio o
  // por cubicador NO va acá: va en los filtros. Meter cada dimensión como una serie más
  // llenaría el gráfico de barras y seguiría sin poder cruzar dos cosas a la vez.
  // LOS QUE NO APLICAN VAN EN LA ETIQUETA, debajo del total. Estan fuera de las barras
  // porque el filtro los deja fuera, pero sin decir cuantos son el ano parece mas chico
  // de lo que fue. Se cuentan con TODOS los demas filtros puestos menos el de aplica:
  // asi, filtrando por un cubicador, el numero es el de ese cubicador.
  var noAplican = {};
  RH.datos.forEach(function (f) {
    if (f.aplica !== 'no') return;
    if (RH_F.anio.length && RH_F.anio.indexOf(f.anio) < 0) return;
    if (RH_F.cubicador.length && RH_F.cubicador.indexOf(f.cubicador) < 0) return;
    if (RH_F.servicio.length && RH_F.servicio.indexOf(f.servicio) < 0) return;
    if (RH_F.segmento.length && RH_F.segmento.indexOf(f.segmento) < 0) return;
    noAplican[f.anio] = (noAplican[f.anio] || 0) + f.n;
  });
  // LA ETIQUETA DICE DE QUÉ ES EL NÚMERO. Un total suelto no deja saber si incluye o no
  // a los que quedaron fuera: hay que ponerse a sumar las barras para deducirlo. Con
  // «149 de 156» queda dicho que 149 es lo dibujado y 156 lo que hubo ese año.
  var mostrandoNoAplica = RH_F.aplica.indexOf('no') >= 0;
  var etiq = anios.map(function (a) {
    var e = String(a) + (a === RH.anio_en_curso ? ' (en curso)' : '');
    var dentro = (porAnio[a] || {}).n || 0;
    var fuera = (!mostrandoNoAplica && noAplican[a]) ? noAplican[a] : 0;
    var fila = [e, fuera ? (rhNum(dentro) + ' de ' + rhNum(dentro + fuera)) : rhNum(dentro)];
    if (fuera) fila.push(fuera + ' no aplican, fuera');
    return fila;
  });
  function porAplica(valor) {
    return anios.map(function (a) {
      return filas.filter(function (f) { return f.anio === a && f.aplica === valor; })
        .reduce(function (x, f) { return x + f.n; }, 0);
    });
  }
  rhBarras('rhChartAnio', etiq, [
    { nombre: 'Aplican al área', datos: porAplica('si'), color: '#c62828' },
    { nombre: 'No aplican', datos: porAplica('no'), color: '#b0bec5' },
    { nombre: 'Por revisar', datos: porAplica('pendiente'), color: '#ffb74d' }
  // Sin las series vacias: una leyenda que no corresponde a ninguna barra confunde mas
  // de lo que informa.
  ].filter(function (s) { return s.datos.some(function (x) { return x > 0; }); }));

  var etiqKg = anios.map(function (a) {
    var p = porAnio[a] || { n: 0, con_kilos: 0 };
    return [String(a) + (a === RH.anio_en_curso ? ' (en curso)' : ''),
            p.con_kilos + ' de ' + p.n + ' valorizados'];
  });
  rhBarras('rhChartKilos', etiqKg, [{
    nombre: 'Kilos mal fabricados', color: '#5e35b1',
    datos: anios.map(function (a) { return (porAnio[a] || {}).kilos || 0; })
  }]);

  var porMes = [];
  filas.forEach(function (f) {
    if (f.mes) porMes.push({ clave: String(f.anio), col: f.mes, valor: f.n });
  });
  rhMatriz('rhMatrizMes', porMes, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
           { titulo: 'Ano', ordenNatural: true });
  var cab = document.querySelector('#rhMatrizMes thead tr');
  if (cab) { for (var i = 1; i <= 12; i++) if (cab.children[i]) cab.children[i].textContent = MESES_C[i - 1]; }

  rhMatriz('rhMatrizCub', filas.map(function (f) {
    return { clave: f.cubicador, col: f.anio, valor: f.n };
  }), anios, { titulo: 'Cubicador', enCurso: RH.anio_en_curso });
  rhMatriz('rhMatrizSeg', filas.map(function (f) {
    return { clave: f.segmento, col: f.anio, valor: f.n };
  }), anios, { titulo: 'Segmento', enCurso: RH.anio_en_curso });
  rhMatriz('rhMatrizTipo', filas.map(function (f) {
    return { clave: TIPO_TXT[f.tipo] || f.tipo, col: f.anio, valor: f.n };
  }), anios, { titulo: 'Tipo', enCurso: RH.anio_en_curso });

  rhPintarCobertura(filas, anios);
  rhPintarCausas(filas);
}

// Cuanto del analisis causa raiz esta hecho. Lo que NO aplica no necesita causa, asi que
// no entra al denominador: meterlo haria ver un atraso que no existe.
function rhPintarCobertura(filas, anios) {
  var tabla = document.getElementById('rhMatrizCausa');
  if (!tabla) return;
  tabla.innerHTML = '<thead><tr><th>Ano</th><th>Necesitan causa</th><th>Con causa</th>' +
    '<th>Por validar</th><th>Falta catalogar</th><th style="width:100px">Avance</th></tr></thead><tbody>' +
    anios.map(function (a) {
      var f = filas.filter(function (x) { return x.anio === a && x.aplica !== 'no'; });
      var nec = f.reduce(function (s, x) { return s + x.n; }, 0);
      var val = f.filter(function (x) { return x.analisis === 'validado'; })
                 .reduce(function (s, x) { return s + x.n; }, 0);
      var porv = f.filter(function (x) { return x.analisis === 'por_validar'; })
                  .reduce(function (s, x) { return s + x.n; }, 0);
      var falta = Math.max(0, nec - val - porv);
      var pct = nec ? Math.round(val * 100 / nec) : 0;
      return '<tr><td>' + a + (a === RH.anio_en_curso ? '<span class="rhcurso">en curso</span>' : '') + '</td>' +
        '<td>' + rhNum(nec) + '</td><td>' + rhNum(val) + '</td>' +
        '<td' + (porv ? ' style="color:#e65100; font-weight:700"' : '') + '>' + rhNum(porv) + '</td>' +
        '<td' + (falta ? ' style="color:#c62828; font-weight:700"' : '') + '>' + rhNum(falta) + '</td>' +
        '<td><div class="rhbarra" title="' + pct + '%"><i style="width:' + pct + '%"></i></div></td></tr>';
    }).join('') + '</tbody>';
}

function rhPintarCausas(filas) {
  var top = document.getElementById('rhTopCausas');
  if (!top) return;
  var m = rhSuma(filas.filter(function (f) { return f.causa; }), 'causa');
  var lista = Object.keys(m).map(function (k) { return { causa: k, n: m[k].n }; })
    .sort(function (a, b) { return b.n - a.n; }).slice(0, 12);
  var maxc = Math.max.apply(null, [1].concat(lista.map(function (c) { return c.n; })));
  top.innerHTML = '<thead><tr><th>Causa</th><th>Reclamos</th><th style="width:90px"></th></tr></thead><tbody>' +
    (lista.length
      ? lista.map(function (c) {
          return '<tr><td title="' + rhEsc(c.causa) + '">' + rhEsc(c.causa) + '</td>' +
            '<td><b>' + c.n + '</b></td>' +
            '<td><div class="rhbarra"><i style="width:' + Math.round(c.n * 100 / maxc) +
            '%; background:#5e35b1"></i></div></td></tr>';
        }).join('')
      : '<tr><td colspan="3" style="color:#90a4ae; font-style:italic">Ningun reclamo con causa en lo filtrado.</td></tr>') +
    '</tbody>';
}

async function loadDashHistorico() {
  if (_dashHistLoaded) { rhPintarFiltros(); rhPintarTodo(); return; }
  var d = await apiGet('/reclamos/historico');
  if (!d) return;
  _dashHistLoaded = true;
  RH.datos = d.datos || [];
  RH.anio_en_curso = d.anio_en_curso;
  RH.internos = d.internos || [];
  rhPintarFiltros();
  rhPintarTodo();
}

// ── ANÁLISIS HISTÓRICO (5-oct) ───────────────────────────────────────────────────
// La arqueología: clasificar la causa de los reclamos de 2022-2025. Hecho para hacer
// muchos seguidos, así que todo lo que se repite está a un clic y al guardar se salta
// solo al siguiente pendiente.
var AH = { filas: [], sel: null, detalle: null, causas: [], cargado: false, area_id: null,
           causaSel: null, cbCubicador: null };
// Qué filtros están puestos. Vacío = todos: así empieza y así se vuelve con «Todos».
var AH_F = { anio: [], cubicador: [], segmento: [], tipo: [], estado: [] };
var AH_ESTADOS = [
  { k: 'sin_causa', t: 'Sin causa' },
  { k: 'por_validar', t: 'Por validar' },
  { k: 'validado', t: 'Validado' }
];

function ahEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

// Elegir como en los dashboards de programación: clic deja sólo ése, Ctrl+clic suma,
// tocar el único encendido lo suelta. Misma regla en toda la plataforma.
function ahMarcar(lista, valor, ev) { rhMarcar(lista, valor, ev); }

function ahPasa(f) {
  return (!AH_F.anio.length || AH_F.anio.indexOf(f.anio) >= 0)
    && (!AH_F.cubicador.length || AH_F.cubicador.indexOf(f.cubicador) >= 0)
    && (!AH_F.segmento.length || AH_F.segmento.indexOf(f.segmento) >= 0)
    && (!AH_F.tipo.length || AH_F.tipo.indexOf(f.tipo) >= 0)
    && (!AH_F.estado.length || AH_F.estado.indexOf(f.estado) >= 0);
}

function ahVisibles() {
  return AH.filas.filter(ahPasa);
}

// LOS CHIPS, con la cuenta de cada valor adentro. Se calcula sobre TODO y no sobre lo
// filtrado: si se encogiera al filtrar, los apagados marcarían cero y no se sabría qué
// hay detrás de encenderlos.
function ahChips(idCont, clave, valores, etiqueta) {
  var cont = document.getElementById(idCont);
  if (!cont) return;
  var sel = AH_F[clave];
  var cuenta = {};
  AH.filas.forEach(function (f) { cuenta[f[clave]] = (cuenta[f[clave]] || 0) + 1; });
  cont.innerHTML = valores.map(function (v) {
    return '<button data-v="' + ahEsc(v) + '" class="' + (sel.indexOf(v) >= 0 ? 'on' : '') + '">' +
      ahEsc(etiqueta ? etiqueta(v) : v) + '<i>' + (cuenta[v] || 0) + '</i></button>';
  }).join('');
  cont.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function (ev) {
      // Los años viajan como número y el resto como texto: sin esto '2024' no casaría
      // nunca con 2024 y el filtro de año no haría nada.
      ahMarcar(AH_F[clave], clave === 'anio' ? Number(b.dataset.v) : b.dataset.v, ev);
      ahPintarFiltros(); ahPintarLista();
    });
  });
}

function ahDistintos(clave) {
  var vistos = [];
  AH.filas.forEach(function (f) { if (vistos.indexOf(f[clave]) < 0) vistos.push(f[clave]); });
  return vistos.sort(function (a, b) {
    if (typeof a === 'number') return b - a;      // los años, del más nuevo al más viejo
    return String(a).localeCompare(String(b));
  });
}

// El cubicador es un DESPLEGABLE CON BÚSQUEDA, no una fila de chips: la lista es larga y
// con nombres parecidos, y escribir tres letras es más rápido que buscar el botón. Es el
// mismo combobox compartido de toda la plataforma, montado UNA vez.
function ahMontarCubicador() {
  var input = document.getElementById('ahCubicador');
  if (!input || AH.cbCubicador || !window.Combobox) return;
  AH.cbCubicador = window.Combobox.crear(input, {
    items: function () {
      var cuenta = {};
      AH.filas.forEach(function (f) { cuenta[f.cubicador] = (cuenta[f.cubicador] || 0) + 1; });
      return [{ id: '', label: 'Todos los cubicadores', sub: AH.filas.length + ' reclamos' }].concat(
        ahDistintos('cubicador').map(function (c) { return { id: c, label: c, sub: cuenta[c] + ' reclamos' }; }));
    },
    placeholder: '🔍 todos · escribe para buscar',
    onSelect: function (it) {
      AH_F.cubicador = (it && it.id) ? [it.id] : [];
      if (!it || !it.id) AH.cbCubicador.setValor(null);
      ahPintarFiltros(); ahPintarLista();
    }
  });
}

function ahPintarFiltros() {
  ahChips('ahAnios', 'anio', ahDistintos('anio'));
  ahChips('ahEstados', 'estado', AH_ESTADOS.map(function (e) { return e.k; }), function (k) {
    var e = AH_ESTADOS.filter(function (x) { return x.k === k; })[0];
    return e ? e.t : k;
  });
  ahChips('ahSegmentos', 'segmento', ahDistintos('segmento'));
  ahMontarCubicador();
  // El tipo es un select: son pocos valores y no hace falta verlos todos a la vez.
  var sel = document.getElementById('ahTipo');
  if (sel && !sel.dataset.listo) {
    sel.innerHTML = '<option value="">Todos</option>' + ahDistintos('tipo').map(function (t) {
      return '<option value="' + ahEsc(t) + '">' + ahEsc(TIPO_TXT[t] || t) + '</option>';
    }).join('');
    sel.dataset.listo = '1';
    sel.addEventListener('change', function () {
      AH_F.tipo = sel.value ? [sel.value] : [];
      ahPintarFiltros(); ahPintarLista();
    });
  }
}

function ahPintarLista() {
  var cont = document.getElementById('ahLista');
  var vis = ahVisibles();
  var pend = vis.filter(function (f) { return f.estado !== 'validado'; }).length;
  var av = document.getElementById('ahAvance');
  if (av) {
    av.innerHTML = '<b>' + vis.length + '</b> reclamos a la vista · <b>' + pend +
      '</b> sin validar · ' + (vis.length - pend) + ' listos' +
      (vis.length < AH.filas.length ? ' <span style="color:#90a4ae">(de ' + AH.filas.length + ' en total)</span>' : '');
  }
  if (!cont) return;
  if (!vis.length) {
    cont.innerHTML = '<div style="padding:18px; text-align:center; color:#90a4ae; font-size:11.5px;">' +
      'Ningún reclamo con esos filtros.</div>';
    return;
  }
  cont.innerHTML = vis.map(function (f) {
    return '<div class="ahfila' + (AH.sel === f.id ? ' sel' : '') + '" data-id="' + f.id + '">' +
      '<span class="t"><span class="ahpunto ' + f.estado + '"></span>' + ahEsc(f.titulo) + '</span>' +
      '<span class="m">' + ahEsc(f.fecha || '') + ' · ' + ahEsc(f.obra) + ' · ' +
      ahEsc(f.cubicador) + (f.kilos ? ' · ' + rhNum(f.kilos) + ' kg' : '') + '</span></div>';
  }).join('');
  cont.querySelectorAll('.ahfila').forEach(function (d) {
    d.addEventListener('click', function () { ahAbrir(Number(d.dataset.id)); });
  });
}

async function ahAbrir(id) {
  AH.sel = id;
  ahPintarLista();
  var det = document.getElementById('ahDetalle');
  if (det) det.innerHTML = '<div style="color:#90a4ae; font-size:11.5px;">Cargando…</div>';
  AH.detalle = await apiGet('/reclamos/analisis/' + id);
  ahPintarDetalle();
}

function ahPintarDetalle() {
  var det = document.getElementById('ahDetalle');
  var d = AH.detalle;
  if (!det) return;
  if (!d) {
    det.innerHTML = '<div style="color:#90a4ae; font-size:11.5px; padding:20px; text-align:center;">' +
      'Elige un reclamo de la lista para analizarlo.</div>';
    return;
  }
  // Lo que trajo la planilla va arriba y en modo lectura: es lo que hay que leer para
  // decidir la causa, y no se toca desde acá.
  var bloques = [
    ['Qué pasó', d.descripcion],
    ['Observaciones', d.observaciones],
    ['Explicación de la causa', d.explicacion]
  ].filter(function (x) { return x[1]; }).map(function (x) {
    return '<div class="ahdato"><b>' + x[0] + '</b>' + ahEsc(x[1]) + '</div>';
  }).join('');

  var acc = (d.acciones || []).length
    ? '<div class="ahdato"><b>Acciones de la ficha</b>' + d.acciones.map(function (a) {
        return '· ' + ahEsc(a.descripcion) + (a.responsable ? ' (' + ahEsc(a.responsable) + ')' : '');
      }).join('\n') + '</div>'
    : '';

  // La causa se arranca de lo que trae el reclamo; después la cambia el modal.
  AH.causaSel = d.cod_causa ? { categoria: d.categoria, cod_causa: d.cod_causa, sub_causa: d.sub_causa } : null;

  var sello = d.validado_el
    ? '<span style="color:#2e7d32; font-weight:700;">Validado por ' + ahEsc((d.validado_por || '').split('@')[0]) + '</span>'
    : (d.categoria
        ? '<span style="color:#e65100; font-weight:700;">Viene de planilla, falta validarlo</span>'
        : '<span style="color:#c62828; font-weight:700;">Sin causa</span>');

  det.innerHTML =
    '<div class="ahtit">' + ahEsc(d.titulo) + '</div>' +
    '<div class="ahmeta">' + ahEsc(d.correlativo || '') + ' · ' + ahEsc(d.fecha || '') + ' · ' +
      ahEsc(d.obra) + ' · cubicó ' + ahEsc(d.cubicador) +
      (d.kilos ? ' · <b>' + rhNum(d.kilos) + ' kg</b> mal fabricados' : ' · sin kilos') +
      (d.analista ? ' · analizó ' + ahEsc(d.analista) : '') + ' · ' + sello + '</div>' +
    bloques + acc +
    '<div class="ahform">' +
      // LA MISMA FILA QUE EN RECLAMOS: el texto de la causa, la lupa que abre el modal
      // de Ishikawa y la equis que la quita. Un select propio acá era otra forma de
      // hacer lo mismo, y el modal se lee mejor: las causas van agrupadas por M.
      '<label>Causa raíz (Ishikawa)</label>' +
      '<div style="display:flex; gap:6px; align-items:center;">' +
        '<input type="text" id="ahCausaDisplay" readonly style="flex:1; cursor:pointer;" value="' + ahEsc(ahCausaTexto()) + '" placeholder="Sin causa todavía · clic para elegir">' +
        '<button type="button" class="secondary" id="ahCausaBuscar" style="font-size:11px; padding:4px 8px;">🔍</button>' +
        '<button type="button" class="secondary" id="ahCausaQuitar" style="font-size:11px; padding:4px 8px; color:#b42318;" title="Quitar la causa">✕</button>' +
      '</div>' +
      '<label>Explicación</label>' +
      '<textarea id="ahExplicacion" rows="3" placeholder="Por qué ocurrió, en tus palabras.">' +
        ahEsc(d.explicacion || '') + '</textarea>' +
      '<div style="display:flex; gap:10px; margin-top:8px;">' +
        '<div style="flex:1"><label>Aplica al área</label><select id="ahAplica">' +
          ['si', 'no', 'pendiente'].map(function (v) {
            return '<option value="' + v + '"' + (d.aplica === v ? ' selected' : '') + '>' +
              ({ si: 'Sí aplica', no: 'No aplica', pendiente: 'Por revisar' })[v] + '</option>';
          }).join('') + '</select></div>' +
        '<div style="flex:1"><label>Tipo</label><select id="ahTipo">' +
          Object.keys(TIPO_TXT).map(function (v) {
            return '<option value="' + v + '"' + (d.tipo === v ? ' selected' : '') + '>' +
              ahEsc(TIPO_TXT[v]) + '</option>';
          }).join('') + '</select></div>' +
      '</div>' +
      '<div class="ahpie">' +
        '<button class="ahbtn" id="ahGuardar">Guardar y siguiente</button>' +
        '<span style="font-size:10.5px; color:#90a4ae;" id="ahMsg">' +
          (d.fuente ? 'Origen: ' + ahEsc(d.fuente) : '') + '</span>' +
      '</div>' +
    '</div>';
  document.getElementById('ahGuardar').addEventListener('click', ahGuardar);
  var abrir = function () { if (typeof abrirIshikawaModal === 'function') abrirIshikawaModal('analisis'); };
  document.getElementById('ahCausaDisplay').addEventListener('click', abrir);
  document.getElementById('ahCausaBuscar').addEventListener('click', abrir);
  document.getElementById('ahCausaQuitar').addEventListener('click', function () {
    AH.causaSel = null;
    document.getElementById('ahCausaDisplay').value = '';
  });
}

function ahCausaTexto() {
  var c = AH.causaSel;
  if (!c || !c.cod_causa) return '';
  // El nombre de la categoría y el texto de la sub-causa salen del catálogo cuando el
  // reclamo no los trae: lo importado de planilla a veces tiene el código y no el
  // texto, y mostrar sólo «[MO06] Mano de Obra» deja la fila a medias.
  var del = AH.causas.filter(function (x) { return x.codigo === c.cod_causa; })[0] || {};
  var cat = del.categoria_nombre || c.categoria || '';
  var sub = c.sub_causa || del.descripcion || '';
  return '[' + c.cod_causa + '] ' + cat + (sub ? ' > ' + sub : '');
}

// LO QUE EL MODAL NECESITA SABER de esta pantalla, y lo que devuelve. Expuesto en
// window porque el modal vive en otro archivo y así no hay que duplicarlo.
window.ahIshikawa = function () {
  return { categoria: AH.causaSel && AH.causaSel.categoria, cod_causa: AH.causaSel && AH.causaSel.cod_causa,
           sub_causa: AH.causaSel && AH.causaSel.sub_causa, area_id: AH.area_id };
};
window.ahCausaElegida = function (sel) {
  AH.causaSel = { categoria: sel.categoria, cod_causa: sel.cod_causa, sub_causa: sel.sub_causa };
  var el = document.getElementById('ahCausaDisplay');
  if (el) el.value = ahCausaTexto();
}

// No hay helper de PUT en la capa compartida; se arma como en el resto del archivo.
async function ahPut(ruta, cuerpo) {
  var r = await fetch(apiUrl(ruta), {
    method: 'PUT',
    headers: Object.assign({}, authHeaders(), { 'Content-Type': 'application/json' }),
    body: JSON.stringify(cuerpo)
  });
  var j = await r.json().catch(function () { return null; });
  if (!r.ok) throw new Error((j && (j.detail || j.message)) || ('Error ' + r.status));
  return j;
}

async function ahGuardar() {
  var d = AH.detalle;
  if (!d) return;
  var btn = document.getElementById('ahGuardar');
  btn.disabled = true;
  try {
    var guardado = await ahPut('/reclamos/analisis/' + d.id, {
      cod_causa: (AH.causaSel && AH.causaSel.cod_causa) || null,
      explicacion: document.getElementById('ahExplicacion').value,
      aplica: document.getElementById('ahAplica').value,
      tipo_reclamo: document.getElementById('ahTipo').value
    });
    if (guardado) {
      // Se actualiza la fila en la lista sin recargar todo: recargar perdería el
      // desplazamiento y los filtros puestos, que es lo que más molesta haciendo esto
      // en serie.
      AH.filas.forEach(function (f) {
        if (f.id === d.id) {
          f.estado = guardado.estado; f.categoria = guardado.categoria;
          f.cod_causa = guardado.cod_causa; f.aplica = guardado.aplica;
          f.tipo = guardado.tipo;
        }
      });
      ahPintarFiltros();
      ahSiguiente(d.id);
    }
  } catch (e) {
    var m = document.getElementById('ahMsg');
    if (m) { m.textContent = e.message; m.style.color = '#c62828'; }
  }
  btn.disabled = false;
}

// AL GUARDAR, EL SIGUIENTE. Es lo que hace la diferencia entre clasificar veinte en una
// sentada o cinco: el siguiente PENDIENTE de la lista visible, saltándose los ya listos.
function ahSiguiente(desdeId) {
  var vis = ahVisibles();
  var i = vis.findIndex(function (f) { return f.id === desdeId; });
  for (var k = i + 1; k < vis.length; k++) {
    if (vis[k].estado !== 'validado') { ahAbrir(vis[k].id); return; }
  }
  for (var j = 0; j < vis.length; j++) {
    if (vis[j].estado !== 'validado') { ahAbrir(vis[j].id); return; }
  }
  ahPintarLista();
  AH.detalle = null;
  ahPintarDetalle();
}

async function cargarAnalisisHistorico() {
  if (AH.cargado) { ahPintarFiltros(); ahPintarLista(); return; }
  var d = await apiGet('/reclamos/analisis');
  if (!d) return;
  AH.filas = d.filas || [];
  AH.causas = d.causas || [];
  AH.area_id = d.area_id || null;
  AH.cargado = true;
  // Se abre en lo que falta: entrar y ver los ya validados primero sería empezar
  // buscando.
  AH_F.estado = ['sin_causa', 'por_validar'];
  ahPintarFiltros();
  ahPintarLista();
  ahPintarDetalle();
}

// ── INDICADORES (5-oct) ─────────────────────────────────────────────────────────
// Los reclamos contra lo cubicado. Un reclamo solo no dice nada; la TASA —reclamos por
// cada 1.000 toneladas— sí, y es la que orienta dónde apuntar. El denominador viene de
// aSa; las dos fuentes se cruzan acá por año, persona, obra y segmento.
var IN = { base: [], reclamos: [], anio_en_curso: null, sin_base: [], cargado: false };
var IN_F = { anio: [], servicio: [], cubicador: [], segmento: [] };

function inNum(x, dec) {
  if (x == null || isNaN(x)) return '·';
  return Number(x).toLocaleString('es-CL', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
}

function inPasa(f) {
  return (!IN_F.anio.length || IN_F.anio.indexOf(f.anio) >= 0)
    && (!IN_F.servicio.length || IN_F.servicio.indexOf(f.servicio) >= 0)
    && (!IN_F.cubicador.length || IN_F.cubicador.indexOf(f.persona) >= 0)
    && (!IN_F.segmento.length || IN_F.segmento.indexOf(f.segmento) >= 0);
}

// LOS AÑOS CON BASE. Una tasa necesita numerador y denominador del mismo período: si
// aSa no estaba completo ese año, no se calcula nada con él. Y lo que NO aplica al área
// no es un error de cubicación: sale del numerador.
function inConBase(filas) {
  return filas.filter(function (f) { return IN.sin_base.indexOf(f.anio) < 0; });
}
function inReclamosUtiles() {
  return inConBase(IN.reclamos.filter(inPasa)).filter(function (r) { return r.aplica !== 'no'; });
}

// Suma base y reclamos por una clave, y calcula la tasa. Devuelve filas ordenadas.
function inCruce(clave, claveRec) {
  claveRec = claveRec || clave;
  var m = {};
  inConBase(IN.base.filter(inPasa)).forEach(function (b) {
    var k = b[clave]; if (k == null) return;
    (m[k] = m[k] || { k: k, ton: 0, cc: 0, obras: {}, n: 0, kilos: 0, servicio: b.servicio })
    ; m[k].ton += b.ton; m[k].cc += b.cc; m[k].obras[b.obra_id] = 1;
  });
  inReclamosUtiles().forEach(function (r) {
    var k = r[claveRec]; if (k == null) return;
    (m[k] = m[k] || { k: k, ton: 0, cc: 0, obras: {}, n: 0, kilos: 0, servicio: r.servicio });
    m[k].n += r.n; m[k].kilos += r.kilos;
  });
  return Object.keys(m).map(function (k) {
    var x = m[k];
    x.nobras = Object.keys(x.obras).length;
    x.tasa = x.ton > 0 ? x.n * 1000 / x.ton : null;
    x.pct_kg = x.ton > 0 ? x.kilos / (x.ton * 1000) * 100 : null;
    return x;
  });
}

function inValores(clave, fuente) {
  var v = [];
  (fuente || IN.base.concat(IN.reclamos)).forEach(function (f) {
    var k = f[clave]; if (k != null && v.indexOf(k) < 0) v.push(k);
  });
  return v.sort(function (a, b) { return typeof a === 'number' ? b - a : String(a).localeCompare(String(b)); });
}

function inGrupo(titulo, clave, valores, etiqueta) {
  var sel = IN_F[clave];
  return '<span class="dshbl">' + rhEsc(titulo) + '</span><div class="dshchips" data-g="' + clave + '">' +
    valores.map(function (v) {
      return '<button data-v="' + rhEsc(v) + '" class="' + (sel.indexOf(v) >= 0 ? 'on' : '') + '">' +
        rhEsc(etiqueta ? etiqueta(v) : v) + '</button>';
    }).join('') + '</div>';
}

function inPintarFiltros() {
  var cont = document.getElementById('inFiltros');
  if (!cont) return;
  // Los cubicadores que se ofrecen son los que TIENEN base en aSa: son los únicos con
  // tasa. Los demás salen igual en la tabla, abajo, marcados sin base.
  var conBase = inValores('persona', IN.base.filter(function (b) { return b.conocido; }));
  cont.innerHTML =
    '<div class="dshbarra">' +
      inGrupo('Año', 'anio', inValores('anio')) + '<span class="dshsep"></span>' +
      inGrupo('Servicio', 'servicio', ['Interno', 'Externo']) + '<span class="dshsep"></span>' +
      inGrupo('Segmento', 'segmento', inValores('segmento', IN.base)) +
      '<span class="muted" style="font-size:10px; margin-left:auto;">clic = sólo ése · Ctrl+clic = sumar · clic en el encendido = todos</span>' +
    '</div>' +
    '<div class="dshbarra">' + inGrupo('Cubicador', 'cubicador', conBase) + '</div>';
  cont.querySelectorAll('.dshchips button').forEach(function (b) {
    b.addEventListener('click', function (ev) {
      var g = b.parentNode.dataset.g;
      rhMarcar(IN_F[g], g === 'anio' ? Number(b.dataset.v) : b.dataset.v, ev);
      inPintarFiltros(); inPintarTodo();
    });
  });
}

function inPintarTodo() {
  var base = inConBase(IN.base.filter(inPasa));
  var rec = inReclamosUtiles();
  var ton = base.reduce(function (a, b) { return a + b.ton; }, 0);
  var n = rec.reduce(function (a, r) { return a + r.n; }, 0);
  var kilos = rec.reduce(function (a, r) { return a + r.kilos; }, 0);
  var obrasBase = {}; base.forEach(function (b) { obrasBase[b.obra_id] = 1; });
  var obrasRec = {}; rec.forEach(function (r) { if (r.obra_id) obrasRec[r.obra_id] = 1; });
  var nObras = Object.keys(obrasBase).length;
  var nObrasRec = Object.keys(obrasRec).filter(function (o) { return obrasBase[o]; }).length;
  var tasa = ton > 0 ? n * 1000 / ton : null;
  var pctKg = ton > 0 ? kilos / (ton * 1000) * 100 : null;

  // LOS CUATRO NÚMEROS QUE RESUMEN EL PERÍODO, cada uno con su detalle debajo.
  var k = document.getElementById('inKpis');
  if (k) {
    k.innerHTML =
      '<div class="inkpi"><div class="l">Reclamos por 1.000 ton</div><div class="v">' + inNum(tasa, 1) +
        '</div><div class="d">' + inNum(n) + ' reclamos sobre ' + inNum(ton) + ' ton cubicadas</div></div>' +
      '<div class="inkpi"><div class="l">Kilos mal fabricados</div><div class="v">' + inNum(pctKg, 2) + '<small>%</small>' +
        '</div><div class="d">' + inNum(kilos) + ' kg de ' + inNum(ton * 1000) + ' kg cubicados</div></div>' +
      '<div class="inkpi"><div class="l">Reclamos por obra</div><div class="v">' + inNum(nObras ? n / nObras : null, 2) +
        '</div><div class="d">' + inNum(n) + ' reclamos en ' + inNum(nObras) + ' obras cubicadas</div></div>' +
      '<div class="inkpi"><div class="l">Obras con algún reclamo</div><div class="v">' +
        inNum(nObras ? nObrasRec * 100 / nObras : null, 0) + '<small>%</small>' +
        '</div><div class="d">' + inNum(nObrasRec) + ' de ' + inNum(nObras) + ' obras</div></div>';
  }

  // Tasa por año. Los años sin base van en la etiqueta pero sin barra.
  var anios = inValores('anio').slice().sort(function (a, b) { return a - b; })
    .filter(function (a) { return !IN_F.anio.length || IN_F.anio.indexOf(a) >= 0; });
  var porAnio = {}; inCruce('anio').forEach(function (x) { porAnio[x.k] = x; });
  rhBarras('inChartTasa', anios.map(function (a) {
    var x = porAnio[a];
    var sinBase = IN.sin_base.indexOf(a) >= 0;
    return [String(a) + (a === IN.anio_en_curso ? ' (en curso)' : ''),
            sinBase ? 'sin base en aSa' : (x ? inNum(x.n) + ' recl · ' + inNum(x.ton) + ' ton' : '')];
  }), [{ nombre: 'Reclamos por 1.000 ton', color: '#00897b',
         datos: anios.map(function (a) { var x = porAnio[a]; return x && x.tasa != null ? Math.round(x.tasa * 10) / 10 : 0; }) }]);

  inTabla('inSegmentos', inCruce('segmento'), 'Segmento', tasa, false);
  inPintarServicio(anios);
  inTabla('inCubicadores', inCruce('persona'), 'Cubicador', tasa, true);
  inPareto(rec, base);
  inLectura(tasa, n, ton, inCruce('persona'), rec, base);
}

// La tabla volumen-contra-reclamos. Ordenada por tasa; sin base al final.
function inTabla(id, filas, titulo, promedio, conServicio) {
  var t = document.getElementById(id);
  if (!t) return;
  filas.sort(function (a, b) {
    if (a.tasa == null && b.tasa == null) return b.n - a.n;
    if (a.tasa == null) return 1; if (b.tasa == null) return -1;
    return b.tasa - a.tasa;
  });
  var maxTasa = Math.max.apply(null, [0.1].concat(filas.map(function (f) { return f.tasa || 0; })));
  t.innerHTML = '<thead><tr><th>' + rhEsc(titulo) + '</th>' + (conServicio ? '<th>Servicio</th>' : '') +
    '<th>Ton cubicadas</th><th>Obras</th><th>Reclamos</th><th>Reclamos / 1.000 ton</th><th style="width:120px"></th>' +
    '<th>Kg mal fabricados</th><th>% del cubicado</th></tr></thead><tbody>' +
    filas.map(function (f) {
      var cls = f.tasa == null ? 'sinbase' : (promedio != null && f.tasa > promedio * 1.15 ? 'peor' : (promedio != null && f.tasa < promedio * 0.85 ? 'mejor' : ''));
      return '<tr><td title="' + rhEsc(f.k) + '">' + rhEsc(f.k) + '</td>' +
        (conServicio ? '<td>' + rhEsc(f.servicio || '') + '</td>' : '') +
        '<td>' + (f.ton ? inNum(f.ton) : '<span class="sinbase">·</span>') + '</td>' +
        '<td>' + (f.nobras || '·') + '</td><td><b>' + inNum(f.n) + '</b></td>' +
        '<td class="' + cls + '">' + (f.tasa == null ? 'sin base' : inNum(f.tasa, 1)) + '</td>' +
        '<td><span class="inbar" style="width:' + (f.tasa ? Math.round(f.tasa / maxTasa * 110) : 0) + 'px"></span></td>' +
        '<td>' + inNum(f.kilos) + '</td><td>' + (f.pct_kg == null ? '·' : inNum(f.pct_kg, 2) + '%') + '</td></tr>';
    }).join('') + '</tbody>';
}

// PARETO DE OBRAS: cuántas obras juntan la mitad y el 80% de los reclamos.
function inPareto(rec, base) {
  var t = document.getElementById('inObras');
  if (!t) return;
  var porObra = {};
  rec.forEach(function (r) {
    var k = r.obra_id || r.obra;
    (porObra[k] = porObra[k] || { obra: r.obra, id: r.obra_id, n: 0, kilos: 0, ton: 0 });
    porObra[k].n += r.n; porObra[k].kilos += r.kilos;
  });
  base.forEach(function (b) { if (porObra[b.obra_id]) porObra[b.obra_id].ton += b.ton; });
  var lista = Object.keys(porObra).map(function (k) { return porObra[k]; }).sort(function (a, b) { return b.n - a.n; });
  var total = lista.reduce(function (a, o) { return a + o.n; }, 0);
  var acum = 0;
  t.innerHTML = '<thead><tr><th>Obra</th><th>Reclamos</th><th>% del total</th><th>Acumulado</th>' +
    '<th>Ton cubicadas</th><th>Reclamos / 1.000 ton</th><th>Kg mal fabricados</th></tr></thead><tbody>' +
    lista.slice(0, 15).map(function (o) {
      acum += o.n;
      return '<tr><td title="' + rhEsc(o.obra) + '">' + rhEsc(o.obra) + '</td><td><b>' + inNum(o.n) + '</b></td>' +
        '<td>' + (total ? inNum(o.n * 100 / total, 0) : '·') + '%</td>' +
        '<td>' + (total ? inNum(acum * 100 / total, 0) : '·') + '%</td>' +
        '<td>' + (o.ton ? inNum(o.ton) : '<span class="sinbase">·</span>') + '</td>' +
        '<td>' + (o.ton ? inNum(o.n * 1000 / o.ton, 1) : '<span class="sinbase">sin base</span>') + '</td>' +
        '<td>' + inNum(o.kilos) + '</td></tr>';
    }).join('') + '</tbody>';
  IN._pareto = { lista: lista, total: total };
}

// INTERNO CONTRA EXTERNO. Las cuatro medidas del período para cada servicio, y la tasa
// por año para ver si la diferencia se sostiene o es de un año puntual. El filtro de
// servicio NO se aplica acá a propósito: este cuadro existe para comparar los dos, y
// filtrando uno quedaría comparando contra nada. Los demás filtros sí.
// LOS SEGMENTOS QUE SE COMPARAN APARTE, debajo de las cuatro medidas: donde hay obras y
// reclamos de los dos servicios. «Otros» no (6 obras) y «(sin segmento)» tampoco: no dicen
// nada. YPS va porque el usuario quiso verlo aunque casi no tenga reclamos (6-oct).
var IN_SEGMENTOS_LADO_A_LADO = ['1 y 2', '4 y 5', 'YPS'];

// `segmento`: si viene, manda sobre el filtro de segmento de la barra; es para las filas por
// segmento, que son un desglose fijo y no deben vaciarse porque arriba se eligió otro.
function inMedidasServicio(filtroAnio, segmento) {
  var out = {};
  ['Interno', 'Externo'].forEach(function (s) {
    out[s] = { ton: 0, n: 0, kilos: 0, obras: {}, obrasRec: {} };
  });
  var pasaSinServicio = function (f) {
    return (!IN_F.anio.length || IN_F.anio.indexOf(f.anio) >= 0)
      && (!IN_F.cubicador.length || IN_F.cubicador.indexOf(f.persona) >= 0)
      && (segmento != null ? f.segmento === segmento
                           : (!IN_F.segmento.length || IN_F.segmento.indexOf(f.segmento) >= 0))
      && (filtroAnio == null || f.anio === filtroAnio);
  };
  inConBase(IN.base.filter(pasaSinServicio)).forEach(function (b) {
    var o = out[b.servicio]; if (!o) return;
    o.ton += b.ton; o.obras[b.obra_id] = 1;
  });
  inConBase(IN.reclamos.filter(pasaSinServicio)).forEach(function (r) {
    if (r.aplica === 'no') return;
    var o = out[r.servicio]; if (!o) return;
    o.n += r.n; o.kilos += r.kilos;
    if (r.obra_id) o.obrasRec[r.obra_id] = 1;
  });
  Object.keys(out).forEach(function (s) {
    var o = out[s];
    o.nobras = Object.keys(o.obras).length;
    o.nobrasRec = Object.keys(o.obrasRec).filter(function (k) { return o.obras[k]; }).length;
    o.tasa = o.ton > 0 ? o.n * 1000 / o.ton : null;
    o.pct_kg = o.ton > 0 ? o.kilos / (o.ton * 1000) * 100 : null;
    o.por_obra = o.nobras ? o.n / o.nobras : null;
    o.pct_obras = o.nobras ? o.nobrasRec * 100 / o.nobras : null;
  });
  return out;
}

function inPintarServicio(anios) {
  var COLOR = { Interno: '#c62828', Externo: '#1565C0' };
  rhBarras('inChartServicio', anios.map(function (a) {
    var sinBase = IN.sin_base.indexOf(a) >= 0;
    return [String(a) + (a === IN.anio_en_curso ? ' (en curso)' : ''), sinBase ? 'sin base en aSa' : ''];
  }), ['Interno', 'Externo'].map(function (s) {
    return { nombre: s, color: COLOR[s], datos: anios.map(function (a) {
      if (IN.sin_base.indexOf(a) >= 0) return 0;
      var m = inMedidasServicio(a)[s];
      return m.tasa != null ? Math.round(m.tasa * 10) / 10 : 0;
    }) };
  }));

  var m = inMedidasServicio(null);
  var t = document.getElementById('inServicioTabla');
  var filas = [
    ['Toneladas cubicadas', function (o) { return inNum(o.ton); }, null],
    ['Reclamos', function (o) { return inNum(o.n); }, null],
    ['Reclamos por 1.000 ton', function (o) { return inNum(o.tasa, 1); }, 'tasa'],
    ['% kilos mal fabricados', function (o) { return o.pct_kg == null ? '·' : inNum(o.pct_kg, 3) + '%'; }, 'pct_kg'],
    ['Reclamos por obra', function (o) { return inNum(o.por_obra, 2); }, 'por_obra'],
    ['% obras con algún reclamo', function (o) { return o.pct_obras == null ? '·' : inNum(o.pct_obras, 0) + '%'; }, 'pct_obras']
  ];
  var peor = {};   // quién sale peor en cada medida comparable
  filas.forEach(function (f) {
    if (!f[2]) return;
    var i = m.Interno[f[2]], e = m.Externo[f[2]];
    if (i == null || e == null || i === e) return;
    peor[f[2]] = i > e ? 'Interno' : 'Externo';
  });
  // POR SEGMENTO: la tasa de cada servicio dentro de 1 y 2, 4 y 5 e YPS. Sólo los
  // segmentos con algo que mostrar, y el rojo sólo donde hay con qué comparar (los dos
  // servicios con base).
  var porSeg = IN_SEGMENTOS_LADO_A_LADO.map(function (seg) {
    var ms = inMedidasServicio(null, seg);
    var pe = null;
    if (ms.Interno.tasa != null && ms.Externo.tasa != null && ms.Interno.tasa !== ms.Externo.tasa) {
      pe = ms.Interno.tasa > ms.Externo.tasa ? 'Interno' : 'Externo';
    }
    return { seg: seg, m: ms, peor: pe };
  }).filter(function (x) { return x.m.Interno.ton || x.m.Externo.ton || x.m.Interno.n || x.m.Externo.n; });
  if (t) {
    t.innerHTML = '<thead><tr><th>Medida</th><th>Interno</th><th>Externo</th></tr></thead><tbody>' +
      filas.map(function (f) {
        return '<tr><td>' + f[0] + '</td>' + ['Interno', 'Externo'].map(function (s) {
          var cls = f[2] && peor[f[2]] === s ? 'peor' : (f[2] && peor[f[2]] && peor[f[2]] !== s ? 'mejor' : '');
          return '<td class="' + cls + '">' + f[1](m[s]) + '</td>';
        }).join('') + '</tr>';
      }).join('') +
      (porSeg.length ? '<tr class="rhsubfila"><td colspan="3">Reclamos por 1.000 ton, por segmento</td></tr>' +
        porSeg.map(function (x) {
          return '<tr><td>Segmento ' + rhEsc(x.seg) + '</td>' + ['Interno', 'Externo'].map(function (s) {
            var o = x.m[s];
            var cls = x.peor === s ? 'peor' : (x.peor && x.peor !== s ? 'mejor' : '');
            return '<td class="' + cls + '" title="' + inNum(o.n) + ' reclamos sobre ' + inNum(o.ton) + ' ton">' +
              inNum(o.tasa, 1) + '</td>';
          }).join('') + '</tr>';
        }).join('') : '') + '</tbody>';
  }

  // LA CONCLUSIÓN EN UNA LÍNEA. Cuenta en cuántas de las cuatro medidas sale peor cada
  // uno: si es 4 a 0 la diferencia es contundente; si es 2 a 2, no lo es, y decirlo es
  // tan importante como lo otro.
  var el = document.getElementById('inServicioLectura');
  if (el) {
    var cuenta = { Interno: 0, Externo: 0 };
    Object.keys(peor).forEach(function (k) { cuenta[peor[k]]++; });
    var total = Object.keys(peor).length;
    if (!total) el.innerHTML = 'No hay base suficiente para comparar.';
    else if (cuenta.Externo === total) el.innerHTML = 'El servicio <b>externo sale peor en las ' + total + ' medidas</b>.';
    else if (cuenta.Interno === total) el.innerHTML = 'El servicio <b>interno sale peor en las ' + total + ' medidas</b>.';
    else el.innerHTML = 'No es parejo: el externo sale peor en <b>' + cuenta.Externo + '</b> medida' +
      (cuenta.Externo === 1 ? '' : 's') + ' y el interno en <b>' + cuenta.Interno + '</b>.';
    // Y por segmento, en una frase: dónde sale peor cada uno (sólo donde se puede comparar).
    var peorExt = porSeg.filter(function (x) { return x.peor === 'Externo'; }).map(function (x) { return x.seg; });
    var peorInt = porSeg.filter(function (x) { return x.peor === 'Interno'; }).map(function (x) { return x.seg; });
    if (peorExt.length || peorInt.length) {
      var partes = [];
      if (peorExt.length) partes.push('el externo sale peor en <b>' + peorExt.map(rhEsc).join('</b> y <b>') + '</b>');
      if (peorInt.length) partes.push('el interno sale peor en <b>' + peorInt.map(rhEsc).join('</b> y <b>') + '</b>');
      el.innerHTML += ' Por segmento, ' + partes.join('; ') + '.';
    }
  }
}

// LA LECTURA: una línea que dice qué está pasando, para quien no quiera leer tablas.
function inLectura(tasa, n, ton, personas, rec, base) {
  var el = document.getElementById('inLectura');
  if (!el) return;
  if (!ton) { el.innerHTML = 'No hay toneladas cubicadas en aSa para lo filtrado, así que no se puede calcular una tasa.'; return; }
  var partes = ['<b>' + inNum(tasa, 1) + ' reclamos por cada 1.000 toneladas</b> cubicadas'];
  var p = IN._pareto || { lista: [], total: 0 };
  if (p.total) {
    var acum = 0, k = 0;
    for (var i = 0; i < p.lista.length; i++) { acum += p.lista[i].n; k++; if (acum >= p.total / 2) break; }
    partes.push('la mitad de los reclamos está en <b>' + k + ' obra' + (k === 1 ? '' : 's') + '</b>');
  }
  var conTasa = personas.filter(function (x) { return x.tasa != null && x.n > 0; });
  if (conTasa.length > 1) {
    conTasa.sort(function (a, b) { return b.tasa - a.tasa; });
    partes.push('la tasa más alta es la de <b>' + rhEsc(conTasa[0].k) + '</b> (' + inNum(conTasa[0].tasa, 1) +
      ') y la más baja la de <b>' + rhEsc(conTasa[conTasa.length - 1].k) + '</b> (' + inNum(conTasa[conTasa.length - 1].tasa, 1) + ')');
  }
  el.innerHTML = partes.join(' · ') + '.';
}

async function loadDashIndicadores() {
  if (IN.cargado) { inPintarFiltros(); inPintarTodo(); return; }
  var d = await apiGet('/reclamos/indicadores');
  if (!d) return;
  IN.base = d.base || []; IN.reclamos = d.reclamos || [];
  IN.anio_en_curso = d.anio_en_curso; IN.sin_base = d.anios_sin_base || [];
  IN.cargado = true;
  inPintarFiltros();
  inPintarTodo();
}

// Cómo se dice cada tipo en pantalla. El valor crudo es el que viaja a la base.
var TIPO_TXT = {
  error: 'Error de cubicación', faltante: 'Faltante de cubicación', atraso: 'Atraso',
  actualizacion_portal: 'Actualización portal', documentacion: 'Documentación',
  stock: 'Stock', programacion: 'Programación', diferencia_kg: 'Diferencia de kg'
};

// KPI: causas de los reclamos CERRADOS, como árbol causa → sub-causa. La sub-causa
// es la que importa (pedido del usuario); la causa gruesa solo agrupa. Barras
// horizontales con la cantidad escrita encima: legible sin leyenda ni tooltip.
async function loadDashKpis() {
  if (_dashKpisLoaded) return;
  var data = await apiGet('/reclamos/kpi-causas');
  if (!data) return;
  _dashKpisLoaded = true;
  var uni = document.getElementById('dashKpiUniverso');
  if (uni) {
    // Universo explicito y SEPARADO: "no aplica" no lleva causa por definicion; "por
    // clasificar" es el pendiente real (cerrado, si aplica, sin causa).
    var partes = ['<b>' + (data.cerrados || 0) + '</b> cerrados', '<b>' + (data.con_causa || 0) + '</b> con causa'];
    if (data.no_aplica) partes.push(data.no_aplica + ' no aplica');
    if (data.por_clasificar) partes.push('<span style="color:#e65100; font-weight:700;">' + data.por_clasificar + ' por clasificar</span>');
    uni.innerHTML = '· ' + partes.join(' · ');
  }
  var cont = document.getElementById('dashKpiArbol');
  if (!cont) return;
  var arbol = data.arbol || [];
  if (!arbol.length) {
    cont.innerHTML = '<div class="muted" style="font-style:italic;">Todavía no hay reclamos cerrados con causa asignada.</div>';
    return;
  }
  // PARETO (usuario 21-sep): lista PLANA ordenada por ocurrencia, la categoría como
  // columna en vez de como grupo, y el corte del 80% acumulado resaltado. El árbol
  // por grupo escondía lo que importa: que UNA sub-causa es el 40% y con la segunda
  // ya se va en el 56%. Las filas hasta el 80% van sombreadas ("los pocos vitales")
  // y bajo la última de ellas una línea con el rótulo.
  var labels = (typeof _recIshikawaLabels !== 'undefined') ? _recIshikawaLabels : {};
  var colores = (typeof _ishikawaCatColors !== 'undefined') ? _ishikawaCatColors : {};
  var filas = [];
  arbol.forEach(function (c) {
    (c.subcausas || []).forEach(function (sc) { filas.push({ causa: c.causa, sub: sc.sub, n: sc.n }); });
  });
  filas.sort(function (a, b) { return (b.n - a.n) || String(a.sub).localeCompare(b.sub); });
  var total = data.con_causa || 1, max = filas.length ? filas[0].n : 1;
  var acum = 0, corte = -1;
  filas.forEach(function (f, k) { acum += f.n; f.acum = Math.round(100 * acum / total); if (corte < 0 && acum >= 0.8 * total) corte = k; });
  // El % parcial va en SU columna (usuario 21-sep): pegado al conteo quedaba
  // desalineado entre filas de una y dos cifras. Cuatro numericas alineadas a la
  // derecha: Reclamos · % · Acum.
  var COLS = 'minmax(220px, 30%) 150px 1fr 56px 48px 56px';
  var html = '<div style="display:grid; grid-template-columns:' + COLS + '; gap:10px; padding:2px 0 6px; font-size:10px; color:#78909c; text-transform:uppercase; letter-spacing:.4px;">' +
    '<div>Sub-causa</div><div>Categoría</div><div></div><div style="text-align:right;">Reclamos</div><div style="text-align:right;">%</div><div style="text-align:right;">Acum.</div></div>';
  filas.forEach(function (f, k) {
    var col = colores[f.causa] || '#546e7a';
    var pct = Math.max(2, Math.round(100 * f.n / max));
    var share = Math.round(100 * f.n / total);
    var vital = (k <= corte);
    html += '<div style="display:grid; grid-template-columns:' + COLS + '; gap:10px; align-items:center; padding:3px 6px; margin:0 -6px; border-radius:4px;' +
        (vital ? ' background:#f1f8e9;' : '') + '">' +
      '<div style="color:#37474f; line-height:1.25;" title="' + _escDash(f.sub) + '">' + _escDash(f.sub) + '</div>' +
      '<div style="display:flex; align-items:center; gap:6px; color:#546e7a; font-size:11px;">' +
        '<span style="display:inline-block; width:9px; height:9px; border-radius:2px; background:' + col + '; flex:none;"></span>' +
        '<span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + _escDash(labels[f.causa] || f.causa) + '</span></div>' +
      '<div style="height:18px; background:#f1f3f4; border-radius:3px;">' +
        '<div style="width:' + pct + '%; height:100%; background:' + col + '; border-radius:3px; opacity:.85;"></div></div>' +
      '<div style="text-align:right; color:#263238; font-weight:700;" title="' + f.n + ' de ' + total + ' con causa">' + f.n + '</div>' +
      '<div style="text-align:right; color:#78909c;">' + share + '%</div>' +
      '<div style="text-align:right; font-weight:' + (vital ? '700' : '400') + '; color:' + (vital ? '#2e7d32' : '#90a4ae') + ';">' + f.acum + '%</div>' +
      '</div>';
    if (k === corte) {
      html += '<div style="display:flex; align-items:center; gap:8px; margin:4px 0 6px; color:#2e7d32; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.4px;">' +
        '<div style="flex:1; border-top:2px dashed #66bb6a;"></div><span>80% acumulado · ' + (corte + 1) + ' de ' + filas.length + ' sub-causas</span><div style="flex:1; border-top:2px dashed #66bb6a;"></div></div>';
    }
  });
  cont.innerHTML = html;
}
function _escDash(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

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
// recortado a lo esencial (N° · Título · Proyecto · CUBICADOR · Aplica). Clic en la fila
// abre el modal completo (verReclamo). Sin botones en la fila: las acciones
// (Aprobar/Validar/Devolver) viven dentro del modal.
function _renderColaReclamos(reclamos) {
  if (!reclamos || reclamos.length === 0) {
    return '<div class="muted" style="padding:8px 0; font-size:12px;">Sin pendientes.</div>';
  }
  var head = '<table style="width:100%; border-collapse:collapse; font-size:11px;">' +
    '<tr style="background:#f5f5f5; text-align:left;">' +
    '<th style="padding:4px 6px;">N°</th>' +
    '<th style="padding:4px 6px;">Título</th>' +
    '<th style="padding:4px 6px;">Proyecto</th>' +
    // CUBICADOR RESPONSABLE (usuario 22-sep): es lo que se necesita para saber a quién
    // reclamarle el pendiente. Se toma `responsable`, el MISMO campo que muestra la
    // lista oficial en su columna "Cub. Resp.", y la tabla baja a 11px para que quepa.
    '<th style="padding:4px 6px;">Cub. Resp.</th>' +
    '<th style="padding:4px 6px;">Aplica</th>' +
    '</tr>';
  var rows = reclamos.map(function(r) {
    var idLabel = (typeof _formatCorrelativoCalidad === 'function' && _formatCorrelativoCalidad(r)) || (r.correlativo || '#' + r.id);
    var aplLabel = _recAplicaLabels[r.aplica] || 'Pendiente';
    var aplColor = _recAplicaColors[r.aplica] || '#ff9800';
    var titulo = r.titulo || '';
    if (titulo.length > 45) titulo = titulo.substring(0, 45) + '…';
    // Solo el nombre: el correo entero no cabe y no aporta en una cola de pendientes.
    var cub = (r.responsable || '').split('@')[0] || '—';
    return '<tr style="border-bottom:1px solid #eee; cursor:pointer;" onclick="verReclamo(' + r.id + ', {origen:\'validaciones\'})" title="Ver ficha completa">' +
      '<td style="padding:4px 6px; font-weight:600; white-space:nowrap;">' + idLabel + '</td>' +
      '<td style="padding:4px 6px;">' + titulo + '</td>' +
      '<td style="padding:4px 6px; color:#666;">' + (r.nombre_proyecto || '—') + '</td>' +
      '<td style="padding:4px 6px; color:#37474f; white-space:nowrap;" title="' + _escDash(r.responsable || '') + '">' + _escDash(cub) + '</td>' +
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
