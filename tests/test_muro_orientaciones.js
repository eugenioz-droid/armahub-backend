// =============================================================================
// Test headless (Node) de la TANDA 1 — MURO: cara CORTINA + set de ORIENTACIONES.
//
//   L1 · CARA LATERAL (bug reportado 12-ago: una barra 'lateral' aterrizaba en la
//        cara INFERIOR). El anclaje de un longitudinal salía de _yBordeCabezal,
//        que sólo distinguía sup/inf. Ahora hay UN marco de cara (_marcoCara) y la
//        cara lateral es el ESPEJO exacto de sup/inf con Y y Z intercambiados:
//        se pega en Z (±ancho/2 ∓ prof(lat) ∓ φ/2), las CAPAS entran hacia el
//        núcleo en Z y las barras de la capa se reparten en Y (alto útil, con las
//        pilas sup e inf que son INDEPENDIENTES). Las patas del gancho salen por
//        la normal de la cara (Z), no por Y.
//
//   L2 · ORIENTACIÓN DE PIE (x↔y) — el set de orientaciones generaliza el volteo:
//        'acostada' (identidad) | 'volteada' (x↔z) | 'de_pie' (x↔y), con
//        `volteado:true` ≡ 'volteada' por compatibilidad. La permutación alcanza
//        dims del host, recubrimientos, pilas, ejes del rango/capas y los puntos.
//
//   L3 · MURO 400×250×20 END-TO-END (largo=x, alto=y, espesor→ancho=z;
//        recub_caras→recub_lat 2.5, recub_bordes→recub_sup/inf 3): cortinas
//        horizontales ancladas a z = ±(10 − 2.5 − φ/2), cortina VERTICAL de pie
//        de borde a borde en Y, malla en modo ARREGLO (rango × capas) y trabas
//        que cosen las dos cortinas corriendo en Z.
//
// Todos los números están calculados A MANO en los comentarios.
// Correr con: node tests/test_muro_orientaciones.js
// =============================================================================

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function close(a, b, t) { return Math.abs(a - b) < (t || 1e-6); }
function r3(v) { return Math.round(v * 1e3) / 1e3; }
function lim(pl, e) {
  const v = pl.puntos.map(p => p[e]);
  return { lo: r3(Math.min(...v)), hi: r3(Math.max(...v)) };
}
function centro(pl, e) { const l = lim(pl, e); return r3((l.lo + l.hi) / 2); }
function unicos(pls, e) { return [...new Set(pls.map(p => centro(p, e)))].sort((a, b) => a - b); }

const viga = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

