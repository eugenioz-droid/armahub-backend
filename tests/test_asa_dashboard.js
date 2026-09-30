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

// Qué estados se pueden encender y apagar lo manda el backend. Acá se fija a mano lo
// mismo que manda en producción: sólo `Processed` y `Shipped`, que son los dos botones
// que pidió el usuario. Un estado sin botón se ve siempre — si se pudiera ocultar,
// quedaría escondido sin nada en pantalla para volver a encenderlo.
T.conBoton(['Processed', 'Shipped']);

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

check('un estado SIN botón se ve siempre, aunque esté en la lista de ocultos',
      (function () {
        T.conBoton(['Processed', 'Shipped']);
        T.ocultos({ pp: ['Open'], pg: ['Open'], cub: [] });
        return T.visible({ estado: 'Open', programado: false }) === true;
      })());
T.conBoton(['Processed', 'Shipped']);

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

// La clasificación en tres estados (stock / programado / despachado) ya NO vive acá:
// se mudó al SQL del endpoint `/programacion/asa/cubicador`, porque agregar por obra en
// Postgres son cientos de filas contra las 25.000 que habría que mandar al navegador.
// Que los tres sean excluyentes y sumen el total lo verifica scripts/smoke_programacion.py
// contra la base real, que es donde esa regla ahora existe.

// ── 9. La pivot de «Cubicado por mes» ──────────────────────────────────────
// Persona × período, con totales por fila y por columna. Es una función pura sobre las
// filas del reporte: si el número de la tabla no cuadra con el del gráfico, el bug está
// acá y se ve sin navegador.
console.log('\n9. Cubicado por mes: la pivot persona × período');
const FILAS = [
  { persona: 'ERAMIREZ', mes: 1, anio: 2026, kg: 100 },
  { persona: 'ERAMIREZ', mes: 1, anio: 2026, kg: 50 },
  { persona: 'ERAMIREZ', mes: 3, anio: 2026, kg: 10 },
  { persona: 'MDIAZ',    mes: 3, anio: 2025, kg: 200 },
  { persona: null,       mes: 2, anio: 2025, kg: 5 },
  { persona: 'MDIAZ',    mes: null, anio: null, kg: 999 },   // sin período: no entra
];
const P = T.pivotMes(FILAS, false);
check('las columnas son los meses presentes, ordenados',
      JSON.stringify(P.columnas) === '[1,2,3]');
check('dos filas de un mismo mes se suman en una celda',
      P.personas.filter(p => p.persona === 'ERAMIREZ')[0].celdas[1] === 150);
check('las personas van de mayor a menor total',
      P.personas.map(p => p.persona).join(',') === 'MDIAZ,ERAMIREZ,(sin detallar)');
check('sin persona no se pierde: va como «(sin detallar)»',
      P.personas.some(p => p.persona === '(sin detallar)' && p.total === 5));
check('el total de la columna es la suma de sus celdas',
      P.totCol[3] === 210 && P.totCol[1] === 150 && P.totCol[2] === 5);
check('el gran total es la suma de las filas y de las columnas',
      P.total === 365 &&
      P.personas.reduce((a, p) => a + p.total, 0) === 365 &&
      Object.values(P.totCol).reduce((a, v) => a + v, 0) === 365);
check('una fila sin período no entra en nada', P.total !== 365 + 999);
check('el máximo de celda es el que tiñe la tabla', P.max === 200);
const PA = T.pivotMes(FILAS, true);
check('por año, las columnas son los años',
      JSON.stringify(PA.columnas) === '[2025,2026]');
check('...y las celdas se agrupan por año',
      PA.personas.filter(p => p.persona === 'ERAMIREZ')[0].celdas[2026] === 160 &&
      PA.totCol[2025] === 205);
check('sin filas, una pivot vacía y no un error',
      T.pivotMes([], false).columnas.length === 0 && T.pivotMes([], false).total === 0);

