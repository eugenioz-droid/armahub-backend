// TEST DEL FRONT DE AUDITORÍAS — ejecuta el archivo de verdad, no lo lee.
//
// Las reglas de negocio (estado derivado, acciones, resultado) se mudaron al BACKEND
// cuando las auditorías pasaron a la base: ahí se prueban (tests/test_auditorias.py).
// Acá queda lo que de verdad vive en el navegador: que el archivo cargue sin reventar y
// la regla de armado del alcance, donde el clic simple SUMA (a diferencia de los filtros
// de aSa Data, donde el clic deja «sólo ése»).
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
  console, document: { getElementById: () => null },
  fetch: () => Promise.reject(new Error('sin red en el test')), setTimeout, clearTimeout,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
const ruta = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'auditorias', 'index.js');
vm.runInContext(fs.readFileSync(ruta, 'utf8'), sandbox, { filename: ruta });
const T = sandbox.__auditoriasTest;

console.log('TEST: front de auditorías');
check('el archivo carga y expone sus reglas', !!T && typeof T.marcar === 'function');
if (!T) { console.log('\nFALLOS: 1'); process.exit(1); }

console.log('\n1. Armar el alcance: multi-selección');
check('el clic simple SUMA: se eligen varios pisos sin Ctrl',
      JSON.stringify(T.marcar(T.marcar(['P1'], 'P2'), 'P3')) === '["P1","P2","P3"]');
check('...volver a tocarlo lo quita', JSON.stringify(T.marcar(['P1', 'P2'], 'P1')) === '["P2"]');
check('...y vacío significa todos', JSON.stringify(T.marcar(['P1'], 'P1')) === '[]');

console.log('\n2. El vocabulario de la pantalla es el de la ISO');
check('los cuatro niveles del hallazgo, con su nombre en castellano',
      T.HALLAZGO_TXT.conforme === 'Conforme' && T.HALLAZGO_TXT.observacion === 'Observación' &&
      T.HALLAZGO_TXT.nc_menor === 'NC menor' && T.HALLAZGO_TXT.nc_mayor === 'NC mayor');
check('los tres estados de la acción: corregir es del cubicador, verificar del auditor',
      T.ACCION_TXT.pendiente === 'Pendiente' && T.ACCION_TXT.corregida === 'Corregida' &&
      T.ACCION_TXT.verificada === 'Verificada');

console.log('\n3. Nada se guarda en el navegador');
const fuente = fs.readFileSync(ruta, 'utf8');
check('no hay localStorage: una auditoría es un registro de calidad, va a la base',
      fuente.indexOf('localStorage') === -1);
check('el estado y las fechas no se calculan acá: vienen del backend',
      fuente.indexOf('function estadoDe') === -1 && fuente.indexOf('function resultadoDe') === -1);

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exit(fallos ? 1 : 0);
