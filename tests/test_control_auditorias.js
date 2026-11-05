// CONTROL AUDITORÍAS (4-nov) — ejecuta el dibujante de verdad, con data con la forma del
// endpoint, y revisa lo que escribe: la lectura con su denominador, las tres barras por
// día, el mapa de calor ordenado por peso, los días hasta cerrar, el cambio de fuente y
// el filtro por cubicador.
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
const SER = { no_aplica: 'No aplica', resueltas: 'Resueltas', abiertas: 'Sin resolver' };
const DATA = {
  desde: '2026-01-01',
  fuentes: {
    barras: { titulo: 'Revisión de barras', unidad: 'barras', columna: 'regla', series: SER,
      dias: [{ dia: '2026-10-26', cub: 'Jvelasquez', detectadas: 7, no_aplica: 2, resueltas: 4, abiertas: 1 },
             { dia: '2026-10-26', cub: 'Nlopez', detectadas: 3, no_aplica: 0, resueltas: 1, abiertas: 2 },
             { dia: '2026-11-02', cub: 'Nlopez', detectadas: 4, no_aplica: 0, resueltas: 0, abiertas: 4 }],
      calor: [{ cub: 'Jvelasquez', col: 'lado_corto', n: 9 }, { cub: 'Nlopez', col: 'lado_corto', n: 1 },
              { cub: 'Nlopez', col: 'lados_opuestos', n: 4 }],
      columnas: { lado_corto: 'Lado corto', lados_opuestos: 'Lados opuestos' },
      cierre: [{ cub: 'Jvelasquez', n: 5, mediana: 0.4 }, { cub: 'Nlopez', n: 2, mediana: 3.1 }],
      cierre_total: { cub: 'total', n: 7, mediana: 1.5 } },
    elementos: { titulo: 'Revisión de elementos', unidad: 'hallazgos', columna: 'regla', series: SER,
      dias: [], calor: [], columnas: {}, cierre: [], cierre_total: { cub: 'total', n: 0, mediana: null } },
    auditorias: { titulo: 'Auditorías', unidad: 'elementos con hallazgo u observación', columna: 'causa',
      series: { no_aplica: 'Observaciones', resueltas: 'Corregidas', abiertas: 'Pendientes' },
      dias: [{ dia: '2026-10-05', cub: 'jrodriguez', detectadas: 6, no_aplica: 1, resueltas: 2, abiertas: 3 }],
      calor: [{ cub: 'jrodriguez', col: 'Lectura de plano', n: 3 }], columnas: {},
      cierre: [{ cub: 'jrodriguez', n: 2, mediana: 2 }], cierre_total: { cub: 'total', n: 2, mediana: 2 } },
  },
};
sandbox.apiGet = async function (ruta) { sandbox.__ruta = ruta; return JSON.parse(JSON.stringify(DATA)); };
const codigo = fs.readFileSync(
  path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'reclamos', 'dashboards.js'), 'utf8');
vm.createContext(sandbox);
try { vm.runInContext(codigo, sandbox); } catch (e) { /* carga parcial, basta */ }
const ultimo = id => graficos.filter(g => g.ctx.id === id).pop();

