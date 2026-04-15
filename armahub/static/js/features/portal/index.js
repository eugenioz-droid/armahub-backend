/**
 * ArmaHub — Portal Feature
 * Inicio (Landing), Mi Actividad (Cubicador dashboard), Landing Indicadores (Hub Screen).
 * Extracted from app.js in E.3.
 */

// ========================= INICIO (Landing) =========================
let inicioChart = null;
let timelineChart = null;
let _inicioFechaDesde = '';
let _inicioFechaHasta = '';
let _inicioAgrupacion = 'dia';

function _dateParams() {
  const params = new URLSearchParams();
  if (_inicioFechaDesde) params.set('fecha_desde', _inicioFechaDesde);
  if (_inicioFechaHasta) params.set('fecha_hasta', _inicioFechaHasta);
  return params.toString();
}

function setDateRange(range) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  if (range === 'todo') {
    _inicioFechaDesde = '';
    _inicioFechaHasta = '';
  } else if (range === 'semana') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    _inicioFechaDesde = d.toISOString().slice(0, 10);
    _inicioFechaHasta = today;
  } else if (range === 'mes') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    _inicioFechaDesde = d.toISOString().slice(0, 10);
    _inicioFechaHasta = today;
  } else if (range === 'anio') {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - 1);
    _inicioFechaDesde = d.toISOString().slice(0, 10);
    _inicioFechaHasta = today;
  } else if (range === 'custom') {
    _inicioFechaDesde = document.getElementById('fechaDesde').value || '';
    _inicioFechaHasta = document.getElementById('fechaHasta').value || '';
  }

  // Update date inputs
  document.getElementById('fechaDesde').value = _inicioFechaDesde;
  document.getElementById('fechaHasta').value = _inicioFechaHasta;

  // Update active button
  document.querySelectorAll('.btn-periodo').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector('.btn-periodo[data-range="' + range + '"]');
  if (activeBtn) activeBtn.classList.add('active');

  // Update label
  const label = document.getElementById('dateRangeLabel');
  if (_inicioFechaDesde || _inicioFechaHasta) {
    label.textContent = (_inicioFechaDesde || '...') + ' → ' + (_inicioFechaHasta || '...');
  } else {
    label.textContent = '';
  }

  loadInicio();
}

function setAgrupacion(agrup) {
  _inicioAgrupacion = agrup;
  document.querySelectorAll('.btn-agrupacion').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector('.btn-agrupacion[data-agrup="' + agrup + '"]');
  if (activeBtn) activeBtn.classList.add('active');
  loadTimeline();
}

async function loadInicio() {
  const dp = _dateParams();
  const url = '/stats' + (dp ? '?' + dp : '');
  let data;
  try {
    data = await apiGet(url);
  } catch(e) { console.error('loadInicio error:', e); return; }
  if (!data) return;

  document.getElementById('kpiProyectos').textContent = data.total_proyectos;
  document.getElementById('kpiBarras').textContent = data.total_barras.toLocaleString();
  document.getElementById('kpiKilos').textContent = Math.round(data.total_kilos).toLocaleString() + ' kg';

  // KPIs avanzados
  document.getElementById('kpiPPB').textContent = data.ppb ? data.ppb.toFixed(2) + ' kg' : '—';
  document.getElementById('kpiPPI').textContent = data.ppi ? data.ppi.toFixed(2) + ' kg' : '—';
  document.getElementById('kpiDiam').textContent = data.diam_promedio ? data.diam_promedio.toFixed(1) + ' mm' : '—';
  document.getElementById('kpiItems').textContent = data.total_items ? data.total_items.toLocaleString() : '—';

  if (data.ultima_carga) {
    const d = new Date(data.ultima_carga);
    document.getElementById('kpiUltimaCarga').textContent = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});
  } else {
    document.getElementById('kpiUltimaCarga').textContent = 'Sin cargas';
  }

  // Top 5 chart
  const top5 = data.top5 || [];
  const labels = top5.map(p => p.nombre);
  const values = top5.map(p => p.kilos);
  const ctx = document.getElementById('inicioChart').getContext('2d');
  if (inicioChart) inicioChart.destroy();
  inicioChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Kilos', data: values, backgroundColor: '#8BC34A', borderRadius: 4 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: v => v.toLocaleString() + ' kg' } } }
    }
  });

  // Project mini-cards
  const list = document.getElementById('proyectosMiniList');
  if (!data.proyectos || data.proyectos.length === 0) {
    list.innerHTML = '<div class="muted" style="padding:12px;">No hay proyectos cargados</div>';
  } else {
    list.innerHTML = data.proyectos.map(p => `
      <div class="proyecto-mini">
        <span class="pm-name">${p.nombre}</span>
        <span class="pm-kilos">${Math.round(p.kilos).toLocaleString()} kg</span>
      </div>
    `).join('');
  }

  // Load timeline and cubicadores in parallel
  loadTimeline();
  loadCubicadores();
}

