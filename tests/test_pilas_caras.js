// Test headless (Node) de las PILAS DE OCUPACIÓN POR CARA (jerarquía volumétrica).
//
// MODELO (el del calculista): cada CARA del hormigón tiene una PILA de ocupación
//   recubrimiento → φmax del nivel 1 → φmax del nivel 2 → …
// Una barra (1) se ancla contra la PROFUNDIDAD ACTUAL de las pilas de las caras
// QUE TOCA, (2) se DERIVA geométricamente qué caras toca (no se declara) y
// (3) aporta su φ a esas caras para los niveles SIGUIENTES. Es un problema 1D
// por cara: no hay detección de colisiones 3D.
//
//   host.jer_caras = { sup:[…], inf:[…], lat:[…], ext:[…] }  (1-BASED)
//   profundidad(cara, nivel) = recub(cara) + Σ_{k<nivel} jer_caras[cara][k]
//
// Caras: 'sup' (y+), 'inf' (y−), 'lat' (z±, pila SIMÉTRICA), 'ext' (x±, los
// extremos, pila SIMÉTRICA). El motor usa el recub VERTICAL como recubrimiento
// de extremo (convención heredada de anchorBase.recubExtremo).
//
// Escenarios (todos con números calculados A MANO en los comentarios):
//   A · CASO DE ACEPTACIÓN — corchete doble anidado pegado al estribo, y el
//       MISMO corchete VOLTEADO (dims y anclajes contra el marco permutado CON
//       las pilas permutadas).
//   B · un cabezal nivel 2 NO se acorta por el estribo en los EXTREMOS (el
//       estribo no ocupa esa cara), pero una traba nivel 2 SÍ se acorta en el
//       alto (el estribo sí ocupa sup/inf).
//   C · dos cabezales nivel 2 en caras DISTINTAS no se empujan entre sí.
//   D · jerarquia:'no' → pegado al recubrimiento y las pilas lo ignoran.
//   E · rotar una pieza nivel 2 la re-ancla al marco de SU nivel, no al hormigón.
//   G · MEDIO DIÁMETRO contra fierro ("el corchete muerde el estribo"): una dim
//       'auto' de cabezal que se resuelve contra una cara CON BARRAS resta además
//       φ_propio/2 por cada extremo que termina en pata. Contra hormigón pelado
//       NO resta nada (la viga-semilla no se mueve).
//   H · VOLTEO: la pieza conserva su CENTRO en los ejes donde ahora es PUNTUAL
//       ("al rotar la pieza se va al centro"); donde se EXTIENDE, no.
//
// Correr con: node tests/test_pilas_caras.js

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));
const S = require(path.join(base, 'semilla_viga.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function close(a, b, t) { return Math.abs(a - b) < (t || 1e-6); }
function maxE(pl, e) { return Math.max.apply(null, pl.puntos.map(function (q) { return q[e]; })); }
function minE(pl, e) { return Math.min.apply(null, pl.puntos.map(function (q) { return q[e]; })); }

// VIGA de trabajo: 600 × 60 (alto) × 30 (ancho), recub 4 (sup) / 4 (inf) / 3 (lat).
const GEO = { largo: 600, ancho: 30, alto: 60, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const PHI_ES = 0.8;   // φ8 del estribo, cm
function run(comps) { return G.generarViga({ tipo: 'viga', geometria: GEO, componentes: comps }, {}); }
function plsDe(o, id) { return o.placements.filter(function (p) { return p.comp_id === id; }); }
function unaDe(o, id) { return plsDe(o, id)[0]; }

// Estribo φ8 de NIVEL 1 — el que manda en las caras de la sección.
function estribo() {
  return {
    comp_id: 'ES', tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral',
    jerarquia: 1, angulos: [135, 135],
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 200 }], start_offset: 4 }
  };
}
// Longitudinal recto 101A (dim A auto) en la cara y nivel que se pidan.
function recto(id, tip, cara, diam, jer) {
  return {
    comp_id: id, tipologia: tip, figura: '101A', diam: diam, cara: cara, jerarquia: jer,
    dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
  };
}

// ===========================================================================
console.log('R1 — CERO REGRESIÓN: la viga-semilla no se mueve:');
const semilla = G.generarViga(S.semillaViga(), {});
ok(semilla.resumen.items === 4 && semilla.resumen.barras === 72 && semilla.resumen.kg === 140.2,
  'semilla = {items:4, barras:72, kg:140.2} (=' + JSON.stringify(semilla.resumen) + ')');
