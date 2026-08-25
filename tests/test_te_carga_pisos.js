// Test headless (Node) de las DOS cosas que el Template Editor gana en la misión de
// trazabilidad de muros: la CARGA MULTI-PISO y el MODO SOLO-VISTA.
//
// POR QUÉ EXISTE
// -------------
// 1) ORIGEN 'enfierrador' — las barras que el editor 3D carga al despiece dejan de
//    confundirse con las del resto. El estampado vive en _barrasPayload (el editor),
//    NO en generar.js: el motor es común a la biblioteca y a la obra, y lo que define
//    el origen de una barra es POR DÓNDE SALE. tests/test_generar.js:71 congela la
//    salida del motor en 'template'; este test congela la otra mitad — y que las dos
//    convivan a propósito.
// 2) MULTI-PISO — un muro de eje se repite igual piso a piso. Cargarlo N veces a mano
//    (cambiando el campo Piso entre pasada y pasada) era N oportunidades de
//    equivocarse. Ahora se marcan los pisos y se crea UNA estructura por piso con la
//    MISMA receta. Lo que hay que blindar es lo que NO se ve: que cada barra viaje con
//    SU piso, que cada instancia lleve su nombre derivado, que la cadena sea SECUENCIAL
//    y que un piso fallido diga cuáles entraron en vez de dejar media carga en silencio.
// 3) SOLO VISTA — con el despiece banderado el 3D abre para MIRAR. El riesgo real no es
//    que se pueda escribir en la BD (los tres canales están cortados), es que el editor
//    PAREZCA editable: por eso se comprueban las dos capas, el cromo y las guardas.
//
// CONTRATOS QUE FIJA:
//   P0 · _barrasPayload estampa origen='enfierrador'; el MOTOR sigue diciendo 'template'.
//   P1 · _pisosACargar: sin marcar manda el campo Piso; marcando manda la selección;
//        regenerando manda SIEMPRE el piso de la instancia abierta.
//   P2 · N pisos = N instancias + N cargas de barras, cada una con SU piso y SU nombre.
//        El editor queda apuntando a la PRIMERA y la grilla se refresca UNA vez.
//   P3 · Si un piso falla, se detiene y DICE cuáles entraron; el editor queda fijado en
//        la primera instancia para que reintentar no duplique lo que ya entró.
//   P4 · soloVista: cromo (banner + controles apagados con motivo) y guardas (ni cargar
//        al despiece, ni guardar template, ni borrador, ni atajos que muten).
//   P5 · Sin soloVista y con un solo piso, todo queda EXACTAMENTE como antes.
//
// Corre el template_editor.js REAL sobre el mismo mini-DOM que tests/test_te_puerta_entrada.js
// (no hay jsdom en el proyecto). Correr con: node tests/test_te_carga_pisos.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RAIZ = path.join(__dirname, '..', 'armahub');
const BASE = path.join(RAIZ, 'static', 'js', 'features', 'modelador');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }

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
  this.tagName = String(tag || 'div').toUpperCase(); this.nodeName = this.tagName;
  this._doc = doc; this.children = []; this.childNodes = this.children; this.parentNode = null;
  this.style = {}; this.dataset = {}; this._attrs = {}; this._listeners = {};
  this._text = ''; this._html = ''; this.value = ''; this.disabled = false;
  this.className = ''; this.classList = classList(this); this.id = ''; this.title = '';
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

