// TABLERO «POR AÑO» DE RECLAMOS — ejecuta el JS de verdad, no lo lee.
//
// POR QUÉ ASÍ. Este tablero junta cinco años de data que viene de dos mundos: lo cargado
// de planillas viejas y lo que se lleva hoy. Y ahora además se filtra: por año, servicio,
// cubicador, segmento, tipo y si aplica. Los errores que importan no se ven mirando el
// código. Un filtro que no filtra, un total que no suma, un cubicador partido en dos
// porque en una planilla venía con nombre de pila. Así que se carga el archivo en un
// sandbox, se le da data con la forma real del endpoint y se revisa lo que escribe.
//
// Correr con: node tests/test_rec_historico.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
function check(nombre, cond) {
  console.log((cond ? '  OK  ' : '  XX  ') + nombre);
  if (!cond) fallos++;
}

// ── DOM mínimo que RECUERDA lo escrito, que es lo que hay que revisar ──
const nodos = {};
function nodo(id) {
  if (!nodos[id]) {
    nodos[id] = {
      id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {},
      value: '', disabled: false, title: '', children: [],
      addEventListener() {}, appendChild() {}, querySelectorAll() { return []; },
      querySelector() { return null; },
    };
  }
  return nodos[id];
}

let graficos = [];
const cabeceraMes = { children: Array.from({ length: 14 }, () => ({ textContent: '' })) };
const sandbox = {
  console, window: {}, ChartDataLabels: {},
  Chart: function (ctx, cfg) { this.cfg = cfg; this.destroy = function () {}; graficos.push({ ctx, cfg }); },
  document: {
    getElementById: (id) => nodo(id),
    querySelectorAll: () => [],
    querySelector: (sel) => (sel === '#rhMatrizMes thead tr' ? cabeceraMes : null),
  },
  setTimeout, clearTimeout,
};
sandbox.Chart.defaults = { plugins: {} };

// EL CUBO, con la forma real del endpoint: una fila por combinación distinta. Dos años,
// los dos servicios, tres cubicadores, y un «no aplica» para comprobar que queda fuera.
const DATOS = [
  { anio: 2025, mes: 1, cubicador: 'Gerardo Mendoza', servicio: 'Interno', segmento: '4 y 5', tipo: 'error', aplica: 'si', analisis: 'validado', causa: 'Error al digitar', historico: true, n: 10, kilos: 500, con_kilos: 6 },
  { anio: 2025, mes: 3, cubicador: 'Mario Puyo', servicio: 'Externo', segmento: '4 y 5', tipo: 'faltante', aplica: 'si', analisis: 'sin_causa', causa: null, historico: true, n: 7, kilos: 0, con_kilos: 0 },
  { anio: 2025, mes: 3, cubicador: 'Mario Puyo', servicio: 'Externo', segmento: '1 y 2', tipo: 'error', aplica: 'no', analisis: 'sin_causa', causa: null, historico: true, n: 4, kilos: 900, con_kilos: 4 },
  { anio: 2024, mes: 6, cubicador: 'Gerardo Mendoza', servicio: 'Interno', segmento: '1 y 2', tipo: 'error', aplica: 'si', analisis: 'por_validar', causa: 'No revisa lo ingresado', historico: true, n: 5, kilos: 200, con_kilos: 2 },
  { anio: 2024, mes: 6, cubicador: 'Sin asignar', servicio: '(sin dato)', segmento: '(sin segmento)', tipo: 'atraso', aplica: 'pendiente', analisis: 'sin_causa', causa: null, historico: true, n: 3, kilos: 0, con_kilos: 0 },
];

sandbox.apiGet = async function (ruta) {
  sandbox.__ultimaRuta = ruta;
  return { datos: JSON.parse(JSON.stringify(DATOS)), anio_en_curso: 2026,
           internos: ['Gerardo Mendoza', 'Daniel Venegas'] };
};

const codigo = fs.readFileSync(
  path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'reclamos', 'dashboards.js'), 'utf8');
vm.createContext(sandbox);
try { vm.runInContext(codigo, sandbox); } catch (e) { /* carga parcial, basta */ }

console.log('TEST: tablero «Por año» de reclamos');

console.log('\n1. El sub-tab existe y está registrado');
check('hay un tercer sub-tab y apunta a su panel',
  sandbox.DASH_SUBTABS && sandbox.DASH_SUBTABS.historico
  && sandbox.DASH_SUBTABS.historico.panel === 'dashSubHist');

