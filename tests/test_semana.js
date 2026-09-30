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

// ── 5. Armar la semana: agregar obras y arrastrar toneladas ────────────────
// Así se trabaja hoy: se elige al cubicador, se le agregan SUS obras y recién ahí se
// reparten las toneladas, que se pueden arrastrar de un día a otro.
console.log('\n5. Armar la semana de un cubicador');
let P = {};
T.agregarObra(P, 'ER', 'OBRA A', '2000001');
check('agregar crea la obra con la semana en blanco',
      P.ER.length === 1 && P.ER[0].obra === 'OBRA A' && P.ER[0].job === '2000001' &&
      JSON.stringify(P.ER[0].dias) === '[0,0,0,0,0]');
T.agregarObra(P, 'ER', 'OBRA A', '2000001');
check('agregar dos veces la misma obra no la repite', P.ER.length === 1);
T.agregarObra(P, 'ER', 'OBRA B', null);
T.agregarObra(P, 'JR', 'OBRA C', null);
check('cada cubicador tiene su propia lista', P.ER.length === 2 && P.JR.length === 1);

P.ER[0].dias = [10, 0, 5, 0, 0];
T.moverDia(P, 'ER', 0, 0, 3);
check('arrastrar mueve las toneladas de un día a otro', JSON.stringify(P.ER[0].dias) === '[0,0,5,10,0]');
T.moverDia(P, 'ER', 0, 3, 2);
check('...y si el día de destino ya tenía, se suman (mover encima es juntar)',
      JSON.stringify(P.ER[0].dias) === '[0,0,15,0,0]');
T.moverDia(P, 'ER', 0, 1, 4);
check('arrastrar un día vacío no hace nada', JSON.stringify(P.ER[0].dias) === '[0,0,15,0,0]');
T.moverDia(P, 'ER', 0, 2, 2);
check('soltar en el mismo día no duplica', JSON.stringify(P.ER[0].dias) === '[0,0,15,0,0]');
T.moverDia(P, 'NADIE', 0, 0, 1);
check('mover en alguien sin programa no revienta', !P.NADIE);

T.quitarObra(P, 'ER', 1);
check('quitar saca la obra y deja el resto', P.ER.length === 1 && P.ER[0].obra === 'OBRA A');
T.quitarObra(P, 'JR', 0);
check('...y al quedar sin obras, el cubicador sale del programa', !P.JR);

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exit(fallos ? 1 : 0);
