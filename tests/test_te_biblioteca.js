// Test headless (Node) de la BIBLIOTECA DE TEMPLATES en la UI del Template Editor:
// nombre editable · Guardar (PUT) vs Guardar como nuevo (POST) · eliminar con 409 ·
// lista liviana con filtros · errores del backend en castellano.
//
// POR QUÉ EXISTE: hasta esta tanda "Guardar" SIEMPRE hacía POST — cada guardado
// creaba otra copia con el mismo nombre, no había forma de renombrar (el nombre
// venía fijo de la pantalla previa) ni de borrar nada, y un error del backend salía
// como "HTTP 422" pelado. El backend ya tiene PUT/DELETE/validación/permisos: estos
// contratos son los que impiden que la UI vuelva a quedar atrás.
//
// CONTRATOS QUE FIJA:
//   L0 · El nombre es EDITABLE y cuenta como cambio sin guardar (renombrar y cerrar
//        pregunta; el botón de guardar se enciende).
//   L1 · Con template abierto (templateId) el botón DICE "Guardar cambios" y hace
//        PUT /templates/{id} SIN mandar `obra` (el PUT es no destructivo: mandar
//        obra:null mudaría a "general" un template del Enfierrador).
//   L2 · "Guardar como nuevo" hace POST y CONSERVA la obra del original.
//   L3 · Template nuevo → POST; después del POST el editor apunta al id creado, así
//        que el guardado siguiente ya es PUT (se acabaron las copias).
//   L4 · puede_modificar=false → NO se manda PUT nunca (sería 403 seguro): el botón
//        ofrece crear una copia.
//   L5 · Errores: 422/403 muestran el detail del backend TAL CUAL; un 404 al
//        actualizar suelta el templateId y dice cómo salvar el trabajo.
//   L6 · La lista pide el GET liviano con ?nombre=&tipo= y pinta Abrir + 🗑
//        (🗑 deshabilitado si puede_modificar=false).
//   L7 · Eliminar confirma NOMBRANDO el template; un 409 NO borra y muestra cuántos
//        elementos lo usan.
//   L8 · Abrir un template cuya figura ya no está en el catálogo lo marca
//        (normalizador) y lo dice, en vez de abrir en silencio algo que no genera.
//
// Corre el template_editor.js REAL sobre un mini-DOM (no hay jsdom en el proyecto),
// igual que tests/test_te_borrador.js. Correr con: node tests/test_te_biblioteca.js

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

// --------------------------------------- sandbox con el editor real + red falsa
// La red se controla con w._responder: (url, opts) → {status, body}. Cada llamada
// queda registrada en w._llamadas para poder afirmar MÉTODO, URL y CUERPO.
function sesion() {
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
  win._ultima = () => win._llamadas[win._llamadas.length - 1] || null;
  // La ESCRITURA más reciente (POST/PUT/DELETE). Hace falta porque un guardado con
  // éxito recarga la lista: la última llamada siempre termina siendo el GET.
  win._ultimaEscritura = () => {
    for (let i = win._llamadas.length - 1; i >= 0; i--) {
      if (win._llamadas[i].metodo !== 'GET') return win._llamadas[i];
    }
    return null;
  };
  win._el = (id) => doc.getElementById(id);
  return win;
}

// Espera a que se vacíe la cola de microtareas (las promesas del fetch falso).
const tick = () => new Promise(r => setImmediate(r));

