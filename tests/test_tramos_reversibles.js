// =============================================================================
// TRAMOS REVERSIBLES (20-ago) — test headless (Node)
// =============================================================================
// EL DEFECTO QUE CONGELA. Una distribución con confinamiento —100 @10 / 320 @20 /
// 100 @10 sobre un rango de 520 cm— se achicaba hasta consumir el tramo del medio
// y al volver a agrandarla NO devolvía lo declarado: 520 → 150 → 520 terminaba en
// 100/370/50. Se habían perdido 50 cm de confinamiento en el extremo lejano, sin
// una palabra y sin que el usuario tocara un solo tramo.
//
// LA CAUSA. _syncTramos persistía el reparto YA RESUELTO (_tramosDe, que además de
// estirar el tramo del medio CLAMPEA cada tramo contra el fin del rango): el
// recorte quedaba escrito en la receta y al reagrandar el elástico repartía sobre
// el destrozo.
//
// LA REGLA NUEVA, que es lo que este archivo defiende:
//   A. IDA Y VUELTA — achicar y reagrandar devuelve EXACTAMENTE lo declarado.
//   B. LA RECETA GUARDA LO DECLARADO — el recorte vive en la LECTURA (_tramosDe),
//      no en el dato: los centímetros de los extremos sobreviven al achique.
//   C. PANEL Y MOTOR DICEN LO MISMO — con el rango achicado, el @ que llena la
//      cola es el del tramo que muestra el panel, no otro.
//   D. LAS EDICIONES DE VERDAD SÍ ESCRIBEN — _setLongTramo/_addTramo/_delTramo son
//      el usuario cambiando un tramo, que no es lo mismo que un rango que se
//      achicó: esos siguen tocando la receta.
//   E. EL CAMINO REAL — la misma ida y vuelta por _setLargoRango (el rótulo de
//      pantalla y el campo del panel), con la receta montada en el editor.
//
// Correr con: node tests/test_tramos_reversibles.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

// --------------------------------------------------------------- entorno mínimo
// Mismo mini-DOM que tests/test_cotas_lados.js: acá se prueban la CUENTA del largo,
// la ESCRITURA y el CAMINO DE DIBUJO; el DOM real no hace falta.
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
vm.runInContext(fs.readFileSync(path.join(BASE, 'template_editor.js'), 'utf8'), ctx, { filename: 'template_editor.js' });

const R = win.ModeladorReglas;
const TE = win.TemplateEditor;
const ST = TE._ST;

const GEO = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const r1 = (v) => Math.round(Number(v) * 10) / 10;
const longs = (a) => a.map((t) => r1(t.long));
const seps = (a) => a.map((t) => Number(t.sep));

// Distribución con tramos, centrada en el elemento: es como la escribe el editor
// sobre el eje x (from/to a media distancia del origen).
function dist(span, tramos) {
  return {
    modo: 'linear', activa: true, sep: tramos[0].sep,
    rango: { eje: 'x', from: -span / 2, to: span / 2, sep: tramos[0].sep,
             tramos: tramos.map((t) => ({ long: t.long, sep: t.sep })) }
  };
}
// Cambiar el LARGO del rango es exactamente lo que hacen el arrastre del handle, el
// campo from/to del panel y el rótulo de pantalla: mover `to` y sincronizar.
function estirar(d, span) { d.rango.to = d.rango.from + span; TE._syncTramos(d); }

// ---------------------------------------------------------------------------
console.log('\nA · IDA Y VUELTA');
// ---------------------------------------------------------------------------
{
  const d = dist(520, [{ long: 100, sep: 10 }, { long: 320, sep: 20 }, { long: 100, sep: 10 }]);
  estirar(d, 150);   // el rango se come el tramo del medio Y parte del último
  estirar(d, 520);   // …y vuelve
  ok(String(longs(TE._tramosDe(d))) === '100,320,100',
    '520 → 150 → 520 devuelve 100/320/100 (el defecto daba 100/370/50) [' + longs(TE._tramosDe(d)) + ']');
  ok(String(seps(TE._tramosDe(d))) === '10,20,10', 'y cada tramo con su @ [' + seps(TE._tramosDe(d)) + ']');

  // Varias vueltas seguidas, y pasando por un span que ni siquiera da para el 1er
  // tramo: la receta tiene que aguantar el viaje entero, no sólo una ida.
  const e = dist(520, [{ long: 100, sep: 10 }, { long: 320, sep: 20 }, { long: 100, sep: 10 }]);
  [150, 60, 300, 40, 520].forEach((s) => estirar(e, s));
  ok(String(longs(TE._tramosDe(e))) === '100,320,100',
    'cinco achiques y agrandes seguidos tampoco lo desgastan [' + longs(TE._tramosDe(e)) + ']');

  // Cuatro tramos (dos «del medio»): el elástico reparte entre los dos y los
  // EXTREMOS —que son el confinamiento declarado— vuelven intactos.
  const f = dist(400, [{ long: 80, sep: 10 }, { long: 120, sep: 20 }, { long: 120, sep: 20 }, { long: 80, sep: 10 }]);
  estirar(f, 120); estirar(f, 400);
  ok(String(longs(TE._tramosDe(f))) === '80,120,120,80',
    'con 4 tramos también cierra el viaje [' + longs(TE._tramosDe(f)) + ']');
}

