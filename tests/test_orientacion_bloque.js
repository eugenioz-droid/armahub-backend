// =============================================================================
// BLOQUE ORIENTACIÓN (22-ago) — test headless (Node)
// =============================================================================
// La ficha del componente mostraba CINCO filas para una sola cosa —cómo está puesta
// la pieza—: «Cara / anclaje», «Lado», «Rotar», «Pose» y «Patas». Y encima la fila de
// Cara mezclaba dos niveles: 'sup' e 'inf' son caras CONCRETAS (el signo va en el
// nombre) mientras 'lateral' y 'extremo' son PARES que necesitaban la fila «Lado»
// para desambiguar — por eso esa fila existía, por eso quedaba inerte la mitad del
// tiempo, y por eso se comía un renglón de un panel de 360 px. Además se enseñaban
// las COORDENADAS DEL MODELO en vez del RESULTADO, así que al girar 90° se movían dos
// filas a la vez y parecía un error cuando era UNA orientación cambiando.
//
// El DATO no cambió: la pose sigue siendo {cara, lado, rumbo, espejo}. Lo que cambió
// es la PRESENTACIÓN. Esto es lo que congela este test:
//
//   A · LA FRASE DESCRIBE LA POSE — «Apoyada en la cara frontal · corre a lo largo ·
//       espejada» dice exactamente la cara, el rumbo y el espejo que tiene la pieza,
//       para las 24 orientaciones. Si la frase y la pose se separan, el bloque entero
//       miente (es la línea que le explica al usuario por qué al girar se movieron
//       dos controles a la vez).
//   B · UN SOLO VOCABULARIO — los nombres salen de CARAS_OBRA / EJE_ROTULO_POS, las
//       mismas tablas que rotula el desplazamiento medido, y siguen al ELEMENTO
//       (viga: «lateral frontal» · muro: «cara frontal»). Nada de un tercer idioma.
//   C · LAS 24 ORIENTACIONES SIGUEN ALCANZABLES desde los controles del bloque:
//       6 caras × 2 rumbos válidos × espejo = 24 poses distintas, todas escribibles
//       con _setPose y releíbles con _poseDe sin perderse por el camino.
//       (Y GANÓ terreno: la vieja fila «Lado» sólo se mostraba en 'extremo' o si el
//       rol era cabezal, así que las dos caras laterales de un estribo NO se podían
//       elegir desde la ficha.)
//   D · SÓLO LOS RUMBOS POSIBLES — el eje paralelo a la normal de la cara no se
//       ofrece: sería un botón que se deshace solo (el motor lo normaliza).
//   E · LOS SEIS ICONOS SON SEIS — un dibujo distinto por cara, y las tres que quedan
//       al fondo van punteadas. Si dos caras compartieran icono, el control sería
//       indistinguible a ojo.
//   F · LA FICHA ARMA EL BLOQUE Y YA NO ARMA LA FILA «Lado» — un solo control de seis
//       opciones, el rumbo, el botón de espejo y las acciones aparte del estado.
//
// Correr con: node tests/test_orientacion_bloque.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

// --------------------------------------------------------------- entorno mínimo
// Mismo mini-DOM que tests/test_desplazamiento_medido.js, más lo que necesita ARMAR
// la ficha entera: innerHTML (el radial de iconos mete SVG) y un tagName para poder
// recorrer el árbol y contar controles.
function El(tag) {
  this.tagName = String(tag || 'div').toUpperCase();
  this.style = {}; this.dataset = {}; this.children = []; this.className = '';
  this.value = ''; this.textContent = ''; this.innerHTML = ''; this.title = '';
  this.attrs = {};
  this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
El.prototype.getAttribute = function (k) { return (k in this.attrs) ? this.attrs[k] : null; };
El.prototype.addEventListener = function () {}; El.prototype.removeEventListener = function () {};
El.prototype.querySelector = function () { return null; };
El.prototype.querySelectorAll = function () { return []; };
El.prototype.closest = function () { return null; };

const win = {};
win.window = win; win.self = win;
win.document = {
  body: new El(), documentElement: new El(), head: new El(),
  createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t), createTextNode: () => new El('#text'),
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

const TE = win.TemplateEditor;
const ST = TE._ST;

const VIGA = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const MURO = { largo: 400, alto: 250, ancho: 20, recub_sup: 3, recub_inf: 3, recub_lat: 2.5 };

// Barra suelta con patas (104C = con ganchos) para que la ficha arme TODO el bloque,
// incluida la fila de acciones con las Patas.
function barra(extra) {
  const c = {
    comp_id: 'C1', jerarquia: 1, tipologia: 'CBS', figura: '101', diam: 16, cara: 'sup',
    angulos: [], modo: 'puntual', plano_pieza: { orientacion: 'acostada', volteado: false },
    dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0, sentido: 'nucleo' }
  };
  for (const k in (extra || {})) c[k] = extra[k];
  return c;
}
function montar(comp, tipo, geo) {
  ST.receta = { tipo: tipo || 'viga', geometria: Object.assign({}, geo || VIGA), componentes: [comp] };
  ST.selCi = 0;
  ST.ultimoOut = null;
  return ST.receta.componentes[0];
}
// Recorre el árbol que arma la ficha y junta los nodos que cumplen `filtro`.
function buscar(el, filtro, out) {
  out = out || [];
  if (filtro(el)) out.push(el);
  (el.children || []).forEach((h) => buscar(h, filtro, out));
  return out;
}
function conClase(el, cls) {
  return buscar(el, (n) => String(n.className || '').split(/\s+/).indexOf(cls) >= 0);
}
function textos(el) { return buscar(el, () => true).map((n) => String(n.textContent || '')); }

