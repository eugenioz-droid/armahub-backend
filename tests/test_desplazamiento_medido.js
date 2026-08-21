// =============================================================================
// DESPLAZAMIENTO MEDIDO CON CARA DE REFERENCIA (21-ago) — test headless (Node)
// =============================================================================
// El usuario: «no hay forma de decir que esta pieza va a tantos centímetros de esta
// cara; sólo se puede dar una medida absoluta o dejar que la pieza llene el
// hormigón», así que toda colocación deliberada se hacía arrastrando a mano y se
// perdía el control del número. Lo necesita para una segunda capa de cabezales sin
// arrastrarla y para colocar estribos de confinamiento de a uno.
//
// QUÉ CONGELA ESTE TEST
// -----------------------------------------------------------------------------
//   A. EJES EN LOS QUE APLICA — el eje por el que REPARTE una distribución queda
//      fuera (ahí manda el rango, y el editor borra el hint de ese eje al encender
//      el abanico); en un ARREGLO, también el de la 2ª línea. Sin distribución
//      activa, los tres.
//   B. (retirada 23-ago: el desplegable de cara desapareció — ver la sección B).
//   C. EL NÚMERO ESCRITO ES EL QUE QUEDA — se teclea una distancia y la pieza queda
//      ahí, medida sobre lo que el motor generó de verdad.
//   D. …Y SOBREVIVE AL HORMIGÓN — es EL pedido: al cambiar el elemento, la pieza
//      conserva esa distancia a SU cara (no se queda clavada en su coordenada ni la
//      empuja el cambio). Sin esto, un template no sirve para otro elemento.
//   E. MISMA PUERTA QUE EL ARRASTRE — escribir deja el mismo rastro que mover con la
//      mano: pos_hint escrito + pos_ancla invalidada, para que el motor la re-estampe
//      al expandir. Si la ficha escribiera el ancla por su cuenta, el número tecleado
//      y el gesto podrían discrepar.
//   F. CAMBIAR LA CARA NO MUEVE NADA — el selector sólo dice desde dónde se mide: los
//      dos huecos más el ancho de la pieza suman el elemento, y la barra no se movió.
//   G. LA Y DE UN CABEZAL — el caso que el usuario pidió (segunda capa de cabezales
//      sin arrastrarla): el eje de la cara contra la que se ancla SÍ acepta el
//      desplazamiento, y también conserva la distancia al cambiar el hormigón.
//   I. LA MEDIDA VA AL BORDE DE LA BARRA, NO A SU EJE — recubrimiento 2 + φ8 dan
//      2,0 en el campo (el borde apoyado en la línea de recubrimiento), no 2,4 (el
//      eje). Cada lado se corrige con SU signo y el descuento sigue la DIRECCIÓN del
//      tramo, no un φ/2 a ciegas.
//   L. LAS DOS CARAS DEL MISMO EJE, CON UNA PIEZA ASIMÉTRICA — una punta que dobla
//      y otra cortada a ras no se corrigen con el mismo descuento; con una pieza
//      simétrica (el estribo de la sección I) el error se esconde.
//   H+J+K. LOS SEIS CAMPOS (23-ago) — tres pares, uno por eje, sin desplegable de
//      cara. El eje que NO reparte: dos lecturas de la misma posición (una determina
//      la otra). El eje que SÍ reparte: las dos puntas del rango, independientes, y
//      el campo de cada cara escribe en la punta de SU lado aunque el rango vaya al
//      revés.
//
// Correr con: node tests/test_desplazamiento_medido.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
const r2 = (v) => Math.round(Number(v) * 100) / 100;
const clon = (o) => JSON.parse(JSON.stringify(o));

