// Test headless (Node) de los TECHOS DE GENERACIÓN del motor (Tanda 3, punto 2:
// "capear el motor ANTES de generar"). Hasta ahora el warning anti-colapso se
// emitía DESPUÉS de generar: un @ de 0.1 en un rango de 600 pedía 6001 barras
// (× capas) y el navegador se congelaba antes de poder verlo.
//
// CONTRATOS QUE FIJA:
//   P0 · redondeoCantidadZona con @ ≤ 0 / NaN / basura → 1 (nunca ∞ ni NaN).
//   P1 · posicionesRango corta en TOPE_PLACEMENTS_COMP (2000) y deja la marca
//        `_tope` NO ENUMERABLE (no puede ensuciar la receta ni el dirty-tracking).
//   P2 · los distribuidores con rango / zonas / tramos DEJAN DE EMITIR en el tope
//        y lo escriben en comp._avisos (el mismo canal de las capas omitidas).
//        NO es una defensa que enmascara: la barra truncada NO se dibuja, y el
//        porqué — con el @ que lo causó — queda a la vista.
//   P3 · n_capas tiene techo duro TOPE_CAPAS_COMP (200) en layered y en arreglo,
//        con su propio aviso.
//   P4 · UN USO NORMAL (46 barras, capas de verdad) NO roza ningún tope y NO
//        genera ningún aviso — y la viga-semilla sigue en 72 barras / 4 ítems
//        (140.1 kg con la convención de vértice del 18-ago; ver la nota en P4c).
//
// Correr con: node tests/test_topes_generacion.js

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));
const S = require(path.join(base, 'semilla_viga.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function avisos(comp) { return (comp && comp._avisos) || []; }
function hayAviso(comp, frag) {
  return avisos(comp).some(function (a) { return a.indexOf(frag) >= 0; });
}

const host = { largo: 600, ancho: 30, alto: 60, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const TOPE = R.TOPE_PLACEMENTS_COMP;
const TOPE_CAPAS = R.TOPE_CAPAS_COMP;

// ===========================================================================
console.log('P-0 — los topes son parte del contrato público del motor:');
ok(TOPE === 2000, 'TOPE_PLACEMENTS_COMP = 2000 (=' + TOPE + ')');
ok(TOPE_CAPAS === 200, 'TOPE_CAPAS_COMP = 200 (=' + TOPE_CAPAS + ')');

// ===========================================================================
// P0 · REDONDEO DE CANTIDAD — el @ imposible no explota, vale 1
// ===========================================================================
console.log('\nP0 — redondeoCantidadZona con @ inválido → 1 barra (nunca ∞/NaN):');
ok(R.redondeoCantidadZona(600, 0) === 1, '@ 0 → 1');
ok(R.redondeoCantidadZona(600, -5) === 1, '@ negativo → 1');
ok(R.redondeoCantidadZona(600, NaN) === 1, '@ NaN → 1');
ok(R.redondeoCantidadZona(600, undefined) === 1, '@ ausente → 1');
ok(R.redondeoCantidadZona(600, 'abc') === 1, '@ basura → 1');
ok(R.redondeoCantidadZona(0, 20) === 1, 'longitud 0 → 1');
ok(R.redondeoCantidadZona(-600, 20) === 1, 'longitud negativa → 1');
ok(R.redondeoCantidadZona(NaN, 20) === 1, 'longitud NaN → 1');
ok(R.redondeoCantidadZona(600, 20) === 31, 'caso normal 600 @20 → ceil(30)+1 = 31');

// ===========================================================================
// P1 · posicionesRango — corta en 2000 y marca el truncado
// ===========================================================================
console.log('\nP1 — @ 0.1 en un rango de 600 (pedía 6001) → 2000 + marca `_tope`:');
const t0 = Date.now();
const pos01 = R.posicionesRango({ from: -300, to: 300, sep: 0.1 });
const ms = Date.now() - t0;
ok(pos01.length === TOPE, 'exactamente 2000 posiciones (=' + pos01.length + ')');
ok(ms < 500, 'no se cuelga: ' + ms + ' ms (antes iteraba 6001 y generaba 6001 barras)');
ok(!!pos01._tope, 'el array viene marcado con _tope');
ok(pos01._tope && pos01._tope.sep === 0.1, '_tope recuerda el @ que lo causó (=' +
  JSON.stringify(pos01._tope) + ')');
ok(Object.keys(pos01).length === TOPE, '_tope NO es enumerable (Object.keys = solo índices)');
ok(JSON.parse(JSON.stringify(pos01)).length === TOPE, '_tope no viaja en el JSON');
ok(pos01.every(function (x) { return x >= -300 - 1e-9 && x <= 300 + 1e-9; }),
  'las 2000 emitidas siguen dentro del rango');

console.log('\nP1b — @ absurdamente chico (1e-9): tampoco itera 6e11 veces:');
const tA = Date.now();
const posMicro = R.posicionesRango({ from: 0, to: 600, sep: 1e-9 });
ok(posMicro.length === TOPE && (Date.now() - tA) < 500, '2000 posiciones, sin cuelgue (=' +
  posMicro.length + ' en ' + (Date.now() - tA) + ' ms)');

console.log('\nP1c — TRAMOS: el tramo que revienta el tope FRENA la cadena entera:');
// rango 0..600 con [{400 @0.1}, {200 @20}]: el 1er tramo pedía 4001 barras.
const posTr = R.posicionesRango({ from: 0, to: 600, tramos: [{ long: 400, sep: 0.1 }, { long: 200, sep: 20 }] });
ok(posTr.length === TOPE, '2000 posiciones (=' + posTr.length + ')');
ok(!!posTr._tope, 'marcado como truncado');
ok(Math.max.apply(null, posTr) < 400, 'el 2º tramo NO se colocó: nada más allá de 400 (max=' +
  Math.max.apply(null, posTr) + ')');

console.log('\nP1d — rango INVERTIDO truncado: la marca sobrevive al reflejo:');
const posInv = R.posicionesRango({ from: 600, to: 0, tramos: [{ long: 400, sep: 0.1 }] });
ok(posInv.length === TOPE, '2000 posiciones (=' + posInv.length + ')');
ok(!!posInv._tope, 'la marca sigue ahí después del map/reverse del espejo');

// ===========================================================================
// P2 · LOS DISTRIBUIDORES DEJAN DE EMITIR — y lo dicen
// ===========================================================================
function compRango(rango, extra) {
  return Object.assign({
    tipologia: 'ES', figura: '104D', diam: 8, angulos: [135, 135],
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' } },
    distribucion: Object.assign({ modo: 'linear', rango: rango }, extra || {})
  }, {});
}

console.log('\nP2a — LINEAR con rango @0.1: 2000 barras y aviso en comp._avisos:');
const cLin = compRango({ from: -290, to: 290, sep: 0.1 });
const tL = Date.now();
const plLin = R.expandirComponente(cLin, host);
const msL = Date.now() - tL;
ok(plLin.length === TOPE, '2000 placements emitidos, ni uno más (=' + plLin.length + ')');
ok(msL < 4000, 'generó en ' + msL + ' ms (el tope es lo que impide el cuelgue)');
ok(hayAviso(cLin, 'truncada'), 'aviso registrado (=' + JSON.stringify(avisos(cLin)) + ')');
ok(hayAviso(cLin, '2000 barras') && hayAviso(cLin, '0.1 cm'),
  'el aviso EXPLICA: 2000 barras y el @ 0.1 cm que lo causó');
ok(Object.keys(cLin).indexOf('_avisos') < 0, '_avisos sigue NO enumerable (no ensucia la receta)');
ok(JSON.stringify(cLin).indexOf('_avisos') < 0, '_avisos no viaja al guardar el template');

console.log('\nP2b — LINEAR con ZONAS @0.1 (la otra puerta): mismo techo:');
const cZon = {
  tipologia: 'ES', figura: '104D', diam: 8, angulos: [135, 135],
  dims: { A: { modo: 'auto' }, B: { modo: 'auto' } },
  distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 0.1 }] }
};
const plZon = R.expandirComponente(cZon, host);
ok(plZon.length === TOPE, '2000 placements (=' + plZon.length + ')');
ok(hayAviso(cZon, 'truncada'), 'aviso registrado (=' + JSON.stringify(avisos(cZon)) + ')');