// ===========================================================================
// L1 · CARA LATERAL (cortina) en una viga — el bug vivo antes del muro.
// ===========================================================================
// Cabezal 103B φ16 (φ = 1.6), cara lateral, 2 capas × 3 barras, Sep 5, patas 10.
//   z de la capa 1 = ancho/2 − recub_lat − φ/2 = 15 − 3 − 0.8 = 11.2
//   z de la capa 2 = 11.2 − Sep = 6.2                (hacia el NÚCLEO)
//   patas: salen en −Z (al núcleo) → la punta llega a 11.2 − 10·sin45 = 4.1289
//   reparto de la capa en Y = alto útil: ±(30 − 4 − 0.8) = ±25.2, y la del medio 0
//
// MIGRACIÓN CABEZAL → TRAZADOR: la punta de la pata ya NO llega a 11.2 − 10 = 1.2.
// El constructor de cabezal dibujaba las patas PERPENDICULARES a la cara (90°
// fijos), así que los 10 cm de pata cruzaban enteros hacia el núcleo.
//
// 18-AGO · CONVENCIÓN DE VÉRTICE (cerrada por el usuario) — la penetración pasa de
// 7.071 a 13.899. Los 45° que declara la 103B son ahora el ángulo ENTRE la pata y el
// cuerpo, o sea un gancho REPLEGADO de 135° de RECORRIDO. Dos efectos que se suman:
//   · la pata sigue midiendo 10 y cruzando 10·sin45 = 7.0711 en Z;
//   · pero un recorrido > 90° lo dibuja `_ganchoFinal2D` con el arco calibrado, y la
//     pata cuelga COMPLETA desde la SALIDA DEL ARCO, que está desplazada respecto de
//     la cadena de vértices: R·(1 + cos45) = 4·1.70711 = 6.8284 más.
//   → penetración total = 7.0711 + 6.8284 = 13.8995 y la punta queda en
//     11.2 − 13.8995 = −2.6995 (antes 4.1289 con la lectura de recorrido).
// Lo que estos asserts protegen (QUÉ cara, qué SIGNO, que el arrastre sea traslación
// pura y no un cambio de lado) no cambia: sólo se mide la penetración real.
//
// ANTES: cara 'lateral' caía en la rama `else` de _yBordeCabezal y la barra se
// anclaba en y = −25.2, o sea PEGADA A LA CARA INFERIOR, con z = 0 (al centro).
// r3 para comparar con lim(), que también redondea a 3 decimales.
const R_CODO_16 = 2 * 1.6 + 1.6 / 2;                                    // 4.0 con φ16
const PATA_Z_45 = r3(10 * Math.SQRT1_2 + R_CODO_16 * (1 + Math.SQRT1_2));  // 13.899
console.log('L1 — CARA LATERAL = cara CORTINA (espejo de sup/inf con Y↔Z):');
function cabLateral(extra) {
  return Object.assign({
    tipologia: 'CB', figura: '103B', diam: 16, cara: 'lateral', angulos: [45, 45],
    dims: { A: { modo: 'fija', valor: 10 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 10 } },
    distribucion: { modo: 'layered', n_capas: 2, barras_capa: 3, gap: 5 }
  }, extra || {});
}
const pl1 = R.expandirComponente(cabLateral(), viga);
const c1 = pl1.filter(p => p.meta.capa === 1), c2 = pl1.filter(p => p.meta.capa === 2);
ok(pl1.length === 6 && c1.length === 3, '2 capas × 3 barras = 6 placements');
ok(c1.every(p => close(lim(p, 'z').hi, 11.2)),
  'capa 1 PEGADA a la cara Z+: eje z = ancho/2 − recub_lat − φ/2 = 11.2 (=' + lim(c1[0], 'z').hi + ')');
ok(c1.every(p => close(lim(p, 'z').lo, 11.2 - PATA_Z_45)),
  'las patas salen por la NORMAL de la cara (−Z, al núcleo): punta en 11.2 − 13.899 = −2.699 (=' + lim(c1[0], 'z').lo + ')');
ok(c2.every(p => close(lim(p, 'z').hi, 11.2 - 5)),
  'capa 2 entra hacia el núcleo EN Z: 11.2 − Sep = 6.2 (=' + lim(c2[0], 'z').hi + ')');
ok(JSON.stringify(unicos(c1, 'y')) === JSON.stringify([-25.2, 0, 25.2]),
  'las barras de la capa se reparten en Y (alto útil ±25.2), no en Z (=' + JSON.stringify(unicos(c1, 'y')) + ')');
ok(!pl1.some(p => close(centro(p, 'y'), -25.2) && close(centro(p, 'z'), 0)),
  'NINGUNA barra aterriza en la cara inferior con z=0 (el bug reportado)');
// LADO DE LA CORTINA (hallazgo B del verificador, corregido 12-ago) — es un DATO
// PROPIO del componente (`comp.lado` = 1 | −1, default 1), NO el signo de
// pos_hint.z. Antes el pos_hint elegía el lado Y ADEMÁS se sumaba entero, así que
// arrastrando y cruzando z = 0 la barra pegaba un salto de 2·11.2 = 22.4 cm.
//   lado −1 → eje en −11.2, patas hacia +Z → z ∈ [−11.2, −4.1289]
const plNeg = R.expandirComponente(cabLateral({ lado: -1 }), viga);
ok(close(lim(plNeg[0], 'z').lo, -11.2) && close(lim(plNeg[0], 'z').hi, -(11.2 - PATA_Z_45)),
  'comp.lado = −1 → cortina de −Z (eje −11.2, patas hacia +Z hasta 2.699) (=' +
  JSON.stringify(lim(plNeg[0], 'z')) + ')');
