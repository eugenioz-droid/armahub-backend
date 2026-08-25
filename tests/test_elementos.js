// =============================================================================
// LOS CINCO ELEMENTOS DEL TEMPLATE EDITOR — test headless (Node)
// =============================================================================
// Hasta el 25-ago sólo VIGA y MURO se podían abrir. Los otros aparecían en el
// selector como «próximamente» porque les faltaba la mitad de las tablas —y, peor,
// porque COLUMNA / FUNDACIÓN / GEN declaraban sus dimensiones con CLAVES PROPIAS
// ('b', 'h', 'espesor', 'recub') que el motor no conoce: sólo entiende
// largo/alto/ancho y recub_sup/inf/lat. Una geometría con esas claves llegaba vacía
// al motor.
//
// Instrucción del usuario, literal: «Columna debería ser exactamente igual a Muro.
// Gen déjalo igual al de vigas. El de fund también lo puedes implementar igual al de
// vigas». LOSA queda fuera, también decisión suya: «va a ser difícil sacarle
// provecho, capaz que nunca lo implementemos» — y este test lo deja explícito, para
// que su ausencia se lea como una decisión y no como un olvido.
//
// QUÉ PROTEGE:
//   A. LOS CINCO ESTÁN COMPLETOS — planos de trabajo, campos de geometría,
//      tipologías y dimensiones. Y losa NO, a propósito.
//   B. TODOS HABLAN LAS CLAVES DEL MOTOR — ningún elemento declara dimensiones que
//      el motor no sepa leer. Es el defecto que los tenía muertos.
//   C. SE PUEDE COLOCAR UNA BARRA EN CADA UNO — el gesto completo, de punta a
//      punta: clic → componente → generación → barras con geometría real.
//
// Correr con: node tests/test_elementos.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

const creados = [];
function El(tag) {
  this.tag = tag || 'div';
  this.attrs = {}; this.style = {}; this.dataset = {}; this.children = [];
  this.className = ''; this.value = ''; this.textContent = '';
  this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}
El.prototype.appendChild = function (c) { this.children.push(c); c._padre = this; return c; };
El.prototype.removeChild = function (c) {
  const i = this.children.indexOf(c);
  if (i >= 0) this.children.splice(i, 1);
  return c;
};
El.prototype.setAttribute = function (k, v) { this.attrs[k] = v; if (k === 'class') this.className = v; };
El.prototype.getAttribute = function (k) { return (k in this.attrs) ? this.attrs[k] : null; };
El.prototype.addEventListener = function () {}; El.prototype.removeEventListener = function () {};
El.prototype.querySelector = function (sel) {
  const cls = String(sel).replace('.', '');
  for (const c of this.children) if (c.className === cls) return c;
  return null;
};
El.prototype.querySelectorAll = function () { return []; };
El.prototype.closest = function () { return null; };
Object.defineProperty(El.prototype, 'lastChild', { get() { return this.children[this.children.length - 1] || null; } });
Object.defineProperty(El.prototype, 'firstChild', { get() { return this.children[0] || null; } });
Object.defineProperty(El.prototype, 'parentNode', { get() { return this._padre || null; } });

const SVGS = {
  te_svgSeccion: new El('svg'), te_svgLargo: new El('svg'), te_svgPlanta: new El('svg'),
  // Contenedores de los BOTONES DE ELEMENTO (titlebar + pantalla inicial): la
  // sección D inspecciona el HTML que _renderElemSel les escribe.
  te_elemBtns: new El('div'), te_elegirBtns: new El('div')
};

