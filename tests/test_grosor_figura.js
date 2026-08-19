// =============================================================================
// GROSOR DEL TRAZO DE LA FIGURA — test headless (Node)
// -----------------------------------------------------------------------------
// El trazo de la barra se pintaba con stroke-width="3" CLAVADO en el único motor
// SVG compartido (disenador.js · svgDesdePuntos), así que un φ8 y un φ36 salían
// con la misma línea en las 6 vistas que consumen el motor. Ahora el trazo crece
// con el diámetro. Este test congela la regla y los bordes donde es fácil
// romperla sin que se note mirando la pantalla:
//
//   A. LA REGLA. sw = clamp(φ_cm × scale, PISO(φ), min(9, pad×0.9)), con
//      PISO(φ_mm) = 2.4 + (φ_mm − 8) × 0.055. Se comprueba con los CUATRO números
//      que fijó el usuario, MEDIDOS sobre el SVG que sale del motor (no deducidos):
//        φ8  recta 600 @ Bar Manager M     → 2.40   (manda el piso)
//        φ32 recta 600 @ Bar Manager M     → 3.72   (manda el piso)
//        φ16 estribo 25×45 @ Bar Manager XL → 4.27  (manda el grosor REAL)
//        φ32 traba 10×15 @ Bar Manager XL   → 9.00  (manda el tope)
//
//   B. EL PISO ES ESCALONADO, NO PLANO. Una barra larga mide menos de 1 px de
//      ancho en cualquier miniatura (600 cm en 90×72 = 0.110 px/cm → φ16 = 0.18 px):
//      con un piso plano el 90% de las barras se dibujaría idéntico a antes y el
//      trabajo no se vería. Se exige que los 10 φ del catálogo den 10 grosores
//      DISTINTOS y crecientes justo donde manda el piso.
//
//   C. LA TRAMPA DE LAS UNIDADES — el defecto que este test existe para atrapar.
//      φ viaja en MILÍMETROS y los puntos en CENTÍMETROS: hay que dividir por 10
//      UNA sola vez. El mismo error ya se cometió en template_editor.js (el círculo
//      de la barra de punta salía 10× chico por re-aplicar la conversión, y el piso
//      lo tapaba dibujando todos los φ iguales). Se fija el valor ABSOLUTO, no la
//      proporción: con la división de más, φ16 daría 2.84 (el piso) en vez de 4.27.
//
//   D. EL INTERRUPTOR metrico. El φ SOLO se puede usar cuando el llamador
//      reconstruyó los puntos en cm (rama "escalable" de Bar Manager y del creador
//      de despieces). En la rama NO escalable (figura con radio o etiqueta-manda)
//      los puntos siguen en px del lienzo del Diseñador y scale NO es px/cm:
//      aplicar φ ahí da un grosor inventado. Tiene que caer al nominal.
//
//   E. RETROCOMPATIBILIDAD. Sin los dos datos (φ y metrico) el motor devuelve el
//      trazo nominal, constante, en cualquier figura y cualquier tamaño. Las 4
//      vistas sin barra detrás (preview del Diseñador, galería, preview 3D,
//      miniatura del catálogo) dependen de esto.
//
//   F. QUE NADIE VUELVA A CLAVAR EL 3. Chequeo del FUENTE: la línea del path de la
//      barra no puede volver a tener un stroke-width literal, y los dos sitios con
//      barra real (barmanager.js, agregar_cubicacion2.js) tienen que seguir pasando
//      diam_mm + metrico. Sin esto el bloque A seguiría verde con el motor bien y
//      las pantallas planas.
//
//   G. CONVIVENCIA. Con trazo grueso (sw ≥ 5) los nodos de vértice (r ≤ 2.5) quedan
//      enteros DENTRO del trazo: no se dibujan. Y la letra del lado se corre medio
//      trazo para no meterse adentro (10 px al BORDE, con cualquier φ).
//
// Correr con: node tests/test_grosor_figura.js
// =============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features');
const SRC_MOTOR = path.join(DIR, 'catalogo', 'disenador.js');
const SRC_BM    = path.join(DIR, 'cubicacion', 'barmanager.js');
const SRC_AC2   = path.join(DIR, 'cubicacion', 'agregar_cubicacion2.js');

