// Test headless (Node) del MOTOR GEOMÉTRICO del modelador 3D (F0 · T0.2).
// Valida la LÓGICA de puntos/dobleces sin render (THREE no está en Node):
//   - radioDobladoNorma respeta el umbral 16 mm (1.6 cm).
//   - analizarBarra: una L de 90° genera EXACTAMENTE 1 doblez interior, sin NaN,
//     con radio y tangencias coherentes.
//   - un estribo (5 vértices) genera dobleces en los interiores.
//   - largoPolilinea suma los segmentos.
//   - sin puntos duplicados-fantasma; colineales no generan doblez.
//
// Correr con: node tests/test_motor_geom.js

const path = require('path');
const M = require(path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador', 'motor_geom.js'));

let fallos = 0;
function ok(cond, msg) { if (!cond) { console.error('  ✗ ' + msg); fallos++; } else { console.log('  ✓ ' + msg); } }
function noNaN(v, msg) { ok(v != null && isFinite(v), msg + ' (=' + v + ')'); }
function finitoPt(p, msg) { ok(p && isFinite(p.x) && isFinite(p.y) && isFinite(p.z), msg); }

console.log('radioDobladoNorma:');
ok(M.radioDobladoNorma(1.0) === 2.0, 'φ10mm → 2φ = 2.0 cm');
ok(M.radioDobladoNorma(1.6) === 3.2, 'φ16mm (límite) → 2φ = 3.2 cm');
ok(M.radioDobladoNorma(1.8) === 6.3, 'φ18mm → 3.5φ = 6.3 cm');
ok(M.radioDobladoNorma(2.5) === 8.75, 'φ25mm → 3.5φ = 8.75 cm');

console.log('analizarBarra — L de 90°:');
// L en el plano XY: (0,0,0) -> (100,0,0) -> (100,50,0). Un solo vértice interior.
const L = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 100, y: 50, z: 0 }];
const aL = M.analizarBarra(L, 1.0);   // φ10mm
ok(aL.pts.length === 3, 'conserva 3 puntos');
const dobleces = aL.dobleces.filter(Boolean);
ok(dobleces.length === 1, 'exactamente 1 doblez interior');
const d = dobleces[0];
finitoPt(d.T1, 'T1 finito'); finitoPt(d.T2, 'T2 finito'); finitoPt(d.O, 'O (centro) finito');
noNaN(d.ang, 'ángulo del doblez');
ok(Math.abs(d.ang - Math.PI / 2) < 1e-6, 'ángulo ≈ 90° (π/2)');
noNaN(d.R, 'radio del doblez');
ok(d.R > 0, 'radio > 0');
// T1 y T2 deben estar sobre los segmentos (a distancia t del vértice (100,0,0)).
ok(Math.abs(d.T1.y) < 1e-9 && d.T1.x < 100, 'T1 sobre el primer tramo');
ok(Math.abs(d.T2.x - 100) < 1e-9 && d.T2.y > 0, 'T2 sobre el segundo tramo');

console.log('analizarBarra — colineal no genera doblez:');
const recta = [{ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }];
ok(M.analizarBarra(recta, 1.0).dobleces.filter(Boolean).length === 0, 'tramo recto → 0 dobleces');

console.log('analizarBarra — estribo cerrado (5 vértices, plano YZ):');
// Perímetro rectangular abierto: 4 esquinas interiores esperadas entre 5 puntos.
const est = [
  { x: 0, y: 30, z: -20 }, { x: 0, y: -30, z: -20 },
  { x: 0, y: -30, z: 20 }, { x: 0, y: 30, z: 20 }, { x: 0, y: 30, z: -20 }
];
const aE = M.analizarBarra(est, 0.8);
const nDobE = aE.dobleces.filter(Boolean).length;
ok(nDobE === 3, 'estribo abierto de 5 pts → 3 dobleces interiores (=' + nDobE + ')');
aE.dobleces.filter(Boolean).forEach(function (dd, i) {
  finitoPt(dd.O, 'estribo doblez ' + i + ' centro finito');
  noNaN(dd.R, 'estribo doblez ' + i + ' radio');
});

console.log('largoPolilinea:');
ok(Math.abs(M.largoPolilinea(L) - 150) < 1e-9, 'L (100+50) = 150');
ok(Math.abs(M.largoPolilinea(recta) - 100) < 1e-9, 'recta con punto medio = 100');

console.log('duplicados:');
const dup = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }];
ok(M.analizarBarra(dup, 1.0).pts.length === 2, 'punto duplicado se elimina');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — motor_geom (lógica de puntos/dobleces) pasa.');
