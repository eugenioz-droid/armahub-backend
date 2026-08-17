// =============================================================================
// COLOCACIÓN POR VISTA + TRABA POR POSE — guard de la regla universal (14-ago).
//
// Regla del usuario (confirmada dos veces): la pieza nace EN el plano de la
// vista clickeada, tal como se dibujó, para CUALQUIER tipología. Las cerradas
// y las trabas viven en ese plano (su rumbo es la normal/reparto); las abiertas
// corren dentro de él. Y la traba cruza el eje que dicta su POSE (viga: el alto;
// muro en la sección horizontal: el ESPESOR) — no "el alto" cableado.
//
// Si este guard se rompe, volvió alguna tabla paralela por tipología/elemento.
// =============================================================================
'use strict';
var path = require('path');
var base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorCatalogoFiguras = require(path.join(base, 'catalogo_figuras.js'));
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
var R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));

var fallas = 0;
function ok(cond, msg) {
  if (cond) { console.log('  OK  ' + msg); }
  else { console.log('  FALLA  ' + msg); fallas++; }
}
function bbox(pts) {
  var b = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] };
  (pts || []).forEach(function (q) {
    ['x', 'y', 'z'].forEach(function (e) {
      if (q[e] < b[e][0]) b[e][0] = q[e];
      if (q[e] > b[e][1]) b[e][1] = q[e];
    });
  });
  return b;
}
function span(b, e) { return b[e][1] - b[e][0]; }

var MURO = { largo: 400, alto: 250, ancho: 20, recub_sup: 2.5, recub_inf: 2.5, recub_lat: 2.5 };
var VIGA = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

console.log('— MODELO A: la traba es un longitudinal — entra COMO SE DIBUJÓ —');
// (reescrito 14-ago) El cruce automático murió con el rol traba: con rumbo y la
// 101A corre VERTICAL (como se dibuja una recta de pie), y para CRUZAR el
// espesor la pose corre en z (girada con ESPACIO o clickeando el borde corto).
var trV = { tipologia: 'TR', figura: '101A', diam: 0.8,
  pose: { cara: 'lateral', lado: 1, rumbo: 'y' },
  dims: { A: { modo: 'auto' } },
  distribucion: { modo: 'lineal', rango: { eje: 'x', from: -100, to: 100, sep: 20 } } };
var plsV = R.expandirComponente(trV, MURO);
ok(plsV.length === 11, 'repartida a lo largo (11 barras): n=' + plsV.length);
var bV = bbox(plsV[0].puntos);
ok(span(bV, 'y') > 240 && span(bV, 'y') < 250,
  'con rumbo y corre VERTICAL, como se dibujó (span y=' + span(bV, 'y').toFixed(1) + ')');
ok(bV.z[0] >= 0 && bV.z[1] <= 10, 'pegada a la cortina de su lado (z=' +
  bV.z[0].toFixed(1) + '..' + bV.z[1].toFixed(1) + ')');
ok(!(trV._avisos && trV._avisos.length), 'sin avisos: ' + JSON.stringify(trV._avisos || []));
var tr = { tipologia: 'TR', figura: '101A', diam: 0.8,
  pose: { cara: 'sup', lado: 1, rumbo: 'z' },
  dims: { A: { modo: 'auto' } },
  distribucion: { modo: 'lineal', rango: { eje: 'y', from: -100, to: 100, sep: 20 } } };
var plsTr = R.expandirComponente(tr, MURO);
ok(plsTr.length === 11, 'girada a rumbo z: se reparte en la altura (11): n=' + plsTr.length);
var bTr = bbox(plsTr[0].puntos);
ok(span(bTr, 'z') > 12 && span(bTr, 'z') <= 16,
  'y CRUZA el espesor (span z=' + span(bTr, 'z').toFixed(1) + ', ~15)');
ok(bTr.z[0] >= -10 && bTr.z[1] <= 10, 'dentro del hormigón (' +
  bTr.z[0].toFixed(1) + '..' + bTr.z[1].toFixed(1) + ')');
ok(!(tr._avisos && tr._avisos.length), 'sin avisos: ' + JSON.stringify(tr._avisos || []));
var dimA = plsTr[0].dims && Number(plsTr[0].dims.A);
ok(dimA > 12 && dimA <= 16, 'dim A ~ espesor útil (' + dimA + ')');

console.log('— TRABA de la viga: byte-idéntica a siempre (cruza el alto) —');
var trv = { tipologia: 'TRV', figura: '101A', diam: 1.0, cara: 'lateral', lado: 1,
  dims: { A: { modo: 'auto' } },
  distribucion: { modo: 'lineal', rango: { eje: 'x', from: -280, to: 280, sep: 40 } } };
var plsTrv = R.expandirComponente(trv, VIGA);
var bTrv = bbox(plsTrv[0].puntos);
ok(plsTrv.length === 15, 'reparto de siempre (15): n=' + plsTrv.length);
ok(Number(plsTrv[0].dims.A) === 52, 'dim A = 52 (altoUtil, sin cambio): ' + plsTrv[0].dims.A);
ok(Math.abs(span(bTrv, 'y') - 51.9) < 0.5, 'cruza el ALTO como siempre (span y=' +
  span(bTrv, 'y').toFixed(1) + ')');