const DIMS = { largo: 600, alto: 60, ancho: 30, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const RECETA = () => ({
  tipo: 'viga', geometria: Object.assign({}, DIMS),
  componentes: [{
    tipologia: 'ES', figura: '104D', diam: 8, dims: {},
    distribucion: { modo: 'linear', activa: true, sep: 15, rango: { from: -295, to: 295, sep: 15, eje: 'x' } }
  }]
});

// Abre un template "de la biblioteca" (lo que hace tplAbrirTemplate tras el GET).
function abrirDeBiblioteca(w, extra) {
  w.templateEditorAbrir(Object.assign({
    elemento: 'VIGA', nombre: 'Viga eje 3', dims: DIMS, receta: RECETA(),
    templateId: 42, obra: 'OBRA-7', puedeModificar: true
  }, extra || {}));
}

(async function () {
  // ============================================================== L0
  console.log('L0 — el nombre es editable y cuenta como cambio sin guardar');
  {
    const w = sesion();
    abrirDeBiblioteca(w);
    const inp = w._el('te_nombre');
    ok(inp.value === 'Viga eje 3', 'el titlebar muestra el nombre del template (' + inp.value + ')');
    ok(w.TemplateEditor._hayCambiosSinGuardar() === false, 'recién abierto no hay cambios');
    ok(w._el('te_btnGuardar').disabled === true, 'sin cambios el botón Guardar está apagado');

    inp.value = 'Viga eje 3 · revisada';
    inp.dispatchEvent({ type: 'input' });
    ok(w.TemplateEditor._st.nombre === 'Viga eje 3 · revisada', 'escribir en el campo actualiza ST.nombre');
    ok(w.TemplateEditor._hayCambiosSinGuardar() === true, 'renombrar ES un cambio sin guardar');
    ok(w._el('te_btnGuardar').disabled === false, 'y enciende el botón Guardar');
    w._confirmRespuesta = false;
    w.templateEditorCerrar();
    ok(w._confirms.length === 1 && /sin guardar/i.test(w._confirms[0]),
      'cerrar tras renombrar pregunta antes de perder el nombre');
  }

  // ============================================================== L1
  console.log('\nL1 — template abierto: "Guardar cambios" = PUT y NO manda obra');
  {
    const w = sesion();
    abrirDeBiblioteca(w);
    ok(w._el('te_btnGuardar').textContent === '💾 Guardar cambios',
      'el botón dice lo que hace: "' + w._el('te_btnGuardar').textContent + '"');
    ok(w._el('te_btnGuardarNuevo').style.display === '', 'aparece "Guardar como nuevo"');
    w.TemplateEditor._st.receta.geometria.alto = 75;
    w.TemplateEditor._regenerar();
    w._responder = () => ({ status: 200, body: { ok: true, id: 42, cambios: ['receta'] } });
    w.templateEditorGuardar();
    await tick(); await tick();
    const c = w._ultimaEscritura();
    ok(c.metodo === 'PUT', 'usa PUT (' + c.metodo + ')');
    ok(/\/templates\/42$/.test(c.url), 'sobre /templates/42 (' + c.url + ')');
    ok(!('obra' in c.body), 'NO manda `obra` (el PUT no destructivo la conserva)');
    ok(c.body.params && c.body.params.geometria.alto === 75, 'manda la receta editada en `params`');
    ok(w.TemplateEditor._hayCambiosSinGuardar() === false, 'tras guardar ya no hay cambios pendientes');
    ok(w._el('te_btnGuardar').textContent === '✓ Actualizado', 'el botón confirma que ACTUALIZÓ');
    ok(w._llamadas.filter(x => x.metodo === 'POST').length === 0, 'no se creó ninguna copia');
  }

  // ============================================================== L2
  console.log('\nL2 — "Guardar como nuevo" = POST y conserva la obra del original');
  {
    const w = sesion();
    abrirDeBiblioteca(w);
    w._responder = () => ({ status: 200, body: { ok: true, id: 99, obra: 'OBRA-7' } });
    w.templateEditorGuardarComoNuevo();
    await tick(); await tick();
    const c = w._ultimaEscritura();
    ok(c.metodo === 'POST' && /\/templates$/.test(c.url), 'POST /templates (' + c.metodo + ' ' + c.url + ')');
    ok(c.body.obra === 'OBRA-7', 'la copia se queda en la misma obra (' + c.body.obra + ')');
    ok(w.TemplateEditor._st.templateId === 99, 'el editor pasa a apuntar a la COPIA (id ' + w.TemplateEditor._st.templateId + ')');
  }

  // ============================================================== L3
  console.log('\nL3 — template nuevo: POST, y el guardado siguiente ya es PUT');
  {
    const w = sesion();
    w.templateEditorAbrir({ elemento: 'VIGA', nombre: 'Nueva viga', dims: DIMS });
    ok(w._el('te_btnGuardar').textContent === '💾 Guardar template', 'el botón ofrece CREAR');
    ok(w._el('te_btnGuardarNuevo').style.display === 'none', 'sin template abierto no hay "Guardar como nuevo"');
    w.TemplateEditor._st.receta.componentes.push(RECETA().componentes[0]);
    w.TemplateEditor._regenerar();
    w._responder = () => ({ status: 200, body: { ok: true, id: 7, obra: null } });
    w.templateEditorGuardar();
    await tick(); await tick();
    ok(w._ultimaEscritura().metodo === 'POST', 'el primero es POST');
    ok(w.TemplateEditor._st.templateId === 7, 'queda apuntando al id creado');

    w.TemplateEditor._st.receta.geometria.largo = 700;
    w.TemplateEditor._regenerar();
    ok(w._el('te_btnGuardar').textContent === '💾 Guardar cambios', 'el botón cambia a "Guardar cambios"');
    w.templateEditorGuardar();
    await tick(); await tick();
    ok(w._ultimaEscritura().metodo === 'PUT' && /\/templates\/7$/.test(w._ultimaEscritura().url),
      'el segundo guardado ACTUALIZA en vez de duplicar (' + w._ultimaEscritura().metodo + ' ' + w._ultimaEscritura().url + ')');
  }

  // ============================================================== L4
  console.log('\nL4 — template ajeno (puede_modificar=false): nunca se manda PUT');
  {
    const w = sesion();
    abrirDeBiblioteca(w, { puedeModificar: false });
    ok(w.TemplateEditor._puedeSobrescribir() === false, 'el editor sabe que no puede sobrescribir');
    ok(w._el('te_btnGuardar').textContent === '💾 Guardar template', 'el botón ofrece guardar una COPIA');
    ok(w._el('te_btnGuardar').disabled === false, 'y está habilitado (siempre se puede copiar)');
    w._responder = () => ({ status: 200, body: { ok: true, id: 100 } });
    w.templateEditorGuardar();
    await tick(); await tick();
    ok(w._ultimaEscritura().metodo === 'POST', 'guarda con POST (' + w._ultimaEscritura().metodo + ')');
    ok(w._llamadas.filter(x => x.metodo === 'PUT').length === 0, 'no hubo ningún PUT condenado al 403');
  }

  // ============================================================== L5
  console.log('\nL5 — errores del backend en castellano');
  {
    const w = sesion();
    abrirDeBiblioteca(w);
    w.TemplateEditor._st.receta.geometria.alto = 70;
    w.TemplateEditor._regenerar();
    w._responder = () => ({
      status: 422,
      body: { detail: 'No se puede guardar el template: La barra 1 «ES» no define el lado A, que la figura 104D sí usa.' }
    });
    w.templateEditorGuardar();
    await tick(); await tick();
    const err = w._el('te_saveErr').textContent;
    ok(/no define el lado A/.test(err), 'el 422 muestra QUÉ falta: ' + err);
    ok(!/422/.test(err), 'y no un "Error 422" pelado');

    w._responder = () => ({ status: 403, body: { detail: 'Este template lo creó otro@x.cl. Solo su autor (o un administrador) puede editarlo.' } });
    w.templateEditorGuardar();
    await tick(); await tick();
    ok(/Solo su autor/.test(w._el('te_saveErr').textContent), 'el 403 explica de quién es el template');

    // 404: el template desapareció mientras se editaba → el trabajo no se pierde.
    w._responder = () => ({ status: 404, body: { detail: 'Template no encontrado.' } });
    w.templateEditorGuardar();
    await tick(); await tick();
    ok(w.TemplateEditor._st.templateId === null, 'el 404 suelta el templateId muerto');
    ok(/Guardar template/.test(w._el('te_saveErr').textContent), 'y dice cómo salvar el trabajo');

    // Sin `detail` (500 / proxy): igual sale un mensaje en castellano.
    ok(w.TemplateEditor._msgHttp(500).indexOf('servidor') >= 0, '500 sin detail → mensaje propio en castellano');
    ok(w.TemplateEditor._msgHttp(401).indexOf('sesión') >= 0, '401 sin detail → "tu sesión expiró"');
  }

  // ============================================================== L6
  console.log('\nL6 — la lista pide el GET liviano con filtros y pinta las acciones');
  {
    const w = sesion();
    w._el('tplBuscar').value = ' eje ';
    w._el('tplFiltroTipo').value = 'viga';
    w._responder = () => ({
      status: 200,
      body: {
        ok: true, templates: [
          { id: 42, nombre: 'Viga eje 3', tipo: 'viga', obra: 'OBRA-7', obra_nombre: 'Explora', fecha: '2026-08-01T10:00:00',
            updated_at: '2026-08-12T09:00:00', editado_por: 'eu@x.cl', creado_por: 'eu@x.cl', n_componentes: 3, puede_modificar: true },
          { id: 43, nombre: 'Muro tipo B', tipo: 'muro', obra: null, obra_nombre: null, fecha: '2026-07-20T10:00:00',
            creado_por: 'otro@x.cl', n_componentes: 5, puede_modificar: false }
        ]
      }
    });
    w.tplCargarGuardados();
    await tick(); await tick();
    const url = w._llamadas[0].url;
    ok(/nombre=eje/.test(url), 'manda ?nombre= al backend (' + url + ')');
    ok(/tipo=viga/.test(url), 'y ?tipo=');
    const html = w._el('tplGuardadosLista').innerHTML;
    ok(/Viga eje 3/.test(html) && /Muro tipo B/.test(html), 'pinta las dos filas');
    ok(/Explora/.test(html) && /General/.test(html), 'muestra la obra (y "General" cuando no tiene)');
    ok(/tplAbrirTemplate/.test(html) && /tplEliminarTemplate/.test(html), 'cada fila tiene Abrir y Eliminar');
    ok(/disabled/.test(html), 'el 🗑 del template ajeno viene deshabilitado');
    ok(w._el('tplGuardadosCount').textContent === '2 templates', 'el contador dice cuántos hay');
  }

  // ============================================================== L7
  console.log('\nL7 — eliminar: confirma nombrando el template y el 409 NO borra');
  {
    const w = sesion();
    w._responder = () => ({
      status: 200,
      body: { ok: true, templates: [{ id: 42, nombre: 'Viga eje 3', tipo: 'viga', creado_por: 'eu@x.cl', n_componentes: 3, puede_modificar: true }] }
    });
    w.tplCargarGuardados();
    await tick(); await tick();

    // 409 — el template tiene instancias: no se borra y se dice cuántas.
    w._responder = (url, opts) => (opts && opts.method === 'DELETE')
      ? { status: 409, body: { detail: 'No se puede eliminar «Viga eje 3»: 2 elemento(s) ya generado(s) lo usan como origen.' } }
      : { status: 200, body: { ok: true, templates: [] } };
    w.tplEliminarTemplate('42');
    await tick(); await tick();
    ok(w._confirms.length === 1 && /Viga eje 3/.test(w._confirms[0]), 'la confirmación NOMBRA el template');
    ok(/2 elemento/.test(w._el('tplGuardadosMsg').textContent), 'el 409 dice cuántos elementos lo usan');
    ok(w._el('tplGuardadosMsg').style.color === '#c62828', 'y se muestra como error (rojo)');
    ok(w._llamadas.filter(x => x.metodo === 'DELETE').length === 1, 'se intentó una sola vez');

    // Cancelar la confirmación no manda nada.
    w._confirmRespuesta = false;
    const antes = w._llamadas.length;
    w.tplEliminarTemplate('42');
    ok(w._llamadas.length === antes, 'cancelar el confirm no llama al backend');

    // Éxito: borra y recarga la lista.
    w._confirmRespuesta = true;
    let borrados = 0;
    w._responder = (url, opts) => {
      if (opts && opts.method === 'DELETE') { borrados++; return { status: 200, body: { ok: true, id: 42 } }; }
      return { status: 200, body: { ok: true, templates: [] } };
    };
    w.tplEliminarTemplate('42');
    await tick(); await tick(); await tick();
    ok(borrados === 1, 'manda el DELETE');
    ok(/eliminado/.test(w._el('tplGuardadosMsg').textContent), 'confirma en pantalla que se eliminó');
    ok(/Aún no hay templates/.test(w._el('tplGuardadosLista').innerHTML), 'y recarga la lista (quedó vacía)');
  }

  // ============================================================== L8
  console.log('\nL8 — abrir un template con una figura que ya no está en el catálogo');
  {
    const w = sesion();
    const receta = RECETA();
    receta.componentes[0].figura = 'ZZ99';        // no existe en el catálogo
    w.templateEditorAbrir({ elemento: 'VIGA', nombre: 'Viga vieja', dims: DIMS, receta: receta, templateId: 5 });
    const mig = w.TemplateEditor._migracionDe(w.TemplateEditor._st.receta.componentes[0]);
    ok(!!mig, 'el normalizador dejó su traza en el componente');
    ok(mig.figura_desconocida === true, 'la figura queda MARCADA como desconocida');
    const status = w._el('te_ctoolsStatus').innerHTML;
    ok(/ZZ99/.test(status), 'y el editor lo dice al abrir: ' + status.replace(/<[^>]+>/g, '').slice(0, 90));
    ok(w.TemplateEditor._hayCambiosSinGuardar() === false,
      'normalizar NO ensucia la receta (abrir y cerrar no pregunta por cambios)');
  }

  // ============================================================== L9
  console.log('\nL9 — editar MIENTRAS se guarda no marca como guardado lo que no se envió');
  {
    const w = sesion();
    abrirDeBiblioteca(w);
    w.TemplateEditor._st.receta.geometria.alto = 70;
    w.TemplateEditor._regenerar();
    let resolver;
    w.fetch = () => new Promise(r => { resolver = r; });
    w.templateEditorGuardar();                       // petición EN VUELO
    w.TemplateEditor._st.receta.geometria.largo = 800;   // el usuario sigue trabajando
    w.TemplateEditor._regenerar();
    resolver({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, id: 42 }) });
    await tick(); await tick();
    ok(w.TemplateEditor._hayCambiosSinGuardar() === true,
      'lo editado durante el envío SIGUE contando como cambio pendiente');
    // El botón muestra "✓ Actualizado" un instante y recién después vuelve a su
    // estado normal (timer de 1,5 s): ahí tiene que quedar ENCENDIDO, no apagado.
    w._correrTimers();
    ok(w._el('te_btnGuardar').disabled === false, 'y el botón vuelve encendido para mandarlo');
  }

  console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
  process.exitCode = fallos ? 1 : 0;
})();
