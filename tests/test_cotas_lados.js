// =============================================================================
// COTAS POR LADO (gate SHIFT) — test headless (Node)
// =============================================================================
// El usuario selecciona una barra, mantiene SHIFT y sobre cada lado VISIBLE de esa
// barra aparece su rótulo "LETRA=MEDIDA" a lo largo del tramo. Este test congela
// lo que puede estar mal sin que se note mirando la pantalla:
//
//   A. MAPEO LADO ↔ TRAZO — qué pedazo de la polilínea es cada letra. Se mide
//      contra el largo REAL de cada trecho dibujado, no contra una lista escrita a
//      mano: 305A (cadena de 5 lados), 103B (cadena con dos ganchos arqueados) y
//      101A (recta).
//   B. MARCO CERRADO (104D / 106A) — el estribo NO es la cadena de tramos del
//      catálogo (7 trechos rectos para 4 parciales), así que tiene su propio
//      reconocimiento. Se fija: los 4 lados que salen, sus letras, y que la 106A
//      además rotule sus dos patas de gancho DECLARADAS (A y F).
//   C. VISIBILIDAD — LA REGLA QUE EL USUARIO PIDIÓ: «si un lado no es visible no
//      debiera verse (por ejemplo que el tramo 2 entre en el plano y se pierda)».
//      Un tramo perpendicular al plano se proyecta como un PUNTO y NO se rotula.
//      Se comprueba plano por plano y con la pieza GIRADA (lo que se ve en cada
//      cuadrante tiene que seguir a la pose, no a una tabla).
//   D. VALOR MOSTRADO — es la dim EFECTIVA (autos resueltos + Δ sumado), NO el
//      largo dibujado: el trazo mide menos que la dim porque la convención BVBS
//      mide a vértice y el codo se come el setback (103B φ16: cuerpo dibujado
//      582.4, dim B = 590.4 → el rótulo dice 590). Y se redondea al CENTÍMETRO.
//   E. EL GATE — _setCotasLado no se prende sin selección ni con el editor
//      cerrado, y soltar SIEMPRE apaga (un keyup perdido no puede dejar los
//      rótulos pegados en pantalla).
//   F. LO QUE NO SE PUEDE MAPEAR NO SE ROTULA — figura fuera del catálogo, sin φ,
//      sin placement: null, no una letra inventada.
//   G. EL CAMINO DE DIBUJO REAL — _dibujarCotasLados contra un SVG que graba: qué
//      textos salen en cada cuadrante, el AGRUPADO de los lados que se pisan en
//      pantalla (dos rótulos calcados = borrón), y que ninguno quede de cabeza ni
//      con un transform NaN (una etiqueta con NaN no se ve como error: no aparece).
//   H. MURO — los tres cuadrantes son OTROS planos y la regla los sigue: nada de
//      la lógica de cotas conoce a la viga.
//   I. EL CUCHILLO — de las N barras de un componente repartido se rotula LA QUE
//      ESA VISTA MUESTRA (la más cercana al corte, con los mismos cortePos/
//      corteGrosor del render), no "la primera de la lista", que en SECCIÓN
//      dejaba los rótulos flotando sobre una sección vacía.
//   J. …Y EL CUCHILLO CORTA LADO POR LADO — el cuerpo de un longitudinal cruza la
//      sección entera pero sus PATAS viven en las puntas: con el corte a media
//      luz no se rotulan, con el corte sobre la punta sí.
//   K. BARRIDO DEL CATÁLOGO ENTERO — 6.048 barras reales (63 figuras × 8
//      tipologías × 3 φ × 2 poses × viga/muro): ninguna letra cae en un lado que se
//      aleje más del tope FÍSICO 6·φ, y ningún par de letras comparte trecho. Es la
//      prueba de que el mapeo no está cruzado, y no depende de una lista a mano.
//
// Correr con: node tests/test_cotas_lados.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

// --------------------------------------------------------------- entorno mínimo
// Mismo mini-DOM que tests/test_lado_dominante.js: acá se prueban funciones PURAS
// (mapeo de índices, proyección, gate) y el DOM es un stub que nadie toca.
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

const FP = win.ModeladorFiguraPuntos;
const CAT = win.ModeladorCatalogoFiguras;
const R = win.ModeladorReglas;
const TE = win.TemplateEditor;

const HOST = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

// PLANOS DE LA VIGA — la MISMA tabla que usa el editor (u, v, profundidad). Se
// escribe acá porque PLANOS_POR_ELEMENTO es privado del módulo; si un día cambia,
// este test lo dice comparando lo que se ve en cada cuadrante.
const PLANOS = {
  seccion: { u: 'z', v: 'y', depth: 'x' },
  largo:   { u: 'x', v: 'y', depth: 'z' },
  planta:  { u: 'x', v: 'z', depth: 'y' }
};
const proyDe = (p) => (pt) => ({ u: pt[PLANOS[p].u], v: pt[PLANOS[p].v] });

