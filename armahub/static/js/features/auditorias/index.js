// AUDITORÍAS DE CUBICACIÓN (1-oct). Ver tabs/auditorias.html y auditorias.py.
//
// Tres pantallas en una:
//   1. CREAR: obra, quién audita, alcance (tipo · pisos · ciclos) y cuántos elementos.
//      Las fechas las pone el sistema. Al crear, el servidor sortea la muestra y la
//      GUARDA: de ahí en adelante se audita contra esa lista, que ya no cambia.
//   2. REVISAR: la muestra, y al abrir un elemento sus barras enteras. Por elemento, un
//      hallazgo en los cuatro niveles de la ISO, con qué se encontró y la causa.
//   3. ACCIONES: cada no conformidad le queda al que cubicó. Él la marca corregida —en
//      su cubicación, no acá— y el auditor la verifica.
//
// El estado y las fechas NO se eligen: los deriva el backend de los hallazgos. El front
// sólo muestra lo que vino.
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function kg0(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function ddmm(s) { if (!s) return '—'; var p = s.slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0].slice(2); }
  function aviso(m) { if (global.showToast) global.showToast(m, 'error'); else alert(m); }
  function ok(m) { if (global.showToast) global.showToast(m, 'success'); }

  async function req(metodo, url, cuerpo) {
    var opts = { method: metodo, headers: Object.assign({}, global.authHeaders()) };
    if (cuerpo !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(cuerpo); }
    var res = await fetch(global.apiUrl(url), opts);
    if (res.status === 401) { global.logout(); return null; }
    var data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var det = data && data.detail;
      if (Array.isArray(det)) det = det.map(function (d) { return (d.loc || []).slice(-1) + ': ' + d.msg; }).join(' · ');
      throw new Error((det && (det.msg || det)) || ('Error ' + res.status));
    }
    return data;
  }

  // ACÁ EL CLIC SIMPLE SUMA. En los filtros de aSa Data el clic deja «sólo ése» porque
  // uno mira una cosa a la vez; acá se está ARMANDO un alcance —«los pisos 3, 4 y 5»— y
  // elegir varios es el caso normal, no la excepción. Lista vacía = todos.
  function marcar(lista, valor) {
    var i = lista.indexOf(valor);
    if (i === -1) lista.push(valor); else lista.splice(i, 1);
    return lista;
  }

  var COLOR = { conforme: '#8BC34A', observacion: '#ffb74d', nc_menor: '#ef9a9a', nc_mayor: '#c62828' };
  var HALLAZGO_TXT = { conforme: 'Conforme', observacion: 'Observación', nc_menor: 'NC menor', nc_mayor: 'NC mayor' };
  var ESTADO_TXT = { planificada: 'Planificada', en_curso: 'En curso', cerrada: 'Cerrada' };
  var ACCION_TXT = { pendiente: 'Pendiente', corregida: 'Corregida', verificada: 'Verificada' };

  var BASE = null, UNIV = null;
  // La obra se elige con su ORIGEN pegado ('armahub|PROY-x' o 'asa|2010136'): una misma
  // pantalla sirve para las dos fuentes y no hay un segundo selector que mantener.
  var ORIGEN = 'armahub', OBRA = '', AUDITOR = '';
  var SECT = [], PISOS = [], CICLOS = [];              // alcance de ArmaHub
  var ANIOS = [], ESTADOS = [], PERSONAS = [], BUSCA = '';  // alcance de aSa
  var LISTA = [], ABIERTA = null, AUD = null, ELEM = null;

  var _bound = false;
  global.loadAuditorias = async function () {
    if (!$('tab-auditorias')) return;
    try {
      BASE = await req('GET', '/auditorias/obras');
      if (!BASE) return;
      if (!_bound) { _bound = true; bind(); }
      pintarForm();
      await cargarLista();
      await cargarMisAcciones();
    } catch (e) { aviso(e.message); }
  };

  function bind() {
    // El formulario arranca plegado: al entrar uno viene a mirar, no a crear.
    $('audNueva').addEventListener('click', function () { abrirForm($('audForm').style.display === 'none'); });
    $('audFormCerrar').addEventListener('click', function () { abrirForm(false); });
    $('audBusca').addEventListener('input', function () { BUSCA = this.value; pintarEstado(); });
    $('audObra').addEventListener('change', async function () {
      var p = (this.value || '').split('|');
      ORIGEN = p[0] || 'armahub'; OBRA = p.slice(1).join('|');
      SECT = []; PISOS = []; CICLOS = []; ANIOS = []; ESTADOS = []; PERSONAS = []; BUSCA = '';
      $('audBusca').value = ''; UNIV = null;
      if (OBRA) {
        try {
          UNIV = ORIGEN === 'asa'
            ? await req('GET', '/auditorias/universo-asa?job=' + encodeURIComponent(OBRA))
            : await req('GET', '/auditorias/universo?id_proyecto=' + encodeURIComponent(OBRA));
        } catch (e) { aviso(e.message); }
      }
      pintarAlcance(); pintarEstado();
    });
    $('audAuditor').addEventListener('change', function () { AUDITOR = this.value; pintarEstado(); });
    $('audN').addEventListener('input', pintarEstado);
    $('audCrear').addEventListener('click', crear);
    $('audDetCerrar').addEventListener('click', function () { ABIERTA = null; AUD = null; ELEM = null; pintarLista(); pintarDetalle(); });
    $('audRevGuardar').addEventListener('click', guardarHallazgo);
  }

  function abrirForm(abrir) {
    $('audForm').style.display = abrir ? '' : 'none';
    $('audNueva').textContent = abrir ? '✕ Cerrar' : '＋ Crear auditoría';
    $('audNueva').className = abrir ? 'audnueva on' : 'audnueva';
  }

  function pintarForm() {
    // DOS GRUPOS en el mismo selector. Arriba las de ArmaHub —ahí están las barras y la
    // auditoría es más profunda—; abajo las de aSa, que son muchas más. Una obra que está
    // en las dos aparece sólo arriba: el backend no la repite.
    var so = $('audObra');
    so.innerHTML = '<option value="">— elige la obra —</option>' +
      '<optgroup label="En ArmaHub · con sus barras (' + (BASE.obras || []).length + ')">' +
      (BASE.obras || []).map(function (o) {
        return '<option value="armahub|' + esc(o.id_proyecto) + '">' + esc(o.obra) + ' · ' + o.elementos + ' elementos' +
               (o.reclamos ? ' · ' + o.reclamos + ' reclamo(s) abierto(s)' : '') + '</option>';
      }).join('') + '</optgroup>' +
      '<optgroup label="Sólo en aSa · últimos 12 meses (' + (BASE.obras_asa || []).length + ')">' +
      (BASE.obras_asa || []).map(function (o) {
        return '<option value="asa|' + esc(o.job) + '">' + esc(o.obra) + ' · ' + o.cc + ' códigos · ' +
               kg0(o.kg) + ' kg</option>';
      }).join('') + '</optgroup>';
    so.value = OBRA ? (ORIGEN + '|' + OBRA) : '';
    var sa = $('audAuditor');
    sa.innerHTML = '<option value="">— quién audita —</option>' + (BASE.auditores || []).map(function (a) {
      return '<option value="' + esc(a.email) + '">' + esc(a.nombre) + '</option>';
    }).join('');
    sa.value = AUDITOR;
    if (!$('audN').value) $('audN').value = BASE.muestra_por_defecto || 10;
    $('audFCreacion').textContent = 'hoy';
    $('audFPlazo').textContent = (BASE.dias_plazo || 10) + ' días hábiles';
    pintarAlcance(); pintarEstado();
  }

  // El alcance se arma con lo que la obra TIENE: cada chip dice cuántos elementos trae.
  function pintarAlcance() {
    var caja = $('audAlcance'), cajaAsa = $('audAlcanceAsa');
    if (!UNIV) {
      caja.style.display = 'none'; cajaAsa.style.display = 'none';
      $('audObraInfo').textContent = ''; return;
    }
    if (ORIGEN === 'asa') { caja.style.display = 'none'; cajaAsa.style.display = ''; return pintarAlcanceAsa(); }
    caja.style.display = ''; cajaAsa.style.display = 'none';
    var o = (BASE.obras || []).filter(function (x) { return x.id_proyecto === OBRA; })[0] || {};
    $('audObraInfo').textContent = UNIV.elementos + ' elementos · ' + kg0(o.kg) + ' kg · cubicaron: ' +
      (UNIV.cubicadores || []).map(function (c) { return c.email.split('@')[0]; }).join(', ');
    // Cada chip lleva CUÁNTOS ELEMENTOS tiene disponibles, en su propia pastilla: pegado
    // al nombre parecía parte del nombre («C12 8») y no se entendía qué era ese número.
    // El primero es «Todos», que suelta la selección: así se ve que vacío = todos.
    var chips = function (cont, lista, clave, activos, etiqueta) {
      var total = lista.reduce(function (a, x) { return a + x.elementos; }, 0);
      cont.innerHTML = '<button data-todos="1" class="todos' + (activos.length ? '' : ' on') + '"' +
          ' title="Sin nada marcado se auditan todos">Todos <i>' + total + '</i></button>' +
        lista.map(function (x) {
          var v = x[clave], n = etiqueta ? etiqueta(x) : (v || '(sin dato)');
          return '<button data-v="' + esc(v) + '" class="' + (activos.indexOf(v) !== -1 ? 'on' : '') + '"' +
                 ' title="' + esc(n) + ' · ' + x.elementos + ' elementos disponibles">' +
                 esc(n) + ' <i>' + x.elementos + '</i></button>';
        }).join('');
      cont.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.dataset.todos) activos.length = 0; else marcar(activos, b.dataset.v);
          pintarAlcance(); pintarEstado();
        });
      });
    };
    chips($('audSectores'), UNIV.sectores || [], 'sector', SECT, function (x) { return x.nombre; });
    chips($('audPisos'), UNIV.pisos || [], 'piso', PISOS);
    chips($('audCiclos'), UNIV.ciclos || [], 'ciclo', CICLOS);
  }

  // El alcance de aSa: año, estado y quién cubicó. El contador es de CÓDIGOS DE CONTROL,
  // no de elementos — en aSa el elemento sólo se conoce al pedir los ítems del código.
  function pintarAlcanceAsa() {
    $('audObraInfo').textContent = UNIV.cc + ' códigos de control · cubicaron: ' +
      (UNIV.personas || []).slice(0, 6).map(function (p) { return (p.email || '').split('@')[0]; }).join(', ');
    var chips = function (cont, lista, clave, activos, etiqueta) {
      var total = lista.reduce(function (a, x) { return a + x.cc; }, 0);
      cont.innerHTML = '<button data-todos="1" class="todos' + (activos.length ? '' : ' on') + '"' +
          ' title="Sin nada marcado entran todos">Todos <i>' + total + '</i></button>' +
        lista.map(function (x) {
          var v = String(x[clave]), n = etiqueta ? etiqueta(x) : v;
          return '<button data-v="' + esc(v) + '" class="' + (activos.indexOf(v) !== -1 ? 'on' : '') + '"' +
                 ' title="' + esc(n) + ' · ' + x.cc + ' códigos disponibles">' + esc(n) + ' <i>' + x.cc + '</i></button>';
        }).join('');
      cont.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.dataset.todos) activos.length = 0; else marcar(activos, b.dataset.v);
          pintarAlcanceAsa(); pintarEstado();
        });
      });
    };
    chips($('audAnios'), UNIV.anios || [], 'anio', ANIOS);
    chips($('audEstados'), UNIV.estados || [], 'estado', ESTADOS);
    chips($('audPersonas'), UNIV.personas || [], 'email', PERSONAS, function (x) { return (x.email || '').split('@')[0]; });
  }

  function pintarEstado() {
    var n = parseInt($('audN').value, 10) || 0;
    var listo = !!(OBRA && AUDITOR && n > 0 && UNIV);
    $('audCrear').disabled = !listo;
    if (ORIGEN === 'asa') {
      $('audRangoAsa').textContent = UNIV ? ('alcance: ' + (ANIOS.length ? ANIOS.join(', ') : 'todos los años') +
        ' · ' + (ESTADOS.length ? ESTADOS.join(', ') : 'todos los estados') +
        ' · ' + (PERSONAS.length ? PERSONAS.map(function (p) { return p.split('@')[0]; }).join(', ') : 'todos') +
        (BUSCA ? ' · descripción contiene «' + BUSCA + '»' : '')) : '';
      // En aSa cada elemento cuesta una consulta: por eso el tope es más bajo.
      $('audNInfo').textContent = UNIV ? ('máx ' + UNIV.maximo) : '';
      if (listo && n > (UNIV.maximo || 20)) {
        $('audCrearMsg').textContent = 'En aSa el máximo es ' + UNIV.maximo + ': cada elemento se pide a aSa.';
      } else {
        $('audCrearMsg').textContent = listo ? 'Puede tardar: se le pide a aSa un código a la vez.' : 'Elige obra y quién audita.';
      }
      return;
    }
    $('audRango').textContent = UNIV ? ('alcance: ' + (SECT.length ? SECT.map(function (s) {
      return ((UNIV.sectores || []).filter(function (x) { return x.sector === s; })[0] || {}).nombre || s; }).join(', ') : 'todos los tipos') +
      ' · ' + (PISOS.length ? PISOS.join(', ') : 'todos los pisos') + ' · ' + (CICLOS.length ? CICLOS.join(', ') : 'todos los ciclos')) : '';
    $('audNInfo').textContent = UNIV ? ('de ' + UNIV.elementos) : '';
    $('audCrearMsg').textContent = listo ? '' : 'Elige obra y quién audita.';
  }

  async function crear() {
    $('audCrear').disabled = true; $('audCrearMsg').textContent = 'Sorteando la muestra…';
    try {
      var a = await req('POST', '/auditorias', {
        id_proyecto: OBRA, auditor: AUDITOR, origen: ORIGEN, n: parseInt($('audN').value, 10) || 10,
        sectores: SECT, pisos: PISOS, ciclos: CICLOS,
        anios: ANIOS, estados: ESTADOS, personas: PERSONAS, busca: BUSCA
      });
      if (!a) return;
      ok('Auditoría ' + a.codigo + ' creada');
      abrirForm(false);
      $('audCrearMsg').textContent = a.codigo + ': ' + a.elementos.length + ' elementos de ' + a.total_rango + ' del alcance.';
      ABIERTA = a.id; AUD = a; ELEM = null;
      await cargarLista();
      pintarDetalle();
    } catch (e) { aviso(e.message); $('audCrearMsg').textContent = e.message; }
    pintarEstado();
  }

  async function cargarLista() {
    try {
      var d = await req('GET', '/auditorias');
      LISTA = (d && d.auditorias) || [];
      pintarLista();
    } catch (e) { aviso(e.message); }
  }

  function alcanceTxt(a) {
    var tipos = (a.sectores || []).map(function (x) { return (BASE.sectores || {})[x] || x; });
    return [tipos.length ? tipos.join(', ') : 'Todo',
            (a.pisos || []).length ? a.pisos.join(', ') : 'todos los pisos',
            (a.ciclos || []).length ? a.ciclos.join(', ') : 'todos los ciclos'].join(' · ');
  }
  // La barrita del resultado: conforme / observación / NC menor / NC mayor de la muestra.
  function barraResultado(a) {
    var r = a.resultado || {};
    if (!a.revisados) return '<div class="audres" title="Sin revisar"></div>';
    return '<div class="audres" title="' + Object.keys(HALLAZGO_TXT).map(function (k) {
        return HALLAZGO_TXT[k] + ': ' + (r[k] || 0); }).join(' · ') + '">' +
      Object.keys(COLOR).map(function (k) {
        return r[k] ? '<i style="width:' + (r[k] / a.n * 100).toFixed(1) + '%; background:' + COLOR[k] + '"></i>' : '';
      }).join('') + '</div>';
  }

  function pintarLista() {
    $('audListaN').textContent = '· ' + LISTA.length;
    if (!LISTA.length) {
      $('audLista').innerHTML = '<tbody><tr><td class="audvacio">Todavía no hay auditorías. Crea la primera arriba.</td></tr></tbody>';
      return;
    }
    var html = '<thead><tr><th>#</th><th>Obra</th><th>Alcance</th><th>Audita</th><th class="num">Muestra</th>' +
      '<th>Creada</th><th>Plazo</th><th>Cierre</th><th>Estado</th><th>Resultado</th><th></th></tr></thead><tbody>';
    LISTA.forEach(function (a) {
      var vencida = a.estado !== 'cerrada' && a.plazo && a.plazo < new Date().toISOString().slice(0, 10);
      html += '<tr class="fila' + (a.id === ABIERTA ? ' sel' : '') + '" data-id="' + a.id + '">' +
        '<td class="cc">' + esc(a.codigo) + '</td>' +
        '<td title="' + esc(a.obra) + '">' + esc(a.obra) +
          ' <span class="audori ' + esc(a.origen || 'armahub') + '">' + (a.origen === 'asa' ? 'aSa' : 'ArmaHub') + '</span></td>' +
        '<td title="' + esc(alcanceTxt(a)) + '">' + esc(alcanceTxt(a)) + '</td>' +
        '<td>' + esc((a.auditor || '').split('@')[0]) + '</td>' +
        '<td class="num" title="' + kg0(a.kg) + ' kg">' + a.revisados + '/' + a.n + ' de ' + a.total_rango + '</td>' +
        '<td>' + ddmm(a.creada) + '</td>' +
        '<td' + (vencida ? ' class="venc" title="Pasó el plazo"' : '') + '>' + ddmm(a.plazo) + '</td>' +
        '<td>' + ddmm(a.cierre) + '</td>' +
        '<td><span class="audest ' + esc(a.estado) + '">' + esc(ESTADO_TXT[a.estado] || a.estado) + '</span>' +
          (a.acciones_abiertas ? ' <span class="audpend" title="Acciones sin corregir">' + a.acciones_abiertas + '</span>' : '') + '</td>' +
        '<td>' + barraResultado(a) + '</td>' +
        '<td>' + (a.revisados ? '' : '<button class="audx" data-borrar="' + a.id + '" title="Borrar: todavía no tiene hallazgos">✕</button>') + '</td></tr>';
    });
    $('audLista').innerHTML = html + '</tbody>';
    $('audLista').querySelectorAll('tr.fila').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target.dataset.borrar) return;
        abrir(Number(tr.dataset.id));
      });
    });
    $('audLista').querySelectorAll('button[data-borrar]').forEach(function (b) {
      b.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        if (!confirm('¿Borrar esta auditoría? Todavía no tiene hallazgos.')) return;
        try {
          await req('DELETE', '/auditorias/' + b.dataset.borrar);
          if (ABIERTA === Number(b.dataset.borrar)) { ABIERTA = null; AUD = null; }
          await cargarLista(); pintarDetalle(); ok('Auditoría borrada');
        } catch (e) { aviso(e.message); }
      });
    });
  }

  async function abrir(id) {
    if (ABIERTA === id) { ABIERTA = null; AUD = null; ELEM = null; pintarLista(); pintarDetalle(); return; }
    try {
      AUD = await req('GET', '/auditorias/' + id);
      ABIERTA = id; ELEM = null;
      pintarLista(); pintarDetalle();
    } catch (e) { aviso(e.message); }
  }

  function pintarDetalle() {
    var caja = $('audDetalle');
    if (!AUD) { caja.style.display = 'none'; $('audRev').style.display = 'none'; return; }
    caja.style.display = '';
    $('audDetTitulo').textContent = AUD.codigo + ' · ' + AUD.obra;
    $('audDetInfo').innerHTML = 'Audita <b>' + esc((AUD.auditor || '').split('@')[0]) + '</b> · alcance ' +
      esc(alcanceTxt(AUD)) + ' · muestra <b>' + AUD.n + '</b> de ' + AUD.total_rango +
      ' · revisados <b>' + AUD.revisados + '/' + AUD.n + '</b> · ' + kg0(AUD.kg) + ' kg' +
      ' · <span class="audest ' + esc(AUD.estado) + '">' + esc(ESTADO_TXT[AUD.estado] || AUD.estado) + '</span>' +
      ' · semilla <code>' + esc(AUD.semilla) + '</code>';
    var conflicto = (AUD.elementos || []).filter(function (e) { return e.conflicto; }).length;
    if (conflicto) $('audDetInfo').innerHTML += ' · <b style="color:#c62828">' + conflicto + ' elemento(s) cubicados por quien audita</b>';

    var html = '<thead><tr><th>Elemento</th><th>Tipo</th><th>Piso</th><th>Ciclo</th><th>Eje</th>' +
      '<th class="num">Barras</th><th class="num">Kilos</th><th>Cubicó</th><th>Hallazgo</th><th>Acción</th></tr></thead><tbody>';
    (AUD.elementos || []).forEach(function (e) {
      html += '<tr class="fila' + (ELEM && ELEM.id === e.id ? ' sel' : '') + '" data-id="' + e.id + '" title="Clic para revisar este elemento">' +
        '<td title="' + esc(e.nombre) + '"><b>' + esc(e.nombre) + '</b></td>' +
        '<td>' + esc(e.tipo || '') + '</td><td>' + esc(e.piso) + '</td><td>' + esc(e.ciclo) + '</td><td>' + esc(e.eje) + '</td>' +
        '<td class="num">' + e.barras + '</td><td class="num">' + kg0(e.kg) + '</td>' +
        '<td' + (e.conflicto ? ' class="indep" title="Lo cubicó quien audita: habría que cambiar este elemento"' : '') + '>' +
          esc((e.cubicado_por || '').split('@')[0]) + (e.conflicto ? ' ⚠' : '') + '</td>' +
        '<td>' + (e.hallazgo
          ? '<span class="audhz ' + esc(e.hallazgo) + '">' + esc(HALLAZGO_TXT[e.hallazgo]) + '</span>' +
            (e.texto ? ' <span class="muted" title="' + esc(e.texto) + '">' + esc(e.texto.slice(0, 36)) + (e.texto.length > 36 ? '…' : '') + '</span>' : '')
          : '<span class="muted">pendiente</span>') + '</td>' +
        '<td>' + (e.accion_estado ? '<span class="audacc1 ' + esc(e.accion_estado) + '">' + esc(ACCION_TXT[e.accion_estado]) + '</span>' : '') + '</td></tr>';
    });
    $('audDetElems').innerHTML = html + '</tbody>';
    $('audDetElems').querySelectorAll('tr.fila').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var e = (AUD.elementos || []).filter(function (x) { return x.id === Number(tr.dataset.id); })[0];
        abrirElemento(e);
      });
    });
    pintarAcciones();
    if (ELEM) {
      var vivo = (AUD.elementos || []).filter(function (x) { return x.id === ELEM.id; })[0];
      if (vivo) { ELEM = vivo; pintarRevision(); } else { ELEM = null; $('audRev').style.display = 'none'; }
    }
  }

  // Abrir un elemento: se traen sus barras y aparece el formulario de hallazgo.
  async function abrirElemento(e) {
    ELEM = e; pintarDetalle();
    $('audRev').style.display = '';
    $('audRevTitulo').textContent = e.nombre;
    $('audRevInfo').textContent = 'cargando…';
    $('audRevBarras').innerHTML = '';
    pintarRevision();
    try {
      // De dónde se piden las barras depende del origen: las de ArmaHub están en casa;
      // las de aSa se piden en vivo por código de control (1 a 11 segundos).
      var d = AUD.origen === 'asa'
        ? await req('GET', '/auditorias/elemento-asa?cc=' + encodeURIComponent(e.cc || '') +
                           '&element=' + encodeURIComponent(e.eje || ''))
        : await req('GET', '/auditorias/elemento?id_proyecto=' + encodeURIComponent(AUD.id_proyecto) +
                           '&sector=' + encodeURIComponent(e.sector || '') + '&piso=' + encodeURIComponent(e.piso || '') +
                           '&ciclo=' + encodeURIComponent(e.ciclo || '') + '&eje=' + encodeURIComponent(e.eje || ''));
      if (!d) return;
      $('audRevInfo').textContent = d.n + ' barras · ' + kg0(d.kg) + ' kg · ' +
        (AUD.origen === 'asa' ? ('CC ' + d.cc + ' · ' + (d.descr || '')) :
          ('plano ' + (d.planos.join(', ') || '—') + ' · cubicó ' +
           (d.cubicaron || []).map(function (x) { return x.split('@')[0]; }).join(', ')));
      var html = '<thead><tr><th>Marca</th><th class="num">Ø</th><th>Figura</th><th>Lados / dimensiones</th>' +
        '<th class="num">Largo</th><th class="num">Cant</th><th class="num">Peso</th><th>' +
        (AUD.origen === 'asa' ? 'Elemento / nota' : 'Plano') + '</th></tr></thead><tbody>';
      d.barras.forEach(function (b) {
        var dims = Object.keys(b.dims || {}).map(function (k) { return k + '=' + b.dims[k]; }).join(' · ');
        html += '<tr><td class="cc">' + esc(b.marca || '') + '</td><td class="num">' + esc(b.diam || '') + '</td>' +
          '<td>' + esc(b.figura || '') + '</td><td class="cc" title="' + esc(dims) + '">' + esc(dims) + '</td>' +
          '<td class="num">' + (b.largo != null ? Math.round(b.largo) : '') + '</td>' +
          '<td class="num">' + (b.cant_total != null ? b.cant_total : (b.cant || '')) + '</td>' +
          '<td class="num">' + kg0(b.peso_total) + '</td>' +
          '<td title="' + esc((b.plano || '') + (b.nota ? ' · ' + b.nota : '')) + '">' +
            esc(b.plano || '') + (b.nota ? ' <span class="muted">· ' + esc(b.nota) + '</span>' : '') + '</td></tr>';
      });
      $('audRevBarras').innerHTML = html + '</tbody>';
    } catch (err) { $('audRevInfo').textContent = err.message; }
  }

  // El formulario de hallazgo: cuatro niveles (ISO), texto, y la causa del Ishikawa.
  function pintarRevision() {
    if (!ELEM) { $('audRev').style.display = 'none'; return; }
    $('audRev').style.display = '';
    var sel = ELEM.hallazgo || '';
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
    sc.value = ELEM.causa || '';
    sc.style.display = (sel === 'conforme' || !sel) ? 'none' : '';
    $('audRevTexto').value = ELEM.texto || '';
    $('audRevMsg').textContent = ELEM.revisado_el
      ? 'Registrado ' + ddmm(ELEM.revisado_el) + (ELEM.revisado_por ? ' por ' + ELEM.revisado_por.split('@')[0] : '')
      : '';
  }

  async function guardarHallazgo() {
    if (!AUD || !ELEM) return;
    var on = $('audRevChips').querySelector('button.on');
    if (!on) { $('audRevMsg').textContent = 'Marca el hallazgo.'; return; }
    $('audRevGuardar').disabled = true;
    try {
      AUD = await req('PUT', '/auditorias/' + AUD.id + '/elementos/' + ELEM.id, {
        hallazgo: on.dataset.h, texto: $('audRevTexto').value, causa: $('audRevCausa').value });
      ok('Hallazgo guardado');
      await cargarLista();
      pintarDetalle();
    } catch (e) { aviso(e.message); $('audRevMsg').textContent = e.message; }
    $('audRevGuardar').disabled = false;
  }

  // Las acciones que salen de las NC: para quien cubicó. Él marca corregida; el auditor verifica.
  function pintarAcciones() {
    var caja = $('audAcciones');
    var acc = (AUD.elementos || []).filter(function (e) { return e.accion_estado; });
    if (!acc.length) { caja.style.display = 'none'; return; }
    caja.style.display = '';
    caja.innerHTML = '<div class="audh">Acciones <span class="muted">' + acc.length +
      ' · una por cada no conformidad. La corrección la hace quien cubicó, en su cubicación; el auditor verifica.</span></div>' +
      '<table class="audt"><thead><tr><th>Elemento</th><th>Para</th><th>Hallazgo</th><th>Qué se encontró</th>' +
      '<th>Causa</th><th>Estado</th><th></th></tr></thead><tbody>' +
      acc.map(function (e) {
        return '<tr><td title="' + esc(e.nombre) + '">' + esc(e.nombre) + '</td>' +
          '<td>' + esc((e.cubicado_por || '').split('@')[0]) + '</td>' +
          '<td><span class="audhz ' + esc(e.hallazgo) + '">' + esc(HALLAZGO_TXT[e.hallazgo]) + '</span></td>' +
          '<td title="' + esc(e.texto || '') + '">' + esc(e.texto || '') + '</td>' +
          '<td class="cc" title="' + esc(e.causa || '') + '">' + esc(e.causa || '') + '</td>' +
          '<td><span class="audacc1 ' + esc(e.accion_estado) + '">' + esc(ACCION_TXT[e.accion_estado]) + '</span>' +
            (e.accion_por ? ' <span class="muted" style="font-size:9px">' + esc(e.accion_por.split('@')[0]) + '</span>' : '') + '</td>' +
          '<td>' + (e.accion_estado === 'pendiente'
              ? '<button class="audmini" data-acc="corregida" data-el="' + e.id + '">Marcar corregida</button>'
              : e.accion_estado === 'corregida'
                ? '<button class="audmini ver" data-acc="verificada" data-el="' + e.id + '">Verificar</button>'
                : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    caja.querySelectorAll('button[data-acc]').forEach(function (b) {
      b.addEventListener('click', async function () {
        b.disabled = true;
        try {
          AUD = await req('PUT', '/auditorias/' + AUD.id + '/elementos/' + b.dataset.el + '/accion',
                          { estado: b.dataset.acc });
          ok('Acción ' + ACCION_TXT[b.dataset.acc].toLowerCase());
          await cargarLista(); await cargarMisAcciones(); pintarDetalle();
        } catch (e) { aviso(e.message); b.disabled = false; }
      });
    });
  }

  // MIS ACCIONES: lo que a mí me toca corregir, sin tener que buscar en qué auditoría salió.
  async function cargarMisAcciones() {
    var caja = $('audMias');
    if (!caja) return;
    try {
      var d = await req('GET', '/auditorias/mias/acciones');
      var abiertas = ((d && d.acciones) || []).filter(function (a) { return a.accion_estado !== 'verificada'; });
      if (!abiertas.length) { caja.style.display = 'none'; return; }
      caja.style.display = '';
      caja.innerHTML = '<div class="audh">Mis correcciones pendientes <span class="muted">' + abiertas.length +
        ' · salieron de una auditoría de tu cubicación</span></div>' +
        '<table class="audt"><thead><tr><th>Auditoría</th><th>Obra</th><th>Elemento</th><th>Hallazgo</th>' +
        '<th>Qué encontró el auditor</th><th>Plazo</th><th>Estado</th><th></th></tr></thead><tbody>' +
        abiertas.map(function (a) {
          return '<tr><td class="cc">' + esc(a.codigo) + '</td><td>' + esc(a.obra) + '</td>' +
            '<td>' + esc(a.elemento) + '</td>' +
            '<td><span class="audhz ' + esc(a.hallazgo) + '">' + esc(HALLAZGO_TXT[a.hallazgo]) + '</span></td>' +
            '<td title="' + esc(a.texto || '') + '">' + esc(a.texto || '') + '</td>' +
            '<td>' + ddmm(a.plazo) + '</td>' +
            '<td><span class="audacc1 ' + esc(a.accion_estado) + '">' + esc(ACCION_TXT[a.accion_estado]) + '</span></td>' +
            '<td>' + (a.accion_estado === 'pendiente'
              ? '<button class="audmini" data-mia="' + a.elemento_id + '" data-aud="' + a.auditoria_id + '">Ya la corregí</button>'
              : '<span class="muted" style="font-size:9.5px">esperando al auditor</span>') + '</td></tr>';
        }).join('') + '</tbody></table>';
      caja.querySelectorAll('button[data-mia]').forEach(function (b) {
        b.addEventListener('click', async function () {
          b.disabled = true;
          try {
            await req('PUT', '/auditorias/' + b.dataset.aud + '/elementos/' + b.dataset.mia + '/accion',
                      { estado: 'corregida' });
            ok('Avisado al auditor');
            await cargarMisAcciones(); await cargarLista();
            if (AUD && AUD.id === Number(b.dataset.aud)) { AUD = await req('GET', '/auditorias/' + AUD.id); pintarDetalle(); }
          } catch (e) { aviso(e.message); b.disabled = false; }
        });
      });
    } catch (e) { caja.style.display = 'none'; }
  }

  // Expuesto para los tests: lo puro.
  global.__auditoriasTest = { marcar: marcar, HALLAZGO_TXT: HALLAZGO_TXT, ACCION_TXT: ACCION_TXT };

})(window);
