// Test headless (sin navegador) del DIBUJANTE DE LA MINIATURA DE SECCIÓN
// (armahub/static/js/features/modelador/seccion_mini.js) y de cómo la usa el Gestor
// de templates.
//
// POR QUÉ EXISTE: el gestor mostraba cinco filas que empiezan con «Muro» y no había
// forma de saber cuál era cuál sin abrirlas una por una — el hormigón de varias es el
// mismo y lo que cambia es el FIERRO. La miniatura contesta eso… y por el camino se
// mete en la única trampa que esta pantalla no puede permitirse: DIBUJAR ALGO QUE NO
// ES. El backend no corre el motor (es JS) y la proporción va acotada para que un muro
// de 20×250 no salga como una tira de 5 px, así que el dibujo es un ESQUEMA. Los
// contratos de abajo son los que impiden que se venda como otra cosa.
//
// CONTRATOS QUE FIJA:
//   S1 · Las COTAS son dato REAL: los números que se ven son los del template, y
//        cambian cuando cambia el template. (La otra mitad de la asimetría.)
//   S2 · El DIBUJO distingue: dos cortinas cosidas, dos sueltas y una sola cortina
//        salen tres dibujos distintos. Es la pregunta que motivó la miniatura.
//   S3 · Se DICE que es un esquema, con esa palabra, en el tooltip y en la cabecera de
//        la columna — no en un asterisco al pie. Y la frase vive en UN solo sitio.
//   S4 · Una receta que no se puede dibujar muestra un HUECO que lo dice: nada de
//        silueta inventada, y nada de confundirlo con "el servidor no manda el dato".
//   S5 · El color entra por PARÁMETRO (como disenadorMotor.TINTA) y el llamador no
//        escribe hex.
//   S6 · Pintar NO escribe: el resumen que entra sale intacto.
//   S7 · Ninguna rama por tipología: el dibujante no sabe si eso es un muro o una viga.
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

let fallos = 0;
function ok(cond, nombre) {
  if (cond) console.log('  ✓ ' + nombre);
  else { console.log('  ✗ ' + nombre); fallos++; }
}

// Los cuatro templates de la maqueta que el usuario aprobó, ya resumidos por el
// backend (modelador._resumen_seccion): esto es EXACTAMENTE lo que llega por la red.
const MURO_COSIDO = { w: 20, h: 250, r: 2.5, p: ['t2x5p', 't2x1v', 't1x2h'] };
const MURO_SUELTO = { w: 20, h: 250, r: 2.5, p: ['t2x3p', 't2x1v'] };
const MURO_UNA = { w: 20, h: 210, r: 2.5, p: ['t1x5p', 't1x1v'] };
const VIGA = { w: 30, h: 60, r: 3, p: ['s3x2p', 'i4x1p', 't1x1m', 't1x1p'] };

// ── S1. Las cotas son dato real ─────────────────────────────────────────────
console.log('\nS1 — las cotas son las medidas del template');
{
  const s = MINI.svg(MURO_COSIDO);
  ok(/>20</.test(s) && />250</.test(s),
    'la miniatura muestra las dos medidas del hormigón (20 y 250)');
  ok(/>30</.test(MINI.svg(VIGA)) && />60</.test(MINI.svg(VIGA)),
    'y las de la viga son otras (30 y 60): no es un rótulo fijo');
  // Un muro de 20×250 dibujado a escala fiel es una tira de 5 px: la proporción va
  // acotada A PROPÓSITO. Lo que NO se toca es la cifra.
  const g = MINI._encuadre({ w: 20, h: 250, r: 2.5 }, 110, 80);
  ok(g.rw / g.rh > 0.2, 'la proporción va acotada para que el fierro se lea (' +
    Math.round((g.rw / g.rh) * 100) / 100 + ')');
  ok(/>250</.test(MINI.svg({ w: 20, h: 250, r: 2.5, p: [] })),
    'y la cota sigue diciendo 250 aunque el dibujo esté comprimido');
  ok(/>2\.5</.test(MINI.svg({ w: 2.5, h: 60, r: 1, p: [] })),
    'una medida con decimal se muestra con su decimal');
  ok(!/>20\.0</.test(MINI.svg(MURO_COSIDO)),
    'y una entera sin decimales de adorno');
}

