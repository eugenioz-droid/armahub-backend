// Test headless (Node) de EMPALMES + RETRANQUEO/DEPENDENCIAS (P1).
// §DISCOVERY-INTERACCIÓN-2.A (empalmes) y .B/.C (retranqueo por prioridad).
// Valida:
//   A) EMPALME
//      - evalEmpalme: número, fórmula '60*phi+1', 'phi', basura → 0.
//      - un componente con empalme ALARGA la dim longitudinal (A en 101A, B en 10x)
//        → largo mayor → peso mayor; el extremo asoma FUERA del hormigón.
//      - 'ambos' alarga el doble; sin empalme = idéntico a base.
//   B) RETRANQUEO
//      - la barra de MENOR prioridad (nº mayor) se desplaza COMPLETA hacia el núcleo.
//      - recta (101A): largo IGUAL, sólo cambia posición.
//      - con patas (103x): patas A/C se ACORTAN en el offset → largo baja → peso baja.
//      - sin prioridad = no-op (generarViga base IDÉNTICA).
//
// Correr con: node tests/test_empalme_dependencias.js

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function aprox(a, b, e) { return Math.abs(a - b) <= (e == null ? 1e-6 : e); }

const host = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

// largo geométrico de una polilínea (suma de segmentos) = espejo del largo real.
function largoPoli(pts) {
  var t = 0;
  for (var i = 1; i < pts.length; i++) {
    var dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y, dz = pts[i].z - pts[i - 1].z;
    t += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return t;
}
function extentX(pts) {
  var mn = Infinity, mx = -Infinity;
  pts.forEach(function (p) { mn = Math.min(mn, p.x); mx = Math.max(mx, p.x); });
  return { min: mn, max: mx };
}

// ===========================================================================
console.log('A1 — evalEmpalme (número / fórmula / basura):');
ok(R.evalEmpalme(25, 1.6) === 25, 'número → 25');
ok(R.evalEmpalme('60*phi+1', 1.6) === 60 * 1.6 + 1, "'60*phi+1' con phi=1.6 → 97");
ok(R.evalEmpalme('60 * phi', 1.0) === 60, "'60 * phi' con phi=1.0 → 60 (espacios ok)");
ok(R.evalEmpalme('phi+5', 2.0) === 7, "'phi+5' → 7");
ok(R.evalEmpalme('40*phi-2', 1.0) === 38, "'40*phi-2' → 38 (resta)");
ok(R.evalEmpalme('', 1.6) === 0, "'' → 0");
ok(R.evalEmpalme(null, 1.6) === 0, 'null → 0');
ok(R.evalEmpalme('rm -rf', 1.6) === 0, 'basura → 0 (parser seguro, sin eval)');

// ===========================================================================
console.log('A2 — EMPALME alarga la dim longitudinal (101A recta):');
var compRectaBase = {
  tipologia: 'CBI', figura: '101A', diam: 18, suf_tipo: 'inf', cara: 'inf',
  dims: { A: { modo: 'fija', valor: 500 } },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
};
var plBase = R.expandirComponente(compRectaBase, host);
var largoBase = largoPoli(plBase[0].puntos);
ok(aprox(largoBase, 500), '101A base: largo geométrico = A = 500 (=' + largoBase.toFixed(1) + ')');

var compRectaEmp = JSON.parse(JSON.stringify(compRectaBase));
compRectaEmp.empalme = { extremo: 'fin', valor: '60*phi+1' };   // phi=1.8cm → 109
var plEmp = R.expandirComponente(compRectaEmp, host);
var largoEmp = largoPoli(plEmp[0].puntos);
var espEmp = 60 * 1.8 + 1;
ok(aprox(plEmp[0].dims.A, 500 + espEmp), 'dim A alargada = 500 + empalme (=' + plEmp[0].dims.A.toFixed(1) + ')');
ok(aprox(largoEmp, 500 + espEmp), 'largo geométrico crece por el empalme (=' + largoEmp.toFixed(1) + ')');
ok(largoEmp > largoBase, 'empalme ALARGA (largo mayor que base)');

console.log('A3 — el empalme asoma por el EXTREMO indicado:');
var extBase = extentX(plBase[0].puntos);
var extFin = extentX(plEmp[0].puntos);
ok(aprox(extFin.min, extBase.min) && extFin.max > extBase.max,
  "extremo 'fin' asoma por +X (min igual, max mayor)");
var compRectaIni = JSON.parse(JSON.stringify(compRectaBase));
compRectaIni.empalme = { extremo: 'inicio', valor: 30 };
var plIni = R.expandirComponente(compRectaIni, host);
var extIni = extentX(plIni[0].puntos);
ok(extIni.min < extBase.min && aprox(extIni.max, extBase.max),
  "extremo 'inicio' asoma por -X (min menor, max igual)");

console.log("A4 — 'ambos' alarga el doble y sin empalme = idéntico:");
var compAmbos = JSON.parse(JSON.stringify(compRectaBase));
compAmbos.empalme = { extremo: 'ambos', valor: 20 };
var plAmbos = R.expandirComponente(compAmbos, host);
ok(aprox(plAmbos[0].dims.A, 500 + 40), "'ambos' suma 2×20 = 40 a la dim (=" + plAmbos[0].dims.A + ')');
var compNoop = JSON.parse(JSON.stringify(compRectaBase));
compNoop.empalme = { extremo: null, valor: 99 };
var plNoop = R.expandirComponente(compNoop, host);
ok(aprox(largoPoli(plNoop[0].puntos), largoBase), 'empalme.extremo=null → no-op (idéntico a base)');

console.log('A5 — EMPALME en 103x alarga el tramo B (no las patas):');
var comp103 = {
  tipologia: 'CBS', figura: '103B', diam: 16, suf_tipo: 'sup', cara: 'sup', angulos: [45, 45],
  dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'fija', valor: 400 }, C: { modo: 'fija', valor: 30 } },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
};
var pl103 = R.expandirComponente(comp103, host);
ok(aprox(pl103[0].dims.B, 400), '103B base: B = 400');
var comp103e = JSON.parse(JSON.stringify(comp103));
comp103e.empalme = { extremo: 'fin', valor: 50 };
var pl103e = R.expandirComponente(comp103e, host);
ok(aprox(pl103e[0].dims.B, 450), 'empalme suma a B (tramo largo) = 450 (=' + pl103e[0].dims.B + ')');
ok(aprox(pl103e[0].dims.A, 30) && aprox(pl103e[0].dims.C, 30), 'las patas A/C NO cambian');