// Ejes verificados: con estribo φ8 nivel 1 + cabezales/traba nivel 2 (default por rol)
// las pilas quedan sup/inf/lat = 0.8 y ext = 0, así que TODOS los anclajes de la
// semilla dan el mismo número que con el inset escalar anterior.
function ejeY(tip, idx) {
  const p = semilla.placements.filter(function (q) { return q.tipologia === tip; })[idx || 0];
  return Math.round(p.puntos[1 % p.puntos.length].y * 1e4) / 1e4;
}
ok(close(maxE(semilla.placements.filter(p => p.tipologia === 'ES')[0], 'y'), 25.6, 1e-9),
  'estribo φ8: eje y = 30 − 4 − 0.4 = 25.6');
ok(close(ejeY('CBS'), 24.4, 1e-9), 'CBS φ16 nivel 2: y = 30 − (4 + 0.8) − 0.8 = 24.4');
const cbsZ = semilla.placements.filter(p => p.tipologia === 'CBS').map(p => Math.round(p.puntos[1].z * 1e4) / 1e4);
ok(Math.max.apply(null, cbsZ) === 10.4 && Math.min.apply(null, cbsZ) === -10.4,
  'CBS φ16 nivel 2: z = ±(15 − (3 + 0.8) − 0.8) = ±10.4');
ok(close(maxE(semilla.placements.filter(p => p.tipologia === 'TRV')[0], 'y'), 24.8, 1e-9),
  'traba φ8 nivel 2: y = 30 − (4 + 0.8) − 0.4 = 24.8');

// ===========================================================================
// A · CASO DE ACEPTACIÓN — corchete doble ANIDADO pegado al estribo.
// ===========================================================================
// Estribo φ8 nivel 1 → pilas tras el nivel 1: sup=inf=lat=0.8, ext=0 (un estribo
// es un plano YZ: toca UN solo extremo, y la pila de 'ext' es simétrica → no la
// ocupa; los longitudinales le pasan POR DENTRO).
// Corchete 103B φ16 nivel 2, cara sup, 2 capas anidadas con Sep 1.6 (fierro
// contra fierro):
//   prof(sup,2) = 4 + 0.8 = 4.8   → eje del tramo: 30 − 4.8 − 0.8 = 24.4
//   eje del estribo arriba:         30 − 4   − 0.4 = 25.6
//   separación de ejes = 25.6 − 24.4 = 1.2 = φest/2 + φ/2 = 0.4 + 0.8  → TANGENTE
//   prof(ext,2) = 4 + 0 = 4       → B auto = 600 − 2·4 = 592 (los extremos de la
//     viga son HORMIGÓN PELADO: el estribo no ocupa esa cara → no se resta φ/2)
//   capa 2: la POSICIÓN la manda el campo Sep (1.6) → tramo y = 24.4 − 1.6 = 22.8
//     y las puntas bajan con ella (−5.6 → −7.2); las DIMS las ajusta el anidado,
//     y eso es independiente del Sep: B − 2·φ = 588.8, PATAS INTACTAS (30/30).
// SEMÁNTICA CORREGIDA POR EL USUARIO (12-ago): «el espaciamiento se lo damos con
// este campo y debe mandar; al ajustar capas anidadas no debe considerar esta
// altura: debe ajustar SOLO la medida de B». Antes el anidado posicionaba solo
// (k·φ) y el campo del usuario no movía nada. Se conserva la corrección anterior:
// «asumiste que las patas deben alinearse con las de la capa de afuera, y eso no
// es correcto».
console.log('\nA — CASO DE ACEPTACIÓN: corchete doble anidado contra el estribo:');
function corchete(volteado, gap) {
  return {
    comp_id: 'CO', tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup',
    jerarquia: 2, angulos: [45, 45], plano_pieza: { volteado: !!volteado },
    dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 } },
    distribucion: {
      modo: 'layered', n_capas: 2, barras_capa: 1,
      gap: (gap != null ? gap : 1.6), anidar: true
    }
  };
}
const oA = run([estribo(), corchete(false)]);
const co = plsDe(oA, 'CO');
const esA = unaDe(oA, 'ES');
ok(co.length === 2, '2 capas → 2 placements');
ok(close(maxE(esA, 'y'), 25.6), 'estribo nivel 1 al recubrimiento: eje y = 25.6');
ok(close(co[0].dims.B, 592) && close(co[0].dims.A, 30),
  'capa 1: B auto = 600 − 2·recubExtremo = 592 (=' + co[0].dims.B + ')');
ok(close(co[0].puntos[1].y, 24.4), 'capa 1: eje del tramo = 30 − (4 + 0.8) − 0.8 = 24.4 (=' + co[0].puntos[1].y + ')');
ok(close(maxE(esA, 'y') - co[0].puntos[1].y, PHI_ES / 2 + 1.6 / 2),
  'capa 1 TANGENTE al estribo: separación de ejes = φest/2 + φ/2 = 1.2');