function dimsAuto(fig) {
  const sp = CAT.get(fig) || {};
  const d = {};
  (sp.parciales || []).forEach(p => { d[p] = { modo: 'auto' }; });
  return d;
}
function comp(fig, tip, extra) {
  const c = {
    comp_id: 'X', jerarquia: 2, tipologia: tip, figura: fig, diam: 8, suf_tipo: '',
    cara: (tip === 'ES' || tip === 'TRV') ? 'lateral' : 'sup',
    recub_override: null, angulos: [], prioridad: null, empalme: null, depende_de: null,
    modo: 'puntual', plano_pieza: { volteado: false },
    arreglo: { n_capas: 1, sep_capas: 20, rango: null },
    dims: dimsAuto(fig),
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' }
  };
  for (const k in (extra || {})) c[k] = extra[k];
  return c;
}
function barra(fig, tip, extra) {
  const c = comp(fig, tip, extra);
  const pls = R.expandirComponente(c, HOST);
  if (!pls || !pls.length) return null;
  return { pl: pls[0], rol: c._rol };
}
function lados(fig, tip, extra) {
  const b = barra(fig, tip, extra);
  return b ? TE._ladosRotulables(b.pl, b.rol) : null;
}
function porLetra(ls) {
  const m = {};
  (ls || []).forEach(l => { m[l.lado] = l; });
  return m;
}
// largo 3D REAL del trecho que el rótulo va a acompañar
function largoTrazo(pl, l) {
  const a = pl.puntos[l.i0], b = pl.puntos[l.i1];
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
// las letras que se rotulan en un plano (las visibles), en orden
function visiblesEn(fig, tip, plano, extra) {
  const b = barra(fig, tip, extra); if (!b) return null;
  const ls = TE._ladosRotulables(b.pl, b.rol); if (!ls) return null;
  const proj = proyDe(plano);
  return ls.filter(l => TE._ladoVisibleEnPlano(b.pl.puntos, l, proj) > 0)
           .map(l => l.lado).sort();
}
// el rótulo tal cual se escribe
function rotulo(l) { return l.lado + '=' + Math.round(l.valor); }

// ---------------------------------------------------------------------------
console.log('\nA · MAPEO LADO ↔ TRAZO (cadenas y recta)');
// ---------------------------------------------------------------------------
{
  // 305A: cadena ABIERTA de 5 lados, sin arcos → un tramo = un par de puntos.
  const b = barra('305A', 'ES');
  const ls = TE._ladosRotulables(b.pl, b.rol);
  ok(!!ls && ls.length === 5, '305A: 5 lados rotulables (salieron ' + (ls ? ls.length : 0) + ')');
  ok(ls.map(l => l.lado).join('') === 'ABCDE', '305A: letras en orden de cadena A-E');
  // el trazo de cada lado mide lo que dice su dim (esta figura no tiene codos)
  let exacto = true;
  ls.forEach(l => { if (Math.abs(largoTrazo(b.pl, l) - l.valor) > 1e-6) exacto = false; });
  ok(exacto, '305A: cada lado mapeado mide exactamente su dim (23.2/51.2/23.2/51.2/23.2)');
}
{
  // 103B: dos ganchos ARQUEADOS (15 puntos cada uno) con el cuerpo justo entre los
  // dos arcos. Es el caso que rompe la cuenta ingenua "el tramo i son los puntos i,i+1".
  const b = barra('103B', 'CBS', { diam: 16 });
  const ls = TE._ladosRotulables(b.pl, b.rol);
  const m = porLetra(ls);
  ok(!!ls && ls.length === 3, '103B: 3 lados rotulables');
  ok(m.B && m.B.i0 === 15 && m.B.i1 === 16,
    '103B: el cuerpo B va del final del 1er arco al principio del 2º (15→16), no 1→2');
  ok(m.A && m.A.i0 === 0 && m.A.i1 === 1, '103B: la pata A sale del punto 0 al arranque del arco');
  ok(m.C && m.C.i1 === b.pl.puntos.length - 1, '103B: la pata C termina en el último punto del trazo');
}
{
  const b = barra('101A', 'CBI', { diam: 18 });
  const ls = TE._ladosRotulables(b.pl, b.rol);
  ok(!!ls && ls.length === 1 && ls[0].lado === 'A', '101A: un solo lado, A');
  ok(ls[0].i0 === 0 && ls[0].i1 === 1, '101A: A ocupa el trazo entero (0→1)');
}
{
  // Sin φ no hay cota con que agrupar los arcos → no se adivina un mapeo.
  const b = barra('103B', 'CBS', { diam: 16 });
  ok(TE._tramosEnTrazo('103B', b.rol, b.pl.puntos, 0) === null,
    'sin φ no se deriva mapeo (mejor sin rótulo que con uno inventado)');
}

// ---------------------------------------------------------------------------
console.log('\nB · MARCO CERRADO (el estribo no es la cadena del catálogo)');
// ---------------------------------------------------------------------------
{
  const b = barra('104D', 'ES');
  const ls = TE._ladosRotulables(b.pl, b.rol);
  ok(!!ls && ls.length === 4, '104D: 4 lados rotulables (salieron ' + (ls ? ls.length : 0) + ')');
  // Las 4 letras del marco, sin repetir
  const set = (ls || []).map(l => l.lado).sort().join('');
  ok(set === 'ABCD', '104D: las 4 letras del catálogo, una por lado (' + set + ')');
  // Cada rótulo cae sobre un lado cuyo largo dibujado CONCUERDA con su dim. La
  // diferencia máxima NO es libre: la dim del marco vale eje + φ (24 contra 23.2 de
  // eje) y el codo del gancho se come Rc = 2.5·φ más en dos de los cuatro lados
  // (21.2 contra 23.2), o sea 3.5·φ = 2.8 cm con φ8. Si un rótulo cayera en el lado
  // equivocado el desvío sería 25-30 cm, no 2.8.
  const TOL_MARCO = 3.5;
  let coherente = true, peor = 0;
  (ls || []).forEach(l => {
    const d = Math.abs(largoTrazo(b.pl, l) - l.valor);
    if (d > peor) peor = d;
    if (d > TOL_MARCO * b.pl.diam + 1e-6) coherente = false;
  });
  ok(coherente, '104D: cada letra cae en un lado del largo correcto (peor desvío ' +
    peor.toFixed(2) + ' cm ≤ φ + Rc = ' + (TOL_MARCO * b.pl.diam).toFixed(2) + ')');
  // ancho vs alto: los dos lados del ancho miden 24 y los del alto 52
  const m = porLetra(ls);
  ok(Math.round(m.A.valor) === 24 && Math.round(m.C.valor) === 24, '104D: A y C = 24 (ancho útil)');
  ok(Math.round(m.B.valor) === 52 && Math.round(m.D.valor) === 52, '104D: B y D = 52 (alto útil)');
}
{
  // 106A: mismo marco pero con las patas de gancho DECLARADAS (A y F son parciales).
  const b = barra('106A', 'ES');
  const ls = TE._ladosRotulables(b.pl, b.rol);
  const set = (ls || []).map(l => l.lado).sort().join('');
  ok(set === 'ABCDEF', '106A: los 4 lados del marco MÁS las dos patas declaradas (' + set + ')');
  const m = porLetra(ls);
  ok(Math.round(m.A.valor) === 8 && Math.round(m.F.valor) === 8,
    '106A: las patas A y F rotulan su propia dim (7.5 → 8)');
  ok(Math.round(m.C.valor) === 24 && Math.round(m.E.valor) === 24, '106A: C y E = 24 (ancho)');
  ok(Math.round(m.B.valor) === 52 && Math.round(m.D.valor) === 52, '106A: B y D = 52 (alto)');
  // la pata del INICIO es el primer trecho del trazo y la del FIN el último
  ok(m.A.i0 === 0, '106A: la pata A arranca en el punto 0 del trazo');
  ok(m.F.i1 === b.pl.puntos.length - 1, '106A: la pata F termina en el último punto');
}

// ---------------------------------------------------------------------------
console.log('\nC · VISIBILIDAD — un tramo perpendicular al plano NO se rotula');
// ---------------------------------------------------------------------------
{
  // ESTRIBO de viga: vive en el plano Y-Z (la sección). En SECCIÓN se ve entero;
  // en A LO LARGO y en PLANTA la mitad de sus lados corre por la profundidad.
  ok(visiblesEn('104D', 'ES', 'seccion').join('') === 'ABCD',
    '104D en SECCIÓN: se ven los 4 lados');
  const largo = visiblesEn('104D', 'ES', 'largo');
  ok(largo.join('') === 'BD',
    '104D en A LO LARGO: sólo B y D (A y C corren por la profundidad Z → punto) [salió ' + largo.join('') + ']');
  const planta = visiblesEn('104D', 'ES', 'planta');
  ok(planta.join('') === 'AC',
    '104D en PLANTA: sólo A y C (B y D corren por la profundidad Y → punto) [salió ' + planta.join('') + ']');
}
{
  // La barra LONGITUDINAL de la viga corre por X: en SECCIÓN (profundidad X) se ve
  // de punta y no se rotula NADA; en las otras dos vistas se ve entera.
  ok(visiblesEn('101A', 'CBI', 'seccion', { diam: 18 }).length === 0,
    '101A en SECCIÓN: ningún rótulo (la barra se ve de punta)');
  ok(visiblesEn('101A', 'CBI', 'largo', { diam: 18 }).join('') === 'A', '101A en A LO LARGO: se rotula A');
  ok(visiblesEn('101A', 'CBI', 'planta', { diam: 18 }).join('') === 'A', '101A en PLANTA: se rotula A');
}
{
  // 103B: el CUERPO corre por X y las patas bajan en Y. En SECCIÓN el cuerpo se
  // pierde (punto) pero las patas NO: siguen teniendo componente en Y.
  const sec = visiblesEn('103B', 'CBS', 'seccion', { diam: 16 });
  ok(sec.indexOf('B') < 0, '103B en SECCIÓN: el cuerpo B NO se rotula (se mete en profundidad)');
  ok(sec.join('') === 'AC', '103B en SECCIÓN: las patas A y C sí (bajan en Y) [salió ' + sec.join('') + ']');
  ok(visiblesEn('103B', 'CBS', 'largo', { diam: 16 }).join('') === 'ABC',
    '103B en A LO LARGO: se ven los 3');
}
{
  // LA REGLA SIGUE A LA POSE, NO A UNA TABLA: el mismo estribo con la pose de rumbo
  // Z (el marco pasa a vivir en el plano X-Y) invierte qué se ve en cada cuadrante.
  const pose = { pose: { cara: 'sup', lado: 1, rumbo: 'z', espejo: false } };
  const sec = visiblesEn('104D', 'ES', 'seccion', pose);
  const lar = visiblesEn('104D', 'ES', 'largo', pose);
  ok(sec.join('') === 'BD', '104D girada, SECCIÓN: sólo B y D [salió ' + sec.join('') + ']');
  ok(lar.join('') === 'ABCD', '104D girada, A LO LARGO: se ven los 4 [salió ' + lar.join('') + ']');
}
{
  // La cota de "es un punto" es GHOST_PT_TOL = 0.5 cm y se aplica en cm del mundo,
  // no en píxeles: un lado de 0.3 cm proyectados no se rotula aunque el zoom lo
  // haga grande en pantalla.
  const puntos = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0.3 }];
  const proj = proyDe('seccion');   // u = z, v = y  →  proyecta 0.3 cm
  ok(TE._ladoVisibleEnPlano(puntos, { i0: 0, i1: 1 }, proj) === 0,
    '0.3 cm proyectados = punto (por debajo de GHOST_PT_TOL) → no se rotula');
  const puntos2 = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0.8 }];
  ok(TE._ladoVisibleEnPlano(puntos2, { i0: 0, i1: 1 }, proj) > 0,
    '0.8 cm proyectados sí es un lado → se rotula');
}

