// =============================================================================
// EL CORTE DEL GESTOR DE TEMPLATES — test headless (Node)
// =============================================================================
// Hereda de tests/test_seccion_mini.js, que murió con lo que probaba. Aquel dibujaba
// un ESQUEMA a partir de un resumen de ~120 bytes que el backend derivaba de la receta,
// porque el motor que sitúa las barras es JS y no corre en el servidor. El usuario lo
// comparó con el editor y pidió lo obvio: «que se vea como se ve en el editor, más
// ampliada y precisa». Así que ahora el listado manda la RECETA, el navegador corre el
// MOTOR REAL (ModeladorGenerar) y dibuja con el MISMO dibujante de los cuadrantes
// (ModeladorRender2D). Este archivo cuida que eso siga siendo verdad.
//
// LO QUE SE FIJA ACÁ:
//   R0 · El PLANO lo pone PLANOS_POR_ELEMENTO —la tabla que rotula los cuadrantes—,
//        no una lista de tipos escrita a mano. Sin plano no se dibuja.
//   R1 · EL COTEJO CONTRA EL MOTOR (heredero de S10, y la razón de ser del test).
//        Se corre ModeladorGenerar sobre el muro real del usuario y se comprueba, en
//        PÍXELES DEL SVG deshaciendo la transformación, que lo dibujado cae donde el
//        motor puso el fierro. Si el dibujo vuelve a decir algo que el motor no dice,
//        falla acá y no en la pantalla.
//   R2 · UN SOLO DIBUJANTE: los trazos del SVG son EXACTAMENTE los que devuelve
//        ModeladorRender2D.trazos, que es lo que emite el editor. No hay dos.
//   R3 · LA REBANADA. Una vista proyecta TODA la profundidad; en el corte horizontal
//        de un muro eso apila los 250 cm de alto. Se corta una banda de 30 cm, y su
//        POSICIÓN se elige por lo que muestra: centrarla al medio del muro deja fuera
//        la traba, que es justo lo que distingue un template de otro.
//   R4 · EL ENCUADRE sale de la PROPORCIÓN del plano, no del tipo de elemento: cabe
//        legible → un cuadro; demasiado alargado → DOS, uno por extremo, a la MISMA
//        escala. Nunca se afirma que un extremo represente al otro.
//   R5 · El COLOR entra por PARÁMETRO (como disenadorMotor.TINTA) y es la paleta única
//        del editor. El dibujante no tiene ni un hex de fierro.
//   R6 · DIBUJAR NO ESCRIBE: los placements que entran salen intactos.
//   R7 · Lo que no se puede dibujar recibe un HUECO QUE LO DICE, nunca una silueta.
//   R8 · SE DICE QUÉ SE ESTÁ MIRANDO (plano, rebanada, extremo) y NO se dice que sea
//        aproximado: ya no lo es, y decirlo sería la misma mentira al revés.
//   R9 · El GESTOR entero, de la fila al SVG (TemplateEditor._tplMiniDibujo), y que la
//        celda no dibuja al pintar la tabla sino al entrar en pantalla.
//
// Correr con:  node tests/test_seccion_render.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
const TE_SRC = fs.readFileSync(path.join(BASE, 'template_editor.js'), 'utf8');
const R2D_SRC = fs.readFileSync(path.join(BASE, 'render2d.js'), 'utf8');

let fallos = 0;
function ok(cond, nombre) {
  if (cond) console.log('  ✓ ' + nombre);
  else { console.log('  ✗ ' + nombre); fallos++; }
}

