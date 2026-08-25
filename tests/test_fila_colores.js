// Test de LÓGICA (sin navegador) para dos invariantes de la grilla del creador de despieces:
//
//   1) El FONDO de una fila sale de UNA sola escala de prioridades (ac2EstiloFila):
//        inválida > seleccionada (masiva) > barra del Enfierrador > barra guardada > blanco.
//      Existe porque la fila la pintan TRES caminos distintos (render completo, edición de una
//      medida y marcado masivo). Cuando cada uno traía su propia lista, uno se quedaba atrás y
//      el fondo mentía: el rosado "inválida" quedaba pegado tras corregir la barra. Si alguien
//      vuelve a escribir un color a mano en uno de los tres caminos, esta escala se rompe y
//      este test lo dice.
//
//   2) "Barra de estructura" se decide por el VÍNCULO a la instancia (_instanciaId), no por la
//      etiqueta _origen. En esa columna conviven 'template' (histórico) y 'enfierrador' (nuevo);
//      mirar el origen dejaba fuera del candado a barras que sí pertenecen a una estructura y
//      que la próxima regeneración va a pisar.
//
// No corre en producción, no toca la app. Correr con:
//   node tests/test_fila_colores.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Cargar el módulo del creador en un sandbox con stubs mínimos de navegador ──
const SRC = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'cubicacion', 'agregar_cubicacion2.js');
const code = fs.readFileSync(SRC, 'utf8');

const noop = () => {};
const fakeEl = { style: {}, textContent: '', value: '', checked: false, indeterminate: false,
                 innerHTML: '', className: '', appendChild: noop, addEventListener: noop,
                 setAttribute: noop, getAttribute: () => null, focus: noop, select: noop,
                 classList: { add: noop, remove: noop, toggle: noop } };
const documentStub = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => Object.assign({}, fakeEl),
  body: Object.assign({}, fakeEl),
};
const sandbox = { console, window: {}, document: documentStub, setTimeout: (fn) => fn && fn() };
sandbox.window.document = documentStub;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'agregar_cubicacion2.js' });

const AC2 = sandbox.AC2;
const ac2EstiloFila = sandbox.ac2EstiloFila;
const ac2BarraDeEstructura = sandbox.ac2BarraDeEstructura;

// ── Mini framework de aserciones ──
let fallos = 0;
function check(nombre, cond) {
  if (cond) { console.log('  ✓ ' + nombre); }
  else { console.log('  ✗ ' + nombre); fallos++; }
}
function bg(b) { return ac2EstiloFila(b).bg; }

// En el sandbox el catálogo de figuras está vacío → una figura "no usa" ningún lado:
//   con figura y SIN medidas  → válida
//   con figura y CON una medida → inválida (sobra esa medida)
const VALIDA  = { figura: 'F' };
const INVALIDA = { figura: 'F', dim_b: 10 };

// ── 1. Escala de prioridades del fondo ──────────────────────────────────────
console.log('\n1. Prioridad de colores de fila');
AC2.masiva = false; AC2.seleccion = {};

check('barra nueva (nada especial) → sin fondo',
      bg(Object.assign({ _id: 1 }, VALIDA)) === '');
check('barra guardada → verde #f1f8e9',
      bg(Object.assign({ _id: 2, _guardada: true }, VALIDA)) === '#f1f8e9');
check('barra del Enfierrador → azul #e1f5fe',
      bg(Object.assign({ _id: 3, _instanciaId: 77, _guardada: true }, VALIDA)) === '#e1f5fe');
check('el azul del Enfierrador gana al verde de guardada',
      bg(Object.assign({ _id: 4, _instanciaId: 77, _guardada: true }, VALIDA)) !== '#f1f8e9');
check('barra inválida → rosado #fff5f5 aunque venga del Enfierrador y esté guardada',
      bg(Object.assign({ _id: 5, _instanciaId: 77, _guardada: true }, INVALIDA)) === '#fff5f5');

AC2.masiva = true; AC2.seleccion = { 6: true, 7: true };
check('seleccionada en masiva → celeste #e3f2fd, por sobre azul y verde',
      bg(Object.assign({ _id: 6, _instanciaId: 77, _guardada: true }, VALIDA)) === '#e3f2fd');
check('seleccionada PERO inválida → manda el rosado (el error no se esconde)',
      bg(Object.assign({ _id: 7, _instanciaId: 77 }, INVALIDA)) === '#fff5f5');
check('el celeste de selección y el azul del Enfierrador NO son el mismo color',
      '#e3f2fd' !== '#e1f5fe');
AC2.masiva = false; AC2.seleccion = {};

check('la fila con problema explica el problema en su título',
      /Geometría inválida/.test(ac2EstiloFila(Object.assign({ _id: 8 }, INVALIDA)).tit));
check('la fila del Enfierrador explica que se edita reabriendo su estructura',
      /Enfierrador/.test(ac2EstiloFila(Object.assign({ _id: 9, _instanciaId: 77 }, VALIDA)).tit));

// ── 2. El candado sigue al vínculo, no a la etiqueta ────────────────────────
console.log('\n2. Predicado "barra de estructura"');
check("origen 'template' (histórico) con instancia → es de estructura",
      ac2BarraDeEstructura({ _origen: 'template', _instanciaId: 5 }) === true);
check("origen 'enfierrador' (nuevo) con instancia → es de estructura",
      ac2BarraDeEstructura({ _origen: 'enfierrador', _instanciaId: 5 }) === true);
check('sin etiqueta de origen pero CON instancia → sigue siendo de estructura',
      ac2BarraDeEstructura({ _origen: '', _instanciaId: 5 }) === true);
check("origen 'template' SIN instancia → NO es de estructura (no hay a qué reabrir)",
      ac2BarraDeEstructura({ _origen: 'template', _instanciaId: null }) === false);
check('barra manual → no es de estructura',
      ac2BarraDeEstructura({ _origen: 'manual' }) === false);
check('sin barra → false (no revienta)',
      ac2BarraDeEstructura(null) === false);

console.log(fallos ? '\n❌ ' + fallos + ' fallo(s)' : '\n✅ Todo OK');
process.exit(fallos ? 1 : 0);