// ---------------------------------------------------------------------------
console.log('\nD · EL VALOR ES LA MEDIDA REAL DE CORTE, AL CENTÍMETRO');
// ---------------------------------------------------------------------------
{
  // El trazo del cuerpo mide MENOS que la dim (la convención BVBS mide a vértice y
  // el codo se come el setback). El rótulo tiene que decir la DIM.
  const b = barra('103B', 'CBS', { diam: 16 });
  const m = porLetra(TE._ladosRotulables(b.pl, b.rol));
  const dibujado = largoTrazo(b.pl, m.B);
  ok(Math.abs(dibujado - 582.4) < 0.05, '103B φ16: el cuerpo DIBUJADO mide 582.4 (' + dibujado.toFixed(1) + ')');
  ok(Math.abs(m.B.valor - 590.4) < 0.05, '103B φ16: la dim EFECTIVA de B es 590.4 (la que se corta)');
  ok(rotulo(m.B) === 'B=590', '103B: el rótulo dice B=590, no B=582');
}
{
  // Δ del usuario: el rótulo tiene que MOVERSE con él (la dim efectiva ya lo trae).
  const base = barra('101A', 'CBI', { diam: 18 });
  const conD = barra('101A', 'CBI', { diam: 18, dims: { A: { modo: 'auto', delta: 12 } } });
  const a0 = TE._ladosRotulables(base.pl, base.rol)[0];
  const a1 = TE._ladosRotulables(conD.pl, conD.rol)[0];
  ok(Math.round(a1.valor) - Math.round(a0.valor) === 12,
    'Δ +12 en A: el rótulo pasa de A=' + Math.round(a0.valor) + ' a A=' + Math.round(a1.valor));
}
{
  // Redondeo AL CENTÍMETRO (así se fabrica): 7.5 → 8, 23.2 → 23.
  const b = barra('106A', 'ES');
  const m = porLetra(TE._ladosRotulables(b.pl, b.rol));
  ok(rotulo(m.A) === 'A=8', '106A: la pata de 7.5 se rotula A=8');
  const c = barra('305A', 'ES');
  const mc = porLetra(TE._ladosRotulables(c.pl, c.rol));
  ok(rotulo(mc.A) === 'A=23', '305A: el lado de 23.2 se rotula A=23');
}