// --------------------------------------------------------------- entorno mínimo
// Mismo mini-DOM que tests/test_perf_dibujo.js. El dibujante NO lo necesita (por eso
// R6 lo carga aparte, en un sandbox pelado); lo necesita el Template Editor, del que
// se ejercita el camino del gestor (R9).
function El() {
  this.style = {}; this.dataset = {}; this.children = []; this.className = ''; this.value = '';
  this.attrs = {}; this.innerHTML = '';
  this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
El.prototype.getAttribute = function (k) { return this.attrs[k] != null ? this.attrs[k] : null; };
El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
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
const G = mod('generar.js', 'ModeladorGenerar');
mod('semilla_viga.js', 'ModeladorSemilla');
const R = mod('render2d.js', 'ModeladorRender2D');
vm.runInContext(TE_SRC, ctx, { filename: 'template_editor.js' });
const TE = win.TemplateEditor;

// ------------------------------------------------------- EL MURO DEL USUARIO
// 524 × 250 × 20: dos mallas (horizontal @20 y vertical @20, cada una en sus DOS
// cortinas) cosidas con una traba. Es la misma receta que cotejaba S10 —el `arreglo`
// del editor de hoy, con sus DOS líneas de distribución (rango + rango2)—, así que los
// números de este test se pueden comparar con los de aquél.
const MURO = {
  tipo: 'muro',
  geometria: { largo: 524, alto: 250, ancho: 20, recub_sup: 3, recub_inf: 3, recub_lat: 2.5 },
  componentes: [
    { comp_id: 'MH', tipologia: 'MH', figura: '101A', diam: 10, cara: 'lateral',
      jerarquia: 1, modo: 'arreglo', dims: { A: { modo: 'auto' } },
      distribucion: { modo: 'arreglo', sep: 20, activa: true,
        rango: { eje: 'y', from: -122, to: 122, sep: 20 },
        rango2: { eje: 'z', from: -7, to: 7, sep: 14 } } },
    { comp_id: 'MV', tipologia: 'MV', figura: '101A', diam: 10, cara: 'lateral',
      jerarquia: 1, modo: 'arreglo', plano_pieza: { orientacion: 'de_pie' },
      dims: { A: { modo: 'auto' } },
      distribucion: { modo: 'arreglo', sep: 20, activa: true,
        rango: { eje: 'x', from: -259, to: 259, sep: 120 },
        rango2: { eje: 'z', from: -7, to: 7, sep: 14 } } },
    { comp_id: 'TR', tipologia: 'TR', figura: '101A', diam: 8, cara: 'lateral',
      jerarquia: 2, modo: 'arreglo', plano_pieza: { volteado: true },
      dims: { A: { modo: 'auto' } },
      distribucion: { modo: 'arreglo', sep: 40, activa: true,
        rango: { eje: 'x', from: -259, to: 259, sep: 180 },
        rango2: { eje: 'y', from: -122, to: 122, sep: 60 } } }
  ]
};
// Una VIGA: el otro extremo de la regla del encuadre (30 × 60 cabe entero).
const VIGA = {
  tipo: 'viga',
  geometria: { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 },
  componentes: [
    { comp_id: 'CBS', tipologia: 'CBS', figura: '101A', diam: 16, cara: 'sup', jerarquia: 2,
      dims: { A: { modo: 'auto' } }, distribucion: { modo: 'layered', n_capas: 1, barras_capa: 3 } },
    { comp_id: 'CBI', tipologia: 'CBI', figura: '101A', diam: 18, cara: 'inf', jerarquia: 2,
      dims: { A: { modo: 'auto' } }, distribucion: { modo: 'layered', n_capas: 1, barras_capa: 4 } },
    { comp_id: 'ES', tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral', jerarquia: 1,
      dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
      distribucion: { modo: 'linear', rango: { eje: 'x', from: -294, to: 294, sep: 12 } } }
  ]
};

function generar(receta) {
  return G.generarElemento(JSON.parse(JSON.stringify(receta)), {}).placements;
}
function defDe(tipo) { return TE._planosDe(tipo).seccion; }
function optsDe(receta) {
  const porId = {};
  receta.componentes.forEach(c => { porId[c.comp_id] = c; });
  return {
    rect: TE._rectDeDef(receta.geometria, defDe(receta.tipo)),
    colorDe: (pl) => TE.colorDeTipologia((porId[pl.comp_id] || pl).tipologia),
    rolDe: (pl) => TE._rolComp(pl),
    letras: TE.EJE_DISPLAY
  };
}
const W = TE.TPL_MINI_W, H = TE.TPL_MINI_H;
const PLS_MURO = generar(MURO), PLS_VIGA = generar(VIGA);
const DEF_MURO = defDe('muro'), DEF_VIGA = defDe('viga');
const OPT_MURO = optsDe(MURO), OPT_VIGA = optsDe(VIGA);
const PLAN_MURO = R.plan(PLS_MURO, DEF_MURO, W, H, OPT_MURO);
const SVG_MURO = R.svg(PLS_MURO, DEF_MURO, W, H, OPT_MURO);

// Los <svg> ANIDADOS (un cuadro cada uno) con su contenido, en orden.
function cuadrosDe(svg) {
  const out = [];
  const re = /<svg x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"[^>]*>([\s\S]*?)<\/svg>/g;
  let m;
  while ((m = re.exec(svg))) out.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], html: m[5] });
  return out;
}
// Deshace la transformación de un cuadro: píxel del <svg> anidado → (u,v) en cm.
function inversorDe(cuadro, plan) {
  const t = R.encuadreVentana(cuadro.vent, { x: 0, y: 0, w: cuadro.caja.w, h: cuadro.caja.h }, plan.escala);
  return (px, py) => ({ u: (px - t.cu) / t.ku, v: (py - t.cv) / t.kv });
}
// Todos los puntos de los <path> de un color, ya en cm. Una barra vista DE PUNTA se
// dibuja como círculo, cuyo `d` arranca en su punto IZQUIERDO ('M cx−r,cy a…'): de ahí
// se recupera el centro, que es la posición de la barra. Una de perfil es la polilínea
// tal cual.
function puntosDe(html, color, inv) {
  const out = [];
  const re = new RegExp('<path d="([^"]+)"[^>]*(?:stroke|fill)="' + color + '"', 'g');
  let m;
  while ((m = re.exec(html))) {
    const cir = m[1].match(/M([-\d.]+),([-\d.]+)a([-\d.]+),/g) || [];
    if (cir.length) {
      cir.forEach(s => {
        const p = /M([-\d.]+),([-\d.]+)a([-\d.]+),/.exec(s);
        out.push(inv(+p[1] + +p[3], +p[2]));
      });
      continue;
    }
    (m[1].match(/[ML]([-\d.]+),([-\d.]+)/g) || []).forEach(s => {
      const p = /([-\d.]+),([-\d.]+)/.exec(s);
      out.push(inv(+p[1], +p[2]));
    });
  }
  return out;
}
const redondo = (n, d) => Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0);
const unicos = (a) => [...new Set(a)].sort((x, y) => x - y);
// Dos listas de posiciones (cm) que tienen que ser la misma. La tolerancia es de 2 mm:
// el SVG guarda los píxeles con un decimal y deshacer la transformación arrastra ese
// redondeo — a 1,4 px/cm son 0,04 cm, y el corte de un muro no dice nada por debajo de
// eso. Sin tolerancia el test fallaría por un ±0,1 de redondeo y no por el fierro.
function casan(a, b, tol) {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= (tol || 0.2));
}