// --------------------------------------------------------------- entorno mínimo
// Mismo mini-DOM que tests/test_cotas_vivas.js: acá se prueban la CUENTA y la
// ESCRITURA, que son funciones sobre la receta; el DOM real no hace falta.
function El() {
  this.style = {}; this.dataset = {}; this.children = []; this.className = ''; this.value = '';
  this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.setAttribute = function () {}; El.prototype.getAttribute = function () { return null; };
El.prototype.addEventListener = function () {}; El.prototype.removeEventListener = function () {};
El.prototype.querySelector = function () { return null; };
El.prototype.querySelectorAll = function () { return []; };
El.prototype.closest = function () { return null; };

const win = {};
win.window = win; win.self = win;
win.document = {
  body: new El(), documentElement: new El(), head: new El(),
  createElement: () => new El(), createElementNS: () => new El(), createTextNode: () => new El(),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}
};
win.console = console;
win.JSON = JSON; win.Math = Math; win.Date = Date; win.Object = Object; win.Array = Array;
win.Number = Number; win.String = String; win.Boolean = Boolean; win.isFinite = isFinite;
win.parseFloat = parseFloat; win.parseInt = parseInt; win.isNaN = isNaN; win.Error = Error;
win.Promise = Promise; win.RegExp = RegExp;
win.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
win.navigator = { userAgent: 'node' };
win.location = { href: 'http://x/', origin: 'http://x' };
win.fetch = () => Promise.reject(new Error('sin red'));
win.alert = () => {}; win.confirm = () => false;
win.setTimeout = () => 0; win.clearTimeout = () => {};
win.setInterval = () => 0; win.clearInterval = () => {};
win.requestAnimationFrame = () => 0; win.cancelAnimationFrame = () => {};
win.addEventListener = () => {}; win.removeEventListener = () => {};
win.getComputedStyle = () => ({});
win.devicePixelRatio = 1; win.innerWidth = 1200; win.innerHeight = 800;

const ctx = vm.createContext(win);
function mod(file, nombre) {
  const src = fs.readFileSync(path.join(BASE, file), 'utf8');
  const m = { exports: {} };
  vm.runInContext('(function(module, exports, require, global){' + src + '\n})', ctx, { filename: file })(m, m.exports, require, win);
  if (nombre) win[nombre] = m.exports;
  return m.exports;
}
mod('catalogo_figuras.js', 'ModeladorCatalogoFiguras');
mod('figura_puntos.js', 'ModeladorFiguraPuntos');
mod('motor_geom.js', 'ModeladorMotorGeom');
mod('reglas.js', 'ModeladorReglas');
mod('generar.js', 'ModeladorGenerar');
mod('semilla_viga.js', 'ModeladorSemilla');
vm.runInContext(fs.readFileSync(path.join(BASE, 'template_editor.js'), 'utf8'), ctx, { filename: 'template_editor.js' });

const R = win.ModeladorReglas;
const G = win.ModeladorGenerar;
const TE = win.TemplateEditor;
const ST = TE._ST;

const GEO = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };

// UNA sola pieza por receta: así el etiquetado de meta.ci es exacto sin depender de
// cómo se reparten los placements entre componentes.
function montar(comp, geo) {
  ST.receta = { tipo: 'viga', geometria: Object.assign({}, geo || GEO), componentes: [comp] };
  ST.selCi = 0;
  ST.ultimoOut = null;
  ST.dragMove = null; ST.dragMarco = null; ST.dragRango = null;
  return ST.receta.componentes[0];
}
// El mismo orden del editor: re-anclar la receta contra el hormigón de AHORA y
// generar. Es lo que hace _regenerar (que no se llama acá porque arrastra medio
// panel de DOM detrás); lo que se prueba es el resultado del motor, no el repintado.
function regenerar() {
  R.reanclarReceta(ST.receta);
  const out = G.generarViga(ST.receta);
  (out.placements || []).forEach((pl) => { pl.meta = pl.meta || {}; pl.meta.ci = 0; });
  ST.ultimoOut = out;
  return out;
}
function hueco(eje, ref) { return r2(TE._huecoACara(TE._bboxCompMundo(0), eje, ref)); }

function estribo(extra) {
  const c = {
    comp_id: 'E1', jerarquia: 2, tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral',
    angulos: [135, 135], modo: 'puntual', plano_pieza: { orientacion: 'acostada', volteado: false },
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' }
  };
  for (const k in (extra || {})) c[k] = extra[k];
  return c;
}

