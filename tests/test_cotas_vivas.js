// =============================================================================
// COTAS VIVAS DEL ARRASTRE (20-ago) — test headless (Node)
// =============================================================================
// El usuario pidió ver, MIENTRAS arrastra un abanico y sin soltarlo, «la distancia
// al borde del hormigón así como la distancia del elemento… un poco como lo hace
// Revit». Este test congela lo único que puede romperse sin que se note mirando el
// cuadrante: QUÉ NÚMERO se dibuja y CUÁNDO.
//
//   A. SÓLO MIENTRAS SE ARRASTRA — sin arrastre no hay cotas; al soltar desaparecen.
//   B. EL NÚMERO ES EL DEL ANCLAJE — el mismo { ref, d } que la receta guarda
//      (reglas.anclarRango). Es EL punto del ejercicio: si el helper tuviera su
//      propia cuenta de "distancia al borde", diría una cosa y el editor haría otra
//      en cuanto el extremo pasa la mitad del elemento o el rango va al revés.
//   C. LA LÍNEA DE EXTENSIÓN TERMINA EN LA REFERENCIA — el dibujo es la
//      verificación del número: si discreparan, la línea se pasaría del borde.
//   D. EJES QUE NO SON X — la pieza girada reparte en Z (y hay líneas en Y): la
//      cota tiene que salir en la vista que muestra ESE eje, horizontal o vertical.
//   E. LAS DOS LÍNEAS — arrastrar `rango2` no rotula `rango` (ni al revés).
//   F. LOS CUATRO TIRADORES — extremos, rango entero y divisor de tramo: todos
//      rotulan, y con el divisor los largos de tramo siguen al gesto.
//   G. NO SE PISAN — ni con el rótulo del largo del abanico ni entre ellas.
//   H. EL LARGO TAMBIÉN VA EN VIVO — el rótulo del abanico (_rotuloLargoRango) se
//      redibuja con el mismo repintado, así que dice el largo de AHORA.
//
// Correr con: node tests/test_cotas_vivas.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

// --------------------------------------------------------------- entorno mínimo
// Mismo mini-DOM que tests/test_rotulo_largo_rango.js: acá se prueban la CUENTA y el
// CAMINO DE DIBUJO; el DOM real no hace falta.
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

function estribo(rango, extra) {
  const c = {
    comp_id: 'E1', jerarquia: 2, tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral',
    angulos: [135, 135], modo: 'lineal', plano_pieza: { orientacion: 'acostada', volteado: false },
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'linear', activa: true, sep: rango.sep, rango: rango }
  };
  for (const k in (extra || {})) c[k] = extra[k];
  return c;
}
function montar(comps, geo) {
  ST.receta = { tipo: 'viga', geometria: Object.assign({}, geo || GEO), componentes: comps };
  ST.selCi = 0;
  ST.dragRango = null;
  return ST.receta.componentes[0];
}
// Arrastre EN CURSO de una línea (lo que el editor deja en ST al agarrar un tirador).
function agarrar(cual, end, div) {
  ST.dragRango = { ci: ST.selCi, plano: 'largo', lastX: 0, lastY: 0,
                   end: end || null, div: (div == null ? null : div), eje: null, cual: cual || 'rango' };
}
function soltar() { ST.dragRango = null; }

// SVG de mentira que GRABA lo que le cuelgan.
function SvgRec() { this.hijos = []; }
SvgRec.prototype.appendChild = function (c) { this.hijos.push(c); return c; };
function Nodo(tag) { this.tag = tag; this.attrs = {}; this.hijos = []; this.textContent = ''; }
Nodo.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
Nodo.prototype.appendChild = function (c) { this.hijos.push(c); return c; };
win.document.createElementNS = (ns, tag) => new Nodo(tag);

