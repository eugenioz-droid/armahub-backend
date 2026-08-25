// Test headless (Node) de la CÁMARA DEL CUADRANTE 3D del Template Editor:
// EL PUNTO ALREDEDOR DEL QUE GIRA, que es lo único que separa el arrastre normal del
// ctrl+arrastre.
//
// POR QUÉ EXISTE. El ctrl+arrastre lleva seis vueltas. Las cuatro primeras movían el
// pivote a la PIEZA y "no se notaban": el absorbedor de pan dejaba el pivote normal en
// el centro de la pantalla, que es justo donde uno tiene la pieza, así que los dos
// gestos diferían 12,7 px en todo el arrastre. La quinta cambió el EJE —giraba sobre el
// eje propio de la barra, como un asador— y ESO NUNCA FUE LO PEDIDO: «no quiero que
// CTRL gire sobre el eje propio de la pieza seleccionada». Esta, la sexta, hace lo que
// hacen Revit y Tekla: el MISMO giro de siempre, alrededor de OTRO PUNTO.
//   · sin ctrl → el centro del elemento de hormigón (fijo, del modelo).
//   · con ctrl → el punto de la geometría que el usuario está señalando.
// Este archivo CONGELA con números que los dos modos son distintos —también con la
// pieza centrada, que es donde las cuatro primeras vueltas colapsaban— y que el punto
// señalado queda CLAVADO.
//
// CONTRATOS QUE FIJA:
//   C0 · El modelo (quaternion) reproduce EXACTAMENTE la base vieja (rotX/rotY + el
//        arriba del mundo) en el punto de partida.
//   C1 · La órbita normal NO cambió: 60 pasos de arrastre dejan el ojo donde lo dejaba
//        `rotY += dAz; rotX += dEl` (1e-9), con el mismo tope de elevación, y siempre
//        gira alrededor del CENTRO DEL ELEMENTO.
//   C2 · EL PUNTO BAJO EL CURSOR: cae en el EJE de la barra señalada, la barra le gana
//        al hormigón translúcido, la de adelante le gana a la de atrás, la holgura de
//        agarre son 10 px, y sin nada bajo el cursor devuelve null (y el pivote cae a
//        la selección, y de ahí al elemento).
//   C3 · LOS DOS MODOS SON DISTINTOS, CON LA PIEZA CENTRADA: el punto señalado queda a
//        0,000000 px con ctrl y se va cientos de píxeles sin él.
//   C4 · SIN ABSORBEDOR: después de panear lejos, el giro normal sigue orbitando el
//        centro del elemento (que queda clavado) y no se descontrola. Con números del
//        antes/después, incluido el caso feo (zoom a un detalle) y su remedio.
//   C5 · Lo que ya funcionaba sigue igual: pivotar sin mover, panear en el plano de
//        pantalla, el zoom al cursor y el radial de eje EN LOS DOS MODOS.
//   C6 · Con la GEOMETRÍA REAL de la semilla de viga: se puede señalar un estribo del
//        montón y ese punto queda clavado.
//   C7 · EL HORIZONTE NUNCA SE INCLINA (lo inclinaba el asador; ahora el eje de acimut
//        es siempre la vertical del mundo). Barrido de 48 escenarios.
//   C8 · Se acepta CUALQUIER pivote delante del ojo (también más cerca que el mínimo de
//        la cámara: es el caso del máximo acercamiento); sólo se rechaza lo imposible
//        —detrás del ojo o lejísimos—, y ahí el gesto cae al centro de la pantalla en
//        vez de morirse o de pegar un tirón. C8b: el eje del giro va normalizado.
//   C9 · EL PIVOTE DIBUJADO: la proyección con la que se pinta el punto rosado es la
//        inversa exacta del rayo del cursor, y durante el gesto el punto no se mueve.
//
// Corre el template_editor.js REAL sobre un mini-DOM y un THREE de mentira (three viene
// de CDN y en Node no está; acá sólo hacen falta Vector3, Quaternion y una cámara con
// posición y orientación). Correr con: node tests/test_camara_ctrl.js

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
// Hormigón de una viga que envuelve a la BARRA de prueba (el elemento del que el giro
// normal toma su centro: la caja va CENTRADA EN EL ORIGEN, como en el editor real).
const GEO = { largo: 640, alto: 60, ancho: 30 };

// Una pieza = una lista de colocaciones (las copias de una distribución).
// `pose` = [elevación, acimut] para mirar desde otro lado (por omisión, la de arranque).
// `geo`  = geometría del hormigón (null = sin hormigón: el centro del elemento cae a la
//          caja de las barras, que es lo que pasa en un editor recién abierto).
function montar(TE, piezas, ci, pose, geo) {
  const ST = TE._st;
  ST.camera = new CamaraFalsa();
  ST.target = new V3(0, 0, 0);
  // null = punto de partida (CAM0), como al abrir el editor
  ST.quat = pose ? TE._quatDeAngulos(pose[0], pose[1]) : null;
  ST.dist = 900; ST.panX = 0; ST.panY = 0;
  ST.ejeRot = 'libre';
  ST.verHormigon = true;
  ST.ultimoOut = { placements: piezas };
  ST.receta = (geo === undefined ? { geometria: GEO, componentes: [] } : (geo ? { geometria: geo, componentes: [] } : null));
  ST.selCi = (ci === undefined ? 0 : ci);
}

// PROYECCIÓN a píxeles con la MISMA cámara que arma _applyCam (base del quaternion,
// ojo de la parametrización) y el MISMO lente (FOV3D). Es la regla con la que se miden
// los "0,000000 px": si un punto se ve donde se veía, no se movió en pantalla.
// Está escrita ACÁ y no se le pide al editor a propósito: es la medida INDEPENDIENTE
// contra la que se compara la del editor (_proyectarEnCuadrante, C9).
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

// "El usuario apunta a P": devuelve el pivote que resolvería el editor con el cursor
// puesto sobre la proyección de P.
function señalar(TE, P) {
  const s = proyectar(TE, P);
  if (!s) return null;
  return TE._pivoteDelCursor(s.px / W, s.py / H, W, H);
}
function puntoBajo(TE, P, dpx, dpy) {
  const s = proyectar(TE, P);
  if (!s) return null;
  return TE._puntoBajoCursor3D((s.px + (dpx || 0)) / W, (s.py + (dpy || 0)) / H, W, H);
}

// Un arrastre completo: `pasos` movimientos de (dx, dy) píxeles alrededor de `pivote`
// (null = el que elige el editor solo, o sea el centro del elemento).
// Devuelve el máximo desplazamiento en pantalla de cada punto vigilado.
function arrastrar(TE, pasos, dx, dy, pivote, vigilados) {
  const p0 = (vigilados || []).map((P) => proyectar(TE, P));
  const maxs = (vigilados || []).map(() => 0);
  for (let i = 0; i < pasos; i++) {
    TE._girarPorArrastre(dx, dy, pivote || null);
    (vigilados || []).forEach((P, k) => {
      const d = dist2(proyectar(TE, P), p0[k]);
      if (d > maxs[k]) maxs[k] = d;
    });
  }
  return maxs;
}

