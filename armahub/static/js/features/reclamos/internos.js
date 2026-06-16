// ArmaHub Reclamos — Reclamos Internos (área → área)
// Recicla el diseño y mecánica de Reclamos Clientes: la card de creación se ELEVA
// a modal con openReclamoModal (igual que externos), mismo form/colores/botones.
// Diferencias funcionales: se elige ÁREA DESTINO (no usuario, responsable = Jefe
// de Servicio de esa área); cliente/proyecto opcional; listado filtrado a internos.

var _intAbiertoFilter = '';
var _intAplicaFilter = '';
var _intScopeAll = false;
var _intFormInit = false;

var _INT_APLICA_CYCLE = ['', 'pendiente', 'si', 'no'];
var _INT_APLICA_LABELS = { '': 'Aplica: Todos', 'pendiente': 'Pendiente', 'si': 'Sí Aplica', 'no': 'No Aplica' };
var _INT_APLICA_COLORS = { '': '#7b1fa2', 'pendiente': '#f57c00', 'si': '#388e3c', 'no': '#e53935' };
var _intCreateStagedFiles = [];

// Inicializa el form: visibilidad por config + poblar dropdowns de área y cliente.
async function initInternosForm() {
  var card = document.getElementById('crearReclamoInternoCard');
  if (card) {
    try {
      var perm = await Promise.resolve(apiGet('/reclamos/puedo-crear?tipo=interno'));
      card.style.display = (perm && perm.puede) ? '' : 'none';
    } catch (e) { /* si falla, dejar visible y que el backend valide */ }
  }
  // Áreas destino (siempre refresca, baratas)
  var areas = await apiGet('/admin/areas');
  var selArea = document.getElementById('recIntAreaDestino');
  if (selArea && Array.isArray(areas)) {
    var prev = selArea.value;
    selArea.innerHTML = '<option value="">— Seleccionar —</option>' +
      areas.filter(function(a) { return a.activo; })
        .map(function(a) { return '<option value="' + a.id + '">' + a.nombre + '</option>'; })
        .join('');
    selArea.value = prev;
  }
  // Poblar datalist del combobox de área
  window._intAreaMap = {};
  var dlArea = document.getElementById('recIntAreaList');
  if (dlArea && Array.isArray(areas)) {
    dlArea.innerHTML = '';
    areas.filter(function(a) { return a.activo; }).forEach(function(a) {
      window._intAreaMap[a.nombre] = a.id;
      var o = document.createElement('option');
      o.value = a.nombre;
      dlArea.appendChild(o);
    });
  }
  // Cliente/proyecto: pobla el datalist del combobox con los proyectos del form externo.
  var dl = document.getElementById('recIntProyectoList');
  var srcProy = document.getElementById('recProyecto');
  if (dl && srcProy) {
    dl.innerHTML = '';
    Array.from(srcProy.options).forEach(function(opt) {
      if (opt.value) {
        var o = document.createElement('option');
        o.value = opt.textContent.trim();
        o.dataset.id = opt.value;
        dl.appendChild(o);
      }
    });
  }
  // Guardar mapa nombre→id para resolver la selección del combobox
  window._intProyectoMap = {};
  if (srcProy) {
    Array.from(srcProy.options).forEach(function(opt) {
      if (opt.value) window._intProyectoMap[opt.textContent.trim()] = opt.value;
    });
  }
  if (!_intFormInit) {
    _intFormInit = true;
    _initInternoDropZone();
  }
}

// Abre la card de creación como modal (mismo mecanismo que toggleNuevoReclamo).
async function toggleNuevoInterno() {
  var card = document.getElementById('crearReclamoInternoCard');
  var form = document.getElementById('nuevoReclamoInternoForm');
  if (typeof _recModalTarget !== 'undefined' && _recModalTarget === card) {
    closeReclamoModal();
    return;
  }
  // Garantizar que los dropdowns estén poblados antes de abrir el modal.
  await initInternosForm();
  form.style.display = '';
  openReclamoModal(card);
  // Auto-sugerir año y número de calidad, igual que externos.
  var anioField = document.getElementById('recIntAnioCalidad');
  if (anioField && !anioField.value) {
    var yr = new Date().getFullYear();
    anioField.value = yr;
    anioField.disabled = !(currentRole === 'admin' || currentRole === 'admin_calidad');
    if (typeof _sugerirNumeroCalidad === 'function') _sugerirNumeroCalidad(yr, 'recIntNumeroCalidad', 'interno');
  }
  // Prellenar fecha de detección con hoy si está vacía
  var fechaField = document.getElementById('recIntFechaDeteccion');
  if (fechaField && !fechaField.value) {
    fechaField.value = new Date().toISOString().substring(0, 10);
  }
}

