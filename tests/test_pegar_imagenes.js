// Test headless (Node) del PEGADO CON Ctrl+V en las zonas de imagen (shared/uploads.js).
//
// POR QUÉ EXISTE: esta función ya había existido y se QUITÓ porque pegaba siempre en el
// formulario de REGISTRO, aunque el usuario estuviera escribiendo el ANÁLISIS. Se vuelve a
// poner, y lo que este test fija es justamente lo que falló: que nunca se adivine el destino.
//
//   1. Con UNA sola zona visible (el caso normal: la pantalla esconde la zona que tu rol no
//      puede usar) el recorte va ahí, sin que el usuario tenga que clicar nada.
//   2. Con VARIAS visibles (le pasa al admin), manda el FOCO: escribir en el análisis arma la
//      zona del análisis. Éste es el bug viejo, al derecho.
//   3. Con varias visibles y sin foco en ninguna sección NO se elige por el usuario: se le
//      pide que clique. Adivinar es lo que rompió esto la primera vez.
//   4. Pegar TEXTO no se toca nunca.
//
// Correr con: node tests/test_pegar_imagenes.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'armahub', 'static', 'js', 'shared', 'uploads.js'), 'utf8');

let fallos = 0;
function ok(c, m) { console.log((c ? '  OK   ' : '  FALLA ') + m); if (!c) fallos++; }

// ── mini-DOM: sólo lo que uploads.js toca ──────────────────────────────────────
function hacerEl(DOC, id) {
  var el = {
    id: id, style: {}, textContent: '', _lis: {}, _kids: [], _parent: null, visible: true,
    addEventListener: function (t, f) { (el._lis[t] = el._lis[t] || []).push(f); },
    add: function (h) { h._parent = el; el._kids.push(h); return h; },
    contains: function (x) {
      if (x === el) return true;
      for (var i = 0; i < el._kids.length; i++) if (el._kids[i].contains(x)) return true;
      return false;
    },
    closest: function () { return null; }    // uploads.js sólo comprueba que exista
  };
  Object.defineProperty(el, 'offsetParent', {
    get: function () { return el.visible ? (el._parent || DOC.body) : null; }
  });
  if (id) DOC._els[id] = el;
  return el;
}

// Monta una ficha limpia (DOM + uploads.js recién cargado) con las DOS zonas registradas
// igual que lo hace detail-edit.js. Cada escenario parte de cero: el estado de "zona
// armada" es global al módulo y arrastrarlo entre casos escondería justamente el caso 3.
function montar() {
  var DOC = { _els: {}, _lis: {},
    getElementById: function (i) { return DOC._els[i] || null; },
    addEventListener: function (t, f) { (DOC._lis[t] = DOC._lis[t] || []).push(f); },
    dispatch: function (t, ev) { (DOC._lis[t] || []).forEach(function (f) { f(ev); }); },
    body: null };
  DOC.body = hacerEl(DOC, '__body');

  var secAnt = DOC.body.add(hacerEl(DOC, 'recSeccionAntecedentes'));
  var zonaAnt = secAnt.add(hacerEl(DOC, 'recDetailDropZone'));
  secAnt.add(hacerEl(DOC, 'recDetailDropMsg')).textContent = 'Arrastra imágenes o haz click';
  var campoAnt = secAnt.add(hacerEl(DOC, 'campoAntecedentes'));
  hacerEl(DOC, 'recDetailFileInput');

  var secAna = DOC.body.add(hacerEl(DOC, 'recSeccionAnalisis'));
  var zonaAna = secAna.add(hacerEl(DOC, 'recRespDropZone'));
  secAna.add(hacerEl(DOC, 'recRespDropMsg')).textContent = 'Arrastra imágenes o haz click';
  var campoAna = secAna.add(hacerEl(DOC, 'campoAnalisis'));
  hacerEl(DOC, 'recRespFileInput');

  var caja = { console: console, document: DOC, File: File, setTimeout: function () {}, window: {} };
  caja.window.document = DOC;
  vm.createContext(caja);
  vm.runInContext(SRC.replace(/\}\)\(window\);\s*$/, '})(this.window);'), caja, { filename: 'uploads.js' });

  var recibidas = { ant: [], ana: [] };
  var soloImagenes = function (f) { return !!(f && f.type && f.type.indexOf('image/') === 0); };
  caja.window.bindDropZone('recDetailDropZone', 'recDetailFileInput',
    function (a) { recibidas.ant = recibidas.ant.concat(a); },
    { fileFilter: soloImagenes, scopeId: 'recSeccionAntecedentes', hintId: 'recDetailDropMsg', activeBorderColor: '#c62828' });
  caja.window.bindDropZone('recRespDropZone', 'recRespFileInput',
    function (a) { recibidas.ana = recibidas.ana.concat(a); },
    { fileFilter: soloImagenes, scopeId: 'recSeccionAnalisis', hintId: 'recRespDropMsg', activeBorderColor: '#1565c0' });

  return {
    DOC: DOC, recibidas: recibidas, zonaAnt: zonaAnt, zonaAna: zonaAna,
    campoAnt: campoAnt, campoAna: campoAna,
    texto: function (id) { return DOC.getElementById(id).textContent; },
    enfocar: function (el) { DOC.dispatch('focusin', { target: el }); },
    clicarZona: function (el) { el._lis.click.forEach(function (f) { f({}); }); },
    pegar: function (archivos, texto) {
      var items = (archivos || []).map(function (f) {
        return { kind: 'file', getAsFile: function () { return f; } };
      });
      if (texto != null) items.push({ kind: 'string', getAsFile: function () { return null; } });
      var ev = { clipboardData: { items: items }, _default: true,
                 preventDefault: function () { this._default = false; } };
      DOC.dispatch('paste', ev);
      return ev;
    }
  };
}
function imagen(nombre, tipo) {
  return new File([new Uint8Array([1, 2, 3])], nombre || 'image.png', { type: tipo || 'image/png' });
}

