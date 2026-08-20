// =============================================================================
// Test headless (Node) de los CUATRO cambios de motor del 12-ago:
//
//   T1 · SEPARACIÓN DE CAPAS = DISTANCIA EJE A EJE.
//        El apilado (layered.gap / arreglo.sep_capas) usaba δ = k·(φ+gap): el
//        usuario escribía 1 y las capas se separaban 1+φ («al poner 1 está
//        sumando esa magnitud adicional»). Ahora el número configurado ES la
//        separación de EJES: δ = k·gap. gap 0 = ejes superpuestos, SIN clamp
//        (dato honesto). El ANIDADO (δ = k·φ) NO cambia.
//
//   T2 · TRAMOS DENTRO DEL RANGO — un estribo @10/@20/@10 en UN componente
//        (rango.tramos = [{long, sep}]). Reparte desde `from`, cada tramo con su
//        @, SIN duplicar la barra de unión, clampeado a `to`, y si los tramos no
//        cubren el rango el último @ CONTINÚA hasta `to`. Sin `tramos`, idéntico.
//
//   T3 · PATAS DIRECCIONALES SIN DERIVA — `orient.spin` SIN `orient.deg` no
//        re-ancla: la barra queda CLAVADA y sólo las patas cambian de dirección,
//        aunque asomen del recubrimiento. Antes el bbox más ancho por las patas
//        giradas disparaba el re-anclaje y TRASLADABA la barra entera («igual
//        mueve de posición el segmento C»). Con `deg` (+ spin) el flujo sigue igual.
//
//   T4 · Δ DE EXTREMO LIBRE — empalme { inicio, fin } con valores INDEPENDIENTES
//        (número o fórmula '40*phi'). La dim longitudinal suma los DOS y cada
//        punta asoma lo suyo. El shape viejo {extremo, valor} sigue idéntico.
//
// Todos los números están calculados A MANO en los comentarios.
// Correr con: node tests/test_capas_tramos_spin_empalme.js
// =============================================================================

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
function r6(v) { return Math.round(v * 1e6) / 1e6; }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// VIGA de trabajo: 600 × 60 (alto) × 30 (ancho), recub 4 (sup) / 4 (inf) / 3 (lat).
// SIN pilas (jer_caras/phi_est): profundidad de cada cara = su recubrimiento, así
// que todos los números salen del recub pelado y se pueden verificar a mano.
const host = { largo: 600, ancho: 30, alto: 60, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

// ===========================================================================
console.log('R0 — la viga-semilla: items/barras intactos, kg re-derivado:');
// Las POSICIONES de las capas ≥2 del CBS sí cambian (5.6 → 4 cm), pero las dims
// no, así que el listado y el conteo son los mismos.
//
// 18-AGO · 136.1 -> 140.1 kg (CONVENCION DE VERTICE, cerrada por el usuario). El
// numero del catalogo pasa a leerse como ANGULO DEL VERTICE (el que queda entre los
// dos tramos de fierro) y no como recorrido del doblado. Consecuencia en la semilla:
// las patas de 45 del CBS 103B quedan REPLEGADAS sobre el cuerpo en vez de abiertas,
// asi que ya no le roban largo al tramo B: su 'auto' sube de 547.974 a 590.4 (la
// unica reserva por punta que queda es la cresta del codo, phi/2 = 0.8). Son 42.426
// cm mas por barra x 6 barras phi16 = 4.0 kg. Items, barras y las otras 3 figuras del
// listado (2 x 101A y el estribo 104D) no se mueven ni un gramo.
// --- HISTORIA PREVIA (12-ago), ya superada por la nota de arriba: ---
// 140.2 → 136.1 kg POR LA MIGRACIÓN CABEZAL → TRAZADOR. El CBS de la semilla es
// una 103B y el catálogo le declara dobleces de 45°/45°. El constructor de
// cabezal los IGNORABA (dibujaba las dos patas a 90°), así que el auto-largo
// resolvía B = largoUtil = 592 sin reservar nada. Honrando los 45° del catálogo,
// cada pata de 30 cm PROYECTA 30·cos45 = 21.2132 cm sobre el propio eje
// longitudinal de la barra, y la cresta del codo tiene que quedar EN LÍNEA con el
// recub de extremo (eje a recub + φ/2 = +0.8). Reserva por punta = 22.0132:
//     B = 592 − 2·22.0132 = 547.974   (con 592 la pieza asomaba 21.2 cm fuera del
//                                      hormigón por CADA extremo)
//     largo CBS = 30 + 547.974 + 30 = 607.974  (antes 652)
//     6 barras φ16: 61.745 → 57.575 kg   ⇒  140.2 − 4.17 = 136.1
// Las otras tres piezas no se mueven ni un decimal (CBI 101A recta, ES 104D
// marco cerrado, TRV 101A recta): siguen 72 barras y 4 ítems.
const semilla = G.generarViga(S.semillaViga(), {});
// 20-AGO · 140.1 -> 140.2 kg (MEDIDA HASTA LA CRESTA, decision del usuario). Un lado
// ya no se mide a VERTICE: es una medida recta que suma R + phi por cada doblez que lo
// cierra (lado = tramo recto + R + phi). El unico numero de la semilla que se mueve es
// el B del CBS 103B phi16: 590.4 -> 592.0, que es la luz util exacta de la viga
// (600 - 2*4); esos 1.6 cm x 6 barras phi16 pesan 0.1 kg. Las patas 30/30 son FIJAS:
// las escribio el usuario y ni la cresta ni el redondeo las tocan.
ok(semilla.resumen.items === 4 && semilla.resumen.barras === 72 && semilla.resumen.kg === 140.2,
  'semilla = {items:4, barras:72, kg:140.2} (=' + JSON.stringify(semilla.resumen) + ')');


// ---------------------------------------------------------------------------
// EL CUERPO DE LA BARRA, SIN DEPENDER DE ÍNDICES (18-ago)
// ---------------------------------------------------------------------------
// Con la CONVENCIÓN DE VÉRTICE (cerrada por el usuario) los 45° que declara la 103B
// son el ángulo ENTRE la pata y el cuerpo, o sea ganchos REPLEGADOS de 135° de
// RECORRIDO. Un recorrido > 90° lo dibuja `_ganchoFinal2D` con el arco calibrado, así
// que la polilínea de una 103B pasa de 4 puntos a 32 y `puntos[1]` / `puntos[2]` ya
// no son las esquinas del tramo largo: caen dentro del muestreo del codo.
// Estos helpers localizan el CUERPO por geometría (el segmento más largo, que es el
// tramo B por construcción en todos los casos de este archivo) y las PUNTAS por
// posición (primer y último punto, que siempre son los extremos libres del fierro).
// Devuelven exactamente los mismos números que `puntos[1..2]` devolvía antes.
const R_CODO = 2 * 1.6 + 1.6 / 2;          // radio de eje del codo con phi16 = 4.0 cm
function iCuerpo(pts) {
  let mejor = -1, idx = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
    if (L > mejor) { mejor = L; idx = i - 1; }
  }
  return idx;                               // el cuerpo va de pts[idx] a pts[idx+1]
}
function cuerpoIni(pts) { return pts[iCuerpo(pts)]; }
function cuerpoFin(pts) { return pts[iCuerpo(pts) + 1]; }
function punta0(pts) { return pts[0]; }
function puntaN(pts) { return pts[pts.length - 1]; }

