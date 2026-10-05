// TABLERO «POR AÑO» DE RECLAMOS — ejecuta el JS de verdad, no lo lee.
//
// POR QUÉ ASÍ. Este tablero junta cinco años de data que viene de dos mundos: lo cargado
// de planillas viejas y lo que se lleva hoy en la plataforma. Los errores que importan
// acá no se ven mirando el código: un año que no aparece, un total que no suma, un
// cubicador partido en dos porque en una planilla venía con nombre de pila. Así que se
// carga el archivo en un sandbox, se le da data con la forma real del endpoint y se
// revisa lo que escribe en la pantalla.
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

// ── DOM mínimo que RECUERDA lo escrito, que es justamente lo que hay que revisar ──
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

const sandbox = {
  console,
  window: {},
  ChartDataLabels: {},
  Chart: function (ctx, cfg) { this.cfg = cfg; this.destroy = function () {}; graficos.push({ ctx, cfg }); },
  document: {
    getElementById: (id) => nodo(id),
    querySelectorAll: () => [],
    querySelector: (sel) => (sel === '#rhMatrizMes thead tr' ? cabeceraMes : null),
  },
  setTimeout, clearTimeout,
};
sandbox.Chart.defaults = { plugins: {} };
let graficos = [];
// La fila de encabezado de la matriz de meses: el código le cambia los números por
// nombres de mes, y hay que poder comprobarlo.
const cabeceraMes = { children: Array.from({ length: 14 }, () => ({ textContent: '' })) };

// Data con la FORMA REAL del endpoint, con los números que hoy tiene la base.
const DATA = {
  anio_en_curso: 2026,
  nota_kilos_2022: 'En 2022 no se tenían todos los kilos: se aplicó un estándar definido ese año.',
  anios: [
    { anio: 2022, total: 156, aplican: 142, no_aplican: 12, pendientes: 2, kilos: 48776, con_kilos: 156, con_causa: 0, en_curso: false },
    { anio: 2023, total: 104, aplican: 102, no_aplican: 2, pendientes: 0, kilos: 41286, con_kilos: 38, con_causa: 0, en_curso: false },
    { anio: 2024, total: 145, aplican: 124, no_aplican: 21, pendientes: 0, kilos: 53918, con_kilos: 66, con_causa: 17, en_curso: false },
    { anio: 2025, total: 106, aplican: 91, no_aplican: 15, pendientes: 0, kilos: 34135, con_kilos: 50, con_causa: 10, en_curso: false },
    { anio: 2026, total: 111, aplican: 57, no_aplican: 10, pendientes: 44, kilos: 25696, con_kilos: 30, con_causa: 55, en_curso: true },
  ],
  meses: [
    { anio: 2025, mes: 1, n: 8, kilos: 100 }, { anio: 2025, mes: 10, n: 20, kilos: 500 },
    { anio: 2022, mes: 1, n: 12, kilos: 0 },
  ],
  // El mismo cubicador por dos caminos: en las planillas viejas venía por nombre y hoy
  // llega por correo. El backend ya los resuelve al mismo nombre; si eso se rompiera,
  // la persona aparecería dos veces y nadie lo notaría mirando el gráfico.
  cubicadores: [
    { nombre: 'Gerardo Mendoza', anio: 2022, n: 21, kilos: 0 },
    { nombre: 'Gerardo Mendoza', anio: 2026, n: 21, kilos: 0 },
    { nombre: 'José Pantoja', anio: 2022, n: 65, kilos: 0 },
  ],
  segmentos: [
    { segmento: 'Edificación', anio: 2022, n: 145, kilos: 0 },
    { segmento: '(sin segmento)', anio: 2026, n: 111, kilos: 0 },
  ],
  tipos: [
    { tipo: 'error', anio: 2022, n: 81 }, { tipo: 'faltante', anio: 2022, n: 68 },
  ],
  causas: [
    { causa: 'Error al digitar o transcribir datos', categoria: 'mano_de_obra', n: 22 },
    { causa: 'No revisa información ingresada post ticket', categoria: 'mano_de_obra', n: 21 },
  ],
};

sandbox.apiGet = async function (ruta) {
  sandbox.__ultimaRuta = ruta;
  return DATA;
};

const codigo = fs.readFileSync(
  path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'reclamos', 'dashboards.js'), 'utf8');
vm.createContext(sandbox);
// El archivo entero toca cosas que acá no existen; lo que importa es que las funciones
// de este tablero queden definidas y se puedan llamar.
try { vm.runInContext(codigo, sandbox); } catch (e) { /* carga parcial, basta */ }

console.log('TEST: tablero «Por año» de reclamos');

