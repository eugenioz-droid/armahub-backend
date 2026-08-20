// =============================================================================
// DESPLAZAMIENTO MEDIDO CON CARA DE REFERENCIA (21-ago) — test headless (Node)
// =============================================================================
// El usuario: «no hay forma de decir que esta pieza va a tantos centímetros de esta
// cara; sólo se puede dar una medida absoluta o dejar que la pieza llene el
// hormigón», así que toda colocación deliberada se hacía arrastrando a mano y se
// perdía el control del número. Lo necesita para una segunda capa de cabezales sin
// arrastrarla y para colocar estribos de confinamiento de a uno.
//
// QUÉ CONGELA ESTE TEST
// -----------------------------------------------------------------------------
//   A. EJES EN LOS QUE APLICA — el eje por el que REPARTE una distribución queda
//      fuera (ahí manda el rango, y el editor borra el hint de ese eje al encender
//      el abanico); en un ARREGLO, también el de la 2ª línea. Sin distribución
//      activa, los tres.
//   B. LA CARA LA ELIGE EL MOTOR — la que muestra la ficha es exactamente la que
//      devuelve reglas.anclaDeCoord (la más cercana), no una cuenta propia.
//   C. EL NÚMERO ESCRITO ES EL QUE QUEDA — se teclea una distancia y la pieza queda
//      ahí, medida sobre lo que el motor generó de verdad.
//   D. …Y SOBREVIVE AL HORMIGÓN — es EL pedido: al cambiar el elemento, la pieza
//      conserva esa distancia a SU cara (no se queda clavada en su coordenada ni la
//      empuja el cambio). Sin esto, un template no sirve para otro elemento.
//   E. MISMA PUERTA QUE EL ARRASTRE — escribir deja el mismo rastro que mover con la
//      mano: pos_hint escrito + pos_ancla invalidada, para que el motor la re-estampe
//      al expandir. Si la ficha escribiera el ancla por su cuenta, el número tecleado
//      y el gesto podrían discrepar.
//   F. CAMBIAR LA CARA NO MUEVE NADA — el selector sólo dice desde dónde se mide: los
//      dos huecos más el ancho de la pieza suman el elemento, y la barra no se movió.
//   G. LA Y DE UN CABEZAL — el caso que el usuario pidió (segunda capa de cabezales
//      sin arrastrarla): el eje de la cara contra la que se ancla SÍ acepta el
//      desplazamiento, y también conserva la distancia al cambiar el hormigón.
//
// Correr con: node tests/test_desplazamiento_medido.js

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

const GEO = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

// UNA sola pieza por receta: así el etiquetado de meta.ci es exacto sin depender de
// cómo se reparten los placements entre componentes.
function montar(comp, geo) {
  ST.receta = { tipo: 'viga', geometria: Object.assign({}, geo || GEO), componentes: [comp] };
  ST.selCi = 0;
  ST.ultimoOut = null;
  ST.dragMove = null; ST.dragMarco = null; ST.dragRango = null;
  return ST.receta.componentes[0];
}
// El mismo orden del editor: re-anclar la receta contra el hormigón de AHORA y
// generar. Es lo que hace _regenerar (que no se llama acá porque arrastra medio
// panel de DOM detrás); lo que se prueba es el resultado del motor, no el repintado.
function regenerar() {
  R.reanclarReceta(ST.receta);
  const out = G.generarViga(ST.receta);
  (out.placements || []).forEach((pl) => { pl.meta = pl.meta || {}; pl.meta.ci = 0; });
  ST.ultimoOut = out;
  return out;
}
function hueco(eje, ref) { return r2(TE._huecoACara(TE._bboxCompMundo(0), eje, ref)); }

function estribo(extra) {
  const c = {
    comp_id: 'E1', jerarquia: 2, tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral',
    angulos: [135, 135], modo: 'puntual', plano_pieza: { orientacion: 'acostada', volteado: false },
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' }
  };
  for (const k in (extra || {})) c[k] = extra[k];
  return c;
}