function sesion() {
  const doc = new Doc(), ls = memLocalStorage();
  const pendientes = new Map(); let nextId = 1;
  const win = {};
  win.window = win; win.self = win; win.document = doc; win.localStorage = ls;
  win.navigator = { userAgent: 'node' };
  win.location = { href: 'http://x/', origin: 'http://x' };
  win.console = { log() {}, warn(m) { win._warns.push(String(m)); }, error() {} };
  win._warns = [];
  win.JSON = JSON; win.Math = Math; win.Date = Date; win.Object = Object; win.Array = Array;
  win.Number = Number; win.String = String; win.Boolean = Boolean; win.isFinite = isFinite;
  win.parseFloat = parseFloat; win.parseInt = parseInt; win.isNaN = isNaN; win.Error = Error;
  win.Promise = Promise; win.encodeURIComponent = encodeURIComponent;
  win._alerts = []; win._confirms = []; win._confirmRespuesta = true;
  win.alert = (m) => { win._alerts.push(String(m)); };
  win.confirm = (m) => { win._confirms.push(String(m)); return win._confirmRespuesta; };
  win._llamadas = [];
  win._responder = () => ({ status: 200, body: {} });
  win.fetch = function (url, opts) {
    opts = opts || {};
    let cuerpo = null;
    try { cuerpo = opts.body ? JSON.parse(opts.body) : null; } catch (e) { cuerpo = opts.body; }
    win._llamadas.push({ url: String(url), metodo: (opts.method || 'GET').toUpperCase(), body: cuerpo });
    const r = win._responder(String(url), opts) || { status: 200, body: {} };
    if (r.red === false) return Promise.reject(new Error('sin red'));
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => Promise.resolve(r.body || {})
    });
  };
  win.requestAnimationFrame = () => 0;   // el 3D no entra en este test
  win.cancelAnimationFrame = () => {};
  win.setTimeout = (fn, ms) => { const id = nextId++; pendientes.set(id, { fn, ms }); return id; };
  win.clearTimeout = (id) => { pendientes.delete(id); };
  win.setInterval = () => 0; win.clearInterval = () => {};
  win._listeners = {};
  win.addEventListener = (t, fn) => { (win._listeners[t] = win._listeners[t] || []).push(fn); };
  win.removeEventListener = () => {};
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
  vm.runInContext(fs.readFileSync(path.join(BASE, 'template_editor.js'), 'utf8'), ctx, { filename: 'template_editor.js' });

  win._el = (id) => doc.getElementById(id);
  win._abierto = () => doc.getElementById('te_backdrop').classList.contains('on');
  win._ls = ls;
  return win;
}

const tick = () => new Promise(r => setImmediate(r));
const reposo = async () => { for (let i = 0; i < 12; i++) await tick(); };

const CTX = {
  loteId: 42, id_proyecto: 'EXPLORA', sector: 'VCIELO', ciclo: 'C1',
  eje: 'E3', nombre_plano: 'P-101', estructura: 'MURO'
};
const PISOS = ['S1', 'P1', 'P2', 'P3'];

// Backend de mentira: instancias con id correlativo (para poder distinguirlas) y
// pisos de la obra. `fallaEnPiso` corta la carga del piso que se le diga — y la corta
// en el POST de barras, que es el que de verdad falla en producción (400 por ubicación,
// figura inválida, red) y el que dejaba estructuras huérfanas cuando eran dos llamadas.
// Este backend las escribe JUNTAS: si la carga falla, NO se registra instancia.
function backend(win, opts) {
  opts = opts || {};
  let sig = 100;
  win._instancias = [];
  win._responder = (url, o) => {
    const metodo = ((o && o.method) || 'GET').toUpperCase();
    if (/pisos-combinados/.test(url)) {
      return { status: 200, body: { pisos: PISOS.map(p => ({ valor: p, tiene_barras: false })) } };
    }
    if (/\/elementos\/instancia$/.test(url) && metodo === 'POST') {
      // El endpoint sigue existiendo (guardar SÓLO la receta), pero ya no lo llama
      // ningún front: el editor no entra por aquí en su primera carga porque serían
      // dos transacciones. Si alguien la revive, los contratos de abajo lo delatan.
      const cuerpo = JSON.parse(o.body);
      const id = ++sig;
      win._instancias.push({ id, piso: cuerpo.piso });
      return { status: 200, body: { ok: true, id } };
    }
    if (/\/elementos\/instancia\/\d+$/.test(url)) return { status: 200, body: { ok: true } };
    if (/\/barras\/sync$/.test(url)) {
      return { status: 200, body: { ok: true, actualizadas: 7, creadas: 1, eliminadas: 2 } };
    }
    if (/\/lotes\/42\/barras$/.test(url)) {
      const cuerpo = JSON.parse(o.body);
      const piso = cuerpo.instancia ? cuerpo.instancia.piso : null;
      if (opts.fallaEnPiso && piso === opts.fallaEnPiso) {
        // TRANSACCIÓN: la estructura se va con las barras. No se registra nada.
        return { status: 500, body: { detail: 'la BD dijo que no' } };
      }
      const id = ++sig;
      win._instancias.push({ id, piso });
      return { status: 200, body: { ok: true, creadas: 9, instancia_id: id } };
    }
    return { status: 200, body: {} };
  };
}

const postsA = (win, re) => win._llamadas.filter(l => l.metodo === 'POST' && re.test(l.url));
// ST.elemento se guarda en minúscula o mayúscula según de dónde venga: se compara normalizado.
const _figLow = (v) => String(v == null ? '' : v).trim().toLowerCase();