console.log('\nP2c — LINEAR con TRAMOS @0.1: idem (misma fuente de posiciones):');
const cTr = compRango({ from: -290, to: 290, tramos: [{ long: 400, sep: 0.1 }, { long: 100, sep: 20 }] });
const plTr = R.expandirComponente(cTr, host);
ok(plTr.length === TOPE, '2000 placements (=' + plTr.length + ')');
ok(hayAviso(cTr, 'truncada'), 'aviso registrado (=' + JSON.stringify(avisos(cTr)) + ')');

// ===========================================================================
// P3 · TECHO DE CAPAS (200) en layered y arreglo
// ===========================================================================
console.log('\nP3a — LAYERED con n_capas 10000 → 200 capas + aviso:');
const cCap = {
  tipologia: 'CBI', figura: '101A', diam: 18, cara: 'inf',
  dims: { A: { modo: 'fija', valor: 100 } },
  distribucion: { modo: 'layered', n_capas: 10000, barras_capa: 1, gap: 0 }
};
const plCap = R.expandirComponente(cCap, host);
ok(plCap.length === TOPE_CAPAS, '200 placements = 200 capas × 1 barra (=' + plCap.length + ')');
ok(hayAviso(cCap, 'capas truncadas en 200'), 'aviso de capas (=' + JSON.stringify(avisos(cCap)) + ')');
ok(hayAviso(cCap, '10000'), 'el aviso dice cuántas pedía la receta');

