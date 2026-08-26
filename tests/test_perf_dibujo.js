// =============================================================================
// COSTO DE DIBUJO DEL TEMPLATE EDITOR — test headless (Node)
// =============================================================================
// El muro de 9 m del usuario (4 mallas @20 + 2 corridas de estribo @12 = SEIS
// componentes) se abría a 164 barras, y con una malla 3D y dos nodos SVG POR BARRA
// eso costaba:
//   · 656 llamadas de dibujo por cuadro (164 meshes × 4 pases: 3 vistas orto + 3D);
//   · 984 nodos SVG rehechos en CADA regeneración (164 × 2 nodos × 3 vistas), o sea
//     tres DOM de mil nodos por cada paso del mouse mientras se arrastra un tirador.
// Los TRIÁNGULOS nunca fueron el problema (62.760 no es nada para una GPU): eran las
// llamadas y el DOM. El arreglo (24-ago) es que el COMPONENTE es la unidad de dibujo,
// porque ya era la unidad de todo lo demás —selección, realce, ampolleta, clipping
// trabajan por `ci`—: una malla fusionada por componente y un path por componente.
//
// Este test congela ESE número, que es lo único que se fue a buscar, y las tres
// cosas que la fusión podía romper en silencio:
//   A. CUÁNTAS MALLAS — 164 barras → 6 mallas, una por componente.
//   B. LA AMPOLLETA SIGUE APAGANDO — un componente apagado no se agrupa (no se
//      construye su malla ni se emite su trazo), que era el contrato de _ocultoCi.
//   C. NADA SE FUSIONA A CIEGAS — dos barras del mismo componente que difieran en
//      algo que impide juntarlas (material 3D, color 2D, redonda vs de perfil) caen
//      en grupos separados solas. Si mañana el color deja de ser por componente,
//      esto NO pierde un color por el camino: emite dos mallas.
//   D. EL SPAN ES DEL COMPONENTE ENTERO — userData.span es hoy dato INFORMATIVO
//      (el clipping dejó de leerlo); se congela igual porque describe el mesh, y
//      con el span de UNA barra, un abanico de 46 barras repartido en 9 m se
//      declararía del ancho de una sola y el cuchillo decidiría mal por todas.
//   E. CUÁNTOS NODOS SVG — 984 → 36, contados sobre el camino de dibujo REAL
//      (_dibujarVista2D contra un SVG que graba), en los tres cuadrantes.
//   F. NO SE PERDIÓ NINGUNA BARRA — el path concatenado trae un subtrazo 'M' por
//      barra, y el HIT sigue llevando data-ci por componente (que es lo que el clic
//      lee): agrupar no puede volver inclicable ni invisible a nadie.
//   G. LOS LADOS DEL TUBO — 8, la decisión explícita (ver SEG_RADIALES).
//
// Correr con: node tests/test_perf_dibujo.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

// --------------------------------------------------------------- entorno mínimo
// Mismo mini-DOM que tests/test_cotas_lados.js: acá se cuentan NODOS y GRUPOS, así
// que el DOM real no hace falta — lo que sí hace falta es un SVG que GRABE lo que le
// cuelgan (el stub tira los atributos a la basura y el conteo sería ciego).
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
// El dibujante 2D PURO: desde el 26-ago la geometría de _dibujarVista2D (agrupar,
// proyectar, concatenar los `d`) vive ahí, para que la miniatura del Gestor de
// templates use EL MISMO dibujante. Sin él el editor no dibuja: es una dependencia,
// no un adorno.
mod('render2d.js', 'ModeladorRender2D');
vm.runInContext(fs.readFileSync(path.join(BASE, 'template_editor.js'), 'utf8'), ctx, { filename: 'template_editor.js' });

const R = win.ModeladorReglas;
const TE = win.TemplateEditor;
const ST = TE._ST;