// Distancia (cm) de un punto al eje de barra más cercano de TODA la escena. Sirve para
// comprobar que el punto agarrado sale de la geometría de verdad y no de una cuenta.
function distAGeometria(out, P) {
  let mejor = Infinity;
  (out.placements || []).forEach((pl) => {
    const pts = pl.puntos || [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const A = pts[i], B = pts[i + 1];
      const vx = B.x - A.x, vy = B.y - A.y, vz = B.z - A.z;
      const c = vx * vx + vy * vy + vz * vz;
      let s = c > 1e-12 ? ((P.x - A.x) * vx + (P.y - A.y) * vy + (P.z - A.z) * vz) / c : 0;
      s = Math.max(0, Math.min(1, s));
      const d = Math.hypot(A.x + vx * s - P.x, A.y + vy * s - P.y, A.z + vz * s - P.z);
      if (d < mejor) mejor = d;
    }
  });
  return mejor;
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
const BARRA = [{ meta: { ci: 0 }, diam: 1.6, puntos: [
  { x: -300, y: 5, z: 12 }, { x: -300, y: 25, z: 12 },
  { x: 300, y: 25, z: 12 }, { x: 300, y: 5, z: 12 }
] }];
// Estribo 60×30 en el plano y-z (el de una viga).
function estribo(x) {
  return { meta: { ci: 0 }, diam: 0.8, puntos: [
    { x: x, y: -30, z: -15 }, { x: x, y: 30, z: -15 },
    { x: x, y: 30, z: 15 }, { x: x, y: -30, z: 15 }, { x: x, y: -30, z: -15 }
  ] };
}

console.log('== CÁMARA DEL 3D · el punto alrededor del que gira ==\n');

// ================================================================ C0
console.log('C0 — el modelo (quaternion) reproduce la base vieja (rotX/rotY)');
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
  const ojo = TE._ojoCam();
  ok(Math.abs(ojo.x - 900 * atras0.x) < 1e-9 && Math.abs(ojo.y - 900 * atras0.y) < 1e-9,
    'el ojo sale de target + dist·atrás, como antes');
}

