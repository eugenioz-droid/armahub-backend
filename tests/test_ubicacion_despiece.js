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
function doc() {
  return { getElementById: function () { return null; }, querySelector: function () { return null; },
    querySelectorAll: function () { return []; }, addEventListener: noop,
    createElement: function () { return Object.assign({}, fakeEl); },
    body: Object.assign({}, fakeEl) };
}

// --- AC2 en un sandbox con el GET del lote falseado --------------------------
const SRC_AC2 = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'cubicacion', 'agregar_cubicacion2.js');
const CODE_AC2 = fs.readFileSync(SRC_AC2, 'utf8');

function ac2Con(respuesta) {
  const d = doc();
  const sandbox = { console: { log: noop, warn: noop, error: noop }, document: d,
    setTimeout: function (fn) { return fn && fn(); }, clearTimeout: noop,
    alert: noop, confirm: function () { return true; },
    authHeaders: function () { return {}; }, apiUrl: function (u) { return u; },
    fetch: function () {
      return Promise.resolve({ ok: true, status: 200,
        json: function () { return Promise.resolve(respuesta); } });
    } };
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

bloqueA().then(bloqueB).then(function () {
  console.log('');
  console.log(fallos ? (fallos + ' FALLO(S)') : 'TODO OK');
  if (fallos) process.exit(1);
}).catch(function (e) {
  console.error('EXCEPCION: ' + ((e && e.stack) || e));
  process.exit(1);
});
