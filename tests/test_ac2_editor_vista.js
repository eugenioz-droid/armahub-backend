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

  // EN TODOS TAMBIÉN SE AGREGA (26-sep, pedido del usuario): el bloqueo viejo existía porque la
  // barra nacía sin tipología y no había dónde ponérsela. Ahora la tipología se edita en la fila:
  // los botones se ofrecen, la barra nace sin tipología (celda roja) y no se guarda hasta tenerla.
  t.AC2.tipo = 'TODOS';
  t.caja.window.ac2Render();
  const htmlTodos = t.el('ac2_grid').innerHTML;
  ok(htmlTodos.indexOf('ac2AgregarBarra()') >= 0, 'en TODOS también se ofrecen los botones de agregar');
  ok(/tipolog/i.test(htmlTodos), 'y se avisa que la tipología se elige en la fila');
  t.AC2.loteId = 305; t.AC2.loteEstado = 'borrador'; t.AC2.sector = 'LCIELO'; t.AC2.estructura = 'LOSA';
  ok(t.caja.ac2PuedeCrear() === true, 'ac2PuedeCrear ya no rechaza TODOS');
  t.caja.ac2ActualizarBotonesCrear();
  ok(t.el('ac2_barraBtn').disabled === false && t.el('ac2_barrasMBtn').disabled === false,
    'y ＋ barra / ＋ barras M quedan habilitados en TODOS');
  const nueva = t.caja.ac2NuevaBarra({});
  ok(nueva.marca === '', 'la barra nueva en TODOS nace sin tipología');
  ok(/— tipo —/.test(t.caja.ac2Fila(nueva)) && /ffebee/.test(t.caja.ac2Fila(nueva)),
    'su celda de tipología ofrece "— tipo —" y va en rojo');
  ok(t.caja.ac2BarraLista(nueva) === false, 'y no cuenta como completa hasta elegirla');
}

