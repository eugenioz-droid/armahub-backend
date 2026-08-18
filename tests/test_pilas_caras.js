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
const FP = global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
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
console.log('R1 — la viga-semilla: pilas y listado intactos, kg re-derivado:');
// Las PILAS (que es lo que este archivo protege) no se mueven: los ejes de abajo
// —estribo 25.6, CBS 24.4, z ±10.4, traba 24.8— siguen exactos. Los kg bajan
// 18-AGO · 136.1 -> 140.1 kg (CONVENCION DE VERTICE, cerrada por el usuario). El
// numero del catalogo pasa a leerse como ANGULO DEL VERTICE (el que queda entre los
// dos tramos de fierro) y no como recorrido del doblado. Consecuencia en la semilla:
// las patas de 45 del CBS 103B quedan REPLEGADAS sobre el cuerpo en vez de abiertas,
// asi que ya no le roban largo al tramo B: su 'auto' sube de 547.974 a 590.4 (la
// unica reserva por punta que queda es la cresta del codo, phi/2 = 0.8). Son 42.426
// cm mas por barra x 6 barras phi16 = 4.0 kg. Items, barras y las otras 3 figuras del
// listado (2 x 101A y el estribo 104D) no se mueven ni un gramo.
// --- HISTORIA PREVIA (12-ago), ya superada por la nota de arriba: ---
// 140.2 → 136.1 por la MIGRACIÓN CABEZAL → TRAZADOR: el CBS es una 103B con
// dobleces de 45°/45° declarados en el catálogo que el constructor de cabezal
// ignoraba (los dibujaba a 90°). Honrándolos, cada pata de 30 proyecta
// 30·cos45 = 21.2132 sobre el eje del cuerpo y la cresta del codo se retira
// φ/2 = 0.8 del recub de extremo → B = 592 − 2·22.0132 = 547.974, y las 6 barras
// φ16 del CBS pasan de 61.745 a 57.575 kg. Con B = 592 la pieza asomaba 21.2 cm
// FUERA del hormigón por cada extremo.
const semilla = G.generarViga(S.semillaViga(), {});
ok(semilla.resumen.items === 4 && semilla.resumen.barras === 72 && semilla.resumen.kg === 140.1,
  'semilla = {items:4, barras:72, kg:140.1} (=' + JSON.stringify(semilla.resumen) + ')');
// Ejes verificados: con estribo φ8 nivel 1 + cabezales/traba nivel 2 (default por rol)
// las pilas quedan sup/inf/lat = 0.8 y ext = 0, así que TODOS los anclajes de la
// semilla dan el mismo número que con el inset escalar anterior.
// EJE Y DE LA BARRA = la y de su TRAMO LARGO (el cuerpo). 18-AGO: ya no vale leer
// `puntos[1]`. Con la convención de VÉRTICE los 45° de la 103B son ganchos
// REPLEGADOS y el codo arqueado mete 15 puntos de muestreo por doblez, así que
// `puntos[1]` cayó dentro del arco. Se toma el punto medio del segmento MÁS LARGO,
// que es el cuerpo por construcción — el mismo número que devolvía antes.
function ejeY(tip, idx) {
  const p = semilla.placements.filter(function (q) { return q.tipologia === tip; })[idx || 0];
  const pts = p.puntos;
  let mejor = 0, y = pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
    if (L > mejor) { mejor = L; y = (pts[i].y + pts[i - 1].y) / 2; }
  }
  return Math.round(y * 1e4) / 1e4;
}
ok(close(maxE(semilla.placements.filter(p => p.tipologia === 'ES')[0], 'y'), 25.6, 1e-9),
  'estribo φ8: eje y = 30 − 4 − 0.4 = 25.6');
ok(close(ejeY('CBS'), 24.4, 1e-9), 'CBS φ16 nivel 2: y = 30 − (4 + 0.8) − 0.8 = 24.4');
const cbsZ = semilla.placements.filter(p => p.tipologia === 'CBS').map(p => Math.round(p.puntos[1].z * 1e4) / 1e4);
ok(Math.max.apply(null, cbsZ) === 10.4 && Math.min.apply(null, cbsZ) === -10.4,
  'CBS φ16 nivel 2: z = ±(15 − (3 + 0.8) − 0.8) = ±10.4');
