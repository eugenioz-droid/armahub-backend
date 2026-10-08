// RESUMEN MENSUAL (8-oct) — el sub-tab de aSa Data que compara el año con el anterior.
//
// POR QUÉ UNO MÁS. Los tres cuadros que ya existen —por cubicador, por segmento, por
// tipo— parten los kilos del año elegido de tres maneras. Son la misma pregunta con
// distinta fila. Acá se contestan otras cuatro, y ninguna se puede leer en los otros:
//
//   1. ¿vamos mejor o peor que el año pasado? Hoy habría que cambiar el chip de año y
//      acordarse del número. Los dos años van en el mismo gráfico.
//   2. ¿cuántas OBRAS hubo cubicándose cada mes? El tonelaje no lo dice: se puede hacer
//      el mismo tonelaje en diez obras o en noventa, y no es el mismo trabajo.
//   3. ¿el trabajo se está partiendo en códigos más chicos? Los kilos por código. En 2026
//      los kilos bajaron a 85% y los códigos SUBIERON: eso es exactamente lo que este
//      gráfico existe para mostrar.
//   4. ¿cómo se mueve la MEZCLA por segmento? En por ciento y no en kilos: en kilos
//      absolutos un mes flojo baja todas las barras y no se ve quién gana terreno.
//
// EL MES EN CURSO SE DIBUJA PERO NO SE COMPARA. Hoy es 8 de octubre y octubre lleva 762 mil
// kilos contra los 3,7 millones del octubre pasado. Eso no es una caída del 80%, es que
// faltan tres semanas. El acumulado se corta en el último mes cerrado y el mes en curso va
// marcado aparte.
(function (global) {
  'use strict';

  var MENS = null, ANIO = null, CH = {};
  var MESN = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  // Los mismos colores del cuadro por segmento: el mismo segmento no puede ser de dos
  // colores distintos en dos pantallas de la misma aplicación.
  var COLOR_SEG = { '1 y 2': '#42a5f5', '4 y 5': '#8bc34a', 'YPS': '#ffa726',
                    'Otros': '#90a4ae', '(sin segmento)': '#cfd8dc' };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function n0(v) { return Math.round(Number(v) || 0).toLocaleString('es-CL'); }
  function ton(v) { return n0((Number(v) || 0) / 1000); }

  async function cargar(anio) {
    var url = '/programacion/asa/mensual' + (anio ? '?anio=' + anio : '');
    var r = await fetch(global.apiUrl(url), { headers: global.authHeaders() });
    if (r.status === 401) { global.logout(); return null; }
    var d = await r.json();
    if (!r.ok) throw new Error((d && d.detail) || ('Error ' + r.status));
    return d;
  }

  // UN GRÁFICO, DOS AÑOS. El año elegido va en barras —es el que se mira— y el anterior
  // como línea detrás: comparar es ver la forma, no leer dos tablas.
  function dosAnios(canvas, titulo, actual, previo, fmt) {
    if (typeof Chart === 'undefined' || !global.replaceChart) return;
    var curso = MENS.en_curso;
    CH[canvas] = global.replaceChart(CH[canvas], $(canvas), {
      type: 'bar',
      data: {
        labels: MESN,
        datasets: [
          { label: String(MENS.anio), data: actual, order: 2,
            // El mes en curso en otro color: está incompleto y no se puede comparar.
            backgroundColor: actual.map(function (_, i) {
              return (curso && i + 1 === curso) ? '#b3d4f0' : '#1565C0'; }),
            borderRadius: 2 },
          { label: String(MENS.anio - 1) + ' (año anterior)', data: previo, order: 1,
            type: 'line', borderColor: '#90a4ae', borderWidth: 2, borderDash: [4, 3],
            pointRadius: 2, pointBackgroundColor: '#90a4ae', fill: false, tension: 0.25 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
          datalabels: { display: false },
          tooltip: { callbacks: { label: function (t) {
            return ' ' + t.dataset.label + ': ' + fmt(t.raw) +
                   ((curso && t.dataIndex + 1 === curso && t.datasetIndex === 0)
                     ? '  (mes en curso)' : ''); } } }
        },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                  y: { beginAtZero: true, grid: { color: '#f0f2f5' },
                       ticks: { font: { size: 10 }, callback: function (v) { return fmt(v); } } } }
      }
    });
  }

  // LA MEZCLA, EN POR CIENTO. Apilada al 100: la pregunta es la participación, no el
  // tonelaje —ése ya está en el primer gráfico y en el cuadro «Por segmento»—.
  function mezcla() {
    if (typeof Chart === 'undefined' || !global.replaceChart) return;
    var segs = MENS.segmentos || [];
    var datasets = segs.map(function (s) {
      return {
        label: s === '(sin segmento)' ? 'Sin segmento' : s,
        backgroundColor: COLOR_SEG[s] || '#b0bec5',
        data: MENS.meses.map(function (m) {
          var tot = 0, v = m.segmentos || {};
          segs.forEach(function (x) { tot += v[x] || 0; });
          return tot ? (v[s] || 0) / tot * 100 : 0;
        })
      };
    });
    CH.mensSegChart = global.replaceChart(CH.mensSegChart, $('mensSegChart'), {
      type: 'bar',
      data: { labels: MESN, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
          datalabels: { display: false },
          tooltip: { callbacks: { label: function (t) {
            // El por ciento solo no sirve para nada si uno quiere saber de cuánto: el
            // tonelaje del mes va en el mismo globo.
            var kg = (MENS.meses[t.dataIndex].segmentos || {})[segs[t.datasetIndex]] || 0;
            return ' ' + t.dataset.label + ': ' + t.raw.toFixed(1) + '%  ·  ' + ton(kg) + ' t';
          } } }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { stacked: true, min: 0, max: 100, grid: { color: '#f0f2f5' },
               ticks: { font: { size: 10 }, callback: function (v) { return v + '%'; } } }
        }
      }
    });
  }

  function variacion(a, b) {
    if (!b) return '';
    var p = (a / b - 1) * 100;
    return '<i class="' + (p >= 0 ? 'sube' : 'baja') + '">' +
           (p >= 0 ? '+' : '') + p.toFixed(0) + '%</i>';
  }

  function pintar() {
    if (!MENS) return;
    var hasta = MENS.hasta, a = MENS.acumulado;
    $('mensNota').innerHTML = hasta
      ? 'Se compara contra ' + (MENS.anio - 1) + ' <b>hasta ' + MESN[hasta - 1] + '</b>, que es el ' +
        'último mes cerrado. ' + (MENS.en_curso
          ? MESN[MENS.en_curso - 1] + ' va en curso: se dibuja más claro y no entra en el acumulado.'
          : '')
      : 'El año recién empieza: todavía no hay un mes cerrado que comparar.';
    // Las obras del mes NO se suman: una obra que trabajó en marzo y en abril es una obra,
    // no dos. Se muestra el promedio de frentes abiertos, que sí se puede leer.
    var meses = MENS.meses.slice(0, hasta || 12);
    var obrasProm = meses.length
      ? meses.reduce(function (s, m) { return s + m.actual.obras; }, 0) / meses.length : 0;
    var obrasPrev = meses.length
      ? meses.reduce(function (s, m) { return s + m.previo.obras; }, 0) / meses.length : 0;
    var porCc = a.codigos ? a.kg / a.codigos : 0;
    var porCcPrev = a.codigos_previo ? a.kg_previo / a.codigos_previo : 0;
    $('mensKpis').innerHTML =
      caja(ton(a.kg) + ' t', 'cubicado a ' + (hasta ? MESN[hasta - 1] : '—'), variacion(a.kg, a.kg_previo)) +
      caja(n0(a.codigos), 'códigos de control', variacion(a.codigos, a.codigos_previo)) +
      caja(n0(obrasProm), 'obras por mes, en promedio', variacion(obrasProm, obrasPrev)) +
      caja(n0(porCc) + ' kg', 'por código', variacion(porCc, porCcPrev));

    $('mensKgN').textContent = '· ' + ton(a.kg) + ' t a ' + (hasta ? MESN[hasta - 1] : '—');
    $('mensObrasN').textContent = '· ' + n0(obrasProm) + ' al mes en promedio';
    $('mensTamN').textContent = '· ' + n0(porCc) + ' kg por código';
    $('mensSegN').textContent = '· ' + (MENS.segmentos || []).length + ' segmentos';

    dosAnios('mensKgChart', 'Kilos',
             MENS.meses.map(function (m) { return m.actual.kg; }),
             MENS.meses.map(function (m) { return m.previo.kg; }),
             function (v) { return ton(v) + ' t'; });
    dosAnios('mensObrasChart', 'Obras',
             MENS.meses.map(function (m) { return m.actual.obras; }),
             MENS.meses.map(function (m) { return m.previo.obras; }),
             function (v) { return n0(v); });
    dosAnios('mensTamChart', 'Kilos por código',
             MENS.meses.map(function (m) { return m.actual.codigos ? m.actual.kg / m.actual.codigos : 0; }),
             MENS.meses.map(function (m) { return m.previo.codigos ? m.previo.kg / m.previo.codigos : 0; }),
             function (v) { return n0(v) + ' kg'; });
    mezcla();
  }

  function caja(valor, texto, extra) {
    return '<div class="menskpi"><b>' + esc(valor) + ' ' + (extra || '') + '</b>' +
           '<span>' + esc(texto) + '</span></div>';
  }

  function pintarAnios() {
    var el = $('mensAnios');
    if (!el || !MENS) return;
    el.innerHTML = (MENS.anios || []).map(function (a) {
      return '<button data-a="' + a + '" class="' + (a === MENS.anio ? 'on' : '') + '">' + a + '</button>';
    }).join('');
    el.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { global.loadResumenMensual(Number(b.dataset.a)); });
    });
  }

  global.loadResumenMensual = async function (anio) {
    if (!$('asaPanelMens')) return;
    if (MENS && anio === ANIO) { pintar(); return; }
    try {
      MENS = await cargar(anio);
      if (!MENS) return;
      ANIO = MENS.anio;
      pintarAnios();
      pintar();
    } catch (e) {
      $('mensNota').textContent = e.message;
    }
  };

  global.__mensualTest = { variacion: variacion, estado: function () { return MENS; } };

})(window);