// ============================================================ A · ejes que aplican
console.log('\nA · en qué ejes se ofrece el desplazamiento');
{
  const suelto = montar(estribo());
  regenerar();
  ok(TE._ejesDesplazables(suelto).join(',') === 'x,y,z',
    'sin distribución activa se ofrecen los tres ejes (=' + TE._ejesDesplazables(suelto).join(',') + ')');

  const reparte = montar(estribo({
    modo: 'lineal',
    distribucion: { modo: 'linear', activa: true, sep: 20, rango: { from: -290, to: 290, sep: 20, eje: 'x' } }
  }));
  regenerar();
  const ejes = TE._ejesDesplazables(reparte);
  ok(ejes.indexOf('x') < 0, 'el eje por el que REPARTE queda fuera: ahí la posición la manda el rango');
  ok(ejes.join(',') === 'y,z', '…y los otros dos siguen ofreciéndose (=' + ejes.join(',') + ')');

  const area = montar(estribo({
    modo: 'arreglo',
    distribucion: {
      modo: 'arreglo', activa: true, sep: 20,
      rango: { from: -290, to: 290, sep: 20, eje: 'x' },
      rango2: { from: -26, to: 26, sep: 15, eje: 'y' }
    }
  }));
  regenerar();
  ok(TE._ejesDesplazables(area).join(',') === 'z',
    'en un ARREGLO también sale el eje de la 2ª línea: queda un solo eje libre (=' +
    TE._ejesDesplazables(area).join(',') + ')');
}

// ============================================ B · sin cara que elegir (23-ago)
// La ficha ya NO tiene desplegable de cara: muestra las DOS distancias del eje, así
// que no hay una cara de partida que derivar. Lo que sigue vivo —y es lo que
// importaba— es que EL ANCLA la elige el motor (la cara más cercana), y eso lo
// congela la sección E de más abajo.

// ================================ C+D+E · el número escrito queda, y sobrevive al hormigón
console.log('\nC+D+E · se teclea la distancia, la pieza queda ahí y la conserva');
{
  const c = montar(estribo());
  regenerar();
  ok(TE._setHuecoACara(0, 'x', 'min', 15), 'la ficha acepta escribir 15 cm al testero inicio');
  ok(c.pos_hint && isFinite(Number(c.pos_hint.x)),
    'E · escribió pos_hint, que es la MISMA puerta que usa el arrastre (=' + JSON.stringify(c.pos_hint) + ')');
  ok(!(c.pos_ancla && c.pos_ancla.x),
    'E · …y dejó el ancla invalidada: la estampa el motor al expandir, no la ficha');
  regenerar();
  ok(hueco('x', 'min') === 15, 'C · la pieza quedó a 15 cm del testero (=' + hueco('x', 'min') + ')');
  ok(c.pos_ancla && c.pos_ancla.x && c.pos_ancla.x.ref === 'min' && c.pos_ancla.x.mide === 'pos',
    'E · el motor estampó el ancla de POSICIÓN contra esa cara (=' + JSON.stringify(c.pos_ancla.x) + ')');

  // EL PEDIDO: cambiar el hormigón y que la pieza conserve SU distancia a la cara.
  ST.receta.geometria.largo = 800; regenerar();
  ok(hueco('x', 'min') === 15, 'D · con la viga a 800 sigue a 15 cm del testero (=' + hueco('x', 'min') + ')');
  ST.receta.geometria.largo = 400; regenerar();
  ok(hueco('x', 'min') === 15, 'D · …y a 400 también (=' + hueco('x', 'min') + ')');

  // La otra cara: escribir contra 'max' ancla contra 'max' y también se conserva.
  ST.receta.geometria.largo = 600; regenerar();
  TE._setHuecoACara(0, 'x', 'max', 20); regenerar();
  ok(hueco('x', 'max') === 20, 'C · 20 cm al testero fin (=' + hueco('x', 'max') + ')');
  ok(c.pos_ancla.x.ref === 'max', 'E · el ancla siguió a la cara desde la que se midió');
  ST.receta.geometria.largo = 900; regenerar();
  ok(hueco('x', 'max') === 20, 'D · con la viga a 900 sigue a 20 cm del testero fin (=' + hueco('x', 'max') + ')');
}