console.log('\nP3b — LAYERED 10000 capas × 10 barras: caen LOS DOS topes:');
const cCap2 = {
  tipologia: 'CBI', figura: '101A', diam: 18, cara: 'inf',
  dims: { A: { modo: 'fija', valor: 100 } },
  distribucion: { modo: 'layered', n_capas: 10000, barras_capa: 10, gap: 0 }
};
const plCap2 = R.expandirComponente(cCap2, host);
ok(plCap2.length === TOPE, '2000 placements (200 capas × 10 = 2000, tope exacto) (=' + plCap2.length + ')');
ok(hayAviso(cCap2, 'capas truncadas en 200'), 'aviso de capas');

console.log('\nP3c — ARREGLO con n_capas 10000 sobre un rango normal: 200 capas y 2000 barras:');
const cArr = {
  tipologia: 'CBI', figura: '101A', diam: 18, cara: 'inf',
  dims: { A: { modo: 'fija', valor: 100 } },
  distribucion: {
    modo: 'arreglo', n_capas: 10000, sep_capas: 2, eje_capas: 'z',
    rango: { from: -290, to: 290, sep: 13 }     // 46 barras por capa
  }
};
const tArr = Date.now();
const plArr = R.expandirComponente(cArr, host);
ok(plArr.length === TOPE, '2000 placements (200×46 = 9200 pedidos → cortado en 2000) (=' +
  plArr.length + ')');
ok((Date.now() - tArr) < 4000, 'sin cuelgue (' + (Date.now() - tArr) + ' ms)');
ok(hayAviso(cArr, 'capas truncadas en 200'), 'aviso de capas');
ok(hayAviso(cArr, 'truncada en 2000 barras'), 'aviso de barras (=' + JSON.stringify(avisos(cArr)) + ')');

console.log('\nP3d — ARREGLO con @0.1: el tope del rango llega igual por el arreglo:');
const cArr2 = {
  tipologia: 'CBI', figura: '101A', diam: 18, cara: 'inf',
  dims: { A: { modo: 'fija', valor: 100 } },
  distribucion: {
    modo: 'arreglo', n_capas: 2, sep_capas: 5, eje_capas: 'z',
    rango: { from: -290, to: 290, sep: 0.1 }
  }
};
const plArr2 = R.expandirComponente(cArr2, host);
ok(plArr2.length === TOPE, '2000 placements (=' + plArr2.length + ')');
ok(hayAviso(cArr2, '0.1 cm'), 'el aviso nombra el @ 0.1 cm (=' + JSON.stringify(avisos(cArr2)) + ')');

// ===========================================================================
// P4 · UN USO NORMAL NO ROZA NINGÚN TOPE
// ===========================================================================
console.log('\nP4a — estribo REAL: rango 580 @13 → 46 barras, CERO avisos:');
const cNorm = compRango({ from: -290, to: 290, sep: 13 });
const plNorm = R.expandirComponente(cNorm, host);
ok(plNorm.length === 46, '46 placements (ceil(580/13)+1) (=' + plNorm.length + ')');
ok(avisos(cNorm).length === 0, 'sin avisos: el uso normal ni se entera de los topes (=' +
  JSON.stringify(avisos(cNorm)) + ')');
