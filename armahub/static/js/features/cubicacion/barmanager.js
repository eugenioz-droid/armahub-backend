// ========================= CUBICACIÓN — Bar Manager (vista por elementos) =========================
// Un "elemento" = barras que comparten (piso, sector, eje).
// Vista jerárquica: Elemento (parent) → Ciclos (sub) → Barras individuales.
// Vista de SOLO LECTURA: la edición/creación/eliminación se gestiona vía CSV o pedidos.

let currentOffset = 0;
const pageLimit = 50;             // 50 elementos por página
let lastTotal = 0;
let lastElementos = [];           // cache de elementos visibles
const expanded = new Set();       // claves "piso||sector||eje"
const detailCache = new Map();    // key -> array de barras

const SECTOR_LABEL = {
  'ELEV': 'Elevación',
  'LCIELO': 'Losas',
  'VCIELO': 'Vigas',
  'FUND': 'Fundación'
};
const SECTOR_COLOR = {
  'ELEV': '#1565C0',
  'LCIELO': '#7B1FA2',
  'VCIELO': '#00897B',
  'FUND': '#6D4C41'
};

function _elemKey(e) {
  return (e.piso || '') + '||' + (e.sector || '') + '||' + (e.eje || '');
}

function _origenBadge(o) {
  if (o === 'manual') return '<span style="background:#1565C0;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">manual</span>';
  if (o === 'pedido') return '<span style="background:#FF9800;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">pedido</span>';
  return '<span style="background:#9E9E9E;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">csv</span>';
}

function _sectorBadge(s) {
  const lbl = SECTOR_LABEL[s] || s || '—';
  const col = SECTOR_COLOR[s] || '#555';
  return '<span style="background:' + col + ';color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;">' + lbl + '</span>';
}

function _phiText(emin, emax) {
  if (emin == null && emax == null) return '—';
  if (emin === emax || emax == null) return 'φ' + emin;
  return 'φ' + emin + '–' + emax;
}