// pos_hint = TRASLACIÓN PURA: con lado +1 (default) un arrastre a z negativo NO
// cambia de cara, sólo corre la barra: [4.1289, 11.2] − 1 = [3.1289, 10.2].
const plHint = R.expandirComponente(cabLateral({ pos_hint: { z: -1 } }), viga);
ok(close(lim(plHint[0], 'z').lo, 11.2 - PATA_Z_45 - 1) && close(lim(plHint[0], 'z').hi, 10.2),
  'pos_hint.z NO elige lado: traslada la cortina +Z 1 cm (=' +
  JSON.stringify(lim(plHint[0], 'z')) + ')');
// CONTINUIDAD AL CRUZAR z = 0 ARRASTRANDO (el salto de 22.4 cm): la UI escribe
// pos_hint.z como delta acumulado. Dos posiciones consecutivas del arrastre
// (−11 y −12, que cruzan el eje) tienen que quedar a 1 cm exacto una de otra.
const zA = lim(R.expandirComponente(cabLateral({ pos_hint: { z: -11 } }), viga)[0], 'z');
const zB = lim(R.expandirComponente(cabLateral({ pos_hint: { z: -12 } }), viga)[0], 'z');
ok(close(zA.hi - zB.hi, 1) && close(zA.lo - zB.lo, 1),
  'arrastre continuo al cruzar z=0: 1 cm de delta, sin salto de 22.4 (Δhi=' +
  r3(zA.hi - zB.hi) + ')');
// Y el lado NO se toca por arrastrar: sigue siendo la cortina +Z (patas al núcleo,
// o sea hacia −Z: el punto más bajo en z es la punta de la pata).
ok(close(zB.hi, 11.2 - 12) && close(zB.lo, 11.2 - PATA_Z_45 - 12),
  'el arrastre no cambia el lado: sigue anclada a +Z, sólo trasladada (=' +
  JSON.stringify(zB) + ')');
// El recubrimiento de la cara lateral es recub_lat (3), NO el vertical (4): antes
// _baseDeComponente le daba recub_sup a cualquier cara que no fuera 'inf'.
const plOvr = R.expandirComponente(cabLateral({ recub_override: 5 }), viga);
ok(close(lim(plOvr[0], 'z').hi, 15 - 5 - 0.8),
  'recub_override manda sobre la cara lateral: z = 15 − 5 − 0.8 = 9.2 (=' + lim(plOvr[0], 'z').hi + ')');

// ANIDADO × CARA LATERAL: el anidado sólo toca DIMS; la posición de la capa la
// manda Sep, también contra una cara cortina (aquí las capas entran en Z).
const plAn = R.expandirComponente(cabLateral({
  distribucion: { modo: 'layered', n_capas: 2, barras_capa: 1, gap: 5, anidar: true }
}), viga);
ok(close(plAn[1].dims.B, plAn[0].dims.B - 2 * 1.6) && close(plAn[1].dims.A, 10),
  'anidado en cara lateral: B − 2·φ y patas intactas (=' + plAn[1].dims.B + ' / ' + plAn[1].dims.A + ')');
ok(close(lim(plAn[1], 'z').hi, lim(plAn[0], 'z').hi - 5),
  'y la capa 2 entra EXACTAMENTE Sep (5) en Z, no un φ (=' +
  r3(lim(plAn[0], 'z').hi - lim(plAn[1], 'z').hi) + ')');

// ===========================================================================
// L2 · SET DE ORIENTACIONES — 'acostada' | 'volteada' (x↔z) | 'de_pie' (x↔y).
// ===========================================================================
console.log('\nL2 — SET DE ORIENTACIONES (el volteo generalizado):');
ok(R.orientacionPieza({}) === 'acostada' &&
  R.orientacionPieza({ plano_pieza: { volteado: true } }) === 'volteada' &&
  R.orientacionPieza({ plano_pieza: { orientacion: 'de_pie' } }) === 'de_pie',
  "compat: `volteado:true` ≡ 'volteada'; `orientacion` explícita gana");
