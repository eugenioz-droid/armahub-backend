// =============================================================================
// ESPEJAR UN COMPONENTE — test headless (Node)
// =============================================================================
// EL PEDIDO (palabras del usuario, 24-ago): «en muros el lado derecho será igual
// al izquierdo (o similar), entonces sería muy conveniente poder espejar algunos
// componentes como los cabezales, estribos y trabas de confinamiento». En su caso
// real son 4 componentes por extremo —dos de cabezales con dos capas cada uno y
// dos de estribos de confinamiento— que hoy hay que rehacer a mano en el otro
// testero.
//
// QUÉ ES UN ESPEJO ACÁ: la reflexión contra el plano medio del elemento en un eje
// del mundo. La posición ya se guarda como DISTANCIA A UNA CARA, así que espejar
// es cambiar de qué cara se mide dejando la distancia igual; y la orientación
// queda dada vuelta, que es otra de las 24 poses. Las medidas no se tocan.
//
// QUÉ PROTEGE, en orden:
//   A. EL CASO DEL USUARIO — el estribo que estaba a X del testero izquierdo queda
//      a X del derecho, del mismo tamaño, y su forma es el reflejo EXACTO (punto a
//      punto, no "parecida").
//   B. EL REPARTO SE DA VUELTA CON ELLA — el abanico invierte sus dos puntas y sus
//      tramos, así que un @10/@20 leído desde un testero llega al otro leído desde
//      el testero que corresponde.
//   C. LA COPIA QUEDA ANCLADA — el hueco al testero no se mueve con el muro en
//      600, 800 y 400. Sin esto el espejo serviría una vez y no para un template.
//   D. LA PIEZA QUE OCUPA TODO ESE EJE cae encima de la original, sólo dada
//      vuelta. Es lo que pidió el usuario: se crea igual y él la mueve — «ahí
//      obligamos al usuario a ser cuidadoso».
//   E. LA POSE SE DERIVA, NO SE ADIVINA — un cabezal de borde (101A, un palo
//      recto) espejado en x tiene que salir en el testero opuesto. Barriendo las
//      24 poses y quedándose con la primera cuya FORMA calzaba, salía con la
//      normal en z y la copia cruzaba el muro entero: 593 cm de recorrido donde el
//      original medía 10. Un palo recto no identifica una pose.
//   F. EL ORIGINAL NO SE TOCA — espejar devuelve un objeto nuevo.
//
// Correr con: node tests/test_espejo_componente.js

'use strict';
const path = require('path');
const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorCatalogoFiguras = require(path.join(base, 'catalogo_figuras.js'));
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
const R = global.ModeladorReglas = require(path.join(base, 'reglas.js'));

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
const r2 = (v) => Math.round(Number(v) * 100) / 100;

const MURO = { largo: 600, alto: 250, ancho: 20, recub_sup: 2.5, recub_inf: 2.5, recub_lat: 2.5 };
const host = (largo) => Object.assign({}, MURO, { largo: largo || 600 });

// Caja que ocupa el componente sobre un eje, y su hueco a cada cara. Se expande el
// componente TAL CUAL (sin clonar) a propósito: es el motor el que estampa el ancla
// de la posición al expandir, igual que en una regeneración del editor.
function caja(comp, h, eje) {
  const pls = R.expandirComponente(comp, h) || [];
  let lo = Infinity, hi = -Infinity;
  pls.forEach((p) => (p.puntos || []).forEach((q) => {
    const v = Number(q[eje]);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }));
  const D = (eje === 'x') ? h.largo : ((eje === 'y') ? h.alto : h.ancho);
  return { n: pls.length, largo: r2(hi - lo), aMin: r2(lo + D / 2), aMax: r2(D / 2 - hi) };
}
// La forma de una barra, referida a su propio mínimo: invariante a dónde esté.
function forma(comp, h) {
  const pls = R.expandirComponente(JSON.parse(JSON.stringify(comp)), h) || [];
  const pts = (pls[0] && pls[0].puntos) || [];
  if (!pts.length) return null;
  const mn = { x: Infinity, y: Infinity, z: Infinity };
  pts.forEach((q) => ['x', 'y', 'z'].forEach((e) => { if (q[e] < mn[e]) mn[e] = q[e]; }));
  return pts.map((q) => ['x', 'y', 'z'].map((e) => r2(q[e] - mn[e])).join(',')).join(';');
}
// El reflejo de una forma en un eje: los mismos puntos con esa coordenada negada.
function formaReflejada(comp, h, eje) {
  const pls = R.expandirComponente(JSON.parse(JSON.stringify(comp)), h) || [];
  const pts = ((pls[0] && pls[0].puntos) || []).map((q) => {
    const w = { x: Number(q.x), y: Number(q.y), z: Number(q.z) };
    w[eje] = -w[eje];
    return w;
  });
  if (!pts.length) return null;
  const mn = { x: Infinity, y: Infinity, z: Infinity };
  pts.forEach((q) => ['x', 'y', 'z'].forEach((e) => { if (q[e] < mn[e]) mn[e] = q[e]; }));
  return pts.map((q) => ['x', 'y', 'z'].map((e) => r2(q[e] - mn[e])).join(',')).join(';');
}

