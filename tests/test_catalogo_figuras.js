// =============================================================================
// Test headless (Node) del CATÁLOGO REAL DE FIGURAS (TANDA 2 · T7).
// -----------------------------------------------------------------------------
// Qué fija este test (y qué bug evita que vuelva):
//
//   A. ESPEJO = CATÁLOGO. catalogo_figuras.js tiene las 63 figuras de
//      armahub/catalogo.py con SUS parciales/ángulos/radio. Se compara contra el
//      .py leído desde JS (sin depender de python) y, si python está disponible,
//      se corre además `gen_catalogo_figuras.py --check`.
//      Bug que evita: los espejos a mano (5 figuras en generar.js, 8 en el
//      editor) y encima MAL — 106A figuraba con 4 parciales y ángulos 135/135
//      cuando el catálogo dice 6 parciales A–F con 45/45.
//
//   B. TODA figura dibujable genera payload VÁLIDO: llena EXACTAMENTE los slots
//      de sus parciales (resto null), sus ángulos, y kg > 0.
//      Bug que evita: dibujar una 102B salía en el 3D pero el payload iba con
//      todas las dims en null → 0 kg y rechazo de validar_geometria.
//
//   C. Figura DESCONOCIDA → aviso en comp._avisos y CERO barras (no un payload
//      con nulls silenciosos).
//
//   D. EMPALME sólo donde es real: en estribo/traba se ignora y se avisa (antes
//      sumaba kg fantasma sin mover el dibujo).
//
//   E. La viga-semilla: 4 ítems / 72 barras / 140.1 kg (bajaron de 140.2 a 136.1
//      al migrar el cabezal al trazador — ver la nota en la sección G).
//
// Correr con: node tests/test_catalogo_figuras.js
// =============================================================================

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const base = path.join(RAIZ, 'armahub', 'static', 'js', 'features', 'modelador');
global.ModeladorCatalogoFiguras = require(path.join(base, 'catalogo_figuras.js'));
global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
require(path.join(base, 'motor_geom.js'));
global.ModeladorReglas = require(path.join(base, 'reglas.js'));
const G = require(path.join(base, 'generar.js'));
const S = require(path.join(base, 'semilla_viga.js'));
const CAT = global.ModeladorCatalogoFiguras;
const FP = global.ModeladorFiguraPuntos;

let fallos = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); fallos++; } else { console.log('  ✓ ' + m); } }
const r1 = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// A. EL ESPEJO COINCIDE CON armahub/catalogo.py
// ---------------------------------------------------------------------------
console.log('A — espejo estático vs armahub/catalogo.py:');

// Lectura del seed desde JS (independiente de python): el bloque
// `_FIGURAS_SEED = [ ("101A", ["A"], [], False), … ]`.
function seedDesdePy() {
  const py = fs.readFileSync(path.join(RAIZ, 'armahub', 'catalogo.py'), 'utf8');
  const ini = py.indexOf('_FIGURAS_SEED = [');
  const fin = py.indexOf('\n]', ini);
  if (ini < 0 || fin < 0) throw new Error('no se encontró _FIGURAS_SEED en catalogo.py');
  const bloque = py.slice(ini, fin);
  const re = /\("([^"]+)",\s*\[([^\]]*)\],\s*\[([^\]]*)\],\s*(True|False)\)/g;
  const out = {};
  let m;
  while ((m = re.exec(bloque)) !== null) {
    const letras = m[2].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
    const angs = m[3].split(',').map(s => s.trim()).filter(Boolean).map(Number);
    out[m[1]] = { parciales: letras, angulos: angs, radio: m[4] === 'True' };
  }
  return out;
}

const SEED = seedDesdePy();
const nSeed = Object.keys(SEED).length;
ok(nSeed === 63, 'catalogo.py declara 63 figuras (=' + nSeed + ')');
ok(CAT.codigos().length === nSeed, 'el espejo tiene las mismas ' + nSeed + ' figuras (=' + CAT.codigos().length + ')');

