// Test headless (Node) del VOLTEO DEL PLANO DE LA PIEZA como GEOMETRÍA REAL
// (§GAP-ANALYSIS-TE · G3/B3). `comp.plano_pieza.volteado` dejó de ser un truco de
// proyección SVG: es una PERMUTACIÓN DE EJES (x local ↔ z mundo) resuelta en el
// motor. Verifica que:
//   - con volteado:false (o ausente) los placements son BYTE-IDÉNTICOS a la base
//     (cero regresión: protege 140.3 kg / 72 placements / 4 items);
//   - al voltear un ESTRIBO y un CABEZAL sus puntos siguen DENTRO del marco de
//     recubrimiento (el recub se mantiene POR CONSTRUCCIÓN, no por parches);
//   - la DISTRIBUCIÓN cambia de eje (el rango reparte en Z, las capas en X);
//   - ejeDistribucion() informa el eje real (lo consume la flecha de rango de la UI).
//
// Correr con: node tests/test_volteo.js

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
const R = require(path.join(base, 'reglas.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function close(a, b, t) { return Math.abs(a - b) < (t || 1e-6); }

const host = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

// Marco ÚTIL del hormigón (dentro del recubrimiento) por eje del mundo.
const MARCO = {
  x: host.largo / 2 - host.recub_sup,   // 296 — el motor usa el recub vertical como recub de extremo
  y: host.alto / 2 - host.recub_sup,    // 26
  z: host.ancho / 2 - host.recub_lat    // 12
};

function span(placements, eje) {
  let lo = Infinity, hi = -Infinity;
  placements.forEach(pl => pl.puntos.forEach(p => { if (p[eje] < lo) lo = p[eje]; if (p[eje] > hi) hi = p[eje]; }));
  return { lo, hi, len: hi - lo };
}
// centros (por placement) a lo largo de un eje: sirve para ver por dónde REPARTE.
function centros(placements, eje) {
  return placements.map(pl => {
    let lo = Infinity, hi = -Infinity;
    pl.puntos.forEach(p => { if (p[eje] < lo) lo = p[eje]; if (p[eje] > hi) hi = p[eje]; });
    return (lo + hi) / 2;
  });
}
function reparte(placements, eje) {
  const c = centros(placements, eje);
  return Math.max(...c) - Math.min(...c) > 1;   // los placements NO están todos en el mismo plano
}
function dentroDelMarco(placements, tol) {
  const t = tol || 0.01;
  return ['x', 'y', 'z'].every(e => {
    const s = span(placements, e);
    return s.lo >= -MARCO[e] - t && s.hi <= MARCO[e] + t;
  });
}

// --- Componentes de prueba (fábricas: expandirComponente normaliza/muta el comp) ---
function compEstribo(extra) {
  return Object.assign({
    tipologia: 'ES', figura: '104D', diam: 8, suf_tipo: 'estribo', cara: 'lateral',
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'linear', activa: true, sep: 20, rango: { from: -100, to: 100, sep: 20 } }
  }, extra || {});
}
function compCabezal(extra) {
  return Object.assign({
    tipologia: 'CBS', figura: '103B', diam: 16, suf_tipo: 'sup', cara: 'sup', angulos: [45, 45],
    dims: { A: { modo: 'fija', valor: 15 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 15 } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 3, gap: 4, sentido: 'nucleo' }
  }, extra || {});
}

// ===========================================================================
console.log('CERO REGRESIÓN — volteado:false (o ausente) = ruta idéntica:');
const esBase = R.expandirComponente(compEstribo(), host);
const esFalse = R.expandirComponente(compEstribo({ plano_pieza: { volteado: false } }), host);
ok(JSON.stringify(esBase) === JSON.stringify(esFalse), 'estribo: placements idénticos con volteado:false');
const cbBase = R.expandirComponente(compCabezal(), host);
const cbFalse = R.expandirComponente(compCabezal({ plano_pieza: { volteado: false } }), host);
ok(JSON.stringify(cbBase) === JSON.stringify(cbFalse), 'cabezal: placements idénticos con volteado:false');
ok(R.ejeDistribucion(compEstribo()) === 'x', 'ejeDistribucion sin voltear = x');

// ===========================================================================
console.log('\nESTRIBO VOLTEADO — figura (z,y)→(x,y), reparto x→z:');
// el rango pasa a expresarse en el EJE DE DISTRIBUCIÓN real (z): dentro del ancho útil.
const esV = R.expandirComponente(
  compEstribo({ plano_pieza: { volteado: true }, distribucion: { modo: 'linear', activa: true, sep: 4, rango: { from: -8, to: 8, sep: 4 } } }),
  host);
ok(esV.length === 5, 'rango 16cm @4 en Z → 5 estribos (=' + esV.length + ')');
ok(dentroDelMarco(esV), 'todos los puntos DENTRO del marco de recubrimiento');
ok(reparte(esV, 'z') && !reparte(esV, 'x'), 'reparte en Z (antes X)');
ok(!reparte(esBase, 'z') && reparte(esBase, 'x'), 'la base sigue repartiendo en X');
// la figura ahora vive en el plano (x,y): su lado horizontal = largo útil
const sx = span(esV, 'x'), sy = span(esV, 'y');
ok(close(sx.hi, MARCO.x, 0.01) && close(sx.lo, -MARCO.x, 0.01), 'lado horizontal = largo − 2·recub extremo (±' + MARCO.x + ')');
ok(close(sy.hi, MARCO.y, 0.01) && close(sy.lo, -MARCO.y, 0.01), 'lado vertical = alto útil (±' + MARCO.y + ')');
ok(R.ejeDistribucion({ plano_pieza: { volteado: true } }) === 'z', 'ejeDistribucion volteado = z');
ok(esV.every(pl => pl.meta && pl.meta.volteado === true), 'meta.volteado estampado');
ok(esV[0].puntos.length === esBase[0].puntos.length, 'misma cantidad de puntos que la base (misma figura, otra orientación)');

// ===========================================================================
console.log('\nCABEZAL VOLTEADO — corre en Z, capas a lo largo de X:');
const cbV = R.expandirComponente(compCabezal({ plano_pieza: { volteado: true } }), host);
ok(cbV.length === cbBase.length, 'mismo nº de barras que la base (=' + cbV.length + ')');
ok(dentroDelMarco(cbV), 'todos los puntos DENTRO del marco de recubrimiento');
// la barra corre a lo ancho (Z) en vez de a lo largo (X)
const cbSpanZ = span([cbV[0]], 'z').len, cbSpanX = span([cbV[0]], 'x').len;
ok(cbSpanZ > cbSpanX, 'la barra corre en Z (span z=' + cbSpanZ.toFixed(1) + ' > span x=' + cbSpanX.toFixed(1) + ')');
ok(close(cbSpanZ, host.ancho - 2 * host.recub_sup, 0.01), 'largo de la barra = ancho − 2·recub (dim auto del NUEVO plano)');
ok(reparte(cbV, 'x') && !reparte(cbV, 'z'), 'las barras de la capa se reparten en X (antes Z)');
ok(reparte(cbBase, 'z') && !reparte(cbBase, 'x'), 'la base sigue repartiendo las barras en Z');
// sigue pegado a la cara superior: su Y máxima es la misma que sin voltear
ok(close(span(cbV, 'y').hi, span(cbBase, 'y').hi, 1e-6), 'conserva el recubrimiento de la cara superior');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — volteo (permutación de ejes real) pasa.');