// ── 8 · La grilla no reserva espacio para geometría que nadie usa ──
// Medido contra los 200 despieces con barras de la base: ninguno pasa de 6 lados ni de 2
// ángulos, y el radio no lo usa NINGUNO. La grilla reservaba siempre 9 + 4 + 1, así que G, H,
// I, α3, α4 y R estaban vacías en el 100% de los casos y en un despiece corriente sobraban 8
// de las 14 columnas — media tabla en blanco.
console.log('\n8 — las columnas de geometría son las que la vista usa, no 14 siempre');
{
  const t = montar(); enEditor(t);
  // 103A: 3 lados y 1 ángulo. 105A: 5 lados, sin ángulos.
  t.caja._ac2Figuras = {
    '103A': { codigo: '103A', parciales: ['A', 'B', 'C'], angulos: [90], radio: false },
    '105A': { codigo: '105A', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [], radio: false },
  };
  const barra = (fig) => {
    const b = t.caja.ac2NuevaBarra({ piso: 'P1', marca: 'Fi', diam: 10, cant: 1, mult: 1, figura: fig });
    b.dim_a = 83; b.dim_b = 12; b.dim_c = 480; b.ang1 = 90;
    return b;
  };
  const cuentaTh = (html) => (html.match(/<th\b/g) || []).length;
  const cuentaTd = (html) => (html.match(/<td\b/g) || []).length;

  t.AC2.tipo = 'Fi'; t.AC2.barras = [barra('103A')];
  const g1 = t.caja.ac2ColsGeom();
  ok(g1.dims.length === 3 && g1.angs === 1 && g1.radio === false,
    'con sólo 103A la vista pide 3 lados, 1 ángulo y ningún radio (pedía 9+4+1)');
  const th1 = t.caja.ac2Thead();
  ok(th1.indexOf('>G<') < 0 && th1.indexOf('>I<') < 0, 'G e I no se pintan');
  ok(th1.indexOf('>α3<') < 0 && th1.indexOf('>α4<') < 0, 'α3 y α4 tampoco');
  ok(th1.indexOf('>R<') < 0, 'ni la columna de radio, que no usa ningún despiece de la base');
  ok(th1.indexOf('>A<') >= 0 && th1.indexOf('>C<') >= 0 && th1.indexOf('>α1<') >= 0,
    'y sí están A, C y α1, que es lo que la figura pide');

  // LA INVARIANTE: cabecera, fila y encabezado de grupo tienen que cuadrar SIEMPRE.
  ok(cuentaTd(t.caja.ac2Fila(t.AC2.barras[0])) === cuentaTh(th1),
    'la fila tiene exactamente tantas celdas como columnas la cabecera ('+cuentaTh(th1)+')');
  const m1 = /colspan="(\d+)"/.exec(t.caja.ac2GrupoHdr('P1', 1, true));
  ok(m1 && Number(m1[1]) === cuentaTh(th1), 'y el encabezado de grupo abarca esas mismas ' + cuentaTh(th1));

  // Una figura más ancha AGRANDA el juego de columnas, y entonces hay que repintar la tabla
  // entera: si sólo se repintara la fila, quedaría descuadrada contra la cabecera.
  t.AC2.barras = [barra('103A'), barra('105A')];
  const g2 = t.caja.ac2ColsGeom();
  ok(g2.dims.length === 5, 'al convivir con 105A la vista pasa a 5 lados');
  ok(g2.angs === 1, 'y conserva el ángulo que pide la otra figura');
  ok(g2.sig !== g1.sig, 'el juego de columnas cambió, y su firma lo detecta');
  const th2 = t.caja.ac2Thead();
  ok(cuentaTd(t.caja.ac2Fila(t.AC2.barras[0])) === cuentaTh(th2) &&
     cuentaTd(t.caja.ac2Fila(t.AC2.barras[1])) === cuentaTh(th2),
    'las DOS filas siguen cuadrando, aunque sus figuras usen distintos lados');

  // Filas recién creadas (sin figura): piso mínimo, no una tabla sin medidas.
  t.AC2.barras = [t.caja.ac2NuevaBarra({ piso: 'P2', marca: 'Fi' })];
  const g3 = t.caja.ac2ColsGeom();
  ok(g3.dims.length === 3 && g3.angs === 0 && !g3.radio,
    'una vista de filas nuevas muestra 3 lados y ninguna columna de ángulo');
  ok(cuentaTd(t.caja.ac2Fila(t.AC2.barras[0])) === cuentaTh(t.caja.ac2Thead()),
    'y también cuadra');

  // Y esa fila nueva no reserva la caja de dibujo entera.
  const dib = t.caja.ac2Fila(t.AC2.barras[0]);
  ok(/height:16px/.test(dib), 'sin figura el dibujo no ocupa una fila entera (marca de 16px)');
}

