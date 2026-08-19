// =============================================================================
// RÓTULO DEL LARGO DEL ABANICO (19-ago) — test headless (Node)
// =============================================================================
// El usuario pidió ver «la distancia que recorren» las flechas de distribución EN
// PANTALLA y poder editarla ahí mismo. Este test congela lo que puede romperse sin
// que se note mirando el cuadrante:
//
//   A. EL NÚMERO QUE SE DIBUJA — _dibujarFlechaRango contra un SVG que graba: sale
//      un rótulo por línea de reparto, dice |to−from| redondeado al centímetro y
//      lleva los data-* que lo hacen clicable (data-rango-len = qué línea es).
//   B. LA ESCRITURA — _setLargoRango mueve el `to` y NO el `from`: el `from` es
//      «dónde va la PRIMERA barra» y moverlo desplazaría la distribución entera en
//      vez de estirarla.
//   C. LOS NODOS SIGUEN AL LARGO — el reparto real (el del motor) recoloca las
//      barras con el MISMO @: cantidad = ceil(span/@)+1, primera en `from`, última
//      en el `to` nuevo.
//   D. EL ANCLAJE SIGUE VIVO — lo escrito en pantalla queda ANCLADO al borde: tras
//      editar, cambiar el hormigón conserva las distancias a los bordes (es lo que
//      se construyó el 18-ago y lo que una edición mal hecha rompería en silencio).
//   E. EL PANEL Y EL RÓTULO DICEN LO MISMO — el rótulo del campo del panel
//      (_rangoEditor()._rotulo()) lleva el mismo número que la etiqueta dibujada,
//      y sigue diciéndolo después de editar por cualquiera de los dos lados.
//   F. LAS DOS LÍNEAS — `rango` y `rango2` (arreglo por área) se comportan igual.
//   G. NODO MÚLTIPLE — con varios tramos cada uno rotula su largo, editarlo mueve
//      SU límite (el vecino compensa) y el largo del rango NO cambia; el tirador
//      del divisor viaja con su eje y su línea.
//   H. LA RUEDA — ±PASO_ARRASTRE_CM sobre el rótulo, y NO le roba el zoom al resto
//      del cuadrante (sobre cualquier otro punto no toca el evento).
//
// Correr con: node tests/test_rotulo_largo_rango.js

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
const r4 = (v) => Math.round(Number(v) * 1e4) / 1e4;

// Estribo lineal repartido en X — el caso real (un @ y un rango que se arrastra).
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
// Monta la receta EN EL EDITOR (los rótulos son del componente seleccionado).
function montar(comps, geo) {
  ST.receta = { tipo: 'viga', geometria: Object.assign({}, geo || GEO), componentes: comps };
  ST.selCi = 0;
  return ST.receta.componentes[0];
}
// Las X donde el MOTOR pone las barras de un componente (la verdad de tierra).
function nodosX(c, geo) {
  const g = Object.assign({}, geo || (ST.receta && ST.receta.geometria) || GEO);
  return R.expandirComponente(JSON.parse(JSON.stringify(c)), g).map(p => r4(p.puntos[0].x));
}

// SVG de mentira que GRABA lo que le cuelgan (el stub del mini-DOM tira los
// atributos a la basura). Los rótulos van dentro de un <g>, así que se aplana.
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
// Dibuja la flecha de rango de la selección en un plano y devuelve TODOS los nodos.
const ESC = 0.8;                                   // 0.8 px de viewBox por cm
const X = (u) => 310 + u * ESC, Y = (v) => 150 - v * ESC;
function pintar(plano) {
  const svg = new SvgRec();
  TE._dibujarFlechaRango(svg, plano, X, Y, 620, 300);
  const todos = [];
  svg.hijos.forEach(g => planos(g, todos));
  return todos;
}
// Los rótulos de largo emitidos (texto + a qué línea pertenecen).
function rotulos(plano, attr) {
  return pintar(plano).filter(n => n.tag === 'text' && n.attrs[attr || 'data-rango-len'] != null)
    .map(n => ({ txt: n.textContent, cual: n.attrs['data-rango-len'], eje: n.attrs['data-rango-eje'],
                 tramo: n.attrs['data-rango-tlen'], x: Number(n.attrs.x), y: Number(n.attrs.y) }));
}

// ---------------------------------------------------------------------------
console.log('\nA · EL NÚMERO QUE SE DIBUJA SOBRE EL ABANICO');
// ---------------------------------------------------------------------------
{
  const c = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  const rs = rotulos('largo');
  ok(rs.length === 1, 'A LO LARGO sale UN rótulo de largo [' + rs.length + ']');
  ok(rs[0] && rs[0].txt === '520', 'dice la distancia que recorre: 520 cm [' + (rs[0] || {}).txt + ']');
  ok(rs[0] && rs[0].cual === 'rango' && rs[0].eje === 'x',
    'lleva a qué línea y a qué eje pertenece (rango/x) — es lo que lo hace editable');
  // …y va sobre la línea, en el centro del abanico (X(from)+X(to))/2.
  ok(rs[0] && Math.abs(rs[0].x - X(0)) < 0.01, 'va centrado sobre el abanico [x=' + (rs[0] || {}).x + ']');
  // en SECCIÓN el eje X apunta al observador: ahí no hay flecha ni rótulo.
  ok(rotulos('seccion').length === 0, 'en SECCIÓN (eje X de profundidad) no se dibuja rótulo');

  // el rótulo SIGUE al dato: mover el `to` a mano cambia el número dibujado.
  c.distribucion.rango.to = 200;
  ok(rotulos('largo')[0].txt === '460', 'editar el rango por el panel mueve el rótulo (460) [' + rotulos('largo')[0].txt + ']');

  // CON ZOOM el rótulo sigue al trozo VISIBLE del abanico, no a su punto medio: con
  // media flecha fuera del cuadrante, centrarlo "en el medio" lo dejaba fuera de
  // pantalla justo cuando el usuario se acercó a leerlo.
  c.distribucion.rango.to = 260;
  function pintarCon(px, py, esc) {
    const svg = new SvgRec();
    TE._dibujarFlechaRango(svg, 'largo', (u) => px + u * esc, (v) => py - v * esc, 620, 300);
    const t = [];
    svg.hijos.forEach(g => planos(g, t));
    return t.filter(n => n.tag === 'text' && n.attrs['data-rango-len'] != null);
  }
  const zoom = pintarCon(310, 150, 6);        // flecha de −1560 a +1560 px: se sale por los dos lados
  ok(zoom.length === 1 && Number(zoom[0].attrs.x) > 0 && Number(zoom[0].attrs.x) < 620,
    'con zoom el rótulo queda DENTRO del cuadrante [x=' + (zoom[0] && zoom[0].attrs.x) + ']');
  const fuera = pintarCon(-3000, 150, 6);     // la flecha entera quedó a la izquierda del cuadrante
  ok(fuera.length === 0, 'si la flecha no se ve, no se dibuja un número suelto en el borde');
}