// ================================================================ C1
console.log('\nC1 — la órbita NORMAL no cambió, y su centro es el CENTRO DEL ELEMENTO');
{
  const w = sesion(), TE = w.TemplateEditor;
  montar(TE, BARRA);
  const c0 = TE._centroElemento3D();
  ok(Math.abs(c0.x) < 1e-12 && Math.abs(c0.y) < 1e-12 && Math.abs(c0.z) < 1e-12,
    'con hormigón, el centro del elemento es el origen (la caja se arma centrada ahí)');
  // sin hormigón cae a la caja de las barras: la BARRA vive en y=5..25, z=12
  const wS = sesion(), TS = wS.TemplateEditor; montar(TS, BARRA, 0, null, null);
  const cS = TS._centroElemento3D();
  ok(Math.abs(cS.x) < 1e-9 && Math.abs(cS.y - 15) < 1e-9 && Math.abs(cS.z - 12) < 1e-9,
    'sin hormigón todavía, el centro sale de la caja de las barras (' + [f1(cS.x), f1(cS.y), f1(cS.z)].join(', ') + ')');

  const k = 0.008, dx = 3, dy = 2, pasos = 60;
  let rotX = TE.CAM0.elev, rotY = TE.CAM0.azim;
  for (let i = 0; i < pasos; i++) {
    TE._girarPorArrastre(dx, dy, null);
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
  ok(Math.abs(elevGrados(TE) - 1.45 * 180 / Math.PI) < 1e-6, 'la cámara queda EXACTAMENTE en el tope de 1,45 rad, sin pasarse');

  const w2 = sesion(), T2 = w2.TemplateEditor;
  montar(T2, BARRA);
  const t0 = proyectar(T2, { x: 0, y: 0, z: 0 });
  const maxT = arrastrar(T2, 60, 3, 2, null, [{ x: 0, y: 0, z: 0 }])[0];
  ok(maxT < 1e-9, 'el centro del elemento queda CLAVADO en pantalla durante toda la órbita (' + f6(maxT) + ' px)');
  ok(t0 && Math.abs(t0.px - 400) < 1e-9, 'y sin panear está donde tiene que estar: el centro del cuadrante');
}

// ================================================================ C2
console.log('\nC2 — EL PUNTO BAJO EL CURSOR (el pivote del ctrl)');
{
  const w = sesion(), TE = w.TemplateEditor;
  montar(TE, BARRA);
  // apuntar EXACTAMENTE a un punto del eje de la barra devuelve ESE punto: el rayo lo
  // atraviesa, así que el acercamiento rayo↔segmento es él mismo.
  const P = { x: 120, y: 25, z: 12 };
  const h = puntoBajo(TE, P);
  ok(!!h && h.tipo === 'barra', 'apuntando a una barra, el pivote sale de la BARRA (tipo=' + (h && h.tipo) + ')');
  ok(!!h && Math.hypot(h.x - P.x, h.y - P.y, h.z - P.z) < 1e-6,
    'y cae EN SU EJE, en el punto señalado (Δ=' + f6(h ? Math.hypot(h.x - P.x, h.y - P.y, h.z - P.z) : -1) + ' cm)');
  // ida y vuelta: el punto elegido se proyecta donde estaba el cursor
  const sc = proyectar(TE, P), sh = proyectar(TE, h);
  ok(dist2(sc, sh) < 1e-6, 'ida y vuelta: el punto elegido se proyecta EN el píxel del cursor (' + f6(dist2(sc, sh)) + ' px)');

  // EL HORMIGÓN PIERDE aunque su cara esté DELANTE: la caja es translúcida y su cara
  // frontal pasa 15 cm por delante de las barras de esta viga.
  const rayo = TE._rayoDesdeCursor(sc.px / W, sc.py / H, W / H);
  const caja = TE._cortarCajaConRayo(rayo, GEO);
  const profBarra = -new V3(h.x - TE._ojoCam().x, h.y - TE._ojoCam().y, h.z - TE._ojoCam().z).dot(TE._baseCam().atras);
  ok(!!caja && caja.prof < profBarra,
    'la cara del hormigón está ' + f1(profBarra - caja.prof) + ' cm DELANTE de la barra, y aun así gana la barra');

  // EL HORMIGÓN YA NO SE SEÑALA (19-ago, decisión del usuario: «no queremos que detecte
  // la superficie del hormigón, la idea sería que rote en el punto en el que está»). Su
  // cara metía el pivote a una profundidad que no era la que se estaba mirando.
  const hHorm = puntoBajo(TE, { x: 0, y: -20, z: 0 });
  ok(hHorm === null, 'apuntando donde no hay barra, el hormigón NO se señala (=' + JSON.stringify(hHorm) + ')');
  ok(puntoBajo(TE, { x: 0, y: -20, z: 0 }) === null,
    'y da lo mismo el 🧊: la caja dejó de ser un objetivo del pivote');

  // LA HOLGURA DE AGARRE: 10 px al lado del eje agarran, 30 no. (Una φ16 a 900 cm mide
  // 1,3 px de ancho: sin holgura habría que acertarle al píxel.)
  const wF = sesion(), TF = wF.TemplateEditor;
  montar(TF, BARRA, 0, null, null);                 // sin hormigón: aislar el agarre
  ok(!!puntoBajo(TF, P, 0, -8), 'a 8 px del eje de la barra todavía la agarra');
  ok(puntoBajo(TF, P, 0, -30) === null, 'a 30 px ya no (y sin hormigón detrás, no agarra nada)');
  ok(TF.PICK_PX === 10, 'la holgura es de ' + TF.PICK_PX + ' px, declarada en una constante');

  // DOS BARRAS ENCIMADAS: gana la de ADELANTE (la más cerca del ojo)
  const wD = sesion(), TD = wD.TemplateEditor;
  const b1 = { meta: { ci: 0 }, diam: 2, puntos: [{ x: -200, y: 0, z: 60 }, { x: 200, y: 0, z: 60 }] };
  const b2 = { meta: { ci: 1 }, diam: 2, puntos: [{ x: -200, y: 0, z: -60 }, { x: 200, y: 0, z: -60 }] };
  montar(TD, [b2, b1], 0, [0, 0], null);            // cámara de frente: quedan una tras otra
  const hD = TD._puntoBajoCursor3D(0.5, 0.5, W, H);
  ok(!!hD && Math.abs(hD.z - 60) < 1e-6, 'con dos barras encimadas gana la de ADELANTE (z=' + f1(hD.z) + ', no −60)');

  // EL DESEMPATE ENTRE BARRAS ES LA DISTANCIA AL CURSOR, no la profundidad. Lo cazó la
  // auditoría: con la de adelante 8 px al costado y la de atrás JUSTO bajo el cursor,
  // ordenar por profundidad agarraba la de adelante — una barra que el cursor no está
  // tocando. La profundidad sólo desempata entre las que están igual de bajo el cursor.
  const wT = sesion(), TT = wT.TemplateEditor;
  // la de adelante va 4 cm más arriba: a 600 cm del ojo eso son ~9 px en pantalla, o sea
  // que NO está bajo el cursor pero sí dentro de la holgura de agarre (10 px).
  const adelante = { meta: { ci: 0 }, diam: 1.6, puntos: [{ x: -200, y: 4, z: 300 }, { x: 200, y: 4, z: 300 }] };
  const atras = { meta: { ci: 1 }, diam: 1.6, puntos: [{ x: -200, y: 0, z: -300 }, { x: 200, y: 0, z: -300 }] };
  montar(TT, [adelante, atras], 0, [0, 0], null);      // cámara de frente
  const sAtras = proyectar(TT, { x: 0, y: 0, z: -300 });
  const sepAdel = Math.abs(proyectar(TT, { x: 0, y: 4, z: 300 }).py - sAtras.py);
  const hT = TT._puntoBajoCursor3D(sAtras.px / W, sAtras.py / H, W, H);
  ok(!!hT && Math.abs(hT.z + 300) < 1e-6,
    'entre dos barras, gana la que está BAJO EL CURSOR aunque la otra esté más cerca (z=' + f1(hT.z) +
    ', la de adelante pasaba a ' + f1(sepAdel) + ' px del cursor)');
  // y cuando las dos están IGUAL de bajo el cursor (encimadas), gana la de adelante:
  // ya está medido más arriba con las barras a z=±60.

  // COORDENADAS QUE NO SON NÚMEROS: con y = '0' (string), isFinite lo deja pasar y la
  // aritmética CONCATENA en vez de sumar — el pivote salía con y = "00" y la cámara
  // pasaba a operar con basura. Lo cazó la auditoría.
  const wS2 = sesion(), TS2 = wS2.TemplateEditor;
  montar(TS2, [{ meta: { ci: 0 }, diam: 1.6, puntos: [{ x: -100, y: '0', z: 0 }, { x: 100, y: 0, z: 0 }] }], 0, null, null);
  const hS = TS2._puntoBajoCursor3D(0.5, 0.5, W, H);
  ok(hS === null || (typeof hS.y === 'number' && isFinite(hS.y)),
    'una coordenada que es un string NO se cuela en el pivote (' + JSON.stringify(hS) + ')');

  // SIN NADA BAJO EL CURSOR: el pivote es EL PUNTO QUE SEÑALA EL CURSOR, en el plano
  // paralelo a la pantalla que pasa por la pieza (19-ago). Antes caía al centro de la
  // selección, y ese salto era justo lo que el usuario no quería: «la idea sería que
  // rote en el punto en el que está».
  const wN = sesion(), TN = wN.TemplateEditor;
  montar(TN, BARRA, 0, null, null);
  const pv = TN._pivoteDelCursor(0.02, 0.98, W, H);
  ok(pv.fuente === 'plano', 'sin geometría bajo el cursor, el pivote es el punto señalado (' + pv.fuente + ')');
  // el punto está EN el plano de la pieza: misma profundidad que su centro…
  const cen = TN._centroSeleccion3D(), oj = TN._ojoCam(), at = TN._baseCam().atras;
  const profPiv = -((pv.p.x - oj.x) * at.x + (pv.p.y - oj.y) * at.y + (pv.p.z - oj.z) * at.z);
  const profCen = -((cen.x - oj.x) * at.x + (cen.y - oj.y) * at.y + (cen.z - oj.z) * at.z);
  ok(Math.abs(profPiv - profCen) < 1e-6,
    'a la MISMA profundidad que la pieza (' + f1(profPiv) + ' vs ' + f1(profCen) + ')');
  // …y NO es el centro: el cursor está en una esquina del cuadrante
  ok(Math.hypot(pv.p.x - cen.x, pv.p.y - cen.y, pv.p.z - cen.z) > 1,
    'y NO es el centro de la pieza: sigue al cursor (' + [f1(pv.p.x), f1(pv.p.y), f1(pv.p.z)].join(', ') + ')');
  TN._st.selCi = -1;
  const pv2 = TN._pivoteDelCursor(0.02, 0.98, W, H);
  ok(pv2.fuente === 'plano', 'y sin selección, sigue siendo el punto señalado — ya no hay salto al centro (' + pv2.fuente + ')');
  // apuntar a la BARRA sigue ganando aunque no esté seleccionada
  TN._st.selCi = -1;
  const pv3 = señalar(TN, P);
  ok(pv3.fuente === 'barra', 'se puede señalar CUALQUIER barra, esté o no seleccionada (' + pv3.fuente + ')');

  // DATOS ROTOS: no pueden ganar el pivote NI hacer caer al editor. Un segmento con
  // una coordenada NaN da un acercamiento NaN, y `NaN > tolerancia` es false: sin el
  // filtro, ese segmento GANABA y el giro se iba a un punto que no existe.
  const wR = sesion(), TR = wR.TemplateEditor;
  const rotas = [
    { meta: { ci: 0 }, diam: 1.6, puntos: [{ x: NaN, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }] },
    { meta: { ci: 0 }, diam: 1.6, puntos: [{ x: 0, y: 0, z: NaN }, { x: 0, y: 10, z: 0 }] },
    { meta: { ci: 0 }, diam: 0, puntos: [{ x: 5, y: 5, z: 5 }] },              // un solo punto
    { meta: { ci: 0 }, diam: -3, puntos: [] },                                 // sin puntos
    { meta: { ci: 0 }, puntos: [{ x: 7, y: 7, z: 7 }, { x: 7, y: 7, z: 7 }] }  // dos puntos iguales, sin diam
  ];
  montar(TR, rotas, 0, null, null);
  let reventó = false, sucio = false;
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      let h = null;
      try { h = TR._puntoBajoCursor3D(i / 10, j / 10, W, H); } catch (err) { reventó = true; }
      if (h && !(isFinite(h.x) && isFinite(h.y) && isFinite(h.z))) sucio = true;
    }
  }
  ok(!reventó, 'barriendo 121 posiciones de cursor sobre geometría rota, el picking no se cae');
  ok(!sucio, 'y NUNCA devuelve un punto con NaN (el pivote saldría de la nada)');
  // (el segmento de dos puntos IGUALES sí es agarrable, y está bien que lo sea: es un
  // punto real de la escena, sólo que de largo cero. Lo que no puede pasar es que el
  // pivote salga con NaN.)
  const pvR = TR._pivoteDelCursor(0.5, 0.5, W, H);
  ok(isFinite(pvR.p.x) && isFinite(pvR.p.y) && isFinite(pvR.p.z),
    'y el pivote que sale de una escena rota es un punto FINITO (' + [f1(pvR.p.x), f1(pvR.p.y), f1(pvR.p.z)].join(', ') + ', fuente=' + pvR.fuente + ')');
  // tamaños de cuadrante imposibles
  ok(TR._puntoBajoCursor3D(0.5, 0.5, 0, 0) === null, 'con el cuadrante en 0×0 devuelve null en vez de dividir por cero');
}

