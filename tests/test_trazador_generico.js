// =============================================================================
// TRAZADOR GENÉRICO DE CADENAS — test headless (Node)
// =============================================================================
// Qué protege, en orden:
//   A. CONVENCIÓN (piloto obligatorio): la cadena DERIVADA de 101A/102A/103A/103B
//      reproduce la misma forma que los constructores especializados de hoy. Es la
//      prueba de que el trazador genérico NO inventó una convención paralela: usa
//      la del Diseñador de figuras (giro/sentido) y el plano de trabajo del cabezal.
//   B. 104B — el caso que reportó el usuario: 4 lados y 45° en los DOS extremos
//      (hoy se dibujaba como estribo cerrado, que es una figura que no existe).
//   C. COMPOSICIÓN: dos cadenas de 4 y 5 lados pasan por capas / anidado /
//      volteo / de pie / spin / rango sin tocar esa maquinaria.
//   D. RESCATE: cuántas de las excluidas vuelven a ser dibujables (y las que no,
//      con motivo).
//   E. MH/MV nacen en modo DISTRIBUCIÓN ('lineal').
//   F. SEMILLA: 72 barras / 4 ítems y 136.1 kg (bajó de 140.2 al migrar el cabezal
//      al trazador — el CBS 103B pasa a honrar sus 45°; ver la nota de F).
//
// Correr con: node tests/test_trazador_generico.js

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorCatalogoFiguras = require(path.join(base, 'catalogo_figuras.js'));
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));
const S = require(path.join(base, 'semilla_viga.js'));
const FP = global.ModeladorFiguraPuntos;
const CAT = global.ModeladorCatalogoFiguras;
const R = global.ModeladorReglas;

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

const HOST = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const ANCH = { cara: 'sup', y: 26, z: 0, recubExtremo: 4 };

function eqPts(a, b, tol) {
  tol = tol || 1e-9;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i].x - b[i].x) > tol || Math.abs(a[i].y - b[i].y) > tol ||
        Math.abs(a[i].z - b[i].z) > tol) return false;
  }
  return true;
}
function fmt(pts) {
  return pts.map(p => '(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ',' + p.z.toFixed(1) + ')').join(' ');
}
// Ángulos de GIRO de una polilínea 3D (cuánto se desvía de seguir recta en cada
// vértice). Sirve para verificar los dobleces sin depender del sistema local.
function girosDe(pts) {
  const out = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = { x: pts[i].x - pts[i - 1].x, y: pts[i].y - pts[i - 1].y, z: pts[i].z - pts[i - 1].z };
    const b = { x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y, z: pts[i + 1].z - pts[i].z };
    const la = Math.hypot(a.x, a.y, a.z), lb = Math.hypot(b.x, b.y, b.z);
    const c = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
    out.push(Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI);
  }
  return out;
}
// Largo de cada tramo de la polilínea.
function largosDe(pts) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    out.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z));
  }
  return out;
}

// ---------------------------------------------------------------------------
// A. PILOTO DE CONVENCIÓN — la derivación reproduce los constructores de hoy
// ---------------------------------------------------------------------------
// Se traza CADA figura con su constructor especializado (el que la dibuja hoy en
// producción) y con el trazador genérico alimentado por la cadena DERIVADA, y se
// comparan punto a punto. Si la convención de giro/sentido o el plano de trabajo
// no coincidieran, esto explota.
console.log('A — piloto de convención (derivación vs constructores actuales):');
const PILOTO = [
  { fig: '101A', dims: { A: 592 } },
  { fig: '102A', dims: { A: 30, B: 592 } },
  { fig: '103A', dims: { A: 30, B: 592, C: 30 } },
];
PILOTO.forEach(function (cs) {
  const esp = FP._cabezalLongitudinal(cs.fig, cs.dims, HOST, ANCH, 1.6);
  const gen = FP._cadenaGenerica(cs.fig, cs.dims, HOST, ANCH, 1.6);
  ok(eqPts(esp, gen), cs.fig + ': cadena derivada IDÉNTICA al constructor (' + fmt(gen) + ')');
});