// ---------------------------------------------------------------------------
console.log('\nB · ESCRIBIR EL LARGO EN PANTALLA (se mueve el `to`, no el `from`)');
// ---------------------------------------------------------------------------
{
  const c = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  const d = c.distribucion;
  ok(TE._setLargoRango(d, 'rango', 400) === true, '_setLargoRango(400) aplica');
  ok(d.rango.from === -260, 'el `from` NO se movió (es dónde va la primera barra) [' + d.rango.from + ']');
  ok(d.rango.to === 140, 'el `to` se movió a from+400 = 140 [' + d.rango.to + ']');
  ok(Math.round(TE._largoRango(d.rango)) === 400, 'el largo es el escrito: 400');
  ok(rotulos('largo')[0].txt === '400', 'y el rótulo dibujado dice 400 [' + rotulos('largo')[0].txt + ']');
  ok(TE._setLargoRango(d, 'rango', 400) === false, 'escribir el mismo largo no cambia nada (no ensucia)');
  ok(TE._setLargoRango(d, 'rango', -5) === false, 'un largo negativo se rechaza (no hay abanico al revés)');
  ok(d.rango.to === 140, '…y el rango quedó intacto tras el rechazo');

  // UN LARGO QUE SE PASA DEL HORMIGÓN NO SE TAPA: se escribe, se dibuja y SE AVISA
  // con el número que lo causó (regla del proyecto). El ancla guarda la intención
  // aunque quede fuera —d negativo = "tantos cm más allá del borde"—, así que si
  // después el elemento crece, el rango vuelve a caber solo.
  const cf = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  TE._setLargoRango(cf.distribucion, 'rango', 900);
  R.reanclarReceta(ST.receta);
  ok(cf.distribucion.rango.to === 640, 'largo 900 en una viga de 600: el `to` se escribe igual (640)');
  ok(cf.distribucion.rango.ancla.fin.d === -340,
    'el ancla dice 340 cm MÁS ALLÁ del borde + (no se recorta la intención) [' +
    cf.distribucion.rango.ancla.fin.d + ']');
  delete cf._avisos;
  R.expandirComponente(cf, Object.assign({}, ST.receta.geometria));
  ok((cf._avisos || []).some(a => /FUERA del hormigón/.test(a) && /340/.test(a)),
    'y el motor avisa con el número: fierro fuera del hormigón, 340 cm [' +
    ((cf._avisos || [])[0] || 'sin aviso').slice(0, 60) + '…]');
  // …y como el ancla declara un punto que SIEMPRE queda fuera (d negativo), al crecer
  // el elemento el extremo se TOPA en el borde útil (700−4) en vez de asomar: el
  // anclaje no se reescribe, se topa al resolver. Es la regla del motor, no una
  // defensa de la UI.
  ST.receta.geometria.largo = 1400;
  R.reanclarReceta(ST.receta);
  ok(cf.distribucion.rango.from === -660 && cf.distribucion.rango.to === 696,
    'viga 1400: el extremo se topa en el borde útil (696), no asoma [' +
    cf.distribucion.rango.from + '→' + cf.distribucion.rango.to + ']');
  ok(cf.distribucion.rango.ancla.fin.d === -340, 'y el anclaje declarado NO se tocó');
  ok(rotulos('largo')[0].txt === '1356', 'el rótulo dice el largo REALMENTE resuelto (1356) [' +
    rotulos('largo')[0].txt + ']');

  // RANGO INVERTIDO (to < from): el largo se escribe en el sentido que ya tenía.
  const d2 = montar([estribo({ from: 260, to: -260, sep: 20, eje: 'x' })]).distribucion;
  R.reanclarReceta(ST.receta);
  TE._setLargoRango(d2, 'rango', 100);
  ok(d2.rango.from === 260 && d2.rango.to === 160,
    'rango invertido: el largo se aplica hacia el mismo lado [' + d2.rango.from + '→' + d2.rango.to + ']');
}

// ---------------------------------------------------------------------------
console.log('\nC · LOS NODOS SE RECOLOCAN CON EL MISMO @');
// ---------------------------------------------------------------------------
{
  const c = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  const antes = nodosX(c);
  ok(antes.length === 27, 'punto de partida: 520 cm @20 → 27 barras [' + antes.length + ']');

  TE._setLargoRango(c.distribucion, 'rango', 400);
  R.reanclarReceta(ST.receta);
  const desp = nodosX(c);
  ok(desp.length === 21, '400 cm @20 → 21 barras (ceil(400/20)+1) [' + desp.length + ']');
  ok(desp[0] === -260, 'la primera sigue donde estaba (−260) [' + desp[0] + ']');
  ok(desp[desp.length - 1] === 140, 'la última cae en el `to` nuevo (140) [' + desp[desp.length - 1] + ']');
  ok(c.distribucion.sep === 20 && r4(desp[1] - desp[0]) === 20, 'el @ no se tocó: paso real 20 cm');

  // ACHICAR también recoloca (no quedan barras huérfanas del reparto viejo).
  TE._setLargoRango(c.distribucion, 'rango', 100);
  R.reanclarReceta(ST.receta);
  const chico = nodosX(c);
  ok(chico.length === 6 && chico[chico.length - 1] === -160,
    '100 cm @20 → 6 barras y la última en −160 [' + chico.length + ', ' + chico[chico.length - 1] + ']');

  // …y la línea EXPRESADA POR CANTIDAD sigue al largo nuevo (N no se queda pegado).
  const cN = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x', n: 27 })]);
  R.reanclarReceta(ST.receta);
  TE._setLargoRango(cN.distribucion, 'rango', 400);
  ok(cN.distribucion.rango.n === 21, 'con la línea expresada por CANTIDAD, N sigue al largo (21) [' +
    cN.distribucion.rango.n + ']');
}