ok(close(co[1].dims.B, 588.8) && close(co[1].dims.A, 30) && close(co[1].dims.C, 30),
  'capa 2 anidada: B − 2·φ = 588.8 y PATAS INTACTAS 30/30 (antes 28.4)');
ok(close(co[1].puntos[1].y, 22.8), 'capa 2 más adentro: 24.4 − Sep(1.6) = 22.8 (=' + co[1].puntos[1].y + ')');
ok(close(co[0].puntos[0].y, -5.6) && close(co[1].puntos[0].y, -7.2),
  'las PUNTAS bajan con la pieza: −5.6 y −7.2 (NO se alinean) (=' + co[1].puntos[0].y + ')');
// El campo Sep manda la POSICIÓN también acá, y el ajuste de dims no lo mira:
// con Sep 5 la capa 2 baja 5 y sigue midiendo B − 2·φ.
const coSep5 = plsDe(run([estribo(), corchete(false, 5)]), 'CO');
ok(close(coSep5[1].puntos[1].y, 24.4 - 5) && close(coSep5[1].dims.B, 588.8),
  'con Sep 5: capa 2 a 19.4 (el campo manda) y B sigue en 588.8 (el anidado sólo ajusta dims) (=' +
  coSep5[1].puntos[1].y + ' / ' + coSep5[1].dims.B + ')');

// --- el MISMO corchete, VOLTEADO -------------------------------------------
// Voltear = permutar ejes (x local ↔ z mundo) contra un host permutado
// (largo↔ancho). Se permutan las PILAS —jer_caras_ef = { sup, inf, lat: ext,
// ext: lat }— y TAMBIÉN los RECUBRIMIENTOS: los extremos LOCALES son las caras
// laterales REALES, así que su recub es recub_lat (3), no recub_sup (4).
// Entonces, en el marco local:
//   prof_ef(ext,2) = recub_lat + jer_caras.lat[1] = 3 + 0.8 = 3.8
//     → marco = largo_local − 2·3.8 = ancho − 7.6 = 30 − 7.6 = 22.4
//     · permutando la pila pero NO el recub daba 20.4 (2·(recub_sup−recub_lat)
//       = 2 cm de menos: la punta quedaba a 1 cm del estribo, sin tocarlo);
//     · sin permutar la pila daría 24 (se comería el estribo lateral).
//   Y AHORA, ADEMÁS, el MEDIO DIÁMETRO: esa cara ya NO es hormigón pelado (su
//   pila lleva el φ8 del estribo), y las dims del cabezal son de EJE, así que
//   cada extremo del tramo QUE TERMINA EN PATA se retira φ_propio/2 = 0.8:
//     → B auto = 22.4 − 2·0.8 = 20.8   (el número que fijó el usuario)
//   CONTROL geométrico independiente de la fórmula: la punta del corchete (z =
//   ±10.4) y el EJE de la pierna del estribo (z = ±(15 − 3 − 0.4) = ±11.6) quedan
//   a 1.2 = φest/2 + φ/2 → TANGENTES. Con 22.4 la punta caía en z = ±11.2, o sea
//   0.8 DENTRO del estribo: «el corchete muerde el estribo».
//   prof_ef(sup,2) = 4 + 0.8 = 4.8 → eje del tramo = 24.4: SIGUE TANGENTE al
//     estribo (1.2 de separación) en su nuevo plano.
//   capa 2: B − 2·φ = 20.8 − 3.2 = 17.6; patas 30 (intactas); y = 24.4 − Sep = 22.8.
// El tramo ahora corre en Z (de −10.4 a +10.4), no en X.
console.log('\nA2 — el MISMO corchete VOLTEADO (marco, pilas y recubs permutados):');
const oAv = run([estribo(), corchete(true)]);
const cov = plsDe(oAv, 'CO');
ok(close(cov[0].dims.B, 20.8),
  'volteado capa 1: B auto = 30 − 2·(recub_lat + φest) − 2·(φ/2) = 20.8 (=' + cov[0].dims.B + ')');
ok(!close(cov[0].dims.B, 24), 'sin permutar las pilas habría dado 24 (se comía el estribo lateral)');
ok(!close(cov[0].dims.B, 20.4), 'sin permutar el recub habría dado 20.4 (2·(recub_sup−recub_lat) corto)');
ok(!close(cov[0].dims.B, 22.4), 'sin el medio diámetro habría dado 22.4 (la punta mordía el estribo 0.8)');
ok(close(cov[0].puntos[1].y, 24.4) &&
  close(maxE(unaDe(oAv, 'ES'), 'y') - cov[0].puntos[1].y, 1.2),
  'volteado: sigue TANGENTE al estribo en su nuevo plano (y = 24.4, separación 1.2)');