let difs = [];
Object.keys(SEED).forEach(function (cod) {
  const a = SEED[cod], b = CAT.get(cod);
  if (!b) { difs.push(cod + ': falta en el espejo'); return; }
  if (a.parciales.join('') !== b.parciales.join('')) difs.push(cod + ': parciales ' + b.parciales + ' ≠ ' + a.parciales);
  if (a.angulos.join(',') !== b.angulos.join(',')) difs.push(cod + ': ángulos ' + b.angulos + ' ≠ ' + a.angulos);
  if (a.radio !== b.radio) difs.push(cod + ': radio ' + b.radio + ' ≠ ' + a.radio);
});
ok(difs.length === 0, 'parciales/ángulos/radio IDÉNTICOS figura por figura' + (difs.length ? ' — ' + difs.slice(0, 3).join(' · ') : ''));

// Las tres que estaban MAL en los espejos a mano (regresión histórica).
const f106 = CAT.get('106A');
ok(f106 && f106.parciales.join('') === 'ABCDEF' && f106.angulos.join(',') === '45,45',
  '106A: 6 parciales A–F y ángulos 45/45 (el espejo viejo decía 4 parciales y 135/135)');
ok(CAT.get('102B').angulos.join(',') === '135', '102B: ángulo 135 (el espejo viejo decía sin ángulos)');
ok(CAT.get('103D').angulos.join(',') === '135', '103D: UN ángulo 135 (el espejo viejo decía 45/45)');
ok(CAT.get('201A').radio === true && CAT.get('201A').parciales.join('') === 'BGH',
  '201A: usa radio y parciales B/G/H (única con radio del catálogo)');
ok(CAT.get('104d') !== null && CAT.get(' 104D ') !== null, 'get() normaliza mayúsculas/espacios');
ok(CAT.get('ZZZZ') === null, 'get() de una figura inexistente devuelve null (no un spec vacío)');

// Verificación cruzada con el generador (si hay python).
let py = null;
for (const cmd of ['python', 'py', 'python3']) {
  try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); py = cmd; break; } catch (e) { /* siguiente */ }
}
if (py) {
  let salida = '', okGen = true;
  try {
    salida = execFileSync(py, [path.join('tests', 'gen_catalogo_figuras.py'), '--check'],
      { cwd: RAIZ, encoding: 'utf8' });
  } catch (e) { okGen = false; salida = (e.stdout || '') + (e.stderr || ''); }
  ok(okGen, 'gen_catalogo_figuras.py --check: el .js está al día — ' + salida.trim().split('\n')[0]);
} else {
  console.log('  · python no disponible: se omite gen_catalogo_figuras.py --check (la comparación JS ya cubrió la data)');
}

// ---------------------------------------------------------------------------
// B. QUÉ SE DIBUJA Y QUÉ NO (regla, no lista)
// ---------------------------------------------------------------------------
console.log('\nB — dibujables vs excluidas (por regla sobre el catálogo):');
const noDib = CAT.noDibujables();
const dib = CAT.dibujables();
ok(dib.length + Object.keys(noDib).length === nSeed, 'toda figura queda clasificada (dibujable o excluida con motivo)');
ok(Object.keys(noDib).every(c => !!noDib[c]), 'TODA excluida trae motivo escrito');
ok(noDib['201A'] && /radio/.test(noDib['201A']), '201A excluida por radio (hélice/espiral)');
// El TRAZADOR GENÉRICO DE CADENAS (12-ago) rescató a las de 5+ tramos: dejaron de
// excluirse por nº de lados y ahora se trazan enteras (familia 'cadena'). El
// criterio que queda es el RADIO, que sigue sin trazarse (y se dice por qué).
ok(!noDib['105A'] && !noDib['106A'], '105A/106A YA NO se excluyen (cadena y estribo respectivamente)');
// CORRECCIÓN 14-ago: la 106A NUNCA fue una cadena — es el ESTRIBO rectangular
// con sus ganchos declarados como parciales (A/F). El 13-ago se clasificó mal
// («rombo») y este assert congeló esa lectura. Familia real: estribo (marco).
ok(FP.dibujabilidad('105A').familia === 'cadena' && FP.dibujabilidad('106A').familia === 'estribo',
  '105A = cadena · 106A = ESTRIBO con ganchos declarados (el marco manda)');
ok(Object.keys(noDib).length === 1, 'la única excluida del catálogo es la de radio (=' +
  Object.keys(noDib).join(',') + ')');
ok(!noDib['104D'] && !noDib['103B'] && !noDib['101A'], 'las de 1–4 lados NO se excluyen (101A/103B/104D)');
ok(CAT.noDibujables('104D') === null && typeof CAT.noDibujables('201A') === 'string',
  'noDibujables(codigo) responde por UNA figura: null si se dibuja, motivo si no');