// ---------------------------------------------------------------------------
console.log('\nD · EL ANCLAJE QUEDA RE-DERIVADO (sobrevive a cambiar el hormigón)');
// ---------------------------------------------------------------------------
{
  const c = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  const a0 = JSON.stringify(c.distribucion.rango.ancla);
  TE._setLargoRango(c.distribucion, 'rango', 480);         // from −260 · to 220
  const a = c.distribucion.rango.ancla;
  ok(JSON.stringify(a) !== a0, 'escribir el largo RE-DERIVA el ancla (no deja la vieja pegada)');
  ok(!!a && a.ini.ref === 'min' && a.ini.d === 40,
    'el extremo inicial sigue a 40 cm del borde − [' + JSON.stringify(a && a.ini) + ']');
  ok(!!a && a.fin.ref === 'max' && a.fin.d === 80,
    'el extremo final se re-ancló al borde + (300−220 = 80 cm) [' + JSON.stringify(a && a.fin) + ']');

  // LA PRUEBA DE FUEGO: se agranda la viga y la distribución conserva SUS distancias
  // a los bordes. Sin el re-anclaje de _setLargoRango el `to` se quedaría clavado en
  // 220 y el gap al testero pasaría de 80 a 180 cm.
  ST.receta.geometria.largo = 800;
  R.reanclarReceta(ST.receta);
  ok(c.distribucion.rango.from === -360 && c.distribucion.rango.to === 320,
    'viga 800: la distribución sigue al hormigón (−360 → 320, los mismos 40 y 80 cm de gap) [' +
    c.distribucion.rango.from + '→' + c.distribucion.rango.to + ']');
  ok(Math.round(TE._largoRango(c.distribucion.rango)) === 680,
    'y el largo pasó de 480 a 680 porque el elemento creció 200 [' +
    Math.round(TE._largoRango(c.distribucion.rango)) + ']');
  ok(rotulos('largo')[0].txt === '680', 'el rótulo de pantalla ya dice 680 [' + rotulos('largo')[0].txt + ']');

  // LA REGLA DEL ANCLA ES LA DE SIEMPRE (reglas.anclaDeCoord, 18-ago): cada extremo se
  // amarra a la referencia MÁS CERCANA de su eje — borde −, CENTRO o borde +. Un `to`
  // que cae más cerca del centro que de un testero queda anclado al centro, y ahí se
  // queda al crecer el elemento. No se escribe una segunda regla para este rótulo:
  // esto se congela para que nadie la "arregle" pensando que es un bug del largo.
  const cc = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  TE._setLargoRango(cc.distribucion, 'rango', 400);        // to = 140 → más cerca del centro
  ok(cc.distribucion.rango.ancla.fin.ref === 'centro' && cc.distribucion.rango.ancla.fin.d === 140,
    'un `to` a 140 (viga 600) se ancla al CENTRO, que es su referencia más cercana [' +
    JSON.stringify(cc.distribucion.rango.ancla.fin) + ']');
  ST.receta.geometria.largo = 800;
  R.reanclarReceta(ST.receta);
  ok(cc.distribucion.rango.to === 140, '…y por eso al crecer la viga ese extremo se queda en 140');
}

// ---------------------------------------------------------------------------
console.log('\nE · EL PANEL Y EL RÓTULO DICEN LO MISMO');
// ---------------------------------------------------------------------------
{
  const c = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  const d = c.distribucion;
  // El rótulo del CAMPO del panel es _rangoEditor(...)._rotulo(): la MISMA función que
  // arma la etiqueta del campo en la ficha del componente.
  const panel = () => TE._rangoEditor(c, d, 0)._rotulo();
  ok(panel() === 'Rango · 520 cm', 'el campo del panel se rotula "Rango · 520 cm" [' + panel() + ']');
  ok(rotulos('largo')[0].txt === '520', 'y la etiqueta de pantalla dice el mismo 520');
  // editar por PANTALLA → el panel dice el número nuevo…
  TE._setLargoRango(d, 'rango', 333);
  ok(panel() === 'Rango · 333 cm' && rotulos('largo')[0].txt === '333',
    'editar en pantalla: los dos pasan a 333 [' + panel() + ' / ' + rotulos('largo')[0].txt + ']');
  // …y editar por PANEL (escribir el `to`) mueve el rótulo de pantalla.
  d.rango.to = d.rango.from + 250; TE._anclarRangoUI(d.rango, 'x');
  ok(panel() === 'Rango · 250 cm' && rotulos('largo')[0].txt === '250',
    'editar el `to` en el panel: los dos pasan a 250 [' + panel() + ' / ' + rotulos('largo')[0].txt + ']');
  // Sin rango (distribución no activa) el campo no inventa un largo.
  ok(TE._rangoEditor(c, { }, 0)._rotulo() === 'Rango', 'sin rango, el campo se rotula "Rango" a secas');
}