// ===========================================================================
console.log('B1 — RETRANQUEO: sin prioridad = generarViga base IDÉNTICA:');
const S = require(path.join(base, 'semilla_viga.js'));
var outBase = G.generarViga(S.semillaViga(), {});
var outBase2 = G.generarViga(S.semillaViga(), {});
ok(outBase.resumen.barras === outBase2.resumen.barras &&
   Math.abs(outBase.resumen.kg - outBase2.resumen.kg) < 1e-6,
   'sin prioridades → no-op determinista (kg=' + outBase.resumen.kg + ')');

console.log('B2 — RETRANQUEO recta: se desplaza COMPLETA, largo IGUAL:');
// Cabezal recto (prioridad 2, interior) + estribo transversal (prioridad 1, exterior).
var recetaDep = {
  tipo: 'viga',
  geometria: { largo: 600, ancho: 30, alto: 60, recub_sup: 4, recub_inf: 4, recub_lat: 3 },
  componentes: [
    { comp_id: 'es', prioridad: 1, tipologia: 'ES', figura: '104D', diam: 10, cara: 'lateral',
      dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
      distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 20 }], start_offset: 4 } },
    { comp_id: 'cbi', prioridad: 2, tipologia: 'CBI', figura: '101A', diam: 18, cara: 'inf',
      dims: { A: { modo: 'fija', valor: 500 } },
      distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 } }
  ]
};
// SIN resolver (expandimos crudo cada componente) para el largo/posición de referencia.
var cbiCrudo = R.expandirComponente(recetaDep.componentes[1], host);
var yCrudo = cbiCrudo[0].puntos[0].y;
var largoCrudo = largoPoli(cbiCrudo[0].puntos);
// CON resolver (via el pipeline completo con placements).
var plsAll = [];
recetaDep.componentes.forEach(function (c) { plsAll = plsAll.concat(R.expandirComponente(c, host)); });
G.resolverDependencias(plsAll);
var cbiRes = plsAll.filter(function (p) { return p.comp_id === 'cbi'; })[0];
var yRes = cbiRes.puntos[0].y;
var largoRes = largoPoli(cbiRes.puntos);
ok(Math.abs(yRes - yCrudo) > 1e-6, 'la barra recta se DESPLAZA en Y (' + yCrudo.toFixed(1) + ' → ' + yRes.toFixed(1) + ')');
// cara inf → se corre hacia el núcleo = +Y (hacia arriba). offset = φ estribo = 1.0 cm.
ok(aprox(yRes - yCrudo, 1.0), 'desplazamiento = φ prioritaria = 1.0 cm hacia el núcleo (+Y en cara inf)');
ok(aprox(largoRes, largoCrudo), 'recta: largo IGUAL tras retranqueo (' + largoRes.toFixed(1) + ')');
ok(cbiRes._retranqueo === 1.0, '_retranqueo registrado = 1.0');

