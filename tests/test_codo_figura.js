// =============================================================================
// CODO DE DOBLADO DE LA FIGURA — test headless (Node)
// -----------------------------------------------------------------------------
// El motor SVG único del catálogo (disenador.js · svgDesdePuntos → _pathDesdePuntos)
// dibujaba la barra como POLILÍNEA con vértices en punta. Con el trazo fino no se
// notaba; al subirlo a 5–14 px (ver test_grosor_figura.js) cada esquina quedó como un
// pico de flecha y el usuario lo dijo derecho: «no parecen barras reales… debiera tener
// las curvas como corresponde». La referencia que nombró es la vista de sección del
// Template Editor, que dibuja el sólido 3D con TOROS TANGENTES en cada doblez
// (modelador/motor_geom.js · analizarBarra). Este test congela que el 2D hace la misma
// construcción, y los bordes donde es fácil romperla sin que se note en pantalla:
//
//   A. HAY CODO, NO PUNTA. Cada vértice interior entre dos tramos rectos sale como un
//      arco 'A' del path. El nº de arcos = el nº de dobleces (ni uno de más, ni de menos).
//
//   B. EL CODO ES TANGENTE. Es LA propiedad: si las dos tangencias no están a la misma
//      distancia del vértice, o el radio no es t/tan(giro/2), el trazo entra a la curva
//      con un quiebre — o sea, se cambió una punta por dos puntas más chicas. Se
//      reconstruye el vértice desde el propio path (cruce de las dos rectas) y se
//      verifica |V−T1| = |V−T2| = R·tan(giro/2).
//
//   C. EL DOBLEZ NO CAMBIA DE ÁNGULO. Una 102B es 135° antes y después del codo: el
//      redondeo es cómo se dibuja el doblez, no cuánto dobla.
//
//   D. EL RADIO. R = 2.5 × el trazo (2φ interno + φ/2, la norma de motor_geom para
//      φ ≤ 16 mm) y 4 × el trazo sobre φ16, y SOLO cuando el llamador declaró `metrico`
//      — la misma puerta que usa el grosor. Sin φ (catálogo, galería, previews) el codo
//      igual existe, con el trazo nominal. Es lo que hace que el codo salga EXACTO al de
//      norma cuando el motor dibuja el φ real, sin cablear centímetros en ningún lado.
//
//   E. EL CAPEO EN LADOS CORTOS. La tangencia no puede pasar del 20% del lado más corto
//      que llega al vértice. Dos cosas a la vez: dos codos del mismo lado no se pisan
//      (40% entre los dos) y la figura sigue siendo esa figura en la miniatura de 90×72,
//      donde el trazo NO se achica (piso de 5 px en cualquier tamaño) y un codo de norma
//      se comería el 29% de cada lado. Cuando no cabe se BAJA EL RADIO manteniendo la
//      tangencia: el fierro nunca pierde un tramo.
//
//   F. LOS ÁNGULOS AGUDOS NO DEGENERAN. En un vértice de 45° la tangencia vale 2.41·R
//      (contra 1.00·R en uno de 90°): es donde el codo se sale de madre. Y en la vuelta
//      en U (vértice ≈ 0°) tiende a infinito → ahí NO se dibuja codo, se deja la punta.
//
//   G. LOS ARCOS DECLARADOS NO SE TOCAN. Donde la figura ya trae un tramo en 'arco' la
//      curva ES el doblez; meterle un codo encima sería doblar dos veces. Mismo criterio
//      que `sinFilletEnArcos` del motor 3D.
//
//   H. LA FIGURA CERRADA CIERRA REDONDA. En un estribo el punto final vuelve al inicial:
//      ese "extremo" es un vértice más. Sin tratarlo, el marco salía con 3 codos y la
//      cuarta esquina en punta — justo la más visible, porque es donde arranca el path.
//
//   I. BARRIDO DE LAS 63 FIGURAS DEL CATÁLOGO × los 10 encuadres vivos: ni un NaN, ni una
//      que se salga del viewBox, ni un tramo comido por el codo.
//
// Correr con: node tests/test_codo_figura.js
// =============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const DIR = path.join(RAIZ, 'armahub', 'static', 'js', 'features');
const SRC_MOTOR = path.join(DIR, 'catalogo', 'disenador.js');

