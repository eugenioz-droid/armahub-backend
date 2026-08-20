// =============================================================================
// GROSOR DEL TRAZO DE LA FIGURA — test headless (Node)
// -----------------------------------------------------------------------------
// El trazo de la barra se pintaba con stroke-width="3" CLAVADO en el único motor
// SVG compartido (disenador.js · svgDesdePuntos), así que un φ8 y un φ36 salían
// con la misma línea en las 6 vistas que consumen el motor. Ahora el trazo crece
// con el diámetro. Este test congela la regla y los bordes donde es fácil
// romperla sin que se note mirando la pantalla:
//
//   A. LA REGLA. sw = clamp(φ_cm × scale, PISO(φ), min(7, pad×0.9)), con
//      PISO(φ_mm) = 2.5 + (φ_mm − 8) × 0.0715. Se comprueba con los CUATRO números
//      que fijó el usuario, MEDIDOS sobre el SVG que sale del motor (no deducidos):
//        φ8  recta 600 @ Bar Manager M     → 2.50   (manda el piso)
//        φ32 recta 600 @ Bar Manager M     → 4.22   (manda el piso)
//        φ16 estribo 25×45 @ Bar Manager XL → 4.27  (manda el grosor REAL)
//        φ32 traba 10×15 @ Bar Manager XL   → 7.00  (manda el tope)
//      20-ago: TODA la calibración se dividió por 2 (el usuario veía el trazo
//      «demasiado gordo»): nominal 5.5→2.75, piso 5.0–9.0→2.5–4.5, tope 14→7. Los
//      tres juntos, para que la relación entre ellos —y el radio del codo, que sale
//      de R = k × sw— no cambie. Este test es el que fija que sigan en su sitio.
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
//   G. CONVIVENCIA. La barra NO lleva nodos dibujados: ni en las puntas (el extremo
//      del fierro es el corte, y va con linecap `butt` = punta PLANA) ni en los
//      vértices (los tapa el codo). Y la letra del lado se corre medio trazo para no
//      meterse adentro (10 px al BORDE, con cualquier φ).
//
//   H. LA LETRA CABE ENTERA. El encuadre le RESERVA sitio al rótulo (_padRotulo): la
//      letra sale del bbox de la figura, así que si el pad del llamador es más chico
//      que lo que ocupa, manda la letra. Sin esto había 128 letras cortadas por el
//      borde en el barrido (63 figuras × 10 encuadres), hasta 5.72 px por fuera, todas
//      en los dos encuadres de pad chico: miniatura del catálogo (12) y Fabricator S (11).
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
const PISO = (mm) => 2.5 + (mm - 8) * 0.0715;
const NOMINAL = 2.75;

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
ok(casi(sw(render(RECTA, { A: 600 }, BM_TAM.m, 8, true)), 2.50),
  'φ8 · recta 600 @ BM M = 2.50 (manda el piso: el grosor real es 0.09 px)');
ok(casi(sw(render(RECTA, { A: 600 }, BM_TAM.m, 32, true)), 4.22),
  'φ32 · recta 600 @ BM M = 4.22 (manda el piso, y es OTRO que el de φ8)');
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 16, true)), 4.27),
  'φ16 · estribo 25x45 @ BM XL = 4.27: el fisico (4.27) pasa el piso de su φ (3.07) y manda el fisico');
ok(casi(sw(render(TRABA, D_TRABA, BM_TAM.xl, 32, true)), 7.00),
  'φ32 · traba 10x15 @ BM XL = 7.00 (manda el tope: pediría 25.6 px)');

// ── B · el piso es escalonado, no plano ──────────────────────────────────────
console.log('B · piso escalonado por φ (si fuera plano, el 90% de las barras no cambiaría):');
var pisos = DIAMS.map(function (d) { return sw(render(RECTA, { A: 600 }, BM_TAM.m, d, true)); });
ok(new Set(pisos).size === DIAMS.length,
  'los 10 φ del catálogo dan 10 grosores DISTINTOS donde manda el piso (' + pisos.join(' / ') + ')');
