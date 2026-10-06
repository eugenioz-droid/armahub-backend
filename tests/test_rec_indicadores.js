// INDICADORES DE RECLAMOS — ejecuta el JS de verdad, no lo lee.
//
// POR QUÉ ASÍ. Este tablero divide: reclamos entre toneladas, kilos malos entre kilos
// cubicados. Una división mal hecha no se ve en el código y se ve perfectamente en una
// reunión, cuando alguien pregunta por qué un cubicador que casi no cubicó aparece como el
// mejor. Así que se le da data con la forma real del endpoint y se revisan los números.
//
// Correr con: node tests/test_rec_indicadores.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
function check(nombre, cond) {
  console.log((cond ? '  OK  ' : '  XX  ') + nombre);
  if (!cond) fallos++;
}

const nodos = {};
function nodo(id) {
  if (!nodos[id]) {
    nodos[id] = {
      id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, value: '',
      disabled: false, children: [],
      addEventListener() {}, appendChild() {}, querySelectorAll() { return []; }, querySelector() { return null; },
    };
  }
  return nodos[id];
}
let graficos = [];
const sandbox = {
  console, window: {}, ChartDataLabels: {},
  Chart: function (ctx, cfg) { this.cfg = cfg; this.destroy = function () {}; graficos.push({ ctx, cfg }); },
  document: { getElementById: (id) => nodo(id), querySelectorAll: () => [], querySelector: () => null },
  setTimeout, clearTimeout,
};
sandbox.Chart.defaults = { plugins: {} };

// DOS CUBICADORES, dos obras, dos años con base y uno sin ella. Los números están
// elegidos para que las divisiones den redondo y se puedan comprobar a mano:
//   Gerardo: 10.000 ton, 20 reclamos  -> 2,0 por 1.000 ton
//   Mario:    1.000 ton,  5 reclamos  -> 5,0 por 1.000 ton  (menos reclamos, PEOR tasa)
const BASE = [
  { anio: 2025, persona: 'Gerardo Mendoza', conocido: true, servicio: 'Interno', segmento: '4 y 5', obra_id: 'A', obra: 'Obra A', cc: 100, ton: 6000 },
  { anio: 2024, persona: 'Gerardo Mendoza', conocido: true, servicio: 'Interno', segmento: '4 y 5', obra_id: 'B', obra: 'Obra B', cc: 80, ton: 4000 },
  { anio: 2025, persona: 'Mario Puyo', conocido: true, servicio: 'Externo', segmento: '1 y 2', obra_id: 'C', obra: 'Obra C', cc: 20, ton: 1000 },
  { anio: 2022, persona: 'Mario Puyo', conocido: true, servicio: 'Externo', segmento: '1 y 2', obra_id: 'C', obra: 'Obra C', cc: 5, ton: 100 },
  { anio: 2025, persona: 'Oortega', conocido: false, servicio: 'Externo', segmento: '4 y 5', obra_id: 'A', obra: 'Obra A', cc: 3, ton: 50 },
];
const RECLAMOS = [
  { anio: 2025, persona: 'Gerardo Mendoza', obra_id: 'A', obra: 'Obra A', segmento: '4 y 5', aplica: 'si', servicio: 'Interno', n: 15, kilos: 3000 },
  { anio: 2024, persona: 'Gerardo Mendoza', obra_id: 'B', obra: 'Obra B', segmento: '4 y 5', aplica: 'si', servicio: 'Interno', n: 5, kilos: 1000 },
  { anio: 2025, persona: 'Gerardo Mendoza', obra_id: 'A', obra: 'Obra A', segmento: '4 y 5', aplica: 'no', servicio: 'Interno', n: 7, kilos: 700 },
  { anio: 2025, persona: 'Mario Puyo', obra_id: 'C', obra: 'Obra C', segmento: '1 y 2', aplica: 'si', servicio: 'Externo', n: 5, kilos: 2000 },
  { anio: 2022, persona: 'Mario Puyo', obra_id: 'C', obra: 'Obra C', segmento: '1 y 2', aplica: 'si', servicio: 'Externo', n: 40, kilos: 100 },
  // Un cubicador INVENTADO sin base en aSa. Con nombre de mentira a propósito: una
  // fixture con una persona real en un año en que no trabajó se lee como un dato, y no
  // lo es.
  { anio: 2025, persona: 'Cubicador Sin Base', obra_id: null, obra: 'Obra vieja', segmento: 'Otros', aplica: 'si', servicio: 'Externo', n: 3, kilos: 0 },
];
sandbox.apiGet = async function (ruta) {
  sandbox.__ultimaRuta = ruta;
  return { base: JSON.parse(JSON.stringify(BASE)), reclamos: JSON.parse(JSON.stringify(RECLAMOS)),
           anio_en_curso: 2026, anios_sin_base: [2021, 2022] };
};