ok(R.ejeDistribucion({ plano_pieza: { orientacion: 'de_pie' } }) === 'y' &&
  R.ejeDistribucion({ plano_pieza: { orientacion: 'volteada' } }) === 'z' &&
  R.ejeDistribucion({}) === 'x',
  'ejeDistribucion: acostada x · volteada z · de pie y (lo consume la flecha de rango)');
ok(R.ejeCapas({ plano_pieza: { orientacion: 'de_pie' } }, 'x') === 'y' &&
  R.ejeCapas({ plano_pieza: { orientacion: 'de_pie' } }, 'z') === 'z',
  'ejeCapas permuta con la misma tabla (x↔y, z queda)');
// CERO REGRESIÓN: 'acostada' explícita = sin plano_pieza = byte a byte.
const acost = R.expandirComponente(cabLateral({ plano_pieza: { orientacion: 'acostada' } }), viga);
ok(JSON.stringify(acost) === JSON.stringify(R.expandirComponente(cabLateral(), viga)),
  "'acostada' produce placements IDÉNTICOS a no declarar orientación");

// DE PIE en la viga: el cabezal deja de correr a lo largo (x) y corre en ALTO (y).
//   largo_local = alto real = 60; su recub de extremo local = el de las caras y±
//   → B auto = 60 − 2·4 = 52, centrado → y ∈ [−26, 26].
const dePie = R.expandirComponente({
  tipologia: 'CB', figura: '101A', diam: 16, cara: 'lateral',
  plano_pieza: { orientacion: 'de_pie' },
  dims: { A: { modo: 'auto' } },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0 }
}, viga);
ok(dePie.length === 2 && close(dePie[0].dims.A, 52),
  'de pie: la dim auto se mide contra las caras que ahora cierran la barra (60 − 2·4 = 52) (=' + dePie[0].dims.A + ')');
ok(close(lim(dePie[0], 'y').lo, -26) && close(lim(dePie[0], 'y').hi, 26) && close(lim(dePie[0], 'x').lo, lim(dePie[0], 'x').hi),
  'de pie: la barra corre en Y (−26 … 26) y ya no se extiende en X (=' + JSON.stringify(lim(dePie[0], 'y')) + ')');
ok(close(lim(dePie[0], 'z').hi, 11.2),
  'de pie: sigue pegada a su cara CORTINA (z = 11.2): la permutación no le mueve el recubrimiento');
ok(dePie.every(p => p.meta.orientacion === 'de_pie'), 'meta.orientacion estampada');

// CONTRATO DEL VALOR (hallazgo C del verificador): el motor NORMALIZA lo que lee
// (String(v).toLowerCase().trim()). Antes comparaba el literal, así que una receta
// con 'DE_PIE' o ' Volteada ' — perfectamente posible en un JSON que no venga del
// editor — caía en 'acostada' SIN ERROR y la pieza salía en otro plano.
function dePieCon(valor) {
  return R.expandirComponente({
    tipologia: 'CB', figura: '101A', diam: 16, cara: 'lateral',
    plano_pieza: { orientacion: valor },
    dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0 }
  }, viga);
}
['DE_PIE', 'De_Pie', ' de_pie '].forEach(function (v) {
  const p = dePieCon(v)[0];
  ok(p.meta.orientacion === 'de_pie' && close(lim(p, 'y').lo, -26) && close(lim(p, 'y').hi, 26),
    "orientacion '" + v + "' se lee case-insensitive → de_pie (y ∈ [−26,26]) (=" +
    p.meta.orientacion + ' ' + JSON.stringify(lim(p, 'y')) + ')');
});
ok(R.expandirComponente(cabLateral({ plano_pieza: { orientacion: 'VOLTEADA' } }), viga)[0].meta.orientacion === 'volteada',
  "'VOLTEADA' (mayúsculas) ≡ 'volteada', no cae en 'acostada'");