// ── 10. El Resumen: lista de obras por estado y kilos por mes por segmento/tipo ──
// Dos funciones puras. Lo que se congela: la obra más grande va primero (la barra se
// mide contra ella), los kilos de cada obra se parten por estado y suman, y los pivots
// por segmento y por tipo cuadran con el total.
console.log('\n10. Resumen: obras por estado y kilos por mes por segmento/tipo');
const RF = [
  { obra: 'A', persona: 'ER', kg: 100, mes: 1, anio: 2026, segmento: '4 y 5', tipo: 'Cubicación', estado: 'Open',      programado: false },
  { obra: 'A', persona: 'ER', kg: 50,  mes: 2, anio: 2026, segmento: '4 y 5', tipo: 'Cubicación', estado: 'Processed', programado: true },
  { obra: 'A', persona: 'MD', kg: 25,  mes: 2, anio: 2026, segmento: '4 y 5', tipo: 'Cubicación', estado: 'Shipped',   programado: true },
  { obra: 'B', persona: 'MD', kg: 200, mes: 1, anio: 2025, segmento: '1 y 2', tipo: 'Digitación', estado: 'Shipped',   programado: true },
  { obra: 'C', persona: 'ER', kg: 10,  mes: 3, anio: 2026, segmento: null,    tipo: null,         estado: 'Open',      programado: false },
];
const R = T.resumenObras(RF);
check('una fila por obra, de mayor a menor', R.obras.map(o => o.obra).join(',') === 'B,A,C');
check('la primera es la más grande: la barra se mide contra ella', R.max === 200);
check('CC y kilos por obra', R.obras[1].cc === 3 && R.obras[1].kg === 175);
check('los kilos de cada obra se parten por estado y suman el total',
      R.obras[1].porEstado.Open === 100 && R.obras[1].porEstado.Processed === 50 &&
      R.obras[1].porEstado.Shipped === 25);
check('los estados salen en orden fijo (Open, Processed, Shipped) y sólo los presentes',
      R.estados.join(',') === 'Open,Processed,Shipped');
check('el total general y por estado', R.total === 385 && R.porEstado.Shipped === 225);
check('cada obra lleva su segmento y tipo («(sin)» si falta)',
      R.obras[2].segmento === '(sin)' && R.obras[0].tipo === 'Digitación');
// La matriz genérica: filas = lo que diga `clave`, en el orden dado (segmento, tipo) o
// de mayor a menor (cubicadores); columnas = meses o años; sólo kilos.
const MS = T.matriz(RF, T.segDe, ['1 y 2', '4 y 5', 'YPS', 'Otros', '(sin)'], false);
check('matriz por segmento: columnas presentes y filas en el orden del backend, sólo las presentes',
      JSON.stringify(MS.columnas) === '[1,2,3]' && MS.filas.map(r => r.clave).join(',') === '1 y 2,4 y 5,(sin)');
check('...celdas, totales por fila y por columna, total general y máximo',
      MS.filas[1].celdas[2] === 75 && MS.filas[0].celdas[1] === 200 && MS.filas[2].total === 10 &&
      MS.totCol[1] === 300 && MS.total === 385 && MS.max === 200);
const MT = T.matriz(RF, T.tipoDe, null, true);
check('sin orden, de mayor a menor; por año, columnas = años',
      JSON.stringify(MT.columnas) === '[2025,2026]' &&
      MT.filas.map(r => r.clave).join(',') === 'Digitación,Cubicación,(sin)' && MT.filas[1].celdas[2026] === 175);
check('pivotMes es la misma matriz con nombre de cubicador',
      T.pivotMes(RF, false).personas.map(p => p.persona).join(',') === 'MD,ER' && T.personaDe({}) === '(sin detallar)');
check('sin filas: vacío y sin error', T.resumenObras([]).obras.length === 0 && T.matriz([], T.segDe, null, false).total === 0);
check('segDe/tipoDe devuelven «(sin)» cuando falta el dato',
      T.segDe({}) === '(sin)' && T.tipoDe({ tipo: 'Digitación' }) === 'Digitación');

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exit(fallos ? 1 : 0);
