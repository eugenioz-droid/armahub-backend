// Test headless (sin navegador) del DIBUJANTE DE LA MINIATURA DE SECCIÓN
// (armahub/static/js/features/modelador/seccion_mini.js) y de cómo la usa el Gestor
// de templates.
//
// POR QUÉ EXISTE: el gestor mostraba cinco filas que empiezan con «Muro» y no había
// forma de saber cuál era cuál sin abrirlas una por una — el hormigón de varias es el
// mismo y lo que cambia es el FIERRO. La miniatura contesta eso… y por el camino se
// mete en las dos trampas que esta pantalla no puede permitirse:
//   · DIBUJAR EL PLANO EQUIVOCADO. La primera versión dibujaba siempre el corte
//     transversal, que en un muro es el CANTO: la vista menos informativa de las tres,
//     y los muros se seguían pareciendo. Cuál es «la sección» de cada elemento ya está
//     decidido en PLANOS_POR_ELEMENTO (template_editor.js) — un muro se trabaja en su
//     corte HORIZONTAL, largo × espesor, el que el editor rotula «SECCIÓN · YX».
//   · DIBUJAR ALGO QUE NO ES. El backend no corre el motor (es JS) y la proporción va
//     acotada para que un muro de 400 × 20 no salga como una tira de 4 px, así que el
//     dibujo es un ESQUEMA.
//
// CONTRATOS QUE FIJA:
//   S0 · El PLANO lo pone quien llama, y sale de PLANOS_POR_ELEMENTO — no de una lista
//        de tipos escrita a mano. Sin plano no se dibuja.
//   S1 · Las COTAS son dato REAL: son las dos medidas de ESE plano, y cambian con el
//        template. (La otra mitad de la asimetría.)
//   S2 · El DIBUJO distingue: en el corte horizontal, dos cortinas cosidas, dos
//        sueltas y una sola cortina salen tres dibujos distintos.
//   S3 · Se DICE que es un esquema, con esa palabra, en el tooltip y en la cabecera de
//        la columna — no en un asterisco al pie. Y la frase vive en UN solo sitio.
//   S4 · Una receta que no se puede dibujar muestra un HUECO que lo dice: nada de
//        silueta inventada, y nada de confundirlo con "el servidor no manda el dato".
//   S5 · El color entra por PARÁMETRO (como disenadorMotor.TINTA) y el llamador no
//        escribe hex.
//   S6 · Pintar NO escribe: el resumen que entra sale intacto.
//   S7 · Ninguna rama por tipología: el dibujante proyecta ejes, no conoce elementos.
//   S8 · Nada se sale del viewBox, y un token que no se entiende no se adivina.
//
// Correr con:  node tests/test_seccion_mini.js

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
const SRC_MINI = path.join(DIR, 'seccion_mini.js');
const SRC_TE = path.join(DIR, 'template_editor.js');
const SRC_BOOT = path.join(__dirname, '..', 'armahub', 'static', 'js', 'app', 'bootstrap.js');
const SRC_TAB = path.join(__dirname, '..', 'armahub', 'templates', 'tabs', 'catalogo.html');

// El dibujante no toca el DOM: se carga en un sandbox pelado a propósito. Si algún día
// necesita `document`, este test lo dice antes que el navegador.
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC_MINI, 'utf8'), sandbox, { filename: 'seccion_mini.js' });
const MINI = sandbox.ModeladorSeccionMini;
const TE = fs.readFileSync(SRC_TE, 'utf8');

let fallos = 0;
function ok(cond, nombre) {
  if (cond) console.log('  ✓ ' + nombre);
  else { console.log('  ✗ ' + nombre); fallos++; }
}

// LOS PLANOS, COPIADOS DE PLANOS_POR_ELEMENTO (template_editor.js). Que sigan siendo
// los mismos lo comprueba S0 leyendo la tabla real: acá se copian para poder ejercitar
// el dibujante sin arrastrar las 14.800 líneas del editor a este sandbox.
const P_MURO = { u: 'x', v: 'z', depth: 'y', W: 'largo', H: 'ancho', recub: { W: 'supinf', H: 'lat' } };
const P_VIGA = { u: 'z', v: 'y', depth: 'x', W: 'ancho', H: 'alto', recub: { W: 'lat', H: 'supinf' } };

// LA PALETA DEL EDITOR (COL2D). Igual que los planos: el vínculo con la tabla real lo
// comprueba S5 leyendo el fuente; acá se copia lo justo para ejercitar el dibujante.
const COL2D = { MH: '#1565c0', MV: '#00897b', TR: '#7b1fa2', ES: '#e65100',
  CBS: '#1565c0', CBI: '#00897b', TRV: '#7b1fa2', LT: '#607d8b' };