// ============================================ F · cambiar la cara no mueve la pieza
console.log('\nF · el selector de cara sólo cambia desde dónde se mide');
{
  const c = montar(estribo());
  regenerar();
  TE._setHuecoACara(0, 'x', 'min', 40); regenerar();
  const antes = clon(c.pos_hint);
  const bb = TE._bboxCompMundo(0);
  const hMin = r2(TE._huecoACara(bb, 'x', 'min'));
  const hMax = r2(TE._huecoACara(bb, 'x', 'max'));
  // El ANCHO que cierra la cuenta es el del ACERO (loB/hiB), no el del eje: los dos
  // huecos se miden al borde, así que el trozo del medio también. Con el ancho del
  // eje la suma se quedaba un φ corta (23-ago).
  const ancho = r2(bb.x.hiB - bb.x.loB);
  ok(hMin === 40, 'el hueco al testero inicio es el que se escribió (=' + hMin + ')');
  ok(r2(hMin + ancho + hMax) === r2(ST.receta.geometria.largo),
    'los dos huecos + la pieza suman el elemento (' + hMin + ' + ' + ancho + ' + ' + hMax + ')');
  ok(JSON.stringify(c.pos_hint) === JSON.stringify(antes),
    'leer la distancia a la otra cara NO tocó la receta');
}

// ======================================== G · la Y de un cabezal (el caso del usuario)
console.log('\nG · segunda capa de cabezales: distancia a la cara superior');
{
  const semilla = win.ModeladorSemilla.semillaViga();
  const cbs = semilla.componentes.find((x) => x.comp_id === 'CBS');
  const c = montar(clon(cbs));
  regenerar();
  ok(TE._ejesDesplazables(c).indexOf('y') >= 0,
    'el eje de la cara contra la que se ancla el cabezal SÍ se ofrece (el arrastre no lo escribe)');
  ok(TE._setHuecoACara(0, 'y', 'max', 12), 'se escriben 12 cm a la cara superior');
  regenerar();
  ok(hueco('y', 'max') === 12, 'el cabezal quedó a 12 cm de la cara superior (=' + hueco('y', 'max') + ')');
  ST.receta.geometria.alto = 90; regenerar();
  ok(hueco('y', 'max') === 12,
    'con la viga de 90 de alto sigue a 12 cm de la cara superior (=' + hueco('y', 'max') + ')');
}

// ======================================== H · la fila se arma (camino DOM de la ficha)
console.log('\nH · la ficha arma UNA fila con los tres pares');
{
  const c = montar(estribo({
    modo: 'lineal',
    distribucion: { modo: 'linear', activa: true, sep: 20, rango: { from: -290, to: 290, sep: 20, eje: 'x' } }
  }));
  regenerar();
  const body = new El();
  TE._filasDesplazamiento(body, c, 0);
  ok(body.children.length === 1,
    'una sola fila (los tres pares viven en ella) (=' + body.children.length + ')');
  const cols = body.children[0].children;
  ok(cols.length === 3, 'TRES pares, uno por eje — también el que reparte (=' + cols.length + ')');
  // Cada par = icono + los dos campos (el desplegable de cara desapareció).
  ok(cols.every((col) => col.children.length === 2 && col.children[1].children.length === 2),
    'cada par es un icono + DOS campos, sin desplegable de cara');
  const vacio = new El();
  ST.ultimoOut = null;                       // todavía no se generó nada
  TE._filasDesplazamiento(vacio, c, 0);
  ok(vacio.children.length === 0,
    'sin nada generado no se rotula una distancia inventada');
}

