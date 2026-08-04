// Test de LÓGICA (sin navegador) para la INVARIANTE de la edición masiva del creador de despieces:
//
//   "Una acción masiva (y el check global) operan SOLO sobre las barras VISIBLES en la vista
//    activa (tipología). Nunca sobre una barra de otra tipología que quedó marcada por detrás."
//
// Contexto: este bug ya se coló una vez de forma SILENCIOSA. El commit de39388 movió la selección
// del DOM (que solo contiene lo visible) al estado JS AC2.seleccion (que contiene TODO lo marcado),
// y sin querer se perdió el filtro "solo visible" → estando en MH, editar un dato le cambiaba el
// valor a una traba que no se veía. El fix e2df9b1 restauró la invariante en ac2IdsSeleccionados()
// y _ac2DepurarSeleccionVisible(). Este test FALLA si alguien vuelve a romperla.
//
// No corre en producción, no toca la app. Es una verificación del código fuente. Correr con:
//   node tests/test_masiva_visible.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Cargar el módulo del creador en un sandbox con stubs mínimos de navegador ──
// El archivo es un script global de navegador (usa window/document y funciones ac2* globales).
// Le damos un DOM falso mínimo: solo lo que las funciones bajo prueba tocan indirectamente.
const SRC = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'cubicacion', 'agregar_cubicacion2.js');
const code = fs.readFileSync(SRC, 'utf8');

const noop = () => {};
const fakeEl = { style: {}, textContent: '', value: '', checked: false, indeterminate: false,
                 innerHTML: '', className: '', appendChild: noop, addEventListener: noop,
                 setAttribute: noop, getAttribute: () => null, focus: noop, select: noop, classList: { add: noop, remove: noop } };
const documentStub = {
  getElementById: () => null,          // ninguna función bajo prueba depende de un elemento real
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => Object.assign({}, fakeEl),
  body: Object.assign({}, fakeEl),
};
const sandbox = { console, window: {}, document: documentStub, setTimeout: (fn) => fn && fn() };
sandbox.window.document = documentStub;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'agregar_cubicacion2.js' });

// Alias a lo que vive en el scope global del módulo (declarado con var/function → va al sandbox).
const AC2 = sandbox.AC2;
const ac2Visibles = sandbox.ac2Visibles;
const ac2IdsSeleccionados = sandbox.ac2IdsSeleccionados;
const ac2SetTipo = sandbox.window.ac2SetTipo || sandbox.ac2SetTipo;

// ── Mini framework de aserciones ──
let fallos = 0;
function check(nombre, cond) {
  if (cond) { console.log('  ✓ ' + nombre); }
  else { console.log('  ✗ ' + nombre); fallos++; }
}
function setBarras(barras) { AC2.barras = barras; }
function idsVisibles() { return ac2Visibles().map(b => b._id).sort((a, b) => a - b); }

// ── Datos: 2 barras MH y 1 traba (marca 'TR'), con geometría mínima ──
function fixture() {
  return [
    { _id: 1, marca: 'MH', piso: 'P1', dim_b: 10 },
    { _id: 2, marca: 'MH', piso: 'P1', dim_b: 10 },
    { _id: 3, marca: 'TR', piso: 'P1', dim_b: 99 },   // la "traba" que NO debe verse en MH
  ];
}

console.log('TEST: invariante de masiva = solo lo visible');

// Escenario 1: en TODOS, todas son visibles.
setBarras(fixture()); AC2.masiva = true; AC2.orden = 'piso';
AC2.tipo = 'TODOS'; AC2.seleccion = { 1: true, 2: true, 3: true };
check('TODOS: ac2Visibles ve las 3', JSON.stringify(idsVisibles()) === JSON.stringify([1, 2, 3]));
check('TODOS: la masiva opera sobre las 3', JSON.stringify(ac2IdsSeleccionados().sort()) === JSON.stringify([1, 2, 3]));

// Escenario 2 (EL BUG): marco las 3 en TODOS y cambio a MH. La traba (id 3) NO debe entrar a la
// masiva aunque siga en AC2.seleccion. Este es exactamente el caso que te falló.
setBarras(fixture()); AC2.masiva = true; AC2.orden = 'piso';
AC2.seleccion = { 1: true, 2: true, 3: true };
AC2.tipo = 'MH';   // simular el cambio de tipología directo (sin depurar) …
check('MH: ac2Visibles solo ve MH (1,2)', JSON.stringify(idsVisibles()) === JSON.stringify([1, 2]));
check('MH: la masiva NO toca la traba (id 3) aunque esté marcada',
      JSON.stringify(ac2IdsSeleccionados().sort()) === JSON.stringify([1, 2]));

// Escenario 3: al cambiar de tipología, la selección se DEPURA (se quita del estado lo no visible).
// Probamos la unidad que hace ese trabajo (_ac2DepurarSeleccionVisible), que es lo que ac2SetTipo
// invoca; así no arrastramos ac2Render()/DOM. Simula: marqué en TODOS y ahora estoy en MH.
const depurar = sandbox._ac2DepurarSeleccionVisible;
if (typeof depurar === 'function') {
  setBarras(fixture()); AC2.masiva = true; AC2.orden = 'piso';
  AC2.seleccion = { 1: true, 2: true, 3: true }; AC2.tipo = 'MH';
  depurar();
  check('al pasar a MH, se depura la traba (id 3) del estado AC2.seleccion',
        AC2.seleccion[3] === undefined && AC2.seleccion[1] === true && AC2.seleccion[2] === true);
} else {
  console.log('  ! _ac2DepurarSeleccionVisible no accesible en sandbox (se omite escenario 3)');
}

// ── Resultado ──
if (fallos === 0) { console.log('\nOK: la invariante se cumple.'); process.exit(0); }
else { console.log('\nFALLÓ: ' + fallos + ' aserción(es). La masiva volvió a tocar barras no visibles.'); process.exit(1); }