// ── S2. El dibujo distingue lo que el nombre no distinguía ──────────────────
console.log('\nS2 — tres «Muro …» que salen distintos');
{
  const a = MINI.svg(MURO_COSIDO), b = MINI.svg(MURO_SUELTO), c = MINI.svg(MURO_UNA);
  ok(a !== b && b !== c && a !== c, 'los tres muros dan tres dibujos distintos');
  const puntos = (s) => (s.match(/<circle/g) || []).length;
  ok(puntos(a) === 10 && puntos(b) === 6,
    'dos cortinas de 5 = 10 puntos; de 3 = 6 (' + puntos(a) + '/' + puntos(b) + ')');
  ok(puntos(c) === 5, 'una sola cortina = una columna de 5 (' + puntos(c) + ')');
  // La traba es lo que separa "cosidas" de "sueltas", y se ve: cruza el ancho.
  const trazos = (s) => (s.match(/<path/g) || []).length;
  ok(trazos(a) > trazos(b), 'el muro COSIDO lleva trazos que el suelto no (las trabas)');
  ok(/<path[^>]*stroke-width="0?\.9"/.test(a), 'y las trabas se dibujan como línea, no como punto');
  // La viga se lee de un vistazo: estribo + capas arriba y abajo.
  const v = MINI.svg(VIGA);
  ok(puntos(v) === 3 * 2 + 4 * 1 + 1, 'la viga: 3×2 arriba, 4×1 abajo y la traba (' + puntos(v) + ')');
  ok(/V\d/.test(v) && /H\d/.test(v), 'y el estribo va como marco (un contorno, no puntos)');
  // El marco lleva GANCHO: un rectángulo cerrado se leería como más hormigón.
  const marco = MINI.svg({ w: 30, h: 60, r: 3, p: ['t1x1m'] });
  ok(/M[\d.]+ [\d.]+H[\d.]+V[\d.]+H[\d.]+V[\d.]+/.test(marco),
    'el marco se traza abierto en una esquina (el gancho del estribo)');
}

