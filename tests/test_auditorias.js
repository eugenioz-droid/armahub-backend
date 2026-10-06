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

// El renderer del Bar Manager y el motor del editor, FALSOS: acá se prueba que Auditorías
// les pase lo que esperan (cm, φ en mm, tamaño M), no cómo dibujan.
const llamadasBm = [], llamadasMotor = [];
const sandbox = {
  console, document: { getElementById: () => null },
  fetch: () => Promise.reject(new Error('sin red en el test')), setTimeout, clearTimeout,
  _bmFiguraSvg: (b, tam) => { llamadasBm.push({ b, tam }); return b.figura === '104B' ? '<svg class="bm"></svg>' : ''; },
  _bmTam: () => ({ w: 110, h: 80 }),
  disenadorMotor: { svgDesdePuntos: (pts, o) => { llamadasMotor.push({ pts, o }); return '<svg class="eje"></svg>'; } },
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

console.log('\n4. El dibujo de la barra: el mismo motor que el editor de despieces');
const asa = T.barraParaDibujo({ figura: '104B', diam: '10mm',
  eje: { ok: false, lados: [{ nombre: 'A', largo: 120 }, { nombre: 'B', largo: 5430 }] } }, 'asa');
check('aSa: los lados pasan de mm a cm con su letra, y el φ «10mm» queda en 10',
      asa.figura === '104B' && asa.diam === 10 && asa.dim_a === 12 && asa.dim_b === 543 && !('dim_c' in asa));
const asaTxt = T.barraParaDibujo({ figura: '101A', diam: '12mm', eje: { ok: false, lados: [] },
  dims: { A: '300 (90°)', B: '11400' } }, 'asa');
check('...y sin eje reconstruido se leen del texto de los lados', asaTxt.dim_a === 30 && asaTxt.dim_b === 1140);
const propia = T.barraParaDibujo({ figura: '101A', diam: 12, dims: { a: 600 } }, 'armahub');
check('ArmaHub: las medidas ya están en cm y van tal cual', propia.dim_a === 600 && propia.diam === 12);

llamadasBm.length = 0;
const celda = T.celdaFigura({ figura: '104B', diam: '10mm', eje: { ok: true, puntos: [[0, 0], [1200, 0]], lados: [{ nombre: 'A', largo: 1200 }] } }, 'asa');
check('con la figura en el catálogo dibuja el Bar Manager, al tamaño M, con el código debajo',
      celda.indexOf('<svg class="bm">') !== -1 && celda.indexOf('>104B<') !== -1 &&
      llamadasBm.length === 1 && llamadasBm[0].tam === 'm' && llamadasBm[0].b.dim_a === 120);
llamadasMotor.length = 0;
const celdaEje = T.celdaFigura({ figura: 'ZZZ', diam: '16mm', eje: { ok: true, puntos: [[0, 0], [1200, 0]], lados: [] } }, 'asa');
check('sin la figura en el catálogo, el eje de aSa se dibuja con el motor, en cm y con grosor por φ',
      celdaEje.indexOf('<svg class="eje">') !== -1 && llamadasMotor.length === 1 &&
      llamadasMotor[0].pts[1].x === 120 && llamadasMotor[0].o.metrico === true &&
      llamadasMotor[0].o.diam_mm === 16 && llamadasMotor[0].o.labels_auto === false);
check('...pero sólo si el eje se pudo comprobar: si no, queda el código en texto',
      T.celdaFigura({ figura: 'ZZZ', diam: '16mm', eje: { ok: false, puntos: [[0, 0], [1200, 0]], lados: [] } }, 'asa') === 'ZZZ');
check('ya no hay un dibujante propio: el formato es el de la plataforma', fuente.indexOf('function svgBarra') === -1);

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exit(fallos ? 1 : 0);