// ================================================================ C3 — EL CONTRATO
console.log('\nC3 — LOS DOS MODOS SON DISTINTOS, TAMBIÉN CON LA PIEZA CENTRADA');
{
  // Ésta es la prueba que las cuatro primeras vueltas del ctrl no podían pasar: con el
  // elemento centrado en pantalla, "el centro de la vista" y "el elemento" son el mismo
  // punto y mover el pivote a la pieza no cambiaba nada (12,7 px). Ahora el pivote del
  // ctrl es EL PUNTO SEÑALADO, que no tiene por qué estar en el centro de nada.
  const PASOS = 60, DX = 4;
  const P = { x: 280, y: 25, z: 12 };               // la punta de la barra, lejos del centro
  const testigo = { x: -280, y: 5, z: 12 };

  const wC = sesion(), TC = wC.TemplateEditor; montar(TC, BARRA);
  const piv = señalar(TC, P);
  ok(piv.fuente === 'barra', 'el usuario señala la punta de la barra (fuente=' + piv.fuente + ')');
  const centrado = proyectar(TC, TC._centroElemento3D());
  ok(Math.abs(centrado.px - W / 2) < 1e-9 && Math.abs(centrado.py - H / 2) < 1e-9,
    'y la escena está CENTRADA: el elemento cae justo en el centro del cuadrante');
  const mCtrl = arrastrar(TC, PASOS, DX, 0, piv.p, [P, testigo]);

  const wN = sesion(), TN = wN.TemplateEditor; montar(TN, BARRA);
  const mNorm = arrastrar(TN, PASOS, DX, 0, null, [P, testigo]);

  ok(mCtrl[0] < 1e-6, 'CON ctrl el punto señalado queda CLAVADO: ' + f6(mCtrl[0]) + ' px de deriva en todo el gesto');
  ok(mNorm[0] > 100, 'SIN ctrl ese mismo punto se va ' + f1(mNorm[0]) + ' px (orbita el centro del elemento)');
  ok(mCtrl[1] > 100, 'y con ctrl la escena SÍ gira alrededor del punto (el testigo se mueve ' + f1(mCtrl[1]) + ' px)');
  const sep = Math.max.apply(Math, [P, testigo, { x: 0, y: 0, z: 0 }]
    .map((Q) => dist2(proyectar(TC, Q), proyectar(TN, Q))).filter((n) => isFinite(n)));
  ok(sep > 200, 'tras el mismo arrastre, la imagen de un modo y la del otro se separan hasta ' + f1(sep) + ' px');
  ok(alabeoGrados(TC) < 1e-9 && alabeoGrados(TN) < 1e-9,
    'y NINGUNO de los dos inclina el horizonte (' + f6(alabeoGrados(TC)) + '° / ' + f6(alabeoGrados(TN)) + '°): eso lo hacía el asador');

  // EL GESTO VERTICAL: mismo contrato (el punto señalado es el centro del giro, sea
  // cual sea el reparto entre acimut y elevación).
  const wV = sesion(), TV = wV.TemplateEditor; montar(TV, BARRA);
  const pv = señalar(TV, P).p;
  const vCtrl = arrastrar(TV, 30, 0, 4, pv, [P, testigo]);
  ok(vCtrl[0] < 1e-6, 'el arrastre VERTICAL con ctrl también clava el punto señalado (' + f6(vCtrl[0]) + ' px)');
  ok(vCtrl[1] > 50, 'y mueve el resto (' + f1(vCtrl[1]) + ' px)');

  // EL ÚNICO CASO EN QUE LOS DOS MODOS COINCIDEN EXACTAMENTE, y no es un empate mal
  // resuelto: es geometría. Las dos cámaras giran el MISMO ángulo, así que la
  // diferencia entre las dos imágenes es (I − R)·(p₁ − p₂); si el corrimiento entre los
  // dos pivotes cae JUSTO sobre el eje del giro, ese producto es CERO. Señalando un
  // punto exactamente encima del centro del elemento (mismo x, mismo z) y arrastrando
  // en horizontal puro —que gira sobre la vertical del mundo— las dos imágenes son la
  // misma. Lo cazó la auditoría, y la separación es lineal en la componente
  // PERPENDICULAR al eje: 0 cm → 0 px · 0,5 cm → 1,7 px · 5 cm → 16,9 px · 15 cm → 50,7 px.
  // No se puede "arreglar" sin dejar de hacer lo que el modo dice que hace, y la diana
  // es de un píxel: en el barrido de los 1286 píxeles del cuadrante con geometría, NI
  // UNO da menos de 1 px de separación con un gesto completo.
  const wEje = sesion(), Eje = wEje.TemplateEditor; montar(Eje, BARRA);
  const cEl = Eje._centroElemento3D();
  const encima = { x: cEl.x, y: cEl.y + 30, z: cEl.z };      // justo sobre el eje vertical
  const alLado = { x: cEl.x, y: cEl.y + 30, z: cEl.z + 5 };  // 5 cm fuera de ese eje
  const testigos2 = [{ x: 100, y: 20, z: 40 }, { x: -150, y: -10, z: -30 }];
  const sepCon = (p) => {
    const wa = sesion(), A2 = wa.TemplateEditor; montar(A2, BARRA);
    const wb = sesion(), B2 = wb.TemplateEditor; montar(B2, BARRA);
    for (let i = 0; i < 60; i++) { A2._girarPorArrastre(4, 0, p); B2._girarPorArrastre(4, 0, null); }
    return Math.max.apply(Math, testigos2.map((Q) => dist2(proyectar(A2, Q), proyectar(B2, Q))).filter(isFinite));
  };
  ok(sepCon(encima) < 1e-9,
    'señalando JUSTO sobre el eje vertical del centro y arrastrando en horizontal, los dos modos dan la MISMA imagen (' +
    f6(sepCon(encima)) + ' px): es (I−R)(p₁−p₂) = 0, no un empate mal resuelto');
  ok(sepCon(alLado) > 10,
    'y 5 cm más allá de ese eje ya se separan ' + f1(sepCon(alLado)) + ' px: la diana del cero es de un píxel');

  // Y CON LA PIEZA DESCENTRADA (paneada), los dos modos siguen siendo distintos.
  const wP = sesion(), TP = wP.TemplateEditor; montar(TP, BARRA);
  TP._st.panX = 300; TP._st.panY = -120;
  const pivP = señalar(TP, P);
  const dP = arrastrar(TP, PASOS, DX, 0, pivP ? pivP.p : null, [P]);
  ok(!!pivP && dP[0] < 1e-6, 'con la pieza descentrada, el punto señalado sigue clavado (' + f6(dP[0]) + ' px)');
}