console.log('TEST: pegar con Ctrl+V va SIEMPRE a la zona correcta');

// ── 1 · EL CASO NORMAL — cubicador: la pantalla sólo le muestra la zona del análisis ──
console.log('\n1 — una sola zona visible: va ahí, sin clicar nada');
{
  var t = montar();
  t.zonaAnt.visible = false;
  var ev = t.pegar([imagen()]);
  ok(t.recibidas.ana.length === 1, 'el recorte llega a las imágenes del ANÁLISIS');
  ok(t.recibidas.ant.length === 0, 'y no toca las del registro');
  ok(ev._default === false, 'se consume el pegado (no lo recibe además el navegador)');
  ok(/^pegada-\d{8}-\d{6}\.png$/.test(t.recibidas.ana[0].name),
    'con nombre y hora: ' + t.recibidas.ana[0].name + ' (todo recorte llega como "image.png")');
  ok(t.recibidas.ana[0].type === 'image/png', 'y conserva su tipo');
}

// ── 2 · EL BUG VIEJO, AL DERECHO — admin ve las dos y manda dónde está escribiendo ──
console.log('\n2 — dos zonas visibles: manda el FOCO (esto es lo que fallaba antes)');
{
  var t = montar();
  t.enfocar(t.campoAna);
  t.pegar([imagen()]);
  ok(t.recibidas.ana.length === 1 && t.recibidas.ant.length === 0,
    'escribiendo el ANÁLISIS, el recorte cae en el análisis');
  ok(t.texto('recRespDropMsg').indexOf('Ctrl+V') >= 0,
    'y la zona armada lo anuncia: "' + t.texto('recRespDropMsg') + '"');
  ok(t.texto('recDetailDropMsg').indexOf('Ctrl+V') < 0,
    'la otra no se anuncia: sólo una puede recibirlo');

  t.enfocar(t.campoAnt);
  t.pegar([imagen()]);
  ok(t.recibidas.ant.length === 1, 'al pasar a los ANTECEDENTES, el siguiente cae ahí');
  ok(t.recibidas.ana.length === 1, 'y el análisis se queda con el suyo, no recibe de más');
  ok(t.texto('recDetailDropMsg').indexOf('Ctrl+V') >= 0 &&
     t.texto('recRespDropMsg').indexOf('Ctrl+V') < 0, 'el anuncio se mudó con el foco');
}

// ── 3 · NO ADIVINAR — varias visibles y ningún foco todavía ──
console.log('\n3 — varias visibles y sin foco: NO se adivina (el pecado original)');
{
  var t = montar();
  var ev = t.pegar([imagen()]);
  ok(t.recibidas.ant.length === 0 && t.recibidas.ana.length === 0,
    'no sube a ninguna de las dos: antes se iba SIEMPRE al registro');
  ok(ev._default === false, 'se consume igual, para que el recorte no se cuele en un campo de texto');
  ok(t.texto('recDetailDropMsg').indexOf('clic') >= 0 && t.texto('recRespDropMsg').indexOf('clic') >= 0,
    'y las dos piden que se elija: "' + t.texto('recRespDropMsg') + '"');

  // Clicar una la arma y ya no hay ambigüedad.
  t.clicarZona(t.zonaAna);
  t.pegar([imagen()]);
  ok(t.recibidas.ana.length === 1 && t.recibidas.ant.length === 0,
    'tras clicar la del análisis, el recorte cae ahí');
}

// ── 4 · Pegar texto no lo intercepta nadie ──
console.log('\n4 — pegar texto sigue su curso normal');
{
  var t = montar(); t.zonaAnt.visible = false;
  var ev = t.pegar([], 'un texto cualquiera');
  ok(t.recibidas.ana.length === 0 && t.recibidas.ant.length === 0, 'no sube nada');
  ok(ev._default === true, 'y no se hace preventDefault: el texto se pega donde el usuario esté');
}

// ── 5 · Un archivo que no es imagen no entra por la zona de imágenes ──
console.log('\n5 — un archivo que no es imagen no entra por la zona de imágenes');
{
  var t = montar(); t.zonaAnt.visible = false;
  var ev = t.pegar([new File([new Uint8Array([1])], 'correo.eml', { type: 'message/rfc822' })]);
  ok(t.recibidas.ana.length === 0, 'no se sube');
  ok(ev._default === true, 'y no se consume el evento');
}

// ── 6 · Varias imágenes de una vez ──
console.log('\n6 — varios recortes en un solo pegado');
{
  var t = montar(); t.zonaAnt.visible = false;
  t.pegar([imagen(), imagen()]);
  ok(t.recibidas.ana.length === 2, 'llegan las dos');
  ok(t.recibidas.ana[0].name !== '' && t.recibidas.ana[1].name !== '', 'las dos con nombre');
}

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exit(fallos ? 1 : 0);