function planos(nodo, out) {
  out = out || [];
  out.push(nodo);
  (nodo.hijos || []).forEach(h => planos(h, out));
  return out;
}
const ESC = 0.8;                                   // 0.8 px de viewBox por cm
const X = (u) => 310 + u * ESC, Y = (v) => 150 - v * ESC;
function pintar(plano, px, py, esc) {
  const fx = (u) => (px == null ? 310 : px) + u * (esc == null ? ESC : esc);
  const fy = (v) => (py == null ? 150 : py) - v * (esc == null ? ESC : esc);
  const svg = new SvgRec();
  TE._dibujarFlechaRango(svg, plano, fx, fy, 620, 300);
  const todos = [];
  svg.hijos.forEach(g => planos(g, todos));
  return todos;
}
// Las cotas vivas emitidas: su número, la referencia que eligió el ancla y dónde va.
function cotas(plano, px, py, esc) {
  return pintar(plano, px, py, esc)
    .filter(n => n.tag === 'text' && n.attrs['data-cota-viva'] != null)
    .map(n => ({ txt: n.textContent, ref: n.attrs['data-cota-viva'],
                 x: Number(n.attrs.x), y: Number(n.attrs.y) }));
}
// Las líneas de extensión (clase te-rango-cotaL). Las de TRECHO son las largas; las
// cortas son los ticks de la punta (se distinguen por tener x1===x2 e y1===y2 corto).
function extensiones(plano) {
  return pintar(plano).filter(n => n.tag === 'line' && n.attrs['class'] === 'te-rango-cotaL')
    .map(n => ({ x1: Number(n.attrs.x1), y1: Number(n.attrs.y1), x2: Number(n.attrs.x2), y2: Number(n.attrs.y2) }));
}
function rotuloLargo(plano) {
  const t = pintar(plano).filter(n => n.tag === 'text' && n.attrs['data-rango-len'] != null);
  return t.length ? t[0].textContent : null;
}

// ---------------------------------------------------------------------------
console.log('\nA · SÓLO MIENTRAS SE ARRASTRA');
// ---------------------------------------------------------------------------
{
  const c = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  ok(cotas('largo').length === 0, 'quieto: NINGUNA cota viva (la vista no se llena de números)');
  agarrar('rango', 'to');
  ok(cotas('largo').length === 2, 'arrastrando: salen las DOS (un extremo cada una) [' + cotas('largo').length + ']');
  soltar();
  ok(cotas('largo').length === 0, 'al soltar desaparecen');

  // La flecha de PREVIEW (distribución todavía inactiva) también las lleva: el
  // primer gesto sobre ella es el que activa la distribución, y sin números ese
  // arrastre sería el único a ciegas.
  const cp = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  cp.distribucion.activa = false;
  R.reanclarReceta(ST.receta);
  agarrar('rango', null);
  ok(cotas('largo').length === 2, 'la flecha inactiva (preview) también las muestra al arrastrarla');
  soltar();

  // Arrastrar la línea de OTRO componente no rotula el seleccionado.
  const c2 = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  agarrar('rango', 'to');
  ST.dragRango.ci = 7;
  ok(cotas('largo').length === 0, 'el arrastre de otra barra no pinta cotas en ésta');
  soltar();
}