const win = {};
win.window = win; win.self = win;
win.document = {
  body: new El(), documentElement: new El(), head: new El(),
  createElement: (t) => new El(t),
  createElementNS: (ns, t) => { const e = new El(t); creados.push(e); return e; },
  createTextNode: () => new El('#text'),
  getElementById: (id) => SVGS[id] || null,
  querySelector: () => null, querySelectorAll: () => [],
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

const R = win.ModeladorReglas, G = win.ModeladorGenerar, TE = win.TemplateEditor, ST = TE._ST;
let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

// ==================================== A · LOS CINCO COMPLETOS (y losa fuera)
console.log('A · qué elementos se pueden abrir');
{
  ['VIGA', 'MURO', 'COLUMNA', 'FUNDACION', 'GEN'].forEach(function (k) {
    ok(TE._elementoConDatos(k) === true, k.toLowerCase() + ': tiene todas sus tablas');
  });
  ok(TE._elementoConDatos('LOSA') === false,
    'losa sigue fuera A PROPÓSITO: el usuario la dejó pendiente, no se deja a medias');
}

// ======================== B · TODOS HABLAN LAS CLAVES QUE EL MOTOR ENTIENDE
// El motor sólo lee largo/alto/ancho y recub_sup/inf/lat. Una tabla que declare
// 'b', 'h', 'espesor' o 'recub' produce una geometría que le llega VACÍA — que es
// exactamente por lo que columna, fundación y gen nunca se abrieron.
console.log('');
console.log('B · ningún elemento inventa claves de geometría');
{
  const DIMS_OK = ['largo', 'alto', 'ancho'];
  const RECUB_OK = ['recub_sup', 'recub_inf', 'recub_lat'];
  const T = TE._TPL_DIMS_POR_ELEMENTO;
  Object.keys(T).forEach(function (k) {
    if (k === 'LOSA') return;                       // fuera de alcance, ver la cabecera
    const malas = T[k].dims.filter(function (d) { return DIMS_OK.indexOf(d.k) < 0; })
      .map(function (d) { return d.k; });
    ok(malas.length === 0, k.toLowerCase() + ': sus dimensiones son las del motor' +
      (malas.length ? ' (sobran: ' + malas.join(',') + ')' : ''));
    const malasR = [];
    T[k].recubs.forEach(function (rr) {
      (rr.ks || [rr.k]).forEach(function (kk) { if (RECUB_OK.indexOf(kk) < 0) malasR.push(kk); });
    });
    ok(malasR.length === 0, k.toLowerCase() + ': sus recubrimientos también' +
      (malasR.length ? ' (sobran: ' + malasR.join(',') + ')' : ''));
  });
}

// ============================ C · SE PUEDE COLOCAR UNA BARRA EN CADA UNO
console.log('');
console.log('C · el gesto completo en los tres elementos nuevos');
{
  const CASOS = [
    ['columna', 'CB', '101A', { largo: 40, alto: 300, ancho: 40, recub_lat: 4, recub_sup: 4, recub_inf: 4 }],
    ['columna', 'ESC', '104D', { largo: 40, alto: 300, ancho: 40, recub_lat: 4, recub_sup: 4, recub_inf: 4 }],
    ['columna', 'TRC', '103B', { largo: 40, alto: 300, ancho: 40, recub_lat: 4, recub_sup: 4, recub_inf: 4 }],
    ['fundacion', 'Fi', '101A', { largo: 300, alto: 80, ancho: 100, recub_sup: 5, recub_inf: 7, recub_lat: 5 }],
    ['fundacion', 'TRF', '103B', { largo: 300, alto: 80, ancho: 100, recub_sup: 5, recub_inf: 7, recub_lat: 5 }],
    ['gen', 'CB', '101A', { largo: 300, alto: 100, ancho: 100, recub_sup: 4, recub_inf: 4, recub_lat: 4 }]
  ];
  CASOS.forEach(function (caso) {
    const elem = caso[0], tip = caso[1], fig = caso[2], geo = caso[3];
    ST.elemento = elem;
    ST.receta = { tipo: elem, geometria: Object.assign({}, geo), componentes: [] };
    ST.selCi = -1; ST.selExtra = []; ST.caraHi = null; ST.espejoColoc = false;
    let pls = [], err = null;
    try {
      const c = TE._compDesdeClick('largo', { x: 0, y: 0, z: 0 }, { tipologia: tip, figura: fig, diam: 12 });
      ST.receta.componentes = [c];
      R.normalizarReceta(ST.receta);
      R.reanclarReceta(ST.receta);
      pls = (G.generarElemento(ST.receta).placements) || [];
    } catch (e) { err = e.message; }
    ok(!err && pls.length > 0,
      elem + ' · ' + tip + ' ' + fig + ': nacen barras (' + (err ? 'EXCEPCIÓN: ' + err : pls.length) + ')');
    // Y no salen degeneradas: una barra sin longitud es una barra que no existe.
    if (!err && pls.length) {
      const p = pls[0].puntos || [];
      let span = 0;
      for (let i = 1; i < p.length; i++) {
        span += Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y) + Math.abs(p[i].z - p[i - 1].z);
      }
      ok(span > 1, '…con recorrido real (' + Math.round(span) + ' cm)');
    }
  });
}