// ---------------------------------------------------------------------------
console.log('\nF · LAS DOS LÍNEAS: rango y rango2 (arreglo por área)');
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
  const rs = rotulos('largo').sort((a, b) => a.cual < b.cual ? -1 : 1);
  ok(rs.length === 2, 'A LO LARGO (u=x, v=y) salen los DOS rótulos [' + rs.length + ']');
  ok(rs[0].cual === 'rango' && rs[0].txt === '520', '1ª línea: 520 [' + rs[0].txt + ']');
  ok(rs[1].cual === 'rango2' && rs[1].txt === '44', '2ª línea: 44 [' + rs[1].txt + ']');
  // la 2ª línea es VERTICAL en esta vista → su rótulo va a la IZQUIERDA de la flecha
  ok(rs[1].x < rs[0].x, 'el rótulo de la 2ª va fuera de la línea (izquierda), no encima del otro');

  const d = c.distribucion;
  ok(TE._setLargoRango(d, 'rango2', 40) === true, 'se puede escribir el largo de la 2ª línea');
  ok(d.rango2.from === -22 && d.rango2.to === 18, 'rango2: se movió el `to` (−22 → 18) [' + d.rango2.to + ']');
  ok(d.rango.to === 260, '…y la 1ª línea NO se enteró (el `cual` no se cruza)');
  const a2 = d.rango2.ancla;
  ok(!!a2 && a2.ini.ref === 'min' && a2.ini.d === 8 && a2.fin.ref === 'max' && a2.fin.d === 12,
    'rango2 queda anclado en SU eje (alto 60: 8 cm del borde inferior, 12 del superior) [' +
    JSON.stringify(a2) + ']');
  ST.receta.geometria.alto = 80;
  R.reanclarReceta(ST.receta);
  ok(d.rango2.from === -32 && d.rango2.to === 28,
    'alto 80: la 2ª línea también sigue al hormigón [' + d.rango2.from + '→' + d.rango2.to + ']');
  ok(rotulos('largo').filter(x => x.cual === 'rango2')[0].txt === '60',
    'y su rótulo dice 60 [' + rotulos('largo').filter(x => x.cual === 'rango2')[0].txt + ']');
}

// ---------------------------------------------------------------------------
console.log('\nG · NODO MÚLTIPLE (tramos): cada tramo rotula y edita SU largo');
// ---------------------------------------------------------------------------
{
  const c = montar([estribo({
    from: -260, to: 260, sep: 10, eje: 'x',
    tramos: [{ long: 100, sep: 10 }, { long: 320, sep: 20 }, { long: 100, sep: 10 }]
  })]);
  R.reanclarReceta(ST.receta);
  const d = c.distribucion;

  const largos = rotulos('largo', 'data-rango-tlen');
  ok(largos.length === 3, 'salen 3 rótulos de largo de tramo [' + largos.length + ']');
  ok(largos.map(t => t.txt).join('/') === '100/320/100',
    'dicen los largos de cada tramo: 100/320/100 [' + largos.map(t => t.txt).join('/') + ']');
  const ats = pintar('largo').filter(n => n.tag === 'text' && n.attrs['data-rango-at'] != null);
  ok(ats.map(t => t.textContent).join('/') === '@10/@20/@10',
    'y a su lado siguen los "@N" de siempre [' + ats.map(t => t.textContent).join('/') + ']');
  // el largo del tramo y su @ NO se pisan: el par va pegado, uno tras otro.
  ok(largos[0].x < Number(ats[0].attrs.x),
    'el largo va a la izquierda de su "@N", no encima [' + largos[0].x + ' < ' + ats[0].attrs.x + ']');
  // el rótulo del ABANICO sigue existiendo aparte, con el total.
  ok(rotulos('largo')[0].txt === '520', 'el rótulo del abanico sigue diciendo el total (520)');

  // EDITAR el largo de un tramo: mueve SU límite; el vecino compensa.
  TE._setLongTramo(d, 0, 150);
  const t = TE._tramosDe(d);
  ok(t.map(x => x.long).join('/') === '150/270/100',
    'tramo 1 → 150: el vecino baja a 270 [' + t.map(x => x.long).join('/') + ']');
  ok(Math.round(TE._largoRango(d.rango)) === 520, 'el LARGO DEL RANGO no cambió (sigue 520)');
  ok(d.rango.from === -260 && d.rango.to === 260, '…ni sus extremos');

  // El motor coloca las barras donde dicen los tramos nuevos.
  const xs = nodosX(c);
  ok(xs[0] === -260 && xs[xs.length - 1] === 260, 'el reparto sigue cubriendo el rango entero');
  ok(xs.indexOf(-110) >= 0, 'hay barra en el límite nuevo del 1er tramo (−260+150 = −110)');

  // EDITAR EL LARGO DEL ABANICO CON TRAMOS: el sobrante lo absorbe el tramo del MEDIO
  // (regla única de reglas._tramosElasticos, 18-ago). Los del extremo —el
  // confinamiento— conservan sus centímetros, que es el dato del calculista.
  TE._setLongTramo(d, 0, 100);                     // vuelve a 100/320/100
  TE._setLargoRango(d, 'rango', 620);
  const te = TE._tramosDe(d);
  ok(te.map(x => x.long).join('/') === '100/420/100',
    'estirar el abanico a 620: el tramo del MEDIO absorbe los 100 cm [' + te.map(x => x.long).join('/') + ']');
  ok(Math.round(TE._largoRango(d.rango)) === 620 && rotulos('largo')[0].txt === '620',
    'y el rótulo del abanico dice 620');

  // EL ÚLTIMO tramo se edita contra el ANTERIOR (no tiene vecino a la derecha), y un
  // valor que se pasa del par se topa en el par: no hay tramos negativos.
  TE._setLongTramo(d, 0, 100); TE._setLargoRango(d, 'rango', 520);
  TE._setLongTramo(d, 2, 200);
  ok(TE._tramosDe(d).map(x => x.long).join('/') === '100/220/200',
    'el ÚLTIMO tramo → 200: compensa el ANTERIOR [' + TE._tramosDe(d).map(x => x.long).join('/') + ']');
  TE._setLongTramo(d, 2, 9999);
  ok(TE._tramosDe(d).map(x => x.long).join('/') === '100/0/420',
    'un largo imposible se topa en el par (el vecino llega a 0, nunca negativo) [' +
    TE._tramosDe(d).map(x => x.long).join('/') + ']');
  ok(Math.round(TE._largoRango(d.rango)) === 520, '…y el rango sigue midiendo 520');

  // Nº PAR de tramos: al estirar el abanico se lo reparten LOS DOS DEL MEDIO.
  const cp = montar([estribo({
    from: -260, to: 260, sep: 10, eje: 'x',
    tramos: [{ long: 100, sep: 10 }, { long: 160, sep: 20 }, { long: 160, sep: 20 }, { long: 100, sep: 10 }]
  })]);
  R.reanclarReceta(ST.receta);
  TE._setLargoRango(cp.distribucion, 'rango', 620);
  ok(TE._tramosDe(cp.distribucion).map(x => x.long).join('/') === '100/210/210/100',
    'con 4 tramos los DOS del medio se reparten los 100 cm [' +
    TE._tramosDe(cp.distribucion).map(x => x.long).join('/') + ']');

  // Y con UN SOLO tramo NO se rotula el largo del tramo: sería el mismo número del
  // abanico repetido, y encima no editable (no hay vecino que compense).
  const c1 = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  ok(rotulos('largo', 'data-rango-tlen').length === 0,
    'con un solo tramo no hay rótulo de tramo (no se repite el número del abanico)');

  // EL TIRADOR DEL DIVISOR VIAJA CON SU EJE Y SU LÍNEA (fix 19-ago): antes el
  // arrastre lo deducía de _ejeDistDe(comp) y con la pieza girada apuntaba a otro eje.
  montar([estribo({
    from: -260, to: 260, sep: 10, eje: 'x',
    tramos: [{ long: 200, sep: 10 }, { long: 320, sep: 20 }]
  })]);
  R.reanclarReceta(ST.receta);
  const divs = pintar('largo').filter(n => n.attrs['data-rango-div'] != null);
  ok(divs.length === 1 && divs[0].attrs['data-rango-eje'] === 'x' && divs[0].attrs['data-rango-cual'] === 'rango',
    'el divisor lleva su eje y su línea en el tirador [' + JSON.stringify(divs.map(x => x.attrs['data-rango-eje'])) + ']');
}