(async () => {
  check('el sub-tab está registrado con su panel y su botón',
    sandbox.DASH_SUBTABS && sandbox.DASH_SUBTABS.control && sandbox.DASH_SUBTABS.control.panel === 'dashSubCtrl');
  await sandbox.loadDashControl();
  check('pide /control-auditorias', sandbox.__ruta === '/control-auditorias');
  const lect = nodo('caLectura').innerHTML;
  check('la lectura lleva el denominador: 14 detectadas, 5 resueltas (36%), 2 no aplican, 7 sin resolver',
    lect.indexOf('<b>14</b> barras detectadas') !== -1 && lect.indexOf('<b>5</b> resueltas (36%)') !== -1
    && lect.indexOf('2 no aplica (14%)') !== -1 && lect.indexOf('<b class="mal">7</b> sin resolver (50%)') !== -1);
  const cubs = nodo('caCubs').innerHTML;
  check('el filtro por cubicador: «Todos» primero y después cada uno con su cuenta, el que más tiene antes',
    cubs.indexOf('data-cacub="" class="on">Todos') !== -1 && cubs.indexOf('Jvelasquez') < cubs.indexOf('Nlopez')
    && cubs.indexOf('Nlopez <small>7</small>') !== -1 && cubs.indexOf('Jvelasquez <small>7</small>') !== -1);
  const calor = nodo('caCalor').innerHTML;
  check('el mapa pone primero a quien más tiene (Jvelasquez 9 antes que Nlopez 5)',
    calor.indexOf('Jvelasquez') !== -1 && calor.indexOf('Jvelasquez') < calor.indexOf('Nlopez'));
  check('...y las columnas por peso, con el nombre corto de la regla', calor.indexOf('>Lado corto<') < calor.indexOf('>Lados opuestos<'));
  check('la celda más cargada va oscura con el número adentro, y la vacía con un punto',
    /rgba\(198,40,40,0\.90\); color:#fff">9</.test(calor) && calor.indexOf('class="c cero">·<') !== -1);
  check('la fila de totales suma 14', calor.indexOf('<tfoot><tr><td>Total</td><td class="c">10</td><td class="c">4</td><td class="c">14</td>') !== -1);
  const emb = ultimo('caEmbudo');
  check('tres barras por día, una al lado de la otra (no apiladas), sumando los cubicadores de ese día',
    emb && emb.cfg.type === 'bar' && !(emb.cfg.options.scales.x.stacked) && emb.cfg.data.labels.join(',') === '26-10,02-11'
    && emb.cfg.data.datasets.map(d => d.label).join(',') === 'No aplica,Resueltas,Sin resolver'
    && emb.cfg.data.datasets[0].data.join(',') === '2,0' && emb.cfg.data.datasets[1].data.join(',') === '5,0'
    && emb.cfg.data.datasets[2].data.join(',') === '3,4');
  const cie = ultimo('caCierre');
  check('los días hasta cerrar van en barras horizontales, el más lento arriba, y la mediana general en el subtítulo',
    cie && cie.cfg.options.indexAxis === 'y' && cie.cfg.data.labels.join(',') === 'Nlopez,Jvelasquez'
    && cie.cfg.data.datasets[0].data.join(',') === '3.1,0.4'
    && nodo('caCierreSub').textContent.indexOf('Mediana general: 1,5 día(s) sobre 7 cerradas') !== -1);
  // El filtro por cubicador afecta a los tres tableros y a la lectura.
  sandbox.CA.cub = 'Nlopez'; sandbox.caPintar();
  const l2 = nodo('caLectura').innerHTML, e2 = ultimo('caEmbudo'), c2 = nodo('caCalor').innerHTML, k2 = ultimo('caCierre');
  check('con Nlopez elegido: la lectura es suya (7 detectadas, 1 resuelta, 6 sin resolver)',
    l2.indexOf(' de Nlopez:') !== -1 && l2.indexOf('<b>7</b> barras') !== -1 && l2.indexOf('<b>1</b> resueltas') !== -1
    && l2.indexOf('<b class="mal">6</b> sin resolver') !== -1);
  check('...las barras por día son las suyas', e2.cfg.data.datasets[2].data.join(',') === '2,4' && e2.cfg.data.datasets[1].data.join(',') === '1,0');
  check('...el mapa sólo tiene su fila', c2.indexOf('Jvelasquez') === -1 && c2.indexOf('Nlopez') !== -1 && c2.indexOf('<td class="c">5</td>') !== -1);
  check('...y los días hasta cerrar son los suyos, con su mediana en el subtítulo',
    k2.cfg.data.labels.join(',') === 'Nlopez' && nodo('caCierreSub').textContent.indexOf('Mediana de Nlopez: 3,1 día(s) sobre 2 cerradas') !== -1);
  check('el botón del elegido queda encendido', nodo('caCubs').innerHTML.indexOf('data-cacub="Nlopez" class="on"') !== -1);
  // Cambio de fuente: auditorías cambia las palabras y la columna, y suelta un cubicador que no está.
  sandbox.CA.fuente = 'auditorias'; sandbox.caPintar();
  check('en auditorías la columna es la causa, las series se llaman como corresponde y el filtro vuelve a «Todos» si la persona no está',
    nodo('caColTit').textContent === 'causa' && nodo('caLectura').innerHTML.indexOf('observaciones') !== -1
    && nodo('caCalor').innerHTML.indexOf('Lectura de plano') !== -1 && sandbox.CA.cub === null
    && ultimo('caEmbudo').cfg.data.datasets[1].label === 'Corregidas');
  sandbox.CA.fuente = 'elementos'; sandbox.caPintar();
  check('una fuente sin data lo dice en vez de dejar cajas vacías',
    nodo('caLectura').innerHTML.indexOf('no hay hallazgos detectadas') !== -1
    && nodo('caCalor').innerHTML.indexOf('Nada detectado') !== -1
    && nodo('caCierreSub').textContent.indexOf('Todavía no hay cierres') !== -1);
  console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.log('EXCEPCIÓN: ' + e.message + '\n' + e.stack.split('\n').slice(0, 4).join('\n')); process.exit(1); });