// ===========================================================================
// T1 · SEPARACIÓN DE CAPAS = EJE A EJE
// ===========================================================================
// CBS 103B φ16 (φ = 1.6 cm) cara sup, 3 capas × 1 barra, apiladas (sin anidar:
// el anidado es opt-in para figuras abiertas).
//   yBorde (eje de la capa 1) = alto/2 − recub_sup − φ/2 = 30 − 4 − 0.8 = 25.2
//   ANTES: capa k a yBorde − k·(φ+gap) = 25.2 − k·6.6   ← el motor sumaba el φ
//   AHORA: capa k a yBorde − k·gap     = 25.2 − k·5.0   ← el gap ES eje a eje
console.log('\nT1 — SEP DE CAPAS = distancia EJE A EJE (layered.gap):');
function capas(gap, n) {
  return R.expandirComponente({
    tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup', angulos: [45, 45],
    dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'fija', valor: 400 }, C: { modo: 'fija', valor: 30 } },
    distribucion: { modo: 'layered', n_capas: n, barras_capa: 1, gap: gap }
  }, host).map(function (p) { return r6(cuerpoIni(p.puntos).y); });   // y del tramo largo
}
const y5 = capas(5, 3);
ok(eq(y5, [25.2, 20.2, 15.2]),
  'gap 5 → capas a 25.2 / 20.2 / 15.2 (paso EXACTO 5, no 6.6 = φ+gap) (=' + JSON.stringify(y5) + ')');