const codigo = fs.readFileSync(
  path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'reclamos', 'dashboards.js'), 'utf8');
vm.createContext(sandbox);
try { vm.runInContext(codigo, sandbox); } catch (e) { /* carga parcial, basta */ }

console.log('TEST: indicadores de reclamos contra lo cubicado');

console.log('\n1. El sub-tab existe');
check('está registrado con su panel', sandbox.DASH_SUBTABS && sandbox.DASH_SUBTABS.indicadores
  && sandbox.DASH_SUBTABS.indicadores.panel === 'dashSubInd');

(async function () {
  await sandbox.loadDashIndicadores();
  check('pide /reclamos/indicadores', sandbox.__ultimaRuta === '/reclamos/indicadores');

  console.log('\n2. La tasa divide bien y deja fuera lo que no corresponde');
  const kp = nodo('inKpis').innerHTML;
  // 28 reclamos que aplican (Gerardo 15+5, Mario 5, Pantoja 3) sobre 11.050 ton con
  // base (6000+4000+1000+50). Los 7 que no aplican NO cuentan: no son errores de
  // cubicación. Los 40 de 2022 tampoco: ese año no tiene base y meterlos inflaría la
  // tasa cuatro veces.
  check('reclamos por 1.000 ton = 28 / 11,05 = 2,5', kp.indexOf('>2,5<') > 0);
  check('...y el detalle dice sobre qué se calculó', kp.indexOf('28 reclamos sobre 11.050 ton') > 0);
  // Pantoja no tiene obra en aSa pero su reclamo es de 2025, un año con base: ES un
  // error de ese período y cuenta en el numerador. Lo que no tiene es tasa propia.
  check('un reclamo sin obra en aSa igual cuenta en el período', kp.indexOf('28 reclamos') > 0);

  console.log('\n3. Por cubicador: la TASA, no el conteo, es la que ordena');
  const tc = nodo('inCubicadores').innerHTML;
  // Mario tiene 5 reclamos contra 20 de Gerardo, pero sobre 1.000 ton: 5,0 contra 2,0.
  check('Mario (5,0) queda ANTES que Gerardo (2,0) aunque tenga menos reclamos',
    tc.indexOf('Mario Puyo') < tc.indexOf('Gerardo Mendoza'));
  check('la tasa de Gerardo es 2,0', /Gerardo Mendoza[\s\S]*?>2,0</.test(tc));
  check('la tasa de Mario es 5,0', /Mario Puyo[\s\S]*?>5,0</.test(tc));
  check('quien está sobre el promedio se marca en rojo', /Mario Puyo[\s\S]*?class="peor"/.test(tc));
  check('quien está bajo el promedio, en verde', /Gerardo Mendoza[\s\S]*?class="mejor"/.test(tc));
  check('quien no tiene base en aSa no tiene tasa, y lo dice',
    /Cubicador Sin Base[\s\S]*?sin base/.test(tc));
  check('...y va al final, no mezclado con los que sí', tc.indexOf('Cubicador Sin Base') > tc.indexOf('Gerardo Mendoza'));
  check('se dice si es interno o externo', tc.indexOf('<td>Interno</td>') > 0 && tc.indexOf('<td>Externo</td>') > 0);

  console.log('\n4. Los filtros recalculan todo');
  sandbox.IN_F.cubicador = ['Mario Puyo'];
  sandbox.inPintarTodo();
  check('filtrando a Mario la tasa pasa a 5,0', nodo('inKpis').innerHTML.indexOf('>5,0<') > 0);
  sandbox.IN_F.cubicador = [];
  sandbox.IN_F.anio = [2024];
  sandbox.inPintarTodo();
  check('filtrando 2024: 5 reclamos sobre 4.000 ton = 1,3', nodo('inKpis').innerHTML.indexOf('>1,3<') > 0);
  sandbox.IN_F.anio = [2022];
  sandbox.inPintarTodo();
  check('un año sin base no inventa una tasa',
    nodo('inLectura').innerHTML.indexOf('no se puede calcular') > 0);
  sandbox.IN_F.anio = [];
  sandbox.inPintarTodo();

  console.log('\n5. El Pareto de obras dice dónde está el esfuerzo');
  const po = nodo('inObras').innerHTML;
  check('la obra con más reclamos va primero', po.indexOf('Obra A') < po.indexOf('Obra B'));
  check('...con su porcentaje y el acumulado', po.indexOf('%</td>') > 0);
  check('y la lectura dice en cuántas obras está la mitad',
    nodo('inLectura').innerHTML.indexOf('la mitad de los reclamos') > 0);

  console.log('\n6. El gráfico por año y los filtros de la barra');
  const g = graficos[graficos.length - 1].cfg;
  check('el año sin base no lleva barra, pero sí etiqueta que lo dice',
    g.data.labels.some(function (l) { return String(l[1]) === 'sin base en aSa'; }));
  const fb = nodo('inFiltros').innerHTML;
  check('los filtros son los mismos de programación', (fb.match(/class="dshbarra"/g) || []).length === 2);
  check('el servicio ofrece dos opciones, interno y externo', (fb.match(/data-v="(Interno|Externo)"/g) || []).length === 2);
  check('en cubicador sólo se ofrecen los que tienen base en aSa',
    fb.indexOf('Gerardo Mendoza') > 0 && fb.indexOf('Cubicador Sin Base') < 0 && fb.indexOf('Oortega') < 0);

  console.log('\n7. Interno contra externo: la pregunta del usuario, contestada con el dato');
  // Con la fixture: interno = 20 reclamos / 10.000 ton = 2,0; externo = 8 (Mario 5 +
  // Sin Base 3) / 1.050 ton (Mario 1.000 + Oortega 50) = 7,6. Los 40 de Mario en 2022
  // no entran: ese año no tiene base.
  var ts = nodo('inServicioTabla').innerHTML;
  check('la tasa de cada servicio está bien dividida',
    /Reclamos por 1\.000 ton<\/td><td class="mejor">2,0<\/td><td class="peor">7,6<\/td>/.test(ts));
  check('el peor en cada medida va en rojo y el otro en verde',
    (ts.match(/class="peor"/g) || []).length >= 2 && (ts.match(/class="mejor"/g) || []).length >= 2);
  // Las medidas no van todas para el mismo lado en la fixture: externo pierde en tasa y
  // en kilos, interno pierde en reclamos por obra y en % de obras con reclamo. La
  // lectura TIENE que decirlo así, en vez de forzar una conclusión.
  check('la lectura no fuerza una conclusión cuando las medidas no van parejas',
    nodo('inServicioLectura').innerHTML.indexOf('No es parejo') >= 0
    && nodo('inServicioLectura').innerHTML.indexOf('<b>2</b>') >= 0);
  // El filtro de servicio no se aplica a este cuadro: existe para comparar los dos.
  sandbox.IN_F.servicio = ['Interno'];
  sandbox.inPintarTodo();
  check('filtrar por un servicio no vacía la comparación',
    nodo('inServicioTabla').innerHTML.indexOf('7,6') > 0 && nodo('inServicioTabla').innerHTML.indexOf('2,0') > 0);
  sandbox.IN_F.servicio = [];
  sandbox.inPintarTodo();
  var gs = graficos.filter(function (x) { return x.ctx && x.ctx.id === 'inChartServicio'; }).pop().cfg;
  check('el gráfico por año lleva una serie por servicio', gs.data.datasets.length === 2
    && gs.data.datasets[0].label === 'Interno' && gs.data.datasets[1].label === 'Externo');
  check('...y el año sin base queda en cero con su aviso',
    gs.data.labels.some(function (l) { return String(l[1]) === 'sin base en aSa'; }));

  console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
