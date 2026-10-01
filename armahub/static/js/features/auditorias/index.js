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

  // ── Las reglas, puras ───────────────────────────────────────────────────────
  function claveDe(e) { return [e.sector, e.piso, e.ciclo, e.eje].join('|'); }
  // RESULTADO = cuántos elementos quedaron en cada hallazgo. Null si no se revisó nada.
  function resultadoDe(aud) {
    var r = { conforme: 0, observacion: 0, nc_menor: 0, nc_mayor: 0 }, n = 0;
    Object.keys(aud.hallazgos || {}).forEach(function (k) {
      var h = aud.hallazgos[k];
      if (h && r[h.hallazgo] != null) { r[h.hallazgo]++; n++; }
    });
    return n ? r : null;
  }
  // ESTADO se deriva, no se elige: sin revisar = planificada; algo revisado = en curso;
  // todo revisado = cerrada. (Cuando deje de ser maqueta, cerrar exigirá además que las
  // acciones de las NC estén verificadas.)
  function estadoDe(aud) {
    var n = Object.keys(aud.hallazgos || {}).length;
    if (!n) return 'planificada';
    return n >= (aud.elementos || []).length ? 'cerrada' : 'en_curso';
  }
  // ACCIONES: cada no conformidad es una acción para quien cubicó ese elemento. La
  // corrección NO la hace el auditor en el sistema: se le exige al cubicador.
  function accionesDe(aud) {
    return (aud.elementos || []).map(function (e) {
      var h = (aud.hallazgos || {})[claveDe(e)];
      if (!h || (h.hallazgo !== 'nc_menor' && h.hallazgo !== 'nc_mayor')) return null;
      return { elemento: e.nombre, para: e.cubicado_por, hallazgo: h.hallazgo, texto: h.texto,
               causa: h.causa, estado: h.accion || 'pendiente' };
    }).filter(Boolean);
  }
  var HALLAZGO_TXT = { conforme: 'Conforme', observacion: 'Observación', nc_menor: 'NC menor', nc_mayor: 'NC mayor' };

  // La auditoría abierta: la muestra que salió, con el hallazgo de cada elemento. Marca
  // en rojo si el auditor cubicó ese elemento (independencia): habría que cambiarlo.
  var ELEM = null;   // el elemento que se está revisando
  function pintarDetalle() {
    var a = AUDS.filter(function (x) { return x.id === ABIERTA; })[0];
    var caja = $('audDetalle');
    if (!a) { caja.style.display = 'none'; ELEM = null; pintarRevision(null); return; }
    caja.style.display = '';
    var rev = Object.keys(a.hallazgos || {}).length;
    $('audDetTitulo').textContent = a.id + ' · ' + a.obra;
    $('audDetInfo').innerHTML = 'Audita <b>' + esc(a.auditor_nombre) + '</b> · alcance ' + esc(alcanceTxt(a)) +
      ' · muestra <b>' + a.n + '</b> de ' + a.total_rango + ' elementos · ' + a.barras + ' barras · ' + kg0(a.kg) +
      ' kg · revisados <b>' + rev + '/' + (a.elementos || []).length + '</b>' +
      ' · <span class="audest ' + esc(a.estado) + '">' + esc(ESTADO_TXT[a.estado] || a.estado) + '</span>';
    var html = '<thead><tr><th>Elemento</th><th>Tipo</th><th>Piso</th><th>Ciclo</th><th>Eje</th>' +
      '<th class="num">Barras</th><th class="num">Kilos</th><th>Cubicó</th><th>Hallazgo</th></tr></thead><tbody>';
    var conflicto = 0;
    (a.elementos || []).forEach(function (e) {
      var mismo = (e.cubicado_por || '').indexOf(a.auditor) !== -1;
      if (mismo) conflicto++;
      var h = (a.hallazgos || {})[claveDe(e)];
      var k = claveDe(e);
      html += '<tr class="fila' + (ELEM && claveDe(ELEM) === k ? ' sel' : '') + '" data-k="' + esc(k) + '" title="Clic para revisar este elemento">' +
        '<td title="' + esc(e.nombre) + '"><b>' + esc(e.nombre) + '</b></td>' +
        '<td>' + esc(e.tipo) + '</td><td>' + esc(e.piso) + '</td><td>' + esc(e.ciclo) + '</td><td>' + esc(e.eje) + '</td>' +
        '<td class="num">' + e.barras + '</td><td class="num">' + kg0(e.kg) + '</td>' +
        '<td' + (mismo ? ' class="indep" title="Lo cubicó quien audita: hay que cambiar este elemento"' : '') + '>' +
        esc((e.cubicado_por || '').split('@')[0]) + (mismo ? ' ⚠' : '') + '</td>' +
        '<td>' + (h ? '<span class="audhz ' + esc(h.hallazgo) + '">' + esc(HALLAZGO_TXT[h.hallazgo]) + '</span>' +
                      (h.texto ? ' <span class="muted" title="' + esc(h.texto) + '">' + esc(h.texto.slice(0, 40)) + (h.texto.length > 40 ? '…' : '') + '</span>' : '')
                    : '<span class="muted">pendiente</span>') + '</td></tr>';
    });
    $('audDetElems').innerHTML = html + '</tbody>';
    if (conflicto) $('audDetInfo').innerHTML += ' · <b style="color:#c62828">' + conflicto + ' elemento(s) cubicados por quien audita</b>';
    $('audDetElems').querySelectorAll('tr.fila').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var e = (a.elementos || []).filter(function (x) { return claveDe(x) === tr.dataset.k; })[0];
        abrirElemento(a, e);
      });
    });
    pintarAcciones(a);
    if (ELEM && !(a.elementos || []).some(function (x) { return claveDe(x) === claveDe(ELEM); })) { ELEM = null; pintarRevision(null); }
  }

  // Abrir un elemento: se traen sus barras y se muestra el formulario de hallazgo.
  async function abrirElemento(a, e) {
    ELEM = e; pintarDetalle();
    $('audRev').style.display = '';
    $('audRevTitulo').textContent = e.nombre;
    $('audRevInfo').textContent = 'cargando…';
    $('audRevBarras').innerHTML = '';
    try {
      var d = await req('/auditorias/elemento?id_proyecto=' + encodeURIComponent(a.id_proyecto) +
        '&sector=' + encodeURIComponent(e.sector || '') + '&piso=' + encodeURIComponent(e.piso || '') +
        '&ciclo=' + encodeURIComponent(e.ciclo || '') + '&eje=' + encodeURIComponent(e.eje || ''));
      if (!d) return;
      $('audRevInfo').textContent = d.n + ' barras · ' + kg0(d.kg) + ' kg · plano ' + (d.planos.join(', ') || '—') +
        ' · cubicó ' + d.cubicaron.map(function (x) { return x.split('@')[0]; }).join(', ');
      var html = '<thead><tr><th>Marca</th><th class="num">Ø</th><th>Figura</th><th>Dimensiones</th>' +
        '<th class="num">Largo</th><th class="num">Cant</th><th class="num">Peso</th><th>Plano</th></tr></thead><tbody>';
      d.barras.forEach(function (b) {
        var dims = Object.keys(b.dims || {}).map(function (k) { return k + '=' + b.dims[k]; }).join(' · ');
        html += '<tr><td class="cc">' + esc(b.marca || '') + '</td><td class="num">' + esc(b.diam || '') + '</td>' +
          '<td>' + esc(b.figura || '') + '</td><td class="cc" title="' + esc(dims) + '">' + esc(dims) + '</td>' +
          '<td class="num">' + (b.largo != null ? b.largo : '') + '</td><td class="num">' + (b.cant_total != null ? b.cant_total : (b.cant || '')) + '</td>' +
          '<td class="num">' + kg0(b.peso_total) + '</td><td>' + esc(b.plano || '') + '</td></tr>';
      });
      $('audRevBarras').innerHTML = html + '</tbody>';
    } catch (err) { $('audRevInfo').textContent = err.message; }
    pintarRevision(a);
  }

  // El formulario de hallazgo: cuatro niveles (ISO), texto, y la causa del Ishikawa.
  function pintarRevision(a) {
    var caja = $('audRev');
    if (!a || !ELEM) { caja.style.display = 'none'; return; }
    caja.style.display = '';
    var h = (a.hallazgos || {})[claveDe(ELEM)] || {};
    var sel = h.hallazgo || '';
    $('audRevChips').innerHTML = Object.keys(HALLAZGO_TXT).map(function (k) {
      return '<button data-h="' + k + '" class="hz ' + k + (sel === k ? ' on' : '') + '">' + HALLAZGO_TXT[k] + '</button>';
    }).join('');
    $('audRevChips').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        $('audRevChips').querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        $('audRevCausa').style.display = (b.dataset.h === 'conforme') ? 'none' : '';
      });
    });
    var sc = $('audRevCausa');
    sc.innerHTML = '<option value="">causa (Ishikawa Cubicaciones, opcional)</option>' + (BASE.causas || []).map(function (c) {
      return '<option value="' + esc(c.codigo) + '">' + esc(c.codigo) + ' · ' + esc(c.categoria_nombre) + ' · ' + esc(c.descripcion) + '</option>';
    }).join('');
    sc.value = h.causa || '';
    sc.style.display = (sel === 'conforme' || !sel) ? 'none' : '';
    $('audRevTexto').value = h.texto || '';
    $('audRevMsg').textContent = h.fecha ? 'Registrado ' + ddmm(h.fecha) + (h.por ? ' por ' + h.por.split('@')[0] : '') : '';
  }

  function guardarHallazgo() {
    var a = AUDS.filter(function (x) { return x.id === ABIERTA; })[0];
    if (!a || !ELEM) return;
    var on = $('audRevChips').querySelector('button.on');
    if (!on) { $('audRevMsg').textContent = 'Marca el hallazgo.'; return; }
    var texto = $('audRevTexto').value.trim();
    if (on.dataset.h !== 'conforme' && !texto) { $('audRevMsg').textContent = 'Di qué encontraste: sin texto no hay hallazgo.'; return; }
    if (!a.hallazgos) a.hallazgos = {};
    var previo = a.hallazgos[claveDe(ELEM)] || {};
    a.hallazgos[claveDe(ELEM)] = { hallazgo: on.dataset.h, texto: texto, causa: on.dataset.h === 'conforme' ? '' : $('audRevCausa').value,
                                   fecha: iso(new Date()), por: a.auditor, accion: previo.accion || 'pendiente' };
    // Las fechas de inicio y cierre las pone el sistema, igual que la de creación.
    if (!a.inicio) a.inicio = iso(new Date());
    a.resultado = resultadoDe(a);
    a.estado = estadoDe(a);
    a.cierre = a.estado === 'cerrada' ? iso(new Date()) : null;
    guardar();
    pintarLista(); pintarDetalle(); pintarRevision(a);
    $('audRevMsg').textContent = 'Guardado.';
  }

  // Las acciones que salen de las NC: para quién, qué y en qué estado. En la maqueta
  // el estado se cambia acá mismo; en real lo marca el cubicador y lo verifica el auditor.
  function pintarAcciones(a) {
    var caja = $('audAcciones');
    var acc = accionesDe(a);
    if (!acc.length) { caja.style.display = 'none'; return; }
    caja.style.display = '';
    var ESTADO_ACC = { pendiente: 'Pendiente', corregida: 'Corregida (cubicador)', verificada: 'Verificada (auditor)' };
    caja.innerHTML = '<div class="audh">Acciones <span class="muted">' + acc.length + ' · una por cada no conformidad, para quien cubicó</span></div>' +
      '<table class="audt"><thead><tr><th>Elemento</th><th>Para</th><th>Hallazgo</th><th>Qué se encontró</th><th>Causa</th><th>Estado</th></tr></thead><tbody>' +
      acc.map(function (x, i) {
        return '<tr><td>' + esc(x.elemento) + '</td><td>' + esc((x.para || '').split('@')[0]) + '</td>' +
          '<td><span class="audhz ' + esc(x.hallazgo) + '">' + esc(HALLAZGO_TXT[x.hallazgo]) + '</span></td>' +
          '<td title="' + esc(x.texto) + '">' + esc(x.texto) + '</td><td class="cc">' + esc(x.causa || '') + '</td>' +
          '<td><select data-i="' + i + '" class="audsel">' + Object.keys(ESTADO_ACC).map(function (k) {
            return '<option value="' + k + '"' + (x.estado === k ? ' selected' : '') + '>' + ESTADO_ACC[k] + '</option>'; }).join('') +
          '</select></td></tr>';
      }).join('') + '</tbody></table>';
    caja.querySelectorAll('select.audsel').forEach(function (s) {
      s.addEventListener('change', function () {
        var x = acc[Number(s.dataset.i)];
        var e = (a.elementos || []).filter(function (el) { return el.nombre === x.elemento; })[0];
        if (e && a.hallazgos[claveDe(e)]) { a.hallazgos[claveDe(e)].accion = s.value; guardar(); }
      });
    });
  }

  var _bound2 = false;
  function bindRevision() {
    if (_bound2) return; _bound2 = true;
    $('audRevGuardar').addEventListener('click', guardarHallazgo);
  }
  var _loadAnterior = global.loadAuditorias;
  global.loadAuditorias = async function () { await _loadAnterior(); if ($('audRevGuardar')) bindRevision(); };

  // Expuesto para los tests: lo puro.
  global.__auditoriasTest = { alternar: alternar, sumaHabiles: sumaHabiles, DIAS_PLAZO: DIAS_PLAZO,
                              resultadoDe: resultadoDe, estadoDe: estadoDe, accionesDe: accionesDe, claveDe: claveDe };

})(window);