ok(close(y5[0] - y5[1], 5) && close(y5[1] - y5[2], 5), 'el paso entre capas es el gap y nada más');
const y1 = capas(1, 2);
ok(close(y1[0] - y1[1], 1),
  'gap 1 → separación 1 (el bug del usuario: antes daba 2.6 = 1 + φ) (=' + (y1[0] - y1[1]) + ')');
const y0 = capas(0, 3);
ok(eq(y0, [25.2, 25.2, 25.2]),
  'gap 0 → los 3 ejes SUPERPUESTOS, sin clamp a φ: el motor no inventa separación (=' + JSON.stringify(y0) + ')');

console.log('\nT1b — ídem en ARREGLO (sep_capas ya era eje a eje: queda fijado):');
// CBI 101A φ18 (φ = 1.8), arreglo de 3 capas @ sep_capas 7 sobre el eje z.
// z de la capa k = baseEje(0) + k·7 = 0 / 7 / 14  (NO 0 / 8.8 / 17.6).
const zArr = R.expandirComponente({
  tipologia: 'CBI', figura: '101A', diam: 18, cara: 'inf',
  dims: { A: { modo: 'fija', valor: 100 } },
  distribucion: {
    modo: 'arreglo', n_capas: 3, sep_capas: 7, eje_capas: 'z',
    rango: { from: -50, to: 50, sep: 100 }
  }
}, host).map(function (p) { return r6(p.puntos[0].z); });
ok(eq(zArr, [0, 0, 7, 7, 14, 14]),
  'sep_capas 7 → z = 0 / 7 / 14 (2 barras por capa), paso EXACTO 7 (=' + JSON.stringify(zArr) + ')');

// ===========================================================================
// T2 · TRAMOS DENTRO DEL RANGO
// ===========================================================================
console.log('\nT2 — RANGO con TRAMOS (@10 / @20 en un solo componente):');
// CASO DE ACEPTACIÓN, a mano:
//   rango 0..60, tramos [{long:20, sep:10}, {long:20, sep:20}]
//   · tramo 1 [0,20] @10 → n = ceil(20/10)+1 = 3, paso real 10 → 0, 10, 20
//   · tramo 2 [20,40] @20 → n = ceil(20/20)+1 = 2, paso real 20 → 20, 40
//     la barra de unión (20) YA está: se emite UNA sola vez → aporta sólo el 40
//   · los tramos cubren hasta 40 y el rango llega a 60 → el ÚLTIMO @ (20)
//     continúa: [40,60] → 40, 60 → aporta sólo el 60
//   TOTAL = 0, 10, 20, 40, 60  (5 barras)
const p60 = R.posicionesRango({ from: 0, to: 60, tramos: [{ long: 20, sep: 10 }, { long: 20, sep: 20 }] }).map(r6);
ok(eq(p60, [0, 10, 20, 40, 60]),
  'rango 0..60 tramos [{20,@10},{20,@20}] → 0/10/20/40/60 (=' + JSON.stringify(p60) + ')');
ok(p60.length === 5, 'son 5 barras: la de la unión (20) NO se duplica (=' + p60.length + ')');

// RANGO INVERTIDO (to < from): los tramos se ANCLAN en el `from` REAL (hallazgo
// del verificador adversarial: normalizar con min/max ponía el 1er tramo siempre
// a la izquierda — un arrastre derecha→izquierda dejaba el @10 en el extremo
// equivocado, en silencio). 60→0 con [{20,@10},{20,@20}]: el @10 vive en 60..40.
const p60inv = R.posicionesRango({ from: 60, to: 0, tramos: [{ long: 20, sep: 10 }, { long: 20, sep: 20 }] }).map(r6);
ok(eq(p60inv, [0, 20, 40, 50, 60]),
  'rango invertido (60→0): el tramo @10 queda pegado al from real (=' + JSON.stringify(p60inv) + ')');

