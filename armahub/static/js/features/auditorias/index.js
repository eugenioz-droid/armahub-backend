// AUDITORÍAS DE CUBICACIÓN — MAQUETA (1-oct). Ver tabs/auditorias.html y auditorias.py.
//
// Lo que hace hoy: el formulario que CREA la auditoría (obra, quién audita, alcance,
// muestra, fechas automáticas), saca la muestra REAL de elementos al azar, y la lista de
// auditorías con estado, fechas y resultado. La revisión elemento a elemento viene después.
//
// ES MAQUETA: las auditorías se guardan en ESTE navegador (localStorage). Cuando el
// formato esté aprobado pasan a la base; la muestra se reproduce con su semilla.
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function kg0(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function ddmm(s) { if (!s) return '—'; var p = s.slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0].slice(2); }
  function aviso(m) { if (global.showToast) global.showToast(m, 'error'); else alert(m); }

  async function req(url) {
    var res = await fetch(global.apiUrl(url), { headers: global.authHeaders() });
    if (res.status === 401) { global.logout(); return null; }
    var data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.detail) || ('Error ' + res.status));
    return data;
  }

  // Misma regla de los filtros de aSa Data: clic = sólo ése, Ctrl+clic = sumar, clic en
  // el único elegido = soltar (todos).
  function alternar(lista, valor, ev) {
    var i = lista.indexOf(valor);
    if (ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) { if (i === -1) lista.push(valor); else lista.splice(i, 1); }
    else if (lista.length === 1 && i === 0) lista.length = 0;
    else { lista.length = 0; lista.push(valor); }
    return lista;
  }

  // PLAZO: días hábiles desde la creación. Después lo fija el backend (y será configurable).
  var DIAS_PLAZO = 10;
  function sumaHabiles(desde, n) {
    var d = new Date(desde.getTime());
    while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
    return d;
  }
  var COLOR = { conforme: '#8BC34A', observacion: '#ffb74d', nc_menor: '#ef9a9a', nc_mayor: '#c62828' };
  var ESTADO_TXT = { planificada: 'Planificada', en_curso: 'En curso', cerrada: 'Cerrada' };

  var BASE = null, UNIV = null;
  var OBRA = '', AUDITOR = '', SECT = [], PISOS = [], CICLOS = [];
  var AUDS = [], ABIERTA = null;
  var CLAVE = 'audMaqueta';
  function leer() { try { return JSON.parse(localStorage.getItem(CLAVE) || '[]'); } catch (e) { return []; } }
  function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify(AUDS)); } catch (e) {} }

  var _bound = false;
  global.loadAuditorias = async function () {
    if (!$('tab-auditorias')) return;
    try {
      BASE = await req('/auditorias/obras');
      if (!BASE) return;
      AUDS = leer();
      if (!_bound) { _bound = true; bind(); }
      pintarForm();
      pintarLista();
    } catch (e) { aviso(e.message); }
  };

  function bind() {
    $('audObra').addEventListener('change', async function () {
      OBRA = this.value; SECT = []; PISOS = []; CICLOS = []; UNIV = null;
      if (OBRA) {
        try { UNIV = await req('/auditorias/universo?id_proyecto=' + encodeURIComponent(OBRA)); }
        catch (e) { aviso(e.message); }
      }
      pintarAlcance(); pintarEstado();
    });
    $('audAuditor').addEventListener('change', function () { AUDITOR = this.value; pintarEstado(); });
    $('audN').addEventListener('input', pintarEstado);
    $('audCrear').addEventListener('click', crear);
    $('audDetCerrar').addEventListener('click', function () { ABIERTA = null; pintarLista(); pintarDetalle(); });
  }

  function pintarForm() {
    var so = $('audObra');
    so.innerHTML = '<option value="">— elige la obra —</option>' + (BASE.obras || []).map(function (o) {
      return '<option value="' + esc(o.id_proyecto) + '">' + esc(o.obra) + ' · ' + o.elementos + ' elementos' +
             (o.reclamos ? ' · ' + o.reclamos + ' reclamo(s) abierto(s)' : '') + '</option>';
    }).join('');
    so.value = OBRA;
    var sa = $('audAuditor');
    sa.innerHTML = '<option value="">— quién audita —</option>' + (BASE.auditores || []).map(function (a) {
      return '<option value="' + esc(a.email) + '">' + esc(a.nombre) + '</option>';
    }).join('');
    sa.value = AUDITOR;
    $('audN').value = $('audN').value || BASE.muestra_por_defecto || 10;
    var hoy = new Date();
    $('audFCreacion').textContent = ddmm(iso(hoy));
    $('audFPlazo').textContent = ddmm(iso(sumaHabiles(hoy, DIAS_PLAZO))) + ' (' + DIAS_PLAZO + ' hábiles)';
    pintarAlcance(); pintarEstado();
  }

  // El alcance se arma con lo que la obra TIENE: cada chip dice cuántos elementos trae.
  function pintarAlcance() {
    var caja = $('audAlcance');
    if (!UNIV) { caja.style.display = 'none'; $('audObraInfo').textContent = ''; return; }
    caja.style.display = '';
    var o = (BASE.obras || []).filter(function (x) { return x.id_proyecto === OBRA; })[0] || {};
    $('audObraInfo').textContent = UNIV.elementos + ' elementos · ' + kg0(o.kg) + ' kg · cubicaron: ' +
      (UNIV.cubicadores || []).map(function (c) { return c.email.split('@')[0]; }).join(', ');
    var chips = function (cont, lista, clave, activos, etiqueta) {
      cont.innerHTML = lista.map(function (x) {
        var v = x[clave];
        return '<button data-v="' + esc(v) + '" class="' + (activos.indexOf(v) !== -1 ? 'on' : '') + '">' +
               esc(etiqueta ? etiqueta(x) : (v || '(sin)')) + '<small>' + x.elementos + '</small></button>';
      }).join('') || '<span class="muted" style="font-size:10px">—</span>';
      cont.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function (ev) { alternar(activos, b.dataset.v, ev); pintarAlcance(); pintarEstado(); });
      });
    };
    chips($('audSectores'), UNIV.sectores || [], 'sector', SECT, function (x) { return x.nombre; });
    chips($('audPisos'), UNIV.pisos || [], 'piso', PISOS);
    chips($('audCiclos'), UNIV.ciclos || [], 'ciclo', CICLOS);
  }

  function pintarEstado() {
    var n = parseInt($('audN').value, 10) || 0;
    var ok = !!(OBRA && AUDITOR && n > 0 && UNIV);
    $('audCrear').disabled = !ok;
    $('audRango').textContent = UNIV ? ('alcance: ' + (SECT.length ? SECT.map(function (s) {
      return ((UNIV.sectores || []).filter(function (x) { return x.sector === s; })[0] || {}).nombre || s; }).join(', ') : 'todos los tipos') +
      ' · ' + (PISOS.length ? PISOS.join(', ') : 'todos los pisos') + ' · ' + (CICLOS.length ? CICLOS.join(', ') : 'todos los ciclos')) : '';
    $('audNInfo').textContent = UNIV ? ('de ' + UNIV.elementos) : '';
    $('audCrearMsg').textContent = ok ? '' : 'Elige obra y quién audita.';
  }

  // CREAR = sacar la muestra y dejar la auditoría planificada. Las fechas las pone el sistema.
  async function crear() {
    var n = parseInt($('audN').value, 10) || 10;
    $('audCrear').disabled = true; $('audCrearMsg').textContent = 'Sacando la muestra…';
    try {
      var m = await req('/auditorias/muestra?id_proyecto=' + encodeURIComponent(OBRA) + '&n=' + n +
        '&sectores=' + encodeURIComponent(SECT.join(',')) + '&pisos=' + encodeURIComponent(PISOS.join(',')) +
        '&ciclos=' + encodeURIComponent(CICLOS.join(',')));
      if (!m) return;
      var o = (BASE.obras || []).filter(function (x) { return x.id_proyecto === OBRA; })[0] || {};
      var a = (BASE.auditores || []).filter(function (x) { return x.email === AUDITOR; })[0] || {};
      var hoy = new Date();
      var aud = {
        id: 'A-' + Date.now().toString(36).toUpperCase(), id_proyecto: OBRA, obra: o.obra || OBRA,
        auditor: AUDITOR, auditor_nombre: a.nombre || AUDITOR,
        alcance: { sectores: SECT.slice(), pisos: PISOS.slice(), ciclos: CICLOS.slice() },
        n: m.n, total_rango: m.total_rango, semilla: m.semilla, elementos: m.elementos,
        kg: m.kg, barras: m.barras,
        creada: iso(hoy), plazo: iso(sumaHabiles(hoy, DIAS_PLAZO)), inicio: null, cierre: null,
        estado: 'planificada', resultado: null
      };
      AUDS.unshift(aud); guardar();
      ABIERTA = aud.id;
      $('audCrearMsg').textContent = 'Lista: ' + m.elementos.length + ' elementos de ' + m.total_rango + ' en el alcance.';
      pintarLista(); pintarDetalle();
    } catch (e) { aviso(e.message); $('audCrearMsg').textContent = e.message; }
    pintarEstado();
  }

  function alcanceTxt(a) {
    var s = a.alcance || {};
    var tipos = (s.sectores || []).map(function (x) { return (BASE.sectores || {})[x] || x; });
    return [tipos.length ? tipos.join(', ') : 'Todo', s.pisos && s.pisos.length ? s.pisos.join(', ') : 'todos los pisos',
            s.ciclos && s.ciclos.length ? s.ciclos.join(', ') : 'todos los ciclos'].join(' · ');
  }
  // La barrita del resultado: conforme / observación / NC menor / NC mayor sobre la muestra.
  function barraResultado(a) {
    var r = a.resultado;
    if (!r) return '<div class="audres" title="Sin revisar"></div>';
    var tot = a.n || 1;
    return '<div class="audres" title="' + esc(Object.keys(r).map(function (k) { return k + ': ' + r[k]; }).join(' · ')) + '">' +
      Object.keys(COLOR).map(function (k) { return r[k] ? '<i style="width:' + (r[k] / tot * 100).toFixed(1) + '%; background:' + COLOR[k] + '"></i>' : ''; }).join('') + '</div>';
  }

  function pintarLista() {
    $('audListaN').textContent = '· ' + AUDS.length;
    if (!AUDS.length) {
      $('audLista').innerHTML = '<tbody><tr><td class="audvacio">Todavía no hay auditorías. Crea la primera arriba.</td></tr></tbody>';
      return;
    }
    var html = '<thead><tr><th>#</th><th>Obra</th><th>Alcance</th><th>Audita</th><th class="num">Muestra</th>' +
      '<th>Creada</th><th>Plazo</th><th>Cierre</th><th>Estado</th><th>Resultado</th></tr></thead><tbody>';
    AUDS.forEach(function (a) {
      html += '<tr class="fila' + (a.id === ABIERTA ? ' sel' : '') + '" data-id="' + esc(a.id) + '">' +
        '<td class="cc">' + esc(a.id) + '</td>' +
        '<td title="' + esc(a.obra) + '">' + esc(a.obra) + '</td>' +
        '<td title="' + esc(alcanceTxt(a)) + '">' + esc(alcanceTxt(a)) + '</td>' +
        '<td>' + esc(a.auditor_nombre) + '</td>' +
        '<td class="num" title="' + a.barras + ' barras · ' + kg0(a.kg) + ' kg">' + a.n + ' de ' + a.total_rango + '</td>' +
        '<td>' + ddmm(a.creada) + '</td><td>' + ddmm(a.plazo) + '</td><td>' + ddmm(a.cierre) + '</td>' +
        '<td><span class="audest ' + esc(a.estado) + '">' + esc(ESTADO_TXT[a.estado] || a.estado) + '</span></td>' +
        '<td>' + barraResultado(a) + '</td></tr>';
    });
    $('audLista').innerHTML = html + '</tbody>';
    $('audLista').querySelectorAll('tr.fila').forEach(function (tr) {
      tr.addEventListener('click', function () { ABIERTA = (ABIERTA === tr.dataset.id) ? null : tr.dataset.id; pintarLista(); pintarDetalle(); });
    });
  }

  // La auditoría abierta: la muestra que salió. Marca en rojo si el auditor cubicó ese
  // elemento (independencia): ese elemento habría que cambiarlo.
  function pintarDetalle() {
    var a = AUDS.filter(function (x) { return x.id === ABIERTA; })[0];
    var caja = $('audDetalle');
    if (!a) { caja.style.display = 'none'; return; }
    caja.style.display = '';
    $('audDetTitulo').textContent = a.id + ' · ' + a.obra;
    $('audDetInfo').innerHTML = 'Audita <b>' + esc(a.auditor_nombre) + '</b> · alcance ' + esc(alcanceTxt(a)) +
      ' · muestra <b>' + a.n + '</b> de ' + a.total_rango + ' elementos · ' + a.barras + ' barras · ' + kg0(a.kg) +
      ' kg · semilla <code>' + esc(a.semilla) + '</code>';
    var html = '<thead><tr><th>Elemento</th><th>Tipo</th><th>Piso</th><th>Ciclo</th><th>Eje</th>' +
      '<th class="num">Barras</th><th class="num">Kilos</th><th>Cubicó</th><th>Hallazgo</th></tr></thead><tbody>';
    var conflicto = 0;
    (a.elementos || []).forEach(function (e) {
      var mismo = (e.cubicado_por || '').indexOf(a.auditor) !== -1;
      if (mismo) conflicto++;
      html += '<tr><td title="' + esc(e.nombre) + '"><b>' + esc(e.nombre) + '</b></td>' +
        '<td>' + esc(e.tipo) + '</td><td>' + esc(e.piso) + '</td><td>' + esc(e.ciclo) + '</td><td>' + esc(e.eje) + '</td>' +
        '<td class="num">' + e.barras + '</td><td class="num">' + kg0(e.kg) + '</td>' +
        '<td' + (mismo ? ' class="indep" title="Lo cubicó quien audita: hay que cambiar este elemento"' : '') + '>' +
        esc((e.cubicado_por || '').split('@')[0]) + (mismo ? ' ⚠' : '') + '</td>' +
        '<td class="muted">pendiente</td></tr>';
    });
    $('audDetElems').innerHTML = html + '</tbody>';
    if (conflicto) $('audDetInfo').innerHTML += ' · <b style="color:#c62828">' + conflicto + ' elemento(s) cubicados por quien audita</b>';
  }

  // Expuesto para los tests: lo puro.
  global.__auditoriasTest = { alternar: alternar, sumaHabiles: sumaHabiles, DIAS_PLAZO: DIAS_PLAZO };

})(window);