ok(Object.keys(CAT.noDibujables()).length === Object.keys(noDib).length,
  'noDibujables() sin argumento sigue devolviendo el mapa completo');
// ASSERT CAMBIADO (14-ago): decía «el ROL manda la familia» y la 101A-traba
// devolvía la FORMA FIJA. La regla del usuario es la contraria: la FIGURA se
// dibuja como se dibujó — toda figura con tramos derivables es cadena (la 101A
// recta incluida); la forma fija murió con sus ganchos fantasma no facturados.
ok(FP.familiaDeDibujo('104D', 'estribo') === 'estribo' && FP.familiaDeDibujo('101A', 'traba') === 'recta',
  'la FIGURA manda la familia: marco cerrado → estribo · 101A → su trazo real (recta)');
// MIGRACIÓN CABEZAL → TRAZADOR: sin rol, una figura de 2–3 lados ya NO cae en el
// constructor de cabezal sino en el trazador genérico. Razón física: el cabezal
// dibuja los dos dobleces a 90° FIJOS e ignora los ángulos del catálogo — una
// 103C (45/90) salía con la MISMA polilínea que una 103A (90/90), o sea sin su
// gancho. El resto de la cascada no se mueve: 1 lado sigue siendo recta (no tiene
// doblez que honrar) y el marco cerrado de 4 sigue siendo estribo (tiene su
// constructor calibrado con arcos).
ok(FP.familiaDeDibujo('104A', null) === 'estribo' && FP.familiaDeDibujo('101A', null) === 'recta' &&
  FP.familiaDeDibujo('103A', null) === 'cadena',
  'sin rol la familia sale del nº de lados: 4 (marco) → estribo, 1 → recta, 2+ → cadena');
ok(FP.patasDeFigura('101A').inicio === false && FP.patasDeFigura('102A').fin === false &&
  FP.patasDeFigura('103B').inicio === true && FP.patasDeFigura('103B').fin === true,
  'patas derivadas de los parciales: 101A ninguna, 102A sólo inicial, 103B las dos');

// ---------------------------------------------------------------------------
// C. CADA FIGURA DIBUJABLE PRODUCE UN PAYLOAD VÁLIDO
// ---------------------------------------------------------------------------
console.log('\nC — payload válido para las ' + dib.length + ' figuras dibujables:');
const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

// validar_geometria del backend, pero leyendo el catálogo (no una tabla a mano).
function validarSlots(b) {
  const spec = CAT.get(b.figura);
  if (!spec) return 'figura desconocida ' + b.figura;
  for (const L of LETRAS) {
    const col = 'dim_' + L.toLowerCase();
    const usa = spec.parciales.indexOf(L) !== -1;
    const tiene = b[col] != null && b[col] !== 0;
    if (usa && !tiene) return 'falta ' + col + ' en ' + b.figura;
    if (!usa && tiene) return 'sobra ' + col + ' en ' + b.figura;
  }
  for (let i = 0; i < 4; i++) {
    const usa = i < spec.angulos.length;
    const tiene = b['ang' + (i + 1)] != null && b['ang' + (i + 1)] !== 0;
    if (usa && !tiene) return 'falta ang' + (i + 1) + ' en ' + b.figura;
    if (!usa && tiene) return 'sobra ang' + (i + 1) + ' en ' + b.figura;
    if (usa && b['ang' + (i + 1)] !== spec.angulos[i]) {
      return 'ang' + (i + 1) + ' = ' + b['ang' + (i + 1)] + ' ≠ ' + spec.angulos[i] + ' en ' + b.figura;
    }
  }
  const tieneR = b.radio != null && b.radio !== 0;
  if (spec.radio && !tieneR) return 'falta radio en ' + b.figura;
  if (!spec.radio && tieneR) return 'sobra radio en ' + b.figura;
  return null;
}

const GEO = { largo: 600, ancho: 30, alto: 60, recub_sup: 4, recub_inf: 4, recub_lat: 3 };
const CTX = { sector: 'S1', ciclo: 'C1', piso: 'P1', eje: 'E1' };