ok(pisos.every(function (v, i) { return i === 0 || v > pisos[i - 1]; }),
  'y son estrictamente crecientes con el φ');
ok(DIAMS.every(function (d, i) { return casi(pisos[i], Math.round(PISO(d) * 100) / 100); }),
  'cada uno vale PISO(φ) = 2.5 + (φ - 8) x 0.0715');

// ── C · la trampa de las unidades (mm vs cm) ─────────────────────────────────
console.log('C · φ en mm, puntos en cm: se divide por 10 UNA sola vez:');
ok(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 16, true)) > sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 8, true)),
  'φ16 sigue siendo mas gruesa que φ8 en el mismo estribo (la conversion mm->cm no se repite)');
// El grosor FISICO solo manda cuando supera al piso de su φ y no llega al tope: φ16 pide
// 4.27 px (1.6 cm x 2.667 px/cm), por encima de su piso (3.07) y por debajo del tope (7).
// Es el caso que prueba que el numero sale de la GEOMETRIA y no de una constante.
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 16, true)), 4.27),
  'φ16 en el mismo estribo = 4.27 px = 1.6 cm x 2.667 px/cm — grosor FISICO, no una constante');
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 8, true)), PISO(8)),
  'φ8 en ese estribo pide 1.07 px (fisico) pero el piso lo sube a 2.50: el clamp no deja bajar');
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 36, true)), 7.00),
  'φ36 en ese estribo pide 9.60 px (fisico) y el tope lo baja a 7.00: el clamp no deja subir');
// La MISMA figura a dos tamaños: si el φ estuviera mal convertido, el escalón no aparecería.
ok(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 36, true)) >
   sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.l, 36, true)) &&
   sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.l, 36, true)) >=
   sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.m, 36, true)),
  'el mismo estribo φ36 engorda al subir de tamaño (M -> L -> XL): el trazo sigue a la escala');

// ── D · el interruptor metrico ───────────────────────────────────────────────
console.log('D · sin "los puntos están en cm" el φ NO se usa:');
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 16, false)), NOMINAL),
  'metrico=false (figura con radio / etiqueta-manda): trazo nominal, no el fisico');
ok(casi(sw(render(TRABA, D_TRABA, BM_TAM.xl, 32, false)), NOMINAL),
  'metrico=false tampoco deja llegar al tope con un φ grande');
ok(DIAMS.every(function (d) { return casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, d, false)), NOMINAL); }),
  'en la rama NO métrica los 10 φ dan EXACTAMENTE el mismo trazo (no hay grosor inventado)');

// ── E · retrocompatibilidad: sin los dos datos, nominal constante ────────────
console.log('E · sin φ (las 4 vistas sin barra detrás): trazo nominal constante:');
var SITIOS = [['preview Diseñador 210x140', { width: 210, height: 140, pad: 18 }],
              ['galería 90x72',             { width: 90,  height: 72,  pad: 12 }],
              ['preview 3D 210x140',        { width: 210, height: 140, pad: 18 }],
              ['ficha catálogo 130x86',    { width: 130, height: 86,  pad: 12 }],
              ['sin opts (default)',        {}]];
SITIOS.forEach(function (s) {
  ok(casi(sw(MOTOR.dibujarFigura(ESTRIBO, null, s[1])), NOMINAL), s[0] + ' = ' + NOMINAL);
});
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, null, true)), NOMINAL) &&
   casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, '', true)), NOMINAL) &&
   casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 0, true)), NOMINAL),
  'barra SIN φ cargado (null / vacío / 0) = nominal, no NaN ni 0');
ok(casi(sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, '16', true)),
        sw(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, 16, true))),
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
// El interruptor NO puede ser `escalable` a secas (auditoría 19-ago): se prende con UNA
// sola dim, y el backend guarda 0 —no NULL— en los lados que la figura no usa, así que un
// lado sin medida conserva su largo de GRILLA y la escala deja de ser px/cm. Medido antes
// del fix: dim_a=0 en BM XL daba sw 14.00 (el tope) donde tocaba el nominal 3.40, y dims
// vacías en AC2 daban 7.20/8.10. El guard `todoCm` es lo que se congela acá.
ok(/diam_mm:\s*b\.diam/.test(srcBM) && /metrico:\s*escalable\s*&&\s*todoCm/.test(srcBM),
  'barmanager.js (columna Render) pasa diam_mm y exige todoCm, no sólo escalable');
