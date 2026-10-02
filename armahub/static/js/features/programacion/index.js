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
      // El módulo abre en «Semana», el flujo aprobado (30-sep); lo demás queda detrás.
      global.prgSubTab('semana');
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
    [['semana','prgSubSemana','prgPanelSemana'],
     ['usc','prgSubUsc','prgPanelUsc'], ['obras','prgSubObras','prgPanelObras'],
     ['equipo','prgSubEquipo','prgPanelEquipo'], ['cub','prgSubCub','prgPanelCub']]
      .forEach(function (t) {
        var on = (t[0] === v), b = $(t[1]), p = $(t[2]);
        if (b) { b.style.borderBottomColor = on ? '#8BC34A' : 'transparent'; b.style.color = on ? '#33691e' : '#aaa'; }
        if (p) p.style.display = on ? '' : 'none';
      });
    // El tab de Obras se carga al abrirlo, no al cargar el módulo: consulta el estado de
    // aSa y eso puede tardar. Nadie paga ese costo si no entra a la pestaña.
    if (v === 'obras' && !OBRAS_CARGADO) cargarObras();
    // La semana (maqueta) vive en semana.js y trae su propia data (el real de aSa).
    if (v === 'semana' && global.loadPrgSemana) global.loadPrgSemana();
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

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB OBRAS · traer de aSa + asignar USC
  //
  // El buscador consulta el ESPEJO en Postgres, no aSa. Por eso responde al instante y
  // sigue sirviendo aunque aSa esté caído. A aSa se le habla sólo al pulsar «Refrescar»
  // (y, cuando se configure, una vez al día). Ver docs/integracion_asa.md.
  // ═══════════════════════════════════════════════════════════════════════════
  var OBRAS_CARGADO = false, ASA = null, USC = [], ASIG = [], BUSCA_T = null;

  async function cargarObras() {
    OBRAS_CARGADO = true;
    await Promise.all([cargarEstadoAsa(), cargarAsignacion()]);
    bindObras();
    buscarAsa();
  }

  var _boundObras = false;
  function bindObras() {
    if (_boundObras) return; _boundObras = true;
    $('prgAsaSync').addEventListener('click', sincronizarAsa);
    // Debounce: no se dispara una consulta por tecla. Aunque la búsqueda sea local, pintar
    // en cada pulsación hace saltar la lista mientras se escribe.
    $('prgAsaQ').addEventListener('input', function () {
      clearTimeout(BUSCA_T); BUSCA_T = setTimeout(buscarAsa, 220);
    });
    $('prgSoloSinUsc').addEventListener('change', pintarAsignacion);
  }

  async function cargarEstadoAsa() {
    try { ASA = await req('GET', '/programacion/asa/estado'); }
    catch (e) { ASA = { configurado: false, ok: false, detalle: e.message }; }
    pintarEstadoAsa();
  }

  function pintarEstadoAsa() {
    var chip = $('prgAsaChip'), av = $('prgAsaEstado');
    if (!ASA) return;
    var esp = ASA.espejo || {}, n = esp.obras || 0;

    if (!ASA.configurado) {
      chip.className = 'prgchip sin'; chip.textContent = 'sin configurar';
      av.className = 'prgaviso';
      av.innerHTML = 'Falta la credencial de aSa. Se carga como variable de entorno —nunca ' +
        'en el código—: <code>' + esc((ASA.faltan || []).join('</code>, <code>')) + '</code>.<br>' +
        'En tu PC van en el archivo <code>.env</code>; en producción, en Render → Environment. ' +
        'Para probar: <code>python scripts/asa_ping.py</code>';
      $('prgAsaRes').innerHTML = vacio('El espejo está vacío porque aSa todavía no está conectado.');
      return;
    }
    if (ASA.ok) { chip.className = 'prgchip ok'; chip.textContent = 'conectado'; }
    else { chip.className = 'prgchip no'; chip.textContent = 'no responde'; }

    var txt = '';
    if (!ASA.ok) {
      av.className = 'prgaviso mal';
      txt = '<b>aSa no contestó.</b> ' + esc(ASA.detalle || '') + '<br>' +
            'El buscador sigue funcionando con lo último que se trajo.';
    } else {
      av.className = 'prgaviso';
      txt = n ? ('<b>' + n + '</b> obras en el espejo' +
                 (esp.ultima_sync ? ', traídas el ' + esc(fechaHora(esp.ultima_sync)) : '') + '.')
              : 'El espejo está vacío. Pulsa <b>↻ Refrescar</b> para traer las obras de aSa.';
      var ui = esp.ultimo_intento;
      if (ui && !ui.ok && ui.detalle) txt += '<br><span style="color:#c62828">Último intento falló: ' + esc(ui.detalle) + '</span>';
    }
    txt += textoReloj();
    av.innerHTML = txt;
  }

  // EL RELOJ. El backend siempre lo mandó y la pantalla lo tiraba: así nadie podía saber
  // si la data se refresca sola, que es justo lo que uno asume cuando no se dice nada.
  // Importa decirlo acá y no en otra pantalla: es el mismo recuadro donde está el botón
  // de refrescar a mano, o sea donde uno va a preguntarse por qué la data está vieja.
  function textoReloj() {
    var r = (ASA && ASA.reloj) || null;
    if (!r) return '';
    if (r.corriendo) {
      return '<br>Se refresca solo a las <b>' + esc((r.horarios || []).join(', ')) + '</b>' +
             ' (hora de Chile)' +
             (r.proxima ? '. Próximo turno: <b>' + esc(fechaHora(r.proxima)) + '</b>' : '') + '.';
    }
    if (r.activo) {
      return '<br><span style="color:#c62828">El reloj está encendido pero su hilo no corre.</span> ' +
             'Hay que reiniciar el servicio; mientras, el espejo sólo se actualiza a mano.';
    }
    return '<br><b>No se refresca solo:</b> el reloj está apagado. Se enciende con ' +
           '<code>ASA_SYNC_ACTIVO=1</code> en Render → Environment. Mientras, la data ' +
           'es la del último <b>↻ Refrescar</b>.';
  }

  function fechaHora(s) {
    var d = new Date(s); if (isNaN(d)) return s;
    return d.getDate() + ' ' + MES[d.getMonth()] + ' ' +
           ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function vacio(m) { return '<div class="muted" style="padding:16px 8px; font-size:11px; text-align:center;">' + esc(m) + '</div>'; }

  async function sincronizarAsa() {
    var b = $('prgAsaSync'), antes = b.textContent;
    b.disabled = true; b.textContent = '↻ consultando aSa…';
    try {
      var r = await req('POST', '/programacion/asa/sincronizar');
      if (global.showToast) global.showToast(r.filas + ' obras leídas de aSa · ' + r.nuevas + ' nuevas', 'success');
      await cargarEstadoAsa();
      buscarAsa();
    } catch (e) {
      aviso(e.message);
      await cargarEstadoAsa();
    } finally { b.disabled = false; b.textContent = antes; }
  }

  async function buscarAsa() {
    if (!ASA || !ASA.configurado) return;
    var q = $('prgAsaQ').value.trim();
    try {
      var d = await req('GET', '/programacion/asa/buscar?limite=40&q=' + encodeURIComponent(q));
      pintarResultados((d && d.resultados) || [], q);
    } catch (e) { $('prgAsaRes').innerHTML = vacio(e.message); }
  }

  function pintarResultados(filas, q) {
    if (!filas.length) {
      $('prgAsaRes').innerHTML = vacio(q ? 'Ninguna obra coincide con «' + q + '».'
                                         : 'El espejo está vacío. Pulsa ↻ Refrescar.');
      return;
    }
    $('prgAsaRes').innerHTML = filas.map(function (o) {
      // El estado va en la línea de abajo porque el espejo trae las 677 obras, no sólo
      // las abiertas: sin verlo, adoptar una obra ya finalizada sería un accidente.
      var sub = [o.asa_job_id, o.cliente, o.estado].filter(Boolean).join(' · ');
      return '<div class="prgar">' +
        '<div class="n"><b>' + esc(o.nombre || o.asa_job_id) + '</b><small>' + esc(sub) + '</small></div>' +
        (o.adoptada
          ? '<span class="ya" title="Ya existe en ArmaHub como ' + esc(o.id_proyecto) + '">✓ en ArmaHub</span>'
          : '<button data-job="' + esc(o.asa_job_id) + '">Traer</button>') +
        '</div>';
    }).join('');
    $('prgAsaRes').querySelectorAll('button[data-job]').forEach(function (b) {
      b.addEventListener('click', function () { adoptar(b.dataset.job, b); });
    });
  }

  async function adoptar(job, boton) {
    boton.disabled = true;
    try {
      var r = await req('POST', '/programacion/asa/adoptar', { asa_job_id: job });
      if (global.showToast) global.showToast('Obra traída a ArmaHub como ' + r.id_proyecto, 'success');
      await cargarAsignacion();
      buscarAsa();
    } catch (e) { aviso(e.message); boton.disabled = false; }
  }

  // ── Asignación de USC ────────────────────────────────────────────────────────
  async function cargarAsignacion() {
    try {
      var a = await req('GET', '/programacion/usc');
      var b = await req('GET', '/programacion/obras-asignacion');
      USC = (a && a.usc) || []; ASIG = (b && b.obras) || [];
    } catch (e) {
      // Si falla, la caja NO puede quedar en blanco: un panel vacío se lee como «no hay
      // nada», y lo que pasó fue un error. Pasó de verdad —una consulta rota dejó el tab
      // mudo— y por eso el mensaje va DENTRO de la caja, no sólo en un toast que se va.
      aviso(e.message);
      $('prgUscAviso').className = 'prgaviso mal';
      $('prgUscAviso').innerHTML = '<b>No se pudo cargar la lista de obras.</b> ' + esc(e.message);
      $('prgAsig').innerHTML = '';
      $('prgAsigN').textContent = '';
      return;
    }
    // Hoy no existe ningún usuario con rol USC (el usuario los va a crear). Sin decirlo,
    // el selector se vería vacío y parecería un error del sistema.
    $('prgUscAviso').className = USC.length ? 'prgaviso' : 'prgaviso mal';
    $('prgUscAviso').innerHTML = USC.length ? ''
      : '<b>Todavía no hay usuarios con rol USC.</b> Se crean en Administración → Usuarios; ' +
        'apenas existan, aparecen en el selector de cada obra.';
    pintarAsignacion();
  }

  function pintarAsignacion() {
    var solo = $('prgSoloSinUsc').checked;
    var filas = solo ? ASIG.filter(function (o) { return !o.usc_id; }) : ASIG;
    var sin = ASIG.filter(function (o) { return !o.usc_id; }).length;
    $('prgAsigN').textContent = '· ' + ASIG.length + (sin ? ' · ' + sin + ' sin USC' : '');
    if (!filas.length) { $('prgAsig').innerHTML = ''; return; }

    var opciones = function (sel) {
      return '<option value="">— sin asignar —</option>' + USC.map(function (u) {
        return '<option value="' + u.id + '"' + (u.id === sel ? ' selected' : '') + '>' + esc(u.nombre) + '</option>';
      }).join('');
    };
    $('prgAsig').innerHTML =
      '<thead><tr><th>Obra</th><th>Origen</th><th style="text-align:right">Frentes</th>' +
      '<th style="text-align:right">Tareas</th><th>USC</th></tr></thead><tbody>' +
      filas.map(function (o) {
        return '<tr' + (o.usc_id ? '' : ' class="sinusc"') + '>' +
          '<td class="tar" title="' + esc(o.id_proyecto) + '">' + esc(o.obra) + '</td>' +
          '<td><span class="prgor ' + (o.origen === 'asa' ? 'asa">aSa' : 'armahub">ArmaHub') + '</span></td>' +
          '<td style="text-align:right">' + o.frentes + '</td>' +
          '<td style="text-align:right">' + o.tareas + '</td>' +
          '<td><select class="usc" data-obra="' + esc(o.id_proyecto) + '"' + (USC.length ? '' : ' disabled') + '>' +
            opciones(o.usc_id) + '</select></td></tr>';
      }).join('') + '</tbody>';

    $('prgAsig').querySelectorAll('select.usc').forEach(function (s) {
      s.addEventListener('change', function () { asignarUsc(s.dataset.obra, s.value, s); });
    });
  }

  async function asignarUsc(idProyecto, valor, sel) {
    sel.disabled = true;
    try {
      await req('POST', '/programacion/obras/' + encodeURIComponent(idProyecto) + '/usc',
                { user_id: valor ? parseInt(valor, 10) : null });
      var o = ASIG.filter(function (x) { return x.id_proyecto === idProyecto; })[0];
      if (o) { o.usc_id = valor ? parseInt(valor, 10) : null; }
      pintarAsignacion();
    } catch (e) { aviso(e.message); sel.disabled = false; }
  }

})(window);