// ---------------------------------------------------------------------------
console.log('\nH · LA RUEDA: ±1 cm sobre el rótulo, y el zoom del cuadrante intacto');
// ---------------------------------------------------------------------------
{
  const c = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  const d = c.distribucion;
  const svgFalso = { closest: () => null };
  function rueda(attrs, deltaY, shift) {
    const ev = {
      deltaY: deltaY, shiftKey: !!shift, _def: 0, _stop: 0,
      target: { getAttribute: (k) => (attrs && attrs[k] != null) ? attrs[k] : null },
      preventDefault() { this._def++; }, stopPropagation() { this._stop++; }
    };
    TE._ruedaRotulo('largo', svgFalso, ev);
    return ev;
  }
  ok(TE.PASO_ARRASTRE_CM === 1, 'el paso de la rueda es el del resto del editor: 1 cm');

  const e1 = rueda({ 'data-rango-len': 'rango' }, -120);      // rueda arriba
  ok(Math.round(TE._largoRango(d.rango)) === 521, 'rueda arriba: 520 → 521 [' +
    Math.round(TE._largoRango(d.rango)) + ']');
  ok(e1._def === 1 && e1._stop === 1, 'sobre el rótulo la rueda NO llega al zoom (preventDefault + stopPropagation)');
  rueda({ 'data-rango-len': 'rango' }, 120);                  // rueda abajo
  rueda({ 'data-rango-len': 'rango' }, 120);
  ok(Math.round(TE._largoRango(d.rango)) === 519, 'rueda abajo ×2: 521 → 519 [' +
    Math.round(TE._largoRango(d.rango)) + ']');
  ok(d.rango.from === -260, 'la rueda tampoco mueve el `from`');
  ok(!!d.rango.ancla && d.rango.ancla.fin.ref === 'max' && d.rango.ancla.fin.d === 41,
    'y re-ancla en cada vuelta (fin a 41 cm del borde +) [' + JSON.stringify(d.rango.ancla.fin) + ']');

  // CONTRA EL PISO la rueda no apila undo basura: si el largo ya es 0, seguir girando
  // no cambia nada y no puede llenar la pila de deshacer.
  TE._setLargoRango(d, 'rango', 0);
  const pila = TE._ST.undoStack.length;
  rueda({ 'data-rango-len': 'rango' }, 120);
  rueda({ 'data-rango-len': 'rango' }, 120);
  ok(TE._ST.undoStack.length === pila && Math.round(TE._largoRango(d.rango)) === 0,
    'con el largo en 0, girar hacia abajo no mueve nada ni apila undo [pila ' + pila +
    '→' + TE._ST.undoStack.length + ']');
  TE._setLargoRango(d, 'rango', 519);

  // Un evento sin deltaY vertical (rueda horizontal) no suma nada.
  const e0 = rueda({ 'data-rango-len': 'rango' }, 0);
  ok(e0._def === 0 && Math.round(TE._largoRango(d.rango)) === 519,
    'una rueda horizontal (deltaY 0) sobre el rótulo no cambia el largo');

  // FUERA del rótulo la rueda es del ZOOM: no se toca el evento ni el dato.
  const antes = d.rango.to;
  const e2 = rueda({ 'data-ci': '0' }, -120);
  ok(e2._def === 0 && e2._stop === 0, 'sobre cualquier otro punto de la vista la rueda sigue siendo el zoom');
  ok(d.rango.to === antes, '…y no cambia el rango');

  // Con SHIFT el cuadrante es de MIRAR (gate de las cotas por lado): la rueda no edita.
  const e3 = rueda({ 'data-rango-len': 'rango' }, -120, true);
  ok(e3._def === 0 && d.rango.to === antes, 'con SHIFT apretado el rótulo no se edita (el cuadrante es de mirar)');

  // LARGO CON DECIMALES: la rueda aterriza en el centímetro que MUESTRA el rótulo.
  d.rango.to = d.rango.from + 592.4; TE._anclarRangoUI(d.rango, 'x');
  rueda({ 'data-rango-len': 'rango' }, -120);
  ok(r4(TE._largoRango(d.rango)) === 593, '592.4 + una vuelta = 593 (no 593.4): el paso manda [' +
    r4(TE._largoRango(d.rango)) + ']');

  // …y sobre el largo de un TRAMO hace lo mismo, sin tocar el largo del rango.
  const c2 = montar([estribo({
    from: -260, to: 260, sep: 10, eje: 'x',
    tramos: [{ long: 100, sep: 10 }, { long: 320, sep: 20 }, { long: 100, sep: 10 }]
  })]);
  R.reanclarReceta(ST.receta);
  rueda({ 'data-rango-tlen': '0' }, -120);
  const tt = TE._tramosDe(c2.distribucion);
  ok(tt[0].long === 101 && tt[1].long === 319, 'rueda sobre el tramo 1: 100→101 y el vecino 320→319 [' +
    tt.map(x => x.long).join('/') + ']');
  ok(Math.round(TE._largoRango(c2.distribucion.rango)) === 520, '…y el rango sigue midiendo 520');
}

