// AUDITORÍAS DE CUBICACIÓN (1-oct). Ver tabs/auditorias.html y auditorias.py.
//
// Tres pantallas en una:
//   1. CREAR: obra, quién audita, alcance (tipo · pisos · ciclos) y cuántos elementos.
//      Las fechas las pone el sistema. Al crear, el servidor sortea la muestra y la
//      GUARDA: de ahí en adelante se audita contra esa lista, que ya no cambia.
//   2. REVISAR: la muestra, y al abrir un elemento sus barras enteras. Por elemento, un
//      hallazgo en los cuatro niveles de la ISO, con qué se encontró y la causa.
//   3. ACCIONES: cada hallazgo le queda al que cubicó. Él la marca corregida —en
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
      // El detalle puede ser un objeto (el 409 del cierre trae {motivo, mensaje, barras}):
      // el mensaje legible va en `message` y el objeto entero viaja en `detalle`, con el
      // status, para que quien llama pueda decidir qué hacer con él.
      var err = new Error((det && (det.mensaje || det.msg || (typeof det === 'string' ? det : null)))
                          || ('Error ' + res.status));
      err.status = res.status;
      err.detalle = det;
      throw err;
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

  var COLOR = { conforme: '#8BC34A', observacion: '#ffb74d', hallazgo: '#c62828' };
  // Lo que el auditor declara: un hecho, no una graduación. La gravedad la calcula el
  // backend mirando si el código ya se había despachado (ver `gravedad_de`).
  var HALLAZGO_TXT = { conforme: 'Conforme', observacion: 'Observación', hallazgo: 'Hallazgo' };
  // CUATRO ESTADOS. «Enviada» es el que faltaba y es el que importa: entre terminar de
  // mirar y resolver estaba el acto de mandarla, que antes no existía.
  var ESTADO_TXT = { planificada: 'Planificada', en_curso: 'En curso',
                     enviada: 'Enviada', cerrada: 'Cerrada' };
  // Los cuatro pasos como los ve el auditor, en orden, con lo que significa cada uno.
  var PASOS = [
    { k: 'planificada', t: 'Creada' },
    { k: 'en_curso', t: 'Revisando' },
    { k: 'enviada', t: 'Enviada' },
    { k: 'cerrada', t: 'Cerrada' }
  ];
  // TODO LO RESUELTO DICE «RESUELTO» (20-oct). Antes se distinguía «corregida» (lo dijo el
  // auditado) de «verificada» (lo comprobó el sistema); el usuario unificó: «cambiemos
  // todo a resuelto, al final los usuarios no han validado nada aún». La comprobación
  // contra aSa sigue existiendo, pero corre al cerrar y queda en el registro, no en el
  // nombre del estado.
  var ACCION_TXT = { pendiente: 'Pendiente', corregida: 'Resuelto', verificada: 'Resuelto',
                     desestimada: 'No aplica' };

  var BASE = null, UNIV = null;
  // La obra se elige con su ORIGEN pegado ('armahub|PROY-x' o 'asa|2010136'): una misma
  // pantalla sirve para las dos fuentes y no hay un segundo selector que mantener.
  // EL ORIGEN ES aSa, SIEMPRE (15-oct). Hasta hoy acá se elegía entre ArmaHub y aSa, y
  // el usuario lo cerró: «debe ser siempre aSa, eliminemos la opción de ArmaHub para
  // evitar enredos». Lo que se audita es lo que va a fabricación, y eso vive en aSa. La
  // constante se queda con el nombre de antes porque la lee el resto del archivo —el
  // detalle de una auditoría vieja de ArmaHub, si la hubiera, sigue pintando su alcance—.
  var ORIGEN = 'asa', OBRA = '', AUDITOR = '';
  var SECT = [], PISOS = [], CICLOS = [];              // alcance de ArmaHub
  // Alcance de aSa. El piso y el ciclo se reconocen del TEXTO del código: allá no
  // son campos. Se ofrecen los que se reconocen en esa obra (55-77% según la obra).
  // Alcance de aSa: los CÓDIGOS elegidos. Allá no hay piso ni ciclo —se intentó
  // reconocerlos del texto del código y era adivinar—, así que se eligen a mano.
  var CCS = [], CC_LISTA = [], CC_BUSCA = '';
  // Las barras que le toca corregir a quien está mirando. Se guardan para que el botón
  // sepa de cuál habla sin volver a pedirlas.
  var MIS = [];
  // La respuesta entera (con los contadores) y qué barra está abierta para resolver. El
  // panel se repinta desde acá sin volver a pedir la lista.
  var MIAS = null, RESOLVIENDO = null;
  // El estado del código en aSa que significa «ya salió a la obra». Es el único que cambia
  // qué conviene hacer con el código, así que es el único que la pantalla trata distinto.
  var ESTADO_DESPACHADO = 'Shipped';
  var LISTA = [], ABIERTA = null, AUD = null, ELEM = null, CB_OBRA = null;
  // El veredicto de cada barra del elemento abierto: {ref: {conforme, observacion}}.
  // Vive acá mientras se revisa y se guarda todo junto.
  var BARRAS = [], VERED = {};

  // Las obras que se pueden auditar: los jobs de aSa, con su código y su tamaño. Una
  // entrada por job, que es la identidad de la obra en producción: los frentes que
  // ArmaHub tenga de esa obra son cosa de la cubicación y acá no aparecen.
  function obrasParaElegir() {
    if (!BASE) return [];
    return (BASE.obras_asa || []).map(function (o) {
      return { id: 'asa|' + o.job, label: o.obra, origen: 'asa', clave: o.job,
               sub: 'job ' + o.job + ' · ' + o.cc + ' códigos · ' + kg0(o.kg) + ' kg' };
    });
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

  // ELEGIR POR ESTADO Y NO CÓDIGO POR CÓDIGO (8-oct). Una obra trae cuarenta y cinco
  // códigos y lo que se revisa casi siempre es lo mismo: lo que todavía no salió. Marcar
  // eso a mano, uno por uno, es trabajo que la pantalla puede hacer sola.
  //
  // EL CHIP ELIGE, NO FILTRA (corregido el 8-oct). Primero los puse a filtrar, dejando que
  // el check «todos» fuera el único que elegía. El usuario lo probó y el flujo le quedó
  // raro, con razón: en una barra de selección, apretar «Open 40» tiene que marcar esos
  // cuarenta, no esconder los demás. Filtrar ya lo hace el buscador de al lado, que es
  // donde uno lo busca.
  //
  // El chip está ENCENDIDO cuando TODOS los códigos de ese estado están marcados, y el
  // clic alterna entre marcarlos todos y desmarcarlos todos. Así el color dice la verdad
  // en vez de guardar un estado propio que se desincroniza con lo que hay marcado.
  function estadosDisponibles() {
    var vistos = [];
    CC_LISTA.forEach(function (c) {
      if (vistos.indexOf(c.estado || '') === -1) vistos.push(c.estado || '');
    });
    return vistos.sort();
  }

  function deEstado(e) {
    return CC_LISTA.filter(function (c) { return (c.estado || '') === e; });
  }

  function pintarCcEstados() {
    var el = $('audCcEstados');
    if (!el) return;
    var ests = estadosDisponibles();
    if (ests.length < 2) { el.innerHTML = ''; return; }
    el.innerHTML = ests.map(function (e) {
      var ccs = deEstado(e);
      var marcados = ccs.filter(function (c) { return CCS.indexOf(c.cc) !== -1; }).length;
      // Tres estados visibles, porque son tres cosas distintas: ninguno marcado, algunos,
      // o todos. Con dos colores, «algunos» se veía igual que «ninguno».
      var clase = marcados === 0 ? '' : (marcados === ccs.length ? ' on' : ' algunos');
      return '<button type="button" data-e="' + esc(e) + '" class="audcce' + clase +
             (e === ESTADO_DESPACHADO ? ' desp' : '') +
             '" title="Marca o desmarca los ' + ccs.length + ' códigos ' + esc(e) + '.">' +
             esc(e || 'sin estado') + ' <i>' +
             (marcados && marcados < ccs.length ? marcados + '/' + ccs.length : ccs.length) +
             '</i></button>';
    }).join('');
    el.querySelectorAll('button[data-e]').forEach(function (b) {
      b.addEventListener('click', function () {
        var ccs = deEstado(b.dataset.e);
        var todos = ccs.every(function (c) { return CCS.indexOf(c.cc) !== -1; });
        ccs.forEach(function (c) {
          var i = CCS.indexOf(c.cc);
          if (todos && i !== -1) CCS.splice(i, 1);
          else if (!todos && i === -1) CCS.push(c.cc);
        });
        pintarCC(); pintarEstado();
      });
    });
  }

  function pintarCC() {
    var vis = ccVisibles();
    pintarCcEstados();
    var kg = CC_LISTA.filter(function (c) { return CCS.indexOf(c.cc) !== -1; })
                     .reduce(function (a, c) { return a + c.kg; }, 0);
    $('audCcN').innerHTML = CCS.length
      ? '<b style="color:#1565C0">' + CCS.length + ' elegidos</b> · ' + kg0(kg) + ' kg · ' + vis.length + ' a la vista'
      : vis.length + ' de ' + CC_LISTA.length + ' códigos' +
        ((UNIV && UNIV.despachados) ? ' · ' + UNIV.despachados + ' ya despachados (se pueden elegir igual)' : '') +
        ((UNIV && UNIV.con_auditoria) ? ' · ' + UNIV.con_auditoria + ' ya tienen elementos auditados' : '');
    if (!vis.length) {
      $('audCcLista').innerHTML = '<div class="audvacio">' +
        (CC_LISTA.length ? 'Ningún código coincide con el filtro.'
                         : 'Esta obra no tiene códigos en el espejo de aSa.') + '</div>';
      return;
    }
    $('audCcLista').innerHTML = vis.map(function (c) {
      var on = CCS.indexOf(c.cc) !== -1;
      // El estado va PEGADO al código: es lo que se mira junto, no al final de la línea.
      // LA FECHA ES LA DEL PEDIDO, PARA TODOS. Es la que ordena la lista, del más nuevo
      // al más antiguo, así que bajando se va hacia atrás en el tiempo y el usuario corta
      // donde quiera. Antes los despachados mostraban su fecha de DESPACHO, que es
      // posterior, y por eso subían a la cabeza de la lista siendo lo más viejo que hay.
      // La fecha de despacho sigue estando: va en el título, y es la que decide si el
      // código se pinta por haber salido hace más de un mes.
      var tit = esc(c.descr) +
        (c.dias == null ? '' : ' · pedido hace ' + c.dias + ' días') +
        (c.despachado
          ? ' · despachado' + (c.despacho ? ' el ' + ddmm(c.despacho) : '') +
            (c.dias_despacho == null ? '' : ', hace ' + c.dias_despacho + ' días')
          : '') +
        (c.auditados ? ' · ' + c.auditados + ' elemento(s) ya auditados' : '');
      return '<label class="audcc' + (on ? ' on' : '') + (c.antiguo ? ' viejo' : '') +
        '" title="' + tit + '">' +
        '<input type="checkbox" data-cc="' + esc(c.cc) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="cod">' + esc(c.cc) + '</span>' +
        '<span class="e' + (c.despachado ? ' desp' : '') + '">' + esc(c.estado) + '</span>' +
        '<span class="f">' + ddmm(c.fecha) + '</span>' +
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
    OBRA = item ? item.clave : '';
    SECT = []; PISOS = []; CICLOS = []; CCS = []; CC_LISTA = []; CC_BUSCA = '';
    $('audCcBusca').value = ''; UNIV = null;
    if (OBRA) {
      try {
        UNIV = await req('GET', '/auditorias/cc?job=' + encodeURIComponent(OBRA));
        // LOS DESPACHADOS SIGUEN APARECIENDO, abajo de todo y sin marcar: lo normal es
        // revisar lo que todavía se puede atajar, pero esconderlos le quitaría al usuario
        // una decisión que es suya. El chip queda a la vista con su cuenta, a un clic.
        CC_LISTA = (UNIV && UNIV.ccs) || [];
      } catch (e) { aviso(e.message); }
    }
    pintarAlcance(); pintarEstado();
  }

  var _bound = false;
  // LA AUDITORÍA DEL ENLACE. El correo trae un botón con `#...&aud=<id>`: se abre ésa y
  // no la lista, que es lo que uno espera al pulsar «Abrir la auditoría». Se consume una
  // sola vez —si no, volver a la lista y recargar reabriría siempre la misma— y se saca
  // del hash para que el F5 siguiente respete dónde quedó el usuario.
  function auditoriaDelEnlace() {
    var m = /(?:^|[#&])aud=(\d+)/.exec(global.location ? global.location.hash || '' : '');
    if (!m) return null;
    try {
      var limpio = global.location.hash.replace(/(^|&)aud=\d+/, '').replace(/^#&/, '#');
      if (global.history && global.history.replaceState) global.history.replaceState(null, '', limpio || '#');
    } catch (e) {}
    return Number(m[1]);
  }

  // EL FORMULARIO DE CREAR NO ARRASTRA LO DE LA VEZ ANTERIOR (15-oct). El estado —origen,
  // obra elegida, su universo, los códigos marcados— vive en variables del módulo y se
  // quedaba de una visita a la otra: el usuario volvió desde los dashboards y el
  // selector seguía en «aSa» con la obra de la vez pasada, así que la obra de ArmaHub que
  // buscaba no aparecía. «Me dejaste un filtro pegado». Sólo se conserva si el formulario
  // está ABIERTO, que es la única señal de que alguien lo estaba llenando.
  function _formEnBlanco() {
    OBRA = ''; UNIV = null;
    SECT = []; PISOS = []; CICLOS = []; CCS = []; CC_LISTA = []; CC_BUSCA = '';
    if (CB_OBRA) CB_OBRA.limpiar();
    var b = $('audCcBusca');
    if (b) b.value = '';
  }

  global.loadAuditorias = async function () {
    if (!$('tab-auditorias')) return;
    try {
      BASE = await req('GET', '/auditorias/obras');
      if (!BASE) return;
      if (!_bound) { _bound = true; bind(); }
      if ($('audForm').style.display === 'none') _formEnBlanco();
      pintarForm();
      // EN PARALELO (21-oct). Eran cuatro viajes en fila —obras, lista, mis acciones,
      // indicadores— de uno a tres segundos cada uno: siete segundos mirando una pantalla
      // vacía. Las obras van primero porque la lista las necesita para nombrar el alcance;
      // las otras tres no se necesitan entre sí.
      await Promise.all([cargarLista(), cargarMisAcciones(), cargarIndicadores()]);
      var delEnlace = auditoriaDelEnlace();
      if (delEnlace) await abrir(delEnlace);
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
      var t = k.total, nc = (t.hallazgo || 0);
      $('audKpiN').textContent = '· ' + k.cerradas + ' cerradas';
      // LOS SEIS QUE PIDIÓ EL USUARIO (20-oct), y fuera el % de conformidad: «no se entiende
      // sobre qué se están tomando los porcentajes». El único porcentaje que queda es el de
      // hallazgos sobre lo auditado —«5 de 30»—, que tiene un denominador que se lee.
      $('audKpiCajas').innerHTML =
        caj(k.auditorias || 0, 'auditorías') +
        caj(nc, 'hallazgos', nc ? 'mal' : 'bien') +
        caj(k.obras_auditadas || 0, 'obras auditadas') +
        caj(k.cubicadores_auditados || 0, 'cubicadores auditados') +
        caj(k.acciones.pendiente || 0, 'acciones sin corregir',
            (k.acciones.pendiente || 0) ? 'mal' : 'bien') +
        caj(t.pct_hallazgos == null ? '—' : t.pct_hallazgos + '%',
            'de hallazgos sobre ' + (t.revisados || 0) + ' elementos auditados',
            t.pct_hallazgos == null ? '' : (t.pct_hallazgos > 30 ? 'mal' : (t.pct_hallazgos <= 10 ? 'bien' : '')));
      $('audKpiCub').innerHTML = tabla(k.por_cubicador, 'cubicador', function (x) {
        return esc((x.cubicador || '').split('@')[0]); });
      $('audKpiCausa').innerHTML = k.causas.length
        ? '<thead><tr><th>Causa</th><th class="num" title="Barras no conformes con esa causa. ' +
          'La clasifica quien respondió, barra por barra.">Barras</th><th></th></tr></thead><tbody>' +
          k.causas.map(function (c) {
            var tope = k.causas[0].n || 1;
            return '<tr><td title="' + esc(c.causa) + '">' + esc(c.causa) + '</td>' +
              '<td class="num">' + c.n + '</td>' +
              '<td><div class="audbar"><i style="width:' + (c.n / tope * 100).toFixed(0) +
              '%; background:#ef9a9a"></i></div></td></tr>';
          }).join('') + '</tbody>'
        : '<tbody><tr><td class="audvacio">Sin hallazgos todavía.</td></tr></tbody>';
    } catch (e) { caja.style.display = 'none'; }
  }

  function caj(valor, texto, clase) {
    return '<div class="audkpi ' + (clase || '') + '"><b>' + valor + '</b><span>' + texto + '</span></div>';
  }

  function tabla(filas, clave, etiqueta) {
    if (!filas || !filas.length) return '<tbody><tr><td class="audvacio">Sin datos.</td></tr></tbody>';
    // Fuera la conformidad también acá (20-oct): la columna es cuántos hallazgos sobre
    // cuántos elementos auditados, y la barra lo dibuja.
    var tope = Math.max.apply(null, filas.map(function (x) { return x.nc || 0; }).concat([1]));
    return '<thead><tr><th>' + (clave === 'cubicador' ? 'Cubicó' : 'Obra') +
      '</th><th class="num" title="Elementos auditados">Auditados</th>' +
      '<th class="num" title="Elementos con hallazgo">Hallazgos</th><th></th></tr></thead><tbody>' +
      filas.map(function (x) {
        return '<tr><td>' + etiqueta(x) + '</td><td class="num">' + x.revisados + '</td>' +
          '<td class="num"' + (x.nc ? ' style="color:#c62828;font-weight:700"' : '') + '>' + x.nc + '</td>' +
          '<td><div class="audbar"><i style="width:' + ((x.nc || 0) / tope * 100).toFixed(0) +
          '%; background:#ef9a9a"></i></div></td></tr>';
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
    // El alcance de una auditoría son los códigos de control de la obra, que es lo único
    // que aSa tiene. La caja de tipo/piso/ciclo era de ArmaHub y ya no existe.
    var cajaAsa = $('audAlcanceAsa');
    if (!UNIV) {
      cajaAsa.style.display = 'none';
      $('audObraInfo').textContent = (BASE.obras_asa || []).length + ' obras en aSa';
      return;
    }
    cajaAsa.style.display = '';
    pintarCC();
  }

  function pintarEstado() {
    var n = parseInt($('audN').value, 10) || 0;
    var listo = !!(OBRA && AUDITOR && n > 0 && UNIV);
    $('audCrear').disabled = !listo;
    // Sin códigos marcados no hay de dónde sacar la muestra.
    listo = listo && CCS.length > 0;
    $('audCrear').disabled = !listo;
    $('audNInfo').textContent = UNIV ? ('máx ' + UNIV.maximo) : '';
    if (!OBRA || !AUDITOR) $('audCrearMsg').textContent = 'Elige obra y quién audita.';
    else if (!CCS.length) $('audCrearMsg').textContent = 'Marca los códigos de control de los que quieres sacar la muestra.';
    else if (n > (UNIV.maximo || 20)) $('audCrearMsg').textContent = 'En aSa el máximo es ' + UNIV.maximo + ': cada código se le pide a aSa.';
    else $('audCrearMsg').textContent = 'Puede tardar: se le piden los elementos a aSa, un código a la vez.';
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
  // La barrita del resultado: conforme / observación / hallazgo de la muestra.
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
      // El plazo sólo vence si la auditoría SE ENVIÓ: hasta entonces nadie podía corregir
      // nada, y marcar en rojo un plazo que no corría culpaba al auditado por adelantado.
      var vencida = a.estado !== 'cerrada' && a.enviada && a.plazo
                 && a.plazo < new Date().toISOString().slice(0, 10);
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
          // EL AVANCE DE LA RESOLUCIÓN, para saber si le están respondiendo sin abrirla.
          // Sólo tiene sentido una vez enviada: antes, las barras no son de nadie todavía.
          (a.enviada && a.barras_malas
            ? ' <span class="muted" style="font-size:9px" title="Barras resueltas: ' +
              'comprobadas en aSa o desestimadas con motivo.">' + (a.barras_resueltas || 0) +
              '/' + a.barras_malas + '</span>'
            : (a.acciones_abiertas ? ' <span class="audpend" title="Acciones sin corregir">' + a.acciones_abiertas + '</span>' : '')) + '</td>' +
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

  // ══════ EL FLUJO, EN UNA FRANJA ══════
  // En qué paso va, qué falta para el siguiente y el botón que lo da. Va arriba de todo
  // porque ENVIAR es el acto central del módulo —el que le pasa el trabajo al auditado— y
  // hasta ahora no existía en ninguna pantalla: la auditoría se «cerraba» sola al revisar
  // el último elemento y sus hallazgos quedaban sin dueño.
  function pintarFlujo() {
    var caja = $('audFlujo');
    if (!caja || !AUD) { if (caja) caja.style.display = 'none'; return; }
    caja.style.display = '';
    var paso = PASOS.map(function (p) { return p.k; }).indexOf(AUD.estado);
    $('audPasos').innerHTML = PASOS.map(function (p, i) {
      var cl = i === paso ? 'aqui' : (i < paso ? 'hecho' : '');
      return '<span class="' + cl + '" title="' + esc(_pasoAyuda(p.k)) + '">' + esc(p.t) + '</span>';
    }).join('');
    $('audFlujoQue').innerHTML = _flujoQue();
    $('audFlujoBotones').innerHTML = _flujoBotones();
    _flujoBind();
  }

  function _pasoAyuda(k) {
    return {
      planificada: 'Creada y sorteada la muestra. Todavía no se revisó nada.',
      en_curso: 'El auditor está revisando. Nadie más la ve: el auditado no puede accionar.',
      enviada: 'El auditor la terminó y la mandó. Recién acá el auditado resuelve sus barras.',
      cerrada: 'Sin barras abiertas: todas comprobadas o desestimadas con motivo.'
    }[k] || '';
  }

  // QUÉ FALTA, dicho como lo que hay que hacer y no como un estado. El motivo por el que
  // el botón está apagado va acá, en texto, y no en un tooltip que nadie abre.
  function _flujoQue() {
    var falta = (AUD.n || 0) - (AUD.revisados || 0);
    if (!AUD.enviada) {
      if (falta > 0) {
        return '<b>Faltan ' + falta + ' de ' + AUD.n + ' elementos</b> por revisar. ' +
               'Una auditoría se envía terminada: mientras no se mande, el auditado no la ve.';
      }
      return 'Todo revisado. Al enviarla, quien cubicó recibe sus barras y empieza a correr el plazo.';
    }
    var malas = AUD.barras_malas || 0, ok = AUD.barras_resueltas || 0;
    var des = AUD.barras_desestimadas || 0;
    if (AUD.cerrada_a_mano) {
      return 'Cerrada a mano. <span class="muted">' + esc(AUD.cerrada_motivo || '') + '</span>';
    }
    if (!malas) return 'Enviada, sin barras con hallazgo. Se cierra sola.';
    var abiertas = malas - ok;
    return '<b>' + ok + ' de ' + malas + '</b> barra(s) resueltas' +
      (des ? ' · ' + des + ' sin efecto por quien cubicó' : '') +
      (abiertas > 0
        ? ' · quedan <b>' + abiertas + '</b>. Cuando no quede ninguna, quien respondió la cierra.'
        : ' · sin barras abiertas: quien respondió puede cerrarla.');
  }

  function _flujoBotones() {
    // Enviar, cerrar y reabrir son del auditor de ESTA auditoria. El backend lo valida
    // igual: esto solo evita ofrecer un boton que iba a dar 403.
    var yo = global.currentUserEmail || '';
    var puedo = esAdmin() || (yo && AUD.auditor === yo);
    var falta = (AUD.n || 0) - (AUD.revisados || 0);
    // CERRADA SIN HABER SIDO ENVIADA = las de antes del 9-oct, que se cerraron con la regla
    // vieja («se revisó el último elemento»). No hay nada que enviar ahí: ofrecer el botón
    // haría que una auditoría del archivo le apareciera de golpe al auditado.
    if (AUD.estado === 'cerrada' && !AUD.enviada) {
      return '<span class="muted" style="font-size:10px">cerrada antes de que existiera el ' +
             'envío' + (AUD.cerrada_motivo ? ': ' + esc(AUD.cerrada_motivo) : '') + '</span>';
    }
    if (!AUD.enviada) {
      if (!puedo) {
        return '<span class="muted" style="font-size:10px">la envía ' +
               esc((AUD.auditor || 'su auditor').split('@')[0]) + ', que es quien la audita</span>';
      }
      return '<button class="audenviar" id="audBtnEnviar"' + (falta > 0 ? ' disabled' : '') +
             '>Enviar al auditado</button>' +
             '<span class="audborrador" title="Mientras no se envíe, el auditado no ve nada.">borrador</span>';
    }
    // «COMPROBAR EN aSa» SE FUE DE ACÁ (20-oct): la comprobación corre sola al cerrar, que
    // es cuando importa, y avisa sin bloquear. Un botón para correrla a mano era un paso
    // más que el usuario no quería: «es menos engorroso».
    var h = '';
    if (!puedo) return h;
    if (AUD.estado !== 'cerrada') {
      h += '<button class="audmini" id="audBtnCerrar" title="Para lo que el sistema no puede ' +
           'comprobar: la barra ya no existe, el código se anuló, la obra terminó.">Cerrar a mano</button>';
    }
    return h + '<button class="audmini" id="audBtnReabrir" title="Deshace el envío y la saca ' +
               'del panel del auditado. Queda registrado.">Reabrir</button>';
  }

  function _flujoBind() {
    var e = $('audBtnEnviar');
    if (e) e.addEventListener('click', pedirEnvio);
    var cm = $('audBtnCerrar');
    if (cm) cm.addEventListener('click', cerrarAMano);
    var r = $('audBtnReabrir');
    if (r) r.addEventListener('click', reabrir);
  }

  // ENVIAR: UNA CONFIRMACIÓN Y LISTO (28-oct). Acá vivía un panel verde que repetía lo
  // que la pantalla ya dice arriba —elementos revisados, con hallazgo, barras por
  // corregir— y encima lo mostraba DEBAJO del botón, así que el usuario tenía que bajar a
  // buscarlo. Él: «al presionar enviar al auditado, creo que debiera pedir confirmación y
  // listo, no mostrar ese menú verde». Lo que importa decir es a QUIÉN le llega y por
  // CUÁNTO tiempo queda comprometido, y eso cabe en una línea.
  function pedirEnvio() {
    var porcub = {};
    (AUD.elementos || []).forEach(function (el) {
      (el.barras_malas || []).forEach(function () {
        var q = (el.cubicado_por || '(sin dato)').trim();
        porcub[q] = (porcub[q] || 0) + 1;
      });
    });
    var gente = Object.keys(porcub).sort();
    var a_quien = gente.length
      ? gente.map(function (q) { return q.split('@')[0] + ' (' + porcub[q] + ' barra' + (porcub[q] === 1 ? '' : 's') + ')'; }).join(', ')
      : 'nadie: no quedaron barras por corregir';
    if (!global.confirm('Enviar ' + AUD.codigo + ' · ' + AUD.obra + '\n\n' +
                        'Le llega a: ' + a_quien + '\n' +
                        'Tendrá 24 horas para corregir, y el plazo arranca ahora.\n\n' +
                        'Desde este momento lo que marcaste queda firme: para cambiarlo hay que reabrirla.')) return;
    enviarAuditoria();
  }

  async function enviarAuditoria() {
    var b = $('audBtnEnviar');
    _ocupado(b, true);
    if (b) b.textContent = 'Enviando…';
    try {
      AUD = await req('POST', '/auditorias/' + AUD.id + '/enviar', {});
      ok('Auditoría enviada');
      await Promise.all([cargarLista(), cargarMisAcciones()]); pintarDetalle();
    } catch (e) {
      aviso(e.message);
      _ocupado(b, false);
      if (b) b.textContent = 'Enviar al auditado';
    }
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
    // TRES CUENTAS, NO PORCENTAJES (20-oct). Acá abajo iba la «cobertura de la obra», con
    // porcentajes sobre denominadores que se movían solos y que el usuario no podía leer.
    // Pidió esto en su lugar: elementos auditados, ítems auditados, hallazgos.
    // LOS TRES NÚMEROS SON LA BARRA, Y LA MUESTRA SE DESPLIEGA DESDE AHÍ (28-oct). El
    // usuario: «la barra muestra los KPI cards, pero si se quiere ver el detalle, entonces
    // se despliega y ahí aparece todo lo de abajo». La muestra es la herramienta del
    // auditor —diez filas con quince columnas— y hasta que no se abre un elemento no hace
    // falta tenerla delante.
    // LA FRANJA, A LO ANCHO (28-oct): lo que salió de la auditoría en una línea —elementos,
    // ítems, hallazgos, observaciones y a quién le toca cuánto—. Una pantalla por ETAPA, no
    // por rol: antes del envío debajo va la muestra (la herramienta del auditor); después
    // va el Resumen Hallazgos, y la muestra queda plegada para quien audita.
    var rs = AUD.resumen || {}, enviadaYa = !!(AUD.enviada || AUD.enviada_el);
    var obsN = (AUD.elementos || []).filter(function (e) { return e.hallazgo === 'observacion'; }).length;
    var porcub = {};
    (AUD.elementos || []).forEach(function (el) {
      (el.barras_malas || []).forEach(function () {
        var q = (el.cubicado_por || '(sin dato)').trim();
        porcub[q] = (porcub[q] || 0) + 1;
      });
    });
    var quien = Object.keys(porcub).sort().map(function (q) {
      return esc(q.split('@')[0]) + ': ' + porcub[q]; }).join(' · ');
    $('audDetInfo').innerHTML += '<div class="audkpis audres3" id="audResBarra">' +
      caj(rs.elementos_auditados || 0, 'elementos auditados' +
          (rs.elementos && rs.elementos !== rs.elementos_auditados ? ' de ' + rs.elementos : '')) +
      caj(rs.items_auditados || 0, 'ítems auditados') +
      caj(rs.hallazgos || 0, 'hallazgos', rs.hallazgos ? 'mal' : 'bien') +
      caj(obsN, 'observaciones') +
      caj(quien || '—', 'barras por corregir, por cubicador') +
      (enviadaYa && AUD.soy_auditor
        ? '<button class="audmini auddespl" id="audVerMuestra">' +
          (MUESTRA_ABIERTA ? '▾ Ocultar la muestra' : '▸ Ver la muestra del auditor (' + (AUD.n || 0) + ')') + '</button>'
        : '') +
      '</div>';
    var conflicto = (AUD.elementos || []).filter(function (e) { return e.conflicto; }).length;
    if (conflicto) $('audDetInfo').innerHTML += ' · <b style="color:#c62828">' + conflicto + ' elemento(s) cubicados por quien audita</b>';
    pintarFlujo();

    // EN aSa EL ELEMENTO VIVE DENTRO DE UN CÓDIGO DE CONTROL, y son dos cosas distintas:
    // el código con su descripción por un lado, el elemento por otro. Pegados con puntos
    // («SUP4 · INF · FUN C17») quedaba ilegible y encima repetía el eje. Van en columnas
    // propias, y sólo aparecen en las auditorías de aSa: en ArmaHub no hay código. El
    // elemento va ANTES que la descripción del código (6-oct, a pedido del usuario): es
    // lo que se revisa; la descripción es el contexto.
    var esAsa = AUD.origen === 'asa';
    // EN ArmaHub NO HAY CÓDIGO DE CONTROL. La columna «Código» sale sólo en las
    // auditorías de aSa, que es donde el elemento vive dentro de un CC; en las de ArmaHub
    // el elemento ES la clave (sector·piso·ciclo·eje) y no hay nada que mostrar ahí. Por
    // eso una auditoría muestra la columna y la otra no — no es que se haya perdido.
    var html = '<thead><tr>' +
      (esAsa ? '<th>Código</th><th title="Estado del código en aSa. La muestra se sortea entre ' +
               'los que no están despachados, pero el estado cambia después: auditar algo que ' +
               'ya salió llega tarde.">Estado</th>' : '') +
      '<th>Elemento</th>' + (esAsa ? '<th>Descripción del código</th>' : '') +
      '<th>Tipo</th><th>Piso</th><th>Ciclo</th><th>Eje</th>' +
      '<th class="num">Barras</th><th class="num">Kilos</th><th>Cubicó</th><th>Hallazgo</th><th>Acción</th></tr></thead><tbody>';
    (AUD.elementos || []).forEach(function (e) {
      var abierto = ELEM && ELEM.id === e.id;
      html += '<tr class="fila' + (abierto ? ' sel' : '') + '" data-id="' + e.id + '" title="' +
        (AUD.soy_auditor ? 'Clic para revisar este elemento'
                         : 'Lo tuyo se resuelve abajo, en Resumen Hallazgos: acá sólo se mira la muestra') + '">' +
        (esAsa ? '<td class="cc"><b>' + esc(e.cc || '') + '</b></td>' + celdaEstadoCc(e) : '') +
        // Lo que ancla la fila va en negrita: en aSa es el código, en ArmaHub el elemento.
        '<td class="audnom" title="' + esc(e.nombre) + '">' + (esAsa ? esc(e.nombre) : '<b>' + esc(e.nombre) + '</b>') + '</td>' +
        (esAsa ? '<td class="auddcc" title="' + esc(e.descr_cc || '') + '">' + esc(e.descr_cc || '') + '</td>' : '') +
        // En la fila ABIERTA de una auditoría de aSa la ubicación se escribe acá mismo.
        (esAsa && abierto ? celdasUbicacion(e) : celdasUbicacionTexto(e, esAsa)) +
        '<td class="num" title="' + (e.items || 0) + ' revisada(s)' + (e.items_malos ? ', ' + e.items_malos + ' no conforme(s)' : '') + '">' +
          (e.items ? '<b>' + e.items + '</b>/' : '') + e.barras + '</td>' +
        '<td class="num">' + kg0(e.kg) + '</td>' +
        '<td' + (e.conflicto ? ' class="indep" title="Lo cubicó quien audita: habría que cambiar este elemento"' : '') + '>' +
          esc((e.cubicado_por || '').split('@')[0]) + (e.conflicto ? ' ⚠' : '') + '</td>' +
        // EL VEREDICTO, SIN EL TEXTO AL LADO. Arrastrar acá 36 caracteres de lo que se
        // encontró empujaba la tabla fuera del ancho y la columna de la acción —la última—
        // quedaba cortada contra el borde. Lo que se encontró se lee entero más abajo, en
        // la tabla de acciones, que es donde se trabaja; acá va en el title.
        '<td title="' + esc(queSeEncontro(e)) + '">' + (e.hallazgo
          ? '<span class="audhz ' + esc(e.hallazgo) + '">' + esc(HALLAZGO_TXT[e.hallazgo]) + '</span>'
          : '<span class="muted">pendiente</span>') +
          // UN VEREDICTO QUE NO ES DEL AUDITOR SE MARCA EN ROJO. Pasó el 11-oct: el auditado
          // guardó cuatro elementos como «conforme» desde este mismo formulario y la
          // auditoría se cerró «sin hallazgos» sin que nadie lo viera. El backend ya no lo
          // permite; esto es para que, si vuelve a pasar por donde sea, se vea.
          (e.revisado_por_ajeno
            ? ' <span class="audajeno" title="Este veredicto lo guardó ' +
              esc((e.revisado_por || '').split('@')[0]) + ', que no es quien audita. No vale ' +
              'como revisión: el auditor tiene que volver a mirarlo.">no es del auditor</span>'
            : '') + '</td>' +
        '<td>' + (e.accion_estado ? '<span class="audacc1 ' + esc(e.accion_estado) + '">' + esc(ACCION_TXT[e.accion_estado]) + '</span>' : '') + '</td></tr>';
    });
    // LA MUESTRA ES DEL AUDITOR (21-oct). Al auditado —y a cualquiera que no audite— no se
    // le pinta: «esto confunde al auditado, porque esto es lo que hizo el auditor; acá es
    // donde el auditado modifica y queda la embarrada». Lo suyo está abajo.
    $('audDetElems').innerHTML = AUD.soy_auditor
      ? html + '</tbody>'
      : '<tbody><tr><td class="audvacio">La muestra la revisa el auditor. Lo tuyo está abajo, en ' +
        'Resumen Hallazgos.</td></tr></tbody>';
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
    // EL INFORME ES DE UNA AUDITORÍA TERMINADA. Lo pidió el usuario: sacarlo a medio
    // camino produce un documento que dice una cosa hoy y otra mañana, y los informes se
    // guardan y se mandan.
    var pdf = $('audPdf');
    if (pdf) {
      var lista = AUD.estado === 'cerrada';
      pdf.disabled = !lista;
      pdf.title = lista ? 'Informe de la auditoría, en PDF.'
                        : 'El informe se emite con la auditoría cerrada: hasta entonces ' +
                          'lo que dice todavía puede cambiar.';
    }
    // ANTES DEL ENVÍO la muestra está siempre, es la herramienta del auditor. DESPUÉS queda
    // plegada: lo que se trabaja es el Resumen Hallazgos. Quien no audita no la ve nunca.
    var cols = $('audCols');
    if (cols) cols.style.display = (AUD.soy_auditor && (!enviadaYa || MUESTRA_ABIERTA || ELEM)) ? '' : 'none';
    var vm = $('audVerMuestra');
    if (vm) vm.addEventListener('click', function () { MUESTRA_ABIERTA = !MUESTRA_ABIERTA; pintarDetalle(); });
    pintarAcciones();
    if (ELEM) {
      var vivo = (AUD.elementos || []).filter(function (x) { return x.id === ELEM.id; })[0];
      if (vivo) { ELEM = vivo; pintarRevision(); } else { ELEM = null; mostrarRevision(false); }
    }
  }

  // El panel de revisión se ve (o no), y con él la lista se comprime a un lado en las
  // pantallas anchas (ver .audcols.abierta en el HTML): la muestra a la izquierda, las
  // barras a la derecha, las dos a la vista.
  // EL DETALLE DEL ELEMENTO VA DEBAJO DE LA MUESTRA, A LO ANCHO (28-oct). Antes la pantalla
  // se partía en dos columnas y la muestra quedaba comprimida a la izquierda con los ejes
  // cortados; el usuario: «el detalle según lo que seleccione, en el mismo cuadro pero
  // abajo».
  function mostrarRevision(visible) {
    $('audRev').style.display = visible ? '' : 'none';
  }

  // El elemento nombrado ENTERO, para cuando se lee fuera de la tabla —el título de la
  // revisión, la lista de acciones— y no hay una columna de código al lado.
  function nombreCompleto(e) {
    return (e.cc ? e.cc + ' · ' : '') + (e.nombre || '');
  }

  // Abrir un elemento: se traen sus barras y aparece el formulario de hallazgo.
  async function abrirElemento(e) {
    // EL AUDITADO NO ENTRA AL FORMULARIO DEL AUDITOR, ni a mirar (15-oct). Hasta hoy se
    // abría en sólo lectura y aun así invitaba: el 11-oct un auditado «respondió» la
    // auditoría de Zañartu guardando acá sus elementos como conforme, y el veredicto del
    // auditor se perdió. El usuario: «debiera ver sólo su parte para actuar». Su parte es
    // el Resumen Hallazgos, abajo, con Aplica / No aplica / RCA / Corregido en aSa.
    if (!AUD || !AUD.soy_auditor) {
      mostrarRevision(false);
      var res = $('audAcciones');
      if (res && res.scrollIntoView) res.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
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
        var g = d.revisados[ref];
        VERED[ref] = { conforme: g.conforme, observacion: g.observacion || '',
                       // Lo que el auditor pidió la vez anterior vuelve a sus celdas: la
                       // revisión se puede retomar, no sólo escribir de una sentada. Baja
                       // de mm a cm porque es en lo que se escribió.
                       esperado: _espAcm(g.esperado) };
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
    var nCols = 10 + letras.length + nAng + (conRadio ? 1 : 0);
    var html = '<thead><tr><th style="width:124px">Veredicto</th><th>Marca</th><th class="num">φ</th>' +
      '<th>Figura</th><th>Render</th>' +
      letras.map(function (L) { return '<th class="num g">' + esc(L) + '</th>'; }).join('') +
      rango(nAng).map(function (i) { return '<th class="num g">α' + (i + 1) + '</th>'; }).join('') +
      (conRadio ? '<th class="num g">R</th>' : '') +
      '<th class="num" title="Suma de los largos parciales, como los suma la plataforma. ' +
      'No es el largo de corte de aSa, que descuenta el doblez.">Largo</th>' +
      '<th class="num">Cant</th><th class="num">Peso</th>' +
      '<th>' + (AUD.origen === 'asa' ? 'Elemento' : 'Plano') + '</th>' +
      // LA OBSERVACIÓN ES DE LA BARRA Y VA A LA DERECHA, SIEMPRE (28-oct). Antes aparecía
      // como una fila extra debajo al marcar «Hallazgo», y la nota del elemento abajo del
      // todo: el usuario veía las dos cosas mezcladas en un solo texto. Columna propia.
      '<th class="audobsth" title="Qué tiene ESTA barra. Es lo que le llega a quien cubicó, ' +
      'barra por barra. Lo que no es de ninguna barra va en la nota del elemento, abajo.">' +
      'Observación de la barra</th></tr></thead><tbody>';
    BARRAS.forEach(function (b, i) {
      var f = filas[i], v = VERED[b.ref];
      var clase = v ? (v.conforme ? ' class="bueno"' : ' class="malo"') : '';
      html += '<tr' + clase + ' data-ref="' + esc(b.ref) + '">' +
        '<td><span class="audvb">' +
          '<button class="si' + (v && v.conforme ? ' on' : '') + '" data-v="1" data-ref="' + esc(b.ref) + '" title="Conforme">OK</button>' +
          '<button class="no' + (v && v.conforme === false ? ' on' : '') + '" data-v="0" data-ref="' + esc(b.ref) + '" title="Hay algo que corregir en esta barra">Hallazgo</button>' +
        '</span></td>' +
        '<td class="cc" title="' + esc(b.ref) + '">' + esc(b.marca || '') + '</td>' +
        celdaEd(b, v, 'diam', num(f.diam), 'num') +
        celdaEd(b, v, 'figura', esc(b.figura || ''), 'cc') +
        '<td class="audfigcel">' + celdaFigura(f) + '</td>' +
        letras.map(function (L) {
          return celdaEd(b, v, 'lado:' + L, num(f.dims[L]), 'num g'); }).join('') +
        rango(nAng).map(function (k) { return '<td class="num g">' + num(f.angulos[k]) + '</td>'; }).join('') +
        (conRadio ? '<td class="num g">' + num(f.radio, 1) + '</td>' : '') +
        '<td class="num"' + (f.corte != null && Math.abs(f.corte - f.largo) > 0.5
            ? ' title="Suma de los largos parciales. aSa corta ' + num(f.corte) +
              ' cm: la diferencia es lo que se come el doblez."' : '') + '>' + num(f.largo) + '</td>' +
        celdaEd(b, v, 'cant', (b.cant_total != null ? b.cant_total : (b.cant || '')), 'num') +
        '<td class="num">' + kg0(b.peso_total) + '</td>' +
        '<td title="' + esc((b.plano || '') + (b.nota ? ' · ' + b.nota : '')) + '">' +
          esc(b.plano || '') + (b.nota ? ' <span class="muted">· ' + esc(b.nota) + '</span>' : '') + '</td>' +
        '<td class="audobstd">' +
          (v && v.conforme === false
            ? '<input type="text" class="audobs" data-obs="' + esc(b.ref) + '" placeholder="Qué tiene esta barra (obligatorio)" value="' +
              esc(v.observacion || '') + '">'
            : '') + '</td></tr>';
    });
    $('audRevBarras').innerHTML = html + '</tbody>';
    $('audRevBarras').querySelectorAll('button[data-v]').forEach(function (b) {
      b.addEventListener('click', function () {
        var ref = b.dataset.ref, si = b.dataset.v === '1';
        if (!_puedoEditar()) { aviso(_porQueNoEdito()); return; }
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
    _bindEditables();
    pintarRevision();
  }

  // ══════ EL VALOR ESPERADO: EL AUDITOR CORRIGE EL NÚMERO DONDE LO VE ══════
  //
  // Lo definió el usuario: «el auditor pueda editar los campos numéricos (diámetros, o
  // lados parciales... o cantidad... hasta puede cambiar la figura y reingresar esos
  // datos). Ahí el chequeo es específico».
  //
  // POR QUÉ EN LA PROPIA GRILLA y no en un sub-formulario: el auditor está comparando
  // contra el plano, campo por campo, y el lugar natural para escribir «acá debería decir
  // 103» es la celda que dice 100. Un panel aparte obligaría a volver a escribir qué campo
  // es, y eso es justo el dato que la celda ya tiene.
  //
  // Y PARA QUÉ SIRVE: un texto libre —«la cantidad debe ser 103»— no se puede comparar con
  // nada, y por eso la comprobación automática no existía. Esto sí: el sistema vuelve a
  // pedirle la barra a aSa y mira ese campo. Si no se corrige ningún número y sólo se deja
  // el comentario, la comprobación es más débil (dice si la barra cambió o está idéntica),
  // que es lo único honesto que se puede afirmar sin un valor con qué comparar.
  //
  // Sólo se editan las barras marcadas con HALLAZGO: en una conforme no hay nada que pedir.
  function celdaEd(b, v, campo, valor, clase) {
    if (!v || v.conforme !== false) {
      return '<td class="' + clase + '">' + valor + '</td>';
    }
    var esp = (v.esperado || {});
    var puesto = campo.indexOf('lado:') === 0
      ? ((esp.lados || {})[campo.slice(5)])
      : esp[campo];
    var tiene = puesto !== undefined && puesto !== null && puesto !== '';
    return '<td class="' + clase + ' audedc' + (tiene ? ' puesto' : '') + '">' +
      '<input class="auded" data-ed="' + esc(b.ref) + '" data-campo="' + esc(campo) + '"' +
      ' value="' + (tiene ? esc(String(puesto)) : '') + '"' +
      ' placeholder="' + String(valor).replace(/<[^>]*>/g, '') + '"' +
      ' title="Lo que DEBERÍA decir. En blanco = está bien así."></td>';
  }

  // Lo que el auditor escribió, guardado en la barra. Vacío = no lo tocó, y entonces no
  // entra en la comparación: pedir que un campo «siga igual» no es un hallazgo.
  function _bindEditables() {
    $('audRevBarras').querySelectorAll('input[data-ed]').forEach(function (i) {
      i.addEventListener('input', function () {
        var v = VERED[i.dataset.ed];
        if (!v) return;
        v.esperado = v.esperado || {};
        var campo = i.dataset.campo, val = i.value.trim();
        if (campo.indexOf('lado:') === 0) {
          v.esperado.lados = v.esperado.lados || {};
          if (val === '') delete v.esperado.lados[campo.slice(5)];
          else v.esperado.lados[campo.slice(5)] = val;
          if (!Object.keys(v.esperado.lados).length) delete v.esperado.lados;
        } else if (val === '') { delete v.esperado[campo]; }
        else { v.esperado[campo] = val; }
        i.parentElement.classList.toggle('puesto', val !== '');
      });
    });
  }

  // LA BARRA COMO ESTABA, para poder comprobar después si cambió. En las unidades de aSa
  // (mm), que son las que va a devolver cuando se le vuelva a preguntar: la grilla muestra
  // cm porque es como se cubica, pero comparar cm con mm daría que todo cambió siempre.
  function _aMm(x) { return AUD.origen === 'asa' ? Number(x) * 10 : Number(x); }

  function _originalDe(f, b) {
    var lados = {};
    Object.keys(f.dims || {}).forEach(function (L) { lados[L] = _aMm(f.dims[L]); });
    return { diam: f.diam, figura: b.figura || null,
             cant: (b.cant_total != null ? b.cant_total : b.cant) || null,
             largo: f.largo != null ? _aMm(f.largo) : null, lados: lados };
  }

  // Y lo que el auditor pidió, en las mismas unidades. Lo escribe en cm, como lo ve.
  function _esperadoDe(esp) {
    if (!esp) return null;
    var out = {};
    if (esp.diam) out.diam = Number(esp.diam);
    if (esp.cant) out.cant = Number(esp.cant);
    if (esp.figura) out.figura = String(esp.figura).trim();
    if (esp.lados) {
      out.lados = {};
      Object.keys(esp.lados).forEach(function (L) { out.lados[L] = _aMm(esp.lados[L]); });
    }
    return Object.keys(out).length ? out : null;
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
    // DE DÓNDE SALIÓ LA BARRA, para que el dibujo lo diga con su color. La marca se pone
    // acá, que es donde se sabe, y no en el dibujante: el motor sólo recibe un color.
    var f = { de_asa: origen === 'asa',
              figura: b.figura, diam: parseFloat(b.diam), dims: {}, eje: b.eje || null,
              angulos: (b.angulos || []).map(Number).filter(function (x) { return !isNaN(x); }),
              radio: origen === 'asa' ? 0 : (Number(b.radio) || 0),
              // `largo` es la SUMA DE LOS PARCIALES; `corte` es lo que aSa manda a cortar,
              // que descuenta el doblez. Son distintos a propósito.
              largo: (b.largo != null && b.largo !== '') ? Number(b.largo) * k : null,
              corte: (b.largo_corte != null && b.largo_corte !== '') ? Number(b.largo_corte) * k : null };
    Object.keys(b.dims || {}).forEach(function (key) {
      var v = Number(b.dims[key]);
      if (!(v > 0)) return;
      var L = String(key).toUpperCase();
      f.dims[L] = v * k;
      f['dim_' + L.toLowerCase()] = v * k;
    });
    return f;
  }

  // Lo guardado viene en mm (como lo manda aSa) y las celdas se escriben en cm.
  function _espAcm(esp) {
    if (!esp || !Object.keys(esp).length) return {};
    var out = {};
    if (esp.diam) out.diam = esp.diam;
    if (esp.cant) out.cant = esp.cant;
    if (esp.figura) out.figura = esp.figura;
    if (esp.lados) {
      out.lados = {};
      Object.keys(esp.lados).forEach(function (L) {
        out.lados[L] = AUD.origen === 'asa' ? Number(esp.lados[L]) / 10 : esp.lados[L];
      });
    }
    return out;
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
  // EL TAMAÑO DEL DIBUJO, que elige quien mira. Son los mismos tres del Bar Manager
  // (hay un cuarto, 'xl', que acá no entra: la figura vive en una celda de tabla).
  // Se recuerda por navegador: quien trabaja con figuras chicas las quiere chicas
  // siempre, y volver a elegirlo en cada pantalla es trabajo que no paga.
  // S POR DEFECTO (21-oct) y el último que eligió la persona, si lo hay.
  var FIG_TAM = 's';
  try { FIG_TAM = global.localStorage.getItem('armahub_fig_tam') || 's'; } catch (e) {}
  if (['s', 'm', 'l'].indexOf(FIG_TAM) === -1) FIG_TAM = 's';

  global.audFigTam = function (t) {
    if (t && ['s', 'm', 'l'].indexOf(t) !== -1) {
      FIG_TAM = t;
      try { global.localStorage.setItem('armahub_fig_tam', t); } catch (e) {}
    }
    return FIG_TAM;
  };

  // Los chips S/M/L, para la pantalla que los quiera poner. `alRepintar` es lo que hay
  // que volver a dibujar: el tamaño cambia el SVG, así que no basta con marcar el chip.
  global.audChipsTam = function (idCaja, alRepintar) {
    var el = document.getElementById(idCaja);
    if (!el) return;
    var T = [['s', 'S'], ['m', 'M'], ['l', 'L']];
    el.innerHTML = T.map(function (x) {
      return '<button data-tam="' + x[0] + '" class="' + (FIG_TAM === x[0] ? 'on' : '') +
             '" title="Tamaño del dibujo">' + x[1] + '</button>';
    }).join('');
    el.querySelectorAll('button[data-tam]').forEach(function (b) {
      b.addEventListener('click', function () {
        global.audFigTam(b.dataset.tam);
        if (typeof alRepintar === 'function') alRepintar();
      });
    });
  };

  // EL NOMBRE DE LA FIGURA, debajo del dibujo. Es el código del catálogo de aSa (T1,
  // 106A, 105A…) y es con lo que se habla de una barra en planta: sin él, dos figuras
  // parecidas en una miniatura son la misma.
  function _conNombre(svg, f) {
    if (!svg || !f || !f.figura) return svg;
    // AL LADO, NO DEBAJO (21-oct): el usuario quería las filas más compactas.
    return '<span class="audfigw">' + svg + '<span class="audfign" title="Figura del catálogo de aSa">' +
           esc(f.figura) + '</span></span>';
  }

  function celdaFigura(f) {
    var svg = global._bmFiguraSvg ? global._bmFiguraSvg(f, FIG_TAM) : '';
    if (svg) return _conNombre(svg, f);
    svg = svgEje(f);
    if (!svg) return '<span class="muted">—</span>';
    // DE DÓNDE SALIÓ EL DIBUJO, cuando no salió de donde sale siempre. El backend intenta
    // primero su reconstrucción y, si no cuadra con la envolvente que aSa declara, usa el
    // trazo que aSa misma exportó en su catálogo (ver trazo_de_catalogo). Que una figura se
    // esté dibujando por la segunda vía no es un problema —al contrario, es la topología de
    // aSa— pero el auditor tiene derecho a saber qué está mirando.
    if (f.eje.fuente === 'catalogo_asa') {
      return _conNombre(svg, f) + '<span class="audfigfte" title="Esta figura se dibuja con el trazo que ' +
        'exportó aSa en su catálogo, a las medidas de esta barra. La reconstrucción desde ' +
        'los vectores no cuadraba con la envolvente que aSa declara.">aSa</span>';
    }
    return _conNombre(svg, f) + (f.eje.ok ? '' :
      '<span class="audfigav" title="' + esc(f.eje.motivo || 'La envolvente no cuadra con la que declara aSa') + '">⚠</span>');
  }

  // LA FIGURA CONSTRUIDA DESDE aSa, como POLICURVA: puntos en mm (Y hacia arriba, como en
  // el motor) y un tramo por segmento, recto o arco. Los arcos —los ganchos de 135° y
  // 180°, los tramos curvos— van con su radio y su sentido al motor, que los dibuja con
  // el comando A de SVG y no les mete codo encima; los rectos llevan de rótulo la medida
  // del lado en cm, como el Bar Manager. Las cotas automáticas de arco del motor (radio,
  // desarrollo) se apagan: en una miniatura de auditoría son ruido.
  // Ningún lado se dibuja más corto que este % del mayor. Es el mismo criterio del Bar
  // Manager (BM_MIN_LADO_REL): un gancho de 10 cm junto a una barra de 12 m mide medio
  // píxel y desaparece, y una figura a la que le falta el gancho no es esa figura. El
  // dibujo deja de ser proporcional ahí, y es a propósito: está para reconocer la barra,
  // no para medirla — las medidas están en sus columnas, al lado.
  var MIN_LADO_REL = 0.18;

  // LOS ARCOS NO SE ESTIRAN, Y ESTO NO ES UN DETALLE (corregido el 8-oct). El gancho de un
  // estribo viaja como un arco: su CUERDA mide poco —veintitantos milímetros— mientras el
  // cuerpo de la barra mide novecientos, así que caía siempre bajo el mínimo y se estiraba.
  // Pero el radio del arco NO se estiraba con ella, y un arco al que le alargan la cuerda
  // sin tocarle el radio ya no se puede dibujar: SVG agranda el radio solo para que llegue,
  // y la curva sale abierta y despegada del fierro. Es el margen que el usuario veía en los
  // estribos («esa curva debiera coincidir»).
  //
  // Un arco, además, nunca necesita el mínimo: es una curva, se ve aunque sea chica. Lo que
  // desaparece en una miniatura es un tramo RECTO corto, y ésos son los que se estiran.
  // ¿EL CONTORNO CIERRA? Mirando el primer punto contra el último, o —y esto es lo que
  // faltaba— quitándole los tramos de las PUNTAS. En un estribo los extremos son las
  // puntas de los ganchos, que no se tocan entre sí: el marco cierra, las puntas no. Por
  // eso la guarda de «figura cerrada» no lo reconocía y el estribo entraba a estirarse.
  //
  // SE PRUEBAN DOS TRAMOS POR PUNTA porque un gancho son DOS: el arco del doblez y la
  // pata recta. Medido sobre barras de aSa: una T1 y una 106A llegan con ocho tramos
  // —pata, arco, cuatro lados, arco, pata— y su marco cierra recortando exactamente dos
  // de cada lado. Una barra abierta (102A) no cierra con ningún recorte, así que sigue
  // recibiendo el mínimo, que es para lo que está.
  function _cierraRecortando(pts) {
    for (var k = 0; k <= 2; k++) {
      var d = k, h = pts.length - 1 - k;
      if (h - d < 3) break;
      var per = 0;
      for (var i = d + 1; i <= h; i++) {
        per += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      if (per > 0 && Math.hypot(pts[h].x - pts[d].x, pts[h].y - pts[d].y) <= 0.02 * per) {
        return true;
      }
    }
    return false;
  }

  function _conMinimo(pts, tipos) {
    if (pts.length < 3) return pts;
    // Una figura CERRADA no se toca: estirar un lado la dejaría abierta, y un estribo con
    // una esquina suelta se lee como un error de la barra y no del dibujo.
    //
    // UN ESTRIBO TAMPOCO, aunque sus puntas no se toquen. Es el caso que el usuario vio
    // descuadrado: lo que cierra ahí es el MARCO, y los ganchos sobresalen de él. Y un
    // estribo no necesita el mínimo —sus cuatro lados son del mismo orden de magnitud—,
    // así que no se pierde nada por no tocarlo.
    if (_cierraRecortando(pts)) return pts;
    var esArco = function (i) { return !!(tipos && tipos[i] === 'arco'); };
    var largos = [], i;
    for (i = 1; i < pts.length; i++) {
      largos.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    // El mayor se mide sobre los RECTOS: si mandara la cuerda de un arco, el umbral
    // cambiaría según la curvatura y no según el tamaño de la barra.
    var mayor = 0;
    for (i = 0; i < largos.length; i++) {
      if (!esArco(i) && largos[i] > mayor) mayor = largos[i];
    }
    var minimo = (mayor || Math.max.apply(null, largos)) * MIN_LADO_REL;
    var hayCorto = false;
    for (i = 0; i < largos.length; i++) {
      if (!esArco(i) && largos[i] < minimo) { hayCorto = true; break; }
    }
    if (!(minimo > 0) || !hayCorto) return pts;
    var out = [pts[0]];
    for (i = 1; i < pts.length; i++) {
      var L = largos[i - 1] || 1;
      var k = esArco(i - 1) ? 1 : Math.max(1, minimo / L);
      out.push({ x: out[i - 1].x + (pts[i].x - pts[i - 1].x) * k,
                 y: out[i - 1].y + (pts[i].y - pts[i - 1].y) * k });
    }
    return out;
  }

  function svgEje(f) {
    var eje = f.eje, M = global.disenadorMotor;
    if (!eje || !(eje.puntos || []).length || !M || !M.svgDesdePuntos || !global._bmTam) return '';
    var t = global._bmTam(FIG_TAM);
    var tramos = eje.tramos || [];
    var tipos = tramos.map(function (s) { return s.tipo === 'arco' ? 'arco' : 'recto'; });
    // Los tipos van ANTES del mínimo: es lo que le dice cuáles no debe tocar.
    var pts = _conMinimo(eje.puntos.map(function (p) { return { x: p[0] / 10, y: p[1] / 10 }; }), tipos);
    var completo = tramos.length === pts.length - 1;
    var radios = tramos.map(function (s) { return s.tipo === 'arco' ? (s.radio || 0) / 10 : 0; });
    // El backend dice el sentido en geometría (sweep 1 = antihorario con la Y hacia
    // arriba); el motor toma `sweeps_seg` en la convención del lienzo del Diseñador, que
    // es la contraria. Medido con el motor de verdad (tangencia del arco con sus dos
    // tramos): sin invertirlo, el codo del gancho caía al otro lado de la cuerda.
    var sweeps = tramos.map(function (s) { return s.sweep == null ? 1 : 1 - s.sweep; });
    var labels = tramos.map(function (s) { return (s.tipo === 'recto' && s.largo) ? String(Math.round(s.largo / 10)) : ''; });
    try {
      return M.svgDesdePuntos(pts, { width: t.w, height: t.h, pad: 20,
                                     tipos_seg: completo ? tipos : null, radios_seg: completo ? radios : null,
                                     sweeps_seg: completo ? sweeps : null, labels: completo ? labels : [],
                                     labels_auto: completo, angulos: completo, cotas_arco_iso: [],
                                     diam_mm: f.diam, metrico: true });
    } catch (e) { return ''; }
  }

  // LOS LADOS DE UNA BARRA, EN GRILLA. Lo pidió el usuario así: «por qué no los pones
  // claros, A = 15, B = XX… preferiría que pongas encabezados, ordenado».
  //
  //     Lado   A     B     C     D     E     G
  //     cm     1,5   4,5   5,5   4,5   5,5   1,5
  //     Áng          135°  90°   90°   90°   135°
  //
  // EN CENTÍMETROS, que es la unidad en la que se habla en planta y la que ya rotula el
  // dibujo. `normalizarBarra` ya trae las dims convertidas (aSa manda milímetros); lo que
  // estaba mal era el ENCABEZADO, que decía «mm» sobre valores que eran cm.
  //
  // EN ORDEN ALFABÉTICO, que es como se leen y como vienen rotuladas en el dibujo. Antes
  // iban en orden de RECORRIDO (G, E, D, C, B, A) y no por gusto: el ángulo que manda aSa
  // es el giro de cada lado contra el ANTERIOR EN EL RECORRIDO, así que ordenar por letra
  // los despegaba del lado que les toca. Acá cada ángulo viaja en la columna de SU lado,
  // así que el orden ya no lo rompe.
  //
  // SIN SIGNO. El menos es el sentido de giro (horario / antihorario), no una medida: en
  // una tabla que se lee para verificar una barra es ruido.
  // Un decimal SÓLO cuando hace falta. Un gancho de 1,5 cm necesita el decimal; un lado
  // de 55 no, y «55,0» en una tabla de seis columnas es ruido.
  global.audNumCm = function (v) {
    var n = Number(v) || 0;
    var r = Math.round(n * 10) / 10;
    return (Math.abs(r - Math.round(r)) < 0.05 ? String(Math.round(r))
                                               : r.toFixed(1)).replace('.', ',');
  };

  global.audGrillaLados = function (f, malos, esc_) {
    if (!f || !f.dims) return '';
    var E = esc_ || function (s) { return String(s == null ? '' : s); };
    var mal = malos || {};
    var orden = Object.keys(f.dims);          // el recorrido, como lo manda aSa
    var ang = f.angulos || [];
    var deLado = {};                          // lado → ángulo con el anterior
    orden.forEach(function (L, i) { if (i > 0 && ang[i - 1] != null) deLado[L] = ang[i - 1]; });
    var ks = orden.slice().sort();
    var hayAng = ks.some(function (L) { return deLado[L] != null; });
    function fila(clase, rotulo, celda) {
      return '<tr class="' + clase + '"><th>' + rotulo + '</th>' +
             ks.map(function (L) { return '<td' + (mal[L] ? ' class="mal"' : '') + '>' +
                                          celda(L) + '</td>'; }).join('') + '</tr>';
    }
    return '<table class="audgl">' +
      fila('l', 'Lado', function (L) { return E(L); }) +
      fila('v', 'cm', function (L) { return global.audNumCm(f.dims[L]); }) +
      (hayAng ? fila('a', 'Áng', function (L) {
        return deLado[L] == null ? '' : Math.abs(Math.round(deLado[L])) + '°'; }) : '') +
      '</table>';
  };

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
  // EL ESTADO DEL CÓDIGO en la lista. Despachado va en rojo con su fecha: es la única
  // condición que cambia lo que el auditor debería hacer con ese elemento.
  function celdaEstadoCc(e) {
    if (!e.estado_cc) return '<td class="muted">—</td>';
    var clase = e.despachado ? ' class="audesc desp"' : ' class="audesc"';
    var tit = e.despachado
      ? 'Ya se despachó' + (e.despacho_cc ? ' el ' + ddmm(e.despacho_cc) : '') +
        ': auditarlo llega tarde, lo que vale es revisar antes de que salga.'
      : 'Estado del código en aSa';
    return '<td' + clase + ' title="' + esc(tit) + '">' + esc(e.estado_cc) +
           (e.despachado && e.despacho_cc ? ' ' + ddmm(e.despacho_cc) : '') + '</td>';
  }

  // Las mismas cuatro celdas en texto. En aSa, lo que se LEYÓ del nombre y nadie confirmó
  // va en gris cursiva: se ve que es una lectura, no un dato.
  function celdasUbicacionTexto(e, esAsa) {
    var leido = esAsa && !e.ubicado_el && (e.sector || e.piso || e.ciclo);
    var td = leido ? '<td class="audderiv" title="Leído del nombre del código, sin confirmar">' : '<td>';
    return td + esc(e.tipo || '') + '</td>' + td + esc(e.piso) + '</td>' + td + esc(e.ciclo) + '</td><td>' + esc(e.eje) + '</td>';
  }

  function celdasUbicacion(e) {
    var tit = e.ubicado_el
      ? 'Escrita por ' + (e.ubicado_por || '').split('@')[0]
      : (e.sector || e.piso || e.ciclo)
        ? 'Leído del nombre del código, sin confirmar: corrígelo si no es. Se guarda al salir del campo.'
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
    if (!_puedoEditar()) return;
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
  // ¿SE PUEDE ESCRIBIR LO DEL AUDITOR? Lo dice el backend, que es el único que lo sabe:
  // sólo el auditor de esta auditoría, y sólo mientras no la haya enviado. El servidor lo
  // rechaza igual (409 / 403); esto es para que no se intente y se vea por qué.
  function _puedoEditar() { return !!(AUD && AUD.puedo_editar); }

  function _porQueNoEdito() {
    if (!AUD) return '';
    if (AUD.enviada || AUD.enviada_el) {
      return 'Esta auditoría ya se envió: lo que marcó el auditor quedó firme y el ' +
             'auditado está trabajando sobre eso. Para cambiarlo hay que reabrirla.';
    }
    if (!AUD.soy_auditor) {
      return 'La audita ' + ((AUD.auditor || '').split('@')[0] || 'otra persona') +
             '. Acá puedes mirar lo que encontró; lo tuyo se resuelve abajo, en cada barra.';
    }
    return '';
  }

  function pintarRevision() {
    mostrarRevision(!!ELEM);
    if (!ELEM) return;
    // EL FORMULARIO SE BLOQUEA ENTERO, no botón por botón: media docena de campos
    // editables con el guardar apagado invita a escribir para nada.
    var puedo = _puedoEditar();
    var cand = $('audRevCandado');
    if (cand) {
      cand.textContent = puedo ? '' : _porQueNoEdito();
      cand.style.display = puedo ? 'none' : '';
    }
    var pan = $('audRev');
    if (pan) pan.classList.toggle('audsololeer', !puedo);
    if ($('audRevGuardar')) $('audRevGuardar').style.display = puedo ? '' : 'none';
    if ($('audRevTexto')) $('audRevTexto').readOnly = !puedo;
    var c = cuentaBarras();
    $('audRevCuenta').innerHTML = c.revisadas + ' de ' + c.total + ' barras revisadas' +
      (c.malas ? ' · <b style="color:#c62828">' + c.malas + ' no conforme(s)</b>' : '');
    // Sin barras malas no hay severidad que elegir: el elemento es conforme y punto.
    $('audRevSev').style.display = c.malas ? 'flex' : 'none';
    if (c.malas) {
      var sel = (ELEM.hallazgo && ELEM.hallazgo !== 'conforme') ? ELEM.hallazgo : 'hallazgo';
      var previos = $('audRevChips').querySelector('button.on');
      if (previos) sel = previos.dataset.h;
      $('audRevChips').innerHTML = ['observacion', 'hallazgo'].map(function (k) {
        return '<button data-h="' + k + '" class="hz ' + k + (sel === k ? ' on' : '') + '">' + HALLAZGO_TXT[k] + '</button>';
      }).join('');
      $('audRevChips').querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          $('audRevChips').querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
        });
      });
    }
    // LA NOTA ES DE ESTE ELEMENTO (28-oct). Acá decía «si el textarea está vacío, poné el
    // texto del elemento» y nada más: al pasar a otro elemento, lo escrito en el anterior
    // seguía ahí y se guardaba con el siguiente. Así quedó la misma nota pegada en cuatro
    // elementos de A-2026-012 y las doce observaciones de 406 REV 1 en tres conformes. El
    // textarea recuerda PARA QUÉ elemento se llenó y se vuelve a llenar sólo al cambiar de
    // elemento —no en cada repintado, que es cada clic de OK/Hallazgo y borraría lo que
    // se está escribiendo—.
    var ta = $('audRevTexto');
    if (ta && ta.dataset.de !== String(ELEM.id)) {
      ta.value = ELEM.texto || '';
      ta.dataset.de = String(ELEM.id);
    }
    $('audRevMsg').textContent = ELEM.revisado_el
      ? 'Registrado ' + ddmm(ELEM.revisado_el) + (ELEM.revisado_por ? ' por ' + ELEM.revisado_por.split('@')[0] : '')
      : '';
  }

  async function guardarHallazgo() {
    if (!AUD || !ELEM) return;
    if (!_puedoEditar()) { aviso(_porQueNoEdito()); return; }
    var c = cuentaBarras();
    if (!c.revisadas) { $('audRevMsg').textContent = 'Marca al menos una barra como conforme o no conforme.'; return; }
    var faltan = Object.keys(VERED).filter(function (r) {
      return VERED[r].conforme === false && !(VERED[r].observacion || '').trim();
    });
    if (faltan.length) { $('audRevMsg').textContent = 'Di qué tienen las barras ' + faltan.join(', ') + '.'; return; }
    var on = $('audRevChips').querySelector('button.on');
    var items = Object.keys(VERED).map(function (r) {
      var i = -1;
      BARRAS.forEach(function (x, k) { if (x.ref === r) i = k; });
      var b = i >= 0 ? BARRAS[i] : {};
      var f = i >= 0 ? normalizarBarra(b, AUD.origen) : null;
      return { ref: r, marca: b.marca || null, conforme: VERED[r].conforme,
               observacion: VERED[r].observacion,
               // LO QUE DEBERÍA DECIR y CÓMO ESTABA: los dos viajan estructurados, en las
               // unidades de aSa, porque de eso vive la comprobación automática.
               esperado: VERED[r].conforme === false ? _esperadoDe(VERED[r].esperado) : null,
               original: (f && VERED[r].conforme === false) ? _originalDe(f, b) : null };
    });
    $('audRevGuardar').disabled = true;
    try {
      AUD = await req('PUT', '/auditorias/' + AUD.id + '/elementos/' + ELEM.id + '/revision', {
        items: items, hallazgo: (c.malas && on) ? on.dataset.h : null,
        texto: $('audRevTexto').value });
      ok('Revisión guardada');
      await cargarLista();
      await cargarIndicadores();
      pintarDetalle();
    } catch (e) { aviso(e.message); $('audRevMsg').textContent = e.message; }
    $('audRevGuardar').disabled = false;
  }

  // LO QUE SE ENCONTRÓ, EN UNA LÍNEA, para los lugares donde no cabe más que eso (el
  // `title` de una celda). Son DOS campos distintos y se juntan acá, al escribir: la
  // observación del elemento entero y lo que se anotó en cada barra. El backend los guarda
  // separados a propósito — antes concatenaba las barras dentro del campo general y en el
  // resumen no había forma de saber si una frase era del elemento o de una barra.
  function queSeEncontro(e) {
    var p = [];
    if ((e.texto || '').trim()) p.push(e.texto.trim());
    (e.barras_malas || []).forEach(function (b) {
      if ((b.observacion || '').trim()) p.push((b.ref || b.marca || 'barra') + ': ' + b.observacion.trim());
    });
    return p.join(' · ');
  }

  // Y ACÁ CON SU FORMA, que es como se lee de verdad: la observación general como frase, y
  // lo de cada barra como lista, cada una con el nombre de SU barra adelante. Una lista de
  // ocho barras metida en un párrafo no se lee; en ocho renglones, sí.
  function celdaQueSeEncontro(e) {
    var html = '';
    if ((e.texto || '').trim()) {
      html += '<div class="audobsgen">' + esc(e.texto.trim()) + '</div>';
    }
    var malas = (e.barras_malas || []).filter(function (b) { return (b.observacion || '').trim(); });
    if (malas.length) {
      html += '<ul class="audobsb">' + malas.map(function (b) {
        return '<li><b>' + esc(b.ref || b.marca || 'barra') + '</b> ' + esc(b.observacion.trim()) + '</li>';
      }).join('') + '</ul>';
    }
    return html || '<span class="muted">—</span>';
  }

  // LO QUE SALIÓ DE LA AUDITORÍA, BARRA POR BARRA Y CON LA ACCIÓN AL LADO (13-oct).
  //
  // El usuario: «el auditado no tiene acciones… debe poder generar la acción sobre cada
  // observación, aplica o no aplica; si aplica debe poder elegir el Ishikawa desde la
  // matriz, pero debe ser por ITEM, hoy está agrupado».
  //
  // Estaba agrupado por elemento y era de sólo lectura, y las acciones vivían en otra
  // caja —«Mis correcciones»— que ni siquiera aparece si no eres dueño de ninguna barra.
  // Era el mismo problema que el módulo de chequeos ya resolvió: la decisión se toma
  // mirando el hallazgo, no en otra pantalla.
  //
  // QUIÉN VE QUÉ. La tabla la ven todos, porque el registro es público dentro del equipo.
  // Los botones salen sólo en las barras que uno cubicó, que es lo que dice `e.mio` —lo
  // resuelve el backend con `alias_cubicador`, porque el login de aSa no se parece al
  // correo—. El auditor no corrige lo que él mismo marcó: sería juez y parte.
  function pintarAcciones() {
    var caja = $('audAcciones');
    var acc = (AUD.elementos || []).filter(function (e) { return e.accion_estado; });
    // EL RESUMEN EXISTE DESDE EL ENVÍO (28-oct). Antes aparecía mientras el auditor todavía
    // revisaba, con un cartel de «todavía no se envía»: era ruido para él y, para el
    // auditado, hallazgos a medio hacer. Una pantalla por etapa.
    var enviadaAhora = !!(AUD.enviada || AUD.enviada_el);
    if (!acc.length || !enviadaAhora) { caja.style.display = 'none'; return; }
    caja.style.display = '';
    var total = 0, resueltas = 0, mias = 0;
    acc.forEach(function (e) {
      (e.barras_malas || []).forEach(function (b) {
        total++;
        if (b.corregido || b.desestimado) resueltas++;
        if (e.mio && !b.corregido && !b.desestimado) mias++;
      });
      // El comentario que no es de ninguna barra cuenta como una línea más: es trabajo del
      // auditado igual que una barra, y si no se contara el total mentiría.
      if (e.comentario_suelto) {
        total++;
        var resuelto = (e.accion_estado || 'pendiente') !== 'pendiente';
        if (resuelto) resueltas++;
        if (e.mio && !resuelto) mias++;
      }
    });
    var enviada = !!(AUD.enviada || AUD.enviada_el);
    var faltan = AUD.barras_pendientes || 0;
    var nsel = Object.keys(SEL_AUD).length;
    caja.innerHTML = '<div class="audh">Resumen Hallazgos ' +
      '<span class="muted">' + total + ' línea(s) · ' + resueltas + ' resuelta(s)' +
      (mias ? ' · <b style="color:#c62828">' + mias + ' tuya(s) por resolver</b>' : '') +
      '</span>' +
      // LAS FIGURAS, A PEDIDO. Son una lectura a aSa por código: se piden cuando alguien
      // las quiere, no al abrir la auditoría.
      (total ? '<button class="audmini" id="audFigs" title="Lee los códigos en aSa y ' +
               'dibuja cada barra con sus lados. Tarda unos segundos por código.">' +
               'Ver las figuras</button>' +
               '<span class="dshchips audtam" id="audTam"></span>' : '') +
      '<div style="flex:1"></div>' +
      // EL CIERRE ES DEL AUDITADO: lo aprieta quien respondió, y sólo cuando no le queda
      // ninguna barra pendiente. La condición la dice el backend, que es el que después
      // la valida: ofrecer un botón que va a dar 400 es peor que no ofrecerlo.
      (AUD.puedo_cerrar
        ? '<button class="audenviar" id="audBtnCerrarOk">Cerrar la auditoría</button>'
        : (enviada && faltan && AUD.estado !== 'cerrada'
            ? '<span class="muted" style="font-size:10.5px">quedan ' + faltan +
              ' por resolver para poder cerrar</span>' : '')) +
      '</div>' +
      // CERRADA: lo que dijo aSa al cerrar, que es lo que vale como comprobación.
      (AUD.estado === 'cerrada' && AUD.cierre_chequeo
        ? '<div class="audnota audcerrada">Cerrada' +
          (AUD.cerrada_por ? ' por <b>' + esc(String(AUD.cerrada_por).split('@')[0]) + '</b>' : '') +
          ' · aSa confirmó <b>' + ((AUD.cierre_chequeo.cumplen || []).length) + '</b>' +
          ((AUD.cierre_chequeo.siguen_igual || []).length
            ? ' · <b>' + AUD.cierre_chequeo.siguen_igual.length + '</b> seguían igual en aSa, cerradas bajo su confirmación (' +
              esc(AUD.cierre_chequeo.siguen_igual.map(function (x) { return x.ref; }).join(', ')) + ')'
            : '') +
          ((AUD.cierre_chequeo.sin_leer || []).length
            ? ' · ' + AUD.cierre_chequeo.sin_leer.length + ' no se pudieron comprobar' : '') +
          '</div>'
        : (AUD.estado === 'cerrada' ? '' :
          (mias ? '' : (AUD.puedo_actuar
            ? '<div class="audnota">Acá se ve todo lo que salió. Puedes resolver también lo de otro ' +
              'cubicador si no está: le llega aviso y queda escrito quién lo hizo.</div>'
            : '<div class="audnota">Lo que marcaste, como lo está resolviendo quien cubicó. Si no ' +
              'aceptas un descarte, «No lo acepto» lo vuelve a abrir.</div>')))) +
      // DE A MUCHAS (21-oct), como en la revisión: «muchas veces el hallazgo es el mismo
      // para más de un ítem». Los checks marcan; lo que se hace se replica. «No aplica»
      // pide motivo y explicación UNA vez para todas.
      (enviada && AUD.estado !== 'cerrada' && AUD.puedo_actuar
        ? '<div class="audlote" id="audLote">' +
            '<b>' + (nsel ? nsel + ' barra(s) marcada(s)' : 'Marca con el check para resolver varias de una vez') + '</b>' +
            '<div style="flex:1"></div>' +
            '<div class="revseg">' +
              '<button data-alote="aplica"' + (nsel ? '' : ' disabled') +
                ' title="Las marcadas vuelven a quedar por resolver">Aplica' + (nsel ? ' (' + nsel + ')' : '') + '</button>' +
              '<button data-alote="no_aplica"' + (nsel ? '' : ' disabled') +
                ' title="Deja sin efecto las marcadas, con un motivo y una explicación para todas">No aplica' +
                (nsel ? ' (' + nsel + ')' : '') + '</button>' +
            '</div>' +
            '<button class="audbres" data-alote="resuelto"' + (nsel ? '' : ' disabled') +
              ' title="Marca las marcadas como resueltas: ya hiciste el cambio en aSa. Todas necesitan RCA.">' +
              'Resuelto' + (nsel ? ' (' + nsel + ')' : '') + '</button>' +
            '<div class="revnapcaja" id="audLoteNap" style="display:none; width:100%; margin-top:6px;">' +
              '<select id="audLoteMot">' + _opcionesMotivoAud() + '</select>' +
              '<input type="text" id="audLoteNota" placeholder="Explica por qué no aplican — lo lee quien auditó y queda en el informe">' +
              '<button class="audmini ver" id="audLoteOk">Guardar</button>' +
              '<button class="audmini" id="audLoteNo">Cancelar</button>' +
            '</div>' +
          '</div>'
        : '') +
      '<div class="audbdacc"><table class="audt audacct"><thead><tr><th style="width:22px"></th><th>Barra</th><th>Figura</th>' +
      '<th>Elemento</th>' +
      '<th title="Lo que el auditor anotó en esta barra.">Qué se encontró</th>' +
      '<th title="Lo que la barra debería decir, como lo dejó el auditor. De esto vive la ' +
      'comprobación automática contra aSa.">Debería decir</th>' +
      '<th title="Por qué pasó. Se elige en la matriz Ishikawa, y es POR BARRA: dos barras ' +
      'del mismo eje pueden estar mal por razones distintas.">Por qué pasó</th>' +
      '<th>Estado</th><th class="audaccth">' + (enviada && AUD.estado !== 'cerrada' ? 'Acción' : '') + '</th></tr></thead><tbody>' +
      // AGRUPADO POR CÓDIGO (21-oct), como la revisión: es como se corrige —se abre un CC
      // en aSa y se arregla lo de ahí— y la cabecera dice cuánto queda de ese código.
      (function () {
        var grupos = [], ix = {};
        acc.forEach(function (e) {
          var k = e.cc || '(sin código)';
          if (!ix[k]) { ix[k] = { cc: e.cc, descr: e.descr_cc, cubico: e.cubicado_por, els: [] }; grupos.push(ix[k]); }
          ix[k].els.push(e);
        });
        return grupos.map(function (g) {
          var lineas = 0, listas = 0;
          g.els.forEach(function (e) {
            (e.barras_malas || []).forEach(function (b) { lineas++; if (b.corregido || b.desestimado) listas++; });
            if (e.comentario_suelto) { lineas++; if ((e.accion_estado || 'pendiente') !== 'pendiente') listas++; }
          });
          var marcables = enviada && AUD.estado !== 'cerrada' && AUD.puedo_actuar && g.els.some(function (e) {
            return (e.barras_malas || []).some(function (b) { return !b.corregido && !b.desestimado; });
          });
          return '<tr class="audgrupo"><td colspan="9">' +
            (marcables
              ? '<label><input type="checkbox" data-agrupo="' + esc(g.cc || '') + '" title="Marcar todas las de este código"> ' +
                '<b>' + esc(g.cc || '—') + '</b></label>'
              : '<b>' + esc(g.cc || '—') + '</b>') +
            ' <span class="muted">' + esc(g.descr || '') + '</span>' +
            (g.cubico ? '<span class="revquien">' + esc(String(g.cubico).split('@')[0]) + '</span>' : '') +
            '<span class="muted" style="float:right">' + listas + ' de ' + lineas + ' resuelta(s)</span></td></tr>' +
            g.els.map(function (e) {
              var malas = (e.barras_malas || []);
              if (!malas.length) return filaComentario(e, enviada);
              return malas.map(function (b) { return filaAccion(e, b, enviada); }).join('');
            }).join('');
        }).join('');
      })() + '</tbody></table></div>';
    _bindAcciones(caja);
  }

  // EL BOTÓN «RESUELTO» (20-oct). Era un check «Corregido en aSa» y el sistema iba después
  // a comprobar la barra; el usuario lo cambió por un botón que el auditado aprieta cuando
  // ya hizo el cambio en aSa —verde cuando está marcado, y se vuelve a apretar para
  // deshacerlo—. «Es menos engorroso». La comprobación contra aSa no se perdió: corre al
  // cerrar. Sin RCA no se puede marcar, igual que antes: el backend lo rechaza y acá se
  // apaga y se dice por qué, en vez de dejar que lo aprieten y les salte un error.
  function _btnResuelto(resuelto, sinRca, attr, id) {
    if (resuelto) {
      return '<button class="audbres on" ' + attr + '="' + id + '" title="Marcado como resuelto. ' +
             'Vuelve a apretar si todavía no está cambiado en aSa.">✓ Resuelto</button>';
    }
    return '<button class="audbres' + (sinRca ? ' off' : '') + '" ' + attr + '="' + id + '"' +
           (sinRca ? ' disabled' : '') + ' title="' +
           (sinRca ? 'Primero clasifica por qué pasó (RCA).'
                   : 'Márcalo cuando ya hayas hecho el cambio en aSa. Al cerrar la auditoría ' +
                     'se comprueba contra aSa y, si algo sigue igual, te avisa.') +
           '">Resuelto</button>';
  }

  // EL COMENTARIO DEL ELEMENTO, cuando el hallazgo no es de ninguna barra.
  //
  // «Falta trabas de muro» no se puede colgar de una barra: la barra que falta no está. El
  // auditor lo escribe en el comentario del elemento y antes eso quedaba como un texto
  // muerto —el auditado lo leía y el elemento no se podía cerrar nunca—. Lleva los mismos
  // tres controles que una barra, porque es el mismo trabajo a otra escala.
  function filaComentario(e, enviada) {
    var est = e.accion_estado || 'pendiente';
    var suelto = !!e.comentario_suelto;
    var resuelto = est === 'corregida' || est === 'verificada';
    var nap = est === 'desestimada';
    var puede = !!(suelto && AUD.puedo_actuar && enviada && AUD.estado !== 'cerrada');
    var sinRca = !e.causa;
    var estado = nap
      ? '<span class="auddes" title="' + esc(e.accion_nota || '') + '">No aplica</span>'
      : resuelto
        ? '<span class="audacc1 corregida">Resuelto</span>'
        : '<span class="audacc1 pendiente">Por resolver</span>';
    estado += _porOtro(e.resuelto_por_otro);
    var acc = '';
    if (puede) {
      acc = '<div class="revseg">' +
              '<button class="' + (nap ? '' : 'on') + '" data-eaplica="' + e.id + '"' +
                (nap ? '' : ' disabled') +
                ' title="El comentario es válido y hay que resolverlo">Aplica</button>' +
              '<button class="' + (nap ? 'on' : '') + '" data-enoaplica="' + e.id + '"' +
                ' title="Dejar sin efecto, con explicación firmada">No aplica</button>' +
            '</div>' +
            (nap ? '' : _btnResuelto(resuelto, sinRca, resuelto ? 'data-edeshacer' : 'data-ecorregi', e.id));
    }
    // EL RCA SE APAGA EN «NO APLICA» (20-oct): un hallazgo que no correspondía no tiene causa
    // que clasificar, y si la tenía el backend la quitó para que no pese en el indicador de causas de la auditoría (que es interno: NO es el Pareto de los reclamos y no se mezcla con él).
    var causa = nap
      ? '<span class="muted" title="Sin efecto: no lleva RCA.">—</span>'
      : e.causa
        ? '<button class="audmini" data-ecausa="' + e.id + '"' + (puede ? '' : ' disabled') +
          ' title="' + esc(e.causa + (e.causa_texto ? ' · ' + e.causa_texto : '')) + '">' +
          esc(e.causa) + (puede ? ' ✎' : '') + '</button>'
        : (puede
            ? '<button class="audmini sinc" data-ecausa="' + e.id +
              '" title="Por qué pasó, en la matriz Ishikawa. Sin esto no se puede dar por ' +
              'resuelto.">RCA</button>'
            : '<span class="muted">sin RCA</span>');
    return '<tr' + (est === 'desestimada' ? ' class="audeses"' : '') + '>' +
      '<td></td>' +
      '<td><span class="audref" title="Este hallazgo no es de una barra en particular: es ' +
        'del elemento.">elemento</span></td>' +
      '<td></td>' +
      '<td class="audnom" title="' + esc(nombreCompleto(e)) + '">' + esc(nombreCompleto(e)) + '</td>' +
      '<td class="audqse" colspan="2">' + esc(e.texto || '') + '</td>' +
      '<td>' + causa + '</td>' +
      '<td>' + estado + '</td>' +
      '<td>' + acc + '</td></tr>' +
      '<tr class="audnapform" data-eform="' + e.id + '" style="display:none">' +
        '<td colspan="9"><div class="revnapcaja">' +
          '<input type="text" data-emotivo="' + e.id + '" ' +
            'placeholder="¿Por qué no corresponde? Lo lee quien auditó y queda firmado">' +
          '<button class="audmini ver" data-enapok="' + e.id + '">Guardar</button>' +
          '<button class="audmini" data-enapno="' + e.id + '">Cancelar</button>' +
        '</div></td></tr>';
  }

  // UNA BARRA DE LA AUDITORÍA, con lo que se puede hacer con ella.
  //
  //   Aplica | No aplica   — el par se lee como un interruptor: lo encendido es lo que
  //                          vale hoy. «No aplica» pide el motivo ahí mismo y queda
  //                          firmado; es lo que el usuario llamó «dejar sin efecto».
  //   Por qué pasó         — abre la matriz Ishikawa de esta barra, no del elemento.
  //   Ya la corregí        — la declara corregida. Comprobarlo es del sistema, que vuelve
  //                          a pedirle la barra a aSa: nadie marca «verificada» a mano.
  // QUIÉN LO RESOLVIÓ EN LUGAR DEL DUEÑO (21-oct). Cualquier cubicador puede resolver lo
  // ajeno —el dueño recibe aviso—, y la fila lo dice para que el rastro esté a la vista.
  function _porOtro(correo) {
    if (!correo) return '';
    return ' <span class="audporotro" title="Lo resolvió otra persona en lugar de quien cubicó; ' +
           'a quien cubicó le llegó aviso.">por ' + esc(correo.split('@')[0]) + '</span>';
  }

  function filaAccion(e, b, enviada) {
    var cerrada = AUD.estado === 'cerrada';
    // Cualquier cubicador puede resolver (21-oct); al dueño le llega aviso. Lo dice el backend.
    var puede = !!(AUD.puedo_actuar && enviada && !cerrada);
    var estado = b.desestimado
      ? '<span class="auddes" title="' + esc(b.desestimado_motivo || '') + '">No aplica</span>'
      : b.objecion
        ? '<span class="audacc1 pendiente" title="' + esc(b.objecion) + '">Descarte no aceptado</span>'
        : b.corregido
          ? '<span class="audacc1 corregida">Resuelto</span>'
          : '<span class="audacc1 pendiente">Por resolver</span>';
    estado += _porOtro(b.resuelto_por_otro);
    var acc = '';
    if (puede) {
      var sinRca = !b.causa;
      acc = '<div class="revseg">' +
              '<button class="' + (b.desestimado ? '' : 'on') + '" data-aplica="' + b.item_id + '"' +
                (b.desestimado ? '' : ' disabled') +
                ' title="El hallazgo es válido y hay que corregir la barra">Aplica</button>' +
              '<button class="' + (b.desestimado ? 'on' : '') + '" data-noaplica="' + b.item_id + '"' +
                ' title="Dejar sin efecto, con explicación firmada">No aplica</button>' +
            '</div>' +
            (b.desestimado ? '' :
              _btnResuelto(!!b.corregido, sinRca, b.corregido ? 'data-deshacer' : 'data-corregi', b.item_id));
    } else if (b.desestimado && AUD.soy_auditor && !cerrada) {
      // Derecho a réplica del auditor: el descarte vale por defecto, pero si no
      // corresponde lo reabre dejando por escrito por qué.
      acc = '<button class="audmini" data-objetar="' + b.item_id + '" title="Reabre esta ' +
            'barra: el descarte no se acepta. Queda registrado y le llega a quien cubicó.">No lo acepto</button>';
    }
    // RCA = análisis de causa raíz. El usuario lo llama así y es como se llama en la
    // norma; «Clasificar» no decía qué se estaba clasificando.
    //
    // Y SE APAGA EN «NO APLICA» (20-oct): un hallazgo que no correspondía no tiene causa
    // que clasificar, y si la tenía el backend la quitó para que no pese en el indicador de causas de la auditoría (que es interno: NO es el Pareto de los reclamos y no se mezcla con él).
    var causa = b.desestimado
      ? '<span class="muted" title="Sin efecto: no lleva RCA.">—</span>'
      : b.causa
        ? '<button class="audmini" data-causa="' + b.item_id + '"' + (puede && !b.corregido ? '' : ' disabled') +
          ' title="' + esc(b.causa + (b.causa_texto ? ' · ' + b.causa_texto : '')) + '">' +
          esc(b.causa) + (puede && !b.corregido ? ' ✎' : '') + '</button>'
        : (puede
            ? '<button class="audmini sinc" data-causa="' + b.item_id +
              '" title="Por qué pasó, en la matriz Ishikawa. Sin esto no se puede dar la ' +
              'barra por resuelta.">RCA</button>'
            : '<span class="muted">sin RCA</span>');
    var cols = 9;
    return '<tr' + (b.desestimado ? ' class="audeses"' : '') + '>' +
      '<td>' + (puede && !b.corregido && !b.desestimado
        ? '<input type="checkbox" data-aitem="' + b.item_id + '" data-acc="' + esc(e.cc || '') + '"' +
          (SEL_AUD[b.item_id] ? ' checked' : '') + ' title="Marcar para resolver varias de una vez">'
        : '') + '</td>' +
      '<td><span class="audref">' + esc(b.ref || b.marca || '') + '</span></td>' +
      '<td class="revfig" data-afig="' + esc(b.ref || '') + '" data-acc="' + esc(e.cc || '') + '">' +
        _figAud(e.cc, b.ref) + '</td>' +
      '<td class="audnom" title="' + esc(nombreCompleto(e)) + '">' + esc(nombreCompleto(e)) + '</td>' +
      '<td class="audqse">' + esc(b.observacion || '') +
        (b.desestimado && b.desestimado_motivo
          ? '<div class="muted" style="font-size:10px">no aplica: ' + esc(b.desestimado_motivo) +
            (b.desestimado_por ? ' — ' + esc(b.desestimado_por.split('@')[0]) : '') + '</div>'
          : '') + '</td>' +
      '<td class="audesp">' + esc(_esperadoTxt(b.esperado)) + '</td>' +
      '<td class="audcausa">' + causa + '</td>' +
      '<td>' + estado + '</td>' +
      '<td class="audacc2">' + acc + '</td></tr>' +
      '<tr class="audnapform" data-form="' + b.item_id + '" style="display:none">' +
        '<td colspan="' + cols + '"><div class="revnapcaja">' +
          '<select data-mot="' + b.item_id + '">' + _opcionesMotivoAud() + '</select>' +
          '<input type="text" data-motivo="' + b.item_id + '" ' +
            'placeholder="¿Por qué no corresponde? Lo lee quien auditó y queda firmado">' +
          '<button class="audmini ver" data-napok="' + b.item_id + '">Guardar</button>' +
          '<button class="audmini" data-napno="' + b.item_id + '">Cancelar</button>' +
        '</div></td></tr>';
  }

  // LAS FIGURAS DE LA AUDITORÍA. Mismo trato que en la revisión de barras: se piden POR
  // CÓDIGO —una lectura sirve a todas sus barras— y sólo cuando alguien las pide, porque
  // cada una son un par de segundos contra aSa.
  var AFIGS = {};
  // Si la muestra del auditor está desplegada DESPUÉS del envío (antes está siempre).
  var MUESTRA_ABIERTA = false;
  // Las barras marcadas con el check para resolverlas de a muchas (21-oct).
  var SEL_AUD = {};
  function _figAud(cc, ref) {
    var c = AFIGS[cc];
    if (!c) return '';
    if (c.estado === 'cargando') return '<span class="muted">…</span>';
    if (c.estado === 'error') return '<span class="muted" title="' + esc(c.msg || '') + '">sin dibujo</span>';
    var b = c.barras[ref] || c.barras[String(ref).split('#')[0]];
    if (!b) return '<span class="muted">ya no está</span>';
    if (!global.audCeldaFigura) return '';
    try {
      var f = normalizarBarra(b, 'asa');
      return celdaFigura(f) + global.audGrillaLados(f, null, esc);
    } catch (err) { return '<span class="muted">—</span>'; }
  }

  async function cargarFigurasAud(boton) {
    var ccs = [];
    (AUD.elementos || []).forEach(function (e) {
      if ((e.barras_malas || []).length && e.cc && !AFIGS[e.cc] && ccs.indexOf(e.cc) === -1) {
        ccs.push(e.cc);
      }
    });
    if (!ccs.length) return;
    if (boton) boton.disabled = true;
    for (var i = 0; i < ccs.length; i++) {
      if (boton) boton.textContent = 'Leyendo aSa… ' + (i + 1) + ' de ' + ccs.length;
      AFIGS[ccs[i]] = { estado: 'cargando', barras: {} };
      try {
        var d = await req('GET', '/auditorias/elemento-asa?cc=' + encodeURIComponent(ccs[i]));
        var ix = {};
        (d.barras || []).forEach(function (b) {
          if (b.ref) ix[b.ref] = b;
          if (b.marca && !ix[b.marca]) ix[b.marca] = b;
        });
        AFIGS[ccs[i]] = { estado: 'listo', barras: ix };
      } catch (err) { AFIGS[ccs[i]] = { estado: 'error', barras: {}, msg: err.message }; }
    }
    pintarAcciones();
  }

  function _bindAcciones(caja) {
    var f = $('audFigs');
    if (f) f.addEventListener('click', function () { cargarFigurasAud(f); });
    if (global.audChipsTam) global.audChipsTam('audTam', pintarAcciones);
    var cz = $('audBtnCerrarOk');
    // Sin el evento como argumento: `cerrarResueltas(confirmar)` lo leía como «confirmar».
    if (cz) cz.addEventListener('click', function () { cerrarResueltas(false); });
    caja.querySelectorAll('input[data-aitem]').forEach(function (c) {
      c.addEventListener('change', function () {
        if (c.checked) SEL_AUD[c.dataset.aitem] = true; else delete SEL_AUD[c.dataset.aitem];
        pintarAcciones();
      });
    });
    caja.querySelectorAll('input[data-agrupo]').forEach(function (c) {
      c.addEventListener('change', function () {
        caja.querySelectorAll('input[data-aitem][data-acc="' + c.dataset.agrupo + '"]').forEach(function (x) {
          if (c.checked) SEL_AUD[x.dataset.aitem] = true; else delete SEL_AUD[x.dataset.aitem];
        });
        pintarAcciones();
      });
    });
    caja.querySelectorAll('button[data-alote]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.alote === 'no_aplica') {
          $('audLoteNap').style.display = 'flex'; b.classList.add('eligiendo'); $('audLoteNota').focus();
        } else { loteAuditoria(b.dataset.alote); }
      });
    });
    var lno = $('audLoteNo');
    if (lno) lno.addEventListener('click', function () { $('audLoteNap').style.display = 'none'; });
    var lok = $('audLoteOk');
    if (lok) lok.addEventListener('click', function () { loteAuditoria('no_aplica'); });
    var lnota = $('audLoteNota');
    if (lnota) lnota.addEventListener('keydown', function (e) { if (e.key === 'Enter') loteAuditoria('no_aplica'); });
    caja.querySelectorAll('button[data-objetar]').forEach(function (b) {
      b.addEventListener('click', function () { objetar(b.dataset.objetar); });
    });
    caja.querySelectorAll('button[data-causa]').forEach(function (b) {
      b.addEventListener('click', function () { clasificarItem(b.dataset.causa); });
    });
    caja.querySelectorAll('button[data-corregi]').forEach(function (b) {
      b.addEventListener('click', function () { corregirItem(b.dataset.corregi, true, b); });
    });
    caja.querySelectorAll('button[data-deshacer]').forEach(function (b) {
      b.addEventListener('click', function () { corregirItem(b.dataset.deshacer, false, b); });
    });
    caja.querySelectorAll('button[data-aplica]').forEach(function (b) {
      b.addEventListener('click', function () { desestimarItem(b.dataset.aplica, false); });
    });
    caja.querySelectorAll('button[data-noaplica]').forEach(function (b) {
      b.addEventListener('click', function () { _formNap(b.dataset.noaplica, true); });
    });
    caja.querySelectorAll('button[data-napno]').forEach(function (b) {
      b.addEventListener('click', function () { _formNap(b.dataset.napno, false); });
    });
    caja.querySelectorAll('button[data-napok]').forEach(function (b) {
      b.addEventListener('click', function () { _guardarNap(b.dataset.napok); });
    });
    caja.querySelectorAll('input[data-motivo]').forEach(function (i) {
      i.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') _guardarNap(i.dataset.motivo);
      });
    });
    // Los mismos cuatro verbos sobre el comentario del elemento.
    caja.querySelectorAll('button[data-ecausa]').forEach(function (b) {
      b.addEventListener('click', function () { clasificarComentario(b.dataset.ecausa); });
    });
    caja.querySelectorAll('button[data-ecorregi]').forEach(function (b) {
      b.addEventListener('click', function () {
        resolverElemento(b.dataset.ecorregi, { aplica: true, corregido: true }, b);
      });
    });
    caja.querySelectorAll('button[data-edeshacer]').forEach(function (b) {
      b.addEventListener('click', function () {
        resolverElemento(b.dataset.edeshacer, { aplica: true, corregido: false }, b);
      });
    });
    caja.querySelectorAll('button[data-eaplica]').forEach(function (b) {
      b.addEventListener('click', function () {
        resolverElemento(b.dataset.eaplica, { aplica: true, corregido: false }, b);
      });
    });
    caja.querySelectorAll('button[data-enoaplica]').forEach(function (b) {
      b.addEventListener('click', function () { _formNapE(b.dataset.enoaplica, true); });
    });
    caja.querySelectorAll('button[data-enapno]').forEach(function (b) {
      b.addEventListener('click', function () { _formNapE(b.dataset.enapno, false); });
    });
    caja.querySelectorAll('button[data-enapok]').forEach(function (b) {
      b.addEventListener('click', function () { _guardarNapE(b.dataset.enapok); });
    });
    caja.querySelectorAll('input[data-emotivo]').forEach(function (i) {
      i.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') _guardarNapE(i.dataset.emotivo);
      });
    });
  }

  function _opcionesMotivoAud() {
    var m = (AUD && AUD.motivos) || {};
    return '<option value="">¿Por qué no aplica?</option>' +
      Object.keys(m).map(function (k) { return '<option value="' + esc(k) + '">' + esc(m[k]) + '</option>'; }).join('');
  }

  // VARIAS BARRAS, UN VERBO (21-oct). Un solo viaje y un solo detalle al final.
  async function loteAuditoria(accion) {
    var ids = Object.keys(SEL_AUD).map(Number);
    if (!ids.length) return;
    var cuerpo = { ids: ids, accion: accion };
    if (accion === 'no_aplica') {
      cuerpo.motivo_tipo = $('audLoteMot').value;
      cuerpo.nota = ($('audLoteNota').value || '').trim();
      if (!cuerpo.motivo_tipo) { aviso('Elige por qué no aplican.'); return; }
      if (cuerpo.nota.length < 10) { aviso('Hace falta la explicación: la lee quien auditó.'); return; }
    }
    var b = document.querySelector('#audLote button[data-alote="' + accion + '"]');
    _ocupado(b, true);
    try {
      AUD = await req('PUT', '/auditorias/' + AUD.id + '/items/lote', cuerpo);
      ok({ resuelto: 'Resueltas', no_aplica: 'Sin efecto', aplica: 'Vuelven a quedar por resolver' }[accion] +
         ': ' + ids.length);
      SEL_AUD = {};
      await Promise.all([cargarLista(), cargarMisAcciones()]); pintarDetalle();
    } catch (e) { aviso(e.message); _ocupado(b, false); }
  }

  function _formNap(itemId, abrir) {
    var f = document.querySelector('tr[data-form="' + itemId + '"]');
    if (!f) return;
    f.style.display = abrir ? '' : 'none';
    if (abrir) {
      var i = f.querySelector('input[data-motivo]');
      if (i) i.focus();
    }
  }

  function _guardarNap(itemId) {
    var f = document.querySelector('tr[data-form="' + itemId + '"]');
    if (!f) return;
    var sel = f.querySelector('select[data-mot]');
    var tipo = sel ? sel.value : '';
    var m = (f.querySelector('input[data-motivo]').value || '').trim();
    if (!tipo) { aviso('Elige por qué no aplica.'); return; }
    if (m.length < 10) { aviso('Di por qué no corresponde: lo va a leer quien auditó.'); return; }
    desestimarItem(itemId, true, m, tipo);
  }

  // DEJAR SIN EFECTO UNA BARRA, o volverla a dejar válida. El motivo es obligatorio y es
  // todo el valor de esto: sin él, dentro de un mes nadie sabe si estaba bien o si alguien
  // la apagó para sacársela de encima.
  // MIENTRAS EL SERVIDOR RESPONDE, EL BOTÓN LO DICE. Sin esto quedaban «pegados»: el
  // clic no cambiaba nada a la vista y la gente apretaba de nuevo.
  function _ocupado(el, si) {
    if (!el) return;
    el.disabled = !!si;
    el.classList.toggle('audwait', !!si);
  }

  function _botonDe(sel) { return document.querySelector(sel); }

  async function desestimarItem(itemId, desestimar, motivo, motivoTipo) {
    var bt = _botonDe('[data-' + (desestimar ? 'noaplica' : 'aplica') + '="' + itemId + '"]');
    _ocupado(bt, true);
    try {
      AUD = await req('PUT', '/auditorias/' + AUD.id + '/items/' + itemId + '/desestimar',
                      { desestimado: !!desestimar, motivo: motivo || 'Vuelve a quedar por corregir.',
                        motivo_tipo: motivoTipo || null });
      ok(desestimar ? 'Barra dejada sin efecto' : 'La barra vuelve a quedar por corregir');
      await Promise.all([cargarLista(), cargarMisAcciones()]); pintarDetalle();
    } catch (e) { aviso(e.message); _ocupado(bt, false); }
  }

  // DECLARAR QUE SE CORRIGIÓ. Se pregunta CÓMO, y no es burocracia: si se corrigió la
  // misma barra el sistema puede ir a mirarla en aSa, y si se rehizo en otro código NO
  // puede —la barra vieja va a seguir diciendo lo mismo para siempre—.
  // UN CLIC, SIN PREGUNTAS (20-oct). Antes preguntaba si se rehízo en un código nuevo y cuál,
  // porque de eso vivía la comprobación barra por barra. Ahora la comprobación corre al
  // cerrar y avisa sin bloquear: si la barra se rehízo en otro código, aSa va a decir que
  // la vieja sigue igual, el aviso lo va a mostrar y quien cierra lo confirma. Dos
  // preguntas por barra para cubrir ese caso era justo lo «engorroso» que se quiso sacar.
  async function corregirItem(itemId, corregido, control) {
    _ocupado(control, true);
    try {
      AUD = await req('PUT', '/auditorias/' + AUD.id + '/items/' + itemId + '/correccion',
                      { corregido: !!corregido, tipo: 'item' });
      ok(corregido ? 'Resuelto' : 'Vuelve a quedar por resolver');
      await Promise.all([cargarLista(), cargarMisAcciones()]); pintarDetalle();
    } catch (e) {
      aviso(e.message);
      _ocupado(control, false);
    }
  }

  // CERRAR, cuando no queda ninguna barra pendiente. Lo aprieta quien respondió.
  // CERRAR VA A aSa (20-oct). Al apretar, el servidor vuelve a pedirle a aSa cada barra que
  // se marcó resuelta. Si alguna sigue como estaba, contesta 409 con la lista y acá se le
  // muestra a quien cierra; puede confirmar igual —«en ese warning igual el cubicador puede
  // confirmar y queda trazabilidad»— y entonces se vuelve a llamar con confirmar=true. Lo
  // que aSa dijo queda guardado en la auditoría de todos modos.
  async function cerrarResueltas(confirmar) {
    var b = $('audBtnCerrarOk');
    _ocupado(b, true);
    if (b) b.textContent = confirmar ? 'Cerrando…' : 'Comprobando en aSa…';
    try {
      AUD = await req('POST', '/auditorias/' + AUD.id + '/cerrar-resueltas' +
                              (confirmar ? '?confirmar=true' : ''), {});
      ok('Auditoría cerrada');
      await Promise.all([cargarLista(), cargarMisAcciones()]); await cargarIndicadores(); pintarDetalle();
    } catch (e) {
      var det = e.detalle || e.detail || null;
      if (e.status === 409 && det && det.motivo === 'sigue_igual') {
        _ocupado(b, false);
        if (b) b.textContent = 'Cerrar la auditoría';
        _avisoCierre(det);
        return;
      }
      aviso(e.message);
      _ocupado(b, false);
      if (b) b.textContent = 'Cerrar la auditoría';
    }
  }

  // EL AVISO DEL CIERRE: qué barras siguen igual en aSa, y dos salidas. No es un
  // confirm() pelado porque hay que poder leer la lista.
  function _avisoCierre(det) {
    var caja = $('audAcciones');
    var viejo = $('audCierreAviso');
    if (viejo) viejo.remove();
    var div = document.createElement('div');
    div.id = 'audCierreAviso';
    div.className = 'audnota audcierre';
    div.innerHTML = '<b>' + esc(det.mensaje) + '</b>' +
      '<ul>' + (det.barras || []).map(function (x) {
        return '<li><span class="audref">' + esc(x.ref) + '</span> ' + esc(x.porque || '') + '</li>';
      }).join('') + '</ul>' +
      '<div class="audenviop">' +
        '<button class="audmini" id="audCierreNo">Volver a revisar</button>' +
        '<button class="audenviar" id="audCierreSi" title="Cierra igual. Queda registrado qué ' +
        'barras seguían como estaban en aSa y que lo confirmaste tú.">Cerrar igual</button>' +
      '</div>';
    caja.insertBefore(div, caja.firstChild);
    div.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('audCierreNo').addEventListener('click', function () { div.remove(); });
    $('audCierreSi').addEventListener('click', function () { div.remove(); cerrarResueltas(true); });
  }

  // LA MATRIZ ISHIKAWA DE UNA BARRA. Es la MISMA matriz de los reclamos, con la misma
  // función: el modal lee la selección de `audIshikawa` y devuelve la elegida por
  // `audCausaElegida`. Tener dos matrices es tenerlas desincronizadas.
  function clasificarItem(itemId) {
    var b = null, el = null;
    (AUD.elementos || []).forEach(function (e) {
      (e.barras_malas || []).forEach(function (x) {
        if (String(x.item_id) === String(itemId)) { b = x; el = e; }
      });
    });
    if (!b) return;
    if (typeof global.abrirIshikawaModal !== 'function') {
      aviso('No se pudo abrir la matriz de causas. Recarga la página.');
      return;
    }
    CAUSA_DE = { auditoria_id: AUD.id, item_id: b.item_id, causa: b.causa,
                 causa_categoria: b.causa_categoria, causa_texto: b.causa_texto,
                 ref: b.ref, elemento: el && el.nombre };
    global.abrirIshikawaModal('auditoria');
  }

  // LO MISMO, PARA EL COMENTARIO DEL ELEMENTO. Un solo endpoint recibe las tres cosas
  // —aplica, causa, corregido— porque en el elemento no hay nada que comprobar en aSa
  // barra por barra: lo que hay es un dicho del auditado, y va en una sola escritura.
  async function resolverElemento(eid, cuerpo, control) {
    _ocupado(control, true);
    try {
      AUD = await req('PUT', '/auditorias/' + AUD.id + '/elementos/' + eid + '/resolucion', cuerpo);
      ok(cuerpo.aplica === false ? 'Comentario dejado sin efecto'
                                 : (cuerpo.corregido ? 'Comentario dado por resuelto'
                                                     : 'Vuelve a quedar por resolver'));
      await Promise.all([cargarLista(), cargarMisAcciones()]); pintarDetalle();
    } catch (e) {
      aviso(e.message);
      if (control && control.type === 'checkbox') control.checked = !cuerpo.corregido;
      _ocupado(control, false);
    }
  }

  function _formNapE(eid, abrir) {
    var f = document.querySelector('tr[data-eform="' + eid + '"]');
    if (!f) return;
    f.style.display = abrir ? '' : 'none';
    if (abrir) {
      var i = f.querySelector('input[data-emotivo]');
      if (i) i.focus();
    }
  }

  function _guardarNapE(eid) {
    var f = document.querySelector('tr[data-eform="' + eid + '"]');
    if (!f) return;
    var m = (f.querySelector('input[data-emotivo]').value || '').trim();
    if (m.length < 10) { aviso('Di por qué no corresponde: lo va a leer quien auditó.'); return; }
    resolverElemento(eid, { aplica: false, nota: m },
                     _botonDe('[data-enapok="' + eid + '"]'));
  }

  function clasificarComentario(eid) {
    var el = (AUD.elementos || []).filter(function (x) { return String(x.id) === String(eid); })[0];
    if (!el) return;
    if (typeof global.abrirIshikawaModal !== 'function') {
      aviso('No se pudo abrir la matriz de causas. Recarga la página.');
      return;
    }
    CAUSA_DE = { auditoria_id: AUD.id, elemento_id: el.id, causa: el.causa,
                 causa_categoria: el.causa_categoria, causa_texto: el.causa_texto,
                 elemento: el.nombre };
    global.abrirIshikawaModal('auditoria');
  }

  async function objetar(itemId) {
    var m = global.prompt('¿Por qué no aceptas el descarte de esta barra?\n' +
                          'Vuelve a quedar abierta y le llega a quien cubicó.');
    if (m === null) return;
    if (m.trim().length < 10) { aviso('Hace falta el motivo: lo va a leer quien cubicó.'); return; }
    try {
      AUD = await req('PUT', '/auditorias/' + AUD.id + '/items/' + itemId + '/objecion',
                      { motivo: m });
      ok('Descarte no aceptado: la barra vuelve a estar abierta');
      await Promise.all([cargarLista(), cargarMisAcciones()]); pintarDetalle();
    } catch (e) { aviso(e.message); }
  }

  // CUÁNTO DE LA OBRA SE HA MIRADO, contando TODAS sus auditorías. Un cuadrito por
  // elemento (o por código, en aSa): gris lo no auditado, color según cómo salió. Es la
  // respuesta a «qué falta», que una auditoría suelta no da.
  // MIS CORRECCIONES, BARRA POR BARRA (8-oct).
  //
  // Antes era una fila por ELEMENTO con un botón «Ya la corregí». Un elemento son cuatro,
  // trece o ciento cincuenta barras: si dos salían mal y se arreglaba una, no había forma
  // de decirlo, y el botón era una declaración sin respaldo —no decía qué se hizo ni
  // dónde—. El usuario lo fijó: «el hallazgo es por ITEM siempre; la corrección también».
  //
  // QUÉ CAMBIA DE RESPONSABLE. El auditor ya no verifica: declara el hallazgo y ahí
  // termina. El auditado declara que corrigió, y lo COMPRUEBA EL SISTEMA volviendo a
  // pedirle la barra a aSa. Por eso acá no hay ningún botón de «verificar».
  function _esperadoTxt(esp) {
    var k = Object.keys(esp || {});
    if (!k.length) return '';
    return k.map(function (x) { return x + ' = ' + esp[x]; }).join(' · ');
  }

  async function cargarMisAcciones() {
    var caja = $('audMias');
    if (!caja) return;
    try {
      MIAS = await req('GET', '/auditorias/mias/items');
      MIS = (MIAS && MIAS.items) || [];
      pintarMias();
    } catch (e) { caja.style.display = 'none'; }
  }

  function pintarMias() {
    var caja = $('audMias');
    var d = MIAS || {};
    if (!caja) return;
    {
      if (!MIS.length) { caja.style.display = 'none'; return; }
      caja.style.display = '';
      var pend = d.pendientes || 0, venc = d.vencidas || 0, sinc = d.sin_causa || 0;
      var des = d.desestimadas || 0;
      caja.innerHTML = '<div class="audh">Mis correcciones <span class="muted">' +
        (pend ? pend + ' barra(s) por corregir' : 'todas resueltas') +
        (sinc ? ' · ' + sinc + ' sin clasificar' : '') +
        (des ? ' · ' + des + ' desestimada(s)' : '') +
        (venc ? ' · <b style="color:#c62828">' + venc + ' fuera de plazo</b>' : '') +
        ' · salieron de una auditoría de tu cubicación. Lo que corrijas lo comprueba el ' +
        'sistema contra aSa: nadie tiene que verificarlo a mano.</span></div>' +
        '<table class="audt audacct"><thead><tr><th>Auditoría</th><th>Código</th><th>Elemento</th>' +
        '<th>Barra</th><th>Qué encontró el auditor</th><th>Debería decir</th>' +
        '<th title="Por qué pasó. La clasificas tú, que es quien sabe: el auditor sólo vio ' +
        'el síntoma.">Por qué pasó</th><th>Plazo</th>' +
        '<th>Estado</th><th></th></tr></thead><tbody>' +
        MIS.map(filaMia).join('') + '</tbody></table>';
      _bindMias(caja);
      if (RESOLVIENDO) _bindResolver();
    }
  }

  function _bindResolver() {
    var caja = $('audMias');
    caja.querySelectorAll('input[name=audres]').forEach(function (r) {
      r.addEventListener('change', function () {
        $('audResMsg').innerHTML = r.value === 'desestimar' && r.checked
          ? '<b style="color:#e65100">El auditor va a recibir el aviso y queda registrado ' +
            'que no se consideró lo auditado.</b>'
          : '';
      });
    });
    var ok1 = $('audResOk');
    if (ok1) ok1.addEventListener('click', function () { guardarResolver(RESOLVIENDO); });
    var no = $('audResNo');
    if (no) no.addEventListener('click', function () { RESOLVIENDO = null; pintarMias(); });
  }

  function _bindMias(caja) {
    caja.querySelectorAll('button[data-abrir]').forEach(function (b) {
      b.addEventListener('click', function () { abrirResolver(b.dataset.abrir); });
    });
    caja.querySelectorAll('button[data-deshacer]').forEach(function (b) {
      b.addEventListener('click', function () { deshacerMia(b.dataset.deshacer); });
    });
    caja.querySelectorAll('button[data-causa]').forEach(function (b) {
      b.addEventListener('click', function () { clasificarMia(b.dataset.causa); });
    });
  }

  // EL ESTADO DE UNA BARRA, como lo ve quien la tiene que arreglar. Tres cosas distintas y
  // no se mezclan: lo que la persona DECLARÓ, lo que el sistema COMPROBÓ, y el desestimado.
  function _estadoMia(a) {
    if (a.desestimado) {
      return '<span class="auddes" title="No corresponde, según quien cubicó: ' +
             esc(a.desestimado_motivo || '') + '">Desestimada</span>';
    }
    if (a.objecion) {
      return '<span class="audacc1 pendiente" title="El auditor no aceptó tu descarte: ' +
             esc(a.objecion) + (a.objecion_por ? ' (' + esc(a.objecion_por.split('@')[0]) + ')' : '') +
             '">Descarte no aceptado</span>';
    }
    if (!a.corregido) return '<span class="audacc1 pendiente">Pendiente</span>';
    if (a.verificado === 'ok') {
      return '<span class="audacc1 verificada" title="' +
             esc(a.verificado_porque || 'El sistema volvió a mirar la barra en aSa y ya no está mal.') +
             '">Resuelto</span>';
    }
    if (a.verificado === 'sigue_igual') {
      return '<span class="audacc1 pendiente" title="' +
             esc(a.verificado_porque || '') +
             '">Sigue igual en aSa</span>';
    }
    // Declarada y todavía sin comprobar: el reloj la mira esta noche, o se pide a mano.
    return '<span class="audacc1 corregida" title="Declarada corregida. El sistema la va a ' +
           'mirar en aSa' + (a.comprobable ? '.' : ', pero esta barra se auditó sin registrar ' +
           'con qué comparar, así que la comprobación no va a poder decir nada.') + '">Corregida</span>';
  }

  // CUÁNTO FALTA, no sólo cuándo vence. Con un plazo de 24 horas, «10-10» no dice nada:
  // lo que la persona necesita saber es si le quedan seis horas o si ya se le pasó.
  function _cuantoFalta(vence, vencido) {
    if (!vence) return '<span class="muted">—</span>';
    var d = new Date(vence);
    var cuando = ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
                 ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    var horas = Math.round((d - new Date()) / 3600000);
    if (vencido) return cuando + ' <b>vencido</b>';
    if (horas <= 0) return cuando;
    return cuando + ' <span class="muted">(' +
           (horas < 24 ? horas + ' h' : Math.round(horas / 24) + ' d') + ')</span>';
  }

  function filaMia(a) {
    var est = _estadoMia(a);
    return '<tr' + (a.desestimado ? ' class="audeses"' : (a.vencido ? ' class="audvenc"' : '')) + '>' +
      '<td class="cc">' + esc(a.codigo) + '</td>' +
      '<td class="cc">' + esc(a.cc || '') +
        // LO URGENTE PRIMERO: si el código ya entró a fabricación, esta barra se arregla
        // ahora. Es el dato que decide por cuál empezar, así que va pegado al código.
        (a.fabricando ? ' <span class="audfab" title="Este código ya entró a fabricación: ' +
                        'la barra se está cortando.">EN FÁBRICA</span>' : '') +
        (a.despachado ? ' <span class="audfab" style="background:#6d4c41" title="Este código ' +
                        'ya se despachó: la corrección llega tarde, pero hay que dejarla registrada.">DESPACHADO</span>' : '') +
        '</td>' +
      '<td class="audnom" title="' + esc(a.elemento) + '">' + esc(a.elemento) + '</td>' +
      '<td><span class="audref">' + esc(a.ref) + '</span></td>' +
      '<td>' + esc(a.observacion || '') + '</td>' +
      '<td class="audesp">' + esc(_esperadoTxt(a.esperado)) + '</td>' +
      '<td class="audcausa">' + (a.causa
          ? '<button class="audmini" data-causa="' + a.item_id + '" title="' +
            esc(a.causa + (a.causa_texto ? ' · ' + a.causa_texto : '')) + '">' +
            esc(a.causa) + ' ✎</button>'
          : '<button class="audmini sinc" data-causa="' + a.item_id +
            '" title="Elige en la matriz Ishikawa por qué pasó.">Clasificar</button>') + '</td>' +
      '<td' + (a.vencido ? ' style="color:#c62828;font-weight:700"' : '') + '>' +
        _cuantoFalta(a.vence, a.vencido) + '</td>' +
      '<td>' + est + (a.nota_correccion
          ? ' <span class="muted" title="' + esc(a.nota_correccion) + '">✎</span>' : '') +
        (a.tipo_correccion === 'nuevo'
          ? ' <span class="muted" style="font-size:9px" title="Se rehízo en otro código">CC ' +
            esc(a.cc_nuevo || 'nuevo') + (a.item_nuevo ? ' · ' + esc(a.item_nuevo) : '') + '</span>' : '') +
        '</td>' +
      '<td>' + ((a.corregido || a.desestimado)
          ? '<button class="audmini" data-deshacer="' + a.item_id + '">Deshacer</button>'
          : '<button class="audmini ver" data-abrir="' + a.item_id + '">Resolver</button>')
      + '</td></tr>' +
      (RESOLVIENDO === String(a.item_id) ? _panelResolver(a) : '');
  }

  // ══════ RESOLVER UNA BARRA ══════
  // Tres caminos, y los tres a la vista en vez de encadenados en confirm() y prompt() como
  // estaban antes: con los diálogos del navegador no se veía qué se estaba eligiendo, no
  // se podía volver atrás y el campo del código nuevo aparecía sin contexto.
  //
  //   · CORREGÍ ESTE MISMO CÓDIGO  → el sistema va a mirar esta barra en aSa.
  //   · QUEDÓ EN OTRO CÓDIGO       → hay que decir cuál y con qué marca, porque la barra
  //                                  vieja va a seguir diciendo lo mismo para siempre y
  //                                  mirarla diría que no se corrigió.
  //   · NO CORRESPONDE             → el criterio del auditor no aplica. Con motivo
  //                                  obligatorio: es todo el valor de desestimar.
  function _panelResolver(a) {
    var cols = 10;
    return '<tr class="audresol"><td></td><td colspan="' + (cols - 1) + '">' +
      '<div class="audresolc">' +
        '<div class="audresolq"><b>' + esc(a.ref) + '</b> · ' + esc(a.observacion || '') +
          (_esperadoTxt(a.esperado) ? ' · <span class="audesp">debería decir ' +
            esc(_esperadoTxt(a.esperado)) + '</span>' : '') + '</div>' +
        '<label><input type="radio" name="audres" value="item" checked> ' +
          'Corregí <b>este mismo código</b> <span class="muted">(el sistema lo comprueba en aSa)</span></label>' +
        '<label><input type="radio" name="audres" value="nuevo"> ' +
          'Quedó en <b>otro código</b>' +
          '<input type="text" id="audResCc" placeholder="código nuevo" class="audresi">' +
          '<input type="text" id="audResItem" placeholder="marca (si cambió)" class="audresi">' +
        '</label>' +
        '<label><input type="radio" name="audres" value="desestimar"> ' +
          '<b>No corresponde</b> <span class="muted">(el criterio del auditor no aplica a esta barra)</span></label>' +
        '<input type="text" id="audResNota" class="audresn" placeholder="' +
          'Comentario: si lo que hiciste no calza exacto con lo observado, o por qué no corresponde">' +
        '<div class="audresolb">' +
          '<button class="audmini ver" id="audResOk">Guardar</button>' +
          '<button class="audmini" id="audResNo">Cancelar</button>' +
          '<span class="muted" id="audResMsg" style="font-size:10px"></span>' +
        '</div>' +
      '</div></td></tr>';
  }

  // El aviso de que desestimar no es gratis se da al ELEGIRLO, no de entrada: un warning
  // que aparece antes de que nadie haya elegido nada no se lee. Lo engancha `_bindResolver`.
  function abrirResolver(itemId) {
    RESOLVIENDO = (RESOLVIENDO === String(itemId)) ? null : String(itemId);
    pintarMias();
  }

  async function guardarResolver(itemId) {
    var a = MIS.filter(function (x) { return String(x.item_id) === String(itemId); })[0];
    if (!a) return;
    var sel = $('audMias').querySelector('input[name=audres]:checked');
    var como = sel ? sel.value : 'item';
    var nota = ($('audResNota').value || '').trim();
    try {
      if (como === 'desestimar') {
        if (nota.length < 10) {
          $('audResMsg').innerHTML = '<b style="color:#c62828">Di por qué no corresponde: ' +
            'el auditor lo va a leer y queda en el informe.</b>';
          return;
        }
        await req('PUT', '/auditorias/' + a.auditoria_id + '/items/' + itemId + '/desestimar',
                  { desestimado: true, motivo: nota });
        ok('Desestimada, con tu motivo');
      } else {
        var cuerpo = { corregido: true, tipo: como, nota: nota };
        if (como === 'nuevo') {
          var cc = ($('audResCc').value || '').trim();
          if (!cc) {
            $('audResMsg').innerHTML = '<b style="color:#c62828">Falta el código nuevo: sin ' +
              'él no hay dónde ir a comprobar la barra.</b>';
            return;
          }
          cuerpo.cc_nuevo = cc;
          cuerpo.item_nuevo = ($('audResItem').value || '').trim() || null;
        }
        await req('PUT', '/auditorias/' + a.auditoria_id + '/items/' + itemId + '/correccion', cuerpo);
        ok('Corrección registrada');
      }
      RESOLVIENDO = null;
      await cargarMisAcciones(); await cargarLista();
      if (AUD && AUD.id === a.auditoria_id) { AUD = await req('GET', '/auditorias/' + AUD.id); pintarDetalle(); }
    } catch (e) { aviso(e.message); }
  }

  async function deshacerMia(itemId) {
    var a = MIS.filter(function (x) { return String(x.item_id) === String(itemId); })[0];
    if (!a) return;
    try {
      if (a.desestimado) {
        await req('PUT', '/auditorias/' + a.auditoria_id + '/items/' + itemId + '/desestimar',
                  { desestimado: false, motivo: '' });
      } else {
        await req('PUT', '/auditorias/' + a.auditoria_id + '/items/' + itemId + '/correccion',
                  { corregido: false });
      }
      ok('Vuelta a abrir');
      await cargarMisAcciones(); await cargarLista();
      if (AUD && AUD.id === a.auditoria_id) { AUD = await req('GET', '/auditorias/' + AUD.id); pintarDetalle(); }
    } catch (e) { aviso(e.message); }
  }

  // EL ISHIKAWA, EN EL MODAL CON LA MATRIZ. El usuario lo cazó: «volviste al desplegable y
  // no al modal con la matriz bonita». Es el MISMO modal que usan los reclamos y el
  // análisis histórico —vive en reclamos/detail-edit.js y su HTML está en la página—, y se
  // habla con él por estas dos funciones: una le dice qué hay elegido y de qué área es la
  // matriz, la otra recibe lo que se eligió. Una matriz de 19 sub-causas repartidas en
  // cuatro M no se lee en un <select>: eso era lo que había y por eso nadie clasificaba.
  //
  // LA CAUSA DE LA AUDITORÍA NO ES LA DEL RECLAMO. Comparten el catálogo —el Ishikawa del
  // área Cubicaciones, que es el único cargado— pero se guardan en tablas distintas y
  // ningún reporte de reclamos lee las de acá. Un hallazgo que encontramos nosotros antes
  // de fabricar y un reclamo que encontró el cliente después no se suman en el mismo Pareto.
  var CAUSA_DE = null;   // la barra que se está clasificando

  function clasificarMia(itemId) {
    var a = MIS.filter(function (x) { return String(x.item_id) === String(itemId); })[0];
    if (!a) return;
    if (typeof global.abrirIshikawaModal !== 'function') {
      aviso('No se pudo abrir la matriz de causas. Recarga la página.');
      return;
    }
    CAUSA_DE = a;
    global.abrirIshikawaModal('auditoria');
  }

  // EL DIBUJO DE UNA BARRA DE aSa, PARA OTRAS PANTALLAS (13-oct). El detalle de una señal
  // de chequeo muestra la misma barra que mira el auditor, con el mismo motor: se exponen
  // las dos piezas en vez de copiarlas a revision.js, que es como se desincronizan.
  global.audBarraNormalizada = normalizarBarra;
  global.audCeldaFigura = celdaFigura;
  global.audNum = num;

  global.audIshikawa = function () {
    return { categoria: CAUSA_DE && CAUSA_DE.causa_categoria,
             cod_causa: CAUSA_DE && CAUSA_DE.causa,
             sub_causa: CAUSA_DE && CAUSA_DE.causa_texto,
             area_id: BASE.causas_area };
  };

  global.audCausaElegida = async function (sel) {
    var a = CAUSA_DE;
    if (!a || !sel || !sel.cod_causa) return;
    try {
      // La misma matriz sirve a la barra y al comentario del elemento: cambia a dónde se
      // guarda, no qué se pregunta. `elemento_id` manda cuando no hay barra.
      var ruta = a.elemento_id
        ? '/auditorias/' + a.auditoria_id + '/elementos/' + a.elemento_id + '/resolucion'
        : '/auditorias/' + a.auditoria_id + '/items/' + a.item_id + '/causa';
      await req('PUT', ruta,
                { causa: sel.cod_causa, causa_categoria: sel.categoria, causa_texto: sel.sub_causa });
      ok('Causa registrada');
      await cargarMisAcciones();
      await cargarIndicadores();
      if (AUD && AUD.id === a.auditoria_id) { AUD = await req('GET', '/auditorias/' + AUD.id); pintarDetalle(); }
    } catch (e) { aviso(e.message); }
  };

  // Expuesto para los tests: lo puro.
  global.__auditoriasTest = { marcar: marcar, HALLAZGO_TXT: HALLAZGO_TXT, ACCION_TXT: ACCION_TXT,
                              normalizarBarra: normalizarBarra, letrasUsadas: letrasUsadas,
                              celdaFigura: celdaFigura, FIG_TAM: FIG_TAM };

})(window);
