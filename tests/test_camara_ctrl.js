// Test headless (Node) de la CÁMARA DEL CUADRANTE 3D del Template Editor:
// los DOS MODOS DE GIRO y el modelo de cámara que los sostiene.
//
// POR QUÉ EXISTE. Durante varias sesiones el ctrl+arrastre "no se notaba". La causa
// estaba medida y no era la que se creía: el ctrl movía el CENTRO del giro (pivote en
// la pieza) y el centro normal ya cae donde uno tiene la pieza —el centro de la
// pantalla, porque _absorberPanEnTarget lo deja ahí—, así que los dos gestos
// difieren 12,7 px en todo el arrastre: indistinguibles. Ahora el ctrl cambia el EJE:
// gira sobre el EJE PROPIO de la pieza. Este archivo CONGELA que los dos modos son
// distinguibles con números, para que no vuelva a colapsar en "hacen lo mismo".
//
// CONTRATOS QUE FIJA:
//   C0 · El modelo nuevo (quaternion) reproduce EXACTAMENTE la base vieja
//        (rotX/rotY + arriba del mundo) en el punto de partida.
//   C1 · La órbita normal NO cambió: 60 pasos de arrastre dejan el ojo donde lo
//        dejaba `rotY += dAz; rotX += dEl` (1e-9), con el mismo tope de elevación.
//   C2 · El eje propio de la pieza: barra → su propia recta; estribo → la NORMAL de
//        su plano (el eje del carrete). Y no depende de cuántas copias tenga.
//   C3 · LOS DOS MODOS SON DISTINTOS, con números: con ctrl la recta de la pieza
//        queda clavada (0,000000 px) y sin ctrl se va cientos de píxeles.
//   C4 · El giro con ctrl pasa por el CENIT sin trabarse ni perder rigidez (el
//        modelo viejo, de 2 grados, se degeneraba justo ahí).
//   C5 · Lo que ya funcionaba sigue igual: pivotar sin mover, absorber el pan y
//        panear en el plano de pantalla — también con el horizonte inclinado.
//   C6 · Con la GEOMETRÍA REAL de la semilla de viga: cada pieza da el eje que uno
//        señalaría con el dedo, y el editor avisa cuando el eje es vertical.
//   C7 · Barrido de 48 escenarios: los dos modos se separan cientos de píxeles en
//        todos, salvo el caso débil conocido (pieza vertical), que queda congelado.
//   C8 · Un pivote imposible (la pieza pegada al ojo) se RECHAZA en vez de recortarse:
//        el gesto cae al giro normal y la imagen no pega el tirón de 152 px.
//   C9 · El arrastre normal endereza el horizonte que dejó el ctrl, sin tocar el
//        encuadre y sin tirones.
//
// Corre el template_editor.js REAL sobre un mini-DOM y un THREE de mentira (three
// viene de CDN y en Node no está; acá sólo hacen falta Vector3, Quaternion y una
// cámara con posición y orientación). Correr con: node tests/test_camara_ctrl.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
const f6 = (n) => Number(n).toFixed(6);
const f1 = (n) => Number(n).toFixed(1);

// ----------------------------------------------------------------- THREE de mentira
// Las MISMAS fórmulas de three r160 para lo que el editor usa: applyQuaternion,
// multiply y setFromAxisAngle. Si estas tres estuvieran mal, el test mediría otra
// cámara que la del navegador y no serviría de nada.
function V3(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
V3.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
V3.prototype.copy = function (v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; };
V3.prototype.clone = function () { return new V3(this.x, this.y, this.z); };
V3.prototype.add = function (v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; };
V3.prototype.sub = function (v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; };
V3.prototype.subVectors = function (a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; };
V3.prototype.addScaledVector = function (v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; };
V3.prototype.multiplyScalar = function (s) { this.x *= s; this.y *= s; this.z *= s; return this; };
V3.prototype.dot = function (v) { return this.x * v.x + this.y * v.y + this.z * v.z; };
V3.prototype.length = function () { return Math.sqrt(this.dot(this)); };
V3.prototype.normalize = function () { const l = this.length() || 1; return this.multiplyScalar(1 / l); };
V3.prototype.crossVectors = function (a, b) {
  const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
  this.x = x; this.y = y; this.z = z; return this;
};
V3.prototype.applyQuaternion = function (q) {
  const x = this.x, y = this.y, z = this.z;
  const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
  this.x = x + q.w * tx + q.y * tz - q.z * ty;
  this.y = y + q.w * ty + q.z * tx - q.x * tz;
  this.z = z + q.w * tz + q.x * ty - q.y * tx;
  return this;
};
function Q(x, y, z, w) { this.x = x || 0; this.y = y || 0; this.z = z || 0; this.w = (w === undefined ? 1 : w); }
Q.prototype.clone = function () { return new Q(this.x, this.y, this.z, this.w); };
Q.prototype.copy = function (q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; };
Q.prototype.setFromAxisAngle = function (eje, ang) {
  const h = ang / 2, s = Math.sin(h);
  this.x = eje.x * s; this.y = eje.y * s; this.z = eje.z * s; this.w = Math.cos(h);
  return this;
};
Q.prototype.multiply = function (b) {
  const ax = this.x, ay = this.y, az = this.z, aw = this.w;
  this.x = ax * b.w + aw * b.x + ay * b.z - az * b.y;
  this.y = ay * b.w + aw * b.y + az * b.x - ax * b.z;
  this.z = az * b.w + aw * b.z + ax * b.y - ay * b.x;
  this.w = aw * b.w - ax * b.x - ay * b.y - az * b.z;
  return this;
};
function CamaraFalsa() {
  this.position = new V3(); this.quaternion = new Q(); this.up = new V3(0, 1, 0);
  this.matrix = { elements: [] };
}
CamaraFalsa.prototype.updateMatrix = function () {};
CamaraFalsa.prototype.updateProjectionMatrix = function () {};
const THREE = { Vector3: V3, Quaternion: Q };

// ---------------------------------------------------------------- mini-DOM
function classList(el) {
  const s = [];
  return {
    add() { for (const c of arguments) if (s.indexOf(c) < 0) s.push(c); el.className = s.join(' '); },
    remove() { for (const c of arguments) { const i = s.indexOf(c); if (i >= 0) s.splice(i, 1); } el.className = s.join(' '); },
    toggle(c, on) { if (on === undefined) on = s.indexOf(c) < 0; if (on) this.add(c); else this.remove(c); },
    contains(c) { return s.indexOf(c) >= 0; }
  };
}
function El(tag, doc) {
  this.tagName = String(tag || 'div').toUpperCase();
  this._doc = doc; this.children = []; this.style = {}; this.dataset = {}; this._attrs = {}; this._listeners = {};
  this._text = ''; this._html = ''; this.value = ''; this.className = ''; this.classList = classList(this); this.id = '';
}
El.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return this._attrs.hasOwnProperty(k) ? this._attrs[k] : null; };
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.addEventListener = function (t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); };
El.prototype.removeEventListener = function () {};
El.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }; };
El.prototype.querySelector = function () { return null; };
El.prototype.querySelectorAll = function () { return []; };
El.prototype.closest = function () { return null; };
El.prototype.focus = function () {}; El.prototype.blur = function () {};
El.prototype.getContext = function () { return null; };
Object.defineProperty(El.prototype, 'textContent', { get() { return this._text; }, set(v) { this._text = String(v == null ? '' : v); } });
Object.defineProperty(El.prototype, 'innerHTML', { get() { return this._html; }, set(v) { this._html = String(v == null ? '' : v); } });