// ================================================================ C4
console.log('\nC4 — SIN ABSORBEDOR: qué pasa de verdad después de panear (los números)');
{
  // EL ABSORBEDOR ERA ESTO: tras cada pan/rueda mudaba el pivote a lo que quedara al
  // centro de la pantalla. Acá se mide qué cambia al sacarlo.
  const wA = sesion(), TA = wA.TemplateEditor; montar(TA, BARRA);
  // pan largo: 400 px a la derecha y 150 hacia arriba
  TA._st.panX -= -400 * TA._st.dist * 0.0011; TA._st.panY += -150 * TA._st.dist * 0.0011;
  const centro = TA._centroElemento3D();
  const sCentro = proyectar(TA, centro);
  const sPantalla = proyectar(TA, TA._puntoCentroPantalla());
  const brecha = dist2(sCentro, sPantalla);
  ok(brecha > 300, 'tras el pan, el centro del elemento y el centro de la pantalla están a ' + f1(brecha) +
    ' px: ES la distancia que el absorbedor borraba (por eso los dos modos se sentían iguales)');

  // 1) el elemento queda CLAVADO: lo que uno está mirando no se mueve.
  const dCentro = arrastrar(TA, 60, 4, 0, null, [centro])[0];
  ok(dCentro < 1e-9, 'el giro normal deja el CENTRO DEL ELEMENTO clavado, aunque se haya paneado (' + f6(dCentro) + ' px)');

  // 1b) EL ANTES/DESPUÉS DEL ABSORBEDOR, en el mismo escenario. El absorbedor viejo
  // era exactamente esto: mudar el pivote a lo que quedaba al centro de la pantalla.
  // Lo que se ve es que NO evitaba que algo volara: elegía QUÉ volaba.
  const wV = sesion(), TV = wV.TemplateEditor; montar(TV, BARRA);
  TV._st.panX -= -400 * TV._st.dist * 0.0011; TV._st.panY += -150 * TV._st.dist * 0.0011;
  TV._pivotarEnSinMover(TV._puntoCentroPantalla());      // ← el absorbedor de ayer
  const cV = TV._centroElemento3D();
  const dConAbs = arrastrar(TV, 60, 4, 0, TV._st.target, [cV])[0];
  ok(dConAbs > 500, 'CON el absorbedor de ayer, en ese mismo gesto el que se iba era EL ELEMENTO: ' +
    f1(dConAbs) + ' px (contra ' + f6(dCentro) + ' px ahora). No evitaba que algo volara: elegía que volara la pieza.');

  // 2) "salir volando" es geometría y se mide: cada punto barre tanto como su distancia
  // EN PÍXELES al pivote por el ángulo. Un paso de 4 px son 0,032 rad.
  const wB = sesion(), TB = wB.TemplateEditor; montar(TB, BARRA);
  TB._st.panX -= -400 * TB._st.dist * 0.0011; TB._st.panY += -150 * TB._st.dist * 0.0011;
  const mirando = TB._puntoCentroPantalla();        // lo que el usuario tiene al centro
  const antes = proyectar(TB, mirando);
  TB._girarPorArrastre(4, 0, null);
  const barrido = dist2(proyectar(TB, mirando), antes);
  ok(barrido < 30, 'y lo que quedó al centro de la pantalla barre ' + f1(barrido) +
    ' px en un paso de 4 px de arrastre: se mueve, pero no se descontrola');

  // 3) EL CASO FEO, dicho con número: meterse con la rueda a un detalle lejos del
  // centro del elemento. Ahí el pivote queda a miles de píxeles y un arrastre chico
  // manda la imagen lejos. NO se esconde: es lo que el ctrl viene a resolver.
  // (cámara de frente, [elev 0, acimut 0]: así la punta de la barra está lejos DE
  // COSTADO y no en profundidad, que es como uno se mete a mirar un detalle. Metiéndose
  // hacia un punto que está muy adelantado EN PROFUNDIDAD la cámara le pasa de largo y
  // el punto queda detrás, que es otra historia.)
  const wZ = sesion(), TZ = wZ.TemplateEditor; montar(TZ, BARRA, 0, [0, 0]);
  const detalle = { x: 300, y: 25, z: 12 };         // la punta de la barra
  for (let i = 0; i < 25; i++) {                    // 25 ruedas hacia la punta
    const s = proyectar(TZ, detalle);
    TZ._zoomAlCursor(0.9, s.px / W, s.py / H, W / H);
  }
  const sPivote = proyectar(TZ, TZ._centroElemento3D());
  const lejos = sPivote ? Math.hypot(sPivote.px - W / 2, sPivote.py - H / 2) : Infinity;
  const antesZ = proyectar(TZ, detalle);
  TZ._girarPorArrastre(4, 0, null);
  const vuela = dist2(proyectar(TZ, detalle), antesZ);
  ok(lejos > 1000 && vuela > 50, 'con la rueda metida en un detalle, el centro del elemento queda a ' +
    f1(lejos) + ' px y un paso de 4 px mueve la imagen ' + f1(vuela) + ' px: ES el caso feo, y está medido');
  // …y el remedio, que ahora es explícito y a la vista en vez de automático y oculto:
  const wZ2 = sesion(), TZ2 = wZ2.TemplateEditor; montar(TZ2, BARRA, 0, [0, 0]);
  for (let i = 0; i < 25; i++) {
    const s = proyectar(TZ2, detalle);
    TZ2._zoomAlCursor(0.9, s.px / W, s.py / H, W / H);
  }
  const pivD = señalar(TZ2, detalle);
  const antes2 = proyectar(TZ2, detalle);
  TZ2._girarPorArrastre(4, 0, pivD.p);
  ok(dist2(proyectar(TZ2, detalle), antes2) < 1e-6,
    'con ctrl sobre ese mismo detalle, el punto no se mueve (' + f6(dist2(proyectar(TZ2, detalle), antes2)) +
    ' px): el remedio del absorbedor, pero pedido y visible');
  // el editor además AVISA cuando el pivote normal quedó fuera de cuadro (lo dibuja
  // pegado al borde): acá se comprueba el hecho que dispara ese aviso.
  ok(lejos > W, 'y el aviso tiene de qué avisar: el pivote quedó fuera del cuadrante (' + f1(lejos) + ' px > ' + W + ')');
}

// ================================================================ C5
console.log('\nC5 — lo que ya funcionaba sigue igual (pivotar, panear, zoom, radial de eje)');
{
  const w = sesion(), TE = w.TemplateEditor; montar(TE, BARRA);
  const testigos = [{ x: 0, y: 0, z: 0 }, { x: 250, y: 15, z: 12 }, { x: -100, y: 40, z: -60 }];

  // PIVOTAR SIN MOVER: es lo que corre al soltar el ctrl (el pivote guardado vuelve al
  // centro del elemento) y no puede mover un píxel.
  const antesP = testigos.map((P) => proyectar(TE, P));
  ok(TE._pivotarEnSinMover(new THREE.Vector3(250, 15, 12)) === true, '_pivotarEnSinMover acepta un punto de la barra');
  let peor = Math.max.apply(Math, testigos.map((P, k) => dist2(proyectar(TE, P), antesP[k])));
  ok(peor < 1e-9, 'y no mueve la imagen: ' + f6(peor) + ' px');
  ok(Math.abs(TE._st.target.x - 250) < 1e-9, 'el pivote guardado quedó en la barra');
  const antesV = testigos.map((P) => proyectar(TE, P));
  ok(TE._pivotarEnSinMover(TE._centroElemento3D()) === true, 'y vuelve al centro del elemento (lo que hace el mouseup)');
  peor = Math.max.apply(Math, testigos.map((P, k) => dist2(proyectar(TE, P), antesV[k])));
  ok(peor < 1e-9, 'tampoco moviendo un píxel (' + f6(peor) + ' px)');

  // EL PAN sigue siendo en el plano de pantalla (movimiento puramente horizontal).
  const P0 = { x: 0, y: 0, z: 0 };
  const a0 = proyectar(TE, P0);
  TE._st.panX -= 40 * TE._st.dist * 0.0011;
  const a1 = proyectar(TE, P0);
  ok(Math.abs(a1.py - a0.py) < 1e-6 && (a1.px - a0.px) > 1,
    'panear mueve la imagen en HORIZONTAL pura (' + f1(a1.px - a0.px) + ' px, vertical ' + f6(a1.py - a0.py) + ' px)');

  // EL ZOOM AL CURSOR sigue clavando el punto bajo el cursor.
  {
    const fx = 0.78, fy = 0.24, aspect = W / H;
    const b = TE._baseCam(), ojo = TE._ojoCam(b);
    const halfH = TE._st.dist * Math.tan(TE.FOV3D * Math.PI / 360), halfW = halfH * aspect;
    const bajoCursor = ojo.clone()
      .addScaledVector(b.atras, -TE._st.dist)
      .addScaledVector(b.derecha, (fx * 2 - 1) * halfW)
      .addScaledVector(b.arriba, -(fy * 2 - 1) * halfH);
    const antesZ = proyectar(TE, bajoCursor);
    TE._zoomAlCursor(0.8, fx, fy, aspect);
    const dZ = dist2(proyectar(TE, bajoCursor), antesZ);
    ok(dZ < 1e-6, 'el punto bajo el cursor queda clavado al hacer zoom (' + f6(dZ) + ' px)');
  }

  // EL RADIAL DE EJE restringe el gesto EN LOS DOS MODOS, con el MISMO delta: ctrl
  // cambia el centro, nunca la velocidad ni el eje del gesto.
  const wE = sesion(), TEj = wE.TemplateEditor; montar(TEj, BARRA);
  const pivE = señalar(TEj, { x: 280, y: 25, z: 12 }).p;
  TEj._st.ejeRot = 'z';
  const e0 = elevGrados(TEj);
  TEj._girarPorArrastre(0, 30, null);
  ok(Math.abs(elevGrados(TEj) - e0) < 1e-9, 'con el eje Z fijado, el arrastre vertical no cambia la elevación');
  ok(TEj._girarPorArrastre(0, 30, pivE) === null, 'y con ctrl el arrastre vertical tampoco aplica nada');
  const antesE = proyectar(TEj, { x: 280, y: 25, z: 12 });
  ok(TEj._girarPorArrastre(30, 0, pivE) === 'pivote', 'pero el HORIZONTAL con ctrl sí gira alrededor del punto');
  ok(dist2(proyectar(TEj, { x: 280, y: 25, z: 12 }), antesE) < 1e-6, 'y con el eje Z fijado el punto sigue clavado');
  // MISMO DELTA en los dos modos: el ángulo girado es idéntico, sólo cambia el centro.
  const wG1 = sesion(), TG1 = wG1.TemplateEditor; montar(TG1, BARRA);
  const wG2 = sesion(), TG2 = wG2.TemplateEditor; montar(TG2, BARRA);
  const pivG = señalar(TG2, { x: 280, y: 25, z: 12 }).p;
  TG1._girarPorArrastre(7, 3, null); TG2._girarPorArrastre(7, 3, pivG);
  const q1 = TG1._st.quat, q2 = TG2._st.quat;
  ok(Math.hypot(q1.x - q2.x, q1.y - q2.y, q1.z - q2.z, q1.w - q2.w) < 1e-12,
    'los dos modos giran EXACTAMENTE el mismo ángulo (misma orientación final): sólo cambia el centro');
}