(async function () {
  await sandbox.loadDashHistorico();
  check('pide /reclamos/historico', sandbox.__ultimaRuta === '/reclamos/historico');

  console.log('\n2. Lo que NO aplica sale de los números, pero se puede encender');
  // El usuario: «los no aplica debieran visibilizarse pero salir de la data».
  check('arranca dejando fuera el «no aplica»',
    sandbox.RH_F.aplica.indexOf('no') < 0 && sandbox.RH_F.aplica.indexOf('si') >= 0);
  check('...así que los 4 que no aplican no se cuentan',
    sandbox.rhFilas().reduce((a, f) => a + f.n, 0) === 25);
  check('...y el resumen dice cuántos quedaron fuera',
    nodo('rhResumen').innerHTML.indexOf('4 fuera por los filtros') > 0);
  sandbox.RH_F.aplica.push('no');
  check('encendiéndolo entran los 29', sandbox.rhFilas().reduce((a, f) => a + f.n, 0) === 29);
  sandbox.RH_F.aplica = ['si', 'pendiente'];

  console.log('\n3. El filtro de servicio separa internos de externos');
  // Hace falta porque la mitad del equipo es externa y mezclarlos no deja comparar.
  sandbox.RH_F.servicio.push('Interno');
  check('sólo internos: 15 reclamos', sandbox.rhFilas().reduce((a, f) => a + f.n, 0) === 15);
  sandbox.RH_F.servicio = ['Externo'];
  check('sólo externos: 7 (el no-aplica sigue fuera)',
    sandbox.rhFilas().reduce((a, f) => a + f.n, 0) === 7);
  sandbox.RH_F.servicio = [];

  console.log('\n4. El filtro de cubicador, que es el que saca el ruido');
  sandbox.RH_F.cubicador.push('Gerardo Mendoza');
  check('un cubicador: 15 en dos años', sandbox.rhFilas().reduce((a, f) => a + f.n, 0) === 15);
  sandbox.RH_F.anio.push(2024);
  check('...y con el año, 5', sandbox.rhFilas().reduce((a, f) => a + f.n, 0) === 5);
  check('los filtros se combinan con Y, no con O', sandbox.rhFilas().length === 1);
  sandbox.RH_F.cubicador = []; sandbox.RH_F.anio = [];

  console.log('\n5. Los cuadros se REARMAN con el filtro, no sólo la lista');
  graficos = [];
  sandbox.RH_F.cubicador.push('Mario Puyo');
  sandbox.rhPintarTodo();
  check('se redibujan los dos gráficos', graficos.length === 2);
  var g = graficos[0].cfg;
  check('...y sólo queda el año en que ese cubicador tuvo algo',
    g.data.labels.length === 2 && String(g.data.labels[1][1]) === '7');
  check('la matriz por cubicador queda con una sola fila',
    (nodo('rhMatrizCub').innerHTML.match(/<tr><td title=/g) || []).length === 1);
  sandbox.RH_F.cubicador = [];
  sandbox.rhPintarTodo();

  console.log('\n6. El gráfico por año: aplica, y el resto se maneja con filtros');
  // Las demás dimensiones NO van como series: meterlas llenaría el gráfico de barras y
  // seguiría sin poder cruzar dos cosas a la vez. Para eso están los filtros.
  g = graficos[graficos.length - 2].cfg;
  check('tres series: aplican, no aplican y por revisar',
    g.data.datasets.length === 3
    && g.data.datasets[0].label === 'Aplican al área'
    && g.data.datasets[2].label === 'Por revisar');
  check('...sin apilar, que no deja comparar', !(g.options.scales.x && g.options.scales.x.stacked));
  check('el total del año va en la etiqueta del eje', String(g.data.labels[0][1]) === '8');
  check('el número sobre la barra es el real', g.options.plugins.datalabels.formatter(142) === '142');
  check('...y el cero no se dibuja', g.options.plugins.datalabels.formatter(0) === '');

  console.log('\n6b. La barra de filtros va en DOS líneas, no en seis grupos sueltos');
  // Dejados a su aire, cada grupo se parte donde le toca y la barra queda escalonada.
  var fb = nodo('rhFiltros').innerHTML;
  check('son exactamente dos filas', (fb.match(/class="rhfrow"/g) || []).length === 2);
  check('arriba los cortos: año, servicio, aplica y segmento',
    fb.indexOf('Año') < fb.indexOf('Cubicador') && fb.indexOf('Aplica') < fb.indexOf('Cubicador'));
  check('abajo los dos largos, que son los que piden el ancho entero',
    fb.lastIndexOf('rhfrow') < fb.indexOf('Cubicador'));
  check('cada botón lleva su cuenta adentro', fb.indexOf('<i>') > 0);

  console.log('\n7. En kilos se dice CUÁNTOS reclamos componen la barra');
  // Sin eso, un año con pocos kilos se lee como un buen año, cuando puede ser que no se
  // valorizaron.
  var k = graficos[graficos.length - 1].cfg;
  check('la etiqueta dice cuántos están valorizados',
    String(k.data.labels[0][1]).indexOf(' de ') > 0);

  console.log('\n8. Las matrices suman y ordenan bien');
  var cub = nodo('rhMatrizCub').innerHTML;
  check('un cubicador con dos años sale en UNA fila',
    (cub.match(/<tr><td title="Gerardo Mendoza"/g) || []).length === 1);
  check('...con su total sumado (10 + 5)', cub.indexOf('<b>15</b>') > 0);
  check('la fila más grande va primero', cub.indexOf('Gerardo') < cub.indexOf('Mario'));
  check('los años sin dato llevan un punto, no un cero falso', cub.indexOf('class="cero">·<') > 0);
  var mes = nodo('rhMatrizMes').innerHTML;
  check('los meses quedan con nombre', cabeceraMes.children[1].textContent === 'Ene');
  check('...y los años en orden cronológico', mes.indexOf('>2024<') < mes.indexOf('>2025<'));

  console.log('\n9. Cuánto falta por catalogar');
  var cob = nodo('rhMatrizCausa').innerHTML;
  // Lo que no aplica no necesita causa: meterlo al denominador haría ver un atraso falso.
  check('se separan los validados de los que esperan validación',
    cob.indexOf('Por validar') > 0 && cob.indexOf('Falta catalogar') > 0);
  check('2025 muestra sus 10 validados', cob.indexOf('>10<') > 0);
  var top = nodo('rhTopCausas').innerHTML;
  check('las causas más repetidas salen con su cuenta', top.indexOf('Error al digitar') > 0);

  console.log('\n10. Los tipos se muestran en castellano');
  check('«error» se lee «Error de cubicación»',
    nodo('rhMatrizTipo').innerHTML.indexOf('Error de cubicación') > 0);

  console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
