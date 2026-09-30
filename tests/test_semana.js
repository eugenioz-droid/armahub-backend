// TEST DEL PROGRAMA SEMANAL (maqueta, 30-sep) — ejecuta la regla del tablero.
//
// Lo que se congela: programado vs cubicado por cubicador y por día, el % de la semana,
// el cumplimiento del día con la tolerancia del 90%, y que lo cubicado FUERA del programa
// se muestra aparte y no suma al cumplimiento (cumplir es hacer lo programado).
//
// Correr con: node tests/test_semana.js
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
  document: { getElementById: () => null, createElement: () => ({}) },
  fetch: () => Promise.reject(new Error('sin red en el test')), setTimeout, clearTimeout,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
const ruta = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'programacion', 'semana.js');
vm.runInContext(fs.readFileSync(ruta, 'utf8'), sandbox, { filename: ruta });
const T = sandbox.__prgSemanaTest;

console.log('TEST: programa semanal (maqueta), la regla del tablero');
check('el archivo carga y expone la regla', !!T && typeof T.tablero === 'function');
if (!T) { console.log('\nFALLOS: 1'); process.exit(1); }

const DS = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
const PLAN = {
  ERAMIREZ: [{ obra: 'CRCC - HOSPITAL COQUIMBO', job: '2007889', dias: [10, 10, 5, 0, 0] },
             { obra: 'BELFI - PUENTE LO GALLARDO', job: '2010795', dias: [0, 0, 15, 0, 0] }],
  JR: [],
};
const REAL = [
  { persona: 'ERAMIREZ', obra: 'CRCC - HOSPITAL COQUIMBO', job: '2007889', dia: '2026-09-28', kg: 9500, cc: 3 },   // 95% → cumple
  { persona: 'ERAMIREZ', obra: 'CRCC - HOSPITAL COQUIMBO', job: '2007889', dia: '2026-09-29', kg: 4000, cc: 1 },   // 40% → no
  { persona: 'ERAMIREZ', obra: 'BELFI - PUENTE LO GALLARDO', job: '2010795', dia: '2026-09-30', kg: 20000, cc: 2 },
  { persona: 'ERAMIREZ', obra: 'OTRA OBRA', job: '2000001', dia: '2026-10-01', kg: 3000, cc: 1 },                   // fuera de programa
  { persona: 'JR', obra: 'EI - EDIF METROPOLIS', job: '2012345', dia: '2026-09-28', kg: 8000, cc: 2 },              // sin programa
];
const T1 = T.tablero(PLAN, REAL, DS, ['ERAMIREZ', 'JR']);
const er = T1[0], jr = T1[1];

console.log('\n1. Programado y cubicado por cubicador');
check('programado de la semana = suma de las toneladas de sus obras (en kg)', er.progT === 40000);
check('cubicado de la semana = lo de las obras programadas', er.cubT === 33500);
check('el % es cubicado / programado', Math.round(er.pct * 100) === 84);
check('sin programa, el % no existe (no es 0)', jr.progT === 0 && jr.pct === null);

console.log('\n2. El día a día');
check('lunes: 9,5 de 10 → cumple (tolerancia 90%)', er.estadoDia[0] === 'ok');
check('martes: 4 de 10 → no cumple', er.estadoDia[1] === 'no');
check('miércoles: dos obras suman 20 t programadas y 20 cubicadas → cumple',
      er.progDia[2] === 20000 && er.cubDia[2] === 20000 && er.estadoDia[2] === 'ok');
check('jueves: nada programado pero cubicó → «extra», no rojo', er.estadoDia[3] === 'extra');
check('viernes: nada programado ni cubicado → «nada»', er.estadoDia[4] === 'nada');

console.log('\n3. Fuera de programa');
check('lo cubicado en obras no programadas va aparte', er.fuera.length === 1 && er.fuera[0].obra === 'OTRA OBRA' && er.fueraT === 3000);
check('...y no suma al cumplimiento', er.cubT === 33500);
check('un cubicador sin programa muestra todo como fuera de programa', jr.fueraT === 8000 && jr.fuera[0].obra === 'EI - EDIF METROPOLIS');

console.log('\n4. Por obra');
const coq = er.filas[0];
check('cada obra lleva su programado y cubicado por día', coq.prog[0] === 10000 && coq.cub[0] === 9500 && coq.progT === 25000 && coq.cubT === 13500);
check('la tolerancia es una constante visible', T.TOLERANCIA === 0.9);
check('sin plan ni real, tablero vacío y sin error', T.tablero({}, [], DS, []).length === 0);

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exit(fallos ? 1 : 0);
