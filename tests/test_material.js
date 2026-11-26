// TEST DEL FRONT DE «MATERIAL DISPONIBLE» (25-nov, SPECS §15) — ejecuta el archivo de verdad.
//
// Lo que se decide en el servidor (permisos, cantidades, la forma de los lados, lo que se puede
// asignar) se prueba en tests/test_material.py. Acá lo que vive en el navegador: el filtro por φ,
// los indicadores, cómo va cada barra a la hoja estándar (lados en cm, sin columnas de ángulos),
// el ingreso por pasos y la ventana de la barra (asignar.js): repartir el saldo entre ítems.
//
// Correr con: node tests/test_material.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
function check(nombre, cond) {
  console.log((cond ? '  OK  ' : '  XX  ') + nombre);
  if (!cond) fallos++;
}

const cajas = {};
function caja(id) {
  if (!cajas[id]) cajas[id] = { id, style: {}, textContent: '', innerHTML: '', disabled: false, className: '', value: '',
                                querySelector: () => null, addEventListener: () => {} };
  return cajas[id];
}
const sandbox = { console, document: { getElementById: caja, addEventListener: () => {} }, setTimeout, clearTimeout,
                  audBarraNormalizada: (b) => b, audCeldaFigura: (f) => '<svg data-fig="' + (f.figura || 'recta') + '"></svg>' };