// ── 9 · Disposición FIJA y en el orden pedido (26-sep) ──
// El usuario: «la grilla se acomoda y ajusta y es mejor que las cosas sean fijas», y el
// orden piso · tipología · sufijo | φ · cant · figura · forma · largo · peso | medidas |
// … rev · acciones pegadas a la derecha. Y «que las posiciones no varíen»: las columnas de
// medidas son las de la figura más ancha que la tipología OFRECE, no sólo las que ya se usan.
console.log('\n9 — disposición fija: un solo layout para cabecera, filas y colgroup');
{
  const t = montar(); enEditor(t);
  t.caja._ac2Figuras = {
    '102A': { codigo: '102A', parciales: ['A', 'B'], angulos: [], radio: false },
    '103A': { codigo: '103A', parciales: ['A', 'B', 'C'], angulos: [90], radio: false },
    '105A': { codigo: '105A', parciales: ['A', 'B', 'C', 'D', 'E'], angulos: [], radio: false },
  };
  const barra = (fig) => { const b = t.caja.ac2NuevaBarra({ piso: 'P1', marca: 'Fi', diam: 10, cant: 1, mult: 1, figura: fig }); b.dim_a = 1; b.dim_b = 1; b.dim_c = 1; return b; };
  const ids = (lay) => lay.cols.map(c => c.id);

  // Orden pedido.
  t.AC2.tipo = 'Fi'; t.AC2.barras = [barra('103A')];
  const lay = t.caja.ac2Layout(), o = ids(lay);
  const pos = (id) => o.indexOf(id);
  ok(pos('piso') === 0 && pos('marca') === 1 && pos('suf') === 2, 'piso · tipología · sufijo, juntas y primero');
  ok(pos('diam') === 3 && pos('cant') === 4 && pos('figura') === 5 && pos('forma') === 6,
    'luego φ · cant · figura · forma');
  ok(pos('largo') === 7 && pos('peso') === 8, 'y largo · peso DESPUÉS de figura y forma');
  ok(pos('dim_a') === 9, 'las medidas vienen después');
  ok(o[o.length - 1] === 'acc' && o[o.length - 2] === 'rev' && o[o.length - 3] === 'esp',
    'y al final la columna elástica, Rev y acciones (pegadas a la derecha)');
  ok(lay.cols.filter(c => c.id === 'esp')[0].w === null, 'la elástica es la única sin ancho fijo');
  ok(lay.cols.filter(c => c.id !== 'esp').every(c => c.w > 0), 'todas las demás tienen ancho fijo');
  ok(lay.cols.filter(c => c.pl > 0).map(c => c.id).join() === 'diam,dim_a',
    'el aire de grupo va sólo antes de φ y del primer lado (pequeño, no mucho)');

  // Cabecera, colgroup y fila cuentan lo mismo.
  const nTh = (t.caja.ac2Thead().match(/<th\b/g) || []).length;
  const nCol = (t.caja.ac2Colgroup(lay).match(/<col\b/g) || []).length;
  const nTd = (t.caja.ac2Fila(t.AC2.barras[0]).match(/<td\b/g) || []).length;
  ok(nTh === lay.cols.length && nCol === lay.cols.length && nTd === lay.cols.length,
    'cabecera (' + nTh + '), colgroup (' + nCol + ') y fila (' + nTd + ') = ' + lay.cols.length + ' columnas');
  const th = t.caja.ac2Thead();
  ok(th.indexOf('>Largo') > th.indexOf('>Forma<'), 'la cabecera también pone Largo después de Forma');

  // ESTABILIDAD: la tipología Fi ofrece 105A (5 lados) → aunque sólo haya un 103A en pantalla,
  // se reservan 5 lados, y escribir un 105A después NO mueve nada.
  t.caja.AC2_TIPOS_MAP.LOSA = [{ codigo: 'Fi', figuras: ['102A', '103A', '105A'] }, { codigo: 'Fs', figuras: ['102A'] }];
  const g1 = t.caja.ac2ColsGeom();
  ok(g1.dims.length === 5 && g1.angs === 1, 'en Fi se reservan los 5 lados de su figura más ancha (y el ángulo de 103A)');
  t.AC2.barras = [barra('103A'), barra('105A')];
  ok(t.caja.ac2ColsGeom().sig === g1.sig, 'y al aparecer un 105A el juego de columnas NO cambia');
  // Piso mínimo de 3 aunque la tipología sólo ofrezca figuras de 2 lados.
  t.AC2.tipo = 'Fs'; t.AC2.barras = [barra('102A')];
  ok(t.caja.ac2ColsGeom().dims.length === 3, 'nunca menos de 3 lados ("si no se ve raro")');
  // En TODOS: la unión de todas las tipologías de la estructura.
  t.AC2.tipo = 'TODOS'; t.AC2.barras = [];
  ok(t.caja.ac2ColsGeom().dims.length === 5, 'en TODOS manda la figura más ancha de toda la estructura');
}

console.log(fallos ? '\nFALLOS: ' + fallos : '\nTODO OK');
process.exit(fallos ? 1 : 0);
