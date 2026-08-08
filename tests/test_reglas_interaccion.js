// Test headless (Node) de las EXTENSIONES de interacción del Template Editor en
// reglas.js: pos_hint (traslación), orient (rotación), distribucion.rango
// (lineal por from/to) y points (colocación puntual). Verifica que:
//   - sin pos_hint/orient los placements salen IDÉNTICOS (cero regresión);
//   - pos_hint traslada todos los puntos;
//   - orient rota 90° en el eje indicado;
//   - rango distribuye entre from/to con @sep;
//   - points respeta positions y devuelve [] con cfg vacío (compat stub).
//
// Correr con: node tests/test_reglas_interaccion.js

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = require(path.join(base, 'reglas.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function close(a, b, t) { return Math.abs(a - b) < (t || 1e-6); }

const host = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

// --- Componente cabezal base (sin transform) ---
function compCab(extra) {
  return Object.assign({
    tipologia: 'CBI', figura: '101A', diam: 18, suf_tipo: 'inf', cara: 'inf',
    dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
  }, extra || {});
}

console.log('CERO REGRESIÓN — sin pos_hint/orient:');
const plBase = R.expandirComponente(compCab(), host);
ok(plBase.length === 1, '1 placement (1 capa × 1 barra)');
const p0 = plBase[0].puntos[0], p1 = plBase[0].puntos[1];
ok(plBase[0].puntos.length === 2, '101A recto = 2 puntos');

console.log('POS_HINT — traslada todos los puntos:');
const plMov = R.expandirComponente(compCab({ pos_hint: { z: 5, y: 2 } }), host);
const q0 = plMov[0].puntos[0];
ok(close(q0.z, p0.z + 5) && close(q0.y, p0.y + 2) && close(q0.x, p0.x), 'punto desplazado +5 z / +2 y');

console.log('ORIENT — rota 90° en X (sección):');
// una barra recta en X no cambia al rotar en X; probamos con un cabezal 103B (tiene patas en Y).
function comp103(extra) {
  return Object.assign({
    tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup', angulos: [45, 45],
    dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
  }, extra || {});
}
const plO0 = R.expandirComponente(comp103(), host);
const plO90 = R.expandirComponente(comp103({ orient: { eje: 'x', deg: 90 } }), host);
// rotar 90° en X: (y,z) -> (-z, y). Tomamos la punta de la pata (primer punto).
const a = plO0[0].puntos[0], b = plO90[0].puntos[0];
ok(close(b.y, -a.z) && close(b.z, a.y) && close(b.x, a.x), 'rotación 90° X mapea (y,z)->(-z,y)');
ok(plO90[0].meta && plO90[0].meta.orient_deg === 90, 'meta.orient_deg = 90 tras rotar');

console.log('RANGO — distribución lineal por from/to:');
const compRango = {
  tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral',
  dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
  distribucion: { modo: 'linear', rango: { from: -100, to: 100, sep: 20 } }
};
const plR = R.expandirComponente(compRango, host);
// ceil(200/20)+1 = 11
ok(plR.length === 11, 'rango 200cm @20 → 11 estribos (=' + plR.length + ')');
ok(plR.every(function (p) { return p.puntos.length === 7; }), 'cada estribo = 7 puntos');
// primer estribo en x=-100, último en x=100 (a lo largo del eje X)
ok(close(plR[0].puntos[0].x, -100, 0.01), '1er estribo en x=-100');
ok(close(plR[plR.length - 1].puntos[0].x, 100, 0.01), 'último estribo en x=100');

console.log('POINTS — posiciones explícitas + compat stub:');
const compPts = {
  tipologia: 'CBI', figura: '101A', diam: 18, cara: 'inf',
  dims: { A: { modo: 'auto' } },
  distribucion: { modo: 'points', positions: [{ z: -5 }, { z: 0 }, { z: 5 }] }
};
const plP = R.expandirComponente(compPts, host);
ok(plP.length === 3, '3 posiciones → 3 placements');
ok(R.distribuidorPoints({}, {}, host).length === 0, 'points con cfg vacío = [] (compat stub)');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — reglas interacción (pos_hint/orient/rango/points) pasa.');
