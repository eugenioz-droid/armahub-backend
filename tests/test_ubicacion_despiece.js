// =============================================================================
// LA UBICACION DEL DESPIECE, Y LOS ERRORES QUE SE PUEDEN LEER (bugs del 25-ago)
// =============================================================================
// El usuario modelo un muro completo en el editor 3D, apreto "Cargar al despiece" y
// recibio:  "No se cargaron las barras: [object Object]  Fallo en el piso P5."
// Eran DOS fallas encadenadas y este test congela las dos.
//
//  A - EL DATO. El contexto del despiece (sector/ciclo/eje) se sacaba de la PRIMERA
//      BARRA del lote. En un despiece VACIO no hay primera barra, asi que el contexto
//      quedaba en blanco; cada barra del 3D viaja estampada con el y el backend lo
//      exige, de modo que el POST moria en 400 -- con el muro ya modelado. El lote
//      GUARDA su ubicacion desde que se crea (columnas de la migracion 101): habia
//      que leerla de ahi. La primera barra queda de respaldo para lotes antiguos.
//
//  B - EL MENSAJE. Ese 400 llega con detail = OBJETO ({msg, faltan, ...}) y el front
//      hacia String(detail) -> "[object Object]". Justo los rechazos que traen la
//      explicacion buena (ubicacion faltante, geometria invalida) eran los ilegibles.
//      Un error que el servidor explico bien no puede perderse en la traduccion.
//
// Correr con: node tests/test_ubicacion_despiece.js
// =============================================================================

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  X ' + m); fallos++; } else { console.log('  ok ' + m); } }

const noop = function () {};
const fakeEl = { style: {}, textContent: '', value: '', checked: false, indeterminate: false,
  innerHTML: '', className: '', appendChild: noop, addEventListener: noop, setAttribute: noop,
  getAttribute: function () { return null; }, focus: noop, select: noop, remove: noop,
  getBoundingClientRect: function () { return { left: 0, top: 0, right: 0, bottom: 0 }; },
  classList: { add: noop, remove: noop, toggle: noop, contains: function () { return false; } } };
// getElementById devuelve SIEMPRE el mismo elemento por id (no null y no uno nuevo
// cada vez): los bloques que pintan tabla —ac2PintarEstructuras— escriben en uno y el
// test lee del mismo. Sin esto no hay forma de mirar lo que se pintó.
function doc() {
  const byId = {};
  return { _byId: byId,
    getElementById: function (id) {
      if (!byId[id]) byId[id] = Object.assign({}, fakeEl, { id: id, style: {} });
      return byId[id];
    },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }, addEventListener: noop,
    createElement: function () { return Object.assign({}, fakeEl); },
    body: Object.assign({}, fakeEl) };
}

// --- AC2 en un sandbox con el GET del lote falseado --------------------------
const SRC_AC2 = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'cubicacion', 'agregar_cubicacion2.js');
const CODE_AC2 = fs.readFileSync(SRC_AC2, 'utf8');

// `respuesta` = cuerpo fijo, o funcion (url, opts) -> cuerpo (para responder distinto
// por endpoint). Las llamadas quedan anotadas en sandbox._llamadas.
function ac2Con(respuesta) {
  const d = doc();
  const sandbox = { console: { log: noop, warn: noop, error: noop }, document: d,
    setTimeout: function (fn) { return fn && fn(); }, clearTimeout: noop,
    alert: function (m) { sandbox._alerts.push(String(m)); },
    confirm: function (m) { sandbox._confirms.push(String(m)); return sandbox._confirmar; },
    authHeaders: function () { return {}; }, apiUrl: function (u) { return u; },
    fetch: function (url, opts) {
      sandbox._llamadas.push({ url: String(url), metodo: ((opts && opts.method) || 'GET').toUpperCase() });
      const body = (typeof respuesta === 'function') ? respuesta(String(url), opts) : respuesta;
      return Promise.resolve({ ok: true, status: 200,
        json: function () { return Promise.resolve(body); } });
    } };
  sandbox._llamadas = []; sandbox._alerts = []; sandbox._confirms = []; sandbox._confirmar = true;
  // window ES el global, como en el navegador: el modulo define sus funciones con
  // `window.ac2X = ...` y despues las llama SIN prefijo (`ac2SetTipo(...)`). Con un
  // window aparte esas llamadas no resuelven y el test moriria por el andamio, no
  // por el codigo que quiere medir.
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CODE_AC2, sandbox, { filename: 'agregar_cubicacion2.js' });
  return sandbox;
}

