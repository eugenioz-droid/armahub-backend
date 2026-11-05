// CONTROL AUDITORÍAS (4-nov) — ejecuta el dibujante de verdad, con data con la forma del
// endpoint, y revisa lo que escribe: el mapa de calor ordenado por peso, la lectura con su
// denominador, los dos gráficos y el cambio de fuente.
//
// Correr con: node tests/test_control_auditorias.js
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
    nodos[id] = { id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, title: '',
                  addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; } };
  }
  return nodos[id];
}
const graficos = [];
const sandbox = {
  console, window: {}, ChartDataLabels: {},
  Chart: function (ctx, cfg) { this.cfg = cfg; this.destroy = function () {}; graficos.push({ ctx, cfg }); },
  document: { getElementById: (id) => nodo(id), querySelectorAll: () => [], querySelector: () => null },
  currentRole: 'admin', setTimeout, clearTimeout,
};
sandbox.Chart.defaults = { plugins: {} };
const DATA = {
  desde: '2026-01-01',
  fuentes: {
    barras: { titulo: 'Revisión de barras', unidad: 'barras', columna: 'regla',
      series: { no_aplica: 'No aplica', resueltas: 'Resueltas', abiertas: 'Sin resolver' },
      semanas: [{ semana: '2026-10-26', detectadas: 10, no_aplica: 2, resueltas: 5, abiertas: 3 },
                { semana: '2026-11-02', detectadas: 4, no_aplica: 0, resueltas: 0, abiertas: 4 }],
      calor: [{ cub: 'Jvelasquez', col: 'lado_corto', n: 9 }, { cub: 'Nlopez', col: 'lado_corto', n: 1 },
              { cub: 'Nlopez', col: 'lados_opuestos', n: 4 }],
      columnas: { lado_corto: 'Lado corto', lados_opuestos: 'Lados opuestos' },
      cierre: [{ cub: 'Jvelasquez', n: 5, mediana: 0.4 }, { cub: 'Nlopez', n: 2, mediana: 3.1 }],
      cierre_total: { cub: 'total', n: 7, mediana: 1.5 } },
    elementos: { titulo: 'Revisión de elementos', unidad: 'hallazgos', columna: 'regla',
      series: { no_aplica: 'No aplica', resueltas: 'Resueltas', abiertas: 'Sin resolver' },
      semanas: [], calor: [], columnas: {}, cierre: [], cierre_total: { cub: 'total', n: 0, mediana: null } },
    auditorias: { titulo: 'Auditorías', unidad: 'elementos con hallazgo u observación', columna: 'causa',
      series: { no_aplica: 'Observaciones', resueltas: 'Corregidas', abiertas: 'Pendientes' },
      semanas: [{ semana: '2026-10-05', detectadas: 6, no_aplica: 1, resueltas: 2, abiertas: 3 }],
      calor: [{ cub: 'jrodriguez', col: 'Lectura de plano', n: 3 }], columnas: {},
      cierre: [{ cub: 'jrodriguez', n: 2, mediana: 2 }], cierre_total: { cub: 'total', n: 2, mediana: 2 } },
  },
};
sandbox.apiGet = async function (ruta) { sandbox.__ruta = ruta; return JSON.parse(JSON.stringify(DATA)); };
const codigo = fs.readFileSync(
  path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'reclamos', 'dashboards.js'), 'utf8');
vm.createContext(sandbox);
try { vm.runInContext(codigo, sandbox); } catch (e) { /* carga parcial, basta */ }

(async () => {
  check('el sub-tab está registrado con su panel y su botón',
    sandbox.DASH_SUBTABS && sandbox.DASH_SUBTABS.control && sandbox.DASH_SUBTABS.control.panel === 'dashSubCtrl');
  await sandbox.loadDashControl();
  check('pide /control-auditorias', sandbox.__ruta === '/control-auditorias');
  const lect = nodo('caLectura').innerHTML;
  check('la lectura lleva el denominador: 14 detectadas, 5 resueltas (36%), 2 no aplican, 7 sin resolver',
    lect.indexOf('<b>14</b> barras detectadas') !== -1 && lect.indexOf('<b>5</b> resueltas (36%)') !== -1
    && lect.indexOf('2 no aplica (14%)') !== -1 && lect.indexOf('<b style="color:#c62828">7</b> sin resolver (50%)') !== -1);
  const calor = nodo('caCalor').innerHTML;
  const posJ = calor.indexOf('Jvelasquez'), posN = calor.indexOf('Nlopez');
  check('el mapa pone primero a quien más tiene (Jvelasquez 9 antes que Nlopez 5)', posJ !== -1 && posN !== -1 && posJ < posN);
  const posLC = calor.indexOf('>Lado corto<'), posLO = calor.indexOf('>Lados opuestos<');
  check('...y las columnas por peso, con el nombre corto de la regla (Lado corto 10 antes que Lados opuestos 4)',
    posLC !== -1 && posLO !== -1 && posLC < posLO);
  check('la celda más cargada va oscura con el número adentro, y la vacía con un punto',
    /rgba\(229,57,53,0\.90\); color:#fff">9</.test(calor) && calor.indexOf('class="c cero">·<') !== -1);
  check('la fila de totales suma 14', calor.indexOf('<tfoot><tr><td>Total</td><td class="c">10</td><td class="c">4</td><td class="c">14</td>') !== -1);
  const emb = graficos.find(g => g.ctx.id === 'caEmbudo');
  check('el embudo es una barra apilada por semana con las tres series',
    emb && emb.cfg.type === 'bar' && emb.cfg.options.scales.x.stacked && emb.cfg.data.labels.join(',') === '26-10,02-11'
    && emb.cfg.data.datasets.map(d => d.label).join(',') === 'No aplica,Resueltas,Sin resolver'
    && emb.cfg.data.datasets[2].data.join(',') === '3,4');
  const cie = graficos.find(g => g.ctx.id === 'caCierre');
  check('los días hasta cerrar van en barras horizontales, el más lento arriba, y la mediana general en el subtítulo',
    cie && cie.cfg.options.indexAxis === 'y' && cie.cfg.data.labels.join(',') === 'Nlopez,Jvelasquez'
    && cie.cfg.data.datasets[0].data.join(',') === '3.1,0.4'
    && nodo('caCierreSub').textContent.indexOf('Mediana general: 1,5 día(s) sobre 7 cerradas') !== -1);
  // Cambio de fuente: auditorías cambia las palabras y la columna.
  sandbox.CA.fuente = 'auditorias'; sandbox.caPintar();
  check('en auditorías la columna es la causa y las series se llaman como corresponde',
    nodo('caColTit').textContent === 'causa' && nodo('caLectura').innerHTML.indexOf('observaciones') !== -1
    && nodo('caCalor').innerHTML.indexOf('Lectura de plano') !== -1
    && graficos.filter(g => g.ctx.id === 'caEmbudo').pop().cfg.data.datasets[1].label === 'Corregidas');
  sandbox.CA.fuente = 'elementos'; sandbox.caPintar();
  check('una fuente sin data lo dice en vez de dejar cajas vacías',
    nodo('caLectura').innerHTML.indexOf('no hay hallazgos detectadas') !== -1
    && nodo('caCalor').innerHTML.indexOf('Nada detectado') !== -1
    && nodo('caCierreSub').textContent.indexOf('Todavía no hay cierres') !== -1);
  console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.log('EXCEPCIÓN: ' + e.message + '\n' + e.stack.split('\n').slice(0, 4).join('\n')); process.exit(1); });