ok(close(maxE(cov[0], 'z'), 10.4) && close(minE(cov[0], 'z'), -10.4),
  'volteado: el tramo corre en Z de −10.4 a +10.4 (B/2 = 10.4)');
ok(close(maxE(unaDe(oAv, 'ES'), 'z') - maxE(cov[0], 'z'), PHI_ES / 2 + 1.6 / 2),
  'volteado: punta y pierna del estribo TANGENTES (separación de ejes = 0.4 + 0.8 = 1.2)');
ok(close(maxE(cov[0], 'x'), 0) && close(minE(cov[0], 'x'), 0), 'volteado: ya no corre en X');
ok(close(cov[1].dims.B, 17.6) && close(cov[1].dims.A, 30),
  'volteado capa 2 anidada: B − 2·φ = 20.8 − 3.2 = 17.6, patas intactas 30');
ok(close(cov[1].puntos[1].y, 22.8) && close(cov[1].puntos[0].y, -7.2),
  'volteado capa 2: y = 24.4 − Sep = 22.8 y la punta baja con la pieza (−7.2)');

// ===========================================================================
// B · el estribo NO ocupa los extremos (CAMBIO DE COMPORTAMIENTO INTENCIONAL).
// ===========================================================================
// Antes había UN inset escalar por nivel, igual para las 4 caras: un cabezal de
// nivel 2 salía 600 − 2·(4 + 0.8) = 590.4, restando un φ8 en unos extremos donde
// el estribo NO está. Con pilas por cara:
//   cabezal nivel 2 (su dim cruza ext/ext): 600 − 2·4 = 592.
//   traba   nivel 2 (su dim cruza sup/inf): 60 − 4.8 − 4.8 = 50.4 (ahí sí manda).
console.log('\nB — el estribo empuja sup/inf/lat pero NO los extremos:');
const traba2 = {
  comp_id: 'TR', tipologia: 'TRV', figura: '101A', diam: 8, cara: 'lateral', jerarquia: 2,
  dims: { A: { modo: 'auto' } },
  distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 300 }], start_offset: 4 }
};
const oB = run([estribo(), recto('CB', 'CBS', 'sup', 16, 2), traba2]);
ok(close(unaDe(oB, 'CB').dims.A, 592),
  'cabezal nivel 2: largo auto = 600 − 2·recubExtremo = 592, SIN φest (=' + unaDe(oB, 'CB').dims.A + ')');
ok(close(unaDe(oB, 'TR').dims.A, 50.4),
  'traba nivel 2: alto auto = 60 − prof(sup) − prof(inf) = 60 − 4.8 − 4.8 = 50.4 (=' + unaDe(oB, 'TR').dims.A + ')');
// Y la razón, derivada geométricamente: se consulta qué caras ocupa cada barra.
const carasES = R.carasOcupadas(unaDe(oB, 'ES'), { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 }, 1);
ok(carasES.indexOf('sup') >= 0 && carasES.indexOf('inf') >= 0 && carasES.indexOf('lat') >= 0 &&
  carasES.indexOf('ext') === -1,
  "derivación: el estribo ocupa sup/inf/lat y NO 'ext' (=" + JSON.stringify(carasES) + ')');
const carasCB = R.carasOcupadas(unaDe(oB, 'CB'), { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3, jer_caras: { sup: [0, 0.8], inf: [0, 0.8], lat: [0, 0.8], ext: [0, 0] } }, 2);
ok(carasCB.indexOf('sup') >= 0 && carasCB.indexOf('ext') >= 0 && carasCB.indexOf('inf') === -1,
  "derivación: el longitudinal ocupa 'sup' (se apoya) y 'ext' (llega a los dos extremos), no 'inf' (=" + JSON.stringify(carasCB) + ')');

