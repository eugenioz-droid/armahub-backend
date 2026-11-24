// TEST DEL FRONT DE «CC CONFIRMADOS MODIFICADOS» (24-nov) — ejecuta el archivo de verdad.
//
// La regla de qué se detecta vive en el backend (tests/test_cc_confirmados.py). Acá lo que
// vive en el navegador: los filtros (período, estado, cubicador, búsqueda), los indicadores,
// cómo se lee cada fila (sin foto, diferencia, reprogramado, quién resolvió) y que el
// detalle de barras salga por la hoja estándar (hoja_barras.js) con las medidas en cm.
//
// Correr con: node tests/test_cc_confirmados.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
function check(nombre, cond) {
  console.log((cond ? '  OK  ' : '  XX  ') + nombre);
  if (!cond) fallos++;
}

const sandbox = { console, document: { getElementById: () => null }, setTimeout, clearTimeout,
                  nomCub: (l) => ({ Nlopez: 'N Lopez', JHvelasquez: 'J Velasquez' }[l] || l || '') };
sandbox.window = sandbox;
vm.createContext(sandbox);
const dir = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'auditorias');
vm.runInContext(fs.readFileSync(path.join(dir, 'hoja_barras.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(dir, 'confirmados.js'), 'utf8'), sandbox);
const T = sandbox.__ccmTest;
check('el archivo carga y expone su API', !!T && typeof sandbox.loadCcConfirmados === 'function');

const AHORA = new Date(2026, 10, 24, 16, 0).getTime();   // 24-nov 16:00 hora local
const hace = (h) => new Date(AHORA - h * 3600000).toISOString();
const filas = [
  { id: 1, cc: 'SVOD', obra: 'SANTOLAYA - EDIFICIO ZAÑARTU', descr: 'FUND + ELEV PARTE 1 C13', cubicador: 'Nlopez',
    modificado_el: hace(1), confirmado_el: hace(3), kg_confirmado: 11000, kg_actual: 10523,
    cambios: { n: { agregadas: 1, quitadas: 0, cambiadas: 2 }, agregadas: [], quitadas: [], cambiadas: [] },
    estado: 'Open', estado_hoy: 'Open', reprogramado_el: null, resuelto_el: null },
  { id: 2, cc: 'SVAD', obra: 'DESCO - EDIFICIO MARIN', descr: 'LC- P6 C5', cubicador: 'ERAMIREZ',
    modificado_el: hace(30), confirmado_el: hace(300), kg_confirmado: null, kg_actual: 1755,
    cambios: null, estado: 'Open', estado_hoy: 'Processed', reprogramado_el: hace(2), resuelto_el: null },
  { id: 3, cc: 'ST47', obra: 'DLP - EDIFICIO TALCA 2 SUR', descr: 'ELEV. 13° PISO', cubicador: 'JHvelasquez',
    modificado_el: hace(24 * 10), confirmado_el: hace(24 * 14), kg_confirmado: 7400, kg_actual: 7467,
    cambios: { n: { agregadas: 0, quitadas: 0, cambiadas: 0 } }, estado: 'Open', estado_hoy: 'Open',
    reprogramado_el: null, resuelto_el: hace(5), resuelto_por: 'ez@x.cl', resuelto_nombre: 'Eugenio Zalazar' },
];

console.log('Período');
check('«Hoy» es desde la medianoche', T.desde('hoy', AHORA) === new Date(2026, 10, 24).getTime());
check('«7 días» es una semana atrás', T.desde('7', AHORA) === AHORA - 7 * 86400000);
check('«Todo» no corta', T.desde('todo', AHORA) === 0);

console.log('Filtros');
const C = T.CCM;
C.periodo = 'todo'; C.estado = 'pend'; C.cub = ''; C.buscar = '';
let r = T.filtrar(filas, AHORA);
check('por resolver: los dos sin resolver', r.tabla.map(f => f.cc).join() === 'SVOD,SVAD');
C.estado = 'res';
check('resueltos: sólo el resuelto', T.filtrar(filas, AHORA).tabla.map(f => f.cc).join() === 'ST47');
C.estado = 'todos'; C.periodo = 'hoy';
check('hoy: sólo lo modificado hoy', T.filtrar(filas, AHORA).tabla.map(f => f.cc).join() === 'SVOD');
C.periodo = 'todo'; C.cub = 'ERAMIREZ';
r = T.filtrar(filas, AHORA);
check('un cubicador filtra la tabla y los indicadores', r.tabla.length === 1 && r.deCub.length === 1);
check('pero no los chips de cubicador (salen de la vista entera)', r.vista.length === 3);
C.cub = ''; C.buscar = 'zañartu';
check('la búsqueda mira la obra', T.filtrar(filas, AHORA).tabla.map(f => f.cc).join() === 'SVOD');
C.buscar = 'j velasquez';
check('y el nombre del cubicador, no sólo su login', T.filtrar(filas, AHORA).tabla.map(f => f.cc).join() === 'ST47');
C.buscar = '';

console.log('Indicadores');
const k = T.resumenKpi(filas);
check('por resolver y resueltos', k.pend === 2 && k.res === 1);
check('la diferencia suma lo pendiente con foto, en valor absoluto', k.kg === 477);
check('y cuenta aparte lo que no tiene kilos al confirmar', k.sin === 1);

console.log('Filas');
check('diferencia: hoy menos al confirmar', T.dif(filas[0]) === -477 && T.dif(filas[1]) === null);
check('resumen de barras', T.resumenBarras({ agregadas: 1, quitadas: 3, cambiadas: 2 }) === '+1 · −3 · 2 cambiadas'
      && T.resumenBarras({ cambiadas: 1 }) === '1 cambiada' && T.resumenBarras({}) === '');
let h = T.fila(filas[0]);
check('con foto: kilos al confirmar, diferencia en rojo con signo y botón de barras',
      h.includes('11.000') && h.includes('ccmdif">−477') && h.includes('data-barras="1"'));
check('el cubicador va con su nombre', h.includes('N Lopez'));
h = T.fila(filas[1]);
check('sin foto: lo dice en kilos y en barras', h.includes('>—</td>') && h.includes('>Sin foto</td>'));
check('el estado es el de hoy, y reprogramado si la planta volvió a programar',
      h.includes('ccmest warn">Processed') && h.includes('Reprogramado'));
h = T.fila(filas[2]);
check('resuelto: marcado, con quién y cuándo', h.includes('checked') && h.includes('Eugenio Zalazar')
      && h.includes('ccmhecho'));
check('re-guardado con otros kilos pero las mismas barras: «Sin cambios» en barras', h.includes('Sin cambios'));

console.log('Detalle de barras');
const cambios = {
  agregadas: [{ elemento: 'E2', marca: '12mmA9', diam: '12mm', figura: '102', largo: 3000, cant: 2, kg: 5.3 }],
  quitadas: [{ elemento: 'E1', marca: '', diam: '8mm', figura: 'T1', largo: 800, cant: 4, kg: 1.3 }],
  cambiadas: [{ elemento: 'E1', marca: '10mmA2',
                antes: { diam: '10mm', figura: '101', largo: 6000, cant: 4, kg: 14.8 },
                despues: { diam: '10mm', figura: '101', largo: 6000, cant: 6, kg: 22.2 } }],
  n: { agregadas: 1, quitadas: 1, cambiadas: 1 } };
const det = T.filasDetalle(cambios);
check('orden: agregadas, cambiadas, quitadas', det.map(f => f.propias[0].replace(/<[^>]+>/g, '')).join() ===
      'Agregada,Cambiada,Quitada');
check('el largo pasa de mm a cm y el φ a número', det[0].barra.largo === 300 && det[0].barra.diam === 12);
check('la cambiada muestra lo de hoy y, aparte, sólo lo que tenía antes', det[1].barra.cant === 6
      && det[1].texto === 'Cant 4 · Peso 15');
check('sin marca lo dice', det[2].barra.marca === '(sin marca)');
C.abiertos[1] = true;
h = T.fila(Object.assign({}, filas[0], { cambios: cambios }));
check('abierto: la hoja de barras estándar debajo de la fila', h.includes('class="ccmdet"') && h.includes('hojab')
      && h.includes('12mmA9') && h.includes('Agregada'));
C.abiertos = {};

console.log('Fechas');
check('día-mes hora:minuto, como el resto de Auditorías', T.fecha(new Date(2026, 10, 4, 9, 5).toISOString()) === '04-11 09:05');
check('sin fecha, vacío', T.fecha(null) === '' && T.fecha('') === '');

console.log('Cabecera');
check('sin revisar todavía', T.textoCarga(null, false) === 'Todavía sin revisar');
check('corriendo', T.textoCarga({ ok: true }, true) === 'Revisando en aSa…');
check('falló, con el motivo', T.textoCarga({ ok: false, detalle: 'aSa HTTP 429' }, false).includes('aSa HTTP 429'));

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTodo OK');
process.exit(fallos ? 1 : 0);