ok(/diam_mm:\s*b\.diam/.test(srcAC2) && /metrico:\s*\(?escalable\s*&&\s*todoCm\)?/.test(srcAC2),
  'agregar_cubicacion2.js (creador de despieces) exige lo mismo');
ok(/todoCm\s*=\s*false/.test(srcBM) && /todoCm\s*=\s*false/.test(srcAC2),
  'los dos apagan todoCm cuando un lado cae a su largo de grilla');
ok(srcBM.indexOf('_bmMiniFigura') === -1,
  '_bmMiniFigura (código muerto: 0 llamadas en todo el repo) no volvió a aparecer');

// ── G · convivencia: la barra no lleva nodos, y la punta va plana ────────────
console.log('G · nodos y puntas:');
function nCirculos(s) { return (s.match(/<circle/g) || []).length; }
// LOS NODOS SE FUERON DEL TODO (20-ago). Antes habia un <circle> r 2.5 en cada punta con
// la guarda "solo si sw < 5", que con la calibracion de ayer nunca se cumplia. Al bajar
// el trazo a la mitad esa guarda se habria ABIERTO sola y los bolones habrian vuelto —
// 5 px de diametro sobre un trazo de 2.75, y encima redondos, justo lo contrario de la
// punta plana que se pidio. Por eso se borro el bloque en vez de recalibrar el corte:
// aca se congela que ningun render vuelve a pintar un nodo sobre la barra.
[[16, true], [22, true], [36, true], [null, false]].forEach(function (c) {
  ok(nCirculos(render(ESTRIBO, D_ESTRIBO, BM_TAM.xl, c[0], c[1])) === 0,
    'φ' + (c[0] || '-') + ': ningun <circle> sobre la barra (el extremo del fierro es el corte, no un adorno)');
});
ok(nCirculos(MOTOR.dibujarFigura(ESTRIBO, null, { width: 220, height: 160, pad: 20 })) === 0,
  'y con el trazo nominal tampoco');
// LA PUNTA ES PLANA. Un fierro cortado no termina en semiesfera: linecap butt, no round.
// El linejoin SI sigue redondo (son las UNIONES, no las puntas): donde el codo no se
// dibuja —vuelta en U, codo sub-pixel, vertice contra un arco declarado— es lo unico que
// evita que vuelva el pico de flecha.
var svgPunta = MOTOR.dibujarFigura(ESTRIBO, null, { width: 220, height: 160, pad: 20 });
ok(/stroke-linecap="butt"/.test(svgPunta) && !/stroke-linecap="round"/.test(svgPunta),
  'el path de la barra sale con stroke-linecap="butt" (punta PLANA, no domo)');
ok(/stroke-linejoin="round"/.test(svgPunta),
  'y con stroke-linejoin="round": la union sigue redonda donde el codo no alcanza a entrar');
ok((srcMotor.match(/stroke-linecap="round"/g) || []).length === 0,
  'no queda ni un linecap redondo en el motor (el lienzo del Disenador dibuja el MISMO fierro)');

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
  ok(casi(r.d, 8.5 + r.sw / 2, 0.06),
    'φ' + (c[0] || '-') + ' (sw ' + r.sw + '): la letra va a 8.5 + sw/2 = ' + (8.5 + r.sw / 2).toFixed(2) +
    ' px del eje, o sea 10 px del BORDE del trazo con cualquier φ');
});