console.log('\n1. El sub-tab existe y está registrado');
check('hay un tercer sub-tab y apunta a su panel',
  sandbox.DASH_SUBTABS && sandbox.DASH_SUBTABS.historico
  && sandbox.DASH_SUBTABS.historico.panel === 'dashSubHist');
check('...y tiene botón propio', sandbox.DASH_SUBTABS.historico.btn === 'dashSubBtnHist');

(async function () {
  console.log('\n2. Se pide la data al endpoint correcto y se dibuja');
  await sandbox.loadDashHistorico();
  check('pide /reclamos/historico', sandbox.__ultimaRuta === '/reclamos/historico');
  check('dibuja los dos gráficos', graficos.length === 2);

  console.log('\n3. El gráfico de reclamos separa lo que aplica de lo que no');
  const g = graficos[0].cfg;
  check('tres series: aplican, no aplican y por revisar', g.data.datasets.length === 3);
  check('...y NO están apiladas (apilar no deja comparar)',
    !(g.options.scales.x && g.options.scales.x.stacked));
  check('los cinco años entran', g.data.labels.length === 5);
  check('el total del año va en la etiqueta del eje', g.data.labels[0][1] === '156');
  check('el año en curso se avisa, para no leerlo como una caída',
    String(g.data.labels[4][0]).indexOf('en curso') > 0);
  check('el número sobre la barra es el real, no una escala',
    g.options.plugins.datalabels.formatter(142) === '142');
  check('...y el cero no se dibuja, que ensucia', g.options.plugins.datalabels.formatter(0) === '');

  console.log('\n4. En kilos se dice CUÁNTOS reclamos componen la barra');
  // Sin eso, un año con pocos kilos se lee como un buen año, cuando puede ser que no se
  // valorizaron. En 2023 sólo 38 de 104 traen kilos: la barra sola mentiría.
  const k = graficos[1].cfg;
  check('la etiqueta dice cuántos están valorizados',
    k.data.labels[1][1] === '38 de 104 valorizados');
  check('y el aviso de 2022 aparece', nodo('rhNotaKilos').style.display === ''
    && nodo('rhNotaKilos').textContent.indexOf('estándar') > 0);

  console.log('\n5. Las matrices suman y ordenan bien');
  const cub = nodo('rhMatrizCub').innerHTML;
  // El nombre aparece dos veces por fila (en el title y en la celda), así que lo que se
  // cuenta son FILAS, no apariciones del texto.
  check('un cubicador con dos años sale en UNA fila',
    (cub.match(/<tr><td title="Gerardo Mendoza"/g) || []).length === 1);
  check('...con su total sumado (21 + 21)', cub.indexOf('<b>42</b>') > 0);
  check('la fila más grande va primero (Pantoja 65 antes que Gerardo 42)',
    cub.indexOf('Pantoja') < cub.indexOf('Gerardo'));
  check('los años sin dato se marcan con un punto, no con un cero falso',
    cub.indexOf('class="cero">·<') > 0);
  check('el año en curso se marca también en la matriz', cub.indexOf('en curso') > 0);
  check('hay fila de totales', cub.indexOf('<tfoot>') > 0);

  const mes = nodo('rhMatrizMes').innerHTML;
  check('la matriz de meses pone los años en filas', mes.indexOf('>2022<') > 0 && mes.indexOf('>2025<') > 0);
  check('...en orden cronológico, no por tamaño', mes.indexOf('>2022<') < mes.indexOf('>2025<'));
  check('...y las columnas quedan con nombre de mes', cabeceraMes.children[1].textContent === 'Ene'
    && cabeceraMes.children[10].textContent === 'Oct');

  console.log('\n6. Cuánto falta por catalogar, que es el trabajo que viene');
  const cob = nodo('rhMatrizCausa').innerHTML;
  // Lo que no aplica no necesita causa: meterlo al denominador haría ver un atraso falso.
  check('2022 necesita 144 causas (156 menos los 12 que no aplican)', cob.indexOf('>144<') > 0);
  check('...y le faltan las 144, porque no tiene ninguna', (cob.match(/>144</g) || []).length >= 2);
  check('2024 muestra las 17 que ya tiene', cob.indexOf('>17<') > 0);

  const top = nodo('rhTopCausas').innerHTML;
  check('las causas más repetidas salen con su cuenta', top.indexOf('Error al digitar') > 0
    && top.indexOf('<b>22</b>') > 0);

  console.log('\n7. Los tipos se muestran en castellano, no con el valor crudo');
  const tip = nodo('rhMatrizTipo').innerHTML;
  check('«error» se lee «Error de cubicación»', tip.indexOf('Error de cubicación') > 0
    && tip.indexOf('>error<') < 0);

  console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