// ------------------------------------------------------- el muro de la medición
// 9 m × 2,5 m × 20 cm. Cuatro mallas @20 (horizontal + vertical en cada cortina) y
// dos corridas de estribo @12. No es una receta de laboratorio: es la forma del
// elemento con el que el usuario reportó que el editor se ponía pesado.
const MURO = { largo: 900, alto: 250, ancho: 20, recub_sup: 3, recub_inf: 3, recub_lat: 2.5 };
const autoDims = lados => Object.fromEntries(lados.map(L => [L, { modo: 'auto' }]));
function comp(o) {
  return Object.assign({
    comp_id: 'C', jerarquia: 2, suf_tipo: '', recub_override: null, angulos: [],
    prioridad: null, empalme: null, depende_de: null, modo: 'lineal',
    plano_pieza: { volteado: false }, arreglo: { n_capas: 1, sep_capas: 20, rango: null }
  }, o);
}
const COMPONENTES = [1, -1].reduce((acc, lado) => acc.concat([
  comp({ tipologia: 'MH', figura: '101A', diam: 10, cara: 'lateral',
    pose: { cara: 'lateral', lado, rumbo: 'x' }, dims: autoDims(['A']),
    distribucion: { modo: 'linear', rango: { eje: 'y', from: -122, to: 122, sep: 20 } } }),
  comp({ tipologia: 'MV', figura: '101A', diam: 10, cara: 'lateral',
    pose: { cara: 'lateral', lado, rumbo: 'y' }, dims: autoDims(['A']),
    distribucion: { modo: 'linear', rango: { eje: 'x', from: -447.5, to: 447.5, sep: 20 } } })
]), []).concat([
  comp({ tipologia: 'EC', figura: '104D', diam: 8, cara: 'lateral',
    pose: { cara: 'lateral', lado: 1, rumbo: 'x' }, dims: autoDims(['A', 'B', 'C', 'D']),
    distribucion: { modo: 'linear', rango: { eje: 'y', from: -122, to: 122, sep: 12 } } }),
  comp({ tipologia: 'ES', figura: '104D', diam: 10, cara: 'lateral',
    pose: { cara: 'lateral', lado: 1, rumbo: 'x' }, dims: autoDims(['A', 'B', 'C', 'D']),
    distribucion: { modo: 'linear', rango: { eje: 'y', from: -122, to: 122, sep: 12 } } })
]);

// Placements etiquetados con su ci — el MISMO criterio de _etiquetarCi (una tanda de
// placements consecutivos por componente, en el orden de la receta).
const PLACEMENTS = [];
const PORCOMP = COMPONENTES.map((c, ci) => {
  const pls = R.expandirComponente(JSON.parse(JSON.stringify(c)), MURO);
  pls.forEach(pl => { pl.meta = Object.assign(pl.meta || {}, { ci: ci }); PLACEMENTS.push(pl); });
  return pls;
});
const N_COMP = COMPONENTES.length, N_BARRAS = PLACEMENTS.length;

ST.elemento = 'muro';
ST.receta = { tipo: 'muro', geometria: MURO, componentes: COMPONENTES };
ST.ultimoOut = { placements: PLACEMENTS };
ST.ortoActivo = false;     // sin render 3D detrás: el SVG dibuja TODO (el caso caro)
// Materiales 3D de mentira: en Node no hay THREE, y ST.materiales sólo se llena al
// inicializar la escena. Uno por tipología —que es como los reparte _matDe— basta
// para que la clave de _gruposMalla3D tenga algo real que comparar.
ST.materiales = { MH: 'm.MH', MV: 'm.MV', EC: 'm.EC', ES: 'm.ES', LT: 'm.LT', TRV: 'm.TRV' };
ST.selCi = -1; ST.selExtra = []; ST.cotas = false;

console.log('EL ELEMENTO DE LA MEDICIÓN');
ok(N_COMP === 6, 'seis componentes (4 mallas @20 + 2 corridas de estribo @12)');
ok(N_BARRAS === 164, N_BARRAS + ' barras (el muro que el usuario midió en ~166)');