// Componente de prueba para una figura: la tipología sale de la FAMILIA (estribo
// → ES; el resto → CBS), y las dims declaran EXACTAMENTE los parciales de la
// figura — el lado longitudinal en 'auto' y los demás fijos (como una receta real).
function componenteDe(fig) {
  const spec = CAT.get(fig);
  const fam = FP.dibujabilidad(fig).familia;
  const esEstribo = fam === 'estribo';
  const largoL = spec.parciales.indexOf('B') >= 0 ? 'B' : spec.parciales[0];
  const dims = {};
  spec.parciales.forEach(function (L) {
    dims[L] = (esEstribo || L === largoL) ? { modo: 'auto' } : { modo: 'fija', valor: 30 };
  });
  return {
    comp_id: fig, tipologia: esEstribo ? 'ES' : 'CBS', figura: fig,
    diam: esEstribo ? 8 : 16, suf_tipo: '', cara: esEstribo ? 'lateral' : 'sup',
    dims: dims,
    distribucion: esEstribo
      ? { modo: 'linear', zonas: [{ long: 600, sep: 50 }], start_offset: 4 }
      : { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0, sentido: 'nucleo' }
  };
}

const matriz = [];
let errSlots = null, sinBarras = null, sinKg = null, conAviso = [];
dib.forEach(function (fig) {
  const comp = componenteDe(fig);
  const out = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [comp] }, CTX);
  const b = out.barras[0];
  if (!b) { if (!sinBarras) sinBarras = fig; return; }
  const e = validarSlots(b);
  if (e && !errSlots) errSlots = e;
  if (!(out.resumen.kg > 0) && !sinKg) sinKg = fig + ' → ' + out.resumen.kg + ' kg';
  if (comp._avisos && comp._avisos.length) conAviso.push(fig + ': ' + comp._avisos[0]);
  matriz.push({
    figura: fig, familia: FP.dibujabilidad(fig).familia, lados: CAT.get(fig).parciales.length,
    dims: LETRAS.filter(L => b['dim_' + L.toLowerCase()] != null).join(''),
    angs: [b.ang1, b.ang2, b.ang3, b.ang4].filter(a => a != null).join('/'),
    kg: r1(out.resumen.kg)
  });
});
ok(matriz.length === dib.length, 'las ' + dib.length + ' dibujables generan barras (' + matriz.length + ')');
ok(!sinBarras, 'ninguna dibujable se queda sin payload' + (sinBarras ? ' — ' + sinBarras : ''));
ok(!errSlots, 'todas pasan validar_geometria (slots y ángulos exactos)' + (errSlots ? ' — ' + errSlots : ''));
ok(!sinKg, 'todas con kg > 0' + (sinKg ? ' — ' + sinKg : ''));
ok(matriz.every(m => m.dims.length === m.lados), 'nº de casillas dim llenas = nº de parciales, figura por figura');
ok(conAviso.length === 0, 'ninguna dibujable deja avisos' + (conAviso.length ? ' — ' + conAviso[0] : ''));

// NO DIBUJABLE → NO genera barra (semántica corregida tras los hallazgos D1/D2
// del verificador de la Tanda 2: dejar pasar el payload de las no-dibujables
// producía radio:null que el backend rechaza y kg fantasma con dims auto — 29.6 m
// y 46.7 kg que validar_geometria ACEPTABA). La ficha de la UI promete "no se
// dibuja ni pesa hasta corregirla" y el motor cumple esa promesa.
// El caso testigo es ahora 201A (radio): 105A/106A pasaron a dibujarse con el
// trazador genérico de cadenas, así que ya no sirven de ejemplo de excluida.
console.log('\nC2 — 201A (no dibujable: usa radio) NO genera barra y avisa:');
const comp201 = {
  comp_id: '201A', tipologia: 'CBS', figura: '201A', diam: 16, cara: 'sup', suf_tipo: '',
  dims: {
    B: { modo: 'auto' }, G: { modo: 'fija', valor: 30 }, H: { modo: 'fija', valor: 25 }
  },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0, sentido: 'nucleo' }
};
const out201 = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [comp201] }, CTX);
ok(out201.barras.length === 0, '201A NO genera barra (=' + out201.barras.length + ')');
ok(out201.resumen.kg === 0, '201A no pesa (=' + out201.resumen.kg + ' kg — nada de kg fantasma)');
ok((out201.placements || []).every(pl => pl._sinPayload),
  'sus placements van marcados _sinPayload (el 3D puede insinuarla, el despiece no)');