console.log('B3 — RETRANQUEO con patas (103x): patas ACORTAN, largo BAJA:');
var recetaDep2 = {
  tipo: 'viga',
  geometria: { largo: 600, ancho: 30, alto: 60, recub_sup: 4, recub_inf: 4, recub_lat: 3 },
  componentes: [
    { comp_id: 'es', prioridad: 1, tipologia: 'ES', figura: '104D', diam: 10, cara: 'lateral',
      dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
      distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 20 }], start_offset: 4 } },
    { comp_id: 'cbs', prioridad: 2, tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup', angulos: [45, 45],
      dims: { A: { modo: 'fija', valor: 40 }, B: { modo: 'fija', valor: 400 }, C: { modo: 'fija', valor: 40 } },
      distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 } }
  ]
};
var cbsCrudo = R.expandirComponente(recetaDep2.componentes[1], host);
var largoCbsCrudo = largoPoli(cbsCrudo[0].puntos);
var plsAll2 = [];
recetaDep2.componentes.forEach(function (c) { plsAll2 = plsAll2.concat(R.expandirComponente(c, host)); });
G.resolverDependencias(plsAll2);
var cbsRes = plsAll2.filter(function (p) { return p.comp_id === 'cbs'; })[0];
ok(aprox(cbsRes.dims.A, 40 - 1.0) && aprox(cbsRes.dims.C, 40 - 1.0),
   'patas A/C acortadas en offset (40 → 39, φ estribo=1.0)');
var largoCbsRes = largoPoli(cbsRes.puntos);
ok(largoCbsRes < largoCbsCrudo, 'largo BAJA tras acortar patas (' + largoCbsCrudo.toFixed(1) + ' → ' + largoCbsRes.toFixed(1) + ')');
// El tramo B se corrió adentro (cara sup → -Y), las patas siguen ancladas afuera.
var yBcrudo = cbsCrudo[0].puntos[1].y;   // punto de doblez (inicio del tramo B)
var yBres = cbsRes.puntos[1].y;
ok(aprox(yBcrudo - yBres, 1.0), 'tramo B corrido 1.0 cm hacia el núcleo (-Y en cara sup)');

console.log('B4 — barras paralelas a la prioritaria NO se cruzan → NO se ajustan:');
// Dos cabezales longitudinales (ambos corren en X): prioridad no debe retranquear
// porque tienen la MISMA orientación (no se cruzan).
var recetaPar = {
  tipo: 'viga', geometria: host,
  componentes: [
    { comp_id: 'a', prioridad: 1, tipologia: 'CBI', figura: '101A', diam: 18, cara: 'inf',
      dims: { A: { modo: 'fija', valor: 500 } },
      distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 } },
    { comp_id: 'b', prioridad: 2, tipologia: 'CBI', figura: '101A', diam: 18, cara: 'inf',
      dims: { A: { modo: 'fija', valor: 500 } },
      distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 } }
  ]
};
var plsPar = [];
recetaPar.componentes.forEach(function (c) { plsPar = plsPar.concat(R.expandirComponente(c, host)); });
G.resolverDependencias(plsPar);
var bPar = plsPar.filter(function (p) { return p.comp_id === 'b'; })[0];
ok(bPar._retranqueo == null, 'cabezal paralelo a otro cabezal → NO se retranquea (mismo eje)');

console.log('B5 — determinismo del pipeline completo con dependencias:');
var o1 = G.generarViga(recetaDep2, {});
var o2 = G.generarViga(recetaDep2, {});
ok(o1.resumen.barras === o2.resumen.barras && aprox(o1.resumen.kg, o2.resumen.kg),
   're-generar con dependencias da el mismo resultado');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — empalmes + retranqueo/dependencias pasa.');