// Drop zone de imágenes (reusa el inicializador genérico si existe).
function _initInternoDropZone() {
  if (typeof _initDropZone === 'function') {
    _initDropZone('recIntCreateDropZone', 'recIntCreateFileInput', function(files) {
      _intCreateStagedFiles = _intCreateStagedFiles.concat(Array.prototype.slice.call(files));
      if (typeof _addInternoPreview === 'function') _addInternoPreview(files);
    });
  }
}

function _addInternoPreview(files) {
  var prev = document.getElementById('recIntCreatePreview');
  var msg = document.getElementById('recIntCreateDropMsg');
  if (msg) msg.style.display = 'none';
  Array.prototype.slice.call(files).forEach(function(f) {
    var img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    img.style.cssText = 'width:60px; height:60px; object-fit:cover; border-radius:4px; border:1px solid #ccc;';
    if (prev) prev.appendChild(img);
  });
}

async function crearReclamoInterno() {
  var titulo = document.getElementById('recIntTitulo').value.trim();
  var msg = document.getElementById('crearReclamoInternoMsg');
  var areaId = document.getElementById('recIntAreaDestino').value;
  if (!titulo) { msg.textContent = 'El título es requerido'; msg.style.color = '#b42318'; return; }
  if (!areaId) { msg.textContent = 'Selecciona el área responsable'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Registrando...'; msg.style.color = '#666';

  var body = { titulo: titulo, tipo_origen: 'interno', area_id: parseInt(areaId) };
  var respEmail = document.getElementById('recIntResponsable') ? document.getElementById('recIntResponsable').value : '';
  if (respEmail) body.cubicador_asignado = respEmail;
  // Cliente/Obra: si no se elige obra específica, queda sin id_proyecto (se muestra "Armacero" en listado)
  var proy = document.getElementById('recIntProyecto').value;
  if (proy) body.id_proyecto = proy;
  var tipo = document.getElementById('recIntTipoReclamo').value;
  if (tipo) body.tipo_reclamo = tipo;
  var fecha = document.getElementById('recIntFechaDeteccion').value;
  if (fecha) body.fecha_deteccion = fecha;
  // detectado_por se infiere del creado_por en backend
  var desc = document.getElementById('recIntDescripcion').value.trim();
  if (desc) body.descripcion = desc;
  var anio = parseInt(document.getElementById('recIntAnioCalidad').value);
  if (anio) body.anio_calidad = anio;
  var num = parseInt(document.getElementById('recIntNumeroCalidad').value);
  if (num) body.numero_calidad = num;

  var res = await fetch(apiUrl('/reclamos'), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    var label = data.correlativo || ('#' + data.id);
    // Subir imágenes staged (igual que externos)
    var files = _intCreateStagedFiles.filter(function(f) { return f !== null; });
    if (files.length > 0) {
      msg.textContent = label + ' creado. Subiendo ' + files.length + ' imagen(es)...';
      for (var i = 0; i < files.length; i++) {
        var fd = new FormData();
        fd.append('file', files[i]); fd.append('tipo', 'antecedente');
        await fetch(apiUrl('/reclamos/' + data.id + '/imagenes'), { method: 'POST', headers: authHeaders(), body: fd });
      }
    }
    _intCreateStagedFiles = [];
    msg.textContent = label + ' registrado correctamente'; msg.style.color = '#558B2F';
    ['recIntTitulo','recIntDescripcion','recIntAreaDestino','recIntFechaDeteccion','recIntAnioCalidad','recIntNumeroCalidad'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    // Reset comboboxes
    var ps = document.getElementById('recIntProyectoSearch'); if (ps) ps.value = '';
    var ph = document.getElementById('recIntProyecto'); if (ph) ph.value = '';
    var as = document.getElementById('recIntAreaSearch'); if (as) as.value = '';
    var rh = document.getElementById('recIntResponsable'); if (rh) rh.value = '';
    var prev = document.getElementById('recIntCreatePreview'); if (prev) prev.innerHTML = '';
    var dmsg = document.getElementById('recIntCreateDropMsg'); if (dmsg) dmsg.style.display = '';
    closeReclamoModal();
    await loadReclamosInternos();
    if (typeof loadRecLanding === 'function') await loadRecLanding();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

// Toggle Mis Reclamos / Todos
function toggleIntScope() {
  _intScopeAll = !_intScopeAll;
  var btn = document.getElementById('recIntFiltroScope');
  if (btn) {
    if (_intScopeAll) {
      btn.textContent = 'Mis Reclamos';
      btn.style.borderColor = '#7b1fa2'; btn.style.color = '#7b1fa2'; btn.style.background = '#fff';
    } else {
      btn.textContent = 'Todos';
      btn.style.borderColor = '#7b1fa2'; btn.style.color = '#fff'; btn.style.background = '#7b1fa2';
    }
  }
  loadReclamosInternos();
}

// Toggle Aplica
function toggleIntAplica() {
  var idx = _INT_APLICA_CYCLE.indexOf(_intAplicaFilter);
  _intAplicaFilter = _INT_APLICA_CYCLE[(idx + 1) % _INT_APLICA_CYCLE.length];
  var btn = document.getElementById('recIntFiltroAplicaBtn');
  if (btn) {
    btn.textContent = _INT_APLICA_LABELS[_intAplicaFilter];
    btn.style.borderColor = _INT_APLICA_COLORS[_intAplicaFilter];
    btn.style.color = _INT_APLICA_COLORS[_intAplicaFilter];
    btn.style.background = _intAplicaFilter ? _INT_APLICA_COLORS[_intAplicaFilter] + '15' : '#fff';
  }
  loadReclamosInternos();
}

// Toggle Abiertos/Cerrados
function toggleIntAbierto() {
  var cycle = ['', 'abiertos', 'cerrados'];
  var labels = { '': 'Abiertos/Cerrados', 'abiertos': 'Solo Abiertos', 'cerrados': 'Solo Cerrados' };
  var colors = { '': '#1976d2', 'abiertos': '#e65100', 'cerrados': '#388e3c' };
  var idx = cycle.indexOf(_intAbiertoFilter);
  _intAbiertoFilter = cycle[(idx + 1) % cycle.length];
  var btn = document.getElementById('recIntFiltroAbiertoBtn');
  if (btn) {
    btn.textContent = labels[_intAbiertoFilter];
    btn.style.borderColor = colors[_intAbiertoFilter];
    btn.style.color = colors[_intAbiertoFilter];
    btn.style.background = _intAbiertoFilter ? colors[_intAbiertoFilter] + '15' : '#fff';
  }
  loadReclamosInternos();
}

function limpiarFiltrosInternos() {
  var b = document.getElementById('recIntFiltroBusqueda');
  if (b) b.value = '';
  _intAbiertoFilter = ''; _intAplicaFilter = ''; _intScopeAll = false;
  var btnA = document.getElementById('recIntFiltroAbiertoBtn');
  if (btnA) { btnA.textContent = 'Abiertos/Cerrados'; btnA.style.borderColor = '#7b1fa2'; btnA.style.color = '#7b1fa2'; btnA.style.background = '#fff'; }
  var btnAp = document.getElementById('recIntFiltroAplicaBtn');
  if (btnAp) { btnAp.textContent = 'Aplica: Todos'; btnAp.style.borderColor = '#7b1fa2'; btnAp.style.color = '#7b1fa2'; btnAp.style.background = '#fff'; }
  var btnSc = document.getElementById('recIntFiltroScope');
  if (btnSc) { btnSc.textContent = 'Mis Reclamos'; btnSc.style.borderColor = '#7b1fa2'; btnSc.style.color = '#7b1fa2'; btnSc.style.background = '#fff'; }
  loadReclamosInternos();
}

async function loadReclamosInternos() {
  var cont = document.getElementById('reclamosInternosList');
  if (!cont) return;
  cont.innerHTML = '<div class="muted">Cargando reclamos internos...</div>';
  var busqueda = document.getElementById('recIntFiltroBusqueda');
  var params = ['tipo_origen=interno'];
  if (busqueda && busqueda.value.trim()) params.push('busqueda=' + encodeURIComponent(busqueda.value.trim()));
  if (_intAbiertoFilter) params.push('abierto_cerrado=' + encodeURIComponent(_intAbiertoFilter));
  if (_intAplicaFilter) params.push('aplica=' + encodeURIComponent(_intAplicaFilter));
  if (!_intScopeAll && !['admin','admin_calidad'].includes(currentRole)) params.push('scope=mine');

  var data = await apiGet('/reclamos?' + params.join('&'));
  if (!data) { cont.innerHTML = '<div class="muted">No fue posible cargar.</div>'; return; }
  var items = (data.data || []).map(_normalizeReclamoListItem);
  _reclamosListaIds = items.map(function(r) { return r.id; });

  if (items.length === 0) {
    cont.innerHTML = '<div class="muted">No hay reclamos internos con los filtros seleccionados.</div>';
    return;
  }
  cont.innerHTML =
    '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
    '<tr style="background:#f5f5f5; text-align:left;">' +
      '<th style="padding:5px 6px;">Año</th><th style="padding:5px 6px;">N°</th>' +
      '<th style="padding:5px 6px;">Título</th><th style="padding:5px 6px;">Área responsable</th>' +
      '<th style="padding:5px 6px;">Cliente</th><th style="padding:5px 6px;">Estado</th>' +
      '<th style="padding:5px 6px;">Aplica</th><th style="padding:5px 6px;">Fecha</th>' +
      '<th style="padding:5px 4px; text-align:center;">Días</th>' +
    '</tr>' +
    items.map(function(r) {
      var eColor = _recEstadoColors[r.estado] || '#666';
      var eLabel = _recEstadoLabels[r.estado] || r.estado;
      var aplLabel = _recAplicaLabels[r.aplica] || 'Pendiente';
      var aplColor = _recAplicaColors[r.aplica] || '#ff9800';
      var anioCol = r.anio_calidad || '';
      var numCol = r.numero_calidad ? String(r.numero_calidad).padStart(3, '0') : '';
      var fecha = r.fecha_deteccion || (r.fecha_creacion ? r.fecha_creacion.substring(0, 10) : '');
      var cliente = (r.nombre_proyecto && r.nombre_proyecto !== 'Obra eliminada') ? r.nombre_proyecto : 'Armacero';
      return '<tr style="border-bottom:1px solid #eee; cursor:pointer;" onclick="verReclamo(' + r.id + ', {origen:\'internos\'})">' +
        '<td style="padding:4px 6px; font-size:11px;">' + anioCol + '</td>' +
        '<td style="padding:4px 6px; font-size:11px; font-weight:600;">' + numCol + '</td>' +
        '<td style="padding:4px 6px; font-weight:500;">' + (r.titulo || '') + '</td>' +
        '<td style="padding:4px 6px;">' + (r.area_nombre || '—') + '</td>' +
        '<td style="padding:4px 6px; color:#666;">' + cliente + '</td>' +
        '<td style="padding:4px 6px;"><span style="background:' + eColor + '; color:#fff; padding:1px 6px; border-radius:3px; font-size:10px;">' + eLabel + '</span></td>' +
        '<td style="padding:4px 6px;"><span style="color:' + aplColor + '; font-weight:600; font-size:10px;">' + aplLabel + '</span></td>' +
        '<td style="padding:4px 6px; font-size:11px;" class="muted">' + fecha + '</td>' +
        '<td style="padding:4px 4px; text-align:center;">' + (typeof _diasBadgeHtml === 'function' ? _diasBadgeHtml(r) : '') + '</td>' +
        '</tr>';
    }).join('') +
    '</table>' +
    '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + items.length + ' reclamo(s) interno(s)</div>';
}

// Resuelve el id del proyecto cuando el usuario escribe o selecciona en el combobox.
function _onIntProyectoInput(texto) {
  var mapa = window._intProyectoMap || {};
  var hidden = document.getElementById('recIntProyecto');
  if (!hidden) return;
  hidden.value = mapa[texto.trim()] || '';
}

// Resuelve el id del área cuando el usuario escribe o selecciona en el combobox.
function _onIntAreaInput(texto) {
  var id = (window._intAreaMap || {})[texto.trim()] || '';
  var selArea = document.getElementById('recIntAreaDestino');
  if (selArea) selArea.value = id;
}