// ---------------------------------------------------------------------------
console.log('\nE · EL GATE (SHIFT)');
// ---------------------------------------------------------------------------
{
  const ST = TE._ST;
  ST.cotasLado = false; ST.selCi = -1; ST.ultimoOut = null;
  TE._setCotasLado(true);
  ok(ST.cotasLado === false, 'SHIFT sin selección no prende el gate (no hay barra que acotar)');
  // con selección pero con el editor cerrado (no hay #te_backdrop en este DOM stub)
  ST.selCi = 0;
  TE._setCotasLado(true);
  ok(ST.cotasLado === false, 'SHIFT con el editor cerrado tampoco lo prende');
  // apagar SIEMPRE se puede (un keyup perdido no puede dejar los rótulos pegados)
  ST.cotasLado = true;
  TE._setCotasLado(false);
  ok(ST.cotasLado === false, 'soltar SHIFT apaga el gate incondicionalmente');
  ST.selCi = -1;
}

// ---------------------------------------------------------------------------
console.log('\nF · LO QUE NO SE PUEDE MAPEAR NO SE ROTULA');
// ---------------------------------------------------------------------------
{
  // Una figura sin catálogo no tiene letras que poner.
  ok(TE._tramosEnTrazo('ZZZZ', 'cabezal', [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], 1.6) === null,
    'figura fuera del catálogo → sin mapeo');
  ok(TE._ladosMarcoEnTrazo('101A', 'cabezal', [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], 1.6, { A: 1 }) === null,
    'una recta no entra por el reconocedor de marco cerrado');
  ok(TE._ladosRotulables(null, 'cabezal') === null, 'sin placement no hay rótulos');
}