// ---------------------------------------------------------------------------
console.log('\nA · CUÁNTAS MALLAS 3D');
// ---------------------------------------------------------------------------
{
  const gr = TE._gruposMalla3D(PLACEMENTS);
  ok(gr.length === N_COMP, 'una malla por componente: ' + N_BARRAS + ' barras → ' + gr.length +
    ' mallas (antes ' + N_BARRAS + ')');
  ok(gr.length * 4 === 24, 'llamadas de dibujo por cuadro (3 vistas orto + 3D): ' +
    (gr.length * 4) + ' (antes ' + (N_BARRAS * 4) + ')');
  const suma = gr.reduce((a, g) => a + g.pls.length, 0);
  ok(suma === N_BARRAS, 'no se perdió ninguna barra: las ' + suma + ' siguen dentro de algún grupo');
  ok(gr.every((g, i) => g.ci === i), 'cada grupo se queda con el ci de su componente (userData.ci)');
  ok(gr.every((g, i) => g.pls.length === PORCOMP[i].length),
    'y con TODAS las barras de ese componente (' + gr.map(g => g.pls.length).join('+') + ')');
}

// ---------------------------------------------------------------------------
console.log('\nB · LA AMPOLLETA SIGUE APAGANDO (apagado = no se construye)');
// ---------------------------------------------------------------------------
{
  TE._setOcultoComp(COMPONENTES[1], true);
  const gr = TE._gruposMalla3D(PLACEMENTS);
  ok(gr.length === N_COMP - 1, 'el componente apagado no genera malla (' + gr.length + ' grupos)');
  ok(gr.every(g => g.ci !== 1), 'ni aparece por ningún lado');
  ok(gr.reduce((a, g) => a + g.pls.length, 0) === N_BARRAS - PORCOMP[1].length,
    'y se van sus ' + PORCOMP[1].length + ' barras, no otras');
  TE._setOcultoComp(COMPONENTES[1], false);
  ok(TE._gruposMalla3D(PLACEMENTS).length === N_COMP, 'encenderlo lo devuelve');
}

// ---------------------------------------------------------------------------
console.log('\nC · NADA SE FUSIONA A CIEGAS (el discriminante fino)');
// ---------------------------------------------------------------------------
{
  // Dos barras del MISMO componente cuya clave difiere: tienen que salir en grupos
  // distintos. Es lo que impide que un color propio por barra —que hoy no existe,
  // pero el editor no lo prohíbe— se pierda al fusionar.
  const a = { puntos: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], diam: 1, meta: { ci: 0 } };
  const b = { puntos: [{ x: 0, y: 5, z: 0 }, { x: 10, y: 5, z: 0 }], diam: 1, meta: { ci: 0 } };
  const juntos = TE._agruparPlacements([a, b], () => 'igual');
  const partidos = TE._agruparPlacements([a, b], (pl) => 'c' + pl.puntos[0].y);
  ok(juntos.length === 1 && juntos[0].pls.length === 2, 'misma clave → un solo grupo');
  ok(partidos.length === 2, 'clave distinta dentro del mismo ci → dos grupos, no una fusión silenciosa');
  ok(partidos.every(g => g.ci === 0), 'los dos siguen siendo del componente 0');
  ok(TE._agruparPlacements([a, b], () => null).length === 0, 'clave null descarta el placement');
  // Barras SIN componente (ci = -1) tampoco se mezclan con las de un componente real.
  const suelta = { puntos: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], diam: 1 };
  ok(TE._agruparPlacements([a, suelta], () => 'igual').length === 2, 'ci = -1 no se cuela en el grupo de otro');
}

