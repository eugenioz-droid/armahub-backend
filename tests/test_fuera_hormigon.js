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
  ok(close(z.lo, -z.hi, 1e-9), f + ': el trazo queda CENTRADO en su anchor (z = ±' + r2(z.hi) + ')');
  ok(Math.max(Math.abs(z.lo), Math.abs(z.hi)) + 0.8 <= 10 + 1e-9,
    f + ': todos los puntos con |z| + φ/2 ≤ 10 — dentro del hormigón (antes: 5.55 cm fuera)');
});
// …y la OCUPACIÓN sí es la misma en los tres hosts (6φ es normativo), pero ahora
// lo que cambia con el host es DÓNDE cae y si CABE: en el muro no cabe en el
// marco útil (14.75 > 13.4) y eso se DICE.
{
  const cM = comp('101A', 'TC', { cara: 'lateral', lado: 1, rumbo: 'y' }, 16);
  R.expandirComponente(cM, MURO);
  ok(avisos(cM).some(a => /no cabe ni una vez/.test(a)),
    'y el muro de 20 avisa: la traba φ16 ocupa 14.75 y el marco útil da 13.4 (=' +
    JSON.stringify(avisos(cM)) + ')');
  const cV = comp('101A', 'TRV', { cara: 'lateral', lado: 1, rumbo: 'x' }, 16);
  const plV = R.expandirComponente(cV, VIGA60)[0];
  ok(avisos(cV).length === 0 && fueraDeHormigon(plV, VIGA60, 1.6).fuera <= 1e-9,
    'en la viga de ancho 60 la misma traba entra holgada y no avisa nada');
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
  const c = comp('101A', 'TRV', { cara: 'lateral', lado: 1, rumbo: 'x' }, 16,
    { modo: 'layered', n_capas: 1, barras_capa: 3, gap: 0 });
  const pls = R.expandirComponente(c, VIGA60);
  const zs = pls.map(p => (lim(p, 'z').lo + lim(p, 'z').hi) / 2);
  ok(zs.length === 3 && (Math.max(...zs) - Math.min(...zs)) > 1,
    'donde SÍ cabe, las 3 copias siguen separadas (=' + JSON.stringify(zs.map(r2)) + ')');
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
  [13.4, 10.4, 7.4].forEach(function (v, i) {
    ok(close(pls[i].dims.A, v, 1e-6) && close(pls[i].dims.C, v, 1e-6),
      'capa ' + (i + 1) + ': las patas ⊥ miden el espesor útil MENOS lo que la capa ya se comió = ' +
      v + ' (=' + r2(pls[i].dims.A) + ')');
  });
  ok(pls.every(p => Math.max(Math.abs(lim(p, 'z').lo), Math.abs(lim(p, 'z').hi)) + 0.8 <= 10 + 1e-9),
    'las 3 capas caen dentro del hormigón');
  ok(avisos(c).length === 0, 'y sin avisos: todo cabe (=' + JSON.stringify(avisos(c)) + ')');
}
// Cuando lo que ocupa la profundidad NO es un 'auto' sino el GANCHO NORMATIVO
// (6φ, que no es negociable), la capa no puede encoger: la barra se dibuja igual
// —dato honesto, la regla del módulo— pero AHORA SE DICE. MEDIDO: 105F φ16 en el
// muro ocupa 13.62 en el espesor por su gancho de 135°, así que la capa 3 acaba
// con 3.72 cm de fierro fuera.
{
  const c = comp('105F', 'MH', { cara: 'lateral', lado: 1, rumbo: 'x' }, 16,
    { modo: 'layered', n_capas: 3, barras_capa: 1, gap: 3 });
  const pls = R.expandirComponente(c, MURO);
  const peor = Math.max.apply(null, pls.map(p => fueraDeHormigon(p, MURO, 1.6).fuera));
  ok(peor > 0 && avisos(c).some(a => /Fierro FUERA del hormigón/.test(a)),
    'la 105F no puede encoger su gancho: sale ' + r2(peor) + ' cm y el motor lo DICE (=' +
    JSON.stringify(avisos(c)) + ')');
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

console.log(fallos ? '\nFALLOS: ' + fallos : '\nOK — fierro fuera del hormigón: causas raíz congeladas.');
process.exit(fallos ? 1 : 0);
