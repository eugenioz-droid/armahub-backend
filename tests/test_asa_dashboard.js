// TEST DEL DASHBOARD DE aSa — ejecuta el JS de verdad, no lo lee.
//
// POR QUÉ EXISTE. Cuatro bugs de este archivo llegaron a producción y NINGUNO era
// detectable mirando el texto del código:
//
//   · `anio=` vacío en la primera carga → 422 de FastAPI.
//   · el 422 mostrado como «[object Object]».
//   · los conteos de los botones contaban el año entero en vez de lo filtrado.
//   · `.filter(visiblePorEstado)` → filter entrega TRES argumentos y el índice entraba
//     como nombre de caja; `OCULTOS[1]` es undefined y reventaba en el 2º elemento.
//
// El último es el que obligó a escribir esto: un test de strings lo habría dado por
// bueno. Acá se carga el archivo en un sandbox con un DOM mínimo y se LLAMAN las
// funciones con datos reales de aSa.
//
// Correr con: node tests/test_asa_dashboard.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
function check(nombre, cond) {
  console.log((cond ? '  OK  ' : '  XX  ') + nombre);
  if (!cond) fallos++;
}

// ── DOM mínimo. Sólo lo que el archivo toca al cargarse; las funciones que se prueban
//    son puras y no lo usan. ────────────────────────────────────────────────────────
function nodoFalso() {
  const n = {
    innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, disabled: false,
    value: '', checked: false, title: '',
    addEventListener() {}, appendChild() {}, querySelectorAll() { return []; },
  };
  return n;
}
const sandbox = {
  console,
  document: { getElementById: () => nodoFalso(), querySelectorAll: () => [] },
  localStorage: { getItem: () => null, setItem() {} },
  fetch: () => Promise.reject(new Error('sin red en el test')),
  setTimeout, clearTimeout,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
const ruta = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features',
                       'programacion', 'dashboards.js');
vm.runInContext(fs.readFileSync(ruta, 'utf8'), sandbox, { filename: ruta });

const T = sandbox.__asaDataTest;
console.log('TEST: dashboard de aSa (ejecutado, no leído)');

check('el archivo carga y expone sus reglas para probarlas', !!T);
if (!T) { console.log('\nFALLOS: 1'); process.exit(1); }

// ── 1. En qué caja cae cada fila ────────────────────────────────────────────
// La regla la decide el BACKEND y viaja en `programado`. El front no la recalcula: si lo
// hiciera, habría dos verdades. Sale del estado de planta de aSa (Scheduled/Confirmed),
// no de una fecha — se llegó ahí tras dos correcciones.
console.log('\n1. En qué caja cae cada fila');
check('programado=true va a PROGRAMADOS', T.programado({ programado: true }) === true);
check('programado=false va al STOCK', T.programado({ programado: false }) === false);
check('sin el campo, al stock (no se adivina)', T.programado({}) === false);
check('tener fecha NO basta: manda lo que dijo el backend',
      T.programado({ promesa: '2026-10-14', programado: false }) === false);
check('cajaDe traduce a pg / pp',
      T.cajaDe({ programado: true }) === 'pg' && T.cajaDe({ programado: false }) === 'pp');

// ── 2. EL BUG: pasar la función a .filter() ─────────────────────────────────
// filter entrega (elemento, índice, arreglo). Una función con segundo parámetro recibía
// el índice como nombre de caja y reventaba desde el SEGUNDO elemento — por eso la
// primera fila se veía bien y la pantalla igual quedaba vacía.
console.log('\n2. Las funciones que se pasan a .filter() aguantan sus tres argumentos');
T.ocultos({ pp: ['Shipped'], pg: ['Shipped'] });
const muchas = [];
for (let i = 0; i < 5; i++) {
  muchas.push({ cc: 'C' + i, estado: i % 2 ? 'Shipped' : 'Open', programado: i > 2, kg: 10 });
}
let exploto = null;
let visibles = [];
try { visibles = muchas.filter(T.visible); } catch (e) { exploto = e; }
check('.filter(visible) no revienta con más de un elemento', exploto === null);
check('...y filtra de verdad: quedan los que no están ocultos',
      visibles.length === 3 && visibles.every(f => f.estado !== 'Shipped'));
exploto = null;
let solopg = [];
try { solopg = muchas.filter(T.visibleEn.bind(null, 'pg')); } catch (e) { exploto = e; }
check('.filter(visibleEn.bind(...)) tampoco', exploto === null);
check('...y mira la caja que se le pidió, no la de cada fila', solopg.length === 3);

// ── 3. Cada caja con su propia lista de ocultos ─────────────────────────────
console.log('\n3. Las dos cajas no se pisan');
T.ocultos({ pp: [], pg: ['Shipped'] });
const unoPp = { estado: 'Shipped', programado: false };
const unoPg = { estado: 'Shipped', programado: true };
check('apagar un estado en PROGRAMADOS no lo apaga en el stock',
      T.visible(unoPp) === true && T.visible(unoPg) === false);
T.ocultos({ pp: ['Shipped'], pg: [] });
check('y al revés', T.visible(unoPp) === false && T.visible(unoPg) === true);

// ── 4. Separar las dos cajas ────────────────────────────────────────────────
console.log('\n4. conFecha / sinFecha');
const lote = [
  { cc: 'A', programado: true }, { cc: 'B', programado: false },
  { cc: 'C', programado: true }, { cc: 'D', programado: false },
];
check('conFecha se queda con los programados', T.conFecha(lote).length === 2);
check('sinFecha con el stock', T.sinFecha(lote).length === 2);
check('juntas cubren todo, sin repetir ni perder',
      T.conFecha(lote).length + T.sinFecha(lote).length === lote.length);

// ── 5. La URL: el 422 de la primera carga ───────────────────────────────────
// FastAPI no convierte "" a entero. En la primera carga el año todavía no se conoce.
console.log('\n5. qs() nunca manda un parámetro vacío');
check('sin nada, no hay query string', T.qs({ anio: null, meses: [] }) === '');
check('el año vacío no viaja', T.qs({ anio: '', meses: [8] }) === '?meses=8');
check('undefined tampoco', T.qs({ anio: undefined, meses: [] }) === '');
check('un arreglo vacío tampoco', T.qs({ meses: [] }) === '');
check('lo que sí tiene valor viaja', T.qs({ anio: 2026, meses: [8, 9] }) === '?anio=2026&meses=8%2C9');
check('el cero NO se confunde con vacío', T.qs({ anio: 0 }) === '?anio=0');

// ── 6. Formatos que pidió el usuario ────────────────────────────────────────
console.log('\n6. Los formatos pedidos');
check('la fecha comprometida se muestra dd/mm', T.ddmm('2026-10-14') === '14/10');
check('...también con hora pegada', T.ddmm('2026-08-24T00:00:00') === '24/08');
check('...y una fecha vacía no imprime nada', T.ddmm(null) === '' && T.ddmm('') === '');
check('los kilos con coma decimal y dos decimales', /1[.,]234[.,]56/.test(T.kg(1234.56)));
check('cero es 0,00 y no queda en blanco', /^0[.,]00$/.test(T.kg(0)));
check('un kg nulo no rompe', T.kg(null) !== undefined && T.kg(undefined) !== undefined);

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exit(fallos ? 1 : 0);