let fallos = 0;
function ok(c, m) { if (!c) { console.log('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function casi(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.02 : tol); }

// ── Motor en un sandbox de navegador mínimo (es un script global, no un módulo) ──
const noop = () => {};
const fakeEl = { style: {}, textContent: '', value: '', innerHTML: '', appendChild: noop,
                 addEventListener: noop, setAttribute: noop, getAttribute: () => null,
                 classList: { add: noop, remove: noop } };
const documentStub = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
                       createElement: () => Object.assign({}, fakeEl), body: Object.assign({}, fakeEl),
                       addEventListener: noop };
const sandbox = { console, window: {}, document: documentStub, setTimeout: (fn) => fn && fn(),
                  fetch: () => Promise.resolve({ ok: false, json: () => ({}) }), alert: noop, confirm: () => false };
sandbox.window.document = documentStub;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(DIR, 'catalogo', 'etiquetas.js'), 'utf8'), sandbox, { filename: 'etiquetas.js' });
vm.runInContext(fs.readFileSync(SRC_MOTOR, 'utf8'), sandbox, { filename: 'disenador.js' });
const MOTOR = sandbox.window.disenadorMotor;

// ── Constantes de calibración (las mismas del fuente; el bloque J las verifica) ──
const K_CHICO = 2.5, K_GRANDE = 4, TMAX = 0.20, NOMINAL = 5.5;
const PISO = (mm) => 5.0 + (mm - 8) * 0.143;
const LADOS = 'ABCDEFGHI'.split('');
const PREV = { width: 210, height: 140, pad: 18 };   // preview del Diseñador / del 3D
const MINI = { width: 90, height: 72, pad: 12 };     // miniatura del catálogo / galería

// Figura desde direcciones (unidades de grilla, como las del catálogo).
function figura(dirs, tipos) {
  var pts = [{ x: 0, y: 0 }], tramos = [];
  dirs.forEach(function (d, i) {
    var u = pts[pts.length - 1];
    pts.push({ x: u.x + d[0], y: u.y + d[1] });
    tramos.push({ lado: LADOS[i], giro: 0, sentido: null, tipo: (tipos && tipos[i]) || 'recto' });
  });
  return { dim: '2D', puntos: pts, tramos: tramos };
}

// ── Lectura del path que sale del motor ──────────────────────────────────────
const RE_PATH = /<path d="([^"]*)" fill="none" stroke="#00695c" stroke-width="([\d.]+)"/;
function render(geo, opts) { return RE_PATH.exec(MOTOR.dibujarFigura(geo, null, opts || PREV)); }
function pathDe(geo, opts) { var m = render(geo, opts); return m ? m[1] : null; }
function swDe(geo, opts) { var m = render(geo, opts); return m ? Number(m[2]) : null; }