// 103B declara ángulos 45/45 en el catálogo. El constructor de cabezal los IGNORA
// (dibuja las patas a 90°, como una 103A); el genérico los HONRA. La convención se
// verifica igual: con los ángulos quitados el trazado es idéntico al constructor,
// y con ellos puestos sólo cambia el doblez declarado — el tramo largo queda en el
// mismo sitio y las patas siguen midiendo lo suyo y mirando al núcleo.
(function () {
  const dims = { A: 30, B: 592, C: 30 };
  const esp = FP._cabezalLongitudinal('103B', dims, HOST, ANCH, 1.6);
  const gen = FP._cadenaGenerica('103B', dims, HOST, ANCH, 1.6);
  // (a) misma convención: sin ángulos declarados, trazado byte-idéntico.
  const specB = CAT.get('103B'), angsB = specB.angulos;
  specB.angulos = [];
  const genSinAng = FP._cadenaGenerica('103B', dims, HOST, ANCH, 1.6);
  specB.angulos = angsB;
  ok(eqPts(esp, genSinAng), '103B sin sus ángulos: cadena derivada IDÉNTICA al constructor');
  // (b) con los ángulos del catálogo: el tramo largo NO se mueve.
  ok(gen.length === 4 && Math.abs(gen[1].x + 296) < 1e-9 && Math.abs(gen[2].x - 296) < 1e-9,
    '103B: tramo B centrado en ±296 igual que el cabezal');
  const lg = largosDe(gen);
  ok(Math.abs(lg[0] - 30) < 1e-9 && Math.abs(lg[1] - 592) < 1e-9 && Math.abs(lg[2] - 30) < 1e-9,
    '103B: los 3 lados miden A=30 · B=592 · C=30 (=' + lg.map(v => v.toFixed(1)).join('/') + ')');
  ok(gen[0].y < gen[1].y && gen[3].y < gen[2].y,
    '103B: las dos patas doblan hacia el NÚCLEO (cara sup → hacia abajo)');
  const gg = girosDe(gen);
  ok(gg.every(a => Math.abs(a - 45) < 1e-6),
    '103B: los dobleces valen los 45° que declara el catálogo, no 90 (=' +
    gg.map(a => a.toFixed(0)).join('/') + '°) — el cabezal los ignoraba');
})();

console.log('\nA2 — el genérico NO desplaza a los constructores especializados:');
// MIGRACIÓN CABEZAL → TRAZADOR: las de 2–3 lados SÍ pasaron al genérico, y esa es
// la tarea. El motivo está medido justo arriba, en el piloto A: el constructor de
// cabezal dibuja los dobleces a 90° FIJOS, así que la 103B salía sin sus 45° y la
// 103C salía byte-idéntica a una 103A, sin su gancho. El piloto también prueba lo
// otro: para las figuras SIN ángulos declarados (101A/102A/103A) las dos rutas dan
// la MISMA polilínea, así que migrar no cambia el dibujo donde ya era correcto.
// Lo que NO se movió —y es lo que este assert sigue protegiendo— son los otros dos
// constructores especializados: la RECTA de 1 lado y el MARCO CERRADO de 4.
ok(FP.familiaDeDibujo('101A', null) === 'recta' && FP.familiaDeDibujo('102A', null) === 'cadena' &&
   FP.familiaDeDibujo('103B', null) === 'cadena' && FP.familiaDeDibujo('104D', null) === 'estribo',
  '1 lado → recta · 2-3 → cadena (migradas) · marco de 4 → estribo (sin cambios)');
// LA 103C ES EL CASO QUE REPORTÓ EL USUARIO: «una 103C se dibuja idéntica a una
// 103A, sin su gancho». El catálogo le declara un doblez de 45° (ang1) y el otro
// queda en 90 por derivación; el cabezal los pisaba con 90/90.
(function () {
  const dims = { A: 30, B: 592, C: 30 };
  const a103 = FP.figuraAPuntos('103A', dims, HOST, ANCH, { rol: 'cabezal', diamCm: 1.6 });
  const c103 = FP.figuraAPuntos('103C', dims, HOST, ANCH, { rol: 'cabezal', diamCm: 1.6 });
  ok(!eqPts(a103, c103, 1e-6),
    '103C ya NO se dibuja igual que una 103A (el bug reportado: mismo trazo para dos figuras distintas)');
  const gA = girosDe(a103), gC = girosDe(c103);
  ok(gA.every(a => Math.abs(a - 90) < 1e-6),
    '103A: sus dos dobleces son de 90° (=' + gA.map(a => a.toFixed(0)).join('/') + '°)');
  ok(Math.abs(gC[0] - 45) < 1e-6 && Math.abs(gC[1] - 90) < 1e-6,
    '103C: el gancho de 45° que declara el catálogo SÍ se dibuja, y el otro extremo sigue a 90° (=' +
    gC.map(a => a.toFixed(0)).join('/') + '°)');
})();
ok(FP.familiaDeDibujo('104D', 'estribo') === 'estribo' && FP.familiaDeDibujo('104D', 'traba') === 'estribo' &&
   FP.familiaDeDibujo('103E', 'estribo') === 'estribo',
  'el ROL sigue mandando sobre la familia cuando la FIGURA es un marco (104D, con ' +
  'CUALQUIER rol de sección) o no tiene cadena que la reemplace (103E con rol estribo)');
