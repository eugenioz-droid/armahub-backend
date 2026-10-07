// aSa DATA (29-sep) — los reportes que se arman sobre el espejo de aSa.
//
// Sub-tab «Programa Planta»: dos cajas, y la división la da aSa con el estado de su
// programación de planta — Unscheduled es el stock, Scheduled/Confirmed lo programado.
// Eso viaja resuelto en `programado`: la regla vive en el backend y acá no se repite.
//
// QUÉ HACE CADA LADO. El backend manda TODAS las filas del período; este archivo filtra
// por obra, cubicador y estado, y suma. Los totales se recalculan acá porque tienen que
// corresponder a lo que se ve: si mostraran el del servidor, el número del encabezado no
// cuadraría con las filas de abajo. Y los conteos de los botones salen de esas mismas
// filas filtradas — cuando no era así, decían «En producción 148» con una obra que tenía
// cero.
(function (global) {
  'use strict';

  var DATA = null, ANIO = null, MESES = [], OBRAS = [], PERSONAS = [], BUSCA = '';
  // QUÉ ES CADA CAJA (definición del usuario, 29-sep):
  //
  //   pp · POR PROGRAMAR = los códigos SIN fecha de despacho. Es el STOCK DISPONIBLE de
  //        cubicaciones de la obra: están hechos, pero o no están listos o el cliente
  //        todavía no los pidió.
  //   pg · PROGRAMADOS   = los que YA tienen fecha de despacho.
  //
  // Los botones de estado son el «bonus track»: en programados, apagar los despachados
  // deja a la vista LO PRÓXIMO QUE SE ENVÍA —que es lo que se quiere mirar, porque todo
  // lo que ya está en obra tuvo fecha— y «en producción» avisa qué se está fabricando.
  //
  // Cada caja lleva SUS botones y su propia lista de ocultos: las dos tienen estados
  // distintos y tocar una no debe cambiar la otra. Se guarda lo APAGADO y no lo
  // encendido, para que un estado nuevo que aparezca en aSa se vea por defecto en vez de
  // quedar invisible sin que nadie se entere.
  var OCULTOS = null;   // {pp: [...], pg: [...]}; null = lo fija la primera carga
  var MESN = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  // aSa devuelve 18 «DetailPerson», entre ellos aSaAdmin, EugenioZ y gente que ya no
  // cubica. El usuario quiere ver SÓLO su equipo: elige cuáles se muestran como chips y
  // la elección se recuerda en este navegador (es una comodidad de vista, no un dato).
  var DET = leerDet(), ELIGIENDO = false;
  var DET_CLAVE = 'prgDshDetailers';
  var PRIMER_ANIO = 2021;   // desde cuándo se trae la historia de aSa

  function leerDet() {
    try { var v = JSON.parse(localStorage.getItem('prgDshDetailers') || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function guardarDet() { try { localStorage.setItem(DET_CLAVE, JSON.stringify(DET)); } catch (e) {} }

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Miles con punto y dos decimales con coma, como el informe original.
  function kg(n) {
    return (Number(n) || 0).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // Sin decimales, para las columnas angostas: en la lista de obras los centésimos de
  // kilo no deciden nada y se comen el ancho que necesita el nombre.
  function kg0(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  // El usuario lo pidió explícito: la fecha comprometida se muestra dd/mm.
  function ddmm(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? (p[2] + '/' + p[1]) : iso;
  }

  async function req(metodo, url, cuerpo) {
    var opts = { method: metodo, headers: Object.assign({}, global.authHeaders()) };
    if (cuerpo !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(cuerpo); }
    var res = await fetch(global.apiUrl(url), opts);
    if (res.status === 401) { global.logout(); return null; }
    var data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var det = data && data.detail;
      // Un 422 de FastAPI trae una LISTA de errores de validación; mostrarla tal cual da
      // «[object Object]», que no le dice nada a nadie.
      if (Array.isArray(det)) det = det.map(function (d) { return (d.loc || []).slice(-1) + ': ' + d.msg; }).join(' · ');
      throw new Error((det && (det.msg || det)) || ('Error ' + res.status));
    }
    return data;
  }

  // Sólo los parámetros con valor. Mandar `anio=` vacío es un 422 seguro: FastAPI no
  // convierte "" a entero. Pasó en la primera carga, cuando el año aún no se conoce.
  function qs(obj) {
    var p = [];
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
      p.push(encodeURIComponent(k) + '=' + encodeURIComponent(Array.isArray(v) ? v.join(',') : v));
    });
    return p.length ? '?' + p.join('&') : '';
  }
  function aviso(m) { if (global.showToast) global.showToast(m, 'error'); else alert(m); }

  // LOS CLICS EN LOS FILTROS SE SENTÍAN LENTOS, y a veces «no prendían»: repintar miles
  // de filas tarda, y el navegador no pinta el chip encendido hasta que el handler
  // termina. Así que el chip se pinta primero y lo pesado se deja para el cuadro
  // siguiente: la respuesta visual es inmediata aunque la tabla tarde.
  function diferir(fn) {
    var raf = global.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    raf(function () { setTimeout(fn, 0); });
  }
  function repintarTodo() { pintarChips(); diferir(function () { pintarObras(); pintarTablas(); }); }

  // Sub-tabs de aSa Data. Hoy hay uno solo; la función existe desde ya para que agregar
  // el siguiente reporte sea añadir una línea a la lista y su panel al HTML.
  var SUBTABS = [['planta', 'asaSubPlanta', 'asaPanelPlanta'],
                 ['obras',  'asaSubObras',  'asaPanelObras'],
                 ['cub',    'asaSubCub',    'asaPanelCub'],
                 ['mes',    'asaSubMes',    'asaPanelMes'],
                 ['seg',    'asaSubSeg',    'asaPanelSeg'],
                 ['tipo',   'asaSubTipo',   'asaPanelTipo'],
                 ['atr',    'asaSubAtr',    'asaPanelAtr']];
  var SUB = 'planta';
  global.asaSubTab = function (v) {
    SUB = v;
    SUBTABS.forEach(function (t) {
      var on = (t[0] === v), b = $(t[1]), p = $(t[2]);
      if (b) b.className = on ? 'asasub on' : 'asasub';
      if (p) p.style.display = on ? '' : 'none';
    });
    // La columna de la derecha lleva el resumen mensual, que sólo tiene sentido en
    // «Obras aSa»; en el otro sub-tab se esconde y las cajas se llevan ese ancho.
    var lat = $('dshLateral');
    if (lat) lat.style.display = (v === 'obras') ? '' : 'none';
    // En «Obras aSa» la lista de obras va DENTRO del panel (con su barra por estado) y
    // en «Atributos» la tabla ya trae los kilos: en los dos la columna fija se esconde y
    // el panel se lleva ese ancho.
    // ...y en «Por cubicador» también, para que el gráfico se lleve todo el ancho.
    var col = $('dshColObras');
    if (col) col.style.display = (v === 'obras' || v === 'atr' || v === 'mes') ? 'none' : '';
    // Este sub-tab trae su propia data (agregada, y sin filtro de período), así que se
    // pide la primera vez que se abre y no en cada cambio de pestaña.
    if (v === 'cub' && !CUB) { cargarCub().then(pintarTablas); return; }
    if (v === 'atr' && !ATR) { cargarAtr().then(pintarTablas); return; }
    // Se repinta sólo el panel que se abre. Los filtros son compartidos y NO se tocan:
    // cambiar de sub-tab conserva la obra, el cubicador y el período ya elegidos.
    if (DATA) pintarTablas();
  };

  var _bound = false;
  global.loadAsaData = async function () {
    if (!$('tab-asa_data')) return;
    if (!_bound) {
      _bound = true;
      $('dshSync').addEventListener('click', sincronizar);
      $('dshDetElegir').addEventListener('click', function () { ELIGIENDO = !ELIGIENDO; pintarChips(); });
      $('dshBuscaObra').addEventListener('input', function () {
        BUSCA = this.value.trim().toLowerCase(); pintarObras();
      });
      $('dshBuscaCc').addEventListener('input', function () {
        BUSCA_CC = this.value.trim().toLowerCase(); pintarTablas();
      });
      $('dshBuscaAtr').addEventListener('input', function () {
        BUSCA_ATR = this.value.trim().toLowerCase(); pintarTablas();
      });
    }
    await cargar();
  };

  async function cargar() {
    // Mientras baja el período (un año son ~900 KB) se dice que se está cargando: sin
    // esto, el clic en el año parecía no hacer nada durante uno o dos segundos.
    $('dshEspejo').textContent = 'Cargando…';
    try {
      DATA = await req('GET', '/programacion/asa/reporte' + qs({ anio: ANIO, meses: MESES }));
      if (!DATA) return;
      ANIO = DATA.anio;
      FILAS_VIVAS = (DATA.filas || []).filter(function (f) { return f.estado !== DATA.estado_nunca; });
      CON_BOTON = DATA.estados_con_boton || [];
      // El único que arranca apagado es el despachado, y sólo la primera vez: después
      // manda lo que el usuario haya tocado.
      if (OCULTOS === null) {
        var d = DATA.estado_apagado_por_defecto;
        // `cub` arranca sin nada oculto: ese tab existe para comparar los tres
        // estados, y esconder el despachado de entrada lo dejaría a medias.
        OCULTOS = { pp: [d], pg: [d], cub: [] };
      }
    } catch (e) { aviso(e.message); mostrarVacio(e.message); return; }
    pintarTodo();
  }

  function mostrarVacio(msg) {
    $('dshPorProgramar').innerHTML = '';
    $('dshProgramados').innerHTML = '';
    $('dshAviso').className = 'prgaviso mal';
    $('dshAviso').innerHTML = '<b>No se pudo cargar el reporte.</b> ' + esc(msg || '');
  }

  // CUÁNDO SE TRAJO ESTO. Un espejo no dice su edad solo, y el 6-oct la carga de 2026 se
  // atoró a los 20 s: la pantalla siguió mostrando lo de una semana antes como si nada
  // («presioné actualizar y creería que no se actualizó nada»). Ahora el encabezado dice
  // cuándo se trajo, y si el último intento de ESE año falló lo dice con su motivo.
  function fechaHora(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var dos = function (n) { return (n < 10 ? '0' : '') + n; };
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }

  function pintarTodo() {
    var esp = DATA.espejo || {};
    var intento = esp.ultimo_intento;
    $('dshEspejo').textContent = esp.filas_anio
      ? esp.filas_anio + ' códigos de control en ' + (DATA.anio ? DATA.anio : 'toda la historia') +
        (DATA.anulados ? ' · ' + DATA.anulados + ' anulados (sólo en la barra por estado de Obras aSa)' : '') +
        (esp.ultima_sync ? ' · traído de aSa el ' + fechaHora(esp.ultima_sync) : '')
      : '';
    if (intento && intento.ok === false) {
      $('dshAviso').className = 'prgaviso mal';
      $('dshAviso').innerHTML = '<b>Lo último que se trajo de ' + esc(String(DATA.anio || '')) +
        ' falló</b>' + (intento.fin ? ' (' + esc(fechaHora(intento.fin)) + ')' : '') + ': ' +
        esc(intento.detalle || 'sin detalle') + '. Lo que se ve es de la última vez que sí se pudo' +
        (esp.ultima_sync ? ', el ' + esc(fechaHora(esp.ultima_sync)) : '') + '. Vuelve a pulsar ↻ Traer de aSa.';
    }
    // Un espejo vacío no es un error, pero tampoco es «no hay trabajo»: hay que decir
    // que falta traer la data, o el usuario lee cero donde hay cientos de toneladas.
    if (!esp.filas_anio) {
      $('dshAviso').className = 'prgaviso';
      $('dshAviso').innerHTML = 'Todavía no se ha traído nada de aSa para <b>' + DATA.anio +
        '</b>. Pulsa <b>↻ Traer de aSa</b> — se piden los pedidos del año agregados por ' +
        'código de control (unos 5.000, tarda unos segundos).';
    } else {
      $('dshAviso').innerHTML = '';
    }
    pintarChips();
    pintarObras();
    pintarTablas();
  }

  // Un botón por estado, con SU CONTEO YA FILTRADO por obra y cubicador. Ese detalle es
  // el que importa: antes los conteos eran del año entero y mentían —con una obra
  // seleccionada decían «En producción 148» cuando esa obra tenía cero—. Y sólo se
  // ofrecen los estados que de verdad aparecen en ESA caja: por eso «Sin terminar» sale
  // en el stock, donde sí hay, y no en programados, donde nunca hubo.
  //
  // Todos los botones van del MISMO color. Uno por estado confundía: parecía una etiqueta
  // de categoría y no un interruptor. Encendido = se ve; apagado = gris y tachado.
  function pintarEstados(caja, cont, filasCaja) {
    var conteo = {};
    filasCaja.forEach(function (f) {
      var e = f.estado || '?';
      if (!conteo[e]) conteo[e] = { cc: 0, kg: 0 };
      conteo[e].cc++; conteo[e].kg += f.kg;
    });
    cont.innerHTML = '';
    // SÓLO los estados con botón. `Open` no lo tiene a propósito: es la base de la caja,
    // no algo que uno quiera sacar. Antes se generaba un botón por cada estado presente
    // y aparecían filtros que nadie pidió ni necesita.
    Object.keys(conteo).sort().filter(conBoton).forEach(function (e) {
      var c = conteo[e], oculto = OCULTOS[caja].indexOf(e) !== -1;
      var b = document.createElement('button');
      b.className = oculto ? 'off' : '';
      b.innerHTML = esc((DATA.nombres_estado || {})[e] || e) + ' <b>' + c.cc + '</b>';
      b.title = ((DATA.explica_estado || {})[e] || e) + '\n' +
                c.cc + ' códigos · ' + kg(c.kg) + ' kg' +
                (oculto ? ' (oculto)' : '') +
                '\nClic: ver sólo éste · Ctrl+clic: encender o apagar';
      b.addEventListener('click', function (ev) {
        // Misma regla que el resto, pero lo que se guarda es lo OCULTO: «ver sólo éste»
        // se escribe como «ocultar todos los demás».
        var todos = Object.keys(conteo).filter(function (x) { return conBoton(x); });
        if (ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) {
          var i = OCULTOS[caja].indexOf(e);
          if (i === -1) OCULTOS[caja].push(e); else OCULTOS[caja].splice(i, 1);
        } else {
          var visiblesAhora = todos.filter(function (x) { return OCULTOS[caja].indexOf(x) === -1; });
          var soloEste = (visiblesAhora.length === 1 && visiblesAhora[0] === e);
          OCULTOS[caja] = soloEste ? [] : todos.filter(function (x) { return x !== e; });
        }
        // Respuesta inmediata en el botón tocado; el repintado completo va después.
        b.className = OCULTOS[caja].indexOf(e) !== -1 ? 'off' : '';
        diferir(function () { pintarObras(); pintarTablas(); });
      });
      cont.appendChild(b);
    });
  }

  // CÓMO SE COMPORTAN TODOS LOS FILTROS, en un solo lugar:
  //   clic          → deja SÓLO ése
  //   clic sobre el único elegido → lo suelta, y vuelven todos
  //   Ctrl/Cmd+clic → suma o quita, sin tocar el resto
  //
  // Antes el clic era aditivo y había que acordarse de desmarcar lo anterior; el caso
  // normal es querer mirar una cosa a la vez. Vale igual para meses, personas y obras,
  // porque un filtro que se comporta distinto según dónde esté es peor que cualquiera
  // de las dos formas.
  function alternar(lista, valor, ev) {
    var i = lista.indexOf(valor);
    if (ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) {
      if (i === -1) lista.push(valor); else lista.splice(i, 1);
    } else if (lista.length === 1 && i === 0) {
      lista.length = 0;                        // era el único: se suelta
    } else {
      lista.length = 0; lista.push(valor);     // sólo ése
    }
    return lista;
  }

  function chips(cont, valores, activos, onClick, etiqueta, titulo) {
    cont.innerHTML = '';
    valores.forEach(function (v) {
      var b = document.createElement('button');
      b.textContent = etiqueta ? etiqueta(v) : v;
      if (titulo) b.title = titulo(v);
      if (activos.indexOf(v) !== -1) b.className = 'on';
      b.addEventListener('click', function (ev) { onClick(v, ev); });
      cont.appendChild(b);
    });
  }

  function pintarChips() {
    // Si el espejo está vacío no hay años que ofrecer; se muestra el actual igual, porque
    // es el que se va a sincronizar.
    // El año es un interruptor: tocar el que está encendido lo suelta y se ve la
    // historia completa. `0` es «todos» — hace falta un valor explícito porque la
    // ausencia del parámetro ya significaba «el año actual».
    var anios = (DATA.anios && DATA.anios.length) ? DATA.anios : [DATA.anio];
    // Año y mes descargan el período de nuevo: el chip se enciende ANTES de pedir, y
    // `cargar()` avisa «Cargando…» mientras baja. Si no, el clic parecía muerto.
    chips($('dshAnios'), anios, [ANIO], function (v) {
      ANIO = (ANIO === v) ? 0 : v;
      pintarChips(); cargar();
    });
    chips($('dshMeses'), [1,2,3,4,5,6,7,8,9,10,11,12], MESES, function (m, ev) {
      alternar(MESES, m, ev);
      pintarChips(); cargar();
    }, function (m) { return MESN[m - 1]; });
    // Chips de cubicador: los que aparecen con las obras elegidas, y de ésos sólo los
    // que el usuario decidió ver (DET). Sin elección de DET, todos. La lista completa
    // para el botón «elegir» sale del año entero, no del filtro.
    var todas = DATA.personas || [];
    var presentes = valoresDe('persona', 'persona', PERSONAS);
    var visibles = presentes.filter(function (p) { return !DET.length || DET.indexOf(p) !== -1; });
    chips($('dshPersonas'), visibles, PERSONAS, function (p, ev) {
      alternar(PERSONAS, p, ev);
      // pintarChips() TAMBIÉN: sin esto el chip no cambia de color y parece que el
      // clic no hizo nada, aunque el filtro sí se aplicó. Pasó.
      repintarTodo();
    });
    // Segmento y tipo: los valores del backend más «(sin)», siempre todos —son pocos y
    // ver el chip vacío también informa.
    var repintar = repintarTodo;
    chips($('dshSegs'), (DATA.segmentos || []).concat([SIN]), SEGS, function (v, ev) {
      alternar(SEGS, v, ev); repintar();
    }, function (v) { return v === SIN ? 'Sin segmento' : v; });
    chips($('dshTipos'), (DATA.tipos || []).concat([SIN]), TIPOS, function (v, ev) {
      alternar(TIPOS, v, ev); repintar();
    }, function (v) { return v === SIN ? 'Sin tipo' : v; });
    // El botón dice en qué estado está: cerrado invita a configurar, abierto a cerrar.
    $('dshDetElegir').textContent = ELIGIENDO ? '✓ Listo' : '⚙ Mi equipo';
    $('dshDetElegir').className = ELIGIENDO ? 'dshcfg on' : 'dshcfg';
    $('dshDetPanel').style.display = ELIGIENDO ? '' : 'none';
    var lista = $('dshDetLista');
    if (!ELIGIENDO) return;
    lista.innerHTML = todas.map(function (p) {
      return '<label><input type="checkbox" data-det="' + esc(p) + '"' +
             (DET.indexOf(p) !== -1 ? ' checked' : '') + '>' + esc(p) + '</label>';
    }).join('');
    lista.querySelectorAll('input[data-det]').forEach(function (c) {
      c.addEventListener('change', function () {
        var p = c.dataset.det, i = DET.indexOf(p);
        if (c.checked && i === -1) DET.push(p);
        else if (!c.checked && i !== -1) DET.splice(i, 1);
        guardarDet();
        // Un cubicador que deja de mostrarse tampoco puede seguir filtrando.
        PERSONAS = PERSONAS.filter(function (x) { return !DET.length || DET.indexOf(x) !== -1; });
        pintarChips(); pintarTablas();
      });
    });
  }

  // ── Cruce de filtros ───────────────────────────────────────────────────────
  // Los filtros se cruzan entre sí: al elegir un cubicador, la lista de obras muestra
  // sólo las suyas, y al elegir obras, los chips de cubicador muestran sólo a quienes
  // trabajan en ellas. La regla que evita el callejón sin salida es que UN FILTRO NUNCA
  // SE FILTRA A SÍ MISMO: si al marcar una obra desaparecieran las demás, no habría cómo
  // marcar una segunda. Y un valor ya elegido se muestra siempre, aunque el otro filtro
  // lo dejaría fuera — si no, no habría cómo desmarcarlo.
  // Las filas SIN anulados. El reporte trae también los Cancelled, pero sólo para la
  // barra por estado de la lista de obras; todo lo demás cuenta trabajo, y un anulado
  // no lo es. Se filtra UNA vez al cargar, no en cada repintado.
  var FILAS_VIVAS = [];
  function todasLasFilas() {
    return FILAS_VIVAS;
  }
  // En qué caja va cada fila lo decide el BACKEND y viaja resuelto en `programado`: es la
  // regla de negocio y no puede quedar repartida entre el servidor y el navegador. Sale
  // del estado de planta de aSa (Scheduled/Confirmed = agendado) y no de una fecha.
  function programado(f) { return !!f.programado; }
  function conFecha(filas) { return filas.filter(programado); }
  function sinFecha(filas) { return filas.filter(function (f) { return !programado(f); }); }
  // El filtro de estado sólo aplica a PROGRAMADOS, que es donde están los botones.
  // DOS funciones, no una con un argumento opcional. La de un solo argumento es la que
  // se le pasa a `.filter()`, y por eso es segura: filter entrega TRES argumentos
  // (elemento, índice, arreglo) y un segundo parámetro opcional recibiría el índice.
  // Con `OCULTOS[1]` undefined, reventaba en el segundo elemento. Ya pasó una vez.
  // En «Programado Cubicador» la tabla es una sola, así que todas las filas caen en
  // la misma caja; en los otros sub-tabs depende de si está agendada o no.
  function cajaDe(f) { return SUB === 'cub' ? 'cub' : (programado(f) ? 'pg' : 'pp'); }
  // Qué estados se pueden encender y apagar. Lo dice el backend, pero vive en su propia
  // variable y no se lee de DATA: así la regla de visibilidad no depende de si la
  // respuesta ya llegó, y se puede probar sin servidor.
  var CON_BOTON = [];
  function conBoton(estado) { return CON_BOTON.indexOf(estado) !== -1; }
  // Un estado SIN botón no se puede ocultar: quedaría escondido sin nada en pantalla
  // para volver a encenderlo.
  function visible(f) { return !conBoton(f.estado) || OCULTOS[cajaDe(f)].indexOf(f.estado) === -1; }
  function visibleEn(caja, f) { return !conBoton(f.estado) || OCULTOS[caja].indexOf(f.estado) === -1; }

  // SEGMENTO y TIPO de la obra: lo cargan los cubicadores en «Atributos de obra» y viaja
  // en cada fila. «(sin)» es un valor más, para poder ver lo que falta por catalogar.
  var SEGS = [], TIPOS = [], SIN = '(sin)';
  function segDe(f) { return f.segmento || SIN; }
  function tipoDe(f) { return f.tipo || SIN; }

  function filtrar(filas, salvo) {
    return filas.filter(function (f) {
      if (salvo !== 'obra' && OBRAS.length && OBRAS.indexOf(f.obra) === -1) return false;
      if (salvo !== 'persona' && PERSONAS.length && PERSONAS.indexOf(f.persona) === -1) return false;
      if (SEGS.length && SEGS.indexOf(segDe(f)) === -1) return false;
      if (TIPOS.length && TIPOS.indexOf(tipoDe(f)) === -1) return false;
      return true;
    });
  }

  function valoresDe(campo, salvo, elegidos) {
    // Se cuenta lo que el usuario puede llegar a ver: lo de POR PROGRAMAR entero, y de
    // PROGRAMADOS sólo los estados encendidos. Si no, la lista ofrecería obras que al
    // marcarlas dejan las dos cajas vacías.
    var vistos = {};
    var base = filtrar(todasLasFilas(), salvo).filter(visible);
    base.forEach(function (f) { if (f[campo]) vistos[f[campo]] = 1; });
    elegidos.forEach(function (v) { vistos[v] = 1; });
    return Object.keys(vistos).sort();
  }

  // La columna de obra FILTRA y RESUME a la vez: además de marcar, muestra cuántos
  // códigos y cuántos kilos tiene cada una, ordenables por encabezado. Antes eso estaba
  // también en un cuadro aparte de «Obras aSa» — la misma información dos veces, y dos
  // lugares donde podía dejar de cuadrar.
  function pintarObras() {
    // LA COLUMNA FIJA ES LA LISTA MEJORADA (obra, CC, kilos y barra por estado), la
    // misma de «Obras aSa»: al usuario le gustó y sobra ancho en las cajas. Nada de
    // ordenar por encabezado: la más grande arriba, siempre.
    var R = pintarLista($('dshObras'), BUSCA);
    $('dshObrasN').innerHTML = '· ' + R.obras.length + ' · <b style="color:#33691e">' + kg0(R.total) + ' kg</b>';
    $('dshObrasLey').innerHTML = leyenda(R);
  }

  // Las dos tablas tienen las mismas columnas salvo la fecha, así que se pintan con la
  // misma función: una sola definición de cómo se ve una fila.
  function tabla(el, filas, llevaFecha, ocultosPorEstado) {
    if (!filas.length) {
      // Distinguir «no hay nada» de «lo hay pero lo apagaste» evita el susto de creer que
      // falta data: le pasó al usuario comparando contra su Power BI.
      var msg = ocultosPorEstado
        ? ocultosPorEstado + ' código(s) ocultos por el filtro de estado — enciéndelo arriba'
        : 'Sin datos con estos filtros';
      el.innerHTML = '<tbody><tr><td class="dshvacio">' + esc(msg) + '</td></tr></tbody>';
      return 0;
    }
    var total = filas.reduce(function (a, f) { return a + f.kg; }, 0);
    // Anchos en %: las dos cajas ocupan la misma columna, así que las dos tablas miden lo
    // mismo aunque PROGRAMADOS tenga una columna más. Los porcentajes de cada variante
    // suman 100 y salen de las dos columnas angostas (código y fecha), que son de largo
    // conocido; lo que sobra se reparte entre obra y descripción.
    // QUIÉN Y CUÁNDO. El usuario necesita saber cuándo se dejó de cubicar un código, y aSa
    // no tiene esa fecha en ninguno de sus tres endpoints. Van las dos que sí existen: la
    // del PEDIDO, que no se mueve, y la ÚLTIMA MODIFICACIÓN del pedido, que es lo más
    // cercano —medido sobre 1.138 códigos: en los abiertos el 47% no se tocó después del
    // día del pedido, pero en los despachados la mediana sube a 10 días, o sea que
    // fabricar y despachar también la mueven—. El encabezado lo dice en su title.
    var TIT_MOD = 'Última vez que aSa tocó el pedido. aSa no guarda cuándo se terminó de ' +
                  'cubicar: mientras el código está por programar suele ser el cubicador, ' +
                  'pero fabricar o despachar también la mueven.';
    // «Creado» y no «Pedido»: es el día en que nació el código. Es el `OrderDate` de aSa,
    // que es una fecha escrita y no una marca del sistema, pero en los hechos son lo
    // mismo — medido sobre 26.000 códigos: sólo 2 tienen el pedido fechado después de su
    // última modificación, o sea sólo 2 se escribieron con fecha posterior.
    var TIT_CREADO = 'Fecha del pedido en aSa (OrderDate): el día en que nació el código.';
    var html = llevaFecha
      ? '<thead><tr><th style="width:20%">Obra</th><th style="width:6%">Job</th>' +
        '<th style="width:26%">Descr</th><th style="width:10%">Cubicó</th>' +
        '<th style="width:6%">Código</th>' +
        '<th style="width:7%" title="' + esc(TIT_CREADO) + '">Creado</th>' +
        '<th style="width:7%" title="' + esc(TIT_MOD) + '">Últ. cambio</th>' +
        '<th style="width:7%">Despacho</th>' +
        '<th class="num" style="width:11%">Kilos</th></tr></thead><tbody>'
      : '<thead><tr><th style="width:23%">Obra</th><th style="width:6%">Job</th>' +
        '<th style="width:30%">Descr</th><th style="width:10%">Cubicó</th>' +
        '<th style="width:6%">Código</th>' +
        '<th style="width:7%" title="' + esc(TIT_CREADO) + '">Creado</th>' +
        '<th style="width:7%" title="' + esc(TIT_MOD) + '">Últ. cambio</th>' +
        '<th class="num" style="width:11%">Kilos</th></tr></thead><tbody>';
    // TOPE DE FILAS, igual que en el detalle de códigos: con los despachados encendidos
    // son 4.300 filas por caja, y dibujarlas en cada clic es lo que hacía lentos los
    // filtros. El total del encabezado sí es de todas.
    var recorte = filas.length > TOPE_FILAS;
    var visibles = recorte ? filas.slice(0, TOPE_FILAS) : filas;
    visibles.forEach(function (f) {
      html += '<tr><td title="' + esc(f.obra) + '">' + esc(f.obra) + '</td>' +
              '<td class="cc">' + esc(f.job || '') + '</td>' +
              '<td title="' + esc(f.descr) + '">' + esc(f.descr) + '</td>' +
              '<td title="' + esc(f.persona || '') + '">' + esc(f.persona || '') + '</td>' +
              '<td class="cc">' + esc(f.cc) + '</td>' +
              '<td title="' + esc(TIT_CREADO) + '">' + ddmm(f.pedido) + '</td>' +
              '<td title="' + esc(TIT_MOD) + '">' + ddmm(f.ultima_mod) + '</td>' +
              (llevaFecha ? '<td>' + ddmm(f.promesa) + '</td>' : '') +
              '<td class="num">' + kg(f.kg) + '</td></tr>';
    });
    if (recorte) {
      html += '<tr><td colspan="' + (llevaFecha ? 9 : 8) + '" class="dshvacio">Se muestran las primeras ' +
              TOPE_FILAS + ' de ' + filas.length + ' · filtra por obra o cubicador ' +
              '(el total del encabezado sí es de todas)</td></tr>';
    }
    // Sin fila de Total al pie: el total vive en el encabezado de la caja, que no se va
    // con el scroll. Dejarlo abajo obligaba a bajar 566 filas para ver el número.
    el.innerHTML = html + '</tbody>';
    return total;
  }

  function pintarTablas() {
    if (SUB === 'obras') return pintarObrasAsa();
    if (SUB === 'cub') return pintarCubicador();
    if (SUB === 'mes') return pintarPorClave(CFG_CUB);
    if (SUB === 'seg') return pintarPorClave(CFG_SEG);
    if (SUB === 'tipo') return pintarPorClave(CFG_TIPO);
    if (SUB === 'atr') return pintarAtributos();
    return pintarPlanta();
  }

  // ── Sub-tab PROGRAMADO CUBICADOR ───────────────────────────────────────────
  // La foto de HOY de cada persona: sus obras ACTIVAS y cómo está parada cada una.
  //
  // OBRA ACTIVA = tuvo movimiento en los últimos N meses. NO «la que tiene pendiente»:
  // ésa fue mi primera idea y escondía justo la alarma — una obra que se comió su stock
  // y se quedó sin nada que cubicar desaparecía, cuando es la que hay que mirar.
  //
  // Por lo mismo este tab NO usa el filtro de año y mes, y trae su propia data de un
  // endpoint que agrega en la base: son cientos de filas en vez de 25.000.
  var CUB = null, CUB_MESES = 3, ORDEN_CUB = { col: 'kg', desc: true };

  async function cargarCub() {
    try {
      CUB = await req('GET', '/programacion/asa/cubicador' + qs({ meses: CUB_MESES }));
    } catch (e) { aviso(e.message); CUB = null; }
  }

  function pintarCubicador() {
    if (!CUB) { $('dshCub').innerHTML = '<tbody><tr><td class="dshvacio">Cargando…</td></tr></tbody>'; return; }

    chips($('dshCubMeses'), [3, 6, 12, 0], [CUB_MESES], function (m) {
      CUB_MESES = m;
      cargarCub().then(pintarCubicador);
    }, function (m) { return m ? m + ' meses' : 'Todo'; });

    // El filtro de persona compara contra QUIÉN LA LLEVA HOY —el último que detalló—,
    // no contra quien participó alguna vez. Por eso a alguien que cambió de rol le sale
    // vacío, que es lo correcto: ya no tiene obras.
    var lista = (CUB.filas || []).filter(function (f) {
      if (PERSONAS.length && PERSONAS.indexOf(f.lleva) === -1) return false;
      if (OBRAS.length && OBRAS.indexOf(f.obra) === -1) return false;
      if (SEGS.length && SEGS.indexOf(segDe(f)) === -1) return false;
      if (TIPOS.length && TIPOS.indexOf(tipoDe(f)) === -1) return false;
      return true;
    });
    lista.forEach(function (f) { f.kg = f.stkg + f.prkg + f.dekg; });

    var dir = ORDEN_CUB.desc ? -1 : 1;
    lista.sort(function (a, b) {
      var x = a[ORDEN_CUB.col], y = b[ORDEN_CUB.col];
      // `job` puede venir vacío en una obra sin número de aSa: se ordena como texto vacío.
      if (typeof x === 'string' || x == null && typeof y === 'string') {
        return dir * String(x || '').localeCompare(String(y || ''), 'es');
      }
      return dir * (x - y);
    });

    var T = { st: 0, stkg: 0, pr: 0, prkg: 0, de: 0, dekg: 0, kg: 0 };
    lista.forEach(function (o) {
      ['st', 'pr', 'de'].forEach(function (c) { T[c] += o[c]; T[c + 'kg'] += o[c + 'kg']; });
      T.kg += o.kg;
    });
    var nada = lista.filter(function (o) { return o.sin_nada; }).length;
    var poco = lista.filter(function (o) { return o.sin_stock; }).length;
    // Stock AÑEJO: pedido hace más de un año, o sea que en la práctica ya no va a salir.
    // Sin decirlo, un stock grande se lee como salud cuando es bodega.
    var anejo = lista.reduce(function (a, o) { return a + (o.stvkg || 0); }, 0);
    $('dshCubN').innerHTML = '· ' + lista.length + ' obras · <b style="color:#33691e">' +
      kg0(T.kg) + ' kg</b>' +
      (nada ? ' · <b style="color:#c62828">' + nada + ' sin trabajo</b>' : '') +
      (poco ? ' · <b style="color:#e65100">' + poco + ' sin stock</b>' : '') +
      (anejo ? ' · <b style="color:#8d6e00">' + kg0(anejo) + ' kg de stock con más de ' +
               (CUB.meses_anejo || 12) + ' meses</b>' : '');
    if (!lista.length) {
      $('dshCub').innerHTML = '<tbody><tr><td class="dshvacio">Sin obras con movimiento en el período elegido</td></tr></tbody>';
      return;
    }
    var tope = lista.reduce(function (a, o) { return Math.max(a, o.kg); }, 0) || 1;
    var fl = function (c) {
      return ORDEN_CUB.col === c ? ' <b>' + (ORDEN_CUB.desc ? '\u25bc' : '\u25b2') + '</b>' : '';
    };
    // ANCHOS REPARTIDOS POR LO QUE MIDE EL CONTENIDO, no en partes iguales: «CC» son dos
    // o tres dígitos y «Kilos» siete con separadores. Dándoles lo mismo, el nombre de la
    // obra —lo único que de verdad se lee— quedaba cortado mientras seis columnas de
    // números nadaban en espacio.
    var par = function (c, clase) {
      return '<th class="ord num g ' + clase + '" data-ord="' + c + '">CC' + fl(c) + '</th>' +
             '<th class="ord num ' + clase + '" data-ord="' + c + 'kg">Kilos' + fl(c + 'kg') + '</th>';
    };
    // Los anchos van en <colgroup>, no en los <th>: con `table-layout:fixed` el navegador
    // reparte las columnas con la PRIMERA fila del encabezado, y acá la primera son los
    // títulos agrupados (STOCK / PROGRAMADO / DESPACHADO), que no llevan ancho. Por eso
    // los anchos del segundo piso no se aplicaban y la obra seguía cortada.
    var html = '<colgroup>' +
      '<col style="width:33%"><col style="width:7%">' +
      '<col style="width:5%"><col style="width:11%">' +
      '<col style="width:5%"><col style="width:11%">' +
      '<col style="width:5%"><col style="width:11%">' +
      '<col style="width:12%"></colgroup><thead>' +
      '<tr><th></th><th></th>' +
      '<th colspan="2" class="g st">STOCK</th>' +
      '<th colspan="2" class="g pr">PROGRAMADO</th>' +
      '<th colspan="2" class="g de">DESPACHADO</th>' +
      '<th class="g">Total</th></tr>' +
      '<tr><th class="ord" data-ord="obra">Obra' + fl('obra') + '</th>' +
      '<th class="ord" data-ord="job">Job' + fl('job') + '</th>' +
      par('st', 'st') + par('pr', 'pr') + par('de', 'de') +
      '<th class="ord num g" data-ord="kg">Kilos' + fl('kg') + '</th></tr></thead><tbody>';
    var celda = function (n, k, clase, viejoKg, viejoCc) {
      // Un cero se escribe en gris claro: seis columnas de ceros negros compiten con los
      // números que sí importan.
      // Y si la mayor parte del stock se pidió hace más de un año, la celda se marca: el
      // número por sí solo no distingue trabajo de bodega. Caso real: CRCC - HOSPITAL
      // COQUIMBO muestra 1.150 t de stock, de las cuales 968 son de 2024 y 2025.
      var anejoCelda = (viejoKg && k && viejoKg / k > 0.5);
      var tit = anejoCelda
        ? ' title="' + kg0(viejoKg) + ' kg (' + viejoCc + ' códigos) se pidieron hace más de ' +
          (CUB.meses_anejo || 12) + ' meses: en la práctica ya no van a salir"' : '';
      return '<td class="num g ' + clase + '"' + (n ? '' : ' style="color:#cfd8dc"') + '>' + n + '</td>' +
             '<td class="num ' + clase + (anejoCelda ? ' anejo' : '') + '"' +
             (k ? '' : ' style="color:#cfd8dc"') + tit + '>' + kg0(k) +
             (anejoCelda ? ' <i class="vj">▲</i>' : '') + '</td>';
    };
    lista.forEach(function (o) {
      var clase = o.sin_nada ? ' class="alerta grave"' : (o.sin_stock ? ' class="alerta"' : '');
      var porque = o.sin_nada ? ' — se movió pero NO le queda nada, ni cubicado ni agendado'
                 : (o.sin_stock ? ' — tiene cola agendada pero nada esperando detrás' : '');
      html += '<tr' + clase + '>' +
              // Quién la detalló va en el globo, no en una columna: arriba ya está el
              // filtro, y sin nadie elegido la tabla es la planta entera.
              '<td title="' + esc(o.obra) + porque +
              (o.detallaron ? '\nDetalló: ' + esc(o.detallaron) : '') + '">' + esc(o.obra) + '</td>' +
              '<td class="cc">' + esc(o.job || '') + '</td>' +
              celda(o.st, o.stkg, 'st', o.stvkg, o.stv) +
              celda(o.pr, o.prkg, 'pr') + celda(o.de, o.dekg, 'de') +
              '<td class="num g dshbar"><i style="width:' + (o.kg / tope * 100).toFixed(1) +
              '%"></i><span>' + kg0(o.kg) + '</span></td></tr>';
    });
    html += '</tbody><tfoot><tr><td>Total</td><td></td>' +
            '<td class="num g st">' + T.st + '</td><td class="num st">' + kg0(T.stkg) + '</td>' +
            '<td class="num g pr">' + T.pr + '</td><td class="num pr">' + kg0(T.prkg) + '</td>' +
            '<td class="num g de">' + T.de + '</td><td class="num de">' + kg0(T.dekg) + '</td>' +
            '<td class="num g">' + kg0(T.kg) + '</td></tr></tfoot>';
    $('dshCub').innerHTML = html;
    $('dshCub').querySelectorAll('th[data-ord]').forEach(function (th) {
      th.addEventListener('click', function () {
        var c = th.dataset.ord;
        if (ORDEN_CUB.col === c) ORDEN_CUB.desc = !ORDEN_CUB.desc;
        else { ORDEN_CUB.col = c; ORDEN_CUB.desc = (c !== 'obra' && c !== 'job'); }
        pintarCubicador();
      });
    });
  }

  // ── Sub-tab OBRAS aSa ──────────────────────────────────────────────────────
  // Tres cuadros de consulta sobre la MISMA data y los MISMOS filtros que Programa
  // Planta: cuánto por mes, cuánto por obra y el detalle código por código. Acá NO se
  // filtra por estado: se mira el total de lo cubicado, esté despachado o no.
  var ORDEN = { col: 'kg', desc: true };   // cómo está ordenado el cuadro de obras
  var BUSCA_CC = '';
  var TOPE_FILAS = 400;   // ver la nota en pintarCodigos

  function pintarObrasAsa() {
    var base = filtrar(todasLasFilas());
    pintarPorMes(base);
    pintarCodigos(base);
    pintarListaObras();
  }

  function pintarPorMes(filas) {
    var por = {}, total = 0;
    filas.forEach(function (f) {
      if (!f.mes) return;
      por[f.mes] = (por[f.mes] || 0) + f.kg;
      total += f.kg;
    });
    var meses = Object.keys(por).map(Number).sort(function (a, b) { return a - b; });
    $('dshMesN').innerHTML = '· <b style="color:#33691e">' + kg0(total) + ' kg</b>';
    if (!meses.length) {
      $('dshPorMes').innerHTML = '<tbody><tr><td class="dshvacio">Sin datos</td></tr></tbody>';
      return;
    }
    // Con todos los años elegidos, cada mes suma los de todos: se avisa, porque doce
    // filas sin decir de qué año se leerían como si fueran del año en curso.
    var titulo = (DATA && !DATA.anio) ? 'Mes · todos los años' : 'Mes';
    var html = '<thead><tr><th>' + titulo + '</th><th class="num">Kilos</th></tr></thead><tbody>';
    meses.forEach(function (m) {
      html += '<tr><td>' + MESN[m - 1] + '</td><td class="num">' + kg0(por[m]) + '</td></tr>';
    });
    html += '</tbody><tfoot><tr><td>Total</td><td class="num">' + kg0(total) + '</td></tr></tfoot>';
    $('dshPorMes').innerHTML = html;
  }

  function pintarCodigos(filas) {
    var lista = BUSCA_CC
      ? filas.filter(function (f) {
          return (f.descr || '').toLowerCase().indexOf(BUSCA_CC) !== -1 ||
                 (f.cc || '').toLowerCase().indexOf(BUSCA_CC) !== -1;
        })
      : filas;
    var total = lista.reduce(function (a, f) { return a + f.kg; }, 0);
    $('dshCcN').innerHTML = '· ' + lista.length + ' CC · <b style="color:#33691e">' +
                            kg(total) + ' kg</b>';
    if (!lista.length) {
      $('dshCc').innerHTML = '<tbody><tr><td class="dshvacio">' +
        (BUSCA_CC ? 'Ninguna descripción coincide con «' + esc(BUSCA_CC) + '»'
                  : 'Sin datos con estos filtros') + '</td></tr></tbody>';
      return;
    }
    // TOPE DE FILAS. Sin él se dibujaban 5.132 filas de cinco celdas: ~30.000 nodos del
    // DOM cada vez que se cambiaba de sub-tab, y el salto se sentía. Se muestran las
    // primeras y se dice cuántas quedaron fuera; para ver menos, está el buscador.
    var recorte = lista.length > TOPE_FILAS;
    var visibles = recorte ? lista.slice(0, TOPE_FILAS) : lista;
    var html = '<thead><tr><th style="width:28%">Obra</th><th style="width:7%">Job</th>' +
               '<th style="width:48%">Descripción</th><th style="width:7%">Código</th>' +
               '<th style="width:10%" class="num">Kilos</th></tr></thead><tbody>';
    visibles.forEach(function (f) {
      html += '<tr><td title="' + esc(f.obra) + '">' + esc(f.obra) + '</td>' +
              '<td class="cc">' + esc(f.job || '') + '</td>' +
              '<td title="' + esc(f.descr) + '">' + esc(f.descr) + '</td>' +
              '<td class="cc">' + esc(f.cc) + '</td>' +
              '<td class="num">' + kg(f.kg) + '</td></tr>';
    });
    if (recorte) {
      html += '<tr><td colspan="5" class="dshvacio">Se muestran las primeras ' +
              TOPE_FILAS + ' de ' + lista.length + ' · afina con el buscador o filtra ' +
              'por obra (el total de arriba sí es de todas)</td></tr>';
    }
    $('dshCc').innerHTML = html + '</tbody>';
  }

  function pintarPlanta() {
    // Sin `salvo`: las tablas SÍ aplican todos los filtros a la vez.
    var base = filtrar(todasLasFilas());
    var todosPp = sinFecha(base), todosPg = conFecha(base);
    // Los botones se arman ANTES de aplicar el estado: tienen que contar también lo que
    // está apagado, que es justamente lo que dicen.
    pintarEstados('pp', $('dshEstadosPp'), todosPp);
    pintarEstados('pg', $('dshEstados'), todosPg);
    var pp = todosPp.filter(visibleEn.bind(null, 'pp'));
    var pg = todosPg.filter(visibleEn.bind(null, 'pg'));
    var tp = tabla($('dshPorProgramar'), pp, false, todosPp.length - pp.length);
    var tg = tabla($('dshProgramados'), pg, true, todosPg.length - pg.length);
    $('dshPpN').innerHTML = resumen(pp.length, tp);
    $('dshPgN').innerHTML = resumen(pg.length, tg);
  }

  function resumen(n, total) {
    return '· ' + n + ' CC · <b style="color:#33691e">' + kg(total) + ' kg</b>';
  }

  // ── Los tres tabs «Por…»: cubicador, segmento, tipo ────────────────────────
  // La misma pantalla tres veces, cambiando sólo QUÉ va en las filas: arriba kilos
  // cubicados por mes con una barra por fila y el total del mes en el eje; abajo la
  // matriz filas × meses, SÓLO kilos, con totales. Cubicado = por fecha de pedido, en
  // cualquier estado. Con «todos» los años elegidos, las columnas son los años. Lo
  // definió así el usuario: una matriz única con segmentos en filas no dejaba clasificar
  // por tipo, y al revés; un tab por eje sí.
  var SIN_COLOR = '#e0e0e0';
  var COLOR_SEG = { '1 y 2': '#42a5f5', '4 y 5': '#8bc34a', 'YPS': '#ffa726', 'Otros': '#90a4ae' };
  var COLOR_TIPO = { 'Cubicación': '#8bc34a', 'Digitación': '#42a5f5' };
  // Ocho colores apagados y distintos entre sí para los cubicadores; después se repiten.
  var PALETA = ['#8bc34a', '#42a5f5', '#ffa726', '#ab47bc', '#26a69a', '#ef5350', '#78909c', '#d4e157'];
  var MAX_SERIES = 8;   // más series que esto y el gráfico deja de leerse: el resto se junta

  function personaDe(f) { return f.persona || '(sin detallar)'; }

  // LA MATRIZ, función pura: kilos por `clave(f)` (filas) y por mes o año (columnas).
  // `orden` fija el orden de las filas y deja fuera las que no aparecen; sin orden, de
  // mayor a menor total.
  function matriz(filas, clave, orden, porAnio) {
    var cols = {}, por = {}, totCol = {}, total = 0;
    filas.forEach(function (f) {
      var c = porAnio ? f.anio : f.mes;
      if (!c) return;
      var k = clave(f);
      cols[c] = 1;
      if (!por[k]) por[k] = { clave: k, celdas: {}, total: 0 };
      por[k].celdas[c] = (por[k].celdas[c] || 0) + f.kg;
      por[k].total += f.kg;
      totCol[c] = (totCol[c] || 0) + f.kg;
      total += f.kg;
    });
    var columnas = Object.keys(cols).map(Number).sort(function (a, b) { return a - b; });
    var lista = orden
      ? orden.filter(function (k) { return por[k]; }).map(function (k) { return por[k]; })
      : Object.keys(por).map(function (k) { return por[k]; }).sort(function (a, b) { return b.total - a.total; });
    var max = 0;
    lista.forEach(function (r) {
      columnas.forEach(function (c) { max = Math.max(max, r.celdas[c] || 0); });
    });
    return { columnas: columnas, filas: lista, totCol: totCol, total: total, max: max };
  }
  // La misma matriz con nombre de cubicador en cada fila (así la conocen los tests).
  function pivotMes(filas, porAnio) {
    var m = matriz(filas, personaDe, null, porAnio);
    return { columnas: m.columnas, totCol: m.totCol, total: m.total, max: m.max,
             personas: m.filas.map(function (r) { return { persona: r.clave, celdas: r.celdas, total: r.total }; }) };
  }

  // EL GRÁFICO DE BARRAS DE aSa Data, uno solo para todos los cuadros: por cada columna
  // del período una barra por serie (agrupadas, no apiladas —el usuario descartó las
  // apiladas: quiere comparar dentro del mes—) y el número real encima de cada barra.
  function graficoBarras(ref, canvas, labels, datasets) {
    return global.replaceChart(ref, canvas, {
      type: 'bar',
      // El plugin de etiquetas viene apagado por defecto en toda la app (app.html); acá
      // se enciende explícitamente porque el usuario quiere el número real en cada barra.
      plugins: (typeof ChartDataLabels !== 'undefined') ? [ChartDataLabels] : [],
      // Cada columna lleva su TOTAL como segunda línea de la etiqueta del eje: el usuario
      // lo pidió —el total del mes aporta tanto como las barras— y así no tapa nada.
      data: { labels: labels.map(function (l, i) {
                return [l, kg0(datasets.reduce(function (a, d) { return a + (d.data[i] || 0); }, 0))];
              }), datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        // Aire arriba para las etiquetas giradas sobre las barras más altas.
        layout: { padding: { top: 40 } },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: function (t) {
            return ' ' + t.dataset.label + ': ' + kg0(t.raw) + ' kg'; } } },
          // Giradas 90°: derechas, seis números de cinco cifras por mes se pisan entre sí.
          datalabels: { display: true, anchor: 'end', align: 'end', rotation: -90, offset: 2,
                        color: '#37474f', font: { size: 9 }, clamp: true,
                        formatter: function (v) { return v ? kg0(v) : ''; } }
        },
        scales: { x: { stacked: false, ticks: { font: { size: 10 } }, grid: { display: false } },
                  y: { stacked: false, beginAtZero: true,
                       ticks: { font: { size: 10 }, callback: global.chartTickNumber },
                       grid: { color: '#f0f2f5' } } }
      }
    });
  }

  // Qué va en las filas de cada tab. `orden` es una función porque los valores llegan
  // con la data; `colores` fijos para segmento y tipo, paleta para cubicadores.
  var CFG_CUB = { clave: personaDe, orden: null, colores: null, chart: 'dshMesChart',
                  tabla: 'dshMesPiv', n: 'dshMesPivN', titulo: 'Detallado por',
                  etiqueta: function (k) { return k; } };
  var CFG_SEG = { clave: segDe, orden: function () { return (DATA.segmentos || []).concat([SIN]); },
                  colores: COLOR_SEG, chart: 'dshSegChart', tabla: 'dshSegPiv', n: 'dshSegN',
                  titulo: 'Segmento', etiqueta: function (k) { return k === SIN ? 'Sin segmento' : k; } };
  var CFG_TIPO = { clave: tipoDe, orden: function () { return (DATA.tipos || []).concat([SIN]); },
                   colores: COLOR_TIPO, chart: 'dshTipoChart', tabla: 'dshTipoPiv', n: 'dshTipoN',
                   titulo: 'Tipo', etiqueta: function (k) { return k === SIN ? 'Sin tipo' : k; } };
  var CHARTS = {};   // un Chart.js vivo por canvas, para reemplazarlo en vez de apilar

  function pintarPorClave(cfg) {
    var base = filtrar(todasLasFilas());
    var porAnio = !(DATA && DATA.anio);
    var m = matriz(base, cfg.clave, cfg.orden ? cfg.orden() : null, porAnio);
    var nombre = function (c) { return porAnio ? String(c) : MESN[c - 1]; };
    $(cfg.n).innerHTML = '· ' + m.filas.length + ' · <b style="color:#33691e">' + kg0(m.total) + ' kg</b>' +
      (porAnio ? ' · por año (elige uno arriba para ver meses)' : '');
    if (!m.columnas.length) {
      $(cfg.tabla).innerHTML = '<tbody><tr><td class="dshvacio">Sin datos con estos filtros</td></tr></tbody>';
      CHARTS[cfg.chart] = global.destroyChart ? global.destroyChart(CHARTS[cfg.chart]) : null;
      return;
    }

    // La matriz. La primera columna se lleva lo que necesita el nombre; el resto se
    // reparte parejo entre los meses y el total. Cada celda teñida según sus kilos
    // (contra la mayor de la tabla), para que el mes fuerte salte sin leer los números.
    var n = m.columnas.length, wp = 16, wt = 9, wc = ((100 - wp - wt) / n).toFixed(2);
    var html = '<colgroup><col style="width:' + wp + '%">';
    m.columnas.forEach(function () { html += '<col style="width:' + wc + '%">'; });
    html += '<col style="width:' + wt + '%"></colgroup><thead><tr><th>' + esc(cfg.titulo) + '</th>';
    m.columnas.forEach(function (c) { html += '<th>' + esc(nombre(c)) + '</th>'; });
    html += '<th class="tot">Total</th></tr></thead><tbody>';
    var tinte = function (v) {
      if (!v || !m.max) return '';
      return ' style="background:rgba(139,195,74,' + (0.08 + 0.52 * v / m.max).toFixed(2) + ')"';
    };
    m.filas.forEach(function (r) {
      var e = cfg.etiqueta(r.clave);
      html += '<tr><td title="' + esc(e) + '">' + esc(e) + '</td>';
      m.columnas.forEach(function (c) {
        var v = r.celdas[c] || 0;
        html += '<td' + tinte(v) + '>' + (v ? kg0(v) : '') + '</td>';
      });
      html += '<td class="tot">' + kg0(r.total) + '</td></tr>';
    });
    html += '</tbody><tfoot><tr><td>Total</td>';
    m.columnas.forEach(function (c) { html += '<td>' + kg0(m.totCol[c] || 0) + '</td>'; });
    html += '<td class="tot">' + kg0(m.total) + '</td></tr></tfoot>';
    $(cfg.tabla).innerHTML = html;

    // El gráfico: por cada mes una barra por fila. Con paleta (cubicadores) van las
    // primeras MAX_SERIES filas —ya de mayor a menor— y el resto junto en «Otros».
    var canvas = $(cfg.chart);
    if (!canvas || typeof Chart === 'undefined' || !global.replaceChart) return;
    var series = m.filas, resto = [];
    if (!cfg.colores && m.filas.length > MAX_SERIES) {
      series = m.filas.slice(0, MAX_SERIES); resto = m.filas.slice(MAX_SERIES);
    }
    var datasets = series.map(function (r, i) {
      return { label: cfg.etiqueta(r.clave), maxBarThickness: 34,
               backgroundColor: cfg.colores ? (cfg.colores[r.clave] || SIN_COLOR) : PALETA[i % PALETA.length],
               data: m.columnas.map(function (c) { return Math.round(r.celdas[c] || 0); }) };
    });
    if (resto.length) {
      datasets.push({ label: 'Otros (' + resto.length + ')', backgroundColor: '#cfd8dc', maxBarThickness: 34,
        data: m.columnas.map(function (c) {
          return Math.round(resto.reduce(function (a, r) { return a + (r.celdas[c] || 0); }, 0));
        }) });
    }
    CHARTS[cfg.chart] = graficoBarras(CHARTS[cfg.chart], canvas, m.columnas.map(nombre), datasets);
  }

  // ── La lista de obras: la columna fija de todos los tabs y el cuadro de «Obras aSa» ──
  // Una LISTA PLANA de obras —la más grande arriba— con sus códigos, sus kilos y una
  // barra partida por estado (Open / Processed / Shipped / Cancelled). Se clickea para
  // filtrar. Nació como cuadro de «Obras aSa» y al usuario le gustó tanto que reemplazó
  // a la columna de obras de siempre en todos los tabs: es UNA función pintando en dos
  // sitios, para que nunca dejen de cuadrar entre sí.
  // Los estados con el nombre real de aSa, en el orden del ciclo: pedido → producido →
  // despachado, y al final los que no son trabajo.
  var COLOR_ESTADO = { 'Open': '#ffb74d', 'Processed': '#8bc34a', 'Shipped': '#90a4ae',
                       'Incomplete': '#ce93d8', 'Cancelled': '#e57373' };
  var ORDEN_ESTADO = ['Open', 'Processed', 'Shipped', 'Incomplete', 'Cancelled'];

  // Una fila por obra, de mayor a menor, con sus kilos partidos por estado. Función pura.
  function resumenObras(filas) {
    var por = {}, total = 0, estados = {};
    filas.forEach(function (f) {
      if (!por[f.obra]) por[f.obra] = { obra: f.obra, job: f.job, cc: 0, kg: 0, porEstado: {},
                                       segmento: segDe(f), tipo: tipoDe(f) };
      var o = por[f.obra], e = f.estado || '?';
      o.cc++; o.kg += f.kg; o.porEstado[e] = (o.porEstado[e] || 0) + f.kg;
      estados[e] = (estados[e] || 0) + f.kg; total += f.kg;
    });
    var lista = Object.keys(por).map(function (k) { return por[k]; })
      .sort(function (a, b) { return b.kg - a.kg || a.obra.localeCompare(b.obra, 'es'); });
    var orden = ORDEN_ESTADO.filter(function (e) { return estados[e]; })
      .concat(Object.keys(estados).filter(function (e) { return ORDEN_ESTADO.indexOf(e) === -1; }).sort());
    return { obras: lista, max: lista.length ? lista[0].kg : 0, total: total,
             estados: orden, porEstado: estados };
  }

  function nombreEstado(e) { return (DATA.nombres_estado || {})[e] || e; }

  function leyenda(R) {
    return R.estados.map(function (e) {
      return '<span><i style="background:' + (COLOR_ESTADO[e] || SIN_COLOR) + '"></i>' + esc(nombreEstado(e)) +
             ' <span class="muted">' + kg0(R.porEstado[e]) + '</span></span>';
    }).join('');
  }

  // Pinta la lista en `el` (un div) y devuelve lo que muestra: las obras que pasaron el
  // buscador, sus kilos y el reparto por estado para la leyenda.
  function pintarLista(el, busca) {
    var etq = function (s) { return s === SIN ? 'Sin dato' : s; };
    // La lista pasa TODOS los filtros menos el de obra (no se filtra a sí misma). Y es
    // el ÚNICO cuadro que mira los anulados (DATA.filas, no todasLasFilas): el usuario
    // quiere ver en la barra lo que se cubicó y después se canceló.
    var R = resumenObras(filtrar(DATA.filas || [], 'obra'));
    // Una obra ya marcada se muestra siempre, aunque los otros filtros la dejarían fuera:
    // si no, no habría cómo desmarcarla.
    OBRAS.forEach(function (o) {
      if (!R.obras.some(function (x) { return x.obra === o; })) {
        R.obras.push({ obra: o, job: null, cc: 0, kg: 0, porEstado: {}, segmento: SIN, tipo: SIN });
      }
    });
    var lista = busca
      ? R.obras.filter(function (o) { return o.obra.toLowerCase().indexOf(busca) !== -1; })
      : R.obras;
    var salida = { obras: lista, estados: R.estados, porEstado: R.porEstado,
                   total: lista.reduce(function (a, o) { return a + o.kg; }, 0) };
    if (!lista.length) {
      el.innerHTML = '<div class="dshvacio">' + (busca ? 'Ninguna obra con «' + esc(busca) + '»' : 'Sin obras con estos filtros') + '</div>';
      return salida;
    }
    // La barra mide contra la obra MÁS GRANDE de las que se ven (la primera), y dentro
    // cada estado ocupa su parte.
    var max = lista[0].kg || 1;
    var html = '<table class="dsht dshres"><colgroup><col style="width:42%"><col style="width:7%">' +
      '<col style="width:13%"><col style="width:38%"></colgroup>' +
      '<thead><tr><th>Obra</th><th class="num">CC</th><th class="num">Kilos</th>' +
      '<th>Kilos por estado</th></tr></thead><tbody>';
    lista.forEach(function (o) {
      var on = OBRAS.indexOf(o.obra) !== -1;
      var barra = R.estados.map(function (e) {
        var v = o.porEstado[e] || 0;
        return v ? '<i style="width:' + (v / o.kg * 100).toFixed(1) + '%; background:' +
                   (COLOR_ESTADO[e] || SIN_COLOR) + '" title="' + esc(nombreEstado(e)) + ': ' + kg0(v) + ' kg"></i>' : '';
      }).join('');
      html += '<tr class="' + (on ? 'sel' : '') + '" data-obra="' + esc(o.obra) + '">' +
        '<td title="' + esc(o.obra) + (o.job ? ' · ' + esc(o.job) : '') + ' · ' + esc(etq(o.segmento)) +
        ' · ' + esc(etq(o.tipo)) + '">' + esc(o.obra) + '</td>' +
        '<td class="num">' + o.cc + '</td><td class="num">' + kg0(o.kg) + '</td>' +
        '<td><div class="stk" style="width:' + (o.kg / max * 100).toFixed(1) + '%">' + barra + '</div></td></tr>';
    });
    el.innerHTML = html + '</tbody></table>';
    el.querySelectorAll('tr[data-obra]').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        alternar(OBRAS, tr.dataset.obra, ev);
        repintarTodo();
      });
    });
    return salida;
  }

  // El cuadro de «Obras aSa»: la misma lista, sin buscador (ahí está el de códigos).
  function pintarListaObras() {
    var R = pintarLista($('dshResObras'), '');
    $('dshResN').innerHTML = '· ' + R.obras.length + ' · <b style="color:#33691e">' + kg0(R.total) + ' kg</b>';
    $('dshResLey').innerHTML = leyenda(R);
  }

  // ── Sub-tab ATRIBUTOS DE OBRA ──────────────────────────────────────────────
  // Lo que aSa no sabe de una obra y los cubicadores sí: tipo (Cubicación/Digitación) y
  // segmento. Se guarda AL CLIC —sin botón de guardar— y cada campo viaja solo, para que
  // tocar el tipo nunca pise el segmento que puso otro.
  var ATR = null, ATR_MESES = 12, BUSCA_ATR = '';

  async function cargarAtr() {
    try {
      ATR = await req('GET', '/programacion/asa/atributos' + qs({ meses: ATR_MESES }));
    } catch (e) { aviso(e.message); ATR = null; }
  }

  function pintarAtributos() {
    if (!ATR) { $('dshAtr').innerHTML = '<tbody><tr><td class="dshvacio">Cargando…</td></tr></tbody>'; return; }
    chips($('dshAtrMeses'), [3, 6, 12, 0], [ATR_MESES], function (m) {
      ATR_MESES = m;
      cargarAtr().then(pintarAtributos);
    }, function (m) { return m ? m + ' meses' : 'Todo'; });

    var lista = (ATR.filas || []).filter(function (f) {
      if (OBRAS.length && OBRAS.indexOf(f.obra) === -1) return false;
      if (SEGS.length && SEGS.indexOf(segDe(f)) === -1) return false;
      if (TIPOS.length && TIPOS.indexOf(tipoDe(f)) === -1) return false;
      if (BUSCA_ATR && (f.obra || '').toLowerCase().indexOf(BUSCA_ATR) === -1 &&
          String(f.job || '').indexOf(BUSCA_ATR) === -1) return false;
      return true;
    });
    var sinTipo = lista.filter(function (f) { return !f.tipo; }).length;
    var sinSeg = lista.filter(function (f) { return !f.segmento; }).length;
    $('dshAtrN').innerHTML = '· ' + lista.length + ' obras' +
      (sinTipo ? ' · <b style="color:#e65100">' + sinTipo + ' sin tipo</b>' : '') +
      (sinSeg ? ' · <b style="color:#e65100">' + sinSeg + ' sin segmento</b>' : '');
    if (!lista.length) {
      $('dshAtr').innerHTML = '<tbody><tr><td class="dshvacio">Sin obras con movimiento en el período elegido</td></tr></tbody>';
      return;
    }
    var grupo = function (f, campo, valores) {
      if (!f.job) return '<span class="muted" style="font-size:9px">sin job en aSa</span>';
      return '<span class="atrg">' + valores.map(function (v) {
        return '<button data-job="' + esc(f.job) + '" data-campo="' + campo + '" data-valor="' + esc(v) + '"' +
               (f[campo] === v ? ' class="on"' : '') + '>' + esc(v) + '</button>';
      }).join('') + '</span>';
    };
    var html = '<colgroup><col style="width:34%"><col style="width:8%"><col style="width:10%">' +
      '<col style="width:18%"><col style="width:20%"><col style="width:10%"></colgroup>' +
      '<thead><tr><th>Obra</th><th>Job</th><th class="num">Kilos</th>' +
      '<th>Tipo</th><th>Segmento</th><th>Editado</th></tr></thead><tbody>';
    lista.forEach(function (f) {
      var falta = f.job && (!f.tipo || !f.segmento);
      html += '<tr' + (falta ? ' class="falta"' : '') + '>' +
        '<td title="' + esc(f.obra) + '">' + esc(f.obra) + '</td>' +
        '<td class="cc">' + esc(f.job || '') + '</td>' +
        '<td class="num">' + kg0(f.kg) + '</td>' +
        '<td>' + grupo(f, 'tipo', ATR.tipos || []) + '</td>' +
        '<td>' + grupo(f, 'segmento', ATR.segmentos || []) + '</td>' +
        '<td class="muted" style="font-size:9px" title="' + esc(f.editado_por || '') + '">' +
          (f.editado_el ? ddmm(f.editado_el) + ' · ' + esc((f.editado_por || '').split('@')[0]) : '') + '</td></tr>';
    });
    $('dshAtr').innerHTML = html + '</tbody>';

    $('dshAtr').querySelectorAll('button[data-job]').forEach(function (b) {
      b.addEventListener('click', function () { guardarAtributo(b); });
    });
  }

  async function guardarAtributo(b) {
    var job = b.dataset.job, campo = b.dataset.campo, valor = b.dataset.valor;
    var fila = (ATR.filas || []).filter(function (f) { return f.job === job; })[0];
    if (!fila) return;
    // Clic en el encendido = borrar. Se manda SÓLO el campo tocado.
    var nuevo = (fila[campo] === valor) ? null : valor;
    var cuerpo = {}; cuerpo[campo] = nuevo;
    b.classList.add('guardando');
    try {
      var r = await req('PUT', '/programacion/asa/atributos/' + encodeURIComponent(job), cuerpo);
      if (!r) return;
      fila.tipo = r.tipo; fila.segmento = r.segmento;
      fila.editado_por = r.editado_por; fila.editado_el = r.editado_el;
      pintarAtributos();
    } catch (e) {
      b.classList.remove('guardando'); b.classList.add('mal');
      aviso('No se guardó: ' + e.message);
    }
  }

  // Trae TODOS los años, del más reciente al más antiguo, uno por llamada: el endpoint
  // sincroniza un año a la vez porque $apply de aSa no pagina y pedir la historia entera
  // de una es justo la consulta que lo atora. Si un año falla, se sigue con el resto y
  // se dice cuál falló.
  async function sincronizar() {
    var b = $('dshSync'), antes = b.textContent, hoy = new Date().getFullYear();
    b.disabled = true;
    var total = 0, nuevos = 0, fallidos = [];
    for (var anio = hoy; anio >= PRIMER_ANIO; anio--) {
      b.textContent = '↻ aSa ' + anio + '…';
      try {
        var r = await req('POST', '/programacion/asa/sincronizar-pedidos' + qs({ anio: anio }));
        total += r.filas || 0; nuevos += r.nuevas || 0;
      } catch (e) { fallidos.push(anio + ' (' + e.message + ')'); }
    }
    b.disabled = false; b.textContent = antes;
    if (global.showToast) global.showToast(
      total + ' códigos de control · ' + nuevos + ' nuevos', fallidos.length ? 'error' : 'success');
    if (fallidos.length) aviso('No se pudo traer: ' + fallidos.join(', '));
    await cargar();
    // El aviso del año que falló lo pinta `pintarTodo` desde el espejo; acá sólo se deja
    // dicho en el encabezado si el año a la vista fue uno de los que no se pudo traer.
    if (fallidos.some(function (f) { return String(f).indexOf(String(ANIO)) === 0; })) {
      $('dshAviso').className = 'prgaviso mal';
      $('dshAviso').innerHTML = '<b>No se pudo traer ' + esc(String(ANIO)) + ' de aSa.</b> ' +
        'Lo que se ve es lo que había antes. Intenta de nuevo en un rato.';
    }
  }

  // Expuesto SÓLO para los tests: las reglas puras, sin DOM. Poder ejecutarlas es lo que
  // distingue un test que mira el código de uno que lo corre — y los bugs que llegaron a
  // producción en este archivo fueron todos de ejecución, no de texto.
  global.__asaDataTest = {
    programado: programado, cajaDe: cajaDe, visible: visible, visibleEn: visibleEn,
    conFecha: conFecha, sinFecha: sinFecha, ddmm: ddmm, kg: kg, qs: qs,
    pivotMes: pivotMes, matriz: matriz, resumenObras: resumenObras, segDe: segDe, tipoDe: tipoDe, personaDe: personaDe,
    orden: function (v) { if (v) { ORDEN = v; } return ORDEN; },
    alternar: alternar,
    conBoton: function (v) { if (v) { CON_BOTON = v; } return CON_BOTON; },
    ocultos: function (v) { if (v) { OCULTOS = v; } return OCULTOS; }
  };

})(window);