// ---------------------------------------------------------------------------
console.log('\nG · LO QUE SE EMITE AL SVG (camino de dibujo real)');
// ---------------------------------------------------------------------------
{
  // SVG de mentira que GRABA lo que le cuelgan (el stub del mini-DOM tira los
  // atributos a la basura). Se le pasa a _dibujarCotasLados el mismo proyector y un
  // transform lineal como el que arma _dibujarVista2D.
  function SvgRec() { this.hijos = []; }
  SvgRec.prototype.appendChild = function (c) { this.hijos.push(c); return c; };
  function Nodo(tag) { this.tag = tag; this.attrs = {}; this.hijos = []; this.textContent = ''; }
  Nodo.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
  Nodo.prototype.appendChild = function (c) { this.hijos.push(c); return c; };
  Object.defineProperty(Nodo.prototype, 'firstChild', {
    get() { return this.hijos.length ? this.hijos[0] : null; }, configurable: true
  });
  const antes = win.document.createElementNS;
  win.document.createElementNS = (ns, tag) => new Nodo(tag);

  const ST = TE._ST;
  const b = barra('104D', 'ES');
  b.pl.meta = { ci: 0 };
  const recetaAntes = ST.receta, selAntes = ST.selCi;
  const cmp = comp('104D', 'ES');
  cmp._rol = b.rol;
  ST.receta = { componentes: [cmp] };
  ST.selCi = 0;
  const out = { placements: [b.pl] };
  const esc = 4;                              // 4 px por cm (un zoom cualquiera)
  const X = (u) => 300 + u * esc, Y = (v) => 150 - v * esc;

  function pinta(plano) {
    const svg = new SvgRec();
    TE._dibujarCotasLados(svg, plano, proyDe(plano), X, Y, out);
    const textos = [];
    svg.hijos.forEach(g => (g.hijos || []).forEach(t => textos.push(t)));
    return textos;
  }

  const tSec = pinta('seccion');
  ok(tSec.length === 4, 'SECCIÓN: se emiten 4 rótulos, uno por lado [' + tSec.length + ']');
  ok(tSec.map(t => t.textContent).sort().join(' ') === 'A=24 B=52 C=24 D=52',
    'SECCIÓN: los textos son A=24 B=52 C=24 D=52 [' + tSec.map(t => t.textContent).sort().join(' ') + ']');
  // A LO LARGO se pierden los dos lados del ancho (corren por la profundidad Z) y
  // los dos que quedan CAEN UNO SOBRE OTRO en pantalla: el estribo vive en un solo
  // plano X. Dos rótulos calcados es un borrón, así que salen agrupados en uno.
  const tLar = pinta('largo');
  ok(tLar.length === 1, 'A LO LARGO: UN solo rótulo (los dos lados visibles se pisan) [' + tLar.length + ']');
  ok(tLar[0] && tLar[0].textContent === 'B·D=52',
    'A LO LARGO: el rótulo agrupado dice B·D=52 [' + (tLar[0] ? tLar[0].textContent : '-') + ']');
  // …y el mismo estribo en SECCIÓN NO agrupa nada: ahí los 4 lados están separados.
  ok(tSec.every(t => t.textContent.indexOf('·') < 0),
    'SECCIÓN: ningún rótulo agrupado (los 4 lados están en sitios distintos)');

  // NINGÚN rótulo sale de cabeza y ningún número sale NaN: un transform con NaN no
  // se ve como error, la etiqueta simplemente no aparece y nadie se entera.
  let angOk = true, numOk = true;
  tSec.forEach(t => {
    const m = /translate\(([-\d.]+),([-\d.]+)\) rotate\(([-\d.]+)\)/.exec(t.attrs.transform || '');
    if (!m) { numOk = false; return; }
    const a = Number(m[3]);
    if (!(a >= -90 && a <= 90)) angOk = false;
    if (!isFinite(Number(m[1])) || !isFinite(Number(m[2])) || !isFinite(a) || !isFinite(Number(t.attrs.y))) numOk = false;
  });
  ok(angOk, 'todos los rótulos giran dentro de [−90°, 90°] (nunca de cabeza)');
  ok(numOk, 'todos los transform/offset son números finitos');

  // El rótulo se corre hacia AFUERA del marco: en un estribo los 4 offsets tienen
  // que apartarse del centro, no escribir hacia adentro unos y hacia afuera otros.
  const cy = Y(0);
  const arriba = tSec.filter(t => Number(/translate\([-\d.]+,([-\d.]+)\)/.exec(t.attrs.transform)[1]) < cy);
  ok(arriba.length === 1 && Number(arriba[0].attrs.y) < 0,
    'el rótulo del lado superior se escribe hacia arriba (fuera del marco)');

  // Sin selección la función no emite nada aunque la llamen.
  ST.selCi = -1;
  ok(pinta('seccion').length === 0, 'sin selección no se emite ningún rótulo');

  ST.selCi = selAntes; ST.receta = recetaAntes;
  win.document.createElementNS = antes;
}


