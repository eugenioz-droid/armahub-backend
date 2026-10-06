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
  // Un login de aSa que NO es cubicador (administración): sus toneladas no entran a la
  // base ni a interno/externo; se dicen aparte.
  { anio: 2025, persona: 'Oortega', conocido: false, servicio: null, segmento: '4 y 5', obra_id: 'A', obra: 'Obra A', cc: 3, ton: 50 },
  // Un externo conocido sin reclamos, en 4 y 5: para que haya con qué comparar ahí.
  { anio: 2025, persona: 'Carlos Santos', conocido: true, servicio: 'Externo', segmento: '4 y 5', obra_id: 'D', obra: 'Obra D', cc: 10, ton: 500 },
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
  // 28 reclamos que aplican (Gerardo 15+5, Mario 5, Sin Base 3) sobre 11.500 ton con
  // base de CUBICADORES (6000+4000+1000+500; las 50 de Oortega no son de un cubicador).
  // Los 7 que no aplican NO cuentan: no son errores de cubicación. Los 40 de 2022
  // tampoco: ese año no tiene base y meterlos inflaría la tasa cuatro veces.
  check('reclamos por 1.000 ton = 28 / 11,5 = 2,4', kp.indexOf('>2,4<') > 0);
  check('...y el detalle dice sobre qué se calculó', kp.indexOf('28 reclamos sobre 11.500 ton') > 0);
  check('lo ingresado por quien no es cubicador queda fuera de la base, y se dice cuánto y quién',
    nodo('inBaseOtros').innerHTML.indexOf('Fuera de la base: <b>50 ton</b>') >= 0 && nodo('inBaseOtros').innerHTML.indexOf('Oortega') > 0
    && nodo('inCubicadores').innerHTML.indexOf('Oortega') < 0);
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
  // 2022 en la fixture: 40 reclamos y 100 ton parciales en aSa. No es un cero: la
  // etiqueta dice lo que hay y que por eso no hay tasa (el usuario leyó «0» en 2022).
  check('el año sin base no lleva barra, pero la etiqueta dice lo que hay y por qué no hay tasa',
    g.data.labels.some(function (l) { return String(l[1]) === '40 recl · aSa parcial: 100 ton · sin tasa'; }));
  // (2021 no está en la fixture: sin filas no hay etiqueta; se prueba la regla directo.)
  check('...y un año sin nada (2021) dice sólo que no hay base', sandbox.inEtiquetaSinBase(2021) === 'sin base en aSa');
  const fb = nodo('inFiltros').innerHTML;
  check('los filtros son los mismos de programación', (fb.match(/class="dshbarra"/g) || []).length === 2);
  check('el servicio ofrece dos opciones, interno y externo', (fb.match(/data-v="(Interno|Externo)"/g) || []).length === 2);
  check('en cubicador sólo se ofrecen los que tienen base en aSa',
    fb.indexOf('Gerardo Mendoza') > 0 && fb.indexOf('Cubicador Sin Base') < 0 && fb.indexOf('Oortega') < 0);

  console.log('\n7. Interno contra externo: la pregunta del usuario, contestada con el dato');
  // Con la fixture: interno = 20 reclamos / 10.000 ton = 2,0; externo = 8 (Mario 5 +
  // Sin Base 3) / 1.500 ton (Mario 1.000 + Carlos 500) = 5,3. Los 40 de Mario en 2022
  // no entran: ese año no tiene base. Y las 50 ton de Oortega tampoco: no es cubicador.
  var ts = nodo('inServicioTabla').innerHTML;
  check('la tasa de cada servicio está bien dividida',
    /Reclamos por 1\.000 ton<\/td><td class="mejor">2,0<\/td><td class="peor">5,3<\/td>/.test(ts));
  check('el peor en cada medida va en rojo y el otro en verde',
    (ts.match(/class="peor"/g) || []).length >= 2 && (ts.match(/class="mejor"/g) || []).length >= 2);
  // SIN FRASE DE CONCLUSIÓN (6-oct): el usuario la leyó como sesgo. Que hable la tabla.
  check('no hay frase de conclusión bajo la tabla: habla el dato',
    !nodos['inServicioLectura'] || nodo('inServicioLectura').innerHTML === '');
  // POR SEGMENTO (6-oct). En la fixture: 4 y 5 tiene interno 20 / 10.000 ton = 2,0 y
  // externo 0 / 50 ton (Oortega) = 0,0 → el interno sale peor ahí; 1 y 2 sólo tiene base
  // externa (Mario, 5,0): sin interno no hay con qué comparar y no se marca nada; YPS no
  // tiene nada y no aparece.
  check('debajo de las cuatro medidas va la tasa por segmento, con su subtítulo',
    ts.indexOf('Reclamos por 1.000 ton, por segmento') > 0 && ts.indexOf('Segmento 1 y 2') > 0 && ts.indexOf('Segmento 4 y 5') > 0);
  check('4 y 5: interno 2,0 (peor) contra externo 0,0 (Carlos, 500 ton sin reclamos)',
    /Segmento 4 y 5<\/td><td class="peor"[^>]*>2,0<\/td><td class="mejor" title="0 reclamos sobre 500 ton">0,0<\/td>/.test(ts));
  check('1 y 2: sólo hay base externa (5,0); sin con qué comparar no se marca peor ni mejor',
    /Segmento 1 y 2<\/td><td class=""[^>]*>·<\/td><td class=""[^>]*>5,0<\/td>/.test(ts));
  check('...cada celda dice sobre cuántos reclamos y toneladas se calculó',
    ts.indexOf('title="5 reclamos sobre 1.000 ton"') > 0);
  check('un segmento sin datos (YPS) no aparece', ts.indexOf('YPS') < 0);
  // Las filas por segmento no se vacían si arriba se filtró otro segmento: son un desglose fijo.
  sandbox.IN_F.segmento = ['1 y 2'];
  sandbox.inPintarTodo();
  check('filtrar por un segmento arriba no borra las filas por segmento',
    nodo('inServicioTabla').innerHTML.indexOf('Segmento 4 y 5') > 0);
  sandbox.IN_F.segmento = [];
  sandbox.inPintarTodo();
  // El filtro de servicio no se aplica a este cuadro: existe para comparar los dos.
  sandbox.IN_F.servicio = ['Interno'];
  sandbox.inPintarTodo();
  check('filtrar por un servicio no vacía la comparación',
    nodo('inServicioTabla').innerHTML.indexOf('5,3') > 0 && nodo('inServicioTabla').innerHTML.indexOf('2,0') > 0);
  sandbox.IN_F.servicio = [];
  sandbox.inPintarTodo();
  var gs = graficos.filter(function (x) { return x.ctx && x.ctx.id === 'inChartServicio'; }).pop().cfg;
  check('el gráfico por año lleva una serie por servicio', gs.data.datasets.length === 2
    && gs.data.datasets[0].label === 'Interno' && gs.data.datasets[1].label === 'Externo');
  check('...y el año sin base queda sin barra, con la misma etiqueta que explica por qué',
    gs.data.labels.some(function (l) { return String(l[1]).indexOf('sin tasa') > 0; }));

  console.log('\n8. Imprimir: el tablero en una hoja');
  var impreso = 0;
  sandbox.window.print = function () { impreso++; };
  sandbox.window.addEventListener = function () {}; sandbox.window.removeEventListener = function () {};
  sandbox.document.body = { classList: { add() {}, remove() {} } };
  sandbox.inImprimir();
  await new Promise(function (r) { setTimeout(r, 120); });
  check('el botón manda a imprimir (window.print) después de redibujar los gráficos', impreso === 1);
  var htmlInd = fs.readFileSync(path.join(__dirname, '..', 'armahub', 'templates', 'tabs', 'rec_dashboards.html'), 'utf8');
  check('hay botón Imprimir y una hoja A4 apaisada que muestra sólo el tablero',
    htmlInd.indexOf('id="inImprimir"') > 0 && htmlInd.indexOf('size: A4 landscape') > 0
    && htmlInd.indexOf('body.imprimiendo-indicadores #dashSubInd') > 0);

  console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