function _fmt(n, d = 0) {
  if (n == null) return '';
  return Number(n).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ========================= FETCH + RENDER =========================

function _buildFilterParams() {
  const params = new URLSearchParams();
  const proy = document.getElementById('proyecto').value;
  if (!proy) return null;
  params.set('proyecto', proy);
  ['plano', 'sector', 'piso', 'ciclo'].forEach(f => {
    const v = document.getElementById(f).value;
    if (v) params.set(f === 'plano' ? 'plano_code' : f, v);
  });
  const q = (document.getElementById('q').value || '').trim();
  if (q) params.set('q', q);
  const fo = document.getElementById('filtroOrigen');
  if (fo && fo.value) params.set('origen', fo.value);
  const fc = document.getElementById('filtroCarga');
  if (fc && fc.value) params.set('import_id', fc.value);
  return params;
}

async function buscar(reset = false) {
  if (reset) {
    currentOffset = 0;
    expanded.clear();
    detailCache.clear();
  }

  const kpisEl = document.getElementById('bmKpis');
  const countEl = document.getElementById('count');
  const tbl = document.getElementById('tabla');
  const pageInfo = document.getElementById('pageInfo');

  const params = _buildFilterParams();
  if (!params) {
    kpisEl.innerHTML = '<span class="muted">Selecciona un proyecto…</span>';
    countEl.textContent = '';
    tbl.innerHTML = '';
    pageInfo.textContent = '';
    return;
  }

  params.set('limit', pageLimit);
  params.set('offset', currentOffset);

  if (typeof saveFiltersToStorage === 'function') saveFiltersToStorage();

  const data = await apiGet('/barras/elementos?' + params.toString());
  if (!data) return;

  lastTotal = data.total || 0;
  lastElementos = data.data || [];
  const summary = data.summary || {};

  // KPIs
  kpisEl.innerHTML =
    '<span><strong>' + _fmt(summary.elementos_total || 0) + '</strong> elementos</span>' +
    '<span class="muted">·</span>' +
    '<span><strong>' + _fmt(summary.barras_total || 0) + '</strong> barras</span>' +
    '<span class="muted">·</span>' +
    '<span><strong>' + _fmt(summary.kg_total || 0, 1) + '</strong> kg</span>' +
    '<span class="muted">·</span>' +
    '<span>' + _fmt(summary.pisos_count || 0) + ' pisos</span>' +
    '<span class="muted">·</span>' +
    '<span>' + _fmt(summary.sectores_count || 0) + ' sectores</span>' +
    '<span class="muted">·</span>' +
    '<span>' + _fmt(summary.ejes_count || 0) + ' ejes</span>';

  const cargaActive = document.getElementById('filtroCarga') && document.getElementById('filtroCarga').value;
  countEl.textContent = (cargaActive ? 'Filtrado por carga · ' : '') +
    _fmt(lastTotal) + ' elemento' + (lastTotal === 1 ? '' : 's');

  const page = Math.floor(currentOffset / pageLimit) + 1;
  const totalPages = Math.max(1, Math.ceil(lastTotal / pageLimit));
  pageInfo.textContent = 'Pág ' + page + '/' + totalPages;

  _renderElementos();
}

function _renderElementos() {
  const tbl = document.getElementById('tabla');
  if (!lastElementos.length) {
    tbl.innerHTML =
      '<tr><td colspan="10" class="muted" style="padding:24px; text-align:center;">' +
      'Sin elementos para los filtros actuales.</td></tr>';
    return;
  }

  let html = '<thead><tr style="font-size:11px; background:#f7f7f7;">' +
    '<th style="width:24px;"></th>' +
    '<th style="padding:6px 8px; text-align:left;">Piso</th>' +
    '<th style="padding:6px 8px; text-align:left;">Sector</th>' +
    '<th style="padding:6px 8px; text-align:left;">Eje</th>' +
    '<th style="padding:6px 8px; text-align:right;">Ciclos</th>' +
    '<th style="padding:6px 8px; text-align:right;">Items</th>' +
    '<th style="padding:6px 8px; text-align:right;">Σ Cant</th>' +
    '<th style="padding:6px 8px; text-align:right;">Σ Largo (cm)</th>' +
    '<th style="padding:6px 8px; text-align:right;">Σ Kg</th>' +
    '<th style="padding:6px 8px; text-align:left;">φ / Origen</th>' +
    '</tr></thead><tbody>';

  lastElementos.forEach((e, idx) => {
    const key = _elemKey(e);
    const isOpen = expanded.has(key);
    const arrow = isOpen ? '▾' : '▸';
    const safeKey = key.replace(/'/g, "\\'");

    const ciclosLabel = (e.ciclos && e.ciclos.length)
      ? (e.ciclos.length <= 4 ? e.ciclos.join(', ') : e.ciclos.length + ' ciclos')
      : '—';
    const origenes = (e.origenes || []).map(_origenBadge).join(' ');

    html += '<tr class="bm-elem-row" style="cursor:pointer; border-top:1px solid #eee;" ' +
      'onclick="toggleElemento(' + idx + ')">' +
      '<td style="padding:6px 4px; text-align:center; color:#1565C0; font-weight:700;">' + arrow + '</td>' +
      '<td style="padding:6px 8px; font-weight:600;">' + (e.piso || '—') + '</td>' +
      '<td style="padding:6px 8px;">' + _sectorBadge(e.sector) + '</td>' +
      '<td style="padding:6px 8px; font-family:monospace; font-weight:600;">' + (e.eje || '—') + '</td>' +
      '<td style="padding:6px 8px; text-align:right; font-size:11px; color:#666;">' + ciclosLabel + '</td>' +
      '<td style="padding:6px 8px; text-align:right;">' + _fmt(e.items) + '</td>' +
      '<td style="padding:6px 8px; text-align:right;">' + _fmt(e.sum_cant_total) + '</td>' +
      '<td style="padding:6px 8px; text-align:right;">' + _fmt(e.sum_largo_total) + '</td>' +
      '<td style="padding:6px 8px; text-align:right; font-weight:600;">' + _fmt(e.sum_kg, 1) + '</td>' +
      '<td style="padding:6px 8px;"><span style="color:#666; font-size:11px;">' + _phiText(e.diam_min, e.diam_max) + '</span> ' + origenes + '</td>' +
      '</tr>';

    html += '<tr class="bm-elem-detail" id="bm-detail-' + idx + '" style="display:' + (isOpen ? '' : 'none') + ';">' +
      '<td></td><td colspan="9" style="padding:0 12px 8px 12px; background:#fafbfc;">' +
      '<div id="bm-detail-content-' + idx + '" class="muted" style="font-size:11px; padding:8px;">' +
      (isOpen ? 'Cargando…' : '') +
      '</div></td></tr>';
  });

  html += '</tbody>';
  tbl.innerHTML = html;

  // Hidratar detalles ya expandidos
  lastElementos.forEach((e, idx) => {
    if (expanded.has(_elemKey(e))) _hydrateDetail(idx);
  });
}

async function toggleElemento(idx) {
  const e = lastElementos[idx]; if (!e) return;
  const key = _elemKey(e);
  const row = document.getElementById('bm-detail-' + idx);
  const arrowCell = row && row.previousElementSibling && row.previousElementSibling.firstElementChild;

  if (expanded.has(key)) {
    expanded.delete(key);
    if (row) row.style.display = 'none';
    if (arrowCell) arrowCell.textContent = '▸';
    return;
  }
  expanded.add(key);
  if (row) row.style.display = '';
  if (arrowCell) arrowCell.textContent = '▾';
  await _hydrateDetail(idx);
}

async function _hydrateDetail(idx) {
  const e = lastElementos[idx]; if (!e) return;
  const key = _elemKey(e);
  const cont = document.getElementById('bm-detail-content-' + idx);
  if (!cont) return;

  let barras = detailCache.get(key);
  if (!barras) {
    cont.textContent = 'Cargando…';
    const params = _buildFilterParams();
    if (!params) return;
    // Sobreescribir con filtros del elemento (independiente de los selects)
    params.set('piso', e.piso || '');
    params.set('sector', e.sector || '');
    params.delete('ciclo');                 // permitir TODOS los ciclos del elemento
    params.set('eje', e.eje || '');
    params.delete('q');
    params.set('limit', '500');
    params.set('offset', '0');
    params.set('order_by', 'ciclo');
    params.set('order_dir', 'asc');
    const res = await apiGet('/barras?' + params.toString());
    barras = (res && res.data) ? res.data : [];
    detailCache.set(key, barras);
  }
  _renderDetail(cont, e, barras);
}

function _renderDetail(cont, elem, barras) {
  if (!barras.length) {
    cont.innerHTML = '<em>Sin barras detalladas para este elemento.</em>';
    return;
  }
  // Agrupar por ciclo
  const byCiclo = {};
  barras.forEach(b => {
    const c = b.ciclo || '—';
    (byCiclo[c] = byCiclo[c] || []).push(b);
  });
  const ciclos = Object.keys(byCiclo).sort((a, b) => {
    const na = parseInt((a.match(/\d+/) || [0])[0], 10);
    const nb = parseInt((b.match(/\d+/) || [0])[0], 10);
    return na - nb || a.localeCompare(b);
  });

  let html = '';
  ciclos.forEach(c => {
    const grp = byCiclo[c];
    const sumKg = grp.reduce((s, b) => s + (Number(b.peso_total) || 0), 0);
    const sumCant = grp.reduce((s, b) => s + (Number(b.cant_total) || 0), 0);
    html += '<div style="margin:6px 0; border-left:3px solid #1565C0; padding:4px 10px; background:#fff; border-radius:0 4px 4px 0;">' +
      '<div style="font-size:11px; color:#1565C0; font-weight:700; margin-bottom:4px;">' +
      'Ciclo ' + c + ' · ' + grp.length + ' barras · ' + _fmt(sumCant) + ' uds · ' + _fmt(sumKg, 1) + ' kg' +
      '</div>' +
      '<table style="width:100%; font-size:11px; border-collapse:collapse;">' +
      '<thead><tr style="color:#666;">' +
      '<th style="text-align:left; padding:2px 6px;">ID</th>' +
      '<th style="text-align:right; padding:2px 6px;">φ</th>' +
      '<th style="text-align:right; padding:2px 6px;">Cant</th>' +
      '<th style="text-align:right; padding:2px 6px;">Largo</th>' +
      '<th style="text-align:right; padding:2px 6px;">Peso U.</th>' +
      '<th style="text-align:right; padding:2px 6px;">Peso Total</th>' +
      '<th style="text-align:left; padding:2px 6px;">Origen</th>' +
      '<th style="text-align:left; padding:2px 6px;">Plano</th>' +
      '</tr></thead><tbody>';
    grp.forEach(b => {
      const idShort = (b.id_unico || '').split('-').slice(-1)[0];
      html += '<tr style="border-top:1px solid #f0f0f0;">' +
        '<td style="padding:2px 6px; font-family:monospace; font-size:10px;" title="' + (b.id_unico || '') + '">' + idShort + '</td>' +
        '<td style="padding:2px 6px; text-align:right;">' + (b.diam != null ? Math.round(b.diam) : '') + '</td>' +
        '<td style="padding:2px 6px; text-align:right;">' + (b.cant_total != null ? Math.round(b.cant_total) : '') + '</td>' +
        '<td style="padding:2px 6px; text-align:right;">' + (b.largo_total != null ? Math.round(b.largo_total) : '') + '</td>' +
        '<td style="padding:2px 6px; text-align:right;">' + (b.peso_unitario != null ? Number(b.peso_unitario).toFixed(2) : '') + '</td>' +
        '<td style="padding:2px 6px; text-align:right;">' + (b.peso_total != null ? Number(b.peso_total).toFixed(1) : '') + '</td>' +
        '<td style="padding:2px 6px;">' + _origenBadge(b.origen) + '</td>' +
        '<td style="padding:2px 6px; color:#666;">' + (b.plano_code || '—') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
  });
  cont.innerHTML = html;
}

// ========================= EXPANDIR / COLAPSAR TODOS =========================

async function expandAll() {
  if (!lastElementos.length) return;
  for (let i = 0; i < lastElementos.length; i++) {
    const key = _elemKey(lastElementos[i]);
    if (!expanded.has(key)) expanded.add(key);
  }
  _renderElementos();
}

function collapseAll() {
  expanded.clear();
  _renderElementos();
}

// ========================= RESET / CARGA / PAGINACIÓN =========================

function resetFiltros() {
  ['proyecto', 'plano', 'sector', 'piso', 'ciclo'].forEach(f => {
    const el = document.getElementById(f); if (el) el.value = '';
  });
  const qel = document.getElementById('q'); if (qel) qel.value = '';
  const fo = document.getElementById('filtroOrigen'); if (fo) fo.value = '';
  if (typeof clearCargaFilter === 'function') clearCargaFilter(true);
  if (typeof loadCargasDropdown === 'function') loadCargasDropdown('');
  const si = document.getElementById('proyectoSearchInput'); if (si) si.value = '';
  try { localStorage.removeItem(FILTER_STORAGE_KEY); } catch (e) {}
  expanded.clear();
  detailCache.clear();
  if (typeof loadFilters === 'function') loadFilters();
  buscar(true);
}

async function verBarrasCarga(importId, idProyecto, archivo) {
  switchTab('buscar');
  const proySel = document.getElementById('proyecto');
  if (proySel) proySel.value = idProyecto;
  await loadCargasDropdown(idProyecto);
  const fc = document.getElementById('filtroCarga');
  if (fc) fc.value = importId;
  document.getElementById('cargaFilterBadge').style.display = '';
  document.getElementById('cargaFilterLabel').textContent = archivo || ('Carga #' + importId);
  buscar(true);
}

function clearCargaFilter(skipSearch) {
  const fc = document.getElementById('filtroCarga');
  if (fc) fc.value = '';
  const badge = document.getElementById('cargaFilterBadge');
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
