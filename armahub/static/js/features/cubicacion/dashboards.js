// ========================= CUBICACIÓN — Dashboards (E.4) =========================
// Dashboard principal, Sectores constructivos, Matriz constructiva, Navegador de sectores.

let chart = null;

function renderChart(labels, values, title) {
  chart = replaceChart(chart, document.getElementById('dashChart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: title, data: values, backgroundColor: '#8BC34A' }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y' }
  });
}

async function loadDashboard(groupBy) {
  await setGlobalStatus("Cargando gráfico...", "warn");
  const data = await apiGet('/dashboard?group_by=' + encodeURIComponent(groupBy));
  if (!data) return;
  
  document.getElementById('dashTotals').textContent = `Total: ${data.total.barras} barras — ${data.total.kilos.toFixed(2)} kg`;
  
  // Sort by building order when grouping by piso
  let items = data.items;
  if (groupBy === 'piso') {
    items = [...items].sort((a, b) => pisoOrder(b.grupo) - pisoOrder(a.grupo));
  }

  const labels = items.map(x => (x.grupo === null || x.grupo === '' || x.grupo === undefined) ? '(sin valor)' : x.grupo);
  const values = items.map(x => Number(x.kilos || 0));
  
  renderChart(labels, values, `Kilos por ${groupBy}`);
  await setGlobalStatus("Gráfico actualizado", "ok");
}

// ========================= SECTORES CONSTRUCTIVOS =========================
let sectoresChart = null;

async function loadSectores() {
  const sel = document.getElementById('sectorProyectoFilter');
  const proy = sel.value;
  let url = '/dashboard/sectores';
  if (proy) url += '?proyecto=' + encodeURIComponent(proy);

  const data = await apiGet(url);
  if (!data) return;

  const tbody = document.getElementById('sectoresBody');
  const totals = document.getElementById('sectoresTotals');

  if (!data.items || data.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">Sin datos de sectores</td></tr>';
    totals.textContent = '';
    sectoresChart = destroyChart(sectoresChart);
    return;
  }

  // Sort by building order (piso)
  data.items.sort((a, b) => pisoOrder(a.piso) - pisoOrder(b.piso));

  const totalBarras = data.items.reduce((s, i) => s + i.barras, 0);
  const totalKilos = data.items.reduce((s, i) => s + i.kilos, 0);
  totals.textContent = `${data.items.length} sectores — ${totalBarras.toLocaleString()} barras — ${Math.round(totalKilos).toLocaleString()} kg`;

  tbody.innerHTML = data.items.map(i => `
    <tr>
      <td><strong>${i.sector_constructivo}</strong></td>
      <td style="text-align:right;">${i.barras.toLocaleString()}</td>
      <td style="text-align:right;">${Math.round(i.kilos).toLocaleString()} kg</td>
    </tr>
  `).join('');

  // Chart
  const labels = data.items.map(i => i.sector_constructivo);
  const kilosData = data.items.map(i => i.kilos);
  const barrasData = data.items.map(i => i.barras);
  sectoresChart = replaceChart(sectoresChart, document.getElementById('sectoresChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Kilos', data: kilosData, backgroundColor: '#8BC34A', borderRadius: 3, yAxisID: 'y' },
        { label: 'Barras', data: barrasData, backgroundColor: '#42A5F5', borderRadius: 3, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { type: 'linear', position: 'left', title: { display: true, text: 'Kilos' }, ticks: { callback: chartTickNumber } },
        y1: { type: 'linear', position: 'right', title: { display: true, text: 'Barras' }, grid: { drawOnChartArea: false } }
      }
    }
  });
}