ok(span(bTrv, 'z') < 8, 'ganchos en z (span=' + span(bTrv, 'z').toFixed(1) + ')');

console.log('— ESTRIBO cerrado en la sección del muro: en el plano de la vista —');
var ec = { tipologia: 'EC', figura: '104D', diam: 0.8,
  pose: { cara: 'lateral', lado: 1, rumbo: 'y' },
  dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' },
          C: { modo: 'fija', valor: 30 }, D: { modo: 'auto' } },
  distribucion: { modo: 'lineal', rango: { eje: 'y', from: -100, to: 100, sep: 50 } } };
var plsEc = R.expandirComponente(ec, MURO);
ok(plsEc.length >= 4, 'estribo repartido en altura: n=' + plsEc.length);
var bEc = bbox(plsEc[0].puntos);
ok(span(bEc, 'y') < 2, 'plano de la pieza = plano de la vista (span y=' +
  span(bEc, 'y').toFixed(2) + ' ~ 0)');
ok(bEc.z[0] >= -10 && bEc.z[1] <= 10, 'dentro del espesor (' +
  bEc.z[0].toFixed(1) + '..' + bEc.z[1].toFixed(1) + ')');

console.log('— frame de sección pose-aware: 104D todo-auto en la sección del muro —');
// El AUTO de una cerrada llena el marco DE SU PLANO (largo×espesor), no el
// vertical de la viga (que le daba 245 de "alto" a una pieza horizontal).
var ec2 = { tipologia: 'EC', figura: '104D', diam: 0.8,
  pose: { cara: 'lateral', lado: 1, rumbo: 'y' },
  dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
  distribucion: { modo: 'lineal', rango: { eje: 'y', from: 0, to: 0, sep: 50 } } };
var plsEc2 = R.expandirComponente(ec2, MURO);
var d2 = plsEc2[0] && plsEc2[0].dims;
ok(d2 && Math.abs(Number(d2.A) - 15) < 1 || Math.abs(Number(d2.B) - 15) < 1,
  'una de las dims auto ~ espesor útil 15 (A=' + (d2 && d2.A) + ', B=' + (d2 && d2.B) + ')');
// El host llega PERMUTADO al resolver (el motor es pose-aware de fábrica): el
// alto LOCAL de esta pieza horizontal es el LARGO del muro → B ~ 394. Si esto
// baja a ~245 volvió una permutación doble o se perdió la del host.
ok(d2 && Number(d2.B) > 300,
  'la otra dim llena el largo útil del plano (B=' + (d2 && d2.B) + ', esperado ~394)');

console.log('— MISMA FIGURA, CUALQUIER TIPOLOGÍA: resultado idéntico (15-ago) —');
// El bug que cerró este guard: el EJE DE REPARTO salía del rumbo para todo lo que
// no fuera rol 'cabezal', así que una 103C bajo TR/TC pedía su rango sobre su
// PROPIO eje → el motor rechazaba el rango y colocaba 1 barra, mientras la misma
// figura bajo MH/MV se repartía bien. La regla vive ahora en reglas.ejeDistribucion
// y decide por TOPOLOGÍA (cerrada = rumbo · abierta = tercer eje).
(function () {
  var poseC = { cara: 'lateral', lado: 1, rumbo: 'x' };
  var specC = global.ModeladorCatalogoFiguras.get('103C');
  var firmas = ['MH', 'MV', 'TR', 'TC'].map(function (tip) {
    var dims = {};
    (specC.parciales || []).forEach(function (L) { dims[L] = { modo: 'auto' }; });
    var c = { comp_id: 'X', tipologia: tip, figura: '103C', diam: 0.8,
      pose: { cara: poseC.cara, lado: poseC.lado, rumbo: poseC.rumbo }, dims: dims,
      distribucion: { modo: 'linear', rango: { eje: R.ejeDistribucion({ figura: '103C', pose: poseC }),
        from: -100, to: 100, sep: 40 } } };
    var pls = R.expandirComponente(c, MURO);
    return tip + ':' + pls.length + '|' + JSON.stringify(pls[0] && pls[0].dims) +
      '|av' + ((c._avisos || []).length);
  });
  var todasIguales = firmas.every(function (f) {
    return f.split(':')[1] === firmas[0].split(':')[1];
  });
  ok(todasIguales, 'la 103C entra IGUAL bajo MH/MV/TR/TC: ' + JSON.stringify(firmas));
  ok(firmas[0].indexOf(':6|') > 0 && firmas[0].indexOf('av0') > 0,
    'y se reparte de verdad (6 barras, sin avisos): ' + firmas[0]);
})();

console.log('— la SEMILLA no se movió —');
var G = require(path.join(base, 'generar.js'));
var S = require(path.join(base, 'semilla_viga.js'));
var out = G.generarViga(S.semillaViga(), { sector: 'V', ciclo: 'C1', piso: 'P1', eje: 'E1' });
ok(out.resumen.items === 4 && out.resumen.barras === 72 &&
  Math.abs(out.resumen.kg - 136.1) < 0.05,
  'semilla {4, 72, 136.1}: ' + JSON.stringify(out.resumen));

if (fallas) { console.log('\n' + fallas + ' FALLA(S)'); process.exit(1); }
console.log('\nTODO OK');