// Un valor que NO existe sigue cayendo al fallback documentado (volteado/acostada):
// normalizar no es adivinar.
ok(R.expandirComponente(cabLateral({ plano_pieza: { orientacion: 'diagonal', volteado: true } }), viga)[0].meta.orientacion === 'volteada',
  "valor desconocido → fallback a `volteado` (no se inventa una orientación)");

// ===========================================================================
// L3 · MURO 400×250×20 — END TO END.
// ===========================================================================
// largo = x = 400 · alto = y = 250 · espesor → ancho = z = 20
// recub_caras → recub_lat = 2.5 · recub_bordes → recub_sup = recub_inf = 3
//   cortina (φ10): z = ±(20/2 − 2.5 − 0.5) = ±7
//   barra horizontal: A auto = 400 − 2·3 = 394   (bordes)
//   barra de pie:     A auto = 250 − 2·3 = 244   (bordes, ahora en el otro eje)
//   traba volteada:   A auto = 20 − 2·2.5 = 15   (caras)
console.log('\nL3 — MURO 400×250×20 (recub caras 2.5 / bordes 3):');
const muro = { largo: 400, alto: 250, ancho: 20, recub_sup: 3, recub_inf: 3, recub_lat: 2.5 };
const Z_CORTINA = 20 / 2 - 2.5 - 0.5;   // 7

// (a) cortina HORIZONTAL en modo ARREGLO: rango vertical (y) × 2 capas (z).
const mh = R.expandirComponente({
  comp_id: 'MH', tipologia: 'MA', figura: '101A', diam: 10, cara: 'lateral', jerarquia: 1,
  dims: { A: { modo: 'auto' } },
  distribucion: {
    modo: 'arreglo', n_capas: 2, sep_capas: 2 * Z_CORTINA, eje_capas: 'z',
    rango: { eje: 'y', from: -110, to: 110, sep: 55 }
  }
}, muro);
ok(mh.length === 10, 'malla horizontal: rango 220 @55 (5) × 2 cortinas = 10 barras (=' + mh.length + ')');
ok(close(mh[0].dims.A, 394), 'corre de borde a borde en X: A auto = 400 − 2·recub_borde = 394 (=' + mh[0].dims.A + ')');
ok(JSON.stringify(unicos(mh, 'z')) === JSON.stringify([-Z_CORTINA, Z_CORTINA]),
  'las 2 cortinas quedan en z = ±7 = ±(10 − 2.5 − φ/2) (=' + JSON.stringify(unicos(mh, 'z')) + ')');
ok(unicos(mh, 'z')[0] === -7,
  'la 2ª capa entra hacia el NÚCLEO (z −7); con el apilado siempre positivo caía en +21, fuera del muro');
ok(JSON.stringify(unicos(mh, 'y')) === JSON.stringify([-110, -55, 0, 55, 110]),
  'el rango reparte la malla en Y (=' + JSON.stringify(unicos(mh, 'y')) + ')');

// (b) cortina VERTICAL: la MISMA receta de pie, con el rango en X.
const mv = R.expandirComponente({
  comp_id: 'MV', tipologia: 'MA', figura: '101A', diam: 10, cara: 'lateral', jerarquia: 1,
  plano_pieza: { orientacion: 'de_pie' },
  dims: { A: { modo: 'auto' } },
  distribucion: {
    modo: 'arreglo', n_capas: 2, sep_capas: 2 * Z_CORTINA, eje_capas: 'z',
    rango: { eje: 'x', from: -180, to: 180, sep: 90 }
  }
}, muro);
ok(mv.length === 10, 'malla vertical: rango 360 @90 (5) × 2 cortinas = 10 barras (=' + mv.length + ')');
ok(close(mv[0].dims.A, 244) && close(lim(mv[0], 'y').lo, -122) && close(lim(mv[0], 'y').hi, 122),
  'de pie: corre en Y de borde a borde (250 − 2·3 = 244, de −122 a 122) (=' + JSON.stringify(lim(mv[0], 'y')) + ')');
ok(JSON.stringify(unicos(mv, 'z')) === JSON.stringify([-Z_CORTINA, Z_CORTINA]),
  'de pie: las 2 cortinas siguen en z = ±7 (el recub de cara se conserva por construcción)');