// ---------------------------------------------------------------------------
console.log('\nD · EL SPAN ES DEL COMPONENTE ENTERO (lo lee el clipping)');
// ---------------------------------------------------------------------------
{
  function spanDe(pls) {
    const lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    pls.forEach(pl => pl.puntos.forEach(p => {
      ['x', 'y', 'z'].forEach(e => { if (p[e] < lo[e]) lo[e] = p[e]; if (p[e] > hi[e]) hi[e] = p[e]; });
    }));
    return { x: hi.x - lo.x, y: hi.y - lo.y, z: hi.z - lo.z };
  }
  const mv = PORCOMP[1];                       // la cortina vertical: reparte en x, 46 barras
  const sGrupo = TE._spanDeGrupo(mv), sUna = spanDe([mv[0]]), sTodas = spanDe(mv);
  ok(Math.abs(sGrupo.x - sTodas.x) < 1e-9 && Math.abs(sGrupo.y - sTodas.y) < 1e-9 &&
     Math.abs(sGrupo.z - sTodas.z) < 1e-9, 'el span del grupo es el bbox de TODAS sus barras');
  ok(sUna.x < 1 && sGrupo.x > 800,
    'y no el de una sola: una barra abarca ' + sUna.x.toFixed(1) + ' cm en x, el componente ' +
    sGrupo.x.toFixed(1) + ' cm (con el de una, el cuchillo decidiría mal por las 46)');
}

// ---------------------------------------------------------------------------
console.log('\nE · CUÁNTOS NODOS SVG (camino de dibujo real, 3 cuadrantes)');
// ---------------------------------------------------------------------------
// SVG de mentira que GRABA lo que le cuelgan, con lo justo que _dibujarVista2D le
// pide (vaciarse y su viewBox).
function Nodo(tag) { this.tag = tag; this.attrs = {}; this.hijos = []; this.textContent = ''; }
Nodo.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
Nodo.prototype.getAttribute = function (k) { return this.attrs[k] != null ? this.attrs[k] : null; };
Nodo.prototype.appendChild = function (c) { this.hijos.push(c); return c; };
Nodo.prototype.removeChild = function (c) { const i = this.hijos.indexOf(c); if (i >= 0) this.hijos.splice(i, 1); return c; };
Nodo.prototype.querySelector = function () { return null; };
Object.defineProperty(Nodo.prototype, 'firstChild', {
  get() { return this.hijos.length ? this.hijos[0] : null; }, configurable: true
});
Object.defineProperty(Nodo.prototype, 'lastChild', {
  get() { return this.hijos.length ? this.hijos[this.hijos.length - 1] : null; }, configurable: true
});
const antesNS = win.document.createElementNS;
win.document.createElementNS = (ns, tag) => new Nodo(tag);

