// =============================================================================
// BAR MANAGER — LAS CELDAS DE TEXTO NO PASAN POR parseFloat (bug del 25-ago)
// =============================================================================
// Al hacer editable el CICLO aparecio un defecto vivo desde antes: el
// normalizador de celdas tenia UNA sola excepcion de texto escrita a mano
//
//     if (campo === 'figura') return (val === '') ? null : val;
//     ...
//     return parseFloat(val);
//
// y cuando se sumaron columnas de texto -- el nombre del PLANO y el SUFIJO de
// tipologia -- nadie la actualizo. Escribir "Plano-3" daba NaN, viajaba como
// null en el PATCH y el backend lo leia como "vaciar el campo": editar el plano
// en el Bar Manager lo BORRABA en vez de escribirlo. Solo funcionaba si el texto
// que escribias era un numero.
//
// El arreglo no es alargar la lista -- la proxima columna de texto la volveria a
// dejar desactualizada. La CELDA YA SABE LO QUE ES: los campos numericos se
// pintan con <input type="number"> y los de texto con type="text". Se le
// pregunta al input.
//
// Correr con: node tests/test_barmanager_texto.js
// =============================================================================

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  X ' + m); fallos++; } else { console.log('  ok ' + m); } }

const noop = function () {};
const SRC = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'cubicacion', 'barmanager_edit.js');
const sb = {
  console: { log: noop, warn: noop, error: noop },
  document: { getElementById: function () { return null; }, querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function () { return { style: {}, appendChild: noop, addEventListener: noop }; },
    body: { appendChild: noop } },
  setTimeout: function (f) { return f && f(); }, showToast: noop, alert: noop, addEventListener: noop
};
sb.window = sb; sb.global = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sb, { filename: 'barmanager_edit.js' });

// Celda como la pinta barmanager.js: los numericos type="number", los de texto type="text".
function celda(id, campo, valor, tipo) {
  return {
    getAttribute: function (k) {
      return k === 'data-barra-id' ? id : (k === 'data-campo' ? campo : null);
    },
    value: valor, type: tipo, style: {}
  };
}
function escribir(id, campo, valor, tipo) {
  sb.bmRegistrarCambio(celda(id, campo, valor, tipo));
  return sb.bmValorEfectivoCelda(id, campo, '(valor viejo)').valor;
}

console.log('A - LAS COLUMNAS DE TEXTO LLEGAN COMO TEXTO');
ok(escribir('1', 'nombre_plano', 'Plano-3', 'text') === 'Plano-3',
  'nombre_plano: "Plano-3" se guarda tal cual (antes salia NaN -> null -> lo BORRABA)');
ok(escribir('1', 'suf_tipo', 'sup', 'text') === 'sup',
  'suf_tipo: "sup" se guarda tal cual');
ok(escribir('1', 'ciclo', 'C12', 'text') === 'C12',
  'ciclo: "C12" se guarda tal cual (la columna nueva)');
ok(escribir('1', 'figura', '103A', 'text') === '103A',
  'figura: sigue funcionando (era la unica excepcion escrita a mano)');

console.log('');
console.log('B - LAS COLUMNAS NUMERICAS SIGUEN SIENDO NUMEROS');
var d = escribir('2', 'diam', '16', 'number');
ok(d === 16 && typeof d === 'number', 'diam: "16" -> 16 numerico (=' + JSON.stringify(d) + ')');
var dimB = escribir('2', 'dim_b', '592.5', 'number');
ok(dimB === 592.5, 'dim_b: acepta decimales (=' + dimB + ')');
ok(escribir('2', 'dim_c', '', 'number') === null,
  'dim_c vacio -> null: vaciar un lado sigue queriendo decir "borrar ese lado" (5M.4)');

console.log('');
console.log('C - VACIAR UNA CELDA DE TEXTO TAMBIEN ES null');
ok(escribir('3', 'nombre_plano', '', 'text') === null,
  'un texto vacio sigue siendo null (el backend lo traduce a "sin plano")');
// El ciclo vacio NO se defiende aca: lo rechaza el backend con 400, que es donde
// vive la regla ("toda barra tiene ciclo"). Ver barras.py::_editar_barra_impl.

console.log('');
console.log(fallos ? (fallos + ' FALLO(S)') : 'TODO OK');
process.exitCode = fallos ? 1 : 0;
