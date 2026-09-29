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

  // Sub-tabs de aSa Data. Hoy hay uno solo; la función existe desde ya para que agregar
  // el siguiente reporte sea añadir una línea a la lista y su panel al HTML.
  var SUBTABS = [['planta', 'asaSubPlanta', 'asaPanelPlanta'],
                 ['obras',  'asaSubObras',  'asaPanelObras'],
                 ['cub',    'asaSubCub',    'asaPanelCub']];
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
    // Este sub-tab trae su propia data (agregada, y sin filtro de período), así que se
    // pide la primera vez que se abre y no en cada cambio de pestaña.
    if (v === 'cub' && !CUB) { cargarCub().then(pintarTablas); return; }
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
    }
    await cargar();
  };

  async function cargar() {
    try {
      DATA = await req('GET', '/programacion/asa/reporte' + qs({ anio: ANIO, meses: MESES }));
      if (!DATA) return;
      ANIO = DATA.anio;
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

  function pintarTodo() {
    var esp = DATA.espejo || {};
    $('dshEspejo').textContent = esp.filas_anio
      ? esp.filas_anio + ' códigos de control en ' + (DATA.anio ? DATA.anio : 'toda la historia') +
        (DATA.anulados ? ' · ' + DATA.anulados + ' anulados, fuera del reporte' : '')
      : '';
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
        pintarObras(); pintarTablas();
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
    chips($('dshAnios'), anios, [ANIO], function (v) {
      ANIO = (ANIO === v) ? 0 : v;
      cargar();
    });
    chips($('dshMeses'), [1,2,3,4,5,6,7,8,9,10,11,12], MESES, function (m, ev) {
      alternar(MESES, m, ev);
      cargar();
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
      pintarChips(); pintarObras(); pintarTablas();
    });
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
  function todasLasFilas() {
    return DATA.filas || [];
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

  function filtrar(filas, salvo) {
    return filas.filter(function (f) {
      if (salvo !== 'obra' && OBRAS.length && OBRAS.indexOf(f.obra) === -1) return false;
      if (salvo !== 'persona' && PERSONAS.length && PERSONAS.indexOf(f.persona) === -1) return false;
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
  var ORDEN_OBRA = { col: 'kg', desc: true };

  function pintarObras() {
    // Las cifras salen de las filas que pasan TODOS los otros filtros menos el de obra:
    // si la obra se filtrara a sí misma, al marcar una desaparecerían las demás.
    var base = filtrar(todasLasFilas(), 'obra').filter(visible);
    var por = {};
    base.forEach(function (f) {
      if (!por[f.obra]) por[f.obra] = { obra: f.obra, kg: 0, cc: 0 };
      por[f.obra].kg += f.kg; por[f.obra].cc++;
    });
    // Una obra ya marcada se muestra siempre, aunque los otros filtros la dejarían
    // fuera: si no, no habría cómo desmarcarla.
    OBRAS.forEach(function (o) { if (!por[o]) por[o] = { obra: o, kg: 0, cc: 0 }; });

    var lista = Object.keys(por).map(function (k) { return por[k]; })
      .filter(function (o) { return !BUSCA || o.obra.toLowerCase().indexOf(BUSCA) !== -1; });
    var dir = ORDEN_OBRA.desc ? -1 : 1;
    lista.sort(function (a, b) {
      var x = a[ORDEN_OBRA.col], y = b[ORDEN_OBRA.col];
      if (typeof x === 'string') return dir * x.localeCompare(y, 'es');
      return dir * (x - y);
    });

    var tkg = lista.reduce(function (a, o) { return a + o.kg; }, 0);
    $('dshObrasN').innerHTML = '· ' + lista.length + ' · <b style="color:#33691e">' +
                               kg0(tkg) + ' kg</b>';
    if (!lista.length) { $('dshObras').innerHTML = '<div class="dshvacio">Sin obras</div>'; return; }

    // La barra se mide contra la obra MÁS GRANDE: contra el total, con cien obras,
    // quedarían todas en un hilo y no compararían nada.
    var tope = lista.reduce(function (a, o) { return Math.max(a, o.kg); }, 0) || 1;
    var flecha = function (c) {
      return ORDEN_OBRA.col === c ? ' <b>' + (ORDEN_OBRA.desc ? '\u25bc' : '\u25b2') + '</b>' : '';
    };
    var html = '<table class="dshot"><thead><tr>' +
      '<th data-ord="obra" style="width:66%">Obra' + flecha('obra') + '</th>' +
      '<th data-ord="cc" class="num" style="width:11%">CC' + flecha('cc') + '</th>' +
      '<th data-ord="kg" class="num" style="width:23%">Kilos' + flecha('kg') + '</th>' +
      '</tr></thead><tbody>';
    lista.forEach(function (o) {
      var on = OBRAS.indexOf(o.obra) !== -1;
      html += '<tr class="' + (on ? 'sel' : '') + '" data-obra="' + esc(o.obra) + '" title="' + esc(o.obra) + '">' +
              '<td><input type="checkbox"' + (on ? ' checked' : '') + '> ' + esc(o.obra) + '</td>' +
              '<td class="num">' + o.cc + '</td>' +
              '<td class="num dshbar"><i style="width:' + (o.kg / tope * 100).toFixed(1) +
              '%"></i><span>' + kg0(o.kg) + '</span></td></tr>';
    });
    $('dshObras').innerHTML = html + '</tbody></table>';

    $('dshObras').querySelectorAll('tr[data-obra]').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        alternar(OBRAS, tr.dataset.obra, ev);
        pintarChips(); pintarObras(); pintarTablas();
      });
    });
    $('dshObras').querySelectorAll('th[data-ord]').forEach(function (th) {
      th.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var c = th.dataset.ord;
        if (ORDEN_OBRA.col === c) ORDEN_OBRA.desc = !ORDEN_OBRA.desc;
        else { ORDEN_OBRA.col = c; ORDEN_OBRA.desc = (c !== 'obra'); }
        pintarObras();
      });
    });
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
    var html = llevaFecha
      ? '<thead><tr><th style="width:33%">JobName</th><th style="width:40%">Descr</th>' +
        '<th style="width:7%">Código</th><th style="width:7%">Despacho</th>' +
        '<th class="num" style="width:13%">Kilos</th></tr></thead><tbody>'
      : '<thead><tr><th style="width:37%">JobName</th><th style="width:43%">Descr</th>' +
        '<th style="width:7%">Código</th>' +
        '<th class="num" style="width:13%">Kilos</th></tr></thead><tbody>';
    filas.forEach(function (f) {
      html += '<tr><td title="' + esc(f.obra) + '">' + esc(f.obra) + '</td>' +
              '<td title="' + esc(f.descr) + '">' + esc(f.descr) + '</td>' +
              '<td class="cc">' + esc(f.cc) + '</td>' +
              (llevaFecha ? '<td>' + ddmm(f.promesa) + '</td>' : '') +
              '<td class="num">' + kg(f.kg) + '</td></tr>';
    });
    // Sin fila de Total al pie: el total vive en el encabezado de la caja, que no se va
    // con el scroll. Dejarlo abajo obligaba a bajar 566 filas para ver el número.
    el.innerHTML = html + '</tbody>';
    return total;
  }

  function pintarTablas() {
    if (SUB === 'obras') return pintarObrasAsa();
    if (SUB === 'cub') return pintarCubicador();
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
      return true;
    });
    lista.forEach(function (f) { f.kg = f.stkg + f.prkg + f.dekg; });

    var dir = ORDEN_CUB.desc ? -1 : 1;
    lista.sort(function (a, b) {
      var x = a[ORDEN_CUB.col], y = b[ORDEN_CUB.col];
      if (typeof x === 'string') return dir * String(x).localeCompare(String(y), 'es');
      return dir * (x - y);
    });

    var T = { st: 0, stkg: 0, pr: 0, prkg: 0, de: 0, dekg: 0, kg: 0 };
    lista.forEach(function (o) {
      ['st', 'pr', 'de'].forEach(function (c) { T[c] += o[c]; T[c + 'kg'] += o[c + 'kg']; });
      T.kg += o.kg;
    });
    var nada = lista.filter(function (o) { return o.sin_nada; }).length;
    var poco = lista.filter(function (o) { return o.sin_stock; }).length;
    $('dshCubN').innerHTML = '· ' + lista.length + ' obras · <b style="color:#33691e">' +
      kg0(T.kg) + ' kg</b>' +
      (nada ? ' · <b style="color:#c62828">' + nada + ' sin trabajo</b>' : '') +
      (poco ? ' · <b style="color:#e65100">' + poco + ' sin stock</b>' : '');
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
      '<col style="width:40%">' +
      '<col style="width:5%"><col style="width:11%">' +
      '<col style="width:5%"><col style="width:11%">' +
      '<col style="width:5%"><col style="width:11%">' +
      '<col style="width:12%"></colgroup><thead>' +
      '<tr><th></th>' +
      '<th colspan="2" class="g st">STOCK</th>' +
      '<th colspan="2" class="g pr">PROGRAMADO</th>' +
      '<th colspan="2" class="g de">DESPACHADO</th>' +
      '<th class="g">Total</th></tr>' +
      '<tr><th class="ord" data-ord="obra">Obra' + fl('obra') + '</th>' +
      par('st', 'st') + par('pr', 'pr') + par('de', 'de') +
      '<th class="ord num g" data-ord="kg">Kilos' + fl('kg') + '</th></tr></thead><tbody>';
    var celda = function (n, k, clase) {
      // Un cero se escribe en gris claro: seis columnas de ceros negros compiten con los
      // números que sí importan.
      return '<td class="num g ' + clase + '"' + (n ? '' : ' style="color:#cfd8dc"') + '>' + n + '</td>' +
             '<td class="num ' + clase + '"' + (k ? '' : ' style="color:#cfd8dc"') + '>' + kg0(k) + '</td>';
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
              celda(o.st, o.stkg, 'st') + celda(o.pr, o.prkg, 'pr') + celda(o.de, o.dekg, 'de') +
              '<td class="num g dshbar"><i style="width:' + (o.kg / tope * 100).toFixed(1) +
              '%"></i><span>' + kg0(o.kg) + '</span></td></tr>';
    });
    html += '</tbody><tfoot><tr><td>Total</td>' +
            '<td class="num g st">' + T.st + '</td><td class="num st">' + kg0(T.stkg) + '</td>' +
            '<td class="num g pr">' + T.pr + '</td><td class="num pr">' + kg0(T.prkg) + '</td>' +
            '<td class="num g de">' + T.de + '</td><td class="num de">' + kg0(T.dekg) + '</td>' +
            '<td class="num g">' + kg0(T.kg) + '</td></tr></tfoot>';
    $('dshCub').innerHTML = html;
    $('dshCub').querySelectorAll('th[data-ord]').forEach(function (th) {
      th.addEventListener('click', function () {
        var c = th.dataset.ord;
        if (ORDEN_CUB.col === c) ORDEN_CUB.desc = !ORDEN_CUB.desc;
        else { ORDEN_CUB.col = c; ORDEN_CUB.desc = (c !== 'obra'); }
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
    var html = '<thead><tr><th style="width:33%">Obra</th>' +
               '<th style="width:50%">Descripción</th><th style="width:7%">Código</th>' +
               '<th style="width:10%" class="num">Kilos</th></tr></thead><tbody>';
    visibles.forEach(function (f) {
      html += '<tr><td title="' + esc(f.obra) + '">' + esc(f.obra) + '</td>' +
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
  }

  // Expuesto SÓLO para los tests: las reglas puras, sin DOM. Poder ejecutarlas es lo que
  // distingue un test que mira el código de uno que lo corre — y los bugs que llegaron a
  // producción en este archivo fueron todos de ejecución, no de texto.
  global.__asaDataTest = {
    programado: programado, cajaDe: cajaDe, visible: visible, visibleEn: visibleEn,
    conFecha: conFecha, sinFecha: sinFecha, ddmm: ddmm, kg: kg, qs: qs,
    orden: function (v) { if (v) { ORDEN = v; } return ORDEN; },
    alternar: alternar,
    conBoton: function (v) { if (v) { CON_BOTON = v; } return CON_BOTON; },
    ocultos: function (v) { if (v) { OCULTOS = v; } return OCULTOS; }
  };

})(window);
