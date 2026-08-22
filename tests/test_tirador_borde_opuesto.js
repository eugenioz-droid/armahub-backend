// =============================================================================
// EL TIRADOR DEL MARCO DEJA QUIETO EL BORDE OPUESTO — test headless (Node)
// =============================================================================
// EL DEFECTO QUE CONGELA (reportado y medido, 24-ago).
// El usuario achicó un estribo de confinamiento arrastrando un tirador hasta
// dejarlo sobre la 4ª capa de cabezales, y al arrastrar el OTRO tirador para que
// alcanzara también la 3ª «se desajustaba completo». Con los campos de Offset no
// se arreglaba nada, porque lo que se había roto no era la posición sino el
// tamaño. Hecho en el otro orden —un tirador para el tamaño, Offset para la
// posición— funcionaba perfecto y hasta sobrevivía al cambio de largo del muro.
//
// LA CAUSA, MEDIDA: el tirador sólo escribía TAMAÑO, y una pieza sin posición
// propia el motor la CENTRA. Al cambiar la medida se movían LOS DOS bordes: el
// primer arrastre se sentía bien (el borde agarrado sigue al cursor) mientras el
// opuesto se corría en silencio la misma cantidad. El segundo arrastre lo hacía
// evidente porque ahí el que se corría era el que el usuario acababa de colocar.
// MEDIDO en el defecto: muro 600, estribo lleno (594,2). Tirador derecho 60 cm
// adentro → ancho 474,2 con los DOS huecos en 62,9. Tirador izquierdo 40 más →
// ancho 394,2 y los dos huecos en 102,9: el borde derecho, ya colocado, se había
// corrido otros 40.
//
// LA REGLA NUEVA: arrastrar un tirador mueve ESE borde y deja el otro donde está.
// La posición se corrige por la MISMA puerta que los campos de Offset de la ficha
// (pos_hint + ancla invalidada), así que los dos caminos llegan al mismo estado.
//
// QUÉ PROTEGE, en orden:
//   A. UN TIRADOR — el borde opuesto no se mueve y el agarrado sigue al cursor
//      1:1 (antes eran 2 cm de medida por cada cm de cursor, repartidos a medias).
//   B. EL CASO DEL USUARIO — dos tiradores seguidos, cada uno mueve SU borde.
//   C. LOS DOS CAMINOS DAN LO MISMO — dos tiradores == tirador + Offset, medido
//      con la misma regla (hueco a la cara) y no de casualidad.
//   D. LA POSICIÓN QUEDA ANCLADA — el hueco a la cara no se mueve con el muro en
//      600, 800 y 400. Es el pedido de fondo: un template sirve para otro elemento.
//   E. SI POR ESE EJE REPARTE, NO SE TOCA LA POSICIÓN — ahí manda el abanico (los
//      campos de Offset tampoco ofrecen ese eje) y el tirador sigue como antes.
//
// Correr con: node tests/test_tirador_borde_opuesto.js

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

const MURO = { largo: 600, alto: 250, ancho: 20, recub_sup: 2.5, recub_inf: 2.5, recub_lat: 2.5 };

// Estribo de confinamiento en la cara del muro (pose rumbo z): su lado A corre por
// el LARGO del muro —el eje que el usuario arrastra— y su lado B por la altura.
function estribo() {
  return {
    comp_id: 'EC1', tipologia: 'EC', figura: '104D', diam: 8, cara: 'lateral', suf_tipo: '',
    jerarquia: 1, modo: 'puntual', plano_pieza: { volteado: false },
    pose: { cara: 'sup', lado: 1, rumbo: 'z' },
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 1, gap: 0, sentido: 'nucleo' }
  };
}
function montar(largo) {
  ST.receta = { tipo: 'muro', geometria: Object.assign({}, MURO, { largo: largo || 600 }), componentes: [estribo()] };
  ST.selCi = 0; ST.ultimoOut = null;
  ST.dragMove = null; ST.dragMarco = null; ST.dragRango = null;
  R.normalizarReceta(ST.receta);
  regen();
  return ST.receta.componentes[0];
}
// El mismo orden del editor: reanclar contra el hormigón de AHORA y generar. No se
// llama _regenerar porque arrastra medio panel de DOM detrás.
function regen() {
  R.reanclarReceta(ST.receta);
  const out = G.generarElemento(ST.receta);
  (out.placements || []).forEach((pl) => { pl.meta = pl.meta || {}; pl.meta.ci = 0; });
  ST.ultimoOut = out;
  return out;
}
// Lo que se ve: cuánto mide la pieza sobre el largo del muro y cuánto queda a cada
// testero. Se mide sobre lo que el motor generó de verdad.
function medir() {
  const c = ST.receta.componentes[0];
  const pls = R.expandirComponente(JSON.parse(JSON.stringify(c)), ST.receta.geometria) || [];
  if (!pls.length) return null;
  let mn = Infinity, mx = -Infinity;
  pls[0].puntos.forEach((q) => { if (q.x < mn) mn = q.x; if (q.x > mx) mx = q.x; });
  const L = ST.receta.geometria.largo;
  return { ancho: r2(mx - mn), izq: r2(mn + L / 2), der: r2(L / 2 - mx) };
}
// EL GESTO COMPLETO: agarrar el borde `ladoUV` del eje horizontal de la elevación y
// arrastrarlo `cm` (signo en coordenadas de la vista, igual que el mouse).
function tirar(ladoUV, cm) {
  TE._iniciarDragMarco('largo', 0, 'u', ladoUV, { u: 0, v: 0 });
  if (!ST.dragMarco) return null;
  const dm = ST.dragMarco;
  TE._dragMarcoMove('largo', { u: cm, v: 0 });
  ST.dragMarco = null;
  regen();
  return dm;
}