// ================================================================ C6
console.log('\nC6 — con la GEOMETRÍA REAL de la semilla (lo que el usuario tiene al abrir)');
{
  const w = sesion(), TE = w.TemplateEditor;
  const receta = w.ModeladorSemilla.semillaViga();
  const out = w.ModeladorGenerar.generarElemento(receta);
  ok(out.placements.length > 50, 'la semilla genera ' + out.placements.length + ' colocaciones reales');

  montar(TE, out.placements, 2, null, receta.geometria);
  // se señala un punto de UN estribo del montón (el que está a 1/3 del largo)
  const est = out.placements.filter((pl) => pl.meta && pl.meta.ci === 2);
  ok(est.length > 5, 'y ' + est.length + ' de ellas son estribos');
  const blanco = est[Math.floor(est.length / 3)].puntos[1];
  const cursor = proyectar(TE, blanco);
  const piv = señalar(TE, blanco);
  ok(!!piv && piv.fuente === 'barra', 'se puede señalar UN estribo concreto entre todos (fuente=' + (piv && piv.fuente) + ')');
  // OJO CON LO QUE SE PIDE ACÁ: con 47 estribos en fila, el que se agarra NO tiene por
  // qué ser aquel cuyo punto se usó para apuntar — delante suyo puede haber otro. Lo
  // que el contrato dice es que el punto agarrado (a) esté EN la geometría real y
  // (b) esté EXACTAMENTE bajo el cursor. Y eso es lo que queda clavado.
  ok(distAGeometria(out, piv.p) < 1e-6,
    'el punto agarrado está SOBRE una barra de verdad (' + f6(distAGeometria(out, piv.p)) + ' cm del eje más cercano)');
  // …y dentro de la HOLGURA de agarre: el punto elegido es el del EJE de la barra más
  // cercano al rayo, así que sólo cae en el píxel exacto si el rayo atraviesa el eje.
  // LA COTA REAL —lo precisó la auditoría, que midió 11,56 px y no 10— es PICK_PX MÁS
  // EL RADIO APARENTE de la barra en píxeles: el agarre se concede hasta
  // `radio + PICK_PX·cm_por_px`, así que el eje puede quedar esos píxeles de más.
  const profP = TE._proyectarEnCuadrante(piv.p, W, H).prof;
  const radioPx = 0.8 / (2 * profP * Math.tan(TE.FOV3D * Math.PI / 360) / H);   // radio de una φ16, en píxeles
  ok(dist2(proyectar(TE, piv.p), cursor) < TE.PICK_PX + radioPx + 1,
    'y bajo el cursor, dentro de la holgura (' + f1(dist2(proyectar(TE, piv.p), cursor)) + ' px, cota ' +
    f1(TE.PICK_PX + radioPx) + ' = 10 px + el radio aparente de la barra)');

  const testigo = { x: 0, y: -150, z: 200 };
  const mCtrl = arrastrar(TE, 60, 4, 0, piv.p, [piv.p, testigo]);
  ok(mCtrl[0] < 1e-6, 'con ctrl ese punto del estribo queda clavado (' + f6(mCtrl[0]) + ' px)');
  ok(mCtrl[1] > 100, 'y la escena gira a su alrededor (' + f1(mCtrl[1]) + ' px)');

  const wN = sesion(), TN = wN.TemplateEditor;
  montar(TN, out.placements, 2, null, receta.geometria);
  const mNorm = arrastrar(TN, 60, 4, 0, null, [piv.p, testigo]);
  ok(mNorm[0] > 50, 'sin ctrl ese mismo punto se va ' + f1(mNorm[0]) + ' px (orbita el centro de la viga)');
  const sep = dist2(proyectar(TE, testigo), proyectar(TN, testigo));
  ok(sep > 100, 'la escena termina ' + f1(sep) + ' px distinta entre los dos modos');
}

// ================================================================ C7
console.log('\nC7 — BARRIDO: el pivote se clava y el horizonte NUNCA se inclina');
{
  // 4 piezas reales × 4 poses de cámara × 3 gestos = 48 escenarios. Se mide (a) que el
  // punto señalado no se mueva ni un micrón, (b) que los dos modos se separen y (c) que
  // el horizonte quede a nivel en los dos — el asador lo inclinaba y hacía falta un
  // enderezado progresivo para destorcerlo; ese código ya no existe y esto lo congela.
  const wA = sesion(), A = wA.TemplateEditor;
  const wB = sesion(), B = wB.TemplateEditor;
  const receta = wA.ModeladorSemilla.semillaViga();
  const out = wA.ModeladorGenerar.generarElemento(receta);
  const POSES = [[0.55, 0.9], [0.2, 0.0], [0.9, 2.4], [-0.3, 1.6]];
  const GESTOS = [[4, 0], [0, 4], [3, 3]];
  const testigos = [{ x: 0, y: 0, z: 0 }, { x: 280, y: 28, z: 14 }, { x: -280, y: -28, z: -14 }, { x: 0, y: 30, z: 0 }];
  const nombre = ['CBS', 'CBI', 'ES', 'TRV'];
  const minSep = [Infinity, Infinity, Infinity, Infinity];
  const maxSep = [0, 0, 0, 0];
  let peorDeriva = 0, peorAlabeo = 0, sinPivote = 0;
  for (let ci = 0; ci < 4; ci++) {
    for (const pose of POSES) {
      for (const g of GESTOS) {
        montar(A, out.placements, ci, pose, receta.geometria);
        montar(B, out.placements, ci, pose, receta.geometria);
        // El usuario señala el punto de ESA pieza que está MÁS LEJOS del centro del
        // elemento en pantalla: es donde el ctrl tiene algo que aportar (apuntando al
        // centro mismo los dos modos coinciden, y con razón: es el mismo pivote).
        const pl = out.placements.filter((p) => p.meta && p.meta.ci === ci)[0];
        const sc = proyectar(A, A._centroElemento3D());
        let blanco = null, lejos = -1;
        pl.puntos.forEach((P) => {
          const d = dist2(proyectar(A, P), sc);
          if (isFinite(d) && d > lejos) { lejos = d; blanco = P; }
        });
        const piv = señalar(A, blanco);
        if (!piv || piv.fuente !== 'barra') { sinPivote++; continue; }
        const s0 = proyectar(A, piv.p);
        for (let i = 0; i < 40; i++) {
          A._girarPorArrastre(g[0], g[1], piv.p);
          B._girarPorArrastre(g[0], g[1], null);
          const d = dist2(proyectar(A, piv.p), s0);
          if (d > peorDeriva) peorDeriva = d;
        }
        peorAlabeo = Math.max(peorAlabeo, alabeoGrados(A), alabeoGrados(B));
        const sep = Math.max.apply(Math, testigos
          .map((P) => dist2(proyectar(A, P), proyectar(B, P))).filter((n) => isFinite(n)));
        if (sep < minSep[ci]) minSep[ci] = sep;
        if (sep > maxSep[ci]) maxSep[ci] = sep;
      }
    }
  }
  ok(sinPivote === 0, 'en los 48 escenarios se pudo señalar la pieza con el cursor (fallos: ' + sinPivote + ')');
  ok(peorDeriva < 1e-6, 'y el punto señalado NUNCA se movió: peor caso ' + f6(peorDeriva) + ' px');
  ok(peorAlabeo < 1e-9, 'el horizonte queda a nivel en los dos modos, siempre (peor alabeo ' + f6(peorAlabeo) + '°)');
  [0, 1, 2, 3].forEach((ci) => {
    ok(maxSep[ci] > 200, nombre[ci] + ': los dos modos llegan a separarse ' + f1(maxSep[ci]) + ' px');
    ok(minSep[ci] > 10, nombre[ci] + ': y NUNCA se confunden — el peor de sus 12 escenarios separa ' + f1(minSep[ci]) + ' px');
  });
  // EL PISO DE ~18 px TIENE EXPLICACIÓN Y NO ES UN DEFECTO. Los dos modos giran el
  // MISMO ángulo y sólo difieren en el centro, así que la diferencia entre las dos
  // imágenes es (I − R)·(p₁ − p₂): si el corrimiento entre los dos pivotes cae JUSTO
  // sobre el eje del giro, ese producto es cero. Pasa con un arrastre puramente
  // vertical (gira sobre la derecha de la cámara) y el pivote corrido justo hacia la
  // derecha. Es geometría, no un empate mal resuelto: en cuanto el gesto tiene algo de
  // horizontal, la separación se va a cientos de píxeles (el máximo de arriba).
  // La TRABA vertical era el caso débil del asador (su eje propio ERA la vertical del
  // mundo y coincidía con el giro normal: 11,1 px); con el pivote como diferencia deja
  // de ser un caso aparte — es una pieza más.
  ok(minSep[3] > 10, 'la TRABA, que era el caso débil del asador (11,1 px), ya no es un caso aparte: ' + f1(minSep[3]) + ' px');
}