// El lote de la falla: ubicacion PROPIA completa y CERO barras (recien creado).
const LOTE_VACIO = { lote: { id: 148, id_proyecto: 'PROY-A192D913', estado: 'borrador',
  num_obra: 3, plano: '', ciclo: 'C1', eje: 'E12', sector: 'MOLDAJE', estructura: 'MURO' },
  barras: [] };
// Un lote ANTIGUO: sin ubicacion propia, pero con barras que si la tienen.
const LOTE_VIEJO = { lote: { id: 9, id_proyecto: 'OBRA-X', estado: 'borrador', num_obra: 1,
  plano: '', ciclo: null, eje: null, sector: null, estructura: null },
  barras: [{ id: 1, sector: 'FIERRO', ciclo: 'C9', eje: 'E1', piso: 'P1', marca: 'CBS',
    figura: '101A', diam: 12, cant: 1, mult: 1 }] };

async function bloqueA() {
  console.log('A - EL CONTEXTO DEL DESPIECE SALE DEL LOTE, NO DE SU PRIMERA BARRA');
  const s1 = ac2Con(LOTE_VACIO);
  await s1.window.ac2RetomarLote(148, true);
  const ctx = s1.window.ac2CtxEditor3D();
  ok(ctx.sector === 'MOLDAJE', 'despiece VACIO: el sector sale del lote (=' + ctx.sector + ')');
  ok(ctx.ciclo === 'C1', 'despiece VACIO: el ciclo sale del lote (=' + ctx.ciclo + ')');
  ok(ctx.eje === 'E12', 'despiece VACIO: el eje sale del lote (=' + ctx.eje + ')');
  ok(ctx.loteId === 148 && ctx.id_proyecto === 'PROY-A192D913', 'la obra y el lote siguen viajando');
  // Sin esto los tres salian '' y el POST de barras moria en 400 con el muro ya hecho.
  ok(!['sector', 'ciclo', 'eje'].some(function (k) { return !String(ctx[k] || '').trim(); }),
    'ninguno queda en blanco: es lo que el backend exige en CADA barra');

  const s2 = ac2Con(LOTE_VIEJO);
  await s2.window.ac2RetomarLote(9, true);
  const c2 = s2.window.ac2CtxEditor3D();
  ok(c2.sector === 'FIERRO' && c2.ciclo === 'C9' && c2.eje === 'E1',
    'lote ANTIGUO sin ubicacion propia: sigue saliendo de su primera barra (=' +
    [c2.sector, c2.ciclo, c2.eje].join('/') + ')');
}

function bloqueB() {
  console.log('');
  console.log('B - UN 400 QUE SE PUEDE LEER');
  const BASE = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
  const d = doc();
  const sb = { console: { log: noop, warn: noop, error: noop }, document: d,
    setTimeout: function (fn) { return fn && fn(); }, clearTimeout: noop,
    addEventListener: noop, requestAnimationFrame: noop, innerWidth: 1280, innerHeight: 800,
    localStorage: { getItem: function () { return null; }, setItem: noop, removeItem: noop } };
  sb.window = sb; sb.self = sb; sb.global = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(BASE, 'template_editor.js'), 'utf8'),
    sb, { filename: 'template_editor.js' });
  const TE = sb.TemplateEditor;
  ok(!!(TE && TE._detalleHttp), 'el traductor de errores esta expuesto para poder probarlo');
  if (!TE || !TE._detalleHttp) return;
  const D = TE._detalleHttp;

  // EL CASO EXACTO DEL BUG: ubicacion faltante, que el backend manda como OBJETO.
  const falta = D({ detail: { msg: 'Falta ubicacion obligatoria (sector, ciclo, eje) en la barra 1.',
    barra_idx: 0, faltan: ['sector', 'ciclo', 'eje'] } }, 400);
  ok(falta.indexOf('[object Object]') < 0, 'NO dice "[object Object]" (=' + falta + ')');
  ok(/Falta ubicacion/.test(falta), 'dice lo que el servidor explico');
  ok(/sector/.test(falta) && /ciclo/.test(falta), 'y nombra QUE falta, que es la mitad accionable');

  const geom = D({ detail: { msg: 'Geometria invalida en la barra 3 (figura 104B).', barra_idx: 2,
    figura: '104B', slots_faltan: ['dim_c'], slots_sobran: ['ang3'], errores: [] } }, 400);
  ok(geom.indexOf('[object Object]') < 0 && /104B/.test(geom), 'geometria invalida: legible y con la figura');
  ok(/dim_c/.test(geom) && /ang3/.test(geom), 'y con el lado que falta y el que sobra');

  // Lo que YA funcionaba sigue igual.
  ok(D({ detail: 'El lote esta terminado; edita las barras desde el Bar Manager.' }, 409) ===
    'El lote esta terminado; edita las barras desde el Bar Manager.', 'un detail de TEXTO pasa tal cual');
  ok(/sesi/i.test(D({}, 401)), 'sin detail cae al mapa por status (401 = sesion)');
  ok(D({ detail: [{ msg: 'field required', loc: ['body', 'barras'] }] }, 422) === 'field required',
    'la lista de validacion de FastAPI muestra su primer mensaje');
  ok(D({ detail: {} }, 400) !== '', 'un objeto sin msg no devuelve vacio: algo dice siempre');
}