// FEEDBACK 13-ago — la TRABA con figura de 3+ lados también se traza como CADENA
// (mismo criterio que el 305A del estribo): `_traba` dibuja una única forma fija
// que sólo aproxima 101x/102x; con una 104B la ignoraba y el 'auto' resolvía las
// 4 dims al alto útil (medido: TC 104B del muro = 244×4, dibujada plana).
// ASSERT CAMBIADO (14-ago): la «forma clásica» de 101x/102x era la forma FIJA
// que ignoraba el trazo real (una 102A se veía como 103C) y dibujaba ganchos que
// no se facturaban. Hoy TODA figura con tramos es cadena; el giro por regla
// geométrica (_giroTraba) la orienta al cruce.
ok(FP.familiaDeDibujo('105A', 'traba') === 'cadena' && FP.familiaDeDibujo('104B', 'traba') === 'cadena' &&
   FP.familiaDeDibujo('101A', 'traba') === 'cadena' && FP.familiaDeDibujo('102A', 'traba') === 'cadena',
  'traba: TODA figura con tramos dibuja SU trazo (cadena) — la forma fija murió');
// CAMBIO TANDA P (fix 305A) — el rol 'estribo' YA NO fuerza el marco cerrado sobre
// una figura que NO es un marco: la 104B (4 lados con quiebres de 45°) colocada con
// tipología ES se dibujaba como rectángulo con ganchos, o sea una figura que no
// existe. Ahora se traza como cadena (en el plano de la SECCIÓN, ver E3); el rol
// sigue mandando anclaje, reparto y preset.
ok(FP.familiaDeDibujo('104B', 'estribo') === 'cadena',
  '104B con rol estribo → cadena (la FIGURA manda el trazado, no el rol)');
(function () {
  // El estribo real, con sus arcos calibrados, no cambió ni un punto.
  const est = FP.figuraAPuntos('104D', { A: 22, B: 52, C: 22, D: 52 }, HOST, { x: 10, recub: 3 },
    { rol: 'estribo', diamCm: 0.8 });
  ok(est.length >= 15 && est.some(p => p.esArco), 'el estribo 104D sigue saliendo del marco con arcos explícitos');
})();
// ASSERT CAMBIADO (14-ago): la "ruta histórica" (marco bajo rol cabezal dibujado
// como corchete de 3 lados) ERA la tipología pisando a la topología — la misma
// inconsistencia que mandó la 106A bajo MH al plano equivocado. La regla del
// usuario no se negocia: CERRADA = marco, venga el rol que venga, y esta función
// tiene que contestar lo mismo con o sin rol (el motor ya re-derivaba el rol por
// topología; ahora el clasificador dice lo mismo para TODOS los llamadores).
ok(FP.familiaDeDibujo('104A', 'cabezal') === 'estribo' && FP.familiaDeDibujo('104D', 'cabezal') === 'estribo',
  'un marco de 4 lados es MARCO también bajo rol cabezal (la topología no se negocia)');
ok(FP.familiaDeDibujo('104B', 'cabezal') === 'cadena',
  'y la cadena abierta de 4 lados sí va al genérico, con o sin rol');

// ---------------------------------------------------------------------------
// B. 104B — el caso del usuario
// ---------------------------------------------------------------------------
console.log('\nB — 104B (4 lados, ángulos 45/45):');
ok(FP.familiaDeDibujo('104B', null) === 'cadena',
  '104B YA NO se dibuja como estribo cerrado: es cadena abierta (familia=' +
  FP.familiaDeDibujo('104B', null) + ')');