async function loadTimeline() {
  const dp = _dateParams();
  const params = new URLSearchParams(dp);
  params.set('agrupacion', _inicioAgrupacion);
  const data = await apiGet('/stats/timeline?' + params.toString());
  if (!data || !data.timeline) return;

  const items = data.timeline;
  const labels = items.map(i => i.periodo);
  const kilosData = items.map(i => i.kilos);
  const barrasData = items.map(i => i.barras);

  timelineChart = replaceChart(timelineChart, document.getElementById('timelineChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Kilos',
          data: kilosData,
          backgroundColor: '#8BC34A',
          borderRadius: 3,
          yAxisID: 'y'
        },
        {
          label: 'Barras',
          data: barrasData,
          type: 'line',
          borderColor: '#558B2F',
          backgroundColor: 'rgba(85, 139, 47, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
      scales: {
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Kilos', font: { size: 11 } },
          ticks: { callback: chartTickNumber }
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'Barras', font: { size: 11 } },
          grid: { drawOnChartArea: false },
          ticks: { callback: chartTickNumber }
        },
        x: { ticks: { font: { size: 10 }, maxRotation: 45 } }
      }
    }
  });
}

async function loadCubicadores() {
  const dp = _dateParams();
  const url = '/stats/cubicadores' + (dp ? '?' + dp : '');
  const data = await apiGet(url);
  if (!data || !data.cubicadores) return;

  const tbody = document.getElementById('cubicadoresBody');
  if (data.cubicadores.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Sin actividad en este período</td></tr>';
    return;
  }

  tbody.innerHTML = data.cubicadores.map(c => {
    const fecha = c.ultima_actividad ? new Date(c.ultima_actividad).toLocaleDateString('es-CL') : '—';
    return '<tr>' +
      '<td style="font-weight:500;">' + (c.email || '—') + '</td>' +
      '<td style="text-align:right;">' + (c.barras || 0).toLocaleString() + '</td>' +
      '<td style="text-align:right;">' + Math.round(c.kilos || 0).toLocaleString() + ' kg</td>' +
      '<td style="text-align:right;">' + (c.cargas || 0) + '</td>' +
      '<td style="text-align:right;">' + (c.proyectos || 0) + '</td>' +
      '<td style="text-align:right; font-size:11px; color:#666;">' + fecha + '</td>' +
      '</tr>';
  }).join('');
}

// ========================= MI ACTIVIDAD (Cubicador dashboard) =========================
let miActividadChart = null;
let _miActividadData = null;
let _kpiPeriod = 'day';

function toggleKpiPeriod(period) {
  _kpiPeriod = period;
  // Update button styles
  document.querySelectorAll('.kpi-toggle').forEach(function(btn) {
    if (btn.dataset.period === period) {
      btn.style.background = '#8BC34A';
      btn.style.color = 'white';
    } else {
      btn.style.background = '';
      btn.style.color = '';
    }
  });
  // Re-render KPIs with cached data
  if (_miActividadData) renderKpis(_miActividadData);
}