// ---------------------------------------------------------------------------
console.log('\nH · MURO — la regla sigue a la TABLA DE PLANOS, no a la viga');
// ---------------------------------------------------------------------------
{
  // En un muro los tres cuadrantes son OTROS planos (seccion u=x/v=z, largo u=x/v=y,
  // planta u=z/v=y). Nada de esto está cableado en el código de las cotas: el plano
  // llega como proyector. Si alguien cableara "la sección es y-z", este bloque cae.
  const MURO = { tipo: 'muro', largo: 500, alto: 300, ancho: 20, recub_sup: 3, recub_inf: 3, recub_lat: 2.5 };
  const PL_MURO = {
    seccion: { u: 'x', v: 'z' },
    largo:   { u: 'x', v: 'y' },
    planta:  { u: 'z', v: 'y' }
  };
  const proyMuro = (p) => (pt) => ({ u: pt[PL_MURO[p].u], v: pt[PL_MURO[p].v] });
  function enMuro(fig, tip) {
    const c = comp(fig, tip); c.cara = 'lat'; c.diam = 10;
    const pls = win.ModeladorReglas.expandirComponente(c, MURO);
    if (!pls || !pls.length) return null;
    const pl = pls[0];
    const ls = TE._ladosRotulables(pl, c._rol);
    if (!ls) return null;
    const r = {};
    ['seccion', 'largo', 'planta'].forEach(p => {
      r[p] = ls.filter(l => TE._ladoVisibleEnPlano(pl.puntos, l, proyMuro(p)) > 0)
               .map(l => l.lado + '=' + Math.round(l.valor)).sort().join(' ');
    });
    return r;
  }
  const mh = enMuro('101A', 'MH');
  ok(mh && mh.seccion === 'A=494' && mh.largo === 'A=494' && mh.planta === '',
    'muro MH 101A: se rotula en SECCIÓN y ELEVACIÓN largo, y NO en la otra elevación ' +
    '(ahí la barra corre por la profundidad X) [' + (mh ? JSON.stringify(mh) : 'null') + ']');
  const ec = enMuro('104D', 'EC');
  ok(ec && ec.seccion === 'A=15 C=15', 'muro EC 104D, SECCIÓN: sólo los lados del espesor (A=15 C=15) [' + (ec ? ec.seccion : 'null') + ']');
  ok(ec && ec.largo === 'B=294 D=294', 'muro EC 104D, ELEVACIÓN largo: sólo los lados de la altura (B=294 D=294) [' + (ec ? ec.largo : 'null') + ']');
  ok(ec && ec.planta === 'A=15 B=294 C=15 D=294', 'muro EC 104D, la otra elevación: los 4 lados [' + (ec ? ec.planta : 'null') + ']');
}