// ── S3. Se dice que es un esquema, con esa palabra ──────────────────────────
console.log('\nS3 — la miniatura declara que es un esquema');
{
  const t = MINI.titulo(MURO_COSIDO);
  ok(/[Ee]squema/.test(t), 'el tooltip abre con la palabra «esquema»');
  ok(/medidas son las del template/.test(t),
    'y separa lo que SÍ es dato: las medidas del template');
  ok(/20 × 250/.test(t), 'el tooltip repite las cotas reales');
  ok(/no corre el motor/.test(MINI.titulo(VIGA)),
    'dice POR QUÉ el fierro es esquemático (no corre el motor)');
  ok(/no declara barras/.test(MINI.titulo({ w: 20, h: 250, r: 2, p: [] })),
    'un template con hormigón y sin barras lo dice, en vez de mostrar un corte pelado');
  // La cabecera de la columna lleva la palabra SIEMPRE VISIBLE: un tooltip se puede
  // no descubrir nunca, y acá ya hubo tres rondas por controles que sólo aparecían al
  // pasar el cursor.
  const te = fs.readFileSync(SRC_TE, 'utf8');
  ok(/>Secci[oó]n · esquema</.test(te),
    'la cabecera de la columna dice «Sección · esquema», sin hover de por medio');
  // Y la frase honesta vive en UN solo sitio: si el llamador la reescribe, un día
  // dicen cosas distintas.
  const mini = te.slice(te.indexOf('function _tplMini'), te.indexOf('function _tplPintarLista'));
  ok(/M\.titulo\(/.test(mini) && !/[Ee]squema de la secci/.test(mini),
    'el gestor pide el tooltip al dibujante en vez de escribir su propia versión');
}

// ── S4. Lo que no se puede dibujar se ve como un hueco ──────────────────────
console.log('\nS4 — sin receta dibujable, un hueco que lo dice');
{
  const h = MINI.svg(null);
  ok(/sin secci/.test(h), 'el hueco lo DICE con palabra');
  ok(!/<circle/.test(h) && !/fill="#eceff1"/.test(h),
    'y no dibuja ni una barra ni una silueta de hormigón inventada');
  ok(/stroke-dasharray/.test(h), 'se ve como un hueco (borde punteado), no como una sección');
  ok(MINI.svg(undefined) === h && MINI.svg({}) === h && MINI.svg({ w: 0, h: 250 }) === h,
    'una medida ausente, en 0 o sin resumen caen todas en el mismo hueco');
  ok(/no hay secci/.test(MINI.titulo(null)) && /Ábrela/.test(MINI.titulo(null)),
    'y el tooltip explica qué falta y dónde mirarlo');
  // "el servidor no manda el dato" es OTRA cosa y no comparte dibujo: el guion se
  // reserva para eso (mismo criterio que _tplKpi / _tplUso).
  const te = fs.readFileSync(SRC_TE, 'utf8');
  const mini = te.slice(te.indexOf('function _tplMini'), te.indexOf('function _tplPintarLista'));
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
  ok(MINI.svg(VIGA).indexOf(MINI.TINTA) >= 0, 'sin parámetro manda la tinta por defecto');
  const rojo = MINI.svg(VIGA, { color: '#b3261e' });
  ok(rojo.indexOf('#b3261e') >= 0 && rojo.indexOf(MINI.TINTA) < 0,
    'con `color` se pinta el fierro entero de ese tono');
  ok(MINI.svg(VIGA, { hormigon: '#fff8e1' }).indexOf('#fff8e1') >= 0,
    'y el hormigón también entra por parámetro');
  ok(typeof MINI.TINTA === 'string' && /^#[0-9a-f]{6}$/i.test(MINI.TINTA),
    'los tonos van NOMBRADOS y exportados (probar otro es una línea)');
  const te = fs.readFileSync(SRC_TE, 'utf8');
  const mini = te.slice(te.indexOf('function _tplMini'), te.indexOf('function _tplPintarLista'));
  ok(!/#[0-9a-fA-F]{6}/.test(mini), 'el gestor no escribe ni un hex: el color vive en el dibujante');
}

// ── S6. Pintar no escribe ───────────────────────────────────────────────────
console.log('\nS6 — el render no muta lo que dibuja');
{
  const entra = { w: 20, h: 250, r: 2.5, p: ['t2x5p', 't1x2h'] };
  const antes = JSON.stringify(entra);
  MINI.svg(entra); MINI.titulo(entra); MINI.svg(entra, { width: 300, height: 220 });
  ok(JSON.stringify(entra) === antes, 'el resumen sale byte a byte igual que entró');
}

// ── S7. Ninguna rama por tipología ──────────────────────────────────────────
console.log('\nS7 — el dibujante no sabe de tipologías');
{
  const src = fs.readFileSync(SRC_MINI, 'utf8');
  // Se mira el CÓDIGO, no los comentarios: la nota de por qué sí puede nombrarlas.
  const codigo = src.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  ok(!/\b(viga|muro|columna|losa|estribo|cortina|cabezal|traba)\b/i.test(codigo),
    'no hay ni un nombre de elemento ni de tipología en el código');
  ok(!/\.tipo\b/.test(codigo), 'ni lee el campo `tipo` del template');
  // Mismo resumen = mismo dibujo, le cuelgue lo que le cuelgue.
  const a = MINI.svg({ w: 30, h: 60, r: 3, p: ['t1x1m'] });
  const b = MINI.svg({ w: 30, h: 60, r: 3, p: ['t1x1m'], tipo: 'muro', nombre: 'X' });
  ok(a === b, 'un campo de más en el resumen no cambia un píxel');
}

// ── S8. Nada se sale del marco y nada se adivina ────────────────────────────
console.log('\nS8 — el dibujo cabe, y lo que no se entiende no se dibuja');
{
  function fuera(s, W, H) {
    const num = (re) => [...s.matchAll(re)].map(m => Number(m[1]));
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
  const casos = [MURO_COSIDO, MURO_SUELTO, MURO_UNA, VIGA,
    { w: 100, h: 15, r: 2, p: ['s8x1p', 'i8x1p'] },     // una losa: muy ancha
    { w: 15, h: 400, r: 2, p: ['t2x40p'] },             // un muro altísimo y muy armado
    { w: 40, h: 40, r: 4, p: ['t1x1m', 's4x3p'] }];
  ok(!casos.some(c => fuera(MINI.svg(c), 110, 80)), 'ninguno de los 7 casos se sale del viewBox');
  ok(!fuera(MINI.svg(MURO_COSIDO, { width: 300, height: 220 }), 300, 220),
    'y pedirla más grande tampoco la descuadra');
  // Un grupo con más barras de las que caben se dibuja con las que caben (a 110 px la
  // diferencia entre 14 puntos y 40 no es información), pero NO revienta ni se sale.
  const denso = MINI.svg({ w: 15, h: 400, r: 2, p: ['t2x40p'] });
  const n = (denso.match(/<circle/g) || []).length;
  ok(n > 0 && n < 80, 'un grupo de 80 barras se dibuja con las que caben (' + n + ')');
  // Y lo que no calza con el contrato no se adivina.
  ok(MINI._tok('t2x5p') && !MINI._tok('t2x5z') && !MINI._tok('') && !MINI._tok('basura'),
    'un token que no calza con el contrato se descarta');
  const sucio = MINI.svg({ w: 30, h: 60, r: 3, p: ['t1x1m', '<script>x</script>', 'z9x9q'] });
  ok(sucio.indexOf('<script') < 0, 'un token corrupto no llega al SVG (ni como texto)');
  ok((sucio.match(/ d="/g) || []).length === MINI.svg({ w: 30, h: 60, r: 3, p: ['t1x1m'] }).match(/ d="/g).length,
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

console.log(fallos ? '\n❌ ' + fallos + ' fallo(s)' : '\n✅ Todo OK');
process.exit(fallos ? 1 : 0);
