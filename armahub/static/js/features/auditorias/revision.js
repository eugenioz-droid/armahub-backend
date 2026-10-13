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

  var REV = { obras: [], job: null, obra: null, ccs: [], senales: [], reglas: {},
              corriendo: false, parar: false, busca: '', meses: 3, tarde: false };
  // Las ventanas que se ofrecen. 0 = todas. Las mismas que el tab de Stock Cubicaciones.
  var MESES = [[3, '3 meses'], [6, '6 meses'], [12, '1 año'], [0, 'Todas']];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function ddmm(s) {
    if (!s) return '';
    var d = new Date(s);
    return isNaN(d) ? '' : ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) +
           '/' + String(d.getFullYear()).slice(-2);
  }
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
    $('revReglasN').textContent = ks.length + ' regla(s). La máquina marca; la decisión es de quien mira.';
    el.innerHTML = ks.map(function (k) {
      var r = REV.reglas[k];
      return '<div class="revregla"><b>' + esc(r.nombre) + '</b><div>' + esc(r.porque) + '</div></div>';
    }).join('');
  }

  function pintarMeses() {
    var el = $('revMeses');
    if (!el) return;
    el.innerHTML = MESES.map(function (m) {
      return '<button data-m="' + m[0] + '" class="' + (REV.meses === m[0] ? 'on' : '') + '">' +
             esc(m[1]) + '</button>';
    }).join('');
    el.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', async function () {
        REV.meses = Number(b.dataset.m);
        pintarMeses();
        await cargarObras(); await cargarPendientes(); await cargarReporte();
      });
    });
  }

  // ── Las obras ─────────────────────────────────────────────────────────────────────
  function obrasVisibles() {
    var q = (REV.busca || '').trim().toLowerCase();
    if (!q) return REV.obras;
    return REV.obras.filter(function (o) { return (o.obra || '').toLowerCase().indexOf(q) !== -1; });
  }

  function pintarObras() {
    var el = $('revObras');
    if (!el) return;
    var vis = obrasVisibles();
    if (!vis.length) {
      el.innerHTML = '<div class="revvacio">' +
        (REV.obras.length ? 'Ninguna obra con ese nombre.' : 'No hay obras con códigos abiertos.') + '</div>';
      return;
    }
    el.innerHTML = vis.map(function (o) {
      var s = o.senales || {};
      // UNA OBRA SIN SEÑALES Y SIN REVISAR NO ES LO MISMO QUE UNA REVISADA SIN SEÑALES.
      // La primera no se miró; la segunda está limpia. Decir «0» en las dos sería mentir.
      var marca = !o.ultima_revision
        ? '<span class="s" style="background:#eceff1;color:#90a4ae">sin revisar</span>'
        : (s.abiertas
            ? '<span class="s hay">' + s.abiertas + ' por mirar</span>'
            : '<span class="s cero">limpia</span>');
      return '<div class="revobra' + (REV.job === o.job ? ' on' : '') + '" data-job="' + esc(o.job) + '">' +
        '<span class="n">' + esc(o.obra || o.job) + '</span>' +
        '<span class="c">' + o.ccs + ' código(s)</span>' +
        '<span class="c">' + num(o.kg) + ' kg</span>' +
        '<span class="u">' + (o.ultima_revision
            ? 'revisada ' + ddmm(o.ultima_revision.el) + ' por ' + esc((o.ultima_revision.por || '').split('@')[0])
            : '') + '</span>' + marca + '</div>';
    }).join('');
    el.querySelectorAll('.revobra').forEach(function (d) {
      d.addEventListener('click', function () { abrirObra(d.dataset.job); });
    });
  }

  async function abrirObra(job) {
    if (REV.corriendo) return;
    REV.job = job;
    var o = REV.obras.filter(function (x) { return x.job === job; })[0] || {};
    REV.obra = o.obra || job;
    pintarObras();
    $('revPanel').style.display = '';
    $('revObraNom').textContent = REV.obra;
    $('revObraInfo').textContent = 'cargando…';
    $('revSenales').innerHTML = '';
    try {
      var d = await req('GET', '/chequeos/codigos?job=' + encodeURIComponent(job) +
                        '&tarde=' + REV.tarde);
      REV.ccs = d.ccs || [];
      var sinRevisar = REV.ccs.filter(function (c) { return !c.revisado; }).length;
      $('revObraInfo').textContent = REV.ccs.length + ' código(s) abiertos o en proceso · ' +
        (sinRevisar ? sinRevisar + ' sin revisar' : 'todos revisados alguna vez');
      pintarCodigos();
      await cargarSenales();
      await cargarHistorial();
    } catch (e) { aviso(e.message); $('revObraInfo').textContent = e.message; }
  }

  // ── Correr la revisión, código por código ─────────────────────────────────────────
  // UNA SOLA FUNCIÓN PARA LOS DOS BOTONES. Revisar una obra y revisar lo pendiente de
  // todas son el mismo recorrido con otra cola: lo que cambia es de dónde sale la lista.
  // Escribirlo dos veces sería tener dos formas de contar el progreso que algún día dirían
  // cosas distintas.
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
    BAN.revision = revision || 0;
    if (nuevas > 0) {
      BAN.ultima = true; BAN.estado = ''; BAN.sel = {};
      ui.txt.innerHTML += ' · <b>resuélvelas en la bandeja de abajo ↓</b>';
      await cargarBandeja();
      var ban = $('revBandeja');
      if (ban && ban.scrollIntoView) ban.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return { hechos: hechos, nuevas: nuevas };
  }

  function _arranca(btnId, pararId, progId) {
    REV.corriendo = true; REV.parar = false;
    $(btnId).disabled = true;
    $(pararId).style.display = '';
    $(progId).style.display = '';
  }

  function _termina(btnId, pararId) {
    REV.corriendo = false;
    $(btnId).disabled = false;
    $(pararId).style.display = 'none';
  }

  async function correr() {
    if (!REV.job || REV.corriendo) return;
    _arranca('revCorrer', 'revParar', 'revProgreso');
    try {
      var ini = await req('POST', '/chequeos/revision', { job: REV.job, tarde: REV.tarde });
      await recorrer((ini.ccs || []).map(function (cc) { return { job: REV.job, cc: cc }; }),
                     ini.revision, { txt: $('revProgTxt'), barra: $('revBarra') });
      ok(REV.parar ? 'Revisión detenida; lo revisado quedó guardado' : 'Revisión terminada');
    } catch (e) { aviso(e.message); $('revProgTxt').textContent = e.message; }
    _termina('revCorrer', 'revParar');
    await cargarSenales(); await cargarHistorial(); await cargarObras();
    await cargarPendientes(); await cargarReporte();
  }

  // LO PENDIENTE DE TODAS LAS OBRAS. Es el mismo trabajo que hace el reloj una vez al día,
  // disponible cuando uno quiera: así no hay que esperar a la hora para ver lo de recién.
  async function correrPendientes() {
    if (REV.corriendo) return;
    _arranca('revPendCorrer', 'revPendParar', 'revPendProg');
    try {
      var ini = await req('POST', '/chequeos/revision-pendientes', { tarde: REV.tarde });
      await recorrer(ini.ccs || [], ini.revision,
                     { txt: $('revPendProgTxt'), barra: $('revPendBarra') });
      ok(REV.parar ? 'Detenida; lo revisado quedó guardado' : 'Pendientes revisados');
    } catch (e) { aviso(e.message); $('revPendProgTxt').textContent = e.message; }
    _termina('revPendCorrer', 'revPendParar');
    await cargarPendientes(); await cargarObras(); await cargarReporte();
    if (REV.job) { await cargarSenales(); await cargarHistorial(); }
  }

  async function cargarPendientes() {
    try {
      var d = await req('GET', '/chequeos/pendientes?tarde=' + REV.tarde);
      var n = d.pendientes || 0;
      $('revPendTxt').textContent = n
        ? n + ' código(s) en ' + (d.obras || 0) + ' obra(s): nunca revisados, o cambiados en aSa ' +
          'desde la última vez. La revisión corre sola una vez al día; este botón no espera a la hora. ' +
          'Va de a ' + d.tope + ' por vez.'
        : 'Nada pendiente: todo lo abierto está revisado y nada cambió desde entonces.';
      $('revPendCorrer').disabled = !n;
    } catch (e) { $('revPendTxt').textContent = e.message; }
  }

  // CÓDIGO POR CÓDIGO: cuándo se revisó, quién, y si cambió en aSa desde entonces. Un
  // código limpio también deja constancia, si no no se podría distinguir «lo miramos y
  // está bien» de «nunca lo miramos».
  function pintarCodigos() {
    var el = $('revCodigos');
    if (!el) return;
    el.innerHTML = (REV.ccs || []).map(function (c) {
      var m = !c.revisado ? '<span class="m no">sin revisar</span>'
            : c.cambio ? '<span class="m cambio">cambió en aSa</span>'
            : c.abiertas ? '<span class="m hay">' + c.abiertas + ' por mirar</span>'
            : '<span class="m ok">limpio</span>';
      return '<div class="revcc"><span class="k">' + esc(c.cc) + '</span>' +
        '<span class="d">' + esc(c.descr || '') + '</span>' +
        '<span class="r">' + (c.revisado
            ? 'revisado ' + ddmm(c.revisado) + ' · ' +
              esc((c.revisado_por === 'reloj' ? 'automática' : (c.revisado_por || '').split('@')[0])) +
              (c.barras_vistas ? ' · ' + c.barras_vistas + ' barras' : '')
            : '') + '</span>' +
        (c.error ? '<span class="m hay" title="' + esc(c.error) + '">error</span>' : '') + m + '</div>';
    }).join('');
  }

  // ══════ LA BANDEJA DE HALLAZGOS ══════
  // Todas las señales, sin obra abierta. Antes para ver una señal había que clickear su
  // obra —32 obras—, y después de «revisar lo pendiente» la pantalla decía «15 señales
  // nuevas» y nada más. Medido el 9-oct: 540 señales, todas abiertas, ninguna resuelta.
  var BAN = { estado: '', regla: '', cubico: '', job: '', ultima: false, busca: '',
              sel: {}, datos: null, revision: 0 };
  var ESTADO_TXT = { abierta: 'Abierta', corregir: 'Por corregir', aceptada: 'Está bien',
                     corregida: 'Corregida' };

  function _qs() {
    var p = [];
    if (BAN.estado) p.push('estado=' + BAN.estado);
    if (BAN.regla) p.push('regla=' + encodeURIComponent(BAN.regla));
    if (BAN.cubico) p.push('cubico=' + encodeURIComponent(BAN.cubico));
    if (BAN.job) p.push('job=' + encodeURIComponent(BAN.job));
    if (BAN.ultima && BAN.revision) p.push('revision=' + BAN.revision);
    if (BAN.busca) p.push('busca=' + encodeURIComponent(BAN.busca));
    return p.length ? '?' + p.join('&') : '';
  }

  async function cargarBandeja() {
    try {
      BAN.datos = await req('GET', '/chequeos' + _qs());
      REV.reglas = BAN.datos.reglas || REV.reglas;
      pintarBandeja();
    } catch (e) { aviso(e.message); }
  }

  function _chips(id, lista, actual, al) {
    var el = $(id);
    if (!el) return;
    el.innerHTML = lista.map(function (x) {
      return '<button data-v="' + esc(x[0]) + '" class="' + (actual === x[0] ? 'on' : '') + '">' +
             esc(x[1]) + '</button>';
    }).join('');
    el.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { al(b.dataset.v); });
    });
  }

  function _select(id, lista, actual, al) {
    var el = $(id);
    if (!el) return;
    el.innerHTML = '<option value="">' + (id === 'revBanCub' ? 'todos' : 'todas') + '</option>' +
      lista.map(function (x) {
        return '<option value="' + esc(x[0]) + '"' + (actual === x[0] ? ' selected' : '') + '>' +
               esc(x[1]) + '</option>';
      }).join('');
    el.onchange = function () { al(el.value); };
  }

  function pintarBandeja() {
    var d = BAN.datos || {}, tot = d.totales || {};
    $('revBanTot').innerHTML = ['abierta', 'corregir', 'aceptada', 'corregida'].map(function (k) {
      return '<span class="' + k + '" title="' + esc(ESTADO_TXT[k]) + '">' + (tot[k] || 0) + ' ' +
             esc(ESTADO_TXT[k].toLowerCase()) + '</span>';
    }).join('');
    _chips('revBanEstado', [['', 'Esperan'], ['abierta', 'Abiertas'], ['corregir', 'Por corregir'],
                            ['aceptada', 'Están bien'], ['corregida', 'Corregidas'], ['todas', 'Todas']],
           BAN.estado, function (v) { BAN.estado = v; BAN.sel = {}; cargarBandeja(); });
    _chips('revBanRegla', [['', 'Todas']].concat(Object.keys(REV.reglas || {}).map(function (k) {
             return [k, REV.reglas[k].nombre]; })),
           BAN.regla, function (v) { BAN.regla = v; BAN.sel = {}; cargarBandeja(); });
    _select('revBanCub', (d.por_cubicador || []).map(function (c) { return [c.cubico, c.cubico + ' · ' + c.n]; }),
            BAN.cubico, function (v) { BAN.cubico = v; BAN.sel = {}; cargarBandeja(); });
    _select('revBanObra', (d.por_obra || []).map(function (o) { return [o.job, (o.obra || o.job) + ' · ' + o.n]; }),
            BAN.job, function (v) { BAN.job = v; BAN.sel = {}; cargarBandeja(); });
    var ult = $('revBanUltima');
    if (ult) { ult.checked = BAN.ultima; ult.disabled = !BAN.revision; }
    var filas = d.senales || [];
    $('revBanQue').textContent = filas.length
      ? filas.length + ' señal(es)' + (filas.length >= 2000 ? ' (tope: afina el filtro)' : '') +
        ' · ' + (d.por_cubicador || []).length + ' cubicador(es) · ' + (d.por_obra || []).length + ' obra(s)'
      : 'Nada con ese filtro.';
    var tabla = $('revBanTabla');
    if (!filas.length) {
      tabla.innerHTML = '<tbody><tr><td class="audvacio">' +
        (BAN.ultima ? 'La última revisión no dejó señales nuevas.' : 'No hay señales con ese filtro.') +
        '</td></tr></tbody>';
      pintarLote();
      return;
    }
    var tope = Math.min(filas.length, 400);
    tabla.innerHTML = '<thead><tr><th><input type="checkbox" id="revBanTodos" title="Marcar las visibles"></th>' +
      '<th>Obra</th><th>Código</th><th>Barra</th><th>Regla</th><th>Qué tiene</th><th>Cubicó</th>' +
      '<th class="num" title="Cuántas revisiones la vieron">Vista</th><th>Estado</th><th></th></tr></thead><tbody>' +
      filas.slice(0, tope).map(filaBandeja).join('') +
      (filas.length > tope ? '<tr><td colspan="10" class="muted" style="font-size:10.5px">Se muestran ' + tope +
        ' de ' + filas.length + ': afina el filtro para ver el resto.</td></tr>' : '') +
      '</tbody>';
    tabla.querySelectorAll('input[data-sel]').forEach(function (c) {
      c.addEventListener('change', function () {
        if (c.checked) BAN.sel[c.dataset.sel] = true; else delete BAN.sel[c.dataset.sel];
        pintarLote();
      });
    });
    $('revBanTodos').addEventListener('change', function () {
      var on = $('revBanTodos').checked;
      tabla.querySelectorAll('input[data-sel]').forEach(function (c) {
        c.checked = on;
        if (on) BAN.sel[c.dataset.sel] = true; else delete BAN.sel[c.dataset.sel];
      });
      pintarLote();
    });
    tabla.querySelectorAll('button[data-sen]').forEach(function (b) {
      b.addEventListener('click', function () { resolver(b.dataset.sen, b.dataset.est, b.dataset.pat === '1'); });
    });
    tabla.querySelectorAll('button[data-ver]').forEach(function (b) {
      b.addEventListener('click', function () { abrirDetalleSenal(b.dataset.ver); });
    });
    pintarLote();
  }

  // ══════ EL DETALLE DE UNA SEÑAL ══════
  // La misma barra que ve el auditor, con el mismo motor (las piezas las expone
  // auditorias/index.js). Se pide el elemento a aSa en vivo y se busca la barra por su
  // referencia: así lo que se dibuja es lo que aSa tiene HOY, no la foto de la señal.
  var _senalesPorId = {};
  function _senal(id) {
    var s = _senalesPorId[String(id)];
    if (s) return s;
    var todas = ((BAN.datos || {}).senales || []).concat(REV.senales || [], REV.mios || []);
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
    var acc = $('revSenalAcc');
    var botones = '';
    if (s.estado === 'abierta') {
      botones = '<button class="audmini" data-est="corregir">Hay que corregirla</button>' +
                '<button class="audmini ver" data-est="aceptada">Está bien</button>' +
                '<button class="audmini" data-est="aceptada" data-pat="1" title="Ésta y todas las iguales de la obra">Está bien, todas las iguales</button>';
    } else if (s.estado !== 'corregida') {
      botones = '<button class="audmini" data-est="abierta">Deshacer</button>';
    }
    if (s.estado === 'corregir') {
      botones += '<button class="audmini ver" id="revSenalComprobar" title="Vuelve a leer este código en aSa ahora mismo">Ya se corrigió: comprobar</button>';
    }
    acc.innerHTML = botones + '<span class="muted" id="revSenalMsg" style="font-size:10.5px"></span>';
    acc.querySelectorAll('button[data-est]').forEach(function (b) {
      b.addEventListener('click', async function () {
        await resolver(s.id, b.dataset.est, b.dataset.pat === '1');
        cerrarDetalleSenal();
      });
    });
    var cmp = $('revSenalComprobar');
    if (cmp) cmp.addEventListener('click', function () { comprobarSenal(s.id, cmp, $('revSenalMsg')); });
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
      await Promise.all([cargarBandeja(), cargarMios(), cargarReporte()]);
      if (REV.job) await cargarSenales();
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
        '<th>Lo marcó</th><th></th></tr></thead><tbody>' +
        REV.mios.map(function (s) {
          var d2 = s.detalle || {};
          return '<tr><td class="audnom" title="' + esc(s.obra || '') + '">' + esc(s.obra || s.job) + '</td>' +
            '<td class="cc">' + esc(s.cc || '') + (s.elemento ? ' <span class="muted">' + esc(s.elemento) + '</span>' : '') + '</td>' +
            '<td><span class="audref">' + esc(s.ref) + '</span></td>' +
            '<td class="revmiotx">' + esc(d2.texto || '') + '</td>' +
            '<td class="muted" style="font-size:10.5px">' + esc((s.resuelto_por || '').split('@')[0]) + (s.resuelto_el ? ' · ' + _fechaHora(s.resuelto_el) : '') +
              (s.nota ? '<div>' + esc(s.nota) + '</div>' : '') + '</td>' +
            '<td style="white-space:nowrap"><button class="audmini" data-ver="' + s.id + '">Ver</button> ' +
              '<button class="audmini ver" data-cmp="' + s.id + '">Ya la corregí: comprobar</button></td></tr>';
        }).join('') + '</tbody></table>';
      caja.querySelectorAll('button[data-ver]').forEach(function (b) {
        b.addEventListener('click', function () { abrirDetalleSenal(b.dataset.ver); });
      });
      caja.querySelectorAll('button[data-cmp]').forEach(function (b) {
        b.addEventListener('click', function () { comprobarSenal(b.dataset.cmp, b, null); });
      });
    } catch (e) { caja.style.display = 'none'; }
  }

  function filaBandeja(s) {
    var d = s.detalle || {}, r = (REV.reglas || {})[s.regla] || { nombre: s.regla };
    var espera = s.estado === 'abierta' || s.estado === 'corregir';
    return '<tr class="' + esc(s.estado) + '">' +
      '<td>' + (espera ? '<input type="checkbox" data-sel="' + s.id + '"' + (BAN.sel[s.id] ? ' checked' : '') + '>' : '') + '</td>' +
      '<td class="audnom" title="' + esc(s.obra || s.job) + '">' + esc(s.obra || s.job) + '</td>' +
      '<td class="cc">' + esc(s.cc || '') + '</td>' +
      '<td><span class="audref">' + esc(s.ref) + '</span></td>' +
      '<td>' + esc(r.nombre) + '</td>' +
      '<td class="revbtx">' + esc(d.texto || '') + '</td>' +
      '<td>' + esc(s.cubico || '') + '</td>' +
      '<td class="num">' + (s.veces || 1) + '</td>' +
      '<td><span class="audacc1 ' + (s.estado === 'corregir' ? 'pendiente' : s.estado === 'aceptada' ? 'verificada' : s.estado === 'corregida' ? 'corregida' : '') + '" title="' +
        esc(s.nota ? s.nota + (s.resuelto_por ? ' (' + s.resuelto_por.split('@')[0] + ')' : '') : '') + '">' +
        esc(ESTADO_TXT[s.estado] || s.estado) + '</span></td>' +
      '<td><button class="audmini" data-ver="' + s.id + '" title="La barra dibujada, qué tiene y las acciones">Ver</button> ' +
        (s.estado === 'abierta'
          ? '<button class="audmini" data-sen="' + s.id + '" data-est="corregir">Hay que corregirla</button>' +
            '<button class="audmini" data-sen="' + s.id + '" data-est="aceptada">Está bien</button>' +
            '<button class="audmini" data-sen="' + s.id + '" data-est="aceptada" data-pat="1" title="Ésta y todas las iguales de la obra">+iguales</button>'
          : s.estado === 'corregida' ? ''
          : '<button class="audmini" data-sen="' + s.id + '" data-est="abierta">Deshacer</button>') + '</td></tr>';
  }

  function pintarLote() {
    var n = Object.keys(BAN.sel).length, el = $('revLote');
    if (!el) return;
    el.style.display = n ? 'flex' : 'none';
    if (n) $('revLoteN').textContent = n + ' seleccionada(s) →';
  }

  // EN LOTE. Con 540 abiertas, de a una no se avanza. «Están bien» pide UN motivo para
  // todas; «hay que corregirlas» le avisa a cada cubicador con la lista de sus códigos.
  async function resolverLote(estado) {
    var ids = Object.keys(BAN.sel).map(Number);
    if (!ids.length) return;
    var nota = null;
    if (estado === 'aceptada') {
      nota = global.prompt('¿Por qué están bien estas ' + ids.length + ' señales? (queda en cada una)');
      if (nota === null) return;
      if (!nota.trim()) { aviso('Hace falta el motivo.'); return; }
    }
    try {
      var r = await req('PUT', '/chequeos/senales', { ids: ids, estado: estado, nota: nota });
      ok(r.afectadas + ' señal(es) ' + (estado === 'aceptada' ? 'aceptadas' : 'marcadas para corregir') +
         (r.avisados ? ' · avisado a ' + r.avisados + ' cubicador(es)' : ''));
      BAN.sel = {};
      await cargarBandeja();
      if (REV.job) await cargarSenales();
      await cargarObras();
      await cargarMios();
    } catch (e) { aviso(e.message); }
  }

  // ── Las señales ───────────────────────────────────────────────────────────────────
  async function cargarSenales() {
    if (!REV.job) return;
    try {
      var d = await req('GET', '/chequeos?job=' + encodeURIComponent(REV.job));
      REV.senales = d.senales || [];
      REV.reglas = d.reglas || REV.reglas;
      pintarSenales(d.resumen || {});
    } catch (e) { aviso(e.message); }
  }

  function pintarSenales(resumen) {
    var el = $('revSenales');
    if (!el) return;
    if (!REV.senales.length) {
      var revisado = (REV.ccs || []).some(function (c) { return c.revisado; });
      el.innerHTML = '<div class="revvacio">' +
        (revisado ? 'Nada que mirar: todas las señales de esta obra están resueltas.'
                  : 'Todavía no se ha revisado esta obra. Aprieta «Revisar los códigos».') +
        '</div>';
      return;
    }
    // AGRUPADAS POR REGLA. Lo que el usuario resuelve no es una barra suelta, es «todos los
    // estribos cuadrados de esta obra»: verlos juntos es lo que deja decidir de una vez.
    var por = {};
    REV.senales.forEach(function (s) { (por[s.regla] = por[s.regla] || []).push(s); });
    el.innerHTML = Object.keys(por).map(function (k) {
      var r = REV.reglas[k] || { nombre: k };
      return '<div class="revgrupo"><h4>' + esc(r.nombre) + ' · ' + por[k].length + '</h4>' +
        por[k].map(fila).join('') + '</div>';
    }).join('');
    el.querySelectorAll('button[data-sen]').forEach(function (b) {
      b.addEventListener('click', function () { resolver(b.dataset.sen, b.dataset.est, b.dataset.pat === '1'); });
    });
  }

  function fila(s) {
    var d = s.detalle || {};
    return '<div class="revsen ' + esc(s.estado) + '">' +
      '<span class="cc">' + esc(s.cc || '') + '</span>' +
      '<span class="ref">' + esc(s.ref) + '</span>' +
      '<span class="tx">' + esc(d.texto || '') + '</span>' +
      (s.veces > 1 ? '<span class="ve">vista ' + s.veces + ' veces</span>' : '') +
      (s.estado === 'corregir' ? '<span class="est corregir">Por corregir</span>' : '') +
      (s.estado === 'corregir'
        ? '<button class="audmini" data-sen="' + s.id + '" data-est="abierta">Deshacer</button>'
        : '<button class="audmini" data-sen="' + s.id + '" data-est="corregir">Hay que corregirla</button>' +
          '<button class="audmini" data-sen="' + s.id + '" data-est="aceptada">Está bien</button>' +
          '<button class="audmini" data-sen="' + s.id + '" data-est="aceptada" data-pat="1" ' +
          'title="Acepta ésta y todas las iguales de esta obra, ahora y las que aparezcan después.">' +
          'Está bien, todas las iguales</button>') +
      '</div>';
  }

  async function resolver(id, estado, patron) {
    var nota = null;
    if (estado === 'aceptada') {
      // EL MOTIVO ES OBLIGATORIO. Una señal aceptada sin motivo es una señal que nadie
      // puede volver a discutir: dentro de un mes no se sabe si estaba bien o si alguien
      // la apagó para sacársela de encima.
      nota = global.prompt(patron
        ? '¿Por qué están bien todas las iguales de esta obra?'
        : '¿Por qué está bien?');
      if (nota === null) return;
      if (!nota.trim()) { aviso('Hace falta el motivo.'); return; }
    }
    try {
      var r = await req('PUT', '/chequeos/senal/' + id, { estado: estado, nota: nota, patron: !!patron });
      ok(estado === 'aceptada'
        ? 'Aceptada' + (r.afectadas > 1 ? ' (' + r.afectadas + ' señales)' : '')
        : estado === 'corregir' ? 'Marcada para corregir' + (r.avisados ? ' · avisado al cubicador' : '')
        : 'Vuelta a abrir');
      await cargarBandeja();
      if (REV.job) await cargarSenales();
      await cargarObras();
    } catch (e) { aviso(e.message); }
  }

  // ── El registro ───────────────────────────────────────────────────────────────────
  async function cargarHistorial() {
    if (!REV.job) return;
    try {
      var d = await req('GET', '/chequeos/revisiones?job=' + encodeURIComponent(REV.job));
      var hs = d.revisiones || [];
      $('revHistorial').style.display = hs.length ? '' : 'none';
      $('revHist').innerHTML = hs.length
        ? '<table class="audt"><thead><tr><th>Cuándo</th><th>Quién</th><th class="num">Códigos</th>' +
          '<th class="num">Barras</th><th class="num">Nuevas</th><th class="num">Ya vistas</th>' +
          '<th class="num">Corregidas</th><th></th></tr></thead><tbody>' +
          hs.map(function (h) {
            return '<tr><td>' + ddmm(h.arrancada) + '</td>' +
              '<td>' + (h.por === 'reloj'
                  ? '<span class="audori asa">automática</span>'
                  : esc((h.por || '').split('@')[0])) + '</td>' +
              '<td class="num">' + h.ccs + (h.ccs_error ? ' <span class="muted">(' + h.ccs_error + ' con error)</span>' : '') + '</td>' +
              '<td class="num">' + num(h.barras) + '</td>' +
              '<td class="num">' + h.nuevas + '</td>' +
              '<td class="num">' + h.vistas + '</td>' +
              '<td class="num">' + h.corregidas + '</td>' +
              '<td class="muted" style="font-size:10px">' + esc(h.nota || '') + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '';
    } catch (e) { /* el historial es un extra: que falle no rompe la pantalla */ }
  }

  async function cargarObras() {
    try {
      var d = await req('GET', '/chequeos/obras?meses=' + REV.meses + '&tarde=' + REV.tarde);
      REV.obras = d.obras || [];
      pintarObras();
      var n = REV.obras.length;
      $('revMesesTxt').textContent = n + ' obra(s)' +
        (REV.meses ? ' con pedidos en los últimos ' + REV.meses + ' meses.'
                   : ' — todas, incluidas las que no se mueven hace años.');
    } catch (e) { aviso(e.message); }
  }

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
          // LA FILA ABRE LA BANDEJA DE ESA OBRA. El reporte dice dónde está el problema; la
          // bandeja es donde se resuelve: sin este clic eran dos pantallas sin puente.
          return '<tr class="revrepfila" data-job="' + esc(o.job) + '" title="Ver y resolver las señales de esta obra">' +
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
      $('revRep').querySelectorAll('tr.revrepfila').forEach(function (tr) {
        tr.addEventListener('click', function () { irABandeja({ job: tr.dataset.job }); });
      });
    } catch (e) { $('revRep').innerHTML = '<div class="revvacio">' + esc(e.message) + '</div>'; }
  }

  function _fechaHora(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' +
           ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  // Llevar la bandeja a una obra (o a un estado) y ponerla a la vista.
  async function irABandeja(f) {
    BAN.job = f.job || ''; BAN.estado = f.estado || ''; BAN.ultima = false; BAN.sel = {};
    await cargarBandeja();
    var ban = $('revBandeja');
    if (ban && ban.scrollIntoView) ban.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  var _listo = false;
  global.loadRevisionBarras = async function () {
    if (!$('audSubRevision')) return;
    if (!_listo) {
      _listo = true;
      $('revCorrer').addEventListener('click', correr);
      // La bandeja.
      $('revBanBusca').addEventListener('input', function () {
        BAN.busca = this.value.trim();
        clearTimeout(BAN._t); BAN._t = setTimeout(cargarBandeja, 300);
      });
      $('revBanUltima').addEventListener('change', function () { BAN.ultima = this.checked; cargarBandeja(); });
      $('revLoteOk').addEventListener('click', function () { resolverLote('aceptada'); });
      $('revLoteCorr').addEventListener('click', function () { resolverLote('corregir'); });
      $('revLoteNo').addEventListener('click', function () { BAN.sel = {}; pintarBandeja(); });
      $('revSenalCerrar').addEventListener('click', cerrarDetalleSenal);
      $('revSenalModal').addEventListener('click', function (e) { if (e.target === $('revSenalModal')) cerrarDetalleSenal(); });
      $('revParar').addEventListener('click', function () { REV.parar = true; });
      $('revPendCorrer').addEventListener('click', correrPendientes);
      $('revRepImprimir').addEventListener('click', function () { global.print(); });
      $('revTarde').addEventListener('click', async function () {
        REV.tarde = !REV.tarde;
        this.classList.toggle('on', REV.tarde);
        await cargarObras(); await cargarPendientes(); await cargarReporte();
        if (REV.job) await abrirObra(REV.job);
      });
      pintarMeses();
      $('revPendParar').addEventListener('click', function () { REV.parar = true; });
      $('revBuscaObra').addEventListener('input', function () {
        REV.busca = this.value; pintarObras();
      });
      try {
        var r = await req('GET', '/chequeos/reglas');
        (r.reglas || []).forEach(function (x) { REV.reglas[x.codigo] = x; });
      } catch (e) { /* las reglas son texto: si fallan, la pantalla sigue sirviendo */ }
      pintarReglas();
    }
    await cargarObras();
    await cargarPendientes();
    await cargarReporte();
    // Lo mío primero y la bandeja completa: es lo que se viene a resolver.
    await cargarMios();
    await cargarBandeja();
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

  global.__revisionTest = { REV: REV, obrasVisibles: obrasVisibles, fila: fila };

})(window);