// ---------------------------------------------------------------------------
console.log('\nI · EL CUCHILLO MANDA — se rotula la barra QUE ESTA VISTA MUESTRA');
// ---------------------------------------------------------------------------
{
  // Un componente repartido son N barras iguales. En SECCIÓN la banda de corte es
  // FINA (una barra de espesor): si se rotulara "la primera de la lista", con el
  // corte a media viga los rótulos quedarían sobre una sección VACÍA. Se elige la
  // más cercana al corte, con los mismos o.cortePos/o.corteGrosor del render.
  function SvgRec() { this.hijos = []; }
  SvgRec.prototype.appendChild = function (c) { this.hijos.push(c); return c; };
  function Nodo(tag) { this.tag = tag; this.attrs = {}; this.hijos = []; this.textContent = ''; }
  Nodo.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
  Nodo.prototype.appendChild = function (c) { this.hijos.push(c); return c; };
  Object.defineProperty(Nodo.prototype, 'firstChild', {
    get() { return this.hijos.length ? this.hijos[0] : null; }, configurable: true
  });
  const antes = win.document.createElementNS;
  win.document.createElementNS = (ns, tag) => new Nodo(tag);

  const ST = TE._ST;
  const recetaAntes = ST.receta, selAntes = ST.selCi, ortoAntes = ST.orto;
  const cmp = comp('104D', 'ES');
  const b = barra('104D', 'ES');
  cmp._rol = b.rol;
  cmp.dims.B = { modo: 'fija', valor: 52 };
  ST.receta = { componentes: [cmp] };
  ST.selCi = 0;

  // TRES estribos a x = −200 / 0 / +200 (clonando el trazo y moviéndolo en x). El de
  // x=0 lleva un Δ falso en la dim B para poder DISTINGUIR cuál se rotuló.
  function clon(dx, dimB) {
    const p = JSON.parse(JSON.stringify(b.pl));
    p.puntos.forEach(q => { q.x += dx; });
    p.meta = { ci: 0 };
    p.dims = Object.assign({}, b.pl.dims, { B: dimB, D: dimB });
    return p;
  }
  const out = { placements: [clon(-200 - b.pl.puntos[0].x, 11), clon(0 - b.pl.puntos[0].x, 22), clon(200 - b.pl.puntos[0].x, 33)] };
  const esc = 8, X = (u) => 300 + u * esc, Y = (v) => 150 - v * esc;
  function textosEn(cortePos, corteGrosor) {
    ST.orto = { seccion: { cortePos: cortePos, corteGrosor: corteGrosor } };
    const svg = new SvgRec();
    TE._dibujarCotasLados(svg, 'seccion', proyDe('seccion'), X, Y, out);
    const t = [];
    svg.hijos.forEach(g => g.hijos.forEach(x => t.push(x.textContent)));
    return t.sort().join(' ');
  }
  // el corte sobre cada uno de los tres → sale el suyo (B/D valen 11, 22 y 33)
  ok(textosEn(-200, 1.2).indexOf('B=11') >= 0, 'corte en x=−200 → rotula el estribo de ahí (B=11) [' + textosEn(-200, 1.2) + ']');
  ok(textosEn(0, 1.2).indexOf('B=22') >= 0, 'corte en x=0 → rotula el del medio (B=22) [' + textosEn(0, 1.2) + ']');
  ok(textosEn(200, 1.2).indexOf('B=33') >= 0, 'corte en x=+200 → rotula el de la derecha (B=33) [' + textosEn(200, 1.2) + ']');
  // corte ENTRE dos estribos y fuera de la banda → NADA (esa vista no muestra ninguno)
  ok(textosEn(100, 1.2) === '', 'corte entre dos estribos, fuera de la banda → ningún rótulo');
  // banda GRUESA (elevaciones): con el corte lejos igual entra la más cercana
  ok(textosEn(100, 9999) !== '', 'banda gruesa (elevación) → sí rotula la más cercana');

  ST.orto = ortoAntes; ST.selCi = selAntes; ST.receta = recetaAntes;
  win.document.createElementNS = antes;
}


// ---------------------------------------------------------------------------
console.log('\nJ · EL CUCHILLO, LADO POR LADO (no sólo barra por barra)');
// ---------------------------------------------------------------------------
{
  // El CUERPO de un longitudinal cruza la sección entera (por eso se ve como
  // círculo) pero sus PATAS viven en las puntas de la viga. Con el corte a media
  // luz esas patas NO están en pantalla: rotularlas sería poner una medida sobre
  // nada. Con el corte sobre la punta, sí.
  function SvgRec() { this.hijos = []; }
  SvgRec.prototype.appendChild = function (c) { this.hijos.push(c); return c; };
  function Nodo(tag) { this.tag = tag; this.attrs = {}; this.hijos = []; this.textContent = ''; }
  Nodo.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
  Nodo.prototype.appendChild = function (c) { this.hijos.push(c); return c; };
  Object.defineProperty(Nodo.prototype, 'firstChild', {
    get() { return this.hijos.length ? this.hijos[0] : null; }, configurable: true
  });
  const antes = win.document.createElementNS;
  win.document.createElementNS = (ns, tag) => new Nodo(tag);

  const ST = TE._ST;
  const recetaAntes = ST.receta, selAntes = ST.selCi, ortoAntes = ST.orto;
  const b = barra('103B', 'CBS', { diam: 16 });
  b.pl.meta = { ci: 0 };
  const cmp = comp('103B', 'CBS'); cmp.diam = 16; cmp._rol = b.rol;
  ST.receta = { componentes: [cmp] };
  ST.selCi = 0;
  const out = { placements: [b.pl] };
  const esc = 8, X = (u) => 300 + u * esc, Y = (v) => 150 - v * esc;
  function textos(cortePos, corteGrosor) {
    ST.orto = { seccion: { cortePos: cortePos, corteGrosor: corteGrosor } };
    const svg = new SvgRec(); TE._dibujarCotasLados(svg, 'seccion', proyDe('seccion'), X, Y, out);
    const t = []; svg.hijos.forEach(g => g.hijos.forEach(x => t.push(x.textContent)));
    return t.sort().join(' ');
  }
  // Las patas de esta 103B (φ16, dims auto → 9.6 cm) van de x = −294.03 a −287.24 y su
  // espejo; el cuerpo B cruza la viga entera. MEDIDO con el motor.
  ok(textos(0, 4) === '', 'corte a media luz: la sección NO rotula las patas (no están ahí)');
  ok(textos(-290, 4).indexOf('=10') >= 0,
    'corte sobre la punta: ahí sí sale la pata [' + textos(-290, 4) + ']');
  // sin cuchillo declarado (o.corteGrosor ausente) se rotula todo lo visible
  ST.orto = null;
  const svg = new SvgRec(); TE._dibujarCotasLados(svg, 'seccion', proyDe('seccion'), X, Y, out);
  const t = []; svg.hijos.forEach(g => g.hijos.forEach(x => t.push(x.textContent)));
  ok(t.join(' ') === 'A·C=10', 'sin cuchillo (ST.orto ausente) se rotula lo visible [' + t.join(' ') + ']');

  ST.orto = ortoAntes; ST.selCi = selAntes; ST.receta = recetaAntes;
  win.document.createElementNS = antes;
}


