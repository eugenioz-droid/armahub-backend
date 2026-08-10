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
// Layout (8 puntos): [0]=punta g1(subida en bloque), [1]=nace-curva(subido),
// [2]=esquina sup-izq REAL, [3]=inf-izq, [4]=inf-der, [5]=sup-der, [6]=cierre sup-izq,
// [7]=punta g2. El cuadro son [2..6]; el gancho 1 ([0]-[1]) está subido en bloque.
ok(est.length === 8, 'estribo = 8 puntos (gancho1 subido en bloque + cuadro + gancho2) (=' + est.length + ')');
ok(est.every(function (p) { return Math.abs(p.x - 10) < 2; }), 'todo el estribo PLANAR cerca de x=10 (plano YZ)');
// perímetro cerrado en YZ: alto útil = 60/2-3 = 27; ancho útil = 30/2-3 = 12.
// Esquinas del CUADRO: [2]=sup-izq(27,-12), [3]=inf-izq(-27,-12), [5]=sup-der(27,12).
ok(Math.abs(est[2].y - 27) < 1e-6 && Math.abs(est[3].y + 27) < 1e-6, 'esquinas sup/inf del cuadro a ±27');
ok(Math.abs(est[3].z + 12) < 1e-6 && Math.abs(est[4].z - 12) < 1e-6, 'esquinas izq/der del cuadro a ±12');
// El cuadro es PLANAR y cierra: el cierre [6] coincide EXACTO con la esquina sup-izq [2].
ok(Math.abs(est[6].x - est[2].x) < 1e-9 && Math.abs(est[6].y - est[2].y) < 1e-9 && Math.abs(est[6].z - est[2].z) < 1e-9,
   'cierre del cuadro EXACTO sobre la esquina sup-izq (planar)');
// Todos los puntos en la misma X (plano YZ, sin offset de profundidad).
ok(est.every(function (p) { return Math.abs(p.x - est[0].x) < 1e-9; }),
   'estribo 100% planar: todos los puntos en la misma X');
// GANCHO 1 SUBIDO EN BLOQUE: la pata B ([1]→[2]) es VERTICAL (mismo Z) y quedó estirada
// (el punto donde nace la curva subió, la esquina se quedó). La curva ([0]→[1]) mantiene
// su forma (diagonal). Es SOLO capa visual (peso/dims intactos).
ok(Math.abs(est[1].z - est[2].z) < 1e-9 && est[1].y > est[2].y,
   'pata B vertical y estirada: gancho 1 subido en bloque sin deformar la curva');

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