const paleta = (tip) => COL2D[String(tip || '').toUpperCase()] || COL2D.LT;

// EL MURO REAL DEL USUARIO (524 × 250 × 20), ya resumido por el backend. Estos tokens
// son los que congela tests/test_modelador_templates.py (t_seccion_dos_lineas_de_
// distribucion) y los que S10 coteja, número a número, contra ModeladorGenerar.
//   token = nx@ax-bx / ny@ay-by / nz@az-bz : rumbo [c] [~tipología]   (% de cada medida)
const MURO = { x: 524, y: 250, z: 20, rl: 2.5, rb: 3, p: [
  '1@1-99/14@1-99/2@15-85:x~MH',    // malla horizontal: corre por el largo, 2 cortinas
  '27@1-99/1@1-99/2@15-85:y~MV',    // malla vertical: cortada en este plano, 27 a lo largo
  '14@1-99/6@1-99/1@12-88:z~TR'] }; // traba: cruza el espesor de lado a lado
const MURO_SUELTO = { x: 524, y: 250, z: 20, rl: 2.5, rb: 3, p: MURO.p.slice(0, 2) };
const MURO_UNA = { x: 524, y: 250, z: 20, rl: 2.5, rb: 3, p: [
  '1@1-99/14@1-99/1@85:x~MH', '27@1-99/1@1-99/1@85:y~MV'] };
const VIGA = { x: 600, y: 60, z: 30, rl: 3, rb: 4, p: [
  '1@1-99/2@92-85/3@10-90:x~CBS', '1@1-99/1@8/4@10-90:x~CBI',
  '48@1-99/1@7-93/1@10-90:xc~ES', '1@1-99/1@50/1@89:x~TRV'] };

