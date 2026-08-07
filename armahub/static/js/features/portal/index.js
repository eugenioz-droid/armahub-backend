/**
 * ArmaHub — Portal Feature (Metrics)
 * Metrics tab, Mi Actividad (Cubicador dashboard), Landing Indicadores (Hub Screen).
 */

// ========================= METRICS =========================
let _mensualChart = null;
let _top15Chart = null;
// M1.9: el gráfico de cubicadores del Hub es el Panel de Cubicación compartido
// (shared/panel_cubicacion.js) con origen=todos (CSV + creados). Lupa = modal grande.
var _hubPanelCub = null;
var _hubPanelCubGrande = null;
let _inicioFechaDesde = '';
let _inicioFechaHasta = '';
let _mensualAnio = new Date().getFullYear();

var _metricsColors = ['#2e7d32','#1565C0','#ff9800','#e53935','#7B1FA2','#00897B','#795548','#607D8B','#F44336','#009688','#3F51B5','#CDDC39','#8D6E63','#00BCD4','#E91E63'];

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

  document.getElementById('fechaDesde').value = _inicioFechaDesde;
  document.getElementById('fechaHasta').value = _inicioFechaHasta;

  document.querySelectorAll('.btn-periodo').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector('.btn-periodo[data-range="' + range + '"]');
  if (activeBtn) activeBtn.classList.add('active');

  const label = document.getElementById('dateRangeLabel');
  if (_inicioFechaDesde || _inicioFechaHasta) {
    label.textContent = (_inicioFechaDesde || '...') + ' → ' + (_inicioFechaHasta || '...');
  } else {
    label.textContent = '';
  }

  loadInicio();
}

window.cambiarAnioMensual = function(delta) {
  _mensualAnio += delta;
  document.getElementById('mensualAnioLabel').textContent = _mensualAnio;
  loadMensualChart();
};

async function loadInicio() {
  const dp = _dateParams();
  const url = '/stats' + (dp ? '?' + dp : '');
  let data;
  try {
    data = await apiGet(url);
  } catch(e) { console.error('loadInicio error:', e); return; }
  if (!data) return;

  // KPI cards
  var fmt = function(v) { return v ? v.toLocaleString('es-CL') : '—'; };
  document.getElementById('kpiKilos').textContent = Math.round(data.total_kilos).toLocaleString('es-CL') + ' kg';
  document.getElementById('kpiDiam').textContent = data.diam_promedio ? data.diam_promedio.toFixed(1) + ' mm' : '—';
  document.getElementById('kpiBarras').textContent = fmt(data.total_barras);
  document.getElementById('kpiItems').textContent = fmt(data.total_items);
  document.getElementById('kpiPPB').textContent = data.ppb ? data.ppb.toFixed(2) + ' kg' : '—';
  document.getElementById('kpiPPI').textContent = data.ppi ? data.ppi.toFixed(2) + ' kg' : '—';
  document.getElementById('kpiCargas').textContent = fmt(data.total_cargas);
  document.getElementById('kpiKgCarga').textContent = data.kg_por_carga ? Math.round(data.kg_por_carga).toLocaleString('es-CL') : '—';
  document.getElementById('kpiProyectos').textContent = fmt(data.total_proyectos);

  if (data.ultima_carga) {
    var d = new Date(data.ultima_carga);
    document.getElementById('kpiUltimaCarga').textContent = d.toLocaleDateString('es-CL');
  } else {
    document.getElementById('kpiUltimaCarga').textContent = '—';
  }

  // Top 15 stacked horizontal bar
  renderTop15Chart(data.proyectos || []);

  // Load cubicadores chart (M1.9: Panel de Cubicación compartido)
  hubCargarPanelCub();

  // Load monthly chart
  document.getElementById('mensualAnioLabel').textContent = _mensualAnio;
  loadMensualChart();
}