(function () {
  const dims = { A: 30, B: 592, C: 30, D: 40 };
  const pts = FP.figuraAPuntos('104B', dims, HOST, ANCH, { rol: 'cabezal', diamCm: 1.6 });
  ok(pts.length === 5, '104B traza sus 4 lados (5 puntos, =' + pts.length + ')');
  const lg = largosDe(pts);
  ok(Math.abs(lg[0] - 30) < 1e-9 && Math.abs(lg[1] - 592) < 1e-9 &&
     Math.abs(lg[2] - 30) < 1e-9 && Math.abs(lg[3] - 40) < 1e-9,
    'los 4 lados miden A/B/C/D del catálogo (=' + lg.map(v => v.toFixed(0)).join('/') + ')');
  const gg = girosDe(pts);
  ok(Math.abs(gg[0] - 45) < 1e-6 && Math.abs(gg[2] - 45) < 1e-6,
    '45° en los DOS dobleces EXTREMOS (=' + gg[0].toFixed(0) + '° / ' + gg[2].toFixed(0) + '°)');
  ok(Math.abs(gg[1] - 90) < 1e-6, '90° en el doblez INTERMEDIO (=' + gg[1].toFixed(0) + '°)');
  // CENTRADO POR BBOX (fix del reparo B del verificador): la PIEZA COMPLETA queda
  // centrada, no el tramo B — con la pata A inclinada a 45° el sobre inicial es
  // 30·cos45 = 21.213 y el final 0 (C sale perpendicular y D vuelve hacia atrás),
  // así que el bbox mide 592+21.213 = 613.213 y B corre de −285.393 a +306.607.
  // (Con dims FIJAS que exceden la luz libre, la pieza asoma PAREJO por ambos
  // lados — dato honesto; el auto-largo sí reserva los sobres y cabe exacto.)
  const bbIni = 30 * Math.SQRT1_2;                       // 21.2132…
  const bbMitad = (592 + bbIni) / 2;                     // 306.6066…
  const xsTodos = pts.map(p => p.x);
  ok(Math.abs(Math.min(...xsTodos) + bbMitad) < 1e-6 && Math.abs(Math.max(...xsTodos) - bbMitad) < 1e-6,
    'la PIEZA COMPLETA queda centrada (bbox ±' + bbMitad.toFixed(3) + ', no el tramo B)');
  ok(Math.abs((pts[2].x - pts[1].x) - 592) < 1e-9, 'B sigue midiendo 592');
  ok(pts.every(p => p.y <= 26 + 1e-9), 'toda la figura dobla hacia el núcleo (cara sup: y ≤ 26)');
  const inf = FP.cadenaInfo('104B', dims);
  ok(inf.fuente === 'derivado' && inf.cerrada === false && inf.ladoLong === 'B',
    'cadenaInfo: fuente=derivado · cerrada=false · ladoLong=B');
})();

// La derivación es la SEGUNDA fuente: si la figura se dibujó en el Diseñador, mandan
// SUS tramos (mismo campo `geometria` que ya consume la caluga 2D del catálogo).
console.log('\nB2 — prioridad de fuentes (geometría del diseñador > derivación):');
(function () {
  const spec = CAT.get('104B');
  const antes = spec.geometria;
  spec.geometria = { dim: '2D', tramos: [
    { lado: 'A', giro: 0, sentido: null },
    { lado: 'B', giro: 90, sentido: 'izq' },
    { lado: 'C', giro: 90, sentido: 'izq' },
    { lado: 'D', giro: 90, sentido: 'izq' }
  ] };
  const inf = FP.cadenaInfo('104B', { A: 30, B: 592, C: 30, D: 40 });
  ok(inf.fuente === 'disenador', 'con geometría dibujada la fuente pasa a ser el diseñador');
  const pts = FP.figuraAPuntos('104B', { A: 30, B: 592, C: 30, D: 40 }, HOST, ANCH,
    { rol: 'cabezal', diamCm: 1.6 });
  const gg = girosDe(pts);
  ok(gg.every(a => Math.abs(a - 90) < 1e-6),
    'y los dobleces son los DIBUJADOS (90/90/90), no los derivados (45/90/45)');
  spec.geometria = antes;
  ok(FP.cadenaInfo('104B').fuente === 'derivado', 'al quitar la geometría vuelve la derivación');
})();