// ============================ J · los seis campos: dos casos distintos por eje
// El eje que NO reparte: dos lecturas de la MISMA posición (escribir en uno recoloca
// la pieza y el otro se recalcula solo). El eje que SÍ reparte: las dos puntas del
// rango, independientes — y NO se apagan.
console.log('\nJ · el par del eje que reparte son las dos puntas del rango');
{
  const c = montar(estribo({
    modo: 'lineal',
    distribucion: { modo: 'linear', activa: true, sep: 20, rango: { from: -290, to: 290, sep: 20, eje: 'x' } }
  }));
  regenerar();
  const rg = TE._rangoDeEje(c, 'x');
  ok(rg === c.distribucion.rango, 'el eje x lo manda el rango de la distribución');
  ok(TE._rangoDeEje(c, 'y') === null && TE._rangoDeEje(c, 'z') === null,
    'los otros dos ejes no los reparte nadie');
  ok(r2(TE._puntaRangoACara(rg, 'x', 'min')) === 10 && r2(TE._puntaRangoACara(rg, 'x', 'max')) === 10,
    'el par dice dónde empieza y dónde termina el reparto (10 y 10 en una viga de 600)');
  // Escribir una punta mueve ESA punta y deja la otra donde estaba: son independientes
  // (el largo del rango es libre).
  TE._setPuntaRangoACara(c, rg, 'x', 'min', 40); regenerar();
  ok(r2(rg.from) === -260 && r2(rg.to) === 290,
    'escribir 40 al testero inicio movió sólo esa punta (=' + r2(rg.from) + ' / ' + r2(rg.to) + ')');
  ok(r2(TE._puntaRangoACara(rg, 'x', 'min')) === 40, 'y el campo lo dice (=40)');
  // Rango AL REVÉS: el campo de cada cara escribe en la punta de SU lado, no siempre
  // en `from` (si no, el testero inicio movería la punta del otro extremo).
  const rev = { from: 290, to: -290, sep: 20, eje: 'x' };
  TE._setPuntaRangoACara(c, rev, 'x', 'min', 50);
  ok(r2(rev.to) === -250 && r2(rev.from) === 290,
    'con el rango al revés, el campo del testero inicio mueve la punta de ese lado');
}

// ============================================ K · el par del eje que NO reparte
console.log('\nK · el par del eje libre son dos lecturas de la misma posición');
{
  const c = montar(estribo());
  regenerar();
  TE._setHuecoACara(0, 'z', 'min', 4); regenerar();
  const bb = TE._bboxCompMundo(0);
  const hMin = r2(TE._huecoACara(bb, 'z', 'min'));
  const hMax = r2(TE._huecoACara(bb, 'z', 'max'));
  ok(hMin === 4, 'se escribió 4 en el campo de la izquierda (=' + hMin + ')');
  ok(r2(hMin + (bb.z.hiB - bb.z.loB) + hMax) === r2(GEO.ancho),
    'el otro campo NO es libre: lo determinan la pieza y el elemento (=' + hMax + ')');
}

// ============================ I · LA MEDIDA VA AL BORDE, NO AL EJE (caso del usuario)
// «Todo el modelo mide a los bordes»: las dims A/B/C de una figura se miden a la
// cresta del doblez. Con recubrimiento 2 cm y φ8 el fierro apoya su BORDE en la línea
// de recubrimiento, así que la ficha tiene que decir 2,0 — y no 2,4, que es el eje
// (2 del recubrimiento + el medio diámetro que hay del borde al eje).
console.log('\nI · recubrimiento 2 y φ8 → el campo dice 2,0 (borde), no 2,4 (eje)');
{
  montar(estribo(), { largo: 600, alto: 60, ancho: 30, recub_sup: 2, recub_inf: 2, recub_lat: 2 });
  regenerar();
  const bb = TE._bboxCompMundo(0);
  ok(hueco('y', 'max') === 2 && hueco('y', 'min') === 2,
    'a la cara superior y a la inferior: 2,0 (=' + hueco('y', 'max') + ' / ' + hueco('y', 'min') + ')');
  ok(hueco('z', 'max') === 2 && hueco('z', 'min') === 2,
    'a los dos laterales: 2,0 (=' + hueco('z', 'max') + ' / ' + hueco('z', 'min') + ')');
  // El eje sigue estando —es lo que se traslada— y sigue a 2,4: la corrección es de
  // MEDIDA, no un cambio de la geometría.
  ok(r2(GEO.alto / 2 - bb.y.hi) === 2.4 && r2(bb.y.hiB - bb.y.hi) === 0.4,
    'el EJE de la barra sigue a 2,4 de la cara: el borde está medio diámetro más afuera');
  // EL SIGNO ES POR LADO: el borde de arriba sube y el de abajo baja (si los dos se
  // corrigieran igual, un hueco saldría bien y el otro con un φ de error).
  ok(r2(bb.y.loB - bb.y.lo) === -0.4 && r2(bb.y.hiB - bb.y.hi) === 0.4,
    'cada lado se corrige con SU signo (−0.4 abajo · +0.4 arriba)');
  // Y NO ES UN φ/2 A CIEGAS: sobre el eje x el estribo es plano (todos sus tramos
  // corren de través), así que ahí sí sobresale el radio entero.
  ok(r2(bb.x.hiB - bb.x.loB) === 0.8,
    'el estribo, plano en x, ocupa un φ de espesor real (=' + r2(bb.x.hiB - bb.x.loB) + ')');
}