function renderTop15Chart(proyectos) {
  var top = proyectos.slice(0, 15);
  var labels = top.map(function(p) {
    var n = p.nombre || p.id_proyecto;
    return n.length > 25 ? n.substring(0, 22) + '...' : n;
  });
  var cargado = top.map(function(p) {
    var exp = Math.min(p.kilos_exportados || 0, p.kilos || 0);
    return Math.round((p.kilos - exp) / 1000 * 100) / 100;
  });
  var exportado = top.map(function(p) {
    return Math.round(Math.min(p.kilos_exportados || 0, p.kilos || 0) / 1000 * 100) / 100;
  });
  var totales = top.map(function(p) { return (p.kilos / 1000).toFixed(2); });
  var totalGeneral = proyectos.reduce(function(s, p) { return s + (p.kilos || 0); }, 0);

  document.getElementById('top15Total').textContent = 'Total: ' + (totalGeneral / 1000).toFixed(1) + ' Tn (' + proyectos.length + ' proyectos)';

  _top15Chart = replaceChart(_top15Chart, document.getElementById('top15Chart'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: 'Cargado', data: cargado, backgroundColor: '#B0BEC5', borderRadius: 2 },
        { label: 'Exportado', data: exportado, backgroundColor: '#66BB6A', borderRadius: 2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterBody: function(ctx) {
              var idx = ctx[0].dataIndex;
              return 'Total: ' + totales[idx] + ' Tn';
            }
          }
        },
        datalabels: {
          display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; },
          color: '#fff',
          font: { size: 9, weight: 'bold' },
          anchor: 'center',
          align: 'center',
          formatter: function(v) { return v.toFixed(1); }
        }
      },
      scales: {
        x: { stacked: true, ticks: { font: { size: 9 }, callback: function(v) { return v + ' Tn'; } } },
        y: { stacked: true, ticks: { font: { size: 10 } } }
      }
    },
    plugins: [ChartDataLabels]
  });
}

// M1.9 — Panel de Cubicación en el Hub: alcance = TODAS las obras y TODOS los
// orígenes (CSV + creados a mano); solo excluye borradores (regla global).
function _hubPanelOpts(altura) {
  return {
    altura: altura,
    getParams: function() { return { origen: 'todos' }; },
    getAlcance: function() { return { texto: ' · todas las obras (CSV + creados)', resaltar: false }; }
  };
}

function hubCargarPanelCub() {
  if (!_hubPanelCub) {
    var el = document.getElementById('hubPanelCub');
    if (!el || !window.PanelCubicacion) return;
    _hubPanelCub = PanelCubicacion.crear(el, _hubPanelOpts(300));
    if (!_hubPanelCub) return;
  }
  _hubPanelCub.recargar();
}

window.hubAgrandarPanel = function() {
  var m = document.getElementById('hubPanelModal');
  if (!m) return;
  m.style.display = 'flex';
  // El panel se crea/recarga en el SIGUIENTE frame: así el modal ya tiene ancho real
  // y el header (toggle período + checkbox año) + el canvas se miden bien (si se crea
  // con el modal recién mostrado, el ancho es 0 y los controles/gráfico salen colapsados).
  requestAnimationFrame(function() {
    if (!_hubPanelCubGrande) {
      var el = document.getElementById('hubPanelCubGrande');
      if (el && window.PanelCubicacion) _hubPanelCubGrande = PanelCubicacion.crear(el, _hubPanelOpts(430));
    }
    if (_hubPanelCubGrande) _hubPanelCubGrande.recargar();
  });
};

window.hubCerrarPanelGrande = function() {
  var m = document.getElementById('hubPanelModal');
  if (m) m.style.display = 'none';
};

async function loadMensualChart() {
  var data = await apiGet('/stats/cubicacion-mensual?anio=' + _mensualAnio);
  if (!data) return;

  var datasets = (data.cubicadores || []).map(function(c, idx) {
    var at = c.nombre.indexOf('@');
    var label = at > 0 ? c.nombre.substring(0, at) : c.nombre;
    return {
      label: label,
      data: c.datos,
      backgroundColor: _metricsColors[idx % _metricsColors.length],
      borderRadius: 2
    };
  });

  _mensualChart = replaceChart(_mensualChart, document.getElementById('mensualChart'), {
    type: 'bar',
    data: { labels: data.meses || [], datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 8, usePointStyle: true, pointStyle: 'rect' } }
      },
      scales: {
        x: { stacked: false, ticks: { font: { size: 10 } } },
        y: {
          beginAtZero: true,
          ticks: { font: { size: 9 }, callback: function(v) { return v + ' Tn'; } }
        }
      }
    }
  });
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
var _hubChartReclamos = null;
var _hubLandingData = null;   // última respuesta de /landing/indicadores
var _hubCubColors = ['#2e7d32','#1565C0','#ff9800','#e53935','#7B1FA2','#00897B','#795548','#607D8B','#F44336','#009688'];