(async function () {
  // ============================================================== P0
  console.log("P0 — el payload dice 'enfierrador'; el MOTOR sigue diciendo 'template'");
  {
    const w = sesion(); backend(w);
    w.templateEditorAbrirEnObra(CTX, { receta: w.ModeladorSemilla.semillaViga(), piso: 'P4' });
    const TE = w.TemplateEditor, ST = TE._st;
    const pay = TE._barrasPayload(55);
    ok(pay.length > 0, 'hay barras en el payload (' + pay.length + ')');
    ok(pay.every(b => b.origen === 'enfierrador'),
      "todas salen con origen='enfierrador' (la etiqueta de las barras del editor 3D)");
    ok(ST.ultimoOut.barras.every(b => b.origen === 'template'),
      "y el MOTOR no se toca: su salida sigue en 'template' (contrato de test_generar.js:71)");
    ok(pay.every(b => b.template_instancia_id === 55),
      'la traza contra la instancia se mantiene: es el dato de raíz, origen es la etiqueta');
    ok(pay.every(b => !Object.keys(b).some(k => k.charAt(0) === '_')),
      'y sin las claves de trabajo del front');

    // El piso opcional del payload: es lo que hace posible mandar la MISMA generación
    // a N pisos sin regenerar N veces.
    const conPiso = TE._barrasPayload(56, 'S1');
    ok(conPiso.every(b => b.piso === 'S1'), 'con piso explícito, cada barra viaja con ESE piso');
    ok(ST.ultimoOut.barras.every(b => b.piso === 'P4'),
      'y la generación en pantalla no se toca (el payload es una copia, no la fuente)');
  }

  // ============================================================== P1
  console.log('P1 — qué pisos se cargan: campo único, selección, o el de la instancia');
  {
    const w = sesion(); backend(w);
    w.templateEditorAbrirEnObra(CTX, { receta: w.ModeladorSemilla.semillaViga(), piso: 'P4' });
    const TE = w.TemplateEditor, ST = TE._st;
    await reposo();
    ok(JSON.stringify(TE._pisosACargar()) === '["P4"]',
      'sin nada marcado manda el campo Piso (el flujo de siempre, intacto)');
    ok(ST._pisosObra && ST._pisosObra.join(',') === PISOS.join(','),
      'la lista de pisos llega del MISMO endpoint que usa la grilla del despiece');
    ok((ST._pisosSel || []).length === 0,
      'y pintar el selector NO siembra selección (el render lee, no escribe)');

    TE._togglePisoSel('P2', true);
    TE._togglePisoSel('S1', true);
    ok(JSON.stringify(TE._pisosACargar()) === '["S1","P2"]',
      'con pisos marcados manda la selección, en el ORDEN DE LA OBRA (S1 antes que P2)');
    TE._togglePisoSel('P2', false);
    ok(JSON.stringify(TE._pisosACargar()) === '["S1"]', 'desmarcar lo saca');
    TE._togglePisoSel('S1', false);
    ok(JSON.stringify(TE._pisosACargar()) === '["P4"]', 'y sin nada marcado vuelve a mandar el campo');

    // REGENERANDO no hay multi-piso: el piso es el de la instancia abierta.
    ST.instanciaId = 77;
    TE._togglePisoSel('P1', true); TE._togglePisoSel('P2', true);
    ok(JSON.stringify(TE._pisosACargar()) === '["P4"]',
      'regenerando manda SIEMPRE el piso de la instancia, aunque haya pisos marcados');
    TE._sincronizarSelectorPisos();
    ok(w._el('te_pisosBtn').disabled === true, 'y el botón queda apagado');
    ok(/PRIMERA carga/.test(w._el('te_pisosBtn').title),
      'DICIENDO por qué (no desaparece en silencio)');
    ok(w._el('te_pisosWrap').style.display === '', 'pero SIGUE A LA VISTA');
  }

  // ============================================================== P2
  console.log('P2 — N pisos = N estructuras con la MISMA receta');
  {
    const w = sesion(); backend(w);
    let refrescos = 0;
    w.ac2CargarLote = () => { refrescos++; };
    w.templateEditorAbrirEnObra(CTX, { receta: w.ModeladorSemilla.semillaViga(), piso: 'P4' });
    const TE = w.TemplateEditor, ST = TE._st;
    await reposo();
    ['S1', 'P1', 'P2'].forEach(p => TE._togglePisoSel(p, true));
    ok(w._el('te_pisosResumen').textContent.indexOf('S1, P1, P2') >= 0,
      'el ribbon DICE lo que se va a cargar (con pisos marcados, el campo Piso deja de mandar)');

    w.templateEditorCargarAlDespiece();
    await reposo();

    const inst = postsA(w, /\/elementos\/instancia$/);
    const carga = postsA(w, /\/lotes\/42\/barras$/);
    ok(inst.length === 0,
      'NINGÚN POST suelto de estructura: cada una entra con SUS barras, en una transacción');
    ok(carga.length === 3, 'se hacen 3 cargas, una por piso (hay ' + carga.length + ')');
    ok(carga.every(c => !!c.body.instancia), 'y las 3 llevan su estructura en el mismo cuerpo');
    ok(carga.map(l => l.body.instancia.piso).join(',') === 'S1,P1,P2',
      'en el orden de la obra, cada una con SU piso');
    ok(carga.map(l => l.body.instancia.nombre).join(' | ') ===
       'EXPLORA · C1 · S1 · E3 | EXPLORA · C1 · P1 · E3 | EXPLORA · C1 · P2 · E3',
      'y con el nombre DERIVADO de obra · ciclo · SU piso · eje');
    ok(carga.every(l => JSON.stringify(l.body.instancia.params) === JSON.stringify(ST.receta)),
      'las 3 guardan la MISMA receta (es una repetición, no tres diseños)');
    ok(carga.every(c => c.body.barras.length > 0), 'las 3 mandan barras');
    ok(carga[0].body.barras.every(b => b.piso === 'S1') &&
       carga[1].body.barras.every(b => b.piso === 'P1') &&
       carga[2].body.barras.every(b => b.piso === 'P2'),
      'y CADA barra viaja con el piso de SU estructura');
    ok(carga.every(c => c.body.barras.every(b => b.origen === 'enfierrador')),
      "todas con origen='enfierrador'");
    ok(carga.every(c => c.body.barras.every(b => b.template_instancia_id === null)),
      'sin id de instancia inventado por el front: lo estampa quien escribe la fila');
    const ids = w._instancias.map(i => i.id);
    ok(new Set(ids).size === 3 && ids.every(i => i != null),
      'y el backend devolvió tres estructuras distintas, una por carga');
    ok(carga.every(c => c.body.barras.every(b => !!b.origen_ref)),
      'con su identificador de origen (los origen_ref se repiten entre instancias: el cruce es POR instancia)');

    ok(ST.instanciaId === w._instancias[0].id && ST.piso === 'S1',
      'el editor queda apuntando a la PRIMERA estructura creada');
    ok(w._el('te_btnCargarDespiece').textContent.indexOf('Actualizar') >= 0,
      'y el botón pasa a ACTUALIZAR sobre ella (las demás se reabren desde la grilla)');
    ok((ST._pisosSel || []).length === 0,
      'la multi-selección se limpia: es de la primera carga, no un estado pegajoso');
    ok(refrescos === 1, 'la grilla del despiece se refresca UNA sola vez, al final');
    ok(/3 pisos/.test(w._el('te_ctoolsStatus').innerHTML) &&
       /S1, P1, P2/.test(w._el('te_ctoolsStatus').innerHTML),
      'y el resumen dice en qué pisos entró');
  }

  // ============================================================== P3
  console.log('P3 — si un piso falla, se detiene y DICE cuáles entraron');
  {
    const w = sesion(); backend(w, { fallaEnPiso: 'P1' });
    w.templateEditorAbrirEnObra(CTX, { receta: w.ModeladorSemilla.semillaViga(), piso: 'P4' });
    const TE = w.TemplateEditor, ST = TE._st;
    await reposo();
    ['S1', 'P1', 'P2'].forEach(p => TE._togglePisoSel(p, true));
    w.templateEditorCargarAlDespiece();
    await reposo();

    ok(postsA(w, /\/elementos\/instancia$/).length === 0,
      'no hay POST suelto de estructura que pueda quedar escrito sin sus barras');
    ok(postsA(w, /\/lotes\/42\/barras$/).length === 2,
      'se intentaron S1 y P1 y ahí paró: P2 no se llegó a mandar');
    // ESTE es el contrato de las huérfanas: el piso que falla no deja NADA. Antes de
    // esto, P1 dejaba su fila de elementos_template creada (0 barras, 0 kg) porque la
    // estructura se escribía en una llamada anterior a la de las barras.
    ok(w._instancias.length === 1 && w._instancias[0].piso === 'S1',
      'y el piso fallido NO dejó estructura: sólo existe la de S1 (hay ' + w._instancias.length + ')');
    const err = w._el('te_saveErr').textContent;
    ok(/P1/.test(err), 'el error nombra el piso que falló');
    ok(/Ya entraron: S1/.test(err), 'y dice cuáles SÍ entraron (media carga en silencio es lo peor)');
    ok(ST.instanciaId === w._instancias[0].id,
      'el editor queda fijado en la estructura que sí entró: reintentar no la duplica');
    ok(w._el('te_btnCargarDespiece').disabled === false, 'y el botón vuelve a estar operativo');
  }

  // ============================================================== P4
  console.log('P4 — soloVista: se ve, no se toca, y se dice por qué');
  {
    const w = sesion(); backend(w);
    // Hay un borrador de otra sesión esperando: mirar un muro NO puede ofrecerlo
    // (recuperarlo reemplazaría la receta que se vino a ver).
    w._ls.setItem('te_borrador', JSON.stringify({
      nombre: 'Otra cosa', elemento: 'viga', templateId: null,
      receta: w.ModeladorSemilla.semillaViga(), ts: Date.now()
    }));
    w.templateEditorAbrirEnObra(CTX, {
      receta: w.ModeladorSemilla.semillaViga(), piso: 'P4', instanciaId: 77, soloVista: true
    });
    const TE = w.TemplateEditor, ST = TE._st;
    await reposo();
    ok(w._abierto() === true, 'el modal abre (es el MISMO editor, no un visor aparte)');
    ok(ST.soloVista === true, 'con el modo puesto');

    // --- cromo: apagado PERO a la vista, con motivo
    const motivo = TE.MOTIVO_SOLOVISTA;
    ok(w._el('te_soloVistaBar').classList.contains('on'), 'el banner de solo visualización se ve');
    ok(w._el('te_modal').classList.contains('te-solovista'),
      'y el modal lleva la clase que apaga por CSS lo que se repinta solo');
    ['te_btnCargarDespiece', 'te_btnGuardar', 'te_btnGuardarNuevo', 'te_btnAgregarBarra',
     'te_btnBorrar', 'te_btnEspejar', 'te_ribTemplate'].forEach(id => {
      const el = w._el(id);
      ok(el.disabled === true && el.title === motivo, id + ' apagado y con el motivo en el title');
    });
    ['te_nombre', 'te_ribPiso'].forEach(id => {
      ok(w._el(id).readOnly === true, id + ' queda de sólo lectura (es lo que se viene a leer)');
    });
    ok(w._el('te_btnCargarDespiece').style.display === '',
      'y NINGUNO se esconde: un control que desaparece no explica nada');

    // --- guardas: los tres canales de escritura, cortados
    const antes = w._llamadas.length;
    w.templateEditorCargarAlDespiece();
    ok(w._llamadas.length === antes, 'cargar al despiece no llama al backend');
    ok(w._el('te_saveErr').textContent === motivo, 'y dice por qué');
    w.templateEditorGuardar();
    w.templateEditorGuardarComoNuevo();
    ok(w._llamadas.length === antes, 'guardar template tampoco (ni "guardar como nuevo")');

    TE._guardarBorradorAhora();
    TE._ofrecerBorrador();
    ok(w._el('te_borrador').classList.contains('on') === false,
      'no se ofrece recuperar un borrador ajeno: recuperarlo sería editar por la puerta de atrás');

    // --- guardas: las acciones que mutan la receta
    const nComps = ST.receta.componentes.length;
    TE._seleccionar(0);
    TE._borrarSeleccion();
    TE._duplicar(0);
    TE._entrarModoColocacion();
    ok(ST.receta.componentes.length === nComps,
      'borrar, duplicar y colocar no tocan la receta (la papelera de la teja entra por la misma puerta)');
    ok(ST.tool !== 'colocar', 'no se entra en modo colocación');
    ok(TE._bloqueadoSoloVista() === true, 'y el cortafuegos lo dice explícitamente');

    // --- lo que SÍ sigue vivo: mirar
    ok(ST.selCi === 0, 'seleccionar una barra sigue funcionando: leer su ficha es a lo que se viene');
    ok(ST.ultimoOut && ST.ultimoOut.barras.length > 0, 'y la estructura está generada y a la vista');
  }

  // ============================================================== P5
  console.log('P5 — sin soloVista y con un piso, todo queda como antes');
  {
    const w = sesion(); backend(w);
    w.templateEditorAbrirEnObra(CTX, { receta: w.ModeladorSemilla.semillaViga(), piso: 'P4' });
    const TE = w.TemplateEditor, ST = TE._st;
    await reposo();
    ok(ST.soloVista === false, 'el modo llega apagado si nadie lo pide');
    ok(w._el('te_soloVistaBar').classList.contains('on') === false, 'sin banner');
    ok(w._el('te_btnCargarDespiece').disabled === false, 'y con el botón de cargar operativo');

    w.templateEditorCargarAlDespiece();
    await reposo();
    const inst = postsA(w, /\/elementos\/instancia$/);
    const carga = postsA(w, /\/lotes\/42\/barras$/);
    ok(inst.length === 0 && carga.length === 1, 'una sola llamada: la estructura va dentro de ella');
    ok(carga[0].body.instancia.piso === 'P4' &&
       carga[0].body.instancia.nombre === 'EXPLORA · C1 · P4 · E3',
      'con el piso del campo y el nombre derivado de siempre');
    ok(carga[0].body.barras.every(b => b.piso === 'P4'), 'y sus barras con ese piso');
    ok(ST.instanciaId === w._instancias[0].id, 'el editor queda sobre la estructura creada');
  }

  // ============================================================== P6
  // EL ELEMENTO LO TRAE EL DESPIECE (25-ago). El lote guarda su `estructura` desde que
  // se crea y viaja en el contexto: al abrir el enfierrador ya está decidido si lo que
  // se arma es un muro o una viga. Lo que se congela acá es la PUERTA — que el dato
  // llegue normalizado y que la traba dependa de que HAYA dato, no del modo a secas.
  console.log('P6 — el elemento viene del despiece: en obra no se elige');
  {
    const w = sesion(); backend(w);
    // 'muro' en minúscula A PROPÓSITO: la estructura del lote puede venir 'MURO',
    // 'muro' o 'Muro' y las tres son el mismo dato.
    const ctxMuro = Object.assign({}, CTX, { estructura: 'muro' });
    w.templateEditorAbrirEnObra(ctxMuro, { piso: 'P4' });
    const TE = w.TemplateEditor, ST = TE._st;
    await reposo();
    ok(ST.elemFijo === 'MURO', "la estructura del lote llega normalizada (elemFijo = " + ST.elemFijo + ')');
    ok(_figLow(ST.elemento) === 'muro', 'y el editor abre en ESE elemento, no en la viga por defecto');
    const html = String(w._el('te_elemBtns').innerHTML);
    ok(/data-elem="VIGA"[^>]*\bdisabled\b/.test(html) && /data-elem="MURO"[^>]*\bdisabled\b/.test(html),
      'los botones de elemento quedan apagados (ninguno se ofrece)');
    ok(html.indexOf('data-elem="VIGA"') >= 0 && html.indexOf('te-elemfijo') >= 0,
      'sin esconder ninguno y diciendo por qué al lado');
    TE._cambiarElemento('VIGA');
    ok(_figLow(ST.elemento) === 'muro', 'y el cambio por código muere en la guarda');

    // Sin estructura (lote antiguo): NO hay traba. La condición es el DATO.
    const w2 = sesion(); backend(w2);
    const ctxViejo = Object.assign({}, CTX); delete ctxViejo.estructura;
    w2.templateEditorAbrirEnObra(ctxViejo, { piso: 'P4' });
    const TE2 = w2.TemplateEditor, ST2 = TE2._st;
    await reposo();
    ok(ST2.elemFijo === null, 'un despiece SIN estructura no traba nada');
    const html2 = String(w2._el('te_elemBtns').innerHTML);
    ok(!/data-elem="MURO"[^>]*\bdisabled\b/.test(html2) && html2.indexOf('te-elemfijo') < 0,
      'y ahí sí se elige: quedarse bloqueado sin salida sería encerrar al usuario');
    TE2._cambiarElemento('MURO');
    ok(_figLow(ST2.elemento) === 'muro', 'el cambio funciona como siempre');

    // Una estructura que el editor NO conoce tampoco puede trabar: lo que no se puede
    // pintar no se puede imponer.
    const w3 = sesion(); backend(w3);
    w3.templateEditorAbrirEnObra(Object.assign({}, CTX, { estructura: 'ESCALERA' }), { piso: 'P4' });
    await reposo();
    ok(w3.TemplateEditor._st.elemFijo === null,
      'una estructura desconocida deja la elección abierta en vez de fijar un elemento inventado');
  }

  console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
  process.exitCode = fallos ? 1 : 0;
})();