ok((comp201._avisos || []).some(a => /no la soporta/.test(a) && /radio/.test(a)),
  'y deja aviso claro con el motivo (=' + (comp201._avisos || [])[0] + ')');

// 106A (6 lados) SÍ genera barra ahora: la cadena genérica la traza entera.
console.log('\nC2b — 106A (estribo con ganchos declarados) genera barra completa:');
const comp106 = {
  comp_id: '106A', tipologia: 'CBS', figura: '106A', diam: 16, cara: 'sup', suf_tipo: '',
  dims: {
    A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 },
    D: { modo: 'fija', valor: 25 }, E: { modo: 'fija', valor: 25 }, F: { modo: 'fija', valor: 20 }
  },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0, sentido: 'nucleo' }
};
const out106 = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [comp106] }, CTX);
ok(out106.barras.length === 1 && out106.resumen.kg > 0,
  '106A genera barra y pesa (=' + out106.resumen.kg + ' kg)');
// El marco dibuja los 6 lados: 4 de cuerpo + 2 ganchos con codos en ARCO
// muestreado (~35 puntos, no 7): se verifica que la polilínea es de marco.
ok(out106.placements.every(pl => pl.puntos.length > 7),
  'polilínea de marco con codos en arco (>7 puntos, =' + (out106.placements[0] || {}).puntos.length + ')');
ok(!validarSlots(out106.barras[0]), '106A pasa validar_geometria: 6 dims + ang1/ang2' +
  (validarSlots(out106.barras[0]) ? ' — ' + validarSlots(out106.barras[0]) : ''));
// AVISOS — ASSERT CAMBIADO (14-ago) POR UNA RAZÓN FÍSICA, no para que pase.
// Antes acá decía «y sin avisos pendientes», y era verdad sólo porque el motor NO
// dibujaba lo que esta receta dice. Sus dims fijas describen un rectángulo de
// 30×25 con ganchos de 30 y 20 cm; lo que se dibujaba era el MARCO del hormigón
// (52 alto × 24 ancho) con las dos patas en la constante normativa 9.6 — o sea el
// 3D mostraba una barra que no es la que se corta, y no decía una palabra. Ahora:
//   · los ganchos A/F se dibujan CON LA MEDIDA ESCRITA (30 y 20 cm). Por eso la
//     pieza pasa a ocupar 28.04 cm de z en un núcleo de 22.4 y asoma 2.64 cm: lo
//     dice el aviso de fierro fuera del hormigón, medido sobre estos mismos puntos.
//     Ese fierro asomaba igual antes — la receta pide un gancho de 30 cm en una
//     viga de 30 de ancho —, sólo que el dibujo lo tapaba.
//   · y las dims C/D/E del rectángulo SÍ mandan el marco desde el 21-ago (antes se
//     listaban y el trazo salía del hormigón; ahora el alto dibujado es el 25 que
//     pide la receta, no los 52 del núcleo). Con eso a la vista, la receta se
//     delata sola: C y E miden EL MISMO ancho del marco pero sus 'auto' valen 19 y
//     24 —uno está recortado por el gancho—, así que ponerles 25 a las dos pide
//     dos anchos distintos y el contorno no cierra. El motor dibuja el mayor y lo
//     dice, que es el mismo aviso que ya emitía para dos Δ en conflicto.
// Lo que este bloque cuida NO cambia y sigue arriba: la 106A genera su barra,
// pesa, sale con polilínea de marco y pasa validar_geometria.
ok((comp106._avisos || []).some(a => /el contorno no cierra/.test(a)),
  'avisa que sus dos dims del ancho piden marcos distintos (=' +
  JSON.stringify(comp106._avisos) + ')');
ok(!(comp106._avisos || []).some(a => /no la soporta|omitid/i.test(a)),
  'y ningún aviso es un rechazo: la figura se genera entera (=' +
  JSON.stringify(comp106._avisos) + ')');