// Parser de los comandos que emite el motor (M/L/A) → lista de nodos con el punto
// alcanzado y, si vino por arco, su radio y su sentido.
function nodos(d) {
  var t = d.replace(/,/g, ' ').trim().split(/\s+/), i = 0, out = [];
  while (i < t.length) {
    var c = t[i++];
    if (c === 'M' || c === 'L') out.push({ cmd: c, x: +t[i++], y: +t[i++] });
    else if (c === 'A') { var r = +t[i++]; i += 3; var sw = +t[i++]; out.push({ cmd: 'A', r: r, sweep: sw, x: +t[i++], y: +t[i++] }); }
    else throw new Error('comando inesperado en el path: ' + c);
  }
  return out;
}
function nArcos(d) { return nodos(d).filter(function (n) { return n.cmd === 'A'; }).length; }
function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
function dirDe(a, b) { var L = dist(a, b) || 1; return { x: (b.x - a.x) / L, y: (b.y - a.y) / L }; }
// Cruce de la recta (p1, dir d1) con la recta (p2, dir d2). null si son paralelas.
function cruce(p1, d1, p2, d2) {
  var det = d1.x * (-d2.y) - d1.y * (-d2.x);
  if (Math.abs(det) < 1e-9) return null;
  var s = ((p2.x - p1.x) * (-d2.y) - (p2.y - p1.y) * (-d2.x)) / det;
  return { x: p1.x + d1.x * s, y: p1.y + d1.y * s };
}
// Para cada arco del path: reconstruye el VÉRTICE que redondea (cruce de las dos rectas
// tangentes) y devuelve { V, T1, T2, R, giro, t }. Todo sale del path, nada se asume.
function codos(d) {
  var n = nodos(d), out = [];
  for (var i = 0; i < n.length; i++) {
    if (n[i].cmd !== 'A' || i === 0 || i + 1 >= n.length) continue;
    var T1 = n[i - 1], T2 = n[i];
    var ant = (i - 2 >= 0) ? n[i - 2] : null, sig = n[i + 1];
    if (!ant || sig.cmd === 'A') continue;               // arco encadenado: no aplica
    var d1 = dirDe(ant, T1), d2 = dirDe(T2, sig);
    var V = cruce(T1, d1, T2, d2);
    var cosA = d1.x * d2.x + d1.y * d2.y;
    if (cosA > 1) cosA = 1; else if (cosA < -1) cosA = -1;
    out.push({ V: V, T1: T1, T2: T2, R: T2.r, sweep: T2.sweep,
               giro: Math.acos(cosA) * 180 / Math.PI,
               t1: V ? dist(V, T1) : NaN, t2: V ? dist(V, T2) : NaN });
  }
  return out;
}

// ── A · hay codo, no punta ───────────────────────────────────────────────────
console.log('A · cada doblez sale como arco, y son exactamente los dobleces que hay:');
const L90   = figura([[100, 0], [0, 100]]);                         // 1 doblez de 90°
const U     = figura([[100, 0], [0, 100], [-100, 0]]);              // 2 dobleces de 90°
const MARCO = figura([[100, 0], [0, 100], [-100, 0], [0, -100]]);   // cerrado: 4 dobleces
const RECTA = figura([[100, 0]]);                                   // sin dobleces
ok(nArcos(pathDe(L90)) === 1, 'L de 90°: 1 arco');
ok(nArcos(pathDe(U)) === 2, 'U: 2 arcos');
ok(nArcos(pathDe(RECTA)) === 0, 'recta: ningún arco (no hay doblez que redondear)');
ok(!/ L [\d.]+ [\d.]+ A/.test('') && pathDe(L90).indexOf(' A ') !== -1,
  'el path usa el comando A de SVG (arco), no una polilínea que finja la curva');

// ── B · el codo es TANGENTE (la propiedad, no el adorno) ─────────────────────
console.log('B · tangencia: las dos patas entran a la curva sin quiebre:');
[['L 90°', L90], ['U', U], ['marco cerrado', MARCO]].forEach(function (c) {
  var cs = codos(pathDe(c[1]));
  ok(cs.length > 0 && cs.every(function (k) { return casi(k.t1, k.t2, 0.03); }),
    c[0] + ': las dos tangencias están a la misma distancia del vértice');
  ok(cs.length > 0 && cs.every(function (k) { return casi(k.t1, k.R * Math.tan(k.giro * Math.PI / 360), 0.05); }),
    c[0] + ': y esa distancia es t = R·tan(giro/2) — el arco es tangente de verdad');
});

// ── C · el codo no cambia el ángulo del doblez ───────────────────────────────
console.log('C · el redondeo es cómo se dibuja el doblez, no cuánto dobla:');
// 102B = pata a 135° del cuerpo → giro del doblez = 180 − 135 = 45°.
const G135 = figura([[100, 0], [70.7107, 70.7107]]);
ok(casi(codos(pathDe(G135))[0].giro, 45, 0.2), 'vértice de 135° (una 102B) → giro de 45° en el path');
ok(casi(codos(pathDe(L90))[0].giro, 90, 0.2), 'vértice de 90° → giro de 90°');
const G45 = figura([[100, 0], [-70.7107, 70.7107]]);
ok(casi(codos(pathDe(G45))[0].giro, 135, 0.2), 'vértice de 45° (punta aguda) → giro de 135°');