// ============================================================ A · ejes que aplican
console.log('\nA · en qué ejes se ofrece el desplazamiento');
{
  const suelto = montar(estribo());
  regenerar();
  ok(TE._ejesDesplazables(suelto).join(',') === 'x,y,z',
    'sin distribución activa se ofrecen los tres ejes (=' + TE._ejesDesplazables(suelto).join(',') + ')');

  const reparte = montar(estribo({
    modo: 'lineal',
    distribucion: { modo: 'linear', activa: true, sep: 20, rango: { from: -290, to: 290, sep: 20, eje: 'x' } }
  }));
  regenerar();
  const ejes = TE._ejesDesplazables(reparte);
  ok(ejes.indexOf('x') < 0, 'el eje por el que REPARTE queda fuera: ahí la posición la manda el rango');
  ok(ejes.join(',') === 'y,z', '…y los otros dos siguen ofreciéndose (=' + ejes.join(',') + ')');

  const area = montar(estribo({
    modo: 'arreglo',
    distribucion: {
      modo: 'arreglo', activa: true, sep: 20,
      rango: { from: -290, to: 290, sep: 20, eje: 'x' },
      rango2: { from: -26, to: 26, sep: 15, eje: 'y' }
    }
  }));
  regenerar();
  ok(TE._ejesDesplazables(area).join(',') === 'z',
    'en un ARREGLO también sale el eje de la 2ª línea: queda un solo eje libre (=' +
    TE._ejesDesplazables(area).join(',') + ')');
}

// ======================================================= B · la cara la elige el motor
console.log('\nB · la cara de referencia es la que elige el motor');
{
  const c = montar(estribo());
  regenerar();
  const bb = TE._bboxCompMundo(0);
  ['x', 'y', 'z'].forEach((eje) => {
    const dim = (eje === 'y') ? GEO.alto : (eje === 'z' ? GEO.ancho : GEO.largo);
    const delMotor = R.anclaDeCoord(bb[eje].c, dim).ref;
    ok(TE._caraRefEje(c, eje, bb) === delMotor,
      'eje ' + eje + ': la ficha muestra la cara del motor (' + delMotor + ')');
  });
  // …y con ancla ya estampada manda la del ancla, no una re-derivación paralela.
  c.pos_hint = { x: -285 };
  regenerar();
  ok(c.pos_ancla && c.pos_ancla.x && TE._caraRefEje(c, 'x', TE._bboxCompMundo(0)) === c.pos_ancla.x.ref,
    'con ancla estampada, la ficha muestra ESA cara (=' + JSON.stringify(c.pos_ancla.x) + ')');
}

// ================================ C+D+E · el número escrito queda, y sobrevive al hormigón
console.log('\nC+D+E · se teclea la distancia, la pieza queda ahí y la conserva');
{
  const c = montar(estribo());
  regenerar();
  ok(TE._setHuecoACara(0, 'x', 'min', 15), 'la ficha acepta escribir 15 cm al testero inicio');
  ok(c.pos_hint && isFinite(Number(c.pos_hint.x)),
    'E · escribió pos_hint, que es la MISMA puerta que usa el arrastre (=' + JSON.stringify(c.pos_hint) + ')');
  ok(!(c.pos_ancla && c.pos_ancla.x),
    'E · …y dejó el ancla invalidada: la estampa el motor al expandir, no la ficha');
  regenerar();
  ok(hueco('x', 'min') === 15, 'C · la pieza quedó a 15 cm del testero (=' + hueco('x', 'min') + ')');
  ok(c.pos_ancla && c.pos_ancla.x && c.pos_ancla.x.ref === 'min' && c.pos_ancla.x.mide === 'pos',
    'E · el motor estampó el ancla de POSICIÓN contra esa cara (=' + JSON.stringify(c.pos_ancla.x) + ')');

  // EL PEDIDO: cambiar el hormigón y que la pieza conserve SU distancia a la cara.
  ST.receta.geometria.largo = 800; regenerar();
  ok(hueco('x', 'min') === 15, 'D · con la viga a 800 sigue a 15 cm del testero (=' + hueco('x', 'min') + ')');
  ST.receta.geometria.largo = 400; regenerar();
  ok(hueco('x', 'min') === 15, 'D · …y a 400 también (=' + hueco('x', 'min') + ')');

  // La otra cara: escribir contra 'max' ancla contra 'max' y también se conserva.
  ST.receta.geometria.largo = 600; regenerar();
  TE._setHuecoACara(0, 'x', 'max', 20); regenerar();
  ok(hueco('x', 'max') === 20, 'C · 20 cm al testero fin (=' + hueco('x', 'max') + ')');
  ok(c.pos_ancla.x.ref === 'max', 'E · el ancla siguió a la cara desde la que se midió');
  ST.receta.geometria.largo = 900; regenerar();
  ok(hueco('x', 'max') === 20, 'D · con la viga a 900 sigue a 20 cm del testero fin (=' + hueco('x', 'max') + ')');
}