// ===========================================================================
// C · caras INDEPENDIENTES: sup e inf son pilas distintas.
// ===========================================================================
// ES φ8 n1 + CBS φ16 n2 (cara sup) + CBI φ20 n2 (cara inf) + CBI φ12 n3 (cara inf):
//   S2: y = +30 − (4 + 0.8) − 0.8 = +24.4
//   I2: y = −30 + (4 + 0.8) + 1.0 = −24.2
//   I3: prof(inf,3) = 4 + 0.8 + 2.0 = 6.8 → y = −30 + 6.8 + 0.6 = −22.6
//       (si la pila de 'sup' contaminara la de 'inf' daría 4 + 0.8 + 1.6 = 6.4)
// Y quitando el CBI n2: prof(inf,3) = 4 + 0.8 + 0 = 4.8 → y = −24.6.
console.log('\nC — pilas independientes por cara (sup vs inf):');
const oC = run([estribo(), recto('S2', 'CBS', 'sup', 16, 2), recto('I2', 'CBI', 'inf', 20, 2), recto('I3', 'CBI', 'inf', 12, 3)]);
ok(close(unaDe(oC, 'S2').puntos[0].y, 24.4), 'S2 (sup, n2, φ16): y = 24.4');
ok(close(unaDe(oC, 'I2').puntos[0].y, -24.2), 'I2 (inf, n2, φ20): y = −24.2 — el φ16 de arriba NO lo empuja');
ok(close(unaDe(oC, 'I3').puntos[0].y, -22.6),
  'I3 (inf, n3, φ12): y = −30 + (4 + 0.8 + 2.0) + 0.6 = −22.6 (lo empuja el φ20 de SU cara, no el φ16 de la otra)');
const oC2 = run([estribo(), recto('S2', 'CBS', 'sup', 16, 2), recto('I3', 'CBI', 'inf', 12, 3)]);
ok(close(unaDe(oC2, 'I3').puntos[0].y, -24.6),
  "sin nada de nivel 2 en 'inf', el nivel 3 inferior sólo ve el estribo: y = −30 + 4.8 + 0.6 = −24.6");
ok(close(unaDe(oC2, 'S2').puntos[0].y, 24.4), 'y el de la cara sup no se movió (=24.4)');

// ===========================================================================
// D · jerarquia:'no' — al recubrimiento pelado y FUERA de la cadena.
// ===========================================================================
//   NO: prof(sup,'no') = 4 → y = 30 − 4 − 0.8 = 25.2  (pegado al recubrimiento,
//       por fuera del estribo: es lo que significa 'no')
//   S2 (nivel 2): la pila de 'sup' sigue valiendo sólo el φ8 del estribo (el 'no'
//       no aporta) → y = 30 − 4.8 − 0.8 = 24.4, IGUAL que sin el 'no'.
console.log("\nD — jerarquia:'no' (al recubrimiento y las pilas lo ignoran):");
const oD = run([estribo(), recto('NO', 'CBS', 'sup', 16, 'no'), recto('S2', 'CBS', 'sup', 16, 2)]);
ok(close(unaDe(oD, 'NO').puntos[0].y, 25.2), "'no': y = 30 − 4 − 0.8 = 25.2 (recubrimiento pelado)");
ok(close(unaDe(oD, 'S2').puntos[0].y, 24.4),
  "el nivel 2 no se entera del 'no': y = 24.4 (si el 'no' aportara φ16 daría 22.8)");
ok(close(unaDe(oD, 'NO').dims.A, 592), "'no': largo auto = 600 − 2·4 = 592 (sin descuentos de pila)");

// ===========================================================================
// D2 · pos_hint — arrastrar una barra a mano NO la saca de la cadena.
// ===========================================================================
// El mismo CBS nivel 2 de la cara sup, arrastrado 6 cm hacia abajo. Su posición
// final cambia (24.4 − 6 = 18.4) pero su APORTE sigue siendo el de su cara
// NATURAL: la pila de 'sup' del nivel 2 conserva el φ16, así que un nivel 3 de
// la cara sup se sigue apoyando en él:
//   prof(sup,3) = 4 + 0.8 + 1.6 = 6.4 → y = 30 − 6.4 − 0.6 = 23.0
// (si el arrastre lo sacara de la cadena, el nivel 3 daría 30 − 4.8 − 0.6 = 24.6)
console.log('\nD2 — pos_hint: mover a mano no cambia de cara en la cadena:');
const cbArr = recto('S2', 'CBS', 'sup', 16, 2); cbArr.pos_hint = { y: -6 };
const oD2 = run([estribo(), cbArr, recto('S3', 'CBS', 'sup', 12, 3)]);
ok(close(unaDe(oD2, 'S2').puntos[0].y, 18.4), 'la barra arrastrada SÍ se mueve (24.4 − 6 = 18.4)');
ok(close(unaDe(oD2, 'S3').puntos[0].y, 23.0),
  'pero sigue aportando a la pila de su cara natural: el nivel 3 sale a 30 − (4 + 0.8 + 1.6) − 0.6 = 23.0 (=' + unaDe(oD2, 'S3').puntos[0].y + ')');

