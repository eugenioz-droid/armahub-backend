// CATÁLOGO aSa — test del front (Node).
//
// Qué cuida. La pantalla muestra EL TRAZO QUE EXPORTÓ aSa, no nuestra reconstrucción: ése
// es todo su valor. Si dibujáramos otra cosa y la pantalla no lo dijera, sería peor que no
// tenerla — el usuario compararía contra una figura equivocada creyendo que es la de aSa.
// Así que lo que se congela es: que los puntos lleguen al motor tal cual (son el esquema
// de aSa, no centímetros, así que no se les aplica grosor por φ), que lo que viene partido
// se vea partido, y que los filtros filtren lo que dicen.
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
  apiGet: async () => ({ figuras: FIGURAS, fuera_del_catalogo: ['26', 'T12'] }),
};
sandbox.window = sandbox;

// Tres figuras reales del RDX: una recta que usamos y tenemos, un estribo con ganchos que
// nunca se ha usado, y una con el trazo en dos pedazos.
const FIGURAS = [
  { codigo: '101A', tipo: 'B', generica: true, descripcion: null,
    puntos: [[-250, 0], [250, 0]], lados: [{ nombre: 'A', tipo: 'B' }],
    tridimensional: false, cadena_rota: false,
    barras: 151, cc: 'SUQH', marca: '10mmA1', obra: 'EURO', diam: 10, en_catalogo: true },
  { codigo: '104E1', tipo: 'B', generica: true, descripcion: null,
    puntos: [[-204, 64], [-217, 47], [-150, -64], [209, -64], [217, -44]],
    lados: [{ nombre: 'A', tipo: 'H3' }, { nombre: 'B', tipo: 'SB' },
            { nombre: 'C', tipo: 'B' }, { nombre: 'G', tipo: 'H3' }],
    tridimensional: false, cadena_rota: false,
    barras: 0, cc: null, marca: null, obra: null, diam: 0, en_catalogo: false },
  { codigo: '203D', tipo: 'B', generica: false, descripcion: null,
    puntos: [[0, 0], [100, 0], [200, 50], [300, 50]],
    lados: [{ nombre: 'A', tipo: 'B' }, { nombre: 'B', tipo: 'B' }],
    tridimensional: true, cadena_rota: true,
    barras: 3, cc: 'SUP4', marca: '12mmA1', obra: 'EURO', diam: 12, en_catalogo: false },
];

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(RUTA, 'utf8'), sandbox, { filename: 'asa.js' });

console.log('TEST: Catálogo aSa');

(async function () {
  console.log('\n1. Carga el catálogo, no las barras');
  check('expone el loader del sub-tab', typeof sandbox.loadCatalogoAsa === 'function');
  await sandbox.loadCatalogoAsa();
  const T = sandbox.__catalogoAsaTest;
  check('quedaron las figuras del catálogo', T.CAS.figuras.length === 3 && T.CAS.cargado === true);
  check('...y las que se usan pero NO están en el catálogo se guardan aparte',
    T.CAS.fuera.join() === '26,T12');

  console.log('\n2. El trazo llega al motor tal cual lo exportó aSa');
  const recta = llamadas.find(l => l.pts.length === 2);
  check('los puntos van sin convertir: son el esquema de aSa, no milímetros',
    !!recta && recta.pts[0].x === -250 && recta.pts[1].x === 250);
  check('no se le inventa un grosor por φ sobre coordenadas que no son centímetros',
    !!recta && recta.o.metrico === undefined && recta.o.diam_mm === undefined);
  const estribo = llamadas.find(l => l.pts.length === 5);
  check('cada tramo se rotula con la letra del lado que le puso aSa',
    !!estribo && estribo.o.labels.join('|') === 'A|B|C|G' && estribo.o.labels_auto === true);
  check('los ángulos automáticos van apagados: el esquema de aSa ya trae los suyos',
    !!estribo && estribo.o.angulos === false);

  console.log('\n3. Lo que viene partido se ve partido');
  const html = nodo('casLista').innerHTML;
  check('la tarjeta queda marcada y lo dice', html.indexOf('cascard mal') > 0
    && html.indexOf('el trazo viene en pedazos sueltos') > 0);
  check('...y una figura partida no se rotula como si encadenara',
    llamadas.filter(l => l.pts.length === 4).every(l => l.o.labels.length === 0));

  console.log('\n4. De cada figura: si la usamos y si la tenemos');
  check('se distingue la que está en ArmaHub de la que es sólo de aSa',
    html.indexOf('en ArmaHub') > 0 && html.indexOf('sólo aSa') > 0);
  check('las usadas dicen cuántas barras y de qué código salió el ejemplo',
    html.indexOf('151 barra(s)') > 0 && html.indexOf('SUQH') > 0);
  check('...y las que nunca se usaron lo dicen en vez de mostrar un cero mudo',
    html.indexOf('sin uso registrado') > 0);
  check('se marca la que es de obra y la que va en 3D',
    html.indexOf('de obra') > 0 && html.indexOf('3D') > 0);

  console.log('\n5. Los contadores y los filtros');
  const kpis = nodo('casKpis').innerHTML;
  check('cuenta el catálogo entero, las usadas y las que también tenemos',
    kpis.indexOf('<b>3</b>figuras en aSa') > 0 && kpis.indexOf('<b>2</b>usadas') > 0
    && kpis.indexOf('<b>1</b>también en el catálogo ArmaHub') > 0);
  check('...y avisa de las usadas que el catálogo no trae', kpis.indexOf('<b>2</b>usadas y NO') > 0);
  T.CAS_F.estado = 'usadas';
  check('«usadas en barras» deja fuera las que nunca se ocuparon',
    T.visibles().map(f => f.codigo).join() === '101A,203D');
  T.CAS_F.estado = 'sin_catalogo';
  check('«no están en ArmaHub» deja las que nos faltan',
    T.visibles().map(f => f.codigo).join() === '104E1,203D');
  T.CAS_F.estado = 'problema';
  check('«trazo partido» deja sólo la rota', T.visibles().map(f => f.codigo).join() === '203D');
  T.CAS_F.estado = 'td';
  check('«en 3D» deja las que salen del plano', T.visibles().map(f => f.codigo).join() === '203D');
  T.CAS_F.estado = 'todas';
  check('«todas» no esconde nada', T.visibles().length === 3);

  console.log('\n6. Sin catálogo cargado se dice cómo se carga');
  const src = fs.readFileSync(RUTA, 'utf8');
  check('se nombra el script que lo llena', src.indexOf('importar_rdx_figuras.py') > 0);
  check('...y se explica de dónde sale el trazo', src.indexOf('el dibujo de aSa, no nuestra reconstrucción') > 0);

  console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