console.log('\nT2b — el caso real del calculista: 0..600 @10/@20/@10:');
//   · tramo 1 [0,150]   @10 → n = 16 → 0, 10, …, 150
//   · tramo 2 [150,450] @20 → n = 16 → 150(unión), 170, …, 450  → 15 nuevas
//   · tramo 3 [450,600] @10 → n = 16 → 450(unión), 460, …, 600  → 15 nuevas
//   TOTAL = 46 barras (con `zonas` serían 47: esa rama SÍ duplica las uniones).
const pConf = R.posicionesRango({ from: 0, to: 600, tramos: [{ long: 150, sep: 10 }, { long: 300, sep: 20 }, { long: 150, sep: 10 }] }).map(r6);
ok(pConf.length === 46, '46 barras (16 + 15 + 15, sin duplicar las 2 uniones) (=' + pConf.length + ')');
ok(pConf[0] === 0 && pConf[pConf.length - 1] === 600, 'arranca en `from` y CIERRA en `to`');
ok(pConf.indexOf(150) === 15 && pConf.indexOf(450) === 30, 'las uniones (150 / 450) aparecen UNA vez');
ok(eq(pConf.slice(14, 18), [140, 150, 170, 190]), 'el @ cambia EXACTAMENTE en la unión: …140,150 | 170,190… ');
let dupes = 0;
for (let i = 1; i < pConf.length; i++) if (close(pConf[i], pConf[i - 1])) dupes++;
ok(dupes === 0, 'cero posiciones repetidas en todo el rango');

console.log('\nT2c — tramos que NO cubren el rango: el último @ continúa hasta `to`:');
// rango 0..100, tramos [{40, @10}] → 0,10,20,30,40 y luego @10 hasta 100.
const pCola = R.posicionesRango({ from: 0, to: 100, tramos: [{ long: 40, sep: 10 }] }).map(r6);
ok(eq(pCola, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]),
  '0..100 con un solo tramo {40,@10} → @10 hasta el final (=' + pCola.length + ' barras)');

console.log('\nT2d — tramos que se PASAN del rango: clamp a `to`:');
// rango 0..30, tramos [{20,@10},{40,@20}]: el 2º tramo pide llegar a 60.
//   · tramo 1 [0,20] @10 → 0, 10, 20
//   · tramo 2 [20,60] → CLAMP a [20,30] @20 → n = ceil(10/20)+1 = 2, paso 10 → 20(unión), 30
const pClamp = R.posicionesRango({ from: 0, to: 30, tramos: [{ long: 20, sep: 10 }, { long: 40, sep: 20 }] }).map(r6);
ok(eq(pClamp, [0, 10, 20, 30]), 'clampeado a `to`: 0/10/20/30, nada más allá de 30 (=' + JSON.stringify(pClamp) + ')');
ok(pClamp.every(function (x) { return x <= 30 + 1e-9; }), 'ninguna barra fuera del rango');

console.log('\nT2e — SIN tramos el rango queda IDÉNTICO (cero regresión):');
// span 24 @20 → nR = ceil(24/20)+1 = 3, paso real 12 → −12 / 0 / +12 (J4 de test_jerarquia).
const pSin = R.posicionesRango({ from: -12, to: 12, sep: 20 }).map(r6);
ok(eq(pSin, [-12, 0, 12]), 'rango @único con paso real: −12 / 0 / +12 (=' + JSON.stringify(pSin) + ')');
ok(eq(R.posicionesRango({ from: 0, to: 0, sep: 20 }).map(r6), [0]), 'rango degenerado (span 0) → 1 barra');
ok(eq(R.posicionesRango({ from: 0, to: 60, sep: 20, tramos: [] }).map(r6), [0, 20, 40, 60]),
  'tramos = [] se ignora (cae al @ único)');

console.log('\nT2f — los tramos llegan al DISTRIBUIDOR (linear) y respetan rango.eje:');
function xsEstribo(rango) {
  return R.expandirComponente({
    tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral', angulos: [135, 135],
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'linear', rango: rango }
  }, host).map(function (p) { return r6(p.puntos[0].x); });
}
const xTr = xsEstribo({ from: 0, to: 60, eje: 'x', tramos: [{ long: 20, sep: 10 }, { long: 20, sep: 20 }] });
ok(eq(xTr, [0, 10, 20, 40, 60]), 'estribo con tramos → x = 0/10/20/40/60 (=' + JSON.stringify(xTr) + ')');
ok(eq(xsEstribo({ from: 0, to: 60, sep: 20, eje: 'x' }), [0, 20, 40, 60]), 'el mismo componente SIN tramos: @20 parejo');