// EL MISMO GESTO PERO HECHO CON EL MOUSE: un arrastre real no es un salto, son
// decenas de mousemove seguidos, y entre dos de ellos el editor REGENERA (el rAF de
// _regenerarDiferido). Esa regeneración le vuelve a estampar el ancla de posición a
// la pieza, así que el 2º mousemove ya no encuentra el mismo estado que el 1º: es la
// diferencia que hacía que `tirar()` no viera la deriva del bloque F.
function tirarMouse(ladoUV, cm, pasos) {
  TE._iniciarDragMarco('largo', 0, 'u', ladoUV, { u: 0, v: 0 });
  if (!ST.dragMarco) return null;
  const dm = ST.dragMarco;
  for (let i = 1; i <= pasos; i++) {
    TE._dragMarcoMove('largo', { u: cm * i / pasos, v: 0 });
    regen();                 // el rAF del editor, que es lo que re-ancla la pieza
  }
  ST.dragMarco = null;
  regen();
  return dm;
}

// ================================================================ A · UN TIRADOR
console.log('A · un tirador mueve SU borde y deja el otro donde está');
{
  montar(600);
  const a = medir();
  tirar('+', -60);
  const b = medir();
  ok(b.izq === a.izq, 'el borde que NO se agarró no se movió (' + a.izq + ' → ' + b.izq + ')');
  ok(r2(b.der - a.der) === 60, 'el borde agarrado siguió al cursor 1:1: 60 cm de arrastre, 60 de borde (=' + r2(b.der - a.der) + ')');
  ok(r2(a.ancho - b.ancho) === 60, 'y la pieza se achicó eso mismo, no el doble (=' + r2(a.ancho - b.ancho) + ')');
}

// ========================================================= B · EL CASO DEL USUARIO
console.log('');
console.log('B · dos tiradores seguidos: el segundo no arruina lo del primero');
{
  montar(600);
  tirar('+', -60);
  const uno = medir();
  tirar('-', 40);
  const dos = medir();
  ok(dos.der === uno.der, 'el borde colocado con el PRIMER tirador se quedó quieto (' + uno.der + ' → ' + dos.der + ')');
  ok(r2(dos.izq - uno.izq) === 40, 'y el segundo movió sólo el suyo, 40 cm (=' + r2(dos.izq - uno.izq) + ')');
  ok(r2(uno.ancho - dos.ancho) === 40, 'la pieza se achicó 40, no 80 (=' + r2(uno.ancho - dos.ancho) + ')');
}

// ====================================================== C · LOS DOS CAMINOS IGUALES
console.log('');
console.log('C · dos tiradores == tirador + Offset');
{
  const hueco = () => r2(TE._huecoACara(TE._bboxCompMundo(0), 'x', 'min'));
  montar(600); tirar('+', -60); tirar('-', 20);
  const A = medir(); const hA = hueco();
  const dimA = JSON.parse(JSON.stringify(ST.receta.componentes[0].dims.A));

  montar(600); tirar('+', -60);
  ST.receta.componentes[0].dims.A = JSON.parse(JSON.stringify(dimA)); regen();
  TE._setHuecoACara(0, 'x', 'min', hA); regen();
  const B = medir(); const hB = hueco();

  ok(A.ancho === B.ancho, 'mismo tamaño por los dos caminos (=' + A.ancho + ')');
  ok(hA === hB, 'mismo hueco a la cara (=' + hA + ')');
  ok(A.izq === B.izq && A.der === B.der, 'y la pieza quedó en el mismo lugar (' + A.izq + '/' + A.der + ' vs ' + B.izq + '/' + B.der + ')');
}