function renderKpis(data) {
  var el = function(id) { return document.getElementById(id); };
  var barras = 0, kilos = 0, cargas = 0, compText = '', compLabel = 'vs anterior';
  
  if (_kpiPeriod === 'day') {
    barras = data.hoy.barras;
    kilos = data.hoy.kilos;
    cargas = data.hoy.cargas;
    compLabel = 'Hoy';
    compText = data.hoy.fecha ? data.hoy.fecha.substring(5, 10).replace('-', '/') : '';
  } else if (_kpiPeriod === 'week') {
    barras = data.semana_actual.barras;
    kilos = data.semana_actual.kilos;
    cargas = data.semana_actual.cargas;
    compLabel = 'vs sem. anterior';
    var prev = data.semana_anterior.kilos;
    var curr = data.semana_actual.kilos;
    if (prev > 0) {
      var pct = Math.round(((curr - prev) / prev) * 100);
      if (pct >= 0) {
        compText = '▲ ' + pct + '%';
      } else {
        compText = '▼ ' + Math.abs(pct) + '%';
      }
    } else {
      compText = '-';
    }
  } else if (_kpiPeriod === 'month') {
    // Sum all days in current month
    var dias = data.dias || [];
    var now = new Date();
    var currentMonth = (now.getMonth() + 1).toString().padStart(2, '0');
    var currentYear = now.getFullYear().toString();
    dias.forEach(function(d) {
      if (d.dia && d.dia.startsWith(currentYear + '-' + currentMonth)) {
        barras += d.barras;
        kilos += d.kilos;
        cargas += d.cargas;
      }
    });
    compLabel = 'Mes actual';
    compText = currentMonth + '/' + currentYear;
  }
  
  var barrasEl = el('maBarras');
  var kilosEl = el('maKilos');
  var cargasEl = el('maCargas');
  var compEl = el('maComparacion');
  var compLabelEl = el('maCompLabel');
  
  if (barrasEl) barrasEl.textContent = barras.toLocaleString();
  if (kilosEl) kilosEl.textContent = Math.round(kilos).toLocaleString();
  if (cargasEl) cargasEl.textContent = cargas;
  if (compEl) compEl.textContent = compText;
  if (compLabelEl) compLabelEl.textContent = compLabel;
}

async function loadMiActividad() {
  let data;
  try {
    data = await apiGet('/stats/mi-actividad');
  } catch(e) { console.error('loadMiActividad error:', e); return; }
  if (!data) return;
  
  _miActividadData = data;
  renderKpis(data);

  // Mini-chart: last 14 days
  const dias = data.dias || [];
  const labels = dias.map(d => {
    const parts = d.dia.split('-');
    return parts[2] + '/' + parts[1];
  });
  const kilosData = dias.map(d => d.kilos);
  const barrasData = dias.map(d => d.barras);

  // Highlight today (last bar)
  const bgColors = dias.map((d, i) => i === dias.length - 1 ? '#558B2F' : '#8BC34A');

  const chartEl = document.getElementById('miActividadChart');
  if (!chartEl) return;
  miActividadChart = replaceChart(miActividadChart, chartEl, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Kilos',
          data: kilosData,
          backgroundColor: bgColors,
          borderRadius: 2,
          yAxisID: 'y'
        },
        {
          label: 'Barras',
          data: barrasData,
          type: 'line',
          borderColor: '#33691E',
          backgroundColor: 'rgba(51,105,30,0.08)',
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          borderWidth: 1.5,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 10 }, boxWidth: 12 } }
      },
      scales: {
        y: {
          type: 'linear', position: 'left',
          title: { display: false },
          ticks: { font: { size: 9 }, callback: chartTickNumber },
          grid: { color: '#f0f0f0' }
        },
        y1: {
          type: 'linear', position: 'right',
          title: { display: false },
          grid: { drawOnChartArea: false },
          ticks: { font: { size: 9 }, callback: chartTickNumber }
        },
        x: { ticks: { font: { size: 9 }, maxRotation: 45 } }
      }
    }
  });
}

// ========================= LANDING INDICADORES =========================
var _hubChartCubicado = null;
var _hubChartReclamos = null;
var _hubCubColors = ['#2e7d32','#1565C0','#ff9800','#e53935','#7B1FA2','#00897B','#795548','#607D8B','#F44336','#009688'];