// ---------------------------------------------------------------------------
// C. COMPOSICIÓN — la cadena es un constructor más
// ---------------------------------------------------------------------------
console.log('\nC — composición (capas · anidado · volteo · de pie · spin · rango):');
const GEO = { largo: 600, ancho: 30, alto: 60, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const CTX = { sector: 'S1', ciclo: 'C1', piso: 'P1', eje: 'E1' };

function compCadena(fig, extra) {
  const spec = CAT.get(fig);
  const dims = {};
  spec.parciales.forEach(function (L) {
    dims[L] = (L === 'B') ? { modo: 'auto' } : { modo: 'fija', valor: 30 };
  });
  return Object.assign({
    comp_id: fig, tipologia: 'CBS', figura: fig, diam: 16, cara: 'sup', suf_tipo: '',
    dims: dims,
    distribucion: { modo: 'layered', n_capas: 2, barras_capa: 3, gap: 5, sentido: 'nucleo' }
  }, extra || {});
}

// C1 · 104B (4 lados) y 105C (5 lados, ángulos 45/45) en capas.
['104B', '105C'].forEach(function (fig) {
  const out = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [compCadena(fig)] }, CTX);
  const nl = CAT.get(fig).parciales.length;
  ok(out.placements.length === 6, fig + ': 2 capas × 3 barras = 6 placements (=' + out.placements.length + ')');
  ok(out.placements.every(p => p.puntos.length === nl + 1),
    fig + ': cada barra trae sus ' + nl + ' lados dibujados');
  ok(out.barras.length > 0 && out.resumen.kg > 0,
    fig + ': genera payload con kg > 0 (=' + out.resumen.kg + ' kg)');
  ok(!(out.componentes && out.componentes[0] && out.componentes[0]._avisos),
    fig + ': sin avisos de "lados no trazados"');
  // Capas: la 2ª va 5 cm más adentro que la 1ª (el campo Sep manda).
  const ys = out.placements.map(p => p.puntos[1].y);
  const y1 = Math.max.apply(null, ys), y2 = Math.min.apply(null, ys);
  ok(Math.abs((y1 - y2) - 5) < 1e-6, fig + ': la 2ª capa entra 5 cm al núcleo (=' + (y1 - y2).toFixed(2) + ')');
});

// C2 · ANIDADO topológico (vecinos) sobre una cadena abierta de 5 lados: los lados
// INTERIORES se achican 2δ y los EXTREMOS quedan intactos. No se tocó nada de esa
// maquinaria: la cadena entra por la misma puerta que el corchete.
(function () {
  const dims = { A: 30, B: 300, C: 30, D: 30, E: 30 };
  const an = FP.anidarFigura('105C', dims, 1.6, 'cabezal', {});
  ok(an.criterio === 'abierta', '105C anida como cadena ABIERTA (=' + an.criterio + ')');
  ok(an.dims.A === 30 && an.dims.E === 30, 'los lados EXTREMO (A/E) quedan intactos');
  ok(Math.abs(an.dims.B - (300 - 3.2)) < 1e-9 && Math.abs(an.dims.C - (30 - 3.2)) < 1e-9,
    'los INTERIORES (B/C/D) se achican 2δ (=' + an.dims.B + '/' + an.dims.C + ')');
  ok(an.vecinos.A === 1 && an.vecinos.C === 2 && an.vecinos.E === 1, 'vecinos: A=1 · C=2 · E=1');
  ok(FP.figuraCerrada('104A') === true && FP.figuraCerrada('104B') === false,
    'figuraCerrada: 104A (marco) sí · 104B (cadena con quiebres) no');
})();

