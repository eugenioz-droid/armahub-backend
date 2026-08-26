// Test headless (Node) del BORRADOR AUTOMÁTICO del Template Editor
// (Tanda 3 · "no perder trabajo", punto 1).
//
// POR QUÉ EXISTE: el autoguardado se disparaba en CADA _regenerar(), y _regenerar()
// corre al ABRIR el editor. Resultado: la clave `te_borrador` se pisaba con el estado
// recién abierto milisegundos después de mostrar la barra "Recuperar" — el botón
// devolvía lo que ya estaba en pantalla y el trabajo real quedaba borrado. Encima,
// abrir y cerrar un template LIMPIO dejaba un borrador fantasma que se ofrecía en la
// apertura siguiente. Causa raíz: el borrador se escribía sin preguntar si había algo
// SIN GUARDAR que proteger.
//
// CONTRATOS QUE FIJA:
//   B0 · Abrir un template (limpio) NO escribe la clave ni agenda autoguardado.
//   B1 · Sólo se escribe con cambios sin guardar (_hayCambiosSinGuardar), y el
//        throttle sigue colapsando N regeneraciones en pocas escrituras.
//   B2 · Con la barra ofreciendo un borrador, correr los timers NO lo pisa, y
//        [Recuperar] entrega EXACTAMENTE lo que la barra prometió — aunque el usuario
//        haya seguido editando (su trabajo en vivo queda en la clave, no se pierde).
//   B3 · Ciclo F5 completo: beforeunload vuelca → sesión nueva ofrece → recuperar
//        devuelve la receta editada (componentes y dims), con su templateId.
//   B4 · Descartar borra la clave y la oferta; guardar con éxito borra la clave.
//
// Corre el template_editor.js REAL sobre un mini-DOM + localStorage de mentira
// (no hay jsdom en el proyecto). Correr con: node tests/test_te_borrador.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

// ---------------------------------------------------------------- mini-DOM
function classList(el) {
  const s = [];
  return {
    _s: s,
    add() { for (const c of arguments) if (s.indexOf(c) < 0) s.push(c); el.className = s.join(' '); },
    remove() { for (const c of arguments) { const i = s.indexOf(c); if (i >= 0) s.splice(i, 1); } el.className = s.join(' '); },
    toggle(c, on) { if (on === undefined) on = s.indexOf(c) < 0; if (on) this.add(c); else this.remove(c); },
    contains(c) { return s.indexOf(c) >= 0; }
  };
}
function El(tag, doc) {
  this.tagName = String(tag || 'div').toUpperCase(); this.nodeName = this.tagName;
  this._doc = doc; this.children = []; this.childNodes = this.children; this.parentNode = null;
  this.style = {}; this.dataset = {}; this._attrs = {}; this._listeners = {};
  this._text = ''; this._html = ''; this.value = ''; this.disabled = false;
  this.className = ''; this.classList = classList(this); this.id = '';
}
El.prototype.setAttribute = function (k, v) {
  this._attrs[k] = String(v);
  if (k === 'id') { this.id = String(v); if (this._doc) this._doc._byId[String(v)] = this; }
};
El.prototype.getAttribute = function (k) { return this._attrs.hasOwnProperty(k) ? this._attrs[k] : null; };
El.prototype.removeAttribute = function (k) { delete this._attrs[k]; };
El.prototype.hasAttribute = function (k) { return this._attrs.hasOwnProperty(k); };
El.prototype.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; };
El.prototype.insertBefore = function (c, ref) { const i = this.children.indexOf(ref); if (i < 0) return this.appendChild(c); c.parentNode = this; this.children.splice(i, 0, c); return c; };
El.prototype.removeChild = function (c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; };
El.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
El.prototype.addEventListener = function (t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); };
El.prototype.removeEventListener = function (t, fn) { const a = this._listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
El.prototype.dispatchEvent = function (ev) {
  ev = ev || {}; ev.target = ev.target || this;
  ev.preventDefault = ev.preventDefault || function () { ev.defaultPrevented = true; };
  ev.stopPropagation = ev.stopPropagation || function () {};
  (this._listeners[ev.type] || []).slice().forEach(function (fn) { fn.call(this, ev); }, this);
  return !ev.defaultPrevented;
};
El.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }; };
El.prototype.focus = function () {}; El.prototype.blur = function () {}; El.prototype.select = function () {};
El.prototype.querySelector = function () { return null; };
El.prototype.querySelectorAll = function () { return []; };
El.prototype.closest = function () { return null; };
El.prototype.contains = function () { return false; };
El.prototype.scrollIntoView = function () {};
El.prototype.getContext = function () { return null; };
Object.defineProperty(El.prototype, 'textContent', {
  get() { return this._text; },
  set(v) { this._text = String(v == null ? '' : v); this.children.length = 0; }
});
Object.defineProperty(El.prototype, 'innerHTML', {
  get() { return this._html; },
  set(v) { this._html = String(v == null ? '' : v); this.children.length = 0; }
});
Object.defineProperty(El.prototype, 'firstChild', { get() { return this.children[0] || null; } });
Object.defineProperty(El.prototype, 'lastChild', { get() { return this.children[this.children.length - 1] || null; } });