// ---------------------------------------------------------------------------
// D. FIGURA DESCONOCIDA → AVISO Y CERO PAYLOAD
// ---------------------------------------------------------------------------
console.log('\nD — figura fuera del catálogo:');
const compX = {
  comp_id: 'X', tipologia: 'CBS', figura: '999Z', diam: 16, cara: 'sup', suf_tipo: '',
  dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' } },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 3, gap: 0, sentido: 'nucleo' }
};
const outX = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [compX] }, CTX);
ok(outX.barras.length === 0, 'no genera NINGUNA barra (antes salían con dims null y 0 kg)');
ok(outX.resumen.kg === 0 && outX.resumen.items === 0, 'resumen en cero (nada que cargar al despiece)');
ok(outX.placements.length > 0, 'pero los placements existen: se ve en el 3D que algo se colocó');
ok((compX._avisos || []).some(a => /999Z/.test(a) && /catálogo/.test(a)),
  'aviso en comp._avisos nombrando la figura (=' + (compX._avisos || [])[0] + ')');
ok(Object.keys(compX).indexOf('_avisos') < 0, '_avisos NO es enumerable (no ensucia la receta que se guarda)');
ok(G.placementABarra({ figura: '999Z', diam: 1.6, dims: {}, puntos: [] }, {}) === null,
  'placementABarra devuelve null para figura desconocida (no un payload de nulls)');

// ASSERT CAMBIADO (14-ago) POR UNA RAZÓN DE FONDO, no para que pase: una figura
// CERRADA (104A) es pieza de sección VENGA LA TIPOLOGÍA QUE VENGA — la topología
// no se negocia. Antes familiaDeDibujo dejaba que el rol 'cabezal' la clasificara
// como corchete ("ruta histórica": 3 lados + aviso del 4º), la misma inconsistencia
// que hizo aterrizar la 106A bajo MH en el plano equivocado. Ahora el marco manda
// también aquí: la barra sale con TODAS sus dims al despiece.
// Y desde el 21-ago el marco OBEDECE a esas dims fijas (antes se dibujaba el del
// hormigón y el aviso decía «el marco lo fija el HORMIGÓN; para moverlo usa el Δ»).
// El par espejo hace que B siga a D: el marco pedido mide 30 × 20 y ocupa 28.4 cm
// de z en un núcleo de 22.4 — la receta no cabe en la viga y ESO es lo que se avisa
// ahora, en vez de tapar la medida escrita dibujando otra cosa.
const compD = {
  comp_id: 'D', tipologia: 'CBS', figura: '104A', diam: 16, cara: 'sup', suf_tipo: '',
  dims: {
    A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' },
    C: { modo: 'fija', valor: 30 }, D: { modo: 'fija', valor: 20 }
  },
  distribucion: { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0, sentido: 'nucleo' }
};
const outD = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [compD] }, CTX);
ok(outD.barras.length === 1 && outD.barras[0].dim_d === 20,
  '104A como cabezal: la barra sale igual y lleva su lado D (=' + (outD.barras[0] || {}).dim_d + ')');
ok(Number(outD.placements[0].dims.B) === 20 &&
   (compD._avisos || []).some(a => /no cabe ni una vez/.test(a)),
  'el marco obedece a las dims escritas (B sigue a su espejo D = 20) y se avisa que ' +
  'no cabe en la viga (=' + (compD._avisos || [])[0] + ')');

// ---------------------------------------------------------------------------
// E. EMPALME SOLO DONDE ES REAL (kg fantasma en estribo/traba)
// ---------------------------------------------------------------------------
console.log('\nE — empalme: se ignora en estribo/traba y se avisa:');
function estribo(empalme) {
  return {
    comp_id: 'ES', tipologia: 'ES', figura: '104D', diam: 8, cara: 'lateral', suf_tipo: '',
    empalme: empalme || null,
    dims: { A: { modo: 'auto' }, B: { modo: 'auto' }, C: { modo: 'auto' }, D: { modo: 'auto' } },
    distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 50 }], start_offset: 4 }
  };
}
const esBase = estribo(null), esEmp = estribo({ extremo: 'ambos', valor: 50 });
const oBase = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [esBase] }, CTX);
const oEmp = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [esEmp] }, CTX);
ok(oBase.resumen.kg === oEmp.resumen.kg,
  'estribo con empalme 50 pesa IGUAL que sin empalme (' + oEmp.resumen.kg + ' kg): no hay kg fantasma');
ok(oBase.barras[0].dim_b === oEmp.barras[0].dim_b, 'y su dim B no se alarga (=' + oEmp.barras[0].dim_b + ')');
ok((esEmp._avisos || []).some(a => /[Ee]mpalme ignorado/.test(a)),
  'con aviso explícito (=' + (esEmp._avisos || [])[0] + ')');

