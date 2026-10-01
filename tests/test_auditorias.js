// TEST DE AUDITORÍAS (maqueta, 1-oct) — ejecuta las reglas puras del front.
//
// Lo que se congela: el resultado es la cuenta por hallazgo; el estado se deriva (nada
// revisado = planificada, algo = en curso, todo = cerrada); cada no conformidad es una
// acción para quien cubicó, y una observación o un conforme NO generan acción.
//
// Correr con: node tests/test_auditorias.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
function check(nombre, cond) {
  console.log((cond ? '  OK  ' : '  XX  ') + nombre);
  if (!cond) fallos++;
}

const sandbox = {
  console, localStorage: { getItem: () => null, setItem() {} },
  document: { getElementById: () => null },
  fetch: () => Promise.reject(new Error('sin red en el test')), setTimeout, clearTimeout,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
const ruta = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'auditorias', 'index.js');
vm.runInContext(fs.readFileSync(ruta, 'utf8'), sandbox, { filename: ruta });
const T = sandbox.__auditoriasTest;

console.log('TEST: auditorías (maqueta), las reglas');
check('el archivo carga y expone las reglas', !!T && typeof T.resultadoDe === 'function');
if (!T) { console.log('\nFALLOS: 1'); process.exit(1); }

const E = [
  { sector: 'ELEV', piso: 'P1', ciclo: 'C1', eje: 'A', nombre: 'Muro · Eje A · P1 · C1', cubicado_por: 'jose@x.cl' },
  { sector: 'ELEV', piso: 'P1', ciclo: 'C1', eje: 'B', nombre: 'Muro · Eje B · P1 · C1', cubicado_por: 'jose@x.cl' },
  { sector: 'LCIELO', piso: 'P1', ciclo: 'C2', eje: 'L1', nombre: 'Losa · Eje L1 · P1 · C2', cubicado_por: 'nico@x.cl' },
];
const k = T.claveDe;
check('la clave del elemento es sector|piso|ciclo|eje', k(E[0]) === 'ELEV|P1|C1|A' && k(E[0]) !== k(E[1]));

console.log('\n1. Estado y resultado se derivan de los hallazgos');
const A = { elementos: E, hallazgos: {} };
check('sin revisar: planificada y sin resultado', T.estadoDe(A) === 'planificada' && T.resultadoDe(A) === null);
A.hallazgos[k(E[0])] = { hallazgo: 'conforme', texto: '' };
check('al primer hallazgo: en curso', T.estadoDe(A) === 'en_curso');
A.hallazgos[k(E[1])] = { hallazgo: 'nc_mayor', texto: 'largo 4.25 debía ser 4.85', causa: 'MO06' };
A.hallazgos[k(E[2])] = { hallazgo: 'observacion', texto: 'marca repetida' };
check('revisado el último: cerrada', T.estadoDe(A) === 'cerrada');
const R = T.resultadoDe(A);
check('el resultado cuenta por hallazgo', R.conforme === 1 && R.nc_mayor === 1 && R.observacion === 1 && R.nc_menor === 0);

console.log('\n2. Las acciones nacen sólo de las no conformidades');
const acc = T.accionesDe(A);
check('una NC = una acción, para quien cubicó ese elemento',
      acc.length === 1 && acc[0].para === 'jose@x.cl' && acc[0].elemento === E[1].nombre && acc[0].hallazgo === 'nc_mayor');
check('...con lo que se encontró y la causa', acc[0].texto.indexOf('4.85') !== -1 && acc[0].causa === 'MO06');
check('...y arranca pendiente', acc[0].estado === 'pendiente');
A.hallazgos[k(E[2])].hallazgo = 'nc_menor';
check('una NC menor también genera acción', T.accionesDe(A).length === 2);
A.hallazgos[k(E[1])].accion = 'verificada';
check('el estado de la acción viaja con el hallazgo', T.accionesDe(A)[0].estado === 'verificada');

console.log('\n3. El plazo en días hábiles');
const vie = new Date('2026-10-02T12:00:00');   // viernes
const plazo = T.sumaHabiles(vie, T.DIAS_PLAZO);
check('10 hábiles desde un viernes caen dos semanas después, en viernes',
      T.DIAS_PLAZO === 10 && plazo.getDay() === 5 && plazo.toISOString().slice(0, 10) === '2026-10-16');
check('alternar: clic = sólo ése, Ctrl+clic suma, clic en el único lo suelta',
      JSON.stringify(T.alternar(['P1'], 'P2', {})) === '["P2"]' &&
      JSON.stringify(T.alternar(['P1'], 'P2', { ctrlKey: true })) === '["P1","P2"]' &&
      JSON.stringify(T.alternar(['P1'], 'P1', {})) === '[]');

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exit(fallos ? 1 : 0);
