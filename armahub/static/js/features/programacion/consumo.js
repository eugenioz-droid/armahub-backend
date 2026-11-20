// CONSUMO (20-nov) — sub-tab de aSa Data: cuánto consume cada obra en cortado y doblado
// (C&D) y cuánto en barras en punta (barra recta en largo comercial).
//
// La obra «X - BARRAS» de aSa viene JUNTA con su gemela «X»: el backend las empareja y
// cada fila es la obra entera. La clase sale del producto de aSa, no del nombre (ver
// asa_sync.clase_producto). Clic en una obra = sus diámetros a la derecha; clic otra vez
// = vuelven los diámetros de todo lo filtrado.
//
// Usa el año, el mes, el segmento y el tipo de arriba (los de todo aSa Data). Los suyos
// son la composición, el orden y la búsqueda, que sólo tienen sentido acá.
(function (global) {
  'use strict';

  var CONS = null, CLAVE = null, CARGANDO = false, CH = null;
  var COMP = 'todas', ORDEN = 'total', BUSCA = '', SEL = null;
  // Un color por clase, fijo en todo el panel (manual de diseño: la categoría conserva
  // su color entre gráficos y filtros).
  var COLOR = { cyd: '#7EBA27', barra: '#104F9E', otro: '#687582' };
  var NOMBRE = { cyd: 'C&D', barra: 'Barras en punta', otro: 'Otros' };
  var COMPS = [['todas', 'Todas'], ['con', 'Con barras'], ['cyd', 'Solo C&D'], ['barra', 'Solo barras']];
  var ORDENES = [['total', 'Total'], ['barra', 'Barras'], ['pct', '% barras']];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function n0(v) { return Math.round(Number(v) || 0).toLocaleString('es-CL'); }
  function t1(v) {
    return ((Number(v) || 0) / 1000).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  function total(o) { return o.cyd + o.barra + o.otro; }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function sinTildes(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  function filtrosQs() {
    var f = global.asaFiltros ? global.asaFiltros() : {};
    var p = [];
    if (f.anio != null) p.push('anio=' + f.anio);
    if (f.meses && f.meses.length) p.push('meses=' + f.meses.join(','));
    if (f.segmentos && f.segmentos.length) p.push('segmentos=' + encodeURIComponent(f.segmentos.join(',')));
    if (f.tipos && f.tipos.length) p.push('tipos=' + encodeURIComponent(f.tipos.join(',')));
    return p.join('&');
  }

  // Se pide sólo si cambió el período o el segmento/tipo; lo demás se filtra acá.
  global.loadConsumo = async function () {
    if (!$('asaPanelCons')) return;
    var clave = filtrosQs();
    if (CONS && clave === CLAVE) { pintar(); return; }
    if (CARGANDO === clave) return;
    CARGANDO = clave;
    $('consN').textContent = '· cargando…';
    try {
      var r = await fetch(global.apiUrl('/programacion/asa/consumo?' + clave), { headers: global.authHeaders() });
      if (r.status === 401) { global.logout(); return; }
      var d = null;
      try { d = await r.json(); } catch (e) {}
      if (!r.ok) throw new Error((d && d.detail) || ('Error ' + r.status));
      if (CARGANDO !== clave) return;   // ya pidieron otro período: ésa manda
      CONS = d; CLAVE = clave;
    } catch (e) {
      $('consN').textContent = '';
      $('consAviso').className = 'prgaviso mal';
      $('consAviso').textContent = 'No se pudo cargar el consumo: ' + e.message;
      return;
    } finally {
      if (CARGANDO === clave) CARGANDO = false;
    }
    pintar();
  };

  function pasa(o) {
    if (COMP === 'con' && !o.barra) return false;
    if (COMP === 'cyd' && (o.barra || !o.cyd)) return false;
    if (COMP === 'barra' && (o.cyd || !o.barra)) return false;
    if (BUSCA && sinTildes(o.nombre + ' ' + o.cliente).indexOf(BUSCA) === -1) return false;
    return true;
  }

  function ordenar(lista) {
    var f = ORDEN === 'barra' ? function (o) { return o.barra; }
          : ORDEN === 'pct' ? function (o) { return total(o) ? o.barra / total(o) : 0; }
          : total;
    return lista.sort(function (a, b) { return f(b) - f(a) || total(b) - total(a); });
  }

  function chipsSimples(cont, opciones, actual, alElegir) {
    cont.innerHTML = opciones.map(function (o) {
      return '<button data-v="' + o[0] + '" class="' + (o[0] === actual ? 'on' : '') + '">' + esc(o[1]) + '</button>';
    }).join('');
    cont.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { alElegir(b.dataset.v); });
    });
  }

  function pintar() {
    if (!CONS) return;
    chipsSimples($('consComp'), COMPS, COMP, function (v) { COMP = v; pintar(); });
    chipsSimples($('consOrden'), ORDENES, ORDEN, function (v) { ORDEN = v; pintar(); });

    // Un año sin el desglose cargado se ve en cero: se dice por qué.
    var av = $('consAviso');
    var falta = CONS.anio && (CONS.anios_cargados || []).indexOf(CONS.anio) === -1;
    av.className = falta ? 'prgaviso' : '';
    av.innerHTML = falta ? 'Consumo de <b>' + CONS.anio + '</b> sin cargar. Pulsa <b>↻ Traer de aSa</b>.' : '';

    var lista = ordenar(CONS.obras.filter(pasa));
    if (SEL && !lista.some(function (o) { return o.key === SEL; })) SEL = null;
    var T = { cyd: 0, barra: 0, otro: 0, pzs: 0 };
    lista.forEach(function (o) { T.cyd += o.cyd; T.barra += o.barra; T.otro += o.otro; T.pzs += o.barra_pzs; });
    var tt = total(T);

    $('consKpis').innerHTML =
      kpi(t1(tt) + ' t', 'consumo') +
      kpi(t1(T.cyd) + ' t', 'C&D · ' + pct(T.cyd, tt) + ' %') +
      kpi(t1(T.barra) + ' t', 'barras en punta · ' + pct(T.barra, tt) + ' %') +
      kpi(n0(T.pzs), 'barras en punta (unidades)');

    $('consN').innerHTML = '· ' + lista.length + ' obra(s)';
    var max = lista.reduce(function (a, o) { return Math.max(a, total(o)); }, 0) || 1;
    $('consObras').innerHTML = lista.length ? lista.map(function (o) {
      var tot = total(o);
      var seg = function (c) {
        return o[c] ? '<i style="width:' + (o[c] / max * 100).toFixed(2) + '%; background:' + COLOR[c] +
                      '" title="' + NOMBRE[c] + ': ' + n0(o[c]) + ' kg"></i>' : '';
      };
      return '<div class="consfila' + (o.key === SEL ? ' on' : '') + '" data-k="' + esc(o.key) +
             '" title="' + esc(o.nombre) + (o.cliente ? ' · ' + esc(o.cliente) : '') + '">' +
             '<span class="consnom">' + esc(o.nombre) + '</span>' +
             '<span class="consbar">' + seg('cyd') + seg('barra') + seg('otro') + '</span>' +
             '<span class="consnum">' + t1(tot) + ' t</span>' +
             '<span class="consnum conspct">' + (o.barra ? pct(o.barra, tot) + ' %' : '—') + '</span></div>';
    }).join('') : '<div class="dshvacio">Sin obras con estos filtros</div>';
    $('consObras').querySelectorAll('.consfila').forEach(function (f) {
      f.addEventListener('click', function () {
        SEL = (SEL === f.dataset.k) ? null : f.dataset.k;
        pintar();
      });
    });

    pintarDetalle(SEL ? lista.filter(function (o) { return o.key === SEL; }) : lista);
  }

  // La misma tarjeta del «Resumen mensual»: cifra arriba, etiqueta abajo.
  function kpi(valor, etiqueta) {
    return '<div class="menskpi"><b>' + esc(valor) + '</b><span>' + esc(etiqueta) + '</span></div>';
  }

  // LOS DIÁMETROS de lo elegido: una obra, o todo lo filtrado. Barras apiladas por clase,
  // con el total encima, y la tabla con las barras en unidades.
  function pintarDetalle(obras) {
    var por = {}, largos = {};
    obras.forEach(function (o) {
      o.diam.forEach(function (d) {
        var a = por[d.d] || (por[d.d] = { d: d.d, cyd: 0, barra: 0, otro: 0, pzs: 0 });
        a.cyd += d.cyd; a.barra += d.barra; a.otro += d.otro; a.pzs += d.pzs;
      });
      Object.keys(o.largos || {}).forEach(function (l) { largos[l] = (largos[l] || 0) + o.largos[l]; });
    });
    var filas = Object.keys(por).map(function (k) { return por[k]; })
      .filter(function (d) { return total(d); })
      .sort(function (a, b) { return a.d - b.d; });
    var nom = SEL && obras[0] ? obras[0].nombre : 'Todas las obras';
    $('consDetN').innerHTML = '· ' + esc(nom);
    var ls = Object.keys(largos).sort(function (a, b) { return Number(b) - Number(a); });
    $('consLargos').innerHTML = ls.length
      ? '<span class="dshbl">Barras por largo</span>' + ls.map(function (l) {
          return '<span class="conslargo">' + esc(l) + ' m · <b>' + n0(largos[l]) + '</b></span>'; }).join('')
      : '';

    var etiq = function (d) { return d.d ? 'φ' + d.d : 'Sin φ'; };
    var T = { cyd: 0, barra: 0, otro: 0, pzs: 0 };
    var html = '<thead><tr><th>Diámetro</th><th class="num">C&amp;D kg</th><th class="num">Barras kg</th>' +
               '<th class="num">Barras unid.</th><th class="num">Total kg</th><th class="num">% barras</th></tr></thead><tbody>';
    filas.forEach(function (d) {
      ['cyd', 'barra', 'otro', 'pzs'].forEach(function (c) { T[c] += d[c]; });
      html += '<tr><td>' + etiq(d) + '</td><td class="num">' + n0(d.cyd) + '</td><td class="num">' + n0(d.barra) +
              '</td><td class="num">' + (d.pzs ? n0(d.pzs) : '') + '</td><td class="num">' + n0(total(d)) +
              '</td><td class="num">' + (d.barra ? pct(d.barra, total(d)) + ' %' : '') + '</td></tr>';
    });
    html += '</tbody><tfoot><tr><td>Total</td><td class="num">' + n0(T.cyd) + '</td><td class="num">' + n0(T.barra) +
            '</td><td class="num">' + n0(T.pzs) + '</td><td class="num">' + n0(total(T)) + '</td><td class="num">' +
            (T.barra ? pct(T.barra, total(T)) + ' %' : '') + '</td></tr></tfoot>';
    $('consDiam').innerHTML = filas.length ? html
      : '<tbody><tr><td class="dshvacio">Sin datos con estos filtros</td></tr></tbody>';

    if (typeof Chart === 'undefined' || !global.replaceChart) return;
    var clases = ['cyd', 'barra', 'otro'].filter(function (c) { return T[c]; });
    var ultima = clases[clases.length - 1];
    CH = global.replaceChart(CH, $('consChart'), {
      type: 'bar',
      plugins: (typeof ChartDataLabels !== 'undefined') ? [ChartDataLabels] : [],
      data: {
        labels: filas.map(etiq),
        datasets: clases.map(function (c) {
          return { label: NOMBRE[c], data: filas.map(function (d) { return Math.round(d[c]); }),
                   backgroundColor: COLOR[c], maxBarThickness: 46, stack: 'u' };
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { top: 18 } },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: function (t) { return ' ' + t.dataset.label + ': ' + n0(t.raw) + ' kg'; } } },
          // Sólo el total, encima de la columna (manual: etiquetas en totales).
          datalabels: {
            display: function (c) { return NOMBRE[ultima] === c.dataset.label; },
            anchor: 'end', align: 'end', offset: 2, color: '#37474f', font: { size: 9.5, weight: '600' },
            formatter: function (v, c) { return t1(total(filas[c.dataIndex])) + ' t'; }
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { stacked: true, beginAtZero: true, grid: { color: '#f0f2f5' },
               ticks: { font: { size: 10 }, callback: global.chartTickNumber } }
        }
      }
    });
  }

  var _bound = false;
  global.initConsumo = function () {
    if (_bound || !$('consBuscar')) return;
    _bound = true;
    $('consBuscar').addEventListener('input', function () { BUSCA = sinTildes(this.value.trim()); pintar(); });
  };

  // Para los tests: las reglas sin DOM.
  global.__consumoTest = { pasa: function (o, comp, busca) {
    var c = COMP, b = BUSCA; COMP = comp || 'todas'; BUSCA = busca || '';
    try { return pasa(o); } finally { COMP = c; BUSCA = b; } } };
})(window);