function Doc() {
  this._byId = {}; this._listeners = {};
  this.body = new El('body', this); this.documentElement = new El('html', this); this.head = new El('head', this);
}
Doc.prototype.createElement = function (t) { return new El(t, this); };
Doc.prototype.createElementNS = function (ns, t) { const e = new El(t, this); e._ns = ns; return e; };
Doc.prototype.createTextNode = function (t) { const e = new El('#text', this); e._text = String(t); return e; };
// El HTML del modal no se parsea: los ids se crean bajo demanda (el editor sólo los lee).
Doc.prototype.getElementById = function (id) {
  if (!this._byId[id]) { const e = new El('div', this); e.id = id; this._byId[id] = e; }
  return this._byId[id];
};
Doc.prototype.querySelector = function () { return null; };
Doc.prototype.querySelectorAll = function () { return []; };
Doc.prototype.addEventListener = function (t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); };
Doc.prototype.removeEventListener = function () {};
Doc.prototype.dispatchEvent = El.prototype.dispatchEvent;

function memLocalStorage() {
  const map = {};
  return {
    getItem(k) { return map.hasOwnProperty(k) ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; },
    clear() { for (const k in map) delete map[k]; },
    key(i) { return Object.keys(map)[i] || null; },
    get length() { return Object.keys(map).length; }
  };
}