// ── S0. El plano sale de PLANOS_POR_ELEMENTO ────────────────────────────────
console.log('\nS0 — el plano lo decide la tabla del editor, no la miniatura');
{
  // La tabla real, leída del fuente del editor: si alguien cambia el plano de un muro
  // ahí, este test lo ve (y la miniatura también, porque lee la misma tabla).
  const tabla = TE.slice(TE.indexOf('var PLANOS_POR_ELEMENTO'), TE.indexOf('function _planosDe'));
  const secDe = (elem) => {
    const bloque = tabla.slice(tabla.indexOf('\n    ' + elem + ': {'));
    const m = /seccion:\s*\{([^}]*)\}/.exec(bloque);
    const g = (k) => (new RegExp(k + ":\\s*'([a-z]+)'").exec(m[1]) || [])[1];
    return { u: g('u'), v: g('v'), W: g('W'), H: g('H') };
  };
  const muro = secDe('muro'), viga = secDe('viga'), col = secDe('columna');
  ok(muro.W === 'largo' && muro.H === 'ancho',
    'la SECCIÓN de un muro es largo × espesor: el corte HORIZONTAL, no el canto');
  ok(muro.u === P_MURO.u && muro.v === P_MURO.v, 'y sus ejes son los que usa este test');
  ok(viga.W === 'ancho' && viga.H === 'alto',
    'la de una viga sigue siendo su corte transversal');
  ok(col.W === muro.W && col.H === muro.H, 'la columna hereda los planos del muro');
  // El gestor NO decide: pide el plano a la tabla, con un lookup que también hace
  // el fallback (así un tipo nuevo hereda el criterio sin registrarse en ningún lado).
  const mini = TE.slice(TE.indexOf('function _tplMini'), TE.indexOf('function _tplPintarLista'));
  ok(/_planosDe\(t\.tipo\)\.seccion/.test(mini),
    'la celda pide el plano a _planosDe(tipo).seccion');
  ok(!/['"](muro|viga|columna|losa|fundacion)['"]/.test(mini),
    'y no nombra ni un tipo de elemento: cero listas escritas a mano');
  ok(/PLANOS_POR_ELEMENTO\[String\(tipo/.test(TE) && /PLANOS_POR_ELEMENTO\.viga/.test(TE),
    '_planosDe resuelve contra la tabla y cae a un default conocido');
  // Y el dibujante no tiene plano propio al que caer.
  ok(MINI.svg(MURO, null).indexOf('sin secci') >= 0 &&
    MINI.svg(MURO, { u: 'x', v: 'x' }).indexOf('sin secci') >= 0,
    'sin plano (o con uno imposible) el dibujante NO inventa uno: devuelve el hueco');
}

// ── S1. Las cotas son dato real, del plano que toca ─────────────────────────
console.log('\nS1 — las cotas son las medidas de ESE plano');
{
  const s = MINI.svg(MURO, P_MURO);
  ok(/>524</.test(s) && />20</.test(s), 'el muro cota 524 × 20 (largo × espesor)');
  ok(!/>250</.test(s), 'y NO 250: el alto no es una medida de este corte');
  const v = MINI.svg(VIGA, P_VIGA);
  ok(/>30</.test(v) && />60</.test(v), 'la viga cota 30 × 60 (su corte transversal)');
  // Un muro de 524×20 a escala fiel es una tira de 3 px: la proporción va acotada.
  const g = MINI._encuadre(524, 20, 3, 2.5, 110, 80);
  ok(g.rw / g.rh > 3 && g.rw / g.rh < 8,
    'la proporción va acotada para que el fierro se lea (' +
    Math.round((g.rw / g.rh) * 100) / 100 + ') y aun así se lee como muro, no como viga');
  ok(/>524</.test(MINI.svg({ x: 524, y: 250, z: 20, rl: 2, rb: 2, p: [] }, P_MURO)),
    'y la cota sigue diciendo 524 aunque el dibujo esté comprimido');
  ok(/>2\.5</.test(MINI.svg({ x: 60, y: 40, z: 2.5, rl: 1, rb: 1, p: [] }, P_MURO)),
    'una medida con decimal se muestra con su decimal');
  ok(!/>20\.0</.test(s), 'y una entera sin decimales de adorno');
}

// ── S2. Dónde cae cada barra ────────────────────────────────────────────────
console.log('\nS2 — las cortinas van PEGADAS A LAS CARAS, no por el medio');
{
  const g = MINI._encuadre(524, 20, 3, 2.5, 110, 80);
  const s = MINI.svg(MURO, P_MURO, { color: paleta });
  // % del espesor donde cae cada punto (0 = cara de abajo del dibujo, 100 = la de arriba).
  const pct = (cy) => Math.round((1 - (cy - g.ry) / g.rh) * 1000) / 10;
  const filas = [...new Set([...s.matchAll(/<circle cx="[-\d.]+" cy="([-\d.]+)"/g)]
    .map(m => pct(+m[1])))].sort((a, b) => a - b);
  ok(filas.length === 2 && filas[0] === 15 && filas[1] === 85,
    'las dos cortinas caen en el 15% y el 85% del espesor — las MISMAS cifras del ' +
    'motor, z = ±(10 − 2.5 − φ/2) = ±7 (=' + filas.join('/') + ')');
  ok(!filas.some(f => f > 40 && f < 60), 'y ninguna queda por el medio (era el bug)');
  // Y con UNA sola cortina, contra su cara: no centrada.
  const s1 = MINI.svg(MURO_UNA, P_MURO, { color: paleta });
  const f1 = [...new Set([...s1.matchAll(/<circle cx="[-\d.]+" cy="([-\d.]+)"/g)]
    .map(m => pct(+m[1])))];
  ok(f1.length === 1 && f1[0] === 85,
    'una sola cortina va contra SU cara (85%), no al centro (=' + f1.join('/') + ')');
  // La traba cruza de recubrimiento a recubrimiento y asoma por fuera de las cortinas.
  const tr = [...s.matchAll(/M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)" fill="none" stroke="#7b1fa2"/g)];
  ok(tr.length > 0 && pct(+tr[0][2]) <= 13 && pct(+tr[0][4]) >= 87,
    'la traba cruza el espesor de lado a lado (12-88%) y por fuera de las dos cortinas');
}

console.log('\nS2b — tres muros que salen distintos en su corte horizontal');
{
  const a = MINI.svg(MURO, P_MURO), b = MINI.svg(MURO_SUELTO, P_MURO),
    c = MINI.svg(MURO_UNA, P_MURO);
  ok(a !== b && b !== c && a !== c, 'los tres muros dan tres dibujos distintos');
  const puntos = (s) => (s.match(/<circle/g) || []).length;
  const trazos = (s) => (s.match(/stroke-width="0?\.9"/g) || []).length;
  ok(puntos(a) === 54 && puntos(c) === 27,
    'dos cortinas × 27 = 54 puntos; una cortina = 27 (' + puntos(a) + '/' + puntos(c) + ')');
  ok(trazos(a) === 2 + 14 && trazos(b) === 2,
    'cosido = 2 cortinas + 14 trabas; suelto = sólo las 2 cortinas (' +
    trazos(a) + '/' + trazos(b) + ')');
  ok(trazos(c) === 1, 'una sola cortina = una sola línea (' + trazos(c) + ')');
  // La viga se lee de un vistazo: estribo + capas arriba y abajo.
  const v = MINI.svg(VIGA, P_VIGA);
  ok(puntos(v) === 3 * 2 + 4 * 1 + 1, 'la viga: 3×2 arriba, 4×1 abajo y la traba (' + puntos(v) + ')');
  ok(/M[\d.]+ [\d.]+H[\d.]+V[\d.]+H[\d.]+V[\d.]+/.test(v),
    'y el estribo va como marco abierto en una esquina (el gancho)');
  // El MISMO muro dibujado en el plano de una viga sale distinto: la proyección es
  // real, no una etiqueta pegada al dibujo.
  ok(MINI.svg(MURO, P_MURO) !== MINI.svg(MURO, P_VIGA),
    'el mismo resumen en otro plano da otro dibujo: se proyecta de verdad');
}

// ── S3. Se dice que es un esquema, con esa palabra ──────────────────────────
console.log('\nS3 — la miniatura declara que es un esquema');
{
  const t = MINI.titulo(MURO, P_MURO, 'YX');
  ok(/[Ee]squema/.test(t), 'el tooltip abre con la palabra «esquema»');
  ok(/medidas son las del template/.test(t),
    'y separa lo que SÍ es dato: las medidas del template');
  ok(/524 × 20/.test(t), 'el tooltip repite las cotas reales de este plano');
  ok(/· YX ·/.test(t),
    'y nombra el plano con las MISMAS letras que el editor rotula en su cuadrante');
  ok(/no corre el motor/.test(MINI.titulo(VIGA, P_VIGA)),
    'dice POR QUÉ el fierro es esquemático (no corre el motor)');
  ok(/no declara barras/.test(MINI.titulo({ x: 524, y: 250, z: 20, rl: 2, rb: 2, p: [] }, P_MURO)),
    'un template con hormigón y sin barras lo dice, en vez de mostrar un corte pelado');
  // La cabecera de la columna lleva la palabra SIEMPRE VISIBLE: un tooltip se puede no
  // descubrir nunca, y acá ya hubo tres rondas por controles que sólo aparecían al
  // pasar el cursor.
  ok(/>Secci[oó]n · esquema</.test(TE),
    'la cabecera de la columna dice «Sección · esquema», sin hover de por medio');
  // Y la frase honesta vive en UN solo sitio: si el llamador la reescribe, un día
  // dicen cosas distintas.
  const mini = TE.slice(TE.indexOf('function _tplMini'), TE.indexOf('function _tplPintarLista'));
  ok(/M\.titulo\(/.test(mini) && !/[Ee]squema de la secci/.test(mini),
    'el gestor pide el tooltip al dibujante en vez de escribir su propia versión');
  ok(/_ejeRotulo\(def\.u, def\.v\)/.test(mini),
    'y el rótulo de ejes lo saca de la misma función que rotula los cuadrantes');
}

// ── S4. Lo que no se puede dibujar se ve como un hueco ──────────────────────
console.log('\nS4 — sin receta dibujable, un hueco que lo dice');
{
  const h = MINI.svg(null, P_MURO);
  ok(/sin secci/.test(h), 'el hueco lo DICE con palabra');
  ok(!/<circle/.test(h) && !/fill="#eceff1"/.test(h),
    'y no dibuja ni una barra ni una silueta de hormigón inventada');
  ok(/stroke-dasharray/.test(h), 'se ve como un hueco (borde punteado), no como una sección');
  ok(MINI.svg(undefined, P_MURO) === h && MINI.svg({}, P_MURO) === h &&
    MINI.svg({ x: 0, z: 20 }, P_MURO) === h,
    'una medida ausente, en 0 o sin resumen caen todas en el mismo hueco');
  // El muro necesita largo y espesor: que le sobre el alto no lo salva.
  ok(MINI.svg({ y: 250, rl: 2, rb: 2, p: [] }, P_MURO) === h,
    'y una receta con la medida que ESTE plano no usa tampoco se dibuja a medias');
  ok(/no hay secci/.test(MINI.titulo(null, P_MURO)) && /Ábrela/.test(MINI.titulo(null, P_MURO)),
    'el tooltip explica qué falta y dónde mirarlo');
  // "el servidor no manda el dato" es OTRA cosa y no comparte dibujo: el guion se
  // reserva para eso (mismo criterio que _tplKpi / _tplUso).
  const mini = TE.slice(TE.indexOf('function _tplMini'), TE.indexOf('function _tplPintarLista'));
  ok(/seccion === undefined/.test(mini) && /—/.test(mini),
    'un backend que no manda `seccion` da guion, no el hueco');
  ok(/no llegó a cargar/.test(mini) && /no manda todavía/.test(mini),
    'y "no cargó el dibujante" dice otra cosa que "el servidor no lo manda": ' +
    'un hueco que confunde manda a arreglar lo que no está roto');
  ok(/ModeladorSeccionMini/.test(mini) && !/<svg/.test(mini),
    'y el gestor no improvisa un SVG propio si el dibujante no está');
}

// ── S5. El color entra por parámetro ────────────────────────────────────────
console.log('\nS5 — la tinta la decide quien llama');
{
  ok(MINI.svg(VIGA, P_VIGA).indexOf(MINI.TINTA) >= 0, 'sin parámetro manda la tinta por defecto');
  const rojo = MINI.svg(VIGA, P_VIGA, { color: '#b3261e' });
  ok(rojo.indexOf('#b3261e') >= 0 && rojo.indexOf(MINI.TINTA) < 0,
    'con `color` se pinta el fierro entero de ese tono');
  ok(MINI.svg(VIGA, P_VIGA, { hormigon: '#fff8e1' }).indexOf('#fff8e1') >= 0,
    'y el hormigón también entra por parámetro');
  ok(typeof MINI.TINTA === 'string' && /^#[0-9a-f]{6}$/i.test(MINI.TINTA),
    'los tonos van NOMBRADOS y exportados (probar otro es una línea)');

  // COLOR POR TIPOLOGÍA — el usuario comparó la miniatura contra el cuadrante SECCIÓN
  // del 3D con el mismo muro: «los colores también son diferentes». Con la miniatura en
  // un solo tono había que traducir entre dos vocabularios para leer el mismo fierro.
  const pintado = MINI.svg(MURO, P_MURO, { color: paleta });
  const tonos = [...new Set([...pintado.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)].map(m => m[1]))];
  ok(tonos.indexOf(COL2D.MH) >= 0 && tonos.indexOf(COL2D.MV) >= 0 && tonos.indexOf(COL2D.TR) >= 0,
    'con la paleta, cada grupo sale en el tono de SU tipología (malla horizontal, ' +
    'vertical y traba, tres colores distintos)');
  ok(MINI.svg(MURO, P_MURO, { color: () => null }).indexOf(MINI.TINTA) >= 0,
    'y una tipología que la paleta no conoce cae a la tinta por defecto, no a un hueco');
  // El dibujante recibe la TIPOLOGÍA y la devuelve convertida en color sin saber qué es.
  const srcMini = fs.readFileSync(SRC_MINI, 'utf8');
  const codigoMini = srcMini.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  ok(!/\bMH\b|\bCBS\b|\bES\b|COL2D/.test(codigoMini),
    'y no hay ni una tipología ni una tabla de colores dentro del dibujante');

  const mini = TE.slice(TE.indexOf('function _tplMini'), TE.indexOf('function _tplPintarLista'));
  ok(!/#[0-9a-fA-F]{6}/.test(mini), 'el gestor no escribe ni un hex: el color vive en la paleta');
  ok(/color: _colDe/.test(mini),
    'el gestor le pasa _colDe, la PALETA ÚNICA que ya pinta las barras del editor');
  ok(/colorDeTipologia: _colDe/.test(TE),
    'que es la misma que el editor exporta como colorDeTipologia (una sola tabla)');
}

// ── S6. Pintar no escribe ───────────────────────────────────────────────────
console.log('\nS6 — el render no muta lo que dibuja');
{
  const entra = { x: 400, y: 250, z: 20, rl: 2.5, rb: 3, p: ['1.5.2:x', '3.2.1:z'] };
  const plano = { u: 'x', v: 'z', recub: { W: 'supinf', H: 'lat' } };
  const antes = JSON.stringify(entra), antesP = JSON.stringify(plano);
  MINI.svg(entra, plano); MINI.titulo(entra, plano, 'YX');
  MINI.svg(entra, plano, { width: 300, height: 220 });
  ok(JSON.stringify(entra) === antes, 'el resumen sale byte a byte igual que entró');
  ok(JSON.stringify(plano) === antesP, 'y el plano tampoco se toca (es la tabla del editor)');
}

// ── S7. Ninguna rama por tipología ──────────────────────────────────────────
console.log('\nS7 — el dibujante proyecta ejes, no conoce elementos');
{
  const src = fs.readFileSync(SRC_MINI, 'utf8');
  // Se mira el CÓDIGO, no los comentarios: la nota de por qué sí puede nombrarlos.
  const codigo = src.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  ok(!/\b(viga|muro|columna|losa|estribo|cortina|cabezal|traba)\b/i.test(codigo),
    'no hay ni un nombre de elemento ni de tipología en el código');
  ok(!/\.tipo\b/.test(codigo), 'ni lee el campo `tipo` del template');
  // Mismo resumen y mismo plano = mismo dibujo, le cuelgue lo que le cuelgue.
  const a = MINI.svg({ x: 600, y: 60, z: 30, rl: 3, rb: 4, p: ['1.1.1:xc'] }, P_VIGA);
  const b = MINI.svg({ x: 600, y: 60, z: 30, rl: 3, rb: 4, p: ['1.1.1:xc'], tipo: 'muro' }, P_VIGA);
  ok(a === b, 'un campo de más en el resumen no cambia un píxel');
}

// ── S8. Nada se sale del marco y nada se adivina ────────────────────────────
console.log('\nS8 — el dibujo cabe, y lo que no se entiende no se dibuja');
{
  function fuera(s, W, H) {
    const xs = [], ys = [];
    for (const m of s.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)) {
      xs.push(+m[1], +m[1] + +m[3]); ys.push(+m[2], +m[2] + +m[4]);
    }
    for (const m of s.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g)) {
      xs.push(+m[1] - +m[3], +m[1] + +m[3]); ys.push(+m[2] - +m[3], +m[2] + +m[3]);
    }
    for (const m of s.matchAll(/ d="([^"]+)"/g)) {
      const d = m[1];
      for (const p of d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) { xs.push(+p[1]); ys.push(+p[2]); }
      for (const p of d.matchAll(/H(-?[\d.]+)/g)) xs.push(+p[1]);
      for (const p of d.matchAll(/V(-?[\d.]+)/g)) ys.push(+p[1]);
    }
    for (const m of s.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"/g)) { xs.push(+m[1]); ys.push(+m[2]); }
    return Math.min(...xs) < 0 || Math.max(...xs) > W || Math.min(...ys) < 0 || Math.max(...ys) > H;
  }
  const casos = [
    [MURO, P_MURO], [MURO_SUELTO, P_MURO], [MURO_UNA, P_MURO], [VIGA, P_VIGA],
    [{ x: 900, y: 300, z: 15, rl: 2, rb: 3,
       p: ['1@1-99/60@1-99/2@13-87:x~MH', '60@1-99/1@1-99/2@13-87:y~MV',
           '30@1-99/2@98-70/1@13-87:z~TR'] }, P_MURO],
    [{ x: 100, y: 15, z: 100, rl: 2, rb: 2, p: ['8@2-98/1@1-99/8@2-98:y~MV'] }, P_VIGA],
    [{ x: 400, y: 40, z: 40, rl: 4, rb: 4,
       p: ['1@1-99/1@10-90/1@10-90:xc~ES', '1@1-99/4@88-70/3@12-88:x~CBS'] }, P_VIGA]];
  ok(!casos.some(c => fuera(MINI.svg(c[0], c[1]), 110, 80)),
    'ninguno de los 7 casos se sale del viewBox');
  ok(!fuera(MINI.svg(MURO, P_MURO, { width: 300, height: 220 }), 300, 220),
    'y pedirla más grande tampoco la descuadra');
  // Un grupo con más barras de las que caben se dibuja con las que caben (a 110 px la
  // diferencia entre 14 puntos y 60 no es información), pero NO revienta ni se sale.
  const denso = MINI.svg({ x: 900, y: 300, z: 15, rl: 2, rb: 3,
    p: ['60@1-99/1@1-99/2@13-87:y~MV'] }, P_MURO);
  const n = (denso.match(/<circle/g) || []).length;
  ok(n > 0 && n < 120, 'un grupo de 120 barras se dibuja con las que caben (' + n + ')');
  // Y lo que no calza con el contrato no se adivina — los DOS formatos anteriores del
  // token incluidos: uno mal leído sería una miniatura que dibuja otra cosa.
  ok(MINI._tok('1@1-99/14@1-99/2@15-85:x~MH') && MINI._tok('1@50/1@50/1@50:xc') &&
    !MINI._tok('1@1-99/14@1-99/2@15-85:w') && !MINI._tok('1.5.2:x') &&
    !MINI._tok('t2x5p') && !MINI._tok('') && !MINI._tok('basura'),
    'un token que no calza con el contrato se descarta (los formatos viejos incluidos)');
  const sucio = MINI.svg({ x: 600, y: 60, z: 30, rl: 3, rb: 4,
    p: ['1@50/1@7-93/1@10-90:xc', '<script>x</script>', 'z9x9q'] }, P_VIGA);
  ok(sucio.indexOf('<script') < 0, 'un token corrupto no llega al SVG (ni como texto)');
  const limpio = MINI.svg({ x: 600, y: 60, z: 30, rl: 3, rb: 4,
    p: ['1@50/1@7-93/1@10-90:xc'] }, P_VIGA);
  ok((sucio.match(/ d="/g) || []).length === (limpio.match(/ d="/g) || []).length,
    'y los tokens buenos se dibujan igual: uno malo no arrastra a los demás');
}

// ── S9. El dibujante llega al navegador ─────────────────────────────────────
console.log('\nS9 — está cableado donde tiene que estar');
{
  const boot = fs.readFileSync(SRC_BOOT, 'utf8');
  ok(/modelador\/seccion_mini\.js/.test(boot), 'bootstrap.js lo carga (si no, la columna sale en guion)');
  const tab = fs.readFileSync(SRC_TAB, 'utf8');
  ok(/\.tplMini\b/.test(tab) && /tplMiniSin/.test(tab),
    'el tab reserva el sitio de la miniatura y el del guion');
  ok(/width:110px/.test(tab) && /height:80px/.test(tab),
    'y con el tamaño que el usuario pidió (110×80: en 64×46 la sección no se leía)');
}

// ── S10. COTEJO CONTRA EL MOTOR ─────────────────────────────────────────────
// EL TEST QUE FALTÓ LA PRIMERA VEZ. La miniatura se construyó desde la receta sin
// cruzarla nunca con lo que ModeladorGenerar produce de verdad, y se publicó un muro
// con las tres mallas apiladas en el centro. Acá se corre el motor REAL sobre la misma
// receta que el backend resume (tests/test_modelador_templates.py ·
// t_seccion_dos_lineas_de_distribucion) y se comparan, eje por eje, CUÁNTAS barras hay
// y ENTRE QUÉ DOS POSICIONES. Si el resumen vuelve a decir algo que el motor no dice,
// falla acá y no en la pantalla del usuario.
console.log('\nS10 — el resumen dice lo mismo que el motor');
{
  const base = path.join(__dirname, '..', 'armahub', 'static', 'js', 'features', 'modelador');
  global.ModeladorFiguraPuntos = require(path.join(base, 'figura_puntos.js'));
  require(path.join(base, 'motor_geom.js'));
  global.ModeladorCatalogoFiguras = require(path.join(base, 'catalogo_figuras.js'));
  global.ModeladorReglas = require(path.join(base, 'reglas.js'));
  const G = require(path.join(base, 'generar.js'));

  // LA MISMA receta que el backend resume en MURO (524 × 250 × 20). El `arreglo` va con
  // las DOS líneas de distribución que escribe el editor de hoy: `rango` + `rango2`.
  const receta = {
    tipo: 'muro',
    geometria: { largo: 524, alto: 250, ancho: 20, recub_sup: 3, recub_inf: 3, recub_lat: 2.5 },
    componentes: [
      { comp_id: 'MH', tipologia: 'MH', figura: '101A', diam: 10, cara: 'lateral',
        jerarquia: 1, modo: 'arreglo', dims: { A: { modo: 'auto' } },
        distribucion: { modo: 'arreglo', sep: 20, activa: true,
          rango: { eje: 'y', from: -122, to: 122, sep: 20 },
          rango2: { eje: 'z', from: -7, to: 7, sep: 14 } } },
      { comp_id: 'MV', tipologia: 'MV', figura: '101A', diam: 10, cara: 'lateral',
        jerarquia: 1, modo: 'arreglo', plano_pieza: { orientacion: 'de_pie' },
        dims: { A: { modo: 'auto' } },
        distribucion: { modo: 'arreglo', sep: 20, activa: true,
          rango: { eje: 'x', from: -259, to: 259, sep: 120 },
          rango2: { eje: 'z', from: -7, to: 7, sep: 14 } } },
      { comp_id: 'TR', tipologia: 'TR', figura: '101A', diam: 8, cara: 'lateral',
        jerarquia: 2, modo: 'arreglo', plano_pieza: { volteado: true },
        dims: { A: { modo: 'auto' } },
        distribucion: { modo: 'arreglo', sep: 40, activa: true,
          rango: { eje: 'x', from: -259, to: 259, sep: 180 },
          rango2: { eje: 'y', from: -122, to: 122, sep: 60 } } }
    ]
  };
  const out = G.generarViga(JSON.parse(JSON.stringify(receta)), {});
  const dim = { x: 524, y: 250, z: 20 };
  const pct = (e, cm) => Math.round(Math.max(0, Math.min(100, 50 + 100 * cm / dim[e])));
  const porComp = {};
  for (const pl of out.placements) (porComp[pl.comp_id] = porComp[pl.comp_id] || []).push(pl);

  // Lo que el MOTOR pone, por eje: cuántas posiciones distintas y de dónde a dónde.
  function motor(cid) {
    const g = porComp[cid], r = {};
    for (const e of ['x', 'y', 'z']) {
      const cen = new Set(); let lo = Infinity, hi = -Infinity;
      for (const pl of g) {
        const v = pl.puntos.map(p => p[e]);
        const a = Math.min(...v), b = Math.max(...v);
        cen.add(((a + b) / 2).toFixed(2)); lo = Math.min(lo, a); hi = Math.max(hi, b);
      }
      const cs = [...cen].map(Number).sort((x, y) => x - y);
      // Una barra SOLA por eje: lo que dice ese eje es su LARGO (de dónde a dónde
      // llega). Con varias, dice sus POSICIONES.
      r[e] = (cs.length === 1)
        ? { n: 1, a: pct(e, lo), b: pct(e, hi) }
        : { n: cs.length, a: pct(e, cs[0]), b: pct(e, cs[cs.length - 1]) };
    }
    r.barras = g.length;
    return r;
  }
  // Y lo que dice el TOKEN, sin proyectar todavía: es la comparación cruda.
  const tk = {};
  for (const t of MURO.p) { const k = MINI._tok(t); tk[k.tip] = k; }

  let iguales = 0, total = 0;
  for (const cid of ['MH', 'MV', 'TR']) {
    const m = motor(cid), t = tk[cid];
    for (const e of ['x', 'y', 'z']) {
      total++;
      // Tolerancia de UN punto porcentual: el motor recorta el recubrimiento con el φ
      // real de cada barra y el resumen redondea a entero. En un muro de 20 cm, 1 punto
      // son 2 mm — por debajo de lo que un píxel de esta miniatura puede decir.
      const cerca = (Math.abs(m[e].a - t[e].a) <= 1 && Math.abs(m[e].b - t[e].b) <= 1);
      const bien = (m[e].n === t[e].n) && cerca;
      if (bien) iguales++;
      ok(bien, cid + '·' + e + ': motor ' + m[e].n + '@' + m[e].a + '-' + m[e].b +
        '  ·  resumen ' + t[e].n + '@' + t[e].a + '-' + t[e].b);
    }
    ok(t.x.n * t.y.n * t.z.n === m.barras,
      cid + ': el producto de los tres ejes da las ' + m.barras + ' barras del motor (=' +
      (t.x.n * t.y.n * t.z.n) + ')');
  }
  ok(iguales === total, 'los ' + total + ' ejes de los 3 grupos coinciden con el motor');

  // Y el DIBUJO respeta esas cifras: las cortinas del motor (z = ±7 → 15%/85%) son las
  // que terminan pintadas. Es el paso que cierra el círculo receta → resumen → píxel.
  const g2 = MINI._encuadre(524, 20, 3, 2.5, 110, 80);
  const svgM = MINI.svg(MURO, P_MURO, { color: paleta });
  const filas = [...new Set([...svgM.matchAll(/<circle cx="[-\d.]+" cy="([-\d.]+)"/g)]
    .map(m => Math.round((1 - (+m[1] - g2.ry) / g2.rh) * 100)))].sort((a, b) => a - b);
  const zMotor = [...new Set(porComp.MV.map(pl => pct('z', pl.puntos[0].z)))].sort((a, b) => a - b);
  ok(JSON.stringify(filas) === JSON.stringify(zMotor),
    'y el SVG pinta la malla vertical en las mismas z que el motor (' +
    filas.join('/') + ' vs ' + zMotor.join('/') + ')');
}

console.log(fallos ? '\n❌ ' + fallos + ' fallo(s)' : '\n✅ Todo OK');
process.exit(fallos ? 1 : 0);