// ── D · el radio ─────────────────────────────────────────────────────────────
console.log('D · R = k × el TRAZO (k de norma), y el φ entra por la misma puerta que el grosor:');
ok(casi(codos(pathDe(L90))[0].R, K_CHICO * NOMINAL),
  'sin φ (catálogo/galería/previews): R = 2.5 × 5.5 = ' + (K_CHICO * NOMINAL) + ' px');
// Con φ: se dibuja como Bar Manager (puntos ya en cm + metrico). Lados largos para que
// el capeo no entre en juego y se pueda leer el radio pelado.
function conPhi(diamMM, metrico, geo, opts) {
  return RE_PATH.exec(MOTOR.dibujarFigura(geo || L90, null,
    Object.assign({ diam_mm: diamMM, metrico: metrico }, opts || PREV)));
}
[8, 12, 16].forEach(function (mm) {
  var m = conPhi(mm, true);
  ok(casi(codos(m[1])[0].R, K_CHICO * Number(m[2]), 0.03),
    'φ' + mm + ' ≤ 16 mm: R = 2.5 × trazo = 2φ interno + φ/2 (la norma de motor_geom)');
});
// Los φ gruesos piden 4 × el trazo, o sea 26–52 px: en los tamaños de pantalla ese codo
// no cabe y manda el tope (bloque E). Para leer el factor pelado hace falta un lienzo
// donde SÍ quepa — el motor está expuesto y acepta cualquier tamaño.
const GRANDE = { width: 600, height: 400, pad: 20 };
[18, 25, 36].forEach(function (mm) {
  var m = conPhi(mm, true, L90, GRANDE);
  ok(casi(codos(m[1])[0].R, K_GRANDE * Number(m[2]), 0.03),
    'φ' + mm + ' > 16 mm: R = 4 × trazo = 3.5φ interno + φ/2');
});
ok(casi(codos(conPhi(36, false)[1])[0].R, K_CHICO * NOMINAL, 0.03),
  'metrico=false (los puntos NO están en cm): el φ no se usa, ni para el trazo ni para el codo');
ok(casi(codos(conPhi(null, true)[1])[0].R, K_CHICO * NOMINAL, 0.03),
  'barra sin φ cargado: nominal, no NaN');
// EL CODO DE NORMA SALE SOLO. Ésta es la razón de ser de la regla "R = k × trazo": cuando
// el motor dibuja el φ REAL (el grosor físico φ·scale gana al piso), sw = φ·scale y por lo
// tanto R = 2.5·φ·scale — o sea el radio de norma en cm, escalado, sin cablear un solo
// centímetro en el render. Estribo 18×18 con φ8 en Bar Manager XL: 6.667 px/cm, trazo
// físico 5.33 px (por encima del piso de 5.00), y el codo mide 2.00 cm = 2.5 × 0.8 cm.
const XL = { width: 220, height: 160, pad: 20 };
const ESC_XL = 120 / 18;                                   // px/cm de ese encuadre
const ESTRIBO_CM = figura([[18, 0], [0, 18], [-18, 0], [0, -18]]);
var mEst = conPhi(8, true, ESTRIBO_CM, XL);
ok(casi(Number(mEst[2]), 5.33, 0.01), 'estribo 18×18 φ8 @ XL: el trazo es el FÍSICO (5.33 px = 0.8 cm × 6.667)');
ok(casi(codos(mEst[1])[0].R / ESC_XL, K_CHICO * 0.8, 0.01),
  'y su codo mide 2.5φ = 2.00 cm en el mundo real: el radio de norma sale solo, sin cm cableados');