// ============================================================ A · la frase dice la pose
console.log('\nA · la FRASE describe la pose que la pieza tiene de verdad');
{
  montar(barra(), 'viga');
  const ESPERA = {
    'sup': 'cara superior', 'inf': 'cara inferior',
    'lat+': 'lateral frontal', 'lat-': 'lateral posterior',
    'ext+': 'testero fin', 'ext-': 'testero inicio'
  };
  TE._CARAS6.forEach((f) => {
    ok(TE._nombreCara6(f.id) === ESPERA[f.id],
      f.id + ' → «' + TE._nombreCara6(f.id) + '» (el nombre de obra de esa cara en una viga)');
    const p = { cara: f.cara, lado: f.lado, rumbo: TE._rumbosDeCara(f.cara)[0], espejo: false };
    ok(TE._fraseOrientacion(p).indexOf(ESPERA[f.id]) > 0,
      '…y la frase la nombra: «' + TE._fraseOrientacion(p) + '»');
  });

  // El RUMBO también va en la frase, con el nombre de obra del eje (no su letra).
  const RUM = { x: 'a lo largo', y: 'en altura', z: 'a lo ancho' };
  Object.keys(RUM).forEach((r) => {
    ok(TE._nombreRumbo(r) === RUM[r], 'rumbo ' + r + ' se dice «' + RUM[r] + '»');
  });
  const pl = { cara: 'lateral', lado: 1, rumbo: 'x', espejo: false };
  ok(TE._fraseOrientacion(pl) === 'Apoyada en el lateral frontal · corre a lo largo',
    'frase completa: «' + TE._fraseOrientacion(pl) + '»');

  // El ESPEJO sólo se dice cuando lo hay: si apareciera siempre, dejaría de informar.
  ok(TE._fraseOrientacion(pl).indexOf('espejada') < 0, 'sin espejo la frase NO dice «espejada»');
  const pe = { cara: 'lateral', lado: 1, rumbo: 'x', espejo: true };
  ok(/· espejada$/.test(TE._fraseOrientacion(pe)),
    'con espejo la frase lo dice al final: «' + TE._fraseOrientacion(pe) + '»');

  // sup/inf NO miran el `lado`: el motor devuelve −1 para 'inf' (su signo ES la cara)
  // y _setPose lo normaliza a 1. Si _caraId mirara el lado, «inferior» se leería mal.
  ok(TE._caraId({ cara: 'inf', lado: -1, rumbo: 'x' }) === 'inf' &&
     TE._caraId({ cara: 'inf', lado: 1, rumbo: 'x' }) === 'inf',
    'la cara «inferior» se identifica igual con lado 1 que con lado −1');
}

