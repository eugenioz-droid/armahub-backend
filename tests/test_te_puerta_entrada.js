// Test headless (Node) de la PUERTA DE ENTRADA del Template Editor.
//
// POR QUÉ EXISTE: al editor se entra por UN solo lugar — el Gestor de templates del
// tab (Catálogo › Template Editor): "Crear template" con un nombre, o "Abrir" en una
// fila de la lista. Hasta el 19-ago había una SEGUNDA puerta escondida: llamar a
// templateEditorAbrir() sin argumentos abría el editor con la semilla de viga
// hardcodeada ("Viga tipo Explora"), sin nombre y sin templateId — un template
// fantasma que no salía de la lista y que al guardar creaba una copia huérfana.
// Nadie la usaba, así que se cerró. Este test impide que vuelva a abrirse: si mañana
// alguien agrega otro botón que llame directo al modal, uno de estos contratos falla.
//
// CONTRATOS QUE FIJA:
//   E0 · Sin cfg NO se abre nada (ni se inventa receta, nombre o elemento).
//   E1 · Con cfg pero SIN elemento tampoco se abre.
//   E2 · Sin nombre, "Crear template" no abre (el botón está deshabilitado).
//   E3 · "Crear template" con nombre abre en blanco: ese nombre, cero componentes y
//        SIN templateId (todavía no existe en la biblioteca).
//   E4 · "Abrir" de la lista pide GET /templates/{id} y entra con esa receta y ese id.
//   E5 · "📂 Abrir" del titlebar devuelve a la lista: cierra el modal y la re-pide.
//   E6 · ESTRUCTURAL — templateEditorAbrir se llama desde CINCO sitios y sólo cinco:
//        los dos del gestor (las puertas del Catálogo), el "Recuperar" de la barra de
//        borrador —que ya vive dentro del editor abierto— y los dos del MODO OBRA:
//        templateEditorAbrirEnObra (la puerta del despiece, la que llama Agregar
//        Cubicación) y _cargarRecetaTemplateEnObra (llamar un template sin salir del
//        despiece). Los cinco están DENTRO de template_editor.js: ningún otro archivo
//        JS ni plantilla HTML abre el modal por su cuenta. El modo obra NO es un fork:
//        entra por la MISMA función, sólo que con ctxObra en el cfg.
//
// Corre el template_editor.js REAL sobre un mini-DOM (no hay jsdom en el proyecto),
// igual que tests/test_te_biblioteca.js. Correr con: node tests/test_te_puerta_entrada.js

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

  win._correrTimers = function (rondas) {
    for (let r = 0; r < (rondas || 5); r++) {
      const ids = Array.from(pendientes.keys());
      if (!ids.length) return;
      ids.forEach(id => { const t = pendientes.get(id); if (t) { pendientes.delete(id); t.fn(); } });
    }
  };
  win._el = (id) => doc.getElementById(id);
  win._abierto = () => doc.getElementById('te_backdrop').classList.contains('on');
  return win;
}

const tick = () => new Promise(r => setImmediate(r));

// Recorre un árbol y devuelve los archivos con la extensión pedida.
function archivos(dir, ext, acc) {
  acc = acc || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) archivos(p, ext, acc);
    else if (e.name.endsWith(ext)) acc.push(p);
  });
  return acc;
}
// Comentarios fuera: lo que se cuenta son LLAMADAS, no menciones en la documentación
// del archivo (que las hay, y son las que explican esta misma regla).
function sinComentariosJs(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '');
}

