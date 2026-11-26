// MATERIAL DISPONIBLE (25-nov, SPECS §15) — la caluga para reciclar barras: la lista de lo
// disponible (con «Asignar», que abre la ventana de la barra: asignar.js), «Ingresar ítem»
// (desde aSa o medido a mano) y el Resumen de lo reutilizado.
//
// LA MISMA BARRA EN TODOS LADOS. La tabla es la hoja estándar de barras (hoja_barras.js) y el
// dibujo es el de Auditorías (audBarraNormalizada + audCeldaFigura): una barra disponible se ve
// igual que en la auditoría. El servidor manda los lados en mm; la hoja los muestra en cm.
//
// A MANO, LA FIGURA SE ELIGE VIÉNDOLA. Son las figuras que de verdad se usan en aSa, en tarjetas
// con su dibujo y un filtro por cantidad de lados: quien hace inventario no se sabe el catálogo.
(function (global) {
  'use strict';

  var MAT = { barras: [], motivos: {}, grados: {}, diametros: [], diam: '' };
  var ING = { tipo: 'asa', paso: 'obra', obras: null, cbObra: null, obra: null, ccs: [], ccFiltro: '', ccEstado: '',
              cc: '', items: [], sel: {}, filtroItem: '', figuras: null, nLados: '', figBuscar: '', fig: null,
              previa: null, espera: null, motivo: '', diam: 12, grado: 'A630-420H', ubicacion: '' };
  var N_LADOS = [['', 'Todas'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7+']];
  // Los colores de estado del manual, uno por motivo, siempre el mismo.
  var TAG_MOTIVO = { mal_fabricada: 'warning', error_cubicacion: 'danger', sobrante: 'success', inventario: 'review',
                     devolucion: 'info' };
  var MOTIVOS_ASA = ['mal_fabricada', 'error_cubicacion', 'sobrante'];
  var _listo = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function aviso(m) { if (global.showToast) global.showToast(m, 'error'); }
  function ok(m) { if (global.showToast) global.showToast(m, 'success'); }
  function errorDe(r, porDefecto) { return (r && r.detail) || porDefecto; }

  // Los botones segmentados del manual: uno encendido a la vez.
  function seg(id, opciones, actual, alElegir) {
    var caja = $(id);
    caja.innerHTML = opciones.map(function (o) {
      return '<button type="button" class="arm-button' + (String(o[0]) === String(actual) ? ' is-on' : '') +
             '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('');
    caja.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { alElegir(b.dataset.v); });
    });
  }

  // ── EL DIBUJO Y LA HOJA ───────────────────────────────────────────────────────
  function dibujo(b) {
    if (!global.audCeldaFigura || !global.audBarraNormalizada) return '';
    return global.audCeldaFigura(global.audBarraNormalizada(
      { figura: b.figura, diam: b.diam, dims: b.dims || {}, eje: b.eje, angulos: b.angulos || [], largo: b.largo },
      'asa'), true);
  }

  // Los lados en cm, más lo que aSa muestra además de los lados (la altura o el radio de un arco).
  function ladosCm(b) {
    var out = {};
    Object.keys(b.dims || {}).forEach(function (L) { out[L] = Number(b.dims[L]) / 10; });
    (b.referencias || []).forEach(function (r) { out[r[0]] = Number(r[1]) / 10; });
    return out;
  }

  // SIN LOS ÁNGULOS EN COLUMNAS: el dibujo ya dice la forma, y sus cinco columnas empujaban
  // fuera de la vista el motivo, el origen y la ubicación (revisado 25-nov). La barra a mano
  // no tiene marca: la figura ya va en su columna.
  function barraHoja(b, cant, peso) {
    return { marca: b.marca || '', notas: b.notas || '',
             diam: parseFloat(b.diam_mm || b.diam) || null, figura: b.figura || 'Recta',
             render: dibujo({ figura: b.figura, diam: b.diam_mm || b.diam, dims: b.dims, eje: b.eje,
                              angulos: b.angulos, largo: b.largo_mm || b.largo }),
             lados: ladosCm(b), angulos: [], largo: (Number(b.largo_mm || b.largo) || 0) / 10,
             cant: cant, peso: peso };
  }

  // ── LA LISTA ──────────────────────────────────────────────────────────────────
  // UN SOLO FILTRO, EL φ (usuario, 25-nov): la lista ya muestra la obra y la marca, y los
  // «Todas/Todos» confundían. Sólo están las disponibles: las consumidas van al Resumen.
  function pasa(b) { return !MAT.diam || String(b.diam_mm) === MAT.diam; }

  function resumen(barras) {
    var r = { barras: 0, kg: 0, pendientes: 0 };
    barras.forEach(function (b) {
      r.barras += b.cant_disponible;
      r.kg += b.kg_disponible || 0;
      r.pendientes += b.n_por_confirmar || 0;
    });
    return r;
  }

  function pintarKpis() {
    var r = resumen(MAT.barras);
    $('matKpiBarras').textContent = num(r.barras);
    $('matKpiKg').textContent = num(r.kg) + ' kg';
    $('matKpiPend').textContent = num(r.pendientes);
  }

  function origen(b) {
    if (b.origen !== 'asa') return '<span class="mat-linea">A mano</span>';
    return esc(b.cc) + '<div class="mat-linea">' + esc(b.obra || '') + '</div>';
  }

  function accionesDe(b) {
    return '<button type="button" class="arm-button" data-asignar="' + b.id + '">Asignar</button>';
  }

  // Lo asignado de la barra: lo que falta que producción confirme, en ámbar.
  function asignacionDe(b) {
    if (b.n_por_confirmar) return '<span class="arm-tag arm-tag--warning">' + b.n_por_confirmar + ' por confirmar</span>';
    return b.n_asignadas ? '<span class="mat-linea">' + b.n_asignadas + ' confirmadas</span>' : '';
  }

  function textoDe(b) {
    var partes = [b.descr_cc, b.cliente, b.nota, b.descarte_motivo ? 'Descartada: ' + b.descarte_motivo : ''];
    var quien = b.creado_nombre || b.creado_por || '';
    return esc(partes.filter(Boolean).join(' · ')) +
           '<div class="mat-linea">' + esc(quien) + ' · ' + esc((b.creado_el || '').slice(0, 10)) + '</div>';
  }

  function tagMotivo(motivo, texto) {
    return '<span class="arm-tag arm-tag--' + (TAG_MOTIVO[motivo] || 'info') + '">' + esc(texto) + '</span>';
  }

  // En la lista, TODA LA FILA abre la ventana de la barra, además del botón (usuario, 25-nov:
  // «no veo cómo abrir la fila»).
  function filaHoja(b, conAccion) {
    var clases = [conAccion ? 'mat-clic' : '', b.cant_disponible ? '' : 'mat-apagada'].filter(Boolean).join(' ');
    return {
      attrs: ' data-id="' + b.id + '"' + (conAccion ? ' data-asignar="' + b.id + '" title="Abrir para asignar"' : '') +
             (clases ? ' class="' + clases + '"' : ''),
      accion: conAccion ? accionesDe(b) : '',
      barra: barraHoja(b, b.cant_disponible, b.kg_disponible),
      elemento: b.elemento || '',
      propias: [tagMotivo(b.motivo, b.motivo_txt), origen(b), esc(b.ubicacion || ''), asignacionDe(b)],
      texto: textoDe(b)
    };
  }

  // La hoja de barras disponibles: la de la lista (con «Asignar») y la de la ventana (sin).
  function tablaBarras(lista, conAccion) {
    return global.HojaBarras.tabla({
      accion: conAccion ? { titulo: '', ancho: 86 } : null,
      propias: [{ titulo: 'Motivo', ancho: 104 }, { titulo: 'Origen', ancho: 170 }, { titulo: 'Ubicación', ancho: 150 },
                { titulo: 'Asignación', ancho: 120 }],
      texto: { titulo: 'Detalle' },
      filas: lista.map(function (b) { return filaHoja(b, conAccion); })
    });
  }

  function pintarFiltros() {
    var hay = {};
    MAT.barras.forEach(function (b) { hay[String(b.diam_mm)] = 1; });
    var diams = Object.keys(hay).sort(function (a, b) { return a - b; }).map(function (d) { return [d, 'φ' + d]; });
    seg('matDiam', [['', 'Todos los φ']].concat(diams), MAT.diam, function (v) { MAT.diam = v; pintarLista(); });
  }

  function pintarLista() {
    pintarFiltros();
    pintarKpis();
    var lista = MAT.barras.filter(pasa);
    if (!lista.length) {
      $('matLista').innerHTML = '<div class="mat-vacio">' +
        (MAT.barras.length ? 'Nada con ese φ.' : 'Todavía no hay ítems disponibles.') + '</div>';
      return;
    }
    $('matLista').innerHTML = tablaBarras(lista, true);
  }

  // ── INGRESAR ÍTEM (25-nov) ────────────────────────────────────────────────────
  // Desde aSa, por pasos: OBRA (campo desplegable con búsqueda) › CC (los de esa obra, del
  // espejo de aSa) › ÍTEMS (varios a la vez, cada uno con su cantidad: una devolución suele
  // traer varios del mismo CC) › DATOS (motivo, ubicación, nota). El atajo «Tengo el CC» salta
  // a los ítems. «Crear ítem» es la barra medida en inventario, con «Guardar y crear otro».
  var PASOS = [['obra', 'Obra'], ['cc', 'CC'], ['items', 'Ítems'], ['datos', 'Datos']];
  var ESTADOS_CC = [['', 'Todos'], ['Open', 'Open'], ['Processed', 'Processed'], ['Shipped', 'Shipped']];

  function mostrar(id, si) { $(id).style.display = si ? '' : 'none'; }

  function abrirIngreso(tipo) {
    $('matError').textContent = '';
    mostrar('matModal', true);
    elegirTipo(tipo || ING.tipo);
  }

  // DESDE LA TARJETA DE ARRIBA (25-nov): la obra abre sus CC, el código abre sus ítems.
  function ingresarObra(it) {
    if (!it) return;
    setTimeout(function () { ING.cbIngObra.limpiar(); }, 0);
    abrirIngreso('asa');
    elegirObra(it);
  }

  function ingresarCc() {
    var cc = $('matIngCc').value.trim();
    if (!cc) return;
    $('matIngCc').value = '';
    abrirIngreso('asa');
    cargarItems(cc);
  }

  function cerrarIngreso() { mostrar('matModal', false); }

  function elegirTipo(t) {
    ING.tipo = t;
    ING.fig = null;
    seg('matTipo', [['asa', 'Desde aSa'], ['mano', 'Crear ítem']], t, elegirTipo);
    irA(t === 'asa' ? (ING.items.length ? 'items' : 'obra') : 'figura');
    if (t === 'asa') cargarObras();
    if (t === 'mano') cargarFiguras();
  }

  function irA(paso) {
    ING.paso = paso;
    $('matError').textContent = '';
    var asa = ING.tipo === 'asa';
    mostrar('matPasoAsa', asa && (paso === 'obra' || paso === 'cc' || paso === 'items'));
    mostrar('matAsaObra', paso === 'obra');
    mostrar('matAsaCc', paso === 'cc');
    mostrar('matAsaItems', paso === 'items');
    mostrar('matPasoMano', paso === 'figura');
    mostrar('matDatos', paso === 'datos');
    mostrar('matListo', paso === 'listo');
    mostrar('matGuardarOtro', !asa);
    mostrar('matPasos', asa && paso !== 'listo');
    pintarPasos();
  }

  // La línea de avance: lo hecho se puede volver a abrir con un clic.
  function pintarPasos() {
    var hasta = PASOS.map(function (p) { return p[0]; }).indexOf(ING.paso);
    $('matPasos').innerHTML = PASOS.map(function (p, i) {
      var clase = i === hasta ? ' is-on' : (i < hasta ? ' hecho' : '');
      return '<button type="button" class="mat-paso' + clase + '" data-paso="' + p[0] + '"' +
             (i < hasta ? '' : ' disabled') + '>' + esc(p[1]) + '</button>';
    }).join('<span class="mat-linea">›</span>');
  }

  function volver() {
    if (ING.tipo === 'mano') { ING.fig = null; irA('figura'); return; }
    irA('items');
  }

  // Paso 1: la obra, con el campo desplegable estándar (combobox.js). Las obras se piden una
  // vez y sirven a los dos campos: el de la tarjeta de arriba y el del paso Obra.
  function comboObras(inputId, alElegir) {
    return global.Combobox.crear($(inputId), {
      placeholder: 'Buscar obra',
      items: function () { return (ING.obras || []).map(function (o) { return { id: o.id, label: o.nombre, sub: o.cliente }; }); },
      onSelect: alElegir
    });
  }

  async function cargarObras() {
    if (!ING.obras) {
      var d = await global.apiGet('/material/obras');
      ING.obras = (d && d.obras) || [];
    }
    if (!global.Combobox) return;
    if (!ING.cbObra) ING.cbObra = comboObras('matObra', function (it) { if (it) elegirObra(it); });
    if (!ING.cbIngObra) ING.cbIngObra = comboObras('matIngObra', ingresarObra);
  }

  async function elegirObra(it) {
    ING.obra = it;
    ING.ccFiltro = '';
    $('matCcFiltro').value = '';
    $('matCcs').innerHTML = '<div class="mat-vacio">Cargando los códigos de ' + esc(it.label) + '…</div>';
    irA('cc');
    var d = await global.apiGet('/material/obras/' + encodeURIComponent(it.id) + '/ccs');
    ING.ccs = (d && d.ccs) || [];
    pintarCcs();
  }

  // Paso 2: los códigos de la obra.
  function ccPasa(c) {
    if (ING.ccEstado && c.estado !== ING.ccEstado) return false;
    return !ING.ccFiltro || (c.cc + ' ' + (c.descr || '')).toLowerCase().indexOf(ING.ccFiltro) >= 0;
  }

  function filaCc(c) {
    return '<tr data-cc="' + esc(c.cc) + '" class="mat-clic"><td><b>' + esc(c.cc) + '</b></td><td>' + esc(c.descr || '') +
           '</td><td>' + esc(c.estado || '') + '</td><td class="num">' + num(c.kg) + '</td><td>' +
           esc((c.fecha || '').slice(0, 10)) + '</td><td>' + esc(nombreCub(c.cubicador)) + '</td></tr>';
  }

  function nombreCub(login) { return global.nomCub ? global.nomCub(login) : (login || ''); }

  function pintarCcs() {
    seg('matCcEstado', ESTADOS_CC, ING.ccEstado, function (v) { ING.ccEstado = v; pintarCcs(); });
    var lista = ING.ccs.filter(ccPasa);
    $('matCcs').innerHTML = lista.length
      ? '<table class="arm-table mat-ccs"><thead><tr><th>CC</th><th>Descripción</th><th>Estado</th><th class="num">Kg</th>' +
        '<th>Fecha</th><th>Cubicador</th></tr></thead><tbody>' + lista.map(filaCc).join('') + '</tbody></table>'
      : '<div class="mat-vacio">' + (ING.ccs.length ? 'Ningún código calza.' : 'Esa obra no tiene códigos.') + '</div>';
  }

  // Paso 3: los ítems del CC, varios a la vez.
  async function cargarItems(cc) {
    cc = String(cc || '').trim().toUpperCase();
    if (!cc) return;
    ING.cc = cc;
    ING.sel = {};
    ING.filtroItem = '';
    $('matItemFiltro').value = '';
    $('matItems').innerHTML = '<div class="mat-vacio">Leyendo ' + esc(cc) + ' en aSa…</div>';
    irA('items');
    var d = await global.apiGet('/material/cc/' + encodeURIComponent(cc) + '/items');
    ING.items = (d && d.items) || [];
    pintarItems();
  }

  function filaItem(it) {
    var k = it.item_key, marcado = ING.sel[k] != null;
    return { attrs: marcado ? ' class="bueno"' : '',
             check: '<input type="checkbox" data-sel="' + k + '"' + (marcado ? ' checked' : '') + '>',
             barra: barraHoja(it, it.cant, it.kg), elemento: [it.ubicacion, it.elemento].filter(Boolean).join(' · '),
             propias: ['<input class="arm-input mat-cant" type="number" min="1" max="' + it.cant + '" data-cant="' + k +
                       '" value="' + (marcado ? ING.sel[k] : it.cant) + '">', esc(it.estado_asa || '')],
             texto: esc(it.descr_cc || '') };
  }

  function pintarItems() {
    var f = ING.filtroItem, lista = ING.items.filter(function (it) {
      return !f || String(it.marca || '').toLowerCase().indexOf(f) >= 0; });
    pintarSeleccion();
    if (!lista.length) {
      $('matItems').innerHTML = '<div class="mat-vacio">' + (ING.items.length ? 'Ninguna marca calza.' : 'Ese código no tiene barras en aSa.') + '</div>';
      return;
    }
    $('matItems').innerHTML = global.HojaBarras.tabla({
      check: { titulo: '' }, accion: null,
      propias: [{ titulo: 'Cantidad', ancho: 84, title: 'Cuántas quedan disponibles (una devolución puede no traer el ítem entero)' },
                { titulo: 'Estado', ancho: 84 }],
      texto: { titulo: 'Código' }, filas: lista.map(filaItem) });
  }

  function pintarSeleccion() {
    var n = Object.keys(ING.sel).length;
    $('matItemsCuenta').textContent = n ? n + ' ítem(s) elegidos' : '';
    $('matItemsSeguir').disabled = !n;
    $('matItemsSeguir').textContent = n ? 'Siguiente (' + n + ')' : 'Siguiente';
  }

  function itemPorClave(k) { return ING.items.filter(function (it) { return String(it.item_key) === String(k); })[0]; }

  function marcar(k, si) {
    if (si) {
      var inp = $('matItems').querySelector('[data-cant="' + k + '"]');
      ING.sel[k] = Number(inp ? inp.value : itemPorClave(k).cant);
    } else {
      delete ING.sel[k];
    }
    pintarSeleccion();
  }

  function cambiaCantidad(inp) {
    var k = inp.dataset.cant;
    if (ING.sel[k] == null) {
      ING.sel[k] = Number(inp.value);
      var chk = $('matItems').querySelector('[data-sel="' + k + '"]');
      if (chk) chk.checked = true;
    } else {
      ING.sel[k] = Number(inp.value);
    }
    pintarSeleccion();
  }

  // Paso 4: motivo, ubicación y nota, comunes a lo elegido.
  function campo(etiqueta, html, ancho) {
    return '<div class="mat-campo' + (ancho ? ' mat-campo--ancho' : '') + '"><label>' + esc(etiqueta) + '</label>' + html + '</div>';
  }

  function campoTexto(id, valor, extra) {
    return '<input class="arm-input" id="' + id + '" value="' + esc(valor || '') + '"' + (extra || '') + '>';
  }

  function resumenSeleccion() {
    var kg = 0, filas = Object.keys(ING.sel).map(function (k) {
      var it = itemPorClave(k), n = ING.sel[k];
      kg += it.kg && it.cant ? it.kg / it.cant * n : 0;
      return '<div class="mat-linea">' + esc(it.marca || '') + ' · ' + esc(it.diam || '') + ' · ' + num(n) + ' de ' + num(it.cant) +
             (it.ubicacion ? ' · ' + esc(it.ubicacion) : '') + '</div>';
    });
    return '<b>' + filas.length + ' ítem(s) · ' + num(kg) + ' kg</b>' + filas.join('');
  }

  function aDatos() {
    ING.motivo = '';
    $('matPrevia').innerHTML = resumenSeleccion();
    $('matResumen').textContent = [ING.cc, ING.obra ? ING.obra.label : ''].filter(Boolean).join(' · ');
    // Sin campo de ubicación: es la de la tarjeta de cada ítem (su elemento en aSa) y la trae
    // ArmaHub (usuario, 25-nov). Va en el resumen, al lado de cada ítem.
    $('matCampos').innerHTML = campo('Motivo', '<div class="mat-seg" id="matMotivoIng"></div>', true) +
      campo('Nota', campoTexto('matNota', ''), true);
    var ops = MOTIVOS_ASA.map(function (k) { return [k, MAT.motivos[k] || k]; });
    var alElegir = function (v) { ING.motivo = v; seg('matMotivoIng', ops, v, alElegir); };
    seg('matMotivoIng', ops, ING.motivo, alElegir);
    $('matGuardar').textContent = 'Dejar disponibles (' + Object.keys(ING.sel).length + ')';
    irA('datos');
  }

  // Crear ítem: la figura en tarjetas, y después sus lados.
  async function cargarFiguras() {
    if (!ING.figuras) {
      $('matFigs').innerHTML = '<div class="mat-vacio">Cargando figuras…</div>';
      var d = await global.apiGet('/material/figuras');
      ING.figuras = (d && d.figuras) || [];
    }
    seg('matNLados', N_LADOS, ING.nLados, function (v) { ING.nLados = v; pintarFiguras(); });
    pintarFiguras();
  }

  function figuraPasa(f) {
    var n = f.lados.length;
    if (ING.nLados === '7' && n < 7) return false;
    if (ING.nLados && ING.nLados !== '7' && String(n) !== ING.nLados) return false;
    return !ING.figBuscar || String(f.nombre).toLowerCase().indexOf(ING.figBuscar) >= 0;
  }

  function tarjeta(f, i) {
    return '<button type="button" class="mat-fig" data-fig="' + i + '">' +
           dibujo({ figura: f.codigo, diam: 10, dims: {}, eje: f.eje, angulos: [] }) +
           '<b>' + esc(f.nombre) + '</b><span class="mat-linea">' + f.lados.length + ' lado(s)</span></button>';
  }

  function pintarFiguras() {
    var html = ING.figuras.map(function (f, i) { return figuraPasa(f) ? tarjeta(f, i) : ''; }).join('');
    $('matFigs').innerHTML = html || '<div class="mat-vacio">Ninguna figura con esos lados.</div>';
  }

  function elegirFigura(i) {
    ING.fig = ING.figuras[Number(i)];
    ING.previa = null;
    $('matResumen').textContent = ING.fig.nombre + ' · ' + ING.fig.lados.length + ' lado(s)';
    $('matPrevia').innerHTML = dibujo({ figura: ING.fig.codigo, diam: 10, dims: {}, eje: ING.fig.eje, angulos: [] });
    pintarCamposMano();
    $('matGuardar').textContent = 'Dejar disponible';
    irA('datos');
  }

  function camposLados(fig) {
    return fig.lados.map(function (l) {
      var html = campo('Lado ' + l.nombre + ' (cm)', '<input class="arm-input" type="number" min="0" step="0.5" data-lado="' + esc(l.nombre) + '">');
      return html + (l.arco ? campo('Radio de ' + l.nombre + ' (cm)', '<input class="arm-input" type="number" min="0" data-radio="' + esc(l.nombre) + '">') : '');
    }).join('');
  }

  // φ, grado y ubicación se recuerdan: en un inventario se ingresan muchas barras seguidas.
  function pintarCamposMano() {
    $('matCampos').innerHTML =
      campo('φ', '<div class="mat-seg" id="matDiamIng"></div>', true) +
      campo('Grado', '<div class="mat-seg" id="matGradoIng"></div>', true) +
      camposLados(ING.fig) +
      campo('Cantidad', campoTexto('matCant', '1', ' type="number" min="1"')) +
      campo('Ubicación', campoTexto('matUbic', ING.ubicacion)) + campo('Nota', campoTexto('matNota', ''), true);
    var diams = MAT.diametros.map(function (d) { return [d, 'φ' + d]; });
    var grados = Object.keys(MAT.grados).map(function (k) { return [k, MAT.grados[k]]; });
    var conDiam = function (v) { ING.diam = Number(v); seg('matDiamIng', diams, ING.diam, conDiam); pedirPrevia(); };
    var conGrado = function (v) { ING.grado = v; seg('matGradoIng', grados, ING.grado, conGrado); };
    seg('matDiamIng', diams, ING.diam, conDiam);
    seg('matGradoIng', grados, ING.grado, conGrado);
    $('matCampos').querySelectorAll('[data-lado],[data-radio]').forEach(function (inp) {
      inp.addEventListener('input', pedirPrevia);
    });
  }

  function medidas(atributo) {
    var out = {};
    $('matCampos').querySelectorAll('[' + atributo + ']').forEach(function (inp) {
      if (inp.value !== '') out[inp.getAttribute(atributo)] = inp.value;
    });
    return out;
  }

  function datosMano() {
    return { figura: ING.fig.codigo, lados: medidas('data-lado'), radios: medidas('data-radio'), diam: ING.diam };
  }

  function completa() {
    var d = datosMano();
    return ING.fig.lados.every(function (l) { return d.lados[l.nombre] && (!l.arco || d.radios[l.nombre]); });
  }

  // La vista previa se pide al servidor cuando están todos los lados, con un respiro entre teclas.
  function pedirPrevia() {
    clearTimeout(ING.espera);
    if (!completa()) return;
    ING.espera = setTimeout(async function () {
      var r = await global.apiPostJson('/material/previa', Object.assign({ origen: 'mano' }, datosMano()));
      if (!r || r.detail) { $('matError').textContent = errorDe(r, ''); return; }
      $('matError').textContent = '';
      ING.previa = r;
      $('matPrevia').innerHTML = dibujo({ figura: ING.fig.codigo, diam: ING.diam, dims: dimsDe(r.lados), eje: r.eje,
                                           angulos: [] }) +
        '<span class="mat-linea">' + num(r.largo_mm / 10) + ' cm · ' + (r.kg_unit || 0).toFixed(2) + ' kg c/u</span>';
    }, 350);
  }

  function dimsDe(lados) {
    var out = {};
    (lados || []).forEach(function (l) { out[l.nombre] = l.largo; });
    return out;
  }

  // ── GUARDAR ───────────────────────────────────────────────────────────────────
  function cuerpoLote() {
    return { cc: ING.cc, motivo: ING.motivo, nota: $('matNota').value,
             items: Object.keys(ING.sel).map(function (k) { return { item_key: Number(k), cantidad: ING.sel[k] }; }) };
  }

  function cuerpoMano() {
    return Object.assign({ origen: 'mano', grado: ING.grado, cantidad: Number($('matCant').value),
                           ubicacion: $('matUbic').value, nota: $('matNota').value }, datosMano());
  }

  async function enviar() {
    if (ING.tipo === 'asa') return global.apiPostJson('/material/barras/lote', cuerpoLote());
    ING.ubicacion = $('matUbic').value;
    return global.apiPostJson('/material/barras', cuerpoMano());
  }

  async function guardar(yOtro) {
    var b = $('matGuardar');
    b.disabled = true;
    var r = await enviar();
    b.disabled = false;
    if (!r || r.detail) { $('matError').textContent = errorDe(r, 'No se pudo guardar.'); return; }
    await cargar();
    if (yOtro) { otroIgual(); return; }
    if (ING.tipo === 'mano') { ok('Ítem disponible'); cerrarIngreso(); return; }
    $('matListoTxt').innerHTML = '<b>' + (r.ids || []).length + ' ítem(s) de ' + esc(ING.cc) + ' quedaron disponibles.</b>';
    irA('listo');
  }

  // «Guardar y crear otro»: queda la figura, el φ, el grado y la ubicación; se limpian los lados.
  function otroIgual() {
    ok('Ítem disponible');
    $('matCampos').querySelectorAll('[data-lado],[data-radio]').forEach(function (inp) { inp.value = ''; });
    $('matCant').value = '1';
    $('matPrevia').innerHTML = dibujo({ figura: ING.fig.codigo, diam: 10, dims: {}, eje: ING.fig.eje, angulos: [] });
    var primero = $('matCampos').querySelector('[data-lado]');
    if (primero) primero.focus();
  }

  // «Ingresar otro del mismo CC»: vuelve a los ítems, sin lo ya elegido.
  function otroDelCc() {
    ING.sel = {};
    pintarItems();
    irA('items');
  }

  // ── RESUMEN: LO REUTILIZADO (fase 3) ─────────────────────────────────────────
  // Lo que producción confirmó: de qué barra salió, para qué ítem y quién lo confirmó.
  function dos(n) { return ('0' + n).slice(-2); }
  function fechaHora(iso) {
    var d = new Date(iso || '');
    if (isNaN(d)) return '';
    return dos(d.getDate()) + '-' + dos(d.getMonth() + 1) + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }

  function filaResumen(f) {
    return {
      barra: barraHoja({ marca: f.barra_marca, diam_mm: f.diam_mm, figura: f.barra_figura, dims: f.barra_dims, eje: f.eje,
                         referencias: f.referencias, largo_mm: f.largo_mm }, f.cant_barras, f.kg),
      elemento: f.ubicacion || '',
      propias: [tagMotivo(f.motivo, f.motivo_txt), esc(f.cc) + '<div class="mat-linea">' + esc(f.marca || '') + '</div>',
                esc(f.producido_nombre || '—') + '<div class="mat-linea">' + esc(fechaHora(f.producido_el)) + '</div>'],
      texto: esc([f.obra, f.descr_cc].filter(Boolean).join(' · '))
    };
  }

  async function cargarResumen() {
    var d = await global.apiGet('/material/resumen');
    if (!d) { $('matRes').innerHTML = '<div class="mat-vacio">No se pudo cargar.</div>'; return; }
    $('matKpiResKg').textContent = num(d.kg) + ' kg';
    $('matKpiResBarras').textContent = num(d.barras);
    $('matKpiResItems').textContent = num(d.items);
    if (!d.filas.length) {
      $('matRes').innerHTML = '<div class="mat-vacio">Todavía no hay material reutilizado confirmado.</div>';
      return;
    }
    $('matRes').innerHTML = global.HojaBarras.tabla({
      accion: null,
      propias: [{ titulo: 'Motivo', ancho: 104 }, { titulo: 'Para', ancho: 110 }, { titulo: 'Confirmó', ancho: 150 }],
      texto: { titulo: 'Obra' }, titulos: { cant: 'Barras disponibles usadas', peso: 'Kilos reutilizados' },
      filas: d.filas.map(filaResumen) });
  }

  function elegirSub(sub) {
    document.querySelectorAll('#matSubs .arm-tab').forEach(function (b) {
      var on = b.dataset.sub === sub;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    mostrar('matPanelDisp', sub === 'disp');
    mostrar('matPanelRes', sub === 'res');
    if (sub === 'res') cargarResumen();
  }

  // ── CARGA Y EVENTOS ───────────────────────────────────────────────────────────
  async function cargar() {
    var d = await global.apiGet('/material/barras');
    if (!d) { $('matLista').innerHTML = '<div class="mat-vacio">No se pudo cargar la lista.</div>'; return; }
    MAT.barras = d.barras || [];
    MAT.motivos = d.motivos || {};
    MAT.grados = d.grados || {};
    MAT.diametros = d.diametros || [];
    pintarLista();
  }

  function clicLista(e) {
    var b = e.target.closest('[data-asignar]');
    if (b && global.MaterialAsignar) global.MaterialAsignar.abrir(b.dataset.asignar);
  }

  function clicModal(e) {
    if (e.target === $('matModal')) { cerrarIngreso(); return; }
    var el = e.target.closest('[data-paso],tr[data-cc],[data-fig]');
    if (!el || el.disabled) return;
    if (el.dataset.paso) irA(el.dataset.paso);
    else if (el.dataset.cc) cargarItems(el.dataset.cc);
    else elegirFigura(el.dataset.fig);
  }

  function cambioModal(e) {
    var t = e.target;
    if (t.matches('[data-sel]')) marcar(t.dataset.sel, t.checked);
    else if (t.matches('[data-cant]')) cambiaCantidad(t);
  }

  function enganchar() {
    $('matIngCrear').addEventListener('click', function () { abrirIngreso('mano'); });
    $('matIngCcIr').addEventListener('click', ingresarCc);
    $('matIngCc').addEventListener('keydown', function (e) { if (e.key === 'Enter') ingresarCc(); });
    $('matCerrar').addEventListener('click', cerrarIngreso);
    $('matVolver').addEventListener('click', volver);
    $('matGuardar').addEventListener('click', function () { guardar(false); });
    $('matGuardarOtro').addEventListener('click', function () { guardar(true); });
    $('matOtroCc').addEventListener('click', otroDelCc);
    $('matListoCerrar').addEventListener('click', cerrarIngreso);
    $('matItemsSeguir').addEventListener('click', aDatos);
    $('matCcBuscar').addEventListener('click', function () { cargarItems($('matCc').value); });
    $('matCc').addEventListener('keydown', function (e) { if (e.key === 'Enter') cargarItems($('matCc').value); });
    $('matCcFiltro').addEventListener('input', function () { ING.ccFiltro = this.value.trim().toLowerCase(); pintarCcs(); });
    $('matModal').addEventListener('change', cambioModal);
    $('matModal').addEventListener('input', function (e) { if (e.target.matches('[data-cant]')) cambiaCantidad(e.target); });
    $('matItemFiltro').addEventListener('input', function () { ING.filtroItem = this.value.trim().toLowerCase(); pintarItems(); });
    $('matFigBuscar').addEventListener('input', function () { ING.figBuscar = this.value.trim().toLowerCase(); pintarFiguras(); });
    $('matLista').addEventListener('click', clicLista);
    $('matModal').addEventListener('click', clicModal);
    document.querySelectorAll('#matSubs .arm-tab').forEach(function (b) {
      b.addEventListener('click', function () { elegirSub(b.dataset.sub); });
    });
  }

  global.loadMaterialModule = function () {};   // la pestaña carga lo suyo (shell.js, tabLoaders)
  global.loadMaterial = async function () {
    if (!$('tab-material')) return;
    if (!_listo) { _listo = true; enganchar(); }
    cargarObras();
    await cargar();
  };

  // Lo que usa la ventana de la barra (asignar.js).
  global.MaterialComun = { esc: esc, num: num, ok: ok, errorDe: errorDe, barraHoja: barraHoja, tablaBarras: tablaBarras,
                           fechaHora: fechaHora, recargar: function () { return cargar(); } };

  global.__materialTest = { MAT: MAT, ING: ING, pasa: pasa, resumen: resumen, ladosCm: ladosCm, barraHoja: barraHoja,
                            filaHoja: filaHoja, figuraPasa: figuraPasa, completa: completa,
                            ccPasa: ccPasa, filaCc: filaCc, filaItem: filaItem, elegirObra: elegirObra,
                            cargarItems: cargarItems, aDatos: aDatos, marcar: marcar, abrirIngreso: abrirIngreso,
                            filaResumen: filaResumen, fechaHora: fechaHora, asignacionDe: asignacionDe };
})(window);