// ==================================================== B · un solo vocabulario, por elemento
console.log('\nB · el vocabulario es el del desplazamiento medido y sigue al elemento');
{
  montar(barra(), 'viga');
  TE._CARAS6.forEach((f) => {
    const caras = TE._carasObraEje(f.eje);
    ok(TE._nombreCara6(f.id) === (f.ref === 'max' ? caras.max : caras.min),
      'viga · ' + f.id + ': el bloque y el selector de desplazamiento dicen lo mismo');
  });
  montar(barra(), 'muro', MURO);
  const ESPERA_MURO = {
    'sup': 'borde superior', 'inf': 'borde inferior',
    'lat+': 'cara frontal', 'lat-': 'cara posterior',
    'ext+': 'extremo fin', 'ext-': 'extremo inicio'
  };
  TE._CARAS6.forEach((f) => {
    ok(TE._nombreCara6(f.id) === ESPERA_MURO[f.id],
      'muro · ' + f.id + ' → «' + TE._nombreCara6(f.id) + '» (cambia con el elemento, no es una tabla aparte)');
  });
  ok(TE._fraseOrientacion({ cara: 'lateral', lado: 1, rumbo: 'x', espejo: false }) ===
     'Apoyada en la cara frontal · corre a lo largo',
    'muro · frase completa: «' + TE._fraseOrientacion({ cara: 'lateral', lado: 1, rumbo: 'x', espejo: false }) + '»');
}

// ================================================== C · las 24 orientaciones alcanzables
console.log('\nC · las 24 orientaciones siguen alcanzables desde los controles del bloque');
{
  const c = montar(barra(), 'viga');
  const vistas = {};
  let escritas = 0;
  TE._CARAS6.forEach((f) => {
    const rumbos = TE._rumbosDeCara(f.cara);
    ok(rumbos.length === 2, f.id + ': el control «Corre» ofrece 2 rumbos (=' + rumbos.join(',') + ')');
    rumbos.forEach((r) => {
      [false, true].forEach((esp) => {
        escritas++;
        TE._setPose(c, { cara: f.cara, lado: f.lado, rumbo: r, espejo: esp });
        const leida = TE._poseDe(c);
        ok(TE._caraId(leida) === f.id && leida.rumbo === r && !!leida.espejo === esp,
          f.id + ' · ' + r + (esp ? ' · espejo' : '') + ' → se escribe y se relee igual (' +
          TE._fraseOrientacion(leida) + ')');
        vistas[TE._caraId(leida) + '|' + leida.rumbo + '|' + (leida.espejo ? 1 : 0)] = true;
      });
    });
  });
  ok(escritas === 24, 'los controles cubren 6 caras × 2 rumbos × 2 espejo = ' + escritas + ' combinaciones');
  ok(Object.keys(vistas).length === 24,
    '…y las 24 son DISTINTAS entre sí (=' + Object.keys(vistas).length + '): ninguna orientación se perdió');
}

// ================================================== D · sólo los rumbos posibles
console.log('\nD · el rumbo imposible no se ofrece (sería un botón que se deshace solo)');
{
  const NORMAL = { sup: 'y', inf: 'y', lateral: 'z', extremo: 'x' };
  Object.keys(NORMAL).forEach((cara) => {
    const rumbos = TE._rumbosDeCara(cara);
    ok(rumbos.indexOf(NORMAL[cara]) < 0,
      'cara ' + cara + ': el eje paralelo a su normal (' + NORMAL[cara] + ') queda fuera de «Corre»');
    rumbos.forEach((r) => ok(TE._rumboValido(cara, r), '…y el que sí sale (' + r + ') es válido para el motor'));
  });
}

// ================================================== E · los seis iconos son seis
console.log('\nE · cada cara tiene su propio dibujo');
{
  const svgs = TE._CARAS6.map((f) => TE._iconoCara6(f.id));
  ok(new Set(svgs).size === 6, 'seis caras → seis iconos distintos (=' + new Set(svgs).size + ')');
  svgs.forEach((s, i) => ok(/^<svg /.test(s) && /<\/svg>$/.test(s), TE._CARAS6[i].id + ': es un SVG completo'));
  // Las tres caras del FONDO van punteadas: es lo que le dice al ojo que están detrás.
  // (El polígono de relleno es el PRIMER elemento del SVG.)
  const relleno = (s) => s.slice(0, s.indexOf('<g '));
  ['inf', 'lat-', 'ext-'].forEach((id) => {
    ok(/stroke-dasharray/.test(relleno(TE._iconoCara6(id))), id + ' (cara del fondo) se dibuja punteada');
  });
  ['sup', 'lat+', 'ext+'].forEach((id) => {
    ok(!/stroke-dasharray/.test(relleno(TE._iconoCara6(id))), id + ' (cara de frente) se dibuja maciza');
  });
  // Y el color lo pone el BOTÓN (currentColor): así el icono sigue al estado y a los
  // tres temas sin una regla de color por tema.
  ok(TE._iconoCara6('sup').indexOf('currentColor') > 0 && !/#[0-9a-f]{3,6}/i.test(TE._iconoCara6('sup')),
    'el icono no trae ni un color propio: todo va con currentColor');
}