const VISTAS = ['seccion', 'largo', 'planta'];
function pintar(plano) {
  const svg = new Nodo('svg');
  svg.setAttribute('viewBox', '0 0 620 300');
  TE._dibujarVista2D(svg, { placements: PLACEMENTS }, plano, MURO);
  const paths = svg.hijos.filter(n => n.tag === 'path');
  const cls = n => String(n.attrs['class'] || '');
  return {
    hit: paths.filter(n => n.attrs['data-hit'] === 1 || n.attrs['data-hit'] === '1'),
    halo: paths.filter(n => cls(n) === 'te-bar-halo'),
    // trazo = el <path> con clase te-bar (barra de perfil) o el relleno de la barra
    // vista de punta, que no lleva clase pero sí un fill de color.
    trazo: paths.filter(n => cls(n).indexOf('te-bar') === 0 && cls(n) !== 'te-bar-halo')
      .concat(paths.filter(n => !cls(n) && /^#/.test(String(n.attrs.fill || '')))),
    grilla: paths.filter(n => cls(n).indexOf('te-grid2d') === 0)
  };
}
{
  let total = 0;
  VISTAS.forEach(plano => {
    const p = pintar(plano);
    const nodos = p.hit.length + p.halo.length + p.trazo.length;
    total += nodos;
    ok(nodos === 2 * N_COMP, plano + ': ' + nodos + ' nodos de barra (' + p.trazo.length +
      ' trazos + ' + p.hit.length + ' hits) — antes ' + (2 * N_BARRAS));
    ok(p.grilla.length <= 2, plano + ': la grilla sigue siendo 2 paths, no se contaminó');
  });
  ok(total === 36, 'las tres vistas juntas: ' + total + ' nodos por regeneración (antes ' +
    (2 * N_BARRAS * 3) + ')');
}
{
  // Con selección aparece el halo del componente elegido, UNO, no uno por barra.
  ST.selCi = 1;
  const p = pintar('largo');
  ok(p.halo.length === 1, 'seleccionar un componente agrega UN halo, no ' + PORCOMP[1].length);
  ST.selCi = -1;
}

// ---------------------------------------------------------------------------
console.log('\nF · NO SE PERDIÓ NINGUNA BARRA NI NINGÚN CLIC');
// ---------------------------------------------------------------------------
{
  VISTAS.forEach(plano => {
    const p = pintar(plano);
    // Cada barra aporta un subtrazo, y un subtrazo empieza con 'M'.
    const subtrazos = p.hit.reduce((a, n) => a + (String(n.attrs.d).match(/M/g) || []).length, 0);
    ok(subtrazos === N_BARRAS, plano + ': el path concatenado trae ' + subtrazos +
      ' subtrazos = las ' + N_BARRAS + ' barras');
    const cis = p.hit.map(n => Number(n.attrs['data-ci'])).sort((a, b) => a - b);
    ok(cis.length === N_COMP && cis.every((c, i) => c === i),
      plano + ': el HIT sigue llevando data-ci de los 6 componentes (es lo que lee el clic)');
    ok(p.hit.every(n => n.attrs['data-hit'] === '1' || n.attrs['data-hit'] === 1),
      plano + ': y su data-hit');
  });
  // ORDEN DE CAPAS: halos → trazos → hits. El SVG no tiene z-index; si un hit
  // quedara debajo de un trazo de otro componente, el clic se lo comería.
  ST.selCi = 0;
  const svg = new Nodo('svg'); svg.setAttribute('viewBox', '0 0 620 300');
  TE._dibujarVista2D(svg, { placements: PLACEMENTS }, 'largo', MURO);
  const idx = t => svg.hijos.map((n, i) => ({ n, i })).filter(o => t(o.n)).map(o => o.i);
  const iHalo = idx(n => String(n.attrs['class'] || '') === 'te-bar-halo');
  const iHit = idx(n => n.attrs['data-hit'] === '1');
  const iTrazo = idx(n => String(n.attrs['class'] || '').indexOf('te-bar') === 0 &&
                          String(n.attrs['class']) !== 'te-bar-halo');
  ok(Math.max.apply(null, iHalo) < Math.min.apply(null, iTrazo), 'los halos van DEBAJO de los trazos');
  ok(Math.max.apply(null, iTrazo) < Math.min.apply(null, iHit), 'y todos los hits, ENCIMA de todo');
  ST.selCi = -1;
}
win.document.createElementNS = antesNS;

// ---------------------------------------------------------------------------
console.log('\nG · EL CÍRCULO COMO SUBTRAZO Y LOS LADOS DEL TUBO');
// ---------------------------------------------------------------------------
{
  const d = TE._dCirculo(100, 50, 4);
  ok((d.match(/M/g) || []).length === 1 && /Z$/.test(d), 'un círculo = un subtrazo cerrado');
  ok((d.match(/a/g) || []).length === 2, 'dos semiarcos (es lo que cierra la circunferencia)');
  ok(d.indexOf('M96.0,50.0') === 0, 'arranca en el punto izquierdo del círculo: ' + d);
  // Concatenar dos círculos sigue siendo UN path válido: 'Z' seguido de 'M' abre otro.
  const dd = TE._dCirculo(100, 50, 4) + TE._dCirculo(200, 50, 4);
  ok((dd.match(/M/g) || []).length === 2 && dd.indexOf('ZM') > 0, 'dos círculos caben en un solo path');
  ok(TE.SEG_RADIALES === 8, 'lados del tubo = 8 (bajó de 10; el 6 se descartó por la tapa de sección)');
}

console.log(fallos ? '\nFALLA: ' + fallos : '\nOK — el costo de dibujo del editor sigue siendo por COMPONENTE.');
process.exit(fallos ? 1 : 0);
