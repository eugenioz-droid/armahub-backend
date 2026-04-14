// ========================= CUBICACIÓN — Bar Manager (E.4) =========================
let currentOffset = 0;
const pageLimit = 100;
let lastTotal = 0;
let selectedBarras = new Set();

// Columnas compactas para la tabla
const DISPLAY_COLS = [
  { key: 'id_unico', label: 'ID', short: true },
  { key: 'sector',   label: 'Sector' },
  { key: 'piso',     label: 'Piso' },
  { key: 'ciclo',    label: 'Ciclo' },
  { key: 'eje',      label: 'Eje' },
  { key: 'diam',     label: 'φ', fmt: v => v != null ? Math.round(v) : '' },
  { key: 'cant_total', label: 'Cant', fmt: v => v != null ? Math.round(v) : '' },
  { key: 'largo_total', label: 'Largo', fmt: v => v != null ? Math.round(v) : '' },
  { key: 'peso_unitario', label: 'Peso U.', fmt: v => v != null ? v.toFixed(2) : '' },
  { key: 'peso_total', label: 'Peso Total', fmt: v => v != null ? v.toFixed(1) : '' },
  { key: 'origen', label: 'Origen', fmt: v => {
    if (v === 'manual') return '<span style="background:#1565C0;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">manual</span>';
    if (v === 'pedido') return '<span style="background:#FF9800;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">pedido</span>';
    return '<span style="background:#9E9E9E;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">csv</span>';
  }},
];

function shortId(id) {
  if (!id) return '';
  const parts = id.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : id;
}

function updateToolbar() {
  const tb = document.getElementById('barrasToolbar');
  const cnt = document.getElementById('selectedCount');
  if (selectedBarras.size > 0) {
    tb.style.display = '';
    cnt.textContent = selectedBarras.size + ' seleccionada' + (selectedBarras.size > 1 ? 's' : '');
  } else {
    tb.style.display = 'none';
  }
}

function toggleBarra(id) {
  if (selectedBarras.has(id)) selectedBarras.delete(id);
  else selectedBarras.add(id);
  const cb = document.getElementById('cb_' + CSS.escape(id));
  if (cb) cb.checked = selectedBarras.has(id);
  const row = document.getElementById('row_' + CSS.escape(id));
  if (row) row.style.background = selectedBarras.has(id) ? '#f0f9e8' : '';
  updateToolbar();
}

function toggleAllBarras(checked) {
  document.querySelectorAll('.barra-cb').forEach(cb => {
    const id = cb.dataset.id;
    if (checked) selectedBarras.add(id); else selectedBarras.delete(id);
    cb.checked = checked;
    const row = document.getElementById('row_' + CSS.escape(id));
    if (row) row.style.background = checked ? '#f0f9e8' : '';
  });
  updateToolbar();
}

function clearSeleccion() {
  selectedBarras.clear();
  document.querySelectorAll('.barra-cb').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('tbody tr').forEach(tr => { tr.style.background = ''; });
  const sa = document.getElementById('selectAll');
  if (sa) sa.checked = false;
  updateToolbar();
}

async function accionMoverProyecto() {
  alert('Mover barras entre proyectos ya no está disponible. Usa "Duplicar" para crear una copia en otro proyecto.');
}

async function accionCambiarSector() {
  if (selectedBarras.size === 0) return alert('Selecciona al menos una barra');
  const sec = document.getElementById('accionSector').value;
  if (!sec) return alert('Selecciona sector destino');
  if (!confirm('Cambiar sector de ' + selectedBarras.size + ' barra(s) a ' + sec + '?')) return;
  const res = await apiPostJson('/barras/cambiar-sector', { id_unicos: Array.from(selectedBarras), nuevo_sector: sec });
  if (res && res.ok) {
    alert('Actualizadas: ' + res.modificadas + ' barras');
    clearSeleccion();
    buscar(true);
  } else {
    alert('Error: ' + (res?.detail || 'desconocido'));
  }
}

function toggleCrearBarraForm() {
  var card = document.getElementById('crearBarraCard');
  if (card.style.display === 'none') {
    card.style.display = '';
    // Populate project selector from the main project dropdown options
    var src = document.getElementById('proyecto');
    var dst = document.getElementById('crearBarraProy');
    if (src && dst) {
      dst.innerHTML = src.innerHTML;
      if (src.value) dst.value = src.value;
    }
  } else {
    card.style.display = 'none';
  }
}

