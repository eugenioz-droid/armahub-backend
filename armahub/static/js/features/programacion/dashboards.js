// DASHBOARDS DE PROGRAMACIÓN (28-sep) — réplica del reporte de Power BI.
//
// Dos tablas: «CUBICACIÓN EN ASA POR PROGRAMAR» y «PROGRAMADOS». La división no es un
// campo de aSa: programado = el pedido tiene fecha comprometida (PromisedDeliveryDate).
//
// QUÉ HACE CADA LADO. El backend trae del espejo `asa_pedidos` las filas del año (y de los
// meses) elegidos, ya separadas en dos listas y con sus totales sumados. Este archivo
// aplica los filtros de obra y cubicador —que son instantáneos porque la data ya está— y
// pinta. Los totales SÍ se recalculan acá cuando hay filtro de obra o persona, porque el
// total tiene que corresponder a lo que se ve en pantalla; si mostrara el del servidor,
// el número de abajo no cuadraría con las filas de arriba.
(function (global) {
  'use strict';

  var DATA = null, ANIO = null, MESES = [], OBRAS = [], PERSONAS = [], BUSCA = '';
  var MESN = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  // aSa devuelve 18 «DetailPerson», entre ellos aSaAdmin, EugenioZ y gente que ya no
  // cubica. El usuario quiere ver SÓLO su equipo: elige cuáles se muestran como chips y
  // la elección se recuerda en este navegador (es una comodidad de vista, no un dato).
  var DET = leerDet(), ELIGIENDO = false;
  var DET_CLAVE = 'prgDshDetailers';
  var PRIMER_ANIO = 2021;   // desde cuándo se trae la historia de aSa

  function leerDet() {
    try { var v = JSON.parse(localStorage.getItem('prgDshDetailers') || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function guardarDet() { try { localStorage.setItem(DET_CLAVE, JSON.stringify(DET)); } catch (e) {} }

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Miles con punto y dos decimales con coma, como el informe original.
  function kg(n) {
    return (Number(n) || 0).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // El usuario lo pidió explícito: la fecha comprometida se muestra dd/mm.
  function ddmm(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? (p[2] + '/' + p[1]) : iso;
  }

  async function req(metodo, url, cuerpo) {
    var opts = { method: metodo, headers: Object.assign({}, global.authHeaders()) };
    if (cuerpo !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(cuerpo); }
    var res = await fetch(global.apiUrl(url), opts);
    if (res.status === 401) { global.logout(); return null; }
    var data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var det = data && data.detail;
      // Un 422 de FastAPI trae una LISTA de errores de validación; mostrarla tal cual da
      // «[object Object]», que no le dice nada a nadie.
      if (Array.isArray(det)) det = det.map(function (d) { return (d.loc || []).slice(-1) + ': ' + d.msg; }).join(' · ');
      throw new Error((det && (det.msg || det)) || ('Error ' + res.status));
    }
    return data;
  }

  // Sólo los parámetros con valor. Mandar `anio=` vacío es un 422 seguro: FastAPI no
  // convierte "" a entero. Pasó en la primera carga, cuando el año aún no se conoce.
  function qs(obj) {
    var p = [];
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
      p.push(encodeURIComponent(k) + '=' + encodeURIComponent(Array.isArray(v) ? v.join(',') : v));
    });
    return p.length ? '?' + p.join('&') : '';
  }
  function aviso(m) { if (global.showToast) global.showToast(m, 'error'); else alert(m); }

  var _bound = false;
  global.loadPrgDashboards = async function () {
    if (!$('tab-prg_dashboards')) return;
    if (!_bound) {
      _bound = true;
      $('dshSync').addEventListener('click', sincronizar);
      $('dshDetElegir').addEventListener('click', function () { ELIGIENDO = !ELIGIENDO; pintarChips(); });
      $('dshBuscaObra').addEventListener('input', function () {
        BUSCA = this.value.trim().toLowerCase(); pintarObras();
      });
    }
    await cargar();
  };

  async function cargar() {
    try {
      DATA = await req('GET', '/programacion/asa/reporte' + qs({ anio: ANIO, meses: MESES }));
      if (!DATA) return;
      ANIO = DATA.anio;
    } catch (e) { aviso(e.message); mostrarVacio(e.message); return; }
    pintarTodo();
  }

  function mostrarVacio(msg) {
    $('dshPorProgramar').innerHTML = '';
    $('dshProgramados').innerHTML = '';
    $('dshAviso').className = 'prgaviso mal';
    $('dshAviso').innerHTML = '<b>No se pudo cargar el reporte.</b> ' + esc(msg || '');
  }

  function pintarTodo() {
    var esp = DATA.espejo || {};
    var ex = DATA.excluidos || {};
    $('dshEspejo').textContent = esp.filas_anio
      ? esp.filas_anio + ' códigos de control en ' + DATA.anio +
        ((ex.despachados || ex.cancelados)
          ? ' · fuera del reporte: ' + (ex.despachados || 0) + ' despachados, ' + (ex.cancelados || 0) + ' cancelados'
          : '')
      : '';
    // Un espejo vacío no es un error, pero tampoco es «no hay trabajo»: hay que decir
    // que falta traer la data, o el usuario lee cero donde hay cientos de toneladas.
    if (!esp.filas_anio) {
      $('dshAviso').className = 'prgaviso';
      $('dshAviso').innerHTML = 'Todavía no se ha traído nada de aSa para <b>' + DATA.anio +
        '</b>. Pulsa <b>↻ Traer de aSa</b> — se piden los pedidos del año agregados por ' +
        'código de control (unos 5.000, tarda unos segundos).';
    } else {
      $('dshAviso').innerHTML = '';
    }
    pintarChips();
    pintarObras();
    pintarTablas();
  }

  function chips(cont, valores, activos, onClick, etiqueta) {
    cont.innerHTML = '';
    valores.forEach(function (v) {
      var b = document.createElement('button');
      b.textContent = etiqueta ? etiqueta(v) : v;
      if (activos.indexOf(v) !== -1) b.className = 'on';
      b.addEventListener('click', function () { onClick(v); });
      cont.appendChild(b);
    });
  }

  function pintarChips() {
    // Si el espejo está vacío no hay años que ofrecer; se muestra el actual igual, porque
    // es el que se va a sincronizar.
    var anios = (DATA.anios && DATA.anios.length) ? DATA.anios : [DATA.anio];
    chips($('dshAnios'), anios, [ANIO], function (v) { ANIO = v; cargar(); });
    chips($('dshMeses'), [1,2,3,4,5,6,7,8,9,10,11,12], MESES, function (m) {
      var i = MESES.indexOf(m);
      if (i === -1) MESES.push(m); else MESES.splice(i, 1);
      cargar();
    }, function (m) { return MESN[m - 1]; });
    // Chips de cubicador: sólo los elegidos. Sin elección, todos (primer uso).
    var todas = DATA.personas || [];
    var visibles = DET.length ? todas.filter(function (p) { return DET.indexOf(p) !== -1; }) : todas;
    chips($('dshPersonas'), visibles, PERSONAS, function (p) {
      var i = PERSONAS.indexOf(p);
      if (i === -1) PERSONAS.push(p); else PERSONAS.splice(i, 1);
      pintarTablas();
    });
    $('dshDetElegir').textContent = ELIGIENDO ? 'listo' : 'elegir';
    $('dshDetElegir').className = ELIGIENDO ? 'dshmini on' : 'dshmini';
    var lista = $('dshDetLista');
    lista.style.display = ELIGIENDO ? '' : 'none';
    if (!ELIGIENDO) return;
    lista.innerHTML = todas.map(function (p) {
      return '<label><input type="checkbox" data-det="' + esc(p) + '"' +
             (DET.indexOf(p) !== -1 ? ' checked' : '') + '>' + esc(p) + '</label>';
    }).join('');
    lista.querySelectorAll('input[data-det]').forEach(function (c) {
      c.addEventListener('change', function () {
        var p = c.dataset.det, i = DET.indexOf(p);
        if (c.checked && i === -1) DET.push(p);
        else if (!c.checked && i !== -1) DET.splice(i, 1);
        guardarDet();
        // Un cubicador que deja de mostrarse tampoco puede seguir filtrando.
        PERSONAS = PERSONAS.filter(function (x) { return !DET.length || DET.indexOf(x) !== -1; });
        pintarChips(); pintarTablas();
      });
    });
  }

  function pintarObras() {
    var lista = (DATA.obras || []).filter(function (o) {
      return !BUSCA || o.toLowerCase().indexOf(BUSCA) !== -1;
    });
    if (!lista.length) { $('dshObras').innerHTML = '<div class="dshvacio">Sin obras</div>'; return; }
    $('dshObras').innerHTML = lista.map(function (o) {
      return '<label title="' + esc(o) + '"><input type="checkbox" data-obra="' + esc(o) + '"' +
             (OBRAS.indexOf(o) !== -1 ? ' checked' : '') + '>' + esc(o) + '</label>';
    }).join('');
    $('dshObras').querySelectorAll('input[data-obra]').forEach(function (c) {
      c.addEventListener('change', function () {
        var o = c.dataset.obra, i = OBRAS.indexOf(o);
        if (c.checked && i === -1) OBRAS.push(o);
        else if (!c.checked && i !== -1) OBRAS.splice(i, 1);
        pintarTablas();
      });
    });
  }

  function filtrar(filas) {
    return filas.filter(function (f) {
      if (OBRAS.length && OBRAS.indexOf(f.obra) === -1) return false;
      if (PERSONAS.length && PERSONAS.indexOf(f.persona) === -1) return false;
      return true;
    });
  }

  // Las dos tablas tienen las mismas columnas salvo la fecha, así que se pintan con la
  // misma función: una sola definición de cómo se ve una fila.
  function tabla(el, filas, conFecha) {
    if (!filas.length) {
      el.innerHTML = '<tbody><tr><td class="dshvacio">Sin datos con estos filtros</td></tr></tbody>';
      return 0;
    }
    var total = filas.reduce(function (a, f) { return a + f.kg; }, 0);
    // Anchos en %: las dos cajas ocupan la misma columna, así que las dos tablas miden lo
    // mismo aunque PROGRAMADOS tenga una columna más. Los porcentajes de cada variante
    // suman 100 y salen de las dos columnas angostas (código y fecha), que son de largo
    // conocido; lo que sobra se reparte entre obra y descripción.
    var html = conFecha
      ? '<thead><tr><th style="width:29%">JobName</th><th style="width:33%">Descr</th>' +
        '<th style="width:11%">Control Code</th><th style="width:10%">Promised</th>' +
        '<th class="num" style="width:17%">Sum of TotalKgs</th></tr></thead><tbody>'
      : '<thead><tr><th style="width:33%">JobName</th><th style="width:36%">Descr</th>' +
        '<th style="width:12%">Control Code</th>' +
        '<th class="num" style="width:19%">Sum of TotalKgs</th></tr></thead><tbody>';
    filas.forEach(function (f) {
      html += '<tr><td title="' + esc(f.obra) + '">' + esc(f.obra) + '</td>' +
              '<td title="' + esc(f.descr) + '">' + esc(f.descr) + '</td>' +
              '<td class="cc">' + esc(f.cc) + '</td>' +
              (conFecha ? '<td>' + ddmm(f.promesa) + '</td>' : '') +
              '<td class="num">' + kg(f.kg) + '</td></tr>';
    });
    // Sin fila de Total al pie: el total vive en el encabezado de la caja, que no se va
    // con el scroll. Dejarlo abajo obligaba a bajar 566 filas para ver el número.
    el.innerHTML = html + '</tbody>';
    return total;
  }

  function pintarTablas() {
    var pp = filtrar(DATA.por_programar || []);
    var pg = filtrar(DATA.programados || []);
    var tp = tabla($('dshPorProgramar'), pp, false);
    var tg = tabla($('dshProgramados'), pg, true);
    $('dshPpN').innerHTML = resumen(pp.length, tp);
    $('dshPgN').innerHTML = resumen(pg.length, tg);
  }

  function resumen(n, total) {
    return '· ' + n + ' CC · <b style="color:#33691e">' + kg(total) + ' kg</b>';
  }

  // Trae TODOS los años, del más reciente al más antiguo, uno por llamada: el endpoint
  // sincroniza un año a la vez porque $apply de aSa no pagina y pedir la historia entera
  // de una es justo la consulta que lo atora. Si un año falla, se sigue con el resto y
  // se dice cuál falló.
  async function sincronizar() {
    var b = $('dshSync'), antes = b.textContent, hoy = new Date().getFullYear();
    b.disabled = true;
    var total = 0, nuevos = 0, fallidos = [];
    for (var anio = hoy; anio >= PRIMER_ANIO; anio--) {
      b.textContent = '↻ aSa ' + anio + '…';
      try {
        var r = await req('POST', '/programacion/asa/sincronizar-pedidos' + qs({ anio: anio }));
        total += r.filas || 0; nuevos += r.nuevas || 0;
      } catch (e) { fallidos.push(anio + ' (' + e.message + ')'); }
    }
    b.disabled = false; b.textContent = antes;
    if (global.showToast) global.showToast(
      total + ' códigos de control · ' + nuevos + ' nuevos', fallidos.length ? 'error' : 'success');
    if (fallidos.length) aviso('No se pudo traer: ' + fallidos.join(', '));
    await cargar();
  }

})(window);