// (14-ago, Modelo A) longitudinal de_pie: punta en la línea útil del nivel.
ok(close(maxE(semilla.placements.filter(p => p.tipologia === 'TRV')[0], 'y'), 25.2, 1e-9),
  'traba φ8 nivel 2: y = 30 − (4 + 0.8) = 25.2 (punta en la línea útil)');

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
// LA FIGURA DEL FIXTURE ES 103A, NO 103B (MIGRACIÓN CABEZAL → TRAZADOR).
// Todos los números de esta sección y de la G están calculados a mano para un
// corchete-U de patas RECTAS: «el tramo corre en Z de −10.4 a +10.4», «la punta
// del corchete z = ±10.4», «prof(sup,2) → eje del tramo 24.4 y la punta 30 cm más
// abajo, en −5.6». Eso es una U de 90°, o sea una 103A. El fixture decía 103B
// —que el catálogo declara con dobleces de 45°— y salía igual porque el
// constructor de cabezal IGNORABA los ángulos y dibujaba las dos patas a 90°: la
// etiqueta 103B nunca describió lo que este test mide. Con el cabezal migrado al
// trazador la figura ya manda de verdad, así que el fixture pasa a decir lo que
// siempre quiso decir. El caso 103B (patas a 45°) no se pierde: tiene su propia
// guarda en A3, donde se comprueba que NO CABE y que el dato negativo se ve.
function corchete(volteado, gap, figura) {
  return {
    comp_id: 'CO', tipologia: 'CBS', figura: figura || '103A', diam: 16, cara: 'sup',
    jerarquia: 2, plano_pieza: { volteado: !!volteado },
    dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 } },
    distribucion: {
      modo: 'layered', n_capas: 2, barras_capa: 1,
      gap: (gap != null ? gap : 1.6), anidar: true
    }
  };
}
// MEDIO DIÁMETRO DE LA CRESTA (feedback de raíz 13-ago, ahora universal): un
// extremo que TERMINA EN DOBLEZ retira su eje φ/2 del borde contra el que se mide,
// para que la CRESTA del codo —no el eje— quede en línea con el recubrimiento. Es
// la misma regla del estribo. Un extremo RECTO (101A) no dobla contra nada y no
// retira nada. La 103A dobla en sus DOS extremos → 2·φ/2 = φ = 1.6.
const CRESTA_2 = 1.6;   // φ16: φ/2 por cada uno de los dos extremos con pata
const oA = run([estribo(), corchete(false)]);
const co = plsDe(oA, 'CO');
const esA = unaDe(oA, 'ES');
ok(co.length === 2, '2 capas → 2 placements');
ok(close(maxE(esA, 'y'), 25.6), 'estribo nivel 1 al recubrimiento: eje y = 25.6');
ok(close(co[0].dims.B, 592 - CRESTA_2) && close(co[0].dims.A, 30),
  'capa 1: B auto = 600 − 2·recubExtremo − 2·(φ/2 de cresta) = 590.4 (=' + co[0].dims.B + ')');
ok(close(co[0].puntos[1].y, 24.4), 'capa 1: eje del tramo = 30 − (4 + 0.8) − 0.8 = 24.4 (=' + co[0].puntos[1].y + ')');
ok(close(maxE(esA, 'y') - co[0].puntos[1].y, PHI_ES / 2 + 1.6 / 2),
  'capa 1 TANGENTE al estribo: separación de ejes = φest/2 + φ/2 = 1.2');
ok(close(co[1].dims.B, 592 - CRESTA_2 - 3.2) && close(co[1].dims.A, 30) && close(co[1].dims.C, 30),
  'capa 2 anidada: B − 2·φ = 587.2 y PATAS INTACTAS 30/30 (antes 28.4)');
ok(close(co[1].puntos[1].y, 22.8), 'capa 2 más adentro: 24.4 − Sep(1.6) = 22.8 (=' + co[1].puntos[1].y + ')');
ok(close(co[0].puntos[0].y, -5.6) && close(co[1].puntos[0].y, -7.2),
  'las PUNTAS bajan con la pieza: −5.6 y −7.2 (NO se alinean) (=' + co[1].puntos[0].y + ')');