// C3 · VOLTEO / DE PIE / SPIN / RANGO sobre la cadena de 5 lados.
(function () {
  // DIMS FIJAS a propósito: con dims 'auto' el volteo cambia el marco útil (y por
  // lo tanto el largo del lado longitudinal), y lo que se quiere aislar acá es la
  // POSE. Con las dims declaradas, la MISMA figura tiene que salir con los mismos
  // largos en las tres orientaciones.
  const DIMS_FIJAS = { A: 30, B: 300, C: 30, D: 25, E: 25 };
  function puntosDe(extra) {
    const dims = {};
    Object.keys(DIMS_FIJAS).forEach(L => { dims[L] = { modo: 'fija', valor: DIMS_FIJAS[L] }; });
    const c = Object.assign(compCadena('105C'), { dims: dims,
      distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' } }, extra || {});
    return G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [c] }, CTX).placements;
  }
  const plano = puntosDe();
  const volt = puntosDe({ plano_pieza: { volteado: true } });
  const pie = puntosDe({ plano_pieza: { orientacion: 'de_pie' } });
  ok(plano.length === 1 && volt.length === 1 && pie.length === 1, 'las 3 orientaciones colocan la barra');
  ok(volt[0].puntos.length === 6 && pie[0].puntos.length === 6,
    'volteada y de pie conservan los 5 lados (6 puntos)');
  const lp = largosDe(plano[0].puntos), lv = largosDe(volt[0].puntos), lpie = largosDe(pie[0].puntos);
  ok(lp.length === lv.length && lp.every((v, i) => Math.abs(v - lv[i]) < 1e-6),
    'el VOLTEO no cambia los largos de los lados, sólo el plano (' + lp.map(v => v.toFixed(0)).join('/') + ')');
  ok(lpie.every((v, i) => Math.abs(v - lp[i]) < 1e-6), 'DE PIE tampoco cambia los largos');
  ok(!eqPts(plano[0].puntos, volt[0].puntos, 1e-6), 'pero sí cambia la pose (no es un no-op)');
  ok(!eqPts(plano[0].puntos, pie[0].puntos, 1e-6), 'de pie también cambia la pose');
  // SPIN: giro de la barra sobre su propio eje longitudinal (patas direccionales).
  const spin = puntosDe({ orient: { eje: 'x', spin: 90 } });
  const ls = largosDe(spin[0].puntos);
  ok(ls.every((v, i) => Math.abs(v - lp[i]) < 1e-6), 'el SPIN tampoco cambia los largos');
  ok(!eqPts(plano[0].puntos, spin[0].puntos, 1e-6), 'y sí gira la figura');
  // RANGO: un longitudinal reparte sus copias a lo ANCHO (eje z); la cadena se
  // copia igual que cualquier otra barra.
  const rango = puntosDe({ distribucion: { modo: 'linear', rango: { from: -10, to: 10, eje: 'z' }, sep: 5 } });
  ok(rango.length === 5, 'rango −10→10 @5 en z coloca 5 copias de la cadena (=' + rango.length + ')');
  ok(rango.every(p => p.puntos.length === 6), 'las 5 copias traen los 5 lados');
  ok(rango.every((p, i) => Math.abs(p.puntos[0].z - (-10 + i * 5)) < 1e-6),
    'y quedan repartidas @5 exactos en z');
})();

// C4 · PILAS POR CARA / JERARQUÍA: la cadena se ancla contra la pila de su nivel,
// como cualquier otra barra (no hubo que tocar nada de esa maquinaria).
(function () {
  function yTramo(nivel) {
    const out = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [
      { comp_id: 'est', tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral', jerarquia: 1,
        dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
        distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 200 }], start_offset: 4 } },
      Object.assign(compCadena('105C'), { comp_id: 'cad', jerarquia: nivel,
        distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' } })
    ] }, CTX);
    return out.placements.filter(p => p.comp_id === 'cad')[0].puntos[1].y;
  }
  ok(Math.abs((yTramo(1) - yTramo(2)) - 0.8) < 1e-6,
    'la cadena de nivel 2 entra el φ del estribo (0.8) bajo la de nivel 1 (=' +
    (yTramo(1) - yTramo(2)).toFixed(2) + ')');
})();

// C5 · CADENA CERRADA (contorno de 5 lados dibujado en el Diseñador): SIN
// auto-largo y SIN empalme, igual que el estribo — su largo lo fija el contorno,
// no hay un lado que estirar a lo largo de la pieza.
(function () {
  const spec = CAT.get('105A');
  const antes = spec.geometria;
  // Pentágono: 5 lados iguales girando 72° siempre para el mismo lado → cierra.
  spec.geometria = { dim: '2D', tramos: ['A', 'B', 'C', 'D', 'E'].map(function (L, i) {
    return { lado: L, giro: i === 0 ? 0 : 72, sentido: i === 0 ? null : 'izq' };
  }) };
  const dimsIg = { A: 40, B: 40, C: 40, D: 40, E: 40 };
  const inf = FP.cadenaInfo('105A', dimsIg);
  ok(inf.cerrada === true, 'el contorno de 5 lados iguales CIERRA (=' + inf.cerrada + ')');
  ok(inf.ladoLong === null, 'una cadena cerrada no declara lado longitudinal (=' + inf.ladoLong + ')');
  const comp = compCadena('105A', {
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' },
            D: { modo: 'auto' }, E: { modo: 'auto' } },
    empalme: { extremo: 'ambos', valor: 50 },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' }
  });
  const out = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [comp] }, CTX);
  const b = out.barras[0];
  ok(b && b.dim_b < 100, 'con dims auto NINGÚN lado se estira al largo de la viga (dim_b=' +
    (b || {}).dim_b + ' cm, no 592)');
  const pts = out.placements[0].puntos;
  const d = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y,
    pts[0].z - pts[pts.length - 1].z);
  ok(d < 1e-6, 'la polilínea trazada vuelve a su punto de partida (cierre = ' + d.toExponential(1) + ')');
  const lgc = largosDe(pts);
  ok(lgc.every(v => Math.abs(v - lgc[0]) < 1e-6),
    'y los 5 lados salen iguales: el empalme NO alarga nada (=' + lgc.map(v => v.toFixed(1)).join('/') + ')');
  spec.geometria = antes;
})();

