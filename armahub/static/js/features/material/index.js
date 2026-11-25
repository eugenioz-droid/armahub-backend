// MATERIAL DISPONIBLE (25-nov, SPECS §15) — la caluga para reciclar barras. Fase 1: la lista de
// lo disponible y «Ingresar barra», desde un ítem de aSa o medida a mano.
//
// LA MISMA BARRA EN TODOS LADOS. La tabla es la hoja estándar de barras (hoja_barras.js) y el
// dibujo es el de Auditorías (audBarraNormalizada + audCeldaFigura): una barra disponible se ve
// igual que en la auditoría. El servidor manda los lados en mm; la hoja los muestra en cm.
//
// A MANO, LA FIGURA SE ELIGE VIÉNDOLA. Son las figuras que de verdad se usan en aSa, en tarjetas
// con su dibujo y un filtro por cantidad de lados: quien hace inventario no se sabe el catálogo.
(function (global) {
  'use strict';

  var MAT = { barras: [], motivos: {}, grados: {}, diametros: [], estado: 'disponible', motivo: '',
              diam: '', buscar: '' };
  var ING = { tipo: 'asa', items: [], item: null, filtroItem: '', figuras: null, nLados: '', figBuscar: '',
              fig: null, previa: null, espera: null, motivo: '', diam: 12, grado: 'A630-420H' };
  var ESTADOS = [['disponible', 'Disponibles'], ['agotada', 'Agotadas'], ['descartada', 'Descartadas'], ['', 'Todas']];
  var N_LADOS = [['', 'Todas'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7+']];
  // Los colores de estado del manual, uno por motivo, siempre el mismo.
  var TAG_MOTIVO = { devolucion: 'info', mal_fabricada: 'warning', sobrante: 'success', inventario: 'review' };
  var MOTIVOS_ASA = ['devolucion', 'mal_fabricada', 'sobrante'];
  var COIN = { filas: [], tipo: '', estado: '', buscar: '', corriendo: false, ultima: null, sondeo: null };
  var TIPOS = [['', 'Todas'], ['igual', 'Igual'], ['corte', 'Con corte']];
  var ESTADOS_ASA = [['', 'Open y Processed'], ['Open', 'Open'], ['Processed', 'Processed']];
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
  function texto(b) {
    return [b.marca, b.cc, b.obra, b.figura || 'recta', b.elemento, b.descr_cc, b.ubicacion].join(' ').toLowerCase();
  }

  function pasa(b) {
    if (MAT.estado && b.estado !== MAT.estado) return false;
    if (MAT.motivo && b.motivo !== MAT.motivo) return false;
    if (MAT.diam && String(b.diam_mm) !== MAT.diam) return false;
    return !MAT.buscar || texto(b).indexOf(MAT.buscar) >= 0;
  }

  function resumen(barras, ahora) {
    var mes = new Date(ahora).toISOString().slice(0, 7), r = { barras: 0, kg: 0, mes: 0 };
    barras.forEach(function (b) {
      if (b.estado === 'disponible') { r.barras += b.cant_disponible; r.kg += b.kg_disponible || 0; }
      if ((b.creado_el || '').slice(0, 7) === mes) r.mes++;
    });
    return r;
  }

  function pintarKpis() {
    var r = resumen(MAT.barras, Date.now());
    $('matKpiBarras').textContent = num(r.barras);
    $('matKpiKg').textContent = num(r.kg) + ' kg';
    $('matKpiMes').textContent = num(r.mes);
  }

  function origen(b) {
    if (b.origen !== 'asa') return '<span class="mat-linea">A mano</span>';
    return esc(b.cc) + '<div class="mat-linea">' + esc(b.obra || '') + '</div>';
  }

  function accionesDe(b) {
    if (b.estado === 'descartada') return '<span class="mat-linea">Descartada</span>';
    return '<div class="mat-acc"><button type="button" class="arm-button" data-ajustar="' + b.id + '">Ajustar</button>' +
           '<button type="button" class="arm-button arm-button--danger" data-descartar="' + b.id + '">Descartar</button></div>';
  }

  function textoDe(b) {
    var partes = [b.descr_cc, b.cliente, b.nota, b.descarte_motivo ? 'Descartada: ' + b.descarte_motivo : ''];
    var quien = b.creado_nombre || b.creado_por || '';
    return esc(partes.filter(Boolean).join(' · ')) +
           '<div class="mat-linea">' + esc(quien) + ' · ' + esc((b.creado_el || '').slice(0, 10)) + '</div>';
  }

  function filaHoja(b) {
    return {
      attrs: ' data-id="' + b.id + '"' + (b.estado !== 'disponible' ? ' class="mat-apagada"' : ''),
      accion: accionesDe(b),
      barra: barraHoja(b, b.cant_disponible, b.kg_disponible),
      elemento: b.elemento || '',
      propias: ['<span class="arm-tag arm-tag--' + (TAG_MOTIVO[b.motivo] || 'info') + '">' + esc(b.motivo_txt) + '</span>',
                origen(b), esc(b.ubicacion || '')],
      texto: textoDe(b)
    };
  }

  function pintarFiltros() {
    seg('matEstado', ESTADOS, MAT.estado, function (v) { MAT.estado = v; pintarLista(); });
    var motivos = [['', 'Todos']].concat(Object.keys(MAT.motivos).map(function (k) { return [k, MAT.motivos[k]]; }));
    seg('matMotivo', motivos, MAT.motivo, function (v) { MAT.motivo = v; pintarLista(); });
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
        (MAT.barras.length ? 'Nada con estos filtros.' : 'Todavía no hay barras ingresadas.') + '</div>';
      return;
    }
    $('matLista').innerHTML = global.HojaBarras.tabla({
      accion: { titulo: '', ancho: 150 },
      propias: [{ titulo: 'Motivo', ancho: 104 }, { titulo: 'Origen', ancho: 170 }, { titulo: 'Ubicación', ancho: 110 }],
      texto: { titulo: 'Detalle' },
      filas: lista.map(filaHoja)
    });
  }

  // ── AJUSTAR Y DESCARTAR, EN UNA FILA DEBAJO ──────────────────────────────────
  function barraPorId(id) { return MAT.barras.filter(function (b) { return String(b.id) === String(id); })[0]; }

  function editorHtml(b, modo) {
    if (modo === 'descartar') {
      return '<label class="mat-campo">Por qué se descarta<input class="arm-input" data-campo="motivo" style="width:320px"></label>' +
             '<button type="button" class="arm-button arm-button--danger" data-confirmar="descartar">Descartar</button>' +
             '<button type="button" class="arm-button" data-confirmar="no">Cancelar</button>';
    }
    return '<label class="mat-campo">Disponibles<input class="arm-input" type="number" min="0" data-campo="cantidad" value="' +
             b.cant_disponible + '" style="width:110px"></label>' +
           '<label class="mat-campo">Ubicación<input class="arm-input" data-campo="ubicacion" value="' + esc(b.ubicacion || '') + '"></label>' +
           '<label class="mat-campo">Nota<input class="arm-input" data-campo="nota" value="' + esc(b.nota || '') + '" style="width:280px"></label>' +
           '<button type="button" class="arm-button arm-button--primary" data-confirmar="ajustar">Guardar</button>' +
           '<button type="button" class="arm-button" data-confirmar="no">Cancelar</button>';
  }

  function abrirEditor(id, modo) {
    var viejo = document.querySelector('#matLista tr.mat-edit');
    if (viejo) viejo.parentNode.removeChild(viejo);
    var tr = document.querySelector('#matLista tr[data-id="' + id + '"]');
    if (!tr) return;
    var ed = document.createElement('tr');
    ed.className = 'mat-edit';
    ed.dataset.id = id;
    ed.innerHTML = '<td colspan="99"><div class="mat-edit__caja">' + editorHtml(barraPorId(id), modo) + '</div></td>';
    tr.parentNode.insertBefore(ed, tr.nextSibling);
    var primero = ed.querySelector('input');
    if (primero) primero.focus();
  }

  function valorEditor(ed, campo) {
    var i = ed.querySelector('[data-campo="' + campo + '"]');
    return i ? i.value : null;
  }

  async function confirmarEditor(ed, accion) {
    if (accion === 'no') { ed.parentNode.removeChild(ed); return; }
    var id = ed.dataset.id, r;
    if (accion === 'descartar') {
      r = await global.apiPostJson('/material/barras/' + id + '/descartar', { motivo: valorEditor(ed, 'motivo') || '' });
    } else {
      r = await global.apiPostJson('/material/barras/' + id + '/ajustar', {
        cantidad: Number(valorEditor(ed, 'cantidad')), ubicacion: valorEditor(ed, 'ubicacion'), nota: valorEditor(ed, 'nota') });
    }
    if (!r || r.detail) { aviso(errorDe(r, 'No se pudo guardar.')); return; }
    ok(accion === 'descartar' ? 'Barra descartada' : 'Cambios guardados');
    await cargar();
  }

  // ── INGRESAR ──────────────────────────────────────────────────────────────────
  function mostrar(id, si) { $(id).style.display = si ? '' : 'none'; }

  function abrirIngreso() {
    ING.item = null; ING.fig = null; ING.previa = null; ING.motivo = '';
    $('matError').textContent = '';
    mostrar('matModal', true);
    elegirTipo(ING.tipo);
  }

  function cerrarIngreso() { mostrar('matModal', false); }

  function elegirTipo(t) {
    ING.tipo = t;
    seg('matTipo', [['asa', 'Desde aSa'], ['mano', 'A mano']], t, elegirTipo);
    mostrar('matPasoAsa', t === 'asa' && !ING.item);
    mostrar('matPasoMano', t === 'mano' && !ING.fig);
    mostrar('matDatos', (t === 'asa' && ING.item) || (t === 'mano' && ING.fig));
    if (t === 'asa') $('matCc').focus();
    if (t === 'mano') cargarFiguras();
  }

  function volver() {
    if (ING.tipo === 'asa') ING.item = null; else ING.fig = null;
    $('matError').textContent = '';
    elegirTipo(ING.tipo);
  }

  // Desde aSa: el código, sus barras, y se elige una.
  async function buscarCc() {
    var cc = $('matCc').value.trim();
    if (!cc) return;
    $('matItems').innerHTML = '<div class="mat-vacio">Leyendo ' + esc(cc) + ' en aSa…</div>';
    var d = await global.apiGet('/material/cc/' + encodeURIComponent(cc) + '/items');
    ING.items = (d && d.items) || [];
    ING.filtroItem = '';
    $('matItemFiltro').value = '';
    mostrar('matItemFiltro', ING.items.length > 0);
    pintarItems();
  }

  function filaItem(it) {
    return { accion: '<div class="mat-acc"><button type="button" class="arm-button" data-elegir="' + it.item_key + '">Elegir</button></div>',
             barra: barraHoja(it, it.cant, it.kg), elemento: it.elemento || '',
             propias: [esc(it.estado_asa || '')], texto: esc(it.descr_cc || '') };
  }

  function pintarItems() {
    var f = ING.filtroItem, lista = ING.items.filter(function (it) {
      return !f || String(it.marca || '').toLowerCase().indexOf(f) >= 0; });
    if (!lista.length) {
      $('matItems').innerHTML = '<div class="mat-vacio">' + (ING.items.length ? 'Ninguna marca calza.' : 'Ese código no tiene barras en aSa.') + '</div>';
      return;
    }
    $('matItems').innerHTML = global.HojaBarras.tabla({
      accion: { titulo: '', ancho: 80 }, propias: [{ titulo: 'Estado', ancho: 90 }],
      texto: { titulo: 'Código' }, filas: lista.map(filaItem) });
  }

  function elegirItem(key) {
    ING.item = ING.items.filter(function (it) { return String(it.item_key) === String(key); })[0];
    if (!ING.item) return;
    ING.motivo = '';
    $('matPrevia').innerHTML = dibujo(ING.item);
    $('matResumen').textContent = [ING.item.cc, ING.item.marca, ING.item.diam, ING.item.figura || 'Recta',
                                   ING.item.obra].filter(Boolean).join(' · ');
    pintarCamposAsa();
    elegirTipo('asa');
  }

  function campo(etiqueta, html, ancho) {
    return '<div class="mat-campo' + (ancho ? ' mat-campo--ancho' : '') + '"><label>' + esc(etiqueta) + '</label>' + html + '</div>';
  }

  function campoTexto(id, valor, extra) {
    return '<input class="arm-input" id="' + id + '" value="' + esc(valor || '') + '"' + (extra || '') + '>';
  }

  function pintarCamposAsa() {
    $('matCampos').innerHTML =
      campo('Motivo', '<div class="mat-seg" id="matMotivoIng"></div>', true) +
      campo('Cantidad (de ' + num(ING.item.cant) + ')', campoTexto('matCant', ING.item.cant, ' type="number" min="1" max="' + ING.item.cant + '"')) +
      campo('Ubicación', campoTexto('matUbic', '')) + campo('Nota', campoTexto('matNota', ''), true);
    var ops = MOTIVOS_ASA.map(function (k) { return [k, MAT.motivos[k] || k]; });
    var alElegir = function (v) { ING.motivo = v; seg('matMotivoIng', ops, v, alElegir); };
    seg('matMotivoIng', ops, ING.motivo, alElegir);
  }

  // A mano: la figura en tarjetas, y después sus lados.
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
    elegirTipo('mano');
  }

  function camposLados(fig) {
    return fig.lados.map(function (l) {
      var html = campo('Lado ' + l.nombre + ' (cm)', '<input class="arm-input" type="number" min="0" step="0.5" data-lado="' + esc(l.nombre) + '">');
      return html + (l.arco ? campo('Radio de ' + l.nombre + ' (cm)', '<input class="arm-input" type="number" min="0" data-radio="' + esc(l.nombre) + '">') : '');
    }).join('');
  }

  function pintarCamposMano() {
    $('matCampos').innerHTML =
      campo('φ', '<div class="mat-seg" id="matDiamIng"></div>', true) +
      campo('Grado', '<div class="mat-seg" id="matGradoIng"></div>', true) +
      camposLados(ING.fig) +
      campo('Cantidad', campoTexto('matCant', '1', ' type="number" min="1"')) +
      campo('Ubicación', campoTexto('matUbic', '')) + campo('Nota', campoTexto('matNota', ''), true);
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

  function cuerpoIngreso() {
    var comunes = { cantidad: Number($('matCant').value), ubicacion: $('matUbic').value, nota: $('matNota').value };
    if (ING.tipo === 'asa') {
      return Object.assign({ origen: 'asa', item_key: ING.item.item_key, motivo: ING.motivo }, comunes);
    }
    return Object.assign({ origen: 'mano', grado: ING.grado }, datosMano(), comunes);
  }

  async function guardar() {
    var b = $('matGuardar');
    b.disabled = true;
    var r = await global.apiPostJson('/material/barras', cuerpoIngreso());
    b.disabled = false;
    if (!r || r.detail) { $('matError').textContent = errorDe(r, 'No se pudo guardar.'); return; }
    ok('Barra disponible');
    cerrarIngreso();
    await cargar();
  }

  // ── COINCIDENCIAS (fase 2): lo que la búsqueda encontró en aSa ─────────────────
  function cmTxt(mm) { return global.HojaBarras.cm(Number(mm) / 10) + ' cm'; }

  // Qué hay que hacerle a la barra disponible para fabricar el ítem.
  function queHacer(c) {
    var cortes = c.cortes || [];
    if (c.piezas > 1) {
      var sobra = cortes[0] && cortes[0][1] > 0 ? ' · sobran ' + cmTxt(cortes[0][1]) : '';
      return c.piezas + ' por barra' + sobra;
    }
    if (!cortes.length) return 'Tal cual';
    return 'Cortar ' + cortes.map(function (x) { return x[0] + ' ' + cmTxt(x[1]); }).join(' y ');
  }

  function coinTexto(c) { return [c.cc, c.obra, c.marca, c.descr_cc, c.elemento].join(' ').toLowerCase(); }

  function coinPasa(c) {
    if (COIN.tipo && c.tipo !== COIN.tipo) return false;
    if (COIN.estado && c.estado_asa !== COIN.estado) return false;
    return !COIN.buscar || coinTexto(c).indexOf(COIN.buscar) >= 0;
  }

  // Los kilos a recuperar cuentan UNA coincidencia por barra disponible (la que más ahorra):
  // la misma barra no se puede usar dos veces.
  function resumenCoin(filas) {
    var items = {}, mejor = {};
    filas.forEach(function (c) {
      items[c.item_key] = 1;
      mejor[c.barra_id] = Math.max(mejor[c.barra_id] || 0, c.kg_ahorro || 0);
    });
    var kg = Object.keys(mejor).reduce(function (s, k) { return s + mejor[k]; }, 0);
    return { items: Object.keys(items).length, kg: kg, barras: Object.keys(mejor).length };
  }

  function disponibleDe(c) {
    var que = c.barra_marca || (c.origen === 'mano' ? 'A mano' : '');
    return esc(que) + '<div class="mat-linea">' + esc(c.ubicacion || 'Sin ubicación') + '</div>';
  }

  function filaCoin(c) {
    var tag = c.tipo === 'igual' ? '<span class="arm-tag arm-tag--success">Igual</span>'
                                 : '<span class="arm-tag arm-tag--warning">Con corte</span>';
    return {
      barra: barraHoja({ marca: c.marca, notas: '', diam_mm: c.diam_mm, figura: c.figura, dims: c.dims, eje: c.eje,
                         referencias: [], largo_mm: 0 }, c.cubre, c.kg_ahorro),
      elemento: c.elemento || '',
      propias: [tag, '<span class="mat-hacer">' + esc(queHacer(c)) + '</span>', disponibleDe(c),
                esc(c.cc) + '<div class="mat-linea">' + esc(c.estado_asa || '') + ' · de ' + num(c.cant_item) + '</div>'],
      texto: esc([c.obra, c.descr_cc].filter(Boolean).join(' · '))
    };
  }

  function pintarCoin() {
    seg('matCoinTipo', TIPOS, COIN.tipo, function (v) { COIN.tipo = v; pintarCoin(); });
    seg('matCoinEstado', ESTADOS_ASA, COIN.estado, function (v) { COIN.estado = v; pintarCoin(); });
    var lista = COIN.filas.filter(coinPasa), r = resumenCoin(lista);
    $('matKpiItems').textContent = num(r.items);
    $('matKpiAhorro').textContent = num(r.kg) + ' kg';
    $('matKpiConCoin').textContent = num(r.barras);
    if (!lista.length) {
      $('matCoin').innerHTML = '<div class="mat-vacio">' +
        (COIN.filas.length ? 'Nada con estos filtros.' : 'Sin coincidencias en lo que se va a fabricar.') + '</div>';
      return;
    }
    $('matCoin').innerHTML = '<div class="mat-sin-cotas">' + global.HojaBarras.tabla({
      accion: null,
      propias: [{ titulo: 'Tipo', ancho: 84 }, { titulo: 'Qué hacer', ancho: 170 },
                { titulo: 'Barra disponible', ancho: 130 }, { titulo: 'CC', ancho: 110 }],
      texto: { titulo: 'Obra' }, titulos: { cant: 'Cuántas piezas del ítem cubre lo disponible' },
      filas: lista.map(filaCoin) }) + '</div>';
  }

  function textoBusqueda(u, corriendo) {
    if (corriendo || (u && u.en_curso)) return 'Buscando en aSa…';
    if (!u) return 'Todavía sin buscar';
    if (!u.ok) return 'La última búsqueda falló' + (u.detalle ? ': ' + u.detalle : '');
    return 'Buscado ' + fechaHora(u.fin);
  }

  // «25-11 06:00», en hora local, como el resto de la plataforma.
  function dos(n) { return ('0' + n).slice(-2); }
  function fechaHora(iso) {
    var d = new Date(iso || '');
    if (isNaN(d)) return '';
    return dos(d.getDate()) + '-' + dos(d.getMonth() + 1) + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }

  function cabeceraCoin() {
    var buscando = COIN.corriendo || !!(COIN.ultima && COIN.ultima.en_curso);
    $('matCoinCarga').textContent = textoBusqueda(COIN.ultima, COIN.corriendo);
    $('matBuscarAhora').disabled = buscando;
    $('matBuscarAhora').textContent = buscando ? 'Buscando…' : 'Buscar ahora';
    if (buscando) sondearCoin();
  }

  // Mientras busca, la lista se vuelve a pedir sola hasta que termine.
  function sondearCoin() {
    if (COIN.sondeo) return;
    COIN.sondeo = setTimeout(function () { COIN.sondeo = null; cargarCoin(); }, 8000);
  }

  async function cargarCoin() {
    var d = await global.apiGet('/material/coincidencias');
    if (!d) { $('matCoin').innerHTML = '<div class="mat-vacio">No se pudo cargar.</div>'; return; }
    COIN.filas = d.coincidencias || [];
    COIN.corriendo = !!d.corriendo;
    COIN.ultima = d.ultima || null;
    cabeceraCoin();
    pintarCoin();
  }

  async function buscarAhora() {
    var r = await global.apiPostJson('/material/buscar', {});
    if (!r || r.detail) { aviso(errorDe(r, 'No se pudo lanzar la búsqueda.')); return; }
    if (!r.lanzada && r.motivo) ok(r.motivo);
    COIN.corriendo = true;
    cabeceraCoin();
  }

  function elegirSub(sub) {
    document.querySelectorAll('#matSubs .arm-tab').forEach(function (b) {
      var on = b.dataset.sub === sub;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    mostrar('matPanelDisp', sub === 'disp');
    mostrar('matPanelCoin', sub === 'coin');
    if (sub === 'coin') cargarCoin();
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
    var b = e.target.closest('[data-ajustar],[data-descartar],[data-confirmar]');
    if (!b) return;
    if (b.dataset.confirmar) { confirmarEditor(b.closest('tr.mat-edit'), b.dataset.confirmar); return; }
    abrirEditor(b.dataset.ajustar || b.dataset.descartar, b.dataset.ajustar ? 'ajustar' : 'descartar');
  }

  function clicModal(e) {
    if (e.target === $('matModal')) { cerrarIngreso(); return; }
    var el = e.target.closest('[data-elegir],[data-fig]');
    if (!el) return;
    if (el.dataset.elegir) elegirItem(el.dataset.elegir); else elegirFigura(el.dataset.fig);
  }

  function enganchar() {
    $('matIngresar').addEventListener('click', abrirIngreso);
    $('matCerrar').addEventListener('click', cerrarIngreso);
    $('matVolver').addEventListener('click', volver);
    $('matGuardar').addEventListener('click', guardar);
    $('matCcBuscar').addEventListener('click', buscarCc);
    $('matCc').addEventListener('keydown', function (e) { if (e.key === 'Enter') buscarCc(); });
    $('matItemFiltro').addEventListener('input', function () { ING.filtroItem = this.value.trim().toLowerCase(); pintarItems(); });
    $('matFigBuscar').addEventListener('input', function () { ING.figBuscar = this.value.trim().toLowerCase(); pintarFiguras(); });
    $('matBuscar').addEventListener('input', function () { MAT.buscar = this.value.trim().toLowerCase(); pintarLista(); });
    $('matLista').addEventListener('click', clicLista);
    $('matModal').addEventListener('click', clicModal);
    $('matBuscarAhora').addEventListener('click', buscarAhora);
    $('matCoinBuscar').addEventListener('input', function () { COIN.buscar = this.value.trim().toLowerCase(); pintarCoin(); });
    document.querySelectorAll('#matSubs .arm-tab').forEach(function (b) {
      b.addEventListener('click', function () { elegirSub(b.dataset.sub); });
    });
  }

  global.loadMaterialModule = function () {};   // la pestaña carga lo suyo (shell.js, tabLoaders)
  global.loadMaterial = async function () {
    if (!$('tab-material')) return;
    if (!_listo) { _listo = true; enganchar(); }
    await cargar();
  };

  global.__materialTest = { MAT: MAT, ING: ING, pasa: pasa, resumen: resumen, ladosCm: ladosCm, barraHoja: barraHoja,
                            filaHoja: filaHoja, figuraPasa: figuraPasa, editorHtml: editorHtml, completa: completa,
                            COIN: COIN, queHacer: queHacer, coinPasa: coinPasa, resumenCoin: resumenCoin, filaCoin: filaCoin,
                            textoBusqueda: textoBusqueda, fechaHora: fechaHora };
})(window);