// ============================================ F · cambiar la cara no mueve la pieza
console.log('\nF · el selector de cara sólo cambia desde dónde se mide');
{
  const c = montar(estribo());
  regenerar();
  TE._setHuecoACara(0, 'x', 'min', 40); regenerar();
  const antes = clon(c.pos_hint);
  const bb = TE._bboxCompMundo(0);
  const hMin = r2(TE._huecoACara(bb, 'x', 'min'));
  const hMax = r2(TE._huecoACara(bb, 'x', 'max'));
  const ancho = r2(bb.x.hi - bb.x.lo);
  ok(hMin === 40, 'el hueco al testero inicio es el que se escribió (=' + hMin + ')');
  ok(r2(hMin + ancho + hMax) === r2(ST.receta.geometria.largo),
    'los dos huecos + la pieza suman el elemento (' + hMin + ' + ' + ancho + ' + ' + hMax + ')');
  ok(JSON.stringify(c.pos_hint) === JSON.stringify(antes),
    'leer la distancia a la otra cara NO tocó la receta');
}

// ======================================== G · la Y de un cabezal (el caso del usuario)
console.log('\nG · segunda capa de cabezales: distancia a la cara superior');
{
  const semilla = win.ModeladorSemilla.semillaViga();
  const cbs = semilla.componentes.find((x) => x.comp_id === 'CBS');
  const c = montar(clon(cbs));
  regenerar();
  ok(TE._ejesDesplazables(c).indexOf('y') >= 0,
    'el eje de la cara contra la que se ancla el cabezal SÍ se ofrece (el arrastre no lo escribe)');
  ok(TE._setHuecoACara(0, 'y', 'max', 12), 'se escriben 12 cm a la cara superior');
  regenerar();
  ok(hueco('y', 'max') === 12, 'el cabezal quedó a 12 cm de la cara superior (=' + hueco('y', 'max') + ')');
  ST.receta.geometria.alto = 90; regenerar();
  ok(hueco('y', 'max') === 12,
    'con la viga de 90 de alto sigue a 12 cm de la cara superior (=' + hueco('y', 'max') + ')');
}

// ======================================== H · la fila se arma (camino DOM de la ficha)
console.log('\nH · la ficha arma una fila por eje libre');
{
  const c = montar(estribo({
    modo: 'lineal',
    distribucion: { modo: 'linear', activa: true, sep: 20, rango: { from: -290, to: 290, sep: 20, eje: 'x' } }
  }));
  regenerar();
  const body = new El();
  TE._filasDesplazamiento(body, c, 0);
  ok(body.children.length === 2,
    'dos ejes libres → dos filas en la ficha (=' + body.children.length + ')');
  const vacio = new El();
  ST.ultimoOut = null;                       // todavía no se generó nada
  TE._filasDesplazamiento(vacio, c, 0);
  ok(vacio.children.length === 0,
    'sin nada generado no se rotula una distancia inventada');
}

console.log(fallos ? ('\n' + fallos + ' FALLO(S)') : '\nOK — el desplazamiento medido está congelado');
process.exit(fallos ? 1 : 0);