// ── E · el capeo en lados cortos ─────────────────────────────────────────────
console.log('E · el codo no se puede comer el lado (tope = 20% del lado más corto):');
// Zeta con un tramo central corto: el codo de norma (t = 13.75) no cabe en 12 px.
const ZETA = figura([[100, 0], [0, 12], [100, 0]]);
var cz = codos(pathDe(ZETA));
ok(cz.length === 2, 'la zeta con el tramo corto igual sale con sus 2 codos');
ok(cz.length === 2 && cz.every(function (k) { return k.R < K_CHICO * NOMINAL; }),
  'con el lado corto el RADIO baja (no se recorta la pata): ' + cz.map(function (k) { return k.R.toFixed(2); }).join(' / '));
ok(cz.length === 2 && cz.every(function (k) { return casi(k.t1, k.R * Math.tan(k.giro * Math.PI / 360), 0.05); }),
  'y el codo capeado SIGUE siendo tangente (bajar el radio no puede introducir un quiebre)');
// El tope se lee midiendo el lado corto en el propio path: es la recta entre los 2 arcos.
var nz = nodos(pathDe(ZETA));
var iA = nz.findIndex(function (n) { return n.cmd === 'A'; });
var ladoCorto = dist(nz[iA], nz[iA + 1]);      // lo que quedó RECTO del tramo del medio
ok(ladoCorto > 0, 'el tramo del medio NO se lo comió el codo: quedan ' + ladoCorto.toFixed(2) + ' px rectos');
ok(casi(ladoCorto / (ladoCorto + cz[0].t1 + cz[1].t1), 1 - 2 * TMAX, 0.02),
  'y lo que queda recto es el 60% del lado: cada codo se lleva como mucho el 20% (tope ' + TMAX + ')');
ok(cz[0].sweep !== cz[1].sweep, 'la zeta dobla para lados opuestos: los dos codos curvan al revés');
// Dos codos del mismo lado NUNCA se pisan. Se mide sobre el peor caso posible: una zeta
// con el tramo del medio DIMINUTO, donde los dos codos tiran del mismo lado a la vez.
var ZETA_MIN = figura([[100, 0], [0, 0.6], [100, 0]]);
var nzm = nodos(pathDe(ZETA_MIN));
var rectosZm = [];
for (var zi = 1; zi < nzm.length; zi++) if (nzm[zi].cmd === 'L') rectosZm.push(dist(nzm[zi - 1], nzm[zi]));
ok(rectosZm.every(function (L) { return L >= 0; }),
  'ni con el tramo del medio en 0.6 unidades se cruzan los codos: ningún tramo recto sale negativo');

// ── F · ángulos agudos y vuelta en U ─────────────────────────────────────────
console.log('F · donde el codo se sale de madre: la punta aguda y la vuelta en U:');
var c45 = codos(pathDe(G45))[0];
ok(c45 && c45.R > 0 && isFinite(c45.R), 'vértice de 45°: sale un codo con radio finito, no un NaN');
ok(c45.R < K_CHICO * NOMINAL,
  'y el radio BAJA (' + c45.R.toFixed(2) + ' < ' + (K_CHICO * NOMINAL) + '): en un vértice de 45° la tangencia pide 2.41·R y el tope la corta');
ok(casi(c45.t1, c45.R * Math.tan(c45.giro * Math.PI / 360), 0.05), 'y sigue siendo tangente');
// Vuelta en U (giro ≈ 180°, vértice ≈ 0°): la tangente tiende a infinito → sin codo.
const U_TURN = figura([[100, 0], [-100, 0.0001]]);
ok(nArcos(pathDe(U_TURN)) === 0, 'vuelta en U: NO se inventa un codo (la tangente diverge); queda la punta');
ok(!/NaN|Infinity|undefined/.test(pathDe(U_TURN)), 'y el path de la U no trae NaN ni Infinity');
// Colineal: tampoco hay doblez que redondear.
const RECTO2 = figura([[100, 0], [100, 0]]);
ok(nArcos(pathDe(RECTO2)) === 0, 'dos tramos colineales: ningún codo (no hay doblez)');