function Doc() { this._byId = {}; this.body = new El('body', this); this.documentElement = new El('html', this); }
Doc.prototype.createElement = function (t) { return new El(t, this); };
Doc.prototype.createElementNS = function (ns, t) { return new El(t, this); };
Doc.prototype.createTextNode = function (t) { const e = new El('#text', this); e._text = String(t); return e; };
Doc.prototype.getElementById = function (id) {
  if (!this._byId[id]) { const e = new El('div', this); e.id = id; this._byId[id] = e; }
  return this._byId[id];
};
Doc.prototype.querySelector = function () { return null; };
Doc.prototype.querySelectorAll = function () { return []; };
Doc.prototype.addEventListener = function () {};

function sesion() {
  const doc = new Doc();
  const win = {};
  win.window = win; win.self = win; win.document = doc;
  win.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  win.navigator = { userAgent: 'node' };
  win.location = { href: 'http://x/', origin: 'http://x' };
  win.console = console; win.THREE = THREE;
  win.JSON = JSON; win.Math = Math; win.Date = Date; win.Object = Object; win.Array = Array;
  win.Number = Number; win.String = String; win.Boolean = Boolean; win.isFinite = isFinite;
  win.parseFloat = parseFloat; win.parseInt = parseInt; win.isNaN = isNaN; win.Error = Error; win.Promise = Promise;
  win.alert = () => {}; win.confirm = () => true;
  win.fetch = () => Promise.reject(new Error('sin red'));
  win.requestAnimationFrame = () => 0; win.cancelAnimationFrame = () => {};
  win.setTimeout = () => 0; win.clearTimeout = () => {}; win.setInterval = () => 0; win.clearInterval = () => {};
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
  mod('motor_geom.js');
  if (!win.ModeladorMotorGeom) win.ModeladorMotorGeom = global.ModeladorMotorGeom;
  mod('reglas.js', 'ModeladorReglas');
  mod('generar.js', 'ModeladorGenerar');
  mod('semilla_viga.js', 'ModeladorSemilla');
  vm.runInContext(fs.readFileSync(path.join(BASE, 'template_editor.js'), 'utf8'), ctx, { filename: 'template_editor.js' });
  return win;
}

// ------------------------------------------------------- escena de prueba + medición
const W = 800, H = 600;   // el cuadrante 3D del mini-DOM

// Una pieza = una lista de colocaciones (las copias de una distribución).
// `pose` = [elevación, acimut] para mirar desde otro lado (por omisión, la de arranque).
function montar(TE, piezas, ci, pose) {
  const ST = TE._st;
  ST.camera = new CamaraFalsa();
  ST.target = new V3(0, 0, 0);
  // null = punto de partida (CAM0), como al abrir el editor
  ST.quat = pose ? TE._quatDeAngulos(pose[0], pose[1]) : null;
  ST.dist = 900; ST.panX = 0; ST.panY = 0;
  ST.ejeRot = 'libre';
  ST.ultimoOut = { placements: piezas };
  ST.selCi = (ci === undefined ? 0 : ci);
}

// PROYECCIÓN a píxeles con la MISMA cámara que arma _applyCam (base del quaternion,
// ojo de la parametrización) y el MISMO lente (FOV3D). Es la regla con la que se
// miden los "0,000000 px": si un punto se ve donde se veía, no se movió en pantalla.
function proyectar(TE, P) {
  const b = TE._baseCam(), ojo = TE._ojoCam(b);
  const d = new V3(P.x - ojo.x, P.y - ojo.y, P.z - ojo.z);
  const prof = -d.dot(b.atras);                       // la vista es −atrás
  if (!(prof > 1e-6)) return null;                    // detrás de la cámara
  const th = Math.tan(TE.FOV3D * Math.PI / 360);
  return {
    px: (d.dot(b.derecha) / (prof * th * (W / H))) * (W / 2) + W / 2,
    py: -(d.dot(b.arriba) / (prof * th)) * (H / 2) + H / 2
  };
}
function dist2(a, b) { return (a && b) ? Math.hypot(a.px - b.px, a.py - b.py) : Infinity; }

// Un arrastre completo: `pasos` movimientos de (dx, dy) píxeles.
// Devuelve el máximo desplazamiento en pantalla de cada punto vigilado.
function arrastrar(TE, pasos, dx, dy, ctrl, vigilados) {
  const p0 = (vigilados || []).map((P) => proyectar(TE, P));
  const maxs = (vigilados || []).map(() => 0);
  for (let i = 0; i < pasos; i++) {
    TE._girarPorArrastre(dx, dy, !!ctrl);
    (vigilados || []).forEach((P, k) => {
      const d = dist2(proyectar(TE, P), p0[k]);
      if (d > maxs[k]) maxs[k] = d;
    });
  }
  return maxs;
}

// Alabeo (inclinación del horizonte) en grados: ángulo entre el "arriba" de la cámara
// y el plano vertical que contiene la vista. Cero = horizonte a nivel.
function alabeoGrados(TE) {
  const b = TE._baseCam();
  const horiz = new V3().crossVectors(new V3(0, 1, 0), b.atras);
  if (!(horiz.length() > 1e-9)) return 0;
  horiz.normalize();
  return Math.abs(Math.asin(Math.max(-1, Math.min(1, b.arriba.dot(horiz)))) * 180 / Math.PI);
}
function elevGrados(TE) { return Math.asin(Math.max(-1, Math.min(1, TE._baseCam().atras.y))) * 180 / Math.PI; }

