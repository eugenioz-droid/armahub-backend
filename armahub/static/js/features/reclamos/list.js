// ArmaHub Reclamos — List & Filters
// Split from index.js (PC.17.5)

var _recUsersCache = [];
async function loadRecUsersDropdown() {
  var res = await fetch(apiUrl('/users/dropdown'), { headers: authHeaders() });
  if (!res.ok) return;
  var data = await res.json();
  _recUsersCache = data.users || [];
  // Populate create form "Cubicador Responsable" (only cubicador/externo)
  var createSel = document.getElementById('recResponsable');
  if (createSel) {
    var val = createSel.value;
    createSel.innerHTML = '<option value="">— Sin asignar —</option>';
    _recUsersCache.filter(function(u) { return u.role === 'cubicador' || u.role === 'externo'; }).forEach(function(u) {
      createSel.innerHTML += '<option value="' + u.email + '" data-display="' + u.display + '">' + u.display + '</option>';
    });
    createSel.value = val;
  }
  // Populate acciones responsable (all users)
  var accionRespSel = document.getElementById('recNuevaAccionResp');
  if (accionRespSel) {
    var aval = accionRespSel.value;
    accionRespSel.innerHTML = '<option value="">— Seleccionar —</option>';
    _recUsersCache.forEach(function(u) {
      accionRespSel.innerHTML += '<option value="' + u.display + '">' + u.display + ' (' + u.role + ')</option>';
    });
    accionRespSel.value = aval;
  }
  // Populate filter "Cub. Responsable" (only cubicador/externo)
  var filterSel = document.getElementById('recFiltroResponsable');
  if (filterSel) {
    var fval = filterSel.value;
    filterSel.innerHTML = '<option value="">Cub. Resp.: Todos</option>';
    _recUsersCache.filter(function(u) { return u.role === 'cubicador' || u.role === 'externo'; }).forEach(function(u) {
      filterSel.innerHTML += '<option value="' + u.email + '">' + u.display + '</option>';
    });
    filterSel.value = fval;
  }
}

function populateRecFilterProyecto() {
  var src = document.getElementById('recProyecto');
  var dst = document.getElementById('recFiltroProyecto');
  if (!src || !dst) return;
  var fval = dst.value;
  dst.innerHTML = '<option value="">Proyecto: Todos</option>';
  for (var i = 0; i < src.options.length; i++) {
    if (src.options[i].value) {
      dst.innerHTML += '<option value="' + src.options[i].value + '">' + src.options[i].text + '</option>';
    }
  }
  dst.value = fval;
}

  // Scope toggle: cubicador/externo/usc can switch between own and all reclamos
  // _recScopeAll=false → showing MY reclamos → button says "Todos" (click to see all)
  // _recScopeAll=true  → showing ALL reclamos → button says "Mis Reclamos" (click to filter)
  var _recScopeAll = false;
  var _recScopeInitialized = false;

  function _initScopeToggle() {
    var scopeBtn = document.getElementById('recFiltroScope');
    if (!scopeBtn) return;
    if (!['usc','cubicador'].includes(currentRole)) {
      scopeBtn.style.display = 'none';
      return;
    }
    scopeBtn.style.display = '';
    if (!_recScopeInitialized) {
      _recScopeInitialized = true;
      _recScopeAll = false;
      _updateScopeBtnLabel(scopeBtn);
    }
  }

  function _updateScopeBtnLabel(btn) {
    if (!btn) btn = document.getElementById('recFiltroScope');
    if (!btn) return;
    if (_recScopeAll) {
      // Showing ALL → button offers to filter to mine
      btn.textContent = 'Mis Reclamos';
      btn.style.background = '#fff';
      btn.style.borderColor = '#e53935';
      btn.style.color = '#e53935';
    } else {
      // Showing MINE → button offers to see all
      btn.textContent = 'Todos';
      btn.style.background = '#fff';
      btn.style.borderColor = '#1976d2';
      btn.style.color = '#1976d2';
    }
  }

  window.toggleRecScope = function() {
    _recScopeAll = !_recScopeAll;
    _updateScopeBtnLabel();
    loadReclamos();
  };

