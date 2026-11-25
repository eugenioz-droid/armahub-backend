// TEST DEL FRONT DE «MATERIAL DISPONIBLE» (25-nov, SPECS §15) — ejecuta el archivo de verdad.
//
// Lo que se decide en el servidor (permisos, cantidades, la forma de los lados) se prueba en
// tests/test_material.py. Acá lo que vive en el navegador: los filtros de la lista, los
// indicadores, cómo va cada barra a la hoja estándar (lados en cm, sin columnas de ángulos) y
// el filtro de figuras por cantidad de lados.
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

const sandbox = { console, document: { getElementById: () => null }, setTimeout, clearTimeout,
                  audBarraNormalizada: (b) => b, audCeldaFigura: (f) => '<svg data-fig="' + (f.figura || 'recta') + '"></svg>' };
sandbox.window = sandbox;
vm.createContext(sandbox);
const raiz = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features');
vm.runInContext(fs.readFileSync(path.join(raiz, 'auditorias', 'hoja_barras.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(raiz, 'material', 'index.js'), 'utf8'), sandbox);
const T = sandbox.__materialTest;
check('el archivo carga y expone su API', !!T && typeof sandbox.loadMaterial === 'function'
      && typeof sandbox.loadMaterialModule === 'function');

const barras = [
  { id: 1, estado: 'disponible', motivo: 'devolucion', motivo_txt: 'Devolución', diam_mm: 10, cc: 'ST47', origen: 'asa',
    obra: 'DLP - EDIFICIO TALCA 2 SUR', marca: '10mmA1433', figura: 'T1', dims: { A: 120, B: 1220 }, angulos: [-135, -90],
    referencias: [], cant_disponible: 20, kg_disponible: 31.7, creado_el: '2026-11-25T10:00:00+00:00', largo_mm: 2540 },
  { id: 2, estado: 'disponible', motivo: 'inventario', motivo_txt: 'Inventario', diam_mm: 12, origen: 'mano',
    figura: null, dims: { A: 6000 }, angulos: [], referencias: [], cant_disponible: 12, kg_disponible: 63.9,
    creado_el: '2026-10-30T10:00:00+00:00', largo_mm: 6000, ubicacion: 'Patio 1' },
  { id: 3, estado: 'descartada', motivo: 'sobrante', motivo_txt: 'Sobrante', diam_mm: 25, origen: 'mano',
    figura: '9', dims: { B: 6000 }, angulos: [], referencias: [['R', 4000]], cant_disponible: 2, kg_disponible: 46,
    creado_el: '2026-11-02T10:00:00+00:00', largo_mm: 6000, descarte_motivo: 'oxidada' }
];

console.log('Filtros');
const M = T.MAT;
M.estado = 'disponible'; M.motivo = ''; M.diam = ''; M.buscar = '';
check('por omisión, sólo las disponibles', barras.filter(T.pasa).map(b => b.id).join() === '1,2');
M.estado = '';
check('«Todas» incluye las descartadas', barras.filter(T.pasa).length === 3);
M.motivo = 'devolucion';
check('por motivo', barras.filter(T.pasa).map(b => b.id).join() === '1');
M.motivo = ''; M.diam = '12';
check('por φ', barras.filter(T.pasa).map(b => b.id).join() === '2');
M.diam = ''; M.buscar = 'talca';
check('la búsqueda mira la obra', barras.filter(T.pasa).map(b => b.id).join() === '1');
M.buscar = 'recta';
check('...y una barra sin figura se encuentra como «recta»', barras.filter(T.pasa).map(b => b.id).join() === '2');
M.buscar = ''; M.estado = 'disponible';

console.log('Indicadores');
const r = T.resumen(barras, new Date('2026-11-25T12:00:00Z').getTime());
check('barras disponibles = piezas disponibles (no filas), sin las descartadas', r.barras === 32);
check('kilos disponibles, sin las descartadas', Math.abs(r.kg - 95.6) < 0.01);
check('ingresadas este mes, todas las filas del mes', r.mes === 2);

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
      f.propias[0].includes('arm-tag--info') && f.propias[0].includes('Devolución') && f.propias[1].includes('ST47'));
check('acciones: Ajustar y Descartar', f.accion.includes('data-ajustar="1"') && f.accion.includes('data-descartar="1"'));
const fd = T.filaHoja(barras[2]);
check('descartada: sin acciones, apagada y con el porqué', !fd.accion.includes('data-ajustar') &&
      fd.attrs.includes('mat-apagada') && fd.texto.includes('oxidada'));
check('a mano: el origen dice «A mano» (el motivo ya dice «Inventario»)', T.filaHoja(barras[1]).propias[1].includes('A mano'));
check('la tabla sale de la hoja estándar', sandbox.HojaBarras.tabla({ accion: { titulo: '', ancho: 150 },
      propias: [{ titulo: 'Motivo', ancho: 104 }], texto: { titulo: 'Detalle' }, filas: [f] }).includes('hojab'));

console.log('Ajustar y descartar');
check('ajustar: cantidad, ubicación y nota, con Guardar', T.editorHtml(barras[1], 'ajustar').includes('data-campo="cantidad"')
      && T.editorHtml(barras[1], 'ajustar').includes('value="Patio 1"') && T.editorHtml(barras[1], 'ajustar').includes('Guardar'));
check('descartar pide el porqué', T.editorHtml(barras[0], 'descartar').includes('data-campo="motivo"'));

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

console.log('Coincidencias');
check('tal cual', T.queHacer({ piezas: 1, cortes: [] }) === 'Tal cual');
check('cortar una pata', T.queHacer({ piezas: 1, cortes: [['B', 50]] }) === 'Cortar B 5 cm');
check('una recta larga da varias', T.queHacer({ piezas: 2, cortes: [['A', 400]] }) === '2 por barra · sobran 40 cm');
check('...y si no sobra nada, no lo dice', T.queHacer({ piezas: 3, cortes: [['A', 0]] }) === '3 por barra');
const coin = [
  { id: 1, barra_id: 7, item_key: 100, tipo: 'igual', estado_asa: 'Open', cc: 'SUWJ', obra: 'CRCC - KIMAL SUB ESTACIÓN',
    marca: '16mmA2', figura: '26', diam_mm: 16, dims: { B: 160, C: 420 }, cortes: [], piezas: 1, cubre: 10, cant_item: 523,
    kg_ahorro: 21.7, ubicacion: 'Rack 3', barra_marca: null, origen: 'mano' },
  { id: 2, barra_id: 7, item_key: 101, tipo: 'igual', estado_asa: 'Open', cc: 'SU2B', obra: 'CRCC - KIMAL SUB ESTACIÓN',
    marca: '16mmA14', figura: '26', diam_mm: 16, dims: { B: 160 }, cortes: [], piezas: 1, cubre: 10, cant_item: 524,
    kg_ahorro: 21.7, ubicacion: 'Rack 3', origen: 'mano' },
  { id: 3, barra_id: 9, item_key: 100, tipo: 'corte', estado_asa: 'Processed', cc: 'SVRV', obra: 'DLP - EDIFICIO TALCA 2 SUR',
    marca: '16mmA482', figura: null, diam_mm: 16, dims: { A: 5500 }, cortes: [['A', 500]], piezas: 1, cubre: 12,
    cant_item: 12, kg_ahorro: 104.2, barra_marca: '16mmA9', origen: 'asa' }
];
const C = T.COIN;
C.tipo = ''; C.estado = ''; C.buscar = '';
check('todas, por omisión', coin.filter(T.coinPasa).length === 3);
C.tipo = 'corte';
check('sólo con corte', coin.filter(T.coinPasa).map(c => c.id).join() === '3');
C.tipo = ''; C.estado = 'Open';
check('sólo Open', coin.filter(T.coinPasa).map(c => c.id).join() === '1,2');
C.estado = ''; C.buscar = 'kimal';
check('la búsqueda mira la obra', coin.filter(T.coinPasa).length === 2);
C.buscar = '';
const rc = T.resumenCoin(coin);
check('ítems distintos (el mismo ítem en dos barras cuenta una vez)', rc.items === 2);
check('kilos a recuperar: una coincidencia por barra, la que más ahorra', Math.abs(rc.kg - (21.7 + 104.2)) < 0.01 && rc.barras === 2);
const fc = T.filaCoin(coin[2]);
check('fila: tipo, qué hacer, la barra disponible y el CC con su estado',
      fc.propias[0].includes('Con corte') && fc.propias[1].includes('Cortar A 50 cm')
      && fc.propias[2].includes('16mmA9') && fc.propias[3].includes('SVRV') && fc.propias[3].includes('Processed'));
check('cant = lo que cubre, peso = los kilos que se ahorran, sin columnas de ángulos',
      fc.barra.cant === 12 && fc.barra.peso === 104.2 && fc.barra.angulos.length === 0 && fc.barra.figura === 'Recta');
check('una barra a mano dice «A mano» y su ubicación', T.filaCoin(coin[0]).propias[2].includes('A mano')
      && T.filaCoin(coin[0]).propias[2].includes('Rack 3'));
check('buscando', T.textoBusqueda({ en_curso: true }, false) === 'Buscando en aSa…' && T.textoBusqueda(null, true) === 'Buscando en aSa…');
check('nunca buscado', T.textoBusqueda(null, false) === 'Todavía sin buscar');
check('la hora en local, día-mes hora:minuto', T.fechaHora(new Date(2026, 10, 25, 6, 5).toISOString()) === '25-11 06:05'
      && T.textoBusqueda({ ok: true, fin: new Date(2026, 10, 25, 6, 5).toISOString() }, false) === 'Buscado 25-11 06:05');
check('falló, con el motivo', T.textoBusqueda({ ok: false, detalle: 'HTTP 429' }, false).includes('HTTP 429'));


console.log(fallos ? '\nFALLOS: ' + fallos : '\nTodo OK');
process.exit(fallos ? 1 : 0);
