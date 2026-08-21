// =============================================================================
// FIERRO FUERA DEL HORMIGÓN — GUARDAS DE LA TANDA DEL 13-ago
// =============================================================================
// Seis defectos confirmados por los verificadores adversariales compartían la
// misma coletilla: «cero avisos». El motor sacaba fierro del elemento, lo
// facturaba al despiece y nada en pantalla lo contaba. Este archivo congela las
// causas RAÍZ que se arreglaron, cada una con el número que se midió antes:
//
//   A · el gancho terminal de una cadena de UN SOLO doblez tomaba como CUERPO el
//       lado equivocado y el dominante salía desplazado 2.5·φ de su anclaje
//       (CBS 102B: el eje en y = 29.2 con el ancla en 25.2, φ16).
//   B · la traba colgaba TODO su desarrollo hacia −z desde su coordenada de
//       reparto en vez de encuadrarse (muro de 20: el eje 4.75 cm fuera).
//   C · el reparto de una pieza de sección no descontaba su propio ancho salvo
//       para la familia 'cadena' (3 trabas: la del extremo, 12.01 cm fuera).
//   D · el anillo anidado se ENSANCHABA capa a capa porque la pata del gancho no
//       se medía contra el marco (muro, capa 3: 2.92 cm fuera).
//   E · las capas de una pieza longitudinal no re-resolvían su 'auto' contra el
//       marco de SU capa (muro, 105F/103A: hasta 3.0 cm fuera).
//   F · y el barrido completo: ninguna barra sale del hormigón EN SILENCIO.
//
// Correr con: node tests/test_fuera_hormigon.js
// =============================================================================

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
const CAT = global.ModeladorCatalogoFiguras = require(path.join(base, 'catalogo_figuras.js'));
const FP = global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function close(a, b, t) { return Math.abs(a - b) < (t || 1e-6); }
const r2 = v => Math.round(v * 100) / 100;