let fallos = 0;
function ok(c, m) { if (!c) { console.log('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function casi(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.005 : tol); }

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

// ── Tamaños y constantes REALES de los sitios vivos (copiados de su fuente) ──
const BM_TAM = { s: { w: 70, h: 52 }, m: { w: 110, h: 80 }, l: { w: 160, h: 118 }, xl: { w: 220, h: 160 } };
const DIAMS = [8, 10, 12, 16, 18, 22, 25, 28, 32, 36];      // AC2_DIAMS (mm)
const MIN_LADO_REL = 0.28;                                   // BM_MIN_LADO_REL / AC2_MIN_LADO_REL
const LADOS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const PISO = (mm) => 2.4 + (mm - 8) * 0.055;
const NOMINAL = 3.4;

// Figura de catálogo a partir de direcciones unitarias (puntos en unidades de grilla).
function figura(dirs) {
  var pts = [{ x: 0, y: 0 }], tramos = [];
  dirs.forEach(function (d, i) {
    var u = pts[pts.length - 1];
    pts.push({ x: u.x + d[0], y: u.y + d[1] });
    tramos.push({ lado: LADOS[i], giro: 0, sentido: null });
  });
  return { dim: '2D', puntos: pts, tramos: tramos };
}
// Reconstrucción "escalable": la misma que hacen _bmFiguraSvg y ac2FigSvg antes de
// llamar al motor (dirección original, longitud = dim real en cm, con piso relativo
// por lado). Es lo que convierte a scale en px/cm y habilita el φ.
function escalar(geo, dims) {
  var largos = [];
  for (var i = 0; i < geo.tramos.length && i + 1 < geo.puntos.length; i++) {
    var dx = geo.puntos[i + 1].x - geo.puntos[i].x, dy = geo.puntos[i + 1].y - geo.puntos[i].y;
    var l0 = Math.sqrt(dx * dx + dy * dy) || 1;
    var v = dims[geo.tramos[i].lado];
    largos.push((v != null && !isNaN(v) && v > 0) ? Number(v) : l0);
  }
  var minLado = Math.max.apply(null, largos.concat([1])) * MIN_LADO_REL;
  var op = geo.puntos, np = [{ x: op[0].x, y: op[0].y }];
  for (var s = 0; s < geo.tramos.length && s + 1 < op.length; s++) {
    var ax = op[s + 1].x - op[s].x, ay = op[s + 1].y - op[s].y;
    var len = Math.sqrt(ax * ax + ay * ay) || 1;
    var nl = Math.max(largos[s], minLado), u = np[np.length - 1];
    np.push({ x: u.x + (ax / len) * nl, y: u.y + (ay / len) * nl });
  }
  var g = {}; for (var k in geo) g[k] = geo[k];
  g.puntos = np; g.etiquetas = [];
  return g;
}
const RE_SW = /<path d="[^"]*" fill="none" stroke="#00695c" stroke-width="([\d.]+)"/;
function sw(svgStr) { var m = RE_SW.exec(svgStr); return m ? Number(m[1]) : null; }
// Dibuja como lo hace Bar Manager: reconstrucción en cm + φ en mm + metrico.
function render(geo, dims, tam, diamMM, metrico, pad) {
  return MOTOR.dibujarFigura(metrico ? escalar(geo, dims) : geo, dims,
    { width: tam.w, height: tam.h, pad: (pad != null ? pad : 20), diam_mm: diamMM, metrico: metrico });
}
const RECTA   = figura([[1, 0]]);                            // 1 lado
const ESTRIBO = figura([[1, 0], [0, 1], [-1, 0], [0, -1]]);  // marco cerrado de 4 lados
const TRABA   = figura([[1, 0], [0, 1]]);                    // 2 lados: bbox = A × B
const D_ESTRIBO = { A: 25, B: 45, C: 25, D: 45 };
const D_TRABA   = { A: 10, B: 15 };

// ── A · los cuatro números del criterio ──────────────────────────────────────
console.log('A · la regla, medida sobre el SVG que sale del motor:');
ok(casi(sw(render(RECTA, { A: 600 }, BM_TAM.m, 8, true)), 2.40),
  'φ8 · recta 600 @ BM M = 2.40 (manda el piso: el grosor real es 0.09 px)');
ok(casi(sw(render(RECTA, { A: 600 }, BM_TAM.m, 32, true)), 3.72),
  'φ32 · recta 600 @ BM M = 3.72 (manda el piso, y es OTRO que el de φ8)');
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 16, true)), 4.27),
  'φ16 · estribo 25x45 @ BM XL = 4.27 (manda el grosor REAL: 1.6 cm x 2.667 px/cm)');
