// ArmaHub Reclamos — Reclamos Internos (área → área)
// Reusa el modal de detalle, los helpers y el flujo de los reclamos externos.
// Diferencias: se elige ÁREA DESTINO (no usuario); el responsable es el Jefe de
// Servicio de esa área; el cliente/proyecto es opcional (Armacero interno);
// listado filtrado por tipo_origen='interno'.

var _intAbiertoFilter = '';
var _intFormInit = false;

// Prepara el formulario de creación: dropdown de áreas y de proyectos. Una vez.
async function initInternosForm() {
  // ¿Puede el usuario actual levantar reclamos internos? (config configurable)
  var card = document.getElementById('crearReclamoInternoCard');
  if (card) {
    try {
      var perm = await Promise.resolve(apiGet('/reclamos/puedo-crear?tipo=interno'));
      card.style.display = (perm && perm.puede) ? '' : 'none';
    } catch (e) { card.style.display = 'none'; }
  }
  if (_intFormInit) return;
  _intFormInit = true;

  // Áreas destino (activas)
  var areas = await apiGet('/admin/areas');
  var selArea = document.getElementById('recIntAreaDestino');
  if (selArea && Array.isArray(areas)) {
    selArea.innerHTML = '<option value="">— Seleccionar —</option>' +
      areas.filter(function(a) { return a.activo; })
        .map(function(a) { return '<option value="' + a.id + '">' + a.nombre + '</option>'; })
        .join('');
  }
  // Proyectos/clientes (reusa el dropdown ya poblado en el form de externos)
  var selProy = document.getElementById('recIntProyecto');
  var srcProy = document.getElementById('recProyecto');
  if (selProy && srcProy) {
    selProy.innerHTML = '<option value="">Armacero (Interno)</option>';
    Array.from(srcProy.options).forEach(function(opt) {
      if (opt.value) selProy.innerHTML += '<option value="' + opt.value + '">' + opt.textContent + '</option>';
    });
  }
}

function toggleNuevoInterno() {
  var form = document.getElementById('crearInternoForm');
  if (form) form.style.display = (form.style.display === 'none') ? '' : 'none';
}

async function crearReclamoInterno() {
  var titulo = document.getElementById('recIntTitulo').value.trim();
  var msg = document.getElementById('crearInternoMsg');
  var areaId = document.getElementById('recIntAreaDestino').value;
  if (!titulo) { msg.textContent = 'El título es requerido'; msg.style.color = '#b42318'; return; }
  if (!areaId) { msg.textContent = 'Selecciona el área responsable'; msg.style.color = '#b42318'; return; }
  msg.textContent = 'Registrando...'; msg.style.color = '#666';

  var body = {
    titulo: titulo,
    tipo_origen: 'interno',
    area_id: parseInt(areaId)
  };
  var proy = document.getElementById('recIntProyecto').value;
  // Sin proyecto elegido → cliente interno Armacero.
  body.id_proyecto = proy || 'ARMACERO-INT';
  var desc = document.getElementById('recIntDescripcion').value.trim();
  if (desc) body.descripcion = desc;

  var res = await fetch(apiUrl('/reclamos'), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    msg.textContent = (data.correlativo || ('#' + data.id)) + ' registrado'; msg.style.color = '#558B2F';
    document.getElementById('recIntTitulo').value = '';
    document.getElementById('recIntDescripcion').value = '';
    document.getElementById('recIntAreaDestino').value = '';
    document.getElementById('recIntProyecto').value = '';
    document.getElementById('crearInternoForm').style.display = 'none';
    await loadReclamosInternos();
    if (typeof loadRecLanding === 'function') await loadRecLanding();
  } else {
    msg.textContent = 'Error: ' + (data.detail || 'desconocido'); msg.style.color = '#b42318';
  }
}

// Toggle Abiertos/Cerrados (mismo patrón que el listado de clientes)
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
  _intAbiertoFilter = '';
  var btn = document.getElementById('recIntFiltroAbiertoBtn');
  if (btn) { btn.textContent = 'Abiertos/Cerrados'; btn.style.borderColor = '#1976d2'; btn.style.color = '#1976d2'; btn.style.background = '#fff'; }
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

  var data = await apiGet('/reclamos?' + params.join('&'));
  if (!data) { cont.innerHTML = '<div class="muted">No fue posible cargar.</div>'; return; }
  var items = (data.data || []).map(_normalizeReclamoListItem);
  // Guardar ids para navegación del modal (compartido con clientes)
  _reclamosListaIds = items.map(function(r) { return r.id; });

  if (items.length === 0) {
    cont.innerHTML = '<div class="muted">No hay reclamos internos.</div>';
    return;
  }
  cont.innerHTML =
    '<table style="width:100%; font-size:12px; border-collapse:collapse;">' +
    '<tr style="background:#f5f5f5; text-align:left;">' +
      '<th style="padding:5px 6px;">N°</th>' +
      '<th style="padding:5px 6px;">Título</th>' +
      '<th style="padding:5px 6px;">Área responsable</th>' +
      '<th style="padding:5px 6px;">Cliente</th>' +
      '<th style="padding:5px 6px;">Estado</th>' +
      '<th style="padding:5px 6px;">Fecha</th>' +
    '</tr>' +
    items.map(function(r) {
      var eColor = _recEstadoColors[r.estado] || '#666';
      var eLabel = _recEstadoLabels[r.estado] || r.estado;
      var idLabel = _formatCorrelativoCalidad(r) || (r.correlativo || '#' + r.id);
      var fecha = r.fecha_creacion ? r.fecha_creacion.substring(0, 10) : '';
      var cliente = (r.nombre_proyecto && r.nombre_proyecto !== 'Armacero (Interno)') ? r.nombre_proyecto : 'Armacero';
      return '<tr style="border-bottom:1px solid #eee; cursor:pointer;" onclick="verReclamo(' + r.id + ', {origen:\'internos\'})">' +
        '<td style="padding:4px 6px; font-weight:600;">' + idLabel + '</td>' +
        '<td style="padding:4px 6px;">' + (r.titulo || '') + '</td>' +
        '<td style="padding:4px 6px;">' + (r.area_nombre || '—') + '</td>' +
        '<td style="padding:4px 6px; color:#666;">' + cliente + '</td>' +
        '<td style="padding:4px 6px;"><span style="background:' + eColor + '; color:#fff; padding:1px 6px; border-radius:3px; font-size:10px;">' + eLabel + '</span></td>' +
        '<td style="padding:4px 6px; font-size:11px;" class="muted">' + fecha + '</td>' +
        '</tr>';
    }).join('') +
    '</table>' +
    '<div class="muted" style="font-size:11px; margin-top:4px;">Mostrando ' + items.length + ' reclamo(s) interno(s)</div>';
}