// ---------------------------------------------------------------------------
console.log('\nI · OTROS EJES Y OTRO ELEMENTO (nada de esto conoce a la viga)');
// ---------------------------------------------------------------------------
{
  // RANGO EN Z (pieza volteada): en SECCIÓN de la viga (u=z, v=y) es el eje HORIZONTAL
  // y en PLANTA (u=x, v=z) el VERTICAL. El mismo rótulo y el mismo número las dos veces.
  const c = montar([estribo({ from: -12, to: 12, sep: 6, eje: 'z' })]);
  R.reanclarReceta(ST.receta);
  const sec = rotulos('seccion'), pla = rotulos('planta');
  ok(sec.length === 1 && sec[0].txt === '24' && sec[0].eje === 'z',
    'rango en Z: en SECCIÓN sale el rótulo horizontal y dice 24 [' + (sec[0] || {}).txt + ']');
  ok(pla.length === 1 && pla[0].txt === '24',
    'y en PLANTA sale el mismo número, en la flecha vertical [' + (pla[0] || {}).txt + ']');
  ok(rotulos('largo').length === 0, 'a lo LARGO (donde Z es la profundidad) no se dibuja');
  TE._setLargoRango(c.distribucion, 'rango', 20);
  ok(c.distribucion.rango.to === 8 && rotulos('seccion')[0].txt === '20',
    'se edita igual en Z: to = −12+20 = 8 [' + c.distribucion.rango.to + ']');
  const az = c.distribucion.rango.ancla;
  ok(az.ini.ref === 'min' && az.ini.d === 3 && az.fin.ref === 'max' && az.fin.d === 7,
    'y se ancla contra el ANCHO (30), no contra el largo: 3 y 7 cm de cada cara [' +
    JSON.stringify(az) + ']');

  // MURO — otra tabla de planos (seccion u=x/v=z · largo u=x/v=y · planta u=z/v=y).
  const cm = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })],
    { largo: 600, alto: 300, ancho: 20, recub_sup: 4, recub_inf: 4, recub_lat: 3 });
  ST.receta.tipo = 'muro';
  R.reanclarReceta(ST.receta);
  ok(rotulos('seccion')[0] && rotulos('seccion')[0].txt === '520',
    'MURO: el rótulo sale en su SECCIÓN (que es el corte horizontal) [' +
    ((rotulos('seccion')[0] || {}).txt) + ']');
  ok(rotulos('largo')[0] && rotulos('largo')[0].txt === '520', 'MURO: y también en la elevación');
  ok(rotulos('planta').length === 0, 'MURO: en la vista donde X es la profundidad, no');
  TE._setLargoRango(cm.distribucion, 'rango', 300);
  ok(rotulos('seccion')[0].txt === '300' && rotulos('largo')[0].txt === '300',
    'MURO: editarlo mueve el número en las DOS vistas que lo muestran');
  ST.receta.tipo = 'viga';
}

// ---------------------------------------------------------------------------
console.log('\nJ · EL CLIC: input inline → Enter/blur aplica, Esc cancela');
// ---------------------------------------------------------------------------
{
  // Camino REAL del gesto: _abrirEditorLargo cuelga un <input> sobre el cuadrante y
  // aplica al confirmar. Se le da un DOM que graba los listeners para poder disparar
  // Enter, Esc y blur — lo que el test de arriba no toca (ahí se prueba la escritura,
  // acá el gesto que la dispara).
  function Inp() {
    this.style = {}; this.value = ''; this.className = ''; this.type = ''; this.title = '';
    this.ev = {};
    this.classList = { add: () => {}, remove: () => {}, contains: () => false };
  }
  Inp.prototype.addEventListener = function (k, f) { (this.ev[k] = this.ev[k] || []).push(f); };
  Inp.prototype.focus = function () {}; Inp.prototype.select = function () {};
  Inp.prototype.setAttribute = function () {};
  const vista = {
    hijos: [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 300 }),
    appendChild(c) { this.hijos.push(c); c.parentNode = this; return c; },
    removeChild(c) { this.hijos = this.hijos.filter(x => x !== c); return c; }
  };
  const svgFalso = { closest: () => vista };
  const evtClic = { clientX: 100, clientY: 50 };
  const antesCreate = win.document.createElement;
  win.document.createElement = () => new Inp();
  function disparar(inp, k, extra) {
    (inp.ev[k] || []).forEach(f => f.call(inp, Object.assign({
      preventDefault() {}, stopPropagation() {}
    }, extra || {})));
  }

  const c = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' })]);
  R.reanclarReceta(ST.receta);
  const d = c.distribucion;

  TE._abrirEditorLargo('largo', svgFalso, 'rango', evtClic);
  let inp = vista.hijos[vista.hijos.length - 1];
  ok(!!inp && Number(inp.value) === 520, 'el input abre con el largo actual (520) [' + (inp && inp.value) + ']');
  inp.value = '300';
  disparar(inp, 'blur');
  ok(Math.round(TE._largoRango(d.rango)) === 300 && d.rango.to === 40,
    'soltar el foco aplica: 300 cm, to = 40 [' + d.rango.to + ']');
  ok(vista.hijos.length === 0, 'y el input se retira del cuadrante');
  ok(rotulos('largo')[0].txt === '300', 'el rótulo dibujado ya dice 300');

  // ESC no aplica.
  TE._abrirEditorLargo('largo', svgFalso, 'rango', evtClic);
  inp = vista.hijos[vista.hijos.length - 1];
  inp.value = '999';
  disparar(inp, 'keydown', { key: 'Escape' });
  ok(Math.round(TE._largoRango(d.rango)) === 300, 'Esc cancela: el largo sigue en 300');
  ok(vista.hijos.length === 0, '…y el input se cierra igual');

  // ENTER aplica.
  TE._abrirEditorLargo('largo', svgFalso, 'rango', evtClic);
  inp = vista.hijos[vista.hijos.length - 1];
  inp.value = '250';
  disparar(inp, 'keydown', { key: 'Enter' });
  ok(Math.round(TE._largoRango(d.rango)) === 250, 'Enter aplica: 250 [' +
    Math.round(TE._largoRango(d.rango)) + ']');

  // Un valor INVÁLIDO no se aplica ni cierra con Enter (se corrige en el sitio).
  TE._abrirEditorLargo('largo', svgFalso, 'rango', evtClic);
  inp = vista.hijos[vista.hijos.length - 1];
  inp.value = '-40';
  disparar(inp, 'keydown', { key: 'Enter' });
  ok(Math.round(TE._largoRango(d.rango)) === 250 && vista.hijos.length === 1,
    'un largo negativo se rechaza y el input SIGUE abierto para corregirlo');
  disparar(inp, 'keydown', { key: 'Escape' });

  // El "@N" sigue capeado en SEP_MIN por el mismo editor generalizado.
  const cm2 = montar([estribo({
    from: -260, to: 260, sep: 10, eje: 'x',
    tramos: [{ long: 200, sep: 10 }, { long: 320, sep: 20 }]
  })]);
  R.reanclarReceta(ST.receta);
  TE._abrirEditorAt('largo', svgFalso, 0, evtClic);
  inp = vista.hijos[vista.hijos.length - 1];
  inp.value = '0.1';
  disparar(inp, 'keydown', { key: 'Enter' });
  ok(TE._tramosDe(cm2.distribucion)[0].sep === 10 && vista.hijos.length === 1,
    'un @ bajo el mínimo (' + TE.SEP_MIN + ') se rechaza igual que antes');
  disparar(inp, 'keydown', { key: 'Escape' });

  // Y el largo de un TRAMO se edita por el mismo camino.
  TE._abrirEditorLargoTramo('largo', svgFalso, 0, evtClic);
  inp = vista.hijos[vista.hijos.length - 1];
  ok(Number(inp.value) === 200, 'el input del tramo abre con SU largo (200) [' + inp.value + ']');
  inp.value = '150';
  disparar(inp, 'blur');
  ok(TE._tramosDe(cm2.distribucion).map(x => x.long).join('/') === '150/370',
    'aplica y el vecino compensa [' + TE._tramosDe(cm2.distribucion).map(x => x.long).join('/') + ']');
  ok(Math.round(TE._largoRango(cm2.distribucion.rango)) === 520, '…sin mover el largo del rango');

  win.document.createElement = antesCreate;
}