console.log('\nT2g — VOLTEADO: los tramos reparten sobre el eje permutado (z), no sobre x:');
// _cfgLocal traduce rango.eje ('z' del mundo → 'x' local) y _permPunto devuelve
// los puntos al mundo: las MISMAS 5 posiciones, pero en Z.
const zTr = R.expandirComponente({
  tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral', angulos: [135, 135],
  plano_pieza: { volteado: true },
  dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
  distribucion: { modo: 'linear', rango: { from: 0, to: 60, eje: 'z', tramos: [{ long: 20, sep: 10 }, { long: 20, sep: 20 }] } }
}, host).map(function (p) { return r6(p.puntos[0].z); });
ok(zTr.length === 5, 'volteado con tramos → 5 barras (mismo conteo que sin voltear) (=' + zTr.length + ')');
ok(close(zTr[1] - zTr[0], 10) && close(zTr[2] - zTr[1], 10) && close(zTr[3] - zTr[2], 20) && close(zTr[4] - zTr[3], 20),
  'y con los mismos @ por tramo: 10/10/20/20 sobre Z (=' + JSON.stringify(zTr) + ')');

console.log('\nT2h — ARREGLO con tramos = MISMAS X que el lineal (invariante n_capas=1):');
function xsArreglo(nCapas, tramos) {
  return R.expandirComponente({
    tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral', angulos: [135, 135],
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: {
      modo: 'arreglo', n_capas: nCapas, sep_capas: 8, eje_capas: 'z', anidar: false,
      rango: { from: 0, to: 60, tramos: tramos }
    }
  }, host).map(function (p) { return r6(p.puntos[0].x); });
}
const trm = [{ long: 20, sep: 10 }, { long: 20, sep: 20 }];
ok(eq(xsArreglo(1, trm), xTr), 'arreglo n_capas=1 con tramos == lineal con tramos (misma fuente de posiciones)');
ok(xsArreglo(2, trm).length === 10, 'arreglo 2 capas × 5 posiciones = 10 barras (=' + xsArreglo(2, trm).length + ')');

// ===========================================================================
// T3 · PATAS DIRECCIONALES SIN DERIVA
// ===========================================================================
console.log('\nT3 — SPIN sin `deg`: la barra queda CLAVADA (cero re-anclaje):');
// Corchete 103B φ16, cara sup, A = C = 20 (patas), B = 100, colocado en z = 0.
//   cuerpo (tramo B) a y = 30 − 4 − 0.8 = 25.2, patas hacia abajo hasta y = 5.2
//   spin 90° sobre el eje de la barra (x) → las patas pasan de −Y a −Z:
//   el bbox en z se hace [−20, 0], que se sale del recub lateral (±12).
//   ANTES: el re-anclaje leía "se salió" y TRASLADABA la barra entera +8 en z
//          (el cuerpo se iba de z = 0 a z = 8) → «igual mueve de posición el
//          segmento C». AHORA: delta 0, la pata asoma y se ve.
function corchete(orient) {
  return R.expandirComponente({
    tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup', angulos: [45, 45], orient: orient,
    dims: { A: { modo: 'fija', valor: 20 }, B: { modo: 'fija', valor: 100 }, C: { modo: 'fija', valor: 20 } },
    distribucion: { modo: 'points', positions: [{ z: 0 }] }
  }, host)[0].puntos;
}
// Centro del CUERPO de la barra = punto medio del tramo largo, que es justo el eje
// del spin: tiene que quedar EXACTAMENTE igual. (18-ago: el tramo largo se localiza
// con `iCuerpo`, no con los índices 1 y 2 — ver la nota de los helpers.)
function centroCuerpo(pts) {
  const a = cuerpoIni(pts), b = cuerpoFin(pts);
  return { x: r6((a.x + b.x) / 2), y: r6((a.y + b.y) / 2), z: r6((a.z + b.z) / 2) };
}
const ptsBase = corchete(null);
const ptsSpin = corchete({ eje: 'x', spin: 90 });
ok(eq(centroCuerpo(ptsBase), { x: 0, y: 25.2, z: 0 }), 'sin spin: cuerpo en (0, 25.2, 0)');
ok(eq(centroCuerpo(ptsSpin), centroCuerpo(ptsBase)),
  'con spin 90 el centro de la barra es IDÉNTICO — cero deriva (=' + JSON.stringify(centroCuerpo(ptsSpin)) + ')');