// --- piezas de prueba (coordenadas de mundo, cm) --------------------------------
// Barra longitudinal de 600 cm sobre el eje x, con patas de 20 cm en los extremos.
const BARRA = [{ meta: { ci: 0 }, puntos: [
  { x: -300, y: 5, z: 12 }, { x: -300, y: 25, z: 12 },
  { x: 300, y: 25, z: 12 }, { x: 300, y: 5, z: 12 }
] }];
// Estribo 60×30 en el plano y-z (el de una viga): su eje propio es la NORMAL, o sea x.
function estribo(x) {
  return { meta: { ci: 0 }, puntos: [
    { x: x, y: -30, z: -15 }, { x: x, y: 30, z: -15 },
    { x: x, y: 30, z: 15 }, { x: x, y: -30, z: 15 }, { x: x, y: -30, z: -15 }
  ] };
}

console.log('== CÁMARA DEL 3D · los dos modos de giro ==\n');

// ================================================================ C0
console.log('C0 — el modelo nuevo (quaternion) reproduce la base vieja (rotX/rotY)');
{
  const w = sesion(), TE = w.TemplateEditor;
  montar(TE, BARRA);
  const e = TE.CAM0.elev, a = TE.CAM0.azim;
  const b = TE._baseCam();
  // fórmula vieja de _applyCam: atrás = (cos e·sin a, sin e, cos e·cos a)
  const atras0 = { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: Math.cos(e) * Math.cos(a) };
  const dAtras = Math.hypot(b.atras.x - atras0.x, b.atras.y - atras0.y, b.atras.z - atras0.z);
  ok(dAtras < 1e-12, 'el vector "atrás" es el mismo de la fórmula vieja (Δ=' + dAtras.toExponential(2) + ')');
  // three arma la derecha del lookAt como normalize(arriba_mundo × atrás) = (cos a, 0, −sin a)
  const dDer = Math.hypot(b.derecha.x - Math.cos(a), b.derecha.y, b.derecha.z + Math.sin(a));
  ok(dDer < 1e-12, 'la "derecha" es la del lookAt con el arriba del mundo (Δ=' + dDer.toExponential(2) + ')');
  ok(alabeoGrados(TE) < 1e-9, 'nace sin alabeo: el horizonte arranca a nivel');
  // el ojo de la parametrización = target + dist·atrás
  const ojo = TE._ojoCam();
  ok(Math.abs(ojo.x - 900 * atras0.x) < 1e-9 && Math.abs(ojo.y - 900 * atras0.y) < 1e-9,
    'el ojo sale de target + dist·atrás, como antes');
}

// ================================================================ C1
console.log('\nC1 — la órbita NORMAL no cambió (mismo ojo que `rotY += dAz; rotX += dEl`)');
{
  const w = sesion(), TE = w.TemplateEditor;
  montar(TE, BARRA);
  const k = 0.008, dx = 3, dy = 2, pasos = 60;
  let rotX = TE.CAM0.elev, rotY = TE.CAM0.azim;
  for (let i = 0; i < pasos; i++) {
    TE._girarPorArrastre(dx, dy, false);
    rotY += -dx * k;
    rotX = Math.max(-1.45, Math.min(1.45, rotX + dy * k));
  }
  const ojo = TE._ojoCam();
  const esperado = {
    x: 900 * Math.cos(rotX) * Math.sin(rotY), y: 900 * Math.sin(rotX), z: 900 * Math.cos(rotX) * Math.cos(rotY)
  };
  const d = Math.hypot(ojo.x - esperado.x, ojo.y - esperado.y, ojo.z - esperado.z);
  ok(d < 1e-9, pasos + ' pasos de arrastre dejan el ojo donde lo dejaba la fórmula vieja (Δ=' + d.toExponential(2) + ' cm)');
  ok(alabeoGrados(TE) < 1e-9, 'la órbita normal NO inclina el horizonte (alabeo ' + f6(alabeoGrados(TE)) + '°)');
  // el gesto era lo bastante largo como para llegar al tope (la fórmula espejo también
  // topó), así que esto mide el tope de VERDAD: dónde quedó la cámara.
  ok(Math.abs(elevGrados(TE) - 1.45 * 180 / Math.PI) < 1e-6, 'la cámara queda EXACTAMENTE en el tope de 1,45 rad, sin pasarse');
  // el pivote no se mueve en pantalla: es el hecho medido que desmiente la teoría del
  // "pivote = target + pan" (0,000000 px en 60 pasos).
  const w2 = sesion(), T2 = w2.TemplateEditor;
  montar(T2, BARRA);
  const t0 = proyectar(T2, { x: 0, y: 0, z: 0 });
  const maxT = arrastrar(T2, 60, 3, 2, false, [{ x: 0, y: 0, z: 0 }])[0];
  ok(maxT < 1e-9, 'el target queda CLAVADO en pantalla durante toda la órbita (' + f6(maxT) + ' px)');
  ok(t0 && Math.abs(t0.px - 400) < 1e-9, 'y está donde tiene que estar: el centro del cuadrante');
}