// ---------------------------------------------------------------------------
// D. RESCATE — cuántas excluidas vuelven
// ---------------------------------------------------------------------------
console.log('\nD — figuras rescatadas del limbo de "no dibujable":');
const noDib = CAT.noDibujables();
const dib = CAT.dibujables();
const nSeed = CAT.codigos().length;
const porFamilia = {};
dib.forEach(function (c) {
  const f = FP.dibujabilidad(c).familia;
  porFamilia[f] = (porFamilia[f] || 0) + 1;
});
console.log('  · catálogo: ' + nSeed + ' figuras → ' + dib.length + ' dibujables / ' +
  Object.keys(noDib).length + ' excluidas');
console.log('  · por familia: ' + JSON.stringify(porFamilia));
console.log('  · excluidas: ' + JSON.stringify(noDib));
ok(dib.length + Object.keys(noDib).length === nSeed, 'toda figura sigue clasificada (dibujable o con motivo)');
// MIGRACIÓN CABEZAL → TRAZADOR: 36 → 51. Las 15 que entran son las de 2–3 lados
// que antes dibujaba el constructor de cabezal a 90° fijos, ignorando los ángulos
// del catálogo (la 103C, que declara un doblez de 45°, salía con la MISMA
// polilínea que la 103A). Las otras dos familias no se mueven: 1 recta (no hay
// doblez que honrar) y 10 marcos cerrados (constructor propio con arcos).
// CORRECCIÓN 14-ago: las 4 figuras 106x salieron de la cadena — son ESTRIBOS
// con ganchos declarados (el marco manda), no cadenas. 51 − 4 = 47.
ok(porFamilia.cadena === 47, 'el trazador genérico se hace cargo de 47 figuras (=' + porFamilia.cadena + ')');
ok(porFamilia.recta === 1 && porFamilia.estribo === 14 && !porFamilia.cabezal,
  'y ya no queda NINGUNA figura del catálogo en la familia cabezal (1 recta + 14 estribos + 47 cadenas = 62) (=' +
  JSON.stringify(porFamilia) + ')');
ok(Object.keys(noDib).length === 1 && noDib['201A'] && /radio/.test(noDib['201A']),
  'sólo queda excluida 201A, y por RADIO (hélice/espiral) — motivo claro');
ok(!noDib['105A'] && !noDib['106A'] && !noDib['305A'],
  '105A / 106A / 305A rescatadas (5 y 6 tramos, antes excluidas por nº de lados)');
// Lo que el genérico NO sabe trazar sigue diciéndolo, no aproximándolo: una cadena
// con un tramo en ARCO (curva dibujada en el Diseñador) se excluye con motivo.
(function () {
  const spec = CAT.get('105D');
  const antes = spec.geometria;
  spec.geometria = { dim: '2D', tramos: [
    { lado: 'A', giro: 0, sentido: null }, { lado: 'B', giro: 90, sentido: 'izq' },
    { lado: 'C', giro: 0, sentido: null, tipo: 'arco', radio: 12 },
    { lado: 'D', giro: 90, sentido: 'izq' }, { lado: 'E', giro: 90, sentido: 'izq' }
  ] };
  const d = FP.dibujabilidad('105D');
  ok(d.dibujable === false && /ARCO/.test(d.motivo),
    'una cadena con tramo en ARCO se excluye con motivo (=' + d.motivo + ')');
  spec.geometria = antes;
  ok(FP.dibujabilidad('105D').dibujable === true, 'y al quitar el arco vuelve a ser dibujable');
})();
// El rescate real contra el criterio ANTERIOR (>4 lados o marco falso):
const rescatadas = CAT.codigos().filter(c => FP.dibujabilidad(c).familia === 'cadena' &&
  CAT.get(c).parciales.length > FP.MAX_LADOS_DIBUJABLES);