// ---------------------------------------------------------------------------
console.log('\nB · LA RECETA GUARDA LO DECLARADO; EL RECORTE ES DE LECTURA');
// ---------------------------------------------------------------------------
{
  const d = dist(520, [{ long: 100, sep: 10 }, { long: 320, sep: 20 }, { long: 100, sep: 10 }]);
  estirar(d, 150);
  const guardado = longs(d.rango.tramos);
  ok(guardado[0] === 100 && guardado[2] === 100,
    'achicar NO borra los centímetros declarados de los extremos [' + guardado + ']');
  // El del medio SÍ se mueve: es un derivado (lo que sobra), no un dato del usuario.
  ok(guardado[1] === 0, 'el tramo del medio se consume, que es su oficio [' + guardado[1] + ']');
  // Y la LECTURA —la que ven el panel y la flecha— sí muestra el recorte.
  ok(String(longs(TE._tramosDe(d))) === '100,0,50',
    'el panel muestra el recorte: 100/0/50 en 150 cm [' + longs(TE._tramosDe(d)) + ']');
}

// ---------------------------------------------------------------------------
console.log('\nC · PANEL Y MOTOR REPARTEN IGUAL');
// ---------------------------------------------------------------------------
{
  // Con el rango achicado, los últimos 50 cm son del TERCER tramo (@10), no del
  // segundo (@20). Si la receta guardara el declarado a secas, posicionesRango
  // encadenaría desde `from` y llenaría esa cola con el @20 del medio: el dibujo
  // diría una cosa y las barras otra.
  const d = dist(520, [{ long: 100, sep: 10 }, { long: 320, sep: 20 }, { long: 100, sep: 10 }]);
  estirar(d, 150);
  const pos = R.posicionesRango(d.rango, d.sep).map((x) => r1(x));
  const paso = [];
  for (let i = 1; i < pos.length; i++) paso.push(r1(pos[i] - pos[i - 1]));
  ok(paso.indexOf(20) < 0,
    'la cola del rango achicado sale con el @ del tramo que muestra el panel [' + paso + ']');
  ok(r1(pos[0]) === r1(d.rango.from) && r1(pos[pos.length - 1]) === r1(d.rango.to),
    'y el reparto sigue empezando y terminando en el rango [' + pos[0] + ' → ' + pos[pos.length - 1] + ']');
}

// ---------------------------------------------------------------------------
console.log('\nD · LAS EDICIONES DE VERDAD SÍ ESCRIBEN');
// ---------------------------------------------------------------------------
{
  const d = dist(520, [{ long: 100, sep: 10 }, { long: 320, sep: 20 }, { long: 100, sep: 10 }]);
  TE._setLongTramo(d, 0, 150);            // mover el límite: el vecino compensa
  ok(String(longs(d.rango.tramos)) === '150,270,100',
    '_setLongTramo escribe en la receta [' + longs(d.rango.tramos) + ']');
  const antes = d.rango.tramos.length;
  TE._addTramo(d);
  ok(d.rango.tramos.length === antes + 1, '_addTramo escribe en la receta');
  TE._delTramo(d, d.rango.tramos.length - 1);
  ok(d.rango.tramos.length === antes, '_delTramo escribe en la receta');
  // Y lo editado también aguanta el viaje.
  estirar(d, 150); estirar(d, 520);
  ok(String(longs(TE._tramosDe(d))) === '150,270,100',
    'lo que el usuario acaba de editar también vuelve entero [' + longs(TE._tramosDe(d)) + ']');
}

// ---------------------------------------------------------------------------
console.log('\nE · EL CAMINO REAL (_setLargoRango, con la receta montada)');
// ---------------------------------------------------------------------------
{
  // _setLargoRango es lo que corren el rótulo de pantalla y el campo del panel:
  // ancla, sincroniza la cantidad y llama a _syncTramos. Con la receta montada
  // pasa además por el anclaje contra el hormigón, que es el caso de verdad.
  const d = dist(520, [{ long: 100, sep: 10 }, { long: 320, sep: 20 }, { long: 100, sep: 10 }]);
  ST.receta = { tipo: 'viga', geometria: Object.assign({}, GEO), componentes: [{
    comp_id: 'E1', jerarquia: 2, tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral',
    angulos: [135, 135], modo: 'lineal', plano_pieza: { orientacion: 'acostada', volteado: false },
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: d
  }] };
  ST.selCi = 0;
  TE._setLargoRango(d, 'rango', 150, 'x');
  TE._setLargoRango(d, 'rango', 520, 'x');
  ok(String(longs(TE._tramosDe(d))) === '100,320,100',
    'por el camino del rótulo también cierra [' + longs(TE._tramosDe(d)) + ']');
  ST.selCi = -1; ST.receta = null;
}

console.log(fallos ? ('\n' + fallos + ' FALLO(S)') : '\nTODO OK');
process.exit(fallos ? 1 : 0);
