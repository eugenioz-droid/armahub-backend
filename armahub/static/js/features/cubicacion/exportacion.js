// ========================= CUBICACIÓN — Exportación (E.4) =========================
// State for export matrix
let _exportSelected = new Set();   // keys like "ELEV_P1_C1"
let _exportAllKeys = [];           // all available keys for current project
let _exportProy = '';              // current project in export tab
let _exportHistory = {};           // server-side history: { key: {veces, ultima_fecha, ...} }
let _exportItems = [];             // cached items for current project

async function previewExport() {
  const proy = document.getElementById('exportProyecto').value;
  const preview = document.getElementById('exportPreview');
  const matrizCard = document.getElementById('exportMatrizCard');
  const reportCard = document.getElementById('exportReportCard');
  _exportProy = proy;
  _exportSelected = new Set();
  _exportAllKeys = [];
  _exportHistory = {};
  _exportItems = [];

  if (!proy) {
    preview.innerHTML = '';
    matrizCard.style.display = 'none';
    if (reportCard) reportCard.style.display = 'none';
    return;
  }

  preview.innerHTML = '<div class="muted">Cargando...</div>';

  const [data, histData] = await Promise.all([
    apiGet('/dashboard/sectores?proyecto=' + encodeURIComponent(proy)),
    apiGet('/proyectos/' + encodeURIComponent(proy) + '/export-history'),
  ]);

  if (!data || !data.items || data.items.length === 0) {
    preview.innerHTML = '<span class="muted">Este proyecto no tiene barras para exportar.</span>';
    matrizCard.style.display = 'none';
    if (reportCard) reportCard.style.display = 'none';
    return;
  }

  _exportHistory = (histData && histData.history) ? histData.history : {};
  _exportItems = data.items;

  // Summary
  let totalBarras = 0, totalKilos = 0;
  data.items.forEach(i => { totalBarras += i.barras || 0; totalKilos += i.kilos || 0; });
  const doneCount = Object.keys(_exportHistory).length;
  preview.innerHTML = '<div style="background:#f8f9fa; padding:12px; border-radius:6px; font-size:13px;">' +
    '<strong>' + totalBarras.toLocaleString() + ' barras</strong> · <strong>' + Math.round(totalKilos).toLocaleString() + ' kg</strong> disponibles para exportar.' +
    (doneCount > 0 ? ' · <span style="color:#558B2F;">' + doneCount + ' sectores ya exportados</span>' : '') +
    '<span class="muted" style="margin-left:8px; font-size:11px;">Un .xlsx por cada combinación SECTOR + PISO + CICLO.</span>' +
    '</div>';

  matrizCard.style.display = 'block';
  buildExportMatriz(data.items, proy);
  buildExportReport(proy);
}