ok(casi(sw(render(TRABA, D_TRABA, BM_TAM.xl, 32, true)), 9.00),
  'φ32 · traba 10x15 @ BM XL = 9.00 (manda el tope: pediría 25.6 px)');

// ── B · el piso es escalonado, no plano ──────────────────────────────────────
console.log('B · piso escalonado por φ (si fuera plano, el 90% de las barras no cambiaría):');
var pisos = DIAMS.map(function (d) { return sw(render(RECTA, { A: 600 }, BM_TAM.m, d, true)); });
ok(new Set(pisos).size === DIAMS.length,
  'los 10 φ del catálogo dan 10 grosores DISTINTOS donde manda el piso (' + pisos.join(' / ') + ')');
ok(pisos.every(function (v, i) { return i === 0 || v > pisos[i - 1]; }),
  'y son estrictamente crecientes con el φ');
ok(DIAMS.every(function (d, i) { return casi(pisos[i], Math.round(PISO(d) * 100) / 100); }),
  'cada uno vale PISO(φ) = 2.4 + (φ - 8) x 0.055');

// ── C · la trampa de las unidades (mm vs cm) ─────────────────────────────────
console.log('C · φ en mm, puntos en cm: se divide por 10 UNA sola vez:');
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 16, true)), 4.27),
  'φ16 estribo XL = 4.27 y NO 2.84 (= el piso, que es lo que saldría con la división de más)');
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 25, true)), 6.67),
  'φ25 en el mismo estribo = 6.67 px = 2.5 cm x 2.667 px/cm — grosor FÍSICO, no una constante');
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 8, true)), PISO(8)),
  'φ8 en ese estribo pide 2.13 px (físico) pero el piso lo sube a 2.40: el clamp no deja bajar');
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 36, true)), 9.00),
  'φ36 en ese estribo pide 9.60 px y el tope lo baja a 9.00');
// La MISMA figura a dos tamaños: si el φ estuviera mal convertido, el escalón no aparecería.
ok(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 25, true)) >
   sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.l, 25, true)) &&
   sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.l, 25, true)) >
   sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.m, 25, true)),
  'el mismo estribo φ25 engorda al subir de tamaño (M -> L -> XL): el trazo sigue a la escala');

// ── D · el interruptor metrico ───────────────────────────────────────────────
console.log('D · sin "los puntos están en cm" el φ NO se usa:');
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 16, false)), NOMINAL),
  'metrico=false (figura con radio / etiqueta-manda): trazo nominal, no 4.27');
ok(casi(sw(render(TRABA, D_TRABA, BM_TAM.xl, 32, false)), NOMINAL),
  'metrico=false tampoco deja llegar al tope con un φ grande');
ok(DIAMS.every(function (d) { return casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, d, false)), NOMINAL); }),
  'en la rama NO métrica los 10 φ dan EXACTAMENTE el mismo trazo (no hay grosor inventado)');

// ── E · retrocompatibilidad: sin los dos datos, nominal constante ────────────
console.log('E · sin φ (las 4 vistas sin barra detrás): trazo nominal constante:');
var SITIOS = [['preview Diseñador 210x140', { width: 210, height: 140, pad: 18 }],
              ['galería 90x72',             { width: 90,  height: 72,  pad: 12 }],
              ['preview 3D 210x140',        { width: 210, height: 140, pad: 18 }],
              ['miniatura catálogo 90x72',  { width: 90,  height: 72,  pad: 12 }],
              ['sin opts (default)',        {}]];
SITIOS.forEach(function (s) {
  ok(casi(sw(MOTOR.dibujarFigura(ESTRIBO, null, s[1])), NOMINAL), s[0] + ' = ' + NOMINAL);
});
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, null, true)), NOMINAL) &&
   casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, '', true)), NOMINAL) &&
   casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 0, true)), NOMINAL),
  'barra SIN φ cargado (null / vacío / 0) = nominal, no NaN ni 0');
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, '16', true)), 4.27),
  'φ como string "16" (viene de un <select>) se lee igual que el número');