ok(JSON.stringify(unicos(mv, 'x')) === JSON.stringify([-180, -90, 0, 90, 180]),
  'el rango de una pieza de pie reparte en X (=' + JSON.stringify(unicos(mv, 'x')) + ')');

// (c) TRABA que cose las cortinas: volteada → corre en Z, de cara a cara.
const tm = R.expandirComponente({
  comp_id: 'TM', tipologia: 'TM', figura: '101A', diam: 8, cara: 'lateral', jerarquia: 2,
  plano_pieza: { volteado: true },
  dims: { A: { modo: 'auto' } },
  distribucion: {
    modo: 'arreglo', n_capas: 2, sep_capas: 60, eje_capas: 'y',
    rango: { eje: 'x', from: -100, to: 100, sep: 100 }
  }
}, muro);
ok(tm.length === 6, 'trabas: rango 200 @100 (3) × 2 filas = 6 (=' + tm.length + ')');
ok(close(tm[0].dims.A, 15) && close(lim(tm[0], 'z').lo, -7.5) && close(lim(tm[0], 'z').hi, 7.5),
  'la traba CRUZA el espesor: A auto = 20 − 2·2.5 = 15, de z −7.5 a 7.5 (=' + JSON.stringify(lim(tm[0], 'z')) + ')');
ok(lim(tm[0], 'z').lo < -Z_CORTINA && lim(tm[0], 'z').hi > Z_CORTINA,
  'y sus dos puntas pasan POR FUERA de los ejes de las dos cortinas (±7): las cose');

// (d) end-to-end por generar.js (pilas por cara + payload + kg).
const receta = {
  tipo: 'muro',
  geometria: { largo: 400, alto: 250, ancho: 20, recub_sup: 3, recub_inf: 3, recub_lat: 2.5 },
  componentes: [
    {
      comp_id: 'MH', tipologia: 'MA', figura: '101A', diam: 10, cara: 'lateral', jerarquia: 1,
      dims: { A: { modo: 'auto' } },
      distribucion: {
        modo: 'arreglo', n_capas: 2, sep_capas: 2 * Z_CORTINA, eje_capas: 'z',
        rango: { eje: 'y', from: -110, to: 110, sep: 55 }
      }
    },
    {
      comp_id: 'MV', tipologia: 'MA', figura: '101A', diam: 10, cara: 'lateral', jerarquia: 1,
      plano_pieza: { orientacion: 'de_pie' },
      dims: { A: { modo: 'auto' } },
      distribucion: {
        modo: 'arreglo', n_capas: 2, sep_capas: 2 * Z_CORTINA, eje_capas: 'z',
        rango: { eje: 'x', from: -180, to: 180, sep: 90 }
      }
    },
    {
      comp_id: 'TM', tipologia: 'TM', figura: '101A', diam: 8, cara: 'lateral', jerarquia: 2,
      plano_pieza: { volteado: true },
      dims: { A: { modo: 'auto' } },
      distribucion: {
        modo: 'arreglo', n_capas: 2, sep_capas: 60, eje_capas: 'y',
        rango: { eje: 'x', from: -100, to: 100, sep: 100 }
      }
    }
  ]
};
const out = G.generarViga(receta, {});
// kg a mano (espejo de peso.py): 7850·π·(φ/2000)²·(L/100)
function kg(diamMm, largoCm, n) { return 7850 * Math.PI * Math.pow(diamMm / 2000, 2) * (largoCm / 100) * n; }
const KG = kg(10, 394, 10) + kg(10, 244, 10) + kg(8, 15, 6);
ok(out.resumen.barras === 26, 'muro end-to-end: 10 + 10 + 6 = 26 barras (=' + out.resumen.barras + ')');
ok(out.resumen.items === 3, '3 ítems (cada malla agrupa sus barras idénticas) (=' + out.resumen.items + ')');
ok(close(out.resumen.kg, Math.round(KG * 10) / 10, 0.05),
  'kg = ' + (Math.round(KG * 10) / 10) + ' (φ10 394×10 + φ10 244×10 + φ8 15×6) (=' + out.resumen.kg + ')');
