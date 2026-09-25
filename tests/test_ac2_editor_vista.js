// Test headless (Node) de la LIMPIEZA DE PANTALLA del editor de despieces (25-sep).
//
// Todo esto sale de una revisión de uso con el usuario. El principio que ordena los cambios:
// en una misma pantalla conviven DOS momentos distintos —ELEGIR (qué obra, qué despiece) y
// CUBICAR (este eje, estas barras)— y lo que sirve en uno estorba en el otro.
//
// LO QUE FIJA:
//   1. Cubicando, el histórico de despieces desaparece (era lo más grande de la pantalla y su
//      única razón era cambiarse de despiece a mitad de camino).
//   2. El contexto ya decidido se muestra decidido: UNA línea con obra · despiece · ciclo ·
//      eje · sector · estructura · plano, en vez de tres filas de formulario abierto.
//      "✎ Editar" devuelve las filas cuando de verdad hay que corregir.
//   3. El plano vive en esa línea (es identidad del despiece, no de la fila de tipologías).
//   4. El badge deja de repetir el nombre de la obra, que ya sale dos veces más arriba.
//   5. Las preferencias de vista (orden, multiplicador, dibujo, tamaño) se recuerdan.
//   6. La leyenda de colores se enciende SÓLO cuando aplica.
//   7. El estado vacío trae los botones de agregar adentro.
//
// Correr con: node tests/test_ac2_editor_vista.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'armahub', 'static', 'js',
  'features', 'cubicacion', 'agregar_cubicacion2.js'), 'utf8');

let fallos = 0;
function ok(c, m) { console.log((c ? '  OK   ' : '  FALLA ') + m); if (!c) fallos++; }

