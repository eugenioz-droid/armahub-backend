// Test de INTEGRACIÓN headless (F1 · T1.8): valida que las barras que el panel
// enviaría a POST /lotes/{id}/barras tengan EXACTAMENTE el shape que acepta el
// modelo BarraManual del backend (lotes.py), incluidos origen/template_instancia_id,
// y SIN campos internos (_largoEstimado, _pesoEstimado).
//
// No levanta la app (fastapi no está local); emula el mapeo del panel
// (modelador3dCargarAlDespiece) sobre la salida de generarViga.
//
// Correr con: node tests/test_integracion_modelador.js

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));
const S = require(path.join(base, 'semilla_viga.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

// Campos que acepta BarraManual (lotes.py) — el payload no debe tener otros "raros".
const CAMPOS_OK = new Set([
  'sector', 'piso', 'ciclo', 'eje', 'nombre_plano', 'diam', 'figura', 'marca',
  'cant', 'mult', 'dim_a', 'dim_b', 'dim_c', 'dim_d', 'dim_e', 'dim_f', 'dim_g',
  'dim_h', 'dim_i', 'ang1', 'ang2', 'ang3', 'ang4', 'radio', 'revisada',
  'suf_tipo', 'origen', 'template_instancia_id'
]);

const out = G.generarViga(S.semillaViga(), { sector: 'VCIELO', ciclo: 'C1', piso: 'P4', eje: 'V1' });

// Emula el mapeo del panel: quita campos _ y estampa origen/template_instancia_id.
const instId = 123;
const barras = out.barras.map(function (b) {
  const o = {};
  for (const k in b) if (Object.prototype.hasOwnProperty.call(b, k) && k.charAt(0) !== '_') o[k] = b[k];
  o.template_instancia_id = instId;
  o.origen = 'template';
  return o;
});

console.log('Shape del payload:');
ok(barras.length >= 4, 'hay barras para enviar (' + barras.length + ')');
let camposRaros = [];
barras.forEach(function (b) {
  Object.keys(b).forEach(function (k) { if (!CAMPOS_OK.has(k)) camposRaros.push(k); });
});
ok(camposRaros.length === 0, 'ningún campo fuera de BarraManual' + (camposRaros.length ? ' — sobran: ' + [...new Set(camposRaros)].join(',') : ''));
ok(barras.every(function (b) { return b.origen === 'template'; }), "origen='template' en todas");
ok(barras.every(function (b) { return b.template_instancia_id === instId; }), 'template_instancia_id estampado');
ok(barras.every(function (b) { return typeof b.diam === 'number' && b.diam > 0; }), 'diam numérico');
ok(barras.every(function (b) { return b.sector && b.ciclo && b.eje && b.piso; }), 'ubicación completa (sector/ciclo/eje/piso)');
ok(barras.every(function (b) { return b.largo_total === undefined && b.peso_unitario === undefined && b.peso_total === undefined; }), 'sin largo/peso (los pone el backend)');
ok(barras.every(function (b) { return b._largoEstimado === undefined && b._pesoEstimado === undefined; }), 'sin campos internos _estimado');

console.log('Cargar SIN traza (template_instancia_id null) también válido:');
const barrasSinTraza = out.barras.map(function (b) {
  const o = {}; for (const k in b) if (k.charAt(0) !== '_') o[k] = b[k];
  o.template_instancia_id = null; o.origen = 'template'; return o;
});
ok(barrasSinTraza.every(function (b) { return b.template_instancia_id === null; }), 'template_instancia_id null aceptado (traza opcional)');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — integración modelador (payload ↔ BarraManual) pasa.');
