// =============================================================================
// LADO DOMINANTE — test headless (Node)
// =============================================================================
// El lado dominante es el que corre A LO LARGO de la pieza: el que el 'auto'
// estira contra el hormigón y el que recibe el empalme. El usuario pidió dos
// cosas: VERLO en el preview (tramo destacado) y CONTROLARLO desde la ficha.
//
// QUÉ PROTEGE, en orden:
//   A. CASCADA — ladoDominanteFigura devuelve lo esperado para las figuras del
//      guion (101A/102A/103B/104B/106A) y no depende de las dims del momento.
//   B. MAPEO TRAMO ↔ TRAZO (_tramoDominanteEnTrazo) — el rango de puntos que el
//      preview destaca es REALMENTE el lado dominante, medido contra las dims
//      resueltas de la barra que dibujó el motor. Incluye los dos casos que
//      rompen la cuenta ingenua "el tramo i son los puntos i,i+1":
//        · un gancho >90° se dibuja como arco muestreado (15 puntos por vértice);
//        · dos ganchos seguidos dejan sus arcos PEGADOS en la lista y entre medio
//          está justo el cuerpo (103E: puntos 1..15 y 16..30, cuerpo 15→16).
//   C. NO DESTACAR ANTES QUE DESTACAR MAL — las familias con constructor propio
//      (marco de estribo, rombo, traba) devuelven null: ahí el trazo no es la
//      cadena de tramos de la figura (un 103E con rol estribo dibuja 4 lados
//      teniendo 3 parciales) y no hay mapeo que derivar.
//   D. EVIDENCIA de que el MOTOR todavía NO lee comp.lado_dominante: un
//      componente con lado_dominante:'C' resuelve el mismo lado y dibuja los
//      MISMOS puntos que sin el campo. Es lo que la ficha dice en ámbar; si algún
//      día se cablea el motor, este bloque falla y hay que actualizar el texto.
//
// Correr con: node tests/test_lado_dominante.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

// --------------------------------------------------------------- entorno mínimo
// template_editor.js sólo necesita `global` para publicarse y para leer los otros
// módulos: acá se prueban funciones PURAS (mapeo de índices, lectura del campo),
// así que el DOM es un stub que nadie toca.
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