// ---------------------------------------------------------------------------
console.log('\nB · EL NÚMERO ES EL DEL ANCLAJE (no una cuenta paralela)');
// ---------------------------------------------------------------------------
{
  const c = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  agarrar('rango', 'to');
  const cs = cotas('largo');
  const a = c.distribucion.rango.ancla;
  ok(cs[0].txt === '40' && cs[1].txt === '40',
    'viga 600, rango −260→260: 40 y 40 cm a los testeros [' + cs.map(x => x.txt).join('/') + ']');
  ok(cs[0].txt === String(Math.round(a.ini.d)) && cs[1].txt === String(Math.round(a.fin.d)),
    'y son EXACTAMENTE el ancla que guarda la receta [' + JSON.stringify(a) + ']');
  ok(cs[0].ref === 'min' && cs[1].ref === 'max', 'cada una declara su referencia (min/max)');

  // EL CASO QUE DELATA UNA CUENTA PROPIA: un extremo que pasó la mitad. El ancla lo
  // amarra al CENTRO (es su referencia más cercana) y ahí se queda al crecer la
  // viga — así que la cota tiene que decir 100, no 400. La cota anterior medía
  // siempre `from` contra el borde − y decía 400: el helper y el comportamiento
  // real se contradecían.
  const cc = montar([estribo({ from: 100, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  agarrar('rango', 'from');
  const cs2 = cotas('largo');
  ok(cs2[0].txt === '100' && cs2[0].ref === 'centro',
    'un `from` en 100 (viga 600) se ancla al CENTRO: dice 100 [' + cs2[0].txt + '/' + cs2[0].ref + ']');
  ok(cs2[0].txt !== '400', '…y NO los 400 cm al testero, que es lo que el editor NO hace');
  ok(cs2[0].txt === String(Math.round(cc.distribucion.rango.ancla.ini.d)),
    'sigue coincidiendo con el ancla guardada [' + JSON.stringify(cc.distribucion.rango.ancla.ini) + ']');

  // RANGO AL REVÉS (to < from): `from` es el extremo del borde +, no del −.
  const ci = montar([estribo({ from: 260, to: -260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  agarrar('rango', 'to');
  const cs3 = cotas('largo');
  ok(cs3[0].txt === '40' && cs3[0].ref === 'max' && cs3[1].txt === '40' && cs3[1].ref === 'min',
    'rango invertido: 40 al borde + y 40 al − (no 560 y 560) [' +
    cs3.map(x => x.txt + '/' + x.ref).join(' · ') + ']');
  soltar();
}

// ---------------------------------------------------------------------------
console.log('\nC · LA LÍNEA DE EXTENSIÓN TERMINA EN LA REFERENCIA');
// ---------------------------------------------------------------------------
{
  montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  agarrar('rango', 'to');
  const ls = extensiones('largo');
  // por extremo: el TRECHO (del punto a la referencia) + el tick de la punta.
  ok(ls.length === 4, 'por cada extremo, trecho + tick [' + ls.length + ' líneas]');
  const trechos = ls.filter(l => l.x1 !== l.x2);
  ok(trechos.length === 2, 'dos trechos horizontales [' + trechos.length + ']');
  ok(Math.abs(trechos[0].x1 - X(-260)) < 0.01 && Math.abs(trechos[0].x2 - X(-300)) < 0.01,
    'el 1º va del extremo (−260) al BORDE del hormigón (−300) [' + trechos[0].x1 + '→' + trechos[0].x2 + ']');
  ok(Math.abs(trechos[1].x1 - X(260)) < 0.01 && Math.abs(trechos[1].x2 - X(300)) < 0.01,
    'el 2º va de 260 a 300 [' + trechos[1].x1 + '→' + trechos[1].x2 + ']');

  // con ancla al CENTRO la línea termina en 0, que es donde el ancla dice.
  montar([estribo({ from: 100, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  agarrar('rango', 'from');
  const t2 = extensiones('largo').filter(l => l.x1 !== l.x2);
  ok(Math.abs(t2[0].x2 - X(0)) < 0.01, 'anclada al centro, la línea termina en el centro [' + t2[0].x2 + ']');

  // FUERA DEL CUADRANTE no se dibuja: un número suelto en el borde de una vista
  // donde no se ve ni el extremo ni su referencia no se entiende (misma regla que
  // el rótulo del largo).
  montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  agarrar('rango', 'to');
  ok(cotas('largo', -3000, 150, 6).length === 0, 'flecha entera fuera del cuadrante: sin cotas');
  soltar();
}

// ---------------------------------------------------------------------------
console.log('\nD · EJES QUE NO SON X (la pieza girada reparte en Z; hay líneas en Y)');
// ---------------------------------------------------------------------------
{
  // REPARTO EN Z (ancho 30) — se ve como HORIZONTAL en SECCIÓN (u=z) y como
  // VERTICAL en PLANTA (v=z). El mismo número en las dos.
  const cz = montar([estribo({ from: -12, to: 12, sep: 6, eje: 'z' })]);
  R.reanclarReceta(ST.receta);
  agarrar('rango', 'to');
  const hz = cotas('seccion'), vz = cotas('planta');
  ok(hz.length === 2 && hz[0].txt === '3' && hz[1].txt === '3',
    'SECCIÓN (u=z): 3 y 3 cm a las caras laterales (ancho 30) [' + hz.map(x => x.txt).join('/') + ']');
  ok(vz.length === 2 && vz[0].txt === '3' && vz[1].txt === '3',
    'PLANTA (v=z): el MISMO número, la flecha es vertical [' + vz.map(x => x.txt).join('/') + ']');
  ok(hz[0].txt === String(Math.round(cz.distribucion.rango.ancla.ini.d)),
    'y sale del ancla del eje Z, no del largo [' + JSON.stringify(cz.distribucion.rango.ancla) + ']');
  // en la vista donde Z es la PROFUNDIDAD (a lo largo: depth=z) no hay flecha ni cota
  ok(cotas('largo').length === 0, 'donde el eje del rango apunta al observador no se rotula nada');
  soltar();

  // REPARTO EN Y (alto 60) — vertical en «a lo largo» (v=y).
  const cy = montar([estribo({ from: -26, to: 26, sep: 13, eje: 'y' })]);
  R.reanclarReceta(ST.receta);
  agarrar('rango', 'to');
  const hy = cotas('largo');
  ok(hy.length === 2 && hy[0].txt === '4' && hy[1].txt === '4',
    'eje Y (alto 60): 4 y 4 cm a las caras inf/sup [' + hy.map(x => x.txt).join('/') + ']');
  ok(hy[0].x > 30 && hy[1].x > 30, 'la cota vertical va al costado de la flecha, no encima [x=' +
    hy[0].x + ']');
  const ty = extensiones('largo').filter(l => l.y1 !== l.y2);
  ok(ty.length === 2 && Math.abs(ty[0].y2 - Y(-30)) < 0.01,
    'su línea de extensión llega al borde inferior (−30) [' + (ty[0] || {}).y2 + ']');
  soltar();
}

// ---------------------------------------------------------------------------
console.log('\nE · LAS DOS LÍNEAS DEL ARREGLO (rango / rango2)');
// ---------------------------------------------------------------------------
{
  const c = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' }, {
    modo: 'arreglo',
    distribucion: {
      modo: 'arreglo', activa: true, sep: 20,
      rango: { from: -260, to: 260, sep: 20, eje: 'x' },
      rango2: { from: -22, to: 22, sep: 11, eje: 'y' }
    }
  })]);
  R.reanclarReceta(ST.receta);
  agarrar('rango', 'to');
  const c1 = cotas('largo');
  ok(c1.length === 2 && c1[0].txt === '40', 'arrastrando la 1ª: sólo sus dos cotas (40/40) [' +
    c1.map(x => x.txt).join('/') + ']');
  agarrar('rango2', 'to');
  const c2 = cotas('largo');
  ok(c2.length === 2 && c2[0].txt === '8' && c2[1].txt === '8',
    'arrastrando la 2ª: las suyas, en SU eje (alto 60, −22→22 → 8 y 8) [' + c2.map(x => x.txt).join('/') + ']');
  const a2 = c.distribucion.rango2.ancla;
  ok(c2[0].txt === String(Math.round(a2.ini.d)) && c2[1].txt === String(Math.round(a2.fin.d)),
    'y coinciden con el ancla de rango2 [' + JSON.stringify(a2) + ']');
  soltar();
}

// ---------------------------------------------------------------------------
console.log('\nF · LOS CUATRO TIRADORES (extremos, rango entero, divisor)');
// ---------------------------------------------------------------------------
{
  const c = montar([estribo({
    from: -260, to: 260, sep: 10, eje: 'x',
    tramos: [{ long: 100, sep: 10 }, { long: 320, sep: 20 }, { long: 100, sep: 10 }]
  })]);
  R.reanclarReceta(ST.receta);
  const d = c.distribucion;
  ['from', 'to', null].forEach(function (e) {
    agarrar('rango', e);
    ok(cotas('largo').length === 2, 'tirador ' + (e || 'tramo central') + ': dos cotas');
  });
  agarrar('rango', null, 1);              // divisor entre el tramo 1 y el 2
  ok(cotas('largo').length === 2, 'divisor de tramo: dos cotas (los extremos siguen siendo la referencia)');
  // …y el largo de los tramos SIGUE al divisor mientras se mueve: es el número que
  // cambia en ese gesto, y ya lo rotula _dibujarTramosRango.
  const lens = () => pintar('largo').filter(n => n.tag === 'text' && n.attrs['data-rango-tlen'] != null)
    .map(n => n.textContent).join('/');
  ok(lens() === '100/320/100', 'punto de partida de los tramos [' + lens() + ']');
  TE._moverDivisor(d, 1, 150);
  ok(lens() === '150/270/100', 'movido el divisor, los largos de tramo dicen lo nuevo [' + lens() + ']');
  ok(cotas('largo')[0].txt === '40' && cotas('largo')[1].txt === '40',
    '…y las cotas de los extremos no se movieron (el divisor no toca el rango)');
  soltar();
}

// ---------------------------------------------------------------------------
console.log('\nG · NO SE PISAN (ni con el rótulo del largo ni entre ellas)');
// ---------------------------------------------------------------------------
{
  // Rango CORTO pegado al borde −: el rótulo del largo no cabe dentro de la flecha y
  // se sale al lado, justo al trecho donde va la cota. Es el caso que obligó a que
  // _rotuloLargoRango devuelva su caja en vez de un umbral fijo.
  const c = montar([estribo({ from: -290, to: -270, sep: 10, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  agarrar('rango', 'to');
  const todos = pintar('largo');
  const len = todos.filter(n => n.tag === 'rect' && String(n.attrs['class'] || '').indexOf('te-rango-lenbg') === 0)[0];
  const cs = cotas('largo');
  ok(!!len && cs.length === 2, 'están el rótulo del largo y las dos cotas');
  const cajaLen = { x0: Number(len.attrs.x), x1: Number(len.attrs.x) + Number(len.attrs.width) };
  function solapa(cx, txt, caja) {
    const w = String(txt).length * 5.7;
    return (cx - w / 2) < caja.x1 && (cx + w / 2) > caja.x0;
  }
  ok(!solapa(cs[0].x, cs[0].txt, cajaLen) && !solapa(cs[1].x, cs[1].txt, cajaLen),
    'ninguna cota se monta sobre la caja del largo [len ' + cajaLen.x0.toFixed(1) + '–' +
    cajaLen.x1.toFixed(1) + ' · cotas ' + cs.map(x => x.x.toFixed(1)).join(', ') + ']');
  ok(!solapa(cs[0].x, cs[0].txt, { x0: cs[1].x - String(cs[1].txt).length * 2.85, x1: cs[1].x + String(cs[1].txt).length * 2.85 }),
    'ni una sobre la otra');
  // Y NINGUNA invade la banda del título de la vista (llega hasta ~27 del viewBox):
  // ese fue el defecto de la cota anterior, que escribía en y = 24.
  ok(cs.every(x => x.y > 28), 'ninguna cota escribe sobre el título de la vista (y > 28) [' +
    cs.map(x => x.y).join('/') + ']');
  soltar();
}

// ---------------------------------------------------------------------------
console.log('\nH · EL LARGO TAMBIÉN VA EN VIVO');
// ---------------------------------------------------------------------------
{
  const c = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  agarrar('rango', 'to');
  ok(rotuloLargo('largo') === '520', 'el rótulo del abanico dice el largo de ahora (520)');
  // lo que hace el arrastre: mover el `to` y re-anclar (el mismo helper único).
  c.distribucion.rango.to = 100; TE._anclarRangoUI(c.distribucion.rango, 'x');
  ok(rotuloLargo('largo') === '360', '…y al mover el extremo pasa a 360 sin soltar [' + rotuloLargo('largo') + ']');
  ok(cotas('largo')[1].txt === '100' && cotas('largo')[1].ref === 'centro',
    'la cota de ese extremo lo sigue: 100 al centro, que es su ancla nueva [' +
    JSON.stringify(c.distribucion.rango.ancla.fin) + ']');
  // el rótulo del largo y el campo del panel siguen diciendo lo mismo (no se rompió).
  ok(TE._rangoEditor(c, c.distribucion, 0)._rotulo() === 'Rango · 360 cm',
    'el campo del panel dice el mismo 360 [' + TE._rangoEditor(c, c.distribucion, 0)._rotulo() + ']');
  soltar();
}

// ---------------------------------------------------------------------------
console.log('\nI · LA CUENTA SUELTA (_anclaViva) ES LA DEL MOTOR');
// ---------------------------------------------------------------------------
{
  montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  const host = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
  [['x', -260], ['x', 100], ['x', 299], ['y', -26], ['y', 0], ['z', 12], ['z', -14.5]].forEach(function (p) {
    const mia = TE._anclaViva(p[1], p[0]);
    const suya = R.anclaDeCoord(p[1], p[0] === 'y' ? host.alto : (p[0] === 'z' ? host.ancho : host.largo));
    ok(JSON.stringify(mia) === JSON.stringify(suya),
      'ancla de ' + p[1] + ' en ' + p[0] + ': ' + JSON.stringify(mia) + ' = la del motor');
  });
  // La referencia se deduce del ancla, sin volver a preguntar la dimensión.
  ok(TE._coordRefAncla({ ref: 'min', d: 40 }, -260) === -300, 'ref min: coord − d = −300');
  ok(TE._coordRefAncla({ ref: 'max', d: 40 }, 260) === 300, 'ref max: coord + d = 300');
  ok(TE._coordRefAncla({ ref: 'centro', d: 100 }, 100) === 0, 'ref centro: 0');
}

// ---------------------------------------------------------------------------
console.log('\nJ · LA PIEZA (etapa 2): el hueco REAL contra el hormigón');
// ---------------------------------------------------------------------------
// ACÁ EL NÚMERO NO ES EL DEL ANCLA DEL pos_hint, y es a propósito: `pos_hint` es
// una TRASLACIÓN que se suma a la geometría base, no la posición de la barra, y
// `anclarPosHint` ancla esa traslación. Se congela el caso medido que lo delata.
{
  // 101A inferior sobre una viga 600×60: nace en y = 25.2. Con pos_hint.y = 20
  // queda en 45.2 — 15.2 cm FUERA del hormigón, que llega a 30.
  const longi = {
    comp_id: 'L1', jerarquia: 1, tipologia: 'LO', figura: '101A', diam: 16, cara: 'inferior',
    modo: 'puntual', plano_pieza: { orientacion: 'acostada', volteado: false },
    dims: { A: { modo: 'auto' } }, pos_hint: { y: 20 },
    distribucion: { modo: 'layered', activa: false }
  };
  montar([longi]);
  const pls = R.expandirComponente(JSON.parse(JSON.stringify(longi)), Object.assign({}, GEO));
  let ylo = Infinity, yhi = -Infinity;
  pls.forEach(p => p.puntos.forEach(q => { if (q.y < ylo) ylo = q.y; if (q.y > yhi) yhi = q.y; }));
  ok(Math.abs(ylo - 45.2) < 0.01, 'la 101A con pos_hint.y=20 queda en y = 45.2 [' + ylo.toFixed(2) + ']');
  const anc = R.anclaDeCoord(20, GEO.alto);
  ok(anc.ref === 'max' && anc.d === 10,
    'y su ancla dice {max, 10}: "a 10 cm de la cara superior", con la barra 15 cm fuera [' +
    JSON.stringify(anc) + ']');

  // Lo que se dibuja es el HUECO: y=45.2 contra la cara superior (+30) = −15
  // (negativo = asoma), y contra la inferior (−30) = +75.
  const svg = new SvgRec();
  TE._cotasVivasPieza(svg, 'largo', X, Y, 620, 300, { u0: -296, u1: 296, v0: ylo, v1: yhi });
  const cs = [];
  svg.hijos.forEach(h => planos(h, cs));
  const nums = cs.filter(n => n.tag === 'text' && n.attrs['data-cota-viva'] === 'pieza')
    .map(n => n.textContent);
  ok(nums.indexOf('-15') >= 0,
    'la cota dice −15: la barra ASOMA 15 cm por arriba (no los 10 del ancla) [' + nums.join('/') + ']');
  ok(nums.indexOf('10') < 0, '…y NO dice 10, que es lo que la pantalla desmiente');
  ok(nums.indexOf('75') >= 0, 'y el hueco a la cara inferior es 75 [' + nums.join('/') + ']');
  ok(nums.length === 4, 'en «a lo largo» (u=x, v=y) salen los 4 huecos: 2 por eje [' + nums.join('/') + ']');
  ok(nums.indexOf('4') >= 0 && nums.filter(n => n === '4').length === 2,
    'los del eje X: 4 y 4 (la barra va de −296 a 296 en una viga de 600) [' + nums.join('/') + ']');
}

// ---------------------------------------------------------------------------
console.log('\nK · REDIMENSIONAR: sólo el borde que la mano arrastra');
// ---------------------------------------------------------------------------
{
  montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  const bbox = { u0: -100, u1: 100, v0: -20, v1: 20 };
  function pieza(plano, marco) {
    ST.dragMarco = marco;
    const svg = new SvgRec();
    TE._cotasVivasPieza(svg, plano, X, Y, 620, 300, bbox);
    const t = [];
    svg.hijos.forEach(h => planos(h, t));
    ST.dragMarco = null;
    return t.filter(n => n.tag === 'text' && n.attrs['data-cota-viva'] === 'pieza').map(n => n.textContent);
  }
  ok(pieza('largo', null).length === 4, 'moviendo: los 4 huecos (los dos ejes de la vista)');
  ok(pieza('largo', { ci: 0, eje: 'u', ladoUV: '+', pushed: true }).join('') === '200',
    'estirando el borde +u: SÓLO ese hueco (300−100 = 200) [' +
    pieza('largo', { ci: 0, eje: 'u', ladoUV: '+', pushed: true }).join('/') + ']');
  ok(pieza('largo', { ci: 0, eje: 'u', ladoUV: '-', pushed: true }).join('') === '200',
    'estirando el borde −u: el otro (−100 − (−300) = 200)');
  ok(pieza('largo', { ci: 0, eje: 'v', ladoUV: '+', pushed: true }).join('') === '10',
    'estirando el borde +v: el hueco del ALTO (30−20 = 10) [' +
    pieza('largo', { ci: 0, eje: 'v', ladoUV: '+', pushed: true }).join('/') + ']');
  // en SECCIÓN los ejes son otros (u=z, v=y): el mismo bbox mide contra el ancho.
  ok(pieza('seccion', { ci: 0, eje: 'u', ladoUV: '+', pushed: true }).join('') === '-85',
    'en SECCIÓN el eje u es Z (ancho 30): un bbox de ±100 asoma 85 cm [' +
    pieza('seccion', { ci: 0, eje: 'u', ladoUV: '+', pushed: true }).join('/') + ']');
}

// ---------------------------------------------------------------------------
console.log('\nL · SÓLO CON ARRASTRE REAL (un clic para seleccionar no las enciende)');
// ---------------------------------------------------------------------------
{
  montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  ST.dragMove = null; ST.dragMarco = null;
  ok(TE._arrastrandoPieza() === false, 'quieto: no');
  ST.dragMove = { ci: 0, plano: 'largo', pushed: false };
  ok(TE._arrastrandoPieza() === false, 'agarrada pero sin mover (pushed:false): tampoco');
  ST.dragMove.pushed = true;
  ok(TE._arrastrandoPieza() === true, 'movida de verdad: sí');
  ST.dragMove.ci = 3;
  ok(TE._arrastrandoPieza() === false, 'y sólo para la barra SELECCIONADA');
  ST.dragMove = null;
  ST.dragMarco = { ci: 0, eje: 'u', ladoUV: '+', pushed: true };
  ok(TE._arrastrandoPieza() === true, 'estirando el marco: sí');
  ST.dragMarco = null;
}

console.log(fallos ? ('\n' + fallos + ' FALLO(S)') : '\nTODO OK');
process.exit(fallos ? 1 : 0);
