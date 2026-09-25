// Test headless (Node) del creador de despieces: los controles construidos a partir de DATOS
// tienen que funcionar aunque el dato traiga un apóstrofe.
//
// EL BUG (reportado por un usuario el 25-sep): en un despiece de LOSA, las tipologías F'i,
// F's y F' no se podían elegir. El botón se armaba pegando el código dentro del onclick
//   onclick="ac2SetTipo('F'i')"
// y el apóstrofe cerraba el texto antes de tiempo: el navegador ni siquiera podía leer el
// onclick y el clic moría sin error visible. Esas tipologías estuvieron muertas en el editor
// desde que existe (0 barras manuales con ellas; las que hay entraron por CSV). Afecta a
// losa (F', F'i, F's), fundación (F'i, F's) y genérico (F').
//
// Lo mismo pasaba con otros dos controles que pegan un dato en el onclick: las flechas de
// "mover piso" (nombre del grupo) y la ✕ de quitar un piso/ciclo en Configuración de obra.
//
// LO QUE FIJA ESTE TEST: no se construye código a partir de datos. El dato vive en un
// atributo data-* y el onclick lo lee de ahí. Se comprueba EJECUTANDO el onclick generado,
// como haría el navegador al clicar: si alguien vuelve a pegar el código en el texto, el
// onclick con 'F'i' ni siquiera compila y el test falla acá, no en la pantalla del usuario.
//
// Correr con: node tests/test_ac2_tipologia_apostrofe.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'cubicacion', 'agregar_cubicacion2.js');
const code = fs.readFileSync(SRC, 'utf8');

// ── Sandbox mínimo: el módulo es un script global de navegador. Le damos un document falso
//    que devuelve un elemento capturador por id (sólo se usa innerHTML).
//    DURANTE LA CARGA devuelve null, igual que tests/test_masiva_visible.js: así el módulo no
//    arranca su inicialización de pantalla (que necesita el DOM real). Después de cargar, sí
//    entrega elementos, para que ac2PintarSubtabs tenga dónde pintar.
const noop = () => {};
const elementos = {};
let cargando = true;
function elemento(id) {
  if (!elementos[id]) {
    elementos[id] = { id, style: {}, textContent: '', value: '', checked: false, innerHTML: '',
      className: '', appendChild: noop, addEventListener: noop, setAttribute: noop,
      getAttribute: () => null, focus: noop, select: noop, classList: { add: noop, remove: noop } };
  }
  return elementos[id];
}
const documentStub = {
  getElementById: (id) => (cargando ? null : elemento(id)),
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => elemento('__nuevo_' + Math.random()),
  body: elemento('__body'),
};
const sandbox = { console, window: {}, document: documentStub, setTimeout: (fn) => fn && fn() };
sandbox.window.document = documentStub;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'agregar_cubicacion2.js' });
cargando = false;

let fallos = 0;
function ok(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { console.log('  ✗ ' + msg); fallos++; } }

// ── Herramientas: leer atributos de una etiqueta y EJECUTAR su onclick como el navegador ──
// El navegador decodifica las entidades del atributo antes de entregar dataset; ac2Esc sólo
// produce estas cuatro.
function decodificar(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function etiquetas(html, tag) { return html.match(new RegExp('<' + tag + '\\b[^>]*>', 'g')) || []; }
function attr(tag, nombre) {
  const m = new RegExp('\\s' + nombre + '="([^"]*)"').exec(tag);
  return m ? decodificar(m[1]) : null;
}
function dataset(tag) {
  const d = {};
  const re = /\sdata-([a-z]+)="([^"]*)"/g;
  let m; while ((m = re.exec(tag))) d[m[1]] = decodificar(m[2]);
  return d;
}
// Ejecuta el onclick DENTRO del sandbox (donde viven las funciones ac2*), con `this` = el
// elemento clicado. Un onclick que no compila lanza acá: es exactamente el síntoma del bug.
function clicar(tag) {
  const src = attr(tag, 'onclick');
  const fn = vm.runInContext('(function(){ ' + src + ' })', sandbox);
  fn.call({ dataset: dataset(tag) });
}