// ---------------------------------------------------------------------------
console.log('\nK · DEFECTOS DE AUDITORÍA (19-ago) — congelados para que no vuelvan');
// ---------------------------------------------------------------------------
{
  // K1 · ENCAJE: con un rango corto la caja del rótulo es MÁS ANCHA que la flecha.
  // Dibujada encima tapaba LOS DOS handles y el rect de arrastre, y el abanico
  // quedaba inarrastrable — al que además se llega con la rueda del propio rótulo.
  function cajas(largoCm) {
    const c = montar([estribo({ from: -largoCm / 2, to: largoCm / 2, sep: 20, eje: 'x' })]);
    R.reanclarReceta(ST.receta);
    const todos = pintar('largo');
    const rot = todos.filter(n => n.tag === 'rect' && n.attrs['data-rango-len'] != null)[0];
    const hs = todos.filter(n => n.tag === 'rect' && n.attrs['data-rango-end'] != null)
      .map(n => [Number(n.attrs.x), Number(n.attrs.x) + Number(n.attrs.width)]);
    return { rot: rot ? [Number(rot.attrs.x), Number(rot.attrs.x) + Number(rot.attrs.width)] : null, hs: hs };
  }
  function pisa(a, b) { return a && b && a[0] < b[1] && b[0] < a[1]; }
  [10, 20, 30, 60].forEach(function (L) {
    const g = cajas(L);
    ok(g.rot && !pisa(g.rot, g.hs[0]) && !pisa(g.rot, g.hs[1]),
      'rango de ' + L + ' cm: el rótulo NO pisa ningún handle [rot ' +
      (g.rot || []).map(v => v.toFixed(1)).join('..') + ' · handles ' +
      g.hs.map(h => h.map(v => v.toFixed(1)).join('..')).join(' ') + ']');
  });
  // …y con un rango largo sí va centrado sobre la línea (que es donde se lee mejor).
  const gL = cajas(520);
  ok(gL.rot[0] > gL.hs[0][1] && gL.rot[1] < gL.hs[1][0],
    'rango de 520 cm: el rótulo va centrado, entre los dos handles');

  // K1b · ENCAJE DE LA PAREJA [largo][@] del nodo múltiple: mide el doble que el
  // "@N" solo, así que en tramos cortos se caía encima del rótulo del tramo vecino.
  // Cuando no cabe se cae el LARGO y queda el "@N" de siempre.
  function paresDe(longs) {
    montar([estribo({
      from: -260, to: 260, sep: 10, eje: 'x',
      tramos: longs.map(L => ({ long: L, sep: 10 }))
    })]);
    R.reanclarReceta(ST.receta);
    const t = pintar('largo').filter(n => n.tag === 'rect' &&
      (n.attrs['data-rango-tlen'] != null || n.attrs['data-rango-at'] != null))
      .map(n => [Number(n.attrs.x), Number(n.attrs.x) + Number(n.attrs.width), n.attrs['data-rango-tlen'] != null]);
    t.sort((a, b) => a[0] - b[0]);
    // choque = alguna caja de LARGO (lo que agrega esta feature) pisa a otra caja.
    // Los "@N" entre sí son cosa aparte y anterior: con tramos de 20 cm ya se pisaban
    // (la caja del "@10" mide ~21 u y el tramo mide 19) — eso NO se toca acá.
    let choque = false;
    for (let i = 1; i < t.length; i++) {
      if (t[i][0] < t[i - 1][1] - 1e-9 && (t[i][2] || t[i - 1][2])) choque = true;
    }
    return { cajas: t, choque: choque, largos: t.filter(x => x[2]).length };
  }
  const anchos = paresDe([200, 320]);
  ok(!anchos.choque && anchos.largos === 2,
    'tramos anchos (200/320): salen los 2 largos y ninguno pisa a nadie');
  const cortos = paresDe([20, 20, 20, 460]);
  ok(!cortos.choque,
    'tramos de 20 cm: ningún rótulo de LARGO pisa a otra caja [' +
    cortos.cajas.map(c => c[0].toFixed(0) + '..' + c[1].toFixed(0)).join(' ') + ']');
  ok(cortos.largos === 1, 'porque en los 3 tramos donde no cabe se cae el largo y queda el "@N" [' +
    cortos.largos + ' de 4]');

  // K2 · LA CANTIDAD ES LA DEL MOTOR (ceil), no un round propio. 521 @20 es el caso
  // que lo destapa: round decía 27 y el motor repartía 28 — el panel y la pantalla
  // mostrando dos verdades distintas del mismo rango.
  const cn = montar([estribo({ from: -260, to: 261, sep: 20, eje: 'x', n: 27 })]);
  R.reanclarReceta(ST.receta);
  TE._syncN(cn.distribucion, 'rango', true);
  ok(cn.distribucion.rango.n === 28,
    '521 cm @20: el panel dice 28 [' + cn.distribucion.rango.n + ']');
  ok(nodosX(cn).length === 28,
    '…y el motor reparte 28 barras [' + nodosX(cn).length + ']');
  ok(TE._rangoEditor(cn, cn.distribucion, 0)._rotulo() === 'Rango · 521 cm',
    'y el campo del panel dice el largo redondeado al cm [' +
    TE._rangoEditor(cn, cn.distribucion, 0)._rotulo() + ']');

  // K3 · EL EJE VIAJA EN EL RÓTULO. _setLargoRango es el único escritor de from/to
  // que no lo recibía: sin él, _anclarRangoUI cae a 'x' y ancla el rango del ALTO
  // contra el LARGO del elemento (una receta vieja puede no traer `eje`).
  const ce = montar([estribo({ from: -260, to: 260, sep: 20, eje: 'x' }, {
    modo: 'arreglo',
    distribucion: {
      modo: 'arreglo', activa: true, sep: 20,
      rango: { from: -260, to: 260, sep: 20, eje: 'x' },
      rango2: { from: -22, to: 22, sep: 11 }          // SIN eje: receta vieja
    }
  })]);
  const rot2 = rotulos('largo').filter(x => x.cual === 'rango2')[0];
  ok(rot2 && rot2.eje === 'y', 'el rótulo de la 2ª línea publica su eje dibujado (y) [' +
    (rot2 || {}).eje + ']');
  TE._setLargoRango(ce.distribucion, 'rango2', 40, rot2.eje);
  const a2 = ce.distribucion.rango2.ancla;
  ok(ce.distribucion.rango2.eje === 'y' && a2.ini.ref === 'min' && a2.ini.d === 8 && a2.fin.d === 12,
    'con el eje del rótulo se ancla contra el ALTO (8 y 12), no contra el largo [' +
    JSON.stringify(a2) + ']');

  // K4 · SALTAR DE UN RÓTULO A OTRO NO TIRA LO TECLEADO. Sacar el <input> del DOM no
  // dispara blur en Chrome y el mousedown del rótulo nuevo hace preventDefault antes
  // del cambio de foco: el valor se perdía en silencio.
  function Inp2() {
    this.style = {}; this.value = ''; this.className = ''; this.type = ''; this.title = ''; this.ev = {};
    this.classList = { add: () => {}, remove: () => {}, contains: () => false };
  }
  Inp2.prototype.addEventListener = function (k, f) { (this.ev[k] = this.ev[k] || []).push(f); };
  Inp2.prototype.focus = function () {}; Inp2.prototype.select = function () {};
  Inp2.prototype.setAttribute = function () {};
  const vista2 = {
    hijos: [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 300 }),
    appendChild(c) { this.hijos.push(c); c.parentNode = this; return c; },
    removeChild(c) { this.hijos = this.hijos.filter(x => x !== c); return c; }
  };
  const svg2 = { closest: () => vista2 };
  const antesCreate2 = win.document.createElement;
  win.document.createElement = () => new Inp2();

  const ck = montar([estribo({
    from: -260, to: 260, sep: 10, eje: 'x',
    tramos: [{ long: 200, sep: 10 }, { long: 320, sep: 20 }]
  })]);
  R.reanclarReceta(ST.receta);
  TE._abrirEditorLargo('largo', svg2, 'rango', { clientX: 10, clientY: 10 }, 'x');
  vista2.hijos[0].value = '400';
  TE._abrirEditorAt('largo', svg2, 0, { clientX: 20, clientY: 10 });   // se abre OTRO rótulo
  ok(Math.round(TE._largoRango(ck.distribucion.rango)) === 400,
    'abrir otro rótulo CONFIRMA lo tecleado en el anterior (400) [' +
    Math.round(TE._largoRango(ck.distribucion.rango)) + ']');
  ok(vista2.hijos.length === 1, 'y sólo queda un input abierto [' + vista2.hijos.length + ']');

  // K5 · UN LARGO DE TRAMO QUE NO CABE SE TOPA **Y SE AVISA CON EL NÚMERO**.
  const status = { innerHTML: '' };
  const antesGet = win.document.getElementById;
  win.document.getElementById = (id) => (id === 'te_ctoolsStatus' ? status : null);
  const inpT = vista2.hijos[0];
  (inpT.ev.keydown || []).forEach(f => f.call(inpT, { key: 'Escape', preventDefault() {}, stopPropagation() {} }));
  TE._abrirEditorLargoTramo('largo', svg2, 0, { clientX: 30, clientY: 10 });
  const inp2 = vista2.hijos[vista2.hijos.length - 1];
  inp2.value = '999';
  (inp2.ev.blur || []).forEach(f => f.call(inp2, {}));
  const tk = TE._tramosDe(ck.distribucion);
  ok(tk[0].long === 400 && tk[1].long === 0,
    'el tramo se topa en el par (400/0) [' + tk.map(x => x.long).join('/') + ']');
  ok(/999/.test(status.innerHTML) && /400/.test(status.innerHTML),
    'y la barra de estado lo dice CON LOS NÚMEROS [' + status.innerHTML.replace(/<[^>]*>/g, '') + ']');

  win.document.createElement = antesCreate2;
  win.document.getElementById = antesGet;
}

// =============================================================================
console.log('\n' + (fallos ? '✗ ' + fallos + ' fallo(s)' : '✓ todo verde'));
process.exit(fallos ? 1 : 0);
