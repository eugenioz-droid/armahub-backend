// PROGRAMACIÓN DE CUBICACIONES — pestaña USC (28-sep).
//
// Reemplaza la planilla semanal. Cuatro cajas: obras · por programar · por cubicar · cubicadas,
// y debajo el calendario de números (una fila por cubicador, «n · t» por día).
//
// LAS REGLAS NO VIVEN AQUÍ. La fecha de cubicación (10 hábiles antes del despacho) y la marca
// de plazo corto (menos de 7 hábiles de margen) las decide el backend y viajan calculadas.
// Este archivo pinta y manda; si mañana cambia la regla, cambia en un sitio.
(function (global) {
  'use strict';

  var OBRAS = [], OBRA = null, DATA = null, CAL = null, CAL_CUB = null, SEM = 0, PUEDE = false;
  var DIAS = ['lun', 'mar', 'mié', 'jue', 'vie'];
  var MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function deIso(s) { var p = String(s || '').split('-'); return p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : null; }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function corta(s) { var d = (s instanceof Date) ? s : deIso(s); return d ? (d.getDate() + ' ' + MES[d.getMonth()]) : '—'; }
  function hoy() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function lunesDe(d) { var x = new Date(d.getTime()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function semanaBase() { var l = lunesDe(hoy()); l.setDate(l.getDate() + 7 * SEM); return l; }
  function dias5(l) { return [0,1,2,3,4].map(function (i) { var d = new Date(l.getTime()); d.setDate(d.getDate() + i); return d; }); }
  function mismo(a, b) { return a && b && a.getTime() === b.getTime(); }

  // ── API ──────────────────────────────────────────────────────────────────────
  async function req(metodo, url, cuerpo) {
    var opts = { method: metodo, headers: Object.assign({}, global.authHeaders()) };
    if (cuerpo !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(cuerpo); }
    var res = await fetch(global.apiUrl(url), opts);
    if (res.status === 401) { global.logout(); return null; }
    var data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var det = data && data.detail;
      throw new Error((det && (det.msg || det)) || ('Error ' + res.status));
    }
    return data;
  }

  // ── carga ────────────────────────────────────────────────────────────────────
  global.loadProgramacionModule = async function () {
    if (!$('tab-programacion')) return;
    try {
      var d = await req('GET', '/programacion/obras');
      if (!d) return;
      OBRAS = d.obras || []; PUEDE = !!d.puede_programar;
      $('prgIntro').textContent = OBRAS.length + ' obras · ' +
        OBRAS.reduce(function (a, o) { return a + o.disponibles; }, 0) + ' tareas por programar';
      if (!PUEDE) $('prgIntro').textContent += ' · solo lectura';
      $('prgObrasN').textContent = '· ' + OBRAS.length;
      if (!$('prgFecha').value) { var f = hoy(); f.setDate(f.getDate() + 24); $('prgFecha').value = iso(f); }
      bind();
      pintarObras();
      if (OBRAS.length) await abrirObra(OBRAS[0].id_proyecto);
      await pintarCal();
    } catch (e) { aviso(e.message); }
  };
  function aviso(m) { if (global.showToast) global.showToast(m, 'error'); else alert(m); }

  var _bound = false;
  function bind() {
    if (_bound) return; _bound = true;
    $('prgSemAnt').addEventListener('click', function () { SEM--; pintarCal(); });
    $('prgSemSig').addEventListener('click', function () { SEM++; pintarCal(); });
    $('prgGo').addEventListener('click', programar);
    $('prgLibre').addEventListener('click', crearLibre);
  }

  global.prgSubTab = function (v) {
    [['usc','prgSubUsc','prgPanelUsc'], ['equipo','prgSubEquipo','prgPanelEquipo'], ['cub','prgSubCub','prgPanelCub']]
      .forEach(function (t) {
        var on = (t[0] === v), b = $(t[1]), p = $(t[2]);
        if (b) { b.style.borderBottomColor = on ? '#8BC34A' : 'transparent'; b.style.color = on ? '#33691e' : '#aaa'; }
        if (p) p.style.display = on ? '' : 'none';
      });
  };

  // ── CAJA 1 · obras ───────────────────────────────────────────────────────────
  function pintarObras() {
    $('prgObras').innerHTML = OBRAS.map(function (o) {
      return '<div class="prgo' + (OBRA && o.id_proyecto === OBRA ? ' on' : '') + '" data-o="' + esc(o.id_proyecto) + '"' +
        ' title="' + esc(o.obra) + (o.cubicador ? ' · ' + esc(o.cubicador) : '') + '">' +
        '<span class="n">' + esc(o.obra) + '</span>' +
        '<span class="k"><b>' + o.disponibles + '</b>/' + (o.disponibles + o.programadas + o.cubicadas) + '</span></div>';
    }).join('') || '<span class="muted">Sin obras con frentes.</span>';
    $('prgObras').querySelectorAll('.prgo').forEach(function (el) {
      el.addEventListener('click', function () { abrirObra(el.getAttribute('data-o')); });
    });
  }

  async function abrirObra(id) {
    OBRA = id; CAL_CUB = null; pintarObras();
    try { DATA = await req('GET', '/programacion/obras/' + encodeURIComponent(id) + '/tareas'); }
    catch (e) { aviso(e.message); return; }
    pintarDisp(); pintarPorCubicar(); pintarCubicadas();
  }
  function obraActual() { return OBRAS.filter(function (o) { return o.id_proyecto === OBRA; })[0] || null; }

  // ── CAJA 2 · por programar ───────────────────────────────────────────────────
  function pintarDisp() {
    var d = (DATA && DATA.disponibles) || [];
    $('prgDispN').textContent = '· ' + d.length;
    $('prgDisp').innerHTML = d.slice(0, 200).map(function (t) {
      return '<label class="prgd"><input type="checkbox" data-t="' + t.id + '"' + (PUEDE ? '' : ' disabled') + '>' +
        esc(t.nombre) + '</label>';
    }).join('') || '<div class="muted" style="padding:6px 4px">Todo programado.</div>';
  }

  async function programar() {
    if (!PUEDE) return aviso('Tu rol no puede programar.');
    var ids = [].slice.call($('prgDisp').querySelectorAll('input:checked')).map(function (i) { return Number(i.getAttribute('data-t')); });
    if (!ids.length) return aviso('Marca al menos una tarea.');
    if (!$('prgFecha').value) return aviso('Falta la fecha de despacho.');
    var ton = parseFloat(String($('prgTon').value).replace(',', '.'));
    try {
      var r = await req('POST', '/programacion/programar', {
        ids: ids, fecha_despacho: $('prgFecha').value,
        ton_estimadas: isNaN(ton) ? null : ton
      });
      $('prgTon').value = '';
      if (r && r.plazo_corto && global.showToast) {
        global.showToast(r.programadas + ' programada(s) · cubicar el ' + corta(r.fecha_cubicacion) +
          ' — menos de 7 días hábiles, queda registrado', 'warn');
      } else if (global.showToast) {
        global.showToast(r.programadas + ' programada(s) · cubicar el ' + corta(r.fecha_cubicacion), 'ok');
      }
      await refrescar();
    } catch (e) { aviso(e.message); }
  }

  async function crearLibre() {
    if (!PUEDE) return aviso('Tu rol no puede programar.');
    if (!OBRA) return;
    var n = prompt('Nombre del frente (obras sin sector · piso · ciclo):\nEj: Pedido N°1, Muro de contención');
    if (!n || !n.trim()) return;
    try { await req('POST', '/programacion/obras/' + encodeURIComponent(OBRA) + '/tarea-libre', { nombre: n.trim() }); await refrescar(); }
    catch (e) { aviso(e.message); }
  }

  async function refrescar() {
    var d = await req('GET', '/programacion/obras');
    if (d) { OBRAS = d.obras || []; pintarObras(); }
    if (OBRA) { DATA = await req('GET', '/programacion/obras/' + encodeURIComponent(OBRA) + '/tareas'); }
    pintarDisp(); pintarPorCubicar(); pintarCubicadas(); await pintarCal();
  }

  // Qué alimenta las cajas 3 y 4: la obra abierta, o —si se tocó un cubicador en el
  // calendario— sus tareas de esa semana. Las dos cajas siguen la misma selección.
  function seleccion() {
    if (CAL_CUB && CAL) {
      var ids = {};
      (CAL.celdas || []).forEach(function (c) { if (c.cubicador_email === CAL_CUB.email) ids[c.dia] = 1; });
      return { rot: CAL_CUB.nombre + ' · semana', cub: true, dias: ids };
    }
    var o = obraActual();
    return { rot: o ? o.obra : '', cub: false, dias: null };
  }

  // ── CAJA 3 · por cubicar ─────────────────────────────────────────────────────
  function pintarPorCubicar() {
    var s = seleccion();
    var f = (DATA && DATA.programadas) || [];
    if (s.cub) f = f.filter(function (t) { return t.cubicador_email === CAL_CUB.email && s.dias[t.fecha_cubicacion]; });
    var tot = f.reduce(function (a, t) { return a + (t.ton_estimadas || 0); }, 0);
    $('prgPorCubH').innerHTML = 'Por cubicar <span class="muted">· ' + esc(s.rot) + '</span>' +
      (s.cub ? ' <button class="secondary" id="prgVolver" style="font-size:10px;padding:1px 7px">← obra</button>' : '') +
      '<span class="muted" style="margin-left:auto">' + f.length + ' · ' + tot.toFixed(1) + ' t</span>';
    var v = $('prgVolver'); if (v) v.addEventListener('click', function () { CAL_CUB = null; pintarPorCubicar(); pintarCubicadas(); pintarCal(); });
    $('prgPorCub').innerHTML =
      '<thead><tr><th>Tarea</th><th>Despacho</th><th>Cubicación</th><th style="text-align:right">Ton</th><th></th></tr></thead><tbody>' +
      (f.length ? f.map(function (t) {
        return '<tr><td class="tar" title="' + esc(t.obra) + '">' + esc(t.nombre) + '</td>' +
          '<td><input type="date" data-d="' + t.id + '" value="' + (t.fecha_despacho || '') + '"' + (PUEDE ? '' : ' disabled') + '></td>' +
          '<td>' + corta(t.fecha_cubicacion) +
            (t.plazo_corto ? ' <span class="prg7" title="Se programó con menos de 7 días hábiles de margen">&lt;7d</span>' : '') + '</td>' +
          '<td style="text-align:right"><input class="ton" data-n="' + t.id + '" value="' + (t.ton_estimadas != null ? t.ton_estimadas : '') + '" placeholder="—"' + (PUEDE ? '' : ' disabled') + '></td>' +
          '<td>' + (PUEDE ? '<button class="q" data-q="' + t.id + '" title="Sacar del programa">✕</button>' : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted">Nada por cubicar.</td></tr>') + '</tbody>';
    $('prgPorCub').querySelectorAll('input[data-d]').forEach(function (i) {
      i.addEventListener('change', function () { editar(Number(i.getAttribute('data-d')), { fecha_despacho: i.value }); }); });
    $('prgPorCub').querySelectorAll('input[data-n]').forEach(function (i) {
      i.addEventListener('change', function () {
        var v = parseFloat(String(i.value).replace(',', '.'));
        editar(Number(i.getAttribute('data-n')), { ton_estimadas: isNaN(v) ? null : v }); }); });
    $('prgPorCub').querySelectorAll('[data-q]').forEach(function (b) {
      b.addEventListener('click', async function () {
        try { await req('DELETE', '/programacion/tareas/' + b.getAttribute('data-q') + '/programacion'); await refrescar(); }
        catch (e) { aviso(e.message); } }); });
  }

  async function editar(id, cambios) {
    try { await req('PATCH', '/programacion/tareas/' + id, cambios); await refrescar(); }
    catch (e) { aviso(e.message); }
  }

  // ── CAJA 4 · cubicadas ───────────────────────────────────────────────────────
  // El peso REAL no se teclea: son los kilos de las barras de ese frente en ArmaHub. El Δ es la
  // evidencia con la que después se decide si la estimación del USC sirve o hay que ayudarla.
  function pintarCubicadas() {
    var s = seleccion();
    var f = (DATA && DATA.cubicadas) || [];
    if (s.cub) f = f.filter(function (t) { return t.cubicador_email === CAL_CUB.email; });
    var est = f.reduce(function (a, t) { return a + (t.ton_estimadas || 0); }, 0);
    var real = f.reduce(function (a, t) { return a + (t.ton_reales || 0); }, 0);
    $('prgCubH').innerHTML = 'Cubicadas <span class="muted">· ' + esc(s.rot) + '</span>' +
      '<span class="muted" style="margin-left:auto">' + est.toFixed(1) + ' est · <b style="color:#2e7d32">' + real.toFixed(1) + ' real</b></span>';
    $('prgCubicadas').innerHTML =
      '<thead><tr><th>Tarea</th><th>Cubicación</th><th style="text-align:right">Est</th><th style="text-align:right">Real</th><th style="text-align:right">Δ</th></tr></thead><tbody>' +
      (f.length ? f.map(function (t) {
        var r = t.ton_reales || 0, e = t.ton_estimadas, d = (e != null && r) ? (r - e) : null;
        var cls = d == null ? '' : (Math.abs(d) <= Math.max(0.1, e * 0.1) ? 'ok' : (d > 0 ? 'mas' : 'menos'));
        return '<tr><td class="tar" title="' + esc(t.obra) + '">' + esc(t.nombre) + '</td>' +
          '<td>' + corta(t.fecha_cubicacion) + '</td>' +
          '<td style="text-align:right">' + (e != null ? e.toFixed(1) : '—') + '</td>' +
          '<td style="text-align:right">' + (r ? r.toFixed(1) : '—') + '</td>' +
          '<td style="text-align:right" class="dif ' + cls + '">' + (d == null ? '—' : (d > 0 ? '+' : '') + d.toFixed(1)) + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted">Todavía nada cubicado.</td></tr>') + '</tbody>';
  }

  // ── CALENDARIO DE NÚMEROS ────────────────────────────────────────────────────
  // Una semana, una fila por cubicador, «n · t» por día. Sirve para ver el choque (varios USC
  // pidiéndole al mismo cubicador el mismo día) y con cuánto queda cada uno. El detalle de una
  // persona se ve en las cajas 3 y 4 tocando su nombre: así el calendario no se ensucia.
  async function pintarCal() {
    var l = semanaBase(), ds = dias5(l), h0 = hoy();
    $('prgSemTxt').textContent = corta(ds[0]) + ' – ' + corta(ds[4]) + (SEM === 0 ? ' · esta semana' : '');
    try { CAL = await req('GET', '/programacion/semana?desde=' + iso(l)); } catch (e) { return aviso(e.message); }
    if (!CAL) return;
    var porCub = {};
    (CAL.celdas || []).forEach(function (c) {
      var k = c.cubicador_email || c.cubicador;
      (porCub[k] = porCub[k] || { nombre: c.cubicador, email: c.cubicador_email, dias: {} }).dias[c.dia] = c;
    });
    // Todos los cubicadores del área, tengan carga o no: una semana vacía no debe verse como
    // si el área no existiera.
    (CAL.cubicadores || []).forEach(function (c) {
      if (!porCub[c.email]) porCub[c.email] = { nombre: c.nombre, email: c.email, dias: {} };
    });
    var filas = Object.keys(porCub).map(function (k) { return porCub[k]; })
      .sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre)); });
    var html = '<thead><tr><th class="q">Cubicador</th>' + ds.map(function (d, i) {
      return '<th' + (mismo(d, h0) ? ' class="hoy"' : '') + '>' + DIAS[i] +
        '<small style="font-weight:400;color:#90a4ae">' + corta(d) + '</small></th>'; }).join('') +
      '<th>Semana</th></tr></thead><tbody>';
    filas.forEach(function (f) {
      var wn = 0, wt = 0;
      html += '<tr><td class="q' + (CAL_CUB && CAL_CUB.email === f.email ? ' on' : '') + '" data-c="' + esc(f.email || '') +
        '" data-n="' + esc(f.nombre) + '" title="Ver sus tareas en las cajas de arriba">' + esc(f.nombre) + '</td>';
      ds.forEach(function (d) {
        var c = f.dias[iso(d)];
        var n = c ? c.n : 0, t = c ? c.ton : 0, choque = !!(c && c.n >= 3 && c.n_usc >= 2);
        wn += n; wt += t;
        html += '<td class="' + (choque ? 'choque' : '') + (mismo(d, h0) ? ' hoy' : '') + (n ? '' : ' vac') + '"' +
          (c ? ' title="' + esc(c.obras || '') + '"' : '') + '>' +
          (n ? n + ' · ' + t.toFixed(0) + ' t' : '—') +
          (choque ? '<small style="color:#c62828">' + c.n_usc + ' USC</small>' : '') + '</td>';
      });
      html += '<td class="tot">' + wn + ' · ' + wt.toFixed(0) + ' t</td></tr>';
    });
    $('prgCal').innerHTML = html + '</tbody>';
    $('prgCal').querySelectorAll('td.q').forEach(function (td) {
      td.addEventListener('click', function () {
        var em = td.getAttribute('data-c');
        CAL_CUB = (CAL_CUB && CAL_CUB.email === em) ? null : { email: em, nombre: td.getAttribute('data-n') };
        pintarPorCubicar(); pintarCubicadas(); pintarCal();
      });
    });
    var cortas = (CAL.celdas || []).reduce(function (a, c) { return a + (c.cortas || 0); }, 0);
    $('prgCalMsg').innerHTML = cortas
      ? '<b style="color:#e65100">' + cortas + '</b> tarea(s) de esta semana se programaron con menos de 7 días hábiles de margen.'
      : '';
  }

})(window);
