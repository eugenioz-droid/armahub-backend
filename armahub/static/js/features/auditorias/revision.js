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
      // El detalle puede ser un objeto (el 409 del cierre trae {motivo, mensaje, barras}):
      // el mensaje legible va en `message` y el objeto entero en `detalle`, con el status.
      var err = new Error((det && (det.mensaje || det.msg || (typeof det === 'string' ? det : null)))
                          || ('Error ' + res.status));
      err.status = res.status;
      err.detalle = det;
      throw err;
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
  // `total` es cuántos códigos esperaban en realidad: si la cola vino recortada al tope,
  // o si el usuario detuvo, la revisión se cierra DICIENDO cuántos quedaron. Una corrida
  // que se cortó y parece completa es peor que no tenerla: el usuario vio dos revisiones
  // que eran una sola pasada partida al medio y tuvo que preguntar por qué.
  async function recorrer(cola, revision, ui, total) {
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
    if (revision) {
      var quedaron = (total || cola.length) - hechos;
      var nota = REV.parar
        ? 'Detenida por quien la corría: quedaban ' + quedaron + ' código(s).'
        : (total && total > cola.length
            ? 'Se cortó por el tope de ' + cola.length + ' códigos: quedaban ' + (total - cola.length) + '.'
            : null);
      try { await req('PUT', '/chequeos/revision/' + revision + '/cerrar', { nota: nota }); } catch (e) {}
    }
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
  var REVS = { lista: [], sel: null, detalle: null, sel_items: {}, filtro_cub: undefined,
               figs: {}, anio: null, total: {} };
  // TODO LO RESUELTO DICE «RESUELTO» (20-oct), igual que en la auditoría: lo que dijo quien
  // lo hizo. Que aSa lo haya confirmado al cerrar se agrega, no es otro estado.
  var ESTADO_TXT = { abierta: 'Abierta', declarada: 'Resuelto',
                     corregir: 'Resuelto', corregida: 'Resuelto · aSa lo confirmó',
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
      REVS.total = d.total || {};
      if (REVS.filtro_cub === undefined) REVS.filtro_cub = _esAdmin() ? null : (_miChip() || null);
      pintarRevisiones();
      // NO SE ABRE NINGUNA SOLA. El bloque de arriba arranca mostrando el total de todas,
      // que es lo que se viene a ver; elegir una es FILTRAR, no el punto de partida.
      if (REVS.sel) await abrirRevision(REVS.sel); else pintarResumen();
    } catch (e) { $('revLista').innerHTML = '<div class="revvacio">' + esc(e.message) + '</div>'; }
  }

  // LAS REVISIONES, EN MATRIZ. Una fila por revisión y una COLUMNA POR CUBICADOR, que
  // salen del dato y no de una lista: si mañana aparece alguien nuevo, su columna aparece
  // sola. Con el filtro de año, un año que no tiene hallazgos de alguien no dibuja su
  // columna, que es lo que evita arrastrar ruido de años anteriores.
  //
  // ANTES ERAN DOS PANELES —la lista a la izquierda y el desglose por persona a la
  // derecha— y decían lo mismo dos veces. El detalle vive en el modal.
  function _anios() {
    var a = {};
    REVS.lista.forEach(function (r) { if (r.anio) a[r.anio] = 1; });
    return Object.keys(a).sort().reverse();
  }

  function _visibles() {
    if (!REVS.anio) return REVS.lista;
    return REVS.lista.filter(function (r) { return String(r.anio) === String(REVS.anio); });
  }

  // Las columnas: las personas con hallazgos en lo que se está mirando, de la que más
  // tiene a la que menos. El orden es el dato, no el alfabeto: la primera columna es
  // donde está el problema.
  function _columnas(vis) {
    var tot = {};
    vis.forEach(function (r) {
      Object.keys(r.por_cubicador || {}).forEach(function (q) {
        tot[q] = (tot[q] || 0) + (r.por_cubicador[q].n || 0);
      });
    });
    return Object.keys(tot).sort(function (a, b) { return tot[b] - tot[a]; });
  }

  // La cuenta de una revisión, entera o de UN cubicador: es lo que cambia con el filtro.
  function _cuentaDe(r, cub) {
    if (!cub) {
      return { n: r.detectados || 0, nap: r.no_aplica || 0, res: r.resueltas || 0,
               apl: r.aplican || 0, pct: r.pct };
    }
    var c = (r.por_cubicador || {})[cub];
    if (!c) return { n: 0, nap: 0, res: 0, apl: 0, pct: null };
    var apl = c.n - (c.no_aplica || 0);
    return { n: c.n, nap: c.no_aplica || 0, res: c.resueltos || 0, apl: apl,
             pct: apl ? Math.round((c.resueltos || 0) / apl * 100) : null };
  }

  function pintarRevisiones() {
    var el = $('revLista');
    if (!el) return;
    var vis = _visibles();
    $('revListaN').textContent = vis.length + ' revisión(es)' + (REVS.filtro_cub ? ' · ' + REVS.filtro_cub : '');
    // El filtro de año sólo aparece cuando hay más de uno: con un año solo es un control
    // que no decide nada.
    var anios = _anios();
    var caja = $('revAnios');
    if (caja) {
      caja.innerHTML = anios.length < 2 ? '' :
        '<button data-anio="" class="' + (REVS.anio ? '' : 'on') + '">Todos</button>' +
        anios.map(function (a) {
          return '<button data-anio="' + a + '" class="' + (String(REVS.anio) === String(a) ? 'on' : '') +
                 '">' + a + '</button>'; }).join('');
      caja.querySelectorAll('button[data-anio]').forEach(function (b) {
        b.addEventListener('click', function () {
          REVS.anio = b.dataset.anio || null; pintarRevisiones();
        });
      });
    }
    if (!vis.length) {
      el.innerHTML = '<div class="revvacio">' + (REVS.lista.length
        ? 'No hay revisiones de ese año.'
        : 'Todavía no se ha hecho ninguna revisión. Apreta «Nueva revisión».') + '</div>';
      return;
    }
    var cols = _columnas(vis), F = REVS.filtro_cub || null;
    el.innerHTML = '<table class="audt revmat"><thead><tr><th>Revisión</th>' +
      cols.map(function (q) {
        return '<th class="num' + (F && F !== q ? ' dim' : '') + '" title="' + esc(q) +
               ': lo que le FALTA, y en gris lo detectado. Para filtrar por persona, el chip de arriba.">' +
               esc(q) + '</th>'; }).join('') +
      '<th class="num" title="Lo que la máquina marcó' + (F ? ' a ' + esc(F) : '') + '.">Detectados</th>' +
      '<th class="num" title="Los que quedan después de descartar los que no aplican. ' +
      'Es contra esto que se mide el avance.">Aplican</th>' +
      '<th>Avance</th><th></th></tr></thead><tbody>' +
      vis.map(function (r) {
        var pc = r.por_cubicador || {}, t = _cuentaDe(r, F);
        var apagada = F && !t.n;
        return '<tr class="revmatf' + (REVS.sel === r.id ? ' on' : '') + (apagada ? ' apagada' : '') +
          '" data-rev="' + r.id + '" title="Clic: el resumen de arriba se filtra a esta revisión">' +
          '<td><b>#' + r.id + '</b> ' + _fechaHora(r.arrancada) +
            '<div class="l2">' + esc(r.por === 'reloj' ? 'automática' : (r.por || '').split('@')[0]) +
            ' · ' + esc(r.obra || '') + '</div></td>' +
          cols.map(function (q) {
            var c = pc[q], dim = F && F !== q ? ' dim' : '';
            if (!c || !c.n) return '<td class="num' + dim + '"><span class="muted">·</span></td>';
            var falta = c.n - (c.no_aplica || 0) - (c.resueltos || 0);
            // LO QUE FALTA, EN GRANDE; lo detectado, en gris. Es la pregunta real: a quién
            // le queda cuánto. Antes decía «113» aunque ya hubiera resuelto cincuenta.
            // La celda SOLO informa (29-oct): clicable movía todo y ponía un filtro que
            // nadie pidió. El filtro de persona vive en los chips de arriba.
            return '<td class="num' + dim + (F === q ? ' sel' : '') +
                   '" title="' + esc(q) + ' en la revisión #' + r.id + ': ' +
                   falta + ' por resolver de ' + c.n + ' detectado(s)' +
                   (c.no_aplica ? ', ' + c.no_aplica + ' no aplica(n)' : '') +
                   (c.resueltos ? ', ' + c.resueltos + ' resuelto(s)' : '') + '">' +
                   (falta <= 0 ? '<span class="revok">✓</span>' : '<b>' + falta + '</b>') +
                   '<div class="l2">de ' + c.n + '</div></td>';
          }).join('') +
          '<td class="num">' + t.n + '</td>' +
          '<td class="num"><b>' + t.apl + '</b>' +
            (t.nap ? '<div class="l2">' + t.nap + ' no aplica</div>' : '') + '</td>' +
          '<td>' + (!t.apl
            ? '<span class="muted">sin hallazgos</span>'
            : '<div class="revbar2" style="max-width:90px; display:inline-block; vertical-align:middle;">' +
              '<i style="width:' + (t.pct || 0) + '%"></i></div> ' +
              (t.pct === 100 ? '<b style="color:#2e7d32">100% ✓</b>' : (t.pct || 0) + '%')) + '</td>' +
          // «ABRIR» A SECAS (29-oct): con el número al lado se descuadraban. Entra a la hoja
          // con los filtros que estén puestos: esta revisión, y el cubicador si lo hay.
          '<td class="revacc">' + (t.apl
            ? '<button class="audmini ver" data-abrir="' + r.id + '">Abrir</button>'
            : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    // LA FILA ELIGE LA REVISIÓN, EL BOTÓN ENTRA. El cubicador se filtra arriba, con los chips.
    el.querySelectorAll('button[data-abrir]').forEach(function (b) {
      b.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        await abrirRevision(Number(b.dataset.abrir));
        abrirItems(true);
      });
    });
    el.querySelectorAll('tr.revmatf').forEach(function (tr) {
      tr.addEventListener('click', function () {
        if (REVS.sel === Number(tr.dataset.rev)) { REVS.sel = null; REVS.detalle = null; pintarResumen(); pintarRevisiones(); }
        else abrirRevision(Number(tr.dataset.rev));
      });
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

  // EL ESTADO, ARRIBA Y GLOBAL. Mira TODAS las revisiones; elegir una en la matriz lo
  // filtra a ella, y el chip de cubicador lo filtra a esa persona. Los dos filtros se
  // componen, y «Abrir» entra a la hoja con los que estén puestos. El usuario (29-oct):
  // «los cubicadores deben ser filtros no botones... si se presiona uno debe actualizarse
  // todo, la matriz, y al abrir mostrarle sólo lo de él. Así le damos el énfasis a Abrir».
  function pintarResumen() {
    var sel = REVS.sel && REVS.detalle ? REVS.detalle.revision : null;
    var T = REVS.total || {}, F = REVS.filtro_cub || null;
    // Las personas, con sus cuentas: de la revisión elegida o del total.
    var cubs = sel
      ? (sel.por_cubicador || []).map(function (c) {
          return { q: c.cubico, n: c.n, no_aplica: c.no_aplica || 0, resueltos: c.resueltas || 0,
                   viejas: c.viejas || 0, ccs: c.ccs || 0, obras: c.obras || 0 }; })
      : Object.keys(T.por_cubicador || {}).map(function (q) {
          var c = T.por_cubicador[q];
          return { q: q, n: c.n, no_aplica: c.no_aplica, resueltos: c.resueltos,
                   viejas: c.viejas || 0, ccs: c.ccs || 0, obras: c.obras || 0 }; });
    cubs.sort(function (a, b) { return (b.n - b.no_aplica - b.resueltos) - (a.n - a.no_aplica - a.resueltos) || b.n - a.n; });
    // Lo que se muestra: el total, la revisión, o esa persona dentro de eso.
    var base = sel
      ? { det: sel.detectados != null ? sel.detectados : sel.items, nap: sel.no_aplica || 0, res: sel.resueltas || 0,
          obras: sel.obras, ccs: sel.ccs_con_hallazgo, kg: sel.kg, viejas: sel.viejas || 0 }
      : { det: T.detectados || 0, nap: T.no_aplica || 0, res: T.resueltas || 0,
          obras: T.obras || 0, ccs: T.ccs_con_hallazgo || 0, kg: T.kg || 0, viejas: T.viejas || 0 };
    // Si esa persona no tiene nada en la revisión elegida, el filtro se QUEDA (lo puso el
    // usuario) y las tarjetas dicen cero: quitarlo solo sería un cambio sin que nadie lo pida.
    var mio = F ? (cubs.filter(function (c) { return c.q === F; })[0] ||
                   { q: F, n: 0, no_aplica: 0, resueltos: 0, obras: 0, ccs: 0, viejas: 0 }) : null;
    var v = mio
      ? { det: mio.n, nap: mio.no_aplica, res: mio.resueltos, obras: mio.obras, ccs: mio.ccs, kg: null, viejas: mio.viejas }
      : base;
    var apl = Math.max(0, v.det - v.nap);
    var pct = apl ? Math.round(v.res / apl * 100) : null;
    // «RESUELTOS» CONTRA LO QUE APLICA, con el mismo porcentaje que la matriz (29-oct).
    // Antes decía «18 / 233» arriba y «5%» abajo: dos números para lo mismo.
    var kpis = [
      [v.det, 'detectados'],
      [v.res + ' / ' + apl + (pct == null ? '' : ' <small>· ' + pct + '%</small>'), 'resueltos de los que aplican'],
      [v.nap, 'no aplican'],
      [v.obras || 0, 'obra(s)'],
      [v.ccs || 0, 'código(s) con hallazgo'],
      // LO QUE ENVEJECE SIN QUE NADIE LO VEA, en vez de «barras miradas» (29-oct).
      [v.viejas || 0, 'abiertas hace más de 7 días']
    ];
    if (v.kg != null) kpis.splice(5, 0, [num(Math.round(v.kg)), 'kg en juego']);
    var tit = (sel
      ? '<span class="revtit">Revisión #' + sel.id + '</span> <span class="muted">' + _fechaHora(sel.arrancada) +
        ' · ' + esc(sel.por === 'reloj' ? 'automática' : (sel.por || '').split('@')[0]) +
        ' · ' + esc(sel.obra || '') + '</span>' +
        '<button class="audmini" id="revTodo" title="Volver al total de todas las revisiones">✕ Ver todas</button>'
      : '<span class="revtit">Todas las revisiones</span> <span class="muted">' + (T.revisiones || 0) +
        ' corrida(s) · clic en una fila para filtrar</span>') +
      (F ? '<button class="revfiltro" id="revQuitaFiltro" title="Filtrado por cubicador. Clic para quitar el filtro.">' + esc(F) + ' ✕</button>' : '') +
      // EL ÉNFASIS VA EN ABRIR: un solo botón arriba que entra con lo que esté filtrado.
      (apl ? '<button class="audbtn" id="revAbrir" title="Abrir la hoja con ' +
             (sel ? 'esta revisión' : 'todas las revisiones') + (F ? ', sólo lo de ' + esc(F) : '') + '">Abrir</button>' : '');
    $('revAccTit').innerHTML = tit;
    $('revResCuerpo').innerHTML =
      '<div class="revkpis">' + kpis.map(function (k) {
        return '<div class="revkpi"><b>' + k[0] + '</b><span>' + k[1] + '</span></div>'; }).join('') + '</div>' +
      (!base.det
        ? '<div class="revvacio">' + (sel
            ? 'Esta revisión no encontró hallazgos: se miraron ' + (sel.ccs || 0) +
              ' código(s) y todos cumplen. Queda el registro de que se revisó.'
            : 'Todavía no hay hallazgos.') + '</div>'
        // LOS CUBICADORES SON FILTROS, no botones de entrar. Sólo el nombre: los números
        // van en las tarjetas y en la matriz, no en el chip («que no contabilice ni muestre
        // los números en el botón de filtro», 29-oct).
        : '<div class="dshchips revcubs">' + cubs.map(function (c) {
            var falta = c.n - c.no_aplica - c.resueltos;
            return '<button data-filtro-cub="' + esc(c.q) + '" class="' +
                   (F === c.q ? 'on ' : '') + (falta <= 0 ? 'listo' : '') +
                   '" title="Filtrar todo por ' + esc(c.q) + '">' + esc(c.q) + '</button>'; }).join('') + '</div>');
    var vt = $('revTodo');
    if (vt) vt.addEventListener('click', function (e) {
      e.stopPropagation();
      REVS.sel = null; REVS.detalle = null;
      pintarResumen(); pintarRevisiones();
    });
    var ab = $('revAbrir');
    if (ab) ab.addEventListener('click', function () { abrirItems(true); });
    var qf = $('revQuitaFiltro');
    if (qf) qf.addEventListener('click', function (e) {
      e.stopPropagation(); REVS.filtro_cub = null; pintarResumen(); pintarRevisiones();
    });
    $('revResCuerpo').querySelectorAll('button[data-filtro-cub]').forEach(function (x) {
      x.addEventListener('click', function () {
        REVS.filtro_cub = (REVS.filtro_cub === x.dataset.filtroCub) ? null : x.dataset.filtroCub;
        pintarResumen(); pintarRevisiones();
      });
    });
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
    // TODOS VEN TODO (21-oct). Antes el cubicador veía sólo lo suyo; el usuario: «no quiero
    // que no puedan ver las observaciones de los otros». El chip filtra, para cualquiera;
    // al abrir queda puesto en el propio, que es por donde se empieza (`_miChip`).
    if (REVS.filtro_cub) {
      items = items.filter(function (i) { return (i.cubico || '(sin dato)') === REVS.filtro_cub; });
    }
    return items;
  }

  async function abrirItems(conFiltro) {
    REVS.sel_items = {};
    REVS.cc_abierto = null;
    // Sin revisión elegida se abren TODAS: el estado de arriba es global, así que el
    // botón y los chips de cubicador tienen que poder entrar a todo.
    if (!REVS.detalle || (REVS.sel && REVS.detalle.revision.id !== REVS.sel)
        || (!REVS.sel && !REVS.detalle.revision.todas)) {
      try {
        REVS.detalle = await req('GET', '/chequeos/revision/' + (REVS.sel || 0));
      } catch (e) { aviso(e.message); return; }
    }
    // El filtro de cubicador es el de arriba: la hoja abre con lo que esté puesto.
    $('revItemsModal').style.display = '';
    pintarItems();
  }
  function cerrarItems() {
    $('revItemsModal').style.display = 'none';
    // El chip del modal y el de arriba son el MISMO filtro: al volver, arriba se repinta.
    pintarResumen(); pintarRevisiones();
    if (_mirando) { _mirando.disconnect(); _mirando = null; }
  }

  function pintarItems() {
    var d = REVS.detalle, r = d.revision, items = itemsVisibles();
    $('revItemsTit').textContent = 'Revisión #' + r.id + ' · ' +
      (REVS.filtro_cub ? items.length + ' de ' + r.items + ' hallazgos · ' + REVS.filtro_cub
                       : r.items + ' hallazgos') + (REVS.cc_abierto ? ' · ' + REVS.cc_abierto : '');
    var RES = { corregida: 1, aceptada: 1, declarada: 1, corregir: 1 };
    function _resueltos(lista) { return lista.filter(function (i) { return RES[i.estado]; }).length; }
    var hechos = _resueltos(items);
    var pct = items.length ? Math.round(hechos / items.length * 100) : 0;
    $('revItemsAvance').innerHTML = '<span>' + hechos + ' de ' + items.length + ' resueltos</span>' +
      '<div class="revbar2"><i style="width:' + pct + '%"></i></div><b>' + pct + '%</b>';
    // Filtro rápido por cubicador: sólo para quien ve a todos.
    var cubs = $('revItemsCubs');
    // Los chips de cubicador son para todos (21-oct): el propio viene puesto, «Todos» abre.
    {
      // Sólo el nombre, igual que arriba: la cuenta ya está en «N de M hallazgos».
      cubs.innerHTML = '<button data-cub="" class="' + (REVS.filtro_cub ? '' : 'on') + '">Todos</button>' +
        r.por_cubicador.map(function (c) {
          return '<button data-cub="' + esc(c.cubico) + '" class="' + (REVS.filtro_cub === c.cubico ? 'on ' : '') +
                 (c.pct === 100 ? 'listo' : '') + '">' + esc(c.cubico) + '</button>';
        }).join('');
      cubs.querySelectorAll('button[data-cub]').forEach(function (b) {
        b.addEventListener('click', function () {
          REVS.filtro_cub = b.dataset.cub || null; REVS.cc_abierto = null; REVS.sel_items = {}; pintarItems();
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
    // PRIMERO LOS CÓDIGOS, DESPUÉS LAS BARRAS (21-oct). El usuario: «mejor separar: un
    // listado con los CC y cantidad de hallazgos; luego click y se abre el modal con las
    // barras de ese CC». Es como se corrige —un código a la vez— y la hoja deja de ser
    // una sola tira de 233 filas.
    var abierto = REVS.cc_abierto && grupos[REVS.cc_abierto] ? grupos[REVS.cc_abierto] : null;
    if (REVS.cc_abierto && !abierto) REVS.cc_abierto = null;
    $('revItemsCuerpo').innerHTML = !items.length
      ? '<div class="revvacio">No hay hallazgos tuyos en esta revisión.</div>'
      : (!abierto
        ? '<table class="revlista"><tr class="revhead"><th>Código</th><th>Obra</th><th>Cubicó</th>' +
          '<th class="revn">Hallazgos</th><th class="revn">Resueltos</th><th></th></tr>' +
          orden.map(function (k) {
            var g = grupos[k], ok = _resueltos(g.items), quienes = {};
            g.items.forEach(function (x) { if (x.cubico) quienes[x.cubico] = 1; });
            return '<tr class="revccfila' + (ok >= g.items.length ? ' hecho' : '') + '" data-abrircc="' + esc(k) +
              '" title="Abrir las barras de este código">' +
              '<td><b>' + esc(g.cc || '—') + '</b></td><td class="muted">' + esc(g.obra || '') + '</td>' +
              '<td>' + esc(Object.keys(quienes).join(', ')) + '</td>' +
              '<td class="revn">' + g.items.length + '</td><td class="revn">' + ok + '</td>' +
              '<td style="text-align:right"><span class="audmini">Abrir ›</span></td></tr>';
          }).join('') + '</table>'
        : (function () {
            var g = abierto, k = REVS.cc_abierto, ok = _resueltos(g.items), fg = REVS.figs[g.cc], quienes = {};
            g.items.forEach(function (x) { if (x.cubico) quienes[x.cubico] = 1; });
            return '<div class="revvolver"><button class="audmini" data-volvercc="1">‹ Todos los códigos</button></div>' +
              '<div class="revcc2" data-grupocc="' + esc(g.cc || '') + '"><h5>' +
              '<input type="checkbox" data-grupo="' + esc(k) + '"> ' +
              '<b>' + esc(g.cc || '—') + '</b> <span class="muted">' + esc(g.obra || '') + '</span>' +
              (Object.keys(quienes).length
                ? '<span class="revquien">' + esc(Object.keys(quienes).join(', ')) + '</span>' : '') +
              '<div style="flex:1"></div>' +
              (g.cc && !fg ? '<button class="audmini" data-figs="' + esc(g.cc) +
                             '" title="Lee este código en aSa y dibuja sus barras">Ver figuras</button>' : '') +
              '<span class="muted">' + ok + ' de ' + g.items.length + ' resueltos</span></h5>' +
              _tablaGrupo(g) + '</div>';
          })());
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
    // CUÁNTO HAY MARCADO RESUELTO Y SIN CERRAR: es lo que el botón de cerrar va a llevar a
    // aSa. Se cuenta sobre lo visible (lo mío, o lo filtrado si soy admin).
    var porCerrar = itemsVisibles().filter(function (i) {
      return i.estado === 'declarada' || i.estado === 'corregir'; }).length;
    $('revItemsAcc').innerHTML =
      '<b>' + (n ? n + ' barra(s) marcada(s)' : 'Marca con el check para resolver varias de una vez') + '</b>' +
      (faltan ? '<button class="audmini" id="revAccFiguras" title="Lee los ' + faltan +
                ' código(s) en aSa y dibuja cada barra. Va de a uno para no colgarse.">' +
                'Ver las figuras (' + faltan + ')</button>' : '') +
      '<div style="flex:1"></div>' +
      // LOS TRES VERBOS, DE A MUCHAS (20-oct). «Muchas veces el hallazgo es el mismo para
      // más de un ítem»: se marcan los checks y lo que se hace se replica. «No aplica»
      // pide la explicación UNA vez y vale para todas; «Resuelto» y «Aplica» van directo.
      '<div class="revseg">' +
        '<button data-lote="abierta"' + (n ? '' : ' disabled') +
          ' title="Las marcadas vuelven a quedar por resolver">Aplica' + (n ? ' (' + n + ')' : '') + '</button>' +
        '<button data-lote="aceptada" id="revAccNoAplica"' + (n ? '' : ' disabled') +
          ' title="Deja sin efecto las marcadas, con una sola explicación para todas">' +
          'No aplica' + (n ? ' (' + n + ')' : '') + '</button>' +
      '</div>' +
      '<button class="audbres" data-lote="declarada"' + (n ? '' : ' disabled') +
        ' title="Marca las barras marcadas como resueltas: ya hiciste el cambio en aSa. Al cerrar ' +
        'se comprueba contra aSa y, si algo sigue igual, te avisa.">Resuelto' + (n ? ' (' + n + ')' : '') + '</button>' +
      // CERRAR VA A aSa: comprueba todo lo que está marcado resuelto y avisa, sin bloquear,
      // lo que allá sigue como estaba. Mismo flujo que la auditoría.
      '<button class="audenviar" id="revAccCerrar"' + (porCerrar ? '' : ' disabled') +
        ' title="' + (porCerrar
          ? 'Comprueba en aSa las ' + porCerrar + ' barra(s) resueltas y las da por cerradas. Si alguna ' +
            'sigue como estaba, te lo dice antes.'
          : 'No hay barras resueltas por cerrar.') + '">Cerrar lo resuelto' +
        (porCerrar ? ' (' + porCerrar + ')' : '') + '</button>' +
      '<span class="muted" id="revAccMsg" style="font-size:10.5px"></span>' +
      // El formulario del «no aplica» de lote: el mismo motivo y la misma explicación que
      // pide una barra suelta, porque el registro vale lo mismo para una que para cien.
      '<div class="revnapcaja" id="revAccNapForm" style="display:none; width:100%; margin-top:6px;">' +
        '<select id="revAccNapMot">' + _opcionesMotivo() + '</select>' +
        '<input type="text" id="revAccNapNota" placeholder="Explica por qué no aplican — lo lee quien audita y queda firmado">' +
        '<button class="audmini ver" id="revAccNapOk">Guardar</button>' +
        '<button class="audmini" id="revAccNapNo">Cancelar</button>' +
      '</div>';
    var f = $('revAccFiguras');
    if (f) f.addEventListener('click', function () { cargarTodasLasFiguras(f); });
    var lr = document.querySelector('#revItemsAcc button[data-lote="declarada"]');
    if (lr) lr.addEventListener('click', function () { loteMarcadas('declarada', lr); });
    var la = document.querySelector('#revItemsAcc button[data-lote="abierta"]');
    if (la) la.addEventListener('click', function () { loteMarcadas('abierta', la); });
    var cz = $('revAccCerrar');
    if (cz) cz.addEventListener('click', function () { cerrarResueltos(false); });
    var na = $('revAccNoAplica');
    // Mismo trato que el de la fila: el botón queda marcado mientras se escribe el motivo.
    if (na) na.addEventListener('click', function () {
      $('revAccNapForm').style.display = 'flex';
      na.classList.add('eligiendo');
      $('revAccNapNota').focus();
    });
    var no = $('revAccNapNo');
    if (no) no.addEventListener('click', function () {
      $('revAccNapForm').style.display = 'none';
      if (na) na.classList.remove('eligiendo');
    });
    var si = $('revAccNapOk');
    if (si) si.addEventListener('click', noAplicaMarcadas);
    var nota = $('revAccNapNota');
    if (nota) nota.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') noAplicaMarcadas();
    });
  }

  // DEJAR SIN EFECTO LO MARCADO, con UNA explicación para todas. El backend ya recibía
  // varios ids: lo que faltaba era la pantalla.
  async function noAplicaMarcadas() {
    var ids = _marcados();
    if (!ids.length) return;
    var mot = $('revAccNapMot').value;
    var nota = ($('revAccNapNota').value || '').trim();
    if (!mot) { aviso('Elige por qué no aplican.'); return; }
    if (nota.length < 10) { aviso('Hace falta la explicación: la lee quien audita.'); return; }
    var b = $('revAccNapOk');
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      var r = await req('PUT', '/chequeos/declarar',
                        { ids: ids, estado: 'aceptada', motivo_tipo: mot, nota: nota });
      ok((r.afectadas || ids.length) + ' barra(s) dejadas sin efecto');
      REVS.sel_items = {};
      await refrescarRevision();
    } catch (e) {
      aviso(e.message);
      b.disabled = false; b.textContent = 'Guardar';
    }
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
  // Mi chip en el TOTAL: el cubicador entra a la pestaña con su filtro puesto (es por donde
  // empieza) y lo puede quitar; el admin entra sin filtro.
  function _miChip() {
    var mio = _misLogins(), pc = (REVS.total || {}).por_cubicador || {};
    return Object.keys(pc).filter(function (q) { return mio(q); })[0] || '';
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

  // Olvida lo leído de los códigos a los que pertenecen esas señales.
  // LA FIGURA, CUANDO LLEGA. Sólo el dibujo: los lados ya están en la fila, salidos de la
  // señal, y no cambian con la lectura.
  function _pintarFiguras(cc) {
    var caja = $('revItemsCuerpo');
    if (!caja) return;
    caja.querySelectorAll('td[data-fig]').forEach(function (td) {
      if (cc && td.dataset.cc !== cc) return;
      td.innerHTML = _celda(td.dataset.cc, td.dataset.fig);
    });
  }

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
        if (!cc) return;
        // DIBUJAR ES CARO (21-oct): un SVG por barra, y con «Todos» eran 375 de golpe cada
        // vez que se repintaba la hoja —por eso se abría tan lento—. El grupo se dibuja
        // cuando entra a la vista, ya esté la figura cargada o haya que ir a buscarla.
        if (REVS.figs[cc] && REVS.figs[cc].estado !== 'cargando') { _pintarFiguras(cc); return; }
        if (!REVS.figs[cc] && cola.indexOf(cc) === -1) { cola.push(cc); vaciar(); }
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


  // UN SOLO ENCABEZADO POR CÓDIGO (21-oct, lo pidió el usuario: «estamos repitiendo A, B y
  // C muchas veces»): Marca · Figura · A B C… · α1 α2… · Esperado · Regla · Estado. Las
  // letras y los ángulos salen de la señal (`detalle.lados_all`, guardado al detectar), así
  // que no dependen de haber leído aSa; la figura sólo dibuja. Las señales de antes de hoy
  // traen sólo los lados marcados hasta la próxima revisión, que las rellena.
  function _colsGrupo(items) {
    var letras = [], vistas = {}, nang = 0;
    items.forEach(function (i) {
      var det = i.detalle || {}, la = det.lados_all || [];
      la.forEach(function (l, k) {
        if (!vistas[l[0]]) { vistas[l[0]] = 1; letras.push(l[0]); }
        if (k > 0 && l[2] != null) nang = Math.max(nang, k);
      });
      if (!la.length) (det.lados || []).forEach(function (L) { if (!vistas[L]) { vistas[L] = 1; letras.push(L); } });
    });
    letras.sort();
    return { letras: letras, nang: nang };
  }

  function _tablaGrupo(g) {
    var c = _colsGrupo(g.items), ang = '';
    for (var k = 1; k <= c.nang; k++) ang += '<th class="revn reva">α' + k + '</th>';
    return '<table><tr class="revhead"><th style="width:22px"></th><th>Marca</th><th>Figura</th>' +
      c.letras.map(function (L) { return '<th class="revn">' + esc(L) + '</th>'; }).join('') + ang +
      '<th class="revn" title="Lo que la regla pide: un mínimo en el lado corto, la medida exacta en los opuestos">Esperado</th>' +
      '<th>Regla</th><th>Estado</th><th></th></tr>' +
      g.items.map(function (i) { return filaItem(i, c); }).join('') + '</table>';
  }

  function filaItem(i, c) {
    var det = i.detalle || {}, r = (REV.reglas || {})[i.regla] || { nombre: i.regla };
    var hecho = i.estado === 'corregida', nap = i.estado === 'aceptada';
    var resuelto = hecho || i.estado === 'declarada' || i.estado === 'corregir';
    var cm = global.audNumCm || function (x) { return Math.round(Number(x) || 0); };
    var malos = {}, porL = {}, angs = [];
    (det.lados || []).forEach(function (L) { malos[L] = 1; });
    (det.lados_all || []).forEach(function (l, k) { porL[l[0]] = l[1]; if (k > 0) angs[k - 1] = l[2]; });
    if (!(det.lados_all || []).length) (det.lados || []).forEach(function (L) { porL[L] = det.valor; });
    var firma = '';
    if (nap) {
      firma = '<div class="muted" style="font-size:10px">' + esc(i.nota || '') +
              (i.resuelto_por ? ' — ' + esc(i.resuelto_por.split('@')[0]) : '') + '</div>';
    } else if (resuelto && i.declarada_por) {
      firma = '<div class="muted" style="font-size:10px">resuelto por ' +
              esc(i.declarada_por.split('@')[0]) + (i.declarada_el ? ' · ' + _fechaHora(i.declarada_el) : '') +
              (hecho ? ' · aSa lo confirmó' : '') + '</div>';
    }
    // LOS BOTONES, EN LÍNEA: Aplica | No aplica, y Resuelto a continuación con una
    // separación chica (lo pidió el usuario). Una barra que aSa ya confirmó no lleva.
    // «No aplica» ES resolver: la fila queda verde al guardar, sin otro clic.
    var acc = hecho ? '<span class="muted">confirmada</span>'
      : '<div class="revaccs"><div class="revseg">' +
          '<button class="' + (nap ? '' : 'on') + '" data-aplica="' + i.id + '"' +
            (nap ? '' : ' disabled') + ' title="El hallazgo es válido y hay que corregirlo">Aplica</button>' +
          '<button class="' + (nap ? 'on' : '') + '" data-noaplica="' + i.id + '"' +
            ' title="Dejar sin efecto, con explicación firmada. Queda resuelta.">No aplica</button>' +
        '</div>' +
        (nap ? '' : (resuelto
          ? '<button class="audbres on" data-deshacer="' + i.id + '" title="Marcada como resuelta. ' +
            'Vuelve a apretar si todavía no está cambiada en aSa.">✓ Resuelto</button>'
          : '<button class="audbres" data-resuelto="' + i.id + '" title="Márcala cuando ya hayas ' +
            'hecho el cambio en aSa. Al cerrar se comprueba contra aSa y, si algo sigue igual, ' +
            'te avisa.">Resuelto</button>')) + '</div>';
    var cols = 7 + c.letras.length + c.nang, angTd = '';
    for (var k = 0; k < c.nang; k++) {
      angTd += '<td class="revn reva">' + (angs[k] != null ? Math.abs(Math.round(angs[k])) + '°' : '') + '</td>';
    }
    var esp = det.esperado != null ? (i.regla === 'lado_corto' ? 'mín ' : '') + cm(det.esperado / 10) : '';
    return '<tr class="' + (hecho ? 'hecho' : nap ? 'nap' : '') + '" data-fila="' + i.id + '">' +
      '<td style="width:22px">' + (hecho ? '✓' :
        '<input type="checkbox" data-item="' + i.id + '"' + (REVS.sel_items[i.id] ? ' checked' : '') +
        ' title="Marcar para resolver varias de una vez">') + '</td>' +
      '<td class="revm"><span class="audref" data-ver="' + i.id +
        '" title="Ver la barra en grande">' + esc(i.ref) + '</span>' + firma + '</td>' +
      '<td class="revfig" data-fig="' + esc(i.ref) + '" data-cc="' + esc(i.cc || '') + '"></td>' +
      c.letras.map(function (L) {
        return '<td class="revn' + (malos[L] ? ' mal' : '') + '">' + (porL[L] != null ? cm(porL[L] / 10) : '') + '</td>';
      }).join('') + angTd +
      '<td class="revn revesp">' + esc(esp) + '</td>' +
      '<td><span class="revreg" title="' + esc(det.texto || r.porque || r.nombre || '') + '">' +
        esc(r.corto || r.nombre) + '</span></td>' +
      '<td><span class="revi ' + esc(i.estado) + '">' + esc(ESTADO_TXT[i.estado] || i.estado) + '</span></td>' +
      '<td class="revacc">' + acc + '</td></tr>' +
      '<tr class="revnapform" data-form="' + i.id + '" style="display:none"><td colspan="' + cols +
        '"><div class="revnapcaja">' +
        '<select data-mot="' + i.id + '">' + _opcionesMotivo() + '</select>' +
        '<input type="text" data-nota="' + i.id + '" placeholder="Explica por qué no aplica — lo lee quien audita y queda firmado">' +
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
    // Abrir un código, y volver a la lista. Las dos limpian lo marcado: era de otro código.
    caja.querySelectorAll('[data-abrircc]').forEach(function (b) {
      b.addEventListener('click', function () { REVS.cc_abierto = b.dataset.abrircc; REVS.sel_items = {}; pintarItems(); });
    });
    caja.querySelectorAll('[data-volvercc]').forEach(function (b) {
      b.addEventListener('click', function () { REVS.cc_abierto = null; REVS.sel_items = {}; pintarItems(); });
    });
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
    // «Resuelto» por fila, y su vuelta atrás.
    caja.querySelectorAll('button[data-resuelto]').forEach(function (b) {
      b.addEventListener('click', function () { declararUno(b.dataset.resuelto, 'declarada', null, null, false, b); });
    });
    caja.querySelectorAll('button[data-deshacer]').forEach(function (b) {
      b.addEventListener('click', function () { declararUno(b.dataset.deshacer, 'abierta', null, null, false, b); });
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

  function _botones(id) {
    return { ap: document.querySelector('button[data-aplica="' + id + '"]'),
             na: document.querySelector('button[data-noaplica="' + id + '"]') };
  }

  // EL BOTÓN TIENE QUE DECIR QUE LO APRETASTE (19-oct). «No aplica» sólo desplegaba el
  // campo de abajo y el par de botones quedaba igual que antes: el usuario apretaba y nada
  // cambiaba de color, así que parecía que el clic no había entrado. Mientras se está
  // escribiendo el motivo, el botón queda marcado como lo que estás eligiendo —y se
  // distingue del decidido, que es el que queda firme al guardar—.
  function abrirNoAplica(id) {
    var f = _form(id);
    if (!f) return;
    f.style.display = '';
    var b = _botones(id);
    if (b.na) b.na.classList.add('eligiendo');
    if (b.ap) { b.ap.classList.remove('on'); b.ap.disabled = false; }
    var n = f.querySelector('input[data-nota]');
    if (n) n.focus();
  }
  function cerrarNoAplica(id) {
    var f = _form(id);
    if (f) f.style.display = 'none';
    // Vuelve a como estaba: nada se decidió.
    var b = _botones(id);
    if (b.na) b.na.classList.remove('eligiendo');
    if (b.ap) { b.ap.classList.add('on'); b.ap.disabled = true; }
  }

  async function guardarNoAplica(id) {
    var f = _form(id);
    if (!f) return;
    var mot = f.querySelector('select[data-mot]').value;
    var nota = (f.querySelector('input[data-nota]').value || '').trim();
    var pat = f.querySelector('input[data-pat]').checked;
    if (!mot) { aviso('Elige por qué no aplica.'); return; }
    if (nota.length < 10) { aviso('Hace falta la explicación: la lee quien audita.'); return; }
    await declararUno(id, 'aceptada', mot, nota, pat,
                      f.querySelector('button[data-napok]'));
  }

  // Una barra, una decisión: así se resuelve en la fila. El lote quedó sólo para el check
  // de «ya la corregí», que es lo único que se hace de a muchas.
  async function declararUno(id, estado, motivo, nota, patron, boton) {
    // MIENTRAS EL SERVIDOR RESPONDE, SE VE. Son dos viajes (declarar y volver a leer la
    // revisión): sin esto el botón se queda mudo un segundo largo y se vuelve a apretar.
    var b = _botones(id);
    var tocados = [boton, b.ap, b.na].filter(Boolean);
    tocados.forEach(function (x) { x.disabled = true; x.classList.add('audwait'); });
    try {
      var r = await req('PUT', '/chequeos/declarar',
                        { ids: [Number(id)], estado: estado, motivo_tipo: motivo || null,
                          nota: nota || null, patron: !!patron });
      ok(estado === 'aceptada'
         ? 'Hallazgo dejado sin efecto' + (r.afectadas > 1 ? ' (' + r.afectadas + ' iguales)' : '')
         : estado === 'declarada' ? 'Resuelto' : 'Vuelve a quedar por resolver');
      delete REVS.sel_items[id];
      // LO QUE YA SE SABE SE PINTA AL TIRO. El servidor confirmó; el refresco de abajo es
      // para los contadores y para las iguales que pudo arrastrar el patrón. Si ese
      // refresco no corre —el modal se abrió sin revisión elegida, la lista llegó de otra
      // pantalla—, la fila igual queda como quedó, que es lo que el usuario estaba
      // esperando ver.
      ((REVS.detalle || {}).items || []).forEach(function (i) {
        if (String(i.id) === String(id)) {
          i.estado = estado;
          if (estado === 'aceptada') { i.nota = nota || i.nota; i.motivo_tipo = motivo || i.motivo_tipo; }
        }
      });
      if ($('revItemsModal') && $('revItemsModal').style.display !== 'none') pintarItems();
      await refrescarRevision();
    } catch (e) {
      aviso(e.message);
      tocados.forEach(function (x) { x.classList.remove('audwait'); });
      // Se repinta en vez de rehabilitar a mano: el par Aplica|No aplica tiene un botón
      // apagado a propósito según el estado, y devolverlo «a mano» lo dejaba al revés.
      if ($('revItemsModal') && $('revItemsModal').style.display !== 'none') pintarItems();
    }
  }

  // DE A MUCHAS (20-oct): lo marcado con los checks recibe el mismo verbo de una vez —
  // «Resuelto» o «Aplica»—. «No aplica» de a muchas va por su propio formulario, porque
  // pide la explicación. «Muchas veces el hallazgo es el mismo para más de un ítem».
  async function loteMarcadas(estado, boton) {
    var ids = _marcados();
    if (!ids.length) return;
    var txt = boton ? boton.textContent : '';
    if (boton) { boton.disabled = true; boton.classList.add('audwait'); }
    try {
      var r = await req('PUT', '/chequeos/declarar', { ids: ids, estado: estado });
      ok((estado === 'declarada' ? 'Resueltas: ' : 'Vuelven a quedar por resolver: ') +
         (r.afectadas || ids.length));
      ((REVS.detalle || {}).items || []).forEach(function (i) {
        if (ids.indexOf(Number(i.id)) !== -1) i.estado = estado;
      });
      REVS.sel_items = {};
      if ($('revItemsModal') && $('revItemsModal').style.display !== 'none') pintarItems();
      await refrescarRevision();
    } catch (e) {
      aviso(e.message);
      if (boton) { boton.disabled = false; boton.classList.remove('audwait'); boton.textContent = txt; }
    }
  }

  // CERRAR LO RESUELTO VA A aSa (20-oct). Mismo flujo que la auditoría: el servidor le
  // pregunta a aSa en vivo por cada barra marcada resuelta; la que cumple queda confirmada,
  // y si alguna sigue como estaba contesta 409 con la lista. Acá se muestra y quien cierra
  // decide: volver a revisar, o cerrar igual —y entonces queda firmado que lo confirmó él—.
  async function cerrarResueltos(confirmar) {
    var b = $('revAccCerrar'), msg = $('revAccMsg');
    var ids = itemsVisibles().filter(function (i) {
      return i.estado === 'declarada' || i.estado === 'corregir'; }).map(function (i) { return Number(i.id); });
    if (!ids.length) return;
    if (b) { b.disabled = true; b.classList.add('audwait'); b.textContent = confirmar ? 'Cerrando…' : 'Comprobando en aSa…'; }
    try {
      var r = await req('POST', '/chequeos/cerrar-resueltas', { ids: ids, confirmar: !!confirmar });
      // Lo dibujado de esos códigos ya no vale: se acaba de leer aSa y la barra pudo cambiar.
      _olvidarFiguras(ids);
      ok('Cerrado: aSa confirmó ' + (r.cumplen || []).length + ' de ' + ids.length +
         ((r.siguen_igual || []).length ? ' · ' + r.siguen_igual.length + ' cerradas bajo tu confirmación' : ''));
      if (msg) msg.textContent = '';
      await refrescarRevision();
    } catch (e) {
      var det = e.detalle || null;
      if (e.status === 409 && det && det.motivo === 'sigue_igual') {
        _avisoCierreRev(det);
      } else {
        aviso(e.message);
        if (msg) msg.textContent = e.message;
      }
      if (b) { b.disabled = false; b.classList.remove('audwait'); }
      _pintarAcc();
    }
  }

  function _avisoCierreRev(det) {
    var viejo = $('revCierreAviso');
    if (viejo) viejo.remove();
    var div = document.createElement('div');
    div.id = 'revCierreAviso';
    div.className = 'audnota audcierre';
    div.innerHTML = '<b>' + esc(det.mensaje) + '</b>' +
      (det.cumplen ? '<div class="muted" style="font-size:10.5px">aSa confirmó ' + det.cumplen + '.</div>' : '') +
      '<ul>' + (det.barras || []).map(function (x) {
        return '<li><b>' + esc(x.cc || '') + '</b> · <span class="audref">' + esc(x.ref) + '</span></li>';
      }).join('') + '</ul>' +
      ((det.sin_leer || []).length
        ? '<div class="muted" style="font-size:10.5px">' + det.sin_leer.length +
          ' código(s) no se pudieron leer en aSa: no cuentan como incumplidos.</div>' : '') +
      '<div class="audenviop">' +
        '<button class="audmini" id="revCierreNo">Volver a revisar</button>' +
        '<button class="audenviar" id="revCierreSi" title="Cierra igual. Queda registrado qué barras ' +
        'seguían como estaban en aSa y que lo confirmaste tú.">Cerrar igual</button>' +
      '</div>';
    var acc = $('revItemsAcc');
    acc.parentNode.insertBefore(div, acc.nextSibling);
    div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('revCierreNo').addEventListener('click', function () { div.remove(); });
    $('revCierreSi').addEventListener('click', function () { div.remove(); cerrarResueltos(true); });
  }

  async function refrescarRevision() {
    if (!REVS.sel && !(REVS.detalle && REVS.detalle.revision.todas)) return;
    // Las figuras leídas NO se tiran acá: lo que cambia es el estado del hallazgo, no la
    // barra, y volver a leer treinta códigos en cada clic es justo lo que hay que evitar.
    // Se tiran al abrir otra revisión y cuando una verificación dice que aSa cambió.
    REVS.detalle = await req('GET', '/chequeos/revision/' + (REVS.sel || 0));
    pintarResumen();
    if ($('revItemsModal').style.display !== 'none') pintarItems();
    await cargarRevisiones();
  }

  // Una revisión nueva, desde el botón de arriba: lo mismo que corre el reloj.
  async function nuevaRevision() {
    if (REV.corriendo) return;
    REV.corriendo = true; REV.parar = false;
    $('revNueva').disabled = true;
    $('revNuevaProg').style.display = '';
    $('revNuevaParar').style.display = '';
    try {
      // LA COLA ENTERA. El servidor recorta a 300 por defecto porque ese tope es para el
      // reloj, que corre dentro del proceso web con 15 minutos; acá el recorrido va en el
      // navegador, de a un código, y puede durar lo que haga falta. Con el tope por
      // defecto la tanda del usuario quedó partida en dos revisiones sin que él lo pidiera.
      var ini = await req('POST', '/chequeos/revision-pendientes', { tarde: REV.tarde, limite: 2000 });
      if (!(ini.ccs || []).length) {
        $('revNuevaTxt').textContent = 'No hay nada pendiente: todo lo abierto está revisado y nada cambió en aSa.';
      } else {
        await recorrer(ini.ccs, ini.revision,
                       { txt: $('revNuevaTxt'), barra: $('revNuevaBarra') }, ini.total);
      }
      REVS.sel = ini.revision || REVS.sel;
      await cargarRevisiones();
      if (ini.revision) await abrirRevision(ini.revision);
      await cargarReporte();
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

  // ══════ MIS CHEQUEOS ══════
  // La tarea del cubicador: lo que le marcaron para corregir, barra por barra, con la
  // comprobación a un clic. Antes el «hay que corregirla» era un aviso en la campana y
  // nada más: no había dónde verlo ni cómo cerrarlo.

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
    // UN SOLO FORMULARIO PARA TODOS (28-oct). Acá se cargaba antes «Mis chequeos por
    // corregir», una lista plana del flujo viejo con un botón de comprobar por fila, que le salía
    // a quien tenía hallazgos propios —el cubicador externo con 80— encima del panel, y al
    // admin nunca. El usuario: «no tiene nada que ver con cómo lo veo yo». Lo de cada uno
    // se trabaja en el modal, que abre con su chip puesto (`_miChip`).
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
