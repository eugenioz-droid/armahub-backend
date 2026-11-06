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
    global.cargarNomCub();   // el mapa de nombres, una vez; si tarda se pinta el login
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
      await Promise.all([cargarLista(), cargarIndicadores()]);
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
      pintarLista(); pintarDetalle();
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
  // CÓMO SE ESCRIBE QUIEN CUBICÓ (2-nov). `cubicado_por` es un login de aSa («jrodriguez»)
  // o un correo, según de dónde venga el elemento. El login lo traduce `nomCub`, que sabe
  // quién es usuario de la plataforma; el correo se corta en el @, como siempre.
  function quien(x) {
    var s = String(x == null ? '' : x).trim();
    return s.indexOf('@') !== -1 ? s.split('@')[0] : nomCub(s);
  }

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
        return esc(quien(x.cubicador)); });
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
    // Sólo los elementos con acción: es lo que el auditado tiene que trabajar (3-nov).
    (AUD.elementos || []).forEach(function (el) {
      if (!el.accion_estado) return;
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

  // CERRAR A MANO Y REABRIR (restauradas 4-nov). El commit del 28-oct que despejó la
  // pantalla del auditor las borró y dejó los botones y su enganche: abrir una auditoría
  // enviada como auditor lanzaba un error de referencia. Las dos piden motivo porque
  // quedan en el informe y en el registro.
  async function cerrarAMano() {
    var m = global.prompt('¿Por qué se cierra sin resolver todas las barras?\n' +
                          '(la barra ya no existe, el código se anuló, la obra terminó…)\n' +
                          'Queda en el informe.');
    if (m === null) return;
    if (m.trim().length < 10) { aviso('Hace falta el motivo: queda en el informe.'); return; }
    try {
      AUD = await req('POST', '/auditorias/' + AUD.id + '/cerrar', { motivo: m });
      ok('Auditoría cerrada'); await cargarLista(); pintarDetalle();
    } catch (e) { aviso(e.message); }
  }

  async function reabrir() {
    var m = global.prompt('¿Por qué la reabres?\nSale del panel del auditado y queda registrado.');
    if (m === null) return;
    if (m.trim().length < 10) { aviso('Hace falta el motivo: reabrir también se audita.'); return; }
    try {
      AUD = await req('POST', '/auditorias/' + AUD.id + '/reabrir', { motivo: m });
      ok('Auditoría reabierta'); await cargarLista(); pintarDetalle();
    } catch (e) { aviso(e.message); }
  }

  async function enviarAuditoria() {
    var b = $('audBtnEnviar');
    _ocupado(b, true);
    if (b) b.textContent = 'Enviando…';
    try {
      AUD = await req('POST', '/auditorias/' + AUD.id + '/enviar', {});
      ok('Auditoría enviada');
      await cargarLista(); pintarDetalle();
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
    // Sólo los elementos con acción: es lo que el auditado tiene que trabajar (3-nov).
    (AUD.elementos || []).forEach(function (el) {
      if (!el.accion_estado) return;
      (el.barras_malas || []).forEach(function () {
        var q = (el.cubicado_por || '(sin dato)').trim();
        porcub[q] = (porcub[q] || 0) + 1;
      });
    });
    // OJO CON EL NOMBRE (4-nov): esto se llamaba `quien`, igual que la función de arriba
    // que escribe el nombre del cubicador, y como `var` se iza a toda la función, la
    // tabla de elementos de más abajo llamaba a un string: «quien is not a function».
    // Desde el 2-nov ninguna auditoría pintaba su detalle entero; la enviada quedaba sin
    // el Resumen Hallazgos, que es la mesa de trabajo del auditado.
    var porCubTxt = Object.keys(porcub).sort().map(function (q) {
      return esc(quien(q)) + ': ' + porcub[q]; }).join(' · ');
    $('audDetInfo').innerHTML += '<div class="audkpis audres3" id="audResBarra">' +
      caj(rs.elementos_auditados || 0, 'elementos auditados' +
          (rs.elementos && rs.elementos !== rs.elementos_auditados ? ' de ' + rs.elementos : '')) +
      caj(rs.items_auditados || 0, 'ítems auditados') +
      caj(rs.hallazgos || 0, 'hallazgos', rs.hallazgos ? 'mal' : 'bien') +
      caj(obsN, 'observaciones') +
      caj(porCubTxt || '—', 'barras por corregir, por cubicador') +
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
          esc(quien(e.cubicado_por)) + (e.conflicto ? ' ⚠' : '') + '</td>' +
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
    var cols = _colsMuestra(letras.length, nAng, conRadio);
    var html = cols.html + '<thead><tr><th>Veredicto</th><th>Marca</th><th class="num">φ</th>' +
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
        // EL NOMBRE VA EN SU COLUMNA, «Figura»; al lado del dibujo sobraba (6-nov).
        '<td class="audfigcel">' + celdaFigura(f, true) + '</td>' +
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
    // Repintar no mueve la planilla: se queda donde la dejó el auditor.
    var caja = $('audRevBarras').parentNode, arriba = caja.scrollTop, lado = caja.scrollLeft;
    $('audRevBarras').innerHTML = html + '</tbody>';
    $('audRevBarras').style.minWidth = cols.ancho + 'px';
    caja.scrollTop = arriba; caja.scrollLeft = lado;
    // Los chips S/M/L: cambiar el tamaño rehace los SVG, así que repinta la tabla.
    if (global.audChipsTam) global.audChipsTam('audRevTam', pintarBarras);
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

  // LA PLANILLA NO SE MUEVE (6-nov). Marcar «Hallazgo» vuelve campos las celdas de esa
  // fila y abre su observación: con el ancho repartido según el contenido, la tabla
  // recalculaba todas las columnas y el dibujo —que se encoge solo para caber— se
  // achicaba. Cada columna tiene su ancho fijo, la del dibujo según el S/M/L elegido; lo
  // que sobra va a la observación, que es la única que lo necesita.
  function _colsMuestra(nLados, nAng, conRadio) {
    var t = global._bmTam ? global._bmTam(FIG_TAM) : { w: 70 };
    var anchos = [124, 72, 40, 60, t.w + 40]
      .concat(rango(nLados).map(function () { return 46; }))
      .concat(rango(nAng).map(function () { return 40; }))
      .concat(conRadio ? [40] : [])
      .concat([54, 48, 56, 150]);
    var suma = anchos.reduce(function (s, w) { return s + w; }, 0);
    return { html: '<colgroup>' + anchos.map(function (w) { return '<col style="width:' + w + 'px">'; }).join('') +
                   '<col></colgroup>', ancho: suma + 240 };
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
             largo: f.largo != null ? _aMm(f.largo) : null, lados: lados,
             // ÁNGULOS Y MANDRIL (6-nov), tal como los manda aSa: el backend los compara con
             // los de hoy para decir «Editada en aSa». Y EL NOMBRE DE LA MARCA (Notes), que
             // la tabla muestra al lado de la marca sin tener que leer aSa.
             angulos: (b.angulos || []).map(Number),
             radio: (b.radio != null && b.radio !== '') ? Number(b.radio) : null,
             notas: b.notas || null };
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
  function _conNombre(svg, f, sinNombre) {
    if (!svg || !f || !f.figura || sinNombre) return svg;
    // AL LADO, NO DEBAJO (21-oct): el usuario quería las filas más compactas.
    return '<span class="audfigw">' + svg + '<span class="audfign" title="Figura del catálogo de aSa">' +
           esc(f.figura) + '</span></span>';
  }

  // `sinNombre`: para la tabla que ya trae el nombre en su propia columna.
  function celdaFigura(f, sinNombre) {
    // LA FIGURA DOBLADA EN DOS PLANOS VA EN ISOMÉTRICA, antes que cualquier trazo plano:
    // el del catálogo con ese nombre sería una figura plana con el nombre de una que no lo es.
    if (f.eje && f.eje.tridimensional && (f.eje.puntos3d || []).length > 1) {
      var iso = svgIso(f);
      if (iso) {
        return _conNombre(iso, f, sinNombre) + '<span class="audfigfte" title="Esta barra se dobla en dos planos: ' +
          'se dibuja en isométrica (30°, Z hacia arriba) tal como aSa la define, lado por lado.">3D</span>';
      }
    }
    var svg = global._bmFiguraSvg ? global._bmFiguraSvg(f, FIG_TAM) : '';
    if (svg) return _conNombre(svg, f, sinNombre);
    svg = svgEje(f);
    if (!svg) return '<span class="muted">—</span>';
    // DE DÓNDE SALIÓ EL DIBUJO, cuando no salió de donde sale siempre. El backend intenta
    // primero su reconstrucción y, si no cuadra con la envolvente que aSa declara, usa el
    // trazo que aSa misma exportó en su catálogo (ver trazo_de_catalogo). Que una figura se
    // esté dibujando por la segunda vía no es un problema —al contrario, es la topología de
    // aSa— pero el auditor tiene derecho a saber qué está mirando.
    if (f.eje.fuente === 'catalogo_asa') {
      return _conNombre(svg, f, sinNombre) + '<span class="audfigfte" title="Esta figura se dibuja con el trazo que ' +
        'exportó aSa en su catálogo, a las medidas de esta barra. La reconstrucción desde ' +
        'los vectores no cuadraba con la envolvente que aSa declara.">aSa</span>';
    }
    return _conNombre(svg, f, sinNombre) + (f.eje.ok ? '' :
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

  // LA FIGURA EN EL ESPACIO (4-nov). La traba 26 y las TP se doblan en dos planos; hasta
  // hoy se mostraba su proyección en planta con un ⚠, y se veía igual que una figura
  // plana: «eso lleva a confusión». El backend manda el eje 3D vértice a vértice
  // (`puntos3d`, mm) ya orientado como las figuras 3D del catálogo (lado largo por X, el
  // doblez hacia arriba), y acá se proyecta con LA MISMA CÁMARA del editor 3D del catálogo
  // (disenador3d.js::_isoBasis: azimut 45°, elevación 30°, Z arriba), para que la 26 se vea
  // como la 305A. Una polilínea, sin librerías ni codos, con el largo de cada lado en cm y
  // tres ejes chicos para que se lea como espacio y no como otra figura plana.
  function svgIso(f) {
    var eje = f.eje, P3 = eje.puntos3d || [];
    if (P3.length < 2) return '';
    var t = global._bmTam ? global._bmTam(FIG_TAM) : { w: 120, h: 70 };
    var el = Math.PI / 6, az = Math.PI / 4;
    var ex = Math.cos(el) * Math.cos(az), ey = -Math.cos(el) * Math.sin(az), ez = Math.sin(el);
    var fx = -ex, fy = -ey, fz = -ez;
    var rx = fy, ry = -fx, rz = 0, rn = Math.hypot(rx, ry) || 1; rx /= rn; ry /= rn;
    var ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    var un = Math.hypot(ux, uy, uz) || 1; ux /= un; uy /= un; uz /= un;
    // El SVG crece hacia abajo: la altura de cámara se invierte, igual que hace el motor.
    var iso = function (p) { return { x: p[0] * rx + p[1] * ry + p[2] * rz, y: -(p[0] * ux + p[1] * uy + p[2] * uz) }; };
    var P = P3.map(iso), i;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (i = 0; i < P.length; i++) {
      minX = Math.min(minX, P[i].x); maxX = Math.max(maxX, P[i].x);
      minY = Math.min(minY, P[i].y); maxY = Math.max(maxY, P[i].y);
    }
    var W = t.w, H = t.h, pad = 7, fw = (maxX - minX) || 1, fh = (maxY - minY) || 1;
    var k = Math.min((W - 2 * pad) / fw, (H - 2 * pad) / fh);
    var ox = (W - fw * k) / 2 - minX * k, oy = (H - fh * k) / 2 - minY * k;
    var Q = P.map(function (p) { return { x: ox + p.x * k, y: oy + p.y * k }; });
    var d = Q.map(function (q, j) { return (j ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1); }).join(' ');
    var labels = (eje.lados3d || []).map(function (l, j) {
      var a = Q[j], b = Q[j + 1];
      if (!a || !b || !l.largo) return '';
      return '<text x="' + ((a.x + b.x) / 2).toFixed(1) + '" y="' + ((a.y + b.y) / 2 - 3).toFixed(1) +
             '" font-size="8" text-anchor="middle" fill="#555">' + Math.round(l.largo / 10) + '</text>';
    }).join('');
    // Los tres ejes, chicos y abajo a la izquierda, con la misma cámara: X e Y en el
    // plano, Z arriba.
    var e0 = { x: 8, y: H - 7 }, L = 7;
    var axes = [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]].map(function (a) {
      var q = iso(a[1]);
      return '<line x1="' + e0.x + '" y1="' + e0.y + '" x2="' + (e0.x + q.x * L).toFixed(1) + '" y2="' + (e0.y + q.y * L).toFixed(1) +
             '" stroke="#90a4ae" stroke-width="1"/><text x="' + (e0.x + q.x * L * 1.7).toFixed(1) + '" y="' + (e0.y + q.y * L * 1.7 + 2).toFixed(1) +
             '" font-size="6" text-anchor="middle" fill="#90a4ae">' + a[0] + '</text>';
    }).join('');
    return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="max-width:100%; height:auto;">' +
      axes + '<path d="' + d + '" fill="none" stroke="#00695c" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
      labels + '</svg>';
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
  // ══════ RESUMEN HALLAZGOS: LA HOJA DE LA AUDITORÍA (6-nov) ══════
  //
  // CON LA FORMA DE LA REVISIÓN DE BARRAS. El usuario: «homologa esta interfaz… cambia este
  // formato para que se parezca lo más posible al otro formulario de revisiones, con la
  // salvedad de los botones». Un bloque por código con su cabecera —código, descripción,
  // quién cubicó, Ver figuras, cuenta— y en cada bloque una tabla con el orden de la
  // revisión: check · Marca · Figura · A B C… · α1 α2…, y después lo propio de la
  // auditoría: elemento, qué encontró el auditor, qué debería decir, RCA, estado y acción.
  // La figura va en su celda con su nombre; los lados y los ángulos, en sus columnas. La
  // tablita que iba bajo el dibujo se fue: «hiciste un invento medio raro».
  //
  // DE DÓNDE SALEN MARCA, FIGURA, LADOS Y ÁNGULOS. De la foto que se guardó al auditar
  // (`original`), que es lo que vio el auditor, igual que la revisión muestra la medida del
  // momento en que saltó. Las auditorías de antes del 15-oct no tienen foto, y las de antes
  // del 6-nov no traen ángulos ni el nombre de la marca: eso se completa con lo leído de
  // aSa, y esas auditorías piden sus códigos solas al abrirse para que el nombre de la
  // figura y el de la marca se vean siempre.
  //
  // TRES SALIDAS POR LÍNEA (6-nov): Resuelto en CC · Resuelto en nuevo CC · No aplica, y al
  // final el campo de texto, obligatorio en las tres. El botón queda encendido, el campo se
  // abre al lado, Enter guarda y Esc lo deja como estaba: el gesto del «no aplica» de la
  // revisión. «Nuevo CC» abre además el código y la marca. Resolver pide el RCA antes; el
  // «no aplica» no lo lleva. Al resolver, el backend compara la barra con aSa en el acto y
  // la fila dice «Editada en aSa», «Idéntica en aSa» o «Sin comprobar».
  //
  // DE A MUCHAS, COMO EN LA REVISIÓN: con barras marcadas, el botón de cualquiera de ellas
  // abre el campo en todas y lo que se escribe en una se escribe en todas; Enter las guarda
  // juntas. El código nuevo también se replica; la marca no, porque es la de cada barra. El
  // RCA también va para todas las marcadas.
  var AFIGS = {};
  // Si la muestra del auditor está desplegada DESPUÉS del envío (antes está siempre).
  var MUESTRA_ABIERTA = false;
  // Las barras marcadas con el check para resolverlas de a muchas.
  var SEL_AUD = {};
  // La auditoría para la que ya se pidieron solas las figuras: una vez por apertura.
  var AUTO_FIGS = null;
  var MODOS = {
    cc: { txt: 'Resuelto en CC', ph: '¿qué corregiste?' },
    nuevo: { txt: 'Resuelto en nuevo CC', ph: '¿qué hiciste?' },
    nap: { txt: 'No aplica', ph: '¿por qué no aplica?' }
  };

  function _q1(sel) { return document.querySelector('#audAcciones ' + sel); }
  function _qa(s) { return String(s == null ? '' : s).replace(/["\\]/g, '\\$&'); }
  function _enCurso() { return !!(AUD && (AUD.enviada || AUD.enviada_el) && AUD.estado !== 'cerrada'); }
  function _actuo() { return !!(AUD && AUD.puedo_actuar && _enCurso()); }

  // Lo leído de aSa para esa barra, si ya se leyó su código.
  function _barraAsa(cc, ref) {
    var c = AFIGS[cc];
    if (!c || c.estado !== 'listo') return null;
    return c.barras[ref] || c.barras[String(ref).split('#')[0]] || null;
  }

  // Lo que se muestra de una barra: la foto de la auditoría, completada con aSa.
  function _vista(cc, b) {
    var o = b.original || {}, v = _barraAsa(cc, b.ref) || {};
    return { lados: (o.lados && Object.keys(o.lados).length) ? o.lados : (v.dims || {}),
             angulos: Array.isArray(o.angulos) ? o.angulos : (v.angulos || []),
             figura: o.figura || v.figura || '',
             notas: o.notas || v.notas || '' };
  }

  // Las columnas de un código: las letras de todos sus lados y el máximo de ángulos.
  function _colsAud(els) {
    var letras = [], vistas = {}, nang = 0;
    els.forEach(function (e) {
      (e.barras_malas || []).forEach(function (b) {
        var v = _vista(e.cc, b);
        Object.keys(v.lados).forEach(function (L) { if (!vistas[L]) { vistas[L] = 1; letras.push(L); } });
        nang = Math.max(nang, (v.angulos || []).length);
      });
    });
    letras.sort();
    return { letras: letras, nang: nang };
  }

  // LA FIGURA, con su nombre siempre a la vista. El dibujo es aSa de ahora y llega con «Ver
  // figuras»; mientras tanto, o si falla, queda el nombre.
  function _celdaFig(cc, b, v) {
    var nom = v.figura ? '<span class="audfigw"><span class="audfign" title="Figura del catálogo de aSa">' +
                         esc(v.figura) + '</span></span>' : '';
    var c = AFIGS[cc];
    if (!c) return nom;
    if (c.estado === 'cargando') return nom + '<span class="muted">…</span>';
    if (c.estado === 'error') return nom + '<span class="muted" title="' + esc(c.msg || '') + '">sin dibujo</span>';
    var x = _barraAsa(cc, b.ref);
    if (!x) {
      return nom + '<div class="revcorr" title="En aSa ya no hay una barra con esta marca en este ' +
             'código: alguien la cambió o la sacó.">ya no está</div>';
    }
    // El nombre no se pierde aunque el dibujo no salga: el dibujante lo pone sólo cuando dibuja.
    try {
      var html = celdaFigura(normalizarBarra(x, 'asa'));
      return html.indexOf('audfign') === -1 ? nom + html : html;
    } catch (err) { return nom || '<span class="muted">—</span>'; }
  }

  function _gruposAud(acc) {
    var grupos = [], ix = {};
    acc.forEach(function (e) {
      var k = e.cc || '(sin código)';
      if (!ix[k]) {
        ix[k] = { cc: e.cc || '', descr: e.descr_cc, cubs: {}, els: [], hayBarras: false,
                  despachado: false, fabricando: false };
        grupos.push(ix[k]);
      }
      var g = ix[k];
      g.els.push(e);
      if (e.cubicado_por) g.cubs[e.cubicado_por] = 1;
      if ((e.barras_malas || []).length) g.hayBarras = true;
      if (e.despachado) g.despachado = true;
      if (e.fabricando) g.fabricando = true;
    });
    return grupos;
  }

  function pintarAcciones() {
    var caja = $('audAcciones');
    if (!caja || !AUD) return;
    var acc = (AUD.elementos || []).filter(function (e) { return e.accion_estado; });
    // EL RESUMEN EXISTE DESDE EL ENVÍO (28-oct): antes son hallazgos a medio hacer.
    var enviada = !!(AUD.enviada || AUD.enviada_el);
    if (!acc.length || !enviada) { caja.style.display = 'none'; return; }
    caja.style.display = '';
    // LO ESCRITO Y NO GUARDADO SOBREVIVE AL REPINTADO, como en la revisión: llegar las
    // figuras de un código o guardar otra línea repinta todo.
    var abiertas = _lineasAbiertas();
    var total = 0, resueltas = 0, mias = 0, identicas = 0;
    acc.forEach(function (e) {
      (e.barras_malas || []).forEach(function (b) {
        total++;
        if (b.corregido || b.desestimado) resueltas++;
        if (e.mio && !b.corregido && !b.desestimado) mias++;
        if (b.corregido && b.verificado === 'sigue_igual') identicas++;
      });
      if (e.comentario_suelto) {
        total++;
        var r = (e.accion_estado || 'pendiente') !== 'pendiente';
        if (r) resueltas++;
        if (e.mio && !r) mias++;
      }
    });
    var faltan = AUD.barras_pendientes || 0;
    var cerrada = AUD.estado === 'cerrada';
    var grupos = _gruposAud(acc);
    var sinFig = grupos.filter(function (g) {
      var c = AFIGS[g.cc];
      return g.cc && g.hayBarras && (!c || c.estado === 'error');
    }).length;
    caja.innerHTML =
      // LA CABECERA TE SIGUE, como la de la revisión: se baja por los códigos sin perder
      // cuánto falta, el cierre y lo marcado.
      '<div class="audcab">' +
        '<div class="audh">Resumen Hallazgos <span class="muted">' + total + ' línea(s) · ' +
          resueltas + ' resuelta(s)' +
          (mias ? ' · <b style="color:#c62828">' + mias + ' tuya(s) por resolver</b>' : '') + '</span>' +
          (sinFig ? '<button class="audmini" id="audFigs" title="Lee en aSa los códigos que faltan y ' +
                    'dibuja cada barra. Va de a uno para no colgarse.">Ver las figuras (' + sinFig + ')</button>' : '') +
          '<span class="dshchips audtam" id="audTam"></span>' +
          '<div style="flex:1"></div>' +
          // EL CIERRE ES DEL AUDITADO y cierra la auditoría completa. La condición la dice
          // el backend, que es el que después la valida.
          (AUD.puedo_cerrar
            ? '<button class="audenviar" id="audBtnCerrarOk" title="Compara con aSa lo resuelto y ' +
              'cierra la auditoría completa. Si alguna barra sigue idéntica, no cierra y te dice ' +
              'cuál.">Cerrar la auditoría</button>'
            : (faltan && !cerrada
                ? '<span class="muted" style="font-size:10.5px">quedan ' + faltan +
                  ' por resolver para poder cerrar</span>' : '')) +
        '</div>' +
        (identicas && !cerrada
          ? '<div class="audnota audidem"><b>' + identicas + ' barra(s) resueltas siguen idénticas ' +
            'en aSa.</b> Corrígelas en aSa o márcalas «No aplica»: así la auditoría no se puede cerrar.</div>'
          : '') +
        (cerrada ? _notaCerrada() : (mias ? '' : _notaQuien())) +
        '<div class="revcubacc" id="audLote" style="display:none"></div>' +
      '</div>' +
      grupos.map(_bloqueAud).join('');
    _bindAcciones(caja);
    _pintarLote();
    _reabrirLineas(abiertas);
    _autoFiguras(grupos);
  }

  // CERRADA: lo que dijo aSa al cerrar, que es lo que vale como comprobación. Las cerradas
  // antes del 6-nov pueden traer barras que «seguían igual» bajo confirmación de quien cerró.
  function _notaCerrada() {
    var ch = AUD.cierre_chequeo;
    if (!ch) return '';
    return '<div class="audnota audcerrada">Cerrada' +
      (AUD.cerrada_por ? ' por <b>' + esc(String(AUD.cerrada_por).split('@')[0]) + '</b>' : '') +
      ' · aSa confirmó <b>' + ((ch.cumplen || []).length) + '</b>' +
      ((ch.siguen_igual || []).length
        ? ' · <b>' + ch.siguen_igual.length + '</b> seguían igual en aSa, cerradas bajo su confirmación (' +
          esc(ch.siguen_igual.map(function (x) { return x.ref; }).join(', ')) + ')'
        : '') +
      ((ch.sin_leer || []).length ? ' · ' + ch.sin_leer.length + ' no se pudieron comprobar' : '') +
      '</div>';
  }

  function _notaQuien() {
    return AUD.puedo_actuar
      ? '<div class="audnota">Acá se ve todo lo que salió. Puedes resolver también lo de otro ' +
        'cubicador si no está: le llega aviso y queda escrito quién lo hizo.</div>'
      : '<div class="audnota">Lo que marcaste, como lo está resolviendo quien cubicó. Si no ' +
        'aceptas un descarte, «No lo acepto» lo vuelve a abrir.</div>';
  }

  // UN CÓDIGO: cabecera y tabla, como en la revisión de barras.
  function _bloqueAud(g) {
    var c = _colsAud(g.els), lineas = 0, listas = 0;
    g.els.forEach(function (e) {
      (e.barras_malas || []).forEach(function (b) { lineas++; if (b.corregido || b.desestimado) listas++; });
      if (e.comentario_suelto) { lineas++; if ((e.accion_estado || 'pendiente') !== 'pendiente') listas++; }
    });
    var fg = AFIGS[g.cc];
    var marcables = _actuo() && g.els.some(function (e) {
      return (e.barras_malas || []).some(function (b) { return !b.corregido && !b.desestimado; });
    });
    var ang = '';
    for (var k = 1; k <= c.nang; k++) ang += '<th class="revn reva">α' + k + '</th>';
    return '<div class="revcc2 audhoja' + (lineas && listas >= lineas ? ' listo' : '') +
      '" data-grupocc="' + esc(g.cc) + '"><h5>' +
      '<b>' + esc(g.cc || '—') + '</b> <span class="muted">' + esc(g.descr || '') + '</span>' +
      (Object.keys(g.cubs).length ? '<span class="revquien">' + esc(Object.keys(g.cubs).map(quien).join(', ')) + '</span>' : '') +
      '<div style="flex:1"></div>' +
      // LO URGENTE SE DICE EN LA CABECERA: si el código ya entró a fabricación se corrige
      // ahora; si ya salió, lo que se corrija queda de registro.
      (g.fabricando ? '<span class="audfab" title="Este código ya entró a fabricación: la barra se ' +
                      'está cortando.">EN FÁBRICA</span>' : '') +
      (g.despachado ? '<span class="revido" title="Este código ya se despachó: la corrección llega ' +
                      'tarde, pero hay que dejarla registrada.">ya despachado</span>' : '') +
      (g.cc && g.hayBarras && (!fg || fg.estado === 'error')
        ? '<button class="audmini" data-afigs="' + esc(g.cc) + '" title="Lee este código en aSa y ' +
          'dibuja sus barras">Ver figuras</button>' : '') +
      (fg && fg.estado === 'cargando' ? '<span class="muted">leyendo aSa…</span>' : '') +
      '<span class="revcuenta" title="Resueltas y no aplican, sobre las líneas del código."><b>' +
        listas + '</b>/' + lineas + '</span></h5>' +
      '<div class="audtbl"><table><tr class="revhead">' +
        '<th style="width:22px">' + (marcables
          ? '<input type="checkbox" data-aselgrp="' + esc(g.cc) + '" title="Marcar todas las barras ' +
            'por resolver de este código">' : '') + '</th>' +
        '<th>Marca</th><th>Figura</th>' +
        c.letras.map(function (L) {
          return '<th class="revn" title="Medida del lado ' + esc(L) + ' cuando se auditó. El dibujo ' +
                 'es lo que hay en aSa ahora: si no calzan, la barra ya se editó.">' + esc(L) + '</th>';
        }).join('') + ang +
        '<th>Elemento</th><th>Qué encontró el auditor</th>' +
        '<th class="revn" title="Lo que la barra debería decir, como lo dejó el auditor.">Debería decir</th>' +
        '<th title="Por qué pasó, en la matriz Ishikawa. Es por barra y es de este módulo: no se ' +
        'mezcla con las causas de los reclamos.">RCA</th>' +
        '<th>Estado</th><th></th></tr>' +
        g.els.map(function (e) {
          var malas = e.barras_malas || [];
          if (!malas.length) return filaComentario(e, c);
          return malas.map(function (b) { return filaAccion(e, b, c); }).join('');
        }).join('') +
      '</table></div></div>';
  }

  // LA CELDA DEL RCA, igual para la barra y para el comentario del elemento. RCA = análisis
  // de causa raíz: el usuario lo llama así y es como se llama en la norma.
  //
  // SE APAGA EN «NO APLICA» (20-oct): un hallazgo que no correspondía no tiene causa que
  // clasificar, y si la tenía el backend la quitó para que no pese en el indicador de causas
  // de la auditoría (que es interno: NO es el Pareto de los reclamos y no se mezcla con él).
  function _celdaCausa(x, nap, attr, id, editable, puede, sinEsto) {
    if (nap) return '<span class="muted" title="Sin efecto: no lleva RCA.">—</span>';
    if (x.causa) {
      return '<button class="audmini" ' + attr + '="' + id + '"' + (editable ? '' : ' disabled') +
             ' title="' + esc(x.causa + (x.causa_texto ? ' · ' + x.causa_texto : '')) + '">' +
             esc(x.causa) + (editable ? ' ✎' : '') + '</button>';
    }
    return puede
      ? '<button class="audmini sinc" ' + attr + '="' + id + '" title="Por qué pasó, en la matriz ' +
        'Ishikawa. Sin esto no se puede ' + sinEsto + '.">RCA</button>'
      : '<span class="muted">sin RCA</span>';
  }

  // QUIÉN LO RESOLVIÓ EN LUGAR DEL DUEÑO (21-oct). Cualquier cubicador puede resolver lo
  // ajeno —el dueño recibe aviso—, y la fila lo dice para que el rastro esté a la vista.
  function _porOtro(correo) {
    if (!correo) return '';
    return ' <span class="audporotro" title="Lo resolvió otra persona en lugar de quien cubicó; ' +
           'a quien cubicó le llegó aviso.">por ' + esc(correo.split('@')[0]) + '</span>';
  }

  // LO QUE DIJO aSa AL RESOLVER. «Editada»: la barra cambió respecto de la foto (o ya no
  // está en su código). «Idéntica»: sigue como se auditó, y eso traba el cierre. «Sin
  // comprobar»: no hubo con qué comparar o aSa no respondió; se vuelve a mirar al cerrar.
  function _etiquetaAsa(b) {
    var p = esc(b.verificado_porque || '');
    if (b.verificado === 'ok') return '<span class="audasa ok" title="' + p + '">Editada en aSa</span>';
    if (b.verificado === 'sigue_igual') {
      return '<span class="audasa mal" title="' + p + '">' +
             (_esperadoTxt(b.esperado) ? 'No coincide en aSa' : 'Idéntica en aSa') + '</span>';
    }
    return '<span class="audasa nd" title="' + (p || 'Todavía no se pudo comparar con aSa: se vuelve a ' +
           'mirar al cerrar.') + '">Sin comprobar</span>';
  }

  function _estadoBarra(b) {
    var est = b.desestimado
      ? '<span class="revi aceptada" title="' + esc(b.desestimado_motivo || '') + '">No aplica</span>'
      : b.corregido
        ? '<span class="revi corregida">Resuelto</span>' + _etiquetaAsa(b)
        : b.objecion
          ? '<span class="revi abierta" title="El auditor no aceptó el descarte: ' + esc(b.objecion) +
            '">Descarte no aceptado</span>'
          : '<span class="revi abierta">Por resolver</span>';
    return est + _porOtro(b.resuelto_por_otro);
  }

  // LA FIRMA DE LO RESUELTO: dónde quedó, el texto de la línea y quién.
  function _firmaBarra(b) {
    if (b.desestimado) {
      return (b.desestimado_motivo || '') + (b.desestimado_por ? ' — ' + b.desestimado_por.split('@')[0] : '');
    }
    if (b.corregido) {
      return (b.tipo_correccion === 'nuevo'
                ? 'en ' + (b.cc_nuevo || 'código nuevo') + (b.item_nuevo ? ' · ' + b.item_nuevo : '') + ': ' : '') +
             (b.nota_correccion || '') + (b.corregido_por ? ' — ' + b.corregido_por.split('@')[0] : '');
    }
    return '';
  }

  // LOS BOTONES DE UNA LÍNEA. Abierta: las tres salidas y sus campos, escondidos hasta que
  // se aprieta una. Resuelta o sin efecto: la firma y Deshacer. `lin` es «i<barra>» o
  // «e<elemento>» (el comentario del elemento).
  function _accionesAud(lin, abierta, puede, sinRca, esBarra, firma, objetarId) {
    if (!abierta) {
      var out = firma ? '<span class="revfirma" title="' + esc(firma) + '">' + esc(firma) + '</span>' : '';
      if (puede) out += '<button class="audmini" data-adeshacer="' + lin + '" title="Vuelve a dejar la ' +
                        'línea por resolver.">Deshacer</button>';
      // Derecho a réplica del auditor: el descarte vale por defecto, pero si no corresponde
      // lo reabre dejando por escrito por qué.
      if (objetarId) out += '<button class="audmini" data-objetar="' + objetarId + '" title="Reabre esta ' +
                            'barra: el descarte no se acepta. Queda registrado y le llega a quien cubicó.">' +
                            'No lo acepto</button>';
      return out ? '<div class="revaccs">' + out + '</div>' : '';
    }
    if (!puede) return '';
    var rca = sinRca ? ' off" disabled title="Primero el RCA: por qué pasó."' : '"';
    return '<div class="revaccs">' +
      '<button class="audbres' + rca + ' data-amodo="cc" data-alin="' + lin + '"' +
        (sinRca ? '' : ' title="Ya lo corregiste en este mismo código en aSa. Se compara con aSa en el acto."') +
        '>Resuelto en CC</button>' +
      '<button class="audbres' + rca + ' data-amodo="nuevo" data-alin="' + lin + '"' +
        (sinRca ? '' : ' title="Quedó en otro código de control: di cuál' + (esBarra ? ' y con qué marca' : '') + '."') +
        '>Resuelto en nuevo CC</button>' +
      '<button class="revnapbtn" data-amodo="nap" data-alin="' + lin + '" title="Lo observado no ' +
        'corresponde. No lleva RCA.">No aplica</button>' +
      '<input type="text" class="revccin" data-accnuevo="' + lin + '" style="display:none" ' +
        'placeholder="código nuevo" title="El código de control donde quedó.">' +
      (esBarra ? '<input type="text" class="revccin revmarcain" data-amarca="' + lin + '" style="display:none" ' +
                 'placeholder="marca" title="La marca en el código nuevo. Vacía = conservó la misma.">' : '') +
      '<input type="text" class="revnapin" data-anota="' + lin + '" style="display:none" ' +
        'title="Obligatorio: lo lee quien auditó. Enter guarda; Esc lo deja.">' +
      '</div>';
  }

  // UNA BARRA DE LA AUDITORÍA.
  function filaAccion(e, b, c) {
    var lin = 'i' + b.item_id, v = _vista(e.cc, b);
    var puede = _actuo();
    var abierta = !b.corregido && !b.desestimado;
    var cm = global.audNumCm;
    var malos = {};
    Object.keys((b.esperado || {}).lados || {}).forEach(function (L) { malos[String(L).toUpperCase()] = 1; });
    var angTd = '';
    for (var k = 0; k < c.nang; k++) {
      var a = (v.angulos || [])[k];
      angTd += '<td class="revn reva">' + (a != null && a !== '' ? Math.abs(Math.round(Number(a))) + '°' : '') + '</td>';
    }
    var objetarId = (!puede && b.desestimado && AUD.soy_auditor && AUD.estado !== 'cerrada') ? b.item_id : null;
    return '<tr class="' + (b.corregido ? 'hecho' : b.desestimado ? 'nap' : '') + '" data-alin="' + lin + '">' +
      '<td style="width:22px">' + (puede && abierta
        ? '<input type="checkbox" data-asel="' + b.item_id + '" data-agrp="' + esc(e.cc || '') + '"' +
          (SEL_AUD[b.item_id] ? ' checked' : '') + ' title="Marcar para resolver varias de una vez">'
        : '') + '</td>' +
      '<td class="revm"><span class="audref">' + esc(b.ref || b.marca || '') + '</span>' +
        (v.notas ? ' <span class="audnotas" title="El nombre que le puso a la marca quien cubicó ' +
                   '(Notes en aSa)">' + esc(v.notas) + '</span>' : '') + '</td>' +
      '<td class="revfig">' + _celdaFig(e.cc, b, v) + '</td>' +
      c.letras.map(function (L) {
        var x = v.lados[L];
        return '<td class="revn' + (malos[L] ? ' mal' : '') + '">' +
               (x != null && x !== '' ? cm(Number(x) / 10) : '') + '</td>';
      }).join('') + angTd +
      '<td class="audnom" title="' + esc(nombreCompleto(e)) + '">' + esc(e.nombre || nombreCompleto(e)) + '</td>' +
      '<td class="audqse">' + esc(b.observacion || '') + '</td>' +
      '<td class="revn revesp">' + esc(_esperadoTxt(b.esperado)) + '</td>' +
      '<td class="audcausa">' + _celdaCausa(b, !!b.desestimado, 'data-causa', b.item_id, puede && abierta,
                                             puede && abierta, 'darla por resuelta') + '</td>' +
      '<td>' + _estadoBarra(b) + '</td>' +
      '<td class="revacc">' + _accionesAud(lin, abierta, puede, !b.causa, true, _firmaBarra(b), objetarId) +
      '</td></tr>';
  }

  // EL COMENTARIO DEL ELEMENTO, cuando el hallazgo no es de ninguna barra. «Falta trabas de
  // muro» no se puede colgar de una barra: la barra que falta no está. Lleva las mismas tres
  // salidas que una barra, porque es el mismo trabajo a otra escala; en un código nuevo
  // queda dicho cuál, sin marca, porque no hay barra.
  function filaComentario(e, c) {
    var est = e.accion_estado || 'pendiente';
    var resuelto = est === 'corregida' || est === 'verificada';
    var nap = est === 'desestimada';
    var abierta = !resuelto && !nap;
    var puede = !!(e.comentario_suelto && _actuo());
    var lin = 'e' + e.id, vacias = '';
    for (var k = 0; k < c.letras.length + c.nang; k++) vacias += '<td class="revn"></td>';
    var estado = nap
      ? '<span class="revi aceptada" title="' + esc(e.accion_nota || '') + '">No aplica</span>'
      : resuelto ? '<span class="revi corregida">Resuelto</span>' : '<span class="revi abierta">Por resolver</span>';
    var firma = abierta ? '' :
      (resuelto && e.accion_cc_nuevo ? 'en ' + e.accion_cc_nuevo + ': ' : '') + (e.accion_nota || '') +
      (e.accion_por ? ' — ' + e.accion_por.split('@')[0] : '');
    return '<tr class="' + (resuelto ? 'hecho' : nap ? 'nap' : '') + '" data-alin="' + lin + '">' +
      '<td></td>' +
      '<td class="revm"><span class="audref" title="Este hallazgo no es de una barra en particular: es ' +
        'del elemento.">elemento</span></td>' +
      '<td class="revfig"></td>' + vacias +
      '<td class="audnom" title="' + esc(nombreCompleto(e)) + '">' + esc(e.nombre || nombreCompleto(e)) + '</td>' +
      '<td class="audqse">' + esc(e.texto || '') + '</td>' +
      '<td class="revn revesp"></td>' +
      '<td class="audcausa">' + _celdaCausa(e, nap, 'data-ecausa', e.id, puede && abierta, puede && abierta,
                                             'darlo por resuelto') + '</td>' +
      '<td>' + estado + _porOtro(e.resuelto_por_otro) + '</td>' +
      '<td class="revacc">' + _accionesAud(lin, abierta, puede && !!e.comentario_suelto, !e.causa, false, firma, null) +
      '</td></tr>';
  }

  // LAS FIGURAS DE LA AUDITORÍA. Mismo trato que en la revisión de barras: se piden POR
  // CÓDIGO —una lectura sirve a todas sus barras—, de a uno, y se repinta al llegar cada
  // código. Sin lista, todos los que falten.
  async function cargarFigurasAud(boton, lista) {
    var ccs = (lista || []).slice();
    if (!lista) {
      (AUD.elementos || []).forEach(function (e) {
        var c = AFIGS[e.cc];
        if ((e.barras_malas || []).length && e.cc && (!c || c.estado === 'error') && ccs.indexOf(e.cc) === -1) {
          ccs.push(e.cc);
        }
      });
    }
    if (!ccs.length || !AUD) return;
    if (boton) boton.disabled = true;
    var aud = AUD.id;
    ccs.forEach(function (cc) { AFIGS[cc] = { estado: 'cargando', barras: {} }; });
    pintarAcciones();
    for (var i = 0; i < ccs.length; i++) {
      try {
        var d = await req('GET', '/auditorias/elemento-asa?cc=' + encodeURIComponent(ccs[i]));
        var ix = {};
        (d.barras || []).forEach(function (b) {
          if (b.ref) ix[b.ref] = b;
          if (b.marca && !ix[b.marca]) ix[b.marca] = b;
        });
        AFIGS[ccs[i]] = { estado: 'listo', barras: ix };
      } catch (err) { AFIGS[ccs[i]] = { estado: 'error', barras: {}, msg: err.message }; }
      // Si en el camino se cambió de auditoría, lo leído queda guardado pero no se pinta acá.
      if (AUD && AUD.id === aud) pintarAcciones();
    }
  }

  // LAS QUE NO TIENEN FOTO COMPLETA PIDEN SUS CÓDIGOS SOLAS, una vez por apertura: sin eso
  // el nombre de la figura y el de la marca no se verían. Las auditorías desde el 6-nov
  // traen todo en la foto y no piden nada hasta que alguien apriete «Ver figuras».
  function _autoFiguras(grupos) {
    if (!AUD || AUTO_FIGS === AUD.id) return;
    AUTO_FIGS = AUD.id;
    var ccs = [];
    grupos.forEach(function (g) {
      if (!g.cc || AFIGS[g.cc]) return;
      var falta = g.els.some(function (e) {
        return (e.barras_malas || []).some(function (b) {
          var o = b.original || {};
          return !o.figura || !('notas' in o);
        });
      });
      if (falta) ccs.push(g.cc);
    });
    if (ccs.length) cargarFigurasAud(null, ccs);
  }

  function _bindAcciones(caja) {
    var f = $('audFigs');
    if (f) f.addEventListener('click', function () { cargarFigurasAud(f); });
    caja.querySelectorAll('button[data-afigs]').forEach(function (b) {
      b.addEventListener('click', function () { cargarFigurasAud(b, [b.dataset.afigs]); });
    });
    if (global.audChipsTam) global.audChipsTam('audTam', pintarAcciones);
    var cz = $('audBtnCerrarOk');
    if (cz) cz.addEventListener('click', function () { cerrarResueltas(); });
    // Marcar no repinta: sólo cambia la barra de marcadas, y lo escrito queda donde está.
    caja.querySelectorAll('input[data-asel]').forEach(function (c) {
      c.addEventListener('change', function () {
        if (c.checked) SEL_AUD[c.dataset.asel] = true; else delete SEL_AUD[c.dataset.asel];
        _pintarLote();
      });
    });
    caja.querySelectorAll('input[data-aselgrp]').forEach(function (c) {
      c.addEventListener('change', function () {
        caja.querySelectorAll('input[data-asel][data-agrp="' + _qa(c.dataset.aselgrp) + '"]').forEach(function (x) {
          x.checked = c.checked;
          if (c.checked) SEL_AUD[x.dataset.asel] = true; else delete SEL_AUD[x.dataset.asel];
        });
        _pintarLote();
      });
    });
    caja.querySelectorAll('button[data-amodo]').forEach(function (b) {
      b.addEventListener('click', function () { abrirModo(b.dataset.alin, b.dataset.amodo); });
    });
    caja.querySelectorAll('input[data-anota], input[data-accnuevo], input[data-amarca]').forEach(function (i) {
      i.addEventListener('keydown', function (ev) {
        var lin = i.dataset.anota || i.dataset.accnuevo || i.dataset.amarca;
        if (ev.key === 'Enter') guardarLinea(lin);
        if (ev.key === 'Escape') cerrarLinea(lin);
      });
    });
    // EL ESPEJO: con varias marcadas, el texto y el código nuevo se escriben en todas.
    caja.querySelectorAll('input[data-anota], input[data-accnuevo]').forEach(function (i) {
      i.addEventListener('input', function () {
        if (i.dataset.espejo !== '1') return;
        var sel = i.hasAttribute('data-anota') ? 'input[data-anota][data-espejo="1"]'
                                               : 'input[data-accnuevo][data-espejo="1"]';
        caja.querySelectorAll(sel).forEach(function (o) { if (o !== i) o.value = i.value; });
      });
    });
    caja.querySelectorAll('button[data-adeshacer]').forEach(function (b) {
      b.addEventListener('click', function () { deshacerLinea(b.dataset.adeshacer, b); });
    });
    caja.querySelectorAll('button[data-objetar]').forEach(function (b) {
      b.addEventListener('click', function () { objetar(b.dataset.objetar); });
    });
    caja.querySelectorAll('button[data-causa]').forEach(function (b) {
      b.addEventListener('click', function () { clasificarItem(b.dataset.causa); });
    });
    caja.querySelectorAll('button[data-ecausa]').forEach(function (b) {
      b.addEventListener('click', function () { clasificarComentario(b.dataset.ecausa); });
    });
  }

  // LA BARRA DE MARCADAS, como en la revisión: dice cuántas hay y dónde se actúa. Sin
  // verbos: los de la fila actúan sobre todas las marcadas.
  function _pintarLote() {
    var bar = $('audLote');
    if (!bar) return;
    var n = Object.keys(SEL_AUD).length;
    bar.style.display = n ? '' : 'none';
    if (!n) { bar.innerHTML = ''; return; }
    bar.innerHTML = '<b>' + n + ' barra(s) marcada(s)</b>' +
      '<span class="muted">RCA, Resuelto o No aplica en cualquiera de sus filas actúa sobre todas.</span>' +
      '<div style="flex:1"></div>' +
      '<button class="audmini" id="audLoteQuitar" title="Desmarcar todo">Quitar selección</button>';
    $('audLoteQuitar').addEventListener('click', function () {
      SEL_AUD = {};
      document.querySelectorAll('#audAcciones input[data-asel], #audAcciones input[data-aselgrp]')
        .forEach(function (x) { x.checked = false; });
      _pintarLote();
    });
  }

  // La línea y, si está marcada junto con otras, todas las marcadas.
  function _lineasDe(lin) {
    var ids = Object.keys(SEL_AUD);
    if (lin.charAt(0) === 'i' && SEL_AUD[lin.slice(1)] && ids.length > 1) {
      return ids.map(function (k) { return 'i' + k; });
    }
    return [lin];
  }

  // Abre (o cierra, si se vuelve a apretar el mismo) el campo de una salida.
  function abrirModo(lin, modo) {
    var lins = _lineasDe(lin);
    var b = _q1('button[data-amodo="' + modo + '"][data-alin="' + lin + '"]');
    var yaEsta = !!(b && b.classList.contains('eligiendo'));
    if (!yaEsta && modo !== 'nap') {
      var sinRca = lins.filter(function (l) {
        var x = _q1('button[data-amodo="cc"][data-alin="' + l + '"]');
        return !x || x.disabled;
      });
      if (sinRca.length) {
        aviso('Primero el RCA en ' + sinRca.map(function (l) {
          var r = _q1('tr[data-alin="' + l + '"] .audref');
          return r ? r.textContent : l;
        }).join(', ') + '.');
        return;
      }
    }
    lins.forEach(function (l) { _abrirLinea(l, yaEsta ? null : modo, lins.length); });
    if (!yaEsta) {
      var foco = modo === 'nuevo' ? _q1('input[data-accnuevo="' + lin + '"]') : _q1('input[data-anota="' + lin + '"]');
      if (foco) foco.focus();
    }
  }

  function _abrirLinea(l, modo, n) {
    ['cc', 'nuevo', 'nap'].forEach(function (m) {
      var b = _q1('button[data-amodo="' + m + '"][data-alin="' + l + '"]');
      if (b) b.classList.toggle('eligiendo', m === modo);
    });
    var nota = _q1('input[data-anota="' + l + '"]');
    var cc = _q1('input[data-accnuevo="' + l + '"]'), mc = _q1('input[data-amarca="' + l + '"]');
    if (nota) {
      nota.style.display = modo ? '' : 'none';
      if (!modo) nota.value = '';
      nota.dataset.modo = modo || '';
      nota.dataset.espejo = (modo && n > 1) ? '1' : '';
      if (modo) nota.placeholder = MODOS[modo].ph + (n > 1 ? ' (las ' + n + ' marcadas)' : '') + ' … y Enter';
    }
    if (cc) {
      cc.style.display = modo === 'nuevo' ? '' : 'none';
      if (modo !== 'nuevo') cc.value = '';
      cc.dataset.espejo = (modo === 'nuevo' && n > 1) ? '1' : '';
    }
    if (mc) {
      mc.style.display = modo === 'nuevo' ? '' : 'none';
      if (modo !== 'nuevo') mc.value = '';
    }
    // Mientras se justifica un «no aplica», la fila esconde el RCA: no se clasifica lo que
    // no aplica.
    var tr = _q1('tr[data-alin="' + l + '"]');
    if (tr) tr.classList.toggle('napabierto', modo === 'nap');
  }

  function cerrarLinea(lin) {
    _lineasDe(lin).forEach(function (l) { _abrirLinea(l, null, 1); });
  }

  function _lineasAbiertas() {
    var out = {};
    document.querySelectorAll('#audAcciones input[data-anota]').forEach(function (i) {
      if (i.style.display === 'none' || !i.dataset.modo) return;
      var l = i.dataset.anota;
      var ci = _q1('input[data-accnuevo="' + l + '"]'), mc = _q1('input[data-amarca="' + l + '"]');
      out[l] = { modo: i.dataset.modo, v: i.value, cc: ci ? ci.value : '', mc: mc ? mc.value : '',
                 espejo: i.dataset.espejo === '1' };
    });
    return out;
  }

  function _reabrirLineas(m) {
    var n = Object.keys(m).filter(function (l) { return m[l].espejo; }).length;
    Object.keys(m).forEach(function (l) {
      var x = m[l];
      _abrirLinea(l, x.modo, x.espejo ? Math.max(n, 2) : 1);
      var i = _q1('input[data-anota="' + l + '"]'); if (i) i.value = x.v;
      var ci = _q1('input[data-accnuevo="' + l + '"]'); if (ci) ci.value = x.cc;
      var mc = _q1('input[data-amarca="' + l + '"]'); if (mc) mc.value = x.mc;
    });
  }

  function _barraDeId(id) {
    var out = null;
    (AUD.elementos || []).forEach(function (e) {
      (e.barras_malas || []).forEach(function (b) { if (String(b.item_id) === String(id)) out = b; });
    });
    return out;
  }

  // ENTER: guarda la línea —o todas las marcadas— con la salida elegida y su texto.
  async function guardarLinea(lin) {
    var nota = _q1('input[data-anota="' + lin + '"]');
    if (!nota || !nota.dataset.modo) return;
    var modo = nota.dataset.modo, texto = (nota.value || '').trim();
    var lins = _lineasDe(lin);
    if (texto.length < 10) {
      aviso(modo === 'nap' ? 'Di por qué no aplica: lo va a leer quien auditó.'
                           : 'Escribe qué hiciste: el texto es obligatorio y lo lee quien auditó.');
      nota.focus();
      return;
    }
    var cc = '';
    if (modo === 'nuevo') {
      var ci = _q1('input[data-accnuevo="' + lin + '"]');
      cc = ((ci && ci.value) || '').trim();
      if (!cc) {
        aviso('Falta el código nuevo: sin él no hay dónde ir a buscarla.');
        if (ci) ci.focus();
        return;
      }
    }
    var marcas = {};
    lins.forEach(function (l) {
      var m = _q1('input[data-amarca="' + l + '"]');
      if (m && m.value.trim()) marcas[l.slice(1)] = m.value.trim();
    });
    var boton = _q1('button[data-amodo="' + modo + '"][data-alin="' + lin + '"]');
    _ocupado(boton, true);
    try {
      var url, cuerpo, tipo = modo === 'nuevo' ? 'nuevo' : 'item';
      if (lins.length > 1) {
        url = '/auditorias/' + AUD.id + '/items/lote';
        cuerpo = { ids: lins.map(function (l) { return Number(l.slice(1)); }),
                   accion: modo === 'nap' ? 'no_aplica' : 'resuelto', nota: texto };
        if (modo !== 'nap') cuerpo.tipo = tipo;
        if (modo === 'nuevo') { cuerpo.cc_nuevo = cc; cuerpo.marcas = marcas; }
      } else if (lin.charAt(0) === 'i') {
        var id = lin.slice(1);
        if (modo === 'nap') {
          url = '/auditorias/' + AUD.id + '/items/' + id + '/desestimar';
          cuerpo = { desestimado: true, motivo: texto };
        } else {
          url = '/auditorias/' + AUD.id + '/items/' + id + '/correccion';
          cuerpo = { corregido: true, tipo: tipo, nota: texto };
          if (modo === 'nuevo') { cuerpo.cc_nuevo = cc; cuerpo.item_nuevo = marcas[id] || null; }
        }
      } else {
        url = '/auditorias/' + AUD.id + '/elementos/' + lin.slice(1) + '/resolucion';
        cuerpo = modo === 'nap' ? { aplica: false, nota: texto }
                                : { aplica: true, corregido: true, nota: texto, tipo: tipo, cc_nuevo: cc || null };
      }
      AUD = await req('PUT', url, cuerpo);
      // Lo guardado ya no es «a medio escribir»: que el repintado no lo vuelva a abrir.
      lins.forEach(function (l) { _abrirLinea(l, null, 1); });
      // AL GUARDAR SE SUELTA LO MARCADO, como al cerrar un código en la revisión.
      if (lins.length > 1) SEL_AUD = {};
      var msg = _mensajeGuardado(modo, lins);
      if (msg.mal) aviso(msg.txt); else ok(msg.txt);
      await cargarLista();
      pintarDetalle();
    } catch (e) { aviso(e.message); _ocupado(boton, false); }
  }

  // Lo que dijo aSa, en el aviso: si quedó idéntica, se dice fuerte, porque traba el cierre.
  function _mensajeGuardado(modo, lins) {
    if (modo === 'nap') {
      return { txt: lins.length > 1 ? lins.length + ' líneas quedan sin efecto' : 'No aplica, con tu explicación' };
    }
    if (lins[0].charAt(0) === 'e') return { txt: 'Resuelto' };
    var ids = {}, ed = 0, igual = 0, nd = 0;
    lins.forEach(function (l) { ids[l.slice(1)] = 1; });
    (AUD.elementos || []).forEach(function (e) {
      (e.barras_malas || []).forEach(function (b) {
        if (!ids[b.item_id]) return;
        if (b.verificado === 'ok') ed++; else if (b.verificado === 'sigue_igual') igual++; else nd++;
      });
    });
    var p = [];
    if (ed) p.push(ed + ' editada(s) en aSa');
    if (igual) p.push(igual + ' idéntica(s) en aSa: corrígela(s) o no se podrá cerrar');
    if (nd) p.push(nd + ' sin comprobar');
    return { txt: 'Resuelto' + (lins.length > 1 ? ' (' + lins.length + ')' : '') + (p.length ? ' · ' + p.join(', ') : ''),
             mal: igual > 0 };
  }

  async function deshacerLinea(lin, boton) {
    _ocupado(boton, true);
    try {
      var id = lin.slice(1), url, cuerpo;
      if (lin.charAt(0) === 'e') {
        url = '/auditorias/' + AUD.id + '/elementos/' + id + '/resolucion';
        cuerpo = { aplica: true, corregido: false };
      } else {
        var b = _barraDeId(id);
        if (b && b.desestimado) {
          url = '/auditorias/' + AUD.id + '/items/' + id + '/desestimar';
          cuerpo = { desestimado: false, motivo: 'Vuelve a quedar por resolver.' };
        } else {
          url = '/auditorias/' + AUD.id + '/items/' + id + '/correccion';
          cuerpo = { corregido: false };
        }
      }
      AUD = await req('PUT', url, cuerpo);
      ok('Vuelve a quedar por resolver');
      await cargarLista();
      pintarDetalle();
    } catch (e) { aviso(e.message); _ocupado(boton, false); }
  }

  // MIENTRAS EL SERVIDOR RESPONDE, EL BOTÓN LO DICE. Sin esto quedaban «pegados»: el clic
  // no cambiaba nada a la vista y la gente apretaba de nuevo.
  function _ocupado(el, si) {
    if (!el) return;
    el.disabled = !!si;
    el.classList.toggle('audwait', !!si);
  }

  // CERRAR, cuando no queda ninguna línea por resolver. Lo aprieta quien respondió, y
  // cierra la auditoría completa. EL SERVIDOR COMPARA CON aSa: si alguna barra resuelta
  // sigue idéntica, contesta 409 con la lista y NO cierra (6-nov: «el cerrar igual no me
  // gusta, porque rompe el flujo»). Se repinta con lo que aSa dijo y se muestra cuáles son.
  async function cerrarResueltas() {
    var b = $('audBtnCerrarOk');
    _ocupado(b, true);
    if (b) b.textContent = 'Comparando con aSa…';
    try {
      AUD = await req('POST', '/auditorias/' + AUD.id + '/cerrar-resueltas', {});
      ok('Auditoría cerrada');
      await cargarLista(); await cargarIndicadores(); pintarDetalle();
    } catch (e) {
      var det = e.detalle || null;
      if (e.status === 409 && det && det.motivo === 'sigue_igual') {
        try { AUD = await req('GET', '/auditorias/' + AUD.id); } catch (e2) { /* se queda lo que había */ }
        pintarDetalle();
        _avisoCierre(det);
        return;
      }
      aviso(e.message);
      _ocupado(b, false);
      if (b) b.textContent = 'Cerrar la auditoría';
    }
  }

  // POR QUÉ NO CERRÓ: qué barras siguen idénticas en aSa. Sin «cerrar igual».
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
      '<div class="audenviop"><button class="audmini" id="audCierreNo">Entendido</button></div>';
    var cab = caja.querySelector('.audcab');
    caja.insertBefore(div, cab ? cab.nextSibling : caja.firstChild);
    div.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('audCierreNo').addEventListener('click', function () { div.remove(); });
  }

  // LA MATRIZ ISHIKAWA DE UNA BARRA. Es la MISMA matriz de los reclamos, con la misma
  // función: el modal lee la selección de `audIshikawa` y devuelve la elegida por
  // `audCausaElegida`. CON BARRAS MARCADAS, la causa va para todas (6-nov: «que aplique
  // incluso al RCA»); la matriz abre con la de la barra que se apretó.
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
    var ids = Object.keys(SEL_AUD);
    CAUSA_DE = { auditoria_id: AUD.id, item_id: b.item_id, causa: b.causa,
                 causa_categoria: b.causa_categoria, causa_texto: b.causa_texto,
                 ref: b.ref, elemento: el && el.nombre,
                 ids: (SEL_AUD[b.item_id] && ids.length > 1) ? ids.map(Number) : null };
    global.abrirIshikawaModal('auditoria');
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
      await cargarLista(); pintarDetalle();
    } catch (e) { aviso(e.message); }
  }

  // Lo que el auditor dejó como «debería decir», en una línea.
  function _esperadoTxt(esp) {
    var k = Object.keys(esp || {});
    if (!k.length) return '';
    return k.map(function (x) {
      var v = esp[x];
      return x + ' = ' + (v && typeof v === 'object' ? Object.keys(v).map(function (L) { return L + ' ' + v[L]; }).join(', ') : v);
    }).join(' · ');
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
      // guarda, no qué se pregunta. MANDA LA BARRA (5-nov): las filas de «Mis correcciones»
      // traen la barra Y su elemento, y preguntar primero por el elemento mandaba la causa
      // de una barra al comentario del elemento («Ese elemento tiene barras marcadas»), así
      // que nadie podía clasificar desde ahí ni, por lo tanto, dar nada por corregido.
      var ruta = a.item_id
        ? '/auditorias/' + a.auditoria_id + '/items/' + a.item_id + '/causa'
        : '/auditorias/' + a.auditoria_id + '/elementos/' + a.elemento_id + '/resolucion';
      var cuerpo = { causa: sel.cod_causa, causa_categoria: sel.categoria, causa_texto: sel.sub_causa };
      // CON BARRAS MARCADAS, PARA TODAS (6-nov). La selección se mantiene: lo siguiente suele
      // ser resolverlas juntas.
      if (a.ids) {
        ruta = '/auditorias/' + a.auditoria_id + '/items/lote';
        cuerpo = Object.assign({ ids: a.ids, accion: 'causa' }, cuerpo);
      }
      var r = await req('PUT', ruta, cuerpo);
      ok(a.ids ? 'RCA para las ' + a.ids.length + ' barras marcadas' : 'Causa registrada');
      await cargarIndicadores();
      if (AUD && AUD.id === a.auditoria_id) { AUD = r; pintarDetalle(); }
    } catch (e) { aviso(e.message); }
  };

  // Expuesto para los tests: lo puro.
  global.__auditoriasTest = { marcar: marcar, HALLAZGO_TXT: HALLAZGO_TXT, ACCION_TXT: ACCION_TXT,
                              normalizarBarra: normalizarBarra, letrasUsadas: letrasUsadas,
                              celdaFigura: celdaFigura, FIG_TAM: FIG_TAM };

})(window);