function dimsAuto(fig) {
  const sp = CAT.get(fig) || {};
  const d = {};
  (sp.parciales || []).forEach(p => { d[p] = { modo: 'auto' }; });
  return d;
}
function comp(fig, tip, extra) {
  const c = {
    comp_id: 'X', jerarquia: 2, tipologia: tip, figura: fig, diam: 16, suf_tipo: '',
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
function primerPlacement(c) {
  const pls = R.expandirComponente(c, HOST);
  return (pls && pls.length) ? { pl: pls[0], rol: c._rol } : null;
}
function largo(p, q) {
  return Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2);
}
// Largo del trecho [i0,i1] de la polilínea (la suma de sus segmentos).
function largoTramo(pts, i0, i1) {
  let L = 0;
  for (let i = i0; i < i1; i++) L += largo(pts[i], pts[i + 1]);
  return L;
}

// ============================================================ A · CASCADA
console.log('A — cascada determinista (spec.lado_dominante → B → primer parcial)');
{
  [['101A', 'A'], ['102A', 'B'], ['102B', 'B'], ['103A', 'B'], ['103B', 'B'],
   ['104B', 'B'], ['104D', 'B'], ['106A', 'B']].forEach(([fig, esp]) => {
    ok(FP.ladoDominanteFigura(fig) === esp,
      fig + ' → ' + esp + ' (dio ' + FP.ladoDominanteFigura(fig) + ')');
  });
  // Es propiedad de la FIGURA, no de sus medidas: con la pata A gigante sigue
  // siendo B (antes ganaba "el más largo medido" y editar una pata movía en
  // silencio la dim que se estira y la que se empalma).
  ok(R.ladoDominante({ figura: '103A', dims: { A: 500, B: 20, C: 10 } }) === 'B',
    '103A con A=500 y B=20 sigue dando B (no gana el más largo medido)');
}

// ============================================ B · MAPEO TRAMO ↔ TRAZO (preview)
console.log('\nB — el tramo que el preview destaca ES el lado dominante');
{
  // [figura, tipología, tolerancia en cm]. La tolerancia cubre el RETRANQUEO del
  // gancho con radio: el cuerpo entra tangente al arco, o sea pierde R = 2.5·φ por
  // cada extremo que remate en gancho >90° (φ16 → 4 cm por gancho).
  [['101A', 'CBS', 0.1], ['102A', 'CBS', 0.1], ['103A', 'CBS', 0.1],
   ['103B', 'CBS', 0.1], ['104B', 'CBS', 0.1],
   ['102B', 'CBS', 4.5], ['103E', 'CBS', 8.5]].forEach(([fig, tip, tol]) => {
    const c = comp(fig, tip);
    const r = primerPlacement(c);
    if (!r) { ok(false, fig + ' ' + tip + ': el motor no devolvió placements'); return; }
    const dom = FP.ladoDominanteFigura(fig);
    const rng = TE._tramoDominanteEnTrazo(fig, r.rol, r.pl.puntos, r.pl.diam, dom);
    if (!rng) { ok(false, fig + ' ' + tip + ': no se derivó el tramo dominante'); return; }
    const medido = largoTramo(r.pl.puntos, rng.i0, rng.i1);
    const esperado = Number(r.pl.dims[dom]);
    ok(Math.abs(medido - esperado) <= tol,
      fig + ' ' + tip + ': destaca el lado ' + dom + ' (' + medido.toFixed(1) +
      ' cm vs dim ' + esperado.toFixed(1) + ', tol ' + tol + ')');
    // …y es el trecho MÁS LARGO del trazo en estas figuras (el cuerpo), o sea no
    // se está destacando una pata por casualidad de índices.
    let peor = 0;
    for (let i = 0; i + 1 < r.pl.puntos.length; i++) {
      if (i >= rng.i0 && i < rng.i1) continue;
      peor = Math.max(peor, largo(r.pl.puntos[i], r.pl.puntos[i + 1]));
    }
    ok(medido > peor, fig + ' ' + tip + ': el tramo destacado es el cuerpo, no una pata');
  });

  // 101A es una RECTA: su único lado es el dominante y el resaltado es la barra
  // entera (0 → último punto).
  {
    const r = primerPlacement(comp('101A', 'CBS'));
    const rng = TE._tramoDominanteEnTrazo('101A', r.rol, r.pl.puntos, r.pl.diam, 'A');
    ok(rng && rng.i0 === 0 && rng.i1 === r.pl.puntos.length - 1,
      '101A (recta): el lado dominante es la barra entera');
  }

  // 103E con rol CABEZAL: DOS ganchos de 135°, o sea dos grupos de arco PEGADOS en
  // la lista con el cuerpo justo entre ellos. Es el caso que rompe "un run de
  // esArco = un vértice".
  {
    const r = primerPlacement(comp('103E', 'CBS'));
    const rng = TE._tramoDominanteEnTrazo('103E', r.rol, r.pl.puntos, r.pl.diam, 'B');
    ok(rng && r.pl.puntos[rng.i0].esArco && r.pl.puntos[rng.i1].esArco,
      '103E: el cuerpo va DE un punto de arco A otro (los dos grupos están pegados)');
    ok(rng && (rng.i1 - rng.i0) === 1, '103E: el cuerpo es un solo segmento recto');
  }
}

// ================================== C · familias sin mapeo → no se destaca nada
console.log('\nC — sin mapeo fiable no se destaca nada (mejor eso que el lado equivocado)');
{
  [['104D', 'ES', 'marco de estribo: dibuja 4 lados'],
   ['103E', 'ES', 'marco de estribo con 3 parciales: el trazo no es su cadena'],
   ['106A', 'ES', 'rombo: constructor propio'],
   ['101A', 'TRV', 'traba: forma fija con gancho que no está en los parciales']
  ].forEach(([fig, tip, porque]) => {
    const c = comp(fig, tip);
    c.diam = 8;
    const r = primerPlacement(c);
    if (!r) { ok(false, fig + ' ' + tip + ': el motor no devolvió placements'); return; }
    const rng = TE._tramoDominanteEnTrazo(fig, r.rol, r.pl.puntos, r.pl.diam,
      FP.ladoDominanteFigura(fig));
    ok(rng === null, fig + ' ' + tip + ' → null (' + porque + ')');
  });
  // Sin φ no hay cota para separar arco de tramo real: tampoco se adivina.
  {
    const r = primerPlacement(comp('102B', 'CBS'));
    ok(TE._tramoDominanteEnTrazo('102B', r.rol, r.pl.puntos, 0, 'B') === null,
      'φ = 0 → null (sin diámetro no hay cota de cuerda de arco)');
    ok(TE._tramoDominanteEnTrazo('102B', r.rol, r.pl.puntos, r.pl.diam, 'Z') === null,
      'lado inexistente → null');
  }
}

// ============================ D · el motor todavía NO lee comp.lado_dominante
console.log('\nD — evidencia: comp.lado_dominante NO lo lee el motor (todavía)');
{
  const base = comp('103A', 'CBS');
  const conElec = comp('103A', 'CBS', { lado_dominante: 'C' });
  ok(R.ladoDominante(base) === 'B', 'sin elección el motor resuelve B');
  ok(R.ladoDominante(conElec) === 'B',
    'con lado_dominante:"C" el motor SIGUE resolviendo B (no lee el campo)');
  const a = primerPlacement(base), b = primerPlacement(conElec);
  ok(JSON.stringify(a.pl.dims) === JSON.stringify(b.pl.dims),
    'las dims resueltas no cambian (el auto estira el mismo lado)');
  ok(JSON.stringify(a.pl.puntos) === JSON.stringify(b.pl.puntos),
    'los puntos dibujados son idénticos (la elección no mueve el dibujo)');
  // La ficha por eso lo dice en ámbar; acá se fija que el helper de la UI lee y
  // escribe el campo, y que 'auto' lo borra.
  const c = comp('103A', 'CBS');
  ok(TE._ladoDomElegido(c) === null, 'sin campo → sin elección');
  TE._setLadoDominante(c, 'c');
  ok(c.lado_dominante === 'C' && TE._ladoDomElegido(c) === 'C', 'escribe en mayúscula');
  TE._setLadoDominante(c, 'Z');
  ok(c.lado_dominante === 'C', 'un lado que la figura no tiene NO se escribe');
  TE._setLadoDominante(c, null);
  ok(!('lado_dominante' in c), 'auto borra el campo (no lo deja en null)');
}

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exitCode = fallos ? 1 : 0;