// ===========================================================================
// E · RE-ANCLAJE TRAS ROTAR = marco de SU nivel, no el hormigón pelado.
// ===========================================================================
// 103B φ16 (A=C=20, B=100) nivel 2, cara sup, UNA barra puesta en z=+8, rotada
// 90° en X. El giro es sobre el centro de la propia pieza: queda plana en y=14.4
// y su bbox pasa a ocupar 20 cm en Z (z ∈ [−2, 18]), saliéndose por un lado.
// El clamp la devuelve al MARCO DE SU NIVEL:  z = ±(15 − (3 + 0.8)) = ±11.2
// (con el marco del hormigón pelado daría ±12 y la barra quedaría DENTRO del
//  estribo; se verifica el contraste con la misma pieza en jerarquia:'no').
console.log('\nE — rotar una pieza nivel 2 la devuelve a SU hueco, no al hormigón:');
function rotada(jer) {
  return {
    comp_id: 'RT', tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup',
    jerarquia: jer, angulos: [45, 45], orient: { eje: 'x', deg: 90 },
    dims: { A: { modo: 'fija', valor: 20 }, B: { modo: 'fija', valor: 100 }, C: { modo: 'fija', valor: 20 } },
    distribucion: { modo: 'points', positions: [{ z: 8 }] }
  };
}
const zRot = plsDe(run([estribo(), rotada(2)]), 'RT').map(function (p) { return Math.round(maxE(p, 'z') * 1e4) / 1e4; });
ok(zRot.indexOf(11.2) >= 0, 'nivel 2 rotado: re-anclado a ±(15 − 3 − 0.8) = 11.2 (=' + JSON.stringify(zRot) + ')');
const zRotNo = plsDe(run([estribo(), rotada('no')]), 'RT').map(function (p) { return Math.round(maxE(p, 'z') * 1e4) / 1e4; });
ok(zRotNo.indexOf(12) >= 0,
  "contraste: la misma pieza en 'no' se re-ancla al hormigón pelado, ±(15 − 3) = 12 (=" + JSON.stringify(zRotNo) + ')');

// ---------------------------------------------------------------------------
// E2 · el re-anclaje es una traslación RÍGIDA del componente (no barra a barra).
// ---------------------------------------------------------------------------
// Un componente es un CUERPO RÍGIDO: girarlo y devolverlo adentro no puede
// deformar el reparto de sus barras. Clampeando barra por barra, las que se
// pasaban del mismo lado aterrizaban PEGADAS a la misma pared y se superponían
// (una capa de 3 barras quedaba en 2 → el 3D dibujaba menos barras de las que
// decía el resumen). Con el clamp rígido eso es imposible por construcción.
console.log('\nE2 — el re-anclaje conserva el reparto (traslación rígida):');
function capaGirada(orient) {
  return {
    comp_id: 'CG', tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup',
    jerarquia: 2, angulos: [45, 45], orient: orient,
    dims: { A: { modo: 'fija', valor: 20 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 20 } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 3, gap: 0 }
  };
}
function zCentros(comps, id) {
  return plsDe(run(comps), id).map(function (p) {
    return Math.round(((maxE(p, 'z') + minE(p, 'z')) / 2) * 1e4) / 1e4;
  });
}
const zBase = zCentros([estribo(), capaGirada(null)], 'CG');
ok(JSON.stringify(zBase) === JSON.stringify([-10.4, 0, 10.4]), 'capa de 3 barras sin girar: z = −10.4 / 0 / 10.4');
const zSpin = zCentros([estribo(), capaGirada({ eje: 'x', deg: 0, spin: 90 })], 'CG');
ok(new Set(zSpin).size === 3, 'con spin 90 siguen siendo 3 barras DISTINTAS (=' + JSON.stringify(zSpin) + ')');
ok(close(zSpin[1] - zSpin[0], 10.4) && close(zSpin[2] - zSpin[1], 10.4),
  'y conservan su separación exacta (10.4): la traslación es rígida');
const zRot90 = zCentros([estribo(), capaGirada({ eje: 'y', deg: 90 })], 'CG');
ok(new Set(zRot90).size === 3 && close(zRot90[2] - zRot90[0], 20.8),
  'girada 90° en Y (la barra pasa a cruzar el ancho y NO cabe): no se centra ni se colapsa (=' + JSON.stringify(zRot90) + ')');

// ===========================================================================
// F · el orden de SALIDA no depende del orden de PROCESO.
// ===========================================================================
// Las pilas se construyen por NIVEL ASCENDENTE, así que un nivel 1 declarado al
// final de la receta se procesa PRIMERO. Los placements igual salen en el orden
// de receta.componentes (meta.ci = índice ORIGINAL): el etiquetado no rota.
console.log('\nF — el proceso va por nivel, la SALIDA sigue el orden de la receta:');
const oF = run([recto('A2', 'CBS', 'sup', 16, 2), estribo()]);
ok(oF.placements[0].comp_id === 'A2',
  'el componente 0 de la receta sigue siendo el primer placement, aunque sea nivel 2');