// ========================= MATRIZ CONSTRUCTIVA =========================
async function loadMatriz() {
  const container = document.getElementById('matrizContainer');
  const proy = document.getElementById('matrizProyectoFilter').value;
  if (!proy) {
    container.innerHTML = '<div class="muted">Selecciona un proyecto para ver la matriz constructiva</div>';
    return;
  }

  container.innerHTML = '<div class="muted">Cargando matriz...</div>';
  const data = await apiGet('/dashboard/sectores?proyecto=' + encodeURIComponent(proy));
  if (!data || !data.items || data.items.length === 0) {
    container.innerHTML = '<div class="muted">Sin datos de sectores para este proyecto</div>';
    return;
  }

  // Build lookup: key = "sector|piso|ciclo" => {barras, kilos}
  const lookup = {};
  let maxKilos = 0;
  data.items.forEach(i => {
    const s = (i.sector || '?').toUpperCase().trim();
    const p = (i.piso || '?').trim();
    const c = (i.ciclo || '?').trim();
    const key = s + '|' + p + '|' + c;
    lookup[key] = { barras: i.barras, kilos: i.kilos };
    if (i.kilos > maxKilos) maxKilos = i.kilos;
  });

  // Collect unique pisos and ciclos
  const pisosSet = new Set();
  const ciclosSet = new Set();
  const sectoresSet = new Set();
  data.items.forEach(i => {
    pisosSet.add((i.piso || '?').trim());
    ciclosSet.add((i.ciclo || '?').trim());
    sectoresSet.add((i.sector || '?').toUpperCase().trim());
  });

  // Sort pisos using global pisoOrder (building order: SM top, subterráneos bottom)
  const pisos = Array.from(pisosSet).sort((a, b) => pisoOrder(a) - pisoOrder(b));
  // Reverse so highest floor is at top of table
  pisos.reverse();

  const ciclos = Array.from(ciclosSet).sort((a, b) => {
    const na = parseInt((a.match(/(\d+)/) || [0,0])[1]);
    const nb = parseInt((b.match(/(\d+)/) || [0,0])[1]);
    return na - nb;
  });

  // Determine sub-row types per piso
  // Standard order top-to-bottom within a piso: LCIELO, VCIELO, ELEV
  // FUND only appears at the lowest piso
  const TYPE_ORDER = ['LCIELO', 'VCIELO', 'ELEV'];
  const lowestPiso = pisos[pisos.length - 1]; // after reverse, last = lowest

  // For each piso, determine which sector types exist
  function getTypesForPiso(piso) {
    const types = [];
    // Check for FUND (only lowest piso typically)
    if (piso === lowestPiso) {
      for (const c of ciclos) {
        if (lookup['FUND|' + piso + '|' + c]) { types.push('FUND'); break; }
      }
    }
    // Always check standard types, but only include if data exists for this piso
    for (const t of TYPE_ORDER) {
      for (const c of ciclos) {
        if (lookup[t + '|' + piso + '|' + c]) { types.push(t); break; }
      }
    }
    // Also check for any other sector types not in standard list
    for (const s of sectoresSet) {
      if (s === 'FUND' || TYPE_ORDER.includes(s)) continue;
      for (const c of ciclos) {
        if (lookup[s + '|' + piso + '|' + c]) { types.push(s); break; }
      }
    }
    return types.length > 0 ? types : ['ELEV']; // fallback
  }

  // Heatmap color function — concrete gray scale
  function heatColor(kilos) {
    if (!kilos || maxKilos === 0) return '#fff';
    const ratio = Math.min(kilos / maxKilos, 1);
    // From light concrete (#D6D6D6) to dark concrete (#6B6B6B)
    const v = Math.round(214 - ratio * (214 - 107));
    return `rgb(${v},${v},${v})`;
  }

  // Load completed sectors from localStorage
  const completedKey = 'armahub_completed_' + proy;
  let completedSectors = {};
  try { completedSectors = JSON.parse(localStorage.getItem(completedKey) || '{}'); } catch(e) {}

  function toggleCompleted(cellKey) {
    if (completedSectors[cellKey]) {
      delete completedSectors[cellKey];
    } else {
      completedSectors[cellKey] = true;
    }
    try { localStorage.setItem(completedKey, JSON.stringify(completedSectors)); } catch(e) {}
    loadMatriz(); // re-render
  }
  // Expose to global scope for onclick
  window._matrizToggle = toggleCompleted;

  // Build HTML table — compact building look
  let html = '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
  html += '<thead><tr><th style="border:1px solid #ccc; padding:4px 6px; background:#1a1a1a; color:#8BC34A; white-space:nowrap;">Piso</th>';
  ciclos.forEach(c => {
    html += `<th style="border:1px solid #ccc; padding:4px 6px; background:#1a1a1a; color:#8BC34A; text-align:center; white-space:nowrap;">${c}</th>`;
  });
  html += '</tr></thead><tbody>';

  pisos.forEach((piso, pisoIdx) => {
    const types = getTypesForPiso(piso);
    types.forEach((tipo, typeIdx) => {
      html += '<tr>';
      if (typeIdx === 0) {
        html += `<td rowspan="${types.length}" style="border:1px solid #ccc; padding:4px 6px; font-weight:bold; background:#fff; color:#1a1a1a; vertical-align:middle; text-align:center; font-size:12px; white-space:nowrap;">${piso}</td>`;
      }
      ciclos.forEach(ciclo => {
        const key = tipo + '|' + piso + '|' + ciclo;
        const d = lookup[key];
        const isCompleted = !!completedSectors[key];
        if (d) {
          const bg = heatColor(d.kilos);
          const textColor = isCompleted ? '#558B2F' : (d.kilos > maxKilos * 0.5 ? '#fff' : '#1a1a1a');
          html += `<td style="border:1px solid #aaa; padding:3px 4px; background:${bg}; text-align:center; position:relative;" title="${tipo} ${piso} ${ciclo}: ${d.barras} barras, ${Math.round(d.kilos).toLocaleString()} kg">`;
          html += `<input type="checkbox" ${isCompleted ? 'checked' : ''} onclick="window._matrizToggle('${key}')" style="position:absolute; top:2px; right:2px; width:12px; height:12px; cursor:pointer; accent-color:#8BC34A;" title="Marcar como completado" />`;
          html += `<div style="font-weight:600; font-size:9px; color:${textColor}; opacity:0.85;">${tipo}</div>`;
          html += `<div style="font-size:11px; font-weight:bold; color:${textColor};">${Math.round(d.kilos).toLocaleString()} kg</div>`;
          html += `<div style="font-size:9px; color:${textColor}; opacity:0.7;">${d.barras} bar</div>`;
          html += '</td>';
        } else {
          html += `<td style="border:1px solid #eee; padding:3px 4px; background:#fff; text-align:center;"></td>`;
        }
      });
      html += '</tr>';
    });
  });

  html += '</tbody></table>';

  // Legend
  html += '<div style="margin-top:8px; display:flex; gap:10px; align-items:center; font-size:11px; flex-wrap:wrap;">';
  html += '<span class="muted">Intensidad (kg):</span>';
  html += '<span style="display:inline-block; width:16px; height:12px; background:#D6D6D6; border:1px solid #aaa; vertical-align:middle;"></span> <span class="muted">Menos</span>';
  html += '<span style="display:inline-block; width:16px; height:12px; background:#A8A8A8; border:1px solid #aaa; vertical-align:middle;"></span>';
  html += '<span style="display:inline-block; width:16px; height:12px; background:#6B6B6B; border:1px solid #aaa; vertical-align:middle;"></span> <span class="muted">Más</span>';
  html += '<span style="margin-left:8px;">☐ = Pendiente</span>';
  html += '<span style="color:#558B2F; font-weight:bold;">☑ = Completado</span>';
  html += '</div>';

  container.innerHTML = html;
}

