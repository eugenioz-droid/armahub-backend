// =============================================================================
// EL GESTO DE ESPEJAR — test headless (Node)
// =============================================================================
// El cálculo del espejo vive en el motor y lo congela test_espejo_componente.js.
// Acá se congela LO OTRO: el gesto de dos tiempos del editor, que es lo que el
// usuario aprieta.
//
// POR QUÉ DOS TIEMPOS. Una pieza puede espejarse contra tres planos distintos y el
// editor no puede adivinar cuál quiere el usuario. Así que el botón ARMA y el clic
// en una CARA del hormigón decide el eje —explícito, sin inferencias—. Eso también
// contesta la duda del usuario: «para las barras distribuidas en otros sentidos se
// puede enredar el comando, se necesita algún tipo de discriminante». El
// discriminante es la cara que se clica.
//
// QUÉ PROTEGE:
//   A. SIN SELECCIÓN, ARMA Y ESPERA — apretar el botón sin barra elegida no es un
//      error: pide la barra y sigue armado.
//   E+F. EL ORDEN NO IMPORTA — botón y después barra llega al mismo lugar que barra
//      y después botón, y un clic en una cara sin barra elegida no tumba el modo.
//   B. EL GESTO COMPLETO — armar, clic en una cara, y aparece la copia espejada
//      justo después del original, seleccionada, con el modo ya apagado.
//   C. SE PUEDE SALIR — Esc / volver a apretar el botón desarma sin crear nada.
//   D. UN CLIC, UNA COPIA — el modo se consume: el clic siguiente no espeja otra
//      vez (era el defecto del modo colocar antes de que se apagara solo).
//
// Correr con: node tests/test_espejo_gesto.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
const r2 = (v) => Math.round(Number(v) * 100) / 100;
const clon = (o) => JSON.parse(JSON.stringify(o));

// --------------------------------------------------------------- entorno mínimo
// Mismo mini-DOM que tests/test_cotas_vivas.js: acá se prueban la CUENTA y la
// ESCRITURA, que son funciones sobre la receta; el DOM real no hace falta.
function El() {
  this.style = {}; this.dataset = {}; this.children = []; this.className = ''; this.value = '';
  this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.setAttribute = function () {}; El.prototype.getAttribute = function () { return null; };
El.prototype.addEventListener = function () {}; El.prototype.removeEventListener = function () {};
El.prototype.querySelector = function () { return null; };
El.prototype.querySelectorAll = function () { return []; };
El.prototype.closest = function () { return null; };

const win = {};
win.window = win; win.self = win;
win.document = {
  body: new El(), documentElement: new El(), head: new El(),
  createElement: () => new El(), createElementNS: () => new El(), createTextNode: () => new El(),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}
};
win.console = console;
win.JSON = JSON; win.Math = Math; win.Date = Date; win.Object = Object; win.Array = Array;
win.Number = Number; win.String = String; win.Boolean = Boolean; win.isFinite = isFinite;
win.parseFloat = parseFloat; win.parseInt = parseInt; win.isNaN = isNaN; win.Error = Error;
win.Promise = Promise; win.RegExp = RegExp;
win.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
win.navigator = { userAgent: 'node' };
win.location = { href: 'http://x/', origin: 'http://x' };
win.fetch = () => Promise.reject(new Error('sin red'));
win.alert = () => {}; win.confirm = () => false;
win.setTimeout = () => 0; win.clearTimeout = () => {};
win.setInterval = () => 0; win.clearInterval = () => {};
win.requestAnimationFrame = () => 0; win.cancelAnimationFrame = () => {};
win.addEventListener = () => {}; win.removeEventListener = () => {};
win.getComputedStyle = () => ({});
win.devicePixelRatio = 1; win.innerWidth = 1200; win.innerHeight = 800;

const ctx = vm.createContext(win);
function mod(file, nombre) {
  const src = fs.readFileSync(path.join(BASE, file), 'utf8');
  const m = { exports: {} };
  vm.runInContext('(function(module, exports, require, global){' + src + '\n})', ctx, { filename: file })(m, m.exports, require, win);
  if (nombre) win[nombre] = m.exports;
  return m.exports;
}
mod('catalogo_figuras.js', 'ModeladorCatalogoFiguras');
mod('figura_puntos.js', 'ModeladorFiguraPuntos');
mod('motor_geom.js', 'ModeladorMotorGeom');
mod('reglas.js', 'ModeladorReglas');
mod('generar.js', 'ModeladorGenerar');
mod('semilla_viga.js', 'ModeladorSemilla');
vm.runInContext(fs.readFileSync(path.join(BASE, 'template_editor.js'), 'utf8'), ctx, { filename: 'template_editor.js' });

const R = win.ModeladorReglas;
const G = win.ModeladorGenerar;
const TE = win.TemplateEditor;
const ST = TE._ST;

const MURO = { largo: 600, alto: 250, ancho: 20, recub_sup: 2.5, recub_inf: 2.5, recub_lat: 2.5 };

