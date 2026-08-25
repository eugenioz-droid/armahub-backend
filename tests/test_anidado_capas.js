// =============================================================================
// AUTOAJUSTE DE CAPAS ANIDADAS — REGLA v4 (decisión del usuario, 25-ago-2026)
// =============================================================================
// «Un extremo del cuerpo CIERRA cuando de él sale un lado PERPENDICULAR.»
//     descuento de la capa k = (k − 1) · φ · (nº de extremos que cierran)
// y el REDONDEO a entero va DESPUÉS del descuento y HACIA ABAJO («ajustamos la
// barra hacia abajo y listo»): 588.8 no es una medida de taller.
//
// QUÉ ESTABA MAL ANTES (medido en viga 600×60×30, CBS φ16, 2 capas gap 6, auto):
//     102A  B = 592 → 592   (0 φ)   …cierra por UN extremo: le tocaba 1 φ
//     103A  B = 592 → 588.8 (2 φ)   …acertaba, pero por casualidad
//     103B  B = 592 → 588.8 (2 φ)   …sus patas van a 45°: no cierran nada
// El criterio viejo contaba VECINOS EN LA CADENA (interior = 2, extremo = 1), o
// sea la POSICIÓN de la letra en la lista de dims. Eso le daba el mismo −2φ a
// cualquier figura de 3+ lados y cero a las de 2, sin mirar la geometría.
//
// POR QUÉ PERPENDICULAR — no es una preferencia, sale de otra regla del MISMO
// usuario: «al ajustar capas anidadas no debe considerar esta altura (Sep), debe
// ajustar SOLO la medida de B». Si el descuento no puede depender del Sep,
// entonces sólo un vecino perpendicular lo produce: baja recto, así que a
// CUALQUIER profundidad sigue en la misma coordenada longitudinal y el retiro es
// exactamente φ. Un vecino diagonal, a profundidad `gap`, está en u ∓ gap·cot(θ):
// el retiro dependería del Sep → no se inventa un número, se AVISA.
//
// LA OTRA MITAD DE LA REGLA — DE QUÉ PUNTA SALE (25-ago): «para la 102A estás
// descontando arriba y abajo. Debiera ser solo donde tiene pata que choca». Saber
// CUÁNTO acortar no basta: el trazador CENTRA la cadena por bbox, así que una dim
// más corta entra mitad y mitad por las dos puntas. Eso es correcto cuando el lado
// cierra por sus DOS extremos (103A) y falso cuando cierra por UNO (102A: su punta
// libre no choca con nada y tiene que quedarse quieta). El predicado ya sabía la
// respuesta —recorre el vecino de inicio y el de fin por separado— y sólo los
// sumaba; ahora publica `extremos[LADO] = {inicio, fin}` y anidarFigura lo
// convierte en `sesgo`, con el acortamiento REAL (el de después del redondeo).
// El bloque I lo mide con los bbox de las tres capas.
//
// SIN TABLA POR FIGURA Y SIN RAMA POR TIPOLOGÍA: todo sale de `tramosDeFigura`
// (lo que el Diseñador dibujó, o la derivación del seed) leído en el marco del
// trazador. Una figura NUEVA trae su respuesta en su topología.
//
// Correr con: node tests/test_anidado_capas.js
// =============================================================================