// ---------------------------------------------------------------------------
console.log('\nK · BARRIDO DEL CATÁLOGO ENTERO — ninguna letra en el lado equivocado');
// ---------------------------------------------------------------------------
{
  // La prueba de que el mapeo no está cruzado no puede ser una lista escrita a mano
  // de 5 figuras: se BARRE el catálogo completo × tipologías × φ × poses × elemento y
  // se compara, lado por lado, el largo del trecho DIBUJADO contra la dim que se le
  // rotula. La diferencia no es libre, tiene un tope FÍSICO:
  //
  //   · la convención BVBS mide a VÉRTICE, así que cada codo se come su setback
  //     Rc = 2.5·φ — hasta dos por lado (un tramo con codo en las dos puntas);
  //   · en el marco cerrado, además, la dim vale EJE + φ (24 contra 23.2 de eje).
  //
  // Tope = 2·Rc + φ = 6·φ. Un rótulo puesto en el lado equivocado se pasa por
  // DECENAS de cm (el ancho contra el alto de un estribo son 24 contra 52), así que
  // este tope separa limpio. MEDIDO: el peor desvío de todo el barrido es 12.50 cm,
  // en una 103B φ25 — exactamente 5·φ, los dos codos de sus ganchos.
  const CATF = Object.keys(CAT.FIGURAS || {}).sort();
  const TIPS = ['CBS', 'CBI', 'ES', 'TRV', 'MH', 'MV', 'TR', 'EC'];
  const DIAMS = [8, 16, 25];
  const POSES = [null, { cara: 'sup', lado: 1, rumbo: 'z', espejo: false }];
  const MURO = { tipo: 'muro', largo: 500, alto: 300, ancho: 20, recub_sup: 3, recub_inf: 3, recub_lat: 2.5 };
  let combos = 0, conRotulo = 0, peor = 0, peorEn = '', cruzados = [], duplicados = [];
  for (const H of [HOST, MURO]) {
    for (const fig of CATF) for (const tip of TIPS) for (const dm of DIAMS) for (const pose of POSES) {
      const c = comp(fig, tip); c.diam = dm; c.cara = 'lat';
      if (pose) c.pose = pose;
      let pls; try { pls = R.expandirComponente(c, H); } catch (e) { continue; }
      if (!pls || !pls.length) continue;
      const pl = pls[0];
      if (!pl.puntos || pl.puntos.length < 2) continue;
      combos++;
      let ls; try { ls = TE._ladosRotulables(pl, c._rol); }
      catch (e) { cruzados.push(fig + '/' + tip + ' EXCEPCIÓN ' + e.message); continue; }
      if (!ls) continue;                       // no se pudo mapear: no rotula (es lo correcto)
      conRotulo++;
      const tope = 6 * pl.diam;
      for (const l of ls) {
        const a = pl.puntos[l.i0], b = pl.puntos[l.i1];
        const d = Math.abs(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - l.valor);
        if (d > peor) { peor = d; peorEn = fig + '/' + tip + ' φ' + dm + ' lado ' + l.lado; }
        if (d > tope) cruzados.push(fig + '/' + tip + ' φ' + dm + ' lado ' + l.lado + ': desvío ' + d.toFixed(2));
      }
      for (let x = 0; x < ls.length; x++) for (let y = x + 1; y < ls.length; y++) {
        if (ls[x].i0 === ls[y].i0 && ls[x].i1 === ls[y].i1) {
          duplicados.push(fig + '/' + tip + ' ' + ls[x].lado + '≡' + ls[y].lado);
        }
      }
    }
  }
  ok(combos > 3000, 'el barrido generó ' + combos + ' barras reales (catálogo × tipología × φ × pose × elemento)');
  ok(conRotulo / combos > 0.85, 'rotula el ' + (100 * conRotulo / combos).toFixed(1) + '% de ellas');
  ok(cruzados.length === 0, 'NINGUNA letra cae en un lado fuera del tope físico 6·φ' +
    (cruzados.length ? (' — ' + cruzados.slice(0, 5).join(' · ')) : '') +
    ' (peor desvío del barrido: ' + peor.toFixed(2) + ' cm en ' + peorEn + ')');
  ok(duplicados.length === 0, 'ningún par de letras comparte el mismo trecho del trazo' +
    (duplicados.length ? (' — ' + duplicados.slice(0, 5).join(' · ')) : ''));
}

console.log(fallos ? ('\n' + fallos + ' FALLO(S)') : '\nTODO OK');
process.exit(fallos ? 1 : 0);