ok(!/stroke-width="(NaN|Infinity)"/.test(
     MOTOR.dibujarFigura(escalar(ESTRIBO, D_ESTRIBO), D_ESTRIBO,
       { width: 220, height: 160, pad: 20, diam_mm: 16, metrico: true })),
  'ningún camino emite stroke-width NaN/Infinity');

// ── F · que nadie vuelva a clavar el 3 (chequeo del fuente) ──────────────────
console.log('F · el fuente no puede volver al stroke-width clavado:');
var srcMotor = fs.readFileSync(SRC_MOTOR, 'utf8');
var lineaPath = srcMotor.split('\n').filter(function (l) {
  return l.indexOf('_pathDesdePuntos(tpts') !== -1 && l.indexOf('stroke="#00695c"') !== -1;
});
ok(lineaPath.length === 1, 'sigue habiendo UNA sola línea que pinta el trazo de la barra en el render');
ok(lineaPath.length === 1 && !/stroke-width="[\d.]+"/.test(lineaPath[0]),
  'esa línea NO tiene un stroke-width literal (si alguien vuelve a clavarlo, este test falla)');
ok(/function _grosorTrazo\(/.test(srcMotor),
  'el grosor lo decide _grosorTrazo (un solo sitio que lo calcula)');
ok((srcMotor.match(/diamMM \/ 10/g) || []).length === 1,
  'la conversión mm->cm aparece UNA sola vez (repetirla es exactamente el bug de template_editor)');
var srcBM = fs.readFileSync(SRC_BM, 'utf8'), srcAC2 = fs.readFileSync(SRC_AC2, 'utf8');
ok(/diam_mm:\s*b\.diam/.test(srcBM) && /metrico:\s*escalable/.test(srcBM),
  'barmanager.js (columna Render) le pasa al motor diam_mm: b.diam + metrico: escalable');
ok(/diam_mm:\s*b\.diam/.test(srcAC2) && /metrico:\s*escalable/.test(srcAC2),
  'agregar_cubicacion2.js (creador de despieces) le pasa lo mismo');
ok(srcBM.indexOf('_bmMiniFigura') === -1,
  '_bmMiniFigura (código muerto: 0 llamadas en todo el repo) no volvió a aparecer');

// ── G · convivencia con el trazo grueso ──────────────────────────────────────
console.log('G · nodos y letras conviviendo con el trazo grueso:');
function nCirculos(s) { return (s.match(/<circle/g) || []).length; }
var sFino  = render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 16, true);   // sw 4.27
var sGordo = render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 22, true);   // sw 5.87
ok(sw(sFino) < 5 && nCirculos(sFino) === 5, 'sw < 5: los 5 nodos de vértice se siguen dibujando');
ok(sw(sGordo) >= 5 && nCirculos(sGordo) === 0,
  'sw >= 5: ningún <circle> — el nodo más grande (r 2.5 = 5 px de diámetro) queda entero bajo el trazo');
ok(nCirculos(MOTOR.dibujarFigura(ESTRIBO, null, { width: 220, height: 160, pad: 20 })) === 5,
  'y con el trazo nominal los nodos siguen ahí (no se perdieron por el camino)');
// La letra del lado: sobre un tramo horizontal el desplazamiento es vertical y se puede medir.
function distLetra(diamMM, metrico) {
  var s = render(RECTA, { A: 600 }, BM_TAM.xl, diamMM, metrico);
  var cuerpo = s.slice(s.indexOf('</defs>'));
  var p = /<path d="M (-?[\d.]+) (-?[\d.]+)/.exec(cuerpo);
  var t = /<text x="(-?[\d.]+)" y="(-?[\d.]+)" text-anchor="middle" fill="#00695c" font-size="11"/.exec(cuerpo);
  return { sw: sw(s), d: Math.abs((Number(t[2]) - 3) - Number(p[2])) };
}
[[null, false], [8, true], [16, true], [32, true]].forEach(function (c) {
  var r = distLetra(c[0], c[1]);
  ok(casi(r.d, 10 + r.sw / 2, 0.06),
    'φ' + (c[0] || '-') + ' (sw ' + r.sw + '): la letra va a 10 + sw/2 = ' + (10 + r.sw / 2).toFixed(2) +
    ' px del eje, o sea 10 px del BORDE del trazo con cualquier φ');
});

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos ? 1 : 0);
