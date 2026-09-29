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

// ── 7. Sub-tab «Obras aSa» ─────────────────────────────────────────────────
// Tres cuadros de consulta sobre la misma data: kilos por mes, kilos por obra (con
// barra y orden por encabezado) y el detalle código por código con buscador. Lo que
// tiene que cuadrar siempre es que los tres sumen lo mismo — si un resumen no cuadra
// con el detalle que tiene al lado, el reporte entero deja de ser creíble.
console.log('\n7. Obras aSa: los tres cuadros cuadran entre sí');
const filas = [
  { cc: 'A1', job: '2010', obra: 'OBRA UNO', descr: 'ELEV P1', persona: 'ana', mes: 1, kg: 100 },
  { cc: 'A2', job: '2010', obra: 'OBRA UNO', descr: 'FUND C2', persona: 'ana', mes: 1, kg: 250 },
  { cc: 'B1', job: '2011', obra: 'OBRA DOS', descr: 'ELEV P3', persona: 'luis', mes: 2, kg: 400 },
  { cc: 'B2', job: '2011', obra: 'OBRA DOS', descr: 'LOSA',    persona: 'luis', mes: 3, kg: 50 },
];
const TOTAL = 800;

const porMes = {};
filas.forEach(f => { porMes[f.mes] = (porMes[f.mes] || 0) + f.kg; });
check('el resumen por mes suma el total',
      Object.values(porMes).reduce((a, b) => a + b, 0) === TOTAL);
check('...y agrupa bien (enero = 350)', porMes[1] === 350);

const porObra = {};
filas.forEach(f => {
  if (!porObra[f.obra]) porObra[f.obra] = { obra: f.obra, kg: 0, cc: 0 };
  porObra[f.obra].kg += f.kg; porObra[f.obra].cc++;
});
const obras = Object.values(porObra);
check('el resumen por obra suma el MISMO total',
      obras.reduce((a, o) => a + o.kg, 0) === TOTAL);
check('...y cuenta los códigos de cada obra', obras.every(o => o.cc === 2));
check('los dos resúmenes cuadran entre sí',
      obras.reduce((a, o) => a + o.kg, 0) === Object.values(porMes).reduce((a, b) => a + b, 0));

// La barra se mide contra el MÁXIMO, no contra el total: con cuarenta obras, medirla
// contra el total dejaría todas en un hilo y no compararía nada.
const tope = Math.max(...obras.map(o => o.kg));
check('la barra se mide contra el máximo, no contra el total', tope === 450);
check('...así la mayor llega al 100% y ninguna se pasa',
      obras.every(o => o.kg / tope <= 1) && obras.some(o => o.kg / tope === 1));

// Orden por encabezado: segundo clic invierte; columna nueva arranca como se espera
// (números de mayor a menor, texto de la A a la Z).
const ordenar = (lista, col, desc) => [...lista].sort((a, b) => {
  const d = desc ? -1 : 1, x = a[col], y = b[col];
  return typeof x === 'string' ? d * x.localeCompare(y, 'es') : d * (x - y);
});
check('por kilos descendente deja arriba la obra más grande',
      ordenar(obras, 'kg', true)[0].obra === 'OBRA DOS');
check('por kilos ascendente, la más chica', ordenar(obras, 'kg', false)[0].obra === 'OBRA UNO');
check('por nombre ordena alfabético', ordenar(obras, 'obra', false)[0].obra === 'OBRA DOS');
check('el orden por defecto es kilos, de mayor a menor',
      T.orden().col === 'kg' && T.orden().desc === true);

// El buscador mira la descripción Y el código: buscar «elev» no puede traerlo todo.
const buscar = q => filas.filter(f =>
  (f.descr || '').toLowerCase().includes(q) || (f.cc || '').toLowerCase().includes(q));
check('el buscador filtra por descripción', buscar('elev').length === 2);
check('...y también por código', buscar('b1').length === 1);
check('...y sin texto no filtra nada', buscar('').length === filas.length);

// ── 8. Cómo se comportan TODOS los filtros ─────────────────────────────────
// Antes el clic era aditivo y había que acordarse de desmarcar lo anterior. El caso
// normal es mirar una cosa a la vez, así que: clic deja sólo ése, Ctrl+clic suma, y
// clic sobre el único elegido lo suelta. Vale igual para meses, personas y obras — un
// filtro que se comporta distinto según dónde esté es peor que cualquiera de las dos.
console.log('\n8. Los filtros: clic = sólo ése, Ctrl+clic = sumar');
const CLIC = {};
const CTRL = { ctrlKey: true };
check('clic sobre nada elegido deja sólo ése',
      JSON.stringify(T.alternar([], 'a', CLIC)) === '["a"]');
check('clic sobre otro REEMPLAZA, no suma',
      JSON.stringify(T.alternar(['a'], 'b', CLIC)) === '["b"]');
check('clic sobre el único elegido lo suelta (vuelven todos)',
      JSON.stringify(T.alternar(['a'], 'a', CLIC)) === '[]');
check('Ctrl+clic suma sin tocar el resto',
      JSON.stringify(T.alternar(['a'], 'b', CTRL)) === '["a","b"]');
check('Ctrl+clic sobre uno elegido lo quita',
      JSON.stringify(T.alternar(['a', 'b'], 'a', CTRL)) === '["b"]');
check('con varios elegidos, el clic simple deja sólo el tocado',
      JSON.stringify(T.alternar(['a', 'b', 'c'], 'b', CLIC)) === '["b"]');
check('Cmd+clic (Mac) hace lo mismo que Ctrl',
      JSON.stringify(T.alternar(['a'], 'b', { metaKey: true })) === '["a","b"]');

// ── 9. Los tres estados de «Programado Cubicador» ──────────────────────────
// Que sean EXCLUYENTES y sumen el total es lo que hace que la tabla sea creíble: si un
// código pudiera contarse en dos columnas, los totales no cuadrarían con ningún otro
// reporte y no habría forma de saber cuál miente.
console.log('\n9. Programado Cubicador: tres estados excluyentes');
const casos = [
  { n: 'despachado', f: { estado: 'Shipped', programado: true }, esp: 'de' },
  { n: 'despachado aunque aSa no lo tenga agendado',
    f: { estado: 'Shipped', programado: false }, esp: 'de' },
  { n: 'agendado y sin despachar = en camino',
    f: { estado: 'Open', programado: true }, esp: 'pr' },
  { n: 'en producción y agendado = en camino',
    f: { estado: 'Processed', programado: true }, esp: 'pr' },
  { n: 'sin agendar = stock', f: { estado: 'Open', programado: false }, esp: 'st' },
  { n: 'en producción sin agendar = stock (la rareza de aSa)',
    f: { estado: 'Processed', programado: false }, esp: 'st' },
];
casos.forEach(c => check(c.n + ' -> ' + c.esp, T.claseDe(c.f) === c.esp));
check('todo código cae en exactamente uno de los tres',
      casos.every(c => ['st', 'pr', 'de'].includes(T.claseDe(c.f))));

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exit(fallos ? 1 : 0);
