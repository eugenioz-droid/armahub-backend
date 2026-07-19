// ArmaHub Reclamos — Seguimiento de Acciones (5L.13)
// Tab de control global de acciones comprometidas en los reclamos: semáforo de
// vencimientos, avance y cambio de estado inline.
// - admin/admin_calidad ven TODAS (con toggle "Todas / Mis acciones").
// - El resto de roles ve solo las suyas: el backend fuerza el scope por
//   responsable_email (identificador estable, 5L.13-A) o creado_por.

var _accSeguimientoData = [];
var _accScopeMine = false;

var _ACC_VENC_LABELS = { vencida: 'Vencida', por_vencer: 'Por vencer', al_dia: 'Al día' };
var _ACC_VENC_COLORS = { vencida: '#c62828', por_vencer: '#e65100', al_dia: '#388e3c' };
var _ACC_ESTADO_ICONS = { pendiente: '⏳', en_proceso: '🔄', completada: '✅' };

async function loadRecAccionesSeguimiento() {
  var cont = document.getElementById('recAccionesGlobalList');
  if (!cont) return;
  // El toggle Todas/Mis acciones solo tiene sentido para quien puede ver todas.
  var scopeBtn = document.getElementById('recAccScopeBtn');
  var esSupervisor = (currentRole === 'admin' || currentRole === 'admin_calidad');
  if (scopeBtn) scopeBtn.style.display = esSupervisor ? '' : 'none';
  cont.innerHTML = '<div class="muted">Cargando acciones...</div>';
  var qs = (esSupervisor && _accScopeMine) ? '?scope=mine' : '';
  var data = await apiGet('/reclamos/acciones' + qs);
  if (!data) { cont.innerHTML = '<div class="muted">No fue posible cargar las acciones.</div>'; return; }
  _accSeguimientoData = data.data || [];
  renderRecAccionesSeguimiento();
}

function toggleAccScope() {
  _accScopeMine = !_accScopeMine;
  var btn = document.getElementById('recAccScopeBtn');
  if (btn) {
    btn.textContent = _accScopeMine ? 'Mis acciones' : 'Todas';
    btn.style.background = _accScopeMine ? '#fff' : '#00897b';
    btn.style.color = _accScopeMine ? '#00897b' : '#fff';
  }
  loadRecAccionesSeguimiento();
}

// Clic en KPI de vencimiento → filtra la tabla (y despeja el filtro de estado,
// porque los semáforos son de acciones NO completadas).
function setAccVencFiltro(v) {
  var venc = document.getElementById('accFiltroVenc');
  if (venc) venc.value = v;
  var est = document.getElementById('accFiltroEstado');
  if (est && v) est.value = '';
  renderRecAccionesSeguimiento();
}

function setAccEstadoFiltro(v) {
  var est = document.getElementById('accFiltroEstado');
  if (est) est.value = v;
  var venc = document.getElementById('accFiltroVenc');
  if (venc) venc.value = '';
  renderRecAccionesSeguimiento();
}