// ================================================== F · la ficha arma el bloque
console.log('\nF · la ficha arma ORIENTACIÓN y ya no arma la fila «Lado»');
{
  const c = montar(barra({ cara: 'lateral', lado: -1 }), 'viga');
  const ficha = TE._compBody(c, 0, 'cabezal');

  const frases = conClase(ficha, 'te-ofrase');
  ok(frases.length === 1, 'hay UNA frase de estado en la ficha (=' + frases.length + ')');
  ok(frases[0] && frases[0].textContent === TE._fraseOrientacion(TE._poseDe(c)),
    '…y dice la pose de esta barra: «' + (frases[0] && frases[0].textContent) + '»');

  const caras = conClase(ficha, 'te-caras');
  ok(caras.length === 1 && caras[0].children.length === 6,
    'el control de CARA es uno solo y tiene SEIS opciones (=' +
    (caras[0] ? caras[0].children.length : 0) + ')');
  ok(caras[0].children.filter((b) => b.className === 'on').length === 1,
    '…con exactamente una encendida (la cara actual)');
  ok(caras[0].children.every((b) => !b.textContent && /<svg /.test(String(b.innerHTML))),
    '…y todas son iconos sin texto: el nombre lo dicen la frase y el title');
  ok(caras[0].children.every((b) => !!b.title),
    '…pero cada una lleva su nombre en el title');

  // La fila «Lado» (+Z/−Z · Fin/Inicio) DESAPARECIÓ: era la mitad del control de cara
  // puesta en otro renglón. Si vuelve a aparecer, este test cae.
  const t = textos(ficha);
  ['Lado', '+Z', '−Z', 'Fin +', 'Inicio −'].forEach((s) => {
    ok(t.indexOf(s) < 0, 'la ficha ya no dice «' + s + '»');
  });
  ok(t.indexOf('Cara / anclaje') < 0, 'ni «Cara / anclaje»: ahora el rótulo es «Cara»');
  ok(t.indexOf('Cara') >= 0 && t.indexOf('Corre') >= 0, 'los rótulos del bloque son «Cara» y «Corre»');

  // ESPEJO = un botón compacto, no una fila con Normal/Espejo.
  const esp = conClase(ficha, 'te-espbtn');
  ok(esp.length === 1 && esp[0].textContent === 'E', 'el espejo es UN botón marcado «E»');
  ok(t.indexOf('Normal') < 0, '…y ya no hay fila «Normal / Espejo»');

  // ACCIONES aparte del estado, con los dos giros (y las patas cuando la figura las tiene).
  const acc = conClase(ficha, 'te-oacc');
  ok(acc.length === 1, 'las acciones van en su propia fila, separadas del estado');
  const tAcc = textos(acc[0]);
  ok(tAcc.indexOf('Girar 90°') >= 0 && tAcc.indexOf('Girar de plano') >= 0,
    'los dos giros están ahí: ' + tAcc.filter((x) => x).join(' · '));
  // Una barra RECTA (101) no tiene patas que apuntar: el control no se ofrece.
  ok(conClase(ficha, 'te-opatas').length === 0, 'una barra recta no trae control de Patas');

  // …y una con ganchos en los dos extremos (103C) sí, dentro de la MISMA fila de
  // acciones y en un solo envoltorio (rótulo + flechas viajan juntos al envolver).
  const g = montar(barra({ figura: '103C', dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' } } }), 'viga');
  const fichaG = TE._compBody(g, 0, 'cabezal');
  const pat = conClase(fichaG, 'te-opatas');
  ok(pat.length === 1, 'con ganchos aparece el control de Patas (=' + pat.length + ')');
  ok(conClase(conClase(fichaG, 'te-oacc')[0] || new El(), 'te-opatas').length === 1,
    '…y vive DENTRO de la fila de acciones, no en una fila propia como antes');
  ok(textos(pat[0]).indexOf('↓') >= 0, '…con las cuatro direcciones: ' + textos(pat[0]).filter((x) => x).join(''));
}

console.log(fallos ? ('\n' + fallos + ' FALLO(S)') : '\nOK — el bloque ORIENTACIÓN está congelado');
process.exit(fallos ? 1 : 0);