// ── Entorno: un DOM que fabrica el elemento que le pidan (el módulo toca decenas de ids y
//    aquí sólo interesan los que cambian de visibilidad o de contenido). ──
function montar(almacen) {
  const noop = () => {};
  const els = {};
  // DURANTE LA CARGA el DOM responde vacío, igual que en tests/test_masiva_visible.js: así
  // _ac2Init no arranca la pantalla (necesita comboboxes y red). Después sí entrega elementos.
  let cargando = true;
  const doc = {
    _els: els,
    getElementById: function (id) {
      if (cargando) return null;
      if (!els[id]) {
        els[id] = { id: id, style: {}, textContent: '', innerHTML: '', value: '', checked: false,
          disabled: false, className: '', title: '', dataset: {}, children: [],
          addEventListener: noop, removeEventListener: noop, appendChild: noop,
          setAttribute: noop, getAttribute: () => null, focus: noop, select: noop,
          contains: () => false, closest: () => null,
          classList: { add: noop, remove: noop, toggle: noop, contains: () => false } };
      }
      return els[id];
    },
    querySelector: () => null, querySelectorAll: () => [],
    createElement: function () { return doc.getElementById('__t' + Math.random()); },
    addEventListener: noop,
  };
  doc.body = doc.getElementById('__body');
  const guardado = Object.assign({}, almacen || {});
  const caja = {
    console: console, document: doc, setTimeout: (f) => f && f(), window: {},
    localStorage: {
      getItem: (k) => (k in guardado ? guardado[k] : null),
      setItem: (k, v) => { guardado[k] = String(v); },
      removeItem: (k) => { delete guardado[k]; }
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    alert: noop, confirm: () => true,
  };
  caja.window.document = doc;
  vm.createContext(caja);
  vm.runInContext(SRC, caja, { filename: 'agregar_cubicacion2.js' });
  cargando = false;
  // En el navegador `window` ES el objeto global, así que `window.ac2Render = …` deja también
  // `ac2Render` como global y las funciones se llaman entre sí sin prefijo. En un sandbox de
  // vm son dos cosas distintas; se igualan para que el módulo corra como corre de verdad.
  Object.keys(caja.window).forEach(function (k) {
    if (typeof caja.window[k] === 'function' && !(k in caja)) caja[k] = caja.window[k];
  });
  return { caja: caja, doc: doc, AC2: caja.AC2, guardado: guardado,
           el: (id) => doc.getElementById(id),
           visible: (id) => doc.getElementById(id).style.display !== 'none' };
}

// Deja el entorno como un despiece ABIERTO y en edición (etapa 4).
function enEditor(t) {
  const AC2 = t.AC2;
  AC2.proyecto = 'PROY-1'; AC2._nombreObra = 'Euro - San Pablo - Lourdes';
  AC2.loteId = 305; AC2.loteNum = 42; AC2.loteEstado = 'borrador';
  AC2.ciclo = 'C1'; AC2.eje = 'L114'; AC2.sector = 'LCIELO'; AC2.estructura = 'LOSA';
  AC2.plano = 'E-12 · Rev.C'; AC2.tipo = 'TODOS'; AC2.barras = []; AC2.seleccion = {};
  t.caja.ac2AplicarEtapa();
}

console.log('TEST: la pantalla del editor de despieces, ordenada');

// ── 1 · Cubicando manda el despiece, no el catálogo de despieces ──
console.log('\n1 — el histórico desaparece mientras cubicas');
{
  const t = montar(); enEditor(t);
  ok(t.caja.ac2Etapa() === 4, 'con un despiece abierto estamos en el editor');
  ok(!t.visible('ac2_historicoWrap'), 'el histórico NO se ve (antes era lo más grande de la pantalla)');
  // Al cerrar el despiece vuelve: es la pantalla de ELEGIR.
  t.AC2.loteId = null; t.caja.ac2AplicarEtapa();
  ok(t.caja.ac2Etapa() === 1, 'al cerrar el despiece se vuelve a la obra');
  ok(t.visible('ac2_historicoWrap'), 'y ahí sí se ve el histórico, que es donde se elige');
}

// ── 2 · El contexto decidido, en una línea ──
console.log('\n2 — las tres filas de contexto se vuelven una línea');
{
  const t = montar(); enEditor(t);
  ok(t.visible('ac2_resumenCtx'), 'aparece la línea de contexto');
  ok(!t.visible('ac2_filaContexto'), 'y las filas de formulario se recogen: contexto…');
  ok(!t.visible('ac2_filaSector'), '…y sector/estructura');
  const txt = t.el('ac2_resumenTxt').innerHTML;
  ['Euro - San Pablo - Lourdes', 'Despiece #42', 'C1', 'L114', 'LCIELO', 'LOSA', 'E-12'].forEach(function (d) {
    ok(txt.indexOf(d) >= 0, 'la línea dice ' + d);
  });

  // ✎ Editar devuelve las filas de siempre; volver a pulsarlo las recoge.
  t.caja.window.ac2ToggleCtxAbierto();
  ok(t.visible('ac2_filaContexto') && t.visible('ac2_filaSector'),
    '✎ Editar devuelve las filas para corregir');
  ok(t.el('ac2_resumenEditar').textContent.indexOf('Listo') >= 0,
    'y el botón cambia a "✕ Listo": ' + t.el('ac2_resumenEditar').textContent);
  t.caja.window.ac2ToggleCtxAbierto();
  ok(!t.visible('ac2_filaContexto'), 'y se vuelven a recoger');

  // Hay UN solo botón de configuración a la vista (el de la línea), no dos.
  ok(!t.visible('ac2_cfgBtn'), 'el ⚙ de la fila vieja se apaga: el de la línea es el único');
}

// ── 3 · Un despiece SIN plano lo dice, en vez de dejar el hueco mudo ──
console.log('\n3 — el plano vive en la línea (es identidad del despiece)');
{
  const t = montar(); enEditor(t);
  t.AC2.plano = ''; t.caja._ac2PintarResumen();
  ok(t.el('ac2_resumenTxt').innerHTML.indexOf('sin plano') >= 0,
    'sin plano se dice, no se deja un hueco');
}

// ── 4 · El nombre de la obra, una sola vez ──
console.log('\n4 — el badge deja de repetir la obra');
{
  const t = montar(); enEditor(t);
  t.caja.ac2PintarEstado();
  const badge = t.el('ac2_estadoBadge').textContent;
  ok(badge.indexOf('Euro') < 0,
    'con despiece abierto el badge NO repite la obra (ya está en el título y en la línea): "' + badge + '"');
  ok(badge.indexOf('En edición') >= 0, 'y sí dice el estado, que es lo suyo');
  // Sin despiece abierto el badge SÍ lleva la obra: ahí no hay línea de contexto que la diga.
  t.AC2.loteId = null; t.caja.ac2PintarEstado();
  ok(t.el('ac2_estadoBadge').textContent.indexOf('Nuevo Despiece') >= 0,
    'sin despiece vuelve a su etiqueta de siempre');
}

// ── 5 · Las preferencias de vista se recuerdan ──
console.log('\n5 — orden, multiplicador, dibujo y tamaño se recuerdan por usuario');
{
  const t = montar(); enEditor(t);
  t.caja.window.ac2SetOrden('tipo');
  t.caja.window.ac2SetTam('xl');
  t.caja.window.ac2ToggleMult(true);
  t.caja.window.ac2ToggleRender(false);
  const crudo = t.guardado['ac2.vista.v1'];
  ok(!!crudo, 'se guardan en el navegador');
  const p = JSON.parse(crudo);
  ok(p.orden === 'tipo' && p.tam === 'xl' && p.verMult === true && p.render === false,
    'con lo que el usuario eligió: ' + crudo);

  // Sesión nueva: el editor abre con lo de antes puesto, sin reponerlo a mano.
  const t2 = montar(t.guardado);
  t2.caja._ac2CargarPrefs();
  ok(t2.AC2.orden === 'tipo' && t2.AC2.tam === 'xl' && t2.AC2.verMult === true && t2.AC2.render === false,
    'y al volver a entrar ya están aplicadas');
  ok(t2.el('ac2_verMult').checked === true && t2.el('ac2_render').checked === false,
    'las casillas del menú también salen como quedaron');
}

// ── 6 · La leyenda sólo cuando aplica ──
console.log('\n6 — la leyenda de colores se enciende sólo cuando hay algo que explicar');
{
  const t = montar(); enEditor(t);
  t.caja._ac2Figuras = { '103A': { codigo: '103A', parciales: ['A', 'B', 'C'], angulos: [], radio: false } };
  const buena = t.caja.ac2NuevaBarra({ piso: 'P1', marca: 'Fi', diam: 10, cant: 1, mult: 1, figura: '103A' });
  buena.dim_a = 83; buena.dim_b = 12; buena.dim_c = 480;
  t.AC2.barras = [buena];
  t.caja.ac2ActualizarContadores();
  ok(!t.visible('ac2_leyenda3d'), 'sin barras del Enfierrador no se explica el dibujo azul');
  ok(!t.visible('ac2_leyendaMal'), 'sin medidas malas no se explica el fondo rosado');

  // Una barra con la geometría incompleta enciende SU mitad, y sólo esa.
  const mala = t.caja.ac2NuevaBarra({ piso: 'P1', marca: 'Fi', diam: 10, cant: 1, mult: 1, figura: '103A' });
  mala.dim_a = 83;   // le faltan B y C
  t.AC2.barras = [buena, mala];
  t.caja.ac2ActualizarContadores();
  ok(t.visible('ac2_leyendaMal'), 'con una medida mala sí aparece su explicación');
  ok(!t.visible('ac2_leyenda3d'), 'y la del 3D sigue apagada: son independientes');
}

// ── 7 · El estado vacío trae los botones adentro ──
console.log('\n7 — el "no hay barras" trae los botones de agregar');
{
  const t = montar(); enEditor(t);
  t.AC2.tipo = 'Fi'; t.AC2.barras = [];
  t.caja.window.ac2Render();
  const html = t.el('ac2_grid').innerHTML;
  ok(html.indexOf('ac2AgregarBarra()') >= 0, 'el mensaje trae ＋ barra adentro');
  ok(html.indexOf('ac2AgregarBarrasMulti()') >= 0, 'y ＋ barras M');

  // En TODOS no se pueden crear barras: se dice ESO, no "usa ＋ barra" (que está apagado).
  t.AC2.tipo = 'TODOS';
  t.caja.window.ac2Render();
  const htmlTodos = t.el('ac2_grid').innerHTML;
  ok(htmlTodos.indexOf('ac2AgregarBarra()') < 0, 'en TODOS no se ofrecen botones que no funcionan');
  ok(/tipolog/i.test(htmlTodos), 'se dice que hay que entrar a una tipología');
}

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exit(fallos ? 1 : 0);