// ================================================================ C8
console.log('\nC8 — qué pivote se acepta y qué se rechaza (y el rechazo no mata el gesto)');
{
  // SE ACEPTA TODO LO QUE ESTÉ DELANTE DEL OJO, aunque quede más cerca que el mínimo de
  // la cámara. Hubo un piso de 15 cm y lo quitó la auditoría del 20-ago: con la cámara
  // en el máximo acercamiento la ventana mide unos centímetros de alto, así que casi
  // cualquier barra que uno señale está a menos de 15 cm del ojo — y quedaba rechazada.
  // O sea: el ctrl no clavaba nada JUSTO en el zoom donde más falta hace (mirando un
  // doblez). Medido entonces: 18,7 px de deriva por paso. Ahora, 0.
  const w = sesion(), TE = w.TemplateEditor;
  montar(TE, BARRA, 0, null, null);
  // EL MÁXIMO ACERCAMIENTO SE PREGUNTA, NO SE ESCRIBE (25-ago): este bloque tenía el
  // 15 literal y al subir el zoom un 30% -pedido del usuario- el test se cayó sin que
  // nada estuviera roto. Lo que se prueba es el COMPORTAMIENTO en el tope, sea cual sea.
  const DMIN = TE._DIST_MIN;
  TE._st.dist = DMIN;                                 // el máximo acercamiento
  const b = TE._baseCam();
  // LA SONDA SE DERIVA DEL TOPE, no es un 8 fijo (25-ago). El 8 estaba calibrado
  // contra DIST_MIN = 15 y dejaba la cámara a 7 cm del pivote; al acercar el tope un
  // 30% ese mismo 8 la dejaba a 3,5 y los testigos de más abajo caían DETRÁS del ojo
  // (proyección infinita) — el test fallaba por su propia calibración, no por el
  // código. Se elige la sonda para que el estado resultante sea el MISMO de siempre:
  // cámara a 7 cm del pivote, que es lo que este bloque valida.
  const SONDA = DMIN - 7;
  const cerca = { x: b.atras.x * SONDA, y: b.atras.y * SONDA, z: b.atras.z * SONDA };
  const antesC = proyectar(TE, cerca);
  ok(TE._girarPorArrastre(2, 1, cerca) === 'pivote', 'un punto a ' + f1(SONDA) + ' cm del ojo (más cerca que el tope) SÍ sirve de pivote');
  ok(dist2(proyectar(TE, cerca), antesC) < 1e-6,
    'y queda clavado: ' + f6(dist2(proyectar(TE, cerca), antesC)) + ' px (antes del arreglo, 18,7 px por paso)');
  // (el punto queda por delante del pivote viejo: la cámara termina a 7 del ojo)
  ok(Math.abs(TE._st.dist - 7) < 1e-6, 'la distancia pasa a ser la del pivote (' + f1(TE._st.dist) +
    '), que es lo que significa: dura lo que dura el gesto');
  // …y al soltar vuelve a un estado usable SIN MOVER LA IMAGEN (es lo que corre en el
  // mouseup). Sin esto, `dist` quedaría en 7 —o peor: el centro del elemento acá cae a
  // 0,6 cm del ojo— y el pan y la rueda, que se escalan con ella, se vuelven inservibles.
  // LOS TESTIGOS TAMBIÉN SE DERIVAN DEL TOPE. El segundo era (0,15,12) —el 15 otra
  // vez— y con la cámara restaurada más cerca caía DETRÁS del ojo: su proyección daba
  // infinito y el test acusaba un movimiento que no existía. Lo que se comprueba es
  // que al soltar la imagen no se mueve, así que el testigo tiene que estar VISIBLE
  // en el encuadre restaurado, sea cual sea el tope.
  const testigos = [{ x: 0, y: 0, z: 0 }, { x: 0, y: DMIN, z: DMIN * 0.8 }];
  const antesR = testigos.map((P) => proyectar(TE, P));
  ok(TE._restaurarPivoteGuardado() === true, 'al soltar, el pivote guardado se restaura');
  const peorR = Math.max.apply(Math, testigos.map((P, k) => dist2(proyectar(TE, P), antesR[k])));
  ok(peorR < 1e-9, 'sin mover la imagen (' + f6(peorR) + ' px)');
  ok(TE._st.dist >= DMIN - 1e-9, 'y con una distancia con la que el pan y la rueda funcionan (' + f1(TE._st.dist) + ')');

  // LO QUE SÍ SE RECHAZA: detrás del ojo (haberse pasado de largo) y lejísimos.
  const w3 = sesion(), T3 = w3.TemplateEditor;
  montar(T3, BARRA, 0, null, null);
  const atras = T3._ojoCam().clone().addScaledVector(T3._baseCam().atras, 200);
  const pantalla = T3._puntoCentroPantalla();
  const antes = proyectar(T3, pantalla);
  ok(T3._girarPorArrastre(1, 0, atras) === 'centro', 'un pivote DETRÁS del ojo cae al centro de la pantalla');
  ok(dist2(proyectar(T3, pantalla), antes) < 1e-9,
    'y el gesto giró igual, sin tirón: lo que estaba al centro sigue clavado (' + f6(dist2(proyectar(T3, pantalla), antes)) + ' px)');
  const w4 = sesion(), T4 = w4.TemplateEditor;
  montar(T4, BARRA, 0, null, null);
  const lejos = T4._ojoCam().clone().addScaledVector(T4._baseCam().atras, -20000);
  ok(T4._girarPorArrastre(1, 0, lejos) === 'centro', 'y uno a 200 m (más allá del techo de la cámara) también');
  const w2 = sesion(), T2 = w2.TemplateEditor;
  montar(T2, BARRA, 0, null, null);
  ok(T2._girarPorArrastre(1, 0, { x: 100, y: 20, z: 12 }) === 'pivote', 'a distancia normal el pivote sí se agarra');
}