function estribo(extra) {
  const c = {
    comp_id: 'EC1', tipologia: 'EC', figura: '104D', diam: 8, jerarquia: 1,
    modo: 'puntual', plano_pieza: { volteado: false },
    pose: { cara: 'sup', lado: 1, rumbo: 'z' },
    dims: { A: { modo: 'fija', valor: 40 }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' },
    pos_hint: { x: -250 }
  };
  for (const k in (extra || {})) c[k] = extra[k];
  return c;
}

// ========================================================= A · EL CASO DEL USUARIO
console.log('A · estribo de confinamiento del testero izquierdo al derecho');
{
  const h = host(600);
  const c = estribo();
  R.anclarPosHint(c, h, true);
  const a = caja(c, h, 'x');
  const objetivo = formaReflejada(c, h, 'x');

  const res = R.espejarComponente(c, h, 'x');
  const b = caja(res.comp, h, 'x');

  ok(res.formaExacta === true, 'la forma espejada es exacta, no aproximada');
  ok(res.posicionExacta === true, 'y la posición también');
  ok(b.aMax === a.aMin, 'queda a la misma distancia del testero OPUESTO (' + a.aMin + ' → ' + b.aMax + ')');
  ok(b.largo === a.largo, 'del mismo tamaño: un espejo no cambia largos (=' + b.largo + ')');
  ok(forma(res.comp, h) === objetivo, 'y su geometría es el reflejo punto a punto del original');
}

// ================================================== B · EL REPARTO SE DA VUELTA
console.log('');
console.log('B · el abanico y sus tramos se dan vuelta con la pieza');
{
  const h = host(600);
  const c = estribo({
    modo: 'lineal', pos_hint: undefined,
    distribucion: {
      modo: 'linear', activa: true, sep: 20,
      rango: { eje: 'x', from: -290, to: -100, sep: 20,
               tramos: [{ long: 60, sep: 10 }, { long: 130, sep: 20 }] }
    }
  });
  R.reanclarReceta({ geometria: Object.assign({}, MURO), componentes: [c] });
  const a = caja(c, h, 'x');

  const res = R.espejarComponente(c, h, 'x');
  const r = res.comp.distribucion.rango;
  const b = caja(res.comp, h, 'x');

  ok(r.from === 100 && r.to === 290, 'las dos puntas del rango se reflejan y se intercambian (=' + r.from + '..' + r.to + ')');
  ok(r.tramos[0].sep === 20 && r.tramos[1].sep === 10, 'los tramos se leen desde el otro extremo, así que su orden se invierte');
  ok(b.n === a.n, 'salen las mismas barras (=' + b.n + ')');
  ok(b.aMax === a.aMin && b.aMin === a.aMax, 'y el grupo entero queda reflejado (' + a.aMin + '/' + a.aMax + ' → ' + b.aMin + '/' + b.aMax + ')');
  ok(res.posicionExacta === true, 'sin escribirle posición: la llevó el rango');
  ok(!(res.comp.pos_hint && res.comp.pos_hint.x != null), '…y por eso NO le queda un hint en el eje del abanico');
}

// ==================================================== C · LA COPIA QUEDA ANCLADA
console.log('');
console.log('C · la copia sobrevive al cambio de largo del muro');
{
  const c = estribo();
  R.anclarPosHint(c, host(600), true);
  const res = R.espejarComponente(c, host(600), 'x');
  const rec = { tipo: 'muro', geometria: Object.assign({}, MURO), componentes: [res.comp] };
  const huecos = [], largos = [];
  [600, 800, 400].forEach((L) => {
    rec.geometria.largo = L;
    R.reanclarReceta(rec);
    const m = caja(rec.componentes[0], host(L), 'x');
    huecos.push(m.aMax); largos.push(m.largo);
  });
  ok(huecos.every((v) => v === huecos[0]), 'el hueco al testero no se mueve con el muro en 600/800/400 (=' + huecos.join(' / ') + ')');
  ok(largos.every((v) => v === largos[0]), '…y el tamaño tampoco (=' + largos.join(' / ') + ')');
}

// ======================================== D · LA PIEZA QUE OCUPA TODO ESE EJE
console.log('');
console.log('D · una pieza que ocupa todo el eje cae encima, sólo dada vuelta');
{
  const h = host(600);
  const c = estribo({ pos_hint: undefined });
  const a = caja(c, h, 'z');
  const res = R.espejarComponente(c, h, 'z');
  const b = caja(res.comp, h, 'z');
  ok(b.aMin === a.aMin && b.aMax === a.aMax, 'la copia queda donde estaba la original (' + a.aMin + '/' + a.aMax + ')');
  ok(res.posicionExacta === true, 'y se dice que la posición quedó donde tenía que quedar');
}

// ============================================= E · LA POSE SE DERIVA, NO SE ADIVINA
console.log('');
console.log('E · cabezal de borde: el espejo en x lo manda al testero opuesto');
{
  const h = host(600);
  const cb = {
    comp_id: 'CB1', tipologia: 'CB', figura: '101A', diam: 16, jerarquia: 2,
    modo: 'lineal', pose: { cara: 'extremo', lado: -1, rumbo: 'y' },
    dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 2, barras_capa: 3, gap: 10, sentido: 'nucleo' }
  };
  const a = caja(cb, h, 'x');
  const res = R.espejarComponente(cb, h, 'x');
  const b = caja(res.comp, h, 'x');
  const p = res.comp.pose;

  ok(p.cara === 'extremo' && p.lado === 1, 'la normal cambia de testero y no de eje (=' + JSON.stringify(p) + ')');
  ok(b.largo === a.largo, 'el grupo sigue ocupando lo mismo: 10 cm, no el muro entero (=' + b.largo + ' vs ' + a.largo + ')');
  ok(b.aMax === a.aMin, 'y queda a la misma distancia del testero opuesto (' + a.aMin + ' → ' + b.aMax + ')');
  ok(b.n === a.n, 'con las mismas barras: 2 capas × 3 (=' + b.n + ')');
}

