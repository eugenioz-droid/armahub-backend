// REVISIÓN AUTOMÁTICA DE BARRAS (8-oct) — la segunda línea del tab de Auditorías.
//
// QUÉ ES Y POR QUÉ NO ES UNA AUDITORÍA. Una auditoría es una muestra al azar que revisa
// una persona, deja hallazgos con su nombre y abre acciones contra quien cubicó. Esto es
// la máquina leyendo TODAS las barras de un código y levantando la mano donde algo no
// calza. Si una regla pudiera dejar un hallazgo, el indicador de conformidad por cubicador
// dejaría de medir a las personas y la muestra dejaría de ser aleatoria. Por eso: la señal
// sugiere, la persona decide.
//
// POR QUÉ LA PANTALLA RECORRE LOS CÓDIGOS DE A UNO. Pedirle a aSa los ítems de un código
// cuesta un par de segundos y una obra tiene decenas. Un solo request con la obra entera
// duraría minutos y se caería por timeout. Yendo de a uno se ve avanzar, se puede detener,
// y lo ya revisado queda guardado aunque el usuario se vaya. Eso es «revisar sin romper el
// sistema».
//
// LA ÚNICA BUROCRACIA ES UN CLIC. El registro de quién corrió la revisión lo escribe el
// servidor solo. Lo que sí lleva nombre es resolver una señal: «está bien» —con el motivo,
// porque sin motivo nadie puede revisarlo después— o «hay que corregirla». Que se corrigió
// NO se marca a mano: el sistema lo comprueba volviendo a revisar el código.
(function (global) {
  'use strict';

  // `meses` y `tarde` siguen siendo la ventana con la que se piden los datos —el reporte
  // por obra la usa— pero ya no son un control: 3 meses es la ventana de producción y los
  // Processed se incluyen desde el botón de arriba, que es donde importa.
  var REV = { reglas: {}, corriendo: false, parar: false, meses: 3, tarde: false,
              senales: [], mios: [], reporte: [] };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  // La misma puerta que usa el resto del tab (ver index.js): el token, el 401 que
  // desloguea y el detalle de error de FastAPI desarmado para que se pueda leer.
  async function req(metodo, url, cuerpo) {
    var opts = { method: metodo, headers: Object.assign({}, global.authHeaders()) };
    if (cuerpo !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(cuerpo);
    }
    var res = await fetch(global.apiUrl(url), opts);
    if (res.status === 401) { global.logout(); return null; }
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var det = data && data.detail;
      if (Array.isArray(det)) det = det.map(function (d) { return (d.loc || []).slice(-1) + ': ' + d.msg; }).join(' · ');
      // El detalle puede ser un objeto (el 409 del cierre trae {motivo, mensaje, barras}):
      // el mensaje legible va en `message` y el objeto entero en `detalle`, con el status.
      var err = new Error((det && (det.mensaje || det.msg || (typeof det === 'string' ? det : null)))
                          || ('Error ' + res.status));
      err.status = res.status;
      err.detalle = det;
      throw err;
    }
    return data;
  }
  function aviso(m) { if (global.showToast) global.showToast(m, 'error'); else console.error(m); }
  function ok(m) { if (global.showToast) global.showToast(m, 'success'); }

  // ── Las reglas, a la vista ────────────────────────────────────────────────────────
  // Las reglas son del nivel: se piden cada vez que se entra, porque cambian con el tab.
  async function cargarReglas() {
    REV.reglas = {};
    try {
      var r = await req('GET', REVS.nivel === 'elemento' ? '/chequeos/reglas-elemento' : '/chequeos/reglas');
      (r.reglas || []).forEach(function (x) { REV.reglas[x.codigo] = x; });
    } catch (e) { /* las reglas son texto: si fallan, la pantalla sigue sirviendo */ }
    pintarReglas();
  }

  function pintarReglas() {
    var el = $('revReglas');
    if (!el) return;
    var ks = Object.keys(REV.reglas);
    if (REVS.nivel === 'elemento') {
      // EN DOS GRUPOS (4-nov): lo que vale para todas las obras y lo que sólo tiene
      // sentido en edificación. El usuario: «separa las reglas que valdría la pena
      // aplicar a todas las obras vs sólo las de edificación, así no mezclamos».
      $('revReglasN').textContent = ks.length + ' criterio(s) · la máquina marca, la decisión es de quien mira';
      el.className = 'elcrit';
      el.innerHTML = ['todas', 'edificacion'].map(function (g) {
        return '<li><h4><i class="' + g + '">' + (g === 'todas' ? 'Todas las obras' : 'Sólo edificación') + '</i>' +
          (g === 'edificacion' ? '<em>se reconoce por el nombre del código: ELEV / LC / VC + piso + ciclo</em>' : '') + '</h4>' +
          ks.filter(function (k) { return REV.reglas[k].grupo === g; }).map(function (k) {
            var r = REV.reglas[k];
            return '<div class="elrule"><b>' + esc(r.nombre) + '</b><p>' + esc(r.porque) + '</p>' +
              (r.umbral ? '<span class="umb">' + esc(r.umbral) + '</span>' : '') + '</div>';
          }).join('') + '</li>';
      }).join('');
      return;
    }
    el.className = '';
    $('revReglasN').textContent = ks.length + ' regla(s) · la máquina marca, la decisión es de quien mira';
    el.innerHTML = ks.map(function (k) {
      var r = REV.reglas[k];
      return '<li><b>' + esc(r.nombre) + '</b> <span>' + esc(r.porque) + '</span></li>';
    }).join('');
  }

  // ── Correr la revisión, código por código ─────────────────────────────────────────
  // EL RECORRIDO, APARTE DE QUIÉN LO PIDE. Lo usan el botón «Nueva revisión» y el reloj:
  // lo único que cambia es de dónde sale la cola de códigos.
  // `total` es cuántos códigos esperaban en realidad: si la cola vino recortada al tope,
  // o si el usuario detuvo, la revisión se cierra DICIENDO cuántos quedaron. Una corrida
  // que se cortó y parece completa es peor que no tenerla: el usuario vio dos revisiones
  // que eran una sola pasada partida al medio y tuvo que preguntar por qué.
  async function recorrer(cola, revision, ui, total) {
    var hechos = 0, barras = 0, nuevas = 0, errores = 0;
    for (var i = 0; i < cola.length; i++) {
      if (REV.parar) break;
      var c = cola[i];
      ui.txt.textContent = 'Revisando ' + c.cc + (c.obra ? ' · ' + c.obra : '') +
        ' · ' + (i + 1) + ' de ' + cola.length +
        (nuevas ? ' · ' + nuevas + ' señal(es) nueva(s)' : '');
      ui.barra.style.width = Math.round((i / cola.length) * 100) + '%';
      try {
        var r = await req('POST', '/chequeos/revisar',
                          { job: c.job, cc: c.cc, revision: revision });
        hechos++; barras += r.barras || 0; nuevas += r.nuevas || 0;
        if (r.error) errores++;
      } catch (e) { errores++; }
    }
    ui.barra.style.width = '100%';
    ui.txt.textContent = hechos + ' código(s) · ' + num(barras) + ' barras · ' +
      nuevas + ' señal(es) nueva(s)' + (errores ? ' · ' + errores + ' con error' : '') +
      (REV.parar ? ' · detenida' : '');
    if (revision) {
      var quedaron = (total || cola.length) - hechos;
      var nota = REV.parar
        ? 'Detenida por quien la corría: quedaban ' + quedaron + ' código(s).'
        : (total && total > cola.length
            ? 'Se cortó por el tope de ' + cola.length + ' códigos: quedaban ' + (total - cola.length) + '.'
            : null);
      try { await req('PUT', '/chequeos/revision/' + revision + '/cerrar', { nota: nota }); } catch (e) {}
    }
    // QUÉ HACER AHORA. Antes la corrida terminaba en «15 señales nuevas» y ahí quedaba
    // uno: la bandeja se abre en lo de ESTA revisión, para resolverlo de inmediato.
    return { hechos: hechos, nuevas: nuevas };
  }

  // ══════ LAS REVISIONES SON LA UNIDAD ══════
  //
  // Lo redefinió el usuario (13-oct): cada vez que alguien aprieta el botón o corre el
  // reloj queda un registro, y ese registro muestra SÓLO lo que apareció en él. Antes la
  // pantalla era una bolsa de 540 señales acumuladas donde no se podía preguntar «¿qué
  // salió hoy?», y por eso el trabajo no avanzaba: nadie sabe por dónde empezar una lista
  // de 540. Una revisión sin resolver NO se arrastra a la siguiente: la suya queda abierta.
  // `figs` es lo leído de aSa, por código: {cc: {estado, barras: {ref: barra}, msg}}. Es
  // caché a propósito —una lectura por código y no por barra— y se vacía al refrescar la
  // revisión, porque entonces lo de aSa puede haber cambiado.
  // EL NIVEL (4-nov): 'barra' o 'elemento'. Es la misma pantalla; cambia lo que se pide al
  // servidor y la fila de la hoja. Ver chequeos_elementos.py.
  var REVS = { nivel: 'barra', lista: [], sel: null, detalle: null, sel_items: {}, filtro_cub: undefined,
               figs: {}, anio: null, total: {} };
  // TODO LO RESUELTO DICE «RESUELTO» (20-oct), igual que en la auditoría: lo que dijo quien
  // lo hizo. Que aSa lo haya confirmado al cerrar se agrega, no es otro estado.
  var ESTADO_TXT = { abierta: 'Abierta', declarada: 'Resuelto',
                     corregir: 'Resuelto', corregida: 'Resuelto · aSa lo confirmó',
                     aceptada: 'No aplica' };

  function _fechaHora(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' +
           ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  async function cargarRevisiones() {
    try {
      var d = await req('GET', '/chequeos/revisiones?nivel=' + REVS.nivel);
      await global.cargarNomCub();
      REVS.lista = d.revisiones || [];
      REVS.total = d.total || {};
      if (REVS.filtro_cub === undefined) REVS.filtro_cub = _esAdmin() ? null : (_miChip() || null);
      pintarRevisiones();
      // NO SE ABRE NINGUNA SOLA. El bloque de arriba arranca mostrando el total de todas,
      // que es lo que se viene a ver; elegir una es FILTRAR, no el punto de partida.
      if (REVS.sel) await abrirRevision(REVS.sel); else pintarResumen();
    } catch (e) { $('revLista').innerHTML = '<div class="revvacio">' + esc(e.message) + '</div>'; }
  }

  // LAS REVISIONES, EN MATRIZ. Una fila por revisión y una COLUMNA POR CUBICADOR, que
  // salen del dato y no de una lista: si mañana aparece alguien nuevo, su columna aparece
  // sola. Con el filtro de año, un año que no tiene hallazgos de alguien no dibuja su
  // columna, que es lo que evita arrastrar ruido de años anteriores.
  //
  // ANTES ERAN DOS PANELES —la lista a la izquierda y el desglose por persona a la
  // derecha— y decían lo mismo dos veces. El detalle vive en el modal.
  function _anios() {
    var a = {};
    REVS.lista.forEach(function (r) { if (r.anio) a[r.anio] = 1; });
    return Object.keys(a).sort().reverse();
  }

  function _visibles() {
    if (!REVS.anio) return REVS.lista;
    return REVS.lista.filter(function (r) { return String(r.anio) === String(REVS.anio); });
  }

  // Las columnas: las personas con hallazgos en lo que se está mirando, de la que más
  // tiene a la que menos. El orden es el dato, no el alfabeto: la primera columna es
  // donde está el problema.
  // LAS COLUMNAS SON SIEMPRE LAS MISMAS (2-nov): salen del total y van en el mismo orden
  // alfabético que los chips de arriba. Antes se armaban con lo que hubiera en pantalla y
  // ordenadas por volumen, así que filtrar —o que alguien resolviera— movía las columnas
  // de sitio y la tabla entera se recolocaba. El usuario: «todo debe quedar tal cual,
  // simplemente deben actualizarse los valores; no mover textos ni cambiar el diseño».
  function _columnas(vis) {
    var tot = (REVS.total || {}).por_cubicador || {};
    var quienes = Object.keys(tot);
    if (!quienes.length) {
      vis.forEach(function (r) {
        Object.keys(r.por_cubicador || {}).forEach(function (q) {
          if (quienes.indexOf(q) === -1) quienes.push(q);
        });
      });
    }
    return quienes.sort(function (a, b) { return nomCub(a).localeCompare(nomCub(b), 'es'); });
  }

  // La cuenta de una revisión, entera o de UN cubicador: es lo que cambia con el filtro.
  function _cuentaDe(r, cub) {
    if (!cub) {
      return { n: r.detectados || 0, nap: r.no_aplica || 0, res: r.resueltas || 0,
               apl: r.aplican || 0, pct: r.pct };
    }
    var c = (r.por_cubicador || {})[cub];
    if (!c) return { n: 0, nap: 0, res: 0, apl: 0, pct: null };
    var apl = c.n - (c.no_aplica || 0);
    return { n: c.n, nap: c.no_aplica || 0, res: c.resueltos || 0, apl: apl,
             pct: apl ? Math.round((c.resueltos || 0) / apl * 100) : null };
  }

  function pintarRevisiones() {
    var el = $('revLista');
    if (!el) return;
    var vis = _visibles();
    $('revListaN').textContent = vis.length + ' revisión(es)' + (REVS.filtro_cub ? ' · ' + nomCub(REVS.filtro_cub) : '');
    // El filtro de año sólo aparece cuando hay más de uno: con un año solo es un control
    // que no decide nada.
    var anios = _anios();
    var caja = $('revAnios');
    if (caja) {
      caja.innerHTML = anios.length < 2 ? '' :
        '<button data-anio="" class="' + (REVS.anio ? '' : 'on') + '">Todos</button>' +
        anios.map(function (a) {
          return '<button data-anio="' + a + '" class="' + (String(REVS.anio) === String(a) ? 'on' : '') +
                 '">' + a + '</button>'; }).join('');
      caja.querySelectorAll('button[data-anio]').forEach(function (b) {
        b.addEventListener('click', function () {
          REVS.anio = b.dataset.anio || null; pintarRevisiones();
        });
      });
    }
    if (!vis.length) {
      el.innerHTML = '<div class="revvacio">' + (REVS.lista.length
        ? 'No hay revisiones de ese año.'
        : 'Todavía no se ha hecho ninguna revisión. Apreta «Nueva revisión».') + '</div>';
      return;
    }
    // LA TABLA NO SE MUEVE: las columnas son siempre las mismas, estés filtrando o no.
    // Lo que el filtro cambia son los VALORES de Estado y Hallazgos, que pasan a ser los
    // de esa persona. Llegué a dejar sólo su columna y eso recolocaba la tabla entera.
    var F = REVS.filtro_cub || null, cols = _columnas(vis);
    // LA SUMA DE CADA CUBICADOR, BAJO SU NOMBRE (2-nov): «con esto tengo inmediatamente el
    // estado por cubicador», sin ir fila por fila sumando de memoria. Cuenta lo que está a
    // la vista, que es lo que el filtro de año deja ver.
    var suma = {};
    cols.forEach(function (q) { suma[q] = { n: 0, cerr: 0 }; });
    vis.forEach(function (r) {
      var pc = r.por_cubicador || {};
      cols.forEach(function (q) {
        var c = pc[q];
        if (!c) return;
        suma[q].n += c.n || 0;
        suma[q].cerr += c.cerrados != null ? c.cerrados : (c.no_aplica || 0) + (c.resueltos || 0);
      });
    });
    // UN SOLO TAMAÑO DE NÚMERO; la jerarquía la dan el peso y el color (2-nov). Dos filas
    // de encabezado: la sección y la columna. La primera columna de cada sección lleva la
    // raya (`sec`). El orden es el del trabajo: quién tiene qué, en qué va, y al final —
    // atenuado— lo que la máquina detectó, que es el dato curioso, no el relevante.
    // VERDE = CERRADO: la celda de quien ya resolvió todo lo suyo y el avance al 100% se
    // pintan; no hay iconos.
    var PUNTO = '<span class="revvacio2">·</span>';
    var n0 = function (v, cls) { return v ? '<span class="' + (cls || '') + '">' + v + '</span>' : PUNTO; };
    el.innerHTML = '<table class="audt revmat"><thead>' +
      '<tr class="revsecs"><th></th>' +
      '<th colspan="' + cols.length + '" class="sec">Cubicadores</th>' +
      '<th colspan="3" class="sec">Estado</th>' +
      '<th colspan="3" class="sec curioso">Hallazgos</th><th></th></tr>' +
      '<tr><th>Revisión</th>' +
      cols.map(function (q, k) {
        var t = suma[q] || { n: 0, cerr: 0 }, mio = !F || F === q;
        return '<th class="num cub' + (k === 0 ? ' sec' : '') + '" title="' + esc(nomCub(q)) +
               ': cerradas de cuántas, por revisión. En total lleva ' + t.cerr + ' de ' + t.n +
               '. Para filtrar por esta persona, el chip de arriba.">' +
               esc(nomCub(q)) +
               '<div class="revsum">' + (mio && t.n
                 ? '<b>' + t.cerr + '</b>/' + t.n
                 : '<span class="revvacio2">·</span>') + '</div></th>'; }).join('') +
      '<th class="num est sec" title="Marcados como resueltos (incluye lo que aSa ya confirmó).">Resueltos</th>' +
      '<th class="num est" title="Aplican y todavía nadie los resolvió.">Por resolver</th>' +
      '<th class="revavth">Avance</th>' +
      '<th class="num cur sec curioso" title="Lo que la máquina marcó' + (F ? ' a ' + esc(nomCub(F)) : '') + '.">Detectados</th>' +
      '<th class="num cur curioso" title="Los que una persona miró y descartó con motivo.">No aplican</th>' +
      '<th class="num cur curioso" title="Los que quedan después de descartar los que no aplican. ' +
      'Es contra esto que se mide el avance.">Aplican</th>' +
      '<th></th></tr></thead><tbody>' +
      vis.map(function (r) {
        var pc = r.por_cubicador || {}, t = _cuentaDe(r, F);
        // Una fila sin nada que mirar —con el filtro puesto o sin él— va en gris. Es un
        // valor, no una estructura: la fila sigue ahí, con sus mismas columnas.
        var apagada = !t.n;
        var pend = Math.max(0, t.apl - t.res), lleno = t.apl > 0 && pend === 0;
        return '<tr class="revmatf' + (REVS.sel === r.id ? ' on' : '') + (apagada ? ' apagada' : '') +
          '" data-rev="' + r.id + '" title="Clic: el resumen de arriba se filtra a esta revisión">' +
          '<td><b>#' + r.id + '</b> <span class="revfecha">' + _fechaHora(r.arrancada) + '</span>' +
            '<div class="l2">' + esc(r.por === 'reloj' ? 'automática' : (r.por || '').split('@')[0]) +
            ' · ' + esc(r.obra || '') + '</div></td>' +
          cols.map(function (q, k) {
            var c = pc[q], cls = 'num cub' + (k === 0 ? ' sec' : '');
            // CON FILTRO, LOS DEMÁS NO TIENEN DATO QUE MOSTRAR (2-nov): la columna se
            // queda —la tabla no se mueve— pero el número se va, igual que en Estado y
            // en Hallazgos. Estás mirando a una persona, no a todas.
            if (F && F !== q) return '<td class="' + cls + '">' + PUNTO + '</td>';
            if (!c || !c.n) return '<td class="' + cls + '">' + PUNTO + '</td>';
            // Cerradas: las que pasaron por el cierre. Lo declarado sin cerrar no cuenta
            // —es alguien diciendo «ya está», y aSa todavía no lo ha confirmado—.
            var cerr = c.cerrados != null ? c.cerrados : (c.no_aplica || 0) + (c.resueltos || 0);
            var falta = c.n - cerr;
            // CERRADAS DE CUÁNTAS, como en la hoja (2-nov): «15/46» dice en qué va esa
            // persona en esa revisión; el total solo no decía si alguien lo estaba
            // mirando. En verde cuando ya no le queda nada.
            return '<td class="' + cls + (falta <= 0 ? ' listo' : '') + '" title="' + esc(nomCub(q)) + ' en la revisión #' + r.id +
                   ': ' + c.n + ' detectado(s)' +
                   (c.no_aplica ? ', ' + c.no_aplica + ' no aplica(n)' : '') +
                   (c.resueltos ? ', ' + c.resueltos + ' resuelto(s)' : '') +
                   (falta > 0 ? ', ' + falta + ' por resolver' : ', nada pendiente') + '">' +
                   '<b>' + cerr + '</b><span class="revde">/' + c.n + '</span></td>';
          }).join('') +
          '<td class="num est sec">' + n0(t.res, 'revbien') + '</td>' +
          '<td class="num est">' + (pend ? '<b class="revpend">' + pend + '</b>' : PUNTO) + '</td>' +
          // «Sin hallazgos» es NO HABER ENCONTRADO NADA. Una revisión en la que todo lo
          // encontrado no aplicaba está cerrada —100%—, no vacía: decía «sin hallazgos»
          // sobre seis hallazgos descartados.
          '<td class="revavtd' + (lleno || (t.n && !t.apl) ? ' listo' : '') + '">' + (!t.n
            ? '<span class="revsuave">sin hallazgos</span>'
            : '<div class="revav"><div class="revbar2"><i style="width:' +
              (t.apl ? (t.pct || 0) : 100) + '%"></i></div>' +
              '<span>' + (t.apl ? (t.pct || 0) : 100) + '%</span></div>') + '</td>' +
          '<td class="num cur sec curioso">' + n0(t.n) + '</td>' +
          '<td class="num cur curioso">' + n0(t.nap) + '</td>' +
          // Aplican en rojo: de lo detectado, es lo que quedó válido y hay que trabajar.
          '<td class="num cur curioso aplican">' + n0(t.apl) + '</td>' +
          // «ABRIR» A SECAS (29-oct). Entra a la hoja con los filtros que estén puestos.
          '<td class="revacc">' + (t.n
            ? '<button class="audmini ver" data-abrir="' + r.id + '">Abrir</button>'
            : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    // LOS DOS ENCABEZADOS QUEDAN FIJOS AL BAJAR (3-nov). La fila de columnas se pega justo
    // debajo de la de secciones: su alto se mide acá, porque creció con la suma por
    // cubicador y un número fijo en el CSS quedaba corto.
    var secs = el.querySelector('tr.revsecs');
    if (secs && secs.offsetHeight) el.style.setProperty('--revsec', secs.offsetHeight + 'px');
    // LA FILA ELIGE LA REVISIÓN, EL BOTÓN ENTRA. El cubicador se filtra arriba, con los chips.
    el.querySelectorAll('button[data-abrir]').forEach(function (b) {
      b.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        // «Abrir» desde la fila elige esa revisión sólo para abrirla: al cerrar la hoja se
        // vuelve a lo que había (el usuario: «no marqué filtro; al salir no debiera
        // dejarme nada seleccionado»).
        var antes = { sel: REVS.sel, detalle: REVS.detalle };
        await abrirRevision(Number(b.dataset.abrir));
        REVS.antes = antes;
        abrirItems(true);
      });
    });
    el.querySelectorAll('tr.revmatf').forEach(function (tr) {
      tr.addEventListener('click', function () {
        if (REVS.sel === Number(tr.dataset.rev)) { REVS.sel = null; REVS.detalle = null; pintarResumen(); pintarRevisiones(); }
        else abrirRevision(Number(tr.dataset.rev));
      });
    });
  }

  async function abrirRevision(id) {
    REVS.figs = {};
    REVS.sel = id;
    pintarRevisiones();
    $('revResCuerpo').innerHTML = '<div class="revvacio">Cargando…</div>';
    try {
      REVS.detalle = await req('GET', '/chequeos/revision/' + id + '?nivel=' + REVS.nivel);
      REV.reglas = {};
      Object.keys(REVS.detalle.reglas || {}).forEach(function (k) { REV.reglas[k] = REVS.detalle.reglas[k]; });
      pintarResumen();
    } catch (e) { $('revResCuerpo').innerHTML = '<div class="revvacio">' + esc(e.message) + '</div>'; }
  }

  // EL ESTADO, ARRIBA Y GLOBAL. Mira TODAS las revisiones; elegir una en la matriz lo
  // filtra a ella, y el chip de cubicador lo filtra a esa persona. Los dos filtros se
  // componen, y «Abrir» entra a la hoja con los que estén puestos. El usuario (29-oct):
  // «los cubicadores deben ser filtros no botones... si se presiona uno debe actualizarse
  // todo, la matriz, y al abrir mostrarle sólo lo de él. Así le damos el énfasis a Abrir».
  function pintarResumen() {
    var sel = REVS.sel && REVS.detalle ? REVS.detalle.revision : null;
    var T = REVS.total || {}, F = REVS.filtro_cub || null;
    // Las personas, con sus cuentas: de la revisión elegida o del total.
    // LA LISTA DE CHIPS SALE SIEMPRE DEL TOTAL, elijas la revisión que elijas: si saliera
    // de la revisión abierta, el menú perdería y ganaría botones al moverse por la tabla.
    var cubs = Object.keys(T.por_cubicador || {}).map(function (q) {
      var c = T.por_cubicador[q];
      return { q: q, n: c.n, no_aplica: c.no_aplica, resueltos: c.resueltos,
               viejas: c.viejas || 0, ccs: c.ccs || 0, obras: c.obras || 0 }; });
    // Lo que se muestra de una persona sí depende de dónde estés parado: si hay una
    // revisión abierta, sus números son los de ella.
    var enSel = {};
    (sel ? sel.por_cubicador || [] : []).forEach(function (c) {
      enSel[c.cubico] = { q: c.cubico, n: c.n, no_aplica: c.no_aplica || 0, resueltos: c.resueltas || 0,
                          viejas: c.viejas || 0, ccs: c.ccs || 0, obras: c.obras || 0 };
    });
    // EL MENÚ NO SE MUEVE (2-nov). Estaban ordenados por lo que le falta a cada uno, así
    // que resolver una barra reordenaba los chips y el que estabas mirando se iba de
    // lugar. El usuario: «al filtrar se modifica visualmente el menú; debe ser estático,
    // sólo editas data». Orden alfabético, que no depende de nada que cambie.
    cubs.sort(function (a, b) { return nomCub(a.q).localeCompare(nomCub(b.q), 'es'); });
    // Lo que se muestra: el total, la revisión, o esa persona dentro de eso.
    var base = sel
      ? { det: sel.detectados != null ? sel.detectados : sel.items, nap: sel.no_aplica || 0, res: sel.resueltas || 0,
          obras: sel.obras, ccs: sel.ccs_con_hallazgo, kg: sel.kg, viejas: sel.viejas || 0 }
      : { det: T.detectados || 0, nap: T.no_aplica || 0, res: T.resueltas || 0,
          obras: T.obras || 0, ccs: T.ccs_con_hallazgo || 0, kg: T.kg || 0, viejas: T.viejas || 0 };
    // Si esa persona no tiene nada en la revisión elegida, el filtro se QUEDA (lo puso el
    // usuario) y las tarjetas dicen cero: quitarlo solo sería un cambio sin que nadie lo pida.
    var mio = F ? ((sel ? enSel[F] : cubs.filter(function (c) { return c.q === F; })[0]) ||
                   { q: F, n: 0, no_aplica: 0, resueltos: 0, obras: 0, ccs: 0, viejas: 0 }) : null;
    var v = mio
      ? { det: mio.n, nap: mio.no_aplica, res: mio.resueltos, obras: mio.obras, ccs: mio.ccs, kg: null, viejas: mio.viejas }
      : base;
    // EL DENOMINADOR NO SE PUEDE MOVER (2-nov). Decía «166 / 277 resueltos de los que
    // aplican»: «aplican» es detectados menos los descartados, así que marcar un «no
    // aplica» bajaba el denominador y el porcentaje subía SOLO, sin que nadie corrigiera
    // nada. Un indicador que mejora sin trabajo está roto. Ahora todo se mide contra los
    // detectados, que es un número que ya no cambia.
    //
    // Y «no aplica» NO cuenta como resuelto: una corrigió la barra en aSa y la otra
    // descartó el hallazgo. Son dos disposiciones distintas y la norma pide poder
    // distinguirlas; además la tasa de descarte es el termómetro de las reglas —si se
    // descarta el 60%, el problema está en la regla, no en las barras—, y metida dentro
    // de «resuelto» no se vería nunca.
    var apl = Math.max(0, v.det - v.nap);
    var pend = Math.max(0, apl - v.res), cerr = v.nap + v.res;
    var pcent = function (x) { return v.det ? Math.round(x / v.det * 100) : 0; };
    var kpis = [
      // LO ÚNICO ACCIONABLE, PRIMERO Y EN ÁMBAR.
      [pend, 'por resolver', pend ? 'ocupa' : '', v.det ? 'de ' + v.det + ' detectado(s)' : ''],
      // EL PLAZO: cuántas llevan más de una semana sin que nadie las mire.
      [v.viejas || 0, 'abiertas hace más de 7 días', v.viejas ? 'urge' : '', ''],
      // EL AVANCE, contra los detectados: corregir y descartar son las dos formas de
      // cerrar, y las dos se ven por separado.
      [pcent(cerr) + '%', 'cerrado', pcent(cerr) === 100 ? 'listo' : '',
       '<i style="width:' + pcent(cerr) + '%"></i>', v.res + ' resueltos · ' + v.nap + ' no aplican'],
      // LA CALIDAD DE LAS REGLAS: lo que se descarta es lo que la máquina marcó de más.
      [pcent(v.nap) + '%', 'no aplican', '', '', v.nap + ' de ' + v.det + ' detectado(s)']
    ];
    var tit = (sel
      ? '<span class="revtit">Revisión #' + sel.id + '</span> <span class="muted">' + _fechaHora(sel.arrancada) +
        ' · ' + esc(sel.por === 'reloj' ? 'automática' : (sel.por || '').split('@')[0]) +
        ' · ' + esc(sel.obra || '') + '</span>' +
        '<button class="audmini" id="revTodo" title="Volver al total de todas las revisiones">✕ Ver todas</button>'
      : '<span class="revtit">Todas las revisiones</span> <span class="muted">' + (T.revisiones || 0) +
        ' corrida(s) · clic en una fila para filtrar</span>') +
      (F ? '<button class="revfiltro" id="revQuitaFiltro" title="Filtrado por cubicador. Clic para quitar el filtro.">' + esc(nomCub(F)) + ' ✕</button>' : '') +
      // EL ÉNFASIS VA EN ABRIR: un solo botón arriba que entra con lo que esté filtrado.
      (v.det ? '<button class="audbtn" id="revAbrir" title="Abrir la hoja con ' +
             (sel ? 'esta revisión' : 'todas las revisiones') + (F ? ', sólo lo de ' + esc(nomCub(F)) : '') + '">Abrir</button>' : '');
    $('revAccTit').innerHTML = tit;
    // El contexto —obras, códigos, kilos— no es un indicador: no se decide nada con él.
    // Va en una línea, no en tarjetas del mismo peso que lo que hay que hacer.
    var ctx = [v.obras ? v.obras + ' obra(s)' : '', v.ccs ? v.ccs + ' código(s) con hallazgo' : '',
               v.kg ? num(Math.round(v.kg)) + ' kg en juego' : ''].filter(Boolean).join(' · ');
    $('revResCuerpo').innerHTML =
      '<div class="revkpis">' + kpis.map(function (k) {
        return '<div class="revkpi ' + (k[2] || '') + '"><b>' + k[0] + '</b><span>' + k[1] + '</span>' +
               (k[3] ? (k[3].indexOf('<i') === 0 ? '<div class="revkbar">' + k[3] + '</div>'
                                                 : '<em>' + k[3] + '</em>') : '') +
               (k[4] ? '<em>' + k[4] + '</em>' : '') + '</div>'; }).join('') + '</div>' +
      (ctx ? '<div class="revctx">' + ctx + '</div>' : '') +
      (!base.det
        ? '<div class="revvacio">' + (sel
            ? 'Esta revisión no encontró hallazgos: se miraron ' + (sel.ccs || 0) +
              ' código(s) y todos cumplen. Queda el registro de que se revisó.'
            : 'Todavía no hay hallazgos.') + '</div>'
        // LOS CUBICADORES SON FILTROS, no botones de entrar. Sólo el nombre: los números
        // van en las tarjetas y en la matriz, no en el chip («que no contabilice ni muestre
        // los números en el botón de filtro», 29-oct).
        : '<div class="dshchips revcubs">' + cubs.map(function (c) {
            var falta = c.n - c.no_aplica - c.resueltos;
            // SIN el verde de «ya resolvió todo» (2-nov): el usuario lo leía como «filtro
            // puesto» —«acá hay 2 filtros pintados en verde»—. El único color de un chip es
            // el azul del que está puesto; lo resuelto se ve en la matriz.
            return '<button data-filtro-cub="' + esc(c.q) + '" class="' + (F === c.q ? 'on' : '') +
                   '" title="Filtrar todo por ' + esc(nomCub(c.q)) +
                   (falta <= 0 ? ': ya resolvió todo lo suyo' : ': le faltan ' + falta) + '">' +
                   esc(nomCub(c.q)) + '</button>'; }).join('') + '</div>');
    var vt = $('revTodo');
    if (vt) vt.addEventListener('click', function (e) {
      e.stopPropagation();
      REVS.sel = null; REVS.detalle = null;
      pintarResumen(); pintarRevisiones();
    });
    var ab = $('revAbrir');
    if (ab) ab.addEventListener('click', function () { abrirItems(true); });
    var qf = $('revQuitaFiltro');
    if (qf) qf.addEventListener('click', function (e) {
      e.stopPropagation(); REVS.filtro_cub = null; pintarResumen(); pintarRevisiones();
    });
    $('revResCuerpo').querySelectorAll('button[data-filtro-cub]').forEach(function (x) {
      x.addEventListener('click', function () {
        REVS.filtro_cub = (REVS.filtro_cub === x.dataset.filtroCub) ? null : x.dataset.filtroCub;
        pintarResumen(); pintarRevisiones();
      });
    });
  }

  // ══════ LA HOJA DE TRABAJO ══════
  // El admin ve todos los ítems con filtro rápido por cubicador; el cubicador ve sólo los
  // suyos (el backend igual se lo impide si intenta declarar lo ajeno). Dos checks, como
  // los pidió el usuario: la casilla marca lo que ya se corrigió, y el botón lanza la
  // consulta a aSa SÓLO de eso — el check le dice al sistema qué ir a buscar.
  function _esAdmin() { return ['admin', 'admin_calidad'].indexOf(global.currentRole) !== -1; }

  function _misLogins() {
    // Lo que el backend resuelve por alias; acá sólo hace falta para filtrar la vista.
    var yo = (global.currentUserEmail || '').toLowerCase();
    var nom = (global.currentUserName || '').toLowerCase().split(' ').filter(Boolean);
    return function (cubico) {
      var c = (cubico || '').toLowerCase();
      if (!c) return false;
      if (c === yo) return true;
      // inicial del nombre + apellido, la misma regla de alias_de
      return nom.length >= 2 && c.slice(-nom[nom.length - 1].length) === nom[nom.length - 1] &&
             c.charAt(0) === nom[0].charAt(0);
    };
  }

  function itemsVisibles() {
    var items = (REVS.detalle || {}).items || [];
    // TODOS VEN TODO (21-oct). Antes el cubicador veía sólo lo suyo; el usuario: «no quiero
    // que no puedan ver las observaciones de los otros». El chip filtra, para cualquiera;
    // al abrir queda puesto en el propio, que es por donde se empieza (`_miChip`).
    if (REVS.filtro_cub) {
      items = items.filter(function (i) { return (i.cubico || '(sin dato)') === REVS.filtro_cub; });
    }
    return items;
  }

  async function abrirItems(conFiltro) {
    REVS.sel_items = {};
    // Sin revisión elegida se abren TODAS: el estado de arriba es global, así que el
    // botón y los chips de cubicador tienen que poder entrar a todo.
    if (!REVS.detalle || (REVS.sel && REVS.detalle.revision.id !== REVS.sel)
        || (!REVS.sel && !REVS.detalle.revision.todas)) {
      try {
        REVS.detalle = await req('GET', '/chequeos/revision/' + (REVS.sel || 0) + '?nivel=' + REVS.nivel);
      } catch (e) { aviso(e.message); return; }
    }
    // El filtro de cubicador es el de arriba: la hoja abre con lo que esté puesto.
    $('revItemsModal').style.display = '';
    pintarItems();
  }
  function cerrarItems() {
    $('revItemsModal').style.display = 'none';
    // Si se entró con el «Abrir» de una fila, se vuelve a lo que había antes.
    if (REVS.antes) { REVS.sel = REVS.antes.sel; REVS.detalle = REVS.antes.detalle; REVS.antes = null; }
    // El chip del modal y el de arriba son el MISMO filtro: al volver, arriba se repinta.
    pintarResumen(); pintarRevisiones();
  }

  function pintarItems() {
    var d = REVS.detalle, r = d.revision, items = itemsVisibles();
    // EL AVISO DE CIERRE ES DE UN INTENTO, NO DE LA HOJA (3-nov). Quedaba arriba después de
    // que el usuario cambiara la barra a «no aplica»: ofrecía «cerrar igual» algo que ya no
    // estaba por cerrar. Cualquier cambio en la hoja lo deja sin efecto.
    var avisoViejo = $('revCierreAviso');
    if (avisoViejo) avisoViejo.remove();
    // Agrupado por código: es como se corrige (se abre un CC en aSa y se arregla lo de
    // ahí) y es como se comprueba (una lectura por código, no por barra).
    var grupos = {}, orden = [];
    items.forEach(function (i) {
      var k = i.cc || '(sin código)';
      if (!grupos[k]) { grupos[k] = { cc: i.cc, obra: i.obra, job: i.job, items: [] }; orden.push(k); }
      grupos[k].items.push(i);
    });
    $('revItemsTit').textContent = 'Revisión #' + r.id + ' · ' +
      (REVS.filtro_cub ? items.length + ' de ' + r.items + ' hallazgos · ' + nomCub(REVS.filtro_cub)
                       : r.items + ' hallazgos') + ' · ' + orden.length + ' código(s)';
    // CERRADA ES LA QUE PASÓ POR EL CIERRE (2-nov), igual que en la matriz: «declarada»
    // es alguien diciendo «ya la corregí» y aSa todavía no lo confirmó. Lo decidido sin
    // cerrar se ve en el pie del código, que es quien lo cierra.
    function _resueltos(lista) { return lista.filter(_cerrada).length; }
    var hechos = _resueltos(items);
    var pct = items.length ? Math.round(hechos / items.length * 100) : 0;
    // CERRADAS, NO «RESUELTAS» (2-nov): acá cuentan también las que no aplican, y
    // «resuelta» es sólo la que se corrigió en aSa. Una palabra por concepto.
    $('revItemsAvance').innerHTML = '<span>' + hechos + ' de ' + items.length + ' cerradas</span>' +
      '<div class="revbar2"><i style="width:' + pct + '%"></i></div><b>' + pct + '%</b>';
    // Filtro rápido por cubicador: sólo para quien ve a todos.
    var cubs = $('revItemsCubs');
    // Los chips de cubicador son para todos (21-oct): el propio viene puesto, «Todos» abre.
    {
      // Sólo el nombre, igual que arriba: la cuenta ya está en «N de M hallazgos».
      cubs.innerHTML = '<button data-cub="" class="' + (REVS.filtro_cub ? '' : 'on') + '">Todos</button>' +
        r.por_cubicador.map(function (c) {
          return '<button data-cub="' + esc(c.cubico) + '" class="' + (REVS.filtro_cub === c.cubico ? 'on' : '') +
                 '">' + esc(nomCub(c.cubico)) + '</button>';
        }).join('');
      cubs.querySelectorAll('button[data-cub]').forEach(function (b) {
        b.addEventListener('click', function () {
          REVS.filtro_cub = b.dataset.cub || null; REVS.sel_items = {}; pintarItems();
        });
      });
    }
    _pintarAcc();
    // TODOS LOS CÓDIGOS, UNO DEBAJO DEL OTRO (2-nov). Hubo un paso intermedio —una lista
    // de códigos y un clic para entrar a cada uno— que se puso cuando la hoja era una tira
    // de 233 filas sin agrupar. Con el código agrupado, su cabecera y su botón de cerrar,
    // ese paso sobra: se baja y se va cerrando. Las figuras siguen siendo perezosas, así
    // que tener treinta bloques en pantalla no cuesta más que tener uno.
    $('revItemsCuerpo').innerHTML = !items.length
      ? '<div class="revvacio">No hay hallazgos tuyos en esta revisión.</div>'
      : orden.map(function (k) {
          var g = grupos[k], ok = _resueltos(g.items), fg = REVS.figs[g.cc], quienes = {};
          g.items.forEach(function (x) { if (x.cubico) quienes[x.cubico] = 1; });
          return '<div class="revcc2' + (ok >= g.items.length ? ' listo' : '') +
            '" data-grupocc="' + esc(g.cc || '') + '"><h5>' +
            '<b>' + esc(g.cc || '—') + '</b> <span class="muted">' + esc(g.obra || '') + '</span>' +
            (Object.keys(quienes).length
              ? '<span class="revquien">' + esc(Object.keys(quienes).map(nomCub).join(', ')) + '</span>' : '') +
            '<div style="flex:1"></div>' +
            // El código que ya salió a la obra se dice: lo que se encuentre acá es
            // registro, no tarea. Corregirlo en aSa no cambia el fierro que ya se fue.
            (g.items[0] && g.items[0].cc_ido
              ? '<span class="revido" title="Este código está ' + esc(g.items[0].cc_estado || '') +
                ' en aSa: el fierro ya salió. El hallazgo queda registrado, pero corregirlo ' +
                'acá no cambia lo despachado.">ya despachado</span>' : '') +
            (g.cc && !fg && REVS.nivel === 'barra' ? '<button class="audmini" data-figs="' + esc(g.cc) +
                           '" title="Lee este código en aSa y dibuja sus barras">Ver figuras</button>' : '') +
            // EL AVANCE DEL CÓDIGO, COMPACTO Y A LA DERECHA: «3/10» se lee bajando por la
            // hoja sin tener que leer una frase en cada cabecera.
            '<span class="revcuenta" title="Cerradas: resueltas y no aplican, sobre los ' +
            'hallazgos del código."><b>' + ok + '</b>/' + g.items.length + '</span></h5>' +
            _tablaGrupo(g) + _pieGrupo(g) + '</div>';
        }).join('');
    _bindItems();
    // Los chips S/M/L: cambiar el tamaño rehace los SVG, así que repinta la hoja.
    if (global.audChipsTam) global.audChipsTam('revTam', pintarItems);
  }

  // LA BARRA DE ACCIONES SE PINTA SOLA. Antes marcar un check repintaba la hoja entera,
  // que con las figuras cargadas serían trescientos SVG rehechos por clic.
  //
  // SIN MARCAS NO HAY BARRA (29-oct). Antes la barra de lote estaba siempre, con sus
  // botones apagados, incluso en la lista de códigos donde no hay nada que marcar; y con
  // cincuenta barras quedaba fuera de pantalla: se marcaba y «no pasaba nada». Ahora lo
  // que vale siempre —ver las figuras, cerrar lo resuelto— vive en el encabezado de la
  // hoja, y la barra aparece recién con la primera marca, pegada arriba, y te sigue.
  function _pintarAcc() {
    var n = Object.keys(REVS.sel_items).length;
    var faltan = _ccsSinFigura().length;
    // CUÁNTO HAY MARCADO RESUELTO Y SIN CERRAR: es lo que el botón de cerrar va a llevar a
    // aSa. Se cuenta sobre lo visible (lo mío, o lo filtrado si soy admin).
    var porCerrar = itemsVisibles().filter(function (i) {
      return i.estado === 'declarada' || i.estado === 'corregir'; }).length;
    var f = $('revAccFiguras');
    if (f) {
      f.style.display = faltan ? '' : 'none';
      if (!f.disabled) f.textContent = 'Ver las figuras (' + faltan + ')';
      f.title = 'Lee los ' + faltan + ' código(s) en aSa y dibuja cada barra. Va de a uno para no colgarse.';
      if (!f.dataset.ok) { f.dataset.ok = '1'; f.addEventListener('click', function () { cargarTodasLasFiguras(f); }); }
    }
    // CERRAR VA A aSa: comprueba todo lo que está marcado resuelto y avisa, sin bloquear,
    // lo que allá sigue como estaba. Mismo flujo que la auditoría.
    var cz = $('revAccCerrar');
    if (cz) {
      cz.disabled = !porCerrar;
      cz.textContent = 'Cerrar lo resuelto' + (porCerrar ? ' (' + porCerrar + ')' : '');
      cz.title = porCerrar
        ? 'Comprueba en aSa las ' + porCerrar + ' barra(s) resueltas y las da por cerradas. Si alguna ' +
          'sigue como estaba, te lo dice antes.'
        : 'No hay barras resueltas por cerrar.';
      if (!cz.dataset.ok) { cz.dataset.ok = '1'; cz.addEventListener('click', function () { cerrarResueltos(false); }); }
    }
    // O UNA A UNA, O EN LOTE: con marcas, los botones de la fila se atenúan.
    var cuerpo = $('revItemsCuerpo');
    if (cuerpo) cuerpo.classList.toggle('lote', n > 0);
    var acc = $('revItemsAcc');
    acc.style.display = n ? '' : 'none';
    if (!n) { acc.innerHTML = ''; return; }
    acc.innerHTML =
      '<b>' + n + ' barra(s) marcada(s)</b>' +
      // LOS TRES VERBOS, DE A MUCHAS (20-oct). «Muchas veces el hallazgo es el mismo para
      // más de un ítem»: se marcan los checks y lo que se hace se replica. «No aplica»
      // pide la explicación UNA vez y vale para todas; «Resuelto» y «Aplica» van directo.
      // Los mismos verbos que la fila, de a muchas: Resuelto · No aplica (campo al lado,
      // una explicación para todas, Enter) · Deshacer.
      '<button class="audbres" data-lote="declarada"' +
        ' title="Marca las barras marcadas como resueltas: ya hiciste el cambio en aSa. Al cerrar ' +
        'se comprueba contra aSa y, si algo sigue igual, te avisa.">Resuelto</button>' +
      '<button class="revnapbtn" data-lote="aceptada" id="revAccNoAplica"' +
        ' title="Deja sin efecto las marcadas, con una sola explicación para todas">No aplica</button>' +
      '<input type="text" class="revnapin" id="revAccNapNota" style="display:none"' +
        ' placeholder="¿por qué no aplican? … y Enter" title="Una explicación para todas las marcadas. Enter guarda; Esc deja.">' +
      '<button class="audmini" data-lote="abierta" title="Las marcadas vuelven a quedar abiertas">Deshacer</button>' +
      '<div style="flex:1"></div>' +
      '<button class="audmini" id="revAccQuitar" title="Desmarcar todo">Quitar selección</button>';
    var lr = document.querySelector('#revItemsAcc button[data-lote="declarada"]');
    if (lr) lr.addEventListener('click', function () { loteMarcadas('declarada', lr); });
    var la = document.querySelector('#revItemsAcc button[data-lote="abierta"]');
    if (la) la.addEventListener('click', function () { loteMarcadas('abierta', la); });
    var q = $('revAccQuitar');
    if (q) q.addEventListener('click', quitarSeleccion);
    var na = $('revAccNoAplica'), nota = $('revAccNapNota');
    // Mismo trato que el de la fila: el botón queda encendido mientras se escribe.
    if (na) na.addEventListener('click', function () {
      nota.style.display = '';
      na.classList.add('eligiendo');
      nota.focus();
    });
    if (nota) nota.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') noAplicaMarcadas();
      if (e.key === 'Escape') { nota.style.display = 'none'; nota.value = ''; na.classList.remove('eligiendo'); }
    });
  }

  // Sólo el pie, que es lo único que cambia al escribir: repintar la hoja entera por cada
  // tecla sería rehacer trescientos SVG.
  function _repintarPie(cc) {
    var caja = document.querySelector('.revcc2[data-grupocc="' + (cc || '').replace(/"/g, '') + '"]');
    var g = _grupoDe(cc);
    if (!caja || !g) return;
    var pie = caja.querySelector('.revccpie');
    if (!pie) return;
    var nuevo = document.createElement('div');
    nuevo.innerHTML = _pieGrupo(g);
    pie.innerHTML = nuevo.firstChild.innerHTML;
    _bindCerrar(pie);
  }

  function _bindCerrar(donde) {
    donde.querySelectorAll('button[data-cerrarcc]').forEach(function (b) {
      b.addEventListener('click', function () { cerrarCC(b.dataset.cerrarcc, b); });
    });
  }

  function quitarSeleccion() {
    REVS.sel_items = {};
    var caja = $('revItemsCuerpo');
    if (caja) caja.querySelectorAll('input[data-item], input[data-grupo]').forEach(function (c) { c.checked = false; });
    _pintarAcc();
  }

  // DEJAR SIN EFECTO LO MARCADO, con UNA explicación para todas. El backend ya recibía
  // varios ids: lo que faltaba era la pantalla.
  async function noAplicaMarcadas() {
    var ids = _marcados();
    if (!ids.length) return;
    var nota = ($('revAccNapNota').value || '').trim();
    if (nota.length < 10) { aviso('Hace falta la explicación: la lee quien audita.'); return; }
    var b = $('revAccNoAplica');
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      var r = await req('PUT', '/chequeos/declarar',
                        { ids: ids, estado: 'aceptada', nota: nota });
      ok((r.afectadas || ids.length) + ' barra(s) dejadas sin efecto');
      REVS.sel_items = {};
      await refrescarRevision();
    } catch (e) {
      aviso(e.message);
      b.disabled = false; b.textContent = 'No aplica';
    }
  }

  // ══════ LAS FIGURAS ══════
  // Se piden POR CÓDIGO porque así las devuelve aSa y así están agrupadas las filas: una
  // lectura sirve a todas las barras de ese código. Pedirlas de a una sería multiplicar
  // por diez el tiempo para el mismo dibujo.
  function _ccsVisibles() {
    var vistos = {}, out = [];
    itemsVisibles().forEach(function (i) {
      var k = i.cc || '';
      if (k && !vistos[k]) { vistos[k] = 1; out.push({ cc: k, job: i.job }); }
    });
    return out;
  }
  // Mi chip en el TOTAL: el cubicador entra a la pestaña con su filtro puesto (es por donde
  // empieza) y lo puede quitar; el admin entra sin filtro.
  function _miChip() {
    var mio = _misLogins(), pc = (REVS.total || {}).por_cubicador || {};
    return Object.keys(pc).filter(function (q) { return mio(q); })[0] || '';
  }

  function _ccsSinFigura() {
    if (REVS.nivel === 'elemento') return [];
    return _ccsVisibles().filter(function (g) { return !REVS.figs[g.cc]; });
  }

  // La barra que corresponde a una señal dentro de lo leído: por referencia y, si no, por
  // la marca —el mismo par que ya usaba el detalle de una señal—.
  function _barraDe(cc, ref) {
    var c = REVS.figs[cc];
    if (!c || c.estado !== 'listo') return null;
    return c.barras[ref] || c.barras[String(ref).split('#')[0]] || null;
  }

  // LOS LADOS DE LA FIGURA, que es lo que el usuario necesita para decidir sin abrir
  // aSa. Salen de la misma lectura que trae el dibujo —`dims` de la barra normalizada—
  // así que no cuesta una llamada más. Mientras no se hayan pedido las figuras se
  // muestra sólo el lado del hallazgo, que es el dato que la señal ya trae.

  function _celda(cc, ref, sen) {
    var c = REVS.figs[cc];
    if (!c) return '';
    if (c.estado === 'cargando') return '<span class="muted">…</span>';
    if (c.estado === 'error') return '<span class="muted" title="' + esc(c.msg || '') + '">sin dibujo</span>';
    var b = _barraDe(cc, ref);
    // LA BARRA QUE YA NO ESTÁ ESTÁ CORREGIDA: alguien la cambió o la sacó del código, y
    // es lo mismo que mira el sistema para cerrarla sola.
    if (!b) return '<div class="revcorr" title="La barra ya no está en este código en aSa: ' +
                   'alguien la cambió o la sacó.">corregido</div>';
    if (!global.audBarraNormalizada || !global.audCeldaFigura) return '';
    try {
      // EL SELLO, DEBAJO DEL DIBUJO. El dibujo es aSa de ahora; si el lado que motivó el
      // hallazgo ya cumple, se dice con todas las letras en vez de dejar que el usuario
      // compare contra la columna —que es la medida vieja— y crea que algo está mal.
      return global.audCeldaFigura(global.audBarraNormalizada(b, 'asa')) + _selloCorregido(sen, b);
    } catch (e) { return '<span class="muted">—</span>'; }
  }

  // ¿Lo que motivó el hallazgo ya está arreglado en lo que acabamos de leer de aSa? Se
  // compara el lado marcado contra el mínimo que pedía la regla. Si la señal no trae
  // lados y mínimo —hay reglas que miran otra cosa— no se dice nada: inventar un
  // «corregido» sería peor que no decirlo.
  function _selloCorregido(sen, b) {
    var i = _senalDe(sen);
    if (!i || i.estado === 'aceptada') return '';
    var det = i.detalle || {}, esp = Number(det.esperado);
    var malos = det.lados || [];
    if (!(esp > 0) || !malos.length || !b.dims) return '';
    var ok = malos.every(function (L) {
      var v = Number(b.dims[String(L).toUpperCase()] || b.dims[L]);
      return v > 0 && v >= esp - 0.01;
    });
    return ok ? '<div class="revcorr" title="El lado que motivó el hallazgo ya cumple en aSa: ' +
                'mide lo que pide la regla. Al cerrar el código queda confirmado.">corregido</div>' : '';
  }

  function _senalDe(id) {
    var items = (REVS.detalle || {}).items || [];
    for (var k = 0; k < items.length; k++) if (String(items[k].id) === String(id)) return items[k];
    return null;
  }

  // Se escribe SOBRE las celdas, sin repintar la hoja: lo que ya está marcado sigue
  // marcado y los formularios abiertos no se cierran.

  // Olvida lo leído de los códigos a los que pertenecen esas señales.
  // LA FIGURA, CUANDO LLEGA. Sólo el dibujo: los lados ya están en la fila, salidos de la
  // señal, y no cambian con la lectura.
  function _pintarFiguras(cc) {
    var caja = $('revItemsCuerpo');
    if (!caja) return;
    caja.querySelectorAll('td[data-fig]').forEach(function (td) {
      if (cc && td.dataset.cc !== cc) return;
      td.innerHTML = _celda(td.dataset.cc, td.dataset.fig, td.dataset.sen);
    });
  }

  function _olvidarFiguras(ids) {
    var m = {};
    ids.forEach(function (x) { m[String(x)] = 1; });
    ((REVS.detalle || {}).items || []).forEach(function (i) {
      if (m[String(i.id)] && i.cc) delete REVS.figs[i.cc];
    });
  }

  async function cargarFiguras(cc, job) {
    if (!cc || REVS.figs[cc]) return;
    REVS.figs[cc] = { estado: 'cargando', barras: {} };
    _pintarFiguras(cc);
    try {
      // Sin `element`: el código entero de una vez. aSa cobra lo mismo por uno que por
      // todos sus elementos, y las filas de un grupo son de varios elementos.
      var d = await req('GET', '/auditorias/elemento-asa?cc=' + encodeURIComponent(cc));
      var ix = {};
      (d.barras || []).forEach(function (b) {
        if (b.ref) ix[b.ref] = b;
        if (b.marca && !ix[b.marca]) ix[b.marca] = b;
      });
      REVS.figs[cc] = { estado: 'listo', barras: ix };
    } catch (e) {
      REVS.figs[cc] = { estado: 'error', barras: {}, msg: e.message };
    }
    _pintarFiguras(cc);
  }

  // SE PIDEN SOLAS, PERO SÓLO LAS QUE SE ESTÁN MIRANDO. Una columna vacía no se lee como
  // «apretá acá», se lee como que está rota —el usuario lo dijo: «faltó el renderizado»—
  // y pedir los cuarenta y ocho códigos al abrir serían dos minutos y medio de espera.
  // Con el observer, bajar por la hoja va pidiendo lo que aparece, de a uno y en orden.
  // LAS FIGURAS SE PIDEN, NO LLEGAN SOLAS (3-nov). Hubo un observador de scroll que pedía a
  // aSa las barras de cada código al entrar en pantalla, ~2-3 s por código y en serie: con
  // treinta códigos a la vista, bajar por la hoja era encolar lecturas, y la hoja se ponía
  // cada vez más lenta. El usuario: «mejor que las figuras se muestren sólo si el usuario
  // presiona Ver figuras para ese CC en específico». El botón del código pide ese código;
  // el de arriba, todos los que falten.

  // DE A UNO Y CON CUENTA. Treinta códigos en paralelo tumban la sesión de aSa; en serie
  // se ve avanzar y se puede cerrar el modal sin dejar nada a medias.
  async function cargarTodasLasFiguras(boton) {
    var faltan = _ccsSinFigura();
    if (!faltan.length) return;
    if (boton) boton.disabled = true;
    for (var i = 0; i < faltan.length; i++) {
      if (!$('revItemsModal') || $('revItemsModal').style.display === 'none') break;
      if (boton) boton.textContent = 'Leyendo aSa… ' + (i + 1) + ' de ' + faltan.length;
      await cargarFiguras(faltan[i].cc, faltan[i].job);
    }
    _pintarAcc();
  }


  // UN SOLO ENCABEZADO POR CÓDIGO (21-oct, lo pidió el usuario: «estamos repitiendo A, B y
  // C muchas veces»): Marca · Figura · A B C… · α1 α2… · Esperado · Regla · Estado. Las
  // letras y los ángulos salen de la señal (`detalle.lados_all`, guardado al detectar), así
  // que no dependen de haber leído aSa; la figura sólo dibuja. Las señales de antes de hoy
  // traen sólo los lados marcados hasta la próxima revisión, que las rellena.
  function _colsGrupo(items) {
    var letras = [], vistas = {}, nang = 0;
    items.forEach(function (i) {
      var det = i.detalle || {}, la = det.lados_all || [];
      la.forEach(function (l, k) {
        if (!vistas[l[0]]) { vistas[l[0]] = 1; letras.push(l[0]); }
        if (k > 0 && l[2] != null) nang = Math.max(nang, k);
      });
      if (!la.length) (det.lados || []).forEach(function (L) { if (!vistas[L]) { vistas[L] = 1; letras.push(L); } });
    });
    letras.sort();
    return { letras: letras, nang: nang };
  }

  function _tablaGrupo(g) {
    if (REVS.nivel === 'elemento') return _tablaElementos(g);
    var c = _colsGrupo(g.items), ang = '';
    for (var k = 1; k <= c.nang; k++) ang += '<th class="revn reva">α' + k + '</th>';
    // El check «todas» va donde van los checks: en su columna (29-oct). Antes estaba en
    // el título del código, mezclado con la obra y «Ver figuras».
    return '<table><tr class="revhead"><th style="width:22px"><input type="checkbox" data-grupo="' +
      esc(g.cc || '') + '" title="Marcar todas las barras de este código"></th><th>Marca</th><th>Figura</th>' +
      // LAS MEDIDAS SON LAS DEL MOMENTO EN QUE SALTÓ (3-nov). El dibujo, en cambio, se lee
      // de aSa cuando se aprieta «Ver figuras»: si alguien ya corrigió la barra, el dibujo
      // muestra la medida nueva y la columna la vieja, y parecen contradecirse. Son dos
      // cosas distintas y la cabecera lo dice.
      c.letras.map(function (L) {
        return '<th class="revn" title="Medida del lado ' + esc(L) + ' cuando se detectó el ' +
               'hallazgo. El dibujo es lo que hay en aSa ahora: si no calzan, es que la ' +
               'barra ya se corrigió.">' + esc(L) + '</th>'; }).join('') + ang +
      '<th class="revn" title="Lo que la regla pide: un mínimo en el lado corto, la medida exacta en los opuestos">Esperado</th>' +
      '<th>Regla</th><th>Estado</th><th></th></tr>' +
      g.items.map(function (i) { return filaItem(i, c); }).join('') + '</table>';
  }

  // EL PIE DEL CÓDIGO: un solo botón que cierra todo lo de este CC. Dice lo que falta
  // mientras falte, y recién cuando no queda nada por decidir deja cerrar.
  function _pieGrupo(g) {
    var e = _estadoCC(g);
    var cosa = REVS.nivel === 'elemento' ? 'hallazgo(s)' : 'barra(s)';
    var txt = e.faltan
      ? 'Faltan ' + e.faltan + ' ' + cosa + ' por decidir'
      : (e.porGuardar || e.porCerrar)
        ? 'Cerrar código' + (e.porCerrar ? ' (' + e.porCerrar + ')' : '')
        : 'Código cerrado';
    var ayuda = e.faltan
      ? 'Cada ' + (REVS.nivel === 'elemento' ? 'hallazgo' : 'barra') + ' tiene que quedar como Resuelto, ' +
        'o como No aplica con su explicación. Faltan ' + e.faltan + '.'
      : e.porCerrar
        ? 'Guarda lo escrito y comprueba en aSa las ' + e.porCerrar + ' barra(s) resueltas. ' +
          'Si alguna sigue como estaba, te lo dice antes de cerrar.'
        : e.porGuardar ? 'Guarda las explicaciones escritas y da el código por cerrado.'
                       : 'Este código ya está cerrado: no queda nada que decidir.';
    return '<div class="revccpie">' +
      '<div class="revbar2"><i style="width:' +
        (g.items.length ? Math.round((e.cerradas + e.porGuardar) / g.items.length * 100) : 0) + '%"></i></div>' +
      '<span class="muted">' + (e.cerradas + e.porGuardar) + ' de ' + g.items.length + ' cerradas</span>' +
      '<div style="flex:1"></div>' +
      '<button class="audenviar" data-cerrarcc="' + esc(g.cc || '') + '"' +
        (e.faltan || !(e.porGuardar || e.porCerrar) ? ' disabled' : '') +
        ' title="' + esc(ayuda) + '">' + txt + '</button></div>';
  }

  // EN QUÉ VA EL CÓDIGO. `porGuardar` son las explicaciones escritas y todavía no
  // mandadas: cuentan como decididas —el usuario ya tomó la decisión, sólo falta
  // guardarla— y por eso no bloquean el cierre.
  function _estadoCC(g) {
    var faltan = 0, porGuardar = 0, porCerrar = 0, cerradas = 0;
    (g.items || []).forEach(function (i) {
      if (_cerrada(i)) { cerradas++; return; }
      if (i.estado === 'declarada' || i.estado === 'corregir') { porCerrar++; return; }
      if (_notaDe(i.id).length >= 10) porGuardar++;
      else faltan++;
    });
    return { faltan: faltan, porGuardar: porGuardar, porCerrar: porCerrar, cerradas: cerradas };
  }

  // Lo escrito en el campo del «no aplica» de esa fila, si está abierto.
  // Cerrada: no aplica, aSa la confirmó, o se cerró bajo la firma de quien lo decidió.
  function _cerrada(i) {
    return i.estado === 'aceptada' || i.estado === 'corregida' ||
           ((i.estado === 'declarada' || i.estado === 'corregir') && !!i.cerrada_el);
  }

  function _notaDe(id) {
    var i = document.querySelector('input[data-nota="' + id + '"]');
    return (i && i.style.display !== 'none' && (i.value || '').trim()) || '';
  }

  // LA TARJETA ESTÁNDAR DEL HALLAZGO DE ELEMENTO (4-nov). Es una fila de la misma tabla
  // —`tr[data-fila]`, el check, data-resuelto / data-noaplica / data-nota / data-deshacer—
  // para que el lote, el espejo, el pie y «Cerrar código» funcionen sin tocar nada. Lo que
  // cambia es lo que hay adentro: regla y grupo · los dos códigos · encontrado ← esperado ·
  // la diferencia · la lista de lo que falta o sobra · estado y botones.
  function _tablaElementos(g) {
    return '<table><tr class="revhead"><th style="width:22px"><input type="checkbox" data-grupo="' +
      esc(g.cc || '') + '" title="Marcar todos los hallazgos de este código"></th>' +
      '<th>Hallazgo · comparación · estado</th></tr>' +
      g.items.map(_filaElemento).join('') + '</table>';
  }

  function _filaElemento(i) {
    var d = i.detalle || {}, r = (REV.reglas || {})[i.regla] || { nombre: i.regla, grupo: d.grupo };
    var hecho = i.estado === 'corregida', nap = i.estado === 'aceptada';
    var resuelto = hecho || i.estado === 'declarada' || i.estado === 'corregir';
    var grupo = r.grupo || d.grupo || 'todas';
    var act = d.actual || { cc: i.cc, descr: '', kg: null }, con = d.contra || {};
    var igual = i.regla === 'codigo_duplicado';
    var firma = '';
    if (nap) {
      firma = '<span class="revfirma">' + esc(i.nota || '') + (i.resuelto_por ? ' — ' + esc(i.resuelto_por.split('@')[0]) : '') + '</span>';
    } else if (resuelto && i.declarada_por) {
      firma = '<span class="revfirma">resuelto por ' + esc(i.declarada_por.split('@')[0]) +
              (i.declarada_el ? ' · ' + _fechaHora(i.declarada_el) : '') + (hecho ? ' · aSa lo confirmó' : '') + '</span>';
    }
    var acc = hecho ? '<span class="muted">confirmada</span>'
      : (resuelto || nap)
        ? '<button class="audmini" data-deshacer="' + i.id + '" title="Vuelve a dejarlo abierto">Deshacer</button>'
        : '<div class="revaccs">' +
            '<button class="audbres" data-resuelto="' + i.id + '" title="Márcalo cuando ya lo hayas corregido en aSa. ' +
              'Al cerrar el código se vuelve a comparar y, si sigue igual, te avisa.">Resuelto</button>' +
            '<button class="revnapbtn" data-noaplica="' + i.id + '" title="Dejar sin efecto, con una explicación firmada.">No aplica</button>' +
            '<input type="text" class="revnapin" data-nota="' + i.id + '" style="display:none"' +
              ' placeholder="¿por qué? … y Enter" title="Escribe la explicación y aprieta Enter. Esc para dejarlo.">' +
          '</div>';
    var cod = function (c, sub) {
      return '<div><b>' + esc(c.cc || '') + '</b><span class="muted">' + esc(c.descr || '') +
             (c.kg != null ? ' · ' + num(c.kg) + ' kg' : '') + (sub ? '<br>' + sub : '') + '</span></div>'; };
    var medidas = (d.medidas || []).map(function (m) {
      return '<div class="m' + (m.encontrado !== m.esperado ? ' mal' : '') + '"><b>' + esc(num(m.encontrado)) + '</b>' +
             (m.esperado != null ? ' <i>← ' + esc(num(m.esperado)) + '</i>' : '') + '<span>' + esc(m.que) + '</span></div>'; }).join('') +
      (d.diferencia ? '<div class="m dif"><b>' + esc(d.diferencia.valor) + '</b><span>' + esc(d.diferencia.que) + '</span></div>' : '');
    var lista = (d.lista || []).map(function (x) { return '<span class="' + esc(x.tipo || '') + '">' + esc(x.texto) + '</span>'; });
    if (d.posible_ultimo_piso) lista.push('<span class="aviso">posible último piso: suele ser distinto</span>');
    return '<tr class="elfila' + (hecho ? ' hecho' : nap ? ' nap' : '') + '" data-fila="' + i.id + '">' +
      '<td style="width:22px; vertical-align:top; padding-top:12px">' + (hecho ? '✓' :
        '<input type="checkbox" data-item="' + i.id + '"' + (REVS.sel_items[i.id] ? ' checked' : '') +
        ' title="Marcar para resolver varios de una vez">') + '</td>' +
      '<td class="elcel"><div class="elh">' +
        '<div><span class="elregla ' + esc(grupo) + '">' + esc(r.corto || r.nombre) +
          '<small>' + (grupo === 'edificacion' ? 'sólo edificación' : 'todas las obras') + '</small></span>' +
          '<div class="l2" style="margin-top:6px" title="' + esc(d.texto || '') + '">' + esc(r.nombre || '') + '</div></div>' +
        '<div class="elcomp"><div class="vs">' + cod(act) + '<span class="flecha">' + (igual ? '=' : '←') + '</span>' +
          cod(con, igual ? 'el otro código' : 'piso anterior, mismo ciclo') + '</div>' +
          '<div class="elmed">' + medidas + '</div>' +
          (lista.length ? '<div class="ellista">' + lista.join('') + '</div>' : '') + '</div>' +
        '<div class="elacc"><span class="revi ' + esc(i.estado) + '">' + esc(ESTADO_TXT[i.estado] || i.estado) + '</span>' +
          firma + acc + '</div>' +
      '</div></td></tr>';
  }

  function filaItem(i, c) {
    var det = i.detalle || {}, r = (REV.reglas || {})[i.regla] || { nombre: i.regla };
    var hecho = i.estado === 'corregida', nap = i.estado === 'aceptada';
    var resuelto = hecho || i.estado === 'declarada' || i.estado === 'corregir';
    var cm = global.audNumCm || function (x) { return Math.round(Number(x) || 0); };
    var malos = {}, porL = {}, angs = [];
    (det.lados || []).forEach(function (L) { malos[L] = 1; });
    (det.lados_all || []).forEach(function (l, k) { porL[l[0]] = l[1]; if (k > 0) angs[k - 1] = l[2]; });
    if (!(det.lados_all || []).length) (det.lados || []).forEach(function (L) { porL[L] = det.valor; });
    // LA FIRMA VA AL FINAL DE LA FILA (2-nov), no debajo de la marca: ahí empujaba la
    // columna y separaba la marca de su figura. Acá acompaña a la decisión que explica.
    var firma = '';
    if (nap) {
      firma = '<span class="revfirma">' + esc(i.nota || '') +
              (i.resuelto_por ? ' — ' + esc(i.resuelto_por.split('@')[0]) : '') + '</span>';
    } else if (resuelto && i.declarada_por) {
      firma = '<span class="revfirma">resuelto por ' +
              esc(i.declarada_por.split('@')[0]) + (i.declarada_el ? ' · ' + _fechaHora(i.declarada_el) : '') +
              (hecho ? ' · aSa lo confirmó' : '') + '</span>';
    }
    // UNA FILA, UNA DECISIÓN, DOS SALIDAS (2-nov). Abierta: «Resuelto» cierra con un clic;
    // «No aplica» se enciende y abre AL LADO un campo corto —explicación y Enter; Esc lo
    // deja—. Decidida: un solo «Deshacer». Sin Aplica, sin Guardar, sin Cancelar: todo es
    // por barra y se guarda al instante; el modal no tiene un «guardar» general. El
    // usuario: «si presiono No aplica igual puedo presionar Resuelto, ¿entonces cómo
    // cierro?». Ahora: No aplica cierra con Enter; Resuelto cierra con Resuelto.
    var acc = hecho ? '<span class="muted">confirmada</span>'
      : (resuelto || nap)
        ? '<button class="audmini" data-deshacer="' + i.id + '" title="Vuelve a dejarla abierta">Deshacer</button>'
        : '<div class="revaccs">' +
            '<button class="audbres" data-resuelto="' + i.id + '" title="Márcala cuando ya hayas ' +
              'hecho el cambio en aSa. Al cerrar se comprueba contra aSa y, si algo sigue igual, ' +
              'te avisa.">Resuelto</button>' +
            '<button class="revnapbtn" data-noaplica="' + i.id +
              '" title="Dejar sin efecto, con una explicación firmada. Queda resuelta.">No aplica</button>' +
            '<input type="text" class="revnapin" data-nota="' + i.id + '" style="display:none"' +
              ' placeholder="¿por qué? … y Enter" title="Escribe la explicación y aprieta Enter. Esc para dejarlo.">' +
          '</div>';
    var angTd = '';
    for (var k = 0; k < c.nang; k++) {
      angTd += '<td class="revn reva">' + (angs[k] != null ? Math.abs(Math.round(angs[k])) + '°' : '') + '</td>';
    }
    var esp = det.esperado != null ? (i.regla === 'lado_corto' ? 'mín ' : '') + cm(det.esperado / 10) : '';
    return '<tr class="' + (hecho ? 'hecho' : nap ? 'nap' : '') + '" data-fila="' + i.id + '">' +
      '<td style="width:22px">' + (hecho ? '✓' :
        '<input type="checkbox" data-item="' + i.id + '"' + (REVS.sel_items[i.id] ? ' checked' : '') +
        ' title="Marcar para resolver varias de una vez">') + '</td>' +
      '<td class="revm"><span class="audref" data-ver="' + i.id +
        '" title="Ver la barra en grande">' + esc(i.ref) + '</span></td>' +
      '<td class="revfig" data-fig="' + esc(i.ref) + '" data-cc="' + esc(i.cc || '') +
        '" data-sen="' + i.id + '"></td>' +
      c.letras.map(function (L) {
        return '<td class="revn' + (malos[L] ? ' mal' : '') + '">' + (porL[L] != null ? cm(porL[L] / 10) : '') + '</td>';
      }).join('') + angTd +
      '<td class="revn revesp">' + esc(esp) + '</td>' +
      '<td><span class="revreg" title="' + esc(det.texto || r.porque || r.nombre || '') + '">' +
        esc(r.corto || r.nombre) + '</span></td>' +
      '<td><span class="revi ' + esc(i.estado) + '">' + esc(ESTADO_TXT[i.estado] || i.estado) + '</span></td>' +
      '<td class="revacc">' + firma + acc + '</td></tr>';
  }

  function _bindItems() {
    var caja = $('revItemsCuerpo');
    // Abrir un código, y volver a la lista. Las dos limpian lo marcado: era de otro código.
    _bindCerrar(caja);
    // Mientras se escribe la explicación, el botón del pie se entera: pasa de «faltan 3»
    // a «cerrar código» sin que haya que apretar nada antes.
    caja.querySelectorAll('input[data-nota]').forEach(function (c) {
      c.addEventListener('input', function () {
        var pies = {};
        if (c.dataset.espejo === '1') {
          caja.querySelectorAll('input[data-nota][data-espejo="1"]').forEach(function (o) {
            if (o !== c) o.value = c.value;
            var b = o.closest('.revcc2'); if (b) pies[b.dataset.grupocc] = 1;
          });
        }
        var cc = c.closest('.revcc2');
        if (cc) pies[cc.dataset.grupocc] = 1;
        Object.keys(pies).forEach(_repintarPie);
      });
    });
    caja.querySelectorAll('input[data-item]').forEach(function (c) {
      c.addEventListener('change', function () {
        if (c.checked) REVS.sel_items[c.dataset.item] = true; else delete REVS.sel_items[c.dataset.item];
        _pintarAcc();
      });
    });
    caja.querySelectorAll('input[data-grupo]').forEach(function (c) {
      c.addEventListener('change', function () {
        caja.querySelectorAll('input[data-item]').forEach(function (x) {
          var tr = x.closest('.revcc2');
          if (tr && tr.querySelector('input[data-grupo]') === c) {
            x.checked = c.checked;
            if (c.checked) REVS.sel_items[x.dataset.item] = true; else delete REVS.sel_items[x.dataset.item];
          }
        });
        _pintarAcc();
      });
    });
    caja.querySelectorAll('button[data-figs]').forEach(function (b) {
      b.addEventListener('click', async function () {
        b.disabled = true; b.textContent = 'Leyendo aSa…';
        await cargarFiguras(b.dataset.figs);
        b.remove();
        _pintarAcc();
      });
    });
    // La referencia abre el render: el detalle sigue estando, pero sin un botón que
    // compita con la decisión.
    caja.querySelectorAll('[data-ver]').forEach(function (b) {
      b.addEventListener('click', function () { abrirDetalleSenal(b.dataset.ver); });
    });
    // CON BARRAS MARCADAS, LA FILA NO DECIDE: lo hace el lote. Pero el botón no se queda
    // mudo —apagado y sin respuesta parecía que la pantalla estaba rota—: dice dónde está
    // ahora la acción. Se devuelve true cuando el clic era para el lote.
    // CON BARRAS MARCADAS, EL BOTÓN DE LA FILA ACTÚA SOBRE TODAS (3-nov). Antes se apagaba
    // y mandaba «a los botones de arriba»; el usuario marcó siete y apretó Deshacer en una
    // fila: «no me deja deshacerlas en forma masiva». El check selecciona, el botón ejecuta
    // sobre la selección. Se confirma antes, porque siete no es una.
    function _enLote(estado, boton) {
      var n = Object.keys(REVS.sel_items).length;
      if (!n) return false;
      // «No aplica» abre el campo EN LA FILA aunque haya marcas: al guardar, la misma
      // explicación vale para todas las marcadas (lo resuelve `guardarNoAplica`). Mandarlo
      // al campo de arriba lo dejaba fuera de la vista: «no me deja seleccionar aplica».
      if (estado === 'aceptada') return false;
      var verbo = estado === 'declarada' ? 'Marcar como resueltas' : 'Volver a dejar abiertas';
      if (!confirm(verbo + ' las ' + n + ' barra(s) marcada(s)?')) return true;
      loteMarcadas(estado, boton);
      return true;
    }
    // «Resuelto» por fila, y «Deshacer» para lo decidido.
    caja.querySelectorAll('button[data-resuelto]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (_enLote('declarada', b)) return;
        declararUno(b.dataset.resuelto, 'declarada', null, null, false, b);
      });
    });
    caja.querySelectorAll('button[data-deshacer]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (_enLote('abierta', b)) return;
        declararUno(b.dataset.deshacer, 'abierta', null, null, false, b);
      });
    });
    caja.querySelectorAll('button[data-noaplica]').forEach(function (b) {
      b.addEventListener('click', function () { if (!_enLote('aceptada', b)) abrirNoAplica(b.dataset.noaplica); });
    });
    // El campo del «no aplica»: Enter guarda esa barra, Esc lo deja como estaba.
    caja.querySelectorAll('input[data-nota]').forEach(function (c) {
      c.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') guardarNoAplica(c.dataset.nota);
        if (e.key === 'Escape') cerrarNoAplica(c.dataset.nota);
      });
    });
  }

  function _marcados() { return Object.keys(REVS.sel_items).map(Number); }

  // «NO APLICA» PIDE LA EXPLICACIÓN, EN LA PROPIA FILA. Hubo un desplegable con la causa
  // (figura / producción / cliente / otro); el usuario lo sacó el 29-oct: «basta el
  // comentario que deja el usuario». La columna queda para lo ya guardado.
  //
  // Antes esto eran dos `prompt()` del navegador, uno pidiendo un NÚMERO. Se hace acá
  // porque la decisión se toma mirando el dato que está en la fila de al lado.
  function _botones(id) {
    var f = document.querySelector('tr[data-fila="' + id + '"]');
    var q = function (sel) { return f ? f.querySelector(sel) : null; };
    return { re: q('button[data-resuelto]'), na: q('button[data-noaplica]'),
             des: q('button[data-deshacer]'), nota: q('input[data-nota]') };
  }

  // EL BOTÓN TIENE QUE DECIR QUE LO APRETASTE (19-oct): mientras se escribe la explicación,
  // «No aplica» queda encendido y el campo abierto al lado. Nada está decidido hasta Enter.
  // Con barras marcadas, el campo se abre EN CADA FILA MARCADA y lo que se escribe en una
  // se escribe en todas (3-nov): «así visualmente el usuario está viendo y entendiendo lo
  // que ocurre». Enter en cualquiera guarda las N; Esc en cualquiera cierra todas.
  function _idsNoAplica(id) {
    var ids = _marcados();
    if (ids.indexOf(Number(id)) === -1) ids.push(Number(id));
    return ids;
  }
  function abrirNoAplica(id) {
    var ids = _idsNoAplica(id), n = ids.length;
    ids.forEach(function (k) {
      var b = _botones(k);
      if (!b.nota) return;
      b.nota.placeholder = n > 1 ? '¿por qué no aplican las ' + n + ' marcadas? … y Enter' : '¿por qué? … y Enter';
      b.nota.dataset.espejo = n > 1 ? '1' : '';
      b.nota.style.display = '';
      if (b.na) b.na.classList.add('eligiendo');
    });
    var mio = _botones(id);
    if (mio.nota) mio.nota.focus();
  }
  function cerrarNoAplica(id) {
    _idsNoAplica(id).forEach(function (k) {
      var b = _botones(k);
      // Vuelve a como estaba: nada se decidió.
      if (b.nota) { b.nota.style.display = 'none'; b.nota.value = ''; b.nota.dataset.espejo = ''; }
      if (b.na) b.na.classList.remove('eligiendo');
    });
  }

  async function guardarNoAplica(id) {
    var b = _botones(id);
    if (!b.nota) return;
    var nota = (b.nota.value || '').trim();
    if (nota.length < 10) { aviso('Hace falta la explicación: la lee quien audita.'); b.nota.focus(); return; }
    // CON BARRAS MARCADAS, LA EXPLICACIÓN VALE PARA TODAS (3-nov): el check selecciona, la
    // fila ejecuta. La fila donde se escribió entra aunque no estuviera marcada.
    var ids = _marcados();
    if (ids.length) {
      if (ids.indexOf(Number(id)) === -1) ids.push(Number(id));
      if (ids.length > 1 && !confirm('¿Dejar sin efecto las ' + ids.length + ' barra(s) marcada(s) con esta explicación?')) return;
      if (b.na) { b.na.disabled = true; b.na.classList.add('audwait'); }
      try {
        var r = await req('PUT', '/chequeos/declarar', { ids: ids, estado: 'aceptada', nota: nota });
        ok((r.afectadas || ids.length) + ' barra(s) dejadas sin efecto');
        (((REVS.detalle || {}).items) || []).forEach(function (x) {
          if (ids.indexOf(Number(x.id)) !== -1) { x.estado = 'aceptada'; x.nota = nota; }
        });
        REVS.sel_items = {};
        if ($('revItemsModal') && $('revItemsModal').style.display !== 'none') pintarItems();
        await refrescarRevision();
      } catch (e) {
        aviso(e.message);
        if (b.na) { b.na.disabled = false; b.na.classList.remove('audwait'); }
      }
      return;
    }
    await declararUno(id, 'aceptada', null, nota, false, b.na);
  }

  // CERRAR EL CÓDIGO: guarda de una vez las explicaciones escritas y lleva a aSa lo que
  // está marcado resuelto. Es el final del flujo: se entra a un código, se decide barra
  // por barra y se cierra. No deja cerrar con algo sin decidir.
  async function cerrarCC(cc, boton) {
    var g = _grupoDe(cc);
    if (!g) return;
    var e = _estadoCC(g);
    if (e.faltan) {
      aviso('Faltan ' + e.faltan + ' barra(s) por decidir: cada una tiene que quedar como ' +
            'Resuelto, o como No aplica con su explicación.');
      _marcarPendientes(g);
      return;
    }
    var txt = boton ? boton.textContent : '';
    if (boton) { boton.disabled = true; boton.classList.add('audwait'); boton.textContent = 'Guardando…'; }
    try {
      // Las explicaciones iguales van juntas: en un código suelen ser la misma razón.
      var porNota = {};
      (g.items || []).forEach(function (i) {
        if (i.estado !== 'abierta') return;
        var n = _notaDe(i.id);
        if (n.length >= 10) (porNota[n] = porNota[n] || []).push(Number(i.id));
      });
      for (var nota in porNota) {
        if (!Object.prototype.hasOwnProperty.call(porNota, nota)) continue;
        await req('PUT', '/chequeos/declarar', { ids: porNota[nota], estado: 'aceptada', nota: nota });
        porNota[nota].forEach(function (id) {
          (((REVS.detalle || {}).items) || []).forEach(function (x) {
            if (Number(x.id) === id) { x.estado = 'aceptada'; x.nota = nota; }
          });
        });
      }
      // Lo marcado resuelto se comprueba en aSa; lo que no aplica no tiene nada que ir a ver.
      var decl = (g.items || []).filter(function (i) {
        return i.estado === 'declarada' || i.estado === 'corregir'; }).map(function (i) { return Number(i.id); });
      if (decl.length) {
        await cerrarResueltos(false, decl);
      } else {
        ok('Código cerrado');
        await refrescarRevision();
      }
    } catch (err) {
      aviso(err.message);
    }
    if (boton) { boton.disabled = false; boton.classList.remove('audwait'); boton.textContent = txt; }
  }

  function _grupoDe(cc) {
    var g = { cc: cc, items: itemsVisibles().filter(function (i) { return (i.cc || '') === cc; }) };
    return g.items.length ? g : null;
  }

  // Las que todavía no tienen decisión se señalan: con veinte barras, «faltan 3» sin decir
  // cuáles es mandar a buscar.
  function _marcarPendientes(g) {
    var primera = null;
    (g.items || []).forEach(function (i) {
      if (i.estado !== 'abierta' || _notaDe(i.id).length >= 10) return;
      var tr = document.querySelector('tr[data-fila="' + i.id + '"]');
      if (!tr) return;
      tr.classList.add('falta');
      setTimeout(function () { tr.classList.remove('falta'); }, 4000);
      if (!primera) primera = tr;
    });
    if (primera) primera.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Una barra, una decisión: así se resuelve en la fila. El lote quedó sólo para el check
  // de «ya la corregí», que es lo único que se hace de a muchas.
  async function declararUno(id, estado, motivo, nota, patron, boton) {
    // MIENTRAS EL SERVIDOR RESPONDE, SE VE. Son dos viajes (declarar y volver a leer la
    // revisión): sin esto el botón se queda mudo un segundo largo y se vuelve a apretar.
    var b = _botones(id);
    var tocados = [boton, b.re, b.na, b.des].filter(Boolean);
    tocados.forEach(function (x) { x.disabled = true; x.classList.add('audwait'); });
    try {
      var r = await req('PUT', '/chequeos/declarar',
                        { ids: [Number(id)], estado: estado, motivo_tipo: motivo || null,
                          nota: nota || null, patron: !!patron });
      ok(estado === 'aceptada'
         ? 'Hallazgo dejado sin efecto' + (r.afectadas > 1 ? ' (' + r.afectadas + ' iguales)' : '')
         : estado === 'declarada' ? 'Resuelto' : 'Vuelve a quedar por resolver');
      delete REVS.sel_items[id];
      // LO QUE YA SE SABE SE PINTA AL TIRO. El servidor confirmó; el refresco de abajo es
      // para los contadores y para las iguales que pudo arrastrar el patrón. Si ese
      // refresco no corre —el modal se abrió sin revisión elegida, la lista llegó de otra
      // pantalla—, la fila igual queda como quedó, que es lo que el usuario estaba
      // esperando ver.
      ((REVS.detalle || {}).items || []).forEach(function (i) {
        if (String(i.id) === String(id)) {
          i.estado = estado;
          if (estado === 'aceptada') { i.nota = nota || i.nota; i.motivo_tipo = motivo || i.motivo_tipo; }
        }
      });
      if ($('revItemsModal') && $('revItemsModal').style.display !== 'none') pintarItems();
      await refrescarRevision();
    } catch (e) {
      aviso(e.message);
      tocados.forEach(function (x) { x.classList.remove('audwait'); });
      // Se repinta en vez de rehabilitar a mano: el par Aplica|No aplica tiene un botón
      // apagado a propósito según el estado, y devolverlo «a mano» lo dejaba al revés.
      if ($('revItemsModal') && $('revItemsModal').style.display !== 'none') pintarItems();
    }
  }

  // DE A MUCHAS (20-oct): lo marcado con los checks recibe el mismo verbo de una vez —
  // «Resuelto» o «Aplica»—. «No aplica» de a muchas va por su propio formulario, porque
  // pide la explicación. «Muchas veces el hallazgo es el mismo para más de un ítem».
  async function loteMarcadas(estado, boton) {
    var ids = _marcados();
    if (!ids.length) return;
    var txt = boton ? boton.textContent : '';
    if (boton) { boton.disabled = true; boton.classList.add('audwait'); }
    try {
      var r = await req('PUT', '/chequeos/declarar', { ids: ids, estado: estado });
      ok((estado === 'declarada' ? 'Resueltas: ' : 'Vuelven a quedar por resolver: ') +
         (r.afectadas || ids.length));
      ((REVS.detalle || {}).items || []).forEach(function (i) {
        if (ids.indexOf(Number(i.id)) !== -1) i.estado = estado;
      });
      REVS.sel_items = {};
      if ($('revItemsModal') && $('revItemsModal').style.display !== 'none') pintarItems();
      await refrescarRevision();
    } catch (e) {
      aviso(e.message);
      if (boton) { boton.disabled = false; boton.classList.remove('audwait'); boton.textContent = txt; }
    }
  }

  // CERRAR LO RESUELTO VA A aSa (20-oct). Mismo flujo que la auditoría: el servidor le
  // pregunta a aSa en vivo por cada barra marcada resuelta; la que cumple queda confirmada,
  // y si alguna sigue como estaba contesta 409 con la lista. Acá se muestra y quien cierra
  // decide: volver a revisar, o cerrar igual —y entonces queda firmado que lo confirmó él—.
  // `soloIds` cierra un subconjunto —las barras de UN código— en vez de todo lo visible.
  // Se recuerda para el «cerrar igual» del aviso, que reintenta lo mismo confirmando.
  var _ultimoCierre = null;
  async function cerrarResueltos(confirmar, soloIds) {
    var b = $('revAccCerrar'), msg = $('revAccMsg');
    var ids = soloIds || (confirmar && _ultimoCierre) || itemsVisibles().filter(function (i) {
      return i.estado === 'declarada' || i.estado === 'corregir'; }).map(function (i) { return Number(i.id); });
    if (!ids.length) return;
    _ultimoCierre = ids;
    if (b) { b.disabled = true; b.classList.add('audwait'); b.textContent = confirmar ? 'Cerrando…' : 'Comprobando en aSa…'; }
    try {
      var r = await req('POST', '/chequeos/cerrar-resueltas', { ids: ids, confirmar: !!confirmar });
      // Lo dibujado de esos códigos ya no vale: se acaba de leer aSa y la barra pudo cambiar.
      _olvidarFiguras(ids);
      ok('Cerrado: aSa confirmó ' + (r.cumplen || []).length + ' de ' + ids.length +
         ((r.siguen_igual || []).length ? ' · ' + r.siguen_igual.length + ' cerradas bajo tu confirmación' : ''));
      if (msg) msg.textContent = '';
      await refrescarRevision();
    } catch (e) {
      var det = e.detalle || null;
      if (e.status === 409 && det && det.motivo === 'sigue_igual') {
        _avisoCierreRev(det);
      } else {
        aviso(e.message);
        if (msg) msg.textContent = e.message;
      }
      if (b) { b.disabled = false; b.classList.remove('audwait'); }
      _pintarAcc();
    }
  }

  function _avisoCierreRev(det) {
    var viejo = $('revCierreAviso');
    if (viejo) viejo.remove();
    var div = document.createElement('div');
    div.id = 'revCierreAviso';
    div.className = 'audnota audcierre';
    div.innerHTML = '<b>' + esc(det.mensaje) + '</b>' +
      (det.cumplen ? '<div class="muted" style="font-size:10.5px">aSa confirmó ' + det.cumplen + '.</div>' : '') +
      '<ul>' + (det.barras || []).map(function (x) {
        return '<li><b>' + esc(x.cc || '') + '</b> · <span class="audref">' + esc(x.ref) + '</span></li>';
      }).join('') + '</ul>' +
      ((det.sin_leer || []).length
        ? '<div class="muted" style="font-size:10.5px">' + det.sin_leer.length +
          ' código(s) no se pudieron leer en aSa: no cuentan como incumplidos.</div>' : '') +
      '<div class="audenviop">' +
        '<button class="audmini" id="revCierreNo">Volver a revisar</button>' +
        '<button class="audenviar" id="revCierreSi" title="Cierra igual. Queda registrado qué barras ' +
        'seguían como estaban en aSa y que lo confirmaste tú.">Cerrar igual</button>' +
      '</div>';
    var ccs = {};
    (det.barras || []).forEach(function (x) { if (x.cc) ccs[x.cc] = 1; });
    var unico = Object.keys(ccs).length === 1 ? Object.keys(ccs)[0] : null;
    var bloque = unico ? document.querySelector('.revcc2[data-grupocc="' + unico.replace(/"/g, '') + '"]') : null;
    if (bloque && bloque.querySelector('.revccpie')) {
      // Dentro del bloque del código, justo encima de su botón de cerrar: ahí se decidió.
      bloque.insertBefore(div, bloque.querySelector('.revccpie'));
    } else {
      var acc = $('revItemsAcc');
      acc.parentNode.insertBefore(div, acc.nextSibling);
    }
    div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('revCierreNo').addEventListener('click', function () { div.remove(); });
    $('revCierreSi').addEventListener('click', function () { div.remove(); cerrarResueltos(true); });
  }

  async function refrescarRevision() {
    if (!REVS.sel && !(REVS.detalle && REVS.detalle.revision.todas)) return;
    // Las figuras leídas NO se tiran acá: lo que cambia es el estado del hallazgo, no la
    // barra, y volver a leer treinta códigos en cada clic es justo lo que hay que evitar.
    // Se tiran al abrir otra revisión y cuando una verificación dice que aSa cambió.
    REVS.detalle = await req('GET', '/chequeos/revision/' + (REVS.sel || 0) + '?nivel=' + REVS.nivel);
    pintarResumen();
    if ($('revItemsModal').style.display !== 'none') pintarItems();
    await cargarRevisiones();
  }

  // Una revisión nueva, desde el botón de arriba: lo mismo que corre el reloj.
  async function nuevaRevision() {
    if (REV.corriendo) return;
    REV.corriendo = true; REV.parar = false;
    $('revNueva').disabled = true;
    $('revNuevaProg').style.display = '';
    $('revNuevaParar').style.display = '';
    try {
      // LA COLA ENTERA. El servidor recorta a 300 por defecto porque ese tope es para el
      // reloj, que corre dentro del proceso web con 15 minutos; acá el recorrido va en el
      // navegador, de a un código, y puede durar lo que haga falta. Con el tope por
      // defecto la tanda del usuario quedó partida en dos revisiones sin que él lo pidiera.
      var ini = await req('POST', '/chequeos/revision-pendientes', { tarde: REV.tarde, limite: 2000 });
      if (!(ini.ccs || []).length) {
        $('revNuevaTxt').textContent = 'No hay nada pendiente: todo lo abierto está revisado y nada cambió en aSa.';
      } else {
        await recorrer(ini.ccs, ini.revision,
                       { txt: $('revNuevaTxt'), barra: $('revNuevaBarra') }, ini.total);
      }
      REVS.sel = ini.revision || REVS.sel;
      await cargarRevisiones();
      if (ini.revision) await abrirRevision(ini.revision);
      await cargarReporte();
    } catch (e) { aviso(e.message); $('revNuevaTxt').textContent = e.message; }
    REV.corriendo = false;
    $('revNueva').disabled = false;
    $('revNuevaParar').style.display = 'none';
  }

  // ══════ EL DETALLE DE UNA SEÑAL ══════
  // La misma barra que ve el auditor, con el mismo motor (las piezas las expone
  // auditorias/index.js). Se pide el elemento a aSa en vivo y se busca la barra por su
  // referencia: así lo que se dibuja es lo que aSa tiene HOY, no la foto de la señal.
  var _senalesPorId = {};
  function _senal(id) {
    var s = _senalesPorId[String(id)];
    if (s) return s;
    var todas = ((REVS.detalle || {}).items || []).concat(REV.senales || [], REV.mios || []);
    todas.forEach(function (x) { _senalesPorId[String(x.id)] = x; });
    return _senalesPorId[String(id)];
  }

  async function abrirDetalleSenal(id) {
    var s = _senal(id);
    if (!s) { aviso('No encuentro esa señal en pantalla; recarga la bandeja.'); return; }
    var r = (REV.reglas || {})[s.regla] || { nombre: s.regla, porque: '' };
    var d = s.detalle || {};
    $('revSenalTit').textContent = (s.obra || s.job) + ' · ' + (s.cc || '') + ' · ' + s.ref;
    $('revSenalCuerpo').innerHTML = '<div class="revsend">' +
      '<div class="revsenfig" id="revSenalFig"><span class="muted">dibujando la barra…</span></div>' +
      '<div class="revsenq"><b>' + esc(r.nombre) + ':</b> ' + esc(d.texto || '') +
        (r.porque ? '<div class="muted" style="margin-top:3px; font-size:10.5px;">' + esc(r.porque) + '</div>' : '') + '</div>' +
      '<dl><dt>Obra</dt><dd>' + esc(s.obra || s.job) + '</dd>' +
          '<dt>Código · elemento</dt><dd>' + esc(s.cc || '') + (s.elemento ? ' · ' + esc(s.elemento) : '') + '</dd>' +
          '<dt>Barra</dt><dd><span class="audref">' + esc(s.ref) + '</span>' + (s.figura ? ' · figura ' + esc(s.figura) : '') +
          (s.diam ? ' · φ' + esc(String(s.diam)) : '') + '</dd></dl>' +
      '<dl><dt>Cubicó</dt><dd>' + esc(s.cubico || '—') + '</dd>' +
          '<dt>Estado</dt><dd>' + esc(ESTADO_TXT[s.estado] || s.estado) +
            (s.resuelto_por ? ' <span class="muted">· ' + esc(s.resuelto_por.split('@')[0]) + (s.resuelto_el ? ' ' + _fechaHora(s.resuelto_el) : '') + '</span>' : '') +
            (s.nota ? '<div class="muted">' + esc(s.nota) + '</div>' : '') + '</dd>' +
          '<dt>Vista</dt><dd>' + (s.veces || 1) + ' revisión(es) · primera ' + (s.visto_primero ? _fechaHora(s.visto_primero) : '—') + '</dd></dl>' +
      '<div class="revsenacc" id="revSenalAcc"></div></div>';
    // ESTE MODAL MIRA, NO DECIDE. Tenía los botones del flujo anterior («hay que
    // corregirla», «está bien») y era justo lo que el usuario sacó: la decisión se toma
    // en la fila, mirando el hallazgo junto a los demás del mismo código. Acá se viene a
    // ver la barra.
    $('revSenalAcc').innerHTML =
      '<span class="muted">Así está la barra hoy en aSa. La decisión se toma en la lista: ' +
      'marca el check si ya la corregiste, o «No aplica» con su explicación.</span>';
    $('revSenalModal').style.display = '';
    dibujarSenal(s);
  }

  function cerrarDetalleSenal() { $('revSenalModal').style.display = 'none'; }

  async function dibujarSenal(s) {
    var caja = $('revSenalFig');
    if (!caja) return;
    if (!global.audBarraNormalizada || !global.audCeldaFigura) {
      caja.innerHTML = '<span class="muted">El motor de dibujo no está cargado (abre primero el tab Auditorías).</span>';
      return;
    }
    try {
      var el = encodeURIComponent(s.elemento || '(sin elemento)');
      var d = await req('GET', '/auditorias/elemento-asa?cc=' + encodeURIComponent(s.cc || '') + '&element=' + el);
      var barras = d.barras || [];
      var b = barras.filter(function (x) { return x.ref === s.ref; })[0] ||
              barras.filter(function (x) { return (x.marca || '') === String(s.ref).split('#')[0]; })[0];
      if (!b) { caja.innerHTML = '<span class="muted">La barra ' + esc(s.ref) + ' ya no está en el código ' + esc(s.cc || '') + ' en aSa.</span>'; return; }
      var f = global.audBarraNormalizada(b, 'asa');
      var lados = Object.keys(f.dims || {}).sort().map(function (L) { return L + ' = ' + global.audNum(f.dims[L]); }).join(' · ');
      caja.innerHTML = '<div style="display:inline-block;">' + global.audCeldaFigura(f) + '</div>' +
        '<div class="muted" style="font-size:10.5px; margin-top:4px;">φ' + global.audNum(f.diam) + ' · ' + esc(lados) +
        (f.largo != null ? ' · largo ' + global.audNum(f.largo) + ' cm' : '') +
        (b.cant_total != null ? ' · ' + b.cant_total + ' u' : '') + '</div>';
    } catch (e) { caja.innerHTML = '<span class="muted">No se pudo dibujar: ' + esc(e.message) + '</span>'; }
  }

  // ══════ MIS CHEQUEOS ══════
  // La tarea del cubicador: lo que le marcaron para corregir, barra por barra, con la
  // comprobación a un clic. Antes el «hay que corregirla» era un aviso en la campana y
  // nada más: no había dónde verlo ni cómo cerrarlo.

  // ── El registro ───────────────────────────────────────────────────────────────────


  // ── El reporte por obra ───────────────────────────────────────────────────────────
  // UNA OBRA CON CERO SEÑALES Y CERO CÓDIGOS REVISADOS NO ESTÁ LIMPIA, ESTÁ SIN REVISAR.
  // Leerlas igual sería el peor error que puede cometer un reporte así, por eso la columna
  // «revisados» va antes que la de señales y el cero se dice con palabras.
  async function cargarReporte() {
    try {
      var d = await req('GET', '/chequeos/reporte?meses=' + REV.meses + '&tarde=' + REV.tarde);
      var t = d.total || {}, obras = d.obras || [];
      REV.reporte = obras;
      $('revRepTxt').textContent = t.obras + ' obra(s) · ' + t.revisados + ' de ' + t.ccs +
        ' código(s) revisados · ' + num(t.barras) + ' barras miradas · ' +
        t.abiertas + ' señal(es) esperando · ' + t.corregidas + ' ya corregida(s)';
      // CUÁNDO SON ESTOS DATOS. Todo lo de esta pantalla es a la última carga de aSa.
      var car = $('revRepCarga');
      if (car) car.textContent = d.ultima_carga ? 'datos de aSa al ' + _fechaHora(d.ultima_carga) : 'sin carga de aSa registrada';
      var reglas = Object.keys(d.reglas || {});
      $('revRep').innerHTML = '<table class="audt"><thead><tr><th>Obra</th><th>Cubicó</th>' +
        '<th class="num">Códigos</th><th class="num">Revisados</th>' +
        '<th class="num" title="Cuántas barras se MIRARON, no cuántas están malas.">Barras miradas</th>' +
        reglas.map(function (k) { return '<th class="num" title="Señales de la regla: ' +
          esc(d.reglas[k]) + '">' + esc(d.reglas[k]) + '</th>'; }).join('') +
        '<th class="num">Por corregir</th><th class="num">Corregidas</th></tr></thead><tbody>' +
        obras.map(function (o) {
          var falta = Math.max(0, o.ccs - o.revisados);
          // EL REPORTE DICE DÓNDE ESTÁ EL PROBLEMA, no lo resuelve: se resuelve en la
          // revisión que lo encontró, que es la que tiene el dueño y el ciclo.
          return '<tr>' +
            '<td class="audnom" title="' + esc(o.obra) + '">' + esc(o.obra) + '</td>' +
            '<td class="audnom" title="' + esc(o.cubico || '') + '">' +
              esc((o.quienes && o.quienes.length ? o.quienes : (o.cubico || '').split(', ')).map(nomCub)
                  .filter(Boolean).join(', ')) + '</td>' +
            '<td class="num">' + o.ccs + '</td>' +
            '<td class="num">' + (o.revisados
                ? o.revisados + (falta ? ' <span class="muted">(faltan ' + falta + ')</span>' : '')
                : '<span class="muted">sin revisar</span>') + '</td>' +
            '<td class="num">' + num(o.barras) + '</td>' +
            reglas.map(function (k) {
              var n = (o.por_regla || {})[k] || 0;
              return '<td class="num">' + (n || '<span class="muted">·</span>') + '</td>';
            }).join('') +
            '<td class="num">' + (o.corregir ? '<b style="color:#c62828">' + o.corregir + '</b>' : '<span class="muted">·</span>') + '</td>' +
            '<td class="num">' + (o.corregidas ? '<b style="color:#2e7d32">' + o.corregidas + '</b>' : '<span class="muted">·</span>') + '</td></tr>';
        }).join('') + '</tbody></table>';
    } catch (e) { $('revRep').innerHTML = '<div class="revvacio">' + esc(e.message) + '</div>'; }
  }

  function _fechaHora(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' +
           ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  var _listo = false;
  global.loadRevisionBarras = async function () {
    if (!$('audSubRevision')) return;
    if (!_listo) {
      _listo = true;
      $('revNueva').addEventListener('click', nuevaRevision);
      $('revNuevaParar').addEventListener('click', function () { REV.parar = true; });
      $('revItemsCerrar').addEventListener('click', cerrarItems);
      $('revItemsImprimir').addEventListener('click', function () { global.print(); });
      $('revItemsModal').addEventListener('click', function (e) { if (e.target === $('revItemsModal')) cerrarItems(); });
      $('revSenalCerrar').addEventListener('click', cerrarDetalleSenal);
      $('revSenalModal').addEventListener('click', function (e) { if (e.target === $('revSenalModal')) cerrarDetalleSenal(); });
      $('revRepImprimir').addEventListener('click', function () { global.print(); });
      // LOS PROCESSED, JUNTO AL BOTÓN QUE LOS VA A LEER. Un código Processed ya está
      // confirmado en planta, así que corregirlo suele llegar tarde; por eso no entra
      // salvo que se pida, y se pide acá y no en otra pantalla.
      $('revTarde').addEventListener('click', async function () {
        REV.tarde = !REV.tarde;
        this.classList.toggle('on', REV.tarde);
        await cargarReporte();
      });
    }
    await cargarReglas();
    await cargarReporte();
    // UN SOLO FORMULARIO PARA TODOS (28-oct). Acá se cargaba antes «Mis chequeos por
    // corregir», una lista plana del flujo viejo con un botón de comprobar por fila, que le salía
    // a quien tenía hallazgos propios —el cubicador externo con 80— encima del panel, y al
    // admin nunca. El usuario: «no tiene nada que ver con cómo lo veo yo». Lo de cada uno
    // se trabaja en el modal, que abre con su chip puesto (`_miChip`).
    await cargarRevisiones();
  };

  // Las dos líneas del tab. La revisión se carga la primera vez que se entra, no al abrir
  // Auditorías: son cientos de obras y nadie las pide hasta que mira este lado.
  // LAS TRES LÍNEAS DEL TAB (4-nov). Barras y elementos comparten el panel: es la misma
  // pantalla con otro nivel; lo que cambia es lo que se pide y la fila de la hoja.
  global.switchAudSub = function (sub) {
    var panel = { auditorias: 'audSubAuditorias', revision: 'audSubRevision', elementos: 'audSubRevision' };
    var bts = { auditorias: 'audSubBtnAud', revision: 'audSubBtnRev', elementos: 'audSubBtnEl' };
    Object.keys(bts).forEach(function (k) {
      var b = $(bts[k]);
      if (b) b.classList.toggle('on', k === sub);
    });
    ['audSubAuditorias', 'audSubRevision'].forEach(function (id) {
      var p = $(id);
      if (p) p.style.display = (panel[sub] === id) ? '' : 'none';
    });
    var textos = {
      auditorias: ['🔎 Auditorías de cubicación',
                   'Se revisa una muestra al azar de elementos constructivos; cada hallazgo le queda como acción a quien cubicó.'],
      revision: ['🔎 Revisión de barras',
                 'La máquina lee todas las barras de los códigos abiertos y marca lo que no calza. La señal sugiere; la decisión es de quien mira.'],
      elementos: ['🔎 Revisión de elementos',
                  'Cada código se compara con el mismo ciclo del piso anterior: muros que faltan, kilos que se disparan, códigos repetidos. La señal sugiere; la decisión es de quien mira.']
    };
    var t = $('audTitulo'), ba = $('audBajada');
    if (t) t.textContent = textos[sub][0];
    if (ba) ba.textContent = textos[sub][1];
    if (sub === 'revision' || sub === 'elementos') {
      var nivel = sub === 'elementos' ? 'elemento' : 'barra';
      if (nivel !== REVS.nivel) {
        // Cambiar de nivel es cambiar de datos: lo elegido en el otro no vale acá.
        REVS.nivel = nivel; REVS.sel = null; REVS.detalle = null; REVS.sel_items = {}; REVS.figs = {};
      }
      global.loadRevisionBarras();
    }
  };

  global.__revisionTest = { REV: REV, estadoTxt: ESTADO_TXT };

})(window);