ok(out.barras.every(b => b.figura === '101A' && b.dim_a != null && b.dim_b == null),
  'payload: 101A llena SOLO dim_a (pasa validar_geometria)');
// JERARQUÍA con las caras del muro: la traba de nivel 2 se apoya por dentro de la
// malla de nivel 1 en las caras QUE CRUZA. La malla horizontal (que va de borde a
// borde en X) ocupa la cara 'ext'; la de pie ocupa 'sup' e 'inf'.
//   → traba nivel 2: A auto = 20 − 2·prof(lat,2). La pila 'lat' es un PAR
//     SIMÉTRICO: una cortina sola bloquea UN lado, así que no aporta y prof = 2.5
//     → A = 15 (ver el informe: es el límite conocido del modelo de pares).
const tmE = out.placements.filter(p => p.comp_id === 'TM');
const mvE = out.placements.filter(p => p.comp_id === 'MV');
ok(close(tmE[0].dims.A, 15), 'traba nivel 2 en el muro: A = 15 (pila lat = par simétrico, ver informe)');
ok(close(mvE[0].dims.A, 244) && mvE.every(p => Math.abs(centro(p, 'z')) === Z_CORTINA),
  'la malla de pie convive con la horizontal en las dos cortinas (z ±7)');
// Y el recubrimiento por cara SÍ manda cuando el usuario lo declara: una cortina
// interior se pide con recub_override (2.5 + φ de la cortina exterior).
// (tipología CB: 'MA' trae el MODO DE USO 'arreglo' preseteado y en modo layered
// el despacho devolvería [] — el modo del componente manda sobre distribucion.modo.)
const mvIn = R.expandirComponente({
  tipologia: 'CB', figura: '101A', diam: 10, cara: 'lateral', recub_override: 3.5,
  plano_pieza: { orientacion: 'de_pie' },
  dims: { A: { modo: 'auto' } },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0 }
}, muro);
ok(close(centro(mvIn[0], 'z'), 10 - 3.5 - 0.5),
  'recub_override 3.5 → la cortina de pie entra a z = 6 (por dentro de la de 7) (=' + centro(mvIn[0], 'z') + ')');

// (e) COMPOSICIÓN orientación × anidado × TRAMOS en el muro: la cortina vertical
// con confinamiento @10 en los bordes y @25 al centro, y 2 capas anidadas.
//   tramos desde from=−190 (mismo criterio que las zonas: ceil(L/@)+1 con paso
//   REAL, y la barra de unión NO se duplica):
//     60 @10  → 7 (−190 … −130, paso 10)
//     260 @25 → ceil(10.4)+1 = 12, paso real 260/11 = 23.636 → 11 nuevas (−130 ya)
//     cola 60 con el último @ (25) → ceil(2.4)+1 = 4, paso 20 → 3 nuevas (130 ya)
//   = 21 posiciones × 2 capas = 42 barras
// Las 2 capas van FIERRO CONTRA FIERRO contra la MISMA cortina (sep_capas = φ),
// que es donde el anidado tiene sentido; las 2 cortinas opuestas de un muro se
// modelan como 2 componentes (cada uno con su lado), no como 2 capas de uno.
const mvT = R.expandirComponente({
  tipologia: 'MA', figura: '103B', diam: 10, cara: 'lateral', angulos: [45, 45],
  plano_pieza: { orientacion: 'de_pie' },
  dims: { A: { modo: 'fija', valor: 5 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 5 } },
  distribucion: {
    modo: 'arreglo', n_capas: 2, sep_capas: 1.0, eje_capas: 'z', anidar: true,
    rango: {
      eje: 'x', from: -190, to: 190, sep: 25,
      tramos: [{ long: 60, sep: 10 }, { long: 260, sep: 25 }]
    }
  }
}, muro);
const xsT = unicos(mvT, 'x');
ok(xsT.length === 21 && mvT.length === 42,
  'de pie + tramos: 21 posiciones en X × 2 capas = 42 barras (=' + xsT.length + '/' + mvT.length + ')');