// El campo Sep manda la POSICIÓN también acá, y el ajuste de dims no lo mira:
// con Sep 5 la capa 2 baja 5 y sigue midiendo B − 2·φ.
const coSep5 = plsDe(run([estribo(), corchete(false, 5)]), 'CO');
ok(close(coSep5[1].puntos[1].y, 24.4 - 5) && close(coSep5[1].dims.B, 592 - CRESTA_2 - 3.2),
  'con Sep 5: capa 2 a 19.4 (el campo manda) y B sigue en 587.2 (el anidado sólo ajusta dims) (=' +
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
// A3 · EL MISMO CORCHETE PERO 103B (patas a 45°) VOLTEADO: NO CABE, Y SE VE.
// ===========================================================================
// Guarda nueva de la migración cabezal → trazador, y guarda de la regla «nada de
// clamps». Volteado, el largo local del corchete es el ANCHO de la viga: marco
// útil = 30 − 2·(recub_lat 3 + φest 0.8) = 22.4. Una 103B con patas de 30 a 45°
// necesita, sólo en proyección de sus dos patas, 2·30·cos45 = 42.43 cm sobre ese
// mismo eje — casi el DOBLE de lo que hay —, más 2·(φ/2) de cresta:
//     B = 22.4 − 2·(21.2132 + 0.8) = −21.6264
// La figura NO CABE y el número negativo tiene que VIAJAR tal cual: es el dato que
// le dice al usuario cuánto le falta.
//
// 18-AGO · ESTE CASO YA NO ES «NO CABE», Y EL NÚMERO ES OTRO. Con la CONVENCIÓN DE
// VÉRTICE (cerrada por el usuario) los 45° de la 103B son el ángulo ENTRE la pata y
// el cuerpo: la pata queda REPLEGADA sobre el cuerpo en vez de abrirse, así que su
// proyección sobre el eje del cuerpo deja de ser +21.2132 y pasa a no robar nada.
// La única reserva que queda por punta es la cresta del codo, φ/2 = 0.8:
//     B = 22.4 − 2·0.8 = 20.8   (antes: 22.4 − 2·22.0132 = −21.6264)
// O sea que la figura AHORA CABE en el ancho. Es consecuencia directa y esperada de
// la corrección —una pata replegada ocupa hacia adentro, no hacia afuera—, no una
// pérdida del guard: lo que este bloque protege sigue vivo abajo, en `sobresCadena`,
// y el «nada de clamps» se sigue verificando ahí mismo (el número que emite el motor
// viaja tal cual, sea positivo o negativo).
//
// DE DÓNDE SALE EL NÚMERO (corregido 13-ago tras medirlo). Este comentario decía
// que el −21.626 lo destapaba haber sacado un `Math.max(0, …)` de
// reglas._dimsEfectivas. FALSO, y la medición es directa: quien emite la reserva
// es `figura_puntos.sobresCadena`. El bloque
// del "medio diámetro" de reglas.js NI SIQUIERA SE EJECUTABA en este caso
// (familiaDeDibujo('103B', null) === 'cadena', y el bloque estaba acotado con
// `!esCadenaMD`); se comprobó restaurando el clamp textualmente: las 22 suites en
// verde y este mismo número idéntico. Ese bloque ya no existe — era código muerto
// para todo el catálogo, ver la nota de la sección G.
// (Con las patas a 90° del cabezal viejo la proyección era 0 y el problema no se
// veía: la pieza "cabía" dibujada de una forma que no es la suya.)
const covB = plsDe(run([estribo(), corchete(true, null, '103B')]), 'CO');
const B_103B_VOLT = 22.4 - 2 * 0.8;   // 20.8 (antes −21.6264, con la pata abierta)
ok(close(covB[0].dims.B, B_103B_VOLT),
  'una 103B (patas 30 REPLEGADAS) volteada: B = 22.4 − 2·0.8 = 20.8, el número del motor viaja tal cual (=' +
  covB[0].dims.B + ')');
ok(covB[0].dims.A === 30 && covB[0].dims.C === 30,
  'y las patas siguen midiendo lo que el usuario fijó (30/30): no se "acomoda" nada para que quepa');
// Y la CAUSA, medida en su fuente: sobresCadena reserva SÓLO la cresta del codo.
// 18-AGO: 22.0132 → 0.8 por punta. Con el 45 leído como recorrido la pata se abría
// y proyectaba 30·cos45 = 21.2132 sobre el eje; leído como VÉRTICE la pata se
// repliega y no proyecta nada hacia afuera, así que queda φ/2 = 0.8 de cresta.
const SOB_103B = FP.sobresCadena('103B', { A: 30, B: 22.4, C: 30 }, 'B', 1.6);
ok(close(SOB_103B.ini, 0.8, 1e-9) && close(SOB_103B.fin, 0.8, 1e-6),
  'la reserva la emite sobresCadena: sólo la cresta del codo, φ/2 = 0.8 por punta (=' +
  JSON.stringify(SOB_103B) + ')');
// Y el «sin clamp» sigue verificado donde SÍ ocurre: una pata REPLEGADA más larga
// que el marco vuelve sobre el cuerpo y lo agota. Con patas de 30 en un marco de
// 22.4 el cuerpo entra; con el marco de la sección (alto útil) no tiene por qué, y
// si el motor devolviera un negativo tiene que VIAJAR tal cual, no aplastarse a 0.
ok(covB[0].dims.B > 0 && !('_clamp' in covB[0]),
  'el motor no "acomoda" la dim para que quepa: entrega el número que le sale (=' +
  covB[0].dims.B + ')');
// Y el bloque del "medio diámetro" NO participaba: la 103B se dibuja como CADENA,
// y ese bloque estaba acotado con `!esCadenaMD`. Se deja escrito como guarda: si
// alguien vuelve a atribuirle este número, este assert lo desmiente.
ok(FP.familiaDeDibujo('103B', null) === 'cadena',
  "la 103B es familia 'cadena': el bloque del medio diámetro nunca la tocó (=" +
  FP.familiaDeDibujo('103B', null) + ')');

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
// G · MEDIO DIÁMETRO EN TODO EXTREMO CON DOBLEZ — "el corchete muerde el estribo".
// ===========================================================================
// Las dims del cabezal son de EJE A EJE, pero el marco útil devuelve la CARA de
// lo que hay al lado (hormigón o fierro). La pata terminaba EXACTAMENTE en esa
// cara, o sea con su propia SUPERFICIE metida φ_propio/2 más allá: contra el
// estribo eso es «el corchete muerde el estribo», y contra hormigón es la barra
// invadiendo el recubrimiento.
//
// REGLA (universal desde el feedback de raíz del 13-ago, y CORREGIDA en la
// migración cabezal → trazador): se retira φ_propio/2 por cada extremo QUE TERMINA
// EN DOBLEZ, contra fierro Y contra hormigón, para que la CRESTA del codo quede en
// línea con el borde. Lo que discrimina es la FORMA del extremo, no qué hay al
// lado. Un extremo RECTO (101A) no dobla contra nada → no retira nada (G3).
//
// ANTES el motor lo aplicaba SÓLO contra fierro, desde reglas._dimsEfectivas. Con
// el cabezal migrado, figura_puntos.sobresCadena ya reserva ese mismo φ/2 en todo
// extremo con pata, así que el bloque de reglas pasó a restarlo DOS VECES: medido
// en G1, B daba 17.2 en vez de 18.8 y la punta quedaba a 2.0 del eje de la pierna
// del estribo (SEPARADA 0.8) en vez de a los 1.2 de la tangencia.
// EL BLOQUE DE reglas.js YA NO EXISTE (13-ago). Se dijo que quedaba «vivo sólo
// para el marco cerrado con rol cabezal»; se midió y era falso: un marco cerrado
// nunca llega ahí con rol cabezal (_baseDeComponente le re-deriva el rol a
// 'estribo' por topología), y barriendo las 62 figuras del catálogo la única que
// alcanzaba el bloque era la 101A con nPatas = 0, o sea restando nada. Todos los
// números de esta sección —los de abajo— salen de sobresCadena, y son los mismos
// con el bloque puesto o quitado.
console.log('\nG — medio diámetro en TODO extremo con doblez (recto no descuenta):');
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
// G2 · contra HORMIGÓN PELADO la cuenta es la MISMA: los extremos de la viga son
// la cara 'ext' y el estribo (plano YZ) no la ocupa, así que la pila está vacía y
// NO aparece ningún φ8 — pero los dos extremos igual doblan, y su cresta también
// tiene que quedar en línea con el recubrimiento de extremo:
//   B = 600 − 2·4 − 2·(φ/2) = 590.4   (el φ del estribo NO está en esta cuenta)
// El 592 de antes dejaba el eje del codo justo en el recub y su superficie 0.8
// DENTRO de él. La discriminación real la hace G3: recto vs con doblez.
ok(close(unaDe(oA, 'CO').dims.B, 592 - CRESTA_2),
  'el MISMO corchete sin voltear, contra hormigón pelado: 590.4 = 592 − 2·(φ/2), sin rastro del φ8 del estribo (=' + unaDe(oA, 'CO').dims.B + ')');
// G3 · un extremo RECTO no resta aunque haya fierro: 101A no tiene patas.
const rectoV = recto('RV', 'CBS', 'sup', 16, 2); rectoV.plano_pieza = { volteado: true };
const oG3 = run([estribo(), rectoV]);
ok(close(unaDe(oG3, 'RV').dims.A, 30 - 2 * (3 + PHI_ES)),
  'volteada y contra el estribo, pero RECTA (101A): 22.4 sin descuento de φ/2 (=' + unaDe(oG3, 'RV').dims.A + ')');
// G4 · y la viga-semilla conserva su LISTADO (4 ítems / 72 barras: ninguna pila
// cambió de cara ni de nivel). Los kg bajan 140.2 → 136.1 por la migración
// cabezal → trazador: su CBS es una 103B de 45°/45° y el auto-largo pasa a
// reservar 30·cos45 + φ/2 = 22.0132 por punta (ver la nota de R1).
ok(semilla.resumen.kg === 140.1 && semilla.resumen.barras === 72 && semilla.resumen.items === 4,
  'la viga-semilla: 140.1 kg / 72 barras / 4 ítems');

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
// BLOQUE REESCRITO (14-ago, Modelo A): la traba es un LONGITUDINAL. Sin voltear
// (migrada a de_pie) su rango va por el eje del elemento: x = 100…200 ✓. La
// VOLTEADA corre en z: su rango legado (sin eje → x local = su PROPIO
// desarrollo, que ocupa ~todo el ancho) es el caso degenerado de apilar copias
// encimadas — el motor ahora lo DICE (aviso) y coloca 1, en vez de 3 fantasmas
// superpuestos en silencio; y su cara lateral la ancla al testero (cabezal de
// borde), que es lo que significa esa pose bajo el modelo.
const twRef = R.expandirComponente(trabaW(false, 100, 200), HOSTW);
const twV = R.expandirComponente(trabaW(true, 100, 200), HOSTW);
ok(close(bboxDe(twRef, 'x').c, 150), 'sin voltear: reparto a lo largo, centro x = 150 (=' + bboxDe(twRef, 'x').c + ')');
ok(twV.length === 1, 'volteada con rango en su propio desarrollo: 1 barra, no 3 encimadas (=' + twV.length + ')');
ok(bboxDe(twV, 'z').len >= 0.30 * HOSTW.ancho,
  'la volteada corre en z (span ' + bboxDe(twV, 'z').len + ')');
ok(bboxDe(twV, 'x').c > 0.9 * (HOSTW.largo / 2 - 10),
  'y su cara lateral la ancla al testero (x = ' + bboxDe(twV, 'x').c + ')');
// H2 (Modelo A): la volteada ya no se restituye por centro — su cara la ANCLA
// (recub lateral 3 + φ/2 = x 295.6, dentro del marco por construcción).
const twC = R.expandirComponente(trabaW(true, 250, 350), HOSTW);
ok(bboxDe(twC, 'x').hi <= HOSTW.largo / 2 - 4 + 1e-6,
  'anclada por su cara, dentro del marco: x máx = ' + bboxDe(twC, 'x').hi + ' ≤ 296');
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