// ================================================================ C8b
console.log('\nC8b — el EJE del giro va normalizado (gestos larguísimos)');
{
  // setFromAxisAngle da por hecho que el eje es unitario, y el eje de la elevación sale
  // del quaternion vigente. Sin normalizarlo el error se REALIMENTA y crece al
  // cuadrado: medido por la auditoría, |q|−1 llegaba a 3,1e-7 en 100.000 pasos y el
  // punto clavado se corría 3,1 px (290 px en 1.000.000). Con el eje normalizado se
  // queda en el ruido de la coma flotante.
  const w = sesion(), TE = w.TemplateEditor;
  montar(TE, BARRA);
  const piv = { x: 200, y: 20, z: 12 };
  const s0 = proyectar(TE, piv);
  let peor = 0;
  for (let i = 0; i < 100000; i++) {
    TE._girarPorArrastre(1, (i % 60 < 30) ? 1 : -1, piv);   // acimut + elevación, ida y vuelta
    if (i % 500 === 0) peor = Math.max(peor, dist2(proyectar(TE, piv), s0));
  }
  const q = TE._st.quat;
  const norma = Math.abs(Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) - 1);
  ok(norma < 1e-9, '100.000 pasos con elevación dejan el quaternion unitario (|q|−1 = ' + norma.toExponential(2) + ')');
  ok(peor < 0.01, 'y el punto clavado no se corre (' + f6(peor) + ' px, contra 3,1 px sin normalizar el eje)');
}

// ================================================================ C9
console.log('\nC9 — EL PIVOTE DIBUJADO: la proyección con la que se pinta es la buena');
{
  // El punto rosado se pinta con _proyectarEnCuadrante. Si esa proyección no fuera la
  // inversa exacta del rayo del cursor, el punto se dibujaría en un sitio y el giro
  // ocurriría en otro — y ésta es justamente la función que tiene que hacer visible lo
  // que pasa. Se compara contra la proyección INDEPENDIENTE de este test.
  const w = sesion(), TE = w.TemplateEditor; montar(TE, BARRA);
  const puntos = [{ x: 280, y: 25, z: 12 }, { x: 0, y: 0, z: 0 }, { x: -300, y: 5, z: 12 }, { x: 0, y: -100, z: 200 }];
  let peor = 0;
  puntos.forEach((P) => { peor = Math.max(peor, dist2(TE._proyectarEnCuadrante(P, W, H), proyectar(TE, P))); });
  ok(peor < 1e-9, 'coincide con la proyección independiente del test en los 4 puntos (' + f6(peor) + ' px)');

  // IDA Y VUELTA con el rayo: proyectar un punto y volver a tirarle el rayo por ese
  // píxel tiene que dar la misma recta que pasa por él.
  const P = { x: 200, y: -10, z: -8 };
  const s = TE._proyectarEnCuadrante(P, W, H);
  const r = TE._rayoDesdeCursor(s.px / W, s.py / H, W / H);
  const t = -new V3(P.x - r.ojo.x, P.y - r.ojo.y, P.z - r.ojo.z).dot(TE._baseCam().atras);
  const sobre = Math.hypot(r.ojo.x + r.dir.x * t - P.x, r.ojo.y + r.dir.y * t - P.y, r.ojo.z + r.dir.z * t - P.z);
  ok(sobre < 1e-9, 'y el rayo tirado por ese píxel pasa EXACTAMENTE por el punto (' + f6(sobre) + ' cm)');
  ok(Math.abs(t - s.prof) < 1e-9, 'el parámetro del rayo ES la profundidad, como dice la nota (' + f1(t) + ' cm)');

  // EL PUNTO NO SE MUEVE MIENTRAS SE GIRA: es lo que el usuario ve en pantalla (el
  // punto rosado quieto y todo lo demás girando a su alrededor).
  const piv = señalar(TE, { x: 280, y: 25, z: 12 }).p;
  const s0 = TE._proyectarEnCuadrante(piv, W, H);
  let peorPiv = 0;
  for (let i = 0; i < 40; i++) {
    TE._girarPorArrastre(4, 2, piv);
    peorPiv = Math.max(peorPiv, dist2(TE._proyectarEnCuadrante(piv, W, H), s0));
  }
  ok(peorPiv < 1e-6, 'durante 40 pasos el punto dibujado no se corre ni ' + f6(peorPiv) + ' px');
  // el del giro normal, igual (se dibuja también, y también está quieto)
  const wN = sesion(), TN = wN.TemplateEditor; montar(TN, BARRA);
  const cN = TN._centroElemento3D();
  const sN = TN._proyectarEnCuadrante(cN, W, H);
  let peorN = 0;
  for (let i = 0; i < 40; i++) {
    TN._girarPorArrastre(4, 2, null);
    peorN = Math.max(peorN, dist2(TN._proyectarEnCuadrante(cN, W, H), sN));
  }
  ok(peorN < 1e-9, 'y el del giro normal tampoco (' + f6(peorN) + ' px)');

  // Y EL DIBUJO DE VERDAD (_dibujarPivote), que toca el DOM: se le arma un cuadrante
  // 3D de mentira para comprobar que el punto se crea, se posiciona en el píxel que
  // dice la proyección y se apaga al soltar. Sin esto, el único camino que el usuario
  // VE quedaría sin una sola medición — que es exactamente cómo esta función se volvió
  // indemostrable las dos veces anteriores.
  const wD = sesion(), TD = wD.TemplateEditor; montar(TD, BARRA);
  const quad = wD.document.createElement('div');
  quad.getBoundingClientRect = () => ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H });
  quad.querySelector = function (sel) { return this.children.filter((c) => ('.' + c.className).indexOf(sel) === 0)[0] || null; };
  wD.document.querySelector = (sel) => (sel.indexOf('.te-vista.d3') >= 0 ? quad : null);

  const pd = { x: 280, y: 25, z: 12 };
  TD._dibujarPivote(pd, true);
  const punto = quad.children[0];
  const esp = TD._proyectarEnCuadrante(pd, W, H);
  ok(!!punto && punto.className.indexOf('te-pivote on') === 0, 'el punto se crea y se enciende (class="' + (punto && punto.className) + '")');
  ok(punto.className.indexOf('pto') > 0, 'con ctrl va RELLENO (clase pto), que es como se distingue del pivote normal');
  ok(Math.abs(parseFloat(punto.style.left) - esp.px) < 0.06 && Math.abs(parseFloat(punto.style.top) - esp.py) < 0.06,
    'y queda en el píxel que dice la proyección (' + punto.style.left + ' / ' + punto.style.top + ' vs ' + f1(esp.px) + ' / ' + f1(esp.py) + ')');

  TD._dibujarPivote(TD._centroElemento3D(), false);
  ok(quad.children.length === 1, 'no se crea un punto nuevo por cada paso del arrastre (sigue habiendo ' + quad.children.length + ')');
  ok(punto.className.indexOf('pto') < 0, 'el pivote normal va HUECO (sin clase pto)');

  // pivote FUERA de cuadro: se pega al borde y lo avisa (devuelve true)
  TD._st.panX = 3000;
  const fuera = TD._dibujarPivote(TD._centroElemento3D(), false);
  const px = parseFloat(punto.style.left);
  ok(fuera === true && punto.className.indexOf('fuera') > 0,
    'con el pivote fuera de cuadro se marca como "fuera" y se avisa (' + punto.className + ')');
  ok(px >= 8 && px <= W - 8, 'y el punto queda PEGADO AL BORDE, no desaparecido (left=' + punto.style.left + ')');

  // pivote DETRÁS de la cámara: se esconde (marcarlo en un borde mentiría sobre el lado)
  TD._st.panX = 0;
  const atras = TD._ojoCam().clone().addScaledVector(TD._baseCam().atras, 300);
  ok(TD._dibujarPivote(atras, true) === true && punto.className === 'te-pivote',
    'detrás de la cámara el punto se esconde en vez de mentir sobre el borde');

  TD._dibujarPivote(pd, true);
  TD._ocultarPivote();
  ok(punto.className === 'te-pivote', 'y al soltar el botón se apaga (no queda pegado en pantalla)');
}

console.log('\n' + (fallos ? '✗ ' + fallos + ' fallo(s)' : '✓ todo verde'));
process.exit(fallos ? 1 : 0);