// ========================= NAVEGADOR DE SECTORES =========================
async function loadSectoresNav() {
  const container = document.getElementById('sectoresNavContainer');
  const proy = document.getElementById('navProyectoFilter').value;
  if (!proy) {
    container.innerHTML = '<div class="muted">Selecciona un proyecto para explorar sus sectores constructivos</div>';
    return;
  }

  container.innerHTML = '<div class="muted">Cargando navegador...</div>';
  const data = await apiGet('/proyectos/' + encodeURIComponent(proy) + '/sectores-nav');
  if (!data || !data.sectores || data.sectores.length === 0) {
    container.innerHTML = '<div class="muted">Sin datos de sectores para este proyecto</div>';
    return;
  }

  const sectores = data.sectores;

  // Sector color map
  const sectorColors = { 'FUND': '#795548', 'ELEV': '#8BC34A', 'LCIELO': '#03A9F4', 'VCIELO': '#FF9800' };

  let html = '';
  sectores.forEach(s => {
    const sc = sectorColors[s.sector] || '#9E9E9E';
    html += '<div class="nav-sector" style="margin-bottom:6px;">';
    html += '<div class="nav-sector-header" onclick="this.parentElement.classList.toggle(\'open\')" style="cursor:pointer; padding:8px 10px; background:#f5f5f5; border-left:4px solid ' + sc + '; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">';
    html += '<div><span style="font-weight:700; font-size:13px; color:' + sc + ';">' + (s.sector || '?') + '</span>';
    html += ' <span class="muted" style="font-size:11px;">' + s.pisos.length + ' pisos</span></div>';
    html += '<div style="text-align:right; font-size:11px;">';
    html += '<span style="font-weight:600;">' + Math.round(s.kilos).toLocaleString() + ' kg</span>';
    html += ' <span class="muted">' + s.barras.toLocaleString() + ' bar</span>';
    html += ' <span style="margin-left:4px; font-size:9px; color:#999;">&#9660;</span></div>';
    html += '</div>';
    html += '<div class="nav-sector-body" style="display:none; padding-left:12px;">';

    s.pisos.forEach(p => {
      html += '<div class="nav-piso" style="margin-top:4px;">';
      html += '<div class="nav-piso-header" onclick="this.parentElement.classList.toggle(\'open\')" style="cursor:pointer; padding:5px 8px; background:#fafafa; border-radius:3px; display:flex; justify-content:space-between; align-items:center; font-size:12px;">';
      html += '<div><span style="font-weight:600;">' + (p.piso || '?') + '</span>';
      html += ' <span class="muted" style="font-size:10px;">' + p.ciclos.length + ' ciclos</span></div>';
      html += '<div style="text-align:right;">';
      html += '<span style="font-weight:500;">' + Math.round(p.kilos).toLocaleString() + ' kg</span>';
      html += ' <span class="muted">' + p.barras.toLocaleString() + ' bar</span>';
      html += ' <span style="margin-left:3px; font-size:8px; color:#999;">&#9660;</span></div>';
      html += '</div>';
      html += '<div class="nav-piso-body" style="display:none; padding-left:10px;">';

      p.ciclos.forEach(c => {
        const dp = c.diam_prom ? c.diam_prom.toFixed(1) : '—';
        html += '<div style="padding:4px 8px; margin-top:2px; background:#fff; border:1px solid #eee; border-radius:3px; font-size:11px; display:flex; justify-content:space-between; align-items:center;">';
        html += '<span style="font-weight:500;">' + (c.ciclo || '?') + '</span>';
        html += '<div style="display:flex; gap:10px; align-items:center;">';
        html += '<span title="Barras">' + c.barras.toLocaleString() + ' bar</span>';
        html += '<span title="Kilos" style="font-weight:600;">' + Math.round(c.kilos).toLocaleString() + ' kg</span>';
        html += '<span title="Ejes distintos" style="color:#666;">' + c.ejes + ' ejes</span>';
        html += '<span title="Diámetro promedio ponderado" style="color:' + sc + '; font-weight:500;">&#x2300; ' + dp + ' mm</span>';
        html += '</div></div>';
      });

      html += '</div></div>';
    });

    html += '</div></div>';
  });

  // Summary bar
  const totalBarras = sectores.reduce((a, s) => a + s.barras, 0);
  const totalKilos = sectores.reduce((a, s) => a + s.kilos, 0);
  const summary = '<div style="margin-bottom:8px; padding:6px 10px; background:#e8f5e9; border-radius:4px; font-size:12px; display:flex; gap:16px;">' +
    '<span><b>' + sectores.length + '</b> sectores</span>' +
    '<span><b>' + totalBarras.toLocaleString() + '</b> barras</span>' +
    '<span><b>' + Math.round(totalKilos).toLocaleString() + '</b> kg</span>' +
    '</div>';

  container.innerHTML = summary + html;
}
