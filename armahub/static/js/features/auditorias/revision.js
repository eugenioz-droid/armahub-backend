// REVISIÓN AUTOMÁTICA DE BARRAS (8-oct) — la segunda línea del tab de Auditorías.
//
// QUÉ ES Y POR QUÉ NO ES UNA AUDITORÍA. Una auditoría es una muestra al azar que revisa
// una persona, deja hallazgos con su nombre y abre acciones contra quien cubicó. Esto es
// la máquina leyendo TODAS las barras de un código y levantando la mano donde algo no
// calza. Si una regla pudiera dejar un hallazgo, el indicador de conformidad por cubicador
// dejaría de medir a las personas y la muestra dejaría de ser aleatoria. Por eso: la señal
// sugiere, la persona decide.
//
// POR QUÉ LA PANTALLA RECORRE LOS CÓDIGOS DE A UNO. Pedirle a aSa los ítems de un código
// cuesta un par de segundos y una obra tiene decenas. Un solo request con la obra entera
// duraría minutos y se caería por timeout. Yendo de a uno se ve avanzar, se puede detener,
// y lo ya revisado queda guardado aunque el usuario se vaya. Eso es «revisar sin romper el
// sistema».
//
// LA ÚNICA BUROCRACIA ES UN CLIC. El registro de quién corrió la revisión lo escribe el
// servidor solo. Lo que sí lleva nombre es resolver una señal: «está bien» —con el motivo,
// porque sin motivo nadie puede revisarlo después— o «hay que corregirla». Que se corrigió
// NO se marca a mano: el sistema lo comprueba volviendo a revisar el código.
(function (global) {
  'use strict';

  // `meses` y `tarde` siguen siendo la ventana con la que se piden los datos —el reporte
  // por obra la usa— pero ya no son un control: 3 meses es la ventana de producción y los
  // Processed se incluyen desde el botón de arriba, que es donde importa.
  var REV = { reglas: {}, corriendo: false, parar: false, meses: 3, tarde: false,
              senales: [], mios: [], reporte: [] };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  // La misma puerta que usa el resto del tab (ver index.js): el token, el 401 que
  // desloguea y el detalle de error de FastAPI desarmado para que se pueda leer.
  async function req(metodo, url, cuerpo) {
    var opts = { method: metodo, headers: Object.assign({}, global.authHeaders()) };
    if (cuerpo !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(cuerpo);
    }
    var res = await fetch(global.apiUrl(url), opts);
    if (res.status === 401) { global.logout(); return null; }
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var det = data && data.detail;
      if (Array.isArray(det)) det = det.map(function (d) { return (d.loc || []).slice(-1) + ': ' + d.msg; }).join(' · ');
      throw new Error((det && (det.msg || det)) || ('Error ' + res.status));
    }
    return data;
  }
  function aviso(m) { if (global.showToast) global.showToast(m, 'error'); else console.error(m); }
  function ok(m) { if (global.showToast) global.showToast(m, 'success'); }

  // ── Las reglas, a la vista ────────────────────────────────────────────────────────
  function pintarReglas() {
    var el = $('revReglas');
    if (!el) return;
    var ks = Object.keys(REV.reglas);
    $('revReglasN').textContent = ks.length + ' regla(s) · la máquina marca, la decisión es de quien mira';
    el.innerHTML = ks.map(function (k) {
      var r = REV.reglas[k];
      return '<li><b>' + esc(r.nombre) + '</b> <span>' + esc(r.porque) + '</span></li>';
    }).join('');
  }

  // ── Correr la revisión, código por código ─────────────────────────────────────────
  // EL RECORRIDO, APARTE DE QUIÉN LO PIDE. Lo usan el botón «Nueva revisión» y el reloj:
  // lo único que cambia es de dónde sale la cola de códigos.
  async function recorrer(cola, revision, ui) {
    var hechos = 0, barras = 0, nuevas = 0, errores = 0;
    for (var i = 0; i < cola.length; i++) {
      if (REV.parar) break;
      var c = cola[i];
      ui.txt.textContent = 'Revisando ' + c.cc + (c.obra ? ' · ' + c.obra : '') +
        ' · ' + (i + 1) + ' de ' + cola.length +
        (nuevas ? ' · ' + nuevas + ' señal(es) nueva(s)' : '');
      ui.barra.style.width = Math.round((i / cola.length) * 100) + '%';
      try {
        var r = await req('POST', '/chequeos/revisar',
                          { job: c.job, cc: c.cc, revision: revision });
        hechos++; barras += r.barras || 0; nuevas += r.nuevas || 0;
        if (r.error) errores++;
      } catch (e) { errores++; }
    }
    ui.barra.style.width = '100%';
    ui.txt.textContent = hechos + ' código(s) · ' + num(barras) + ' barras · ' +
      nuevas + ' señal(es) nueva(s)' + (errores ? ' · ' + errores + ' con error' : '') +
      (REV.parar ? ' · detenida' : '');
    if (revision) { try { await req('PUT', '/chequeos/revision/' + revision + '/cerrar'); } catch (e) {} }
    // QUÉ HACER AHORA. Antes la corrida terminaba en «15 señales nuevas» y ahí quedaba
    // uno: la bandeja se abre en lo de ESTA revisión, para resolverlo de inmediato.
    return { hechos: hechos, nuevas: nuevas };
  }

  // ══════ LAS REVISIONES SON LA UNIDAD ══════
  //
  // Lo redefinió el usuario (13-oct): cada vez que alguien aprieta el botón o corre el
  // reloj queda un registro, y ese registro muestra SÓLO lo que apareció en él. Antes la
  // pantalla era una bolsa de 540 señales acumuladas donde no se podía preguntar «¿qué
  // salió hoy?», y por eso el trabajo no avanzaba: nadie sabe por dónde empezar una lista
  // de 540. Una revisión sin resolver NO se arrastra a la siguiente: la suya queda abierta.
  // `figs` es lo leído de aSa, por código: {cc: {estado, barras: {ref: barra}, msg}}. Es
  // caché a propósito —una lectura por código y no por barra— y se vacía al refrescar la
  // revisión, porque entonces lo de aSa puede haber cambiado.
  var REVS = { lista: [], sel: null, detalle: null, sel_items: {}, filtro_cub: '', figs: {} };
  var ESTADO_TXT = { abierta: 'Abierta', declarada: 'Corregida (por verificar)',
                     corregir: 'Corregida (por verificar)', corregida: 'Verificada',
                     aceptada: 'No aplica' };

  function _fechaHora(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' +
           ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  async function cargarRevisiones() {
    try {
      var d = await req('GET', '/chequeos/revisiones');
      REVS.lista = d.revisiones || [];
      pintarRevisiones();
      if (REVS.lista.length && !REVS.sel) {
        // Se abre sola la última que encontró algo: es lo que uno viene a ver.
        var conAlgo = REVS.lista.filter(function (r) { return r.items > 0; })[0];
        await abrirRevision((conAlgo || REVS.lista[0]).id);
      }
    } catch (e) { $('revLista').innerHTML = '<div class="revvacio">' + esc(e.message) + '</div>'; }
  }

  function pintarRevisiones() {
    var el = $('revLista');
    if (!el) return;
    $('revListaN').textContent = REVS.lista.length + ' revisión(es)';
    if (!REVS.lista.length) {
      el.innerHTML = '<div class="revvacio">Todavía no se ha hecho ninguna revisión. ' +
        'Apreta «Nueva revisión».</div>';
      return;
    }
    el.innerHTML = REVS.lista.map(function (r) {
      var pct = r.pct == null ? null : r.pct;
      // UNA REVISIÓN SIN HALLAZGOS NO SE ESCONDE: deja constancia de que se miró, que es
      // distinto de no haber mirado. Lo pidió el usuario.
      var cuerpo = !r.items
        ? '<div class="l2 vacia">sin hallazgos · ' + (r.ccs || 0) + ' código(s) revisados</div>'
        : '<div class="l2">' + r.items + ' hallazgo(s) · ' + (r.cubicadores || 0) + ' cubicador(es)' +
          (r.declaradas ? ' · ' + r.declaradas + ' por verificar' : '') + '</div>' +
          '<div class="barra"><i class="' + (pct ? '' : 'cero') + '" style="width:' + (pct || 2) + '%"></i></div>' +
          '<div class="l2">' + r.resueltas + ' de ' + r.items + ' resueltos' + (pct === 100 ? ' ✓' : '') + '</div>';
      return '<div class="revfila' + (REVS.sel === r.id ? ' on' : '') + '" data-rev="' + r.id + '">' +
        '<div class="l1"><b>#' + r.id + '</b> ' + _fechaHora(r.arrancada) +
          '<div style="flex:1"></div><span class="muted" style="font-size:10px">' +
          esc(r.por === 'reloj' ? 'automática' : (r.por || '').split('@')[0]) + '</span></div>' +
        '<div class="l2">' + esc(r.obra || '') + '</div>' + cuerpo + '</div>';
    }).join('');
    el.querySelectorAll('div[data-rev]').forEach(function (d) {
      d.addEventListener('click', function () { abrirRevision(Number(d.dataset.rev)); });
    });
  }

  async function abrirRevision(id) {
    REVS.figs = {};
    REVS.sel = id;
    pintarRevisiones();
    $('revResCuerpo').innerHTML = '<div class="revvacio">Cargando…</div>';
    try {
      REVS.detalle = await req('GET', '/chequeos/revision/' + id);
      REV.reglas = {};
      Object.keys(REVS.detalle.reglas || {}).forEach(function (k) { REV.reglas[k] = REVS.detalle.reglas[k]; });
      pintarResumen();
    } catch (e) { $('revResCuerpo').innerHTML = '<div class="revvacio">' + esc(e.message) + '</div>'; }
  }

  function pintarResumen() {
    var d = REVS.detalle, r = d.revision;
    var kpis = [
      [r.items, 'hallazgos'], [r.resueltas + ' / ' + r.items, 'resueltos'],
      [r.obras, 'obra(s)'], [r.ccs_con_hallazgo, 'código(s) con hallazgo'],
      [num(Math.round(r.kg)), 'kg en juego'], [num(r.barras), 'barras miradas']
    ];
    var sinItems = !r.items;
    $('revResCuerpo').innerHTML =
      '<div class="audh">Revisión #' + r.id + ' <span class="muted">' + _fechaHora(r.arrancada) +
        ' · ' + esc(r.por === 'reloj' ? 'automática' : (r.por || '').split('@')[0]) +
        ' · ' + esc(r.obra || '') + '</span><div style="flex:1"></div>' +
        (sinItems ? '' : '<button class="audbtn" id="revAbrirItems">Abrir los ' + r.items + ' hallazgos</button>') +
      '</div>' +
      '<div class="revkpis">' + kpis.map(function (k) {
        return '<div class="revkpi"><b>' + k[0] + '</b><span>' + k[1] + '</span></div>'; }).join('') + '</div>' +
      (sinItems
        ? '<div class="revvacio">Esta revisión no encontró hallazgos: se miraron ' + (r.ccs || 0) +
          ' código(s) y todos cumplen. Queda el registro de que se revisó.</div>'
        : '<table class="audt"><thead><tr><th>Cubicador</th><th class="num">Hallazgos</th>' +
          '<th class="num">Códigos</th><th class="num">Por verificar</th><th class="num">No aplica</th>' +
          '<th class="num">Resueltos</th><th>Avance</th></tr></thead><tbody>' +
          r.por_cubicador.map(function (c) {
            return '<tr><td>' + esc(c.cubico) + '</td>' +
              '<td class="num">' + c.n + '</td><td class="num">' + c.ccs + '</td>' +
              '<td class="num">' + (c.declaradas || '<span class="muted">·</span>') + '</td>' +
              '<td class="num">' + (c.no_aplica || '<span class="muted">·</span>') + '</td>' +
              '<td class="num">' + c.resueltas + '</td>' +
              '<td><div class="revbar2" style="max-width:120px; display:inline-block; vertical-align:middle;">' +
                '<i style="width:' + c.pct + '%"></i></div> ' +
                (c.pct === 100 ? '<b style="color:#2e7d32">100% ✓</b>' : c.pct + '%') + '</td></tr>';
          }).join('') + '</tbody></table>');
    var b = $('revAbrirItems');
    if (b) b.addEventListener('click', function () { abrirItems(); });
  }

  // ══════ LA HOJA DE TRABAJO ══════
  // El admin ve todos los ítems con filtro rápido por cubicador; el cubicador ve sólo los
  // suyos (el backend igual se lo impide si intenta declarar lo ajeno). Dos checks, como
  // los pidió el usuario: la casilla marca lo que ya se corrigió, y el botón lanza la
  // consulta a aSa SÓLO de eso — el check le dice al sistema qué ir a buscar.
  function _esAdmin() { return ['admin', 'admin_calidad'].indexOf(global.currentRole) !== -1; }

  function _misLogins() {
    // Lo que el backend resuelve por alias; acá sólo hace falta para filtrar la vista.
    var yo = (global.currentUserEmail || '').toLowerCase();
    var nom = (global.currentUserName || '').toLowerCase().split(' ').filter(Boolean);
    return function (cubico) {
      var c = (cubico || '').toLowerCase();
      if (!c) return false;
      if (c === yo) return true;
      // inicial del nombre + apellido, la misma regla de alias_de
      return nom.length >= 2 && c.slice(-nom[nom.length - 1].length) === nom[nom.length - 1] &&
             c.charAt(0) === nom[0].charAt(0);
    };
  }

  function itemsVisibles() {
    var items = (REVS.detalle || {}).items || [];
    if (!_esAdmin()) {
      var mio = _misLogins();
      items = items.filter(function (i) { return mio(i.cubico); });
    } else if (REVS.filtro_cub) {
      items = items.filter(function (i) { return (i.cubico || '(sin dato)') === REVS.filtro_cub; });
    }
    return items;
  }

  function abrirItems() {
    REVS.sel_items = {}; REVS.filtro_cub = '';
    $('revItemsModal').style.display = '';
    pintarItems();
  }
  function cerrarItems() {
    $('revItemsModal').style.display = 'none';
    if (_mirando) { _mirando.disconnect(); _mirando = null; }
  }

  function pintarItems() {
    var d = REVS.detalle, r = d.revision, items = itemsVisibles();
    $('revItemsTit').textContent = _esAdmin()
      ? 'Revisión #' + r.id + ' · ' + r.items + ' hallazgos'
      : 'Tus ' + items.length + ' hallazgos de la revisión #' + r.id;
    var hechos = items.filter(function (i) { return i.estado === 'corregida' || i.estado === 'aceptada'; }).length;
    var pct = items.length ? Math.round(hechos / items.length * 100) : 0;
    $('revItemsAvance').innerHTML = '<span>' + hechos + ' de ' + items.length + ' resueltos</span>' +
      '<div class="revbar2"><i style="width:' + pct + '%"></i></div><b>' + pct + '%</b>';
    // Filtro rápido por cubicador: sólo para quien ve a todos.
    var cubs = $('revItemsCubs');
    if (!_esAdmin()) { cubs.innerHTML = ''; }
    else {
      cubs.innerHTML = '<button data-cub="" class="' + (REVS.filtro_cub ? '' : 'on') + '">Todos ' + r.items + '</button>' +
        r.por_cubicador.map(function (c) {
          return '<button data-cub="' + esc(c.cubico) + '" class="' + (REVS.filtro_cub === c.cubico ? 'on' : '') + '">' +
                 esc(c.cubico) + ' ' + c.n + (c.pct === 100 ? ' ✓' : '') + '</button>';
        }).join('');
      cubs.querySelectorAll('button[data-cub]').forEach(function (b) {
        b.addEventListener('click', function () {
          REVS.filtro_cub = b.dataset.cub; REVS.sel_items = {}; pintarItems();
        });
      });
    }
    _pintarAcc();
    // Agrupado por código: es como se corrige (se abre un CC en aSa y se arregla lo de ahí)
    // y es como se comprueba (una lectura por código, no por barra).
    var grupos = {}, orden = [];
    items.forEach(function (i) {
      var k = i.cc || '(sin código)';
      if (!grupos[k]) { grupos[k] = { cc: i.cc, obra: i.obra, job: i.job, items: [] }; orden.push(k); }
      grupos[k].items.push(i);
    });
    $('revItemsCuerpo').innerHTML = !items.length
      ? '<div class="revvacio">No hay hallazgos tuyos en esta revisión.</div>'
      : orden.map(function (k) {
          var g = grupos[k];
          var ok = g.items.filter(function (i) { return i.estado === 'corregida' || i.estado === 'aceptada'; }).length;
          var fg = REVS.figs[g.cc];
          var quienes = {};
          g.items.forEach(function (x) { if (x.cubico) quienes[x.cubico] = 1; });
          return '<div class="revcc2" data-grupocc="' + esc(g.cc || '') + '"><h5>' +
            '<input type="checkbox" data-grupo="' + esc(k) + '"> ' +
            '<b>' + esc(g.cc || '—') + '</b> <span class="muted">' + esc(g.obra || '') + '</span>' +
            (Object.keys(quienes).length
              ? '<span class="revquien">' + esc(Object.keys(quienes).join(', ')) + '</span>' : '') +
            '<div style="flex:1"></div>' +
            (g.cc && !fg ? '<button class="audmini" data-figs="' + esc(g.cc) +
                           '" title="Lee este código en aSa y dibuja sus barras">Ver figuras</button>' : '') +
            '<span class="muted">' + ok + ' de ' + g.items.length + ' resueltos</span></h5>' +
            '<table>' + g.items.map(filaItem).join('') + '</table></div>';
        }).join('');
    _bindItems();
    // Los chips S/M/L: cambiar el tamaño rehace los SVG, así que repinta la hoja.
    if (global.audChipsTam) global.audChipsTam('revTam', pintarItems);
    _observarFiguras();
  }

  // LA BARRA DE ACCIONES SE PINTA SOLA. Antes marcar un check repintaba la hoja entera,
  // que con las figuras cargadas serían trescientos SVG rehechos por clic.
  function _pintarAcc() {
    var n = Object.keys(REVS.sel_items).length;
    var faltan = _ccsSinFigura().length;
    $('revItemsAcc').innerHTML =
      '<b>' + (n ? n + ' marcada(s) como corregida(s)' : 'Marca con el check las barras que ya corregiste') + '</b>' +
      (faltan ? '<button class="audmini" id="revAccFiguras" title="Lee los ' + faltan +
                ' código(s) en aSa y dibuja cada barra. Va de a uno para no colgarse.">' +
                'Ver las figuras (' + faltan + ')</button>' : '') +
      '<div style="flex:1"></div>' +
      '<button class="audmini ver" id="revAccVerificar"' + (n ? '' : ' disabled') +
        ' title="Lee en aSa SÓLO los códigos de lo que marcaste y comprueba si el cambio está hecho">' +
        'Verificar en aSa' + (n ? ' (' + n + ')' : '') + '</button>' +
      '<span class="muted" id="revAccMsg" style="font-size:10.5px"></span>';
    var f = $('revAccFiguras');
    if (f) f.addEventListener('click', function () { cargarTodasLasFiguras(f); });
    var ver = $('revAccVerificar');
    if (ver) ver.addEventListener('click', verificarMarcados);
  }

  // ══════ LAS FIGURAS ══════
  // Se piden POR CÓDIGO porque así las devuelve aSa y así están agrupadas las filas: una
  // lectura sirve a todas las barras de ese código. Pedirlas de a una sería multiplicar
  // por diez el tiempo para el mismo dibujo.
  function _ccsVisibles() {
    var vistos = {}, out = [];
    itemsVisibles().forEach(function (i) {
      var k = i.cc || '';
      if (k && !vistos[k]) { vistos[k] = 1; out.push({ cc: k, job: i.job }); }
    });
    return out;
  }
  function _ccsSinFigura() {
    return _ccsVisibles().filter(function (g) { return !REVS.figs[g.cc]; });
  }

  // La barra que corresponde a una señal dentro de lo leído: por referencia y, si no, por
  // la marca —el mismo par que ya usaba el detalle de una señal—.
  function _barraDe(cc, ref) {
    var c = REVS.figs[cc];
    if (!c || c.estado !== 'listo') return null;
    return c.barras[ref] || c.barras[String(ref).split('#')[0]] || null;
  }

  // LOS LADOS DE LA FIGURA, que es lo que el usuario necesita para decidir sin abrir
  // aSa. Salen de la misma lectura que trae el dibujo —`dims` de la barra normalizada—
  // así que no cuesta una llamada más. Mientras no se hayan pedido las figuras se
  // muestra sólo el lado del hallazgo, que es el dato que la señal ya trae.
  function _ladosCelda(i) {
    var det = i.detalle || {};
    var malos = {};
    (det.lados || []).forEach(function (L) { malos[L] = 1; });
    var b = _barraDe(i.cc, i.ref);
    var f = null;
    if (b && global.audBarraNormalizada) {
      try { f = global.audBarraNormalizada(b, 'asa'); } catch (e) { f = null; }
    }
    // QUÉ SIGNIFICA EL `esperado` DE CADA REGLA, en un solo lugar: en el lado corto es un
    // PISO (puede medir más y estar bien) y en los opuestos es la medida exacta que
    // debería tener. Decir «debería 100» en el primero sería pedir que mida 100 justo.
    //
    // Y VA EN CENTÍMETROS. La regla lo guarda en milímetros, que es como vienen de aSa,
    // pero la grilla de al lado está en cm (lo convierte `normalizarBarra`) y el dibujo
    // también: mostrarlos juntos sin convertir ponía «55» al lado de «mín 160».
    var cm = global.audNumCm || function (x) { return Math.round(Number(x) || 0); };
    var esp = det.esperado != null
      ? '<span class="revesp">' + (i.regla === 'lado_corto' ? 'mín ' : 'debería ') +
        cm(det.esperado / 10) + ' cm</span>' : '';
    if (!f || !f.dims) {
      // Sin la figura leída: el lado del hallazgo y su medida, que es lo que hay.
      var ns = Object.keys(malos);
      if (!ns.length) return '<span class="muted">—</span>';
      return ns.map(function (L) {
        return '<b class="revmal">' + esc(L) + ' ' +
               (det.valor != null ? cm(det.valor / 10) : '?') + '</b>';
      }).join(' · ') + ' ' + esp;
    }
    // LA FIGURA COMPLETA: todas sus letras y, entre lado y lado, el ángulo con el que
    // dobla. Con eso la barra se verifica acá y no hay que abrir aSa, que es lo que el
    // usuario pidió. Los ángulos vienen de aSa como el giro de cada lado CONTRA EL
    // ANTERIOR, así que el primero no tiene y van intercalados.
    // LA MISMA GRILLA QUE EL RESUMEN DE LA AUDITORÍA. Vive en index.js y se usa acá: las
    // dos pantallas muestran la misma barra y no tienen por qué pintarla distinto.
    if (!global.audGrillaLados) return '<span class="muted">—</span>';
    return global.audGrillaLados(f, malos, esc) + esp;
  }

  function _celda(cc, ref) {
    var c = REVS.figs[cc];
    if (!c) return '';
    if (c.estado === 'cargando') return '<span class="muted">…</span>';
    if (c.estado === 'error') return '<span class="muted" title="' + esc(c.msg || '') + '">sin dibujo</span>';
    var b = _barraDe(cc, ref);
    if (!b) return '<span class="muted" title="La barra ya no está en este código en aSa">ya no está</span>';
    if (!global.audBarraNormalizada || !global.audCeldaFigura) return '';
    try {
      return global.audCeldaFigura(global.audBarraNormalizada(b, 'asa'));
    } catch (e) { return '<span class="muted">—</span>'; }
  }

  // Se escribe SOBRE las celdas, sin repintar la hoja: lo que ya está marcado sigue
  // marcado y los formularios abiertos no se cierran.
  function _pintarFiguras(cc) {
    var caja = $('revItemsCuerpo');
    if (!caja) return;
    var porRef = {};
    itemsVisibles().forEach(function (i) { porRef[(i.cc || '') + '|' + i.ref] = i; });
    caja.querySelectorAll('td[data-fig]').forEach(function (td) {
      if (cc && td.dataset.cc !== cc) return;
      td.innerHTML = _celda(td.dataset.cc, td.dataset.fig);
      // Los lados salen de la misma lectura, así que se llenan en el mismo paso.
      var lad = td.parentNode && td.parentNode.querySelector('td.revlados');
      var it = porRef[td.dataset.cc + '|' + td.dataset.fig];
      if (lad && it) {
        var firma = lad.querySelector('div');
        lad.innerHTML = _ladosCelda(it) + (firma ? firma.outerHTML : '');
      }
    });
  }

  // Olvida lo leído de los códigos a los que pertenecen esas señales.
  function _olvidarFiguras(ids) {
    var m = {};
    ids.forEach(function (x) { m[String(x)] = 1; });
    ((REVS.detalle || {}).items || []).forEach(function (i) {
      if (m[String(i.id)] && i.cc) delete REVS.figs[i.cc];
    });
  }

  async function cargarFiguras(cc, job) {
    if (!cc || REVS.figs[cc]) return;
    REVS.figs[cc] = { estado: 'cargando', barras: {} };
    _pintarFiguras(cc);
    try {
      // Sin `element`: el código entero de una vez. aSa cobra lo mismo por uno que por
      // todos sus elementos, y las filas de un grupo son de varios elementos.
      var d = await req('GET', '/auditorias/elemento-asa?cc=' + encodeURIComponent(cc));
      var ix = {};
      (d.barras || []).forEach(function (b) {
        if (b.ref) ix[b.ref] = b;
        if (b.marca && !ix[b.marca]) ix[b.marca] = b;
      });
      REVS.figs[cc] = { estado: 'listo', barras: ix };
    } catch (e) {
      REVS.figs[cc] = { estado: 'error', barras: {}, msg: e.message };
    }
    _pintarFiguras(cc);
  }

  // SE PIDEN SOLAS, PERO SÓLO LAS QUE SE ESTÁN MIRANDO. Una columna vacía no se lee como
  // «apretá acá», se lee como que está rota —el usuario lo dijo: «faltó el renderizado»—
  // y pedir los cuarenta y ocho códigos al abrir serían dos minutos y medio de espera.
  // Con el observer, bajar por la hoja va pidiendo lo que aparece, de a uno y en orden.
  var _mirando = null;
  function _observarFiguras() {
    if (_mirando) { _mirando.disconnect(); _mirando = null; }
    if (typeof global.IntersectionObserver !== 'function') return;
    var cola = [], corriendo = false;
    async function vaciar() {
      if (corriendo) return;
      corriendo = true;
      while (cola.length) {
        var cc = cola.shift();
        if ($('revItemsModal').style.display === 'none') break;
        await cargarFiguras(cc);
        _pintarAcc();
      }
      corriendo = false;
    }
    _mirando = new global.IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (!e.isIntersecting) return;
        var cc = e.target.dataset.grupocc;
        _mirando.unobserve(e.target);
        if (cc && !REVS.figs[cc] && cola.indexOf(cc) === -1) { cola.push(cc); vaciar(); }
      });
    }, { root: $('revItemsModal'), rootMargin: '200px' });
    var caja = $('revItemsCuerpo');
    if (caja) caja.querySelectorAll('[data-grupocc]').forEach(function (d) { _mirando.observe(d); });
  }

  // DE A UNO Y CON CUENTA. Treinta códigos en paralelo tumban la sesión de aSa; en serie
  // se ve avanzar y se puede cerrar el modal sin dejar nada a medias.
  async function cargarTodasLasFiguras(boton) {
    var faltan = _ccsSinFigura();
    if (!faltan.length) return;
    if (boton) boton.disabled = true;
    for (var i = 0; i < faltan.length; i++) {
      if (!$('revItemsModal') || $('revItemsModal').style.display === 'none') break;
      if (boton) boton.textContent = 'Leyendo aSa… ' + (i + 1) + ' de ' + faltan.length;
      await cargarFiguras(faltan[i].cc, faltan[i].job);
    }
    _pintarAcc();
  }

  function filaItem(i) {
    var det = i.detalle || {}, r = (REV.reglas || {})[i.regla] || { nombre: i.regla };
    var hecho = i.estado === 'corregida', nap = i.estado === 'aceptada';
    var firma = '';
    if (nap) {
      firma = '<div class="muted" style="font-size:10px">' + esc(i.nota || '') +
              (i.resuelto_por ? ' — ' + esc(i.resuelto_por.split('@')[0]) : '') + '</div>';
    } else if (i.estado === 'declarada' && i.declarada_por) {
      firma = '<div class="muted" style="font-size:10px">declarada por ' +
              esc(i.declarada_por.split('@')[0]) + (i.declarada_el ? ' · ' + _fechaHora(i.declarada_el) : '') + '</div>';
    }
    // LOS BOTONES VAN EN LA FILA. «Aplica» es el estado normal del hallazgo —el par está
    // ahí para poder VOLVER— y «No aplica» abre el campo de explicación debajo, sin sacar
    // a nadie de la hoja. Una barra ya verificada no se discute: no lleva botones.
    var acc = hecho ? '<span class="muted">verificada</span>'
      : '<div class="revseg">' +
          '<button class="' + (nap ? '' : 'on') + '" data-aplica="' + i.id + '"' +
            (nap ? '' : ' disabled') + ' title="El hallazgo es válido y hay que corregirlo">Aplica</button>' +
          '<button class="' + (nap ? 'on' : '') + '" data-noaplica="' + i.id + '"' +
            ' title="Dejar sin efecto, con explicación firmada">No aplica</button>' +
        '</div>';
    var cols = 7;
    // LA FILA MUESTRA LA BARRA, NO LA DESCRIBE. El texto entero de la señal queda en el
    // `title`: no se pierde, pero deja de ocupar dos renglones por fila para decir lo
    // que `D 90` en rojo dice de un vistazo.
    return '<tr class="' + (hecho ? 'hecho' : nap ? 'nap' : '') + '" data-fila="' + i.id + '">' +
      '<td style="width:22px">' + (hecho || nap ? (hecho ? '✓' : '–') :
        '<input type="checkbox" data-item="' + i.id + '"' + (REVS.sel_items[i.id] ? ' checked' : '') +
        ' title="Ya la corregí">') + '</td>' +
      '<td class="revm" style="width:84px"><span class="audref" data-ver="' + i.id +
        '" title="Ver la barra en grande">' + esc(i.ref) + '</span></td>' +
      '<td class="revfig" data-fig="' + esc(i.ref) + '" data-cc="' + esc(i.cc || '') + '">' +
        _celda(i.cc, i.ref) + '</td>' +
      '<td class="revlados" title="' + esc(det.texto || '') + '">' + _ladosCelda(i) + firma + '</td>' +
      '<td style="width:104px"><span class="revreg" title="' + esc(r.porque || r.nombre || '') + '">' +
        esc(r.corto || r.nombre) + '</span></td>' +
      '<td style="width:112px"><span class="revi ' + esc(i.estado) + '">' +
        esc(ESTADO_TXT[i.estado] || i.estado) + '</span></td>' +
      '<td class="revacc" style="width:132px">' + acc + '</td></tr>' +
      '<tr class="revnapform" data-form="' + i.id + '" style="display:none"><td colspan="' + cols +
        '"><div class="revnapcaja">' +
        '<select data-mot="' + i.id + '">' + _opcionesMotivo() + '</select>' +
        '<input type="text" data-nota="' + i.id + '" placeholder="Explica por qué no aplica — lo lee quien audita y queda firmado">' +
        // «Y TODAS LAS IGUALES»: una figura que la regla marca siempre sale decenas de
        // veces en la misma obra. Explicarlo treinta veces es como no tenerlo.
        '<label title="Aplica esta misma explicación a las barras iguales de esta obra que sigan abiertas">' +
        '<input type="checkbox" data-pat="' + i.id + '"> y todas las iguales</label>' +
        '<button class="audmini ver" data-napok="' + i.id + '">Guardar</button>' +
        '<button class="audmini" data-napno="' + i.id + '">Cancelar</button>' +
        '</div></td></tr>';
  }

  function _opcionesMotivo() {
    var m = (REVS.detalle || {}).motivos || {};
    return '<option value="">¿Por qué no aplica?</option>' +
      Object.keys(m).map(function (k) {
        return '<option value="' + esc(k) + '">' + esc(m[k]) + '</option>';
      }).join('');
  }

  function _bindItems() {
    var caja = $('revItemsCuerpo');
    caja.querySelectorAll('input[data-item]').forEach(function (c) {
      c.addEventListener('change', function () {
        if (c.checked) REVS.sel_items[c.dataset.item] = true; else delete REVS.sel_items[c.dataset.item];
        _pintarAcc();
      });
    });
    caja.querySelectorAll('input[data-grupo]').forEach(function (c) {
      c.addEventListener('change', function () {
        caja.querySelectorAll('input[data-item]').forEach(function (x) {
          var tr = x.closest('.revcc2');
          if (tr && tr.querySelector('input[data-grupo]') === c) {
            x.checked = c.checked;
            if (c.checked) REVS.sel_items[x.dataset.item] = true; else delete REVS.sel_items[x.dataset.item];
          }
        });
        _pintarAcc();
      });
    });
    caja.querySelectorAll('button[data-figs]').forEach(function (b) {
      b.addEventListener('click', async function () {
        b.disabled = true; b.textContent = 'Leyendo aSa…';
        await cargarFiguras(b.dataset.figs);
        b.remove();
        _pintarAcc();
      });
    });
    // La referencia abre el render: el detalle sigue estando, pero sin un botón que
    // compita con la decisión.
    caja.querySelectorAll('[data-ver]').forEach(function (b) {
      b.addEventListener('click', function () { abrirDetalleSenal(b.dataset.ver); });
    });
    caja.querySelectorAll('button[data-aplica]').forEach(function (b) {
      b.addEventListener('click', function () { declararUno(b.dataset.aplica, 'abierta'); });
    });
    caja.querySelectorAll('button[data-noaplica]').forEach(function (b) {
      b.addEventListener('click', function () { abrirNoAplica(b.dataset.noaplica); });
    });
    caja.querySelectorAll('button[data-napno]').forEach(function (b) {
      b.addEventListener('click', function () { cerrarNoAplica(b.dataset.napno); });
    });
    caja.querySelectorAll('button[data-napok]').forEach(function (b) {
      b.addEventListener('click', function () { guardarNoAplica(b.dataset.napok); });
    });
    caja.querySelectorAll('input[data-nota]').forEach(function (c) {
      c.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') guardarNoAplica(c.dataset.nota);
      });
    });
  }

  function _marcados() { return Object.keys(REVS.sel_items).map(Number); }

  // «NO APLICA» PIDE MOTIVO Y EXPLICACIÓN, EN LA PROPIA FILA. El usuario acotó cuándo es
  // legítimo: confirmado con producción o con el cliente, o la regla no aplica a esa
  // figura. Categorizarlo permite leer después lo que el texto libre esconde: si muchos
  // marcan «la regla no aplica», el problema está en la REGLA, no en las barras.
  //
  // Antes esto eran dos `prompt()` del navegador, uno pidiendo un NÚMERO. Se hace acá
  // porque la decisión se toma mirando el dato que está en la fila de al lado.
  function _form(id) { return document.querySelector('tr[data-form="' + id + '"]'); }

  function abrirNoAplica(id) {
    var f = _form(id);
    if (!f) return;
    f.style.display = '';
    var n = f.querySelector('input[data-nota]');
    if (n) n.focus();
  }
  function cerrarNoAplica(id) {
    var f = _form(id);
    if (f) f.style.display = 'none';
  }

  async function guardarNoAplica(id) {
    var f = _form(id);
    if (!f) return;
    var mot = f.querySelector('select[data-mot]').value;
    var nota = (f.querySelector('input[data-nota]').value || '').trim();
    var pat = f.querySelector('input[data-pat]').checked;
    if (!mot) { aviso('Elige por qué no aplica.'); return; }
    if (nota.length < 10) { aviso('Hace falta la explicación: la lee quien audita.'); return; }
    await declararUno(id, 'aceptada', mot, nota, pat);
  }

  // Una barra, una decisión: así se resuelve en la fila. El lote quedó sólo para el check
  // de «ya la corregí», que es lo único que se hace de a muchas.
  async function declararUno(id, estado, motivo, nota, patron) {
    try {
      var r = await req('PUT', '/chequeos/declarar',
                        { ids: [Number(id)], estado: estado, motivo_tipo: motivo || null,
                          nota: nota || null, patron: !!patron });
      ok(estado === 'aceptada'
         ? 'Hallazgo dejado sin efecto' + (r.afectadas > 1 ? ' (' + r.afectadas + ' iguales)' : '')
         : 'El hallazgo vuelve a quedar por corregir');
      delete REVS.sel_items[id];
      await refrescarRevision();
    } catch (e) { aviso(e.message); }
  }

  // EL BOTON DEL MODAL: declara lo marcado y lo lee en aSa, en un paso. Siguen siendo dos
  // hechos distintos en el registro —quién dijo que lo corrigió y qué encontró el sistema,
  // que es lo que separa la ISO 9001 §10.2— pero para quien trabaja es un solo gesto.
  async function verificarMarcados() {
    var ids = _marcados();
    if (!ids.length) return;
    var b = $('revAccVerificar'), msg = $('revAccMsg');
    b.disabled = true; b.textContent = 'Declarando…';
    try {
      await req('PUT', '/chequeos/declarar', { ids: ids, estado: 'declarada' });
    } catch (e) { aviso(e.message); b.disabled = false; b.textContent = 'Verificar en aSa'; return; }
    b.textContent = 'Leyendo aSa…';
    var vueltas = 0;
    try {
      while (vueltas < 12) {
        var r = await req('POST', '/chequeos/comprobar-lote', { ids: ids });
        vueltas++;
        msg.textContent = r.corregidas + ' de ' + ids.length + ' ya cumplen' +
          (r.faltan_ccs ? ' · quedan ' + r.faltan_ccs + ' código(s) por leer…' : '');
        if (!r.faltan_ccs) break;
      }
      // LO DIBUJADO DE ESOS CÓDIGOS YA NO VALE: se acaba de leer aSa y la barra pudo
      // cambiar —es justamente lo que se fue a comprobar—. Se tira sólo lo de esos
      // códigos, no todo, y se vuelve a pedir cuando alguien lo mire.
      _olvidarFiguras(ids);
      REVS.sel_items = {};
      await refrescarRevision();
      ok('Verificación terminada');
    } catch (e) { aviso(e.message); msg.textContent = e.message; }
    b.disabled = false; b.textContent = 'Verificar en aSa';
  }

  async function refrescarRevision() {
    if (!REVS.sel) return;
    // Las figuras leídas NO se tiran acá: lo que cambia es el estado del hallazgo, no la
    // barra, y volver a leer treinta códigos en cada clic es justo lo que hay que evitar.
    // Se tiran al abrir otra revisión y cuando una verificación dice que aSa cambió.
    REVS.detalle = await req('GET', '/chequeos/revision/' + REVS.sel);
    pintarResumen();
    if ($('revItemsModal').style.display !== 'none') pintarItems();
    await cargarRevisiones();
    await cargarMios();
  }

  // Una revisión nueva, desde el botón de arriba: lo mismo que corre el reloj.
  async function nuevaRevision() {
    if (REV.corriendo) return;
    REV.corriendo = true; REV.parar = false;
    $('revNueva').disabled = true;
    $('revNuevaProg').style.display = '';
    $('revNuevaParar').style.display = '';
    try {
      var ini = await req('POST', '/chequeos/revision-pendientes', { tarde: REV.tarde });
      if (!(ini.ccs || []).length) {
        $('revNuevaTxt').textContent = 'No hay nada pendiente: todo lo abierto está revisado y nada cambió en aSa.';
      } else {
        await recorrer(ini.ccs, ini.revision,
                       { txt: $('revNuevaTxt'), barra: $('revNuevaBarra') });
      }
      REVS.sel = ini.revision || REVS.sel;
      await cargarRevisiones();
      if (ini.revision) await abrirRevision(ini.revision);
      await cargarReporte(); await cargarMios();
    } catch (e) { aviso(e.message); $('revNuevaTxt').textContent = e.message; }
    REV.corriendo = false;
    $('revNueva').disabled = false;
    $('revNuevaParar').style.display = 'none';
  }

  // ══════ EL DETALLE DE UNA SEÑAL ══════
  // La misma barra que ve el auditor, con el mismo motor (las piezas las expone
  // auditorias/index.js). Se pide el elemento a aSa en vivo y se busca la barra por su
  // referencia: así lo que se dibuja es lo que aSa tiene HOY, no la foto de la señal.
  var _senalesPorId = {};
  function _senal(id) {
    var s = _senalesPorId[String(id)];
    if (s) return s;
    var todas = ((REVS.detalle || {}).items || []).concat(REV.senales || [], REV.mios || []);
    todas.forEach(function (x) { _senalesPorId[String(x.id)] = x; });
    return _senalesPorId[String(id)];
  }

  async function abrirDetalleSenal(id) {
    var s = _senal(id);
    if (!s) { aviso('No encuentro esa señal en pantalla; recarga la bandeja.'); return; }
    var r = (REV.reglas || {})[s.regla] || { nombre: s.regla, porque: '' };
    var d = s.detalle || {};
    $('revSenalTit').textContent = (s.obra || s.job) + ' · ' + (s.cc || '') + ' · ' + s.ref;
    $('revSenalCuerpo').innerHTML = '<div class="revsend">' +
      '<div class="revsenfig" id="revSenalFig"><span class="muted">dibujando la barra…</span></div>' +
      '<div class="revsenq"><b>' + esc(r.nombre) + ':</b> ' + esc(d.texto || '') +
        (r.porque ? '<div class="muted" style="margin-top:3px; font-size:10.5px;">' + esc(r.porque) + '</div>' : '') + '</div>' +
      '<dl><dt>Obra</dt><dd>' + esc(s.obra || s.job) + '</dd>' +
          '<dt>Código · elemento</dt><dd>' + esc(s.cc || '') + (s.elemento ? ' · ' + esc(s.elemento) : '') + '</dd>' +
          '<dt>Barra</dt><dd><span class="audref">' + esc(s.ref) + '</span>' + (s.figura ? ' · figura ' + esc(s.figura) : '') +
          (s.diam ? ' · φ' + esc(String(s.diam)) : '') + '</dd></dl>' +
      '<dl><dt>Cubicó</dt><dd>' + esc(s.cubico || '—') + '</dd>' +
          '<dt>Estado</dt><dd>' + esc(ESTADO_TXT[s.estado] || s.estado) +
            (s.resuelto_por ? ' <span class="muted">· ' + esc(s.resuelto_por.split('@')[0]) + (s.resuelto_el ? ' ' + _fechaHora(s.resuelto_el) : '') + '</span>' : '') +
            (s.nota ? '<div class="muted">' + esc(s.nota) + '</div>' : '') + '</dd>' +
          '<dt>Vista</dt><dd>' + (s.veces || 1) + ' revisión(es) · primera ' + (s.visto_primero ? _fechaHora(s.visto_primero) : '—') + '</dd></dl>' +
      '<div class="revsenacc" id="revSenalAcc"></div></div>';
    // ESTE MODAL MIRA, NO DECIDE. Tenía los botones del flujo anterior («hay que
    // corregirla», «está bien») y era justo lo que el usuario sacó: la decisión se toma
    // en la fila, mirando el hallazgo junto a los demás del mismo código. Acá se viene a
    // ver la barra.
    $('revSenalAcc').innerHTML =
      '<span class="muted">Así está la barra hoy en aSa. La decisión se toma en la lista: ' +
      'marca el check si ya la corregiste, o «No aplica» con su explicación.</span>';
    $('revSenalModal').style.display = '';
    dibujarSenal(s);
  }

  function cerrarDetalleSenal() { $('revSenalModal').style.display = 'none'; }

  async function dibujarSenal(s) {
    var caja = $('revSenalFig');
    if (!caja) return;
    if (!global.audBarraNormalizada || !global.audCeldaFigura) {
      caja.innerHTML = '<span class="muted">El motor de dibujo no está cargado (abre primero el tab Auditorías).</span>';
      return;
    }
    try {
      var el = encodeURIComponent(s.elemento || '(sin elemento)');
      var d = await req('GET', '/auditorias/elemento-asa?cc=' + encodeURIComponent(s.cc || '') + '&element=' + el);
      var barras = d.barras || [];
      var b = barras.filter(function (x) { return x.ref === s.ref; })[0] ||
              barras.filter(function (x) { return (x.marca || '') === String(s.ref).split('#')[0]; })[0];
      if (!b) { caja.innerHTML = '<span class="muted">La barra ' + esc(s.ref) + ' ya no está en el código ' + esc(s.cc || '') + ' en aSa.</span>'; return; }
      var f = global.audBarraNormalizada(b, 'asa');
      var lados = Object.keys(f.dims || {}).sort().map(function (L) { return L + ' = ' + global.audNum(f.dims[L]); }).join(' · ');
      caja.innerHTML = '<div style="display:inline-block;">' + global.audCeldaFigura(f) + '</div>' +
        '<div class="muted" style="font-size:10.5px; margin-top:4px;">φ' + global.audNum(f.diam) + ' · ' + esc(lados) +
        (f.largo != null ? ' · largo ' + global.audNum(f.largo) + ' cm' : '') +
        (b.cant_total != null ? ' · ' + b.cant_total + ' u' : '') + '</div>';
    } catch (e) { caja.innerHTML = '<span class="muted">No se pudo dibujar: ' + esc(e.message) + '</span>'; }
  }

  // COMPROBAR UNA SEÑAL EN EL MOMENTO: el sistema vuelve a leer ese código en aSa y
  // vuelve a correr las reglas. Si la señal ya no salta, queda CORREGIDA; si salta igual,
  // lo dice, con la medida de hoy.
  async function comprobarSenal(id, boton, msg) {
    if (boton) { boton.disabled = true; boton.textContent = 'Leyendo aSa…'; }
    try {
      var r = await req('POST', '/chequeos/senal/' + id + '/comprobar', {});
      var txt = r.estado === 'corregida'
        ? 'Corregida: la barra ya cumple en aSa.'
        : 'Sigue igual en aSa' + (r.texto ? ': ' + r.texto : '') + '. Si ya la cambiaste, revisa que se haya guardado en el código ' + (r.cc || '') + '.';
      if (msg) msg.textContent = txt;
      ok(r.estado === 'corregida' ? 'Corregida' : 'Sigue igual en aSa');
      _senalesPorId = {};
      await Promise.all([refrescarRevision(), cargarReporte(), cargarMios()]);
      if (r.estado === 'corregida') setTimeout(cerrarDetalleSenal, 900);
    } catch (e) { aviso(e.message); if (msg) msg.textContent = e.message; }
    if (boton) { boton.disabled = false; boton.textContent = 'Ya se corrigió: comprobar'; }
  }

  // ══════ MIS CHEQUEOS ══════
  // La tarea del cubicador: lo que le marcaron para corregir, barra por barra, con la
  // comprobación a un clic. Antes el «hay que corregirla» era un aviso en la campana y
  // nada más: no había dónde verlo ni cómo cerrarlo.
  async function cargarMios() {
    var caja = $('revMios');
    if (!caja) return;
    try {
      var d = await req('GET', '/chequeos/mios');
      REV.mios = d.senales || [];
      if (!REV.mios.length) { caja.style.display = 'none'; return; }
      caja.style.display = '';
      caja.innerHTML = '<div class="audh">Mis chequeos por corregir <span class="muted">' + REV.mios.length +
        ' barra(s) que te marcaron. Arréglalas en aSa y aprieta «comprobar»: el sistema vuelve a leer el código en el momento.</span></div>' +
        '<table class="audt revmio"><thead><tr><th>Obra</th><th>Código</th><th>Barra</th><th>Qué tiene</th>' +
        '<th>Desde</th><th></th></tr></thead><tbody>' +
        REV.mios.map(function (s) {
          var d2 = s.detalle || {};
          return '<tr><td class="audnom" title="' + esc(s.obra || '') + '">' + esc(s.obra || s.job) + '</td>' +
            '<td class="cc">' + esc(s.cc || '') + (s.elemento ? ' <span class="muted">' + esc(s.elemento) + '</span>' : '') + '</td>' +
            // La referencia abre el render: el detalle sigue a un clic, sin un botón que
            // compita con la acción que importa.
            '<td><span class="audref" data-ver="' + s.id + '" title="Ver la barra como está hoy en aSa">' +
              esc(s.ref) + '</span></td>' +
            '<td class="revmiotx">' + esc(d2.texto || '') + '</td>' +
            '<td class="muted" style="font-size:10.5px">' + _fechaHora(s.visto_primero) +
              (s.estado === 'declarada' ? '<div>declarada, por verificar</div>' : '') + '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="audmini ver" data-cmp="' + s.id + '">Ya la corregí: comprobar</button></td></tr>';
        }).join('') + '</tbody></table>';
      caja.querySelectorAll('[data-ver]').forEach(function (b) {
        b.addEventListener('click', function () { abrirDetalleSenal(b.dataset.ver); });
      });
      caja.querySelectorAll('button[data-cmp]').forEach(function (b) {
        b.addEventListener('click', function () { comprobarSenal(b.dataset.cmp, b, null); });
      });
    } catch (e) { caja.style.display = 'none'; }
  }

  // ── El registro ───────────────────────────────────────────────────────────────────


  // ── El reporte por obra ───────────────────────────────────────────────────────────
  // UNA OBRA CON CERO SEÑALES Y CERO CÓDIGOS REVISADOS NO ESTÁ LIMPIA, ESTÁ SIN REVISAR.
  // Leerlas igual sería el peor error que puede cometer un reporte así, por eso la columna
  // «revisados» va antes que la de señales y el cero se dice con palabras.
  async function cargarReporte() {
    try {
      var d = await req('GET', '/chequeos/reporte?meses=' + REV.meses + '&tarde=' + REV.tarde);
      var t = d.total || {}, obras = d.obras || [];
      REV.reporte = obras;
      $('revRepTxt').textContent = t.obras + ' obra(s) · ' + t.revisados + ' de ' + t.ccs +
        ' código(s) revisados · ' + num(t.barras) + ' barras miradas · ' +
        t.abiertas + ' señal(es) esperando · ' + t.corregidas + ' ya corregida(s)';
      // CUÁNDO SON ESTOS DATOS. Todo lo de esta pantalla es a la última carga de aSa.
      var car = $('revRepCarga');
      if (car) car.textContent = d.ultima_carga ? 'datos de aSa al ' + _fechaHora(d.ultima_carga) : 'sin carga de aSa registrada';
      var reglas = Object.keys(d.reglas || {});
      $('revRep').innerHTML = '<table class="audt"><thead><tr><th>Obra</th><th>Cubicó</th>' +
        '<th class="num">Códigos</th><th class="num">Revisados</th>' +
        '<th class="num" title="Cuántas barras se MIRARON, no cuántas están malas.">Barras miradas</th>' +
        reglas.map(function (k) { return '<th class="num" title="Señales de la regla: ' +
          esc(d.reglas[k]) + '">' + esc(d.reglas[k]) + '</th>'; }).join('') +
        '<th class="num">Por corregir</th><th class="num">Corregidas</th></tr></thead><tbody>' +
        obras.map(function (o) {
          var falta = Math.max(0, o.ccs - o.revisados);
          // EL REPORTE DICE DÓNDE ESTÁ EL PROBLEMA, no lo resuelve: se resuelve en la
          // revisión que lo encontró, que es la que tiene el dueño y el ciclo.
          return '<tr>' +
            '<td class="audnom" title="' + esc(o.obra) + '">' + esc(o.obra) + '</td>' +
            '<td class="audnom" title="' + esc(o.cubico || '') + '">' +
              esc((o.quienes && o.quienes.length ? o.quienes : (o.cubico || '').split(', '))
                  .filter(Boolean).join(', ')) + '</td>' +
            '<td class="num">' + o.ccs + '</td>' +
            '<td class="num">' + (o.revisados
                ? o.revisados + (falta ? ' <span class="muted">(faltan ' + falta + ')</span>' : '')
                : '<span class="muted">sin revisar</span>') + '</td>' +
            '<td class="num">' + num(o.barras) + '</td>' +
            reglas.map(function (k) {
              var n = (o.por_regla || {})[k] || 0;
              return '<td class="num">' + (n || '<span class="muted">·</span>') + '</td>';
            }).join('') +
            '<td class="num">' + (o.corregir ? '<b style="color:#c62828">' + o.corregir + '</b>' : '<span class="muted">·</span>') + '</td>' +
            '<td class="num">' + (o.corregidas ? '<b style="color:#2e7d32">' + o.corregidas + '</b>' : '<span class="muted">·</span>') + '</td></tr>';
        }).join('') + '</tbody></table>';
    } catch (e) { $('revRep').innerHTML = '<div class="revvacio">' + esc(e.message) + '</div>'; }
  }

  function _fechaHora(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' +
           ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  var _listo = false;
  global.loadRevisionBarras = async function () {
    if (!$('audSubRevision')) return;
    if (!_listo) {
      _listo = true;
      $('revNueva').addEventListener('click', nuevaRevision);
      $('revNuevaParar').addEventListener('click', function () { REV.parar = true; });
      $('revItemsCerrar').addEventListener('click', cerrarItems);
      $('revItemsImprimir').addEventListener('click', function () { global.print(); });
      $('revItemsModal').addEventListener('click', function (e) { if (e.target === $('revItemsModal')) cerrarItems(); });
      $('revSenalCerrar').addEventListener('click', cerrarDetalleSenal);
      $('revSenalModal').addEventListener('click', function (e) { if (e.target === $('revSenalModal')) cerrarDetalleSenal(); });
      $('revRepImprimir').addEventListener('click', function () { global.print(); });
      // LOS PROCESSED, JUNTO AL BOTÓN QUE LOS VA A LEER. Un código Processed ya está
      // confirmado en planta, así que corregirlo suele llegar tarde; por eso no entra
      // salvo que se pida, y se pide acá y no en otra pantalla.
      $('revTarde').addEventListener('click', async function () {
        REV.tarde = !REV.tarde;
        this.classList.toggle('on', REV.tarde);
        await cargarReporte();
      });
      try {
        var r = await req('GET', '/chequeos/reglas');
        (r.reglas || []).forEach(function (x) { REV.reglas[x.codigo] = x; });
      } catch (e) { /* las reglas son texto: si fallan, la pantalla sigue sirviendo */ }
      pintarReglas();
    }
    await cargarReporte();
    // Lo mío primero y las revisiones: es lo que se viene a resolver.
    await cargarMios();
    await cargarRevisiones();
  };

  // Las dos líneas del tab. La revisión se carga la primera vez que se entra, no al abrir
  // Auditorías: son cientos de obras y nadie las pide hasta que mira este lado.
  global.switchAudSub = function (sub) {
    var hay = { auditorias: 'audSubAuditorias', revision: 'audSubRevision' };
    var bts = { auditorias: 'audSubBtnAud', revision: 'audSubBtnRev' };
    Object.keys(hay).forEach(function (k) {
      var p = $(hay[k]), b = $(bts[k]);
      if (p) p.style.display = (k === sub) ? '' : 'none';
      if (b) b.classList.toggle('on', k === sub);
    });
    var t = $('audTitulo'), ba = $('audBajada');
    if (t) t.textContent = sub === 'revision' ? '🔎 Revisión de barras' : '🔎 Auditorías de cubicación';
    if (ba) ba.textContent = sub === 'revision'
      ? 'La máquina lee todas las barras de los códigos abiertos y marca lo que no calza. La señal sugiere; la decisión es de quien mira.'
      : 'Se revisa una muestra al azar de elementos constructivos; cada hallazgo le queda como acción a quien cubicó.';
    if (sub === 'revision') global.loadRevisionBarras();
  };

  global.__revisionTest = { REV: REV, estadoTxt: ESTADO_TXT };

})(window);
