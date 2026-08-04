// Test de LÓGICA (sin navegador) para la INVARIANTE del marcado de "geometría inválida" en la grilla
// del creador de despieces:
//
//   "El fondo rosado de fila (inválida) SIEMPRE refleja la validez ACTUAL de la barra. Al corregir
//    una barra editando una MEDIDA (dim/ángulo/radio), el fondo se limpia sin necesidad de forzar un
//    re-render completo (cambiar figura/diámetro)."
//
// Contexto del bug: ac2ActualizarGeom refrescaba el rojo POR CELDA pero NO el fondo de la fila (solo
// lo hacía el re-render completo ac2Fila). Entonces una barra que quedaba inválida y se corregía por
// medida mantenía el fondo rosado "pegado" hasta cambiar la figura → parecía inválida siendo válida.
// Este test FALLA si el fondo vuelve a no recalcularse en ac2ActualizarGeom.
//
// Correr con: node tests/test_geom_fondo.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'cubicacion', 'agregar_cubicacion2.js');
const code = fs.readFileSync(SRC, 'utf8');

const noop = () => {};
// TR falso con style/title y querySelectorAll vacío (no hay inputs reales que marcar).
var theTr = { style: { background: '#fff5f5' }, title: 'inv', querySelectorAll: () => [] };
function mkEl() { return { style: {}, value: '', checked: false, innerHTML: '',
  classList: { contains: () => false, add: noop, remove: noop, toggle: noop },
  getAttribute: () => null, setAttribute: noop, focus: noop, select: noop }; }
const documentStub = {
  // ac2ActualizarGeom pide getElementById('ac2row_'+id) → devolvemos el tr falso; el dibujo un el falso.
  getElementById: (id) => (id && id.indexOf('ac2row_') === 0) ? theTr : ((id && id.indexOf('ac2dib_') === 0) ? mkEl() : null),
  querySelector: () => null, querySelectorAll: () => [], createElement: mkEl, body: mkEl(),
  activeElement: null, addEventListener: noop,
};
const sandbox = { console, window: {}, document: documentStub, setTimeout: (fn) => fn && fn() };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'agregar_cubicacion2.js' });

const AC2 = sandbox.AC2;
AC2.masiva = false; AC2.tam = 'm'; AC2.render = false;
sandbox._ac2Figuras['102A'] = { codigo: '102A', parciales: ['A', 'B'], angulos: [], radio: false };

let fallos = 0;
function check(nombre, cond) { console.log((cond ? '  ✓ ' : '  ✗ ') + nombre); if (!cond) fallos++; }

console.log('TEST: el fondo de fila refleja la validez tras corregir por medida');

// Barra 102A (2 lados) con dim_b faltante → inválida, fondo rosado.
var b = { _id: 1, figura: '102A', diam: 16, cant: 6, mult: 1,
  dim_a: 610, dim_b: null, dim_c: null, dim_d: null, dim_e: null, dim_f: null, dim_g: null, dim_h: null, dim_i: null,
  ang1: null, ang2: null, ang3: null, ang4: null, radio: null };
AC2.barras = [b];
check('parte inválida (dim_b falta)', !sandbox.ac2Validar(b).ok);

// Corregir editando la MEDIDA (no la figura): completar dim_b y refrescar geometría.
b.dim_b = 550;
sandbox.ac2ActualizarGeom(1);
check('tras corregir la medida, la barra es válida', sandbox.ac2Validar(b).ok);
check('el fondo rosado se LIMPIÓ (no queda pegado)', theTr.style.background === '');

// Caso inverso: una barra válida que se rompe por medida debe volver a pintarse rosada.
theTr.style.background = '';
b.dim_b = null;               // quitar la medida → vuelve inválida
sandbox.ac2ActualizarGeom(1);
check('al invalidarse por medida, el fondo vuelve a rosado', theTr.style.background === '#fff5f5');

if (fallos === 0) { console.log('\nOK: el fondo sigue la validez.'); process.exit(0); }
else { console.log('\nFALLÓ: ' + fallos + ' aserción(es). El marcado de inválida quedó desincronizado.'); process.exit(1); }
