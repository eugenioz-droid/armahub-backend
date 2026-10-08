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
  // Qué cubicadores están en el gráfico. Se llena con los vigentes al cargar el año y
  // después manda lo que el usuario toque: si se recalculara en cada pintado, desmarcar
  // a alguien se desharía solo al siguiente dibujo.
  var CUBS = null;
  // Una paleta fija y en orden: el mismo cubicador tiene que ser del mismo color cada vez
  // que se abre la pantalla, o comparar dos días seguidos es imposible.
  var PALETA = ['#1565C0', '#43a047', '#fb8c00', '#8e24aa', '#00897b', '#e53935',
                '#3949ab', '#c0ca33', '#6d4c41', '#00acc1', '#f4511e', '#5e35b1'];
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
      plugins: (typeof ChartDataLabels !== 'undefined') ? [ChartDataLabels] : [],
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
        layout: { padding: { top: 24 } },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
          // ACÁ EL NÚMERO VA SÓLO SOBRE LA BARRA, y no como total del mes bajo el eje: la
          // otra serie es una LÍNEA del año anterior, así que sumar las dos daría un
          // total que no existe. En la barra, el valor YA es el total del mes.
          datalabels: { display: function (c) { return c.datasetIndex === 0; },
                        anchor: 'end', align: 'end', rotation: -90, offset: 2, clamp: true,
                        color: '#546e7a', font: { size: 8.5 },
                        formatter: function (v) { return v ? fmt(v) : ''; } },
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

  // LOS TOTALES, COMO EN EL RESTO DE aSa DATA. El número real sobre cada barra, girado
  // noventa grados —derechos, seis cifras por mes se pisan— y el TOTAL DEL MES como
  // segunda línea de la etiqueta del eje. No es un invento de esta pantalla: es el mismo
  // patrón de los cuadros «Por cubicador / segmento / tipo», y usarlo distinto acá sería
  // que la misma aplicación se lea de dos maneras.
  function etiquetasConTotal(labels, datasets) {
    return labels.map(function (l, i) {
      var tot = datasets.reduce(function (a, d) { return a + (d.data[i] || 0); }, 0);
      return tot ? [l, ton(tot) + ' t'] : [l, ''];
    });
  }

  function datalabelsBarra() {
    return { display: function (c) { return (c.dataset.type || 'bar') === 'bar'; },
             anchor: 'end', align: 'end', rotation: -90, offset: 2, clamp: true,
             color: '#546e7a', font: { size: 8.5 },
             // Lo que no se ve no se rotula: un cero o una barra de nada sólo agrega ruido.
             formatter: function (v) { return v >= 1000 ? ton(v) : ''; } };
  }

  // TODOS LOS AÑOS ENCIMA. El gráfico de dos años contesta «cómo vamos»; éste contesta
  // «cómo se mueve el año», que es otra cosa: la estacionalidad —el bajón de junio, el
  // repunte de octubre— sólo se ve cuando están los cinco años juntos.
  function todosLosAnios() {
    if (typeof Chart === 'undefined' || !global.replaceChart) return;
    var series = MENS.por_anio || [];
    $('mensAniosN').textContent = '· ' + series.length + ' años';
    CH.mensAniosChart = global.replaceChart(CH.mensAniosChart, $('mensAniosChart'), {
      type: 'bar',
      plugins: (typeof ChartDataLabels !== 'undefined') ? [ChartDataLabels] : [],
      data: {
        labels: etiquetasConTotal(MESN, series.map(function (s) { return { data: s.meses }; })),
        datasets: series.map(function (s, i) {
          // El año elegido, lleno; los otros, más suaves. El que se está mirando tiene
          // que destacarse sin que los demás desaparezcan.
          var color = PALETA[i % PALETA.length];
          var actual = s.anio === MENS.anio;
          // SIN `order`, Y ESO IMPORTA. En Chart.js `order` no sólo decide qué se dibuja
          // encima: en un gráfico de barras agrupadas CAMBIA LA POSICIÓN dentro del grupo.
          // Poniéndole 0 al año en curso para destacarlo, 2026 saltaba al primer lugar de
          // cada mes y la serie dejaba de ir en orden; además quedaba un hueco donde
          // debería haber estado. Lo vio el usuario. El énfasis se hace SÓLO con el color,
          // que no mueve nada: el año elegido lleno y los demás translúcidos.
          return { label: String(s.anio), data: s.meses, borderRadius: 2,
                   backgroundColor: actual ? color : color + '66' };
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { top: 26 } },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
          datalabels: datalabelsBarra(),
          tooltip: { callbacks: { label: function (c) {
            return ' ' + c.dataset.label + ': ' + ton(c.raw) + ' t'; } } }
        },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                  y: { beginAtZero: true, grid: { color: '#f0f2f5' },
                       ticks: { font: { size: 10 },
                                callback: function (v) { return ton(v) + ' t'; } } } }
      }
    });
  }

  // CADA CUBICADOR, UNA BARRA POR MES. Agrupadas y no apiladas: la pregunta es comparar
  // entre personas dentro del mes, y apiladas eso no se puede leer.
  function porCubicador() {
    if (typeof Chart === 'undefined' || !global.replaceChart) return;
    var todos = MENS.cubicadores || [];
    var elegidos = todos.filter(function (c) { return CUBS.indexOf(c.nombre) !== -1; });
    $('mensCubN').textContent = '· ' + elegidos.length + ' de ' + todos.length +
      ' · ' + ton(elegidos.reduce(function (s, c) { return s + c.total; }, 0)) + ' t';
    CH.mensCubChart = global.replaceChart(CH.mensCubChart, $('mensCubChart'), {
      type: 'bar',
      plugins: (typeof ChartDataLabels !== 'undefined') ? [ChartDataLabels] : [],
      data: {
        labels: etiquetasConTotal(MESN, elegidos.map(function (c) { return { data: c.meses }; })),
        datasets: elegidos.map(function (c) {
          // El color sale de la posición en la lista COMPLETA, no en la elegida: así
          // desmarcar a alguien no le cambia el color a todos los demás.
          var i = todos.indexOf(c);
          return { label: c.nombre, data: c.meses, borderRadius: 2,
                   backgroundColor: PALETA[i % PALETA.length] };
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { top: 26 } },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
          datalabels: datalabelsBarra(),
          tooltip: { callbacks: { label: function (c) {
            return ' ' + c.dataset.label + ': ' + ton(c.raw) + ' t'; } } }
        },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                  y: { beginAtZero: true, grid: { color: '#f0f2f5' },
                       ticks: { font: { size: 10 },
                                callback: function (v) { return ton(v) + ' t'; } } } }
      }
    });
  }

  function colorDe(nombre) {
    // El color sale de la posición en la lista COMPLETA, no en la elegida: así sacar a
    // uno no le cambia el color a todos los demás.
    var i = (MENS.cubicadores || []).findIndex(function (c) { return c.nombre === nombre; });
    return PALETA[(i < 0 ? 0 : i) % PALETA.length];
  }

  // EL SELECTOR, QUE TIENE QUE LEERSE COMO UN SELECTOR. Antes eran chips de filtro, todos
  // iguales, y no quedaba claro que se podían sacar ni agregar: el usuario lo probó y no
  // pudo. Ahora lo que está en el gráfico se ve como está en el gráfico —cada uno en SU
  // color, con su tonelaje— y lleva una × para quitarlo; lo que está afuera se agrega
  // desde un botón que sólo ofrece a los que faltan.
  function pintarCubChips() {
    var sel = $('mensCubSel'), menu = $('mensCubMenu');
    if (!sel || !MENS) return;
    var todos = MENS.cubicadores || [];
    var puestos = todos.filter(function (c) { return CUBS.indexOf(c.nombre) !== -1; });
    sel.innerHTML = puestos.length
      ? puestos.map(function (c) {
          return '<span class="mensq" style="background:' + colorDe(c.nombre) + '">' +
                 esc(c.nombre) + ' <b>' + ton(c.total) + ' t</b>' +
                 '<i data-quitar="' + esc(c.nombre) + '" title="Sacarlo del gráfico">×</i></span>';
        }).join('')
      : '<span class="muted" style="font-size:11px">Nadie en el gráfico. Agrega con el botón.</span>';
    sel.querySelectorAll('i[data-quitar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = CUBS.indexOf(b.dataset.quitar);
        if (i !== -1) CUBS.splice(i, 1);
        pintarCubChips(); porCubicador();
      });
    });
    var faltan = todos.filter(function (c) { return CUBS.indexOf(c.nombre) === -1; });
    $('mensCubAdd').textContent = faltan.length ? '+ Agregar (' + faltan.length + ')' : '+ Agregar';
    $('mensCubAdd').disabled = !faltan.length;
    menu.innerHTML = faltan.length
      ? faltan.map(function (c) {
          return '<button type="button" data-poner="' + esc(c.nombre) + '">' +
                 '<span style="width:9px;height:9px;border-radius:2px;flex:none;background:' +
                 colorDe(c.nombre) + '"></span>' + esc(c.nombre) +
                 '<span>' + ton(c.total) + ' t' +
                 (c.vigente ? '' : ' · inactivo') + '</span></button>';
        }).join('')
      : '<div class="vacio">Ya están todos en el gráfico.</div>';
    menu.querySelectorAll('button[data-poner]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (CUBS.indexOf(b.dataset.poner) === -1) CUBS.push(b.dataset.poner);
        menu.style.display = 'none';
        pintarCubChips(); porCubicador();
      });
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
    todosLosAnios();
    pintarCubChips();
    porCubicador();
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

  // El menú de agregar se abre con el botón y se cierra al tocar fuera: dejarlo abierto
  // tapa el gráfico, que es justo lo que uno quiere mirar después de agregar a alguien.
  function montarMenu() {
    var btn = $('mensCubAdd'), menu = $('mensCubMenu');
    if (!btn || !menu) return;
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      menu.style.display = (menu.style.display === 'none') ? '' : 'none';
    });
    menu.addEventListener('click', function (ev) { ev.stopPropagation(); });
    document.addEventListener('click', function () { menu.style.display = 'none'; });
  }

  var _montado = false;

  global.loadResumenMensual = async function (anio) {
    if (!$('asaPanelMens')) return;
    if (MENS && anio === ANIO) { pintar(); return; }
    try {
      MENS = await cargar(anio);
      if (!MENS) return;
      ANIO = MENS.anio;
      if (!_montado) { _montado = true; montarMenu(); }
      // Los vigentes vienen marcados. Se decide ACÁ, al cargar el año, y no en cada
      // pintado: si se recalculara al dibujar, desmarcar a alguien se desharía solo.
      CUBS = (MENS.cubicadores || []).filter(function (c) { return c.vigente; })
                                     .map(function (c) { return c.nombre; });
      pintarAnios();
      pintar();
    } catch (e) {
      $('mensNota').textContent = e.message;
    }
  };

  global.__mensualTest = { variacion: variacion, estado: function () { return MENS; } };

})(window);