// ==================================================== F · EL ORIGINAL NO SE TOCA
console.log('');
console.log('F · espejar no ensucia el componente de origen');
{
  const h = host(600);
  const c = estribo();
  R.anclarPosHint(c, h, true);
  caja(c, h, 'x');                       // que el motor le estampe lo que tenga que estampar
  const antes = JSON.stringify(c);
  const res = R.espejarComponente(c, h, 'x');
  ok(JSON.stringify(c) === antes, 'el original quedó igual');
  ok(res.comp !== c, 'y la copia es otro objeto');
}

// ======================== G . MEDIR DONDE SE ESCRIBE (el ancla vieja se tira antes)
// (25-ago) El usuario espejo un componente y la copia salio muy lejos, fuera del
// hormigon: "parece que lo tomo como punto medio o algo asi, deberia tomar el eje
// del elemento de hormigon". La causa: pos_ancla guarda la posicion como distancia
// a una cara y la resuelve ELLA, ignorando el hint -pero la correccion del espejo se
// escribe EN EL HINT-. Medir con el ancla viva era medir un estado que despues no
// iba a existir, y peor: el ancla del ORIGINAL pincha la cara de la que la copia ya
// no es, porque al espejarse su punto de nacimiento se muda al testero de enfrente.
// MEDIDO en el defecto: cabezal de borde con hint en x, muro de 600 -la copia caia a
// 1450 cm del testero en vez de a 866, pasada por el DOBLE del salto del nacimiento.
console.log('');
console.log('G . con el ancla de posicion viva, la copia sigue siendo el reflejo');
{
  const h = host(600);
  const cb = {
    comp_id: 'CB1', tipologia: 'CB', figura: '101A', diam: 16, jerarquia: 2,
    modo: 'lineal', pose: { cara: 'extremo', lado: -1, rumbo: 'y' },
    dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 2, barras_capa: 3, gap: 10, sentido: 'nucleo' },
    pos_hint: { x: -280 }
  };
  caja(cb, h, 'x');                      // expandir SIN clonar deja pos_ancla estampada
  ok(!!(cb.pos_ancla && cb.pos_ancla.x), 'el original tiene el ancla viva, como en el editor');
  const a = caja(cb, h, 'x');

  const res = R.espejarComponente(cb, h, 'x');
  const b = caja(res.comp, h, 'x');
  ok(b.aMin === a.aMax && b.aMax === a.aMin,
    'la copia es el reflejo exacto (' + a.aMin + '/' + a.aMax + ' -> ' + b.aMin + '/' + b.aMax + ')');
  ok(res.posicionExacta === true, 'y se reporta como exacta');
}

console.log(fallos ? (fallos + ' FALLO(S)') : 'OK — el espejo del componente está congelado');
process.exit(fallos ? 1 : 0);