// ============================================================================
// C - EL INDICE DE ESTRUCTURAS DEL DESPIECE (secuela del mismo bug)
// ----------------------------------------------------------------------------
// Aquel 400 dejaba TRES cosas rotas a la vista, y las tres se congelan aca:
//  C1. Las cargas que fallaron dejaron ESTRUCTURAS VACIAS (0 barras, 0 kg) colgando
//      en el listado. Ya no pueden nacer -- la estructura entra en la misma
//      transaccion que sus barras -- pero las que quedaron son datos del usuario:
//      la fila las MUESTRA por lo que son y ofrece borrarlas. Nada se borra solo.
//  C2. La fila decia el CODIGO de la obra (PROY-A192D913). Ahora dice su NOMBRE, y
//      la etiqueta se DERIVA de obra/ciclo/piso/eje en vez de recortar el nombre
//      guardado (que es la traza persistida y lleva el id a proposito).
//  C3. El bloque muestra los MISMOS KPIs que el repositorio de despieces
//      (Items/Barras/Kg/O prom/PPB/PPI) y con la MISMA formula: una sola funcion
//      (ac2KpisTd) para las dos tablas, y los numeros en UNA sola consulta.
// ============================================================================
const LOTE_CON_ESTRUCTURAS = { lote: { id: 148, id_proyecto: 'PROY-A192D913', estado: 'borrador',
  num_obra: 3, plano: '', ciclo: 'C1', eje: '12(G-E)', sector: 'ELEV', estructura: 'MURO' },
  barras: [] };
// Lo que devuelve GET /lotes/{id}/elementos: una estructura sana y una HUERFANA
// (justo la del reporte: sin ciclo ni eje propios, 0 barras, 0 kg).
const ELEMENTOS = { ok: true, lote_id: 148, elementos: [
  { id: 11, nombre: 'PROY-A192D913 · C1 · P3 · 12(G-E)', elemento: 'muro', piso: 'P3',
    estado: 'activa', n_items: 2, n_barras: 6, kg: 47.7, diam_prom: 12,
    id_proyecto: 'PROY-A192D913', ciclo: 'C1', eje: '12(G-E)' },
  { id: 12, nombre: 'PROY-A192D913 · P5', elemento: 'muro', piso: 'P5',
    estado: 'activa', n_items: 0, n_barras: 0, kg: 0, diam_prom: 0,
    id_proyecto: 'PROY-A192D913', ciclo: 'C1', eje: '12(G-E)' }
] };