// ── G · los arcos declarados no se tocan ─────────────────────────────────────
console.log('G · donde la figura YA trae un arco, la curva es el doblez:');
const CON_ARCO = figura([[100, 0], [0, 100], [-100, 0]], ['recto', 'arco', 'recto']);
CON_ARCO.tipos_seg = ['recto', 'arco', 'recto'];
CON_ARCO.radios_seg = [0, 120, 0];
CON_ARCO.sweeps_seg = [1, 1, 1];
var dArco = pathDe(CON_ARCO);
ok(nArcos(dArco) === 1, 'los 2 vértices tocan el tramo en arco → ni uno recibe codo (1 solo A: el arco declarado)');
// El radio del arco declarado viaja ESCALADO (radios_seg × scale), así que no se puede
// buscar el 120 literal: se compara contra el radio del codo, que es lo que este chequeo
// existe para distinguir. 120 unidades de figura son ~85 px acá; el codo son 13.75.
var rArco = Number(/ A ([\d.]+)/.exec(dArco)[1]);
ok(rArco > 3 * (K_CHICO * NOMINAL),
  'y ese arco tiene SU radio (' + rArco.toFixed(1) + ' px, el declarado escalado), no el del codo (' + (K_CHICO * NOMINAL) + ')');

// ── H · la figura cerrada cierra redonda ─────────────────────────────────────
console.log('H · el estribo no puede tener 3 esquinas redondas y una en punta:');
var dMarco = pathDe(MARCO);
ok(nArcos(dMarco) === 4, 'marco cerrado de 4 lados: 4 codos (el del cierre incluido)');
var nMarco = nodos(dMarco);
ok(nMarco[0].cmd === 'M' && nMarco[nMarco.length - 1].cmd === 'A' &&
   casi(nMarco[0].x, nMarco[nMarco.length - 1].x, 0.02) && casi(nMarco[0].y, nMarco[nMarco.length - 1].y, 0.02),
  'el path ARRANCA en la tangencia del codo de cierre y TERMINA ahí: el contorno queda cerrado');
var cMarco = codos(dMarco);
ok(cMarco.length >= 3 && cMarco.every(function (k) { return casi(k.R, K_CHICO * NOMINAL, 0.03); }),
  'y las 4 esquinas del marco tienen el MISMO radio');
// Figura abierta cuyo último punto NO vuelve al primero: no se inventa un cierre.
ok(nArcos(pathDe(U)) === 2, 'una U (abierta) sigue con 2 codos: el cierre no se inventa donde no lo hay');

// ── I · barrido de las 63 figuras del catálogo × los 6 tamaños vivos ─────────
console.log('I · barrido del catálogo real (63 figuras × los 10 encuadres vivos):');
global.ModeladorCatalogoFiguras = require(path.join(DIR, 'modelador', 'catalogo_figuras.js'));
const FP = require(path.join(DIR, 'modelador', 'figura_puntos.js'));
// LOS 10 ENCUADRES VIVOS, no 6: Bar Manager y el Fabricator comparten los 4 recuadros
// (70×52 / 110×80 / 160×118 / 220×160) pero NO el pad — barmanager.js clava 20 y
// agregar_cubicacion2.js usa round(min(w,h)×0.22) = 11/18/26/35. Con pads distintos la
// figura queda a otra escala, así que son 10 casos a medir, no 6.
const TAMS = [['miniatura', MINI], ['preview', PREV], ['BM S', { width: 70, height: 52, pad: 20 }],
              ['BM M', { width: 110, height: 80, pad: 20 }], ['BM L', { width: 160, height: 118, pad: 20 }], ['BM XL', XL],
              ['Fab S', { width: 70, height: 52, pad: 11 }], ['Fab M', { width: 110, height: 80, pad: 18 }],
              ['Fab L', { width: 160, height: 118, pad: 26 }], ['Fab XL', { width: 220, height: 160, pad: 35 }]];