// ==================== D · LOS BOTONES DE ELEMENTO (titlebar + pantalla inicial)
// El <select> del titlebar se reemplazó por UN BOTÓN POR ELEMENTO (26-ago, pedido
// del usuario: el mismo chip del creador de despieces). Lo que se congela: qué
// botones se OFRECEN lo sigue mandando _elementoConDatos (losa deshabilitada con su
// porqué), y CON BARRAS COLOCADAS no se cambia de elemento — todos deshabilitados
// menos el activo, con el motivo de siempre en el tooltip.
console.log('');
console.log('D · botones de elemento');
{
  const fila = win.document.getElementById('te_elemBtns');
  ST.elemento = 'viga';
  ST.receta = { tipo: 'viga', geometria: {}, componentes: [] };
  TE._renderElemSel();
  const html = String(fila.innerHTML);
  ['VIGA', 'MURO', 'COLUMNA', 'FUNDACION', 'GEN', 'LOSA'].forEach(function (k) {
    ok(html.indexOf('data-elem="' + k + '"') >= 0, k + ': tiene su botón');
  });
  ok(/data-elem="LOSA"[^>]*\bdisabled\b/.test(html), 'losa sale deshabilitada');
  ok(/data-elem="LOSA"[^>]*próximamente/.test(html), '…y dice por qué (próximamente, en el tooltip)');
  ok(/class="te-elembtn on"[^>]*data-elem="VIGA"/.test(html), 'el activo (viga) va marcado');
  ok(!/data-elem="MURO"[^>]*\bdisabled\b/.test(html), 'muro se ofrece con la receta vacía');
  ok(String(win.document.getElementById('te_elegirBtns').innerHTML) === html,
    'la pantalla inicial pinta LOS MISMOS botones (un solo render, no dos verdades)');

  // Con una barra colocada: nadie más que el activo, y con el motivo de siempre.
  ST.receta.componentes = [{ tipologia: 'CBS', figura: '101A' }];
  TE._renderElemSel();
  const html2 = String(fila.innerHTML);
  ok(/data-elem="MURO"[^>]*\bdisabled\b/.test(html2), 'con barras, muro queda deshabilitado');
  ok(html2.indexOf('receta vacía') >= 0, '…con el motivo de siempre en el tooltip');
  ok(!/data-elem="VIGA"[^>]*\bdisabled\b/.test(html2), 'el activo nunca se deshabilita');

  // ---- EN MODO OBRA EL ELEMENTO NO SE ELIGE (pedido del usuario, 25-ago) ----
  // «cuando abro el enfierrador, el despiece ya sabe si el elemento que estamos
  // haciendo es un muro, una viga u otro. No debo poder elegir en esta parte.»
  // El dato vive en el lote (lotes.estructura) y llega por la puerta como elementoFijo.
  ST.receta.componentes = [];
  ST.elemento = 'muro';
  ST.receta.tipo = 'muro';
  ST.elemFijo = 'MURO';
  TE._renderElemSel();
  const html3 = String(fila.innerHTML);
  ['VIGA', 'MURO', 'COLUMNA', 'FUNDACION', 'GEN', 'LOSA'].forEach(function (k) {
    ok(new RegExp('data-elem="' + k + '"[^>]*\\bdisabled\\b').test(html3),
      k + ': apagado — lo fija el despiece (el activo TAMBIÉN: aquí no lo elige el editor)');
    ok(html3.indexOf('data-elem="' + k + '"') >= 0, k + ': …pero sigue a la vista, no se esconde');
  });
  ok(html3.indexOf('te-elemfijo') >= 0,
    'y el porqué se LEE al lado de los botones, sin tener que pasar el mouse');
  ok(html3.indexOf(TE._motivoElemFijo()) >= 0, 'con el motivo completo en el tooltip');
  ok(/Muro/.test(TE._motivoElemFijo()), 'que NOMBRA de qué es el despiece');
  // La traba se pregunta donde ocurre el cambio, no sólo en el botón: llamar a la
  // función a mano (consola, otro handler) tampoco cambia el elemento.
  TE._cambiarElemento('VIGA');
  ok(String(ST.elemento).toLowerCase() === 'muro', 'y cambiarlo POR CÓDIGO tampoco funciona');

  // Sin dato del despiece (lote antiguo, sin estructura) NO hay traba: ahí sí se elige.
  ST.elemFijo = null;
  TE._renderElemSel();
  const html4 = String(fila.innerHTML);
  ok(html4.indexOf('te-elemfijo') < 0, 'sin estructura en el lote la etiqueta desaparece');
  ok(!/data-elem="VIGA"[^>]*\bdisabled\b/.test(html4),
    'y los botones vuelven: un despiece sin estructura no puede dejar al usuario encerrado');
}

console.log(fallos ? (fallos + ' FALLO(S)') : 'OK — los cinco elementos abren y colocan');
process.exit(fallos ? 1 : 0);