// ================================================== D · LA POSICIÓN QUEDA ANCLADA
console.log('');
console.log('D · lo que dejó el tirador sobrevive al cambio de hormigón');
{
  montar(600);
  tirar('+', -60);
  tirar('-', 40);
  const base = medir();
  const izqs = [], anchos = [];
  [800, 400, 600].forEach((L) => {
    ST.receta.geometria.largo = L; regen();
    const m = medir(); izqs.push(m.izq); anchos.push(m.ancho);
  });
  ok(izqs.every((v) => v === base.izq), 'el hueco al testero no se mueve con el muro en 800/400/600 (=' + izqs.join(' / ') + ')');
  ok(anchos.every((v) => v === base.ancho), '…y el tamaño tampoco (=' + anchos.join(' / ') + ')');
}

// ============================================ E · SI REPARTE POR AHÍ, MANDA EL ABANICO
console.log('');
console.log('E · por el eje que reparte, la posición no es del tirador');
{
  const c = montar(600);
  c.modo = 'arreglo';
  c.distribucion = { modo: 'arreglo', activa: true,
    rango:  { eje: 'x', from: -230, to: 230, sep: 120 },
    rango2: { eje: 'y', from: -60, to: 60, sep: 60 } };
  regen();
  ok(TE._ejesDesplazables(c).indexOf('x') < 0, 'los campos de Offset no ofrecen el eje del abanico');
  tirar('+', -60);
  ok(!(c.pos_hint && c.pos_hint.x != null), 'y el tirador tampoco le escribe posición en ese eje');
  ok(c.dims.A && c.dims.A.modo === 'fija', '…pero sí le deja la medida (=' + JSON.stringify(c.dims.A) + ')');
}