async function loadLandingIndicadores() {
  var data = await apiGet('/landing/indicadores');
  if (!data) return;

  var diasLabels = ['Lun','Mar','Mie','Jue','Vie','Sab','Dom'];

  // --- Alertas reclamos ---
  var alertaWrap = document.getElementById('hubAlertaReclamos');
  var alertas = data.alertas || {};
  if (alertaWrap) {
    // Always show for roles that have alerts (admin, admin2, usc, cubicador)
    if (typeof alertas.total_abiertos !== 'undefined') {
      alertaWrap.style.display = '';
      document.getElementById('hubAlertaTexto').textContent = alertas.total_abiertos + ' reclamo(s) en total';
      var detParts = (alertas.por_estado || []).map(function(a) {
        var labels = {abierto:'Abiertos', en_analisis:'En análisis', accion_correctiva:'Acción correctiva', validacion:'En validación', validado:'Validados', cerrado:'Cerrados', rechazado:'Rechazados'};
        return (labels[a.estado] || a.estado) + ': ' + a.count;
      });
      document.getElementById('hubAlertaDetalle').textContent = detParts.join(' · ') || 'Sin reclamos';
    } else {
      alertaWrap.style.display = 'none';
    }
  }

  // --- Cubicado semana (grouped bar by cubicador) ---
  var cubWrap = document.getElementById('hubCubicadoWrap');
  var cubData = data.cubicado_semana || [];
  if (cubWrap) {
    if (cubData.length > 0) {
      cubWrap.style.display = '';
      var cubDS = cubData.map(function(cub, idx) {
        return {
          label: cub.nombre,
          data: cub.dias,
          backgroundColor: _hubCubColors[idx % _hubCubColors.length],
          borderRadius: 2
        };
      });
      var totalKilos = cubData.reduce(function(sum, c) {
        return sum + c.dias.reduce(function(s, v) { return s + v; }, 0);
      }, 0);
      document.getElementById('hubCubicadoTotal').textContent = 'Total semana: ' + totalKilos.toLocaleString('es-CL', {maximumFractionDigits: 1}) + ' kg';

      _hubChartCubicado = replaceChart(_hubChartCubicado, document.getElementById('hubChartCubicado'), {
        type: 'bar',
        data: { labels: diasLabels, datasets: cubDS },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 8, usePointStyle: true, pointStyle: 'rect' } } },
          scales: {
            y: { beginAtZero: true, ticks: { font: { size: 9 } } },
            x: { ticks: { font: { size: 10 } } }
          }
        }
      });
    } else {
      cubWrap.style.display = 'none';
    }
  }

  // --- Reclamos levantados semana (grouped bar by USC) ---
  var recWrap = document.getElementById('hubReclamosWrap');
  var recData = data.reclamos_semana || [];
  if (recWrap) {
    if (recData.length > 0) {
      recWrap.style.display = '';
      var recDS = recData.map(function(usc, idx) {
        return {
          label: usc.nombre,
          data: usc.dias,
          backgroundColor: _hubCubColors[idx % _hubCubColors.length],
          borderRadius: 2
        };
      });
      var totalRec = recData.reduce(function(sum, u) {
        return sum + u.dias.reduce(function(s, v) { return s + v; }, 0);
      }, 0);
      document.getElementById('hubReclamosTotal').textContent = 'Total semana: ' + totalRec + ' reclamos';

      _hubChartReclamos = replaceChart(_hubChartReclamos, document.getElementById('hubChartReclamos'), {
        type: 'bar',
        data: { labels: diasLabels, datasets: recDS },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 8, usePointStyle: true, pointStyle: 'rect' } } },
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 } } },
            x: { ticks: { font: { size: 10 } } }
          }
        }
      });
    } else {
      recWrap.style.display = 'none';
    }
  }
}

// Auto-load indicators if hub is already visible when portal script loads
(function() {
  var hub = document.getElementById('hubScreen');
  if (hub && hub.style.display !== 'none' && typeof window.currentRole !== 'undefined') {
    loadLandingIndicadores();
  }
})();