function estribo() {
  return {
    comp_id: 'EC1', tipologia: 'EC', figura: '104D', diam: 8, jerarquia: 1,
    modo: 'puntual', plano_pieza: { volteado: false },
    pose: { cara: 'sup', lado: 1, rumbo: 'z' },
    dims: { A: { modo: 'fija', valor: 40 }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' },
    pos_hint: { x: -250 }
  };
}
function montar() {
  ST.receta = { tipo: 'muro', geometria: Object.assign({}, MURO), componentes: [estribo()] };
  ST.selCi = -1; ST.ultimoOut = null; ST.espejoPend = false;
  R.normalizarReceta(ST.receta);
  regen();
}
function regen() {
  R.reanclarReceta(ST.receta);
  const out = G.generarElemento(ST.receta);
  (out.placements || []).forEach((pl) => { pl.meta = pl.meta || {}; pl.meta.ci = 0; });
  ST.ultimoOut = out;
}
// La CARA que el usuario clica. En el editor sale de _facesDeVista; acá se pasa
// directo porque lo que se prueba es qué hace el editor CON ella, no cómo se elige.
const CARA_TESTERO = { cara: 'extremo', axis: 'x', sign: 1, edge: 'right', orient: 'v' };
const nComp = () => ST.receta.componentes.length;

// ============================================ A · SIN SELECCIÓN, ARMA Y ESPERA
// (25-ago) Antes NO armaba y se quedaba mudo: el usuario apretaba el botón, elegía
// la barra y no pasaba nada — «así que nada ocurre». Una herramienta se aprieta
// primero y se usa después, como el resto del editor, así que el modo arma igual y
// espera lo que falte.
console.log('A · el botón sin barra seleccionada arma y espera');
{
  montar();
  TE._armarEspejo();
  ok(ST.espejoPend === true, 'queda armado esperando la barra');
  ok(nComp() === 1, 'y no creó nada');
}

// ============================================================ B · EL GESTO COMPLETO
console.log('');
console.log('B · armar, clic en la cara, aparece la copia');
{
  montar();
  ST.selCi = 0;
  TE._armarEspejo();
  ok(ST.espejoPend === true, 'con una barra elegida el botón sí arma');

  TE._espejarEnCara(CARA_TESTERO);
  ok(nComp() === 2, 'el clic en la cara creó la copia (=' + nComp() + ')');
  ok(ST.selCi === 1, 'y la dejó seleccionada, justo después del original');
  ok(ST.espejoPend === false, 'el modo se apagó solo: es de un clic');

  const a = ST.receta.componentes[0], b = ST.receta.componentes[1];
  ok(b.tipologia === a.tipologia && b.figura === a.figura && b.diam === a.diam,
    'la copia es una copia: misma tipología, figura y diámetro');
  ok(JSON.stringify(b.dims) === JSON.stringify(a.dims), '…y las mismas medidas: un espejo no cambia largos');
  ok(b !== a, 'y es otro objeto, no una referencia');
}

// ================================================================ C · SE PUEDE SALIR
console.log('');
console.log('C · desarmar sin crear nada');
{
  montar();
  ST.selCi = 0;
  TE._armarEspejo();
  TE._salirEspejo();
  ok(ST.espejoPend === false, 'sale del modo');
  ok(nComp() === 1, 'sin haber creado nada');
}

// ============================================================ D · UN CLIC, UNA COPIA
console.log('');
console.log('D · el modo se consume: un clic, una copia');
{
  montar();
  ST.selCi = 0;
  TE._armarEspejo();
  TE._espejarEnCara(CARA_TESTERO);
  const tras1 = nComp();
  // Un segundo clic en la vista, con el modo YA apagado, no puede espejar de nuevo.
  ok(ST.espejoPend === false, 'tras espejar el modo está apagado');
  ok(tras1 === 2, 'y hay exactamente una copia (=' + tras1 + ')');
}

// ===================================================== E . EL ORDEN NO IMPORTA
// (25-ago) La primera version exigia elegir la barra ANTES de apretar el boton: sin
// seleccion no armaba y se quedaba muda. El usuario hizo lo natural -"presiono el
// boton, selecciono un componente y no aparecen las ayudas ni nada, asi que nada
// ocurre"-, porque una herramienta se aprieta primero y se usa despues, como el
// resto del editor.
console.log('');
console.log('E . apretar el boton primero y elegir la barra despues');
{
  montar();
  TE._armarEspejo();
  ok(ST.espejoPend === true, 'arma aunque no haya nada seleccionado');
  ok(nComp() === 1, 'sin crear nada, claro');

  ST.selCi = 0;                      // el usuario elige la barra con el modo ya armado
  ok(ST.espejoPend === true, 'elegir la barra no lo desarma');
  TE._espejarEnCara(CARA_TESTERO);
  ok(nComp() === 2, 'y el clic en la cara espeja igual que por el otro camino');
  ok(ST.espejoPend === false, 'dejando el modo apagado');
}

// ======================================== F . SIN BARRA ELEGIDA NO ESPEJA NADA
console.log('');
console.log('F . con el modo armado pero sin barra, el clic en una cara no crea nada');
{
  montar();
  TE._armarEspejo();
  ST.selCi = -1;
  TE._espejarEnCara(CARA_TESTERO);
  ok(nComp() === 1, 'no se creo ninguna copia');
  ok(ST.espejoPend === true, 'y el modo sigue esperando la barra, no se cae');
}

console.log(fallos ? (fallos + ' FALLO(S)') : 'OK — el gesto de espejar está congelado');
process.exit(fallos ? 1 : 0);