function buildExportMatriz(items, proy) {
  const container = document.getElementById('exportMatrizContainer');

  // Build lookup: key = "SECTOR|PISO|CICLO" => {barras, kilos}
  const lookup = {};
  items.forEach(i => {
    const s = (i.sector || '?').toUpperCase().trim();
    const p = (i.piso || '?').trim();
    const c = (i.ciclo || '?').trim();
    // 5M.6: editadas = barras de la celda editadas a mano en la plataforma.
    lookup[s + '|' + p + '|' + c] = { barras: i.barras, kilos: i.kilos, editadas: i.editadas || 0 };
  });

  // Collect unique pisos and ciclos
  const pisosSet = new Set(), ciclosSet = new Set(), sectoresSet = new Set();
  items.forEach(i => {
    pisosSet.add((i.piso || '?').trim());
    ciclosSet.add((i.ciclo || '?').trim());
    sectoresSet.add((i.sector || '?').toUpperCase().trim());
  });

  const pisos = Array.from(pisosSet).sort((a, b) => pisoOrder(a) - pisoOrder(b));
  pisos.reverse(); // highest floor at top

  const ciclos = Array.from(ciclosSet).sort((a, b) => {
    const na = parseInt((a.match(/(\d+)/) || [0,0])[1]);
    const nb = parseInt((b.match(/(\d+)/) || [0,0])[1]);
    return na - nb;
  });

  const TYPE_ORDER = ['FUND', 'LCIELO', 'VCIELO', 'ELEV'];
  const lowestPiso = pisos[pisos.length - 1];

  function getTypesForPiso(piso) {
    const types = [];
    if (piso === lowestPiso) {
      for (const c of ciclos) { if (lookup['FUND|' + piso + '|' + c]) { types.push('FUND'); break; } }
    }
    for (const t of TYPE_ORDER) {
      if (t === 'FUND') continue;
      for (const c of ciclos) { if (lookup[t + '|' + piso + '|' + c]) { types.push(t); break; } }
    }
    for (const s of sectoresSet) {
      if (TYPE_ORDER.includes(s)) continue;
      for (const c of ciclos) { if (lookup[s + '|' + piso + '|' + c]) { types.push(s); break; } }
    }
    return types.length > 0 ? types : ['ELEV'];
  }

  // Collect all exportable keys
  _exportAllKeys = [];
  pisos.forEach(piso => {
    const types = getTypesForPiso(piso);
    types.forEach(tipo => {
      ciclos.forEach(ciclo => {
        if (lookup[tipo + '|' + piso + '|' + ciclo]) {
          _exportAllKeys.push(tipo + '_' + piso + '_' + ciclo);
        }
      });
    });
  });

  // Section type initials for piso breakdown
  const TYPE_INITIALS = { 'FUND': 'F', 'LCIELO': 'L', 'VCIELO': 'V', 'ELEV': 'E' };

  // Build HTML table
  let html = '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
  // Header row with ciclo names (clickable for column selection)
  html += '<thead><tr>';
  html += '<th style="border:1px solid #333; padding:3px 4px; background:#1a1a1a; color:#8BC34A; white-space:nowrap; min-width:120px; font-size:10px;">Piso</th>';
  ciclos.forEach(c => {
    html += '<th style="border:1px solid #333; padding:2px 4px; background:#1a1a1a; color:#8BC34A; text-align:center; white-space:nowrap; cursor:pointer; font-size:10px;" onclick="exportToggleCiclo(\'' + c + '\')" title="Seleccionar/deseleccionar columna ' + c + '">' + c + '</th>';
  });
  html += '</tr></thead><tbody>';

  pisos.forEach(piso => {
    const types = getTypesForPiso(piso);
    // Compute piso-level totals (kg and barras) and per-section totals
    const pisoKeys = [];
    let pisoTotalKg = 0, pisoTotalBar = 0;
    const sectionTotals = {}; // { 'ELEV': {kg, bar}, 'LCIELO': {kg, bar}, ... }
    types.forEach(tipo => {
      if (!sectionTotals[tipo]) sectionTotals[tipo] = { kg: 0, bar: 0 };
      ciclos.forEach(ciclo => {
        const d = lookup[tipo + '|' + piso + '|' + ciclo];
        if (d) {
          pisoKeys.push(tipo + '_' + piso + '_' + ciclo);
          pisoTotalKg += d.kilos;
          pisoTotalBar += d.barras;
          sectionTotals[tipo].kg += d.kilos;
          sectionTotals[tipo].bar += d.barras;
        }
      });
    });
    const allPisoSelected = pisoKeys.length > 0 && pisoKeys.every(k => _exportSelected.has(k));
    const somePisoSelected = pisoKeys.some(k => _exportSelected.has(k));

    types.forEach((tipo, typeIdx) => {
      html += '<tr>';
      if (typeIdx === 0) {
        // Piso cell with checkbox + total + section breakdown
        html += '<td rowspan="' + types.length + '" style="border:1px solid #ccc; padding:4px 5px; font-weight:bold; background:#f8f8f8; color:#1a1a1a; vertical-align:middle; white-space:nowrap; min-width:120px;">';
        // Top: checkbox + piso name + total
        html += '<div style="display:flex; align-items:center; gap:4px; cursor:pointer; margin-bottom:3px;" onclick="exportTogglePiso(\'' + piso + '\')" title="Seleccionar/deseleccionar todo ' + piso + '">';
        const cbStyle = allPisoSelected ? 'checked' : '';
        const indeterminate = (!allPisoSelected && somePisoSelected) ? 'style="opacity:0.5;"' : '';
        html += '<input type="checkbox" ' + cbStyle + ' ' + indeterminate + ' style="width:13px; height:13px; pointer-events:none; accent-color:#4285f4; margin:0; flex-shrink:0;" />';
        html += '<span style="font-size:11px; font-weight:700; line-height:1;">' + piso + ': ' + Math.round(pisoTotalKg).toLocaleString() + 'kg ' + pisoTotalBar + 'un</span>';
        html += '</div>';
        // Bottom: section breakdown lines
        if (types.length > 1 || types[0] !== 'ELEV') {
          html += '<div style="padding-left:18px; font-size:9px; color:#555; line-height:1.4;">';
          types.forEach(t => {
            const st = sectionTotals[t];
            const initial = TYPE_INITIALS[t] || t.charAt(0);
            html += '<div>' + initial + ': ' + Math.round(st.kg).toLocaleString() + 'kg ' + st.bar + 'un</div>';
          });
          html += '</div>';
        }
        html += '</td>';
      }
      // Data cells for each ciclo
      ciclos.forEach(ciclo => {
        const lookupKey = tipo + '|' + piso + '|' + ciclo;
        const exportKey = tipo + '_' + piso + '_' + ciclo;
        const d = lookup[lookupKey];
        if (d) {
          const hist = _exportHistory[exportKey];
          const isDone = !!hist;
          const isSelected = _exportSelected.has(exportKey);
          // "Modificado" = hubo carga/reimport posterior a la última exportación.
          // Cualquier reimport actualiza fecha_carga aunque el contenido parezca igual:
          // pudo cambiar diámetro/largo/etc. → se marca rojo como advertencia.
          let isModified = false;
          if (isDone && hist.ultima_modificacion && hist.ultima_fecha) {
            isModified = hist.ultima_modificacion > hist.ultima_fecha;
          }
          // Background: rosado if modified, green if exported and not modified, blue if selected, white otherwise
          let bg = '#fff';
          if (isSelected) {
            bg = '#e3f0ff';
          } else if (isDone && isModified) {
            bg = '#ffcdd2'; // rosado - modified after export
          } else if (isDone) {
            bg = '#e8f5e9'; // green - exported and unchanged
          }
          // 5M.6: ¿celda con barras editadas a mano en la plataforma?
          const tieneEditadas = (d.editadas || 0) > 0;
          const border = isSelected ? '2px solid #4285f4' : '1px solid #ccc';
          const borderLeft = tieneEditadas ? 'border-left:3px solid #8d6e63;' : '';
          let doneTitle = '';
          if (isDone) {
            doneTitle = ' | Exportado ' + hist.veces + 'x, \u00faltimo: ' + (hist.ultima_fecha || '').substring(0, 10);
            if (isModified) doneTitle += ' | ⚠️ MODIFICADO - requiere re-exportar';
          }
          if (tieneEditadas) doneTitle += ' | editada(s) a mano en la plataforma: ' + d.editadas;
          html += '<td style="border:' + border + '; ' + borderLeft + ' padding:2px 4px; background:' + bg + '; text-align:center; cursor:pointer; position:relative; transition:all 0.12s; min-width:80px; white-space:nowrap;" ';
          html += 'onclick="exportToggleCell(\'' + exportKey + '\')" ';
          html += 'title="' + tipo + ' ' + piso + ' ' + ciclo + ': ' + d.barras + ' barras, ' + Math.round(d.kilos).toLocaleString() + ' kg' + doneTitle + '">';
          // Checkbox
          html += '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' style="position:absolute; top:1px; left:1px; width:11px; height:11px; pointer-events:none; accent-color:#4285f4;" />';
          // Done badge - warning icon if modified, checkmark if not
          if (isDone) {
            if (isModified) {
              html += '<span style="position:absolute; top:0px; right:2px; font-size:9px; color:#c62828;" title="Modificado después de exportar - requiere re-exportar">&#9888;</span>';
            } else {
              html += '<span style="position:absolute; top:0px; right:2px; font-size:9px; color:#558B2F;" title="Exportado ' + hist.veces + ' vez(es)">&#10004;</span>';
            }
          }
          // 5M.6: marca de edición-plataforma (abajo-derecha para no chocar con el
          // badge de exportación arriba-derecha).
          if (tieneEditadas) {
            html += '<span style="position:absolute; bottom:0px; right:2px; font-size:9px;" title="' + d.editadas + ' barra(s) editada(s) a mano en la plataforma">&#9997;</span>';
          }
          // Compact single-line: TIPO  kg  un
          html += '<div style="display:flex; align-items:baseline; justify-content:center; gap:4px;">';
          html += '<span style="font-weight:600; font-size:9px; color:#666;">' + tipo + '</span>';
          html += '<span style="font-size:10px; font-weight:bold; color:#1a1a1a;">' + Math.round(d.kilos).toLocaleString() + 'kg</span>';
          html += '<span style="font-size:9px; color:#888;">' + d.barras + 'un</span>';
          html += '</div>';
          html += '</td>';
        } else {
          html += '<td style="border:1px solid #eee; padding:2px; background:#fafafa;"></td>';
        }
      });
      html += '</tr>';
    });
  });

  html += '</tbody></table>';

  // Legend
  html += '<div style="margin-top:6px; display:flex; gap:10px; align-items:center; font-size:10px; flex-wrap:wrap;">';
  html += '<span><span style="display:inline-block; width:12px; height:10px; background:#e3f0ff; border:2px solid #4285f4; vertical-align:middle;"></span> Seleccionado</span>';
  html += '<span><span style="display:inline-block; width:12px; height:10px; background:#e8f5e9; border:1px solid #8BC34A; vertical-align:middle;"></span> <span style="color:#558B2F;">&#10004;</span> Ya exportado</span>';
  html += '<span><span style="display:inline-block; width:12px; height:10px; background:#ffcdd2; border:1px solid #e57373; vertical-align:middle;"></span> <span style="color:#c62828;">&#9888;</span> Modificado (re-exportar)</span>';
  html += '<span><span style="display:inline-block; width:12px; height:10px; background:#fff; border:1px solid #ccc; vertical-align:middle;"></span> Pendiente</span>';
  // 5M.6: marca de edición-plataforma (borde marrón + ✏️), ortogonal al estado.
  html += '<span><span style="display:inline-block; width:12px; height:10px; background:#fff; border-left:3px solid #8d6e63; border-top:1px solid #ccc; border-bottom:1px solid #ccc; border-right:1px solid #ccc; vertical-align:middle;"></span> &#9997; Editado a mano en la plataforma</span>';
  html += '</div>';

  container.innerHTML = html;
  updateExportSelCount();
}