async function bloqueC() {
  console.log('');
  console.log('C - EL LISTADO DE ESTRUCTURAS: HUERFANAS, NOMBRE DE OBRA Y KPIs');
  const s = ac2Con(function (url) {
    if (/\/elementos$/.test(url)) return ELEMENTOS;
    return LOTE_CON_ESTRUCTURAS;
  });
  const w = s.window;
  w.AC2._nombreObra = 'Edificio Explora';
  await w.ac2RetomarLote(148, true);
  // El indice de estructuras se pide SIN await (la grilla no espera por el): hay que
  // dejar correr las microtareas antes de mirar lo que pinto.
  for (let i = 0; i < 8; i++) await new Promise(function (r) { setImmediate(r); });

  // --- una sola consulta para toda la tabla (no una por estructura)
  const pedidos = s._llamadas.filter(function (l) { return /\/lotes\/148\/elementos$/.test(l.url); });
  ok(pedidos.length === 1,
    'las estructuras y sus KPIs se piden en UNA consulta, no una por fila (hay ' + pedidos.length + ')');

  const html = String(s.document.getElementById('ac2_estructurasBody').innerHTML);
  ok(html !== '', 'el listado se pinto');

  // --- C2: el nombre de la OBRA, no su codigo
  ok(html.indexOf('Edificio Explora') >= 0, 'la fila dice el NOMBRE de la obra');
  ok(html.indexOf('>PROY-A192D913 ·') < 0, 'y ya no el codigo interno');
  ok(w.ac2NombreEstructura(ELEMENTOS.elementos[0]) === 'Edificio Explora · C1 · P3 · 12(G-E)',
    'la etiqueta se arma obra · ciclo · piso · eje (=' + w.ac2NombreEstructura(ELEMENTOS.elementos[0]) + ')');
  // El nombre guardado NO se toca: es la traza que leera el element manager.
  ok(html.indexOf('PROY-A192D913 · C1 · P3 · 12(G-E)') >= 0,
    'el nombre PERSISTIDO sigue disponible (en el title de la celda), no se reescribe');
  // Sin nombre de obra cargado se cae al codigo antes que a nada: siempre dice algo.
  w.AC2._nombreObra = '';
  ok(w.ac2NombreEstructura(ELEMENTOS.elementos[0]).indexOf('PROY-A192D913') === 0,
    'sin nombre de obra en memoria cae al codigo, no a un hueco');
  w.AC2._nombreObra = 'Edificio Explora';

  // --- C3: los KPIs, con la MISMA formula que el repositorio de despieces
  ok(/PPB|Peso Por Barra/.test(html), 'la fila trae la celda de PPB');
  ok(/Peso Por Item/.test(html), 'y la de PPI');
  ok(/ponderado por peso/.test(html), 'y la del O promedio');
  // 47.7 kg / 6 barras = 7.95 · 47.7 / 2 items = 23.85
  ok(html.indexOf('7.95') >= 0, 'PPB = kg / barras fisicas (47.7/6 = 7.95)');
  ok(html.indexOf('23.85') >= 0, 'PPI = kg / items (47.7/2 = 23.85)');
  // UNA sola fuente: el mismo objeto pintado por la funcion compartida da lo mismo
  // en las dos tablas (si alguien duplica la formula, esto deja de cuadrar).
  ok(w.ac2KpisTd(ELEMENTOS.elementos[0], '6px 8px').replace(/6px 8px/g, '5px 8px') ===
     w.ac2KpisTd(ELEMENTOS.elementos[0], '5px 8px'),
    'las dos tablas pintan por la MISMA funcion (ac2KpisTd), no por dos calculos');
  // Sin dato va '—', nunca 0: la huerfana no puede parecer una estructura de 0 kg reales.
  const kpiVacio = w.ac2KpisTd(ELEMENTOS.elementos[1], '5px 8px');
  ok(kpiVacio.indexOf('—') >= 0 && !/>0<|>0\.00</.test(kpiVacio),
    'la estructura sin barras muestra "—" en sus KPIs, no ceros');

  // --- C1: la huerfana se ve por lo que es y se puede eliminar
  ok(/sin barras/.test(html), 'la estructura vacia se marca "sin barras" (no se disimula)');
  ok(/ac2EliminarEstructura\(12\)/.test(html), 'y ofrece eliminarla');
  ok(!/ac2EliminarEstructura\(11\)/.test(html),
    'la que SI tiene barras no ofrece borrarse: eso se hace reabriendo la estructura');
  ok(/ac2AbrirEditor3D\(11\)/.test(html), 'y sigue abriendo su 3D como siempre');
  // La huerfana NO es basura: guarda la receta del elemento que el usuario modelo.
  // Borrarla no puede ser la unica salida — reabrirla y recargarla RECUPERA el trabajo.
  ok(/ac2AbrirEditor3D\(12\)/.test(html),
    'la vacia TAMBIEN se puede abrir: su receta esta guardada y recargarla recupera el elemento');

  // Borrar PREGUNTA antes (nada se elimina en silencio) y va por el DELETE del backend,
  // que es el que comprueba el cero de verdad.
  s._llamadas.length = 0;
  s._confirmar = false;
  await w.ac2EliminarEstructura(12);
  ok(s._confirms.length === 1, 'eliminar pregunta antes');
  ok(/dise/i.test(s._confirms[0]), 'y avisa que lo que se pierde es el DISENO guardado');
  ok(s._llamadas.length === 0, 'y si el usuario dice que no, no llama a nadie');
  s._confirmar = true;
  await w.ac2EliminarEstructura(12);
  const del = s._llamadas.filter(function (l) { return l.metodo === 'DELETE'; });
  ok(del.length === 1 && /\/elementos\/instancia\/12$/.test(del[0].url),
    'y al confirmar borra por DELETE /elementos/instancia/{id}');
  ok(s._llamadas.some(function (l) { return /\/lotes\/148\/elementos$/.test(l.url); }),
    'y refresca el listado despues (el numero que se ve es el de la BD)');
}

bloqueA().then(bloqueB).then(bloqueC).then(function () {
  console.log('');
  console.log(fallos ? (fallos + ' FALLO(S)') : 'TODO OK');
  if (fallos) process.exit(1);
}).catch(function (e) {
  console.error('EXCEPCION: ' + ((e && e.stack) || e));
  process.exit(1);
});