// 25 rescatadas − las 4 106x que ahora van por MARCO = 21 siguen por la cadena.
ok(rescatadas.length === 21, '21 figuras de 5–6 lados dibujables por la CADENA (las 106x van por marco) (=' +
  rescatadas.length + ')');

// Cada rescatada produce payload válido y kg > 0 (no hay dibujo sin despiece).
(function () {
  let malas = [];
  rescatadas.forEach(function (fig) {
    const out = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [compCadena(fig, {
      distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' }
    })] }, CTX);
    const b = out.barras[0];
    const n = CAT.get(fig).parciales.length;
    // TANDA V: un gancho terminal >90° reemplaza su VÉRTICE por un ARCO
    // muestreado (racha de puntos esArco). "Dibuja todos sus lados" ahora es:
    // vértices rectos + una racha de arco por gancho = los n+1 de la cadena.
    // (Sin ganchos >90° no hay rachas y la cuenta es la de antes: n+1 exacto.)
    const pts = out.placements[0].puntos;
    let rectos = 0, rachas = 0;
    pts.forEach((p, i) => {
      if (!p.esArco) rectos++;
      else if (!i || !pts[i - 1].esArco) rachas++;
    });
    if (!b || !(out.resumen.kg > 0) || (rectos + rachas) !== n + 1) malas.push(fig);
  });
  ok(malas.length === 0, 'las 25 generan barra, pesan y dibujan todos sus lados (ganchos >90° en arco)' +
    (malas.length ? ' — fallan ' + malas.join(',') : ''));
})();

// ---------------------------------------------------------------------------
// E. MH / MV — modo DISTRIBUCIÓN
// ---------------------------------------------------------------------------
console.log('\nE — mallas de muro:');
ok(R.modoDefaultDeTipologia('MH') === 'lineal' && R.modoDefaultDeTipologia('MV') === 'lineal',
  'MH y MV nacen en modo lineal (distribución), no arreglo ni puntual');
ok(CAT.TIPOLOGIAS.MURO.some(t => t.codigo === 'MH') && CAT.TIPOLOGIAS.MURO.some(t => t.codigo === 'MV'),
  'MH/MV son los códigos REALES del catálogo de tipologías de MURO');
(function () {
  const c = R.normalizarComponente({ tipologia: 'MV', figura: '101A', diam: 10 });
  ok(c.modo === 'lineal', 'normalizarComponente estampa modo=lineal en una MV nueva');
})();
ok(R.modoDefaultDeTipologia('ES') === 'lineal' && R.modoDefaultDeTipologia('CBS') === 'puntual',
  'los modos de las demás tipologías no se movieron (ES lineal · CBS puntual)');

// ---------------------------------------------------------------------------
// F. SEMILLA INTACTA
// ---------------------------------------------------------------------------
console.log('\nF — viga-semilla (listado intacto, kg re-derivado):');
// MIGRACIÓN CABEZAL → TRAZADOR: 140.2 → 136.1 kg. Su CBS es una 103B, y el
// catálogo le declara dobleces de 45°/45° que el cabezal ignoraba. Honrándolos,
// cada pata de 30 proyecta 30·cos45 = 21.2132 sobre el eje del cuerpo y la cresta
// del codo se retira φ/2 = 0.8 del recub de extremo, así que el auto-largo reserva
// 22.0132 por punta: B = 592 − 44.0264 = 547.974 y el largo del CBS 652 → 607.974
// (6 barras φ16: 61.745 → 57.575 kg). Con B = 592 la barra medía el largo útil
// entero y encima le colgaban dos patas que avanzaban 21.2 cm más: asomaba fuera
// del hormigón por los dos extremos. Ítems y barras no se mueven.
const semilla = G.generarViga(S.semillaViga(), CTX);
ok(semilla.resumen.items === 4 && semilla.resumen.barras === 72 && semilla.resumen.kg === 136.1,
  'semilla = {items:4, barras:72, kg:136.1} (=' + JSON.stringify(semilla.resumen) + ')');
const cbs = semilla.barras.filter(b => b.marca === 'CBS')[0];
ok(cbs && Math.abs(cbs.dim_b - (592 - 2 * (30 * Math.SQRT1_2 + 0.8))) < 1e-6 &&
   cbs.dim_a === 30 && cbs.dim_c === 30,
  'y el número que se movió es UNO: B del CBS = 592 − 2·22.0132 = 547.974, patas 30/30 intactas (=' +
  (cbs || {}).dim_b + ')');

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos ? 1 : 0);