async function loadLandingIndicadores() {
  var data = await apiGet('/landing/indicadores');
  if (!data) return;
  _hubLandingData = data;

  var diasLabels = ['Lun','Mar','Mie','Jue','Vie','Sab','Dom'];

  // --- Alertas reclamos ---
  var alertaWrap = document.getElementById('hubAlertaReclamos');
  var alertas = data.alertas || {};
  if (alertaWrap) {
    // Always show for roles that have alerts (admin, admin_calidad, usc, cubicador)
    if (typeof alertas.total_abiertos !== 'undefined') {
      alertaWrap.style.display = '';
      document.getElementById('hubAlertaTexto').textContent = alertas.total_abiertos + ' reclamo(s) en total';
      // Ordered badges by estado
      var estadoOrder = ['abierto','en_analisis','en_revision','validacion','cerrado','rechazado'];
      var estadoLabels = {abierto:'Abiertos', en_analisis:'En análisis', en_revision:'En revisión', validacion:'En validación', cerrado:'Cerrados', rechazado:'Rechazados'};
      var estadoColors = {abierto:'#e53935', en_analisis:'#ff9800', en_revision:'#1976d2', validacion:'#7B1FA2', cerrado:'#4CAF50', rechazado:'#9E9E9E'};
      var countMap = {};
      (alertas.por_estado || []).forEach(function(a) { countMap[a.estado] = a.count; });
      var badgeHtml = '';
      estadoOrder.forEach(function(est) {
        var c = countMap[est] || 0;
        if (c === 0) return;
        var color = estadoColors[est] || '#999';
        var label = estadoLabels[est] || est;
        badgeHtml += '<span style="display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600; color:#fff; background:' + color + ';">'
                   + label + ' <span style="background:rgba(255,255,255,0.3); padding:1px 5px; border-radius:8px; font-size:11px;">' + c + '</span></span>';
      });
      document.getElementById('hubAlertaDetalle').innerHTML = badgeHtml || '<span style="font-size:11px; color:#999;">Sin reclamos</span>';
    } else {
      alertaWrap.style.display = 'none';
    }
  }

  // --- Cubicado (Panel de Cubicación compartido, TODO CSV+manual con todos los controles) ---
  var cubWrap = document.getElementById('hubCubicadoWrap');
  if (cubWrap) {
    cubWrap.style.display = '';
    hubScreenCargarPanelCub();
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

// ── Panel de Cubicación en la pantalla Hub (Indicadores) — MISMO componente que el editor/Metrics.
// TODO (CSV + manual) de todas las obras, con todos los controles (año + S/M·S/M·D/A). La lupa
// abre el MISMO componente agrandado. Antes había un gráfico propio "cubicado semana/año" (sin
// controles); se reemplazó para que el Panel sea uno solo en toda la plataforma.
var _hubScreenPanelCub = null;
var _hubScreenPanelCubGrande = null;
function _hubScreenPanelOpts(altura) {
  return {
    altura: altura,
    getParams: function() { return { origen: 'todos' }; },
    getAlcance: function() { return { texto: ' · todas las obras (CSV + creados)', resaltar: false }; }
  };
}
function hubScreenCargarPanelCub() {
  if (!_hubScreenPanelCub) {
    var el = document.getElementById('hubScreenPanelCub');
    if (!el || !window.PanelCubicacion) return;
    _hubScreenPanelCub = PanelCubicacion.crear(el, _hubScreenPanelOpts(260));
    if (!_hubScreenPanelCub) return;
  }
  _hubScreenPanelCub.recargar();
}
window.hubScreenAgrandarPanel = function() {
  var m = document.getElementById('hubCubicadoMesModal');
  if (!m) return;
  m.style.display = 'flex';
  // Crear/recargar en el siguiente frame: el modal ya tiene ancho real → controles y gráfico bien.
  requestAnimationFrame(function() {
    if (!_hubScreenPanelCubGrande) {
      var el = document.getElementById('hubScreenPanelCubGrande');
      if (el && window.PanelCubicacion) _hubScreenPanelCubGrande = PanelCubicacion.crear(el, _hubScreenPanelOpts(440));
    }
    if (_hubScreenPanelCubGrande) _hubScreenPanelCubGrande.recargar();
  });
};
window.hubScreenCerrarPanel = function() {
  var m = document.getElementById('hubCubicadoMesModal');
  if (m) m.style.display = 'none';
};
// Compatibilidad: por si algún onclick viejo quedó cacheado, no romper.
window.abrirCubicadoMes = window.hubScreenAgrandarPanel;
window.cerrarCubicadoMes = window.hubScreenCerrarPanel;
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { var m = document.getElementById('hubCubicadoMesModal'); if (m && m.style.display !== 'none') window.hubScreenCerrarPanel(); }
});

// Auto-load indicators if hub is already visible when portal script loads
(function() {
  var hub = document.getElementById('hubScreen');
  if (hub && hub.style.display !== 'none' && typeof window.currentRole !== 'undefined') {
    loadLandingIndicadores();
  }
})();