// ============================== F · ARRASTRE CON EL MOUSE (la deriva que quedaba)
// EL DEFECTO QUE CONGELA (reportado el 25-ago, con el fix del 24 ya puesto): «al
// desplazar el segundo tirador (derecha), el primero que ya desplacé (izquierda) se
// desplaza un poco… mejoró bastante pero debe quedarse quieto».
//
// POR QUÉ NO LO VEÍAN A–E: usan `tirar()`, que es UN mousemove por gesto sobre una
// pieza PUNTUAL. Un arrastre de verdad son decenas de mousemove con una regeneración
// en el medio, y la pieza del usuario es un estribo de confinamiento REPARTIDO a lo
// alto del muro — y esa combinación es la que enciende el defecto.
//
// LA CAUSA, MEDIDA: la posición de la pieza se guarda como distancia a una cara
// (`pos_ancla`), y esa ancla vale `base + hint`, donde `base` —dónde nace la pieza
// SIN traslación— DEPENDE DEL TAMAÑO. En cuanto el tirador reescribe la medida el
// ancla queda vieja y pasa a pinchar el CENTRO del grupo. El tirador la usaba de dos
// maneras equivocadas: MEDÍA con ella (el sondeo y los bordes de la corrección) pero
// ESCRIBÍA `pos_hint`, que es el régimen que queda después — cuenta hecha en un
// sistema y aplicada en otro—, y sólo la invalidaba cuando la corrección daba ≠ 0.
// MEDIDO con la mezcla: medio centímetro de borde opuesto por cada centímetro de
// medida → 19,5 cm de deriva en un arrastre de 40 hecho paso a paso, y 12,5 cm en
// uno de 25 de un solo salto (ahí el sondeo, viendo todo «centrado», hasta elegía el
// extremo contrario al borde agarrado).
//
// LA REGLA: el tirador mide en el MISMO régimen en el que escribe (clon con el ancla
// invalidada, la misma puerta que _anclarHintUI), y cambiar el tamaño invalida el
// ancla SIEMPRE, dé lo que dé la corrección.
console.log('');
console.log('F · el estribo repartido, arrastrado con el mouse');
{
  // El estribo del usuario: repartido a lo alto del muro. Los tiradores de izquierda
  // y derecha corren por el largo (x), que NO es el eje que reparte — o sea que la
  // posición en ese eje sí es del tirador.
  function montarRepartido() {
    const c = estribo();
    c.modo = 'lineal';
    c.distribucion = { modo: 'linear', activa: true, sep: 20,
      rango: { eje: 'y', from: -80, to: 80, sep: 20 } };
    ST.receta = { tipo: 'muro', geometria: Object.assign({}, MURO), componentes: [c] };
    ST.selCi = 0; ST.ultimoOut = null;
    ST.dragMove = null; ST.dragMarco = null; ST.dragRango = null;
    R.normalizarReceta(ST.receta);
    regen();
    return c;
  }
  // Lo que se ve en la elevación: el hueco a cada testero, medido sobre TODAS las
  // copias del reparto y no sólo sobre la primera.
  function huecos() {
    const c = ST.receta.componentes[0];
    const pls = R.expandirComponente(clon(c), ST.receta.geometria) || [];
    let mn = Infinity, mx = -Infinity;
    pls.forEach((pl) => pl.puntos.forEach((q) => {
      if (q.x < mn) mn = q.x; if (q.x > mx) mx = q.x;
    }));
    const L = ST.receta.geometria.largo;
    return { copias: pls.length, ancho: r2(mx - mn), izq: r2(mn + L / 2), der: r2(L / 2 - mx) };
  }

  // Los tres gestos del usuario, arrastrados como se arrastran de verdad. 40
  // mousemove por gesto: el número no importa, importa que sean MUCHOS y que el
  // editor regenere entre uno y otro.
  const a = (montarRepartido(), huecos());
  ok(a.copias > 1, 'el estribo está repartido de verdad (' + a.copias + ' copias)');
  tirarMouse('+', -60, 40);
  const b = huecos();
  ok(b.izq === a.izq, 'g1 · el borde opuesto no se movió (' + a.izq + ' → ' + b.izq + ')');
  ok(r2(b.der - a.der) === 60, 'g1 · el agarrado siguió al cursor 1:1 (=' + r2(b.der - a.der) + ')');

  tirarMouse('-', 40, 40);
  const c2 = huecos();
  ok(c2.der === b.der, 'g2 · el borde que colocó el 1er tirador se quedó quieto (' +
    b.der + ' → ' + c2.der + ') — acá derivaba 19,5 cm');
  ok(r2(c2.izq - b.izq) === 40, 'g2 · y el segundo movió sólo el suyo (=' + r2(c2.izq - b.izq) + ')');

  tirarMouse('+', -25, 40);
  const d = huecos();
  ok(d.izq === c2.izq, 'g3 · el borde del 2º tirador tampoco se mueve (' +
    c2.izq + ' → ' + d.izq + ')');
  ok(r2(d.der - c2.der) === 25, 'g3 · el 3er gesto movió su borde 25 cm (=' + r2(d.der - c2.der) + ')');

  // EL MISMO 3er GESTO DE UN SOLO SALTO: acá el sondeo veía la pieza «centrada» por
  // el ancla vieja, elegía el extremo contrario al borde agarrado y la pieza se
  // achicaba hacia adentro por los dos lados (12,5 cm de deriva).
  montarRepartido(); tirarMouse('+', -60, 40); tirarMouse('-', 40, 40);
  const e1 = huecos();
  tirar('+', -25);
  const e2 = huecos();
  ok(e2.izq === e1.izq, 'g3 de un salto · el borde opuesto tampoco se mueve (' +
    e1.izq + ' → ' + e2.izq + ') — acá derivaba 12,5 cm');
  ok(r2(e2.der - e1.der) === 25, 'g3 de un salto · su borde se movió 25 (=' + r2(e2.der - e1.der) + ')');

  // EL CAMINO NO CAMBIA EL DESTINO: arrastrar de a poquito con el mouse tiene que
  // dejar la pieza donde la deja un salto. Si la cuenta se acumulara mousemove a
  // mousemove en vez de resolverse contra el estado real, estas dos no coincidirían.
  ok(d.ancho === e2.ancho && d.izq === e2.izq && d.der === e2.der,
    'con el mouse o de un salto se llega al MISMO lugar (' + d.izq + '/' + d.ancho + '/' + d.der +
    ' vs ' + e2.izq + '/' + e2.ancho + '/' + e2.der + ')');
}

// ================================== G · GESTOS ENCADENADOS SOBRE PIEZA PUNTUAL
// El mismo arrastre con el mouse sobre la pieza suelta de los bloques A–D: acá el
// fix del 24-ago ya alcanzaba, y este bloque existe para que siga alcanzando —
// invalidar el ancla en cada mousemove no puede aflojar el caso simple.
console.log('');
console.log('G · pieza suelta, cuatro gestos encadenados con el mouse');
{
  montar(600);
  let prev = medir();
  const gestos = [['+', -60], ['-', 40], ['+', -25], ['-', 12]];
  gestos.forEach(function (g, i) {
    tirarMouse(g[0], g[1], 35);
    const m = medir();
    const opuesto = (g[0] === '+') ? r2(m.izq - prev.izq) : r2(m.der - prev.der);
    const propio = (g[0] === '+') ? r2(m.der - prev.der) : r2(m.izq - prev.izq);
    ok(opuesto === 0, 'g' + (i + 1) + ' (' + g[0] + ' ' + g[1] + ') · el borde opuesto quieto (Δ=' + opuesto + ')');
    ok(propio === Math.abs(g[1]),
      'g' + (i + 1) + ' · el agarrado siguió al cursor ' + Math.abs(g[1]) + ' cm (=' + propio + ')');
    prev = m;
  });
}

console.log(fallos ? ('' + fallos + ' FALLO(S)') : 'OK — el tirador deja quieto el borde opuesto');
process.exit(fallos ? 1 : 0);