ok(close(xsT[1] - xsT[0], 10, 0.01) && close(xsT[8] - xsT[7], 260 / 11, 0.01),
  'los tramos se respetan sobre el eje REAL (X): @10 en el borde y paso real 260/11 al centro (=' +
  r3(xsT[1] - xsT[0]) + ' / ' + r3(xsT[8] - xsT[7]) + ')');
const capaT1 = mvT.filter(p => p.meta.capa === 1), capaT2 = mvT.filter(p => p.meta.capa === 2);
// El marco de bordes SIGUE siendo 244 (eso es lo que este assert protege: de pie se
// mide contra los BORDES del muro, no contra las caras); lo que cambia es cuánto le
// reserva el auto-largo a las patas de la 103B sobre ese mismo eje.
// 18-AGO · LA RESERVA CAE DE 4.0355 A 0.5 POR PUNTA (convención de VÉRTICE). Con el
// 45 leído como RECORRIDO la pata se ABRÍA y avanzaba 5·cos45 = 3.5355 sobre el eje
// del cuerpo, más φ/2 = 0.5 de cresta → 4.0355. Leído como VÉRTICE la pata queda
// REPLEGADA sobre el cuerpo: no avanza nada sobre el eje, así que lo único que se
// reserva es la CRESTA del codo, φ/2 = 0.5, para que quede en línea con el recub de
// borde.
//   B = 244 − 2·0.5 = 243   (antes 244 − 2·4.0355 = 235.9289)
const RESERVA_MA = 2 * 0.5;   // 1.0 (antes 8.0711)
ok(close(capaT1[0].dims.B, 244 - RESERVA_MA) && close(capaT1[0].dims.A, 5),
  'la dim auto de pie se mide contra los BORDES (244) menos la reserva de la cresta = 243, y las patas quedan fijas (=' + capaT1[0].dims.B + ')');
ok(close(capaT2[0].dims.B, 244 - RESERVA_MA - 2 * 1.0) && close(capaT2[0].dims.A, 5),
  'anidado × de pie: la capa 2 ajusta SOLO B (−2·φ = 241) y no toca las patas (=' + capaT2[0].dims.B + ')');
ok(close(lim(capaT1[0], 'z').hi, Z_CORTINA) && close(lim(capaT2[0], 'z').hi, Z_CORTINA - 1),
  'y la posición la puso sep_capas (1 cm hacia el núcleo), no el anidado (=' +
  lim(capaT1[0], 'z').hi + ' / ' + lim(capaT2[0], 'z').hi + ')');

// ===========================================================================
// L4 · LÍMITE DOCUMENTADO — recub_sup ≠ recub_inf con la pieza DE PIE.
// ===========================================================================
// El eje Y es el único con dos caras DISTINTAS. Al ponerse de pie pasa a ser el
// eje longitudinal local, que el motor mide simétrico (largo − 2·recub): se toma
// el MAYOR de los dos para no violar ningún recubrimiento. Con sup = inf (el muro
// típico) no hay diferencia; con sup ≠ inf la barra queda centrada contra el
// recubrimiento más exigente.
console.log('\nL4 — límite documentado: de pie con recub_sup ≠ recub_inf:');
const asim = { largo: 400, alto: 250, ancho: 20, recub_sup: 3, recub_inf: 6, recub_lat: 2.5 };
const plAsim = R.expandirComponente({
  tipologia: 'CB', figura: '101A', diam: 10, cara: 'lateral',
  plano_pieza: { orientacion: 'de_pie' },
  dims: { A: { modo: 'auto' } },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
}, asim);
ok(close(plAsim[0].dims.A, 250 - 2 * 6),
  'toma el recub MAYOR (6): A = 238, y ninguna punta viola su recubrimiento (=' + plAsim[0].dims.A + ')');
ok(lim(plAsim[0], 'y').hi <= 125 - 3 + 1e-9 && lim(plAsim[0], 'y').lo >= -125 + 6 - 1e-9,
  'las dos puntas quedan dentro (arriba sobra 3 cm: es el precio del par simétrico)');

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — muro: cara cortina + orientaciones (acostada/volteada/de pie).');