ok(oF.placements[0].meta.ci === 0 && oF.placements[oF.placements.length - 1].meta.ci === 1,
  'meta.ci = índice ORIGINAL en receta.componentes');
ok(close(unaDe(oF, 'A2').puntos[0].y, 24.4),
  'y el nivel 2 igual ve la pila del estribo declarado DESPUÉS que él (y = 24.4)');

// ===========================================================================
// G · MEDIO DIÁMETRO CONTRA FIERRO — "el corchete muerde el estribo".
// ===========================================================================
// Las dims del cabezal son de EJE A EJE, pero el marco útil devuelve la CARA de
// lo que hay al lado. Contra HORMIGÓN la cuenta cierra sola (el recubrimiento se
// mide a la cara del fierro). Contra FIERRO no: la pata terminaba EXACTAMENTE en
// el eje del estribo, o sea metida φ_propio/2 dentro de él.
// Regla: si la pila de la cara contra la que se resuelve la dim 'auto' TIENE
// BARRAS, se resta además φ_propio/2 por cada extremo del tramo QUE TERMINA EN
// PATA. Un extremo recto (101A) no dobla contra nada → no resta.
console.log('\nG — medio diámetro SOLO contra fierro (nunca contra hormigón pelado):');
// G1 · el caso que midió el usuario en pantalla, con recub ÚNICO 4 (recub_lat 4):
//   marco = 30 − 2·(4 + 0.8) = 20.4 → B = 20.4 − 2·0.8 = 18.8
//   punta z = ±9.4 · eje de la pierna del estribo z = ±(15 − 4 − 0.4) = ±10.6
//   separación = 1.2 = φest/2 + φ/2 → TANGENTE.
const GEO4 = { largo: 600, ancho: 30, alto: 60, recub_sup: 4, recub_inf: 4, recub_lat: 4 };
const oG4 = G.generarViga({ tipo: 'viga', geometria: GEO4, componentes: [estribo(), corchete(true)] }, {});
const coG4 = plsDe(oG4, 'CO')[0], esG4 = unaDe(oG4, 'ES');
ok(close(coG4.dims.B, 18.8), 'recub único 4: B = 30 − 2·(4 + 0.8) − 2·(φ/2) = 18.8 (=' + coG4.dims.B + ')');
ok(close(maxE(esG4, 'z') - maxE(coG4, 'z'), PHI_ES / 2 + 0.8),
  'y la punta queda TANGENTE a la pierna del estribo (1.2 de eje a eje), sin morderlo');
// G2 · contra HORMIGÓN PELADO no se resta NADA: los extremos de la viga son la
// cara 'ext', y el estribo (plano YZ) no la ocupa → la pila está vacía.
ok(close(unaDe(oA, 'CO').dims.B, 592),
  'el MISMO corchete sin voltear mide contra hormigón pelado: 592 EXACTO, sin φ/2 (=' + unaDe(oA, 'CO').dims.B + ')');
// G3 · un extremo RECTO no resta aunque haya fierro: 101A no tiene patas.
const rectoV = recto('RV', 'CBS', 'sup', 16, 2); rectoV.plano_pieza = { volteado: true };
const oG3 = run([estribo(), rectoV]);
ok(close(unaDe(oG3, 'RV').dims.A, 30 - 2 * (3 + PHI_ES)),
  'volteada y contra el estribo, pero RECTA (101A): 22.4 sin descuento de φ/2 (=' + unaDe(oG3, 'RV').dims.A + ')');
// G4 · y la viga-semilla, que se mide contra hormigón pelado en los extremos, no
// se mueve NI UN DECIMAL (la garantía de no-regresión de toda esta tarea).
ok(semilla.resumen.kg === 140.2 && semilla.resumen.barras === 72 && semilla.resumen.items === 4,
  'la viga-semilla sigue BYTE-IDÉNTICA: 140.2 kg / 72 barras / 4 ítems');

