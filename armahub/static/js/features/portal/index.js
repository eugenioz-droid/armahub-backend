/**
 * ArmaHub — Portal Feature (Metrics)
 * Metrics tab, Mi Actividad (Cubicador dashboard), Landing Indicadores (Hub Screen).
 */

// ========================= METRICS =========================
let _mensualChart = null;
let _top15Chart = null;
let _cubChart = null;
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

  // Load cubicadores chart
  loadCubicadoresChart();

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

async function loadCubicadoresChart() {
  var dp = _dateParams();
  var url = '/stats/cubicadores' + (dp ? '?' + dp : '');
  var data = await apiGet(url);
  if (!data || !data.cubicadores) return;

  var cubicadores = data.cubicadores;
  var labels = cubicadores.map(function(c) {
    var email = c.email || '—';
    var at = email.indexOf('@');
    return at > 0 ? email.substring(0, at) : email;
  });
  var cargado = cubicadores.map(function(c) {
    var exp = Math.min(c.kilos_exportados || 0, c.kilos || 0);
    return Math.round((c.kilos - exp) / 1000 * 100) / 100;
  });
  var exportado = cubicadores.map(function(c) {
    return Math.round(Math.min(c.kilos_exportados || 0, c.kilos || 0) / 1000 * 100) / 100;
  });
  var totalGeneral = cubicadores.reduce(function(s, c) { return s + (c.kilos || 0); }, 0);

  document.getElementById('cubTotal').textContent = 'Total: ' + (totalGeneral / 1000).toFixed(1) + ' Tn (' + cubicadores.length + ' cubicadores)';

  _cubChart = replaceChart(_cubChart, document.getElementById('cubChart'), {
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
var _hubChartCubicado = null;
var _hubChartReclamos = null;
var _hubChartCubicadoMes = null;
var _hubLandingData = null;   // última respuesta de /landing/indicadores (la usa el modal del mes)
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
      // Total por usuario (suma de sus días) + total general de la semana.
      var totalesUsuario = cubData.map(function(c, idx) {
        return { nombre: c.nombre, kg: c.dias.reduce(function(s, v) { return s + v; }, 0),
                 color: _hubCubColors[idx % _hubCubColors.length] };
      }).sort(function(a, b) { return b.kg - a.kg; });   // de mayor a menor
      var totalKilos = totalesUsuario.reduce(function(sum, u) { return sum + u.kg; }, 0);
      var _fmtKg = function(v) { return v.toLocaleString('es-CL', {maximumFractionDigits: 1}); };

      document.getElementById('hubCubicadoTotal').textContent = 'Total semana: ' + _fmtKg(totalKilos) + ' kg';
      // Tabla de totales por usuario (en columna, ordenada), cada uno con su color del gráfico.
      var porUsr = document.getElementById('hubCubicadoPorUsuario');
      var _escTxt = function(s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };
      if (porUsr) {
        // Nombre + total PEGADOS a la izquierda (no separados a los extremos): color · nombre · kg.
        porUsr.innerHTML = totalesUsuario.map(function(u) {
          return '<div style="display:flex; align-items:baseline; gap:6px; font-size:11px; padding:2px 0;">' +
                 '<span style="width:10px; height:10px; border-radius:2px; background:' + u.color + '; flex-shrink:0; align-self:center;"></span>' +
                 '<span style="color:#555;">' + _escTxt(u.nombre) + ':</span>' +
                 '<span style="color:#333; font-weight:600;">' + _fmtKg(u.kg) + ' kg</span>' +
                 '</div>';
        }).join('');
      }

      // Total por DÍA (suma de todos los cubicadores ese día) → va como 2a línea de la etiqueta del
      // eje X (bajo "Lun", "Mar"…). Así el total del día NO se dibuja sobre una barra (antes flotaba
      // sobre la barra más alta y parecía SU valor: p.ej. el total del lunes 15.761 sobre la barra
      // de Nicolás que en realidad valía 9.959). Etiqueta multilínea solo para este gráfico.
      var totalesDia = diasLabels.map(function(_, i) {
        return cubData.reduce(function(s, c) { return s + (c.dias[i] || 0); }, 0);
      });
      var cubLabels = diasLabels.map(function(dia, i) {
        return totalesDia[i] > 0 ? [dia, _fmtKg(totalesDia[i]) + ' kg'] : dia;
      });
      // Formato CORTO solo para el número DENTRO de la barra (poco espacio): 9,9k · 1,2M · 850.
      // El resto (leyenda, total semana, total día) queda en kg completos.
      var _fmtCorto = function(v) {
        if (!v) return '';
        if (v >= 1000000) return (v / 1000000).toLocaleString('es-CL', {maximumFractionDigits: 1}) + 'M';
        if (v >= 1000) return (v / 1000).toLocaleString('es-CL', {maximumFractionDigits: 1}) + 'k';
        return v.toLocaleString('es-CL', {maximumFractionDigits: 0});
      };

      _hubChartCubicado = replaceChart(_hubChartCubicado, document.getElementById('hubChartCubicado'), {
        type: 'bar',
        data: { labels: cubLabels, datasets: cubDS },
        options: {
          responsive: true, maintainAspectRatio: false,
          layout: { padding: { top: 16 } },   // aire arriba para los números sobre las barras
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 8, usePointStyle: true, pointStyle: 'rect' } },
            // Valor de CADA barra, en formato corto (9,9k) encima de su propia barra. El total del
            // día ya no va aquí (pasó a la 2a línea del eje X): así el número sobre la barra es SIEMPRE
            // el valor de esa barra, sin ambigüedad. Solo se dibuja si la barra tiene valor ese día.
            datalabels: {
              display: function(ctx) { return (ctx.chart.data.datasets[ctx.datasetIndex].data[ctx.dataIndex] || 0) > 0; },
              anchor: 'end', align: 'end', offset: 1, clamp: true, clip: false,
              color: '#37474f', font: { size: 8, weight: 'bold' },
              formatter: function(v) { return _fmtCorto(v); }
            }
          },
          scales: {
            y: { beginAtZero: true, ticks: { font: { size: 9 } } },
            // Eje X con etiqueta de 2 líneas (día + total del día en kg). Fuente 9 para que ambas
            // líneas entren sin apretarse; el total del día en color más tenue lo da Chart.js igual
            // que el día (mismo tick), así que se distingue por estar en la línea de abajo.
            x: { ticks: { font: { size: 9 }, color: '#546e7a' } }
          }
        },
        plugins: [ChartDataLabels]
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

// ── ZOOM: Cubicado del AÑO (modal) ─────────────────────────────────────────────────────────────
// Reusa la data ya cargada (_hubLandingData.cubicado_anio): línea de tiempo mixta del año en curso.
// Meses cerrados = 1 barra por mes (Ene…mes anterior); mes actual = desglosado por semana con fechas
// reales (1-7 ago…). Mismo estilo del gráfico semanal (valor corto en barra, total del período bajo
// el eje). No pega al backend de nuevo: la data viene con el landing. Una línea separa histórico
// mensual de las semanas del mes en curso (corte_semanas).
window.abrirCubicadoMes = function() {
  var modal = document.getElementById('hubCubicadoMesModal');
  var data = _hubLandingData || {};
  var anioData = data.cubicado_anio || {};
  var labelsBase = anioData.labels || [];
  var cubs = anioData.cubicadores || [];
  if (!modal) return;
  if (!labelsBase.length || !cubs.length) { alert('Aún no hay cubicación registrada este año.'); return; }

  var _fmtKg = function(v) { return v.toLocaleString('es-CL', { maximumFractionDigits: 1 }); };
  var _fmtCorto = function(v) {
    if (!v) return '';
    if (v >= 1000000) return (v / 1000000).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + 'M';
    if (v >= 1000) return (v / 1000).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + 'k';
    return v.toLocaleString('es-CL', { maximumFractionDigits: 0 });
  };

  var n = labelsBase.length;
  var anioDS = cubs.map(function(c, idx) {
    return { label: c.nombre, data: (c.valores || []).slice(0, n),
             backgroundColor: _hubCubColors[idx % _hubCubColors.length], borderRadius: 2 };
  });
  // Total por período → 2a línea de la etiqueta del eje X. Y totales por usuario + total del año.
  var totPer = labelsBase.map(function(_, i) { return cubs.reduce(function(s, c) { return s + ((c.valores || [])[i] || 0); }, 0); });
  var chartLabels = labelsBase.map(function(lbl, i) {
    return totPer[i] > 0 ? [lbl, _fmtKg(totPer[i]) + ' kg'] : lbl;
  });
  var totUsr = cubs.map(function(c, idx) {
    return { nombre: c.nombre, kg: (c.valores || []).reduce(function(s, v) { return s + v; }, 0), color: _hubCubColors[idx % _hubCubColors.length] };
  }).sort(function(a, b) { return b.kg - a.kg; });
  var totAnio = totUsr.reduce(function(s, u) { return s + u.kg; }, 0);

  var tit = document.getElementById('hubCubicadoMesTitulo');
  if (tit) tit.textContent = 'Cubicado del año ' + (anioData.anio || '') + ' (kg)';
  var totEl = document.getElementById('hubCubicadoMesTotal');
  if (totEl) totEl.textContent = 'Total año: ' + _fmtKg(totAnio) + ' kg';
  var porUsr = document.getElementById('hubCubicadoMesPorUsuario');
  if (porUsr) {
    var _esc = function(s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };
    porUsr.innerHTML = totUsr.map(function(u) {
      return '<div style="display:flex; align-items:baseline; gap:6px; font-size:11px; padding:2px 0;">' +
             '<span style="width:10px; height:10px; border-radius:2px; background:' + u.color + '; flex-shrink:0; align-self:center;"></span>' +
             '<span style="color:#555;">' + _esc(u.nombre) + ':</span>' +
             '<span style="color:#333; font-weight:600;">' + _fmtKg(u.kg) + ' kg</span></div>';
    }).join('');
  }

  // Separación visual entre histórico mensual y semanas del mes actual: una línea vertical en x =
  // corte_semanas (frontera). Plugin inline que dibuja la línea después de las barras.
  var corte = anioData.corte_semanas || 0;
  var separadorPlugin = {
    id: 'sepMesSemana',
    afterDatasetsDraw: function(chart) {
      if (corte <= 0 || corte >= n) return;
      var xAxis = chart.scales.x, yAxis = chart.scales.y;
      if (!xAxis || !yAxis) return;
      // La frontera va entre la barra (corte-1) y la barra (corte): punto medio de sus centros.
      var xa = xAxis.getPixelForValue(corte - 1), xb = xAxis.getPixelForValue(corte);
      var x = (xa + xb) / 2;
      var ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(120,120,120,.35)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, yAxis.top); ctx.lineTo(x, yAxis.bottom); ctx.stroke();
      ctx.restore();
    }
  };

  modal.style.display = 'block';
  _hubChartCubicadoMes = replaceChart(_hubChartCubicadoMes, document.getElementById('hubChartCubicadoMes'), {
    type: 'bar',
    data: { labels: chartLabels, datasets: anioDS },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 16 } },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 8, usePointStyle: true, pointStyle: 'rect' } },
        datalabels: {
          display: function(ctx) { return (ctx.chart.data.datasets[ctx.datasetIndex].data[ctx.dataIndex] || 0) > 0; },
          anchor: 'end', align: 'end', offset: 1, clamp: true, clip: false,
          color: '#37474f', font: { size: 9, weight: 'bold' },
          formatter: function(v) { return _fmtCorto(v); }
        }
      },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: 10 } } },
        x: { ticks: { font: { size: 9 }, color: '#546e7a', autoSkip: false, maxRotation: 0 } }
      }
    },
    plugins: [ChartDataLabels, separadorPlugin]
  });
};
window.cerrarCubicadoMes = function() {
  var modal = document.getElementById('hubCubicadoMesModal');
  if (modal) modal.style.display = 'none';
};
// Cerrar el modal del mes con Escape.
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { var m = document.getElementById('hubCubicadoMesModal'); if (m && m.style.display !== 'none') window.cerrarCubicadoMes(); }
});

// Auto-load indicators if hub is already visible when portal script loads
(function() {
  var hub = document.getElementById('hubScreen');
  if (hub && hub.style.display !== 'none' && typeof window.currentRole !== 'undefined') {
    loadLandingIndicadores();
  }
})();