function traba(empalme) {
  return {
    comp_id: 'TRV', tipologia: 'TRV', figura: '101A', diam: 8, cara: 'lateral', suf_tipo: '',
    empalme: empalme || null, dims: { A: { modo: 'auto' } },
    distribucion: { modo: 'linear', zonas: [{ long: 600, sep: 100 }], start_offset: 4 }
  };
}
const tEmp = traba({ inicio: 20, fin: 30 });
const oT = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [tEmp] }, CTX);
const oTBase = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [traba(null)] }, CTX);
// ASSERT INVERTIDO (14-ago, Modelo A): la traba ES un longitudinal — si el
// usuario declara empalme, se aplica a su dominante como en cualquier barra
// (antes el rol la excluía; el rol murió). 52 + 20 + 30 = 102.
ok(oT.barras[0].dim_a === oTBase.barras[0].dim_a + 50,
  'traba-longitudinal: el empalme declarado SÍ se aplica (+50 → ' + oT.barras[0].dim_a + ')');

// El cabezal SÍ empalma (no se rompió lo que funcionaba).
function cabezal(empalme) {
  return {
    comp_id: 'CBI', tipologia: 'CBI', figura: '101A', diam: 18, cara: 'inf', suf_tipo: '',
    empalme: empalme || null, dims: { A: { modo: 'fija', valor: 500 } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0, sentido: 'nucleo' }
  };
}
const cEmp = G.generarViga({ tipo: 'viga', geometria: GEO, componentes: [cabezal({ extremo: 'fin', valor: 50 })] }, CTX);
ok(cEmp.barras[0].dim_a === 550, 'cabezal: el empalme SIGUE alargando (500 + 50 = ' + cEmp.barras[0].dim_a + ')');

// ---------------------------------------------------------------------------
// F. DATA FRESCA DEL BACKEND (lo que la UI llama tras el GET)
// ---------------------------------------------------------------------------
console.log('\nF — actualizar() con la respuesta de GET /figuras-catalogo:');
const respaldo = CAT.codigos().map(c => JSON.parse(JSON.stringify(CAT.get(c))));
const vacio = CAT.actualizar({ figuras: [] });
ok(vacio.ok === false && CAT.codigos().length === nSeed,
  'respuesta VACÍA no pisa nada: se conserva el espejo estático (' + CAT.codigos().length + ')');
const fresco = CAT.actualizar({
  figuras: [
    { codigo: '101A', parciales: ['A'], angulos: [], radio: false, descripcion: 'Barra recta' },
    { codigo: '777X', parciales: ['A', 'B', 'C'], angulos: [90, 90], radio: false, descripcion: 'Figura nueva' }
  ]
});
ok(fresco.ok === true && CAT.codigos().length === 2, 'data fresca REEMPLAZA el catálogo (2 figuras)');
ok(CAT.esFresco() === true, 'esFresco() marca que la data viene del backend');
ok(CAT.get('777X') !== null && G.FIGURAS['777X'] !== undefined,
  'una figura NUEVA del backend queda disponible para el motor sin tocar código');
const out777 = G.generarViga({
  tipo: 'viga', geometria: GEO, componentes: [{
    comp_id: '777X', tipologia: 'CBS', figura: '777X', diam: 16, cara: 'sup', suf_tipo: '',
    dims: { A: { modo: 'fija', valor: 30 }, B: { modo: 'auto' }, C: { modo: 'fija', valor: 30 } },
    distribucion: { modo: 'layered', n_capas: 1, barras_capa: 2, gap: 0, sentido: 'nucleo' }
  }]
}, CTX);
ok(out777.barras.length === 1 && out777.barras[0].ang1 === 90 && out777.barras[0].ang2 === 90 &&
  out777.resumen.kg > 0, 'y genera payload correcto con SUS ángulos (90/90) y kg > 0');
ok(CAT.get('104D') === null && G.generarViga({
  tipo: 'viga', geometria: GEO, componentes: [estribo(null)]
}, CTX).barras.length === 0, 'una figura que el backend YA NO tiene pasa a ser desconocida (sin payload)');
// Restaurar el espejo para no contaminar lo que sigue.
CAT.actualizar({ figuras: respaldo });
ok(CAT.codigos().length === nSeed, 'restaurado el espejo (' + CAT.codigos().length + ' figuras)');