ok(close(cuerpoIni(ptsSpin).x, cuerpoIni(ptsBase).x) && close(cuerpoFin(ptsSpin).x, cuerpoFin(ptsBase).x) &&
  close(cuerpoIni(ptsSpin).y, cuerpoIni(ptsBase).y) && close(cuerpoIni(ptsSpin).z, cuerpoIni(ptsBase).z),
  'los DOS extremos del cuerpo quedan clavados (no sólo el punto medio)');
// MIGRACIÓN CABEZAL → TRAZADOR: la pata de una 103B ya no baja sus 20 cm enteros.
// El cabezal dibujaba las dos patas PERPENDICULARES al cuerpo (90° fijos), así
// que los 20 cm caían enteros sobre la normal de la cara y el spin los llevaba
// enteros a −Z (z = −20).
// 18-AGO · CONVENCIÓN DE VÉRTICE: la penetración pasa de 14.1421 a 20.9706. El 45°
// de la ficha es ahora el ángulo ENTRE la pata y el cuerpo, o sea un gancho
// REPLEGADO de 135° de recorrido, y eso suma dos cosas:
//   · la pata cruza 20·sin45 = 14.1421 en la normal, igual que antes;
//   · pero un recorrido > 90° lo dibuja `_ganchoFinal2D` y la pata cuelga COMPLETA
//     desde la SALIDA DEL ARCO, desplazada R·(1 + cos45) = 4·1.70711 = 6.8284.
//   -> 14.1421 + 6.8284 = 20.9706.
// La pata sigue midiendo lo mismo (20): lo que cambió es su DIRECCIÓN y el arranque.
// Las PUNTAS se leen con punta0/puntaN, no con los índices 0 y 3: con el codo
// arqueado el punto 3 cae dentro del muestreo del arco (medía −5.816).
// 20-AGO · MEDIDA HASTA LA CRESTA: la pata FIJA de 20 ya incluye su doblez (R + φ =
// 4.8 con φ16), así que su tramo recto es 15.2 y la penetración baja de 20.9706 a
// 17.5765. La barra que se corta mide lo mismo; el número incluye ahora el codo.
const SOB_103B = global.ModeladorFiguraPuntos.sobresCresta('103B', 'cabezal', 1.6, null);
const PENETRA_20 = r6((20 - SOB_103B.A) * Math.SQRT1_2 + R_CODO * (1 + Math.SQRT1_2));   // 17.576450
const zPatas = [r6(punta0(ptsSpin).z), r6(puntaN(ptsSpin).z)];
ok(eq(zPatas, [-PENETRA_20, -PENETRA_20]),
  'las PATAS sí giran: pasan de −Y a −Z (z = −' + PENETRA_20 + ') (=' +
  JSON.stringify(zPatas) + ')');
ok(zPatas[0] < -(host.ancho / 2 - host.recub_lat),
  'la pata ASOMA del recubrimiento lateral (−20.97 < −12) y se deja asomar: dato honesto, no se esconde con una traslación');
// El signo del spin manda: −90 manda las patas al otro lado, la barra igual quieta.
const ptsSpinNeg = corchete({ eje: 'x', spin: -90 });
ok(eq(centroCuerpo(ptsSpinNeg), centroCuerpo(ptsBase)) && r6(punta0(ptsSpinNeg).z) === PENETRA_20,
  'spin −90 → patas a +Z (z = +' + PENETRA_20 + ') y el cuerpo sigue clavado');

console.log('\nT3b — con `deg` (rotación real de la pieza) el re-anclaje SIGUE actuando:');
// deg 90 en x (pivote = centro propio) + spin 90: el bbox termina en y ∈ [15.2, 35.2],
// que se pasa del recub superior (26) → re-anclaje −9.2 → max y = 26 EXACTO.
const ptsRotSpin = corchete({ eje: 'x', deg: 90, spin: 90 });
const maxY = r6(Math.max.apply(null, ptsRotSpin.map(function (p) { return p.y; })));
ok(close(maxY, 26), 'deg+spin: re-anclado al recubrimiento superior, max y = 26 (=' + maxY + ')');
ok(!eq(centroCuerpo(ptsRotSpin), centroCuerpo(ptsBase)), 'con deg la pieza SÍ se reorienta y re-ancla (flujo intacto)');

