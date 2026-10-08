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
              corriendo: false, parar: false, busca: '' };

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
      var d = await req('GET', '/chequeos/codigos?job=' + encodeURIComponent(job));
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
      var ini = await req('POST', '/chequeos/revision', { job: REV.job });
      await recorrer((ini.ccs || []).map(function (cc) { return { job: REV.job, cc: cc }; }),
                     ini.revision, { txt: $('revProgTxt'), barra: $('revBarra') });
      ok(REV.parar ? 'Revisión detenida; lo revisado quedó guardado' : 'Revisión terminada');
    } catch (e) { aviso(e.message); $('revProgTxt').textContent = e.message; }
    _termina('revCorrer', 'revParar');
    await cargarSenales(); await cargarHistorial(); await cargarObras(); await cargarPendientes();
  }

  // LO PENDIENTE DE TODAS LAS OBRAS. Es el mismo trabajo que hace el reloj una vez al día,
  // disponible cuando uno quiera: así no hay que esperar a la hora para ver lo de recién.
  async function correrPendientes() {
    if (REV.corriendo) return;
    _arranca('revPendCorrer', 'revPendParar', 'revPendProg');
    try {
      var ini = await req('POST', '/chequeos/revision-pendientes', {});
      await recorrer(ini.ccs || [], ini.revision,
                     { txt: $('revPendProgTxt'), barra: $('revPendBarra') });
      ok(REV.parar ? 'Detenida; lo revisado quedó guardado' : 'Pendientes revisados');
    } catch (e) { aviso(e.message); $('revPendProgTxt').textContent = e.message; }
    _termina('revPendCorrer', 'revPendParar');
    await cargarPendientes(); await cargarObras();
    if (REV.job) { await cargarSenales(); await cargarHistorial(); }
  }

  async function cargarPendientes() {
    try {
      var d = await req('GET', '/chequeos/pendientes');
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
        : estado === 'corregir' ? 'Marcada para corregir' : 'Vuelta a abrir');
      await cargarSenales();
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
      var d = await req('GET', '/chequeos/obras');
      REV.obras = d.obras || [];
      pintarObras();
    } catch (e) { aviso(e.message); }
  }

  var _listo = false;
  global.loadRevisionBarras = async function () {
    if (!$('audSubRevision')) return;
    if (!_listo) {
      _listo = true;
      $('revCorrer').addEventListener('click', correr);
      $('revParar').addEventListener('click', function () { REV.parar = true; });
      $('revPendCorrer').addEventListener('click', correrPendientes);
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