async function buildExportReport(proy) {
  const reportCard = document.getElementById('exportReportCard');
  if (!reportCard) return;
  const reportContainer = document.getElementById('exportReportContainer');
  if (!reportContainer) return;

  const rpt = await apiGet('/proyectos/' + encodeURIComponent(proy) + '/export-report');
  if (!rpt) { reportCard.style.display = 'none'; return; }

  reportCard.style.display = 'block';
  let html = '<div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:10px;">';
  html += '<div style="background:#f8f9fa; padding:8px 14px; border-radius:6px; text-align:center;">';
  html += '<div style="font-size:20px; font-weight:bold; color:#1a1a1a;">' + rpt.total_sectores + '</div>';
  html += '<div style="font-size:10px; color:#888;">Total sectores</div></div>';
  html += '<div style="background:#e8f5e9; padding:8px 14px; border-radius:6px; text-align:center;">';
  html += '<div style="font-size:20px; font-weight:bold; color:#558B2F;">' + rpt.exportados + '</div>';
  html += '<div style="font-size:10px; color:#888;">Exportados</div></div>';
  html += '<div style="background:#fff3e0; padding:8px 14px; border-radius:6px; text-align:center;">';
  html += '<div style="font-size:20px; font-weight:bold; color:#e65100;">' + rpt.pendientes + '</div>';
  html += '<div style="font-size:10px; color:#888;">Pendientes</div></div>';
  html += '<div style="background:#f8f9fa; padding:8px 14px; border-radius:6px; text-align:center;">';
  // Progress bar
  html += '<div style="font-size:16px; font-weight:bold; color:#1a1a1a;">' + rpt.porcentaje + '%</div>';
  html += '<div style="width:80px; height:6px; background:#e0e0e0; border-radius:3px; margin-top:2px;">';
  html += '<div style="width:' + rpt.porcentaje + '%; height:100%; background:#8BC34A; border-radius:3px;"></div></div>';
  html += '<div style="font-size:10px; color:#888;">Progreso</div></div>';
  html += '</div>';

  // Detail table
  if (rpt.items && rpt.items.length > 0) {
    html += '<details><summary style="cursor:pointer; font-size:11px; color:#666; margin-bottom:4px;">Ver detalle por sector</summary>';
    html += '<table style="width:100%; border-collapse:collapse; font-size:10px; margin-top:4px;">';
    html += '<thead><tr style="background:#f5f5f5;">';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:left;">Sector</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:left;">Piso</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:left;">Ciclo</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:right;">Barras</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:right;">Kilos</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:center;">Estado</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:center;">Veces</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:left;">Ultima exp.</th>';
    html += '<th style="border:1px solid #ddd; padding:3px 5px; text-align:left;">Usuario</th>';
    html += '</tr></thead><tbody>';
    rpt.items.forEach(it => {
      const rowBg = it.exportado ? '#f6fdf6' : '#fff';
      html += '<tr style="background:' + rowBg + ';">';
      html += '<td style="border:1px solid #eee; padding:2px 5px;">' + (it.sector || '') + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px;">' + (it.piso || '') + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px;">' + (it.ciclo || '') + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px; text-align:right;">' + it.barras + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px; text-align:right;">' + it.kilos.toLocaleString() + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px; text-align:center;">' + (it.exportado ? '<span style="color:#558B2F; font-weight:bold;">Exportado</span>' : '<span style="color:#999;">Pendiente</span>') + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px; text-align:center;">' + (it.veces_exportado || 0) + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px;">' + (it.ultima_fecha ? it.ultima_fecha.substring(0, 16).replace('T', ' ') : '-') + '</td>';
      html += '<td style="border:1px solid #eee; padding:2px 5px;">' + (it.ultimo_usuario || '-') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></details>';
  }

  reportContainer.innerHTML = html;
}

function exportToggleCell(key) {
  if (_exportSelected.has(key)) {
    _exportSelected.delete(key);
  } else {
    _exportSelected.add(key);
  }
  // Re-render matrix without re-fetching
  if (_exportItems.length > 0) {
    buildExportMatriz(_exportItems, _exportProy);
  }
}

function exportTogglePiso(piso) {
  const pisoKeys = _exportAllKeys.filter(k => {
    const parts = k.split('_');
    return parts.length >= 3 && parts[1] === piso;
  });
  const allSelected = pisoKeys.every(k => _exportSelected.has(k));
  pisoKeys.forEach(k => { allSelected ? _exportSelected.delete(k) : _exportSelected.add(k); });
  if (_exportItems.length > 0) buildExportMatriz(_exportItems, _exportProy);
}

function exportToggleCiclo(ciclo) {
  const cicloKeys = _exportAllKeys.filter(k => {
    const parts = k.split('_');
    return parts.length >= 3 && parts[parts.length - 1] === ciclo;
  });
  const allSelected = cicloKeys.every(k => _exportSelected.has(k));
  cicloKeys.forEach(k => { allSelected ? _exportSelected.delete(k) : _exportSelected.add(k); });
  if (_exportItems.length > 0) buildExportMatriz(_exportItems, _exportProy);
}

function exportSelectAll(select) {
  if (select) {
    _exportAllKeys.forEach(k => _exportSelected.add(k));
  } else {
    _exportSelected.clear();
  }
  if (_exportItems.length > 0) buildExportMatriz(_exportItems, _exportProy);
}

async function reRenderExportMatriz() {
  if (!_exportProy) return;
  const [data, histData] = await Promise.all([
    apiGet('/dashboard/sectores?proyecto=' + encodeURIComponent(_exportProy)),
    apiGet('/proyectos/' + encodeURIComponent(_exportProy) + '/export-history'),
  ]);
  _exportHistory = (histData && histData.history) ? histData.history : {};
  if (data && data.items) {
    _exportItems = data.items;
    buildExportMatriz(data.items, _exportProy);
  }
  buildExportReport(_exportProy);
}

function updateExportSelCount() {
  const n = _exportSelected.size;
  const total = _exportAllKeys.length;
  const countEl = document.getElementById('exportSelCount');
  const btn = document.getElementById('exportSelBtn');
  if (countEl) countEl.textContent = n + ' de ' + total + ' seleccionados';
  if (btn) {
    btn.textContent = 'Exportar seleccionados (' + n + ')';
    btn.disabled = (n === 0);
    btn.style.opacity = n === 0 ? '0.5' : '1';
  }
}

async function descargarExportSeleccionados() {
  const proy = _exportProy;
  if (!proy) return alert('Selecciona un proyecto');
  if (_exportSelected.size === 0) return alert('Selecciona al menos un sector');

  const sectoresParam = Array.from(_exportSelected).join(',');
  const status = document.getElementById('exportStatus');
  status.textContent = 'Generando ' + _exportSelected.size + ' archivos Excel...';

  try {
    const url = '/proyectos/' + encodeURIComponent(proy) + '/exportar?sectores=' + encodeURIComponent(sectoresParam);
    const res = await fetch(url, { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) {
      const err = await res.json();
      status.textContent = 'Error: ' + (err.detail || 'desconocido');
      return;
    }
    const blob = await res.blob();
    _triggerDownload(blob, res);

    status.textContent = 'Descarga completada — ' + _exportSelected.size + ' sectores exportados.';
    // Refresh history from server
    await reRenderExportMatriz();
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  }
}

async function descargarExport() {
  const proy = document.getElementById('exportProyecto').value || _exportProy;
  if (!proy) return alert('Selecciona un proyecto');
  const status = document.getElementById('exportStatus');
  status.textContent = 'Generando todos los archivos Excel...';

  try {
    const res = await fetch(apiUrl('/proyectos/' + encodeURIComponent(proy) + '/exportar'), { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) {
      const err = await res.json();
      status.textContent = 'Error: ' + (err.detail || 'desconocido');
      return;
    }
    const blob = await res.blob();
    _triggerDownload(blob, res);

    status.textContent = 'Descarga completada — todos los sectores exportados.';
    // Refresh history from server
    await reRenderExportMatriz();
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  }
}

function _triggerDownload(blob, res) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const cd = res.headers.get('Content-Disposition');
  const fn = cd ? cd.split('filename=')[1].replace(/"/g, '') : 'export.zip';
  a.download = fn;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
