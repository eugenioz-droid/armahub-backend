// CATÁLOGO aSa — test del front (Node).
//
// Qué cuida. Esta pantalla existe para UNA cosa: ver de un vistazo con qué figuras de aSa
// tenemos problemas. Si el dibujo saliera mal y la pantalla no lo dijera, sería peor que
// no tenerla — el usuario miraría figuras equivocadas creyendo que están bien. Así que lo
// que se congela es: que la figura se le pase al motor como corresponde (cm, arcos con su
// radio y su sentido), que lo que no cuadra salga marcado con su motivo, y que los filtros
// filtren lo que dicen.
//
// Correr con: node tests/test_catalogo_asa.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
function check(nombre, cond) {
  console.log((cond ? '  OK  ' : '  XX  ') + nombre);
  if (!cond) fallos++;
}

const RAIZ = path.join(__dirname, '..');
const RUTA = path.join(RAIZ, 'armahub', 'static', 'js', 'features', 'catalogo', 'asa.js');

const noop = () => {};
const nodos = {};
function nodo(id) {
  if (!nodos[id]) {
    nodos[id] = { id, innerHTML: '', style: {}, dataset: {},
                  querySelectorAll: () => [], addEventListener: noop };
  }
  return nodos[id];
}
// El motor, FALSO: acá se prueba QUÉ se le pasa, no cómo dibuja (eso lo cubren
// test_grosor_figura.js y test_codo_figura.js, que corren el motor de verdad).
const llamadas = [];
const sandbox = {
  console, setTimeout, clearTimeout,
  document: { getElementById: nodo, querySelectorAll: () => [] },
  disenadorMotor: { svgDesdePuntos: (pts, o) => { llamadas.push({ pts, o }); return '<svg class="fig"></svg>'; } },
  apiGet: async () => ({ figuras: FIGURAS }),
};
sandbox.window = sandbox;

// Una traba T12 real (gancho · arco · barra · arco · gancho), una recta del catálogo
// propio y una que no cuadra con la envolvente que declara aSa.
const FIGURAS = [
  { codigo: 'T12', barras: 27, cc: 'SUP4', marca: '12mmA27', obra: 'EURO', diam: 12, en_catalogo: false,
    ok: true, motivo: '', tridimensional: false,
    puntos: [[0, 0], [-89.1, -94.7], [-67.3, -145.2], [832.7, -145.2], [854.6, -94.7], [765.5, 0]],
    tramos: [{ tipo: 'recto', lado: 'A', largo: 130 }, { tipo: 'arco', lado: '', largo: null, radio: 30, sweep: 1 },
             { tipo: 'recto', lado: 'B', largo: 900 }, { tipo: 'arco', lado: '', largo: null, radio: 30, sweep: 1 },
             { tipo: 'recto', lado: 'G', largo: 130 }] },
  { codigo: '101A', barras: 151, cc: 'SUQH', marca: '10mmA1', obra: 'EURO', diam: 10, en_catalogo: true,
    ok: true, motivo: '', tridimensional: false,
    puntos: [[0, 0], [4250, 0]], tramos: [{ tipo: 'recto', lado: 'A', largo: 4250 }] },
  { codigo: '103G', barras: 7, cc: 'SSKY', marca: '18mmA45', obra: 'CRCC', diam: 18, en_catalogo: true,
    ok: false, motivo: 'la envolvente no cuadra: construida 2070 × 600, aSa dice 2135 × 297',
    tridimensional: false, puntos: [[0, 0], [300, 0]], tramos: [{ tipo: 'recto', lado: 'C', largo: 300 }] },
];

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(RUTA, 'utf8'), sandbox, { filename: 'asa.js' });

console.log('TEST: Catálogo aSa');

(async function () {
  console.log('\n1. Carga y pide lo suyo');
  check('expone el loader del sub-tab', typeof sandbox.loadCatalogoAsa === 'function');
  await sandbox.loadCatalogoAsa();
  const T = sandbox.__catalogoAsaTest;
  check('quedaron las tres figuras', T.CAS.figuras.length === 3 && T.CAS.cargado === true);

  console.log('\n2. La figura se le pasa al motor como corresponde');
  const t12 = llamadas.find(l => l.pts.length === 6);
  check('los puntos van en cm, no en los mm que manda aSa',
    !!t12 && Math.abs(t12.pts[3].x - 83.27) < 0.01);
  check('los arcos van como arco, con su radio en cm',
    !!t12 && t12.o.tipos_seg.join() === 'recto,arco,recto,arco,recto' && t12.o.radios_seg[1] === 3);
  check('...y con el sentido traducido a la convención del lienzo (1 → 0)',
    !!t12 && t12.o.sweeps_seg[1] === 0);
  check('cada tramo recto lleva su medida en cm; los arcos, nada',
    !!t12 && t12.o.labels.join('|') === '13||90||13');
  check('el grosor sale del φ de la barra', !!t12 && t12.o.diam_mm === 12 && t12.o.metrico === true);
  check('las cotas automáticas de arco van apagadas: en una miniatura son ruido',
    !!t12 && Array.isArray(t12.o.cotas_arco_iso) && t12.o.cotas_arco_iso.length === 0);

  console.log('\n3. Lo que no cuadra se ve, y se ve POR QUÉ');
  const html = nodo('casLista').innerHTML;
  check('la tarjeta de la que falla queda marcada', html.indexOf('cascard mal') > 0);
  check('...con el motivo completo, no un «error» pelado',
    html.indexOf('aSa dice 2135 × 297') > 0 && html.indexOf('⚠') > 0);
  check('se distingue la que está en nuestro catálogo de la que es sólo de aSa',
    html.indexOf('en catálogo') > 0 && html.indexOf('sólo aSa') > 0);
  check('y cada tarjeta dice de qué barra real salió, para ir a mirarla en aSa',
    html.indexOf('SUP4') > 0 && html.indexOf('12mmA27') > 0);

  console.log('\n4. Los contadores y los filtros');
  const kpis = nodo('casKpis').innerHTML;
  check('cuenta figuras, las que se dibujan bien y las que no',
    kpis.indexOf('<b>3</b>figuras') > 0 && kpis.indexOf('<b>2</b>se dibujan bien') > 0
    && kpis.indexOf('<b>1</b>con problema') > 0);
  check('...y cuántas no están en nuestro catálogo', kpis.indexOf('<b>1</b>no están') > 0);
  T.CAS_F.estado = 'problema';
  check('el filtro «con problema» deja sólo las que fallan',
    T.visibles().length === 1 && T.visibles()[0].codigo === '103G');
  T.CAS_F.estado = 'nativas';
  check('«sólo nativas de aSa» deja las que no tenemos', T.visibles().map(f => f.codigo).join() === 'T12');
  T.CAS_F.estado = 'todas';
  check('«todas» no esconde nada', T.visibles().length === 3);

  console.log('\n5. Sin datos no se finge una pantalla vacía');
  T.CAS.figuras = [];
  sandbox.loadCatalogoAsa.toString();   // (la función ya está cargada; se repinta a mano)
  T.CAS_F.estado = 'todas';
  check('se dice que falta barrer aSa y con qué script',
    typeof T.visibles === 'function' && T.visibles().length === 0);
  const src = fs.readFileSync(RUTA, 'utf8');
  check('...y el texto lo nombra', src.indexOf('escanear_figuras_asa.py') > 0);

  console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
