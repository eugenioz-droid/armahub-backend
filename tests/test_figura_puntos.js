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
ok(est.length === 7, 'estribo = 7 puntos (2 ganchos + 4 esquinas + cierre) (=' + est.length + ')');
ok(est.every(function (p) { return Math.abs(p.x - 10) < 2; }), 'todo el estribo cerca de x=10 (plano YZ + offset cierre)');
// perímetro cerrado en YZ: alto útil = 60/2-3 = 27; ancho útil = 30/2-3 = 12.
ok(Math.abs(est[1].y - 27) < 1e-6 && Math.abs(est[2].y + 27) < 1e-6, 'esquinas sup/inf a ±27');
ok(Math.abs(est[2].z + 12) < 1e-6 && Math.abs(est[3].z - 12) < 1e-6, 'esquinas izq/der a ±12');
// El rectángulo perimetral es PLANAR (cierre exacto): el vértice sup-izq del
// cierre (pto 5) coincide EXACTO con el de inicio (pto 1) → misma X, cuadro cerrado.
ok(Math.abs(est[5].x - est[1].x) < 1e-9 && Math.abs(est[5].y - est[1].y) < 1e-9 && Math.abs(est[5].z - est[1].z) < 1e-9,
   'cierre del rectángulo EXACTO sobre la esquina de inicio (planar)');
// La separación "/ /" del doble-gancho vive SOLO en la punta libre del 2º gancho.
ok(est[6].x > est[0].x, 'punta del 2º gancho separada en X (doble-gancho "/ /")');

console.log('Traba 101A (cara lateral):');
var tr = F.figuraAPuntos('101A', { A: 54 }, host, { x: 10, z: 0, recub: 3 }, { rol: 'traba', diamCm: 0.8 });
ok(tr.length === 4, 'traba = 4 puntos (gancho 135 + vertical + gancho 90)');
ok(tr[1].y > tr[2].y, 'baja de arriba a abajo');

console.log('Coherencia con el motor (sin NaN, dobleces):');
var an = M.analizarBarra(est, 0.8);
ok(an.dobleces.filter(Boolean).length >= 3, 'el estribo genera ≥3 dobleces reales');
ok(pts.every(function (p) { return isFinite(p.x) && isFinite(p.y) && isFinite(p.z); }), 'cabezal sin NaN');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — figura_puntos pasa.');
