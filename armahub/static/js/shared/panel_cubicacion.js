// ArmaHub — PANEL DE CUBICACIÓN (componente compartido).
// Gráfico ESTÁNDAR de kilos por cubicador: formato y funcionalidad FIJOS; cada consumidor solo
// cablea la data (endpoint/params) y el alcance del título. Nombre acordado con el usuario:
// "ponme el Panel de Cubicación en X" = crear una instancia de esto con la data de X.
//
// Funcionalidad fija:
//  - Toggle de período S / M·S / M·D / A (semana por día / mes por semana / mes por día / año por mes).
//  - Años como CHECKBOXES (siempre visibles, año en curso por defecto). Marcar VARIOS años totaliza
//    por mes y FUERZA el período A (S/M·S/M·D se deshabilitan: no cuadran por fecha entre años).
//  - Valores estilo Hub: valor corto (9,9k) sobre cada barra (11px; 8px en M·D por sus ~30 barras),
//    total del período bajo el eje X (2a línea), totales por cubicador en columna + total general.
//  - Estado vacío con mensaje (no canvas en blanco). Resalte opcional (título píldora verde + borde)
//    cuando el consumidor lo pide (ej. "dentro de una obra").
//
// Uso:
//   var panel = PanelCubicacion.crear(document.getElementById('miDiv'), {
//     getParams:  function(){ return { proyecto: X }; },            // params extra del fetch (opcional)
//     getAlcance: function(){ return { texto:' · Mi Obra', resaltar:true }; },   // sufijo título + resalte
//     endpoint:   '/stats/cubicado'                                  // default; el Hub podrá variar params
//   });
//   panel.recargar();   // pedir data y redibujar (llamar al cambiar el filtro del consumidor)
//
// Requiere: Chart.js + chartjs-plugin-datalabels (globales, ya cargados en app.html) y apiGet
// (shared/api.js, agrega /api/v1 y el token). Instancias independientes: sin funciones window.* por
// instancia (listeners locales) → puede haber un panel en el Hub y otro en el editor a la vez.
(function (global) {
  var COLORES = ['#8BC34A', '#1565C0', '#ff9800', '#e53935', '#7B1FA2', '#00897B', '#795548', '#607D8B', '#F44336', '#009688'];
  var PERIODOS = [
    { id: 'S',  rot: 'S',   title: 'Semana por día' },
    { id: 'MS', rot: 'M·S', title: 'Mes por semana' },
    { id: 'MD', rot: 'M·D', title: 'Mes por día' },
    { id: 'A',  rot: 'A',   title: 'Año por mes' }
  ];
  var PER_TXT = { S: 'semana', MS: 'mes (por semana)', MD: 'mes (por día)', A: 'año' };

  function fmtKg(v) { return Number(v || 0).toLocaleString('es-CL', { maximumFractionDigits: 1 }); }
  function fmtCorto(v) {
    if (!v) return '';
    if (v >= 1000000) return (v / 1000000).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + 'M';
    if (v >= 1000) return (v / 1000).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + 'k';
    return v.toLocaleString('es-CL', { maximumFractionDigits: 0 });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function crear(cont, opts) {
    if (!cont) return null;
    opts = opts || {};
    var endpoint = opts.endpoint || '/stats/cubicado';

    // ── Estado de la instancia ──
    var periodo = 'S';
    var anios = [String(new Date().getFullYear())];   // checkboxes marcados; nunca vacío
    var chart = null;

    // ── Esqueleto del DOM (el componente ES dueño de su contenido) ──
    cont.innerHTML =
      '<div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; flex-wrap:wrap;">' +
        '<div class="pc-titulo" style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:.5px; font-weight:600; transition:background-color .15s ease, color .15s ease;">Cubicado (kg listos)</div>' +
        '<div style="flex:1;"></div>' +
        '<div class="pc-periodos" style="display:inline-flex; border:1px solid #cfd8dc; border-radius:4px; overflow:hidden;"></div>' +
        '<span class="pc-anios" style="display:inline-flex; align-items:center; gap:8px;"></span>' +
      '</div>' +
      '<div style="position:relative; height:' + ((opts && opts.altura) || 200) + 'px;">' +
        '<canvas class="pc-canvas"></canvas>' +
        '<div class="pc-vacio" style="display:none; position:absolute; inset:0; flex-direction:column; align-items:center; justify-content:center; gap:4px; color:#b0bec5; font-size:12px; font-style:italic; text-align:center; padding:0 20px;">' +
          '<span>Sin cubicación terminada en este período.</span>' +
          '<span style="font-size:11px;">El gráfico cuenta solo despieces cerrados con bandera 🚩 (los “En edición” no suman aún).</span>' +
        '</div>' +
      '</div>' +
      '<div class="pc-porusuario" style="margin-top:10px; border-top:1px solid #f0f0f0; padding-top:8px;"></div>' +
      '<div class="pc-total" style="font-size:12px; color:#333; margin-top:6px; text-align:right; font-weight:700;"></div>';

    var elTitulo = cont.querySelector('.pc-titulo');
    var elPeriodos = cont.querySelector('.pc-periodos');
    var elAnios = cont.querySelector('.pc-anios');
    var elCanvas = cont.querySelector('.pc-canvas');
    var elVacio = cont.querySelector('.pc-vacio');
    var elPorUsuario = cont.querySelector('.pc-porusuario');
    var elTotal = cont.querySelector('.pc-total');

    // Botones de período (listeners locales, sin window.*).
    var btnsPeriodo = {};
    PERIODOS.forEach(function (p, i) {
      var b = document.createElement('button');
      b.textContent = p.rot; b.title = p.title;
      b.style.cssText = 'font-size:11px; padding:3px 10px; border:none; background:#fff; color:#607d8b; cursor:pointer;' + (i ? ' border-left:1px solid #cfd8dc;' : '');
      b.addEventListener('click', function () {
        if (anios.length > 1 && p.id !== 'A') return;   // multi-año → solo A
        periodo = p.id; pintarPeriodos(); recargar();
      });
      elPeriodos.appendChild(b);
      btnsPeriodo[p.id] = b;
    });
    function pintarPeriodos() {
      var multi = anios.length > 1;
      PERIODOS.forEach(function (p) {
        var b = btnsPeriodo[p.id], on = (p.id === periodo);
        b.style.background = on ? '#8BC34A' : '#fff'; b.style.color = on ? '#fff' : '#607d8b';
        var dis = (multi && p.id !== 'A');
        b.disabled = dis; b.style.opacity = dis ? '0.4' : '1'; b.style.cursor = dis ? 'not-allowed' : 'pointer';
      });
    }
    pintarPeriodos();
    // Los checkboxes de año se pintan YA (con el año en curso), sin esperar al fetch. Cuando llega
    // la data, recargar() los repinta con los años que tienen registros (sin perder lo marcado).
    pintarAnios([]);

    function toggleAnio(y, on) {
      y = String(y);
      if (on) { if (anios.indexOf(y) < 0) anios.push(y); }
      else { anios = anios.filter(function (a) { return a !== y; }); }
      if (!anios.length) anios = [String(new Date().getFullYear())];   // nunca vacío
      if (anios.length > 1) periodo = 'A';                              // varios años → solo por mes
      pintarPeriodos(); recargar();
    }
    function pintarAnios(conData) {
      var lista = (conData || []).slice();
      var actual = new Date().getFullYear();
      if (lista.indexOf(actual) === -1) lista.push(actual);
      lista.sort(function (a, b) { return b - a; });
      elAnios.innerHTML = '';
      lista.forEach(function (y) {
        var lab = document.createElement('label');
        lab.style.cssText = 'font-size:11px; color:#607d8b; cursor:pointer; display:inline-flex; align-items:center; gap:3px;';
        var chk = document.createElement('input');
        chk.type = 'checkbox'; chk.style.margin = '0';
        chk.checked = (anios.indexOf(String(y)) >= 0);
        chk.addEventListener('change', function () { toggleAnio(y, chk.checked); });
        lab.appendChild(chk); lab.appendChild(document.createTextNode(' ' + y));
        elAnios.appendChild(lab);
      });
    }

    async function recargar() {
      if (!global.Chart || typeof global.apiGet !== 'function') return;
      var params = (typeof opts.getParams === 'function' ? (opts.getParams() || {}) : {});
      var qs = 'periodo=' + periodo + '&anios=' + encodeURIComponent(anios.join(','));
      Object.keys(params).forEach(function (k) { if (params[k] != null && params[k] !== '') qs += '&' + k + '=' + encodeURIComponent(params[k]); });
      var d; try { d = await global.apiGet(endpoint + '?' + qs); } catch (e) { d = null; }
      var cubs = (d && d.cubicadores) || []; var labels = (d && d.labels) || []; var n = labels.length;

      // Título + resalte según el alcance del consumidor.
      var alc = (typeof opts.getAlcance === 'function' ? (opts.getAlcance() || {}) : {});
      elTitulo.textContent = 'Cubicado ' + (PER_TXT[periodo] || '') + ' (kg listos)' + (alc.texto || '');
      if (alc.resaltar) { elTitulo.style.background = '#e8f5e9'; elTitulo.style.color = '#2e7d32'; elTitulo.style.padding = '3px 10px'; elTitulo.style.borderRadius = '6px'; }
      else { elTitulo.style.background = 'transparent'; elTitulo.style.color = '#888'; elTitulo.style.padding = '0'; elTitulo.style.borderRadius = '0'; }
      cont.style.borderColor = alc.resaltar ? '#a5d6a7' : '#e0e0e0';
      cont.style.borderWidth = alc.resaltar ? '2px' : '1px';

      pintarAnios(d && d.anios);

      var tieneDatos = cubs.some(function (c) { return (c.valores || []).some(function (v) { return v > 0; }); });
      elCanvas.style.display = tieneDatos ? '' : 'none';
      elVacio.style.display = tieneDatos ? 'none' : 'flex';

      // Totales por cubicador + total general (siempre visibles).
      var totUsr = cubs.map(function (c, i) { return { nombre: c.nombre, kg: (c.valores || []).reduce(function (s, v) { return s + v; }, 0), color: COLORES[i % COLORES.length] }; })
        .sort(function (a, b) { return b.kg - a.kg; });
      var totGeneral = totUsr.reduce(function (s, u) { return s + u.kg; }, 0);
      elPorUsuario.innerHTML = totUsr.length ? totUsr.map(function (u) {
        return '<div style="display:flex; align-items:baseline; gap:6px; font-size:11px; padding:2px 0;">' +
          '<span style="width:10px; height:10px; border-radius:2px; background:' + u.color + '; flex-shrink:0; align-self:center;"></span>' +
          '<span style="color:#555;">' + esc(u.nombre) + ':</span>' +
          '<span style="color:#333; font-weight:600;">' + fmtKg(u.kg) + ' kg</span></div>';
      }).join('') : '<span style="font-size:11px; color:#b0bec5; font-style:italic;">Sin cubicación terminada en este período (los despieces “En edición” no suman).</span>';
      elTotal.textContent = 'Total: ' + fmtKg(totGeneral) + ' kg';

      if (!tieneDatos) { if (chart) { chart.destroy(); chart = null; } return; }

      // Total por columna → 2a línea de la etiqueta del eje X. Datasets por cubicador.
      var totCol = labels.map(function (_, i) { return cubs.reduce(function (s, c) { return s + ((c.valores || [])[i] || 0); }, 0); });
      var chartLabels = labels.map(function (lbl, i) { return totCol[i] > 0 ? [lbl, fmtKg(totCol[i]) + ' kg'] : lbl; });
      var ds = cubs.map(function (c, i) { return { label: c.nombre, data: (c.valores || []).slice(0, n), backgroundColor: COLORES[i % COLORES.length], borderRadius: 2 }; });
      if (chart) { chart.destroy(); chart = null; }
      // Tamaños según período: normales, salvo M·D (muchas barras → chicos + autoSkip).
      var md = (periodo === 'MD');
      var szVal = md ? 8 : 11, szEjeX = md ? 8 : 11, szLeg = md ? 9 : 11;
      chart = new global.Chart(elCanvas.getContext('2d'), {
        type: 'bar',
        data: { labels: chartLabels, datasets: ds },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 16 } },
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: szLeg }, padding: 8, usePointStyle: true, pointStyle: 'rect' } },
            datalabels: {
              display: function (ctx) { return (ctx.chart.data.datasets[ctx.datasetIndex].data[ctx.dataIndex] || 0) > 0; },
              anchor: 'end', align: 'end', offset: 1, clamp: true, clip: false, color: '#37474f', font: { size: szVal, weight: 'bold' },
              formatter: function (v) { return fmtCorto(v); }
            }
          },
          scales: { y: { beginAtZero: true, ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: szEjeX }, color: '#546e7a', autoSkip: md, maxRotation: 0 } } }
        },
        plugins: [global.ChartDataLabels].filter(Boolean)
      });
    }

    return { recargar: recargar, el: cont };
  }

  global.PanelCubicacion = { crear: crear };
})(window);