// ===========================================================================
// T4 · Δ DE EXTREMO LIBRE — empalme { inicio, fin } independiente
// ===========================================================================
console.log('\nT4 — empalme {inicio, fin} con valores INDEPENDIENTES:');
// 101A φ18 (φ = 1.8 cm), A fija = 500, empalme { inicio: 10, fin: 20 }.
//   dim A = 500 + 10 + 20 = 530  (los DOS Δ suman al largo → los kilos salen bien)
//   tramo base centrado = 530 − 30 = 500 → x ∈ [−250, 250]
//   asome: xi = −250 − 10 = −260   ·   xf = 250 + 20 = 270
function recta(empalme, diam, largo) {
  const pl = R.expandirComponente({
    tipologia: 'CBI', figura: '101A', diam: diam || 18, cara: 'inf', empalme: empalme,
    dims: { A: { modo: 'fija', valor: largo || 500 } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
  }, host)[0];
  return { A: r6(pl.dims.A), xi: r6(pl.puntos[0].x), xf: r6(pl.puntos[1].x) };
}
const eBase = recta(null);
ok(eq(eBase, { A: 500, xi: -250, xf: 250 }), 'sin empalme: A = 500, x ∈ [−250, 250]');
const eIF = recta({ inicio: 10, fin: 20 });
ok(eIF.A === 530, 'dim A = 500 + 10 + 20 = 530 (suma los DOS extremos) (=' + eIF.A + ')');
ok(eIF.xi === -260 && eIF.xf === 270,
  'asoma 10 por el INICIO (−260) y 20 por el FIN (270), cada punta lo SUYO (=' + eIF.xi + ' / ' + eIF.xf + ')');
ok(r6(eIF.xf - eIF.xi) === 530, 'el largo geométrico coincide con la dim (530)');
ok(r6(eBase.xi - eIF.xi) === 10 && r6(eIF.xf - eBase.xf) === 20,
  'medido contra la barra sin empalme: 10 de un lado, 20 del otro');

console.log('\nT4b — un solo extremo, y FÓRMULAS por extremo:');
const eSoloFin = recta({ fin: 20 });
ok(eq(eSoloFin, { A: 520, xi: -250, xf: 270 }), '{fin:20} → A = 520 y sólo asoma el fin (inicio intacto en −250)');
const eSoloIni = recta({ inicio: 20 });
ok(eq(eSoloIni, { A: 520, xi: -270, xf: 250 }), '{inicio:20} → A = 520 y sólo asoma el inicio');
// φ18 → phi = 1.8 cm; '40*phi' = 72.  A = 500 + 72 + 15 = 587
const eForm = recta({ inicio: '40*phi', fin: 15 });
ok(eq(eForm, { A: 587, xi: -322, xf: 265 }),
  "fórmula '40*phi' (=72) en inicio y 15 cm en fin → A = 587, x ∈ [−322, 265] (=" + JSON.stringify(eForm) + ')');
const eCero = recta({ inicio: 0, fin: 25 });
ok(eq(eCero, { A: 525, xi: -250, xf: 275 }), '{inicio:0} es un 0 REAL (no "ausente"): sólo alarga el fin');

console.log('\nT4c — el shape VIEJO {extremo, valor} no se movió:');
const vFin = recta({ extremo: 'fin', valor: 20 });
ok(eq(vFin, eSoloFin), "{extremo:'fin', valor:20} == {fin:20}");
const vIni = recta({ extremo: 'inicio', valor: 20 });
ok(eq(vIni, eSoloIni), "{extremo:'inicio', valor:20} == {inicio:20}");
const vAmbos = recta({ extremo: 'ambos', valor: 20 });
ok(eq(vAmbos, recta({ inicio: 20, fin: 20 })), "{extremo:'ambos', valor:20} == {inicio:20, fin:20}");
ok(eq(vAmbos, { A: 540, xi: -270, xf: 270 }), "'ambos' = 2× y simétrico: A = 540, x ∈ [−270, 270]");
ok(eq(recta({ extremo: null, valor: 99 }), eBase), 'extremo:null → no-op (idéntico a sin empalme)');
ok(eq(recta({ inicio: 'no-es-una-formula', fin: 10 }), { A: 510, xi: -250, xf: 260 }),
  'un valor ininterpretable vale 0 (documentado), sin romper el otro extremo');

console.log('\nT4d — sobre el TRAMO LARGO (B) de una figura con patas (103B):');
// 103B φ16, A = C = 30 (patas), B fija = 400, empalme {inicio:10, fin:20}
//   dim B = 400 + 30 = 430; tramo base = 400 → x ∈ [−200, 200]
//   x0 = −200 − 10 = −210   ·   x1 = 200 + 20 = 220 (las patas viajan con su punta)
// 18-AGO: el tramo DIBUJADO queda retranqueado el radio del codo por cada punta
// (regla de la cresta), o sea de −206 a +216; la ENVOLVENTE del vértice sigue en
// −210 / +220, que es lo que el empalme corrió.
const pl103 = R.expandirComponente({
  tipologia: 'CBS', figura: '103B', diam: 16, cara: 'sup', angulos: [45, 45],
  empalme: { inicio: 10, fin: 20 },
  dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'fija', valor: 400 }, C: { modo: 'fija', valor: 30 } },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
}, host)[0];
ok(r6(pl103.dims.B) === 430, 'el empalme suma a B (el tramo largo), no a las patas (=' + pl103.dims.B + ')');
ok(r6(pl103.dims.A) === 30 && r6(pl103.dims.C) === 30, 'las patas A y C quedan intactas (30 / 30)');
// 20-AGO: B = 430 es la medida HASTA LA CRESTA, o sea la envolvente; los vértices
// quedan medio sobre más adentro por punta (SOB_103B.B / 2 = 0.8) y el trazo, además,
// retranqueado el radio del codo → −205.2 / 215.2.
ok(r6(cuerpoIni(pl103.puntos).x) === r6(-210 + R_CODO + SOB_103B.B / 2) &&
   r6(cuerpoFin(pl103.puntos).x) === r6(220 - R_CODO - SOB_103B.B / 2),
  'el tramo B asoma 10 / 20 (envolvente en x = −210 / 220; dibujado −205.2 / 215.2 por la cresta del codo) (=' +
  r6(cuerpoIni(pl103.puntos).x) + ' / ' + r6(cuerpoFin(pl103.puntos).x) + ')');