const VIGA = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const VIGA60 = { largo: 600, alto: 60, ancho: 60, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const MURO = { largo: 400, alto: 250, ancho: 20, recub_sup: 3, recub_inf: 3, recub_lat: 2.5 };

function lim(pl, e) {
  const v = pl.puntos.map(p => p[e]);
  return { lo: Math.min(...v), hi: Math.max(...v) };
}
// TODO AUTO: la condición en la que aparecieron los seis defectos (el usuario no
// fija ninguna medida, las elige el motor).
function comp(fig, tip, pose, phi, dist) {
  return {
    tipologia: tip, figura: fig, diam: phi, cara: pose.cara, pose: pose,
    dims: Object.fromEntries(CAT.get(fig).parciales.map(L => [L, { modo: 'auto' }])),
    distribucion: dist || { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
  };
}
function avisos(c) { return c._avisos || []; }
// Cuánto sale la CARA del fierro (eje ± φ/2) de la caja del hormigón, por eje.
function fueraDeHormigon(pl, host, phiCm) {
  const H = { x: host.largo / 2, y: host.alto / 2, z: host.ancho / 2 };
  let peor = 0, eje = null;
  for (const e of ['x', 'y', 'z']) {
    const L = lim(pl, e);
    const d = Math.max(L.hi + phiCm / 2 - H[e], -H[e] - (L.lo - phiCm / 2));
    if (d > peor) { peor = d; eje = e; }
  }
  return { fuera: peor, eje: eje };
}

// ===========================================================================
// A · CADENA DE UN SOLO DOBLEZ: EL DOMINANTE SE QUEDA EN SU ANCLAJE
// ===========================================================================
// Una 102B son DOS tramos: A = gancho de 135° y B = cuerpo (el dominante). Con
// 3 puntos no hay tramo INTERIOR, así que el único doblez se lo llevaba el pase
// directo de `_conGanchosRadio`, que toma como CUERPO el PRIMER tramo. El cuerpo
// se queda quieto y la PATA cuelga desplazada del arco, así que el dominante —el
// lado que se ancla contra la cara— salía corrido R = 2φ + φ/2 = 2.5·φ.
// MEDIDO antes del fix (viga 600×60×30 rec 4, CBS 102B todo auto, pose default):
//   φ8  → ancla y = 25.6, eje dibujado 27.6 (+2.0)
//   φ16 → ancla y = 25.2, eje dibujado 29.2 (+4.0) → la CARA en y = 30.0 exacto,
//         o sea recubrimiento CERO
//   φ32 → ancla y = 24.4, eje dibujado 32.4 (+8.0) → 4.0 cm FUERA del hormigón
// Ahora el cuerpo del gancho es el DOMINANTE (se lo dice el llamador, que acaba
// de orientarlo) y el eje cae EXACTO en su anclaje: recub + Σpilas + φ/2.
console.log('A — 102B como cabezal: el dominante se queda EN su anclaje:');
[8, 16, 32].forEach(function (phi) {
  const c = comp('102B', 'CBS', { cara: 'sup', lado: 1, rumbo: 'x' }, phi);
  const pl = R.expandirComponente(c, VIGA)[0];
  const ancla = 30 - 4 - (phi / 10) / 2;      // recub 4 + φ/2 (pila vacía: nivel 1)
  ok(close(lim(pl, 'y').hi, ancla, 1e-9),
    'φ' + phi + ': el eje del cuerpo en su ancla = 30 − 4 − φ/2 = ' + r2(ancla) +
    ' (=' + r2(lim(pl, 'y').hi) + ')');
  ok(close(lim(pl, 'y').hi + (phi / 10) / 2, 26, 1e-9),
    'φ' + phi + ': la CARA del fierro en 26 = 30 − recub 4, el recubrimiento EXACTO ' +
    '(antes φ16 daba 30.0 = cero recub y φ32 34.0 = 4 cm fuera)');
  ok(fueraDeHormigon(pl, VIGA, phi / 10).fuera <= 1e-9,
    'φ' + phi + ': nada de la barra sale del hormigón');
});
// El mismo defecto en el muro, donde el que se salía era el eje Z (cortina).
[8, 16].forEach(function (phi) {
  const c = comp('102B', 'MH', { cara: 'lateral', lado: 1, rumbo: 'x' }, phi);
  const pl = R.expandirComponente(c, MURO)[0];
  ok(close(lim(pl, 'z').hi, 10 - 2.5 - (phi / 10) / 2, 1e-9),
    'muro φ' + phi + ': la cortina queda a recub 2.5 de su cara (=' + r2(lim(pl, 'z').hi) + ')');
});
// GUARDA DE NO-REGRESIÓN: las figuras cuyo dominante YA era el primer tramo (y
// todas las de 3+ lados, que sí tienen tramo interior) no se mueven ni un μm.
// La 103A/103B son las del caso de aceptación de test_pilas_caras.
console.log('\nA2 — el resto del catálogo no se mueve (el fix es del caso de 1 doblez):');
['101A', '103A', '103B', '104B', '105C'].forEach(function (f) {
  const c = comp(f, 'CBS', { cara: 'sup', lado: 1, rumbo: 'x' }, 16);
  const pl = R.expandirComponente(c, VIGA)[0];
  ok(close(lim(pl, 'y').hi, 25.2, 1e-9),
    f + ': su lado dominante sigue en el ancla 25.2 (=' + r2(lim(pl, 'y').hi) + ')');
});

// ===========================================================================
// B · LA TRABA SE ENCUADRA EN SU MARCO (anchor.z = su CENTRO)
// ===========================================================================
// `_traba` armaba la vertical EN zz y colgaba los dos ganchos hacia −u, así que
// ocupaba [zz − 14.75, zz] con φ16 — un ancho idéntico en viga de 30, viga de 60
// y muro de 20, o sea que la forma NO consultaba la sección en la que vive — y
// arrancaba pegada a su coordenada de reparto en vez de estar centrada.
// MEDIDO antes del fix (muro 400×250×20 rec 2.5, TC 101A φ16, pose default, 1
// barra → zz = 0): trazo de z = 0 a z = −14.748, o sea el EJE 4.748 cm más allá
// de la cara del hormigón (z = −10) y la CARA del fierro 5.548 cm. En la viga de
// 30 sobrevivía por 0.25 cm de margen, no por diseño.
// Ahora anchor.z es el CENTRO del bbox arqueado — la MISMA convención que ya
// usaba `_cadenaSeccion` —, así que el sobrante (si lo hay) es simétrico y a la
// vista. El gancho NO se acorta: 6φ mín 7.5 es normativo.
console.log('\nB — traba: su bbox se centra en el anchor, no cuelga de él:');
['101A', '102A', '102B', '102C'].forEach(function (f) {
  const c = comp(f, 'TC', { cara: 'lateral', lado: 1, rumbo: 'y' }, 16);
  const pl = R.expandirComponente(c, MURO)[0];
  const z = lim(pl, 'z');
  const y = lim(pl, 'y');
  // (el pie/gancho ⊥ puede cruzar el espesor: es el auto-universal del cabezal)
  // 20-AGO · LA PATA PASÓ A 10φ y con φ16 son 16 cm de extensión libre. La 102C —la
  // única de las cuatro cuyo gancho entra en DIAGONAL— ya no cabe en un muro de 20:
  // se pasa 2.38 cm. Lo que este assert protege sigue siendo lo mismo (la pieza se
  // CENTRA en su anchor, no cuelga de él); lo que se acepta es que con la pata nueva
  // esa figura no entra, y el motor lo DICE en vez de callarlo.
  const cabe = Math.max(Math.abs(z.lo), Math.abs(z.hi)) + 0.8 <= 10 + 1e-9;
  ok(cabe || (c._avisos || []).some(a => /FUERA/.test(a)),
    f + ': cara del fierro dentro del espesor, o fuera PERO avisada (z = ' +
    r2(z.lo) + '…' + r2(z.hi) + (cabe ? '' : ' · avisada') + ')');
  ok((y.hi - y.lo) > 200, f + ': corre vertical (span y = ' + r2(y.hi - y.lo) + ')');
});
// ASSERT CAMBIADO (14-ago) POR UNA RAZÓN FÍSICA, no para que pase. Antes acá se
// exigía el aviso «no cabe ni una vez»: la traba del muro cruzaba el eje local
// EQUIVOCADO (siempre el alto local) y sus GANCHOS quedaban atravesados en el
// espesor — 14.75 cm de ocupación contra 13.4 útiles. Con el cruce correcto
// (_cruceLocalTraba: la traba va de cortina a cortina) el cuerpo llena el
// espesor POR CONSTRUCCIÓN (cresta en la línea de recub, cara del fierro a
// ±8.3 ≤ 10) y los ganchos corren A LO LARGO del muro, donde sobra sitio: una
// traba φ16 en un muro de 20 con recub 2.5 CABE, que es lo que se fabrica.
{
  const cM = comp('101A', 'TC', { cara: 'sup', lado: 1, rumbo: 'z' }, 16);
  const plM = R.expandirComponente(cM, MURO)[0];
  const zM = lim(plM, 'z');
  ok(!avisos(cM).length,
    'la traba φ16 girada a rumbo z CABE cruzando el espesor (sin avisos: ' +
    JSON.stringify(avisos(cM)) + ')');
  ok(Math.max(Math.abs(zM.lo), Math.abs(zM.hi)) + 0.8 <= 10 + 1e-9,
    'y su cara queda dentro: |z|max + φ/2 = ' + r2(Math.max(Math.abs(zM.lo), Math.abs(zM.hi)) + 0.8) + ' ≤ 10');
  const cV = comp('101A', 'TRV', { cara: 'lateral', lado: 1, rumbo: 'y' }, 16);
  const plV = R.expandirComponente(cV, VIGA60)[0];
  ok(avisos(cV).length === 0 && fueraDeHormigon(plV, VIGA60, 1.6).fuera <= 1e-9,
    'en la viga de ancho 60 la traba de pie entra holgada y no avisa nada');
}

// ===========================================================================
// C · EL REPARTO DESCUENTA EL ANCHO REAL DE LA PIEZA (medido, no por familia)
// ===========================================================================
// `_repartoDePieza` salía por `return mc` para toda familia ≠ 'cadena', con la
// premisa escrita de que «el estribo y la traba no pasan por acá: su ruta de
// dibujo no lee este rango». Falso para la traba. MEDIDO antes del fix (muro
// 400×250×20 rec 2.5, TC 101A φ16, barras_capa = 3): las 3 copias repartidas de
// z = −6.7 a +6.7 (el marco eje a eje) mientras cada pieza ocupa 14.75 en ese
// mismo eje → pl0 en z ∈ [−21.45, −6.70], o sea 12.01 cm de cara fuera.
// Ahora se MIDE la ocupación real con `_spanEnEje` (traza la pieza una vez), sin
// tabla de familias que se pueda desincronizar del dibujo.
console.log('\nC — reparto de 3 trabas: ninguna copia sale del hormigón:');
{
  const c = comp('101A', 'TC', { cara: 'lateral', lado: 1, rumbo: 'y' }, 16,
    { modo: 'layered', n_capas: 1, barras_capa: 3, gap: 0 });
  const pls = R.expandirComponente(c, MURO);
  ok(pls.length === 3, '3 copias (=' + pls.length + ')');
  pls.forEach(function (pl, i) {
    const z = lim(pl, 'z');
    ok(Math.max(Math.abs(z.lo), Math.abs(z.hi)) + 0.8 <= 10 + 1e-9,
      'copia ' + i + ': |z| + φ/2 ≤ 10 (=' + r2(z.lo) + ' … ' + r2(z.hi) + ')');
  });
}
// Y una traba que SÍ cabe se sigue repartiendo como siempre (no se colapsa todo
// al centro por el hecho de medir): en la viga de 60 el marco da 53.4 y la pieza
// ocupa 14.75, así que hay sitio para separar las copias.
{
  const c = comp('101A', 'TRV', { cara: 'lateral', lado: 1, rumbo: 'y' }, 16,
    { modo: 'linear', rango: { eje: 'x', from: -100, to: 100, sep: 100 } });
  const pls = R.expandirComponente(c, VIGA60);
  const xs = pls.map(p => (lim(p, 'x').lo + lim(p, 'x').hi) / 2);
  ok(xs.length === 3 && (Math.max(...xs) - Math.min(...xs)) > 1,
    'donde SÍ cabe, las 3 copias van separadas por su rango (x=' + JSON.stringify(xs.map(r2)) + ')');
  ok(pls.every(p => fueraDeHormigon(p, VIGA60, 1.6).fuera <= 1e-9),
    'y ninguna sale del hormigón');
}

// ===========================================================================
// D · UN ANILLO ANIDADO NO PUEDE ENSANCHAR
// ===========================================================================
// La pata del gancho sísmico se acotaba con `hypot(alto, ancho)·0.28`, o sea
// contra la DIAGONAL del marco — que la domina el lado largo, así que en un marco
// alto y angosto no acotaba nada. Como el desarrollo del gancho arranca en −w2 y
// mide una constante, el anillo iba ENSANCHÁNDOSE hacia afuera capa a capa.
// MEDIDO antes del fix (muro 400×250×20 rec 2.5, EC 104D φ16, 3 capas gap 3):
//   capa1 z ∈ [−6.70, 6.92] · capa2 [−3.70, 9.92] · capa3 [−0.70, 12.92]
//   span constante 13.62 en las tres, dims A 15 → 9 → 3, capa 3 con el eje 2.92
//   cm FUERA del hormigón y cero avisos.
// Y en viga 600×60×30 con 4 capas el span en z hacía 22.4 → 16.4 → 13.62 → 13.30:
// dejaba de encoger.
// Fix de raíz: la pata se mide contra el SITIO que deja el marco después del codo
// (`_pataGancho`), y como comprobación física el motor exige que el bbox de la
// capa k esté contenido en el de la k−1; si no, esa capa no existe y se omite con
// aviso, por el mismo camino que las que no caben por dims.
console.log('\nD — anidado del estribo: cada anillo dentro del anterior:');
{
  const c = comp('104D', 'EC', { cara: 'lateral', lado: 1, rumbo: 'y' }, 16,
    { modo: 'layered', n_capas: 3, barras_capa: 1, gap: 3 });
  const pls = R.expandirComponente(c, MURO);
  for (let i = 1; i < pls.length; i++) {
    const a = lim(pls[i], 'z'), b = lim(pls[i - 1], 'z');
    ok(a.lo >= b.lo - 1e-9 && a.hi <= b.hi + 1e-9,
      'capa ' + (i + 1) + ' contenida en la anterior en z (=' + r2(a.lo) + '…' + r2(a.hi) +
      ' ⊆ ' + r2(b.lo) + '…' + r2(b.hi) + ')');
  }
  ok(pls.every(p => Math.max(Math.abs(lim(p, 'z').lo), Math.abs(lim(p, 'z').hi)) + 0.8 <= 10 + 1e-9),
    'y ninguna capa emitida saca fierro del muro (|z| + φ/2 ≤ 10)');
  ok(pls.length === 2 && avisos(c).some(a => /MÁS ANCHO que la capa anterior/.test(a)),
    'la capa que ensancharía NO se emite y deja aviso (=' + pls.length + ' capas · ' +
    JSON.stringify(avisos(c)) + ')');
}
{
  const c = comp('104D', 'ES', { cara: 'lateral', lado: 1, rumbo: 'x' }, 16,
    { modo: 'layered', n_capas: 4, barras_capa: 1, gap: 3 });
  const pls = R.expandirComponente(c, VIGA);
  const spans = pls.map(p => lim(p, 'z').hi - lim(p, 'z').lo);
  let decrece = true;
  for (let i = 1; i < spans.length; i++) if (!(spans[i] < spans[i - 1] - 1e-9)) decrece = false;
  ok(decrece, 'viga 600×60×30, 4 capas: el span en z decrece SIEMPRE (=' +
    JSON.stringify(spans.map(r2)) + ')');
  ok(close(spans[0], 22.4, 1e-9) && close(spans[1], 16.4, 1e-9),
    'las dos primeras encogen 2·gap = 6 por capa, como siempre (22.4 → 16.4)');
}

// ===========================================================================
// E · EL 'AUTO' DE LA CAPA k SE RESUELVE CONTRA EL MARCO DE LA CAPA k
// ===========================================================================
// Una pieza LONGITUDINAL con lados 'auto' PERPENDICULARES al dominante (los que
// cruzan el espesor) los resolvía contra el marco de la capa 1 y después la capa
// k se trasladaba k·gap hacia el núcleo con esas MISMAS medidas: como el 'auto' ya
// las había estirado al espesor útil COMPLETO, cualquier gap > 0 la sacaba.
// MEDIDO antes del fix (muro 400×250×20 rec 2.5, MH 103A φ16 todo auto, 3 capas
// gap 3): A = C = 13.4 en las TRES capas y la capa 3 con el trazo llegando a
// z = −6.7 desde z = +0.7, o sea cruzando la cara opuesta.
// Esa medida NO la fijó el usuario, la eligió el motor: re-elegirla desde donde la
// pieza REALMENTE está es lo que 'auto' significa. Un lado FIJO no se toca.
console.log('\nE — capas de un longitudinal: el auto se re-resuelve por capa:');
{
  const c = comp('103A', 'MH', { cara: 'lateral', lado: 1, rumbo: 'x' }, 16,
    { modo: 'layered', n_capas: 3, barras_capa: 1, gap: 3 });
  const pls = R.expandirComponente(c, MURO);
  ok(pls.length === 3, '3 capas (=' + pls.length + ')');
  // 20-AGO: cada una es su espesor eje a eje MÁS el R + φ de su codo (medida de
  // cresta) y redondeada al centímetro hacia ABAJO porque la limita el hormigón:
  // 13.4 → 14.2 → 14 · 10.4 → 11.2 → 11 · 7.4 → 8.2 → 8.
  [14, 11, 8].forEach(function (v, i) {
    ok(close(pls[i].dims.A, v, 1e-6) && close(pls[i].dims.C, v, 1e-6),
      'capa ' + (i + 1) + ': las patas ⊥ miden, hasta la cresta y al centímetro, el espesor útil MENOS lo que la capa ya se comió = ' +
      v + ' (=' + r2(pls[i].dims.A) + ')');
  });
  ok(pls.every(p => Math.max(Math.abs(lim(p, 'z').lo), Math.abs(lim(p, 'z').hi)) + 0.8 <= 10 + 1e-9),
    'las 3 capas caen dentro del hormigón');
  ok(avisos(c).length === 0, 'y sin avisos: todo cabe (=' + JSON.stringify(avisos(c)) + ')');
}
// Cuando lo que ocupa la profundidad NO es un 'auto' sino el GANCHO NORMATIVO
// (6φ, que no es negociable), la capa no puede encoger: la barra se dibuja igual
// —dato honesto, la regla del módulo— pero AHORA SE DICE. MEDIDO: la figura φ16 en
// el muro ocupa 13.62 en el espesor por su gancho replegado, así que la capa 3
// acaba con 3.72 cm de fierro fuera.
//
// 18-AGO · LA FIGURA DE ESTE CASO PASA DE 105F A 105B, con el MISMO número (3.717).
// Con la convención de VÉRTICE cerrada por el usuario, el gancho que se repliega
// —el que ocupa profundidad— es el de ficha 45°, no el de ficha 135°: la 105F
// (ficha 135) pasa a tener un quiebre suave de 45° de recorrido y ahora CABE, y su
// contraparte de misma topología, la 105B (ficha 45, 5 tramos), es la que no cabe.
// El fenómeno no desapareció, cambió de figura: medido sobre el catálogo entero en
// este mismo escenario, las 24 figuras que sacan fierro son exactamente las de
// ficha 45 y todas con su aviso (antes eran las 24 de ficha 135, con el mismo
// 3.717). El assert es el mismo, apuntando a la figura donde el caso ocurre.
{
  const c = comp('105B', 'MH', { cara: 'lateral', lado: 1, rumbo: 'x' }, 16,
    { modo: 'layered', n_capas: 3, barras_capa: 1, gap: 3 });
  const pls = R.expandirComponente(c, MURO);
  const peor = Math.max.apply(null, pls.map(p => fueraDeHormigon(p, MURO, 1.6).fuera));
  ok(peor > 0 && avisos(c).some(a => /Fierro FUERA del hormigón/.test(a)),
    'la 105B no puede encoger su gancho: sale ' + r2(peor) + ' cm y el motor lo DICE (=' +
    JSON.stringify(avisos(c)) + ')');
  // Y la contraparte: la 105F cabía con 6φ y con la pata de 10φ (20-ago) ya no —
  // 2.73 cm por la capa 3. La regla no cambió (un gancho normativo no se encoge para
  // que la barra quepa); cambió el mínimo. Lo que se exige es lo de siempre: que el
  // motor lo DIGA, con el número y la capa.
  const cF = comp('105F', 'MH', { cara: 'lateral', lado: 1, rumbo: 'x' }, 16,
    { modo: 'layered', n_capas: 3, barras_capa: 1, gap: 3 });
  const plsF = R.expandirComponente(cF, MURO);
  const peorF = Math.max.apply(null, plsF.map(p => fueraDeHormigon(p, MURO, 1.6).fuera));
  ok(peorF > 0 && avisos(cF).some(a => /Fierro FUERA del hormigón/.test(a)),
    'y la 105F tampoco encoge su gancho de 10φ: sale ' + r2(peorF) + ' cm y el motor lo DICE (=' +
    r2(peorF) + ' / ' + JSON.stringify(avisos(cF)) + ')');
}

// ===========================================================================
// F · BARRIDO: NINGUNA BARRA SALE DEL HORMIGÓN EN SILENCIO
// ===========================================================================
// El criterio de aceptación de la tanda. No es «0 barras fuera» a secas —una
// figura puede pedir un gancho normativo que el espesor no aguanta, y aplastarlo
// sería mentir—: es que NO HAYA NI UNA sin aviso. Antes del fix este mismo barrido
// daba 540 barras fuera del hormigón SIN un solo aviso.
console.log('\nF — barrido del catálogo × hosts × tipologías × distribuciones:');
{
  const HOSTS = { viga: VIGA, viga60: VIGA60, muro: MURO };
  const ESC = [['viga', 'CBS'], ['viga', 'CBI'], ['viga', 'LT'], ['viga', 'ES'], ['viga', 'TRV'],
    ['muro', 'MH'], ['muro', 'MV'], ['muro', 'CB'], ['muro', 'EC'], ['muro', 'TC'], ['muro', 'TR']];
  const DIST = [
    { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 },
    { modo: 'layered', n_capas: 3, barras_capa: 1, gap: 3 },
    { modo: 'layered', n_capas: 1, barras_capa: 3, gap: 0 }
  ];
  let total = 0, fuera = 0, silencio = 0, peorSilencio = null;
  CAT.codigos().forEach(function (cod) {
    const spec = CAT.get(cod);
    if (!spec) return;
    ESC.forEach(function (par) {
      const host = HOSTS[par[0]];
      [8, 16, 32].forEach(function (phi) {
        DIST.forEach(function (d) {
          const c = {
            tipologia: par[1], figura: cod, diam: phi, cara: 'lateral',
            dims: Object.fromEntries(spec.parciales.map(L => [L, { modo: 'auto' }])),
            distribucion: JSON.parse(JSON.stringify(d))
          };
          const pls = R.expandirComponente(c, host);
          const avisado = avisos(c).length > 0;
          pls.forEach(function (pl) {
            total++;
            const f = fueraDeHormigon(pl, host, phi / 10);
            if (f.fuera > 1e-6) {
              fuera++;
              if (!avisado) {
                silencio++;
                if (!peorSilencio || f.fuera > peorSilencio.d) {
                  peorSilencio = { cod: cod, tip: par[1], host: par[0], phi: phi, d: r2(f.fuera), eje: f.eje };
                }
              }
            }
          });
        });
      });
    });
  });
  console.log('    (' + total + ' placements · ' + fuera + ' con fierro fuera · ' +
    silencio + ' de ellos sin aviso)');
  ok(total > 10000, 'el barrido es de verdad: ' + total + ' placements');
  ok(silencio === 0,
    'NINGUNA barra sale del hormigón sin aviso (antes: 540) (=' +
    JSON.stringify(peorSilencio) + ')');
}


// ===========================================================================
// G · EL AUTO-LARGO SE ACOTA CONTRA EL EJE POR EL QUE CORRE LA PIEZA (23-ago)
// ===========================================================================
// Reporte del usuario: «siempre que vuelvo a entrar al editor esta figura 103C se
// me desajusta visualmente… es como que se perdiera el límite que le da el lado
// automático». El auto del lado longitudinal es `largoUtil − sobresCadena`, y
// `sobresCadena` mide esos sobres poniendo el longitudinal en un placeholder de
// 1000 cm, con la premisa escrita de que «los sobres no dependen de él». Vale para
// la punta que se dobla HACIA ATRÁS (giro < 90°, la 102B), no para la que se dobla
// HACIA ADELANTE (giro > 90°, la 103C y las de ficha 135): esa pata cae DENTRO de
// los 1000 de mentira, reserva 0, y el auto se queda con el largo útil COMPLETO
// mientras el trazo ocupa lo que mida la pata.
// MEDIDO (muro 600×310×20 recub 2, MV 103C φ8, rumbo z = el ESPESOR, A = 11 de
// gancho auto + Δ 48 del usuario = 59): B = 16 (= 20 − 2 − 2, correcto) pero el
// trazo iba de z = −20.3 a +20.3 — 40.61 cm de ancho en un muro de 20. La misma
// barra con rumbo x da bbox z = 0: el defecto sólo asoma cuando el rumbo es el eje
// CORTO, que es por lo que el usuario veía sólo esos componentes.
console.log('\nG — el eje CORTO como rumbo: la pieza no puede abarcar más que su espesor útil:');
{
  const M310 = { largo: 600, alto: 310, ancho: 20, recub_sup: 2, recub_inf: 2, recub_lat: 2 };
  const V30 = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
  // El componente EXACTO del reporte, salvo el Δ (que es lo que se varía).
  function c103C(delta, fig) {
    const spec = CAT.get(fig || '103C');
    const dims = {};
    spec.parciales.forEach(function (L) {
      dims[L] = (L === 'A' && delta) ? { modo: 'auto', delta: delta } : { modo: 'auto' };
    });
    return {
      tipologia: 'MV', figura: fig || '103C', diam: 8, modo: 'lineal', dims: dims,
      angulos: { a1: 45 },
      pose: { cara: 'inf', lado: -1, rumbo: 'z', espejo: false },
      distribucion: { modo: 'linear', sep: 20, rango: { eje: 'x', from: -218, to: 222, sep: 20 } }
    };
  }
  // (1) SIN Δ —lo que el motor elige solo— la barra NO puede abarcar más que el
  //     espesor útil en su eje corto. Es el criterio de aceptación del reporte.
  {
    const c = c103C(0);
    const pl = R.expandirComponente(c, M310)[0];
    const z = lim(pl, 'z');
    ok(Math.max(Math.abs(z.lo), Math.abs(z.hi)) + 0.4 <= 10 + 1e-9,
      '103C todo auto: la cara del fierro cabe en el espesor (z = ' + r2(z.lo) + '…' + r2(z.hi) +
      ', muro de 20)');
    ok(!avisos(c).length, '…y sin avisos: no hay nada que decir (=' + JSON.stringify(avisos(c)) + ')');
  }
  // (2) CON el Δ 48 del usuario la pata mide 59 y a 45° alcanza 41.41 cm sobre el
  //     eje en que corre la pieza, donde hay 16 útiles. Eso NO lo arregla ningún
  //     largo de B —el bloque de la punta es RÍGIDO—, así que no se clampa: se
  //     dibuja igual y el motor NOMBRA EL LADO con su número (antes: el auto daba
  //     B = 16 y sólo hablaba el aviso genérico, que culpa al φ y al Sep de capas).
  {
    const c = c103C(48);
    const pl = R.expandirComponente(c, M310)[0];
    const z = lim(pl, 'z');
    ok(r2(z.hi - z.lo) === 40.61, 'con Δ 48 el trazo mide 40.61 en z (el dato honesto, se ve)');
    ok(avisos(c).some(function (a) { return /lado A ocupa 41\.41 cm/.test(a) && /16 cm útiles/.test(a); }),
      'y el motor nombra el LADO A con su número y con el útil que hay (=' +
      JSON.stringify(avisos(c)) + ')');
  }
  // (3) LA MISMA BARRA CON RUMBO X CABE Y NO DICE NADA de la pata: el aviso no es del
  //     componente, es de la relación entre la pata y el eje por el que corre.
  {
    const c = c103C(48);
    c.pose = { cara: 'inf', lado: -1, rumbo: 'x', espejo: false };
    R.expandirComponente(c, M310);
    ok(!avisos(c).some(function (a) { return /lado A ocupa/.test(a); }),
      'girada a rumbo x la pata cabe en los 592 útiles y no se avisa nada de ella');
  }
  // (4) NO ES SÓLO LA 103C: el barrido de las de 2 y 3 lados con ángulo, rumbo en el
  //     eje CORTO, en muro y en viga. Con el 'auto' del motor todas caben (que es lo
  //     que el usuario ve, y por eso creía que era una figura sola); en cuanto la
  //     pata crece, la que se dobla hacia ADELANTE se sale, y ninguna en silencio.
  [['muro', M310], ['viga', V30]].forEach(function (par) {
    ['102B', '102C', '103B', '103C', '103D'].forEach(function (f) {
      const semi = par[1].ancho / 2;
      const cA = c103C(0, f);
      const zA = lim(R.expandirComponente(cA, par[1])[0], 'z');
      ok(Math.max(Math.abs(zA.lo), Math.abs(zA.hi)) + 0.4 <= semi + 1e-9,
        par[0] + ' ' + f + ' todo auto: cabe en el eje corto (z = ' + r2(zA.lo) + '…' + r2(zA.hi) + ')');
      const cD = c103C(48, f);
      const zD = lim(R.expandirComponente(cD, par[1])[0], 'z');
      const cabe = Math.max(Math.abs(zD.lo), Math.abs(zD.hi)) + 0.4 <= semi + 1e-9;
      ok(cabe || avisos(cD).some(function (a) { return /ocupa .* cm sobre el eje en que corre/.test(a); }),
        par[0] + ' ' + f + ' con Δ 48: cabe, o NO cabe y el motor nombra el lado (z = ' +
        r2(zD.lo) + '…' + r2(zD.hi) + (cabe ? ' · cabe' : ' · nombrado') + ')');
    });
  });
}

// ===========================================================================
// H · CADA PUNTA CON SU RESERVA (el medio diámetro no se reparte a medias)
// ===========================================================================
// El auto-largo reserva φ/2 en el extremo que termina en DOBLEZ —la CRESTA del codo
// es la que se apoya en la línea de recubrimiento, no su eje— y 0 en el que termina
// en CORTE A RAS. Pero esa reserva se le restaba al LARGO (o sea a la SUMA de las
// dos puntas) y la pieza se centraba por el bbox de los EJES: cada extremo recibía
// LA MITAD DEL TOTAL en vez de LO SUYO.
// Con una pieza SIMÉTRICA no se nota —las dos mitades son iguales— y por eso vivió
// tanto. Este bloque mide LAS DOS CARAS DEL MISMO EJE con una pieza ASIMÉTRICA, que
// es donde el defecto se ve.
// MEDIDO (muro 720×310×20 recub 2, CB φ16 rumbo y, A fija 35 · B auto):
//   102A (doblez abajo, corte arriba) → recubrimiento 1.60 abajo y 2.40 arriba: el
//        codo METIDO 0.4 en su propio recubrimiento. Con φ8: 1.80 / 2.20 (el sesgo
//        es siempre φ/4).
//   103A (doblez en las dos puntas)   → 2.00 / 2.00, que es lo correcto y lo que
//        escondía el defecto.
console.log('\nH — las DOS caras del mismo eje, con una pieza asimétrica:');
{
  const MURO720 = { largo: 720, alto: 310, ancho: 20, recub_sup: 2, recub_inf: 2, recub_lat: 2 };
  function cb(fig, phi, delta, pataFija) {
    return {
      tipologia: 'CB', figura: fig, diam: phi, modo: 'lineal',
      pose: { cara: 'extremo', lado: -1, rumbo: 'y' },
      dims: Object.fromEntries(CAT.get(fig).parciales.map(function (L) {
        if (L === 'A') return [L, { modo: 'fija', valor: pataFija || 35 }];
        if (L === 'B' && delta) return [L, { modo: 'auto', delta: delta }];
        return [L, { modo: 'auto' }];
      })),
      distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
    };
  }
  // Recubrimiento REAL de cada punta = de la cara del hormigón a la CRESTA del acero.
  // La cresta está φ/2 más allá del eje en el extremo que DOBLA, y en el eje mismo en
  // el que se corta a ras (una punta plana no sobresale por su propio eje).
  function recubs(pl, phi, dobIni, dobFin) {
    const y = lim(pl, 'y'), r = phi / 20;
    return {
      inf: r2(155 + (y.lo - (dobIni ? r : 0))),
      sup: r2(155 - (y.hi + (dobFin ? r : 0)))
    };
  }
  [8, 16].forEach(function (phi) {
    const c = cb('102A', phi);
    const rc = recubs(R.expandirComponente(c, MURO720)[0], phi, true, false);
    ok(rc.inf === 2 && rc.sup === 2,
      '102A φ' + phi + ': las DOS caras del eje y a 2.00 (antes ' +
      (phi === 16 ? '1.60 / 2.40' : '1.80 / 2.20') + ') (=' + rc.inf + ' / ' + rc.sup + ')');
  });
  // CONTROL SIMÉTRICO: la 103A dobla en las dos puntas, así que ya daba 2.00 / 2.00 y
  // NO se mueve. Es la pieza con la que el defecto se escondía.
  {
    const c = cb('103A', 16);
    const rc = recubs(R.expandirComponente(c, MURO720)[0], 16, true, true);
    ok(rc.inf === 2 && rc.sup === 2,
      '103A φ16 (simétrica): sigue en 2.00 / 2.00 — el control que escondía el defecto (=' +
      rc.inf + ' / ' + rc.sup + ')');
  }
  // Y EL CASO DEL USUARIO, CON SU Δ. «El empalme sí puede salirse del hormigón, eso es
  // esperado; para eso es el DELTA»: el desborde de arriba es el que PIDIÓ (Δ 96 en el
  // dominante, un arranque que sigue en la próxima etapa de hormigonado) y no se avisa;
  // la punta de abajo, que ningún Δ explica, cierra en su recubrimiento.
  {
    const c = cb('102A', 16, 96);
    const pl = R.expandirComponente(c, MURO720)[0];
    const rc = recubs(pl, 16, true, false);
    ok(rc.inf === 2, 'con Δ 96 la punta SIN Δ sigue cerrando en 2.00 (=' + rc.inf + ')');
    ok(r2(lim(pl, 'y').hi) === 249, '…y la punta con Δ asoma 94 cm, que es lo que se pidió');
    ok(!avisos(c).length,
      'y el motor NO grita: el desborde lo explica el Δ del dominante (=' +
      JSON.stringify(avisos(c)) + ')');
  }
  // …PERO LA HOLGURA ES HOLGURA, NO UN INTERRUPTOR, Y ES SÓLO DE SU EJE. El Δ del
  // dominante alarga la barra POR DONDE CORRE (el rumbo, acá la y): lo que se sale
  // por OTRO eje no lo explica y sigue avisándose. Una pata de 800 en un muro de 720
  // cruza el elemento a lo LARGO y asoma por el testero opuesto.
  {
    const c2 = cb('102A', 16, 96, 800);
    R.expandirComponente(c2, MURO720);
    ok(avisos(c2).some(function (a) { return /Fierro FUERA del hormigón: .* eje x/.test(a); }),
      'una pata de 800 que se sale por el eje x SÍ se avisa: el Δ del dominante es de la y (=' +
      JSON.stringify(avisos(c2)) + ')');
  }
}

console.log(fallos ? '\nFALLOS: ' + fallos : '\nOK — fierro fuera del hormigón: causas raíz congeladas.');
process.exit(fallos ? 1 : 0);