// ===========================================================================
// H · VOLTEO — la pieza CONSERVA SU CENTRO donde ahora es puntual.
// ===========================================================================
// "Al rotar la pieza se va al centro" (usuario). La permutación x↔z no sólo
// reorienta: también le cambia la POSICIÓN, porque su coordenada a lo largo pasa
// a salir de su coordenada a lo ancho. Criterio: la pieza volteada conserva su
// centro en cada eje del mundo DONDE AHORA ES PUNTUAL (span < 30% de la dimensión
// del host); los ejes donde AHORA SE EXTIENDE no se restituyen.
console.log('\nH — volteo: restituye el centro donde la pieza es PUNTUAL:');
function bboxDe(pls, e) {
  var lo = Infinity, hi = -Infinity;
  pls.forEach(function (pl) { pl.puntos.forEach(function (p) { if (p[e] < lo) lo = p[e]; if (p[e] > hi) hi = p[e]; }); });
  return { lo: lo, hi: hi, c: (lo + hi) / 2, len: hi - lo };
}
// H1 · TRABA en un elemento ANCHO (600 × 300), repartida a lo largo entre x=100 y
// x=200 (centro 150). Volteada, su x pasa a salir de su z local (≈0) → aparecía en
// x ≈ −3.75, o sea en MITAD del elemento. Ahora vuelve a x = 150.
const HOSTW = { largo: 600, ancho: 300, alto: 60, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
function trabaW(volteado, from, to) {
  return {
    comp_id: 'TW', tipologia: 'TRV', figura: '101A', diam: 8, cara: 'lateral', jerarquia: 'no',
    plano_pieza: { volteado: !!volteado }, dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'linear', rango: { from: from, to: to, sep: 50 } }
  };
}
const twRef = R.expandirComponente(trabaW(false, 100, 200), HOSTW);
const twV = R.expandirComponente(trabaW(true, 100, 200), HOSTW);
ok(close(bboxDe(twRef, 'x').c, 150), 'sin voltear: la pieza está a lo largo en x = 150 (=' + bboxDe(twRef, 'x').c + ')');
ok(twV.length === twRef.length, 'volteada: mismo nº de barras (=' + twV.length + ')');
ok(close(bboxDe(twV, 'x').c, 150),
  'volteada: CONSERVA su x = 150 en vez de irse al centro del elemento (=' + bboxDe(twV, 'x').c + ')');
ok(bboxDe(twV, 'x').len < 0.30 * HOSTW.largo && bboxDe(twV, 'z').len >= 0.30 * HOSTW.ancho,
  'porque en x es PUNTUAL (span ' + bboxDe(twV, 'x').len + ') y en z ahora SE EXTIENDE (span ' + bboxDe(twV, 'z').len + ')');
ok(close(bboxDe(twV, 'z').lo, 100) && close(bboxDe(twV, 'z').hi, 200),
  'y el eje donde se extiende NO se restituye: el reparto sigue de z = 100 a 200');
ok(new Set(twV.map(function (pl) { return Math.round(bboxDe([pl], 'z').c * 1e4) / 1e4; })).size === twV.length,
  'la restitución es una traslación RÍGIDA: las barras no se fusionan ni pierden su reparto');
// H2 · CLAMP: si el centro restituido deja la pieza pasada del recubrimiento, se
// clampea al marco de su nivel (aquí 'no' → el hormigón menos el recub: 296).
const twC = R.expandirComponente(trabaW(true, 250, 350), HOSTW);
ok(close(bboxDe(twC, 'x').hi, HOSTW.largo / 2 - 4),
  'centro restituido fuera de rango → clampeado al marco: x máx = 296 (=' + bboxDe(twC, 'x').hi + ')');
// H3 · el ejemplo del propio usuario: el x de un estribo volteado que ahora
// ENVUELVE el largo NO se restituye (ahí la pieza ya no "está en un punto"); su z,
// que sí quedó puntual, vuelve al 0 que tenía en vez de irse a z = 200 (fuera).
function estriboPt(volteado) {
  var e = estribo();
  e.plano_pieza = { volteado: !!volteado };
  e.distribucion = { modo: 'points', positions: [{ x: 200 }] };
  return e;
}
const epRef = R.expandirComponente(estriboPt(false), GEO);
const epV = R.expandirComponente(estriboPt(true), GEO);
ok(close(bboxDe(epRef, 'x').c, 200) && close(bboxDe(epRef, 'z').c, 0),
  'sin voltear: sección en x = 200, centrada en el ancho (z = 0)');
ok(bboxDe(epV, 'x').len > 0.30 * GEO.largo && close(bboxDe(epV, 'x').c, 0),
  'volteado: en x AHORA SE EXTIENDE (envuelve el largo) → no se restituye (=' + bboxDe(epV, 'x').len.toFixed(1) + ')');
ok(close(bboxDe(epV, 'z').c, 0),
  'volteado: en z es puntual → vuelve a su z de antes (0) en vez de quedar en z = 200, fuera de la viga');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — pilas de ocupación por cara (jerarquía volumétrica).');