// ── R0. El plano lo decide la tabla del editor ──────────────────────────────
console.log('\nR0 — el plano sale de PLANOS_POR_ELEMENTO, no de una lista escrita a mano');
{
  ok(DEF_MURO.u === 'x' && DEF_MURO.v === 'z' && DEF_MURO.depth === 'y',
    'la SECCIÓN de un muro es su corte HORIZONTAL (largo × espesor), no el canto');
  ok(DEF_VIGA.u === 'z' && DEF_VIGA.v === 'y' && DEF_VIGA.depth === 'x',
    'la de una viga sigue siendo su corte transversal');
  ok(TE._ejeRotulo(DEF_MURO.u, DEF_MURO.v) === 'YX',
    'y el editor lo rotula «SECCIÓN · YX» — la miniatura lo llama igual');
  const mini = TE_SRC.slice(TE_SRC.indexOf('function _tplMiniDibujo'),
    TE_SRC.indexOf('function _tplMini(t)'));
  ok(/_planosDe\(t\.tipo\)\.seccion/.test(mini), 'la celda pide el plano a _planosDe(tipo).seccion');
  ok(!/['"](muro|viga|columna|losa|fundacion)['"]/.test(mini),
    'y no nombra ni un tipo de elemento: cero listas escritas a mano');
  ok(R.svg(PLS_MURO, null, W, H, OPT_MURO).indexOf('sin plano') >= 0,
    'sin plano el dibujante NO inventa uno: devuelve el hueco');
  // Y el dibujante no sabe de elementos ni de tipologías.
  ok(!/\b(muro|viga|columna|fundacion|losa|estribo|cabezal)\b/i.test(
    R2D_SRC.replace(/\/\/[^\n]*/g, '').replace(/'cabezal'/g, '')),
    'el dibujante no nombra un solo elemento en su CÓDIGO (sólo el rol «cabezal», que es geometría)');
}

// ── R1. EL COTEJO CONTRA EL MOTOR ───────────────────────────────────────────
// Lo que S10 hacía contra el resumen del backend, ahora contra los PÍXELES: se corre
// el motor, se deshace la transformación del SVG y se comparan las posiciones.
console.log('\nR1 — lo dibujado cae donde el motor puso el fierro');
{
  const cuadros = cuadrosDe(SVG_MURO);
  ok(cuadros.length === PLAN_MURO.cuadros.length, 'un <svg> anidado por cuadro (' + cuadros.length + ')');
  const inv = inversorDe(PLAN_MURO.cuadros[0], PLAN_MURO);
  const vent = PLAN_MURO.cuadros[0].vent;

  // Lo que el MOTOR pone, filtrado por la rebanada y por la ventana del cuadro.
  const banda = PLAN_MURO.banda;
  const enBanda = (pl) => { const t = R.tramo(pl, DEF_MURO.depth); return t.hi >= banda.lo && t.lo <= banda.hi; };
  const motor = (cid) => PLS_MURO.filter(pl => pl.comp_id === cid && enBanda(pl));

  // MH (malla horizontal): corre por el largo → en este corte son DOS líneas, una por
  // cortina, en z = ±(10 − 2.5 − φ/2) = ±7. Son las MISMAS cifras del motor.
  const zMH = unicos(motor('MH').map(pl => redondo(R.tramo(pl, 'z').c, 2)));
  const dibMH = unicos(puntosDe(cuadros[0].html, TE.colorDeTipologia('MH'), inv).map(p => redondo(p.v, 2)));
  ok(JSON.stringify(zMH) === JSON.stringify([-7, 7]),
    'el motor pone la malla horizontal en z = ±7 (' + zMH.join('/') + ')');
  ok(casan(dibMH, zMH),
    'y el SVG la dibuja ahí (' + dibMH.join('/') + ') — pegada a las caras, no por el medio');

  // MV (malla vertical): corre por la PROFUNDIDAD de este plano → se ve DE PUNTA. Sus
  // x son las del motor, una a una, dentro de la ventana del cuadro.
  const enVentana = R.enVentana(motor('MV'), DEF_MURO, vent);
  const xMV = unicos(enVentana.map(pl => redondo(R.tramo(pl, 'x').c, 2)));
  const dibMV = unicos(puntosDe(cuadros[0].html, TE.colorDeTipologia('MV'), inv).map(p => redondo(p.u, 2)));
  ok(xMV.length > 1 && casan(dibMV, xMV),
    'la malla vertical se ve de punta en las MISMAS x del motor (' + dibMV.join(', ') + ')');
  const zMV = unicos(puntosDe(cuadros[0].html, TE.colorDeTipologia('MV'), inv).map(p => redondo(p.v, 2)));
  ok(casan(zMV, [-7, 7]),
    'y en sus dos cortinas (z = ' + zMV.join('/') + '), que es lo que un corte de muro tiene que decir');

  // TR (traba): cruza el espesor de lado a lado y ASOMA por fuera de las dos cortinas.
  const trM = motor('TR').map(pl => R.tramo(pl, 'z'));
  const dibTR = puntosDe(cuadros[0].html, TE.colorDeTipologia('TR'), inv).map(p => redondo(p.v, 1));
  ok(trM.length > 0 && Math.abs(Math.min(...dibTR) - redondo(trM[0].lo, 1)) <= 0.1 &&
     Math.abs(Math.max(...dibTR) - redondo(trM[0].hi, 1)) <= 0.1,
    'la traba cruza el espesor de ' + redondo(trM[0].lo, 1) + ' a ' + redondo(trM[0].hi, 1) +
    ' — el mismo tramo del motor, por fuera de las dos cortinas');

  // Nada se sale de la ventana: el cuadro RECORTA, no deja escapar el trazo.
  const todos = [TE.colorDeTipologia('MH'), TE.colorDeTipologia('MV'), TE.colorDeTipologia('TR')]
    .reduce((a, c) => a.concat(puntosDe(cuadros[0].html, c, inv)), []);
  ok(todos.length > 0 && todos.every(p => p.v >= vent.v0 - 1 && p.v <= vent.v1 + 1),
    'y ningún trazo se sale del espesor dibujado');
}

// ── R2. UN SOLO DIBUJANTE ───────────────────────────────────────────────────
console.log('\nR2 — la miniatura y el cuadrante dibujan con el MISMO dibujante');
{
  const cu = PLAN_MURO.cuadros[0];
  const t = R.encuadreVentana(cu.vent, { x: 0, y: 0, w: cu.caja.w, h: cu.caja.h }, PLAN_MURO.escala);
  const tz = R.trazos(R.enVentana(PLAN_MURO.plsBanda, DEF_MURO, cu.vent), DEF_MURO, t,
    { colorDe: OPT_MURO.colorDe, rolDe: OPT_MURO.rolDe, halo: false, hit: false });
  const html = cuadrosDe(SVG_MURO)[0].html;
  ok(tz.length > 0 && tz.every(z => html.indexOf('d="' + z.d + '"') >= 0),
    'los ' + tz.length + ' trazos del SVG son EXACTAMENTE los de ModeladorRender2D.trazos');
  // Y el editor emite ESOS mismos: su bucle de dibujo se fue al mismo sitio.
  ok(/_R2D\(\)\.trazos\(placements, def, t, \{/.test(TE_SRC),
    '_dibujarVista2D pide sus trazos al dibujante, no los construye');
  ok(!/dTrazo \+= _dCirculo/.test(TE_SRC) && !/var dTrazo = ''/.test(TE_SRC),
    'y no quedó una segunda copia del bucle en el editor');
  ok(/_R2D\(\)\.encuadre\(_R2D\(\)\.bbox\(/.test(TE_SRC),
    'el encuadre del fallback SVG también es el del dibujante');
}

// ── R3. LA REBANADA ─────────────────────────────────────────────────────────
console.log('\nR3 — se corta una rebanada en profundidad, y se elige DÓNDE');
{
  const b = PLAN_MURO.banda;
  ok(b && b.esp === R.REBANADA_CM && b.esp <= 30,
    'la rebanada mide ' + b.esp + ' cm (el techo que puso el usuario: «no más de 25 o 30»)');
  ok(PLAN_MURO.plsBanda.length < PLS_MURO.length,
    'y deja fuera lo que no cruza la banda: ' + PLAN_MURO.plsBanda.length + ' de ' +
    PLS_MURO.length + ' barras (sin ella se apilarían los 250 cm de alto)');
  // POR QUÉ NO SE CENTRA. Medido: con la banda al medio del muro no entra la traba,
  // que es justo lo que distingue «dos cortinas cosidas» de «dos cortinas sueltas».
  const piezasEn = (lo, hi) => new Set(PLS_MURO
    .filter(pl => { const t = R.tramo(pl, DEF_MURO.depth); return t.hi >= lo && t.lo <= hi; })
    .map(pl => pl.comp_id));
  const elegida = piezasEn(b.lo, b.hi);
  const alMedio = piezasEn(-b.esp / 2, b.esp / 2);
  ok(elegida.size === 3 && elegida.has('TR'),
    'la banda elegida muestra las 3 piezas, traba incluida (' + [...elegida].join(',') + ')');
  ok(alMedio.size < elegida.size && !alMedio.has('TR'),
    'y centrarla al medio del muro habría perdido la traba (' + [...alMedio].join(',') + ')');
  // Un elemento MÁS DELGADO que la rebanada se ve entero: no hay nada que recortar.
  const fino = R.rebanada(PLS_MURO, { u: 'x', v: 'y', depth: 'z' }, {});
  ok(fino === null, 'un espesor de 20 cm es más delgado que la rebanada: se ve entero, sin banda');
  // La viga también se rebana (si no, se apilan sus ~50 estribos).
  const pv = R.plan(PLS_VIGA, DEF_VIGA, W, H, OPT_VIGA);
  ok(pv.banda && pv.plsBanda.length < PLS_VIGA.length,
    'la viga también: ' + pv.plsBanda.length + ' de ' + PLS_VIGA.length +
    ' barras (sus estribos ya no se superponen)');
}

// ── R4. LA ESCALA COMÚN Y EL ENCUADRE ───────────────────────────────────────
// Antes cada fila encuadraba su propio contenido en su caja, o sea que cada una salía
// a su px/cm. El usuario lo vio enseguida: «tengo ese muro que es angosto y lo muestra
// entero y muy pequeño… algunos se ven más grandes y otros más pequeños». Comparar dos
// miniaturas ENGAÑABA. Ahora la lista decide UN px/cm y todas dibujan con él.
console.log('\nR4 — una sola escala para toda la lista, y el encuadre sale de ella');
{
  // UNA lista con tres secciones distintas: 15, 20 y 40 cm de espesor.
  const espesores = [15, 20, 40];
  const filas = espesores.map(e => {
    const r = JSON.parse(JSON.stringify(MURO));
    r.geometria.ancho = e;
    r.componentes.forEach(c => {
      ['rango', 'rango2'].forEach(k => {
        const g = c.distribucion[k];
        if (g && g.eje === 'z') { g.from = -(e / 2 - 3); g.to = (e / 2 - 3); g.sep = e - 6; }
      });
    });
    return { id: e, tipo: 'muro', nombre: 'Muro e' + e, updated_at: 'u', params: r };
  });
  TE._tplPonerLista(filas);
  const s = TE._tplMiniEscala();
  ok(s > 0, 'la lista resuelve UNA escala común: ' + redondo(s, 3) + ' px/cm');
  // Y con ella, el espesor dibujado es PROPORCIONAL al espesor real. Eso es lo que
  // convierte «se ve más grueso» en un hecho del elemento y no en un artefacto.
  const px = espesores.map(e => {
    const t = filas[espesores.indexOf(e)];
    const p = R.plan(generar(t.params), DEF_MURO, W, H,
      Object.assign(optsDe(t.params), { escala: s, ventana: TE._tplMiniFila(t).ventana }));
    return redondo(Math.min(p.bbox.v1 - p.bbox.v0, p.bbox.u1 - p.bbox.u0) * p.escala, 1);
  });
  ok(px[0] < px[1] && px[1] < px[2],
    'el de 15 cm se dibuja más fino que el de 20 y éste que el de 40 (' + px.join(' / ') + ' px)');
  ok(Math.abs(px[2] / px[0] - 40 / 15) < 0.02,
    'y en la MISMA proporción que sus espesores reales (' + redondo(px[2] / px[0], 2) + ' vs ' +
    redondo(40 / 15, 2) + ')');
  ok(TE._tplMiniEscala() === s, 'la escala se calcula una vez y se reusa');
  // El caso de la foto del usuario: un muro CORTO que antes salía diminuto por tener su
  // propia escala. Ahora sale entero pero al mismo px/cm que los largos.
  const corto = JSON.parse(JSON.stringify(MURO));
  corto.geometria.largo = 150;
  corto.componentes.forEach(c => ['rango', 'rango2'].forEach(k => {
    const g = c.distribucion[k];
    if (g && g.eje === 'x') { g.from = -72; g.to = 72; }
  }));
  const pCorto = R.plan(generar(corto), DEF_MURO, W, H,
    Object.assign(optsDe(corto), { escala: s }));
  const pLargo = R.plan(PLS_MURO, DEF_MURO, W, H, Object.assign(optsDe(MURO), { escala: s }));
  ok(pCorto.modo === 'entero' && pLargo.modo === 'extremos',
    'el muro de 150 cm cabe entero y el de 524 va a dos extremos');
  ok(redondo(pCorto.escala, 4) === redondo(pLargo.escala, 4),
    'pero los DOS al mismo px/cm: el corto ya no sale «muy pequeño» (' + redondo(s, 3) + ')');
  // Un elemento RECHONCHO no se parte nunca, aunque no quepa: cortarle la profundidad a
  // una viga sería tan absurdo como cortarle el espesor a un muro. Es forma, no tipo.
  ok(!R.recortable(30, 60) && R.recortable(20, 524),
    'sólo se recorta lo que de verdad es alargado (largo/corto ≥ ' + R.RELACION_RECORTE + ')');
  const pv = R.plan(PLS_VIGA, DEF_VIGA, W, H, Object.assign(optsDe(VIGA), { escala: 3 }));
  ok(pv.modo === 'entero',
    'una viga 30×60 sigue entera aunque a esa escala no quepa: no se le parte la sección');
  // LOS DOS EXTREMOS, misma escala, extremos opuestos, y nunca se afirma simetría.
  const [a, b] = pLargo.cuadros;
  ok(redondo(a.vent.u1 - a.vent.u0, 2) === redondo(b.vent.u1 - b.vent.u0, 2),
    'los dos cuadros abarcan lo mismo (' + redondo(pLargo.ventana, 1) + ' cm)');
  ok(a.extremo === -1 && b.extremo === 1 && a.vent.u0 < b.vent.u0,
    'y son los DOS extremos, no dos veces el mismo');
  ok(a.vent.u0 < pLargo.bbox.u0 && b.vent.u1 > pLargo.bbox.u1,
    'cada uno asoma la punta del elemento con su aire, no pegada al marco');
  ok(a.vent.u1 < pLargo.bbox.u1 && b.vent.u0 > pLargo.bbox.u0,
    'y por dentro corta: los dos cuadros juntos no muestran el muro entero');
  ok(!/simetr|palindrom|espejo/i.test(R2D_SRC.replace(/\/\/[^\n]*/g, '')),
    'y nunca se afirma que un extremo represente al otro: no hay probador de simetría');
  TE._tplPonerLista([]);
}

// ── R4b. LA VENTANA LLEGA AL CONFINAMIENTO ──────────────────────────────────
// Pedido del usuario: «mostrar un poco más hacia dentro del muro… ideal sería que la
// regla reconozca los cabezales o elementos de confinamiento». No hace falta reconocer
// tipologías: un fierro de confinamiento es el que NO se reparte por todo el elemento
// y está pegado a una punta, y eso está DECLARADO en la receta.
console.log('\nR4b — hasta dónde mirar lo dice el confinamiento, no un número redondo');
{
  const CONF = 90;
  const conCabezal = JSON.parse(JSON.stringify(MURO));
  [-1, 1].forEach(function (lado, i) {
    const a = lado < 0 ? -259 : (259 - CONF), b = lado < 0 ? (-259 + CONF) : 259;
    conCabezal.componentes.push({
      comp_id: 'CB' + i, tipologia: 'CB', figura: '101A', diam: 16, cara: 'lateral', jerarquia: 2,
      plano_pieza: { orientacion: 'de_pie' }, dims: { A: { modo: 'auto' } },
      distribucion: { modo: 'arreglo', sep: 12, activa: true,
        rango: { eje: 'x', from: a, to: b, sep: 12 },
        rango2: { eje: 'z', from: -7, to: 7, sep: 14 } } });
  });
  const t = { id: 1, tipo: 'muro', nombre: 'Muro con cabezal', updated_at: 'u', params: conCabezal };
  const f = TE._tplMiniFila(t);
  ok(Math.abs(f.confin - (CONF + 3)) < 4,
    'la receta declara confinamiento hasta los ' + redondo(f.confin, 0) + ' cm desde la punta');
  ok(f.ventana > f.confin,
    'y la ventana que se pide llega más allá (' + redondo(f.ventana, 0) +
    ' cm), para que se vea que el confinamiento TERMINA');
  // Sin fierro acotado no hay confinamiento que reconocer, y no se inventa ninguno.
  ok(TE._tplMiniFila({ id: 2, tipo: 'muro', params: MURO }).confin === 0,
    'un muro con todo el fierro corrido de punta a punta declara confinamiento 0');
  // EL @ DECLARADO TIENE QUE SER EL QUE EL MOTOR REPARTE. Es el guardia contra el bug
  // que este extractor ya tuvo: la PRIMERA línea de un reparto usa el `sep` del
  // COMPONENTE, no el del rango, y leyendo el del rango la ventana pedía 360 cm donde
  // el motor reparte cada 40. Encuadrar con la receta sólo vale si dice lo mismo.
  const sepDecl = TE._sepDeclarada(MURO, 'x');
  const sepReal = R.pasoTipico(PLS_MURO, 'x');
  ok(Math.abs(sepDecl - sepReal) <= 1,
    'el @ declarado en la receta (' + sepDecl + ') es el que el motor reparte de verdad (' +
    redondo(sepReal, 2) + ')');
  // Ni el extractor ni la regla nombran una tipología: el criterio es la FORMA del
  // reparto (acotado + pegado a la punta), no el nombre del fierro.
  const ext = TE_SRC.slice(TE_SRC.indexOf('function _tramosDeComp'), TE_SRC.indexOf('function _tplMiniFila'));
  ok(!/'(CB|EC|TC|ES|MH|MV|TR)'/.test(ext),
    'y el extractor no nombra ni una tipología: mira la forma del reparto');
  // LO QUE NO CABE SE DICE. Un confinamiento más hondo que la ventana no se calla:
  // callarlo dejaría creer que el confinamiento termina donde termina el cuadro.
  TE._tplPonerLista([t]);
  const s = TE._tplMiniEscala();
  const p = R.plan(generar(conCabezal), DEF_MURO, W, H,
    Object.assign(optsDe(conCabezal), { escala: s, ventana: f.ventana, confin: f.confin }));
  ok(p.ventana >= p.confin - 0.5 && !p.ventanaCorta,
    'con este muro la ventana (' + redondo(p.ventana, 0) + ' cm) cubre el confinamiento (' +
    redondo(p.confin, 0) + ' cm)');
  const apretado = R.plan(generar(conCabezal), DEF_MURO, W, H,
    Object.assign(optsDe(conCabezal), { escala: 3, ventana: f.ventana, confin: f.confin }));
  ok(apretado.ventanaCorta && /OJO/.test(R.titulo(apretado, DEF_MURO, TE.EJE_DISPLAY)),
    'y si a la escala de la lista no cupiera, el tooltip lo DICE en vez de callarlo');
  TE._tplPonerLista([]);
}

// ── R5. EL COLOR, POR PARÁMETRO ─────────────────────────────────────────────
console.log('\nR5 — el color entra por parámetro y es la paleta única del editor');
{
  const sinComentarios = R2D_SRC.replace(/\/\/[^\n]*/g, '');
  const hexFierro = (sinComentarios.match(/#[0-9a-f]{6}/gi) || [])
    .filter(h => Object.values({ MH: '#1565c0', MV: '#00897b', TR: '#7b1fa2', ES: '#e65100' })
      .indexOf(h.toLowerCase()) >= 0);
  ok(hexFierro.length === 0, 'el dibujante no escribe ni un color de fierro');
  ok(SVG_MURO.indexOf(TE.colorDeTipologia('MH')) >= 0 &&
     SVG_MURO.indexOf(TE.colorDeTipologia('TR')) >= 0,
    'y el SVG sale con los colores de COL2D — los mismos que pinta el editor');
  // Sin colorDe no se dibuja fierro: no hay tinta por defecto que tape el hueco.
  const t = R.encuadreVentana({ u0: -10, u1: 10, v0: -10, v1: 10 }, { x: 0, y: 0, w: 50, h: 50 }, 1);
  ok(R.trazos(PLS_MURO, DEF_MURO, t, { rolDe: OPT_MURO.rolDe }).length === 0,
    'sin colorDe no dibuja nada: el color no se inventa');
  // El grosor sigue al φ REAL de cada barra (un φ8 y un φ25 no pueden salir iguales).
  // MH va en φ10 y TR en φ8: sus trazos tienen que medir distinto, y en proporción.
  const anchoDe = (tip) => {
    const m = new RegExp('stroke="' + TE.colorDeTipologia(tip) + '" stroke-width="([\\d.]+)"').exec(SVG_MURO);
    return m ? +m[1] : null;
  };
  const gMH = anchoDe('MH'), gTR = anchoDe('TR');
  ok(gMH && gTR && gMH > gTR && Math.abs(gMH / gTR - 10 / 8) < 0.02,
    'y el grosor sigue al φ: φ10 sale ' + gMH + ' px y φ8 ' + gTR + ' px (razón 10/8)');

  // Y LOS REDONDOS TAMBIÉN (26-ago). El usuario dudó: «parecía que el tamaño de los
  // cabezales también [varía] pero en realidad no me queda tan claro». Medído: a las
  // escalas a las que se mira un elemento entero (0,7-1,5 px/cm) el radio real de un
  // φ16 es 0,8 px, así que el PISO de 1,5 px manda — y con un piso a secas un φ8 y un
  // φ25 salían EXACTAMENTE iguales, en el editor tanto como en la lista. Ahora el piso
  // lo toca el más fino del dibujo y los demás se engordan por el MISMO factor: siguen
  // saliendo más grandes de lo que son, pero unos respecto de otros dicen la verdad.
  {
    const v = JSON.parse(JSON.stringify(VIGA));
    v.componentes[1].diam = 25;                  // φ25 abajo contra φ16 arriba
    const pv = generar(v);
    const t = R.encuadreVentana({ u0: -15, u1: 15, v0: -30, v1: 30 }, { x: 0, y: 0, w: 40, h: 80 }, 0.933);
    const tz = R.trazos(pv, DEF_VIGA, t, { colorDe: optsDe(v).colorDe, rolDe: optsDe(v).rolDe, halo: false, hit: false });
    const radio = (tip) => {
      const z = tz.filter(x => x.punta && x.color === TE.colorDeTipologia(tip))[0];
      const m = z && /a([\d.]+),/.exec(z.d);
      return m ? +m[1] : null;
    };
    const r16 = radio('CBS'), r25 = radio('CBI');
    ok(r16 && r25 && r25 > r16,
      'un φ25 se dibuja más gordo que un φ16 aunque los dos estén bajo el piso (' +
      r16 + ' vs ' + r25 + ' px)');
    ok(Math.abs(r25 / r16 - 25 / 16) < 0.06,
      'y en su proporción real (' + redondo(r25 / r16, 3) + ' vs ' + redondo(25 / 16, 3) + ')');
    ok(tz.filter(x => x.punta)[0].engorde > 1,
      'el factor de engorde viaja en el trazo, para que el título pueda decirlo');
    ok(/engordadas/.test(R.titulo(R.plan(pv, DEF_VIGA, W, H, Object.assign(optsDe(v), { escala: 0.933 })), DEF_VIGA, TE.EJE_DISPLAY)),
      'y el tooltip lo dice: los redondos van engordados, su proporción no');
    // Con escala de sobra el piso no actúa y el radio es el REAL.
    const t2 = R.encuadreVentana({ u0: -15, u1: 15, v0: -30, v1: 30 }, { x: 0, y: 0, w: 120, h: 240 }, 4);
    const tz2 = R.trazos(pv, DEF_VIGA, t2, { colorDe: optsDe(v).colorDe, rolDe: optsDe(v).rolDe, halo: false, hit: false });
    ok(tz2.filter(x => x.punta)[0].engorde === 1,
      'y a escala grande no se engorda nada: el radio es el de la barra');
  }
}

// ── R6. DIBUJAR NO ESCRIBE ──────────────────────────────────────────────────
console.log('\nR6 — pintar no muta nada');
{
  const pls = generar(MURO);
  const antes = JSON.stringify(pls);
  R.svg(pls, DEF_MURO, W, H, OPT_MURO);
  R.plan(pls, DEF_MURO, W, H, OPT_MURO);
  ok(JSON.stringify(pls) === antes, 'los placements que entran salen intactos');
  // Y el dibujante no toca el DOM: se carga en un sandbox PELADO, sin `document`.
  const pelado = { console };
  vm.createContext(pelado);
  vm.runInContext(R2D_SRC, pelado, { filename: 'render2d.js' });
  ok(!!pelado.ModeladorRender2D && typeof pelado.ModeladorRender2D.svg === 'function',
    'y carga sin document, sin window y sin el motor: es una función pura');
  ok(pelado.ModeladorRender2D.svg(pls, DEF_MURO, W, H, OPT_MURO).length > 100,
    'y dibuja igual ahí (si algún día necesita el DOM, este test lo dice antes que el navegador)');
}

// ── R7. EL HUECO ────────────────────────────────────────────────────────────
console.log('\nR7 — lo que no se puede dibujar lo DICE');
{
  ok(R.svg([], DEF_MURO, W, H, OPT_MURO).indexOf('sin barras') >= 0,
    'una receta sin barras devuelve un hueco que lo dice, no una silueta inventada');
  ok(R.svg(PLS_MURO, { u: 'x', v: 'x' }, W, H, OPT_MURO).indexOf('sin plano') >= 0,
    'un plano imposible tampoco se adivina');
  const h = R.hueco(W, H, 'x');
  ok(/stroke-dasharray/.test(h) && h.indexOf('<path') < 0, 'el hueco es un marco punteado, no un dibujo');
  ok(TE._tplMini(null).indexOf('tplMiniSin') >= 0 &&
     TE._tplMini({ id: 1 }).indexOf('tplMiniSin') >= 0,
    'y una fila sin receta (servidor viejo) sale con guion, que es otro hueco distinto');
  // Una fila CON receta pero vacía o rota: el hueco del dibujante, con su motivo. Es
  // el camino real de un template corrupto, no una llamada de laboratorio.
  const rota = TE._tplMiniDibujo({ id: 99, tipo: 'muro', updated_at: 'x',
    params: { geometria: { largo: 300, alto: 250, ancho: 20 }, componentes: [] } });
  ok(rota.svg.indexOf('sin barras') >= 0 && /Ábrela para ver qué le falta/.test(rota.titulo),
    'y una receta que no genera nada muestra el hueco, diciendo qué hacer');
}

// ── R8. SE DICE QUÉ SE ESTÁ MIRANDO ─────────────────────────────────────────
console.log('\nR8 — el rótulo dice el plano, la rebanada y el extremo; y NO dice «esquema»');
{
  const rot = R.rotulos(PLAN_MURO, DEF_MURO, TE.EJE_DISPLAY);
  const tit = R.titulo(PLAN_MURO, DEF_MURO, TE.EJE_DISPLAY);
  ok(rot.cabecera.indexOf('YX') === 0, 'la cabecera nombra el plano con las letras del editor: ' + rot.cabecera);
  ok(/rebanada 30 cm en Z/.test(rot.cabecera), 'y dice que es una rebanada de 30 cm en la profundidad');
  ok(/^extremo Y− · \d+ cm$/.test(rot.pies[0]) && /^extremo Y\+ · \d+ cm$/.test(rot.pies[1]),
    'cada cuadro dice de qué extremo es (' + rot.pies.join(' · ') + ')');
  ok(SVG_MURO.indexOf(rot.cabecera) >= 0 && SVG_MURO.indexOf(rot.pies[0]) >= 0,
    'y esos rótulos están DENTRO del dibujo, no sólo en el tooltip');
  ok(/REBANADA/.test(tit) && /extremos/.test(tit), 'el tooltip dice lo mismo que la imagen');
  ok(!/esquema|aproximad|no va a escala/i.test(tit + rot.cabecera + rot.pies.join('')),
    'y NO dice que el fierro sea aproximado: ya no lo es');
  ok(!/esquema/i.test(R2D_SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
    'la palabra «esquema» no sobrevive en el código del dibujante');
  const ini = TE_SRC.indexOf('cont.innerHTML = \'<table');
  const lista = TE_SRC.slice(ini, TE_SRC.indexOf('</table>', ini));
  ok(ini > 0 && lista.indexOf('esquema') < 0 && lista.indexOf('>Sección</th>') >= 0,
    'ni en la cabecera de la columna del gestor');
  // La viga cabe entera: su rótulo no puede hablar de extremos.
  const pv = R.plan(PLS_VIGA, DEF_VIGA, W, H, OPT_VIGA);
  ok(!/extremo/.test(R.titulo(pv, DEF_VIGA, TE.EJE_DISPLAY)),
    'y cuando se ve el elemento entero no se menciona ningún extremo');
}

// ── R9. EL CAMINO DEL GESTOR ────────────────────────────────────────────────
console.log('\nR9 — de la fila del listado al SVG, y por demanda');
{
  const fila = { id: 7, tipo: 'muro', nombre: 'Muro 524', updated_at: '2026-08-26T10:00:00Z',
    params: JSON.parse(JSON.stringify(MURO)) };
  const copia = JSON.stringify(fila.params);
  const d = TE._tplMiniDibujo(fila);
  ok(/^<svg /.test(d.svg) && d.svg.indexOf('</svg>') > 0, 'la fila produce un SVG');
  ok(d.svg.indexOf(TE.colorDeTipologia('MH')) >= 0, 'con el fierro de su receta, en la paleta del editor');
  ok(/rebanada 30 cm/.test(d.svg), 'y con su rótulo');
  ok(JSON.stringify(fila.params) === copia,
    'y NO le tocó la receta al gestor (el motor normaliza sobre una copia)');
  ok(/^7|2026-08-26T10:00:00Z|[d.]+$/.test(TE._tplMiniClave(fila)),
    'el caché va por id + updated_at + escala: editar el template —o cambiar la lista— ' +
    'invalida su dibujo solo (' + TE._tplMiniClave(fila) + ')');
  // LA CELDA NACE VACÍA: 80 filas × 3 ms de motor no se pagan al pintar la tabla.
  const celda = TE._tplMini(fila);
  ok(celda.indexOf('<svg') < 0 && /data-tplmini="7"/.test(celda),
    'la celda nace vacía y marcada: el dibujo llega al entrar en pantalla');
  ok(/IntersectionObserver/.test(TE_SRC) && /rootMargin/.test(TE_SRC),
    'y quien lo trae es un IntersectionObserver, no el bucle de la tabla');
  // El caché devuelve el MISMO objeto: no se regenera por volver a mirar.
  ok(TE._tplMiniDibujo(fila) === d, 'volver a pedirlo no vuelve a correr el motor');
}

// ── R10. LO QUE CUESTA ──────────────────────────────────────────────────────
// OJO CON LOS NÚMEROS: esto corre dentro de un vm.Context, que es bastante más lento
// que el navegador (medido fuera del sandbox, la misma fila cuesta ~2,1 ms: 2,4 de
// motor y 0,26 de dibujo). El techo de abajo es holgado a propósito — lo que se está
// cuidando es el ORDEN de magnitud: milisegundos por fila, no décimas de segundo. Es
// el número que obliga a dibujar POR DEMANDA: ochenta filas de golpe son casi un
// cuarto de segundo de hilo bloqueado, y encima el DOM de ochenta miniaturas.
console.log('\nR10 — el costo, medido');
{
  const med = (n, f) => { for (let i = 0; i < 5; i++) f();
    const a = process.hrtime.bigint(); for (let i = 0; i < n; i++) f();
    return Number(process.hrtime.bigint() - a) / n / 1e6; };
  const msMotor = med(15, () => generar(MURO));
  const msDibujo = med(60, () => R.svg(PLS_MURO, DEF_MURO, W, H, OPT_MURO));
  ok(msMotor + msDibujo < 60, 'una fila cuesta ' + redondo(msMotor, 2) + ' ms de motor (' +
    PLS_MURO.length + ' barras) + ' + redondo(msDibujo, 2) + ' ms de dibujo');
  ok(msDibujo < msMotor,
    'y dibujar es más barato que generar: el caché por template guarda lo caro');
  const nodos = (SVG_MURO.match(/<path /g) || []).length;
  ok(nodos <= 12, 'el SVG sale con ' + nodos + ' <path> (uno por componente y cuadro), no uno por barra');
  // El cuadro emite SÓLO lo que su ventana muestra: sin eso, los dos cuadros llevarían
  // el componente entero y el DOM cargaría el doble de geometría de la que se ve.
  const subtrazos = (cuadrosDe(SVG_MURO)[0].html.match(/M[-\d.]+,[-\d.]+/g) || []).length;
  const todos = R.trazos(PLAN_MURO.plsBanda, DEF_MURO,
    R.encuadreVentana(PLAN_MURO.cuadros[0].vent, { x: 0, y: 0, w: 100, h: 70 }, PLAN_MURO.escala),
    { colorDe: OPT_MURO.colorDe, rolDe: OPT_MURO.rolDe, halo: false, hit: false })
    .reduce((n, z) => n + (z.d.match(/M[-\d.]+,[-\d.]+/g) || []).length, 0);
  ok(subtrazos < todos, 'y sólo la geometría de su ventana: ' + subtrazos + ' subtrazos, no ' + todos);
}

console.log(fallos ? '\n❌ ' + fallos + ' fallo(s)' : '\n✅ Todo OK');
process.exit(fallos ? 1 : 0);
