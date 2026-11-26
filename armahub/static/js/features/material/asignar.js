// MATERIAL DISPONIBLE › LA VENTANA DE LA BARRA (25-nov, SPECS §15.4-15.5) — fase 3.
//
// Se abre con «Asignar» en la lista. Arriba la barra y su saldo; después lo ya asignado, con el
// check de producción («Producido»: queda quién y cuándo) y «Quitar» mientras no se produzca;
// abajo «Buscar coincidencias», que le pregunta a aSa en el momento, y se reparten las barras
// entre los ítems que se quiera (el saldo que queda se asigna después). Al pie, Editar y Dar de
// baja. Sin saldo y con todo confirmado, la barra pasa al Resumen.
//
// Las piezas comunes (la hoja, el dibujo, los textos) vienen de index.js (MaterialComun).
(function (global) {
  'use strict';

  var AS = { id: null, barra: null, asignaciones: [], coin: null, buscando: false, buscadoEl: null, sel: {},
             editor: '' };

  function $(id) { return document.getElementById(id); }
  function C() { return global.MaterialComun; }
  function esc(s) { return C().esc(s); }
  function num(n) { return C().num(n); }
  function mostrar(id, si) { $(id).style.display = si ? '' : 'none'; }
  function error(m) { $('matAsigError').textContent = m || ''; }

  // ── QUÉ HAY QUE HACERLE A LA BARRA ─────────────────────────────────────────────
  function cmTxt(mm) { return global.HojaBarras.cm(Number(mm) / 10) + ' cm'; }

  function queHacer(c) {
    var cortes = c.cortes || [];
    if (c.piezas > 1) {
      var sobra = cortes[0] && cortes[0][1] > 0 ? ' · sobran ' + cmTxt(cortes[0][1]) : '';
      return c.piezas + ' por barra' + sobra;
    }
    if (!cortes.length) return 'Tal cual';
    return 'Cortar ' + cortes.map(function (x) { return x[0] + ' ' + cmTxt(x[1]); }).join(' y ');
  }

  function calce(c) {
    var tag = c.tipo === 'igual' ? '<span class="arm-tag arm-tag--success">Igual</span>'
                                 : '<span class="arm-tag arm-tag--warning">Con corte</span>';
    return tag + '<div class="mat-hacer">' + esc(queHacer(c)) + '</div>';
  }

  // El ítem en la hoja: su marca, sus lados y lo pedido; el dibujo es el de la barra disponible
  // (la misma forma), sin cotas: las medidas van en las columnas.
  function barraItem(it, cant, peso) {
    var b = AS.barra;
    return C().barraHoja({ marca: it.marca, diam_mm: b.diam_mm, figura: it.figura, dims: it.dims, eje: b.eje,
                           referencias: [], largo_mm: 0 }, cant, peso);
  }

  function destino(it) {
    return esc(it.cc) + ' · ' + esc(it.estado_asa || '') + '<div class="mat-linea">' + esc(it.obra || '') + '</div>';
  }

  // ── LA BARRA ──────────────────────────────────────────────────────────────────
  function pintarBarra() {
    var b = AS.barra;
    $('matAsigTit').textContent = 'Asignar ' + (b.marca || (b.figura ? 'figura ' + b.figura : 'recta')) + ' · φ' + num(b.diam_mm);
    $('matAsigBarra').innerHTML = C().tablaBarras([b], false);
    var pend = AS.asignaciones.filter(function (a) { return !a.producido_el; }).length;
    $('matAsigSaldo').innerHTML = '<b>' + num(b.cant_disponible) + '</b> de ' + num(b.cant_inicial) + ' disponibles' +
      (pend ? ' · <span class="arm-tag arm-tag--warning">' + pend + ' por confirmar</span>' : '') +
      (b.estado === 'consumida' ? ' · <span class="arm-tag arm-tag--success">Consumida: pasó al Resumen</span>' : '');
  }

  // ── LO ASIGNADO ──────────────────────────────────────────────────────────────
  // «Ana Pérez · 25-11 17:24»; sin nombre (un correo que no está en usuarios), sólo la hora.
  function quienCuando(nombre, iso) { return [nombre, C().fechaHora(iso)].filter(Boolean).join(' · '); }

  function celdaProducido(a) {
    var quien = a.producido_el ? quienCuando(a.producido_nombre, a.producido_el) : 'Por confirmar';
    return '<label class="mat-prod"><input type="checkbox" data-prod="' + a.id + '"' + (a.producido_el ? ' checked' : '') +
           '> Producido</label><div class="mat-linea">' + esc(quien) + '</div>';
  }

  function filaAsignada(a) {
    return {
      accion: a.producido_el ? '' : '<button type="button" class="arm-button" data-quitar="' + a.id + '">Quitar</button>',
      barra: barraItem(a, a.cant_piezas, a.kg),
      elemento: a.ubicacion || '',
      propias: [num(a.cant_barras), celdaProducido(a)],
      texto: destino(a) + '<div class="mat-linea">Asignó ' + esc(quienCuando(a.asignado_nombre, a.asignado_el)) + '</div>'
    };
  }

  function pintarAsignadas() {
    var hay = AS.asignaciones.length > 0;
    mostrar('matAsigAsignadas', hay);
    if (!hay) return;
    $('matAsigLista').innerHTML = '<div class="mat-sin-cotas">' + global.HojaBarras.tabla({
      accion: { titulo: '', ancho: 76 },
      propias: [{ titulo: 'Barras', ancho: 60, clase: 'num', title: 'Barras disponibles que se usan' },
                { titulo: 'Producción', ancho: 150 }],
      texto: { titulo: 'Para' }, titulos: { cant: 'Piezas del ítem' },
      filas: AS.asignaciones.map(filaAsignada) }) + '</div>';
  }

  // ── LAS COINCIDENCIAS ─────────────────────────────────────────────────────────
  function coinPorClave(k) {
    return (AS.coin || []).filter(function (c) { return String(c.item_key) === String(k); })[0];
  }

  function usado(excepto) {
    return Object.keys(AS.sel).reduce(function (s, k) { return k === String(excepto) ? s : s + AS.sel[k]; }, 0);
  }

  function celdaBarras(c) {
    if (!c.tope_barras) return '<span class="mat-linea">' + (c.falta > 0 ? 'Sin saldo' : 'Cubierto') + '</span>';
    var n = AS.sel[c.item_key];
    return '<input class="arm-input mat-cant" type="number" min="1" max="' + c.tope_barras + '" data-cant="' + c.item_key +
           '" value="' + (n || '') + '" placeholder="' + c.tope_barras + '">';
  }

  function filaCoin(c) {
    var marcado = AS.sel[c.item_key] != null;
    var ya = c.ya_asignado > 0 ? '<div class="mat-linea">Ya asignadas ' + num(c.ya_asignado) + ' · faltan ' + num(c.falta) + '</div>' : '';
    return {
      attrs: marcado ? ' class="bueno"' : '',
      check: c.tope_barras ? '<input type="checkbox" data-sel="' + c.item_key + '"' + (marcado ? ' checked' : '') + '>' : '',
      barra: barraItem(c, c.cant_item, c.kg_item),
      elemento: c.ubicacion || '',
      propias: [calce(c), celdaBarras(c)],
      texto: destino(c) + ya
    };
  }

  function textoCoin() {
    if (AS.buscando) return 'Buscando en aSa… puede tardar hasta un minuto.';
    if (!AS.coin) return '';
    return 'Buscado ' + C().fechaHora(AS.buscadoEl) + ' · ' + AS.coin.length + ' ítems';
  }

  function pintarCoin() {
    var conSaldo = AS.barra.cant_disponible > 0;
    mostrar('matAsigCoinCaja', conSaldo);
    if (!conSaldo) return;
    $('matAsigCarga').textContent = textoCoin();
    var bt = $('matAsigBuscar');
    bt.disabled = AS.buscando;
    bt.textContent = AS.coin ? 'Buscar de nuevo' : 'Buscar coincidencias';
    bt.className = 'arm-button mat-derecha' + (AS.coin ? '' : ' arm-button--primary');
    if (!AS.coin) { $('matAsigCoin').innerHTML = ''; return; }
    if (!AS.coin.length) {
      $('matAsigCoin').innerHTML = '<div class="mat-vacio">Nada por fabricar en aSa calza con esta barra.</div>';
      return;
    }
    $('matAsigCoin').innerHTML = '<div class="mat-sin-cotas">' + global.HojaBarras.tabla({
      check: { titulo: '' }, accion: null,
      propias: [{ titulo: 'Calce', ancho: 130 },
                { titulo: 'Barras', ancho: 84, title: 'Cuántas barras disponibles van a ese ítem' }],
      texto: { titulo: 'Para' }, titulos: { cant: 'Piezas que pide el ítem' },
      filas: AS.coin.map(filaCoin) }) + '</div>';
  }

  // Lo que impide asignar lo elegido, o '' si se puede.
  function problema() {
    var claves = Object.keys(AS.sel);
    for (var i = 0; i < claves.length; i++) {
      var c = coinPorClave(claves[i]);
      if (c && AS.sel[claves[i]] > c.tope_barras) return 'A ' + c.marca + ' le alcanzan ' + c.tope_barras + ' barras.';
    }
    var pasa = usado() - AS.barra.cant_disponible;
    return pasa > 0 ? 'Pasas el saldo por ' + pasa + ' barras.' : '';
  }

  function pintarPie() {
    var n = usado(), p = problema(), bt = $('matAsigAsignar');
    error(p);
    mostrar('matAsigAsignar', !!AS.coin && AS.barra.cant_disponible > 0);
    bt.disabled = !n || !!p;
    bt.textContent = n ? 'Asignar ' + num(n) + ' barras' : 'Asignar';
    $('matAsigQuedan').textContent = n ? 'Quedan ' + num(Math.max(AS.barra.cant_disponible - n, 0)) : '';
  }

  function pintarTodo() {
    if (!AS.barra) return;
    pintarBarra();
    pintarAsignadas();
    pintarCoin();
    pintarPie();
    pintarEditor();
  }

  // Al marcar, se propone lo que alcanza: lo que le falta al ítem, sin pasar el saldo que queda.
  function marcar(k, si) {
    if (!si) { delete AS.sel[k]; pintarTodo(); return; }
    var c = coinPorClave(k), n = Math.min(c.tope_barras, AS.barra.cant_disponible - usado(k));
    if (n > 0) AS.sel[k] = n;
    pintarTodo();
    if (n <= 0) error('No queda saldo para otro ítem.');
  }

  function cambiaCantidad(inp) {
    var k = inp.dataset.cant, n = Math.floor(Number(inp.value));
    if (n > 0) AS.sel[k] = n;
    else delete AS.sel[k];
    var chk = $('matAsigCoin').querySelector('[data-sel="' + k + '"]');
    if (chk) chk.checked = n > 0;
    pintarPie();
  }

  // Después de asignar o quitar, lo que le falta a cada ítem y el tope se rehacen acá, sin
  // volver a preguntarle a aSa.
  function ajustarCoin(itemKey, piezas) {
    var c = coinPorClave(itemKey);
    if (!c) return;
    c.ya_asignado += piezas;
    c.falta = Math.max(c.cant_item - c.ya_asignado, 0);
  }

  function topes() {
    (AS.coin || []).forEach(function (c) {
      c.tope_barras = c.falta > 0 ? Math.min(AS.barra.cant_disponible, Math.ceil(c.falta / (c.piezas || 1))) : 0;
    });
  }

  // ── LO QUE SE LE PIDE AL SERVIDOR ─────────────────────────────────────────────
  function ponerDetalle(d) {
    AS.barra = d.barra;
    AS.asignaciones = d.asignaciones || [];
    topes();
    pintarTodo();
  }

  async function cargarDetalle() {
    var d = await global.apiGet('/material/barras/' + AS.id);
    if (!d) { error('No se pudo cargar la barra.'); return; }
    ponerDetalle(d);
  }

  async function buscar() {
    AS.buscando = true;
    AS.sel = {};
    pintarTodo();
    var r = await global.apiPostJson('/material/barras/' + AS.id + '/coincidencias', {});
    AS.buscando = false;
    if (!r || r.detail) { pintarTodo(); error(C().errorDe(r, 'aSa no respondió. Prueba de nuevo.')); return; }
    AS.coin = r.coincidencias || [];
    AS.buscadoEl = r.buscado_el;
    pintarTodo();
  }

  function cuerpoAsignar() {
    return { items: Object.keys(AS.sel).map(function (k) {
      var c = coinPorClave(k);
      return { item_key: Number(k), cantidad: AS.sel[k], marca: c.marca, cc: c.cc };
    }) };
  }

  async function asignar() {
    var cuerpo = cuerpoAsignar(), bt = $('matAsigAsignar');
    bt.disabled = true;
    var r = await global.apiPostJson('/material/barras/' + AS.id + '/asignar', cuerpo);
    if (!r || r.detail) { bt.disabled = false; error(C().errorDe(r, 'No se pudo asignar.')); return; }
    cuerpo.items.forEach(function (p) {
      var c = coinPorClave(p.item_key);
      ajustarCoin(p.item_key, Math.min(p.cantidad * (c.piezas || 1), c.falta));
    });
    AS.sel = {};
    ponerDetalle(r);
    C().ok('Asignado');
    C().recargar();
  }

  async function quitar(id) {
    var a = AS.asignaciones.filter(function (x) { return String(x.id) === String(id); })[0];
    var r = await global.apiPostJson('/material/asignaciones/' + id + '/quitar', {});
    if (!r || r.detail) { error(C().errorDe(r, 'No se pudo quitar.')); return; }
    if (a) ajustarCoin(a.item_key, -a.cant_piezas);
    ponerDetalle(r);
    C().recargar();
  }

  async function producida(chk) {
    var r = await global.apiPostJson('/material/asignaciones/' + chk.dataset.prod + '/producida', { producida: chk.checked });
    if (!r || r.detail) { chk.checked = !chk.checked; error(C().errorDe(r, 'No se pudo guardar.')); return; }
    ponerDetalle(r);
    if (r.barra.estado === 'consumida') C().ok('Barra consumida: pasó al Resumen');
    C().recargar();
  }

  // ── EDITAR Y DAR DE BAJA ──────────────────────────────────────────────────────
  function editorHtml(b, modo) {
    if (modo === 'baja') {
      return '<label class="mat-campo">Por qué se da de baja<input class="arm-input" data-campo="motivo" style="width:320px"></label>' +
             '<button type="button" class="arm-button arm-button--danger" data-confirmar="baja">Dar de baja</button>' +
             '<button type="button" class="arm-button" data-confirmar="no">Cancelar</button>';
    }
    return '<label class="mat-campo">Disponibles<input class="arm-input" type="number" min="0" data-campo="cantidad" value="' +
             b.cant_disponible + '" style="width:110px"></label>' +
           '<label class="mat-campo">Ubicación<input class="arm-input" data-campo="ubicacion" value="' + esc(b.ubicacion || '') + '" style="width:260px"></label>' +
           '<label class="mat-campo">Nota<input class="arm-input" data-campo="nota" value="' + esc(b.nota || '') + '" style="width:260px"></label>' +
           '<button type="button" class="arm-button arm-button--primary" data-confirmar="editar">Guardar</button>' +
           '<button type="button" class="arm-button" data-confirmar="no">Cancelar</button>';
  }

  function pintarEditor() {
    mostrar('matAsigEditor', !!AS.editor);
    $('matAsigEditor').innerHTML = AS.editor ? editorHtml(AS.barra, AS.editor) : '';
  }

  function valor(campo) {
    var i = $('matAsigEditor').querySelector('[data-campo="' + campo + '"]');
    return i ? i.value : null;
  }

  async function confirmar(accion) {
    if (accion === 'no') { AS.editor = ''; pintarEditor(); return; }
    var r = accion === 'baja'
      ? await global.apiPostJson('/material/barras/' + AS.id + '/descartar', { motivo: valor('motivo') || '' })
      : await global.apiPostJson('/material/barras/' + AS.id + '/ajustar',
                                 { cantidad: Number(valor('cantidad')), ubicacion: valor('ubicacion'), nota: valor('nota') });
    if (!r || r.detail) { error(C().errorDe(r, 'No se pudo guardar.')); return; }
    AS.editor = '';
    C().recargar();
    if (accion === 'baja') { C().ok('Barra dada de baja'); cerrar(); return; }
    C().ok('Cambios guardados');
    await cargarDetalle();
  }

  // ── ABRIR, CERRAR Y EVENTOS ───────────────────────────────────────────────────
  function abrir(id) {
    AS.id = id;
    AS.barra = null;
    AS.asignaciones = [];
    AS.coin = null;
    AS.sel = {};
    AS.editor = '';
    AS.buscando = false;
    error('');
    $('matAsigTit').textContent = 'Asignar';
    ['matAsigBarra', 'matAsigLista', 'matAsigCoin', 'matAsigSaldo', 'matAsigCarga', 'matAsigQuedan'].forEach(function (k) {
      $(k).innerHTML = '';
    });
    mostrar('matAsig', true);
    enganchar();
    cargarDetalle();
  }

  function cerrar() { mostrar('matAsig', false); }

  function clic(e) {
    var el = e.target.closest('[data-quitar],[data-confirmar],[data-asig]');
    if (!el || el.disabled) return;
    if (el.dataset.quitar) { quitar(el.dataset.quitar); return; }
    if (el.dataset.confirmar) { confirmar(el.dataset.confirmar); return; }
    var accion = el.dataset.asig;
    if (accion === 'cerrar') cerrar();
    else if (accion === 'buscar') buscar();
    else if (accion === 'asignar') asignar();
    else { AS.editor = AS.editor === accion ? '' : accion; pintarEditor(); }
  }

  function cambio(e) {
    var t = e.target;
    if (t.matches('[data-prod]')) producida(t);
    else if (t.matches('[data-sel]')) marcar(t.dataset.sel, t.checked);
  }

  var _enganchado = false;
  function enganchar() {
    if (_enganchado) return;
    _enganchado = true;
    var m = $('matAsig');
    C().fondoCierra(m, cerrar);   // el fondo cierra sólo si el clic empezó ahí
    m.addEventListener('click', clic);
    m.addEventListener('change', cambio);
    m.addEventListener('input', function (e) { if (e.target.matches('[data-cant]')) cambiaCantidad(e.target); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && m.style.display !== 'none') cerrar(); });
  }

  global.MaterialAsignar = { abrir: abrir };
  global.__materialAsignarTest = { AS: AS, queHacer: queHacer, filaCoin: filaCoin, filaAsignada: filaAsignada,
                                   problema: problema, usado: usado, marcar: marcar, ajustarCoin: ajustarCoin,
                                   topes: topes, cuerpoAsignar: cuerpoAsignar, editorHtml: editorHtml,
                                   textoCoin: textoCoin };
})(window);