function limpiarFiltrosAcciones() {
  ['accFiltroEstado', 'accFiltroVenc', 'accFiltroBusqueda'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderRecAccionesSeguimiento();
}

function _accVencBadge(a) {
  if (a.estado === 'completada') {
    var f = a.fecha_completada ? formatDateShort(a.fecha_completada) : '';
    return '<span style="color:#666; font-size:10px;">✅ ' + (f || 'Completada') + '</span>';
  }
  if (!a.vencimiento) return '<span style="color:#ccc; font-size:10px;">—</span>';
  var color = _ACC_VENC_COLORS[a.vencimiento] || '#666';
  var texto;
  if (a.vencimiento === 'vencida') texto = 'Vencida hace ' + Math.abs(a.dias_para_vencer) + 'd';
  else if (a.vencimiento === 'por_vencer') texto = a.dias_para_vencer === 0 ? 'Vence HOY' : 'Vence en ' + a.dias_para_vencer + 'd';
  else texto = 'En ' + a.dias_para_vencer + 'd';
  return '<span style="display:inline-block; padding:1px 6px; border-radius:3px; font-size:10px; font-weight:700; color:#fff; background:' + color + ';">' + texto + '</span>';
}

function renderRecAccionesSeguimiento() {
  var cont = document.getElementById('recAccionesGlobalList');
  if (!cont) return;
  var items = _accSeguimientoData;

  // KPIs sobre el universo cargado (independientes de los filtros de tabla)
  var kV = 0, kP = 0, kA = 0, kC = 0;
  items.forEach(function(a) {
    if (a.estado === 'completada') { kC++; return; }
    if (a.vencimiento === 'vencida') kV++;
    else if (a.vencimiento === 'por_vencer') kP++;
    else if (a.vencimiento === 'al_dia') kA++;
  });
  var kpis = { accKpiVencidas: kV, accKpiPorVencer: kP, accKpiAlDia: kA, accKpiCompletadas: kC };
  Object.keys(kpis).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.textContent = kpis[id];
  });

  // Filtros de tabla
  var fEstado = (document.getElementById('accFiltroEstado') || {}).value || '';
  var fVenc = (document.getElementById('accFiltroVenc') || {}).value || '';
  var fBusq = ((document.getElementById('accFiltroBusqueda') || {}).value || '').trim().toLowerCase();
  var rows = items.filter(function(a) {
    if (fEstado && a.estado !== fEstado) return false;
    if (fVenc && a.vencimiento !== fVenc) return false;
    if (fBusq) {
      var blob = ((a.descripcion || '') + ' ' + (a.responsable || '') + ' ' + (a.correlativo || '') + ' ' + (a.titulo_reclamo || '')).toLowerCase();
      if (blob.indexOf(fBusq) === -1) return false;
    }
    return true;
  });

  if (rows.length === 0) {
    cont.innerHTML = '<div class="muted">No hay acciones con los filtros seleccionados.</div>';
    return;
  }

  cont.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
    '<tr style="background:#f5f5f5; text-align:left;">' +
      '<th style="padding:5px 6px;">Reclamo</th>' +
      '<th style="padding:5px 6px;">Tipo</th>' +
      '<th style="padding:5px 6px;">Acción</th>' +
      '<th style="padding:5px 6px;">Responsable</th>' +
      '<th style="padding:5px 6px;">F. Prevista</th>' +
      '<th style="padding:5px 6px;">Vencimiento</th>' +
      '<th style="padding:5px 6px;">Estado</th>' +
    '</tr>' +
    rows.map(function(a) {
      var tColor = (typeof _recAccionTipoColors !== 'undefined' && _recAccionTipoColors[a.tipo]) || '#666';
      var corr = a.correlativo || ('#' + a.reclamo_id);
      var estadoSel = '<select onclick="event.stopPropagation()" onchange="cambiarEstadoAccionSeguimiento(' + a.reclamo_id + ',' + a.id + ', this.value)" style="font-size:11px; padding:1px 4px;">' +
        ['pendiente', 'en_proceso', 'completada'].map(function(e) {
          return '<option value="' + e + '"' + (a.estado === e ? ' selected' : '') + '>' + _ACC_ESTADO_ICONS[e] + ' ' + e.replace('_', ' ') + '</option>';
        }).join('') + '</select>';
      return '<tr style="border-bottom:1px solid #eee; cursor:pointer;" onclick="verReclamo(' + a.reclamo_id + ', {origen:\'acciones\'})">' +
        '<td style="padding:4px 6px; font-weight:600; font-size:11px;" title="' + _esc2(a.titulo_reclamo || '') + '">' + _esc2(corr) + '</td>' +
        '<td style="padding:4px 6px;"><span style="color:' + tColor + '; font-weight:600; text-transform:capitalize; font-size:11px;">' + _esc2(a.tipo || '') + '</span></td>' +
        '<td style="padding:4px 6px;">' + _esc2(a.descripcion || '') + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;">' + _esc2(a.responsable || '-') + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;" class="muted">' + (a.fecha_prevista ? formatDateShort(a.fecha_prevista) : '—') + '</td>' +
        '<td style="padding:4px 6px;">' + _accVencBadge(a) + '</td>' +
        '<td style="padding:4px 6px;">' + estadoSel + '</td>' +
        '</tr>';
    }).join('') +
    '</table>' +
    '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + rows.length + ' de ' + items.length + ' acción(es)</div>';
}

// Cambio de estado inline. El backend permite: creador, responsable asignado
// o admin/admin_calidad; y mantiene fecha_completada coherente con el estado.
async function cambiarEstadoAccionSeguimiento(reclamoId, accionId, nuevoEstado) {
  var res = await fetch(apiUrl('/reclamos/' + reclamoId + '/acciones/' + accionId), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: nuevoEstado })
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    if (typeof showToast === 'function') showToast('Acción actualizada', 'success');
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
  // Recargar siempre: refresca KPIs y revierte el select si el PATCH falló.
  await loadRecAccionesSeguimiento();
}

// Escape local (no depende de otros features cargados)
function _esc2(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