// ── H · la letra cabe entera: el encuadre le reserva sitio ───────────────────
console.log('H · el rotulo del lado NO se sale del recuadro (63 figuras x 10 encuadres x 3 φ):');
global.ModeladorCatalogoFiguras = require(path.join(DIR, 'modelador', 'catalogo_figuras.js'));
const FP = require(path.join(DIR, 'modelador', 'figura_puntos.js'));
const CATALOGO = global.ModeladorCatalogoFiguras.codigos().map(function (cod) {
  var tr = FP.derivarTramos(cod);
  return tr ? { codigo: cod, geometria: { dim: '2D', tramos: tr } } : null;
}).filter(Boolean);
// Los 11 encuadres vivos. Los de pad chico —galería y ficha del catálogo (12) y
// Fabricator S (11)— son los que cortaban letras: son la razón de ser de este bloque.
const ENCUADRES = [['galería', { width: 90, height: 72, pad: 12 }], ['ficha catálogo', { width: 130, height: 86, pad: 12 }],
  ['preview', { width: 210, height: 140, pad: 18 }],
  ['BM S', { width: 70, height: 52, pad: 20 }], ['BM M', { width: 110, height: 80, pad: 20 }],
  ['BM L', { width: 160, height: 118, pad: 20 }], ['BM XL', { width: 220, height: 160, pad: 20 }],
  ['Fab S', { width: 70, height: 52, pad: 11 }], ['Fab M', { width: 110, height: 80, pad: 18 }],
  ['Fab L', { width: 160, height: 118, pad: 26 }], ['Fab XL', { width: 220, height: 160, pad: 35 }]];
// Caja del glifo alrededor del ancla del <text>, con las métricas tipográficas usuales:
// ascendente 0.75 × fs y descendente 0.22 × fs, y la línea base va 3 px bajo el centro.
const RE_LETRA = /<text x="(-?[\d.]+)" y="(-?[\d.]+)" text-anchor="middle" fill="#00695c" font-size="11"[^>]*>([^<]*)<\/text>/g;
var rotulos = 0, cortados = [];
ENCUADRES.forEach(function (E) {
  [[null, false], [8, true], [36, true]].forEach(function (c) {
    CATALOGO.forEach(function (f) {
      var s = MOTOR.dibujarFigura(f.geometria, null,
        Object.assign({ diam_mm: c[0], metrico: c[1] }, E[1]));
      var m; RE_LETRA.lastIndex = 0;
      while ((m = RE_LETRA.exec(s))) {
        rotulos++;
        var x = Number(m[1]), base = Number(m[2]), hw = 0.30 * 11 * m[3].length;
        var d = Math.max(hw - x, 8.25 - base, x + hw - E[1].width, base + 2.42 - E[1].height);
        if (d > 0) cortados.push(E[0] + '/' + f.codigo + ' "' + m[3] + '" ' + d.toFixed(2) + ' px');
      }
    });
  });
});
ok(rotulos > 1800, 'el barrido midió ' + rotulos + ' rótulos (no está corriendo sobre una lista vacía)');
ok(cortados.length === 0, 'ninguna letra se sale del viewBox' + (cortados.length ? ' (' + cortados.length + '): ' + cortados.slice(0, 5).join(', ') : ''));
// Y la reserva NO se aplica donde no hay letra que dibujar: en modo etiqueta-manda
// (labels_auto:false) el pad es el que pidió el llamador, así que la figura NO se achica.
function anchoFigura(o) {
  // Ancho de la figura DIBUJADA: los puntos que alcanza el path (M/L/A), no el viewBox.
  var d = /<path d="([^"]*)" fill="none" stroke="#00695c"/.exec(MOTOR.dibujarFigura(ESTRIBO, null, o))[1];
  var t = d.replace(/,/g, ' ').trim().split(/\s+/), i = 0, xs = [];
  while (i < t.length) {
    var c = t[i++];
    if (c === 'M' || c === 'L') { xs.push(Number(t[i++])); i++; }
    else if (c === 'A') { i += 5; xs.push(Number(t[i++])); i++; }
  }
  return Math.max.apply(null, xs) - Math.min.apply(null, xs);
}
var MINI_CAT = { width: 90, height: 72, pad: 12 };
ok(anchoFigura(Object.assign({ labels_auto: false }, MINI_CAT)) > anchoFigura(MINI_CAT) + 5,
  'sin letras que dibujar (etiqueta-manda) la figura ocupa más: la reserva sólo entra si hay rótulo');

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos ? 1 : 0);
