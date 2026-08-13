// Test headless (Node) de FIGURA → PUNTOS (F0 · T0.3).
// Valida que cada rol produzca la polilínea esperada (nº de puntos, patas,
// perímetro) para las figuras de la viga-semilla.
//
// Correr con: node tests/test_figura_puntos.js

const path = require('path');
const F = require(path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador', 'figura_puntos.js'));
const M = require(path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador', 'motor_geom.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

const host = { largo: 600, alto: 60, ancho: 30 };

console.log('Cabezal 103B (A=30, B=592, C=30) cara sup:');
var anchor = { cara: 'sup', y: 26, z: 0, recubExtremo: 4 };
var pts = F.figuraAPuntos('103B', { A: 30, B: 592, C: 30 }, host, anchor, { rol: 'cabezal', diamCm: 1.6 });
ok(pts.length === 4, '4 puntos (pata A + 2 del tramo + pata C) (=' + pts.length + ')');
ok(Math.abs(pts[1].x - (-296)) < 1e-6 && Math.abs(pts[2].x - 296) < 1e-6, 'tramo B centrado (±296)');
ok(pts[0].y < pts[1].y, 'pata inicial va hacia el núcleo (abajo, cara sup)');
ok(Math.abs(pts[1].y - 26) < 1e-6, 'tramo a la altura del anchor (y=26)');

console.log('Cabezal 101A recto (solo A = largo) cara inf:');
var ptsR = F.figuraAPuntos('101A', { A: 592 }, host, { cara: 'inf', y: -26, z: 0 }, { rol: 'cabezal', diamCm: 1.8 });
ok(ptsR.length === 2, 'recta = 2 puntos');
ok(Math.abs(ptsR[1].x - ptsR[0].x - 592) < 1e-6, 'largo recto = A = 592');
ok(Math.abs(ptsR[0].y + 26) < 1e-6 && Math.abs(ptsR[1].y + 26) < 1e-6, 'a la altura inferior');

console.log('Estribo 104D perimetral (plano YZ):');
var est = F.figuraAPuntos('104D', { A: 22, B: 52, C: 22, D: 52 }, host, { x: 10, recub: 3 }, { rol: 'estribo', diamCm: 0.8 });
// El GANCHO se dibuja con ARCO EXPLÍCITO (BVBS): el estribo pasa de 7 vértices a una
// polilínea densa (recta + arco muestreado + pata). Se valida por CONTENIDO, no índices.
// alto útil = 60/2-3 = 27; ancho útil = 30/2-3 = 12.
var h2t = 27, w2t = 12;
function tieneEst(y, z) { return est.some(function (p) { return Math.abs(p.y - y) < 0.6 && Math.abs(p.z - z) < 0.6; }); }
ok(est.length >= 15, 'estribo con arco explícito = polilínea densa (rect + gancho curvo) (=' + est.length + ')');
ok(est.every(function (p) { return Math.abs(p.x - 10) < 2; }), 'todo el estribo cerca de x=10 (plano YZ)');
// 3 esquinas rectas del CUADRO en punta (el motor las redondea a 90°); la esquina
// sup-izq NO es un vértice: la forman los DOS codos de 135° de los ganchos
// (concéntricos, tangentes a sus lados) — como el estribo físico real.
ok(tieneEst(-h2t, -w2t) && tieneEst(-h2t, w2t) && tieneEst(h2t, w2t),
   '3 esquinas rectas presentes (inf-izq, inf-der, sup-der)');
var dEsqSupIzq = Math.min.apply(null, est.map(function (p) { return Math.hypot(p.y - h2t, p.z + w2t); }));
ok(dEsqSupIzq < 2.5, 'esquina sup-izq cubierta por los codos de los ganchos (dist ' + dEsqSupIzq.toFixed(2) + ')');
// ganchos PARALELOS exactos (regla usuario): dirección de la pata A vs pata B.
(function () {
  var nn = est.length;
  function dd(a, b) { var dy = b.y - a.y, dz = b.z - a.z, l = Math.hypot(dy, dz); return { y: dy / l, z: dz / l }; }
  var dA = dd(est[0], est[1]), dB = dd(est[nn - 2], est[nn - 1]);
  var ang = Math.acos(Math.max(-1, Math.min(1, Math.abs(dA.y * dB.y + dA.z * dB.z)))) * 180 / Math.PI;
  ok(ang < 0.1, 'patas de los 2 ganchos PARALELAS (' + ang.toFixed(2) + '°)');
})();
// el estribo es 100% PLANAR (todos los puntos en la misma X, sin offset de profundidad).
ok(est.every(function (p) { return Math.abs(p.x - est[0].x) < 1e-9; }),
   'estribo 100% planar: todos los puntos en la misma X');
// la punta del gancho (est[0]) apunta al NÚCLEO (dentro del cuadro, no hacia afuera).
ok(est[0].z > -w2t && est[0].z < w2t && est[0].y < h2t + 0.6,
   'punta del gancho apunta al núcleo (dentro del recubrimiento)');

console.log('Traba 101A (cara lateral):');
var tr = F.figuraAPuntos('101A', { A: 54 }, host, { x: 10, z: 0, recub: 3 }, { rol: 'traba', diamCm: 0.8 });
// TANDA V: el gancho sísmico de 135° ya no es un vértice en punta — es un ARCO
// muestreado (puntos esArco) con radio de norma, como el del estribo. El pie de
// 90° sigue en punta (lo redondea el fillet del motor). La cuenta: el vértice
// del doblez Y la punta vieja se reemplazan (la punta nueva cuelga del arco):
// quedan 3 rectos (punta, fondo, pie) + 1 racha de arco = los 4 de la cadena.
var trArco = tr.filter(function (p) { return p.esArco; });
var trRect = tr.filter(function (p) { return !p.esArco; });
ok(trRect.length === 3 && trArco.length >= 8,
  'traba = 3 puntos rectos + gancho 135 en ARCO (rectos=' + trRect.length + ' arco=' + trArco.length + ')');
// la CRESTA del arco toca EXACTO la altura del estribo — alto/2 − recub − φ/2 =
// 30 − 3 − 0.4 = 26.6 (regla de la cresta: ahí se APOYA, la jerarquía mide ahí):
var trMaxY = Math.max.apply(null, tr.map(function (p) { return p.y; }));
ok(Math.abs(trMaxY - 26.6) < 1e-9 && trArco.some(function (p) { return Math.abs(p.y - trMaxY) < 1e-9; }),
  'la cresta del arco toca EXACTO ySup = 26.6 (=' + trMaxY + ')');
ok(tr[0].y < trMaxY, 'la punta del gancho cuelga bajo la cresta');
// la vertical baja desde la TANGENCIA del arco (su punto más bajo) al fondo:
var trTang = Math.min.apply(null, trArco.map(function (p) { return p.y; }));
ok(trTang > trRect[1].y, 'baja de arriba (tangencia del arco) a abajo (fondo)');

console.log('Coherencia con el motor (sin NaN, dobleces):');
var an = M.analizarBarra(est, 0.8);
ok(an.dobleces.filter(Boolean).length >= 3, 'el estribo genera ≥3 dobleces reales');
ok(pts.every(function (p) { return isFinite(p.x) && isFinite(p.y) && isFinite(p.z); }), 'cabezal sin NaN');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — figura_puntos pasa.');