(async function () {
  // ============================================================== E0 / E1
  console.log('E0/E1 — llamar al modal sin pasar por el gestor NO abre nada');
  {
    const w = sesion();
    w.templateEditorAbrir();
    ok(w._abierto() === false, 'sin cfg el modal NO se abre');
    ok(w.TemplateEditor._st.receta == null, 'y no se inventa una receta de semilla');
    ok(w._warns.length === 1 && /Gestor de templates/.test(w._warns[0]),
      'se avisa por consola que la entrada es el Gestor de templates');

    w.templateEditorAbrir({ nombre: 'Sin elemento', dims: {} });
    ok(w._abierto() === false, 'con cfg pero sin elemento tampoco se abre');
    ok(w._el('te_nombre').value === '', 'el titlebar no quedó con un nombre a medias');
  }

  // ============================================================== E2
  console.log('E2 — "Crear template" sin nombre no entra');
  {
    const w = sesion();
    w.tplValidar();
    ok(w._el('tplBtnCrear').disabled === true, 'sin nombre el botón Crear está deshabilitado');
    w.tplCrearTemplate();
    ok(w._abierto() === false, 'y aunque se lo llame igual, no abre el editor');
  }

  // ============================================================== E3
  console.log('E3 — "Crear template" con nombre entra en blanco');
  {
    const w = sesion();
    w._el('tplNombre').value = '  Viga fundación tipo A  ';
    w.tplValidar();
    ok(w._el('tplBtnCrear').disabled === false, 'con nombre el botón se habilita');
    w.tplCrearTemplate();
    const ST = w.TemplateEditor._st;
    ok(w._abierto() === true, 'el modal se abre');
    ok(ST.nombre === 'Viga fundación tipo A', 'entra con el nombre escrito (sin espacios sobrantes)');
    ok(w._el('te_nombre').value === 'Viga fundación tipo A', 'y el titlebar lo muestra');
    ok(ST.templateId === null, 'sin templateId: todavía no existe en la biblioteca');
    ok(ST.receta.componentes.length === 0, 'nace con CERO componentes (nada de semilla)');
    ok(ST.elemento === 'viga', 'y con el elemento inicial del gestor');
    ok(Number(ST.receta.geometria.largo) > 0, 'el hormigón viene con las dimensiones por defecto');
  }

  // ============================================================== E4
  console.log('E4 — "Abrir" de la lista entra con la receta guardada');
  {
    const w = sesion();
    const receta = {
      tipo: 'viga',
      geometria: { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 },
      componentes: [{
        tipologia: 'ES', figura: '104D', diam: 8, dims: {},
        distribucion: { modo: 'linear', activa: true, sep: 15, rango: { from: -295, to: 295, sep: 15, eje: 'x' } }
      }]
    };
    w._responder = (url) => (/\/templates\/7$/.test(url)
      ? { status: 200, body: { id: 7, nombre: 'Viga eje 3', tipo: 'viga', obra: 'OBRA-7', params: receta, puede_modificar: true } }
      : { status: 200, body: { templates: [] } });
    w.tplAbrirTemplate(7);
    await tick();
    const ST = w.TemplateEditor._st;
    ok(/\/templates\/7$/.test(w._llamadas[0].url) && w._llamadas[0].metodo === 'GET',
      'pide la receta completa con GET /templates/{id}');
    ok(w._abierto() === true, 'y abre el editor');
    ok(String(ST.templateId) === '7', 'apuntando al template abierto (el guardado siguiente lo actualiza)');
    ok(ST.nombre === 'Viga eje 3', 'con su nombre');
    ok(ST.receta.componentes.length === 1, 'y con sus componentes, no con una semilla');

    // ---------------------------------------------------------- E5
    console.log('E5 — "📂 Abrir" del titlebar devuelve a la lista');
    const antes = w._llamadas.length;
    w.templateEditorVolverALista();
    ok(w._abierto() === false, 'el modal se cierra');
    ok(w._confirms.length === 0, 'sin cambios no pregunta nada');
    const nuevas = w._llamadas.slice(antes).filter(l => /\/templates(\?|$)/.test(l.url));
    ok(nuevas.length === 1 && nuevas[0].metodo === 'GET', 'y la lista se vuelve a pedir al volver');
  }

  // ============================================================== E7
  // MODO OBRA — el mismo editor haciendo de Enfierrador. Lo que se fija acá es que el
  // contexto de obra ENTRA POR LA PUERTA y llega hasta el payload: el hueco que había
  // era generarViga(receta, {}) — barras sin ubicación, que el backend rechaza porque
  // exige sector/piso/ciclo/eje en cada una.
  console.log('E7 — con contexto de obra el editor carga barras al despiece');
  {
    const w = sesion();
    const ctx = { loteId: 42, id_proyecto: 'EXPLORA', sector: 'VCIELO', ciclo: 'C1',
                  eje: 'E3', nombre_plano: 'P-101', estructura: 'VIGA' };
    w._responder = (url) => {
      if (/\/elementos\/instancia/.test(url)) return { status: 200, body: { ok: true, id: 55 } };
      if (/\/lotes\/42\/barras/.test(url)) return { status: 200, body: { ok: true, creadas: 9 } };
      return { status: 200, body: {} };
    };
    w.templateEditorAbrirEnObra(ctx, { receta: w.ModeladorSemilla.semillaViga() });
    const ST = w.TemplateEditor._st;
    ok(w._abierto() === true, 'la puerta del despiece abre el MISMO modal');
    ok(ST.ctxObra && ST.ctxObra.loteId === 42, 'con el contexto de obra puesto');
    ok(ST.templateId == null, 'y SIN templateId: guardar no puede pisar el template de la biblioteca');
    ok(w._el('te_grpObra').style.display === '' && w._el('te_btnCargarDespiece').style.display === '',
      'el grupo Despiece y el botón "Cargar al despiece" se ven');
    ok(w._el('te_btnVolverLista').style.display === 'none',
      'y "Abrir" (volver a la lista del Catálogo) no se ofrece desde un despiece');

    // Sin PISO no se manda nada: el backend lo exige por barra y el arreglo está en el ribbon.
    const antes = w._llamadas.length;
    w.templateEditorCargarAlDespiece();
    ok(w._llamadas.length === antes, 'sin piso NO se llama al backend');
    ok(/piso/i.test(w._el('te_saveErr').textContent), 'y se dice que falta el piso');

    // Con piso: la ubicación viaja en CADA barra y el origen las distingue de las del CSV.
    w._el('te_ribPiso').value = 'P4';
    w._el('te_ribPiso').dispatchEvent({ type: 'change' });
    ok(ST.piso === 'P4', 'el piso queda en el estado de la estructura (uno para todas sus barras)');
    const b0 = ST.ultimoOut.barras[0];
    ok(b0.piso === 'P4' && b0.sector === 'VCIELO' && b0.ciclo === 'C1' && b0.eje === 'E3',
      'y cada barra generada nace con la ubicación del despiece');
    ok(b0.nombre_plano === 'P-101', 'con el plano del lote');
    ok(b0.origen === 'template', 'y con origen propio (no se confunde con las del CSV ni las manuales)');

    w.templateEditorCargarAlDespiece();
    await tick(); await tick(); await tick();
    const post = w._llamadas.filter(l => l.metodo === 'POST');
    const inst = post.find(l => /\/elementos\/instancia$/.test(l.url));
    const carga = post.find(l => /\/lotes\/42\/barras$/.test(l.url));
    ok(!!inst, 'primero se guarda la traza de la estructura (elementos_template)');
    ok(!!carga, 'y las barras entran por POST /lotes/{id}/barras — el canal que ya existía');
    ok(carga && carga.body.barras.length > 0, 'con barras adentro');
    ok(carga && carga.body.barras.every(b => b.template_instancia_id === 55),
      'todas trazadas contra esa instancia');
    ok(carga && carga.body.barras.every(b => !Object.keys(b).some(k => k.charAt(0) === '_')),
      'y sin las claves de trabajo del front (largo y peso los calcula el backend)');
  }

  // ============================================================== E8
  console.log('E8 — sin contexto de obra el editor es el de siempre');
  {
    const w = sesion();
    w._el('tplNombre').value = 'Viga normal';
    w.tplValidar();
    w.tplCrearTemplate();
    const ST = w.TemplateEditor._st;
    ok(ST.ctxObra === null, 'ctxObra queda en null');
    ok(w._el('te_grpObra').style.display === 'none', 'el grupo Despiece no se ve');
    ok(w._el('te_btnCargarDespiece').style.display === 'none', 'ni el botón de cargar al despiece');
    const antes = w._llamadas.length;
    w.templateEditorCargarAlDespiece();
    ok(w._llamadas.length === antes, 'y llamarlo a mano no hace nada (no hay despiece al que cargar)');
  }

  // ============================================================== E6
  console.log('E6 — la puerta es UNA: nadie más llama al modal');
  {
    const teSrc = sinComentariosJs(fs.readFileSync(path.join(BASE, 'template_editor.js'), 'utf8'));
    // Cinco sitios y sólo cinco: los DOS del gestor (las puertas del Catálogo), el
    // "Recuperar" de la barra de borrador —que NO es una puerta: la barra sólo
    // aparece dentro del editor ya abierto— y los DOS del modo obra. El modo obra
    // reusa templateEditorAbrir a propósito: si se copiara el camino de apertura
    // tendríamos dos editores divergiendo, que es justo lo que se quiere evitar.
    const dueno = (idx) => {
      const anclas = ['function _bindBorrador', 'global.tplCrearTemplate', 'global.tplAbrirTemplate',
                      'function _cargarRecetaTemplateEnObra', 'global.templateEditorAbrirEnObra'];
      let quien = '(suelta)', mejor = -1;
      anclas.forEach(a => { const i = teSrc.lastIndexOf(a, idx); if (i > mejor) { mejor = i; quien = a; } });
      return quien;
    };
    const sitios = [];
    const re = /templateEditorAbrir\s*\(/g;
    let m;
    while ((m = re.exec(teSrc))) sitios.push(dueno(m.index));
    ok(sitios.length === 5, 'template_editor.js llama al modal en 5 sitios (hay ' + sitios.length + ')');
    ok(sitios.filter(s => s === 'global.tplCrearTemplate').length === 1, 'uno es "Crear template"');
    ok(sitios.filter(s => s === 'global.tplAbrirTemplate').length === 1, 'otro es "Abrir" de la lista');
    ok(sitios.filter(s => s === 'function _bindBorrador').length === 1,
      'el tercero es Recuperar borrador, que ya está dentro del editor');
    ok(sitios.filter(s => s === 'global.templateEditorAbrirEnObra').length === 1,
      'el cuarto es la puerta del DESPIECE (modo obra)');
    ok(sitios.filter(s => s === 'function _cargarRecetaTemplateEnObra').length === 1,
      'y el quinto es llamar un template sin salir del despiece');

    // El modo obra entra por templateEditorAbrirEnObra, NO por templateEditorAbrir:
    // el contexto de obra tiene que pasar por un solo sitio que lo valide.
    const abrenEnObra = archivos(path.join(RAIZ, 'static', 'js'), '.js')
      .filter(p => path.basename(p) !== 'template_editor.js')
      .filter(p => /templateEditorAbrirEnObra\s*\(/.test(sinComentariosJs(fs.readFileSync(p, 'utf8'))));
    ok(abrenEnObra.length === 1 && /agregar_cubicacion2\.js$/.test(abrenEnObra[0]),
      'y la puerta del despiece la usa sólo Agregar Cubicación');

    const otros = archivos(path.join(RAIZ, 'static', 'js'), '.js')
      .filter(p => path.basename(p) !== 'template_editor.js')
      .filter(p => /templateEditorAbrir\s*\(/.test(sinComentariosJs(fs.readFileSync(p, 'utf8'))));
    ok(otros.length === 0, 'ningún otro archivo JS del front abre el modal por su cuenta');

    // En las plantillas se busca el patrón real de invocación (onclick="…"), no la
    // mención: los comentarios del HTML nombran la función para documentar de dónde
    // sale, y eso no es una puerta.
    const htmls = archivos(path.join(RAIZ, 'templates'), '.html')
      .filter(p => /on\w+\s*=\s*["'][^"']*templateEditorAbrir/.test(fs.readFileSync(p, 'utf8')));
    ok(htmls.length === 0, 'ninguna plantilla HTML tiene un handler que abra el modal directo');

    // Y las DOS llamadas son las del gestor: se espían en vivo.
    const w = sesion();
    const vistos = [];
    w.templateEditorAbrir = (cfg) => { vistos.push(cfg); };
    w._el('tplNombre').value = 'Espía';
    w.tplValidar();
    w.tplCrearTemplate();
    w._responder = () => ({ status: 200, body: { id: 3, nombre: 'X', tipo: 'muro', params: { tipo: 'muro', geometria: {}, componentes: [] } } });
    w.tplAbrirTemplate(3);
    await tick();
    ok(vistos.length === 2, 'las dos llamadas salen de tplCrearTemplate y tplAbrirTemplate');
    ok(vistos[0].nombre === 'Espía' && vistos[0].receta == null, 'la de crear va sin receta');
    ok(vistos[1].templateId === 3 && !!vistos[1].receta, 'la de abrir va con receta y templateId');
  }

  console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
  process.exitCode = fallos ? 1 : 0;
})();