// -------------------------------------------------- sandbox con el editor real
function sesion(opts) {
  opts = opts || {};
  const doc = new Doc(), ls = memLocalStorage();
  const pendientes = new Map(); let nextId = 1;
  const win = {};
  win.window = win; win.self = win; win.document = doc; win.localStorage = ls;
  win.navigator = { userAgent: 'node' };
  win.location = { href: 'http://x/', origin: 'http://x' };
  win.console = console;
  win.JSON = JSON; win.Math = Math; win.Date = Date; win.Object = Object; win.Array = Array;
  win.Number = Number; win.String = String; win.Boolean = Boolean; win.isFinite = isFinite;
  win.parseFloat = parseFloat; win.parseInt = parseInt; win.isNaN = isNaN; win.Error = Error;
  win.Promise = Promise;
  win._alerts = []; win._confirms = []; win._confirmRespuesta = true;
  win.alert = (m) => { win._alerts.push(String(m)); };
  win.confirm = (m) => { win._confirms.push(String(m)); return win._confirmRespuesta; };
  win.fetch = opts.fetch || (() => Promise.reject(new Error('sin red')));
  win.requestAnimationFrame = () => 0;   // NO ejecuta: el 3D no entra en este test
  win.cancelAnimationFrame = () => {};
  win.setTimeout = (fn, ms) => { const id = nextId++; pendientes.set(id, { fn, ms }); return id; };
  win.clearTimeout = (id) => { pendientes.delete(id); };
  win.setInterval = () => 0; win.clearInterval = () => {};
  win._listeners = {};
  win.addEventListener = (t, fn) => { (win._listeners[t] = win._listeners[t] || []).push(fn); };
  win.removeEventListener = (t, fn) => { const a = win._listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
  win.dispatchEvent = (ev) => {
    ev.preventDefault = ev.preventDefault || function () { ev.defaultPrevented = true; };
    (win._listeners[ev.type] || []).slice().forEach(fn => fn.call(win, ev));
    return ev;
  };
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
  // El dibujante 2D PURO (26-ago): la geometria de _dibujarVista2D vive ahi para que
  // la miniatura del Gestor de templates use EL MISMO dibujante. Es dependencia del
  // editor, no un adorno: sin el no se dibuja ni un cuadrante.
  mod('render2d.js', 'ModeladorRender2D');
  vm.runInContext(fs.readFileSync(path.join(BASE, 'template_editor.js'), 'utf8'), ctx, { filename: 'template_editor.js' });

  // El usuario "tarda": corre todos los timers pendientes (incluidos los que se agenden).
  win._correrTimers = function (rondas) {
    for (let r = 0; r < (rondas || 5); r++) {
      const ids = Array.from(pendientes.keys());
      if (!ids.length) return;
      ids.forEach(id => { const t = pendientes.get(id); if (t) { pendientes.delete(id); t.fn(); } });
    }
  };
  win._hayTimers = () => pendientes.size;
  win._store = ls;
  return win;
}

const KEY = 'te_borrador';
const DIMS = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const estribo = (sep) => ({
  tipologia: 'ES', figura: '104D', diam: 8, dims: {},
  distribucion: { modo: 'linear', activa: true, sep: sep, rango: { from: -295, to: 295, sep: sep, eje: 'x' } }
});
const clave = (w) => { const raw = w._store.getItem(KEY); return raw ? JSON.parse(raw) : null; };

// ================================================================ B0
console.log('B0 — abrir un template LIMPIO no fabrica borrador');
{
  const w = sesion();
  w.templateEditorAbrir({ elemento: 'viga', nombre: 'T-A', dims: DIMS });
  ok(w._hayTimers() === 0, 'la apertura no agenda autoguardado (timers=' + w._hayTimers() + ')');
  w._correrTimers();
  ok(clave(w) === null, 'no escribe te_borrador al abrir');
  w.templateEditorCerrar();
  ok(w._confirms.length === 0, 'cerrar sin tocar nada no pregunta');
  ok(clave(w) === null, 'cerrar limpio tampoco escribe');
  w.templateEditorAbrir({ elemento: 'viga', nombre: 'T-B', dims: Object.assign({}, DIMS, { largo: 400 }) });
  ok(!w.document.getElementById('te_borrador').classList.contains('on'),
    'abrir otro template NO ofrece recuperar el anterior (falso positivo)');
}

// ================================================================ B1
console.log('\nB1 — con cambios sin guardar sí escribe, y el throttle colapsa las escrituras');
{
  const w = sesion();
  w.templateEditorAbrir({ elemento: 'viga', nombre: 'T-thr', dims: DIMS });
  const ST = w.TemplateEditor._st;
  let escrituras = 0;
  const set0 = w._store.setItem.bind(w._store);
  w._store.setItem = (k, v) => { if (k === KEY) escrituras++; return set0(k, v); };
  for (let i = 0; i < 30; i++) { ST.receta.geometria.largo = 600 + i; w.TemplateEditor._regenerar(); }
  w._correrTimers();
  ok(escrituras > 0 && escrituras <= 3, '30 regeneraciones → ' + escrituras + ' escritura(s)');
  ok(clave(w).receta.geometria.largo === 629, 'queda el ÚLTIMO estado (largo=' + clave(w).receta.geometria.largo + ')');
  ok(w._store.getItem(KEY).indexOf('_avisos') < 0, 'los avisos del motor no viajan al borrador');
}

// ================================================================ B2
console.log('\nB2 — la barra de recuperación no se pisa a sí misma');
{
  const w = sesion();
  const perdida = { tipo: 'viga', geometria: Object.assign({}, DIMS, { largo: 999 }), componentes: [estribo(15)] };
  w._store.setItem(KEY, JSON.stringify({ nombre: 'PERDIDO', elemento: 'viga', receta: perdida, ts: Date.now() - 5 * 60000 }));
  w.templateEditorAbrir({ elemento: 'viga', nombre: 'OTRO', dims: DIMS });
  ok(w.document.getElementById('te_borrador').classList.contains('on'), 'barra visible al abrir');
  ok(/PERDIDO/.test(w.document.getElementById('te_borradorTxt').textContent), 'la barra nombra el borrador');
  w._correrTimers(); w._correrTimers();            // el usuario tarda en decidir
  ok(clave(w).nombre === 'PERDIDO', 'tras los timers la clave SIGUE siendo el borrador viejo');
  w.document.getElementById('te_borradorOk').dispatchEvent({ type: 'click' });
  const ST = w.TemplateEditor._st;
  ok(ST.nombre === 'PERDIDO' && ST.receta.geometria.largo === 999 && ST.receta.componentes.length === 1,
    'Recuperar carga el trabajo perdido (largo=' + ST.receta.geometria.largo + ', comps=' + ST.receta.componentes.length + ')');
  w._correrTimers();
  ok(clave(w) && clave(w).receta.geometria.largo === 999, 'tras recuperar la red de seguridad sigue en localStorage');
}

// ================================================================ B2b
console.log('\nB2b — si el usuario edita con la barra puesta, ni la oferta ni lo nuevo se pierden');
{
  const w = sesion();
  const perdida = { tipo: 'viga', geometria: Object.assign({}, DIMS, { largo: 999 }), componentes: [estribo(15)] };
  w._store.setItem(KEY, JSON.stringify({ nombre: 'PERDIDO', elemento: 'viga', receta: perdida, ts: Date.now() - 5 * 60000 }));
  w.templateEditorAbrir({ elemento: 'viga', nombre: 'OTRO', dims: DIMS });
  const ST = w.TemplateEditor._st;
  ST.receta.geometria.alto = 75;                   // ignora la barra y sigue trabajando
  w.TemplateEditor._regenerar();
  w._correrTimers();
  ok(clave(w).receta.geometria.alto === 75, 'el trabajo EN VIVO pasa a estar protegido en la clave');
  w.document.getElementById('te_borradorOk').dispatchEvent({ type: 'click' });
  ok(ST.nombre === 'PERDIDO' && ST.receta.geometria.largo === 999, 'Recuperar entrega lo que la barra prometía');
  ok(clave(w).receta.geometria.alto === 75, 'y lo editado en vivo queda en la clave (no se pierde)');
}

// ================================================================ B3
console.log('\nB3 — ciclo F5 completo (editar → beforeunload → sesión nueva → recuperar)');
{
  const guardada = { tipo: 'viga', geometria: Object.assign({}, DIMS), componentes: [estribo(20)] };
  const s1 = sesion();
  s1.templateEditorAbrir({ elemento: 'viga', nombre: 'VIGA-EJE-3', dims: guardada.geometria, receta: guardada, templateId: 42 });
  s1.TemplateEditor._st.receta.componentes.push({
    tipologia: 'CBS', figura: '101A', diam: 22, cara: 'sup', dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 4, gap: 0 }
  });
  s1.TemplateEditor._st.receta.geometria.alto = 80;
  s1.TemplateEditor._regenerar();
  s1._correrTimers();
  const ev = { type: 'beforeunload' }; s1.dispatchEvent(ev);
  ok(ev.returnValue === '' && ev.defaultPrevented === true, 'F5 con cambios dispara el aviso nativo');
  const volcado = s1._store.getItem(KEY);
  ok(JSON.parse(volcado).receta.componentes.length === 2, 'el volcado tiene los 2 componentes');

  const s2 = sesion();                              // página recargada, mismo localStorage
  s2._store.setItem(KEY, volcado);
  s2.templateEditorAbrir({ elemento: 'viga', nombre: 'VIGA-EJE-3', dims: guardada.geometria, receta: guardada, templateId: 42 });
  ok(s2.document.getElementById('te_borrador').classList.contains('on'), 'la sesión nueva ofrece el borrador');
  s2._correrTimers(); s2._correrTimers();
  s2.document.getElementById('te_borradorOk').dispatchEvent({ type: 'click' });
  const ST2 = s2.TemplateEditor._st;
  ok(ST2.receta.componentes.length === 2, 'componentes recuperados (' + ST2.receta.componentes.length + ', esperado 2)');
  ok(ST2.receta.geometria.alto === 80, 'dims recuperadas (alto=' + ST2.receta.geometria.alto + ', esperado 80)');
  ok(ST2.templateId === 42, 'templateId conservado');
}