async function loadReclamos() {
  _initScopeToggle();
  var container = document.getElementById('reclamosList');
  var estado = document.getElementById('recFiltroEstado').value;
  var categoria = document.getElementById('recFiltroCategoria').value;
  var aplica = document.getElementById('recFiltroAplica').value;
  var tipo = document.getElementById('recFiltroTipo') ? document.getElementById('recFiltroTipo').value : '';
  var detectado = document.getElementById('recFiltroDetectado') ? document.getElementById('recFiltroDetectado').value : '';
  var proyecto = document.getElementById('recFiltroProyecto') ? document.getElementById('recFiltroProyecto').value : '';
  var responsable = document.getElementById('recFiltroResponsable') ? document.getElementById('recFiltroResponsable').value : '';
  var busqueda = document.getElementById('recFiltroBusqueda') ? document.getElementById('recFiltroBusqueda').value.trim() : '';
  var url = '/reclamos';
  var params = [];
  if (estado) params.push('estado=' + encodeURIComponent(estado));
  if (categoria) params.push('categoria=' + encodeURIComponent(categoria));
  if (aplica) params.push('aplica=' + encodeURIComponent(aplica));
  if (tipo) params.push('tipo_reclamo=' + encodeURIComponent(tipo));
  if (detectado) params.push('detectado_por=' + encodeURIComponent(detectado));
  if (proyecto) params.push('id_proyecto=' + encodeURIComponent(proyecto));
  if (responsable) params.push('responsable=' + encodeURIComponent(responsable));
  if (busqueda) params.push('busqueda=' + encodeURIComponent(busqueda));
  // USC/cubicador/externo: default to own reclamos; toggle allows usc/cubicador to see all
  if (['usc','cubicador'].includes(currentRole) && !_recScopeAll) {
    params.push('solo_mios=true');
  } else if (currentRole === 'externo') {
    params.push('solo_mios=true');
  }
  if (params.length > 0) url += '?' + params.join('&');

  var data = await apiGet(url);
  if (!data) {
    container.innerHTML = '<div class="muted">No fue posible cargar reclamos en este momento</div>';
    return;
  }
  var reclamos = (data.data || data.reclamos || []).map(_normalizeReclamoListItem);
  _reclamosListaIds = reclamos.map(function(r) { return r.id; });
  
  // Load USC users for assignment dropdowns
  await loadUsuariosUsc();

  if (reclamos.length === 0) {
    container.innerHTML = '<div class="muted">No hay reclamos con los filtros seleccionados</div>';
    return;
  }

  container.innerHTML = '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
    '<tr style="background:#f5f5f5; text-align:left;">' +
    '<th style="padding:5px 6px;">Año</th>' +
    '<th style="padding:5px 6px;">N°</th>' +
    '<th style="padding:5px 6px;">Título</th>' +
    '<th style="padding:5px 6px;">Tipo</th>' +
    '<th style="padding:5px 6px;">Proyecto</th>' +
    '<th style="padding:5px 6px;">Detectado</th>' +
    '<th style="padding:5px 6px;">Cub. Resp.</th>' +
    '<th style="padding:5px 6px;">USC Resp.</th>' +
    '<th style="padding:5px 6px;">Estado</th>' +
    '<th style="padding:5px 6px;">Aplica</th>' +
    '<th style="padding:5px 6px;">Causa</th>' +
    '<th style="padding:5px 6px;">Fecha</th>' +
    '<th style="padding:5px 4px; text-align:center;">Días</th>' +
    '<th style="padding:5px 4px;"></th>' +
    '</tr>' +
    reclamos.map(function(r) {
      var eColor = _recEstadoColors[r.estado] || '#666';
      var eLabel = _recEstadoLabels[r.estado] || r.estado;
      var aplLabel = _recAplicaLabels[r.aplica] || 'Pendiente';
      var aplColor = _recAplicaColors[r.aplica] || '#ff9800';
      var tipoLabel = r.tipo_reclamo === 'faltante' ? 'Faltante' : 'Error';
      var tipoColor = r.tipo_reclamo === 'faltante' ? '#ff9800' : '#e53935';
      var causaText = r.cod_causa ? '[' + r.cod_causa + ']' : (r.categoria_ishikawa ? _recIshikawaLabels[r.categoria_ishikawa] : '-');
      var fecha = r.fecha_deteccion || (r.fecha_creacion ? r.fecha_creacion.substring(0, 10) : '');
      var idLabel = _formatCorrelativoCalidad(r) || (r.correlativo || '#' + r.id);
      var anioCol = r.anio_calidad || '';
      var numCol = r.numero_calidad ? String(r.numero_calidad).padStart(3, '0') : '';
      return '<tr style="border-bottom:1px solid #eee; cursor:pointer;" onclick="verReclamo(' + r.id + ')">' +
        '<td style="padding:4px 6px; font-size:11px;">' + anioCol + '</td>' +
        '<td style="padding:4px 6px; font-size:11px; font-weight:600;">' + numCol + '</td>' +
        '<td style="padding:4px 6px; font-weight:500;">' + r.titulo + '</td>' +
        '<td style="padding:4px 6px;"><span style="color:' + tipoColor + '; font-weight:600; font-size:10px;">' + tipoLabel + '</span></td>' +
        '<td style="padding:4px 6px; font-size:11px;">' + (r.nombre_proyecto || '-') + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;">' + (r.detectado_por || '-') + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;">' + (r.responsable || '-') + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;">' + (r.asignado_a ? r.asignado_a.split('@')[0] : '-') + '</td>' +
        '<td style="padding:4px 6px;"><span style="background:' + eColor + '; color:#fff; padding:1px 6px; border-radius:3px; font-size:10px;">' + eLabel + '</span></td>' +
        '<td style="padding:4px 6px;"><span style="color:' + aplColor + '; font-weight:600; font-size:10px;">' + aplLabel + '</span></td>' +
        '<td style="padding:4px 6px; font-size:11px;" title="' + (r.sub_causa || '') + '">' + causaText + '</td>' +
        '<td style="padding:4px 6px; font-size:11px;" class="muted">' + fecha + '</td>' +
        '<td style="padding:4px 4px; text-align:center;">' + _diasBadgeHtml(r) + '</td>' +
        '<td style="padding:4px 4px;"><button class="secondary" style="font-size:10px; padding:2px 6px;" onclick="event.stopPropagation(); verReclamo(' + r.id + ')">Ver</button></td>' +
        '</tr>';
    }).join('') +
    '</table>' +
    '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + reclamos.length + ' reclamo(s)</div>';
}

function limpiarFiltrosReclamos() {
  ['recFiltroBusqueda','recFiltroTipo','recFiltroEstado','recFiltroCategoria','recFiltroAplica','recFiltroDetectado','recFiltroProyecto','recFiltroResponsable'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  loadReclamos();
}