// ============ L · LAS DOS CARAS DEL MISMO EJE, CON UNA PIEZA ASIMÉTRICA (23-ago)
// La sección I mide con un ESTRIBO, que es simétrico: sus dos puntas se corrigen
// igual y por eso un error de signo o una mitad mal repartida se esconden ahí.
// Reporte del usuario: muro 720×310×20 recub 2, CB 102A φ16 en pose {extremo, −1,
// rumbo y}, A fija 35 y B en auto. La 102A DOBLA en una punta y se corta A RAS en la
// otra, así que el φ/2 que hay que descontar NO es el mismo en las dos caras del eje
// y — y el motor se lo repartía a medias.
// MEDIDO antes del fix: 1,60 abajo (el codo, METIDO 0,4 en su propio recubrimiento) y
// 2,40 arriba (el corte, con 0,4 de sobra). Con φ8: 1,80 / 2,20 — el sesgo es siempre
// φ/4. La causa está en el motor (figura_puntos._normalizarCadena centraba el bbox de
// los EJES en vez de dar a cada punta SU reserva), y acá se congela lo que el usuario
// LEE, que es lo que se rompió.
console.log('\nL · pieza asimétrica: las dos caras del eje y, cada una con su descuento');
{
  const MURO = { largo: 720, alto: 310, ancho: 20, recub_sup: 2, recub_inf: 2, recub_lat: 2 };
  const cb = (fig, phi, delta) => ({
    comp_id: 'C1', tipologia: 'CB', figura: fig, diam: phi, modo: 'lineal',
    pose: { cara: 'extremo', lado: -1, rumbo: 'y' },
    dims: (fig === '102A')
      ? { A: { modo: 'fija', valor: 35 }, B: delta ? { modo: 'auto', delta } : { modo: 'auto' } }
      : { A: { modo: 'fija', valor: 35 }, B: { modo: 'auto' }, C: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0 }
  });
  [8, 16].forEach((phi) => {
    montar(cb('102A', phi), MURO);
    regenerar();
    ok(hueco('y', 'min') === 2 && hueco('y', 'max') === 2,
      '102A φ' + phi + ' (doblez abajo, corte arriba): 2,0 en LAS DOS caras del eje y — antes ' +
      (phi === 16 ? '1,60 / 2,40' : '1,80 / 2,20') +
      ' (=' + hueco('y', 'min') + ' / ' + hueco('y', 'max') + ')');
  });
  // CONTROL SIMÉTRICO: la 103A dobla en las dos puntas y ya daba 2,0 / 2,0. Es la
  // pieza con la que el defecto se escondía, y no se mueve.
  montar(cb('103A', 16), MURO);
  regenerar();
  ok(hueco('y', 'min') === 2 && hueco('y', 'max') === 2,
    '103A φ16 (simétrica): sigue en 2,0 / 2,0 (=' + hueco('y', 'min') + ' / ' + hueco('y', 'max') + ')');
  // Y EL CASO COMPLETO DEL USUARIO, con su Δ 96 en el lado B: la punta de abajo cierra
  // en su recubrimiento y la de arriba asoma 94 cm — un arranque que sigue en la
  // próxima etapa de hormigonado, que es para lo que existe el Δ. Los dos números son
  // del MISMO eje y NO se corrigen con el mismo signo.
  montar(cb('102A', 16, 96), MURO);
  regenerar();
  ok(hueco('y', 'min') === 2 && hueco('y', 'max') === -94,
    'con Δ 96: 2,0 abajo (nada lo explica, tiene que cerrar) y −94 arriba (lo pidió el Δ) (=' +
    hueco('y', 'min') + ' / ' + hueco('y', 'max') + ')');
}

console.log(fallos ? ('\n' + fallos + ' FALLO(S)') : '\nOK — el desplazamiento medido está congelado');
process.exit(fallos ? 1 : 0);