// ================================================================ B4
console.log('\nB4 — Descartar y guardar-con-éxito limpian el borrador');
{
  const w = sesion();
  const perdida = { tipo: 'viga', geometria: Object.assign({}, DIMS, { largo: 999 }), componentes: [] };
  w._store.setItem(KEY, JSON.stringify({ nombre: 'PERDIDO', elemento: 'viga', receta: perdida, ts: Date.now() }));
  w.templateEditorAbrir({ elemento: 'viga', nombre: 'OTRO', dims: DIMS });
  w.document.getElementById('te_borradorNo').dispatchEvent({ type: 'click' });
  ok(clave(w) === null, 'Descartar borra la clave');
  ok(!w.document.getElementById('te_borrador').classList.contains('on'), 'Descartar oculta la barra');
  w.document.getElementById('te_borradorOk').dispatchEvent({ type: 'click' });
  ok(w.TemplateEditor._st.receta.geometria.largo === 600, 'Recuperar tras Descartar no resucita nada');
}
{
  let resolver;
  const w = sesion({ fetch: () => new Promise(r => { resolver = r; }) });
  w.templateEditorAbrir({ elemento: 'viga', nombre: 'T-save', dims: DIMS });
  w.TemplateEditor._st.receta.componentes.push(estribo(20));
  w.TemplateEditor._regenerar();
  w._correrTimers();
  ok(clave(w) !== null, 'hay borrador antes de guardar');
  w.templateEditorGuardar();
  resolver({ ok: true, status: 200, json: () => Promise.resolve({ id: 7 }) });
  setTimeout(function () {
    ok(clave(w) === null, 'guardar con éxito borra el borrador');
    console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
    process.exitCode = fallos ? 1 : 0;
  }, 60);
}