var CATALOGO = global.ModeladorCatalogoFiguras.codigos().map(function (cod) {
  var tr = FP.derivarTramos(cod);
  return tr ? { codigo: cod, geometria: { dim: '2D', tramos: tr } } : null;
}).filter(Boolean);
ok(CATALOGO.length === 63, 'el catálogo trae sus 63 figuras (' + CATALOGO.length + ')');
var malNaN = [], malFuera = [], malComido = [], minRecto = Infinity, nCodos = 0, sinCodo = [];
TAMS.forEach(function (T) {
  CATALOGO.forEach(function (f) {
    var m = render(f.geometria, T[1]);
    if (!m) { malNaN.push(T[0] + '/' + f.codigo + ' (sin path)'); return; }
    var d = m[1], sw = Number(m[2]);
    if (/NaN|Infinity|undefined/.test(d)) { malNaN.push(T[0] + '/' + f.codigo); return; }
    var ns = nodos(d);
    nCodos += ns.filter(function (n) { return n.cmd === 'A'; }).length;
    // Fuera del viewBox: el trazo sobresale sw/2 de los puntos del path (el arco va
    // por DENTRO del vértice, así que no puede empujar el bbox hacia afuera).
    var fuera = ns.some(function (p) {
      return p.x - sw / 2 < -0.01 || p.y - sw / 2 < -0.01 ||
             p.x + sw / 2 > T[1].width + 0.01 || p.y + sw / 2 > T[1].height + 0.01;
    });
    if (fuera) malFuera.push(T[0] + '/' + f.codigo);
    // Tramo comido: una recta entre dos codos que quedó en nada.
    for (var i = 1; i < ns.length; i++) {
      if (ns[i].cmd !== 'L') continue;
      var L = dist(ns[i - 1], ns[i]);
      if (L < minRecto) minRecto = L;
      if (L < 0.5) malComido.push(T[0] + '/' + f.codigo + ' (' + L.toFixed(2) + ' px)');
    }
    if (f.geometria.tramos.length >= 2 && nArcos(d) === 0) sinCodo.push(T[0] + '/' + f.codigo);
  });
});
ok(malNaN.length === 0, 'ninguna figura emite NaN/Infinity en el path' + (malNaN.length ? ': ' + malNaN.slice(0, 5).join(', ') : ''));
ok(malFuera.length === 0, 'ninguna figura se sale de su viewBox' + (malFuera.length ? ': ' + malFuera.slice(0, 5).join(', ') : ''));
ok(malComido.length === 0, 'ningún tramo recto comido por el codo' + (malComido.length ? ': ' + malComido.slice(0, 5).join(', ') : ''));
ok(minRecto > 4, 'el tramo recto más corto de todo el barrido mide ' + minRecto.toFixed(2) + ' px (> 4)');
ok(sinCodo.length === 0, 'toda figura con doblez sale con codo' + (sinCodo.length ? ': ' + sinCodo.slice(0, 5).join(', ') : ''));
ok(nCodos > 1900, 'el barrido midió ' + nCodos + ' codos (no se está probando sobre una lista vacía)');

// ── J · el fuente: un solo sitio decide el codo ──────────────────────────────
console.log('J · el fuente (que nadie vuelva a la polilínea en punta):');
var src = fs.readFileSync(SRC_MOTOR, 'utf8');
ok(/function _codoVertice\(/.test(src), 'el codo lo construye _codoVertice (un solo sitio)');
ok(/function _radioDoblado\(/.test(src), 'y el radio lo decide _radioDoblado (un solo sitio)');
ok(/var FIL_K = 2.5;/.test(src) && /var FIL_K_GRANDE = 4;/.test(src) && /var FIL_TMAX = 0.20;/.test(src),
  'la calibración vive en constantes con nombre (FIL_K ' + K_CHICO + ' / FIL_K_GRANDE ' + K_GRANDE + ' / FIL_TMAX ' + TMAX + ')');
ok((src.match(/_pathDesdePuntos\(/g) || []).length === 3,
  'sigue habiendo UNA sola función de path y sus 2 llamadores (render + lienzo del Diseñador)');
ok(/_pathDesdePuntos\(tpts[^)]*rFillet\)/.test(src), 'el render le pasa el radio del codo');
ok(/_pathDesdePuntos\(_puntos[^)]*_radioDoblado\(SW_NOMINAL\)\)/.test(src),
  'y el lienzo del Diseñador dibuja los MISMOS codos (si no, la figura cambia de forma al pasar al preview)');

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos ? 1 : 0);
