// Test headless (Node) de GENERAR (F0 · T0.6 + viga-semilla T1.2).
// Valida que generarViga(semilla) produzca:
//   - un nº de barras/kg plausibles;
//   - cada barra con figura/dims VÁLIDAS para el catálogo (llena EXACTAMENTE
//     los slots que la figura usa, resto null → pasaría validar_geometria);
//   - ángulos correctos por figura;
//   - agrupación por item (capas iguales → 1 etiqueta ×N);
//   - re-generar da lo MISMO (determinista).
//
// Correr con: node tests/test_generar.js

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));
const S = require(path.join(base, 'semilla_viga.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

// Espejo de las figuras del catálogo para validar los slots.
const SPEC = {
  '101A': { parciales: ['A'], nAng: 0, radio: false },
  '103B': { parciales: ['A', 'B', 'C'], nAng: 2, radio: false },
  '104D': { parciales: ['A', 'B', 'C', 'D'], nAng: 2, radio: false }
};
const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

function validarSlots(b) {
  // Emula validar_geometria: los slots usados con valor≠0; los demás vacíos.
  const spec = SPEC[b.figura];
  if (!spec) return 'figura desconocida ' + b.figura;
  for (const L of LETRAS) {
    const col = 'dim_' + L.toLowerCase();
    const usa = spec.parciales.indexOf(L) !== -1;
    const tiene = b[col] != null && b[col] !== 0;
    if (usa && !tiene) return 'falta ' + col + ' en ' + b.figura;
    if (!usa && tiene) return 'sobra ' + col + ' en ' + b.figura;
  }
  for (let i = 0; i < 4; i++) {
    const usa = i < spec.nAng;
    const tiene = b['ang' + (i + 1)] != null && b['ang' + (i + 1)] !== 0;
    if (usa && !tiene) return 'falta ang' + (i + 1) + ' en ' + b.figura;
    if (!usa && tiene) return 'sobra ang' + (i + 1) + ' en ' + b.figura;
  }
  const tieneR = b.radio != null && b.radio !== 0;
  if (spec.radio && !tieneR) return 'falta radio en ' + b.figura;
  if (!spec.radio && tieneR) return 'sobra radio en ' + b.figura;
  return null;
}

const receta = S.semillaViga();
const ctx = { sector: 'VCIELO', ciclo: 'C1', piso: 'P4', eje: 'V1', template_instancia_id: null };
const out = G.generarViga(receta, ctx);

console.log('Resumen:', JSON.stringify(out.resumen));
ok(out.placements.length > 0, 'genera placements (' + out.placements.length + ')');
ok(out.barras.length >= 4, 'al menos 4 items/etiquetas (' + out.barras.length + ')');
ok(out.resumen.barras > 50, 'barras físicas plausibles (' + out.resumen.barras + ')');
ok(out.resumen.kg > 0, 'kg estimado > 0 (' + out.resumen.kg + ')');

console.log('Cada barra pasa validar_geometria (slots exactos):');
let errSlots = null;
out.barras.forEach(function (b) { const e = validarSlots(b); if (e && !errSlots) errSlots = e; });
ok(!errSlots, 'todas las barras con slots válidos' + (errSlots ? ' — ' + errSlots : ''));

console.log('Contexto estampado + origen template:');
ok(out.barras.every(function (b) { return b.sector === 'VCIELO' && b.ciclo === 'C1' && b.eje === 'V1' && b.piso === 'P4'; }), 'ubicación del ctx en todas');
ok(out.barras.every(function (b) { return b.origen === 'template'; }), "origen='template' en todas");
ok(out.barras.every(function (b) { return b.diam && [8, 16, 18].indexOf(b.diam) !== -1; }), 'diámetros mm correctos (8/16/18)');

console.log('Agrupación por item (capas iguales → 1 etiqueta ×N):');
const cbs = out.barras.filter(function (b) { return b.marca === 'CBS'; });
ok(cbs.length === 1, 'las 2 capas × 3 del CBS se agrupan en 1 item (=' + cbs.length + ')');
ok(cbs.length === 1 && cbs[0].cant === 6, 'ese item lleva cant = 6');
const es = out.barras.filter(function (b) { return b.marca === 'ES'; });
ok(es.length === 1, 'los estribos iguales (mismas dims) se agrupan en 1 item');
ok(es.length === 1 && es[0].cant >= 40, 'ese item de estribos lleva cant≥40 (=' + (es[0] && es[0].cant) + ')');

console.log('NO envía largo ni peso (los pone el backend):');
ok(out.barras.every(function (b) { return b.largo_total === undefined && b.peso_unitario === undefined; }), 'sin largo_total/peso en el payload');

console.log('Determinista (re-generar = igual):');
const out2 = G.generarViga(S.semillaViga(), ctx);
ok(out2.resumen.barras === out.resumen.barras && out2.barras.length === out.barras.length, 're-generar da los mismos conteos');

console.log('Ángulos por figura:');
ok(cbs[0].ang1 === 45 && cbs[0].ang2 === 45 && cbs[0].ang3 == null, 'CBS 103B → ang 45/45');
ok(es[0].ang1 === 135 && es[0].ang2 === 135, 'ES 104D → ang 135/135');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — generar (viga-semilla end-to-end) pasa.');