const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
const FP = global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));
const S = require(path.join(base, 'semilla_viga.js'));
const CAT = require(path.join(base, 'catalogo_figuras.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
function close(a, b, t) { return Math.abs(a - b) < (t || 1e-9); }

const viga = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

// Componente CBS de trabajo: φ16, todo en 'auto' salvo las patas, capas gap 6.
function cbs(figura, nCapas, anidar, extra) {
  const spec = CAT.get(figura);
  const dims = {};
  (spec.parciales || []).forEach(function (L) {
    dims[L] = (L === 'B') ? { modo: 'auto' } : { modo: 'fija', valor: 30 };
  });
  const d = { modo: 'layered', n_capas: nCapas, barras_capa: 3, gap: 6, sentido: 'nucleo' };
  if (anidar != null) d.anidar = anidar;
  return Object.assign({
    comp_id: 'CBS', jerarquia: 2, tipologia: 'CBS', figura: figura, diam: 16,
    cara: 'sup', angulos: [], dims: dims, distribucion: d
  }, extra || {});
}
function capasDe(figura, nCapas, anidar, extra) {
  const c = cbs(figura, nCapas, anidar, extra);
  const pls = R.expandirComponente(c, viga);
  return { pls: pls, avisos: c._avisos || [], comp: c };
}
function anchoX(pl) {
  const xs = pl.puntos.map(function (q) { return q.x; });
  return Math.max.apply(null, xs) - Math.min.apply(null, xs);
}

// ===========================================================================
console.log('A — EL PREDICADO: extremos que CIERRAN, leídos de la topología');
// 101A: un solo lado, ningún doblez → nada cierra.
ok(FP.extremosQueCierran('101A', { A: 592 }).cierres.A === 0,
  '101A (recta): 0 extremos que cierran');
// 102A: un solo doblez, y la pata sale PERPENDICULAR → cierra por UN extremo.
ok(FP.extremosQueCierran('102A', { A: 30, B: 592 }).cierres.B === 1,
  '102A: el cuerpo cierra por UN extremo (una pata perpendicular)');
// 103A: las DOS patas son perpendiculares → cierra por los dos.
ok(FP.extremosQueCierran('103A', { A: 30, B: 592, C: 30 }).cierres.B === 2,
  '103A: el cuerpo cierra por DOS extremos');
// 103B: las dos patas van a 45° (el catálogo declara el ángulo del VÉRTICE) →
// ninguna es perpendicular → 0, y el lado queda declarado DUDOSO.
const ec103B = FP.extremosQueCierran('103B', { A: 30, B: 592, C: 30 });
ok(ec103B.cierres.B === 0 && ec103B.dudosos.join(',') === 'B',
  '103B (patas a 45°): 0 extremos que cierran, y B queda DUDOSO');
// LAS PATAS NUNCA SE ACORTAN, y ahora con un porqué general: una pata corre EN LA
// DIRECCIÓN del apilado, así que al bajar la capa se desliza sobre sí misma.
const ec103A = FP.extremosQueCierran('103A', { A: 30, B: 592, C: 30 });
ok(ec103A.cierres.A === 0 && ec103A.cierres.C === 0,
  'las patas (corren CON el apilado) no cierran por ningún extremo');
// LAS DIMS MANDAN SOBRE LA TOPOLOGÍA para la EXISTENCIA del vecino: una 103A a la
// que le falta la pata C es geométricamente una 102A y contesta como tal.
ok(FP.extremosQueCierran('103A', { A: 30, B: 592 }).cierres.B === 1,
  '103A sin su pata C: el cuerpo cierra por UN solo extremo (es una L)');
// …Y AHORA TAMBIÉN DICE **CUÁL** DE LOS DOS. Es el dato que faltaba para saber de
// qué punta sacar el acortamiento: `cierres` = 1 no distingue una pata al inicio
// de una pata al final, y el sesgo se aplica en direcciones opuestas.
const ex102 = FP.extremosQueCierran('102A', { A: 30, B: 592 }).extremos.B;
ok(ex102.inicio === 1 && ex102.fin === 0,
  '102A: cierra por el extremo INICIAL (ahí está su única pata)');
const ex103C = FP.extremosQueCierran('103C', { A: 30, B: 592, C: 30 }).extremos.B;
ok(ex103C.inicio === 0 && ex103C.fin === 1,
  '103C: cierra por el extremo FINAL (la pata recta es la otra) — el caso espejo');
ok(ec103A.extremos.B.inicio === 1 && ec103A.extremos.B.fin === 1,
  '103A: cierra por los DOS → simétrica, no hay nada que sesgar');
// CONTORNO CERRADO: su capa k no se traslada, se INSETA (anillo concéntrico), así
// que cada lado se retira por su propia normal y cierra por sus DOS extremos.
const ecAnillo = FP.extremosQueCierran('104D', { A: 24, B: 52, C: 24, D: 52 }, { cerrada: true });
ok(ecAnillo.cierres.A === 2 && ecAnillo.cierres.B === 2 && ecAnillo.cierres.D === 2,
  'contorno cerrado: TODOS los lados cierran por los dos extremos (anillo)');

// ===========================================================================
console.log('\nB — 102A / 103A / 103B en el motor, 2 y 3 capas (φ16, gap 6, auto)');
function tabla(figura) {
  const sin = capasDe(figura, 3, false);
  const con = capasDe(figura, 3, true);
  return {
    sin: sin.pls.filter(function (p, i, a) { return a.findIndex(function (q) { return q.meta.capa === p.meta.capa; }) === i; }).map(function (p) { return p.dims.B; }),
    con: con.pls.filter(function (p, i, a) { return a.findIndex(function (q) { return q.meta.capa === p.meta.capa; }) === i; }).map(function (p) { return p.dims.B; }),
    avisos: con.avisos, plsCon: con.pls
  };
}
// 102A — EL DEFECTO QUE ABRIÓ LA v4: antes NO se le ajustaba nada.
const t102 = tabla('102A');
ok(t102.sin.join('/') === '592/592/592', '102A sin ajuste: 592 / 592 / 592');
ok(t102.con.join('/') === '592/590/588',
  '102A CON ajuste: 592 / 590 / 588 (−1φ y −2φ, redondeado abajo) (=' + t102.con.join('/') + ')');
// 103A — dos extremos que cierran: −2φ y −4φ, con el redondeo abajo.
const t103A = tabla('103A');
ok(t103A.sin.join('/') === '592/592/592', '103A sin ajuste: 592 / 592 / 592');
ok(t103A.con.join('/') === '592/588/585',
  '103A CON ajuste: 592 / 588 / 585 (592−3.2→588 · 592−6.4→585) (=' + t103A.con.join('/') + ')');
// 103B — ningún extremo cierra: las tres capas iguales, Y SE AVISA.
const t103B = tabla('103B');
ok(t103B.con.join('/') === '592/592/592',
  '103B CON ajuste: 592 / 592 / 592 — patas diagonales, no se inventa un número');
ok(t103B.avisos.some(function (a) { return /DIAGONAL/.test(a) && /103B/.test(a); }),
  '…y el motor lo DICE (aviso de diagonal), en vez del silencio');
ok(t102.avisos.length === 0 && t103A.avisos.length === 0,
  'las figuras de patas perpendiculares no generan ese aviso');

// ===========================================================================
console.log('\nC — FIDELIDAD GRÁFICA: el trazo sigue a la dim ajustada');
// Innegociable: si la dim baja y el dibujo no, el 3D miente y el despiece factura
// otra cosa. El ancho DIBUJADO tiene que bajar exactamente lo mismo que la dim.
// nCierres = extremos que cierran; el descuento NOMINAL de la capa 3 es
// (3−1)·φ·nCierres, y la dim final es su piso entero.
[['102A', 1], ['103A', 2]].forEach(function (par) {
  const fig = par[0], nCierres = par[1], PHI = 1.6;
  const r = capasDe(fig, 3, true);
  const c1 = r.pls.find(function (p) { return p.meta.capa === 1; });
  const c3 = r.pls.find(function (p) { return p.meta.capa === 3; });
  ok(close(anchoX(c1) - anchoX(c3), c1.dims.B - c3.dims.B),
    fig + ': el ancho dibujado baja lo mismo que la dim (=' +
    (anchoX(c1) - anchoX(c3)).toFixed(3) + ' vs ' + (c1.dims.B - c3.dims.B).toFixed(3) + ')');
  ok(c3.dims.B === Math.floor(c1.dims.B - 2 * PHI * nCierres),
    fig + ': capa 3 = piso(592 − 2·φ·' + nCierres + ') = ' + Math.floor(592 - 2 * PHI * nCierres) +
    ' (=' + c3.dims.B + ')');
});

// ===========================================================================
console.log('\nD — MEDIDA DE TALLER: el redondeo va DESPUÉS del descuento y ABAJO');
const anR = FP.anidarFigura('103A', { A: 30, B: 592, C: 30 }, 1.6, 'cabezal');
ok(anR.dims.B === 588, '592 − 2·1.6 = 588.8 → 588 (entero, hacia abajo) (=' + anR.dims.B + ')');
ok(Number.isInteger(anR.dims.B), 'y sale ENTERO, no 588.8');
// El anillo NO se redondea: su forma la manda el marco de núcleo, no la dim, y
// redondear la dim listada dejaría el despiece diciendo algo que el 3D no dibuja.
const anAnillo = FP.anidarFigura('104D', { A: 24, B: 52, C: 24, D: 52 }, 0.8, 'estribo');
ok(close(anAnillo.dims.A, 22.4) && close(anAnillo.dims.B, 50.4),
  'el ANILLO cerrado no se redondea: 22.4 / 50.4 como siempre (el marco manda la forma)');

// ===========================================================================
console.log('\nE — EL DESPIECE MUESTRA LAS CAPAS COMO ÍTEMS DISTINTOS');
// No hace falta nada extra: `_claveBarra` (generar.js) ya incluye dim_a…dim_i, y
// el ajuste le da a cada capa un cuerpo distinto. Si dos capas midieran lo mismo
// se agruparían, y eso es lo correcto: son la MISMA barra.
function items(figura, anidar) {
  const rec = {
    tipo: 'viga',
    geometria: { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 },
    componentes: [cbs(figura, 3, anidar)]
  };
  return G.generarViga(rec, {}).barras;
}
const it103sin = items('103A', false), it103con = items('103A', true);
ok(it103sin.length === 1 && it103sin[0].cant === 9,
  'sin ajuste las 3 capas son la MISMA barra: 1 ítem × 9 (=' + it103sin.length + ' × ' + it103sin[0].cant + ')');
ok(it103con.length === 3 && it103con.every(function (b) { return b.cant === 3; }),
  'con ajuste son 3 ítems × 3 barras (=' + it103con.length + ')');
ok(it103con.map(function (b) { return b.dim_b; }).join('/') === '592/588/585',
  'y cada ítem lleva SU cuerpo: 592 / 588 / 585 (=' + it103con.map(function (b) { return b.dim_b; }).join('/') + ')');

// ===========================================================================
console.log('\nF — OFFSET DEL COMPONENTE × AJUSTE DE CAPAS: ejes ORTOGONALES');
// El offset (`off_caras`, hormigón recortado) aplica por igual a TODAS las capas y
// el descuento por capa se SUMA a eso: uno recorta el hueco en el que vive el
// componente, el otro retira el cuerpo de la capa k frente a las patas de la k−1.
const OFF = { off_caras: { x: { min: 20, max: 30 } } };
const sinOff = capasDe('103A', 3, true).pls;
const conOff = capasDe('103A', 3, true, OFF).pls;
function bPorCapa(pls) {
  return [1, 2, 3].map(function (k) { return pls.find(function (p) { return p.meta.capa === k; }).dims.B; });
}
const bSin = bPorCapa(sinOff), bCon = bPorCapa(conOff);
ok(bSin.join('/') === '592/588/585' && bCon.join('/') === '542/538/535',
  'off 20+30 baja las TRES capas 50 cm: 592/588/585 → 542/538/535 (=' + bCon.join('/') + ')');
ok(bSin[0] - bSin[1] === bCon[0] - bCon[1] && bSin[0] - bSin[2] === bCon[0] - bCon[2],
  'y el escalón entre capas es IDÉNTICO con y sin offset (los dos ejes no se mezclan)');

// ===========================================================================
console.log('\nG — CANARIO: la viga-semilla no se mueve');
// El CBS de la semilla es una 103B y NO trae `anidar`, así que el ajuste (opt-in
// en figura abierta) ni se activa. Este canario protege contra que un cambio del
// anidado se filtre a las recetas que no lo pidieron.
const outSem = G.generarViga(S.semillaViga(), { sector: 'V', ciclo: 'C1', piso: 'P4', eje: 'V1' });
ok(outSem.resumen.items === 4 && outSem.resumen.barras === 72 && close(outSem.resumen.kg, 140.2, 0.05),
  'viga-semilla: 4 ítems / 72 barras / 140.2 kg (=' + JSON.stringify(outSem.resumen) + ')');

// ===========================================================================
console.log('\nH — BARRIDO DE LAS 63 FIGURAS: el predicado contesta SIEMPRE');
// Lo que este barrido protege es que la regla sea TOTAL y TOPOLÓGICA: ninguna
// figura del catálogo se queda sin respuesta, ningún descuento supera 2 extremos,
// y el CONTORNO CERRADO conserva su −2δ en los cuatro lados (comportamiento
// intacto: ahí el anidado es un anillo concéntrico, no una traslación).
let sinRespuesta = [], fueraDeRango = [], cerradasMal = [], descuadran = [], cerradasSesgadas = [];
CAT.codigos().forEach(function (f) {
  const spec = CAT.get(f);
  const dims = {};
  (spec.parciales || []).forEach(function (L, i) { dims[L] = 100 + i; });
  const cerrada = FP.figuraCerrada(f) || FP.familiaDeDibujo(f) === 'estribo';
  const ec = FP.extremosQueCierran(f, dims, { cerrada: cerrada });
  const an = FP.anidarFigura(f, dims, 1.6, cerrada ? 'estribo' : 'cabezal', { cerrada: cerrada });
  if (cerrada && Object.keys(an.sesgo).length) cerradasSesgadas.push(f);
  (spec.parciales || []).forEach(function (L) {
    const v = ec.cierres[L], e = ec.extremos[L];
    if (v == null) sinRespuesta.push(f + '.' + L);
    else if (!(v >= 0 && v <= 2)) fueraDeRango.push(f + '.' + L + '=' + v);
    if (cerrada && v !== 2) cerradasMal.push(f + '.' + L + '=' + v);
    // CUÁNTOS y CUÁLES tienen que ser LA MISMA respuesta: si divergen, el motor
    // acorta la medida por un lado y traslada la capa por el otro.
    if (!e || (e.inicio + e.fin) !== v) descuadran.push(f + '.' + L);
  });
});
ok(sinRespuesta.length === 0, 'las 63 figuras contestan en todos sus lados (sin respuesta: ' + sinRespuesta.length + ')');
ok(fueraDeRango.length === 0, 'ningún lado cierra por más de 2 extremos (' + fueraDeRango.join(' ') + ')');
ok(cerradasMal.length === 0, 'los 14 contornos cerrados siguen cerrando por los 2 extremos en TODO lado (' + cerradasMal.join(' ') + ')');
ok(descuadran.length === 0,
  'cierres[L] === extremos[L].inicio + extremos[L].fin en las 63 figuras (' + descuadran.join(' ') + ')');
ok(cerradasSesgadas.length === 0,
  'ningún contorno cerrado pide sesgo: su capa es un ANILLO, se inseta, no se traslada (' + cerradasSesgadas.join(' ') + ')');
// LAS QUE NO CAMBIAN DE COMPORTAMIENTO respecto de la regla vieja (control): son
// las de patas perpendiculares y los anillos. Si alguien vuelve a meter el
// criterio de "vecinos de la cadena", 103C/104B/105B lo delatan.
ok(FP.extremosQueCierran('103C', { A: 30, B: 592, C: 30 }).cierres.B === 1 &&
  FP.extremosQueCierran('104B', { A: 30, B: 592, C: 30, D: 30 }).cierres.B === 1 &&
  FP.extremosQueCierran('105B', { A: 30, B: 592, C: 30, D: 30, E: 30 }).cierres.B === 1,
  'las figuras MIXTAS (una pata recta, otra a 45°) cierran por UN extremo: 103C/104B/105B');

// ===========================================================================
console.log('\nI — EL SESGO: el acortamiento sale de la punta que CIERRA');
// «Para la 102A estás descontando arriba y abajo. Debiera ser solo donde tiene
//  pata que choca» (usuario, 25-ago). La v4 acortaba bien la MEDIDA, pero el
// trazador centra la cadena por bbox y el acortamiento entraba mitad por cada
// punta. Medido en la misma viga 600×60×30 rec 4/4/3, CBS φ16, 3 capas gap 6,
// patas fijas 30, cuerpo auto, anidar:true:
//
//   102A — UNA pata: cierra por el extremo INICIAL
//                              ANTES                    AHORA
//     capa 1  B = 592    x  −295.20 .. 296.00     −295.20 .. 296.00
//     capa 2  B = 590    x  −294.20 .. 295.00     −293.20 .. 296.00
//     capa 3  B = 588    x  −293.20 .. 294.00     −291.20 .. 296.00
//                           los DOS bordes           la punta LIBRE no se
//                           entraban 1 y 2           mueve; el retiro entero
//                                                    sale del lado de la pata
//
//   103A — DOS patas: cierra por los dos → el reparto simétrico ES el correcto,
//   y este caso es la prueba de que no se rompió (ANTES = AHORA):
//     capa 1  B = 592    x  −295.20 .. 295.20
//     capa 2  B = 588    x  −293.20 .. 293.20
//     capa 3  B = 585    x  −291.70 .. 291.70
//
//   103C — pata a 45° al inicio y pata RECTA al final: el mismo mecanismo AL
//   REVÉS. Es la prueba de que el signo no está cableado en ningún sitio:
//     capa 1  B = 592    x  −295.20 .. 295.20
//     capa 2  B = 590    x  −295.20 .. 293.20
//     capa 3  B = 588    x  −295.20 .. 291.20     (ahora el borde quieto es el BAJO)
//
// De dónde sale cada mitad: `anidarFigura` dice CUÁNTO se retira cada punta (con
// el acortamiento REAL, el de después del Math.floor) y el TRAZO dice hacia dónde
// va el lado — `figura_puntos._sesgoCadenaU` lee `orPts[i+1].u − orPts[i].u`, el
// mismo patrón que `generar._acortarPatas` con su `Math.sign(first.y − second.y)`.
// Deducirlo de la cara / del lado / del rumbo de la pose es donde se cometen los
// errores de signo.
function bboxX(pls, k) {
  const p = pls.find(function (q) { return q.meta.capa === k; });
  const xs = p.puntos.map(function (q) { return q.x; });
  return { lo: Math.min.apply(null, xs), hi: Math.max.apply(null, xs), B: p.dims.B };
}
const p102 = capasDe('102A', 3, true).pls;
const q1 = bboxX(p102, 1), q2 = bboxX(p102, 2), q3 = bboxX(p102, 3);
ok(close(q1.hi, 296.00, 1e-6) && close(q2.hi, 296.00, 1e-6) && close(q3.hi, 296.00, 1e-6),
  '102A: el borde LIBRE se queda EXACTAMENTE en x = 296.00 en las 3 capas (=' +
  [q1.hi, q2.hi, q3.hi].map(function (v) { return v.toFixed(2); }).join(' / ') + ')');
ok(close(q2.lo - q1.lo, q1.B - q2.B) && close(q3.lo - q1.lo, q1.B - q3.B),
  '…y el borde de la PATA se retira el acortamiento ENTERO: 2 y 4 cm (=' +
  (q2.lo - q1.lo).toFixed(2) + ' / ' + (q3.lo - q1.lo).toFixed(2) + ')');
const p103 = capasDe('103A', 3, true).pls;
const r1 = bboxX(p103, 1), r2 = bboxX(p103, 2), r3 = bboxX(p103, 3);
ok(close(r1.lo, -295.20) && close(r2.lo, -293.20) && close(r3.lo, -291.70) &&
  close(r1.hi, 295.20) && close(r2.hi, 293.20) && close(r3.hi, 291.70),
  '103A: SIMÉTRICA como siempre, −295.20/295.20 · −293.20/293.20 · −291.70/291.70');
const p103C = capasDe('103C', 3, true).pls;
const t1 = bboxX(p103C, 1), t2 = bboxX(p103C, 2), t3 = bboxX(p103C, 3);
ok(close(t1.lo, t2.lo) && close(t1.lo, t3.lo) && close(t1.hi - t3.hi, t1.B - t3.B),
  '103C (cierra por el FINAL): el borde quieto es el de ABAJO y se retira el de arriba (=' +
  [t1.hi, t2.hi, t3.hi].map(function (v) { return v.toFixed(2); }).join(' / ') + ')');
// EL SESGO VA CON EL ACORTAMIENTO **REAL**, no con el nominal: 592 − 1.6 = 590.4
// se lista como 590, así que la punta se tiene que retirar 2 y no 1.6, o el trazo
// deja de seguir a la dim.
const sg102 = FP.anidarFigura('102A', { A: 30, B: 592 }, 1.6, 'cabezal');
ok(sg102.dims.B === 590 && sg102.sesgo.B.inicio === 2 && sg102.sesgo.B.fin === 0,
  '102A: sesgo = 2 por el inicio y 0 por el fin (el REAL de 592→590, no el 1.6 nominal)');
const sg103 = FP.anidarFigura('103A', { A: 30, B: 592, C: 30 }, 1.6, 'cabezal');
ok(!sg103.sesgo.B, '103A: sin sesgo — cierra por los dos, la capa no se traslada');
const sgAnillo = FP.anidarFigura('104D', { A: 24, B: 52, C: 24, D: 52 }, 0.8, 'estribo');
ok(Object.keys(sgAnillo.sesgo).length === 0,
  'contorno cerrado: sin sesgo — su capa es un anillo concéntrico, se inseta, no se traslada');
// FIDELIDAD: trasladar no puede cambiar el ANCHO dibujado (eso lo manda la dim).
ok(close((q1.hi - q1.lo) - (q3.hi - q3.lo), q1.B - q3.B),
  '102A: el sesgo TRASLADA, no estira: el ancho dibujado sigue bajando lo que baja la dim');

console.log('');
console.log(fallos === 0 ? 'TODO OK' : (fallos + ' FALLOS'));
process.exit(fallos === 0 ? 0 : 1);
