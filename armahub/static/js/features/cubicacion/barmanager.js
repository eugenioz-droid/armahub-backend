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

// Paleta estable para ciclos: hash → color suave consistente.
// 20 colores; se reciclan automáticamente si hay más ciclos (módulo).
const CICLO_PALETTE = [
  '#1565C0', '#7B1FA2', '#00897B', '#6D4C41',
  '#C62828', '#2E7D32', '#EF6C00', '#283593',
  '#AD1457', '#5D4037', '#0277BD', '#558B2F',
  '#D81B60', '#00695C', '#F4511E', '#3949AB',
  '#8E24AA', '#43A047', '#FB8C00', '#3F51B5'
];
function _cicloColor(c) {
  if (!c) return '#999';
  let h = 0;
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) >>> 0;
  return CICLO_PALETTE[h % CICLO_PALETTE.length];
}
function _cicloBadge(c) {
  if (!c) return '<span class="muted">—</span>';
  const col = _cicloColor(c);
  return '<span style="background:' + col + ';color:#fff;padding:2px 7px;border-radius:9px;font-size:10px;font-weight:600;">' + c + '</span>';
}
function _ciclosCell(arr) {
  if (!arr || !arr.length) return '<span class="muted">—</span>';
  if (arr.length <= 4) return arr.map(_cicloBadge).join(' ');
  return arr.slice(0, 3).map(_cicloBadge).join(' ') +
    ' <span class="muted" style="font-size:10px;">+' + (arr.length - 3) + '</span>';
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
  ['plano', 'sector', 'piso', 'ciclo', 'eje'].forEach(f => {
    const v = document.getElementById(f) && document.getElementById(f).value;
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
    '<th style="padding:6px 8px; text-align:left;">Ciclos</th>' +
    '<th style="padding:6px 8px; text-align:left;">Eje</th>' +
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

    const origenes = (e.origenes || []).map(_origenBadge).join(' ');

    html += '<tr class="bm-elem-row" style="cursor:pointer; border-top:1px solid #eee;" ' +
      'onclick="toggleElemento(' + idx + ')">' +
      '<td style="padding:6px 4px; text-align:center; color:#1565C0; font-weight:700;">' + arrow + '</td>' +
      '<td style="padding:6px 8px; font-weight:600;">' + (e.piso || '—') + '</td>' +
      '<td style="padding:6px 8px;">' + _sectorBadge(e.sector) + '</td>' +
      '<td style="padding:6px 8px;">' + _ciclosCell(e.ciclos) + '</td>' +
      '<td style="padding:6px 8px; font-family:monospace; font-weight:600;">' + (e.eje || '—') + '</td>' +
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

  const dimKeys = ['dim_a','dim_b','dim_c','dim_d','dim_e','dim_f','dim_g','dim_h','dim_i'];
  const dimLabels = ['A','B','C','D','E','F','G','H','I'];
  const angKeys = ['ang1','ang2','ang3','ang4'];
  const angLabels = ['α1','α2','α3','α4'];

  function _num(v, d = 0) {
    if (v == null || v === '' || isNaN(v)) return '';
    return d ? Number(v).toFixed(d) : Math.round(Number(v));
  }

  let html = '';
  ciclos.forEach(c => {
    const grp = byCiclo[c];
    const sumKg = grp.reduce((s, b) => s + (Number(b.peso_total) || 0), 0);
    const sumCant = grp.reduce((s, b) => s + (Number(b.cant_total) || 0), 0);
    html += '<div style="margin:6px 0; border-left:3px solid ' + _cicloColor(c) + '; padding:4px 10px; background:#fff; border-radius:0 4px 4px 0;">' +
      '<div style="font-size:11px; color:' + _cicloColor(c) + '; font-weight:700; margin-bottom:4px;">' +
      'Ciclo ' + c + ' · ' + grp.length + ' barras · ' + _fmt(sumCant) + ' uds · ' + _fmt(sumKg, 1) + ' kg' +
      '</div>' +
      '<div style="overflow-x:auto;">' +
      '<table style="width:100%; min-width:1100px; font-size:11px; border-collapse:collapse;">' +
      '<thead><tr style="color:#666; background:#fafafa;">' +
      '<th style="text-align:left; padding:2px 6px; position:sticky; left:0; background:#fafafa;">ID</th>' +
      '<th style="text-align:left; padding:2px 6px;">Tipología</th>' +
      '<th style="text-align:right; padding:2px 6px;">φ</th>' +
      '<th style="text-align:right; padding:2px 6px;">Cant</th>' +
      '<th style="text-align:right; padding:2px 6px;">Largo</th>' +
      '<th style="text-align:right; padding:2px 6px;">Peso U.</th>' +
      '<th style="text-align:right; padding:2px 6px;">Peso Tot</th>' +
      '<th style="text-align:left; padding:2px 6px;">Origen</th>' +
      '<th style="text-align:left; padding:2px 6px;">Plano</th>' +
      '<th style="text-align:left; padding:2px 6px;">Figura</th>' +
      dimLabels.map(L => '<th style="text-align:right; padding:2px 6px;">' + L + '</th>').join('') +
      angLabels.map(L => '<th style="text-align:right; padding:2px 6px;">' + L + '</th>').join('') +
      '<th style="text-align:right; padding:2px 6px;">R</th>' +
      '</tr></thead><tbody>';
    grp.forEach(b => {
      const idShort = (b.id_unico || '').split('-').slice(-1)[0];
      const dims = dimKeys.map(k => '<td style="padding:2px 6px; text-align:right; color:#444;">' + _num(b[k]) + '</td>').join('');
      const angs = angKeys.map(k => '<td style="padding:2px 6px; text-align:right; color:#444;">' + _num(b[k], 1) + '</td>').join('');
      html += '<tr style="border-top:1px solid #f0f0f0;">' +
        '<td style="padding:2px 6px; font-family:monospace; font-size:10px; position:sticky; left:0; background:#fff;" title="' + (b.id_unico || '') + '">' + idShort + '</td>' +
        '<td style="padding:2px 6px; font-weight:600;">' + (b.marca || '—') + '</td>' +
        '<td style="padding:2px 6px; text-align:right;">' + _num(b.diam) + '</td>' +
        '<td style="padding:2px 6px; text-align:right;">' + _num(b.cant_total) + '</td>' +
        '<td style="padding:2px 6px; text-align:right;">' + _num(b.largo_total) + '</td>' +
        '<td style="padding:2px 6px; text-align:right;">' + _num(b.peso_unitario, 2) + '</td>' +
        '<td style="padding:2px 6px; text-align:right;">' + _num(b.peso_total, 1) + '</td>' +
        '<td style="padding:2px 6px;">' + _origenBadge(b.origen) + '</td>' +
        '<td style="padding:2px 6px; color:#666;">' + (b.plano_code || '—') + '</td>' +
        '<td style="padding:2px 6px; color:#666;">' + (b.figura || '—') + '</td>' +
        dims +
        angs +
        '<td style="padding:2px 6px; text-align:right; color:#444;">' + _num(b.radio, 1) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div></div>';
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

// ========================= MAPA DE COBERTURA PISO × CICLO =========================
let _coberturaVisible = false;

function toggleCobertura() {
  _coberturaVisible = !_coberturaVisible;
  const card = document.getElementById('bmCoberturaCard');
  const btn = document.getElementById('btnCobertura');
  if (_coberturaVisible) {
    card.style.display = '';
    if (btn) btn.textContent = '📊 Ocultar cobertura';
    loadCobertura();
  } else {
    card.style.display = 'none';
    if (btn) btn.textContent = '📊 Mostrar cobertura';
  }
}

async function loadCobertura() {
  const cont = document.getElementById('bmCoberturaContent');
  const info = document.getElementById('bmCoberturaInfo');
  const proy = document.getElementById('proyecto').value;
  if (!proy) {
    cont.innerHTML = '<div class="muted" style="padding:12px;">Selecciona un proyecto.</div>';
    if (info) info.textContent = '';
    return;
  }
  cont.innerHTML = '<div class="muted" style="padding:12px;">Cargando…</div>';

  // Reusa los filtros de proyecto/plano/sector/origen/carga (ignora piso/ciclo/eje
  // porque la matriz se construye sobre TODOS los pisos y ciclos del scope).
  const params = new URLSearchParams();
  params.set('proyecto', proy);
  ['plano', 'sector'].forEach(f => {
    const v = document.getElementById(f) && document.getElementById(f).value;
    if (v) params.set(f === 'plano' ? 'plano_code' : f, v);
  });
  const fo = document.getElementById('filtroOrigen');
  if (fo && fo.value) params.set('origen', fo.value);
  const fc = document.getElementById('filtroCarga');
  if (fc && fc.value) params.set('import_id', fc.value);

  const data = await apiGet('/barras/cobertura?' + params.toString());
  if (!data) { cont.innerHTML = '<div class="muted">Sin datos.</div>'; return; }

  _renderCobertura(cont, data, info);
}

function _pisoSortKey(p) {
  // Orden constructivo: SM/PM arriba, P1..P99 al medio, S1..S9 abajo (subterráneos al final)
  const up = (p || '').toUpperCase().trim();
  if (up === 'SM' || up === 'PM' || up === 'SALA DE MAQUINAS') return 100000;
  let m = up.match(/^P(\d+)/);
  if (m) return parseInt(m[1], 10);
  m = up.match(/^S(\d+)/);
  if (m) return -parseInt(m[1], 10);
  m = up.match(/(\d+)/);
  if (m) return parseInt(m[1], 10);
  return 0;
}

function _renderCobertura(cont, data, info) {
  if (!data.pisos.length || !data.ciclos.length) {
    cont.innerHTML = '<div class="muted" style="padding:12px;">No hay datos para los filtros actuales.</div>';
    if (info) info.textContent = '';
    return;
  }

  // Sectores estructurales (orden vertical fijo en cada piso).
  const SECT_NORMALES = ['LCIELO', 'VCIELO', 'ELEV'];
  const SECT_FUND = 'FUND';

  // ── Reagrupar: cualquier barra con sector=FUND se "atribuye" al piso PF
  // (las fundaciones viven en el nivel base). Si su piso original no era PF,
  // se acumula igual y se registra advertencia para el usuario.
  const fundMisPlaced = {}; // { pisoOriginal: { ciclo: {barras, kg} } }
  const cellsRegrouped = []; // [{piso, ciclo, sector, barras, kg}]
  const pfAcc = {};          // { ciclo: {barras, kg} }

  data.cells.forEach(c => {
    if ((c.sector || '').toUpperCase() === SECT_FUND) {
      const pisoUp = (c.piso || '').toUpperCase().trim();
      if (pisoUp !== 'PF') {
        if (!fundMisPlaced[c.piso]) fundMisPlaced[c.piso] = {};
        const slot = fundMisPlaced[c.piso][c.ciclo] || { barras: 0, kg: 0 };
        slot.barras += c.barras; slot.kg += c.kg;
        fundMisPlaced[c.piso][c.ciclo] = slot;
      }
      // Acumular bajo PF (sumando todos los orígenes).
      const acc = pfAcc[c.ciclo] || { barras: 0, kg: 0 };
      acc.barras += c.barras; acc.kg += c.kg;
      pfAcc[c.ciclo] = acc;
    } else {
      cellsRegrouped.push(c);
    }
  });
  Object.keys(pfAcc).forEach(ciclo => {
    cellsRegrouped.push({
      piso: 'PF', ciclo: ciclo, sector: SECT_FUND,
      barras: pfAcc[ciclo].barras, kg: pfAcc[ciclo].kg,
    });
  });

  // Pisos efectivos: los originales no-PF + PF (si hay datos FUND).
  const pisosSet = new Set();
  cellsRegrouped.forEach(c => { if (c.piso) pisosSet.add(c.piso); });
  const pisos = Array.from(pisosSet).sort((a, b) => _pisoSortKey(b) - _pisoSortKey(a));

  // Ciclos: orden numérico.
  const ciclos = data.ciclos.slice().sort((a, b) => {
    const na = parseInt((a.match(/\d+/) || [0])[0], 10);
    const nb = parseInt((b.match(/\d+/) || [0])[0], 10);
    return na - nb || a.localeCompare(b);
  });

  // Indexar (piso → ciclo → sector → cell)
  const idx = {};
  cellsRegrouped.forEach(c => {
    if (!idx[c.piso]) idx[c.piso] = {};
    if (!idx[c.piso][c.ciclo]) idx[c.piso][c.ciclo] = {};
    idx[c.piso][c.ciclo][c.sector || ''] = c;
  });

  // Re-calcular max_kg sobre datos reagrupados (PF combinado).
  let maxKg = 0;
  cellsRegrouped.forEach(c => { if (c.kg > maxKg) maxKg = c.kg; });

  // Estadística de cobertura: cruces piso × ciclo con al menos 1 barra.
  const totalCruces = pisos.length * ciclos.length;
  const cruceSet = new Set();
  cellsRegrouped.forEach(c => { if (c.barras > 0) cruceSet.add(c.piso + '||' + c.ciclo); });
  const cobPct = totalCruces ? Math.round(cruceSet.size * 100 / totalCruces) : 0;
  if (info) info.textContent = cruceSet.size + ' / ' + totalCruces + ' cruces (' + cobPct + '%)';

  const fmtKg = (n) => Math.round(n).toLocaleString('es-CL');
  const COLOR = '#1565C0';
  const COLOR_RGB = '21,101,192';

  // ── Warning de FUND mal catalogadas ────────────────────────────────
  let warnHtml = '';
  const misKeys = Object.keys(fundMisPlaced);
  if (misKeys.length) {
    const lista = misKeys.map(p => {
      const total = Object.values(fundMisPlaced[p]).reduce((s, x) => s + x.kg, 0);
      return p + ' (' + fmtKg(total) + ' kg)';
    }).join(', ');
    warnHtml = '<div style="background:#fff3cd; border:1px solid #ffc107; color:#856404; ' +
      'padding:8px 12px; border-radius:6px; margin-bottom:10px; font-size:12px;">' +
      '⚠️ <strong>Fundaciones mal catalogadas:</strong> hay barras con sector ' +
      '<code>FUND</code> asignadas a pisos distintos de <code>PF</code>: ' + lista + '. ' +
      'Se muestran agregadas en la fila <code>PF</code>. ' +
      'Corrige el piso en la carga para reflejar correctamente el nivel base.' +
      '</div>';
  }

  // ── Tabla ───────────────────────────────────────────────────────────
  const W_PISO = 90;
  const W_SECT = 110;
  const W_CIC = 78;

  let html = warnHtml;
  html += '<table style="border-collapse:collapse; font-size:11px; table-layout:fixed;">';
  html += '<colgroup>';
  html += '<col style="width:' + W_PISO + 'px;">';
  html += '<col style="width:' + W_SECT + 'px;">';
  ciclos.forEach(() => { html += '<col style="width:' + W_CIC + 'px;">'; });
  html += '</colgroup>';

  // Header
  html += '<thead><tr>';
  html += '<th style="position:sticky; left:0; background:#fff; padding:4px 6px;"></th>';
  html += '<th style="background:#fff; padding:4px 6px;"></th>';
  ciclos.forEach(c => {
    const col = _cicloColor(c);
    html += '<th style="padding:4px 6px; text-align:center; color:#fff; background:' + col +
      '; border-radius:4px; font-size:11px;">' + c + '</th>';
  });
  html += '</tr></thead><tbody>';

  pisos.forEach(p => {
    const pisoUp = (p || '').toUpperCase().trim();
    const isPF = pisoUp === 'PF' || pisoUp === 'FUND' || pisoUp === 'FUNDACION';
    const sectoresPiso = isPF ? [SECT_FUND] : SECT_NORMALES;

    sectoresPiso.forEach((s, si) => {
      const isLast = si === sectoresPiso.length - 1;
      const trBorder = isLast ? 'border-bottom:2px solid #e0e0e0;' : 'border-bottom:1px solid #f5f5f5;';
      html += '<tr style="' + trBorder + '">';

      if (si === 0) {
        html += '<th rowspan="' + sectoresPiso.length + '" ' +
          'style="position:sticky; left:0; background:#fafafa; padding:4px 8px; ' +
          'text-align:center; vertical-align:middle; font-weight:700; font-size:12px; ' +
          'border-right:2px solid #e0e0e0;">' + p + '</th>';
      }

      html += '<td style="padding:4px 10px; text-align:left; color:#444; ' +
        'font-size:11px; font-weight:600; background:#fafafa; ' +
        'border-right:1px solid #eee;">' + s + '</td>';

      ciclos.forEach(c => {
        const cell = ((idx[p] || {})[c] || {})[s];
        const kg = cell ? cell.kg : 0;
        const barras = cell ? cell.barras : 0;
        const pe = p.replace(/'/g, "\\'");
        const ce = c.replace(/'/g, "\\'");
        const se = s;
        if (barras > 0) {
          const ratio = maxKg > 0 ? Math.min(1, kg / maxKg) : 0.5;
          const alpha = (0.35 + ratio * 0.65).toFixed(2);
          const bg = 'rgba(' + COLOR_RGB + ',' + alpha + ')';
          const tooltip = p + ' · ' + c + ' · ' + s + ' — ' + barras + ' barras · ' + fmtKg(kg) + ' kg';
          // PF agrega múltiples pisos: el filtro click no setea piso (solo ciclo+sector).
          const onclick = isPF
            ? "filtrarPorCobertura('','" + ce + "','" + se + "')"
            : "filtrarPorCobertura('" + pe + "','" + ce + "','" + se + "')";
          html += '<td onclick="' + onclick + '" title="' + tooltip + '" ' +
            'style="cursor:pointer; background:' + bg + '; color:#fff; font-weight:700; ' +
            'font-size:10px; padding:5px 4px; text-align:center;">' +
            fmtKg(kg) + ' kg</td>';
        } else {
          html += '<td style="background:transparent;"></td>';
        }
      });
      html += '</tr>';
    });
  });
  html += '</tbody></table>';

  // Leyenda simplificada (un solo color, intensidad ∝ kg).
  html += '<div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:10px; font-size:11px; color:#666;">';
  html += '<span style="display:inline-flex; align-items:center; gap:5px;">' +
    '<span style="display:inline-block; width:14px; height:14px; background:rgba(' + COLOR_RGB + ',0.95); border-radius:3px;"></span>' +
    'mayor concentración de kg</span>';
  html += '<span style="display:inline-flex; align-items:center; gap:5px;">' +
    '<span style="display:inline-block; width:14px; height:14px; background:rgba(' + COLOR_RGB + ',0.4); border-radius:3px;"></span>' +
    'menor concentración</span>';
  html += '<span style="color:#999;">· celda en blanco = sin cubicación</span>';
  html += '</div>';

  cont.innerHTML = html;
}

function filtrarPorCobertura(piso, ciclo, sector) {
  const pSel = document.getElementById('piso');
  const cSel = document.getElementById('ciclo');
  const sSel = document.getElementById('sector');
  if (pSel) {
    if (piso) {
      if (!Array.from(pSel.options).some(o => o.value === piso)) {
        const o = document.createElement('option'); o.value = piso; o.textContent = piso;
        pSel.appendChild(o);
      }
      pSel.value = piso;
    } else {
      pSel.value = '';
    }
  }
  if (cSel) {
    if (!Array.from(cSel.options).some(o => o.value === ciclo)) {
      const o = document.createElement('option'); o.value = ciclo; o.textContent = ciclo;
      cSel.appendChild(o);
    }
    cSel.value = ciclo;
  }
  if (sSel && sector) {
    if (!Array.from(sSel.options).some(o => o.value === sector)) {
      const o = document.createElement('option'); o.value = sector; o.textContent = sector;
      sSel.appendChild(o);
    }
    sSel.value = sector;
  }
  const eSel = document.getElementById('eje'); if (eSel) eSel.value = '';
  if (typeof onFilterChange === 'function') onFilterChange();
  else buscar(true);
}

// ========================= RESET / CARGA / PAGINACIÓN =========================

function resetFiltros() {
  ['proyecto', 'plano', 'sector', 'piso', 'ciclo', 'eje'].forEach(f => {
    const el = document.getElementById(f); if (el) el.value = '';
  });
  const qel = document.getElementById('q'); if (qel) qel.value = '';
  const fo = document.getElementById('filtroOrigen'); if (fo) fo.value = '';
  if (typeof clearCargaFilter === 'function') clearCargaFilter(true);
  if (typeof loadCargasDropdown === 'function') loadCargasDropdown('');
  const si = document.getElementById('proyectoSearchInput'); if (si) si.value = '';
  try { localStorage.removeItem(FILTER_STORAGE_KEY); } catch (e) {}

  // Estado interno: limpiar resultados previos para evitar que queden barras
  // de la búsqueda anterior en pantalla cuando no hay proyecto seleccionado.
  expanded.clear();
  detailCache.clear();
  lastElementos = [];
  lastTotal = 0;
  currentOffset = 0;

  // UI: borrar tabla, KPIs y contadores explícitamente.
  const tbl = document.getElementById('tabla'); if (tbl) tbl.innerHTML = '';
  const kpis = document.getElementById('bmKpis'); if (kpis) kpis.innerHTML = '<span class="muted">Selecciona un proyecto…</span>';
  const cnt = document.getElementById('count'); if (cnt) cnt.textContent = '';
  const pi = document.getElementById('pageInfo'); if (pi) pi.textContent = '';

  // Cobertura: ocultarla y resetear estado.
  const cobCard = document.getElementById('bmCoberturaCard');
  const cobBtn = document.getElementById('btnCobertura');
  const cobCont = document.getElementById('bmCoberturaContent');
  const cobInfo = document.getElementById('bmCoberturaInfo');
  if (cobCard) cobCard.style.display = 'none';
  if (cobBtn) cobBtn.textContent = '📊 Mostrar cobertura';
  if (cobCont) cobCont.innerHTML = '';
  if (cobInfo) cobInfo.textContent = '';
  _coberturaVisible = false;

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
