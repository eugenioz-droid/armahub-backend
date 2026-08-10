// Test headless (Node) del EXPANSOR de distribución (F0 · T0.4 + T0.5).
// Valida los conteos del motor genérico sobre una viga-semilla:
//   - redondeoCantidadZona con el criterio por defecto (round).
//   - LINEAR (estribos): 3 zonas → conteos correctos por zona.
//   - LAYERED (cabezal): n_capas × barras_capa placements, apilados hacia núcleo.
//   - GRID/PERIMETER/POINTS = [] (stubs 2ª entrega).
//
// Correr con: node tests/test_reglas.js

const path = require('path');
// Cargar dependencias como globals (los módulos del navegador leen globalThis).
global.ModeladorFiguraPuntos = require(path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador', 'figura_puntos.js'));
require(path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador', 'motor_geom.js'));
const R = require(path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador', 'reglas.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

const host = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

// Redondeo = ESPEJO de ArmaPilot: ceil(L/@)+1 ("cerrar el intervalo, @ o menos"). edge: dist/esp<=0 → 1.
console.log('redondeoCantidadZona (ceil(L/@)+1, espejo ArmaPilot):');
ok(R.redondeoCantidadZona(150, 10) === 16, '150/10 → ceil(15)+1 = 16');
ok(R.redondeoCantidadZona(300, 20) === 16, '300/20 → ceil(15)+1 = 16');
ok(R.redondeoCantidadZona(155, 10) === 17, '155/10 → ceil(15.5)+1 = 17');
ok(R.redondeoCantidadZona(0, 10) === 1, 'longitud 0 → 1 (edge ArmaPilot)');

console.log('LINEAR — estribo por 3 zonas (10/20/10):');
var compES = {
  tipologia: 'ES', figura: '104D', diam: 8, suf_tipo: 'z',
  cara: 'lateral',
  dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
  distribucion: { modo: 'linear', zonas: [{ long: 150, sep: 10 }, { long: 300, sep: 20 }, { long: 150, sep: 10 }] }
};
var plES = R.expandirComponente(compES, host);
// ceil+1 por zona: 150/10→16, 300/20→16, 150/10→16 → ~48 (algunos se cortan por x1/solape de zonas)
var porZona = {};
plES.forEach(function (p) { porZona[p.meta.zona] = (porZona[p.meta.zona] || 0) + 1; });
console.log('    placements por zona:', JSON.stringify(porZona), '· total', plES.length);
ok(plES.length >= 40 && plES.length <= 50, 'total estribos plausible (' + plES.length + ')');
ok(porZona[1] >= 1 && porZona[2] >= 1 && porZona[3] >= 1, 'las 3 zonas generan barras');
ok(plES.every(function (p) { return p.puntos.length === 8; }), 'cada estribo = 8 puntos');
ok(plES.every(function (p) { return p.figura === '104D' && p.tipologia === 'ES'; }), 'figura/tipología correctas');

console.log('LAYERED — cabezal sup 2 capas × 3 barras:');
var compCBS = {
  tipologia: 'CBS', figura: '103B', diam: 16, suf_tipo: 'sup', cara: 'sup',
  angulos: [45, 45],
  dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 } },
  distribucion: { modo: 'layered', n_capas: 2, barras_capa: 3, gap: 4, sentido: 'nucleo' }
};
var plCBS = R.expandirComponente(compCBS, host);
ok(plCBS.length === 6, '2 capas × 3 barras = 6 placements (=' + plCBS.length + ')');
var capa1 = plCBS.filter(function (p) { return p.meta.capa === 1; });
var capa2 = plCBS.filter(function (p) { return p.meta.capa === 2; });
ok(capa1.length === 3 && capa2.length === 3, '3 barras por capa');
// capa 2 más hacia el núcleo (menor Y que capa 1, cara sup).
var y1 = capa1[0].puntos[1].y, y2 = capa2[0].puntos[1].y;
ok(y2 < y1, 'capa 2 apilada hacia el núcleo (y2 < y1)');
ok(plCBS.every(function (p) { return p.puntos.length === 4; }), 'cada cabezal 103B = 4 puntos');
ok(Math.abs(plCBS[0].dims.B - (600 - 8)) < 1e-6, 'B auto = largo − 2·recub = 592');

console.log('CABEZAL inferior 101A recto 1 capa × 4:');
var compCBI = {
  tipologia: 'CBI', figura: '101A', diam: 18, suf_tipo: 'inf', cara: 'inf',
  dims: { A: { modo: 'auto' } },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 4, gap: 0 }
};
var plCBI = R.expandirComponente(compCBI, host);
ok(plCBI.length === 4, '1 capa × 4 = 4 placements');
ok(plCBI.every(function (p) { return p.puntos.length === 2; }), '101A recto = 2 puntos');

console.log('STUBS grid/perimeter/points → []:');
ok(R.distribuidorGrid({}, {}, host).length === 0, 'grid = []');
ok(R.distribuidorPerimeter({}, {}, host).length === 0, 'perimeter = []');
ok(R.distribuidorPoints({}, {}, host).length === 0, 'points = []');
ok(R.expandirComponente({ tipologia: 'MH', figura: '101A', diam: 10, distribucion: { modo: 'grid' } }, host).length === 0, 'expandir modo grid = []');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — reglas (expansor + redondeo) pasa.');
