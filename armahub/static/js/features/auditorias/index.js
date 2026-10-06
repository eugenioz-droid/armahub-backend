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
  // Alcance de aSa. El piso y el ciclo se reconocen del TEXTO del código: allá no
  // son campos. Se ofrecen los que se reconocen en esa obra (55-77% según la obra).
  // Alcance de aSa: los CÓDIGOS elegidos. Allá no hay piso ni ciclo —se intentó
  // reconocerlos del texto del código y era adivinar—, así que se eligen a mano.
  var CCS = [], CC_LISTA = [], CC_BUSCA = '';
  var LISTA = [], ABIERTA = null, AUD = null, ELEM = null, CB_OBRA = null;
  // El veredicto de cada barra del elemento abierto: {ref: {conforme, observacion}}.
  // Vive acá mientras se revisa y se guarda todo junto.
  var BARRAS = [], VERED = {};

  // Las obras de las DOS fuentes en una sola lista, que es lo que come el combobox. El
  // origen viaja en el item, así que elegir una obra de aSa o de ArmaHub es lo mismo
  // para la pantalla.
  // Sólo las obras del origen elegido: el combobox no mezcla dos mundos.
  function obrasParaElegir() {
    if (!BASE) return [];
    if (ORIGEN === 'asa') {
      return (BASE.obras_asa || []).map(function (o) {
        return { id: 'asa|' + o.job, label: o.obra, origen: 'asa', clave: o.job,
                 sub: 'job ' + o.job + ' · ' + o.cc + ' códigos · ' + kg0(o.kg) + ' kg' };
      });
    }
    return (BASE.obras || []).map(function (o) {
      return { id: 'armahub|' + o.id_proyecto, label: o.obra, origen: 'armahub', clave: o.id_proyecto,
               sub: o.elementos + ' elementos' + (o.reclamos ? ' · ' + o.reclamos + ' reclamo(s) abierto(s)' : '') };
    });
  }

  // LA PRIMERA DECISIÓN: de dónde sale la muestra. Cambia el formulario entero, porque
  // las dos fuentes no tienen la misma forma: en ArmaHub hay sector/piso/ciclo; en aSa
  // lo único que hay son códigos de control con el nombre que les puso el cubicador.
  var LOS_ORIGENES = [
    ['armahub', 'ArmaHub', 'Obras cubicadas en ArmaHub: se audita ANTES de exportar a aSa, y el alcance es por tipo, piso y ciclo.'],
    ['asa', 'aSa', 'Obras que no están en ArmaHub: se eligen los códigos de control y de ahí salen los elementos.']
  ];
  function pintarOrigen() {
    $('audOrigen').innerHTML = LOS_ORIGENES.map(function (o) {
      var n = o[0] === 'armahub' ? (BASE.obras || []).length : (BASE.obras_asa || []).length;
      return '<button data-o="' + o[0] + '" class="' + (ORIGEN === o[0] ? 'on' : '') + '" title="' + esc(o[2]) + '">' +
             esc(o[1]) + ' <i>' + n + '</i></button>';
    }).join('');
    $('audOrigen').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (ORIGEN === b.dataset.o) return;
        ORIGEN = b.dataset.o;
        OBRA = ''; UNIV = null; CCS = []; CC_LISTA = []; CC_BUSCA = '';
        SECT = []; PISOS = []; CICLOS = [];
        if (CB_OBRA) CB_OBRA.limpiar();
        pintarOrigen(); pintarAlcance(); pintarEstado();
      });
    });
    $('audOrigenInfo').textContent = (LOS_ORIGENES.filter(function (o) { return o[0] === ORIGEN; })[0] || [])[2] || '';
  }

  // LA CAJA DE CÓDIGOS DE CONTROL: el alcance de una auditoría de aSa.
  function ccVisibles() {
    if (!CC_BUSCA) return CC_LISTA;
    return CC_LISTA.filter(function (c) {
      return (c.descr || '').toLowerCase().indexOf(CC_BUSCA) !== -1 ||
             (c.cc || '').toLowerCase().indexOf(CC_BUSCA) !== -1 ||
             (c.persona || '').toLowerCase().indexOf(CC_BUSCA) !== -1;
    });
  }

  function pintarCC() {
    var vis = ccVisibles();
    var kg = CC_LISTA.filter(function (c) { return CCS.indexOf(c.cc) !== -1; })
                     .reduce(function (a, c) { return a + c.kg; }, 0);
    $('audCcN').innerHTML = CCS.length
      ? '<b style="color:#1565C0">' + CCS.length + ' elegidos</b> · ' + kg0(kg) + ' kg · ' + vis.length + ' a la vista'
      : vis.length + ' de ' + CC_LISTA.length + ' códigos' +
        ((UNIV && UNIV.despachados) ? ' · ' + UNIV.despachados + ' despachados no entran' : '') +
        ((UNIV && UNIV.con_auditoria) ? ' · ' + UNIV.con_auditoria + ' ya tienen elementos auditados' : '');
    if (!vis.length) {
      $('audCcLista').innerHTML = '<div class="audvacio">' +
        (CC_LISTA.length ? 'Ningún código coincide con la búsqueda.'
                         : 'Esta obra no tiene códigos sin despachar.') + '</div>';
      return;
    }
    $('audCcLista').innerHTML = vis.map(function (c) {
      var on = CCS.indexOf(c.cc) !== -1;
      // El estado va PEGADO al código: es lo que se mira junto, no al final de la línea.
      return '<label class="audcc' + (on ? ' on' : '') + '" title="' + esc(c.descr) +
        (c.auditados ? ' · ' + c.auditados + ' elemento(s) ya auditados' : '') + '">' +
        '<input type="checkbox" data-cc="' + esc(c.cc) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="cod">' + esc(c.cc) + '</span>' +
        '<span class="e">' + esc(c.estado) + '</span>' +
        '<span class="d">' + esc(c.descr || '(sin nombre)') + '</span>' +
        (c.auditados ? '<span class="ya">' + c.auditados + ' auditado(s)</span>' : '') +
        '<span class="k">' + kg0(c.kg) + ' kg</span>' +
        '<span class="q">' + esc((c.persona || '').split('@')[0]) + '</span></label>';
    }).join('');
    // El check general refleja lo que se ve: marcado sólo si TODO lo visible está marcado.
    var todos = $('audCcTodos');
    if (todos) {
      var marcados = vis.filter(function (c) { return CCS.indexOf(c.cc) !== -1; }).length;
      todos.checked = vis.length > 0 && marcados === vis.length;
      todos.indeterminate = marcados > 0 && marcados < vis.length;
    }
    $('audCcLista').querySelectorAll('input[data-cc]').forEach(function (el) {
      el.addEventListener('change', function () { marcar(CCS, el.dataset.cc); pintarCC(); pintarEstado(); });
    });
  }

  async function elegirObra(item) {
    ORIGEN = item ? item.origen : 'armahub';
    OBRA = item ? item.clave : '';
    SECT = []; PISOS = []; CICLOS = []; CCS = []; CC_LISTA = []; CC_BUSCA = '';
    $('audCcBusca').value = ''; UNIV = null;
    if (OBRA) {
      try {
        UNIV = ORIGEN === 'asa'
          ? await req('GET', '/auditorias/cc?job=' + encodeURIComponent(OBRA))
          : await req('GET', '/auditorias/universo?id_proyecto=' + encodeURIComponent(OBRA));
        if (ORIGEN === 'asa') CC_LISTA = (UNIV && UNIV.ccs) || [];
      } catch (e) { aviso(e.message); }
    }
    pintarAlcance(); pintarEstado();
  }

  var _bound = false;
  global.loadAuditorias = async function () {
    if (!$('tab-auditorias')) return;
    try {
      BASE = await req('GET', '/auditorias/obras');
      if (!BASE) return;
      if (!_bound) { _bound = true; bind(); }
      pintarOrigen();
      pintarForm();
      await cargarLista();
      await cargarMisAcciones();
      await cargarIndicadores();
    } catch (e) { aviso(e.message); }
  };

  function bind() {
    // El formulario arranca plegado: al entrar uno viene a mirar, no a crear.
    $('audNueva').addEventListener('click', function () { abrirForm($('audForm').style.display === 'none'); });
    $('audFormCerrar').addEventListener('click', function () { abrirForm(false); });
    $('audCcBusca').addEventListener('input', function () { CC_BUSCA = this.value.trim().toLowerCase(); pintarCC(); });
    // Un solo check general: marca lo que se ve, y desmarca lo que se ve.
    $('audCcTodos').addEventListener('change', function () {
      var vis = ccVisibles();
      if (this.checked) vis.forEach(function (c) { if (CCS.indexOf(c.cc) === -1) CCS.push(c.cc); });
      else CCS = CCS.filter(function (x) { return !vis.some(function (c) { return c.cc === x; }); });
      pintarCC(); pintarEstado();
    });
    if (global.Combobox) {
      CB_OBRA = global.Combobox.crear($('audObra'), {
        items: obrasParaElegir,
        placeholder: '🔍 escribe para buscar la obra…',
        onSelect: elegirObra
      });
    }
    $('audAuditor').addEventListener('change', function () { AUDITOR = this.value; pintarEstado(); });
    $('audN').addEventListener('input', pintarEstado);
    $('audCrear').addEventListener('click', crear);
    $('audVolver').addEventListener('click', function () {
      ABIERTA = null; AUD = null; ELEM = null;
      pintarLista(); pintarDetalle(); cargarMisAcciones();
    });
    $('audRevGuardar').addEventListener('click', guardarHallazgo);
    // El PDF se baja con fetch y no con un enlace: el token va en la cabecera, y un
    // <a href> no la lleva (daría 401). Mismo camino que el informe de reclamos.
    $('audPdf').addEventListener('click', async function () {
      if (!AUD) return;
      try {
        var res = await fetch(global.apiUrl('/auditorias/' + AUD.id + '/pdf'), { headers: global.authHeaders() });
        if (!res.ok) throw new Error('No se pudo generar el informe');
        global.open(URL.createObjectURL(await res.blob()), '_blank');
      } catch (e) { aviso(e.message); }
    });
    $('audKpiVer').addEventListener('click', function () {
      var c = $('audKpiCajas').style.display === 'none';
      $('audKpiCajas').style.display = c ? '' : 'none';
      document.querySelector('#audKpi .audres2').style.display = c ? '' : 'none';
      this.textContent = c ? 'ocultar' : 'ver';
    });
  }

  // INDICADORES: lo que la auditoria deja. Se cuentan en la base y sobre lo REVISADO: un
  // elemento pendiente no es ni conforme ni no conforme, y meterlo en el denominador
  // castigaria a quien todavia no termina.
  async function cargarIndicadores() {
    var caja = $('audKpi');
    if (!caja) return;
    try {
      var k = await req('GET', '/auditorias/indicadores');
      if (!k || !k.total || !k.total.revisados) { caja.style.display = 'none'; return; }
      caja.style.display = '';
      var t = k.total, nc = (t.nc_menor || 0) + (t.nc_mayor || 0);
      $('audKpiN').textContent = '· ' + k.auditorias + ' auditorías · ' + k.cerradas + ' cerradas';
      $('audKpiCajas').innerHTML =
        caj(t.conformidad + '%', 'conformidad sobre ' + t.revisados + ' elementos revisados',
            t.conformidad >= 90 ? 'bien' : (t.conformidad < 70 ? 'mal' : '')) +
        caj(nc, 'no conformidades (' + (t.nc_mayor || 0) + ' mayores)', nc ? 'mal' : 'bien') +
        caj(t.observacion || 0, 'observaciones') +
        caj(k.acciones.pendiente || 0, 'acciones sin corregir',
            (k.acciones.pendiente || 0) ? 'mal' : 'bien');
      $('audKpiCub').innerHTML = tabla(k.por_cubicador, 'cubicador', function (x) {
        return esc((x.cubicador || '').split('@')[0]); });
      $('audKpiCausa').innerHTML = k.causas.length
        ? '<thead><tr><th>Causa</th><th class="num">NC</th><th></th></tr></thead><tbody>' +
          k.causas.map(function (c) {
            var tope = k.causas[0].n || 1;
            return '<tr><td title="' + esc(c.causa) + '">' + esc(c.causa) + '</td>' +
              '<td class="num">' + c.n + '</td>' +
              '<td><div class="audbar"><i style="width:' + (c.n / tope * 100).toFixed(0) +
              '%; background:#ef9a9a"></i></div></td></tr>';
          }).join('') + '</tbody>'
        : '<tbody><tr><td class="audvacio">Sin no conformidades todavía.</td></tr></tbody>';
    } catch (e) { caja.style.display = 'none'; }
  }

  function caj(valor, texto, clase) {
    return '<div class="audkpi ' + (clase || '') + '"><b>' + valor + '</b><span>' + texto + '</span></div>';
  }

  function tabla(filas, clave, etiqueta) {
    if (!filas || !filas.length) return '<tbody><tr><td class="audvacio">Sin datos.</td></tr></tbody>';
    return '<thead><tr><th>' + (clave === 'cubicador' ? 'Cubicó' : 'Obra') +
      '</th><th class="num">Revisados</th><th class="num">NC</th><th class="num">Conformidad</th><th></th></tr></thead><tbody>' +
      filas.map(function (x) {
        return '<tr><td>' + etiqueta(x) + '</td><td class="num">' + x.revisados + '</td>' +
          '<td class="num"' + (x.nc ? ' style="color:#c62828;font-weight:700"' : '') + '>' + x.nc + '</td>' +
          '<td class="num">' + (x.conformidad == null ? '—' : x.conformidad + '%') + '</td>' +
          '<td><div class="audbar"><i style="width:' + (x.conformidad || 0) + '%"></i></div></td></tr>';
      }).join('') + '</tbody>';
  }

  function abrirForm(abrir) {
    $('audForm').style.display = abrir ? '' : 'none';
    $('audNueva').textContent = abrir ? '✕ Cerrar' : '＋ Crear auditoría';
    $('audNueva').className = abrir ? 'audnueva on' : 'audnueva';
  }

  function pintarForm() {
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
      $('audObraInfo').textContent = (BASE.obras || []).length + ' obras en ArmaHub (con sus barras) · ' +
        (BASE.obras_asa || []).length + ' en aSa';
      return;
    }
    if (ORIGEN === 'asa') { caja.style.display = 'none'; cajaAsa.style.display = ''; return pintarCC(); }
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

  function pintarEstado() {
    var n = parseInt($('audN').value, 10) || 0;
    var listo = !!(OBRA && AUDITOR && n > 0 && UNIV);
    $('audCrear').disabled = !listo;
    if (ORIGEN === 'asa') {
      // Sin códigos marcados no hay de dónde sacar la muestra.
      listo = listo && CCS.length > 0;
      $('audCrear').disabled = !listo;
      $('audNInfo').textContent = UNIV ? ('máx ' + UNIV.maximo) : '';
      if (!OBRA || !AUDITOR) $('audCrearMsg').textContent = 'Elige obra y quién audita.';
      else if (!CCS.length) $('audCrearMsg').textContent = 'Marca los códigos de control de los que quieres sacar la muestra.';
      else if (n > (UNIV.maximo || 20)) $('audCrearMsg').textContent = 'En aSa el máximo es ' + UNIV.maximo + ': cada código se le pide a aSa.';
      else $('audCrearMsg').textContent = 'Puede tardar: se le piden los elementos a aSa, un código a la vez.';
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
        ccs: CCS
      });
      if (!a) return;
      ok('Auditoría ' + a.codigo + ' creada con ' + a.elementos.length + ' elementos');
      abrirForm(false);
      $('audCrearMsg').textContent = '';
      // Se ENTRA de una a la auditoría recién creada: es lo que uno va a hacer después.
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
    if (a.origen === 'asa') {
      var n = (a.ccs || []).length;
      return n ? (n + ' código(s): ' + a.ccs.slice(0, 6).join(', ') + (n > 6 ? '…' : '')) : 'códigos de control';
    }
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
        // BORRAR. Sin hallazgos, cualquiera que la creó. Con hallazgos, sólo administración:
        // el backend ya lo permitía y el botón no aparecía, así que mientras se prueba el
        // módulo no había cómo limpiar. La confirmación dice cuántos hallazgos se pierden.
        '<td>' + ((!a.revisados || esAdmin())
          ? '<button class="audx" data-borrar="' + a.id + '" data-revisados="' + (a.revisados || 0) + '" title="' +
            (a.revisados ? 'Borrar (tiene ' + a.revisados + ' hallazgo(s): sólo administración)' : 'Borrar: todavía no tiene hallazgos') + '">✕</button>'
          : '') + '</td></tr>';
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
        var nrev = Number(b.dataset.revisados || 0);
        if (!confirm(nrev
          ? '¿Borrar esta auditoría? Tiene ' + nrev + ' hallazgo(s) registrados y se pierden con ella.'
          : '¿Borrar esta auditoría? Todavía no tiene hallazgos.')) return;
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
    var caja = $('audDetalle'), lista = $('audVistaLista');
    // O se está mirando la lista, o se está DENTRO de una auditoría. Nunca las dos.
    if (!AUD) {
      caja.style.display = 'none'; $('audRev').style.display = 'none';
      if (lista) lista.style.display = '';
      return;
    }
    caja.style.display = ''; if (lista) lista.style.display = 'none';
    $('audDetTitulo').textContent = AUD.codigo + ' · ' + AUD.obra;
    $('audDetInfo').innerHTML = 'Audita <b>' + esc((AUD.auditor || '').split('@')[0]) + '</b> · alcance ' +
      esc(alcanceTxt(AUD)) + ' · muestra <b>' + AUD.n + '</b> de ' + AUD.total_rango +
      ' · revisados <b>' + AUD.revisados + '/' + AUD.n + '</b> · ' + kg0(AUD.kg) + ' kg' +
      ' · <span class="audest ' + esc(AUD.estado) + '">' + esc(ESTADO_TXT[AUD.estado] || AUD.estado) + '</span>' +
      ' · semilla <code>' + esc(AUD.semilla) + '</code>';
    var conflicto = (AUD.elementos || []).filter(function (e) { return e.conflicto; }).length;
    if (conflicto) $('audDetInfo').innerHTML += ' · <b style="color:#c62828">' + conflicto + ' elemento(s) cubicados por quien audita</b>';

    // EN aSa EL ELEMENTO VIVE DENTRO DE UN CÓDIGO DE CONTROL, y son dos cosas distintas:
    // el código con su descripción por un lado, el elemento por otro. Pegados con puntos
    // («SUP4 · INF · FUN C17») quedaba ilegible y encima repetía el eje. Van en columnas
    // propias, y sólo aparecen en las auditorías de aSa: en ArmaHub no hay código. El
    // elemento va ANTES que la descripción del código (6-oct, a pedido del usuario): es
    // lo que se revisa; la descripción es el contexto.
    var esAsa = AUD.origen === 'asa';
    var html = '<thead><tr>' +
      (esAsa ? '<th>Código</th>' : '') + '<th>Elemento</th>' + (esAsa ? '<th>Descripción del código</th>' : '') +
      '<th>Tipo</th><th>Piso</th><th>Ciclo</th><th>Eje</th>' +
      '<th class="num">Barras</th><th class="num">Kilos</th><th>Cubicó</th><th>Hallazgo</th><th>Acción</th></tr></thead><tbody>';
    (AUD.elementos || []).forEach(function (e) {
      var abierto = ELEM && ELEM.id === e.id;
      html += '<tr class="fila' + (abierto ? ' sel' : '') + '" data-id="' + e.id + '" title="Clic para revisar este elemento">' +
        (esAsa ? '<td class="cc"><b>' + esc(e.cc || '') + '</b></td>' : '') +
        // Lo que ancla la fila va en negrita: en aSa es el código, en ArmaHub el elemento.
        '<td title="' + esc(e.nombre) + '">' + (esAsa ? esc(e.nombre) : '<b>' + esc(e.nombre) + '</b>') + '</td>' +
        (esAsa ? '<td class="auddcc" title="' + esc(e.descr_cc || '') + '">' + esc(e.descr_cc || '') + '</td>' : '') +
        // En la fila ABIERTA de una auditoría de aSa la ubicación se escribe acá mismo.
        (esAsa && abierto ? celdasUbicacion(e)
          : '<td>' + esc(e.tipo || '') + '</td><td>' + esc(e.piso) + '</td><td>' + esc(e.ciclo) + '</td><td>' + esc(e.eje) + '</td>') +
        '<td class="num" title="' + (e.items || 0) + ' revisada(s)' + (e.items_malos ? ', ' + e.items_malos + ' no conforme(s)' : '') + '">' +
          (e.items ? '<b>' + e.items + '</b>/' : '') + e.barras + '</td>' +
        '<td class="num">' + kg0(e.kg) + '</td>' +
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
        if (ELEM && e && ELEM.id === e.id) return;   // ya está abierto: el clic es para escribir en sus campos
        abrirElemento(e);
      });
    });
    $('audDetElems').querySelectorAll('.audub').forEach(function (inp) {
      inp.addEventListener('click', function (ev) { ev.stopPropagation(); });
      inp.addEventListener('change', guardarUbicacion);
    });
    pintarAcciones();
    pintarCobertura();
    if (ELEM) {
      var vivo = (AUD.elementos || []).filter(function (x) { return x.id === ELEM.id; })[0];
      if (vivo) { ELEM = vivo; pintarRevision(); } else { ELEM = null; mostrarRevision(false); }
    }
  }

  // El panel de revisión se ve (o no), y con él la lista se comprime a un lado en las
  // pantallas anchas (ver .audcols.abierta en el HTML): la muestra a la izquierda, las
  // barras a la derecha, las dos a la vista.
  function mostrarRevision(visible) {
    $('audRev').style.display = visible ? '' : 'none';
    var cols = $('audCols');
    if (cols) cols.classList.toggle('abierta', !!visible);
  }

  // El elemento nombrado ENTERO, para cuando se lee fuera de la tabla —el título de la
  // revisión, la lista de acciones— y no hay una columna de código al lado.
  function nombreCompleto(e) {
    return (e.cc ? e.cc + ' · ' : '') + (e.nombre || '');
  }

  // Abrir un elemento: se traen sus barras y aparece el formulario de hallazgo.
  async function abrirElemento(e) {
    ELEM = e; pintarDetalle();
    $('audRev').style.display = '';
    $('audRevTitulo').textContent = nombreCompleto(e);
    $('audRevInfo').textContent = 'cargando…';
    $('audRevBarras').innerHTML = '';
    pintarRevision();
    try {
      // Las geometrías del catálogo (para dibujar) se piden a la vez que las barras: la
      // carga es una sola para toda la sesión y la hace el Bar Manager.
      var geos = global._bmCargarGeometrias ? global._bmCargarGeometrias() : null;
      // De dónde se piden las barras depende del origen: las de ArmaHub están en casa;
      // las de aSa se piden en vivo por código de control (1 a 11 segundos).
      // Las barras de aSa se piden por su REFERENCIA EN aSa (el ElementID), no por el
      // `eje`: ese el auditor lo puede corregir, y si se usara para consultar, corregirlo
      // dejaría el elemento sin barras.
      var ref = (e.ref_origen != null && e.ref_origen !== '') ? e.ref_origen : (e.eje || '');
      var d = AUD.origen === 'asa'
        ? await req('GET', '/auditorias/elemento-asa?cc=' + encodeURIComponent(e.cc || '') +
                           '&element=' + encodeURIComponent(ref) + '&elemento_id=' + e.id)
        : await req('GET', '/auditorias/elemento?id_proyecto=' + encodeURIComponent(AUD.id_proyecto) +
                           '&sector=' + encodeURIComponent(e.sector || '') + '&piso=' + encodeURIComponent(e.piso || '') +
                           '&ciclo=' + encodeURIComponent(e.ciclo || '') + '&eje=' + encodeURIComponent(e.eje || '') +
                           '&elemento_id=' + e.id);
      if (!d) return;
      $('audRevInfo').textContent = d.n + ' barras · ' + kg0(d.kg) + ' kg · ' +
        (AUD.origen === 'asa' ? ('CC ' + d.cc + ' · ' + (d.descr || '')) :
          ('plano ' + (d.planos.join(', ') || '—') + ' · cubicó ' +
           (d.cubicaron || []).map(function (x) { return x.split('@')[0]; }).join(', ')));
      // EL VEREDICTO ES POR BARRA. Lo ya guardado se repinta para poder corregirlo.
      BARRAS = d.barras || [];
      VERED = {};
      Object.keys(d.revisados || {}).forEach(function (ref) {
        VERED[ref] = { conforme: d.revisados[ref].conforme, observacion: d.revisados[ref].observacion || '' };
      });
      if (geos) await geos;
      pintarBarras();
    } catch (err) { $('audRevInfo').textContent = err.message; }
  }

  // LA TABLA DE BARRAS, con su veredicto: la misma grilla del Bar Manager —φ, figura, el
  // dibujo, un lado por columna (A…I), los ángulos (α) y el radio— porque el auditor
  // compara contra el plano, y en el plano las medidas van en columnas, no en una frase.
  // Las medidas van en cm, como en toda la plataforma (aSa las manda en mm). Conforme /
  // No conforme por barra; el campo de observación aparece sólo cuando se marca no
  // conforme: así no se pide escribir trece veces «ok».
  function pintarBarras() {
    var filas = BARRAS.map(function (b) { return normalizarBarra(b, AUD.origen); });
    var letras = letrasUsadas(filas);
    var nAng = filas.reduce(function (m, f) { return Math.max(m, f.angulos.length); }, 0);
    var conRadio = filas.some(function (f) { return f.radio > 0; });
    var nCols = 9 + letras.length + nAng + (conRadio ? 1 : 0);
    var html = '<thead><tr><th style="width:92px">Veredicto</th><th>Marca</th><th class="num">φ</th>' +
      '<th>Figura</th><th>Render</th>' +
      letras.map(function (L) { return '<th class="num g">' + esc(L) + '</th>'; }).join('') +
      rango(nAng).map(function (i) { return '<th class="num g">α' + (i + 1) + '</th>'; }).join('') +
      (conRadio ? '<th class="num g">R</th>' : '') +
      '<th class="num">Largo</th><th class="num">Cant</th><th class="num">Peso</th>' +
      '<th>' + (AUD.origen === 'asa' ? 'Elemento / nota' : 'Plano') + '</th></tr></thead><tbody>';
    BARRAS.forEach(function (b, i) {
      var f = filas[i], v = VERED[b.ref];
      var clase = v ? (v.conforme ? ' class="bueno"' : ' class="malo"') : '';
      html += '<tr' + clase + ' data-ref="' + esc(b.ref) + '">' +
        '<td><span class="audvb">' +
          '<button class="si' + (v && v.conforme ? ' on' : '') + '" data-v="1" data-ref="' + esc(b.ref) + '" title="Conforme">OK</button>' +
          '<button class="no' + (v && v.conforme === false ? ' on' : '') + '" data-v="0" data-ref="' + esc(b.ref) + '" title="No conforme">NC</button>' +
        '</span></td>' +
        '<td class="cc" title="' + esc(b.ref) + '">' + esc(b.marca || '') + '</td>' +
        '<td class="num">' + num(f.diam) + '</td>' +
        '<td class="cc">' + esc(b.figura || '') + '</td>' +
        '<td class="audfigcel">' + celdaFigura(f) + '</td>' +
        letras.map(function (L) { return '<td class="num g">' + num(f.dims[L]) + '</td>'; }).join('') +
        rango(nAng).map(function (k) { return '<td class="num g">' + num(f.angulos[k]) + '</td>'; }).join('') +
        (conRadio ? '<td class="num g">' + num(f.radio, 1) + '</td>' : '') +
        '<td class="num">' + num(f.largo) + '</td>' +
        '<td class="num">' + (b.cant_total != null ? b.cant_total : (b.cant || '')) + '</td>' +
        '<td class="num">' + kg0(b.peso_total) + '</td>' +
        '<td title="' + esc((b.plano || '') + (b.nota ? ' · ' + b.nota : '')) + '">' +
          esc(b.plano || '') + (b.nota ? ' <span class="muted">· ' + esc(b.nota) + '</span>' : '') + '</td></tr>';
      if (v && v.conforme === false) {
        html += '<tr class="malo"><td></td><td colspan="' + (nCols - 1) + '">' +
          '<input type="text" class="audobs" data-obs="' + esc(b.ref) + '" placeholder="Qué tiene esta barra (obligatorio)" value="' +
          esc(v.observacion || '') + '"></td></tr>';
      }
    });
    $('audRevBarras').innerHTML = html + '</tbody>';
    $('audRevBarras').querySelectorAll('button[data-v]').forEach(function (b) {
      b.addEventListener('click', function () {
        var ref = b.dataset.ref, si = b.dataset.v === '1';
        if (VERED[ref] && VERED[ref].conforme === si) delete VERED[ref];   // volver a tocarlo lo suelta
        else VERED[ref] = { conforme: si, observacion: (VERED[ref] || {}).observacion || '' };
        pintarBarras(); pintarRevision();
      });
    });
    $('audRevBarras').querySelectorAll('input[data-obs]').forEach(function (i) {
      i.addEventListener('input', function () {
        if (VERED[i.dataset.obs]) VERED[i.dataset.obs].observacion = i.value;
      });
    });
    pintarRevision();
  }

  function rango(n) { var r = []; for (var i = 0; i < n; i++) r.push(i); return r; }
  // Un número para la grilla: vacío si no hay dato (igual que el Bar Manager).
  function num(v, dec) {
    if (v == null || v === '' || isNaN(v)) return '';
    return dec ? Number(v).toFixed(dec) : String(Math.round(Number(v)));
  }
  // Las letras de lado que usa alguna barra del elemento, en orden: son las columnas.
  function letrasUsadas(filas) {
    var vistas = {};
    filas.forEach(function (f) { Object.keys(f.dims).forEach(function (L) { vistas[L] = true; }); });
    return Object.keys(vistas).sort();
  }

  // UNA BARRA DE CUALQUIERA DE LAS DOS FUENTES, en lo que entienden la grilla y el renderer
  // del Bar Manager: {figura, diam (mm), dims {A: cm}, dim_a… (cm), angulos, radio, largo (cm)}.
  // aSa manda mm y el φ como texto («10mm»); ArmaHub ya viene en cm, con las letras en
  // minúscula. El radio de aSa es el diámetro del mandril, otra cosa que el R del Bar
  // Manager: no se mezclan.
  function normalizarBarra(b, origen) {
    var k = origen === 'asa' ? 0.1 : 1;
    var f = { figura: b.figura, diam: parseFloat(b.diam), dims: {}, eje: b.eje || null,
              angulos: (b.angulos || []).map(Number).filter(function (x) { return !isNaN(x); }),
              radio: origen === 'asa' ? 0 : (Number(b.radio) || 0),
              largo: (b.largo != null && b.largo !== '') ? Number(b.largo) * k : null };
    Object.keys(b.dims || {}).forEach(function (key) {
      var v = Number(b.dims[key]);
      if (!(v > 0)) return;
      var L = String(key).toUpperCase();
      f.dims[L] = v * k;
      f['dim_' + L.toLowerCase()] = v * k;
    });
    return f;
  }

  // EL DIBUJO DE LA BARRA: el MISMO motor que el editor de despieces y el Bar Manager.
  // La figura del catálogo —el código de aSa (ShpNameID) es el mismo código del catálogo
  // de la plataforma— escalada a las medidas reales de ESTA barra y con el trazo según su
  // φ, al tamaño M del Bar Manager. Así el auditor ve la barra igual que en el resto de la
  // plataforma, y no una miniatura con otro formato.
  //   · Si el código no está en el catálogo (figuras nativas de aSa: T12, 104E1…), se
  //     dibuja con el mismo motor el eje que el backend reconstruye de aSa, rotulado con
  //     sus lados. Si la envolvente no cuadra con la que aSa declara, se dibuja igual y
  //     queda un aviso al lado con el porqué: el auditor decide, no se le esconde nada.
  //   · Si tampoco hay eje, un guion.
  var FIG_TAM = 'm';

  function celdaFigura(f) {
    var svg = global._bmFiguraSvg ? global._bmFiguraSvg(f, FIG_TAM) : '';
    if (svg) return svg;
    svg = svgEje(f);
    if (!svg) return '<span class="muted">—</span>';
    return svg + (f.eje.ok ? '' :
      '<span class="audfigav" title="' + esc(f.eje.motivo || 'La envolvente no cuadra con la que declara aSa') + '">⚠</span>');
  }

  // El eje reconstruido de aSa (puntos en mm, Y hacia arriba como en el motor), dibujado
  // con el motor y con un rótulo por tramo: la medida del lado en cm, como en el Bar
  // Manager. Si hay un arco, sus puntitos no son lados y va sin rótulos.
  function svgEje(f) {
    var eje = f.eje, M = global.disenadorMotor;
    if (!eje || !(eje.puntos || []).length || !M || !M.svgDesdePuntos || !global._bmTam) return '';
    var t = global._bmTam(FIG_TAM);
    var pts = eje.puntos.map(function (p) { return { x: p[0] / 10, y: p[1] / 10 }; });
    var lados = eje.lados || [];
    var rectos = lados.length === pts.length - 1 && !lados.some(function (l) { return l.arco; });
    var labels = rectos ? lados.map(function (l) { return String(Math.round(l.largo / 10)); }) : [];
    try {
      return M.svgDesdePuntos(pts, { width: t.w, height: t.h, pad: 20, labels: labels,
                                     labels_auto: rectos, angulos: rectos, diam_mm: f.diam, metrico: true });
    } catch (e) { return ''; }
  }

  function esAdmin() {
    return ['admin', 'admin_calidad'].indexOf(global.currentRole) !== -1;
  }

  function cuentaBarras() {
    var refs = Object.keys(VERED);
    var malas = refs.filter(function (r) { return VERED[r].conforme === false; }).length;
    return { revisadas: refs.length, malas: malas, total: BARRAS.length };
  }

  // DÓNDE ESTÁ EL ELEMENTO, escrito en su propia fila. Sólo en las auditorías de aSa: allá
  // el tipo, el piso y el ciclo no existen en ningún campo —lo único que hay es el
  // ElementID, que en muros ES el eje— y sacarlos del texto del código sería adivinar, así
  // que los escribe quien tiene el plano delante, en la fila del elemento que está
  // revisando, y se guardan al salir del campo. Antes iban en una barra aparte sobre la
  // grilla de barras; el usuario la vio fuera de lugar (6-oct): son datos del elemento,
  // van en su fila. En ArmaHub salen de la cubicación —son la clave del elemento— y no se
  // editan acá; si están mal se arreglan allá.
  function celdasUbicacion(e) {
    var tit = e.ubicado_el
      ? 'Escrita por ' + (e.ubicado_por || '').split('@')[0]
      : 'aSa no trae tipo, piso ni ciclo: los pones tú. Se guarda al salir del campo.';
    var opciones = '<option value="">tipo…</option>' + Object.keys(BASE.sectores || {}).map(function (k) {
      return '<option value="' + esc(k) + '"' + (e.sector === k ? ' selected' : '') + '>' + esc(BASE.sectores[k]) + '</option>';
    }).join('');
    function campo(nombre, valor) {
      return '<td class="audubcel"><input type="text" class="audub" data-campo="' + nombre + '" value="' + esc(valor || '') +
             '" placeholder="' + nombre + '" maxlength="40" title="' + esc(tit) + '"></td>';
    }
    return '<td class="audubcel"><select class="audub" data-campo="sector" title="' + esc(tit) + '">' + opciones + '</select></td>' +
           campo('piso', e.piso) + campo('ciclo', e.ciclo) + campo('eje', e.eje);
  }

  async function guardarUbicacion() {
    if (!AUD || !ELEM) return;
    var cuerpo = {};
    $('audDetElems').querySelectorAll('.audub').forEach(function (inp) { cuerpo[inp.dataset.campo] = inp.value; });
    try {
      AUD = await req('PUT', '/auditorias/' + AUD.id + '/elementos/' + ELEM.id + '/ubicacion', cuerpo);
      // No se repinta la lista: el auditor puede estar pasando al campo de al lado y un
      // repintado le quitaría el foco. Se actualiza lo que cambia de nombre.
      var vivo = (AUD.elementos || []).filter(function (x) { return x.id === ELEM.id; })[0];
      if (vivo) { ELEM = vivo; $('audRevTitulo').textContent = nombreCompleto(ELEM); }
      ok('Ubicación guardada');
    } catch (e) { aviso(e.message); }
  }

  // La SEVERIDAD es del elemento y sólo se pregunta si hay alguna barra no conforme.
  function pintarRevision() {
    mostrarRevision(!!ELEM);
    if (!ELEM) return;
    var c = cuentaBarras();
    $('audRevCuenta').innerHTML = c.revisadas + ' de ' + c.total + ' barras revisadas' +
      (c.malas ? ' · <b style="color:#c62828">' + c.malas + ' no conforme(s)</b>' : '');
    // Sin barras malas no hay severidad que elegir: el elemento es conforme y punto.
    $('audRevSev').style.display = c.malas ? 'flex' : 'none';
    if (c.malas) {
      var sel = (ELEM.hallazgo && ELEM.hallazgo !== 'conforme') ? ELEM.hallazgo : 'nc_menor';
      var previos = $('audRevChips').querySelector('button.on');
      if (previos) sel = previos.dataset.h;
      $('audRevChips').innerHTML = ['observacion', 'nc_menor', 'nc_mayor'].map(function (k) {
        return '<button data-h="' + k + '" class="hz ' + k + (sel === k ? ' on' : '') + '">' + HALLAZGO_TXT[k] + '</button>';
      }).join('');
      $('audRevChips').querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          $('audRevChips').querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
        });
      });
      var sc = $('audRevCausa');
      if (!sc.options.length) {
        sc.innerHTML = '<option value="">causa (Ishikawa Cubicaciones, opcional)</option>' + (BASE.causas || []).map(function (x) {
          return '<option value="' + esc(x.codigo) + '">' + esc(x.codigo) + ' · ' + esc(x.categoria_nombre) + ' · ' + esc(x.descripcion) + '</option>';
        }).join('');
        sc.value = ELEM.causa || '';
      }
    }
    if ($('audRevTexto').value === '' && ELEM.texto) $('audRevTexto').value = ELEM.texto;
    $('audRevMsg').textContent = ELEM.revisado_el
      ? 'Registrado ' + ddmm(ELEM.revisado_el) + (ELEM.revisado_por ? ' por ' + ELEM.revisado_por.split('@')[0] : '')
      : '';
  }

  async function guardarHallazgo() {
    if (!AUD || !ELEM) return;
    var c = cuentaBarras();
    if (!c.revisadas) { $('audRevMsg').textContent = 'Marca al menos una barra como conforme o no conforme.'; return; }
    var faltan = Object.keys(VERED).filter(function (r) {
      return VERED[r].conforme === false && !(VERED[r].observacion || '').trim();
    });
    if (faltan.length) { $('audRevMsg').textContent = 'Di qué tienen las barras ' + faltan.join(', ') + '.'; return; }
    var on = $('audRevChips').querySelector('button.on');
    var items = Object.keys(VERED).map(function (r) {
      var b = BARRAS.filter(function (x) { return x.ref === r; })[0] || {};
      return { ref: r, marca: b.marca || null, conforme: VERED[r].conforme, observacion: VERED[r].observacion };
    });
    $('audRevGuardar').disabled = true;
    try {
      AUD = await req('PUT', '/auditorias/' + AUD.id + '/elementos/' + ELEM.id + '/revision', {
        items: items, hallazgo: (c.malas && on) ? on.dataset.h : null,
        texto: $('audRevTexto').value, causa: c.malas ? $('audRevCausa').value : null });
      ok('Revisión guardada');
      await cargarLista();
      await cargarIndicadores();
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
        return '<tr><td title="' + esc(nombreCompleto(e)) + '">' + esc(nombreCompleto(e)) + '</td>' +
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

  // CUÁNTO DE LA OBRA SE HA MIRADO, contando TODAS sus auditorías. Un cuadrito por
  // elemento (o por código, en aSa): gris lo no auditado, color según cómo salió. Es la
  // respuesta a «qué falta», que una auditoría suelta no da.
  function pintarCobertura() {
    var caja = $('audCobertura'), c = AUD && AUD.cobertura;
    if (!c || !c.total) { caja.style.display = 'none'; return; }
    caja.style.display = '';
    var falta = c.total - c.auditados;
    // DOS DENOMINADORES: contra lo auditable (lo exigible) y contra el total de la obra.
    // Medir sólo contra el total castiga por lo despachado, que ya no se puede auditar.
    var noAud = c.total - c.auditable;
    caja.innerHTML = '<div class="audh">Cobertura de la obra <span class="muted">' +
        esc(AUD.obra) + ' · todas sus auditorías</span></div>' +
      '<div class="audkpis">' +
        caj(c.pct + '%', 'de lo auditable · ' + c.auditados + ' de ' + c.auditable,
            c.pct >= 20 ? 'bien' : '') +
        caj(c.pct_total + '%', 'del total de la obra (' + c.total + ')') +
        caj(c.pct_kg + '%', 'de los kilos auditables') +
        caj(falta, 'sin mirar' + (noAud ? ' · ' + noAud + ' ya despachados' : '')) +
      '</div>' +
      '<div class="audcobbar" title="' + c.pct + '% de lo auditable"><i style="width:' + c.pct + '%"></i></div>' +
      '<div class="audgrid">' + c.filas.map(function (f) {
        // Tres estados, no dos: sin mirar · con algo auditado · no auditable (despachado).
        var cl = !f.auditable ? 'fuera'
               : (f.auditados ? ((f.hallazgos || [])[0] || 'pendiente') : '');
        return '<span class="' + esc(cl) + '" title="' + esc(f.nombre) +
               (f.auditados ? ' · ' + f.auditados + ' elemento(s) auditado(s) en ' + (f.auditorias || []).join(', ')
                            : (f.auditable ? ' · sin auditar' : ' · despachado, ya no se audita')) + '"></span>';
      }).join('') + '</div>' +
      '<div class="audleyc">' +
        '<span><i class="g"></i>sin auditar</span><span><i class="a"></i>auditado</span>' +
        '<span><i class="r"></i>con no conformidad</span><span><i class="f"></i>despachado</span>' +
        (c.origen === 'asa' ? '<span class="muted">· en aSa la unidad es el código: auditar un elemento no agota el código</span>' : '') +
      '</div>';
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
  global.__auditoriasTest = { marcar: marcar, HALLAZGO_TXT: HALLAZGO_TXT, ACCION_TXT: ACCION_TXT,
                              normalizarBarra: normalizarBarra, letrasUsadas: letrasUsadas,
                              celdaFigura: celdaFigura, FIG_TAM: FIG_TAM };

})(window);