// ================================================================ C2
console.log('\nC2 — EJE PROPIO de la pieza (barra = su recta · estribo = la normal de su plano)');
{
  const w = sesion(), TE = w.TemplateEditor;
  montar(TE, BARRA);
  const u = TE._ejePropioSeleccion3D();
  ok(!!u && Math.abs(u.x - 1) < 1e-6 && Math.abs(u.y) < 1e-6 && Math.abs(u.z) < 1e-6,
    'barra longitudinal (600 cm sobre x, con patas) → eje x (' + [f6(u.x), f6(u.y), f6(u.z)].join(', ') + ')');

  montar(TE, [estribo(0)]);
  const e1 = TE._ejePropioSeleccion3D();
  ok(!!e1 && Math.abs(Math.abs(e1.x) - 1) < 1e-6,
    'estribo 60×30 en el plano y-z → eje x, la NORMAL de su plano (' + [f6(e1.x), f6(e1.y), f6(e1.z)].join(', ') + ')');

  const familia = [];
  for (let i = 0; i < 30; i++) familia.push(estribo(-290 + i * 20));
  montar(TE, familia);
  const e30 = TE._ejePropioSeleccion3D();
  ok(!!e30 && Math.abs(e30.x - e1.x) < 1e-9 && Math.abs(e30.y - e1.y) < 1e-9,
    'una familia de 30 estribos da EL MISMO eje que uno suelto (no depende del reparto)');

  // pieza vertical (una barra de muro): el eje propio es vertical, y el modo sigue
  // siendo honesto — sólo que ahí se PARECE al giro normal (es el caso débil, y está
  // dicho en el reporte, no escondido).
  montar(TE, [{ meta: { ci: 0 }, puntos: [{ x: 10, y: -150, z: 5 }, { x: 10, y: 150, z: 5 }] }]);
  const uv = TE._ejePropioSeleccion3D();
  ok(!!uv && Math.abs(uv.y - 1) < 1e-6, 'barra vertical → eje y (vertical del mundo)');

  // EL CATÁLOGO MANDA sobre la forma de la nube. Dos casos donde el indicio
  // geométrico solo se equivoca (los midió la auditoría):
  //   · barra de 100 con patas de 40 → la nube la ve "plana" (λ2/λ1 = 0,16) y la haría
  //     girar como carrete; es una barra y su eje es su largo.
  //   · estribo 400×12 → la nube la ve "lineal" (0,002) y le quitaría su eje de
  //     carrete; es un estribo y su eje es la normal.
  const barraPatas = [{ meta: { ci: 0 }, puntos: [
    { x: -50, y: 40, z: 0 }, { x: -50, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, { x: 50, y: 40, z: 0 }] }];
  montar(TE, barraPatas);
  TE._st.receta = { componentes: [{ tipologia: 'CBS', figura: '103B' }] };
  const ub = TE._ejePropioSeleccion3D();
  ok(Math.abs(ub.x - 1) < 1e-6, 'barra de 100 con patas de 40 (figura de cadena) → eje x, su largo (' + f6(ub.x) + ')');
  const estFlaco = [{ meta: { ci: 0 }, puntos: [
    { x: 0, y: -200, z: -6 }, { x: 0, y: 200, z: -6 }, { x: 0, y: 200, z: 6 }, { x: 0, y: -200, z: 6 }, { x: 0, y: -200, z: -6 }] }];
  montar(TE, estFlaco);
  TE._st.receta = { componentes: [{ tipologia: 'ES', figura: '104D' }] };
  const ue = TE._ejePropioSeleccion3D();
  ok(Math.abs(ue.x - 1) < 1e-6, 'estribo 400×12 (figura de estribo) → eje x, la normal de su plano (' + f6(ue.x) + ')');

  montar(TE, []);
  ok(TE._ejePropioSeleccion3D() === null, 'sin selección no hay eje propio (null, no un eje inventado)');
  montar(TE, [{ meta: { ci: 0 }, puntos: [{ x: 5, y: 5, z: 5 }] }]);
  ok(TE._ejePropioSeleccion3D() === null, 'un solo punto tampoco define un eje (null)');
}

// ================================================================ C3 — EL CONTRATO
console.log('\nC3 — LOS DOS MODOS SON DISTINTOS (con la misma pieza y el mismo gesto)');
{
  const PASOS = 60, DX = 4;
  // dos puntos SOBRE el eje de la pieza, uno a cada lado del centro: si el giro es
  // sobre ese eje, los dos quedan clavados (es una recta invariante, no un punto).
  const sobreEje = [{ x: -250, y: 15, z: 12 }, { x: 250, y: 15, z: 12 }];
  const testigo = { x: 0, y: -200, z: 300 };   // un punto cualquiera de la escena

  const wC = sesion(), TC = wC.TemplateEditor; montar(TC, BARRA);
  const mCtrl = arrastrar(TC, PASOS, DX, 0, true, sobreEje.concat([testigo]));
  const wN = sesion(), TN = wN.TemplateEditor; montar(TN, BARRA);
  const mNorm = arrastrar(TN, PASOS, DX, 0, false, sobreEje.concat([testigo]));

  ok(mCtrl[0] < 1e-6 && mCtrl[1] < 1e-6,
    'CON ctrl la recta de la pieza queda CLAVADA: ' + f6(mCtrl[0]) + ' px y ' + f6(mCtrl[1]) + ' px de deriva');
  ok(mNorm[0] > 100 && mNorm[1] > 100,
    'SIN ctrl esos mismos puntos se van: ' + f1(mNorm[0]) + ' px y ' + f1(mNorm[1]) + ' px');
  ok(mCtrl[2] > 100,
    'CON ctrl la escena SÍ gira alrededor de la pieza (el testigo se mueve ' + f1(mCtrl[2]) + ' px)');

  // Y la diferencia entre los dos modos, punto por punto, al final del gesto:
  const sep = [sobreEje[0], sobreEje[1], testigo, { x: 0, y: 0, z: 0 }]
    .map((P) => dist2(proyectar(TC, P), proyectar(TN, P)));
  const sepMax = Math.max.apply(Math, sep.filter((n) => isFinite(n)));
  ok(sepMax > 200, 'tras el mismo arrastre, la imagen de un modo y la del otro se separan hasta ' + f1(sepMax) + ' px');

  ok(alabeoGrados(TC) > 5, 'el giro sobre la pieza INCLINA el horizonte (' + f1(alabeoGrados(TC)) + '°): es la señal visible del modo');
  ok(alabeoGrados(TN) < 1e-9, 'el giro normal lo deja a nivel (' + f6(alabeoGrados(TN)) + '°)');

  // EL GESTO VERTICAL. Ojo con lo que se puede pedir: el arrastre vertical gira
  // sobre la PERPENDICULAR al eje propio (el análogo de la elevación), así que lo
  // invariante ahí es el CENTRO de la pieza, no su recta entera — igual que en el
  // giro normal lo invariante es el pivote y no el eje vertical del mundo.
  const centro = { x: 0, y: 15, z: 12 };
  const wV = sesion(), TV = wV.TemplateEditor; montar(TV, BARRA);
  const vCtrl = arrastrar(TV, 30, 0, 4, true, [centro, testigo]);
  const wV2 = sesion(), TV2 = wV2.TemplateEditor; montar(TV2, BARRA);
  const vNorm = arrastrar(TV2, 30, 0, 4, false, [centro, testigo]);
  ok(vCtrl[0] < 1e-6, 'el arrastre VERTICAL con ctrl clava el centro de la pieza (' + f6(vCtrl[0]) + ' px)');
  const vSep = dist2(proyectar(TV, testigo), proyectar(TV2, testigo));
  ok(vSep > 50, 'y no es el mismo gesto que sin ctrl: el testigo termina a ' + f1(vSep) + ' px de distancia entre los dos modos');

  // sin selección, ctrl no puede inventar un eje: gira la escena y lo dice
  const wS = sesion(), TS = wS.TemplateEditor; montar(TS, []);
  ok(TS._girarPorArrastre(4, 0, true) === 'mundo', 'ctrl sin pieza que agarrar cae al giro de la escena (y el handler avisa)');
  const wP = sesion(), TP = wP.TemplateEditor; montar(TP, BARRA);
  ok(TP._girarPorArrastre(4, 0, true) === 'pieza', 'con pieza seleccionada, ctrl gira sobre su eje');
}

// ================================================================ C4
console.log('\nC4 — el giro con ctrl PASA POR EL CENIT sin trabarse (el modelo viejo no podía)');
{
  const wC = sesion(), TC = wC.TemplateEditor; montar(TC, BARRA);
  // Mirando la viga DE FRENTE (acimut 0), la vista es perpendicular al eje de la
  // barra: girar sobre ese eje pasa exactamente por el cenit. No es un caso raro —es
  // la vista más natural de una viga—, y es justo donde el modelo viejo se moría: la
  // base se degeneraba (|derecha| = cos(elev) → 0) y el arrastre quedaba trabado.
  TC._st.quat = TC._quatDeAngulos(0.2, 0);
  const sobreEje = [{ x: -250, y: 15, z: 12 }, { x: 250, y: 15, z: 12 }];
  const p0 = sobreEje.map((P) => proyectar(TC, P));
  let peor = 0, elevMax = -90, vueltas = 0, elevAnt = elevGrados(TC);
  for (let i = 0; i < 200; i++) {                       // 200 × 4 px × 0,008 = 6,4 rad
    TC._girarPorArrastre(4, 0, true);
    sobreEje.forEach((P, k) => { const d = dist2(proyectar(TC, P), p0[k]); if (d > peor) peor = d; });
    const el = elevGrados(TC);
    if (Math.abs(el) > elevMax) elevMax = Math.abs(el);
    if (elevAnt > 80 && el < elevAnt) vueltas++;        // pasó por arriba y siguió bajando
    elevAnt = el;
  }
  ok(elevMax > 83, 'la cámara pasa POR ENCIMA del tope viejo de 83° (llega a ' + f1(elevMax) + '°)');
  ok(vueltas > 0, 'y sigue de largo: cruza el cenit y baja por el otro lado');
  ok(peor < 1e-6, 'la rigidez aguanta la vuelta entera: la pieza no se mueve ni ' + f6(peor) + ' px');
}

// ================================================================ C5
console.log('\nC5 — lo que ya funcionaba sigue igual (pivotar, absorber el pan, panear)');
{
  const w = sesion(), TE = w.TemplateEditor; montar(TE, BARRA);
  const testigos = [{ x: 0, y: 0, z: 0 }, { x: 250, y: 15, z: 12 }, { x: -100, y: 40, z: -60 }];

  // pivotar sin mover: cambia el pivote y no mueve un píxel
  TE.__p = testigos.map((P) => proyectar(TE, P));
  ok(TE._pivotarEnSinMover(new THREE.Vector3(250, 15, 12)) === true, '_pivotarEnSinMover acepta un punto de la pieza');
  let peor = Math.max.apply(Math, testigos.map((P, k) => dist2(proyectar(TE, P), TE.__p[k])));
  ok(peor < 1e-9, 'y no mueve la imagen: ' + f6(peor) + ' px');
  ok(Math.abs(TE._st.target.x - 250) < 1e-9, 'el pivote quedó en la pieza');

  // pan + absorber: tampoco mueve la imagen, y AHORA tampoco endereza el horizonte
  const wR = sesion(), TR = wR.TemplateEditor; montar(TR, BARRA);
  arrastrar(TR, 20, 4, 0, true, []);                    // deja alabeo
  const alab = alabeoGrados(TR);
  TR._st.panX -= 30 * TR._st.dist * 0.0011; TR._st.panY += 12 * TR._st.dist * 0.0011;
  const antes = testigos.map((P) => proyectar(TR, P));
  TR._absorberPanEnTarget();
  peor = Math.max.apply(Math, testigos.map((P, k) => dist2(proyectar(TR, P), antes[k])));
  ok(peor < 1e-9, 'absorber el pan en el pivote es invisible (' + f6(peor) + ' px) también con el horizonte inclinado');
  ok(Math.abs(TR._st.panX) < 1e-9 && Math.abs(TR._st.panY) < 1e-9, 'y deja el pan en cero');
  ok(Math.abs(alabeoGrados(TR) - alab) < 1e-9, 'el alabeo SOBREVIVE al pan (' + f1(alab) + '° antes y después): no endereza solo');

  // EL PAN SIGUE SIENDO EN EL PLANO DE PANTALLA aunque la cámara esté alabeada: lo
  // que se mide es que el movimiento sea PURAMENTE HORIZONTAL (componente vertical
  // cero). La ganancia no es 1:1 y nunca lo fue —40 px de arrastre son 40·dist·0,0011
  // = 39,6 cm y a 900 de distancia con este lente eso son ~59 px de pantalla—; acá
  // sólo interesa que el alabeo no le tuerza la dirección.
  const P = { x: 0, y: 0, z: 0 };
  const a0 = proyectar(TR, P);
  TR._st.panX -= 40 * TR._st.dist * 0.0011;             // arrastre de 40 px a la derecha
  const a1 = proyectar(TR, P);
  ok(Math.abs(a1.py - a0.py) < 1e-6 && (a1.px - a0.px) > 1,
    'panear con el horizonte a 44° mueve la imagen en HORIZONTAL pura (' + f1(a1.px - a0.px) + ' px, vertical ' + f6(a1.py - a0.py) + ' px)');

  // EL ZOOM AL CURSOR sigue clavando el punto bajo el cursor CON LA CÁMARA ALABEADA:
  // ese zoom corrige el pan, y el pan vive en la base de la cámara, que ahora rota
  // con el alabeo. Si el zoom no se enterara del alabeo, la imagen derivaría en cada
  // rueda después de un giro con ctrl.
  {
    const fx = 0.78, fy = 0.24, aspect = W / H;
    const b = TR._baseCam(), ojo = TR._ojoCam(b);
    const halfH = TR._st.dist * Math.tan(TR.FOV3D * Math.PI / 360), halfW = halfH * aspect;
    const bajoCursor = ojo.clone()
      .addScaledVector(b.atras, -TR._st.dist)
      .addScaledVector(b.derecha, (fx * 2 - 1) * halfW)
      .addScaledVector(b.arriba, -(fy * 2 - 1) * halfH);
    const antesZ = proyectar(TR, bajoCursor);
    TR._zoomAlCursor(0.8, fx, fy, aspect);
    const dZ = dist2(proyectar(TR, bajoCursor), antesZ);
    ok(dZ < 1e-6, 'el punto bajo el cursor queda clavado al hacer zoom con el horizonte inclinado (' + f6(dZ) + ' px)');
  }

  // EL RADIAL DE EJE sigue restringiendo el gesto EN LOS DOS MODOS. Con 'z' sólo pasa
  // el acimut: el arrastre vertical no mueve nada y el horizontal sí, también con ctrl
  // (ahí el "acimut" es el giro sobre el eje de la pieza).
  const wE = sesion(), TEj = wE.TemplateEditor; montar(TEj, BARRA);
  TEj._st.ejeRot = 'z';
  const e0 = elevGrados(TEj);
  TEj._girarPorArrastre(0, 30, false);
  ok(Math.abs(elevGrados(TEj) - e0) < 1e-9, 'con el eje Z fijado, el arrastre vertical no cambia la elevación');
  ok(TEj._girarPorArrastre(0, 30, true) === null, 'y con ctrl el arrastre vertical tampoco aplica nada');
  const ejeBarra = [{ x: -250, y: 15, z: 12 }, { x: 250, y: 15, z: 12 }];
  const antesEje = ejeBarra.map((P) => proyectar(TEj, P));
  ok(TEj._girarPorArrastre(30, 0, true) === 'pieza', 'pero el HORIZONTAL con ctrl sí gira sobre el eje de la pieza');
  peor = Math.max.apply(Math, ejeBarra.map((P, k) => dist2(proyectar(TEj, P), antesEje[k])));
  ok(peor < 1e-6, 'y con el eje Z fijado sigue siendo rígido sobre la pieza (' + f6(peor) + ' px)');
}

// ================================================================ C6
console.log('\nC6 — con la GEOMETRÍA REAL de la semilla (lo que el usuario tiene al abrir)');
{
  const w = sesion(), TE = w.TemplateEditor;
  const receta = w.ModeladorSemilla.semillaViga();
  const out = w.ModeladorGenerar.generarElemento(receta);
  ok(out.placements.length > 50, 'la semilla genera ' + out.placements.length + ' colocaciones reales');

  // Con la RECETA puesta, el eje se decide como en el editor de verdad: preguntándole
  // al catálogo si la figura es contorno cerrado (_piezaEsPlana), no adivinando por la
  // forma de la nube.
  const ejeDe = (ci) => { montar(TE, out.placements, ci); TE._st.receta = receta; return TE._ejePropioSeleccion3D(); };
  const esperado = { 0: 'x', 1: 'x', 2: 'x', 3: 'y' };   // CBS · CBI · ES(estribo) · TRV(traba)
  const nombre = { 0: 'CBS (barra sup. doblada, 103B)', 1: 'CBI (barra inf. recta)', 2: 'ES (estribo 104D)', 3: 'TRV (traba vertical)' };
  Object.keys(esperado).forEach((k) => {
    const u = ejeDe(Number(k));
    const dom = (Math.abs(u.x) >= Math.abs(u.y) && Math.abs(u.x) >= Math.abs(u.z)) ? 'x' : (Math.abs(u.y) >= Math.abs(u.z) ? 'y' : 'z');
    ok(dom === esperado[k], nombre[k] + ' → eje ' + dom + ' (' + [f6(u.x), f6(u.y), f6(u.z)].join(', ') + ')');
  });

  // EL MODO QUE SE ANUNCIA es distinto para la traba: su eje es vertical y eso hace
  // que el giro se vea casi igual que el normal. El editor lo DICE en vez de fingir
  // (ver el mensaje de _bindOrbita), y acá se congela que lo distingue.
  const modoDe = (ci) => { montar(TE, out.placements, ci); TE._st.receta = receta; return TE._girarPorArrastre(4, 0, true); };
  ok(modoDe(0) === 'pieza' && modoDe(2) === 'pieza', 'barra y estribo → modo "pieza" (el giro se nota)');
  ok(modoDe(3) === 'pieza-vertical', 'traba de pie → modo "pieza-vertical" (el editor avisa que se verá parecido)');

  // EL CASO REAL: el estribo (la pieza que más se mira en una viga). Su eje propio es
  // el del reparto, horizontal, así que el ctrl se nota de inmediato.
  const wC = sesion(), TC = wC.TemplateEditor; montar(TC, out.placements, 2);
  const c = TC._centroSeleccion3D(), u = TC._ejePropioSeleccion3D();
  const sobreEje = [-200, 200].map((t) => ({ x: c.x + u.x * t, y: c.y + u.y * t, z: c.z + u.z * t }));
  const testigo = { x: 0, y: -150, z: 200 };
  const mCtrl = arrastrar(TC, 60, 4, 0, true, sobreEje.concat([testigo]));
  const wN = sesion(), TN = wN.TemplateEditor; montar(TN, out.placements, 2);
  const mNorm = arrastrar(TN, 60, 4, 0, false, sobreEje.concat([testigo]));
  ok(mCtrl[0] < 1e-6 && mCtrl[1] < 1e-6,
    'estribo real: con ctrl su eje queda clavado (' + f6(mCtrl[0]) + ' / ' + f6(mCtrl[1]) + ' px)');
  ok(mNorm[0] > 100 && mNorm[1] > 100,
    'y sin ctrl se va (' + f1(mNorm[0]) + ' / ' + f1(mNorm[1]) + ' px)');
  const sep = dist2(proyectar(TC, testigo), proyectar(TN, testigo));
  ok(sep > 200, 'la escena termina ' + f1(sep) + ' px distinta entre los dos modos');
}

// ================================================================ C7
console.log('\nC7 — BARRIDO: los dos modos no se parecen en ninguna combinación razonable');
{
  // 4 piezas reales × 4 poses de cámara × 3 gestos = 48 escenarios. Se mide la
  // separación máxima entre las dos imágenes tras el MISMO arrastre. Congela el
  // contrato de verdad —"no se confunden"— y también su ÚNICA excepción conocida.
  const wA = sesion(), A = wA.TemplateEditor;
  const wB = sesion(), B = wB.TemplateEditor;
  const out = wA.ModeladorGenerar.generarElemento(wA.ModeladorSemilla.semillaViga());
  const POSES = [[0.55, 0.9], [0.2, 0.0], [0.9, 2.4], [-0.3, 1.6]];
  const GESTOS = [[4, 0], [0, 4], [3, 3]];
  const testigos = [{ x: 0, y: 0, z: 0 }, { x: 280, y: 28, z: 14 }, { x: -280, y: -28, z: -14 }, { x: 0, y: 30, z: 0 }];
  const nombre = ['CBS', 'CBI', 'ES', 'TRV'];
  const minPorPieza = [Infinity, Infinity, Infinity, Infinity];
  for (let ci = 0; ci < 4; ci++) {
    for (const pose of POSES) {
      for (const g of GESTOS) {
        montar(A, out.placements, ci, pose); montar(B, out.placements, ci, pose);
        for (let i = 0; i < 40; i++) { A._girarPorArrastre(g[0], g[1], true); B._girarPorArrastre(g[0], g[1], false); }
        const sep = Math.max.apply(Math, testigos
          .map((P) => dist2(proyectar(A, P), proyectar(B, P))).filter((n) => isFinite(n)));
        if (sep < minPorPieza[ci]) minPorPieza[ci] = sep;
      }
    }
  }
  [0, 1, 2].forEach((ci) => {
    ok(minPorPieza[ci] > 100, nombre[ci] + ': en los 12 escenarios los dos modos se separan al menos ' +
      f1(minPorPieza[ci]) + ' px');
  });
  // LA EXCEPCIÓN, congelada a propósito: la traba es VERTICAL, o sea que su eje propio
  // es casi el mismo que el del giro normal y sólo queda de diferencia el pivote.
  // Si algún día se le da un eje distinto (o se le agrega el desplazamiento del
  // pivote), este número sube y hay que venir a mirarlo — no es un fallo, es el aviso.
  ok(minPorPieza[3] < 100 && minPorPieza[3] > 5,
    'TRV (traba vertical) es el caso débil conocido: baja hasta ' + f1(minPorPieza[3]) + ' px');
}

// ================================================================ C8
console.log('\nC8 — la pieza PEGADA AL OJO no se agarra: se gira la escena, pero no se salta');
{
  // Con la cámara muy cerca (dist 40) y la pieza 30 cm por delante del pivote, el
  // plano de la pieza cae a 10 cm del ojo — por debajo del mínimo de la cámara (15).
  // Recortar ahí (lo que hacía _clampDist) reconstruía OTRO ojo y la imagen saltaba
  // 152 px de golpe. Ahora ese pivote se rechaza y el gesto cae al giro normal.
  const w = sesion(), TE = w.TemplateEditor;
  montar(TE, BARRA);
  TE._st.dist = 25;
  // pieza pequeña puesta 10 cm DELANTE del pivote, sobre el eje de vista: su plano
  // queda a 25 − 10 = 15… justo en el límite; a 12 cm queda a 13, por debajo.
  const b = TE._baseCam();
  const c = { x: b.atras.x * 12, y: b.atras.y * 12, z: b.atras.z * 12 };
  const cerca = [{ meta: { ci: 0 }, puntos: [{ x: c.x - 4, y: c.y, z: c.z }, { x: c.x + 4, y: c.y, z: c.z }] }];
  TE._st.ultimoOut = { placements: cerca };
  const pivote = { x: 0, y: 0, z: 0 };
  const antes = proyectar(TE, pivote);
  const modo = TE._girarPorArrastre(1, 0, true);
  ok(modo === 'mundo', 'ctrl sobre una pieza pegada al ojo cae al giro de la escena (modo=' + modo + ')');
  ok(Math.abs(TE._st.dist - 25) < 1e-9, 'y NO se reescribe la distancia (dist=' + f1(TE._st.dist) + ')');
  // el giro normal mueve la escena, claro; lo que se mide es que no hubo SALTO: el
  // pivote sigue clavado, que es justo lo que el clamp rompía (152 px de tirón).
  ok(dist2(proyectar(TE, pivote), antes) < 1e-9,
    'el pivote sigue clavado: no hubo tirón (' + f6(dist2(proyectar(TE, pivote), antes)) + ' px)');
  // y con la cámara a distancia normal esa MISMA pieza sí se agarra
  const w2 = sesion(), T2 = w2.TemplateEditor;
  montar(T2, cerca);
  ok(T2._girarPorArrastre(1, 0, true) === 'pieza', 'a distancia normal esa misma pieza sí se agarra');
}

// ================================================================ C9
console.log('\nC9 — el arrastre normal ENDEREZA el horizonte que dejó el ctrl');
{
  // Deja la cámara torcida Y con el pivote descentrado (que es como queda de verdad
  // tras un ctrl sobre una pieza que no está al medio): así se ve si el enderezado
  // sólo destuerce o además arrastra la imagen.
  // (el pan de 200 cm es el que hace visible el defecto: con el pivote al centro el
  // enderezado mal hecho tampoco se notaba)
  const torcida = (TE) => { montar(TE, BARRA); TE._st.panX = 200; TE._st.panY = -80; arrastrar(TE, 30, 4, 0, true, []); };
  const w = sesion(), TE = w.TemplateEditor;
  torcida(TE);
  const alab0 = alabeoGrados(TE);
  ok(alab0 > 10, 'tras el ctrl el horizonte quedó a ' + f1(alab0) + '°');

  // EL PRIMER PÍXEL NO DA UN TIRÓN. Se compara contra el MISMO arrastre sin alabeo:
  // si el enderezado empujara la imagen, este número se dispararía (medido con el
  // enderezado girando sobre el pivote: 32 px contra 3).
  const centro = () => { const b = TE._baseCam(); return new V3().copy(TE._ojoCam(b)).addScaledVector(b.atras, -TE._st.dist); };
  const P = centro(), antes = proyectar(TE, P);
  TE._girarPorArrastre(1, 0, false);
  const salto = dist2(proyectar(TE, P), antes);
  // la MISMA cámara pero a nivel (mismo pivote descentrado: lo único que cambia es el
  // alabeo, así que la diferencia entre los dos números es lo que aporta el enderezado)
  const wL = sesion(), TL = wL.TemplateEditor; montar(TL, BARRA);
  TL._st.dist = TE._st.dist; TL._st.panX = TE._st.panX; TL._st.panY = TE._st.panY;
  const PL = (() => { const b = TL._baseCam(); return new V3().copy(TL._ojoCam(b)).addScaledVector(b.atras, -TL._st.dist); })();
  const antesL = proyectar(TL, PL);
  TL._girarPorArrastre(1, 0, false);
  const saltoL = dist2(proyectar(TL, PL), antesL);
  ok(salto < saltoL * 1.5 + 0.5,
    'el primer píxel con el horizonte torcido mueve ' + f1(salto) + ' px, igual que sin torcer (' + f1(saltoL) + ' px): no hay tirón');

  // MISMO GESTO, MISMO RESULTADO: cobrar por PÍXEL y no por evento. 60 px partidos en
  // 60, en 6 o en 1 evento tienen que dejar el mismo alabeo (antes: 2,4% / 69% / 94%).
  const restante = (pasos, dxx) => { const t = sesion().TemplateEditor; torcida(t); const a = alabeoGrados(t); arrastrar(t, pasos, dxx, 0, false, []); return alabeoGrados(t) / a; };
  const r60 = restante(60, 1), r6 = restante(6, 10), r1 = restante(1, 60);
  ok(Math.abs(r60 - r1) < 0.02 && Math.abs(r60 - r6) < 0.02,
    '60 px dejan el mismo alabeo se partan como se partan: ' + f1(r60 * 100) + '% / ' + f1(r6 * 100) + '% / ' + f1(r1 * 100) + '%');
  ok(r60 < 0.05, 'y ese mismo recorrido de 60 px deja menos del 5% (' + f1(r60 * 100) + '%)');
  ok(restante(1, 10) > 0.4 && restante(1, 10) < 0.7,
    'con 10 px sólo se corrige el ' + f1((1 - restante(1, 10)) * 100) + '%: es progresivo, no un salto');

  // NO TOCA EL ENCUADRE (a diferencia del ⟳, que reencuadra entero)
  const w3 = sesion(), T3 = w3.TemplateEditor; torcida(T3);
  const d0 = T3._st.dist;
  arrastrar(T3, 60, 2, 0, false, []);
  ok(Math.abs(T3._st.dist - d0) < 1e-9, 'la distancia no se mueve (' + f1(T3._st.dist) + ')');
  ok(alabeoGrados(T3) < 1, 'y el horizonte queda a nivel (' + f1(alabeoGrados(T3)) + '°)');

  // EL OJO NO SE MUEVE al destorcer (es lo que separa "rotar la imagen" de
  // "arrastrarla"), y `dist` no se toca NI UN BIT: recalcularla con un producto punto
  // perdía 2,2e-12 y con la cámara en el mínimo exacto (dist 15, donde deja el clamp
  // de la rueda) el enderezado se apagaba en silencio para siempre.
  const w5 = sesion(), T5 = w5.TemplateEditor; torcida(T5);
  T5._st.dist = 15;                                    // el mínimo EXACTO
  const ojoAntes = T5._ojoCam(), alabMin0 = alabeoGrados(T5);
  T5._girarPorArrastre(2, 0, false);
  const dOjo = Math.hypot(T5._ojoCam().x - ojoAntes.x, T5._ojoCam().y - ojoAntes.y, T5._ojoCam().z - ojoAntes.z);
  ok(Math.abs(T5._st.dist - 15) < 1e-9, 'a dist 15 exacto la distancia se queda en 15 (' + T5._st.dist + ')');
  ok(alabeoGrados(T5) < alabMin0 - 5, 'y ahí SÍ gira y SÍ endereza (' + f1(alabMin0) + '° → ' + f1(alabeoGrados(T5)) + '°)');
  ok(dOjo > 1e-6, 'el arrastre movió el ojo, o sea que el giro no quedó rechazado en el borde (' + f6(dOjo) + ' cm)');
  // EL CONTRATO DEL ENDEREZADO, medido solo (sin el giro encima): destuerce sin mover
  // el ojo ni un micrón y sin tocar dist. Es lo que lo separa de "arrastrar la imagen".
  const w6 = sesion(), T6 = w6.TemplateEditor; torcida(T6);
  const ojo6 = T6._ojoCam(), dist6 = T6._st.dist, alab6 = alabeoGrados(T6);
  T6._enderezarHorizonte(20);
  const mov6 = Math.hypot(T6._ojoCam().x - ojo6.x, T6._ojoCam().y - ojo6.y, T6._ojoCam().z - ojo6.z);
  ok(mov6 < 1e-9, 'enderezar NO mueve el ojo (' + f6(mov6) + ' cm)');
  ok(T6._st.dist === dist6, 'ni toca la distancia (sigue en ' + f1(T6._st.dist) + ', bit a bit)');
  ok(alabeoGrados(T6) < alab6 * 0.35, 'y sí destuerce: ' + f1(alab6) + '° → ' + f1(alabeoGrados(T6)) + '° con 20 px');

  // NO SE COBRAN LOS PÍXELES QUE NO GIRAN NADA. Dos sitios donde el gesto se
  // descarta: el radial de eje y el tope de elevación. Contra el tope, un arrastre
  // vertical giraba la vista 0,66° y borraba el alabeo entero.
  const wZ = sesion(), TZ = wZ.TemplateEditor; torcida(TZ);
  TZ._st.ejeRot = 'z';
  const az0 = alabeoGrados(TZ);
  arrastrar(TZ, 12, 0, 50, false, []);                  // 600 px verticales, todos descartados
  ok(Math.abs(alabeoGrados(TZ) - az0) < 1e-9, 'con el eje Z fijado, 600 px verticales no tocan el alabeo (' + f1(alabeoGrados(TZ)) + '°)');
  const wT = sesion(), TT = wT.TemplateEditor; torcida(TT);
  arrastrar(TT, 60, 0, 8, false, []);                   // sube hasta el tope de elevación
  const at0 = alabeoGrados(TT);
  arrastrar(TT, 12, 0, 50, false, []);                  // ya topado: 600 px que no giran nada
  ok(Math.abs(alabeoGrados(TT) - at0) < 0.5, 'contra el tope de elevación tampoco (' + f1(at0) + '° → ' + f1(alabeoGrados(TT)) + '°)');

  // LA CÁMARA VOLCADA también vuelve (era el caso que 500 pasos no arreglaban)
  const w4 = sesion(), T4 = w4.TemplateEditor; montar(T4, BARRA);
  arrastrar(T4, 60, 4, 0, true, []);
  ok(T4._baseCam().arriba.y < 0, 'un ctrl largo deja la cámara dada vuelta (arriba.y=' + f6(T4._baseCam().arriba.y) + ')');
  arrastrar(T4, 40, 2, 0, false, []);
  ok(alabeoGrados(T4) < 5, 'y 80 px de arrastre normal la enderezan (' + f1(alabeoGrados(T4)) + '°)');
}

console.log('\n' + (fallos ? '✗ ' + fallos + ' fallo(s)' : '✓ todo verde'));
process.exit(fallos ? 1 : 0);