// MIGRACIÓN CABEZAL → TRAZADOR: la PUNTA de cada pata ya no comparte la x de su
// esquina. Con las patas a 90° (lo que dibujaba el cabezal) la punta caía en
// vertical sobre el codo y su x era la misma.
// 18-AGO · CONVENCIÓN DE VÉRTICE: la pata ya no se abre HACIA AFUERA sino que se
// REPLIEGA HACIA ADENTRO (el 45° de la ficha es el ángulo entre pata y cuerpo, o sea
// 135° de recorrido). Arranca en la salida del arco, R·cos45 más allá del extremo
// dibujado del cuerpo, y avanza 30·cos45 de vuelta sobre él:
//     punta = extremoDibujadoDelCuerpo ± (30 − R)·cos45     (signo: hacia ADENTRO)
// Lo que el assert protege es lo mismo de antes —que la punta viaja PEGADA a su
// esquina cuando el empalme corre el tramo—, así que se sigue midiendo contra la
// esquina y no contra un número absoluto; lo que cambió es el signo y el brazo.
const BRAZO_PATA = (30 - SOB_103B.A - R_CODO) * Math.SQRT1_2;   // 14.990663
ok(close(punta0(pl103.puntos).x, cuerpoIni(pl103.puntos).x + BRAZO_PATA) &&
   close(puntaN(pl103.puntos).x, cuerpoFin(pl103.puntos).x - BRAZO_PATA),
  'y las patas acompañan a su extremo, REPLEGADAS los 14.9907 sobre el cuerpo (=' +
  r6(punta0(pl103.puntos).x) + ' / ' + r6(puntaN(pl103.puntos).x) + ')');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — capas eje a eje + tramos en el rango + spin sin deriva + Δ por extremo.');