// ---------------------------------------------------------------------------
// G. VIGA-SEMILLA INTACTA
// ---------------------------------------------------------------------------
console.log('\nG — viga-semilla: mismo listado, kg re-derivado:');
// 18-AGO · 136.1 -> 140.1 kg (CONVENCION DE VERTICE, cerrada por el usuario). El
// numero del catalogo pasa a leerse como ANGULO DEL VERTICE (el que queda entre los
// dos tramos de fierro) y no como recorrido del doblado. Consecuencia en la semilla:
// las patas de 45 del CBS 103B quedan REPLEGADAS sobre el cuerpo en vez de abiertas,
// asi que ya no le roban largo al tramo B: su 'auto' sube de 547.974 a 590.4 (la
// unica reserva por punta que queda es la cresta del codo, phi/2 = 0.8). Son 42.426
// cm mas por barra x 6 barras phi16 = 4.0 kg. Items, barras y las otras 3 figuras del
// listado (2 x 101A y el estribo 104D) no se mueven ni un gramo.
// --- HISTORIA PREVIA (12-ago), ya superada por la nota de arriba: ---
// 140.2 → 136.1 kg POR LA MIGRACIÓN CABEZAL → TRAZADOR. El CBS es una 103B con
// dobleces de 45°/45° en el catálogo, que el constructor de cabezal ignoraba. Al
// honrarlos, cada pata de 30 proyecta 30·cos45 = 21.2132 sobre el eje de la barra
// y la cresta del codo se retira φ/2 = 0.8 del recub de extremo, así que el
// auto-largo RESERVA 22.0132 por punta: B = 592 − 44.0264 = 547.974 (con 592 la
// pieza asomaba 21.2 cm fuera del hormigón por cada extremo). 6 barras φ16:
// 61.745 → 57.575 kg. Ítems y barras no se mueven — sólo cambia una dim.
const semilla = G.generarViga(S.semillaViga(), CTX);
ok(semilla.resumen.items === 4, 'items = 4 (=' + semilla.resumen.items + ')');
ok(semilla.resumen.barras === 72, 'barras = 72 (=' + semilla.resumen.barras + ')');
// 20-AGO · 140.1 -> 140.2 kg (MEDIDA HASTA LA CRESTA, decision del usuario). Un lado
// ya no se mide a VERTICE: es una medida recta que suma R + phi por cada doblez que lo
// cierra (lado = tramo recto + R + phi). El unico numero de la semilla que se mueve es
// el B del CBS 103B phi16: 590.4 -> 592.0, que es la luz util exacta de la viga
// (600 - 2*4); esos 1.6 cm x 6 barras phi16 pesan 0.1 kg. Las patas 30/30 son FIJAS:
// las escribio el usuario y ni la cresta ni el redondeo las tocan.
ok(r1(semilla.resumen.kg) === 140.2, 'kg = 140.2 (=' + semilla.resumen.kg + ')');
ok(semilla.barras.every(b => !validarSlots(b)), 'sus 4 ítems pasan validar_geometria contra el catálogo real');

// ---------------------------------------------------------------------------
// MATRIZ RESUMIDA
// ---------------------------------------------------------------------------
console.log('\nMATRIZ — ' + dib.length + ' dibujables / ' + Object.keys(noDib).length + ' excluidas:');
const porFamilia = {};
matriz.forEach(m => { porFamilia[m.familia] = (porFamilia[m.familia] || 0) + 1; });
Object.keys(porFamilia).forEach(f => console.log('  · ' + f + ': ' + porFamilia[f] + ' figuras'));
const motivos = {};
Object.keys(noDib).forEach(c => { motivos[noDib[c]] = (motivos[noDib[c]] || 0) + 1; });
Object.keys(motivos).forEach(m => console.log('  · EXCLUIDAS (' + motivos[m] + '): ' + m));
console.log('  muestra: ' + matriz.slice(0, 6).map(m =>
  m.figura + '[' + m.dims + (m.angs ? ' ' + m.angs + '°' : '') + ' ' + m.kg + 'kg]').join('  '));

if (fallos) { console.error('\nFALLARON ' + fallos + ' aserciones'); process.exit(1); }
console.log('\nOK — catálogo real de figuras (63) end-to-end.');