async function crearBarraManual() {
  var msg = document.getElementById('crearBarraMsg');
  var proy = document.getElementById('crearBarraProy').value;
  var sector = document.getElementById('crearBarraSector').value;
  var piso = (document.getElementById('crearBarraPiso').value || '').trim().toUpperCase();
  var ciclo = (document.getElementById('crearBarraCiclo').value || '').trim().toUpperCase();
  var eje = (document.getElementById('crearBarraEje').value || '').trim();
  var diam = parseFloat(document.getElementById('crearBarraDiam').value);
  var largo = parseFloat(document.getElementById('crearBarraLargo').value);
  var cant = parseInt(document.getElementById('crearBarraCant').value) || 1;
  var figura = (document.getElementById('crearBarraFigura').value || '').trim() || null;
  var marca = (document.getElementById('crearBarraMarca').value || '').trim() || null;

  if (!proy || !sector || !piso || !ciclo || !eje || isNaN(diam) || isNaN(largo)) {
    msg.textContent = 'Completa los campos obligatorios (*)';
    msg.style.color = '#e53935';
    return;
  }
  msg.textContent = 'Creando...'; msg.style.color = '#666';

  var body = { id_proyecto: proy, sector: sector, piso: piso, ciclo: ciclo, eje: eje, diam: diam, largo_total: largo, cant: cant };
  if (figura) body.figura = figura;
  if (marca) body.marca = marca;

  var res = await apiPostJson('/barras/crear', body);
  if (res && res.ok) {
    msg.textContent = 'Barra creada: ' + res.id_unico + (res.peso_total ? ' (' + res.peso_total.toFixed(2) + ' kg)' : '');
    msg.style.color = '#4CAF50';
    ['crearBarraPiso','crearBarraCiclo','crearBarraEje','crearBarraDiam','crearBarraLargo','crearBarraFigura','crearBarraMarca'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('crearBarraCant').value = '1';
    buscar(true);
  } else {
    msg.textContent = 'Error: ' + (res?.detail || 'desconocido');
    msg.style.color = '#e53935';
  }
}

async function duplicarBarra(idUnico) {
  if (!confirm('¿Duplicar barra ' + idUnico + '?')) return;
  var res = await fetch(apiUrl('/barras/' + encodeURIComponent(idUnico) + '/duplicar'), {
    method: 'POST', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    alert('Barra duplicada: ' + data.id_unico);
    buscar(false);
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}

async function eliminarBarra(idUnico) {
  if (!confirm('¿Eliminar barra ' + idUnico + '? Esta acción no se puede deshacer.')) return;
  var res = await fetch(apiUrl('/barras/' + encodeURIComponent(idUnico)), {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.status === 401) { logout(); return; }
  var data = await res.json();
  if (data.ok) {
    selectedBarras.delete(idUnico);
    updateToolbar();
    buscar(false);
  } else {
    alert('Error: ' + (data.detail || 'desconocido'));
  }
}

async function eliminarBarrasSeleccionadas() {
  if (selectedBarras.size === 0) return alert('Selecciona al menos una barra');
  var msg = (currentRole === 'admin' || currentRole === 'cubicador')
    ? '¿Eliminar ' + selectedBarras.size + ' barra(s)? Esta acción no se puede deshacer.'
    : '¿Eliminar ' + selectedBarras.size + ' barra(s)? Solo se eliminarán las manuales/pedido. Las CSV serán omitidas.';
  if (!confirm(msg)) return;
  var ids = Array.from(selectedBarras);
  var ok = 0, skip = 0, errors = [];
  for (var i = 0; i < ids.length; i++) {
    var res = await fetch(apiUrl('/barras/' + encodeURIComponent(ids[i])), {
      method: 'DELETE', headers: authHeaders()
    });
    if (res.status === 401) { logout(); return; }
    var data = await res.json();
    if (data.ok) { ok++; selectedBarras.delete(ids[i]); } else { skip++; if (data.detail) errors.push(data.detail); }
  }
  var resultMsg = 'Eliminadas: ' + ok;
  if (skip > 0) resultMsg += ' | No eliminadas: ' + skip;
  alert(resultMsg);
  updateToolbar();
  buscar(true);
}

async function buscar(reset = false) {
  if (reset) { currentOffset = 0; selectedBarras.clear(); updateToolbar(); }

  const proy = document.getElementById('proyecto').value;
  if (!proy) {
    document.getElementById('count').textContent = 'Selecciona un proyecto para ver sus barras.';
    document.getElementById('tabla').innerHTML = '';
    return;
  }

  const params = new URLSearchParams();
  params.set('proyecto', proy);
  ['plano', 'sector', 'piso', 'ciclo'].forEach(f => {
    const v = document.getElementById(f).value;
    if (v) params.set(f === 'plano' ? 'plano_code' : f, v);
  });

  const q = document.getElementById('q').value.trim();
  if (q) params.set('q', q);

  const origenFilter = document.getElementById('filtroOrigen');
  if (origenFilter && origenFilter.value) params.set('origen', origenFilter.value);

  const cargaFilter = document.getElementById('filtroCarga');
  if (cargaFilter && cargaFilter.value) params.set('import_id', cargaFilter.value);

  params.set('limit', pageLimit);
  params.set('offset', currentOffset);
  const orderBy = document.getElementById('order_by').value || 'sector';
  const orderDir = document.getElementById('order_dir').value || 'asc';
  params.set('order_by', orderBy);
  params.set('order_dir', orderDir);

  saveFiltersToStorage();
  const data = await apiGet('/barras?' + params.toString());
  if (!data) return;

  lastTotal = data.total || 0;
  const page = Math.floor(currentOffset / pageLimit) + 1;
  const totalPages = Math.max(1, Math.ceil(lastTotal / pageLimit));

  var cargaActive = document.getElementById('filtroCarga') && document.getElementById('filtroCarga').value;
  document.getElementById('count').textContent = lastTotal.toLocaleString() + ' barras' + (cargaActive ? ' en esta carga' : ' en proyecto');
  document.getElementById('pageInfo').textContent = 'Pág ' + page + '/' + totalPages;

  const table = document.getElementById('tabla');
  table.innerHTML = '';

  if (!data.data || !data.data.length) {
    table.innerHTML = '<tr><td colspan="12" class="muted" style="padding:20px; text-align:center;">Sin resultados</td></tr>';
    return;
  }

  // Header
  let hdr = '<thead><tr style="font-size:11px;"><th style="width:28px;"><input type="checkbox" id="selectAll" onchange="toggleAllBarras(this.checked)" /></th>';
  DISPLAY_COLS.forEach(c => {
    const ord = document.getElementById('order_by').value;
    const dir = document.getElementById('order_dir').value;
    const arrow = c.key === ord ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
    hdr += '<th style="cursor:pointer; padding:4px 6px;" onclick="document.getElementById(\'order_by\').value=\'' + c.key + '\'; buscar(true);">' + c.label + arrow + '</th>';
  });
  hdr += '<th style="padding:4px 6px;">Acciones</th>';
  hdr += '</tr></thead>';

  // Body
  let body = '<tbody>';
  data.data.forEach(row => {
    const id = row.id_unico;
    const sel = selectedBarras.has(id);
    const safeId = id.replace(/"/g, '&quot;').replace(/'/g, "\\'");
    body += '<tr id="row_' + id.replace(/"/g, '') + '" style="' + (sel ? 'background:#f0f9e8;' : '') + '">';
    body += '<td style="width:28px;"><input type="checkbox" class="barra-cb" data-id="' + id + '" id="cb_' + id.replace(/"/g, '') + '" ' + (sel ? 'checked' : '') + ' onchange="toggleBarra(\'' + id.replace(/'/g, "\\'") + '\')" /></td>';
    DISPLAY_COLS.forEach(c => {
      let val = row[c.key];
      if (c.short) val = shortId(val);
      if (c.fmt) val = c.fmt(row[c.key]);
      body += '<td style="padding:3px 6px;">' + (val != null && val !== '' ? val : '') + '</td>';
    });
    var canDelete = (currentRole === 'admin' || currentRole === 'cubicador') || (row.origen === 'manual' || row.origen === 'pedido' || !row.origen);
    body += '<td style="padding:3px 4px; white-space:nowrap;">';
    body += '<button class="secondary" style="font-size:10px; padding:1px 6px; margin-right:3px;" onclick="duplicarBarra(\'' + safeId + '\')">Duplicar</button>';
    if (canDelete) body += '<button class="secondary" style="font-size:10px; padding:1px 6px; color:#b42318;" onclick="eliminarBarra(\'' + safeId + '\')">✕</button>';
    body += '</td>';
    body += '</tr>';
  });
  body += '</tbody>';

  table.innerHTML = hdr + body;
}

function resetFiltros() {
  ['proyecto', 'plano', 'sector', 'piso', 'ciclo'].forEach(f => {
    document.getElementById(f).value = '';
  });
  document.getElementById('q').value = '';
  var fo = document.getElementById('filtroOrigen');
  if (fo) fo.value = '';
  clearCargaFilter(true);
  loadCargasDropdown('');
  const si = document.getElementById('proyectoSearchInput');
  if (si) si.value = '';
  try { localStorage.removeItem(FILTER_STORAGE_KEY); } catch(e) {}
  selectedBarras.clear();
  updateToolbar();
  loadFilters();
  buscar(true);
}

async function verBarrasCarga(importId, idProyecto, archivo) {
  // Switch to Bar Manager tab
  switchTab('buscar');

  // Set project filter
  var proySel = document.getElementById('proyecto');
  if (proySel) proySel.value = idProyecto;

  // Load cargas dropdown so the option exists, then select it
  await loadCargasDropdown(idProyecto);
  var fc = document.getElementById('filtroCarga');
  if (fc) fc.value = importId;
  document.getElementById('cargaFilterBadge').style.display = '';
  document.getElementById('cargaFilterLabel').textContent = archivo || ('Carga #' + importId);

  buscar(true);
}

function clearCargaFilter(skipSearch) {
  var fc = document.getElementById('filtroCarga');
  if (fc) fc.value = '';
  var badge = document.getElementById('cargaFilterBadge');
  if (badge) badge.style.display = 'none';
  if (!skipSearch) buscar(true);
}

function prevPage() {
  currentOffset = Math.max(0, currentOffset - pageLimit);
  buscar(false);
}

function nextPage() {
  if (currentOffset + pageLimit >= lastTotal) return;
  currentOffset += pageLimit;
  buscar(false);
}