sandbox.window = sandbox;
vm.createContext(sandbox);
const raiz = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features');
vm.runInContext(fs.readFileSync(path.join(raiz, 'auditorias', 'hoja_barras.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(raiz, 'material', 'index.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(raiz, 'material', 'asignar.js'), 'utf8'), sandbox);
const T = sandbox.__materialTest;
const V = sandbox.__materialAsignarTest;
check('los archivos cargan y exponen su API', !!T && !!V && typeof sandbox.loadMaterial === 'function'
      && typeof sandbox.loadMaterialModule === 'function' && typeof sandbox.MaterialAsignar.abrir === 'function');

const barras = [
  { id: 1, estado: 'disponible', motivo: 'mal_fabricada', motivo_txt: 'Mal fabricada', diam_mm: 10, cc: 'ST47', origen: 'asa',
    obra: 'DLP - EDIFICIO TALCA 2 SUR', marca: '10mmA1433', figura: 'T1', dims: { A: 120, B: 1220 }, angulos: [-135, -90],
    referencias: [], cant_disponible: 20, cant_inicial: 52, kg_disponible: 31.7, creado_el: '2026-11-25T10:00:00+00:00',
    largo_mm: 2540, n_asignadas: 3, n_por_confirmar: 2, ubicacion: 'ELEV. 13° PISO - EJE 12' },
  { id: 2, estado: 'disponible', motivo: 'inventario', motivo_txt: 'Inventario', diam_mm: 12, origen: 'mano',
    figura: null, dims: { A: 6000 }, angulos: [], referencias: [], cant_disponible: 12, kg_disponible: 63.9,
    creado_el: '2026-10-30T10:00:00+00:00', largo_mm: 6000, ubicacion: 'Patio 1', n_asignadas: 1, n_por_confirmar: 0 },
  { id: 3, estado: 'disponible', motivo: 'sobrante', motivo_txt: 'Sobrante', diam_mm: 25, origen: 'mano',
    figura: '9', dims: { B: 6000 }, angulos: [], referencias: [['R', 4000]], cant_disponible: 0, kg_disponible: 0,
    creado_el: '2026-11-02T10:00:00+00:00', largo_mm: 6000, n_asignadas: 1, n_por_confirmar: 1 }
];

console.log('Filtro');
const M = T.MAT;
M.diam = '';
check('sin filtro, todas las de la lista', barras.filter(T.pasa).length === 3);
M.diam = '12';
check('el único filtro es el φ', barras.filter(T.pasa).map(b => b.id).join() === '2');
M.diam = '';

console.log('Indicadores');
const r = T.resumen(barras);
check('barras disponibles = piezas de saldo (no filas)', r.barras === 32);
check('kilos disponibles', Math.abs(r.kg - 95.6) < 0.01);
check('por confirmar = asignaciones que producción no ha marcado', r.pendientes === 3);

console.log('La hoja');
check('lados en cm', JSON.stringify(T.ladosCm(barras[0])) === JSON.stringify({ A: 12, B: 122 }));
check('...y el radio de un arco como su propia columna', JSON.stringify(T.ladosCm(barras[2])) === JSON.stringify({ B: 600, R: 400 }));
const h = T.barraHoja(barras[0], 20, 31.7);
check('sin columnas de ángulos: el dibujo ya dice la forma', h.angulos.length === 0);
check('φ, figura, largo en cm, cantidad y peso', h.diam === 10 && h.figura === 'T1' && h.largo === 254 && h.cant === 20 && h.peso === 31.7);
check('la recta se llama «Recta» y una barra a mano no repite la figura como marca',
      T.barraHoja(barras[1], 12, 63.9).figura === 'Recta' && T.barraHoja(barras[1], 12, 63.9).marca === '');
const f = T.filaHoja(barras[0]);
check('motivo con su etiqueta de color, y origen con el CC y la obra',
      f.propias[0].includes('arm-tag--warning') && f.propias[0].includes('Mal fabricada') && f.propias[1].includes('ST47'));
check('sin acción si no se pide (la hoja de la ventana)', f.accion === '');
const fa = T.filaHoja(barras[0], true);
check('en la lista, una sola acción: «Asignar»', fa.accion.includes('data-asignar="1"') && fa.accion.includes('>Asignar<')
      && !fa.accion.includes('Descartar') && !fa.accion.includes('Ajustar'));
check('la ubicación y lo que falta confirmar, en ámbar', fa.propias[2].includes('EJE 12') &&
      fa.propias[3].includes('arm-tag--warning') && fa.propias[3].includes('2 por confirmar'));
check('todo confirmado: sólo el número, sin etiqueta', T.asignacionDe(barras[1]) === '<span class="mat-linea">1 confirmadas</span>');
check('sin saldo (esperando que producción confirme): apagada', T.filaHoja(barras[2], true).attrs.includes('mat-apagada'));
check('toda la fila abre la ventana (no sólo el botón)', fa.attrs.includes('data-asignar="1"') && fa.attrs.includes('mat-clic')
      && !f.attrs.includes('data-asignar'));
check('a mano: el origen dice «A mano» (el motivo ya dice «Inventario»)', T.filaHoja(barras[1]).propias[1].includes('A mano'));
check('la tabla sale de la hoja estándar', sandbox.HojaBarras.tabla({ accion: { titulo: '', ancho: 150 },
      propias: [{ titulo: 'Motivo', ancho: 104 }], texto: { titulo: 'Detalle' }, filas: [f] }).includes('hojab'));

console.log('Figuras por cantidad de lados');
const I = T.ING;
const figs = [{ nombre: 'Recta', lados: [1] }, { nombre: '26', lados: [1, 2, 3, 4, 5] }, { nombre: 'X38', lados: [1, 2, 3, 4, 5, 6, 7, 8] }];
I.nLados = ''; I.figBuscar = '';
check('todas', figs.filter(T.figuraPasa).length === 3);
I.nLados = '5';
check('justo 5 lados: el soporte 26', figs.filter(T.figuraPasa).map(x => x.nombre).join() === '26');
I.nLados = '7';
check('«7+» son las de 7 o más', figs.filter(T.figuraPasa).map(x => x.nombre).join() === 'X38');
I.nLados = ''; I.figBuscar = '26';
check('por código', figs.filter(T.figuraPasa).map(x => x.nombre).join() === '26');
I.figBuscar = '';

console.log('Ingresar desde aSa, por pasos');
const ccs = [{ cc: 'SVOD', descr: 'FUND + ELEV PARTE 1 C13', estado: 'Open', kg: 10523, fecha: '2026-11-20', cubicador: 'Nlopez' },
             { cc: 'SU6F', descr: 'ELEV P1 Z1', estado: 'Shipped', kg: 8033, fecha: '2026-10-01', cubicador: 'Nlopez' }];
I.ccEstado = ''; I.ccFiltro = '';
check('los CC de la obra, todos (también los despachados: de ahí vienen las devoluciones)', ccs.filter(T.ccPasa).length === 2);
I.ccEstado = 'Shipped';
check('por estado', ccs.filter(T.ccPasa).map(c => c.cc).join() === 'SU6F');
I.ccEstado = ''; I.ccFiltro = 'fund';
check('por texto, en el código o la descripción', ccs.filter(T.ccPasa).map(c => c.cc).join() === 'SVOD');
I.ccFiltro = '';
check('cada CC es una fila que se elige con un clic', T.filaCc(ccs[0]).includes('data-cc="SVOD"') && T.filaCc(ccs[0]).includes('mat-clic'));
const itC = { item_key: 55, marca: '16mmA2', diam: '16mm', figura: '26', dims: { B: 160 }, angulos: [], cant: 40, kg: 86.8,
              estado_asa: 'Shipped', elemento: 'EJE 1' };
I.sel = {};
let fi = T.filaItem(itC);
check('cada ítem con su check y su cantidad, que parte en la del ítem', fi.check.includes('data-sel="55"') && !fi.check.includes('checked')
      && fi.propias[0].includes('data-cant="55"') && fi.propias[0].includes('value="40"') && fi.propias[0].includes('max="40"'));
I.sel = { 55: 12 };
fi = T.filaItem(itC);
check('elegido: marcado y con la cantidad que se puso (una devolución incompleta)', fi.check.includes('checked')
      && fi.propias[0].includes('value="12"') && fi.attrs.includes('bueno'));
I.sel = {};

console.log('Ingresar: la línea de pasos dice lo elegido');
const P = [['obra', 'Obra'], ['cc', 'CC'], ['items', 'Ítems'], ['datos', 'Datos']];
I.obra = { id: '2013218', label: 'PL - EDIFICIO OPERA' }; I.cc = 'SVXV'; I.items = [{ obra: 'OTRA' }]; I.sel = { 7: 2, 8: 1 };
check('en Datos: la obra, el CC y cuántos ítems', T.etiquetaPaso(P[0], 0, 3) === 'Obra: PL - EDIFICIO OPERA'
      && T.etiquetaPaso(P[1], 1, 3) === 'CC: SVXV' && T.etiquetaPaso(P[2], 2, 3) === 'Ítems (2)' && T.etiquetaPaso(P[3], 3, 3) === 'Datos');
check('en el paso CC todavía no hay CC que mostrar', T.etiquetaPaso(P[1], 1, 1) === 'CC');
I.obra = null;
check('con «Tengo el CC» la obra sale de los ítems', T.etiquetaPaso(P[0], 0, 2) === 'Obra: OTRA');
I.items = []; I.sel = {}; I.cc = '';
check('sin nada elegido, sólo el nombre del paso', T.etiquetaPaso(P[0], 0, 0) === 'Obra');

console.log('El fondo cierra la ventana sólo si el clic empezó ahí');
function modalFalso() {
  const h = {};
  return { addEventListener: (ev, f) => { h[ev] = f; }, disparar: (ev, target) => h[ev]({ target }) };
}
let cerrada = 0;
const mf = modalFalso();
T.fondoCierra(mf, () => { cerrada++; });
mf.disparar('mousedown', 'opcion-de-la-lista'); mf.disparar('click', mf);
check('elegir de la lista y soltar sobre el fondo NO cierra (el bug del 26-nov)', cerrada === 0);
mf.disparar('mousedown', mf); mf.disparar('click', mf);
check('un clic que empieza y termina en el fondo sí cierra', cerrada === 1);

console.log('La ventana de la barra: qué hacer');
check('tal cual', V.queHacer({ piezas: 1, cortes: [] }) === 'Tal cual');
check('cortar una pata', V.queHacer({ piezas: 1, cortes: [['B', 50]] }) === 'Cortar B 5 cm');
check('una recta larga da varias', V.queHacer({ piezas: 2, cortes: [['A', 400]] }) === '2 por barra · sobran 40 cm');
check('...y si no sobra nada, no lo dice', V.queHacer({ piezas: 3, cortes: [['A', 0]] }) === '3 por barra');

console.log('La ventana de la barra: repartir el saldo');
const AS = V.AS;
AS.barra = { id: 20, marca: '8mmA84', diam_mm: 8, figura: null, dims: { A: 2000 }, eje: null, cant_disponible: 100,
             cant_inicial: 154, kg_disponible: 79, estado: 'disponible', motivo: 'mal_fabricada', motivo_txt: 'Mal fabricada' };
AS.asignaciones = [];
AS.coin = [
  { item_key: 1, cc: 'SU6S', marca: '8mmA375', estado_asa: 'Open', obra: 'OBRA A', tipo: 'igual', cortes: [], piezas: 1,
    cant_item: 98, kg_item: 77, ya_asignado: 0, falta: 98, tope_barras: 98, dims: { A: 2000 }, ubicacion: 'Losa PL-151 - 01' },
  { item_key: 2, cc: 'SVH8', marca: '8mmA40', estado_asa: 'Processed', obra: 'OBRA B', tipo: 'corte', cortes: [['A', 100]],
    piezas: 1, cant_item: 44, kg_item: 33, ya_asignado: 10, falta: 34, tope_barras: 34, dims: { A: 1900 }, ubicacion: '' },
  { item_key: 3, cc: 'SVYI', marca: '8mmA33', estado_asa: 'Open', obra: 'OBRA C', tipo: 'igual', cortes: [], piezas: 1,
    cant_item: 40, kg_item: 30, ya_asignado: 40, falta: 0, tope_barras: 0, dims: { A: 2000 }, ubicacion: '' }
];
AS.sel = {};
V.marcar('1', true);
check('al marcar se propone lo que le falta al ítem, sin pasar el saldo: 98 de 100', AS.sel['1'] === 98);
V.marcar('2', true);
check('el siguiente, sólo lo que queda: 2', AS.sel['2'] === 2 && V.usado() === 100);
V.marcar('2', false);
check('desmarcar devuelve el saldo', AS.sel['2'] === undefined && V.usado() === 98);
AS.sel = { 1: 60, 2: 34 };
check('60 + 34 de 100: se puede, quedan 6 para después', V.problema() === '' && V.usado() === 94);
AS.sel = { 1: 70, 2: 34 };
check('70 + 34 pasa el saldo, y lo dice', V.problema() === 'Pasas el saldo por 4 barras.');
AS.sel = { 2: 40 };
check('más de lo que le falta a un ítem, y lo dice', V.problema() === 'A 8mmA40 le alcanzan 34 barras.');
AS.sel = { 1: 60, 2: 34 };
check('lo que se manda: clave, barras, y la marca y el CC para los avisos',
      JSON.stringify(V.cuerpoAsignar()) === JSON.stringify({ items: [{ item_key: 1, cantidad: 60, marca: '8mmA375', cc: 'SU6S' },
                                                                     { item_key: 2, cantidad: 34, marca: '8mmA40', cc: 'SVH8' }] }));
const f1 = V.filaCoin(AS.coin[0]);
check('cada coincidencia: check, cuántas barras (tope = lo que alcanza), calce y dónde va',
      f1.check.includes('data-sel="1"') && f1.check.includes('checked') && f1.propias[1].includes('data-cant="1"')
      && f1.propias[1].includes('max="98"') && f1.propias[1].includes('value="60"') && f1.propias[0].includes('Igual')
      && f1.elemento === 'Losa PL-151 - 01' && f1.texto.includes('SU6S') && f1.barra.cant === 98);
check('con algo ya asignado (desde cualquier barra) dice cuánto falta', V.filaCoin(AS.coin[1]).texto.includes('faltan 34'));
const f3 = V.filaCoin(AS.coin[2]);
check('un ítem ya cubierto: sin check ni campo', f3.check === '' && f3.propias[1].includes('Cubierto'));
check('mientras busca, avisa que puede tardar', (AS.buscando = true) && V.textoCoin().includes('hasta un minuto'));
AS.buscando = false;

console.log('La ventana de la barra: la última búsqueda queda guardada');
const guardada = AS.coin.map(c => Object.assign({}, c));
AS.coin = null; AS.buscadoEl = null; AS.sel = { 1: 10, 3: 5 };
V.ponerDetalle({ barra: AS.barra, asignaciones: [], coincidencias: guardada, buscado_el: '2026-11-26T13:15:00+00:00' });
check('al abrir, la última búsqueda con su hora (no hay que volver a buscar)',
      AS.coin.length === 3 && AS.buscadoEl === '2026-11-26T13:15:00+00:00' && V.textoCoin().startsWith('Buscado '));
check('lo elegido que ya no tiene tope se suelta; lo demás queda', AS.sel['1'] === 10 && AS.sel['3'] === undefined);
V.ponerDetalle({ barra: AS.barra, asignaciones: [], coincidencias: null, buscado_el: null });
check('una barra que nunca se buscó: sin lista, con el botón «Buscar coincidencias»', AS.coin === null && V.textoCoin() === '');
AS.buscando = true; AS.coin = guardada;
V.ponerDetalle({ barra: AS.barra, asignaciones: [], coincidencias: null, buscado_el: null });
check('mientras busca, una respuesta del detalle no pisa la búsqueda en curso', AS.coin === guardada);
AS.buscando = false; AS.sel = {};

console.log('La ventana de la barra: lo asignado');
const pend = { id: 9, item_key: 1, cc: 'SU6S', marca: '8mmA375', estado_asa: 'Open', obra: 'OBRA A', dims: { A: 2000 },
               cant_barras: 60, cant_piezas: 60, kg: 47, ubicacion: 'Losa PL-151 - 01', asignado_nombre: 'Ana Pérez',
               asignado_el: '2026-11-25T19:00:00+00:00', producido_el: null };
const fp = V.filaAsignada(pend);
check('por confirmar: se puede quitar, y el check de producción está sin marcar',
      fp.accion.includes('data-quitar="9"') && fp.propias[1].includes('data-prod="9"') && !fp.propias[1].includes('checked')
      && fp.propias[1].includes('Por confirmar') && fp.propias[0] === '60');
const fh = V.filaAsignada(Object.assign({}, pend, { producido_el: '2026-11-25T20:05:00+00:00', producido_nombre: 'Juan Soto' }));
check('producida: ya no se quita, y dice quién la confirmó', fh.accion === '' && fh.propias[1].includes('checked')
      && fh.propias[1].includes('Juan Soto'));
check('editar: saldo, ubicación y nota', V.editorHtml(AS.barra, 'editar').includes('data-campo="cantidad"')
      && V.editorHtml(AS.barra, 'editar').includes('data-campo="ubicacion"'));
check('dar de baja pide el porqué', V.editorHtml(AS.barra, 'baja').includes('data-campo="motivo"')
      && V.editorHtml(AS.barra, 'baja').includes('Dar de baja'));

console.log('Resumen');
const fr = T.filaResumen({ barra_marca: '8mmA84', diam_mm: 8, barra_figura: null, barra_dims: { A: 2000 }, eje: null,
                           referencias: [], largo_mm: 2000, cant_barras: 10, kg: 7.9, ubicacion: 'Losa PL-151 - 01',
                           motivo: 'mal_fabricada', motivo_txt: 'Mal fabricada', cc: 'SU6S', marca: '8mmA375',
                           producido_nombre: 'Juan Soto', producido_el: '2026-11-25T20:05:00+00:00', obra: 'OBRA A' });
check('la barra de la que salió, las barras usadas y los kilos, para qué ítem y quién confirmó',
      fr.barra.marca === '8mmA84' && fr.barra.cant === 10 && fr.barra.peso === 7.9 && fr.propias[1].includes('SU6S')
      && fr.propias[1].includes('8mmA375') && fr.propias[2].includes('Juan Soto') && fr.elemento === 'Losa PL-151 - 01');
check('la hora en local, día-mes hora:minuto', T.fechaHora(new Date(2026, 10, 25, 6, 5).toISOString()) === '25-11 06:05');


console.log(fallos ? '\nFALLOS: ' + fallos : '\nTodo OK');
process.exit(fallos ? 1 : 0);