ok(!R.posicionesRango({ from: -290, to: 290, sep: 13 })._tope, 'posicionesRango tampoco marca nada');

console.log('\nP4b — capas normales (3 capas × 4 barras) y tramos normales: cero avisos:');
const cNorm2 = {
  tipologia: 'CBS', figura: '101A', diam: 16, cara: 'sup',
  dims: { A: { modo: 'fija', valor: 100 } },
  distribucion: { modo: 'layered', n_capas: 3, barras_capa: 4, gap: 5 }
};
const plNorm2 = R.expandirComponente(cNorm2, host);
ok(plNorm2.length === 12, '12 placements (3×4) (=' + plNorm2.length + ')');
ok(avisos(cNorm2).length === 0, 'sin avisos');
// FIXTURE CORREGIDO (13-ago): el rango iba de x = 0 a x = 600 sobre una viga que
// va de −300 a +300, o sea la mitad de los estribos caían FUERA del hormigón (el
// último, 300 cm fuera). Como "uso normal" no lo era: el motor ahora avisa cuando
// una barra sale del elemento, y este caso salía. El rango pasa a cubrir la viga de
// verdad y arranca en el RECUBRIMIENTO (−296 → 296, igual que el start_offset 4 de
// la viga-semilla), que es lo que este bloque quiso decir siempre: ejercitar tramos
// normales sin rozar NINGÚN tope. Con el borde EXACTO (±300) el aviso también
// saldría, y con razón: el eje del estribo en la cara deja medio φ al aire.
const cNorm3 = compRango({ from: -296, to: 296, tramos: [{ long: 100, sep: 10 }, { long: 400, sep: 20 }] });
const plNorm3 = R.expandirComponente(cNorm3, host);
ok(avisos(cNorm3).length === 0, 'tramos @10/@20 en 600: sin avisos (=' + plNorm3.length + ' barras)');
ok(plNorm3.length < TOPE, 'y muy por debajo del tope');

console.log('\nP4c — la viga-semilla: ningún tope tocado, kg re-derivado:');
// Lo que este test protege es el CONTEO (4 ítems / 72 barras: ningún tope de
// 18-AGO · 136.1 -> 140.1 kg (CONVENCION DE VERTICE, cerrada por el usuario). El
// numero del catalogo pasa a leerse como ANGULO DEL VERTICE (el que queda entre los
// dos tramos de fierro) y no como recorrido del doblado. Consecuencia en la semilla:
// las patas de 45 del CBS 103B quedan REPLEGADAS sobre el cuerpo en vez de abiertas,
// asi que ya no le roban largo al tramo B: su 'auto' sube de 547.974 a 590.4 (la
// unica reserva por punta que queda es la cresta del codo, phi/2 = 0.8). Son 42.426
// cm mas por barra x 6 barras phi16 = 4.0 kg. Items, barras y las otras 3 figuras del
// listado (2 x 101A y el estribo 104D) no se mueven ni un gramo.
// --- HISTORIA PREVIA (12-ago), ya superada por la nota de arriba: ---
// generación se roza) y eso no se mueve. Los kg bajan 140.2 → 136.1 por la
// MIGRACIÓN CABEZAL → TRAZADOR: el CBS es una 103B con dobleces de 45°/45° que el
// constructor de cabezal ignoraba, y al honrarlos el auto-largo reserva la
// proyección de cada pata (30·cos45 = 21.2132) más el φ/2 de la cresta del codo →
// B = 592 − 2·22.0132 = 547.974. Es una sola dim: no cambia ni un conteo.
const semilla = G.generarViga(S.semillaViga(), {});
ok(semilla.resumen.items === 4 && semilla.resumen.barras === 72 && semilla.resumen.kg === 140.1,
  'semilla = {items:4, barras:72, kg:140.1} (=' + JSON.stringify(semilla.resumen) + ')');
ok(eq(R.posicionesRango({ from: -12, to: 12, sep: 20 }).map(function (v) { return Math.round(v * 1e6) / 1e6; }),
  [-12, 0, 12]), 'el reparto de siempre (paso real) no se movió');

// ===========================================================================
console.log(fallos ? ('\n' + fallos + ' FALLO(S)') : '\nOK — el motor se capea ANTES de generar y deja dicho por qué.');
process.exit(fallos ? 1 : 0);