// ================================================================ 1 · TIPOLOGÍAS
console.log('1 — los botones de tipología con apóstrofe se pueden clicar (F\'i, F\'s, F\')');
{
  const CODIGOS = ['Fi', 'Fs', "F'i", "F's", 'F', "F'", 'SP', 'Rp', 'TRL'];   // la losa real
  sandbox.AC2_TIPOS = CODIGOS.slice();
  const recibidos = [];
  sandbox.ac2SetTipo = (t) => recibidos.push(t);          // stub: sólo interesa QUÉ le llega
  sandbox.ac2PintarSubtabs();
  const html = elemento('ac2_subtabs').innerHTML;
  const botones = etiquetas(html, 'button').filter(b => /\sid="ac2t_/.test(b) && !/ac2t_TODOS/.test(b));
  ok(botones.length === CODIGOS.length, 'se pinta un botón por tipología (' + botones.length + ' de ' + CODIGOS.length + ')');
  let compilan = true;
  botones.forEach(b => { try { clicar(b); } catch (e) { compilan = false; console.log('     onclick roto: ' + attr(b, 'onclick') + ' → ' + e.message); } });
  ok(compilan, 'TODOS los onclick compilan y se ejecutan (el del bug ni compilaba)');
  ok(JSON.stringify(recibidos) === JSON.stringify(CODIGOS),
    'y cada clic le entrega a ac2SetTipo EXACTAMENTE su código, apóstrofe incluido: ' + JSON.stringify(recibidos));
  ok(botones.every(b => !/ac2SetTipo\('/.test(attr(b, 'onclick'))),
    'ningún onclick lleva el código pegado como texto (vive en data-tipo)');
}

// ================================================================ 2 · MOVER PISO
console.log('2 — las flechas de "mover piso" funcionan con un nombre de piso con apóstrofe');
{
  const AC2 = sandbox.AC2;
  AC2.masiva = false; AC2.tipo = 'TODOS'; AC2.verMult = false; AC2.render = true;
  const movidos = [];
  sandbox.ac2MoverGrupo = (valor, dir) => movidos.push([valor, dir]);
  const html = sandbox.ac2GrupoHdr("P1'", 2, true);
  const flechas = etiquetas(html, 'button');
  ok(flechas.length === 2, 'hay dos flechas (subir / bajar)');
  let compilan = true;
  flechas.forEach(b => { try { clicar(b); } catch (e) { compilan = false; } });
  ok(compilan, 'las dos se ejecutan');
  ok(movidos.length === 2 && movidos.every(m => m[0] === "P1'") &&
     movidos.map(m => m[1]).sort().join() === '-1,1',
    'y mueven el grupo correcto: ' + JSON.stringify(movidos));
}

// ================================================================ 3 · CONFIGURACIÓN DE OBRA
console.log('3 — la ✕ de quitar un piso/ciclo funciona con un nombre con apóstrofe');
{
  const quitados = [];
  sandbox.ac2CfgQuitar = (tipo, v) => quitados.push([tipo, v]);
  const html = sandbox.ac2CfgSeccionLista('Pisos', 'pisos', ['P1', "P2'"], {}, '');
  const equis = etiquetas(html, 'span').filter(s => /ac2CfgQuitar/.test(s));
  ok(equis.length === 2, 'hay una ✕ por valor');
  let compilan = true;
  equis.forEach(s => { try { clicar(s); } catch (e) { compilan = false; } });
  ok(compilan, 'las dos se ejecutan');
  ok(JSON.stringify(quitados) === JSON.stringify([['pisos', 'P1'], ['pisos', "P2'"]]),
    'y quitan el valor correcto: ' + JSON.stringify(quitados));
}

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exit(fallos ? 1 : 0);
